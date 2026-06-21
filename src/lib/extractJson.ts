/**
 * Extract the first JSON object from model output that may be wrapped in
 * ```json fences or preceded/followed by prose. Reasoning models (GLM) often
 * emit fenced JSON, which trips strict structured-output parsers.
 */
export function extractJsonObject(text: string): unknown | null {
  if (!text) return null;
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence && fence[1]) t = fence[1].trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(t.slice(start, end + 1));
  } catch {
    return null;
  }
}
