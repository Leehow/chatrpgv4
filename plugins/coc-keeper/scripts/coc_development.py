#!/usr/bin/env python3
"""Investigator Development Phase engine — Keeper Rulebook p.94-95.

Records skill ticks during play and settles improvement rolls between
sessions. SAN rewards are returned as expressions for the caller to apply
via SanitySession (never double-applied here).

Rulebook basis (7e 40th Anniversary, Rewards of Experience):
- One tick per skill for a qualifying success; Mythos / Credit Rating never tick.
- Luck-bought success, bonus-die-only success, opposed losers excluded.
- Development: 1D100 > current skill OR >95 → +1D10; skill ≥90 → 2D6 SAN expr.
- Session end also recovers Luck and decays awfulness caps by 1 (p.169).

Files managed:
  .coc/investigators/<id>/development.jsonl  — tick log (append / truncate)
  .coc/investigators/<id>/character.json     — skill write-back
  save/sanity.json                           — awfulness_caps decay
"""
from __future__ import annotations

import json
import hashlib
import random
import time
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent

_SUCCESS_OUTCOMES = frozenset({
    "critical", "extreme", "hard", "regular", "success",
    "extreme_success", "hard_success", "regular_success", "critical_success",
})


def _load_sibling(name: str, filename: str):
    import importlib.util
    spec = importlib.util.spec_from_file_location(name, SCRIPT_DIR / filename)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


coc_rules = _load_sibling("coc_rules", "coc_rules.py")
coc_roll = _load_sibling("coc_roll", "coc_roll.py")
coc_state = _load_sibling("coc_state", "coc_state.py")
coc_sanity = _load_sibling("coc_sanity", "coc_sanity.py")
coc_fileio = _load_sibling("coc_fileio", "coc_fileio.py")


def _investigators_root(campaign_dir: Path) -> Path:
    """Resolve ``.coc/investigators`` from a campaign directory.

    Expected layout: ``<root>/.coc/campaigns/<id>`` → sibling ``investigators/``.
    """
    campaign_dir = Path(campaign_dir)
    # .../.coc/campaigns/<id> → parents[1] is .coc
    if campaign_dir.parent.name == "campaigns":
        return campaign_dir.parents[1] / "investigators"
    # Fallback: treat campaign_dir.parent as the coc root.
    return campaign_dir.parent / "investigators"


def _investigator_dir(campaign_dir: Path, investigator_id: str) -> Path:
    return _investigators_root(campaign_dir) / investigator_id


def _development_path(campaign_dir: Path, investigator_id: str) -> Path:
    return _investigator_dir(campaign_dir, investigator_id) / "development.jsonl"


def _investigator_state_path(campaign_dir: Path, investigator_id: str) -> Path:
    return Path(campaign_dir) / "save" / "investigator-state" / f"{investigator_id}.json"


def _character_path(campaign_dir: Path, investigator_id: str) -> Path:
    return _investigator_dir(campaign_dir, investigator_id) / "character.json"


def _is_success(roll_result: dict[str, Any]) -> bool:
    if roll_result.get("success") is True:
        return True
    outcome = str(roll_result.get("outcome") or "").strip().lower()
    return outcome in _SUCCESS_OUTCOMES


def _is_bonus_die_only(roll_result: dict[str, Any]) -> bool:
    """True when structured evidence marks a bonus-die-only success (p.94)."""
    if roll_result.get("excluded_outcome") == "bonus_die_only_success":
        return True
    if roll_result.get("bonus_die_only_success") is True:
        return True
    # Structured reconstruction: bonus die present, no penalty, and the
    # non-bonus (highest) tens digit would have failed the effective target.
    bonus = int(roll_result.get("bonus", 0) or 0)
    penalty = int(roll_result.get("penalty", 0) or 0)
    tens_values = roll_result.get("tens_values")
    units = roll_result.get("units")
    if bonus <= 0 or penalty > 0 or not isinstance(tens_values, list) or len(tens_values) < 2:
        return False
    if units is None:
        return False
    try:
        target = int(roll_result.get("effective_target", roll_result.get("target", 0)))
        units_i = int(units)
        without_bonus = max(int(t) for t in tens_values) * 10 + units_i
        if without_bonus == 0:
            without_bonus = 100
        with_bonus = min(int(t) for t in tens_values) * 10 + units_i
        if with_bonus == 0:
            with_bonus = 100
    except (TypeError, ValueError):
        return False
    return with_bonus <= target < without_bonus


