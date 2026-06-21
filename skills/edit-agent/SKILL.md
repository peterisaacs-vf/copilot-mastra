---
name: edit-agent
description: Interactive editor for an existing Voiceflow agent — modify prompts, settings, tools, functions, variables, paths, voice config, and crew
---

Delegate this task to the `build-agent` subagent using the Agent tool.

Pass it the intent: "Edit an existing agent"
And the user's arguments: $ARGUMENTS

The subagent handles all agent modifications via the copilot API.

## After the subagent returns

1. Show the results to the user in chat
2. Offer a concrete next step
