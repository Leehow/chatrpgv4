"""History projection read-only query API tests.

Builds a temporary projection database through the schema APIs and inserts
representative commits, snapshots, changes, entities, events, and relations
directly. Covers selectors (semantic, exact sha, unique prefix, ambiguity,
missing), same-line and cross-line diffs, entity history, deterministic
event ordering, privacy passthrough, limit bounds, zero results, and
fail-closed behavior on corrupt stored JSON and inconsistent provenance.
No Git, no worktree, no real campaign data.
"""
from __future__ import annotations

import importlib.util
import sqlite3
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
SCRIPTS = REPO / "plugins" / "coc-keeper" / "scripts"


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


schema_mod = _load(
    "coc_history_projection_schema", SCRIPTS / "coc_history_projection_schema.py"
)
query_mod = _load(
    "coc_history_projection_query", SCRIPTS / "coc_history_projection_query.py"
)

CAMPAIGN_ID = "hist-proj-q"

A_SHA = "a1" * 20  # tl-main, turn 1
B_SHA = "b2" * 20  # tl-main, turn 2
C_SHA = "c3" * 20  # tl-branch-a, turn 2
D_SHA = "ad" * 20  # ambiguity fixture: shares prefix "a" with A_SHA
E_SHA = "e5" * 20  # tl-main baseline, turn None

NPC_DOC = {"npcs": {"npc-doctor": {"npc_id": "npc-doctor", "hostility": "wary"}}}
INVESTIGATOR_DOC = {
    "investigators": [{"investigator_id": "inv-marlow", "hp": 10}]
}


def _insert_commit(
    connection: sqlite3.Connection,
    sha: str,
    *,
    ordinal: int,
    timeline_id: str,
    turn_number: int | None,
    finalization_id: str | None,
    commit_type: str = "turn",
    parents: tuple[str, ...] = (),
    tree_digest: str = "tree-x",
    files: tuple[dict, ...] = (),
) -> None:
    connection.execute(
        "INSERT INTO commits (sha, campaign_id, timeline_id, ordinal,"
        " turn_number, finalization_id, commit_type, parents_json,"
        " tree_digest, files_json) VALUES (?,?,?,?,?,?,?,?,?,?)",
        (
            sha,
            CAMPAIGN_ID,
            timeline_id,
            ordinal,
            turn_number,
            finalization_id,
            commit_type,
            schema_mod.canonical_json(list(parents)),
            tree_digest,
            schema_mod.canonical_json(list(files)),
        ),
    )


def _insert_snapshot(
    connection: sqlite3.Connection, sha: str, path: str, document
) -> None:
    connection.execute(
        "INSERT INTO state_snapshots (commit_sha, path, snapshot_json,"
        " snapshot_sha256) VALUES (?,?,?,?)",
        (
            sha,
            path,
            schema_mod.canonical_json(document),
            schema_mod.canonical_json_digest(document),
        ),
    )


def _insert_change(
    connection: sqlite3.Connection,
    sha: str,
    path: str,
    pointer: str,
    change_type: str,
    old_value_json,
    new_value_json,
) -> None:
    change = {
        "change_type": change_type,
        "old_value_json": old_value_json,
        "new_value_json": new_value_json,
    }
    connection.execute(
        "INSERT INTO state_changes (commit_sha, path, pointer, change_json)"
        " VALUES (?,?,?,?)",
        (sha, path, pointer, schema_mod.canonical_json(change)),
    )


def _insert_event(
    connection: sqlite3.Connection,
    *,
    commit_sha: str,
    timeline_id: str,
    turn_number: int | None,
    source_ordinal: int,
    event_type: str,
    payload: dict,
    source_path: str = "logs/game.jsonl",
) -> None:
    connection.execute(
        "INSERT INTO events (commit_sha, timeline_id, turn_number,"
        " source_path, source_ordinal, event_type, payload_sha256,"
        " payload_json) VALUES (?,?,?,?,?,?,?,?)",
        (
            commit_sha,
            timeline_id,
            turn_number,
            source_path,
            source_ordinal,
            event_type,
            schema_mod.canonical_json_digest(payload),
            schema_mod.canonical_json(payload),
        ),
    )


