#!/usr/bin/env python3
"""Source-bound development/chase/magic family shard contracts."""
from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
GENERATOR = ROOT / "tests" / "fixtures" / "_gen_rulegraph_source_families_v1.py"
TREE = (
    ROOT / "plugins" / "coc-keeper" / "rulesets" / "coc7"
    / "rule-graph-candidates" / "source-families-v1"
)


def _load_generator():
    spec = importlib.util.spec_from_file_location("source_family_generator", GENERATOR)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


gen = _load_generator()


def _read(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def test_development_source_review_is_complete_and_independent():
    root = TREE / "development"
    candidate = _read(root / "candidates" / "development.candidate.json")
    provenance = _read(root / "provenance" / "development.provenance.json")
    shard = _read(root / "accepted" / "development.accepted-shard.json")
    assert candidate["coverage"] == {"development": "accepted"}
    assert provenance["reviewer_identity"] == "codex-reviewer-development-source-20260831"
    assert provenance["review_status"] == "accepted"
    assert provenance["unresolved_applicable_rules"] == []
    assert len(provenance["accepted_shard_digest"]) == 64
    assert shard["receipt"]["shard_sha256"] == provenance["accepted_shard_digest"]
    assert shard["coverage"] == {"development": "accepted"}
    node_ids = {node["node_id"] for node in candidate["nodes"]}
    for token in (
        "phase-timing", "skill-ticks", "improvement", "mastery-san-reward",
        "luck-recovery", "awfulness-decay",
    ):
        assert f"rule:coc7:development:{token}" in node_ids


def test_development_regenerates_byte_identically_from_external_bundle(tmp_path: Path):
    raw = os.environ.get(gen.BUNDLE_ROOT_ENV)
    if not raw:
        pytest.skip(f"set {gen.BUNDLE_ROOT_ENV}")
    built = gen.build_family(Path(raw).resolve(), "development", tmp_path / "evidence")
    output = tmp_path / "tree"
    gen.write_all({"development": built}, output)
    expected = {
        path.relative_to(TREE / "development"): path.read_bytes()
        for path in (TREE / "development").rglob("*.json")
    }
    actual = {
        path.relative_to(output / "development"): path.read_bytes()
        for path in (output / "development").rglob("*.json")
    }
    assert actual == expected


def test_chase_source_review_is_complete_and_records_runtime_mismatches():
    root = TREE / "chase"
    candidate = _read(root / "candidates" / "chase.candidate.json")
    provenance = _read(root / "provenance" / "chase.provenance.json")
    shard = _read(root / "accepted" / "chase.accepted-shard.json")
    assert candidate["coverage"] == {"chase": "accepted"}
    assert provenance["reviewer_identity"] == "codex-reviewer-chase-source-20260831"
    assert provenance["review_status"] == "accepted"
    assert provenance["unresolved_applicable_rules"] == []
    assert shard["receipt"]["shard_sha256"] == provenance["accepted_shard_digest"]
    node_ids = {node["node_id"] for node in candidate["nodes"]}
    for token in (
        "establish", "movement-actions", "hazards", "barriers", "conflict",
        "pedal-to-metal", "passengers-and-fire", "vehicle-reference",
    ):
        assert f"rule:coc7:chase:{token}" in node_ids
    for token in ("runtime-dex-tie", "runtime-multiple-escape", "runtime-ranged-damage"):
        assert f"exception:coc7:chase:{token}" in node_ids


def test_chase_regenerates_byte_identically_from_external_bundle(tmp_path: Path):
    raw = os.environ.get(gen.BUNDLE_ROOT_ENV)
    if not raw:
        pytest.skip(f"set {gen.BUNDLE_ROOT_ENV}")
    built = gen.build_family(Path(raw).resolve(), "chase", tmp_path / "evidence")
    output = tmp_path / "tree"
    gen.write_all({"chase": built}, output)
    expected = {
        path.relative_to(TREE / "chase"): path.read_bytes()
        for path in (TREE / "chase").rglob("*.json")
    }
    actual = {
        path.relative_to(output / "chase"): path.read_bytes()
        for path in (output / "chase").rglob("*.json")
    }
    assert actual == expected


def test_magic_has_accepted_partial_shard_and_precise_terminal_blockers():
    root = TREE / "magic"
    candidate = _read(root / "candidates" / "magic.candidate.json")
    provenance = _read(root / "provenance" / "magic.provenance.json")
    shard = _read(root / "accepted" / "magic.accepted-shard.json")
    assert candidate["coverage"] == {"magic": "partial"}
    assert shard["coverage"] == {"magic": "partial"}
    assert provenance["reviewer_identity"] == "codex-reviewer-magic-source-20260831"
    assert provenance["review_status"] == "revision-required"
    assert len(provenance["accepted_shard_digest"]) == 64
    assert shard["receipt"]["shard_sha256"] == provenance["accepted_shard_digest"]
    assert len(provenance["unresolved_applicable_rules"]) == 10
    assert {row["code"] for row in provenance["blockers"]} == {
        "rulebook-source-missing", "source-runtime-semantic-mismatch",
    }
    node_ids = {node["node_id"] for node in candidate["nodes"]}
    for token in (
        "runtime-pushed-failure", "runtime-disruption-cost",
        "runtime-side-effect-table", "runtime-entity-learning",
        "runtime-spell-source-gap",
    ):
        assert f"exception:coc7:magic:{token}" in node_ids


def test_magic_blocked_spell_names_are_absent_from_exact_source_corpus():
    raw = os.environ.get(gen.BUNDLE_ROOT_ENV)
    if not raw:
        pytest.skip(f"set {gen.BUNDLE_ROOT_ENV}")
    root = Path(raw).resolve()
    text = "\n".join(
        str(page["text"])
        for name in gen.SPECS["magic"]["bundles"]
        for page in _read(root / name / "normalized-source.json")["pages"]
    ).casefold()
    provenance = _read(TREE / "magic/provenance/magic.provenance.json")
    for spell in provenance["unresolved_applicable_rules"]:
        assert spell.casefold() not in text
    assert "chapter thirteen" in text
    assert "chapter fourteen" in text


def test_magic_regenerates_byte_identically_from_external_bundle(tmp_path: Path):
    raw = os.environ.get(gen.BUNDLE_ROOT_ENV)
    if not raw:
        pytest.skip(f"set {gen.BUNDLE_ROOT_ENV}")
    built = gen.build_family(Path(raw).resolve(), "magic", tmp_path / "evidence")
    output = tmp_path / "tree"
    gen.write_all({"magic": built}, output)
    expected = {
        path.relative_to(TREE / "magic"): path.read_bytes()
        for path in (TREE / "magic").rglob("*.json")
    }
    actual = {
        path.relative_to(output / "magic"): path.read_bytes()
        for path in (output / "magic").rglob("*.json")
    }
    assert actual == expected


def test_source_family_artifacts_do_not_touch_production_graph():
    assert TREE != ROOT / "plugins/coc-keeper/rulesets/coc7"
    source = GENERATOR.read_text(encoding="utf-8")
    assert "rule-graph.json" not in source
    assert "rule-graph-manifest.json" not in source
