"""Tests for the pure history-projection JSONL event extractor.

Covers the insertion-ready row contract: every emitted row carries exactly
its ``coc_history_projection_schema`` table's columns and inserts directly
into a real projection database with no field translation.
"""
import hashlib
import importlib.util
import json


def _load(name, rel):
    spec = importlib.util.spec_from_file_location(name, rel)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


events_mod = _load(
    "coc_history_projection_events",
    "plugins/coc-keeper/scripts/coc_history_projection_events.py",
)
schema_mod = _load(
    "coc_history_projection_schema",
    "plugins/coc-keeper/scripts/coc_history_projection_schema.py",
)

# Exact schema column sets — insertion-ready rows carry these and only these.
EVENT_COLUMNS = {
    "event_id", "commit_sha", "timeline_id", "turn_number",
    "source_path", "source_ordinal", "event_type",
    "payload_sha256", "payload_json",
}
RECEIPT_COLUMNS = {
    "receipt_id", "commit_sha", "timeline_id", "turn_number",
    "receipt_type", "payload_sha256", "payload_json",
}
ROLL_COLUMNS = {
    "roll_id", "commit_sha", "timeline_id", "turn_number",
    "payload_sha256", "payload_json",
}
EFFECT_COLUMNS = {
    "effect_id", "commit_sha", "timeline_id", "turn_number",
    "entity_id", "payload_sha256", "payload_json",
}
TRANSACTION_COLUMNS = {
    "transaction_id", "commit_sha", "timeline_id", "turn_number",
    "payload_sha256", "payload_json",
}
BACKLOG_COLUMNS = {
    "backlog_id", "kind", "commit_sha", "payload_sha256", "payload_json",
}


def _commit(files, sha="abc123", **overrides):
    record = {
        "sha": sha,
        "campaign_id": "amaranthine-16",
        "timeline_id": "tl-main",
        "turn_number": 3,
        "finalization_id": "finalize-turn-3",
        "commit_type": "turn",
        "parents": ["parent000"],
        "tree_digest": "tree000",
        "files": [
            {"path": path, "blob_sha": f"blob-{index}", "text": text}
            for index, (path, text) in enumerate(files)
        ],
    }
    record.update(overrides)
    return record


def _jsonl(*rows):
    return "".join(
        json.dumps(row, ensure_ascii=False) + "\n" for row in rows
    )


def _insert(conn, table, rows, *, or_ignore=False):
    guard = "OR IGNORE" if or_ignore else ""
    for row in rows:
        columns = ", ".join(row.keys())
        marks = ", ".join(f":{key}" for key in row)
        conn.execute(
            f"INSERT {guard} INTO {table} ({columns}) VALUES ({marks})", row
        )


def _open_projection(tmp_path, results):
    """Insert every row of every extraction result into a real schema DB."""
    db_path = tmp_path / "history-projection.db"
    conn = schema_mod.create_projection_db(db_path)
    try:
        with conn:
            for result in results:
                _insert(conn, "events", result["events"])
                _insert(conn, "receipts", result["receipts"], or_ignore=True)
                _insert(conn, "rolls", result["rolls"], or_ignore=True)
                _insert(conn, "effects", result["effects"], or_ignore=True)
                _insert(
                    conn, "transactions", result["transactions"], or_ignore=True
                )
                _insert(conn, "backlog", result["backlog"], or_ignore=True)
    except BaseException:
        conn.close()
        raise
    return conn


