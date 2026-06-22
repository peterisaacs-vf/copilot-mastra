import { mastra } from '../mastra/index';

/**
 * Trace how the agent loads skills across an agentic run: ordered per-step tool
 * calls (skill / skill_search / skill_read / delegation) + real GLM token usage.
 * Shows multi-skill loading and load→reason→load sequencing.
 * Usage: tsx src/scripts/skillTrace.ts ["<utterance>"]
 */
const CASES = process.argv[2]
  ? [process.argv[2]]
  : [
      "My booking agent keeps looping back to the start, AND the function that saves the appointment date isn't working. Sort it out.",
      'Build me a voice booking agent: it needs a function that calls our scheduling API and a knowledge base for FAQs.',
      'Do a full review of my agent — the prompts, the tool wiring, and the KB — and tell me the top things to fix.',
    ];

const agent = mastra.getAgent('orchestrator');

function describe(name: string, a: any): string {
  if (name === 'skill') return `skill(${a.name})`;
  if (name === 'skill_search') return `skill_search("${String(a.query ?? '').slice(0, 32)}")`;
  if (name === 'skill_read') return `skill_read(${String(a.path ?? a.file ?? '').split('/').slice(-2).join('/')})`;
  return name;
}

// Deep-walk the result collecting tool calls in traversal order (steps come first
// in key order, so this reflects call sequence), deduped by name+args.
function collect(node: any, out: { name: string; args: any }[], seen: Set<string>) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const n of node) collect(n, out, seen); return; }
  if (typeof node.toolName === 'string' && node.toolName) {
    const a = node.args ?? node.input ?? {};
    const key = node.toolName + ':' + JSON.stringify(a);
    if (!seen.has(key)) { seen.add(key); out.push({ name: node.toolName, args: a }); }
  }
  for (const k in node) collect(node[k], out, seen);
}

for (const u of CASES) {
  const r: any = await agent.generate(u, { maxSteps: 8 } as any);
  console.log('\n━━━ ' + u.slice(0, 90));
  const calls: { name: string; args: any }[] = [];
  collect(r, calls, new Set());
  const skills = calls.filter((c) => c.name === 'skill').map((c) => c.args.name);
  console.log('  call sequence: ' + (calls.length ? calls.map((c) => describe(c.name, c.args)).join('  →  ') : 'none'));
  console.log(`  → skills loaded: [${skills.join(', ') || 'none'}]  (${skills.length} skills, ${(r.steps ?? []).length} steps)`);
  const usage = r.totalUsage ?? r.usage ?? {};
  console.log(`  → tokens: in=${usage.inputTokens} out=${usage.outputTokens} cached=${usage.cachedInputTokens ?? 0}`);
}
process.exit(0);

