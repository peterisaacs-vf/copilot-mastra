---
name: start
description: >
  Begin a working session: resolve the user's Voiceflow project and working
  environment, then ask what they want to do and hand off. TRIGGER only on a
  new/empty session or a greeting with no concrete task ("hi", "let's start",
  "help me get oriented"). Do NOT load when the user names a task — build, edit,
  debug, test/stress-test, optimize, audit, KB, wiring, voice — those route to
  their own skill. For "what can you do / which skills exist" use `voiceflow-overview`.
---

You are starting a new Voiceflow Copilot session.

## Step 1 — Orient yourself

Read the `voiceflow-overview` skill before doing anything else. It is
the index of every skill, agent, and MCP tool available, plus the
routing rules that map user intent to the right capability.

## Step 2 — Resolve the project and working environment

Most work needs a `projectID` and `environmentID` resolved up front.

1. List the user's Voiceflow projects via
   `mcp__voiceflow__voiceflow_project` (operation `list`).
   - You will need a `workspaceID`. If the user hasn't told you one,
     ask once and remember the answer.
2. If they have one project, default to it.
3. If they have several, list the names and ask which to use.
4. **Resolve the working environment — never edit Main directly.**
   Per the `environments` skill: list environments via
   `voiceflow_environment` (list), reuse the plugin's working env
   (alias `copilot-staging`), or auto-clone Main into it and tell the
   user. All edits target this environment's draft, not Main's.
   - Read its **draft version ID** and use it for env-scoped tools —
     the same `draftVersionID` you'd otherwise read from the project's
     `environments` map (v1.3 schema), but for the working env, not
     Main. The environment `_id` returns 404 on env-scoped tools.
   - On v1.2 projects (no `environments` map), use `devVersion` or
     `activeEnvironmentID` — they're the same value.
   - Do **not** pass the alias `"development"` — it returns a 500
     on v1.3 projects.

## Step 3 — Ask the framing question

Once the project is resolved, ask exactly:

> "What do you want to work on?"

Suggest these as common options (one line each, no preamble):

- **Build or design an agent** — `build-agent` skill
- **Edit a prompt** — `prompting` skill
- **Optimize a prompt using transcripts** — `prompt-optimizer` skill
- **Debug a transcript or systemic failure** — `debug` skill or
  `debug-agent` subagent
- **Audit project wiring** (find captureResponse gaps, malformed
  tool configs) — `audit-wiring` skill
- **Set up evaluations** — `test` skill or `setup-evals-agent`
- **Review the agent end-to-end** — `review-agent` subagent
- **Something else** — describe it in plain English

## Step 4 — Route

Based on the user's answer, route to the appropriate skill or agent
using the routing table in `voiceflow-overview`. Pull in adjacent
skills as cross-references suggest.

If the user described a behavioral bug ("the bot keeps doing X"),
run `audit-wiring` BEFORE assuming a prompt fix is needed. Most
behavioral failures are wiring failures.

## Tone

Direct. Don't list capabilities at length unless asked. Get the
project resolved and the framing question asked in 1-2 short turns.
