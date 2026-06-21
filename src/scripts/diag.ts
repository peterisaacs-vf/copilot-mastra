import 'dotenv/config';
import { z } from 'zod';
import { Agent } from '@mastra/core/agent';
import { mainModel } from '../mastra/models';

/** Isolate the hang: is plain generation fast when output is bounded? Does
 *  structuredOutput yield res.object? Each test is time- and token-bounded. */

async function run<T>(label: string, fn: (signal: AbortSignal) => Promise<T>, ms = 50000): Promise<void> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ms);
  const t0 = Date.now();
  console.error(`\n[${label}] start`);
  try {
    const out = await fn(ac.signal);
    console.error(`[${label}] DONE in ${Date.now() - t0}ms`);
    console.error(`[${label}] =>`, JSON.stringify(out));
  } catch (e) {
    console.error(`[${label}] ERROR after ${Date.now() - t0}ms:`, (e as Error)?.message ?? e);
  } finally {
    clearTimeout(timer);
  }
}

const agent = new Agent({
  id: 'diag',
  name: 'diag',
  instructions: 'You are terse. Answer in one short line.',
  model: mainModel,
});

// A: plain generate, hard token cap — should return fast.
await run('A plain capped', async (signal) => {
  const res = await agent.generate('Reply with exactly: OK', {
    maxSteps: 1,
    modelSettings: { maxOutputTokens: 64 },
    abortSignal: signal,
  });
  return { text: res.text, reasoningLen: (res as { reasoningText?: string }).reasoningText?.length ?? 0 };
});

const diagSchema = z.object({
  rootCause: z.string(),
  category: z.enum(['prompt', 'tool', 'other']),
});
const diagPrompt =
  'The prompt hardcodes price $19.99. The agent said $19.99. The user says the real price differs. Diagnose.';

// B: structuredOutput WITHOUT injection (baseline).
await run('B structured (no inject)', async (signal) => {
  const res = await agent.generate(diagPrompt, {
    maxSteps: 1,
    modelSettings: { maxOutputTokens: 1536 },
    abortSignal: signal,
    structuredOutput: { schema: diagSchema, errorStrategy: 'warn' },
  });
  return { object: res.object ?? '<<undefined>>', text: res.text?.slice(0, 160) };
});

// C: structuredOutput WITH jsonPromptInjection — expect res.object to populate.
await run('C structured (inject)', async (signal) => {
  const res = await agent.generate(diagPrompt, {
    maxSteps: 1,
    modelSettings: { maxOutputTokens: 1536 },
    abortSignal: signal,
    structuredOutput: { schema: diagSchema, errorStrategy: 'warn', jsonPromptInjection: true },
  });
  return { object: res.object ?? '<<undefined>>', text: res.text?.slice(0, 160) };
});

process.exit(0);
