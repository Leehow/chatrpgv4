"""Deepening at the table grows the graph, not just the pack.

The lane fetches sections while play goes on, and it fetched them with the
reader that predates the graph: a section deepened at the table became a pack
and nothing else, so the book stopped growing as a graph the moment the party
left the sections built up front. "Parse as they play" only means something if
what was parsed lands where the next question gets asked.
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


def _load(name: str, filename: str):
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / filename)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


assets = _load("coc_module_assets_ondemand", "coc_module_assets.py")
graph = _load("coc_module_graph_ondemand", "coc_module_graph.py")


def _shard(section: str) -> dict:
    return fixtures.shard(graph.assemble_model_shard, section)


def _evidence() -> dict:
    return fixtures.evidence_packet()


def _install(tmp_path: Path, sections: list[str]) -> Path:
    """An asset root holding a graph merged from `sections`."""
    root = tmp_path / ".coc" / "module-assets" / "mod" / "graph"
    (root / "generations" / "generation-first").mkdir(parents=True)
    shards = [_shard(name) for name in sections]
    merged = graph.merge_shards(
        shards,
        evidence_catalog={row["span_id"]: row for row in _evidence()["spans"]},
    )
    (root / "generations" / "generation-first" / "module-graph.json").write_text(
        json.dumps(merged), encoding="utf-8")
    (root / "manifest.json").write_text(json.dumps({
        "current_generation": "generation-first",
        "module_graph_path": "generations/generation-first/module-graph.json",
        "module_graph_sha256": "a" * 64,
    }), encoding="utf-8")
    for shard in shards:
        assets.put_graph_shard(tmp_path, "mod", shard,
                               evidence_packet=_evidence())
    return root


def test_a_section_read_at_the_table_lands_in_the_graph(tmp_path: Path):
    root = _install(tmp_path, ["opening"])
    before = json.loads(
        (root / "generations" / "generation-first" / "module-graph.json").read_text()
    )
    out = assets.grow_installed_graph(
        tmp_path, "mod", _shard("cellar"), evidence_packet=_evidence(),
    )
    assert out["grown"] is True, out
    assert out["shards"] == 2
    manifest = json.loads((root / "manifest.json").read_text())
    assert manifest["current_generation"] == out["generation"]
    grown = json.loads((root / manifest["module_graph_path"]).read_text())
    assert len(grown["nodes"]) > len(before["nodes"])
    assert "scene-cellar-open" in {node["node_id"] for node in grown["nodes"]}


def test_the_merge_takes_shards_because_a_graph_is_not_one(tmp_path: Path):
    """The first draft merged the installed graph as if it were a shard of
    itself; every contract check refused at once, because a merged graph
    carries section ids, merge notes and coverage by section and a shard may
    carry none of them."""
    root = _install(tmp_path, ["opening"])
    installed = json.loads(
        (root / "generations" / "generation-first" / "module-graph.json").read_text()
    )
    assert {"section_ids", "coverage_by_section", "merge_notes"} <= set(installed)
    findings = graph.validate_shard(installed)
    assert any(f["code"] == "unknown_shard_key" for f in findings)


def test_an_asset_root_with_no_kept_shards_says_so(tmp_path: Path):
    root = tmp_path / ".coc" / "module-assets" / "mod" / "graph"
    root.mkdir(parents=True)
    (root / "manifest.json").write_text(json.dumps({
        "current_generation": "g", "module_graph_path": "g/module-graph.json",
    }), encoding="utf-8")
    out = assets.grow_installed_graph(tmp_path, "mod", _shard("cellar"))
    assert out["grown"] is False
    assert "kept no shards" in out["reason"]


def test_a_module_with_no_installed_graph_is_left_alone(tmp_path: Path):
    (tmp_path / ".coc" / "module-assets" / "mod").mkdir(parents=True)
    out = assets.grow_installed_graph(tmp_path, "mod", _shard("cellar"))
    assert out == {"grown": False, "reason": "no installed module graph"}


def test_a_conflict_is_reported_and_the_installation_stands(tmp_path: Path):
    """The party has already been given the section; a merge that refuses is
    an answer about the book, not a reason to lose the reading."""
    root = _install(tmp_path, ["opening"])
    before = (root / "manifest.json").read_text()
    clash = _shard("opening")
    clash["nodes"][0]["node_kind"] = "location"
    clash["nodes"][0]["node_id"] = "scene-opening-open"
    out = assets.grow_installed_graph(
        tmp_path, "mod", clash, evidence_packet=_evidence(),
    )
    assert out["grown"] is False
    assert out["findings"], "a refusal must say what refused"
    assert (root / "manifest.json").read_text() == before, (
        "a refused merge moved the installation"
    )


def test_a_shard_naming_no_section_is_refused(tmp_path: Path):
    _install(tmp_path, ["opening"])
    out = assets.grow_installed_graph(tmp_path, "mod", {"nodes": []})
    assert out["grown"] is False and "names no section" in out["reason"]


build = _load("coc_module_build_ondemand", "coc_module_build.py")


def _bundle(tmp_path: Path, pages: int = 3) -> Path:
    import hashlib
    bundle = tmp_path / "bundle"
    (bundle / "pages").mkdir(parents=True)
    # Registration validates against the real file, so the fixture has one.
    pdf = tmp_path / "m.pdf"
    pdf.write_bytes(b"%PDF-1.4 fixture")
    rows = []
    for index in range(pages):
        text = f"# 第 {index} 页\n\n正文若干。\n"
        (bundle / "pages" / f"{index:04d}.md").write_text(text, encoding="utf-8")
        rows.append({"pdf_index": index, "markdown_path": f"pages/{index:04d}.md",
                     "text_sha256": hashlib.sha256(text.encode()).hexdigest(),
                     "review_state": "auto_accepted", "parse_confidence": 0.9,
                     "grep_anchors": [f"第 {index} 页"]})
    (bundle / "manifest.json").write_text(json.dumps({
        "schema_version": 1, "producer": "codex-pdf-skill",
        "source": {"source_id": "pdf:ondemand-fixture", "title": "Demo",
                   "path": str(pdf),
                   "file_sha256": hashlib.sha256(pdf.read_bytes()).hexdigest(),
                   "page_count": pages, "producer": "codex-pdf-skill"},
        "pages": rows,
    }), encoding="utf-8")
    return bundle


def _work(tmp_path: Path, sections: list[str]) -> Path:
    work = tmp_path / "work"
    for name in sections:
        (work / name).mkdir(parents=True)
        (work / name / "accepted.shard.json").write_text(
            json.dumps(_shard(name)), encoding="utf-8")
        (work / name / "evidence-packet.json").write_text(
            json.dumps(_evidence()), encoding="utf-8")
    merged = graph.merge_shards(
        [_shard(name) for name in sections],
        evidence_catalog={r["span_id"]: r for r in _evidence()["spans"]},
    )
    (work / "module-graph.json").write_text(json.dumps(merged), encoding="utf-8")
    return work


def test_installing_caches_the_pages_the_lane_will_need(tmp_path: Path):
    """Without them a section the party walks into is refused with "section
    pages are not in the accepted cache": the graph knows the book and the lane
    that fetches the rest of it cannot see one page."""
    bundle = _bundle(tmp_path)
    src = json.loads((bundle / "manifest.json").read_text())["source"]
    assets.init_module_root(tmp_path, asset_root_id="mod",
                            identity={"title": "Demo"},
                            file_sha256=src["file_sha256"], source=src)
    out = build.install_build(
        _work(tmp_path, ["opening"]), bundle, workspace=tmp_path,
        asset_root_id="mod",
        plan={"sections": [{"section_id": "opening", "pdf_index_start": 0,
                            "pdf_index_end": 2}]},
    )
    assert out["pages_cached"]["registered"] == 3, out["pages_cached"]
    assert out["pages_cached"]["failed"] == 0
    # Registered and accepted are different facts, and only the second lets the
    # lane fetch a section: 654 imported by hand and 0 accepted, silently.
    assert out["pages_cached"]["accepted"] == 3
    assert set(assets.accepted_cached_pdf_indices(tmp_path, "mod")) == {0, 1, 2}
    assert assets.registered_pdf_indices(tmp_path, "mod") == {0, 1, 2}


def test_installing_keeps_its_shards_so_the_graph_can_grow_later(tmp_path: Path):
    bundle = _bundle(tmp_path)
    src = json.loads((bundle / "manifest.json").read_text())["source"]
    assets.init_module_root(tmp_path, asset_root_id="mod",
                            identity={"title": "Demo"},
                            file_sha256=src["file_sha256"], source=src)
    out = build.install_build(
        _work(tmp_path, ["opening", "cellar"]), bundle, workspace=tmp_path,
        asset_root_id="mod",
        plan={"sections": [{"section_id": "opening", "pdf_index_start": 0,
                            "pdf_index_end": 2}]},
    )
    assert out["shards_kept"] == 2
    kept = assets.graph_shard_dir(tmp_path, "mod")
    assert {p.name for p in kept.glob("*.shard.json")} == {
        "opening.shard.json", "cellar.shard.json"}
    # And the evidence beside them, or the next merge has no catalog.
    assert (kept / "opening.evidence.json").is_file()
    # A section read at the table can now land in the graph.
    assert assets.grow_installed_graph(
        tmp_path, "mod", _shard("attic"), evidence_packet=_evidence(),
    )["grown"] is True


def test_fulfilling_with_a_shard_stores_the_pack_and_grows_the_graph(
    tmp_path: Path, monkeypatch,
):
    """The one wire that makes deepening at the table a graph operation."""
    seen: dict = {}
    monkeypatch.setattr(
        assets, "put_section_pack_and_fulfill_host_work",
        lambda workspace, root, *, host_work_job_id, pack: (
            seen.update({"pack": pack})
            or {"section_pack": pack, "body_path": "b"}
        ),
    )
    def _grew(*a, **k):
        seen["grew"] = True
        return {"grown": True}

    monkeypatch.setattr(assets, "grow_installed_graph", _grew)
    module_dir = tmp_path / ".coc" / "module-assets" / "mod"
    (module_dir / "host-work").mkdir(parents=True)
    request = {
        "kind": assets.EXTRACT_SECTION_KIND, "status": "pending",
        "extraction_request": {
            "section_id": "cellar", "title": "地窖",
            "requested_pdf_indices": [0, 1],
            "source_id": "pdf:ondemand-fixture",
            "result_contract": {"allowed_pack_kinds": ["keeper_truth"]},
        },
    }
    monkeypatch.setattr(assets, "validate_host_work_request_shape",
                        lambda payload: None)
    (module_dir / "host-work" / "job-1.json").write_text(
        json.dumps(request), encoding="utf-8")
    out = assets.put_section_shard_and_fulfill_host_work(
        tmp_path, "mod", host_work_job_id="job-1", shard=_shard("cellar"),
    )
    assert out["from_shard"] is True
    assert seen.get("grew") is True, "the section landed as a pack and nowhere else"
    assert out["graph"] == {"grown": True}


packs = _load("coc_module_section_packs_ondemand", "coc_module_section_packs.py")


def _section(pages: list[int]) -> dict:
    return {"section_id": "sec-front", "title": "Front", "payload": "narrative",
            "pdf_indices": pages, "audience": "keeper_only",
            "timing": "on_demand",
            "binding": {"kind": "global", "entity_kind": None, "entity_ids": []}}


def _index() -> dict:
    return {"schema_version": 1, "source_id": "pdf:ondemand-fixture",
            "file_sha256": "c" * 64, "outline_sha256": "d" * 64,
            "sections": []}


def _refs(pages: list[int]) -> list[dict]:
    return [{"source_id": "pdf:ondemand-fixture", "pdf_index": page} for page in pages]


def test_a_hole_in_the_book_is_not_a_gap_in_the_cache():
    """Masks declares no pages at pdf_index 4 through 7. Treating the two as
    one fact made every section spanning a hole permanently unfetchable:
    "section pages [4, 5, 6, 7] are not in the accepted cache", for pages that
    do not exist."""
    request = packs.build_extraction_request(
        section=_section([0, 1, 2, 3, 4, 5, 6, 7, 8]),
        index=_index(), cached_page_refs=_refs([0, 1, 2, 3, 8]), job_id="job-1",
        declared_pages={0, 1, 2, 3, 8},
    )
    assert request["requested_pdf_indices"] == [0, 1, 2, 3, 8]


def test_a_page_the_book_has_and_the_cache_does_not_still_refuses():
    """The check must keep meaning something: a section whose pages were never
    read is a real failure, and only a declared hole is exempt."""
    with pytest.raises(packs.SectionPackError) as caught:
        packs.build_extraction_request(
            section=_section([0, 1, 2]), index=_index(),
            cached_page_refs=_refs([0]), job_id="job-1",
            declared_pages={0, 1, 2},
        )
    assert "[1, 2]" in str(caught.value)


def test_without_a_declared_set_the_stricter_rule_stands():
    """Silence must not be the lenient answer."""
    with pytest.raises(packs.SectionPackError):
        packs.build_extraction_request(
            section=_section([0, 1]), index=_index(),
            cached_page_refs=_refs([0]), job_id="job-1",
        )


def test_a_section_the_book_carries_no_page_of_is_refused():
    with pytest.raises(packs.SectionPackError) as caught:
        packs.build_extraction_request(
            section=_section([4, 5]), index=_index(),
            cached_page_refs=_refs([0, 1]), job_id="job-1",
            declared_pages={0, 1},
        )
    assert "no page this source carries" in str(caught.value)


def test_declared_pages_come_from_the_registered_bundles(tmp_path: Path):
    module_dir = tmp_path / ".coc" / "module-assets" / "mod"
    module_dir.mkdir(parents=True)
    (module_dir / "identity.json").write_text(json.dumps({
        "source_bundles": [
            {"bundle_sha256": "a" * 64, "pdf_indices": [0, 1, 2]},
            {"bundle_sha256": "b" * 64, "pdf_indices": [8, 9]},
        ],
    }), encoding="utf-8")
    assert assets.registered_pdf_indices(tmp_path, "mod") == {0, 1, 2, 8, 9}
    assert assets.registered_pdf_indices(tmp_path, "absent") == set()


worker = _load("coc_module_queue_worker_ondemand", "coc_module_queue_worker.py")


def test_the_worker_tells_the_request_which_pages_the_book_carries(
    tmp_path: Path, monkeypatch,
):
    """The distinction only helps if it reaches the place that decides. The
    check lives in the pack request; only the worker knows the asset root, so
    this drives the worker rather than calling the request builder itself --
    a test that calls it directly proves nothing about the wire.
    """
    seen: dict = {}

    def _capture(**kwargs):
        seen.update(kwargs)
        return {"result_contract": {"allowed_pack_kinds": ["keeper_truth"]},
                "requested_pdf_indices": sorted(
                    set(kwargs["section"]["pdf_indices"])
                    & set(kwargs["declared_pages"])
                )}

    monkeypatch.setattr(
        worker.coc_module_section_packs, "build_extraction_request", _capture)
    monkeypatch.setattr(
        worker.coc_module_assets, "registered_pdf_indices",
        lambda workspace, root: {0, 1, 8},
    )
    monkeypatch.setattr(
        worker.coc_module_assets, "read_section_index",
        lambda workspace, root: {"sections": [
            {"section_id": "sec-front", "payload": "narrative",
             "pdf_indices": [0, 1, 4, 8]}]},
    )
    monkeypatch.setattr(
        worker.coc_module_assets, "get_skeleton", lambda *a, **k: {})
    monkeypatch.setattr(worker, "_cached_page_refs", lambda *a, **k: [])
    root = tmp_path / ".coc" / "module-assets" / "mod"
    root.mkdir(parents=True)
    (root / "identity.json").write_text(json.dumps({
        "source": {"source_id": "pdf:ondemand-fixture", "file_sha256": "c" * 64},
    }), encoding="utf-8")

    worker._write_host_work_request(tmp_path, "mod", {
        "job_id": "job-1", "kind": assets.EXTRACT_SECTION_KIND,
        "target_id": "sec-front",
    })
    assert seen.get("declared_pages") == {0, 1, 8}, (
        "the worker did not say which pages the book carries, so a hole reads "
        "as a cache miss again"
    )
    written = json.loads((root / "host-work" / "job-1.json").read_text())
    assert written["extraction_request"]["requested_pdf_indices"] == [0, 1, 8]


def test_an_asset_root_that_has_declared_nothing_is_silent_not_empty():
    """An empty declared set is silence, and reading it as "the book carries
    nothing" refused every section of every asset root with no registered
    bundle -- four suites at once, all of them right to fail."""
    request = packs.build_extraction_request(
        section=_section([0, 1, 2]), index=_index(),
        cached_page_refs=_refs([0, 1, 2]), job_id="job-1",
        declared_pages=set(),
    )
    assert request["requested_pdf_indices"] == [0, 1, 2]
