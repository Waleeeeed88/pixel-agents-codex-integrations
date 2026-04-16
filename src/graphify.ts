import * as childProcess from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export interface GraphifyPaths {
  outputDir: string;
  graphPath: string;
  htmlPath: string;
  reportPath: string;
  knowledgeBasePath: string;
  knowledgeBaseJsonPath: string;
}

export interface GraphifySummary extends GraphifyPaths {
  workspaceRoot: string;
  nodeCount: number;
  edgeCount: number;
  communityCount: number;
  reportExcerpt: string[];
  knowledgeBaseExcerpt: string[];
  updatedAt: number | null;
  requiresSemanticRefresh: boolean;
  serenaMemoryCount: number;
  hasSerenaConfig: boolean;
}

interface GraphifyCommand {
  command: string;
  buildArgs: (workspaceRoot: string, updateOnly: boolean) => string[];
}

interface GraphifyRunResult {
  stdout: string;
  stderr: string;
}

interface GraphNodeRecord {
  id: string;
  label?: string;
  community?: string | number;
  source_file?: string;
}

interface GraphLinkRecord {
  source: string;
  target: string;
}

interface WorkspaceKnowledgeInputs {
  keyDocs: string[];
  serenaMemoryFiles: string[];
  hasSerenaConfig: boolean;
  latestCodeAt: number | null;
  latestSemanticAt: number | null;
}

interface GraphifyFreshness {
  latestOutputAt: number | null;
  latestGraphAt: number | null;
  codeStale: boolean;
  requiresSemanticRefresh: boolean;
}

const GRAPHIFY_COMMANDS: GraphifyCommand[] = [
  {
    command: 'graphify',
    buildArgs: (workspaceRoot) => ['update', workspaceRoot],
  },
  {
    command: 'graphify',
    buildArgs: (workspaceRoot, updateOnly) =>
      updateOnly ? [workspaceRoot, '--update'] : [workspaceRoot],
  },
  {
    command: 'py',
    buildArgs: (workspaceRoot) => ['-m', 'graphify', 'update', workspaceRoot],
  },
  {
    command: 'python',
    buildArgs: (workspaceRoot) => ['-m', 'graphify', 'update', workspaceRoot],
  },
  {
    command: 'python3',
    buildArgs: (workspaceRoot) => ['-m', 'graphify', 'update', workspaceRoot],
  },
];

const PYTHON_COMMANDS = ['py', 'python', 'python3'];
const GRAPHIFY_OUTPUT_FILES: Array<keyof GraphifyPaths> = [
  'graphPath',
  'htmlPath',
  'reportPath',
  'knowledgeBasePath',
  'knowledgeBaseJsonPath',
];
const WORKSPACE_IGNORE_DIRS = new Set([
  '.git',
  '.next',
  '.turbo',
  '.vercel',
  'coverage',
  'dist',
  'graphify-out',
  'node_modules',
  'out',
  'test-results',
  'playwright-report',
]);
const CODE_EXTENSIONS = new Set([
  '.cjs',
  '.css',
  '.cts',
  '.go',
  '.java',
  '.js',
  '.json',
  '.jsx',
  '.mjs',
  '.py',
  '.rs',
  '.scss',
  '.sh',
  '.sql',
  '.ts',
  '.tsx',
  '.vue',
  '.yaml',
  '.yml',
]);
const SEMANTIC_EXTENSIONS = new Set([
  '.gif',
  '.jpeg',
  '.jpg',
  '.md',
  '.pdf',
  '.png',
  '.svg',
  '.txt',
  '.webp',
]);

export function getGraphifyPaths(workspaceRoot: string): GraphifyPaths {
  const outputDir = path.join(workspaceRoot, 'graphify-out');
  return {
    outputDir,
    graphPath: path.join(outputDir, 'graph.json'),
    htmlPath: path.join(outputDir, 'graph.html'),
    reportPath: path.join(outputDir, 'GRAPH_REPORT.md'),
    knowledgeBasePath: path.join(outputDir, 'AGENT_KNOWLEDGE_BASE.md'),
    knowledgeBaseJsonPath: path.join(outputDir, 'agent-knowledge-base.json'),
  };
}

export function hasGraphifyOutput(workspaceRoot: string): boolean {
  const paths = getGraphifyPaths(workspaceRoot);
  return (
    fs.existsSync(paths.graphPath) &&
    fs.existsSync(paths.htmlPath) &&
    fs.existsSync(paths.reportPath)
  );
}

