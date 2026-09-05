"""The table's own claimant: a section is read where the party is standing.

Everything up to `awaiting_host_pack` already worked. Nothing read the pages,
because the only dispatcher available sends `--no-tools` single completions and
graph extraction cannot be one. These pin the missing half: the reader runs,
and — the part that matters more — a reader that fails leaves the request open
instead of closing a job nothing read.
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
sys.path.insert(0, str(Path(__file__).resolve().parent))
import module_build_fixtures as fixtures  # noqa: E402


def _archivist() -> dict:
    """A name the book establishes, so a later section can reuse its id."""
    return {
        "node_id": "npc-the-archivist", "node_kind": "npc",
        "name": "档案员", "visibility": "keeper-only", "aliases": [],
        "summary": "", "evidence_span_ids": [fixtures.SPAN_ID], "properties": {},
    }


def _load(name: str, filename: str):
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / filename)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


assets = _load("coc_module_assets_table", "coc_module_assets.py")
graph = _load("coc_module_graph_table", "coc_module_graph.py")
build = _load("coc_module_build_table", "coc_module_build.py")
deepen = _load("coc_module_deepen_table", "coc_module_deepen.py")
worker = _load("coc_module_queue_worker_table", "coc_module_queue_worker.py")


def _bundle(tmp_path: Path, pages: int = 3) -> Path:
    bundle = tmp_path / "bundle"
    (bundle / "pages").mkdir(parents=True)
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
        "source": {"source_id": "pdf:table-fixture", "title": "Demo",
                   "path": str(pdf),
                   "file_sha256": hashlib.sha256(pdf.read_bytes()).hexdigest(),
                   "page_count": pages, "producer": "codex-pdf-skill"},
        "pages": rows,
    }), encoding="utf-8")
    return bundle


def _work(tmp_path: Path, sections: list[str]) -> Path:
    work = tmp_path / "work"
    for name in sections:
        (work / name).mkdir(parents=True, exist_ok=True)
        (work / name / "accepted.shard.json").write_text(
            json.dumps(fixtures.shard(
                graph.assemble_model_shard, name, extra_nodes=[_archivist()],
            )),
            encoding="utf-8")
        (work / name / "evidence-packet.json").write_text(
            json.dumps(fixtures.evidence_packet()), encoding="utf-8")
    merged = graph.merge_shards(
        [fixtures.shard(graph.assemble_model_shard, name,
                        extra_nodes=[_archivist()]) for name in sections],
        evidence_catalog={
            row["span_id"]: row for row in fixtures.evidence_packet()["spans"]
        },
    )
    (work / "module-graph.json").write_text(json.dumps(merged), encoding="utf-8")
    return work


def _installed(tmp_path: Path) -> None:
    bundle = _bundle(tmp_path)
    src = json.loads((bundle / "manifest.json").read_text())["source"]
    assets.init_module_root(tmp_path, asset_root_id="mod",
                            identity={"title": "Demo"},
                            file_sha256=src["file_sha256"], source=src)
    build.install_build(
        _work(tmp_path, ["opening", "cellar"]), bundle, workspace=tmp_path,
        asset_root_id="mod",
        plan={"sections": [{"section_id": "opening", "pdf_index_start": 0,
                            "pdf_index_end": 2}]},
    )


def _open_request(tmp_path: Path, job_id: str, pages: list[int]) -> None:
    """Written by the worker's own writer.

    An earlier draft hand-wrote the request JSON and the shape validator
    refused it on the spot -- which is the right outcome and the reason this
    goes through the real path: a request the product would never produce
    proves nothing about a reader that has to consume one.
    """
    index = assets.read_section_index(tmp_path, "mod") or {
        "schema_version": 1,
        "source_id": "pdf:table-fixture",
        "file_sha256": assets._module_identity_file_sha256(tmp_path, "mod"),
        "outline_sha256": "d" * 64,
        "sections": [],
    }
    sections = [row for row in index.get("sections") or []
                if row.get("section_id") != "attic"]
    sections.append({
        "section_id": "attic", "title": "阁楼", "payload": "narrative",
        "pdf_indices": list(pages), "audience": "keeper_only",
        "timing": "on_demand",
        "binding": {"kind": "global", "entity_kind": None, "entity_ids": []},
    })
    index["sections"] = sections
    assets.write_section_index(tmp_path, "mod", index)
    worker._write_host_work_request(tmp_path, "mod", {
        "job_id": job_id,
        "kind": assets.EXTRACT_SECTION_KIND,
        "target_id": "attic",
    })


def _reader_writing(section: str):
    """A reader that leaves an acceptable shard, standing in for the agent."""
    def reader(work_dir: Path, brief: str) -> None:
        shard = fixtures.shard(graph.assemble_model_shard, section)
        (Path(work_dir) / build.SHARD_NAME).write_text(
            json.dumps(shard), encoding="utf-8")
    return reader


def test_the_prepared_work_dir_carries_the_packets_and_the_books_own_names(tmp_path):
    _installed(tmp_path)
    _open_request(tmp_path, "job-1", [0, 1])
    out = deepen.prepare_work_dir(
        tmp_path, "mod", job_id="job-1", work_dir=tmp_path / "deepen",
    )
    assert out["status"] == "prepared", out
    assert (tmp_path / "deepen" / "extraction-packet.json").is_file()
    assert (tmp_path / "deepen" / "evidence-packet.json").is_file()
    request = json.loads((tmp_path / "deepen" / "request.json").read_text())
    # The names the installed shards already established travel with the
    # request, or the section mints a second id for a character the book has.
    roster = {row["node_id"]: row["name"] for row in request["known_nodes"]}
    assert roster.get("npc-the-archivist") == "档案员", (
        "the deepened section was not told the name the book already has, so it "
        "will mint a second id for the same character"
    )


def test_a_request_whose_pages_have_gone_missing_never_runs_a_reader(tmp_path):
    """Pages the book does not carry cannot even open a request -- that guard
    is upstream, in `build_extraction_request`. What reaches here is a request
    opened while the pages were cached whose artifacts are gone since. Spending
    a reader on it would produce a shard citing spans that no longer exist."""
    _installed(tmp_path)
    _open_request(tmp_path, "job-1", [0, 1])
    for page in (tmp_path / ".coc" / "module-assets" / "mod" / "pages").glob("*.md"):
        page.unlink()
    ran: list[int] = []

    def reader(work_dir, brief):
        ran.append(1)

    out = deepen.deepen_section(
        tmp_path, "mod", job_id="job-1", work_dir=tmp_path / "deepen",
        reader=reader,
    )
    assert out["status"] == "empty", out
    assert ran == [], "a reader was spent on pages that are no longer there"


def test_a_reader_that_leaves_nothing_does_not_close_the_request(tmp_path):
    """The failure that matters. An open request can still be answered by a
    host; a closed one is a section nobody read and nobody will."""
    _installed(tmp_path)
    _open_request(tmp_path, "job-1", [0, 1])

    def reader(work_dir, brief):
        return None

    out = deepen.deepen_section(
        tmp_path, "mod", job_id="job-1", work_dir=tmp_path / "deepen",
        reader=reader, max_rounds=1,
    )
    assert out["status"] == "not_accepted", out
    still_open = assets.get_host_work_request(tmp_path, "mod", "job-1")
    assert isinstance(still_open, dict), "the request was closed by a failed read"


def test_an_accepted_read_fulfils_the_request_and_grows_the_graph(tmp_path):
    _installed(tmp_path)
    _open_request(tmp_path, "job-1", [0, 1])
    before = len(list((assets.graph_shard_dir(tmp_path, "mod")).glob("*.shard.json")))
    out = deepen.deepen_section(
        tmp_path, "mod", job_id="job-1", work_dir=tmp_path / "deepen",
        reader=_reader_writing("attic"), max_rounds=1,
    )
    assert out["status"] == "fulfilled", out
    after = len(list((assets.graph_shard_dir(tmp_path, "mod")).glob("*.shard.json")))
    assert after == before + 1, "the section was read and kept nowhere"
    assert out["stored"]["from_shard"] is True
