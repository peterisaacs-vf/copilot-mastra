import { createScorer } from '@mastra/core/evals';

/**
 * Recursively collect the names of skills loaded via the `skill` tool from anywhere in a
 * scorer run (output messages, trajectory, trace data). Walking the whole run object makes
 * this robust to how runEvals shapes the data for agent- vs trajectory-level scorers.
 */
export function extractLoadedSkills(o: unknown, acc: Set<string> = new Set()): Set<string> {
  if (!o || typeof o !== 'object') return acc;
  if (Array.isArray(o)) {
    for (const x of o) extractLoadedSkills(x, acc);
    return acc;
  }
  const rec = o as Record<string, any>;
  if (rec.toolName === 'skill') {
    const a = rec.args ?? rec.input ?? {};
    if (a?.name) acc.add(String(a.name));
  }
  for (const k of Object.keys(rec)) extractLoadedSkills(rec[k], acc);
  return acc;
}

/**
 * Skill-routing scorer (Mastra eval suite). Scores 1.0 when the orchestrator loaded at
 * least one EXPECTED skill for the utterance, else 0.0. The acceptable set comes from
 * `groundTruth.expected` — set per dataset item and auto-passed by `runEvals`.
 *
 * This is a function-only scorer (no LLM judge): deterministic, cheap, and ideal for a
 * golden-set regression gate. Registered with Mastra so it's visible in Studio; driven
 * offline by src/scripts/runRoutingEval.ts.
 */
export const skillRoutingScorer = createScorer({
  id: 'skill-routing',
  name: 'Skill Routing',
  description:
    'Did the orchestrator load an acceptable skill for the utterance? Scores loaded ∈ groundTruth.expected.',
})
  .preprocess(({ run }) => ({ loaded: [...extractLoadedSkills(run)] }))
  .generateScore(({ run, results }) => {
    const loaded: string[] = results.preprocessStepResult?.loaded ?? [];
    const expected: string[] = (run as any).groundTruth?.expected ?? [];
    return loaded.some((s) => expected.includes(s)) ? 1 : 0;
  })
  .generateReason(({ run, results, score }) => {
    const loaded: string[] = results.preprocessStepResult?.loaded ?? [];
    const expected: string[] = (run as any).groundTruth?.expected ?? [];
    return `loaded [${loaded.join(',') || 'none'}] | expected [${expected.join('|')}] -> ${score ? 'hit' : 'miss'}`;
  });
