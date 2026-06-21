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

## Phase 0: Load Project Context

Same as single-transcript Step 0 — read the wiki BEFORE pulling any
transcripts. For bulk analysis this is even more critical: you're about
to scan dozens of conversations, and without understanding the
architecture you'll misclassify failures repeatedly.

If no wiki exists and you're doing a bulk analysis, strongly recommend
creating one first. This pays for itself immediately — every transcript
you read after is faster.

## Transcript Format Selection

Use the right format for the task:

| Format | Use when | Size |
|--------|----------|------|
| `summary` | Bulk analysis, triage, scanning multiple transcripts | ~10-15k per transcript |
| `formatted` | Deep reading a single transcript, full debug trace, includes system prompt per agent | ~50-100k per transcript |
| `raw` | Investigating MCP/API issues, need unprocessed data | 200k+ per transcript |

**Default to `summary` for bulk work.** Switch to `formatted` only for
the 5-10 transcripts you deep-read. Never pull 20+ transcripts in
`formatted` or `raw` — you'll hit context limits.

## Phase 1: Evaluation Triage (Do This First)

Before reading any transcript in detail, build a triage matrix:

1. Pull your transcript sample (20-30 transcripts from the target date range) using `summary` format.
2. For each transcript, call `get_transcript_evaluation` for every relevant evaluation.
3. Build a mental table:

```
Transcript ID | Eval A | Eval B | Eval C | Total Fails
------------- | ------ | ------ | ------ | -----------
abc123        | FAIL   | FAIL   | PASS   | 2
def456        | PASS   | PASS   | PASS   | 0
ghi789        | FAIL   | PASS   | FAIL   | 2
```

4. Sort by total failures. The top 5 get deep-read first.
5. Count pass/fail rates per evaluation. Example: "Escalation eval: 18/28 failed (64%)" — this alone tells you where the systemic problem lives.

## Phase 2: Deep Reading (Mandatory Minimums)

Switch to `formatted` format for this phase — you need the full debug
traces (tool calls, AI results, routing) to diagnose root causes.

You MUST read at least 8-10 transcripts in full. Here's why and how:

**Why 8-10?** The first pattern you find is usually the most obvious one. The second and third patterns — often more impactful — only emerge after reading enough variety. Stopping at 4-5 transcripts will miss secondary issues.

**Selection strategy:**
- 5 worst performers (most eval failures)
- 3 passing transcripts (you need the contrast — what does "correct" look like?)
- 2 edge cases (unusual turn counts, unusual user inputs, or mixed eval results)

**For EACH transcript you read, capture:**
- Turn number where the issue occurred (be specific: "Turn 7" not "middle of conversation")
- Direct quote from the agent (the exact problematic text, 1-2 sentences)
- What the agent should have done (cite the system prompt rule or wiki section)
- Which evaluation(s) failed and what the eval was checking for
- Pattern match: does this match an issue you've already seen, or is it new?

## Phase 3: Cross-Correlation (Do NOT Skip)

After deep reading, explicitly answer these questions:

1. **Eval clustering**: Do transcripts that fail Eval A also tend to fail Eval B? If yes, they likely share a root cause.
2. **CSAT correlation**: Do low-CSAT transcripts overlap with specific eval failures? Quantify: "4 of 5 CSAT=1 transcripts also failed the escalation eval."
3. **Sub-agent distribution**: If the agent uses multiple sub-agents/playbooks, are failures concentrated in one? Example: "80% of escalation failures came from the Account sub-agent."
4. **Failure mode diversity**: How many DISTINCT failure modes did you find? List them. If you only found one, you probably didn't read enough transcripts.
5. **Upstream vs. agent issues**: For each failure, is the agent actually at fault, or is the problem upstream (user confusion, KB gaps) or downstream (human agents not resolving, backend systems)?

## Phase 4: Evidence Standards

When reporting findings, every claim must meet this bar:

- **Frequency**: "This affected N out of M transcripts (X%)" — never say "several" or "some."
- **Examples**: Cite at least 3 specific transcript IDs with Creator URLs for any pattern you report.
- **Quotes**: Include the exact agent text that demonstrates the issue.
- **Fix specificity**: Don't say "improve the prompt." Say exactly what text to add/change, in what section, with a before/after example if possible.
- **Severity justification**: Explain why you ranked this issue where you did (frequency × user impact × fix difficulty).

