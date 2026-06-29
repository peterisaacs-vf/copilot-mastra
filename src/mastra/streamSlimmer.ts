/**
 * Output-stream slimmer for the orchestrator's live stream (the /demo widget + Studio).
 *
 * When the orchestrator delegates to a worker (build-agent, debug-agent, …), the worker's
 * ENTIRE stream is forwarded to the client wrapped in `tool-output` chunks. The worker's
 * per-step lifecycle chunks — `step-start`, `step-finish`, and its own terminal `finish` —
 * each serialize the full accumulated message/usage state, so they balloon as the build
 * grows: a single medium delegated build streamed ~57 MB, of which ~49 MB was these wrapped
 * lifecycle chunks. Nothing in any UI renders them, but on mobile that volume was enough to
 * cause mid-build connection drops (the stream just looked frozen, then the socket died).
 *
 * This drops ONLY those wrapped sub-agent lifecycle chunks (returning `null` omits a chunk
 * from the outbound stream). Everything a client actually shows — reasoning, text, tool
 * calls, tool results, memory chips — passes through untouched, as do the orchestrator's own
 * top-level chunks, including the terminal `finish` the client needs to know the run ended.
 * Filtering is outbound-only; the agent's internal step accounting and memory writes are
 * unaffected. Net effect measured end-to-end: ~57 MB -> ~8 MB on a medium build (~7x).
 */
const DROP_WRAPPED_INNER = new Set(['step-start', 'step-finish', 'finish']);

export function makeStreamSlimmer() {
  return {
    id: 'demo-stream-slimmer',
    async processOutputStream({ part }: { part: any }): Promise<any | null> {
      if (part?.type === 'tool-output' && DROP_WRAPPED_INNER.has(part?.payload?.output?.type)) {
        return null;
      }
      return part;
    },
  };
}
