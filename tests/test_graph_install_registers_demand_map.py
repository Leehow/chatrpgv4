"""Installing a graph puts it on the map the progressive lane deepens against.

`on_enter_scene` can only fetch a section the index knows about. The bridge
that turns a graph build into index rows was written, tested, and called by
nothing -- so a book built through the graph lane was invisible to the lane
meant to read the rest of it while people played, and play could never get
past the opening sections.
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "plugins" / "coc-keeper" / "scripts"
sys.path.insert(0, str(SCRIPTS))


def _load(name: str, filename: str):
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / filename)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


graph = _load("coc_module_graph_install", "coc_module_graph.py")
assets = _load("coc_module_assets_install", "coc_module_assets.py")


def _plan():
    return {
        "module_id": "mod",
        "sections": [
            {"section_id": "peru", "pdf_index_start": 0, "pdf_index_end": 9,
             "title": "Peru"},
            {"section_id": "cairo", "pdf_index_start": 10, "pdf_index_end": 19,
             "title": "Cairo"},
        ],
    }


def _skeleton():
    def node(node_id, kind, page):
        return {"node_id": node_id, "node_kind": kind, "name": node_id,
                "visibility": "keeper-only", "aliases": [], "summary": "",
                "evidence_span_ids": [f"span-page-{page}-block-1"],
                "properties": {}}
    return {"section_id": "skeleton",
            "nodes": [node("location-lima", "location", 0),
                      node("location-cairo", "location", 10)]}


def test_installing_writes_the_index_and_binds_its_locations(monkeypatch, tmp_path):
    written: dict = {}
    monkeypatch.setattr(
        graph.coc_module_assets, "write_section_index",
        lambda workspace, root_id, index: written.update(
            {"root": root_id, "index": index}),
    )
    out = graph._register_section_index(
        tmp_path, asset_root_id="mod-demo", section_plan=_plan(),
        accepted_records=[{"shard": _skeleton()}],
        source_rows=[{"source_id": "pdf:mod", "file_sha256": "a" * 64,
                      "page_count": 20}],
        opening_section_ids=["peru"],
    )
    assert out == {"registered": True, "sections": 2}
    assert written["root"] == "mod-demo"
    rows = {row["section_id"]: row for row in written["index"]["sections"]}
    assert set(rows) == {"peru", "cairo"}
    # The opening deepens up front; everything else waits for the party.
    assert rows["peru"]["timing"] == "opening"
    assert rows["cairo"]["timing"] == "on_demand"
    # Bound to a location, or `on_enter_scene` has nothing to match a scene to.
    assert rows["cairo"]["binding"]["entity_kind"] == "location"
    assert "location-cairo" in rows["cairo"]["binding"]["entity_ids"]


def test_a_build_with_no_skeleton_says_so_rather_than_writing_an_empty_map(
    monkeypatch, tmp_path,
):
    """An index with no bindings looks like a book with no places: the lane
    would deepen nothing and report nothing, which is the silence to avoid."""
    monkeypatch.setattr(
        graph.coc_module_assets, "write_section_index",
        lambda *a, **k: pytest.fail("an index was written with nothing to bind"),
    )
    out = graph._register_section_index(
        tmp_path, asset_root_id="mod-demo", section_plan=_plan(),
        accepted_records=[{"shard": {"section_id": "peru", "nodes": []}}],
        source_rows=[{"source_id": "pdf:mod", "file_sha256": "a" * 64,
                      "page_count": 20}],
        opening_section_ids=[],
    )
    assert out["registered"] is False
    assert "skeleton" in out["reason"]


def _register(monkeypatch, tmp_path, plan):
    written: dict = {}
    monkeypatch.setattr(
        graph.coc_module_assets, "write_section_index",
        lambda workspace, root_id, index: written.update({"index": index}),
    )
    graph._register_section_index(
        tmp_path, asset_root_id="mod-demo", section_plan=plan,
        accepted_records=[{"shard": _skeleton()}],
        source_rows=[{"source_id": "pdf:mod", "file_sha256": "a" * 64,
                      "page_count": 20}],
        opening_section_ids=["peru"],
    )
    return written["index"]


def test_the_index_carries_the_digest_of_the_plan_that_produced_it(
    monkeypatch, tmp_path,
):
    """The plan is this lane's outline. A later build reading the same book
    must land on the same digest, and a different cut must not -- otherwise the
    index claims to describe a reading it did not come from."""
    index = _register(monkeypatch, tmp_path, _plan())
    assert index["outline_sha256"] == graph._json_digest(_plan())
    assert index["outline_producer"] == "coc_module_build"

    # A different cut of the same book, still inside its page count.
    recut = _plan()
    recut["sections"][0]["pdf_index_end"] = 8
    recut["sections"][1]["pdf_index_start"] = 9
    assert _register(monkeypatch, tmp_path, recut)["outline_sha256"] != (
        index["outline_sha256"]
    )


def test_the_install_plan_is_not_the_section_plan(monkeypatch, tmp_path):
    """Two different objects with the same word in their name. The install plan
    names shards and aspects; only the section plan carries the page ranges the
    index binds locations by. Handed the wrong one, the bridge writes an index
    of nothing -- so the absence is reported instead."""
    monkeypatch.setattr(
        graph.coc_module_assets, "write_section_index",
        lambda *a, **k: pytest.fail("an empty demand map was written"),
    )
    install_plan = {"module_id": "mod", "schema_version": 1,
                    "planned_shards": [{"section_id": "peru", "aspects": ["structure"]}]}
    out = graph._register_section_index(
        tmp_path, asset_root_id="mod-demo", section_plan=install_plan,
        accepted_records=[{"shard": _skeleton()}],
        source_rows=[{"source_id": "pdf:mod", "file_sha256": "a" * 64,
                      "page_count": 20}],
        opening_section_ids=[],
    )
    assert out["registered"] is False
    assert "page ranges" in out["reason"]


def test_a_build_installed_without_a_section_plan_registers_nothing(
    monkeypatch, tmp_path,
):
    monkeypatch.setattr(
        graph.coc_module_assets, "write_section_index",
        lambda *a, **k: pytest.fail("a demand map was written from nothing"),
    )
    out = graph._register_section_index(
        tmp_path, asset_root_id="mod-demo", section_plan=None,
        accepted_records=[{"shard": _skeleton()}],
        source_rows=[], opening_section_ids=[],
    )
    assert out["registered"] is False
