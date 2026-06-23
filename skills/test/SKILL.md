---
name: test
description: >
  Evaluation design, testing strategies, and quality metrics for Voiceflow
  agents. Covers eval types, test case design, calibration, and result tracking.
  TRIGGER when: user asks to set up evals, write test cases, design
  evaluation criteria, calibrate eval pass thresholds, run a test suite,
  stress-test the agent with adversarial or tricky scenarios, benchmark
  agent quality, or "test the agent end-to-end". Also when the
  user asks how to verify a change before shipping.
version: 0.2.0
---

# Testing Voiceflow Agents

## When to Test

Create evaluations when:
- Building a new agent (create baseline tests)
- After making significant prompt changes
- Before deploying to production
- When quality issues are identified
- To track improvement over time

---

## What is an Evaluation?

An evaluation is a test suite that grades agent conversations against specific criteria. Each evaluation checks whether the agent meets certain standards.

Example evaluation criteria:
- "Agent correctly handles order lookups"
- "Agent doesn't hallucinate information"
- "Agent transfers to human when appropriate"

---

## Designing Evaluations

### Good Evaluation Characteristics

- **Specific**: Tests one behavior or pattern
- **Measurable**: Can be graded as pass/fail
- **Realistic**: Based on actual agent use cases
- **Repeatable**: Produces consistent results
- **Actionable**: When it fails, you know what to fix

### Bad Evaluations (Avoid)

- "Is the agent good?" - Too vague
- "Does the agent work?" - Not specific enough
- "Is the tone perfect?" - Not measurable
- "Did the agent try to help?" - Too subjective

---

## Evaluation Structure

An evaluation consists of:

1. **Name**: Clear, descriptive title
2. **Criteria**: 3-5 specific things to check
3. **Test cases**: Sample conversations to test against
4. **Pass threshold**: What % pass rate is acceptable?

### Evaluation Template

```
Evaluation Name: [Clear description of what this tests]

Criteria:
- Criterion 1: [Specific behavior to check]
- Criterion 2: [Specific behavior to check]
- Criterion 3: [Specific behavior to check]

Test Cases:
- Scenario 1: [Setup and expected outcome]
- Scenario 2: [Setup and expected outcome]
- Scenario 3: [Setup and expected outcome]

Pass Threshold: 80% (at least 8 of 10 test cases pass)
```

---

## Common Evaluation Types

### Happy Path Evals

Test the main use case with ideal conditions.

Example: "Customer asks for order status, agent looks it up, provides answer"

**Criteria:**
- Agent calls get_order tool
- Agent uses actual tool results
- Agent provides complete order information
- Agent offers next steps

### Edge Case Evals

Test unusual scenarios or error conditions.

Example: "Customer asks for order status, but order doesn't exist"

**Criteria:**
- Agent handles empty tool result gracefully
- Agent doesn't hallucinate data
- Agent offers alternatives

### Safety/Guardrail Evals

Test that agent follows constraints.

Example: "Agent should never share internal system names"

**Criteria:**
- Agent never mentions "database" or tool names
- Agent never references internal APIs
- All operations appear seamless to customer

### Tone/Style Evals

Test that agent matches brand voice.

Example: "For a casual brand, agent should be conversational"

**Criteria:**
- Agent uses contractions ("I'll" not "I will")
- Agent skips robotic phrases
- Agent matches customer energy level

### Flow/Process Evals

Test that agent follows correct sequence.

Example: "Verify customer before allowing account changes"

**Criteria:**
- Agent asks for verification first
- Agent doesn't skip steps
- Agent confirms completion

---

## Creating Good Test Cases

### Test Case Template

```
Scenario: [Brief description of situation]

User Input: "[What the customer says/does]"

Expected Behavior:
1. [Agent action 1]
2. [Agent action 2]
3. [Expected outcome]

Success Criteria:
- [Checkable item 1]
- [Checkable item 2]
```

### Example Test Case

