"""Graph -> skeleton -> seven IR, on the shard read out of a real module.

The fixture is the whole-book GraphShard extracted from
《他们也没想太多》's twenty pages. Before that extraction existed the same
book compiled to one location named after the book, zero NPCs and zero clues,
so these numbers are the difference between reading a module and not.
"""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import sys

import pytest

REPO = Path(__file__).resolve().parents[1]
SCRIPTS = REPO / "plugins" / "coc-keeper" / "scripts"
SHARD = REPO / "tests" / "fixtures" / "module-graph" / (
    "they-did-not-think-it-too-many.shard.json"
)

sys.path.insert(0, str(SCRIPTS))
import coc_module_assets  # noqa: E402
import coc_module_graph_projection as projection  # noqa: E402
import coc_module_project  # noqa: E402
import coc_module_reachability  # noqa: E402


def _graph() -> dict:
    """The shard, read as a graph: one section merges to itself."""
    shard = json.loads(SHARD.read_text(encoding="utf-8"))
    return {
        "module_id": shard["module_id"],
        "nodes": shard["nodes"],
        "claims": shard["claims"],
        "relations": shard["relations"],
    }


def _skeleton() -> dict:
    return projection.project_graph_to_skeleton(
        _graph(),
        source_id="pdf:they-did-not-think-it-too-many",
        file_sha256="8" * 64,
        page_count=20,
    )


def test_the_projected_skeleton_satisfies_the_asset_contract() -> None:
    assert coc_module_assets.validate_skeleton(_skeleton()) == []


def test_the_graph_carries_the_book_not_its_title() -> None:
    skeleton = _skeleton()
    assert len(skeleton["locations"]) >= 8
    assert len(skeleton["npc_roster"]) >= 8
    # One entrance, read off the topology rather than declared.
    assert len(skeleton["start_candidates"]) == 1
    assert skeleton["start_candidates"] == ["scene-mission-start"]


def test_every_projected_record_cites_a_page() -> None:
    """A record without provenance is indistinguishable from an invented one."""
    skeleton = _skeleton()
    for collection in ("locations", "npc_roster", "conclusion_buckets"):
        for row in skeleton[collection]:
            refs = row.get("source_refs") or []
            assert refs, f"{collection} row {row} cites no page"
            for ref in refs:
                assert ref["source_id"] == "pdf:they-did-not-think-it-too-many"
                assert 0 <= ref["pdf_index"] < 20


def test_the_seven_ir_files_carry_scenes_npcs_and_placed_clues() -> None:
    ir = coc_module_project.project_skeleton_to_ir(_skeleton())
    assert len(ir["story-graph.json"]["scenes"]) >= 8
    assert len(ir["npc-agendas.json"]["npcs"]) >= 8

    conclusions = ir["clue-graph.json"]["conclusions"]
    assert conclusions, "the graph declares a conclusion"
    # `clues: []` was hardcoded here for Tier-1 topology skeletons. A graph
    # carries clues, and dropping them would ship every conclusion unreachable
    # while the artifact upstream said it was supported.
    assert any(len(c["clues"]) >= 1 for c in conclusions)
    for conclusion in conclusions:
        for clue in conclusion["clues"]:
            assert clue["source_refs"], f"clue {clue['clue_id']} cites no page"
            assert clue["scene_ids"], f"clue {clue['clue_id']} is placed nowhere"


def test_clue_placement_reaches_both_of_its_readers() -> None:
    """The lint asks scenes; the runtime asks conclusions. Both must be fed."""
    ir = coc_module_project.project_skeleton_to_ir(_skeleton())
    placed_in_scenes = {
        clue_id
        for scene in ir["story-graph.json"]["scenes"]
        for clue_id in scene.get("available_clues") or []
    }
    from_conclusions = {
        clue["clue_id"]
        for conclusion in ir["clue-graph.json"]["conclusions"]
        for clue in conclusion["clues"]
    }
    assert from_conclusions
    assert from_conclusions <= placed_in_scenes


def test_the_projected_scenario_passes_the_reachability_lint(tmp_path: Path) -> None:
    ir = coc_module_project.project_skeleton_to_ir(_skeleton())
    scenario_dir = tmp_path / "scenario"
    scenario_dir.mkdir()
    for name, document in ir.items():
        (scenario_dir / name).write_text(
            json.dumps(document, ensure_ascii=False), encoding="utf-8",
        )
    report = coc_module_reachability.lint_scenario_dir(scenario_dir)
    assert (report.get("findings") or []) == []


def test_the_era_comes_from_the_graph_or_not_at_all() -> None:
    """`normalize_era` defaults the unrecognised to 1920s; this must not feed it.

    A Roman module was once recorded as the 1920s that way. The era is a
    canonical key on a temporal-frame node, chosen by whoever read the page,
    and a graph without one leaves the field out rather than guessing.
    """
    assert _skeleton()["module_identity"]["era"] == "roman"

    graph = _graph()
    graph["nodes"] = [
        node for node in graph["nodes"] if node["node_kind"] != "temporal-frame"
    ]
    bare = projection.project_graph_to_skeleton(
        graph,
        source_id="pdf:they-did-not-think-it-too-many",
        file_sha256="8" * 64,
        page_count=20,
    )
    assert "era" not in bare["module_identity"]


def test_a_graph_with_no_scene_is_refused() -> None:
    with pytest.raises(projection.ProjectionError):
        projection.project_graph_to_skeleton(
            {"module_id": "empty", "nodes": [], "claims": [], "relations": []},
            source_id="pdf:empty", file_sha256="8" * 64, page_count=1,
        )


def test_activation_uses_the_graph_entrance_not_array_order(tmp_path: Path) -> None:
    """The Director reads world-state, and a null scene means it reads nothing.

    A campaign left at `active_scene_id: null` cannot resolve a scene, so the
    Keeper narrates outside the graph entirely -- on 2026-09-03 that produced a
    church spire in Britain in AD 80 while twelve scenes sat unused. The
    starter path activates `scenes[0]`, which is array order; a graph names its
    entrance by topology, and that is what activation must follow.
    """
    campaign = tmp_path / "campaign"
    (campaign / "scenario").mkdir(parents=True)
    (campaign / "save").mkdir()
    ir = coc_module_project.project_skeleton_to_ir(_skeleton())
    story = ir["story-graph.json"]
    entrance = next(s["scene_id"] for s in story["scenes"] if s.get("is_start"))
    # Put the entrance last, so array order and topology disagree. Reading
    # `scenes[0]` would pass on the natural ordering and prove nothing.
    story["scenes"] = (
        [s for s in story["scenes"] if not s.get("is_start")]
        + [s for s in story["scenes"] if s.get("is_start")]
    )
    assert story["scenes"][0]["scene_id"] != entrance
    (campaign / "scenario" / "story-graph.json").write_text(
        json.dumps(story, ensure_ascii=False), encoding="utf-8",
    )

    started = projection.activate_graph_scenario(campaign, "probe-scenario")
    assert started == entrance
    world = json.loads(
        (campaign / "save" / "world-state.json").read_text(encoding="utf-8")
    )
    assert world["active_scene_id"] == entrance
    assert world["status"] == "active"
    assert world["active_subsystem"] == "play"
    assert entrance in world["visited_scene_ids"]
