---
name: document
description: >
  Project wiki — lightweight context layer for Voiceflow agents. Covers
  wiki creation, structure, and maintenance.
  TRIGGER when: user asks to document the project, create or update a
  wiki, capture business rules or partner profile, write a project
  README, or persist non-code context (escalation rules, integration
  notes, glossary) that future agents will need.
version: 0.3.0
---

# Project Wiki

The wiki is a lightweight context layer — enough for any agent to start
working without exporting the project. It is NOT a mirror of the agent.
Full prompts, function code, and variable listings live in the agent
itself (use `export_agent` or copilot API when you need the real thing).

## When to Create a Wiki

- First time working with a project
- Onboarding an existing agent
- After building a new agent from scratch

The orchestrator checks for a wiki before every command. If none exists,
it offers to create one.

## Wiki File Structure

Single markdown file: `{project-name}-wiki.md` at the project's
a dedicated location. One file, one source of truth.

### Required Sections

```markdown
# {Project Name} — Wiki

## Overview
## Architecture
## Key Rules
## Tools
## Knowledge Base
## Known Issues
## Changelog
```

---

## Section Specifications

### Overview

3-5 sentences. What the agent does, who it serves, channel (voice/chat),
model, key integrations.

### Architecture

Agent topology — how many agents, what each handles, routing logic.
Include a mermaid diagram.

**Contents:**
- Pattern (single agent / multi-agent swarm)
- Model per agent
- Mermaid diagram
- Routing logic (what triggers each playbook)

### Key Rules

The rules the agent enforces — extracted from the system prompt during
wiki creation. These are what debug, test, and analyze agents evaluate
against.

**Format:** Numbered list, one rule per line. Group by category:
- Voice/UX rules (brevity, one question per turn, etc.)
- Safety rules (auth, escalation, no hallucination)
- Business rules (specific to the domain)

This is the most important section for debug/test agents. Keep it
accurate — when rules change in the prompt, update here.

### Tools

Name + what it does + which agent calls it. NOT full code or I/O schemas.

**Format:**
```
| Tool | Purpose | Called by |
|------|---------|----------|
| verify_account | Look up customer by phone/email | Account Agent |
```

### Knowledge Base

Topics covered, document count, known gaps.

**Format:**
- Document count and types
- Topics covered (bullet list)
- Known gaps (topics that should be covered but aren't)

### Known Issues

Active problems, recent failures, open investigations. This is where
debug and analyze findings get recorded so they're not rediscovered.

**Format:**
```
| Issue | Severity | Status | Found |
|-------|----------|--------|-------|
| Agent announces tool calls | Medium | Open | 2026-03-25 |
```

### Changelog

Running log of changes, newest first. One line per change.

**Format:** `YYYY-MM-DD — what changed`

---

## Creating a Wiki

When creating a wiki for an existing project:

**If the project has copilot API** (preferred — structured data):
1. `voiceflow_playbook` (list + get each) — prompts per agent
2. `voiceflow_global_prompt` (get) — persona, guidelines
3. `voiceflow_agent_routing` (list) — routing and crew wiring
4. `voiceflow_function` (list) — tools and functions
5. `voiceflow_behaviour` (get) — voice config (if voice)
6. `kb_list_documents` — KB inventory
7. `list_evaluations` — eval coverage

Run all of these in parallel — they have zero dependencies.

**If production-only project** (no copilot API):
1. `export_agent` — full agent structure
2. `kb_list_documents` — KB inventory
3. `list_evaluations` — eval coverage

Extract: overview, architecture, rules, tools, KB summary.
Write the wiki file to the project's `wikiPath`.

Do NOT copy full prompts or function code into the wiki. Summarize.
The wiki tells you what exists and what rules apply — use the copilot
API or export when you need the exact text.

## Updating the Wiki

Update the relevant section + add a changelog entry when:
- Rules change in the prompt
- Tools are added or removed
- Architecture changes (new playbooks, model changes)
- Debug/analyze finds a new known issue
- A known issue is resolved

Do NOT update the wiki for routine transcript analysis or one-off
questions. Only structural changes.

---

## Wiki Quality Rules

- **Summaries, not mirrors.** The wiki gives context. The agent is
  the source of truth for exact prompt text.
- **Rules must be exact.** The Key Rules section is what agents
  evaluate against. If it's wrong, evaluations are wrong.
- **One file, always current.** If the wiki contradicts the agent,
  update the wiki.
- **Changelog is non-negotiable.** Every structural change gets an entry.

---

## Related skills

- **`build-agent`** — full build workflow; the wiki is one output of that work.
- **`voiceflow-overview`** — index of all available skills.
