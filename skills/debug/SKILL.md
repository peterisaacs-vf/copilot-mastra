---
name: debug
description: >
  Systematic debugging methodology and common failure patterns for Voiceflow
  agents. Covers the 5-step single-transcript process, bulk analysis workflow,
  and fix templates for every common failure type.
  TRIGGER when: user shares a transcript URL or transcript ID; says "what
  went wrong", "why did the bot do X", "the agent is failing", "this
  conversation broke", "the bot stalled / looped / repeated"; pastes
  trace events; asks to investigate or diagnose a specific session;
  reports a customer-reported issue tied to a conversation.
version: 0.2.0
---

# Voiceflow Agent Debugging

## When to Debug

- A transcript shows unexpected agent behavior
- A customer reported an issue
- Eval scores are lower than expected
- You need to analyze multiple transcripts for patterns
- An agent is making hallucination/errors/loops

---

# Single Transcript Debugging

## Step 0: Load Project Context (Before Any Analysis)

Before reading a single turn, check whether the project has architecture
documentation:

1. **Load the agent architecture** — export the agent or list playbooks
   to understand: which sub-agents exist, what tools are available, and
   what the expected flows look like. This prevents false conclusions
   like flagging "hallucination" when data was injected via a launch event.
2. **If you need specific prompt or function details**, pull on demand —
   use `voiceflow_playbook` (get) for a playbook's prompt, or
   `voiceflow_function` (get) for function code. Fall back to
   `export_agent` for a full snapshot.

**Why this matters:** Transcripts show what happened, but not WHY it
was designed that way. A wiki bridges that gap. Without it, you're
reverse-engineering architecture from traces — slow and error-prone.

## Step 1: Understand the Expected Behavior

Before analyzing what went wrong, establish what SHOULD have happened:
- What was the user trying to do?
- What should the agent have said/done?
- What tools should have been called?
- What was the expected outcome?

## Step 2: Identify the Problem Turn

Pinpoint exactly where things went wrong:
- Which turn first showed unexpected behavior?
- Was it a user input issue or agent response issue?
- Did a tool call fail or return unexpected data?

## Step 3: Analyze Root Cause

**Before drawing any conclusion, cross-reference the agent's system
prompt against its behavior.** The formatted transcript includes the
full system prompt on the first `ai result` entry per agent (in the
`prompt.system` field). This is your primary reference — check it
BEFORE exporting the agent or making assumptions.

**When the user reports a wrong value, use this two-pass process:**

**Pass 1 — Extract (no analysis yet):**
From `prompt.system`, list ALL hardcoded data values as a plain list:
- Numbers (prices, percentages, deductibles, limits, phone numbers)
- Names (people, products, plans, tiers)
- URLs, email addresses, dates, hours of operation
- Any other specific facts the prompt states as truth

Output the list. Do NOT interpret, correct, or analyze at this stage.

**Pass 2 — Compare:**
Take each extracted value and compare it against:
- The user's reported correct value
- What the agent actually said in the transcript

If ANY extracted value matches the WRONG value the agent said:
→ The prompt is the root cause. The agent followed its instructions. STOP.
→ Do NOT proceed to KB, tool, or hallucination analysis.
→ Report: "The prompt hardcodes [wrong value] in [section]. Correct is [X]."

Only proceed to further investigation if the prompt does NOT contain the
wrong value. This is critical because the prompt may contain the exact
wrong value the agent said — the agent was following its instructions
perfectly, the instructions are just wrong.

Specifically:
- If you think the agent hallucinated data → first extract the hardcoded
  values from the prompt (Pass 1) and compare (Pass 2). If the prompt
  contains the wrong value, that IS the root cause. Only then check
  whether data was injected at launch or set by a previous tool call
  (check variable changes in the transcript).
- If you think a tool should have been called → check the prompt's
  tool instructions, then the wiki/export to see if the data is
  available through another path (e.g. session variables, KB, launch
  payload).
- If you think the agent broke a rule → verify the rule actually exists
  in the current prompt (visible in the transcript), not just in your
  assumptions.

**When a function/tool fails or behaves unexpectedly:**

Pull the function details directly — prefer `voiceflow_function` (get)
for the code + description, `voiceflow_function` (list_variables) for
its inputs/outputs, and `voiceflow_function` (list_paths) for its
output paths. Fall back to `export_agent` for production-only projects.

Use these details to:

