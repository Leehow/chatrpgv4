"""History projection pure state extractor tests.

Covers leaf flattening, path scoping, leaf-level diffs against previous
snapshots, deterministic ordering, structured entity extraction, no prose
inference, and directed relation preservation. Pure data in/out only — no
Git, no SQLite, no filesystem.
"""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest


def _load(name, rel):
    spec = importlib.util.spec_from_file_location(name, rel)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


state_mod = _load(
    "coc_history_projection_state",
    "plugins/coc-keeper/scripts/coc_history_projection_state.py",
)
schema_mod = _load(
    "coc_history_projection_schema",
    "plugins/coc-keeper/scripts/coc_history_projection_schema.py",
)


def _commit(files, sha="c0ffee", campaign_id="amaranthine-16",
            timeline_id="tl-main", turn_number=None):
    return {
        "sha": sha,
        "campaign_id": campaign_id,
        "timeline_id": timeline_id,
        "turn_number": turn_number,
        "commit_type": "turn",
        "parents": [],
        "tree_digest": "tree-1",
        "files": [
            {"path": path, "blob_sha": f"blob-{index}", "text": text}
            for index, (path, text) in enumerate(files)
        ],
    }


def _dump(value):
    return json.dumps(value, ensure_ascii=False)


# --------------------------------------------------------------------------- #
# flatten_json
# --------------------------------------------------------------------------- #

class TestFlattenJson:
    def test_nested_dict_and_list_pointers(self):
        value = {
            "world": {"clocks": [{"clock_id": "clock-doom", "progress": 3}, {"clock_id": "clock-hope", "progress": 0}]},
            "turn": 4,
            "meta": None,
        }
        leaves = state_mod.flatten_json(value)
        assert leaves == {
            "/meta": None,
            "/turn": 4,
            "/world/clocks/0/clock_id": "clock-doom",
            "/world/clocks/0/progress": 3,
            "/world/clocks/1/clock_id": "clock-hope",
            "/world/clocks/1/progress": 0,
        }
        assert list(leaves) == sorted(leaves)

    def test_pointer_token_escaping(self):
        value = {"a/b~c": 1, "plain": 2}
        leaves = state_mod.flatten_json(value)
        assert leaves == {"/a~1b~0c": 1, "/plain": 2}

    def test_scalar_root_and_empty_containers(self):
        assert state_mod.flatten_json(5) == {"": 5}
        assert state_mod.flatten_json("x") == {"": "x"}
        assert state_mod.flatten_json(None) == {"": None}
        assert state_mod.flatten_json({}) == {}
        assert state_mod.flatten_json([]) == {}
        assert state_mod.flatten_json({"a": [], "b": {}}) == {}

    def test_key_order_independent(self):
        left = state_mod.flatten_json(json.loads('{"b": 1, "a": {"y": 2, "x": 3}}'))
        right = state_mod.flatten_json(json.loads('{"a": {"x": 3, "y": 2}, "b": 1}'))
        assert left == right
        assert list(left) == list(right)

    def test_deep_nesting_no_recursion_limit(self):
        value = 0
        for _ in range(20_000):
            value = {"n": value}
        leaves = state_mod.flatten_json(value)
        assert len(leaves) == 1
        assert leaves["/" + "/".join(["n"] * 20_000)] == 0

    def test_custom_pointer_prefix(self):
        leaves = state_mod.flatten_json({"a": 1}, pointer="")
        assert leaves == {"/a": 1}
        leaves = state_mod.flatten_json({"a": 1}, pointer="/base")
        assert leaves == {"/base/a": 1}


# --------------------------------------------------------------------------- #
# Path scoping
# --------------------------------------------------------------------------- #