export function isGraphifyStale(workspaceRoot: string): boolean {
  const freshness = getGraphifyFreshness(workspaceRoot);
  return !freshness.latestOutputAt || freshness.codeStale;
}

export async function syncGraphifyKnowledgeBase(workspaceRoot: string): Promise<void> {
  const paths = getGraphifyPaths(workspaceRoot);
  fs.mkdirSync(paths.outputDir, { recursive: true });
  await buildKnowledgeBase(workspaceRoot);
}

export function readGraphifySummary(workspaceRoot: string): GraphifySummary {
  const paths = getGraphifyPaths(workspaceRoot);
  const knowledgeInputs = collectWorkspaceKnowledgeInputs(workspaceRoot);
  const freshness = getGraphifyFreshness(workspaceRoot, knowledgeInputs);
  const summary: GraphifySummary = {
    workspaceRoot,
    ...paths,
    nodeCount: 0,
    edgeCount: 0,
    communityCount: 0,
    reportExcerpt: [],
    knowledgeBaseExcerpt: [],
    updatedAt: freshness.latestOutputAt,
    requiresSemanticRefresh: freshness.requiresSemanticRefresh,
    serenaMemoryCount: knowledgeInputs.serenaMemoryFiles.length,
    hasSerenaConfig: knowledgeInputs.hasSerenaConfig,
  };

  try {
    if (fs.existsSync(paths.graphPath)) {
      const graph = readGraphData(paths.graphPath);
      summary.nodeCount = graph.nodes.length;
      summary.edgeCount = graph.links.length;
      summary.communityCount = getCommunityCount(graph.nodes);
    }
  } catch {
    // Keep zero-value graph summary when graph.json is malformed or partial.
  }

  summary.reportExcerpt = readExcerpt(paths.reportPath);
  summary.knowledgeBaseExcerpt = readExcerpt(paths.knowledgeBasePath);

  return summary;
}

export async function runGraphify(
  workspaceRoot: string,
  updateOnly: boolean,
): Promise<GraphifyRunResult> {
  fs.mkdirSync(getGraphifyPaths(workspaceRoot).outputDir, { recursive: true });

  const attempted: string[] = [];
  let lastFailure = '';

  for (const candidate of GRAPHIFY_COMMANDS) {
    const args = candidate.buildArgs(workspaceRoot, updateOnly);
    attempted.push([candidate.command, ...args].join(' '));

    try {
      const result = await spawnProcess(candidate.command, args, workspaceRoot);
      await exportGraphifyHtml(workspaceRoot);
      await buildKnowledgeBase(workspaceRoot);
      return result;
    } catch (error) {
      lastFailure = error instanceof Error ? error.message : String(error);
    }
  }

  const installHint =
    'Install graphifyy first, then retry. Example: `python -m pip install graphifyy`.';
  throw new Error(
    `Unable to run Graphify.\nTried:\n- ${attempted.join('\n- ')}\n\n${lastFailure}\n\n${installHint}`,
  );
}

function readGraphData(graphPath: string): { nodes: GraphNodeRecord[]; links: GraphLinkRecord[] } {
  const raw = fs.readFileSync(graphPath, 'utf-8');
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const nodes = Array.isArray(parsed.nodes) ? (parsed.nodes as GraphNodeRecord[]) : [];
  const links = Array.isArray(parsed.links)
    ? (parsed.links as GraphLinkRecord[])
    : Array.isArray(parsed.edges)
      ? (parsed.edges as GraphLinkRecord[])
      : [];
  return { nodes, links };
}

function readExcerpt(filePath: string): string[] {
  try {
    if (!fs.existsSync(filePath)) return [];
    return fs
      .readFileSync(filePath, 'utf-8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'))
      .slice(0, 5);
  } catch {
    return [];
  }
}

function getCommunityCount(nodes: GraphNodeRecord[]): number {
  const seen = new Set<string>();
  for (const node of nodes) {
    if (typeof node.community === 'string' || typeof node.community === 'number') {
      seen.add(String(node.community));
    }
  }
  return seen.size;
}

