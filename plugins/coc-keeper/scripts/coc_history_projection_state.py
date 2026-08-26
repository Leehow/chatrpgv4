#!/usr/bin/env python3
"""Pure state extractor for the authority history projection.

Flattens parsed JSON state into RFC 6901 leaf pointers and turns one commit
record into deterministic snapshots, leaf-level changes, semantic entities,
and directed relations. Pure functions only: no Git access, no SQLite access,
no filesystem access — every input arrives as data.

Insertion-ready row contract: every emitted row's keys are exactly the
columns of the projection schema table it feeds (``state_snapshots``,
``state_changes``, ``entities``, ``relations`` in
``coc_history_projection_schema``). A facade inserts rows with named
parameters — no field translation. Entity rows are per-commit mentions with
``first_commit_sha == last_commit_sha == commit sha``; the facade folds them
in commit-ordinal order with
``ON CONFLICT(entity_id, entity_type) DO UPDATE SET last_commit_sha =
excluded.last_commit_sha``.

Scope: exact ``campaign.json`` / ``party.json`` plus tracked ``save/*.json``
(subdirectories included, ignore-face paths excluded). Path-level deletions
are the Git scanner's job; this module only diffs files present in the
commit record against the previous same-path snapshot.

Semantic Matcher Constitution: entity ids come only from the structured
field names below; relations come only from explicit ``from_*_id`` /
``to_*_id`` pairs or explicit relationship objects. Prose, names, and
keyword patterns are never inspected to infer meaning.
"""
from __future__ import annotations

import hashlib
import json
import re
from typing import Any

SCHEMA_GENERATION = "history-projection-1"

# Exact campaign-root state files that become snapshots.
ROOT_STATE_PATHS: frozenset[str] = frozenset({"campaign.json", "party.json"})

# Persistent state lives under save/ (any depth). Ignore-face entries inside
# it are transport/lock/cache faces, never authoritative history. Mirrors the
# shared-context ignore list for the save subtree only.
SAVE_PREFIX = "save/"
IGNORE_SAVE_PATHS: frozenset[str] = frozenset({
    "save/session-state.json",
    "save/toolbox-ledger.json",
    "save/roll-operation-receipts.json",
    "save/timeline-state.json",
})
IGNORE_SAVE_PREFIXES: tuple[str, ...] = (
    "save/commit-snapshots/",
    "save/development-settlements/",
)

# Structured entity-id field names (shared contract). A non-empty string
# value under one of these keys is a semantic entity id; nothing else is.
ENTITY_FIELDS: tuple[str, ...] = (
    "investigator_id",
    "npc_id",
    "quest_id",
    "clue_id",
    "scene_id",
    "effect_id",
    "item_id",
    "roll_id",
    "flag_id",
    "clock_id",
)
ENTITY_FIELD_SET: frozenset[str] = frozenset(ENTITY_FIELDS)
_ENTITY_SUFFIX = "_id"

# Explicit directed-reference fields: ``from_<kind>_id`` / ``to_<kind>_id``.
_FROM_FIELD = re.compile(r"^from_(?P<kind>[a-z0-9]+)_id$")
_TO_FIELD = re.compile(r"^to_(?P<kind>[a-z0-9]+)_id$")

# A dict under one of these parent keys declares itself a relationship
# object; combined with exactly two entity-id fields it yields one directed
# row (fields sorted by name: first -> second, e.g. investigator -> npc).
RELATION_PARENT_KEYS: frozenset[str] = frozenset({"relationships", "relations"})
# Explicit relation-kind marker fields inside a relationship object, checked
# in this order; absent marker means kind "".
RELATION_KIND_FIELDS: tuple[str, ...] = ("relation_kind", "relation", "relationship")

_ENTITY_ID_MAX = 128
_RELATION_KIND_MAX = 128

__all__ = [
    "SCHEMA_GENERATION",
    "ENTITY_FIELDS",
    "ROOT_STATE_PATHS",
    "IGNORE_SAVE_PATHS",
    "IGNORE_SAVE_PREFIXES",
    "RELATION_PARENT_KEYS",
    "RELATION_KIND_FIELDS",
    "canonical_json_text",
    "canonical_digest",
    "flatten_json",
    "is_state_path",
    "extract_state",
]


# --------------------------------------------------------------------------- #
# Canonical JSON helpers
# --------------------------------------------------------------------------- #

def canonical_json_text(value: Any) -> str:
    """Canonical sorted-compact JSON text for hashing and storage."""
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    )


def canonical_digest(text: str) -> str:
    """SHA-256 of canonical text (already produced by ``canonical_json_text``)."""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


# --------------------------------------------------------------------------- #
# Leaf flattening
# --------------------------------------------------------------------------- #