class TestPathScope:
    def test_only_state_files_become_snapshots(self):
        commit = _commit([
            ("campaign.json", _dump({"campaign_id": "amaranthine-16"})),
            ("party.json", _dump({"members": []})),
            ("save/world-state.json", _dump({"era": 1925})),
            ("save/investigator-state/inv-elda-talon.json", _dump({"hp": 10})),
            ("logs/turn-finalizations.jsonl", "{}\n"),
            ("memory/index.json", _dump({"v": 1})),
            ("notes.txt", "hello"),
            ("scenario/binding.json", _dump({"x": 1})),
        ])
        result = state_mod.extract_state(commit)
        assert [s["path"] for s in result["snapshots"]] == [
            "campaign.json",
            "party.json",
            "save/investigator-state/inv-elda-talon.json",
            "save/world-state.json",
        ]

    def test_ignore_face_save_paths_excluded(self):
        commit = _commit([
            ("save/session-state.json", _dump({"a": 1})),
            ("save/toolbox-ledger.json", _dump({"a": 1})),
            ("save/roll-operation-receipts.json", _dump({"a": 1})),
            ("save/timeline-state.json", _dump({"a": 1})),
            ("save/run-identity.lock", "x"),
            ("save/commit-snapshots/deep/thing.json", _dump({"a": 1})),
            ("save/development-settlements/settle.json", _dump({"a": 1})),
            ("save/real.json", _dump({"a": 1})),
        ])
        result = state_mod.extract_state(commit)
        assert [s["path"] for s in result["snapshots"]] == ["save/real.json"]

    def test_is_state_path_contract(self):
        assert state_mod.is_state_path("campaign.json")
        assert state_mod.is_state_path("party.json")
        assert state_mod.is_state_path("save/x.json")
        assert state_mod.is_state_path("save/a/b/c.json")
        assert not state_mod.is_state_path("logs/turn-finalizations.jsonl")
        assert not state_mod.is_state_path("memory/index.json")
        assert not state_mod.is_state_path("save/session-state.json")
        assert not state_mod.is_state_path("save/commit-snapshots/x.json")
        assert not state_mod.is_state_path("scenario/party.json")
        assert not state_mod.is_state_path("")
        assert not state_mod.is_state_path(None)


# --------------------------------------------------------------------------- #
# Snapshots and canonical content
# --------------------------------------------------------------------------- #

class TestSnapshots:
    def test_snapshot_row_matches_state_snapshots_columns(self):
        commit = _commit([("save/world-state.json", '{"b": 2, "a": 1}')])
        result = state_mod.extract_state(commit)
        snapshot = result["snapshots"][0]
        assert set(snapshot) == {
            "commit_sha", "path", "snapshot_json", "snapshot_sha256",
        }
        assert snapshot["snapshot_json"] == '{"a":1,"b":2}'
        assert snapshot["snapshot_sha256"] == state_mod.canonical_digest(
            '{"a":1,"b":2}'
        )
        assert snapshot["commit_sha"] == "c0ffee"

    def test_commit_sha_carried_to_every_row_kind(self):
        content = {"npc_id": "npc-b", "edges": {"e": {"from_npc_id": "npc-b", "to_scene_id": "scene-hallway"}}}
        commit = _commit([("save/x.json", _dump(content))], sha="abc123", turn_number=7)
        result = state_mod.extract_state(commit)
        assert result["snapshots"][0]["commit_sha"] == "abc123"
        assert all(c["commit_sha"] == "abc123" for c in result["changes"])
        assert all(e["first_commit_sha"] == "abc123" for e in result["entities"])
        assert all(r["commit_sha"] == "abc123" for r in result["relations"])

    def test_duplicate_path_processed_once(self):
        commit = _commit([
            ("save/a.json", '{"v": 1}'),
            ("save/a.json", '{"v": 2}'),
        ])
        result = state_mod.extract_state(commit)
        assert len(result["snapshots"]) == 1
        assert result["snapshots"][0]["snapshot_json"] == '{"v":1}'

    def test_malformed_state_json_raises(self):
        commit = _commit([("save/broken.json", "{not json")])
        with pytest.raises(ValueError, match="save/broken.json"):
            state_mod.extract_state(commit)

    def test_malformed_commit_record_raises(self):
        with pytest.raises(ValueError):
            state_mod.extract_state({"files": []})
        with pytest.raises(ValueError):
            state_mod.extract_state({
                "sha": "a", "campaign_id": "c", "timeline_id": "t", "files": "nope",
            })
        with pytest.raises(ValueError):
            state_mod.extract_state({
                "sha": "a", "campaign_id": "c", "timeline_id": "t",
                "turn_number": True, "files": [],
            })


