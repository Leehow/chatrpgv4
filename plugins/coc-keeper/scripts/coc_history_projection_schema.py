#!/usr/bin/env python3
"""SQLite schema/lifecycle for the authority history projection cache.

The projection lives at ``<root>/.coc/campaigns/<id>/memory/history-projection.db``
and is a deletable, rebuildable cache over the campaign's git sidecar history;
git remains the sole persistent record. This module owns constants, campaign
path safety, the complete DDL/indexes, create/open helpers, validated atomic
publication of a rebuilt database (schema generation, required tables and
indexes, and SQLite integrity are verified before the rename), canonical
JSON storage encoding, and a deterministic content digest. It performs no
git scanning, no extraction, and no query APIs, records no wall-clock
fields, and defines no migrations: a projection of a different schema
generation is discarded and rebuilt.
"""
from __future__ import annotations

import contextlib
import hashlib
import json
import os
import re
import sqlite3
import tempfile
from collections.abc import Iterator
from pathlib import Path
from typing import Any

SCHEMA_GENERATION = "history-projection-1"
PROJECTION_USER_VERSION = 1

MEMORY_DIR_NAME = "memory"
PROJECTION_DB_NAME = "history-projection.db"

# Fixed table order is part of the digest contract: every table participates,
# in this order, independent of insertion order.
PROJECTION_TABLES: tuple[str, ...] = (
    "campaigns",
    "timelines",
    "commits",
    "entities",
    "state_snapshots",
    "state_changes",
    "events",
    "receipts",
    "rolls",
    "effects",
    "transactions",
    "relations",
    "memory_assertions",
    "conflicts",
    "projection_runs",
    "backlog",
)

# Same constraint as coc_state._SAFE_ID / coc_git_history._SAFE_ID. Duplicated
# so this module stays importable without loading campaign-state machinery.
_SAFE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")