def _is_opposed_loser(roll_result: dict[str, Any]) -> bool:
    if roll_result.get("excluded_outcome") == "opposed_roll_loser":
        return True
    if roll_result.get("opposed_won") is False:
        return True
    opposed_outcome = str(roll_result.get("opposed_outcome") or "")
    if opposed_outcome in {"defender_higher", "tie_defender_wins", "attacker_lower"}:
        # Only treat as loser when this result is the investigator side of an
        # opposed check (structured flag) or kind is opposed.
        if roll_result.get("kind") in {"opposed_check", "opposed"} or "opposed" in str(
            roll_result.get("difficulty") or ""
        ):
            return True
        if roll_result.get("opposed_won") is False:
            return True
        # Explicit loser marker without needing kind.
        if opposed_outcome in {"defender_higher", "tie_defender_wins"}:
            return True
    return False


def _tick_excluded(skill: str, roll_result: dict[str, Any]) -> bool:
    """Return True when structured fields forbid awarding a development tick."""
    rule = coc_rules.development_rule()
    never = {str(s) for s in rule["tick"].get("never_tick_skills", [])}
    if skill in never:
        return True
    if not _is_success(roll_result):
        return True
    # Luck spend forfeits the tick (p.99) — explicit False wins.
    if roll_result.get("improvement_tick_eligible") is False:
        return True
    if roll_result.get("luck_spent"):
        return True
    if _is_bonus_die_only(roll_result):
        return True
    if _is_opposed_loser(roll_result):
        return True
    # Characteristic / SAN / Luck / damage rolls never tick (no skill sheet entry
    # required — callers pass skill name; kind gate when present).
    kind = str(roll_result.get("kind") or roll_result.get("roll_kind") or "")
    if kind in {"sanity_check", "sanity", "luck", "damage", "characteristic_check",
                "characteristic", "idea_roll", "idea"}:
        return True
    return False


def record_skill_tick(
    campaign_dir: Path,
    investigator_id: str,
    skill: str,
    roll_result: dict[str, Any],
) -> dict[str, Any] | None:
    """Append one development tick when the roll qualifies (p.94).

    Returns the tick record, or ``None`` when excluded by W0-6 structured rules.
    """
    skill = str(skill or "").strip()
    if not skill or not isinstance(roll_result, dict):
        return None
    if _tick_excluded(skill, roll_result):
        return None

    path = _development_path(campaign_dir, investigator_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    tick = {
        "skill": skill,
        "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "roll": roll_result.get("roll"),
    }
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(tick, ensure_ascii=False) + "\n")
    return tick


def _read_ticked_skills(path: Path) -> list[str]:
    if not path.exists():
        return []
    seen: list[str] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue
        skill = str(row.get("skill") or "").strip()
        if skill and skill not in seen:
            seen.append(skill)
    return seen


def _campaign_ticked_skills(campaign_dir: Path, investigator_id: str) -> list[str]:
    """Read toolbox-earned ticks from the campaign's transient investigator state."""
    path = _investigator_state_path(campaign_dir, investigator_id)
    if not path.is_file():
        return []
    try:
        state = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    earned = state.get("skill_checks_earned") if isinstance(state, dict) else None
    if not isinstance(earned, list):
        return []
    return list(dict.fromkeys(str(skill).strip() for skill in earned if str(skill).strip()))


def _clear_campaign_ticks(campaign_dir: Path, investigator_id: str) -> None:
    path = _investigator_state_path(campaign_dir, investigator_id)
    if not path.is_file():
        return
    try:
        state = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return
    if not isinstance(state, dict):
        return
    state["skill_checks_earned"] = []
    coc_fileio.write_json_atomic(path, state, indent=2, ensure_ascii=False)