def test_extract_classifies_each_row_kind_with_schema_columns():
    roll = {
        "roll_id": "toolbox-amaranthine-16-000042",
        "event_type": "roll",
        "type": "roll",
        "actor": "inv:marlowe",
        "visibility": "public",
        "skill": "图书馆使用",
        "payload": {"roll_id": "toolbox-amaranthine-16-000042", "roll": 42},
    }
    receipt = {
        "finalization_id": "finalize-turn-3",
        "journal_decision_id": "dec-turn-3",
        "rendered_text_sha256": "deadbeef",
    }
    effect = {
        "event_type": "effect_applied",
        "effect_id": "effect-broken-arm-marlowe",
        "roll_id": "toolbox-amaranthine-16-000042",
        "investigator_id": "inv:marlowe",
    }
    transaction = {
        "event_type": "transaction",
        "transaction_id": "txn-development-marlowe-1",
        "decision_id": "dec-turn-3",
    }
    story = {
        "event_type": "scene_enter",
        "decision_id": "dec-turn-3",
        "to_scene": "scene-library-reading-room",
        "investigator_id": "inv:marlowe",
        "ts": "2026-01-01T00:00:00Z",
    }
    assertion = {
        "assertion_id": "mem-amaranthine-16-marlowe-fears-cellars",
        "kind": "belief",
        "privacy": "player_safe",
        "timeline_id": "tl-main",
        "source_turn": 2,
    }
    result = events_mod.extract_events(_commit([
        ("logs/rolls.jsonl", _jsonl(roll)),
        ("logs/turn-finalizations.jsonl", _jsonl(receipt)),
        ("logs/effects.jsonl", _jsonl(effect)),
        ("logs/transactions.jsonl", _jsonl(transaction)),
        ("logs/events.jsonl", _jsonl(story)),
        ("memory/temporal/assertions.jsonl", _jsonl(assertion)),
    ]))

    assert len(result["rolls"]) == 1
    assert len(result["receipts"]) == 1
    assert len(result["effects"]) == 1
    assert len(result["transactions"]) == 1
    assert sorted(row["source_path"] for row in result["events"]) == [
        "logs/events.jsonl", "memory/temporal/assertions.jsonl",
    ]
    assert result["backlog"] == []

    # Every row carries exactly its schema table's columns.
    assert set(result["rolls"][0]) == ROLL_COLUMNS
    assert set(result["receipts"][0]) == RECEIPT_COLUMNS
    assert set(result["effects"][0]) == EFFECT_COLUMNS
    assert set(result["transactions"][0]) == TRANSACTION_COLUMNS
    for row in result["events"]:
        assert set(row) == EVENT_COLUMNS

    roll_row = result["rolls"][0]
    assert roll_row["roll_id"] == "toolbox-amaranthine-16-000042"
    assert roll_row["commit_sha"] == "abc123"
    assert roll_row["timeline_id"] == "tl-main"
    assert roll_row["turn_number"] == 3
    # Numeric truth lives in the verbatim canonical payload only.
    assert json.loads(roll_row["payload_json"]) == roll
    expected = hashlib.sha256(
        json.dumps(roll, sort_keys=True, separators=(",", ":"),
                   ensure_ascii=False, allow_nan=False).encode("utf-8")
    ).hexdigest()
    assert roll_row["payload_sha256"] == expected

    receipt_row = result["receipts"][0]
    assert receipt_row["receipt_id"] == "finalize-turn-3"
    assert receipt_row["receipt_type"] == "receipt"

    effect_row = result["effects"][0]
    assert effect_row["effect_id"] == "effect-broken-arm-marlowe"
    assert effect_row["entity_id"] == "inv:marlowe"

    txn_row = result["transactions"][0]
    assert txn_row["transaction_id"] == "txn-development-marlowe-1"

    story_row = next(
        row for row in result["events"]
        if row["source_path"] == "logs/events.jsonl"
    )
    assert story_row["event_type"] == "scene_enter"
    assert story_row["event_id"] is None

    # Assertions from the temporal face stay generic events with their
    # identity preserved verbatim inside the payload.
    assertion_row = next(
        row for row in result["events"]
        if row["source_path"] == "memory/temporal/assertions.jsonl"
    )
    assert json.loads(assertion_row["payload_json"])["assertion_id"] == (
        "mem-amaranthine-16-marlowe-fears-cellars"
    )


