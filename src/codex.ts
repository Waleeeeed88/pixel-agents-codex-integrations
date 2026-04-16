import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  BASH_COMMAND_DISPLAY_MAX_LENGTH,
  GLOBAL_SCAN_ACTIVE_MAX_AGE_MS,
  TASK_DESCRIPTION_DISPLAY_MAX_LENGTH,
} from '../server/src/constants.js';

export interface CodexSessionMeta {
  filePath: string;
  sessionId: string;
  cwd: string;
  startedAt: number;
  source?: string;
  mtimeMs: number;
}

const CODEX_RECORD_TYPES = new Set(['session_meta', 'event_msg', 'response_item', 'turn_context']);

export function getCodexSessionsRoot(): string {
  return path.join(os.homedir(), '.codex', 'sessions');
}

export function isCodexRecord(record: unknown): boolean {
  if (!record || typeof record !== 'object') return false;
  const type = (record as { type?: unknown }).type;
  return typeof type === 'string' && CODEX_RECORD_TYPES.has(type);
}

export function normalizePath(filePath: string): string {
  return path.resolve(filePath).replace(/\\/g, '/').toLowerCase();
}

export function arePathsEqual(a: string, b: string): boolean {
  return normalizePath(a) === normalizePath(b);
}

export function isPathWithin(childPath: string, parentPath: string): boolean {
  const child = normalizePath(childPath);
  const parent = normalizePath(parentPath).replace(/\/+$/, '');
  return child === parent || child.startsWith(`${parent}/`);
}

export function getFolderNameFromCwd(cwd: string): string | undefined {
  const trimmed = cwd.trim();
  if (!trimmed) return undefined;
  return path.basename(trimmed) || trimmed;
}

export function listRecentCodexSessionFiles(limit = 200): string[] {
  const root = getCodexSessionsRoot();
  const files: Array<{ filePath: string; mtimeMs: number }> = [];

  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (!entry.isFile() || !fullPath.endsWith('.jsonl')) continue;
      try {
        files.push({ filePath: fullPath, mtimeMs: fs.statSync(fullPath).mtimeMs });
      } catch {
        // Ignore files that disappear mid-scan.
      }
    }
  };

  walk(root);
  files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return files.slice(0, limit).map((entry) => entry.filePath);
}

export function readCodexSessionMeta(filePath: string): CodexSessionMeta | null {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return null;
  }

  const buffer = Buffer.alloc(8192);
  let bytesRead = 0;
  let fd: number | null = null;
  try {
    fd = fs.openSync(filePath, 'r');
    bytesRead = fs.readSync(fd, buffer, 0, buffer.length, 0);
  } catch {
    return null;
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        // Ignore close failures.
      }
    }
  }

  const firstLine = buffer
    .toString('utf8', 0, bytesRead)
    .split(/\r?\n/)
    .find((line) => line.trim().length > 0);
  if (!firstLine) return null;

  let record: unknown;
  try {
    record = JSON.parse(firstLine);
  } catch {
    return null;
  }
  if (!isCodexRecord(record)) return null;

  const typedRecord = record as {
    timestamp?: unknown;
    type?: unknown;
    payload?: {
      id?: unknown;
      timestamp?: unknown;
      cwd?: unknown;
      source?: unknown;
    };
  };
  if (typedRecord.type !== 'session_meta') return null;

  const sessionId = typedRecord.payload?.id;
  const cwd = typedRecord.payload?.cwd;
  if (typeof sessionId !== 'string' || typeof cwd !== 'string') return null;

  const timestampValue =
    typeof typedRecord.payload?.timestamp === 'string'
      ? typedRecord.payload.timestamp
      : typeof typedRecord.timestamp === 'string'
        ? typedRecord.timestamp
        : undefined;
  const startedAt = timestampValue ? Date.parse(timestampValue) : Number.NaN;

  return {
    filePath,
    sessionId,
    cwd,
    startedAt: Number.isFinite(startedAt) ? startedAt : stat.mtimeMs,
    source:
      typeof typedRecord.payload?.source === 'string' ? typedRecord.payload.source : undefined,
    mtimeMs: stat.mtimeMs,
  };
}

export function findLatestCodexSessionForCwd(
  cwd: string,
  trackedFiles: Set<string>,
  minStartedAt: number,
): CodexSessionMeta | null {
  for (const filePath of listRecentCodexSessionFiles()) {
    if (trackedFiles.has(normalizePath(filePath))) continue;
    const meta = readCodexSessionMeta(filePath);
    if (!meta) continue;
    if (!arePathsEqual(meta.cwd, cwd)) continue;
    if (meta.startedAt + 15_000 < minStartedAt) continue;
    return meta;
  }
  return null;
}

export function listActiveCodexSessions(
  trackedFiles: Set<string>,
  workspaceDirs: string[],
  watchAllSessions: boolean,
): CodexSessionMeta[] {
  const now = Date.now();
  const matchesWorkspace = (cwd: string) =>
    watchAllSessions || workspaceDirs.some((workspaceDir) => isPathWithin(cwd, workspaceDir));

  const sessions: CodexSessionMeta[] = [];
  for (const filePath of listRecentCodexSessionFiles()) {
    if (trackedFiles.has(normalizePath(filePath))) continue;
    const meta = readCodexSessionMeta(filePath);
    if (!meta) continue;
    if (!matchesWorkspace(meta.cwd)) continue;
    if (now - meta.mtimeMs > GLOBAL_SCAN_ACTIVE_MAX_AGE_MS) continue;
    sessions.push(meta);
  }

  sessions.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return sessions;
}

export function parseCodexToolArguments(
  rawArguments: string | Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!rawArguments) return {};
  if (typeof rawArguments !== 'string') return rawArguments;
  try {
    const parsed = JSON.parse(rawArguments);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function formatCodexToolStatus(
  toolName: string,
  rawArguments: string | Record<string, unknown> | undefined,
): string {
  const input = parseCodexToolArguments(rawArguments);

  switch (toolName) {
    case 'shell_command': {
      const command = typeof input.command === 'string' ? input.command : '';
      const clipped =
        command.length > BASH_COMMAND_DISPLAY_MAX_LENGTH
          ? `${command.slice(0, BASH_COMMAND_DISPLAY_MAX_LENGTH)}...`
          : command;
      return command ? `Running: ${clipped}` : 'Running command';
    }
    case 'multi_tool_use.parallel':
      return 'Running tools in parallel';
    case 'spawn_agent': {
      const message = typeof input.message === 'string' ? input.message : '';
      return message
        ? `Subtask: ${message.length > TASK_DESCRIPTION_DISPLAY_MAX_LENGTH ? `${message.slice(0, TASK_DESCRIPTION_DISPLAY_MAX_LENGTH)}...` : message}`
        : 'Subtask: Delegated task';
    }
    case 'wait_agent':
      return 'Waiting on agent';
    case 'send_input':
      return 'Sending follow-up';
    case 'web_search':
      return 'Searching the web';
    default:
      return `Using ${humanizeToolName(toolName)}`;
  }
}

export function normalizeCodexToolName(toolName: string): string {
  switch (toolName) {
    case 'spawn_agent':
      return 'Agent';
    default:
      return toolName;
  }
}

function humanizeToolName(toolName: string): string {
  return toolName.replace(/[._]+/g, ' ').replace(/\b\w/g, (match) => match.toUpperCase());
}
