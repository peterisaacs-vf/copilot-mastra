#!/usr/bin/env python3
"""
Voiceflow v4 wiring audit.

Reads a project export (extracted from `voiceflow_project export_to_file`)
and reports gaps and malformations in the wiring layer.

Usage:
    python3 audit.py <path-to-vf_export.json>

Outputs:
    - Tiered human-readable report on stdout
    - /tmp/vf_audit.json — structured findings
    - /tmp/vf_audit_fixes.json — starter fix plan
"""
import json
import sys
import re
from collections import defaultdict


def load_export(path):
    """Accept either a raw export JSON or the MCP wrapper file."""
    with open(path) as f:
        raw = f.read()
    # MCP wrapper format: [{"type": "text", "text": "<json string>"}]
    try:
        outer = json.loads(raw)
        if isinstance(outer, list) and outer and "text" in outer[0]:
            return json.loads(outer[0]["text"])
    except (json.JSONDecodeError, KeyError, TypeError):
        pass
    return json.loads(raw)


def heuristic_var_name(input_name):
    """Convert camelCase input name to snake_case project var name."""
    # assignmentId -> assignment_id, paymentAccountId -> payment_account_id
    return re.sub(r'(?<!^)(?=[A-Z])', '_', input_name).lower()


# Common input-name → project-var-name conventions worth surfacing
# even if a strict camelCase→snake_case match doesn't hold.
COMMON_PATTERNS = {
    "assignmentId": "problem_assignment_uuid",
    "assignmentUUID": "problem_assignment_uuid",
    "currentAssignmentId": "current_assignment_uuid",
    "currentAssignmentUUID": "current_assignment_uuid",
    "userId": "user_id",
    "userID": "user_id",
    "jwtToken": "jwt_token",
    "conversationId": "conversation_id",
    "conversationUUID": "conversation_uuid",
    "ticketId": "ticket_id",
    "ticketID": "ticket_id",
    "latitude": "latitude",
    "longitude": "longitude",
    "timeZone": "user_timezone",
}