def _escape_pointer_token(token: str) -> str:
    """RFC 6901 escape for one pointer token."""
    return token.replace("~", "~0").replace("/", "~1")


def flatten_json(value: Any, pointer: str = "") -> dict[str, Any]:
    """Flatten a parsed JSON value into ``{json_pointer: leaf}``.

    Leaves are scalars (str/int/float/bool/None); empty dicts and lists
    contribute no leaves. A scalar root yields ``{"": value}``. Iteration
    order of the result is sorted by pointer, so output is deterministic
    regardless of source key order. Iterative walk: no recursion limit.
    """
    leaves: dict[str, Any] = {}
    stack: list[tuple[str, Any]] = [(pointer, value)]
    while stack:
        current_pointer, item = stack.pop()
        if isinstance(item, dict):
            for key in sorted(item):
                child = f"{current_pointer}/{_escape_pointer_token(key)}"
                stack.append((child, item[key]))
        elif isinstance(item, list):
            for index, element in enumerate(item):
                stack.append((f"{current_pointer}/{index}", element))
        else:
            leaves[current_pointer] = item
    return dict(sorted(leaves.items()))


# --------------------------------------------------------------------------- #
# Path scope
# --------------------------------------------------------------------------- #

def is_state_path(path: Any) -> bool:
    """True for campaign-root state files and tracked save/*.json state."""
    if not isinstance(path, str) or not path:
        return False
    if path in ROOT_STATE_PATHS:
        return True
    if not path.startswith(SAVE_PREFIX) or not path.endswith(".json"):
        return False
    if path in IGNORE_SAVE_PATHS:
        return False
    return not path.startswith(IGNORE_SAVE_PREFIXES)


# --------------------------------------------------------------------------- #
# Entity extraction (structured fields only)
# --------------------------------------------------------------------------- #

def _entity_ref(kind: str, entity_id: Any) -> tuple[str, str] | None:
    if not isinstance(entity_id, str):
        return None
    entity_id = entity_id.strip()
    if not entity_id or len(entity_id) > _ENTITY_ID_MAX:
        return None
    return (kind, entity_id)


def _entities_in_value(value: Any) -> set[tuple[str, str]]:
    """All (kind, id) refs under ENTITY_FIELD_SET keys, anywhere in value."""
    refs: set[tuple[str, str]] = set()
    stack: list[Any] = [value]
    while stack:
        item = stack.pop()
        if isinstance(item, dict):
            for key, inner in item.items():
                if key in ENTITY_FIELD_SET:
                    ref = _entity_ref(key[: -len(_ENTITY_SUFFIX)], inner)
                    if ref is not None:
                        refs.add(ref)
                stack.append(inner)
        elif isinstance(item, list):
            stack.extend(item)
    return refs


# --------------------------------------------------------------------------- #
# Relation extraction (explicit structure only)
# --------------------------------------------------------------------------- #

def _relation_kind_value(obj: dict[str, Any]) -> str:
    for field in RELATION_KIND_FIELDS:
        marker = obj.get(field)
        if isinstance(marker, str):
            marker = marker.strip()
            if marker and len(marker) <= _RELATION_KIND_MAX:
                return marker
            if marker:
                return marker[:_RELATION_KIND_MAX]
    return ""


def _directed_refs(
    obj: dict[str, Any], parent_key: str | None
) -> tuple[tuple[str, str], tuple[str, str], str] | None:
    """One directed row from explicit structure, or None.

    Rule 1 — exactly one ``from_<kind>_id`` and one ``to_<kind>_id`` string
    pair: direction is explicit.

    Rule 2 — relationship object: the dict sits under a ``relationships`` /
    ``relations`` parent key or carries an explicit relation-kind marker,
    AND holds exactly two entity-id fields; direction is field-name order
    (sorted: first -> second).
    """
    from_fields = {
        key: inner for key, inner in obj.items()
        if _FROM_FIELD.match(key) is not None
    }
    to_fields = {
        key: inner for key, inner in obj.items()
        if _TO_FIELD.match(key) is not None
    }
    if from_fields or to_fields:
        if len(from_fields) != 1 or len(to_fields) != 1:
            return None
        (from_key, from_value), = from_fields.items()
        (to_key, to_value), = to_fields.items()
        from_ref = _entity_ref(_FROM_FIELD.match(from_key).group("kind"), from_value)
        to_ref = _entity_ref(_TO_FIELD.match(to_key).group("kind"), to_value)
        if from_ref is None or to_ref is None:
            return None
        return from_ref, to_ref, _relation_kind_value(obj)

    entity_fields = {
        key: inner for key, inner in obj.items()
        if key in ENTITY_FIELD_SET
    }
    if len(entity_fields) != 2:
        return None
    kind = _relation_kind_value(obj)
    if not kind and parent_key not in RELATION_PARENT_KEYS:
        return None
    first_key, second_key = sorted(entity_fields)
    first_ref = _entity_ref(first_key[: -len(_ENTITY_SUFFIX)], entity_fields[first_key])
    second_ref = _entity_ref(second_key[: -len(_ENTITY_SUFFIX)], entity_fields[second_key])
    if first_ref is None or second_ref is None:
        return None
    return first_ref, second_ref, kind


