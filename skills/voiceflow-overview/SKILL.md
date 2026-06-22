---
name: voiceflow-overview
description: >
  The capability catalog and routing reference for the Voiceflow plugin: the list of
  skills, specialized subagents, and MCP tools, which to use for a given intent, and
  the pre-flight methodology. TRIGGER when the user asks "what can you do / what can
  you help with / what agents or tools are there", or when you need to look up which
  skill, subagent, or MCP tool handles a task. This is the catalog — to *begin* a
  session (resolve the project + frame the work) use `start`; to *print* the menu for
  the user use `help`.
version: 0.2.0
---

# Voiceflow Plugin — Catalog Reference

The basic routing decision tree (user intent → skill or slash command) is
already injected at session start by the SessionStart hook. This skill is
the fuller catalog — agents list, raw MCP tool names, and the
methodological pre-flight rules.

If the user has not yet identified which Voiceflow project they're working
on, list their projects first via `mcp__voiceflow__voiceflow_project`
(operation `list`).

---

## Agents (specialized subagents)

These get spawned via the `Agent` tool. Use them when a task is multi-step
or needs an isolated context.

| Agent | What it does |
|---|---|
| `voiceflow:orchestrator` | Routes high-level requests, manages session context |
| `voiceflow:build-agent` | Multi-step agent builds, edits, configurations |
| `voiceflow:debug-agent` | Deep debugging of a single transcript |
| `voiceflow:analyze-transcripts-agent` | Bulk transcript analysis for systemic patterns |
| `voiceflow:test-runner-agent` | Runs live test conversations via Dialog Manager |
| `voiceflow:review-agent` | Full architecture review (prompts, tools, KB, evals) |
| `voiceflow:audit-kb-agent` | KB health check and retrieval debugging |
| `voiceflow:setup-evals-agent` | Designs and calibrates evaluations |
| `voiceflow:prompt-optimizer-agent` | Multi-round prompt optimization with GEPA |

---

## Skills (composable methodology)

| Skill | When to use |
|---|---|
| `build-agent` | Build, design, or scaffold a Voiceflow agent end-to-end |
| `prompting` | Writing or editing a global prompt, operator instructions, or playbook prompt |
| `prompt-optimizer` | Improving an existing prompt using real transcript data (scoring + reflection) |
| `functions` | Writing or debugging Voiceflow function code (the JS that calls APIs) |
| `wiring-architect` | Designing how data flows between functions, project variables, and agent tool defaults — captureResponse, shouldFulfill, defaultValue patterns |
| `audit-wiring` | Running a structured audit of a project's wiring to find captureResponse gaps and malformed tool configs |
| `knowledge-base` | KB design, document structure, chunking, retrieval optimization |
| `voice` | Voice-specific patterns — STT/TTS, number formatting, voice guardrails |
| `agent-architecture` | Multi-agent architecture — global prompt, operator, playbooks, routing |
| `debug` | Debugging methodology for individual transcripts or systemic failure patterns |
| `test` | Evaluation design, test case calibration, eval coverage |
| `document` | Project wiki for non-code context — partner profile, business rules, integration notes |

---

## MCP tools (raw platform access — v1 surface, 26 tools)

The Voiceflow MCP exposes the tools below. Each takes an `operation`
parameter. Tool names are bare; the host-assigned MCP prefix
(`mcp__voiceflow__*` if plugin-declared, `mcp__<uuid>__*` if installed
as an account-level Claude Code / Cowork connector) varies — pick the
matching tool from the available list regardless of prefix.

**Project & org foundation:**
`voiceflow_project`, `voiceflow_environment`, `voiceflow_secret`,
`voiceflow_behaviour`

**Global agent (top-level prompt + routing):**
`voiceflow_global_prompt`, `voiceflow_agent_instructions`,
`voiceflow_agent_routing`

**Agentic structure:**
`voiceflow_playbook`, `voiceflow_workflow`

**Tools (callable from the agent):**
`voiceflow_function`, `voiceflow_api_tool`, `voiceflow_mcp_tool`,
`voiceflow_integration`, `voiceflow_global_tool` (agent-level
attachment), `voiceflow_system_tool`

**Knowledge:**
`voiceflow_knowledge_base`, `voiceflow_document`, `voiceflow_data_source`

**State:**
`voiceflow_variable`, `voiceflow_transcript_property`

**Test:**
`voiceflow_test_conversation`, `voiceflow_simulation`

**Measure:**
`voiceflow_transcript`, `voiceflow_evaluation`, `voiceflow_analytics`,
`voiceflow_usage`

---

## Pre-flight checks (before any non-trivial work)

The SessionStart primer summarizes these; the rationale lives here.

- **Behavioral bugs are wiring failures more often than prompt failures.**
  When a user says "the bot keeps doing X", `audit-wiring` belongs in
  the path BEFORE any prompt edit. The mechanism: function and API tools
  write outputs into project variables via `captureResponse` rules; if
  capture is missing or the `defaultValue` is wrong, no prompt change
  can recover the data. Most "the prompt isn't working" reports are
  empty-variable bugs masquerading as prompt bugs.
- **Optimization must be data-driven.** Before running
  `prompt-optimizer`, pull a representative slice of real transcripts.
  Optimizing against vibes produces prompts that look elegant and
  perform worse than what they replaced.
- **Tool creation needs wiring context.** Before calling
  `voiceflow_global_tool add`, read the `wiring-architect`
  patterns. The default tool config does not capture outputs by default
  and this is the #1 source of "the LLM has the right tool but acts
  like the data isn't there" bugs.

---

## Cross-references at a glance

Some routing combinations come up often enough to call out:

- "Build an agent" → `build-agent`, plus `prompting`, `functions`,
  `knowledge-base`, `agent-architecture`, `wiring-architect`
- "Optimize a prompt" → `prompt-optimizer`, plus `wiring-architect`
  (the prompt failure may be a wiring failure)
- "The bot calls X with empty args" → `wiring-architect` + `audit-wiring`
- "Review the agent" → `review-agent` subagent, plus `audit-wiring`
  and `audit-kb-agent`
- "Build a voice agent" → `voice` + `build-agent` + `prompting`

For the full intent → skill mapping, see the SessionStart hook output
(injected automatically into context at session start).