def run_audit(data):
    funcs = {f["id"]: f for f in data.get("functions", [])}
    func_vars = data.get("functionVariables", [])
    agents = {a["id"]: a.get("name", "?") for a in data.get("agents", [])}
    project_vars = {v["id"]: v for v in data.get("variables", [])}
    project_var_by_name = {v["name"]: v for v in data.get("variables", [])}
    agent_tools = data.get("agentFunctionTools", [])

    func_inputs = defaultdict(list)
    func_outputs = defaultdict(list)
    for v in func_vars:
        if v["type"] == "input":
            func_inputs[v["functionID"]].append(v)
        else:
            func_outputs[v["functionID"]].append(v)

    # Per-function lookups
    func_input_by_name = {}    # (fid, name) -> id
    func_input_by_id = {}      # (fid, id) -> name
    func_output_by_name = {}   # (fid, name) -> id
    for v in func_vars:
        if v["type"] == "input":
            func_input_by_name[(v["functionID"], v["name"])] = v["id"]
            func_input_by_id[(v["functionID"], v["id"])] = v["name"]
        else:
            func_output_by_name[(v["functionID"], v["name"])] = v["id"]

    # Tools grouped by function
    tools_by_func = defaultdict(list)
    for t in agent_tools:
        tools_by_func[t["functionID"]].append(t)

    findings = {
        "phase_1_var_setters": defaultdict(list),
        "phase_2_orphan_defaults": [],
        "phase_3_should_fulfill_with_canonical_source": [],
        "phase_4_uncaptured_outputs": [],
        "phase_5_malformed_wiring": [],
        "phase_6_suggested_captures": [],
        "phase_7_side_effect_only": [],
        "phase_8_orphan_functions": [],
        "phase_9_args_secrets_reads": [],
    }

    # PHASE 1: Map project-var setters
    for t in agent_tools:
        cr = t.get("captureResponse") or {}
        for out_name, mapping in cr.items():
            if isinstance(mapping, dict) and "variableOrEntityID" in mapping:
                vid = mapping["variableOrEntityID"]
                vname = project_vars.get(vid, {}).get("name", "?")
                fn_name = funcs.get(t["functionID"], {}).get("name", "?")
                ag_name = agents.get(t["agentID"], "?")
                findings["phase_1_var_setters"][vname].append({
                    "function": fn_name,
                    "agent": ag_name,
                    "output": out_name,
                })
    setter_var_names = set(findings["phase_1_var_setters"].keys())

    # PHASE 2 & 3: Walk every tool input
    for t in agent_tools:
        fid = t["functionID"]
        fn_name = funcs.get(fid, {}).get("name", "?")
        ag_name = agents.get(t["agentID"], "?")
        for inp_name, cfg in (t.get("inputVariables") or {}).items():
            if not isinstance(cfg, dict):
                continue
            sf = cfg.get("shouldFulfill")
            dv = cfg.get("defaultValue") or []
            default_var_id = None
            default_literal = None
            if dv and isinstance(dv, list) and len(dv) > 0:
                first = dv[0]
                if isinstance(first, dict):
                    default_var_id = first.get("variableID")
                    default_literal = first.get("text")
            default_var_name = project_vars.get(default_var_id, {}).get("name") if default_var_id else None

            # PHASE 2: shouldFulfill: false but default-var has no setter
            if sf is False and default_var_name and default_var_name not in setter_var_names:
                # Filter out vars that get set at session-launch (not via captureResponse)
                # Heuristic: any var whose name suggests session/auth/profile is launch-set
                LAUNCH_SET = {"jwt_token", "user_id", "shift_smart_user_id", "user_email",
                              "user_first_name", "user_last_name", "user_phone_number",
                              "db_conversation_uuid", "vf_user_timezone", "partner_zone",
                              "partner_cohort", "marketplace_health_tier"}
                if default_var_name not in LAUNCH_SET:
                    findings["phase_2_orphan_defaults"].append({
                        "tool_id": t["id"],
                        "function": fn_name,
                        "agent": ag_name,
                        "input": inp_name,
                        "default_var": default_var_name,
                        "note": "var has no setter; downstream calls will get empty default",
                    })

            # PHASE 3: shouldFulfill: true for an input with a likely-canonical source
            if sf is True:
                expected = COMMON_PATTERNS.get(inp_name) or heuristic_var_name(inp_name)
                if expected in project_var_by_name and expected in setter_var_names:
                    findings["phase_3_should_fulfill_with_canonical_source"].append({
                        "tool_id": t["id"],
                        "function": fn_name,
                        "agent": ag_name,
                        "input": inp_name,
                        "suggested_default_var": expected,
                        "note": "consider switching shouldFulfill: false",
                    })

            # PHASE 5: malformed functionInputVariableID
            fivid = cfg.get("functionInputVariableID")
            if fivid:
                # If it's a name string (not a UUID-shape) AND matches a function var by name → broken
                if (fid, fivid) in func_input_by_name and fivid not in func_input_by_id.values():
                    # Wait — we want: fivid is a name, not a UUID
                    if not (fivid.startswith("69") and len(fivid) >= 24):
                        findings["phase_5_malformed_wiring"].append({
                            "tool_id": t["id"],
                            "function": fn_name,
                            "agent": ag_name,
                            "input": inp_name,
                            "issue": "functionInputVariableID is a name string, not a UUID",
                            "current": fivid,
                            "should_be": func_input_by_name[(fid, fivid)],
                        })

            # PHASE 5: phantom inputs (key is itself a function-var ID)
            if (fid, inp_name) in func_input_by_id:
                proper_name = func_input_by_id[(fid, inp_name)]
                findings["phase_5_malformed_wiring"].append({
                    "tool_id": t["id"],
                    "function": fn_name,
                    "agent": ag_name,
                    "input": inp_name,
                    "issue": "phantom input keyed by function-var ID",
                    "should_be_named": proper_name,
                })

    # PHASE 4: function outputs that no captureResponse uses
    for fid, outs in func_outputs.items():
        fn_name = funcs.get(fid, {}).get("name", "?")
        tools = tools_by_func.get(fid, [])
        if not tools:
            continue  # orphan, surfaced in phase 8
        captured_outputs = set()
        for t in tools:
            cr = t.get("captureResponse") or {}
            captured_outputs.update(cr.keys())
        for out in outs:
            if out["name"] not in captured_outputs:
                findings["phase_4_uncaptured_outputs"].append({
                    "function": fn_name,
                    "output": out["name"],
                    "tool_count": len(tools),
                    "note": "output is returned but no captureResponse uses it",
                })

    # PHASE 6: heuristic-suggested captures
    for fid, outs in func_outputs.items():
        fn_name = funcs.get(fid, {}).get("name", "?")
        for out in outs:
            expected = COMMON_PATTERNS.get(out["name"]) or heuristic_var_name(out["name"])
            if expected in project_var_by_name:
                tools = tools_by_func.get(fid, [])
                already_captured_to = set()
                for t in tools:
                    cr = t.get("captureResponse") or {}
                    if out["name"] in cr:
                        m = cr[out["name"]]
                        if isinstance(m, dict):
                            vid = m.get("variableOrEntityID")
                            if vid in project_vars:
                                already_captured_to.add(project_vars[vid]["name"])
                if expected not in already_captured_to:
                    findings["phase_6_suggested_captures"].append({
                        "function": fn_name,
                        "output": out["name"],
                        "suggested_var": expected,
                        "current_captures_to": list(already_captured_to) or None,
                        "note": "heuristic match — verify before wiring",
                    })

    # PHASE 7: side-effect-only functions (used in flow, no outputs declared)
    for fid, fn in funcs.items():
        if fid in tools_by_func and not func_outputs.get(fid):
            findings["phase_7_side_effect_only"].append({
                "function": fn["name"],
                "agents": [agents.get(t["agentID"], "?") for t in tools_by_func[fid]],
                "note": "no outputs declared — fine if pure side effect; check if any value would help downstream",
            })

    # PHASE 8: orphan functions (zero tool instances)
    for fid, fn in funcs.items():
        if fid not in tools_by_func:
            findings["phase_8_orphan_functions"].append({
                "function": fn["name"],
                "input_count": len(func_inputs.get(fid, [])),
                "output_count": len(func_outputs.get(fid, [])),
                "note": "no agent tool instances; may be workflow-invoked or dead code",
            })

    # PHASE 9: functions whose code reads args.secrets.* (never valid in V4)
    args_secrets_re = re.compile(
        r"""args\s*\??\s*\.\s*secrets\b|args\s*(?:\?\.)?\s*\[\s*['"]secrets['"]\s*\]"""
    )
    for fid, fn in funcs.items():
        code = fn.get("code")
        if not isinstance(code, str) or not args_secrets_re.search(code):
            continue
        tools = tools_by_func.get(fid, [])
        findings["phase_9_args_secrets_reads"].append({
            "function": fn.get("name", "?"),
            "attachments": [
                {"agent": agents.get(t["agentID"], "?"), "tool_id": t["id"]}
                for t in tools
            ],
            "note": "code reads args.secrets, which does not exist in the V4 "
                    "function sandbox; refactor to an input variable wired via "
                    "secretID Markup (shouldFulfill: false) on each attachment",
        })

    return findings