# Single-file journal mode is load-bearing: the projection is published by
# renaming one file over the target, so WAL sidecars must never exist.
# Relations keep every explicit source relation distinct: direction, endpoint
# kinds, relation kind, source path and JSON pointer are all columns, and the
# primary key includes each of them, so two explicit relations that share
# endpoints never collapse. The state extractor emits rows with exactly these
# columns.
_DDL_STATEMENTS: tuple[str, ...] = (
    """
    CREATE TABLE campaigns (
        campaign_id TEXT PRIMARY KEY,
        schema_generation TEXT NOT NULL,
        head_commit_sha TEXT,
        commit_count INTEGER NOT NULL DEFAULT 0
    )
    """,
    """
    CREATE TABLE timelines (
        campaign_id TEXT NOT NULL,
        timeline_id TEXT NOT NULL,
        first_commit_sha TEXT,
        head_commit_sha TEXT,
        last_turn_number INTEGER,
        commit_count INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (campaign_id, timeline_id)
    )
    """,
    """
    CREATE TABLE commits (
        sha TEXT PRIMARY KEY,
        campaign_id TEXT NOT NULL,
        timeline_id TEXT NOT NULL,
        ordinal INTEGER NOT NULL UNIQUE,
        turn_number INTEGER,
        finalization_id TEXT,
        commit_type TEXT NOT NULL,
        parents_json TEXT NOT NULL,
        tree_digest TEXT NOT NULL,
        files_json TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE entities (
        entity_id TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        first_commit_sha TEXT NOT NULL,
        last_commit_sha TEXT NOT NULL,
        PRIMARY KEY (entity_id, entity_type)
    )
    """,
    """
    CREATE TABLE state_snapshots (
        commit_sha TEXT NOT NULL,
        path TEXT NOT NULL,
        snapshot_sha256 TEXT NOT NULL,
        snapshot_json TEXT NOT NULL,
        PRIMARY KEY (commit_sha, path)
    )
    """,
    """
    CREATE TABLE state_changes (
        commit_sha TEXT NOT NULL,
        path TEXT NOT NULL,
        pointer TEXT NOT NULL,
        change_json TEXT NOT NULL,
        PRIMARY KEY (commit_sha, path, pointer)
    )
    """,
    """
    CREATE TABLE events (
        event_id INTEGER PRIMARY KEY,
        commit_sha TEXT NOT NULL,
        timeline_id TEXT NOT NULL,
        turn_number INTEGER,
        source_path TEXT NOT NULL,
        source_ordinal INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        payload_sha256 TEXT NOT NULL,
        payload_json TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE receipts (
        receipt_id TEXT PRIMARY KEY,
        commit_sha TEXT NOT NULL,
        timeline_id TEXT NOT NULL,
        turn_number INTEGER,
        receipt_type TEXT NOT NULL,
        payload_sha256 TEXT NOT NULL,
        payload_json TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE rolls (
        roll_id TEXT PRIMARY KEY,
        commit_sha TEXT NOT NULL,
        timeline_id TEXT NOT NULL,
        turn_number INTEGER,
        payload_sha256 TEXT NOT NULL,
        payload_json TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE effects (
        effect_id TEXT PRIMARY KEY,
        commit_sha TEXT NOT NULL,
        timeline_id TEXT NOT NULL,
        turn_number INTEGER,
        entity_id TEXT,
        payload_sha256 TEXT NOT NULL,
        payload_json TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE transactions (
        transaction_id TEXT PRIMARY KEY,
        commit_sha TEXT NOT NULL,
        timeline_id TEXT NOT NULL,
        turn_number INTEGER,
        payload_sha256 TEXT NOT NULL,
        payload_json TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE relations (
        commit_sha TEXT NOT NULL,
        path TEXT NOT NULL,
        pointer TEXT NOT NULL,
        from_entity_kind TEXT NOT NULL,
        from_entity_id TEXT NOT NULL,
        to_entity_kind TEXT NOT NULL,
        to_entity_id TEXT NOT NULL,
        relation_kind TEXT NOT NULL,
        PRIMARY KEY (
            commit_sha, path, pointer,
            from_entity_kind, from_entity_id,
            to_entity_kind, to_entity_id,
            relation_kind
        )
    )
    """,
    """
    CREATE TABLE memory_assertions (
        assertion_id TEXT PRIMARY KEY,
        commit_sha TEXT NOT NULL,
        timeline_id TEXT NOT NULL,
        turn_number INTEGER,
        payload_sha256 TEXT NOT NULL,
        payload_json TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE conflicts (
        conflict_id TEXT PRIMARY KEY,
        commit_sha TEXT NOT NULL,
        status TEXT NOT NULL,
        payload_sha256 TEXT NOT NULL,
        payload_json TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE projection_runs (
        run_id TEXT PRIMARY KEY,
        schema_generation TEXT NOT NULL,
        head_commit_sha TEXT NOT NULL,
        commit_count INTEGER NOT NULL,
        projection_digest TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE backlog (
        backlog_id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        commit_sha TEXT,
        payload_sha256 TEXT NOT NULL,
        payload_json TEXT NOT NULL
    )
    """,
    # Indexes: deterministic selector, diff, and newest-first event queries.
    "CREATE INDEX idx_commits_campaign_ordinal ON commits (campaign_id, ordinal)",
    "CREATE INDEX idx_commits_timeline_turn ON commits (timeline_id, turn_number)",
    "CREATE INDEX idx_commits_finalization ON commits (finalization_id)",
    "CREATE INDEX idx_timelines_timeline ON timelines (timeline_id)",
    "CREATE INDEX idx_entities_type ON entities (entity_type)",
    "CREATE INDEX idx_entities_last_commit ON entities (last_commit_sha)",
    "CREATE INDEX idx_state_snapshots_path ON state_snapshots (path)",
    "CREATE INDEX idx_state_changes_path ON state_changes (path)",
    "CREATE INDEX idx_events_timeline_turn ON events (timeline_id, turn_number)",
    "CREATE INDEX idx_events_type_timeline ON events (event_type, timeline_id)",
    "CREATE INDEX idx_events_source ON events (source_path, source_ordinal)",
    "CREATE INDEX idx_events_commit ON events (commit_sha)",
    "CREATE INDEX idx_receipts_timeline_turn ON receipts (timeline_id, turn_number)",
    "CREATE INDEX idx_receipts_commit ON receipts (commit_sha)",
    "CREATE INDEX idx_rolls_timeline_turn ON rolls (timeline_id, turn_number)",
    "CREATE INDEX idx_rolls_commit ON rolls (commit_sha)",
    "CREATE INDEX idx_effects_entity ON effects (entity_id)",
    "CREATE INDEX idx_effects_commit ON effects (commit_sha)",
    "CREATE INDEX idx_transactions_timeline_turn ON transactions (timeline_id, turn_number)",
    "CREATE INDEX idx_transactions_commit ON transactions (commit_sha)",
    # commit_sha lookups on relations are served by the primary-key prefix.
    "CREATE INDEX idx_relations_from_entity ON relations (from_entity_kind, from_entity_id)",
    "CREATE INDEX idx_relations_to_entity ON relations (to_entity_kind, to_entity_id)",
    "CREATE INDEX idx_memory_assertions_commit ON memory_assertions (commit_sha)",
    "CREATE INDEX idx_conflicts_commit ON conflicts (commit_sha)",
    "CREATE INDEX idx_conflicts_status ON conflicts (status)",
    "CREATE INDEX idx_projection_runs_head ON projection_runs (head_commit_sha)",
    "CREATE INDEX idx_backlog_kind ON backlog (kind)",
    "CREATE INDEX idx_backlog_commit ON backlog (commit_sha)",
)