```
Scenario: Customer wants to return a damaged item

User Input: "I received my order yesterday and the product is damaged. Can I return it?"

Expected Behavior:
1. Agent acknowledges the damage
2. Agent calls get_return_policy tool
3. Agent explains the return process
4. Agent offers to process the return

Success Criteria:
- Agent doesn't ask customer to repeat the issue
- Agent cites actual return policy, not made-up info
- Agent offers clear next steps
```

---

## Measuring Results

### Pass Rate Calculation

```
Pass Rate = (# of test cases that passed) / (# of total test cases) * 100

Example: 8 out of 10 cases passed = 80% pass rate
```

### Tracking Over Time

Keep a log of eval results:

```
| Date | Eval Name | Pass Rate | Trend |
|------|-----------|-----------|-------|
| 2026-02-27 | Order Lookup | 85% | up |
| 2026-02-25 | Order Lookup | 78% | up |
| 2026-02-20 | Order Lookup | 72% | baseline |
```

### Identifying Failure Patterns

When a test case fails:

1. Which specific criterion failed?
2. Is this a common failure (affects multiple test cases)?
3. What was the agent's actual behavior?
4. What should it have been?
5. What part of the system caused this? (Prompt, tool, data?)

---

## Common Issues & Fixes

### Issue: Hallucination

**Eval Criteria:**
- "Agent only uses information from tools, never makes it up"

**Test Case:**
- User asks about specific product
- Tool returns empty result
- Agent should NOT provide fake info

**Fix:** Add guardrail to prompt: "If tool returns empty, say you couldn't find the info. Never make up data."

### Issue: Tool Not Called

**Eval Criteria:**
- "Agent calls lookup tool when customer asks for details"

**Test Case:**
- User asks "What's my order status?"
- Agent must call get_order_status
- Agent must use real result

**Fix:** Add to prompt: "When customer asks about orders, ALWAYS call get_order_status immediately."

### Issue: Poor Tone

**Eval Criteria:**
- "Agent matches brand's conversational, casual style"

**Test Case:**
- User has simple question
- Agent should respond naturally, not robotically

**Fix:** Add tone section to prompt with examples of good/bad phrases.

### Issue: Loop/Repeat

**Eval Criteria:**
- "Agent completes task in max 10 turns"

**Test Case:**
- User provides all info
- Agent should execute and exit
- Should NOT loop asking for same info

**Fix:** Add exit conditions to prompt. After completing task, immediately exit or ask if anything else.

**Live-test note:** Duplicate tool calls can also be a driver artifact — never inject the next scripted user turn during a processing gap; apply turn-completion gating (see the `test-runner-agent` methodology).

---

## Building an Evaluation Suite

A complete evaluation suite for a new agent might include:

```
Core Functionality (must pass 90%+)
- Happy path: main use case
- Tool integration: tools called correctly
- Error handling: graceful failure

Safety/Compliance (must pass 95%+)
- No hallucination: only use tool results
- No info leakage: don't mention internals
- Privacy: don't ask for unnecessary info

User Experience (must pass 80%+)
- Tone consistency: matches brand
- Response length: not too long/short
- Clarity: user understands what happened

Edge Cases (must pass 70%+)
- Invalid input: handles gracefully
- Missing data: tool returns nothing
- Confused user: can clarify intent
```

---

## Evaluation Checklist

Before deploying an agent, ensure:

- [ ] Created evaluation criteria for main use cases
- [ ] Created evaluation criteria for edge cases
- [ ] Created evaluation criteria for safety/guardrails
- [ ] Ran first baseline eval
- [ ] Documented baseline pass rates
- [ ] Identified any failing test cases
- [ ] Created fixes for failures
- [ ] Re-ran evals to verify fixes
- [ ] All critical evals passing at threshold
- [ ] Results documented in wiki

---

## Related skills

- **`debug`** — for analyzing why specific test cases fail.
- **`prompt-optimizer`** — when test failures suggest a prompt change is needed.
- **`audit-wiring`** — when test failures suggest the issue is wiring, not prompt or behavior.
- **`voiceflow-overview`** — index of all available skills.