def structured_ending_evidence(campaign_dir: Path) -> dict[str, Any] | None:
    """Return the latest persisted ending plus any authored scenario reward.

    The match is entirely structured: the ending event supplies the scene and
    ending kind, the story graph supplies its conclusion contract, and a
    same-named flag proves the conclusion when a SAN reward is present.
    """
    campaign_dir = Path(campaign_dir)
    event_path = campaign_dir / "logs" / "events.jsonl"
    if not event_path.is_file():
        return None
    ending: dict[str, Any] | None = None
    ending_index = 0
    for index, line in enumerate(event_path.read_text(encoding="utf-8").splitlines(), start=1):
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(row, dict) and row.get("event_type") == "session_ending":
            ending = row
            ending_index = index
    if ending is None:
        return None

    contract: dict[str, Any] = {}
    graph_path = campaign_dir / "scenario" / "story-graph.json"
    if graph_path.is_file():
        try:
            graph = json.loads(graph_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            graph = {}
        for scene in graph.get("scenes") or []:
            if isinstance(scene, dict) and scene.get("scene_id") == ending.get("scene_id"):
                candidate = scene.get("conclusion_contract")
                if isinstance(candidate, dict) and candidate.get("session_ending") is True:
                    contract = candidate
                break

    conclusion_id = contract.get("conclusion_id")
    conclusion_proven = False
    if ending.get("kind") == "conclusion" and isinstance(conclusion_id, str):
        flags_path = campaign_dir / "save" / "flags.json"
        try:
            flags = json.loads(flags_path.read_text(encoding="utf-8")) if flags_path.is_file() else {}
        except (OSError, json.JSONDecodeError):
            flags = {}
        conclusion_proven = (flags.get("flags") or {}).get(conclusion_id) is True

    reward = contract.get("sanity_reward") if conclusion_proven else None
    reward_expr = reward.get("die") if isinstance(reward, dict) else None
    identity_payload = {
        "event_line": ending_index,
        "scene_id": ending.get("scene_id"),
        "kind": ending.get("kind"),
        "ts": ending.get("ts"),
        "conclusion_id": conclusion_id if conclusion_proven else None,
    }
    ending_id = "ending-" + hashlib.sha256(
        json.dumps(identity_payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()[:20]
    return {
        "ending_id": ending_id,
        "event_line": ending_index,
        "scene_id": ending.get("scene_id"),
        "kind": ending.get("kind"),
        "conclusion_id": conclusion_id if conclusion_proven else None,
        "scenario_san_reward_expr": reward_expr if isinstance(reward_expr, str) else None,
        "scenario_san_reward_rule_ref": (
            reward.get("rule_ref") if isinstance(reward, dict) else None
        ),
    }


def _read_character(campaign_dir: Path, investigator_id: str) -> dict[str, Any]:
    path = _character_path(campaign_dir, investigator_id)
    if not path.exists():
        return {"skills": {}}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"skills": {}}
    return data if isinstance(data, dict) else {"skills": {}}


def _write_character(campaign_dir: Path, investigator_id: str, sheet: dict[str, Any]) -> None:
    path = _character_path(campaign_dir, investigator_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    coc_fileio.write_json_atomic(path, sheet, indent=2, ensure_ascii=False)


def _current_luck(campaign_dir: Path, investigator_id: str, sheet: dict[str, Any]) -> int:
    inv_path = Path(campaign_dir) / "save" / "investigator-state" / f"{investigator_id}.json"
    if inv_path.exists():
        try:
            inv = json.loads(inv_path.read_text(encoding="utf-8"))
            if inv.get("current_luck") is not None:
                return int(inv["current_luck"])
        except (OSError, ValueError, TypeError, json.JSONDecodeError):
            pass
    derived = sheet.get("derived") if isinstance(sheet.get("derived"), dict) else {}
    if derived.get("Luck") is not None:
        return int(derived["Luck"])
    chars = sheet.get("characteristics") if isinstance(sheet.get("characteristics"), dict) else {}
    if chars.get("LUCK") is not None:
        return int(chars["LUCK"])
    return 50


def _decay_awfulness(campaign_dir: Path, investigator_id: str) -> dict[str, int]:
    """Decrement each creature_type awfulness cap by 1 (floor 0) and persist."""
    save_path = Path(campaign_dir) / "save" / "sanity.json"
    if not save_path.exists():
        return {}
    try:
        sess = coc_sanity.SanitySession.load(campaign_dir, investigator_id)
    except Exception:
        return {}
    decayed: dict[str, int] = {}
    for creature, value in list(sess.awfulness_caps.items()):
        decayed[str(creature)] = max(0, int(value) - 1)
    sess.awfulness_caps = decayed
    sess.save(campaign_dir)
    return decayed


def run_development_phase(
    campaign_dir: Path,
    investigator_id: str,
    *,
    rng: random.Random | None = None,
) -> dict[str, Any]:
    """Settle the Investigator Development Phase for one investigator (p.94-95).

    Steps:
      1. Deduplicate ticked skills from development.jsonl
      2. Per skill: 1D100 > value or >95 → +1D10 write-back to character.json
      3. Any improved skill reaching ≥ san_reward_threshold → san_reward_expr
      4. Luck recovery via coc_roll.recover_luck + coc_state.apply_luck_recovery
      5. awfulness_caps each −1 (floor 0)
      6. Truncate development.jsonl
      7. Return structured summary
    """
    rng = rng or random.Random()
    campaign_dir = Path(campaign_dir)
    rule = coc_rules.development_rule()
    improvement = rule["improvement_roll"]
    always_above = int(improvement.get("always_improves_above", 95))
    # Prefer san_reward_threshold from table; fall back to cap_for_san_reward.
    table = coc_rules.load_rule_table("development")
    threshold = int(
        table.get("improvement_roll", {}).get(
            "san_reward_threshold",
            improvement.get("cap_for_san_reward", 90),
        )
    )
    san_expr = str(rule.get("sanity_reward", {}).get("reward", "2D6"))

    tick_path = _development_path(campaign_dir, investigator_id)
    skills_checked = list(dict.fromkeys(
        _read_ticked_skills(tick_path)
        + _campaign_ticked_skills(campaign_dir, investigator_id)
    ))
    sheet = _read_character(campaign_dir, investigator_id)
    skills = sheet.setdefault("skills", {})
    if not isinstance(skills, dict):
        skills = {}
        sheet["skills"] = skills

    improvement_checks: list[dict[str, Any]] = []
    skills_improved: list[dict[str, Any]] = []
    san_reward_expr: str | None = None

    for skill in skills_checked:
        current = int(skills.get(skill, 0) or 0)
        check_roll = rng.randint(1, 100)
        improved = check_roll > current or check_roll > always_above
        if not improved:
            improvement_checks.append({
                "skill": skill,
                "check_roll": check_roll,
                "value_before": current,
                "improved": False,
                "gain": None,
                "value_after": current,
            })
            continue
        gain = rng.randint(1, 10)
        new_value = current + gain
        skills[skill] = new_value
        row = {
            "skill": skill,
            "check_roll": check_roll,
            "gain": gain,
            "value_before": current,
            "value_after": new_value,
            "improved": True,
        }
        improvement_checks.append(dict(row))
        skills_improved.append(row)
        if new_value >= threshold:
            san_reward_expr = san_expr

    if skills_improved:
        _write_character(campaign_dir, investigator_id, sheet)

    luck_before = _current_luck(campaign_dir, investigator_id, sheet)
    luck_recovery = coc_roll.recover_luck(luck_before, rng=rng)
    coc_state.apply_luck_recovery(
        campaign_dir, investigator_id, luck_after=int(luck_recovery["luck_after"])
    )

    awfulness_decay = _decay_awfulness(campaign_dir, investigator_id)

    tick_path.parent.mkdir(parents=True, exist_ok=True)
    tick_path.write_text("", encoding="utf-8")
    _clear_campaign_ticks(campaign_dir, investigator_id)

    ending = structured_ending_evidence(campaign_dir)

    return {
        "skills_checked": skills_checked,
        "improvement_checks": improvement_checks,
        "skills_improved": skills_improved,
        "san_reward_expr": san_reward_expr,
        "ending_evidence": ending,
        "scenario_san_reward_expr": (
            ending.get("scenario_san_reward_expr") if ending else None
        ),
        "luck_recovery": luck_recovery,
        "awfulness_decay": awfulness_decay,
    }