# --------------------------------------------------------------------------- #
# Leaf-level changes
# --------------------------------------------------------------------------- #

class TestChanges:
    def _decoded(self, result):
        return [
            (c["path"], c["pointer"], json.loads(c["change_json"]))
            for c in result["changes"]
        ]

    def test_change_rows_match_state_changes_columns(self):
        commit = _commit([("save/world-state.json", '{"era": 1925}')])
        result = state_mod.extract_state(commit)
        row = result["changes"][0]
        assert set(row) == {"commit_sha", "path", "pointer", "change_json"}
        assert row["commit_sha"] == "c0ffee"
        assert json.loads(row["change_json"]) == {
            "change_type": "add",
            "old_value_json": None,
            "new_value_json": "1925",
        }

    def test_new_path_all_additions(self):
        commit = _commit([("save/world-state.json", '{"era": 1925, "hp": {"max": 12}}')])
        result = state_mod.extract_state(commit)
        assert self._decoded(result) == [
            ("save/world-state.json", "/era", {"change_type": "add", "old_value_json": None, "new_value_json": "1925"}),
            ("save/world-state.json", "/hp/max", {"change_type": "add", "old_value_json": None, "new_value_json": "12"}),
        ]

    def test_add_remove_replace(self):
        before = {"keep": 1, "drop": 2, "change": 3}
        after = {"keep": 1, "change": 4, "fresh": 5}
        previous = {"save/s.json": {"snapshot_json": state_mod.canonical_json_text(before)}}
        commit = _commit([("save/s.json", _dump(after))])
        result = state_mod.extract_state(commit, previous)
        rows = [(p, d["change_type"], d["old_value_json"], d["new_value_json"]) for _, p, d in self._decoded(result)]
        assert rows == [
            ("/change", "replace", "3", "4"),
            ("/drop", "remove", "2", None),
            ("/fresh", "add", None, "5"),
        ]

    def test_nested_and_list_diffs(self):
        before = {"investigator": {"skills": ["dodge", "listen"]}, "hp": 10, "tags": {"a": 1}}
        after = {"investigator": {"skills": ["dodge", "spot_hidden"]}, "hp": {"current": 9, "max": 10}, "tags": {}}
        previous = {"save/i.json": {"snapshot_json": state_mod.canonical_json_text(before)}}
        commit = _commit([("save/i.json", _dump(after))])
        result = state_mod.extract_state(commit, previous)
        rows = {(p, d["change_type"]): (d["old_value_json"], d["new_value_json"]) for _, p, d in self._decoded(result)}
        # list element replaced at its index
        assert rows[("/investigator/skills/1", "replace")] == ('"listen"', '"spot_hidden"')
        # scalar became object: removal of the scalar leaf, additions inside
        assert rows[("/hp", "remove")] == ("10", None)
        assert rows[("/hp/current", "add")] == (None, "9")
        assert rows[("/hp/max", "add")] == (None, "10")
        # tags/a leaf removed because the object became empty
        assert rows[("/tags/a", "remove")] == ("1", None)

    def test_identical_content_fast_path_no_changes(self):
        content = {"era": 1925, "npcs": [{"npc_id": "npc-walter"}]}
        snapshot_json = state_mod.canonical_json_text(content)
        previous = {
            "save/world-state.json": {
                "snapshot_json": snapshot_json,
                "snapshot_sha256": state_mod.canonical_digest(snapshot_json),
            },
        }
        commit = _commit([("save/world-state.json", _dump(content))])
        result = state_mod.extract_state(commit, previous)
        assert result["changes"] == []
        # snapshot is still emitted for the commit
        assert len(result["snapshots"]) == 1

    def test_previous_leaves_raw_values_accepted(self):
        previous = {"save/s.json": {"leaves": {"/x": 1, "/y": [1]}}}
        commit = _commit([("save/s.json", '{"x": 2}')])
        result = state_mod.extract_state(commit, previous)
        rows = sorted(
            (p, d["change_type"], d["old_value_json"], d["new_value_json"])
            for _, p, d in self._decoded(result)
        )
        assert rows == [
            ("/x", "replace", "1", "2"),
            ("/y", "remove", "[1]", None),
        ]

    def test_other_paths_previous_ignored(self):
        previous = {"save/other.json": {"snapshot_json": '{"a":1}'}}
        commit = _commit([("save/s.json", '{"a": 1}')])
        result = state_mod.extract_state(commit, previous)
        # new path: all additions despite unrelated previous entry
        assert all(json.loads(c["change_json"])["change_type"] == "add" for c in result["changes"])

    def test_scalar_and_null_leaf_values(self):
        previous = {"save/s.json": {"snapshot_json": '{"flag": null, "n": 1.5}'}}
        commit = _commit([("save/s.json", '{"flag": true, "n": 1.5}')])
        result = state_mod.extract_state(commit, previous)
        assert len(result["changes"]) == 1
        assert result["changes"][0]["pointer"] == "/flag"
        decoded = json.loads(result["changes"][0]["change_json"])
        assert decoded["old_value_json"] == "null"
        assert decoded["new_value_json"] == "true"


