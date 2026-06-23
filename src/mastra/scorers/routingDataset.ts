/**
 * Skill-routing golden set — the single source of truth for routing evals, shared by
 * the quick script (skillEval.ts) and the Mastra runEvals runner (runRoutingEval.ts).
 *
 * Each case: an utterance + the set of skills any of which is an acceptable load.
 * `note: 'ambiguous'` marks cases with no single right answer (scored leniently / reported
 * separately).
 */
export type RoutingCase = { u: string; expect: string[]; note?: string };

export const ROUTING_CASES: RoutingCase[] = [
  // --- debugging / behavioral ---
  { u: "Here's a transcript where the bot gave a wrong answer: https://creator.voiceflow.com/t/abc. What went wrong?", expect: ['debug'] },
  { u: 'My booking agent keeps looping back to the welcome step and never finishes a booking.', expect: ['audit-wiring', 'debug'] },
  { u: 'The agent keeps asking for the user’s email even after they already gave it.', expect: ['audit-wiring', 'wiring-architect'] },
  { u: 'Why does my agent ignore what the user says and just repeat its last message?', expect: ['audit-wiring', 'debug'] },
  // --- build / edit ---
  { u: 'I want to add a playbook that handles refund requests.', expect: ['build-agent'] },
  { u: 'Help me build a voice agent for a pizza shop.', expect: ['build-agent', 'voice'] },
  { u: 'Add a function that calls our inventory API and returns stock counts.', expect: ['functions', 'wiring-architect'] },
  // --- prompting ---
  { u: 'Rewrite my global prompt to be more concise and on-brand.', expect: ['prompting'] },
  { u: 'My playbook instructions are messy — can you clean them up?', expect: ['prompting'] },
  // --- prompt optimization (transcript-driven) ---
  { u: 'Use my real transcripts to improve my booking prompt.', expect: ['prompt-optimizer'] },
  { u: 'Optimize my agent’s prompt based on where it’s failing in production.', expect: ['prompt-optimizer'] },
  // --- functions / wiring ---
  { u: 'My function returns a value but the next step can’t see it.', expect: ['wiring-architect', 'audit-wiring'] },
  { u: 'How do I make an HTTP request inside a Voiceflow function?', expect: ['functions'] },
  { u: 'Check my project for variables that never get set anywhere.', expect: ['audit-wiring'] },
  // --- knowledge base ---
  { u: 'My knowledge base isn’t returning the right answers.', expect: ['knowledge-base'] },
  { u: 'How should I structure my KB documents for better retrieval?', expect: ['knowledge-base'] },
  // --- voice ---
  { u: 'My voice agent reads phone numbers as one giant number.', expect: ['voice'] },
  { u: 'The TTS pronunciation is off for our product names.', expect: ['voice'] },
  // --- testing / evals ---
  { u: 'Set up some evaluations for my agent.', expect: ['test'] },
  { u: 'I want to stress-test my agent with some tricky scenarios.', expect: ['test'] },
  { u: 'How do I measure whether my agent is actually getting better?', expect: ['test'] },
  // --- environments ---
  { u: 'I need to make changes without breaking my live agent.', expect: ['environments'] },
  { u: 'How do I promote my dev changes to production?', expect: ['environments'] },
  // --- documentation ---
  { u: 'Can you create a wiki documenting how my project works?', expect: ['document'] },
  // --- architecture ---
  { u: 'Should I use one big agent or split it into multiple playbooks?', expect: ['agent-architecture'] },
  // --- generic / routing ---
  { u: 'What can you help me with?', expect: ['voiceflow-overview'] },
  { u: 'Where do I start?', expect: ['start', 'voiceflow-overview'], note: 'either: start (begin session) or overview (catalog)' },
  // --- intentionally ambiguous (any sensible pull is fine) ---
  { u: 'My agent is slow and users are dropping off.', expect: ['audit-wiring', 'debug', 'agent-architecture', 'test'], note: 'ambiguous' },
  { u: 'Make my agent better.', expect: ['voiceflow-overview', 'prompt-optimizer', 'build-agent', 'audit-wiring'], note: 'ambiguous' },
];

export const isAmbiguous = (c: RoutingCase): boolean => !!c.note?.includes('ambiguous');
