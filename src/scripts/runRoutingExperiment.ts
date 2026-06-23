/**
 * runRoutingExperiment.ts — run the skill-routing eval as a Mastra *Experiment* and persist
 * it so it shows in Studio (Datasets → skill-routing-golden → Experiments tab). This is the
 * EXECUTOR; wireRoutingExperiment.ts only syncs the dataset over REST.
 *
 * Where results land == which storage this process uses:
 *   - DATABASE_URL set to the deployed Neon URL  → lands in the DEPLOYED Studio.  ← do this
 *   - DATABASE_URL unset                         → local LibSQL (good for a dry run only).
 * GLM_API_KEY (in .env) is required either way — this actually runs the orchestrator.
 *
 * Why not run it on the deployed Vercel app via `mastra api experiment run`: that runner
 * kicks the experiment off in a background task AFTER returning its HTTP response, and Vercel
 * freezes the serverless function once the response is sent — so the run never executes (it
 * lands as a failed experiment with startedAt=null). Experiment EXECUTION needs a persistent
 * process: this script, or a long-running (non-serverless) Mastra server pointed at Neon.
 *
 * Memory is force-disabled so the orchestrator's thread-scoped Observational Memory doesn't
 * demand a per-item threadId (routing behavior doesn't depend on memory).
 *
 * Run (lands in deployed Studio):
 *   DATABASE_URL='postgresql://…neon…' npx tsx src/scripts/runRoutingExperiment.ts
 * Dry run (local LibSQL only):
 *   npx tsx src/scripts/runRoutingExperiment.ts
 */
import 'dotenv/config';
import { ROUTING_CASES, isAmbiguous } from '../mastra/scorers/routingDataset';

// Must be set BEFORE mastra/index loads (hence the dynamic import below): forces memory off.
process.env.MEMORY_DISABLED ??= '1';

const NAME = 'skill-routing-golden';
const pgUrl = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
if (!pgUrl) {
  console.warn(
    '[warn] No DATABASE_URL/POSTGRES_URL — running against LOCAL LibSQL. Results will NOT appear\n' +
      '       in the deployed Studio. Set DATABASE_URL to the Neon URL to land them there.',
  );
}

const { mastra } = await import('../mastra/index');
const datasetsApi: any = (mastra as any).datasets;

// 1) find-or-create the dataset
const listed = await datasetsApi.list();
let rec = (listed.datasets ?? []).find((d: any) => d.name === NAME);
if (!rec) {
  rec = await datasetsApi.create({
    name: NAME,
    description: 'Golden set of user utterances -> acceptable skill loads (src/mastra/scorers/routingDataset.ts).',
    targetType: 'agent',
    targetIds: ['orchestrator'],
    // NOTE: do NOT set scorerIds here. Storage returns it as a JSON *string*, and
    // runExperiment does `[...datasetScorerIds]`, spreading it into characters ("[", '"', …)
    // -> "Scorer with id [ not found". We pass scorers to startExperiment instead.
  });
  console.log(`created dataset ${rec.id}`);
}
const ds = await datasetsApi.get({ id: rec.id });

// 2) ensure items (idempotent: only seed when empty)
const itemsRes = await ds.listItems({ page: 0, perPage: 100 });
const existingItems = Array.isArray(itemsRes) ? itemsRes : itemsRes.items ?? [];
if (existingItems.length === 0) {
  await ds.addItems({
    items: ROUTING_CASES.map((c) => ({
      input: c.u,
      groundTruth: { expected: c.expect, ambiguous: isAmbiguous(c) },
      metadata: { ambiguous: isAmbiguous(c), ...(c.note ? { note: c.note } : {}) },
    })),
  });
  console.log(`seeded ${ROUTING_CASES.length} items`);
} else {
  console.log(`dataset has ${existingItems.length} items`);
}

// 3) run the experiment (blocks until all items finish; memory is off so no threadId needed)
const expName = `routing-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '')}`;
console.log(`▶ running experiment "${expName}" (agent=orchestrator, scorer=skill-routing)…`);
const summary = await ds.startExperiment({
  name: expName,
  targetType: 'agent',
  targetId: 'orchestrator',
  scorers: ['skill-routing'],
  maxConcurrency: 4,
  maxRetries: 1,
});

// 4) report — overall + non-ambiguous accuracy (the headline number), plus any misses
let scoredHits = 0;
let scoredTotal = 0;
const misses: string[] = [];
for (const item of summary.results ?? []) {
  const gt = (item.groundTruth ?? {}) as { ambiguous?: boolean };
  const sc = item.scores?.find((s: any) => s.scorerId === 'skill-routing' || s.scorerName?.includes('routing'));
  const score = sc?.score ?? 0;
  if (!gt.ambiguous) {
    scoredTotal += 1;
    if (score === 1) scoredHits += 1;
    else misses.push(`✗ ${String(item.input).slice(0, 60)} — ${sc?.reason ?? item.error?.message ?? 'no skill loaded'}`);
  }
}

console.log(`\nexperiment ${summary.experimentId}: ${summary.status}`);
console.log(`items: ${summary.succeededCount}/${summary.totalItems} ran ok, ${summary.failedCount} failed`);
console.log(`routing accuracy (excl. ambiguous): ${scoredHits}/${scoredTotal} (${Math.round((scoredHits / (scoredTotal || 1)) * 100)}%)`);
if (misses.length) console.log('\nmisses:\n' + misses.join('\n'));
console.log(`\nStudio: ${pgUrl ? 'deployed app' : 'local libsql (dry run)'} → Datasets → ${NAME} → Experiments → ${expName}`);
process.exit(0);
