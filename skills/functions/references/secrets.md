# Reading secrets

Loaded on demand from this skill via `skill_read`.

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