function getGraphifyFreshness(
  workspaceRoot: string,
  knowledgeInputs?: WorkspaceKnowledgeInputs,
): GraphifyFreshness {
  const paths = getGraphifyPaths(workspaceRoot);
  const latestOutputAt = GRAPHIFY_OUTPUT_FILES.map((key) => paths[key])
    .filter((filePath) => fs.existsSync(filePath))
    .map((filePath) => fs.statSync(filePath).mtimeMs)
    .reduce<number | null>(
      (latest, current) => (latest === null ? current : Math.max(latest, current)),
      null,
    );
  const latestGraphAt = [paths.graphPath, paths.htmlPath, paths.reportPath]
    .filter((filePath) => fs.existsSync(filePath))
    .map((filePath) => fs.statSync(filePath).mtimeMs)
    .reduce<number | null>(
      (latest, current) => (latest === null ? current : Math.max(latest, current)),
      null,
    );

  const inputs = knowledgeInputs ?? collectWorkspaceKnowledgeInputs(workspaceRoot);
  return {
    latestOutputAt,
    latestGraphAt,
    codeStale: latestGraphAt === null || (inputs.latestCodeAt ?? 0) > latestGraphAt,
    requiresSemanticRefresh:
      latestGraphAt === null || (inputs.latestSemanticAt ?? 0) > latestGraphAt,
  };
}

function collectWorkspaceKnowledgeInputs(workspaceRoot: string): WorkspaceKnowledgeInputs {
  const keyDocs = new Set<string>();
  const serenaMemoryFiles: string[] = [];
  let latestCodeAt: number | null = null;
  let latestSemanticAt: number | null = null;

  const rememberDoc = (relativePath: string): void => {
    keyDocs.add(relativePath.replace(/\\/g, '/'));
  };

  const walk = (absoluteDir: string, relativeDir = ''): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(absoluteDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.name !== '.serena') continue;
      const absolutePath = path.join(absoluteDir, entry.name);
      const relativePath = relativeDir ? path.join(relativeDir, entry.name) : entry.name;

      if (entry.isDirectory()) {
        if (WORKSPACE_IGNORE_DIRS.has(entry.name)) continue;
        if (relativePath === path.join('.serena', 'cache')) continue;
        walk(absolutePath, relativePath);
        continue;
      }

      if (!entry.isFile()) continue;

      let stat: fs.Stats;
      try {
        stat = fs.statSync(absolutePath);
      } catch {
        continue;
      }

      const ext = path.extname(entry.name).toLowerCase();
      const normalizedRelative = relativePath.replace(/\\/g, '/');

      if (normalizedRelative.startsWith('.serena/memories/')) {
        serenaMemoryFiles.push(normalizedRelative);
        latestSemanticAt =
          latestSemanticAt === null ? stat.mtimeMs : Math.max(latestSemanticAt, stat.mtimeMs);
        continue;
      }

      if (CODE_EXTENSIONS.has(ext)) {
        latestCodeAt = latestCodeAt === null ? stat.mtimeMs : Math.max(latestCodeAt, stat.mtimeMs);
      }
      if (SEMANTIC_EXTENSIONS.has(ext)) {
        latestSemanticAt =
          latestSemanticAt === null ? stat.mtimeMs : Math.max(latestSemanticAt, stat.mtimeMs);
      }

      if (
        normalizedRelative === 'README.md' ||
        normalizedRelative === 'CLAUDE.md' ||
        normalizedRelative === 'AGENTS.md' ||
        normalizedRelative === '.serena/project.yml' ||
        normalizedRelative === '.serena/project.local.yml' ||
        normalizedRelative.startsWith('docs/')
      ) {
        rememberDoc(normalizedRelative);
      }
    }
  };

  walk(workspaceRoot);

  return {
    keyDocs: [...keyDocs].sort(),
    serenaMemoryFiles: serenaMemoryFiles.sort(),
    hasSerenaConfig:
      fs.existsSync(path.join(workspaceRoot, '.serena', 'project.yml')) ||
      fs.existsSync(path.join(workspaceRoot, '.serena', 'project.local.yml')),
    latestCodeAt,
    latestSemanticAt,
  };
}

function spawnProcess(
  command: string,
  args: string[],
  workspaceRoot: string,
): Promise<GraphifyRunResult> {
  return new Promise((resolve, reject) => {
    const child = childProcess.spawn(command, args, {
      cwd: workspaceRoot,
      shell: false,
      windowsHide: true,
      env: process.env,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => reject(error));
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      const message = [stdout.trim(), stderr.trim()].filter(Boolean).join('\n').trim();
      reject(new Error(message || `${command} exited with code ${code ?? 'unknown'}.`));
    });
  });
}

