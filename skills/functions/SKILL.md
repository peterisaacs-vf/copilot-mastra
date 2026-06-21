---
name: functions
description: >
  Voiceflow function development reference. Covers the sandbox runtime
  (what's available and what isn't), the modified fetch API, inline
  helpers for missing primitives, the two function types (standard
  path-routing vs custom-trace `listen`), input normalization, error
  handling, and evaluation criteria.
  TRIGGER when: user asks to create, edit, or debug a Voiceflow function;
  pastes function code; mentions custom traces, forms, carousels, TwiML,
  SIP transfer, `listen: true`, or widget extensions; or asks to add an
  API integration to a Voiceflow agent.
version: 0.1.0
---

# Voiceflow Function Development

## Basic Structure

```javascript
export default async function main(args) {
  const { inputVar1, inputVar2 } = args.inputVars;

  // Your logic here

  return {
    outputVars: {
      output1: 'value',
      output2: 123,
      output3: true
    },
    next: {
      path: 'success'
    },
    trace: [
      {
        type: 'debug',
        payload: { message: 'Debug info here' }
      }
    ]
  };
}
```

## Critical Rules

### outputVars Types

**ONLY `string | number | boolean`** — NO null or undefined!

```javascript
// WRONG
outputVars: { name: null, count: undefined }

// CORRECT
outputVars: { name: '', count: 0, found: false }
```

### Always Return RuntimeCommands

Every code path MUST return `outputVars`:

```javascript
// WRONG
if (error) { console.log('error'); }

// CORRECT
if (error) {
  return {
    outputVars: { success: false, error_message: 'Something failed' },
    next: { path: 'error' }
  };
}
```

## Reading secrets

**Secrets are NOT accessed via `args.secrets` in V4 functions.** That interface
doesn't exist in the function sandbox — referencing it returns `undefined` and
the function silently fails (returns on the error path, then the LLM tends to
hallucinate around the empty result).

The V4 pattern: declare the secret as a **function input variable**, and let
the agent tool attachment inject it via `secretID` Markup. This is the same
mechanism the platform uses for secrets in any tool input field (in the
Creator UI you type `{`, switch to the Secrets tab, and pick the secret).

### Step 1 — declare the secret as an input variable

When the function needs an API key, OAuth credential, password, or any other
secret, add it as an input variable on the function alongside the regular ones:

```javascript
export default async function main(args) {
  const { question, chunk_limit, api_key } = args.inputVars || {};

  if (!api_key) {
    return {
      outputVars: { success: false, error: 'missing api_key' },
      trace: [{ type: 'debug', payload: { message: 'api_key not provided — check tool wiring' } }],
      next: { path: 'error' }
    };
  }

  // use api_key normally — it arrives as a regular string
  const response = await fetch('https://api.example.com/...', {
    headers: { Authorization: api_key }
  });
  // ...
}
```

The input variable's description should make clear it's secret-bound:
`"API key for X. Auto-filled from secret SECRET_NAME — do not change."`

### Step 2 — wire the agent tool attachment

When attaching this function to a playbook (via `voiceflow_playbook_function_tool`
`create` or `update`), set the secret as the input's `defaultValue`:

```jsonc
{
  "inputVariables": {
    "api_key": {
      "description": "API key for X. Auto-filled from secret X_API_KEY.",
      "defaultValue": [
        { "secretID": "<uuid-of-the-secret>" }
      ],
      "shouldFulfill": false,
      "functionInputVariableID": "<uuid-of-the-function-input-variable>"
    },
    "question": {
      "description": "User's question",
      "defaultValue": null,
      "shouldFulfill": true,
      "functionInputVariableID": "<uuid>"
    }
  }
}
```

The `secretID` Markup is the magic — at turn start, the runtime resolves it to
the plaintext value and injects it as the input. The LLM never sees the secret
because `shouldFulfill: false` means the value is auto-filled, not LLM-supplied.

### Why `shouldFulfill: false` is mandatory here

If you leave `shouldFulfill: true` on a secret input, the LLM is asked to fill
it. The LLM will either omit it (function gets empty input) or hallucinate
something that looks like a key. Both are broken. **Always pair `secretID`
defaults with `shouldFulfill: false`.** Note the Creator UI auto-sets
not-collect the moment you add any default, but the API does not infer it — so
when wiring through the MCP tools you must pass `shouldFulfill: false` yourself.
See the `wiring-architect` skill for the full `shouldFulfill` semantics.

