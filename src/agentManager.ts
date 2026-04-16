import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

import { JSONL_POLL_INTERVAL_MS } from '../server/src/constants.js';
import {
  findLatestCodexSessionForCwd,
  getCodexSessionsRoot,
  getFolderNameFromCwd,
  normalizePath,
  readCodexSessionMeta,
} from './codex.js';
import {
  TERMINAL_NAME_PREFIX,
  WORKSPACE_KEY_AGENT_SEATS,
  WORKSPACE_KEY_AGENTS,
} from './constants.js';
import { readNewLines, startFileWatching } from './fileWatcher.js';
import { migrateAndLoadLayout } from './layoutPersistence.js';
import { cancelPermissionTimer, cancelWaitingTimer } from './timerManager.js';
import type { AgentState, PersistedAgent } from './types.js';

export function getProjectDirPath(cwd?: string): string {
  return cwd || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || os.homedir();
}

export async function launchNewTerminal(
  nextAgentIdRef: { current: number },
  nextTerminalIndexRef: { current: number },
  agents: Map<number, AgentState>,
  activeAgentIdRef: { current: number | null },
  knownJsonlFiles: Set<string>,
  fileWatchers: Map<number, fs.FSWatcher>,
  pollingTimers: Map<number, ReturnType<typeof setInterval>>,
  waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
  permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
  jsonlPollTimers: Map<number, ReturnType<typeof setInterval>>,
  _projectScanTimerRef: { current: ReturnType<typeof setInterval> | null },
  webview: vscode.Webview | undefined,
  persistAgentsCallback: () => void,
  folderPath?: string,
  bypassPermissions?: boolean,
  initialPrompt?: string,
): Promise<void> {
  const folders = vscode.workspace.workspaceFolders;
  const cwd = folderPath || folders?.[0]?.uri.fsPath || os.homedir();
  const isMultiRoot = !!(folders && folders.length > 1);
  const idx = nextTerminalIndexRef.current++;
  const terminal = vscode.window.createTerminal({
    name: `${TERMINAL_NAME_PREFIX} #${idx}`,
    cwd,
  });
  terminal.show();

  const codexCmd = buildCodexLaunchCommand(bypassPermissions, initialPrompt);
  terminal.sendText(codexCmd);

  const id = nextAgentIdRef.current++;
  const folderName = isMultiRoot ? getFolderNameFromCwd(cwd) : undefined;
  const agent: AgentState = {
    id,
    sessionId: `pending-${Date.now()}-${id}`,
    terminalRef: terminal,
    isExternal: false,
    projectDir: cwd,
    jsonlFile: '',
    fileOffset: 0,
    lineBuffer: '',
    activeToolIds: new Set(),
    activeToolStatuses: new Map(),
    activeToolNames: new Map(),
    codexToolArgumentsById: new Map(),
    activeSubagentToolIds: new Map(),
    activeSubagentToolNames: new Map(),
    backgroundAgentToolIds: new Set(),
    codexSpawnedAgentsByToolId: new Map(),
    codexSpawnedToolIdByAgentId: new Map(),
    isWaiting: false,
    permissionSent: false,
    hadToolsInTurn: false,
    lastDataAt: 0,
    linesProcessed: 0,
    seenUnknownRecordTypes: new Set(),
    folderName,
    hookDelivered: false,
    providerId: 'codex',
    inputTokens: 0,
    outputTokens: 0,
  };

  agents.set(id, agent);
  activeAgentIdRef.current = id;
  persistAgentsCallback();
  webview?.postMessage({ type: 'agentCreated', id, folderName });

  const createdAt = Date.now();
  let pollCount = 0;
  const pollTimer = setInterval(() => {
    const liveAgent = agents.get(id);
    if (!liveAgent) {
      clearInterval(pollTimer);
      jsonlPollTimers.delete(id);
      return;
    }

    pollCount++;

    const trackedFiles = new Set<string>();
    for (const trackedFile of knownJsonlFiles) {
      trackedFiles.add(normalizePath(trackedFile));
    }
    for (const otherAgent of agents.values()) {
      if (otherAgent.id !== id && otherAgent.jsonlFile) {
        trackedFiles.add(normalizePath(otherAgent.jsonlFile));
      }
    }

    const attachedSession = findLatestCodexSessionForCwd(cwd, trackedFiles, createdAt);
    if (attachedSession) {
      clearInterval(pollTimer);
      jsonlPollTimers.delete(id);

      liveAgent.sessionId = attachedSession.sessionId;
      liveAgent.projectDir = attachedSession.cwd;
      liveAgent.jsonlFile = attachedSession.filePath;
      knownJsonlFiles.add(attachedSession.filePath);
      persistAgentsCallback();

      console.log(
        `[Pixel Agents] Terminal: Agent ${id} attached to Codex session ${attachedSession.sessionId}`,
      );

      startFileWatching(
        id,
        attachedSession.filePath,
        agents,
        fileWatchers,
        pollingTimers,
        waitingTimers,
        permissionTimers,
        webview,
      );
      readNewLines(id, agents, waitingTimers, permissionTimers, webview);
      return;
    }

    if (pollCount === 10) {
      console.warn(
        `[Pixel Agents] Terminal: Agent ${id} has not attached to a Codex session after 10s. ` +
          `Watching ${getCodexSessionsRoot()} for cwd ${cwd}`,
      );
    }
  }, JSONL_POLL_INTERVAL_MS);
  jsonlPollTimers.set(id, pollTimer);
}

