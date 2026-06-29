import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { getVoiceflowTools } from '../mastra/mcp';

/**
 * grep_transcripts — full-text pattern search across conversation transcripts.
 *
 * The Voiceflow MCP can filter transcripts by structured fields (date, tags, eval results)
 * but has no full-text search over the actual dialogue. This tool fills that gap: it pulls a
 * candidate set server-side (via voiceflow_transcript search + get in `summary` format),
 * regex-scans the conversation text inside the tool, and returns ONLY the hits — transcript
 * id, match count, and the matching lines. The raw transcripts never enter the model's
 * context, so it scales to many transcripts where reading them one-by-one would not.
 *
 * Composable: the analyze- and debug-agents grep for a failure pattern, then deep-read just
 * the hits. Also exposed directly for ad-hoc "find every chat where the bot said X".
 */

// One cached MCP toolset for the tool's own fetches (separate from the agents' toolset).
// Reset on failure so a dropped connection self-heals on the next call.
let _toolset: Record<string, any> | undefined;
async function transcriptTool(): Promise<any> {
  if (!_toolset) _toolset = (await getVoiceflowTools()) as Record<string, any>;
  const t =
    _toolset['voiceflow_transcript'] ||
    Object.entries(_toolset).find(([k]) => /(^|_)transcript$/.test(k))?.[1];
  if (!t?.execute) throw new Error('voiceflow_transcript tool not available');
  return t;
}

/** Coerce an MCP tool result into searchable text (handles string, {content:[{text}]}, object). */
function asText(v: any): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (Array.isArray(v?.content)) return v.content.map((c: any) => c?.text ?? '').join('\n');
  if (typeof v?.text === 'string') return v.text;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/** Pull transcript id strings out of a search result of unknown shape. */
function idsFrom(result: any): string[] {
  const arr = Array.isArray(result)
    ? result
    : result?.transcripts ?? result?.data ?? result?.results ?? [];
  return (Array.isArray(arr) ? arr : [])
    .map((r: any) => r?.id ?? r?._id ?? r?.transcriptID ?? r?.transcript_id)
    .filter((x: any): x is string => typeof x === 'string');
}

/** Run an async mapper over items with a concurrency cap. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const idx = i++;
      if (idx >= items.length) return;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}

export const grepTranscriptsTool = createTool({
  id: 'grep_transcripts',
  description:
    'Full-text search across conversation transcripts — the missing "grep" for logs. Give a ' +
    'pattern and it scans the dialogue of a candidate set and returns ONLY the matches ' +
    '(transcript id, count, and the matching lines) — never the full transcripts, so it scales. ' +
    'Use it to find or count where a pattern occurs ("transfer to a human", "I don\'t know", a ' +
    'specific error), then deep-read just the hits. Narrow the candidate set with a date range ' +
    '(and/or pass explicit transcriptIDs you already found via search). The pattern is a ' +
    'JavaScript regex, case-insensitive; plain words work too.',
  inputSchema: z.object({
    projectID: z.string().describe('The Voiceflow project to search.'),
    pattern: z.string().describe('Regex (case-insensitive) or plain text to search for in the dialogue.'),
    transcriptIDs: z
      .array(z.string())
      .optional()
      .describe('Specific transcripts to scan. If omitted, the tool searches by date range instead.'),
    startDate: z.string().optional().describe('ISO date-time lower bound (when no transcriptIDs given).'),
    endDate: z.string().optional().describe('ISO date-time upper bound (when no transcriptIDs given).'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(60)
      .optional()
      .describe('Max transcripts to scan (default 25). The set is capped to keep it bounded.'),
  }),
  execute: async ({ projectID, pattern, transcriptIDs, startDate, endDate, limit }) => {
    const cap = limit ?? 25;
    // Compile the pattern as a case-insensitive regex; fall back to a literal match if invalid.
    let re: RegExp;
    try {
      re = new RegExp(pattern, 'i');
    } catch {
      re = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    }

    let tool: any;
    try {
      tool = await transcriptTool();
    } catch (e: any) {
      _toolset = undefined; // reset so a transient failure self-heals next call
      return { ok: false, error: String(e?.message ?? e), hits: [] };
    }

    // Resolve the candidate set.
    let ids = transcriptIDs ?? [];
    if (!ids.length) {
      try {
        const search = await tool.execute({
          operation: 'search',
          projectID,
          ...(startDate ? { startDate } : {}),
          ...(endDate ? { endDate } : {}),
          limit: cap,
        });
        ids = idsFrom(search);
      } catch (e: any) {
        _toolset = undefined;
        return { ok: false, error: `search failed: ${String(e?.message ?? e)}`, hits: [] };
      }
    }
    const capped = ids.length > cap;
    ids = ids.slice(0, cap);
    if (!ids.length) {
      return { ok: true, pattern, scanned: 0, matched: 0, hits: [], note: 'No transcripts in range.' };
    }

    // Fetch (summary) + scan, with bounded concurrency. Content stays server-side.
    const scanned = await mapLimit(ids, 8, async (id) => {
      try {
        const res = await tool.execute({ operation: 'get', projectID, transcript_id: id, format: 'summary' });
        const text = asText(res);
        const lines = text.split('\n');
        const snippets: string[] = [];
        for (const line of lines) {
          if (re.test(line)) {
            snippets.push(line.trim().slice(0, 240));
            if (snippets.length >= 5) break; // a few exemplar lines per transcript is enough
          }
        }
        return snippets.length ? { transcript_id: id, matches: snippets.length, snippets } : null;
      } catch {
        return { transcript_id: id, error: true } as any;
      }
    });

    const hits = scanned.filter((h): h is { transcript_id: string; matches: number; snippets: string[] } => !!h && !(h as any).error);
    const errored = scanned.filter((h) => (h as any)?.error).length;
    return {
      ok: true,
      pattern,
      scanned: ids.length,
      matched: hits.length,
      ...(capped ? { capped: true, note: `Scanned the first ${cap}; more matched the range — narrow the dates or raise limit.` } : {}),
      ...(errored ? { errored } : {}),
      hits,
    };
  },
});