def test_rows_insert_directly_into_schema_database(tmp_path):
    roll = {"roll_id": "roll-ins-1", "event_type": "roll"}
    receipt = {
        "finalization_id": "finalize-ins",
        "receipt_type": "turn_finalization",
    }
    effect = {
        "effect_id": "effect-ins", "roll_id": "roll-ins-1",
        "npc_id": "npc-housekeeper",
    }
    transaction = {"transaction_id": "txn-ins", "decision_id": "dec-ins"}
    event = {"event_type": "scene_enter", "investigator_id": "inv:marlowe"}
    text = (
        _jsonl(event)
        + "{not valid json\n"
        + _jsonl({"event_type": "second"})
    )
    result = events_mod.extract_events(_commit([
        ("logs/rolls.jsonl", _jsonl(roll)),
        ("logs/turn-finalizations.jsonl", _jsonl(receipt)),
        ("logs/effects.jsonl", _jsonl(effect)),
        ("logs/transactions.jsonl", _jsonl(transaction)),
        ("logs/events.jsonl", text),
    ]))

    conn = _open_projection(tmp_path, [result])
    try:
        assert conn.execute("SELECT count(*) FROM rolls").fetchone()[0] == 1
        assert conn.execute("SELECT count(*) FROM receipts").fetchone()[0] == 1
        assert conn.execute("SELECT count(*) FROM effects").fetchone()[0] == 1
        assert (
            conn.execute("SELECT count(*) FROM transactions").fetchone()[0] == 1
        )
        assert conn.execute("SELECT count(*) FROM events").fetchone()[0] == 2
        assert conn.execute("SELECT count(*) FROM backlog").fetchone()[0] == 1

        # INTEGER primary keys are assigned in deterministic list order
        # (source_path, source_ordinal).
        event_ids = [
            row[0] for row in
            conn.execute(
                "SELECT event_id FROM events ORDER BY event_id"
            )
        ]
        assert event_ids == [1, 2]
        stored = conn.execute(
            "SELECT source_path, source_ordinal, event_type, payload_json"
            " FROM events WHERE event_id = 1"
        ).fetchone()
        assert stored[0] == "logs/events.jsonl"
        assert stored[1] == 1
        assert stored[2] == "scene_enter"
        assert json.loads(stored[3]) == event

        effect_row = conn.execute(
            "SELECT entity_id FROM effects WHERE effect_id = 'effect-ins'"
        ).fetchone()
        assert effect_row[0] == "npc-housekeeper"

        receipt_row = conn.execute(
            "SELECT receipt_type FROM receipts"
            " WHERE receipt_id = 'finalize-ins'"
        ).fetchone()
        assert receipt_row[0] == "turn_finalization"

        backlog_row = conn.execute(
            "SELECT kind, payload_json FROM backlog"
        ).fetchone()
        assert backlog_row[0] == "invalid_json"
        payload = json.loads(backlog_row[1])
        assert payload["raw_line"] == "{not valid json"
        assert payload["source_path"] == "logs/events.jsonl"
        assert payload["source_ordinal"] == 2
        assert payload["timeline_id"] == "tl-main"
        assert payload["turn_number"] == 3
    finally:
        conn.close()


def test_commit_provenance_is_authoritative_over_payload():
    # A payload claiming another worldline/turn never relocates the row;
    # the conflicting values survive only inside payload_json.
    conflicting = {
        "event_type": "journal",
        "timeline_id": "tl-fork-a",
        "turn_number": 7,
        "decision_id": "dec-x",
    }
    result = events_mod.extract_events(
        _commit([("logs/events.jsonl", _jsonl(conflicting))])
    )
    row = result["events"][0]
    assert row["timeline_id"] == "tl-main"
    assert row["turn_number"] == 3
    assert row["commit_sha"] == "abc123"
    payload = json.loads(row["payload_json"])
    assert payload["timeline_id"] == "tl-fork-a"
    assert payload["turn_number"] == 7

    # The same holds for classified rows and for malformed-string turns.
    roll = {
        "roll_id": "roll-turn", "event_type": "roll",
        "timeline_id": "tl-evil", "turn_number": "soon",
    }
    roll_result = events_mod.extract_events(
        _commit([("logs/rolls.jsonl", _jsonl(roll))])
    )
    roll_row = roll_result["rolls"][0]
    assert roll_row["timeline_id"] == "tl-main"
    assert roll_row["turn_number"] == 3
    assert json.loads(roll_row["payload_json"])["turn_number"] == "soon"

    # A receipt never inherits the commit's finalization as its identity:
    # identity comes from the payload or from the source-row fallback.
    marker_receipt = {"event_type": "receipt", "note": "marker only"}
    receipt_result = events_mod.extract_events(
        _commit([("logs/receipts.jsonl", _jsonl(marker_receipt))])
    )
    receipt_row = receipt_result["receipts"][0]
    assert receipt_row["receipt_id"] == (
        "hist-receipt:abc123:logs/receipts.jsonl:1"
    )
    assert receipt_row["receipt_type"] == "receipt"