def _relations_in_value(
    value: Any, commit_sha: str, path: str
) -> tuple[list[dict[str, Any]], set[tuple[str, str]]]:
    """Directed ``relations`` rows plus every entity ref they mention.

    Row keys are exactly the ``relations`` table columns; the full column
    tuple is the dedup key, so two explicit relations never collapse even
    when they share endpoints, kind, or pointer.
    """
    rows: list[dict[str, Any]] = []
    refs: set[tuple[str, str]] = set()
    seen: set[tuple[str, str, str, str, str, str, str, str]] = set()
    stack: list[tuple[Any, str, str | None]] = [(value, "", None)]
    while stack:
        item, pointer, parent_key = stack.pop()
        if isinstance(item, dict):
            directed = _directed_refs(item, parent_key)
            if directed is not None:
                (from_kind, from_id), (to_kind, to_id), kind = directed
                key = (
                    commit_sha, path, pointer,
                    from_kind, from_id, to_kind, to_id, kind,
                )
                if key not in seen:
                    seen.add(key)
                    rows.append({
                        "commit_sha": commit_sha,
                        "path": path,
                        "pointer": pointer,
                        "from_entity_kind": from_kind,
                        "from_entity_id": from_id,
                        "to_entity_kind": to_kind,
                        "to_entity_id": to_id,
                        "relation_kind": kind,
                    })
                    refs.add((from_kind, from_id))
                    refs.add((to_kind, to_id))
            for key in sorted(item):
                stack.append((
                    item[key],
                    f"{pointer}/{_escape_pointer_token(key)}",
                    key,
                ))
        elif isinstance(item, list):
            for index, element in enumerate(item):
                stack.append((element, f"{pointer}/{index}", parent_key))
    return rows, refs


# --------------------------------------------------------------------------- #
# Leaf diff
# --------------------------------------------------------------------------- #

def _previous_leaves(previous: Any) -> dict[str, str]:
    """Canonical leaf text map from a previous snapshot record.

    Accepts ``leaves`` (pointer -> raw leaf value) or ``snapshot_json``
    (canonical JSON text of the whole document, exactly as stored in
    ``state_snapshots.snapshot_json``). Anything else yields an empty map
    (treated as a brand-new path).
    """
    if not isinstance(previous, dict):
        return {}
    leaves = previous.get("leaves")
    if isinstance(leaves, dict):
        return {
            str(pointer): canonical_json_text(leaf)
            for pointer, leaf in leaves.items()
        }
    snapshot_json = previous.get("snapshot_json")
    if isinstance(snapshot_json, str):
        try:
            parsed = json.loads(snapshot_json)
        except json.JSONDecodeError:
            return {}
        return {
            pointer: canonical_json_text(leaf)
            for pointer, leaf in flatten_json(parsed).items()
        }
    return {}


def _diff_leaves(
    commit_sha: str,
    path: str,
    previous: dict[str, str],
    current: dict[str, str],
) -> list[dict[str, Any]]:
    """``state_changes`` rows: keys exactly match the table columns."""
    rows: list[dict[str, Any]] = []
    for pointer in sorted(set(previous) | set(current)):
        change: dict[str, Any]
        if pointer in previous and pointer in current:
            if previous[pointer] != current[pointer]:
                change = {
                    "change_type": "replace",
                    "old_value_json": previous[pointer],
                    "new_value_json": current[pointer],
                }
            else:
                continue
        elif pointer in current:
            change = {
                "change_type": "add",
                "old_value_json": None,
                "new_value_json": current[pointer],
            }
        else:
            change = {
                "change_type": "remove",
                "old_value_json": previous[pointer],
                "new_value_json": None,
            }
        rows.append({
            "commit_sha": commit_sha,
            "path": path,
            "pointer": pointer,
            "change_json": canonical_json_text(change),
        })
    return rows


# --------------------------------------------------------------------------- #
# Commit validation
# --------------------------------------------------------------------------- #

