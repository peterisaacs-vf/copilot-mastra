import { Agent } from '@mastra/core/agent';
import { SkillSearchProcessor } from '@mastra/core/processors';
import { getSkillWorkspace } from '../mastra/workspace';
import { mainModel } from '../mastra/models';
import { loadMarkdownBody } from '../lib/loadPrompt';

/**
 * A/B: eager SkillsProcessor (inject all skill metadata upfront, current default)
 * vs on-demand SkillSearchProcessor (search_skills -> load_skill). Same instructions,
 * same model, same workspace — isolates the processor. Compares routing accuracy
 * and input-token cost. Mastra docs recommend on-demand for 10+ skills (we have 22).
 */
type Case = { u: string; expect: string[] };
const CASES: Case[] = [
  { u: "Here's a transcript where the bot gave a wrong answer: https://creator.voiceflow.com/t/abc. What went wrong?", expect: ['debug'] },
  { u: 'My booking agent keeps looping back to the welcome step and never finishes a booking.', expect: ['audit-wiring', 'debug'] },
  { u: 'I want to add a playbook that handles refund requests.', expect: ['build-agent'] }, // eager leaked -> start
  { u: 'Add a function that calls our inventory API and returns stock counts.', expect: ['functions', 'wiring-architect'] },
  { u: 'Rewrite my global prompt to be more concise and on-brand.', expect: ['prompting'] },
  { u: 'Use my real transcripts to improve my booking prompt.', expect: ['prompt-optimizer'] },
  { u: 'My knowledge base isn’t returning the right answers.', expect: ['knowledge-base'] },
  { u: 'My voice agent reads phone numbers as one giant number.', expect: ['voice'] },
  { u: 'Set up some evaluations for my agent.', expect: ['test'] },
  { u: 'I need to make changes without breaking my live agent.', expect: ['environments'] },
  { u: 'What can you help me with?', expect: ['voiceflow-overview'] },
  { u: 'Build me a voice booking agent: it needs a function that calls our scheduling API and a KB for FAQs.', expect: ['build-agent', 'functions', 'voice', 'knowledge-base', 'wiring-architect'] },
];

const ws = await getSkillWorkspace();
const instructions = loadMarkdownBody('agents/orchestrator.md');

const eager = new Agent({ id: 'ab-eager', name: 'ab-eager', instructions, model: mainModel, workspace: ws });
const onDemand = new Agent({
  id: 'ab-ondemand', name: 'ab-ondemand', instructions, model: mainModel, workspace: ws,
  inputProcessors: [new SkillSearchProcessor({ workspace: ws, search: { topK: 6, minScore: 0.1 } })],
});

type R = { skills: string[]; searches: number; inTok: number; hit: boolean; ok: boolean };
async function run(agent: Agent, c: Case): Promise<R> {
  try {
    const r: any = await agent.generate(c.u, { maxSteps: 5 } as any);
    const skills: string[] = []; let searches = 0;
    (function walk(o: any) {
      if (!o || typeof o !== 'object') return;
      if (Array.isArray(o)) return o.forEach(walk);
      if (typeof o.toolName === 'string') {
        const a = o.args ?? o.input ?? {};
        if (o.toolName === 'skill' || o.toolName === 'load_skill') { const n = a.name ?? a.skill ?? a.skillName; if (n) skills.push(n); }
        else if (o.toolName === 'skill_search' || o.toolName === 'search_skills') searches++;
      }
      for (const k in o) walk(o[k]);
    })(r);
    const uniq = [...new Set(skills)];
    return { skills: uniq, searches, inTok: (r.totalUsage ?? r.usage ?? {}).inputTokens ?? 0, hit: uniq.some((s) => c.expect.includes(s)), ok: true };
  } catch (e: any) { return { skills: [], searches: 0, inTok: 0, hit: false, ok: false }; }
}

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); process.stderr.write('.'); } }));
  return out;
}

const eagerRes = await pool(CASES, 3, (c) => run(eager, c));
const odRes = await pool(CASES, 3, (c) => run(onDemand, c));
process.stderr.write('\n');

const pad = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s).padEnd(n);
console.log('\n' + pad('UTTERANCE', 44) + pad('EAGER', 26) + 'ON-DEMAND');
console.log('-'.repeat(96));
CASES.forEach((c, i) => {
  const e = eagerRes[i], o = odRes[i];
  console.log(pad(c.u, 44) + pad(`${e.hit ? '✓' : '✗'} ${e.skills.join(',') || 'none'}`, 26) + `${o.hit ? '✓' : '✗'} ${o.skills.join(',') || 'none'}${o.searches ? ` (search×${o.searches})` : ''}`);
});
const acc = (rs: R[]) => Math.round((rs.filter((r) => r.hit).length / rs.length) * 100);
const avgTok = (rs: R[]) => Math.round(rs.reduce((a, r) => a + r.inTok, 0) / rs.length);
console.log('\n=== summary ===');
console.log(`EAGER     routing ${acc(eagerRes)}%   avg input tokens ${avgTok(eagerRes)}`);
console.log(`ON-DEMAND routing ${acc(odRes)}%   avg input tokens ${avgTok(odRes)}   (Δtokens ${avgTok(odRes) - avgTok(eagerRes)})`);
process.exit(0);