def test_source_row_ids_include_commit_identity():
    text = "{broken"
    base = {"event_type": "markerless"}
    first = events_mod.extract_events(
        _commit([("logs/events.jsonl", text)], sha="commit-a")
    )
    second = events_mod.extract_events(
        _commit([("logs/events.jsonl", text)], sha="commit-b")
    )
    # Same timeline/path/ordinal in two commits (e.g. two branches): the
    # backlog ids stay distinct because commit identity is part of the id.
    assert first["backlog"][0]["backlog_id"] == (
        "hist-backlog:commit-a:logs/events.jsonl:1"
    )
    assert second["backlog"][0]["backlog_id"] == (
        "hist-backlog:commit-b:logs/events.jsonl:1"
    )
    assert (
        first["backlog"][0]["backlog_id"]
        != second["backlog"][0]["backlog_id"]
    )

    # Identity-less classified rows get commit-inclusive fallback ids too.
    marker_roll = {"event_type": "roll"}
    roll_a = events_mod.extract_events(
        _commit([("logs/rolls.jsonl", _jsonl(marker_roll))], sha="commit-a")
    )
    roll_b = events_mod.extract_events(
        _commit([("logs/rolls.jsonl", _jsonl(marker_roll))], sha="commit-b")
    )
    assert roll_a["rolls"][0]["roll_id"] == (
        "hist-roll:commit-a:logs/rolls.jsonl:1"
    )
    assert roll_b["rolls"][0]["roll_id"] == (
        "hist-roll:commit-b:logs/rolls.jsonl:1"
    )

    # Distinct payloads in the same commit keep distinct ordinals.
    two = events_mod.extract_events(_commit([
        ("logs/events.jsonl", _jsonl(base) + "\n" + _jsonl(base)),
    ]))
    assert [row["source_ordinal"] for row in two["events"]] == [1, 3]

    # Re-extraction of the same commit is byte-stable.
    again = events_mod.extract_events(
        _commit([("logs/events.jsonl", text)], sha="commit-a")
    )
    assert again == first


def test_cross_commit_canonical_replay_first_occurrence_wins(tmp_path):
    # Append-only logs replay the same canonical roll in later commits.
    roll = {"roll_id": "roll-replay", "event_type": "roll"}
    early = events_mod.extract_events(
        _commit([("logs/rolls.jsonl", _jsonl(roll))], sha="commit-early")
    )
    late = events_mod.extract_events(_commit(
        [("logs/rolls.jsonl", _jsonl(roll, {"roll_id": "roll-late"}))],
        sha="commit-late",
    ))
    assert early["rolls"][0]["roll_id"] == "roll-replay"
    assert late["rolls"][0]["roll_id"] == "roll-replay"

    conn = _open_projection(tmp_path, [early, late])
    try:
        rows = conn.execute(
            "SELECT roll_id, commit_sha FROM rolls ORDER BY commit_sha"
        ).fetchall()
        assert [row[0] for row in rows] == ["roll-replay", "roll-late"]
        replay = conn.execute(
            "SELECT commit_sha FROM rolls WHERE roll_id = 'roll-replay'"
        ).fetchone()
        # First occurrence (topo order: early commit) wins.
        assert replay[0] == "commit-early"
    finally:
        conn.close()


