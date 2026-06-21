---
name: audit-wiring
description: >
  Run a structured audit of a Voiceflow v4 project's tool/function/variable
  wiring. Finds: function outputs that aren't captured, project variables
  that have no setter, agent tool inputs with malformed
  functionInputVariableID, phantom duplicate inputs, shouldFulfill: true
  inputs that should default from project state, and inputs whose name
  implies a project-var setter.
  TRIGGER when: user asks to audit, review, or check a project's wiring;
  reports tool calls with empty args; suspects a captureResponse mapping
  is missing; before any large wiring change; or when investigating "the
  bot keeps doing X wrong" before assuming it's a prompt bug.
version: 0.1.0
---

# Voiceflow Wiring Audit

Companion to `wiring-architect`. That skill explains the data-flow
model; this one runs the audit and produces a structured report.

## When to run this

- **Before iterating on a prompt** when a function is being called with
  empty/wrong args. 9 times out of 10 the fix is wiring, not prose.
- **After a large mass-create** of functions or tools. Some platform
  flows leave malformed `functionInputVariableID` values.
- **After any UI-side edit to a tool attachment** — even message-text
  or toggle changes. UI edits have been observed to silently reset the
  attachment's `captureResponse` to null; Phases 2 and 4 will surface
  the resulting gaps. Don't trust yesterday's audit if anyone touched
  the UI since.
- **As a periodic health check** on any project with more than ~10
  functions.

## How to run

The audit reads from a project export. There's no live API call needed
beyond the initial export.

### Step 1: Export the project

```
mcp__voiceflow__voiceflow_project export_to_file
  environmentID: <env_id>
```

> **v1.3 projects:** Use the `draftVersionID` from the project's
> `environments` map as `<env_id>` — not the environment `_id` (which
> returns 404). See `voiceflow-overview` for the full resolution steps.

The export is large (often ≥500KB). It will likely exceed the message
limit and be saved to a file. The MCP wrapper returns the path. Save it
locally:

```bash
# After the export, the wrapper puts the JSON in a tool-results file.
# Extract the inner payload to a workable file:
EXPORT_FILE="<path returned by the MCP wrapper>"
jq -r '.[0].text' "$EXPORT_FILE" > /tmp/vf_export.json
```

### Step 2: Run the audit script

The script lives at `scripts/audit.py` next to this SKILL.md. Invoke it:

```bash
python3 <plugin_dir>/skills/audit-wiring/scripts/audit.py /tmp/vf_export.json
```

It produces:

- **stdout**: a tier-grouped human-readable report
- `/tmp/vf_audit.json`: structured data for programmatic consumption
- `/tmp/vf_audit_fixes.json`: a starter fix plan you can hand to a
  follow-up step

### Step 3: Read the report

The output is grouped by issue type. Read it top-to-bottom — issues at
the top affect the most tools.

```
PHASE 1: Project vars — who sets them, who reads them
PHASE 2: Tool inputs that default from a project var with NO setter
PHASE 3: Tool inputs with shouldFulfill: true that could be auto-filled
PHASE 4: Function outputs that no captureResponse uses
PHASE 5: Malformed wiring (functionInputVariableID, phantom inputs)
PHASE 6: Suggested captureResponse wirings (heuristic)
PHASE 7: Side-effect-only functions (no outputs declared)
PHASE 8: Orphan functions (0 agent tool instances)
PHASE 9: Functions that read args.secrets.* (always a bug)
```

### Step 4: Convert findings into a fix plan

Each phase produces actionable items. Common patterns:

| Phase | Symptom | Fix |
|---|---|---|
| 2 | Input defaults from var X, but X is never written | Find the upstream function, capture its relevant output to X |
| 3 | shouldFulfill: true with a project-var-named input | Switch shouldFulfill: false ONLY if a setter writes that var on every path reaching the tool — otherwise keep Agent collect ON (see below) |
| 4 | Function returns Y but no captureResponse anywhere uses it | Decide: does any tool need Y? If yes, capture it. If no, ignore. |
| 5 | functionInputVariableID is a name string, not a UUID | Repair next time you update the tool — never preserve broken state |
| 6 | The heuristic suggests capturing function.X to project_var X | Verify the rename matches your project's naming, then wire it |
| 9 | Function code reads `args.secrets.*` | Refactor the code to read the secret from `args.inputVars`, then wire `defaultValue: [{ secretID }]` (shouldFulfill: false) on each listed attachment |

### Step 5: Apply fixes

Update agent tools via `voiceflow_global_tool update`. When
patching, **always include the full `inputVariables` and
`captureResponse` you intend** — partial PATCH semantics replace these
fields wholesale. Any input you omit will be removed.

If you're updating a bunch of tools, build a fix plan that:

