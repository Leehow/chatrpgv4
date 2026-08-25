#!/usr/bin/env python3
"""Persistent quest runtime state, projection, and machine settlement.

``save/quest-state.json`` (schema_version 1) is the runtime state for
action-shaped quests authored in module-assets ``entities/quest-<slug>.json``
packs and the optional ``scenario/quests.json`` IR file (contract:
``skills/coc-scenario-import/references/quest-schema.md``; layout:
``references/state-schema.md`` Quest State).

Per-quest state machine: ``authored`` (or absent) -> ``offered`` -> ``active``
-> terminal ``completed`` | ``failed`` | ``abandoned``, plus the direct
``authored -> abandoned`` drop (a quest the Keeper shelves before ever
offering it). Every transition binds one ``decision_id`` recorded in the
quest's ``decision_history``; replay never applies the same decision twice.

Machine-checkable completion/failure conditions reuse the single
``coc_exit_conditions`` vocabulary and settle automatically on the
settled-event path (precedent: ``coc_belief_state.apply_belief_turn``).
``narrative`` conditions are machine-False forever and close only through an
explicit Keeper ``quest.settle`` receipt. Quest pressure is advisory: nothing
here blocks or rewrites any action, scene transition, or ending.
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Callable

SCRIPT_DIR = Path(__file__).resolve().parent


def _load_sibling(name: str, filename: str):
    import importlib.util
    spec = importlib.util.spec_from_file_location(name, SCRIPT_DIR / filename)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


coc_fileio = _load_sibling("coc_fileio_quest", "coc_fileio.py")
coc_exit_conditions = _load_sibling("coc_exit_conditions_quest", "coc_exit_conditions.py")
coc_threat_state = _load_sibling("coc_threat_state_quest", "coc_threat_state.py")
coc_module_assets = _load_sibling("coc_module_assets_quest", "coc_module_assets.py")

SCHEMA_VERSION = 1
QUEST_STATE_PATH = ("save", "quest-state.json")

QUEST_STATUS_AUTHORED = "authored"
QUEST_STATUS_OFFERED = "offered"
QUEST_STATUS_ACTIVE = "active"
QUEST_TERMINAL_STATUSES = ("completed", "failed", "abandoned")
QUEST_STATUSES = (
    QUEST_STATUS_AUTHORED,
    QUEST_STATUS_OFFERED,
    QUEST_STATUS_ACTIVE,
    *QUEST_TERMINAL_STATUSES,
)

# Legal transitions, one row per (action, outcome). The frozen machine is
# authored -> offered -> active -> terminal; ``settle-abandoned`` is also
# legal from authored/offered (a quest dropped before or at the offer, never
# accepted). completed/failed close only from active.
QUEST_TRANSITIONS: dict[str, dict[str, str]] = {
    "offer": {QUEST_STATUS_AUTHORED: QUEST_STATUS_OFFERED},
    "activate": {QUEST_STATUS_OFFERED: QUEST_STATUS_ACTIVE},
    "settle-completed": {QUEST_STATUS_ACTIVE: "completed"},
    "settle-failed": {QUEST_STATUS_ACTIVE: "failed"},
    # Declined or shelved offers are abandoned exactly like unoffered stubs.
    "settle-abandoned": {
        QUEST_STATUS_AUTHORED: "abandoned",
        QUEST_STATUS_OFFERED: "abandoned",
        QUEST_STATUS_ACTIVE: "abandoned",
    },
}

# Mirrors the pack-contract pattern in coc_module_assets (single authority for
# the frozen id shape; repeated here only as an anchored read-side guard).
_QUEST_ID = re.compile(r"^quest-[a-z0-9-]+$")

_QUEST_IMPORTANCE_ORDER = {"core": 0, "supporting": 1, "optional": 2}


class QuestStateError(ValueError):
    """Raised on illegal quest-state transitions or malformed state files."""


# --- State file --------------------------------------------------------------


def new_quest_state() -> dict[str, Any]:
    return {"schema_version": SCHEMA_VERSION, "quests": {}}


def _normalize_record(quest_id: str, raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raise QuestStateError(f"quest {quest_id}: state record must be an object")
    status = raw.get("status")
    if status not in QUEST_STATUSES:
        raise QuestStateError(
            f"quest {quest_id}: unknown status {status!r}; quest-state.json does "
            "not match schema_version 1"
        )
    history = raw.get("decision_history")
    if not isinstance(history, list) or any(
        not isinstance(value, str) or not value for value in history
    ):
        raise QuestStateError(
            f"quest {quest_id}: decision_history must be a list of decision ids"
        )
    if len(set(history)) != len(history):
        raise QuestStateError(f"quest {quest_id}: duplicate decision id in history")
    if status != QUEST_STATUS_AUTHORED and not history:
        raise QuestStateError(
            f"quest {quest_id}: status {status!r} without any recorded decision"
        )
    record: dict[str, Any] = {"status": status, "decision_history": list(history)}
    offered_at = raw.get("offered_at")
    if offered_at is not None:
        if status == QUEST_STATUS_AUTHORED:
            raise QuestStateError(f"quest {quest_id}: offered_at set while authored")
        if not isinstance(offered_at, str) or not offered_at:
            raise QuestStateError(f"quest {quest_id}: offered_at must be a decision id")
        record["offered_at"] = offered_at
    closed_at = raw.get("closed_at")
    close_receipt = raw.get("close_receipt")
    if status in QUEST_TERMINAL_STATUSES:
        if not isinstance(closed_at, str) or not closed_at:
            raise QuestStateError(f"quest {quest_id}: terminal without closed_at")
        if not isinstance(close_receipt, dict):
            raise QuestStateError(f"quest {quest_id}: terminal without close_receipt")
        if close_receipt.get("outcome") != status:
            raise QuestStateError(
                f"quest {quest_id}: close_receipt outcome does not match status"
            )
        record["closed_at"] = closed_at
        record["close_receipt"] = dict(close_receipt)
    else:
        if closed_at is not None or close_receipt is not None:
            raise QuestStateError(
                f"quest {quest_id}: closed_at/close_receipt set on a live quest"
            )
    return record


def normalize_quest_state(payload: dict[str, Any] | None) -> dict[str, Any]:
    state = dict(payload or {})
    state["schema_version"] = SCHEMA_VERSION
    quests = state.get("quests")
    if not isinstance(quests, dict):
        raise QuestStateError("quest-state.json quests must be an object")
    normalized: dict[str, Any] = {}
    for quest_id, raw in quests.items():
        key = str(quest_id)
        if not _QUEST_ID.fullmatch(key):
            raise QuestStateError(f"quest-state.json key {key!r} is not a quest id")
        normalized[key] = _normalize_record(key, raw)
    state["quests"] = normalized
    return state


def read_quest_state(campaign_dir: Path) -> dict[str, Any]:
    path = Path(campaign_dir) / QUEST_STATE_PATH[0] / QUEST_STATE_PATH[1]
    if not path.is_file():
        return new_quest_state()
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise QuestStateError(f"quest-state.json is unreadable: {exc}") from exc
    if not isinstance(payload, dict) or payload.get("schema_version") != SCHEMA_VERSION:
        raise QuestStateError(
            "quest-state.json does not match schema_version 1; refusing to "
            "interpret a foreign schema"
        )
    return normalize_quest_state(payload)


def _write_state(campaign_dir: Path, state: dict[str, Any]) -> None:
    coc_fileio.write_json_atomic(
        Path(campaign_dir) / QUEST_STATE_PATH[0] / QUEST_STATE_PATH[1],
        normalize_quest_state(state),
        indent=2,
        ensure_ascii=False,
        trailing_newline=True,
    )


# --- Transitions --------------------------------------------------------------


def quest_status(state: dict[str, Any], quest_id: str) -> str:
    record = (state.get("quests") or {}).get(quest_id)
    if isinstance(record, dict) and isinstance(record.get("status"), str):
        return record["status"]
    return QUEST_STATUS_AUTHORED


def apply_quest_transition(
    state: dict[str, Any],
    quest_id: str,
    action: str,
    decision_id: str,
    *,
    settled_by: str = "keeper",
    basis: str | None = None,
    ts: str | None = None,
) -> dict[str, Any]:
    """Apply one transition in-memory and return its receipt.

    Raises :class:`QuestStateError` on an illegal transition, an unknown
    action, or a ``decision_id`` already recorded for this quest. The caller
    owns read -> apply -> write, so a batch of transitions lands in one
    atomic write.
    """
    if not isinstance(decision_id, str) or not decision_id.strip():
        raise QuestStateError("decision_id must be a non-empty string")
    decision_id = decision_id.strip()
    transitions = QUEST_TRANSITIONS.get(action)
    if transitions is None:
        raise QuestStateError(f"unknown quest action {action!r}")
    quests = state.setdefault("quests", {})
    record = quests.get(quest_id)
    if not isinstance(record, dict):
        record = {"status": QUEST_STATUS_AUTHORED, "decision_history": []}
    current = record.get("status") if isinstance(record.get("status"), str) else None
    if current not in QUEST_STATUSES:
        raise QuestStateError(f"quest {quest_id}: unknown status {current!r}")
    if decision_id in (record.get("decision_history") or []):
        raise QuestStateError(
            f"quest {quest_id}: decision_id '{decision_id}' was already applied"
        )
    target = transitions.get(current)
    if target is None:
        raise QuestStateError(
            f"quest {quest_id}: cannot {action} from status {current!r}"
        )
    record = dict(record)
    history = [*record.get("decision_history", []), decision_id]
    new_record: dict[str, Any] = {
        "status": target,
        "decision_history": history,
    }
    if action == "offer":
        new_record["offered_at"] = decision_id
    elif record.get("offered_at"):
        new_record["offered_at"] = record["offered_at"]
    receipt: dict[str, Any] = {
        "quest_id": quest_id,
        "from_status": current,
        "status": target,
        "action": action,
        "decision_id": decision_id,
        "settled_by": settled_by,
    }
    if action.startswith("settle-"):
        close_receipt: dict[str, Any] = {
            "outcome": target,
            "settled_by": settled_by,
            "decision_id": decision_id,
        }
        if ts:
            close_receipt["ts"] = ts
        if basis:
            close_receipt["basis"] = basis
        new_record["closed_at"] = decision_id
        new_record["close_receipt"] = close_receipt
        receipt["close_receipt"] = dict(close_receipt)
    quests[quest_id] = new_record
    return receipt


def transition_quest(
    campaign_dir: Path,
    quest_id: str,
    action: str,
    decision_id: str,
    *,
    settled_by: str = "keeper",
    basis: str | None = None,
    ts: str | None = None,
) -> dict[str, Any]:
    state = read_quest_state(campaign_dir)
    receipt = apply_quest_transition(
        state, quest_id, action, decision_id,
        settled_by=settled_by, basis=basis, ts=ts,
    )
    _write_state(campaign_dir, state)
    return receipt


# --- Definitions (scenario IR + entity packs) ---------------------------------


def _read_json_object(path: Path) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return payload if isinstance(payload, dict) else {}


def _resolve_workspace_root(campaign_dir: Path) -> Path:
    """Walk up from a campaign dir to the workspace holding ``.coc``."""
    for ancestor in (Path(campaign_dir), *Path(campaign_dir).parents):
        if (ancestor / ".coc").is_dir():
            return ancestor
    return Path(campaign_dir)


def campaign_quest_asset_root_id(campaign_dir: Path) -> str | None:
    """Campaign-bound module asset root for quest packs.

    Reads the same campaign pointers as
    ``coc_module_project.campaign_source_asset_root_id`` (progressive /
    source-cache bindings, then progressive module-meta). Kept local so the
    quest module does not pull the whole module-project machinery into the
    director apply path; drift here is a bug in one of the two readers.
    """
    campaign_dir = Path(campaign_dir)
    scenario = _read_json_object(campaign_dir / "scenario" / "scenario.json")
    for key in ("progressive_asset_root_id", "source_cache_asset_root_id"):
        value = str(scenario.get(key) or "").strip()
        if value:
            return value
    meta = _read_json_object(campaign_dir / "scenario" / "module-meta.json")
    if meta.get("progressive"):
        value = str(
            (meta.get("module_identity") or {}).get("canonical_module_id")
            or meta.get("scenario_id")
            or ""
        ).strip()
        return value or None
    return None


def read_quest_definitions(
    campaign_dir: Path,
    *,
    root: Path | None = None,
) -> dict[str, dict[str, Any]]:
    """Quest definitions keyed by quest_id: entity packs overlaid by IR rows.

    The compiled ``scenario/quests.json`` IR is the campaign-bound truth and
    wins on collision; module-assets packs are the authoring/parse cache
    (including ``campaign-improvised`` quests created by ``quest.improvise``).
    """
    campaign_dir = Path(campaign_dir)
    definitions: dict[str, dict[str, Any]] = {}

    asset_root_id = campaign_quest_asset_root_id(campaign_dir)
    if asset_root_id:
        workspace = Path(root) if root is not None else _resolve_workspace_root(campaign_dir)
        entities_dir = (
            coc_module_assets.assets_root(workspace) / asset_root_id / "entities"
        )
        if entities_dir.is_dir():
            for path in sorted(entities_dir.glob("quest-*.json")):
                slug = path.stem[len("quest-"):]
                if not slug:
                    continue
                try:
                    pack = coc_module_assets.get_entity(
                        workspace, asset_root_id, "quest", slug,
                    )
                except Exception:
                    continue  # unreadable store entry is not a definition
                if not isinstance(pack, dict):
                    continue
                quest_id = str(pack.get("quest_id") or f"quest-{slug}")
                definitions[quest_id] = {
                    **pack,
                    "definition_source": "entity_pack",
                }

    ir = _read_json_object(campaign_dir / "scenario" / "quests.json")
    rows = ir.get("quests")
    if isinstance(rows, list):
        for row in rows:
            if not isinstance(row, dict):
                continue
            quest_id = str(row.get("quest_id") or "").strip()
            if not _QUEST_ID.fullmatch(quest_id):
                continue
            definitions[quest_id] = {**row, "definition_source": "scenario_ir"}
    return definitions


# --- Machine condition evaluation ---------------------------------------------


def truthy_flag_ids(flags_doc: dict[str, Any] | None) -> set[str]:
    if not isinstance(flags_doc, dict):
        return set()
    raw = flags_doc.get("flags")
    if not isinstance(raw, dict):
        return set()
    return {str(key) for key, value in raw.items() if value}


def clock_reached_reader(campaign_dir: Path) -> Callable[[str | None, int], bool]:
    """``clock_reached(clock_id, threshold)`` over persisted threat clocks.

    Same semantics as the apply layer's unlock pass: any tracked clock when
    ``clock_id`` is None, the named clock otherwise, met at
    ``current_segments >= threshold``.
    """
    campaign_dir = Path(campaign_dir)
    save_dir = campaign_dir / "save"

    def clock_reached(clock_id: str | None, threshold: int) -> bool:
        fronts = _read_json_object(campaign_dir / "scenario" / "threat-fronts.json")
        for front in fronts.get("fronts") or []:
            if not isinstance(front, dict):
                continue
            for clock in front.get("clocks") or []:
                cid = str((clock or {}).get("clock_id") or "")
                if not cid:
                    continue
                if clock_id and cid != str(clock_id):
                    continue
                if coc_threat_state.get_clock_segments(save_dir, cid) >= threshold:
                    return True
        return False

    return clock_reached


def _condition_row(
    condition: Any,
    *,
    discovered: set[str],
    clock_reached: Callable[[str | None, int], bool],
    flags_set: set[str],
) -> dict[str, Any]:
    normalized = coc_exit_conditions.normalize_exit_condition(condition)
    kind = normalized["kind"]
    met = coc_exit_conditions.evaluate_exit_condition(
        condition,
        discovered_clue_ids=discovered,
        clock_reached=clock_reached,
        flags_set=flags_set,
    )
    row: dict[str, Any] = {"kind": kind, "met": bool(met)}
    if kind == "clue_discovered":
        row["clue_id"] = normalized.get("clue_id")
    elif kind == "clock_reaches":
        row["clock_id"] = normalized.get("clock_id")
        row["threshold"] = normalized.get("threshold")
    elif kind == "flag_set":
        row["flag_id"] = normalized.get("flag_id")
    return row


def evaluate_condition_group(
    group: Any,
    *,
    discovered_clue_ids: set[str],
    clock_reached: Callable[[str | None, int], bool],
    flags_set: set[str],
) -> dict[str, Any] | None:
    """Evaluate one completion/failure group against structured world state.

    Returns None when the quest authors no group. A group whose only content
    is the ``narrative`` string is machine-False forever
    (``narrative_required``): it closes only through an explicit Keeper
    ``quest.settle`` receipt. ``all`` must be fully met and ``any`` (when
    present) must have at least one met condition.
    """
    if group is None:
        return None
    if not isinstance(group, dict):
        return None
    all_conds = group.get("all")
    any_conds = group.get("any")
    narrative = group.get("narrative")
    all_rows = [
        _condition_row(
            condition,
            discovered=discovered_clue_ids,
            clock_reached=clock_reached,
            flags_set=flags_set,
        )
        for condition in (all_conds if isinstance(all_conds, list) else [])
    ]
    any_rows = [
        _condition_row(
            condition,
            discovered=discovered_clue_ids,
            clock_reached=clock_reached,
            flags_set=flags_set,
        )
        for condition in (any_conds if isinstance(any_conds, list) else [])
    ]
    narrative_required = isinstance(narrative, str) and bool(narrative.strip())
    all_met = all(row["met"] for row in all_rows) if all_rows else True
    any_met = any(row["met"] for row in any_rows) if any_rows else True
    has_machine_conds = bool(all_rows or any_rows)
    return {
        "met": bool(
            not narrative_required and has_machine_conds and all_met and any_met
        ),
        "narrative_required": bool(narrative_required),
        "has_machine_conditions": has_machine_conds,
        "all": all_rows,
        "any": any_rows,
    }


def machine_outcome(
    definition: dict[str, Any],
    *,
    discovered_clue_ids: set[str],
    clock_reached: Callable[[str | None, int], bool],
    flags_set: set[str],
) -> tuple[str | None, dict[str, Any]]:
    """Machine settlement verdict for one quest definition, or None.

    Completion is evaluated before failure, so a quest whose groups are both
    met settles completed; the failure group only ever wins when completion
    has not already fired. Groups with a ``narrative`` string never settle
    here — the Keeper owns that closure.
    """
    completion = evaluate_condition_group(
        definition.get("completion"),
        discovered_clue_ids=discovered_clue_ids,
        clock_reached=clock_reached,
        flags_set=flags_set,
    )
    if completion is not None and completion["met"]:
        return "completed", {"group": "completion", "evaluation": completion}
    failure = evaluate_condition_group(
        definition.get("failure"),
        discovered_clue_ids=discovered_clue_ids,
        clock_reached=clock_reached,
        flags_set=flags_set,
    )
    if failure is not None and failure["met"]:
        return "failed", {"group": "failure", "evaluation": failure}
    return None, {}


# --- Projections --------------------------------------------------------------


def _player_visible_face(definition: dict[str, Any], record: dict[str, Any]) -> dict[str, Any] | None:
    """Player-safe fields, only once the quest has actually been offered."""
    if not record.get("offered_at"):
        return None
    face: dict[str, Any] = {}
    localized = definition.get("localized_title")
    if isinstance(localized, dict) and localized:
        face["localized_title"] = dict(localized)
    face["title"] = definition.get("title")
    summary = definition.get("player_safe_summary")
    if isinstance(summary, str) and summary.strip():
        face["player_safe_summary"] = summary
    return face


def quest_projection(
    campaign_dir: Path,
    *,
    definitions: dict[str, dict[str, Any]] | None = None,
    state: dict[str, Any] | None = None,
    world: dict[str, Any] | None = None,
    flags_set: set[str] | None = None,
    clock_reached: Callable[[str | None, int], bool] | None = None,
    root: Path | None = None,
) -> dict[str, Any]:
    """Keeper-only advisory map of every known quest and where it stands."""
    campaign_dir = Path(campaign_dir)
    if definitions is None:
        definitions = read_quest_definitions(campaign_dir, root=root)
    if state is None:
        state = read_quest_state(campaign_dir)
    discovered = {
        str(clue_id)
        for clue_id in ((world or {}).get("discovered_clue_ids") or [])
    }
    if flags_set is None:
        flags_doc = _read_json_object(campaign_dir / "save" / "flags.json")
        flags_set = truthy_flag_ids(flags_doc)
    if clock_reached is None:
        clock_reached = clock_reached_reader(campaign_dir)

    rows: list[dict[str, Any]] = []
    for quest_id, definition in definitions.items():
        record = (state.get("quests") or {}).get(quest_id) or {}
        status = record.get("status") or QUEST_STATUS_AUTHORED
        row: dict[str, Any] = {
            "quest_id": quest_id,
            "title": definition.get("title"),
            "importance": definition.get("importance"),
            "quest_kinds": definition.get("quest_kinds") or [],
            "status": status,
            "secret": bool(definition.get("secret")),
            "provenance": definition.get("provenance"),
            "definition_source": definition.get("definition_source"),
            "offered_at": record.get("offered_at"),
            "closed_at": record.get("closed_at"),
            "close_receipt": record.get("close_receipt"),
        }
        for optional_key in (
            "parse_state", "giver", "deadline", "destination_scene_id",
            "mainline_links", "evidence_gap",
        ):
            if definition.get(optional_key) is not None:
                row[optional_key] = definition.get(optional_key)
        if status in (QUEST_STATUS_OFFERED, QUEST_STATUS_ACTIVE):
            completion = evaluate_condition_group(
                definition.get("completion"),
                discovered_clue_ids=discovered,
                clock_reached=clock_reached,
                flags_set=flags_set,
            )
            failure = evaluate_condition_group(
                definition.get("failure"),
                discovered_clue_ids=discovered,
                clock_reached=clock_reached,
                flags_set=flags_set,
            )
            if completion is not None:
                row["completion"] = completion
                row["narrative_closure_required"] = completion["narrative_required"]
            if failure is not None:
                row["failure"] = failure
            outcome, _basis = machine_outcome(
                definition,
                discovered_clue_ids=discovered,
                clock_reached=clock_reached,
                flags_set=flags_set,
            )
            row["machine_settle_ready"] = outcome
        player_face = _player_visible_face(definition, record)
        if player_face is not None:
            row["player_safe"] = player_face
        rows.append(row)
    rows.sort(key=lambda row: (
        _QUEST_IMPORTANCE_ORDER.get(str(row.get("importance")), 3),
        str(row.get("quest_id")),
    ))
    return {
        "schema_version": 1,
        "keeper_only": True,
        "authority": "advisory",
        "note": (
            "Every quest the campaign knows, with machine condition progress. "
            "Advisory pressure only: quests never block actions, scenes, or "
            "endings, and narrative conditions close only through "
            "quest.settle. Nothing here is player-safe before offered."
        ),
        "quests": rows,
    }


def quest_progress_summary(
    campaign_dir: Path,
    *,
    definitions: dict[str, dict[str, Any]] | None = None,
    state: dict[str, Any] | None = None,
    world: dict[str, Any] | None = None,
    flags_set: set[str] | None = None,
    clock_reached: Callable[[str | None, int], bool] | None = None,
    root: Path | None = None,
) -> dict[str, Any]:
    """Compact offered/active summary for the ``story_progress`` projection."""
    projection = quest_projection(
        campaign_dir,
        definitions=definitions,
        state=state,
        world=world,
        flags_set=flags_set,
        clock_reached=clock_reached,
        root=root,
    )
    live_rows = [
        {
            "quest_id": row["quest_id"],
            "title": row.get("title"),
            "importance": row.get("importance"),
            "status": row["status"],
            "secret": row.get("secret", False),
            "machine_settle_ready": row.get("machine_settle_ready"),
            "narrative_closure_required": row.get("narrative_closure_required"),
        }
        for row in projection["quests"]
        if row["status"] in (QUEST_STATUS_OFFERED, QUEST_STATUS_ACTIVE)
    ]
    counts = {
        status: sum(1 for row in projection["quests"] if row["status"] == status)
        for status in QUEST_STATUSES
    }
    return {
        "schema_version": 1,
        "keeper_only": True,
        "authority": "advisory",
        "live": live_rows,
        "status_counts": counts,
    }


# --- Machine settlement pass ---------------------------------------------------


def settle_machine_settled_quests(
    campaign_dir: Path,
    *,
    world: dict[str, Any],
    decision_id: str,
    investigator_id: str | None = None,
    ts: str | None = None,
    root: Path | None = None,
) -> list[dict[str, Any]]:
    """Auto-settle active quests whose machine conditions are met.

    Hook for the settled-event path (after clue/flag/clock writes land — the
    same seam as the scene unlock pass). Runs on ``active`` quests only: the
    frozen machine settles from ``active``, and an unoffered/unaccepted quest
    is pressure, not a verdict. Advisory by construction: this never raises
    into the caller — on unexpected failure it reports one
    ``quest_settlement_skipped`` event and lets play continue.
    """
    campaign_dir = Path(campaign_dir)
    try:
        definitions = read_quest_definitions(campaign_dir, root=root)
        if not definitions:
            return []
        state = read_quest_state(campaign_dir)
        discovered = {
            str(clue_id)
            for clue_id in ((world or {}).get("discovered_clue_ids") or [])
        }
        flags_set = truthy_flag_ids(
            _read_json_object(campaign_dir / "save" / "flags.json")
        )
        clock_reached = clock_reached_reader(campaign_dir)

        events: list[dict[str, Any]] = []
        for quest_id in sorted(definitions):
            record = (state.get("quests") or {}).get(quest_id)
            if not isinstance(record, dict) or record.get("status") != QUEST_STATUS_ACTIVE:
                continue
            outcome, basis = machine_outcome(
                definitions[quest_id],
                discovered_clue_ids=discovered,
                clock_reached=clock_reached,
                flags_set=flags_set,
            )
            if outcome is None:
                continue
            auto_decision = f"{decision_id}:quest-auto:{quest_id}:{outcome}"
            if auto_decision in (record.get("decision_history") or []):
                continue
            receipt = apply_quest_transition(
                state,
                quest_id,
                f"settle-{outcome}",
                auto_decision,
                settled_by="machine",
                basis=(
                    f"machine condition group '{basis.get('group')}' met on "
                    "the settled-event path"
                ),
                ts=ts,
            )
            events.append({
                "event_type": "quest_settled",
                "decision_id": auto_decision,
                "source_decision_id": decision_id,
                "quest_id": quest_id,
                "outcome": outcome,
                "settled_by": "machine",
                "basis": basis.get("group"),
                "close_receipt": receipt.get("close_receipt"),
                "investigator_id": investigator_id,
                "ts": ts,
            })
        if events:
            _write_state(campaign_dir, state)
        return events
    except Exception as exc:  # advisory: quest pressure never blocks play
        return [{
            "event_type": "quest_settlement_skipped",
            "decision_id": decision_id,
            "reason": f"{type(exc).__name__}: {exc}",
            "ts": ts,
        }]


__all__ = [
    "QUEST_STATUSES",
    "QUEST_STATUS_ACTIVE",
    "QUEST_STATUS_AUTHORED",
    "QUEST_STATUS_OFFERED",
    "QUEST_TERMINAL_STATUSES",
    "QUEST_TRANSITIONS",
    "QuestStateError",
    "apply_quest_transition",
    "campaign_quest_asset_root_id",
    "clock_reached_reader",
    "evaluate_condition_group",
    "machine_outcome",
    "new_quest_state",
    "normalize_quest_state",
    "quest_progress_summary",
    "quest_projection",
    "quest_status",
    "read_quest_definitions",
    "read_quest_state",
    "settle_machine_settled_quests",
    "transition_quest",
    "truthy_flag_ids",
]
