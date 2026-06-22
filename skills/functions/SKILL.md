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

## Reference files

Pulled out to keep this skill focused — load with `skill_read` when you need the depth:

- `references/secrets.md` — declaring a secret as an input variable, wiring the tool attachment, why shouldFulfill:false is mandatory, looking up the secret ID, multi-playbook attach.
- `references/custom-traces.md` — custom + fire-and-forget traces, matching interact() events to next.to, widget extension registration.

## Related skills

- **`wiring-architect`** — function variables, captureResponse, shouldFulfill, default values, and how a function's outputs reach downstream tool input defaults. Read this BEFORE wiring a function as an agent tool — most function-tool issues are wiring issues, not code issues.
- **`audit-wiring`** — run a structured audit before changing a project's function or tool wiring.
- **`build-agent`** — full build context when the function is part of a new agent build.
- **`debug`** — when you're investigating why a function call is producing wrong results.
- **`voiceflow-overview`** — index of all available skills.