async function exportGraphifyHtml(workspaceRoot: string): Promise<void> {
  const script = [
    'import json',
    'from pathlib import Path',
    'import networkx as nx',
    'from graphify.export import to_html',
    '',
    "graph_path = Path('graphify-out/graph.json')",
    "data = json.loads(graph_path.read_text(encoding='utf-8'))",
    "G = nx.node_link_graph(data, edges='links')",
    'communities = {}',
    'for node_id, attrs in G.nodes(data=True):',
    "    cid = attrs.get('community', 0)",
    '    try:',
    '        cid = int(cid)',
    '    except Exception:',
    '        cid = 0',
    '    communities.setdefault(cid, []).append(node_id)',
    "to_html(G, communities, 'graphify-out/graph.html')",
  ].join('\n');

  const attempted: string[] = [];
  let lastFailure = '';

  for (const command of PYTHON_COMMANDS) {
    attempted.push(`${command} -c <graphify export script>`);
    try {
      await spawnProcess(command, ['-c', script], workspaceRoot);
      return;
    } catch (error) {
      lastFailure = error instanceof Error ? error.message : String(error);
    }
  }

  throw new Error(
    `Graphify built the graph, but HTML export failed.\nTried:\n- ${attempted.join(
      '\n- ',
    )}\n\n${lastFailure}`,
  );
}

async function buildKnowledgeBase(workspaceRoot: string): Promise<void> {
  const paths = getGraphifyPaths(workspaceRoot);
  const knowledgeInputs = collectWorkspaceKnowledgeInputs(workspaceRoot);
  const freshness = getGraphifyFreshness(workspaceRoot, knowledgeInputs);
  const graphExists = fs.existsSync(paths.graphPath);

  let nodes: GraphNodeRecord[] = [];
  let links: GraphLinkRecord[] = [];
  if (graphExists) {
    try {
      const graph = readGraphData(paths.graphPath);
      nodes = graph.nodes;
      links = graph.links;
    } catch {
      nodes = [];
      links = [];
    }
  }

  const topNodes = getTopNodes(nodes, links, 10);
  const topCommunities = getTopCommunities(nodes, 10);
  const payload = {
    workspaceRoot,
    updatedAt: new Date().toISOString(),
    graph: {
      nodes: nodes.length,
      edges: links.length,
      communities: getCommunityCount(nodes),
      available: graphExists,
    },
    freshness: {
      latestOutputAt: freshness.latestOutputAt,
      latestGraphAt: freshness.latestGraphAt,
      codeStale: freshness.codeStale,
      requiresSemanticRefresh: freshness.requiresSemanticRefresh,
    },
    knowledgeSources: {
      keyDocs: knowledgeInputs.keyDocs,
      serena: {
        hasConfig: knowledgeInputs.hasSerenaConfig,
        memoryFiles: knowledgeInputs.serenaMemoryFiles,
      },
    },
    topNodes,
    topCommunities,
  };

  fs.writeFileSync(paths.knowledgeBaseJsonPath, JSON.stringify(payload, null, 2), 'utf-8');
  fs.writeFileSync(paths.knowledgeBasePath, renderKnowledgeBaseMarkdown(payload), 'utf-8');
}

function getTopNodes(
  nodes: GraphNodeRecord[],
  links: GraphLinkRecord[],
  limit: number,
): Array<{ id: string; label: string; degree: number; sourceFile: string | null }> {
  const degree = new Map<string, number>();
  for (const link of links) {
    degree.set(link.source, (degree.get(link.source) ?? 0) + 1);
    degree.set(link.target, (degree.get(link.target) ?? 0) + 1);
  }

  return [...nodes]
    .sort((left, right) => (degree.get(right.id) ?? 0) - (degree.get(left.id) ?? 0))
    .slice(0, limit)
    .map((node) => ({
      id: node.id,
      label: node.label ?? node.id,
      degree: degree.get(node.id) ?? 0,
      sourceFile: node.source_file ?? null,
    }));
}

function getTopCommunities(
  nodes: GraphNodeRecord[],
  limit: number,
): Array<{ community: string; size: number; sampleLabels: string[] }> {
  const grouped = new Map<string, GraphNodeRecord[]>();
  for (const node of nodes) {
    const key =
      typeof node.community === 'string' || typeof node.community === 'number'
        ? String(node.community)
        : 'unassigned';
    const list = grouped.get(key);
    if (list) {
      list.push(node);
    } else {
      grouped.set(key, [node]);
    }
  }

  return [...grouped.entries()]
    .sort((left, right) => right[1].length - left[1].length)
    .slice(0, limit)
    .map(([community, group]) => ({
      community,
      size: group.length,
      sampleLabels: group
        .slice(0, 4)
        .map((node) => node.label ?? node.id)
        .filter(Boolean),
    }));
}

