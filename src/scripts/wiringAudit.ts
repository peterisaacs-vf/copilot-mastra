/**
 * Wiring audit — TypeScript port of skills/audit-wiring/scripts/audit.py.
 *
 * Connects to the Voiceflow MCP, lists projects, exports the selected one,
 * and runs the full 9-phase wiring audit:
 *   Phase 1: Project variables that ARE captured from function outputs (the "setters")
 *   Phase 2: Tool inputs defaulting from a project var with NO setter (orphan defaults)
 *   Phase 3: shouldFulfill: true inputs with a likely canonical source
 *   Phase 4: Function outputs that no captureResponse uses
 *   Phase 5: Malformed wiring (functionInputVariableID is a name, phantom inputs)
 *   Phase 6: Heuristic-suggested captureResponse wirings
 *   Phase 7: Side-effect-only functions (no outputs declared)
 *   Phase 8: Orphan functions (zero agent tool instances)
 *   Phase 9: Functions that read args.secrets.* (always a bug in V4)
 *
 * Usage:
 *   npx tsx src/scripts/wiringAudit.ts                # auto-selects first project
 *   npx tsx src/scripts/wiringAudit.ts <projectID>     # specify a project
 *
 * Requires .env with VF_MCP_TOKEN (or VF_AUTH_MODE=oauth).
 */
import 'dotenv/config';
import { createVoiceflowMcp } from '../mastra/mcp';
import { env, hasVoiceflowToken, useVoiceflowOAuth } from '../config/env';

// ---------------------------------------------------------------------------
// Types (matching the Voiceflow export schema)
// ---------------------------------------------------------------------------
interface VFExport {
  functions: VFFunction[];
  functionVariables: VFFuncVar[];
  agents: VFAgent[];
  variables: VFProjectVar[];
  agentFunctionTools: VFAgentTool[];
}

interface VFFunction {
  id: string;
  name: string;
  code?: string;
}

interface VFFuncVar {
  id: string;
  functionID: string;
  name: string;
  type: 'input' | 'output';
}

interface VFAgent {
  id: string;
  name: string;
}

interface VFProjectVar {
  id: string;
  name: string;
}

interface VFAgentTool {
  id: string;
  functionID: string;
  agentID: string;
  captureResponse?: Record<string, { variableOrEntityID?: string } | null>;
  inputVariables?: Record<string, VFInputConfig | null>;
}

interface VFInputConfig {
  shouldFulfill?: boolean;
  defaultValue?: Array<{ variableID?: string; text?: string; secretID?: string }>;
  functionInputVariableID?: string;
}

