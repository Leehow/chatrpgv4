"""History projection SQLite schema/lifecycle (rebuildable cache)."""
from __future__ import annotations

import importlib.util
import sqlite3
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
SCRIPTS = REPO / "plugins" / "coc-keeper" / "scripts"


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


schema = load_module(
    "coc_history_projection_schema", SCRIPTS / "coc_history_projection_schema.py"
)

CAMPAIGN_ID = "hist-proj-camp"

EXPECTED_INDEXES = {
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
}

WALL_CLOCK_COLUMNS = {"ts", "time", "created_at", "updated_at", "timestamp"}


def _workspace(tmp_path: Path) -> Path:
    root = tmp_path / "workspace"
    (root / ".coc" / "campaigns" / CAMPAIGN_ID).mkdir(parents=True)
    return root


def _insert_commit(
    connection: sqlite3.Connection,
    sha: str,
    *,
    ordinal: int,
    turn_number: int | None = None,
    commit_type: str = "turn",
) -> None:
    connection.execute(
        "INSERT INTO commits (sha, campaign_id, timeline_id, ordinal,"
        " turn_number, finalization_id, commit_type, parents_json,"
        " tree_digest, files_json) VALUES (?,?,?,?,?,?,?,?,?,?)",
        (
            sha,
            CAMPAIGN_ID,
            "tl-main",
            ordinal,
            turn_number,
            None,
            commit_type,
            schema.canonical_json([]),
            f"tree-{sha}",
            schema.canonical_json([]),
        ),
    )
    connection.commit()


def _temp_leftovers(memory_dir: Path) -> list[Path]:
    return sorted(memory_dir.glob(".history-projection-*.tmp"))


# --- path safety ---------------------------------------------------------


def test_projection_path_resolves_inside_campaign_memory(tmp_path):
    root = _workspace(tmp_path)
    path = schema.projection_path(root, CAMPAIGN_ID)
    expected = (
        root / ".coc" / "campaigns" / CAMPAIGN_ID / "memory" / "history-projection.db"
    ).resolve()
    assert path == expected
    assert path.is_absolute()


def test_projection_path_accepts_coc_root_directly(tmp_path):
    root = _workspace(tmp_path)
    assert (
        schema.projection_path(root / ".coc", CAMPAIGN_ID)
        == schema.projection_path(root, CAMPAIGN_ID)
    )


@pytest.mark.parametrize(
    "campaign_id",
    [None, "", "../evil", "a/b", "a\\b", ".hidden", "sp ace", 123, "x" * 129, "sha\tinjected"],
)
def test_projection_path_rejects_unsafe_campaign_ids(tmp_path, campaign_id):
    root = _workspace(tmp_path)
    with pytest.raises(schema.HistoryProjectionError):
        schema.projection_path(root, campaign_id)


def test_projection_path_rejects_memory_dir_escaping_campaign(tmp_path):
    root = _workspace(tmp_path)
    campaign = root / ".coc" / "campaigns" / CAMPAIGN_ID
    outside = tmp_path / "outside-memory"
    outside.mkdir()
    (campaign / "memory").symlink_to(outside)
    with pytest.raises(schema.HistoryProjectionError, match="unsafe"):
        schema.projection_path(root, CAMPAIGN_ID)


def test_projection_path_rejects_symlinked_db_file(tmp_path):
    root = _workspace(tmp_path)
    campaign = root / ".coc" / "campaigns" / CAMPAIGN_ID
    (campaign / "memory").mkdir()
    (campaign / "memory" / "history-projection.db").symlink_to(tmp_path / "elsewhere.db")
    with pytest.raises(schema.HistoryProjectionError, match="unsafe"):
        schema.projection_path(root, CAMPAIGN_ID)


# --- DDL: tables, indexes, storage discipline -----------------------------


