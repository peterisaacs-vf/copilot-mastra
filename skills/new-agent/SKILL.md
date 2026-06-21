---
name: new-agent
description: Guided workflow to build a new Voiceflow agent
---

Delegate this task to the `build-agent` subagent using the Agent tool.

Pass it the intent: "Build a new agent from scratch"
And the user's arguments: $ARGUMENTS

The subagent has the build and document skills preloaded and can work in
direct mode (copilot API) or handoff mode (markdown artifacts).

## After the subagent returns

1. Show the results to the user in chat
2. Offer a concrete next step