### Looking up the secret ID

There's no MCP tool that lists secrets directly. Two options:

1. **From a project export** — `voiceflow_project export` includes the secret
   names/IDs (values are never exported). Read the secrets array from the export.
2. **From the V4 UI** — the DevTools Network tab shows the secret IDs in the
   secret-list API response. Less reliable; prefer the export.

A function that needs N secrets needs N input variables and N matching
`secretID` defaults on every playbook attachment that uses it.

### Verifying it works

After wiring, run a live test. In the debug trace, the function's `inputVars`
will show the secret as `"<input_name>": "[secret]"` (masked). If you see the
literal string `"undefined"` or an empty string, the wiring is wrong.

### When the function is attached to multiple playbooks

If a function is attached to 3 different playbooks, you need to set the
`secretID` defaultValue on ALL 3 attachments. There is no project-level
"default input wiring" — each attachment is independent.

## Fetch API

Voiceflow has a modified fetch — `.json` is a property, not a method:

```javascript
// GET
const response = await fetch('https://api.example.com/data');
const data = response.json;  // .json NOT .json()

// POST
const response = await fetch('https://api.example.com/data', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ key: 'value' })
});
const data = response.json;
```

### Parse Types
```javascript
const data = (await fetch(url)).json;                              // JSON (default)
const data = (await fetch(url, {}, { parseType: 'text' })).text;   // Text
const data = (await fetch(url, {}, { parseType: 'arrayBuffer' })).arrayBuffer;
const data = (await fetch(url, {}, { parseType: 'blob' })).blob;
```

## Runtime Commands

### outputVars — Sets variables for later use
### next — Directs exit path:
```javascript
next: { path: 'success' }  // Must match defined path
```

### trace — Generates response traces:
```javascript
trace: [
  { type: 'text', payload: { message: 'Hello!' } },
  { type: 'debug', payload: { message: 'Debug info' } }
]
```

## Trace Types

**All projects:**
- `visual` — `{ image: 'https://...' }`
- `debug` — `{ message: 'Debug info' }` (hidden in production)
- `choice` — `{ buttons: [{ name: 'Option', request: { type: 'opt' } }] }`

**Chat only:**
- `text` — `{ message: 'Hello!' }`
- `cardV2` — `{ imageUrl, title, description: { text }, buttons }`
- `carousel` — `{ cards: [...] }`

**Voice only:**
- `speak` — `{ message: 'Hello!' }`
- `audio` — `{ src: 'base64-audio' }`

**Custom (extension- or runtime-defined):**

- `form`, `cardCarousel`, etc. — emitted by your function, rendered by a
  registered widget extension whose `match({ trace })` returns true
- `twiml` — XML payload picked up by the Twilio voice runtime for
  SIP transfer, `<Dial>`, `<Hangup>`, etc.

Custom trace types pair with `next: { listen: true, ... }` (or no `next`
at all for fire-and-forget). See "Custom Trace Functions" below.

## Sandbox: What You Don't Have

VF Functions run in a restricted serverless sandbox — not Node, not
browser. The runtime silently breaks if you reach for primitives that
aren't there. Internalize this list.

**Globals that are NOT defined** — using them throws cryptic errors or
returns `undefined`:

- `Buffer`, `process`, `require`, `import` — no Node APIs, no module loading
- `URL`, `URLSearchParams` — parse URLs by hand or build query strings inline
- `atob`, `btoa` — write inline base64 helpers (see below)
- `FormData`, `Blob`, file uploads — no binary or multipart bodies; JSON
  or manually URL-encoded only
- `setTimeout`, `setInterval` — no timers
- `localStorage`, `sessionStorage` — no persistence; each invocation is stateless
- `args.secrets` — does NOT exist in V4 function sandboxes. Secrets reach the
  function as regular input variables, wired via `secretID` Markup on the
  agent tool attachment. See "Reading secrets" above.

**Other constraints:**

- ES2020-ish JS only. Keep it boring.
- Tight execution timeout — no heavy computation.
- `outputVars` must be `string | number | boolean` only — never `null`,
  `undefined`, object, or array. Coerce with `String(value)` for scalars
  and `JSON.stringify(obj)` for complex data.
- No npm packages. Everything inline.

## Inline Helpers

Since `atob`, `btoa`, `Buffer`, and `URLSearchParams` aren't available,
inline these in any function that needs them.

**Base64 encoding** (Basic auth, etc.):

