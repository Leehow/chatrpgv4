#!/usr/bin/env python3
"""DirectorPlan apply layer — persists director decisions to save/logs/memory.

The director is read-only wrt rule state; this module is the write side that
turns a DirectorPlan's reveal/pressure/memory_write intents into file changes.
Called by coc-keeper-play after rules are resolved and the turn is narrated.

Clue reveal is intentionally *fail-forward*, not a hard gate:
- obvious / already-resolved clues may be committed immediately;
- obscured clues with rules_requests commit only on a successful rule result;
- failed obscured checks withhold the exact clue, log an immersive cost, and
  keep fallback/recovery routes alive instead of deadlocking the story;
- RECOVER after multiple stalled turns may commit one fallback route with a
  pressure/time cost, modeling an Idea Roll-style recovery valve.

Session ending (W1-6 / Keeper Rulebook p.212-213): when ``scene_action`` is
``PAYOFF`` and the active story-graph scene is terminal, append a structured
``session_ending`` event (playtest-compatible ``type`` + ``payload``). Terminal
evidence is structured only — never prose keywords:

- ``scene.is_final is True``, or
- ``scene.scene_type == "resolution"``, or
- the scene has no outgoing ``scene_edges`` (R-3 graph), or
- LEGACY: the scene is the last entry in ``story-graph.json`` ``scenes``
  when the graph never declares ``scene_edges``.

Spec: docs/superpowers/specs/2026-07-06-story-director-v2-blueprint.md
"""
from __future__ import annotations

from contextlib import nullcontext
from copy import deepcopy
import json
import os
import time
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent

_APPLY_LEDGER_FILENAME = "apply-ledger.json"
_APPLY_LEDGER_CAP = 200


def _load_sibling(name: str, filename: str):
    import importlib.util
    spec = importlib.util.spec_from_file_location(name, SCRIPT_DIR / filename)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


coc_fileio = _load_sibling("coc_fileio", "coc_fileio.py")
coc_flag_state = _load_sibling("coc_flag_state_director", "coc_flag_state.py")
coc_exit_conditions = _load_sibling("coc_exit_conditions", "coc_exit_conditions.py")
coc_scene_graph = _load_sibling("coc_scene_graph", "coc_scene_graph.py")
coc_development = _load_sibling("coc_development", "coc_development.py")
coc_rule_signals = _load_sibling("coc_rule_signals", "coc_rule_signals.py")
coc_npc_state = _load_sibling("coc_npc_state", "coc_npc_state.py")
coc_npc_identity = _load_sibling("coc_npc_identity_director", "coc_npc_identity.py")
coc_npc_event_chain = _load_sibling(
    "coc_npc_event_chain_director", "coc_npc_event_chain.py"
)
coc_director_strategies = _load_sibling(
    "coc_director_strategies_apply", "coc_director_strategies.py"
)
coc_subsystem_executor = _load_sibling(
    "coc_subsystem_executor_director_apply",
    "coc_subsystem_executor.py",
)
coc_toolbox_continuity = _load_sibling(
    "coc_toolbox_continuity_director_apply",
    "coc_toolbox.py",
)
coc_belief_state = _load_sibling("coc_belief_state", "coc_belief_state.py")
coc_epistemic_resolve = _load_sibling("coc_epistemic_resolve", "coc_epistemic_resolve.py")
coc_epistemic_lifecycle = _load_sibling("coc_epistemic_lifecycle", "coc_epistemic_lifecycle.py")

coc_memory = None
try:
    coc_memory = _load_sibling("coc_memory", "coc_memory.py")
except Exception:
    coc_memory = None

# Idea Roll signpost ladder (Keeper Rulebook ~p.199). Higher rank wins; never
# downgrade an already-stronger signpost.
_SIGNPOST_RANK = {
    "unmentioned": 0,
    "mentioned": 1,
    "obvious": 2,
}


def _normalize_signpost_level(raw: Any) -> str | None:
    key = str(raw or "").strip().lower()
    aliases = {
        "unmentioned": "unmentioned",
        "never": "unmentioned",
        "none": "unmentioned",
        "mentioned": "mentioned",
        "signposted": "mentioned",
        "regular": "mentioned",
        "obvious": "obvious",
        "obvious_missed": "obvious",
        "extreme": "obvious",
    }
    return aliases.get(key)


def _clue_id_from_choice_route(route: dict[str, Any]) -> str | None:
    """Extract a clue id from a choice_frame investigative lead route."""
    if not isinstance(route, dict):
        return None
    route_type = str(route.get("route_type") or "")
    source = str(route.get("source") or "")
    route_id = str(route.get("route_id") or "")
    if route_type == "investigative_lead" or source == "clue_policy.leads" or route_id.startswith("clue:"):
        if route_id.startswith("clue:"):
            clue_id = route_id.split(":", 1)[1].strip()
            return clue_id or None
        cue = str(route.get("cue") or "").strip()
        return cue or None
    return None


def _collect_signpost_updates(
    plan: dict[str, Any],
    resolution_events: list[dict[str, Any]],
) -> dict[str, str]:
    """Derive structured clue_signposts updates from this turn's plan/events.

    - CHOICE / clue leads offered to the player → mentioned
    - failed obscured perception (clue_withheld) → obvious
    """
    updates: dict[str, str] = {}

    def bump(clue_id: Any, level: str) -> None:
        cid = str(clue_id or "").strip()
        if not cid:
            return
        current = updates.get(cid)
        if current is None or _SIGNPOST_RANK.get(level, 0) > _SIGNPOST_RANK.get(current, 0):
            updates[cid] = level

    policy = plan.get("clue_policy") or {}
    for cid in policy.get("leads") or []:
        bump(cid, "mentioned")

    choice_frame = plan.get("choice_frame") or (plan.get("narrative_directives") or {}).get("choice_frame") or {}
    for route in choice_frame.get("routes") or []:
        if not isinstance(route, dict):
            continue
        clue_id = _clue_id_from_choice_route(route)
        if clue_id:
            bump(clue_id, "mentioned")

    for event in resolution_events:
        if not isinstance(event, dict):
            continue
        if event.get("event_type") == "clue_withheld":
            for cid in event.get("clue_ids") or []:
                bump(cid, "obvious")
    return updates


def _merge_clue_signposts(world: dict[str, Any], updates: dict[str, str]) -> dict[str, str]:
    """Merge signpost updates into world-state; never downgrade a stronger level."""
    existing = world.get("clue_signposts")
    merged: dict[str, str] = {}
    if isinstance(existing, dict):
        for clue_id, level in existing.items():
            normalized = _normalize_signpost_level(level)
            if normalized and normalized != "unmentioned":
                merged[str(clue_id)] = normalized
    for clue_id, level in updates.items():
        normalized = _normalize_signpost_level(level)
        if not normalized or normalized == "unmentioned":
            continue
        current = merged.get(clue_id)
        if current is None or _SIGNPOST_RANK.get(normalized, 0) > _SIGNPOST_RANK.get(current, 0):
            merged[clue_id] = normalized
    return merged

coc_time = None
try:
    coc_time = _load_sibling("coc_time", "coc_time.py")
except Exception:
    coc_time = None

coc_threat_state = None
try:
    coc_threat_state = _load_sibling("coc_threat_state", "coc_threat_state.py")
except Exception:
    coc_threat_state = None

coc_async_recorder = None
try:
    coc_async_recorder = _load_sibling("coc_async_recorder", "coc_async_recorder.py")
except Exception:
    coc_async_recorder = None

coc_scenario = None
try:
    coc_scenario = _load_sibling("coc_scenario", "coc_scenario.py")
except Exception:
    coc_scenario = None

_ACTIVE_JSONL_RECORDER = None


def _read_json(path: Path, fallback: Any) -> Any:
    if not path.exists():
        return fallback
    return json.loads(path.read_text(encoding="utf-8"))


def _write_json(path: Path, payload: Any) -> None:
    """Atomic JSON write via coc_fileio (fsync + os.replace)."""
    coc_fileio.write_json_atomic(
        path, payload, indent=2, ensure_ascii=False, trailing_newline=True
    )


def _resolve_scenario_id(campaign_dir: Path, world: dict[str, Any]) -> str | None:
    """Resolve scenario_id from structured campaign/world/module-meta fields."""
    for candidate in (
        world.get("scenario_id"),
        _read_json(campaign_dir / "campaign.json", {}).get("scenario_id"),
        _read_json(campaign_dir / "scenario" / "module-meta.json", {}).get("scenario_id"),
    ):
        if candidate not in (None, "", [], {}):
            return str(candidate)
    return None


def _is_terminal_scene(
    scene: dict[str, Any],
    scenes: list[dict[str, Any]] | None = None,
    story_graph: dict[str, Any] | None = None,
) -> bool:
    """True when structured scene evidence marks a scenario ending beat.

    Uses only structured fields (Semantic Matcher Constitution):
    ``is_final``, ``scene_type == "resolution"``, no outgoing scene_edges,
    or LEGACY last story-graph entry when edges are undeclared.
    """
    if story_graph is None and scenes is not None:
        story_graph = {"scenes": scenes}
    return coc_scene_graph.is_terminal_scene(scene, story_graph)


def _truthy_flag_ids(flags_doc: dict[str, Any] | None) -> set[str]:
    """Structured flag ids that are currently set (truthy values)."""
    if not isinstance(flags_doc, dict):
        return set()
    raw = flags_doc.get("flags")
    if not isinstance(raw, dict):
        return set()
    return {str(k) for k, v in raw.items() if v}


def _source_head_is_bound(
    flags_doc: dict[str, Any], head: dict[str, Any], campaign_dir: Path
) -> bool:
    """Return whether a typed flag head has an integrity-bound source receipt."""
    director_receipts = flags_doc.get(
        coc_flag_state.DIRECTOR_FLAG_RECEIPTS_KEY
    ) or {}
    if not coc_flag_state.valid_director_flag_receipt_map(director_receipts):
        raise ValueError("canonical director flag receipt map is invalid")
    for receipt in director_receipts.values():
        if receipt.get("entity_head") == head:
            canonical, pending = _director_flag_event_observations(
                campaign_dir, str(receipt["event_id"])
            )
            if any(row != receipt["event"] for row in [*canonical, *pending]):
                raise ValueError("later director flag event conflicts with its receipt")
            if len(canonical) > 1 or len(pending) > 1:
                raise ValueError("later director flag event is duplicated")
            return True
    operation_receipts = flags_doc.get("operation_receipts") or {}
    tool_receipts = (
        operation_receipts.get("state.set_flag")
        if isinstance(operation_receipts, dict)
        else None
    ) or {}
    if isinstance(tool_receipts, dict):
        for receipt in tool_receipts.values():
            if not isinstance(receipt, dict) or receipt.get("schema_version") != 3:
                continue
            body = {
                key: deepcopy(value)
                for key, value in receipt.items()
                if key != "integrity_digest"
            }
            if (
                receipt.get("entity_head") == head
                and receipt.get("tool") == "state.set_flag"
                and str(receipt.get("decision_id") or "")
                == str(head.get("decision_id") or "")
                and str(head.get("producer") or "") == "state.set_flag"
                and str(receipt.get("integrity_digest") or "")
                == coc_flag_state.canonical_digest(body)
                and isinstance(receipt.get("event"), dict)
                and receipt["event"].get("event_type") == "flag_set"
                and str(receipt["event"].get("flag_id") or "")
                == str(head.get("entity_id") or "")
                and str(receipt["event"].get("decision_id") or "")
                == str(head.get("decision_id") or "")
                and str(receipt["event"].get("event_id") or "")
                == str(receipt.get("event_id") or "")
                and receipt["event"].get("live_head_digest")
                == coc_flag_state.canonical_digest(head)
            ):
                canonical, pending = _director_flag_event_observations(
                    campaign_dir, str(receipt["event_id"])
                )
                if any(row != receipt["event"] for row in [*canonical, *pending]):
                    raise ValueError("later toolbox flag event conflicts with its receipt")
                if len(canonical) > 1 or len(pending) > 1:
                    raise ValueError("later toolbox flag event is duplicated")
                return True
    return False


def _validate_director_flag_live_state(
    flags_doc: dict[str, Any], receipt: dict[str, Any], campaign_dir: Path
) -> None:
    """Validate source state without rolling an older receipt over a later head."""
    target = receipt["entity_head"]
    flag_id = str(receipt["flag_id"])
    heads = flags_doc.get("flag_heads")
    if not isinstance(heads, dict):
        raise ValueError("canonical flag head map is invalid")
    current = heads.get(flag_id)
    if not coc_flag_state.valid_entity_head(
        current, entity_kind="flag", entity_id=flag_id
    ):
        raise ValueError(f"flag '{flag_id}' has no valid live head")
    target_sequence = int(target["source_sequence"])
    current_sequence = int(current["source_sequence"])
    if current_sequence < target_sequence:
        raise ValueError(f"flag '{flag_id}' live head predates its source receipt")
    if current_sequence == target_sequence and current != target:
        raise ValueError(f"flag '{flag_id}' live head conflicts with its source receipt")
    if current_sequence > target_sequence and not _source_head_is_bound(
        flags_doc, current, campaign_dir
    ):
        raise ValueError(f"flag '{flag_id}' later live head has no source anchor")
    actual = coc_flag_state.flag_live_record(flags_doc, flag_id)
    if actual != current["live_record"]:
        raise ValueError(f"flag '{flag_id}' live record conflicts with its source head")


def _pending_jsonl_records(
    campaign_dir: Path, relative_path: str
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    pending_dir = campaign_dir / "logs" / "pending-turns"
    if not pending_dir.is_dir():
        return rows
    for path in sorted(pending_dir.glob("*.json")):
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError) as exc:
            raise ValueError(f"unreadable pending recorder batch: {path.name}") from exc
        if not isinstance(payload, dict) or not isinstance(payload.get("entries"), list):
            raise ValueError(f"invalid pending recorder batch: {path.name}")
        for entry in payload.get("entries") or []:
            if (
                isinstance(entry, dict)
                and entry.get("relative_path") == relative_path
                and isinstance(entry.get("record"), dict)
            ):
                rows.append(entry["record"])
    return rows


