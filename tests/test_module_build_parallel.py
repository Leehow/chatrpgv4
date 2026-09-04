"""The three things a build owes beyond "every section passed".

A build's cost is generation time, and its product is one graph. Sections that
each pass their gates and never merge are N graphs, which is nothing a campaign
can be projected from; sections run one at a time turn a long book into a day
of waiting on a channel that answers several at once; and sections that each
invent their own id for the same cult merge into two cults.
"""
from __future__ import annotations

import importlib.util
import json
import sys
import threading
import time
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "plugins" / "coc-keeper" / "scripts"
sys.path.insert(0, str(SCRIPTS))
_spec = importlib.util.spec_from_file_location(
    "coc_module_build_par", SCRIPTS / "coc_module_build.py"
)
build = importlib.util.module_from_spec(_spec)
sys.modules["coc_module_build_par"] = build
_spec.loader.exec_module(build)


def _plan(tmp_path: Path, sections) -> Path:
    path = tmp_path / "plan.json"
    path.write_text(json.dumps(
        {"status": "accepted", "attempts": 1, "sections": [
            {"section_id": s, "pdf_index_start": a, "pdf_index_end": b}
            for s, a, b in sections
        ]}), encoding="utf-8")
    return path


def _adapter(monkeypatch, tmp_path: Path) -> None:
    (tmp_path / "fake_adapter.py").write_text(
        "def ask(instruction, payload):\n    return '{}'\n", encoding="utf-8")
    monkeypatch.syspath_prepend(str(tmp_path))


def _shard(section: str, span_id: str, nodes=None) -> dict:
    return build.graph.assemble_model_shard({
        "contract_id": "coc.module-graph-shard.v3", "schema_version": 3,
        "module_id": "mod", "section_id": section, "source_language": "zh-Hans",
        "aspects": ["structure"], "evidence_span_ids": [span_id],
        "node_refs": [], "coverage": {},
        "nodes": nodes if nodes is not None else [{
            "node_id": f"scene-{section}", "node_kind": "scene", "name": section,
            "visibility": "keeper-only", "aliases": [], "summary": "",
            "evidence_span_ids": [span_id], "properties": {}}],
        "claims": [],
    })


def _writing_stub(nodes_for=None, hold: float = 0.0, seen: list | None = None):
    def stub(work_dir, ask, **kwargs):
        target = Path(work_dir)
        target.mkdir(parents=True, exist_ok=True)
        if seen is not None:
            seen.append((target.name, threading.get_ident(), time.time()))
        if hold:
            time.sleep(hold)
        span_id = f"span-{target.name}-1"
        (target / "evidence-packet.json").write_text(json.dumps({"spans": [{
            "span_id": span_id, "text": target.name,
            "source_ref": {"source_id": "pdf:mod", "pdf_index": 0,
                           "grep_anchor": target.name, "text_sha256": "0" * 64},
        }]}), encoding="utf-8")
        nodes = nodes_for(target.name, span_id) if nodes_for else None
        (target / "accepted.shard.json").write_text(
            json.dumps(_shard(target.name, span_id, nodes), ensure_ascii=False),
            encoding="utf-8")
        return {"status": "accepted", "attempts": 1, "rounds": [], "nodes": 1}
    return stub


def test_accepted_sections_are_merged_into_one_module_graph(monkeypatch, tmp_path):
    _adapter(monkeypatch, tmp_path)
    monkeypatch.setattr(build.extract, "prepare", lambda *a, **k: {"span_count": 1})
    monkeypatch.setattr(build, "extract_section", _writing_stub())
    work = tmp_path / "w"
    rc = build.main([
        "--adapter", "fake_adapter", "--source-bundle", str(tmp_path),
        "--work-dir", str(work), "--module-id", "mod", "--no-skeleton",
        "--plan", str(_plan(tmp_path, [("s1", 0, 0), ("s2", 1, 1)])),
    ])
    assert rc == 0
    graph_path = work / "module-graph.json"
    assert graph_path.exists(), "a build that stops at N shards has built nothing"
    merged = json.loads(graph_path.read_text())
    assert {n["node_id"] for n in merged["nodes"]} == {"scene-s1", "scene-s2"}
    receipt = json.loads((work / "build.json").read_text())
    assert receipt["assembly"]["status"] == "assembled"
    assert receipt["assembly"]["nodes"] == 2
    assert receipt["assembly"]["dangling_relations"] == 0


