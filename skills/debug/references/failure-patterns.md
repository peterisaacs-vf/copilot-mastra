# Common failure patterns

Recurring Voiceflow failure modes with detection steps and fix templates. Loaded on demand from the `debug` skill via `skill_read`.

## 1. Hallucination / Made-Up Information

**Symptoms:**
- Agent provides fake order numbers, URLs, or data
- Information doesn't match what tools returned
- Agent confidently states incorrect facts

**Diagnosis:**
- Check if tool was called at all
- Check if tool returned empty/error
- Check if prompt tells agent what to do when data is missing

**Fix template:**
```xml
<no_hallucination>
NEVER make up information. If a tool returns empty or fails:
1. Do NOT fabricate data
2. Acknowledge you couldn't retrieve the information
3. Offer an alternative (retry, transfer, manual lookup)
</no_hallucination>
```

## 2. Tool Not Called When Needed

**Symptoms:**
- Agent makes up information instead of looking it up
- Provides generic answers when specific data is available
- Guesses at account details, order status, etc.

**Diagnosis:**
- Is the tool defined correctly?
- Does the tool's LLM description contain **both WHAT it does and
  WHEN to call it**? If "when" lives only in playbook instructions,
  it's invisible to other playbooks routing to this tool's parent —
  the most common cause of a tool being silently skipped. See the
  `build-agent` skill for the full WHAT + WHEN rule.
- Does the prompt also reinforce WHEN to call it for the active
  playbook (belt-and-braces)?

**Fix template:**
```xml
<mandatory_tool_usage>
When user asks about [topic], ALWAYS call [tool_name] immediately.
Never guess or provide generic information. Use actual data from tools.

Required calls:
- Order status questions → call get_order
- Account balance → call get_balance
- [specific scenario] → call [specific tool]
</mandatory_tool_usage>
```

## 3. Tool Called But Error Not Handled

**Symptoms:**
- Tool fails silently
- Agent proceeds as if tool succeeded
- Hallucinated data after tool error

**Diagnosis:**
- What did the tool return?
- Does the prompt have error handling instructions?
- Does the function surface errors properly?

**Fix template:**
```xml
<error_handling>
If any tool returns an error, empty result, or unexpected data:
1. Do NOT proceed with the normal flow
2. Do NOT make up replacement data
3. Say: "I'm having trouble retrieving that information"
4. Offer: transfer to human OR ask to try again later
</error_handling>
```

## 4. Information Leakage

**Symptoms:**
- Agent mentions "knowledge base", "database", "API"
- References tool names or internal systems
- Says "let me check our system" when it should be seamless

**Diagnosis:**
Check if prompt includes instructions to hide internal operations.

**Fix template:**
```xml
<silent_execution>
Execute all tool calls silently. Never mention:
- Knowledge base, database, or system searches
- Tool names or API calls
- Internal processes or routing

Present information as if you already knew it.
</silent_execution>
```

## 5. Lost Context

**Symptoms:**
- Agent asks for information user already provided
- Forgets user's name mid-conversation
- Doesn't connect related requests

**Diagnosis:**
- Is the conversation context being passed correctly?
- Is the prompt telling the agent to remember things?
- Is there a context window issue (too long conversation)?

**Fix template:**
```xml
<context_memory>
Remember all information from this conversation:
- User's name and details
- Information already collected
- Current task/topic
- Previous questions and answers

Never re-ask questions already answered.
</context_memory>
```

## 6. Wrong Tone/Style

**Symptoms:**
- Too formal when should be casual (or vice versa)
- Inconsistent style within conversation
- Doesn't match brand voice

**Fix template:**
```xml
<tone>
Use [casual/professional/formal] communication:
- [Specific phrases to use]
- [Specific phrases to avoid]
- [Example of ideal response]

Match the user's energy level while maintaining [brand] voice.
</tone>
```

## 7. Response Length Issues

**Symptoms:**
- Responses too long (walls of text)
- Responses too short (missing important info)

**Fix template:**
```xml
<response_length>
Keep responses [brief/standard/detailed]:
- Target: [X-Y] words per response
- Voice: Maximum 2 sentences per turn
- Include: [essential elements]
- Exclude: [unnecessary elements]
</response_length>
```