# --------------------------------------------------------------------------- #
# Entities (structured fields only, no prose inference)
# --------------------------------------------------------------------------- #

class TestEntities:
    def test_entity_rows_match_entities_columns(self):
        content = {"npc_id": "npc-b", "investigator_id": "inv-a"}
        commit = _commit([("save/x.json", _dump(content))], sha="s1", turn_number=3)
        rows = state_mod.extract_state(commit)["entities"]
        assert all(set(r) == {"entity_id", "entity_type", "first_commit_sha", "last_commit_sha"} for r in rows)
        assert rows == [
            {"entity_id": "inv-a", "entity_type": "investigator", "first_commit_sha": "s1", "last_commit_sha": "s1"},
            {"entity_id": "npc-b", "entity_type": "npc", "first_commit_sha": "s1", "last_commit_sha": "s1"},
        ]

    def test_entity_types_from_structured_fields(self):
        content = {
            "investigator_id": "inv-elda-talon",
            "npcs": [{"npc_id": "npc-walter-corbitt"}],
            "quests": [{"quest_id": "quest-haunting-v1", "clue_id": "clue-diary"}],
            "scene_id": "scene-hallway",
            "effects": [{"effect_id": "effect-bleed"}],
            "items": [{"item_id": "item-revolver"}],
            "rolls": [{"roll_id": "roll-san-1"}],
            "flags": [{"flag_id": "flag-met-cultist"}],
            "clocks": [{"clock_id": "clock-doom"}],
        }
        commit = _commit([("save/world-state.json", _dump(content))])
        result = state_mod.extract_state(commit)
        got = {(e["entity_type"], e["entity_id"]) for e in result["entities"]}
        assert got == {
            ("investigator", "inv-elda-talon"),
            ("npc", "npc-walter-corbitt"),
            ("quest", "quest-haunting-v1"),
            ("clue", "clue-diary"),
            ("scene", "scene-hallway"),
            ("effect", "effect-bleed"),
            ("item", "item-revolver"),
            ("roll", "roll-san-1"),
            ("flag", "flag-met-cultist"),
            ("clock", "clock-doom"),
        }

    def test_dedupe_across_files(self):
        commit = _commit([
            ("campaign.json", '{"investigator_id": "inv-elda-talon"}'),
            ("save/investigator-state/inv-elda-talon.json", '{"investigator_id": "inv-elda-talon"}'),
            ("save/party.json", '{"investigator_id": "inv-elda-talon"}'),
        ])
        result = state_mod.extract_state(commit)
        assert len(result["entities"]) == 1
        entity = result["entities"][0]
        assert entity["entity_type"] == "investigator"
        assert entity["entity_id"] == "inv-elda-talon"
        assert entity["first_commit_sha"] == entity["last_commit_sha"] == "c0ffee"

    def test_no_prose_inference(self):
        content = {
            "narration": "Walter the npc-walter-corbitt laughs; quest quest-haunting-v1 stirs.",
            "npc_name": "Walter Corbitt",
            "notes": {"diary": "mentions clue-clue-diary and scene-hallway"},
            "source_npc_ids": ["npc-not-extracted"],
            "investigator_id": "",
            "npc_id": 42,
        }
        commit = _commit([("save/world-state.json", _dump(content))])
        result = state_mod.extract_state(commit)
        assert result["entities"] == []

    def test_entities_sorted(self):
        content = {"npc_id": "npc-b", "investigator_id": "inv-a"}
        commit = _commit([("save/x.json", _dump(content))], sha="s1", turn_number=3)
        result = state_mod.extract_state(commit)
        keys = [(e["entity_type"], e["entity_id"]) for e in result["entities"]]
        assert keys == sorted(keys) == [("investigator", "inv-a"), ("npc", "npc-b")]
        assert all(e["first_commit_sha"] == "s1" == e["last_commit_sha"] for e in result["entities"])


