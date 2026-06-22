# Runtime validation (Step 5b)

Loaded on demand from this skill via `skill_read`.

## Step 5b: Test the candidate prompt against the deployed runtime

Reflection (Step 5) produced a candidate prompt. Before scoring,
present, or deploy — run it through the **actual Voiceflow runtime**
to see what the agent would produce with this prompt. Real tool
execution, real KB retrieval, 1:1 with production behavior.

For each turn in the validation set:

1. **Extract the user input** — use `vf-replay-turn --turn N` on
   the parsed transcript to get the user message + conversation
   history + ground-truth response.

2. **Push the candidate as a draft** — call `voiceflow_playbook`
   `update` on the target playbook with the candidate prompt as the
   new `instructions`. Voiceflow stores this on the development
   environment.

3. **Compile the project** — call `voiceflow_project`
   `compile_version` on the development environment. **Note**:
   compilation may need to be triggered by the user pressing the
   "Run" / "Test" button in the Creator UI if the programmatic
   compile doesn't pick up the change. Tell the user clearly when
   they need to click — don't try to test against a stale compile.

4. **Run the failing input live** — call `voiceflow_test_conversation`
   `interact` with the user message. The runtime executes any
   tools the candidate decides to call (KB search, function calls)
   and returns the agent's actual response.

5. **Capture** the new response, any tool calls made, latency.

You now have, per turn:
- The original assistant response (ground truth from the transcript)
- The new response produced by the candidate prompt running through
  the live agent — with all tools and KB available

Re-score using the same judges from Step 4. The judge sees the new
response, the rubric, and (optionally) the ground truth for
comparison.

**Decision rule**: only proceed to Step 6 (Present) if the candidate
beats baseline on the validation set. If it doesn't, iterate — back
to Step 5 with the new failure analysis (which may include the
candidate's own failures). If the candidate regresses on previously-
passing turns, roll back the playbook to the original instructions
before iterating.

### Why this path (vs. running the model directly)

Tool-using turns make up most real production traffic. Running the
candidate prompt directly through the model (via any external API)
doesn't execute the tools — the model emits a `<tool_call>` text and
we can't compare downstream prose quality. Running through the
Voiceflow runtime is the only way to get a faithful candidate-vs-
baseline comparison.

The trade-off: each test cycle requires push → compile → run, which
is slower than calling a model directly. For a one-off optimization
on a customer project, that's fine. For automated continuous
optimization, the manual compile step is the rough edge — Sims (when
it ships) is the long-term automation path.

### Cost / time per validation turn

Each turn = one playbook push + one compile + one runtime call +
one judge call. Mostly pennies in Voiceflow runtime credits + judge
tokens. The bottleneck is wall-clock time, not cost — compile alone
can take 30s+ on larger projects.

For a 10-turn validation set in single-pass mode that's ~10 runtime
calls + 10 judge calls. For GEPA mode with 3 candidates × 3 rounds,
~90 runtime calls + ~90 judge calls — but with 3 candidates per
round you can fan out the runtime calls in parallel (different test
inputs can share the same compiled candidate).