```javascript
function base64Encode(str) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let result = '';
  const bytes = [];
  for (let i = 0; i < str.length; i++) {
    bytes.push(str.charCodeAt(i));
  }
  for (let i = 0; i < bytes.length; i += 3) {
    const b1 = bytes[i];
    const b2 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b3 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    result += chars[b1 >> 2];
    result += chars[((b1 & 3) << 4) | (b2 >> 4)];
    result += i + 1 < bytes.length ? chars[((b2 & 15) << 2) | (b3 >> 6)] : '=';
    result += i + 2 < bytes.length ? chars[b3 & 63] : '=';
  }
  return result;
}
```

**URL encoding** (form-encoded request bodies):

```javascript
function urlEncode(params) {
  return Object.entries(params)
    .map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v))
    .join('&');
}
```

## Two Function Types

VF functions split into two categories with distinct routing semantics.
Decide which type before writing code — getting it wrong means the
entire `next` structure will be wrong.

| User mentions… | Type |
|----------------|------|
| API call, webhook, data transform, CRUD | **Standard** |
| Form, custom UI, carousel, custom trace, extension | **Custom trace** |
| "Listen", "wait for user", "interact", "pause" | **Custom trace + `listen: true`** |
| TwiML, SIP transfer, end call | **Fire-and-forget custom trace** (no `next`) |

If unclear, ask. The two types use different `next` shapes and aren't
interchangeable.

## Standard Functions (Error Handling Pattern)

API calls, data transforms, anything that runs and routes to a canvas
path. Use `next: { path: 'success' | 'error' | <custom> }`. The runtime
executes, returns, and continues down the chosen path immediately.

```javascript
export default async function main(args) {
  const { order_id } = args.inputVars || {};

  if (!order_id) {
    return {
      outputVars: { success: false, error_code: 'MISSING_ORDER_ID', order_data: '' },
      next: { path: 'error' },
      trace: [{ type: 'debug', payload: { message: 'order_id missing' } }]
    };
  }

  try {
    const response = await fetch(`https://api.example.com/orders/${order_id}`);

    if (!response.ok) {
      const errorBody = await response.text;
      return {
        outputVars: { success: false, error_code: `HTTP_${response.status}`, order_data: '' },
        next: { path: 'error' },
        trace: [{ type: 'debug', payload: { message: `API ${response.status}: ${errorBody}` } }]
      };
    }

    const data = response.json;

    if (!data.order_id) {
      return {
        outputVars: { success: false, error_code: 'ORDER_NOT_FOUND', order_data: '' },
        next: { path: 'not_found' }
      };
    }

    return {
      outputVars: { success: true, error_code: '', order_data: JSON.stringify(data) },
      next: { path: 'success' }
    };
  } catch (err) {
    return {
      outputVars: { success: false, error_code: 'API_ERROR', order_data: '' },
      next: { path: 'error' },
      trace: [{ type: 'debug', payload: { message: `Error: ${err?.message || String(err)}` } }]
    };
  }
}
```

## Custom Trace Functions

These emit a custom trace type that a chat widget extension or the
Twilio voice runtime renders. They use `next: { listen: true, to: [...] }`
to **pause the runtime** until the extension sends an event back via
`interact()`. The function does NOT re-run when the event arrives —
the runtime routes to the matched path on the canvas.

Key differences from standard functions:

- `next.listen: true` instead of `next.path`
- `next.to` maps incoming events to canvas paths via MongoDB-style queries
- `next.defaultTo` is the fallback path
- Path names are custom (`submitted`, `cancelled`, etc.) — not just `success`/`error`
- The function emits a trace and pauses; it does NOT process the response
- **Every path MUST have steps wired on the canvas.** A dead-end path
  is treated as end-of-conversation and the runtime won't pause.

Example — form with listen:

```javascript
export default async function main(args) {
  const { form_title, fields } = args.inputVars || {};

  let formFields;
  try {
    let parsed = fields;
    if (typeof parsed === 'string' && parsed.trim()) {
      parsed = JSON.parse(parsed);
    }
    if (parsed && !Array.isArray(parsed)) {
      parsed = [parsed];
    }
    formFields = parsed && parsed.length ? parsed : [
      { name: 'full_name', label: 'Full Name', type: 'string', required: true },
      { name: 'email', label: 'Email Address', type: 'email', required: true },
    ];
  } catch (err) {
    return {
      trace: [{ type: 'debug', payload: { message: 'Invalid fields JSON: ' + String(err?.message || err) } }],
      next: { path: 'error' },
    };
  }

  return {
    trace: [{
      type: 'form',
      payload: {
        formSlug: 'dynamic-form',
        title: form_title || 'Contact Information',
        fields: formFields,
        submitButtonText: 'Submit',
        cancelButtonText: 'Cancel',
      },
    }],
    next: {
      listen: true,
      to: [
        { on: { 'event.payload.event.name': 'form_submitted' }, dest: 'submitted' },
        { on: { 'event.payload.event.name': 'form_cancelled' }, dest: 'cancelled' },
      ],
      defaultTo: 'cancelled',
    },
  };
}
```

`next.listen` semantics:

- `listen: true` — pause until an `interact()` event arrives
- `listen: false` — continue, but events persist for the session
  (useful for carousels where the user might click later)

### Fire-and-Forget Custom Traces

For TwiML SIP transfers and similar one-shot traces, omit `next`
entirely — no paths, no listen, no output variables. The trace is
emitted and the conversation ends or the voice runtime takes over.

```javascript
export default async function main(args) {
  return {
    trace: [{
      type: 'twiml',
      payload: `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial>
    <Sip>sip:agent@example.sip.twilio.com;transport=UDP</Sip>
  </Dial>
</Response>`,
    }],
  };
}
```

### Matching `interact()` Events to `next.to`

The widget extension fires events like this:

```javascript
window.voiceflow.chat.interact({
  type: 'event',
  payload: {
    event: { name: 'form_submitted' },
    payload: JSON.stringify({ field1: 'value1' }),
  },
});
```

The runtime nests the interact payload inside its own event wrapper, so
the `to` query matches against the FULL path: `event.payload.event.name`.

```javascript
to: [
  { on: { 'event.payload.event.name': 'form_submitted' }, dest: 'submitted' },
  { on: { 'event.payload.event.name': 'form_cancelled' }, dest: 'cancelled' },
],
```

**Common mistake:** querying `event.type` or `event.name`. Both miss
because the runtime adds an outer wrapper. `dest` strings MUST match
canvas path names exactly.

### Widget Extension Registration

Chat widget extensions register inside `assistant: { extensions: [...] }`
in `chat.load()` — NOT at the top level. A top-level `extensions` is
silently ignored.

```javascript
// CORRECT
window.voiceflow.chat.load({
  verify: { projectID: 'YOUR_PROJECT_ID' },
  url: 'https://general-runtime.voiceflow.com',
  versionID: 'production',
  assistant: { extensions: [FormExtension] },
});

