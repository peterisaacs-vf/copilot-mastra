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
    // Stable, deterministic id/name. On a serverless target (Vercel) each function
    // instance builds its own copy of this workspace; without a fixed id each one
    // gets a random `ws-<rand>` id, and Studio's "list workspaces → fetch that id's
    // skills" sequence can land on a *different* instance whose id doesn't match →
    // "Skills Not Configured". A constant id makes every instance interchangeable.
    id: 'copilot-skills',
    name: 'Voiceflow Copilot Skills',
    filesystem: new LocalFilesystem({ basePath: projectRoot() }),
    skills: ['skills'],
    bm25: true,
  });
  await ws.init();
  cached = ws;
  return ws;
}
