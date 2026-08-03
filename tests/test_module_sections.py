#!/usr/bin/env python3
"""Contracts for the whole-book section index and its classification packet."""
from __future__ import annotations

import importlib.util
import os
from pathlib import Path

import pytest

os.environ["COC_DISABLE_QUEUE_WORKER"] = "1"

SCRIPTS = Path("plugins/coc-keeper/scripts")
FILE_SHA = "a" * 64
OUTLINE_SHA = "b" * 64


def _load(name: str, rel: str):
    spec = importlib.util.spec_from_file_location(name, rel)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


sections = _load("coc_module_sections_test", str(SCRIPTS / "coc_module_sections.py"))
assets = _load("coc_module_assets_sec_test", str(SCRIPTS / "coc_module_assets.py"))


def _outline(rows):
    return {
        "schema_version": 1,
        "contract_id": "coc.source-outline.v1",
        "producer": "host_outline",
        "confidence_class": "exact",
        "source_id": "pdf:test",
        "file_sha256": FILE_SHA,
        "outline_sha256": OUTLINE_SHA,
        "page_count": 20,
        "rows": rows,
    }


def _rows(*pairs):
    return [
        {"pdf_index": page, "order": order, "text": text,
         "weight": 18.0, "emphasis": False, "size_rank": 1}
        for order, (page, text) in enumerate(pairs, start=1)
    ]


def _request(*pairs, previews=None):
    outline = _outline(_rows(*pairs))
    return sections.build_classification_request(
        outline=outline,
        page_previews=previews or {},
        accepted_pdf_indices=list(range(1, 21)),
        job_id="job-1",
    )


def _row(section_id, title, pages, **over):
    row = {
        "section_id": section_id,
        "title": title,
        "pdf_indices": pages,
        "audience": "keeper_only",
        "timing": "on_demand",
        "payload": "narrative",
        "binding": {"kind": "global", "entity_kind": None, "entity_ids": []},
        "confidence": "high",
    }
    row.update(over)
    return row


# --- request projection ----------------------------------------------------

def test_request_offers_every_heading_as_a_candidate():
    request = _request((2, "给守密人的信息"), (7, "附录III-NPC"))
    assert [row["title"] for row in request["candidates"]] == [
        "给守密人的信息", "附录III-NPC",
    ]
    assert request["request_purpose"] == sections.CLASSIFY_PURPOSE


def test_a_page_is_previewed_once_no_matter_how_many_headings_it_carries():
    request = _request(
        (5, "地点"), (5, "医院"), (5, "大学"),
        previews={5: "some page body text"},
    )
    previewed = [row for row in request["candidates"] if row["preview"]]
    assert len(previewed) == 1


def test_previews_shrink_rather_than_headings_being_dropped():
    pairs = [(page, f"Heading {page}") for page in range(1, 21)]
    previews = {page: "x" * 5000 for page in range(1, 21)}
    request = _request(*pairs, previews=previews)
    assert len(request["candidates"]) == 20
    assert request["request_bytes"] <= sections.REQUEST_MAX_BYTES


def test_request_refuses_an_outline_without_a_source_digest():
    outline = _outline(_rows((1, "T")))
    outline["file_sha256"] = "short"
    # The projection lives in a sibling module loaded under its real name, so
    # match on the shared base class rather than this alias's own subclass.
    with pytest.raises(ValueError):
        sections.build_classification_request(
            outline=outline, page_previews={},
            accepted_pdf_indices=[1], job_id="job-1",
        )


def test_oversized_outline_is_chunked_by_page_rather_than_truncated():
    pairs = [(page, f"Heading number {page} with a title long enough to bulk")
             for page in range(1, 751)]
    outline = _outline(_rows(*pairs))
    outline["page_count"] = 750
    requests = sections.build_classification_requests(
        outline=outline,
        page_previews={page: "y" * 4000 for page in range(1, 751)},
        accepted_pdf_indices=list(range(1, 751)),
        job_id="job-1",
    )
    assert len(requests) > 1
    assert sum(len(r["candidates"]) for r in requests) == 750
    assert all(r["chunk"]["count"] == len(requests) for r in requests)
    spans = [(r["chunk"]["page_from"], r["chunk"]["page_to"]) for r in requests]
    assert spans == sorted(spans)


# --- result validation -----------------------------------------------------

def test_valid_rows_are_normalized_and_ordered_by_page():
    request = _request((9, "附录III-NPC"), (2, "给守密人的信息"))
    ids = {row["title"]: row["section_id"] for row in request["candidates"]}
    validated = sections.validate_section_rows([
        _row(ids["附录III-NPC"], "附录III-NPC", [9, 10]),
        _row(ids["给守密人的信息"], "给守密人的信息", [2, 3]),
    ], request=request)
    assert [row["pdf_indices"][0] for row in validated] == [2, 9]
    assert all(row["parse_state"] == "indexed" for row in validated)


def test_a_section_the_request_never_offered_is_rejected():
    request = _request((2, "给守密人的信息"))
    with pytest.raises(sections.SectionIndexError):
        sections.validate_section_rows(
            [_row("sec-999999", "Invented", [2])], request=request,
        )


def test_a_retitled_section_is_rejected():
    request = _request((2, "给守密人的信息"))
    sid = request["candidates"][0]["section_id"]
    with pytest.raises(sections.SectionIndexError):
        sections.validate_section_rows(
            [_row(sid, "Keeper Background (paraphrased)", [2])], request=request,
        )


