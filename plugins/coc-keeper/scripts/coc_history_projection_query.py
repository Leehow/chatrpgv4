#!/usr/bin/env python3
"""Read-only SQLite query APIs for the authority history projection.

Query layer over the deletable, rebuildable projection cache created by the
schema/extractor layers. Git stays the sole persistent history: these APIs
read only the projection database — never the worktree, never the sidecar
Git repository — and never mutate anything (``PRAGMA query_only``).

Contract:

- **Authority/history data only, never semantic decisions.** Results are
  deterministic projections of stored rows: no prose matching, no keyword
  inference, no ranking judgement. Structured entity ids are matched only
  against the shared structured entity-id field contract
  (``coc_history_projection_state.ENTITY_FIELDS``) by exact id value; free
  text is never inspected.
- **Model-facing selectors stay semantic.** Callers select commits by
  ``timeline_id`` + ``turn_number``. A raw ``commit_sha`` is a
  machine-internal handle accepted **only as an exact full sha present in
  the ``commits`` table** — prefixes and partial shas are rejected, never
  resolved, so a selector's meaning cannot drift as the projection grows.
- **Fail closed.** Invalid selector combinations, missing or ambiguous
  selectors, unknown selector keys, out-of-bounds limits, projection rows
  referencing missing commits, and corrupt stored canonical JSON are hard
  :class:`ProjectionQueryError` failures — never best-effort guesses.
- ``query_history_diff`` computes leaf-level changes directly from the two
  commits' stored snapshots, using the same leaf-diff semantics the state
  extractor applies per commit. This stays exact for arbitrary pairs — same
  timeline or cross-timeline — because stored per-commit ``state_changes``
  are bound to the previous same-path snapshot in scan order, which is not
  necessarily the requested ``from`` commit.
- ``query_authority_projection`` builds the closed authority-projection
  shape consumed by the timeline-confluence conflict core: flattened state
  leaves of the tip commit plus lineage-bound event/receipt/roll/effect/
  transaction/relation/entity/assertion rows. Still a strict projection
  read; source-path attribution for the canonical roll/effect/transaction
  tables re-runs the pure events extractor over commit file texts already
  stored in the ``commits`` table (one additional intra-projection import,
  ``coc_history_projection_events`` — a pure module, no Git/SQLite access
  of its own), so no hidden duplication of the extractor's classification.
"""
from __future__ import annotations

import sqlite3
import sys
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import coc_history_projection_events as _events_mod  # noqa: E402
from coc_history_projection_schema import (  # noqa: E402
    HistoryProjectionError,
    canonical_json,
    open_projection_db,
    parse_canonical_json,
)

SCHEMA_GENERATION = "history-projection-1"

#: Structured entity-id field names (shared contract). Duplicated
#: deliberately — mirroring ``coc_history_projection_state.ENTITY_FIELDS``
#: — so this module imports only the schema helper, the same way the schema
#: and scanner modules duplicate ``_SAFE_ID``. A non-empty string under one
#: of these keys is a semantic entity id; nothing else is. Prose, names, and
#: keyword patterns are never inspected.
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
ENTITY_FIELD_SET = frozenset(ENTITY_FIELDS)
_ENTITY_SUFFIX = "_id"

#: Selector keys accepted by :func:`resolve_selector` and diff selectors.
SELECTOR_KEYS: tuple[str, ...] = ("commit_sha", "timeline_id", "turn_number")

#: Hard bounds for ``query_event_log``'s ``limit``.
MIN_EVENT_LOG_LIMIT = 1
MAX_EVENT_LOG_LIMIT = 200
DEFAULT_EVENT_LOG_LIMIT = 50

CHANGE_ADD = "add"
CHANGE_REMOVE = "remove"
CHANGE_REPLACE = "replace"


class ProjectionQueryError(HistoryProjectionError):
    """A history-projection query failed closed (selector, bounds, or data)."""


__all__ = [
    "SCHEMA_GENERATION",
    "ProjectionQueryError",
    "resolve_selector",
    "query_authority_projection",
    "query_history_at",
    "query_history_diff",
    "query_entity_history",
    "query_event_log",
]


#: Closed field set of the authority projection returned by
#: :func:`query_authority_projection`. Mirrors
#: ``coc_timeline_confluence.PROJECTION_FIELDS`` deliberately — this module
#: stays free of a confluence-core import, and tests cross-check the two
#: tuples so shape drift fails closed.
AUTHORITY_PROJECTION_FIELDS: tuple[str, ...] = (
    "timeline_id",
    "campaign_id",
    "turn_number",
    "commit_sha",
    "state",
    "events",
    "receipts",
    "rolls",
    "effects",
    "transactions",
    "relations",
    "entities",
    "assertions",
)

#: SQL ``IN`` chunk bound (SQLite's default host-parameter limit is 999).
_IN_CHUNK = 400


# --------------------------------------------------------------------------- #
# Argument / connection helpers
# --------------------------------------------------------------------------- #

