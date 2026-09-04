"""The shard -> pack bridge: a pack must remain a valid pack.

The progressive lane stores packs; the graph lane produces shards. The bridge
compiles one into the other, and the proof that nothing was lost in spirit is
that the lane's own validator -- unchanged -- accepts the result.
"""
from __future__ import annotations

import importlib.util
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


bridge = _load("coc_module_shard_pack_tests", SCRIPTS / "coc_module_shard_pack.py")


def _request(**overrides) -> dict:
    base = {
        "section_id": "section-peru",
        "title": "Peru: the ruins",
        "source_id": "pdf:demo",
        "requested_pdf_indices": [37, 38, 39],
        "result_contract": {"allowed_pack_kinds": ["keeper_truth", "reference"]},
        "audience": "keeper",
        "timing": "on_enter",
        "payload": "narrative",
        "binding": {"file_sha256": "x"},
        "file_sha256": "x",
    }
    base.update(overrides)
    return base


def _shard() -> dict:
    return {
        "module_id": "mod",
        "section_id": "section-peru",
        "nodes": [
            {"node_id": "scene-gate", "node_kind": "scene", "name": "神庙大门",
             "summary": "调查员抵达大门。", "evidence_span_ids": ["span-page-37-block-2"]},
            {"node_id": "npc-keeper", "node_kind": "npc", "name": "看门人",
             "summary": "他认得那个印记。", "evidence_span_ids": ["span-page-38-block-1"]},
            {"node_id": "clue-mark", "node_kind": "clue", "name": "墙上印记",
             "summary": "与第一章相同。", "evidence_span_ids": ["span-page-40-block-1"]},
        ],
        "evidence_span_ids": [
            "span-page-37-block-2", "span-page-38-block-1", "span-page-40-block-1",
        ],
        "claims": [], "relations": [],
    }


def test_a_compiled_pack_passes_the_lanes_own_validator():
    pack = bridge.shard_to_pack(_shard(), _request())
    assert pack["parse_state"] == "resolved"
    assert pack["pack_kind"] == "keeper_truth"
    assert "神庙大门" in pack["body_markdown"]
    assert "看门人" in pack["body_markdown"]


def test_source_refs_stay_inside_the_request():
    # span-page-40 is outside the request's pages 37-39: dropped, never cited.
    pack = bridge.shard_to_pack(_shard(), _request())
    assert [r["pdf_index"] for r in pack["source_refs"]] == [37, 38]


def test_pack_kind_respects_the_requests_allowed_kinds():
    pack = bridge.shard_to_pack(
        _shard(), _request(result_contract={"allowed_pack_kinds": ["reference"]}),
    )
    assert pack["pack_kind"] == "reference"


def test_an_empty_shard_still_produces_a_valid_pack():
    shard = {"module_id": "mod", "section_id": "section-peru", "nodes": [],
             "evidence_span_ids": ["span-page-37-block-1"], "claims": [],
             "relations": []}
    pack = bridge.shard_to_pack(shard, _request())
    assert pack["body_bytes"] > 0
    assert [r["pdf_index"] for r in pack["source_refs"]] == [37]
