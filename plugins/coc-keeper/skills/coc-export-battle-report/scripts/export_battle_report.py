#!/usr/bin/env python3
"""Build the final player-readable battle report from one real playtest run."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import tempfile
from collections import Counter
from pathlib import Path
from typing import Any


SCHEMA_VERSION = 5
JSON_OUTPUT = "battle-report-evidence.json"
MARKDOWN_OUTPUT = "battle-report.md"
METADATA_CANDIDATES = ("run.json", "playtest.json")
KEEPER_ROLES = {"keeper", "keeper_under_test", "kp", "narrator"}
PLAYER_ROLES = {"player", "player_simulator"}
DIALOGUE_ROLES = KEEPER_ROLES | PLAYER_ROLES
PUBLIC_VISIBILITIES = {"public", "consequence_public"}
# Corrected settlements remain in the audit log but must not reappear as
# player-facing battle-report dice or HP chains.
HIDDEN_PUBLIC_VISIBILITIES = {"superseded", "voided", "corrected_hidden"}
MARKDOWN_HIDDEN_KEYS = {
    "clue_graph",
    "keeper_notes",
    "keeper_secret",
    "module_truth",
    "npc_agendas",
    "notes",
    "private_notes",
    "scenario_id",
    "scenario_truth",
    "secret",
}


class ExportError(RuntimeError):
    """Raised when source or destination safety prevents an honest export."""


def _canonical_bytes(value: Any) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")


def _pretty_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2)


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _safe_source_path(run_dir: Path, relative: str) -> Path:
    relative_path = Path(relative)
    if relative_path.is_absolute() or ".." in relative_path.parts:
        raise ExportError(f"source path escapes run directory: {relative}")
    candidate = run_dir / relative_path
    try:
        candidate.resolve(strict=False).relative_to(run_dir.resolve())
    except ValueError as exc:
        raise ExportError(f"source path escapes run directory: {relative}") from exc
    return candidate


def _read_source(
    run_dir: Path,
    relative: str,
    kind: str,
    manifest: dict[str, dict[str, Any]],
    *,
    required: bool = False,
) -> Any:
    path = _safe_source_path(run_dir, relative)
    entry: dict[str, Any] = {
        "kind": kind,
        "path": relative,
        "present": False,
        "required": required,
    }
    manifest[relative] = entry
    if not path.exists():
        entry["status"] = "MISSING"
        return None
    if path.is_symlink() or not path.is_file():
        entry["status"] = "UNSAFE"
        entry["error"] = "source must be a regular non-symlink file"
        if required:
            raise ExportError(f"unsafe required source: {relative}")
        return None

    raw = path.read_bytes()
    entry.update(
        {
            "byte_count": len(raw),
            "present": True,
            "sha256": _sha256(raw),
            "status": "READ",
        }
    )
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise ExportError(f"source is not UTF-8: {relative}") from exc

    try:
        if kind == "jsonl":
            rows = [json.loads(line) for line in text.splitlines() if line.strip()]
            entry["record_count"] = len(rows)
            return rows
        value = json.loads(text)
    except json.JSONDecodeError as exc:
        raise ExportError(
            f"invalid {kind} source {relative}: line {exc.lineno}, column {exc.colno}"
        ) from exc
    entry["record_count"] = len(value) if isinstance(value, list) else 1
    return value


def _party_ids(party: Any) -> list[str]:
    if not isinstance(party, dict):
        return []
    result: list[str] = []
    for key in ("investigator_ids", "active_investigator_ids", "investigators", "members"):
        values = party.get(key)
        if not isinstance(values, list):
            continue
        for value in values:
            if isinstance(value, str):
                investigator_id = value
            elif isinstance(value, dict):
                investigator_id = value.get("investigator_id") or value.get("id")
            else:
                investigator_id = None
            normalized = str(investigator_id) if investigator_id is not None else None
            if normalized and normalized not in result:
                result.append(normalized)
    return result


def _campaign_relative(run_dir: Path, metadata: Any) -> str | None:
    campaigns = run_dir / "sandbox" / ".coc" / "campaigns"
    campaign_id = metadata.get("campaign_id") if isinstance(metadata, dict) else None
    if campaign_id:
        relative = f"sandbox/.coc/campaigns/{campaign_id}"
        candidate = _safe_source_path(run_dir, relative)
        if candidate.is_dir() and not candidate.is_symlink():
            return relative
    if not campaigns.is_dir() or campaigns.is_symlink():
        return None
    choices = sorted(
        path for path in campaigns.iterdir() if path.is_dir() and not path.is_symlink()
    )
    return choices[0].relative_to(run_dir).as_posix() if len(choices) == 1 else None


def _is_dialogue_row(row: Any) -> bool:
    return (
        isinstance(row, dict)
        and isinstance(row.get("role"), str)
        and row["role"].casefold() in DIALOGUE_ROLES
        and isinstance(row.get("text"), str)
    )


def _dialogue_side(row: Any) -> str | None:
    if not _is_dialogue_row(row) or not row["text"].strip():
        return None
    return "keeper" if row["role"].casefold() in KEEPER_ROLES else "player"


def _card_status(value: Any) -> str:
    if value is None:
        return "MISSING"
    if not isinstance(value, dict) or not value:
        return "INVALID"
    return "PRESENT"


def _roll_visibility(row: Any) -> str:
    if not isinstance(row, dict):
        return "unknown"
    payload = row.get("payload")
    for source in (row, payload if isinstance(payload, dict) else {}):
        if source.get("superseded") is True or source.get("voided") is True:
            return "superseded"
        if source.get("player_facing") is False:
            return "superseded"
        value = source.get("visibility")
        if isinstance(value, str):
            return value
    return "public" if row.get("secret") is not True else "keeper_only"


def _roll_id(row: Any) -> str | None:
    if not isinstance(row, dict):
        return None
    payload = row.get("payload")
    for source in (row, payload if isinstance(payload, dict) else {}):
        value = source.get("roll_id")
        if isinstance(value, str) and value.strip():
            return value
    return None


def _roll_skill(row: Any) -> str | None:
    if not isinstance(row, dict):
        return None
    payload = row.get("payload")
    for source in (row, payload if isinstance(payload, dict) else {}):
        value = source.get("skill")
        if isinstance(value, str) and value.strip():
            return value
    return None


def _clue_graph_rows(clue_graph: Any) -> list[dict[str, Any]]:
    """Structured clue rows only; clue content is never projected into outputs."""
    if not isinstance(clue_graph, dict):
        return []
    rows: list[dict[str, Any]] = []
    conclusions = clue_graph.get("conclusions")
    for conclusion in conclusions if isinstance(conclusions, list) else []:
        if not isinstance(conclusion, dict):
            continue
        clues = conclusion.get("clues")
        for clue in clues if isinstance(clues, list) else []:
            if isinstance(clue, dict) and isinstance(clue.get("clue_id"), str):
                rows.append(clue)
    return rows


def _is_numeric(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _has_numeric_roll(row: Any) -> bool:
    if not isinstance(row, dict):
        return False
    payload = row.get("payload")
    if isinstance(payload, dict):
        dice = payload.get("dice")
        if isinstance(dice, dict) and _is_numeric(dice.get("total")):
            return True
    for source in (row, payload if isinstance(payload, dict) else {}):
        for key in ("roll", "rolls", "total", "result", "value"):
            value = source.get(key)
            if _is_numeric(value):
                return True
            if isinstance(value, list) and value and all(
                _is_numeric(item) for item in value
            ):
                return True
    return False


def _hidden_key(key: Any) -> bool:
    normalized = str(key).casefold()
    return (
        normalized in MARKDOWN_HIDDEN_KEYS
        or normalized.startswith(("keeper_", "private_", "hidden_", "secret_"))
        or normalized.endswith("_secret")
    )


def _player_safe(value: Any) -> Any:
    if isinstance(value, dict):
        if value.get("secret") is True or value.get("visibility") == "keeper_only":
            return {"redacted": True}
        return {
            str(key): _player_safe(child)
            for key, child in value.items()
            if not _hidden_key(key)
        }
    if isinstance(value, list):
        return [_player_safe(item) for item in value]
    return value


def _pick(mapping: Any, keys: tuple[str, ...]) -> dict[str, Any]:
    """Explicit allowlist projection; unlike _player_safe this defines a source contract."""
    if not isinstance(mapping, dict):
        return {}
    return {key: mapping[key] for key in keys if key in mapping}


def _character_projection(character: Any, creation: Any) -> dict[str, Any] | None:
    if not isinstance(character, dict):
        return None
    projected = _pick(character, (
        "id", "name", "display_name", "occupation", "profession", "era", "age",
        "sex", "residence", "birthplace", "characteristics", "derived", "skills",
        "weapons", "equipment", "backstory", "credit_rating", "cash",
        "player_facing_sheet_zh",
    ))
    if isinstance(creation, dict):
        projected["creation"] = _pick(creation, ("method", "status", "age"))
    sheet = character.get("player_facing_sheet_zh")
    if isinstance(sheet, dict):
        projected["nationality"] = sheet.get("nationality")
        initial_skills = {}
        skill_rows = []
        for row in sheet.get("skills", []) if isinstance(sheet.get("skills"), list) else []:
            if isinstance(row, dict) and isinstance(row.get("key"), str) and _is_numeric(row.get("value")):
                initial_skills[row["key"]] = row["value"]
                skill_rows.append(_pick(row, ("key", "label", "value", "half", "fifth")))
        if initial_skills:
            projected["initial_skills"] = initial_skills
            projected["initial_skill_rows"] = skill_rows
    if "initial_skills" not in projected and isinstance(character.get("skills"), dict):
        projected["initial_skills"] = character["skills"]
    if "initial_skills" in projected:
        projected["skills"] = projected["initial_skills"]
    return projected


def _state_projection(state: Any) -> dict[str, Any] | None:
    if not isinstance(state, dict):
        return None
    projected = _pick(state, (
        "investigator_id", "name", "display_name", "current_hp", "current_san",
        "current_mp", "current_luck", "hp", "san", "mp", "luck", "conditions",
        "indefinite_insane", "temporary_insane", "permanently_insane", "bout_active",
        "phobia", "mania",
    ))
    hooks = state.get("personal_horror_hooks")
    if isinstance(hooks, list):
        projected["personal_horror_hooks"] = [
            _pick(hook, ("hook_id", "backstory_field", "summary", "woven", "payoff", "payoff_summary"))
            for hook in hooks if isinstance(hook, dict)
        ]
    return projected


def _progression_projection(world: Any, flags: Any) -> dict[str, Any]:
    world = world if isinstance(world, dict) else {}
    flags = flags if isinstance(flags, dict) else {}
    found = flags.get("clues_found") if isinstance(flags.get("clues_found"), dict) else {}
    discovered = world.get("discovered_clue_ids") if isinstance(world.get("discovered_clue_ids"), list) else list(found)
    clues = []
    for clue_id in discovered:
        if not isinstance(clue_id, str):
            continue
        receipt = found.get(clue_id) if isinstance(found.get(clue_id), dict) else {}
        clues.append({"clue_id": clue_id, **_pick(receipt, ("method", "ts"))})
    history = []
    for row in world.get("scene_history", []) if isinstance(world.get("scene_history"), list) else []:
        if isinstance(row, dict):
            history.append(_pick(row, ("scene_id", "decision_id", "entered_at_decision_id", "ts")))
    visited = [item for item in world.get("visited_scene_ids", []) if isinstance(item, str)] if isinstance(world.get("visited_scene_ids"), list) else []
    return {
        "visited_scene_ids": visited,
        "scene_history": history,
        "discovered_clues": clues,
        "major_decisions": [
            _pick(row, ("decision_id", "scene_id", "summary", "choice", "consequence", "ts"))
            for row in world.get("major_decisions", [])
            if isinstance(row, dict)
        ] if isinstance(world.get("major_decisions"), list) else [],
    }


def _npc_projection(receipts: Any) -> list[dict[str, Any]]:
    """Never project identity_contract: it is keeper-only even when it contains a name."""
    source = receipts.get("receipts") if isinstance(receipts, dict) else None
    if not isinstance(source, dict):
        return []
    result = []
    for receipt in source.values():
        if not isinstance(receipt, dict):
            continue
        event = receipt.get("event") if isinstance(receipt.get("event"), dict) else {}
        row = _pick(event, ("event_id", "decision_id", "npc_id", "scene_id", "interaction_kind", "ts"))
        if row:
            result.append(row)
    return result


def _first_impression_projection(
    document: Any, npc_receipts: Any,
) -> list[dict[str, Any]]:
    """Player-safe frozen first impressions plus their first-contact realization."""
    source = document.get("receipts") if isinstance(document, dict) else None
    engagement_source = (
        npc_receipts.get("receipts") if isinstance(npc_receipts, dict) else None
    )
    contexts: dict[str, dict[str, Any]] = {}
    for engagement in (
        engagement_source.values() if isinstance(engagement_source, dict) else []
    ):
        event = engagement.get("event") if isinstance(engagement, dict) else None
        effect = event.get("context_effect") if isinstance(event, dict) else None
        ref = event.get("first_impression_ref") if isinstance(event, dict) else None
        if isinstance(ref, str) and isinstance(effect, dict):
            contexts[ref] = effect
    projected: list[dict[str, Any]] = []
    for receipt in source.values() if isinstance(source, dict) else []:
        if not isinstance(receipt, dict):
            continue
        row = _pick(receipt, (
            "schema_version", "receipt_id", "investigator_id", "npc_id",
            "npc_display_name", "app",
            "credit_rating", "governing_attribute", "governing_value", "roll_id",
            "required_level", "achieved_level", "outcome", "passed",
            "reaction_tier", "rule_ref",
        ))
        roll_record = receipt.get("roll_record")
        if isinstance(roll_record, dict) and _is_numeric(roll_record.get("roll")):
            row["roll"] = roll_record["roll"]
        context = contexts.get(str(receipt.get("receipt_id") or ""))
        if isinstance(context, dict):
            row["realization"] = _pick(context, (
                "observable_manner", "causal_explanation", "boundary_preserved",
                "opportunity_or_friction",
            ))
        elif receipt.get("schema_version") == 1:
            # Preserve old campaign evidence without exposing its concealed die.
            row["legacy_contract"] = True
            row["realization"] = {
                "observable_manner": receipt.get("observable_manner"),
            }
        projected.append(row)
    return sorted(
        projected,
        key=lambda row: (
            str(row.get("investigator_id") or ""),
            str(row.get("npc_id") or ""),
        ),
    )


# Player-facing social skills (Psychology is a Keeper-concealed roll and is
# never listed). The view is a focused subset of the public-roll appendix.
SOCIAL_SKILLS = ("Charm", "Fast Talk", "Intimidate", "Persuade")


def _social_roll_projection(public_rolls: Any) -> list[dict[str, Any]]:
    """Focused player-safe view of public social-skill rolls, in log order."""
    if not isinstance(public_rolls, list):
        return []
    result = []
    for row in public_rolls:
        if not isinstance(row, dict):
            continue
        skill = _roll_skill(row)
        if skill not in SOCIAL_SKILLS:
            continue
        payload = row.get("payload") if isinstance(row.get("payload"), dict) else {}
        result.append({
            "roll_id": _roll_id(row),
            "skill": skill,
            "actor": _first_not_none(
                _first(row, ("actor", "investigator_id")),
                _first(payload, ("actor", "investigator_id")),
            ),
            "target": _first_not_none(
                _first(payload, ("effective_target", "target")),
                _first(row, ("effective_target", "target")),
            ),
            "roll": _first_not_none(
                _first(payload, ("roll", "total", "result", "value")),
                _first(row, ("roll", "total", "result", "value")),
            ),
            "outcome": _first_not_none(
                _first(payload, ("outcome", "success_level")),
                _first(row, ("outcome", "success_level")),
            ),
            "ts": row.get("ts"),
        })
    return result


def _ending_projection(events: Any) -> dict[str, Any] | None:
    if not isinstance(events, list):
        return None
    endings = [row for row in events if isinstance(row, dict) and row.get("event_type") == "session_ending"]
    if not endings:
        return None
    return _pick(endings[-1], ("ending_id", "scene_id", "kind", "summary", "decision_id", "investigator_ids", "ts", "settlement_capsule_ref"))


def _consequence_projection(events: Any, investigator_ids: list[str]) -> list[dict[str, Any]]:
    if not isinstance(events, list):
        return []
    allowed_types = {"hp_change", "sanity_loss", "combat_ended"}
    result = []
    for row in events:
        if not isinstance(row, dict) or row.get("event_type") not in allowed_types:
            continue
        if (
            row.get("superseded") is True
            or row.get("player_facing") is False
            or str(row.get("visibility") or "").casefold() in HIDDEN_PUBLIC_VISIBILITIES
            or row.get("superseded_correction") is True
        ):
            continue
        investigator_id = row.get("investigator_id")
        if investigator_id is not None and investigator_id not in investigator_ids:
            continue
        result.append(_pick(row, (
            "event_type", "investigator_id", "kind", "amount", "loss", "hp_before",
            "hp_after", "combat_id", "outcome", "ended_at_turn", "decision_id", "ts",
        )))
    return result


def _exceptional_effect_projection(document: Any) -> list[dict[str, Any]]:
    """Player-safe exceptional state; source rolls stay in keeper audit evidence."""
    effects = document.get("effects") if isinstance(document, dict) else None
    if not isinstance(effects, dict):
        return []
    projected = []
    for effect in effects.values():
        if not isinstance(effect, dict) or effect.get("visibility") == "keeper_only":
            continue
        row = _pick(effect, (
            "effect_id", "direction", "effect_kind", "player_visible_impact",
            "causal_link", "boundary", "mechanics", "visibility", "status",
            "created_at", "consumed_at", "consumed_by_roll_id",
        ))
        source_roll = effect.get("source_roll")
        if (
            isinstance(source_roll, dict)
            and source_roll.get("visibility") in PUBLIC_VISIBILITIES
            and isinstance(source_roll.get("roll_id"), str)
        ):
            row["source_roll_id"] = source_roll["roll_id"]
        projected.append(row)
    return sorted(projected, key=lambda row: str(row.get("effect_id") or ""))


def _settlement_projection(value: Any) -> dict[str, Any] | None:
    if not isinstance(value, dict):
        return None
    receipt = value.get("receipt") if isinstance(value.get("receipt"), dict) else {}
    result = receipt.get("result") if isinstance(receipt.get("result"), dict) else {}
    player_facing = (
        receipt.get("player_facing_mechanics")
        if isinstance(receipt.get("player_facing_mechanics"), dict)
        else result.get("player_facing_mechanics")
    )
    projected = {
        **_pick(value, ("ending_id", "investigator_id", "settled_at")),
        "status": receipt.get("status"),
        "improvement_checks": [
            _pick(row, ("skill", "check_roll", "gain", "value_before", "value_after", "improved", "applied_delta"))
            for row in result.get("improvement_checks", []) if isinstance(row, dict)
        ] if isinstance(result.get("improvement_checks"), list) else [],
        "luck_recovery": _pick(result.get("luck_recovery"), ("roll", "success", "gained", "luck_before", "luck_after")),
        "san_reward": _pick(result.get("scenario_san_reward") or result.get("san_reward"), ("expression", "rolls", "total", "san_before", "san_gained", "san_after")),
    }
    if isinstance(player_facing, dict):
        projected["player_facing_mechanics"] = _pick(
            player_facing,
            (
                "required_roll_ids", "rendered_lines", "rendered_text",
                "complete", "missing_roll_ids", "operation_id",
            ),
        )
    return projected


def _source_payload(run_dir: Path, *, allow_partial: bool) -> dict[str, Any]:
    manifest: dict[str, dict[str, Any]] = {}
    metadata_source = METADATA_CANDIDATES[0]
    raw_metadata = None
    for relative in METADATA_CANDIDATES:
        if _safe_source_path(run_dir, relative).exists():
            metadata_source = relative
            raw_metadata = _read_source(run_dir, relative, "json", manifest, required=True)
            break
    if raw_metadata is None:
        raw_metadata = _read_source(run_dir, metadata_source, "json", manifest)
    metadata = _safe_metadata(raw_metadata)

    final_path = run_dir / "transcript.jsonl"
    partial_path = run_dir / "partial-transcript.jsonl"
    if final_path.exists():
        transcript_relative = "transcript.jsonl"
        transcript_complete = True
    elif partial_path.exists():
        if not allow_partial:
            raise ExportError(
                "only partial-transcript.jsonl exists; rerun with --allow-partial to export it as INCOMPLETE"
            )
        transcript_relative = "partial-transcript.jsonl"
        transcript_complete = False
    else:
        transcript_relative = "transcript.jsonl"
        transcript_complete = False
    transcript = _read_source(
        run_dir, transcript_relative, "jsonl", manifest,
        required=final_path.exists() or partial_path.exists(),
    ) or []
    dialogue = []
    for source_line, row in enumerate(transcript, start=1):
        if not _is_dialogue_row(row):
            continue
        projected = {"source_line": source_line, "role": row["role"], "text": row["text"]}
        for key in ("turn", "speaker", "speaker_display", "text_display"):
            if isinstance(row.get(key), (str, int, float)):
                projected[key] = row[key]
        dialogue.append(projected)

    campaign_relative = _campaign_relative(run_dir, raw_metadata)
    party = _read_source(run_dir, f"{campaign_relative}/party.json", "json", manifest) if campaign_relative else None
    investigator_ids = _party_ids(party)
    roots = [run_dir / "sandbox" / ".coc" / "investigators"]
    if campaign_relative:
        roots.insert(0, run_dir / campaign_relative / "save" / "investigator-state")
    for root in roots:
        if not root.is_dir() or root.is_symlink():
            continue
        for path in sorted(root.iterdir()):
            candidate = path.stem if path.is_file() and path.suffix == ".json" else path.name
            if (path.is_file() or path.is_dir()) and not path.is_symlink() and candidate not in investigator_ids:
                investigator_ids.append(candidate)

    investigators: list[dict[str, Any]] = []
    for investigator_id in investigator_ids:
        base = f"sandbox/.coc/investigators/{investigator_id}"
        character = _read_source(run_dir, f"{base}/character.json", "json", manifest)
        creation = _read_source(run_dir, f"{base}/creation.json", "json", manifest)
        state = _read_source(
            run_dir, f"{campaign_relative}/save/investigator-state/{investigator_id}.json",
            "json", manifest,
        ) if campaign_relative else None
        investigators.append(
            {
                "investigator_id": investigator_id,
                "character": _character_projection(character, creation),
                "creation": _pick(creation, ("method", "status", "age")) if isinstance(creation, dict) else None,
                "state": _state_projection(state),
                "source_status": {
                    "character": _card_status(character),
                    "creation": _card_status(creation),
                    "state": _card_status(state),
                },
            }
        )

    world = flags = npc_receipts = events = clue_graph = exceptional_document = None
    first_impression_document = None
    toolbox_calls: list[dict[str, Any]] | None = None
    advisory_adoptions: list[dict[str, Any]] | None = None
    progression: dict[str, Any] = {"visited_scene_ids": [], "scene_history": [], "discovered_clues": [], "major_decisions": []}
    npc_interactions: list[dict[str, Any]] = []
    ending = None
    visible_consequences: list[dict[str, Any]] = []
    settlements: list[dict[str, Any]] = []
    if campaign_relative:
        world = _read_source(run_dir, f"{campaign_relative}/save/world-state.json", "json", manifest)
        flags = _read_source(run_dir, f"{campaign_relative}/save/flags.json", "json", manifest)
        npc_receipts = _read_source(run_dir, f"{campaign_relative}/save/npc-engagement-receipts.json", "json", manifest)
        first_impression_document = _read_source(
            run_dir,
            f"{campaign_relative}/save/npc-first-impressions.json",
            "json",
            manifest,
        )
        events = _read_source(run_dir, f"{campaign_relative}/logs/events.jsonl", "jsonl", manifest)
        clue_graph_relative = f"{campaign_relative}/scenario/clue-graph.json"
        clue_graph = _read_source(run_dir, clue_graph_relative, "json", manifest)
        if clue_graph is not None:
            manifest[clue_graph_relative]["projection"] = "structured_delivery_kind_counts_only_no_clue_content"
        toolbox_calls = _read_source(
            run_dir,
            f"{campaign_relative}/logs/toolbox-calls.jsonl",
            "jsonl",
            manifest,
        )
        advisory_adoptions = _read_source(
            run_dir,
            f"{campaign_relative}/logs/advisory-adoptions.jsonl",
            "jsonl",
            manifest,
        )
        exceptional_document = _read_source(
            run_dir,
            f"{campaign_relative}/save/exceptional-effects.json",
            "json",
            manifest,
        )
        progression = _progression_projection(world, flags)
        npc_interactions = _npc_projection(npc_receipts)
        ending = _ending_projection(events)
        visible_consequences = _consequence_projection(events, investigator_ids)
        if ending and isinstance(ending.get("ending_id"), str):
            for investigator_id in investigator_ids:
                relative = f"{campaign_relative}/save/development-settlements/endings/{ending['ending_id']}/{investigator_id}.json"
                settlement = _read_source(run_dir, relative, "json", manifest)
                projected = _settlement_projection(settlement)
                if projected:
                    settlements.append(projected)

    public_rolls: list[dict[str, Any]] = []
    all_rolls = None
    rolls_relative = None
    malformed_lines: list[int] = []
    if campaign_relative:
        rolls_relative = f"{campaign_relative}/logs/rolls.jsonl"
        all_rolls = _read_source(run_dir, rolls_relative, "jsonl", manifest)
        for source_line, row in enumerate(all_rolls or [], start=1):
            if _roll_visibility(row).casefold() not in PUBLIC_VISIBILITIES:
                continue
            if not isinstance(row, dict):
                malformed_lines.append(source_line)
                continue
            if _roll_id(row) is None or not _has_numeric_roll(row):
                malformed_lines.append(source_line)
            projected = _player_safe(row)
            assert isinstance(projected, dict)
            projected.update(
                source_line=source_line,
                source_path=rolls_relative,
                source_ref=row.get("source_ref") or f"{rolls_relative}#{source_line}",
            )
            public_rolls.append(projected)
        manifest[rolls_relative]["included_record_count"] = len(public_rolls)
        manifest[rolls_relative]["projection"] = "public_and_consequence_public_only"

    roll_ids = [_roll_id(row) for row in public_rolls]
    duplicate_roll_ids = sorted(
        roll_id for roll_id, count in Counter(roll_ids).items() if roll_id and count > 1
    )
    social_rolls = _social_roll_projection(public_rolls)

    role_counts = {
        "keeper": sum(_dialogue_side(row) == "keeper" for row in transcript),
        "player": sum(_dialogue_side(row) == "player" for row in transcript),
    }
    dimensions: dict[str, dict[str, Any]] = {}
    def dimension(name: str, passed: bool, *findings: str) -> None:
        dimensions[name] = {"status": "PASS" if passed else "FAIL", "findings": list(findings)}

    dimension("source_identity", bool(metadata) and campaign_relative is not None, "run metadata and campaign directory resolved" if metadata and campaign_relative else "run metadata or campaign directory is missing")
    transcript_findings = []
    if not transcript_complete:
        transcript_findings.append("final transcript.jsonl is missing")
    if role_counts["keeper"] == 0:
        transcript_findings.append("no non-empty Keeper/KP dialogue rows were found")
    if role_counts["player"] == 0:
        transcript_findings.append("no non-empty player dialogue rows were found")
    transcript_ok = transcript_complete and not transcript_findings
    dimension("exact_transcript", transcript_ok, *(transcript_findings or ["final ordered transcript contains both table roles"]))
    dimension("dice", all_rolls is not None and not malformed_lines and not duplicate_roll_ids, "structured public-roll evidence is traceable exactly once" if all_rolls is not None and not malformed_lines and not duplicate_roll_ids else "structured roll evidence is missing or invalid")
    character_ok = bool(investigators) and all(i["source_status"]["character"] == "PRESENT" and i["source_status"]["state"] == "PRESENT" for i in investigators)
    dimension("character_and_final_state", character_ok, "initial card and final dynamic state are present" if character_ok else "an investigator lacks an initial card or final state")
    progression_ok = isinstance(world, dict) and isinstance(flags, dict) and bool(progression["visited_scene_ids"])
    dimension("progression", progression_ok, "visited scenes and discovered-clue receipts are projected" if progression_ok else "world progression sources or visited path are missing")
    ending_ok = ending is not None and len(settlements) == len(investigator_ids) and bool(investigator_ids)
    dimension("ending_and_development", ending_ok, "structured ending and investigator settlements are present" if ending_ok else "structured ending or development settlement is missing")
    projection_ok = isinstance(flags, dict) and (npc_receipts is None or isinstance(npc_receipts, dict))
    dimension("player_safe_projection", projection_ok, "explicit per-source allowlists applied" if projection_ok else "player-safe projection sources are malformed")

    reasons: list[str] = [finding for value in dimensions.values() if value["status"] == "FAIL" for finding in value["findings"]]
    if not transcript_complete and transcript_relative != "transcript.jsonl":
        reasons.append("partial transcript exported by explicit request")
    if all_rolls is None:
        reasons.append("structured rolls.jsonl is missing; public roll count cannot be proven")
    if malformed_lines:
        reasons.append("public roll rows lack roll_id or numerical evidence at source lines: " + ", ".join(map(str, malformed_lines)))
    if duplicate_roll_ids:
        reasons.append("duplicate public roll IDs: " + ", ".join(duplicate_roll_ids))

    turn_capsules: dict[str, dict[str, Any]] = {}
    for call in toolbox_calls or []:
        if not isinstance(call, dict):
            continue
        turn_key = str(call.get("turn_number") if call.get("turn_number") is not None else "unassigned")
        capsule = turn_capsules.setdefault(
            turn_key,
            {
                "schema_version": 1,
                "turn_number": call.get("turn_number"),
                "visibility": "keeper_internal",
                "tool_calls": [],
                "advisory_adoptions": [],
            },
        )
        capsule["tool_calls"].append(call)
    for adoption in advisory_adoptions or []:
        if not isinstance(adoption, dict):
            continue
        decision_id = str(adoption.get("decision_id") or "")
        matched = next(
            (
                capsule
                for capsule in turn_capsules.values()
                if any(
                    isinstance(call, dict)
                    and str((call.get("args") or {}).get("decision_id") or "") == decision_id
                    for call in capsule["tool_calls"]
                )
            ),
            None,
        )
        if matched is None:
            matched = turn_capsules.setdefault(
                "unassigned",
                {
                    "schema_version": 1,
                    "turn_number": None,
                    "visibility": "keeper_internal",
                    "tool_calls": [],
                    "advisory_adoptions": [],
                },
            )
        matched["advisory_adoptions"].append(adoption)

    play_conduct_signals = _play_conduct_signals(
        dialogue=dialogue,
        public_roll_count=len(public_rolls),
        toolbox_calls=toolbox_calls,
        clue_graph=clue_graph,
        all_rolls=all_rolls,
        progression=progression,
        npc_receipts=npc_receipts,
    )

    projected_exceptional = _exceptional_effect_projection(exceptional_document)
    relationship_rewards = [
        effect for effect in projected_exceptional
        if effect.get("direction") == "benefit"
        and effect.get("effect_kind") == "bonus_die"
        and isinstance(effect.get("mechanics"), dict)
        and effect["mechanics"].get("target_id")
    ]
    return {
        "completeness": {
            "classification": "COMPLETE" if not reasons else "INCOMPLETE",
            "claim_scope": "report_source_evidence_only",
            "not_claimed": ["prose_quality", "director_use", "whole_product_kp_quality", "play_conduct_quality_judgment"],
            "dimensions": dimensions,
            "dialogue_role_counts": role_counts,
            "final_transcript_present": transcript_complete,
            "reasons": reasons,
        },
        "investigators": investigators,
        "play_conduct_signals": play_conduct_signals,
        "progression": progression,
        "npc_interactions": npc_interactions,
        "first_impressions": _first_impression_projection(
            first_impression_document, npc_receipts
        ),
        "social_rolls": social_rolls,
        "ending": ending,
        "visible_consequences": visible_consequences,
        "exceptional_effects": [
            effect for effect in projected_exceptional
            if effect not in relationship_rewards
        ],
        "relationship_rewards": relationship_rewards,
        "development_settlements": settlements,
        "keeper_internal": {
            "schema_version": 1,
            "audience": "keeper_development_audit_only",
            "not_player_facing": True,
            "turn_capsules": list(turn_capsules.values()),
            "tool_call_count": len(toolbox_calls or []),
            "advisory_adoption_count": len(advisory_adoptions or []),
        },
        "public_rolls": {
            "source_path": rolls_relative,
            "source_present": all_rolls is not None,
            "required_count": len(public_rolls),
            "rendered_count": len(public_rolls),
            "duplicate_roll_ids": duplicate_roll_ids,
            "malformed_source_lines": malformed_lines,
            "records": public_rolls,
            "status": "PASS" if all_rolls is not None and not duplicate_roll_ids and not malformed_lines else "FAIL",
        },
        "run_metadata": metadata,
        "source_identity": {
            "metadata_source": metadata_source,
            "campaign_id": metadata.get("campaign_id"),
            "campaign_source_directory": campaign_relative,
            "run_id": metadata.get("run_id"),
            "transcript_sha256": manifest[transcript_relative].get("sha256"),
            "transcript_source": transcript_relative,
        },
        "source_manifest": sorted(manifest.values(), key=lambda item: item["path"]),
        "transcript": {
            "source_record_count": len(transcript),
            "dialogue_record_count": len(dialogue),
            "records": dialogue,
        },
    }


def _turn_sort_key(key: str) -> tuple[int, Any]:
    if key == "unassigned":
        return (2, 0)
    if key.isdigit():
        return (0, int(key))
    return (1, key)


def _play_conduct_signals(
    *,
    dialogue: list[dict[str, Any]],
    public_roll_count: int,
    toolbox_calls: list[dict[str, Any]] | None,
    clue_graph: Any,
    all_rolls: list[Any] | None,
    progression: dict[str, Any],
    npc_receipts: Any,
) -> dict[str, Any]:
    """Observational structured facts about table conduct (e.g. zero-roll sessions).

    These signals only restate structured source evidence (turn numbers, roll
    log rows, module-authored delivery_kind, NPC identity contracts). They make
    no pass/fail judgment and never feed the completeness classification.
    """
    turn_count = len({row["turn"] for row in dialogue if _is_numeric(row.get("turn"))})

    tool_call_counts: dict[str, int] = {}
    for call in toolbox_calls or []:
        if not isinstance(call, dict):
            continue
        turn = call.get("turn_number")
        key = str(turn) if turn is not None else "unassigned"
        tool_call_counts[key] = tool_call_counts.get(key, 0) + 1

    discovered_clue_ids = [
        clue["clue_id"]
        for clue in progression.get("discovered_clues", [])
        if isinstance(clue, dict) and isinstance(clue.get("clue_id"), str)
    ]
    skill_check_clues: list[dict[str, Any]] | None = None
    without_roll_evidence: list[dict[str, Any]] | None = None
    if clue_graph is not None:
        discovered_set = set(discovered_clue_ids)
        skill_check_clues = [
            clue
            for clue in _clue_graph_rows(clue_graph)
            if clue["clue_id"] in discovered_set
            and clue.get("delivery_kind") == "skill_check"
        ]
        if all_rolls is not None:
            rolled_skills = {
                skill.strip().casefold()
                for row in all_rolls
                if (skill := _roll_skill(row)) is not None
            }
            without_roll_evidence = [
                clue
                for clue in skill_check_clues
                if not isinstance(clue.get("skill"), str)
                or clue["skill"].strip().casefold() not in rolled_skills
            ]

    receipts_source = npc_receipts.get("receipts") if isinstance(npc_receipts, dict) else None
    npc_total = 0
    npc_improvised = 0
    for receipt in receipts_source.values() if isinstance(receipts_source, dict) else []:
        event = receipt.get("event") if isinstance(receipt, dict) else None
        if not isinstance(event, dict):
            continue
        npc_total += 1
        if event.get("identity_contract") is None:
            npc_improvised += 1

    return {
        "schema_version": 1,
        "nature": "observational_structured_facts_only",
        "quality_judgment": "none: these signals never affect the completeness classification",
        "turn_count": turn_count,
        "public_roll_count": public_roll_count,
        "tool_call_counts_per_turn": {
            "available": toolbox_calls is not None,
            "counts": dict(sorted(tool_call_counts.items(), key=lambda item: _turn_sort_key(item[0]))),
            "total_tool_calls": len(toolbox_calls or []),
        },
        "skill_check_clue_delivery": {
            "available": clue_graph is not None and all_rolls is not None,
            "discovered_clue_count": len(discovered_clue_ids),
            "skill_check_delivery_count": len(skill_check_clues) if skill_check_clues is not None else None,
            "without_roll_evidence_count": len(without_roll_evidence) if without_roll_evidence is not None else None,
            "without_roll_evidence_clue_ids": (
                [clue["clue_id"] for clue in without_roll_evidence]
                if without_roll_evidence is not None
                else None
            ),
        },
        "npc_engagements": {
            "available": isinstance(npc_receipts, dict),
            "total_count": npc_total,
            "improvised_count": npc_improvised,
        },
    }


def _safe_metadata(metadata: Any) -> dict[str, Any]:
    if not isinstance(metadata, dict):
        return {}
    allowed = (
        "run_id",
        "campaign_id",
        "seed",
        "play_language",
        "run_kind",
        "play_kind",
        "simulation_method",
        "started_at",
        "finished_at",
        "status",
    )
    return {key: metadata[key] for key in allowed if key in metadata}


def _first(mapping: Any, keys: tuple[str, ...]) -> Any:
    if not isinstance(mapping, dict):
        return None
    for key in keys:
        if mapping.get(key) not in (None, ""):
            return mapping[key]
    return None


def _first_not_none(*values: Any) -> Any:
    for value in values:
        if value is not None:
            return value
    return None


def _structured_skill_labels(report: dict[str, Any]) -> dict[str, dict[str, str]]:
    """Player-facing labels already carried by each structured character card."""
    metadata = report.get("run_metadata")
    if not isinstance(metadata, dict) or metadata.get("play_language") != "zh-Hans":
        return {}
    labels_by_investigator: dict[str, dict[str, str]] = {}
    for investigator in report.get("investigators") or []:
        if not isinstance(investigator, dict):
            continue
        investigator_id = investigator.get("investigator_id")
        character = investigator.get("character")
        rows = (
            character.get("initial_skill_rows")
            if isinstance(character, dict) else None
        )
        labels: dict[str, str] = {}
        for row in rows if isinstance(rows, list) else []:
            if not isinstance(row, dict):
                continue
            key = row.get("key")
            label = row.get("label")
            if (
                isinstance(key, str) and key.strip()
                and isinstance(label, str) and label.strip()
            ):
                labels[key] = label
        if isinstance(investigator_id, str) and labels:
            labels_by_investigator[investigator_id] = labels
    return labels_by_investigator


def _display_skill(
    labels_by_investigator: dict[str, dict[str, str]],
    investigator_id: Any,
    canonical_skill: Any,
) -> Any:
    if not isinstance(investigator_id, str) or not isinstance(canonical_skill, str):
        return canonical_skill
    return labels_by_investigator.get(investigator_id, {}).get(
        canonical_skill, canonical_skill
    )


def _nested_dice_display(payload: Any) -> Any:
    if not isinstance(payload, dict):
        return None
    dice = payload.get("dice")
    if not isinstance(dice, dict):
        return None
    total = dice.get("total")
    if not _is_numeric(total):
        return None
    expression = dice.get("expression")
    if isinstance(expression, str) and expression.strip():
        return f"{expression.strip()} = {total}"
    return total


def _display(value: Any) -> str:
    if isinstance(value, bool):
        return "yes" if value else "no"
    if isinstance(value, (str, int, float)):
        return str(value)
    if isinstance(value, list) and all(isinstance(item, (str, int, float)) for item in value):
        return ", ".join(map(str, value))
    return _pretty_json(value).replace("\n", " ")


def _exceptional_boundary_display(value: Any) -> str:
    if not isinstance(value, dict):
        return _display(value)
    kind = str(value.get("kind") or "unknown")
    detail = next(
        (
            value[key]
            for key in ("description", "scene_id", "marker_id", "uses")
            if value.get(key) not in (None, "")
        ),
        None,
    )
    return f"{kind}: {detail}" if detail is not None else kind


def _play_conduct_markdown(signals: dict[str, Any]) -> list[str]:
    """Player-safe observational counts; no clue content or keeper-only detail."""
    lines = [
        "## Play Conduct Signals",
        "",
        "Observational structured facts for human review. They are not pass/fail "
        "judgments and do not change the completeness classification.",
        "",
        f"- Dialogue turns: **{signals['turn_count']}**",
        f"- Public rolls: **{signals['public_roll_count']}**",
    ]
    tool_counts = signals["tool_call_counts_per_turn"]
    if tool_counts["available"]:
        if tool_counts["counts"]:
            per_turn = "; ".join(
                f"turn {turn}: {count}" for turn, count in tool_counts["counts"].items()
            )
            lines.append(f"- Tool calls per turn (from the keeper-internal toolbox log): {per_turn}")
        else:
            lines.append("- Tool calls per turn (from the keeper-internal toolbox log): no toolbox calls were logged")
    else:
        lines.append("- Tool calls per turn: keeper-internal toolbox log unavailable")
    clue_signal = signals["skill_check_clue_delivery"]
    if clue_signal["available"]:
        lines.append(
            f"- Discovered clues: {clue_signal['discovered_clue_count']}; "
            f"module-designed skill-check delivery: {clue_signal['skill_check_delivery_count']}; "
            f"without a matching authored-skill roll in the roll log: **{clue_signal['without_roll_evidence_count']}**"
        )
        clue_ids = clue_signal.get("without_roll_evidence_clue_ids") or []
        if clue_ids:
            lines.append("  - Without roll evidence: " + ", ".join(f"`{clue_id}`" for clue_id in clue_ids))
    else:
        lines.append(
            f"- Discovered clues: {clue_signal['discovered_clue_count']}; "
            "skill-check delivery evidence unavailable (clue graph or roll log missing)"
        )
    npc_signal = signals["npc_engagements"]
    if npc_signal["available"]:
        lines.append(
            f"- NPC engagements recorded: {npc_signal['total_count']}; "
            f"improvised (no authored NPC identity): **{npc_signal['improvised_count']}**"
        )
    else:
        lines.append("- NPC engagements: no structured receipts were recorded")
    lines.append("")
    return lines


def _markdown(report: dict[str, Any]) -> str:
    metadata = report["run_metadata"]
    completeness = report["completeness"]
    skill_labels = _structured_skill_labels(report)
    lines = [
        "# COC Actual-Play Battle Report", "",
        "This is the final player-readable report produced directly from a real playtest run.", "",
        f"- Report ID: `{report['report_id']}`",
        f"- Run: `{metadata.get('run_id', 'MISSING')}`",
        f"- Campaign: `{metadata.get('campaign_id', 'MISSING')}`",
        f"- Completeness: **{completeness['classification']}**", "",
        "> Completeness covers report-source evidence only. It does not certify prose quality, Director use, or whole-product KP quality.", "",
        "## Investigators", "",
    ]
    if not report["investigators"]:
        lines.extend(["No investigator evidence was found.", ""])
    for investigator in report["investigators"]:
        character = investigator.get("character") or {}
        state = investigator.get("state") or {}
        name = _first(character, ("name", "display_name")) or _first(state, ("name", "display_name")) or investigator["investigator_id"]
        lines.extend([f"### {name}", ""])
        fields = (
            ("ID", investigator["investigator_id"]),
            ("Occupation", _first(character, ("occupation", "profession"))),
            ("Age", _first(character, ("age",))),
            ("Sex", _first(character, ("sex",))),
            ("Nationality", _first(character, ("nationality",))),
            ("Era", _first(character, ("era",))),
            ("Residence", _first(character, ("residence",))),
            ("Birthplace", _first(character, ("birthplace",))),
            ("Credit Rating", _first(character, ("credit_rating",))),
            ("Cash", _first(character, ("cash",))),
            (
                "Final HP",
                _first_not_none(
                    _first(state, ("current_hp", "hp", "hit_points")),
                    _first(character.get("derived"), ("HP", "hp")),
                ),
            ),
            (
                "Final SAN",
                _first_not_none(
                    _first(state, ("current_san", "san", "sanity")),
                    _first(character.get("derived"), ("SAN", "san")),
                ),
            ),
            (
                "Final MP",
                _first_not_none(
                    _first(state, ("current_mp", "mp", "magic_points")),
                    _first(character.get("derived"), ("MP", "mp")),
                ),
            ),
            ("Final Luck", _first_not_none(_first(state, ("current_luck", "luck")), _first(character.get("characteristics"), ("LUCK", "Luck")))),
            ("Conditions", _first(state, ("conditions",))),
        )
        lines.extend(f"- {label}: {_display(value)}" for label, value in fields if value not in (None, "", []))
        lines.append("")
        for heading, key in (("Characteristics", "characteristics"), ("Initial Derived Values", "derived")):
            value = character.get(key)
            if isinstance(value, dict) and value:
                lines.extend([f"#### {heading}", "", " | ".join(f"{k}: {_display(v)}" for k, v in value.items()), ""])
        skill_rows = character.get("initial_skill_rows")
        if isinstance(skill_rows, list) and skill_rows:
            lines.extend(["#### Initial Skills", "", "| Skill | Full | Half | Fifth |", "|---|---:|---:|---:|"])
            for row in skill_rows:
                label = row.get("label") or row.get("key")
                key = row.get("key")
                display_label = f"{label} (`{key}`)" if label != key else str(key)
                lines.append(f"| {display_label} | {_display(row.get('value'))} | {_display(row.get('half'))} | {_display(row.get('fifth'))} |")
            lines.append("")
        elif isinstance(character.get("initial_skills"), dict) and character["initial_skills"]:
            lines.extend(["#### Initial Skills", "", " | ".join(f"{k}: {_display(v)}" for k, v in character["initial_skills"].items()), ""])
        for heading, key in (("Weapons", "weapons"), ("Equipment", "equipment")):
            value = character.get(key)
            if isinstance(value, list) and value:
                lines.extend([f"#### {heading}", ""])
                if key == "weapons":
                    for item in value:
                        if isinstance(item, dict):
                            name = item.get("name") or item.get("weapon_id") or "Weapon"
                            details = "; ".join(f"{k.replace('_', ' ').title()}: {_display(v)}" for k, v in item.items() if k not in {"name", "weapon_id"})
                            lines.append(f"- **{name}**{f' — {details}' if details else ''}")
                        else:
                            lines.append(f"- {_display(item)}")
                else:
                    lines.extend(f"- {_display(item)}" for item in value)
                lines.append("")
        backstory = character.get("backstory")
        if isinstance(backstory, dict) and backstory:
            lines.extend(["#### Backstory and Traits", ""])
            for key, value in backstory.items():
                if key == "scenario_id" or value in (None, "", []):
                    continue
                label = key.replace('_', ' ').title()
                if isinstance(value, dict):
                    lines.append(f"- **{label}**")
                    for child_key, child_value in value.items():
                        if child_value not in (None, "", []):
                            lines.append(f"  - {child_key.replace('_', ' ').title()}: {_display(child_value)}")
                else:
                    lines.append(f"- {label}: {_display(value)}")
            lines.append("")
        hooks = state.get("personal_horror_hooks")
        if isinstance(hooks, list) and hooks:
            lines.extend(["#### Personal Horror", ""])
            for hook in hooks:
                if isinstance(hook, dict):
                    status = "woven" if hook.get("woven") is True else "not recorded as woven"
                    payoff = " · payoff recorded" if hook.get("payoff") is True else ""
                    lines.append(f"- {_display(hook.get('summary') or hook.get('hook_id'))} — {status}{payoff}")
            lines.append("")

    lines.extend(["## Development and Ending", ""])
    ending = report.get("ending")
    if isinstance(ending, dict):
        lines.extend([f"**Outcome:** {_display(ending.get('kind') or 'conclusion')}", "", _display(ending.get("summary") or "No readable ending summary was recorded."), ""])
    else:
        lines.extend(["No structured ending was recorded.", ""])
    for settlement in report.get("development_settlements", []):
        investigator_id = settlement.get("investigator_id")
        display_name = next((
            _first(item.get("character"), ("name", "display_name")) or _first(item.get("state"), ("name", "display_name"))
            for item in report.get("investigators", []) if item.get("investigator_id") == investigator_id
        ), None) or investigator_id or "Investigator"
        lines.extend([f"### {display_name} Development", ""])
        for row in settlement.get("improvement_checks", []):
            lines.append(f"- {row.get('skill')}: {row.get('value_before')} → {row.get('value_after')} (gain {row.get('applied_delta', row.get('gain'))}; check {row.get('check_roll')})")
        luck = settlement.get("luck_recovery")
        if luck:
            lines.append(f"- Luck: {luck.get('luck_before')} → {luck.get('luck_after')} (gain {luck.get('gained')}; check {luck.get('roll')}; {'recovered' if luck.get('success') else 'not recovered'})")
        san = settlement.get("san_reward")
        if san:
            dice = san.get("rolls")
            roll_text = ", ".join(map(str, dice)) if isinstance(dice, list) else san.get("total")
            lines.append(f"- SAN reward: {san.get('san_before')} → {san.get('san_after')} (gain {san.get('san_gained')}; {san.get('expression')}: {roll_text})")
        facing = settlement.get("player_facing_mechanics")
        if isinstance(facing, dict) and facing.get("rendered_lines"):
            lines.append("- Public development checks (final output hard constraint):")
            for line in facing["rendered_lines"]:
                lines.append(f"  - {line}")
            if facing.get("complete") is False:
                lines.append(
                    f"  - INCOMPLETE missing: {facing.get('missing_roll_ids') or []}"
                )
        lines.append("")

    progression = report.get("progression", {})
    lines.extend(["## Investigation Chronicle", "", "### Scene Progression", ""])
    visited = progression.get("visited_scene_ids", [])
    lines.extend([" → ".join(f"`{scene}`" for scene in visited) if visited else "No visited-scene path was recorded.", "", "### Discovered Clues", ""])
    for clue in progression.get("discovered_clues", []):
        detail = f" — {clue['method']}" if clue.get("method") else ""
        lines.append(f"- `{clue['clue_id']}`{detail}")
    if not progression.get("discovered_clues"):
        lines.append("No discovered-clue receipts were recorded.")
    lines.extend(["", "### NPC Interactions", ""])
    for npc in report.get("npc_interactions", []):
        lines.append(f"- `{npc.get('npc_id', 'unknown')}` · {npc.get('interaction_kind', 'interaction')} · scene `{npc.get('scene_id', 'unknown')}`")
    if not report.get("npc_interactions"):
        lines.append("No player-safe NPC interaction receipts were recorded.")
    lines.extend(["", "### First Impressions", ""])
    for impression in report.get("first_impressions", []):
        basis = (
            "Credit Rating"
            if impression.get("governing_attribute") == "credit_rating"
            else "APP"
        )
        result = (
            "legacy frozen receipt"
            if impression.get("legacy_contract")
            else (
                f"D100 {impression.get('roll')} · "
                f"{impression.get('achieved_level')} · `{impression.get('roll_id')}`"
            )
        )
        realization = impression.get("realization") or {}
        lines.append(
            f"- `{impression.get('investigator_id', 'unknown')}` → "
            f"{impression.get('npc_display_name') or impression.get('npc_id', 'unknown')} "
            f"(`{impression.get('npc_id', 'unknown')}`) · APP {impression.get('app')} / "
            f"CR {impression.get('credit_rating')} · used {basis} "
            f"{impression.get('governing_value')} · {result} · "
            f"{realization.get('observable_manner', 'realization not recorded')}"
        )
    if not report.get("first_impressions"):
        lines.append("No first-impression receipts were recorded.")
    lines.extend(["", "### Social Skill Rolls", ""])
    for entry in report.get("social_rolls", []):
        parts = [
            f"`{entry.get('roll_id') or 'MISSING'}`",
            str(_display_skill(
                skill_labels, entry.get("actor"), entry.get("skill")
            )),
        ]
        if _is_numeric(entry.get("roll")):
            roll_text = f"roll {_display(entry['roll'])}"
            if _is_numeric(entry.get("target")):
                roll_text += f" vs {_display(entry['target'])}"
            parts.append(roll_text)
        if entry.get("outcome"):
            parts.append(str(entry["outcome"]))
        lines.append("- " + " · ".join(parts))
    if not report.get("social_rolls"):
        lines.append("No public social-skill rolls (Charm, Fast Talk, Intimidate, Persuade) were recorded.")
    lines.extend(["", "### Recorded Consequences", ""])
    for event in report.get("visible_consequences", []):
        event_type = event.get("event_type", "event").replace("_", " ").title()
        details = "; ".join(f"{key.replace('_', ' ').title()}: {_display(value)}" for key, value in event.items() if key not in {"event_type", "ts"})
        lines.append(f"- **{event_type}**{f' — {details}' if details else ''}")
    if not report.get("visible_consequences"):
        lines.append("No structured player-safe combat, HP, or SAN consequences were recorded.")
    lines.extend(["", "### Exceptional Effects", ""])
    for effect in report.get("exceptional_effects", []):
        boundary = _exceptional_boundary_display(effect.get("boundary"))
        lines.append(
            f"- **{effect.get('direction', 'effect')} · {effect.get('effect_kind', 'effect')}** — "
            f"{effect.get('player_visible_impact', '')} "
            f"(cause: {effect.get('causal_link', '')}; boundary: {boundary}; "
            f"status: {effect.get('status', 'unknown')})"
        )
    if not report.get("exceptional_effects"):
        lines.append("No source-bound exceptional effects were recorded.")
    lines.extend(["", "### Relationship / Impression Rewards", ""])
    for effect in report.get("relationship_rewards", []):
        mechanics = effect.get("mechanics") or {}
        boundary = _exceptional_boundary_display(effect.get("boundary"))
        lines.append(
            f"- `{mechanics.get('investigator_id', 'unknown')}` → "
            f"{mechanics.get('target_display_name') or mechanics.get('target_id', 'unknown')} "
            f"(`{mechanics.get('target_id', 'unknown')}`) · {effect.get('effect_kind')} · "
            f"{effect.get('player_visible_impact', '')} "
            f"(cause: {effect.get('causal_link', '')}; skill: "
            f"{mechanics.get('skill', 'unknown')}; boundary: {boundary}; "
            f"source roll: {effect.get('source_roll_id', 'unknown')}; "
            f"source decisions: {mechanics.get('source_decision_ids', [])}; "
            f"status: {effect.get('status', 'unknown')})"
        )
    if not report.get("relationship_rewards"):
        lines.append("No NPC-scoped relationship rewards were recorded.")
    decisions = progression.get("major_decisions", [])
    lines.extend(["", "### Major Decisions", ""])
    for decision in decisions:
        lines.append(f"- {_display(decision)}")
    if not decisions:
        lines.append("No structured major-decision receipts were recorded.")
    lines.append("")

    lines.extend(["## Actual Play", ""])
    for index, row in enumerate(report["transcript"]["records"], start=1):
        side = "Keeper" if row["role"].casefold() in KEEPER_ROLES else "Player"
        speaker = row.get("speaker_display") or row.get("speaker") or side
        lines.extend([f"### Turn {row.get('turn', index)} · {speaker}", "", row["text"].strip(), ""])
    if not report["transcript"]["records"]:
        lines.extend(["No player/Keeper dialogue was recorded.", ""])

    rolls = report["public_rolls"]
    lines.extend(["## Public Rules and Dice", "", f"Public roll count: **{rolls['required_count']}**.", f"Dice completeness: **{rolls['status']}**.", ""])
    for roll in rolls["records"]:
        payload = roll.get("payload") if isinstance(roll.get("payload"), dict) else {}
        dice = payload.get("dice") if isinstance(payload.get("dice"), dict) else {}
        actor = _first_not_none(
            _first(roll, ("actor", "investigator_id")),
            _first(payload, ("actor", "investigator_id")),
        )
        canonical_check = _first_not_none(
            _first(payload, ("skill", "attribute", "reason", "expression")),
            _first(roll, ("skill", "reason", "expression")),
        )
        lines.extend([f"### `{_roll_id(roll) or 'MISSING'}`", ""])
        fields = (
            ("Actor", actor),
            (
                "Check",
                _display_skill(skill_labels, actor, canonical_check),
            ),
            (
                "Roll",
                _first_not_none(
                    _first(payload, ("roll", "rolls", "total", "result", "value")),
                    _nested_dice_display(payload),
                    _first(roll, ("roll", "rolls", "total", "result", "value")),
                ),
            ),
            ("Raw Dice", _first(dice, ("raw",))),
            (
                "Target",
                _first_not_none(
                    _first(payload, ("effective_target", "target")),
                    _first(roll, ("effective_target", "target")),
                ),
            ),
            (
                "Difficulty",
                _first_not_none(
                    _first(payload, ("difficulty",)),
                    _first(roll, ("difficulty",)),
                ),
            ),
            (
                "Outcome",
                _first_not_none(
                    _first(payload, ("outcome", "success_level")),
                    _first(roll, ("outcome", "success_level")),
                ),
            ),
            ("Visibility", _roll_visibility(roll)),
            ("Source", roll.get("source_ref")),
        )
        lines.extend(f"- {label}: {_display(value)}" for label, value in fields if value not in (None, "", []))
        lines.append("")
    if not rolls["records"]:
        lines.extend(["No public or consequence-public rolls occurred.", ""])

    lines.extend(_play_conduct_markdown(report["play_conduct_signals"]))

    lines.extend(["## Completeness and Provenance", ""])
    for name, result in completeness["dimensions"].items():
        lines.append(f"- {name.replace('_', ' ').title()}: **{result['status']}** — {'; '.join(result['findings'])}")
    lines.extend([f"- {reason}" for reason in completeness["reasons"]] or ["- All required final-report sources passed validation."])
    lines.extend([
        f"- Dialogue rows rendered: {report['transcript']['dialogue_record_count']}.",
        f"- Public rolls rendered exactly once: {rolls['rendered_count']}.",
        "- Keeper-only rolls, scenario truth, hidden logs, runner prompts, NPC identity contracts/agendas/voices, and secret fields are excluded.",
        "- This is evidence/report-source completeness, not a prose-quality, Director-use, or whole-product KP-quality claim.", "",
    ])
    return "\n".join(lines)


def _safe_artifacts_dir(run_dir: Path) -> Path:
    artifacts = run_dir / "artifacts"
    if artifacts.exists():
        if artifacts.is_symlink() or not artifacts.is_dir():
            raise ExportError("artifacts must be a real directory, not a symlink or file")
    else:
        artifacts.mkdir(mode=0o755)
    for name in (JSON_OUTPUT, MARKDOWN_OUTPUT):
        output = artifacts / name
        if output.is_symlink():
            raise ExportError(f"refusing to overwrite output symlink: artifacts/{name}")
        if output.exists() and not output.is_file():
            raise ExportError(f"output is not a regular file: artifacts/{name}")
    return artifacts


def _atomic_pair(artifacts: Path, outputs: dict[str, bytes]) -> None:
    staged: dict[str, Path] = {}
    try:
        for name, content in outputs.items():
            descriptor, temporary = tempfile.mkstemp(prefix=f".{name}.", dir=artifacts)
            path = Path(temporary)
            staged[name] = path
            with os.fdopen(descriptor, "wb") as handle:
                handle.write(content)
                handle.flush()
                os.fsync(handle.fileno())
        for name in (JSON_OUTPUT, MARKDOWN_OUTPUT):
            os.replace(staged.pop(name), artifacts / name)
        directory_fd = os.open(artifacts, os.O_RDONLY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    finally:
        for path in staged.values():
            path.unlink(missing_ok=True)


def export_battle_report(run_dir: Path | str, *, allow_partial: bool = False) -> dict[str, Any]:
    lexical = Path(run_dir).absolute()
    if lexical.is_symlink() or not lexical.is_dir():
        raise ExportError("run directory must be an existing real directory")
    resolved = lexical.resolve()
    source = _source_payload(resolved, allow_partial=allow_partial)
    identity_material = {
        "schema_version": SCHEMA_VERSION,
        "source_manifest": source["source_manifest"],
        "source_payload": source,
    }
    report_id = "coc-battle-report-" + _sha256(_canonical_bytes(identity_material))[:24]
    report = {
        "schema_version": SCHEMA_VERSION,
        "report_id": report_id,
        "report_type": "coc_actual_play_battle_report_evidence",
        "markdown_audience": "player_safe",
        **source,
    }
    json_bytes = (_pretty_json(report) + "\n").encode("utf-8")
    markdown_bytes = (_markdown(report).rstrip() + "\n").encode("utf-8")
    artifacts = _safe_artifacts_dir(resolved)
    _atomic_pair(artifacts, {JSON_OUTPUT: json_bytes, MARKDOWN_OUTPUT: markdown_bytes})
    return report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("run_dir", type=Path, help="real COC playtest run directory")
    parser.add_argument(
        "--allow-partial",
        action="store_true",
        help="render partial-transcript.jsonl as an explicitly INCOMPLETE report",
    )
    args = parser.parse_args(argv)
    try:
        report = export_battle_report(args.run_dir, allow_partial=args.allow_partial)
    except (ExportError, OSError) as exc:
        parser.exit(2, f"error: {exc}\n")
    print(
        json.dumps(
            {
                "classification": report["completeness"]["classification"],
                "outputs": [
                    f"artifacts/{JSON_OUTPUT}",
                    f"artifacts/{MARKDOWN_OUTPUT}",
                ],
                "report_id": report["report_id"],
            },
            ensure_ascii=False,
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
