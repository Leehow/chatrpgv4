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

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from coc_narration_style import player_facing_style_contract as _player_facing_style_contract

ACTIONS = ["REVEAL", "DEEPEN", "PRESSURE", "CHARACTER", "CHOICE", "CUT",
           "MONTAGE", "SUBSYSTEM", "RECOVER", "PAYOFF"]
HORROR_STAGES = {"ordinary", "wrongness", "pattern", "revelation"}


def player_facing_style_contract(language: str = "zh-Hans") -> dict[str, Any]:
    """Return narrator-facing style constraints for player-visible prose."""
    return _player_facing_style_contract(language)


def _read_json(path: Path, fallback: Any = None) -> Any:
    if not path.exists():
        return fallback
    return json.loads(path.read_text(encoding="utf-8"))


def _looks_like_secret_id(token: str) -> bool:
    """True when token is a compact structured id, not free-form secret prose.

    Position-based fallback ids (secret_001) and authored ids
    (secret-polyp-horror-full-stat-block) qualify. Long prose without an
    id:description split does not — those get secret_NNN at normalize time.
    """
    if not token or " " in token or "\n" in token:
        return False
    if len(token) > 80:
        return False
    return True


def _secret_id(secret: Any, *, index: int | None = None) -> str:
    """Extract a stable secret id from a keeper_secrets entry.

    Accepts:
    - structured {id, ...} refs (preferred narrator-facing form)
    - 'id: description' strings (prose stays planner-side only)
    - bare id tokens
    - bare prose → secret_NNN by position (no prose classification)
    """
    if isinstance(secret, dict):
        sid = str(secret.get("id") or "").strip()
        if sid:
            return sid
        if index is not None:
            return f"secret_{index + 1:03d}"
        return ""
    text = str(secret or "").strip()
    if not text:
        if index is not None:
            return f"secret_{index + 1:03d}"
        return ""
    if ": " in text:
        prefix = text.split(": ", 1)[0].strip()
        if _looks_like_secret_id(prefix):
            return prefix
    if _looks_like_secret_id(text):
        return text
    if index is not None:
        return f"secret_{index + 1:03d}"
    return text


def normalize_keeper_secret_refs(secrets: Any) -> list[dict[str, str]]:
    """Normalize keeper_secrets to narrator-safe {id, category} refs.

    Prose bodies stay in improvisation-boundaries (planner-side). Narrator-
    facing plans and envelopes must only carry these refs — never the prose.
    Does not classify meaning by scanning secret text (Semantic Matcher
    Constitution); bare prose entries get stable positional ids.
    """
    if not isinstance(secrets, list):
        return []
    refs: list[dict[str, str]] = []
    for index, secret in enumerate(secrets):
        if isinstance(secret, dict):
            sid = _secret_id(secret, index=index)
            category = str(secret.get("category") or "keeper_secret").strip() or "keeper_secret"
        else:
            sid = _secret_id(secret, index=index)
            category = "keeper_secret"
        if not sid:
            continue
        refs.append({"id": sid, "category": category})
    return refs


def secret_ref_ids(secrets: Any) -> list[str]:
    """Return ordered secret ids from raw or normalized keeper_secrets."""
    return [ref["id"] for ref in normalize_keeper_secret_refs(secrets)]


def build_narration_envelope(plan: dict[str, Any]) -> dict[str, Any]:
    """Build the minimum-privilege narrator payload from a DirectorPlan.

    Includes this-turn approved reveals (full player-safe text ok), tone,
    constraints, and must_not_reveal as {id, category} only. Keeper secret
    prose must never appear in the serialized envelope.
    """
    directives = plan.get("narrative_directives") or {}
    clue_policy = plan.get("clue_policy") or {}
    mnr_refs = normalize_keeper_secret_refs(directives.get("must_not_reveal") or [])
    npc_moves = []
    for move in plan.get("npc_moves") or []:
        if not isinstance(move, dict):
            continue
        safe_move = {
            "npc_id": move.get("npc_id"),
            "agenda": move.get("agenda"),
            "emotional_tone": move.get("emotional_tone"),
            "has_secret": bool(move.get("has_secret")),
            "secret_limit": move.get("secret_limit") or "",
            "disposition_source": move.get("disposition_source"),
            "relationship_to_investigators": move.get("relationship_to_investigators"),
            "social_role": move.get("social_role"),
            "persona": move.get("persona"),
            "agency_moves": move.get("agency_moves") or [],
        }
        if move.get("secret_id"):
            safe_move["secret_id"] = move["secret_id"]
        npc_moves.append(safe_move)
    return {
        "decision_id": plan.get("decision_id"),
        "scene_action": plan.get("scene_action"),
        "dramatic_question": plan.get("dramatic_question"),
        "handoff": plan.get("handoff"),
        "approved_reveals": {
            "clue_ids": list(clue_policy.get("reveal") or []),
            "must_include": list(directives.get("must_include") or []),
            "leads": list(clue_policy.get("leads") or []),
            "fallback_routes": list(clue_policy.get("fallback_routes") or []),
        },
        "tone": list(directives.get("tone") or []),
        "must_not_reveal": mnr_refs,
        "improvisation_allowed": list(directives.get("improvisation_allowed") or []),
        "horror_escalation_stage": directives.get("horror_escalation_stage"),
        "content_constraints": list(directives.get("content_constraints") or []),
        "player_facing_style": directives.get("player_facing_style"),
        "npc_moves": npc_moves,
        "pressure_moves": list(plan.get("pressure_moves") or []),
        "storylet_moves": list(plan.get("storylet_moves") or []),
        "choice_frame": plan.get("choice_frame") or {},
        "rules_requests": list(plan.get("rules_requests") or []),
        "rationale": plan.get("rationale"),
    }


