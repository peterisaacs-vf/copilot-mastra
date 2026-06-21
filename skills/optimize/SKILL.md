---
name: optimize
description: Optimize prompts (global, operator, or playbook) using real transcript data via GEPA
---

Delegate this task to the `prompt-optimizer-agent` subagent using the Agent tool.

Pass it the intent: "Optimize prompt using transcript data (GEPA)"
And the user's arguments: $ARGUMENTS

The subagent has the prompt-optimizer skill preloaded and uses the
prompt-optimizer methodology — pull recent transcripts, surface failure
patterns, and propose targeted prompt edits.

## After the subagent returns

1. Show the results to the user in chat
2. Offer a concrete next step (apply edits, run smoke test, etc.)