def _insert_base_rows(connection: sqlite3.Connection) -> None:
    connection.execute(
        "INSERT INTO campaigns (campaign_id, schema_generation,"
        " head_commit_sha, commit_count) VALUES (?,?,?,?)",
        (CAMPAIGN_ID, "history-projection-1", E_SHA, 4),
    )
    connection.execute(
        "INSERT INTO timelines (campaign_id, timeline_id, first_commit_sha,"
        " head_commit_sha, last_turn_number, commit_count)"
        " VALUES (?,?,?,?,?,?)",
        (CAMPAIGN_ID, "tl-main", A_SHA, E_SHA, 2, 3),
    )
    connection.execute(
        "INSERT INTO timelines (campaign_id, timeline_id, first_commit_sha,"
        " head_commit_sha, last_turn_number, commit_count)"
        " VALUES (?,?,?,?,?,?)",
        (CAMPAIGN_ID, "tl-branch-a", C_SHA, C_SHA, 2, 1),
    )

    _insert_commit(
        connection,
        A_SHA,
        ordinal=1,
        timeline_id="tl-main",
        turn_number=1,
        finalization_id="fin-a",
        parents=(),
        tree_digest="tree-a",
        files=(
            {"path": "campaign.json", "blob_sha": "blob-a1"},
            {"path": "save/npcs.json", "blob_sha": "blob-a2"},
        ),
    )
    _insert_commit(
        connection,
        B_SHA,
        ordinal=2,
        timeline_id="tl-main",
        turn_number=2,
        finalization_id="fin-b",
        parents=(A_SHA,),
        tree_digest="tree-b",
        files=(
            {"path": "campaign.json", "blob_sha": "blob-a1"},
            {"path": "save/npcs.json", "blob_sha": "blob-b1"},
            {"path": "save/investigators.json", "blob_sha": "blob-b2"},
        ),
    )
    _insert_commit(
        connection,
        C_SHA,
        ordinal=3,
        timeline_id="tl-branch-a",
        turn_number=2,
        finalization_id="fin-c",
        parents=(A_SHA,),
        tree_digest="tree-c",
        files=(
            {"path": "campaign.json", "blob_sha": "blob-a1"},
            {"path": "save/npcs.json", "blob_sha": "blob-c1"},
        ),
    )
    _insert_commit(
        connection,
        E_SHA,
        ordinal=4,
        timeline_id="tl-main",
        turn_number=None,
        finalization_id=None,
        commit_type="baseline",
        parents=(B_SHA,),
        tree_digest="tree-e",
    )

    campaign_doc = {"campaign_id": CAMPAIGN_ID}
    _insert_snapshot(connection, A_SHA, "campaign.json", campaign_doc)
    _insert_snapshot(connection, A_SHA, "save/npcs.json", NPC_DOC)
    _insert_snapshot(connection, B_SHA, "campaign.json", campaign_doc)
    _insert_snapshot(
        connection,
        B_SHA,
        "save/npcs.json",
        {
            "npcs": {
                "npc-doctor": {
                    "npc_id": "npc-doctor",
                    "hostility": "hostile",
                }
            }
        },
    )
    _insert_snapshot(
        connection, B_SHA, "save/investigators.json", INVESTIGATOR_DOC
    )
    _insert_snapshot(connection, C_SHA, "campaign.json", campaign_doc)
    _insert_snapshot(
        connection,
        C_SHA,
        "save/npcs.json",
        {
            "npcs": {
                "npc-doctor": {
                    "npc_id": "npc-doctor",
                    "hostility": "friendly",
                    "secret_note": "keepers-only",
                }
            }
        },
    )

    _insert_change(
        connection,
        B_SHA,
        "save/npcs.json",
        "/npcs/npc-doctor/hostility",
        "replace",
        '"wary"',
        '"hostile"',
    )
    _insert_change(
        connection,
        B_SHA,
        "save/investigators.json",
        "/investigators/0/hp",
        "add",
        None,
        "10",
    )
    _insert_change(
        connection,
        B_SHA,
        "save/investigators.json",
        "/investigators/0/investigator_id",
        "add",
        None,
        '"inv-marlow"',
    )
    _insert_change(
        connection,
        C_SHA,
        "save/npcs.json",
        "/npcs/npc-doctor/hostility",
        "replace",
        '"hostile"',
        '"friendly"',
    )
    _insert_change(
        connection,
        C_SHA,
        "save/npcs.json",
        "/npcs/npc-doctor/secret_note",
        "add",
        None,
        '"keepers-only"',
    )

    connection.execute(
        "INSERT INTO entities (entity_id, entity_type, first_commit_sha,"
        " last_commit_sha) VALUES (?,?,?,?)",
        ("npc-doctor", "npc", A_SHA, C_SHA),
    )
    connection.execute(
        "INSERT INTO entities (entity_id, entity_type, first_commit_sha,"
        " last_commit_sha) VALUES (?,?,?,?)",
        ("inv-marlow", "investigator", B_SHA, B_SHA),
    )
    connection.execute(
        "INSERT INTO relations (commit_sha, path, pointer, from_entity_kind,"
        " from_entity_id, to_entity_kind, to_entity_id, relation_kind)"
        " VALUES (?,?,?,?,?,?,?,?)",
        (
            B_SHA,
            "save/investigators.json",
            "/investigators/0",
            "investigator",
            "inv-marlow",
            "npc",
            "npc-doctor",
            "ally",
        ),
    )

    # event ids 1..5 in insertion order; event 1's prose mentions npc-doctor
    # with no structured field and must never match entity queries.
    _insert_event(
        connection,
        commit_sha=A_SHA,
        timeline_id="tl-main",
        turn_number=1,
        source_ordinal=1,
        event_type="scene_change",
        payload={
            "scene_id": "scene-harbor",
            "visibility": "public",
            "text": "the npc-doctor waits in the fog",
        },
    )
    _insert_event(
        connection,
        commit_sha=B_SHA,
        timeline_id="tl-main",
        turn_number=2,
        source_ordinal=2,
        event_type="npc_interaction",
        payload={
            "npc_id": "npc-doctor",
            "visibility": "secret",
            "secret": True,
            "text": "the doctor hides a wound",
        },
    )
    _insert_event(
        connection,
        commit_sha=B_SHA,
        timeline_id="tl-main",
        turn_number=2,
        source_ordinal=3,
        event_type="npc_interaction",
        payload={"npc_id": "npc-doctor", "visibility": "public"},
    )
    _insert_event(
        connection,
        commit_sha=C_SHA,
        timeline_id="tl-branch-a",
        turn_number=2,
        source_ordinal=1,
        event_type="sanity_loss",
        payload={
            "investigator_id": "inv-marlow",
            "sanity_loss": 3,
            "visibility": "secret",
        },
    )
    _insert_event(
        connection,
        commit_sha=E_SHA,
        timeline_id="tl-main",
        turn_number=None,
        source_ordinal=1,
        event_type="campaign_baseline",
        payload={"flag_id": "flag-started"},
    )


