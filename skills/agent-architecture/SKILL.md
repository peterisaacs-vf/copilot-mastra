---
name: agent-architecture
description: >
  Multi-agent swarm architecture for Voiceflow. Covers the three-layer
  architecture (global prompt, operator, playbooks), routing patterns,
  variable flow, and common anti-patterns.
  TRIGGER when: user asks about crew setup, multi-agent routing, playbook
  architecture, operator configuration, global prompt vs operator vs
  playbook layers, transferring between playbooks, "how should I split
  my agent into pieces", or designing the routing logic for a v4 agent.
version: 0.1.0
---

# Multi-Agent Swarm Architecture

## Architecture Overview

```
+-----------------------------------------------------+
|              GLOBAL PROMPT (Persona + Guidelines)     |
|         Identity, voice rules, guardrails            |
|   Applies to ALL agents - never redefine identity    |
+-----------------------------------------------------+
                          |
+-----------------------------------------------------+
|              GLOBAL AGENT (Operator)                  |
|   Routing + direct Q&A handling                      |
|   Has: KB, web search, visual tools                  |
|   Handles simple queries directly via KB             |
|   Routes multi-step flows to playbooks SILENTLY      |
+-----------------------------------------------------+
                          |
              +-----------+-----------+
              v                       v
       Playbook A              Playbook B
       Global Prompt +         Global Prompt +
       Specialized             Specialized
       Instructions            Instructions
       + FUNCTIONS/APIs        + FUNCTIONS/APIs
```

## The Three Layers

### Layer 1: Global Prompt (Persona + Guidelines)
Defines WHO the agent is. Applied to every agent.
Contains: Identity, voice rules, tone, universal guardrails.
Does NOT contain: Routing logic, playbook-specific instructions.

### Layer 2: Global Agent (Operator)
Entry point. Handles simple queries directly, routes complex flows.
Has: KB, web search, buttons, cards, carousels, end tool.
Does NOT have: Functions, API tools, MCP tools.
Key Rule: Routes SILENTLY. Never announces transfers.

### Layer 3: Playbooks (specialized agents)
Handle distinct multi-step flows needing their own tools.
Each has: Global Prompt + its own instructions + functions/APIs.
Key Rule: Entry point must acknowledge what user already said.

**Visibility:** When a playbook is active, only the global prompt and
*that* playbook's instructions are in context. Other playbooks'
instructions are NOT visible. So the only signal another playbook
(or the operator) has for "when should I jump here?" is this
playbook's `description` field — which means the description must
contain **both what the playbook does and when to route to it**.
The same applies to every tool and workflow description. See the
`build-agent` skill for the full WHAT + WHEN rule and example.

## Prompt Inheritance

| Agent | Receives | Has Tools |
|-------|----------|-----------|
| Global Agent | Persona + Guidelines + Routing + Q&A Instructions | KB, web search, visual |
| Playbook | Persona + Guidelines + Playbook Instructions | Functions, APIs, KB |

**Never redefine identity in playbooks.** The global prompt already
established who the agent is.

## Critical Patterns

### Silent Routing
```xml
<!-- WRONG -->
Agent: "Let me transfer you to our account team."

<!-- RIGHT -->
[Route silently]
Account playbook: "I can help with that address update..."
```

### Entry Point Acknowledgment
```xml
<!-- WRONG -->
Account playbook: "How can I help you today?"

<!-- RIGHT -->
Account playbook: "I can help with that license update..."
```

### When to Create a Playbook

**Create when:** Distinct multi-step flow, needs functions/APIs,
own rules that would clutter operator.

**Keep on operator when:** Just answering questions (use KB), no tools
beyond KB/web search, would be a thin KB wrapper.

**The test:** If a playbook's only tool is KB, it shouldn't be a playbook.

```
WRONG:
Operator (router only, no KB)
+-- Menu FAQ Playbook (KB only)
+-- Hours Playbook (KB only)
+-- Ordering Playbook (has functions)

RIGHT:
Operator (KB enabled — handles menu, hours, FAQ directly)
+-- Ordering Playbook (has place_order function)
```

## Variable Flow

Variables are literal string injection at runtime. Functions set them,
prompts reference them. Prompts should reference variables by
`[logical_name]` in the body and declare the actual `{variable}`
substitution once in an `<input_data>` block at the bottom — see the
`prompting` skill for the full convention and rationale, and the
`functions` skill for pre-resolution patterns.

```
get_context workflow (runs at start)
    | sets: customer_first_name, account_status, greeting_text
Global Prompt / Playbooks (reference [logical_name] in body)
    | <flow>
    |   Open with [greeting_text].
    |   If [account_status] is "suspended", route to billing.
    | </flow>
    |
    | <input_data>
    | greeting_text = "{greeting_text}" — pre-resolved by
    |   get_context; safe to use inline.
    | account_status = "{account_status}" — "active", "suspended",
    |   or "0" when unset.
    | </input_data>
```

## Anti-Patterns

1. Announcing transfers — "Let me get you to the right place"
2. Asking users to repeat — "How can I help you?" after they said
3. Redefining identity in playbooks — "You are a helpful assistant..."
4. Continuing after task complete — Keep chatting instead of exiting
5. Conditional variable logic in prompts — "If {x} is set..." won't work; pre-resolve in a function and reference `[x]` in the body
6. Putting functions on the global agent — Only playbooks have tools

---

## Related skills

- **`build-agent`** — the parent skill for full agent builds; crew is one component.
- **`prompting`** — global/operator/playbook prompt structure pairs with crew architecture.
- **`wiring-architect`** — once you have the crew shape, the per-tool wiring (`captureResponse`, `shouldFulfill`, defaults) lives there.
- **`voiceflow-overview`** — index of all available skills.