def test_create_projection_db_builds_every_table_and_index(tmp_path):
    target = tmp_path / "memory" / "history-projection.db"
    connection = schema.create_projection_db(target)
    try:
        names = {
            str(row[0])
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            )
        }
        assert set(schema.PROJECTION_TABLES) <= names
        indexes = {
            str(row[0])
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'index'"
                " AND name LIKE 'idx\\_%' ESCAPE '\\'"
            )
        }
        assert EXPECTED_INDEXES <= indexes
        user_version = connection.execute("PRAGMA user_version").fetchone()[0]
        assert user_version == schema.PROJECTION_USER_VERSION
        journal = connection.execute("PRAGMA journal_mode").fetchone()[0]
        assert str(journal).lower() == "delete"
    finally:
        connection.close()


def test_projection_indexes_constant_is_exactly_the_created_set(tmp_path):
    """PROJECTION_INDEXES is the single source publication validation uses."""
    connection = schema.create_projection_db(tmp_path / "proj.db")
    try:
        created = {
            str(row[0])
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'index'"
                " AND name LIKE 'idx\\_%' ESCAPE '\\'"
            )
        }
        assert set(schema.PROJECTION_INDEXES) == created
        assert EXPECTED_INDEXES == set(schema.PROJECTION_INDEXES)
    finally:
        connection.close()


def test_schema_has_no_wall_clock_or_float_columns(tmp_path):
    connection = schema.create_projection_db(tmp_path / "proj.db")
    try:
        for table in schema.PROJECTION_TABLES:
            for _cid, name, ctype, *_ in connection.execute(
                f'PRAGMA table_info("{table}")'
            ):
                assert str(name).lower() not in WALL_CLOCK_COLUMNS, (table, name)
                assert ctype.upper() in {"TEXT", "INTEGER"}, (table, name, ctype)
    finally:
        connection.close()


def test_create_projection_db_rejects_nonempty_existing_file(tmp_path):
    target = tmp_path / "proj.db"
    connection = schema.create_projection_db(target)
    connection.close()
    with pytest.raises(schema.HistoryProjectionError, match="already exists"):
        schema.create_projection_db(target)


def test_create_projection_db_accepts_reserved_empty_file(tmp_path):
    target = tmp_path / "proj.db"
    target.write_bytes(b"")
    connection = schema.create_projection_db(target)
    try:
        assert connection.execute("SELECT COUNT(*) FROM commits").fetchone()[0] == 0
    finally:
        connection.close()


# --- open lifecycle -------------------------------------------------------


def test_open_projection_db_requires_existing_by_default(tmp_path):
    root = _workspace(tmp_path)
    with pytest.raises(schema.HistoryProjectionError, match="missing"):
        schema.open_projection_db(root, CAMPAIGN_ID)


def test_open_projection_db_creates_when_allowed(tmp_path):
    root = _workspace(tmp_path)
    connection = schema.open_projection_db(root, CAMPAIGN_ID, require_exists=False)
    connection.close()
    reopened = schema.open_projection_db(root, CAMPAIGN_ID)
    try:
        tables = {
            str(row[0])
            for row in reopened.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            )
        }
        assert set(schema.PROJECTION_TABLES) <= tables
    finally:
        reopened.close()


def test_open_projection_db_rejects_unsafe_campaign_id(tmp_path):
    root = _workspace(tmp_path)
    with pytest.raises(schema.HistoryProjectionError):
        schema.open_projection_db(root, "../escape")


def test_open_projection_db_detects_garbage_file(tmp_path):
    root = _workspace(tmp_path)
    db_path = schema.projection_path(root, CAMPAIGN_ID)
    db_path.parent.mkdir(parents=True)
    db_path.write_bytes(b"this is definitely not a sqlite database")
    with pytest.raises(schema.HistoryProjectionError, match="corrupt"):
        schema.open_projection_db(root, CAMPAIGN_ID)


def test_open_projection_db_detects_directory_at_db_path(tmp_path):
    root = _workspace(tmp_path)
    db_path = schema.projection_path(root, CAMPAIGN_ID)
    db_path.mkdir(parents=True)
    with pytest.raises(schema.HistoryProjectionError, match="regular file"):
        schema.open_projection_db(root, CAMPAIGN_ID)