def _require_nonempty_str(value: Any, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ProjectionQueryError(f"{label} must be a non-empty string")
    return value.strip()


def _require_turn_number(value: Any) -> int:
    if not isinstance(value, int) or isinstance(value, bool):
        raise ProjectionQueryError("turn_number must be an int when provided")
    return value


def _open_query_db(
    root: Path | str, campaign_id: str
) -> sqlite3.Connection:
    """Open the campaign's projection database in read-only mode.

    Campaign id and path safety are validated by the schema helper; a
    missing or wrong-generation database fails closed there.
    """
    connection = open_projection_db(root, campaign_id)
    try:
        connection.execute("PRAGMA query_only = ON")
    except sqlite3.Error as exc:
        connection.close()
        raise ProjectionQueryError(
            f"cannot lock projection database for reading: {exc}"
        ) from exc
    return connection


def _execute(
    connection: sqlite3.Connection, sql: str, params: tuple[Any, ...] = ()
) -> list[sqlite3.Row]:
    try:
        return connection.execute(sql, params).fetchall()
    except sqlite3.Error as exc:
        raise ProjectionQueryError(f"cannot read projection: {exc}") from exc


def _require_commits_exist(
    connection: sqlite3.Connection, shas: Any, *, label: str
) -> None:
    """Fail closed if any referenced ``commit_sha`` has no ``commits`` row.

    The projection schema carries no foreign keys, so orphaned detail rows
    (events, receipts, relations) are a consistency defect, not silently
    hideable data: the projection cache is stale or corrupt and must be
    rebuilt, never served partially. Orphans are detected and raised —
    never filtered away with an INNER JOIN, which would silently shrink
    history.
    """
    missing = [
        sha
        for sha in sorted({str(sha) for sha in shas})
        if not _execute(
            connection, "SELECT 1 FROM commits WHERE sha = ?", (sha,)
        )
    ]
    if missing:
        raise ProjectionQueryError(
            f"{label} references commit(s) missing from the projection: "
            + ", ".join(repr(sha) for sha in missing)
        )


# --------------------------------------------------------------------------- #
# Pointer / entity helpers (structured fields only, never prose)
# --------------------------------------------------------------------------- #

def _escape_pointer_token(token: str) -> str:
    """RFC 6901 escape for one pointer token (local; no extractor import)."""
    return token.replace("~", "~0").replace("/", "~1")


def _flatten_leaves(value: Any) -> dict[str, Any]:
    """Flatten a parsed JSON value into ``{json_pointer: leaf}``.

    Leaves are scalars (str/int/float/bool/None); empty dicts and lists
    contribute no leaves. Iterative walk, result sorted by pointer —
    deterministic regardless of source key order. Local mirror of the
    extractor's flattening so stored snapshots and event payloads can be
    scanned without importing extractor internals.
    """
    leaves: dict[str, Any] = {}
    stack: list[tuple[str, Any]] = [("", value)]
    while stack:
        pointer, item = stack.pop()
        if isinstance(item, dict):
            for key in sorted(item):
                stack.append((f"{pointer}/{_escape_pointer_token(key)}", item[key]))
        elif isinstance(item, list):
            for index, element in enumerate(item):
                stack.append((f"{pointer}/{index}", element))
        else:
            leaves[pointer] = item
    return dict(sorted(leaves.items()))


def _unescape_pointer_token(token: str) -> str:
    return token.replace("~1", "/").replace("~0", "~")


def _last_pointer_token(pointer: str) -> str:
    token = pointer.rsplit("/", 1)[-1]
    return _unescape_pointer_token(token) if token else ""


def _entity_kind(entity_field: str) -> str:
    return entity_field[: -len(_ENTITY_SUFFIX)]


def _entities_at_node(node: Any) -> set[tuple[str, str]]:
    """Structured (kind, id) refs in one dict's entity-id fields, if any."""
    refs: set[tuple[str, str]] = set()
    if isinstance(node, dict):
        for key, value in node.items():
            if key in ENTITY_FIELD_SET and isinstance(value, str):
                entity_id = value.strip()
                if entity_id:
                    refs.add((_entity_kind(key), entity_id))
    return refs


def _entities_along_pointer(
    document: Any, pointer: str
) -> list[dict[str, str]]:
    """Entity refs in every dict on the pointer's root-to-leaf walk.

    Purely structural: walks the exact JSON pointer through the parsed
    document and collects structured entity-id fields from each dict on the
    path. Never inspects prose values.
    """
    refs: set[tuple[str, str]] = set()
    current: Any = document
    refs.update(_entities_at_node(current))
    if pointer:
        for raw_token in pointer.split("/")[1:]:
            token = _unescape_pointer_token(raw_token)
            if isinstance(current, dict):
                current = current.get(token)
            elif isinstance(current, list):
                try:
                    index = int(token)
                except ValueError:
                    current = None
                else:
                    current = (
                        current[index]
                        if -len(current) <= index < len(current)
                        else None
                    )
            else:
                current = None
            if current is None:
                break
            refs.update(_entities_at_node(current))
    return [
        {"entity_type": kind, "entity_id": entity_id}
        for kind, entity_id in sorted(refs)
    ]


def _entity_leaf_mentions(value: Any, entity_id: str) -> list[dict[str, str]]:
    """Pointers of entity-id leaves whose exact (stripped) id matches.

    A mention is a leaf whose pointer's final token is one of the structured
    entity-id field names and whose string value equals ``entity_id`` after
    the same strip normalization the extractor applies. Sorted by
    (pointer, entity_type).
    """
    found: list[dict[str, str]] = []
    for pointer, leaf in _flatten_leaves(value).items():
        token = _last_pointer_token(pointer)
        if (
            token in ENTITY_FIELD_SET
            and isinstance(leaf, str)
            and leaf.strip() == entity_id
        ):
            found.append({"pointer": pointer, "entity_type": _entity_kind(token)})
    return sorted(found, key=lambda item: (item["pointer"], item["entity_type"]))


def _merge_entity_refs(
    *ref_lists: list[dict[str, str]],
) -> list[dict[str, str]]:
    merged = {
        (ref["entity_type"], ref["entity_id"])
        for ref_list in ref_lists
        for ref in ref_list
    }
    return [
        {"entity_type": kind, "entity_id": entity_id}
        for kind, entity_id in sorted(merged)
    ]


# --------------------------------------------------------------------------- #
# Commit records and selectors
# --------------------------------------------------------------------------- #

def _commit_record(row: sqlite3.Row) -> dict[str, Any]:
    """Commits row -> commit record with ``parents``/``files`` decoded.

    Corrupt stored canonical JSON fails closed via ``parse_canonical_json``.
    """
    parents = parse_canonical_json(row["parents_json"])
    files = parse_canonical_json(row["files_json"])
    if not isinstance(parents, list) or not isinstance(files, list):
        raise ProjectionQueryError(
            "stored commit record is corrupt (parents/files not lists): "
            f"{row['sha']}"
        )
    return {
        "sha": row["sha"],
        "campaign_id": row["campaign_id"],
        "timeline_id": row["timeline_id"],
        "turn_number": row["turn_number"],
        "finalization_id": row["finalization_id"],
        "commit_type": row["commit_type"],
        "ordinal": row["ordinal"],
        "parents": parents,
        "tree_digest": row["tree_digest"],
        "files": files,
    }


def _describe_selector(
    *, timeline_id: str | None, turn_number: int | None, commit_sha: str | None
) -> str:
    parts: list[str] = []
    if commit_sha is not None:
        parts.append(f"commit_sha={commit_sha!r}")
    if timeline_id is not None:
        parts.append(f"timeline_id={timeline_id!r}")
    if turn_number is not None:
        parts.append(f"turn_number={turn_number!r}")
    return ", ".join(parts)


def resolve_selector(
    connection: sqlite3.Connection,
    *,
    timeline_id: str | None = None,
    turn_number: int | None = None,
    commit_sha: str | None = None,
) -> dict[str, Any]:
    """Resolve exactly one ``commits`` row from a selector combination.

    Accepted forms (all provided values are AND-ed):

    - ``commit_sha`` (alone or with the others): the value must be the
      **exact full sha** of a stored commit. Prefixes, partial shas, and
      unknown values all fail closed — there is no prefix resolution, so a
      selector's meaning cannot silently change as the projection grows.
      Raw shas are machine-internal handles; model-facing callers must
      prefer the semantic form.
    - ``timeline_id`` + ``turn_number``: the semantic form. Both are
      required — a timeline alone is ambiguous by definition, and a turn
      alone can match commits across timelines.

    Raises :class:`ProjectionQueryError` (fail closed) on an invalid
    combination, no match, or an ambiguous match. Returns a commit record
    (see :func:`_commit_record`) decoded from stored canonical JSON.
    """
    if commit_sha is not None:
        commit_sha = _require_nonempty_str(commit_sha, "commit_sha")
    if timeline_id is not None:
        timeline_id = _require_nonempty_str(timeline_id, "timeline_id")
    if turn_number is not None:
        turn_number = _require_turn_number(turn_number)
    if commit_sha is None:
        if timeline_id is None and turn_number is None:
            raise ProjectionQueryError(
                "selector needs commit_sha or timeline_id + turn_number; "
                "no selector was provided"
            )
        if timeline_id is None:
            raise ProjectionQueryError(
                "turn_number selector requires timeline_id (a turn alone can "
                "match commits across timelines)"
            )
        if turn_number is None:
            raise ProjectionQueryError(
                "timeline_id selector requires turn_number (a timeline alone "
                "matches many commits)"
            )

    if commit_sha is not None:
        exact = _execute(
            connection, "SELECT * FROM commits WHERE sha = ?", (commit_sha,)
        )
        if not exact:
            raise ProjectionQueryError(
                "commit_sha selector must be an exact full sha present in "
                f"the projection; no commit matched: {commit_sha!r}"
            )
        candidates = exact
    else:
        candidates = list(_execute(connection, "SELECT * FROM commits"))
    if timeline_id is not None:
        candidates = [row for row in candidates if row["timeline_id"] == timeline_id]
    if turn_number is not None:
        candidates = [row for row in candidates if row["turn_number"] == turn_number]

    description = _describe_selector(
        timeline_id=timeline_id, turn_number=turn_number, commit_sha=commit_sha
    )
    if not candidates:
        raise ProjectionQueryError(f"selector matched no commit: {description}")
    if len(candidates) > 1:
        raise ProjectionQueryError(
            f"selector is ambiguous: matched {len(candidates)} commits "
            f"({description})"
        )
    return _commit_record(candidates[0])


def _selector_kwargs(selector: Any, label: str) -> dict[str, Any]:
    """Validate one diff selector mapping into resolve_selector kwargs."""
    if not isinstance(selector, dict):
        raise ProjectionQueryError(
            f"{label} must be a mapping of selector keys {SELECTOR_KEYS}"
        )
    unknown = sorted(set(selector) - set(SELECTOR_KEYS))
    if unknown:
        raise ProjectionQueryError(
            f"{label} has unknown selector keys: {', '.join(unknown)}"
        )
    return {
        key: selector[key]
        for key in SELECTOR_KEYS
        if selector.get(key) is not None
    }


# --------------------------------------------------------------------------- #
# Snapshots and leaf diff
# --------------------------------------------------------------------------- #

def _snapshot_documents(
    connection: sqlite3.Connection, commit_sha: str
) -> dict[str, Any]:
    """path -> parsed snapshot document, sorted by path; fail-closed parse."""
    rows = _execute(
        connection,
        "SELECT path, snapshot_json FROM state_snapshots"
        " WHERE commit_sha = ? ORDER BY path",
        (commit_sha,),
    )
    return {
        str(row["path"]): parse_canonical_json(row["snapshot_json"])
        for row in rows
    }


def _leaf_texts(document: Any) -> tuple[dict[str, str], dict[str, Any]]:
    """(pointer -> canonical leaf text, pointer -> raw leaf) maps."""
    leaves = _flatten_leaves(document)
    return (
        {pointer: canonical_json(leaf) for pointer, leaf in leaves.items()},
        leaves,
    )


def _diff_documents(
    from_documents: dict[str, Any], to_documents: dict[str, Any]
) -> list[dict[str, Any]]:
    """Deterministic leaf-level diff between two snapshot document sets.

    Same semantics as the state extractor's per-commit leaf diff — add /
    remove / replace on RFC 6901 leaf pointers, compared by canonical leaf
    text — but between the two explicitly selected commits, so it is exact
    for arbitrary pairs including cross-timeline ones. Rows are sorted by
    (path, pointer); each row carries structured entity attribution from
    every dict along the changed pointer's path (from side, to side, or
    both, per change type).
    """
    changes: list[dict[str, Any]] = []
    for path in sorted(set(from_documents) | set(to_documents)):
        has_from = path in from_documents
        has_to = path in to_documents
        from_doc = from_documents.get(path)
        to_doc = to_documents.get(path)
        from_text, from_raw = _leaf_texts(from_doc) if has_from else ({}, {})
        to_text, to_raw = _leaf_texts(to_doc) if has_to else ({}, {})
        for pointer in sorted(set(from_text) | set(to_text)):
            in_from = pointer in from_text
            in_to = pointer in to_text
            change: dict[str, Any] = {"path": path, "pointer": pointer}
            if in_from and in_to:
                if from_text[pointer] == to_text[pointer]:
                    continue
                change["change_type"] = CHANGE_REPLACE
                change["old_value"] = from_raw[pointer]
                change["new_value"] = to_raw[pointer]
                change["entities"] = _merge_entity_refs(
                    _entities_along_pointer(from_doc, pointer),
                    _entities_along_pointer(to_doc, pointer),
                )
            elif in_to:
                change["change_type"] = CHANGE_ADD
                change["old_value"] = None
                change["new_value"] = to_raw[pointer]
                change["entities"] = _entities_along_pointer(to_doc, pointer)
            else:
                change["change_type"] = CHANGE_REMOVE
                change["old_value"] = from_raw[pointer]
                change["new_value"] = None
                change["entities"] = _entities_along_pointer(from_doc, pointer)
            changes.append(change)
    return changes


# --------------------------------------------------------------------------- #
# Public query APIs
# --------------------------------------------------------------------------- #

def query_history_at(
    root: Path | str,
    campaign_id: str,
    *,
    timeline_id: str | None = None,
    turn_number: int | None = None,
    commit_sha: str | None = None,
) -> dict[str, Any]:
    """Commit metadata plus parsed state snapshots at one selected commit.

    Selectors follow :func:`resolve_selector` (semantic timeline+turn, or a
    machine-internal sha). Returns ``{"commit", "snapshots"}`` where
    ``snapshots`` maps path -> ``{"snapshot_sha256", "state"}`` (parsed),
    sorted by path. Reads only the projection database — no worktree or Git
    access. Corrupt stored JSON fails closed.
    """
    connection = _open_query_db(root, campaign_id)
    try:
        commit = resolve_selector(
            connection,
            timeline_id=timeline_id,
            turn_number=turn_number,
            commit_sha=commit_sha,
        )
        rows = _execute(
            connection,
            "SELECT path, snapshot_json, snapshot_sha256 FROM state_snapshots"
            " WHERE commit_sha = ? ORDER BY path",
            (commit["sha"],),
        )
        snapshots: dict[str, Any] = {}
        for row in rows:
            snapshots[str(row["path"])] = {
                "snapshot_sha256": row["snapshot_sha256"],
                "state": parse_canonical_json(row["snapshot_json"]),
            }
        return {"commit": commit, "snapshots": snapshots}
    finally:
        connection.close()


def query_history_diff(
    root: Path | str,
    campaign_id: str,
    from_selector: Any,
    to_selector: Any,
) -> dict[str, Any]:
    """Deterministic leaf-level changes between two selected commits.

    ``from_selector`` / ``to_selector`` are mappings of selector keys
    (``commit_sha`` / ``timeline_id`` / ``turn_number``) resolved via
    :func:`resolve_selector`; unknown keys fail closed. Cross-timeline pairs
    are allowed. Returns ``{"from_commit", "to_commit", "changes"}`` where
    each change is ``{"path", "pointer", "change_type", "old_value",
    "new_value", "entities"}`` sorted by (path, pointer) — see
    :func:`_diff_documents` for the exact semantics. Selecting the same
    commit on both sides yields an empty change list.
    """
    connection = _open_query_db(root, campaign_id)
    try:
        from_commit = resolve_selector(
            connection, **_selector_kwargs(from_selector, "from_selector")
        )
        to_commit = resolve_selector(
            connection, **_selector_kwargs(to_selector, "to_selector")
        )
        from_documents = _snapshot_documents(connection, from_commit["sha"])
        to_documents = _snapshot_documents(connection, to_commit["sha"])
        return {
            "from_commit": from_commit,
            "to_commit": to_commit,
            "changes": _diff_documents(from_documents, to_documents),
        }
    finally:
        connection.close()


def query_entity_history(
    root: Path | str,
    campaign_id: str,
    entity_id: str,
    *,
    timeline_id: str | None = None,
) -> dict[str, Any]:
    """Ordered commits, events, and relations affecting one entity id.

    The entity id is matched exactly (after the extractor's strip
    normalization) against structured entity-id fields only — never prose.
    "Affecting" is deterministic structured evidence:

    - commits: commits whose stored state snapshots mention the entity in a
      structured entity-id leaf, plus commits with an explicit relation row
      naming the entity as an endpoint. The snapshot scan is bounded to the
      entity's first..last mention ordinal window from the ``entities``
      table (the extractor folds every structured mention, so mentions
      cannot exist outside that window);
    - events: event rows whose parsed payload mentions the entity under a
      structured entity-id field;
    - relations: explicit directed relation rows naming the entity as either
      endpoint.

    ``timeline_id`` optionally filters the returned lists; ``entity_types``
    and ``first``/``last_commit_sha`` echo the global ``entities`` rows.
    Rows referencing commits missing from the projection, and corrupt stored
    JSON, fail closed.
    """
    entity = _require_nonempty_str(entity_id, "entity_id")
    if timeline_id is not None:
        timeline_id = _require_nonempty_str(timeline_id, "timeline_id")

    connection = _open_query_db(root, campaign_id)
    try:
        entity_rows = _execute(
            connection,
            "SELECT entity_type, first_commit_sha, last_commit_sha"
            " FROM entities WHERE entity_id = ? ORDER BY entity_type",
            (entity,),
        )
        entity_types = [str(row["entity_type"]) for row in entity_rows]

        first_commit_sha: str | None = None
        last_commit_sha: str | None = None
        window: tuple[int, int] | None = None
        commit_cache: dict[str, sqlite3.Row] = {}
        if entity_rows:
            ordinals: list[tuple[int, int]] = []
            for row in entity_rows:
                pair: list[int] = []
                for column in ("first_commit_sha", "last_commit_sha"):
                    provenance = _execute(
                        connection,
                        "SELECT * FROM commits WHERE sha = ?",
                        (row[column],),
                    )
                    if not provenance:
                        raise ProjectionQueryError(
                            "entity provenance references a commit missing "
                            f"from the projection: {row[column]!r}"
                        )
                    commit_cache[row[column]] = provenance[0]
                    pair.append(int(provenance[0]["ordinal"]))
                ordinals.append((pair[0], pair[1]))
            window = (
                min(first for first, _ in ordinals),
                max(last for _, last in ordinals),
            )
            first_commit_sha = _execute(
                connection,
                "SELECT sha FROM commits WHERE ordinal = ?",
                (window[0],),
            )[0]["sha"]
            last_commit_sha = _execute(
                connection,
                "SELECT sha FROM commits WHERE ordinal = ?",
                (window[1],),
            )[0]["sha"]

        mentions_by_sha: dict[str, list[dict[str, Any]]] = {}
        if window is not None:
            for commit_row in _execute(
                connection,
                "SELECT * FROM commits WHERE ordinal BETWEEN ? AND ?"
                " ORDER BY ordinal",
                window,
            ):
                commit_cache[commit_row["sha"]] = commit_row
                mentions = _snapshot_mentions(
                    connection, commit_row["sha"], entity
                )
                if mentions:
                    mentions_by_sha[commit_row["sha"]] = mentions

        relation_rows = _execute(
            connection,
            "SELECT r.commit_sha, r.path, r.pointer, r.from_entity_kind,"
            " r.from_entity_id, r.to_entity_kind, r.to_entity_id,"
            " r.relation_kind, c.ordinal AS commit_ordinal,"
            " c.timeline_id AS commit_timeline_id,"
            " c.turn_number AS commit_turn_number"
            " FROM relations r LEFT JOIN commits c ON c.sha = r.commit_sha"
            " WHERE r.from_entity_id = ? OR r.to_entity_id = ?"
            " ORDER BY c.ordinal, r.path, r.pointer, r.from_entity_kind,"
            " r.from_entity_id, r.to_entity_kind, r.to_entity_id,"
            " r.relation_kind",
            (entity, entity),
        )
        # LEFT JOIN detects orphans; they fail closed, never hide via INNER.
        _require_commits_exist(
            connection,
            (row["commit_sha"] for row in relation_rows),
            label="relation provenance",
        )
        relations: list[dict[str, Any]] = []
        for row in relation_rows:
            if row["commit_ordinal"] is None:
                raise ProjectionQueryError(
                    "relation references a commit missing from the "
                    f"projection: {row['commit_sha']!r}"
                )
            if timeline_id is not None and (
                row["commit_timeline_id"] != timeline_id
            ):
                continue
            relations.append({
                "commit_sha": row["commit_sha"],
                "commit_ordinal": row["commit_ordinal"],
                "timeline_id": row["commit_timeline_id"],
                "turn_number": row["commit_turn_number"],
                "path": row["path"],
                "pointer": row["pointer"],
                "from_entity_kind": row["from_entity_kind"],
                "from_entity_id": row["from_entity_id"],
                "to_entity_kind": row["to_entity_kind"],
                "to_entity_id": row["to_entity_id"],
                "relation_kind": row["relation_kind"],
            })

        events: list[dict[str, Any]] = []
        for row in _execute(
            connection, "SELECT * FROM events ORDER BY event_id"
        ):
            payload = parse_canonical_json(row["payload_json"])
            refs = _entity_leaf_mentions(payload, entity)
            if not refs:
                continue
            if timeline_id is not None and row["timeline_id"] != timeline_id:
                continue
            _require_commits_exist(
                connection, (row["commit_sha"],), label="event provenance"
            )
            events.append({
                "event_id": row["event_id"],
                "commit_sha": row["commit_sha"],
                "timeline_id": row["timeline_id"],
                "turn_number": row["turn_number"],
                "source_path": row["source_path"],
                "source_ordinal": row["source_ordinal"],
                "event_type": row["event_type"],
                "payload_sha256": row["payload_sha256"],
                "payload": payload,
                "entity_refs": refs,
            })

        included_shas = set(mentions_by_sha)
        included_shas.update(row["commit_sha"] for row in relation_rows)
        commits: list[dict[str, Any]] = []
        for sha in included_shas:
            commit_row = commit_cache.get(sha)
            if commit_row is None:
                found = _execute(
                    connection, "SELECT * FROM commits WHERE sha = ?", (sha,)
                )
                if not found:
                    raise ProjectionQueryError(
                        "projection row references a commit missing from "
                        f"the projection: {sha!r}"
                    )
                commit_row = found[0]
            if timeline_id is not None and (
                commit_row["timeline_id"] != timeline_id
            ):
                continue
            commits.append({
                "sha": commit_row["sha"],
                "timeline_id": commit_row["timeline_id"],
                "turn_number": commit_row["turn_number"],
                "commit_type": commit_row["commit_type"],
                "ordinal": commit_row["ordinal"],
                "mentions": mentions_by_sha.get(sha, []),
            })
        commits.sort(key=lambda entry: entry["ordinal"])

        return {
            "entity_id": entity,
            "timeline_id": timeline_id,
            "entity_types": entity_types,
            "first_commit_sha": first_commit_sha,
            "last_commit_sha": last_commit_sha,
            "commits": commits,
            "events": events,
            "relations": relations,
        }
    finally:
        connection.close()


def _snapshot_mentions(
    connection: sqlite3.Connection, commit_sha: str, entity_id: str
) -> list[dict[str, Any]]:
    """Structured entity-id leaf mentions across one commit's snapshots."""
    mentions: list[dict[str, Any]] = []
    for path, document in _snapshot_documents(connection, commit_sha).items():
        for found in _entity_leaf_mentions(document, entity_id):
            mentions.append({"path": path, **found})
    return sorted(
        mentions,
        key=lambda item: (item["path"], item["pointer"], item["entity_type"]),
    )


def query_event_log(
    root: Path | str,
    campaign_id: str,
    *,
    timeline_id: str | None = None,
    event_types: Any = None,
    limit: int = DEFAULT_EVENT_LOG_LIMIT,
) -> dict[str, Any]:
    """Newest-first event log over the projection.

    Ordering is deterministic: ``turn_number DESC`` then ``event_id DESC``
    (events without a turn sort last). ``limit`` must be an int in
    ``[1, 200]`` (fail closed otherwise). ``event_types`` is an optional
    sequence of event type strings (exact match, ``IN``); an empty sequence,
    a bare string, or non-string entries fail closed. Payloads are returned
    parsed from the stored canonical JSON with privacy fields (``secret``,
    ``visibility``, ...) preserved verbatim; corrupt payload JSON fails
    closed.
    """
    if timeline_id is not None:
        timeline_id = _require_nonempty_str(timeline_id, "timeline_id")
    if not isinstance(limit, int) or isinstance(limit, bool):
        raise ProjectionQueryError("limit must be an int")
    if not MIN_EVENT_LOG_LIMIT <= limit <= MAX_EVENT_LOG_LIMIT:
        raise ProjectionQueryError(
            f"limit must be between {MIN_EVENT_LOG_LIMIT} and "
            f"{MAX_EVENT_LOG_LIMIT}, got {limit}"
        )
    normalized_types: list[str] | None = None
    if event_types is not None:
        if isinstance(event_types, (str, bytes)):
            raise ProjectionQueryError(
                "event_types must be a sequence of event type strings, not a "
                "single string"
            )
        try:
            provided = list(event_types)
        except TypeError as exc:
            raise ProjectionQueryError(
                "event_types must be a sequence of event type strings"
            ) from exc
        if not provided:
            raise ProjectionQueryError(
                "event_types must contain at least one event type when "
                "provided"
            )
        for item in provided:
            if not isinstance(item, str) or not item.strip():
                raise ProjectionQueryError(
                    "event_types entries must be non-empty strings"
                )
        normalized_types = sorted(set(provided))

    connection = _open_query_db(root, campaign_id)
    try:
        clauses: list[str] = []
        params: list[Any] = []
        if timeline_id is not None:
            clauses.append("timeline_id = ?")
            params.append(timeline_id)
        if normalized_types is not None:
            clauses.append(
                "event_type IN (" + ",".join("?" for _ in normalized_types) + ")"
            )
            params.extend(normalized_types)
        where = f" WHERE {' AND '.join(clauses)}" if clauses else ""
        rows = _execute(
            connection,
            "SELECT * FROM events" + where
            + " ORDER BY turn_number DESC, event_id DESC LIMIT ?",
            (*params, limit),
        )
        # Selected events must have commit provenance: an orphan detail row
        # is a stale/corrupt projection and fails closed, never a silently
        # shortened log.
        _require_commits_exist(
            connection,
            (row["commit_sha"] for row in rows),
            label="event provenance",
        )
        events: list[dict[str, Any]] = []
        for row in rows:
            events.append({
                "event_id": row["event_id"],
                "commit_sha": row["commit_sha"],
                "timeline_id": row["timeline_id"],
                "turn_number": row["turn_number"],
                "source_path": row["source_path"],
                "source_ordinal": row["source_ordinal"],
                "event_type": row["event_type"],
                "payload_sha256": row["payload_sha256"],
                "payload": parse_canonical_json(row["payload_json"]),
            })
        return {
            "timeline_id": timeline_id,
            "event_types": normalized_types,
            "limit": limit,
            "events": events,
        }
    finally:
        connection.close()


# --------------------------------------------------------------------------- #
# Authority projection for timeline confluence
# --------------------------------------------------------------------------- #

def _chunked_rows(
    connection: sqlite3.Connection,
    sql_template: str,
    shas: list[str],
) -> list[sqlite3.Row]:
    """Rows whose ``commit_sha`` IN ``shas``, chunked for SQLite limits."""
    rows: list[sqlite3.Row] = []
    for start in range(0, len(shas), _IN_CHUNK):
        chunk = shas[start : start + _IN_CHUNK]
        sql = sql_template.format(placeholder=",".join("?" for _ in chunk))
        rows.extend(_execute(connection, sql, tuple(chunk)))
    return rows


def _ancestor_closure(
    connection: sqlite3.Connection, tip_sha: str
) -> list[str]:
    """Every commit reachable from ``tip_sha`` through stored parents.

    Inclusive of the tip; returned sorted. A missing parent reference is a
    stale or corrupt projection and fails closed — the lineage is never
    silently truncated.
    """
    pending = [tip_sha]
    seen: set[str] = set()
    while pending:
        sha = pending.pop()
        if sha in seen:
            continue
        seen.add(sha)
        found = _execute(
            connection, "SELECT parents_json FROM commits WHERE sha = ?", (sha,)
        )
        if not found:
            raise ProjectionQueryError(
                "lineage walk reached a commit missing from the projection: "
                f"{sha!r}"
            )
        parents = parse_canonical_json(found[0]["parents_json"])
        if not isinstance(parents, list):
            raise ProjectionQueryError(
                "stored commit record is corrupt (parents not a list): "
                f"{sha!r}"
            )
        pending.extend(
            parent for parent in parents if isinstance(parent, str) and parent
        )
    return sorted(seen)


def _latest_own_turn(connection: sqlite3.Connection, timeline_id: str) -> int:
    """Latest finalized turn on one timeline; fails closed when ambiguous.

    A timeline that owns no turn commits has no tip of its own — callers
    resolve fresh-fork aliases through timeline metadata before asking here
    (this module never reads the worktree or Git refs).
    """
    rows = _execute(
        connection,
        "SELECT turn_number FROM commits"
        " WHERE timeline_id = ? AND turn_number IS NOT NULL",
        (timeline_id,),
    )
    turns = [int(row["turn_number"]) for row in rows]
    if not turns:
        raise ProjectionQueryError(
            f"timeline {timeline_id!r} has no finalized turns in the history "
            "projection"
        )
    latest = max(turns)
    if turns.count(latest) > 1:
        raise ProjectionQueryError(
            f"timeline {timeline_id!r} has {turns.count(latest)} commits at "
            f"turn {latest}; the latest turn is ambiguous"
        )
    return latest


def _entity_refs_in_value(value: Any) -> set[tuple[str, str]]:
    """Structured (kind, id) refs anywhere in one parsed JSON value.

    Exact ``ENTITY_FIELD_SET`` key membership with non-empty string values
    only — the same structured-field contract the extractor applies; prose
    is never inspected.
    """
    refs: set[tuple[str, str]] = set()
    stack: list[Any] = [value]
    while stack:
        item = stack.pop()
        if isinstance(item, dict):
            for key, inner in item.items():
                if (
                    key in ENTITY_FIELD_SET
                    and isinstance(inner, str)
                    and inner.strip()
                ):
                    refs.add((_entity_kind(key), inner.strip()))
                stack.append(inner)
        elif isinstance(item, list):
            stack.extend(item)
    return refs


def _canonical_source_paths(
    connection: sqlite3.Connection, closure: list[str]
) -> dict[tuple[str, str], str]:
    """(table_kind, canonical_row_id) -> source JSONL path, topo-first wins.

    The canonical roll/effect/transaction tables carry no source-path
    column; the pure events extractor recovers it exactly from the commit
    file texts already stored in ``commits.files_json``. First occurrence
    in topo order mirrors the facade's first-occurrence-wins inserts.
    """
    attribution: dict[tuple[str, str], str] = {}
    rows = _chunked_rows(
        connection,
        "SELECT sha, ordinal, campaign_id, timeline_id, turn_number,"
        " commit_type, files_json FROM commits WHERE sha IN ({placeholder})",
        closure,
    )
    records = sorted(
        (
            {
                "sha": row["sha"],
                "ordinal": int(row["ordinal"]),
                "campaign_id": row["campaign_id"],
                "timeline_id": row["timeline_id"],
                "turn_number": row["turn_number"],
                "commit_type": row["commit_type"],
                "files": parse_canonical_json(row["files_json"]),
            }
            for row in rows
        ),
        key=lambda record: record["ordinal"],
    )
    for record in records:
        try:
            extracted = _events_mod.extract_events(record)
        except _events_mod.EventExtractionError as exc:
            raise ProjectionQueryError(
                f"cannot attribute log sources from stored history: {exc}"
            ) from exc
        for table, key in (
            ("rolls", "roll_id"),
            ("effects", "effect_id"),
            ("transactions", "transaction_id"),
        ):
            for row in extracted.get(table) or []:
                row_id = row.get(key)
                if isinstance(row_id, str) and row_id:
                    attribution.setdefault((table, row_id), row.get("source_path"))
    return attribution


def query_authority_projection(
    root: Path | str,
    campaign_id: str,
    *,
    timeline_id: str,
    turn_number: int | None = None,
    commit_sha: str | None = None,
    projection_timeline_id: str | None = None,
) -> dict[str, Any]:
    """Closed authority projection of one timeline tip, for confluence.

    Resolves exactly one tip commit (semantic ``timeline_id`` plus
    ``turn_number``, or a machine-internal exact ``commit_sha``; when no
    turn is given, the latest unambiguous own turn of the timeline — a
    fresh fork with no own turns fails closed here and must be resolved
    through timeline metadata by the caller). ``projection_timeline_id``
    labels the returned projection's worldline; it defaults to
    ``timeline_id`` and exists so a caller may resolve a fresh-fork alias
    through metadata while still labelling the projection with the
    requested semantic timeline id.

    Returns a mapping with exactly ``AUTHORITY_PROJECTION_FIELDS`` keys:

    - ``state``: JSON-pointer -> leaf map over **every** snapshot document
      of the tip commit, keys ``"<tree path><json pointer>"`` so leaves of
      different files never collide and every key names its tree path;
    - ``events``/``receipts``/``rolls``/``effects``/``transactions``/
      ``assertions``: rows bound to the tip's **lineage** (every ancestor
      commit, via stored parent links), each with its canonical id,
      payload digest + canonical payload text, and — where the table has
      it or the extractor attributes it — the source JSONL path;
    - ``relations``: directed relation rows present in the **tip** commit's
      snapshots (the current authoritative relations);
    - ``entities``: (entity_id, entity_type) rows for structured entity-id
      mentions anywhere in the lineage's snapshots;
    - ``commit_sha``/``turn_number``: machine context of the tip; shas are
      machine-internal handles and never appear on a model-facing surface.

    Strictly read-only; deterministic ordering everywhere.
    """
    timeline_id = _require_nonempty_str(timeline_id, "timeline_id")
    label_timeline_id = (
        _require_nonempty_str(projection_timeline_id, "projection_timeline_id")
        if projection_timeline_id is not None
        else timeline_id
    )
    connection = _open_query_db(root, campaign_id)
    try:
        if turn_number is None and commit_sha is None:
            turn_number = _latest_own_turn(connection, timeline_id)
        tip = resolve_selector(
            connection,
            timeline_id=timeline_id,
            turn_number=turn_number,
            commit_sha=commit_sha,
        )
        closure = _ancestor_closure(connection, tip["sha"])

        state: dict[str, Any] = {}
        entity_refs: set[tuple[str, str]] = set()
        for path, document in _snapshot_documents(connection, tip["sha"]).items():
            for pointer, leaf in _flatten_leaves(document).items():
                state[f"{path}{pointer}"] = leaf
        for sha in closure:
            for document in _snapshot_documents(connection, sha).values():
                entity_refs.update(_entity_refs_in_value(document))

        attribution = _canonical_source_paths(connection, closure)

        events = [
            {
                "event_id": row["event_id"],
                "timeline_id": row["timeline_id"],
                "turn_number": row["turn_number"],
                "source_path": row["source_path"],
                "source_ordinal": row["source_ordinal"],
                "event_type": row["event_type"],
                "payload_sha256": row["payload_sha256"],
                "payload_json": row["payload_json"],
            }
            for row in _chunked_rows(
                connection,
                "SELECT * FROM events WHERE commit_sha IN ({placeholder})"
                " ORDER BY event_id",
                closure,
            )
        ]
        receipts = [
            {
                "receipt_id": row["receipt_id"],
                # The receipts table's canonical PK is the finalization (or
                # explicit receipt) id; the confluence core joins receipts
                # cross-side by that identity under this field name.
                "finalization_id": row["receipt_id"],
                "receipt_type": row["receipt_type"],
                "timeline_id": row["timeline_id"],
                "turn_number": row["turn_number"],
                "payload_sha256": row["payload_sha256"],
                "payload_json": row["payload_json"],
            }
            for row in _chunked_rows(
                connection,
                "SELECT * FROM receipts WHERE commit_sha IN ({placeholder})"
                " ORDER BY receipt_id",
                closure,
            )
        ]
        rolls = [
            {
                "roll_id": row["roll_id"],
                "source_path": attribution.get(("rolls", row["roll_id"])),
                "timeline_id": row["timeline_id"],
                "turn_number": row["turn_number"],
                "payload_sha256": row["payload_sha256"],
                "payload_json": row["payload_json"],
            }
            for row in _chunked_rows(
                connection,
                "SELECT * FROM rolls WHERE commit_sha IN ({placeholder})"
                " ORDER BY roll_id",
                closure,
            )
        ]
        effects = [
            {
                "effect_id": row["effect_id"],
                "entity_id": row["entity_id"],
                "source_path": attribution.get(("effects", row["effect_id"])),
                "timeline_id": row["timeline_id"],
                "turn_number": row["turn_number"],
                "payload_sha256": row["payload_sha256"],
                "payload_json": row["payload_json"],
            }
            for row in _chunked_rows(
                connection,
                "SELECT * FROM effects WHERE commit_sha IN ({placeholder})"
                " ORDER BY effect_id",
                closure,
            )
        ]
        transactions = [
            {
                "transaction_id": row["transaction_id"],
                "source_path": attribution.get(
                    ("transactions", row["transaction_id"])
                ),
                "timeline_id": row["timeline_id"],
                "turn_number": row["turn_number"],
                "payload_sha256": row["payload_sha256"],
                "payload_json": row["payload_json"],
            }
            for row in _chunked_rows(
                connection,
                "SELECT * FROM transactions WHERE commit_sha IN"
                " ({placeholder}) ORDER BY transaction_id",
                closure,
            )
        ]
        assertions = [
            {
                "assertion_id": row["assertion_id"],
                "timeline_id": row["timeline_id"],
                "turn_number": row["turn_number"],
                "payload_sha256": row["payload_sha256"],
                "payload_json": row["payload_json"],
            }
            for row in _chunked_rows(
                connection,
                "SELECT * FROM memory_assertions WHERE commit_sha IN"
                " ({placeholder}) ORDER BY assertion_id",
                closure,
            )
        ]
        relations = [
            {
                "from_entity_kind": row["from_entity_kind"],
                "from_entity_id": row["from_entity_id"],
                "to_entity_kind": row["to_entity_kind"],
                "to_entity_id": row["to_entity_id"],
                "relation_kind": row["relation_kind"],
                "path": row["path"],
                "pointer": row["pointer"],
            }
            for row in _execute(
                connection,
                "SELECT * FROM relations WHERE commit_sha = ?"
                " ORDER BY path, pointer, from_entity_kind, from_entity_id,"
                " to_entity_kind, to_entity_id, relation_kind",
                (tip["sha"],),
            )
        ]
        entities = [
            {"entity_id": entity_id, "entity_type": kind}
            for kind, entity_id in sorted(entity_refs)
        ]
        return {
            "timeline_id": label_timeline_id,
            "campaign_id": campaign_id,
            "turn_number": tip["turn_number"],
            "commit_sha": tip["sha"],
            "state": dict(sorted(state.items())),
            "events": events,
            "receipts": receipts,
            "rolls": rolls,
            "effects": effects,
            "transactions": transactions,
            "relations": relations,
            "entities": entities,
            "assertions": assertions,
        }
    finally:
        connection.close()
