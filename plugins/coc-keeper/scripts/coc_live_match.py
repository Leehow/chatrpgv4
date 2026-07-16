#!/usr/bin/env python3
"""Live LLM-player vs Keeper-agent match harness (N5).

Orchestrates: build player-safe request → player_send_turn → keeper coding
agent turn (skills + ``coc_toolbox.py``) → battle-report artifacts. The player
brain lives in ``runtime/adapters/player/`` and the keeper shell in
``runtime/adapters/keeper/``; this module stays plugin-side and does not fork
keeper skills/rules into runtime.
"""
from __future__ import annotations

import argparse
from copy import deepcopy
import json
import os
import stat
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable


OPERATOR_LONG_PLAY_PROTOCOL = "operator_codex_black_box_v2"
OPERATOR_PLAYER_PROTOCOL = "coc_operator_player_v2"

SCRIPT_DIR = Path(__file__).resolve().parent
# parents[0]=coc-keeper, [1]=plugins, [2]=repo root
REPO_ROOT = SCRIPT_DIR.parents[2]


def _append_jsonl_fsync(path: Path, row: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    encoded = json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n"
    with path.open("a", encoding="utf-8") as handle:
        handle.write(encoded)
        handle.flush()
        os.fsync(handle.fileno())


def _ensure_jsonl_source(path: Path) -> None:
    """Create an empty evidence source without following attacker links."""
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.is_symlink():
        raise RuntimeError(f"unsafe JSONL evidence source: {path}")
    flags = os.O_WRONLY | os.O_APPEND | os.O_CREAT
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    try:
        fd = os.open(path, flags, 0o600)
    except OSError as exc:
        raise RuntimeError(f"cannot initialize JSONL evidence source: {path}") from exc
    try:
        if not stat.S_ISREG(os.fstat(fd).st_mode):
            raise RuntimeError(f"JSONL evidence source is not a regular file: {path}")
        os.fsync(fd)
    finally:
        os.close(fd)


def _load_sibling(name: str, filename: str):
    import importlib.util

    spec = importlib.util.spec_from_file_location(name, SCRIPT_DIR / filename)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def _load_runtime_module(name: str, rel: str):
    import importlib.util

    path = REPO_ROOT / rel
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


playtest_driver = _load_sibling("coc_playtest_driver", "coc_playtest_driver.py")
playtest_evidence = _load_sibling("coc_playtest_evidence", "coc_playtest_evidence.py")
playtest_report = _load_sibling("coc_playtest_report", "coc_playtest_report.py")
coc_run_identity = _load_sibling("coc_run_identity", "coc_run_identity.py")
coc_eval_contract = _load_sibling(
    "coc_eval_contract_live_match", "coc_eval_contract.py"
)
coc_scene_graph = _load_sibling("coc_scene_graph", "coc_scene_graph.py")
coc_starter = _load_sibling("coc_starter", "coc_starter.py")
coc_investigator_guard = _load_sibling(
    "coc_investigator_guard_live_match", "coc_investigator_guard.py"
)
coc_event_contract = _load_sibling(
    "coc_event_contract_live_match", "coc_event_contract.py"
)
try:
    coc_adherence = _load_sibling("coc_adherence", "coc_adherence.py")
except Exception:
    coc_adherence = None
public_state_mod = _load_runtime_module(
    "runtime_public_state", "runtime/engine/public_state.py"
)
player_adapter = _load_runtime_module(
    "runtime_player_adapter", "runtime/adapters/player/adapter.py"
)
keeper_adapter = _load_runtime_module(
    "runtime_keeper_adapter", "runtime/adapters/keeper/adapter.py"
)
worker_pool_mod = _load_runtime_module(
    "runtime_adapter_worker_pool", "runtime/adapters/worker_pool.py"
)

DEFAULT_KEEPER_RUNNER = (
    REPO_ROOT / "runtime" / "adapters" / "keeper" / "run_keeper_turn.mjs"
)

NON_LIVE_EVIDENCE_DISCLAIMER = (
    "Non-live artifacts are never gameplay evidence per AGENTS.md "
    "Playtest Battle Report Evidence Standard."
)
_ACTIVE_WORKER_POOLS: list[Any] = []

# Narrow aliases keep the artifact-identity contract directly probeable without
# duplicating it in this harness.
_ensure_artifact_run_identity = coc_run_identity.ensure_artifact_run_identity
_allocate_default_run_dir = coc_run_identity.allocate_default_run_dir
RunIdentityError = coc_run_identity.RunIdentityError


def _read_json(path: Path, fallback: Any) -> Any:
    if not path.exists():
        return fallback
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return fallback


def _campaign_dir(workspace: Path, campaign_id: str) -> Path:
    return Path(workspace) / ".coc" / "campaigns" / campaign_id


def _default_character_path(workspace: Path, investigator_id: str) -> Path:
    return (
        Path(workspace)
        / ".coc"
        / "investigators"
        / investigator_id
        / "character.json"
    )


def load_character_card(character_path: Path | str) -> dict[str, Any]:
    """Load the investigator's own character sheet (player-safe by ownership)."""
    path = Path(character_path).absolute()
    investigator_dir = path.parent
    investigators_dir = investigator_dir.parent
    coc_root = investigators_dir.parent
    if (
        path.name == "character.json"
        and investigators_dir.name == "investigators"
        and coc_root.name == ".coc"
        and investigator_dir.name
    ):
        return coc_investigator_guard.read_reusable_character(
            coc_root, investigator_dir.name, path
        )
    data = _read_json(path, {})
    return data if isinstance(data, dict) else {}


_PLAYER_CHARACTER_SCALARS = (
    "schema_version",
    "id",
    "name",
    "occupation",
    "era",
    "age",
    "sex",
    "residence",
    "birthplace",
    "credit_rating",
    "cash",
    "assets",
    "spending_level",
)
_PLAYER_CHARACTERISTICS = (
    "STR", "CON", "SIZ", "DEX", "APP", "INT", "POW", "EDU", "LUCK",
)
_PLAYER_DERIVED = ("HP", "SAN", "MP", "MOV", "DB", "BUILD")
_PLAYER_WEAPON_FIELDS = (
    "name", "skill", "damage", "range", "attacks", "ammo", "malfunction",
)
_PLAYER_EQUIPMENT_FIELDS = (
    "id", "name", "description", "quantity", "condition", "ammo", "charges",
)
_PLAYER_BACKSTORY_FIELDS = (
    "description",
    "significant_people",
    "meaningful_locations",
    "traits",
    "ideology",
    "treasured_possessions",
    "traits_detail",
    "injuries_scars",
    "phobias_manias",
    "encounters",
)


def _owned_scalar(value: Any) -> Any:
    return value if isinstance(value, (str, int, float, bool)) else None


def _owned_backstory(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        return {}
    merged = dict(value)
    scenario_bound = value.get("scenario_bound")
    if isinstance(scenario_bound, dict):
        # Starter pregens store their player-authored history under this
        # provenance wrapper.  Flatten only the allowlisted content; never
        # expose the scenario id or arbitrary scenario-bound fields.
        for key in _PLAYER_BACKSTORY_FIELDS:
            if key not in merged and key in scenario_bound:
                merged[key] = scenario_bound[key]
    out: dict[str, Any] = {}
    for key in _PLAYER_BACKSTORY_FIELDS:
        item = merged.get(key)
        if isinstance(item, list):
            clean = [
                scalar for entry in item if (scalar := _owned_scalar(entry)) is not None
            ]
            if clean:
                out[key] = clean
        else:
            clean = _owned_scalar(item)
            if clean is not None:
                out[key] = clean
    return out


def build_player_character_view(
    character_card: dict[str, Any],
    campaign_dir: Path,
    investigator_id: str,
) -> dict[str, Any]:
    """Project a complete but strictly player-owned character view.

    Character-sheet notes and arbitrary extension fields are intentionally not
    forwarded.  Current HP/SAN/MP come from campaign state, not stale sheet
    maxima; the remaining derived values stay on the owned card.
    """
    card = character_card if isinstance(character_card, dict) else {}
    out: dict[str, Any] = {}
    for key in _PLAYER_CHARACTER_SCALARS:
        value = _owned_scalar(card.get(key))
        if value is not None:
            out[key] = value

    characteristics = card.get("characteristics")
    if isinstance(characteristics, dict):
        clean_characteristics = {
            key: characteristics[key]
            for key in _PLAYER_CHARACTERISTICS
            if isinstance(characteristics.get(key), (int, float))
            and not isinstance(characteristics.get(key), bool)
        }
        if clean_characteristics:
            out["characteristics"] = clean_characteristics

    derived = card.get("derived")
    clean_derived: dict[str, Any] = {}
    if isinstance(derived, dict):
        for key in _PLAYER_DERIVED:
            value = _owned_scalar(derived.get(key))
            if value is not None:
                clean_derived[key] = value
    state = _read_json(
        campaign_dir / "save" / "investigator-state" / f"{investigator_id}.json",
        {},
    )
    if not isinstance(state, dict):
        state = {}
    for derived_key, state_key in (
        ("HP", "current_hp"),
        ("SAN", "current_san"),
        ("MP", "current_mp"),
    ):
        value = state.get(state_key)
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            clean_derived[derived_key] = value
    if clean_derived:
        out["derived"] = clean_derived

    skills = card.get("skills")
    if isinstance(skills, dict):
        clean_skills = {
            str(key): value
            for key, value in skills.items()
            if isinstance(key, str)
            and key.strip()
            and isinstance(value, (int, float))
            and not isinstance(value, bool)
        }
        if clean_skills:
            out["skills"] = clean_skills

    weapons = card.get("weapons")
    if isinstance(weapons, list):
        clean_weapons: list[dict[str, Any]] = []
        for weapon in weapons:
            if not isinstance(weapon, dict):
                continue
            clean = {
                key: value
                for key in _PLAYER_WEAPON_FIELDS
                if (value := _owned_scalar(weapon.get(key))) is not None
            }
            if clean:
                clean_weapons.append(clean)
        if clean_weapons:
            out["weapons"] = clean_weapons

    equipment = card.get("equipment")
    if isinstance(equipment, list):
        clean_equipment: list[Any] = []
        for item in equipment:
            scalar = _owned_scalar(item)
            if scalar is not None:
                clean_equipment.append(scalar)
                continue
            if isinstance(item, dict):
                clean = {
                    key: value
                    for key in _PLAYER_EQUIPMENT_FIELDS
                    if (value := _owned_scalar(item.get(key))) is not None
                }
                if clean:
                    clean_equipment.append(clean)
        if clean_equipment:
            out["equipment"] = clean_equipment

    backstory = _owned_backstory(card.get("backstory"))
    if backstory:
        out["backstory"] = backstory

    current_status: dict[str, Any] = {}
    for public_key, state_key in (
        ("HP", "current_hp"),
        ("SAN", "current_san"),
        ("MP", "current_mp"),
        ("LUCK", "current_luck"),
    ):
        value = state.get(state_key)
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            current_status[public_key] = value
    conditions = state.get("conditions")
    if isinstance(conditions, list):
        clean_conditions = [
            item.strip() for item in conditions if isinstance(item, str) and item.strip()
        ]
        current_status["conditions"] = clean_conditions
    if current_status:
        out["current_status"] = current_status
    return out


def player_visible_narration(
    turn: dict[str, Any] | None,
    campaign_dir: Path,
    *,
    play_language: str = "zh-Hans",
    previous_affordance_ids: list[str] | None = None,
) -> str:
    """Derive player-visible narration text from a keeper turn (no secrets)."""
    if isinstance(turn, dict):
        narration = turn.get("narration")
        if isinstance(narration, dict):
            final = narration.get("final_text")
            if isinstance(final, str) and final.strip():
                return final.strip()
    active = _read_json(campaign_dir / "save" / "active-scene.json", {})
    if isinstance(active, dict):
        summary = active.get("player_safe_summary")
        if isinstance(summary, str) and summary.strip():
            return summary.strip()
    opening = coc_starter.player_safe_opening(
        campaign_dir, play_language=play_language
    )
    if opening:
        return opening
    return "场景开始。你站在可调查的现场。" if play_language == "zh-Hans" else "The scene opens."


def build_player_request(
    workspace: Path | str,
    campaign_id: str,
    *,
    narration: str,
    character_card: dict[str, Any],
    transcript_tail: list[dict[str, Any]],
    persona_id: str | None = None,
    persona_prompt_directives: list[str] | None = None,
) -> dict[str, Any]:
    """Assemble a player-brain request from player-safe inputs only."""
    public_state = public_state_mod.build_public_state(workspace, campaign_id)
    pending = public_state.get("pending_choice")
    request = {
        "narration": str(narration or ""),
        "character_card": dict(character_card),
        "transcript_tail": list(transcript_tail),
        "pending_choice": pending,
        "play_language": str(public_state.get("play_language") or "zh-Hans"),
    }
    if (persona_id is None) != (persona_prompt_directives is None):
        raise ValueError("persona_id and persona_prompt_directives must appear together")
    if persona_id is not None:
        if not isinstance(persona_id, str) or not persona_id.strip():
            raise ValueError("persona_id must be a non-empty string")
        if (
            not isinstance(persona_prompt_directives, list)
            or not persona_prompt_directives
            or any(
                not isinstance(item, str) or not item.strip()
                for item in persona_prompt_directives
            )
        ):
            raise ValueError("persona_prompt_directives must be a non-empty string list")
        request["persona_id"] = persona_id
        request["persona_prompt_directives"] = list(persona_prompt_directives)
    return request


def _operator_player_turn_stdio(request: dict[str, Any]) -> dict[str, Any]:
    """Exchange one player-safe request/response over line-delimited JSON."""
    sys.stdout.write(json.dumps({
        "protocol": OPERATOR_PLAYER_PROTOCOL,
        "type": "player_request",
        "request": request,
    }, ensure_ascii=False, separators=(",", ":")) + "\n")
    sys.stdout.flush()
    line = sys.stdin.readline()
    if not line:
        raise RuntimeError("operator player transport reached EOF")
    try:
        response = json.loads(line)
    except json.JSONDecodeError as exc:
        raise ValueError("operator player response must be one JSON object") from exc
    if not isinstance(response, dict):
        raise ValueError("operator player response must be an object")
    player_text = response.get("player_text")
    if not isinstance(player_text, str) or not player_text.strip():
        raise ValueError("operator player response requires non-empty player_text")
    result: dict[str, Any] = {
        "ok": True,
        "player_text": player_text.strip(),
        "response_mode": "operator_jsonl",
        "operator_transport": OPERATOR_PLAYER_PROTOCOL,
    }
    pending = response.get("pending_choice_response")
    if pending is not None:
        if not isinstance(pending, dict):
            raise ValueError("pending_choice_response must be an object")
        result["pending_choice_response"] = pending
    intent_class = response.get("intent_class")
    if intent_class is not None:
        if not isinstance(intent_class, str) or not intent_class.strip():
            raise ValueError("intent_class must be a non-empty string")
        result["intent_class"] = intent_class.strip()
    return result


def investigator_playability(
    campaign_dir: Path,
    investigator_id: str,
) -> dict[str, Any]:
    """Classify structured investigator state without equating 0 HP to death."""
    state = _read_json(
        campaign_dir / "save" / "investigator-state" / f"{investigator_id}.json",
        {},
    )
    if not isinstance(state, dict):
        state = {}
    raw_conditions = state.get("conditions") or []
    conditions = {
        str(condition).strip().lower()
        for condition in raw_conditions
        if str(condition).strip()
    } if isinstance(raw_conditions, list) else set()

    if "dead" in conditions:
        return {"status": "dead", "playable": False, "terminal": True}

    if "stabilized" in conditions:
        return {
            "status": "stabilized",
            "playable": False,
            "terminal": False,
            "pending_resolution": {
                "kind": "stabilized_death_clock",
                "investigator_id": investigator_id,
                "event_type": "stabilized_con_roll",
            },
        }

    if "dying" in conditions:
        return {
            "status": "dying",
            "playable": False,
            "terminal": False,
            "pending_resolution": {
                "kind": "dying_rescue",
                "investigator_id": investigator_id,
                "rescue_event_type": "first_aid_stabilize",
                "death_clock_event_type": "dying_con_roll",
            },
        }

    if (
        "permanently_unplayable" in conditions
        or state.get("permanently_insane")
        or state.get("permanent_insane")
    ):
        return {
            "status": "permanently_unplayable",
            "playable": False,
            "terminal": False,
        }

    if (
        "temporarily_unplayable" in conditions
        or "bout_active" in conditions
        or state.get("bout_active")
    ):
        return {
            "status": "temporarily_unplayable",
            "playable": False,
            "terminal": False,
        }

    hp = state.get("current_hp")
    hp_at_or_below_zero = False
    try:
        hp_at_or_below_zero = hp is not None and int(hp) <= 0
    except (TypeError, ValueError):
        pass

    if "unconscious" in conditions or hp_at_or_below_zero:
        return {"status": "unconscious", "playable": False, "terminal": False}
    return {"status": "active", "playable": True, "terminal": False}


def _playability_stop_reason(playability: dict[str, Any]) -> str | None:
    if playability.get("terminal") is True:
        return "investigator_dead"
    if isinstance(playability.get("pending_resolution"), dict):
        return "pending_resolution"
    if playability.get("playable") is False:
        return f"investigator_{playability.get('status') or 'unplayable'}"
    return None


def _match_metadata(
    *,
    user_claimed_live: bool,
    campaign_id: str,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    meta: dict[str, Any] = {
        "campaign_id": campaign_id,
        "user_claimed_live": bool(user_claimed_live),
        "audit_profile": "player_bridge_match",
        "play_language": "zh-Hans",
        "runner_kind": "unknown",
        "player_profile": "unattested_runner",
        "simulation_method": "unattested_runner_match_not_gameplay_evidence",
        "evidence_disclaimer": NON_LIVE_EVIDENCE_DISCLAIMER,
        "eligible_as_gameplay_evidence": False,
        "evidence_reasons": ["evidence_receipt_pending"],
        "subsystems_covered": [
            "investigation",
            "rules",
            "narrative_enrichment",
            "storylet_engine",
            "player_brain_bridge",
        ],
        "passed_test_cases": [
            "bridged_player_turns",
            "actual_play_transcript",
            "rules_rolls",
            "storylet_events",
        ],
        "failed_test_cases": [],
        "future_enhancements": [
            "Provide structured runner/model attestations for evidence-grade gameplay receipts."
        ],
    }
    if extra:
        meta.update(extra)
    return meta


def _utc_timestamp() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _invocation_row(
    *,
    run_dir: Path,
    role: str,
    runner_path: Path | None,
    attempt: int,
    outcome: str,
    model_identity: Any,
    response_mode: Any,
    fallback_kind: str | None,
    duration_seconds: float,
    usage: Any = None,
    failure_receipt: Any = None,
) -> dict[str, Any]:
    observed = playtest_evidence.observe_runner(run_dir, role, runner_path)
    row = {
        "schema_version": 1,
        "role": role,
        "attempt": attempt,
        "transcript_turn": None,
        "runner_kind": observed.get("kind"),
        "runner_identity": observed.get("identity"),
        "runner_path": observed.get("path"),
        "runner_sha256": observed.get("sha256"),
        "model_identity": model_identity,
        "outcome": outcome,
        "response_mode": response_mode,
        "fallback_kind": fallback_kind,
        "duration_seconds": round(max(0.0, float(duration_seconds)), 6),
    }
    if isinstance(usage, dict):
        row["usage"] = {
            "input_tokens": usage.get("input_tokens"),
            "output_tokens": usage.get("output_tokens"),
        }
    if role == "narrator" and isinstance(failure_receipt, dict):
        row["failure"] = json.loads(json.dumps(failure_receipt))
    return row


def _read_jsonl_rows(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    if not path.is_file():
        return rows
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(row, dict):
            rows.append(row)
    return rows


def _write_jsonl_rows_atomic(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(f".{path.name}.tmp-{os.getpid()}")
    with temp.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False, separators=(",", ":")))
            handle.write("\n")
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temp, path)


def _write_json_atomic(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(f".{path.name}.tmp-{os.getpid()}")
    with temp.open("w", encoding="utf-8") as handle:
        json.dump(value, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temp, path)


def _resume_tail_from_transcript(
    rows: list[dict[str, Any]], *, limit: int,
) -> tuple[list[dict[str, str]], str]:
    normalized: list[dict[str, str]] = []
    for row in rows:
        role = row.get("role")
        if role == "player_simulator":
            normalized_role = "player"
        elif role == "keeper_under_test":
            normalized_role = "keeper"
        else:
            continue
        text_value = row.get("text")
        if isinstance(text_value, str) and text_value.strip():
            normalized.append({"role": normalized_role, "text": text_value.strip()})
    if not normalized or normalized[-1]["role"] != "keeper":
        raise ValueError(
            "resume run transcript must end with a completed keeper turn"
        )
    return normalized[-max(1, int(limit)):], normalized[-1]["text"]


def _renumber_appended_rows(
    prior: list[dict[str, Any]], current: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    merged = [deepcopy(row) for row in prior]
    prior_turns = [
        int(row["turn"])
        for row in prior
        if isinstance(row.get("turn"), int) and not isinstance(row.get("turn"), bool)
    ]
    next_turn = max(prior_turns, default=0) + 1
    for row in current:
        item = deepcopy(row)
        item["turn"] = next_turn
        next_turn += 1
        merged.append(item)
    return merged


def _structured_event_type(row: dict[str, Any]) -> str | None:
    return coc_event_contract.event_type(row)


def build_completion_receipts(
    campaign_dir: Path,
    *,
    story_graph: dict[str, Any],
    world_state: dict[str, Any],
    terminal_evidence: dict[str, Any],
    scenario_id: str,
) -> dict[str, Any]:
    """Project strict full-module completion evidence from authoritative logs.

    Merely arriving at a graph-terminal scene is not completion.  The receipt
    stays incomplete unless the runtime has recorded a structured ending plus
    combat, terminal conclusion, and reward events.
    """
    events_path = campaign_dir / "logs" / "events.jsonl"
    rows = _read_jsonl_rows(events_path)

    def latest(
        event_type: str, *, predicate: Callable[[dict[str, Any]], bool] | None = None,
    ) -> tuple[int, dict[str, Any]] | None:
        return coc_event_contract.last_matching(
            rows, event_type, predicate=predicate
        )

    def event_receipt(
        event_type: str, *, predicate: Callable[[dict[str, Any]], bool] | None = None,
    ) -> dict[str, Any]:
        found = latest(event_type, predicate=predicate)
        if found is None:
            return {"status": "missing", "event_type": event_type}
        line, row = found
        receipt = {
            "status": "complete",
            "event_type": event_type,
            "source_event_type": _structured_event_type(row),
            "source_ref": f"logs/events.jsonl#line-{line}",
        }
        for key in (
            "decision_id", "command_id", "scene_id", "scenario_id",
            "combat_id", "outcome", "roll_id", "conclusion_id", "source",
            "kind",
        ):
            value = coc_event_contract.value(row, key)
            if isinstance(value, (str, int)) and not isinstance(value, bool):
                receipt[key] = value
        return receipt

    ending = event_receipt("session_ending")
    combat = event_receipt("combat")
    reward = event_receipt(
        "reward",
        predicate=(
            coc_event_contract.is_conclusion_reward
            if scenario_id == "the-haunting"
            else None
        ),
    )

    active_scene_id = terminal_evidence.get("active_scene_id")
    ending_scene_id = ending.get("scene_id") if ending["status"] == "complete" else None
    active_scene = next(
        (
            scene
            for scene in (story_graph.get("scenes") or [])
            if isinstance(scene, dict) and scene.get("scene_id") == active_scene_id
        ),
        None,
    )
    conclusion_complete = bool(
        ending["status"] == "complete"
        # A cliffhanger is an intentional session boundary, not a resolved
        # scenario. Legacy ending rows predate ``kind`` and retain their
        # historical conclusion semantics.
        and ending.get("kind", "conclusion")
        in {"conclusion", "tpk", "retreat"}
        and terminal_evidence.get("session_ending") is True
        and coc_scene_graph.is_terminal_scene(active_scene, story_graph)
        and ending_scene_id == active_scene_id
        and (
            ending.get("scenario_id") in (None, scenario_id)
        )
    )
    conclusion: dict[str, Any] = {
        "status": "complete" if conclusion_complete else "missing",
        "active_scene_id": active_scene_id,
        "graph_terminal": bool(terminal_evidence.get("graph_terminal")),
        "session_ending": bool(terminal_evidence.get("session_ending")),
    }
    if conclusion_complete:
        conclusion["source_ref"] = ending["source_ref"]
        conclusion["scene_id"] = active_scene_id
        conclusion["scenario_id"] = scenario_id

    receipts = {
        "schema_version": 1,
        "audit_profile": (
            "haunting_module" if scenario_id == "the-haunting" else "full_module"
        ),
        "scenario_id": scenario_id,
        "session_ending": ending,
        "combat": combat,
        "conclusion": conclusion,
        "reward": reward,
        "source": "campaign_structured_event_log",
    }
    receipts["scenario_concluded"] = conclusion_complete
    receipts["complete"] = all(
        receipts[key]["status"] == "complete"
        for key in ("session_ending", "combat", "conclusion", "reward")
    )
    return receipts


def _write_invocation_ledger(run_dir: Path, rows: list[dict[str, Any]]) -> Path:
    transcript = _read_jsonl_rows(run_dir / "transcript.jsonl")
    turns_by_role = {
        "player": [
            row.get("turn")
            for row in transcript
            if row.get("role") == "player_simulator"
        ],
        "narrator": [
            row.get("turn")
            for row in transcript
            if row.get("role") == "keeper_under_test"
        ],
        "action_resolver": [
            row.get("turn")
            for row in transcript
            if row.get("role") == "player_simulator"
        ],
    }
    role_offsets = {"player": 0, "narrator": 0, "action_resolver": 0}
    for row in rows:
        role = row.get("role")
        available = turns_by_role.get(str(role), [])
        offset = role_offsets.get(str(role), 0)
        if offset < len(available):
            row["transcript_turn"] = available[offset]
        role_offsets[str(role)] = offset + 1
    return playtest_evidence.write_invocation_ledger_artifact(
        run_dir,
        "".join(
            json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n"
            for row in rows
        ),
    )


def _enrich_transcript_with_player_notes(
    run_dir: Path,
    player_turns: list[dict[str, Any]],
) -> None:
    """Attach per-turn player_notes onto player transcript rows (report artifact).

    Notes stay on the structured ``player_notes`` field so the battle report can
    render them as a sub-bullet; do not inline into quoted player_text.
    """
    path = run_dir / "transcript.jsonl"
    if not path.exists():
        return
    rows: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            rows.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    note_by_text = {
        str(pt.get("player_text") or ""): pt.get("player_notes")
        for pt in player_turns
        if pt.get("player_notes")
    }
    player_idx = 0
    for row in rows:
        if row.get("role") != "player_simulator":
            continue
        notes = None
        if player_idx < len(player_turns):
            notes = player_turns[player_idx].get("player_notes")
        if notes is None:
            notes = note_by_text.get(str(row.get("text") or ""))
        if notes:
            row["player_notes"] = notes
            # Strip legacy inline pollution if a prior run inlined notes.
            base = str(row.get("text") or "")
            marker = "\n[player_notes] "
            if marker in base:
                row["text"] = base.split(marker, 1)[0]
        player_idx += 1
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")


def _file_byte_size(path: Path) -> int:
    try:
        return path.stat().st_size if path.is_file() else 0
    except OSError:
        return 0


def _jsonl_rows_after(path: Path, offset: int) -> list[dict[str, Any]]:
    """Tolerantly read JSONL dict rows appended after a prior byte offset."""
    if not path.is_file():
        return []
    start = max(0, int(offset))
    try:
        with path.open("rb") as handle:
            handle.seek(start)
            raw = handle.read()
    except OSError:
        return []
    if not raw:
        return []
    if start > 0 and raw[:1] != b"\n":
        newline = raw.find(b"\n")
        if newline < 0:
            return []
        raw = raw[newline + 1 :]
    rows: list[dict[str, Any]] = []
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        text = raw.decode("utf-8", errors="replace")
    for line in text.splitlines():
        if not line.strip():
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(row, dict):
            rows.append(row)
    return rows


def _project_keeper_match_turn(
    *,
    turn_num: int,
    player_text: str,
    keeper_text: str,
    scene_before: Any,
    world_after: dict[str, Any],
    pacing_after: dict[str, Any],
    tool_rows: list[dict[str, Any]],
    roll_rows: list[dict[str, Any]],
    clues_before: set[str],
) -> dict[str, Any]:
    """Project one keeper-agent turn into the playtest session-record shape."""
    clues_after = {
        str(item)
        for item in (world_after.get("discovered_clue_ids") or [])
        if item is not None and str(item)
    }
    scene_after = world_after.get("active_scene_id")
    return {
        "turn": turn_num,
        "decision_id": f"keeper-agent-{turn_num:04d}",
        "scene_id": scene_after,
        "action": player_text,
        "pipeline": "keeper_agent",
        "tension": pacing_after.get("tension_level"),
        "narration": {"final_text": keeper_text, "method": "keeper_agent"},
        "tool_calls": tool_rows,
        "rule_results": roll_rows,
        "clue_revealed": sorted(clues_after - clues_before),
        "scene_transition": bool(scene_after and scene_after != scene_before),
        "events_count": len(tool_rows),
        "event_types": sorted(
            {str(row.get("tool")) for row in tool_rows if row.get("tool")}
        ),
        # Benign empty envelope-era fields so battle-report helpers stay stable.
        "choice_frame": {},
        "subsystem_results": [],
        "storylet_moves": [],
        "npc_moves": [],
        "incident_moves": [],
        "narrative_directives": {},
        "narrative_enrichment": {},
        "public_roll_block": {},
        "rules_requests": [],
        "roll_density_decisions": [],
        "resolved_clue_policy": {},
        "narration_envelope": {},
        "pending_choice": None,
        "blocked_by_pending_choice": False,
        "failure_consequence": None,
    }


def _run_live_match_impl(
    workspace: Path | str,
    campaign_id: str,
    investigator_id: str,
    *,
    player_runner: Path | str | None = None,
    max_turns: int = 20,
    rng_seed: int | str | None = None,
    live: bool = False,
    character_path: Path | str | None = None,
    run_dir: Path | str | None = None,
    intent_class: str | None = None,
    player_intent_rich: dict[str, Any] | None = None,
    timeout_s: float = 300,
    transcript_tail_limit: int = 6,
    keeper_runner: Path | str | None = None,
    narrator_runner: Path | str | None = None,  # deprecated alias for keeper_runner
    evidence_provenance: dict[str, Any] | None = None,
    persona_id: str | None = None,
    persona_prompt_directives: list[str] | None = None,
    initial_transcript_tail: list[dict[str, str]] | None = None,
    initial_narration: str | None = None,
    resume_run_dir: Path | str | None = None,
    resolve_player_actions: bool = False,  # legacy no-op
    operator_long_play: bool = False,
    operator_player_provider: Callable[[dict[str, Any]], dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Run a multi-turn match: external player brain ↔ keeper coding agent.

    ``live`` is recorded only as ``user_claimed_live``.  Evidence eligibility,
    runner kind, and model identity are derived from ``evidence.json`` and its
    structured provenance; the flag itself carries no attestation authority.
    ``narrator_runner`` remains as a deprecated alias for ``keeper_runner``.
    ``resolve_player_actions`` / ``rng_seed`` are accepted for transitional
    callers but no longer drive rules — the keeper agent interprets actions.
    """
    _ = resolve_player_actions  # legacy no-op: keeper agent interprets actions
    started_at = _utc_timestamp()
    ws = Path(workspace)
    camp = _campaign_dir(ws, campaign_id)
    if not camp.is_dir():
        raise FileNotFoundError(f"campaign not found: {camp}")
    char_path = (
        Path(character_path) if character_path else _default_character_path(ws, investigator_id)
    )
    if not char_path.is_file():
        raise FileNotFoundError(f"character sheet not found: {char_path}")

    character_card = coc_investigator_guard.read_reusable_character(
        ws / ".coc",
        investigator_id,
        char_path,
    )
    if operator_long_play and player_runner is not None:
        raise ValueError("operator_long_play cannot use an AI player_runner")
    if not operator_long_play and player_runner is None:
        raise ValueError("player_runner is required outside operator_long_play")
    runner = Path(player_runner).resolve() if player_runner is not None else None
    keeper_path = Path(
        keeper_runner or narrator_runner or DEFAULT_KEEPER_RUNNER
    ).resolve()
    if not keeper_path.is_file():
        raise FileNotFoundError(f"keeper runner not found: {keeper_path}")

    if run_dir is None:
        out = _allocate_default_run_dir(ws / ".coc" / "playtests")
    else:
        out = Path(run_dir)
        out.mkdir(parents=True, exist_ok=True)
    # Persist the physical artifact identity before any player, Keeper, or
    # toolbox-driven turn can run. Directory names never carry provenance.
    run_id = _ensure_artifact_run_identity(out, campaign_id)

    prior_run: Path | None = None
    prior_transcript_rows: list[dict[str, Any]] = []
    prior_invocation_rows: list[dict[str, Any]] = []
    prior_metadata: dict[str, Any] = {}
    prior_run_ids: list[str] = []
    prior_current_run_id: str | None = None
    if resume_run_dir is not None:
        if initial_transcript_tail is not None or initial_narration is not None:
            raise ValueError(
                "resume_run_dir cannot be combined with manual initial transcript inputs"
            )
        prior_run = Path(resume_run_dir).resolve()
        if prior_run == out.resolve():
            raise ValueError("resume_run_dir and run_dir must be different")
        if not prior_run.is_dir():
            raise FileNotFoundError(f"resume run not found: {prior_run}")
        prior_transcript_rows = _read_jsonl_rows(prior_run / "transcript.jsonl")
        if not prior_transcript_rows:
            raise ValueError("resume run has no completed transcript.jsonl")
        prior_invocation_rows = _read_jsonl_rows(
            prior_run / "runner-invocations.jsonl"
        )
        if not prior_invocation_rows:
            raise ValueError("resume run has no runner-invocations.jsonl evidence")
        prior_metadata_value = _read_json(prior_run / "playtest.json", {})
        prior_metadata = (
            prior_metadata_value if isinstance(prior_metadata_value, dict) else {}
        )
        prior_identity = coc_run_identity.read_artifact_run_identity(prior_run)
        prior_metadata_run = prior_metadata.get("run_id")
        if prior_identity is not None:
            if prior_identity["campaign_id"] != campaign_id:
                raise RunIdentityError(
                    "resume artifact belongs to a different campaign"
                )
            if (
                prior_metadata_run is not None
                and prior_metadata_run != prior_identity["run_id"]
            ):
                raise RunIdentityError(
                    "resume artifact metadata conflicts with its run identity"
                )
            prior_metadata_run = prior_identity["run_id"]
        prior_current_run_id = coc_run_identity.normalize_run_id(
            prior_metadata_run
        )
        raw_prior_ids = prior_metadata.get("cumulative_run_ids")
        if raw_prior_ids is None:
            raw_prior_ids = [prior_current_run_id]
        if not isinstance(raw_prior_ids, list):
            raise RunIdentityError(
                "resume artifact cumulative_run_ids must be a list"
            )
        prior_run_ids = [
            coc_run_identity.normalize_run_id(value) for value in raw_prior_ids
        ]
        if (
            not prior_run_ids
            or len(set(prior_run_ids)) != len(prior_run_ids)
            or prior_run_ids[-1] != prior_current_run_id
        ):
            raise RunIdentityError(
                "resume artifact has an invalid cumulative run chain"
            )
        initial_transcript_tail, initial_narration = _resume_tail_from_transcript(
            prior_transcript_rows,
            limit=transcript_tail_limit,
        )

    if run_id in prior_run_ids:
        raise RunIdentityError(
            "current artifact run_id already appears in the prior cumulative chain"
        )
    cumulative_run_ids = [*prior_run_ids, run_id]

    partial_transcript_path = out / "partial-transcript.jsonl"
    if partial_transcript_path.is_symlink():
        partial_transcript_path.unlink()
    partial_transcript_path.write_text("", encoding="utf-8")
    operator_issue_ledger_path = out / "operator-issue-ledger.jsonl"
    if operator_long_play:
        if operator_issue_ledger_path.is_symlink():
            operator_issue_ledger_path.unlink()
        operator_issue_ledger_path.write_text("", encoding="utf-8")
    match_id = run_id

    def _server_pool(path: Path | None):
        if path is None or path.suffix.lower() not in {".mjs", ".js"}:
            return None
        pool = worker_pool_mod.JsonlWorkerPool(
            command_factory=lambda _key: ["node", str(path), "--server"],
            cwd=path.parent,
            default_timeout_s=timeout_s,
        )
        _ACTIVE_WORKER_POOLS.append(pool)
        return pool

    player_worker_pool = _server_pool(runner)
    player_worker_key = {
        "session_id": f"live-match:{match_id}",
        "campaign_id": campaign_id,
        "match_id": match_id,
        "role": "player",
    }

    resume_tail: list[dict[str, str]] = []
    for item in initial_transcript_tail or []:
        if not isinstance(item, dict):
            raise ValueError("initial_transcript_tail entries must be objects")
        role = item.get("role")
        text = item.get("text")
        if (
            role not in {"player", "keeper"}
            or not isinstance(text, str)
            or not text.strip()
        ):
            raise ValueError(
                "initial_transcript_tail entries require player/keeper role and text"
            )
        resume_tail.append({"role": role, "text": text})
    if initial_narration is not None and (
        not isinstance(initial_narration, str) or not initial_narration.strip()
    ):
        raise ValueError("initial_narration must be a non-empty string")

    turns: list[dict[str, Any]] = []
    player_turns: list[dict[str, Any]] = []
    player_requests: list[dict[str, Any]] = []
    player_choices: list[dict[str, Any]] = []
    transcript_tail: list[dict[str, Any]] = list(resume_tail)
    recent_narrations: list[str] = [
        item["text"] for item in resume_tail if item["role"] == "keeper"
    ][-2:]
    invocation_rows: list[dict[str, Any]] = []
    tension_curve: list[Any] = []
    scene_path: list[str] = []
    stop_reason = "max_turns_reached"
    pending_resolution: dict[str, Any] | None = None
    last_turn: dict[str, Any] | None = None
    fallback_turns = 0
    operator_provider = operator_player_provider or _operator_player_turn_stdio

    campaign_meta = _read_json(camp / "campaign.json", {})
    module_meta = _read_json(camp / "scenario" / "module-meta.json", {})
    play_language = str(
        campaign_meta.get("play_language") if isinstance(campaign_meta, dict) else "zh-Hans"
    ) or "zh-Hans"
    scenario_identity = str(
        (module_meta.get("scenario_id") if isinstance(module_meta, dict) else None)
        or (campaign_meta.get("scenario_id") if isinstance(campaign_meta, dict) else None)
        or (
            campaign_meta.get("active_scenario_id")
            if isinstance(campaign_meta, dict)
            else None
        )
        or campaign_id
    )
    story = _read_json(camp / "scenario" / "story-graph.json", {"scenes": []})
    current_playability = investigator_playability(camp, investigator_id)
    events_path = camp / "logs" / "events.jsonl"
    # Session-ending rows are durable campaign history. A resumed live run
    # must react only to a boundary written during this run; otherwise an old
    # cliffhanger makes every continuation stop after its first turn.
    run_event_start_index = len(_read_jsonl_rows(events_path))
    toolbox_log = camp / "logs" / "toolbox-calls.jsonl"
    rolls_log = camp / "logs" / "rolls.jsonl"
    # Even a no-roll session needs an authoritative zero-roll source for the
    # Dice Completeness Gate.  Tool calls append synchronously to this file.
    _ensure_jsonl_source(rolls_log)

    for _offset in range(max(1, int(max_turns))):
        current_playability = investigator_playability(camp, investigator_id)
        playability_stop = _playability_stop_reason(current_playability)
        if playability_stop:
            stop_reason = playability_stop
            pending = current_playability.get("pending_resolution")
            pending_resolution = dict(pending) if isinstance(pending, dict) else None
            break

        narration = (
            initial_narration
            if not player_requests and initial_narration is not None
            else player_visible_narration(
                last_turn,
                camp,
                play_language=play_language,
            )
        )
        request = build_player_request(
            ws,
            campaign_id,
            narration=narration,
            character_card=build_player_character_view(
                character_card, camp, investigator_id
            ),
            transcript_tail=transcript_tail[-transcript_tail_limit:],
            persona_id=persona_id,
            persona_prompt_directives=persona_prompt_directives,
        )
        player_requests.append(json.loads(json.dumps(request, ensure_ascii=False)))

        player_started = time.monotonic()
        if operator_long_play:
            player_result = operator_provider(request)
        elif player_worker_pool is None:
            player_result = player_adapter.player_send_turn(
                request, runner_path=runner, timeout_s=timeout_s,
            )
        else:
            try:
                player_result = player_adapter.player_send_turn(
                    request,
                    runner_path=runner,
                    timeout_s=timeout_s,
                    worker_pool=player_worker_pool,
                    worker_key=player_worker_key,
                )
            except TypeError as exc:
                if "worker_pool" not in str(exc) and "worker_key" not in str(exc):
                    raise
                player_result = player_adapter.player_send_turn(
                    request, runner_path=runner, timeout_s=timeout_s,
                )
        player_duration_seconds = time.monotonic() - player_started
        player_response_mode = player_result.get("response_mode")
        invocation_rows.append(
            _invocation_row(
                run_dir=out,
                role="player",
                runner_path=runner,
                attempt=len(
                    [row for row in invocation_rows if row.get("role") == "player"]
                )
                + 1,
                outcome=("operator_input" if operator_long_play else "external_success"),
                model_identity=(
                    {"provider": "operator", "id": "human_or_codex"}
                    if operator_long_play
                    else player_result.get("model_identity")
                ),
                response_mode=player_response_mode,
                fallback_kind=(
                    "prose_degradation"
                    if player_response_mode == "prose_fallback"
                    else None
                ),
                duration_seconds=player_duration_seconds,
                usage=player_result.get("usage"),
            )
        )

        player_text = player_result["player_text"]
        player_notes = player_result.get("player_notes")
        turn_intent_class = player_result.get("intent_class") or intent_class
        turn_player_intent_rich = (
            player_result.get("player_intent_rich") or player_intent_rich
        )
        transcript_tail.append({"role": "player", "text": player_text})
        choice_record: dict[str, Any] = {
            "intent": player_text,
            "text": player_text,
            "player_text": player_text,
            "player_notes": player_notes,
            "intent_class": turn_intent_class,
            "player_intent_rich": turn_player_intent_rich,
            "response_mode": player_response_mode,
            "decision_ids": [],
        }
        if isinstance(player_result.get("pending_choice_response"), dict):
            choice_record["pending_choice_response"] = dict(
                player_result["pending_choice_response"]
            )
        player_choices.append(choice_record)

        toolbox_offset = _file_byte_size(toolbox_log)
        rolls_offset = _file_byte_size(rolls_log)
        world_before = _read_json(camp / "save" / "world-state.json", {})
        if not isinstance(world_before, dict):
            world_before = {}
        scene_before = world_before.get("active_scene_id")
        clues_before = {
            str(item)
            for item in (world_before.get("discovered_clue_ids") or [])
            if item is not None and str(item)
        }

        keeper_request = {
            "workspace": str(ws),
            "campaign_id": campaign_id,
            "run_id": run_id,
            "investigator_id": investigator_id,
            "player_input": player_text,
            "play_language": play_language,
            "transcript_tail": transcript_tail[-transcript_tail_limit:],
            "run_policy": (
                "continue_until_scenario_terminal"
                if operator_long_play
                else "single_session"
            ),
        }
        keeper_started = time.monotonic()
        try:
            keeper_result = keeper_adapter.keeper_send_turn(
                keeper_request,
                runner_path=keeper_path,
                timeout_s=timeout_s,
            )
        except RuntimeError as exc:
            invocation_rows.append(
                _invocation_row(
                    run_dir=out,
                    role="narrator",
                    runner_path=keeper_path,
                    attempt=len(
                        [row for row in invocation_rows if row.get("role") == "narrator"]
                    )
                    + 1,
                    outcome="runner_failure",
                    model_identity=None,
                    response_mode=None,
                    fallback_kind=None,
                    duration_seconds=time.monotonic() - keeper_started,
                    failure_receipt={
                        "schema_version": 1,
                        "class": "runner_failure",
                        "summary": str(exc)[:500],
                        "retryable": False,
                    },
                )
            )
            stop_reason = "keeper_turn_failed"
            break
        keeper_duration_seconds = time.monotonic() - keeper_started
        keeper_text = keeper_result["narration"]
        keeper_model_identity = keeper_result.get("model_identity")
        invocation_rows.append(
            _invocation_row(
                run_dir=out,
                role="narrator",
                runner_path=keeper_path,
                attempt=len(
                    [row for row in invocation_rows if row.get("role") == "narrator"]
                )
                + 1,
                outcome="external_success",
                model_identity=keeper_model_identity,
                response_mode="keeper_agent",
                fallback_kind=None,
                duration_seconds=keeper_duration_seconds,
                usage=keeper_result.get("usage"),
            )
        )

        world_after = _read_json(camp / "save" / "world-state.json", {})
        if not isinstance(world_after, dict):
            world_after = {}
        pacing_after = _read_json(camp / "save" / "pacing-state.json", {})
        if not isinstance(pacing_after, dict):
            pacing_after = {}
        tool_rows = _jsonl_rows_after(toolbox_log, toolbox_offset)
        roll_rows = _jsonl_rows_after(rolls_log, rolls_offset)
        turn = _project_keeper_match_turn(
            turn_num=len(turns) + 1,
            player_text=player_text,
            keeper_text=keeper_text,
            scene_before=scene_before,
            world_after=world_after,
            pacing_after=pacing_after,
            tool_rows=tool_rows,
            roll_rows=roll_rows,
            clues_before=clues_before,
        )
        turns.append(turn)
        last_turn = turn
        current_scene = turn.get("scene_id") or "?"
        if not scene_path or scene_path[-1] != current_scene:
            scene_path.append(str(current_scene))
        tension_curve.append(turn.get("tension") or "low")
        choice_record["decision_ids"] = [turn["decision_id"]]
        player_turns.append(
            {
                "player_text": player_text,
                "player_notes": player_notes,
                "intent_class": turn_intent_class,
                "player_intent_rich": turn_player_intent_rich,
                "response_mode": player_response_mode,
                "live_result": {
                    "final_state": {
                        "active_scene": world_after.get("active_scene_id"),
                        "tension": pacing_after.get("tension_level"),
                    },
                },
            }
        )

        transcript_tail.append({"role": "keeper", "text": keeper_text})
        recent_narrations.append(keeper_text)
        if len(recent_narrations) > 2:
            recent_narrations = recent_narrations[-2:]
        _append_jsonl_fsync(
            partial_transcript_path,
            {
                "schema_version": 1,
                "record_type": "completed_player_keeper_turn",
                "decision_id": turn["decision_id"],
                "scene_before_id": scene_before,
                "scene_after_id": world_after.get("active_scene_id"),
                "transition_committed": bool(turn.get("scene_transition")),
                "player_text": player_text,
                "keeper_text": keeper_text,
                "narrator_method": "keeper_agent",
                "narrator_attestation": {
                    "model_identity": keeper_model_identity,
                    "response_mode": "keeper_agent",
                    "outcome": "external_success",
                },
                "grounding_receipt": {
                    "schema_version": 1,
                    "source": "keeper_agent",
                    "guard_applied": False,
                },
                "completed_at": _utc_timestamp(),
            },
        )

        current_event_rows = _read_jsonl_rows(events_path)
        turn_terminal = coc_scene_graph.terminal_evidence(
            story, world_after, current_event_rows[run_event_start_index:]
        )
        if turn_terminal["session_ending"]:
            stop_reason = "session_ending"
            break

        current_playability = investigator_playability(camp, investigator_id)
        playability_stop = _playability_stop_reason(current_playability)
        if playability_stop:
            stop_reason = playability_stop
            pending = current_playability.get("pending_resolution")
            pending_resolution = dict(pending) if isinstance(pending, dict) else None
            break

    world_final = _read_json(camp / "save" / "world-state.json", {})
    if not isinstance(world_final, dict):
        world_final = {}
    discovered_final = world_final.get("discovered_clue_ids", [])
    current_playability = investigator_playability(camp, investigator_id)
    if pending_resolution is None:
        pending = current_playability.get("pending_resolution")
        pending_resolution = dict(pending) if isinstance(pending, dict) else None
    final_event_rows = _read_jsonl_rows(events_path)
    ending_evidence = coc_scene_graph.terminal_evidence(
        story, world_final, final_event_rows[run_event_start_index:]
    )
    campaign_ending_evidence = coc_scene_graph.terminal_evidence(
        story, world_final, final_event_rows
    )
    completion_receipts = build_completion_receipts(
        camp,
        story_graph=story,
        world_state=world_final,
        terminal_evidence=campaign_ending_evidence,
        scenario_id=scenario_identity,
    )
    clue_graph = _read_json(camp / "scenario" / "clue-graph.json", {"conclusions": []})
    total_clues: set[str] = set()
    for concl in clue_graph.get("conclusions", []) if isinstance(clue_graph, dict) else []:
        for cl in concl.get("clues", []) if isinstance(concl, dict) else []:
            if isinstance(cl, dict) and cl.get("clue_id"):
                total_clues.add(str(cl["clue_id"]))
    session_result: dict[str, Any] = {
        "campaign_id": campaign_id,
        "run_id": run_id,
        "cumulative_run_ids": cumulative_run_ids,
        "turns": turns,
        "final_state": {
            "active_scene": world_final.get("active_scene_id"),
            "discovered_clues": discovered_final,
            "tension": _read_json(camp / "save" / "pacing-state.json", {}).get(
                "tension_level"
            ),
        },
        "clue_coverage": {
            "discovered_count": (
                len(discovered_final) if isinstance(discovered_final, list) else 0
            ),
            "total_in_graph": len(total_clues),
            "discovered": discovered_final,
        },
        "tension_curve": tension_curve,
        "scene_path": scene_path,
        "reached_terminal": ending_evidence["reached_terminal"],
        "terminal_evidence": ending_evidence,
        "completion_receipts": completion_receipts,
        "investigator_playability": current_playability,
        "pipeline": "keeper_agent",
        "stop_reason": stop_reason,
        "player_turn_count": len(player_turns),
    }
    if pending_resolution is not None:
        session_result["pending_resolution"] = pending_resolution

    visited = world_final.get("visited_scene_ids") or scene_path
    session_result["visited_scene_ids"] = (
        list(visited) if isinstance(visited, list) else list(scene_path)
    )
    session_result["discovered_clue_ids"] = (
        list(discovered_final) if isinstance(discovered_final, list) else []
    )
    if coc_adherence is not None:
        session_result["npc_event_chain_binding"] = (
            coc_adherence.coc_npc_event_chain.build_artifact_binding(
                camp,
                artifact_run_id=run_id,
                cumulative_run_ids=cumulative_run_ids,
            )
        )
        # Preserve positively attested IDs plus a separate narrow legacy
        # projection.  Raw event payloads can contain keeper-only identity and
        # agenda data, so they are never copied into this public result.
        npc_evidence = coc_adherence.project_npc_engagement_evidence(
            final_event_rows
        )
        session_result["engaged_npc_ids"] = list(
            npc_evidence["authored_attested_npc_ids"]
        )
        session_result["npc_engagement_evidence"] = npc_evidence
        session_result["npc_engagement_coverage_contract"] = {
            "schema_version": 4,
            "semantics": "authored_identity_attestation",
            "producer": "coc_live_match",
            "projection_schema_version": 1,
            "usage": "display_only",
            "coverage_eligible": False,
            "legacy_raw_ids_included": False,
            "legacy_status": npc_evidence["status"],
            "evidence_digest": coc_adherence.coc_npc_identity.engagement_evidence_digest(
                npc_evidence
            ),
        }
    threat_state = _read_json(camp / "save" / "threat-state.json", {})
    if isinstance(threat_state, dict) and isinstance(threat_state.get("clocks"), dict):
        session_result["clocks"] = threat_state["clocks"]
        session_result["threat_state"] = threat_state

    narration_method = "keeper_agent"
    fallback_turns = 0

    narrative_adherence = None
    scenario_dir = camp / "scenario"
    if coc_adherence is not None and scenario_dir.is_dir():
        try:
            narrative_adherence = coc_adherence.compute_adherence_for_campaign(
                scenario_dir,
                session_result,
                campaign_dir=camp,
            )
        except Exception:
            narrative_adherence = None

    prior_coverage = (
        prior_metadata.get("module_coverage")
        if isinstance(prior_metadata.get("module_coverage"), list)
        else []
    )
    cumulative_coverage = list(dict.fromkeys(
        [str(value) for value in [*prior_coverage, *scene_path] if value]
    ))
    metadata_extra: dict[str, Any] = {
        "run_id": run_id,
        "cumulative_run_ids": cumulative_run_ids,
        "stop_reason": stop_reason,
        "module_coverage": cumulative_coverage,
        "scenario": (
            (module_meta.get("title") if isinstance(module_meta, dict) else None)
            or (campaign_meta.get("title") if isinstance(campaign_meta, dict) else None)
            or campaign_id
        ),
        "scenario_id": scenario_identity,
        "audit_profile": completion_receipts["audit_profile"],
        "module_source": (
            f"compiled scenario package: {module_meta.get('scenario_id')}"
            if isinstance(module_meta, dict) and module_meta.get("scenario_id")
            else "runtime campaign scenario"
        ),
        "play_language": play_language,
        "narration_method": narration_method,
        "fallback_turns": fallback_turns,
        "narrator_configured": True,
        "keeper_runner": str(keeper_path),
        "partial_transcript_path": "partial-transcript.jsonl",
        "operator_long_play": bool(operator_long_play),
        "operator_review_protocol": (
            OPERATOR_LONG_PLAY_PROTOCOL if operator_long_play else None
        ),
        "operator_review_status": "pending" if operator_long_play else "not_required",
        "continuation_of": prior_current_run_id,
        "transcript_scope": (
            "campaign_cumulative" if prior_run is not None else "run_local"
        ),
        "campaign_log_scope": "campaign_cumulative",
    }
    if rng_seed is not None:
        metadata_extra["rng_seed_hint"] = str(rng_seed)
    if operator_long_play:
        metadata_extra["operator_contract"] = {
            "schema_version": 2,
            "protocol": OPERATOR_LONG_PLAY_PROTOCOL,
            "module_scope": "any_compiled_module",
            "player": {
                "role": "main_codex_black_box_operator",
                "visibility": "kp_player_visible_request_only",
                "transport": OPERATOR_PLAYER_PROTOCOL,
                "harness_player_model_call": "none",
            },
            "reviewer": {
                "role": "same_main_codex_operator_self_review",
                "required_kind": "codex",
                "dimensions": ["rules", "facts", "progression", "style"],
            },
            "model_call_boundary": {
                "player": "none_by_harness",
                "kp_keeper_agent": "single_pass_production_model_under_test",
                "independent_player": "NOT_CONFIGURED",
                "independent_judge": "NOT_CONFIGURED",
                "independent_fact_verification": "NOT_RUN",
            },
            "long_run_issue_policy": {
                "schema_version": 1,
                "mode": "continue_and_accumulate_until_terminal_or_hard_blocker",
                "issue_ledger_path": operator_issue_ledger_path.name,
                "hard_stop_classes": [
                    "crash_or_cannot_continue",
                    "persistent_state_integrity",
                    "rules_integrity",
                    "spoiler_integrity",
                    "evidence_completeness",
                ],
                "deferred_single_occurrence_classes": [
                    "prose_or_style",
                    "transition_quality",
                    "compound_action_segmentation",
                    "other",
                ],
                "repeat_escalation": {
                    "scope": "issue_class",
                    "occurrence_threshold": 2,
                    "disposition": "stop_and_fix",
                },
                "batch_review_boundary": (
                    "structured_terminal_or_representative_long_segment"
                ),
            },
        }
    if narrative_adherence is not None:
        metadata_extra["narrative_adherence"] = narrative_adherence

    metadata = _match_metadata(
        user_claimed_live=live,
        campaign_id=campaign_id,
        extra=metadata_extra,
    )
    battle_path = playtest_driver.write_playtest_artifacts(
        out,
        camp,
        char_path,
        investigator_id,
        player_choices,
        session_result,
        metadata=metadata,
        generate_report=False,
        character_snapshot=character_card,
    )
    partial_rows = _read_jsonl_rows(partial_transcript_path)
    final_transcript_rows = _read_jsonl_rows(out / "transcript.jsonl")
    final_keeper_texts = [
        str(row.get("text") or "")
        for row in final_transcript_rows
        if row.get("role") in {"keeper", "keeper_under_test"}
    ]
    if [str(row.get("keeper_text") or "") for row in partial_rows] != final_keeper_texts:
        raise RuntimeError("partial transcript diverges from completed keeper transcript")
    for row in partial_rows:
        if (
            not row.get("decision_id")
            or not isinstance(row.get("narrator_attestation"), dict)
            or not isinstance(row.get("grounding_receipt"), dict)
        ):
            raise RuntimeError(
                "partial transcript row lacks decision or narrator attestation"
            )
    _enrich_transcript_with_player_notes(out, player_turns)
    if prior_run is not None:
        current_transcript_rows = _read_jsonl_rows(out / "transcript.jsonl")
        _write_jsonl_rows_atomic(
            out / "transcript.jsonl",
            _renumber_appended_rows(prior_transcript_rows, current_transcript_rows),
        )

        prior_driver = _read_json(prior_run / "driver-result.json", {})
        current_driver = _read_json(out / "driver-result.json", {})
        if isinstance(prior_driver, dict) and isinstance(current_driver, dict):
            merged_driver = deepcopy(current_driver)
            merged_driver["turns"] = [
                *(
                    deepcopy(prior_driver.get("turns"))
                    if isinstance(prior_driver.get("turns"), list)
                    else []
                ),
                *(
                    deepcopy(current_driver.get("turns"))
                    if isinstance(current_driver.get("turns"), list)
                    else []
                ),
            ]
            merged_driver["scene_path"] = list(dict.fromkeys(
                [
                    str(value)
                    for value in [
                        *(
                            prior_driver.get("scene_path")
                            if isinstance(prior_driver.get("scene_path"), list)
                            else []
                        ),
                        *(
                            current_driver.get("scene_path")
                            if isinstance(current_driver.get("scene_path"), list)
                            else []
                        ),
                    ]
                    if value
                ]
            ))
            merged_driver["continuation_of"] = prior_current_run_id
            _write_json_atomic(out / "driver-result.json", merged_driver)

    _ = evidence_provenance
    combined_invocations = [
        *[deepcopy(row) for row in prior_invocation_rows],
        *invocation_rows,
    ]
    attempts_by_role: dict[str, int] = {}
    for row in combined_invocations:
        role = str(row.get("role") or "")
        attempts_by_role[role] = attempts_by_role.get(role, 0) + 1
        row["attempt"] = attempts_by_role[role]
    invocation_ledger_path = _write_invocation_ledger(out, combined_invocations)
    target_log_dir = out / "sandbox" / ".coc" / "campaigns" / campaign_id / "logs"
    event_log_paths = [
        path.resolve().relative_to(out.resolve()).as_posix()
        for path in sorted(target_log_dir.glob("*.jsonl"))
        if path.is_file()
    ]
    evidence_receipt = playtest_evidence.build_evidence_receipt(
        out,
        {
            "started_at": started_at,
            "ended_at": _utc_timestamp(),
            "user_claimed_live": bool(live),
            "operator_long_play": bool(operator_long_play),
            "transcript_path": "transcript.jsonl",
            "invocation_ledger_path": invocation_ledger_path.name,
            "event_log_paths": event_log_paths,
        },
    )
    evidence_path = playtest_evidence.write_evidence_receipt(out, evidence_receipt)
    evidence_receipt = playtest_evidence.read_evidence_receipt(out)
    receipt_runners = evidence_receipt.get("runners") or {}
    receipt_player = receipt_runners.get("player") or {}
    receipt_narrator = receipt_runners.get("narrator") or {}
    eligible = evidence_receipt.get("eligible_as_gameplay_evidence") is True
    fallback_turns = int(evidence_receipt.get("fallback_turns") or 0)
    metadata.update(
        {
            "runner_kind": receipt_player.get("kind") or "unknown",
            "narrator_runner_kind": receipt_narrator.get("kind") or "absent",
            "eligible_as_gameplay_evidence": eligible,
            "evidence_reasons": list(evidence_receipt.get("evidence_reasons") or []),
            "external_model_turns": evidence_receipt.get("external_model_turns", 0),
            "fallback_turns": fallback_turns,
        }
    )
    if operator_long_play:
        metadata.update(
            {
                "eligible_as_gameplay_evidence": False,
                "simulation_method": "operator_long_play_pending_review",
                "player_profile": "operator_player",
                "evidence_disclaimer": (
                    "Operator long-play evidence is pending structured review; "
                    "it is not an official nightly or release PASS."
                ),
                "evidence_reasons": list(
                    dict.fromkeys(
                        [
                            *(metadata.get("evidence_reasons") or []),
                            "operator_review_required",
                        ]
                    )
                ),
            }
        )
        eligible = False
    if eligible:
        metadata.update(
            {
                "player_profile": "attested_external_model_bridge",
                "simulation_method": "attested_external_model_playtest",
                "evidence_disclaimer": (
                    "Gameplay evidence eligibility verified from evidence.json."
                ),
                "future_enhancements": [],
            }
        )

    playtest_path = out / "playtest.json"
    stamped = _read_json(playtest_path, {})
    if not isinstance(stamped, dict):
        stamped = {}
    stamped.pop("live", None)
    stamped.update(metadata)
    stamped.update(
        {
            "stop_reason": stop_reason,
            "investigator_playability": current_playability,
            "pending_resolution": pending_resolution,
            "terminal_evidence": ending_evidence,
            "reached_terminal": ending_evidence["reached_terminal"],
            "narration_method": narration_method,
            "fallback_turns": fallback_turns,
        }
    )
    if narrative_adherence is not None:
        stamped["narrative_adherence"] = narrative_adherence
    playtest_path.write_text(
        json.dumps(stamped, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    (out / "player-requests.json").write_text(
        json.dumps(player_requests, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    (out / "match-result.json").write_text(
        json.dumps(
            {
                **session_result,
                "simulation_method": metadata["simulation_method"],
                "runner_kind": metadata["runner_kind"],
                "user_claimed_live": bool(live),
                "eligible_as_gameplay_evidence": eligible,
                "evidence_reasons": metadata["evidence_reasons"],
                "narration_method": narration_method,
                "fallback_turns": fallback_turns,
                "operator_review_status": metadata.get("operator_review_status"),
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    battle_path = playtest_report.generate_battle_report(out)
    # Live-match output is not complete until the versioned report contract
    # injects source-traceable roll markers and writes its completeness receipt.
    report_contract = coc_eval_contract.compile_report_contract(
        out, generate_base_report=False
    )
    report_contract = coc_eval_contract.verify_report_contract(out)
    contract_report = report_contract.get("report_path")
    if isinstance(contract_report, str) and contract_report:
        battle_path = Path(contract_report)

    if player_worker_pool is not None:
        player_worker_pool.close()
    return {
        "run_dir": str(out),
        "battle_report_path": str(battle_path),
        "report_contract": report_contract,
        "evidence_path": str(evidence_path),
        "evidence": evidence_receipt,
        "turns": turns,
        "player_turns": player_turns,
        "player_requests": player_requests,
        "player_choices": player_choices,
        "metadata": metadata,
        "result": session_result,
        "stop_reason": stop_reason,
        "investigator_playability": current_playability,
        "pending_resolution": pending_resolution,
        "terminal_evidence": ending_evidence,
        "narration_method": narration_method,
        "fallback_turns": fallback_turns,
    }


def run_live_match(*args: Any, **kwargs: Any) -> dict[str, Any]:
    """Run a match and always clean persistent adapter workers on exit."""
    start = len(_ACTIVE_WORKER_POOLS)
    try:
        return _run_live_match_impl(*args, **kwargs)
    finally:
        for pool in _ACTIVE_WORKER_POOLS[start:]:
            try:
                pool.close()
            finally:
                if pool in _ACTIVE_WORKER_POOLS:
                    _ACTIVE_WORKER_POOLS.remove(pool)


def _main() -> int:
    ap = argparse.ArgumentParser(
        description="Live LLM-player vs Keeper-agent match harness (N5)"
    )
    ap.add_argument("--workspace", required=True, help="workspace root containing .coc/")
    ap.add_argument("--campaign", required=True, dest="campaign_id")
    ap.add_argument("--investigator", default="inv1", dest="investigator_id")
    ap.add_argument("--runner", default=None, help="player-brain runner executable or .mjs")
    ap.add_argument(
        "--operator-long-play",
        action="store_true",
        help=(
            f"use {OPERATOR_PLAYER_PROTOCOL} JSONL stdin/stdout for the main Codex "
            "black-box player; keeper agent is single-pass and the same Codex reviews it"
        ),
    )
    ap.add_argument(
        "--keeper-runner",
        default=None,
        help="keeper coding-agent runner (.mjs or executable; default: runtime keeper adapter)",
    )
    ap.add_argument(
        "--narrator-runner",
        default=None,
        help="deprecated alias for --keeper-runner",
    )
    ap.add_argument("--max-turns", type=int, default=20)
    ap.add_argument("--rng-seed", default=None)
    ap.add_argument(
        "--live",
        action="store_true",
        help="record a user claim that this is live; does not attest evidence eligibility",
    )
    ap.add_argument("--character", default=None, help="override character.json path")
    ap.add_argument("--run-dir", default=None, help="output playtest directory")
    ap.add_argument(
        "--resume-run",
        default=None,
        help=(
            "prior completed playtest run; seeds the Keeper/player context and "
            "builds a cumulative transcript/evidence chain"
        ),
    )
    ap.add_argument("--intent-class", default=None, help="optional intent_class override")
    ap.add_argument("--timeout", type=float, default=300)
    ap.add_argument(
        "--resolve-player-actions",
        action="store_true",
        help="legacy no-op; the keeper agent interprets player actions itself",
    )
    args = ap.parse_args()
    if bool(args.operator_long_play) == bool(args.runner):
        ap.error("choose exactly one of --runner or --operator-long-play")

    rng_seed: int | str | None = args.rng_seed
    if rng_seed is not None:
        try:
            rng_seed = int(rng_seed)
        except ValueError:
            pass

    result = run_live_match(
        args.workspace,
        args.campaign_id,
        args.investigator_id,
        player_runner=args.runner,
        max_turns=args.max_turns,
        rng_seed=rng_seed,
        live=bool(args.live),
        character_path=args.character,
        run_dir=args.run_dir,
        resume_run_dir=args.resume_run,
        intent_class=args.intent_class,
        timeout_s=args.timeout,
        keeper_runner=args.keeper_runner,
        narrator_runner=args.narrator_runner,
        resolve_player_actions=bool(args.resolve_player_actions),
        operator_long_play=bool(args.operator_long_play),
    )
    print(f"stop_reason: {result['stop_reason']}")
    print(f"player_turns: {len(result['player_turns'])}")
    print(f"kp_turns: {len(result['turns'])}")
    print(f"battle_report: {result['battle_report_path']}")
    print(f"simulation_method: {result['metadata']['simulation_method']}")
    print(f"narration_method: {result.get('narration_method')}")
    print(f"fallback_turns: {result.get('fallback_turns')}")
    print(
        "eligible_as_gameplay_evidence: "
        f"{result['metadata']['eligible_as_gameplay_evidence']}"
    )
    print(f"evidence: {result['evidence_path']}")
    return 0


if __name__ == "__main__":
    sys.exit(_main())