def test_open_projection_db_detects_wrong_schema_generation(tmp_path):
    root = _workspace(tmp_path)
    db_path = schema.projection_path(root, CAMPAIGN_ID)
    db_path.parent.mkdir(parents=True)
    connection = schema.create_projection_db(db_path)
    connection.close()
    stale = sqlite3.connect(db_path)
    stale.execute("PRAGMA user_version = 999")
    stale.commit()
    stale.close()
    with pytest.raises(schema.HistoryProjectionError, match="generation mismatch"):
        schema.open_projection_db(root, CAMPAIGN_ID)


def test_open_projection_db_detects_missing_tables(tmp_path):
    root = _workspace(tmp_path)
    db_path = schema.projection_path(root, CAMPAIGN_ID)
    db_path.parent.mkdir(parents=True)
    connection = schema.create_projection_db(db_path)
    connection.execute("DROP TABLE backlog")
    connection.commit()
    connection.close()
    with pytest.raises(schema.HistoryProjectionError, match="missing tables"):
        schema.open_projection_db(root, CAMPAIGN_ID)


# --- digest determinism ----------------------------------------------------


def test_projection_digest_empty_databases_agree(tmp_path):
    first = schema.create_projection_db(tmp_path / "one.db")
    second = schema.create_projection_db(tmp_path / "two.db")
    try:
        assert schema.projection_digest(first) == schema.projection_digest(second)
    finally:
        first.close()
        second.close()


def test_projection_digest_is_insertion_order_independent(tmp_path):
    first = schema.create_projection_db(tmp_path / "one.db")
    second = schema.create_projection_db(tmp_path / "two.db")
    try:
        _insert_commit(first, "sha-1", ordinal=1, turn_number=1)
        _insert_commit(first, "sha-2", ordinal=2, turn_number=2)
        _insert_commit(second, "sha-2", ordinal=2, turn_number=2)
        _insert_commit(second, "sha-1", ordinal=1, turn_number=1)
        second.execute(
            "INSERT INTO state_changes (commit_sha, path, pointer, change_json)"
            " VALUES (?,?,?,?)",
            ("sha-2", "save/world-state.json", "/era", '{"change_type":"replace","new_value_json":"1926","old_value_json":"1925"}'),
        )
        second.commit()
        first.execute(
            "INSERT INTO state_changes (commit_sha, path, pointer, change_json)"
            " VALUES (?,?,?,?)",
            ("sha-2", "save/world-state.json", "/era", '{"change_type":"replace","new_value_json":"1926","old_value_json":"1925"}'),
        )
        first.commit()
        assert schema.projection_digest(first) == schema.projection_digest(second)
    finally:
        first.close()
        second.close()


def test_projection_digest_tracks_content_changes(tmp_path):
    first = schema.create_projection_db(tmp_path / "one.db")
    second = schema.create_projection_db(tmp_path / "two.db")
    try:
        _insert_commit(first, "sha-1", ordinal=1, turn_number=1)
        _insert_commit(second, "sha-1", ordinal=1, turn_number=2)
        assert schema.projection_digest(first) != schema.projection_digest(second)
    finally:
        first.close()
        second.close()


def test_projection_digest_includes_every_table(tmp_path):
    connection = schema.create_projection_db(tmp_path / "proj.db")
    try:
        before = schema.projection_digest(connection)
        connection.execute(
            "INSERT INTO backlog (backlog_id, kind, commit_sha, payload_sha256,"
            " payload_json) VALUES (?,?,?,?,?)",
            ("backlog-1", "unattributed-event", None, "d", "{}"),
        )
        connection.commit()
        after = schema.projection_digest(connection)
        assert after != before
    finally:
        connection.close()


# --- relations schema: explicit source relations never collapse ------------