1. **Extract the function's expected inputs** — what variables does it need?
2. **Compare against what the transcript shows** — what was actually passed?
   (Check the transcript's debug entries for `inputVars` on the function call)
3. **Report the mismatch** — e.g. "Function expects `jwt_token` and
   `admin_endpoint`, but received `{}`. The canvas step has broken variable
   bindings."
4. **Check outputVars** — does the function define outputs that downstream
   steps depend on? If the function failed, those outputs are empty,
   which may cause cascading failures.

This is how you diagnose wiring issues vs code bugs vs API errors:
- `inputVars: {}` when function expects inputs → **canvas binding issue**
- `inputVars` populated but function fails → **code bug or API error**
- Function succeeds but outputs are wrong → **logic bug in function code**

Then categorize:
- **Prompt issue**: Missing instruction, unclear guidance, conflicting rules
- **Tool issue**: Wrong tool called, wrong parameters, missing tool, failed API
- **Wiring issue**: Function step has missing/broken variable bindings on canvas
- **Context issue**: Lost conversation context, didn't remember earlier info
- **Edge case**: Scenario not covered in prompt

## Step 4: Propose Specific Fix

Recommend a concrete change:
- Exact text to add/modify in the system prompt
- Tool definition changes
- Flow adjustments

## Step 5: Verify the Fix

Test that the fix works without breaking other scenarios.

---

# Analysis Pitfalls — Read Before Drawing Conclusions

When analyzing transcripts (especially in bulk), guard against these common traps:

1. **Correlation ≠ Bug**: High turn counts, many tool calls, or long transcripts don't automatically mean something is broken. Always check whether the *outcome* was correct before labeling something as a failure. A transcript with 2000 turns might be a bug — or it might be a user who came back 20 times over 3 weeks and got helped each time.

2. **Verify with event data, not just tool calls**: A tool being *called* doesn't mean it *failed* or *succeeded*. Always check for corresponding outcome events (e.g. `live-agent-handoff` after `transfer_to_human`, successful API responses after lookup tools).

3. **Check timestamps before assuming loops**: Rapid-fire turns within seconds = likely a loop. Turns spread across days = likely repeat visits. Always look at the time dimension.

4. **Don't let one transcript contaminate your read of others**: If you find a real bug in transcript A, don't assume transcripts B and C with similar surface metrics have the same bug. Verify each independently.

5. **Separate agent issues from upstream/downstream issues**: The agent might be working perfectly, but the problem lives elsewhere (e.g. human agents not resolving the ticket, backend API returning stale data, account holds never being lifted).

---

# Transcript Analysis Checklist

When reviewing a transcript:

### User Turns
- [ ] What was the user trying to accomplish?
- [ ] Was the input clear or ambiguous?
- [ ] Were there any ASR errors (voice)?

### Agent Turns
- [ ] Did the response follow the system prompt?
- [ ] Was the tone appropriate?
- [ ] Was the length appropriate?
- [ ] Did it reveal anything it shouldn't?

### Tool Calls
- [ ] Were the right tools called?
- [ ] Were parameters correct?
- [ ] What did the tool return?
- [ ] Was the return data used correctly?
- [ ] Were errors handled properly?

### Flow
- [ ] Did the conversation progress logically?
- [ ] Were required steps followed in order?
- [ ] Was context maintained throughout?
- [ ] Did it end appropriately?

---

# Bulk Analysis Methodology

When analyzing multiple transcripts (as in a quality audit), follow this structured approach. Do NOT improvise the analysis — follow these steps in order.

## Reference files

Pulled out of the core to keep this skill focused — load with `skill_read` when you need the depth:

- `references/failure-patterns.md` — recurring failure modes (hallucination, tool-not-called, error-not-handled, info leakage, lost context, tone, length, voice, handoff, transfer-loop vs repeat-contact, call-not-ending) with detection + fix templates. Read when classifying a root cause.
- `references/bulk-analysis.md` — multi-transcript analysis (triage, deep-reading minimums, cross-correlation, evidence standards). Read when analyzing many transcripts at once.

## Key Findings So Far
- [F1] {finding} — evidence: transcript {id}, turn {n}
- [F2] {finding} — evidence: transcript {id}, turn {n}

## Open Questions
- [ ] Need to check KB coverage for {topic}
- [ ] Transcript {id} had unusual tool call pattern — deep-read needed

## Decisions Made
- Classified {pattern} as agent-side (prompt issue, not upstream)
- Excluded {transcripts} from analysis — test/internal traffic

## Next Steps
- Deep-read transcripts: {id1}, {id2}, {id3}
- KB queries needed: {topic1}, {topic2}
```

Use the Write tool to save notes to a scratch file, or keep them
inline if the analysis is short enough.

# Quick Diagnosis Reference

| Symptom | Check First | Likely Cause |
|---------|------------|--------------|
| Agent provides wrong info | Tool called? | Hallucination or tool error |
| Agent doesn't use tool | Prompt define when? | Tool not called |
| Agent repeats question | Context passed? | Lost context |
| Numbers wrong (voice) | Format specified? | Voice formatting missing |
| Response too long | Length target specified? | Response length rule missing |
| Mentions internal systems | Prompt say silent? | Information leakage |
| Wrong tone | Tone section in prompt? | Wrong tone/style |
| Doesn't transfer when needed | Handoff rules in prompt? | Handoff logic missing |
| Transfers too much | Loop check: timestamps | May be repeat contact, not loop |
| Call won't end | end_call mentioned? | Call termination missing |

---

## Related skills

- **`audit-wiring`** — run this before assuming a transcript failure is a prompt or model issue. Wiring gaps produce silent empty-default failures that look like reasoning errors. Most "the LLM ignored my instructions" turns out to be a wiring issue.
- **`wiring-architect`** — for the conceptual model of how function outputs reach project state and downstream tool defaults.
- **`prompt-optimizer`** — once you've ruled out wiring, use this to optimize prompts based on transcript data.
- **`functions`** — when a function call is the suspected failure point.
- **`voiceflow-overview`** — index of all available skills.
