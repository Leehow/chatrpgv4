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
  save/sanity-state/<id>.json                — awfulness_caps decay
  save/sanity.json                           — legacy single-investigator mirror
"""
from __future__ import annotations

import json
import hashlib
import random
import re
import time
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent

_SUCCESS_OUTCOMES = frozenset({
    "critical", "extreme", "hard", "regular", "success",
    "extreme_success", "hard_success", "regular_success", "critical_success",
})
_SAFE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")


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


def _investigator_lock_path(campaign_dir: Path, investigator_id: str) -> Path:
    return (
        _investigators_root(campaign_dir).parent
        / "locks"
        / "investigators"
        / investigator_id
        / ".investigator.lock"
    )


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
    # physical/base roll would have failed the effective target.  The roller
    # stores that explicitly on new receipts; legacy receipts preserve it as
    # tens_values[0] followed by the extra tens dice.
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
        explicit_base = roll_result.get("unmodified_roll")
        without_bonus = (
            int(explicit_base)
            if explicit_base is not None
            else int(tens_values[0]) * 10 + units_i
        )
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


def skill_tick_eligible(skill: str, roll_result: dict[str, Any]) -> bool:
    """Return whether structured roll evidence earns a development tick.

    Toolbox percentile checks and subsystem combat rolls share this predicate
    so host adapters cannot drift into separate improvement rules.  Callers
    remain responsible for binding the roll to the active investigator and to
    a skill that exists on that investigator's reusable sheet.
    """
    skill = str(skill or "").strip()
    return bool(skill and isinstance(roll_result, dict) and not _tick_excluded(
        skill, roll_result
    ))


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
    if not skill_tick_eligible(skill, roll_result):
        return None

    path = _development_path(campaign_dir, investigator_id)
    tick = {
        "skill": skill,
        "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "roll": roll_result.get("roll"),
    }
    # The reusable tick log is shared by every campaign linked to this
    # investigator.  Callers already holding a campaign lock therefore follow
    # the same campaign -> investigator order as settlement.
    with coc_fileio.advisory_file_lock(
        _investigator_lock_path(campaign_dir, investigator_id),
        wait_seconds=5.0,
    ):
        path.parent.mkdir(parents=True, exist_ok=True)
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


def _consume_development_inputs(
    campaign_dir: Path,
    investigator_id: str,
    development_input: dict[str, Any] | None,
) -> None:
    """Consume only the input tokens owned by one ending capsule."""
    if development_input is None:
        tick_path = _development_path(campaign_dir, investigator_id)
        tick_path.parent.mkdir(parents=True, exist_ok=True)
        tick_path.write_text("", encoding="utf-8")
        _clear_campaign_ticks(campaign_dir, investigator_id)
        return

    legacy_tokens = {
        str(row.get("token"))
        for row in (development_input.get("legacy_tick_tokens") or [])
        if isinstance(row, dict) and isinstance(row.get("token"), str)
    }
    tick_path = _development_path(campaign_dir, investigator_id)
    if tick_path.is_file() and legacy_tokens:
        kept: list[str] = []
        for raw in tick_path.read_text(encoding="utf-8").splitlines():
            token = "legacy:" + hashlib.sha256(raw.encode("utf-8")).hexdigest()
            if token not in legacy_tokens:
                kept.append(raw)
        text = "\n".join(kept)
        if text:
            text += "\n"
        coc_fileio.write_text_atomic(tick_path, text)

    captured_skills = {
        str(row.get("skill"))
        for row in (development_input.get("campaign_skill_tokens") or [])
        if isinstance(row, dict) and isinstance(row.get("skill"), str)
    }
    state_path = _investigator_state_path(campaign_dir, investigator_id)
    if state_path.is_file() and captured_skills:
        try:
            state = json.loads(state_path.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError):
            state = None
        if isinstance(state, dict):
            earned = state.get("skill_checks_earned")
            if isinstance(earned, list):
                state["skill_checks_earned"] = [
                    skill for skill in earned if str(skill) not in captured_skills
                ]
                coc_fileio.write_json_atomic(
                    state_path, state, indent=2, ensure_ascii=False
                )


def _compile_ending_evidence(
    campaign_dir: Path,
    ending: dict[str, Any],
    ending_index: int,
    event_rows: list[tuple[int, dict[str, Any]]],
) -> dict[str, Any]:
    """Compile one exact ending event plus authored mechanical evidence.

    The match is entirely structured: the ending event supplies the scene and
    ending kind, the story graph supplies its conclusion contract, and any
    required combat outcome is proven by the canonical combat snapshot plus a
    matching ``combat_ended`` receipt recorded before the ending.  No prose,
    decision-id fragment, or duplicate generic flag participates in matching.
    """
    campaign_dir = Path(campaign_dir)

    contract: dict[str, Any] = {}
    graph_path = campaign_dir / "scenario" / "story-graph.json"
    graph_sha256: str | None = None
    if graph_path.is_file():
        try:
            graph_text = graph_path.read_text(encoding="utf-8")
            graph = json.loads(graph_text)
            graph_sha256 = hashlib.sha256(graph_text.encode("utf-8")).hexdigest()
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
    conclusion_evidence: dict[str, Any] | None = None
    if ending.get("kind") == "conclusion" and isinstance(conclusion_id, str):
        required_outcome = contract.get("requires_combat_outcome")
        if isinstance(required_outcome, str) and required_outcome:
            combat_path = campaign_dir / "save" / "combat.json"
            try:
                combat = (
                    json.loads(combat_path.read_text(encoding="utf-8"))
                    if combat_path.is_file() else {}
                )
            except (OSError, json.JSONDecodeError):
                combat = {}
            combat_id = combat.get("combat_id") if isinstance(combat, dict) else None
            scene_ref = combat.get("scene_ref") if isinstance(combat, dict) else None
            receipt_match = next((
                (index, row)
                for index, row in reversed(event_rows)
                if index < ending_index
                and row.get("event_type") == "combat_ended"
                and row.get("combat_id") == combat_id
            ), None)
            receipt_index = receipt_match[0] if receipt_match else None
            receipt = receipt_match[1] if receipt_match else None
            conclusion_proven = bool(
                isinstance(combat_id, str)
                and combat_id
                and scene_ref == f"scene/{ending.get('scene_id')}"
                and combat.get("status") == "concluded"
                and combat.get("outcome") == required_outcome
                and isinstance(receipt, dict)
                and receipt.get("outcome") == required_outcome
            )
            if conclusion_proven:
                conclusion_evidence = {
                    "kind": "combat_outcome",
                    "combat_id": combat_id,
                    "combat_outcome": required_outcome,
                    "scene_ref": scene_ref,
                    "event_type": "combat_ended",
                    "event_ref": f"logs/events.jsonl#{receipt_index}",
                    "event_sha256": hashlib.sha256(
                        json.dumps(
                            receipt,
                            sort_keys=True,
                            ensure_ascii=False,
                            separators=(",", ":"),
                        ).encode("utf-8")
                    ).hexdigest(),
                }
        else:
            # A conclusion contract without an additional mechanical
            # prerequisite is proven by the persisted conclusion ending itself.
            conclusion_proven = contract.get("session_ending") is True
            if conclusion_proven:
                conclusion_evidence = {
                    "kind": "session_ending",
                    "event_type": "session_ending",
                    "scene_id": ending.get("scene_id"),
                }

    reward = contract.get("sanity_reward") if conclusion_proven else None
    reward_expr = reward.get("die") if isinstance(reward, dict) else None
    scenario_id: str | None = None
    campaign_path = campaign_dir / "campaign.json"
    if campaign_path.is_file():
        try:
            campaign = json.loads(campaign_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            campaign = {}
        candidate = campaign.get("active_scenario_id") if isinstance(campaign, dict) else None
        if isinstance(candidate, str) and candidate:
            scenario_id = candidate
    if scenario_id is None:
        module_meta_path = campaign_dir / "scenario" / "module-meta.json"
        if module_meta_path.is_file():
            try:
                module_meta = json.loads(module_meta_path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                module_meta = {}
            candidate = module_meta.get("scenario_id") if isinstance(module_meta, dict) else None
            if isinstance(candidate, str) and candidate:
                scenario_id = candidate
    if scenario_id is None and graph_sha256 is not None:
        scenario_id = f"story-graph-{graph_sha256[:20]}"
    reward_identity: str | None = None
    if conclusion_proven and isinstance(conclusion_id, str):
        reward_material = {
            "scenario_id": scenario_id or "unidentified-scenario",
            "conclusion_id": conclusion_id,
        }
        reward_identity = "conclusion-reward-" + hashlib.sha256(
            json.dumps(
                reward_material, sort_keys=True, separators=(",", ":")
            ).encode("utf-8")
        ).hexdigest()[:24]
    identity_payload = {
        "event_line": ending_index,
        "scene_id": ending.get("scene_id"),
        "kind": ending.get("kind"),
        "ts": ending.get("ts"),
        "decision_id": ending.get("decision_id"),
        "conclusion_id": conclusion_id if conclusion_proven else None,
    }
    explicit_ending_id = ending.get("ending_id")
    ending_id = (
        str(explicit_ending_id)
        if isinstance(explicit_ending_id, str) and explicit_ending_id
        else "ending-" + hashlib.sha256(
            json.dumps(identity_payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
        ).hexdigest()[:20]
    )
    explicit_event_id = ending.get("event_id")
    event_id = (
        str(explicit_event_id)
        if isinstance(explicit_event_id, str) and explicit_event_id
        else ending_event_id(ending_id)
    )
    return {
        "ending_id": ending_id,
        "event_id": event_id,
        "event_line": ending_index,
        "event_ref": f"logs/events.jsonl#{event_id}",
        "scene_id": ending.get("scene_id"),
        "kind": ending.get("kind"),
        "summary": ending.get("summary"),
        "decision_id": ending.get("decision_id"),
        "investigator_ids": (
            [str(value) for value in ending.get("investigator_ids")]
            if isinstance(ending.get("investigator_ids"), list)
            and all(isinstance(value, str) for value in ending.get("investigator_ids"))
            else None
        ),
        "scenario_id": scenario_id,
        "conclusion_id": conclusion_id if conclusion_proven else None,
        "conclusion_evidence": conclusion_evidence,
        "conclusion_reward_id": reward_identity,
        "scenario_san_reward_expr": reward_expr if isinstance(reward_expr, str) else None,
        "scenario_san_reward_rule_ref": (
            reward.get("rule_ref") if isinstance(reward, dict) else None
        ),
    }


def _canonical_sha256(value: Any) -> str:
    return hashlib.sha256(
        json.dumps(
            value,
            sort_keys=True,
            ensure_ascii=False,
            separators=(",", ":"),
        ).encode("utf-8")
    ).hexdigest()


def _source_image(path: Path) -> dict[str, Any]:
    if not path.is_file():
        return {"exists": False, "sha256": None}
    return {
        "exists": True,
        "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
    }


def ending_settlement_capsule_path(campaign_dir: Path, ending_id: str) -> Path:
    if _SAFE_ID.fullmatch(str(ending_id)) is None:
        raise ValueError("ending_id is not a safe persisted identity")
    return (
        Path(campaign_dir)
        / "save"
        / "development-settlements"
        / "endings"
        / str(ending_id)
        / "capsule.json"
    )


def ending_settlement_path(
    campaign_dir: Path, ending_id: str, investigator_id: str
) -> Path:
    if _SAFE_ID.fullmatch(str(investigator_id)) is None:
        raise ValueError("investigator_id is not a safe persisted identity")
    return ending_settlement_capsule_path(campaign_dir, ending_id).with_name(
        f"{investigator_id}.json"
    )


def _safe_campaign_child_target(campaign_dir: Path, path: Path) -> bool:
    """Require a regular/nonexistent target beneath non-symlink parents."""
    campaign_dir = Path(campaign_dir)
    path = Path(path)
    try:
        relative = path.relative_to(campaign_dir)
        path.resolve(strict=False).relative_to(campaign_dir.resolve())
    except (OSError, ValueError):
        return False
    current = campaign_dir
    if current.is_symlink() or (current.exists() and not current.is_dir()):
        return False
    for part in relative.parts[:-1]:
        current = current / part
        if current.is_symlink() or (current.exists() and not current.is_dir()):
            return False
    return not path.is_symlink() and (not path.exists() or path.is_file())


def ending_id_for_event(ending: dict[str, Any]) -> str:
    """Return a stable idempotent identity before the event is appended."""
    explicit = ending.get("ending_id")
    if isinstance(explicit, str) and explicit:
        return explicit
    identity = {
        "decision_id": ending.get("decision_id"),
        "scene_id": ending.get("scene_id"),
        "kind": ending.get("kind"),
    }
    return "ending-" + _canonical_sha256(identity)[:20]


def ending_event_id(ending_id: str) -> str:
    if _SAFE_ID.fullmatch(str(ending_id)) is None:
        raise ValueError("ending_id is not a safe persisted identity")
    return "ending-event-" + hashlib.sha256(
        str(ending_id).encode("utf-8")
    ).hexdigest()[:20]


def _read_event_rows(campaign_dir: Path) -> list[tuple[int, dict[str, Any]]]:
    path = Path(campaign_dir) / "logs" / "events.jsonl"
    if not path.is_file():
        return []
    rows: list[tuple[int, dict[str, Any]]] = []
    for index, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(row, dict):
            rows.append((index, row))
    return rows


def _capsule_without_digest(capsule: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in capsule.items() if key != "capsule_sha256"}


def _valid_source_image(value: Any) -> bool:
    if not isinstance(value, dict) or set(value) != {"exists", "sha256"}:
        return False
    exists = value.get("exists")
    digest = value.get("sha256")
    if not isinstance(exists, bool):
        return False
    if not exists:
        return digest is None
    return bool(
        isinstance(digest, str)
        and re.fullmatch(r"[0-9a-f]{64}", digest) is not None
    )


def _valid_development_input(value: Any) -> bool:
    if not isinstance(value, dict):
        return False
    required = {
        "skills_checked",
        "legacy_tick_tokens",
        "campaign_skill_tokens",
        "input_tokens",
        "source_images",
        "input_sha256",
    }
    if set(value) != required:
        return False
    skills = value.get("skills_checked")
    legacy = value.get("legacy_tick_tokens")
    campaign = value.get("campaign_skill_tokens")
    tokens = value.get("input_tokens")
    source_images = value.get("source_images")
    if (
        not isinstance(skills, list)
        or not all(isinstance(skill, str) and skill for skill in skills)
        or len(skills) != len(set(skills))
        or not isinstance(legacy, list)
        or not all(
            isinstance(row, dict)
            and set(row) == {"skill", "token"}
            and isinstance(row.get("skill"), str)
            and bool(row.get("skill"))
            and isinstance(row.get("token"), str)
            for row in legacy
        )
        or not isinstance(campaign, list)
        or not all(
            isinstance(row, dict)
            and set(row) == {"skill", "generation", "token"}
            and isinstance(row.get("skill"), str)
            and bool(row.get("skill"))
            and isinstance(row.get("generation"), int)
            and not isinstance(row.get("generation"), bool)
            and row["generation"] >= 0
            and isinstance(row.get("token"), str)
            for row in campaign
        )
        or not isinstance(tokens, list)
        or not all(isinstance(token, str) and token for token in tokens)
        or not isinstance(source_images, dict)
        or set(source_images) != {"legacy_ticks", "investigator_state"}
        or not all(_valid_source_image(image) for image in source_images.values())
    ):
        return False
    expected_skills = list(dict.fromkeys(
        [row["skill"] for row in legacy]
        + [row["skill"] for row in campaign]
    ))
    expected_tokens = [row["token"] for row in [*legacy, *campaign]]
    return bool(
        skills == expected_skills
        and tokens == expected_tokens
        and value.get("input_sha256")
        == _canonical_sha256({
            key: item for key, item in value.items() if key != "input_sha256"
        })
    )


def _valid_ending_capsule(value: Any) -> bool:
    if not isinstance(value, dict):
        return False
    investigator_ids = value.get("investigator_ids")
    ending_id = value.get("ending_id")
    development_inputs = value.get("development_inputs")
    rng_identity = value.get("rng_identity")
    source_digest = value.get("source_digest")
    if not (
        value.get("schema_version") == 1
        and value.get("capsule_type") == "ending_settlement"
        and isinstance(ending_id, str)
        and _SAFE_ID.fullmatch(ending_id) is not None
        and isinstance(value.get("event_line_at_capture"), int)
        and not isinstance(value.get("event_line_at_capture"), bool)
        and value["event_line_at_capture"] >= 1
        and isinstance(value.get("event_id"), str)
        and value.get("event_id") == ending_event_id(ending_id)
        and value.get("event_ref") == f"logs/events.jsonl#{value['event_id']}"
        and isinstance(value.get("decision_id"), str)
        and bool(value.get("decision_id"))
        and value.get("kind") in {"conclusion", "tpk", "retreat", "cliffhanger"}
        and (
            value.get("summary") is None
            or isinstance(value.get("summary"), str)
        )
        and isinstance(investigator_ids, list)
        and all(isinstance(item, str) for item in investigator_ids)
        and len(investigator_ids) == len(set(investigator_ids))
        and all(_SAFE_ID.fullmatch(item) is not None for item in investigator_ids)
        and isinstance(development_inputs, dict)
        and isinstance(rng_identity, dict)
        and set(development_inputs) == set(investigator_ids)
        and set(rng_identity) == set(investigator_ids)
        and all(
            _valid_development_input(item)
            for item in development_inputs.values()
        )
        and all(
            isinstance(identity, dict)
            and identity == {
                "algorithm": "python-random-seed-v1",
                "seed_material": (
                    f"{ending_id}:{investigator_id}:development.settle"
                ),
            }
            for investigator_id, identity in rng_identity.items()
        )
        and isinstance(source_digest, dict)
        and set(source_digest) == {
            "campaign", "module_meta", "story_graph", "combat_snapshot"
        }
        and all(_valid_source_image(image) for image in source_digest.values())
        and isinstance(value.get("captured_at"), str)
        and value.get("capsule_sha256")
        == _canonical_sha256(_capsule_without_digest(value))
    ):
        return False
    return True


def load_ending_settlement_capsule(
    campaign_dir: Path, ending_id: str
) -> dict[str, Any] | None:
    path = ending_settlement_capsule_path(campaign_dir, ending_id)
    if not _safe_campaign_child_target(campaign_dir, path) or not path.is_file():
        return None
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        return None
    return value if _valid_ending_capsule(value) else None


def ending_settlement_capsule_for_decision(
    campaign_dir: Path,
    decision_id: str,
) -> dict[str, Any] | None:
    """Find an event-not-yet-appended capsule by its idempotent decision."""
    root = (
        Path(campaign_dir)
        / "save" / "development-settlements" / "endings"
    )
    if not root.is_dir():
        return None
    matches: list[dict[str, Any]] = []
    for path in sorted(root.glob("*/capsule.json")):
        if not _safe_campaign_child_target(campaign_dir, path):
            raise ValueError("ending settlement capsule target is unsafe")
        try:
            capsule = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError) as exc:
            raise ValueError("ending settlement capsule is unreadable") from exc
        if not _valid_ending_capsule(capsule):
            raise ValueError("ending settlement capsule is invalid")
        if capsule.get("decision_id") == decision_id:
            matches.append(capsule)
    if len(matches) > 1:
        raise ValueError(
            "multiple ending settlement capsules share one decision_id"
        )
    return matches[0] if matches else None


def _has_valid_exact_settlement(
    campaign_dir: Path,
    ending_id: str,
    investigator_id: str,
) -> bool:
    path = ending_settlement_path(campaign_dir, ending_id, investigator_id)
    if not _safe_campaign_child_target(campaign_dir, path) or not path.is_file():
        return False
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        return False
    receipt = value.get("receipt") if isinstance(value, dict) else None
    return bool(
        isinstance(value, dict)
        and value.get("schema_version") == 1
        and value.get("ending_id") == ending_id
        and value.get("investigator_id") == investigator_id
        and isinstance(receipt, dict)
        and receipt.get("schema_version") == 1
        and receipt.get("status") == "PASS"
        and receipt.get("kind") == "development.settle"
    )


def _prior_development_claims(
    campaign_dir: Path, investigator_id: str
) -> tuple[set[str], dict[str, int]]:
    """Return all durable input claims and settled generations per skill."""
    root = (
        Path(campaign_dir)
        / "save"
        / "development-settlements"
        / "endings"
    )
    claimed: set[str] = set()
    settled_by_skill: dict[str, int] = {}
    if not root.is_dir():
        return claimed, settled_by_skill
    for capsule_path in sorted(root.glob("*/capsule.json")):
        if not _safe_campaign_child_target(campaign_dir, capsule_path):
            continue
        try:
            capsule = json.loads(capsule_path.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError):
            continue
        if not _valid_ending_capsule(capsule):
            continue
        inputs = (capsule.get("development_inputs") or {}).get(investigator_id)
        if not isinstance(inputs, dict):
            continue
        tokens = inputs.get("input_tokens") or []
        claimed.update(str(token) for token in tokens if isinstance(token, str))
        ending_id = str(capsule["ending_id"])
        if not _has_valid_exact_settlement(
            campaign_dir, ending_id, investigator_id
        ):
            continue
        for row in inputs.get("campaign_skill_tokens") or []:
            if not isinstance(row, dict) or not isinstance(row.get("skill"), str):
                continue
            skill = row["skill"]
            settled_by_skill[skill] = settled_by_skill.get(skill, 0) + 1
    return claimed, settled_by_skill


def _development_input_snapshot(
    campaign_dir: Path, investigator_id: str
) -> dict[str, Any]:
    claimed, settled_by_skill = _prior_development_claims(
        campaign_dir, investigator_id
    )
    legacy_path = _development_path(campaign_dir, investigator_id)
    legacy_rows: list[dict[str, Any]] = []
    if legacy_path.is_file():
        for raw in legacy_path.read_text(encoding="utf-8").splitlines():
            if not raw.strip():
                continue
            try:
                row = json.loads(raw)
            except json.JSONDecodeError:
                continue
            skill = str(row.get("skill") or "").strip() if isinstance(row, dict) else ""
            if not skill:
                continue
            token = "legacy:" + hashlib.sha256(raw.encode("utf-8")).hexdigest()
            if token not in claimed:
                legacy_rows.append({"skill": skill, "token": token})

    campaign_rows: list[dict[str, Any]] = []
    for skill in _campaign_ticked_skills(campaign_dir, investigator_id):
        generation = settled_by_skill.get(skill, 0)
        token = "campaign:" + _canonical_sha256(
            {"skill": skill, "generation": generation}
        )
        if token not in claimed:
            campaign_rows.append({
                "skill": skill,
                "generation": generation,
                "token": token,
            })
    skills_checked = list(dict.fromkeys(
        [row["skill"] for row in legacy_rows]
        + [row["skill"] for row in campaign_rows]
    ))
    input_tokens = [
        row["token"] for row in [*legacy_rows, *campaign_rows]
    ]
    snapshot = {
        "skills_checked": skills_checked,
        "legacy_tick_tokens": legacy_rows,
        "campaign_skill_tokens": campaign_rows,
        "input_tokens": input_tokens,
        "source_images": {
            "legacy_ticks": _source_image(legacy_path),
            "investigator_state": _source_image(
                _investigator_state_path(campaign_dir, investigator_id)
            ),
        },
    }
    snapshot["input_sha256"] = _canonical_sha256(snapshot)
    return snapshot


def build_ending_settlement_capsule(
    campaign_dir: Path,
    ending_event: dict[str, Any],
    *,
    event_line: int | None = None,
) -> dict[str, Any]:
    """Freeze one ending's complete mechanical input before settlement."""
    campaign_dir = Path(campaign_dir)
    event = json.loads(json.dumps(ending_event, ensure_ascii=False))
    event["ending_id"] = ending_id_for_event(event)
    event.setdefault("event_id", ending_event_id(event["ending_id"]))
    rows = _read_event_rows(campaign_dir)
    event_path = campaign_dir / "logs" / "events.jsonl"
    current_line_count = (
        len(event_path.read_text(encoding="utf-8").splitlines())
        if event_path.is_file() else 0
    )
    line = int(event_line or (current_line_count + 1))
    evidence = _compile_ending_evidence(campaign_dir, event, line, rows)
    evidence["event_line_at_capture"] = evidence.pop("event_line")
    investigator_ids = (
        [str(item) for item in event["investigator_ids"]]
        if isinstance(event.get("investigator_ids"), list)
        and all(isinstance(item, str) for item in event["investigator_ids"])
        else []
    )
    development_inputs = {
        investigator_id: _development_input_snapshot(
            campaign_dir, investigator_id
        )
        for investigator_id in investigator_ids
    }
    rng_identity = {
        investigator_id: {
            "algorithm": "python-random-seed-v1",
            "seed_material": (
                f"{evidence['ending_id']}:{investigator_id}:development.settle"
            ),
        }
        for investigator_id in investigator_ids
    }
    capsule = {
        "schema_version": 1,
        "capsule_type": "ending_settlement",
        **evidence,
        "investigator_ids": investigator_ids,
        "source_digest": {
            "campaign": _source_image(campaign_dir / "campaign.json"),
            "module_meta": _source_image(
                campaign_dir / "scenario" / "module-meta.json"
            ),
            "story_graph": _source_image(
                campaign_dir / "scenario" / "story-graph.json"
            ),
            "combat_snapshot": _source_image(
                campaign_dir / "save" / "combat.json"
            ),
        },
        "development_inputs": development_inputs,
        "rng_identity": rng_identity,
        "captured_at": str(event.get("ts") or ""),
    }
    capsule["capsule_sha256"] = _canonical_sha256(
        _capsule_without_digest(capsule)
    )
    return capsule


