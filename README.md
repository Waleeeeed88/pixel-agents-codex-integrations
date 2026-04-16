<h1 align="center">
    <a href="https://github.com/Waleeeeed88/pixel-agents-codex-integrations">
        <img src="webview-ui/public/banner.png" alt="CodexEconPixel">
    </a>
</h1>

<h2 align="center" style="padding-bottom: 20px;">
  The game interface where AI agents build real things
</h2>

<div align="center" style="margin-top: 25px;">

[![release](https://img.shields.io/github/v/release/Waleeeeed88/pixel-agents-codex-integrations?display_name=tag&color=0183ff&style=flat)](https://github.com/Waleeeeed88/pixel-agents-codex-integrations/releases)
[![stars](https://img.shields.io/github/stars/Waleeeeed88/pixel-agents-codex-integrations?logo=github&color=0183ff&style=flat)](https://github.com/Waleeeeed88/pixel-agents-codex-integrations/stargazers)
[![license](https://img.shields.io/github/license/Waleeeeed88/pixel-agents-codex-integrations?color=0183ff&style=flat)](https://github.com/Waleeeeed88/pixel-agents-codex-integrations/blob/main/LICENSE)
[![upstream](https://img.shields.io/badge/upstream-pablodelucca%2Fpixel--agents-7057ff?style=flat)](https://github.com/pablodelucca/pixel-agents)

</div>

<div align="center">
<a href="https://github.com/Waleeeeed88/pixel-agents-codex-integrations/releases">📦 Releases</a> • <a href="https://github.com/Waleeeeed88/pixel-agents-codex-integrations/issues">🐛 Issues</a> • <a href="https://github.com/Waleeeeed88/pixel-agents-codex-integrations/discussions">💬 Discussions</a> • <a href="CONTRIBUTING.md">🤝 Contributing</a> • <a href="CHANGELOG.md">📋 Changelog</a>
</div>

<br/>

> `CodexEconPixel` is a personal fork of [pablodelucca/pixel-agents](https://github.com/pablodelucca/pixel-agents).
> It keeps the original MIT license and builds on the upstream project with a Codex-first workflow, Graphify repo memory, and fork-specific integrations.

CodexEconPixel turns multi-agent AI systems into something you can actually see and manage. Each agent becomes a character in a pixel art office. They walk around, sit at their desk, and visually reflect what they are doing — typing when writing code, reading when searching files, waiting when it needs your attention.

Right now the default runtime is Codex inside VS Code, with legacy Claude compatibility still present in the codebase. The long-term vision is a fully agent-agnostic, platform-agnostic interface for orchestrating any AI agents, deployable anywhere.

This repository packages the `CodexEconPixel` VS Code extension. GitHub Releases are the current source of truth for VSIX builds in this fork. Marketplace publishing is wired in the repo and becomes one-click once `VSCE_PAT` and `OPEN_VSX_TOKEN` are configured in GitHub Actions.

![Pixel Agents screenshot](webview-ui/public/Screenshot.jpg)

## This Fork

- Original project: [pablodelucca/pixel-agents](https://github.com/pablodelucca/pixel-agents)
- Fork repository: [Waleeeeed88/pixel-agents-codex-integrations](https://github.com/Waleeeeed88/pixel-agents-codex-integrations)
- Compare this fork against upstream: [main...Waleeeeed88:main](https://github.com/pablodelucca/pixel-agents/compare/main...Waleeeeed88:pixel-agents-codex-integrations:main)
- Extension identity: `waleeeeed88.codexeconpixel`

This fork is where the Codex-first and Graphify-oriented work lives. The main changes in this fork are:

- Codex as the default agent runtime instead of Claude-first launch behavior
- Graphify as the primary repo memory layer, with Serena treated as fallback context
- Graph panel, graph refresh flow, and Codex transcript/session support across the extension
- Extension-started Codex sessions now bootstrap Serena and start with a Graphify-first session prompt by default
- Fork-specific integration work, CI hardening, and release preparation intended to make this repo easier to ship and maintain as your own implementation

## Features

- **One agent, one character** — every Codex terminal gets its own animated character
- **Live activity tracking** — characters animate based on what the agent is actually doing (writing, reading, running commands)
- **Office layout editor** — design your office with floors, walls, and furniture using a built-in editor
- **Speech bubbles** — visual indicators when an agent is waiting for input or needs permission
- **Sound notifications** — optional chime when an agent finishes its turn
- **Sub-agent visualization** — Task tool sub-agents spawn as separate characters linked to their parent
- **Graphify workspace map** — build and open a persistent knowledge-graph view of the repo for lower-token parallel work
- **Persistent layouts** — your office design is saved and shared across VS Code windows
- **External asset directories** — load custom or third-party furniture packs from any folder on your machine
- **Diverse characters** — 6 diverse characters. These are based on the amazing work of [JIK-A-4, Metro City](https://jik-a-4.itch.io/metrocity-free-topdown-character-pack).

<p align="center">
  <img src="webview-ui/public/characters.png" alt="Pixel Agents characters" width="320" height="72" style="image-rendering: pixelated;">
</p>

## Requirements

- VS Code 1.105.0 or later
- [Codex CLI](https://platform.openai.com/docs/codex) installed and configured
- **Platform**: Windows, Linux, and macOS are supported

## Getting Started

If you want to use this fork today, install the VSIX from [GitHub Releases](https://github.com/Waleeeeed88/pixel-agents-codex-integrations/releases). If you want to play with the code, develop, or contribute, then:

### Install from source

```bash
git clone https://github.com/Waleeeeed88/pixel-agents-codex-integrations.git
cd pixel-agents-codex-integrations
npm run setup
npm run build
```

Then press **F5** in VS Code to launch the Extension Development Host.

### Developer Workflow

The fork is set up to be low-friction for contributors:

- `npm run setup` installs the root, webview, and server dependencies in one command
- `npm run validate` runs the same core checks used before release
- `npm run release:check` runs the full local release gate
- `npm run package:vsix` creates a VSIX locally in `dist-vsix/`

Maintainers can use [docs/releasing.md](docs/releasing.md) for the release flow, required secrets, and the GitHub release packaging path.

### Usage

1. Open the **CodexEconPixel** panel (it appears in the bottom panel area alongside your terminal)
2. Click **+ Agent** to spawn a new Codex terminal and its character. Right-click for the option to launch with `--dangerously-skip-permissions` (bypasses all tool approval prompts)
3. Extension-started Codex sessions now prime `.serena/` for the workspace and start with a default session prompt that makes Graphify the primary repo memory layer and Serena the fallback layer
4. Start coding with Codex — watch the character react in real time
5. Click a character to select it, then click a seat to reassign it
6. Click **Layout** to open the office editor and customize your space
7. Click **Graph** to build or open the repo’s Graphify map and reuse its graph/report for parallel agent context

The shipped default workflow is described in [docs/default-workflow.md](docs/default-workflow.md).

## Graphify Workflow

CodexEconPixel can open a Graphify workspace map beside the main panel. On extension startup, the extension performs a silent local Graphify code refresh for each open workspace and rebuilds the native graph HTML plus a compact agent knowledge base. After that, the extension keeps watching agent activity and quietly refreshes the graph again after meaningful coding sessions or quiet intervals, with the graph panel popping open when a strong session completes. The panel looks for `graphify-out/graph.html`, `graphify-out/graph.json`, `graphify-out/GRAPH_REPORT.md`, and `graphify-out/AGENT_KNOWLEDGE_BASE.md` in the workspace root. If they are missing or stale, **Graph** triggers a refresh and then opens a dedicated preview panel with the interactive visualization.

Use this to keep a persistent subsystem map around for parallel agents:

- `graphify-out/graph.json` — reusable graph context for tools and agents
- `graphify-out/GRAPH_REPORT.md` — human-readable report with clusters and cross-links
- `graphify-out/graph.html` — interactive visualization
- `graphify-out/AGENT_KNOWLEDGE_BASE.md` — compact repomix-like briefing for Codex agents

The knowledge base also indexes local Serena project data when present:

- `.serena/project.yml` — project configuration
- `.serena/memories/*` — persistent project memories

Serena is treated as a fallback memory layer. CodexEconPixel does not need to reopen it every time; the default retrieval path is the Graphify knowledge base, report, and graph first.

If Graphify is not installed yet, install `graphifyy` in your Python environment first.
For richer doc/paper/image extraction beyond the built-in startup code graph refresh, run `/graphify --update` inside your AI assistant.
Extension-started Codex sessions are primed with that retrieval order automatically.

For source contributors and agents, `AGENTS.md` is the Codex-default operating guide in this repo.

## Layout Editor

The built-in editor lets you design your office:

- **Floor** — Full HSB color control
- **Walls** — Auto-tiling walls with color customization
- **Tools** — Select, paint, erase, place, eyedropper, pick
- **Undo/Redo** — 50 levels with Ctrl+Z / Ctrl+Y
- **Export/Import** — Share layouts as JSON files via the Settings modal

The grid is expandable up to 64×64 tiles. Click the ghost border outside the current grid to grow it.

### Office Assets

All office assets (furniture, floors, walls) are now **fully open-source** and included in this repository under `webview-ui/public/assets/`. No external purchases or imports are needed — everything works out of the box.

Each furniture item lives in its own folder under `assets/furniture/` with a `manifest.json` that declares its sprites, rotation groups, state groups (on/off), and animation frames. Floor tiles are individual PNGs in `assets/floors/`, and wall tile sets are in `assets/walls/`. This modular structure makes it easy to add, remove, or modify assets without touching any code.

To add a new furniture item, create a folder in `webview-ui/public/assets/furniture/` with your PNG sprite(s) and a `manifest.json`, then rebuild. The asset manager (`scripts/asset-manager.html`) provides a visual editor for creating and editing manifests.

To use furniture from an external directory, open Settings → **Add Asset Directory**. See [docs/external-assets.md](docs/external-assets.md) for the full manifest format and how to use third-party asset packs.

Characters are based on the amazing work of [JIK-A-4, Metro City](https://jik-a-4.itch.io/metrocity-free-topdown-character-pack).

## How It Works

CodexEconPixel watches Codex session transcripts and the legacy Claude compatibility path to track what each agent is doing. When an agent uses a tool (like writing a file or running a command), the extension detects it and updates the character's animation accordingly.

The webview runs a lightweight game loop with canvas rendering, BFS pathfinding, and a character state machine (idle → walk → type/read). Everything is pixel-perfect at integer zoom levels.

## Tech Stack

- **Extension**: TypeScript, VS Code Webview API, esbuild
- **Webview**: React 19, TypeScript, Vite, Canvas 2D

## Known Limitations

- **Agent-terminal sync** — the way agents are connected to Claude Code terminal instances is not super robust and sometimes desyncs, especially when terminals are rapidly opened/closed or restored across sessions.
- **Heuristic-based status detection** — Claude Code's JSONL transcript format does not provide clear signals for when an agent is waiting for user input or when it has finished its turn. The current detection is based on heuristics (idle timers, turn-duration events) and often misfires — agents may briefly show the wrong status or miss transitions.
- **Linux/macOS tip** — if you launch VS Code without a folder open (e.g. bare `code` command), agents will start in your home directory. This is fully supported; just be aware your Claude sessions will be tracked under `~/.claude/projects/` using your home directory as the project root.

## Troubleshooting

If your agent appears stuck on idle or doesn't spawn:

1. **Debug View** — In the CodexEconPixel panel, click the gear icon (Settings), then toggle **Debug View**. This shows connection diagnostics per agent: JSONL file status, lines parsed, last data timestamp, and file path. If you see "JSONL not found", the extension can't locate the session file.
2. **Debug Console** — If you're running from source (Extension Development Host via F5), open VS Code's **View > Debug Console**. Search for `[Pixel Agents]` to see detailed logs: project directory resolution, JSONL polling status, path encoding mismatches, and unrecognized JSONL record types.

## Where This Is Going

The long-term vision is an interface where managing AI agents feels like playing the Sims, but the results are real things built.

- **Agents as characters** you can see, assign, monitor, and redirect, each with visible roles (designer, coder, writer, reviewer), stats, context usage, and tools.
- **Desks as directories** — drag an agent to a desk to assign it to a project or working directory.
- **An office as a project** — with a Kanban board on the wall where idle agents can pick up tasks autonomously.
- **Deep inspection** — click any agent to see its model, branch, system prompt, and full work history. Interrupt it, chat with it, or redirect it.
- **Token health bars** — rate limits and context windows visualized as in-game stats.
- **Fully customizable** — upload your own character sprites, themes, and office assets. Eventually maybe even move beyond pixel art into 3D or VR.

For this to work, the architecture needs to be modular at every level:

- **Platform-agnostic**: VS Code extension today, Electron app, web app, or any other host environment tomorrow.
- **Agent-agnostic**: Codex by default today, while the architecture is being shaped to support Claude, OpenCode, Gemini, Cursor, Copilot, and others through composable adapters.
- **Theme-agnostic**: community-created assets, skins, and themes from any contributor.

We're actively working on the core module and adapter architecture that makes this possible. If you're interested to talk about this further, please visit this fork's [Discussions Section](https://github.com/Waleeeeed88/pixel-agents-codex-integrations/discussions).

## Community & Contributing

Use **[Issues](https://github.com/Waleeeeed88/pixel-agents-codex-integrations/issues)** to report bugs or request features. Join **[Discussions](https://github.com/Waleeeeed88/pixel-agents-codex-integrations/discussions)** for questions and conversations.

See [CONTRIBUTING.md](CONTRIBUTING.md) for instructions on how to contribute.

Please read our [Code of Conduct](CODE_OF_CONDUCT.md) before participating.

## Supporting the Project

If you find Pixel Agents useful, consider supporting its development:

<a href="https://github.com/sponsors/pablodelucca">
  <img src="https://img.shields.io/badge/Sponsor-GitHub-ea4aaa?logo=github" alt="GitHub Sponsors">
</a>
<a href="https://ko-fi.com/pablodelucca">
  <img src="https://img.shields.io/badge/Support-Ko--fi-ff5e5b?logo=ko-fi" alt="Ko-fi">
</a>

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=pablodelucca/pixel-agents&type=Date)](https://www.star-history.com/?repos=pablodelucca%2Fpixel-agents&type=date&legend=bottom-right)

## License

This project is licensed under the [MIT License](LICENSE).
