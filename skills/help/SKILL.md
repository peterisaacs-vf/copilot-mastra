---
name: help
description: Show the full catalog of Voiceflow plugin capabilities — skills, agents, MCP tools, and common workflows.
---

Show the user the full plugin catalog. No project lookup, no
clarifying questions — just print the reference card.

Read `.claude-plugin/plugin.json` first to get the current `version`
field, then include it in the header. This lets users verify which
version of the plugin is actually loaded.

Format:

```
# Voiceflow Plugin v<version> — Capabilities

## Skills (auto-trigger on description match; pull in for methodology)

| Skill | When it triggers |
|---|---|
| voiceflow-overview | Generic Voiceflow questions; routing index |
| build-agent | Full agent build workflow |
| prompting | Writing/editing prompts (global, operator, playbook) |
| prompt-optimizer | Improving prompts using real transcript data (GEPA) |
| functions | Function code patterns and runtime |
| wiring-architect | How function variables, project vars, and tool defaults connect |
| audit-wiring | Structured audit of project wiring |
| knowledge-base | KB design, chunking, retrieval |
| voice | Voice-specific patterns (TTS, number formatting) |
| agent-architecture | Multi-agent / playbook architecture |
| debug | Transcript debugging methodology |
| test | Evaluation design |
| document | Project wiki for non-code context |

## Agents (spawn via the Agent tool for multi-step work)

| Agent | What it does |
|---|---|
| voiceflow:orchestrator | Routes high-level requests, manages session context |
| voiceflow:build-agent | Multi-step agent builds and edits |
| voiceflow:debug-agent | Deep-dive a single transcript |
| voiceflow:analyze-transcripts-agent | Bulk transcript analysis |
| voiceflow:test-runner-agent | Live test conversations via Dialog Manager |
| voiceflow:review-agent | Full architecture review |
| voiceflow:audit-kb-agent | KB health and retrieval debugging |
| voiceflow:setup-evals-agent | Designs and calibrates evals |
| voiceflow:prompt-optimizer-agent | Multi-round prompt optimization |

## MCP tools (v1 surface, 26 tools)

voiceflow_project, voiceflow_environment, voiceflow_secret,
voiceflow_behaviour, voiceflow_global_prompt,
voiceflow_agent_instructions, voiceflow_agent_routing,
voiceflow_playbook, voiceflow_workflow,
voiceflow_function, voiceflow_api_tool, voiceflow_mcp_tool,
voiceflow_integration, voiceflow_global_tool, voiceflow_system_tool,
voiceflow_knowledge_base, voiceflow_document, voiceflow_data_source,
voiceflow_variable, voiceflow_transcript_property,
voiceflow_test_conversation, voiceflow_simulation,
voiceflow_transcript, voiceflow_evaluation, voiceflow_analytics,
voiceflow_usage.

## Common workflows

- **First-time orientation** — run `/voiceflow:start`
- **"Build me an agent for X"** — describe it in plain English; the
  build-agent skill triggers automatically
- **"This transcript broke"** — paste the URL; the debug skill
  triggers
- **"The bot keeps doing X wrong"** — describe the failure; pull in
  audit-wiring before assuming it's a prompt issue
- **"Optimize the prompt"** — name the agent and how many transcripts
  to use; prompt-optimizer skill triggers

## Tips

- You don't need slash command syntax — describe what you want in
  plain English and the right skill auto-triggers.
- For multi-step work or to keep your main context clean, prefer
  delegating to a subagent (Agent tool with subagent_type).
- When in doubt, just say "what do you recommend" and the
  orchestrator will route.
```
