import 'dotenv/config';
import { Workspace, LocalFilesystem } from '@mastra/core/workspace';
import { Agent } from '@mastra/core/agent';
import { projectRoot } from '../lib/loadPrompt';
import { mainModel } from '../mastra/models';

// Empirical check: does a Workspace discover our SKILL.md files, and does an
// Agent given that workspace pick up skill tooling? (No GLM calls needed.)
const ws = new Workspace({
  filesystem: new LocalFilesystem({ basePath: projectRoot() }),
  skills: ['skills'],
});
await ws.init();

const skills = await ws.skills?.list();
console.log(`discovered skills: ${skills?.length ?? 0}`);
for (const s of (skills ?? []).slice(0, 60)) {
  const o = s as unknown as Record<string, unknown>;
  console.log(`  - ${o.name ?? o.id ?? JSON.stringify(o).slice(0, 80)}`);
}

try {
  const found = await ws.skills?.search?.('debug a failing transcript');
  console.log(
    'search "debug a failing transcript" ->',
    (found ?? []).slice(0, 3).map((r) => {
      const o = r as unknown as Record<string, unknown>;
      return o.name ?? (o.skill as Record<string, unknown>)?.name ?? 'n/a';
    }),
  );
} catch (e) {
  console.log('skills.search threw:', (e as Error).message);
}

const agent = new Agent({ id: 'ws-test', name: 'ws-test', instructions: 'test', model: mainModel, workspace: ws });
const anyAgent = agent as unknown as { hasOwnWorkspace?: () => boolean };
console.log('agent.hasOwnWorkspace():', anyAgent.hasOwnWorkspace?.());

await ws.destroy();
process.exit(0);
