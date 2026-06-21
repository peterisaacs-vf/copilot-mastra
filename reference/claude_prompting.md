---
last_updated: 2026-04-16
source: https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering
models_covered: claude-4.6-opus, claude-4.6-sonnet, claude-4.5-haiku
---

# Claude Prompting Guidelines (Anthropic Official)

## Structure
- XML tags are the primary structuring tool: `<instructions>`, `<context>`, `<example>`
- Place long documents above query/instructions (up to 30% quality improvement)
- Match prompt style to desired output style (markdown in = markdown out)
- Tell Claude what to do, not what not to do

## System Prompts
- Set a role — even one sentence focuses behavior and tone
- Use XML-tagged blocks for tool behavior guidance
- Suppress preambles with explicit instruction
- Include context about the runtime environment

## Examples
- 3-5 examples recommended for few-shot
- Wrap in `<example>` tags, make diverse, vary edge cases
- Include `<thinking>` tags in examples to show reasoning patterns

## Model-Specific

### Haiku 4.5
- Fast, cheap, follows instructions well
- Needs more explicit instructions than Sonnet/Opus
- Good for structured tasks with clear rules

### Sonnet 4.6
- Defaults to effort: high
- For most apps: effort: medium. High-volume: effort: low
- 64k max token budget at medium/high effort
- Use for fast turnaround with good quality

### Opus 4.6
- Does significantly more upfront exploration
- Highly responsive to system prompt — dial back aggressive language
- Tendency to overengineer — add anti-overengineering instructions
- Strong predilection for spawning subagents

## Key Principles
- Explain WHY behind constraints — Claude generalizes from context
- "Never use ellipses (TTS can't pronounce them)" beats "NEVER use ellipses"
- Specificity > emphasis. Clear instructions > ALL CAPS warnings
- Prefilled assistant turns deprecated in Claude 4.6+
