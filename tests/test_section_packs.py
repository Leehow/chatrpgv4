#!/usr/bin/env python3
"""Contracts for extracting one indexed section into a document."""
from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path

import pytest

os.environ["COC_DISABLE_QUEUE_WORKER"] = "1"

SCRIPTS = Path("plugins/coc-keeper/scripts")
FILE_SHA = "f" * 64


def _load(name: str, rel: str):
    spec = importlib.util.spec_from_file_location(name, rel)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


packs = _load("coc_module_section_packs_test",
              str(SCRIPTS / "coc_module_section_packs.py"))
assets = _load("coc_module_assets_packs_test", str(SCRIPTS / "coc_module_assets.py"))
worker = _load("coc_module_queue_worker_packs_test",
               str(SCRIPTS / "coc_module_queue_worker.py"))

SECTION = {
    "section_id": "sec-000001",
    "title": "给守密人的信息",
    "pdf_indices": [2, 3],
    "audience": "keeper_only",
    "timing": "pre_session",
    "payload": "narrative",
    "binding": {"kind": "global", "entity_kind": None, "entity_ids": []},
    "confidence": "high",
    "parse_state": "indexed",
}
INDEX = {"source_id": "pdf:test", "file_sha256": FILE_SHA, "page_count": 4}
REFS = [
    {"source_id": "pdf:test", "pdf_index": 2, "path": "/x/2.md"},
    {"source_id": "pdf:test", "pdf_index": 3, "path": "/x/3.md"},
]


def _request(section=None, refs=None):
    return packs.build_extraction_request(
        section=section or SECTION, index=INDEX,
        cached_page_refs=refs if refs is not None else REFS,
        job_id="job-extract-1",
    )


def _pack(**over):
    pack = {
        "section_id": "sec-000001",
        "pack_kind": "keeper_truth",
        "title": "给守密人的信息",
        "body_markdown": "迈克尔·费尔德四年前谋杀了妻子弗吉尼娅。",
        "highlights": ["费尔德是凶手", "复活实验发生在地窖"],
        "source_refs": [
            {"source_id": "pdf:test", "pdf_index": 2},
            {"source_id": "pdf:test", "pdf_index": 3},
        ],
    }
    pack.update(over)
    return pack


# --- request ---------------------------------------------------------------

def test_request_offers_only_pack_kinds_the_payload_supports():
    request = _request()
    allowed = request["result_contract"]["allowed_pack_kinds"]
    assert "keeper_truth" in allowed
    assert "pregen" not in allowed
    assert "handout" not in allowed


def test_request_refuses_pages_missing_from_the_accepted_cache():
    with pytest.raises(packs.SectionPackError):
        _request(refs=[REFS[0]])


def test_request_carries_only_the_sections_own_pages():
    request = _request(refs=[*REFS, {"source_id": "pdf:test", "pdf_index": 9}])
    assert [ref["pdf_index"] for ref in request["cached_page_refs"]] == [2, 3]


# --- result validation -----------------------------------------------------

def test_valid_pack_takes_its_labels_from_the_index_not_the_worker():
    head = packs.validate_section_pack(_pack(), request=_request())
    assert head["audience"] == "keeper_only"
    assert head["timing"] == "pre_session"
    assert head["parse_state"] == "resolved"
    assert head["provenance"]["authority"] == "source_authored"
    assert head["body_sha256"]
    assert "body_markdown" not in head


def test_a_worker_cannot_relabel_keeper_material_as_player_facing():
    # audience is not an accepted field at all, so an attempt to set it is a
    # contract violation rather than a silently ignored value.
    with pytest.raises(packs.SectionPackError):
        packs.validate_section_pack(
            _pack(audience="player_facing"), request=_request(),
        )


def test_pack_kind_outside_the_payloads_allowance_is_rejected():
    with pytest.raises(packs.SectionPackError):
        packs.validate_section_pack(_pack(pack_kind="pregen"), request=_request())


def test_pack_bound_to_another_section_is_rejected():
    with pytest.raises(packs.SectionPackError):
        packs.validate_section_pack(
            _pack(section_id="sec-000002"), request=_request(),
        )


def test_retitled_section_is_rejected():
    with pytest.raises(packs.SectionPackError):
        packs.validate_section_pack(_pack(title="Keeper Info"), request=_request())


def test_empty_body_is_rejected():
    with pytest.raises(packs.SectionPackError):
        packs.validate_section_pack(_pack(body_markdown="   "), request=_request())


def test_oversized_body_is_rejected():
    with pytest.raises(packs.SectionPackError):
        packs.validate_section_pack(
            _pack(body_markdown="x" * (packs.BODY_MAX_BYTES + 1)),
            request=_request(),
        )


def test_source_ref_outside_the_request_is_rejected():
    with pytest.raises(packs.SectionPackError):
        packs.validate_section_pack(
            _pack(source_refs=[{"source_id": "pdf:test", "pdf_index": 9}]),
            request=_request(),
        )


def test_source_ref_naming_a_foreign_source_is_rejected():
    with pytest.raises(packs.SectionPackError):
        packs.validate_section_pack(
            _pack(source_refs=[{"source_id": "pdf:other", "pdf_index": 2}]),
            request=_request(),
        )


def test_missing_source_refs_are_rejected():
    with pytest.raises(packs.SectionPackError):
        packs.validate_section_pack(_pack(source_refs=[]), request=_request())