---

# Fix Prioritization

When multiple issues exist, fix in this order:

1. **Safety/Compliance**: Anything leaking sensitive info or breaking rules
2. **Hallucination**: Agent making up critical information
3. **Core functionality**: Tools not working, main use case broken
4. **User experience**: Tone, length, flow issues
5. **Edge cases**: Less common scenarios

---

# Common Failure Patterns & Fixes

## 1. Hallucination / Made-Up Information

**Symptoms:**
- Agent provides fake order numbers, URLs, or data
- Information doesn't match what tools returned
- Agent confidently states incorrect facts

**Diagnosis:**
- Check if tool was called at all
- Check if tool returned empty/error
- Check if prompt tells agent what to do when data is missing

**Fix template:**
```xml
<no_hallucination>
NEVER make up information. If a tool returns empty or fails:
1. Do NOT fabricate data
2. Acknowledge you couldn't retrieve the information
3. Offer an alternative (retry, transfer, manual lookup)
</no_hallucination>
```

## 2. Tool Not Called When Needed

**Symptoms:**
- Agent makes up information instead of looking it up
- Provides generic answers when specific data is available
- Guesses at account details, order status, etc.

**Diagnosis:**
- Is the tool defined correctly?
- Does the tool's LLM description contain **both WHAT it does and
  WHEN to call it**? If "when" lives only in playbook instructions,
  it's invisible to other playbooks routing to this tool's parent —
  the most common cause of a tool being silently skipped. See the
  `build-agent` skill for the full WHAT + WHEN rule.
- Does the prompt also reinforce WHEN to call it for the active
  playbook (belt-and-braces)?

**Fix template:**
```xml
<mandatory_tool_usage>
When user asks about [topic], ALWAYS call [tool_name] immediately.
Never guess or provide generic information. Use actual data from tools.

Required calls:
- Order status questions → call get_order
- Account balance → call get_balance
- [specific scenario] → call [specific tool]
</mandatory_tool_usage>
```

## 3. Tool Called But Error Not Handled

**Symptoms:**
- Tool fails silently
- Agent proceeds as if tool succeeded
- Hallucinated data after tool error

**Diagnosis:**
- What did the tool return?
- Does the prompt have error handling instructions?
- Does the function surface errors properly?

**Fix template:**
```xml
<error_handling>
If any tool returns an error, empty result, or unexpected data:
1. Do NOT proceed with the normal flow
2. Do NOT make up replacement data
3. Say: "I'm having trouble retrieving that information"
4. Offer: transfer to human OR ask to try again later
</error_handling>
```

## 4. Information Leakage

**Symptoms:**
- Agent mentions "knowledge base", "database", "API"
- References tool names or internal systems
- Says "let me check our system" when it should be seamless

**Diagnosis:**
Check if prompt includes instructions to hide internal operations.

**Fix template:**
```xml
<silent_execution>
Execute all tool calls silently. Never mention:
- Knowledge base, database, or system searches
- Tool names or API calls
- Internal processes or routing

Present information as if you already knew it.
</silent_execution>
```

## 5. Lost Context

**Symptoms:**
- Agent asks for information user already provided
- Forgets user's name mid-conversation
- Doesn't connect related requests

**Diagnosis:**
- Is the conversation context being passed correctly?
- Is the prompt telling the agent to remember things?
- Is there a context window issue (too long conversation)?

**Fix template:**
```xml
<context_memory>
Remember all information from this conversation:
- User's name and details
- Information already collected
- Current task/topic
- Previous questions and answers

Never re-ask questions already answered.
</context_memory>
```

## 6. Wrong Tone/Style

**Symptoms:**
- Too formal when should be casual (or vice versa)
- Inconsistent style within conversation
- Doesn't match brand voice

**Fix template:**
```xml
<tone>
Use [casual/professional/formal] communication:
- [Specific phrases to use]
- [Specific phrases to avoid]
- [Example of ideal response]

Match the user's energy level while maintaining [brand] voice.
</tone>
```

## 7. Response Length Issues

**Symptoms:**
- Responses too long (walls of text)
- Responses too short (missing important info)

**Fix template:**
```xml
<response_length>
Keep responses [brief/standard/detailed]:
- Target: [X-Y] words per response
- Voice: Maximum 2 sentences per turn
- Include: [essential elements]
- Exclude: [unnecessary elements]
</response_length>
```

