---
name: diff-agent
description: Compare two agents — production vs dev, or before vs after
---

Compare two Voiceflow agents and show what's different. Most common
use case: comparing a production agent against its dev environment copy.

## Arguments

$ARGUMENTS — two project names separated by space.

Examples:
- `/diff-agent because dev-because` — compare prod vs dev
- `/diff-agent dev-sandbox dev-turo` — compare two dev projects

The first project is the **source** (baseline), the second is the
**target** (what changed).

## Process

### Step 1: Load both projects

Resolve both projects by calling `mcp__voiceflow__voiceflow_project` with
operation `list` and matching each name (case-insensitive substring).
If only one project is given, ask for the second one.

For each project, read the full configuration:

- `voiceflow_global_prompt` (get) — persona, guidelines, models
- `voiceflow_playbook` (list) + `voiceflow_playbook` (get) for each
- `voiceflow_agent_routing` (list)
- `voiceflow_function` (list) + `voiceflow_function` (get) for each
- `voiceflow_function` (list_variables) — all function input/output variables
- `voiceflow_function` (list_paths) — all function output paths
- `voiceflow_function` (list_agent_tools) for each agent — function tool assignments
- `voiceflow_api_tool` (list) — API tool definitions
- `voiceflow_api_tool` (list_input_variables) for each API tool
- `voiceflow_api_tool` (list agent tools) for each agent — API tool assignments
- `voiceflow_variable` (list) — environment-level variables
- `voiceflow_behaviour` (get) — STT/TTS config

### Step 2: Compare

Compare these sections and report differences:

1. **Persona** — text diff of global persona
2. **Guidelines** — text diff of global guidelines
3. **Default Models** — any model changes
4. **Agents** — added, removed, or modified agents
   - For modified agents: diff instructions text, settings, tool configs
5. **Crew Configuration** — operator changes, sub-agent routing changes
6. **Functions** — added, removed, or modified functions
   - For modified functions: diff code
7. **Function Variables** — added, removed, or modified variables per function
   - Flag type changes (input → output)
   - Flag description changes
8. **Function Paths** — added, removed, or modified paths per function
   - Flag label changes
9. **Function Tool Assignments** — which function tools moved between agents
   - Flag description or input variable changes on tool links
10. **API Tool Definitions** — added, removed, or modified API tools
    - Diff URL, HTTP method, headers, body, query params
    - Diff input variables per API tool
11. **Agent API Tool Assignments** — which API tools moved between agents
    - Flag description or input variable changes
12. **Environment Variables** — added, removed, or modified
    - Flag datatype changes, default value changes
11. **Voice Settings** — STT/TTS provider, model, language/voice changes
    - Flag call recording, keypad, silence timeout changes

### Step 3: Present the diff

Format clearly:

```
# Diff: {source} → {target}

## Summary
- {N} sections changed
- {N} agents added/removed/modified
- {N} functions added/removed/modified

## Persona
{show only the changed lines, or "No changes"}

## Guidelines
{show only the changed lines, or "No changes"}

## Models
{source model} → {target model}

## Voice Settings
STT: {source provider/model} → {target provider/model}
TTS: {source provider/voice} → {target provider/voice}
{or "No changes"}

## Agents

### {Agent Name} — MODIFIED
**Instructions:**
- Removed: {removed text snippet}
+ Added: {added text snippet}

**Settings:**
Model: {old} → {new}

### {Agent Name} — ADDED
{full instructions}

### {Agent Name} — REMOVED
{was: brief description}

## Functions

### {Function Name} — MODIFIED
**Code:**
{code diff}

**Variables:**
+ Added: {name} (input) — {description}
- Removed: {name} (output)
~ Changed: {name} description updated

**Paths:**
+ Added: {name} ({label})

### {Function Name} — ADDED
{full code + variables + paths}

## Function Tool Assignments
{changes in which functions are linked to which agents}

## API Tools
### {API Tool Name} — ADDED
{method} {url} — {description}
Input vars: {list}

### {API Tool Name} — MODIFIED
URL: {old} → {new}
Method: {old} → {new}

## API Tool Assignments
{changes in which API tools are linked to which agents}

## Environment Variables
+ Added: {name} ({datatype}) — {description}
- Removed: {name}
~ Changed: {name} datatype {old} → {new}

## Crew Configuration
{routing changes}
```

### Step 4: Interpret

After the raw diff, provide a brief interpretation:
- What's the intent of these changes?
- Are there any inconsistencies (e.g., new playbook not wired into crew)?
- Any potential issues (e.g., model downgrade, removed tool still referenced)?
- Functions with new code but unchanged variables/paths (might need updating)
- New environment variables not referenced in any function code

## Matching Agents Across Projects

Production and dev copies won't have the same agent IDs. Match by:
1. **Name** — exact match first
2. **isOperator** — match operator to operator
3. **Description similarity** — fuzzy match on description/scope
4. Unmatched agents are flagged as "added" or "removed"

Match functions and environment variables by **name**. Unmatched items
are flagged as added or removed.

## Notes

- This is **read-only** — no changes are made.
- If only one project is provided, ask for the second one.
