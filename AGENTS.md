# Pixel Agents - Codex Default Reference

`AGENTS.md` is the default operating guide for Codex agents in this repository.
`CLAUDE.md` remains as a compatibility reference for Claude-specific hook and team workflows, but the Codex path is the primary path now.

## Graphify-First Context

Use the persistent graph and agent knowledge base in `graphify-out/` before broad repo exploration, especially for parallel work:

- Read `graphify-out/AGENT_KNOWLEDGE_BASE.md` first, then `graphify-out/GRAPH_REPORT.md`, then `graphify-out/graph.json`.
- The extension refreshes the local code graph on startup and again after meaningful coding sessions or quiet intervals.
- If the knowledge base says a deep semantic refresh is needed after docs, images, or papers changed, run `/graphify --update`.
- Split parallel work by graph communities or subsystem boundaries so agents do not re-read the same files and waste tokens.
- If `.serena/project.yml` or `.serena/memories/*` exist, use them only as a fallback memory layer when the graph and KB are insufficient.
- Open `graphify-out/graph.html` when you need the visual map.

## Codex Defaults

- The extension launches new agents with `codex`.
- Codex session transcripts are discovered under `~/.codex/sessions`.
- Codex transcript handling lives in `src/codex.ts` and `src/codexTranscriptParser.ts`.
- Prefer `multi_tool_use.parallel` for independent reads.
- Use `spawn_agent` only for bounded sidecar work after checking the graph and KB.
- Codex `spawn_agent` children are surfaced as visible subagent characters in the office.
- Graphify is the native low-token repo memory layer. Serena is supplemental, not default.

## Architecture

```text
src/                           - Extension backend (Node.js, VS Code API)
  constants.ts                 - Extension constants, command ids, graph refresh thresholds
  extension.ts                 - Entry: activate(), deactivate(), Graphify command wiring
  PixelAgentsViewProvider.ts   - Webview provider, message dispatch, asset loading, terminal lifecycle
  agentManager.ts              - Codex terminal launch, restore, persistence, session attachment
  codex.ts                     - Codex session discovery, transcript helpers, tool status formatting
  codexTranscriptParser.ts     - Codex transcript parsing and visible subagent lifecycle
  transcriptParser.ts          - Shared transcript entrypoint, provider dispatch
  graphify.ts                  - Graphify refresh, HTML export, KB generation, Serena indexing
  graphifySessionMonitor.ts    - Auto-refresh coordinator for quiet intervals and good session completion
  GraphifyPanel.ts             - Dedicated graph preview panel
  fileWatcher.ts               - Session discovery, polling, transcript adoption
  timerManager.ts              - Waiting and permission timers
  types.ts                     - AgentState and persisted state
  assetLoader.ts               - Asset loading and webview message helpers
  configPersistence.ts         - User config file I/O
  layoutPersistence.ts         - User layout file I/O and cross-window sync

server/                        - Standalone hook server for provider integrations
  src/
    server.ts                  - HTTP server, health, auth token, server.json discovery
    hookEventHandler.ts        - Hook event routing and buffering
    providers/hook/claude/     - Claude-specific hook installer and provider support
  __tests__/                   - Vitest server and parser coverage

webview-ui/src/                - React + TypeScript webview
  App.tsx                      - Root composition
  hooks/useExtensionMessages.ts - Extension -> webview state bridge
  hooks/useEditorActions.ts    - UI actions including `openCodex`
  components/BottomToolbar.tsx - `+ Agent`, `Graph`, `Layout`, `Settings`
  components/SettingsModal.tsx - Graph and layout actions, toggles
  office/                      - Canvas engine, layout editor, rendering, characters, subagents

graphify-out/                  - Generated graph artifacts, ignored by git
  graph.html
  graph.json
  GRAPH_REPORT.md
  AGENT_KNOWLEDGE_BASE.md
  agent-knowledge-base.json
```

## Core Concepts

Vocabulary:

- Terminal = VS Code terminal running `codex`
- Session = Codex JSONL transcript file
- Agent = office character bound to a terminal or adopted external session
- Subagent = visible delegated character derived from `spawn_agent` or task tools

Extension to webview protocol:

- Key messages include `openCodex`, `openGraphify`, `refreshGraphify`, `agentCreated`, `agentClosed`, `agentToolStart`, `agentToolDone`, `agentToolsClear`, `agentStatus`, `subagentToolStart`, `subagentToolDone`, `subagentClear`, `agentTokenUsage`, `layoutLoaded`, `settingsLoaded`

