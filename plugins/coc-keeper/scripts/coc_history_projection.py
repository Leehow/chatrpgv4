#!/usr/bin/env python3
"""Thin integration facade for the authority history projection.

Composes the existing projection components — read-only Git scanner
(``coc_history_projection_git``), pure state/event extractors
(``coc_history_projection_state`` / ``coc_history_projection_events``),
SQLite schema/lifecycle (``coc_history_projection_schema``), and the
read-only query layer (``coc_history_projection_query``) — into one
rebuild entry point plus query re-exports. This module owns no schema,
no scanning policy, and no extraction semantics: every stored row is an
extractor-emitted insertion-ready row bound with named parameters, with
no field translation or invention.

Rebuild algorithm (:func:`rebuild_history_projection`):

1. Validate the campaign id/path through the schema helper, then scan the
   deterministic Git DAG (``rev-list --all --topo-order --reverse``:
   parents before children, oldest first). Scan failures surface as the
   typed :class:`HistoryProjectionRebuildError`.
2. Build a fresh database at a reserved temp path through the schema's
   atomic-target helper: insert ``commits`` rows in scanner order
   (ordinal = scan position), then per commit the state extractor's
   snapshots / leaf changes / entity mentions / relations and the event
   extractor's events / receipts / rolls / effects / transactions /
   backlog rows exactly as emitted.
3. State changes compare against the commit's **first parent** snapshot
   set (a root commit diffs against nothing; a confluence/merge commit's
   tree is already the resolved state, so the first-parent diff captures
   the resolution). Entity mentions fold in scan order via upsert
   (first mention sticks, last mention advances). Canonical append-log
   identities (receipts / rolls / effects / transactions) replay across
   commit snapshots and insert first-occurrence-wins
   (``INSERT OR IGNORE``) in topo order; generic event rows and backlog
   evidence rows carry no cross-commit identity and insert once per
   emitting commit.
4. Insert one ``projection_runs`` row — deterministic run id
   (``hist-rebuild:<campaign>:<input-digest>``), schema generation
   (validated to match both extractors' generations before building),
   scan-order head sha, commit count, and the deterministic content
   digest of everything inserted so far. A history with zero commits
   publishes an empty projection and records no run row (the table
   requires a head sha). The published envelope reports
   ``status="complete"``: a run row exists only in a build that passed
   publication validation.
5. Validate the temp database (schema generation, tables, indexes,
   integrity) and atomically rename it over the cache. An existing
   corrupt cache is therefore replaced only by a validated complete
   build; any failure — scan, extraction, or validation — discards the
   temp file, leaves the previous good database untouched, and raises
   the typed error without changing Git or campaign evidence.

Determinism: no wall-clock fields anywhere; two rebuilds of the same
history produce byte-equivalent logical content, the same run id, and
the same digests. ``memory/history-projection.db`` itself is on the
scanner's ignore face, so publishing the cache never feeds the scan.
"""
from __future__ import annotations

import hashlib
import sqlite3
import sys
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import coc_history_projection_events as events_mod  # noqa: E402
import coc_history_projection_git as git_mod  # noqa: E402
import coc_history_projection_state as state_mod  # noqa: E402
from coc_history_projection_query import (  # noqa: E402,F401
    query_authority_projection,
    query_entity_history,
    query_event_log,
    query_history_at,
    query_history_diff,
)
from coc_history_projection_schema import (  # noqa: E402
    SCHEMA_GENERATION,
    HistoryProjectionError,
    atomic_projection_target,
    canonical_json,
    create_projection_db,
    projection_digest,
    projection_path,
)

__all__ = [
    "HistoryProjectionRebuildError",
    "rebuild_history_projection",
    "query_authority_projection",
    "query_history_at",
    "query_history_diff",
    "query_entity_history",
    "query_event_log",
]


class HistoryProjectionRebuildError(HistoryProjectionError):
    """A history projection rebuild failed.

    The previous projection cache (if any) is untouched and Git/campaign
    evidence is unchanged; the message names the failing stage.
    """


#: Canonical-id tables whose append-log rows replay across commit
#: snapshots; inserted first-occurrence-wins in topo order.
_CANONICAL_EVENT_TABLES: tuple[str, ...] = (
    "receipts",
    "rolls",
    "effects",
    "transactions",
)

_ENTITY_UPSERT_SQL = (
    "INSERT INTO entities (entity_id, entity_type, first_commit_sha,"
    " last_commit_sha) VALUES (:entity_id, :entity_type, :first_commit_sha,"
    " :last_commit_sha) ON CONFLICT(entity_id, entity_type) DO UPDATE SET"
    " last_commit_sha = excluded.last_commit_sha"
)