# --------------------------------------------------------------------------- #
# Relations (explicit directed structure only, no name matching)
# --------------------------------------------------------------------------- #

class TestRelations:
    _RELATION_COLUMNS = {
        "commit_sha", "path", "pointer", "from_entity_kind", "from_entity_id",
        "to_entity_kind", "to_entity_id", "relation_kind",
    }

    def test_relation_rows_match_relations_columns(self):
        content = {
            "contacts": {
                "pair-1": {
                    "from_investigator_id": "inv-elda-talon",
                    "to_npc_id": "npc-walter-corbitt",
                    "relation": "first_contact",
                    "roll_id": "roll-sanity-3",
                },
            },
        }
        commit = _commit([("save/npc-contacts.json", _dump(content))])
        result = state_mod.extract_state(commit)
        assert len(result["relations"]) == 1
        row = result["relations"][0]
        assert set(row) == self._RELATION_COLUMNS
        assert row["commit_sha"] == "c0ffee"
        assert row["from_entity_kind"] == "investigator"
        assert row["from_entity_id"] == "inv-elda-talon"
        assert row["to_entity_kind"] == "npc"
        assert row["to_entity_id"] == "npc-walter-corbitt"
        assert row["relation_kind"] == "first_contact"
        assert row["path"] == "save/npc-contacts.json"
        assert row["pointer"] == "/contacts/pair-1"
        # endpoints registered as entities too
        refs = {(e["entity_type"], e["entity_id"]) for e in result["entities"]}
        assert ("investigator", "inv-elda-talon") in refs
        assert ("npc", "npc-walter-corbitt") in refs

    def test_direction_not_reversed(self):
        content = {"edge": {"from_npc_id": "npc-a", "to_scene_id": "scene-cellar"}}
        commit = _commit([("save/edges.json", _dump(content))])
        row = state_mod.extract_state(commit)["relations"][0]
        assert (row["from_entity_kind"], row["from_entity_id"]) == ("npc", "npc-a")
        assert (row["to_entity_kind"], row["to_entity_id"]) == ("scene", "scene-cellar")

    def test_identical_endpoints_different_pointers_not_collapsed(self):
        content = {
            "bonds": {
                "b1": {"from_investigator_id": "inv-a", "to_npc_id": "npc-b", "relation": "bond"},
                "b2": {"from_investigator_id": "inv-a", "to_npc_id": "npc-b", "relation": "bond"},
                "b3": {"from_investigator_id": "inv-a", "to_npc_id": "npc-b", "relation": "bond"},
            },
        }
        commit = _commit([("save/bonds.json", _dump(content))])
        rows = state_mod.extract_state(commit)["relations"]
        # three explicit source relations with identical endpoints and kind
        assert len(rows) == 3
        assert {r["pointer"] for r in rows} == {"/bonds/b1", "/bonds/b2", "/bonds/b3"}
        assert len({(r["from_entity_id"], r["to_entity_id"], r["relation_kind"]) for r in rows}) == 1

    def test_reversed_direction_kept_as_separate_row(self):
        content = {
            "edges": [
                {"from_npc_id": "npc-a", "to_scene_id": "scene-cellar"},
                {"from_scene_id": "scene-cellar", "to_npc_id": "npc-a"},
            ],
        }
        commit = _commit([("save/edges.json", _dump(content))])
        rows = state_mod.extract_state(commit)["relations"]
        assert len(rows) == 2
        assert rows[0]["from_entity_kind"] == "npc"
        assert rows[1]["from_entity_kind"] == "scene"

    def test_relationship_object_under_parent_key(self):
        content = {
            "relationships": [
                {"investigator_id": "inv-elda-talon", "npc_id": "npc-walter-corbitt"},
            ],
        }
        commit = _commit([("campaign.json", _dump(content))])
        result = state_mod.extract_state(commit)
        assert len(result["relations"]) == 1
        row = result["relations"][0]
        assert row["from_entity_kind"] == "investigator"
        assert row["to_entity_kind"] == "npc"
        assert row["relation_kind"] == ""
        assert row["pointer"] == "/relationships/0"

    def test_relationship_object_with_kind_marker_anywhere(self):
        content = {
            "bonds": {
                "b1": {"investigator_id": "inv-a", "npc_id": "npc-b", "relation": "ally"},
            },
        }
        commit = _commit([("party.json", _dump(content))])
        row = state_mod.extract_state(commit)["relations"][0]
        assert row["relation_kind"] == "ally"
        assert row["from_entity_id"] == "inv-a"
        assert row["to_entity_id"] == "npc-b"

    def test_no_name_matching(self):
        content = {
            "edges": {
                "e1": {"from_name": "Walter Corbitt", "to_name": "Elda Talon"},
                "e2": {"from_id": "npc-walter", "to_id": "scene-cellar"},
            },
        }
        commit = _commit([("save/edges.json", _dump(content))])
        assert state_mod.extract_state(commit)["relations"] == []

    def test_two_entity_fields_without_marker_or_parent_no_relation(self):
        content = {
            "receipt": {"investigator_id": "inv-a", "npc_id": "npc-b", "decision_id": "d1"},
        }
        commit = _commit([("save/receipts.json", _dump(content))])
        assert state_mod.extract_state(commit)["relations"] == []

    def test_ambiguous_from_to_pairs_skipped(self):
        content = {
            "edge": {"from_npc_id": "npc-a", "from_scene_id": "scene-x", "to_npc_id": "npc-b"},
        }
        commit = _commit([("save/edges.json", _dump(content))])
        assert state_mod.extract_state(commit)["relations"] == []

    def test_multiple_rows_sorted(self):
        content = {
            "edges": {
                "z": {"from_npc_id": "npc-z", "to_scene_id": "scene-a"},
                "a": {"from_investigator_id": "inv-a", "to_npc_id": "npc-a"},
            },
        }
        commit = _commit([("save/edges.json", _dump(content))])
        rows = state_mod.extract_state(commit)["relations"]
        assert [r["pointer"] for r in rows] == ["/edges/a", "/edges/z"]