def test_pages_must_start_at_the_heading_page():
    request = _request((5, "附录I-狩猎"))
    sid = request["candidates"][0]["section_id"]
    with pytest.raises(sections.SectionIndexError):
        sections.validate_section_rows(
            [_row(sid, "附录I-狩猎", [7, 8])], request=request,
        )


def test_pages_must_be_contiguous():
    request = _request((5, "附录I-狩猎"))
    sid = request["candidates"][0]["section_id"]
    with pytest.raises(sections.SectionIndexError):
        sections.validate_section_rows(
            [_row(sid, "附录I-狩猎", [5, 9])], request=request,
        )


def test_pages_may_not_run_past_the_source():
    request = _request((19, "尾声"))
    sid = request["candidates"][0]["section_id"]
    with pytest.raises(sections.SectionIndexError):
        sections.validate_section_rows(
            [_row(sid, "尾声", list(range(19, 30)))], request=request,
        )


def test_source_text_cannot_be_smuggled_through_an_extra_field():
    request = _request((2, "给守密人的信息"))
    sid = request["candidates"][0]["section_id"]
    with pytest.raises(sections.SectionIndexError):
        sections.validate_section_rows(
            [_row(sid, "给守密人的信息", [2], body="the actual module prose")],
            request=request,
        )


def test_entity_binding_requires_a_kind_and_at_least_one_id():
    request = _request((9, "附录III-NPC"))
    sid = request["candidates"][0]["section_id"]
    with pytest.raises(sections.SectionIndexError):
        sections.validate_section_rows([_row(
            sid, "附录III-NPC", [9],
            binding={"kind": "entity", "entity_kind": "npc", "entity_ids": []},
        )], request=request)
    validated = sections.validate_section_rows([_row(
        sid, "附录III-NPC", [9],
        binding={"kind": "entity", "entity_kind": "npc",
                 "entity_ids": ["npc-seth"]},
    )], request=request)
    assert validated[0]["binding"]["entity_ids"] == ["npc-seth"]


def test_global_binding_may_not_name_an_entity():
    request = _request((2, "内容警示"))
    sid = request["candidates"][0]["section_id"]
    with pytest.raises(sections.SectionIndexError):
        sections.validate_section_rows([_row(
            sid, "内容警示", [2],
            binding={"kind": "global", "entity_kind": "npc",
                     "entity_ids": ["npc-x"]},
        )], request=request)


def test_duplicate_section_ids_are_rejected():
    request = _request((2, "背景"))
    sid = request["candidates"][0]["section_id"]
    with pytest.raises(sections.SectionIndexError):
        sections.validate_section_rows(
            [_row(sid, "背景", [2]), _row(sid, "背景", [2])], request=request,
        )


@pytest.mark.parametrize("field,bad", [
    ("audience", "everyone"),
    ("timing", "someday"),
    ("payload", "prose"),
    ("confidence", "certain"),
])
def test_labels_outside_the_closed_vocabulary_are_rejected(field, bad):
    request = _request((2, "背景"))
    sid = request["candidates"][0]["section_id"]
    with pytest.raises(sections.SectionIndexError):
        sections.validate_section_rows(
            [_row(sid, "背景", [2], **{field: bad})], request=request,
        )


# --- index and coverage ----------------------------------------------------

def test_index_digest_binds_rows_to_the_outline_that_produced_them():
    request = _request((2, "背景"))
    sid = request["candidates"][0]["section_id"]
    index = sections.build_section_index(
        rows=[_row(sid, "背景", [2, 3])], request=request,
    )
    assert index["pass_status"] == "complete"
    assert index["section_index_sha256"] == sections.section_index_digest(
        index["sections"], OUTLINE_SHA,
    )
    assert index["section_index_sha256"] != sections.section_index_digest(
        index["sections"], "c" * 64,
    )


def test_coverage_ledger_reports_pages_no_section_reached():
    request = _request((2, "背景"))
    sid = request["candidates"][0]["section_id"]
    index = sections.build_section_index(
        rows=[_row(sid, "背景", [2, 3])], request=request,
    )
    ledger = sections.coverage_ledger(index)
    assert ledger["claimed_page_count"] == 2
    assert 1 in ledger["unclaimed_pdf_indices"]
    assert 20 in ledger["unclaimed_pdf_indices"]
    assert ledger["sections_by_state"] == {"indexed": 1}
    assert 0.0 < ledger["coverage_ratio"] < 1.0


# --- store wiring ----------------------------------------------------------

def test_section_index_store_rejects_a_foreign_source(tmp_path):
    assets.init_module_root(
        tmp_path, asset_root_id="mod-1", file_sha256=FILE_SHA, identity={},
    )
    request = _request((2, "背景"))
    sid = request["candidates"][0]["section_id"]
    index = sections.build_section_index(
        rows=[_row(sid, "背景", [2])], request=request,
    )
    stored = assets.write_section_index(tmp_path, "mod-1", index)
    assert stored["file_sha256"] == FILE_SHA
    assert assets.read_section_index(tmp_path, "mod-1")["sections"][0][
        "section_id"] == sid
    with pytest.raises(assets.ModuleAssetsError):
        assets.write_section_index(
            tmp_path, "mod-1", {**index, "file_sha256": "d" * 64},
        )


def test_classify_sections_is_a_structure_job_and_never_a_turn_dependency():
    assert sections.CLASSIFY_JOB_KIND in assets.JOB_KINDS
    assert assets._job_aspect(sections.CLASSIFY_JOB_KIND) == "structure"
    assert assets._job_entity_kind(sections.CLASSIFY_JOB_KIND) is None
    assert assets._default_host_work_level(
        sections.CLASSIFY_JOB_KIND) == "near_term"