_COMMIT_INSERT_SQL = (
    "INSERT INTO commits (sha, campaign_id, timeline_id, ordinal,"
    " turn_number, finalization_id, commit_type, parents_json,"
    " tree_digest, files_json) VALUES (:sha, :campaign_id, :timeline_id,"
    " :ordinal, :turn_number, :finalization_id, :commit_type,"
    " :parents_json, :tree_digest, :files_json)"
)

_RUN_INSERT_SQL = (
    "INSERT INTO projection_runs (run_id, schema_generation,"
    " head_commit_sha, commit_count, projection_digest)"
    " VALUES (:run_id, :schema_generation, :head_commit_sha,"
    " :commit_count, :projection_digest)"
)


def _require_generation_agreement() -> None:
    """Fail closed unless schema and both extractors declare one generation."""
    for module, label in (
        (state_mod, "coc_history_projection_state"),
        (events_mod, "coc_history_projection_events"),
    ):
        declared = getattr(module, "SCHEMA_GENERATION", None)
        if declared != SCHEMA_GENERATION:
            raise HistoryProjectionRebuildError(
                f"{label} declares schema generation {declared!r} but the "
                f"schema layer declares {SCHEMA_GENERATION!r}; refusing to "
                "build a mixed-generation projection"
            )


def _input_digest(records: list[dict], campaign_id: str) -> str:
    """Deterministic digest of the scanned input (no wall clock).

    Covers the campaign id plus every commit's scanned identity — sha,
    parents, timeline, turn, finalization, commit type, and allowed-face
    tree digest (which already covers each tracked path and blob).
    """
    hasher = hashlib.sha256()
    hasher.update(f"campaign:{campaign_id}\n".encode("utf-8"))
    for record in records:
        hasher.update(
            "commit:{sha}\nparents:{parents}\ntimeline:{timeline}\n"
            "turn:{turn}\nfinalization:{finalization}\ntype:{commit_type}\n"
            "tree:{tree_digest}\n".format(
                sha=record["sha"],
                parents=",".join(record["parents"]),
                timeline=record["timeline_id"],
                turn=record["turn_number"],
                finalization=record["finalization_id"],
                commit_type=record["commit_type"],
                tree_digest=record["tree_digest"],
            ).encode("utf-8")
        )
    return hasher.hexdigest()


def _insert_named(
    connection: sqlite3.Connection,
    table: str,
    rows: list[dict[str, Any]],
    *,
    or_ignore: bool = False,
) -> None:
    """Insert extractor rows verbatim, keyed by their own column names.

    Row keys are exactly the table's columns (the insertion-ready
    contract); binding is by named parameters so no translation or
    reordering happens here.
    """
    if not rows:
        return
    verb = "INSERT OR IGNORE INTO" if or_ignore else "INSERT INTO"
    for row in rows:
        columns = list(row)
        sql = '{verb} "{table}" ({names}) VALUES ({params})'.format(
            verb=verb,
            table=table,
            names=",".join(f'"{column}"' for column in columns),
            params=",".join(f":{column}" for column in columns),
        )
        connection.execute(sql, row)


def _timeline_rows(records: list[dict], campaign_id: str) -> list[dict[str, Any]]:
    """Timeline aggregate rows in first-appearance (scan) order."""
    timelines: dict[str, dict[str, Any]] = {}
    for record in records:
        timeline_id = record["timeline_id"]
        entry = timelines.get(timeline_id)
        if entry is None:
            entry = {
                "campaign_id": campaign_id,
                "timeline_id": timeline_id,
                "first_commit_sha": record["sha"],
                "head_commit_sha": record["sha"],
                "last_turn_number": None,
                "commit_count": 0,
            }
            timelines[timeline_id] = entry
        entry["head_commit_sha"] = record["sha"]
        entry["commit_count"] += 1
        turn_number = record["turn_number"]
        if turn_number is not None:
            current = entry["last_turn_number"]
            if current is None or turn_number > current:
                entry["last_turn_number"] = turn_number
    return list(timelines.values())


