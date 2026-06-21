---
name: audit-kb
description: Audit, debug, and manage a project's knowledge base
---

Delegate this task to the `audit-kb-agent` subagent.

Pass it the project name/ID from the user's argument: $ARGUMENTS

The subagent has the build skill preloaded (KB design best practices)
and all KB MCP tools. It will:
1. Load project context and inventory the KB
2. Ask the user what the problem is before acting
3. Debug retrieval, fix gaps, or run a health check
4. Verify improvements

## After the subagent returns

Show the results to the user in chat.
