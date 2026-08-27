"""Behavior tests for the canonical-events projection layer (plan task t5).

Covers the rebuildable SQLite projection ``memory/events-projection.db``
(generation ``coc-events-1``) built from ``logs/canonical-events.jsonl``:
full rebuild, incremental-suffix apply after successful emit with
row-equivalent deterministic contents versus rebuild, structured
``query_events`` filters (timeline, turn range, types, entity refs,
sequence order), the public-default privacy view that can never observe
secret events, corrupt/mismatched-database delete-and-rebuild healing,
zero-event behavior, and normal ``coc_toolbox`` execution of the read-only
``events.query`` operation.

The JSONL stream stays the sole canonical evidence; every assertion here is
a deterministic contract check, never prose judgment.
"""
from __future__ import annotations

import importlib.util
import json
import sqlite3
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
SCRIPTS = REPO / "plugins" / "coc-keeper" / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import coc_canonical_events as cem


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


coc_toolbox = _load("coc_toolbox_canonical_events", SCRIPTS / "coc_toolbox.py")

CAMPAIGN = "amaranthine-16"
TIMELINE = "tl-main"


@pytest.fixture(autouse=True)
def _fresh_emission_runtime():
    cem.reset_emission_runtime_state()
    yield
    cem.reset_emission_runtime_state()


@pytest.fixture()
def logs_dir(tmp_path: Path) -> Path:
    d = tmp_path / ".coc" / "campaigns" / CAMPAIGN / "logs"
    d.mkdir(parents=True)
    return d


def emit_event(
    logs_dir: Path,
    ordinal: int,
    *,
    event_type: str = "memory-written",
    timeline: str = TIMELINE,
    turn: int = 3,
    privacy: str = "public",
    data: dict | None = None,
) -> dict:
    return cem.emit(
        campaign_logs_dir=logs_dir,
        event_type=event_type,
        campaign=CAMPAIGN,
        timeline=timeline,
        turn=turn,
        slug=cem.ordinal_slug(ordinal),
        source="test.emitter",
        game_time=f"1928-03-04-turn{turn}",
        privacy=privacy,
        decision_id=f"dec-proj-{timeline}-t{turn}-{ordinal:04d}",
        data=data
        or {"_v": 1, "memory_id": f"mem-{ordinal:03d}", "memory_kind": "episode"},
    )


def db_rows(logs_dir: Path) -> list[tuple]:
    conn = sqlite3.connect(cem.events_projection_path(logs_dir))
    try:
        return conn.execute(
            "SELECT timeline, sequence, turn, event_type, privacy"
            " FROM events ORDER BY timeline, sequence"
        ).fetchall()
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Deliverable 1: schema + full rebuild
# ---------------------------------------------------------------------------


def test_emit_hook_builds_indexed_projection(logs_dir: Path) -> None:
    for n in (1, 2):
        emit_event(logs_dir, n)

    db_path = cem.events_projection_path(logs_dir)
    assert db_path.is_file()
    assert db_path.parent.name == cem.MEMORY_DIR_NAME
    conn = sqlite3.connect(db_path)
    try:
        assert int(conn.execute("PRAGMA user_version").fetchone()[0]) == (
            cem.EVENTS_PROJECTION_USER_VERSION
        )
        tables = {
            row[0]
            for row in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            )
        }
        assert set(cem._EVENTS_PROJECTION_TABLES) <= tables
        indexes = {
            row[0]
            for row in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='index'"
            )
        }
        assert set(cem._EVENTS_PROJECTION_INDEXES) <= indexes
        payload = conn.execute(
            "SELECT payload_json FROM events WHERE sequence = 1"
        ).fetchone()[0]
    finally:
        conn.close()
    # Canonical payload JSON stored verbatim in canonical encoding.
    assert json.loads(payload) == {
        "_v": 1,
        "memory_id": "mem-001",
        "memory_kind": "episode",
    }


def test_structured_entity_refs_projected_from_payload_schema(
    logs_dir: Path,
) -> None:
    emit_event(
        logs_dir,
        1,
        event_type="roll-resolved",
        data={
            "_v": 1,
            "roll_id": "roll-spot-hidden-09",
            "check": "spot-hidden",
            "actor": "elise",
            "result_level": "hard",
            "effect_refs": ["clue-brass-key-04", "hyp-cult-meeting-02"],
        },
    )
    conn = sqlite3.connect(cem.events_projection_path(logs_dir))
    try:
        refs = set(
            conn.execute(
                "SELECT role, entity_ref FROM event_entities"
            ).fetchall()
        )
    finally:
        conn.close()
    # Every declared ref/semantic-id/id-list field becomes a role/ref pair;
    # scalar/text/enum fields never do.
    assert refs == {
        ("roll_id", "roll-spot-hidden-09"),
        ("actor", "elise"),
        ("effect_refs", "clue-brass-key-04"),
        ("effect_refs", "hyp-cult-meeting-02"),
    }