def persist_ending_settlement_capsule(
    campaign_dir: Path, capsule: dict[str, Any]
) -> Path:
    if not _valid_ending_capsule(capsule):
        raise ValueError("ending settlement capsule is invalid")
    path = ending_settlement_capsule_path(campaign_dir, capsule["ending_id"])
    if not _safe_campaign_child_target(campaign_dir, path):
        raise ValueError("ending settlement capsule target is unsafe")
    path.parent.mkdir(parents=True, exist_ok=True)
    if not _safe_campaign_child_target(campaign_dir, path):
        raise ValueError("ending settlement capsule target became unsafe")
    coc_fileio.write_json_atomic(
        path,
        capsule,
        indent=2,
        ensure_ascii=False,
        trailing_newline=True,
    )
    return path


def structured_ending_evidence(
    campaign_dir: Path,
    *,
    ending_id: str | None = None,
    decision_id: str | None = None,
) -> dict[str, Any] | None:
    """Return one exact persisted ending, defaulting to the latest.

    New endings resolve through their immutable settlement capsule.  Legacy
    events without a capsule retain the old structured compilation path.
    """
    campaign_dir = Path(campaign_dir)
    rows = _read_event_rows(campaign_dir)
    candidates = [
        (index, row)
        for index, row in rows
        if row.get("event_type") == "session_ending"
    ]
    selected: tuple[int, dict[str, Any]] | None = None
    for index, row in candidates:
        if ending_id is not None and row.get("ending_id") != ending_id:
            if row.get("ending_id") is not None:
                continue
            # Compatibility for pre-capsule ending events: derive their old
            # structured identity once so an already-issued ledger ending_id
            # remains replayable after upgrade.
            if _compile_ending_evidence(
                campaign_dir, row, index, rows
            ).get("ending_id") != ending_id:
                continue
        if decision_id is not None and row.get("decision_id") != decision_id:
            continue
        selected = (index, row)
    if selected is None:
        return None
    index, ending = selected
    explicit_id = ending.get("ending_id")
    if isinstance(explicit_id, str):
        if _SAFE_ID.fullmatch(explicit_id) is None:
            return None
        capsule = load_ending_settlement_capsule(campaign_dir, explicit_id)
        capsule_contract = (
            "settlement_capsule_ref" in ending
            or "settlement_capsule_sha256" in ending
        )
        if capsule is None:
            # A versioned ending that declared a capsule must never drift back
            # to a fresh compilation from current scenario/combat state.
            if capsule_contract:
                return None
        else:
            if (
                capsule.get("decision_id") != ending.get("decision_id")
                or capsule.get("event_id") != ending.get("event_id")
                or capsule.get("captured_at") != str(ending.get("ts") or "")
                or capsule.get("summary") != ending.get("summary")
                or capsule.get("scene_id") != ending.get("scene_id")
                or capsule.get("kind") != ending.get("kind")
                or capsule.get("investigator_ids")
                != ending.get("investigator_ids")
            ):
                return None
            expected_digest = ending.get("settlement_capsule_sha256")
            if expected_digest not in (None, capsule.get("capsule_sha256")):
                return None
            return capsule
    return _compile_ending_evidence(campaign_dir, ending, index, rows)


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
    if not coc_sanity.sanity_snapshot_exists(campaign_dir, investigator_id):
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
    ending_evidence: dict[str, Any] | None = None,
    development_input: dict[str, Any] | None = None,
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
    if development_input is not None:
        frozen_skills = development_input.get("skills_checked")
        if not isinstance(frozen_skills, list) or not all(
            isinstance(skill, str) for skill in frozen_skills
        ):
            raise ValueError("ending development input skills are invalid")
        skills_checked = list(dict.fromkeys(frozen_skills))
    else:
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

    _consume_development_inputs(
        campaign_dir, investigator_id, development_input
    )

    ending = ending_evidence or structured_ending_evidence(campaign_dir)

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
