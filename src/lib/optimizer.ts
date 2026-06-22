import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';

/**
 * Ports of the optimizer-specific bin/ tools (deterministic pieces of GEPA):
 *   vf-build-rubric, vf-validate-definition, vf-pareto-select, vf-split-examples, vf-judge-model.
 * The agent definition is the source of truth for the judge rubric.
 */

export interface AgentDefinition {
  agent?: { name?: string; project?: string; type?: string; model?: string; version?: string };
  purpose?: { summary?: string; goals?: string[] };
  scope?: {
    handles?: string[];
    does_not_handle?: string[];
    routes_to?: Array<{ target?: string; when?: string }>;
  };
  tools?: Array<{ name?: string; description?: string }>;
  tone?: { style?: string; rules?: string[] };
  hard_rules?: {
    blockers?: Array<{ id?: string; rule?: string }>;
    warnings?: Array<{ id?: string; rule?: string }>;
  };
  success_metrics?: { primary?: string; secondary?: string[] };
  rubric_weights?: { accuracy?: number; tone?: number; completeness?: number; safety?: number };
}

export function loadDefinition(path: string): AgentDefinition {
  const raw = readFileSync(path, 'utf8');
  return (path.endsWith('.json') ? JSON.parse(raw) : parseYaml(raw)) as AgentDefinition;
}

/** Port of vf-validate-definition. */
export function validateDefinition(def: AgentDefinition): string[] {
  const issues: string[] = [];
  const agent = def.agent ?? {};
  if (!agent.name) issues.push('agent.name is required');
  if (!agent.project) issues.push('agent.project is required');
  if (!agent.type) issues.push('agent.type is required (routing, response, form, faq)');
  else if (!['routing', 'response', 'form', 'faq'].includes(agent.type))
    issues.push('agent.type must be one of: routing, response, form, faq');

  if (!def.purpose?.summary) issues.push('purpose.summary is required');

  const blockers = def.hard_rules?.blockers ?? [];
  if (blockers.length === 0) issues.push('hard_rules.blockers should have at least one entry');
  blockers.forEach((b, i) => {
    if (!b.id) issues.push(`hard_rules.blockers[${i}].id is required`);
    if (!b.rule) issues.push(`hard_rules.blockers[${i}].rule is required`);
  });

  if (!def.success_metrics?.primary) issues.push('success_metrics.primary is required');

  const weights = def.rubric_weights;
  if (weights) {
    const total = Object.values(weights).reduce((s, v) => s + (v ?? 0), 0);
    if (Math.abs(total - 100) > 1) issues.push(`rubric_weights should sum to 100 (got ${total})`);
  }
  return issues;
}

/** Port of vf-build-rubric: agent definition -> LLM judge rubric. */
export function buildRubric(def: AgentDefinition): string {
  const agent = def.agent ?? {};
  const purpose = def.purpose ?? {};
  const scope = def.scope ?? {};
  const tone = def.tone ?? {};
  const hardRules = def.hard_rules ?? {};
  const metrics = def.success_metrics ?? {};
  const weights = def.rubric_weights ?? {};
  const tools = def.tools ?? [];
  const type = agent.type ?? 'response';
  const name = agent.name || 'the agent';

  const accuracy: string[] = [];
  if (type === 'routing') {
    const routes = scope.routes_to ?? [];
    if (routes.length) {
      accuracy.push('- Was the message routed to the CORRECT specialist agent?', '  Valid routes:');
      for (const r of routes) accuracy.push(`  - ${r.target ?? '?'} -> when: ${r.when ?? '?'}`);
    }
    accuracy.push(
      '- For ambiguous queries, did it pick the most appropriate primary route?',
      '- Did it correctly identify when a query is outside all routes?',
    );
    if (tools.length) accuracy.push(`- Did it ONLY use tools from the allowed set: ${tools.map((t) => t.name).join(', ')}?`);
  } else {
    accuracy.push(
      "- Did the agent correctly identify the customer's issue?",
      '- Was the information provided factually correct?',
      '- If a tool was available, did the agent use the right one with correct parameters?',
      '- Did the agent avoid hallucinating information?',
    );
  }
  for (const g of purpose.goals ?? []) accuracy.push(`- ${g}`);

  const toneLines: string[] = [];
  if (tone.style) toneLines.push(`- Expected style: ${tone.style}`);
  for (const r of tone.rules ?? []) toneLines.push(`- ${r}`);
  if (!toneLines.length) toneLines.push('- Is the response appropriate in tone for the context?');

  const completeness: string[] = [];
  if (metrics.primary) completeness.push(`- Primary success: ${metrics.primary}`);
  for (const s of metrics.secondary ?? []) completeness.push(`- ${s}`);
  completeness.push(
    type === 'routing'
      ? '- Did routing happen on the FIRST attempt (no unnecessary back-and-forth)?'
      : '- Did the agent include clear next steps?',
  );

  const safety: string[] = [];
  for (const b of hardRules.blockers ?? []) safety.push(`- [BLOCKER] ${b.id ?? ''}: ${b.rule ?? ''}`);
  for (const w of hardRules.warnings ?? []) safety.push(`- [WARNING] ${w.id ?? ''}: ${w.rule ?? ''}`);
  if (!safety.length) safety.push('- Did the agent avoid making promises it cannot guarantee?');

  return `You are evaluating a response from "${name}".

Agent purpose: ${purpose.summary ?? ''}

Score the response on these dimensions (each 0-10):

**ACCURACY (weight: ${weights.accuracy ?? 50}%)**
${accuracy.join('\n')}

**TONE (weight: ${weights.tone ?? 20}%)**
${toneLines.join('\n')}

**COMPLETENESS (weight: ${weights.completeness ?? 20}%)**
${completeness.join('\n')}

**SAFETY (weight: ${weights.safety ?? 10}%)**
${safety.join('\n')}`;
}