# --------------------------------------------------------------------------- #
# Determinism
# --------------------------------------------------------------------------- #

class TestDeterminism:
    def _result(self):
        files = [
            ("campaign.json", '{"campaign_id": "c", "investigator_id": "inv-a"}'),
            ("save/world-state.json", json.dumps({
                "clocks": [{"clock_id": "clock-doom", "progress": 2}],
                "edges": [{"from_investigator_id": "inv-a", "to_npc_id": "npc-b", "relation": "bond"}],
            })),
            ("save/investigator-state/inv-a.json", '{"hp": 9, "npc_id": "npc-b"}'),
        ]
        return state_mod.extract_state(_commit(files))

    def test_stable_across_calls(self):
        assert self._result() == self._result()

    def test_stable_across_file_order_and_key_order(self):
        base = self._result()
        reordered = state_mod.extract_state(_commit([
            ("save/investigator-state/inv-a.json", '{"npc_id": "npc-b", "hp": 9}'),
            ("campaign.json", '{"investigator_id": "inv-a", "campaign_id": "c"}'),
            ("save/world-state.json", json.dumps({
                "edges": [{"relation": "bond", "to_npc_id": "npc-b", "from_investigator_id": "inv-a"}],
                "clocks": [{"progress": 2, "clock_id": "clock-doom"}],
            })),
        ]))
        assert base == reordered

    def test_lists_sorted_by_path(self):
        result = self._result()
        assert [s["path"] for s in result["snapshots"]] == sorted(s["path"] for s in result["snapshots"])
        assert [(c["path"], c["pointer"]) for c in result["changes"]] == sorted(
            (c["path"], c["pointer"]) for c in result["changes"]
        )
        keys = [(e["entity_type"], e["entity_id"]) for e in result["entities"]]
        assert keys == sorted(keys)


