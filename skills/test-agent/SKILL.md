---
name: test-agent
description: Run a live test conversation against a Voiceflow agent and evaluate each response
---

Delegate this task to the `test-runner-agent` subagent.

Pass it the project name/ID and any scenario details from the user's
argument: $ARGUMENTS

The subagent has the debug skill preloaded and all dialog manager,
export, KB, and eval MCP tools. It will:
1. Load project context (config, wiki, agent export)
2. Ask the user what scenario, rules, and turn count to test
3. Run a live conversation (single or batch mode)
4. Evaluate every agent turn as PASS/FAIL/WARN with evidence
5. Check tool calls, not just text responses
6. Produce a test report with pass rate and prioritized fixes

## After the subagent returns

Show the results to the user in chat.

## After presenting findings

If any turns were FAIL, offer:

"X turns failed. Want me to debug the specific failures and propose fixes?"

After presenting fixes, tell the user:

"Once you've applied these changes in Creator, come back and say
'fixed' — I'll run a smoke test to verify."

When the user confirms they've applied the fix:
1. Delete state for a clean session (`delete_state`)
2. Run a 3-5 turn conversation targeting the specific scenario that failed
3. Evaluate whether the fix resolved the issue
4. Report: PASS (fix works) or STILL FAILING (with new diagnosis)
