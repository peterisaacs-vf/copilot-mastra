---
name: help
description: Print the full capability menu for the user — a formatted card of every skill, subagent, and MCP tool, with the plugin version. TRIGGER only when the user explicitly asks to SEE the whole menu ("show me everything you can do", "list all commands/skills"). For routing or "what can you do" use voiceflow-overview; to begin a session use start.
---

Render the plugin capability menu for the user. Do **not** keep a copy of the
catalog here — the canonical list of skills, subagents, and MCP tools lives in the
`voiceflow-overview` skill (single source of truth, so the two can't drift).

1. Load `voiceflow-overview` (via the `skill` tool) to get the current catalog.
2. Read `.claude-plugin/plugin.json` for the `version` field.
3. Present it for the user as a formatted card:

   ```
   # Voiceflow Plugin v<version> — Capabilities

   ## Skills        — (from voiceflow-overview)
   ## Subagents     — (from voiceflow-overview)
   ## MCP tools     — (from voiceflow-overview)

   ## Common workflows
   - "Build me an agent for X"      → describe it; build-agent triggers
   - "This transcript broke <url>"  → paste the URL; debug triggers
   - "The bot keeps doing X wrong"  → describe it; audit-wiring runs first
   - "Optimize the prompt"          → name the agent + transcript count; prompt-optimizer
   ```

No project lookup, no clarifying questions — just present the menu, then point the
user at `start` to begin or to name a task in plain English.