def _relation_row(pointer, *, commit_sha="sha-1", kind="first_contact"):
    return (
        commit_sha,
        "save/npc-contacts.json",
        pointer,
        "investigator",
        "inv-elda-talon",
        "npc",
        "npc-walter-corbitt",
        kind,
    )


_RELATION_COLUMNS = (
    "commit_sha, path, pointer, from_entity_kind, from_entity_id,"
    " to_entity_kind, to_entity_id, relation_kind"
)


def test_relations_table_columns_preserve_full_source_distinction(tmp_path):
    connection = schema.create_projection_db(tmp_path / "proj.db")
    try:
        columns = [
            str(row[1]) for row in connection.execute("PRAGMA table_info(relations)")
        ]
        assert columns == [
            "commit_sha",
            "path",
            "pointer",
            "from_entity_kind",
            "from_entity_id",
            "to_entity_kind",
            "to_entity_id",
            "relation_kind",
        ]
    finally:
        connection.close()


def test_relations_primary_key_retains_separate_explicit_relations(tmp_path):
    """Identical endpoints must not collapse across pointers, direction,
    kinds, commits, or relation kinds — each axis is part of the key."""
    connection = schema.create_projection_db(tmp_path / "proj.db")
    try:
        rows = [
            _relation_row("/contacts/pair-1"),
            # same endpoints + kind, different JSON pointer
            _relation_row("/contacts/pair-2"),
            # same endpoints, different source path
            (
                "sha-1",
                "save/other-contacts.json",
                "/contacts/pair-1",
                "investigator",
                "inv-elda-talon",
                "npc",
                "npc-walter-corbitt",
                "first_contact",
            ),
            # reversed direction
            (
                "sha-1",
                "save/npc-contacts.json",
                "/contacts/pair-3",
                "npc",
                "npc-walter-corbitt",
                "investigator",
                "inv-elda-talon",
                "first_contact",
            ),
            # different relation kind
            _relation_row("/contacts/pair-4", kind="bond"),
            # different endpoint kind
            (
                "sha-1",
                "save/npc-contacts.json",
                "/contacts/pair-5",
                "investigator",
                "inv-elda-talon",
                "scene",
                "scene-hallway",
                "first_contact",
            ),
            # same pointer, different commit
            _relation_row("/contacts/pair-1", commit_sha="sha-2"),
        ]
        for row in rows:
            connection.execute(
                f"INSERT INTO relations ({_RELATION_COLUMNS})"
                " VALUES (?,?,?,?,?,?,?,?)",
                row,
            )
        connection.commit()
        count = connection.execute("SELECT COUNT(*) FROM relations").fetchone()[0]
        assert count == len(rows)
        directed = connection.execute(
            "SELECT COUNT(*) FROM relations WHERE from_entity_kind = 'npc'"
        ).fetchone()[0]
        assert directed == 1  # direction preserved, not normalized away
        by_from = {
            str(row[0])
            for row in connection.execute(
                "SELECT pointer FROM relations"
                " WHERE from_entity_kind = 'investigator' AND from_entity_id = 'inv-elda-talon'"
            )
        }
        assert "/contacts/pair-3" not in by_from  # reversed row not returned
    finally:
        connection.close()


def test_relations_duplicate_full_key_rejected(tmp_path):
    connection = schema.create_projection_db(tmp_path / "proj.db")
    try:
        connection.execute(
            f"INSERT INTO relations ({_RELATION_COLUMNS}) VALUES (?,?,?,?,?,?,?,?)",
            _relation_row("/contacts/pair-1"),
        )
        with pytest.raises(sqlite3.IntegrityError):
            connection.execute(
                f"INSERT INTO relations ({_RELATION_COLUMNS}) VALUES (?,?,?,?,?,?,?,?)",
                _relation_row("/contacts/pair-1"),
            )
    finally:
        connection.close()


# --- atomic publication ----------------------------------------------------


