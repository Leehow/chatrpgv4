"""TDD coverage for PDF source evidence bridge v1."""
import importlib.util
import json
from pathlib import Path


def _load(name, rel):
    spec = importlib.util.spec_from_file_location(name, rel)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


pdf_cache = _load(
    "pdf_cache_source_v2",
    "plugins/coc-keeper/skills/trpg-pdf-ingest/scripts/pdf_cache.py",
)
coc_pdf_source = _load(
    "coc_pdf_source_tests",
    "plugins/coc-keeper/scripts/coc_pdf_source.py",
)
coc_scenario = _load(
    "coc_scenario_source_tests",
    "plugins/coc-keeper/scripts/coc_scenario.py",
)
coc_scenario_compile = _load(
    "coc_scenario_compile_source_tests",
    "plugins/coc-keeper/scripts/coc_scenario_compile.py",
)
coc_source_resolution = _load(
    "coc_source_resolution_tests",
    "plugins/coc-keeper/scripts/coc_source_resolution.py",
)


def test_pdf_cache_meta_v2_records_file_text_and_pipeline_hashes(tmp_path, monkeypatch):
    pdf = tmp_path / "book.pdf"
    pdf.write_bytes(b"first-pdf")
    monkeypatch.setattr(pdf_cache, "_parse_with_pymupdf4llm", lambda *a, **k: "# text")

    result = pdf_cache.extract_markdown(
        pdf, [0], use_ocr=False, cache_root=tmp_path / "cache"
    )

    meta = json.loads(Path(result["cache_path"]).with_suffix(".meta.json").read_text())
    assert meta["schema_version"] == 2
    assert len(meta["file_sha256"]) == 64
    assert len(meta["text_sha256"]) == 64
    assert meta["pipeline_version"] == 2
    assert result["meta"]["text_sha256"] == meta["text_sha256"]


def test_changed_pdf_hash_forces_reparse(tmp_path, monkeypatch):
    pdf = tmp_path / "book.pdf"
    pdf.write_bytes(b"first")
    calls = {"n": 0}

    def fake_parse(*args, **kwargs):
        calls["n"] += 1
        return f"parse-{calls['n']}"

    monkeypatch.setattr(pdf_cache, "_parse_with_pymupdf4llm", fake_parse)
    pdf_cache.extract_markdown(pdf, [0], use_ocr=False, cache_root=tmp_path / "cache")
    pdf.write_bytes(b"second")

    result = pdf_cache.extract_markdown(
        pdf, [0], use_ocr=False, cache_root=tmp_path / "cache"
    )

    assert result["cached"] is False
    assert result["markdown"] == "parse-2"
    assert calls["n"] == 2


def test_pipeline_version_change_forces_reparse(tmp_path, monkeypatch):
    pdf = tmp_path / "book.pdf"
    pdf.write_bytes(b"stable")
    calls = {"n": 0}

    def fake_parse(*args, **kwargs):
        calls["n"] += 1
        return f"parse-{calls['n']}"

    monkeypatch.setattr(pdf_cache, "_parse_with_pymupdf4llm", fake_parse)
    pdf_cache.extract_markdown(
        pdf, [0], use_ocr=False, cache_root=tmp_path / "cache", pipeline_version=2
    )
    result = pdf_cache.extract_markdown(
        pdf, [0], use_ocr=False, cache_root=tmp_path / "cache", pipeline_version=3
    )

    assert result["cached"] is False
    assert calls["n"] == 2


def test_missing_synthetic_pdf_keeps_legacy_cache_hit(tmp_path):
    path = pdf_cache.cache_path("pdf/missing.pdf", [1], cache_root=tmp_path)
    path.parent.mkdir(parents=True)
    path.write_text("legacy cached text")

    result = pdf_cache.extract_markdown(
        "pdf/missing.pdf", [1], cache_root=tmp_path
    )

    assert result["cached"] is True
    assert result["markdown"] == "legacy cached text"


def test_initialize_source_indexes_writes_three_files(tmp_path):
    campaign = tmp_path / "campaign"
    result = coc_pdf_source.initialize_source_indexes(
        campaign,
        "scenario-x",
        sources=[{"source_id": "pdf:x", "path": "pdf/x.pdf"}],
    )

    assert (campaign / "index" / "page-map.json").exists()
    assert (campaign / "index" / "parse-manifest.json").exists()
    assert (campaign / "index" / "evidence-segments.jsonl").exists()
    assert result["page_map"]["scenario_id"] == "scenario-x"


def _page_map():
    return {
        "schema_version": 1,
        "scenario_id": "s",
        "sources": [{
            "source_id": "pdf:x",
            "path": "pdf/x.pdf",
            "file_sha256": "f" * 64,
            "pages": [
                {"pdf_index": 9, "printed_page": 12, "printed_label": "12"},
                {"pdf_index": 10, "printed_page": 13, "printed_label": "13"},
            ],
        }],
    }


def test_printed_page_resolves_to_pdf_index():
    locator = coc_pdf_source.resolve_locator(
        {"source_id": "pdf:x", "printed_page": 12}, _page_map()
    )
    assert locator["pdf_index"] == 9
    assert locator["printed_page"] == 12


def test_pdf_index_resolves_to_printed_page():
    locator = coc_pdf_source.resolve_locator(
        {"source_id": "pdf:x", "pdf_index": 10}, _page_map()
    )
    assert locator["printed_page"] == 13


def test_legacy_page_kind_is_normalized():
    locator = coc_pdf_source.resolve_locator(
        {"source_id": "pdf:x", "page": 12, "page_kind": "printed"},
        _page_map(),
    )
    assert locator == {
        "source_id": "pdf:x",
        "pdf_index": 9,
        "printed_page": 12,
        "printed_label": "12",
    }


