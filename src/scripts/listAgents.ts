import 'dotenv/config';
import { mastra } from '../mastra/index';

// Boot check: importing ./mastra/index constructs every agent (loads each
// agent .md + injected skills, builds models, wires the supervisor).
console.log('[boot] mastra constructed OK');

try {
  const agents = (mastra as unknown as { getAgents?: () => Record<string, unknown> }).getAgents?.();
  if (agents) {
    console.log('[boot] registered agents:', Object.keys(agents));
    for (const [key, a] of Object.entries(agents)) {
      const instr = (a as { instructions?: unknown }).instructions;
      const len = typeof instr === 'string' ? instr.length : 0;
      console.log(`   - ${key}: instructions ${len} chars`);
    }
  }
} catch (e) {
  console.log('[boot] introspection skipped:', (e as Error).message);
}
process.exit(0);