def _build_projection(tmp_path: Path) -> Path:
    root = tmp_path / "workspace"
    connection = schema_mod.create_projection_db(
        schema_mod.projection_path(root, CAMPAIGN_ID)
    )
    try:
        _insert_base_rows(connection)
        connection.commit()
    finally:
        connection.close()
    return root


def _open(root: Path) -> sqlite3.Connection:
    return schema_mod.open_projection_db(root, CAMPAIGN_ID)


def _insert_duplicate_turn_commit(root: Path) -> None:
    """D: tl-main turn 2 — duplicates B's semantic pair and A's sha prefix."""
    connection = _open(root)
    try:
        _insert_commit(
            connection,
            D_SHA,
            ordinal=5,
            timeline_id="tl-main",
            turn_number=2,
            finalization_id="fin-d",
            parents=(B_SHA,),
            tree_digest="tree-d",
        )
        connection.commit()
    finally:
        connection.close()


# --------------------------------------------------------------------------- #
# resolve_selector
# --------------------------------------------------------------------------- #

class TestResolveSelector:
    def test_semantic_timeline_turn(self, tmp_path):
        root = _build_projection(tmp_path)
        connection = _open(root)
        try:
            record = query_mod.resolve_selector(
                connection, timeline_id="tl-main", turn_number=2
            )
        finally:
            connection.close()
        assert record == {
            "sha": B_SHA,
            "campaign_id": CAMPAIGN_ID,
            "timeline_id": "tl-main",
            "turn_number": 2,
            "finalization_id": "fin-b",
            "commit_type": "turn",
            "ordinal": 2,
            "parents": [A_SHA],
            "tree_digest": "tree-b",
            "files": [
                {"path": "campaign.json", "blob_sha": "blob-a1"},
                {"path": "save/npcs.json", "blob_sha": "blob-b1"},
                {"path": "save/investigators.json", "blob_sha": "blob-b2"},
            ],
        }

    def test_cross_timeline_same_turn_resolves_per_timeline(self, tmp_path):
        root = _build_projection(tmp_path)
        connection = _open(root)
        try:
            record = query_mod.resolve_selector(
                connection, timeline_id="tl-branch-a", turn_number=2
            )
        finally:
            connection.close()
        assert record["sha"] == C_SHA

    def test_exact_sha(self, tmp_path):
        root = _build_projection(tmp_path)
        connection = _open(root)
        try:
            record = query_mod.resolve_selector(connection, commit_sha=C_SHA)
        finally:
            connection.close()
        assert record["sha"] == C_SHA

    def test_sha_prefix_rejected_even_when_unique(self, tmp_path):
        """No prefix resolution: a unique prefix must fail closed too.

        Prefix meaning can drift as the projection grows; only an exact
        full sha present in ``commits`` selects.
        """
        root = _build_projection(tmp_path)
        connection = _open(root)
        try:
            with pytest.raises(
                query_mod.ProjectionQueryError, match="exact full sha"
            ):
                query_mod.resolve_selector(connection, commit_sha="c3c3")
            with pytest.raises(query_mod.ProjectionQueryError):
                # matches two shas today, but rejection is not about count
                query_mod.resolve_selector(connection, commit_sha="a")
            with pytest.raises(query_mod.ProjectionQueryError):
                query_mod.resolve_selector(connection, commit_sha="zz-not-a-sha")
        finally:
            connection.close()

    def test_exact_sha_still_selects_after_growth(self, tmp_path):
        """Exact-sha selection stays stable when the projection grows."""
        root = _build_projection(tmp_path)
        _insert_duplicate_turn_commit(root)
        connection = _open(root)
        try:
            record = query_mod.resolve_selector(connection, commit_sha=C_SHA)
        finally:
            connection.close()
        assert record["sha"] == C_SHA

    def test_sha_conflicting_timeline_fails_closed(self, tmp_path):
        root = _build_projection(tmp_path)
        connection = _open(root)
        try:
            with pytest.raises(query_mod.ProjectionQueryError):
                query_mod.resolve_selector(
                    connection,
                    commit_sha=B_SHA,
                    timeline_id="tl-branch-a",
                )
        finally:
            connection.close()

    def test_unknown_sha_and_unknown_semantic_fail_closed(self, tmp_path):
        root = _build_projection(tmp_path)
        connection = _open(root)
        try:
            with pytest.raises(query_mod.ProjectionQueryError):
                query_mod.resolve_selector(connection, commit_sha="ff" * 20)
            with pytest.raises(query_mod.ProjectionQueryError):
                query_mod.resolve_selector(
                    connection, timeline_id="tl-main", turn_number=99
                )
        finally:
            connection.close()

    def test_ambiguous_timeline_turn_pair_fails_closed(self, tmp_path):
        root = _build_projection(tmp_path)
        _insert_duplicate_turn_commit(root)
        connection = _open(root)
        try:
            with pytest.raises(query_mod.ProjectionQueryError, match="ambiguous"):
                query_mod.resolve_selector(
                    connection, timeline_id="tl-main", turn_number=2
                )
        finally:
            connection.close()

    def test_invalid_selector_combinations_fail_closed(self, tmp_path):
        root = _build_projection(tmp_path)
        connection = _open(root)
        try:
            with pytest.raises(query_mod.ProjectionQueryError):
                query_mod.resolve_selector(connection)
            with pytest.raises(query_mod.ProjectionQueryError):
                query_mod.resolve_selector(connection, timeline_id="tl-main")
            with pytest.raises(query_mod.ProjectionQueryError):
                query_mod.resolve_selector(connection, turn_number=2)
        finally:
            connection.close()

    def test_invalid_selector_value_types_fail_closed(self, tmp_path):
        root = _build_projection(tmp_path)
        connection = _open(root)
        try:
            with pytest.raises(query_mod.ProjectionQueryError):
                query_mod.resolve_selector(connection, timeline_id=123, turn_number=1)
            with pytest.raises(query_mod.ProjectionQueryError):
                query_mod.resolve_selector(
                    connection, timeline_id="tl-main", turn_number="2"
                )
            with pytest.raises(query_mod.ProjectionQueryError):
                query_mod.resolve_selector(
                    connection, timeline_id="tl-main", turn_number=True
                )
            with pytest.raises(query_mod.ProjectionQueryError):
                query_mod.resolve_selector(connection, commit_sha="   ")
        finally:
            connection.close()