def print_report(findings):
    print("=" * 100)
    print("VOICEFLOW WIRING AUDIT")
    print("=" * 100)

    print("\n## PHASE 1 — Project variables that ARE captured from function outputs")
    if not findings["phase_1_var_setters"]:
        print("  (none — no captureResponse mappings found anywhere)")
    for vname, setters in sorted(findings["phase_1_var_setters"].items()):
        for s in setters:
            print(f"  {vname:<40} ← {s['function']}.{s['output']}  ({s['agent']})")

    print(f"\n## PHASE 2 — Tool inputs defaulting from a project var with NO setter ({len(findings['phase_2_orphan_defaults'])} issues)")
    print("  (These will silently default to empty unless the var is launch-set)")
    for f in findings["phase_2_orphan_defaults"]:
        print(f"  {f['function']:<32} {f['agent']:<14} {f['input']:<28} default_var={f['default_var']}")

    print(f"\n## PHASE 3 — shouldFulfill: true inputs with a likely canonical source ({len(findings['phase_3_should_fulfill_with_canonical_source'])} suggestions)")
    print("  (Consider switching to shouldFulfill: false with the suggested default)")
    for f in findings["phase_3_should_fulfill_with_canonical_source"]:
        print(f"  {f['function']:<32} {f['agent']:<14} {f['input']:<28} suggest default → {f['suggested_default_var']}")

    print(f"\n## PHASE 4 — Function outputs that no captureResponse uses ({len(findings['phase_4_uncaptured_outputs'])} outputs)")
    by_fn = defaultdict(list)
    for f in findings["phase_4_uncaptured_outputs"]:
        by_fn[f["function"]].append(f["output"])
    for fn_name in sorted(by_fn.keys()):
        outs = by_fn[fn_name]
        print(f"  {fn_name:<32} ({len(outs)} outputs): {', '.join(outs[:6])}{' ...' if len(outs) > 6 else ''}")

    print(f"\n## PHASE 5 — Malformed wiring ({len(findings['phase_5_malformed_wiring'])} issues)")
    for f in findings["phase_5_malformed_wiring"]:
        print(f"  {f['function']:<32} {f['agent']:<14} {f['input']:<28} {f['issue']}")
        if "should_be" in f:
            print(f"    → fix: functionInputVariableID = {f['should_be']}")
        if "should_be_named" in f:
            print(f"    → fix: drop phantom (proper input named '{f['should_be_named']}' should already exist)")

    print(f"\n## PHASE 6 — Heuristic capture suggestions ({len(findings['phase_6_suggested_captures'])} suggestions)")
    for f in findings["phase_6_suggested_captures"]:
        print(f"  {f['function']:<32} output {f['output']:<25} → suggest capture to project var '{f['suggested_var']}'")

    print(f"\n## PHASE 7 — Side-effect-only functions ({len(findings['phase_7_side_effect_only'])} functions)")
    print("  (No outputs declared; verify each is intentional)")
    for f in findings["phase_7_side_effect_only"]:
        print(f"  {f['function']:<32} (used in: {', '.join(f['agents'])})")

    print(f"\n## PHASE 8 — Orphan functions ({len(findings['phase_8_orphan_functions'])} functions)")
    print("  (Zero agent tool instances; either workflow-invoked or dead code)")
    for f in findings["phase_8_orphan_functions"]:
        print(f"  {f['function']:<32} ({f['input_count']} inputs, {f['output_count']} outputs)")

    print(f"\n## PHASE 9 — Functions that read args.secrets.* ({len(findings['phase_9_args_secrets_reads'])} functions) — ALWAYS A BUG")
    print("  (args.secrets does not exist in the V4 sandbox; wire the secret as an input via secretID)")
    for f in findings["phase_9_args_secrets_reads"]:
        attachments = f["attachments"]
        if attachments:
            where = ", ".join(f"{a['agent']} (tool_id={a['tool_id']})" for a in attachments)
            print(f"  {f['function']:<32} fix code, then re-wire attachment(s): {where}")
        else:
            print(f"  {f['function']:<32} (no agent tool attachments — workflow-invoked or dead code)")

    print("\n" + "=" * 100)
    print("Total issues:")
    print(f"  Phase 2 (orphan defaults):           {len(findings['phase_2_orphan_defaults'])}")
    print(f"  Phase 3 (should-fulfill candidates): {len(findings['phase_3_should_fulfill_with_canonical_source'])}")
    print(f"  Phase 4 (uncaptured outputs):        {len(findings['phase_4_uncaptured_outputs'])}")
    print(f"  Phase 5 (malformed wiring):          {len(findings['phase_5_malformed_wiring'])}")
    print(f"  Phase 6 (capture suggestions):       {len(findings['phase_6_suggested_captures'])}")
    print(f"  Phase 7 (side-effect-only):          {len(findings['phase_7_side_effect_only'])}  (informational)")
    print(f"  Phase 8 (orphans):                   {len(findings['phase_8_orphan_functions'])}  (informational)")
    print(f"  Phase 9 (args.secrets reads):        {len(findings['phase_9_args_secrets_reads'])}  (always a bug)")


