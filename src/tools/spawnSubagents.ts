import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

/**
 * Parallel sub-agent fan-out.
 *
 * Runs several INDEPENDENT sub-tasks concurrently, each handled by its own build sub-agent
 * (mastra.getAgent('build-agent').generate). The Voiceflow MCP toolset is ambient (a global
 * cache whose token refreshes per request), so each spawned agent can do real Voiceflow work
 * without any context threading. Each task runs on its own throwaway thread so parallel runs
 * don't collide in memory.
 *
 * This is buffered, not streamed: the tasks run in parallel and all results return together
 * when the tool resolves (the orchestrator then summarizes them). Use only for genuinely
 * independent work that would otherwise run one-at-a-time — drafting several playbooks at
 * once, exploring options in parallel. Dependent or single steps should be delegated normally.
 */
export const spawnSubagentsTool = createTool({
  id: 'spawn_subagents',
  description:
    'Run 2+ INDEPENDENT deliverables in PARALLEL, each produced by its own sub-agent, and get ' +
    'all results back together. ' +
    'NOT for building or editing one agent: the parts of a single agent (project, prompt, ' +
    'playbooks, KB, routing) share one project and depend on each other — that is one job, so ' +
    'use the build-agent (normal delegation), which also streams its work live. ' +
    'spawn_subagents is ONLY for genuinely separate artifacts that do NOT share a project or ' +
    'depend on each other — e.g. drafting several standalone prompt options to compare, or ' +
    'researching multiple topics at once. If in doubt, delegate normally. ' +
    'Each task prompt must be fully self-contained — the sub-agent cannot see this conversation.',
  inputSchema: z.object({
    tasks: z
      .array(
        z.object({
          title: z.string().describe('Short label for this sub-task, shown to the user.'),
          prompt: z
            .string()
            .describe('Complete, self-contained instruction for this sub-agent — all context included.'),
        }),
      )
      // Floor of 2: a single task is never a fan-out — it should be a normal delegation
      // (which streams live). This makes it structurally impossible to misuse for one build.
      .min(2)
      .max(6)
      .describe('Two or more INDEPENDENT deliverables to run concurrently (max 6).'),
  }),
  execute: async ({ tasks }, context: any) => {
    const mastra = context?.mastra;
    if (!mastra?.getAgent) {
      return { ok: false, error: 'No agent runtime available.', results: [] };
    }
    const base = context?.toolCallId || 'spawn';
    const results = await Promise.all(
      tasks.map(async (t, i) => {
        try {
          const agent = mastra.getAgent('build-agent');
          // Throwaway, per-task thread so concurrent runs don't collide in memory.
          const res = await agent.generate(t.prompt, {
            memory: { thread: `${base}-${i}`, resource: `${base}-${i}` },
          });
          return { title: t.title, ok: true, summary: res?.text ?? '' };
        } catch (e: any) {
          return { title: t.title, ok: false, summary: String(e?.message ?? e).slice(0, 300) };
        }
      }),
    );
    return { ok: true, count: results.length, results };
  },
});
