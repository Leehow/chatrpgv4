#!/usr/bin/env python3
"""Canonical non-turn operations shared by plugin hosts and the Pi runtime.

Normal player input still enters through ``coc_live_turn_runner.run_live_turn``.
This module owns typed operations that are not ordinary player prose so Codex,
Cursor, Claude Code, and ``runtime.sdk`` cannot grow host-specific behavior.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
import random
import re
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
coc_hazards = _load_sibling("coc_hazards_runtime_ops", "coc_hazards.py")
coc_magic = _load_sibling("coc_magic_runtime_ops", "coc_magic.py")
coc_mythos = _load_sibling("coc_mythos_runtime_ops", "coc_mythos.py")
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


SESSION_OPERATION_KINDS = frozenset({
    "scenario.ensure", "scenario.repair", "magic.cast", "magic.learn",
    "chapter.switch", "tome.read", "hazard.apply", "hazard.suffocation.start",
    "hazard.suffocation.tick", "hazard.suffocation.end", "hazard.poison",
    "development.settle",
})
SETUP_OPERATION_KINDS = frozenset({
    "onboarding.inspect", "rules.inspect", "campaign.create",
    "campaign.quick_start", "scenario.bind_pdf", "campaign.render_briefing",
    "investigator.create", "investigator.render_card",
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
    character = _read_object(character_path)
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
    character = _read_object(character_path)
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
) -> None:
    payload: dict[str, Any] = {
        "roll_id": command_id,
        "actor_id": actor_id,
        "kind": kind,
        "skill": skill,
        "roll": int(roll),
        "die": die,
        "die_rolls": [int(value) for value in die_rolls],
        "outcome": outcome,
        "visibility": "public",
    }
    if target is not None:
        payload["target"] = int(target)
    if difficulty is not None:
        payload["difficulty"] = difficulty
    if extra:
        payload.update(extra)
    _append_jsonl(campaign_dir / "logs" / "rolls.jsonl", {
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
    })


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
    sanity_path = campaign_dir / "save" / "sanity.json"
    if sanity_path.is_file():
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
    character = _read_object(character_path)
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
        sanity_path = campaign_dir / "save" / "sanity.json"
        existed = sanity_path.is_file()
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
        mythos_result = coc_mythos.gain_mythos_persisted(
            campaign_dir, investigator_id, amount=cm_gain
        )
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
) -> tuple[dict[str, Path], dict[str, Path]]:
    coc_root = campaign_dir.parents[1]
    files = {
        "character": coc_root / "investigators" / investigator_id / "character.json",
        "legacy_ticks": coc_root / "investigators" / investigator_id / "development.jsonl",
        "investigator_state": (
            campaign_dir / "save" / "investigator-state" / f"{investigator_id}.json"
        ),
        "pacing_state": campaign_dir / "save" / "pacing-state.json",
        "sanity": campaign_dir / "save" / "sanity.json",
        "settlement": settlement_path,
    }
    logs = {
        "events": campaign_dir / "logs" / "events.jsonl",
        "rolls": campaign_dir / "logs" / "rolls.jsonl",
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


def _capture_development_inflight(
    *,
    campaign_dir: Path,
    investigator_id: str,
    ending_id: str,
    settlement_path: Path,
    inflight_path: Path,
    rng: random.Random,
) -> dict[str, Any]:
    files, logs = _development_transaction_paths(
        campaign_dir, investigator_id, settlement_path
    )
    file_preimages: dict[str, Any] = {}
    for name, path in files.items():
        if path.is_file():
            file_preimages[name] = {
                "exists": True,
                "text": path.read_text(encoding="utf-8"),
            }
        else:
            file_preimages[name] = {"exists": False, "text": None}
    log_preimages: dict[str, Any] = {}
    for name, path in logs.items():
        log_preimages[name] = {
            "exists": path.is_file(),
            "size": path.stat().st_size if path.is_file() else 0,
        }
    journal = {
        "schema_version": 1,
        "status": "prepared",
        "ending_id": ending_id,
        "investigator_id": investigator_id,
        "rng_state": _random_state_to_json(rng.getstate()),
        "file_preimages": file_preimages,
        "log_preimages": log_preimages,
        "prepared_at": _now(),
    }
    inflight_path.parent.mkdir(parents=True, exist_ok=True)
    coc_fileio.write_json_atomic(
        inflight_path,
        journal,
        indent=2,
        ensure_ascii=False,
        trailing_newline=True,
    )
    return journal


def _restore_development_inflight(
    *,
    campaign_dir: Path,
    investigator_id: str,
    settlement_path: Path,
    journal: dict[str, Any],
) -> None:
    if (
        journal.get("schema_version") != 1
        or journal.get("status") != "prepared"
        or journal.get("investigator_id") != investigator_id
    ):
        raise RuntimeOperationError("invalid development settlement inflight journal")
    files, logs = _development_transaction_paths(
        campaign_dir, investigator_id, settlement_path
    )
    file_preimages = journal.get("file_preimages")
    log_preimages = journal.get("log_preimages")
    if (
        not isinstance(file_preimages, dict)
        or set(file_preimages) != set(files)
        or not isinstance(log_preimages, dict)
        or set(log_preimages) != set(logs)
    ):
        raise RuntimeOperationError("development settlement journal target set is invalid")
    for name, path in files.items():
        preimage = file_preimages[name]
        if not isinstance(preimage, dict) or set(preimage) != {"exists", "text"}:
            raise RuntimeOperationError("development settlement file preimage is invalid")
        if preimage.get("exists") is True:
            text = preimage.get("text")
            if not isinstance(text, str):
                raise RuntimeOperationError("development settlement file preimage is unreadable")
            coc_fileio.write_text_atomic(path, text)
        elif preimage.get("exists") is False and preimage.get("text") is None:
            path.unlink(missing_ok=True)
        else:
            raise RuntimeOperationError("development settlement file preimage is invalid")
    for name, path in logs.items():
        preimage = log_preimages[name]
        if not isinstance(preimage, dict) or set(preimage) != {"exists", "size"}:
            raise RuntimeOperationError("development settlement log preimage is invalid")
        size = preimage.get("size")
        if isinstance(size, bool) or not isinstance(size, int) or size < 0:
            raise RuntimeOperationError("development settlement log offset is invalid")
        if preimage.get("exists") is True:
            if not path.is_file() or path.stat().st_size < size:
                raise RuntimeOperationError(
                    "development settlement log cannot be restored to its prepared offset"
                )
            with path.open("r+b") as handle:
                handle.truncate(size)
                handle.flush()
                os.fsync(handle.fileno())
        elif preimage.get("exists") is False and size == 0:
            path.unlink(missing_ok=True)
        else:
            raise RuntimeOperationError("development settlement log preimage is invalid")


def _settled_receipt_for_ending(
    settlement_path: Path, ending_id: str
) -> dict[str, Any] | None:
    if not settlement_path.is_file():
        return None
    settled = _read_object(settlement_path)
    if settled.get("ending_id") != ending_id:
        return None
    receipt = settled.get("receipt")
    return receipt if isinstance(receipt, dict) else None


def _development_operation_body(
    *,
    campaign_dir: Path,
    investigator_id: str,
    payload: dict[str, Any],
    rng: random.Random,
) -> dict[str, Any]:
    if payload:
        raise RuntimeOperationError("development.settle payload must be empty")
    ending = coc_development.structured_ending_evidence(campaign_dir)
    if ending is None:
        raise RuntimeOperationError(
            "development.settle requires a persisted state.end_session receipt"
        )
    settlement_path = (
        campaign_dir / "save" / "development-settlements" / f"{investigator_id}.json"
    )
    if settlement_path.is_file():
        settled = _read_object(settlement_path)
        if settled.get("ending_id") == ending["ending_id"]:
            receipt = settled.get("receipt")
            if isinstance(receipt, dict):
                return receipt
    result = coc_development.run_development_phase(
        campaign_dir, investigator_id, rng=rng
    )
    operation_id = _operation_id("development.settle", rng)
    for index, check in enumerate(result.get("improvement_checks") or []):
        _write_public_roll(
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
        )
        if check.get("improved") and isinstance(check.get("gain"), int):
            _write_public_roll(
                campaign_dir,
                command_id=f"{operation_id}:gain:{index}",
                actor_id=investigator_id,
                kind="development_gain",
                skill=str(check["skill"]),
                roll=int(check["gain"]),
                die="1D10",
                die_rolls=[int(check["gain"])],
                outcome="skill_increased",
            )
    luck = result.get("luck_recovery") or {}
    if isinstance(luck.get("roll"), int):
        _write_public_roll(
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
        )
    reward_expr = result.get("san_reward_expr")
    if isinstance(reward_expr, str) and reward_expr:
        rolled = coc_roll.roll_expression(reward_expr, rng)
        sanity = _sanity_session_for_reward(
            campaign_dir, investigator_id, rng=rng
        )
        san_before = int(sanity.san_current)
        sanity.gain_san(int(rolled["total"]), source="development")
        san_after = int(sanity.san_current)
        sanity.save(campaign_dir, strict_mirror=True)
        result["san_reward"] = {
            **rolled,
            "san_before": san_before,
            "san_gained": san_after - san_before,
            "san_after": san_after,
            "san_max": int(sanity.san_max),
        }
        reward_roll_id = f"{operation_id}:san-reward"
        _write_public_roll(
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
                "san_delta": san_after - san_before,
                "san_gained": san_after - san_before,
                "san_after": san_after,
                "san_max": int(sanity.san_max),
            },
        )
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
        rolled = coc_roll.roll_expression(scenario_reward_expr, rng)
        sanity = _sanity_session_for_reward(
            campaign_dir, investigator_id, rng=rng
        )
        san_before = int(sanity.san_current)
        sanity.gain_san(int(rolled["total"]), source="scenario_conclusion")
        san_after = int(sanity.san_current)
        sanity.save(campaign_dir, strict_mirror=True)
        result["scenario_san_reward"] = {
            **rolled,
            "san_before": san_before,
            "san_gained": san_after - san_before,
            "san_after": san_after,
            "san_max": int(sanity.san_max),
        }
        scenario_reward_roll_id = f"{operation_id}:scenario-san-reward"
        _write_public_roll(
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
                "rule_ref": ending.get("scenario_san_reward_rule_ref"),
                "san_before": san_before,
                "san_delta": san_after - san_before,
                "san_gained": san_after - san_before,
                "san_after": san_after,
                "san_max": int(sanity.san_max),
            },
        )
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
        "state_refs": [
            f"save/investigator-state/{investigator_id}.json",
            f"save/development-settlements/{investigator_id}.json",
            f"../../investigators/{investigator_id}/character.json",
            "logs/events.jsonl",
            "logs/rolls.jsonl",
        ],
    }
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


def _development_operation(
    *,
    campaign_dir: Path,
    investigator_id: str,
    payload: dict[str, Any],
    rng: random.Random,
) -> dict[str, Any]:
    """Run one crash-recoverable development transaction.

    The completed settlement receipt is the commit marker.  Before any
    permanent sheet/resource mutation, a durable journal records exact file
    preimages, append-log offsets, and the caller RNG state.  A process restart
    restores an uncommitted attempt and replays it with the original dice;
    ordinary exceptions restore immediately.  This keeps same-ending retries
    side-effect-free without moving deterministic bookkeeping into a host.
    """
    if payload:
        raise RuntimeOperationError("development.settle payload must be empty")
    ending = coc_development.structured_ending_evidence(campaign_dir)
    if ending is None:
        raise RuntimeOperationError(
            "development.settle requires a persisted state.end_session receipt"
        )
    ending_id = str(ending["ending_id"])
    settlement_path = (
        campaign_dir / "save" / "development-settlements" / f"{investigator_id}.json"
    )
    inflight_path = settlement_path.with_name(f"{investigator_id}.inflight.json")

    receipt = _settled_receipt_for_ending(settlement_path, ending_id)
    if receipt is not None:
        # A crash after the commit marker but before journal cleanup is already
        # a completed transaction; cleanup cannot cause a second settlement.
        if inflight_path.is_file():
            inflight_path.unlink(missing_ok=True)
        return receipt

    journal: dict[str, Any] | None = None
    if inflight_path.is_file():
        journal = _read_object(inflight_path)
        journal_ending_id = journal.get("ending_id")
        committed = (
            _settled_receipt_for_ending(settlement_path, str(journal_ending_id))
            if isinstance(journal_ending_id, str) else None
        )
        if committed is not None:
            inflight_path.unlink(missing_ok=True)
            journal = None
        else:
            _restore_development_inflight(
                campaign_dir=campaign_dir,
                investigator_id=investigator_id,
                settlement_path=settlement_path,
                journal=journal,
            )
            if journal_ending_id == ending_id:
                try:
                    rng.setstate(_random_state_from_json(journal.get("rng_state")))
                except (TypeError, ValueError) as exc:
                    raise RuntimeOperationError(
                        "development settlement journal RNG state is invalid"
                    ) from exc
            else:
                inflight_path.unlink(missing_ok=True)
                journal = None

    if journal is None:
        journal = _capture_development_inflight(
            campaign_dir=campaign_dir,
            investigator_id=investigator_id,
            ending_id=ending_id,
            settlement_path=settlement_path,
            inflight_path=inflight_path,
            rng=rng,
        )

    try:
        receipt = _development_operation_body(
            campaign_dir=campaign_dir,
            investigator_id=investigator_id,
            payload=payload,
            rng=rng,
        )
    except Exception:
        _restore_development_inflight(
            campaign_dir=campaign_dir,
            investigator_id=investigator_id,
            settlement_path=settlement_path,
            journal=journal,
        )
        inflight_path.unlink(missing_ok=True)
        raise
    inflight_path.unlink(missing_ok=True)
    return receipt


def settle_development(
    campaign_dir: Path | str,
    investigator_id: str,
    *,
    rng: random.Random | None = None,
) -> dict[str, Any]:
    """Shared non-locking settlement entry for an already locked host/tool.

    Top-level hosts should continue to use :func:`execute_operation`, which
    acquires the campaign lock.  The canonical toolbox already owns that lock,
    so its post-ending finalizer calls this narrow entry instead of nesting a
    second lock.
    """
    return _development_operation(
        campaign_dir=Path(campaign_dir),
        investigator_id=_id(investigator_id, "investigator_id"),
        payload={},
        rng=rng or random.Random(),
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
        allowed = {"campaign_id", "title", "era", "play_language", "start_clock"}
        if set(payload) - allowed or not {"campaign_id", "title"} <= set(payload):
            raise RuntimeOperationError("campaign.create has unsupported or missing fields")
        campaign_id = _id(payload.get("campaign_id"), "campaign_id")
        title = payload.get("title")
        if not isinstance(title, str) or not title.strip():
            raise RuntimeOperationError("campaign.create title must be non-empty")
        path = root / ".coc" / "campaigns" / campaign_id / "campaign.json"
        if path.exists():
            raise FileExistsError(f"campaign already exists: {campaign_id}")
        created = coc_state.create_campaign(
            root,
            campaign_id,
            title.strip(),
            era=str(payload.get("era") or "1920s"),
            play_language=str(payload.get("play_language") or "zh-Hans"),
            start_clock=payload.get("start_clock"),
        )
        return {
            "schema_version": 1,
            "status": "PASS",
            "kind": kind,
            "result": {"campaign_id": campaign_id},
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
        errors = coc_character.validate_character_sheet(sheet)
        if errors:
            raise RuntimeOperationError("invalid investigator sheet: " + "; ".join(errors))
        if str(sheet.get("id")) != investigator_id:
            raise RuntimeOperationError("investigator sheet id must match investigator_id")
        path = root / ".coc" / "investigators" / investigator_id / "character.json"
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
        rendered = coc_character_card.render_cards(
            character_path,
            campaign_path,
            campaign_dir / "assets" / "character-cards" / investigator_id,
            repo_root=root,
            language=language,
            html_mode=str(html_mode),
            write_back=False,
        )
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

    allowed = {
        "campaign_id", "scenario_id", "title", "pdf_path",
        "pdf_index_start", "pdf_index_end", "source_id", "compile_now",
    }
    required = {
        "campaign_id", "scenario_id", "title", "pdf_path",
        "pdf_index_start", "pdf_index_end",
    }
    if set(payload) - allowed or not required <= set(payload):
        raise RuntimeOperationError("scenario.bind_pdf has unsupported or missing fields")
    campaign_id = _id(payload.get("campaign_id"), "campaign_id")
    scenario_id = _id(payload.get("scenario_id"), "scenario_id")
    title = payload.get("title")
    pdf_path = Path(str(payload.get("pdf_path") or "")).expanduser().resolve()
    start = payload.get("pdf_index_start")
    end = payload.get("pdf_index_end")
    if not isinstance(title, str) or not title.strip():
        raise RuntimeOperationError("scenario.bind_pdf title must be non-empty")
    if not pdf_path.is_file() or pdf_path.suffix.lower() != ".pdf":
        raise RuntimeOperationError("scenario.bind_pdf requires a readable PDF")
    if (
        isinstance(start, bool) or not isinstance(start, int) or start < 0
        or isinstance(end, bool) or not isinstance(end, int) or end < start
    ):
        raise RuntimeOperationError("scenario.bind_pdf requires an exact PDF index range")
    campaign_dir = root / ".coc" / "campaigns" / campaign_id
    if not campaign_dir.is_dir():
        raise FileNotFoundError(f"unknown campaign: {campaign_id}")
    source = {
        "path": str(pdf_path),
        "pdf_index_start": start,
        "pdf_index_end": end,
        "title": title.strip(),
    }
    if payload.get("source_id") is not None:
        source["source_id"] = _id(payload["source_id"], "source_id")
    coc_scenario.create_scenario_skeleton(
        campaign_dir, scenario_id, title.strip(), source
    )
    scenario_path = campaign_dir / "scenario" / "scenario.json"
    scenario = _read_object(scenario_path)
    scenario["resolution_policy"] = "source_first"
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
        hydration = coc_scenario_hydration.ensure_scenario_ready(campaign_dir)
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