def test_intra_commit_duplicate_canonical_id_becomes_backlog(tmp_path):
    duplicate = {"roll_id": "roll-twin", "event_type": "roll"}
    other = {"roll_id": "roll-twin", "event_type": "roll", "n": 2}
    result = events_mod.extract_events(_commit([
        ("logs/rolls.jsonl", _jsonl(duplicate, other)),
    ]))
    assert len(result["rolls"]) == 1
    assert result["rolls"][0]["roll_id"] == "roll-twin"
    assert json.loads(result["rolls"][0]["payload_json"]) == duplicate
    assert len(result["backlog"]) == 1
    backlog = result["backlog"][0]
    assert set(backlog) == BACKLOG_COLUMNS
    assert backlog["kind"] == "duplicate_canonical_id"
    assert backlog["backlog_id"] == "hist-backlog:abc123:logs/rolls.jsonl:2"
    payload = json.loads(backlog["payload_json"])
    assert payload["canonical_id"] == "roll-twin"
    assert payload["row"] == other
    assert payload["source_ordinal"] == 2

    # Canonical namespaces are per table: the same string as an effect id is
    # a different identity, not a duplicate.
    mixed = events_mod.extract_events(_commit([
        ("logs/rolls.jsonl", _jsonl({"roll_id": "shared-x"})),
        ("logs/effects.jsonl", _jsonl({"effect_id": "shared-x"})),
    ]))
    assert len(mixed["rolls"]) == 1
    assert len(mixed["effects"]) == 1
    assert mixed["backlog"] == []

    conn = _open_projection(tmp_path, [result])
    try:
        assert conn.execute("SELECT count(*) FROM rolls").fetchone()[0] == 1
        assert conn.execute("SELECT count(*) FROM backlog").fetchone()[0] == 1
    finally:
        conn.close()


def test_malformed_lines_become_insertion_ready_backlog_rows(tmp_path):
    text = (
        json.dumps({"event_type": "scene_enter"}) + "\n"
        + "{not valid json\n"
        + "\n"
        + "   \n"
        + "[1, 2, 3]\n"
        + "\"a bare string\"\n"
        + "{\"roll_id\": \"roll-nan\", \"value\": NaN}\n"
        + "{\"event_type\": \"inf\", \"value\": Infinity}\n"
    )
    result = events_mod.extract_events(_commit([("logs/events.jsonl", text)]))
    assert len(result["events"]) == 1
    backlog = result["backlog"]
    payloads = [json.loads(row["payload_json"]) for row in backlog]
    assert [p["source_ordinal"] for p in payloads] == [2, 5, 6, 7, 8]
    assert [row["kind"] for row in backlog] == [
        "invalid_json", "row_not_object", "row_not_object",
        "invalid_json", "invalid_json",
    ]
    for row in backlog:
        assert set(row) == BACKLOG_COLUMNS
        assert row["commit_sha"] == "abc123"
        payload = json.loads(row["payload_json"])
        assert payload["source_path"] == "logs/events.jsonl"
        assert payload["timeline_id"] == "tl-main"
        assert payload["turn_number"] == 3
    assert payloads[0]["raw_line"] == "{not valid json"
    # NaN/Infinity lines are backlog evidence, never stored payload data.
    assert payloads[3]["raw_line"].endswith("NaN}")

    # Blank and whitespace-only lines carry no record and produce no row.
    assert all(p["source_ordinal"] not in (3, 4) for p in payloads)

    conn = _open_projection(tmp_path, [result])
    try:
        assert conn.execute("SELECT count(*) FROM backlog").fetchone()[0] == 5
    finally:
        conn.close()

    # Re-extraction is byte-stable.
    again = events_mod.extract_events(_commit([("logs/events.jsonl", text)]))
    assert again == result


def test_privacy_fields_preserved_verbatim_without_spoofing():
    secret_roll = {
        "roll_id": "roll-hidden", "event_type": "roll",
        "visibility": "consequence_public",
    }
    keeper_event = {
        "event_type": "spoiler_reveal", "secret": True,
        "player_visible": False, "concealed": "keeper-only note",
        "timeline_id": "tl-fake", "turn_number": 99,
    }
    plain_event = {"event_type": "scene_enter"}
    result = events_mod.extract_events(_commit([
        ("logs/rolls.jsonl", _jsonl(secret_roll)),
        ("logs/audit.jsonl", _jsonl(keeper_event)),
        ("logs/events.jsonl", _jsonl(plain_event)),
    ]))
    roll_payload = json.loads(result["rolls"][0]["payload_json"])
    assert roll_payload["visibility"] == "consequence_public"
    audit_row = result["events"][0]
    audit_payload = json.loads(audit_row["payload_json"])
    assert audit_payload["secret"] is True
    assert audit_payload["player_visible"] is False
    assert audit_payload["concealed"] == "keeper-only note"
    # Privacy/provenance claims in the payload never become indexed truth:
    # no privacy column exists to spoof, and provenance stays commit-owned.
    assert audit_row["timeline_id"] == "tl-main"
    assert audit_row["turn_number"] == 3
    assert json.loads(result["events"][1]["payload_json"]) == plain_event


