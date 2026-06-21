---
name: update-prompt
description: Directly edit a specific agent's prompt — persona, guidelines, or playbook instructions
---

Delegate this task to the `build-agent` subagent using the Agent tool.

Pass it the intent: "Edit a specific prompt"
And the user's arguments: $ARGUMENTS

The subagent loads only the target prompt, shows a diff, and applies
after confirmation via the copilot API.

## After the subagent returns

1. Show the results to the user in chat
2. Offer a concrete next step