// WRONG — extension never loads
window.voiceflow.chat.load({
  verify: { projectID: 'YOUR_PROJECT_ID' },
  extensions: [FormExtension],
});
```

## Input Variable Normalization

VF input variables are loosely typed. JSON-stringified data may arrive
as a parsed object instead of a string, or as a single object instead
of an array. Normalize before use:

```javascript
let parsed = inputVar;
if (typeof parsed === 'string' && parsed.trim()) {
  parsed = JSON.parse(parsed);
}
if (parsed && !Array.isArray(parsed)) {
  parsed = [parsed];  // wrap single object in array
}
```

Without this, "works in dev, breaks in production" is the typical
failure mode for any function that takes structured input.

## Variable Pre-resolution Pattern

Prompts can't branch on variable values — `{customer_name}` is just
literal substitution, and unset variables resolve to `0`. When a prompt
needs conditional behavior, resolve it in a function first:

```javascript
const greeting = customer_name && customer_name !== '0'
  ? `Hi ${customer_name}, welcome back!`
  : 'Hi there, welcome!';

return { outputVars: { greeting_text: greeting } };
```

Then the prompt references `[greeting_text]` in the body and binds it
in `<input_data>` — always clean, no `0` leakage:

```
<flow>
  Open with [greeting_text].
</flow>

<input_data>
greeting_text = "{greeting_text}" — pre-resolved greeting from
  get_context function.
