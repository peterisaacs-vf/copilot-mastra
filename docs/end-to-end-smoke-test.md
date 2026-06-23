# copilot-mastra — End-to-End Smoke Test (next-session runbook)

**Goal:** in one pass, validate **deploy → storage/memory → MCP → swarm delegation →
the build/debug/test loop** against a live Voiceflow project.

This file is the source of truth for the validation session (the container is ephemeral,
so chat notes don't survive — this does). Work top to bottom; each check has an expected
result and a "if it breaks" note.

---

## 0. What I need from Peter (paste at the start of the session)

1. **`VF_MCP_TOKEN`** — the Voiceflow MCP token. This is the headline blocker: it wires the
   deployed app to the live Voiceflow MCP (transcripts / KB / evals / test conversations).
   Treat as a secret — never committed; set as a Vercel **project env var** (persists) and/or
   passed via `-e` on deploy. Confirm which workspace/projects the token can access.
2. **Vercel deploy token** — needed to run `vercel deploy`; the previous one lived in
   `scratchpad/.vctoken`, which is gone (fresh container). Re-share it (I'll re-write it to
   scratchpad, treat as secret, never commit). *Fallback:* the `mcp__Vercel__deploy_to_vercel`
   MCP tool, but the proven path is the prebuilt CLI flow below — prefer the token.
3. **A safe test target** (see §3) — pick ONE:
   - a **sandbox** project for the write parts of the loop (build/edit), e.g. in
     *"My workspace"* or *"VF Internal Testing"*, or let me create a throwaway one; **and/or**
   - a richer agent for **read-only** parts (debug a transcript, review architecture, audit KB).
   - ⚠️ **Do NOT point the write loop at a customer/production agent** (Turo, Gusto, SSENSE,
     Stubhub, Fabletics, etc.). Reads are fine with your OK; writes go to a sandbox only.
4. **Confirm `GLM_API_KEY` is still set** on the Vercel project (it should persist from last
   time). `DATABASE_URL` comes from the Neon–Vercel integration and persists automatically.

---

## 1. Deploy

```bash
cd copilot-mastra
# token in scratchpad/.vctoken (chmod 600); never commit
rm -rf .vercel .mastra
VERCEL_FN_MAX_DURATION=300 npm run build      # regenerates assets + bundles + patches Studio routes

vercel deploy --prebuilt --prod --archive=tgz \
  --scope voiceflow \
  --token "$(cat scratchpad/.vctoken)" \
  -e GLM_API_KEY="$GLM_API_KEY" \
  -e VF_MCP_TOKEN="$VF_MCP_TOKEN" \
  -e MASTRA_TELEMETRY_DISABLED=1 \
  --yes
```

- Project `prj_6WFgHhyNZbUdpkKCoGG03v3cXi6y` · team `team_G2sd8DfFaRIcrg5YOWcPvsvD` · alias `copilot-mastra.vercel.app`
- Better: set `VF_MCP_TOKEN` once via `vercel env add VF_MCP_TOKEN production` so it persists and the `-e` flag isn't needed every deploy.

---

## 2. Smoke checks (in order)

```
BASE=https://copilot-mastra.vercel.app
```

- [ ] **A. Studio loads** — open `$BASE/` → Mastra Studio UI renders, agents listed
      (orchestrator + build/review/debug/audit-kb/setup-evals/test-runner).

- [ ] **B. Storage + memory** — `curl $BASE/_diag/storage` →
      ```json
      {"mode":"postgres","host":"ep-...neon.tech","memory":true,"lastMessages":100,
       "workingMemory":true,"semanticRecall":true,"tokenBudget":96000,
       "observationalMemory":"thread"}
      ```
      *If `mode` ≠ `postgres` or `memory:false`* → read `code`/`error` in the JSON; Postgres
      init failed and we fell back to LibSQL (check `DATABASE_URL`/Neon integration).

- [ ] **C. MCP wired** — `curl $BASE/_diag/mcp` → `{"tokenPresent":true,"tools":<N>,"names":[...]}`
      with **N > 0** (expect ~20 `voiceflow_*` tools + `query_analytics`).
      *If `tokenPresent:false`* → `VF_MCP_TOKEN` not set on the deployment.
      *If `tools:0` + `error`* → token rejected / MCP unreachable; read `error`.

- [ ] **D. Working memory across threads** (resource-scoped continuity) — in Studio, as the
      orchestrator with a fixed `resourceId`: thread A → "Remember: the project is **PizzaBot**
      and we're debugging the **checkout flow**." New thread B (same resourceId) → "What project
      and flow are we on?" → must answer **PizzaBot / checkout**.

- [ ] **E. Semantic recall** — same resource, new thread, ask about a *specific* earlier detail
      not in working memory → it should pull the relevant past message back.

- [ ] **F. ⚠️ Swarm delegation WITH OM on** *(the main risk introduced this session)* — give the
      orchestrator a request that forces delegation, e.g. *"Audit my agent's architecture and KB"*
      (→ review-agent / audit-kb-agent). **Watch for:** a thrown
      `Thread ID is required` / threadId error from Observational Memory on the sub-agent call.
      - **Pass:** delegation completes, worker returns, no threadId throw.
      - **Fail:** set `OM_DISABLED=1` (Vercel env) + redeploy → confirms OM is the cause, then
        I'll fix thread propagation to sub-agents (pass parent thread/resource into the
        `agent-<key>` tool call) and re-enable.