# --------------------------------------------------------------------------- #
# query_history_at
# --------------------------------------------------------------------------- #

class TestQueryHistoryAt:
    def test_commit_metadata_and_grouped_snapshots(self, tmp_path):
        root = _build_projection(tmp_path)
        result = query_mod.query_history_at(
            root, CAMPAIGN_ID, timeline_id="tl-main", turn_number=2
        )
        assert result["commit"]["sha"] == B_SHA
        assert result["commit"]["parents"] == [A_SHA]
        assert list(result["snapshots"]) == [
            "campaign.json",
            "save/investigators.json",
            "save/npcs.json",
        ]
        npcs = result["snapshots"]["save/npcs.json"]
        assert npcs["state"] == {
            "npcs": {"npc-doctor": {"npc_id": "npc-doctor", "hostility": "hostile"}}
        }
        assert npcs["snapshot_sha256"] == schema_mod.canonical_json_digest(
            npcs["state"]
        )
        assert result["snapshots"]["save/investigators.json"]["state"] == (
            INVESTIGATOR_DOC
        )

    def test_commit_without_snapshots_yields_empty_mapping(self, tmp_path):
        root = _build_projection(tmp_path)
        result = query_mod.query_history_at(root, CAMPAIGN_ID, commit_sha=E_SHA)
        assert result["commit"]["commit_type"] == "baseline"
        assert result["snapshots"] == {}

    def test_missing_database_fails_closed(self, tmp_path):
        with pytest.raises(query_mod.HistoryProjectionError):
            query_mod.query_history_at(
                tmp_path / "nowhere",
                CAMPAIGN_ID,
                timeline_id="tl-main",
                turn_number=1,
            )

    def test_invalid_campaign_id_fails_closed(self, tmp_path):
        root = _build_projection(tmp_path)
        with pytest.raises(query_mod.HistoryProjectionError):
            query_mod.query_history_at(
                root, "../evil", timeline_id="tl-main", turn_number=1
            )

    def test_corrupt_snapshot_json_fails_closed(self, tmp_path):
        root = _build_projection(tmp_path)
        connection = _open(root)
        try:
            connection.execute(
                "UPDATE state_snapshots SET snapshot_json = ?"
                " WHERE commit_sha = ? AND path = ?",
                ('{"broken', B_SHA, "save/npcs.json"),
            )
            connection.commit()
        finally:
            connection.close()
        with pytest.raises(query_mod.HistoryProjectionError):
            query_mod.query_history_at(
                root, CAMPAIGN_ID, timeline_id="tl-main", turn_number=2
            )

    def test_corrupt_parents_json_fails_closed(self, tmp_path):
        root = _build_projection(tmp_path)
        connection = _open(root)
        try:
            connection.execute(
                "UPDATE commits SET parents_json = ? WHERE sha = ?",
                ("not-json", B_SHA),
            )
            connection.commit()
        finally:
            connection.close()
        with pytest.raises(query_mod.HistoryProjectionError):
            query_mod.query_history_at(
                root, CAMPAIGN_ID, timeline_id="tl-main", turn_number=2
            )


# --------------------------------------------------------------------------- #
# query_history_diff
# --------------------------------------------------------------------------- #

