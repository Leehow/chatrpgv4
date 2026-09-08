"""Investigator development (pp.94-95): skill ticks, the frozen ending capsule and the
settlement that applies it. Ported from coc_development.py, re-cut for the kernel:

- ticks live in `<campaign>/save/development-state/<inv>.json` (the old shared
  `.coc/investigators/<id>/development.jsonl` has no kernel equivalent — campaigns
  are compile snapshots);
- an ending freezes its inputs in `save/development-settlements/endings/<ending_id>/
  capsule.json` and each investigator's settlement receipt sits beside it;
- the plan is deterministic from `<ending_id>:<inv>:development.settle`, exactly as
  before, so replays cannot re-roll;
- the party sheet is the character sheet: `run_development_phase` mutates the sheet
  dict it is given and the caller writes it. Awfulness decay (sanity engine) and the
  runtime-inventory merge are not ported (no sanity session / inventory in the kernel yet)."""

from __future__ import annotations

import hashlib
import json
import random
import re
import time
from pathlib import Path
from typing import Any

from ..fileio import canonical_json, read_json, write_json_atomic
from . import percentile
from .tables import RuleTables

_SAFE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
_SUCCESS_OUTCOMES = frozenset({"regular", "hard", "extreme", "critical"})
ENDING_KINDS = ("conclusion", "tpk", "retreat", "cliffhanger")


def _sha256(value: Any) -> str:
    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


# ---- tick eligibility (W0-6 structured rules) -----------------------------------

def _is_success(roll_result: dict[str, Any]) -> bool:
    if roll_result.get("success") is True:
        return True
    return str(roll_result.get("outcome") or "").strip().lower() in _SUCCESS_OUTCOMES


def _is_bonus_die_only(roll_result: dict[str, Any]) -> bool:
    if roll_result.get("excluded_outcome") == "bonus_die_only_success" or roll_result.get("bonus_die_only_success") is True:
        return True
    bonus = int(roll_result.get("bonus", 0) or 0)
    penalty = int(roll_result.get("penalty", 0) or 0)
    tens_values = roll_result.get("tens_values")
    units = roll_result.get("units")
    if bonus <= 0 or penalty > 0 or not isinstance(tens_values, list) or len(tens_values) < 2 or units is None:
        return False
    try:
        target = int(roll_result.get("effective_target", roll_result.get("target", 0)))
        units_i = int(units)
        explicit_base = roll_result.get("unmodified_roll")
        without_bonus = int(explicit_base) if explicit_base is not None else int(tens_values[0]) * 10 + units_i
        if without_bonus == 0:
            without_bonus = 100
        candidates = [100 if int(t) == 0 and units_i == 0 else int(t) * 10 + units_i for t in tens_values]
        with_bonus = min(candidates)
    except (TypeError, ValueError):
        return False
    return with_bonus <= target < without_bonus


def _is_opposed_loser(roll_result: dict[str, Any]) -> bool:
    if roll_result.get("excluded_outcome") == "opposed_roll_loser" or roll_result.get("opposed_won") is False:
        return True
    opposed_outcome = str(roll_result.get("opposed_outcome") or "")
    return opposed_outcome in {"defender_higher", "tie_defender_wins"}


def _tick_excluded(tables: RuleTables, skill: str, roll_result: dict[str, Any]) -> bool:
    rule = tables.development_rule()
    if skill in {str(s) for s in rule["tick"].get("never_tick_skills", [])}:
        return True
    if not _is_success(roll_result):
        return True
    if roll_result.get("improvement_tick_eligible") is False or roll_result.get("luck_spent"):
        return True
    if _is_bonus_die_only(roll_result) or _is_opposed_loser(roll_result):
        return True
    kind = str(roll_result.get("kind") or roll_result.get("roll_kind") or "")
    if kind in {"sanity_check", "sanity", "luck", "damage", "characteristic_check", "characteristic", "idea_roll",
                "idea", "combined_skill_check"}:
        return True
    executor_kind = str(roll_result.get("executor_kind") or roll_result.get("attack_executor_kind") or "living").casefold()
    if executor_kind in {"device", "remote_device", "environment", "trap", "apparatus", "poltergeist"}:
        return True
    return bool(roll_result.get("device_attack") is True or roll_result.get("remote_attack") is True)


def skill_tick_eligible(tables: RuleTables, skill: str, roll_result: dict[str, Any]) -> bool:
    skill = str(skill or "").strip()
    return bool(skill and isinstance(roll_result, dict) and not _tick_excluded(tables, skill, roll_result))


