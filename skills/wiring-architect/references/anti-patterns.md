# Wiring anti-patterns

Loaded on demand from this skill via `skill_read`.

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
