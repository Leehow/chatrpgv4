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
import uuid
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


def _development_claims_path(campaign_dir: Path, investigator_id: str) -> Path:
    return _investigator_dir(campaign_dir, investigator_id) / "development-claims.json"


def development_active_transaction_path(
    campaign_dir: Path, investigator_id: str
) -> Path:
    return (
        _investigator_dir(campaign_dir, investigator_id)
        / "development-active-transaction.json"
    )


class DevelopmentTransactionConflict(ValueError):
    """An incomplete transaction owns reusable-investigator state."""

    code = "RECOVERY_CONFLICT"

    def __init__(
        self, transaction_id: str, investigator_id: str, campaign_id: str
    ) -> None:
        self.transaction_id = transaction_id
        self.investigator_id = investigator_id
        self.campaign_id = campaign_id
        super().__init__(
            "RECOVERY_CONFLICT "
            f"{transaction_id}: investigator {investigator_id!r} has an active "
            f"development transaction owned by campaign {campaign_id!r}"
        )


def active_development_transaction(
    campaign_dir: Path, investigator_id: str
) -> dict[str, Any] | None:
    """Read the reusable investigator's transaction marker without mutating it."""
    path = development_active_transaction_path(campaign_dir, investigator_id)
    if path.is_symlink():
        raise ValueError("development active transaction marker is unsafe")
    if not path.is_file():
        return None
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise ValueError("development active transaction marker is unreadable") from exc
    required = {
        "schema_version", "status", "transaction_id", "investigator_id",
        "campaign_id", "ending_id", "inflight_ref", "created_at",
    }
    expected_transaction_id = None
    if isinstance(value, dict):
        ending_id = value.get("ending_id")
        if isinstance(ending_id, str):
            expected_transaction_id = "development-txn-" + hashlib.sha256(
                f"{ending_id}\0{investigator_id}".encode("utf-8")
            ).hexdigest()[:24]
    if (
        not isinstance(value, dict)
        or set(value) != required
        or value.get("schema_version") != 1
        or value.get("status") != "active"
        or value.get("investigator_id") != investigator_id
        or value.get("transaction_id") != expected_transaction_id
        or not all(
            isinstance(value.get(key), str) and value.get(key)
            for key in (
                "transaction_id", "campaign_id", "ending_id",
                "inflight_ref", "created_at",
            )
        )
        or _SAFE_ID.fullmatch(str(value.get("campaign_id"))) is None
        or _SAFE_ID.fullmatch(str(value.get("ending_id"))) is None
    ):
        raise ValueError("development active transaction marker is invalid")
    return value


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
        candidates = [
            100 if int(t) == 0 and units_i == 0 else int(t) * 10 + units_i
            for t in tens_values
        ]
        with_bonus = min(candidates)
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


def _campaign_id(campaign_dir: Path) -> str:
    path = Path(campaign_dir) / "campaign.json"
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        value = {}
    candidate = value.get("campaign_id") if isinstance(value, dict) else None
    return str(candidate) if isinstance(candidate, str) and candidate else Path(campaign_dir).name


def _logical_development_session_id(campaign_dir: Path) -> str:
    """Return the open play segment identity bounded by durable endings."""
    count = sum(
        1
        for _line, row in _read_event_rows(Path(campaign_dir))
        if row.get("event_type") == "session_ending"
    )
    return f"{_campaign_id(campaign_dir)}:session:{count + 1}"


def _tick_event_token(
    *,
    campaign_dir: Path,
    investigator_id: str,
    session_id: str,
    source_kind: str,
    source_event_id: str,
) -> str:
    # ``session_id`` is provenance, not immutable source identity.  A
    # canonical producer can be replayed after later endings once a bounded
    # host ledger rotates; including the then-current logical session would
    # turn that replay into a second earned check.
    identity = {
        "campaign_id": _campaign_id(campaign_dir),
        "investigator_id": investigator_id,
        "source_kind": source_kind,
        "source_event_id": source_event_id,
    }
    return "development-check-" + _canonical_sha256(identity)