# ---- tick store -----------------------------------------------------------------

def development_state_path(campaign_dir: Path, investigator_id: str) -> Path:
    return Path(campaign_dir) / "save" / "development-state" / f"{investigator_id}.json"


def read_development_state(campaign_dir: Path, investigator_id: str) -> dict[str, Any]:
    path = development_state_path(campaign_dir, investigator_id)
    data = read_json(path) if path.exists() else {}
    if not isinstance(data, dict):
        data = {}
    data.setdefault("investigator_id", investigator_id)
    if not isinstance(data.get("ticks"), dict):
        data["ticks"] = {}
    if not isinstance(data.get("claimed"), dict):
        data["claimed"] = {}
    return data


def write_development_state(campaign_dir: Path, investigator_id: str, data: dict[str, Any]) -> None:
    write_json_atomic(development_state_path(campaign_dir, investigator_id), data)


def record_skill_tick(tables: RuleTables, campaign_dir: Path, campaign_id: str, investigator_id: str, skill: str,
                      roll_result: dict[str, Any], *, source_event_id: str, source_kind: str = "skill_check",
                      session_id: str | None = None) -> dict[str, Any] | None:
    """Append one development tick when the roll qualifies (p.94); idempotent on the
    source receipt so one settled check never earns a second tick."""
    skill = str(skill or "").strip()
    if not skill_tick_eligible(tables, skill, roll_result):
        return None
    if not isinstance(investigator_id, str) or _SAFE_ID.fullmatch(investigator_id) is None:
        raise ValueError("investigator_id must be a stable safe id")
    token = "development-check-" + _sha256({"campaign_id": campaign_id, "investigator_id": investigator_id,
                                           "source_kind": source_kind, "source_event_id": source_event_id})
    state = read_development_state(campaign_dir, investigator_id)
    existing = state["ticks"].get(token)
    if existing is not None:
        if existing.get("skill") != skill:
            raise ValueError("development event token has conflicting skill")
        replay = dict(existing)
        if token in state["claimed"]:
            replay["development_event_status"] = "already_claimed"
        return replay
    tick = {
        "schema_version": 2, "event_type": "development_check_earned", "event_token": token,
        "investigator_id": investigator_id, "campaign_id": campaign_id,
        "session_id": session_id or f"{campaign_id}:session:1", "source_kind": source_kind,
        "source_event_id": source_event_id, "skill": skill,
        "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "roll": roll_result.get("roll"),
    }
    state["ticks"][token] = tick
    write_development_state(campaign_dir, investigator_id, state)
    return tick


def unclaimed_ticks(campaign_dir: Path, investigator_id: str) -> list[dict[str, Any]]:
    state = read_development_state(campaign_dir, investigator_id)
    return [dict(row) for token, row in state["ticks"].items() if token not in state["claimed"]]


# ---- endings --------------------------------------------------------------------

def ending_id_for_event(ending: dict[str, Any]) -> str:
    explicit = ending.get("ending_id")
    if isinstance(explicit, str) and explicit:
        return explicit
    return "ending-" + _sha256({"decision_id": ending.get("decision_id"), "scene_id": ending.get("scene_id"),
                                "kind": ending.get("kind")})[:20]


def ending_event_id(ending_id: str) -> str:
    if _SAFE_ID.fullmatch(str(ending_id)) is None:
        raise ValueError("ending_id is not a safe persisted identity")
    return "ending-event-" + hashlib.sha256(str(ending_id).encode("utf-8")).hexdigest()[:20]


def ending_capsule_path(campaign_dir: Path, ending_id: str) -> Path:
    if _SAFE_ID.fullmatch(str(ending_id)) is None:
        raise ValueError("ending_id is not a safe persisted identity")
    return Path(campaign_dir) / "save" / "development-settlements" / "endings" / str(ending_id) / "capsule.json"


def ending_settlement_path(campaign_dir: Path, ending_id: str, investigator_id: str) -> Path:
    if _SAFE_ID.fullmatch(str(investigator_id)) is None:
        raise ValueError("investigator_id is not a safe persisted identity")
    return ending_capsule_path(campaign_dir, ending_id).with_name(f"{investigator_id}.json")


def load_ending_capsule(campaign_dir: Path, ending_id: str) -> dict[str, Any] | None:
    path = ending_capsule_path(campaign_dir, ending_id)
    if not path.exists():
        return None
    data = read_json(path)
    return data if isinstance(data, dict) else None


