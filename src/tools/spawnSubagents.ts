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
    'Run several INDEPENDENT sub-tasks in PARALLEL, each handled by its own build sub-agent, ' +
    'and get all results back together. Use this to fan out genuinely independent work that ' +
    'would otherwise run one-by-one (e.g. draft three playbooks at once, explore options in ' +
    'parallel). Do NOT use it for a single task, or for steps that depend on each other — ' +
    'delegate those normally. Each task prompt must be self-contained: the sub-agent cannot ' +
    'see this conversation, so include every detail it needs.',
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
      .min(1)
      .max(6)
      .describe('Independent sub-tasks to run concurrently (max 6).'),
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