def write_outputs(findings, audit_path="/tmp/vf_audit.json", fixes_path="/tmp/vf_audit_fixes.json"):
    # Convert defaultdict to dict for JSON
    serializable = {k: (dict(v) if isinstance(v, defaultdict) else v) for k, v in findings.items()}
    with open(audit_path, "w") as f:
        json.dump(serializable, f, indent=2, default=str)
    # Starter fix plan: phases 2/3/5 are mechanical wiring edits; phase 9
    # (args.secrets) needs a function-code change first, then re-wiring each
    # listed attachment.
    fix_plan = {
        "missing_setters": findings["phase_2_orphan_defaults"],
        "flip_should_fulfill": findings["phase_3_should_fulfill_with_canonical_source"],
        "repair_malformed": findings["phase_5_malformed_wiring"],
        "refactor_args_secrets": findings["phase_9_args_secrets_reads"],
    }
    with open(fixes_path, "w") as f:
        json.dump(fix_plan, f, indent=2, default=str)
    print(f"\nFull audit:    {audit_path}")
    print(f"Starter fixes: {fixes_path}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(f"Usage: {sys.argv[0]} <path-to-vf_export.json>")
        sys.exit(1)
    data = load_export(sys.argv[1])
    findings = run_audit(data)
    print_report(findings)
    write_outputs(findings)