def test_roll_effect_transaction_linkage_via_canonical_ids():
    roll = {"roll_id": "roll-alpha", "event_type": "roll", "visibility": "public"}
    effect = {
        "event_type": "effect", "effect_id": "effect-beta",
        "roll_id": "roll-alpha", "investigator_id": "inv:marlowe",
    }
    transaction = {
        "transaction_id": "txn-gamma", "decision_id": "dec-7",
        "roll_id": "roll-alpha",
    }
    result = events_mod.extract_events(_commit([
        ("logs/effects.jsonl", _jsonl(effect)),
        ("logs/rolls.jsonl", _jsonl(roll)),
        ("logs/transactions.jsonl", _jsonl(transaction)),
    ]))

    assert result["rolls"][0]["roll_id"] == "roll-alpha"
    assert result["effects"][0]["effect_id"] == "effect-beta"
    assert result["effects"][0]["entity_id"] == "inv:marlowe"
    assert json.loads(result["effects"][0]["payload_json"])["roll_id"] == (
        "roll-alpha"
    )
    assert result["transactions"][0]["transaction_id"] == "txn-gamma"
    # The three rows stay in their own lists; linkage is by shared explicit
    # ids inside the payloads, not by collapsing rows together.
    assert result["events"] == []

    # A row carrying both an effect id and a roll id keeps its own identity
    # (effect); the causing roll reference survives in the payload.
    mixed = {"roll_id": "roll-delta", "effect_id": "effect-epsilon"}
    mixed_result = events_mod.extract_events(
        _commit([("logs/effects.jsonl", _jsonl(mixed))])
    )
    assert len(mixed_result["effects"]) == 1
    assert mixed_result["rolls"] == []
    assert mixed_result["effects"][0]["effect_id"] == "effect-epsilon"
    assert json.loads(mixed_result["effects"][0]["payload_json"])["roll_id"] == (
        "roll-delta"
    )

    # Explicit entity_id outranks investigator/npc references.
    owned = {
        "effect_id": "effect-owned", "entity_id": "entity-clock-tower",
        "investigator_id": "inv:marlowe",
    }
    owned_result = events_mod.extract_events(
        _commit([("logs/effects.jsonl", _jsonl(owned))])
    )
    assert owned_result["effects"][0]["entity_id"] == "entity-clock-tower"
    bare = {"effect_id": "effect-bare"}
    bare_result = events_mod.extract_events(
        _commit([("logs/effects.jsonl", _jsonl(bare))])
    )
    assert bare_result["effects"][0]["entity_id"] is None


def test_receipt_id_key_and_marker_classification():
    explicit = {"receipt_id": "rcpt-1", "receipt_type": "roll_receipt"}
    marker = {"event_type": "finalization"}
    result = events_mod.extract_events(_commit([
        ("logs/receipts.jsonl", _jsonl(explicit, marker)),
    ]))
    assert [row["receipt_id"] for row in result["receipts"]] == [
        "rcpt-1", "hist-receipt:abc123:logs/receipts.jsonl:2",
    ]
    assert [row["receipt_type"] for row in result["receipts"]] == [
        "roll_receipt", "finalization",
    ]


def test_no_prose_inference():
    narration = {
        "event_type": "journal",
        "text": "他掷出 D100 掷骰 roll 得到 100 大成功，触发收据 receipt 与效果 effect。",
    }
    result = events_mod.extract_events(
        _commit([("logs/events.jsonl", _jsonl(narration))])
    )
    assert len(result["events"]) == 1
    assert result["rolls"] == []
    assert result["receipts"] == []
    assert result["effects"] == []
    assert result["transactions"] == []
    assert result["events"][0]["event_type"] == "journal"


