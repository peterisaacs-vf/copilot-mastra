---
name: prompt-optimizer
description: >
  Optimize Voiceflow agent prompts using transcript data and LLM-driven
  reflection. Pulls real conversations, scores the current prompt,
  identifies failure patterns, and produces an improved prompt with a
  clear before/after diff.
  TRIGGER when: user says "optimize the prompt", "improve the prompt",
  "the prompt isn't working well", "fix the prompt based on transcripts",
  "why is the agent failing", or asks to improve agent quality using
  real conversation data.
version: 0.1.0
---

# Prompt Optimizer

Optimize a Voiceflow agent's prompt by analyzing real transcript data,
scoring responses against the agent's purpose, and proposing targeted
improvements.

---

## Overview

The optimizer follows this loop:

1. **Pull** — Fetch transcripts for the target agent
2. **Parse** — Extract turns, system prompts, tool calls (handles v3 + v4)
3. **Define** — Load or create an agent definition (what the prompt should achieve)
4. **Score** — Judge each turn against an auto-generated rubric
5. **Reflect** — Analyze failures and propose prompt changes
6. **Deploy** — Push to VF (v4) or produce a paste-ready handoff (v3)
7. **Verify** — Smoke test the optimized prompt via dialog manager

For multi-round optimization (GEPA mode), steps 5-6 repeat with
multiple candidates per round, Pareto-selected for quality vs brevity.

---

## Step 1: Resolve the agent

Ask the user:
- **Which project?** (list with `voiceflow_project`)
- **Which agent/playbook?** (e.g., "the main agent", "payments agent")
- **How many transcripts?** (default: 50, recommend 30-60)

Then determine:
- **Version**: v3 (named agents like "Supervisor Agent") or v4 (playbooks like "new_customer")
- **Agent model**: needed for judge tiering (Haiku agent → Sonnet judge, Sonnet → Opus)

## Step 2: Pull and parse transcripts

1. Fetch transcripts via `voiceflow_transcript` (list_transcripts) with date range
2. For each transcript, fetch full logs via `voiceflow_transcript` (get_transcript, format: raw)
3. Parse into turns — extract user messages, agent responses, tool calls
4. For v4: fetch the global prompt via `export_agent` and compose global + playbook
5. Filter to the target agent's turns only

**Version detection:**
- v3: agent names are proper-cased ("Supervisor Agent (V5)", "Account Agent")
- v4: agent names are "Agent" (the main agent) or snake_case ("new_customer")

**v4 global prompt composition:**
The transcript only contains playbook instructions. The global prompt
(persona + guidelines) must be fetched from the export at
`version.settings.llm.globalPrompts.persona`. Join them:
`[global persona] + [playbook instructions]` = what the LLM sees.

## Step 3: Agent definition

Check if an agent definition exists. If not, create one by asking:

- **What does this agent do?** (purpose, 1-2 sentences)
- **What should it handle vs not handle?** (scope)
- **What are the hard rules?** (things that must never break)
- **How should it sound?** (tone)
- **What does success look like?** (primary metric)

Structure the definition as:

```yaml
agent:
  name: "Agent name from transcripts"
  project: "project-name"
  type: "routing | response | form | faq"
  model: "model from transcript metadata"
purpose:
  summary: "..."
  goals: [...]
scope:
  handles: [...]
  does_not_handle: [...]
  routes_to: [{target, when}]  # for routing agents
hard_rules:
  blockers: [{id, rule}]       # violations = optimization rejected
  warnings: [{id, rule}]       # important but not deal-breakers
tone:
  style: "..."
  rules: [...]
success_metrics:
  primary: "..."
rubric_weights:
  accuracy: 60    # adjust based on agent type
  tone: 20
  completeness: 10
  safety: 10
```

**Rubric weights by agent type:**
- Routing classifier: accuracy 70%, tone 10%, completeness 10%, safety 10%
- Response agent: accuracy 50%, tone 20%, completeness 20%, safety 10%
- FAQ agent: accuracy 40%, tone 20%, completeness 30%, safety 10%

## Step 4: Score (baseline)

Generate the rubric from the agent definition, then score each turn.

### Judge tier

Spawn one Claude judge per turn via the `Agent` tool. Tier picked by
`vf-judge-model` based on the deployed agent's model:
- Agent on Haiku → judge on Sonnet
- Agent on Sonnet → judge on Opus
- Agent on Opus → judge on Opus
- Agent on a non-Anthropic model (Voiceflow CORE, etc.) → judge on Sonnet (default) or Opus for borderline / hard-rule turns

**Parallelism**: spawn up to 10 `Agent` calls at once across turns to keep latency bounded.

Each judge call gets the rubric + one turn (user message, agent
response, conversation history, tool calls). Returns scores per
dimension + feedback per the scoring contract below.

**Split examples:**
- Train (60%): used by the reflection model to identify patterns
- Validation (20%): used to score candidate prompts during optimization
- Holdout (20%): final evaluation only — never seen during optimization

Present baseline results:

```
Baseline: [agent name]
Overall: 0.77 | Failing: 4/16 turns

| Dimension | Score |
|-----------|-------|
| Accuracy | 0.72 |
| Tone | 0.85 |
| Completeness | 0.68 |
| Safety | 0.91 |

Top failures:
- T1 (0.55): "cheapest option" — KB searched but answer never delivered
- T3 (0.45): "mobile plans" — no KB search, no info given
```

### Scoring contract

Every judge must emit strict JSON, nothing else:

```json
{
  "accuracy": 0.0,
  "tone": 0.0,
  "completeness": 0.0,
  "safety": 0.0,
  "feedback": "1-2 sentences explaining the worst dimension"
}
```

