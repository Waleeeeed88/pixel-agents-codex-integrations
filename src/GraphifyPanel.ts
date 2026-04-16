import * as vscode from 'vscode';

import { readGraphifySummary } from './graphify.js';

export class GraphifyPanel {
  private static current: GraphifyPanel | undefined;

  static createOrShow(context: vscode.ExtensionContext, workspaceRoot: string): GraphifyPanel {
    if (GraphifyPanel.current) {
      GraphifyPanel.current.workspaceRoot = workspaceRoot;
      GraphifyPanel.current.panel.reveal(vscode.ViewColumn.Beside);
      GraphifyPanel.current.render();
      return GraphifyPanel.current;
    }

    const panel = vscode.window.createWebviewPanel(
      'pixel-agents.graphify',
      'Graphify Map',
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      },
    );

    GraphifyPanel.current = new GraphifyPanel(panel, context, workspaceRoot);
    return GraphifyPanel.current;
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly context: vscode.ExtensionContext,
    private workspaceRoot: string,
  ) {
    this.panel.onDidDispose(() => {
      if (GraphifyPanel.current === this) {
        GraphifyPanel.current = undefined;
      }
    });

    this.panel.webview.onDidReceiveMessage(async (message) => {
      if (message.type === 'openReport') {
        const summary = readGraphifySummary(this.workspaceRoot);
        await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(summary.reportPath));
      } else if (message.type === 'openKnowledgeBase') {
        const summary = readGraphifySummary(this.workspaceRoot);
        await vscode.commands.executeCommand(
          'vscode.open',
          vscode.Uri.file(summary.knowledgeBasePath),
        );
      } else if (message.type === 'revealOutput') {
        const summary = readGraphifySummary(this.workspaceRoot);
        await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(summary.outputDir));
      } else if (message.type === 'refreshGraphify') {
        await vscode.commands.executeCommand('pixel-agents.refreshGraphify', this.workspaceRoot);
      }
    });

    this.render();
  }

  refresh(workspaceRoot?: string): void {
    if (workspaceRoot) {
      this.workspaceRoot = workspaceRoot;
    }
    this.render();
    this.panel.reveal(vscode.ViewColumn.Beside);
  }

  static refreshIfOpen(workspaceRoot: string): void {
    if (!GraphifyPanel.current) return;
    if (GraphifyPanel.current.workspaceRoot !== workspaceRoot) return;
    GraphifyPanel.current.render();
  }

  private render(): void {
    const summary = readGraphifySummary(this.workspaceRoot);
    const folderName =
      vscode.workspace.asRelativePath(this.workspaceRoot, false) || this.workspaceRoot;

    this.panel.title = `Graphify: ${folderName.split(/[\\/]/).pop() ?? folderName}`;
    this.panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.file(summary.outputDir), this.context.extensionUri],
    };

    const graphUri = this.panel.webview.asWebviewUri(vscode.Uri.file(summary.htmlPath));
    this.panel.webview.html = getGraphifyPanelHtml(
      this.panel.webview,
      summary,
      graphUri.toString(),
    );
  }
}

