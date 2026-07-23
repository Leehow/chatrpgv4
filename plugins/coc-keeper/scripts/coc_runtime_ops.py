#!/usr/bin/env python3
"""Canonical non-turn operations shared by plugin hosts and the Pi runtime.

Normal player input still enters through ``coc_live_turn_runner.run_live_turn``.
This module owns typed operations that are not ordinary player prose so Codex,
Cursor, Claude Code, and ``runtime.sdk`` cannot grow host-specific behavior.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import random
import re
import shutil
import tempfile
from contextlib import ExitStack
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


SCRIPT_DIR = Path(__file__).resolve().parent
SCHEMA_VERSION = 1
_SAFE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")


def _load_sibling(name: str, filename: str):
    spec = importlib.util.spec_from_file_location(name, SCRIPT_DIR / filename)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


coc_chapter_switch = _load_sibling("coc_chapter_switch_runtime_ops", "coc_chapter_switch.py")
coc_api = _load_sibling("coc_api_runtime_ops", "coc_api.py")
coc_character = _load_sibling("coc_character_runtime_ops", "coc_character.py")
coc_character_card = _load_sibling(
    "coc_character_card_runtime_ops", "coc_character_card.py"
)
coc_character_creation_briefing = _load_sibling(
    "coc_character_creation_briefing_runtime_ops",
    "coc_character_creation_briefing.py",
)
coc_development = _load_sibling("coc_development_runtime_ops", "coc_development.py")
coc_fileio = _load_sibling("coc_fileio_runtime_ops", "coc_fileio.py")
coc_investigator_guard = _load_sibling(
    "coc_investigator_guard_runtime_ops", "coc_investigator_guard.py"
)
coc_hazards = _load_sibling("coc_hazards_runtime_ops", "coc_hazards.py")
coc_magic = _load_sibling("coc_magic_runtime_ops", "coc_magic.py")
coc_mythos = _load_sibling("coc_mythos_runtime_ops", "coc_mythos.py")
coc_module_assets = _load_sibling(
    "coc_module_assets_runtime_ops", "coc_module_assets.py"
)
coc_pdf_bundle = _load_sibling("coc_pdf_bundle_runtime_ops", "coc_pdf_bundle.py")
coc_roll = _load_sibling("coc_roll_runtime_ops", "coc_roll.py")
coc_rules = _load_sibling("coc_rules_runtime_ops", "coc_rules.py")
coc_sanity = _load_sibling("coc_sanity_runtime_ops", "coc_sanity.py")
coc_scenario = _load_sibling("coc_scenario_runtime_ops", "coc_scenario.py")
coc_scenario_hydration = _load_sibling(
    "coc_scenario_hydration_runtime_ops", "coc_scenario_hydration.py"
)
coc_starter = _load_sibling("coc_starter_runtime_ops", "coc_starter.py")
coc_state = _load_sibling("coc_state_runtime_ops", "coc_state.py")
coc_tomes = _load_sibling("coc_tomes_runtime_ops", "coc_tomes.py")
coc_turn_finalization = _load_sibling(
    "coc_turn_finalization_runtime_ops", "coc_turn_finalization.py"
)


SESSION_OPERATION_KINDS = frozenset({
    "scenario.ensure", "scenario.repair", "magic.cast", "magic.learn",
    "chapter.switch", "tome.read", "hazard.apply", "hazard.suffocation.start",
    "hazard.suffocation.tick", "hazard.suffocation.end", "hazard.poison",
    "development.settle",
})
SETUP_OPERATION_KINDS = frozenset({
    "onboarding.inspect", "rules.inspect", "campaign.create",
    "campaign.quick_start", "scenario.bind_pdf", "campaign.render_briefing",
    "actor.create", "investigator.create", "investigator.render_card",
    "campaign.link_investigator",
})


class RuntimeOperationError(ValueError):
    """Stable validation failure for the shared operation protocol."""


def validate_semantic_route(value: Any) -> dict[str, Any]:
    """Validate an LLM/host semantic route without inspecting player prose."""
    if not isinstance(value, dict) or set(value) != {
        "schema_version", "route", "reason", "operation"
    }:
        raise RuntimeOperationError(
            "semantic route must contain schema_version, route, reason, operation"
        )
    if value.get("schema_version") != 1:
        raise RuntimeOperationError("semantic route schema_version must be 1")
    if value.get("route") not in {"ordinary_turn", "operation"}:
        raise RuntimeOperationError("semantic route must be ordinary_turn or operation")
    reason = value.get("reason")
    if not isinstance(reason, str) or not reason.strip():
        raise RuntimeOperationError("semantic route requires a non-empty reason")
    operation = value.get("operation")
    if value["route"] == "ordinary_turn":
        if operation is not None:
            raise RuntimeOperationError("ordinary_turn route operation must be null")
    else:
        _operation(operation)
    return json.loads(json.dumps(value, ensure_ascii=False))


def record_semantic_route(
    campaign_dir: Path | str,
    semantic_route: dict[str, Any],
    *,
    player_text: str,
    provenance: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Persist semantic routing evidence without retaining raw player prose."""
    route = validate_semantic_route(semantic_route)
    if not isinstance(player_text, str) or not player_text:
        raise RuntimeOperationError("semantic route player_text must be non-empty")
    encoded = player_text.encode("utf-8")
    import hashlib
    receipt = {
        "schema_version": 1,
        "event_type": "runtime_operation_route",
        "route": route["route"],
        "reason": route["reason"],
        "operation_kind": (
            route["operation"].get("kind")
            if isinstance(route.get("operation"), dict) else None
        ),
        "player_text_sha256": hashlib.sha256(encoded).hexdigest(),
        "provenance": json.loads(json.dumps(provenance or {}, ensure_ascii=False)),
        "recorded_at": _now(),
    }
    _append_jsonl(Path(campaign_dir) / "logs" / "operation-routes.jsonl", receipt)
    return receipt


def _now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _id(value: Any, label: str) -> str:
    text = str(value or "")
    if not _SAFE_ID.fullmatch(text):
        raise RuntimeOperationError(f"{label} must be a stable safe id")
    return text


