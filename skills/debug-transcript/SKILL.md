---
name: debug-transcript
description: Analyze a Voiceflow transcript and identify issues
---

Delegate this task to the `debug-agent` subagent using the Agent tool.

Pass the following as the agent prompt:

"Debug this Voiceflow transcript: $ARGUMENTS

Follow your methodology exactly. Step 2 is mandatory before any other
analysis: first EXTRACT all hardcoded values from prompt.system as a
plain list (no interpretation), then COMPARE each against the reported
issue. If the prompt contains the wrong value, that is the root cause —
stop there. Do not investigate KB or hallucination."

Return the agent's full findings to the user.

## After presenting findings

If the debug-agent proposed fixes, offer the user:

"Once you've applied these changes in Creator, come back and say
'fixed' — I'll run a smoke test to verify the fix works."

When the user confirms they've applied the fix:
1. Delete state for a clean session (`delete_state`)
2. Run a 3-5 turn conversation targeting the specific scenario that failed
3. Evaluate whether the fix resolved the issue
4. Report: PASS (fix works) or STILL FAILING (with new diagnosis)
