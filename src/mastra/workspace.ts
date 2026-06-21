import { Workspace, LocalFilesystem } from '@mastra/core/workspace';
import { projectRoot } from '../lib/loadPrompt';

let cached: Workspace | undefined;

/**
 * Shared Workspace that exposes every SKILL.md under skills/ as on-demand skill
 * tools (skill / skill_read / skill_search) — Mastra auto-wires the skill
 * processors when an agent is given a workspace with skills. bm25 enables
 * keyword skill search without needing an embedder. This replaces injecting
 * skill bodies into instructions (lower per-call tokens; full 37-skill catalog).
 */
export async function getSkillWorkspace(): Promise<Workspace> {
  if (cached) return cached;
  const ws = new Workspace({
    filesystem: new LocalFilesystem({ basePath: projectRoot() }),
    skills: ['skills'],
    bm25: true,
  });
  await ws.init();
  cached = ws;
  return ws;
}
