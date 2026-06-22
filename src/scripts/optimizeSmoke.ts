import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { promptOptimizerWorkflow } from '../mastra/workflows/promptOptimizer';
import { extractLogs, parseTranscript } from '../lib/vfParseTranscript';

/**
 * Smoke test for the prompt-optimizer (GEPA) workflow.
 *   npm run smoke:optimize -- <transcript.json>
 * Optimizes the real "Schedule Appointment" prompt from the given transcript
 * against a definition encoding the issues analyze-transcripts found. Token-less.
 */
async function main(): Promise<void> {
  const file = process.argv[2];
  if (!file) {
    console.error('usage: npm run smoke:optimize -- <transcript.json>');
    process.exit(1);
  }
  const parsed = parseTranscript(extractLogs(JSON.parse(readFileSync(resolve(process.cwd(), file), 'utf8'))));
  const systemPrompt =
    parsed.system_prompts['Schedule Appointment'] ?? Object.values(parsed.system_prompts)[0] ?? '';
  console.error(`[optimize] system prompt: ${systemPrompt.length} chars`);

  const definition = {
    agent: { name: 'Schedule Appointment', project: 'Mr Appliance', type: 'response', model: 'glm-5p2', version: 'v3' },
    purpose: {
      summary: 'Book an appliance/plumbing service appointment, collecting required details and confirming a time.',
      goals: ['Complete the booking without dead-ends', 'Accept information in any order'],
    },
    scope: { handles: ['booking', 'rescheduling'], does_not_handle: ['billing disputes'] },
    tone: { style: 'warm, concise, professional', rules: ['One question per turn', 'No unprompted apologies'] },
    hard_rules: {
      blockers: [
        { id: 'no_loop', rule: 'Never ask for the same field more than twice in a row; advance and collect missing fields at confirmation.' },
        { id: 'end_on_exit', rule: 'If the caller abandons or says goodbye, call the End tool — never say goodbye without ending.' },
      ],
    },
    success_metrics: { primary: 'Booking completed (or cleanly handed off) without abandonment', secondary: ['No repeated-question loops'] },
    rubric_weights: { accuracy: 40, tone: 20, completeness: 30, safety: 10 },
  };

  const examples = [
    {
      userTurns: [
        'I have a copper pipe leaking under my kitchen sink',
        'Residential',
        '60614',
        'No, first time',
        "It's a copper pipe under the kitchen sink, no warranty",
        "None of those times work, I'm only free late evenings",
      ],
      context: 'New caller who volunteers details out of order and never gives a name.',
    },
    {
      userTurns: ['I need to book an appliance repair', "Actually, never mind — I'll deal with it later. Bye"],
      context: 'Caller abandons before the booking completes.',
    },
  ];

  const run = await promptOptimizerWorkflow.createRun();
  const res = (await run.start({
    inputData: {
      systemPrompt,
      definition,
      examples,
      maxRounds: 1,
      candidatesPerRound: 2,
      focus: 'accept out-of-order intake without looping, and call End on abandonment',
    },
  })) as { status?: string; result?: unknown; error?: unknown };

  console.error('[optimize] status:', res.status);
  if (res.status === 'success') {
    const r = res.result as Record<string, unknown>;
    // print everything except the full bestPrompt inline (show its length + a head)
    const bestPrompt = String(r.bestPrompt ?? '');
    console.log(JSON.stringify({ ...r, bestPrompt: `${bestPrompt.length} chars` }, null, 2));
    console.log('\n=== best prompt (first 1200 chars) ===\n' + bestPrompt.slice(0, 1200));
  } else {
    console.error('[optimize] non-success:', JSON.stringify(res.error, null, 2));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