def test_untracked_and_ignored_paths_are_not_parsed():
    result = events_mod.extract_events(_commit([
        ("logs/pending-turns/events.jsonl", _jsonl({"event_type": "x"})),
        ("logs/nested/events.jsonl", _jsonl({"event_type": "x"})),
        ("logs/events.json", "{}"),
        ("logs/events.jsonl", _jsonl({"event_type": "x"})),
        ("save/roll-operation-receipts.json", "{}"),
        ("memory/index.json", "{}"),
        ("memory/history-projection.db", "sqlite bytes"),
        ("memory/temporal/assertions.jsonl", _jsonl({"assertion_id": "mem-x"})),
        ("memory/temporal/episodes/turn-3.jsonl", _jsonl({"episode_id": "ep-1"})),
        ("memory/session-summaries.jsonl", _jsonl({"event_type": "x"})),
    ]))
    assert sorted(row["source_path"] for row in result["events"]) == [
        "logs/events.jsonl",
        "memory/temporal/assertions.jsonl",
        "memory/temporal/episodes/turn-3.jsonl",
    ]
    assert result["backlog"] == []
    assert result["rolls"] == []
    assert result["receipts"] == []
    assert result["effects"] == []
    assert result["transactions"] == []


def test_stable_ordering_and_duplicate_file_entries():
    roll = {"roll_id": "roll-1", "event_type": "roll"}
    story = {"event_type": "scene_enter"}
    result = events_mod.extract_events(_commit([
        ("logs/rolls.jsonl", _jsonl(roll)),
        ("logs/events.jsonl", _jsonl(story)),
    ]))
    # Per-category populations and identities stay deterministic regardless
    # of input order; rolls rows carry no source columns (schema), so check
    # identity rather than source_path.
    assert [row["source_path"] for row in result["events"]] == [
        "logs/events.jsonl"
    ]
    assert [row["roll_id"] for row in result["rolls"]] == ["roll-1"]

    # Duplicate path entries are resolved deterministically: the lexically
    # smaller blob_sha wins and the other text is never mixed in.
    dup = events_mod.extract_events({
        "sha": "abc123", "campaign_id": "amaranthine-16",
        "timeline_id": "tl-main", "turn_number": 3,
        "finalization_id": None, "commit_type": "turn", "parents": [],
        "tree_digest": "tree000",
        "files": [
            {"path": "logs/events.jsonl", "blob_sha": "blob-b",
             "text": _jsonl({"event_type": "from-b"})},
            {"path": "logs/events.jsonl", "blob_sha": "blob-a",
             "text": _jsonl({"event_type": "from-a"})},
        ],
    })
    assert len(dup["events"]) == 1
    assert json.loads(dup["events"][0]["payload_json"])["event_type"] == "from-a"

    repeated = events_mod.extract_events(_commit([
        ("logs/rolls.jsonl", _jsonl(roll)),
        ("logs/events.jsonl", _jsonl(story)),
    ]))
    assert repeated == result


def test_crlf_lines_and_missing_trailing_newline():
    text = (
        json.dumps({"event_type": "a"}) + "\r\n"
        + json.dumps({"roll_id": "roll-crlf", "event_type": "roll"}) + "\r\n"
        + json.dumps({"event_type": "b"})
    )
    result = events_mod.extract_events(_commit([("logs/events.jsonl", text)]))
    assert [row["source_ordinal"] for row in result["events"]] == [1, 3]
    assert [row["roll_id"] for row in result["rolls"]] == ["roll-crlf"]
    assert result["backlog"] == []


def test_invalid_commit_record_fails_closed():
    for bad in (
        None,
        [],
        {"sha": "", "campaign_id": "c", "timeline_id": "tl", "files": []},
        {"sha": "a", "campaign_id": "c", "timeline_id": 5, "files": []},
        {"sha": "a", "campaign_id": "c", "timeline_id": "tl", "turn_number": "3"},
        {"sha": "a", "campaign_id": "c", "timeline_id": "tl", "files": {}},
    ):
        try:
            events_mod.extract_events(bad)
        except events_mod.EventExtractionError:
            continue
        raise AssertionError(f"expected EventExtractionError for {bad!r}")

    minimal = events_mod.extract_events({
        "sha": "a", "campaign_id": "c", "timeline_id": "tl-main",
    })
    assert minimal == {
        "events": [], "receipts": [], "rolls": [],
        "effects": [], "transactions": [], "backlog": [],
    }