## 8. Voice-Specific Issues

**Symptoms (voice agents only):**
- Numbers spoken incorrectly ("25" instead of "twenty-five")
- Multiple questions in one turn
- References to visual elements
- Doesn't handle speech recognition errors

**Fix template:**
```xml
<voice_formatting>
ONE question per turn. Never combine questions.

Numbers: Spell out all numbers ("twenty-five" not "25")
Currency: "one hundred and fifty dollars" not "$150"
Phone: "five, five, five. one, two, three. four, five, six, seven."

Never reference visual elements (buttons, screens, links to click).
</voice_formatting>
```

## 9. Handoff Issues

**Symptoms:**
- Transfers to human when it shouldn't
- Doesn't transfer when it should
- Poor handoff experience (abrupt, confusing)

**Fix template:**
```xml
<handoff_rules>
Transfer to human ONLY when:
- [specific trigger 1]
- [specific trigger 2]
- User explicitly requests human help

Do NOT transfer for:
- [scenarios agent should handle]

Before transferring, say: "[appropriate handoff message]"
</handoff_rules>
```

## 9a. Diagnostic Trap: Repeat Contact vs. Transfer Loop

**This is an analysis methodology issue, not an agent behavior issue. It applies to any brand/agent with human handoff.**

When scanning transcripts at scale, it's easy to see high turn counts (1000+) and many transfer/handoff tool calls and conclude the agent is stuck in a loop. **This is often wrong.** You must verify before claiming a loop exists.

### How to distinguish:

| Signal | Transfer Loop (bug) | Repeat Contact (not a bug) |
|--------|-------------------|---------------------------|
| Transfer tool calls | Many | Many |
| Successful handoff events (e.g. `live-agent-handoff`) | **Zero or very few** | **Roughly matches transfer calls** |
| User messages over time | Repetitive within seconds/minutes | Spread across hours/days/weeks |
| Session restarts (`launch` events) | Few or none | Many (user keeps coming back) |
| Unique external conversation/ticket IDs | None or same ID recycled | **Multiple different IDs** |
| Turn count | High | High |

**The critical check:** Always cross-reference transfer tool calls against successful handoff events. If they match ~1:1, the transfer is working — the volume means the user keeps coming back because their underlying issue isn't being resolved on the human side.

### Required analysis steps for any transcript with high transfer volume:

1. Count transfer tool calls (e.g. `transfer_to_human`, `handoff`, `escalate`, etc.)
2. Count successful handoff events (e.g. `live-agent-handoff`, `chat_started`, etc.)
3. Check if handoff events have unique external conversation/ticket IDs
4. Look at timestamps — are transfers spread across days (repeat contact) or firing every few seconds (loop)?
5. Read actual user messages — are they re-initiating ("Find me an agent") or is the agent cycling autonomously?

### If it IS a repeat contact pattern, the real questions are:

- Why isn't the user's issue being resolved by human agents?
- Is the agent correctly surfacing context to the human agent at handoff?
- Should the agent recognize returning users and escalate differently?

### If it IS a genuine loop:

- Check what happens after the transfer tool — does a reclassify/re-route tool send the user back to the start?
- Look for the pattern: transfer → reclassify → supervisor → greet → triage → transfer again
- A real loop will show zero successful handoff events and rapid-fire turns within a single session

## 10. Call Not Ending

**Symptoms:**
- Agent says goodbye but call doesn't terminate
- User has to hang up manually
- end_call tool not invoked

**Diagnosis:**
- Does the prompt tell agent to call end_call?
- Is the end_call tool available?
- Is there a clear trigger for when to end?

**Fix template:**
```xml
<call_termination>
After saying goodbye ("Thanks for calling, have a great day"),
immediately call the end_call tool. Do not wait for user response.
</call_termination>
```

---

# Working Notes Protocol

For any analysis touching 5+ transcripts or 10+ tool calls, maintain
working notes to avoid losing early findings as context grows.

**When to write**: After each major phase (triage, deep-read batch,
KB queries). Not after every tool call.

**When to read back**: Before cross-correlation or writing the final
report. Re-read your notes to ensure nothing was lost from earlier.

**Format**:

```
# Working Notes: {command} — {project}

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
