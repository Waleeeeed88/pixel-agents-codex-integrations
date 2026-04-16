# Default Codex Workflow

CodexEconPixel primes Graphify and Serena before launching Codex from the extension.

## What happens on `+ Agent`

When you launch a new Codex session from the extension in a workspace folder, CodexEconPixel:

1. Ensures `.serena/project.yml` exists for that workspace.
2. Ensures `.serena/project.local.yml` and `.serena/memories/` exist.
3. Refreshes Graphify when `graphify-out/` is missing or stale.
4. Starts Codex with an initial session prompt that tells it to:
   - read `graphify-out/AGENT_KNOWLEDGE_BASE.md` first
   - then use `graphify-out/GRAPH_REPORT.md`
   - then use `graphify-out/graph.json`
   - treat Graphify as the primary repo memory layer
   - use Serena only as fallback when the graph or knowledge base is insufficient

## Notes

- If Graphify cannot be refreshed automatically, the extension still boots Serena and starts Codex with a fallback prompt that prefers any existing `graphify-out/` files and otherwise falls back to Serena.
- This bootstrap runs for extension-started workspace sessions. It does not rewrite arbitrary repository docs such as `AGENTS.md`.
- `graphify-out/` remains generated local state.