def test_highlights_may_not_become_a_second_body():
    with pytest.raises(packs.SectionPackError):
        packs.validate_section_pack(
            _pack(highlights=["y" * (packs.HIGHLIGHT_MAX_CHARS + 1)]),
            request=_request(),
        )


# --- document rendering ----------------------------------------------------

def test_document_records_its_own_provenance_header():
    head = packs.validate_section_pack(_pack(), request=_request())
    document = packs.section_document(head, "迈克尔谋杀了弗吉尼娅。")
    assert "# 给守密人的信息" in document
    assert "sec-000001" in document
    assert "pages 2, 3" in document
    assert FILE_SHA in document
    assert "迈克尔谋杀了弗吉尼娅。" in document


# --- store round trip ------------------------------------------------------

@pytest.fixture()
def module_root(tmp_path):
    assets.init_module_root(
        tmp_path, asset_root_id="mod-1", file_sha256=FILE_SHA, identity={},
        source={
            "source_id": "pdf:test", "title": "T",
            "path": str(tmp_path / "t.pdf"), "file_sha256": FILE_SHA,
            "page_count": 4, "producer": "codex-pdf-skill",
        },
    )
    for pdf_index in (2, 3):
        assets.put_page(
            tmp_path, "mod-1", pdf_index, f"page {pdf_index} body text",
            meta={
                "source_id": "pdf:test", "file_sha256": FILE_SHA,
                "review_state": "auto_accepted", "parse_confidence": None,
                "source": "baiduocr", "unreviewed": True,
                "doc_ref": f"doc_{pdf_index - 1}.md",
            },
        )
    index = {
        "schema_version": 1, "contract_id": "coc.section-index.v1",
        "source_id": "pdf:test", "file_sha256": FILE_SHA,
        "outline_sha256": "e" * 64, "page_count": 4,
        "pass_status": "complete", "sections": [dict(SECTION)],
    }
    assets.write_section_index(tmp_path, "mod-1", index)
    return tmp_path


def _publish(workspace):
    worker._write_host_work_request(workspace, "mod-1", {
        "job_id": "job-extract-1",
        "kind": assets.EXTRACT_SECTION_KIND,
        "target_id": "sec-000001",
    })
    return assets.get_host_work_request(workspace, "mod-1", "job-extract-1")


def test_extract_request_is_built_from_the_stored_index(module_root):
    request = _publish(module_root)
    assert request["source_aspect"] == "structure"
    extraction = request["extraction_request"]
    assert extraction["section_id"] == "sec-000001"
    assert extraction["requested_pdf_indices"] == [2, 3]
    assert [ref["pdf_index"] for ref in request["cached_page_refs"]] == [2, 3]


def test_repository_writes_the_document_and_marks_the_section_resolved(module_root):
    _publish(module_root)
    result = assets.put_section_pack_and_fulfill_host_work(
        module_root, "mod-1", host_work_job_id="job-extract-1", pack=_pack(),
    )
    body_path = Path(result["body_path"])
    assert body_path.is_file()
    assert "迈克尔" in body_path.read_text(encoding="utf-8")
    stored = assets.get_section_pack(module_root, "mod-1", "sec-000001")
    assert stored["pack_kind"] == "keeper_truth"
    assert stored["body_present"] is True
    index = assets.read_section_index(module_root, "mod-1")
    assert index["sections"][0]["parse_state"] == "resolved"
    closed = assets.get_host_work_request(module_root, "mod-1", "job-extract-1")
    assert closed["status"] == "fulfilled"


def test_a_rejected_pack_leaves_no_document_behind(module_root):
    _publish(module_root)
    with pytest.raises(ValueError):
        assets.put_section_pack_and_fulfill_host_work(
            module_root, "mod-1", host_work_job_id="job-extract-1",
            pack=_pack(source_refs=[{"source_id": "pdf:test", "pdf_index": 9}]),
        )
    assert assets.get_section_pack(module_root, "mod-1", "sec-000001") is None
    index = assets.read_section_index(module_root, "mod-1")
    assert index["sections"][0]["parse_state"] == "indexed"


def test_extract_target_must_exist_in_the_index(module_root):
    with pytest.raises(ValueError):
        worker._write_host_work_request(module_root, "mod-1", {
            "job_id": "job-extract-2",
            "kind": assets.EXTRACT_SECTION_KIND,
            "target_id": "sec-999999",
        })


def test_every_index_payload_label_resolves_to_at_least_one_pack_kind():
    sections_mod = _load("coc_module_sections_packs_test",
                         str(SCRIPTS / "coc_module_sections.py"))
    for payload in sections_mod.PAYLOADS:
        kinds = packs.PAYLOAD_PACK_KINDS.get(payload)
        assert kinds, f"payload {payload} has no pack kind"
        assert set(kinds) <= packs.PACK_KINDS


def test_stored_head_is_json_serializable_without_the_body(module_root):
    _publish(module_root)
    assets.put_section_pack_and_fulfill_host_work(
        module_root, "mod-1", host_work_job_id="job-extract-1", pack=_pack(),
    )
    raw = assets.section_pack_path(module_root, "mod-1", "sec-000001").read_text(
        encoding="utf-8")
    head = json.loads(raw)
    assert "body_markdown" not in head
    assert head["body_bytes"] > 0
