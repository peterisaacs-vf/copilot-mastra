# What's in this repo → what you'd build on the Vercel AI SDK

A map of the Mastra copilot to a Vercel-AI-SDK build: for each piece — what it is, where
it lives here, the Mastra docs that explain it, the Vercel-AI-SDK equivalent, and whether
there's open-source code to lift.

**This is a reference, not a prescription.** The repo is a working example of the
primitives this copilot needs — build them whatever way fits the Vercel SDK best. Mastra
is **Apache-2.0**, so its implementations are fair to read and port.

**Model:** GLM 5.2 = Fireworks (OpenAI-compatible). On the Vercel AI SDK that's native via
`@ai-sdk/fireworks` or `@ai-sdk/openai-compatible` — no proxy/shim.

---

## Load-bearing — build these first

### Skills (progressive disclosure)
- **What:** a `skills/` dir of `SKILL.md` files (frontmatter `name`/`description` + body,
  optional `references/`). The agent sees only the name+description list; it calls a tool
  to load a skill's full body on demand. Base prompt stays small; deep methodology loads
  just-in-time. The build-agent pulls several per task.
- **Here:** `skills/` (37 skills) wired in `src/mastra/workspace.ts`.
- **Mastra docs:** https://mastra.ai/docs/workspace/skills (the `skill` / `skill_read` /
  `skill_search` tools, bm25 search, progressive disclosure).
- **On Vercel:** no native skills. Build the load-skill tool: discover the dir → inject the
  name+description list into the system prompt → a `skill({ name })` tool returns the body.
  Optional `skill_search` (bm25/embeddings) for the big catalog.
- **Lift:** Mastra's loader is Apache-2.0 (`@mastra/core/workspace`) — read it as a
  blueprint. SKILL.md is a standard spec, so **the 37 skill files port unchanged.**

### Voiceflow MCP toolset
- **What:** the Voiceflow tools (transcripts, prompts, KB, evals, test conversations,
  analytics) the agent calls.
- **Here:** `src/mastra/mcp.ts` (client) + `src/mastra/oauth.ts`/`oauthStore.ts` (auth + the
  COR-12557 env-id resolver).
- **Mastra docs:** https://mastra.ai/docs/mcp/overview
- **On Vercel:** native MCP via `createMCPClient` (AI SDK v6, stable — stdio/SSE/HTTP +
  OAuth). MCP tools auto-convert to SDK tools.
- **Lift:** auth is changing (sending the user token, skipping the OAuth flow), so the
  custom-fetch may be moot — but the **env-id resolver in `oauth.ts` is the bit worth
  porting** (draft-version-id vs env-id; COR-12557). Framework-agnostic logic.

### Memory (the "it remembers across sessions" magic)
- **What:** four layers — recency window; durable **working memory** (resource-scoped
  scratchpad that survives across sessions and the sub-agent set); **semantic recall**
  (pgvector similarity over all past history); **observational memory** (background
  compaction).
- **Here:** `src/mastra/memory.ts`.
- **Mastra docs:** https://mastra.ai/docs/memory/overview ·
  https://mastra.ai/docs/memory/working-memory ·
  https://mastra.ai/docs/memory/semantic-recall ·
  https://mastra.ai/docs/memory/observational-memory
- **On Vercel:** all DIY — the SDK is stateless (you pass messages each call). You own
  persistence + a vector store + retrieval.
- **Lift:** not the code (tied to `@mastra/memory`), but the **design ports directly** —
  `memory.ts` is essentially the spec: lastMessages window + a working-memory template +
  pgvector recall (topK 5, resource-scoped) + a token-budget trim.

### Token budgeting / compaction
- **What:** a token ceiling on the assembled context, enforced every step (keeps a
  contiguous recent suffix, preserves system messages). Our stand-in for Claude-style
  compaction.