</input_data>
```

See the `prompting` skill for the full `[name]` + `<input_data>`
convention.

## Function Exit Wiring

When a function returns `outputVars`, map them to agent variables:

```
Function Output    >  Agent Variable
customer_name      >  {customer_name}
account_status     >  {account_status}
```

Always provide: function code, input variables with descriptions,
output variables with descriptions, exit wiring mapping, exit paths.

## Editing Existing Functions

When the user asks to modify an existing function, audit the existing
code for sandbox-incompatible patterns BEFORE making the requested
change — even if they say "keep everything else the same." Existing
functions often carry latent bugs that have never been tripped.

Always catch and fix:

- `response.json()` / `response.text()` with parens — silently fail; remove parens
- `require(...)` / `import` of npm packages — replace with inline code
- `Buffer`, `URLSearchParams`, `atob`, `btoa`, `FormData`, `Blob` — replace with inline helpers or restructure
- Missing try/catch around async work
- Missing trace arrays (no debug visibility when things break)
- Raw object/number outputs where strings are expected
- For custom-trace functions: `next: { path: ... }` where it should be `next: { listen: true, to: [...] }`

Flag what you fixed alongside the requested change so the user knows.
"Keep everything else the same" means preserve intent and structure,
not preserve broken code.

## Evaluation Criteria

| # | Criterion | PASS | FAIL |
|---|-----------|------|------|
| 1 | outputVars types | string, number, boolean | null, undefined, object, array |
| 2 | response.json | Property (`.json`) | Method (`.json()`) |
| 3 | Error paths | Every catch returns valid defaults | Catch returns null or throws |
| 4 | Path coverage | success + error minimum (standard); every `dest` wired on canvas (custom trace) | Missing error path; dead-end `dest` |
| 5 | Input descriptions | Every input var described | Missing description |
| 6 | Debug traces | At least one trace | No traces |
| 7 | Auth handling | Auth values arrive via `args.inputVars` (wired from `secretID` on the tool attachment) | Hardcoded keys in function code, OR reading from `args.secrets.*` (doesn't exist in V4 sandbox) |
| 8 | Prompt alignment | Prompt says when to call + what to collect | Prompt doesn't mention tool |
| 9 | Tool LLM description | WHAT it does AND WHEN to call it, in the same field (see `build-agent`) | Description has only "what"; "when" is buried in instructions |
| 10 | Sandbox primitives | No `Buffer`, `URL`, `URLSearchParams`, `atob`, `btoa`, `FormData`, `require`, `import` | Any of these reached for directly |
| 11 | Function type routing | Standard uses `next.path`; custom trace uses `next.listen` + `to` + `defaultTo`; fire-and-forget omits `next` | Type and `next` shape mismatched |
| 12 | Event match path (custom trace) | `to` queries `event.payload.event.name` | Queries `event.type` or `event.name` |
| 13 | Input normalization | JSON-shaped inputs handle string / parsed object / single-object-not-array | Assumes one shape; breaks in production |

## Pre-Delivery Checklist

Quick mental check before handing the function back to the user.

**All functions:**

- [ ] No `Buffer`, `URL`, `URLSearchParams`, `atob`, `btoa`, `FormData`, `require`, `import`
- [ ] `response.text` / `response.json` used as properties (no parens)
- [ ] `outputVars` are string / number / boolean — no null, undefined, object, or array
- [ ] Input validation up front with early return on error path
- [ ] Try/catch around all async work
- [ ] Debug trace on both success and error paths
- [ ] Inline helpers included for any encoding (base64, URL encoding) actually used
- [ ] No `args.secrets.*` references — secrets arrive as `args.inputVars` only
- [ ] Every secret needed has a matching function input variable declared
- [ ] Tool attachment description tells the user which secret each input expects

**Custom trace functions (in addition):**

- [ ] `next: { listen: true, to: [...], defaultTo: '...' }` — NOT `next: { path: '...' }`
- [ ] `dest` values match canvas path names exactly
- [ ] Every path has steps wired on the canvas (otherwise the runtime won't pause)
- [ ] `to` queries use `event.payload.event.name` — not `event.type` or `event.name`
- [ ] Input vars normalized for string / parsed-object / single-object-not-array
- [ ] Companion widget extension registers under `assistant: { extensions: [...] }`, not top level
- [ ] Fire-and-forget traces (TwiML, SIP) have NO `next` at all — no paths, no variables

---

## Related skills

- **`wiring-architect`** — function variables, captureResponse, shouldFulfill, default values, and how a function's outputs reach downstream tool input defaults. Read this BEFORE wiring a function as an agent tool — most function-tool issues are wiring issues, not code issues.
- **`audit-wiring`** — run a structured audit before changing a project's function or tool wiring.
- **`build-agent`** — full build context when the function is part of a new agent build.
- **`debug`** — when you're investigating why a function call is producing wrong results.
- **`voiceflow-overview`** — index of all available skills.
