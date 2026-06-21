---
name: analyze-transcripts
description: Analyze transcripts to find systemic issues and recommend fixes
---

Delegate this task to the `analyze-transcripts-agent` subagent.

Pass it the project name/ID and any scope details from the user's
argument: $ARGUMENTS

The subagent has the debug skill preloaded and all transcript, eval,
KB, and analytics MCP tools. It will:
1. Load project context (config, wiki, agent export, evals)
2. Ask the user what time period, focus area, and output format
3. Triage transcripts with parallel Haiku agents
4. Deep-read failures via debug-agent subagents
5. Cross-correlate patterns across all 5 mandatory dimensions
6. Produce prioritized findings with evidence and fix proposals

## After the subagent returns

Show the results to the user in chat.

## After presenting findings

If the analysis proposed fixes, offer the user:

"Once you've applied these changes in Creator, come back and say
'fixed' — I'll run a smoke test to verify the fixes work."

When the user confirms they've applied the fix:
1. Delete state for a clean session (`delete_state`)
2. Run a 3-5 turn conversation targeting the specific scenario that failed
3. Evaluate whether the fix resolved the issue
4. Report: PASS (fix works) or STILL FAILING (with new diagnosis)
