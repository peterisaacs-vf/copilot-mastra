import { createScorer } from '@mastra/core/evals';
import { judgeModel } from '../models';
import { extractLoadedSkills } from './skillRouting';

/**
 * LLM-judged routing scorer for LIVE traffic (no ground truth). Where `skill-routing`
 * needs a golden `expected` set, this asks a judge (the cheap triage model) whether the
 * skill(s) the orchestrator loaded were appropriate for the user's actual message — so it
 * can score real sessions continuously once attached to an agent with sampling, and feeds
 * the build→measure→improve loop / Studio trace scoring.
 *
 * Registered but NOT auto-attached: Mastra-level registration only makes it available
 * (no per-run cost). Attach to the orchestrator with a sampling rate to score live runs.
 */
export const skillRoutingJudgeScorer = createScorer({
  id: 'skill-routing-judge',
  name: 'Skill Routing (LLM judge)',
  description:
    'LLM-judged routing quality for live runs (no ground truth): was the loaded skill appropriate for the user request?',
  type: 'agent',
  judge: {
    model: judgeModel,
    instructions:
      'You evaluate a Voiceflow copilot router. Given a user message and which skill(s) the ' +
      'router loaded, judge whether the choice is appropriate. Be lenient when the message is ' +
      'vague or conversational; be strict when a clearly-named task was routed to an unrelated ' +
      'skill (or nothing was loaded for a clear task).',
    jsonPromptInjection: true, // triage model lacks reliable native structured output
  },
})
  .preprocess(({ run }) => {
    const loaded = [...extractLoadedSkills(run)];
    const msgs = (run as any).inputData?.inputMessages ?? (run as any).input ?? [];
    const userMsg = Array.isArray(msgs)
      ? msgs.map((m: any) => (typeof m === 'string' ? m : (m?.content ?? ''))).join(' ').trim()
      : String(msgs ?? '');
    return { loaded, userMsg };
  })
  .analyze({
    description: 'Judge whether the loaded skill(s) fit the user request.',
    outputSchema: {
      type: 'object',
      properties: { appropriate: { type: 'boolean' }, reason: { type: 'string' } },
      required: ['appropriate', 'reason'],
      additionalProperties: false,
    },
    createPrompt: ({ results }) => {
      const { userMsg, loaded } = results.preprocessStepResult ?? {};
      return [
        `User message: "${userMsg}"`,
        `Router loaded skill(s): [${(loaded ?? []).join(', ') || 'none'}]`,
        'Available skills: debug, audit-wiring, wiring-architect, build-agent, functions, prompting,',
        'prompt-optimizer, knowledge-base, voice, test, environments, document, agent-architecture,',
        'voiceflow-overview, start, projects.',
        'Was the load appropriate for the request? Respond JSON {appropriate: boolean, reason: string}.',
      ].join('\n');
    },
  })
  .generateScore(({ results }) => {
    const a = results.analyzeStepResult as { appropriate?: boolean; reason?: string } | undefined;
    return a?.appropriate ? 1 : 0;
  })
  .generateReason(({ results }) => {
    const a = results.analyzeStepResult as { appropriate?: boolean; reason?: string } | undefined;
    return a?.reason ?? 'no reason produced';
  });
