/**
 * wireRoutingExperiment.ts — push the skill-routing golden set into a *deployed* Mastra app
 * as a Dataset (and optionally run an Experiment), so eval history lands in Studio's
 * Datasets / Experiments tabs instead of only in script stdout. This closes the
 * "eval runs aren't visible in Studio" gap.
 *
 * Why a script and not just `mastra api`: the CLI can create datasets and run experiments,
 * but has NO "add items" command — the 28 golden cases can only be loaded over the REST
 * API. This drives the exact same endpoints `mastra api` uses (paths confirmed via
 * `mastra api dataset create --schema`), and imports only the pure data file, so it needs
 * no GLM key or DATABASE_URL locally — it just talks HTTP to the deployed app.
 *
 * Usage:
 *   npx tsx src/scripts/wireRoutingExperiment.ts [--url <base>] [--name <ds>] [--run]
 *     --url   deployed base URL (default https://copilot-mastra.vercel.app)
 *     --name  dataset name (default skill-routing-golden)
 *     --run   also start an experiment after syncing items (see the ⚠️ below)
 *
 * Idempotent: finds-or-creates the dataset by name, and only adds items when it's empty.
 *
 * ⚠️ --run caveat: the deployed orchestrator uses thread-scoped Observational Memory, which
 * requires a threadId on every call. The REST experiment runner (targetType:'agent') does
 * NOT inject a per-item thread (see @mastra/core "evals with memory" docs), so --run against
 * a memory-enabled deploy fails every item with "ObservationalMemory ... requires a
 * threadId". To actually run it: deploy with OM_DISABLED=1 (routing doesn't use memory), or
 * run a local startExperiment with a per-item-thread task. Syncing the dataset always works.
 */
import { ROUTING_CASES, isAmbiguous } from '../mastra/scorers/routingDataset';

const argVal = (flag: string): string | undefined => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const hasFlag = (flag: string) => process.argv.includes(flag);

const BASE = (argVal('--url') ?? process.env.COPILOT_URL ?? 'https://copilot-mastra.vercel.app').replace(/\/+$/, '');
const NAME = argVal('--name') ?? 'skill-routing-golden';
const API = `${BASE}/api`;

async function api(method: string, path: string, body?: unknown): Promise<any> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = text;
  }
  if (!res.ok) {
    const msg = typeof json === 'string' ? json : JSON.stringify(json);
    throw new Error(`${method} ${path} -> ${res.status} ${msg.slice(0, 300)}`);
  }
  return json;
}

// 1) find-or-create the dataset (idempotent)
const list = await api('GET', '/datasets?page=0&perPage=100');
let ds = (list.datasets ?? []).find((d: any) => d.name === NAME);
if (ds) {
  console.log(`✓ dataset "${NAME}" already exists (${ds.id})`);
} else {
  ds = await api('POST', '/datasets', {
    name: NAME,
    description:
      'Golden set of user utterances -> acceptable skill loads. Source: src/mastra/scorers/routingDataset.ts. Score with the skill-routing scorer.',
    targetType: 'agent',
    targetIds: ['orchestrator'],
    // NOTE: scorerIds intentionally omitted — storage returns it as a JSON *string* and the
    // experiment runner spreads it into characters ("Scorer with id [ not found"). Pass the
    // scorer in the experiment-run body instead (see the CLI hint printed below).
  });
  console.log(`✓ created dataset "${NAME}" (${ds.id})`);
}

// 2) sync items — only when the dataset is empty (avoids duplicate version churn)
const itemsRes = await api('GET', `/datasets/${ds.id}/items?page=0&perPage=100`);
const existing = Array.isArray(itemsRes)
  ? itemsRes.length
  : itemsRes.pagination?.total ?? itemsRes.items?.length ?? 0;

if (existing > 0) {
  console.log(`✓ items already present (${existing}); skipping add`);
} else {
  const items = ROUTING_CASES.map((c) => ({
    input: c.u,
    groundTruth: { expected: c.expect, ambiguous: isAmbiguous(c) },
    metadata: { ambiguous: isAmbiguous(c), ...(c.note ? { note: c.note } : {}) },
  }));
  // The REST API exposes only single-item add (no /items/bulk route), so we loop.
  // Each add bumps a dataset version — expected; experiments default to the latest.
  let added = 0;
  for (const it of items) {
    await api('POST', `/datasets/${ds.id}/items`, it);
    process.stderr.write(`\r  adding items… ${++added}/${items.length}`);
  }
  process.stderr.write('\n');
  console.log(`✓ added ${added} items`);
}

// 3) optionally start an experiment (see ⚠️ caveat in the header)
if (hasFlag('--run')) {
  console.log('▶ starting experiment (agent=orchestrator, scorer=skill-routing)…');
  const summary = await api('POST', `/datasets/${ds.id}/experiments`, {
    targetType: 'agent',
    targetId: 'orchestrator',
    scorerIds: ['skill-routing'],
    maxConcurrency: 4,
  });
  const s = summary.data ?? summary;
  console.log(
    `experiment ${s.experimentId ?? '?'}: ${s.status} — ${s.succeededCount ?? 0}/${s.totalItems ?? '?'} ok, ${s.failedCount ?? 0} failed`,
  );
  if (s.failedCount && s.results?.[0]?.error) {
    console.log(`first error: ${typeof s.results[0].error === 'string' ? s.results[0].error : s.results[0].error?.message}`);
  }
}

console.log(`\nStudio:  ${BASE}/   → Datasets → ${NAME}`);
console.log(
  `CLI run: npx mastra api experiment run ${ds.id} '{"targetType":"agent","targetId":"orchestrator","scorerIds":["skill-routing"]}' --url ${BASE}`,
);
