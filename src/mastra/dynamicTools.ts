/**
 * Tools for an Agent can be a static map OR a function resolved per-request
 * (Mastra `DynamicArgument`). We use the function form for the Voiceflow MCP
 * toolset so the tools can be loaded lazily and re-loaded after the user consents
 * (or after a transient cold-start connect failure) WITHOUT a redeploy — Mastra
 * re-invokes the resolver on every generate/stream call.
 */
export type ToolsArg =
  | Record<string, any>
  | ((ctx?: any) => Record<string, any> | Promise<Record<string, any>>);

/** Normalize a tools arg (static object or resolver fn) to an async resolver. */
export function resolveToolsArg(t: ToolsArg = {}): (ctx?: any) => Promise<Record<string, any>> {
  return typeof t === 'function' ? async (ctx?: any) => (await t(ctx)) ?? {} : async () => t;
}