function getGraphifyPanelHtml(
  webview: vscode.Webview,
  summary: ReturnType<typeof readGraphifySummary>,
  graphUri: string,
): string {
  const nonce = getNonce();
  const updatedLabel = summary.updatedAt
    ? new Date(summary.updatedAt).toLocaleString()
    : 'Not generated yet';
  const hasGraph = summary.nodeCount > 0 || summary.edgeCount > 0;
  const title = escapeHtml(
    summary.workspaceRoot.split(/[\\/]/).filter(Boolean).pop() ?? summary.workspaceRoot,
  );
  const excerpt = summary.knowledgeBaseExcerpt.length
    ? summary.knowledgeBaseExcerpt.map((line) => `<p>${escapeHtml(line)}</p>`).join('')
    : '<p>Build the graph to get a persistent subsystem map, community clusters, and a report agents can reuse across parallel sessions.</p>';
  const semanticRefreshBanner = summary.requiresSemanticRefresh
    ? '<div class="banner">Docs or other semantic sources changed after the last graph build. Run a deep Graphify refresh if you want those connections folded into the graph.</div>'
    : '';
  const serenaLabel = summary.hasSerenaConfig
    ? `Serena memories: ${summary.serenaMemoryCount}`
    : 'Serena config: not detected';

  /* eslint-disable pixel-agents/no-inline-colors */
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; img-src ${webview.cspSource} data: https:; style-src 'unsafe-inline' ${webview.cspSource}; script-src 'nonce-${nonce}'; frame-src ${webview.cspSource};"
    />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Graphify Map</title>
    <style>
      :root {
        color-scheme: dark;
        --bg: #07111a;
        --panel: rgba(10, 23, 34, 0.88);
        --panel-strong: rgba(7, 19, 29, 0.96);
        --line: rgba(122, 186, 255, 0.18);
        --text: #edf6ff;
        --muted: #9eb8d2;
        --accent: #6ce6ff;
        --accent-strong: #82ffa1;
        --accent-ink: #041017;
        --canvas-bg: #04090d;
        --shadow: 0 24px 70px rgba(0, 0, 0, 0.35);
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        min-height: 100vh;
        font-family: Georgia, 'Times New Roman', serif;
        color: var(--text);
        background:
          radial-gradient(circle at top left, rgba(108, 230, 255, 0.17), transparent 32%),
          radial-gradient(circle at top right, rgba(130, 255, 161, 0.12), transparent 28%),
          linear-gradient(180deg, #0b1d2d 0%, var(--bg) 56%, #050b11 100%);
      }

      .shell {
        display: grid;
        grid-template-rows: auto 1fr;
        min-height: 100vh;
      }

      .hero {
        position: relative;
        overflow: hidden;
        padding: 28px 28px 22px;
        border-bottom: 1px solid var(--line);
        background:
          linear-gradient(135deg, rgba(255, 255, 255, 0.03), transparent 58%),
          linear-gradient(180deg, rgba(6, 15, 24, 0.2), rgba(6, 15, 24, 0.72));
      }

      .hero::after {
        content: '';
        position: absolute;
        inset: auto -12% -58% auto;
        width: 360px;
        height: 360px;
        border-radius: 50%;
        background: radial-gradient(circle, rgba(108, 230, 255, 0.18), transparent 70%);
        pointer-events: none;
      }

      .eyebrow {
        margin: 0 0 8px;
        font-size: 11px;
        letter-spacing: 0.22em;
        text-transform: uppercase;
        color: var(--accent);
      }

      h1 {
        margin: 0;
        font-size: 34px;
        line-height: 1;
        letter-spacing: -0.04em;
      }

      .subcopy {
        margin: 10px 0 0;
        max-width: 840px;
        color: var(--muted);
        line-height: 1.55;
        font-size: 14px;
      }

      .stats {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        margin-top: 18px;
      }

      .card {
        min-width: 132px;
        padding: 14px 16px;
        border: 1px solid var(--line);
        border-radius: 18px;
        background: var(--panel);
        box-shadow: var(--shadow);
        backdrop-filter: blur(12px);
      }

      .card strong {
        display: block;
        font-size: 28px;
        line-height: 1;
      }

      .card span {
        display: block;
        margin-top: 6px;
        font-size: 12px;
        color: var(--muted);
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }

      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        margin-top: 20px;
      }

      .banner {
        margin-top: 16px;
        padding: 12px 14px;
        border: 1px solid rgba(255, 214, 102, 0.24);
        border-radius: 14px;
        color: #ffe9b3;
        background: rgba(255, 183, 77, 0.12);
      }

      button {
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 999px;
        padding: 10px 16px;
        font: inherit;
        color: var(--text);
        background: rgba(255, 255, 255, 0.06);
        cursor: pointer;
      }

      button.primary {
        color: var(--accent-ink);
        background: linear-gradient(135deg, var(--accent), var(--accent-strong));
        border-color: transparent;
      }

      .viewport {
        padding: 18px;
      }

      .frame {
        display: grid;
        grid-template-columns: minmax(280px, 360px) 1fr;
        gap: 18px;
        min-height: calc(100vh - 240px);
      }

      .aside,
      .canvas {
        border: 1px solid var(--line);
        border-radius: 22px;
        overflow: hidden;
        background: var(--panel-strong);
        box-shadow: var(--shadow);
      }

      .aside {
        padding: 20px;
      }

      .aside h2 {
        margin: 0 0 14px;
        font-size: 12px;
        letter-spacing: 0.18em;
        text-transform: uppercase;
        color: var(--accent);
      }

      .aside p {
        margin: 0 0 12px;
        color: var(--muted);
        line-height: 1.6;
      }

      .meta {
        margin-top: 20px;
        padding-top: 16px;
        border-top: 1px solid var(--line);
        color: var(--muted);
        font-size: 12px;
      }

      iframe {
        display: block;
        width: 100%;
        height: 100%;
        min-height: calc(100vh - 276px);
        border: 0;
        background: var(--canvas-bg);
      }

      .empty {
        display: grid;
        place-items: center;
        min-height: calc(100vh - 276px);
        padding: 36px;
        text-align: center;
        color: var(--muted);
      }

      @media (max-width: 1100px) {
        .frame {
          grid-template-columns: 1fr;
        }

        .aside {
          order: 2;
        }
      }
    </style>
  </head>
  <body>
    <div class="shell">
      <header class="hero">
        <p class="eyebrow">Graphify Workspace Memory</p>
        <h1>${title}</h1>
        <p class="subcopy">
          Persistent graph context for parallel agents: clustered subsystems, reusable graph JSON,
          and a richer visualization than a plain report.
        </p>
        <div class="stats">
          <div class="card"><strong>${summary.nodeCount}</strong><span>Nodes</span></div>
          <div class="card"><strong>${summary.edgeCount}</strong><span>Edges</span></div>
          <div class="card"><strong>${summary.communityCount}</strong><span>Communities</span></div>
        </div>
        <div class="actions">
          <button class="primary" id="refresh">Refresh Graph</button>
          <button id="knowledge">Open Knowledge Base</button>
          <button id="report">Open Report</button>
          <button id="reveal">Reveal Output</button>
        </div>
        ${semanticRefreshBanner}
      </header>
      <main class="viewport">
        <section class="frame">
          <aside class="aside">
            <h2>Report Excerpt</h2>
            ${excerpt}
            <div class="meta">
              <div>Updated: ${escapeHtml(updatedLabel)}</div>
              <div>Folder: ${escapeHtml(summary.workspaceRoot)}</div>
              <div>${escapeHtml(serenaLabel)}</div>
              <div>Files: ${escapeHtml(summary.outputDir)}</div>
            </div>
          </aside>
          <section class="canvas">
            ${
              hasGraph
                ? `<iframe title="Graphify visualization" src="${graphUri}"></iframe>`
                : `<div class="empty">
                    <div>
                      <h2>No graph yet</h2>
                      <p>Run Graphify once and this panel will load the interactive map automatically.</p>
                    </div>
                  </div>`
            }
          </section>
        </section>
      </main>
    </div>
    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();
      document.getElementById('report')?.addEventListener('click', () => {
        vscode.postMessage({ type: 'openReport' });
      });
      document.getElementById('knowledge')?.addEventListener('click', () => {
        vscode.postMessage({ type: 'openKnowledgeBase' });
      });
      document.getElementById('reveal')?.addEventListener('click', () => {
        vscode.postMessage({ type: 'revealOutput' });
      });
      document.getElementById('refresh')?.addEventListener('click', () => {
        vscode.postMessage({ type: 'refreshGraphify' });
      });
    </script>
  </body>
</html>`;
  /* eslint-enable pixel-agents/no-inline-colors */
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getNonce(): string {
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}
