#!/usr/bin/env python3
"""End-to-end contract for the whole-book section classification lane."""
from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path

import pytest

os.environ["COC_DISABLE_QUEUE_WORKER"] = "1"

SCRIPTS = Path("plugins/coc-keeper/scripts")


def _load(name: str, rel: str):
    spec = importlib.util.spec_from_file_location(name, rel)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


assets = _load("coc_module_assets_lane_test", str(SCRIPTS / "coc_module_assets.py"))
worker = _load("coc_module_queue_worker_lane_test",
               str(SCRIPTS / "coc_module_queue_worker.py"))
store = _load("coc_module_outline_store_lane_test",
              str(SCRIPTS / "coc_module_outline_store.py"))
sections = _load("coc_module_sections_lane_test",
                 str(SCRIPTS / "coc_module_sections.py"))

PAGES = {
    1: "DUST TO DUST 归于尘埃 一个模组",
    2: "给守密人的信息 迈克尔谋杀了他的妻子弗吉尼娅，四年前。",
    3: "给调查员的信息 又一桩盗墓案！报纸如是说。",
    4: "人物数据 DR. HAMILTON FABRY STR 11 CON 12 SIZ 15",
}
OUTLINE_ROWS = [
    {"pdf_index": 2, "order": 1, "text": "给守密人的信息",
     "weight": 18.0, "emphasis": False, "size_rank": 1},
    {"pdf_index": 3, "order": 2, "text": "给调查员的信息",
     "weight": 18.0, "emphasis": False, "size_rank": 1},
    {"pdf_index": 4, "order": 3, "text": "人物数据",
     "weight": 18.0, "emphasis": False, "size_rank": 1},
]


@pytest.fixture()
def module_root(tmp_path, monkeypatch):
    file_sha = "f" * 64
    assets.init_module_root(
        tmp_path, asset_root_id="mod-1", file_sha256=file_sha, identity={},
        source={
            "source_id": "pdf:test", "title": "Dust to Dust",
            "path": str(tmp_path / "dust.pdf"), "file_sha256": file_sha,
            "page_count": 4, "producer": "codex-pdf-skill",
        },
    )
    for pdf_index, text in PAGES.items():
        assets.put_page(tmp_path, "mod-1", pdf_index, text, meta={
            "source_id": "pdf:test",
            "file_sha256": file_sha,
            "review_state": "auto_accepted",
            "parse_confidence": None,
            "source": "baiduocr",
            "unreviewed": True,
            "doc_ref": f"doc_{pdf_index - 1}.md",
        })
    outline = {
        "schema_version": 1,
        "contract_id": "coc.source-outline.v1",
        "producer": "host_outline",
        "confidence_class": "exact",
        "source_id": "pdf:test",
        "file_sha256": file_sha,
        "outline_sha256": "e" * 64,
        "page_count": 4,
        "rows": OUTLINE_ROWS,
    }
    (assets._module_dir(tmp_path, "mod-1") / store.OUTLINE_NAME).write_text(
        json.dumps(outline), encoding="utf-8",
    )
    return tmp_path, file_sha


def _enqueue_and_publish(workspace):
    job = {
        "job_id": "job-sections-1",
        "kind": assets.CLASSIFY_SECTIONS_KIND,
        "target_id": assets.SECTION_INDEX_TARGET_ID,
    }
    worker._write_host_work_request(workspace, "mod-1", job)
    return assets.get_host_work_request(workspace, "mod-1", "job-sections-1")


def test_request_carries_the_outline_and_no_page_refs(module_root):
    workspace, _ = module_root
    request = _enqueue_and_publish(workspace)
    assert request["kind"] == assets.CLASSIFY_SECTIONS_KIND
    assert request["source_aspect"] == "structure"
    # The classifier must never be handed the page-window view this lane
    # exists to replace.
    assert request["cached_page_refs"] == []
    packet = request["classification_request"]
    assert [row["title"] for row in packet["candidates"]] == [
        "给守密人的信息", "给调查员的信息", "人物数据",
    ]
    assert any(row["preview"] for row in packet["candidates"])


def test_previews_come_only_from_accepted_cached_pages(module_root):
    workspace, _ = module_root
    request = _enqueue_and_publish(workspace)
    packet = request["classification_request"]
    previews = {row["pdf_index"]: row["preview"]
                for row in packet["candidates"] if row["preview"]}
    assert set(previews) <= set(PAGES)
    assert "迈克尔" in previews[2]


