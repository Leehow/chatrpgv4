#!/usr/bin/env python3
"""COC Narration Contract — verifies a DirectorPlan is narration-ready.

Parallel to coc_story_harness's GM-quality assertions, this checker verifies
the CONTRACT between the Story Director's output and the narration layer
(coc-keeper-play SKILL step 5: "Narrate consequences per
DirectorPlan.narrative_directives"). We cannot unit-test LLM narration output
(non-deterministic), but we CAN assert that every DirectorPlan carries
sufficient directives for an LLM narrator to write a compliant scene without
violating constraints.

Spec: docs/superpowers/specs/2026-07-05-story-director-design.md (Section 6)
"""
from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

ACTIONS = ["REVEAL", "DEEPEN", "PRESSURE", "CHARACTER", "CHOICE", "CUT",
           "MONTAGE", "SUBSYSTEM", "RECOVER", "PAYOFF"]
HORROR_STAGES = {"ordinary", "wrongness", "pattern", "revelation"}


def _read_json(path: Path, fallback: Any = None) -> Any:
    if not path.exists():
        return fallback
    return json.loads(path.read_text(encoding="utf-8"))


def _secret_id(secret: str) -> str:
    """Extract the id prefix from a 'id: description' keeper_secret entry.

    Scenario keeper_secrets are stored as 'corbitt-buried-in-basement: Walter
    Corbitt's body...'. The narrator must compare against clue_policy.reveal
    ids (e.g. 'clue-knott-job-briefing'), so we strip the description. If a
    secret has no ': ' separator, treat the whole string as the id.
    """
    return secret.split(": ", 1)[0] if ": " in secret else secret


def assert_narration_ready(plan: dict[str, Any], scenario_dir: Path) -> dict[str, dict[str, Any]]:
    """Verify a DirectorPlan carries everything an LLM narrator needs.

    Returns {check_id: {passed, detail}}. A plan is narration-ready iff every
    check passes.
    """
    findings: dict[str, dict[str, Any]] = {}
    directives = plan.get("narrative_directives", {}) or {}
    boundaries = _read_json(scenario_dir / "improvisation-boundaries.json", {})
    keeper_secrets = boundaries.get("keeper_secrets", []) or []
    keeper_secret_ids = {_secret_id(s) for s in keeper_secrets}

    # 1. tone_present -------------------------------------------------------
    tone = directives.get("tone", [])
    tone_ok = isinstance(tone, list) and len(tone) > 0
    findings["tone_present"] = {
        "passed": bool(tone_ok),
        "detail": f"tone={tone!r}",
    }

    # 2. must_not_reveal_populated -----------------------------------------
    mnr = directives.get("must_not_reveal", []) or []
    mnr_set = {_secret_id(s) for s in mnr}
    secrets_set = {_secret_id(s) for s in keeper_secrets}
    populated = len(mnr) > 0
    superset = secrets_set.issubset(mnr_set)
    missing = sorted(secrets_set - mnr_set)
    findings["must_not_reveal_populated"] = {
        "passed": bool(populated and superset),
        "detail": (f"mnr_count={len(mnr)} secrets_count={len(keeper_secrets)} "
                   f"missing_from_mnr={missing}"),
    }

    # 2b. content_constraints_passed_through --------------------------------
    # If the scenario has content_flags in module-meta, they MUST appear in the
    # plan's narrative_directives.content_constraints. This verifies the safety
    # constraint chain is closed (flags -> plan -> narrator). We do NOT judge
    # whether content "crosses a line" — that is LLM semantic judgment.
    meta_path = scenario_dir / "module-meta.json"
    if meta_path.exists():
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        meta_flags = set(meta.get("content_flags", []) or [])
        plan_flags = set(directives.get("content_constraints", []) or [])
        chain_closed = meta_flags.issubset(plan_flags)
        findings["content_constraints_passed_through"] = {
            "passed": chain_closed,
            "detail": f"meta_flags={sorted(meta_flags)} plan_flags={sorted(plan_flags)} missing={sorted(meta_flags - plan_flags)}",
        }
    else:
        findings["content_constraints_passed_through"] = {
            "passed": True, "detail": "no module-meta (cannot verify)",
        }

    # 3. dramatic_question_present -----------------------------------------
    dq = plan.get("dramatic_question", "")
    findings["dramatic_question_present"] = {
        "passed": bool(dq and str(dq).strip()),
        "detail": f"dramatic_question={dq!r}",
    }

    # 4. horror_stage_valid -------------------------------------------------
    stage = directives.get("horror_escalation_stage", "")
    findings["horror_stage_valid"] = {
        "passed": stage in HORROR_STAGES,
        "detail": f"horror_escalation_stage={stage!r} valid={sorted(HORROR_STAGES)}",
    }

    # 5. handoff_consistency ------------------------------------------------
    handoff = plan.get("handoff", "")
    if handoff == "rules":
        rules_req = plan.get("rules_requests", []) or []
        passed = len(rules_req) > 0
        detail = f"handoff=rules rules_requests_count={len(rules_req)}"
    elif handoff == "narration":
        tone_present = bool(isinstance(tone, list) and len(tone) > 0)
        mnr_present = len(mnr) > 0
        passed = tone_present and mnr_present
        detail = (f"handoff=narration tone_present={tone_present} "
                  f"must_not_reveal_present={mnr_present}")
    else:
        passed = False
        detail = f"handoff={handoff!r} not in (rules, narration)"
    findings["handoff_consistency"] = {"passed": bool(passed), "detail": detail}

    # 6. clue_policy_no_secret_leak ----------------------------------------
    reveal = plan.get("clue_policy", {}).get("reveal", []) or []
    leaked = sorted(set(reveal) & keeper_secret_ids)
    findings["clue_policy_no_secret_leak"] = {
        "passed": len(leaked) == 0,
        "detail": f"reveal={reveal} leaked_secrets={leaked}",
    }

    # 7. scene_action_narratable -------------------------------------------
    action = plan.get("scene_action", "")
    findings["scene_action_narratable"] = {
        "passed": action in ACTIONS,
        "detail": f"scene_action={action!r} valid={ACTIONS}",
    }

    # 8. rationale_present --------------------------------------------------
    rationale = plan.get("rationale", "")
    findings["rationale_present"] = {
        "passed": bool(rationale and str(rationale).strip()),
        "detail": f"rationale={rationale!r}",
    }

    return findings


