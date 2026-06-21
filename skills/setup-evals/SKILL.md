---
name: setup-evals
description: Design, create, and calibrate evaluations for a Voiceflow agent
---

Delegate this task to the `setup-evals-agent` subagent.

Pass it the project name/ID from the user's argument: $ARGUMENTS

The subagent has the test skill preloaded and all eval MCP tools. It will:
1. Load project context and export the agent
2. Ask the user what they're concerned about before acting
3. Extract testable rules from the prompt
4. Design and create evaluations
5. Calibrate against real transcripts

## After the subagent returns

Show the results to the user in chat.
