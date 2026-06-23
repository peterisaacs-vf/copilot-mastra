/**
 * Judge-model benchmark. Picks the best NEUTRAL judge for routing evals by measuring how
 * well each Fireworks model agrees with a strong, different reference judge (Claude) on a
 * curated set of routing decisions.
 *
 * The `gold` verdicts below are Claude's reference judgments (the neutral "ground truth"
 * for this benchmark). Each candidate model judges the same cases; we report agreement
 * with gold, split by clear vs. vague cases, plus harsh/lenient skew.
 *
 * Raw Fireworks calls (no Mastra boot). Run:
 *   GLM_API_KEY=… npx tsx src/scripts/judgeBenchmark.ts
 */
export {}; // make this a module so top-level await is allowed

const KEY = process.env.GLM_API_KEY ?? '';
const BASE = process.env.GLM_BASE_URL ?? 'https://api.fireworks.ai/inference/v1';
if (!KEY) {
  console.error('GLM_API_KEY required');
  process.exit(1);
}

const MODELS = [
  'accounts/fireworks/models/kimi-k2p6', // Kimi K2.6 — neutral candidate
  'accounts/fireworks/models/kimi-k2p7-code', // Kimi K2.7 (code-tuned) — neutral candidate
  'accounts/fireworks/models/qwen3p7-plus', // Qwen3.7 Plus — neutral candidate
  'accounts/fireworks/models/glm-5p2', // our MAIN model (self-baseline; expect bias)
  'accounts/fireworks/models/deepseek-v4-flash', // current judge (triage tier)
];

type Tag = 'good' | 'bad' | 'vague';
type Case = { u: string; loaded: string[]; gold: boolean; tag: Tag };

// Claude's reference verdicts (gold). good=appropriate load, bad=misroute/no-load on a
// clear task, vague=acceptable to orient on an ambiguous ask.
const CASES: Case[] = [
  { u: 'My booking bot loops back to the welcome step and never finishes a booking.', loaded: ['debug', 'audit-wiring'], gold: true, tag: 'good' },
  { u: 'I want to add a playbook that handles refund requests.', loaded: ['build-agent'], gold: true, tag: 'good' },
  { u: 'My voice agent mispronounces our product names.', loaded: ['voice'], gold: true, tag: 'good' },
  { u: 'Set up some evaluations for my agent.', loaded: ['test'], gold: true, tag: 'good' },
  { u: 'I want to stress-test my agent with tricky scenarios.', loaded: ['test'], gold: true, tag: 'good' },
  { u: 'My knowledge base returns the wrong answers.', loaded: ['knowledge-base'], gold: true, tag: 'good' },
  { u: 'Rewrite my global prompt to be more concise.', loaded: ['prompting'], gold: true, tag: 'good' },
  { u: 'How do I promote my dev changes to production?', loaded: ['environments'], gold: true, tag: 'good' },
  { u: 'What can you help me with?', loaded: ['voiceflow-overview'], gold: true, tag: 'good' },
  { u: 'Add a function that calls our inventory API.', loaded: ['functions'], gold: true, tag: 'good' },
  // clear misroutes / no-load on a clear task → inappropriate
  { u: 'I want to add a playbook that handles refund requests.', loaded: ['voice'], gold: false, tag: 'bad' },
  { u: 'My voice agent mispronounces our product names.', loaded: ['knowledge-base'], gold: false, tag: 'bad' },
  { u: 'My knowledge base returns the wrong answers.', loaded: [], gold: false, tag: 'bad' },
  { u: 'I want to stress-test my agent with tricky scenarios.', loaded: ['start'], gold: false, tag: 'bad' },
  { u: 'Add a function that calls our inventory API.', loaded: ['document'], gold: false, tag: 'bad' },
  // vague → orienting via start is acceptable
  { u: 'Make my agent better.', loaded: ['start'], gold: true, tag: 'vague' },
  { u: 'Where do I start?', loaded: ['start'], gold: true, tag: 'vague' },
];

const SKILLS =
  'debug, audit-wiring, wiring-architect, build-agent, functions, prompting, prompt-optimizer, ' +
  'knowledge-base, voice, test, environments, document, agent-architecture, voiceflow-overview, start, projects';
const INSTR =
  'You evaluate a Voiceflow copilot router. Given a user message and which skill(s) the router ' +
  'loaded, judge whether the choice was appropriate. Be lenient when the message is vague or ' +
  'conversational; be strict when a clearly-named task was routed to an unrelated skill, or when ' +
  'nothing was loaded for a clear task.';
const prompt = (c: Case) =>
  `User message: "${c.u}"\nRouter loaded skill(s): [${c.loaded.join(', ') || 'none'}]\n` +
  `Available skills: ${SKILLS}.\nWas the load appropriate? Respond ONLY with JSON ` +
  `{"appropriate": boolean, "reason": string}.`;

async function judge(model: string, c: Case): Promise<boolean | null> {
  try {
    const res = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        max_tokens: 1200,
        temperature: 0,
        messages: [{ role: 'system', content: INSTR }, { role: 'user', content: prompt(c) }],
      }),
    });
    const j: any = await res.json();
    const msg = j?.choices?.[0]?.message ?? {};
    const txt = `${msg.content ?? ''}\n${msg.reasoning_content ?? ''}${msg.reasoning ?? ''}`;
    const m = txt.match(/"appropriate"\s*:\s*(true|false)/i) ?? txt.match(/\b(true|false|yes|no)\b/i);
    if (!m) return null;
    return /true|yes/i.test(m[1]) ? true : false;
  } catch {
    return null;
  }
}

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]);
      }
    }),
  );
  return out;
}

const clear = CASES.filter((c) => c.tag !== 'vague');
console.log(`Benchmarking ${MODELS.length} models on ${CASES.length} cases (${clear.length} clear, ${CASES.length - clear.length} vague) vs Claude gold.\n`);

for (const model of MODELS) {
  const verdicts = await pool(CASES, 6, (c) => judge(model, c));
  let agree = 0, clearAgree = 0, vagueAgree = 0, nulls = 0, harsh = 0, lenient = 0;
  const misses: string[] = [];
  CASES.forEach((c, i) => {
    const v = verdicts[i];
    if (v === null) { nulls++; return; }
    const ok = v === c.gold;
    if (ok) agree++;
    else {
      if (c.gold && !v) harsh++; // said inappropriate when it was fine
      if (!c.gold && v) lenient++; // said appropriate when it was a misroute
      misses.push(`      ${c.tag}: "${c.u.slice(0, 38)}" +[${c.loaded.join(',') || 'none'}] gold=${c.gold} got=${v}`);
    }
    if (c.tag !== 'vague' && ok) clearAgree++;
    if (c.tag === 'vague' && ok) vagueAgree++;
  });
  const name = model.split('/').pop();
  console.log(
    `${name?.padEnd(16)}  agree ${agree}/${CASES.length} (${Math.round((agree / CASES.length) * 100)}%)  ` +
    `clear ${clearAgree}/${clear.length}  vague ${vagueAgree}/${CASES.length - clear.length}  ` +
    `harsh:${harsh} lenient:${lenient}${nulls ? ` nulls:${nulls}` : ''}`,
  );
  if (misses.length) console.log(misses.join('\n'));
}
process.exit(0);