def list_endings(campaign_dir: Path) -> list[dict[str, Any]]:
    root = Path(campaign_dir) / "save" / "development-settlements" / "endings"
    if not root.exists():
        return []
    capsules = []
    for child in sorted(root.iterdir()):
        capsule = load_ending_capsule(campaign_dir, child.name) if child.is_dir() else None
        if capsule is not None:
            capsules.append(capsule)
    capsules.sort(key=lambda c: str(c.get("captured_at") or ""))
    return capsules


def pending_settlements(campaign_dir: Path) -> list[tuple[str, str]]:
    """(ending_id, investigator_id) pairs whose capsule exists but whose settlement does not."""
    pending: list[tuple[str, str]] = []
    for capsule in list_endings(campaign_dir):
        ending_id = str(capsule.get("ending_id") or "")
        for investigator_id in capsule.get("investigator_ids") or []:
            if not ending_settlement_path(campaign_dir, ending_id, str(investigator_id)).exists():
                pending.append((ending_id, str(investigator_id)))
    return pending


def capsule_for_campaign_ending(campaign_dir: Path, ending_turn: int) -> dict[str, Any] | None:
    """Reuse final-turn or later accounting for the same completed campaign ending."""
    for capsule in reversed(list_endings(campaign_dir)):
        if (capsule.get("campaign_ending_turn") == ending_turn
            or str(capsule.get("decision_id") or "").startswith(f"t{ending_turn}-c")):
            return capsule
    return None


def _rulebook_skill_base(tables: RuleTables, skill: str) -> int | None:
    spec = tables.skills_table().get(skill)
    base = spec.get("base_chance") if isinstance(spec, dict) else None
    return int(base) if isinstance(base, int) and not isinstance(base, bool) else None


def _ticked_skill_baseline(tables: RuleTables, sheet_skills: dict[str, Any], skill: str) -> int:
    if skill in sheet_skills:
        return int(sheet_skills[skill] or 0)
    base = _rulebook_skill_base(tables, skill)
    if base is not None:
        return base
    raise ValueError(f"development tick references skill missing from both the sheet and the rulebook catalog: {skill!r}")


def _skipped_luck_recovery(luck: int, gate: dict[str, Any]) -> dict[str, Any]:
    return {"skipped": True, "reason": "optional_rule_disabled", "option_id": str(gate.get("option_id")),
            "decided_by": str(gate.get("decided_by")), "layer": str(gate.get("layer")), "gained": 0,
            "luck_before": int(luck), "luck_after": int(luck), "rule_ref": "core.optional.luck_recovery"}


def deterministic_development_plan(tables: RuleTables, *, skills: dict[str, int], luck: int,
                                   sanity: dict[str, Any], seed_material: str,
                                   scenario_reward_expr: str | None,
                                   luck_recovery_gate: dict[str, Any] | None = None) -> dict[str, Any]:
    """Improvement checks, Luck recovery and SAN rewards from a seed the ending fixes."""
    rng = random.Random(seed_material)
    rule = tables.development_rule()
    improvement = rule["improvement_roll"]
    always_above = int(improvement.get("always_improves_above", 95))
    threshold = int(improvement.get("san_reward_threshold", 90))
    sanity_expr = str(rule.get("sanity_reward", {}).get("reward", "2D6"))
    checks: list[dict[str, Any]] = []
    earns_san = False
    for skill, current in skills.items():
        check_roll = rng.randint(1, 100)
        improved = check_roll > current or check_roll > always_above
        gain = rng.randint(1, 10) if improved else None
        planned_after = current + int(gain or 0)
        earns_san = earns_san or (improved and planned_after >= threshold)
        checks.append({"skill": skill, "check_roll": check_roll, "gain": gain, "value_before": current,
                       "planned_value_after": planned_after, "improved": improved})
    luck_recovery = (_skipped_luck_recovery(luck, luck_recovery_gate) if luck_recovery_gate is not None
                     else percentile.recover_luck(luck, rng=rng))
    development_reward = percentile.roll_expression(sanity_expr, rng) if earns_san else None
    scenario_reward = (percentile.roll_expression(scenario_reward_expr, rng)
                       if isinstance(scenario_reward_expr, str) and scenario_reward_expr else None)
    planned_san = int(sanity["current"])
    san_max = int(sanity["max"])
    development_delta = min(int(development_reward["total"]) if development_reward else 0, san_max - planned_san)
    planned_san += development_delta
    scenario_delta = min(int(scenario_reward["total"]) if scenario_reward else 0, san_max - planned_san)
    plan = {
        "schema_version": 2, "improvement_checks": checks, "luck_recovery": luck_recovery,
        "development_san_reward": development_reward, "scenario_san_reward": scenario_reward,
        "development_san_planned_delta": development_delta, "scenario_san_planned_delta": scenario_delta,
    }
    plan["plan_sha256"] = _sha256(plan)
    return plan