def test_atomic_projection_target_publishes_new_database(tmp_path):
    root = _workspace(tmp_path)
    # An older projection exists; the rebuild must replace it wholesale.
    old = schema.open_projection_db(root, CAMPAIGN_ID, require_exists=False)
    _insert_commit(old, "sha-old", ordinal=0, commit_type="baseline")
    old.close()

    with schema.atomic_projection_target(root, CAMPAIGN_ID) as temp_path:
        new = schema.create_projection_db(temp_path)
        _insert_commit(new, "sha-new", ordinal=1, commit_type="baseline")
        new.close()

    db_path = schema.projection_path(root, CAMPAIGN_ID)
    published = sqlite3.connect(db_path)
    try:
        shas = {row[0] for row in published.execute("SELECT sha FROM commits")}
        assert shas == {"sha-new"}
        assert published.execute("PRAGMA user_version").fetchone()[0] == (
            schema.PROJECTION_USER_VERSION
        )
    finally:
        published.close()
    assert not _temp_leftovers(db_path.parent)


def test_atomic_projection_target_failure_keeps_old_database(tmp_path):
    root = _workspace(tmp_path)
    old = schema.open_projection_db(root, CAMPAIGN_ID, require_exists=False)
    _insert_commit(old, "sha-old", ordinal=0, commit_type="baseline")
    old.close()
    db_path = schema.projection_path(root, CAMPAIGN_ID)

    with pytest.raises(RuntimeError, match="injected build failure"):
        with schema.atomic_projection_target(root, CAMPAIGN_ID) as temp_path:
            new = schema.create_projection_db(temp_path)
            _insert_commit(new, "sha-partial", ordinal=1)
            new.close()
            raise RuntimeError("injected build failure")

    survivor = sqlite3.connect(db_path)
    try:
        shas = {row[0] for row in survivor.execute("SELECT sha FROM commits")}
        assert shas == {"sha-old"}
    finally:
        survivor.close()
    assert not _temp_leftovers(db_path.parent)


def test_atomic_projection_target_creates_missing_memory_dir(tmp_path):
    root = _workspace(tmp_path)
    with schema.atomic_projection_target(root, CAMPAIGN_ID) as temp_path:
        connection = schema.create_projection_db(temp_path)
        connection.close()
    db_path = schema.projection_path(root, CAMPAIGN_ID)
    assert db_path.is_file()
    assert not _temp_leftovers(db_path.parent)


def _existing_cache(root: Path) -> Path:
    """Publish a good projection cache and return its path."""
    old = schema.open_projection_db(root, CAMPAIGN_ID, require_exists=False)
    _insert_commit(old, "sha-old", ordinal=0, commit_type="baseline")
    old.close()
    return schema.projection_path(root, CAMPAIGN_ID)


def _assert_cache_survives(db_path: Path, expected_sha: str = "sha-old") -> None:
    survivor = sqlite3.connect(db_path)
    try:
        shas = {row[0] for row in survivor.execute("SELECT sha FROM commits")}
        assert shas == {expected_sha}
        assert survivor.execute("PRAGMA user_version").fetchone()[0] == (
            schema.PROJECTION_USER_VERSION
        )
    finally:
        survivor.close()
    assert not _temp_leftovers(db_path.parent)


def test_atomic_projection_target_rejects_never_built_temp(tmp_path):
    """An empty reserved temp file must never replace a good cache."""
    root = _workspace(tmp_path)
    db_path = _existing_cache(root)
    with pytest.raises(schema.HistoryProjectionError, match="empty"):
        with schema.atomic_projection_target(root, CAMPAIGN_ID):
            pass  # facade never built a database at the temp path
    _assert_cache_survives(db_path)


def test_atomic_projection_target_rejects_garbage_temp(tmp_path):
    root = _workspace(tmp_path)
    db_path = _existing_cache(root)
    with pytest.raises(schema.HistoryProjectionError, match="corrupt"):
        with schema.atomic_projection_target(root, CAMPAIGN_ID) as temp_path:
            temp_path.write_bytes(b"definitely not a sqlite database" * 64)
    _assert_cache_survives(db_path)


