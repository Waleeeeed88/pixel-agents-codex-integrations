import * as fs from 'fs';
import * as path from 'path';

import {
  hasGraphifyOutput,
  isGraphifyStale,
  runGraphify,
  syncGraphifyKnowledgeBase,
} from './graphify.js';

export interface WorkflowPreparationResult {
  workspaceRoot: string;
  serenaConfigCreated: boolean;
  serenaLocalConfigCreated: boolean;
  serenaConfigPath: string;
  serenaLocalConfigPath: string;
  serenaMemoriesDir: string;
  graphifyReady: boolean;
  graphifyRefreshed: boolean;
  graphifyError: string | null;
  codexInitialPrompt: string;
}

const WORKFLOW_IGNORE_DIRS = new Set([
  '.git',
  '.next',
  '.serena',
  '.turbo',
  '.vercel',
  'coverage',
  'dist',
  'graphify-out',
  'node_modules',
  'out',
  'playwright-report',
  'test-results',
]);

const EXTENSION_LANGUAGE_MAP = new Map<string, string>([
  ['.cjs', 'typescript'],
  ['.cs', 'csharp'],
  ['.go', 'go'],
  ['.java', 'java'],
  ['.js', 'typescript'],
  ['.jsx', 'typescript'],
  ['.kt', 'kotlin'],
  ['.kts', 'kotlin'],
  ['.mjs', 'typescript'],
  ['.php', 'php'],
  ['.ps1', 'powershell'],
  ['.py', 'python'],
  ['.rb', 'ruby'],
  ['.rs', 'rust'],
  ['.scala', 'scala'],
  ['.sh', 'bash'],
  ['.swift', 'swift'],
  ['.ts', 'typescript'],
  ['.tsx', 'typescript'],
]);

const MAX_LANGUAGE_SCAN_FILES = 400;

export async function prepareWorkspaceWorkflow(
  workspaceRoot: string,
): Promise<WorkflowPreparationResult> {
  const serena = ensureSerenaWorkflow(workspaceRoot);
  const hadGraphifyOutput = hasGraphifyOutput(workspaceRoot);
  let graphifyReady = hadGraphifyOutput;
  let graphifyRefreshed = false;
  let graphifyError: string | null = null;

  try {
    if (!hadGraphifyOutput || isGraphifyStale(workspaceRoot)) {
      await runGraphify(workspaceRoot, hadGraphifyOutput);
      graphifyReady = true;
      graphifyRefreshed = true;
    } else {
      await syncGraphifyKnowledgeBase(workspaceRoot);
      graphifyReady = true;
    }
  } catch (error) {
    graphifyReady = hasGraphifyOutput(workspaceRoot);
    graphifyError = error instanceof Error ? error.message : String(error);
  }

  return {
    workspaceRoot,
    serenaConfigCreated: serena.configCreated,
    serenaLocalConfigCreated: serena.localConfigCreated,
    serenaConfigPath: serena.configPath,
    serenaLocalConfigPath: serena.localConfigPath,
    serenaMemoriesDir: serena.memoriesDir,
    graphifyReady,
    graphifyRefreshed,
    graphifyError,
    codexInitialPrompt: buildCodexWorkflowPrompt(graphifyReady),
  };
}

function ensureSerenaWorkflow(workspaceRoot: string): {
  configCreated: boolean;
  localConfigCreated: boolean;
  configPath: string;
  localConfigPath: string;
  memoriesDir: string;
} {
  const serenaDir = path.join(workspaceRoot, '.serena');
  const configPath = path.join(serenaDir, 'project.yml');
  const localConfigPath = path.join(serenaDir, 'project.local.yml');
  const memoriesDir = path.join(serenaDir, 'memories');

  fs.mkdirSync(memoriesDir, { recursive: true });

  let configCreated = false;
  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, buildSerenaProjectTemplate(workspaceRoot), 'utf-8');
    configCreated = true;
  }

  let localConfigCreated = false;
  if (!fs.existsSync(localConfigPath)) {
    fs.writeFileSync(localConfigPath, buildSerenaLocalTemplate(), 'utf-8');
    localConfigCreated = true;
  }

  return {
    configCreated,
    localConfigCreated,
    configPath,
    localConfigPath,
    memoriesDir,
  };
}

function buildSerenaProjectTemplate(workspaceRoot: string): string {
  const projectName = path.basename(workspaceRoot) || 'workspace';
  const languages = inferSerenaLanguages(workspaceRoot);
  const languageLines = languages.map((language) => `  - ${language}`).join('\n');

  return [
    `project_name: "${escapeYamlString(projectName)}"`,
    '',
    'languages:',
    languageLines,
    '',
    'encoding: "utf-8"',
    'line_ending:',
    'ignore_all_files_in_gitignore: true',
    'ls_specific_settings: {}',
    'ignored_paths:',
    '  - graphify-out/**',
    'read_only: false',
    'excluded_tools: []',
    'included_optional_tools: []',
    'fixed_tools: []',
    'initial_prompt: ""',
    '',
  ].join('\n');
}

function buildSerenaLocalTemplate(): string {
  return [
    '# Local Serena overrides for this workspace.',
    '# Add only settings that should stay machine-specific.',
    '',
  ].join('\n');
}

function inferSerenaLanguages(workspaceRoot: string): string[] {
  const counts = new Map<string, number>();
  const stack = [workspaceRoot];
  let scannedFiles = 0;

  while (stack.length > 0 && scannedFiles < MAX_LANGUAGE_SCAN_FILES) {
    const currentDir = stack.pop();
    if (!currentDir) continue;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.name !== '.serena') continue;
      const absolutePath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        if (WORKFLOW_IGNORE_DIRS.has(entry.name)) continue;
        stack.push(absolutePath);
        continue;
      }

      if (!entry.isFile()) continue;
      scannedFiles += 1;
      const ext = path.extname(entry.name).toLowerCase();
      const language = EXTENSION_LANGUAGE_MAP.get(ext);
      if (language) {
        counts.set(language, (counts.get(language) ?? 0) + 1);
      }
      if (scannedFiles >= MAX_LANGUAGE_SCAN_FILES) {
        break;
      }
    }
  }

  if (counts.size === 0) {
    return ['typescript'];
  }

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 3)
    .map(([language]) => language);
}

function buildCodexWorkflowPrompt(graphifyReady: boolean): string {
  if (graphifyReady) {
    return [
      'Use Graphify and Serena as the default repo workflow for this session.',
      'Read graphify-out/AGENT_KNOWLEDGE_BASE.md first, then graphify-out/GRAPH_REPORT.md, then graphify-out/graph.json.',
      'Treat Graphify output as the primary repo memory layer.',
      'Use .serena/project.yml and .serena/memories only as fallback when the graph or knowledge base is insufficient.',
      'Keep that retrieval order throughout the session.',
    ].join(' ');
  }

  return [
    'Use Graphify and Serena as the default repo workflow for this session.',
    'Graphify could not be refreshed automatically here, so use any existing graphify-out files first when present.',
    'If graphify-out is unavailable, rely on .serena/project.yml and .serena/memories as the repo memory layer until Graphify is available again.',
    'Once Graphify is available, switch back to graphify-out/AGENT_KNOWLEDGE_BASE.md, then graphify-out/GRAPH_REPORT.md, then graphify-out/graph.json as the primary retrieval path.',
  ].join(' ');
}

function escapeYamlString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