function buildCodexLaunchCommand(
  bypassPermissions: boolean | undefined,
  initialPrompt: string | undefined,
): string {
  const parts = ['codex'];
  if (bypassPermissions) {
    parts.push('--dangerously-bypass-approvals-and-sandbox');
  }
  if (initialPrompt && initialPrompt.trim().length > 0) {
    parts.push(quoteCodexPrompt(initialPrompt.trim()));
  }
  return parts.join(' ');
}

function quoteCodexPrompt(prompt: string): string {
  return `"${prompt.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export function removeAgent(
  agentId: number,
  agents: Map<number, AgentState>,
  fileWatchers: Map<number, fs.FSWatcher>,
  pollingTimers: Map<number, ReturnType<typeof setInterval>>,
  waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
  permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
  jsonlPollTimers: Map<number, ReturnType<typeof setInterval>>,
  persistAgentsCallback: () => void,
): void {
  const agent = agents.get(agentId);
  if (!agent) return;

  const jsonlPollTimer = jsonlPollTimers.get(agentId);
  if (jsonlPollTimer) {
    clearInterval(jsonlPollTimer);
  }
  jsonlPollTimers.delete(agentId);

  fileWatchers.get(agentId)?.close();
  fileWatchers.delete(agentId);

  const pollingTimer = pollingTimers.get(agentId);
  if (pollingTimer) {
    clearInterval(pollingTimer);
  }
  pollingTimers.delete(agentId);

  cancelWaitingTimer(agentId, waitingTimers);
  cancelPermissionTimer(agentId, permissionTimers);

  agents.delete(agentId);
  persistAgentsCallback();
}

export function persistAgents(
  agents: Map<number, AgentState>,
  context: vscode.ExtensionContext,
): void {
  const persisted: PersistedAgent[] = [];
  for (const agent of agents.values()) {
    if (!agent.jsonlFile && !agent.hooksOnly) continue;
    persisted.push({
      id: agent.id,
      sessionId: agent.sessionId,
      terminalName: agent.terminalRef?.name ?? '',
      isExternal: agent.isExternal || undefined,
      jsonlFile: agent.jsonlFile,
      projectDir: agent.projectDir,
      folderName: agent.folderName,
      providerId: agent.providerId,
      teamName: agent.teamName,
      agentName: agent.agentName,
      isTeamLead: agent.isTeamLead,
      leadAgentId: agent.leadAgentId,
      teamUsesTmux: agent.teamUsesTmux,
    });
  }
  context.workspaceState.update(WORKSPACE_KEY_AGENTS, persisted);
}

export function restoreAgents(
  context: vscode.ExtensionContext,
  nextAgentIdRef: { current: number },
  nextTerminalIndexRef: { current: number },
  agents: Map<number, AgentState>,
  knownJsonlFiles: Set<string>,
  fileWatchers: Map<number, fs.FSWatcher>,
  pollingTimers: Map<number, ReturnType<typeof setInterval>>,
  waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
  permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
  jsonlPollTimers: Map<number, ReturnType<typeof setInterval>>,
  _projectScanTimerRef: { current: ReturnType<typeof setInterval> | null },
  _activeAgentIdRef: { current: number | null },
  webview: vscode.Webview | undefined,
  persistAgentsCallback: () => void,
): void {
  const persisted = context.workspaceState.get<PersistedAgent[]>(WORKSPACE_KEY_AGENTS, []);
  if (persisted.length === 0) return;

  const liveTerminals = vscode.window.terminals;
  let maxId = 0;
  let maxIdx = 0;

  for (const persistedAgent of persisted) {
    if (agents.has(persistedAgent.id)) {
      if (persistedAgent.jsonlFile) {
        knownJsonlFiles.add(persistedAgent.jsonlFile);
      }
      continue;
    }

    let terminal: vscode.Terminal | undefined;
    const isExternal = persistedAgent.isExternal ?? false;

    if (isExternal) {
      if (!persistedAgent.jsonlFile) continue;
      try {
        if (!fs.existsSync(persistedAgent.jsonlFile)) continue;
      } catch {
        continue;
      }
    } else {
      terminal = liveTerminals.find((candidate) => candidate.name === persistedAgent.terminalName);
      if (!terminal) continue;
    }

    const inferredProvider = inferProviderId(
      persistedAgent.providerId,
      persistedAgent.jsonlFile,
      persistedAgent.projectDir,
    );
    const fallbackSessionId =
      persistedAgent.sessionId ||
      readCodexSessionMeta(persistedAgent.jsonlFile)?.sessionId ||
      path.basename(persistedAgent.jsonlFile, '.jsonl');

    const agent: AgentState = {
      id: persistedAgent.id,
      sessionId: fallbackSessionId,
      terminalRef: terminal,
      isExternal,
      projectDir: persistedAgent.projectDir,
      jsonlFile: persistedAgent.jsonlFile,
      fileOffset: 0,
      lineBuffer: '',
      activeToolIds: new Set(),
      activeToolStatuses: new Map(),
      activeToolNames: new Map(),
      codexToolArgumentsById: new Map(),
      activeSubagentToolIds: new Map(),
      activeSubagentToolNames: new Map(),
      backgroundAgentToolIds: new Set(),
      codexSpawnedAgentsByToolId: new Map(),
      codexSpawnedToolIdByAgentId: new Map(),
      isWaiting: false,
      permissionSent: false,
      hadToolsInTurn: false,
      lastDataAt: 0,
      linesProcessed: 0,
      seenUnknownRecordTypes: new Set(),
      folderName: persistedAgent.folderName,
      hookDelivered: false,
      providerId: inferredProvider,
      inputTokens: 0,
      outputTokens: 0,
      teamName: persistedAgent.teamName,
      agentName: persistedAgent.agentName,
      isTeamLead: persistedAgent.isTeamLead,
      leadAgentId: persistedAgent.leadAgentId,
      teamUsesTmux: persistedAgent.teamUsesTmux,
    };

    agents.set(persistedAgent.id, agent);
    if (persistedAgent.jsonlFile) {
      knownJsonlFiles.add(persistedAgent.jsonlFile);
    }

    if (persistedAgent.id > maxId) maxId = persistedAgent.id;
    const match = persistedAgent.terminalName.match(/#(\d+)$/);
    if (match) {
      const idx = parseInt(match[1], 10);
      if (idx > maxIdx) maxIdx = idx;
    }

    try {
      if (persistedAgent.jsonlFile && fs.existsSync(persistedAgent.jsonlFile)) {
        const stat = fs.statSync(persistedAgent.jsonlFile);
        agent.fileOffset = stat.size;
        startFileWatching(
          persistedAgent.id,
          persistedAgent.jsonlFile,
          agents,
          fileWatchers,
          pollingTimers,
          waitingTimers,
          permissionTimers,
          webview,
        );
      } else if (persistedAgent.jsonlFile) {
        const pollTimer = setInterval(() => {
          const liveAgent = agents.get(persistedAgent.id);
          if (!liveAgent) {
            clearInterval(pollTimer);
            jsonlPollTimers.delete(persistedAgent.id);
            return;
          }
          try {
            if (fs.existsSync(liveAgent.jsonlFile)) {
              clearInterval(pollTimer);
              jsonlPollTimers.delete(persistedAgent.id);
              const stat = fs.statSync(liveAgent.jsonlFile);
              liveAgent.fileOffset = stat.size;
              startFileWatching(
                persistedAgent.id,
                liveAgent.jsonlFile,
                agents,
                fileWatchers,
                pollingTimers,
                waitingTimers,
                permissionTimers,
                webview,
              );
            }
          } catch {
            // File may not exist yet.
          }
        }, JSONL_POLL_INTERVAL_MS);
        jsonlPollTimers.set(persistedAgent.id, pollTimer);
      }
    } catch {
      // Ignore restore-time file errors.
    }
  }

  const restoredTerminalIds = [...agents.entries()]
    .filter(([, agent]) => !agent.isExternal && agent.terminalRef)
    .map(([id]) => id);
  if (restoredTerminalIds.length > 0) {
    setTimeout(() => {
      for (const id of restoredTerminalIds) {
        const agent = agents.get(id);
        if (agent && !agent.isExternal && agent.linesProcessed === 0) {
          agent.terminalRef?.dispose();
          removeAgent(
            id,
            agents,
            fileWatchers,
            pollingTimers,
            waitingTimers,
            permissionTimers,
            jsonlPollTimers,
            persistAgentsCallback,
          );
          webview?.postMessage({ type: 'agentClosed', id });
        }
      }
    }, 10_000);
  }

  if (maxId >= nextAgentIdRef.current) {
    nextAgentIdRef.current = maxId + 1;
  }
  if (maxIdx >= nextTerminalIndexRef.current) {
    nextTerminalIndexRef.current = maxIdx + 1;
  }

  persistAgentsCallback();
}

export function sendExistingAgents(
  agents: Map<number, AgentState>,
  context: vscode.ExtensionContext,
  webview: vscode.Webview | undefined,
): void {
  if (!webview) return;
  const agentIds = [...agents.keys()].sort((a, b) => a - b);

  const agentMeta = context.workspaceState.get<
    Record<string, { palette?: number; seatId?: string }>
  >(WORKSPACE_KEY_AGENT_SEATS, {});

  const folderNames: Record<number, string> = {};
  const externalAgents: Record<number, boolean> = {};
  for (const [id, agent] of agents) {
    if (agent.folderName) {
      folderNames[id] = agent.folderName;
    }
    if (agent.isExternal) {
      externalAgents[id] = true;
    }
  }

  webview.postMessage({
    type: 'existingAgents',
    agents: agentIds,
    agentMeta,
    folderNames,
    externalAgents,
  });
}

export function sendCurrentAgentStatuses(
  agents: Map<number, AgentState>,
  webview: vscode.Webview | undefined,
): void {
  if (!webview) return;
  for (const [agentId, agent] of agents) {
    for (const [toolId, status] of agent.activeToolStatuses) {
      const toolName = agent.activeToolNames.get(toolId) ?? '';
      webview.postMessage({
        type: 'agentToolStart',
        id: agentId,
        toolId,
        status,
        toolName,
      });
    }
    if (agent.isWaiting) {
      webview.postMessage({
        type: 'agentStatus',
        id: agentId,
        status: 'waiting',
      });
    }
    if (agent.teamName) {
      webview.postMessage({
        type: 'agentTeamInfo',
        id: agentId,
        teamName: agent.teamName,
        agentName: agent.agentName,
        isTeamLead: agent.isTeamLead,
        leadAgentId: agent.leadAgentId,
        teamUsesTmux: agent.teamUsesTmux,
      });
    }
    if (agent.inputTokens > 0 || agent.outputTokens > 0) {
      webview.postMessage({
        type: 'agentTokenUsage',
        id: agentId,
        inputTokens: agent.inputTokens,
        outputTokens: agent.outputTokens,
      });
    }
  }
}

export function sendLayout(
  context: vscode.ExtensionContext,
  webview: vscode.Webview | undefined,
  defaultLayout?: Record<string, unknown> | null,
): void {
  if (!webview) return;
  const result = migrateAndLoadLayout(context, defaultLayout);
  webview.postMessage({
    type: 'layoutLoaded',
    layout: result?.layout ?? null,
    wasReset: result?.wasReset ?? false,
  });
}

function inferProviderId(
  persistedProviderId: string | undefined,
  jsonlFile: string,
  projectDir: string,
): string {
  if (persistedProviderId) return persistedProviderId;
  if (jsonlFile && normalizePath(jsonlFile).includes('/.codex/sessions/')) return 'codex';
  const meta = jsonlFile ? readCodexSessionMeta(jsonlFile) : null;
  if (meta && meta.cwd === projectDir) return 'codex';
  return 'claude';
}
