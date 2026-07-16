from __future__ import annotations

import copy
import importlib.util
import json
import sys
from pathlib import Path

import pytest


REPO = Path(__file__).resolve().parents[1]
MODULE_PATH = REPO / "plugins" / "coc-keeper" / "scripts" / "coc_eval_packs.py"
PACKS_PATH = REPO / "evaluation" / "spec" / "v1" / "benchmark-packs.json"


def _load():
    spec = importlib.util.spec_from_file_location("coc_eval_packs_test", MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def test_repository_registers_exact_nine_executable_benchmark_packs():
    mod = _load()
    registry = mod.load_benchmark_pack_registry(REPO)
    packs = {pack["pack_id"]: pack for pack in registry["packs"]}

    assert set(packs) == set(mod.EXPECTED_PACK_IDS)
    assert {domain for pack in packs.values() for domain in pack["domains"]} == set(
        mod.VALID_DOMAINS
    )
    assert {mode for pack in packs.values() for mode in pack["modes"]} == set(
        mod.VALID_MODES
    )
    assert packs["haunting-golden"]["route"]["case_ids_by_suite"] == {
        "nightly": "the-haunting-nightly",
        "release": "the-haunting-release",
    }
    assert packs["long-memory-50"]["route"]["lane_id"] == "continuity-50"
    assert packs["masks-peru-america"]["resource_class"] == (
        "external-model-and-human-review"
    )


def test_nightly_matrix_uses_eight_personas_and_three_seeds():
    manifest = json.loads(
        (REPO / "evaluation/spec/v1/benchmark-manifest.json").read_text(
            encoding="utf-8"
        )
    )
    nightly = manifest["matrix"]["suites"]["nightly"]
    assert nightly["persona_ids"] == [
        "careful_investigator",
        "reckless_investigator",
        "skeptical_rules_lawyer",
        "genre_savvy_player",
        "social_first_player",
        "combat_first_player",
        "speedrunner",
        "stuck_player",
    ]
    assert nightly["seeds"] == [3, 7, 11]


def test_official_run_manifest_binds_pack_registry(tmp_path: Path):
    cli_path = REPO / "plugins/coc-keeper/scripts/coc_eval.py"
    spec = importlib.util.spec_from_file_location("coc_eval_pack_cli_test", cli_path)
    cli = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[spec.name] = cli
    spec.loader.exec_module(cli)
    manifest = json.loads(
        (REPO / "evaluation/spec/v1/benchmark-manifest.json").read_text(
            encoding="utf-8"
        )
    )
    payload = cli._base_run_manifest(
        manifest=manifest,
        suite="nightly",
        host_id="local",
        run_id="fixture",
        root=REPO,
        started_at="2026-07-14T00:00:00Z",
    )

    assert payload["benchmark_pack_registry_version"] == "2026.07.2"
    assert len(payload["benchmark_pack_registry_sha256"]) == 64
    assert payload["benchmark_pack_ids"] == [
        "rules-micro",
        "runtime-invariants",
        "module-hydration",
        "haunting-golden",
        "chase-combat-drill",
        "agency-redirection",
        "zh-prose",
        "long-memory-50",
    ]


def test_pack_registry_fails_closed_when_execution_route_is_unresolved():
    mod = _load()
    payload = json.loads(PACKS_PATH.read_text(encoding="utf-8"))
    malformed = copy.deepcopy(payload)
    rules_pack = next(
        pack for pack in malformed["packs"] if pack["pack_id"] == "rules-micro"
    )
    rules_pack["route"]["case_id"] = "missing-case"

    with pytest.raises(ValueError, match="unresolved registered case route"):
        mod.validate_benchmark_pack_registry(REPO, malformed)


def test_pack_registry_fails_closed_when_any_constitutional_pack_is_missing():
    mod = _load()
    payload = json.loads(PACKS_PATH.read_text(encoding="utf-8"))
    payload["packs"] = payload["packs"][:-1]

    with pytest.raises(ValueError, match="benchmark pack set mismatch"):
        mod.validate_benchmark_pack_registry(REPO, payload)
