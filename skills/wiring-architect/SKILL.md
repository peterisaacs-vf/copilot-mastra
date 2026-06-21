---
name: wiring-architect
description: >
  How values flow through a Voiceflow v4 agent — function variables,
  project variables, agent tool instances, captureResponse, captureInputVariables,
  shouldFulfill, and turn-start snapshots. Read this before designing or
  changing any tool wiring. Most "the LLM doesn't follow my instructions"
  problems are actually wiring problems.
  TRIGGER when: user mentions captureResponse, shouldFulfill, defaultValue,
  inputVariables on an agent tool, function outputs not propagating, "the
  LLM is calling X with empty args", LLM having to thread a value across
  tool calls, project variables that "stay empty", or any data-flow design
  question across multiple tools.
version: 0.1.0
---

# Voiceflow v4 Wiring Architecture

If a value needs to flow from one tool to another, the path is always:

```
function code returns outputVars
        │
        ▼
captureResponse maps an output to a project variable  (synchronous write)
        │
        ▼
project variable persists for the rest of the session
        │
        ▼
next tool's inputVariables[X].defaultValue = {variableID: <project_var_id>}
```

If any link in this chain is missing, the value evaporates. This is the
single most common cause of "the LLM seems to ignore my instructions" —
it's actually that the project variable the tool defaults from was never
set, so the function gets called with an empty/zero value.

---

## The four primitives

| Primitive | Where it lives | Purpose |
|---|---|---|
| **Function** | `voiceflow_function` | The actual JS code that calls APIs and returns `outputVars` |
| **Function variable** | `voiceflow_function list_variables` | Typed slot on a function — `type: "input"` or `"output"`. Each has its own UUID |
| **Project variable** | `voiceflow_variable list` | Session-scoped state. Persists across all tool calls in a conversation |
| **Agent tool instance** | `voiceflow_global_tool list` | The wiring layer that connects a function to a specific playbook (agent). One function can have many agent tool instances — one per playbook that uses it |

A function variable lives on the function. A project variable lives on
the project. An agent tool instance is the bridge: it says "when this
playbook calls this function, here's how to fill its inputs and where to
store its outputs."

---

## The three wiring connectors on an agent tool instance

### `inputVariables` — how function inputs get filled

```jsonc
{
  "inputVariables": {
    "assignmentId": {                       // <- function variable name
      "description": "Shown to the LLM",    // shown in the tool's JSON schema to the LLM
      "defaultValue": [                     // fallback if LLM doesn't supply
        { "variableID": "<project_var_id>" }
      ],
      "shouldFulfill": false,               // see semantics below
      "functionInputVariableID": "<fvar_id>" // MUST be the actual function-var UUID
    }
  }
}
```

`shouldFulfill` semantics (this is the most-misunderstood field in the platform):

- `true` ("Agent collect" toggle ON in the UI) — the LLM is asked to
  supply this value. If the LLM omits it, the runtime falls back to
  `defaultValue` (or empty if no default). The LLM has agency here.
- `false` ("Agent collect" toggle OFF) — the runtime auto-fills from
  `defaultValue` and the LLM is never asked. Deterministic — and
  unconditional: there is no fallback to collection. Whatever the bound
  variable holds at call time is what the function receives, even if
  that's an init-workflow placeholder string ("Unknown caller") or empty.