def _rows_for(packet):
    ids = {row["title"]: row["section_id"] for row in packet["candidates"]}
    return [
        {"section_id": ids["给守密人的信息"], "title": "给守密人的信息",
         "pdf_indices": [2], "audience": "keeper_only", "timing": "pre_session",
         "payload": "narrative",
         "binding": {"kind": "global", "entity_kind": None, "entity_ids": []},
         "confidence": "high"},
        {"section_id": ids["给调查员的信息"], "title": "给调查员的信息",
         "pdf_indices": [3], "audience": "player_facing", "timing": "opening",
         "payload": "narrative",
         "binding": {"kind": "global", "entity_kind": None, "entity_ids": []},
         "confidence": "high"},
        {"section_id": ids["人物数据"], "title": "人物数据",
         "pdf_indices": [4], "audience": "keeper_only", "timing": "on_demand",
         "payload": "entity_stats",
         "binding": {"kind": "entity", "entity_kind": "npc",
                     "entity_ids": ["npc-hamilton-fabry"]},
         "confidence": "med"},
    ]


def test_fulfillment_stores_the_index_and_closes_the_request(module_root):
    workspace, _ = module_root
    request = _enqueue_and_publish(workspace)
    result = assets.put_section_index_and_fulfill_host_work(
        workspace, "mod-1",
        host_work_job_id="job-sections-1",
        section_rows=_rows_for(request["classification_request"]),
    )
    index = result["section_index"]
    assert index["pass_status"] == "complete"
    assert [row["payload"] for row in index["sections"]] == [
        "narrative", "narrative", "entity_stats",
    ]
    # The back-matter stat block that no location edge points at is now
    # addressable, which is the whole reason this lane exists.
    stats = index["sections"][-1]
    assert stats["binding"]["entity_ids"] == ["npc-hamilton-fabry"]
    closed = assets.get_host_work_request(workspace, "mod-1", "job-sections-1")
    assert closed["status"] == "fulfilled"
    assert assets.read_section_index(workspace, "mod-1")["sections"]


def test_fulfillment_rejects_a_section_the_request_never_offered(module_root):
    workspace, _ = module_root
    request = _enqueue_and_publish(workspace)
    rows = _rows_for(request["classification_request"])
    rows[0]["section_id"] = "sec-999999"
    # Loaded twice under different module names; match by base class.
    with pytest.raises(ValueError):
        assets.put_section_index_and_fulfill_host_work(
            workspace, "mod-1",
            host_work_job_id="job-sections-1", section_rows=rows,
        )
    still_open = assets.get_host_work_request(workspace, "mod-1", "job-sections-1")
    assert still_open.get("status") != "fulfilled"
    assert assets.read_section_index(workspace, "mod-1") is None


def test_fulfillment_rejects_pages_outside_the_request(module_root):
    workspace, _ = module_root
    request = _enqueue_and_publish(workspace)
    rows = _rows_for(request["classification_request"])
    rows[0]["pdf_indices"] = [2, 3, 4, 5, 6, 7]
    # Loaded twice under different module names; match by base class.
    with pytest.raises(ValueError):
        assets.put_section_index_and_fulfill_host_work(
            workspace, "mod-1",
            host_work_job_id="job-sections-1", section_rows=rows,
        )


def test_a_request_cannot_be_fulfilled_twice(module_root):
    workspace, _ = module_root
    request = _enqueue_and_publish(workspace)
    rows = _rows_for(request["classification_request"])
    assets.put_section_index_and_fulfill_host_work(
        workspace, "mod-1", host_work_job_id="job-sections-1", section_rows=rows,
    )
    with pytest.raises(assets.ModuleAssetsError):
        assets.put_section_index_and_fulfill_host_work(
            workspace, "mod-1",
            host_work_job_id="job-sections-1", section_rows=rows,
        )


def test_coverage_ledger_exposes_pages_the_index_never_reached(module_root):
    workspace, _ = module_root
    request = _enqueue_and_publish(workspace)
    result = assets.put_section_index_and_fulfill_host_work(
        workspace, "mod-1",
        host_work_job_id="job-sections-1",
        section_rows=_rows_for(request["classification_request"]),
    )
    # Page 1 is the cover: rendered by full_parse, understood by nothing.
    assert result["coverage"]["unclaimed_pdf_indices"] == [1]


def test_outline_store_refuses_a_source_whose_bytes_changed(tmp_path):
    assets.init_module_root(
        tmp_path, asset_root_id="mod-2", file_sha256="a" * 64, identity={},
    )
    with pytest.raises(store.SourceOutlineError):
        store.ensure_outline(tmp_path, "mod-2")