## 8. Voice-Specific Issues

**Symptoms (voice agents only):**
- Numbers spoken incorrectly ("25" instead of "twenty-five")
- Multiple questions in one turn
- References to visual elements
- Doesn't handle speech recognition errors

**Fix template:**
```xml
<voice_formatting>
ONE question per turn. Never combine questions.

Numbers: Spell out all numbers ("twenty-five" not "25")
Currency: "one hundred and fifty dollars" not "$150"
Phone: "five, five, five. one, two, three. four, five, six, seven."

Never reference visual elements (buttons, screens, links to click).
</voice_formatting>
```

## 9. Handoff Issues

**Symptoms:**
- Transfers to human when it shouldn't
- Doesn't transfer when it should
- Poor handoff experience (abrupt, confusing)

**Fix template:**
```xml
<handoff_rules>
Transfer to human ONLY when:
- [specific trigger 1]
- [specific trigger 2]
- User explicitly requests human help

Do NOT transfer for:
- [scenarios agent should handle]

Before transferring, say: "[appropriate handoff message]"
</handoff_rules>
```

## 9a. Diagnostic Trap: Repeat Contact vs. Transfer Loop

**This is an analysis methodology issue, not an agent behavior issue. It applies to any brand/agent with human handoff.**

When scanning transcripts at scale, it's easy to see high turn counts (1000+) and many transfer/handoff tool calls and conclude the agent is stuck in a loop. **This is often wrong.** You must verify before claiming a loop exists.

### How to distinguish:

| Signal | Transfer Loop (bug) | Repeat Contact (not a bug) |
|--------|-------------------|---------------------------|
| Transfer tool calls | Many | Many |
| Successful handoff events (e.g. `live-agent-handoff`) | **Zero or very few** | **Roughly matches transfer calls** |
| User messages over time | Repetitive within seconds/minutes | Spread across hours/days/weeks |
| Session restarts (`launch` events) | Few or none | Many (user keeps coming back) |
| Unique external conversation/ticket IDs | None or same ID recycled | **Multiple different IDs** |
| Turn count | High | High |

**The critical check:** Always cross-reference transfer tool calls against successful handoff events. If they match ~1:1, the transfer is working — the volume means the user keeps coming back because their underlying issue isn't being resolved on the human side.

### Required analysis steps for any transcript with high transfer volume:

1. Count transfer tool calls (e.g. `transfer_to_human`, `handoff`, `escalate`, etc.)
2. Count successful handoff events (e.g. `live-agent-handoff`, `chat_started`, etc.)
3. Check if handoff events have unique external conversation/ticket IDs
4. Look at timestamps — are transfers spread across days (repeat contact) or firing every few seconds (loop)?
5. Read actual user messages — are they re-initiating ("Find me an agent") or is the agent cycling autonomously?

### If it IS a repeat contact pattern, the real questions are:

- Why isn't the user's issue being resolved by human agents?
- Is the agent correctly surfacing context to the human agent at handoff?
- Should the agent recognize returning users and escalate differently?

### If it IS a genuine loop:

- Check what happens after the transfer tool — does a reclassify/re-route tool send the user back to the start?
- Look for the pattern: transfer → reclassify → supervisor → greet → triage → transfer again
- A real loop will show zero successful handoff events and rapid-fire turns within a single session

## 10. Call Not Ending

**Symptoms:**
- Agent says goodbye but call doesn't terminate
- User has to hang up manually
- end_call tool not invoked

**Diagnosis:**
- Does the prompt tell agent to call end_call?
- Is the end_call tool available?
- Is there a clear trigger for when to end?

**Fix template:**
```xml
<call_termination>
After saying goodbye ("Thanks for calling, have a great day"),
immediately call the end_call tool. Do not wait for user response.
</call_termination>
```

---

# Working Notes Protocol

For any analysis touching 5+ transcripts or 10+ tool calls, maintain
working notes to avoid losing early findings as context grows.

**When to write**: After each major phase (triage, deep-read batch,
KB queries). Not after every tool call.

**When to read back**: Before cross-correlation or writing the final
report. Re-read your notes to ensure nothing was lost from earlier.

**Format**:

```
# Working Notes: {command} — {project}
