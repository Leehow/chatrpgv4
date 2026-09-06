"""A book's pregenerated investigators are reference: lookup labels them and ranks them
after the people who are actually in the module (the keeper once took one for the player)."""

import json
import sys

from conftest import CONTENT_DIR as CONTENT, WORKTREE

sys.path.insert(0, str(WORKTREE / "kernel"))
from coc.module_graph import ModuleGraph  # noqa: E402 - the kernel package lives under kernel/


def test_investigator_templates_rank_last_and_carry_the_note(tmp_path):
    graph = json.loads((CONTENT / "starters" / "the-haunting" / "module-graph.json").read_text(encoding="utf-8"))
    graph["nodes"].append({"node_id": "investigator-template-knott-hunter", "node_kind": "investigator-template",
                           "name": "Knott Hunter", "visibility": "keeper-only", "aliases": [],
                           "summary": "a pregenerated investigator printed in the book", "evidence_span_ids": [],
                           "properties": {}})
    path = tmp_path / "module-graph.json"
    path.write_text(json.dumps(graph, ensure_ascii=False), encoding="utf-8")
    loaded = ModuleGraph("the-haunting", path)
    hits = loaded.search("Knott", limit=50)
    kinds = [n["node_kind"] for n in hits]
    assert "investigator-template" in kinds and kinds[-1] == "investigator-template"
    assert kinds.index("npc") < kinds.index("investigator-template")
    template = next(n for n in hits if n["node_kind"] == "investigator-template")
    assert "本桌" in loaded.describe(template)["note"] and "本桌" in loaded.entity_view(template)["note"]
    assert "note" not in loaded.describe(next(n for n in hits if n["node_kind"] == "npc"))


def test_play_order_relations_are_exits_at_the_table(tmp_path):
    """A built book links scenes by play-precedes / may-lead-to; the runtime must open those
    doors, or the keeper narrates the journey without a move (turn 3 of toomany-s4)."""
    graph = json.loads((CONTENT / "starters" / "the-haunting" / "module-graph.json").read_text(encoding="utf-8"))
    graph["nodes"].append({"node_id": "scene-road-north", "node_kind": "scene", "name": "The Road North",
                           "visibility": "player-safe", "aliases": [], "summary": "two days on the road",
                           "evidence_span_ids": [], "properties": {}})
    start = next(n for n in graph["nodes"] if n["node_id"].startswith("scene-") and "commission" in n["node_id"])
    graph["relations"].append({"relation_id": "relation-test-play-precedes", "relation_kind": "play-precedes",
                               "from_node_id": start["node_id"], "to_node_id": "scene-road-north", "claim_id": None,
                               "properties": {}})
    path = tmp_path / "module-graph.json"
    path.write_text(json.dumps(graph, ensure_ascii=False), encoding="utf-8")
    loaded = ModuleGraph("the-haunting", path)
    exits = loaded.scene_exits(loaded.scene(start["node_id"]))
    road = next((e for e in exits if e["to"] == "road-north"), None)
    assert road is not None and road.get("via") == "play-precedes"
