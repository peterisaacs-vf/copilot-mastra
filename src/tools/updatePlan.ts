import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

/**
 * Lightweight live checklist for multi-step work.
 *
 * Mastra's native task tools require a memory-backed thread + a registered `threadState`
 * store, which a delegated sub-agent doesn't have (the tools just error there). This tool
 * sidesteps all of that: it carries no server-side state — the agent calls it with the FULL
 * current plan each time anything changes, and that list rides out on the tool-call args
 * (forwarded to the client wrapped in `tool-output` during delegation). The /demo widget
 * reads those args and renders/updates the checklist; the widget is effectively the store.
 *
 * No persistence across turns — fine for a within-turn build checklist. Keep the item set
 * stable across calls (same `content`/`id`) so the UI updates in place instead of redrawing.
 */
export const updatePlanTool = createTool({
  id: 'update_plan',
  description:
    'Maintain a visible plan/checklist for the user during multi-step work. Call it once at the ' +
    'start with the whole plan, then again every time a step changes status. ALWAYS pass the ' +
    'COMPLETE list of steps each time (not just the changed one). Keep exactly one step ' +
    'in_progress. Phrase steps as user-facing outcomes ("Add the booking flow"), not tool calls.',
  inputSchema: z.object({
    tasks: z
      .array(
        z.object({
          content: z.string().describe('Short, user-facing description of the step.'),
          status: z.enum(['pending', 'in_progress', 'completed']),
        }),
      )
      .describe('The complete, ordered checklist as it stands right now.'),
  }),
  execute: async ({ tasks }) => {
    const list = tasks ?? [];
    const done = list.filter((t) => t.status === 'completed').length;
    // Echo the list back so it's available on both the tool-call args and the tool-result.
    return { ok: true, total: list.length, completed: done, tasks: list };
  },
});
