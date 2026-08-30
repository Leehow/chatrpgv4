#!/usr/bin/env python3
"""Source-bound RuleGraph stage-1 prepared-candidate contract."""
from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
GENERATOR = ROOT / "tests" / "fixtures" / "_gen_rulegraph_source_stage1.py"
TREE = (
    ROOT / "plugins" / "coc-keeper" / "rulesets" / "coc7"
    / "rule-graph-candidates" / "source-stage1"
)


def _load_generator():
    spec = importlib.util.spec_from_file_location(
        "gen_rulegraph_source_stage1_tests", GENERATOR,
    )
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


gen = _load_generator()


def _read(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def _candidate_paths() -> list[Path]:
    return sorted((TREE / "candidates").glob("*.candidate.json"))


def test_source_stage1_is_revision_required_and_never_accepted():
    manifest = _read(TREE / "manifest-draft.json")
    assert manifest["review_status"] == "revision-required"
    assert manifest["reviewer_identity"] is None
    assert manifest["graph_content_digest"] is None
    assert all(row["shard_digest"] is None for row in manifest["shards"])
    assert not (TREE / "accepted").exists()
    assert all(
        row["promotion_eligible"] is False
        for row in manifest["family_promotion_eligibility"].values()
    )


def test_source_stage1_binds_real_pdf_windows_not_derivative_sources():
    manifest = _read(TREE / "manifest-draft.json")
    assert len(manifest["source_bundles"]) == 4
    assert {
        row["bundle_sha256"] for row in manifest["source_bundles"]
    } == {
        "5f15436d31063a78c0d8d3d290c98374fbcf9533dd8c76d0511065823c8bdeb1",
        "c9d4ddd344bf1c0b4dfb90323be0d43ff8f44cc0a6e5d3c4a6e8d1f486ef7516",
        "51234cc28d21c5ddf9acf28f00186fcf880ae97798e4ba8c1a011b98d8375043",
        "7779dba25613add8a5e11338bb95658debc925ce8109ef85f40ff8d278348a78",
    }
    for row in manifest["source_bundles"]:
        assert row["source_id"] == gen.SOURCE_ID
        assert row["file_sha256"] == gen.FILE_SHA256
    dumped = json.dumps(manifest)
    assert "rules-json:coc7:" not in dumped


def test_source_stage1_has_six_bounded_candidate_sections():
    paths = _candidate_paths()
    assert len(paths) == 6
    coverage = {}
    for path in paths:
        candidate = _read(path)
        coverage.update(candidate["coverage"])
        span_ids = {
            span
            for node in candidate["nodes"]
            for span in node.get("evidence_span_ids") or []
        }
        assert span_ids
        assert all("-page-0-block-" not in span for span in span_ids)
        assert all("-source-page-" in span for span in span_ids)
    assert coverage == {
        "combat": "partial",
        "core-check": "partial",
        "development": "partial",
        "psychology": "partial",
        "push-luck": "partial",
        "sanity": "partial",
        "social": "partial",
    }


def test_source_specific_gaps_replace_derivative_absence_claims():
    nodes = {}
    for path in _candidate_paths():
        nodes.update({row["node_id"]: row for row in _read(path)["nodes"]})
    assert "may not be negated by pushing" in nodes[
        "exception:coc7:push-luck:fumble-push-uncompiled"
    ]["name"]
    assert "higher of the matching interpersonal skill" in nodes[
        "exception:coc7:social:higher-of-composition-uncompiled"
    ]["name"]
    assert "truth-on-success" in nodes[
        "exception:coc7:psychology:truth-mapping-uncompiled"
    ]["name"]
    assert "source-backed SAN percentile check" in nodes[
        "exception:coc7:sanity:check-then-loss-uncompiled"
    ]["name"]


def test_provenance_names_exact_reviewed_pages_and_hashes():
    rows = sorted((TREE / "provenance").glob("*.provenance.json"))
    assert len(rows) == 6
    for path in rows:
        row = _read(path)
        source = row["source"]
        assert source["source_id"] == gen.SOURCE_ID
        assert source["file_sha256"] == gen.FILE_SHA256
        assert source["bundles"]
        for bundle in source["bundles"]:
            assert bundle["bundle_id"]
            assert len(bundle["bundle_sha256"]) == 64
            assert bundle["pages"]
            for page in bundle["pages"]:
                assert isinstance(page["pdf_index"], int)
                assert len(page["text_sha256"]) == 64
                assert page["review_state"] == "manual_accepted"
                assert 0 < page["parse_confidence"] < 1


def test_generator_cannot_self_accept_or_build():
    source = GENERATOR.read_text(encoding="utf-8")
    assert "rg.accept(" not in source
    assert "rg.build(" not in source
    assert '"review_status": "revision-required"' in source


def test_status_records_ocr_failure_and_single_non_text_gap():
    status = (TREE / "STATUS.md").read_text(encoding="utf-8")
    assert "provider code 10010" in status
    assert "was not retried" in status
    assert "PDF index 85" in status
    assert "PDF index 413" in status
    assert "pdftotext -layout" in status
    manifest = _read(TREE / "manifest-draft.json")
    assert {
        (row["code"], row["path"])
        for row in manifest["findings"]
        if row["code"] == "source_extraction_gap"
    } == {("source_extraction_gap", "/source/pdf-index-85")}


def test_recovered_weapon_page_is_bound_but_full_page_art_is_not():
    candidate = _read(
        TREE / "candidates" / "section-reference-lookups-source.candidate.json"
    )
    span_ids = {
        span
        for node in candidate["nodes"]
        for span in node.get("evidence_span_ids") or []
    }
    assert any("-source-page-413-" in span for span in span_ids)
    assert not any("-source-page-85-" in span for span in span_ids)


def test_external_source_bundles_reproduce_committed_tree(tmp_path: Path):
    raw_root = os.environ.get(gen.BUNDLE_ROOT_ENV)
    if not raw_root:
        pytest.skip(f"set {gen.BUNDLE_ROOT_ENV} for source-bundle regeneration")
    tree = gen.build_tree(Path(raw_root).expanduser().resolve())
    output = tmp_path / "source-stage1"
    gen.write_tree(tree, output)
    expected = {
        path.relative_to(TREE): path.read_bytes()
        for path in TREE.rglob("*.json")
    }
    actual = {
        path.relative_to(output): path.read_bytes()
        for path in output.rglob("*.json")
    }
    assert actual == expected
    for packet in tree["packets"]:
        refs = [
            span["source_ref"]
            for span in packet["evidence_binding"]["spans"]
        ]
        assert refs
        assert all(ref["source_id"] == gen.SOURCE_ID for ref in refs)
        assert all(ref["pdf_index"] > 0 for ref in refs)
        assert all(len(ref["text_sha256"]) == 64 for ref in refs)
