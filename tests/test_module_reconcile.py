#!/usr/bin/env python3
"""Contracts for cross-section reconciliation."""
from __future__ import annotations

import importlib.util
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


rec = _load("coc_module_reconcile_test", str(SCRIPTS / "coc_module_reconcile.py"))

INDEX = {
    "source_id": "pdf:test",
    "file_sha256": "f" * 64,
    "sections": [
        {"section_id": "sec-000001", "title": "给守密人的信息",
         "pdf_indices": [2], "audience": "keeper_only", "timing": "pre_session",
         "payload": "narrative", "parse_state": "resolved",
         "binding": {"kind": "global", "entity_kind": None, "entity_ids": []}},
        {"section_id": "sec-000009", "title": "人物数据",
         "pdf_indices": [21], "audience": "keeper_only", "timing": "on_demand",
         "payload": "entity_stats", "parse_state": "resolved",
         "binding": {"kind": "global", "entity_kind": None, "entity_ids": []}},
        {"section_id": "sec-000012", "title": "结束冒险",
         "pdf_indices": [23], "audience": "keeper_only", "timing": "resolution",
         "payload": "narrative", "parse_state": "resolved",
         "binding": {"kind": "global", "entity_kind": None, "entity_ids": []}},
    ],
}
SKELETON = {
    "npc_roster": [
        {"npc_id": "npc-fabry", "names": ["汉密尔顿·法布瑞"],
         "source_page_indices": [7]},
        {"npc_id": "npc-felder", "names": ["迈克尔·费尔德"],
         "source_page_indices": [7]},
    ],
    "item_roster": [{"item_id": "item-salts", "label": "精盐"}],
    "locations": [{"location_id": "loc-martin-beach", "title": "马丁滩"}],
}
SCENES = [{"scene_id": "loc-martin-beach", "title": "马丁滩"}]


def _request():
    return rec.build_reconciliation_request(
        index=INDEX, skeleton=SKELETON, scenes=SCENES, job_id="job-rec-1",
    )


def _mapping(**over):
    row = {
        "kind": "stats_for_entity",
        "section_id": "sec-000009",
        "target_kind": "npc",
        "target_id": "npc-fabry",
        "confidence": "high",
        "note": "",
    }
    row.update(over)
    return row


# --- request ---------------------------------------------------------------

def test_request_carries_identifiers_and_never_section_bodies():
    request = _request()
    flat = str(request)
    assert "sec-000009" in flat
    assert "npc-fabry" in flat
    for section in request["sections"]:
        assert set(section) == {
            "section_id", "title", "pdf_indices", "audience", "timing",
            "payload", "pack_kind", "binding", "parse_state",
        }
        assert "body_markdown" not in section
        assert "highlights" not in section


def test_request_refuses_an_index_with_no_sections():
    with pytest.raises(rec.ReconciliationError):
        rec.build_reconciliation_request(
            index={"sections": []}, skeleton=SKELETON, job_id="job-1",
        )


# --- mappings --------------------------------------------------------------

def test_a_back_section_stat_block_can_be_linked_to_an_in_body_character():
    result = rec.validate_reconciliation(
        {"mappings": [_mapping()], "conflicts": []}, request=_request(),
    )
    assert result["mappings"][0]["target_id"] == "npc-fabry"
    assert result["mappings"][0]["review_state"] == "accepted"
    assert result["accepted_count"] == 1


def test_reconciliation_may_not_introduce_a_new_entity():
    with pytest.raises(rec.ReconciliationError):
        rec.validate_reconciliation(
            {"mappings": [_mapping(target_id="npc-invented")], "conflicts": []},
            request=_request(),
        )


def test_reconciliation_may_not_reference_an_unknown_section():
    with pytest.raises(rec.ReconciliationError):
        rec.validate_reconciliation(
            {"mappings": [_mapping(section_id="sec-999999")], "conflicts": []},
            request=_request(),
        )


def test_target_kind_must_suit_the_mapping_kind():
    with pytest.raises(rec.ReconciliationError):
        rec.validate_reconciliation(
            {"mappings": [_mapping(
                kind="resolution_for_scene", target_kind="npc",
                target_id="npc-fabry")], "conflicts": []},
            request=_request(),
        )


def test_a_resolution_section_can_be_attached_to_a_scene():
    result = rec.validate_reconciliation({"mappings": [_mapping(
        kind="resolution_for_scene", section_id="sec-000012",
        target_kind="scene", target_id="loc-martin-beach",
    )], "conflicts": []}, request=_request())
    assert result["mappings"][0]["kind"] == "resolution_for_scene"