def _manifest(review_state="auto_accepted", confidence=0.91):
    return {
        "schema_version": 1,
        "scenario_id": "s",
        "ranges": [{
            "range_id": "range-9-10",
            "source_id": "pdf:x",
            "pdf_indices": [9, 10],
            "file_sha256": "f" * 64,
            "text_sha256": "t" * 64,
            "quality": {"overall": confidence},
            "review_state": review_state,
        }],
    }


def _segments(anchor="Corbitt", confidence=0.91):
    return [{
        "segment_id": "seg-1",
        "source_id": "pdf:x",
        "locator": {"pdf_index": 9, "printed_page": 12},
        "parse_confidence": confidence,
        "review_state": "auto_accepted",
        "grep_anchors": [anchor],
        "text": f"Evidence about {anchor}",
    }]


def test_critical_source_gate_accepts_reviewed_high_confidence():
    result = coc_pdf_source.critical_source_allowed(
        [{"source_id": "pdf:x", "printed_page": 12, "grep_anchor": "Corbitt"}],
        _manifest(),
        _segments(),
        page_map=_page_map(),
    )
    assert result["allowed"] is True
    assert result["confidence"] == 0.91
    assert result["findings"] == []


def test_critical_source_gate_rejects_needs_review():
    result = coc_pdf_source.critical_source_allowed(
        [{"source_id": "pdf:x", "printed_page": 12}],
        _manifest(review_state="needs_review"),
        _segments(),
        page_map=_page_map(),
    )
    assert result["allowed"] is False
    assert any(f["code"] == "source_needs_review" for f in result["findings"])


def test_critical_source_gate_rejects_missing_anchor():
    result = coc_pdf_source.critical_source_allowed(
        [{"source_id": "pdf:x", "printed_page": 12, "grep_anchor": "Missing"}],
        _manifest(),
        _segments(anchor="Corbitt"),
        page_map=_page_map(),
    )
    assert result["allowed"] is False
    assert any(f["code"] == "missing_source_anchor" for f in result["findings"])


def test_strip_local_evidence_text_removes_text_but_keeps_hash():
    bundle = {
        "page_map": _page_map(),
        "parse_manifest": _manifest(),
        "evidence_segments": _segments(),
    }
    stripped = coc_pdf_source.strip_local_evidence_text(bundle)
    assert "text" not in stripped["evidence_segments"][0]
    assert stripped["evidence_segments"][0]["segment_id"] == "seg-1"


def test_create_scenario_skeleton_initializes_source_indexes(tmp_path):
    campaign = tmp_path / "campaign"
    coc_scenario.create_scenario_skeleton(
        campaign,
        "scenario-x",
        "Scenario X",
        {"source_id": "pdf:x", "path": "pdf/x.pdf"},
    )
    assert (campaign / "index" / "page-map.json").exists()
    assert (campaign / "index" / "parse-manifest.json").exists()
    assert (campaign / "index" / "evidence-segments.jsonl").exists()


def _compiled_with_critical_question():
    return {
        "story_graph": {"scenes": [
            {"scene_id": "start", "is_start": True, "dramatic_question": "?", "available_clues": ["clue-a"], "npc_ids": [], "exit_targets": ["final"], "origin": "source"},
            {"scene_id": "final", "is_final": True, "scene_type": "resolution", "dramatic_question": "!", "available_clues": [], "npc_ids": [], "origin": "source"},
        ]},
        "clue_graph": {"conclusions": [{
            "conclusion_id": "c", "importance": "critical", "minimum_routes": 1,
            "fallback_policy": "recover", "origin": "source",
            "clues": [{"clue_id": "clue-a", "delivery_kind": "obvious", "leads_to": ["final"], "origin": "source"}],
        }]},
        "npc_agendas": {"npcs": []},
        "threat_fronts": {"fronts": []},
        "epistemic_graph": {"questions": [{
            "question_id": "q", "layer": "fact", "player_facing_question": "What?",
            "truth_ref": "truth-x", "importance": "critical",
            "source_refs": [{"source_id": "pdf:x", "printed_page": 12, "grep_anchor": "Corbitt"}],
        }], "evidence_links": [{"clue_id": "clue-a", "question_id": "q", "effect": "confirm"}]},
        "reveal_contracts": {"contracts": []},
    }


def test_compiler_errors_on_low_confidence_critical_question():
    bundle = {
        "page_map": _page_map(),
        "parse_manifest": _manifest(confidence=0.4),
        "evidence_segments": _segments(confidence=0.4),
    }
    findings = coc_scenario_compile.validate_compiled_scenario(
        _compiled_with_critical_question(), source_bundle=bundle, strict_sources=True
    )
    assert any(f["code"] == "low_source_confidence" and f["severity"] == "error" for f in findings)


def test_legacy_compiler_without_source_bundle_stays_compatible():
    compiled = _compiled_with_critical_question()
    compiled["epistemic_graph"]["questions"][0].pop("source_refs")
    findings = coc_scenario_compile.validate_compiled_scenario(compiled)
    assert not any(f["code"].startswith("source_") and f["severity"] == "error" for f in findings)


def test_source_resolution_request_is_minimum_privilege():
    request = coc_source_resolution.build_source_resolution_request(
        "q-motive",
        "critical_reveal_low_confidence",
        [{"source_id": "pdf:x", "printed_page": 12}],
    )
    assert request["allowed_outputs"] == [
        "player_safe_summary", "delivery_kind", "source_refs", "confidence"
    ]
    assert "raw_keeper_prose" in request["must_not_return"]