# Every index the DDL creates, in DDL order. Publication validation requires
# all of them: a temp database missing any index is malformed and must never
# replace the live cache.
PROJECTION_INDEXES: tuple[str, ...] = (
    "idx_commits_campaign_ordinal",
    "idx_commits_timeline_turn",
    "idx_commits_finalization",
    "idx_timelines_timeline",
    "idx_entities_type",
    "idx_entities_last_commit",
    "idx_state_snapshots_path",
    "idx_state_changes_path",
    "idx_events_timeline_turn",
    "idx_events_type_timeline",
    "idx_events_source",
    "idx_events_commit",
    "idx_receipts_timeline_turn",
    "idx_receipts_commit",
    "idx_rolls_timeline_turn",
    "idx_rolls_commit",
    "idx_effects_entity",
    "idx_effects_commit",
    "idx_transactions_timeline_turn",
    "idx_transactions_commit",
    "idx_relations_from_entity",
    "idx_relations_to_entity",
    "idx_memory_assertions_commit",
    "idx_conflicts_commit",
    "idx_conflicts_status",
    "idx_projection_runs_head",
    "idx_backlog_kind",
    "idx_backlog_commit",
)


class HistoryProjectionError(Exception):
    """A history-projection schema/lifecycle operation failed."""


def canonical_json(value: Any) -> str:
    """Canonical storage encoding: sorted keys, no whitespace, no NaN."""
    return json.dumps(
        value,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        allow_nan=False,
    )


def canonical_json_digest(value: Any) -> str:
    """SHA-256 of the canonical JSON encoding of ``value``."""
    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


def parse_canonical_json(text: str) -> Any:
    """Decode stored canonical JSON; corruption is a projection error."""
    try:
        return json.loads(text)
    except (TypeError, json.JSONDecodeError) as exc:
        raise HistoryProjectionError(
            f"stored projection JSON is corrupt: {exc}"
        ) from exc


def _coc_root(root: Path | str) -> Path:
    root_path = Path(root)
    if root_path.name == ".coc":
        return root_path
    return root_path / ".coc"


def _require_campaign_id(campaign_id: str) -> str:
    if not isinstance(campaign_id, str) or _SAFE_ID.fullmatch(campaign_id) is None:
        raise HistoryProjectionError(
            f"campaign_id must be a stable safe id: {campaign_id!r}"
        )
    return campaign_id


def _require_under(parent: Path, child: Path, *, label: str) -> Path:
    try:
        resolved = child.resolve(strict=False)
        resolved.relative_to(parent.resolve(strict=False))
    except (OSError, ValueError) as exc:
        raise HistoryProjectionError(f"{label} path is unsafe") from exc
    if child.is_symlink():
        raise HistoryProjectionError(f"{label} path is unsafe")
    return resolved


def projection_path(root: Path | str, campaign_id: str) -> Path:
    """Absolute path of the campaign's projection cache database.

    The database always lives at
    ``<root>/.coc/campaigns/<id>/memory/history-projection.db``; a campaign id
    or memory path that would escape the campaign directory is rejected.
    """
    campaign_id = _require_campaign_id(campaign_id)
    campaigns = _coc_root(Path(root)) / "campaigns"
    campaign_dir = _require_under(campaigns, campaigns / campaign_id, label="campaign")
    db_path = campaign_dir / MEMORY_DIR_NAME / PROJECTION_DB_NAME
    return _require_under(campaign_dir, db_path, label="projection database")


