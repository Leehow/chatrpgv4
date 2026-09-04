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

sys.path.insert(0, str(Path(__file__).resolve().parent))
import module_build_fixtures as fixtures  # noqa: E402

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
        'def ask(instruction, payload):\n    return \'{}\'\n\n\ndef read_with_agent(work_dir, brief):\n    """A host that runs no agent; tests stub the reading itself."""\n    return None\n', encoding="utf-8")
    monkeypatch.syspath_prepend(str(tmp_path))


def _shard(section: str, span_id: str, nodes=None, claims=None) -> dict:
    # Claims go in before assembly: relations are derived only when the shard
    # does not already carry a `relations` list, so setting claims afterwards
    # leaves the edges underived and every scene its own island.
    return build.graph.assemble_model_shard({
        "contract_id": "coc.module-graph-shard.v3", "schema_version": 3,
        "module_id": "mod", "section_id": section, "source_language": "zh-Hans",
        "aspects": ["structure"], "evidence_span_ids": [span_id],
        "node_refs": [], "coverage": {},
        "nodes": nodes if nodes is not None else [{
            "node_id": f"scene-{section}", "node_kind": "scene", "name": section,
            "visibility": "keeper-only", "aliases": [], "summary": "",
            "evidence_span_ids": [span_id], "properties": {}}],
        "claims": claims or [],
    })


def _playable_nodes(section: str, span_id: str):
    """Two scenes, joined, one marked as where play opens.

    The toy shard has to satisfy the same structural standard as a real one:
    a lone scene is a fragment, and a graph nobody declared an entrance for
    cannot be opened. Building fixtures that skip it would test the merge
    against a shape the standard rejects.
    """
    return [
        {"node_id": f"scene-{section}-open", "node_kind": "scene",
         "name": f"{section} open", "visibility": "keeper-only", "aliases": [],
         "summary": "", "evidence_span_ids": [span_id],
         "properties": {"is_entrance": True}},
        {"node_id": f"scene-{section}-next", "node_kind": "scene",
         "name": f"{section} next", "visibility": "keeper-only", "aliases": [],
         "summary": "", "evidence_span_ids": [span_id], "properties": {}},
        {"node_id": f"ending-{section}", "node_kind": "ending",
         "name": f"{section} end", "visibility": "keeper-only", "aliases": [],
         "summary": "", "evidence_span_ids": [span_id], "properties": {}},
    ]


def _playable_claims(section: str, span_id: str):
    return [{
        "claim_id": f"claim-{section}-opens-into",
        "subject_id": f"scene-{section}-open",
        "predicate": "may-lead-to",
        "object": {"node_id": f"scene-{section}-next"},
        "truth_status": "authored-fact", "evidence_span_ids": [span_id],
        "confidence": 1.0, "reason": "书上写着",
    }]


def _writing_stub(nodes_for=None, hold: float = 0.0, seen: list | None = None,
                  claims_for=None):
    def stub(work_dir, ask, **kwargs):
        target = Path(work_dir)
        target.mkdir(parents=True, exist_ok=True)
        if seen is not None:
            seen.append((target.name, threading.get_ident(), time.time()))
        if hold:
            time.sleep(hold)
        # Page-shaped, because provenance is read out of the id.
        span_id = "span-page-0-block-1"
        (target / "evidence-packet.json").write_text(json.dumps({"spans": [{
            "span_id": span_id, "text": target.name,
            "source_ref": {"source_id": "pdf:mod", "pdf_index": 0,
                           "grep_anchor": target.name, "text_sha256": "0" * 64},
        }]}), encoding="utf-8")
        nodes = (nodes_for or _playable_nodes)(target.name, span_id)
        shard = _shard(target.name, span_id, nodes,
                       claims=(claims_for or _playable_claims)(target.name, span_id))
        (target / "accepted.shard.json").write_text(
            json.dumps(shard, ensure_ascii=False), encoding="utf-8")
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
        "--no-stitch",
        "--plan", str(_plan(tmp_path, [("s1", 0, 0), ("s2", 1, 1)])),
    ])
    # Two sections that share no exit are two pieces, and the standard says so:
    # merging is not finishing, and a build that leaves the Keeper unable to
    # walk from one half to the other has not produced a playable book.
    assert rc == 1
    graph_path = work / "module-graph.json"
    assert graph_path.exists(), "a build that stops at N shards has built nothing"
    merged = json.loads(graph_path.read_text())
    assert {"scene-s1-open", "scene-s2-open"} <= {n["node_id"] for n in merged["nodes"]}
    assert merged["entry_scene_ids"] == ["scene-s1-open", "scene-s2-open"], (
        "the skeleton's entrance mark did not survive into the graph"
    )
    receipt = json.loads((work / "build.json").read_text())
    assert receipt["assembly"]["status"] == "assembled_not_playable"
    assert receipt["assembly"]["nodes"] == 6
    assert receipt["assembly"]["dangling_relations"] == 0
    # Measuring unreachable scenes only helps if a caller can read the number:
    # these two sections each wrote a scene and no exit between them.
    # Two sections, each self-contained: the standard sees two pieces and says so.
    counts = receipt["assembly"]["template"]["finding_counts"]
    assert counts.get("scene_graph_fragmented") == 1
    assert receipt["assembly"]["template"]["measures"]["scene_components"] == 2


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
        "--no-stitch",
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
        "--no-stitch",
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
        "--no-stitch",
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
        "--work-dir", str(work), "--module-id", "mod", "--no-stitch",
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


