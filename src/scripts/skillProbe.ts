import { mastra } from '../mastra/index';

/**
 * Probe: run one utterance through an agent and surface how skill-loading shows up
 * (explicit skill/skill_search/skill_read tool calls vs anything auto-injected).
 * Usage: tsx src/scripts/skillProbe.ts "<agentId>" "<utterance>"
 */
const agentId = process.argv[2] ?? 'orchestrator';
const utterance = process.argv[3] ?? 'My booking agent keeps looping back to the welcome message and never completes a booking. Why?';

const agent = mastra.getAgent(agentId as any);
const r: any = await agent.generate(utterance, { maxSteps: 4 } as any);

console.log('=== result keys ===', Object.keys(r).join(','));

const tools: string[] = [];
(function walk(o: any) {
  if (!o || typeof o !== 'object') return;
  if (Array.isArray(o)) return o.forEach(walk);
  if (o.toolName) tools.push(`${o.toolName}  ${JSON.stringify(o.args ?? o.input ?? {}).slice(0, 120)}`);
  for (const k in o) walk(o[k]);
})(r);
console.log('=== tool calls (toolName + args) ===');
console.log(tools.length ? [...new Set(tools)].join('\n') : '(none)');

// Did a skill get auto-injected into the system/context (no tool call)?
const sys = JSON.stringify(r.request ?? r.messages ?? '').toLowerCase();
const SKILLS = ['debug','audit-wiring','wiring-architect','build-agent','functions','knowledge-base','prompting','test','voice','environments','document','prompt-optimizer','agent-architecture','voiceflow-overview'];
console.log('=== skill names appearing in request/system context ===');
console.log(SKILLS.filter((s) => sys.includes(s)).join(', ') || '(none)');

console.log('=== text (first 200) ===', (r.text ?? '').slice(0, 200));
process.exit(0);
