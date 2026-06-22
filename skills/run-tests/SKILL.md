---
name: run-tests
description: Run automated test scenarios from tests/manifest.yaml
---

## What This Command Does

Reads `tests/manifest.yaml`, executes each test scenario by dispatching
to the appropriate subagent, and produces a pass/fail summary.

## Usage

- `/run-tests` — run all scenarios
- `/run-tests debug-transcript` — run only debug-transcript scenarios
- `/run-tests debug-gyg-function-timeout,test-superloop-new-customer` — run specific IDs
- `/run-tests --dry-run` — show what would run without executing

## Procedure

### Step 1: Load manifest

Read `tests/manifest.yaml`. Parse all scenarios. If `the user's request` contains
a filter, apply it:

- If a command type (e.g. `debug-transcript`), filter to scenarios with
  that `command` field.
- If comma-separated IDs, filter to those specific `id` values.
- If `--dry-run`, show the filtered scenario table and stop.
- If empty or `all`, run everything.

Show the user what will run:

```
Running X scenarios:
- [id]: command (project) — "expected finding summary"
...

Estimated: ~Y minutes. Proceed?
```

Wait for confirmation before starting.

### Step 2: Resolve projects

Read `voiceflow-projects.json` using the Read tool. For each scenario,
confirm the project exists in config. Fail fast if any project is missing.

### Step 3: Execute scenarios

For each scenario, spawn a subagent based on the `command` field.
Launch up to 5 in parallel (these are Sonnet workloads).

Every subagent prompt starts with this preamble:

```
AUTOMATED TEST MODE — DO NOT ASK CLARIFYING QUESTIONS.
All parameters are pre-defined. Execute immediately with these inputs.
Do not offer follow-up actions or ask "should I go ahead?"
Complete your analysis and return structured output.

Project config: read voiceflow-projects.json at the workspace root.
```

#### Dispatch table

| Command | Subagent Type | Model | How to invoke |
|---------|--------------|-------|---------------|
| `debug-transcript` | `debug-agent` | sonnet | Pass transcript URLs/IDs, project name, expected finding as context |
| `analyze-transcripts` | `general-purpose` | sonnet | Include full analyze-transcripts-agent.md instructions via file path, pre-fill time period/focus/output |
| `test-agent` | `general-purpose` | sonnet | Include full test-runner-agent.md instructions via file path, pre-fill scenario/rules/turns |
| `review-agent` | `review-agent` | sonnet | Pass project name |
| `audit-kb` | `audit-kb-agent` | sonnet | Pass project name, any specific focus |
| `setup-evals` | `setup-evals-agent` | sonnet | Pass project name. NOTE: in automated mode, the agent should still PROPOSE evals and list what it would create, but auto-confirm creation since this is a test run |
| `build-integration` | `build-agent` | sonnet | Pass API docs URL/path |

#### Prompt template per command type

**debug-transcript:**
```
{preamble}
Debug this Voiceflow transcript for project "{project}".
Transcript URL(s): {urls}
Transcript ID(s): {transcript_ids}

Context from test manifest:
{context field if present}

Expected finding (for your reference, do not just parrot this back —
verify independently): {expected.root_cause}

Follow your full methodology. Return structured findings including:
- Root cause
- Attribution (agent-side, upstream, downstream)
- Evidence with turn numbers and quotes
- Suggested fix with exact text
```

**analyze-transcripts:**
```
{preamble}
Read the full analyze-transcripts methodology from:
.claude/agents/analyze-transcripts-agent.md

Then execute it with these parameters:
- Project: {project}
- Time period: {args time period, or "last 7 days"}
- Focus: {args focus, or "general health check"}
- Output: {args output, or "quick summary in chat"}

Skip the clarifying questions step — all parameters are provided above.
Start from "Load context before analyzing anything" (step 3).
```

**test-agent:**
```
{preamble}
Read the full test-agent methodology from:
.claude/agents/test-runner-agent.md

Then execute it with these parameters:
- Project: {project}
- Scenario: {scenario field}
- Rules to watch: extract from agent export (do not skip this)
- Turns: 5-8 unless specified otherwise

Skip the clarifying questions step — the scenario is pre-defined above.
Start from "Load the agent's rules" (step 3).
Apply turn-completion gating after every interact — do not inject the next
scripted user message during a processing gap; poll get_state instead.
```

**audit-kb:**
```
{preamble}
Audit the knowledge base for project "{project}".
Args: {args}

{expected.should_find if present, prefixed with:
"Previous audit found these issues (verify independently):"}

Follow your full methodology. Propose fixes, then auto-apply since
this is an automated test run. Re-run failing queries to verify.
```

**setup-evals:**
```
{preamble}
Set up evaluations for project "{project}".
Args: {args}

Extract rules from the agent's system prompt. Design evals.
Create them and calibrate against real transcripts.
In automated test mode, proceed with creation without waiting
for user confirmation.
```

### Step 4: Collect and compare results

As each agent completes, capture its output. Compare results to the
manifest's `rubric_target`:

```
| Scenario | Command | Target | Actual | Status |
|----------|---------|--------|--------|--------|
| debug-gyg-function-timeout | debug-transcript | 7/7 | 7/7 | PASS |
| test-superloop-new-customer | test-agent | 5/6 | 4/6 | FAIL |
| analyze-turo-recent | analyze-transcripts | 7/8 | 7/8 | PASS |
```

A scenario PASSES if actual >= target. FAILS if actual < target.

### Step 5: Produce summary

```
## Test Run Summary

**Date**: {date} | **Scenarios**: {total} | **Passed**: {pass} | **Failed**: {fail}

### Results
{comparison table from step 7}

### Failures
{for each failed scenario:}
- **{id}**: Expected {target}, got {actual}. Weakest criteria: {list}.
  Report: {file path}

### Verdict: PASS / FAIL
```

## Important Notes

- **Cost awareness**: Running all scenarios spawns multiple Sonnet agents.
  Always show the scenario count and get confirmation before starting.
- **Non-deterministic tests**: analyze-transcripts and test-agent produce
  different results each run. Their targets should be thresholds, not
  exact scores.
- **Setup-evals creates real resources**: The setup-evals scenario will
  create actual evaluations on the project. This is intentional for
  testing but be aware it mutates state.