class TestQueryHistoryDiff:
    def test_same_timeline_leaf_diff_with_attribution(self, tmp_path):
        root = _build_projection(tmp_path)
        result = query_mod.query_history_diff(
            root,
            CAMPAIGN_ID,
            {"timeline_id": "tl-main", "turn_number": 1},
            {"timeline_id": "tl-main", "turn_number": 2},
        )
        assert result["from_commit"]["sha"] == A_SHA
        assert result["to_commit"]["sha"] == B_SHA
        assert result["changes"] == [
            {
                "path": "save/investigators.json",
                "pointer": "/investigators/0/hp",
                "change_type": "add",
                "old_value": None,
                "new_value": 10,
                "entities": [
                    {"entity_type": "investigator", "entity_id": "inv-marlow"}
                ],
            },
            {
                "path": "save/investigators.json",
                "pointer": "/investigators/0/investigator_id",
                "change_type": "add",
                "old_value": None,
                "new_value": "inv-marlow",
                "entities": [
                    {"entity_type": "investigator", "entity_id": "inv-marlow"}
                ],
            },
            {
                "path": "save/npcs.json",
                "pointer": "/npcs/npc-doctor/hostility",
                "change_type": "replace",
                "old_value": "wary",
                "new_value": "hostile",
                "entities": [{"entity_type": "npc", "entity_id": "npc-doctor"}],
            },
        ]

    def test_cross_timeline_diff(self, tmp_path):
        root = _build_projection(tmp_path)
        result = query_mod.query_history_diff(
            root,
            CAMPAIGN_ID,
            {"timeline_id": "tl-main", "turn_number": 2},
            {"timeline_id": "tl-branch-a", "turn_number": 2},
        )
        assert result["from_commit"]["timeline_id"] == "tl-main"
        assert result["to_commit"]["timeline_id"] == "tl-branch-a"
        npc_entities = [{"entity_type": "npc", "entity_id": "npc-doctor"}]
        investigator_entities = [
            {"entity_type": "investigator", "entity_id": "inv-marlow"}
        ]
        assert result["changes"] == [
            # the branch never saw investigators.json: its leaves are removes
            {
                "path": "save/investigators.json",
                "pointer": "/investigators/0/hp",
                "change_type": "remove",
                "old_value": 10,
                "new_value": None,
                "entities": investigator_entities,
            },
            {
                "path": "save/investigators.json",
                "pointer": "/investigators/0/investigator_id",
                "change_type": "remove",
                "old_value": "inv-marlow",
                "new_value": None,
                "entities": investigator_entities,
            },
            {
                "path": "save/npcs.json",
                "pointer": "/npcs/npc-doctor/hostility",
                "change_type": "replace",
                "old_value": "hostile",
                "new_value": "friendly",
                "entities": npc_entities,
            },
            {
                "path": "save/npcs.json",
                "pointer": "/npcs/npc-doctor/secret_note",
                "change_type": "add",
                "old_value": None,
                "new_value": "keepers-only",
                "entities": npc_entities,
            },
        ]

    def test_reverse_diff_reports_removals(self, tmp_path):
        root = _build_projection(tmp_path)
        result = query_mod.query_history_diff(
            root,
            CAMPAIGN_ID,
            {"timeline_id": "tl-main", "turn_number": 2},
            {"timeline_id": "tl-main", "turn_number": 1},
        )
        by_pointer = {
            change["pointer"]: change for change in result["changes"]
        }
        removed = by_pointer["/investigators/0/hp"]
        assert removed["change_type"] == "remove"
        assert removed["old_value"] == 10
        assert removed["new_value"] is None
        assert removed["entities"] == [
            {"entity_type": "investigator", "entity_id": "inv-marlow"}
        ]
        replaced = by_pointer["/npcs/npc-doctor/hostility"]
        assert replaced["change_type"] == "replace"
        assert replaced["old_value"] == "hostile"
        assert replaced["new_value"] == "wary"

    def test_identical_commits_yield_empty_diff(self, tmp_path):
        root = _build_projection(tmp_path)
        selector = {"timeline_id": "tl-main", "turn_number": 2}
        result = query_mod.query_history_diff(
            root, CAMPAIGN_ID, selector, dict(selector)
        )
        assert result["changes"] == []
        assert result["from_commit"]["sha"] == result["to_commit"]["sha"]

    def test_sha_selectors_accepted(self, tmp_path):
        root = _build_projection(tmp_path)
        result = query_mod.query_history_diff(
            root, CAMPAIGN_ID, {"commit_sha": A_SHA}, {"commit_sha": C_SHA}
        )
        assert result["from_commit"]["sha"] == A_SHA
        assert result["to_commit"]["sha"] == C_SHA

    def test_prefix_selector_fails_closed(self, tmp_path):
        root = _build_projection(tmp_path)
        with pytest.raises(query_mod.ProjectionQueryError, match="exact full sha"):
            query_mod.query_history_diff(
                root,
                CAMPAIGN_ID,
                {"commit_sha": A_SHA},
                {"commit_sha": "c3c3"},
            )

    def test_selector_validation_fails_closed(self, tmp_path):
        root = _build_projection(tmp_path)
        valid = {"timeline_id": "tl-main", "turn_number": 2}
        with pytest.raises(query_mod.ProjectionQueryError):
            query_mod.query_history_diff(root, CAMPAIGN_ID, "tl-main", valid)
        with pytest.raises(query_mod.ProjectionQueryError):
            query_mod.query_history_diff(
                root, CAMPAIGN_ID, {"revision": 1}, valid
            )
        with pytest.raises(query_mod.ProjectionQueryError):
            query_mod.query_history_diff(
                root,
                CAMPAIGN_ID,
                {"timeline_id": "tl-main", "turn_number": 99},
                valid,
            )

    def test_corrupt_snapshot_fails_closed(self, tmp_path):
        root = _build_projection(tmp_path)
        connection = _open(root)
        try:
            connection.execute(
                "UPDATE state_snapshots SET snapshot_json = ?"
                " WHERE commit_sha = ?",
                ("[1,2,", C_SHA),
            )
            connection.commit()
        finally:
            connection.close()
        with pytest.raises(query_mod.HistoryProjectionError):
            query_mod.query_history_diff(
                root,
                CAMPAIGN_ID,
                {"timeline_id": "tl-main", "turn_number": 2},
                {"timeline_id": "tl-branch-a", "turn_number": 2},
            )


