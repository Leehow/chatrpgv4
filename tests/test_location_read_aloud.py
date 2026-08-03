#!/usr/bin/env python3
"""Contracts for read-aloud passages and Keeper-only notes on location packs."""
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


assets = _load("coc_module_assets_ra_test", str(SCRIPTS / "coc_module_assets.py"))
project = _load("coc_module_project_ra_test", str(SCRIPTS / "coc_module_project.py"))

REFS = [{"source_id": "pdf:test", "pdf_index": 7}]


def _pack(**over):
    doc = {
        "location_id": "loc-flat",
        "title": "合租公寓",
        "parse_state": "deep",
        "player_safe_summary": "你们合租的公寓。",
    }
    doc.update(over)
    return doc


def _validate(doc):
    assets._validate_location_read_aloud(doc)
    assets._validate_location_keeper_only(doc)


def _aloud(**over):
    row = {
        "id": "ra-opening",
        "trigger": "on_first_enter",
        "text": "你把餐点从袋子里拿出来放到桌上，一股浓郁的香料味扑鼻而来。",
        "source_refs": REFS,
    }
    row.update(over)
    return row


def _note(**over):
    row = {
        "id": "ko-meat",
        "note": "这些肉来自失踪的邻居；玩家此时无从得知。",
        "source_refs": REFS,
    }
    row.update(over)
    return row


# --- read aloud ------------------------------------------------------------

def test_a_location_without_boxed_text_stays_valid():
    _validate(_pack())


def test_a_read_aloud_passage_is_accepted_with_evidence():
    _validate(_pack(read_aloud=[_aloud()]))


def test_read_aloud_requires_its_own_page_evidence():
    # The pack's own refs do not stand in: this text is quoted verbatim.
    with pytest.raises(assets.ModuleAssetsError):
        _validate(_pack(read_aloud=[_aloud(source_refs=[])]))


def test_read_aloud_requires_non_empty_text():
    with pytest.raises(assets.ModuleAssetsError):
        _validate(_pack(read_aloud=[_aloud(text="   ")]))


def test_read_aloud_trigger_must_be_known():
    with pytest.raises(assets.ModuleAssetsError):
        _validate(_pack(read_aloud=[_aloud(trigger="whenever")]))


def test_a_conditional_passage_must_say_what_the_condition_is():
    with pytest.raises(assets.ModuleAssetsError):
        _validate(_pack(read_aloud=[_aloud(trigger="on_clue")]))
    _validate(_pack(read_aloud=[
        _aloud(trigger="on_clue", condition="调查员发现了冷库"),
    ]))


def test_duplicate_read_aloud_ids_are_rejected():
    with pytest.raises(assets.ModuleAssetsError):
        _validate(_pack(read_aloud=[_aloud(), _aloud()]))


def test_read_aloud_rejects_unsupported_fields():
    with pytest.raises(assets.ModuleAssetsError):
        _validate(_pack(read_aloud=[_aloud(audience="keeper_only")]))


def test_an_oversized_passage_is_rejected():
    with pytest.raises(assets.ModuleAssetsError):
        _validate(_pack(read_aloud=[
            _aloud(text="x" * (assets.READ_ALOUD_MAX_BYTES + 1)),
        ]))


# --- keeper only -----------------------------------------------------------

def test_a_keeper_note_is_accepted_with_evidence():
    _validate(_pack(keeper_only=[_note()]))


def test_a_keeper_note_cannot_carry_an_audience_of_its_own():
    # Everything in this container is Keeper-only by construction; a row that
    # could declare otherwise is exactly how a solution leaks to players.
    with pytest.raises(assets.ModuleAssetsError):
        _validate(_pack(keeper_only=[_note(audience="player_facing")]))
    with pytest.raises(assets.ModuleAssetsError):
        _validate(_pack(keeper_only=[_note(player_safe_summary="安全的说法")]))


def test_a_keeper_note_requires_text_and_evidence():
    with pytest.raises(assets.ModuleAssetsError):
        _validate(_pack(keeper_only=[_note(note="")]))
    with pytest.raises(assets.ModuleAssetsError):
        _validate(_pack(keeper_only=[_note(source_refs=[])]))


def test_duplicate_keeper_note_ids_are_rejected():
    with pytest.raises(assets.ModuleAssetsError):
        _validate(_pack(keeper_only=[_note(), _note()]))


def test_keeper_notes_must_be_a_list():
    with pytest.raises(assets.ModuleAssetsError):
        _validate(_pack(keeper_only={"id": "ko-1"}))


# --- IR merge --------------------------------------------------------------

def _ir():
    return {
        "module-meta.json": {"schema_version": 1},
        "story-graph.json": {"scenes": [{
            "scene_id": "loc-flat", "title": "合租公寓",
            "parse_state": "named_only", "scene_edges": [],
        }]},
        "clue-graph.json": {"conclusions": []},
        "npc-agendas.json": {"npcs": []},
        "threat-fronts.json": {"fronts": []},
        "pacing-map.json": {"curve": []},
        "improvisation-boundaries.json": {
            "invent_allowed": [], "never_invent": [], "keeper_secrets": [],
        },
    }


def test_merge_keeps_keeper_notes_under_one_excludable_key():
    merged = project.merge_deep_location_into_ir(
        _ir(), _pack(read_aloud=[_aloud()], keeper_only=[_note()]),
    )
    scene = merged["story-graph.json"]["scenes"][0]
    assert scene["read_aloud"][0]["id"] == "ra-opening"
    assert scene["keeper_only"][0]["id"] == "ko-meat"
    # A player-facing projection has exactly one key to exclude, rather than
    # having to recognize Keeper material scattered across scene fields.
    assert "失踪的邻居" not in str(scene.get("player_safe_summary") or "")
    assert "失踪的邻居" not in str(scene.get("read_aloud") or "")


def test_merge_leaves_the_fields_absent_when_the_pack_has_none():
    merged = project.merge_deep_location_into_ir(_ir(), _pack())
    scene = merged["story-graph.json"]["scenes"][0]
    assert "read_aloud" not in scene
    assert "keeper_only" not in scene
