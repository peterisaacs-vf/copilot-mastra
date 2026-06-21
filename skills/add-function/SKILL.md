---
name: add-function
description: Scaffold a complete function — code, input/output variables, output paths, and tool assignment
---

Delegate this task to the `build-agent` subagent using the Agent tool.

Pass it the intent: "Add a new function"
And the user's arguments: $ARGUMENTS

The subagent scaffolds the full function (code, variables, paths, tool
assignment) via the copilot API.

## After the subagent returns

1. Show the results to the user in chat
2. Offer a concrete next step
