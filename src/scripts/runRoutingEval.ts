import { runEvals } from '@mastra/core/evals';
import { mastra } from '../mastra/index';
import { skillRoutingScorer } from '../mastra/scorers/skillRouting';
import { ROUTING_CASES, isAmbiguous } from '../mastra/scorers/routingDataset';

/**
 * Routing eval on Mastra's eval suite: runEvals drives the orchestrator over the golden
 * set and applies the skill-routing scorer (groundTruth auto-passed). This is the
 * "proper" eval (Studio-visible scorer, CI-friendly); skillEval.ts remains the quick
 * standalone version.
 *
 * Run: MEMORY_DISABLED=1 GLM_API_KEY=… npx tsx src/scripts/runRoutingEval.ts
 */
const orchestrator = mastra.getAgent('orchestrator');

const data = ROUTING_CASES.map((c) => ({
  input: c.u,
  groundTruth: { expected: c.expect, ambiguous: isAmbiguous(c) },
}));

const rows: { input: string; score: number; reason: string; ambiguous: boolean }[] = [];

const result = await runEvals({
  target: orchestrator,
  data,
  scorers: [skillRoutingScorer],
  targetOptions: { maxSteps: 4 } as any,
  concurrency: 4,
  onItemComplete: ({ item, scorerResults }: any) => {
    const sr = Array.isArray(scorerResults) ? scorerResults[0] : Object.values(scorerResults ?? {})[0];
    const score = (sr as any)?.score ?? 0;
    rows.push({
      input: String((item as any).input),
      score,
      reason: (sr as any)?.reason ?? '',
      ambiguous: !!(item as any).groundTruth?.ambiguous,
    });
    process.stderr.write(score ? '.' : 'x');
  },
});
process.stderr.write('\n');

for (const r of rows) {
  const mark = r.ambiguous ? '~' : r.score === 1 ? '✓' : '✗';
  console.log(`${mark}  ${r.input.slice(0, 54).padEnd(55)} ${r.reason}`);
}

const scored = rows.filter((r) => !r.ambiguous);
const hits = scored.filter((r) => r.score === 1).length;
console.log('\n=== aggregate ===');
console.log(`runEvals avg scores (all items): ${JSON.stringify(result.scores)}`);
console.log(`scored (excl. ambiguous): ${hits}/${scored.length} (${Math.round((hits / (scored.length || 1)) * 100)}%)   items: ${result.summary.totalItems}`);
process.exit(0);