def _build_projection(
    connection: sqlite3.Connection, records: list[dict], campaign_id: str
) -> None:
    """Insert every row for the scanned records into the fresh database."""
    snapshots_by_commit: dict[str, dict[str, dict[str, Any]]] = {}
    for ordinal, record in enumerate(records, start=1):
        connection.execute(
            _COMMIT_INSERT_SQL,
            {
                "sha": record["sha"],
                "campaign_id": campaign_id,
                "timeline_id": record["timeline_id"],
                "ordinal": ordinal,
                "turn_number": record["turn_number"],
                "finalization_id": record["finalization_id"],
                "commit_type": record["commit_type"],
                "parents_json": canonical_json(list(record["parents"])),
                "tree_digest": record["tree_digest"],
                # Content identity only: text lives in snapshots/payloads.
                "files_json": canonical_json(
                    [
                        {"path": item["path"], "blob_sha": item["blob_sha"]}
                        for item in record["files"]
                    ]
                ),
            },
        )

        parents = record["parents"]
        parent_sha = parents[0] if parents else None
        previous = snapshots_by_commit.get(parent_sha) if parent_sha else None
        state_rows = state_mod.extract_state(record, previous)
        _insert_named(connection, "state_snapshots", state_rows["snapshots"])
        _insert_named(connection, "state_changes", state_rows["changes"])
        for row in state_rows["entities"]:
            connection.execute(_ENTITY_UPSERT_SQL, row)
        _insert_named(connection, "relations", state_rows["relations"])
        snapshots_by_commit[record["sha"]] = {
            row["path"]: row for row in state_rows["snapshots"]
        }

        event_rows = events_mod.extract_events(record)
        _insert_named(connection, "events", event_rows["events"])
        for table in _CANONICAL_EVENT_TABLES:
            _insert_named(connection, table, event_rows[table], or_ignore=True)
        _insert_named(connection, "backlog", event_rows["backlog"])

    head_sha = records[-1]["sha"] if records else None
    connection.execute(
        "INSERT INTO campaigns (campaign_id, schema_generation,"
        " head_commit_sha, commit_count) VALUES (?,?,?,?)",
        (campaign_id, SCHEMA_GENERATION, head_sha, len(records)),
    )
    _insert_named(
        connection, "timelines", _timeline_rows(records, campaign_id)
    )
    connection.commit()


def rebuild_history_projection(
    root: Path | str, campaign_id: str
) -> dict[str, Any]:
    """Rebuild the campaign's history projection cache from Git history.

    Full deterministic rebuild per the module docstring: scan the Git DAG,
    build and validate a fresh database, atomically publish it. An
    existing cache — including a corrupt one — is replaced only by the
    validated complete build; on any failure the previous database is
    untouched and :class:`HistoryProjectionRebuildError` is raised.

    Returns the run envelope: ``{"status", "campaign_id", "run_id",
    "schema_generation", "input_digest", "head_commit_sha",
    "commit_count", "projection_digest"}``. A history with zero commits
    publishes an empty projection with no run row (``run_id`` and head
    are ``None``).
    """
    _require_generation_agreement()
    # Fail closed on unsafe campaign ids/paths before touching Git.
    try:
        projection_path(root, campaign_id)
    except HistoryProjectionError as exc:
        raise HistoryProjectionRebuildError(
            f"invalid campaign id or projection path for {campaign_id!r}: {exc}"
        ) from exc
    try:
        records = git_mod.scan_campaign_history(root, campaign_id)
    except git_mod.GitScanError as exc:
        raise HistoryProjectionRebuildError(
            f"history scan failed for campaign {campaign_id!r}: {exc}"
        ) from exc

    input_digest = _input_digest(records, campaign_id)
    run_id = f"hist-rebuild:{campaign_id}:{input_digest}"
    head_sha = records[-1]["sha"] if records else None

    try:
        with atomic_projection_target(root, campaign_id) as temp_path:
            connection = create_projection_db(temp_path)
            try:
                _build_projection(connection, records, campaign_id)
                digest = projection_digest(connection)
                if records:
                    connection.execute(
                        _RUN_INSERT_SQL,
                        {
                            "run_id": run_id,
                            "schema_generation": SCHEMA_GENERATION,
                            "head_commit_sha": head_sha,
                            "commit_count": len(records),
                            "projection_digest": digest,
                        },
                    )
                    connection.commit()
            finally:
                connection.close()
    except HistoryProjectionError:
        raise
    except (ValueError, sqlite3.Error, OSError) as exc:
        raise HistoryProjectionRebuildError(
            f"history projection build failed for campaign {campaign_id!r}:"
            f" {exc}"
        ) from exc

    return {
        "status": "complete",
        "campaign_id": campaign_id,
        "run_id": run_id if records else None,
        "schema_generation": SCHEMA_GENERATION,
        "input_digest": input_digest,
        "head_commit_sha": head_sha,
        "commit_count": len(records),
        "projection_digest": digest,
    }