def record_skill_tick(
    campaign_dir: Path,
    investigator_id: str,
    skill: str,
    roll_result: dict[str, Any],
    *,
    source_event_id: str | None = None,
    source_kind: str | None = None,
    session_id: str | None = None,
) -> dict[str, Any] | None:
    """Append one development tick when the roll qualifies (p.94).

    Returns the tick record, or ``None`` when excluded by W0-6 structured rules.
    """
    skill = str(skill or "").strip()
    if not skill_tick_eligible(skill, roll_result):
        return None
    if not isinstance(investigator_id, str) or _SAFE_ID.fullmatch(investigator_id) is None:
        raise ValueError("investigator_id must be a stable safe id")

    campaign_dir = Path(campaign_dir)
    path = _development_path(campaign_dir, investigator_id)
    stable_source_id = source_event_id
    if not isinstance(stable_source_id, str) or not stable_source_id:
        for key in ("source_event_id", "roll_id", "command_id", "decision_id"):
            candidate = roll_result.get(key)
            if isinstance(candidate, str) and candidate:
                stable_source_id = candidate
                break
    if not isinstance(stable_source_id, str) or not stable_source_id:
        stable_source_id = "generated:" + uuid.uuid4().hex
    stable_source_kind = str(
        source_kind
        or roll_result.get("source_kind")
        or roll_result.get("kind")
        or roll_result.get("roll_kind")
        or "skill_check"
    )
    stable_session_id = str(
        session_id
        or roll_result.get("session_id")
        or _logical_development_session_id(campaign_dir)
    )
    token = _tick_event_token(
        campaign_dir=campaign_dir,
        investigator_id=investigator_id,
        session_id=stable_session_id,
        source_kind=stable_source_kind,
        source_event_id=stable_source_id,
    )
    tick = {
        "schema_version": 2,
        "event_type": "development_check_earned",
        "event_token": token,
        "investigator_id": investigator_id,
        "campaign_id": _campaign_id(campaign_dir),
        "session_id": stable_session_id,
        "source_kind": stable_source_kind,
        "source_event_id": stable_source_id,
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
        active_transaction = active_development_transaction(
            campaign_dir, investigator_id
        )
        if active_transaction is not None:
            raise DevelopmentTransactionConflict(
                str(active_transaction.get("transaction_id") or "unknown-development-txn"),
                investigator_id,
                str(active_transaction.get("campaign_id") or "unknown-campaign"),
            )
        path.parent.mkdir(parents=True, exist_ok=True)
        existing_tick: dict[str, Any] | None = None
        existing_source_tick: dict[str, Any] | None = None
        if path.is_file():
            for raw in path.read_text(encoding="utf-8").splitlines():
                try:
                    existing = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                if isinstance(existing, dict) and existing.get("event_token") == token:
                    if existing.get("skill") != skill:
                        raise ValueError("development event token has conflicting skill")
                    existing_tick = existing
                    break
                if isinstance(existing, dict):
                    try:
                        if _development_event_identity(existing) == (
                            _development_event_identity(tick)
                        ):
                            existing_source_tick = existing
                    except (KeyError, TypeError, ValueError):
                        pass

        ledger = _load_development_claims(campaign_dir, investigator_id)
        _hydrate_development_event_archive(
            campaign_dir, investigator_id, ledger
        )
        archive = ledger["events"]
        archived = archive.get(token)
        identity = _development_event_identity(tick)
        if archived is not None:
            if _development_event_identity(archived) != identity:
                raise ValueError(
                    "development event token has conflicting durable identity"
                )
            if existing_tick is not None:
                return existing_tick
            # Claims survive active-queue consumption.  Return archived
            # evidence but mark it so callers do not recreate compatibility
            # projections for an already-consumed event.
            if token in ledger["claims"]:
                replay = dict(archived)
                replay["development_event_status"] = "already_claimed"
                return replay
            # Archive-before-append is deliberate.  If a process exited in
            # that tiny window, append the missing active row below.
        else:
            archive[token] = _development_event_archive_record(tick)
            ledger_path = _development_claims_path(campaign_dir, investigator_id)
            ledger_path.parent.mkdir(parents=True, exist_ok=True)
            coc_fileio.write_json_atomic(
                ledger_path, ledger, indent=2, ensure_ascii=False
            )
            if existing_tick is not None:
                return existing_tick
            if existing_source_tick is not None:
                return existing_source_tick
        if existing_source_tick is not None:
            return existing_source_tick
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

    if development_input.get("schema_version") == 2:
        tokens = {
            str(token)
            for token in (development_input.get("input_tokens") or [])
            if isinstance(token, str)
        }
        tick_path = _development_path(campaign_dir, investigator_id)
        if tick_path.is_file() and tokens:
            kept: list[str] = []
            for raw in tick_path.read_text(encoding="utf-8").splitlines():
                try:
                    row = json.loads(raw)
                except json.JSONDecodeError:
                    kept.append(raw)
                    continue
                if not isinstance(row, dict) or row.get("event_token") not in tokens:
                    kept.append(raw)
            text = "\n".join(kept)
            if text:
                text += "\n"
            coc_fileio.write_text_atomic(tick_path, text)
        state_path = _investigator_state_path(campaign_dir, investigator_id)
        if state_path.is_file() and tokens:
            try:
                state = json.loads(state_path.read_text(encoding="utf-8"))
            except (OSError, UnicodeError, json.JSONDecodeError):
                state = None
            if isinstance(state, dict):
                events = state.get("skill_check_events")
                if isinstance(events, list):
                    remaining = [
                        row for row in events
                        if not isinstance(row, dict)
                        or row.get("event_token") not in tokens
                    ]
                    state["skill_check_events"] = remaining
                    state["skill_checks_earned"] = list(dict.fromkeys(
                        str(row.get("skill"))
                        for row in remaining
                        if isinstance(row, dict)
                        and isinstance(row.get("skill"), str)
                        and row.get("skill")
                    ))
                    coc_fileio.write_json_atomic(
                        state_path, state, indent=2, ensure_ascii=False
                    )
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


def _valid_development_input_v1(value: Any) -> bool:
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


def _valid_frozen_roll(value: Any) -> bool:
    return bool(
        isinstance(value, dict)
        and set(value) == {"expression", "count", "sides", "modifier", "rolls", "total"}
        and isinstance(value.get("expression"), str)
        and isinstance(value.get("count"), int)
        and not isinstance(value.get("count"), bool)
        and value["count"] > 0
        and isinstance(value.get("sides"), int)
        and not isinstance(value.get("sides"), bool)
        and value["sides"] > 0
        and isinstance(value.get("modifier"), int)
        and not isinstance(value.get("modifier"), bool)
        and isinstance(value.get("rolls"), list)
        and len(value["rolls"]) == value["count"]
        and all(
            isinstance(item, int)
            and not isinstance(item, bool)
            and 1 <= item <= value["sides"]
            for item in value["rolls"]
        )
        and isinstance(value.get("total"), int)
        and not isinstance(value.get("total"), bool)
        and value["total"] == sum(value["rolls"]) + value["modifier"]
    )


def _valid_plan_against_baseline(
    plan: dict[str, Any], baseline: dict[str, Any], skills: list[str]
) -> bool:
    table = coc_rules.load_rule_table("development")
    rule = coc_rules.development_rule()
    improvement = rule["improvement_roll"]
    always_above = int(improvement.get("always_improves_above", 95))
    threshold = int(table.get("improvement_roll", {}).get(
        "san_reward_threshold", improvement.get("cap_for_san_reward", 90)
    ))
    earns_development_san = False
    for row in plan.get("improvement_checks") or []:
        skill = row.get("skill")
        before = baseline["skills"].get(skill)
        gain = row.get("gain") or 0
        if (
            before != row.get("value_before")
            or row.get("planned_value_after") != before + gain
            or not 1 <= int(row.get("check_roll") or 0) <= 100
            or (
                row.get("improved") is not (
                    row["check_roll"] > before or row["check_roll"] > always_above
                )
            )
        ):
            return False
        earns_development_san = earns_development_san or (
            bool(row["improved"]) and int(row["planned_value_after"]) >= threshold
        )
    luck = plan.get("luck_recovery")
    if not isinstance(luck, dict) or set(luck) != {
        "roll", "success", "gained", "luck_before", "luck_after", "rule_ref"
    }:
        return False
    if (
        isinstance(luck.get("roll"), bool)
        or not isinstance(luck.get("roll"), int)
        or not 1 <= luck["roll"] <= 100
        or not isinstance(luck.get("success"), bool)
        or luck["luck_before"] != baseline["luck"]
        or luck["success"] is not (luck["roll"] > baseline["luck"])
        or isinstance(luck.get("gained"), bool)
        or not isinstance(luck.get("gained"), int)
        or not 0 <= luck["gained"] <= 10
        or luck["luck_after"] != min(99, baseline["luck"] + luck["gained"])
        or (not luck["success"] and luck["gained"] != 0)
    ):
        return False
    development_reward = plan.get("development_san_reward")
    if earns_development_san != isinstance(development_reward, dict):
        return False
    if isinstance(development_reward, dict) and development_reward.get(
        "expression"
    ) != str(rule.get("sanity_reward", {}).get("reward", "2D6")):
        return False
    if plan.get("awfulness_decay") != {
        key: max(0, int(value) - 1)
        for key, value in baseline["sanity"]["awfulness_caps"].items()
    }:
        return False
    if plan.get("schema_version") == 2:
        current = int(baseline["sanity"]["current"])
        maximum = int(baseline["sanity"]["max"])
        development_total = (
            int(development_reward["total"])
            if isinstance(development_reward, dict) else 0
        )
        development_delta = min(development_total, maximum - current)
        current += development_delta
        scenario_reward = plan.get("scenario_san_reward")
        scenario_total = (
            int(scenario_reward["total"])
            if isinstance(scenario_reward, dict) else 0
        )
        scenario_delta = min(scenario_total, maximum - current)
        if (
            plan.get("development_san_planned_delta") != development_delta
            or plan.get("scenario_san_planned_delta") != scenario_delta
        ):
            return False
    return True


def _valid_development_input_v2(value: Any) -> bool:
    if not isinstance(value, dict):
        return False
    required = {
        "schema_version",
        "skills_checked",
        "check_events",
        "input_tokens",
        "claim_owner",
        "source_images",
        "mechanical_baseline",
        "deterministic_plan",
        "input_sha256",
    }
    if set(value) != required or value.get("schema_version") != 2:
        return False
    skills = value.get("skills_checked")
    events = value.get("check_events")
    tokens = value.get("input_tokens")
    owner = value.get("claim_owner")
    images = value.get("source_images")
    baseline = value.get("mechanical_baseline")
    plan = value.get("deterministic_plan")
    if (
        not isinstance(skills, list)
        or not all(isinstance(item, str) and item for item in skills)
        or len(skills) != len(set(skills))
        or not isinstance(events, list)
        or not all(
            isinstance(row, dict)
            and set(row) == {
                "event_token", "skill", "campaign_id", "session_id",
                "source_kind", "source_event_id",
            }
            and all(isinstance(row.get(key), str) and row.get(key) for key in row)
            for row in events
        )
        or not isinstance(tokens, list)
        or tokens != [row["event_token"] for row in events]
        or len(tokens) != len(set(tokens))
        or skills != list(dict.fromkeys(row["skill"] for row in events))
        or not isinstance(owner, dict)
        or set(owner) != {"campaign_id", "ending_id", "investigator_id"}
        or not all(isinstance(owner.get(key), str) and owner.get(key) for key in owner)
        or _SAFE_ID.fullmatch(owner["ending_id"]) is None
        or _SAFE_ID.fullmatch(owner["investigator_id"]) is None
        or not isinstance(images, dict)
        or set(images) != {
            "development_events", "investigator_state", "claim_ledger",
            "character", "sanity",
        }
        or not all(_valid_source_image(image) for image in images.values())
        or not isinstance(baseline, dict)
        or set(baseline) != {"skills", "luck", "sanity"}
        or not isinstance(baseline.get("skills"), dict)
        or set(baseline["skills"]) != set(skills)
        or not all(
            isinstance(key, str)
            and isinstance(item, int)
            and not isinstance(item, bool)
            and item >= 0
            for key, item in baseline["skills"].items()
        )
        or isinstance(baseline.get("luck"), bool)
        or not isinstance(baseline.get("luck"), int)
        or not 0 <= baseline["luck"] <= 99
        or not isinstance(baseline.get("sanity"), dict)
        or set(baseline["sanity"]) != {"source", "current", "max", "awfulness_caps"}
        or baseline["sanity"].get("source") not in {
            "canonical", "legacy_owner", "investigator_state"
        }
        or any(
            isinstance(baseline["sanity"].get(key), bool)
            or not isinstance(baseline["sanity"].get(key), int)
            for key in ("current", "max")
        )
        or not 0 <= baseline["sanity"]["current"] <= baseline["sanity"]["max"] <= 99
        or not isinstance(baseline["sanity"].get("awfulness_caps"), dict)
        or not all(
            isinstance(key, str)
            and isinstance(item, int)
            and not isinstance(item, bool)
            and item >= 0
            for key, item in baseline["sanity"]["awfulness_caps"].items()
        )
        or not isinstance(plan, dict)
        or plan.get("schema_version") not in {1, 2}
        or (
            plan.get("schema_version") == 1
            and set(plan) != {
                "schema_version", "improvement_checks", "luck_recovery",
                "awfulness_decay", "development_san_reward",
                "scenario_san_reward", "plan_sha256",
            }
        )
        or (
            plan.get("schema_version") == 2
            and set(plan) != {
                "schema_version", "improvement_checks", "luck_recovery",
                "awfulness_decay", "development_san_reward",
                "scenario_san_reward", "development_san_planned_delta",
                "scenario_san_planned_delta", "plan_sha256",
            }
        )
        or not isinstance(plan.get("improvement_checks"), list)
        or [row.get("skill") for row in plan["improvement_checks"]] != skills
        or not all(
            isinstance(row, dict)
            and set(row) == {
                "skill", "check_roll", "gain", "value_before",
                "planned_value_after", "improved",
            }
            and isinstance(row.get("check_roll"), int)
            and isinstance(row.get("value_before"), int)
            and isinstance(row.get("planned_value_after"), int)
            and isinstance(row.get("improved"), bool)
            and (
                (row["improved"] and isinstance(row.get("gain"), int) and row["gain"] > 0)
                or (not row["improved"] and row.get("gain") is None)
            )
            for row in plan["improvement_checks"]
        )
        or not isinstance(plan.get("luck_recovery"), dict)
        or not isinstance(plan.get("awfulness_decay"), dict)
        or (
            plan.get("development_san_reward") is not None
            and not _valid_frozen_roll(plan.get("development_san_reward"))
        )
        or (
            plan.get("scenario_san_reward") is not None
            and not _valid_frozen_roll(plan.get("scenario_san_reward"))
        )
        or (
            plan.get("schema_version") == 2
            and any(
                isinstance(plan.get(key), bool)
                or not isinstance(plan.get(key), int)
                or plan[key] < 0
                for key in (
                    "development_san_planned_delta",
                    "scenario_san_planned_delta",
                )
            )
        )
        or plan.get("plan_sha256") != _canonical_sha256({
            key: item for key, item in plan.items() if key != "plan_sha256"
        })
        or not _valid_plan_against_baseline(plan, baseline, skills)
    ):
        return False
    return value.get("input_sha256") == _canonical_sha256({
        key: item for key, item in value.items() if key != "input_sha256"
    })


def _valid_development_input(value: Any) -> bool:
    return _valid_development_input_v1(value) or _valid_development_input_v2(value)


def _valid_ending_capsule(value: Any) -> bool:
    if not isinstance(value, dict):
        return False
    investigator_ids = value.get("investigator_ids")
    ending_id = value.get("ending_id")
    development_inputs = value.get("development_inputs")
    rng_identity = value.get("rng_identity")
    source_digest = value.get("source_digest")
    if not (
        value.get("schema_version") in {1, 2}
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
            (
                item.get("schema_version") == 2
                and item.get("claim_owner") == {
                    "campaign_id": item["claim_owner"]["campaign_id"],
                    "ending_id": ending_id,
                    "investigator_id": investigator_id,
                }
            )
            if value.get("schema_version") == 2 else _valid_development_input_v1(item)
            for investigator_id, item in development_inputs.items()
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
        and (
            value.get("schema_version") != 2
            or all(
                (
                    isinstance(value.get("scenario_san_reward_expr"), str)
                    and isinstance(
                        item["deterministic_plan"].get("scenario_san_reward"), dict
                    )
                    and item["deterministic_plan"]["scenario_san_reward"].get(
                        "expression"
                    ) == value.get("scenario_san_reward_expr")
                )
                or (
                    value.get("scenario_san_reward_expr") is None
                    and item["deterministic_plan"].get("scenario_san_reward") is None
                )
                for item in development_inputs.values()
            )
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


def _capsule_tick_event(row: dict[str, Any]) -> dict[str, str]:
    return {
        "event_token": str(row["event_token"]),
        "skill": str(row["skill"]),
        "campaign_id": str(row["campaign_id"]),
        "session_id": str(row["session_id"]),
        "source_kind": str(row["source_kind"]),
        "source_event_id": str(row["source_event_id"]),
    }


def _development_event_identity(row: dict[str, Any]) -> dict[str, str]:
    """Return the immutable producer identity; session/time/roll are evidence."""
    return {
        "investigator_id": str(row["investigator_id"]),
        "campaign_id": str(row["campaign_id"]),
        "source_kind": str(row["source_kind"]),
        "source_event_id": str(row["source_event_id"]),
        "skill": str(row["skill"]),
    }


def _development_event_archive_record(
    row: dict[str, Any], *, investigator_id: str | None = None
) -> dict[str, Any]:
    return {
        "schema_version": 1,
        "event_token": str(row["event_token"]),
        "investigator_id": str(
            row.get("investigator_id") or investigator_id or ""
        ),
        "campaign_id": str(row["campaign_id"]),
        "session_id": str(row["session_id"]),
        "source_kind": str(row["source_kind"]),
        "source_event_id": str(row["source_event_id"]),
        "skill": str(row["skill"]),
        "ts": str(row.get("ts") or ""),
        "roll": row.get("roll"),
    }


def _valid_development_event_archive_record(
    token: str, value: Any, investigator_id: str
) -> bool:
    required = {
        "schema_version", "event_token", "investigator_id", "campaign_id",
        "session_id", "source_kind", "source_event_id", "skill", "ts", "roll",
    }
    return bool(
        isinstance(value, dict)
        and set(value) == required
        and value.get("schema_version") == 1
        and value.get("event_token") == token
        and value.get("investigator_id") == investigator_id
        and all(
            isinstance(value.get(key), str) and value.get(key)
            for key in (
                "campaign_id", "session_id", "source_kind",
                "source_event_id", "skill",
            )
        )
        and isinstance(value.get("ts"), str)
    )


def _migrate_reusable_tick_events(
    campaign_dir: Path, investigator_id: str
) -> list[dict[str, str]]:
    """Normalize legacy rows to immutable reusable event identities in place."""
    path = _development_path(campaign_dir, investigator_id)
    if not path.is_file():
        return []
    raw_lines = path.read_text(encoding="utf-8").splitlines()
    normalized_lines: list[str] = []
    events: list[dict[str, str]] = []
    by_token: dict[str, dict[str, Any]] = {}
    occurrences: dict[str, int] = {}
    changed = False
    for raw in raw_lines:
        if not raw.strip():
            changed = True
            continue
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            # Malformed historical rows were never valid settlement input. Keep
            # their bytes for operator inspection; do not invent semantics.
            normalized_lines.append(raw)
            continue
        if not isinstance(parsed, dict):
            normalized_lines.append(raw)
            continue
        skill = str(parsed.get("skill") or "").strip()
        if not skill:
            normalized_lines.append(raw)
            continue
        token = parsed.get("event_token")
        if isinstance(token, str) and token:
            required = (
                "campaign_id", "session_id", "source_kind", "source_event_id"
            )
            if not all(isinstance(parsed.get(key), str) and parsed.get(key) for key in required):
                raise ValueError("development event identity is incomplete")
            normalized = dict(parsed)
        else:
            digest = hashlib.sha256(raw.encode("utf-8")).hexdigest()
            occurrence = occurrences.get(digest, 0)
            occurrences[digest] = occurrence + 1
            source_event_id = f"legacy-row:{digest}:{occurrence}"
            legacy_identity = {
                "investigator_id": investigator_id,
                "source_event_id": source_event_id,
            }
            token = "development-check-legacy-" + _canonical_sha256(legacy_identity)
            normalized = {
                "schema_version": 2,
                "event_type": "development_check_earned",
                "event_token": token,
                "investigator_id": investigator_id,
                "campaign_id": "legacy-unattributed",
                "session_id": "legacy-unattributed",
                "source_kind": "legacy.development_row",
                "source_event_id": source_event_id,
                "skill": skill,
                "ts": str(parsed.get("ts") or ""),
                "roll": parsed.get("roll"),
            }
            changed = True
        prior = by_token.get(str(token))
        if prior is not None:
            if _capsule_tick_event(prior) != _capsule_tick_event(normalized):
                raise ValueError("development event token is duplicated with conflicting identity")
            changed = True
            continue
        by_token[str(token)] = normalized
        events.append(_capsule_tick_event(normalized))
        encoded = json.dumps(normalized, ensure_ascii=False, separators=(",", ":"))
        normalized_lines.append(encoded)
        if encoded != raw:
            changed = True
    if changed:
        text = "\n".join(normalized_lines)
        if text:
            text += "\n"
        coc_fileio.write_text_atomic(path, text)
    return events


def _migrate_campaign_skill_names(
    campaign_dir: Path,
    investigator_id: str,
    events: list[dict[str, str]],
) -> list[dict[str, str]]:
    """Conservatively materialize old skill-name state as one event per name."""
    state_path = _investigator_state_path(campaign_dir, investigator_id)
    if not state_path.is_file():
        return events
    try:
        state = json.loads(state_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        return events
    if not isinstance(state, dict):
        return events
    campaign_id = _campaign_id(campaign_dir)
    compatibility_events = state.get("skill_check_events")
    if not isinstance(compatibility_events, list):
        compatibility_events = []
    normalized_compatibility: list[dict[str, str]] = []
    for row in compatibility_events:
        if not isinstance(row, dict):
            continue
        try:
            event = _capsule_tick_event(row)
        except (KeyError, TypeError, ValueError):
            continue
        if not all(event.values()):
            continue
        normalized_compatibility.append(event)
    by_token = {row["event_token"]: row for row in events}
    for event in normalized_compatibility:
        token = event["event_token"]
        prior = by_token.get(token)
        if prior is not None and prior != event:
            raise ValueError(
                "development event token has conflicting campaign identity"
            )
        by_token[token] = event
    earned = state.get("skill_checks_earned")
    earned_skills = (
        list(dict.fromkeys(str(item).strip() for item in earned if str(item).strip()))
        if isinstance(earned, list) else []
    )
    appended: list[dict[str, Any]] = []
    for index, skill in enumerate(earned_skills):
        if any(
            row["skill"] == skill
            and row["campaign_id"] in {campaign_id, "legacy-unattributed"}
            for row in by_token.values()
        ):
            continue
        source_event_id = f"legacy-state:{campaign_id}:{investigator_id}:{index}:{skill}"
        token = _tick_event_token(
            campaign_dir=campaign_dir,
            investigator_id=investigator_id,
            session_id=_logical_development_session_id(campaign_dir),
            source_kind="legacy.investigator_state",
            source_event_id=source_event_id,
        )
        event = {
            "event_token": token,
            "skill": skill,
            "campaign_id": campaign_id,
            "session_id": _logical_development_session_id(campaign_dir),
            "source_kind": "legacy.investigator_state",
            "source_event_id": source_event_id,
        }
        if token not in by_token:
            by_token[token] = event
            appended.append({
                "schema_version": 2,
                "event_type": "development_check_earned",
                **event,
                "investigator_id": investigator_id,
                "ts": "",
                "roll": None,
            })
    if appended:
        tick_path = _development_path(campaign_dir, investigator_id)
        tick_path.parent.mkdir(parents=True, exist_ok=True)
        with tick_path.open("a", encoding="utf-8") as handle:
            for row in appended:
                handle.write(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n")
    all_events = list(by_token.values())
    campaign_events = [
        row for row in all_events
        if row["campaign_id"] == campaign_id
        or (
            row["campaign_id"] == "legacy-unattributed"
            and row["skill"] in earned_skills
        )
    ]
    state["skill_check_events"] = campaign_events
    state["skill_checks_earned"] = list(dict.fromkeys(
        row["skill"] for row in campaign_events
    ))
    coc_fileio.write_json_atomic(state_path, state, indent=2, ensure_ascii=False)
    return all_events


def _load_development_claims(
    campaign_dir: Path, investigator_id: str
) -> dict[str, Any]:
    path = _development_claims_path(campaign_dir, investigator_id)
    if not path.is_file():
        return {
            "schema_version": 2,
            "investigator_id": investigator_id,
            "claims": {},
            "events": {},
            "capsule_archive_hydrated": False,
        }
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise ValueError("development claim ledger is unreadable") from exc
    claims = value.get("claims") if isinstance(value, dict) else None
    events = value.get("events") if isinstance(value, dict) else None
    schema_version = value.get("schema_version") if isinstance(value, dict) else None
    if (
        not isinstance(value, dict)
        or schema_version not in {1, 2}
        or value.get("investigator_id") != investigator_id
        or not isinstance(claims, dict)
        or not all(
            isinstance(token, str)
            and token
            and isinstance(claim, dict)
            and set(claim) == {
                "campaign_id", "ending_id", "investigator_id", "claimed_at"
            }
            and isinstance(claim.get("campaign_id"), str)
            and isinstance(claim.get("ending_id"), str)
            and _SAFE_ID.fullmatch(claim["ending_id"]) is not None
            and claim.get("investigator_id") == investigator_id
            and isinstance(claim.get("claimed_at"), str)
            for token, claim in claims.items()
        )
    ):
        raise ValueError("development claim ledger identity is invalid")
    if schema_version == 1:
        if set(value) != {"schema_version", "investigator_id", "claims"}:
            raise ValueError("development claim ledger identity is invalid")
        return {
            "schema_version": 2,
            "investigator_id": investigator_id,
            "claims": claims,
            "events": {},
            "capsule_archive_hydrated": False,
        }
    if (
        set(value) != {
            "schema_version", "investigator_id", "claims", "events",
            "capsule_archive_hydrated",
        }
        or not isinstance(value.get("capsule_archive_hydrated"), bool)
        or not isinstance(events, dict)
        or not all(
            isinstance(token, str)
            and token
            and _valid_development_event_archive_record(
                token, event, investigator_id
            )
            for token, event in events.items()
        )
    ):
        raise ValueError("development event archive identity is invalid")
    return value


def _hydrate_development_event_archive(
    campaign_dir: Path,
    investigator_id: str,
    ledger: dict[str, Any],
) -> bool:
    """Adopt durable pre-v4 capsule identities into the reusable archive."""
    if ledger.get("capsule_archive_hydrated") is True:
        return False
    changed = False
    campaigns_root = Path(campaign_dir).parent
    if not campaigns_root.is_dir():
        return False
    for capsule_path in sorted(
        campaigns_root.glob(
            "*/save/development-settlements/endings/*/capsule.json"
        )
    ):
        try:
            capsule = json.loads(capsule_path.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError):
            continue
        if not _valid_ending_capsule(capsule):
            continue
        development_input = (
            capsule.get("development_inputs") or {}
        ).get(investigator_id)
        if (
            not isinstance(development_input, dict)
            or development_input.get("schema_version") != 2
        ):
            continue
        owner = development_input.get("claim_owner")
        if not isinstance(owner, dict):
            continue
        old_tokens = development_input.get("input_tokens") or []
        for index, event in enumerate(development_input.get("check_events") or []):
            if not isinstance(event, dict):
                continue
            stable_identity = {
                "campaign_id": str(event.get("campaign_id") or ""),
                "investigator_id": investigator_id,
                "source_kind": str(event.get("source_kind") or ""),
                "source_event_id": str(event.get("source_event_id") or ""),
            }
            if not all(stable_identity.values()):
                continue
            stable_token = "development-check-" + _canonical_sha256(
                stable_identity
            )
            archive_record = _development_event_archive_record(
                {
                    **event,
                    "event_token": stable_token,
                    "investigator_id": investigator_id,
                    "ts": "",
                    "roll": None,
                }
            )
            prior_event = ledger["events"].get(stable_token)
            if prior_event is None:
                ledger["events"][stable_token] = archive_record
                changed = True
            elif _development_event_identity(
                prior_event
            ) != _development_event_identity(archive_record):
                raise ValueError(
                    "development event archive has conflicting capsule identity"
                )
            old_token = old_tokens[index] if index < len(old_tokens) else None
            prior_claim = (
                ledger["claims"].get(old_token)
                if isinstance(old_token, str) else None
            )
            claim = (
                dict(prior_claim)
                if isinstance(prior_claim, dict)
                else {
                    "campaign_id": str(owner.get("campaign_id") or ""),
                    "ending_id": str(owner.get("ending_id") or ""),
                    "investigator_id": investigator_id,
                    "claimed_at": str(capsule.get("captured_at") or ""),
                }
            )
            existing_claim = ledger["claims"].get(stable_token)
            if existing_claim is None:
                ledger["claims"][stable_token] = claim
                changed = True
            elif any(
                existing_claim.get(key) != claim.get(key)
                for key in ("campaign_id", "ending_id", "investigator_id")
            ):
                raise ValueError(
                    "development event archive has conflicting capsule owner"
                )
    ledger["capsule_archive_hydrated"] = True
    changed = True
    if changed:
        path = _development_claims_path(campaign_dir, investigator_id)
        path.parent.mkdir(parents=True, exist_ok=True)
        coc_fileio.write_json_atomic(path, ledger, indent=2, ensure_ascii=False)
    return changed


def _claim_development_events(
    campaign_dir: Path,
    investigator_id: str,
    *,
    ending_id: str,
) -> tuple[list[dict[str, str]], dict[str, Any]]:
    events = _migrate_reusable_tick_events(campaign_dir, investigator_id)
    events = _migrate_campaign_skill_names(campaign_dir, investigator_id, events)
    ledger = _load_development_claims(campaign_dir, investigator_id)
    _hydrate_development_event_archive(campaign_dir, investigator_id, ledger)
    owner = {
        "campaign_id": _campaign_id(campaign_dir),
        "ending_id": ending_id,
        "investigator_id": investigator_id,
    }
    claims = ledger["claims"]
    archive = ledger["events"]
    owned: list[dict[str, str]] = []
    changed = ledger.get("schema_version") != 2
    for event in events:
        token = event["event_token"]
        archived = archive.get(token)
        archive_record = _development_event_archive_record(
            event, investigator_id=investigator_id
        )
        if archived is None:
            archive[token] = archive_record
            changed = True
        elif _development_event_identity(archived) != _development_event_identity(
            archive_record
        ):
            raise ValueError(
                "development event token has conflicting durable identity"
            )
        stable_token = "development-check-" + _canonical_sha256({
            "campaign_id": event["campaign_id"],
            "investigator_id": investigator_id,
            "source_kind": event["source_kind"],
            "source_event_id": event["source_event_id"],
        })
        claim_tokens = [token]
        if stable_token != token:
            stable_archive = _development_event_archive_record(
                {**event, "event_token": stable_token},
                investigator_id=investigator_id,
            )
            prior_stable = archive.get(stable_token)
            if prior_stable is None:
                archive[stable_token] = stable_archive
                changed = True
            elif _development_event_identity(
                prior_stable
            ) != _development_event_identity(stable_archive):
                raise ValueError(
                    "development event stable alias has conflicting identity"
                )
            claim_tokens.append(stable_token)
        priors = [claims.get(item) for item in claim_tokens]
        foreign_owner = any(
            prior is not None
            and not all(prior.get(key) == value for key, value in owner.items())
            for prior in priors
        )
        if foreign_owner:
            continue
        claimed_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        for claim_token, prior in zip(claim_tokens, priors):
            if prior is None:
                claims[claim_token] = {**owner, "claimed_at": claimed_at}
                changed = True
        if all(
            claims[item].get(key) == value
            for item in claim_tokens
            for key, value in owner.items()
        ):
            owned.append(event)
    if changed:
        path = _development_claims_path(campaign_dir, investigator_id)
        path.parent.mkdir(parents=True, exist_ok=True)
        coc_fileio.write_json_atomic(path, ledger, indent=2, ensure_ascii=False)
    return owned, owner


def _sanity_mechanical_baseline(
    campaign_dir: Path, investigator_id: str
) -> tuple[dict[str, Any], Path]:
    canonical = coc_sanity.sanity_snapshot_path(campaign_dir, investigator_id)
    legacy = coc_sanity.legacy_sanity_snapshot_path(campaign_dir)
    inv_path = _investigator_state_path(campaign_dir, investigator_id)
    source = "investigator_state"
    path = inv_path
    value: dict[str, Any] = {}
    if canonical.is_file():
        value = json.loads(canonical.read_text(encoding="utf-8"))
        if value.get("investigator_id") != investigator_id:
            raise ValueError("canonical SAN identity does not match investigator")
        source = "canonical"
        path = canonical
    elif legacy.is_file():
        candidate = json.loads(legacy.read_text(encoding="utf-8"))
        if isinstance(candidate, dict) and candidate.get("investigator_id") == investigator_id:
            value = candidate
            source = "legacy_owner"
            path = legacy
    if source == "investigator_state":
        try:
            candidate = json.loads(inv_path.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError):
            candidate = {}
        value = candidate if isinstance(candidate, dict) else {}
    raw_current = value.get("san_current")
    if raw_current is None:
        raw_current = value.get("current_san", 0)
    raw_maximum = value.get("san_max")
    if raw_maximum is None:
        raw_maximum = value.get("max_san", 99)
    if (
        isinstance(raw_current, bool)
        or not isinstance(raw_current, int)
        or isinstance(raw_maximum, bool)
        or not isinstance(raw_maximum, int)
    ):
        raise ValueError("SAN baseline is invalid")
    current = raw_current
    maximum = raw_maximum
    if not 0 <= current <= maximum <= 99:
        raise ValueError("SAN baseline is invalid")
    caps = value.get("awfulness_caps")
    awfulness = {
        str(key): max(0, int(item))
        for key, item in (caps.items() if isinstance(caps, dict) else [])
    }
    return {
        "source": source,
        "current": current,
        "max": maximum,
        "awfulness_caps": awfulness,
    }, path


def _deterministic_development_plan(
    *,
    skills: dict[str, int],
    luck: int,
    sanity: dict[str, Any],
    seed_material: str,
    scenario_reward_expr: str | None,
) -> dict[str, Any]:
    rng = random.Random(seed_material)
    rule = coc_rules.development_rule()
    improvement = rule["improvement_roll"]
    always_above = int(improvement.get("always_improves_above", 95))
    table = coc_rules.load_rule_table("development")
    threshold = int(table.get("improvement_roll", {}).get(
        "san_reward_threshold", improvement.get("cap_for_san_reward", 90)
    ))
    sanity_expr = str(rule.get("sanity_reward", {}).get("reward", "2D6"))
    checks: list[dict[str, Any]] = []
    earns_san = False
    for skill, current in skills.items():
        check_roll = rng.randint(1, 100)
        improved = check_roll > current or check_roll > always_above
        gain = rng.randint(1, 10) if improved else None
        planned_after = current + int(gain or 0)
        earns_san = earns_san or (improved and planned_after >= threshold)
        checks.append({
            "skill": skill,
            "check_roll": check_roll,
            "gain": gain,
            "value_before": current,
            "planned_value_after": planned_after,
            "improved": improved,
        })
    luck_recovery = coc_roll.recover_luck(luck, rng=rng)
    development_reward = (
        coc_roll.roll_expression(sanity_expr, rng) if earns_san else None
    )
    scenario_reward = (
        coc_roll.roll_expression(scenario_reward_expr, rng)
        if isinstance(scenario_reward_expr, str) and scenario_reward_expr else None
    )
    planned_san = int(sanity["current"])
    san_max = int(sanity["max"])
    development_san_planned_delta = min(
        int(development_reward["total"]) if development_reward else 0,
        san_max - planned_san,
    )
    planned_san += development_san_planned_delta
    scenario_san_planned_delta = min(
        int(scenario_reward["total"]) if scenario_reward else 0,
        san_max - planned_san,
    )
    plan = {
        "schema_version": 2,
        "improvement_checks": checks,
        "luck_recovery": luck_recovery,
        "awfulness_decay": {
            key: max(0, int(value) - 1)
            for key, value in sanity["awfulness_caps"].items()
        },
        "development_san_reward": development_reward,
        "scenario_san_reward": scenario_reward,
        "development_san_planned_delta": development_san_planned_delta,
        "scenario_san_planned_delta": scenario_san_planned_delta,
    }
    plan["plan_sha256"] = _canonical_sha256(plan)
    return plan


def _development_input_snapshot(
    campaign_dir: Path,
    investigator_id: str,
    *,
    ending_id: str,
    seed_material: str,
    scenario_reward_expr: str | None,
) -> dict[str, Any]:
    active_transaction = active_development_transaction(
        campaign_dir, investigator_id
    )
    if active_transaction is not None:
        raise DevelopmentTransactionConflict(
            str(active_transaction.get("transaction_id") or "unknown-development-txn"),
            investigator_id,
            str(active_transaction.get("campaign_id") or "unknown-campaign"),
        )
    owned_events, owner = _claim_development_events(
        campaign_dir, investigator_id, ending_id=ending_id
    )
    skills_checked = list(dict.fromkeys(row["skill"] for row in owned_events))
    sheet = _read_character(campaign_dir, investigator_id)
    sheet_skills = sheet.get("skills") if isinstance(sheet.get("skills"), dict) else {}
    frozen_skills = {
        skill: int(sheet_skills.get(skill, 0) or 0) for skill in skills_checked
    }
    luck = _current_luck(campaign_dir, investigator_id, sheet)
    sanity, sanity_path = _sanity_mechanical_baseline(campaign_dir, investigator_id)
    baseline = {"skills": frozen_skills, "luck": luck, "sanity": sanity}
    plan = _deterministic_development_plan(
        skills=frozen_skills,
        luck=luck,
        sanity=sanity,
        seed_material=seed_material,
        scenario_reward_expr=scenario_reward_expr,
    )
    snapshot = {
        "schema_version": 2,
        "skills_checked": skills_checked,
        "check_events": owned_events,
        "input_tokens": [row["event_token"] for row in owned_events],
        "claim_owner": owner,
        "source_images": {
            "development_events": _source_image(
                _development_path(campaign_dir, investigator_id)
            ),
            "investigator_state": _source_image(
                _investigator_state_path(campaign_dir, investigator_id)
            ),
            "claim_ledger": _source_image(
                _development_claims_path(campaign_dir, investigator_id)
            ),
            "character": _source_image(_character_path(campaign_dir, investigator_id)),
            "sanity": _source_image(sanity_path),
        },
        "mechanical_baseline": baseline,
        "deterministic_plan": plan,
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
    rng_identity = {
        investigator_id: {
            "algorithm": "python-random-seed-v1",
            "seed_material": (
                f"{evidence['ending_id']}:{investigator_id}:development.settle"
            ),
        }
        for investigator_id in investigator_ids
    }
    development_inputs = {
        investigator_id: _development_input_snapshot(
            campaign_dir,
            investigator_id,
            ending_id=evidence["ending_id"],
            seed_material=rng_identity[investigator_id]["seed_material"],
            scenario_reward_expr=(
                evidence.get("scenario_san_reward_expr")
                if isinstance(evidence.get("scenario_san_reward_expr"), str)
                else None
            ),
        )
        for investigator_id in investigator_ids
    }
    capsule = {
        "schema_version": 2,
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


def _apply_frozen_awfulness_decay(
    campaign_dir: Path,
    investigator_id: str,
    baseline_caps: dict[str, int],
    planned_caps: dict[str, int],
) -> tuple[dict[str, int], dict[str, dict[str, int]]]:
    if not baseline_caps or not coc_sanity.sanity_snapshot_exists(
        campaign_dir, investigator_id
    ):
        return {}, {}
    sess = coc_sanity.SanitySession.load(campaign_dir, investigator_id)
    merged: dict[str, dict[str, int]] = {}
    for creature in baseline_caps:
        before = int(sess.awfulness_caps.get(creature, baseline_caps[creature]))
        planned_delta = int(planned_caps[creature]) - int(baseline_caps[creature])
        after = max(0, before + planned_delta)
        sess.awfulness_caps[creature] = after
        merged[creature] = {
            "current_before_apply": before,
            "planned_delta": planned_delta,
            "applied_delta": after - before,
            "value_after": after,
        }
    sess.save(campaign_dir)
    return dict(sess.awfulness_caps), merged


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

    if development_input is not None and development_input.get("schema_version") == 2:
        baseline = development_input["mechanical_baseline"]
        plan = development_input["deterministic_plan"]
        improvement_checks: list[dict[str, Any]] = []
        skills_improved: list[dict[str, Any]] = []
        for frozen in plan["improvement_checks"]:
            skill = str(frozen["skill"])
            current_live = int(skills.get(skill, 0) or 0)
            gain = int(frozen["gain"] or 0)
            value_after = current_live + gain if frozen["improved"] else current_live
            if frozen["improved"]:
                skills[skill] = value_after
            row = {
                "skill": skill,
                "check_roll": int(frozen["check_roll"]),
                "gain": int(frozen["gain"]) if frozen["improved"] else None,
                "value_before": int(frozen["value_before"]),
                "planned_value_after": int(frozen["planned_value_after"]),
                "current_value_before_apply": current_live,
                "applied_delta": gain,
                "value_after": value_after,
                "improved": bool(frozen["improved"]),
                "merge_policy": "additive_monotonic",
            }
            improvement_checks.append(dict(row))
            if frozen["improved"]:
                skills_improved.append(row)
        if skills_improved:
            _write_character(campaign_dir, investigator_id, sheet)

        luck_plan = dict(plan["luck_recovery"])
        current_luck = _current_luck(campaign_dir, investigator_id, sheet)
        planned_gain = int(luck_plan.get("gained", 0) or 0)
        luck_after = min(99, current_luck + planned_gain)
        applied_luck = luck_after - current_luck
        coc_state.apply_luck_recovery(
            campaign_dir, investigator_id, luck_after=luck_after
        )
        luck_recovery = {
            **luck_plan,
            "planned_luck_before": int(baseline["luck"]),
            "planned_luck_after": int(luck_plan["luck_after"]),
            "planned_gained": planned_gain,
            "current_luck_before_apply": current_luck,
            "gained": applied_luck,
            "luck_after": luck_after,
            "applied_delta": applied_luck,
            "merge_policy": "additive_monotonic_capped_99",
        }
        awfulness_decay, awfulness_merge = _apply_frozen_awfulness_decay(
            campaign_dir,
            investigator_id,
            baseline["sanity"]["awfulness_caps"],
            plan["awfulness_decay"],
        )
        _consume_development_inputs(campaign_dir, investigator_id, development_input)
        ending = ending_evidence or structured_ending_evidence(campaign_dir)
        development_reward = plan.get("development_san_reward")
        scenario_reward = plan.get("scenario_san_reward")
        return {
            "skills_checked": skills_checked,
            "improvement_checks": improvement_checks,
            "skills_improved": skills_improved,
            "san_reward_expr": (
                development_reward.get("expression")
                if isinstance(development_reward, dict) else None
            ),
            "san_reward_roll": development_reward,
            "san_reward_planned_delta": (
                int(plan["development_san_planned_delta"])
                if plan.get("schema_version") == 2
                else min(
                    int(development_reward["total"])
                    if isinstance(development_reward, dict) else 0,
                    int(baseline["sanity"]["max"])
                    - int(baseline["sanity"]["current"]),
                )
            ),
            "ending_evidence": ending,
            "scenario_san_reward_expr": (
                ending.get("scenario_san_reward_expr") if ending else None
            ),
            "scenario_san_reward_roll": scenario_reward,
            "scenario_san_reward_planned_delta": (
                int(plan["scenario_san_planned_delta"])
                if plan.get("schema_version") == 2
                else min(
                    int(scenario_reward["total"])
                    if isinstance(scenario_reward, dict) else 0,
                    max(
                        0,
                        int(baseline["sanity"]["max"])
                        - int(baseline["sanity"]["current"])
                        - min(
                            int(development_reward["total"])
                            if isinstance(development_reward, dict) else 0,
                            int(baseline["sanity"]["max"])
                            - int(baseline["sanity"]["current"]),
                        ),
                    ),
                )
            ),
            "luck_recovery": luck_recovery,
            "awfulness_decay": awfulness_decay,
            "awfulness_merge": awfulness_merge,
            "mechanical_baseline": baseline,
            "settlement_plan_sha256": plan["plan_sha256"],
            "merge_policy": "frozen_plan_additive_monotonic_v1",
            "input_tokens_consumed": list(development_input["input_tokens"]),
        }

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