/** Normalized 0-1 weighted score from per-dimension 0-10 scores. */
export function weightedScore(
  dims: { accuracy: number; tone: number; completeness: number; safety: number },
  weights: AgentDefinition['rubric_weights'] = {},
): number {
  const w = { accuracy: weights.accuracy ?? 50, tone: weights.tone ?? 20, completeness: weights.completeness ?? 20, safety: weights.safety ?? 10 };
  const total = w.accuracy + w.tone + w.completeness + w.safety || 1;
  const sum = dims.accuracy * w.accuracy + dims.tone * w.tone + dims.completeness * w.completeness + dims.safety * w.safety;
  return Math.round((sum / total / 10) * 10000) / 10000; // 0-1
}

export interface Candidate {
  score: number;
  prompt?: string;
  length?: number;
  pareto_score?: number;
  [k: string]: unknown;
}

/** Port of vf-pareto-select: balance quality (0.8) vs brevity (0.2). */
export function paretoSelect(candidates: Candidate[], weightQuality = 0.8, weightBrevity = 0.2): Candidate | null {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];
  for (const c of candidates) if (c.length == null && typeof c.prompt === 'string') c.length = c.prompt.length;
  const lengths = candidates.map((c) => c.length ?? 0);
  const maxLen = Math.max(...lengths);
  const minLen = Math.min(...lengths);
  const range = maxLen !== minLen ? maxLen - minLen : 1;
  let best: Candidate | null = null;
  let bestPareto = -1;
  for (const c of candidates) {
    const quality = c.score ?? 0;
    const brevity = 1 - ((c.length ?? 0) - minLen) / range;
    const pareto = quality * weightQuality + brevity * weightBrevity;
    if (pareto > bestPareto) {
      bestPareto = pareto;
      best = c;
    }
  }
  if (best) best.pareto_score = Math.round(bestPareto * 10000) / 10000;
  return best;
}

function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface ScoredExample {
  score?: number;
  agent_name?: string;
  [k: string]: unknown;
}

export interface SplitResult {
  train: ScoredExample[];
  val: ScoredExample[];
  holdout: ScoredExample[];
  stats: Record<string, unknown>;
  warnings: string[];
}

/** Port of vf-split-examples (seeded; exact ordering differs from Python's RNG but the split structure matches). */
export function splitExamples(
  examples: ScoredExample[],
  opts: {
    minCount?: number;
    maxCount?: number;
    train?: number;
    val?: number;
    includePassing?: boolean;
    includeFailing?: boolean;
    balance?: boolean;
    seed?: number;
  } = {},
): SplitResult {
  const { minCount = 20, maxCount = 60, train: trainRatio = 0.6, val: valRatio = 0.2, includePassing = true, includeFailing = true, balance = true, seed = 42 } = opts;
  const rand = mulberry32(seed);
  const passing = examples.filter((e) => (e.score ?? 0.5) >= 0.7);
  const failing = examples.filter((e) => (e.score ?? 0.5) < 0.7);

  let pool: ScoredExample[] = [];
  if (includeFailing) pool.push(...failing);
  if (includePassing) pool.push(...passing);
  if (pool.length === 0)
    return { train: [], val: [], holdout: [], stats: { total_input: examples.length, total_selected: 0 }, warnings: ['No examples match the inclusion filters'] };

  if (balance && includePassing && includeFailing && passing.length && failing.length) {
    const targetFailing = Math.max(failing.length, Math.floor(maxCount * 0.3));
    pool = [...failing.slice(0, targetFailing), ...passing.slice(0, maxCount - targetFailing)];
  }

  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  if (pool.length > maxCount) pool = pool.slice(0, maxCount);

  const total = pool.length;
  const trainEnd = Math.floor(total * trainRatio);
  const valEnd = trainEnd + Math.floor(total * valRatio);
  const trainSet = pool.slice(0, trainEnd);
  const valSet = pool.slice(trainEnd, valEnd);
  let holdout = pool.slice(valEnd);
  if (holdout.length === 0 && valSet.length) holdout = [valSet.pop() as ScoredExample];
  if (holdout.length === 0 && trainSet.length) holdout = [trainSet.pop() as ScoredExample];

  const passFail = (lst: ScoredExample[]) => {
    const p = lst.filter((e) => (e.score ?? 0.5) >= 0.7).length;
    return { passing: p, failing: lst.length - p };
  };
  const warnings: string[] = [];
  if (total < minCount) warnings.push(`Only ${total} examples available (minimum recommended: ${minCount}). Results may not generalize well.`);
  if (failing.length === 0) warnings.push('No failing examples found. Optimizer needs failures to identify what to fix.');
  else if (failing.length < 3) warnings.push(`Only ${failing.length} failing examples. Ideally need 5+ for reliable patterns.`);

  const tp = passFail(trainSet);
  const vp = passFail(valSet);
  const hp = passFail(holdout);
  return {
    train: trainSet,
    val: valSet,
    holdout,
    stats: {
      total_input: examples.length,
      total_selected: total,
      train: { count: trainSet.length, ...tp },
      val: { count: valSet.length, ...vp },
      holdout: { count: holdout.length, ...hp },
    },
    warnings,
  };
}

/** Port of vf-judge-model: judge one tier above the agent. For single-tier GLM, the judge is the main tier. */
export function judgeTier(agentModel: string): 'main' | 'triage' {
  return 'main';
}