def test_full_rebuild_matches_emit_hook_contents(logs_dir: Path) -> None:
    for n in range(1, 4):
        emit_event(logs_dir, n, turn=n)
    before = db_rows(logs_dir)
    digest_before = cem.events_projection_digest(
        sqlite3.connect(cem.events_projection_path(logs_dir))
    )

    rebuilt = cem.rebuild_events_projection(logs_dir)
    assert rebuilt["status"] == "rebuilt"
    assert rebuilt["schema_generation"] == cem.SCHEMA_GENERATION == "coc-events-1"
    assert rebuilt["event_count"] == 3
    assert db_rows(logs_dir) == before
    assert (
        cem.events_projection_digest(
            sqlite3.connect(cem.events_projection_path(logs_dir))
        )
        == digest_before
    )


# ---------------------------------------------------------------------------
# Deliverable 2: incremental equivalence
# ---------------------------------------------------------------------------


def test_incremental_apply_is_row_equivalent_to_rebuild(logs_dir: Path) -> None:
    emit_event(logs_dir, 1)

    conn = sqlite3.connect(cem.events_projection_path(logs_dir))
    inc_status = cem.apply_events_projection(logs_dir)
    partial_digest = cem.events_projection_digest(conn)
    conn.close()

    for n in (2, 3):
        emit_event(logs_dir, n)
    final_status = cem.apply_events_projection(logs_dir)
    conn = sqlite3.connect(cem.events_projection_path(logs_dir))
    incremental_digest = cem.events_projection_digest(conn)
    conn.close()

    assert inc_status["status"] == "unchanged"
    assert final_status["status"] == "unchanged"

    cem.rebuild_events_projection(logs_dir)
    conn = sqlite3.connect(cem.events_projection_path(logs_dir))
    rebuilt_digest = cem.events_projection_digest(conn)
    conn.close()
    assert incremental_digest == rebuilt_digest

    # Idempotence: re-applying an already-consumed stream changes nothing.
    again = cem.apply_events_projection(logs_dir)
    assert again["status"] == "unchanged"


def test_incremental_apply_consumes_foreign_suffix(logs_dir: Path) -> None:
    """A crash after persistence but before the hook heals on next apply."""
    emit_event(logs_dir, 1)
    stream = logs_dir / cem.CANONICAL_STREAM_NAME

    cem.reset_emission_runtime_state()  # process restart analogue
    late = emit_event(logs_dir, 2)
    conn = sqlite3.connect(cem.events_projection_path(logs_dir))
    consumed_after_hook = cem.apply_events_projection(logs_dir)
    conn.close()

    # Manually append a validated record without any apply afterwards.
    record = dict(late)
    record["sequence"] = 3
    record["id"] = cem.event_id_for(
        "memory-written", CAMPAIGN, TIMELINE, 3, "occ-03"
    )
    record["decision_id"] = "dec-manual-0003"
    record["data"] = {"_v": 1, "memory_id": "mem-003", "memory_kind": "hook"}
    cem.validate_event(record)
    with stream.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(record, ensure_ascii=False) + "\n")

    status = cem.apply_events_projection(logs_dir)
    assert status["status"] == "incremental"
    assert status["applied_count"] == 1
    rows = db_rows(logs_dir)
    assert len(rows) == 3
    assert all(row[1] in (1, 2, 3) for row in rows)
    assert consumed_after_hook["status"] == "unchanged"


# ---------------------------------------------------------------------------
# Deliverable 3: structured filters + sequence order + privacy
# ---------------------------------------------------------------------------


@pytest.fixture()
def populated_logs(logs_dir: Path) -> Path:
    emit_event(logs_dir, 1, turn=1)
    emit_event(logs_dir, 1, timeline="tl-fork-1", turn=2, privacy="secret")
    emit_event(
        logs_dir,
        2,
        event_type="roll-resolved",
        turn=2,
        data={
            "_v": 1,
            "roll_id": "roll-listen-01",
            "check": "listen",
            "actor": "elise",
            "result_level": "failure",
        },
    )
    emit_event(
        logs_dir,
        3,
        event_type="clue-discovered",
        turn=3,
        data={
            "_v": 1,
            "clue_id": "clue-ledger-page-12",
            "discovered_by": "elise",
            "method": "search",
        },
    )
    return logs_dir