function renderKnowledgeBaseMarkdown(payload: {
  workspaceRoot: string;
  updatedAt: string;
  graph: { nodes: number; edges: number; communities: number; available: boolean };
  freshness: {
    latestOutputAt: number | null;
    latestGraphAt: number | null;
    codeStale: boolean;
    requiresSemanticRefresh: boolean;
  };
  knowledgeSources: {
    keyDocs: string[];
    serena: { hasConfig: boolean; memoryFiles: string[] };
  };
  topNodes: Array<{ id: string; label: string; degree: number; sourceFile: string | null }>;
  topCommunities: Array<{ community: string; size: number; sampleLabels: string[] }>;
}): string {
  const lines: string[] = [];
  lines.push('# Agent Knowledge Base');
  lines.push('');
  lines.push(
    'This is the native low-token retrieval surface for Codex agents in this repository. Read this before broad repo searches.',
  );
  lines.push('');
  lines.push('## Retrieval Order');
  lines.push('');
  lines.push('1. `graphify-out/AGENT_KNOWLEDGE_BASE.md`');
  lines.push('2. `graphify-out/GRAPH_REPORT.md`');
  lines.push('3. `graphify-out/graph.json`');
  if (payload.knowledgeSources.serena.hasConfig) {
    lines.push(
      '4. `.serena/project.yml` and `.serena/memories/*` only if the graph/KB is not enough',
    );
  }
  lines.push('');
  lines.push('## Snapshot');
  lines.push('');
  lines.push(`- Updated: ${payload.updatedAt}`);
  lines.push(`- Graph available: ${payload.graph.available ? 'yes' : 'no'}`);
  lines.push(
    `- Graph stats: ${payload.graph.nodes} nodes, ${payload.graph.edges} edges, ${payload.graph.communities} communities`,
  );
  lines.push(`- Code graph stale: ${payload.freshness.codeStale ? 'yes' : 'no'}`);
  lines.push(
    `- Deep semantic refresh needed: ${payload.freshness.requiresSemanticRefresh ? 'yes' : 'no'}`,
  );
  lines.push('');
  lines.push('## Recommended Retrieval');
  lines.push('');
  lines.push(
    '- Use graph communities and top hubs to split parallel work by subsystem instead of sending the same file context to multiple agents.',
  );
  lines.push(
    '- If deep semantic refresh is needed, run `/graphify --update` in an AI assistant before relying on docs/images/papers in the graph.',
  );
  if (payload.knowledgeSources.serena.hasConfig) {
    lines.push(
      '- Serena project config exists, but it is a fallback layer. Stay on the graph/KB path unless you specifically need symbol-aware memory.',
    );
  }
  lines.push('');
  lines.push('## Key Docs');
  lines.push('');
  if (payload.knowledgeSources.keyDocs.length > 0) {
    for (const doc of payload.knowledgeSources.keyDocs.slice(0, 12)) {
      lines.push(`- \`${doc}\``);
    }
  } else {
    lines.push('- No indexed key docs found.');
  }
  lines.push('');
  lines.push('## Top Hubs');
  lines.push('');
  if (payload.topNodes.length > 0) {
    for (const node of payload.topNodes) {
      const sourceSuffix = node.sourceFile ? ` · \`${node.sourceFile}\`` : '';
      lines.push(`- ${node.label} (${node.degree})${sourceSuffix}`);
    }
  } else {
    lines.push('- Graph not built yet.');
  }
  lines.push('');
  lines.push('## Largest Communities');
  lines.push('');
  if (payload.topCommunities.length > 0) {
    for (const community of payload.topCommunities) {
      lines.push(
        `- Community ${community.community}: ${community.size} nodes · ${community.sampleLabels.join(', ')}`,
      );
    }
  } else {
    lines.push('- Graph not built yet.');
  }
  lines.push('');
  lines.push('## Serena Memory Index');
  lines.push('');
  if (payload.knowledgeSources.serena.memoryFiles.length > 0) {
    for (const file of payload.knowledgeSources.serena.memoryFiles.slice(0, 20)) {
      lines.push(`- \`${file}\``);
    }
  } else if (payload.knowledgeSources.serena.hasConfig) {
    lines.push(
      '- Serena is configured, but no project memory files are present yet. Do not reopen it by default.',
    );
  } else {
    lines.push('- Serena project config not detected.');
  }
  lines.push('');

  return lines.join('\n');
}
