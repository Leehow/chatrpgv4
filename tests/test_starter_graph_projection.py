from __future__ import annotations

import importlib.util
import json
import re
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "plugins" / "coc-keeper" / "scripts"
STARTER = (
    ROOT / "plugins" / "coc-keeper" / "references"
    / "starter-scenarios" / "the-haunting"
)
CJK = re.compile(r"[\u3400-\u9fff\u3040-\u30ff]")


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


starter_graph = _load("coc_starter_graph_tests", SCRIPTS / "coc_starter_graph.py")
coc_state = _load("coc_state_starter_graph_tests", SCRIPTS / "coc_state.py")
coc_starter = _load("coc_starter_graph_install_tests", SCRIPTS / "coc_starter.py")


def _graph() -> dict:
    return json.loads(
        (STARTER / starter_graph.GRAPH_FILENAME).read_text(encoding="utf-8")
    )


def test_the_haunting_graph_projects_every_committed_runtime_view():
    graph = _graph()

    projected = starter_graph.project_starter_documents(graph)

    assert set(projected) == set(starter_graph.PROJECTED_DOCUMENTS)
    for filename, document in projected.items():
        committed = json.loads((STARTER / filename).read_text(encoding="utf-8"))
        assert document == committed, filename


def test_the_haunting_graph_is_complete_english_and_asset_bound():
    graph = _graph()

    summary = starter_graph.validate_starter_graph(graph)

    assert summary["document_count"] == 9
    assert graph["source_languages"] == ["en"]
    assert set(graph["coverage"].values()) == {"accepted"}
    assert not CJK.search(json.dumps(graph, ensure_ascii=False))
    assert {row["pdf_index"] for row in graph["source_refs"]} == set(
        range(446, 463)
    )
    assets = [row for row in graph["nodes"] if row["node_kind"] == "asset"]
    handouts = [row for row in graph["nodes"] if row["node_kind"] == "handout"]
    assert len(assets) == 20
    assert len(handouts) == 10
    assert sum(row["visibility"] == "player-safe" for row in assets) == 6
    assert all(row["properties"]["asset_ref"].startswith("assets/") for row in assets)
    assert all(row["source_refs"] for row in assets + handouts)


def test_install_starter_materializes_graph_and_installs_generation(tmp_path):
    coc_root = tmp_path / ".coc"
    coc_state.ensure_workspace(coc_root)
    coc_state.create_campaign(coc_root, "haunting-graph", "Graph Starter", era="1920s")

    scenario_dir = coc_starter.install_starter(
        coc_root, "haunting-graph", "the-haunting"
    )

    projected = starter_graph.project_starter_documents(_graph())
    assert json.loads((scenario_dir / "story-graph.json").read_text("utf-8")) == (
        projected["story-graph.json"]
    )
    installation = starter_graph.coc_module_graph.load_installed_module_graph_installation(
        tmp_path,
        asset_root_id=starter_graph.ASSET_ROOT_ID,
    )
    assert installation["manifest"]["build_status"] == "complete"
    assert installation["module_graph"] == _graph()


def test_starter_graph_rejects_dangling_projection_node():
    graph = _graph()
    module = next(row for row in graph["nodes"] if row["node_id"] == "module-the-haunting")
    module["properties"]["runtime_projection"]["documents"][1]["collections"][0][
        "node_ids"
    ].append("scene-missing")

    with pytest.raises(starter_graph.StarterGraphError, match="missing node"):
        starter_graph.validate_starter_graph(graph)


def test_starter_graph_builder_reproduces_committed_graph():
    rebuilt = starter_graph.build_starter_graph(STARTER)
    assert rebuilt == _graph()


def test_starter_graph_context_does_not_expand_through_module_hub():
    context = starter_graph.coc_module_graph.graph_context(
        _graph(),
        ["npc-michael-thomas"],
        depth=2,
        audience="keeper",
        max_nodes=200,
    )

    node_ids = {row["node_id"] for row in context["nodes"]}
    assert node_ids == {
        "npc-michael-thomas",
        "organization-chapel-of-contemplation",
        "event-chapel-raid",
    }
    assert {row["relation_kind"] for row in context["relations"]} == {
        "member-of",
        "occurs-at",
    }
