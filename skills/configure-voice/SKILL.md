---
name: configure-voice
description: View and modify voice settings — STT/TTS provider, model, language, call recording, keypad input
---

Delegate this task to the `build-agent` subagent using the Agent tool.

Pass it the intent: "Configure voice settings"
And the user's arguments: $ARGUMENTS

The subagent fetches current voice config, presents it, and applies
changes after confirmation via the copilot API.

## After the subagent returns

1. Show the results to the user in chat
2. Offer a concrete next step
