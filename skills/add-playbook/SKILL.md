---
name: add-playbook
description: Add a new playbook (sub-agent) to an existing agent and wire it into the crew
---

Delegate this task to the `build-agent` subagent using the Agent tool.

Pass it the intent: "Add a new playbook"
And the user's arguments: $ARGUMENTS

The subagent creates the playbook, writes instructions, and wires it
into the crew configuration via the copilot API.

## After the subagent returns

1. Show the results to the user in chat
2. Offer a concrete next step
