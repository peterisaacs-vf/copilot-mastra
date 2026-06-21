---
name: voice
description: >
  Voice agent patterns for Voiceflow. Covers number formatting, TTS
  optimization, voice-specific guardrails, and conversational flow for
  voice channels.
  TRIGGER when: user is building a voice agent, configuring STT/TTS,
  asks about voice-specific patterns, mentions phone calls, IVR, voice
  channel, ElevenLabs, Deepgram, audio prompts, "spell out numbers",
  "voice agent isn't sounding right", call transfers, SIP, TwiML, or
  asks how to format numbers/dates/currency for speech.
version: 0.1.0
---

# Voice Agent Patterns

## Number Formatting & Speech

### Phone Numbers
- Repeating digits: "triple" for three (999 > "triple nine"), "double" for two
- Standard: 555-123-4567 > "five five five, one two three, four five six seven"

### General Numbers
- Small (1-20): Use words ("one", "twenty")
- Account/reference numbers: Digit by digit
- Time frames: ALWAYS "thirty to sixty days" NOT "30-60 days"

### Currency
- Whole: $5 > "five dollars"
- Decimals: $1.50 > "one dollar and fifty cents"

### Dates & Times
- Dates: 01/15/2023 > "January fifteenth, twenty twenty-three"
- Times: 3:30 PM > "three thirty PM"

## TTS Optimization

- Add periods for deliberate pauses
- Break complex info into smaller chunks
- Use commas in letter/number groupings
- URLs: example.com > "example dot com"

## Voice-Specific Guardrails

- **ONE question per turn.** Never combine questions.
- **No visual references.** "Click the button" > "Would you like me to send you a link?"
- **Keep responses short.** 1-2 sentences per turn.
- **Handle ASR errors.** "Sorry, I didn't catch that. Could you say that again?"
- **Announce tool calls.** "One moment while I look that up."

## Conversational Flow

- Use contractions: "I'll" not "I will"
- Match their energy — urgent issues get urgent responses
- Skip flattery — respond directly
- Always: Announce action > Call function > Wait > Use result

## Voice Prompt Evaluation

When reviewing voice prompts, check:
- Responses are 1-2 sentences max
- No stacked questions (only ONE per turn)
- Tool calls announced ("One moment" or similar)
- Numbers/currency/dates spelled out
- No visual references (links, buttons)

---

## Related skills

- **`prompting`** — voice-specific prompts still follow the standard prompt-engineering rules; voice adds constraints on top.
- **`build-agent`** — full voice agent builds.
- **`functions`** — for voice-specific function patterns (TwiML, SIP transfer, etc.).
- **`voiceflow-overview`** — index of all available skills.
