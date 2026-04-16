import * as path from 'path';
import * as vscode from 'vscode';

import {
  GRAPHIFY_AUTO_REFRESH_IDLE_MS,
  GRAPHIFY_AUTO_REFRESH_MIN_INTERVAL_MS,
  GRAPHIFY_AUTO_REFRESH_MIN_LINES,
  GRAPHIFY_AUTO_REFRESH_MIN_TOKENS,
  GRAPHIFY_GOOD_SESSION_LINES,
  GRAPHIFY_GOOD_SESSION_TOKENS,
  GRAPHIFY_SESSION_MONITOR_INTERVAL_MS,
} from './constants.js';
import type { PixelAgentsViewProvider } from './PixelAgentsViewProvider.js';

interface AgentSnapshot {
  inputTokens: number;
  isWaiting: boolean;
  outputTokens: number;
  projectDir: string;
  sessionStartLineCount: number;
  sessionStartTokenCount: number;
  workspaceRoot: string | null;
  linesProcessed: number;
}

interface WorkspaceActivityState {
  lastActivityAt: number;
  lastRequestAt: number;
  pendingLines: number;
  pendingReveal: boolean;
  pendingTokens: number;
}

export interface GraphifyRefreshCandidate {
  workspaceRoot: string;
  revealPanel: boolean;
  reason: 'meaningful-session-complete' | 'workspace-quiet-interval';
}

export class GraphifySessionMonitor implements vscode.Disposable {
  private readonly agentSnapshots = new Map<number, AgentSnapshot>();
  private readonly workspaceActivity = new Map<string, WorkspaceActivityState>();
  private readonly timer: ReturnType<typeof setInterval>;

  constructor(
    private readonly provider: PixelAgentsViewProvider,
    private readonly onRefreshCandidate: (candidate: GraphifyRefreshCandidate) => void,
  ) {
    this.timer = setInterval(() => {
      this.poll();
    }, GRAPHIFY_SESSION_MONITOR_INTERVAL_MS);
  }

  dispose(): void {
    clearInterval(this.timer);
    this.agentSnapshots.clear();
    this.workspaceActivity.clear();
  }

  private poll(): void {
    const now = Date.now();
    const liveAgentIds = new Set<number>();

    for (const [agentId, agent] of this.provider.agents) {
      liveAgentIds.add(agentId);

      const workspaceRoot = this.resolveWorkspaceRoot(agent.projectDir);
      const currentTokenCount = agent.inputTokens + agent.outputTokens;
      const snapshot = this.agentSnapshots.get(agentId);

      if (!snapshot) {
        this.agentSnapshots.set(agentId, {
          inputTokens: agent.inputTokens,
          isWaiting: agent.isWaiting,
          outputTokens: agent.outputTokens,
          projectDir: agent.projectDir,
          sessionStartLineCount: agent.linesProcessed,
          sessionStartTokenCount: currentTokenCount,
          workspaceRoot,
          linesProcessed: agent.linesProcessed,
        });
        continue;
      }

      if (snapshot.projectDir !== agent.projectDir) {
        snapshot.projectDir = agent.projectDir;
        snapshot.workspaceRoot = workspaceRoot;
        snapshot.sessionStartLineCount = agent.linesProcessed;
        snapshot.sessionStartTokenCount = currentTokenCount;
      }

      const lineDelta = Math.max(0, agent.linesProcessed - snapshot.linesProcessed);
      const tokenDelta = Math.max(
        0,
        currentTokenCount - (snapshot.inputTokens + snapshot.outputTokens),
      );

      if (workspaceRoot && (lineDelta > 0 || tokenDelta > 0)) {
        this.recordWorkspaceActivity(workspaceRoot, lineDelta, tokenDelta, now);
      }

      if (snapshot.isWaiting && !agent.isWaiting) {
        snapshot.sessionStartLineCount = agent.linesProcessed;
        snapshot.sessionStartTokenCount = currentTokenCount;
      } else if (!snapshot.isWaiting && agent.isWaiting && workspaceRoot) {
        const sessionLineDelta = Math.max(0, agent.linesProcessed - snapshot.sessionStartLineCount);
        const sessionTokenDelta = Math.max(0, currentTokenCount - snapshot.sessionStartTokenCount);

        if (this.isGoodSession(sessionLineDelta, sessionTokenDelta)) {
          this.requestRefresh(workspaceRoot, true, 'meaningful-session-complete', now);
        }

        snapshot.sessionStartLineCount = agent.linesProcessed;
        snapshot.sessionStartTokenCount = currentTokenCount;
      }

      snapshot.inputTokens = agent.inputTokens;
      snapshot.outputTokens = agent.outputTokens;
      snapshot.linesProcessed = agent.linesProcessed;
      snapshot.isWaiting = agent.isWaiting;
      snapshot.workspaceRoot = workspaceRoot;
    }

    for (const agentId of [...this.agentSnapshots.keys()]) {
      if (!liveAgentIds.has(agentId)) {
        this.agentSnapshots.delete(agentId);
      }
    }

    for (const [workspaceRoot, state] of this.workspaceActivity) {
      if (state.pendingLines <= 0 && state.pendingTokens <= 0) continue;
      if (now - state.lastActivityAt < GRAPHIFY_AUTO_REFRESH_IDLE_MS) continue;
      this.requestRefresh(workspaceRoot, false, 'workspace-quiet-interval', now);
    }
  }