def _validate_commit(commit_record: Any) -> tuple[str, str, str, int | None, list[Any]]:
    if not isinstance(commit_record, dict):
        raise ValueError("commit_record must be an object")
    for field in ("sha", "campaign_id", "timeline_id"):
        value = commit_record.get(field)
        if not isinstance(value, str) or not value.strip():
            raise ValueError(f"commit_record.{field} must be a non-empty string")
    turn_number = commit_record.get("turn_number")
    if turn_number is not None and (
        isinstance(turn_number, bool) or not isinstance(turn_number, int)
    ):
        raise ValueError("commit_record.turn_number must be an int or null")
    files = commit_record.get("files")
    if not isinstance(files, list):
        raise ValueError("commit_record.files must be a list of file records")
    return (
        commit_record["sha"],
        commit_record["campaign_id"],
        commit_record["timeline_id"],
        turn_number,
        files,
    )


# --------------------------------------------------------------------------- #
# Extract
# --------------------------------------------------------------------------- #

def extract_state(
    commit_record: dict[str, Any],
    previous_snapshots: dict[str, dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Extract deterministic state rows for one commit record.

    Returns ``{"snapshots", "changes", "entities", "relations"}``. Every
    row's keys are exactly the columns of its projection table, so a facade
    inserts them with named parameters and no field translation:

    - snapshots: ``state_snapshots`` rows — one per in-scope file, sorted by
      path, canonical ``snapshot_json`` plus its SHA-256;
    - changes: ``state_changes`` rows — leaf-level add/remove/replace against
      the previous same-path snapshot (a path with no previous snapshot
      yields additions for every leaf), sorted by (path, pointer), with the
      decomposed diff (``change_type`` / ``old_value_json`` /
      ``new_value_json``) canonically encoded in ``change_json``;
    - entities: ``entities`` rows — one per unique (entity_type, entity_id)
      mention from structured entity-id fields and relation endpoints,
      sorted, with ``first_commit_sha == last_commit_sha == commit sha``;
      the facade folds mentions in commit-ordinal order via upsert;
    - relations: ``relations`` rows — directed rows from explicit
      ``from_*``/``to_*`` pairs or relationship objects only, preserving
      direction, endpoint kinds, relation kind, source path and JSON
      pointer, sorted by the full column tuple.

    ``previous_snapshots`` maps path -> previous snapshot record accepting
    ``snapshot_json`` (as emitted here and stored in ``state_snapshots``) or
    raw ``leaves``. Tracked state files must parse as JSON; anything else
    raises ``ValueError`` naming the path.
    """
    sha, _campaign_id, _timeline_id, _turn_number, files = _validate_commit(commit_record)
    previous = previous_snapshots or {}

    snapshots: list[dict[str, Any]] = []
    changes: list[dict[str, Any]] = []
    entity_refs: set[tuple[str, str]] = set()
    relations: list[dict[str, Any]] = []

    seen_paths: set[str] = set()
    for file_record in sorted(files, key=lambda record: str(record.get("path", "")) if isinstance(record, dict) else ""):
        if not isinstance(file_record, dict):
            raise ValueError("commit_record.files entries must be objects")
        path = file_record.get("path")
        if path in seen_paths or not is_state_path(path):
            continue
        seen_paths.add(path)
        text = file_record.get("text")
        if not isinstance(text, str):
            raise ValueError(f"state file record has no text: {path}")
        try:
            parsed = json.loads(text)
        except json.JSONDecodeError as exc:
            raise ValueError(f"state file is not valid JSON: {path}: {exc}") from exc

        snapshot_json = canonical_json_text(parsed)
        snapshot = {
            "commit_sha": sha,
            "path": path,
            "snapshot_json": snapshot_json,
            "snapshot_sha256": canonical_digest(snapshot_json),
        }
        current_leaves = {
            pointer: canonical_json_text(leaf)
            for pointer, leaf in flatten_json(parsed).items()
        }
        snapshots.append(snapshot)

        prev_record = previous.get(path)
        if (
            isinstance(prev_record, dict)
            and prev_record.get("snapshot_sha256") == snapshot["snapshot_sha256"]
        ):
            pass  # identical content: no leaf changes
        else:
            changes.extend(
                _diff_leaves(sha, path, _previous_leaves(prev_record), current_leaves)
            )

        entity_refs.update(_entities_in_value(parsed))
        rows, row_refs = _relations_in_value(parsed, sha, path)
        relations.extend(rows)
        entity_refs.update(row_refs)

    changes.sort(key=lambda row: (row["path"], row["pointer"]))
    relations.sort(key=lambda row: (
        row["path"],
        row["pointer"],
        row["from_entity_kind"],
        row["from_entity_id"],
        row["to_entity_kind"],
        row["to_entity_id"],
        row["relation_kind"],
    ))
    entities = [
        {
            "entity_id": entity_id,
            "entity_type": kind,
            "first_commit_sha": sha,
            "last_commit_sha": sha,
        }
        for kind, entity_id in sorted(entity_refs)
    ]

    return {
        "snapshots": snapshots,
        "changes": changes,
        "entities": entities,
        "relations": relations,
    }