# --------------------------------------------------------------------------- #
# query_entity_history
# --------------------------------------------------------------------------- #

class TestQueryEntityHistory:
    def test_full_history_for_state_entity(self, tmp_path):
        root = _build_projection(tmp_path)
        result = query_mod.query_entity_history(root, CAMPAIGN_ID, "npc-doctor")
        assert result["entity_types"] == ["npc"]
        assert result["first_commit_sha"] == A_SHA
        assert result["last_commit_sha"] == C_SHA
        assert [entry["ordinal"] for entry in result["commits"]] == [1, 2, 3]
        for entry in result["commits"]:
            assert entry["mentions"] == [
                {
                    "path": "save/npcs.json",
                    "pointer": "/npcs/npc-doctor/npc_id",
                    "entity_type": "npc",
                }
            ]
        # events 2 and 3 carry structured npc_id; event 1's prose mention of
        # "npc-doctor" must never match.
        assert [event["event_id"] for event in result["events"]] == [2, 3]
        assert [rel["commit_sha"] for rel in result["relations"]] == [B_SHA]
        relation = result["relations"][0]
        assert relation["from_entity_id"] == "inv-marlow"
        assert relation["to_entity_id"] == "npc-doctor"
        assert relation["relation_kind"] == "ally"
        assert relation["timeline_id"] == "tl-main"

    def test_investigator_entity_spans_events_and_relations(self, tmp_path):
        root = _build_projection(tmp_path)
        result = query_mod.query_entity_history(
            root, CAMPAIGN_ID, "inv-marlow"
        )
        assert [entry["sha"] for entry in result["commits"]] == [B_SHA]
        assert result["commits"][0]["mentions"] == [
            {
                "path": "save/investigators.json",
                "pointer": "/investigators/0/investigator_id",
                "entity_type": "investigator",
            }
        ]
        assert [event["event_id"] for event in result["events"]] == [4]
        assert [rel["commit_sha"] for rel in result["relations"]] == [B_SHA]

    def test_timeline_filter(self, tmp_path):
        root = _build_projection(tmp_path)
        result = query_mod.query_entity_history(
            root, CAMPAIGN_ID, "npc-doctor", timeline_id="tl-branch-a"
        )
        assert [entry["sha"] for entry in result["commits"]] == [C_SHA]
        assert result["events"] == []
        assert result["relations"] == []
        # global provenance echoes stay unfiltered
        assert result["first_commit_sha"] == A_SHA
        assert result["last_commit_sha"] == C_SHA

    def test_entity_only_in_event_payload(self, tmp_path):
        root = _build_projection(tmp_path)
        result = query_mod.query_entity_history(
            root, CAMPAIGN_ID, "scene-harbor"
        )
        assert result["commits"] == []
        assert result["relations"] == []
        assert result["entity_types"] == []
        assert result["first_commit_sha"] is None
        assert result["last_commit_sha"] is None
        assert [event["event_id"] for event in result["events"]] == [1]
        assert result["events"][0]["entity_refs"] == [
            {"pointer": "/scene_id", "entity_type": "scene"}
        ]

    def test_unknown_entity_zero_results(self, tmp_path):
        root = _build_projection(tmp_path)
        result = query_mod.query_entity_history(root, CAMPAIGN_ID, "ghost")
        assert result["commits"] == []
        assert result["events"] == []
        assert result["relations"] == []
        assert result["entity_types"] == []

    def test_invalid_entity_id_fails_closed(self, tmp_path):
        root = _build_projection(tmp_path)
        with pytest.raises(query_mod.ProjectionQueryError):
            query_mod.query_entity_history(root, CAMPAIGN_ID, "  ")
        with pytest.raises(query_mod.ProjectionQueryError):
            query_mod.query_entity_history(root, CAMPAIGN_ID, "npc", timeline_id=5)

    def test_corrupt_event_payload_fails_closed(self, tmp_path):
        root = _build_projection(tmp_path)
        connection = _open(root)
        try:
            connection.execute(
                "UPDATE events SET payload_json = ? WHERE event_id = ?",
                ("{oops", 2),
            )
            connection.commit()
        finally:
            connection.close()
        with pytest.raises(query_mod.HistoryProjectionError):
            query_mod.query_entity_history(root, CAMPAIGN_ID, "npc-doctor")

    def test_relation_with_missing_commit_fails_closed(self, tmp_path):
        root = _build_projection(tmp_path)
        connection = _open(root)
        try:
            connection.execute(
                "INSERT INTO relations (commit_sha, path, pointer,"
                " from_entity_kind, from_entity_id, to_entity_kind,"
                " to_entity_id, relation_kind) VALUES (?,?,?,?,?,?,?,?)",
                ("ff" * 20, "save/npcs.json", "/x", "npc", "npc-doctor",
                 "npc", "npc-other", "rival"),
            )
            connection.commit()
        finally:
            connection.close()
        with pytest.raises(query_mod.ProjectionQueryError, match="missing"):
            query_mod.query_entity_history(root, CAMPAIGN_ID, "npc-doctor")

    def test_orphan_event_matching_entity_fails_closed(self, tmp_path):
        root = _build_projection(tmp_path)
        connection = _open(root)
        try:
            _insert_event(
                connection,
                commit_sha="ff" * 20,  # absent from commits
                timeline_id="tl-main",
                turn_number=3,
                source_ordinal=1,
                event_type="npc_interaction",
                payload={"npc_id": "npc-doctor"},
            )
            connection.commit()
        finally:
            connection.close()
        with pytest.raises(
            query_mod.ProjectionQueryError, match="missing"
        ):
            query_mod.query_entity_history(root, CAMPAIGN_ID, "npc-doctor")

    def test_orphan_event_not_matching_entity_is_not_selected(self, tmp_path):
        """Only *selected* events require provenance: an orphan event for a
        different entity never reaches the result and must not fail the
        query."""
        root = _build_projection(tmp_path)
        connection = _open(root)
        try:
            _insert_event(
                connection,
                commit_sha="ff" * 20,
                timeline_id="tl-main",
                turn_number=3,
                source_ordinal=1,
                event_type="npc_interaction",
                payload={"npc_id": "npc-other"},
            )
            connection.commit()
        finally:
            connection.close()
        result = query_mod.query_entity_history(root, CAMPAIGN_ID, "npc-doctor")
        assert [event["event_id"] for event in result["events"]] == [2, 3]


