---
name: prompting
description: >
  Voiceflow prompt engineering methodology. Covers the three prompt layers
  (global / main agent / playbook), XML tag structure, wrong/right examples, and
  common anti-patterns.
  TRIGGER when: user asks to write a prompt, edit a prompt, review prompt
  quality, or asks about prompt structure in Voiceflow.
version: 0.1.0
---

# Voiceflow Prompt Engineering

## The Three Prompt Layers

### Global Prompt

Carries across ALL playbooks. Every LLM call sees this.

**Persona field** — pack four sections in:

`<identity>` — WHO the agent IS and IS NOT:
```xml
<identity>
You are [Name], [Company]'s [role]. You help [customers] with [scope].

You are:
- [Concrete capability]
- [Another capability]

You are NOT:
- [Something customers might assume]
- [Another boundary]
</identity>
```

`<goal>` — 1-2 sentences anchoring decisions. Outcome-oriented.

`<tone>` — MUST include WRONG/RIGHT examples:
```xml
<tone>
[Style description]

WRONG: "I'd be happy to help with that! What can I do for you?"
RIGHT: "Are you looking for interior or exterior painting?"

WRONG: "Great question! Let me help you with that."
RIGHT: [just answer the question]

- [Specific rules]
</tone>
```

`<formatting>` — Response structure:
```xml
<formatting>
- 1-3 sentences per turn
- Bold only critical info (2-3 max per response)
- Bullet points for 3+ items, prose otherwise
- [Number/currency/date rules]
</formatting>
```

**Guidelines field** — operational rules across ALL playbooks:
- `<terminology>` — Brand names, forbidden words
- `<escalation>` — When and how to hand off
- `<silent_execution>` — Never expose tool calls or reasoning
- `<data_handling>` — One question at a time, don't re-ask

Models pay extra attention to content under `# Guardrails`.

Keep concise (100-300 words per field). If removing a sentence only
affects one use case, it doesn't belong in the global prompt.

### Main Agent Instructions

Controls ROUTING — how the agent decides which playbook to use.

**Contains:** Routing rules, clarification logic, verification checks.
**Does NOT contain:** Persona, guardrails, menu data, greetings.

XML sections: `<routing>`, `<routing_table>`, `<clarification>`, `<rules>`.

### Playbook Instructions

Controls what happens WITHIN the playbook's scope.

**Contains:** Task procedures, domain rules, tool usage, exit criteria.
**Does NOT contain:** Identity (inherited), guardrails (inherited), routing.

XML sections: `<context>`, `<flow>`, `<rules>`, `<edge_cases>`, `<exit>`.

---

## Common Anti-Patterns

**Identity duplication** — repeating "You are X" in the main agent or playbook:
```
WRONG (main agent):
  <role>You are Mochita, the virtual barista...</role>
  <routing>Route to Ordering when...</routing>

RIGHT (main agent):
  <routing>Route to Ordering when...</routing>
```

```
WRONG (playbook):
  <role>You are a helpful ordering assistant...</role>

RIGHT (playbook):
  <context>You handle drink and pastry orders. The user has already
  stated what they want — do not re-greet.</context>
```

**Shallow global prompt** — "friendly and professional" gives nothing
actionable. Always include WRONG/RIGHT examples.

**Missing formatting rules** — without them, the agent defaults to
verbose, inconsistent responses.

**Mixing routing with persona** — main agent instructions should contain
ONLY routing logic. Persona belongs in the global prompt.

---

## Variable References in Prompts

Variables are literal string injection at runtime. `{customer_name}`
becomes the raw value. Unset variables default to `0` (not empty
string), so any inline `{variable}` reference will leak `0` into prose
when the variable isn't set.

**The convention:** reference variables by **logical name in square
brackets** (e.g. `[customer_first_name]`) in the body of the prompt,
and declare them once in an `<input_data>` block at the bottom of the
prompt with the actual `{variable}` substitution plus a one-line
description of what the variable is and where it comes from.

```
WRONG (inline substitution in prose):
  "If {customer_first_name} is set, use it."
  > LLM sees: "If Sarah is set" or "If 0 is set" — the conditional
    is gone by the time the model reads it.

WRONG (natural reference, no input_data block):
  "Greet by first name if available."
  > LLM has no anchor for what variable that maps to or what its
    current value is.

RIGHT ([name] in body + <input_data> block at the bottom):
  <flow>
    When [customer_first_name] is set, greet by name.
    When [is_logged_in] is false, do not call booking tools.
  </flow>

  <input_data>
  customer_first_name = "{customer_first_name}" — first name from
    launch payload; empty when not provided.
  is_logged_in = "{is_logged_in}" — "true" or "false"; set by the
    Initialize Session workflow.
  </input_data>
```

**Why this works:**

- The body reads as logic, not template strings — the model reasons
  about `[customer_first_name]` as a named slot, not a literal value.
- `{variable}` literal substitution is isolated to the `<input_data>`
  block, so unset `0` defaults can't leak into prose.
- `<input_data>` doubles as documentation: a new reader has one
  place to look to see what each variable means and where it's set.
- The body is durable — if a variable name changes at runtime, only
  the `<input_data>` block needs editing; the prose stays intact.

**When you still need conditional behavior** (e.g. a different
greeting for unknown customers), pre-resolve the value in a function
and inject the resolved string. See the `functions` skill for the
pre-resolution pattern.

---

## Prompt Evaluation Criteria

When reviewing prompts, check:

1. **Tool coverage**: Every assigned tool mentioned in instructions
2. **Tool variable alignment**: Input var names match actual tool schema
3. **Crew coverage** (main agent): Routing references every sub-agent
4. **No phantom references**: Nothing mentioned that doesn't exist
5. **XML structure**: Logical sections with tags
6. **Voice rules** (voice channel): Short responses, one question per turn
7. **Error handling**: What to do when tools fail
8. **Exit conditions** (playbooks): When to hand back
9. **No identity duplication**: No "You are..." outside global prompt

---

## Chat Patterns

- 50-100 words most responses, 100-150 max for complex explanations
- Bold only critical info (2-3 per response)
- Bullet points for 3+ items
- Inline citations: `[1](URL)` after the fact
- No headers in responses

## Voice Patterns

See `voice` skill for full voice-specific guidance.
- ONE question per turn
- 1-2 sentences per turn
- Announce tool calls ("One moment")
- Spell out numbers, dates, currency

---

## Related skills

- **`prompt-optimizer`** — once a prompt is deployed, use transcript-driven optimization to find what to improve.
- **`wiring-architect`** — many "the prompt isn't working" issues are actually function/tool wiring issues. Read this if your prompt has the right rules but the agent still fails.
- **`build-agent`** — full build context when designing prompts as part of a new agent.
- **`agent-architecture`** — for multi-agent / playbook prompt architecture (global + main agent + playbooks).
- **`voice`** — when writing prompts for voice agents (different rules for length, formatting, tool announcements).
- **`voiceflow-overview`** — index of all available skills.
