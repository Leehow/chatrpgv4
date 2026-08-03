#!/usr/bin/env python3
"""Contracts for resolving authored mechanics on Mythos entities."""
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


assets = _load("coc_module_assets_threat_test", str(SCRIPTS / "coc_module_assets.py"))
mechanics = _load("coc_mechanics_threat_test", str(SCRIPTS / "coc_mechanics.py"))
project = _load("coc_module_project_threat_test",
                str(SCRIPTS / "coc_module_project.py"))
toolbox = _load("coc_toolbox_threat_test", str(SCRIPTS / "coc_toolbox.py"))


def test_threat_is_a_mechanics_subject():
    # A monster appendix is the single most common place a published scenario
    # keeps game numbers the location graph cannot reach.
    assert "threat" in assets.MECHANICS_SUBJECT_KINDS
    assert assets.MECHANICS_JOB_FOR_SUBJECT["threat"] == "resolve_threat_mechanics"
    assert "resolve_threat_mechanics" in assets.JOB_KINDS


def test_the_threat_job_maps_back_to_its_entity_kind():
    assert assets._job_entity_kind("resolve_threat_mechanics") == "threat"
    assert assets._job_aspect("resolve_threat_mechanics") == "mechanics"


def test_every_mechanics_subject_has_exactly_one_resolve_job():
    assert set(assets.MECHANICS_JOB_FOR_SUBJECT) == set(
        assets.MECHANICS_SUBJECT_KINDS)
    jobs = list(assets.MECHANICS_JOB_FOR_SUBJECT.values())
    assert len(jobs) == len(set(jobs))
    assert set(jobs) <= assets.JOB_KINDS


def test_toolbox_recognizes_every_mechanics_job():
    # A call site that hardcoded npc/item would silently drop monster work.
    assert toolbox._mechanics_jobs() == frozenset(
        assets.MECHANICS_JOB_FOR_SUBJECT.values())


def test_a_monster_stat_block_uses_the_same_actor_profile_as_an_npc():
    record = {
        "status": "authored",
        "profile": {
            "profile_kind": "actor",
            "characteristic_scale": "percentile",
            "characteristics": {"STR": 65, "CON": 75, "SIZ": 91},
            "derived": {"HP": 16},
        },
        "source_refs": [{"source_id": "pdf:t", "pdf_index": 3,
                         "text_sha256": "a" * 64}],
        "fields_observed": ["characteristics.STR"],
        "fields_extracted": ["characteristics.STR"],
        "fields_not_authored": [],
        "provenance": {"authority": "source_authored"},
    }
    with pytest.raises(mechanics.MechanicsError):
        mechanics.validate_mechanics_record(
            {**record, "profile": {**record["profile"], "profile_kind": "object"}},
            subject_kind="threat",
        )


def test_a_threat_locator_row_is_accepted_by_the_skeleton():
    skeleton = {
        "schema_version": 1,
        "parse_tier": 1,
        "source": {"source_id": "pdf:t", "file_sha256": "b" * 64,
                   "page_count": 30},
        "start_candidates": ["loc-a"],
        "locations": [{"location_id": "loc-a", "title": "A",
                       "parse_state": "named_only"}],
        "mechanics_locator_pass_status": "pending",
        "mechanics_index": [{
            "subject_kind": "threat",
            "subject_id": "threat-tsathoggua",
            "status": "located",
            "source_page_indices": [26],
        }],
    }
    errors = assets.validate_skeleton(skeleton)
    assert not [e for e in errors if "subject_kind" in e], errors


def test_an_unknown_mechanics_subject_is_still_rejected():
    skeleton = {
        "schema_version": 1,
        "parse_tier": 1,
        "source": {"source_id": "pdf:t", "file_sha256": "b" * 64,
                   "page_count": 30},
        "start_candidates": ["loc-a"],
        "locations": [{"location_id": "loc-a", "title": "A",
                       "parse_state": "named_only"}],
        "mechanics_locator_pass_status": "pending",
        "mechanics_index": [{
            "subject_kind": "vehicle",
            "subject_id": "veh-1",
            "status": "unresolved",
        }],
    }
    errors = assets.validate_skeleton(skeleton)
    assert any("subject_kind" in e for e in errors)


def test_request_mechanics_rejects_a_subject_that_carries_no_game_numbers():
    with pytest.raises(project.ModuleProjectError) as caught:
        project.request_mechanics(
            Path("/nonexistent"), "camp-1", kind="location", target_id="loc-a",
        )
    assert "mechanics kind" in str(caught.value)


def test_request_mechanics_passes_a_threat_through_the_kind_guard():
    # It fails later, on the missing campaign, rather than on the kind.
    with pytest.raises(project.ModuleProjectError) as caught:
        project.request_mechanics(
            Path("/nonexistent"), "camp-1", kind="threat",
            target_id="threat-yig",
        )
    assert "unknown campaign" in str(caught.value)


def test_intent_kinds_cover_demand_that_is_not_location_traversal():
    # Demand used to arrive only as scene_enter, so a module entered through
    # its rules, clock, tables or era had no way to ask for those pages.
    for intent in (
        "invoke_subsystem", "meet_actor", "consult_table",
        "timeline_tick", "era_query", "resolution", "section_pass",
    ):
        assert intent in assets.HOST_WORK_CONSUMER_INTENTS


def test_consumer_refs_accept_a_new_intent_and_reject_an_invented_one():
    rows = assets.validate_host_work_consumer_refs([{
        "campaign_id": "camp-1",
        "scenario_binding_sha256": "c" * 64,
        "intent_kind": "invoke_subsystem",
    }])
    assert rows[0]["intent_kind"] == "invoke_subsystem"
    with pytest.raises(assets.ModuleAssetsError):
        assets.validate_host_work_consumer_refs([{
            "campaign_id": "camp-1",
            "scenario_binding_sha256": "c" * 64,
            "intent_kind": "vibes",
        }])
