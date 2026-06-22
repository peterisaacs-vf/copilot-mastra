# Custom trace functions

Loaded on demand from this skill via `skill_read`.

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