def create_projection_db(path: Path | str) -> sqlite3.Connection:
    """Create a fresh projection database with the complete schema.

    An existing empty file is accepted as fresh (the atomic helper reserves a
    unique temp name as an empty file); any non-empty existing file is an
    error. The caller owns closing the returned connection.
    """
    db_path = Path(path)
    try:
        if db_path.exists() and db_path.stat().st_size != 0:
            raise HistoryProjectionError(
                f"projection database already exists: {db_path}"
            )
        db_path.parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(db_path)
    except OSError as exc:
        raise HistoryProjectionError(
            f"cannot create projection database: {db_path} ({exc})"
        ) from exc
    try:
        connection.execute("PRAGMA journal_mode = DELETE")
        with connection:
            for statement in _DDL_STATEMENTS:
                connection.execute(statement)
        connection.execute(f"PRAGMA user_version = {PROJECTION_USER_VERSION}")
        connection.commit()
    except sqlite3.Error as exc:
        connection.close()
        try:
            db_path.unlink()
        except OSError:
            pass
        raise HistoryProjectionError(
            f"failed to initialize projection database: {db_path} ({exc})"
        ) from exc
    connection.row_factory = sqlite3.Row
    return connection


def _verify_schema(connection: sqlite3.Connection) -> None:
    try:
        row = connection.execute("PRAGMA user_version").fetchone()
        user_version = int(row[0]) if row else None
        if user_version != PROJECTION_USER_VERSION:
            raise HistoryProjectionError(
                "projection schema generation mismatch: user_version="
                f"{user_version!r}, expected {PROJECTION_USER_VERSION!r} "
                f"({SCHEMA_GENERATION}); rebuild the projection"
            )
        present = {
            str(name_row[0])
            for name_row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            )
        }
        missing = [name for name in PROJECTION_TABLES if name not in present]
        if missing:
            raise HistoryProjectionError(
                "projection database is missing tables: " + ", ".join(missing)
            )
    except sqlite3.Error as exc:
        raise HistoryProjectionError(
            f"projection database is unreadable or corrupt: {exc}"
        ) from exc


def open_projection_db(
    root: Path | str,
    campaign_id: str,
    *,
    require_exists: bool = True,
) -> sqlite3.Connection:
    """Open the campaign's projection database.

    ``require_exists=True`` (the default) fails closed on a missing database.
    With ``require_exists=False`` a missing database is created fresh. A file
    that is not a readable projection of the current schema generation is a
    hard error: the cache is rebuilt, never migrated.
    """
    db_path = projection_path(root, campaign_id)
    if not db_path.exists():
        if require_exists:
            raise HistoryProjectionError(
                f"projection database is missing: {db_path}"
            )
        return create_projection_db(db_path)
    if not db_path.is_file():
        raise HistoryProjectionError(
            f"projection database is not a regular file: {db_path}"
        )
    try:
        connection = sqlite3.connect(db_path)
    except sqlite3.Error as exc:
        raise HistoryProjectionError(
            f"cannot open projection database: {db_path} ({exc})"
        ) from exc
    try:
        _verify_schema(connection)
    except BaseException:
        connection.close()
        raise
    connection.row_factory = sqlite3.Row
    return connection


def _discard(path: Path) -> None:
    try:
        path.unlink()
    except OSError:
        pass


def _sync_directory(directory: Path) -> None:
    """Best-effort fsync so a published rename survives a crash."""
    try:
        fd = os.open(directory, os.O_RDONLY)
    except OSError:
        return
    try:
        os.fsync(fd)
    except OSError:
        pass
    finally:
        os.close(fd)


