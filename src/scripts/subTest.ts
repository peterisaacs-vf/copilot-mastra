import { mastra } from '../mastra/index';

/** Does sub-agent memory save work when the orchestrator HAS a thread/resource? */
const agent = mastra.getAgent('orchestrator');
const thread = 'subtest-' + Date.now();
const resource = 'subtest-resource';
const r: any = await agent.generate(
  'Please hand this to the debug agent: a transcript at https://creator.voiceflow.com/t/abc where the bot gave a wrong answer. What went wrong?',
  { memory: { thread, resource }, maxSteps: 6 } as any,
);
const tools: string[] = [];
(function w(o: any) { if (!o || typeof o !== 'object') return; if (Array.isArray(o)) return o.forEach(w); if (o.toolName) tools.push(o.toolName); for (const k in o) w(o[k]); })(r);
console.log('DELEGATED/skills:', [...new Set(tools)].filter((t) => /^agent-|skill/.test(t)).join(', ') || '(none)');
console.log('parent thread:', thread, 'resource:', resource);
console.log('text:', (r.text ?? '').slice(0, 120));
process.exit(0);
