# copilot-mastra

The Voiceflow build/debug/test/optimize copilot — a faithful port of the
`voiceflow/mcp-plugin` (a Claude Code plugin) into a **Mastra** TypeScript service
running on **GLM 5.2 via Fireworks** (OpenAI-compatible), for a large cost cut vs
Anthropic models. The plugin's prompts, skills, and methodology are reused as
editable data files — not reinvented.

## Architecture

```
orchestrator (supervisor, GLM main)
  └─ agent-<key> delegation tools ─┐
                                   ├─ debug-agent          (main)   structured diagnosis
                                   ├─ build-agent          (main)   + loadPromptingGuide, diffPrompts
                                   ├─ review-agent         (main)   + loadPromptingGuide, diffPrompts
                                   ├─ audit-kb-agent       (triage)
                                   ├─ setup-evals-agent    (triage)
                                   └─ test-runner-agent    (triage)
shared:
  • Voiceflow MCP tools  (MCPClient.listTools → voiceflow_*)  — the agents' toolset
  • Skill Workspace      (all 37 SKILL.md → skill / skill_read / skill_search)
  • GLM models           (createOpenAICompatible → main + triage tiers)
```

- **Model tiers** match the plugin: plugin `opus` → `main`, plugin `sonnet` → `triage`.
  Both currently point at `accounts/fireworks/models/glm-5p2` (env-configurable).
- **Skills** are loaded on demand via Mastra's Workspace (not injected), so the full
  37-skill catalog is available to every agent.
- **Prompts/skills are data**: `agents/*.md`, `skills/*/SKILL.md`, `reference/*.md` —
  edit them without touching code.

## Quickstart

```bash
npm install
cp .env.example .env   # fill in GLM_API_KEY (Fireworks); VF_MCP_TOKEN when available
npm run dev            # Mastra Studio at http://localhost:4111 (next free port if busy)
```

Scripts:
- `npm run dev` — Mastra Studio (chat with the orchestrator or any worker).
- `npm run typecheck` — `tsc --noEmit`.
- `npm run smoke:debug -- <transcript.json> ["reported issue"]` — run the debug-agent
  on a raw Voiceflow transcript JSON (works without the VF token — transcript fed inline).
- `npm run test:parse -- <transcript.json>` — the ported transcript parser.

## Environment

| Var | Purpose |
|---|---|
| `GLM_BASE_URL` | Fireworks OpenAI-compatible base (`https://api.fireworks.ai/inference/v1`) |
| `GLM_API_KEY` | Fireworks key |
| `GLM_MODEL_MAIN` / `GLM_MODEL_TRIAGE` | model ids per tier (both `…/glm-5p2`) |
| `VF_MCP_URL` | `https://mcp.voiceflow.com/mcp` |
| `VF_MCP_TOKEN` | Voiceflow MCP bearer — **pending** (see below) |

## Deploy to Vercel

The app builds into a Vercel **Build Output API** bundle that serves the Mastra
Studio UI + the agents/workflows API from one serverless function:

```bash
npm run build          # → .vercel/output  (Studio SPA + functions/index.func)
```

Serverless adaptations (no effect on local dev): data files (`agents/`, `skills/`,
`reference/`) are embedded at build time (`src/generated/assets.ts`) and materialized
to a temp dir at cold start; the LibSQL store moves to `/tmp`; `GLM_API_KEY` is read
leniently so the Studio UI always loads even if the key is unset.

> **Heads-up — function duration.** Serverless functions cap execution at **60s
> (Hobby) / 300s (Pro)**. Browsing Studio and short single-agent turns are fine;
> the long multi-step workflows (`analyze-transcripts`, `prompt-optimizer` GEPA, the
> orchestrator) can exceed that and time out. Set `VERCEL_FN_MAX_DURATION=300` before
> building on a Pro plan. This is inherent to serverless, not a bug.

**Option A — CLI, prebuilt (deploys the exact tested artifact, key baked in):**

```bash
npm install
# put your Fireworks key in .env  (GLM_API_KEY=fw_…)
npm run build
npm run vercel:env                 # bakes .env into the function bundle
npm i -g vercel && vercel login    # one-time
vercel deploy --prebuilt           # pick scope/project when prompted → returns URL
```

**Option B — Dashboard / Git import (no CLI):** push this branch, then at
`vercel.com/new` import the repo (Framework: *Other*; Build Command `npm run build`
is preconfigured in `vercel.json`), add `GLM_API_KEY` under **Environment Variables**,
and Deploy.

Only `GLM_API_KEY` is required as an env var; `GLM_BASE_URL` / `GLM_MODEL_*` /
`VF_MCP_URL` fall back to the Fireworks/GLM defaults if unset.

## Status

**Ported & working**
- Orchestrator supervisor + 6 synchronous workers (above), runnable in Studio.
- `debug-agent` with `structuredOutput` (rootCauseCategory / problemTurn / evidence / fix
  + summary / confidence / gaps); validated on a real transcript on GLM.
- Skills: all 37 via the Workspace (frontmatter normalized for Mastra).
- `bin/` tools ported: `vf-parse-transcript` (→ `src/lib/vfParseTranscript.ts`, output
  verified identical to the Python original), `vf-load-prompting-guide`, `vf-diff-prompts`.

**Remaining**
- `bin/` (optimizer/eval-specific): `vf-build-rubric`, `vf-judge-model`, `vf-pareto-select`,
  `vf-split-examples`, `vf-build-deploy-plan`, `vf-validate-definition`, `vf-replay-turn` —
  to port alongside the optimizer that uses them. (`build-plugin` is plugin packaging — N/A.)
- Infra-heavy workers (built last, need infra decisions): **analyze-transcripts** (workflow
  fan-out + durable jobs), **prompt-optimizer** (durable GEPA loop + store),
  **memory/"learn"** (Postgres + Qdrant + embeddings).
- `build-agent`'s "spawn evaluator sub-agent" steps aren't wired yet.
- Persistent storage adapter (currently in-memory) — needed for memory/durable workflows.

## Voiceflow MCP token

The VF MCP is **OAuth-only** (interactive browser consent via Claude Desktop or
`claude mcp add … Authenticate`) — there is no static token to paste, and the
authorization-code flow can't complete in a headless/remote service (cf. ENG-953:
Cowork is blocked by host allowlist + can't run the localhost callback). The code is
already wired to consume `VF_MCP_TOKEN` from env via `MCPClient`; the moment a
non-interactive token (service token / client-credentials) is available, it's a
one-line `.env` change + restart to give every agent live VF tools.

## Key implementation notes (verified empirically)

- Pin `@ai-sdk/openai-compatible` to the **v5 line** (`1.0.41`) so `@ai-sdk/provider`
  dedupes with `@mastra/core`'s v5 alias (avoids the dual-`LanguageModelV2` type clash).
- **Bound generation** with `modelSettings.maxOutputTokens` — `maxSteps` only bounds
  tool steps; GLM uncapped reasoned ~22 min on a large prompt.
- **`structuredOutput` needs `jsonPromptInjection: true`** for GLM; GLM still sometimes
  fences the JSON, so `runDebug` falls back to fence-tolerant extraction (still Zod-validated).
- Prompt files resolve from a discovered **project root** (not cwd) so loading works under
  both `tsx` and the bundled `mastra dev`.