- **Here:** `makeContextProcessors` in `src/mastra/memory.ts` (`TokenLimiterProcessor`, 96K).
- **On Vercel:** DIY — count tokens and trim before each call (middleware around
  `streamText` / the Agent loop).

---

## Ports cleanly — your code / prompts

### Prompts (the real IP)
- **Here:** 8 agent prompts in `agents/*.md` + the `reference/*` prompting guides.
- **On Vercel:** drop-in — framework-agnostic markdown; the file body is the system prompt.

### Custom tools
- **Here:** `src/tools/` — `updatePlan` (live checklist), `grepTranscripts` (full-text
  transcript search), `diffPrompts`, `promptingGuide`.
- **Mastra docs:** https://mastra.ai/reference/tools/create-tool
- **On Vercel:** `tool({ description, parameters: z.object(...), execute })`. **Same Zod +
  async logic — near-verbatim port;** only the return shape changes to tool-result blocks.

### Transcript parsing + grep
- **Here:** `src/lib/vfParseTranscript.ts` + `src/tools/grepTranscripts.ts` — pull
  transcripts, scan dialogue, return only the hits (raw transcripts stay out of context, so
  it scales).
- **On Vercel:** ports as-is (plain TS). Key scalable primitive for transcript analysis —
  build it early.

---

## Need a plan — lower priority

### Multi-agent orchestration
- **Here:** an orchestrator delegating to workers — `agents/orchestrator.md`,
  `src/mastra/workers.ts` (Mastra agents-map supervisor).
- **On Vercel:** the `Agent` abstraction + agent-as-tool — **or** collapse to one agent +
  skills (your thread's direction) and skip multi-agent routing entirely (simpler, fewer
  model hops). Worth a deliberate call.
- **Mastra docs:** https://mastra.ai/docs/agents/overview

### Evals / scorers
- **Here:** LLM-judge skill-routing scorers + datasets — `src/mastra/scorers/*`,
  `routingDataset.ts`.
- **Mastra docs:** https://mastra.ai/docs/evals/overview
- **On Vercel:** no built-in evals — Promptfoo / Langfuse / Braintrust. The **judge prompts
  + datasets port;** the harness is what you swap.

### Observability
- **On Vercel:** the SDK has built-in OpenTelemetry → first-class Langfuse integration.
  (Mastra gave logging/tracing out of the box; here it's one integration to wire.)

### Workflows (deterministic pipelines)
- **Here:** `src/mastra/workflows/` — analyze-transcripts (incomplete) + prompt-optimizer.
- **Mastra docs:** https://mastra.ai/docs/workflows/overview
- **On Vercel:** no workflow engine — compose with plain code or the agent loop. Most of
  this can be skills/tools instead.

### Streaming surface + stream slimmer
- **Here:** the `/demo` SSE widget (`src/mastra/demoPage.ts`) + an output `streamSlimmer`
  (drops bloated wrapped sub-agent lifecycle chunks).
- **On Vercel:** assistant-ui / AI SDK UI; the event schema differs, so the parser is
  rebuilt. The slimmer only matters if you forward sub-agent streams (less relevant if you
  go single-agent + skills). UX target carries: one timeline, a live "working…" pulse, live
  markdown, a plan checklist.

### Deployment / Studio
- **Deployment:** here it's `@mastra/deployer-vercel`; per the plan the Vercel-SDK copilot
  is a module in the realtime service, shipped with that code — no standalone deployer.
- **Studio:** `@mastra/editor` (agent/prompt/skill editor) has no Vercel equivalent. If a
  management UI is wanted later: Agenta/Langfuse (prompts + evals) or a small custom editor
  over the files.

---

## Bottom line
The genuinely framework-specific work on the Vercel SDK is **skills + memory
(working/semantic/compaction)**. Everything else either ports (prompts, tools, transcript
parsing, the MCP env-id logic) or is a known integration (evals, observability). Mastra
being Apache-2.0 means the skills loader and memory strategy are there to read and port,
not reinvent.