# --------------------------------------------------------------------------- #
# query_event_log
# --------------------------------------------------------------------------- #

class TestQueryEventLog:
    def test_newest_first_deterministic_ordering(self, tmp_path):
        root = _build_projection(tmp_path)
        result = query_mod.query_event_log(root, CAMPAIGN_ID)
        assert [event["event_id"] for event in result["events"]] == [
            4, 3, 2, 1, 5,
        ]
        assert [event["turn_number"] for event in result["events"]] == [
            2, 2, 2, 1, None,
        ]

    def test_timeline_filter(self, tmp_path):
        root = _build_projection(tmp_path)
        result = query_mod.query_event_log(
            root, CAMPAIGN_ID, timeline_id="tl-main"
        )
        assert [event["event_id"] for event in result["events"]] == [3, 2, 1, 5]

    def test_event_types_filter(self, tmp_path):
        root = _build_projection(tmp_path)
        single = query_mod.query_event_log(
            root, CAMPAIGN_ID, event_types=["npc_interaction"]
        )
        assert single["event_types"] == ["npc_interaction"]
        assert [event["event_id"] for event in single["events"]] == [3, 2]
        multi = query_mod.query_event_log(
            root, CAMPAIGN_ID,
            event_types=["scene_change", "npc_interaction"],
        )
        assert multi["event_types"] == ["npc_interaction", "scene_change"]
        assert [event["event_id"] for event in multi["events"]] == [3, 2, 1]

    def test_filters_can_combine(self, tmp_path):
        root = _build_projection(tmp_path)
        result = query_mod.query_event_log(
            root,
            CAMPAIGN_ID,
            timeline_id="tl-main",
            event_types=["npc_interaction"],
            limit=10,
        )
        assert [event["event_id"] for event in result["events"]] == [3, 2]

    def test_privacy_fields_preserved_verbatim(self, tmp_path):
        root = _build_projection(tmp_path)
        result = query_mod.query_event_log(
            root, CAMPAIGN_ID, event_types=["npc_interaction"], limit=1
        )
        event = result["events"][0]
        assert event["event_id"] == 3
        secret_event = query_mod.query_event_log(
            root, CAMPAIGN_ID, event_types=["npc_interaction"], limit=2
        )["events"][1]
        assert secret_event["payload"]["visibility"] == "secret"
        assert secret_event["payload"]["secret"] is True
        assert secret_event["payload_sha256"] == schema_mod.canonical_json_digest(
            secret_event["payload"]
        )

    def test_limit_bounds_fail_closed(self, tmp_path):
        root = _build_projection(tmp_path)
        for bad in (0, -1, 201, "10", True, 1.5):
            with pytest.raises(query_mod.ProjectionQueryError):
                query_mod.query_event_log(root, CAMPAIGN_ID, limit=bad)

    def test_limit_at_upper_bound_accepted(self, tmp_path):
        root = _build_projection(tmp_path)
        result = query_mod.query_event_log(root, CAMPAIGN_ID, limit=200)
        assert result["limit"] == 200
        assert len(result["events"]) == 5

    def test_limit_truncates_newest_first(self, tmp_path):
        root = _build_projection(tmp_path)
        result = query_mod.query_event_log(root, CAMPAIGN_ID, limit=2)
        assert [event["event_id"] for event in result["events"]] == [4, 3]

    def test_default_limit_is_50(self, tmp_path):
        root = _build_projection(tmp_path)
        result = query_mod.query_event_log(root, CAMPAIGN_ID)
        assert result["limit"] == 50

    def test_event_types_validation_fails_closed(self, tmp_path):
        root = _build_projection(tmp_path)
        with pytest.raises(query_mod.ProjectionQueryError):
            query_mod.query_event_log(root, CAMPAIGN_ID, event_types="roll")
        with pytest.raises(query_mod.ProjectionQueryError):
            query_mod.query_event_log(root, CAMPAIGN_ID, event_types=[])
        with pytest.raises(query_mod.ProjectionQueryError):
            query_mod.query_event_log(root, CAMPAIGN_ID, event_types=[123])
        with pytest.raises(query_mod.ProjectionQueryError):
            query_mod.query_event_log(root, CAMPAIGN_ID, event_types=[" "])
        with pytest.raises(query_mod.ProjectionQueryError):
            query_mod.query_event_log(root, CAMPAIGN_ID, timeline_id="")

    def test_zero_results(self, tmp_path):
        root = _build_projection(tmp_path)
        unmatched = query_mod.query_event_log(
            root, CAMPAIGN_ID, event_types=["quest"]
        )
        assert unmatched["events"] == []
        unknown_timeline = query_mod.query_event_log(
            root, CAMPAIGN_ID, timeline_id="tl-ghost"
        )
        assert unknown_timeline["events"] == []

    def test_orphan_event_fails_closed(self, tmp_path):
        root = _build_projection(tmp_path)
        connection = _open(root)
        try:
            _insert_event(
                connection,
                commit_sha="ff" * 20,  # absent from commits
                timeline_id="tl-main",
                turn_number=9,
                source_ordinal=1,
                event_type="npc_interaction",
                payload={"npc_id": "npc-doctor"},
            )
            connection.commit()
        finally:
            connection.close()
        with pytest.raises(
            query_mod.ProjectionQueryError, match="missing"
        ):
            query_mod.query_event_log(root, CAMPAIGN_ID)

    def test_orphan_event_outside_selection_does_not_fail(self, tmp_path):
        """The orphan check binds the selected rows: an orphan filtered out
        by the event-type filter is not selected and does not fail."""
        root = _build_projection(tmp_path)
        connection = _open(root)
        try:
            _insert_event(
                connection,
                commit_sha="ff" * 20,
                timeline_id="tl-main",
                turn_number=9,
                source_ordinal=1,
                event_type="quest_update",
                payload={"quest_id": "quest-ghost"},
            )
            connection.commit()
        finally:
            connection.close()
        result = query_mod.query_event_log(
            root, CAMPAIGN_ID, event_types=["npc_interaction"]
        )
        assert [event["event_id"] for event in result["events"]] == [3, 2]

    def test_corrupt_payload_fails_closed(self, tmp_path):
        root = _build_projection(tmp_path)
        connection = _open(root)
        try:
            connection.execute(
                "UPDATE events SET payload_json = ? WHERE event_id = ?",
                ("nope", 4),
            )
            connection.commit()
        finally:
            connection.close()
        with pytest.raises(query_mod.HistoryProjectionError):
            query_mod.query_event_log(root, CAMPAIGN_ID)


