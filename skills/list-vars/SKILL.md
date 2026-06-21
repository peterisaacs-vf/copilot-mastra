---
name: list-vars
description: Quick view of all variables — environment variables and function variables grouped by function
---

Quick read-only view of all variables in a project — both environment-level
variables and function input/output variables. Useful for debugging
("what variables exist?") without running a full `/inspect-agent`.

## Arguments

$ARGUMENTS — the project name (or projectID).

## Process

### Step 1: Gather data

Resolve the project by calling `mcp__voiceflow__voiceflow_project` with
operation `list`. Match `$ARGUMENTS` against project `name`
(case-insensitive substring). If no match or empty, list and ask.

Then fetch in parallel:
- `voiceflow_variable` (list) — environment-level variables
- `voiceflow_function` (list) — to get function names
- `voiceflow_function` (list_variables) — all function input/output variables (per function)
- `voiceflow_api_tool` (list) — to get API tool IDs
- `voiceflow_api_tool` (list_input_variables) — API tool input variables (per tool)

### Step 2: Present

```
# Variables: {project name}

## Environment Variables ({count total}, {count system}, {count custom})

### System Variables
| Name | Type | Default | Description |
| sessions | number | — | The number of times a user has opened the app |
| ...

### Custom Variables
| Name | Type | Array | Default | Description |
| customer_name | text | no | — | Customer's full name |
| ...

## Function Variables ({count total across all functions})

### {Function Name}
**Inputs:**
| Name | Description |
| postalCode | Customer's ZIP/postal code |
| ...

**Outputs:**
| Name | Description |
| franchiseId | The matched franchise ID |
| ...

### {Function Name}
...

## API Tool Input Variables ({count total across all API tools})

### {API Tool Name}
| Name | Description |
| api_key | The API key for authentication |
| ...

### {API Tool Name}
...

## Summary
- {N} environment variables ({N} system, {N} custom)
- {N} functions with {N} total input vars, {N} total output vars
- {N} API tools with {N} total input vars
```

## Notes

- This is **read-only** — no changes are made.
- System variables (isSystem: true) are shown separately from custom variables.
- Functions with no variables are listed with "(no variables defined)".
- For editing variables, use `/edit-agent` or `/add-function`.
