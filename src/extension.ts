import * as vscode from 'vscode';

import {
  COMMAND_EXPORT_DEFAULT_LAYOUT,
  COMMAND_OPEN_GRAPHIFY,
  COMMAND_REFRESH_GRAPHIFY,
  COMMAND_SHOW_PANEL,
  GRAPHIFY_AUTO_REFRESH_MIN_INTERVAL_MS,
  VIEW_ID,
} from './constants.js';
import {
  hasGraphifyOutput,
  isGraphifyStale,
  runGraphify,
  syncGraphifyKnowledgeBase,
} from './graphify.js';
import { GraphifyPanel } from './GraphifyPanel.js';
import { type GraphifyRefreshCandidate, GraphifySessionMonitor } from './graphifySessionMonitor.js';
import { PixelAgentsViewProvider } from './PixelAgentsViewProvider.js';

let providerInstance: PixelAgentsViewProvider | undefined;
let graphifySessionMonitor: GraphifySessionMonitor | undefined;

interface GraphifyRefreshState {
  inFlight: boolean;
  lastRefreshAt: number;
  queuedReason: GraphifyRefreshCandidate['reason'] | null;
  queuedRevealPanel: boolean;
  scheduledFlush: ReturnType<typeof setTimeout> | null;
}

export function activate(context: vscode.ExtensionContext) {
  console.log(`[Pixel Agents] PIXEL_AGENTS_DEBUG=${process.env.PIXEL_AGENTS_DEBUG ?? 'not set'}`);
  const provider = new PixelAgentsViewProvider(context);
  providerInstance = provider;

  context.subscriptions.push(vscode.window.registerWebviewViewProvider(VIEW_ID, provider));

  context.subscriptions.push(
    vscode.commands.registerCommand(COMMAND_SHOW_PANEL, () => {
      vscode.commands.executeCommand(`${VIEW_ID}.focus`);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(COMMAND_EXPORT_DEFAULT_LAYOUT, () => {
      provider.exportDefaultLayout();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(COMMAND_OPEN_GRAPHIFY, async (folderPath?: string) => {
      const workspaceRoot = await pickWorkspaceRoot(folderPath);
      if (!workspaceRoot) return;

      if (!hasGraphifyOutput(workspaceRoot)) {
        await refreshGraphify(context, workspaceRoot, { interactive: true, revealPanel: true });
        return;
      }

      GraphifyPanel.createOrShow(context, workspaceRoot).refresh(workspaceRoot);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(COMMAND_REFRESH_GRAPHIFY, async (folderPath?: string) => {
      const workspaceRoot = await pickWorkspaceRoot(folderPath);
      if (!workspaceRoot) return;
      await refreshGraphify(context, workspaceRoot, { interactive: true, revealPanel: true });
    }),
  );

  graphifySessionMonitor = new GraphifySessionMonitor(provider, (candidate) => {
    void queueGraphifyRefresh(context, candidate);
  });

  void primeGraphifyOnStartup(context);
}

export function deactivate() {
  graphifySessionMonitor?.dispose();
  graphifySessionMonitor = undefined;
  for (const state of graphifyRefreshStates.values()) {
    if (state.scheduledFlush) {
      clearTimeout(state.scheduledFlush);
    }
  }
  graphifyRefreshStates.clear();
  providerInstance?.dispose();
}

async function queueGraphifyRefresh(
  context: vscode.ExtensionContext,
  candidate: GraphifyRefreshCandidate,
): Promise<void> {
  const state = getGraphifyRefreshState(candidate.workspaceRoot);
  state.queuedRevealPanel ||= candidate.revealPanel;
  state.queuedReason = candidate.reason;

  if (state.inFlight) {
    return;
  }

  const now = Date.now();
  const earliestRunAt = state.lastRefreshAt + GRAPHIFY_AUTO_REFRESH_MIN_INTERVAL_MS;
  if (now < earliestRunAt) {
    scheduleQueuedGraphifyRefresh(context, candidate.workspaceRoot, earliestRunAt - now);
    return;
  }

  await flushQueuedGraphifyRefresh(context, candidate.workspaceRoot);
}

async function flushQueuedGraphifyRefresh(
  context: vscode.ExtensionContext,
  workspaceRoot: string,
): Promise<void> {
  const state = getGraphifyRefreshState(workspaceRoot);
  if (state.inFlight || !state.queuedReason) {
    return;
  }

  if (state.scheduledFlush) {
    clearTimeout(state.scheduledFlush);
    state.scheduledFlush = null;
  }

  state.inFlight = true;
  const revealPanel = state.queuedRevealPanel;
  state.queuedRevealPanel = false;
  state.queuedReason = null;

  try {
    if (!hasGraphifyOutput(workspaceRoot) || isGraphifyStale(workspaceRoot)) {
      await refreshGraphify(context, workspaceRoot, {
        interactive: false,
        revealPanel,
      });
    } else {
      await syncGraphifyKnowledgeBase(workspaceRoot);
      if (revealPanel) {
        GraphifyPanel.createOrShow(context, workspaceRoot).refresh(workspaceRoot);
      } else {
        GraphifyPanel.refreshIfOpen(workspaceRoot);
      }
    }
    state.lastRefreshAt = Date.now();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.warn(`[Pixel Agents] Graphify auto-refresh skipped for ${workspaceRoot}: ${detail}`);
  } finally {
    state.inFlight = false;
    if (state.queuedReason) {
      scheduleQueuedGraphifyRefresh(context, workspaceRoot, GRAPHIFY_AUTO_REFRESH_MIN_INTERVAL_MS);
    }
  }
}

const graphifyRefreshStates = new Map<string, GraphifyRefreshState>();

function getGraphifyRefreshState(workspaceRoot: string): GraphifyRefreshState {
  const existing = graphifyRefreshStates.get(workspaceRoot);
  if (existing) {
    return existing;
  }

  const created: GraphifyRefreshState = {
    inFlight: false,
    lastRefreshAt: 0,
    queuedReason: null,
    queuedRevealPanel: false,
    scheduledFlush: null,
  };
  graphifyRefreshStates.set(workspaceRoot, created);
  return created;
}

function scheduleQueuedGraphifyRefresh(
  context: vscode.ExtensionContext,
  workspaceRoot: string,
  delayMs: number,
): void {
  const state = getGraphifyRefreshState(workspaceRoot);
  if (state.scheduledFlush) {
    return;
  }

  state.scheduledFlush = setTimeout(
    () => {
      state.scheduledFlush = null;
      void flushQueuedGraphifyRefresh(context, workspaceRoot);
    },
    Math.max(0, delayMs),
  );
}

async function refreshGraphify(
  context: vscode.ExtensionContext,
  workspaceRoot: string,
  options: {
    interactive?: boolean;
    revealPanel?: boolean;
  } = {},
): Promise<void> {
  const interactive = options.interactive ?? true;
  const revealPanel = options.revealPanel ?? interactive;
  const hasExistingGraph = hasGraphifyOutput(workspaceRoot);
  const title = hasExistingGraph ? 'Refreshing Graphify map' : 'Building Graphify map';

  const runner = async () => {
    await runGraphify(workspaceRoot, hasExistingGraph);
    if (revealPanel) {
      GraphifyPanel.createOrShow(context, workspaceRoot).refresh(workspaceRoot);
    } else {
      GraphifyPanel.refreshIfOpen(workspaceRoot);
    }
  };

  try {
    if (interactive) {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title,
          cancellable: false,
        },
        runner,
      );
    } else {
      await runner();
    }
    getGraphifyRefreshState(workspaceRoot).lastRefreshAt = Date.now();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (interactive) {
      void vscode.window.showErrorMessage(detail);
    } else {
      console.warn(`[Pixel Agents] Graphify refresh skipped: ${detail}`);
    }
  }
}

async function pickWorkspaceRoot(folderPath?: string): Promise<string | undefined> {
  if (folderPath) return folderPath;

  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 0) {
    void vscode.window.showWarningMessage('Pixel Agents: Open a workspace folder to use Graphify.');
    return undefined;
  }
  if (folders.length === 1) {
    return folders[0].uri.fsPath;
  }

  const picked = await vscode.window.showQuickPick(
    folders.map((folder) => ({ label: folder.name, description: folder.uri.fsPath })),
    { placeHolder: 'Select a workspace folder for Graphify' },
  );
  return picked?.description;
}

async function primeGraphifyOnStartup(context: vscode.ExtensionContext): Promise<void> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  for (const folder of folders) {
    const workspaceRoot = folder.uri.fsPath;
    if (!hasGraphifyOutput(workspaceRoot) || isGraphifyStale(workspaceRoot)) {
      await refreshGraphify(context, workspaceRoot, { interactive: false, revealPanel: false });
      continue;
    }

    try {
      await syncGraphifyKnowledgeBase(workspaceRoot);
      GraphifyPanel.refreshIfOpen(workspaceRoot);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.warn(`[Pixel Agents] Graphify knowledge-base sync skipped: ${detail}`);
    }
  }
}
