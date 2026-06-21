---
name: build-integration
description: Build a Voiceflow tool from API documentation
---

Delegate this task to the `build-agent` subagent using the Agent tool.

Pass it the intent: "Build an integration from API docs"
And the user's arguments: $ARGUMENTS

The subagent has the build skill preloaded with function code patterns,
tool design best practices, and the VF fetch API reference. It works in
direct mode (copilot API) or handoff mode (markdown artifacts).

## After the subagent returns

1. Show the results to the user in chat
2. Offer a concrete next step
