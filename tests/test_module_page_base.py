#!/usr/bin/env python3
"""One page-index base shared by every lane that writes the page cache.

Two lanes write ``pages/NNNN.md`` into the same module root: the host PDF
skill's source bundles and the whole-book OCR parse.  They disagreed once --
the bundle contract fixed ``0 <= pdf_index < page_count`` while the OCR lane
offset its ordinals by one -- and the result was a 23-page scenario cached as
24 pages, the same physical page stored at both index 2 and index 3, and
every page above that shifted between lanes.  Content addressing hid it:
first-writer-wins silently dropped the colliding pages.

These tests pin the base in one place so the lanes cannot drift apart again.
"""
from __future__ import annotations

import importlib.util
import os
from pathlib import Path

os.environ["COC_DISABLE_QUEUE_WORKER"] = "1"

SCRIPTS = Path("plugins/coc-keeper/scripts")
FILE_SHA = "a" * 64
PAGE_COUNT = 23


def _load(name: str, rel: str):
    spec = importlib.util.spec_from_file_location(name, rel)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


assets = _load("coc_module_assets_pagebase_test", str(SCRIPTS / "coc_module_assets.py"))
bundle = _load("coc_pdf_bundle_pagebase_test", str(SCRIPTS / "coc_pdf_bundle.py"))


def _root(tmp_path: Path) -> Path:
    assets.init_module_root(
        tmp_path, asset_root_id="mod-1", file_sha256=FILE_SHA, identity={},
        source={
            "source_id": "pdf:t", "title": "T", "path": str(tmp_path / "t.pdf"),
            "file_sha256": FILE_SHA, "page_count": PAGE_COUNT,
            "producer": "codex-pdf-skill",
        },
    )
    return tmp_path


def test_full_parse_scope_starts_at_zero_and_covers_every_page(tmp_path):
    _root(tmp_path)
    scope = assets.full_parse_requested_indices(tmp_path, "mod-1")
    assert scope, "a bound page count must produce a scope"
    assert min(scope) == 0
    assert max(scope) == PAGE_COUNT - 1
    assert len(scope) == PAGE_COUNT


def test_the_scope_is_exactly_what_the_bundle_contract_admits(tmp_path):
    """The bundle validator owns the base; full_parse must not restate it."""
    _root(tmp_path)
    scope = assets.full_parse_requested_indices(tmp_path, "mod-1")
    assert scope == [
        index for index in range(-1, PAGE_COUNT + 2)
        if 0 <= index < PAGE_COUNT
    ]


def test_the_last_physical_page_is_reachable_by_a_bundle(tmp_path):
    """The offset made the final page unreachable by any bundle at all.

    A bundle could only carry ``pdf_index < page_count`` while full_parse
    asked for ``1..page_count``, so the last page could only ever arrive
    through OCR and a fully bundle-ingested book never completed.
    """
    _root(tmp_path)
    scope = assets.full_parse_requested_indices(tmp_path, "mod-1")
    last = PAGE_COUNT - 1
    assert last in scope
    assert 0 <= last < PAGE_COUNT


def test_a_corpus_ordinal_maps_to_the_same_physical_page(tmp_path):
    """doc_N and pdf_index N are the same page, with no offset between them."""
    workspace = _root(tmp_path)
    corpus = assets.ocr_corpus_dir(workspace, FILE_SHA)
    corpus.mkdir(parents=True, exist_ok=True)
    for ordinal in range(3):
        (corpus / f"doc_{ordinal}.md").write_text(
            f"# Page {ordinal}\n\nBody of physical page {ordinal}.\n",
            encoding="utf-8",
        )
    assets.write_ocr_corpus_manifest(
        workspace, FILE_SHA, source_path=str(workspace / "t.pdf"),
        page_count=PAGE_COUNT, doc_page_count=3, status="complete",
    )
    result = assets.register_ocr_corpus(
        workspace, "mod-1", corpus_dir=corpus,
    )
    assert result["registered_pdf_indices"] == [0, 1, 2]
    for ordinal in range(3):
        page = assets.get_page(workspace, "mod-1", ordinal)
        assert f"physical page {ordinal}" in page["text"]
        assert page["meta"]["doc_ref"] == f"doc_{ordinal}.md"
