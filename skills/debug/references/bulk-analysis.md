# Bulk transcript analysis

Multi-transcript debug workflow (triage, deep-reading minimums, cross-correlation, evidence standards). Loaded on demand from the `debug` skill via `skill_read`.

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
