---
name: review-agent
description: Review an agent's architecture, prompts, tools, KB, and eval coverage
---

Delegate this task to the `review-agent` subagent.

Pass it the project name/ID from the user's argument: $ARGUMENTS

The subagent has the build and document skills preloaded and all
necessary MCP tools. It will:
1. Load project context
2. Interview the user
3. Audit prompts, tools, KB, and evals
4. Produce a structured review
5. Create or update the project wiki

## After the subagent returns

Show the results to the user in chat.
