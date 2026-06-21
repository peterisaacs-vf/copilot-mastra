---
last_updated: 2026-04-16
source: https://platform.openai.com/docs/guides/prompt-engineering
models_covered: gpt-5.4, gpt-5.1, gpt-5, gpt-4.1, gpt-4o
---

# OpenAI GPT Prompting Guidelines (Official)

## Structure (recommended order)
1. Role and Objective
2. Instructions / Behavioral rules
3. Reasoning steps (if needed)
4. Output format / contract
5. Examples
6. Context / documents

## Delimiters
- Markdown headers (H1-H4) as primary delimiter
- XML tags for document-heavy inputs
- JSON for structured data

## System vs User Prompt
- System: persistent identity, guardrails, tone defaults
- User: task-specific instructions, examples, context
- Don't put all task logic in system prompt — it bloats
- Newer instructions override older conflicting ones

## Model-Specific

### GPT-4.1
- Follows instructions more literally than predecessors
- Must be explicit — inferred intent doesn't work
- Use conditional logic ("if X, do Y") not absolute rules

### GPT-5 / 5.1 / 5.4
- Highly steerable
- Contradictions are MORE damaging — burns reasoning tokens reconciling
- GPT-5.1 can be excessively concise — emphasize completeness explicitly

## What Works
- Clarity over length — short specific > long vague
- Concrete examples, especially for edge cases
- Explicit completion criteria
- Numbered sequences for complex workflows
- Hard constraints ("≤150 words", "MUST call X") > soft guidance ("be concise")
- For agents: persistence + tool-calling + planning reminders (~20% improvement)

## What Doesn't Work
- Absolute mandates without escape hatches
- ALL CAPS / bribe language
- Task logic entirely in system prompt
- Generic "be concise" without context
- Preemptive rules that don't fix measured failures

## Long Context
- Key instructions at both beginning AND end
- Specify: rely on provided context only, or internal knowledge too?
- XML outperforms JSON for document-heavy inputs

## Core Principle
Start with minimum prompt that passes evals. Add blocks only when they fix a measured failure.
