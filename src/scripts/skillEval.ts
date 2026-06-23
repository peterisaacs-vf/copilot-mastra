import { mastra } from '../mastra/index';

/**
 * Skill-routing eval: fire single utterances at the orchestrator and record which
 * skill(s) it pulls (via the `skill` tool), plus any skill_search / subagent
 * delegation. Scores loaded-skill ∈ acceptable-set. Run: tsx src/scripts/skillEval.ts
 */
type Case = { u: string; expect: string[]; note?: string };

const CASES: Case[] = [
  // --- debugging / behavioral (pre-flight: behavioral bug -> audit-wiring first) ---
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
  // --- intentionally ambiguous (exploratory: any sensible pull is fine) ---
  { u: 'My agent is slow and users are dropping off.', expect: ['audit-wiring', 'debug', 'agent-architecture', 'test'], note: 'ambiguous' },
  { u: 'Make my agent better.', expect: ['voiceflow-overview', 'prompt-optimizer', 'build-agent', 'audit-wiring'], note: 'ambiguous' },
];

const agent = mastra.getAgent('orchestrator');

type Res = Case & { skills: string[]; searches: string[]; delegations: string[]; hit: boolean; ok: boolean; err?: string; ms: number; inTok: number; outTok: number };

async function runOne(c: Case): Promise<Res> {
  const t0 = Date.now();
  try {
    const r: any = await agent.generate(c.u, { maxSteps: 4 } as any);
    const ms = Date.now() - t0;
    const u = r.usage ?? {};
    const inTok = u.inputTokens ?? u.promptTokens ?? 0;
    const outTok = u.outputTokens ?? u.completionTokens ?? 0;
    const skills: string[] = [], searches: string[] = [], delegations: string[] = [];
    (function walk(o: any) {
      if (!o || typeof o !== 'object') return;
      if (Array.isArray(o)) return o.forEach(walk);
      if (o.toolName) {
        const a = o.args ?? o.input ?? {};
        if (o.toolName === 'skill' && a?.name) skills.push(a.name);
        else if (o.toolName === 'skill_search' && a?.query) searches.push(String(a.query).slice(0, 40));
        else if (/^agent/i.test(o.toolName) || /agent_/.test(o.toolName)) delegations.push(o.toolName);
      }
      for (const k in o) walk(o[k]);
    })(r);
    const uniq = [...new Set(skills)];
    return { ...c, skills: uniq, searches: [...new Set(searches)], delegations: [...new Set(delegations)], hit: uniq.some((s) => c.expect.includes(s)), ok: true, ms, inTok, outTok };
  } catch (e: any) {
    return { ...c, skills: [], searches: [], delegations: [], hit: false, ok: false, err: String(e?.message ?? e).slice(0, 90), ms: Date.now() - t0, inTok: 0, outTok: 0 };
  }
}

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx]); process.stderr.write('.'); }
  }));
  return out;
}

const results = await pool(CASES, 4, runOne);
process.stderr.write('\n');

const pad = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s).padEnd(n);
console.log('\n' + pad('UTTERANCE', 52) + pad('EXPECTED', 22) + pad('LOADED', 22) + 'HIT');
console.log('-'.repeat(104));
for (const r of results) {
  const loaded = r.skills.length ? r.skills.join(',') : (r.ok ? '(none)' : 'ERR');
  const mark = r.note?.includes('ambiguous') ? (r.skills.length ? '~' : '·') : r.hit ? '✓' : '✗';
  console.log(pad(r.u, 52) + pad(r.expect.join('|'), 22) + pad(loaded, 22) + mark + '  ' + String(r.ms).padStart(6) + 'ms');
}

const scored = results.filter((r) => !r.note?.includes('ambiguous'));
const hits = scored.filter((r) => r.hit).length;
const errs = results.filter((r) => !r.ok).length;
const none = results.filter((r) => r.ok && !r.skills.length).length;
console.log('\n=== summary ===');
console.log(`scored cases: ${scored.length}   hits: ${hits} (${Math.round((hits / scored.length) * 100)}%)   errors: ${errs}   loaded-nothing: ${none}`);
console.log('\n=== misses (scored) ===');
for (const r of scored.filter((r) => !r.hit)) console.log(`✗ "${r.u.slice(0, 60)}"  expected ${r.expect.join('|')}  got [${r.skills.join(',') || (r.ok ? 'none' : r.err)}]`);
console.log('\n=== ambiguous (what it chose) ===');
for (const r of results.filter((r) => r.note?.includes('ambiguous'))) console.log(`~ "${r.u.slice(0, 50)}"  -> [${r.skills.join(',') || 'none'}]`);

// Performance profile (ok cases only). Latency is dominated by the GLM call; tokens
// show the per-utterance context cost (system prompt + skill catalog + loads).
const okRes = results.filter((r) => r.ok);
const lat = okRes.map((r) => r.ms).sort((a, b) => a - b);
const q = (x: number) => (lat.length ? lat[Math.min(lat.length - 1, Math.floor(x * lat.length))] : 0);
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
const n = okRes.length || 1;
console.log('\n=== performance (ok cases) ===');
console.log(`latency ms: p50=${q(0.5)}  p95=${q(0.95)}  max=${lat[lat.length - 1] ?? 0}  avg=${Math.round(sum(lat) / n)}`);
console.log(`tokens total: in=${sum(okRes.map((r) => r.inTok))}  out=${sum(okRes.map((r) => r.outTok))}`);
console.log(`tokens avg/call: in=${Math.round(sum(okRes.map((r) => r.inTok)) / n)}  out=${Math.round(sum(okRes.map((r) => r.outTok)) / n)}`);
process.exit(0);
