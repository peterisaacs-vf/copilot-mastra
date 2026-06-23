import { skillRoutingJudgeScorer } from '../mastra/scorers/skillRoutingJudge';

/**
 * Smoke test for the LLM-judge scorer end-to-end (through Mastra's structured-output
 * path, not a raw call) — confirms the configured judge model emits a parseable verdict.
 * Run: GLM_API_KEY=… npx tsx src/scripts/judgeScorerSmoke.ts
 */
const cases = [
  {
    label: 'good (rewrite prompt -> prompting)',
    input: [{ role: 'user', content: 'Rewrite my global prompt to be more concise.' }],
    output: [{ role: 'assistant', content: [{ type: 'tool-call', toolName: 'skill', args: { name: 'prompting' } }] }],
    expect: 1,
  },
  {
    label: 'bad  (refund playbook -> voice)',
    input: [{ role: 'user', content: 'I want to add a playbook that handles refund requests.' }],
    output: [{ role: 'assistant', content: [{ type: 'tool-call', toolName: 'skill', args: { name: 'voice' } }] }],
    expect: 0,
  },
];

for (const c of cases) {
  try {
    const r = await skillRoutingJudgeScorer.run({ input: c.input as any, output: c.output as any });
    const ok = r.score === c.expect ? '✓' : '✗';
    console.log(`${ok} ${c.label}: score=${r.score} (expect ${c.expect})  reason="${(r.reason ?? '').slice(0, 110)}"`);
  } catch (e: any) {
    console.log(`✗ ${c.label}: ERROR ${e?.message ?? e}`);
  }
}
process.exit(0);