interface Findings {
  phase1_varSetters: Record<string, Array<{ function: string; agent: string; output: string }>>;
  phase2_orphanDefaults: Array<{ toolId: string; function: string; agent: string; input: string; defaultVar: string; note: string }>;
  phase3_shouldFulfillWithCanonical: Array<{ toolId: string; function: string; agent: string; input: string; suggestedDefaultVar: string; note: string }>;
  phase4_uncapturedOutputs: Array<{ function: string; output: string; toolCount: number; note: string }>;
  phase5_malformedWiring: Array<{ toolId: string; function: string; agent: string; input: string; issue: string; current?: string; shouldBe?: string; shouldBeNamed?: string }>;
  phase6_suggestedCaptures: Array<{ function: string; output: string; suggestedVar: string; currentCapturesTo: string[] | null; note: string }>;
  phase7_sideEffectOnly: Array<{ function: string; agents: string[]; note: string }>;
  phase8_orphanFunctions: Array<{ function: string; inputCount: number; outputCount: number; note: string }>;
  phase9_argsSecretsReads: Array<{ function: string; attachments: Array<{ agent: string; toolId: string }>; note: string }>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function heuristicVarName(inputName: string): string {
  return inputName.replace(/(?<!^)(?=[A-Z])/g, '_').toLowerCase();
}

const COMMON_PATTERNS: Record<string, string> = {
  assignmentId: 'problem_assignment_uuid',
  assignmentUUID: 'problem_assignment_uuid',
  currentAssignmentId: 'current_assignment_uuid',
  currentAssignmentUUID: 'current_assignment_uuid',
  userId: 'user_id',
  userID: 'user_id',
  jwtToken: 'jwt_token',
  conversationId: 'conversation_id',
  conversationUUID: 'conversation_uuid',
  ticketId: 'ticket_id',
  ticketID: 'ticket_id',
  latitude: 'latitude',
  longitude: 'longitude',
  timeZone: 'user_timezone',
};

const LAUNCH_SET = new Set([
  'jwt_token', 'user_id', 'shift_smart_user_id', 'user_email',
  'user_first_name', 'user_last_name', 'user_phone_number',
  'db_conversation_uuid', 'vf_user_timezone', 'partner_zone',
  'partner_cohort', 'marketplace_health_tier',
]);

const ARGS_SECRETS_RE = /args\s*\??\s*\.\s*secrets\b|args\s*(?:\?\.)?\s*\[\s*['"]secrets['"]\s*\]/;

// ---------------------------------------------------------------------------
// Audit logic (faithful port of audit.py run_audit)
// ---------------------------------------------------------------------------

function runAudit(data: VFExport): Findings {
  const funcs = new Map(data.functions.map((f) => [f.id, f]));
  const funcVars = data.functionVariables;
  const agents = new Map(data.agents.map((a) => [a.id, a.name ?? '?']));
  const projectVars = new Map(data.variables.map((v) => [v.id, v]));
  const projectVarByName = new Map(data.variables.map((v) => [v.name, v]));
  const agentTools = data.agentFunctionTools;

  // Group function variables by function ID and type
  const funcInputs = new Map<string, VFFuncVar[]>();
  const funcOutputs = new Map<string, VFFuncVar[]>();
  for (const v of funcVars) {
    const bucket = v.type === 'input' ? funcInputs : funcOutputs;
    if (!bucket.has(v.functionID)) bucket.set(v.functionID, []);
    bucket.get(v.functionID)!.push(v);
  }

  // Per-function lookups
  const funcInputByName = new Map<string, string>();  // `${fid}::${name}` -> id
  const funcInputById = new Map<string, string>();    // `${fid}::${id}` -> name
  for (const v of funcVars) {
    if (v.type === 'input') {
      funcInputByName.set(`${v.functionID}::${v.name}`, v.id);
      funcInputById.set(`${v.functionID}::${v.id}`, v.name);
    }
  }

  // Tools grouped by function
  const toolsByFunc = new Map<string, VFAgentTool[]>();
  for (const t of agentTools) {
    if (!toolsByFunc.has(t.functionID)) toolsByFunc.set(t.functionID, []);
    toolsByFunc.get(t.functionID)!.push(t);
  }

  const findings: Findings = {
    phase1_varSetters: {},
    phase2_orphanDefaults: [],
    phase3_shouldFulfillWithCanonical: [],
    phase4_uncapturedOutputs: [],
    phase5_malformedWiring: [],
    phase6_suggestedCaptures: [],
    phase7_sideEffectOnly: [],
    phase8_orphanFunctions: [],
    phase9_argsSecretsReads: [],
  };

  // PHASE 1: Map project-var setters
  for (const t of agentTools) {
    const cr = t.captureResponse ?? {};
    for (const [outName, mapping] of Object.entries(cr)) {
      if (mapping && typeof mapping === 'object' && 'variableOrEntityID' in mapping) {
        const vid = mapping.variableOrEntityID!;
        const vname = projectVars.get(vid)?.name ?? '?';
        const fnName = funcs.get(t.functionID)?.name ?? '?';
        const agName = agents.get(t.agentID) ?? '?';
        if (!findings.phase1_varSetters[vname]) findings.phase1_varSetters[vname] = [];
        findings.phase1_varSetters[vname].push({ function: fnName, agent: agName, output: outName });
      }
    }
  }
  const setterVarNames = new Set(Object.keys(findings.phase1_varSetters));

  // PHASE 2 & 3 & 5: Walk every tool input
  for (const t of agentTools) {
    const fid = t.functionID;
    const fnName = funcs.get(fid)?.name ?? '?';
    const agName = agents.get(t.agentID) ?? '?';
    const inputVars = t.inputVariables ?? {};
    for (const [inpName, cfg] of Object.entries(inputVars)) {
      if (!cfg || typeof cfg !== 'object') continue;

      const sf = cfg.shouldFulfill;
      const dv = cfg.defaultValue ?? [];
      let defaultVarId: string | undefined;
      if (dv && Array.isArray(dv) && dv.length > 0) {
        const first = dv[0];
        if (first && typeof first === 'object') {
          defaultVarId = first.variableID;
        }
      }
      const defaultVarName = defaultVarId ? projectVars.get(defaultVarId)?.name : undefined;

      // PHASE 2: shouldFulfill: false but default-var has no setter
      if (sf === false && defaultVarName && !setterVarNames.has(defaultVarName)) {
        if (!LAUNCH_SET.has(defaultVarName)) {
          findings.phase2_orphanDefaults.push({
            toolId: t.id,
            function: fnName,
            agent: agName,
            input: inpName,
            defaultVar: defaultVarName,
            note: 'var has no setter; downstream calls will get empty default',
          });
        }
      }

      // PHASE 3: shouldFulfill: true for an input with a likely-canonical source
      if (sf === true) {
        const expected = COMMON_PATTERNS[inpName] ?? heuristicVarName(inpName);
        if (projectVarByName.has(expected) && setterVarNames.has(expected)) {
          findings.phase3_shouldFulfillWithCanonical.push({
            toolId: t.id,
            function: fnName,
            agent: agName,
            input: inpName,
            suggestedDefaultVar: expected,
            note: 'consider switching shouldFulfill: false',
          });
        }
      }

      // PHASE 5: malformed functionInputVariableID
      const fivid = cfg.functionInputVariableID;
      if (fivid) {
        const allInputIds = new Set(funcInputById.keys().map((k) => k.split('::')[1]));
        if (funcInputByName.has(`${fid}::${fivid}`) && !allInputIds.has(fivid)) {
          if (!(fivid.startsWith('69') && fivid.length >= 24)) {
            findings.phase5_malformedWiring.push({
              toolId: t.id,
              function: fnName,
              agent: agName,
              input: inpName,
              issue: 'functionInputVariableID is a name string, not a UUID',
              current: fivid,
              shouldBe: funcInputByName.get(`${fid}::${fivid}`),
            });
          }
        }
      }

      // PHASE 5: phantom inputs (key is itself a function-var ID)
      if (funcInputById.has(`${fid}::${inpName}`)) {
        const properName = funcInputById.get(`${fid}::${inpName}`)!;
        findings.phase5_malformedWiring.push({
          toolId: t.id,
          function: fnName,
          agent: agName,
          input: inpName,
          issue: 'phantom input keyed by function-var ID',
          shouldBeNamed: properName,
        });
      }
    }
  }

  // PHASE 4: function outputs that no captureResponse uses
  for (const [fid, outs] of funcOutputs) {
    const fnName = funcs.get(fid)?.name ?? '?';
    const tools = toolsByFunc.get(fid) ?? [];
    if (tools.length === 0) continue; // orphan, surfaced in phase 8
    const capturedOutputs = new Set<string>();
    for (const t of tools) {
      const cr = t.captureResponse ?? {};
      for (const k of Object.keys(cr)) capturedOutputs.add(k);
    }
    for (const out of outs) {
      if (!capturedOutputs.has(out.name)) {
        findings.phase4_uncapturedOutputs.push({
          function: fnName,
          output: out.name,
          toolCount: tools.length,
          note: 'output is returned but no captureResponse uses it',
        });
      }
    }
  }

  // PHASE 6: heuristic-suggested captures
  for (const [fid, outs] of funcOutputs) {
    const fnName = funcs.get(fid)?.name ?? '?';
    for (const out of outs) {
      const expected = COMMON_PATTERNS[out.name] ?? heuristicVarName(out.name);
      if (projectVarByName.has(expected)) {
        const tools = toolsByFunc.get(fid) ?? [];
        const alreadyCapturedTo = new Set<string>();
        for (const t of tools) {
          const cr = t.captureResponse ?? {};
          if (out.name in cr) {
            const m = cr[out.name];
            if (m && typeof m === 'object' && m.variableOrEntityID) {
              const pv = projectVars.get(m.variableOrEntityID);
              if (pv) alreadyCapturedTo.add(pv.name);
            }
          }
        }
        if (!alreadyCapturedTo.has(expected)) {
          findings.phase6_suggestedCaptures.push({
            function: fnName,
            output: out.name,
            suggestedVar: expected,
            currentCapturesTo: alreadyCapturedTo.size > 0 ? [...alreadyCapturedTo] : null,
            note: 'heuristic match — verify before wiring',
          });
        }
      }
    }
  }

  // PHASE 7: side-effect-only functions (used in flow, no outputs declared)
  for (const [fid, fn] of funcs) {
    if (toolsByFunc.has(fid) && !funcOutputs.has(fid)) {
      findings.phase7_sideEffectOnly.push({
        function: fn.name,
        agents: (toolsByFunc.get(fid) ?? []).map((t) => agents.get(t.agentID) ?? '?'),
        note: 'no outputs declared — fine if pure side effect; check if any value would help downstream',
      });
    }
  }

  // PHASE 8: orphan functions (zero tool instances)
  for (const [fid, fn] of funcs) {
    if (!toolsByFunc.has(fid)) {
      findings.phase8_orphanFunctions.push({
        function: fn.name,
        inputCount: funcInputs.get(fid)?.length ?? 0,
        outputCount: funcOutputs.get(fid)?.length ?? 0,
        note: 'no agent tool instances; may be workflow-invoked or dead code',
      });
    }
  }

  // PHASE 9: functions whose code reads args.secrets.* (never valid in V4)
  for (const [fid, fn] of funcs) {
    const code = fn.code;
    if (typeof code !== 'string' || !ARGS_SECRETS_RE.test(code)) continue;
    const tools = toolsByFunc.get(fid) ?? [];
    findings.phase9_argsSecretsReads.push({
      function: fn.name ?? '?',
      attachments: tools.map((t) => ({ agent: agents.get(t.agentID) ?? '?', toolId: t.id })),
      note: 'code reads args.secrets, which does not exist in the V4 function sandbox; refactor to an input variable wired via secretID Markup (shouldFulfill: false) on each attachment',
    });
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Report printer (faithful port of audit.py print_report)
// ---------------------------------------------------------------------------

function printReport(findings: Findings): void {
  const sep = '='.repeat(100);
  console.log(sep);
  console.log('VOICEFLOW WIRING AUDIT');
  console.log(sep);

  // PHASE 1
  console.log('\n## PHASE 1 — Project variables that ARE captured from function outputs');
  const setterNames = Object.keys(findings.phase1_varSetters);
  if (setterNames.length === 0) {
    console.log('  (none — no captureResponse mappings found anywhere)');
  } else {
    for (const vname of setterNames.sort()) {
      for (const s of findings.phase1_varSetters[vname]) {
        console.log(`  ${vname.padEnd(40)} ← ${s.function}.${s.output}  (${s.agent})`);
      }
    }
  }

  // PHASE 2
  console.log(`\n## PHASE 2 — Tool inputs defaulting from a project var with NO setter (${findings.phase2_orphanDefaults.length} issues)`);
  console.log('  (These will silently default to empty unless the var is launch-set)');
  for (const f of findings.phase2_orphanDefaults) {
    console.log(`  ${f.function.padEnd(32)} ${f.agent.padEnd(14)} ${f.input.padEnd(28)} default_var=${f.defaultVar}`);
  }

  // PHASE 3
  console.log(`\n## PHASE 3 — shouldFulfill: true inputs with a likely canonical source (${findings.phase3_shouldFulfillWithCanonical.length} suggestions)`);
  console.log('  (Consider switching to shouldFulfill: false with the suggested default)');
  for (const f of findings.phase3_shouldFulfillWithCanonical) {
    console.log(`  ${f.function.padEnd(32)} ${f.agent.padEnd(14)} ${f.input.padEnd(28)} suggest default → ${f.suggestedDefaultVar}`);
  }

  // PHASE 4
  console.log(`\n## PHASE 4 — Function outputs that no captureResponse uses (${findings.phase4_uncapturedOutputs.length} outputs)`);
  const byFn = new Map<string, string[]>();
  for (const f of findings.phase4_uncapturedOutputs) {
    if (!byFn.has(f.function)) byFn.set(f.function, []);
    byFn.get(f.function)!.push(f.output);
  }
  for (const fnName of [...byFn.keys()].sort()) {
    const outs = byFn.get(fnName)!;
    console.log(`  ${fnName.padEnd(32)} (${outs.length} outputs): ${outs.slice(0, 6).join(', ')}${outs.length > 6 ? ' ...' : ''}`);
  }

  // PHASE 5
  console.log(`\n## PHASE 5 — Malformed wiring (${findings.phase5_malformedWiring.length} issues)`);
  for (const f of findings.phase5_malformedWiring) {
    if (f.issue.includes('functionInputVariableID')) {
      console.log(`  ${f.function.padEnd(32)} ${f.agent.padEnd(14)} ${f.input.padEnd(28)} ${f.issue}  current="${f.current}" → should_be="${f.shouldBe}"`);
    } else {
      console.log(`  ${f.function.padEnd(32)} ${f.agent.padEnd(14)} ${f.input.padEnd(28)} ${f.issue}  should_be_named="${f.shouldBeNamed}"`);
    }
  }

  // PHASE 6
  console.log(`\n## PHASE 6 — Heuristic-suggested captureResponse wirings (${findings.phase6_suggestedCaptures.length} suggestions)`);
  for (const f of findings.phase6_suggestedCaptures) {
    console.log(`  ${f.function.padEnd(32)} output=${f.output.padEnd(28)} → capture to ${f.suggestedVar}${f.currentCapturesTo ? ` (currently → ${f.currentCapturesTo.join(', ')})` : ''}`);
  }

  // PHASE 7
  console.log(`\n## PHASE 7 — Side-effect-only functions (${findings.phase7_sideEffectOnly.length})`);
  for (const f of findings.phase7_sideEffectOnly) {
    console.log(`  ${f.function.padEnd(32)} agents=[${f.agents.join(', ')}]`);
  }

  // PHASE 8
  console.log(`\n## PHASE 8 — Orphan functions (${findings.phase8_orphanFunctions.length})`);
  for (const f of findings.phase8_orphanFunctions) {
    console.log(`  ${f.function.padEnd(32)} inputs=${f.inputCount} outputs=${f.outputCount}`);
  }

  // PHASE 9
  console.log(`\n## PHASE 9 — Functions reading args.secrets.* (always a bug) (${findings.phase9_argsSecretsReads.length} issues)`);
  for (const f of findings.phase9_argsSecretsReads) {
    console.log(`  ${f.function.padEnd(32)} attachments: ${f.attachments.map((a) => `${a.agent}/${a.toolId}`).join(', ')}`);
  }

  // Summary
  console.log('\n' + sep);
  console.log('SUMMARY');
  console.log(sep);
  console.log(`  Phase 2 (orphan defaults — HIGHEST priority):  ${findings.phase2_orphanDefaults.length} issues`);
  console.log(`  Phase 5 (malformed wiring):                    ${findings.phase5_malformedWiring.length} issues`);
  console.log(`  Phase 9 (args.secrets bug):                    ${findings.phase9_argsSecretsReads.length} issues`);
  console.log(`  Phase 3 (shouldFulfill suggestions):           ${findings.phase3_shouldFulfillWithCanonical.length} suggestions`);
  console.log(`  Phase 4 (uncaptured outputs):                  ${findings.phase4_uncapturedOutputs.length} outputs`);
  console.log(`  Phase 6 (suggested captures):                  ${findings.phase6_suggestedCaptures.length} suggestions`);
  console.log(`  Phase 7 (side-effect-only):                    ${findings.phase7_sideEffectOnly.length} functions`);
  console.log(`  Phase 8 (orphan functions):                    ${findings.phase8_orphanFunctions.length} functions`);
}

// ---------------------------------------------------------------------------
// Main: connect to Voiceflow MCP, export project, run audit
// ---------------------------------------------------------------------------

async function main() {
  if (!hasVoiceflowToken() && !useVoiceflowOAuth()) {
    console.error('ERROR: VF_MCP_TOKEN is not set and VF_AUTH_MODE is not "oauth".');
    console.error('Set VF_MCP_TOKEN in .env, or set VF_AUTH_MODE=oauth and authorize first.');
    process.exit(1);
  }

  console.log('[audit] connecting to Voiceflow MCP...');
  const mcp = createVoiceflowMcp();
  const tools = await mcp.listTools();
  const toolNames = Object.keys(tools);
  console.log(`[audit] loaded ${toolNames.length} MCP tools`);

  // Step 1: List projects
  const projectTool = tools['voiceflow_project'] as any;
  if (!projectTool) {
    console.error('ERROR: voiceflow_project tool not found in MCP toolset.');
    console.error('Available tools:', toolNames.join(', '));
    process.exit(1);
  }

  console.log('[audit] listing projects...');
  const listResult = await projectTool.execute({ operation: 'list' });
  const projects = parseMcpResult(listResult);

  if (!projects || projects.length === 0) {
    console.error('No Voiceflow projects found in this workspace.');
    process.exit(1);
  }

  // Step 2: Select project
  let selectedProject = projects[0];
  const requestedId = process.argv[2];

  if (requestedId) {
    const match = projects.find((p: any) => p.id === requestedId || p._id === requestedId);
    if (!match) {
      console.error(`Project "${requestedId}" not found. Available projects:`);
      for (const p of projects) console.error(`  ${p.id ?? p._id} — ${p.name}`);
      process.exit(1);
    }
    selectedProject = match;
  } else if (projects.length > 1) {
    console.log('\nMultiple projects found:');
    for (const p of projects) console.log(`  ${p.id ?? p._id} — ${p.name}`);
    console.log('\nUsing first project. To specify another, run: npx tsx src/scripts/wiringAudit.ts <projectID>');
  }

  const projectId = selectedProject.id ?? selectedProject._id;
  const projectName = selectedProject.name ?? '(unnamed)';
  console.log(`[audit] selected project: ${projectName} (${projectId})`);

  // Step 3: Resolve environment ID
  // For v1.3 projects, use draftVersionID from the environments map
  let environmentId: string | undefined;
  const environments = selectedProject.environments ?? selectedProject.versioning;
  if (environments) {
    // Try to find a draft/dev environment, or fall back to the first one
    if (Array.isArray(environments)) {
      const draft = environments.find((e: any) => e.name?.toLowerCase().includes('draft') || e.name?.toLowerCase().includes('dev'));
      environmentId = (draft ?? environments[0])?._id ?? (draft ?? environments[0])?.id;
    } else if (typeof environments === 'object') {
      // v1.3: environments is a map { development: { _id, draftVersionID }, production: {...} }
      const devEnv = (environments as any).development ?? (environments as any).draft ?? Object.values(environments)[0];
      environmentId = devEnv?.draftVersionID ?? devEnv?._id ?? devEnv?.id;
    }
  }

  // Fall back to project ID if no environment resolved
  if (!environmentId) {
    environmentId = projectId;
    console.log('[audit] no explicit environment found, using project ID as environment ID');
  }
  console.log(`[audit] environment ID: ${environmentId}`);

  // Step 4: Export project
  console.log('[audit] exporting project (this may take a few seconds)...');
  const exportResult = await projectTool.execute({ operation: 'export', environmentID: environmentId });
  const exportData = parseMcpResult(exportResult);

  if (!exportData || !exportData.functions) {
    console.error('ERROR: Export did not return expected data structure.');
    console.error('Result type:', typeof exportResult);
    console.error('Keys:', exportData ? Object.keys(exportData).slice(0, 20) : '(null)');
    process.exit(1);
  }

  console.log(`[audit] export received: ${exportData.functions?.length ?? 0} functions, ${exportData.variables?.length ?? 0} project vars, ${exportData.agentFunctionTools?.length ?? 0} agent tools`);

  // Step 5: Run audit
  console.log('[audit] running 9-phase wiring audit...\n');
  const findings = runAudit(exportData as VFExport);

  // Step 6: Print report
  printReport(findings);

  // Save structured JSON output
  const outPath = 'wiring-audit-results.json';
  const fs = await import('node:fs/promises');
  await fs.writeFile(outPath, JSON.stringify(findings, null, 2));
  console.log(`\n[audit] structured results saved to ${outPath}`);

  process.exit(0);
}

/** Extract the actual data from an MCP tool result (may be wrapped in [{type:'text', text:'...'}]). */
function parseMcpResult(result: any): any {
  if (!result) return null;
  // MCP text content wrapper
  if (Array.isArray(result) && result.length > 0 && result[0]?.text) {
    try {
      return JSON.parse(result[0].text);
    } catch {
      return result[0].text;
    }
  }
  // Direct object
  if (typeof result === 'object') return result;
  // String that might be JSON
  if (typeof result === 'string') {
    try {
      return JSON.parse(result);
    } catch {
      return result;
    }
  }
  return result;
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});