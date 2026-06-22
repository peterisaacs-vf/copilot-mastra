import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { analyzeTranscriptsWorkflow } from '../mastra/workflows/analyzeTranscripts';

/**
 * Smoke test for the analyze-transcripts workflow (in-process fan-out).
 *   npm run smoke:analyze -- <id=path.json> [<id=path.json> ...]
 * Each transcript file is a raw Voiceflow transcript JSON. Runs without the VF
 * token (transcripts supplied inline).
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('usage: npm run smoke:analyze -- <id=path.json> [<id=path.json> ...]');
    process.exit(1);
  }
  const transcripts = args.map((arg, i) => {
    const eq = arg.indexOf('=');
    const id = eq > 0 ? arg.slice(0, eq) : `t${i + 1}`;
    const path = eq > 0 ? arg.slice(eq + 1) : arg;
    return { id, raw: JSON.parse(readFileSync(resolve(process.cwd(), path), 'utf8')) as unknown };
  });
  console.error(`[analyze] ${transcripts.length} transcripts: ${transcripts.map((t) => t.id).join(', ')}`);

  const run = await analyzeTranscriptsWorkflow.createRun();
  const res = (await run.start({
    inputData: { transcripts, focus: 'booking completion and abandonment', maxDeepReads: 2 },
  })) as { status?: string; result?: unknown; error?: unknown; steps?: unknown };

  console.error('[analyze] status:', res.status);
  if (res.status === 'success') {
    console.log(JSON.stringify(res.result, null, 2));
  } else {
    console.error('[analyze] non-success — error:', JSON.stringify(res.error, null, 2));
    console.error('[analyze] steps:', JSON.stringify(res.steps, null, 2).slice(0, 2000));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