  private recordWorkspaceActivity(
    workspaceRoot: string,
    lineDelta: number,
    tokenDelta: number,
    now: number,
  ): void {
    const state = this.getWorkspaceActivityState(workspaceRoot);
    state.lastActivityAt = now;
    state.pendingLines += lineDelta;
    state.pendingTokens += tokenDelta;
  }

  private requestRefresh(
    workspaceRoot: string,
    revealPanel: boolean,
    reason: GraphifyRefreshCandidate['reason'],
    now: number,
  ): void {
    const state = this.getWorkspaceActivityState(workspaceRoot);
    state.pendingReveal ||= revealPanel;

    if (
      !state.pendingReveal &&
      state.pendingLines < GRAPHIFY_AUTO_REFRESH_MIN_LINES &&
      state.pendingTokens < GRAPHIFY_AUTO_REFRESH_MIN_TOKENS
    ) {
      return;
    }

    if (now - state.lastRequestAt < GRAPHIFY_AUTO_REFRESH_MIN_INTERVAL_MS) {
      return;
    }

    state.lastRequestAt = now;

    this.onRefreshCandidate({
      workspaceRoot,
      revealPanel: state.pendingReveal,
      reason,
    });

    state.pendingLines = 0;
    state.pendingTokens = 0;
    state.pendingReveal = false;
  }

  private getWorkspaceActivityState(workspaceRoot: string): WorkspaceActivityState {
    const existing = this.workspaceActivity.get(workspaceRoot);
    if (existing) {
      return existing;
    }

    const created: WorkspaceActivityState = {
      lastActivityAt: 0,
      lastRequestAt: 0,
      pendingLines: 0,
      pendingReveal: false,
      pendingTokens: 0,
    };
    this.workspaceActivity.set(workspaceRoot, created);
    return created;
  }

  private isGoodSession(lineCount: number, tokenCount: number): boolean {
    return lineCount >= GRAPHIFY_GOOD_SESSION_LINES || tokenCount >= GRAPHIFY_GOOD_SESSION_TOKENS;
  }

  private resolveWorkspaceRoot(projectDir: string): string | null {
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (folders.length === 0) return null;

    const normalizedProjectDir = normalizePath(projectDir);
    const matches = folders
      .map((folder) => folder.uri.fsPath)
      .filter((folderPath) => isSameOrParentPath(folderPath, normalizedProjectDir))
      .sort((left, right) => right.length - left.length);

    if (matches.length > 0) {
      return matches[0];
    }

    return (
      folders.find((folder) => normalizePath(folder.uri.fsPath) === normalizedProjectDir)?.uri
        .fsPath ?? null
    );
  }
}

function normalizePath(filePath: string): string {
  return path.normalize(filePath).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

function isSameOrParentPath(parentPath: string, childPath: string): boolean {
  const normalizedParent = normalizePath(parentPath);
  return childPath === normalizedParent || childPath.startsWith(`${normalizedParent}/`);
}