def test_a_section_cannot_continue_itself():
    with pytest.raises(rec.ReconciliationError):
        rec.validate_reconciliation({"mappings": [_mapping(
            kind="section_continues", section_id="sec-000009",
            target_kind="section", target_id="sec-000009",
        )], "conflicts": []}, request=_request())


def test_low_confidence_mappings_are_held_for_review_not_applied():
    result = rec.validate_reconciliation(
        {"mappings": [_mapping(confidence="low")], "conflicts": []},
        request=_request(),
    )
    assert result["mappings"][0]["review_state"] == "needs_review"
    assert result["accepted_count"] == 0
    assert result["needs_review_count"] == 1


def test_duplicate_mappings_are_rejected():
    with pytest.raises(rec.ReconciliationError):
        rec.validate_reconciliation(
            {"mappings": [_mapping(), _mapping()], "conflicts": []},
            request=_request(),
        )


def test_prose_cannot_be_smuggled_through_an_extra_field():
    with pytest.raises(rec.ReconciliationError):
        rec.validate_reconciliation(
            {"mappings": [{**_mapping(), "body": "the module says..."}],
             "conflicts": []},
            request=_request(),
        )


def test_notes_cannot_grow_into_a_summary():
    with pytest.raises(rec.ReconciliationError):
        rec.validate_reconciliation(
            {"mappings": [_mapping(note="x" * (rec.NOTE_MAX_CHARS + 1))],
             "conflicts": []},
            request=_request(),
        )


def test_top_level_extra_keys_are_rejected():
    with pytest.raises(rec.ReconciliationError):
        rec.validate_reconciliation(
            {"mappings": [], "conflicts": [], "summary": "..."},
            request=_request(),
        )


# --- conflicts -------------------------------------------------------------

def test_ambiguity_is_recorded_rather_than_resolved():
    result = rec.validate_reconciliation({"mappings": [], "conflicts": [{
        "kind": "ambiguous_match", "section_id": "sec-000009",
        "candidate_ids": ["npc-fabry", "npc-felder"], "note": "same surname",
    }]}, request=_request())
    conflict = result["conflicts"][0]
    assert conflict["candidate_ids"] == ["npc-fabry", "npc-felder"]
    assert conflict["review_state"] == "needs_review"


def test_claimed_ambiguity_needs_at_least_two_candidates():
    with pytest.raises(rec.ReconciliationError):
        rec.validate_reconciliation({"mappings": [], "conflicts": [{
            "kind": "ambiguous_match", "section_id": "sec-000009",
            "candidate_ids": ["npc-fabry"], "note": "",
        }]}, request=_request())


def test_an_unmatched_section_is_reported_as_an_orphan():
    result = rec.validate_reconciliation({"mappings": [], "conflicts": [{
        "kind": "orphan_section", "section_id": "sec-000001",
        "candidate_ids": [], "note": "",
    }]}, request=_request())
    assert result["conflicts"][0]["kind"] == "orphan_section"


def test_conflict_candidates_must_be_known_ids():
    with pytest.raises(rec.ReconciliationError):
        rec.validate_reconciliation({"mappings": [], "conflicts": [{
            "kind": "ambiguous_match", "section_id": "sec-000009",
            "candidate_ids": ["npc-fabry", "npc-ghost"], "note": "",
        }]}, request=_request())


# --- application -----------------------------------------------------------

def test_applying_reconciliation_adds_links_without_touching_sections():
    result = rec.validate_reconciliation({
        "mappings": [_mapping()],
        "conflicts": [{"kind": "orphan_section", "section_id": "sec-000001",
                       "candidate_ids": [], "note": ""}],
    }, request=_request())
    applied = rec.apply_to_section_index(INDEX, result)
    stats = next(row for row in applied["sections"]
                 if row["section_id"] == "sec-000009")
    assert stats["links"][0]["target_id"] == "npc-fabry"
    # Labels, pages and payload are untouched: a wrong link is a droppable
    # pointer, never a corrupted section.
    assert stats["payload"] == "entity_stats"
    assert stats["pdf_indices"] == [21]
    assert stats["audience"] == "keeper_only"
    orphan = next(row for row in applied["sections"]
                  if row["section_id"] == "sec-000001")
    assert orphan["conflicts"][0]["kind"] == "orphan_section"
    assert applied["reconciliation"]["accepted_count"] == 1
    # The original index object is not mutated in place.
    assert "links" not in INDEX["sections"][1]


def test_empty_reconciliation_is_valid():
    result = rec.validate_reconciliation(
        {"mappings": [], "conflicts": []}, request=_request(),
    )
    assert result["accepted_count"] == 0
    assert result["needs_review_count"] == 0