def test_query_sequence_order_and_cross_timeline_default(
    populated_logs: Path,
) -> None:
    result = cem.query_events(populated_logs, privacy="all")
    assert result["schema_generation"] == "coc-events-1"
    keys = [(e["timeline"], e["sequence"]) for e in result["events"]]
    assert keys == sorted(keys)
    assert {e["timeline"] for e in result["events"]} == {TIMELINE, "tl-fork-1"}
    assert result["truncated"] is False


def test_query_filters_narrow_structurally(populated_logs: Path) -> None:
    all_rows = cem.query_events(populated_logs, privacy="all")["events"]

    by_timeline = cem.query_events(populated_logs, timeline="tl-fork-1", privacy="all")
    assert [e["id"] for e in by_timeline["events"]] == [
        e["id"] for e in all_rows if e["timeline"] == "tl-fork-1"
    ]

    by_range = cem.query_events(
        populated_logs, turn_from=2, turn_to=2, privacy="all"
    )
    assert [e["turn"] for e in by_range["events"]] == [2, 2]

    by_types = cem.query_events(
        populated_logs, types=["roll-resolved", "clue-discovered"], privacy="all"
    )
    assert {e["type"] for e in by_types["events"]} == {
        "roll-resolved",
        "clue-discovered",
    }

    by_entity = cem.query_events(
        populated_logs, entity_refs=["roll-listen-01"], privacy="all"
    )
    assert len(by_entity["events"]) == 1
    assert by_entity["events"][0]["data"]["check"] == "listen"

    limited = cem.query_events(populated_logs, privacy="all", limit=2)
    assert limited["count"] == 2
    assert limited["truncated"] is True


def test_query_public_view_excludes_secret_events(populated_logs: Path) -> None:
    public = cem.query_events(populated_logs)
    assert {e["privacy"] for e in public["events"]} == {"public"}
    secret_view = cem.query_events(populated_logs, privacy="secret")
    assert {e["privacy"] for e in secret_view["events"]} == {"secret"}
    everything = cem.query_events(populated_logs, privacy="all")
    assert len(everything["events"]) == len(public["events"]) + len(
        secret_view["events"]
    )
    with pytest.raises(cem.PrivacyError):
        cem.query_events(populated_logs, privacy="player_safe")


def test_query_rejects_unknown_type_and_bad_bounds(populated_logs: Path) -> None:
    with pytest.raises(cem.ClosedEnumError):
        cem.query_events(populated_logs, types=["roll-started"])
    with pytest.raises(cem.CanonicalEventsContractError):
        cem.query_events(populated_logs, turn_from=0)
    with pytest.raises(cem.CanonicalEventsContractError):
        cem.query_events(populated_logs, limit=0)


# ---------------------------------------------------------------------------
# Deliverable 2b: corrupt / mismatched database -> delete + rebuild
# ---------------------------------------------------------------------------


def test_garbage_database_is_deleted_and_rebuilt(logs_dir: Path) -> None:
    emit_event(logs_dir, 1)
    db_path = cem.events_projection_path(logs_dir)
    baseline = db_rows(logs_dir)

    db_path.write_bytes(b"this is not a sqlite database at all")
    healed = cem.apply_events_projection(logs_dir)
    assert healed["status"] == "rebuilt"
    assert db_rows(logs_dir) == baseline
    # Self-healing also happens transparently on the query path.
    assert cem.query_events(logs_dir)["count"] == 1


def test_wrong_generation_database_is_never_migrated(logs_dir: Path) -> None:
    emit_event(logs_dir, 1)
    db_path = cem.events_projection_path(logs_dir)
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA user_version = 99")
    conn.commit()
    conn.close()

    healed = cem.apply_events_projection(logs_dir)
    assert healed["status"] == "rebuilt"
    assert healed["schema_generation"] == "coc-events-1"
    conn = sqlite3.connect(db_path)
    try:
        assert int(conn.execute("PRAGMA user_version").fetchone()[0]) == (
            cem.EVENTS_PROJECTION_USER_VERSION
        )
    finally:
        conn.close()