- [ ] **G. OM compaction fires** — drive a long conversation (or feed a big transcript) until raw
      history crosses ~30k tokens. In Studio's **Memory** tab the Observer token bar should fill
      and observations appear; context stays bounded instead of growing unbounded. Confirms the
      Observer/Reflector loop runs on DeepSeek in the background.

---

## 3. End-to-end loop (real Voiceflow project)

Run the platform loop end-to-end through the **deployed copilot** (not the harness MCP):
`Define → Build → Test → Read transcripts → Evaluate → Fix → Publish`.

Suggested first pass against the chosen target:
1. **Orient (read-only):** "List my projects / open `<project>`." → confirms MCP auth + project access.
2. **Review (read-only):** "Review this agent's architecture and KB; give prioritized fixes." → exercises review-agent + audit-kb-agent + skill loading.
3. **Debug (read-only):** feed a transcript URL → debug-agent returns the structured root-cause/fix.
4. **Build (sandbox only):** apply ONE small fix (e.g. tighten a playbook prompt) in a **non-Main**
   environment → exercises build-agent writes + the confirm-before-write rule.
5. **Test:** run a test conversation against the change → test-runner-agent.
6. **Measure:** create/run an eval or pull analytics → setup-evals-agent / `query_analytics`.

Throughout, watch the GLM (main) vs DeepSeek (triage) split behaves and that memory persists
across the steps.

---

## Eval → Studio (Datasets / Experiments)

Goal: routing-eval history shows up in **Studio → Datasets → Experiments** instead of only in
script stdout (closes the "eval runs aren't in Studio" gap). Built on Mastra's Datasets +
Experiments + the `skill-routing` scorer.

**Already wired (live now):** dataset **`skill-routing-golden`** (29 items) exists in the
deployed Studio's **Datasets** tab. Source of truth = `src/mastra/scorers/routingDataset.ts`.

**Two scripts:**
- `src/scripts/wireRoutingExperiment.ts` — REST, **needs no local secrets**. Find-or-creates
  the dataset on a deployed app and syncs items (idempotent). Run:
  `npx tsx src/scripts/wireRoutingExperiment.ts [--url https://copilot-mastra.vercel.app]`