All scores are 0.0–1.0. End the rubric prompt with "Return strict JSON only — no prose, no markdown." Validate parse on receipt; if a judge's output won't parse, retry that judge once before giving up.

## Step 5: Reflect and optimize

### Single-pass mode (default)

Spawn an **Opus** reflection agent with:
- The current prompt
- The agent definition (purpose, rules, metrics)
- The failing examples with judge feedback
- A few passing examples for contrast
- Model-specific prompting guidelines (fetched from reference files)

The reflection model:
1. Identifies 1-3 failure patterns with evidence
2. Proposes specific changes (what to add/remove/modify, and where)
3. Produces the complete optimized prompt

### GEPA mode (multi-round)

For deeper optimization, use `the user's request` = "gepa" or "multi-round":

**Round 1**: Generate 3 candidate prompts with different strategies:
- Variant 1: Targeted fixes (minimal edits)
- Variant 2: Structural rewrite (reorganize for clarity)
- Variant 3: Compression (same fixes, aggressively shorter)

**Score all 3** with the judge against the validation set.

**Pareto select**: Pick the best candidate balancing quality (80%) vs
brevity (20%). This prevents prompt bloat.

**Round 2**: Build on the Round 1 winner. 3 more variants focused on
remaining failures, compression, and strengthening the weakest dimension.

**Round 3**: Polish. Fine-tune wording, handle remaining edge cases,
minimize length.

**Stop when**: improvement < 2% between rounds, score >= 0.95, or
max rounds (3) reached.

In every round, "score all candidates" means: run each candidate
prompt through the deployed model on the validation set (Step 5b),
*then* judge the outputs. Judging the prompt text without seeing what
the model actually produces is guessing.

## Step 6: Present results

Output format (display directly in chat):

```
### Results

| Metric | Before | After | Change |
|--------|--------|-------|--------|
| Overall score | 0.77 | 0.85 | +10% |
| Prompt length | 5324 chars | 3850 chars | -28% |
| Failing turns | 4/16 | 0/16 | |
```

Then show changes grouped by prompt section:

```
## Here's what changed: [Agent Name]

### [Section name, e.g. "Routing rules"]

[One sentence: why this change, which turns it fixes]

**Removed**
​```
[exact text removed]
​```

**Added**
​```
[exact replacement]
​```
```

Then offer: "Want to see the complete optimized prompt?"

## Step 7: Deploy

### v4 agents (direct push)

Build the deploy plan — split the optimized prompt back into global
persona and playbook instructions. Show the user:

```
## Ready to deploy: [Agent Name]

I'll make these changes:

1. Update global persona
   Tool: voiceflow_global_prompt > update
   [preview]

2. Update [playbook] instructions
   Tool: voiceflow_playbook > update
   [preview]

Should I go ahead?
```

After confirmation, execute the MCP calls and run a smoke test:
send the originally-failing messages via `voiceflow_test_conversation` (interact)
and re-score the responses.

### v3 agents (manual handoff)

```
## How to apply

1. Open your project in Voiceflow Creator
2. Find [Agent Name] in the canvas
3. Open the agent step > Instructions field
4. Replace with the optimized prompt below
5. Save and test in the prototype

## Complete optimized prompt

[full prompt in code block]
```

---

## Prompting guidelines

The reflection model loads model-specific prompting guidelines to ensure
the optimized prompt is structured for the target model's strengths.

**Claude models:** XML tags primary, explain WHY behind constraints,
specificity over emphasis, 3-5 examples for few-shot.

**GPT models:** Markdown headers primary, hard constraints over soft
guidance, numbered sequences for workflows, key instructions at both
start and end for long context.

Guidelines are cached locally with a 30-day freshness window. If stale
or if the target model isn't covered, do a web search to refresh from
the provider's official docs before optimizing.

---

## Rules

- **Always ask** which agent and how many transcripts before starting
- **Always show baseline scores** before optimizing
- **Always test candidates against the live runtime** (Step 5b) before scoring or presenting — push the candidate as a draft, compile (asking the user to click if needed), run via `voiceflow_test_conversation`. Never judge a candidate prompt by its text alone, and never test it through a model-only path that bypasses tools and KB
- **Always show the diff** before deploying — never push without approval
- **Never skip the holdout set** — final scores must come from unseen data
- **Never weaken hard rules** — blockers from the definition are sacred
- **Judge one tier up** — Haiku agent gets Sonnet judge, Sonnet gets Opus
- **Reflect with Opus** — the reflection model must be frontier-tier
- **v3 = handoff, v4 = push** — don't try to write to v3 agents via API

---

## Reference files

Pulled out to keep this skill focused — load with `skill_read` when you need the depth:

- `references/runtime-validation.md` — testing a candidate prompt against the deployed runtime via test_conversation — why this path vs running the model directly, and cost/time per validation turn.

## Related skills

- **`wiring-architect`** — CRITICAL pre-flight. Before iterating on prompt candidates, check whether the failure is actually a wiring issue (e.g. tool defaults from a project var that's never set). A surprising fraction of "prompt failures" are wiring failures and no prompt change can fix them.
- **`audit-wiring`** — run this against the project's export before generating prompt candidates. If wiring gaps exist, surface them as fixes instead of (or alongside) prompt changes.
- **`prompting`** — for the prompt-structure conventions the optimizer should produce.
- **`debug`** — for understanding why specific transcripts failed.
- **`functions`** — when the failure pattern involves a function call being made wrong.
- **`voiceflow-overview`** — index of all available skills.