def sanity_baseline(sheet: dict[str, Any]) -> dict[str, Any]:
    current = int(sheet.get("current_san") if sheet.get("current_san") is not None else (sheet.get("derived") or {}).get("SAN", 0))
    maximum = sheet.get("max_san")
    if maximum is None:
        maximum = 99 - int(sheet.get("cm_value") or 0)
    maximum = max(current, int(maximum))
    return {"source": "party_sheet", "current": current, "max": maximum}


def development_input_snapshot(tables: RuleTables, campaign_dir: Path, investigator_id: str, sheet: dict[str, Any], *,
                               ending_id: str, seed_material: str, scenario_reward_expr: str | None,
                               luck_recovery_gate: dict[str, Any] | None) -> dict[str, Any]:
    owned = unclaimed_ticks(campaign_dir, investigator_id)
    skills_checked = list(dict.fromkeys(str(row["skill"]) for row in owned))
    sheet_skills = sheet.get("skills") if isinstance(sheet.get("skills"), dict) else {}
    frozen_skills = {skill: _ticked_skill_baseline(tables, sheet_skills, skill) for skill in skills_checked}
    luck = int(sheet.get("current_luck") if sheet.get("current_luck") is not None else (sheet.get("characteristics") or {}).get("LUCK", 50))
    sanity = sanity_baseline(sheet)
    plan = deterministic_development_plan(tables, skills=frozen_skills, luck=luck, sanity=sanity,
                                          seed_material=seed_material, scenario_reward_expr=scenario_reward_expr,
                                          luck_recovery_gate=luck_recovery_gate)
    snapshot = {
        "schema_version": 2, "skills_checked": skills_checked, "check_events": owned,
        "input_tokens": [row["event_token"] for row in owned],
        "claim_owner": {"campaign_id": str(sheet.get("campaign_id") or ""), "ending_id": ending_id,
                        "investigator_id": investigator_id},
        "mechanical_baseline": {"skills": frozen_skills, "luck": luck, "sanity": sanity},
        "deterministic_plan": plan,
    }
    snapshot["input_sha256"] = _sha256(snapshot)
    return snapshot


def build_ending_capsule(tables: RuleTables, campaign_dir: Path, record: dict[str, Any],
                         sheets: dict[str, dict[str, Any]], *, luck_recovery_gate: dict[str, Any] | None,
                         captured_at: str) -> dict[str, Any]:
    """Freeze one ending's complete mechanical input before settlement."""
    event = json.loads(json.dumps(record, ensure_ascii=False))
    event["ending_id"] = ending_id_for_event(event)
    event.setdefault("event_id", ending_event_id(event["ending_id"]))
    investigator_ids = [str(i) for i in event.get("investigator_ids") or []]
    rng_identity = {inv: {"algorithm": "python-random-seed-v1",
                          "seed_material": f"{event['ending_id']}:{inv}:development.settle"} for inv in investigator_ids}
    inputs = {inv: development_input_snapshot(tables, campaign_dir, inv, sheets[inv], ending_id=event["ending_id"],
                                              seed_material=rng_identity[inv]["seed_material"],
                                              scenario_reward_expr=event.get("scenario_san_reward_expr"),
                                              luck_recovery_gate=luck_recovery_gate)
              for inv in investigator_ids}
    capsule = {
        "schema_version": 2, "capsule_type": "ending_settlement", "ending_id": event["ending_id"],
        "event_id": event["event_id"], "scene_id": event.get("scene_id"), "kind": event.get("kind"),
        "summary": event.get("summary"), "decision_id": event.get("decision_id"),
        "investigator_ids": investigator_ids, "scenario_san_reward_expr": event.get("scenario_san_reward_expr"),
        "development_inputs": inputs, "rng_identity": rng_identity, "captured_at": captured_at,
    }
    if "campaign_ending_turn" in event:
        capsule["campaign_ending_turn"] = event["campaign_ending_turn"]
    capsule["capsule_sha256"] = _sha256(capsule)
    return capsule