One agent per terminal:

- Clicking `+ Agent` launches `codex` in a new terminal, creates a visible character immediately, then attaches that character to the matching session file under `~/.codex/sessions`

External session discovery:

- The provider scans recent Codex transcripts and adopts active sessions whose cwd matches an open workspace or, when enabled, any session on the machine

## Codex Transcript Model

Codex records:

- `session_meta` carries session id and cwd
- `event_msg` carries lifecycle events such as `task_started`, `user_message`, `token_count`, `task_complete`
- `response_item` carries function calls, function outputs, and web search activity

Codex tool visualization:

- `shell_command` shows as a running command
- `multi_tool_use.parallel` shows as parallel execution
- `spawn_agent` is normalized to `Agent` in the UI and creates a visible subagent character
- `wait_agent` and `close_agent` clear spawned subagents when they finish or are closed
- `task_complete` clears live tools and marks the agent waiting

Token tracking:

- Codex token usage comes from `event_msg` records with `type: token_count`
- The office UI receives `agentTokenUsage` updates and the graph session monitor uses those totals for refresh heuristics

## Graphify and Repo Memory

Graphify outputs:

- `graphify-out/graph.html` - interactive workspace visualization
- `graphify-out/graph.json` - machine-readable graph for reuse
- `graphify-out/GRAPH_REPORT.md` - human report with communities and cross-links
- `graphify-out/AGENT_KNOWLEDGE_BASE.md` - compressed Codex-first repo briefing
- `graphify-out/agent-knowledge-base.json` - structured KB payload

Default retrieval order:

1. `graphify-out/AGENT_KNOWLEDGE_BASE.md`
2. `graphify-out/GRAPH_REPORT.md`
3. `graphify-out/graph.json`
4. Serena config or memories only if the graph and KB do not answer the question

Auto-refresh behavior:

- Startup silently refreshes stale or missing graph output
- Quiet intervals trigger background refresh after enough coding activity accumulates
- A strong session completion reveals the Graphify panel automatically
- Refreshes are rate-limited so the extension does not rebuild the graph repeatedly during long sessions

## Parallel Work Guidance

- Read the KB and graph report before opening many files
- Use graph communities to divide work so agents own disjoint subsystems
- Prefer `multi_tool_use.parallel` when the work is multiple independent reads
- Use `spawn_agent` only when the sidecar task is concrete, bounded, and non-blocking
- Avoid delegating the critical-path task if you need the result immediately
- Keep subagents scoped to separate responsibilities or file areas

## Legacy Provider Note

This repo still contains a Claude hook server and Claude-specific provider code in `server/src/providers/hook/claude/`.
That code remains important for compatibility, but it is no longer the primary agent-launch path in the extension.
If you are making a default-path decision, choose Codex first.

## Build and Release Checklist

Install:

```sh
npm install
cd webview-ui && npm install && cd ..
cd server && npm install && cd ..
```

Release gate:

```sh
npm run check-types
npm run lint
npm run test:server
npm run build
```

Optional before publishing:

```sh
npm run test
npm run e2e
```

What release-ready means here:

- `AGENTS.md` is the authoritative Codex-default guide
- Graphify output is ignored by git and regenerated locally
- Startup graph refresh, interval refresh, and session-finish popup all work without manual setup
- Serena does not need to reopen repeatedly because the graph and KB are the default memory layer
- Codex delegated agents are visible in the office

## TypeScript and Editing Constraints

- No `enum`; use `as const` objects
- Use `import type` for type-only imports
- Keep constants centralized instead of adding inline magic numbers
- Prefer updating the codified thresholds in `src/constants.ts`
- Keep release-facing docs aligned with the current default runtime

## Practical Notes

- `TERMINAL_NAME_PREFIX` is `Codex`
- The Graph button and Graphify commands are first-class extension features
- `graphify-out/` is generated local state and should stay uncommitted
- If you change session lifecycle behavior, verify `src/agentManager.ts`, `src/fileWatcher.ts`, `src/transcriptParser.ts`, and `src/codexTranscriptParser.ts` together
- If you change graph behavior, verify `src/extension.ts`, `src/graphify.ts`, `src/graphifySessionMonitor.ts`, and `src/GraphifyPanel.ts` together
