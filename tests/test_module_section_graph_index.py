"""Registering a graph-lane build into the progressive section index.

The on-demand trigger (on_enter_scene) already exists; it can only see what
the section index carries. These tests pin the registration's shape: opening
sections from skeleton evidence, location bindings only from opener-page
evidence, and the classifier lane's validator reused rather than bypassed.
"""
from __future__ import annotations

import importlib.util
import hashlib
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "plugins" / "coc-keeper" / "scripts"


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


sections = _load("coc_module_sections_graph_tests", SCRIPTS / "coc_module_sections.py")


def _plan() -> dict:
    return {"sections": [
        {"section_id": "intro", "title": "导入", "pdf_index_start": 0,
         "pdf_index_end": 9, "reason": "r"},
        {"section_id": "peru", "title": "秘鲁", "pdf_index_start": 10,
         "pdf_index_end": 19, "reason": "r"},
        {"section_id": "england", "title": "英格兰", "pdf_index_start": 20,
         "pdf_index_end": 29, "reason": "r"},
    ]}


def _skeleton() -> dict:
    return {"nodes": [
        {"node_id": "location-lima", "node_kind": "location", "name": "利马",
         "evidence_span_ids": ["span-page-0-block-1", "span-page-10-block-1"]},
        {"node_id": "location-london", "node_kind": "location", "name": "伦敦",
         "evidence_span_ids": ["span-page-0-block-2", "span-page-20-block-1"]},
        {"node_id": "npc-jackson", "node_kind": "npc", "name": "杰克逊",
         "evidence_span_ids": ["span-page-0-block-3"]},
    ]}


def _build(**overrides) -> dict:
    kwargs = dict(
        plan=_plan(),
        skeleton=_skeleton(),
        opening_section_ids=["peru"],
        source_id="pdf:demo",
        file_sha256="a" * 64,
        outline_sha256=hashlib.sha256(b"plan").hexdigest(),
        outline_producer="coc_module_build",
        page_count=30,
    )
    kwargs.update(overrides)
    return sections.build_section_index_from_graph(**kwargs)


def test_opening_sections_come_from_evidence_not_order():
    index = _build()
    by_id = {row["section_id"]: row for row in index["sections"]}
    assert by_id["peru"]["timing"] == "opening"
    assert by_id["intro"]["timing"] == "on_demand"
    assert by_id["england"]["timing"] == "on_demand"


def test_a_location_binds_to_the_section_whose_opener_cites_it():
    index = _build()
    by_id = {row["section_id"]: row for row in index["sections"]}
    # lima is mentioned on the intro opener (page 0) and homed at peru's (10).
    assert by_id["peru"]["binding"] == {
        "kind": "entity", "entity_kind": "location", "entity_ids": ["location-lima"],
    }
    assert by_id["england"]["binding"]["entity_ids"] == ["location-london"]


def test_an_empty_roster_cannot_register_all_global_rows():
    """The classifier lane's guard applies here unchanged: with no bindable
    entities known, an all-global index is a non-answer and must raise."""
    with pytest.raises(sections.SectionIndexError):
        _build(skeleton={"nodes": []})