def persist_ending_capsule(campaign_dir: Path, capsule: dict[str, Any]) -> Path:
    path = ending_capsule_path(campaign_dir, capsule["ending_id"])
    write_json_atomic(path, capsule)
    return path


def run_development_phase(tables: RuleTables, campaign_dir: Path, investigator_id: str, sheet: dict[str, Any],
                          capsule: dict[str, Any]) -> dict[str, Any]:
    """Apply one frozen plan to the sheet (mutated in place), consume its ticks and write
    the settlement receipt. Replaying a settled ending returns the stored receipt."""
    ending_id = str(capsule["ending_id"])
    receipt_path = ending_settlement_path(campaign_dir, ending_id, investigator_id)
    if receipt_path.exists():
        stored = read_json(receipt_path)
        stored["replayed"] = True
        return stored
    development_input = (capsule.get("development_inputs") or {}).get(investigator_id)
    if not isinstance(development_input, dict):
        raise ValueError(f"ending {ending_id} froze no development input for {investigator_id}")
    skills = sheet.setdefault("skills", {})
    baseline = development_input["mechanical_baseline"]
    plan = development_input["deterministic_plan"]
    improvement_checks: list[dict[str, Any]] = []
    skills_improved: list[dict[str, Any]] = []
    for frozen in plan["improvement_checks"]:
        skill = str(frozen["skill"])
        current_live = _ticked_skill_baseline(tables, skills, skill)
        gain = int(frozen["gain"] or 0)
        value_after = current_live + gain if frozen["improved"] else current_live
        if frozen["improved"]:
            skills[skill] = value_after
        row = {"skill": skill, "check_roll": int(frozen["check_roll"]), "gain": int(frozen["gain"]) if frozen["improved"] else None,
               "value_before": int(frozen["value_before"]), "planned_value_after": int(frozen["planned_value_after"]),
               "current_value_before_apply": current_live, "applied_delta": gain, "value_after": value_after,
               "improved": bool(frozen["improved"]), "merge_policy": "additive_monotonic"}
        improvement_checks.append(dict(row))
        if frozen["improved"]:
            skills_improved.append(row)

    luck_plan = dict(plan["luck_recovery"])
    current_luck = int(sheet.get("current_luck") if sheet.get("current_luck") is not None else baseline["luck"])
    planned_gain = int(luck_plan.get("gained", 0) or 0)
    luck_after = min(99, current_luck + planned_gain)
    if not luck_plan.get("skipped"):
        sheet["current_luck"] = luck_after
    luck_recovery = {**luck_plan, "planned_luck_before": int(baseline["luck"]),
                     "planned_luck_after": int(luck_plan["luck_after"]), "planned_gained": planned_gain,
                     "current_luck_before_apply": current_luck, "gained": luck_after - current_luck,
                     "luck_after": luck_after, "applied_delta": luck_after - current_luck,
                     "merge_policy": "additive_monotonic_capped_99"}

    san_before = int(sheet.get("current_san") if sheet.get("current_san") is not None else baseline["sanity"]["current"])
    san_max = int(baseline["sanity"]["max"])
    san_gain = int(plan["development_san_planned_delta"]) + int(plan["scenario_san_planned_delta"])
    san_after = min(san_max, san_before + san_gain) if san_gain > 0 else san_before
    if san_after != san_before:
        sheet["current_san"] = san_after

    state = read_development_state(campaign_dir, investigator_id)
    for token in development_input.get("input_tokens") or []:
        state["claimed"][str(token)] = ending_id
    write_development_state(campaign_dir, investigator_id, state)

    result = {
        "schema_version": 1, "status": "PASS", "kind": "development.settle", "ending_id": ending_id,
        "investigator_id": investigator_id, "skills_checked": list(development_input["skills_checked"]),
        "improvement_checks": improvement_checks, "skills_improved": skills_improved,
        "san_reward_roll": plan.get("development_san_reward"),
        "san_reward_planned_delta": int(plan["development_san_planned_delta"]),
        "scenario_san_reward_roll": plan.get("scenario_san_reward"),
        "scenario_san_reward_planned_delta": int(plan["scenario_san_planned_delta"]),
        "san_before": san_before, "san_after": san_after, "luck_recovery": luck_recovery,
        "mechanical_baseline": baseline, "settlement_plan_sha256": plan["plan_sha256"],
        "merge_policy": "frozen_plan_additive_monotonic_v1",
        "input_tokens_consumed": list(development_input.get("input_tokens") or []),
    }
    write_json_atomic(receipt_path, result)
    return result