def is_narration_ready(plan: dict[str, Any], scenario_dir: Path) -> bool:
    """Convenience: True iff every narration contract check passes."""
    findings = assert_narration_ready(plan, scenario_dir)
    return all(f["passed"] for f in findings.values())


# =============================================================================
# CLI: python3 coc_narration_contract.py <plan.json> <scenario_dir>
# =============================================================================
def _main(argv: list[str]) -> int:
    if len(argv) != 3:
        sys.stderr.write(
            "usage: coc_narration_contract.py <plan.json> <scenario_dir>\n")
        return 2
    plan_path = Path(argv[1])
    scenario_dir = Path(argv[2])
    if not plan_path.exists():
        sys.stderr.write(f"error: plan not found: {plan_path}\n")
        return 2
    if not scenario_dir.is_dir():
        sys.stderr.write(f"error: scenario_dir not found: {scenario_dir}\n")
        return 2
    plan = _read_json(plan_path, {})
    if not isinstance(plan, dict):
        sys.stderr.write(f"error: plan is not a JSON object: {plan_path}\n")
        return 2

    findings = assert_narration_ready(plan, scenario_dir)
    all_passed = True
    for check_id, result in findings.items():
        status = "PASS" if result["passed"] else "FAIL"
        if not result["passed"]:
            all_passed = False
        detail = result["detail"]
        if len(detail) > 120:
            detail = detail[:117] + "..."
        print(f"[{status}] {check_id:32s} {detail}")
    overall = "PASS" if all_passed else "FAIL"
    total = len(findings)
    passed = sum(1 for f in findings.values() if f["passed"])
    print(f"\n{narration_summary(plan_path.name, passed, total)} -> {overall}")
    return 0 if all_passed else 1


def narration_summary(name: str, passed: int, total: int) -> str:
    return f"{name}: {passed}/{total} narration-ready checks passed"


if __name__ == "__main__":
    sys.exit(_main(sys.argv))
