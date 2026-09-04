"""Joining what no section reader could see.

A reader given four pages cannot write the exit from its own last scene into a
chapter it never received -- not for want of care; it has no way to name the
other end. That is why chunking left a scene graph in eight pieces while every
section passed every gate, and it is the one hole the per-section gates are
structurally unable to notice.

The patch is a shard like any other: same contract, same three gates, same
merge. What makes it different is only its pages, which are the whole book.
"""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "plugins" / "coc-keeper" / "scripts"
sys.path.insert(0, str(SCRIPTS))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import module_build_fixtures as fixtures  # noqa: E402

_spec = importlib.util.spec_from_file_location(
    "coc_module_build_stitch", SCRIPTS / "coc_module_build.py"
)
build = importlib.util.module_from_spec(_spec)
sys.modules["coc_module_build_stitch"] = build
_spec.loader.exec_module(build)


@pytest.fixture
def work(tmp_path: Path) -> Path:
    w = tmp_path / "w"
    w.mkdir()
    merged = {
        "nodes": [
            {"node_id": "scene-a", "node_kind": "scene", "name": "神殿",
             "summary": "调查员进入神殿。", "evidence_span_ids": ["span-page-3-block-1"]},
            {"node_id": "scene-b", "node_kind": "scene", "name": "城门",
             "summary": "城门口的守卫。", "evidence_span_ids": ["span-page-9-block-2"]},
        ],
        "relations": [],
    }
    (w / "module-graph.json").write_text(json.dumps(merged), encoding="utf-8")
    return w


def _assembly(status="assembled_not_playable"):
    return {"status": status, "findings": [
        {"code": "scene_graph_fragmented", "subject": "scene-b",
         "message": "The scene graph is one piece.",
         "detail": "1 scene(s) joined to no exit chain: scene-b"},
    ]}


def test_a_playable_graph_is_not_stitched(work, monkeypatch):
    """Nothing to join is not a reason to spend a generation looking."""
    monkeypatch.setattr(build.extract, "prepare", lambda *a, **k: pytest.fail(
        "a whole-book packet was prepared for a graph with no holes"))
    out = build.stitch_graph(
        work, work, "mod", lambda work_dir, brief: None,
        {"status": "assembled", "findings": []},
    )
    assert out["status"] == "nothing_to_stitch"


def test_the_stitcher_is_handed_the_holes_and_the_shape(work, monkeypatch):
    seen: dict[str, object] = {}

    def agent(work_dir, brief):
        seen["brief"] = brief
        seen["findings"] = json.loads(
            (Path(work_dir) / "graph-findings.json").read_text())
        seen["view"] = json.loads(
            (Path(work_dir) / "graph-view.json").read_text())

    monkeypatch.setattr(build.extract, "prepare", lambda *a, **k: {"span_count": 9})
    build.stitch_graph(work, work, "mod", agent, _assembly(), max_rounds=1)

    assert seen["findings"][0]["code"] == "scene_graph_fragmented"
    view = seen["view"]
    assert {n["node_id"] for n in view["nodes"]} == {"scene-a", "scene-b"}
    # Pages, because the stitcher's next move is to read around them.
    assert [n["pages"] for n in view["nodes"]] == [[3], [9]]
    assert "search" in seen["brief"] and "verify" in seen["brief"]
    assert "没有证据就不要连" in seen["brief"]


def test_the_view_is_the_shape_not_the_graph(work):
    """A stitcher handed the whole graph spends its context on stat blocks."""
    view = build._graph_view({
        "nodes": [{"node_id": "npc-a", "node_kind": "npc", "name": "克洛普",
                   "summary": "很" * 400, "evidence_span_ids": ["span-page-2-block-1"],
                   "properties": {"STR": 90, "HP": 14}}],
        "relations": [{"relation_kind": "present-in", "from_node_id": "npc-a",
                       "to_node_id": "scene-a", "claim_id": "claim-x",
                       "properties": {}}],
    })
    assert len(view["nodes"][0]["summary"]) == 180
    assert "properties" not in view["nodes"][0]
    assert view["relations"] == [
        {"kind": "present-in", "from": "npc-a", "to": "scene-a"}]


def test_a_patch_is_judged_by_the_same_gates(work, monkeypatch):
    """"These two scenes ought to connect" is not evidence. The patch goes
    through the contract and the grounding gate exactly as a section does."""
    def agent(work_dir, brief):
        (Path(work_dir) / build.PATCH_NAME).write_text(
            json.dumps({"claims": []}), encoding="utf-8")

    monkeypatch.setattr(build.extract, "prepare", lambda *a, **k: {"span_count": 9})
    monkeypatch.setattr(build.extract, "review", lambda work_dir, patch: {
        "status": "findings", "gate": "grounding", "finding_count": 1,
        "findings": [{"code": "name-not-on-cited-pages", "path": "/claims/0",
                      "message": "the span this claim cites does not say so"}],
    })
    out = build.stitch_graph(work, work, "mod", agent, _assembly(), max_rounds=1)
    assert out["status"] == "not_accepted"
    assert out["findings"][0]["code"] == "name-not-on-cited-pages"


def test_a_stitcher_that_writes_nothing_is_reported(work, monkeypatch):
    monkeypatch.setattr(build.extract, "prepare", lambda *a, **k: {"span_count": 9})
    out = build.stitch_graph(work, work, "mod",
                             lambda work_dir, brief: None, _assembly(), max_rounds=2)
    assert out["status"] == "not_accepted"
    assert {f["code"] for r in out["rounds"] for f in r["findings"]} == {
        "agent_wrote_no_patch"}


def test_an_accepted_patch_reports_what_it_added(work, monkeypatch):
    def agent(work_dir, brief):
        (Path(work_dir) / build.PATCH_NAME).write_text(
            json.dumps({"claims": []}), encoding="utf-8")

    monkeypatch.setattr(build.extract, "prepare", lambda *a, **k: {"span_count": 9})
    monkeypatch.setattr(build.extract, "review", lambda work_dir, patch: {
        "status": "accepted", "shard_path": str(work / "stitch" / "accepted.shard.json"),
        "nodes": 0, "claims": 3, "relations": 3,
    })
    out = build.stitch_graph(work, work, "mod", agent, _assembly(), max_rounds=2)
    assert out == {"status": "accepted", "attempts": 1,
                   "rounds": out["rounds"], "claims": 3}


def test_the_patch_joins_the_merge_like_any_other_shard(tmp_path):
    """It is not a special case downstream: assembly picks it up by path."""
    work = tmp_path / "w"
    for name in ("skeleton", "s1", "stitch"):
        (work / name).mkdir(parents=True)
        (work / name / "evidence-packet.json").write_text(
            json.dumps(fixtures.evidence_packet()), encoding="utf-8")
        (work / name / "accepted.shard.json").write_text(json.dumps(
            fixtures.shard(build.graph.assemble_model_shard, name),
            ensure_ascii=False), encoding="utf-8")
    out = build._assemble(work, [{"section_id": "s1", "status": "accepted"}])
    assert out["shards"] == 3, "the stitch shard was left out of the merge"
    merged = json.loads((work / "module-graph.json").read_text())
    assert "scene-stitch-open" in {n["node_id"] for n in merged["nodes"]}