def test_the_skeleton_shard_is_part_of_the_graph_it_seeded(monkeypatch, tmp_path):
    """The roster lives in the skeleton. Sections reference those nodes rather
    than redefining them, so leaving the skeleton out of the merge orphans
    every reference -- one `unresolved_node_ref` refused a whole build whose
    every section had passed every gate."""
    work = tmp_path / "w"
    (work / "skeleton").mkdir(parents=True)
    (work / "skeleton" / "evidence-packet.json").write_text(
        json.dumps(fixtures.evidence_packet()), encoding="utf-8")
    (work / "skeleton" / "accepted.shard.json").write_text(json.dumps(
        fixtures.shard(build.graph.assemble_model_shard, "skeleton", extra_nodes=[{
            "node_id": "npc-davide-mana", "node_kind": "npc", "name": "Davide Mana",
            "visibility": "keeper-only", "aliases": [], "summary": "",
            "evidence_span_ids": [fixtures.SPAN_ID], "properties": {}}],
            extra_claims=[{
                "claim_id": "claim-skeleton-author-present",
                "subject_id": "npc-davide-mana", "predicate": "present-in",
                "object": {"node_id": "scene-skeleton-open"},
                "truth_status": "authored-fact",
                "evidence_span_ids": [fixtures.SPAN_ID],
                "confidence": 1.0, "reason": "扉页署名"}]),
        ensure_ascii=False), encoding="utf-8")

    def stub(work_dir, read_with_agent=None, **kwargs):
        target = Path(work_dir)
        target.mkdir(parents=True, exist_ok=True)
        (target / "evidence-packet.json").write_text(
            json.dumps(fixtures.evidence_packet()), encoding="utf-8")
        # The section names the skeleton's NPC without redefining it: an
        # external ref must take part in a claim, or the contract refuses it
        # as decoration.
        (target / "accepted.shard.json").write_text(json.dumps(
            fixtures.shard(
                build.graph.assemble_model_shard, target.name,
                node_refs=["npc-davide-mana"],
                extra_claims=[{
                    "claim_id": f"claim-{target.name}-author-present",
                    "subject_id": "npc-davide-mana", "predicate": "present-in",
                    "object": {"node_id": f"scene-{target.name}-open"},
                    "truth_status": "authored-fact",
                    "evidence_span_ids": [fixtures.SPAN_ID],
                    "confidence": 1.0, "reason": "扉页署名"}]),
            ensure_ascii=False), encoding="utf-8")
        return {"status": "accepted", "attempts": 1, "rounds": [], "nodes": 1}

    _adapter(monkeypatch, tmp_path)
    monkeypatch.setattr(build.extract, "prepare", lambda *a, **k: {"span_count": 1})
    monkeypatch.setattr(build, "extract_section", stub)
    monkeypatch.setattr(build, "skeleton_module", lambda *a, **k: {
        "status": "accepted", "attempts": 1,
        "opening": {"sections": [], "entry_pages": []}})
    build.main([
        "--adapter", "fake_adapter", "--source-bundle", str(tmp_path),
        "--work-dir", str(work), "--module-id", "mod", "--no-stitch",
        "--plan", str(_plan(tmp_path, [("s1", 0, 0)])),
    ])
    receipt = json.loads((work / "build.json").read_text())
    assert receipt["assembly"]["status"].startswith("assembled"), (
        f"assembly refused: {receipt['assembly'].get('findings')}"
    )
    merged = json.loads((work / "module-graph.json").read_text())
    assert "npc-davide-mana" in {n["node_id"] for n in merged["nodes"]}


def test_one_sound_section_builds_a_playable_graph(monkeypatch, tmp_path):
    """The standard has to be reachable, or it is only a way to fail.

    One section whose scenes are joined, whose entrance is marked and whose
    ending is named satisfies every invariant, and the build says so.
    """
    _adapter(monkeypatch, tmp_path)
    monkeypatch.setattr(build.extract, "prepare", lambda *a, **k: {"span_count": 1})
    monkeypatch.setattr(build, "extract_section", _writing_stub())
    work = tmp_path / "w"
    rc = build.main([
        "--adapter", "fake_adapter", "--source-bundle", str(tmp_path),
        "--work-dir", str(work), "--module-id", "mod", "--no-skeleton",
        "--no-stitch",
        "--plan", str(_plan(tmp_path, [("s1", 0, 0)])),
    ])
    receipt = json.loads((work / "build.json").read_text())
    template = receipt["assembly"]["template"]
    assert template["finding_counts"] == {}, template["findings"] if "findings" in template else template
    assert receipt["assembly"]["status"] == "assembled"
    assert template["measures"]["scene_components"] == 1
    assert rc == 0
