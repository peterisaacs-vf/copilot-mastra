---
name: projects
description: >
  List the user's Voiceflow projects in a workspace (fast read-only utility). TRIGGER
  ONLY when the user explicitly asks to list / see / pick / switch projects, or to
  resolve which project to work on. Do NOT load for build, debug, test, KB, prompt,
  wiring, voice, optimize, or any other task — those route to their own skills.
---

Quick read-only utility — list the user's Voiceflow projects.

Call `mcp__voiceflow__voiceflow_project` with operation `list`.
- If `the user's request` looks like a workspaceID (24-character hex), pass it as
  the workspaceID.
- Otherwise, ask the user for their workspaceID once, then list.

Present the result as a compact table:

| Name | ID | Last updated |
|---|---|---|

If only one project, just say "You have one project: {name}" and offer to
run `/voiceflow:inspect-agent {name}`.

## Tone

Terse. One-screen output. Do not pull skills — this is a fast utility,
not a routing entry point.