# --------------------------------------------------------------------------- #
# Insertion contract: extractor rows insert into the schema as-is
# --------------------------------------------------------------------------- #

_TABLE_FOR_KIND = {
    "snapshots": "state_snapshots",
    "changes": "state_changes",
    "entities": "entities",
    "relations": "relations",
}

_INSERT_SQL = {
    "state_snapshots": (
        "INSERT INTO state_snapshots (commit_sha, path, snapshot_json,"
        " snapshot_sha256) VALUES (:commit_sha, :path, :snapshot_json,"
        " :snapshot_sha256)"
    ),
    "state_changes": (
        "INSERT INTO state_changes (commit_sha, path, pointer, change_json)"
        " VALUES (:commit_sha, :path, :pointer, :change_json)"
    ),
    # Canonical mention fold: first mention wins, later mentions advance
    # last_commit_sha when the facade walks commits in ordinal order.
    "entities": (
        "INSERT INTO entities (entity_id, entity_type, first_commit_sha,"
        " last_commit_sha) VALUES (:entity_id, :entity_type, :first_commit_sha,"
        " :last_commit_sha) ON CONFLICT(entity_id, entity_type) DO UPDATE"
        " SET last_commit_sha = excluded.last_commit_sha"
    ),
    "relations": (
        "INSERT INTO relations (commit_sha, path, pointer, from_entity_kind,"
        " from_entity_id, to_entity_kind, to_entity_id, relation_kind)"
        " VALUES (:commit_sha, :path, :pointer, :from_entity_kind,"
        " :from_entity_id, :to_entity_kind, :to_entity_id, :relation_kind)"
    ),
}