def _validate_publishable(temp_path: Path) -> None:
    """Fail closed unless ``temp_path`` is an intact current-generation DB.

    A malformed, empty, truncated, stale-generation, or index-incomplete
    temp database must never replace a good live cache: check existence and
    size, then open it and verify schema generation (``user_version``), every
    required table, every required index, and SQLite integrity. Any failure
    raises :class:`HistoryProjectionError`; the caller discards the temp.
    """
    try:
        if not temp_path.is_file():
            raise HistoryProjectionError(
                f"projection temp database was never built: {temp_path}"
            )
        if temp_path.stat().st_size == 0:
            raise HistoryProjectionError(
                f"projection temp database is empty: {temp_path}"
            )
    except OSError as exc:
        raise HistoryProjectionError(
            f"cannot inspect projection temp database: {temp_path} ({exc})"
        ) from exc
    try:
        connection = sqlite3.connect(temp_path)
    except sqlite3.Error as exc:
        raise HistoryProjectionError(
            f"projection temp database is unreadable: {temp_path} ({exc})"
        ) from exc
    try:
        _verify_schema(connection)
        present = {
            str(name_row[0])
            for name_row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'index'"
            )
        }
        missing = [name for name in PROJECTION_INDEXES if name not in present]
        if missing:
            raise HistoryProjectionError(
                "projection temp database is missing indexes: "
                + ", ".join(missing)
            )
        integrity = [
            str(row[0])
            for row in connection.execute("PRAGMA integrity_check")
        ]
        if integrity != ["ok"]:
            raise HistoryProjectionError(
                "projection temp database failed integrity check: "
                + "; ".join(integrity[:4])
            )
    except sqlite3.Error as exc:
        raise HistoryProjectionError(
            f"projection temp database is unreadable or corrupt: "
            f"{temp_path} ({exc})"
        ) from exc
    finally:
        connection.close()


@contextlib.contextmanager
def atomic_projection_target(
    root: Path | str, campaign_id: str
) -> Iterator[Path]:
    """Reserve a temp path, then atomically publish it over the cache.

    Build the new database at the yielded path (``create_projection_db``
    accepts the reserved empty file), close every connection to it, and exit
    the block normally: the temp database is first validated (schema
    generation, required tables and indexes, SQLite integrity), and only then
    replaces the projection database in a single rename, so readers never
    observe a partial or malformed database. On any exception — including a
    failed validation — the temp file is removed and the live cache is
    untouched.
    """
    db_path = projection_path(root, campaign_id)
    try:
        db_path.parent.mkdir(parents=True, exist_ok=True)
        handle, temp_name = tempfile.mkstemp(
            dir=db_path.parent, prefix=".history-projection-", suffix=".tmp"
        )
    except OSError as exc:
        raise HistoryProjectionError(
            f"cannot reserve projection temp file under {db_path.parent} ({exc})"
        ) from exc
    os.close(handle)
    temp_path = Path(temp_name)
    try:
        yield temp_path
    except BaseException:
        _discard(temp_path)
        raise
    try:
        _validate_publishable(temp_path)
    except BaseException:
        _discard(temp_path)
        raise
    try:
        os.replace(temp_path, db_path)
    except OSError as exc:
        _discard(temp_path)
        raise HistoryProjectionError(
            f"cannot publish projection database at {db_path} ({exc})"
        ) from exc
    _sync_directory(db_path.parent)


def _row_record(columns: list[str], row: tuple[Any, ...]) -> dict[str, Any]:
    record: dict[str, Any] = {}
    for name, value in zip(columns, tuple(row)):
        record[name] = f"hex:{value.hex()}" if isinstance(value, bytes) else value
    return {"columns": columns, "row": record}


def projection_digest(connection: sqlite3.Connection) -> str:
    """Deterministic SHA-256 digest of the projection's content.

    Hashes the schema generation plus every row of every projection table,
    each row encoded as canonical JSON and rows sorted, so the digest depends
    only on logical content — never on insertion order, rowids, wall clock, or
    file metadata.
    """
    hasher = hashlib.sha256()
    hasher.update(f"schema-generation:{SCHEMA_GENERATION}\n".encode("utf-8"))
    for table in PROJECTION_TABLES:
        try:
            cursor = connection.execute(f'SELECT * FROM "{table}"')
            columns = [str(desc[0]) for desc in cursor.description or ()]
            rows = cursor.fetchall()
        except sqlite3.Error as exc:
            raise HistoryProjectionError(
                f"cannot digest projection table {table} ({exc})"
            ) from exc
        lines = sorted(canonical_json(_row_record(columns, row)) for row in rows)
        hasher.update(f"table:{table}:{len(lines)}\n".encode("utf-8"))
        for line in lines:
            hasher.update(line.encode("utf-8"))
            hasher.update(b"\n")
    return hasher.hexdigest()
