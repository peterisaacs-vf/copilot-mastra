---
name: clone-function
description: Copy a function (with variables and paths) from one project to another
---

Delegate this task to the `build-agent` subagent using the Agent tool.

Pass it the intent: "Clone a function between projects"
And the user's arguments: $ARGUMENTS

The subagent reads the source function, checks the target for conflicts,
and creates everything (code, variables, paths, tool assignment) via the
copilot API.

## After the subagent returns

1. Show the results to the user in chat
2. Offer a concrete next step