- `src/scripts/runRoutingExperiment.ts` — the **executor** (SDK). Runs the experiment and
  persists to whatever storage *the process* uses:
  - **Lands in deployed Studio:** `DATABASE_URL='<neon-url>' GLM_API_KEY='<valid>' npx tsx src/scripts/runRoutingExperiment.ts`
  - **Dry run (local libsql, won't reach Studio):** `GLM_API_KEY='<valid>' npx tsx src/scripts/runRoutingExperiment.ts`

**To fire it (lands in deployed Studio):**
1. Get the **Neon URL** (Vercel project env `DATABASE_URL`, or the Neon dashboard).
2. `DATABASE_URL='<neon>' GLM_API_KEY='<valid-fireworks-key>' npx tsx src/scripts/runRoutingExperiment.ts`
3. Open `$BASE/` → **Datasets → skill-routing-golden → Experiments**.

**Three findings that shaped this (so we don't re-learn them):**
1. **`mastra api experiment run` does NOT work against the Vercel deploy.** The runner starts
   the experiment in a background task *after* sending its HTTP response, and Vercel freezes
   the function once the response is sent — so the run never executes (it lands as `failed`
   with `startedAt: null`). Dataset create + item sync over REST/CLI *do* work. Experiment
   **execution** needs a persistent process: the executor script, or a non-serverless Mastra
   server pointed at Neon. (This is the real reason the executor runs locally/elsewhere.)
2. **Thread-scoped Observational Memory needs a threadId per call**, and the REST experiment
   runner (`targetType:'agent'`) doesn't inject one per item. The executor sidesteps this by
   running with **memory off** (`MEMORY_DISABLED=1`, set automatically) — routing doesn't use
   memory, so behavior is unaffected.
3. **Mastra storage bug:** a dataset's `scorerIds` is stored/returned as a JSON *string*, and
   `runExperiment` does `[...datasetScorerIds]`, spreading it into characters →
   `Scorer with id [ not found`. **Workaround:** don't set `scorerIds` on the dataset record;
   pass the scorer in the experiment-run body / `startExperiment({ scorers })`. (The prod
   dataset's `scorerIds` was already PATCHed to `null`.)

> ⚠️ The executor runs the orchestrator **locally**, so it needs a valid `GLM_API_KEY` in the
> local env. The `.env` key was **stale (401)** this session — set a working Fireworks key
> before running. (`DATABASE_URL` only needs to point at Neon to land results in Studio.)

---

## OAuth flow (when staging is ready)

The bearer token works today; OAuth (auth-code + refresh) is built and deployed but
**off by default** (`VF_AUTH_MODE` unset → `token`). Server discovery is confirmed:
`auth-api.voiceflow.com`, scopes `universal.workspace.read/.write`, public client + PKCE,
DCR + discovery enabled. Our callback is live at `https://copilot-mastra.vercel.app/oauth/callback`.

To test against Ben's staging:
1. Get the **staging MCP server URL** from Ben (discovery resolves the staging auth server from it).
2. Redeploy with `-e VF_AUTH_MODE=oauth -e VF_MCP_URL=<staging-mcp-url>` (callback stays the prod URL Ben allow-listed).
3. In a browser, visit `https://copilot-mastra.vercel.app/oauth/start` → it redirects to Voiceflow → **consent once** → back to `/oauth/callback` (success page). Tokens persist in Postgres (`oauth_kv` table).
4. `curl /oauth/status` → `{"mode":"oauth","hasTokens":true}`.
5. Force a cold start (redeploy or wait) so agents pick up the tools → `curl /_diag/mcp` → `tools > 0`.
6. Revert to `token` mode (or prod `VF_MCP_URL`) when done.

Notes: tokens auto-refresh after the one-time consent (no re-consent). `OAuth start failed`
on `/oauth/start` usually means discovery/DCR rejected our `redirect_uri` — ping Ben to confirm
it's allow-listed on the env you pointed `VF_MCP_URL` at.

## Kill switches / rollback

| Symptom | Lever |
|---|---|
| OM throws / delegation breaks | `OM_DISABLED=1` (Vercel env) + redeploy |
| Context too tight / too loose | `MEMORY_TOKEN_BUDGET=<n>` (default 96000) |
| MCP flaky | unset `VF_MCP_TOKEN` → app still boots, agents run without VF tools |
| Bad deploy | `vercel rollback` to the previous prod deployment |

## Reference

- **Diag:** `GET /_diag/storage`, `GET /_diag/mcp`
- **Env vars:** `GLM_API_KEY`, `VF_MCP_TOKEN`, `DATABASE_URL` (Neon, auto), `MEMORY_TOKEN_BUDGET` (opt), `OM_DISABLED` (opt), `VERCEL_FN_MAX_DURATION` (build)
- **Models:** main `accounts/fireworks/models/glm-5p2` · triage `accounts/fireworks/models/deepseek-v4-flash` (also runs OM Observer/Reflector) · embeddings `nomic-ai/nomic-embed-text-v1.5`
- **Memory stack:** lastMessages(100) + resource-scoped working memory + resource-scoped semantic recall + token-budget backstop(96k) + thread-scoped Observational Memory (compaction)
- **Branch:** `claude/lucid-shannon-nf4olw`