def _director_flag_event_observations(
    campaign_dir: Path, event_id: str
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    canonical: list[dict[str, Any]] = []
    events_path = campaign_dir / "logs" / "events.jsonl"
    if events_path.is_file():
        try:
            for line in events_path.read_text(encoding="utf-8").splitlines():
                if not line.strip():
                    continue
                row = json.loads(line)
                if isinstance(row, dict) and str(row.get("event_id") or "") == event_id:
                    canonical.append(row)
        except (OSError, UnicodeError, json.JSONDecodeError) as exc:
            raise ValueError("canonical events log is unreadable") from exc
    pending = [
        row
        for row in _pending_jsonl_records(campaign_dir, "logs/events.jsonl")
        if str(row.get("event_id") or "") == event_id
    ]
    recorder = _ACTIVE_JSONL_RECORDER
    if recorder is not None:
        for entry in getattr(recorder, "entries", []):
            if (
                isinstance(entry, dict)
                and entry.get("relative_path") == "logs/events.jsonl"
                and isinstance(entry.get("record"), dict)
                and str(entry["record"].get("event_id") or "") == event_id
            ):
                pending.append(entry["record"])
    return canonical, pending


def _ensure_director_flag_event(
    campaign_dir: Path,
    receipt: dict[str, Any],
    *,
    materialize_pending: bool = False,
) -> bool:
    lock = (
        coc_async_recorder.recorder_lock(campaign_dir)
        if materialize_pending and coc_async_recorder is not None
        else nullcontext()
    )
    with lock:
        if not coc_flag_state.valid_director_flag_receipt(receipt):
            raise ValueError("director flag source receipt failed integrity validation")
        expected = receipt["event"]
        event_id = str(receipt["event_id"])
        canonical, pending = _director_flag_event_observations(campaign_dir, event_id)
        if any(row != expected for row in [*canonical, *pending]):
            raise ValueError(f"director flag event '{event_id}' conflicts with its source receipt")
        if len(canonical) > 1 or len(pending) > 1:
            raise ValueError(f"director flag event '{event_id}' is duplicated")
        if canonical:
            return False
        if materialize_pending:
            # Materialize synchronously under the same lock used by flushers;
            # any exact queued copy is later consumed by stable-id dedupe.
            path = campaign_dir / "logs" / "events.jsonl"
            return coc_async_recorder.ensure_stable_jsonl_record_locked(
                path, deepcopy(expected)
            )
        if pending:
            return False
        _append_jsonl(campaign_dir / "logs" / "events.jsonl", deepcopy(expected))
        return True


def _ensure_director_flag_cutover(
    campaign_dir: Path,
    flags_doc: dict[str, Any],
    receipt_map: dict[str, Any],
) -> bool:
    """Persist the canonical-line boundary at the receipt-era transition."""
    existing = flags_doc.get(coc_flag_state.FLAG_EVENT_CUTOVER_KEY)
    if existing is not None:
        if not coc_flag_state.valid_flag_event_cutover(existing):
            raise ValueError("canonical flag cutover boundary is invalid")
        return False
    events_path = campaign_dir / "logs" / "events.jsonl"
    rows: list[dict[str, Any]] = []
    if events_path.is_file():
        try:
            rows = [
                row
                for line in events_path.read_text(encoding="utf-8").splitlines()
                if line.strip()
                for row in [json.loads(line)]
                if isinstance(row, dict)
            ]
        except (OSError, UnicodeError, json.JSONDecodeError) as exc:
            raise ValueError("canonical events log is unreadable") from exc
    line_by_event_id = {
        str(row.get("event_id") or ""): line_number
        for line_number, row in enumerate(rows, start=1)
        if str(row.get("event_id") or "")
    }
    receipt_candidates = list(receipt_map.values())
    toolbox_receipts = (
        (flags_doc.get("operation_receipts") or {}).get("state.set_flag") or {}
    )
    if not isinstance(toolbox_receipts, dict):
        raise ValueError("canonical toolbox flag receipt map is invalid")
    for receipt in toolbox_receipts.values():
        if not isinstance(receipt, dict):
            raise ValueError("canonical toolbox flag receipt is invalid")
        if receipt.get("schema_version") == 2:
            continue
        head = receipt.get("entity_head")
        if (
            receipt.get("schema_version") != 3
            or not coc_flag_state.valid_entity_head(head)
            or not _source_head_is_bound(flags_doc, head, campaign_dir)
        ):
            raise ValueError("canonical toolbox flag receipt is invalid")
        receipt_candidates.append(receipt)
    if not receipt_candidates:
        return False
    receipts = sorted(
        receipt_candidates,
        key=lambda receipt: (
            int(receipt["entity_head"]["source_sequence"]),
            str(receipt.get("event_id") or ""),
        ),
    )
    anchored_lines = [
        line_by_event_id[str(receipt["event_id"])]
        for receipt in receipts
        if str(receipt["event_id"]) in line_by_event_id
    ]
    first = receipts[0]
    flags_doc[coc_flag_state.FLAG_EVENT_CUTOVER_KEY] = (
        coc_flag_state.new_flag_event_cutover(
            events_line_count_before=(min(anchored_lines) - 1)
            if anchored_lines
            else len(rows),
            first_source_sequence=int(first["entity_head"]["source_sequence"]),
            first_event_id=str(first["event_id"]),
        )
    )
    return True


def _reconcile_director_flag_receipts(campaign_dir: Path) -> None:
    """Finish every source-owned flag operation before a later plan."""
    path = campaign_dir / "save" / "flags.json"
    if not path.is_file():
        return
    flags_doc = _read_json(path, {})
    receipt_map = flags_doc.get(coc_flag_state.DIRECTOR_FLAG_RECEIPTS_KEY)
    if receipt_map is None:
        receipt_map = {}
    if not coc_flag_state.valid_director_flag_receipt_map(receipt_map):
        raise ValueError("canonical director flag receipt map is invalid")
    cutover_changed = _ensure_director_flag_cutover(
        campaign_dir, flags_doc, receipt_map
    )
    if cutover_changed:
        _write_json(path, flags_doc)
    for receipt in receipt_map.values():
        if not coc_flag_state.valid_director_flag_receipt(receipt):
            raise ValueError("canonical director flag receipt failed integrity validation")
        _validate_director_flag_live_state(flags_doc, receipt, campaign_dir)
        _ensure_director_flag_event(
            campaign_dir, receipt, materialize_pending=True
        )
    toolbox_receipts = (
        (flags_doc.get("operation_receipts") or {}).get("state.set_flag") or {}
    )
    if not isinstance(toolbox_receipts, dict):
        raise ValueError("canonical toolbox flag receipt map is invalid")
    for receipt in toolbox_receipts.values():
        if not isinstance(receipt, dict):
            raise ValueError("canonical toolbox flag receipt is invalid")
        if receipt.get("schema_version") == 2:
            continue
        head = receipt.get("entity_head")
        if (
            receipt.get("schema_version") != 3
            or not coc_flag_state.valid_entity_head(head)
            or not _source_head_is_bound(flags_doc, head, campaign_dir)
        ):
            raise ValueError("canonical toolbox flag receipt failed integrity validation")
        expected = receipt.get("event")
        event_id = str(receipt.get("event_id") or "")
        lock = (
            coc_async_recorder.recorder_lock(campaign_dir)
            if coc_async_recorder is not None
            else nullcontext()
        )
        with lock:
            canonical, pending = _director_flag_event_observations(
                campaign_dir, event_id
            )
            if any(row != expected for row in [*canonical, *pending]):
                raise ValueError(
                    f"toolbox flag event '{event_id}' conflicts with its source receipt"
                )
            if len(canonical) > 1 or len(pending) > 1:
                raise ValueError(f"toolbox flag event '{event_id}' is duplicated")
            if not canonical:
                path = campaign_dir / "logs" / "events.jsonl"
                coc_async_recorder.ensure_stable_jsonl_record_locked(
                    path, deepcopy(expected)
                )


def _next_director_flag_source_sequence(
    flags_doc: dict[str, Any],
    event_rows: list[dict[str, Any]],
    campaign_dir: Path,
) -> int:
    """Allocate from receipt anchors after the one-time legacy cutover."""
    stored = coc_flag_state.positive_sequence(
        flags_doc.get("flag_source_sequence")
    ) or 0
    anchored: list[int] = []
    head_digest_by_sequence: dict[int, str] = {}

    def anchor(head: dict[str, Any]) -> None:
        sequence = int(head["source_sequence"])
        digest = coc_flag_state.canonical_digest(head)
        prior = head_digest_by_sequence.get(sequence)
        if prior is not None and prior != digest:
            raise ValueError(
                f"conflicting flag source heads share sequence {sequence}"
            )
        head_digest_by_sequence[sequence] = digest
        anchored.append(sequence)
    director_receipts = flags_doc.get(
        coc_flag_state.DIRECTOR_FLAG_RECEIPTS_KEY
    ) or {}
    if not coc_flag_state.valid_director_flag_receipt_map(director_receipts):
        raise ValueError("canonical director flag receipt map is invalid")
    for receipt in director_receipts.values():
        if not coc_flag_state.valid_director_flag_receipt(receipt):
            raise ValueError("canonical director flag receipt is invalid")
        canonical, pending = _director_flag_event_observations(
            campaign_dir, str(receipt["event_id"])
        )
        if any(row != receipt["event"] for row in [*canonical, *pending]):
            raise ValueError("director flag event conflicts with its receipt")
        if len(canonical) > 1 or len(pending) > 1:
            raise ValueError("director flag event is duplicated")
        anchor(receipt["entity_head"])
    toolbox_receipts = (
        (flags_doc.get("operation_receipts") or {}).get("state.set_flag") or {}
    )
    if not isinstance(toolbox_receipts, dict):
        raise ValueError("canonical toolbox flag receipt map is invalid")
    for receipt in toolbox_receipts.values():
        if not isinstance(receipt, dict):
            raise ValueError("canonical toolbox flag receipt is invalid")
        if receipt.get("schema_version") == 2:
            continue
        if receipt.get("schema_version") != 3:
            raise ValueError("canonical toolbox flag receipt schema is invalid")
        head = receipt.get("entity_head")
        if not coc_flag_state.valid_entity_head(
            head, entity_kind="flag", entity_id=str((head or {}).get("entity_id") or "")
        ) or not _source_head_is_bound(flags_doc, head, campaign_dir):
            raise ValueError("canonical toolbox flag receipt is invalid")
        anchor(head)
    if anchored:
        anchored_max = max(anchored)
        if stored != anchored_max:
            raise ValueError(
                "flag source counter is not anchored to the latest valid receipt"
            )
        return anchored_max + 1
    return coc_flag_state.next_source_sequence(flags_doc, event_rows)


def _commit_plan_flags(
    save: Path,
    plan: dict[str, Any],
    *,
    decision_id: str,
    investigator_id: str,
    ts: str,
    events: list[dict[str, Any]],
    logs: Path,
    reason: str = "plan.flags_set",
) -> list[str]:
    """Persist ``plan.flags_set`` into save/flags.json and emit flag_set events.

    Without this path, authored ``flag_set`` unlock/exit conditions can never
    become true under the deterministic planner (flags map stayed empty).
    """
    raw_flags = plan.get("flags_set")
    if not isinstance(raw_flags, list):
        return []
    flag_ids = [str(flag_id).strip() for flag_id in raw_flags if str(flag_id).strip()]
    if not flag_ids:
        return []
    flags_path = save / "flags.json"
    flags_doc = _read_json(flags_path, {
        "schema_version": 1,
        "campaign_id": None,
        "scenario_id": None,
        "clues_found": {},
        "decisions": [],
        "spoiler_reveals": [],
        "flags": {},
    })
    if not isinstance(flags_doc.get("flags"), dict):
        flags_doc["flags"] = {}
    receipt_map = flags_doc.get(coc_flag_state.DIRECTOR_FLAG_RECEIPTS_KEY)
    if receipt_map is None:
        receipt_map = {}
        flags_doc[coc_flag_state.DIRECTOR_FLAG_RECEIPTS_KEY] = receipt_map
    if not coc_flag_state.valid_director_flag_receipt_map(receipt_map):
        raise ValueError("canonical director flag receipt map is invalid")
    event_rows = []
    events_path = logs / "events.jsonl"
    if events_path.is_file():
        try:
            event_rows = [
                row
                for line in events_path.read_text(encoding="utf-8").splitlines()
                if line.strip()
                for row in [json.loads(line)]
                if isinstance(row, dict)
            ]
        except (OSError, UnicodeError, json.JSONDecodeError):
            event_rows = []
    committed: list[str] = []
    for flag_id in flag_ids:
        receipt_key = coc_flag_state.director_flag_receipt_key(
            decision_id, flag_id
        )
        prior_receipt = receipt_map.get(receipt_key)
        if prior_receipt is not None:
            if not coc_flag_state.valid_director_flag_receipt(
                prior_receipt, decision_id=decision_id, flag_id=flag_id
            ):
                raise ValueError(
                    f"director flag receipt for '{flag_id}' failed integrity validation"
                )
            operation = prior_receipt["operation"]
            if operation.get("value") is not True:
                raise ValueError(
                    f"director decision '{decision_id}' was retried with a different flag operation"
                )
            _validate_director_flag_live_state(
                flags_doc, prior_receipt, logs.parent
            )
            _ensure_director_flag_event(logs.parent, prior_receipt)
            ev = deepcopy(prior_receipt["event"])
            if not any(
                str(row.get("event_id") or "") == str(ev["event_id"])
                for row in events
                if isinstance(row, dict)
            ):
                events.append(ev)
            committed.append(flag_id)
            event_rows.append(ev)
            continue
        if flags_doc["flags"].get(flag_id):
            continue
        source_sequence = _next_director_flag_source_sequence(
            flags_doc, event_rows, logs.parent
        )
        try:
            ev, _provenance, head = coc_flag_state.commit_flag_mutation(
                flags_doc,
                flag_id=flag_id,
                value=True,
                decision_id=decision_id,
                producer="coc_director_apply",
                changed_at=ts,
                reason=reason,
                source_ref=f"save/flags.json#flag_provenance/{flag_id}",
                source_sequence=source_sequence,
                event_id=coc_flag_state.director_flag_event_id(
                    decision_id, flag_id
                ),
                investigator_id=investigator_id,
            )
        except ValueError as exc:
            raise ValueError(f"cannot persist structured flag mutation: {exc}") from exc
        receipt = coc_flag_state.new_director_flag_receipt(
            decision_id=decision_id,
            flag_id=flag_id,
            value=True,
            reason=reason,
            event=ev,
            entity_head=head,
        )
        receipt_map[receipt_key] = receipt
        _ensure_director_flag_cutover(logs.parent, flags_doc, receipt_map)
        # The live transition, typed head, and source-owned receipt commit as
        # one atomic source write.  Event/recorder durability is reconciled
        # afterwards by stable event id on this call or any retry.
        _write_json(flags_path, flags_doc)
        committed.append(flag_id)
        events.append(deepcopy(ev))
        _ensure_director_flag_event(logs.parent, receipt)
        event_rows.append(ev)
    return committed


def _maybe_emit_session_ending(
    campaign_dir: Path,
    plan: dict[str, Any],
    *,
    world: dict[str, Any],
    investigator_id: str,
    decision_id: str,
    ts: str,
) -> dict[str, Any] | None:
    """Emit playtest-shaped ``session_ending`` when PAYOFF lands on a terminal scene.

    Trigger (structured only; see module docstring): ``scene_action == "PAYOFF"``
    and the active story-graph scene is terminal via ``is_final``,
    ``scene_type == "resolution"``, no outgoing edges, or legacy last-in-``scenes``.
    """
    story_graph_path = campaign_dir / "scenario" / "story-graph.json"
    if not story_graph_path.exists():
        return None
    story = _read_json(story_graph_path, {"scenes": []})
    scenes = [s for s in story.get("scenes", []) if isinstance(s, dict)]
    current_scene_id = world.get("active_scene_id")
    current_scene = next(
        (s for s in scenes if s.get("scene_id") == current_scene_id),
        None,
    )
    conclusion = current_scene.get("conclusion_contract") if isinstance(current_scene, dict) else None
    outcome_receipt = None
    if isinstance(conclusion, dict):
        outcome_receipt = next((
            item for item in world.get("scenario_outcome_receipts", []) or []
            if isinstance(item, dict)
            and item.get("status") == "completed"
            and item.get("conclusion_id") == conclusion.get("conclusion_id")
            and item.get("scene_id") == current_scene_id
            and item.get("session_ending") is True
        ), None)
        if outcome_receipt is None:
            return None
    elif plan.get("scene_action") != "PAYOFF":
        return None
    if current_scene is None or not _is_terminal_scene(
        current_scene, scenes, story_graph=story
    ):
        return None
    scenario_id = _resolve_scenario_id(campaign_dir, world)
    return {
        "type": "session_ending",
        "event_type": "session_ending",
        "actor": investigator_id,
        "decision_id": decision_id,
        "investigator_id": investigator_id,
        "payload": {
            "scenario_id": scenario_id,
            "scene_id": current_scene_id,
            "summary": (
                outcome_receipt.get("player_visible_outcome")
                if isinstance(outcome_receipt, dict)
                else f"scenario ending on scene {current_scene_id}"
            ),
        },
        "scenario_id": scenario_id,
        "scene_id": current_scene_id,
        "ts": ts,
        "rule_ref": "core.keeper.ending_a_story",
    }


def _commit_structured_scenario_outcome(
    campaign_dir: Path,
    world: dict[str, Any],
    rules_results: list[dict[str, Any]],
    *,
    investigator_id: str,
    decision_id: str,
    ts: str,
) -> dict[str, Any] | None:
    story = _read_json(campaign_dir / "scenario" / "story-graph.json", {"scenes": []})
    scene_id = str(world.get("active_scene_id") or "")
    scene = next((
        row for row in story.get("scenes", []) or []
        if isinstance(row, dict) and str(row.get("scene_id") or "") == scene_id
    ), None)
    conclusion = scene.get("conclusion_contract") if isinstance(scene, dict) else None
    if not isinstance(conclusion, dict):
        return None
    reward = conclusion.get("sanity_reward")
    if not isinstance(reward, dict):
        return None
    settled = next((
        row for row in rules_results
        if isinstance(row, dict)
        and row.get("event_type") == "sanity_rewarded"
        and row.get("source") == conclusion.get("conclusion_id")
        and row.get("rule_ref") == reward.get("rule_ref")
    ), None)
    if settled is None:
        return None
    receipts = [
        dict(item) for item in world.get("scenario_outcome_receipts", []) or []
        if isinstance(item, dict)
    ]
    if any(
        item.get("conclusion_id") == conclusion.get("conclusion_id")
        and item.get("status") == "completed"
        for item in receipts
    ):
        return None
    receipt = {
        "schema_version": 1,
        "conclusion_id": conclusion.get("conclusion_id"),
        "scene_id": scene_id,
        "status": "completed",
        "combat_outcome": conclusion.get("requires_combat_outcome"),
        "reward_roll_id": settled.get("roll_id"),
        "player_visible_outcome": conclusion.get("player_visible_outcome"),
        "session_ending": conclusion.get("session_ending") is True,
        "decision_id": decision_id,
        "ts": ts,
    }
    receipts.append(receipt)
    world["scenario_outcome_receipts"] = receipts[-64:]
    _write_json(campaign_dir / "save" / "world-state.json", world)
    return {
        "event_type": "scenario_outcome_committed",
        "decision_id": decision_id,
        "investigator_id": investigator_id,
        **receipt,
        "summary": f"structured scenario outcome committed: {receipt['conclusion_id']}",
    }


def _typed_completion_milestones(
    campaign_dir: Path,
    world: dict[str, Any],
    rules_results: list[dict[str, Any]],
    *,
    investigator_id: str,
    decision_id: str,
    ts: str,
) -> list[dict[str, Any]]:
    """Project strict completion milestones from settled subsystem evidence.

    The detailed subsystem ledger remains authoritative.  These compact
    wrappers give full-module evaluation a stable ``combat`` / ``reward``
    vocabulary without pretending that merely starting combat completed it.
    """
    milestones: list[dict[str, Any]] = []
    combat_sources = [
        row for row in rules_results
        if isinstance(row, dict)
        and row.get("event_type") in {
            "combat_turn_resolved", "combat_special_resolution", "combat_ended",
        }
    ]
    combat_state = _read_json(campaign_dir / "save" / "combat.json", {})
    if combat_sources and combat_state.get("status") == "concluded":
        source = combat_sources[-1]
        milestones.append({
            "type": "combat",
            "event_type": "combat",
            "actor": investigator_id,
            "decision_id": decision_id,
            "investigator_id": investigator_id,
            "command_id": source.get("command_id"),
            "scenario_id": _resolve_scenario_id(campaign_dir, world),
            "scene_id": world.get("active_scene_id"),
            "payload": {
                "combat_id": combat_state.get("combat_id"),
                "outcome": combat_state.get("outcome"),
                "source_event_type": source.get("event_type"),
            },
            "ts": ts,
        })
    reward_source = next((
        row for row in rules_results
        if isinstance(row, dict) and row.get("event_type") == "sanity_rewarded"
    ), None)
    if reward_source is not None:
        milestones.append({
            "type": "reward",
            "event_type": "reward",
            "actor": investigator_id,
            "decision_id": decision_id,
            "investigator_id": investigator_id,
            "command_id": reward_source.get("command_id"),
            "scenario_id": _resolve_scenario_id(campaign_dir, world),
            "scene_id": world.get("active_scene_id"),
            "payload": {
                "reward_kind": "sanity",
                "roll_id": reward_source.get("roll_id"),
                "delta": reward_source.get("delta"),
                "source": reward_source.get("source"),
                "rule_ref": reward_source.get("rule_ref"),
            },
            "ts": ts,
        })
    return milestones


def _lookup_clock_def(campaign_dir: Path, clock_id: str) -> dict[str, Any] | None:
    """Find a clock definition in scenario/threat-fronts.json by clock_id."""
    tf_path = campaign_dir / "scenario" / "threat-fronts.json"
    if not tf_path.is_file():
        return None
    tf = _read_json(tf_path, {"fronts": []})
    for front in tf.get("fronts", []):
        for clock in front.get("clocks", []):
            if clock.get("clock_id") == clock_id:
                return clock
    return None


def _find_clue_record(campaign_dir: Path, clue_id: str) -> dict[str, Any] | None:
    """Find a clue dict by id across all conclusions in scenario/clue-graph.json.

    Returns None when the file is missing or the clue is not registered. This
    is how clue_reveal resolves optional fields (e.g. handout_asset_id) that the
    director plan does not carry inline.
    """
    cg_path = campaign_dir / "scenario" / "clue-graph.json"
    if not cg_path.is_file():
        return None
    cg = _read_json(cg_path, {"conclusions": []})
    for concl in cg.get("conclusions", []):
        for clue in concl.get("clues", []):
            if clue.get("clue_id") == clue_id:
                return clue
    return None


def _resolve_handout_for_clue(
    campaign_dir: Path, clue: dict[str, Any] | None
) -> dict[str, Any]:
    """Resolve a clue's handout asset into clue_reveal payload fields.

    Reads the clue record's optional ``handout_asset_id`` and, when set, looks
    up the asset in index/handout-assets.json (via coc_scenario.load_handout_assets)
    to surface its title/summary and a player_visible rendering hint.

    Returns an empty dict when the clue has no handout_asset_id, when the asset
    is unregistered, or when the reader is unavailable — keeping clue_reveal
    backward compatible with all existing scenarios (none currently ship assets).
    """
    if not clue:
        return {}
    asset_id = clue.get("handout_asset_id")
    if not isinstance(asset_id, str) or not asset_id:
        return {}
    if coc_scenario is None or not hasattr(coc_scenario, "load_handout_assets"):
        return {"handout_asset_id": asset_id}
    assets = coc_scenario.load_handout_assets(campaign_dir)
    asset = assets.get(asset_id)
    if not asset:
        # id is set but asset not registered — surface the ref so the gap is
        # visible to consumers, without fabricated display info.
        return {"handout_asset_id": asset_id}
    fields: dict[str, Any] = {"handout_asset_id": asset_id}
    if isinstance(asset.get("title"), str):
        fields["handout_title"] = asset["title"]
    if isinstance(asset.get("summary"), str):
        fields["handout_summary"] = asset["summary"]
    if "player_visible" in asset:
        fields["player_visible"] = bool(asset["player_visible"])
    return fields


def _apply_scene_on_enter(
    campaign_dir: Path, scene: dict[str, Any],
    decision_id: str, investigator_id: str, ts: str,
    events: list[dict[str, Any]], logs: Path,
) -> None:
    """Fire a scene's on_enter hooks when it is entered.

    Currently handles ``on_enter.clock_ticks`` and ``on_enter.sets_flags``.
    SAN triggers are emitted by the director as rules_requests (see
    _build_rules_requests), not here, because the director owns the request
    layer and this layer owns persistence.
    """
    on_enter = scene.get("on_enter") or {}
    clock_ticks = on_enter.get("clock_ticks") or []
    save = campaign_dir / "save"

    # Emit a scene_enter event so downstream consumers know on_enter fired.
    enter_ev = {
        "event_type": "scene_enter", "decision_id": decision_id,
        "to_scene": scene.get("scene_id"),
        "investigator_id": investigator_id, "ts": ts,
    }
    events.append(enter_ev)
    _append_jsonl(logs / "events.jsonl", enter_ev)

    sets_flags = on_enter.get("sets_flags") or []
    if isinstance(sets_flags, list) and sets_flags:
        _commit_plan_flags(
            save,
            {"flags_set": sets_flags},
            decision_id=decision_id,
            investigator_id=investigator_id,
            ts=ts,
            events=events,
            logs=logs,
            reason="scene.on_enter.sets_flags",
        )

    for tick_index, tick_spec in enumerate(clock_ticks):
        if not isinstance(tick_spec, dict):
            continue
        clock_id = tick_spec.get("clock_id")
        if not clock_id:
            continue
        clock_def = _lookup_clock_def(campaign_dir, clock_id)
        segments = int(clock_def.get("segments", 6)) if clock_def else 6
        symptom = ""
        if clock_def:
            ticks_visible = clock_def.get("on_tick_visible", [])
            current = coc_threat_state.get_clock_segments(save, clock_id) if coc_threat_state else 0
            if ticks_visible and isinstance(ticks_visible, list):
                symptom = ticks_visible[min(current, len(ticks_visible) - 1)]
        tick_ev = {
            "event_type": "pressure_tick", "decision_id": decision_id,
            "clock_id": clock_id, "visible_symptom": symptom,
            "reason": tick_spec.get("reason", "scene on_enter"),
            "investigator_id": investigator_id, "ts": ts,
        }
        events.append(tick_ev)
        _append_jsonl(logs / "events.jsonl", tick_ev)
        if coc_threat_state is not None:
            became_full = coc_threat_state.tick_clock(
                save, clock_id, segments,
                source_id=(
                    f"director:{decision_id}:scene-enter:{scene.get('scene_id')}:"
                    f"clock:{clock_id}:{tick_index}"
                ),
            )
            if became_full and clock_def:
                full_ev = {
                    "event_type": "clock_full", "decision_id": decision_id,
                    "clock_id": clock_id, "on_full": clock_def.get("on_full", ""),
                    "investigator_id": investigator_id, "ts": ts,
                }
                events.append(full_ev)
                _append_jsonl(logs / "events.jsonl", full_ev)


def _append_jsonl(path: Path, record: dict[str, Any]) -> None:
    if _ACTIVE_JSONL_RECORDER is not None:
        _ACTIVE_JSONL_RECORDER.append_jsonl(path, record)
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")


def _npc_receipt_document(campaign_dir: Path) -> dict[str, Any]:
    try:
        return coc_npc_event_chain.load_receipt_document(campaign_dir)
    except ValueError as exc:
        raise ValueError(f"canonical NPC engagement receipt source is invalid: {exc}") from exc


def _save_npc_receipt_document(
    campaign_dir: Path, document: dict[str, Any]
) -> None:
    _write_json(
        campaign_dir / "save" / coc_npc_event_chain.RECEIPT_FILENAME,
        document,
    )


def _npc_event_observations(
    campaign_dir: Path, relative_path: str, event_id: str
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    canonical: list[dict[str, Any]] = []
    path = campaign_dir / relative_path
    if path.is_file():
        try:
            for line in path.read_text(encoding="utf-8").splitlines():
                if not line.strip():
                    continue
                row = json.loads(line)
                if isinstance(row, dict) and str(row.get("event_id") or "") == event_id:
                    canonical.append(row)
        except (OSError, UnicodeError, json.JSONDecodeError) as exc:
            raise ValueError(f"canonical NPC event log '{relative_path}' is unreadable") from exc
    pending = [
        row
        for row in _pending_jsonl_records(campaign_dir, relative_path)
        if str(row.get("event_id") or "") == event_id
    ]
    recorder = _ACTIVE_JSONL_RECORDER
    if recorder is not None:
        for entry in getattr(recorder, "entries", []):
            if (
                isinstance(entry, dict)
                and entry.get("relative_path") == relative_path
                and isinstance(entry.get("record"), dict)
                and str(entry["record"].get("event_id") or "") == event_id
            ):
                pending.append(entry["record"])
    return canonical, pending


def _ensure_npc_event_target(
    campaign_dir: Path,
    receipt: dict[str, Any],
    relative_path: str,
    *,
    materialize_pending: bool = False,
) -> bool:
    lock = (
        coc_async_recorder.recorder_lock(campaign_dir)
        if materialize_pending and coc_async_recorder is not None
        else nullcontext()
    )
    with lock:
        if not coc_npc_event_chain.valid_receipt(receipt):
            raise ValueError("NPC engagement source receipt failed integrity validation")
        event = receipt["event"]
        event_id = str(receipt["event_id"])
        canonical, pending = _npc_event_observations(
            campaign_dir, relative_path, event_id
        )
        if any(row != event for row in [*canonical, *pending]):
            raise ValueError(
                f"NPC engagement event '{event_id}' conflicts in {relative_path}"
            )
        if len(canonical) > 1 or len(pending) > 1:
            raise ValueError(
                f"NPC engagement event '{event_id}' is duplicated in {relative_path}"
            )
        if canonical:
            return False
        if materialize_pending:
            path = campaign_dir / relative_path
            return coc_async_recorder.ensure_stable_jsonl_record_locked(
                path, deepcopy(event)
            )
        if pending:
            return False
        _append_jsonl(campaign_dir / relative_path, deepcopy(event))
        return True


def _ensure_npc_receipt_targets(
    campaign_dir: Path,
    receipt: dict[str, Any],
    *,
    materialize_pending: bool = False,
) -> None:
    _ensure_npc_event_target(
        campaign_dir,
        receipt,
        "logs/events.jsonl",
        materialize_pending=materialize_pending,
    )
    if receipt.get("producer") == "director_apply.npc_move":
        event_type = str(receipt.get("event_type") or "")
        secondary = (
            "logs/npc-engagement.jsonl"
            if event_type == "npc_engagement"
            else "logs/npc-agency.jsonl"
        )
        _ensure_npc_event_target(
            campaign_dir,
            receipt,
            secondary,
            materialize_pending=materialize_pending,
        )


def _reconcile_all_npc_source_receipts(campaign_dir: Path) -> dict[str, Any]:
    document = _npc_receipt_document(campaign_dir)
    receipts = document.get("receipts") or {}
    for receipt in sorted(
        receipts.values(),
        key=lambda row: (
            str(row.get("run_id") or ""),
            str(row.get("decision_id") or ""),
            int(row.get("ordinal") or 0),
            str(row.get("event_id") or ""),
        ),
    ):
        _ensure_npc_receipt_targets(
            campaign_dir, receipt, materialize_pending=True
        )
    return document


def _compile_director_npc_operations(
    campaign_dir: Path,
    plan: dict[str, Any],
    investigator_id: str,
) -> list[dict[str, Any]]:
    """Compile the complete ordered NPC event set without mutating state."""
    npc_agendas = _read_json(
        campaign_dir / "scenario" / "npc-agendas.json", {"npcs": []}
    )
    active_scene_id = str(
        (plan.get("turn_input") or {}).get("active_scene_id")
        or "scene:unknown"
    )
    turn_number = (plan.get("turn_input") or {}).get("turn_number")
    operations: list[dict[str, Any]] = []
    for move in plan.get("npc_moves", []) or []:
        if not isinstance(move, dict):
            continue
        requested_npc_id = move.get("npc_id")
        authored_npc = (
            coc_npc_identity.resolve_authored_npc(
                npc_agendas, str(requested_npc_id)
            )
            if requested_npc_id
            else None
        )
        npc_id = (
            str(authored_npc.get("npc_id"))
            if authored_npc is not None
            else requested_npc_id
        )
        if not npc_id:
            continue
        stable_npc_id = str(npc_id)
        identity_contract = (
            coc_npc_identity.identity_contract(authored_npc, active_scene_id)
            if authored_npc is not None
            else None
        )
        identity_binding = coc_npc_identity.identity_binding(
            identity_contract,
            structured_producer="director_apply.npc_move",
        )
        operations.append({
            "event_type": "npc_engagement",
            "ordinal": len(operations),
            "scene_id": active_scene_id,
            "npc_id": stable_npc_id,
            "payload": {
                "turn_number": turn_number,
                "interaction_kind": str(move.get("interaction_kind") or "other"),
                "identity_contract": identity_contract,
                "identity_binding": identity_binding,
                "investigator_id": investigator_id,
            },
        })
        for agency_move in move.get("agency_moves", []) or []:
            if not isinstance(agency_move, dict):
                continue
            operations.append({
                "event_type": "npc_agency",
                "ordinal": len(operations),
                "scene_id": active_scene_id,
                "npc_id": stable_npc_id,
                "payload": {
                    "turn_number": turn_number,
                    "identity_contract": identity_contract,
                    "identity_binding": identity_binding,
                    "trigger": agency_move.get("reason"),
                    "selected_move": deepcopy(agency_move),
                    "investigator_id": investigator_id,
                },
            })
    return operations


def _director_npc_operation_set_candidate(
    campaign_dir: Path,
    plan: dict[str, Any],
    investigator_id: str,
) -> tuple[dict[str, Any], dict[str, Any], bool]:
    """Return source document, immutable candidate, and prior-set presence."""
    campaign_id = coc_npc_event_chain.resolve_campaign_id(campaign_dir)
    run_id = coc_npc_event_chain.resolve_run_id(
        campaign_dir, structured_source=plan
    )
    decision_id = str(plan.get("decision_id") or "unknown")
    candidate = coc_npc_event_chain.new_decision_set_receipt(
        producer="director_apply.npc_move",
        campaign_id=campaign_id,
        run_id=run_id,
        decision_id=decision_id,
        operations=_compile_director_npc_operations(
            campaign_dir, plan, investigator_id
        ),
    )
    document = _npc_receipt_document(campaign_dir)
    decision_sets = document.get("decision_sets")
    if not isinstance(decision_sets, dict):
        raise ValueError("canonical NPC operation-set receipt map is invalid")
    prior = decision_sets.get(candidate["receipt_id"])
    if prior is not None:
        # ``put`` owns both full integrity validation and the typed payload
        # conflict.  No new state is written on this comparison path.
        coc_npc_event_chain.put_decision_set_receipt(document, candidate)
        return document, deepcopy(prior), True
    return document, candidate, False


def _freeze_director_npc_operation_set(
    campaign_dir: Path,
    document: dict[str, Any],
    candidate: dict[str, Any],
) -> dict[str, Any]:
    """Persist the whole decision set before its first event receipt/append."""
    decision_id = str(candidate["decision_id"])
    legacy_rows = [
        receipt
        for receipt in (document.get("receipts") or {}).values()
        if isinstance(receipt, dict)
        and receipt.get("producer") == "director_apply.npc_move"
        and receipt.get("campaign_id") == candidate.get("campaign_id")
        and receipt.get("run_id") == candidate.get("run_id")
        and receipt.get("decision_id") == decision_id
    ]
    if legacy_rows:
        error = coc_npc_event_chain.NpcOperationSetConflict(
            f"decision_id '{decision_id}' has legacy NPC event receipts without a pre-event operation-set receipt",
            code="legacy_recovery_unverifiable",
        )
        raise error
    coc_npc_event_chain.put_decision_set_receipt(document, candidate)
    _save_npc_receipt_document(campaign_dir, document)
    return deepcopy(candidate)


def _recover_completed_legacy_director_npc_operation_set(
    campaign_dir: Path,
    document: dict[str, Any],
    candidate: dict[str, Any],
) -> dict[str, Any]:
    """Validate and migrate one already-applied pre-operation-set decision.

    A completed applied-ledger row proves that every source-first NPC event
    receipt from the original decision should already be durable.  We migrate
    only when those receipts form one contiguous, fully reconstructable ordered
    set.  Missing/ambiguous history cannot distinguish an identical retry from
    reuse of the same idempotency key, so both cases fail closed.
    """
    decision_id = str(candidate["decision_id"])
    legacy_rows = [
        deepcopy(receipt)
        for receipt in (document.get("receipts") or {}).values()
        if isinstance(receipt, dict)
        and receipt.get("producer") == candidate.get("producer")
        and receipt.get("campaign_id") == candidate.get("campaign_id")
        and receipt.get("run_id") == candidate.get("run_id")
        and receipt.get("decision_id") == decision_id
    ]
    legacy_rows.sort(key=lambda row: int(row.get("ordinal", -1)))
    reconstructable = bool(legacy_rows) and [
        row.get("ordinal") for row in legacy_rows
    ] == list(range(len(legacy_rows)))
    reconstructed: list[dict[str, Any]] = []
    if reconstructable:
        for ordinal, receipt in enumerate(legacy_rows):
            operation = receipt.get("operation")
            if (
                not coc_npc_event_chain.valid_receipt(receipt)
                or not isinstance(operation, dict)
                or set(operation) != {"event_type", "ordinal", "payload"}
                or operation.get("event_type") != receipt.get("event_type")
                or operation.get("ordinal") != ordinal
                or not isinstance(operation.get("payload"), dict)
            ):
                reconstructable = False
                break
            reconstructed.append({
                "event_type": str(receipt["event_type"]),
                "ordinal": ordinal,
                "scene_id": str(receipt["scene_id"]),
                "npc_id": str(receipt["npc_id"]),
                "payload": deepcopy(operation["payload"]),
            })
    if not reconstructable:
        raise coc_npc_event_chain.NpcOperationSetConflict(
            f"decision_id '{decision_id}' has no unambiguous complete legacy NPC operation-set evidence",
            code="legacy_recovery_unverifiable",
        )

    recovered = coc_npc_event_chain.new_decision_set_receipt(
        producer=str(candidate["producer"]),
        campaign_id=str(candidate["campaign_id"]),
        run_id=str(candidate["run_id"]),
        decision_id=decision_id,
        operations=reconstructed,
    )
    if recovered != candidate:
        raise coc_npc_event_chain.NpcOperationSetConflict(
            f"decision_id '{decision_id}' was already applied to a different ordered NPC operation set"
        )
    coc_npc_event_chain.put_decision_set_receipt(document, recovered)
    _save_npc_receipt_document(campaign_dir, document)
    return deepcopy(recovered)


def _apply_npc_state_and_agency(
    campaign_dir: Path,
    plan: dict[str, Any],
    investigator_id: str,
    ts: str,
    operation_set_receipt: dict[str, Any],
) -> list[dict[str, Any]]:
    """Persist NPC persona cards and write one agency audit record per move."""
    save = campaign_dir / "save"
    logs = campaign_dir / "logs"
    events: list[dict[str, Any]] = []
    state_path = save / "npc-state.json"
    state = _read_json(state_path, {"schema_version": 1, "npcs": {}})
    if not isinstance(state.get("npcs"), dict):
        state["npcs"] = {}

    changed = False
    for card in plan.get("npc_state_writes", []) or []:
        if not isinstance(card, dict):
            continue
        npc_id = card.get("npc_id")
        if not npc_id:
            continue
        state["npcs"][str(npc_id)] = card
        changed = True
        generation_log = card.get("generation_log")
        if isinstance(generation_log, dict):
            record = {
                "schema_version": 1,
                "decision_id": plan.get("decision_id"),
                "turn_number": (plan.get("turn_input") or {}).get("turn_number"),
                "scene_id": (plan.get("turn_input") or {}).get("active_scene_id"),
                "investigator_id": investigator_id,
                "ts": ts,
                **generation_log,
            }
            events.append(record)
            _append_jsonl(logs / "npc-generation.jsonl", record)
            _append_jsonl(logs / "events.jsonl", record)

    for upgrade in plan.get("npc_stat_upgrades", []) or []:
        if not isinstance(upgrade, dict):
            continue
        card = upgrade.get("card")
        if not isinstance(card, dict):
            continue
        npc_id = upgrade.get("npc_id") or card.get("npc_id")
        if not npc_id:
            continue
        state["npcs"][str(npc_id)] = card
        changed = True
        raw_log = upgrade.get("log")
        if isinstance(raw_log, dict):
            record = {
                "schema_version": 1,
                "decision_id": plan.get("decision_id"),
                "turn_number": (plan.get("turn_input") or {}).get("turn_number"),
                "scene_id": (plan.get("turn_input") or {}).get("active_scene_id"),
                "investigator_id": investigator_id,
                "ts": ts,
                **raw_log,
            }
            events.append(record)
            _append_jsonl(logs / "npc-stat-upgrade.jsonl", record)
            _append_jsonl(logs / "events.jsonl", record)
    if changed:
        _write_json(state_path, state)

    if not coc_npc_event_chain.valid_decision_set_receipt(
        operation_set_receipt
    ):
        raise ValueError("director NPC operation-set receipt is invalid")
    active_scene_id = str(
        (plan.get("turn_input") or {}).get("active_scene_id") or "scene:unknown"
    )
    if any(
        operation.get("scene_id") != active_scene_id
        for operation in operation_set_receipt["operations"]
    ):
        raise ValueError("director NPC operation-set scene binding mismatch")
    decision_id = str(operation_set_receipt["decision_id"])
    campaign_id = str(operation_set_receipt["campaign_id"])
    run_id = str(operation_set_receipt["run_id"])
    if (
        decision_id != str(plan.get("decision_id") or "unknown")
        or campaign_id != coc_npc_event_chain.resolve_campaign_id(campaign_dir)
    ):
        raise ValueError("director NPC operation-set binding mismatch")
    receipt_document = _npc_receipt_document(campaign_dir)
    stored_set = (receipt_document.get("decision_sets") or {}).get(
        operation_set_receipt["receipt_id"]
    )
    if stored_set != operation_set_receipt:
        raise ValueError("director NPC operation-set source receipt is not durable")
    receipt_map = receipt_document.get("receipts")
    if not isinstance(receipt_map, dict):
        raise ValueError("canonical NPC engagement receipt map is invalid")

    def settle_npc_event(
        *,
        event_type: str,
        event_scene_id: str,
        npc_id: str,
        payload: dict[str, Any],
        event_ordinal: int,
    ) -> dict[str, Any]:
        event_id = coc_npc_event_chain.stable_event_id(
            producer="director_apply.npc_move",
            campaign_id=campaign_id,
            run_id=run_id,
            decision_id=decision_id,
            scene_id=event_scene_id,
            npc_id=npc_id,
            event_type=event_type,
            ordinal=event_ordinal,
        )
        operation = {
            "event_type": event_type,
            "ordinal": event_ordinal,
            "payload": deepcopy(payload),
        }
        prior = receipt_map.get(event_id)
        if prior is not None:
            if (
                not coc_npc_event_chain.valid_receipt(prior)
                or prior.get("operation_digest")
                != coc_npc_event_chain.canonical_digest(operation)
            ):
                raise ValueError(
                    f"director NPC event '{event_id}' conflicts with its source receipt"
                )
            _ensure_npc_receipt_targets(campaign_dir, prior)
            return deepcopy(prior["event"])
        event = {
            **deepcopy(payload),
            "schema_version": coc_npc_identity.ENGAGEMENT_EVENT_SCHEMA_VERSION,
            "event_type": event_type,
            "event_id": event_id,
            "source_receipt_schema_version": coc_npc_event_chain.RECEIPT_SCHEMA_VERSION,
            "producer": "director_apply.npc_move",
            "campaign_id": campaign_id,
            "run_id": run_id,
            "decision_id": decision_id,
            "scene_id": event_scene_id,
            "npc_id": npc_id,
            "ts": ts,
        }
        receipt = coc_npc_event_chain.new_receipt(
            producer="director_apply.npc_move",
            campaign_id=campaign_id,
            run_id=run_id,
            decision_id=decision_id,
            scene_id=event_scene_id,
            npc_id=npc_id,
            event_type=event_type,
            ordinal=event_ordinal,
            operation=operation,
            event=event,
        )
        coc_npc_event_chain.put_receipt(receipt_document, receipt)
        # Persist the source proof before either sync or queued append.  Any
        # crash window is recovered at the next apply, even for another plan.
        _save_npc_receipt_document(campaign_dir, receipt_document)
        _ensure_npc_receipt_targets(campaign_dir, receipt)
        return deepcopy(event)

    for operation in operation_set_receipt["operations"]:
        events.append(settle_npc_event(
            event_type=str(operation["event_type"]),
            event_scene_id=str(operation["scene_id"]),
            npc_id=str(operation["npc_id"]),
            event_ordinal=int(operation["ordinal"]),
            payload=deepcopy(operation["payload"]),
        ))
    return events


def _apply_npc_effects(
    campaign_dir: Path,
    plan: dict[str, Any],
    investigator_id: str,
    ts: str,
) -> list[dict[str, Any]]:
    """G3: land structured plan ``npc_effects`` on persistent NPC psych state.

    Effect shapes (structured only — Semantic Matcher Constitution):
    - {npc_id, field: trust|fear|suspicion, delta: int}       (numeric adjust)
    - {npc_id, kind: "record_fact", fact_id}
    - {npc_id, kind: "record_lie", lie_id, about?}
    - {npc_id, kind: "record_promise", promise_id, kept?}

    Idempotency comes from apply_plan's decision_id ledger (duplicate plans
    never reach this function).
    """
    logs = campaign_dir / "logs"
    events: list[dict[str, Any]] = []
    for effect in plan.get("npc_effects", []) or []:
        if not isinstance(effect, dict):
            continue
        npc_id = effect.get("npc_id")
        if not npc_id:
            continue
        kind = effect.get("kind") or "adjust"
        applied: dict[str, Any] | None = None
        if kind == "adjust" and effect.get("field") in coc_npc_state.NUMERIC_FIELDS:
            new_value = coc_npc_state.adjust(
                campaign_dir, str(npc_id), str(effect["field"]), int(effect.get("delta", 0) or 0)
            )
            applied = {"field": effect["field"], "delta": effect.get("delta"),
                       "new_value": new_value}
        elif kind == "record_fact" and effect.get("fact_id"):
            coc_npc_state.record_fact(campaign_dir, str(npc_id), str(effect["fact_id"]))
            applied = {"fact_id": effect["fact_id"]}
        elif kind == "record_lie" and effect.get("lie_id"):
            coc_npc_state.record_lie(
                campaign_dir, str(npc_id), str(effect["lie_id"]), about=effect.get("about")
            )
            applied = {"lie_id": effect["lie_id"], "about": effect.get("about")}
        elif kind == "record_promise" and effect.get("promise_id"):
            coc_npc_state.record_promise(
                campaign_dir, str(npc_id), str(effect["promise_id"]), kept=effect.get("kept")
            )
            applied = {"promise_id": effect["promise_id"], "kept": effect.get("kept")}
        elif kind == "record_leverage" and effect.get("leverage_id"):
            coc_npc_state.record_leverage(
                campaign_dir, str(npc_id), str(effect["leverage_id"])
            )
            applied = {"leverage_id": effect["leverage_id"]}
        elif kind == "set_active_reaction" and isinstance(effect.get("reaction"), dict):
            coc_npc_state.set_active_reaction(
                campaign_dir, str(npc_id), effect["reaction"]
            )
            applied = {"reaction_id": effect["reaction"].get("reaction_id")}
        elif kind == "clear_active_reaction" and effect.get("reaction_id"):
            coc_npc_state.clear_active_reaction(
                campaign_dir, str(npc_id), str(effect["reaction_id"])
            )
            applied = {"reaction_id": effect["reaction_id"]}
        elif kind == "set_availability" and effect.get("status") in {"available", "unavailable"}:
            coc_npc_state.set_availability(
                campaign_dir, str(npc_id), str(effect["status"])
            )
            applied = {"status": effect["status"]}
        if applied is None:
            continue
        record = {
            "schema_version": 1,
            "event_type": "npc_effect",
            "decision_id": plan.get("decision_id"),
            "npc_id": str(npc_id),
            "kind": kind,
            "effect": applied,
            "investigator_id": investigator_id,
            "ts": ts,
        }
        events.append(record)
        _append_jsonl(logs / "events.jsonl", record)
    return events


def _gate_social_clues_and_persist_disclosure(
    campaign_dir: Path,
    plan: dict[str, Any],
    *,
    investigator_id: str,
    decision_id: str,
    ts: str,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """Apply A21 decisions and return a clue-gated plan copy.

    A social/NPC-delivered clue is committed only when the matching structured
    disclosure decision says ``reveal``. Missing or ambiguous evidence fails
    closed. Lie/deflect state is persisted without exposing its authored text.
    """
    policy = plan.get("clue_policy") if isinstance(plan.get("clue_policy"), dict) else {}
    decisions = [d for d in (plan.get("disclosure_decisions") or []) if isinstance(d, dict)]
    if not coc_npc_state.is_social_clue_plan(plan):
        return plan, []

    events: list[dict[str, Any]] = []
    planned = [str(cid) for cid in (policy.get("reveal") or []) if cid]
    npc_agendas = _read_json(
        campaign_dir / "scenario" / "npc-agendas.json", {"npcs": []}
    )
    clue_graph = _read_json(
        campaign_dir / "scenario" / "clue-graph.json", {"conclusions": []}
    )
    contract_findings = coc_npc_state.validate_a21_contract(npc_agendas, clue_graph)
    agenda_rows: dict[str, list[dict[str, Any]]] = {}
    for agenda in (npc_agendas.get("npcs") or []) if isinstance(npc_agendas, dict) else []:
        if isinstance(agenda, dict) and agenda.get("npc_id"):
            agenda_rows.setdefault(str(agenda["npc_id"]), []).append(agenda)
    clue_rows: dict[str, list[dict[str, Any]]] = {}
    for conclusion in (clue_graph.get("conclusions") or []) if isinstance(clue_graph, dict) else []:
        if not isinstance(conclusion, dict):
            continue
        for clue in conclusion.get("clues") or []:
            if isinstance(clue, dict) and clue.get("clue_id"):
                clue_rows.setdefault(str(clue["clue_id"]), []).append(clue)

    # A single natural-language turn may intentionally combine an ordinary
    # authored affordance (for example accepting keys) with an NPC disclosure
    # request.  The A21 gate owns only clues whose structured delivery kind is
    # social; applying it to the whole clue_policy would silently discard the
    # non-social half of that same turn.
    social_planned = {
        clue_id
        for clue_id in planned
        if len(clue_rows.get(clue_id, [])) == 1
        and clue_rows[clue_id][0].get("delivery_kind")
        in coc_npc_state.SOCIAL_CLUE_DELIVERY_KINDS
    }
    non_social_planned = {
        clue_id
        for clue_id in planned
        if len(clue_rows.get(clue_id, [])) == 1
        and clue_rows[clue_id][0].get("delivery_kind")
        not in coc_npc_state.SOCIAL_CLUE_DELIVERY_KINDS
    }
    approved: list[str] = [
        clue_id for clue_id in planned if clue_id in non_social_planned
    ]

    decision_keys = [
        (str(d.get("npc_id") or ""), str(d.get("fact_id") or ""), str(d.get("clue_id") or ""))
        for d in decisions
    ]
    reveal_keys = [key for key, decision in zip(decision_keys, decisions)
                   if decision.get("outcome") == "reveal"]
    reveal_clues = [key[2] for key in reveal_keys]
    decision_clues = [key[2] for key in decision_keys if key[2]]
    ambiguous_decisions = (
        len(decision_keys) != len(set(decision_keys))
        or len(decision_clues) != len(set(decision_clues))
        or len(planned) != len(set(planned))
    )

    def canonical_reveal(decision: dict[str, Any]) -> bool:
        if contract_findings or ambiguous_decisions:
            return False
        npc_id = str(decision.get("npc_id") or "").strip()
        fact_id = str(decision.get("fact_id") or "").strip()
        clue_id = str(decision.get("clue_id") or "").strip()
        if len(agenda_rows.get(npc_id, [])) != 1 or len(clue_rows.get(clue_id, [])) != 1:
            return False
        agenda = agenda_rows[npc_id][0]
        knowledge = agenda.get("knowledge") if isinstance(agenda.get("knowledge"), dict) else {}
        facts = agenda.get("facts") if isinstance(agenda.get("facts"), list) else knowledge.get("facts", [])
        matches = [
            fact for fact in facts
            if isinstance(fact, dict) and fact.get("fact_id") == fact_id
            and fact.get("clue_id") == clue_id
        ]
        clue = clue_rows[clue_id][0]
        sources = clue.get("source_npc_ids")
        return (
            len(matches) == 1
            and isinstance(sources, list)
            and sources.count(npc_id) == 1
            and clue.get("delivery_kind") in {"npc_dialogue", "social"}
        )

    for decision in decisions:
        npc_id = str(decision.get("npc_id") or "").strip()
        outcome = str(decision.get("outcome") or "withhold")
        clue_id = str(decision.get("clue_id") or "").strip()
        if outcome == "lie" and npc_id and decision.get("lie_id"):
            coc_npc_state.record_lie(
                campaign_dir, npc_id, str(decision["lie_id"]),
                about=str(decision.get("about") or decision.get("fact_id") or "") or None,
            )
        if outcome == "deflect" and npc_id and decision.get("deflect_id"):
            coc_npc_state.record_deflection(
                campaign_dir, npc_id, str(decision["deflect_id"]),
                about=str(decision.get("fact_id") or "") or None,
            )
        reveal_valid = outcome == "reveal" and canonical_reveal(decision)
        if reveal_valid and clue_id and clue_id in social_planned:
            approved.append(clue_id)
        recorded_outcome = outcome if outcome != "reveal" or reveal_valid else "withhold"
        record = {
            "event_type": (
                "npc_disclosure_approved" if recorded_outcome == "reveal"
                else "npc_disclosure_withheld"
            ),
            "decision_id": decision_id,
            "npc_id": npc_id or None,
            "fact_id": decision.get("fact_id"),
            "clue_id": clue_id or None,
            "outcome": recorded_outcome,
            "reason_code": (
                decision.get("reason_code")
                if recorded_outcome == outcome
                else "apply_disclosure_validation_failed"
            ),
            "investigator_id": investigator_id,
            "ts": ts,
        }
        events.append(record)

    gated = _copy_jsonable(plan)
    gated_policy = dict(gated.get("clue_policy") or {})
    gated_policy["reveal"] = [cid for cid in planned if cid in set(approved)]
    gated["clue_policy"] = gated_policy
    return gated, events


def _storylet_scheduler_debug_enabled(campaign_dir: Path | None = None) -> bool:
    """Return True when optional storylet-scheduler.jsonl writing is enabled.

    Default OFF: the log has no runtime readers. Enable via env
    ``COC_DEBUG_STORYLET_SCHEDULER=1`` (or true/yes/on), or campaign.json
    ``debug.storylet_scheduler_log: true``.
    """
    raw = str(os.environ.get("COC_DEBUG_STORYLET_SCHEDULER", "") or "").strip().lower()
    if raw in {"1", "true", "yes", "on"}:
        return True
    if raw in {"0", "false", "no", "off"}:
        return False
    if campaign_dir is not None:
        campaign = _read_json(Path(campaign_dir) / "campaign.json", {})
        debug = campaign.get("debug") if isinstance(campaign, dict) else None
        if isinstance(debug, dict) and debug.get("storylet_scheduler_log") is True:
            return True
    return False


def _storylet_scheduler_record(
    plan: dict[str, Any],
    investigator_id: str,
    ts: str,
) -> dict[str, Any] | None:
    """Build one audit record explaining storylet scheduler decisions."""
    moves = [m for m in plan.get("storylet_moves", []) if isinstance(m, dict)]
    first_trace = None
    for move in moves:
        trace = move.get("scheduler_trace")
        if isinstance(trace, dict):
            first_trace = trace
            break

    enrichment = plan.get("narrative_enrichment") or {}
    scheduler = enrichment.get("storylet_scheduler") or {}
    trigger = (
        (first_trace or {}).get("storylet_trigger")
        or enrichment.get("storylet_trigger")
        or (plan.get("narrative_directives") or {}).get("storylet_trigger")
    )
    story_need = (
        (first_trace or {}).get("story_need")
        or scheduler.get("story_need")
        or (moves[0].get("story_need") if moves else None)
    )
    if not first_trace and not trigger and not story_need and not moves:
        return None

    selected = (first_trace or {}).get("selected")
    if selected is None and moves:
        selected = {
            "storylet_id": moves[0].get("storylet_id"),
            "deck_id": moves[0].get("deck_id"),
            "family_id": moves[0].get("family_id"),
            "trope_id": moves[0].get("trope_id"),
        }

    return {
        "schema_version": 1,
        "event_type": "storylet_scheduler",
        "decision_id": plan.get("decision_id", "unknown"),
        "turn_number": (plan.get("turn_input") or {}).get("turn_number"),
        "scene_id": (plan.get("turn_input") or {}).get("active_scene_id"),
        "scene_action": plan.get("scene_action"),
        "investigator_id": investigator_id,
        "ts": ts,
        "storylet_trigger": trigger,
        "story_need": story_need,
        "candidate_decks": (first_trace or {}).get("candidate_decks") or scheduler.get("candidate_decks") or [],
        "candidate_counts": (first_trace or {}).get("candidate_counts", {}),
        "selected": selected,
        "rejected_examples": (first_trace or {}).get("rejected_examples", []),
        "ledger_update": (first_trace or {}).get("ledger_update") or (moves[0].get("ledger_update") if moves else {}),
    }


_TENSION_LADDER = ["low", "medium", "high", "climax"]
_SUCCESS_OUTCOMES = {"critical", "extreme", "hard", "regular", "success",
                     # legacy aliases (some callers may emit *_success forms)
                     "extreme_success", "hard_success", "regular_success"}
_FAILURE_OUTCOMES = {"failure", "fumble"}


def _bump_tension(current: str, delta: int) -> str:
    """Move tension level by delta steps, clamped to the ladder."""
    if current not in _TENSION_LADDER:
        current = "low"
    idx = _TENSION_LADDER.index(current) + delta
    idx = max(0, min(len(_TENSION_LADDER) - 1, idx))
    return _TENSION_LADDER[idx]


def _resolve_tension_steps(
    plan: dict[str, Any],
    pressure_moves: list[dict[str, Any]],
    action: str,
) -> int:
    """Resolve pacing tension steps for this apply.

    Primary signal is ``plan["tension_delta"]`` (director emits +/−). Ladder:
    low → medium → high → climax, clamped at both ends.

    - Negative plan delta cools and is never cancelled by pressure ticks.
    - Non-negative plan delta may gain extra escalation from pressure ticks.
    - Absent plan delta: legacy derive from pressure ticks / PRESSURE|SUBSYSTEM.
    """
    pressure_ticks = sum(int(m.get("tick", 0) or 0) for m in pressure_moves)
    if "tension_delta" in plan and plan.get("tension_delta") is not None:
        try:
            steps = int(plan["tension_delta"])
        except (TypeError, ValueError):
            steps = 0
        if steps < 0:
            return steps
        if pressure_ticks > 0:
            return steps + pressure_ticks
        if steps == 0 and action in ("PRESSURE", "SUBSYSTEM"):
            return 1
        return steps
    # Legacy path: no plan tension_delta — derive from pressure / action.
    if pressure_ticks or action in ("PRESSURE", "SUBSYSTEM"):
        return max(1, pressure_ticks)
    return 0


def _first_rule_result(rules_results: list[dict[str, Any]] | None) -> dict[str, Any] | None:
    if not rules_results:
        return None
    for result in rules_results:
        if isinstance(result, dict):
            return result
    return None


def _clue_gate_skill(plan: dict[str, Any]) -> str | None:
    policy = plan.get("clue_policy", {})
    if policy.get("skill"):
        return str(policy["skill"])
    for request in plan.get("rules_requests", []) or []:
        if not isinstance(request, dict):
            continue
        if request.get("reason") == "obscured clue in scene" and request.get("skill"):
            return str(request["skill"])
    return None


def _clue_gate_contract(plan: dict[str, Any]) -> dict[str, Any] | None:
    for request in plan.get("rules_requests", []) or []:
        if not isinstance(request, dict):
            continue
        contract = request.get("roll_contract")
        if not isinstance(contract, dict):
            continue
        if contract.get("failure_outcome_mode") == "clue_with_cost":
            return contract
        if request.get("reason") == "obscured clue in scene":
            return contract
    return None


def _contracts_match_clue_gate(expected: dict[str, Any], actual: dict[str, Any] | None) -> bool:
    if not isinstance(actual, dict):
        return False
    if actual.get("failure_outcome_mode") != "clue_with_cost":
        return False
    expected_group = expected.get("roll_density_group")
    actual_group = actual.get("roll_density_group")
    if expected_group or actual_group:
        return bool(expected_group and expected_group == actual_group)
    return True


def _rule_result_matches_clue_gate(plan: dict[str, Any], result: dict[str, Any]) -> bool:
    contract = _clue_gate_contract(plan)
    if contract is not None:
        return _contracts_match_clue_gate(contract, result.get("roll_contract"))
    skill = _clue_gate_skill(plan)
    if skill is None:
        return True
    return str(result.get("skill") or "") == skill


def _clue_gate_rule_result(
    plan: dict[str, Any],
    rules_results: list[dict[str, Any]] | None,
) -> dict[str, Any] | None:
    """Pick the roll result that should gate an obscured clue reveal.

    Narrative enrichment may add player action checks after the director's
    automatic obscured-clue check. If the player later succeeds with the same
    clue skill, that success should satisfy the clue gate instead of being
    masked by an earlier duplicate failure.
    """
    if not rules_results:
        return None
    candidates = [
        result for result in rules_results
        if isinstance(result, dict) and _rule_result_matches_clue_gate(plan, result)
    ]
    if not candidates:
        if _clue_gate_contract(plan) is not None:
            return None
        return _first_rule_result(rules_results)
    for result in candidates:
        if _rule_result_success(result) is True:
            return result
    for result in candidates:
        if _rule_result_success(result) is False:
            return result
    return candidates[0]


def _rule_result_success(result: dict[str, Any] | None) -> bool | None:
    """Return True/False for resolved rolls; None when no usable result exists."""
    if result is None:
        return None
    if isinstance(result.get("success"), bool):
        return bool(result["success"])
    outcome = str(result.get("outcome", ""))
    if outcome in _SUCCESS_OUTCOMES:
        return True
    if outcome in _FAILURE_OUTCOMES:
        return False
    return None


def _first_failed_contract_result(
    plan: dict[str, Any],
    rules_results: list[dict[str, Any]] | None,
) -> tuple[dict[str, Any], dict[str, Any]] | None:
    for result in rules_results or []:
        if not isinstance(result, dict):
            continue
        if _rule_result_success(result) is not False:
            continue
        contract = result.get("roll_contract")
        if not isinstance(contract, dict):
            for request in plan.get("rules_requests", []) or []:
                if not isinstance(request, dict):
                    continue
                if request.get("skill") == result.get("skill") and isinstance(request.get("roll_contract"), dict):
                    contract = request["roll_contract"]
                    break
        if not isinstance(contract, dict):
            continue
        # Clue-bonus failures are handled via clue_policy.bonus_cost; do not
        # treat them as generic goal failures that overshadow the core reveal.
        group = str(contract.get("roll_density_group") or "")
        if contract.get("failure_outcome_mode") == "bonus_with_cost" or group.startswith("clue-bonus:"):
            continue
        return result, contract
    return None


def _obscured_reveal_requires_result(plan: dict[str, Any]) -> bool:
    policy = plan.get("clue_policy", {})
    return (
        bool(plan.get("rules_requests"))
        and plan.get("scene_action") == "REVEAL"
        and policy.get("clue_type") == "obscured"
        and bool(policy.get("reveal"))
    )


def _synthetic_pressure_move(reason: str, visible_symptom: str = "time passes and the opposition gains ground") -> dict[str, Any]:
    return {
        "clock_id": "fail-forward-cost",
        "tick": 1,
        "visible_symptom": visible_symptom,
        "reason": reason,
    }


def _idea_roll_result(
    plan: dict[str, Any],
    rules_results: list[dict[str, Any]] | None,
) -> dict[str, Any] | None:
    """Return the Idea Roll result for a RECOVER plan, if any."""
    for result in rules_results or []:
        if not isinstance(result, dict):
            continue
        if result.get("kind") == "idea_roll":
            return result
    for request in plan.get("rules_requests", []) or []:
        if isinstance(request, dict) and request.get("kind") == "idea_roll":
            # Request present but no result yet.
            return None
    return None


def _clue_bonus_request(plan: dict[str, Any]) -> dict[str, Any] | None:
    for request in plan.get("rules_requests", []) or []:
        if not isinstance(request, dict):
            continue
        contract = request.get("roll_contract") or {}
        group = str(contract.get("roll_density_group") or "")
        if request.get("clue_bonus") or group.startswith("clue-bonus:"):
            return request
    return None


def _clue_bonus_rule_result(
    plan: dict[str, Any],
    rules_results: list[dict[str, Any]] | None,
) -> dict[str, Any] | None:
    request = _clue_bonus_request(plan)
    if request is None:
        return None
    expected_group = str((request.get("roll_contract") or {}).get("roll_density_group") or "")
    for result in rules_results or []:
        if not isinstance(result, dict):
            continue
        contract = result.get("roll_contract") or {}
        group = str(contract.get("roll_density_group") or "")
        if expected_group and group == expected_group:
            return result
        if result.get("clue_bonus") or (
            result.get("skill") == request.get("skill")
            and str(contract.get("failure_outcome_mode") or "") == "bonus_with_cost"
        ):
            return result
    return None


def _apply_clue_bonus_resolution(
    plan: dict[str, Any],
    rules_results: list[dict[str, Any]] | None,
    *,
    ts: str = "",
    investigator_id: str = "",
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Resolve non-gating clue bonus rolls into events + optional pressure.

    Returns (events, extra_pressure_moves). Never withholds the core clue.
    """
    events: list[dict[str, Any]] = []
    pressure: list[dict[str, Any]] = []
    request = _clue_bonus_request(plan)
    if request is None:
        return events, pressure
    bonus = (plan.get("clue_policy") or {}).get("bonus") or request.get("bonus") or {}
    if not isinstance(bonus, dict):
        bonus = {}
    result = _clue_bonus_rule_result(plan, rules_results)
    success = _rule_result_success(result)
    decision_id = plan.get("decision_id", "unknown")
    clue_id = request.get("clue_id") or ((plan.get("clue_policy") or {}).get("reveal") or [None])[0]
    if success is None:
        events.append({
            "event_type": "clue_bonus_pending",
            "decision_id": decision_id,
            "clue_id": clue_id,
            "investigator_id": investigator_id,
            "summary": "clue bonus roll held until rule result is backfilled",
            "ts": ts,
        })
        return events, pressure
    if success is True:
        extra = str(bonus.get("extra_summary") or "").strip()
        events.append({
            "event_type": "clue_bonus_reveal",
            "decision_id": decision_id,
            "clue_id": clue_id,
            "bonus_reveal": extra,
            "investigator_id": investigator_id,
            "summary": extra or "clue bonus detail revealed",
            "ts": ts,
        })
        return events, pressure

    cost = str(bonus.get("on_fail_cost") or "time")
    if cost not in {"time", "pressure"}:
        cost = "time"
    symptom = (
        "the extra detail slips away and the search costs time"
        if cost == "time"
        else "the failed probe raises the room's tension without hiding the core find"
    )
    pressure.append(_synthetic_pressure_move("clue_bonus_fail_cost", symptom))
    events.append({
        "event_type": "clue_bonus_cost",
        "decision_id": decision_id,
        "clue_id": clue_id,
        "bonus_cost": cost,
        "investigator_id": investigator_id,
        "summary": f"clue bonus failed; core clue kept; cost={cost}",
        "ts": ts,
    })
    return events, pressure


def _resolve_committed_clues(
    plan: dict[str, Any],
    rules_results: list[dict[str, Any]] | None,
    ts: str,
    investigator_id: str,
) -> tuple[list[str], list[dict[str, Any]], list[dict[str, Any]]]:
    """Resolve which clues are actually committed this turn.

    Returns (committed_clue_ids, extra_events, extra_pressure_moves).
    The exact clue is never committed on a failed obscured roll. Instead, the
    function records a cost and preserves any fallback routes for the next beat.
    """
    decision_id = plan.get("decision_id", "unknown")
    action = plan.get("scene_action", "")
    policy = plan.get("clue_policy", {})
    events: list[dict[str, Any]] = []
    pressure: list[dict[str, Any]] = []

    reveal_ids = [cid for cid in policy.get("reveal", []) if cid]
    fallback_ids = [cid for cid in policy.get("fallback_routes", []) if cid]
    stalled = int(plan.get("rule_signals", {}).get("stalled_turns", 0) or 0)
    idea_plan = (plan.get("narrative_directives") or {}).get("idea_roll_plan") or {}

    # The original ordinary failure has already settled its ordinary cost.
    # A confirmed pushed failure applies only the exact pre-announced
    # consequence emitted by _process_push_roll_gates; replaying the generic
    # clue-with-cost branch here would charge the initial failure twice.
    if isinstance(plan.get("push_continuation"), dict) and any(
        isinstance(result, dict)
        and result.get("pushed") is True
        and _rule_result_success(result) is False
        for result in (rules_results or [])
    ):
        return [], events, pressure

    # RECOVER is the Idea Roll recovery valve. Play always continues; the roll
    # (when required) decides cost/position, not whether the lead surfaces.
    if action == "RECOVER" and stalled >= 3 and fallback_ids:
        idea_result = _idea_roll_result(plan, rules_results)
        has_idea_request = any(
            isinstance(req, dict) and req.get("kind") == "idea_roll"
            for req in (plan.get("rules_requests") or [])
        )
        free_delivery = (
            idea_plan.get("difficulty") is None
            and str(idea_plan.get("signpost_level") or "unmentioned") == "unmentioned"
            and not has_idea_request
        )
        if has_idea_request and idea_result is None:
            events.append({
                "event_type": "clue_pending_rule_result",
                "decision_id": decision_id,
                "clue_ids": fallback_ids,
                "investigator_id": investigator_id,
                "summary": "Idea Roll recovery held until rule result is backfilled",
                "ts": ts,
            })
            return [], events, pressure

        success = True if free_delivery else _rule_result_success(idea_result)
        if success is True or free_delivery:
            events.append({
                "event_type": "idea_roll_recovery",
                "decision_id": decision_id,
                "clue_id": fallback_ids[0],
                "fallback_routes": fallback_ids,
                "investigator_id": investigator_id,
                "outcome": "free" if free_delivery else str((idea_result or {}).get("outcome", "success")),
                "summary": (
                    "never-signposted lead delivered free via Idea recovery"
                    if free_delivery
                    else "Idea Roll success surfaces the lead without increasing danger"
                ),
                "ts": ts,
            })
            bonus_events, bonus_pressure = _apply_clue_bonus_resolution(
                plan, rules_results, ts=ts, investigator_id=investigator_id
            )
            events.extend(bonus_events)
            pressure.extend(bonus_pressure)
            return [fallback_ids[0]], events, pressure

        # Failed Idea Roll: still surface the lead, but in a worse position.
        pressure.append(_synthetic_pressure_move(
            "recover_fail_forward_cost",
            "the recovery lead appears, but time has clearly been lost",
        ))
        events.append({
            "event_type": "fail_forward_recovery",
            "decision_id": decision_id,
            "clue_id": fallback_ids[0],
            "fallback_routes": fallback_ids,
            "investigator_id": investigator_id,
            "outcome": str((idea_result or {}).get("outcome", "failure")),
            "summary": "Idea Roll failure surfaces the lead in the thick of it",
            "ts": ts,
        })
        bonus_events, bonus_pressure = _apply_clue_bonus_resolution(
            plan, rules_results, ts=ts, investigator_id=investigator_id
        )
        events.extend(bonus_events)
        pressure.extend(bonus_pressure)
        return [fallback_ids[0]], events, pressure

    # Obvious/direct clues remain immediate. Obscured clues with a rules_request
    # must wait for the actual roll result.
    if not _obscured_reveal_requires_result(plan):
        committed = reveal_ids
        bonus_events, bonus_pressure = _apply_clue_bonus_resolution(
            plan, rules_results, ts=ts, investigator_id=investigator_id
        )
        events.extend(bonus_events)
        pressure.extend(bonus_pressure)
        return committed, events, pressure

    result = _clue_gate_rule_result(plan, rules_results)
    success = _rule_result_success(result)
    if success is True:
        bonus_events, bonus_pressure = _apply_clue_bonus_resolution(
            plan, rules_results, ts=ts, investigator_id=investigator_id
        )
        events.extend(bonus_events)
        pressure.extend(bonus_pressure)
        return reveal_ids, events, pressure

    if success is None:
        events.append({
            "event_type": "clue_pending_rule_result",
            "decision_id": decision_id,
            "clue_ids": reveal_ids,
            "investigator_id": investigator_id,
            "summary": "obscured clue reveal held until rule result is backfilled",
            "ts": ts,
        })
        return [], events, pressure

    outcome = str((result or {}).get("outcome", "failure"))
    pressure.append(_synthetic_pressure_move(
        "failed_obscured_clue_check",
        "the failed attempt costs time and narrows the safe routes forward",
    ))
    events.append({
        "event_type": "clue_withheld",
        "decision_id": decision_id,
        "clue_ids": reveal_ids,
        "rule_outcome": outcome,
        "fallback_routes": fallback_ids,
        "investigator_id": investigator_id,
        "summary": "failed obscured clue check withheld the exact clue; fallback routes remain available",
        "ts": ts,
    })
    events.append({
        "event_type": "failure_consequence",
        "decision_id": decision_id,
        "consequence_type": "time_pressure_and_alternate_route_hint",
        "severity": "hard" if outcome == "fumble" else "regular",
        "fallback_routes": fallback_ids,
        "investigator_id": investigator_id,
        "summary": "failure advances pressure instead of ending the investigation",
        "ts": ts,
    })
    return [], events, pressure


def _commit_sealed_push_route_completion(
    plan: dict[str, Any],
    world: dict[str, Any],
    committed_clues: list[str],
    *,
    rules_results: list[dict[str, Any]] | None,
    decision_id: str,
    investigator_id: str,
    ts: str,
) -> list[dict[str, Any]] | None:
    """Settle a pushed authored route solely from its failure-time snapshot."""
    continuation = plan.get("push_continuation")
    if not isinstance(continuation, dict):
        return None
    transaction = continuation.get("sealed_route_transaction")
    if transaction is None:
        return None
    binding = continuation.get("binding")
    if (
        not isinstance(transaction, dict)
        or transaction.get("schema_version") != 1
        or transaction.get("kind") != "authored_route_completion"
        or not isinstance(binding, dict)
        or binding.get("schema_version") != 2
        or binding.get("mode") != "continuation_capsule"
        or transaction.get("scene_id") != binding.get("scene_id")
        or transaction.get("route_id") != binding.get("route_id")
        or coc_subsystem_executor._canonical_json_hash(transaction)
        != binding.get("route_transaction_sha256")
    ):
        raise ValueError("sealed Push route transaction is detached from capsule authority")
    pushed_result = next(
        (
            result for result in (rules_results or [])
            if isinstance(result, dict)
            and result.get("pushed") is True
            and result.get("success") is True
            and result.get("continuation_id") == binding.get("continuation_id")
            and result.get("continuation_idempotency_key")
            == binding.get("idempotency_key")
            and result.get("request_id") == binding.get("request_id")
        ),
        None,
    )
    if pushed_result is None:
        return []
    if transaction.get("repeatable") is True:
        return []
    route_id = str(transaction["route_id"])
    scene_id = str(transaction["scene_id"])
    receipts = [
        dict(item)
        for item in world.get("route_completion_receipts", []) or []
        if isinstance(item, dict)
    ]
    if any(
        str(item.get("route_id") or "") == route_id
        and str(item.get("scene_id") or scene_id) == scene_id
        and item.get("status") in {"consumed", "blocked"}
        for item in receipts
    ):
        return []
    completed = {
        str(item.get("route_id"))
        for item in receipts
        if item.get("status") == "consumed"
        and str(item.get("route_id") or "").strip()
        and (
            not str(item.get("scene_id") or "").strip()
            or str(item.get("scene_id")) == scene_id
        )
    }
    required = set(transaction.get("requires_completed_route_ids") or [])
    if not required.issubset(completed):
        raise ValueError("sealed Push route prerequisites changed before settlement")
    direct_grants = [str(value) for value in transaction.get("direct_grant_clue_ids") or []]
    discovered_after = {
        str(value) for value in world.get("discovered_clue_ids", []) or [] if value
    }
    receipt_clues = [
        clue_id for clue_id in direct_grants if clue_id in set(committed_clues)
    ]
    if direct_grants and (
        not receipt_clues or not set(direct_grants).issubset(discovered_after)
    ):
        return []
    flags = sorted({str(value) for value in transaction.get("sets_flags") or []})
    remaining = list(dict.fromkeys(
        str(value)
        for value in [
            *direct_grants,
            *(transaction.get("remaining_clue_ids") or []),
        ]
        if value and str(value) not in discovered_after
    ))
    request_id = str(binding["request_id"])
    outcome = str(pushed_result.get("outcome") or "success")
    receipt = {
        "schema_version": 1,
        "route_id": route_id,
        "scene_id": scene_id,
        "status": "consumed",
        "committed_clue_ids": receipt_clues,
        "committed_flag_ids": flags,
        "remaining_clue_ids": remaining,
        "rule_request_ids": [request_id],
        "rule_outcomes": [outcome],
        "success": True,
        "completion_quality": "clean",
        "decision_id": decision_id,
        "source": "push_capsule_rule_success",
        "ts": ts,
        "push_continuation": {
            "schema_version": 2,
            "choice_id": str(continuation.get("choice_id") or ""),
            "continuation_id": str(binding.get("continuation_id") or ""),
            "original_command_id": str(
                pushed_result.get("original_command_id") or ""
            ),
            "source_command_id": str(
                pushed_result.get("source_command_id") or ""
            ),
            "settlement_request_id": request_id,
            "settlement": "sealed_route_transaction_exact_once",
        },
    }
    receipts = [
        item for item in receipts
        if not (
            str(item.get("route_id") or "") == route_id
            and str(item.get("scene_id") or "") == scene_id
        )
    ]
    receipts.append(receipt)
    world["route_completion_receipts"] = receipts[-256:]
    public_goal = str(transaction.get("player_visible_goal") or "")
    public_outcome = str(transaction.get("player_visible_outcome") or "")
    return [{
        "event_type": "route_completed",
        "decision_id": decision_id,
        "route_id": route_id,
        "scene_id": scene_id,
        "committed_clue_ids": receipt_clues,
        "committed_flag_ids": flags,
        "remaining_clue_ids": remaining,
        "rule_request_ids": [request_id],
        "rule_outcomes": [outcome],
        "status": "completed",
        "success": True,
        "completion_quality": "clean",
        "player_visible_goal": public_goal,
        "player_visible_outcome": public_outcome,
        "source": "push_capsule_rule_success",
        "investigator_id": investigator_id,
        "summary": f"sealed Push route completed: {route_id}",
        "ts": ts,
        "push_continuation": dict(receipt["push_continuation"]),
    }]


def _commit_resolved_route_completions(
    campaign_dir: Path,
    plan: dict[str, Any],
    world: dict[str, Any],
    committed_clues: list[str],
    *,
    rules_results: list[dict[str, Any]] | None = None,
    decision_id: str,
    investigator_id: str,
    ts: str,
) -> list[dict[str, Any]]:
    """Persist completed authored routes from structured settlement.

    A direct clue/grant route closes when its exact authored grants are durable
    and at least one of them committed on this turn.  A generic route closes
    only when either its structured clue-affordance binding committed a
    concrete clue, or every rule request explicitly bound to that route settled
    successfully.  Free prose is never inspected.
    Repeatable/resume routes remain open, and explicitly modeled remaining
    grant IDs are recorded for choice-frame filtering.
    """
    sealed_push = _commit_sealed_push_route_completion(
        plan,
        world,
        committed_clues,
        rules_results=rules_results,
        decision_id=decision_id,
        investigator_id=investigator_id,
        ts=ts,
    )
    if sealed_push is not None:
        return sealed_push
    turn_input = plan.get("turn_input") or {}
    rich = turn_input.get("player_intent_rich") or {}
    resolution = rich.get("action_resolution") if isinstance(rich, dict) else None
    if not isinstance(resolution, dict) or resolution.get("no_match") is True:
        return []
    matched_route_ids = {
        str(value)
        for value in (
            resolution.get("matched_affordance_ids")
            or (plan.get("clue_policy") or {}).get("matched_route_ids")
            or []
        )
        if value
    }
    if not matched_route_ids:
        return []
    scene_id = str(turn_input.get("active_scene_id") or world.get("active_scene_id") or "")
    story = _read_json(
        campaign_dir / "scenario" / "story-graph.json", {"scenes": []}
    )
    scene = next(
        (
            item for item in story.get("scenes", [])
            if isinstance(item, dict) and str(item.get("scene_id") or "") == scene_id
        ),
        {},
    )
    affordances = {
        str(item.get("id") or item.get("route_id") or ""): item
        for item in scene.get("affordances", []) or []
        if isinstance(item, dict) and (item.get("id") or item.get("route_id"))
    }
    planned = {
        str(value) for value in (plan.get("clue_policy") or {}).get("reveal", []) if value
    }
    bound_committed = [
        str(value) for value in committed_clues if str(value) in planned
    ]
    linked_requests: dict[str, list[dict[str, Any]]] = {}
    for request in plan.get("rules_requests") or []:
        if not isinstance(request, dict):
            continue
        route_resolution = request.get("route_resolution")
        if not isinstance(route_resolution, dict):
            continue
        request_route_ids = list(dict.fromkeys(
            str(value or "").strip()
            for value in route_resolution.get("matched_route_ids") or []
            if str(value or "").strip()
        ))
        # One settled request may own one route only.  A legacy/malformed
        # multi-route receipt cannot turn one roll into multiple completions.
        if len(request_route_ids) != 1:
            continue
        linked_requests.setdefault(request_route_ids[0], []).append(request)
    result_by_request_id = {
        str(result.get("request_id")): result
        for result in (rules_results or [])
        if isinstance(result, dict) and result.get("request_id")
    }
    discovered_after = {
        str(value) for value in [*(world.get("discovered_clue_ids") or []), *committed_clues]
        if value
    }
    receipts = [
        dict(item)
        for item in world.get("route_completion_receipts", []) or []
        if isinstance(item, dict)
    ]
    completed_route_ids = {
        str(item.get("route_id"))
        for item in receipts
        if item.get("status") == "consumed"
        and str(item.get("route_id") or "").strip()
        and (
            not str(item.get("scene_id") or "").strip()
            or str(item.get("scene_id")) == scene_id
        )
    }
    blocked_route_ids = {
        str(item.get("route_id"))
        for item in receipts
        if item.get("status") == "blocked"
        and str(item.get("route_id") or "").strip()
        and (
            not str(item.get("scene_id") or "").strip()
            or str(item.get("scene_id")) == scene_id
        )
    }
    durable_flags = _truthy_flag_ids(
        _read_json(campaign_dir / "save" / "flags.json", {})
    )
    events: list[dict[str, Any]] = []
    generic_candidates: list[str] = []
    for route_id in sorted(matched_route_ids):
        affordance = affordances.get(route_id)
        if not isinstance(affordance, dict):
            continue
        if route_id in completed_route_ids or route_id in blocked_route_ids:
            continue
        required_route_ids = {
            str(value).strip()
            for value in affordance.get("requires_completed_route_ids", []) or []
            if str(value or "").strip()
        }
        # Re-check prerequisites at settlement.  This protects execution from
        # stale/forged resolver receipts even though the candidate projection
        # normally hides the route before semantic matching.
        if not required_route_ids.issubset(completed_route_ids):
            continue
        if (
            affordance.get("repeatable") is True
            or str(affordance.get("status") or "") in {"repeatable", "resume"}
            or str(affordance.get("completion_policy") or "") == "repeatable"
        ):
            continue
        direct_grants = [
            str(value).strip()
            for value in [
                affordance.get("clue_id"),
                *(affordance.get("grants_clue_ids") or []),
            ]
            if str(value or "").strip()
        ]
        if not direct_grants:
            generic_candidates.append(route_id)
    unique_clue_route_id = (
        generic_candidates[0] if len(generic_candidates) == 1 else None
    )
    for route_id in sorted(matched_route_ids):
        affordance = affordances.get(route_id)
        if not isinstance(affordance, dict):
            continue
        if route_id in completed_route_ids or route_id in blocked_route_ids:
            continue
        required_route_ids = {
            str(value).strip()
            for value in affordance.get("requires_completed_route_ids", []) or []
            if str(value or "").strip()
        }
        if not required_route_ids.issubset(completed_route_ids):
            continue
        if (
            affordance.get("repeatable") is True
            or str(affordance.get("status") or "") in {"repeatable", "resume"}
            or str(affordance.get("completion_policy") or "") == "repeatable"
        ):
            continue
        direct_grants = []
        for value in [
            affordance.get("clue_id"),
            *(affordance.get("grants_clue_ids") or []),
        ]:
            clue_id = str(value or "").strip()
            if clue_id and clue_id not in direct_grants:
                direct_grants.append(clue_id)
        route_requests = linked_requests.get(route_id, [])
        route_request_ids = [
            str(request.get("request_id"))
            for request in route_requests
            if request.get("request_id")
        ]
        linked_results = [
            result_by_request_id[request_id]
            for request_id in route_request_ids
            if request_id in result_by_request_id
        ]
        has_bound_rules = bool(route_request_ids)
        rule_success = has_bound_rules and (
            len(linked_results) == len(route_request_ids)
            and all(result.get("success") is True for result in linked_results)
        )
        direct_committed = [
            clue_id for clue_id in direct_grants if clue_id in bound_committed
        ]
        if direct_grants:
            clue_commit = bool(direct_committed) and set(direct_grants).issubset(
                discovered_after
            )
            receipt_clues = direct_committed
        else:
            clue_commit = bool(bound_committed) and route_id == unique_clue_route_id
            receipt_clues = list(bound_committed)
        route_flags = {
            str(value).strip()
            for value in affordance.get("sets_flags", []) or []
            if str(value or "").strip()
        }
        flag_commit = (
            affordance.get("completion_policy") == "matched_no_roll"
            and bool(route_flags)
            and route_flags.issubset(durable_flags)
            and route_flags.issubset({
                str(value) for value in (plan.get("flags_set") or []) if value
            })
        )
        if not clue_commit and not rule_success and not flag_commit:
            continue
        # A direct grant route is not a generic successful action: its durable
        # clue commit is the settlement authority.  A bound roll by itself
        # cannot consume it while the clue remains withheld.
        if direct_grants and not clue_commit:
            continue
        # Consuming an authored route and cleanly succeeding at its bound roll
        # are separate facts. Fail-forward may legally commit the core clue and
        # consume the route after a failed/fumbled bonus check, but that must
        # never become a public claim that the attempted action succeeded.
        completion_success = rule_success if has_bound_rules else True
        completion_quality = "clean" if completion_success else "with_cost"
        remaining = [
            str(value)
            for value in [
                *direct_grants,
                *(affordance.get("remaining_clue_ids", []) or []),
            ]
            if value and str(value) not in discovered_after
        ]
        completion_source = (
            "resolver_bound_direct_clue_commit"
            if direct_grants
            else "resolver_bound_clue_commit"
            if clue_commit
            else "resolver_bound_flag_commit"
            if flag_commit
            else "resolver_bound_rule_success"
        )
        public_goal = str(
            affordance.get("cue")
            or affordance.get("player_visible_cue")
            or ""
        ).strip()
        public_outcome = str(
            affordance.get("player_visible_outcome")
            or affordance.get("player_visible_success")
            or affordance.get("on_success_visible")
            or affordance.get("visible_benefit")
            or (f"Completed public action: {public_goal}" if public_goal else "")
        ).strip()
        receipt = {
            "schema_version": 1,
            "route_id": route_id,
            "scene_id": scene_id,
            "status": "consumed",
            "committed_clue_ids": list(receipt_clues),
            "committed_flag_ids": sorted(route_flags) if flag_commit else [],
            "remaining_clue_ids": list(dict.fromkeys(remaining)),
            "rule_request_ids": route_request_ids,
            "rule_outcomes": [
                str(result.get("outcome") or "success") for result in linked_results
            ],
            "success": completion_success,
            "completion_quality": completion_quality,
            "decision_id": decision_id,
            "source": completion_source,
            "ts": ts,
        }
        receipts = [
            item for item in receipts
            if not (
                str(item.get("route_id") or "") == route_id
                and str(item.get("scene_id") or "") == scene_id
            )
        ]
        receipts.append(receipt)
        event = {
            "event_type": "route_completed",
            "decision_id": decision_id,
            "route_id": route_id,
            "scene_id": scene_id,
            "committed_clue_ids": list(receipt_clues),
            "committed_flag_ids": receipt["committed_flag_ids"],
            "remaining_clue_ids": receipt["remaining_clue_ids"],
            "rule_request_ids": route_request_ids,
            "rule_outcomes": receipt["rule_outcomes"],
            "status": "completed",
            "success": completion_success,
            "completion_quality": completion_quality,
            "player_visible_goal": public_goal,
            "player_visible_outcome": public_outcome,
            "source": completion_source,
            "investigator_id": investigator_id,
            "summary": f"structured route completed: {route_id}",
            "ts": ts,
        }
        events.append(event)
    if events:
        world["route_completion_receipts"] = receipts[-256:]
    return events


def _copy_jsonable(payload: dict[str, Any]) -> dict[str, Any]:
    """Deep-copy a JSON-shaped DirectorPlan without importing copy for stable output."""
    return json.loads(json.dumps(payload, ensure_ascii=False))


def backfill_rule_results(plan: dict[str, Any], rules_results: list[dict[str, Any]] | None) -> dict[str, Any]:
    """Return a narration-ready plan with rule outcomes reconciled.

    This is the bridge between rules and prose: narrator-facing directives no
    longer contain an exact clue anchor when the obscured check failed. Instead,
    the plan carries a player-safe failure_consequence telling the narrator to
    show cost, pressure, and an alternate route without claiming the clue was
    found.
    """
    resolved_plan = _copy_jsonable(plan)
    resolved_results = list(rules_results or [])
    resolved_plan["rules_results"] = resolved_results

    committed, resolution_events, extra_pressure = _resolve_committed_clues(
        resolved_plan, resolved_results, ts="", investigator_id=""
    )
    planned_reveals = [cid for cid in resolved_plan.get("clue_policy", {}).get("reveal", []) if cid]
    withheld: list[str] = []
    recovered: list[str] = []
    failure_event: dict[str, Any] | None = None
    recovery_event: dict[str, Any] | None = None
    clean_recovery_event: dict[str, Any] | None = None
    bonus_reveal: str | None = None
    bonus_cost: str | None = None
    for event in resolution_events:
        etype = event.get("event_type")
        if etype == "clue_withheld":
            withheld = [cid for cid in event.get("clue_ids", []) if cid]
        elif etype == "failure_consequence":
            failure_event = event
        elif etype == "fail_forward_recovery":
            clue_id = event.get("clue_id")
            recovered = [clue_id] if clue_id else []
            recovery_event = event
        elif etype == "idea_roll_recovery":
            clue_id = event.get("clue_id")
            recovered = [clue_id] if clue_id else []
            clean_recovery_event = event
        elif etype == "clue_bonus_reveal":
            bonus_reveal = str(event.get("bonus_reveal") or event.get("summary") or "")
        elif etype == "clue_bonus_cost":
            bonus_cost = str(event.get("bonus_cost") or "time")

    policy = resolved_plan.setdefault("clue_policy", {})
    if bonus_reveal:
        policy["bonus_reveal"] = bonus_reveal
        policy.pop("bonus_cost", None)
    if bonus_cost:
        policy["bonus_cost"] = bonus_cost
        policy.pop("bonus_reveal", None)

    resolved_plan["resolved_clue_policy"] = {
        "planned_reveals": planned_reveals,
        "committed_reveals": committed,
        "withheld_reveals": withheld,
        "fallback_recovered": recovered,
        "pending_rule_result": any(e.get("event_type") == "clue_pending_rule_result" for e in resolution_events),
        "extra_pressure_moves": extra_pressure,
        "bonus_reveal": bonus_reveal,
        "bonus_cost": bonus_cost,
    }

    directives = resolved_plan.setdefault("narrative_directives", {})
    if bonus_reveal:
        must_include = list(directives.get("must_include") or [])
        if bonus_reveal not in must_include:
            must_include.append(bonus_reveal)
        directives["must_include"] = must_include
    if failure_event is not None:
        # Prevent the narrator from including the exact clue anchor that was only
        # valid on success. The next beat may still surface a fallback route.
        directives["must_include"] = []
        directives["failure_consequence"] = {
            "narration_mode": "withhold_exact_clue_with_cost",
            "consequence_type": failure_event.get("consequence_type"),
            "severity": failure_event.get("severity", "regular"),
            "fallback_routes": failure_event.get("fallback_routes", []),
            "costs": ["time_pressure", "alternate_route_hint"],
            "must_not_claim": [
                "do not say the exact planned clue was found",
                "do not end the scene with no possible next action",
            ],
        }
    elif recovery_event is not None:
        directives["failure_consequence"] = {
            "narration_mode": "recover_with_cost",
            "consequence_type": "fallback_route_surfaces",
            "severity": "regular",
            "fallback_routes": recovery_event.get("fallback_routes", []),
            "costs": ["time_pressure"],
            "must_not_claim": ["do not present this as a table-level hint"],
        }
    elif clean_recovery_event is not None:
        directives["failure_consequence"] = {
            "narration_mode": "recover_clean",
            "consequence_type": "fallback_route_surfaces",
            "severity": "regular",
            "fallback_routes": clean_recovery_event.get("fallback_routes", []),
            "costs": [],
            "must_not_claim": ["do not present this as a table-level hint"],
        }
    elif (failed_contract := _first_failed_contract_result(resolved_plan, resolved_results)) is not None:
        result, contract = failed_contract
        is_authored_fumble = (
            result.get("outcome") == "fumble"
            and isinstance(result.get("fumble_consequence"), dict)
        )
        mode = (
            "authored_fumble_consequence"
            if is_authored_fumble
            else contract.get("failure_outcome_mode", "goal_with_cost")
        )
        failure_effect = (
            result["fumble_consequence"].get("summary")
            if is_authored_fumble
            else contract.get("failure_effect")
        )
        directives["failure_consequence"] = {
            "narration_mode": mode,
            "goal": contract.get("goal"),
            "success_effect": contract.get("success_effect"),
            "failure_effect": failure_effect,
            "consequence_type": mode,
            "severity": "hard" if str(result.get("outcome")) == "fumble" else "regular",
            "costs": [mode],
            "roll_density_group": contract.get("roll_density_group"),
            "must_not_claim": list(contract.get("must_not") or ["do not narrate no progress on ordinary failure"]),
        }
    else:
        directives.pop("failure_consequence", None)

    planned_epistemic = resolved_plan.get("epistemic_contract")
    resolved_epistemic = coc_epistemic_resolve.resolve_epistemic_contract(
        planned_epistemic, committed
    )
    if isinstance(planned_epistemic, dict) and isinstance(resolved_epistemic, dict):
        resolved_plan["planned_epistemic_contract"] = _copy_jsonable(planned_epistemic)
        resolved_plan["epistemic_contract"] = resolved_epistemic
        resolved_plan["resolved_epistemic_contract"] = resolved_epistemic
        directives["belief_update_contract"] = resolved_epistemic

    return resolved_plan


def flush_pending_records(campaign_dir: Path, *, limit: int | None = None) -> dict[str, int]:
    """Flush queued fast-mode recorder batches into normal JSONL logs."""
    if coc_async_recorder is None:
        return {"flushed_files": 0, "flushed_entries": 0, "remaining_files": 0}
    return coc_async_recorder.flush_pending_records(campaign_dir, limit=limit)


def _director_exit_eval(
    condition,
    discovered,
    campaign_dir,
    save_dir,
    *,
    flags_set: set[str] | None = None,
):
    """Evaluate a scene exit_condition for apply-layer auto-advance.

    Delegates to ``coc_exit_conditions`` with the same semantics as
    ``coc_story_director._eval_exit``:

    - ``clue_discovered`` — clue id in the discovered set
    - ``clock_reaches`` — any (or named) threat clock's persisted
      ``current_segments`` >= threshold
    - ``flag_set`` — structured flag id present/truthy
    - ``always`` — unconditionally True
    - ``narrative`` — always False (wait for CUT / force_transition)

    Legacy string DSL forms are normalized inside coc_exit_conditions.
    """
    discovered_set = {str(c) for c in discovered}

    def clock_reached(clock_id: str | None, threshold: int) -> bool:
        if coc_threat_state is None or campaign_dir is None or save_dir is None:
            return False
        fronts_path = campaign_dir / "scenario" / "threat-fronts.json"
        fronts = _read_json(fronts_path, {}).get("fronts", [])
        for front in fronts:
            for clock in front.get("clocks", []):
                cid = str(clock.get("clock_id") or "")
                if not cid:
                    continue
                if clock_id and cid != str(clock_id):
                    continue
                if coc_threat_state.get_clock_segments(save_dir, cid) >= threshold:
                    return True
        return False

    return coc_exit_conditions.evaluate_exit_condition(
        condition,
        discovered_clue_ids=discovered_set,
        clock_reached=clock_reached,
        flags_set=flags_set,
    )


def _apply_scene_unlock_pass(
    campaign_dir: Path,
    save: Path,
    world: dict[str, Any],
    story: dict[str, Any],
    *,
    discovered: list[str],
    decision_id: str,
    investigator_id: str,
    ts: str,
    events: list[dict[str, Any]],
    logs: Path,
) -> list[str]:
    """Evaluate scene_edges unlock conditions; emit ``scene_unlocked`` events."""
    flags_doc = _read_json(save / "flags.json", {})
    flags_set = _truthy_flag_ids(flags_doc)

    def clock_reached(clock_id: str | None, threshold: int) -> bool:
        if coc_threat_state is None:
            return False
        fronts_path = campaign_dir / "scenario" / "threat-fronts.json"
        fronts = _read_json(fronts_path, {}).get("fronts", [])
        for front in fronts:
            for clock in front.get("clocks", []):
                cid = str(clock.get("clock_id") or "")
                if not cid:
                    continue
                if clock_id and cid != str(clock_id):
                    continue
                if coc_threat_state.get_clock_segments(save, cid) >= threshold:
                    return True
        return False

    newly = coc_scene_graph.evaluate_unlocks(
        story,
        world,
        discovered_clue_ids={str(c) for c in discovered},
        clock_reached=clock_reached,
        flags_set=flags_set,
    )
    added = coc_scene_graph.apply_unlocks_to_world(world, newly)
    for sid in added:
        ev = {
            "event_type": "scene_unlocked",
            "decision_id": decision_id,
            "to_scene": sid,
            "investigator_id": investigator_id,
            "ts": ts,
        }
        events.append(ev)
        _append_jsonl(logs / "events.jsonl", ev)
    return added


def _apply_ledger_path(save_dir: Path) -> Path:
    return save_dir / _APPLY_LEDGER_FILENAME


def _decision_already_applied(save_dir: Path, decision_id: str) -> bool:
    ledger = _read_json(_apply_ledger_path(save_dir), {"applied_decision_ids": []})
    ids = ledger.get("applied_decision_ids") or []
    return isinstance(ids, list) and decision_id in ids


def _record_applied_decision(save_dir: Path, decision_id: str) -> None:
    path = _apply_ledger_path(save_dir)
    ledger = _read_json(path, {"applied_decision_ids": []})
    ids = list(ledger.get("applied_decision_ids") or [])
    if decision_id not in ids:
        ids.append(decision_id)
    if len(ids) > _APPLY_LEDGER_CAP:
        ids = ids[-_APPLY_LEDGER_CAP:]
    _write_json(path, {"applied_decision_ids": ids})


# Keeper Rulebook p.83-85: a pushed roll may settle only when all three gate
# fields are explicitly True (changed method → foreshadowed consequence → confirm).
_PUSH_GATE_REQUIRED_FIELDS = (
    "method_changed",
    "consequence_announced",
    "player_confirmed",
)


def _push_gate_missing_fields(result: dict[str, Any]) -> list[str]:
    gate = result.get("push_gate")
    if not isinstance(gate, dict):
        return list(_PUSH_GATE_REQUIRED_FIELDS)
    return [field for field in _PUSH_GATE_REQUIRED_FIELDS if gate.get(field) is not True]


def _rules_result_is_failure(result: dict[str, Any]) -> bool:
    if result.get("success") is False:
        return True
    outcome = str(result.get("outcome") or "").strip().lower()
    return outcome in {"failure", "fumble"}


def _read_investigator_state(campaign_dir: Path, investigator_id: str) -> dict[str, Any]:
    path = Path(campaign_dir) / "save" / "investigator-state" / f"{investigator_id}.json"
    return _read_json(path, {})


def _process_push_roll_gates(
    campaign_dir: Path,
    rules_results: list[dict[str, Any]] | None,
    *,
    investigator_id: str,
    decision_id: str,
    ts: str,
) -> tuple[list[dict[str, Any]], bool]:
    """Enforce push-roll gate on rules_results; return (events, pushed_fail_pending).

    Incomplete gates are demoted to ordinary failures (``pushed`` cleared) and
    emit ``push_gate_violation``. Valid pushed failures set
    ``pushed_fail_pending`` for pacing and may flag ``delusion_consequence_allowed``
    during underlying insanity without an active bout (p.163).
    """
    events: list[dict[str, Any]] = []
    pushed_fail_pending = False
    inv_state: dict[str, Any] | None = None

    for result in rules_results or []:
        if not isinstance(result, dict) or result.get("pushed") is not True:
            continue
        missing = _push_gate_missing_fields(result)
        if missing:
            result["pushed"] = False
            result["push_gate_rejected"] = True
            events.append({
                "event_type": "push_gate_violation",
                "decision_id": decision_id,
                "investigator_id": investigator_id,
                "skill": result.get("skill"),
                "missing_gate_fields": missing,
                "summary": "pushed roll rejected: incomplete push_gate",
                "ts": ts,
            })
            continue
        outcome = "failure" if _rules_result_is_failure(result) else str(
            result.get("outcome") or "success"
        )
        if not coc_rule_signals.read_pushed_fail_pending(
            is_pushed=True, outcome=outcome,
        ):
            continue
        pushed_fail_pending = True
        fail_ev: dict[str, Any] = {
            "event_type": "pushed_roll_failure",
            "decision_id": decision_id,
            "investigator_id": investigator_id,
            "skill": result.get("skill"),
            "outcome": result.get("outcome"),
            "pushed_fail": True,
            "push_gate": dict(result.get("push_gate") or {}),
            "original_command_id": result.get("original_command_id"),
            "original_roll_id": result.get("original_roll_id"),
            "announced_consequence": _copy_jsonable(
                result.get("announced_consequence") or {}
            ),
            "source_command_id": result.get("source_command_id"),
            "ts": ts,
        }
        if inv_state is None:
            inv_state = _read_investigator_state(campaign_dir, investigator_id)
        underlying = bool(
            inv_state.get("temporary_insane") or inv_state.get("indefinite_insane")
        )
        bout_active = bool(inv_state.get("bout_active"))
        if underlying and not bout_active:
            fail_ev["delusion_consequence_allowed"] = True
        events.append(fail_ev)

    return events, pushed_fail_pending


def _apply_typed_push_consequences(
    campaign_dir: Path,
    investigator_id: str,
    push_events: list[dict[str, Any]],
    *,
    world: dict[str, Any],
    decision_id: str,
    ts: str,
) -> list[dict[str, Any]]:
    """Materialize closed-schema pushed-failure effects exactly once."""
    applied: list[dict[str, Any]] = []
    records = world.setdefault("pushed_consequences", [])
    if not isinstance(records, list):
        raise ValueError("world-state pushed_consequences must be a list")
    known = {
        str(row.get("source_command_id")) for row in records if isinstance(row, dict)
    }
    for failure in push_events:
        if failure.get("event_type") != "pushed_roll_failure":
            continue
        source_id = str(failure.get("source_command_id") or "")
        consequence = failure.get("announced_consequence")
        effect = consequence.get("effect") if isinstance(consequence, dict) else None
        summary = str(consequence.get("summary") or "") if isinstance(consequence, dict) else ""
        if not isinstance(effect, dict):
            continue
        kind = effect.get("kind")
        already_recorded = source_id in known
        if already_recorded and kind != "pressure_tick":
            continue
        record: dict[str, Any] = {
            "source_command_id": source_id,
            "decision_id": decision_id,
            "kind": kind,
            "summary": summary,
        }
        evidence: dict[str, Any] = {
            "event_type": "pushed_consequence_applied",
            "decision_id": decision_id,
            "investigator_id": investigator_id,
            "source_command_id": source_id,
            "effect_kind": kind,
            "consequence_summary": summary,
            "ts": ts,
        }
        if kind == "fictional_position":
            record["severity"] = effect.get("severity", "serious")
        elif kind == "route_closed":
            route_id = str(effect["route_id"])
            scene_id = str(world.get("active_scene_id") or "")
            receipts = world.setdefault("route_completion_receipts", [])
            if not isinstance(receipts, list):
                raise ValueError("world-state route_completion_receipts must be a list")
            if not any(
                isinstance(row, dict)
                and row.get("route_id") == route_id
                and row.get("status") == "blocked"
                for row in receipts
            ):
                receipts.append({
                    "route_id": route_id,
                    "scene_id": scene_id,
                    "status": "blocked",
                    "source": "pushed_failure_consequence",
                    "source_command_id": source_id,
                    "summary": summary,
                })
            record["route_id"] = route_id
            record["scene_id"] = scene_id
            evidence["route_id"] = route_id
        elif kind == "condition":
            condition_id = str(effect["condition_id"])
            inv_path = campaign_dir / "save" / "investigator-state" / f"{investigator_id}.json"
            investigator = _read_investigator_state(campaign_dir, investigator_id)
            conditions = investigator.setdefault("conditions", [])
            if not isinstance(conditions, list):
                raise ValueError("investigator conditions must be a list")
            if condition_id not in conditions:
                conditions.append(condition_id)
            _write_json(inv_path, investigator)
            record["condition_id"] = condition_id
            evidence["condition_id"] = condition_id
        elif kind == "pressure_tick":
            clock_id = str(effect["clock_id"])
            ticks = int(effect["ticks"])
            clock_def = _lookup_clock_def(campaign_dir, clock_id)
            if coc_threat_state is None or clock_def is None:
                raise ValueError(f"unknown pushed-consequence threat clock: {clock_id}")
            total_segments = int(clock_def.get("segments", 0) or 0)
            if total_segments < 1:
                raise ValueError(f"invalid pushed-consequence threat clock: {clock_id}")
            coc_threat_state.apply_clock_effect_once(
                campaign_dir / "save",
                clock_id,
                total_segments,
                ticks=ticks,
                effect_id=f"pushed-consequence:{source_id}",
            )
            transition_receipt = coc_threat_state.get_clock_effect_receipt(
                campaign_dir / "save", f"pushed-consequence:{source_id}"
            )
            record.update({"clock_id": clock_id, "ticks": ticks})
            record["clock_transition"] = transition_receipt
            evidence.update({"clock_id": clock_id, "ticks": ticks})
            evidence["clock_transition"] = transition_receipt
        else:
            raise ValueError(f"unsupported pushed consequence effect kind: {kind!r}")
        if already_recorded:
            existing_record = next(
                row for row in records
                if isinstance(row, dict) and str(row.get("source_command_id")) == source_id
            )
            if existing_record.get("clock_transition") != record.get("clock_transition"):
                raise ValueError("world pushed-consequence receipt diverges from threat transition")
            continue
        records.append(record)
        known.add(source_id)
        applied.append(evidence)
    return applied


def _process_authored_fumble_consequences(
    rules_results: list[dict[str, Any]] | None,
    *,
    investigator_id: str,
    decision_id: str,
    ts: str,
) -> list[dict[str, Any]]:
    """Project exact typed fumble effects; ordinary/pushed failure stays separate."""
    events: list[dict[str, Any]] = []
    for result in rules_results or []:
        if (
            not isinstance(result, dict)
            or result.get("outcome") != "fumble"
            or result.get("pushed") is True
        ):
            continue
        contract = result.get("roll_contract")
        if not isinstance(contract, dict) or not (
            contract.get("authored_roll_gate") is True
            or contract.get("authored_clue_bonus") is True
            or contract.get("generated_clue_gate") is True
        ):
            continue
        consequence = result.get("fumble_consequence")
        effect = consequence.get("effect") if isinstance(consequence, dict) else None
        policy = contract.get("push_policy")
        kind = effect.get("kind") if isinstance(effect, dict) else None
        valid_effect = (
            isinstance(effect, dict)
            and (
                kind == "fictional_position"
                and set(effect) in ({"kind"}, {"kind", "severity"})
                and (
                    "severity" not in effect
                    or effect.get("severity") in {"minor", "serious", "critical"}
                )
                or kind == "pressure_tick"
                and set(effect) == {"kind", "clock_id", "ticks"}
                and isinstance(effect.get("clock_id"), str)
                and bool(effect["clock_id"].strip())
                and isinstance(effect.get("ticks"), int)
                and not isinstance(effect.get("ticks"), bool)
                and 1 <= effect["ticks"] <= 4
                or kind == "condition"
                and set(effect) == {"kind", "condition_id"}
                and isinstance(effect.get("condition_id"), str)
                and bool(effect["condition_id"].strip())
                or kind == "route_closed"
                and set(effect) == {"kind", "route_id"}
                and isinstance(effect.get("route_id"), str)
                and bool(effect["route_id"].strip())
            )
        )
        if (
            not isinstance(consequence, dict)
            or not isinstance(consequence.get("summary"), str)
            or not consequence["summary"].strip()
            or not valid_effect
            or not isinstance(policy, dict)
            or policy.get("eligible") is not False
        ):
            raise ValueError("authored fumble result lacks its immediate typed consequence")
        events.append({
            "event_type": (
                "generated_fumble_consequence"
                if contract.get("generated_clue_gate") is True
                else "authored_fumble_consequence"
            ),
            "decision_id": decision_id,
            "investigator_id": investigator_id,
            "skill": result.get("skill"),
            "roll_id": result.get("roll_id"),
            "source_command_id": result.get("source_command_id") or result.get("roll_id"),
            "fumble_consequence": _copy_jsonable(consequence),
            "source_binding": _copy_jsonable(consequence.get("source_binding")),
            "ts": ts,
        })
    return events


def _apply_typed_fumble_consequences(
    campaign_dir: Path,
    world: dict[str, Any],
    fumble_events: list[dict[str, Any]],
    *,
    investigator_id: str,
    decision_id: str,
    ts: str,
) -> list[dict[str, Any]]:
    """Apply typed fumble effects immediately and exactly once."""
    records = world.setdefault("fumble_consequences", [])
    if not isinstance(records, list):
        raise ValueError("world-state fumble_consequences must be a list")
    known = {
        str(row.get("source_command_id")) for row in records if isinstance(row, dict)
    }
    applied: list[dict[str, Any]] = []
    for event in fumble_events:
        source_id = str(event.get("source_command_id") or "")
        if not source_id or source_id in known:
            continue
        consequence = event["fumble_consequence"]
        effect = consequence["effect"]
        kind = str(effect["kind"])
        scene_id = str(world.get("active_scene_id") or "")
        summary = str(consequence["summary"])
        record: dict[str, Any] = {
            "source_command_id": source_id,
            "decision_id": decision_id,
            "kind": kind,
            "summary": summary,
        }
        source_binding = event.get("source_binding")
        if isinstance(source_binding, dict):
            record["source_binding"] = _copy_jsonable(source_binding)
        evidence: dict[str, Any] = {
            "event_type": "fumble_consequence_applied",
            "decision_id": decision_id,
            "investigator_id": investigator_id,
            "source_command_id": source_id,
            "effect_kind": kind,
            "consequence_summary": summary,
            "ts": ts,
        }
        if isinstance(source_binding, dict):
            evidence["source_binding"] = _copy_jsonable(source_binding)
        if kind == "fictional_position":
            record["severity"] = effect.get("severity", "serious")
        elif kind == "condition":
            condition_id = str(effect["condition_id"])
            inv_path = (
                campaign_dir / "save" / "investigator-state" / f"{investigator_id}.json"
            )
            investigator = _read_investigator_state(campaign_dir, investigator_id)
            conditions = investigator.setdefault("conditions", [])
            if not isinstance(conditions, list):
                raise ValueError("investigator conditions must be a list")
            if condition_id not in conditions:
                conditions.append(condition_id)
            _write_json(inv_path, investigator)
            record["condition_id"] = condition_id
            evidence["condition_id"] = condition_id
        elif kind == "pressure_tick":
            clock_id = str(effect["clock_id"])
            ticks = int(effect["ticks"])
            clock_def = _lookup_clock_def(campaign_dir, clock_id)
            if coc_threat_state is None or clock_def is None:
                raise ValueError(f"unknown fumble-consequence threat clock: {clock_id}")
            total_segments = int(clock_def.get("segments", 0) or 0)
            if total_segments < 1:
                raise ValueError(f"invalid fumble-consequence threat clock: {clock_id}")
            coc_threat_state.apply_clock_effect_once(
                campaign_dir / "save",
                clock_id,
                total_segments,
                ticks=ticks,
                effect_id=f"fumble-consequence:{source_id}",
            )
            transition = coc_threat_state.get_clock_effect_receipt(
                campaign_dir / "save", f"fumble-consequence:{source_id}"
            )
            record.update({
                "clock_id": clock_id, "ticks": ticks,
                "clock_transition": transition,
            })
            evidence.update({
                "clock_id": clock_id, "ticks": ticks,
                "clock_transition": transition,
            })
        elif kind == "route_closed":
            route_id = str(effect["route_id"])
            receipts = world.setdefault("route_completion_receipts", [])
            if not isinstance(receipts, list):
                raise ValueError("world-state route_completion_receipts must be a list")
            if not any(
                isinstance(row, dict)
                and row.get("route_id") == route_id
                and row.get("status") == "blocked"
                for row in receipts
            ):
                receipts.append({
                    "route_id": route_id,
                    "scene_id": scene_id,
                    "status": "blocked",
                    "source": "fumble_consequence",
                    "source_command_id": source_id,
                    "summary": summary,
                })
            record.update({"route_id": route_id, "scene_id": scene_id})
            evidence["route_id"] = route_id
        else:
            raise ValueError(f"unsupported fumble consequence effect kind: {kind!r}")
        records.append(record)
        known.add(source_id)
        applied.append(evidence)
    return applied


def _record_development_ticks(
    campaign_dir: Path,
    rules_results: list[dict[str, Any]] | None,
    *,
    investigator_id: str,
    decision_id: str,
    ts: str,
) -> list[dict[str, Any]]:
    """W2-2: land qualifying skill successes as development ticks (p.94).

    Aligns with playtest ``skill_check_earned`` payload shape so report/audit
    consumers see the same structured flag on apply-layer events.
    """
    events: list[dict[str, Any]] = []
    for result in rules_results or []:
        if not isinstance(result, dict):
            continue
        skill = str(result.get("skill") or "").strip()
        if not skill:
            continue
        tick = coc_development.record_skill_tick(
            campaign_dir, investigator_id, skill, result
        )
        if tick is None:
            continue
        # Mirror playtest roll payload: skill_check_earned boolean + skill/roll.
        result["skill_check_earned"] = True
        events.append({
            "event_type": "skill_check_earned",
            "skill_check_earned": True,
            "skill": skill,
            "roll": tick.get("roll", result.get("roll")),
            "decision_id": decision_id,
            "investigator_id": investigator_id,
            "summary": f"skill check earned: {skill}",
            "ts": ts,
        })
    return events


def apply_plan(
    campaign_dir: Path,
    plan: dict[str, Any],
    investigator_id: str,
    rules_results: list[dict[str, Any]] | None = None,
    recording_mode: str | None = None,
    recording_flush: str | None = None,
    rules_results_mode: str = "legacy",
    _campaign_lock_held: bool = False,
) -> list[dict[str, Any]]:
    """Apply a DirectorPlan with sync or fast queued JSONL recording.

    Default sync mode preserves legacy behavior. Fast/minimal mode keeps save
    state updates synchronous but queues verbose JSONL records under
    logs/pending-turns for a recorder worker or later flush.

    Re-applying the same ``plan["decision_id"]`` is a structured no-op: the
    return stays a list of event dicts (uniform with every other path) whose
    single ``apply_skipped`` event carries the duplicate marker, so callers
    like run_live_turn can iterate it without a shape guard. No state is
    touched and nothing is appended to JSONL logs.
    """
    if not _campaign_lock_held:
        with coc_fileio.campaign_lock(
            Path(campaign_dir), wait_seconds=10.0
        ):
            return apply_plan(
                campaign_dir,
                plan,
                investigator_id,
                rules_results=rules_results,
                recording_mode=recording_mode,
                recording_flush=recording_flush,
                rules_results_mode=rules_results_mode,
                _campaign_lock_held=True,
            )

    global _ACTIVE_JSONL_RECORDER

    decision_id = str(plan.get("decision_id", "unknown"))
    save_dir = Path(campaign_dir) / "save"
    mode = "sync"
    flush_policy = "manual"
    recorder = None
    if coc_async_recorder is not None:
        mode = coc_async_recorder.resolve_recording_mode(plan, explicit=recording_mode)
        flush_policy = coc_async_recorder.resolve_recording_flush(plan, explicit=recording_flush)
        if mode != "sync":
            recorder = coc_async_recorder.JsonlRecorder(
                campaign_dir,
                mode=mode,
                decision_id=decision_id,
            )

    previous_recorder = _ACTIVE_JSONL_RECORDER
    _ACTIVE_JSONL_RECORDER = recorder
    try:
        (
            npc_receipt_document,
            npc_operation_set_candidate,
            npc_operation_set_exists,
        ) = _director_npc_operation_set_candidate(
            Path(campaign_dir), plan, investigator_id
        )
        if _decision_already_applied(save_dir, decision_id):
            if not npc_operation_set_exists:
                _recover_completed_legacy_director_npc_operation_set(
                    Path(campaign_dir),
                    npc_receipt_document,
                    npc_operation_set_candidate,
                )
            # Only an exact, validated retry may enter the campaign-wide
            # recovery boundary.  An incompatible idempotency replay fails
            # before a recorder lock or any repair write can be created.
            coc_toolbox_continuity.reconcile_campaign_continuity(
                Path(campaign_dir)
            )
            if recorder is not None:
                pending_batch = recorder.commit()
                if pending_batch is not None and flush_policy == "background":
                    coc_async_recorder.spawn_background_flush(campaign_dir)
            return [{
                "event_type": "apply_skipped",
                "skipped": "duplicate_decision_id",
                "decision_id": decision_id,
            }]

        # A source receipt can survive any event/ledger append interruption.
        # New decisions run the same all-family preflight before rule
        # settlement or state mutation, so an older interrupted operation is
        # finished before this one begins.
        coc_toolbox_continuity.reconcile_campaign_continuity(
            Path(campaign_dir)
        )

        expected_commands = coc_subsystem_executor.commands_from_rules_requests(plan)
        settled_rule_results = coc_subsystem_executor.normalize_rule_results(
            rules_results,
            campaign_dir=campaign_dir,
            expected_commands=expected_commands,
            investigator_id=investigator_id,
            decision_id=decision_id,
            results_mode=rules_results_mode,
        )
        npc_operation_set = (
            npc_operation_set_candidate
            if npc_operation_set_exists
            else _freeze_director_npc_operation_set(
                Path(campaign_dir),
                npc_receipt_document,
                npc_operation_set_candidate,
            )
        )

        strategy_state = plan.get("director_strategy_state")
        if isinstance(strategy_state, dict) and strategy_state:
            canonical_strategy, strategy_findings = (
                coc_director_strategies.validate_strategy_state(strategy_state)
            )
            if canonical_strategy is not None and not strategy_findings:
                _write_json(save_dir / "director-strategy-state.json", {
                    **canonical_strategy,
                    "last_decision_id": decision_id,
                })

        events = _apply_plan_impl(
            campaign_dir,
            plan,
            investigator_id,
            settled_rule_results,
            npc_operation_set_receipt=npc_operation_set,
        )
        if recorder is not None:
            pending_batch = recorder.commit()
            if pending_batch is not None and flush_policy == "background":
                coc_async_recorder.spawn_background_flush(campaign_dir)
        # The plan ledger is last: every source-owned flag transition and its
        # sync event or durable recorder batch is reconcilable before success
        # can suppress a retry.
        _record_applied_decision(save_dir, decision_id)
        return events
    finally:
        _ACTIVE_JSONL_RECORDER = previous_recorder


def _apply_plan_impl(
    campaign_dir: Path,
    plan: dict[str, Any],
    investigator_id: str,
    rules_results: list[dict[str, Any]] | None = None,
    *,
    npc_operation_set_receipt: dict[str, Any],
) -> list[dict[str, Any]]:
    """Apply a DirectorPlan's effects. Returns the events written to logs/events.jsonl.

    - clue reveal -> add to world-state.discovered_clue_ids + event only when
      the clue has been resolved as committed
    - failed obscured checks -> no exact clue reveal; log cost/fallback events
    - pressure_moves -> bump pacing tension + turn + event per move
    - memory_writes -> create memory cards via coc_memory
    """
    events: list[dict[str, Any]] = []
    save = campaign_dir / "save"
    logs = campaign_dir / "logs"
    ts = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    decision_id = str(plan.get("decision_id", "unknown"))
    action = plan.get("scene_action", "")

    # 0. push-roll gate (Keeper Rulebook p.83-85) — demote incomplete pushed
    # results before clue/pressure consumers see them as settled pushes.
    push_events, pushed_fail_pending = _process_push_roll_gates(
        campaign_dir,
        rules_results,
        investigator_id=investigator_id,
        decision_id=decision_id,
        ts=ts,
    )
    for ev in push_events:
        events.append(ev)
        _append_jsonl(logs / "events.jsonl", ev)
    fumble_events = _process_authored_fumble_consequences(
        rules_results,
        investigator_id=investigator_id,
        decision_id=decision_id,
        ts=ts,
    )
    for ev in fumble_events:
        events.append(ev)
        _append_jsonl(logs / "events.jsonl", ev)

    # 0b. development ticks (Keeper Rulebook p.94) — after push demotion so
    # luck/push bookkeeping on the result is settled before tick eligibility.
    for ev in _record_development_ticks(
        campaign_dir,
        rules_results,
        investigator_id=investigator_id,
        decision_id=decision_id,
        ts=ts,
    ):
        events.append(ev)
        _append_jsonl(logs / "events.jsonl", ev)

    # 1. clue reveal / fail-forward resolution
    world_path = save / "world-state.json"
    world = _read_json(world_path, {"discovered_clue_ids": []})
    # 1a. structured flag commits must land before unlock evaluation so
    # flag_set-gated travel destinations become legal CUT targets this turn.
    _commit_plan_flags(
        save,
        plan,
        decision_id=decision_id,
        investigator_id=investigator_id,
        ts=ts,
        events=events,
        logs=logs,
    )
    for ev in _apply_typed_push_consequences(
        campaign_dir,
        investigator_id,
        push_events,
        world=world,
        decision_id=decision_id,
        ts=ts,
    ):
        events.append(ev)
        _append_jsonl(logs / "events.jsonl", ev)
    for ev in _apply_typed_fumble_consequences(
        campaign_dir,
        world,
        fumble_events,
        investigator_id=investigator_id,
        decision_id=decision_id,
        ts=ts,
    ):
        events.append(ev)
        _append_jsonl(logs / "events.jsonl", ev)
    discovered = list(world.get("discovered_clue_ids", []))
    clue_plan, disclosure_events = _gate_social_clues_and_persist_disclosure(
        campaign_dir,
        plan,
        investigator_id=investigator_id,
        decision_id=decision_id,
        ts=ts,
    )
    for ev in disclosure_events:
        events.append(ev)
        _append_jsonl(logs / "events.jsonl", ev)
    committed_clues, resolution_events, extra_pressure = _resolve_committed_clues(
        clue_plan, rules_results, ts, investigator_id
    )
    for ev in resolution_events:
        events.append(ev)
        _append_jsonl(logs / "events.jsonl", ev)
    for clue_id in committed_clues:
        if clue_id and clue_id not in discovered:
            discovered.append(clue_id)
            ev = {"event_type": "clue_reveal", "decision_id": decision_id,
                  "clue_id": clue_id, "investigator_id": investigator_id,
                  "summary": f"clue revealed: {clue_id}", "ts": ts}
            # P2-5: when the clue record carries a handout_asset_id, attach it
            # plus the resolved title/summary and a player_visible rendering
            # hint from index/handout-assets.json. No-op when the field is
            # absent (all current scenarios), keeping the event backward
            # compatible.
            handout_fields = _resolve_handout_for_clue(
                campaign_dir, _find_clue_record(campaign_dir, clue_id)
            )
            if handout_fields:
                ev.update(handout_fields)
            events.append(ev)
            _append_jsonl(logs / "events.jsonl", ev)
    world["discovered_clue_ids"] = discovered
    for ev in _commit_resolved_route_completions(
        campaign_dir,
        clue_plan,
        world,
        committed_clues,
        rules_results=rules_results,
        decision_id=decision_id,
        investigator_id=investigator_id,
        ts=ts,
    ):
        events.append(ev)
        _append_jsonl(logs / "events.jsonl", ev)
    # Epistemic state updates only after clue commitment is resolved. Question
    # opening/closure is evaluated from structured authored conditions.
    epistemic_graph = _read_json(
        campaign_dir / "scenario" / "epistemic-graph.json",
        {"questions": [], "evidence_links": []},
    )
    current_belief = coc_belief_state.read_belief_state(campaign_dir)
    flags_set = _truthy_flag_ids(_read_json(save / "flags.json", {}))
    epistemic_contract = plan.get("epistemic_contract") or {}
    resolved_effects = epistemic_contract.get("resolved_effects")
    if not isinstance(resolved_effects, list):
        resolved_effects = epistemic_contract.get("effects")
    if not isinstance(resolved_effects, list):
        resolved_effects = [epistemic_contract] if isinstance(epistemic_contract, dict) else []
    question_transitions = coc_epistemic_lifecycle.evaluate_question_transitions(
        epistemic_graph,
        current_belief,
        world,
        committed_clues,
        flags_set=flags_set,
        visited_scene_ids=world.get("visited_scene_ids") or [],
        resolved_effects=[effect for effect in resolved_effects if isinstance(effect, dict)],
    )
    belief_events = coc_belief_state.apply_belief_turn(
        campaign_dir,
        plan,
        committed_clues,
        investigator_id,
        ts,
        question_transitions=question_transitions,
    )
    for ev in belief_events:
        events.append(ev)
        _append_jsonl(logs / "events.jsonl", ev)
    # Mark scene-level SAN triggers as fired (dedup: director won't re-request).
    fired = list(world.get("san_triggers_fired", []))
    for rr in (rules_results or []):
        tid = rr.get("san_trigger_id") if isinstance(rr, dict) else None
        if tid and tid not in fired:
            fired.append(tid)
            ev = {"event_type": "san_trigger_fired", "decision_id": decision_id,
                  "trigger_id": tid, "san_loss": rr.get("san_loss"),
                  "investigator_id": investigator_id, "ts": ts}
            events.append(ev)
            _append_jsonl(logs / "events.jsonl", ev)
    if fired:
        world["san_triggers_fired"] = fired
    # Idea Roll signpost bookkeeping: record which clues were offered as leads
    # (mentioned) or missed on an obscured check (obvious). Never downgrade.
    signpost_updates = _collect_signpost_updates(plan, resolution_events)
    if signpost_updates or isinstance(world.get("clue_signposts"), dict):
        world["clue_signposts"] = _merge_clue_signposts(world, signpost_updates)

    # R-3: ensure unlock/visit/history fields; evaluate scene_edges unlocks
    # after clue/flag-affecting events land (idempotent via unlocked set).
    story_graph_path_early = campaign_dir / "scenario" / "story-graph.json"
    story_early = (
        _read_json(story_graph_path_early, {"scenes": []})
        if story_graph_path_early.exists()
        else {"scenes": []}
    )
    coc_scene_graph.ensure_world_scene_fields(world, story_early)
    _apply_scene_unlock_pass(
        campaign_dir,
        save,
        world,
        story_early,
        discovered=discovered,
        decision_id=decision_id,
        investigator_id=investigator_id,
        ts=ts,
        events=events,
        logs=logs,
    )
    _write_json(world_path, world)

    # 1b. spoiler reveals — warning-gated Keeper-only disclosures.
    # The director's clue_policy.withhold keeps keeper_secrets private; a
    # spoiler_reveal is the rare opposite: a secret the player explicitly
    # requested and confirmed after a warning. We mirror the playtest harness
    # record shape (coc_playtest_harness.py:4075) into logs/audit.jsonl so the
    # live path records the same Keeper-only reveal evidence the harness does,
    # and populate save/flags.json's spoiler_reveals list (previously a dead
    # field initialized by coc_state but never written).
    for spec in plan.get("spoiler_reveals", []) or []:
        if not isinstance(spec, dict):
            continue
        spoiler_id = spec.get("spoiler_id") or spec.get("secret_id") or "spoiler"
        audit_record = {
            "type": "spoiler_reveal",
            "spoiler_id": spoiler_id,
            "keeper_secret_id": spec.get("keeper_secret_id"),
            "scope": spec.get("scope"),
            "confirmed": bool(spec.get("confirmed", True)),
            "payload": spec.get("payload", {}) or {},
            "decision_id": decision_id,
            "investigator_id": investigator_id,
            "ts": ts,
        }
        _append_jsonl(logs / "audit.jsonl", audit_record)
        # surface a parallel event so consumers reading events.jsonl see the
        # reveal alongside clue_reveal / scene events.
        ev = {
            "event_type": "spoiler_reveal", "decision_id": decision_id,
            "spoiler_id": spoiler_id,
            "keeper_secret_id": spec.get("keeper_secret_id"),
            "scope": spec.get("scope"), "confirmed": audit_record["confirmed"],
            "summary": (spec.get("payload") or {}).get("summary", ""),
            "investigator_id": investigator_id, "ts": ts,
        }
        events.append(ev)
        _append_jsonl(logs / "events.jsonl", ev)
        # record in flags.json so resume/UI can see prior spoiler disclosures.
        flags_path = save / "flags.json"
        flags = _read_json(flags_path, {
            "schema_version": 1, "campaign_id": campaign_dir.name,
            "clues_found": {}, "decisions": [], "spoiler_reveals": [],
        })
        reveals = list(flags.get("spoiler_reveals", []))
        reveals.append({
            "spoiler_id": spoiler_id,
            "keeper_secret_id": spec.get("keeper_secret_id"),
            "scope": spec.get("scope"),
            "confirmed": audit_record["confirmed"],
            "decision_id": decision_id, "ts": ts,
        })
        flags["spoiler_reveals"] = reveals
        _write_json(flags_path, flags)

    # 2. NPC state writes + agency audit
    npc_events = _apply_npc_state_and_agency(
        campaign_dir,
        plan,
        investigator_id,
        ts,
        npc_operation_set_receipt,
    )
    events.extend(npc_events)

    # 2b. G3: structured npc_effects -> persistent NPC psychological state
    events.extend(_apply_npc_effects(campaign_dir, plan, investigator_id, ts))

    # 3. pressure moves -> pacing state + events
    pacing_path = save / "pacing-state.json"
    pacing = _read_json(pacing_path, {"tension_level": "low", "turn_number": 0})
    pressure_moves = [*plan.get("pressure_moves", []), *extra_pressure]
    tension_steps = _resolve_tension_steps(plan, pressure_moves, action)
    if tension_steps:
        pacing["tension_level"] = _bump_tension(
            pacing.get("tension_level", "low"), tension_steps
        )
    pacing["turn_number"] = int(pacing.get("turn_number", 0)) + 1
    # track recent intent classes for stall detection (capped at last 5)
    recent = list(pacing.get("recent_intent_classes", []))
    recent_tags = list(pacing.get("recent_intent_tags", []))
    turn_input = plan.get("turn_input", {}) or {}
    intent_class = str(turn_input.get("player_intent_class", "") or "")
    rich = turn_input.get("player_intent_rich") or {}
    turn_tags = list(rich.get("secondary_intents") or []) if isinstance(rich, dict) else []
    if intent_class:
        recent.append(intent_class)
        recent_tags.append([str(t) for t in turn_tags])
        if len(recent) > 5:
            recent = recent[-5:]
            recent_tags = recent_tags[-5:]
    pacing["recent_intent_classes"] = recent
    pacing["recent_intent_tags"] = recent_tags
    # carry horror stage from plan into pacing for next-turn director read
    horror = plan.get("narrative_directives", {}).get("horror_escalation_stage")
    if horror:
        pacing["horror_stage"] = horror
    # W2-3: one-shot pushed-fail flag. Clear when this plan's context already
    # consumed it (rule_signals.pushed_fail_pending), then re-set if *this*
    # apply also produced a new legal pushed failure. Duplicate decision_ids
    # never reach here (apply ledger), so the clear is idempotent per decision.
    if (plan.get("rule_signals") or {}).get("pushed_fail_pending"):
        pacing["pushed_fail_pending"] = False
    if pushed_fail_pending:
        pacing["pushed_fail_pending"] = True

    # W2-7 Fair Warning (p.209): landing a fair_warning directive increments
    # lethal_chances_used. Idempotent per decision_id via the apply ledger
    # (duplicate plans never reach this write path).
    fair_warning = (plan.get("narrative_directives") or {}).get("fair_warning")
    if isinstance(fair_warning, dict):
        used = int(pacing.get("lethal_chances_used", 0) or 0)
        pacing["lethal_chances_used"] = used + 1
        fw_ev = {
            "event_type": "fair_warning",
            "decision_id": decision_id,
            "warning_number": fair_warning.get("warning_number", used + 1),
            "remaining": fair_warning.get("remaining", max(0, 3 - used - 1)),
            "lethal_chances_used": pacing["lethal_chances_used"],
            "investigator_id": investigator_id,
            "rule_ref": "core.pacing.fair_warning",
            "ts": ts,
        }
        events.append(fw_ev)
        _append_jsonl(logs / "events.jsonl", fw_ev)

    _write_json(pacing_path, pacing)
    for pressure_index, move in enumerate(pressure_moves):
        ev = {"event_type": "pressure_tick", "decision_id": decision_id,
              "clock_id": move.get("clock_id"), "visible_symptom": move.get("visible_symptom"),
              "reason": move.get("reason"),
              "selection_reason": move.get("selection_reason"),
              "investigator_id": investigator_id, "ts": ts}
        events.append(ev)
        _append_jsonl(logs / "events.jsonl", ev)
        # Persist clock progress + detect on_full (closes the gap where
        # current_segments was read but never written).
        clock_id = move.get("clock_id")
        if clock_id and int(move.get("tick", 0) or 0) > 0 and coc_threat_state is not None:
            clock_def = _lookup_clock_def(campaign_dir, clock_id)
            segments = int(clock_def.get("segments", 6)) if clock_def else 6
            became_full = coc_threat_state.tick_clock(
                save, clock_id, segments,
                source_id=f"director:{decision_id}:pressure:{pressure_index}:{clock_id}",
            )
            if became_full and clock_def:
                full_ev = {
                    "event_type": "clock_full", "decision_id": decision_id,
                    "clock_id": clock_id,
                    "on_full": clock_def.get("on_full", ""),
                    "investigator_id": investigator_id, "ts": ts,
                }
                events.append(full_ev)
                _append_jsonl(logs / "events.jsonl", full_ev)

    # 4. storylet ledger/events -> anti-repeat state for future enrichment.
    storylet_moves = [m for m in plan.get("storylet_moves", []) if isinstance(m, dict)]
    if storylet_moves:
        ledger_path = save / "storylet-ledger.json"
        ledger = _read_json(ledger_path, {})
        for move in storylet_moves:
            update = move.get("ledger_update")
            if isinstance(update, dict):
                ledger = update
            ev = {
                "event_type": "storylet_move",
                "decision_id": decision_id,
                "storylet_id": move.get("storylet_id"),
                "family_id": move.get("family_id"),
                "trope_id": move.get("trope_id"),
                "title": move.get("title"),
                "cue": move.get("cue"),
                "beat": move.get("beat"),
                "conflict_level": move.get("conflict_level"),
                "target_conflict_level": move.get("target_conflict_level"),
                "bound_entities": move.get("bound_entities", {}),
                "rolled_variants": move.get("rolled_variants", {}),
                "presentation_mode": move.get("presentation_mode"),
                "grounding_contract": move.get("grounding_contract", {}),
                "serves": move.get("serves", []),
                "investigator_id": investigator_id,
                "ts": ts,
            }
            events.append(ev)
            _append_jsonl(logs / "events.jsonl", ev)
        _write_json(ledger_path, ledger)

    scheduler_record = _storylet_scheduler_record(plan, investigator_id, ts)
    if scheduler_record is not None and _storylet_scheduler_debug_enabled(campaign_dir):
        _append_jsonl(logs / "storylet-scheduler.jsonl", scheduler_record)

    scene_progress = (plan.get("narrative_directives") or {}).get("scene_progress")
    if isinstance(scene_progress, dict):
        progress_record = {
            "schema_version": 1,
            "event_type": "scene_progress_directive",
            "decision_id": decision_id,
            "turn_number": (plan.get("turn_input") or {}).get("turn_number"),
            "scene_id": (plan.get("turn_input") or {}).get("active_scene_id"),
            "scene_action": action,
            "investigator_id": investigator_id,
            "ts": ts,
            **scene_progress,
        }
        events.append(progress_record)
        _append_jsonl(logs / "scene-progress.jsonl", progress_record)
        _append_jsonl(logs / "events.jsonl", progress_record)

    # 5. time advance -> world clock + triggers (coc_time layer)
    if coc_time is not None:
        time_events = coc_time.apply_time_advance_from_plan(
            campaign_dir, plan, investigator_id
        )
        events.extend(time_events)
        for ev in time_events:
            _append_jsonl(logs / "events.jsonl", ev)

    # 6. memory writes -> cards
    if coc_memory is not None:
        for i, mw in enumerate(plan.get("memory_writes", [])):
            mid = f"mem-{decision_id}-{i}"
            coc_memory.create_memory_card(
                campaign_dir=campaign_dir, memory_id=mid,
                privacy=mw.get("privacy", "player_safe"),
                salience=float(mw.get("salience", 0.5)),
                summary=mw.get("summary", ""),
                entities=mw.get("entities", []),
                tags=mw.get("tags", []),
                reactivation_cues=mw.get("reactivation_cues", []),
                source_events=[decision_id],
            )

    # 7. scene transition — only an explicit CUT or typed force_transition may
    # commit travel. Satisfying an exit condition makes the current scene ready
    # to leave and unlocks authored destinations, but does not choose one on the
    # player's behalf. Targets come from the scene graph (R-3): only unlocked,
    # non-exhausted edge destinations. CUT is cinematic travel among already-
    # unlocked targets — never an unlock.
    story_graph_path = campaign_dir / "scenario" / "story-graph.json"
    if story_graph_path.exists():
        story = _read_json(story_graph_path, {"scenes": []})
        scenes = story.get("scenes", [])
        current_scene_id = world.get("active_scene_id")
        current_scene = next((s for s in scenes if s.get("scene_id") == current_scene_id), None)
        if current_scene:
            available = current_scene.get("available_clues", [])
            flags_set = _truthy_flag_ids(_read_json(save / "flags.json", {}))
            exit_conditions = current_scene.get("exit_conditions", [])
            exit_met = (
                any(
                    _director_exit_eval(
                        condition,
                        discovered,
                        campaign_dir,
                        save,
                        flags_set=flags_set,
                    )
                    for condition in exit_conditions
                )
                if exit_conditions
                else bool(available and all(clue_id in discovered for clue_id in available))
            )
            should_advance = (
                action == "CUT"
                or (
                    isinstance(scene_progress, dict)
                    and scene_progress.get("action") == "force_transition"
                )
            )
            if exit_met and not should_advance:
                ready = list(world.get("exit_ready_scene_ids") or [])
                if str(current_scene_id) not in {str(value) for value in ready}:
                    ready.append(str(current_scene_id))
                    world["exit_ready_scene_ids"] = ready
                    ready_event = {
                        "schema_version": 1,
                        "event_type": "scene_exit_ready",
                        "decision_id": decision_id,
                        "scene_id": current_scene_id,
                        "investigator_id": investigator_id,
                        "ts": ts,
                        "reason": "structured_exit_condition_satisfied",
                    }
                    events.append(ready_event)
                    _append_jsonl(logs / "events.jsonl", ready_event)
                    _write_json(world_path, world)
            if should_advance:
                requested = plan.get("transition_to")
                if not requested and isinstance(scene_progress, dict):
                    requested = scene_progress.get("to_scene")
                direct_entry_receipt: dict[str, Any] | None = None
                raw_entry_authority = plan.get("destination_entry_authority")
                if requested and isinstance(raw_entry_authority, dict):
                    requested_scene = next(
                        (
                            item for item in scenes
                            if isinstance(item, dict)
                            and str(item.get("scene_id") or "") == str(requested)
                        ),
                        None,
                    )
                    canonical_authority = (
                        coc_scene_graph.public_direct_entry_authority(
                            requested_scene
                        )
                    )
                    has_exact_edge = any(
                        str(edge.get("to") or "") == str(requested)
                        for edge in coc_scene_graph.derive_scene_edges(story).get(
                            str(current_scene_id), []
                        )
                        if isinstance(edge, dict)
                    )
                    if (
                        canonical_authority is not None
                        and raw_entry_authority == canonical_authority
                        and has_exact_edge
                    ):
                        unlocked = list(world.get("unlocked_scene_ids") or [])
                        if str(requested) not in {str(value) for value in unlocked}:
                            unlocked.append(str(requested))
                            world["unlocked_scene_ids"] = unlocked
                            unlock_event = {
                                "schema_version": 1,
                                "event_type": "scene_unlocked",
                                "decision_id": decision_id,
                                "scene_id": str(requested),
                                "investigator_id": investigator_id,
                                "source": "public_direct_entry_authority",
                                "ts": ts,
                            }
                            events.append(unlock_event)
                            _append_jsonl(logs / "events.jsonl", unlock_event)
                            _write_json(world_path, world)
                        direct_entry_receipt = {
                            "schema_version": 1,
                            "destination_scene_id": str(requested),
                            "authority": canonical_authority,
                            "source": "scenario.destination_access",
                        }
                next_id = coc_scene_graph.pick_transition_target(
                    current_scene_id,
                    story,
                    world,
                    requested=str(requested) if requested else None,
                    discovered_clue_ids={str(c) for c in discovered},
                )
                if next_id:
                    next_scene = next(
                        (s for s in scenes if s.get("scene_id") == next_id),
                        None,
                    )
                    if next_scene is not None:
                        coc_scene_graph.record_scene_enter(
                            world,
                            next_id,
                            decision_id=decision_id,
                            ts=ts,
                            mark_previous_exhausted=str(current_scene_id)
                            if current_scene_id
                            else None,
                        )
                        world["active_scene_id"] = next_id
                        _write_json(world_path, world)
                        ev = {
                            "event_type": "scene_transition",
                            "decision_id": decision_id,
                            "from_scene": current_scene_id,
                            "to_scene": next_id,
                            "investigator_id": investigator_id,
                            "ts": ts,
                        }
                        if direct_entry_receipt is not None:
                            ev["destination_entry_receipt"] = direct_entry_receipt
                        events.append(ev)
                        _append_jsonl(logs / "events.jsonl", ev)
                        _apply_scene_on_enter(
                            campaign_dir,
                            next_scene,
                            decision_id,
                            investigator_id,
                            ts,
                            events,
                            logs,
                        )

    # 7b. session ending — PAYOFF on a terminal story-graph scene (W1-6 / p.212-213).
    # Re-read world in case a prior step advanced active_scene_id; terminal
    # detection uses only structured scene fields (see module docstring).
    world = _read_json(world_path, world)
    for milestone in _typed_completion_milestones(
        campaign_dir,
        world,
        rules_results or [],
        investigator_id=investigator_id,
        decision_id=decision_id,
        ts=ts,
    ):
        events.append(milestone)
        _append_jsonl(logs / "events.jsonl", milestone)
    outcome_ev = _commit_structured_scenario_outcome(
        campaign_dir,
        world,
        rules_results or [],
        investigator_id=investigator_id,
        decision_id=decision_id,
        ts=ts,
    )
    if outcome_ev is not None:
        events.append(outcome_ev)
        _append_jsonl(logs / "events.jsonl", outcome_ev)
        world = _read_json(world_path, world)
    ending_ev = _maybe_emit_session_ending(
        campaign_dir,
        plan,
        world=world,
        investigator_id=investigator_id,
        decision_id=decision_id,
        ts=ts,
    )
    if ending_ev is not None:
        events.append(ending_ev)
        _append_jsonl(logs / "events.jsonl", ending_ev)
        # R1-Z E5: bump storylet ledger session_number so max_per_session resets.
        try:
            coc_storylets = _load_sibling("coc_storylets", "coc_storylets.py")
            coc_storylets.start_new_session(campaign_dir)
        except Exception:
            pass

    # 8. always emit a turn event if nothing else did
    if not events:
        ev = {"event_type": "turn", "decision_id": decision_id, "action": action,
              "investigator_id": investigator_id, "ts": ts}
        events.append(ev)
        _append_jsonl(logs / "events.jsonl", ev)

    return events