**What flips the toggle:** in the Creator UI, putting *anything* in an input's
`defaultValue` (a variable, a `secretID`, an `entityID`, or literal text)
auto-sets that input to not-collect (`shouldFulfill: false`); an empty default
leaves it collect. That auto-flip is UI-only — when you wire via the API (e.g.
the `voiceflow_playbook_function_tool` MCP tool), `shouldFulfill` is an
independent field and is NOT inferred from the default, so set it explicitly.
(That's also how the `shouldFulfill: true` + non-empty `defaultValue` trap below
arises — the API lets you set the combination the UI wouldn't.)

**Picking between them:**

- Use `false` when the value has a single canonical source (e.g. the
  picked shift's UUID lives in `problem_assignment_uuid`) AND a setter
  is guaranteed to have written that variable earlier on every path
  that reaches this tool. You want the same value every time, no LLM
  hallucination risk.
- Use `true` when the LLM legitimately needs to choose (e.g. picking a
  shift from a list, naming the issue category, writing a ticket
  subject) — or when no upstream setter reliably writes the variable,
  so the LLM collecting it is the only way it gets filled.

> **🚨 NEVER set `shouldFulfill: false` unless a setter (function
> `captureResponse`, `captureInputVariables`, or a workflow set step) is
> GUARANTEED to have written the variable earlier in the same flow.**
> Toggling Agent collect OFF does not add a fallback — it removes
> collection entirely. The LLM stops asking for the value, and the
> default becomes the only source: whatever is sitting in the bound
> variable ships as-is, including init-workflow placeholder strings.
> The failure is silent — a placeholder looks like data to the runtime,
> so the function receives "Unknown zip" instead of a zip code and
> errors (or worse, succeeds with garbage). See Anti-pattern 8.

**The trap:** `shouldFulfill: true` with `defaultValue` set looks safer
("the LLM will fill it but if it doesn't, we have a fallback"). But the
LLM frequently omits the value and relies on the default — including
when the default is empty, in which case empty propagates and the
function errors. If the value has a canonical source — and a guaranteed
setter (see the rule above) — prefer `false`.

### `captureResponse` — how function outputs land in project state

```jsonc
{
  "captureResponse": {
    "outputName": {                          // function variable name (output)
      "variableOrEntityID": "<project_var_id>",
      "functionOutputVariableID": "<fvar_id>"
    }
  }
}
```

When the function returns `outputVars: { outputName: "value" }`, this
mapping writes `"value"` into the project variable
`<project_var_id>`. That write is **synchronous**: as soon as the
function returns, the project variable is updated. (See "Snapshot vs
synchronous write" below.)

Without `captureResponse`, the function's outputs are visible to the LLM
in the conversation history (within the same turn), but they never reach
project state — so they can't be used as defaults for downstream tool
calls in any later turn.

> **⚠️ UI edits can silently wipe captures.** Editing a tool attachment
> in the Creator UI — even just message text or a toggle — has been
> observed to reset that attachment's `captureResponse` to null with no
> warning. After ANY UI-side change to a tool attachment, re-fetch the
> config and confirm captures are still wired (or re-run `audit-wiring`).

### `captureInputVariables` — capture LLM-supplied input args

```jsonc
{
  "captureInputVariables": true
}
```

When `true`, the runtime ALSO captures the input arguments the LLM
supplied to project variables (matched by name). Useful when:

- A `shouldFulfill: true` input represents a piece of state you want to
  persist (e.g. `issueBucket`).
- You want the LLM's chosen value to be available for downstream defaults
  even if the function fails or never returns.

Less common than `captureResponse`. Use sparingly — it's a sharp tool.

---

## Snapshot vs synchronous write — the timing rule

The Voiceflow runtime resolves project-variable defaults at **turn start**.
A "turn" is one LLM completion + the tool calls it batches.

Concrete example: the LLM batches `[updateProblemAssignment, getPaymentInfo]`
in one response.

```
T=0  Turn starts. Snapshot of project vars taken.
     - problem_assignment_uuid = ""   (still empty)
T=1  Both tool calls dispatched.
     - getPaymentInfo defaults assignmentId from snapshot → ""
     - updateProblemAssignment receives explicit args from LLM
T=2  Both functions execute in parallel.
     - getPaymentInfo gets assignmentId="" → 400 error
     - updateProblemAssignment succeeds, captureResponse fires:
         project var problem_assignment_uuid is NOW "abc-123" (sync write)
T=3  LLM sees getPaymentInfo's empty/error response.
T=4  LLM emits a SECOND tool call (retry): getPaymentInfo({})
     - This call resolves defaults from CURRENT state (not snapshot)
     - assignmentId now defaults to "abc-123" → succeeds
```

So:

- Within a single batched response, project-var defaults are FROZEN at
  turn start. Two tools batched in the same response that depend on each
  other's writes will not see those writes.
- BUT — when the LLM retries a tool after seeing its empty/error
  response, that retry resolves defaults against current state, which
  includes any captureResponse writes from the same turn. This is why
  `captureResponse` is self-healing: even if the LLM emits a bad call
  first, the retry typically gets the right value.
- Between turns, project vars are always available.

This is why "wire captureResponse on the upstream call AND keep
shouldFulfill: false on the downstream tool's input" is the right
pattern. The downstream tool will get the empty-default failure on the
first batched call but recover on the retry.

---

## Four canonical wiring patterns

### Pattern 1: Read-only lookup tool

Function reads from an API and returns data. Examples: `getPaymentInfo`,
`getAssignment`, `getIssueCounts`.

- Inputs: usually `assignmentId` (or similar id that has a canonical source)
  + auth (`jwtToken`, `userId`).
- All inputs `shouldFulfill: false`, defaulting from project vars.
- Outputs: capture into project vars if any downstream tool uses them.
  At minimum capture status flags the LLM branches on.

```jsonc
{
  "inputVariables": {
    "assignmentId": { "shouldFulfill": false, "defaultValue": [{"variableID": "<problem_assignment_uuid>"}] },
    "jwtToken":     { "shouldFulfill": false, "defaultValue": [{"variableID": "<jwt_token>"}] }
  },
  "captureResponse": {
    "shiftStatus": { "variableOrEntityID": "<shift_status>", "functionOutputVariableID": "<fvar>" },
    "accountId":   { "variableOrEntityID": "<payment_account_id>", "functionOutputVariableID": "<fvar>" }
  }
}
```

### Pattern 2: State-mutator function

Function writes state somewhere (e.g. a backend record, Zendesk,
internal DB). Examples: `updateProblemAssignment`, `createZendeskTicket`.

- Inputs: mix of LLM-supplied (e.g. ticket body) + auto-filled from
  project vars (auth, IDs, partner info).
- Outputs: must include the values the function ACCEPTED, even if those
  values came from inputs. This makes the function's effect visible to
  project state via captureResponse.

```javascript
// In the function code:
return {
  next: { path: 'success' },
  outputVars: {
    assignmentId: patchAssignmentId,    // echo back the input — captureResponse will land it
    ticketId: createdTicketId,          // new value from the API
  }
};
```

### Pattern 3: Pure side-effect function

Function does something but the result doesn't need to flow elsewhere.
Examples: `setPaymentDisputed`, `updateConversationPath`.

- Outputs: usually empty.
- captureResponse: usually empty.
- Inputs: all `shouldFulfill: false` defaulting from project state.

If you find yourself wanting to capture the input arguments (e.g.
`issueBucket` to persist the chosen category), use
`captureInputVariables: true` on the agent tool instance.

### Pattern 4: Agent-decision-input

The LLM's choice IS the data — there's no canonical source. Examples:
ticket subject line, partial-payment dispute reason, picked shift number.

- Input: `shouldFulfill: true`, no default (or a help-text default).
- The function's return SHOULD echo it back as an output, so
  captureResponse can write it to project state for downstream use.

---

## Anti-patterns

### Anti-pattern 1: `defaultValue` from a project var that's never written

A tool input defaults from project var `payment_account_id` but no
function ever writes to that var. Result: every call gets an empty
default and the function errors.

**Fix:** Find the function whose response carries this value, add an
output variable, wire captureResponse on its agent tool instance.

### Anti-pattern 2: `shouldFulfill: true` for a value that has a canonical source

A tool's `assignmentId` is `shouldFulfill: true` with `defaultValue:
problem_assignment_uuid`. The LLM is asked to fill it. The LLM sometimes
hallucinates a different UUID, sometimes omits, sometimes gets it right.

**Fix:** Switch to `shouldFulfill: false`. The default is always used.
No LLM agency on a value where there's nothing to choose. **Precondition:**
verify a setter writes that variable on every path that reaches the tool
first — if collection is the only thing filling it today, flipping the
toggle trades occasional hallucination for guaranteed placeholder
shipping (Anti-pattern 8).

### Anti-pattern 3: Function returns no outputs even though downstream tools need its result

A `setPaymentDisputed` function takes a `payoutTotal` arg but its
preceding `approveShiftForPayment` doesn't return `payoutAmount` as an
output. The LLM has to thread the value across tool calls in
conversation history. Fragile.

**Fix:** Add `payoutAmount` to `approveShiftForPayment`'s `outputVars`,
create project var `payout_amount`, wire captureResponse, set
`setPaymentDisputed.payoutTotal` default to that var with
`shouldFulfill: false`.

### Anti-pattern 4: `functionInputVariableID` set to a literal name string

Some platform-side bugs (or older create flows) leave
`functionInputVariableID` set to the input name (e.g. `"jwtToken"`)
instead of the actual UUID (e.g. `"69cc..."`). The UI may render
correctly but the wiring is corrupted.

**Fix:** Run the audit (see `audit-wiring` skill). When updating any
agent tool, repair these IDs in the same patch — don't preserve broken
state across edits.

### Anti-pattern 5: Phantom inputs (input keyed by a function-var-ID)

```jsonc
"inputVariables": {
  "jwtToken": { ... },                          // proper-named entry
  "69cc5df9a8a085e2ca4bb03e": { ... }           // phantom duplicate!
}
```

Same root cause as #4. The phantom usually has `description: null` and
should be dropped. Also caught by the audit.

### Anti-pattern 6: Treating prompt fixes as a substitute for wiring fixes

When a function gets called with bad args, the instinct is to add more
WRONG/RIGHT examples to the prompt. The model still gets it wrong
because the issue isn't reasoning — it's that the platform-side default
is empty.

**Fix:** Inspect the wiring before iterating on the prompt. Run
`audit-wiring`. If the upstream var isn't being set, capture it. If the
input isn't deterministic, switch shouldFulfill.

### Anti-pattern 7: Reading `args.secrets.*` inside function code

`args.secrets` does not exist in the V4 function sandbox. A function written
like this:

```javascript
const apiKey = args.secrets?.MY_API_KEY || '';
```

…always sets `apiKey = ''`. The function returns on the error path with
"missing secret" and the LLM hallucinates around the empty result.

**Fix:** Declare `api_key` as a function input variable, read
`args.inputVars.api_key` in the code, and on the tool attachment wire
`inputVariables.api_key.defaultValue = [{ secretID: "<uuid>" }]` with
`shouldFulfill: false`. See the `functions` skill "Reading secrets" section for
the full pattern.

### Anti-pattern 8: `shouldFulfill: false` with no guaranteed setter

The mirror image of Anti-pattern 2 — and more dangerous, because the
failure is silent. An input gets flipped to `shouldFulfill: false`
because the variable "has a canonical source"… but nothing on the
active path actually writes that variable before the tool fires.

Real incident: a follow-up-creation tool's customer inputs (name, zip,
phone) were flipped to `shouldFulfill: false` during a wiring cleanup.
For existing callers a lookup function captured those vars; for NEW
callers nothing did — the init workflow had only seeded placeholder
strings. Every new-caller follow-up shipped `zip: "Unknown zip"` and the
API rejected it with MISSING_ZIP. The LLM never asked for the zip,
because Agent collect was off — that toggle removes collection, it
doesn't add a fallback.

**Fix:** Before flipping any input to `shouldFulfill: false`, trace the
setter: which function's `captureResponse` (or workflow set step) writes
this variable, and does it run on EVERY path that reaches this tool? If
any path arrives without a setter, keep Agent collect ON for that input
so the LLM can gather it, or add the missing setter upstream. Treat
init-workflow placeholder seeds as "unset" — they satisfy the runtime
but not the API you're calling.

---

## Workflow: changing tool wiring safely

1. **Read first**. Pull the current tool config via
   `voiceflow_global_tool get`. Note: the export contains the
   FULL config; partial PATCH means anything you omit stays the same,
   but anything you include replaces.
2. **Repair while you're there**. If the existing `inputVariables`
   contains phantoms or string-typed `functionInputVariableID`, fix them
   in the same patch. Don't preserve broken state.
3. **Validate referenced IDs**. Every `variableID` in `defaultValue`
   should exist in project vars. Every `functionInputVariableID` should
   match a real input variable on that function. Every
   `functionOutputVariableID` in `captureResponse` should match a real
   output variable.
4. **Compile after the change**. `voiceflow_project compile_version`
   to pick up the new wiring.
5. **Smoke test the data flow, not just the conversation**. After any
   wiring change, run a session that triggers the function and inspect
   the trace's `outputVars` and project-var `diff` blocks to confirm
   captures landed.
6. **Audit for `args.secrets` reads.** Before shipping, grep function code
   for `args.secrets` — every match is a runtime failure waiting to happen.
   Refactor to input-variable + `secretID` wiring (see the `functions` skill
   "Reading secrets" section).
7. **Re-verify captures after any UI-side edit.** Editing a tool
   attachment in the Creator UI (message text, toggles, descriptions)
   can silently reset its `captureResponse` to null — observed in the
   wild more than once. If anyone touched the UI since your last audit,
   re-fetch the tool configs (or re-run `audit-wiring`) before trusting
   the wiring.

---

## Quick reference

| Problem | Likely fix |
|---|---|
| LLM calls function with empty args | Wire upstream captureResponse + set input default + flip shouldFulfill: false |
| Project var "stays empty" all session | Find the upstream function, add output, capture |
| LLM threads a value across tool calls and sometimes drops it | Same — capture upstream, default downstream |
| Tool config "looks right in UI" but behaves wrong | Audit `functionInputVariableID` types and check for phantom inputs |
| Two batched tools depend on each other's writes | Accept that the first call won't see the write; rely on LLM retry — OR break the batch into separate turns via prompt instructions |
| Function returns "missing secret" / empty auth | Switch from `args.secrets.X` to a function input variable; wire `defaultValue` via `secretID` Markup (shouldFulfill: false) on each playbook tool attachment |
| Function receives placeholder strings ("Unknown caller", "Unknown zip") as args | A `shouldFulfill: false` input's variable has no setter on that path — restore Agent collect for it or add the upstream setter (Anti-pattern 8) |
| Captures that were wired yesterday are gone | UI edits to the attachment silently reset captureResponse — re-wire, and re-audit after any UI-side change |

---

## When in doubt

Run `audit-wiring`. It enumerates every gap. Most of the time the fix
is mechanical once the gap is named.

---

## Related skills

- **`audit-wiring`** — runs a structured audit on a project export. Use this to find specific gaps in your project; come back here to interpret findings.
- **`functions`** — function code patterns and the `outputVars` typing rules. Read this when writing or editing the JS that runs inside a function tool.
- **`prompt-optimizer`** — read if a prompt-optimization run keeps producing candidates that don't fix the bug. Often the bug is wiring, not prompt.
- **`build-agent`** — full agent build workflow; this skill is one section of that.
- **`voiceflow-overview`** — index of all available skills.
