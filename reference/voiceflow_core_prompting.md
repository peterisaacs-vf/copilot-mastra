---
last_updated: 2026-05-04
source: Voiceflow internal — curated guidance for the bundled CORE foundation model
models_covered: voiceflow-core, voiceflow-core-4.0
---

# Voiceflow CORE Prompting Guidelines

Voiceflow CORE is Voiceflow's bundled foundation model — the default
runtime for new agents on the platform. It's optimized for
long-horizon agentic tasks, structured tool use, and large-context
reasoning. **Prompting style is closer to a structured engineering
brief than to a Claude conversation.**

## Structure (recommended order)
1. Role definition (1 sentence)
2. Task specification with explicit success criteria
3. Context (only task-relevant)
4. Constraints (what NOT to do, what NOT to modify)
5. Output format / contract
6. Examples (2-4 max, edge cases preferred)

## Delimiters
- Markdown headers (H1-H3) as primary section boundaries
- JSON-style schemas for output contracts (more reliable than free-text "respond as ...")
- Markdown is idiomatic on CORE — Claude-style `<instructions>` / `<context>` XML tags work but aren't the native shape
- For long-context inputs, label document sections clearly and separate "use this evidence" from "follow these instructions"

## System vs User Prompt
- System: role + persistent constraints + output format
- User: specific task + supporting context
- Don't dump all task logic in system prompt
- For tool-heavy agents: enumerate tools by name **and the conditions under which each should be called**, not just what they do

## Examples / Few-shot
- **2-4 examples maximum.** CORE treats examples as hard signal — mismatched examples actively degrade performance
- Edge cases and failure modes carry more signal than obvious successes
- Definition + 2-3 matched examples beats zero-shot for nuanced classification; mismatched examples can underperform zero-shot, so prefer fewer-and-tighter over more-and-noisier
- Always pair examples with a definition / rubric — examples alone leave too much to interpretation

## Tool / Function Calling
- CORE supports OpenAI-compatible function-calling JSON schemas
- The internal tool-call format is implementation-detail; treat it as opaque from the prompt-engineering side
- Streaming tool calls are supported
- For large tool suites, most tools shouldn't be loaded into the system prompt per turn — load on-demand via the agent harness's tool-loading hooks

## Sampling
- A thinking-mode toggle is available — tradeoff is reasoning quality vs latency / token cost
- For high-volume routing / classification: disable thinking, lower temperature
- For response generation: enable thinking, moderate temperature
- Calibrate specific values against evals — defaults vary by task

## What Works
- Discrete labeled sections > prose paragraphs
- Hard rules as numbered lists; explicit structure is the primary lever — rationale is optional, not the load-bearing mechanism
- Explicit output schemas (JSON contract, strict format spec)
- Edge-case examples > obvious-case examples
- For routing/classification: definitions + 2-3 boundary cases beats narrative heuristics
- For long-running agents: persistent role + tool-use rules + completion criteria

## What Doesn't Work
- Vague guidance ("respond helpfully", "use good judgment") — CORE's strength is structure; soft guidance underperforms
- Rationale-only prompting — Claude's "explain WHY behind constraints" idiom doesn't give the same lift here. Rationale is fine to include, but pair it with explicit rules; don't rely on the model inferring rules from rationale
- Inspirational wording ("you are an expert at X") without concrete role/task scoping
- Over-exemplifying (5+ few-shot) when examples don't all match the task
- Context dumping — separate "use this evidence" from "do this"

## Core Principle
Treat Voiceflow CORE as a structured-engineering model, not a chatbot. Prompts that work on Claude via rationale-driven prose translate but underperform — convert prose to numbered constraints + explicit schemas + matched examples for best results.