def test_atomic_projection_target_rejects_wrong_generation_temp(tmp_path):
    root = _workspace(tmp_path)
    db_path = _existing_cache(root)
    with pytest.raises(schema.HistoryProjectionError, match="generation mismatch"):
        with schema.atomic_projection_target(root, CAMPAIGN_ID) as temp_path:
            connection = schema.create_projection_db(temp_path)
            connection.close()
            stale = sqlite3.connect(temp_path)
            stale.execute("PRAGMA user_version = 999")
            stale.commit()
            stale.close()
    _assert_cache_survives(db_path)


def test_atomic_projection_target_rejects_missing_table_temp(tmp_path):
    root = _workspace(tmp_path)
    db_path = _existing_cache(root)
    with pytest.raises(schema.HistoryProjectionError, match="missing tables"):
        with schema.atomic_projection_target(root, CAMPAIGN_ID) as temp_path:
            connection = schema.create_projection_db(temp_path)
            connection.execute("DROP TABLE backlog")
            connection.commit()
            connection.close()
    _assert_cache_survives(db_path)


def test_atomic_projection_target_rejects_missing_index_temp(tmp_path):
    root = _workspace(tmp_path)
    db_path = _existing_cache(root)
    with pytest.raises(schema.HistoryProjectionError, match="missing indexes"):
        with schema.atomic_projection_target(root, CAMPAIGN_ID) as temp_path:
            connection = schema.create_projection_db(temp_path)
            connection.execute("DROP INDEX idx_backlog_kind")
            connection.commit()
            connection.close()
    _assert_cache_survives(db_path)


def test_atomic_projection_target_rejects_corrupt_temp(tmp_path):
    root = _workspace(tmp_path)
    db_path = _existing_cache(root)
    with pytest.raises(schema.HistoryProjectionError, match="integrity|corrupt"):
        with schema.atomic_projection_target(root, CAMPAIGN_ID) as temp_path:
            connection = schema.create_projection_db(temp_path)
            _insert_commit(connection, "sha-new", ordinal=1, commit_type="baseline")
            for pointer in range(1, 20):
                connection.execute(
                    "INSERT INTO state_snapshots (commit_sha, path, snapshot_json,"
                    " snapshot_sha256) VALUES (?,?,?,?)",
                    (f"sha-{pointer}", f"save/f{pointer}.json", "{\"n\":1}", f"d{pointer}"),
                )
            connection.commit()
            connection.close()
            # Deterministic corruption: keep the header, destroy page bytes.
            data = bytearray(temp_path.read_bytes())
            damaged = data[:512] + bytearray(len(data) - 512)
            temp_path.write_bytes(bytes(damaged))
    _assert_cache_survives(db_path)


# --- canonical JSON storage ------------------------------------------------


def test_canonical_json_sorts_keys_and_compacts_separators():
    assert schema.canonical_json({"b": 1, "a": [2, {"z": None, "y": True}]}) == (
        '{"a":[2,{"y":true,"z":null}],"b":1}'
    )


def test_canonical_json_rejects_non_deterministic_floats():
    with pytest.raises(ValueError):
        schema.canonical_json({"bad": float("nan")})


def test_canonical_json_digest_is_stable():
    first = {"a": [1, 2], "b": "x"}
    second = {"b": "x", "a": [1, 2]}
    assert schema.canonical_json_digest(first) == schema.canonical_json_digest(second)
    assert len(schema.canonical_json_digest(first)) == 64


def test_parse_canonical_json_roundtrip_and_corruption():
    value = {"parents": ["sha-a", "sha-b"], "turn": 3}
    assert schema.parse_canonical_json(schema.canonical_json(value)) == value
    with pytest.raises(schema.HistoryProjectionError, match="corrupt"):
        schema.parse_canonical_json("{not json")
