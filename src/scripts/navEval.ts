import { mastra } from '../mastra/index';

/**
 * Focused validation of the nav-skill consolidation: the contested orientation
 * cases + the two former `start` leak cases. Each run 3x to see past routing noise.
 * Run: tsx src/scripts/navEval.ts
 */
type Case = { u: string; expect: string[]; note: string };
const CASES: Case[] = [
  { u: 'What can you help me with?', expect: ['voiceflow-overview', 'help'], note: 'catalog' },
  { u: 'Where do I start?', expect: ['start'], note: 'onboarding' },
  { u: "I'm brand new here — set me up to work on my agent.", expect: ['start'], note: 'onboarding' },
  { u: 'Show me everything you can do — list all your skills and tools.', expect: ['help', 'voiceflow-overview'], note: 'menu' },
  { u: 'I want to add a playbook that handles refund requests.', expect: ['build-agent'], note: 'former start-leak' },
  { u: 'I want to stress-test my agent with some tricky scenarios.', expect: ['test'], note: 'former start-leak' },
];
const RUNS = 3;
const agent = mastra.getAgent('orchestrator');

async function once(u: string): Promise<string[]> {
  try {
    const r: any = await agent.generate(u, { maxSteps: 4 } as any);
    const skills: string[] = [];
    (function walk(o: any) {
      if (!o || typeof o !== 'object') return;
      if (Array.isArray(o)) return o.forEach(walk);
      if (o.toolName === 'skill' && (o.args ?? o.input)?.name) skills.push((o.args ?? o.input).name);
      for (const k in o) walk(o[k]);
    })(r);
    return [...new Set(skills)];
  } catch { return ['ERR']; }
}

const tasks = CASES.flatMap((c, ci) => Array.from({ length: RUNS }, (_, ri) => ({ ci, ri })));
const results: string[][][] = CASES.map(() => []);
let i = 0;
await Promise.all(Array.from({ length: 4 }, async () => {
  while (i < tasks.length) { const t = tasks[i++]; results[t.ci][t.ri] = await once(CASES[t.ci].u); process.stderr.write('.'); }
}));
process.stderr.write('\n');

console.log('\nNAV CONSOLIDATION VALIDATION (3 runs each)\n' + '='.repeat(74));
let hitRuns = 0, totalRuns = 0;
for (let ci = 0; ci < CASES.length; ci++) {
  const c = CASES[ci];
  const runs = results[ci];
  const hits = runs.filter((sk) => sk.some((s) => c.expect.includes(s))).length;
  hitRuns += hits; totalRuns += runs.length;
  console.log(`\n"${c.u}"  [${c.note}]  expect ${c.expect.join('|')}`);
  runs.forEach((sk, ri) => console.log(`   run ${ri + 1}: ${sk.join(',') || 'none'}  ${sk.some((s) => c.expect.includes(s)) ? '✓' : '✗'}`));
}
console.log(`\n=== ${hitRuns}/${totalRuns} runs hit expected (${Math.round((hitRuns / totalRuns) * 100)}%) ===`);
process.exit(0);