def test_a_merge_conflict_is_reported_not_raised(monkeypatch, tmp_path):
    """Two sections giving one id different meanings must not kill the build."""
    def nodes_for(section, span_id):
        # Same node id, different kind: one entity, two meanings.
        kind = "scene" if section == "s1" else "location"
        return [{"node_id": "scene-shared", "node_kind": kind, "name": section,
                 "visibility": "keeper-only", "aliases": [], "summary": "",
                 "evidence_span_ids": [span_id], "properties": {}}]
    _adapter(monkeypatch, tmp_path)
    monkeypatch.setattr(build.extract, "prepare", lambda *a, **k: {"span_count": 1})
    monkeypatch.setattr(build, "extract_section", _writing_stub(nodes_for=nodes_for))
    work = tmp_path / "w"
    rc = build.main([
        "--adapter", "fake_adapter", "--source-bundle", str(tmp_path),
        "--work-dir", str(work), "--module-id", "mod", "--no-skeleton",
        "--plan", str(_plan(tmp_path, [("s1", 0, 0), ("s2", 1, 1)])),
    ])
    assert rc == 1
    receipt = json.loads((work / "build.json").read_text())
    assert receipt["assembly"]["status"] in ("conflicted", "assembly_failed")
    assert receipt["assembly"]["findings"], "a refusal must say what refused"
    assert all(s["status"] == "accepted" for s in receipt["sections"])


def test_chunks_extract_concurrently(monkeypatch, tmp_path):
    seen: list = []
    _adapter(monkeypatch, tmp_path)
    monkeypatch.setattr(build.extract, "prepare", lambda *a, **k: {"span_count": 1})
    monkeypatch.setattr(build, "extract_section", _writing_stub(hold=0.4, seen=seen))
    work = tmp_path / "w"
    started = time.time()
    build.main([
        "--adapter", "fake_adapter", "--source-bundle", str(tmp_path),
        "--work-dir", str(work), "--module-id", "mod", "--no-skeleton",
        "--workers", "4",
        "--plan", str(_plan(tmp_path, [("s1", 0, 0), ("s2", 1, 1),
                                       ("s3", 2, 2), ("s4", 3, 3)])),
    ])
    elapsed = time.time() - started
    assert len({thread for _, thread, _ in seen}) > 1, "everything ran on one thread"
    assert elapsed < 1.2, (
        f"four 0.4s sections took {elapsed:.1f}s; they ran one after another"
    )


def test_results_follow_plan_order_not_completion_order(monkeypatch, tmp_path):
    """Two runs of one book must produce the same receipt."""
    holds = {"s1": 0.5, "s2": 0.05, "s3": 0.2}

    def stub(work_dir, ask, **kwargs):
        target = Path(work_dir)
        time.sleep(holds.get(target.name, 0))
        return _writing_stub()(work_dir, ask, **kwargs)

    _adapter(monkeypatch, tmp_path)
    monkeypatch.setattr(build.extract, "prepare", lambda *a, **k: {"span_count": 1})
    monkeypatch.setattr(build, "extract_section", stub)
    work = tmp_path / "w"
    build.main([
        "--adapter", "fake_adapter", "--source-bundle", str(tmp_path),
        "--work-dir", str(work), "--module-id", "mod", "--no-skeleton",
        "--workers", "3",
        "--plan", str(_plan(tmp_path, [("s1", 0, 0), ("s2", 1, 1), ("s3", 2, 2)])),
    ])
    receipt = json.loads((work / "build.json").read_text())
    assert [s["section_id"] for s in receipt["sections"]] == ["s1", "s2", "s3"]


def test_the_skeletons_roster_reaches_every_section(monkeypatch, tmp_path):
    """One cult keeps one id across sections, or the book merges as two cults."""
    work = tmp_path / "w"
    (work / "skeleton").mkdir(parents=True)
    (work / "skeleton" / "accepted.shard.json").write_text(json.dumps({
        "nodes": [
            {"node_id": "faction-bloody-tongue", "node_kind": "faction",
             "name": "血舌邪教", "visibility": "keeper-only"},
            {"node_id": "npc-jackson-elias", "node_kind": "npc",
             "name": "Jackson Elias", "visibility": "keeper-only"},
            {"node_id": "scene-opening", "node_kind": "scene",
             "name": "开场", "visibility": "keeper-only"},
        ],
    }), encoding="utf-8")

    handed: list = []
    _adapter(monkeypatch, tmp_path)
    monkeypatch.setattr(
        build.extract, "prepare",
        lambda bundle, work_dir, **k: (
            handed.append(k.get("known_nodes")) or {"span_count": 1}),
    )
    monkeypatch.setattr(build, "extract_section", _writing_stub())
    monkeypatch.setattr(build, "skeleton_module", lambda *a, **k: {
        "status": "accepted", "attempts": 1,
        "opening": {"sections": ["s1"], "entry_pages": [0]}})
    build.main([
        "--adapter", "fake_adapter", "--source-bundle", str(tmp_path),
        "--work-dir", str(work), "--module-id", "mod",
        "--plan", str(_plan(tmp_path, [("s1", 0, 0), ("s2", 1, 1)])),
    ])
    assert handed and all(roster for roster in handed), (
        "sections were prepared with an empty roster; each will mint its own ids"
    )
    for roster in handed:
        ids = {node["node_id"] for node in roster}
        assert "faction-bloody-tongue" in ids
        assert "npc-jackson-elias" in ids
        # Scenes are not roster: they are what each section is there to read.
        assert "scene-opening" not in ids
        for node in roster:
            assert set(node) == {"node_id", "node_kind", "name", "visibility"}