class TestInsertionContract:
    """Every extractor row inserts directly into the schema — no facade
    translation, no invented fields — and the fold keeps provenance."""

    @staticmethod
    def _commit_sequence():
        bonds = {
            "b1": {"from_investigator_id": "inv-a", "to_npc_id": "npc-walter", "relation": "bond"},
            "b2": {"from_investigator_id": "inv-a", "to_npc_id": "npc-walter", "relation": "bond"},
        }
        return [
            _commit(
                [
                    ("campaign.json", '{"campaign_id": "c"}'),
                    ("save/world-state.json", _dump({"era": 1925, "bonds": bonds})),
                ],
                sha="c1",
            ),
            _commit(
                [("save/world-state.json", _dump({"era": 1926, "clock_id": "clock-doom", "bonds": bonds}))],
                sha="c2",
            ),
            _commit([("save/investigator-state/inv-a.json", '{"hp": 9}')], sha="c3"),
        ]

    @staticmethod
    def _extract_sequence():
        """Walk commits, feeding extractor snapshot rows back as previous
        state — the exact data the facade holds, with no translation."""
        results = []
        previous: dict = {}
        for record in TestInsertionContract._commit_sequence():
            result = state_mod.extract_state(record, previous)
            results.append(result)
            previous = {s["path"]: dict(s) for s in result["snapshots"]}
        return results

    def test_row_keys_exactly_match_table_columns(self, tmp_path):
        connection = schema_mod.create_projection_db(tmp_path / "proj.db")
        try:
            for result in self._extract_sequence():
                for kind, table in _TABLE_FOR_KIND.items():
                    columns = {
                        str(row[1])
                        for row in connection.execute(f'PRAGMA table_info("{table}")')
                    }
                    for row in result[kind]:
                        assert set(row) == columns, (table, sorted(row), sorted(columns))
        finally:
            connection.close()

    def test_direct_insertion_of_every_row(self, tmp_path):
        connection = schema_mod.create_projection_db(tmp_path / "proj.db")
        try:
            for result in self._extract_sequence():
                for kind, table in _TABLE_FOR_KIND.items():
                    for row in result[kind]:
                        connection.execute(_INSERT_SQL[table], row)
            connection.commit()

            snapshots = [
                tuple(row)
                for row in connection.execute(
                    "SELECT commit_sha, path FROM state_snapshots ORDER BY commit_sha, path"
                ).fetchall()
            ]
            assert snapshots == [
                ("c1", "campaign.json"),
                ("c1", "save/world-state.json"),
                ("c2", "save/world-state.json"),
                ("c3", "save/investigator-state/inv-a.json"),
            ]

            # leaf diff survived: era replace + clock add + new-path adds
            changes = {
                (row[0], row[1]): json.loads(row[2])
                for row in connection.execute(
                    "SELECT commit_sha, pointer, change_json FROM state_changes"
                )
            }
            assert changes[("c2", "/era")]["change_type"] == "replace"
            assert changes[("c2", "/era")]["old_value_json"] == "1925"
            assert changes[("c2", "/era")]["new_value_json"] == "1926"
            assert changes[("c2", "/clock_id")]["change_type"] == "add"
            assert changes[("c3", "/hp")]["change_type"] == "add"

            # mention fold: first mention sticks, last mention advances
            entities = {
                (row[0], row[1]): (row[2], row[3])
                for row in connection.execute(
                    "SELECT entity_id, entity_type, first_commit_sha,"
                    " last_commit_sha FROM entities"
                )
            }
            assert entities[("inv-a", "investigator")] == ("c1", "c2")
            assert entities[("npc-walter", "npc")] == ("c1", "c2")
            assert entities[("clock-doom", "clock")] == ("c2", "c2")

            # explicit source relations never collapse: identical endpoints
            # and kind survive once per (commit, pointer)
            relations = [
                tuple(row)
                for row in connection.execute(
                    "SELECT commit_sha, pointer FROM relations ORDER BY commit_sha, pointer"
                ).fetchall()
            ]
            assert relations == [
                ("c1", "/bonds/b1"),
                ("c1", "/bonds/b2"),
                ("c2", "/bonds/b1"),
                ("c2", "/bonds/b2"),
            ]
        finally:
            connection.close()

    def test_projection_digest_stable_for_inserted_state_rows(self, tmp_path):
        """The projection digest stays deterministic for state-table rows."""
        forward = schema_mod.create_projection_db(tmp_path / "forward.db")
        reverse = schema_mod.create_projection_db(tmp_path / "reverse.db")
        results = self._extract_sequence()
        try:
            for result in results:
                for kind, table in _TABLE_FOR_KIND.items():
                    for row in result[kind]:
                        forward.execute(_INSERT_SQL[table], row)
            forward.commit()
            for result in reversed(results):
                for kind in ("snapshots", "changes", "relations"):
                    for row in result[kind]:
                        reverse.execute(_INSERT_SQL[_TABLE_FOR_KIND[kind]], row)
            # entities last, fold order is what matters, not insertion order
            for result in results:
                for row in result["entities"]:
                    reverse.execute(_INSERT_SQL["entities"], row)
            reverse.commit()
            assert (
                schema_mod.projection_digest(forward)
                == schema_mod.projection_digest(reverse)
            )
        finally:
            forward.close()
            reverse.close()


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-q"]))