# --------------------------------------------------------------------------- #
# Module boundary
# --------------------------------------------------------------------------- #

class TestModuleBoundary:
    def test_imports_only_schema_helper(self, tmp_path, monkeypatch):
        """The query module must load with the state extractor absent.

        Poisoning ``sys.modules`` makes ``import
        coc_history_projection_state`` raise ImportError, so this test
        fails if the query module ever re-couples to extractor internals.
        """
        import sys

        monkeypatch.setitem(sys.modules, "coc_history_projection_state", None)
        module = _load(
            "coc_history_projection_query_fresh",
            SCRIPTS / "coc_history_projection_query.py",
        )
        assert sorted(module.__all__) == [
            "ProjectionQueryError",
            "SCHEMA_GENERATION",
            "query_authority_projection",
            "query_entity_history",
            "query_event_log",
            "query_history_at",
            "query_history_diff",
            "resolve_selector",
        ]
        # the duplicated structured contract stays in sync with the extractor
        assert tuple(module.ENTITY_FIELDS) == tuple(
            _load(
                "coc_history_projection_state_contract",
                SCRIPTS / "coc_history_projection_state.py",
            ).ENTITY_FIELDS
        )
        # the duplicated projection contract stays in sync with confluence
        assert tuple(module.AUTHORITY_PROJECTION_FIELDS) == tuple(
            _load(
                "coc_timeline_confluence_contract",
                SCRIPTS / "coc_timeline_confluence.py",
            ).PROJECTION_FIELDS
        )


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-q"]))
