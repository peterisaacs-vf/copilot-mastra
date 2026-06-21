---
name: knowledge-base
description: >
  Knowledge base design and optimization for Voiceflow agents. Covers when
  to use KB vs hardcoding, document structure, chunking strategy, metadata,
  coverage analysis, and gap identification from transcripts.
  TRIGGER when: user asks about KB strategy, document design, chunking,
  metadata, KB retrieval optimization, uploading documents, KB tools,
  knowledge_base_search, "the bot can't find X in the docs", "what
  goes in the KB vs the prompt", grounding, RAG, or LLM chunking flags
  (llmPrependContext, markdownConversion, llmBasedChunks).
version: 0.1.0
---

# Knowledge Base Design & Optimization

## When to Use KB vs Hardcoding

### Use a Knowledge Base when:
- Information changes frequently (prices, policies, inventory)
- Content is large (>5,000 words)
- Multiple agents need the same information
- You want agents to cite sources
- Information needs versioning

### Hardcode in the prompt when:
- Small and static (<1,000 words)
- Never changes (founding date, specific rules)
- Only one agent uses it
- Speed is critical

## Document Structure

### Good Documents
- **Focused scope**: One document = one topic
- **Front-loaded summary**: First paragraph is a concise overview
- **Hierarchical sections**: Clear H2/H3 headings
- **Concrete examples**: Every policy has an example
- **Explicit edge cases**: Exceptions called out
- **Length target**: 300-1,500 words

## Chunking Strategy

### Chunk Size Guidelines
- **Optimal:** 200-500 words per chunk
- **Minimum:** 100 words (smaller is noise)
- **Maximum:** 800 words

### Chunking Patterns
- **By section:** Overview + rules | Returns | Damaged items
- **By scenario:** "Double charges" with fix | "Missing charges" with fix
- **By question type:** "What is shipping time?" | "Can I expedite?"

### Bad Chunking (Avoid)
- One huge chunk with entire document
- Chunks with only headers
- Chunks cut mid-sentence
- Mixed topics in one chunk

## Metadata Schema

| Field | Type | Purpose | Examples |
|-------|------|---------|----------|
| `category` | string | Product/service area | "billing", "shipping" |
| `audience` | string | Who this is for | "new_customer", "existing" |
| `channel` | string | Where it applies | "voice", "chat", "both" |
| `urgency` | string | How time-critical | "high", "medium", "low" |

## Coverage Analysis

For each product/service area, verify you have docs for:
- [ ] What is this product/service?
- [ ] How do I get started?
- [ ] What are the pricing/tiers?
- [ ] What's the return/cancellation policy?
- [ ] What if something goes wrong?
- [ ] How do I contact support?
- [ ] Restrictions or requirements?

## Query Optimization

Design KB to support these patterns:
- "What is the policy on [topic]?"
- "Can the customer [action]?"
- "What happens if [scenario]?"
- "How do they [process]?"

Keys: consistent terminology, relevant metadata tags, concrete examples.

## Table Data

### Use Table Format when:
- Consistent columns (SKU, price, availability)
- Comparison is the main use case

### Use Text Format when:
- Narrative or explanatory content
- Policy/process oriented

## Gap Identification from Transcripts

1. Read 20-30 transcripts
2. Note the topic for each agent fallback/error
3. Group by topic
4. For each: "Do we have a KB document?"
5. If no > create one
6. If yes > "Why didn't the agent find this?" (chunking? terminology? missing example?)

---

## Related skills

- **`build-agent`** — full build context; KB is one component.
- **`prompting`** — when KB tools are referenced from playbook prompts.
- **`debug`** — for debugging individual KB retrieval failures.
- **`voiceflow-overview`** — index of all available skills.