def _read_object(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise RuntimeOperationError(f"unreadable JSON object: {path}") from exc
    if not isinstance(value, dict):
        raise RuntimeOperationError(f"JSON value must be an object: {path}")
    return value


def _append_jsonl(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    encoded = json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n"
    with path.open("a", encoding="utf-8") as handle:
        handle.write(encoded)
        handle.flush()
        os.fsync(handle.fileno())


def _operation(value: Any) -> tuple[str, dict[str, Any]]:
    if not isinstance(value, dict) or set(value) != {"schema_version", "kind", "payload"}:
        raise RuntimeOperationError(
            "operation must contain exactly schema_version, kind, and payload"
        )
    if value.get("schema_version") != SCHEMA_VERSION:
        raise RuntimeOperationError("operation schema_version must be 1")
    kind = value.get("kind")
    payload = value.get("payload")
    if kind not in SESSION_OPERATION_KINDS:
        raise RuntimeOperationError("unsupported runtime operation kind")
    if not isinstance(payload, dict):
        raise RuntimeOperationError("operation payload must be an object")
    return str(kind), payload


def _setup_operation(value: Any) -> tuple[str, dict[str, Any]]:
    if not isinstance(value, dict) or set(value) != {"schema_version", "kind", "payload"}:
        raise RuntimeOperationError(
            "setup operation must contain exactly schema_version, kind, and payload"
        )
    if value.get("schema_version") != SCHEMA_VERSION:
        raise RuntimeOperationError("setup operation schema_version must be 1")
    kind = value.get("kind")
    payload = value.get("payload")
    if kind not in SETUP_OPERATION_KINDS:
        raise RuntimeOperationError("unsupported setup operation kind")
    if not isinstance(payload, dict):
        raise RuntimeOperationError("setup operation payload must be an object")
    return str(kind), payload


def _character_values(character: dict[str, Any]) -> dict[str, int]:
    characteristics = character.get("characteristics")
    if not isinstance(characteristics, dict):
        characteristics = {}
    return {
        "pow": int(characteristics.get("POW") or 0),
        "int": int(characteristics.get("INT") or 0),
    }


def _magic_state(
    workspace: Path,
    campaign_id: str,
    investigator_id: str,
    character_path: Path,
) -> tuple[Path, dict[str, Any]]:
    campaign_dir = workspace / ".coc" / "campaigns" / campaign_id
    character = read_development_guarded_character(
        campaign_dir, investigator_id, character_path
    )
    path = coc_state.seed_investigator_state_if_missing(
        workspace, campaign_id, investigator_id, sheet=character
    )
    state = coc_state.load_investigator_state(path.parents[2], investigator_id)
    for key, value in _character_values(character).items():
        state.setdefault(key, value)
    magic = state.get("magic")
    if not isinstance(magic, dict):
        magic = {}
    for key in ("cast_spells", "learned_spells"):
        values = magic.get(key)
        magic[key] = list(values) if isinstance(values, list) else []
    state["magic"] = magic
    return path, state


def _validate_spell(payload: dict[str, Any], allowed: set[str]) -> str:
    if set(payload) - allowed:
        raise RuntimeOperationError("magic payload has unsupported fields")
    spell = payload.get("spell")
    if not isinstance(spell, str) or not spell.strip():
        raise RuntimeOperationError("magic payload requires spell")
    try:
        canonical = coc_rules.spell_by_name(spell.strip())
    except KeyError as exc:
        raise RuntimeOperationError(f"unknown spell: {spell.strip()}") from exc
    return str(canonical["name"])


def _magic_operation(
    *,
    workspace: Path,
    campaign_dir: Path,
    campaign_id: str,
    investigator_id: str,
    character_path: Path,
    kind: str,
    payload: dict[str, Any],
    rng: random.Random,
) -> dict[str, Any]:
    state_path, state = _magic_state(
        workspace, campaign_id, investigator_id, character_path
    )
    magic = state["magic"]
    if kind == "magic.cast":
        spell = _validate_spell(
            payload, {"spell", "pushed", "interrupted", "is_npc"}
        )
        cast_spells = {str(item) for item in magic["cast_spells"]}
        result = coc_magic.cast_spell(
            spell,
            state,
            is_first_cast=spell not in cast_spells,
            is_npc=payload.get("is_npc") is True,
            pushed=payload.get("pushed") is True,
            interrupted=payload.get("interrupted") is True,
            rng=rng,
        )
        if result.get("success") and spell not in cast_spells:
            magic["cast_spells"].append(spell)
    else:
        spell = _validate_spell(payload, {"spell", "source"})
        source = payload.get("source", "tome")
        if source not in {"tome", "person", "entity"}:
            raise RuntimeOperationError("magic.learn source must be tome|person|entity")
        result = coc_magic.learn_spell(
            spell, state, source=str(source), rng=rng, campaign_dir=campaign_dir
        )
        learned = {str(item) for item in magic["learned_spells"]}
        if result.get("learned") and not result.get("completion_trigger_id") and spell not in learned:
            magic["learned_spells"].append(spell)
    coc_fileio.write_json_atomic(
        state_path, state, indent=2, ensure_ascii=False, trailing_newline=True
    )
    operation_id = f"op-{kind.replace('.', '-')}-{int(rng.random() * 10**12):012d}"
    event = {
        "type": "magic",
        "actor": investigator_id,
        "operation_id": operation_id,
        "payload": result,
        "ts": _now(),
    }
    _append_jsonl(campaign_dir / "logs" / "events.jsonl", event)
    roll = result.get("roll_result")
    if isinstance(roll, dict) and isinstance(roll.get("roll"), int):
        _append_jsonl(campaign_dir / "logs" / "rolls.jsonl", {
            "type": "roll",
            "actor": investigator_id,
            "command_id": operation_id,
            "payload": {
                "roll_id": operation_id,
                "kind": kind,
                "skill": "POW" if kind == "magic.cast" else "INT",
                "target": roll.get("target"),
                "difficulty": "hard",
                "roll": roll.get("roll"),
                "effective_target": roll.get("effective_target"),
                "outcome": roll.get("outcome"),
                "success": bool(result.get("success") or result.get("learned")),
                "visibility": "public",
            },
            "ts": _now(),
        })
    return {
        "schema_version": 1,
        "status": "PASS",
        "kind": kind,
        "operation_id": operation_id,
        "result": result,
        "state_refs": [
            f"save/investigator-state/{investigator_id}.json",
            "logs/events.jsonl",
        ],
    }


def _investigator_state(
    workspace: Path,
    campaign_id: str,
    investigator_id: str,
    character_path: Path,
) -> tuple[Path, dict[str, Any], dict[str, Any]]:
    campaign_dir = workspace / ".coc" / "campaigns" / campaign_id
    character = read_development_guarded_character(
        campaign_dir, investigator_id, character_path
    )
    state_path = coc_state.seed_investigator_state_if_missing(
        workspace, campaign_id, investigator_id, sheet=character
    )
    state = coc_state.load_investigator_state(state_path.parents[2], investigator_id)
    characteristics = character.get("characteristics")
    if not isinstance(characteristics, dict):
        characteristics = {}
    derived = character.get("derived")
    if not isinstance(derived, dict):
        derived = {}
    state.setdefault("investigator_id", investigator_id)
    state.setdefault("current_hp", int(derived.get("HP") or 10))
    state.setdefault("hp_max", int(derived.get("HP") or state["current_hp"]))
    state.setdefault("current_san", int(derived.get("SAN") or characteristics.get("POW") or 50))
    state.setdefault("max_san", 99 - int(state.get("cm_value") or 0))
    state.setdefault("con", int(characteristics.get("CON") or 50))
    state.setdefault("int", int(characteristics.get("INT") or 50))
    state.setdefault("conditions", [])
    return state_path, state, character


def _operation_id(kind: str, rng: random.Random) -> str:
    return f"op-{kind.replace('.', '-')}-{int(rng.random() * 10**12):012d}"


def _write_public_roll(
    campaign_dir: Path,
    *,
    command_id: str,
    actor_id: str,
    kind: str,
    skill: str,
    roll: int,
    die: str,
    die_rolls: list[int],
    target: int | None = None,
    difficulty: str | None = None,
    outcome: str,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    faces = [int(value) for value in die_rolls]
    total = int(roll)
    payload: dict[str, Any] = {
        "roll_id": command_id,
        "actor_id": actor_id,
        "kind": kind,
        "skill": skill,
        "roll": total,
        "die": die,
        "die_expression": die,
        "expression": die,
        "die_rolls": faces,
        "rolls": faces,
        "individual_faces": faces,
        "dice": {
            "expression": die,
            "raw": faces,
            "total": total,
        },
        "outcome": outcome,
        "visibility": "public",
    }
    if target is not None:
        payload["target"] = int(target)
        payload["effective_target"] = int(target)
        payload["base_target"] = int(target)
    if difficulty is not None:
        payload["difficulty"] = difficulty
    if extra:
        payload.update(extra)
    row = {
        "event_type": "roll",
        "type": "roll",
        "roll_id": command_id,
        "actor": actor_id,
        "visibility": "public",
        "source": "runtime_operation",
        "source_ref": f"logs/rolls.jsonl#{command_id}",
        "command_id": command_id,
        "payload": payload,
        "ts": _now(),
    }
    _append_jsonl(campaign_dir / "logs" / "rolls.jsonl", row)
    return row


def _compose_development_player_facing(
    *,
    investigator_id: str,
    operation_id: str,
    result: dict[str, Any],
    public_rows: list[dict[str, Any]],
) -> dict[str, Any]:
    """Hard-constrain development public checks into final player output.

    Every improvement check, gain die, Luck recovery, and SAN reward written
    during settlement must appear once in the player-facing mechanics block.
    SAN reward alone is not enough.
    """
    expected_ids: list[str] = []
    for index, check in enumerate(result.get("improvement_checks") or []):
        if not isinstance(check, dict):
            continue
        expected_ids.append(f"{operation_id}:check:{index}")
        if check.get("improved") and isinstance(check.get("gain"), int):
            expected_ids.append(f"{operation_id}:gain:{index}")
    luck = result.get("luck_recovery") or {}
    if isinstance(luck.get("roll"), int):
        expected_ids.append(f"{operation_id}:luck-recovery")
    # Result fields may exist on replay without a new write; only require the
    # rolls that this settlement actually emitted into public_rows.
    written_ids = [
        str(row.get("roll_id") or "")
        for row in public_rows
        if isinstance(row, dict) and row.get("roll_id")
    ]
    required_ids = list(dict.fromkeys([*expected_ids, *written_ids]))
    by_id = {
        str(row.get("roll_id") or ""): row
        for row in public_rows
        if isinstance(row, dict) and row.get("roll_id")
    }
    lines: list[str] = []
    missing: list[str] = []
    for roll_id in required_ids:
        row = by_id.get(roll_id)
        if row is None:
            missing.append(roll_id)
            continue
        flat = dict(row.get("payload") or {})
        for key, value in row.items():
            if key != "payload":
                flat[key] = value
        lines.append(coc_turn_finalization._render_public_roll(flat))
    return {
        "schema_version": 1,
        "investigator_id": investigator_id,
        "operation_id": operation_id,
        "required_roll_ids": required_ids,
        "rendered_lines": lines,
        "rendered_text": "\n".join(lines),
        "complete": not missing and bool(required_ids or not expected_ids),
        "missing_roll_ids": missing,
    }


def _write_sanity_reward_event(
    campaign_dir: Path,
    *,
    actor_id: str,
    operation_id: str,
    roll_id: str,
    source: str,
    san_before: int,
    san_after: int,
    rule_ref: Any = None,
    conclusion_id: Any = None,
) -> None:
    """Emit the canonical reward event consumed by completion/report logic."""
    record: dict[str, Any] = {
        "event_type": "reward",
        "type": "reward",
        "actor": actor_id,
        "actor_id": actor_id,
        "operation_id": operation_id,
        "reward_kind": "sanity",
        "source": source,
        "roll_id": roll_id,
        "san_before": int(san_before),
        "san_delta": int(san_after) - int(san_before),
        "san_after": int(san_after),
        "ts": _now(),
    }
    if isinstance(rule_ref, str) and rule_ref:
        record["rule_ref"] = rule_ref
    if isinstance(conclusion_id, str) and conclusion_id:
        record["conclusion_id"] = conclusion_id
    _append_jsonl(campaign_dir / "logs" / "events.jsonl", record)


def _sanity_session_for_reward(
    campaign_dir: Path,
    investigator_id: str,
    *,
    rng: random.Random,
) -> Any:
    """Load authoritative SAN, seeding a missing snapshot from campaign state."""
    if coc_sanity.sanity_snapshot_path(campaign_dir, investigator_id).is_file():
        return coc_sanity.SanitySession.load(
            campaign_dir, investigator_id, rng=rng
        )

    inv_path = (
        campaign_dir / "save" / "investigator-state" / f"{investigator_id}.json"
    )
    inv_state = _read_object(inv_path)
    if inv_state.get("investigator_id") != investigator_id:
        raise RuntimeOperationError(
            "investigator-state identity does not match development investigator"
        )
    character_path = (
        campaign_dir.parents[1] / "investigators" / investigator_id / "character.json"
    )
    character = read_development_guarded_character(
        campaign_dir, investigator_id, character_path
    )
    characteristics = (
        character.get("characteristics")
        if isinstance(character.get("characteristics"), dict) else {}
    )
    skills = character.get("skills") if isinstance(character.get("skills"), dict) else {}
    derived = character.get("derived") if isinstance(character.get("derived"), dict) else {}
    cm_value = inv_state.get("cm_value", skills.get("Cthulhu Mythos", 0))
    current_san = inv_state.get(
        "current_san", derived.get("SAN", characteristics.get("POW"))
    )
    int_value = characteristics.get("INT", 50)
    if (
        isinstance(cm_value, bool) or not isinstance(cm_value, int)
        or not 0 <= cm_value <= 99
        or isinstance(current_san, bool) or not isinstance(current_san, int)
        or not 0 <= current_san <= 99
        or isinstance(int_value, bool) or not isinstance(int_value, int)
        or not 0 <= int_value <= 150
    ):
        raise RuntimeOperationError("invalid investigator SAN seed state")
    san_max = inv_state.get("max_san", 99 - cm_value)
    if (
        isinstance(san_max, bool) or not isinstance(san_max, int)
        or not 0 <= san_max <= 99
        or current_san > san_max
    ):
        raise RuntimeOperationError("invalid investigator maximum SAN seed state")
    session = coc_sanity.SanitySession(
        investigator_id,
        san_max=san_max,
        int_value=int_value,
        rng=rng,
        campaign_dir=campaign_dir,
        cm_value=cm_value,
    )
    session.san_current = current_san
    session.day_start_san = current_san
    return session


def _tome_operation(
    *,
    workspace: Path,
    campaign_dir: Path,
    campaign_id: str,
    investigator_id: str,
    character_path: Path,
    payload: dict[str, Any],
    rng: random.Random,
) -> dict[str, Any]:
    allowed = {
        "tome", "phase", "language_skill", "read_language_ok",
        "plot_critical", "choose_disbelief", "alone",
    }
    if set(payload) - allowed or not {"tome", "phase"} <= set(payload):
        raise RuntimeOperationError("tome.read has unsupported or missing fields")
    tome = payload.get("tome")
    phase = payload.get("phase")
    if not isinstance(tome, str) or not tome.strip():
        raise RuntimeOperationError("tome.read requires tome")
    if phase not in {"skim", "initial", "full", "research"}:
        raise RuntimeOperationError("tome.read phase must be skim|initial|full|research")
    state_path, state, character = _investigator_state(
        workspace, campaign_id, investigator_id, character_path
    )
    snapshot_path = campaign_dir / "save" / "tomes.json"
    if snapshot_path.is_file():
        existing = _read_object(snapshot_path)
        if existing.get("tome_name") != tome.strip():
            raise RuntimeOperationError(
                "another tome study is active; finish or archive it before changing tomes"
            )
        session = coc_tomes.TomeSession.load(
            campaign_dir, investigator_id, rng=rng
        )
    else:
        session = coc_tomes.TomeSession(
            investigator_id,
            tome.strip(),
            rng=rng,
            campaign_dir=campaign_dir,
            language_skill=int(payload.get("language_skill") or 0),
            read_language_ok=payload.get("read_language_ok") is True,
            plot_critical=payload.get("plot_critical") is True,
        )
    result = session.read(
        str(phase), choose_disbelief=payload.get("choose_disbelief") is True
    )
    operation_id = _operation_id("tome.read", rng)
    if result.get("blocked"):
        return {
            "schema_version": 1,
            "status": "INELIGIBLE",
            "kind": "tome.read",
            "operation_id": operation_id,
            "result": result,
            "state_refs": ["save/tomes.json"],
        }

    sanity_result: dict[str, Any] | None = None
    sanity_rolls: list[dict[str, Any]] = []
    loss_expr = result.get("san_loss_expr")
    if isinstance(loss_expr, str) and loss_expr:
        existed = coc_sanity.sanity_snapshot_exists(campaign_dir, investigator_id)
        sanity = coc_sanity.SanitySession.load(
            campaign_dir,
            investigator_id,
            int_value=int(state.get("int") or 50),
            rng=rng,
            cm_value=int(state.get("cm_value") or 0),
        )
        if not existed:
            sanity.san_current = int(state.get("current_san") or sanity.san_current)
            sanity.san_max = int(state.get("max_san") or sanity.san_max)
            sanity.day_start_san = sanity.san_current
        sanity_result = sanity.apply_direct_loss(
            f"read tome:{tome.strip()}",
            loss_expr,
            multiplier=float(result.get("san_loss_multiplier") or 1.0),
            alone=payload.get("alone") is True,
        )
        sanity_rolls = sanity.drain_pending()
        sanity.save(campaign_dir, strict_mirror=True)

    mythos_result: dict[str, Any] | None = None
    cm_gain = result.get("cm_gain")
    if isinstance(cm_gain, int) and not isinstance(cm_gain, bool) and cm_gain > 0:
        with coc_fileio.advisory_file_lock(
            _development_investigator_lock_path(campaign_dir, investigator_id),
            wait_seconds=5.0,
        ):
            marker_path = _development_active_marker_path(
                campaign_dir, investigator_id
            )
            try:
                marker = coc_development.active_development_transaction(
                    campaign_dir, investigator_id
                )
            except ValueError as exc:
                raise DevelopmentRecoveryConflict(
                    "development-writer",
                    [_journal_display_path(campaign_dir, marker_path)],
                ) from exc
            if marker is not None:
                raise DevelopmentRecoveryConflict(
                    str(marker["transaction_id"]),
                    [_journal_display_path(campaign_dir, marker_path)],
                )
            mythos_result = coc_mythos.gain_mythos_persisted(
                campaign_dir, investigator_id, amount=cm_gain
            )
            character = _read_object(character_path)
            character_skills = character.get("skills")
            if not isinstance(character_skills, dict):
                character_skills = {}
                character["skills"] = character_skills
            character_skills["Cthulhu Mythos"] = int(mythos_result["cm_after"])
            coc_fileio.write_json_atomic(
                character_path, character, indent=2, ensure_ascii=False,
                trailing_newline=True,
            )
        # Refresh the already-persisted sanity maximum after the Mythos gain.
        if sanity_result is not None:
            sanity = coc_sanity.SanitySession.load(
                campaign_dir, investigator_id, rng=rng,
                cm_value=int(mythos_result["cm_after"]),
            )
            refreshed = coc_state.load_investigator_state(
                campaign_dir, investigator_id
            )
            sanity.cm_value = int(mythos_result["cm_after"])
            sanity.san_max = int(refreshed.get("max_san") or sanity.san_max)
            sanity.san_current = int(refreshed.get("current_san") or sanity.san_current)
            sanity.save(campaign_dir, strict_mirror=True)

    for event in session.events:
        _append_jsonl(campaign_dir / "logs" / "events.jsonl", {
            "type": "tome",
            "actor": investigator_id,
            "operation_id": operation_id,
            "payload": event,
            "ts": _now(),
        })
    for index, roll in enumerate(sanity_rolls):
        if not isinstance(roll, dict) or not isinstance(roll.get("roll"), int):
            continue
        _write_public_roll(
            campaign_dir,
            command_id=f"{operation_id}:san:{index}",
            actor_id=investigator_id,
            kind="tome_san_loss",
            skill=str(roll.get("skill") or "SAN Loss"),
            roll=int(roll["roll"]),
            die=str(roll.get("die") or loss_expr or "SAN"),
            die_rolls=list(roll.get("die_rolls") or [roll["roll"]]),
            outcome=str(roll.get("outcome") or "sanity_loss"),
            extra={
                key: roll[key]
                for key in ("san_before", "san_loss", "san_after")
                if isinstance(roll.get(key), int)
            },
        )
    if phase == "research" and isinstance(result.get("roll"), dict):
        result["pending_roll_contract"] = dict(result["roll"])
    coc_fileio.write_json_atomic(
        state_path,
        coc_state.load_investigator_state(campaign_dir, investigator_id),
        indent=2,
        ensure_ascii=False,
        trailing_newline=True,
    )
    return {
        "schema_version": 1,
        "status": "PASS",
        "kind": "tome.read",
        "operation_id": operation_id,
        "result": {
            **result,
            "sanity_result": sanity_result,
            "mythos_result": mythos_result,
        },
        "state_refs": [
            "save/tomes.json",
            f"save/investigator-state/{investigator_id}.json",
            str(character_path.relative_to(workspace)),
            "logs/events.jsonl",
            "logs/rolls.jsonl",
        ],
    }


def _hazard_rolls(
    campaign_dir: Path,
    investigator_id: str,
    operation_id: str,
    kind: str,
    event: dict[str, Any],
) -> None:
    con_roll = event.get("con_roll")
    if isinstance(con_roll, dict) and isinstance(con_roll.get("roll"), int):
        _write_public_roll(
            campaign_dir,
            command_id=f"{operation_id}:con",
            actor_id=investigator_id,
            kind=kind,
            skill="CON",
            roll=int(con_roll["roll"]),
            die="1D100",
            die_rolls=[int(con_roll["roll"])],
            target=int(con_roll.get("target") or 0),
            difficulty=str(event.get("con_difficulty") or "regular"),
            outcome=str(con_roll.get("outcome") or "failure"),
        )
    damage_roll = event.get("damage_roll")
    if isinstance(damage_roll, dict) and isinstance(damage_roll.get("total"), int):
        _write_public_roll(
            campaign_dir,
            command_id=f"{operation_id}:damage",
            actor_id=investigator_id,
            kind=kind,
            skill="HP Damage",
            roll=int(damage_roll["total"]),
            die=str(damage_roll.get("expression") or event.get("damage_expr") or "damage"),
            die_rolls=[int(value) for value in damage_roll.get("rolls") or []],
            outcome="damage_applied",
            extra={
                key: int(event[key])
                for key in ("hp_before", "hp_after", "hp_delta")
                if isinstance(event.get(key), int)
            },
        )


def _hazard_operation(
    *,
    workspace: Path,
    campaign_dir: Path,
    campaign_id: str,
    investigator_id: str,
    character_path: Path,
    kind: str,
    payload: dict[str, Any],
    rng: random.Random,
) -> dict[str, Any]:
    _state_path, participant, _character = _investigator_state(
        workspace, campaign_id, investigator_id, character_path
    )
    participant["id"] = investigator_id
    session = coc_hazards.HazardSession.load(campaign_dir, rng=rng)
    if kind == "hazard.apply":
        allowed = {"severity", "hazard_id", "damage_expr", "source", "ignore_major_wound"}
        if set(payload) - allowed or not any(
            payload.get(key) not in (None, "") for key in ("severity", "hazard_id", "damage_expr")
        ):
            raise RuntimeOperationError("hazard.apply requires severity, hazard_id, or damage_expr")
        event = session.apply_other_damage(
            participant,
            severity=payload.get("severity"),
            hazard_id=payload.get("hazard_id"),
            damage_expr=payload.get("damage_expr"),
            source=str(payload.get("source") or "environmental"),
            ignore_major_wound=payload.get("ignore_major_wound") is True,
        )
    elif kind == "hazard.suffocation.start":
        if set(payload) - {"kind", "severity", "exertion"}:
            raise RuntimeOperationError("hazard.suffocation.start has unsupported fields")
        event = session.start_suffocation(
            participant,
            kind=str(payload.get("kind") or "drowning"),
            severity=payload.get("severity"),
            exertion=payload.get("exertion") is True,
        )
    elif kind == "hazard.suffocation.tick":
        if payload:
            raise RuntimeOperationError("hazard.suffocation.tick payload must be empty")
        event = session.suffocation_round(participant)
    elif kind == "hazard.suffocation.end":
        if set(payload) - {"reason"}:
            raise RuntimeOperationError("hazard.suffocation.end has unsupported fields")
        event = session.end_suffocation(
            participant, reason=str(payload.get("reason") or "able_to_breathe")
        )
    else:
        if set(payload) - {"poison_id", "doses", "allow_critical_shake_off"}:
            raise RuntimeOperationError("hazard.poison has unsupported fields")
        poison_id = payload.get("poison_id")
        if not isinstance(poison_id, str) or not poison_id:
            raise RuntimeOperationError("hazard.poison requires poison_id")
        doses = payload.get("doses", 1)
        if isinstance(doses, bool) or not isinstance(doses, int) or doses < 1:
            raise RuntimeOperationError("hazard.poison doses must be a positive integer")
        event = session.apply_poison(
            participant,
            poison_id,
            doses=doses,
            allow_critical_shake_off=payload.get("allow_critical_shake_off") is not False,
        )
    operation_id = _operation_id(kind, rng)
    session.save(campaign_dir, participant=participant)
    session.persist_events(campaign_dir)
    _hazard_rolls(campaign_dir, investigator_id, operation_id, kind, event)
    return {
        "schema_version": 1,
        "status": "PASS",
        "kind": kind,
        "operation_id": operation_id,
        "result": event,
        "state_refs": [
            "save/hazards.json",
            f"save/investigator-state/{investigator_id}.json",
            "logs/events.jsonl",
            "logs/rolls.jsonl",
        ],
    }


def _development_transaction_paths(
    campaign_dir: Path,
    investigator_id: str,
    settlement_path: Path,
    ending: dict[str, Any] | None = None,
) -> tuple[dict[str, Path], dict[str, Path]]:
    coc_root = campaign_dir.parents[1]
    files = {
        "character": coc_root / "investigators" / investigator_id / "character.json",
        "development_events": (
            coc_root / "investigators" / investigator_id / "development.jsonl"
        ),
        "investigator_state": (
            campaign_dir / "save" / "investigator-state" / f"{investigator_id}.json"
        ),
        "pacing_state": campaign_dir / "save" / "pacing-state.json",
        "sanity_investigator": coc_sanity.sanity_snapshot_path(
            campaign_dir, investigator_id
        ),
        "sanity_legacy": coc_sanity.legacy_sanity_snapshot_path(campaign_dir),
        "settlement": settlement_path,
    }
    reward_path = _conclusion_reward_receipt_path(
        campaign_dir, investigator_id, ending or {}
    )
    if reward_path is not None:
        files["conclusion_reward"] = reward_path
    logs = {
        "events": campaign_dir / "logs" / "events.jsonl",
        "rolls": campaign_dir / "logs" / "rolls.jsonl",
        # Item grants settle into the shared investigator library sheet and
        # append inventory_settled receipts here; treat as append-only like
        # other development logs so the planner may change it.
        "inventory_history": (
            coc_root / "investigators" / investigator_id / "inventory-history.jsonl"
        ),
    }
    return files, logs


def _random_state_to_json(value: Any) -> Any:
    if isinstance(value, tuple):
        return [_random_state_to_json(item) for item in value]
    return value


def _random_state_from_json(value: Any) -> Any:
    if isinstance(value, list):
        return tuple(_random_state_from_json(item) for item in value)
    return value


def _sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _file_image(path: Path) -> dict[str, Any]:
    if not path.is_file():
        return {"exists": False, "text": None, "sha256": None}
    text = path.read_text(encoding="utf-8")
    return {
        "exists": True,
        "text": text,
        "sha256": _sha256_bytes(text.encode("utf-8")),
    }


def _log_image(path: Path) -> dict[str, Any]:
    value = path.read_bytes() if path.is_file() else b""
    return {
        "exists": path.is_file(),
        "size": len(value),
        "prefix_sha256": _sha256_bytes(value),
    }


def _target_kind_is_safe(coc_root: Path, path: Path) -> bool:
    """Reject links/non-regular targets and parent escapes before capture."""
    try:
        relative = path.relative_to(coc_root)
        path.resolve(strict=False).relative_to(coc_root.resolve())
    except (OSError, ValueError):
        return False
    current = coc_root
    for part in relative.parts[:-1]:
        current = current / part
        if current.is_symlink() or (current.exists() and not current.is_dir()):
            return False
    return not path.is_symlink() and (not path.exists() or path.is_file())


def _valid_file_image(value: Any) -> bool:
    if not isinstance(value, dict) or set(value) != {"exists", "text", "sha256"}:
        return False
    exists = value.get("exists")
    if not isinstance(exists, bool):
        return False
    if not exists:
        return value.get("text") is None and value.get("sha256") is None
    text = value.get("text")
    digest = value.get("sha256")
    return bool(
        isinstance(text, str)
        and isinstance(digest, str)
        and digest == _sha256_bytes(text.encode("utf-8"))
    )


def _valid_log_image(value: Any) -> bool:
    if not isinstance(value, dict) or set(value) != {
        "exists", "size", "prefix_sha256"
    }:
        return False
    exists = value.get("exists")
    size = value.get("size")
    digest = value.get("prefix_sha256")
    return bool(
        isinstance(exists, bool)
        and not isinstance(size, bool)
        and isinstance(size, int)
        and size >= 0
        and isinstance(digest, str)
        and re.fullmatch(r"[0-9a-f]{64}", digest)
        and (exists or size == 0)
    )


def _valid_log_postimage(value: Any) -> bool:
    if not isinstance(value, dict) or set(value) != {
        "suffix", "suffix_sha256"
    }:
        return False
    suffix = value.get("suffix")
    digest = value.get("suffix_sha256")
    return bool(
        isinstance(suffix, str)
        and isinstance(digest, str)
        and digest == _sha256_bytes(suffix.encode("utf-8"))
    )


def _development_transaction_id(ending_id: str, investigator_id: str) -> str:
    material = f"{ending_id}\0{investigator_id}".encode("utf-8")
    return "development-txn-" + hashlib.sha256(material).hexdigest()[:24]


def _development_investigator_lock_path(
    campaign_dir: Path, investigator_id: str
) -> Path:
    return (
        Path(campaign_dir).parents[1]
        / "locks"
        / "investigators"
        / investigator_id
        / ".investigator.lock"
    )


def _development_active_marker_path(
    campaign_dir: Path, investigator_id: str
) -> Path:
    return coc_development.development_active_transaction_path(
        campaign_dir, investigator_id
    )


def _claim_development_active_marker(
    *,
    campaign_dir: Path,
    investigator_id: str,
    ending_id: str,
    inflight_path: Path,
) -> dict[str, Any]:
    transaction_id = _development_transaction_id(ending_id, investigator_id)
    marker_path = _development_active_marker_path(campaign_dir, investigator_id)
    if not _target_kind_is_safe(campaign_dir.parents[1], marker_path):
        raise DevelopmentRecoveryConflict(
            transaction_id, [_journal_display_path(campaign_dir, marker_path)]
        )
    expected = {
        "schema_version": 2,
        "status": "active",
        "transaction_id": transaction_id,
        "investigator_id": investigator_id,
        "campaign_id": _id(campaign_dir.name, "campaign_id"),
        "ending_id": ending_id,
        "inflight_ref": _journal_display_path(campaign_dir, inflight_path),
        "phase": "creating",
        "journal_sha256": None,
        "next_journal_sha256": None,
        "transition_at": None,
    }
    try:
        current = coc_development.active_development_transaction(
            campaign_dir, investigator_id
        )
    except ValueError as exc:
        raise DevelopmentRecoveryConflict(
            transaction_id, [_journal_display_path(campaign_dir, marker_path)]
        ) from exc
    if current is not None:
        identity_keys = {
            "status", "transaction_id", "investigator_id", "campaign_id",
            "ending_id", "inflight_ref",
        }
        if (
            all(current.get(key) == expected[key] for key in identity_keys)
            and current.get("schema_version") == 2
            and current.get("phase") == "creating"
        ):
            return current
        raise DevelopmentRecoveryConflict(
            transaction_id, [_journal_display_path(campaign_dir, marker_path)]
        )
    marker = {**expected, "created_at": _now()}
    marker_path.parent.mkdir(parents=True, exist_ok=True)
    coc_fileio.write_json_atomic(
        marker_path,
        marker,
        indent=2,
        ensure_ascii=False,
        trailing_newline=True,
    )
    return marker


def _development_journal_sha256(path: Path) -> str:
    try:
        payload = Path(path).read_bytes()
    except OSError as exc:
        raise DevelopmentRecoveryConflict(
            "development-journal",
            [str(path)],
        ) from exc
    return _sha256_bytes(payload)


def _development_marker_identity_matches(
    marker: dict[str, Any],
    *,
    campaign_dir: Path,
    investigator_id: str,
    transaction_id: str,
    inflight_path: Path,
) -> bool:
    return bool(
        marker.get("status") == "active"
        and marker.get("transaction_id") == transaction_id
        and marker.get("campaign_id") == campaign_dir.name
        and marker.get("investigator_id") == investigator_id
        and marker.get("inflight_ref")
        == _journal_display_path(campaign_dir, inflight_path)
    )


def _transition_development_active_marker(
    *,
    campaign_dir: Path,
    investigator_id: str,
    inflight_path: Path,
    transaction_id: str,
    expected_phases: set[str],
    phase: str,
    journal_sha256: str,
    next_journal_sha256: str | None = None,
    transition_at: str | None = None,
) -> dict[str, Any]:
    """CAS one durable marker phase while the investigator lock is held."""
    marker_path = _development_active_marker_path(campaign_dir, investigator_id)
    try:
        marker = coc_development.active_development_transaction(
            campaign_dir, investigator_id
        )
    except ValueError as exc:
        raise DevelopmentRecoveryConflict(
            transaction_id, [_journal_display_path(campaign_dir, marker_path)]
        ) from exc
    if marker is None or not _development_marker_identity_matches(
        marker,
        campaign_dir=campaign_dir,
        investigator_id=investigator_id,
        transaction_id=transaction_id,
        inflight_path=inflight_path,
    ):
        raise DevelopmentRecoveryConflict(
            transaction_id, [_journal_display_path(campaign_dir, marker_path)]
        )
    if marker.get("schema_version") != 2:
        raise DevelopmentRecoveryConflict(
            transaction_id, [_journal_display_path(campaign_dir, marker_path)]
        )
    current_phase = str(marker.get("phase"))
    if current_phase not in expected_phases:
        raise DevelopmentRecoveryConflict(
            transaction_id, [_journal_display_path(campaign_dir, marker_path)]
        )
    actual_digest = _development_journal_sha256(inflight_path)
    allowed_digests = {
        value for value in (
            marker.get("journal_sha256"), marker.get("next_journal_sha256")
        ) if isinstance(value, str)
    }
    if current_phase != "creating" and actual_digest not in allowed_digests:
        raise DevelopmentRecoveryConflict(
            transaction_id,
            [
                _journal_display_path(campaign_dir, marker_path),
                _journal_display_path(campaign_dir, inflight_path),
            ],
        )
    if phase in {"journaled", "committed", "recovered"}:
        next_journal_sha256 = None
    if phase == "journaled":
        transition_at = None
    elif not isinstance(transition_at, str) or not transition_at:
        raise DevelopmentRecoveryConflict(
            transaction_id, [_journal_display_path(campaign_dir, marker_path)]
        )
    updated = {
        "schema_version": 2,
        "status": "active",
        "transaction_id": transaction_id,
        "investigator_id": investigator_id,
        "campaign_id": campaign_dir.name,
        "ending_id": str(marker["ending_id"]),
        "inflight_ref": _journal_display_path(campaign_dir, inflight_path),
        "created_at": str(marker["created_at"]),
        "phase": phase,
        "journal_sha256": journal_sha256,
        "next_journal_sha256": next_journal_sha256,
        "transition_at": transition_at,
    }
    coc_fileio.write_json_atomic(
        marker_path,
        updated,
        indent=2,
        ensure_ascii=False,
        trailing_newline=True,
    )
    try:
        persisted = coc_development.active_development_transaction(
            campaign_dir, investigator_id
        )
    except ValueError as exc:
        raise DevelopmentRecoveryConflict(
            transaction_id, [_journal_display_path(campaign_dir, marker_path)]
        ) from exc
    if persisted != updated:
        raise DevelopmentRecoveryConflict(
            transaction_id, [_journal_display_path(campaign_dir, marker_path)]
        )
    return updated


def _mark_development_journal_durable(
    *,
    campaign_dir: Path,
    investigator_id: str,
    inflight_path: Path,
    transaction_id: str,
) -> dict[str, Any]:
    digest = _development_journal_sha256(inflight_path)
    return _transition_development_active_marker(
        campaign_dir=campaign_dir,
        investigator_id=investigator_id,
        inflight_path=inflight_path,
        transaction_id=transaction_id,
        expected_phases={"creating"},
        phase="journaled",
        journal_sha256=digest,
    )


def _release_development_active_marker(
    *,
    campaign_dir: Path,
    investigator_id: str,
    transaction_id: str,
    missing_ok: bool = True,
    expected_phases: set[str] | None = None,
) -> None:
    marker_path = _development_active_marker_path(campaign_dir, investigator_id)
    try:
        marker = coc_development.active_development_transaction(
            campaign_dir, investigator_id
        )
    except ValueError as exc:
        raise DevelopmentRecoveryConflict(
            transaction_id, [_journal_display_path(campaign_dir, marker_path)]
        ) from exc
    if marker is None:
        if missing_ok:
            return
        raise DevelopmentRecoveryConflict(
            transaction_id, [_journal_display_path(campaign_dir, marker_path)]
        )
    if (
        marker.get("transaction_id") != transaction_id
        or marker.get("campaign_id") != campaign_dir.name
        or marker.get("investigator_id") != investigator_id
    ):
        raise DevelopmentRecoveryConflict(
            transaction_id, [_journal_display_path(campaign_dir, marker_path)]
        )
    if marker.get("schema_version") != 2:
        raise DevelopmentRecoveryConflict(
            transaction_id, [_journal_display_path(campaign_dir, marker_path)]
        )
    marker_phase = str(marker.get("phase"))
    if expected_phases is not None and marker_phase not in expected_phases:
        raise DevelopmentRecoveryConflict(
            transaction_id, [_journal_display_path(campaign_dir, marker_path)]
        )
    marker_path.unlink()


def _write_development_journal(path: Path, journal: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    coc_fileio.write_json_atomic(
        path,
        journal,
        indent=2,
        ensure_ascii=False,
        trailing_newline=True,
    )


def _capture_development_inflight(
    *,
    campaign_dir: Path,
    investigator_id: str,
    ending_id: str,
    settlement_path: Path,
    inflight_path: Path,
    ending: dict[str, Any],
    rng: random.Random,
) -> dict[str, Any]:
    files, logs = _development_transaction_paths(
        campaign_dir, investigator_id, settlement_path, ending
    )
    transaction_id = _development_transaction_id(ending_id, investigator_id)
    coc_root = campaign_dir.parents[1]
    unsafe = [
        _journal_display_path(campaign_dir, path)
        for path in [*files.values(), *logs.values()]
        if not _target_kind_is_safe(coc_root, path)
    ]
    if unsafe:
        raise DevelopmentRecoveryConflict(transaction_id, sorted(set(unsafe)))
    try:
        file_preimages = {name: _file_image(path) for name, path in files.items()}
        log_preimages = {name: _log_image(path) for name, path in logs.items()}
    except (OSError, UnicodeError) as exc:
        raise DevelopmentRecoveryConflict(
            transaction_id,
            [_journal_display_path(campaign_dir, inflight_path)],
        ) from exc
    if not all(_valid_file_image(image) for image in file_preimages.values()):
        raise DevelopmentRecoveryConflict(
            transaction_id,
            [_journal_display_path(campaign_dir, inflight_path)],
        )
    if not all(_valid_log_image(image) for image in log_preimages.values()):
        raise DevelopmentRecoveryConflict(
            transaction_id,
            [_journal_display_path(campaign_dir, inflight_path)],
        )
    _claim_development_active_marker(
        campaign_dir=campaign_dir,
        investigator_id=investigator_id,
        ending_id=ending_id,
        inflight_path=inflight_path,
    )
    journal = {
        "schema_version": 2,
        "status": "planning",
        "transaction_id": transaction_id,
        "ending_id": ending_id,
        "investigator_id": investigator_id,
        "conclusion_reward_id": ending.get("conclusion_reward_id"),
        "rng_state": _random_state_to_json(rng.getstate()),
        "file_preimages": file_preimages,
        "log_preimages": log_preimages,
        "prepared_at": _now(),
    }
    _write_development_journal(inflight_path, journal)
    return journal


def _journal_ending(journal: dict[str, Any]) -> dict[str, Any]:
    reward_id = journal.get("conclusion_reward_id")
    return {
        "ending_id": journal.get("ending_id"),
        "conclusion_reward_id": reward_id if isinstance(reward_id, str) else None,
    }


def _journal_display_path(campaign_dir: Path, path: Path) -> str:
    try:
        return path.relative_to(campaign_dir.parents[1]).as_posix()
    except ValueError:
        return str(path)


class DevelopmentRecoveryConflict(RuntimeOperationError):
    """An incomplete settlement diverged from both owned transaction images."""

    code = "RECOVERY_CONFLICT"

    def __init__(self, transaction_id: str, conflicting_paths: list[str]):
        self.transaction_id = transaction_id
        self.conflicting_paths = list(conflicting_paths)
        joined = ", ".join(self.conflicting_paths)
        super().__init__(
            f"RECOVERY_CONFLICT {transaction_id}: foreign divergence at {joined}"
        )


def read_development_guarded_character(
    campaign_dir: Path,
    investigator_id: str,
    character_path: Path,
) -> dict[str, Any]:
    """Read shared character state while excluding incomplete settlements."""
    try:
        return coc_investigator_guard.read_reusable_character(
            Path(campaign_dir).parents[1], investigator_id, character_path
        )
    except coc_investigator_guard.ReusableInvestigatorRecoveryConflict as exc:
        raise DevelopmentRecoveryConflict(
            exc.transaction_id,
            [_journal_display_path(Path(campaign_dir), exc.marker_path)],
        ) from exc
    except ValueError as exc:
        marker_path = _development_active_marker_path(
            Path(campaign_dir), investigator_id
        )
        if marker_path.is_file() or marker_path.is_symlink():
            raise DevelopmentRecoveryConflict(
                "development-reader",
                [_journal_display_path(Path(campaign_dir), marker_path)],
            ) from exc
        raise RuntimeOperationError(str(exc)) from exc


class DevelopmentTargetConflict(RuntimeOperationError):
    """A settlement invocation does not belong to the ending's frozen party."""

    code = "SETTLEMENT_TARGET_CONFLICT"

    def __init__(self, investigator_id: str, frozen_ids: list[str]):
        self.investigator_id = investigator_id
        self.frozen_ids = list(frozen_ids)
        super().__init__(
            "SETTLEMENT_TARGET_CONFLICT: investigator "
            f"{investigator_id!r} is not in frozen ending targets {frozen_ids!r}"
        )


def _same_file_image(current: dict[str, Any], expected: Any) -> bool:
    return (
        isinstance(expected, dict)
        and set(expected) == {"exists", "text", "sha256"}
        and current == expected
    )


def _development_marker_for_inflight(
    *,
    campaign_dir: Path,
    investigator_id: str,
    inflight_path: Path,
    transaction_id: str,
) -> dict[str, Any] | None:
    marker_path = _development_active_marker_path(campaign_dir, investigator_id)
    try:
        marker = coc_development.active_development_transaction(
            campaign_dir, investigator_id
        )
    except ValueError as exc:
        raise DevelopmentRecoveryConflict(
            transaction_id, [_journal_display_path(campaign_dir, marker_path)]
        ) from exc
    if marker is None:
        return None
    if not _development_marker_identity_matches(
        marker,
        campaign_dir=campaign_dir,
        investigator_id=investigator_id,
        transaction_id=transaction_id,
        inflight_path=inflight_path,
    ):
        raise DevelopmentRecoveryConflict(
            transaction_id, [_journal_display_path(campaign_dir, marker_path)]
        )
    return marker


def _development_marker_phase(marker: dict[str, Any] | None) -> str | None:
    if marker is None:
        return None
    if marker.get("schema_version") != 2:
        return None
    return str(marker.get("phase"))


def _recovered_development_journal(
    journal: dict[str, Any], *, recovered_at: str
) -> dict[str, Any]:
    return {
        "schema_version": 2,
        "status": "recovered",
        "transaction_id": journal["transaction_id"],
        "ending_id": journal["ending_id"],
        "investigator_id": journal["investigator_id"],
        "conclusion_reward_id": journal.get("conclusion_reward_id"),
        "rng_state": journal.get("rng_state"),
        "prepared_at": journal.get("prepared_at"),
        "recovered_at": recovered_at,
    }


def _journal_serialized_sha256(journal: dict[str, Any]) -> str:
    text = json.dumps(journal, indent=2, ensure_ascii=False) + "\n"
    return _sha256_bytes(text.encode("utf-8"))


def _recover_development_inflight(
    *,
    campaign_dir: Path,
    investigator_id: str,
    settlement_path: Path,
    inflight_path: Path,
    journal: dict[str, Any],
    dry_run: bool = False,
) -> dict[str, Any]:
    status = journal.get("status")
    transaction_id = str(journal.get("transaction_id") or "unknown-development-txn")
    marker = _development_marker_for_inflight(
        campaign_dir=campaign_dir,
        investigator_id=investigator_id,
        inflight_path=inflight_path,
        transaction_id=transaction_id,
    )
    marker_phase = _development_marker_phase(marker)
    journal_digest = _development_journal_sha256(inflight_path)
    if status == "recovered":
        if (
            journal.get("schema_version") != 2
            or journal.get("investigator_id") != investigator_id
            or not isinstance(journal.get("ending_id"), str)
            or journal.get("transaction_id")
            != _development_transaction_id(str(journal.get("ending_id")), investigator_id)
        ):
            raise DevelopmentRecoveryConflict(
                transaction_id,
                [_journal_display_path(campaign_dir, inflight_path)],
            )
        if marker is not None:
            current_digest = marker.get("journal_sha256")
            next_digest = marker.get("next_journal_sha256")
            if marker_phase == "recovering" and next_digest == journal_digest:
                if not dry_run:
                    marker = _transition_development_active_marker(
                        campaign_dir=campaign_dir,
                        investigator_id=investigator_id,
                        inflight_path=inflight_path,
                        transaction_id=transaction_id,
                        expected_phases={"recovering"},
                        phase="recovered",
                        journal_sha256=journal_digest,
                        transition_at=str(marker["transition_at"]),
                    )
                    marker_phase = "recovered"
            elif marker_phase != "recovered" or current_digest != journal_digest:
                raise DevelopmentRecoveryConflict(
                    transaction_id,
                    [
                        _journal_display_path(
                            campaign_dir,
                            _development_active_marker_path(
                                campaign_dir, investigator_id
                            ),
                        ),
                        _journal_display_path(campaign_dir, inflight_path),
                    ],
                )
        if not dry_run:
            _release_development_active_marker(
                campaign_dir=campaign_dir,
                investigator_id=investigator_id,
                transaction_id=transaction_id,
                expected_phases={"recovered"},
            )
        return {
            "transaction_id": transaction_id,
            "status": "RECOVERED",
            "conflicting_paths": [],
        }
    if (
        journal.get("schema_version") != 2
        or status not in {"planning", "prepared"}
        or journal.get("investigator_id") != investigator_id
        or not isinstance(journal.get("ending_id"), str)
        or journal.get("transaction_id")
        != _development_transaction_id(str(journal.get("ending_id")), investigator_id)
    ):
        raise DevelopmentRecoveryConflict(
            transaction_id,
            [_journal_display_path(campaign_dir, inflight_path)],
        )
    if marker_phase in {"journaled", "committed"} and (
        marker is None or marker.get("journal_sha256") != journal_digest
    ):
        raise DevelopmentRecoveryConflict(
            transaction_id,
            [
                _journal_display_path(
                    campaign_dir,
                    _development_active_marker_path(campaign_dir, investigator_id),
                ),
                _journal_display_path(campaign_dir, inflight_path),
            ],
        )
    if marker_phase == "recovering" and (
        marker is None or marker.get("journal_sha256") != journal_digest
    ):
        # A recovering marker permits exactly the old prepared journal or the
        # deterministic recovered journal.  The latter is handled above.
        raise DevelopmentRecoveryConflict(
            transaction_id,
            [
                _journal_display_path(
                    campaign_dir,
                    _development_active_marker_path(campaign_dir, investigator_id),
                ),
                _journal_display_path(campaign_dir, inflight_path),
            ],
        )
    if marker_phase == "recovered":
        raise DevelopmentRecoveryConflict(
            transaction_id,
            [_journal_display_path(campaign_dir, inflight_path)],
        )
    files, logs = _development_transaction_paths(
        campaign_dir,
        investigator_id,
        settlement_path,
        _journal_ending(journal),
    )
    file_preimages = journal.get("file_preimages")
    log_preimages = journal.get("log_preimages")
    if (
        not isinstance(file_preimages, dict)
        or set(file_preimages) != set(files)
        or not isinstance(log_preimages, dict)
        or set(log_preimages) != set(logs)
        or not all(_valid_file_image(image) for image in file_preimages.values())
        or not all(_valid_log_image(image) for image in log_preimages.values())
    ):
        raise DevelopmentRecoveryConflict(
            transaction_id,
            [_journal_display_path(campaign_dir, inflight_path)],
        )

    file_postimages = journal.get("file_postimages")
    log_postimages = journal.get("log_postimages")
    if status == "prepared" and (
        not isinstance(file_postimages, dict)
        or set(file_postimages) != set(files)
        or not isinstance(log_postimages, dict)
        or set(log_postimages) != set(logs)
        or not all(_valid_file_image(image) for image in file_postimages.values())
        or not all(
            _valid_log_postimage(image) for image in log_postimages.values()
        )
    ):
        raise DevelopmentRecoveryConflict(
            transaction_id,
            [_journal_display_path(campaign_dir, inflight_path)],
        )

    conflicts: list[str] = []
    current_files: dict[str, dict[str, Any]] = {}
    all_preimage = True
    coc_root = campaign_dir.parents[1]
    for name, path in files.items():
        preimage = file_preimages[name]
        if not _target_kind_is_safe(coc_root, path):
            conflicts.append(_journal_display_path(campaign_dir, path))
            continue
        try:
            current = _file_image(path)
        except (OSError, UnicodeError):
            conflicts.append(_journal_display_path(campaign_dir, path))
            continue
        current_files[name] = current
        is_preimage = _same_file_image(current, preimage)
        all_preimage = all_preimage and is_preimage
        owned = is_preimage
        if status == "prepared":
            owned = owned or _same_file_image(current, file_postimages[name])
        if not owned:
            conflicts.append(_journal_display_path(campaign_dir, path))

    current_log_deltas: dict[str, bytes] = {}
    for name, path in logs.items():
        preimage = log_preimages[name]
        if not isinstance(preimage, dict) or set(preimage) != {
            "exists", "size", "prefix_sha256"
        }:
            conflicts.append(_journal_display_path(campaign_dir, path))
            continue
        size = preimage.get("size")
        pre_exists = preimage.get("exists")
        current_exists = path.is_file() and not path.is_symlink()
        if not _target_kind_is_safe(coc_root, path):
            conflicts.append(_journal_display_path(campaign_dir, path))
            continue
        try:
            current = path.read_bytes() if current_exists else b""
        except OSError:
            conflicts.append(_journal_display_path(campaign_dir, path))
            continue
        if (
            not isinstance(pre_exists, bool)
            or isinstance(size, bool)
            or not isinstance(size, int)
            or size < 0
            or len(current) < size
            or _sha256_bytes(current[:size]) != preimage.get("prefix_sha256")
        ):
            conflicts.append(_journal_display_path(campaign_dir, path))
            continue
        delta = current[size:]
        current_log_deltas[name] = delta
        all_preimage = bool(
            all_preimage and current_exists == pre_exists and not delta
        )
        allowed_suffix = b""
        if status == "prepared":
            postimage = log_postimages[name]
            suffix = postimage.get("suffix") if isinstance(postimage, dict) else None
            if not isinstance(suffix, str):
                conflicts.append(_journal_display_path(campaign_dir, path))
                continue
            allowed_suffix = suffix.encode("utf-8")
        # Existence is part of the preimage.  The only provably owned
        # transition from absent to present is a non-empty prefix of the exact
        # planned append.  An empty created file is ambiguous (the process may
        # have crashed just after open), so fail closed instead of unlinking it.
        if status == "planning" and current_exists != pre_exists:
            conflicts.append(_journal_display_path(campaign_dir, path))
            continue
        if status == "prepared" and (
            (pre_exists and not current_exists)
            or (
                not pre_exists
                and current_exists
                and not delta
            )
        ):
            conflicts.append(_journal_display_path(campaign_dir, path))
            continue
        if not allowed_suffix.startswith(delta):
            conflicts.append(_journal_display_path(campaign_dir, path))

    if conflicts:
        raise DevelopmentRecoveryConflict(
            transaction_id, sorted(set(conflicts))
        )

    # Schema-v2 ``creating`` proves application has not been authorized.  A
    # non-preimage target contradicts that durable phase and must remain
    # untouched.
    if marker_phase == "creating" and not all_preimage:
        raise DevelopmentRecoveryConflict(
            transaction_id,
            [
                _journal_display_path(
                    campaign_dir,
                    _development_active_marker_path(campaign_dir, investigator_id),
                )
            ],
        )
    if marker_phase == "committed" and status != "prepared":
        raise DevelopmentRecoveryConflict(
            transaction_id, [_journal_display_path(campaign_dir, inflight_path)]
        )

    if status == "prepared":
        settlement_committed = _same_file_image(
            current_files["settlement"], file_postimages["settlement"]
        ) and not _same_file_image(
            current_files["settlement"], file_preimages["settlement"]
        )
        if settlement_committed and marker_phase != "recovering":
            if _settled_receipt_for_ending(
                settlement_path,
                str(journal["ending_id"]),
                investigator_id,
            ) is None:
                raise DevelopmentRecoveryConflict(
                    transaction_id,
                    [_journal_display_path(campaign_dir, settlement_path)],
                )
            incomplete = [
                _journal_display_path(campaign_dir, files[name])
                for name in files
                if not _same_file_image(current_files[name], file_postimages[name])
            ]
            incomplete.extend(
                _journal_display_path(campaign_dir, logs[name])
                for name in logs
                if current_log_deltas.get(name, b"")
                != str(log_postimages[name].get("suffix") or "").encode("utf-8")
            )
            if incomplete:
                raise DevelopmentRecoveryConflict(
                    transaction_id, sorted(set(incomplete))
                )
            if not dry_run:
                if marker_phase == "creating":
                    if not all_preimage:
                        raise DevelopmentRecoveryConflict(
                            transaction_id,
                            [_journal_display_path(campaign_dir, inflight_path)],
                        )
                    marker = _mark_development_journal_durable(
                        campaign_dir=campaign_dir,
                        investigator_id=investigator_id,
                        inflight_path=inflight_path,
                        transaction_id=transaction_id,
                    )
                    marker_phase = "journaled"
                if marker_phase == "journaled":
                    marker = _transition_development_active_marker(
                        campaign_dir=campaign_dir,
                        investigator_id=investigator_id,
                        inflight_path=inflight_path,
                        transaction_id=transaction_id,
                        expected_phases={"journaled"},
                        phase="committed",
                        journal_sha256=journal_digest,
                        transition_at=_now(),
                    )
                    marker_phase = "committed"
                if marker is not None and marker_phase != "committed":
                    raise DevelopmentRecoveryConflict(
                        transaction_id,
                        [_journal_display_path(campaign_dir, inflight_path)],
                    )
                _release_development_active_marker(
                    campaign_dir=campaign_dir,
                    investigator_id=investigator_id,
                    transaction_id=transaction_id,
                    expected_phases={"committed"},
                )
                inflight_path.unlink(missing_ok=True)
            return {
                "transaction_id": transaction_id,
                "status": "COMMITTED",
                "conflicting_paths": [],
            }

    # All current images have been proven to be either the exact prepared
    # preimage or an exact settlement-owned intermediate/postimage.  Validate
    # every target before this point, then roll back as one recovery action.
    if dry_run:
        return {
            "transaction_id": transaction_id,
            "status": "WOULD_ROLL_BACK",
            "conflicting_paths": [],
        }
    if marker is None:
        marker = _claim_development_active_marker(
            campaign_dir=campaign_dir,
            investigator_id=investigator_id,
            ending_id=str(journal["ending_id"]),
            inflight_path=inflight_path,
        )
        marker_phase = _development_marker_phase(marker)
    if marker_phase == "creating":
        _mark_development_journal_durable(
            campaign_dir=campaign_dir,
            investigator_id=investigator_id,
            inflight_path=inflight_path,
            transaction_id=transaction_id,
        )
        marker_phase = "journaled"
    if marker_phase == "journaled":
        recovered_at = _now()
        recovered = _recovered_development_journal(
            journal, recovered_at=recovered_at
        )
        recovered_digest = _journal_serialized_sha256(recovered)
        marker = _transition_development_active_marker(
            campaign_dir=campaign_dir,
            investigator_id=investigator_id,
            inflight_path=inflight_path,
            transaction_id=transaction_id,
            expected_phases={"journaled"},
            phase="recovering",
            journal_sha256=journal_digest,
            next_journal_sha256=recovered_digest,
            transition_at=recovered_at,
        )
        marker_phase = "recovering"
    elif marker_phase == "recovering":
        assert marker is not None
        recovered_at = str(marker["transition_at"])
        recovered = _recovered_development_journal(
            journal, recovered_at=recovered_at
        )
        recovered_digest = _journal_serialized_sha256(recovered)
        if recovered_digest != marker.get("next_journal_sha256"):
            raise DevelopmentRecoveryConflict(
                transaction_id,
                [_journal_display_path(campaign_dir, inflight_path)],
            )
    else:
        raise DevelopmentRecoveryConflict(
            transaction_id,
            [_journal_display_path(campaign_dir, inflight_path)],
        )
    for name, path in files.items():
        preimage = file_preimages[name]
        if preimage["exists"] is True:
            coc_fileio.write_text_atomic(path, str(preimage["text"]))
        else:
            path.unlink(missing_ok=True)
    for name, path in logs.items():
        preimage = log_preimages[name]
        size = int(preimage["size"])
        if preimage["exists"] is True:
            with path.open("r+b") as handle:
                handle.truncate(size)
                handle.flush()
                os.fsync(handle.fileno())
        else:
            path.unlink(missing_ok=True)
    _write_development_journal(inflight_path, recovered)
    marker = _transition_development_active_marker(
        campaign_dir=campaign_dir,
        investigator_id=investigator_id,
        inflight_path=inflight_path,
        transaction_id=transaction_id,
        expected_phases={"recovering"},
        phase="recovered",
        journal_sha256=recovered_digest,
        transition_at=recovered_at,
    )
    _release_development_active_marker(
        campaign_dir=campaign_dir,
        investigator_id=investigator_id,
        transaction_id=transaction_id,
        expected_phases={"recovered"},
    )
    return {
        "transaction_id": transaction_id,
        "status": "ROLLED_BACK",
        "conflicting_paths": [],
    }


def _validate_development_journal_structure(
    *,
    campaign_dir: Path,
    inflight_path: Path,
    journal: dict[str, Any],
) -> tuple[str, str, Path]:
    investigator_id = journal.get("investigator_id")
    ending_id = journal.get("ending_id")
    transaction_id = journal.get("transaction_id")
    if (
        not isinstance(investigator_id, str)
        or _SAFE_ID.fullmatch(investigator_id) is None
        or not isinstance(ending_id, str)
        or _SAFE_ID.fullmatch(ending_id) is None
        or transaction_id != _development_transaction_id(ending_id, investigator_id)
        or journal.get("schema_version") != 2
        or journal.get("status") not in {"planning", "prepared", "recovered"}
    ):
        raise DevelopmentRecoveryConflict(
            str(transaction_id or "unknown-development-txn"),
            [_journal_display_path(campaign_dir, inflight_path)],
        )
    settlement_path = coc_development.ending_settlement_path(
        campaign_dir, ending_id, investigator_id
    )
    canonical_inflight = settlement_path.with_name(f"{investigator_id}.inflight.json")
    if (
        inflight_path != canonical_inflight
        or not _target_kind_is_safe(campaign_dir.parents[1], inflight_path)
    ):
        raise DevelopmentRecoveryConflict(
            transaction_id,
            [_journal_display_path(campaign_dir, inflight_path)],
        )
    if journal.get("status") == "recovered":
        return investigator_id, ending_id, settlement_path
    files, logs = _development_transaction_paths(
        campaign_dir,
        investigator_id,
        settlement_path,
        _journal_ending(journal),
    )
    file_preimages = journal.get("file_preimages")
    log_preimages = journal.get("log_preimages")
    if (
        not isinstance(file_preimages, dict)
        or set(file_preimages) != set(files)
        or not all(_valid_file_image(image) for image in file_preimages.values())
        or not isinstance(log_preimages, dict)
        or set(log_preimages) != set(logs)
        or not all(_valid_log_image(image) for image in log_preimages.values())
    ):
        raise DevelopmentRecoveryConflict(
            transaction_id,
            [_journal_display_path(campaign_dir, inflight_path)],
        )
    if journal.get("status") == "prepared":
        file_postimages = journal.get("file_postimages")
        log_postimages = journal.get("log_postimages")
        if (
            not isinstance(file_postimages, dict)
            or set(file_postimages) != set(files)
            or not all(_valid_file_image(image) for image in file_postimages.values())
            or not isinstance(log_postimages, dict)
            or set(log_postimages) != set(logs)
            or not all(_valid_log_postimage(image) for image in log_postimages.values())
        ):
            raise DevelopmentRecoveryConflict(
                transaction_id,
                [_journal_display_path(campaign_dir, inflight_path)],
            )
        settlement_image = file_postimages["settlement"]
        if settlement_image.get("exists") is not True:
            raise DevelopmentRecoveryConflict(
                transaction_id,
                [_journal_display_path(campaign_dir, settlement_path)],
            )
        try:
            planned = json.loads(str(settlement_image["text"]))
        except json.JSONDecodeError as exc:
            raise DevelopmentRecoveryConflict(
                transaction_id,
                [_journal_display_path(campaign_dir, settlement_path)],
            ) from exc
        if _settled_receipt_from_value(
            planned, ending_id, investigator_id
        ) is None:
            raise DevelopmentRecoveryConflict(
                transaction_id,
                [_journal_display_path(campaign_dir, settlement_path)],
            )
    return investigator_id, ending_id, settlement_path


def _campaign_reusable_investigator_ids(campaign_dir: Path) -> set[str]:
    """Return safe reusable actors this campaign may read through canonical APIs."""
    values: set[str] = set()
    party_path = campaign_dir / "party.json"
    if party_path.is_file() and not party_path.is_symlink():
        try:
            party = _read_object(party_path)
        except RuntimeOperationError:
            party = {}
        for item in party.get("investigator_ids") or []:
            if isinstance(item, str) and _SAFE_ID.fullmatch(item):
                values.add(item)
    state_root = campaign_dir / "save" / "investigator-state"
    if state_root.is_dir() and not state_root.is_symlink():
        for path in state_root.glob("*.json"):
            candidate = path.stem
            if not path.is_symlink() and _SAFE_ID.fullmatch(candidate):
                values.add(candidate)
    return values


def recover_development_transactions(campaign_dir: Path | str) -> list[dict[str, Any]]:
    """Recover every incomplete settlement under the caller's campaign lock.

    Canonical toolbox/runtime entry points call this before their own reads or
    writes.  Foreign divergence is fail-closed and non-destructive.
    """
    campaign_dir = Path(campaign_dir)
    root = campaign_dir / "save" / "development-settlements"
    paths = sorted(root.rglob("*.inflight.json")) if root.is_dir() else []
    loaded: list[tuple[Path, dict[str, Any], str, str, Path]] = []
    conflicts: list[str] = []
    seen_transactions: dict[str, Path] = {}
    for inflight_path in paths:
        try:
            journal = _read_object(inflight_path)
            investigator_id, ending_id, settlement_path = (
                _validate_development_journal_structure(
                    campaign_dir=campaign_dir,
                    inflight_path=inflight_path,
                    journal=journal,
                )
            )
        except (OSError, RuntimeOperationError, UnicodeError) as exc:
            if isinstance(exc, DevelopmentRecoveryConflict):
                conflicts.extend(exc.conflicting_paths)
            else:
                conflicts.append(_journal_display_path(campaign_dir, inflight_path))
            continue
        transaction_id = str(journal["transaction_id"])
        prior_path = seen_transactions.get(transaction_id)
        if prior_path is not None:
            conflicts.extend([
                _journal_display_path(campaign_dir, prior_path),
                _journal_display_path(campaign_dir, inflight_path),
            ])
        else:
            seen_transactions[transaction_id] = inflight_path
        loaded.append((
            inflight_path, journal, investigator_id, ending_id, settlement_path
        ))
    if conflicts:
        raise DevelopmentRecoveryConflict(
            "development-recovery-set", sorted(set(conflicts))
        )

    recovered: list[dict[str, Any]] = []
    lock_ids = _campaign_reusable_investigator_ids(campaign_dir) | {
        item[2] for item in loaded
    }
    if not lock_ids and not loaded:
        return []
    with ExitStack() as locks:
        # The caller already owns exactly this campaign lock.  Reusable locks
        # are always acquired once, in sorted order, and no foreign campaign
        # lock is ever acquired behind them.
        for investigator_id in sorted(lock_ids):
            locks.enter_context(coc_fileio.advisory_file_lock(
                _development_investigator_lock_path(campaign_dir, investigator_id),
                wait_seconds=5.0,
            ))
        loaded_by_inflight = {item[0]: item for item in loaded}
        orphan_markers: list[tuple[str, str]] = []
        marker_conflicts: list[str] = []
        for investigator_id in sorted(lock_ids):
            marker_path = _development_active_marker_path(
                campaign_dir, investigator_id
            )
            try:
                marker = coc_development.active_development_transaction(
                    campaign_dir, investigator_id
                )
            except ValueError:
                marker_conflicts.append(
                    _journal_display_path(campaign_dir, marker_path)
                )
                continue
            if marker is None:
                continue
            transaction_id = str(marker["transaction_id"])
            if marker.get("campaign_id") != campaign_dir.name:
                # Only the origin campaign may inspect/recover its journal.
                # The foreign caller returns without touching canonical state.
                raise DevelopmentRecoveryConflict(
                    transaction_id,
                    [_journal_display_path(campaign_dir, marker_path)],
                )
            ref = Path(str(marker.get("inflight_ref") or ""))
            referenced = campaign_dir.parents[1] / ref
            loaded_item = loaded_by_inflight.get(referenced)
            if (
                ref.is_absolute()
                or ".." in ref.parts
                or not _target_kind_is_safe(campaign_dir.parents[1], referenced)
            ):
                marker_conflicts.append(
                    _journal_display_path(campaign_dir, marker_path)
                )
            elif loaded_item is None:
                # Only a schema-v2 creating marker proves application was never
                # authorized.  Legacy, journaled, recovering, recovered, and
                # committed markers without their fingerprinted journal are
                # preserved fail-closed.
                if (
                    marker.get("schema_version") == 2
                    and marker.get("phase") == "creating"
                ):
                    orphan_markers.append((investigator_id, transaction_id))
                else:
                    marker_conflicts.append(
                        _journal_display_path(campaign_dir, marker_path)
                    )
            elif (
                str(loaded_item[1].get("transaction_id")) != transaction_id
                or loaded_item[2] != investigator_id
            ):
                marker_conflicts.extend([
                    _journal_display_path(campaign_dir, marker_path),
                    _journal_display_path(campaign_dir, referenced),
                ])
        if marker_conflicts:
            raise DevelopmentRecoveryConflict(
                "development-recovery-set", sorted(set(marker_conflicts))
            )
        # Validate the entire immutable journal set again while all shared
        # investigator locks are held. No canonical target has changed yet.
        for inflight_path, journal, investigator_id, _ending_id, settlement_path in loaded:
            current = _read_object(inflight_path)
            if current != journal:
                raise DevelopmentRecoveryConflict(
                    "development-recovery-set",
                    [_journal_display_path(campaign_dir, inflight_path)],
                )
            _validate_development_journal_structure(
                campaign_dir=campaign_dir,
                inflight_path=inflight_path,
                journal=current,
            )
        # More than one active journal cannot be produced by the canonical
        # campaign-locked path.  They also share append logs and pacing/SAN
        # mirrors, so applying one rollback could invalidate a later journal
        # after the set-level check.  Reject the overlapping set before any
        # mutation instead of attempting an order-dependent partial recovery.
        target_owners: dict[Path, tuple[str, Path]] = {}
        overlap_conflicts: list[str] = []
        for inflight_path, journal, investigator_id, _ending_id, settlement_path in loaded:
            if journal.get("status") == "recovered":
                continue
            files, logs = _development_transaction_paths(
                campaign_dir,
                investigator_id,
                settlement_path,
                _journal_ending(journal),
            )
            transaction_id = str(journal["transaction_id"])
            for target in [*files.values(), *logs.values()]:
                prior = target_owners.get(target)
                if prior is None:
                    target_owners[target] = (transaction_id, inflight_path)
                    continue
                if prior[0] != transaction_id:
                    overlap_conflicts.extend([
                        _journal_display_path(campaign_dir, prior[1]),
                        _journal_display_path(campaign_dir, inflight_path),
                        _journal_display_path(campaign_dir, target),
                    ])
        if overlap_conflicts:
            raise DevelopmentRecoveryConflict(
                "development-recovery-set", sorted(set(overlap_conflicts))
            )
        # Validate every journal against the same locked filesystem snapshot.
        # Only after every dry run succeeds may any rollback/cleanup begin.
        for inflight_path, journal, investigator_id, _ending_id, settlement_path in loaded:
            _recover_development_inflight(
                campaign_dir=campaign_dir,
                investigator_id=investigator_id,
                settlement_path=settlement_path,
                inflight_path=inflight_path,
                journal=journal,
                dry_run=True,
            )
        # No journal or marker in the locked set conflicts.  Origin-only orphan
        # cleanup is now safe and cannot expose another campaign's partial state.
        for investigator_id, transaction_id in orphan_markers:
            _release_development_active_marker(
                campaign_dir=campaign_dir,
                investigator_id=investigator_id,
                transaction_id=transaction_id,
                missing_ok=False,
                expected_phases={"creating"},
            )
        for inflight_path, journal, investigator_id, _ending_id, settlement_path in loaded:
            recovered.append(_recover_development_inflight(
                campaign_dir=campaign_dir,
                investigator_id=investigator_id,
                settlement_path=settlement_path,
                inflight_path=inflight_path,
                journal=journal,
            ))
    return recovered


def _copy_transaction_input(source: Path, target: Path) -> None:
    if not source.is_file():
        return
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, target)


def _tree_file_hashes(root: Path) -> dict[str, str]:
    if not root.is_dir():
        return {}
    return {
        path.relative_to(root).as_posix(): _sha256_bytes(path.read_bytes())
        for path in sorted(root.rglob("*"))
        if path.is_file()
    }


def _plan_development_postimages(
    *,
    campaign_dir: Path,
    investigator_id: str,
    payload: dict[str, Any],
    rng: random.Random,
    settlement_path: Path,
    ending: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    files, logs = _development_transaction_paths(
        campaign_dir, investigator_id, settlement_path, ending
    )
    coc_root = campaign_dir.parents[1]
    with tempfile.TemporaryDirectory(prefix="coc-development-plan-") as tmp:
        sandbox_coc_root = Path(tmp) / ".coc"
        sandbox_campaign = sandbox_coc_root / "campaigns" / campaign_dir.name

        for source in [
            campaign_dir / "campaign.json",
            campaign_dir / "party.json",
            campaign_dir / "scenario" / "story-graph.json",
            campaign_dir / "scenario" / "module-meta.json",
            campaign_dir / "save" / "combat.json",
            *files.values(),
            *logs.values(),
        ]:
            try:
                relative = source.relative_to(coc_root)
            except ValueError as exc:
                raise RuntimeOperationError(
                    "development transaction target escaped .coc"
                ) from exc
            _copy_transaction_input(source, sandbox_coc_root / relative)

        try:
            settlement_relative = settlement_path.relative_to(campaign_dir)
        except ValueError as exc:
            raise RuntimeOperationError(
                "development settlement path escaped its campaign"
            ) from exc
        sandbox_settlement = sandbox_campaign / settlement_relative
        before_tree = _tree_file_hashes(sandbox_coc_root)
        receipt = _development_operation_body(
            campaign_dir=sandbox_campaign,
            investigator_id=investigator_id,
            payload=payload,
            rng=rng,
            ending=ending,
            settlement_path=sandbox_settlement,
        )
        sandbox_files, sandbox_logs = _development_transaction_paths(
            sandbox_campaign,
            investigator_id,
            sandbox_settlement,
            ending,
        )
        after_tree = _tree_file_hashes(sandbox_coc_root)
        allowed_changes = {
            path.relative_to(sandbox_coc_root).as_posix()
            for path in [*sandbox_files.values(), *sandbox_logs.values()]
        }
        # Guarded shared-character reads create only the persistent lock inode
        # in the isolated planner.  It carries no game state and is not copied
        # back as a transaction postimage.
        allowed_changes.add(
            _development_investigator_lock_path(
                sandbox_campaign, investigator_id
            ).relative_to(sandbox_coc_root).as_posix()
        )
        unexpected_changes = sorted(
            relative
            for relative in set(before_tree) | set(after_tree)
            if before_tree.get(relative) != after_tree.get(relative)
            and relative not in allowed_changes
        )
        if unexpected_changes:
            raise RuntimeOperationError(
                "development planning changed untracked paths: "
                + ", ".join(unexpected_changes)
            )
        file_postimages = {
            name: _file_image(sandbox_files[name]) for name in files
        }
        log_postimages: dict[str, Any] = {}
        for name, source in logs.items():
            before = source.read_bytes() if source.is_file() else b""
            after_path = sandbox_logs[name]
            after = after_path.read_bytes() if after_path.is_file() else b""
            if not after.startswith(before):
                raise RuntimeOperationError(
                    f"development planning rewrote append-only log {name}"
                )
            suffix = after[len(before):].decode("utf-8")
            log_postimages[name] = {
                "suffix": suffix,
                "suffix_sha256": _sha256_bytes(suffix.encode("utf-8")),
            }
        return receipt, file_postimages, log_postimages


def _assert_development_preapply_cas(
    *,
    campaign_dir: Path,
    investigator_id: str,
    settlement_path: Path,
    ending: dict[str, Any],
    journal: dict[str, Any],
) -> None:
    """Validate every target against its captured preimage before any apply."""
    files, logs = _development_transaction_paths(
        campaign_dir, investigator_id, settlement_path, ending
    )
    transaction_id = str(journal.get("transaction_id") or "unknown-development-txn")
    marker = _development_marker_for_inflight(
        campaign_dir=campaign_dir,
        investigator_id=investigator_id,
        inflight_path=settlement_path.with_name(f"{investigator_id}.inflight.json"),
        transaction_id=transaction_id,
    )
    if (
        _development_marker_phase(marker) != "journaled"
        or marker is None
        or marker.get("journal_sha256")
        != _development_journal_sha256(
            settlement_path.with_name(f"{investigator_id}.inflight.json")
        )
    ):
        raise DevelopmentRecoveryConflict(
            transaction_id,
            [_journal_display_path(campaign_dir, settlement_path)],
        )
    file_preimages = journal.get("file_preimages")
    log_preimages = journal.get("log_preimages")
    file_postimages = journal.get("file_postimages")
    log_postimages = journal.get("log_postimages")
    conflicts: list[str] = []
    coc_root = campaign_dir.parents[1]
    if (
        not isinstance(file_preimages, dict)
        or set(file_preimages) != set(files)
        or not isinstance(log_preimages, dict)
        or set(log_preimages) != set(logs)
        or not isinstance(file_postimages, dict)
        or set(file_postimages) != set(files)
        or not all(
            _valid_file_image(image) for image in file_postimages.values()
        )
        or not isinstance(log_postimages, dict)
        or set(log_postimages) != set(logs)
        or not all(
            _valid_log_postimage(image) for image in log_postimages.values()
        )
    ):
        raise DevelopmentRecoveryConflict(
            transaction_id,
            [_journal_display_path(campaign_dir, settlement_path)],
        )
    for name, path in files.items():
        expected = file_preimages[name]
        if (
            not _target_kind_is_safe(coc_root, path)
            or not _valid_file_image(expected)
        ):
            conflicts.append(_journal_display_path(campaign_dir, path))
            continue
        try:
            current = _file_image(path)
        except (OSError, UnicodeError):
            conflicts.append(_journal_display_path(campaign_dir, path))
            continue
        if current != expected:
            conflicts.append(_journal_display_path(campaign_dir, path))
    for name, path in logs.items():
        expected = log_preimages[name]
        if (
            not _target_kind_is_safe(coc_root, path)
            or not _valid_log_image(expected)
        ):
            conflicts.append(_journal_display_path(campaign_dir, path))
            continue
        try:
            current = _log_image(path)
        except OSError:
            conflicts.append(_journal_display_path(campaign_dir, path))
            continue
        if current != expected:
            conflicts.append(_journal_display_path(campaign_dir, path))
    if conflicts:
        raise DevelopmentRecoveryConflict(
            transaction_id, sorted(set(conflicts))
        )


def _apply_development_postimages(
    *,
    campaign_dir: Path,
    investigator_id: str,
    settlement_path: Path,
    ending: dict[str, Any],
    journal: dict[str, Any],
) -> None:
    files, logs = _development_transaction_paths(
        campaign_dir, investigator_id, settlement_path, ending
    )
    file_postimages = journal["file_postimages"]
    log_postimages = journal["log_postimages"]
    # The settlement receipt is the commit marker and is deliberately last.
    for name, path in files.items():
        if name == "settlement":
            continue
        postimage = file_postimages[name]
        if postimage["exists"] is True:
            coc_fileio.write_text_atomic(path, str(postimage["text"]))
        else:
            path.unlink(missing_ok=True)
    for name, path in logs.items():
        suffix = str(log_postimages[name]["suffix"]).encode("utf-8")
        if not suffix:
            continue
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("ab") as handle:
            handle.write(suffix)
            handle.flush()
            os.fsync(handle.fileno())
    settlement_postimage = file_postimages["settlement"]
    if settlement_postimage["exists"] is not True:
        raise RuntimeOperationError("development plan lacks its settlement receipt")
    coc_fileio.write_text_atomic(
        settlement_path, str(settlement_postimage["text"])
    )


def _settled_receipt_from_value(
    settled: Any,
    ending_id: str,
    investigator_id: str,
) -> dict[str, Any] | None:
    if not isinstance(settled, dict):
        return None
    receipt = settled.get("receipt")
    result = receipt.get("result") if isinstance(receipt, dict) else None
    ending = result.get("ending_evidence") if isinstance(result, dict) else None
    refs = receipt.get("state_refs") if isinstance(receipt, dict) else None
    if (
        settled.get("schema_version") != 1
        or settled.get("ending_id") != ending_id
        or settled.get("investigator_id") != investigator_id
        or not isinstance(settled.get("settled_at"), str)
        or not isinstance(receipt, dict)
        or receipt.get("schema_version") != 1
        or receipt.get("status") != "PASS"
        or receipt.get("kind") != "development.settle"
        or not isinstance(receipt.get("operation_id"), str)
        or not isinstance(result, dict)
        or not isinstance(ending, dict)
        or ending.get("ending_id") != ending_id
        or not isinstance(refs, list)
        or f"save/investigator-state/{investigator_id}.json" not in refs
    ):
        return None
    return receipt


def _settled_receipt_for_ending(
    settlement_path: Path,
    ending_id: str,
    investigator_id: str,
) -> dict[str, Any] | None:
    if not settlement_path.is_file():
        return None
    return _settled_receipt_from_value(
        _read_object(settlement_path), ending_id, investigator_id
    )


def _conclusion_reward_receipt_path(
    campaign_dir: Path,
    investigator_id: str,
    ending: dict[str, Any],
) -> Path | None:
    reward_id = ending.get("conclusion_reward_id")
    if not isinstance(reward_id, str) or _SAFE_ID.fullmatch(reward_id) is None:
        return None
    return (
        campaign_dir
        / "save"
        / "development-settlements"
        / "conclusion-rewards"
        / investigator_id
        / f"{reward_id}.json"
    )


def _development_operation_body(
    *,
    campaign_dir: Path,
    investigator_id: str,
    payload: dict[str, Any],
    rng: random.Random,
    ending: dict[str, Any],
    settlement_path: Path,
) -> dict[str, Any]:
    if payload:
        raise RuntimeOperationError("development.settle payload must be empty")
    if settlement_path.is_file():
        settled = _read_object(settlement_path)
        if settled.get("ending_id") == ending["ending_id"]:
            receipt = settled.get("receipt")
            if isinstance(receipt, dict):
                return receipt
    inputs = ending.get("development_inputs")
    development_input = (
        inputs.get(investigator_id) if isinstance(inputs, dict) else None
    )
    result = coc_development.run_development_phase(
        campaign_dir,
        investigator_id,
        rng=rng,
        ending_evidence=ending,
        development_input=(
            development_input if isinstance(development_input, dict) else None
        ),
    )
    identity = hashlib.sha256(
        f"{ending['ending_id']}\0{investigator_id}".encode("utf-8")
    ).hexdigest()[:12]
    plan_digest = str(
        development_input["deterministic_plan"]["plan_sha256"]
    )[:12]
    operation_id = f"op-development-settle-{identity}-{plan_digest}"
    public_rows: list[dict[str, Any]] = []
    for index, check in enumerate(result.get("improvement_checks") or []):
        public_rows.append(_write_public_roll(
            campaign_dir,
            command_id=f"{operation_id}:check:{index}",
            actor_id=investigator_id,
            kind="development_check",
            skill=str(check["skill"]),
            roll=int(check["check_roll"]),
            die="1D100",
            die_rolls=[int(check["check_roll"])],
            target=int(check["value_before"]),
            difficulty="improvement",
            outcome="improved" if check.get("improved") else "no_improvement",
        ))
        if check.get("improved") and isinstance(check.get("gain"), int):
            public_rows.append(_write_public_roll(
                campaign_dir,
                command_id=f"{operation_id}:gain:{index}",
                actor_id=investigator_id,
                kind="development_gain",
                skill=str(check["skill"]),
                roll=int(check["gain"]),
                die="1D10",
                die_rolls=[int(check["gain"])],
                outcome="skill_increased",
            ))
    luck = result.get("luck_recovery") or {}
    if isinstance(luck.get("roll"), int):
        public_rows.append(_write_public_roll(
            campaign_dir,
            command_id=f"{operation_id}:luck-recovery",
            actor_id=investigator_id,
            kind="luck_recovery",
            skill="Luck",
            roll=int(luck["roll"]),
            die="1D100",
            die_rolls=[int(luck["roll"])],
            target=int(luck.get("luck_before", 0)),
            difficulty="improvement",
            outcome="recovered" if luck.get("success") else "no_recovery",
            extra={
                "luck_before": int(luck.get("luck_before", 0)),
                "luck_gained": int(luck.get("gained", 0)),
                "luck_after": int(luck.get("luck_after", 0)),
            },
        ))
    reward_expr = result.get("san_reward_expr")
    if isinstance(reward_expr, str) and reward_expr:
        frozen_reward = result.get("san_reward_roll")
        rolled = (
            json.loads(json.dumps(frozen_reward, ensure_ascii=False))
            if isinstance(frozen_reward, dict)
            else coc_roll.roll_expression(reward_expr, rng)
        )
        if rolled.get("expression") != reward_expr:
            raise RuntimeOperationError("frozen development SAN reward is invalid")
        sanity = _sanity_session_for_reward(
            campaign_dir, investigator_id, rng=rng
        )
        san_before = int(sanity.san_current)
        frozen_delta = result.get("san_reward_planned_delta")
        planned_delta = (
            int(frozen_delta)
            if isinstance(frozen_delta, int) and not isinstance(frozen_delta, bool)
            else int(rolled["total"])
        )
        sanity.gain_san(planned_delta, source="development")
        san_after = int(sanity.san_current)
        sanity.save(campaign_dir, strict_mirror=True)
        result["san_reward"] = {
            **rolled,
            "planned_san_before": (
                ((result.get("mechanical_baseline") or {}).get("sanity") or {}).get("current")
            ),
            "planned_san_delta": planned_delta,
            "san_before": san_before,
            "san_gained": san_after - san_before,
            "san_after": san_after,
            "san_max": int(sanity.san_max),
        }
        reward_roll_id = f"{operation_id}:san-reward"
        public_rows.append(_write_public_roll(
            campaign_dir,
            command_id=reward_roll_id,
            actor_id=investigator_id,
            kind="development_san_reward",
            skill="SAN Reward",
            roll=int(rolled["total"]),
            die=str(rolled["expression"]),
            die_rolls=[int(value) for value in rolled["rolls"]],
            outcome="sanity_reward",
            extra={
                "reward_kind": "sanity",
                "source": "development",
                "san_before": san_before,
                "planned_san_delta": planned_delta,
                "san_delta": san_after - san_before,
                "san_gained": san_after - san_before,
                "san_after": san_after,
                "san_max": int(sanity.san_max),
            },
        ))
        _write_sanity_reward_event(
            campaign_dir,
            actor_id=investigator_id,
            operation_id=operation_id,
            roll_id=reward_roll_id,
            source="development",
            san_before=san_before,
            san_after=san_after,
        )
    scenario_reward_expr = result.get("scenario_san_reward_expr")
    if isinstance(scenario_reward_expr, str) and scenario_reward_expr:
        reward_receipt_path = _conclusion_reward_receipt_path(
            campaign_dir, investigator_id, ending
        )
        prior_reward: dict[str, Any] | None = None
        if reward_receipt_path is not None and reward_receipt_path.is_file():
            candidate = _read_object(reward_receipt_path)
            if (
                candidate.get("investigator_id") != investigator_id
                or candidate.get("conclusion_reward_id")
                != ending.get("conclusion_reward_id")
                or candidate.get("conclusion_id") != ending.get("conclusion_id")
                or candidate.get("expression") != scenario_reward_expr
                or not isinstance(candidate.get("reward"), dict)
            ):
                raise RuntimeOperationError(
                    "conclusion reward receipt identity is invalid"
                )
            prior_reward = candidate
        if prior_reward is not None:
            result["scenario_san_reward"] = {
                **prior_reward["reward"],
                "replayed": True,
            }
            result["scenario_san_reward_applied"] = False
            result["scenario_san_reward_receipt"] = {
                "conclusion_reward_id": prior_reward["conclusion_reward_id"],
                "original_ending_id": prior_reward["ending_id"],
                "roll_id": prior_reward["roll_id"],
            }
        else:
            if reward_receipt_path is None:
                raise RuntimeOperationError(
                    "scenario conclusion reward lacks a durable identity"
                )
            frozen_reward = result.get("scenario_san_reward_roll")
            rolled = (
                json.loads(json.dumps(frozen_reward, ensure_ascii=False))
                if isinstance(frozen_reward, dict)
                else coc_roll.roll_expression(scenario_reward_expr, rng)
            )
            if rolled.get("expression") != scenario_reward_expr:
                raise RuntimeOperationError("frozen scenario SAN reward is invalid")
            sanity = _sanity_session_for_reward(
                campaign_dir, investigator_id, rng=rng
            )
            san_before = int(sanity.san_current)
            frozen_delta = result.get("scenario_san_reward_planned_delta")
            planned_delta = (
                int(frozen_delta)
                if isinstance(frozen_delta, int)
                and not isinstance(frozen_delta, bool)
                else int(rolled["total"])
            )
            sanity.gain_san(planned_delta, source="scenario_conclusion")
            san_after = int(sanity.san_current)
            sanity.save(campaign_dir, strict_mirror=True)
            baseline_sanity = (
                (result.get("mechanical_baseline") or {}).get("sanity") or {}
            )
            planned_san_before = baseline_sanity.get("current")
            baseline_max = baseline_sanity.get("max")
            development_planned_delta = result.get("san_reward_planned_delta")
            if (
                isinstance(planned_san_before, int)
                and not isinstance(planned_san_before, bool)
                and isinstance(baseline_max, int)
                and not isinstance(baseline_max, bool)
                and isinstance(development_planned_delta, int)
                and not isinstance(development_planned_delta, bool)
            ):
                planned_san_before = min(
                    baseline_max,
                    planned_san_before + max(0, development_planned_delta),
                )
            reward_result = {
                **rolled,
                "planned_san_before": planned_san_before,
                "planned_san_delta": planned_delta,
                "san_before": san_before,
                "san_gained": san_after - san_before,
                "san_after": san_after,
                "san_max": int(sanity.san_max),
            }
            result["scenario_san_reward"] = reward_result
            result["scenario_san_reward_applied"] = True
            scenario_reward_roll_id = f"{operation_id}:scenario-san-reward"
            public_rows.append(_write_public_roll(
                campaign_dir,
                command_id=scenario_reward_roll_id,
                actor_id=investigator_id,
                kind="scenario_san_reward",
                skill="SAN Reward",
                roll=int(rolled["total"]),
                die=str(rolled["expression"]),
                die_rolls=[int(value) for value in rolled["rolls"]],
                outcome="sanity_reward",
                extra={
                    "reward_kind": "sanity",
                    "source": "conclusion_rewards",
                    "conclusion_id": ending.get("conclusion_id"),
                    "conclusion_reward_id": ending.get("conclusion_reward_id"),
                    "rule_ref": ending.get("scenario_san_reward_rule_ref"),
                    "san_before": san_before,
                    "planned_san_delta": planned_delta,
                    "san_delta": san_after - san_before,
                    "san_gained": san_after - san_before,
                    "san_after": san_after,
                    "san_max": int(sanity.san_max),
                },
            ))
            _write_sanity_reward_event(
                campaign_dir,
                actor_id=investigator_id,
                operation_id=operation_id,
                roll_id=scenario_reward_roll_id,
                source="conclusion_rewards",
                san_before=san_before,
                san_after=san_after,
                rule_ref=ending.get("scenario_san_reward_rule_ref"),
                conclusion_id=ending.get("conclusion_id"),
            )
            reward_receipt = {
                "schema_version": 1,
                "conclusion_reward_id": ending["conclusion_reward_id"],
                "scenario_id": ending.get("scenario_id"),
                "conclusion_id": ending.get("conclusion_id"),
                "investigator_id": investigator_id,
                "ending_id": ending["ending_id"],
                "conclusion_evidence": ending.get("conclusion_evidence"),
                "expression": scenario_reward_expr,
                "roll_id": scenario_reward_roll_id,
                "reward": reward_result,
                "applied_at": _now(),
            }
            reward_receipt_path.parent.mkdir(parents=True, exist_ok=True)
            coc_fileio.write_json_atomic(
                reward_receipt_path,
                reward_receipt,
                indent=2,
                ensure_ascii=False,
                trailing_newline=True,
            )
            result["scenario_san_reward_receipt"] = {
                "conclusion_reward_id": ending["conclusion_reward_id"],
                "original_ending_id": ending["ending_id"],
                "roll_id": scenario_reward_roll_id,
            }
    player_facing = _compose_development_player_facing(
        investigator_id=investigator_id,
        operation_id=operation_id,
        result=result,
        public_rows=public_rows,
    )
    if not player_facing["complete"]:
        raise RuntimeOperationError(
            "development public checks missing from final player output: "
            + ", ".join(player_facing["missing_roll_ids"])
        )
    result["player_facing_mechanics"] = player_facing
    _append_jsonl(campaign_dir / "logs" / "events.jsonl", {
        "type": "development",
        "actor": investigator_id,
        "operation_id": operation_id,
        "payload": result,
        "ts": _now(),
    })
    receipt = {
        "schema_version": 1,
        "status": "PASS",
        "kind": "development.settle",
        "operation_id": operation_id,
        "result": result,
        "player_facing_mechanics": player_facing,
        "state_refs": [
            f"save/investigator-state/{investigator_id}.json",
            (
                "save/development-settlements/endings/"
                f"{ending['ending_id']}/{investigator_id}.json"
            ),
            f"../../investigators/{investigator_id}/character.json",
            "logs/events.jsonl",
            "logs/rolls.jsonl",
        ],
    }
    if coc_sanity.sanity_snapshot_path(campaign_dir, investigator_id).is_file():
        receipt["state_refs"].append(
            f"save/sanity-state/{investigator_id}.json"
        )
    reward_receipt_path = _conclusion_reward_receipt_path(
        campaign_dir, investigator_id, ending
    )
    if reward_receipt_path is not None and reward_receipt_path.is_file():
        receipt["state_refs"].append(
            reward_receipt_path.relative_to(campaign_dir).as_posix()
        )
    settlement_path.parent.mkdir(parents=True, exist_ok=True)
    coc_fileio.write_json_atomic(
        settlement_path,
        {
            "schema_version": 1,
            "ending_id": ending["ending_id"],
            "investigator_id": investigator_id,
            "settled_at": _now(),
            "receipt": receipt,
        },
        indent=2,
        ensure_ascii=False,
        trailing_newline=True,
    )
    return receipt


def _development_operation_locked(
    *,
    campaign_dir: Path,
    investigator_id: str,
    payload: dict[str, Any],
    rng: random.Random,
    ending_id: str | None = None,
) -> dict[str, Any]:
    """Run one crash-recoverable development transaction.

    The completed settlement receipt is the commit marker.  Canonical changes
    are first computed in an isolated mirror; the durable journal then records
    exact pre/post images and append-only suffixes before any canonical write.
    Restart recovery touches state only when every current target is provably
    transaction-owned.  Foreign divergence remains intact and produces a typed
    recovery conflict.
    """
    if payload:
        raise RuntimeOperationError("development.settle payload must be empty")
    ending = coc_development.structured_ending_evidence(
        campaign_dir, ending_id=ending_id
    )
    if ending is None:
        raise RuntimeOperationError(
            "development.settle requires a persisted state.end_session receipt"
        )
    frozen_ids = ending.get("investigator_ids")
    if isinstance(frozen_ids, list) and investigator_id not in frozen_ids:
        raise DevelopmentTargetConflict(investigator_id, frozen_ids)
    exact_ending_id = str(ending["ending_id"])
    settlement_path = coc_development.ending_settlement_path(
        campaign_dir, exact_ending_id, investigator_id
    )
    inflight_path = settlement_path.with_name(f"{investigator_id}.inflight.json")
    coc_root = campaign_dir.parents[1]
    unsafe_paths = [
        _journal_display_path(campaign_dir, path)
        for path in (settlement_path, inflight_path)
        if not _target_kind_is_safe(coc_root, path)
    ]
    if unsafe_paths:
        raise DevelopmentRecoveryConflict(
            _development_transaction_id(exact_ending_id, investigator_id),
            sorted(set(unsafe_paths)),
        )
    unsupported_base_receipt = (
        campaign_dir / "save" / "development-settlements"
        / f"{investigator_id}.json"
    )
    if unsupported_base_receipt.exists() or unsupported_base_receipt.is_symlink():
        raise RuntimeOperationError(
            "unsupported base-layout development settlement receipt"
        )

    journal: dict[str, Any] | None = None
    if inflight_path.is_file():
        journal = _read_object(inflight_path)
        if journal.get("status") != "recovered":
            _recover_development_inflight(
                campaign_dir=campaign_dir,
                investigator_id=investigator_id,
                settlement_path=settlement_path,
                inflight_path=inflight_path,
                journal=journal,
            )
            journal = _read_object(inflight_path) if inflight_path.is_file() else None
        if journal is not None and journal.get("status") == "recovered":
            if journal.get("ending_id") == exact_ending_id:
                try:
                    rng.setstate(_random_state_from_json(journal.get("rng_state")))
                except (TypeError, ValueError) as exc:
                    raise RuntimeOperationError(
                        "development settlement journal RNG state is invalid"
                    ) from exc
            else:
                raise DevelopmentRecoveryConflict(
                    str(journal.get("transaction_id") or "unknown-development-txn"),
                    [_journal_display_path(campaign_dir, inflight_path)],
                )

    receipt = _settled_receipt_for_ending(
        settlement_path, exact_ending_id, investigator_id
    )
    if receipt is not None:
        _release_development_active_marker(
            campaign_dir=campaign_dir,
            investigator_id=investigator_id,
            transaction_id=_development_transaction_id(
                exact_ending_id, investigator_id
            ),
        )
        inflight_path.unlink(missing_ok=True)
        return receipt
    if settlement_path.is_file():
        raise RuntimeOperationError(
            "existing exact development settlement receipt is invalid"
        )

    journal = _capture_development_inflight(
        campaign_dir=campaign_dir,
        investigator_id=investigator_id,
        ending_id=exact_ending_id,
        settlement_path=settlement_path,
        inflight_path=inflight_path,
        ending=ending,
        rng=rng,
    )

    try:
        receipt, file_postimages, log_postimages = _plan_development_postimages(
            campaign_dir=campaign_dir,
            investigator_id=investigator_id,
            payload=payload,
            rng=rng,
            settlement_path=settlement_path,
            ending=ending,
        )
        journal["status"] = "prepared"
        journal["file_postimages"] = file_postimages
        journal["log_postimages"] = log_postimages
        journal["planned_at"] = _now()
        _write_development_journal(inflight_path, journal)
        # Apply only the exact durable journal image that restart recovery
        # would observe; this catches torn/corrupted per-image data before any
        # canonical target changes.
        journal = _read_object(inflight_path)
        marker = _mark_development_journal_durable(
            campaign_dir=campaign_dir,
            investigator_id=investigator_id,
            inflight_path=inflight_path,
            transaction_id=str(journal["transaction_id"]),
        )
        _assert_development_preapply_cas(
            campaign_dir=campaign_dir,
            investigator_id=investigator_id,
            settlement_path=settlement_path,
            ending=ending,
            journal=journal,
        )
        _apply_development_postimages(
            campaign_dir=campaign_dir,
            investigator_id=investigator_id,
            settlement_path=settlement_path,
            ending=ending,
            journal=journal,
        )
        _transition_development_active_marker(
            campaign_dir=campaign_dir,
            investigator_id=investigator_id,
            inflight_path=inflight_path,
            transaction_id=str(journal["transaction_id"]),
            expected_phases={"journaled"},
            phase="committed",
            journal_sha256=_development_journal_sha256(inflight_path),
            transition_at=_now(),
        )
    except Exception:
        if inflight_path.is_file():
            current_journal = _read_object(inflight_path)
            _recover_development_inflight(
                campaign_dir=campaign_dir,
                investigator_id=investigator_id,
                settlement_path=settlement_path,
                inflight_path=inflight_path,
                journal=current_journal,
            )
            inflight_path.unlink(missing_ok=True)
        raise
    _release_development_active_marker(
        campaign_dir=campaign_dir,
        investigator_id=investigator_id,
        transaction_id=_development_transaction_id(
            exact_ending_id, investigator_id
        ),
        expected_phases={"committed"},
    )
    inflight_path.unlink(missing_ok=True)
    return receipt


def _development_operation(
    *,
    campaign_dir: Path,
    investigator_id: str,
    payload: dict[str, Any],
    rng: random.Random,
    ending_id: str | None = None,
) -> dict[str, Any]:
    """Serialize shared investigator files after the caller's campaign lock."""
    with coc_fileio.advisory_file_lock(
        _development_investigator_lock_path(campaign_dir, investigator_id),
        wait_seconds=5.0,
    ):
        return _development_operation_locked(
            campaign_dir=campaign_dir,
            investigator_id=investigator_id,
            payload=payload,
            rng=rng,
            ending_id=ending_id,
        )


def settle_development(
    campaign_dir: Path | str,
    investigator_id: str,
    *,
    rng: random.Random | None = None,
    ending_id: str | None = None,
) -> dict[str, Any]:
    """Shared settlement entry for an already campaign-locked host/tool.

    Top-level hosts should continue to use :func:`execute_operation`, which
    acquires the campaign lock.  The canonical toolbox already owns that lock,
    so its post-ending finalizer calls this narrow entry; this helper then
    acquires only the shared investigator lock in the fixed second position.
    """
    return _development_operation(
        campaign_dir=Path(campaign_dir),
        investigator_id=_id(investigator_id, "investigator_id"),
        payload={},
        rng=rng or random.Random(),
        ending_id=ending_id,
    )


def _campaign_summaries(workspace: Path) -> list[dict[str, Any]]:
    campaigns = workspace / ".coc" / "campaigns"
    if not campaigns.is_dir():
        return []
    values: list[dict[str, Any]] = []
    for child in sorted(campaigns.iterdir(), key=lambda item: item.name):
        path = child / "campaign.json"
        if child.is_symlink() or not child.is_dir() or not path.is_file():
            continue
        try:
            campaign = _read_object(path)
        except RuntimeOperationError:
            continue
        values.append({
            "campaign_id": str(campaign.get("campaign_id") or child.name),
            "title": campaign.get("title"),
            "status": campaign.get("status"),
            "era": campaign.get("era"),
            "play_language": campaign.get("play_language"),
            "active_scenario_id": campaign.get("active_scenario_id"),
        })
    return values


def execute_setup_operation(
    workspace: Path | str,
    *,
    operation: dict[str, Any],
) -> dict[str, Any]:
    """Execute one canonical pre-session onboarding operation."""
    root = Path(workspace).expanduser().resolve()
    root.mkdir(parents=True, exist_ok=True)
    kind, payload = _setup_operation(operation)
    if kind == "onboarding.inspect":
        if payload:
            raise RuntimeOperationError("onboarding.inspect payload must be empty")
        starters = coc_starter.list_starter_scenarios()
        return {
            "schema_version": 1,
            "status": "PASS",
            "kind": kind,
            "result": {
                "workspace_ready": (root / ".coc").is_dir(),
                "campaigns": _campaign_summaries(root),
                "investigators": coc_state.list_investigators(root),
                "starters": [
                    {
                        **starter,
                        "pregens": [
                            {
                                key: value for key, value in pregen.items()
                                if key != "character_path"
                            }
                            for pregen in coc_starter.list_pregens(starter["scenario_id"])
                        ],
                    }
                    for starter in starters
                ],
                "characteristic_generation_methods": (
                    coc_character.characteristic_generation_methods()
                ),
                "rule_helper_api": coc_api.api_index(),
                "session_operation_kinds": sorted(SESSION_OPERATION_KINDS),
                "setup_operation_kinds": sorted(SETUP_OPERATION_KINDS),
            },
        }
    if kind == "rules.inspect":
        if payload:
            raise RuntimeOperationError("rules.inspect payload must be empty")
        return {
            "schema_version": 1,
            "status": "PASS",
            "kind": kind,
            "result": {"helpers": coc_api.api_index()},
        }
    if kind == "campaign.quick_start":
        allowed = {"scenario_id", "pregen_id", "campaign_id", "title"}
        if set(payload) - allowed or not {"scenario_id", "pregen_id"} <= set(payload):
            raise RuntimeOperationError("campaign.quick_start has unsupported or missing fields")
        result = coc_starter.quick_start(
            root,
            _id(payload.get("scenario_id"), "scenario_id"),
            _id(payload.get("pregen_id"), "pregen_id"),
            campaign_id=(
                _id(payload["campaign_id"], "campaign_id")
                if payload.get("campaign_id") is not None else None
            ),
            title=(str(payload["title"]) if payload.get("title") else None),
        )
        return {
            "schema_version": 1,
            "status": "PASS",
            "kind": kind,
            "result": result,
            "state_refs": [
                f".coc/campaigns/{result['campaign_id']}",
                f".coc/investigators/{result['investigator_id']}/character.json",
            ],
        }
    if kind == "campaign.create":
        allowed = {
            "campaign_id", "title", "era", "play_language", "start_clock",
            "ruleset_id",
        }
        if set(payload) - allowed or not {"campaign_id", "title"} <= set(payload):
            raise RuntimeOperationError("campaign.create has unsupported or missing fields")
        campaign_id = _id(payload.get("campaign_id"), "campaign_id")
        title = payload.get("title")
        if not isinstance(title, str) or not title.strip():
            raise RuntimeOperationError("campaign.create title must be non-empty")
        path = root / ".coc" / "campaigns" / campaign_id / "campaign.json"
        if path.exists():
            raise FileExistsError(f"campaign already exists: {campaign_id}")
        ruleset_id = payload.get("ruleset_id")
        if ruleset_id is not None and (
            not isinstance(ruleset_id, str) or not ruleset_id.strip()
        ):
            raise RuntimeOperationError(
                "campaign.create ruleset_id must be a non-empty string"
            )
        try:
            created = coc_state.create_campaign(
                root,
                campaign_id,
                title.strip(),
                era=str(payload.get("era") or "1920s"),
                play_language=str(payload.get("play_language") or "zh-Hans"),
                start_clock=payload.get("start_clock"),
                ruleset_id=(
                    ruleset_id.strip()
                    if isinstance(ruleset_id, str)
                    else coc_state.coc_rulesets.DEFAULT_RULESET_ID
                ),
            )
        except ValueError as exc:
            raise RuntimeOperationError(str(exc)) from exc
        return {
            "schema_version": 1,
            "status": "PASS",
            "kind": kind,
            "result": {
                "campaign_id": campaign_id,
                "ruleset_id": (
                    ruleset_id.strip()
                    if isinstance(ruleset_id, str)
                    else coc_state.coc_rulesets.DEFAULT_RULESET_ID
                ),
            },
            "state_refs": [str(created.relative_to(root))],
        }
    if kind == "actor.create":
        if set(payload) != {"campaign_id", "actor_id", "sheet"}:
            raise RuntimeOperationError(
                "actor.create requires exactly campaign_id, actor_id, and sheet"
            )
        campaign_id = _id(payload.get("campaign_id"), "campaign_id")
        actor_id = _id(payload.get("actor_id"), "actor_id")
        sheet = payload.get("sheet")
        if not isinstance(sheet, dict):
            raise RuntimeOperationError("actor.create sheet must be an object")
        campaign_dir = root / ".coc" / "campaigns" / campaign_id
        if not campaign_dir.is_dir():
            raise FileNotFoundError(f"unknown campaign: {campaign_id}")
        campaign = coc_state.load_campaign_state(campaign_dir)
        ruleset_id = coc_state.coc_rulesets.get_campaign_ruleset_id(campaign)
        resolver = coc_state.coc_rulesets.get_resolver(campaign)
        try:
            advertised = resolver.public_api_index()
        except Exception as exc:
            raise RuntimeOperationError(
                "active ruleset public_api_index failed"
            ) from exc
        if (
            not isinstance(advertised, dict)
            or "validate_actor" not in advertised
            or not callable(getattr(resolver, "validate_actor", None))
        ):
            raise RuntimeOperationError(
                f"ruleset {ruleset_id!r} does not support actor.create"
            )
        try:
            normalized = resolver.validate_actor(deepcopy(sheet))
        except (TypeError, ValueError) as exc:
            raise RuntimeOperationError(str(exc)) from exc
        if (
            not isinstance(normalized, dict)
            or set(normalized) != {"sheet", "resources"}
            or not isinstance(normalized.get("sheet"), dict)
            or not isinstance(normalized.get("resources"), dict)
        ):
            raise RuntimeOperationError(
                "ruleset validate_actor must return exactly sheet and resources objects"
            )
        created = coc_state.create_ruleset_actor(
            campaign_dir,
            actor_id,
            sheet=deepcopy(normalized["sheet"]),
            resources=deepcopy(normalized["resources"]),
        )
        return {
            "schema_version": 1,
            "status": "PASS",
            "kind": kind,
            "result": {
                "campaign_id": campaign_id,
                "actor_id": actor_id,
                "ruleset_id": ruleset_id,
            },
            "state_refs": [str(created.relative_to(root))],
        }
    if kind == "investigator.create":
        allowed = {"investigator_id", "sheet", "creation"}
        if set(payload) - allowed or not {"investigator_id", "sheet"} <= set(payload):
            raise RuntimeOperationError("investigator.create has unsupported or missing fields")
        investigator_id = _id(payload.get("investigator_id"), "investigator_id")
        sheet = payload.get("sheet")
        creation = payload.get("creation")
        if not isinstance(sheet, dict) or (
            creation is not None and not isinstance(creation, dict)
        ):
            raise RuntimeOperationError("investigator.create requires object sheet/creation")
        try:
            sheet = coc_character.materialize_quick_fire_create_sheet(
                sheet, creation,
            )
        except ValueError as exc:
            raise RuntimeOperationError(
                "invalid investigator sheet: " + str(exc)
            ) from exc
        errors = coc_character.validate_character_create_sheet(sheet, creation)
        if errors:
            raise RuntimeOperationError("invalid investigator sheet: " + "; ".join(errors))
        if str(sheet.get("id")) != investigator_id:
            raise RuntimeOperationError("investigator sheet id must match investigator_id")
        path = root / ".coc" / "investigators" / investigator_id / "character.json"
        try:
            with coc_investigator_guard.guard_reusable_investigators(
                root / ".coc", [investigator_id]
            ):
                pass
        except coc_investigator_guard.ReusableInvestigatorRecoveryConflict as exc:
            raise DevelopmentRecoveryConflict(
                exc.transaction_id,
                [_journal_display_path(
                    root / ".coc" / "campaigns" / "setup", exc.marker_path
                )],
            ) from exc
        if path.exists():
            raise FileExistsError(f"investigator already exists: {investigator_id}")
        created = coc_state.create_investigator(
            root, investigator_id, sheet, creation=creation
        )
        return {
            "schema_version": 1,
            "status": "PASS",
            "kind": kind,
            "result": {"investigator_id": investigator_id},
            "state_refs": [str(created.relative_to(root))],
        }
    if kind == "investigator.render_card":
        allowed = {"campaign_id", "investigator_id", "language", "html_mode"}
        required = {"campaign_id", "investigator_id"}
        if set(payload) - allowed or not required <= set(payload):
            raise RuntimeOperationError(
                "investigator.render_card has unsupported or missing fields"
            )
        campaign_id = _id(payload.get("campaign_id"), "campaign_id")
        investigator_id = _id(payload.get("investigator_id"), "investigator_id")
        html_mode = payload.get("html_mode", "never")
        if html_mode not in {"never", "auto", "always"}:
            raise RuntimeOperationError(
                "investigator.render_card html_mode must be never|auto|always"
            )
        campaign_dir = root / ".coc" / "campaigns" / campaign_id
        campaign_path = campaign_dir / "campaign.json"
        character_path = (
            root / ".coc" / "investigators" / investigator_id / "character.json"
        )
        if not campaign_path.is_file():
            raise FileNotFoundError(f"unknown campaign: {campaign_id}")
        if not character_path.is_file():
            raise FileNotFoundError(f"unknown investigator: {investigator_id}")
        campaign = _read_object(campaign_path)
        language = str(
            payload.get("language") or campaign.get("play_language") or "zh-Hans"
        )
        try:
            with coc_investigator_guard.guard_reusable_investigators(
                root / ".coc", [investigator_id]
            ):
                character_snapshot = _read_object(character_path)
                rendered = coc_character_card.render_cards(
                    character_path,
                    campaign_path,
                    campaign_dir / "assets" / "character-cards" / investigator_id,
                    repo_root=root,
                    language=language,
                    html_mode=str(html_mode),
                    write_back=False,
                    character_snapshot=character_snapshot,
                )
        except coc_investigator_guard.ReusableInvestigatorRecoveryConflict as exc:
            raise DevelopmentRecoveryConflict(
                exc.transaction_id,
                [_journal_display_path(campaign_dir, exc.marker_path)],
            ) from exc
        refs = [rendered["markdown_path"]]
        if isinstance(rendered.get("html_path"), str):
            refs.append(rendered["html_path"])
        return {
            "schema_version": 1,
            "status": "PASS",
            "kind": kind,
            "result": {
                "campaign_id": campaign_id,
                "investigator_id": investigator_id,
                **rendered,
            },
            "state_refs": refs,
        }
    if kind == "campaign.link_investigator":
        if set(payload) != {"campaign_id", "investigator_ids"}:
            raise RuntimeOperationError(
                "campaign.link_investigator requires campaign_id and investigator_ids"
            )
        campaign_id = _id(payload.get("campaign_id"), "campaign_id")
        raw_ids = payload.get("investigator_ids")
        if not isinstance(raw_ids, list) or not raw_ids:
            raise RuntimeOperationError("investigator_ids must be a non-empty list")
        investigator_ids = [_id(value, "investigator_id") for value in raw_ids]
        if len(investigator_ids) != len(set(investigator_ids)):
            raise RuntimeOperationError("investigator_ids must be unique")
        path = coc_state.link_party(root, campaign_id, investigator_ids)
        return {
            "schema_version": 1,
            "status": "PASS",
            "kind": kind,
            "result": {
                "campaign_id": campaign_id,
                "investigator_ids": investigator_ids,
            },
            "state_refs": [str(path.relative_to(root))],
        }

    if kind == "campaign.render_briefing":
        if set(payload) - {"campaign_id", "language"} or "campaign_id" not in payload:
            raise RuntimeOperationError(
                "campaign.render_briefing requires campaign_id and optional language"
            )
        campaign_id = _id(payload.get("campaign_id"), "campaign_id")
        campaign_dir = root / ".coc" / "campaigns" / campaign_id
        if not (campaign_dir / "campaign.json").is_file():
            raise FileNotFoundError(f"unknown campaign: {campaign_id}")
        rendered = coc_character_creation_briefing.render_briefing_from_campaign(
            campaign_dir,
            repo_root=root,
            language=(str(payload["language"]) if payload.get("language") else None),
            write_back=True,
        )
        return {
            "schema_version": 1,
            "status": "PASS",
            "kind": kind,
            "result": {"campaign_id": campaign_id, **rendered},
            "state_refs": [
                f".coc/campaigns/{campaign_id}/campaign.json",
                rendered["briefing_path"],
            ],
        }

    allowed = {"campaign_id", "scenario_id", "title", "source_bundle_path", "compile_now"}
    required = {"campaign_id", "scenario_id", "title", "source_bundle_path"}
    unsupported = sorted(set(payload) - allowed)
    missing = sorted(required - set(payload))
    if unsupported or missing:
        details = []
        if missing:
            details.append("missing: " + ", ".join(missing))
        if unsupported:
            details.append("unsupported: " + ", ".join(unsupported))
        details.append("allowed: " + ", ".join(sorted(allowed)))
        raise RuntimeOperationError(
            "scenario.bind_pdf payload fields invalid (" + "; ".join(details) + ")"
        )
    campaign_id = _id(payload.get("campaign_id"), "campaign_id")
    scenario_id = _id(payload.get("scenario_id"), "scenario_id")
    title = payload.get("title")
    if not isinstance(title, str) or not title.strip():
        raise RuntimeOperationError("scenario.bind_pdf title must be non-empty")
    source_bundle_path = Path(str(payload.get("source_bundle_path") or "")).expanduser().resolve()
    try:
        host_bundle = coc_pdf_bundle.load_host_bundle(source_bundle_path)
    except coc_pdf_bundle.PdfSourceBundleError as exc:
        raise RuntimeOperationError(
            f"scenario.bind_pdf requires a valid Codex pdf-skill source bundle: {exc}"
        ) from exc
    campaign_dir = root / ".coc" / "campaigns" / campaign_id
    if not campaign_dir.is_dir():
        raise FileNotFoundError(f"unknown campaign: {campaign_id}")
    # Explicit cold compilation must fail before the progressive source cache,
    # scenario skeleton, or campaign metadata is mutated.
    if (
        payload.get("compile_now") is True
        and not coc_scenario_hydration.COMPILER_ADAPTER_PATH.is_file()
    ):
        raise RuntimeOperationError(
            "scenario.bind_pdf compile_now=true requires the cold scenario "
            "compiler runtime; omit compile_now or pass false for progressive "
            "source-bundle binding"
        )
    source_cache = coc_module_assets.register_source_bundle(
        root,
        host_bundle,
        asset_root_id=scenario_id,
        module_identity={
            "canonical_module_id": scenario_id,
            "canonical_title": title.strip(),
        },
    )
    source = {
        **host_bundle["source"],
        "source_bundle_path": str(source_bundle_path),
    }
    coc_scenario.create_scenario_skeleton(
        campaign_dir, scenario_id, title.strip(), source
    )
    scenario_path = campaign_dir / "scenario" / "scenario.json"
    scenario = _read_object(scenario_path)
    scenario["resolution_policy"] = "source_first"
    # This locator only means the verified pages are reusable.  Cold compile
    # remains valid; the progressive play marker is stamped later by the
    # explicit skeleton projection path.
    scenario["source_cache_asset_root_id"] = source_cache["asset_root_id"]
    coc_fileio.write_json_atomic(
        scenario_path, scenario, indent=2, ensure_ascii=False,
        trailing_newline=True,
    )
    campaign_path = campaign_dir / "campaign.json"
    campaign = _read_object(campaign_path)
    campaign["active_scenario_id"] = scenario_id
    campaign["status"] = "setup"
    campaign["active_subsystem"] = "setup"
    campaign["updated_at"] = _now()
    coc_fileio.write_json_atomic(
        campaign_path, campaign, indent=2, ensure_ascii=False,
        trailing_newline=True,
    )
    hydration: dict[str, Any] | None = None
    if payload.get("compile_now") is True:
        try:
            hydration = coc_scenario_hydration.ensure_scenario_ready(campaign_dir)
        except coc_scenario_hydration.ScenarioHydrationError as exc:
            raise RuntimeOperationError(
                f"scenario.bind_pdf cold compilation failed: {exc}"
            ) from exc
        if hydration.get("status") == "PASS":
            campaign = _read_object(campaign_path)
            campaign["status"] = "active"
            campaign["active_subsystem"] = "play"
            campaign["updated_at"] = _now()
            coc_fileio.write_json_atomic(
                campaign_path, campaign, indent=2, ensure_ascii=False,
                trailing_newline=True,
            )
    briefing = coc_character_creation_briefing.render_briefing_from_campaign(
        campaign_dir,
        repo_root=root,
        write_back=True,
    )
    return {
        "schema_version": 1,
        "status": hydration.get("status", "PASS") if hydration else "PASS",
        "kind": kind,
        "result": {
            "campaign_id": campaign_id,
            "scenario_id": scenario_id,
            "source": {
                key: value for key, value in source.items() if key != "path"
            },
            "source_cache": source_cache,
            "compile": hydration,
            "character_creation_briefing": briefing,
        },
        "state_refs": [
            f".coc/campaigns/{campaign_id}/campaign.json",
            f".coc/campaigns/{campaign_id}/scenario/scenario.json",
            f".coc/campaigns/{campaign_id}/index/source-map.json",
            briefing["briefing_path"],
        ],
    }


def execute_operation(
    workspace: Path | str,
    *,
    campaign_id: str,
    investigator_id: str,
    character_path: Path | str,
    operation: dict[str, Any],
    rng_seed: int | str | None = None,
) -> dict[str, Any]:
    """Execute one exact typed operation through the shared host boundary."""
    root = Path(workspace).resolve()
    campaign = _id(campaign_id, "campaign_id")
    investigator = _id(investigator_id, "investigator_id")
    campaign_dir = root / ".coc" / "campaigns" / campaign
    if not campaign_dir.is_dir():
        raise FileNotFoundError(f"unknown campaign: {campaign}")
    character = Path(character_path).resolve()
    try:
        character.relative_to((root / ".coc").resolve())
    except ValueError as exc:
        raise RuntimeOperationError("character_path must remain inside workspace .coc") from exc
    kind, payload = _operation(operation)
    rng = random.Random(rng_seed)
    with coc_fileio.campaign_lock(campaign_dir):
        # Recover an interrupted development transaction before this operation
        # observes or mutates campaign state.  A foreign delta raises a typed,
        # non-destructive integrity conflict.
        recover_development_transactions(campaign_dir)
        if kind == "scenario.ensure":
            if payload:
                raise RuntimeOperationError("scenario.ensure payload must be empty")
            receipt = coc_scenario_hydration.ensure_scenario_ready(campaign_dir)
            return {"schema_version": 1, "status": receipt["status"], "kind": kind, "result": receipt}
        if kind == "scenario.repair":
            request = payload.get("source_resolution_request")
            if set(payload) != {"source_resolution_request"} or not isinstance(request, dict):
                raise RuntimeOperationError(
                    "scenario.repair requires source_resolution_request"
                )
            receipt = coc_scenario_hydration.ensure_scenario_ready(
                campaign_dir,
                force_recompile=True,
                resolution_request=request,
            )
            return {"schema_version": 1, "status": receipt["status"], "kind": kind, "result": receipt}
        if kind in {"magic.cast", "magic.learn"}:
            return _magic_operation(
                workspace=root,
                campaign_dir=campaign_dir,
                campaign_id=campaign,
                investigator_id=investigator,
                character_path=character,
                kind=kind,
                payload=payload,
                rng=rng,
            )
        if kind == "tome.read":
            return _tome_operation(
                workspace=root,
                campaign_dir=campaign_dir,
                campaign_id=campaign,
                investigator_id=investigator,
                character_path=character,
                payload=payload,
                rng=rng,
            )
        if kind.startswith("hazard."):
            return _hazard_operation(
                workspace=root,
                campaign_dir=campaign_dir,
                campaign_id=campaign,
                investigator_id=investigator,
                character_path=character,
                kind=kind,
                payload=payload,
                rng=rng,
            )
        if kind == "development.settle":
            return _development_operation(
                campaign_dir=campaign_dir,
                investigator_id=investigator,
                payload=payload,
                rng=rng,
            )
        if set(payload) != {"target_module_id", "terminal_evidence"}:
            raise RuntimeOperationError(
                "chapter.switch requires target_module_id and terminal_evidence"
            )
        result = coc_chapter_switch.switch_chapter(
            root,
            campaign,
            _id(payload.get("target_module_id"), "target_module_id"),
            payload.get("terminal_evidence"),
        )
        return {"schema_version": 1, "status": "PASS", "kind": kind, "result": result}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run one canonical COC runtime operation.")
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--setup", action="store_true", help="run a pre-session setup operation")
    parser.add_argument("--campaign")
    parser.add_argument("--investigator")
    parser.add_argument("--character")
    parser.add_argument("--operation-json", help="Exact operation JSON; defaults to stdin")
    parser.add_argument("--rng-seed")
    args = parser.parse_args(argv)
    raw = args.operation_json if args.operation_json is not None else input()
    if args.setup:
        result = execute_setup_operation(
            args.workspace, operation=json.loads(raw)
        )
    else:
        if not args.campaign or not args.investigator or not args.character:
            parser.error("session operations require --campaign, --investigator, and --character")
        result = execute_operation(
            args.workspace,
            campaign_id=args.campaign,
            investigator_id=args.investigator,
            character_path=args.character,
            operation=json.loads(raw),
            rng_seed=args.rng_seed,
        )
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result.get("status") == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