def test_dropped_table_self_heals_through_query(logs_dir: Path) -> None:
    emit_event(logs_dir, 1)
    conn = sqlite3.connect(cem.events_projection_path(logs_dir))
    conn.execute("DROP TABLE event_entities")
    conn.commit()
    conn.close()

    result = cem.query_events(logs_dir)
    assert result["count"] == 1
    conn = sqlite3.connect(cem.events_projection_path(logs_dir))
    try:
        count = conn.execute("SELECT COUNT(*) FROM event_entities").fetchone()[0]
    finally:
        conn.close()
    assert count >= 0  # table restored by the rebuild


def test_stale_coverage_is_detected_and_rebuilt(logs_dir: Path) -> None:
    emit_event(logs_dir, 1)
    stream = logs_dir / cem.CANONICAL_STREAM_NAME

    # Rewrite the source underneath the cache (different prefix bytes).
    original = stream.read_text(encoding="utf-8")
    stream.write_text(original.replace('"1928', '"1919'), encoding="utf-8")
    healed = cem.apply_events_projection(logs_dir)
    assert healed["status"] == "rebuilt"
    assert cem.query_events(logs_dir)["count"] == 1


def test_unparseable_stream_line_fails_closed_typed(logs_dir: Path) -> None:
    emit_event(logs_dir, 1)
    stream = logs_dir / cem.CANONICAL_STREAM_NAME
    with stream.open("a", encoding="utf-8") as handle:
        handle.write("{not json at all}\n")

    with pytest.raises(cem.EventsProjectionError):
        cem.rebuild_events_projection(logs_dir)


# ---------------------------------------------------------------------------
# Zero-event behavior
# ---------------------------------------------------------------------------


def test_zero_events_publish_empty_usable_projection(tmp_path: Path) -> None:
    empty_logs = tmp_path / ".coc" / "campaigns" / "empty-camp" / "logs"
    empty_logs.mkdir(parents=True)

    result = cem.query_events(empty_logs)
    assert result["count"] == 0
    assert result["events"] == []
    assert cem.events_projection_path(empty_logs).is_file()

    rebuilt = cem.rebuild_events_projection(empty_logs)
    assert rebuilt["status"] == "rebuilt"
    assert rebuilt["event_count"] == 0
    status = cem.apply_events_projection(empty_logs)
    assert status["status"] == "unchanged"


# ---------------------------------------------------------------------------
# Deliverable 3b: canonical registry exposure (events.query)
# ---------------------------------------------------------------------------


def _run(ws_root: Path, campaign_id: str, tool: str, args: dict | None = None):
    return coc_toolbox.run_tool(tool, ws_root, campaign_id, args or {})


def test_registry_exposes_strict_read_only_events_query(
    populated_logs: Path,
) -> None:
    spec = coc_toolbox.TOOLS["events.query"]
    assert spec["access"] == "query"
    assert spec.get("strict_read_only") is True
    policy = coc_toolbox.operation_policy("events.query")
    assert policy["kp_surface"] == "context"
    assert "live_turn" in policy["phases"]

    ws_root = populated_logs.parents[3]
    result = _run(ws_root, CAMPAIGN, "events.query", {})
    assert result["ok"] is True
    assert result["tool"] == "events.query"
    assert result["data"]["authority"] == "derived_evidence"
    assert result["data"]["privacy_view"] == "public"
    assert {e["privacy"] for e in result["data"]["events"]} == {"public"}
    assert any("state.*/rules.* remain authoritative" in h for h in result["hints"])


def test_events_query_envelope_maps_contract_errors(populated_logs: Path) -> None:
    ws_root = populated_logs.parents[3]
    bad_privacy = _run(ws_root, CAMPAIGN, "events.query", {"privacy": "everyone"})
    assert bad_privacy["ok"] is False
    assert bad_privacy["error"]["code"] == "invalid_param"

    bad_type = _run(ws_root, CAMPAIGN, "events.query", {"types": ["roll-started"]})
    assert bad_type["ok"] is False
    assert bad_type["error"]["code"] == "invalid_param"

    filtered = _run(
        ws_root,
        CAMPAIGN,
        "events.query",
        {
            "timeline": TIMELINE,
            "turn_from": 2,
            "types": ["roll-resolved"],
            "entity_refs": ["roll-listen-01"],
        },
    )
    assert filtered["ok"] is True
    assert [e["type"] for e in filtered["data"]["events"]] == ["roll-resolved"]
