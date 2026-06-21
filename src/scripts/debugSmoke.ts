import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildDebugAgent, runDebug } from '../mastra/agents/debugAgent';
import { getVoiceflowTools } from '../mastra/mcp';
import { getSkillWorkspace } from '../mastra/workspace';
import { hasVoiceflowToken } from '../config/env';
import { extractLogs, parseTranscript, type ParsedTranscript } from '../lib/vfParseTranscript';

/**
 * Smoke test for the debug-agent.
 *
 *   npm run smoke:debug -- <transcript.json> ["reported issue"]
 *
 * Reads a raw Voiceflow transcript JSON (as returned by the MCP
 * `voiceflow_transcript` get), parses it with the ported vf-parse-transcript,
 * renders it, and asks the GLM debug-agent to diagnose it with structured output.
 * Works WITHOUT a VF MCP token (transcript supplied inline).
 */

function renderTranscript(p: ParsedTranscript): string {
  const lines: string[] = [];
  lines.push(`version: ${p.version}`);
  lines.push(`agents: ${p.metadata.agents.join(', ') || '(none)'}`);
  lines.push(`total_turns: ${p.metadata.total_turns}`);
  lines.push('');
  for (const [name, sys] of Object.entries(p.system_prompts)) {
    lines.push(`--- prompt.system for agent "${name}" ---`);
    lines.push(sys);
    lines.push('');
  }
  lines.push('--- turns ---');
  for (const t of p.turns) {
    lines.push(`[Turn ${t.turn_index}] agent=${t.agent_name}${t.model ? ` model=${t.model}` : ''}`);
    lines.push(`USER: ${t.user_message}`);
    lines.push(`AGENT: ${t.agent_response}`);
    for (const c of t.tool_calls) {
      lines.push(
        `  TOOL ${c.name} args=${JSON.stringify(c.arguments ?? {})} result=${JSON.stringify(c.result ?? {})}`,
      );
    }
    lines.push('');
  }
  return lines.join('\n');
}

async function main(): Promise<void> {
  const file = process.argv[2];
  const reportedIssue = process.argv[3] ?? '';
  if (!file) {
    console.error('usage: npm run smoke:debug -- <transcript.json> ["reported issue"]');
    process.exit(1);
  }

  const raw: unknown = JSON.parse(readFileSync(resolve(process.cwd(), file), 'utf8'));
  const parsed = parseTranscript(extractLogs(raw));
  const rendered = renderTranscript(parsed);
  console.info(`[smoke] parsed ${parsed.metadata.total_turns} turns, ${parsed.metadata.agents.length} agent(s)`);

  let tools: Record<string, unknown> = {};
  if (hasVoiceflowToken()) {
    try {
      tools = await getVoiceflowTools();
    } catch (err) {
      console.warn('[smoke] VF tools unavailable:', (err as Error).message);
    }
  }

  const workspace = await getSkillWorkspace().catch((e) => {
    console.warn('[smoke] skill workspace unavailable:', (e as Error).message);
    return undefined;
  });
  const agent = buildDebugAgent(tools, workspace);
  const prompt = [
    'Debug this Voiceflow transcript using your methodology.',
    `Reported issue: ${reportedIssue || '(not specified — identify the most significant failure)'}`,
    '',
    'The transcript is provided inline below; debug it directly.',
    '',
    '=== PARSED TRANSCRIPT ===',
    rendered,
  ].join('\n');

  const run = await runDebug(agent, prompt);

  console.log('\n=== DEBUG RESULT (structured) ===');
  console.log(JSON.stringify(run.result, null, 2));
  console.log(
    `\n[meta] usedFallbackParse=${run.usedFallbackParse} finishReason=${run.finishReason} reasoningChars=${run.reasoningText.length}`,
  );
  console.log('[meta] usage:', JSON.stringify(run.usage));

  if (!run.result) {
    console.log('\n[diag] no parseable result — raw text (last 800):');
    console.log(JSON.stringify(run.text.slice(-800)));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