1. Pre-loads each tool's current config
2. Repairs malformed wiring (drop phantoms, fix functionInputVariableID)
3. Applies the targeted change
4. Issues the update with the cleaned full payload

The audit's `/tmp/vf_audit_fixes.json` output is a starting template.

---

## Audit semantics — what each finding means

### Function outputs that no captureResponse uses (Phase 4)

Not always a bug. Some functions return values that are only meant for
the LLM to read in conversation history (status flags, formatted
strings). Use the heuristic in Phase 6 to filter to outputs that look
like project-state candidates (id-shaped values, persistent flags).

### `shouldFulfill: true` with a default (Phase 3)

The LLM is asked to fill the value but if it omits, falls back to the
default. This is "soft" agency — usually safer to switch to `false` if
the value has a canonical source. The audit flags these but you should
decide case by case:

- Keep `shouldFulfill: true` when the LLM legitimately picks (e.g.
  ticket subject, dispute reason, picked option from a list).
- Switch to `false` when the LLM has nothing to add (e.g. the picked
  shift's UUID, the user's email, the JWT).

**Setter precondition before flipping to `false`:** switching Agent
collect OFF removes collection entirely — it does not add a fallback.
The default becomes the ONLY source, including whatever placeholder the
init workflow seeded ("Unknown caller"). Before flipping, cross-check
Phase 1: does a setter write this variable on EVERY path that reaches
the tool? If not, keep collect ON or add the setter first. See
`wiring-architect` Anti-pattern 8 for the failure mode this prevents.

### Malformed `functionInputVariableID` (Phase 5)

```jsonc
// Wrong — name string instead of UUID
"functionInputVariableID": "jwtToken"

// Right — actual function-variable UUID
"functionInputVariableID": "69cc5df9a8a085e2ca4bb002"
```

The literal-name form is a known platform-side artifact of certain
mass-create flows. The audit flags it. Repair by looking up the actual
input variable's UUID via
`voiceflow_function list_variables --functionID <fid>` and including
the corrected ID in the next `update_agent_tool` patch.

### Phantom inputs (Phase 5)

Same root cause. The export looks like:

```jsonc
"inputVariables": {
  "jwtToken": { /* proper entry */ },
  "69cc5df9a8a085e2ca4bb003": { /* phantom keyed by ID */ }
}
```

The phantom usually has `description: null`. Drop it on the next patch.

### Orphan functions (Phase 8)

Functions with no agent tool instances. Two reasons:

1. **Workflow-only functions** invoked from canvas blocks (e.g.
   `initializeConversation`, `getWorker`). These are correctly orphaned
   in the agent-tool sense — leave them alone.
2. **Dead code** — left over from earlier iterations. Candidates for
   deletion. Confirm they're not called from any flow before deleting.

The audit can't distinguish — it surfaces them and lets you decide.

### Functions that read `args.secrets.*` (Phase 9)

Always a bug. `args.secrets` does not exist in the V4 function sandbox, so any
function whose code matches `args.secrets` silently gets `undefined` for that
value, returns on its error path, and the LLM ends up hallucinating around the
empty result. The phase reports each offending function plus the agent tool
attachments that reference it, so the fixer knows where to re-wire after the
code is changed.

**Fix:** Refactor the function to read the secret from `args.inputVars`, then
wire each listed attachment's input `defaultValue` to `[{ secretID: "<uuid>" }]`
with `shouldFulfill: false`. See the `functions` skill "Reading secrets" and the
`wiring-architect` skill Anti-pattern 7.

---

## What the audit does NOT cover

- **Function code correctness**: doesn't run the JS, doesn't check that
  the API endpoint is right.
- **Prompt design**: out of scope. See `prompt-optimizer` for that.
- **Knowledge base coverage**: see `audit-kb` agent for that.
- **Cross-environment drift**: only looks at the env you exported.

---

## Reading audit output programmatically

If you want to feed findings into a downstream agent (e.g. an
auto-fixer), use the JSON output:

```python
import json
with open("/tmp/vf_audit.json") as f:
    audit = json.load(f)

# Each phase's findings
for issue in audit["phase_2_orphan_defaults"]:
    print(issue["function"], issue["agent"], issue["input"], "needs setter for", issue["expected_var"])
```

The `/tmp/vf_audit_fixes.json` output mirrors the structure expected by
`voiceflow_global_tool update` — pre-resolved IDs ready to
patch. Verify before applying.

---

## Related skills

- **`wiring-architect`** — the conceptual model behind every audit finding. Read this to understand what each phase's findings actually mean.
- **`functions`** — when an audit finding requires changing function code (adding output variables, changing return shape, etc.).
- **`prompt-optimizer`** — runs an audit before optimization; this is the audit it runs.
- **`debug`** — if an audit finding ties to a specific failing transcript, jump to debug from here.
- **`voiceflow-overview`** — index of all available skills.
