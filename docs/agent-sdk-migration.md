# Voiceflow Copilot → Claude Agent SDK migration

Handoff doc. Captures the plan + everything learned building the Mastra version, so the
Agent SDK build (in a **separate repo**) starts with full context instead of cold.

## Status & ground rules

- **Goal:** re-platform the Voiceflow Copilot from **Mastra** → the **Claude Agent SDK**
  (https://code.claude.com/docs/en/agent-sdk/overview). **GLM stays as the model.**
- **New repo:** `peterisaacs-vf/Voiceflow-co-pilot-agent-sdk` (the SDK build lives here).
- **DON'T lose the Mastra version.** It's the source of truth + the fallback: this repo
  (`peterisaacs-vf/copilot-mastra`), branch `claude/lucid-shannon-nf4olw`, deployed at
  `https://copilot-mastra.vercel.app` (widget at `/demo`, password `vf-copilot-0vl2e2mh9o`).
  All work is committed + pushed. The migration is **additive** — nothing here gets deleted.
- **Start the new session with BOTH repos selected** (Claude Code web repo picker — repo
  access is account-level, no CLI; you can't add a repo mid-session, so pick both up front).
  That lets the SDK build reference this code while writing into the new repo.

## What the Mastra app is (the things to port)

- **Agents:** an orchestrator (supervisor) that delegates to workers — `build-agent`,
  `review-agent`, `audit-kb-agent`, `setup-evals-agent`, `test-runner-agent`,
  `analyze-transcripts-agent` — plus a structured-output `debug-agent`. Prompts live in
  `agents/*.md`; methodology in `skills/*` (loaded on demand). **This is the real IP and
  it's framework-agnostic markdown — it ports directly.**
- **Tools:** the Voiceflow MCP (21 tools, OAuth) + custom tools: `update_plan` (live
  checklist), `grep_transcripts` (transcript full-text search), `diffPrompts`,
  `loadPromptingGuide`. Tool *logic* ports; only the tool-definition format changes.
- **Memory:** Neon Postgres — conversation window + working memory + semantic recall
  (pgvector) + observational memory + context/token budgeting (input processors) + a
  stream slimmer (output processor).
- **Surface:** a custom `/demo` SSE widget + Vercel prebuilt deploy + `/_diag/*` + `/oauth/*`.

## Carries over vs. rebuilt on the Agent SDK

- **Carries cleanly:** all prompts (`agents/*.md`) + skills; the Voiceflow MCP integration
  (both speak MCP) incl. the OAuth custom-fetch and the COR-12557 env-id workaround; custom
  tool *logic*; transcript parsing; the debug methodology; the comms style.
- **Reworked (SDK-specific):** agent + handoff wiring (Mastra `Agent`/agents-map → SDK
  agents/subagents/handoffs); the **streaming event schema** (→ rewrite the `/demo` widget's
  parser — this is the biggest UI item); memory layer; deployment.
- **Given up / rebuild:** Mastra Studio (editor UI), the memory processors (observational
  memory, token budgeting, the slimmer), the Vercel deployer convenience.

## Memory feature mapping (verified against Agent SDK docs)

| Mastra feature | On the Agent SDK | How |
|---|---|---|
| Conversation window | Native | Sessions + `resume` keep history |
| Working memory | Native-ish | `CLAUDE.md`/files for static; per-user runtime state = a custom tool over our DB |
| Semantic recall | DIY | Custom (in-process MCP) tool querying our pgvector — keep the vector store, wrap it as a tool |
| Observational memory | DIY | A `PostToolUse` / `SessionEnd` **hook** that extracts + stores facts (no agent tool-call) |
| Token/context budgeting | Gap | SDK leans on auto-compaction (Claude/Managed-Agents-oriented). On GLM, build budgeting ourselves (hook: count tokens + trim) |

Caveat: Anthropic-native **prompt caching** and **compaction** likely don't apply on GLM —
exactly the features that make context management cheap — so more of that falls to us.

## Model route (the critical bit)

- **GLM today = Fireworks**, OpenAI-compatible: `https://api.fireworks.ai/inference/v1`,
  model `accounts/fireworks/models/glm-5p2`. Triage tier `deepseek-v4-flash`; eval-judge
  `kimi-k2p6` (see `src/config/env.ts`).
- **The Agent SDK speaks the Anthropic API format only.** So GLM must sit behind an
  **Anthropic-format proxy**: **LiteLLM** (Anthropic in → Fireworks/GLM out), then set
  `ANTHROPIC_BASE_URL` to the LiteLLM endpoint. LiteLLM has a documented Agent-SDK path and
  supports Fireworks. (Anthropic's own OpenAI-compat layer is explicitly *not* production-ready.)
- Verify which SDK features survive on GLM: prompt caching (no), compaction (no), memory
  tool (test), tool streaming (test), computer use / extended thinking (Anthropic-only, N/A).

## POC — verify these two before committing to the full migration

1. **GLM drives the Agent SDK cleanly through LiteLLM** — a basic query + a tool call +
   streaming, end to end (SDK → `ANTHROPIC_BASE_URL` → LiteLLM → Fireworks/GLM).
2. **A DIY memory feature works** — one custom recall tool over a vector store, surfaced
   into context, across a resumed session.

If both hold, the rest is mechanical.

## Env / secrets the new build needs

- `GLM_API_KEY` (Fireworks key — secret, NOT in the repo), `GLM_BASE_URL` (defaults to
  Fireworks), `GLM_MODEL_MAIN/TRIAGE/JUDGE` (see `src/config/env.ts`).
- Voiceflow MCP: `VF_MCP_URL` (`https://mcp.voiceflow.com/mcp`), and OAuth
  (`VF_AUTH_MODE=oauth` + the one-time `/oauth/start` consent) or a static `VF_MCP_TOKEN`.
- LiteLLM config pointing at Fireworks/GLM, exposed in Anthropic format.

## Hard-won gotchas (don't relearn these)

- **COR-12557 (env-id):** draft-editing MCP tools (`global_prompt`, `agent_instructions`,
  `routing`, `playbook`, `function`, `variable`, `environment.compile`) need the project's
  **`draftVersionID`**, NOT the environment `id`. v1.3 projects: `environments[Main].draftVersionID`.
  KB/document ops + clone/publish/merge use the env `id`. `test_conversation` runtime wants the
  draftVersionID as its `environment` param. Auto-resolver: `src/mastra/oauth.ts` — port the logic.
- **Streaming timeouts:** buffered `/generate` dies at a ~180s gateway timeout; the SSE
  **`/stream`** path stays alive to `maxDuration` (600s). Always stream long work.
- **Sub-agent stream bloat (Mastra-specific):** delegated sub-agent work was forwarded
  wrapped in `tool-output`; the `step-start`/`step-finish`/`finish` lifecycle chunks were ~85%
  of bytes (a 57MB medium build → ~8MB after an output-processor slimmer). On mobile that
  volume dropped connections. On the SDK, check the equivalent streaming shape early.
- **GLM behavior:** heavy/verbose reasoning, looser instruction-following than Claude; it
  honors concrete WRONG/RIGHT examples in prompts. (The Voiceflow runtime model is the *same*
  GLM, so well-scoped prompts produce clean output.)
- **Cold model cache:** first call after idle ~30s (the ~54k-token system prompt reprocesses
  uncached); a keep-warm cron helped the instance/DB but not the model cache.
- **`/demo` widget design** (worth reproducing): ONE ordered timeline (message → reasoning →
  tool → message); a live "working…" pulse during gaps so it never looks frozen; live markdown
  rendering; a `update_plan` checklist; unwrap delegated sub-agent events inline; a message
  queue. A new SDK = a new event schema = rewrite the parser, but the UX target stands.
- **Comms style** (in `COMMS_STYLE`, `src/mastra/workers.ts` — port it): act on a clear brief,
  recommend don't survey, never print raw IDs/tool mechanics in user-facing messages, confirm
  only for irreversible/outward actions (publish, merge to Main, delete).
- **analyze-transcripts:** there's a Mastra *workflow* (`src/mastra/workflows/analyzeTranscripts.ts`,
  parallel triage→deep-read→synthesize) but it's **incomplete — no live fetch** (throws without
  inline transcripts). The working chat path is the sequential `analyze-transcripts-agent` +
  `grep_transcripts`. For the SDK, `grep_transcripts` (content search, hits-only, content kept
  out of context) is the key scalable primitive — build it first.

## Suggested first steps in the new repo

1. Minimal Agent SDK app (TypeScript, to reuse our tool + parsing logic) → LiteLLM(Fireworks/GLM)
   → one query. Prove GLM drives the SDK.
2. Wire the Voiceflow MCP (port the OAuth flow + the env-id workaround from `oauth.ts`).
3. Add `grep_transcripts` as an in-process MCP tool + a resumed session + one recall tool. Prove memory.
4. Then port the prompts/skills and re-express the orchestrator/worker structure in the SDK's
   agent/handoff model; rebuild the `/demo` widget parser against the SDK's event schema.