def assert_narration_ready(plan: dict[str, Any], scenario_dir: Path) -> dict[str, dict[str, Any]]:
    """Verify a DirectorPlan carries everything an LLM narrator needs.

    Returns {check_id: {passed, detail}}. A plan is narration-ready iff every
    check passes.
    """
    findings: dict[str, dict[str, Any]] = {}
    directives = plan.get("narrative_directives", {}) or {}
    boundaries = _read_json(scenario_dir / "improvisation-boundaries.json", {})
    keeper_secrets = boundaries.get("keeper_secrets", []) or []
    keeper_secret_ids = set(secret_ref_ids(keeper_secrets))

    # 1. tone_present -------------------------------------------------------
    tone = directives.get("tone", [])
    tone_ok = isinstance(tone, list) and len(tone) > 0
    findings["tone_present"] = {
        "passed": bool(tone_ok),
        "detail": f"tone={tone!r}",
    }

    # 2. must_not_reveal_populated -----------------------------------------
    mnr = directives.get("must_not_reveal", []) or []
    mnr_set = set(secret_ref_ids(mnr))
    secrets_set = set(secret_ref_ids(keeper_secrets))
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

    # 2c. player_facing_style_present ---------------------------------------
    style = directives.get("player_facing_style")
    if isinstance(style, dict):
        avoid = set(style.get("avoid", []) or [])
        prefer = set(style.get("prefer", []) or [])
        policy = style.get("repetition_policy") or {}
        guard = style.get("style_guard") or {}
        render_contract = style.get("render_contract") or {}
        required_avoid = {
            "ai_summary_voice",
            "log_style_summary",
            "semantic_repetition",
            "abstract_psychological_explanation",
        }
        if style.get("language") == "zh-Hans":
            required_avoid.add("translationese")
        required_prefer = {"short_sentences", "observable_behavior", "open_ended_prompt"}
        required_guard_rules = {
            "observable_before_interpretation",
            "rewrite_abstract_explanation_to_action",
            "crisis_scene_clarity",
            "final_prose_guard_before_output",
        }
        required_render_slots = {
            "viewpoint_anchor",
            "spatial_anchor",
            "active_motion",
            "connection_or_force",
            "risk_progression",
            "visible_affordance",
            "player_entry",
        }
        missing_avoid = sorted(required_avoid - avoid)
        missing_prefer = sorted(required_prefer - prefer)
        missing_guard_rules = sorted(required_guard_rules - set(guard.get("required_rules", []) or []))
        missing_render_slots = sorted(
            required_render_slots - set(render_contract.get("required_slots", []) or [])
        )
        policy_ok = (
            isinstance(policy, dict)
            and policy.get("established_fact_mode") == "compress"
            and policy.get("repeat_foreign_dialogue") == "summarize_unless_new_information"
        )
        final_output_pass = guard.get("final_output_pass") if isinstance(guard, dict) else {}
        final_output_pass_ok = (
            isinstance(final_output_pass, dict)
            and final_output_pass.get("required") is True
            and final_output_pass.get("function") == "guard_player_visible_text"
            and final_output_pass.get("applies_to") == "player_visible_narration_only"
            and final_output_pass.get("not_for") == [
                "scene_routing",
                "storylet_selection",
                "rules_adjudication",
            ]
        )
        guard_ok = (
            isinstance(guard, dict)
            and not missing_guard_rules
            and final_output_pass_ok
            and guard.get("not_for") == ["scene_routing", "storylet_selection", "rules_adjudication"]
        )
        render_contract_ok = (
            isinstance(render_contract, dict)
            and render_contract.get("frame_type") == "crisis_scene_render"
            and not missing_render_slots
            and render_contract.get("player_visible_must_not") == [
                "slot_labels",
                "expository_choice_summary",
                "if_then_option_dump",
            ]
        )
        style_ok = (
            bool(style.get("register"))
            and not missing_avoid
            and not missing_prefer
            and policy_ok
            and guard_ok
            and render_contract_ok
        )
        detail = (
            f"player_facing_style language={style.get('language')!r} "
            f"register={style.get('register')!r} missing_avoid={missing_avoid} "
            f"missing_prefer={missing_prefer} repetition_policy_ok={policy_ok} "
            f"missing_guard_rules={missing_guard_rules} style_guard_ok={guard_ok} "
            f"final_output_pass_ok={final_output_pass_ok} "
            f"missing_render_slots={missing_render_slots} render_contract_ok={render_contract_ok}"
        )
    else:
        style_ok = False
        detail = "player_facing_style missing or not an object"
    findings["player_facing_style_present"] = {
        "passed": bool(style_ok),
        "detail": detail,
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

    # 6b. must_not_reveal_has_no_secret_prose ------------------------------
    # Narrator-facing must_not_reveal must be {id, category} (or bare ids),
    # never the full keeper_secrets prose from improvisation-boundaries.
    prose_bodies: list[str] = []
    for secret in keeper_secrets:
        if isinstance(secret, dict):
            body = str(secret.get("prose") or secret.get("text") or "").strip()
            if body:
                prose_bodies.append(body)
            continue
        text = str(secret or "").strip()
        if ": " in text:
            prefix, _, rest = text.partition(": ")
            if _looks_like_secret_id(prefix.strip()) and rest.strip():
                prose_bodies.append(rest.strip())
        elif text and not _looks_like_secret_id(text):
            prose_bodies.append(text)
    mnr_blob = json.dumps(mnr, ensure_ascii=False)
    prose_hits = [body for body in prose_bodies if body and body in mnr_blob]
    findings["must_not_reveal_has_no_secret_prose"] = {
        "passed": len(prose_hits) == 0,
        "detail": f"prose_hits={len(prose_hits)}",
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
