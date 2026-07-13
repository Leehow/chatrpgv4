from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import stat
import sys
from pathlib import Path

import pytest


REPO = Path(__file__).resolve().parents[1]
MODULE_PATH = REPO / "plugins" / "coc-keeper" / "scripts" / "coc_eval_matrix.py"
LIVE_CELL_PATH = (
    REPO / "plugins" / "coc-keeper" / "scripts" / "coc_eval_live_cell.py"
)
CLI_PATH = REPO / "plugins" / "coc-keeper" / "scripts" / "coc_eval.py"
MANIFEST_PATH = REPO / "evaluation" / "spec" / "v1" / "benchmark-manifest.json"


def _load():
    assert MODULE_PATH.is_file(), f"missing implementation module: {MODULE_PATH}"
    spec = importlib.util.spec_from_file_location("coc_eval_matrix_test", MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules["coc_eval_matrix_test"] = module
    spec.loader.exec_module(module)
    return module


def _load_live_cell():
    assert LIVE_CELL_PATH.is_file(), f"missing live-cell runner: {LIVE_CELL_PATH}"
    spec = importlib.util.spec_from_file_location(
        "coc_eval_live_cell_test", LIVE_CELL_PATH
    )
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules["coc_eval_live_cell_test"] = module
    spec.loader.exec_module(module)
    return module


def _load_cli():
    assert CLI_PATH.is_file(), f"missing CLI module: {CLI_PATH}"
    spec = importlib.util.spec_from_file_location("coc_eval_cli_matrix_test", CLI_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules["coc_eval_cli_matrix_test"] = module
    spec.loader.exec_module(module)
    return module


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    digest.update(path.read_bytes())
    return digest.hexdigest()


def _write(path: Path, text: str) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return path


def _write_json(path: Path, payload: object) -> Path:
    return _write(path, json.dumps(payload, indent=2, sort_keys=True) + "\n")


def _write_attested_live_artifacts(
    runner, run_dir: Path, *, include_runners: bool = True
) -> dict:
    player_model = {"provider": "coding-relay", "id": "gpt-5.6-luna"}
    kp_model = {"provider": "zhipu-coding", "id": "glm-5.2"}
    player_path = REPO / "runtime" / "adapters" / "player" / "run_player_turn.mjs"
    narrator_path = REPO / "runtime" / "adapters" / "narrator" / "run_narration.mjs"
    audit = runner.live_match.secret_audit.audit_secret_claims([], [], [])
    rows = [
        {
            "schema_version": 1,
            "role": "player",
            "attempt": 1,
            "transcript_turn": 1,
            "runner_kind": "external_model_bridge",
            "runner_identity": "coc-runtime-player-adapter@0.79.9",
            "runner_path": str(player_path),
            "runner_sha256": _sha256(player_path),
            "model_identity": player_model,
            "outcome": "external_success",
            "response_mode": "tool",
            "fallback_kind": None,
        },
        {
            "schema_version": 1,
            "role": "narrator",
            "attempt": 1,
            "transcript_turn": 1,
            "runner_kind": "external_model_bridge",
            "runner_identity": "coc-runtime-narrator-adapter@0.79.9",
            "runner_path": str(narrator_path),
            "runner_sha256": _sha256(narrator_path),
            "model_identity": kp_model,
            "outcome": "external_success",
            "response_mode": "tool",
            "fallback_kind": None,
            "secret_audit": audit,
        },
    ]
    ledger = run_dir / "runner-invocations.jsonl"
    _write(
        ledger,
        "".join(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n" for row in rows),
    )
    evidence = {
        "eligible_as_gameplay_evidence": True,
        "evidence_reasons": [],
        "artifacts": {
            "invocation_ledger": {
                "path": "runner-invocations.jsonl",
                "sha256": _sha256(ledger),
            }
        },
    }
    if include_runners:
        evidence["runners"] = {
            "player": {
                "kind": "external_model_bridge",
                "identity": "coc-runtime-player-adapter@0.79.9",
                "sha256": _sha256(player_path),
                "model_identities": [player_model],
            },
            "narrator": {
                "kind": "external_model_bridge",
                "identity": "coc-runtime-narrator-adapter@0.79.9",
                "sha256": _sha256(narrator_path),
                "model_identities": [kp_model],
            },
        }
    return evidence


def _canonical_prompt_contract() -> dict:
    sources = {
        "player": "runtime/adapters/player/run_player_turn.mjs",
        "kp": "runtime/adapters/narrator/run_narration.mjs",
    }
    return {
        "prompt_sources": sources,
        "prompt_hashes": {
            role: _sha256(REPO / source) for role, source in sources.items()
        },
    }


def _canonical_live_cell_input() -> dict:
    return {
        "cell_id": "careful__seed-3__nightly",
        "seed": 3,
        "max_turns": 1,
        "scenario": {"scene_id": "neutral-entry"},
        "initial_state": {
            "campaign_id": "eval-neutral",
            "investigator_id": "inv1",
            "character": {"schema_version": 1, "id": "inv1"},
            "public_state": {"active_scene_id": "neutral-entry"},
        },
        "player_model": {"provider": "coding-relay", "id": "gpt-5.6-luna"},
        "kp_model": {"provider": "zhipu-coding", "id": "glm-5.2"},
        "player_request": {
            "persona_id": "careful_investigator",
            "persona_prompt_directives": [
                "Prefer observation before irreversible action."
            ],
        },
        **_canonical_prompt_contract(),
    }


def _fake_attested_match(runner, run_dir: Path) -> dict:
    run_dir.mkdir(parents=True, exist_ok=True)
    (run_dir / "battle-report.md").write_text("# fixture\n", encoding="utf-8")
    return {
        "run_dir": str(run_dir),
        "turns": [{"turn_number": 1, "narration": "门轴轻响。"}],
        "player_turns": [{"player_text": "我检查门锁。"}],
        "evidence": _write_attested_live_artifacts(runner, run_dir),
        "metadata": {"runner_kind": "external_model_bridge"},
    }


def _fake_runner_script(path: Path) -> Path:
    script = """#!/usr/bin/env python3
import hashlib, json, sys
from pathlib import Path
payload = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
out = Path(sys.argv[2])
out.mkdir(parents=True, exist_ok=True)
# Echo player request for view-separation assertions; never invent model lanes.
(out / "player-request.json").write_text(
    json.dumps(payload.get("player_request") or {}, indent=2, sort_keys=True) + "\\n",
    encoding="utf-8",
)
(out / "kp-request.json").write_text(
    json.dumps(payload.get("kp_request") or {}, indent=2, sort_keys=True) + "\\n",
    encoding="utf-8",
)
player_view = out / "player-view.jsonl"
player_view.write_text(
    json.dumps(
        {
            "schema_version": 1,
            "view": "player",
            "turn_number": 1,
            "player_text": "我检查门锁。",
            "narration": "新版公开叙事。",
            "keeper_secret": "must-not-reach-judge",
        },
        ensure_ascii=False,
        sort_keys=True,
    )
    + "\\n",
    encoding="utf-8",
)
(out / "run-manifest.json").write_text(
    json.dumps(
        {
            "status": "PASS",
            "cell_id": payload.get("cell_id"),
            "evidence_eligible": True,
            "runner": "fake",
            "player_model": payload.get("player_model"),
            "kp_model": payload.get("kp_model"),
            "artifact_hashes": {
                "player-view.jsonl": hashlib.sha256(player_view.read_bytes()).hexdigest(),
            },
        },
        indent=2,
        sort_keys=True,
    )
    + "\\n",
    encoding="utf-8",
)
print(json.dumps({"status": "PASS", "cell_id": payload.get("cell_id")}))
"""
    _write(path, script)
    path.chmod(path.stat().st_mode | stat.S_IXUSR)
    return path


def _write_baseline_matrix(
    output: Path,
    plan: dict,
    *,
    identity_overrides: dict | None = None,
) -> Path:
    baseline_plan = json.loads(json.dumps(plan))
    cell = baseline_plan["cells"][0]
    cell.update(identity_overrides or {})
    _write_json(output / "matrix-plan.json", baseline_plan)
    cell_dir = output / "cells" / cell["cell_id"]
    player_view = _write(
        cell_dir / "player-view.jsonl",
        json.dumps(
            {
                "schema_version": 1,
                "view": "player",
                "turn_number": 1,
                "player_text": "我检查门锁。",
                "narration": "旧版公开叙事。",
                "keeper_secret": "must-not-reach-judge",
            },
            ensure_ascii=False,
            sort_keys=True,
        )
        + "\n",
    )
    manifest = _write_json(
        cell_dir / "run-manifest.json",
        {
            "schema_version": 1,
            "eval_spec": "eval-spec-v1",
            "cell_id": cell["cell_id"],
            "status": "PASS",
            "evidence_eligible": True,
            "artifact_hashes": {"player-view.jsonl": _sha256(player_view)},
        },
    )
    _write_json(
        output / "matrix-results.json",
        {
            "schema_version": 1,
            "eval_spec": "eval-spec-v1",
            "cells": [
                {
                    "cell_id": cell["cell_id"],
                    "status": "PASS",
                    "artifact_hashes": {"run-manifest.json": _sha256(manifest)},
                }
            ],
        },
    )
    return output


def test_baseline_plan_contract_and_public_artifact_are_hash_bound(tmp_path: Path):
    matrix = _load()
    plan = {
        "schema_version": 1,
        "eval_spec": "eval-spec-v1",
        "suite": "nightly",
        "cells": [
            {
                "cell_id": "careful__seed-3__nightly",
                "persona_id": "careful_investigator",
                "seed": 3,
                "case_id": "nightly",
            }
        ],
    }
    baseline = _write_baseline_matrix(tmp_path / "baseline", plan)
    root, cells, mismatches = matrix._baseline_cells(baseline, plan)
    assert root == baseline.resolve()
    assert set(cells) == {"careful__seed-3__nightly"}
    assert mismatches == []
    result_cell = json.loads(
        (baseline / "matrix-results.json").read_text(encoding="utf-8")
    )["cells"][0]
    cell_dir = baseline / "cells" / "careful__seed-3__nightly"
    turns = matrix._attested_public_cell_turns(
        cell_dir,
        expected_cell_id="careful__seed-3__nightly",
        result_cell=result_cell,
    )
    assert turns[0]["narration"] == "旧版公开叙事。"

    baseline_plan = json.loads(
        (baseline / "matrix-plan.json").read_text(encoding="utf-8")
    )
    baseline_plan["suite"] = "release"
    _write_json(baseline / "matrix-plan.json", baseline_plan)
    _root, _cells, mismatches = matrix._baseline_cells(baseline, plan)
    assert mismatches == ["suite"]

    _write(cell_dir / "player-view.jsonl", '{"view":"player","text":"tampered"}\n')
    with pytest.raises(ValueError, match="hash"):
        matrix._attested_public_cell_turns(
            cell_dir,
            expected_cell_id="careful__seed-3__nightly",
            result_cell=result_cell,
        )


def test_manifest_declares_matrix_config_without_claiming_capability():
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    matrix = manifest["matrix"]
    assert matrix["schema_version"] == 1
    assert matrix["eval_spec"] == "eval-spec-v1"
    nightly = matrix["suites"]["nightly"]
    release = matrix["suites"]["release"]
    assert isinstance(nightly["persona_ids"], list) and nightly["persona_ids"]
    assert isinstance(nightly["seeds"], list) and len(nightly["seeds"]) >= 3
    assert isinstance(nightly["cases"], list) and nightly["cases"]
    assert isinstance(release["persona_ids"], list) and release["persona_ids"]
    assert isinstance(release["seeds"], list) and release["seeds"]
    assert "ai_player_matrix" not in manifest["implemented_capabilities"]
    assert "ai_player_matrix" in manifest["suites"]["nightly"]["required_capabilities"]


def test_build_matrix_plan_expands_personas_seeds_cases_deterministically():
    matrix = _load()
    plan_a = matrix.build_matrix_plan(root=REPO, suite="nightly")
    plan_b = matrix.build_matrix_plan(root=REPO, suite="nightly")
    # Wall-clock generated_at may differ; cell expansion must be identical.
    assert {key: value for key, value in plan_a.items() if key != "generated_at"} == {
        key: value for key, value in plan_b.items() if key != "generated_at"
    }
    assert plan_a["suite"] == "nightly"
    assert plan_a["schema_version"] == 1
    cells = plan_a["cells"]
    assert cells
    persona_ids = {cell["persona_id"] for cell in cells}
    seeds = {cell["seed"] for cell in cells}
    case_ids = {cell["case_id"] for cell in cells}
    assert persona_ids
    assert seeds
    assert case_ids
    # Plan may filter to configured subsets, but expansion must be the cartesian product
    # of the suite's configured persona/seed/case lists.
    configured = plan_a["configuration"]
    assert len(cells) == (
        len(configured["persona_ids"])
        * len(configured["seeds"])
        * len(configured["cases"])
    )
    for cell in cells:
        assert cell["player_model"]
        assert cell["kp_model"]
        assert len(cell["persona_profile_sha256"]) == 64
        assert isinstance(cell["prompt_hashes"], dict) and cell["prompt_hashes"]
        assert isinstance(cell["runner_hashes"], dict)
        assert "initial_state_sha256" in cell
        assert len(cell["scenario_sha256"]) == 64
        assert cell["status"] in {"READY", "NOT_RUN"}
        if cell["status"] == "NOT_RUN":
            assert cell["not_run_reasons"]


def test_checked_in_matrix_case_is_ready_from_pi_credentials_not_env_keys():
    matrix = _load()
    plan = matrix.build_matrix_plan(
        root=REPO,
        suite="nightly",
        model_preflight=lambda provider, model: True,
        credential_env={},
    )
    assert plan["ready_count"] == plan["cell_count"]
    cell = plan["cells"][0]
    assert cell["player_model"] == {
        "provider": "coding-relay",
        "id": "gpt-5.6-luna",
    }
    assert cell["kp_model"] == {"provider": "zhipu-coding", "id": "glm-5.2"}
    assert set(cell["prompt_hashes"]) == {"player", "kp"}
    assert all(len(value) == 64 for value in cell["prompt_hashes"].values())
    assert cell["prompt_sources"] == {
        "player": "runtime/adapters/player/run_player_turn.mjs",
        "kp": "runtime/adapters/narrator/run_narration.mjs",
    }


def test_live_cell_runner_writes_evidence_from_canonical_match(tmp_path, monkeypatch):
    runner = _load_live_cell()
    observed = {}

    def fake_canonical_match(*args, **kwargs):
        observed["args"] = args
        observed["kwargs"] = kwargs
        run_dir = Path(kwargs["run_dir"])
        run_dir.mkdir(parents=True)
        (run_dir / "battle-report.md").write_text("# fixture\n", encoding="utf-8")
        return {
            "run_dir": str(run_dir),
            "turns": [{"turn_number": 1, "narration": "门轴轻响。"}],
            "player_turns": [{"player_text": "我检查门锁。"}],
            "evidence": _write_attested_live_artifacts(runner, run_dir),
            "metadata": {"runner_kind": "external_model_bridge"},
        }

    monkeypatch.setattr(runner.live_match, "run_live_match", fake_canonical_match)
    neutral_scenario = {
        "scene_id": "neutral-entry",
        "dramatic_question": "What changed?",
    }
    neutral_initial_state = {
        "campaign_id": "eval-neutral",
        "investigator_id": "inv1",
        "character": {"schema_version": 1, "id": "inv1"},
        "public_state": {"active_scene_id": "neutral-entry"},
    }
    cell_input = {
        "cell_id": "careful__seed-3__nightly",
        "seed": 3,
        "max_turns": 1,
        "scenario": neutral_scenario,
        "initial_state": neutral_initial_state,
        "player_model": {"provider": "coding-relay", "id": "gpt-5.6-luna"},
        "kp_model": {"provider": "zhipu-coding", "id": "glm-5.2"},
        "player_request": {
            "persona_id": "careful_investigator",
            "persona_prompt_directives": [
                "Prefer observation before irreversible action."
            ],
        },
        **_canonical_prompt_contract(),
    }
    cell_dir = tmp_path / "cell"
    result = runner.run_live_cell(cell_input, cell_dir, env={})

    assert result["status"] == "PASS"
    assert result["evidence_eligible"] is True
    assert set(result["artifact_hashes"]) == {
        "battle-report.md",
        "evidence.json",
        "transcript.jsonl",
        "player-view.jsonl",
        "keeper-view.jsonl",
        "runner-invocations.jsonl",
    }
    assert all(len(value) == 64 for value in result["artifact_hashes"].values())
    assert observed["args"][1:] == ("eval-neutral", "inv1")
    assert observed["kwargs"]["max_turns"] == 1
    assert observed["kwargs"]["rng_seed"] == 3
    assert observed["kwargs"]["live"] is True
    assert observed["kwargs"]["persona_id"] == "careful_investigator"
    assert observed["kwargs"]["persona_prompt_directives"] == [
        "Prefer observation before irreversible action."
    ]
    assert observed["kwargs"]["player_runner"] == (
        REPO / "runtime" / "adapters" / "player" / "run_player_turn.mjs"
    )
    assert observed["kwargs"]["narrator_runner"] == (
        REPO / "runtime" / "adapters" / "narrator" / "run_narration.mjs"
    )
    for name in (
        "run-manifest.json",
        "transcript.jsonl",
        "player-view.jsonl",
        "keeper-view.jsonl",
        "runner-invocations.jsonl",
        "battle-report.md",
    ):
        assert (cell_dir / name).is_file(), name


def test_live_cell_runner_uses_canonical_nested_report_path(tmp_path, monkeypatch):
    runner = _load_live_cell()

    def fake_canonical_match(*args, **kwargs):
        run_dir = Path(kwargs["run_dir"])
        report = run_dir / "artifacts" / "battle-report.md"
        report.parent.mkdir(parents=True)
        report.write_text("# nested fixture\n", encoding="utf-8")
        return {
            "run_dir": str(run_dir),
            "battle_report_path": str(report),
            "turns": [{"turn_number": 1, "narration": "门轴轻响。"}],
            "player_turns": [{"player_text": "我检查门锁。"}],
            "evidence": _write_attested_live_artifacts(runner, run_dir),
            "metadata": {"runner_kind": "external_model_bridge"},
        }

    monkeypatch.setattr(runner.live_match, "run_live_match", fake_canonical_match)
    cell_input = {
        "cell_id": "careful__seed-3__nightly",
        "seed": 3,
        "max_turns": 1,
        "scenario": {
            "scene_id": "neutral-entry",
            "dramatic_question": "What changed?",
        },
        "initial_state": {
            "campaign_id": "eval-neutral",
            "investigator_id": "inv1",
            "character": {"schema_version": 1, "id": "inv1"},
            "public_state": {"active_scene_id": "neutral-entry"},
        },
        "player_model": {"provider": "coding-relay", "id": "gpt-5.6-luna"},
        "kp_model": {"provider": "zhipu-coding", "id": "glm-5.2"},
        "player_request": {
            "persona_id": "careful_investigator",
            "persona_prompt_directives": [
                "Prefer observation before irreversible action."
            ],
        },
        **_canonical_prompt_contract(),
    }

    result = runner.run_live_cell(cell_input, tmp_path / "cell", env={})

    assert result["status"] == "PASS"
    assert (tmp_path / "cell" / "battle-report.md").read_text(
        encoding="utf-8"
    ) == "# nested fixture\n"


def test_live_cell_rejects_compatibility_eligible_flag(tmp_path, monkeypatch):
    runner = _load_live_cell()

    def fake_canonical_match(*args, **kwargs):
        run_dir = Path(kwargs["run_dir"])
        run_dir.mkdir(parents=True)
        (run_dir / "battle-report.md").write_text("# fixture\n", encoding="utf-8")
        return {
            "run_dir": str(run_dir),
            "turns": [{"turn_number": 1, "narration": "门轴轻响。"}],
            "player_turns": [{"player_text": "我检查门锁。"}],
            "evidence": {"eligible": True},
            "metadata": {"runner_kind": "external_model_bridge"},
        }

    monkeypatch.setattr(runner.live_match, "run_live_match", fake_canonical_match)
    result = runner.run_live_cell(
        {
            "cell_id": "careful__seed-3__nightly",
            "seed": 3,
            "max_turns": 1,
            "scenario": {"scene_id": "neutral-entry"},
            "initial_state": {
                "campaign_id": "eval-neutral",
                "investigator_id": "inv1",
                "character": {"schema_version": 1, "id": "inv1"},
                "public_state": {"active_scene_id": "neutral-entry"},
            },
            "player_model": {"provider": "coding-relay", "id": "gpt-5.6-luna"},
            "kp_model": {"provider": "zhipu-coding", "id": "glm-5.2"},
            "player_request": {
                "persona_id": "careful_investigator",
                "persona_prompt_directives": [
                    "Prefer observation before irreversible action."
                ],
            },
            **_canonical_prompt_contract(),
        },
        tmp_path / "cell",
        env={},
    )
    assert result["status"] == "INELIGIBLE"
    assert "canonical_evidence_eligibility_missing" in result["evidence_findings"]


def test_live_cell_rejects_missing_runner_descriptors(tmp_path, monkeypatch):
    runner = _load_live_cell()

    def fake_canonical_match(*args, **kwargs):
        run_dir = Path(kwargs["run_dir"])
        run_dir.mkdir(parents=True)
        (run_dir / "battle-report.md").write_text("# fixture\n", encoding="utf-8")
        return {
            "run_dir": str(run_dir),
            "turns": [{"turn_number": 1, "narration": "门轴轻响。"}],
            "player_turns": [{"player_text": "我检查门锁。"}],
            "evidence": _write_attested_live_artifacts(
                runner, run_dir, include_runners=False
            ),
            "metadata": {"runner_kind": "external_model_bridge"},
        }

    monkeypatch.setattr(runner.live_match, "run_live_match", fake_canonical_match)
    result = runner.run_live_cell(
        {
            "cell_id": "careful__seed-3__nightly",
            "seed": 3,
            "max_turns": 1,
            "scenario": {"scene_id": "neutral-entry"},
            "initial_state": {
                "campaign_id": "eval-neutral",
                "investigator_id": "inv1",
                "character": {"schema_version": 1, "id": "inv1"},
                "public_state": {"active_scene_id": "neutral-entry"},
            },
            "player_model": {"provider": "coding-relay", "id": "gpt-5.6-luna"},
            "kp_model": {"provider": "zhipu-coding", "id": "glm-5.2"},
            "player_request": {
                "persona_id": "careful_investigator",
                "persona_prompt_directives": [
                    "Prefer observation before irreversible action."
                ],
            },
            **_canonical_prompt_contract(),
        },
        tmp_path / "cell",
        env={},
    )
    assert result["status"] == "INELIGIBLE"
    assert "missing_runner_attestation:player" in result["evidence_findings"]
    assert "missing_runner_attestation:narrator" in result["evidence_findings"]


@pytest.mark.parametrize(
    "corruption", ["missing_ledger", "player_model", "runner_hash", "narrator_audit"]
)
def test_live_cell_rejects_missing_or_contradictory_attestation(
    tmp_path, monkeypatch, corruption
):
    runner = _load_live_cell()

    def fake_canonical_match(*args, **kwargs):
        run_dir = Path(kwargs["run_dir"])
        run_dir.mkdir(parents=True)
        (run_dir / "battle-report.md").write_text("# fixture\n", encoding="utf-8")
        evidence = _write_attested_live_artifacts(runner, run_dir)
        ledger = run_dir / "runner-invocations.jsonl"
        rows = [json.loads(line) for line in ledger.read_text().splitlines() if line]
        if corruption == "missing_ledger":
            ledger.unlink()
        elif corruption == "player_model":
            rows[0]["model_identity"] = {"provider": "wrong", "id": "wrong"}
        elif corruption == "runner_hash":
            evidence["runners"]["player"]["sha256"] = "0" * 64
        else:
            rows[1]["secret_audit"] = {"passed": True}
        if corruption in {"player_model", "narrator_audit"}:
            _write(
                ledger,
                "".join(json.dumps(row, sort_keys=True) + "\n" for row in rows),
            )
            evidence["artifacts"]["invocation_ledger"]["sha256"] = _sha256(ledger)
        return {
            "run_dir": str(run_dir),
            "turns": [{"turn_number": 1, "narration": "门轴轻响。"}],
            "player_turns": [{"player_text": "我检查门锁。"}],
            "evidence": evidence,
            "metadata": {"runner_kind": "external_model_bridge"},
        }

    monkeypatch.setattr(runner.live_match, "run_live_match", fake_canonical_match)
    result = runner.run_live_cell(
        {
            "cell_id": "careful__seed-3__nightly",
            "seed": 3,
            "max_turns": 1,
            "scenario": {"scene_id": "neutral-entry"},
            "initial_state": {
                "campaign_id": "eval-neutral",
                "investigator_id": "inv1",
                "character": {"schema_version": 1, "id": "inv1"},
                "public_state": {"active_scene_id": "neutral-entry"},
            },
            "player_model": {"provider": "coding-relay", "id": "gpt-5.6-luna"},
            "kp_model": {"provider": "zhipu-coding", "id": "glm-5.2"},
            "player_request": {
                "persona_id": "careful_investigator",
                "persona_prompt_directives": [
                    "Prefer observation before irreversible action."
                ],
            },
            **_canonical_prompt_contract(),
        },
        tmp_path / "cell",
        env={},
    )
    assert result["status"] == "INELIGIBLE"
    assert result["evidence_findings"]


def test_live_cell_rejects_prompt_source_change_between_plan_and_execution(
    tmp_path, monkeypatch
):
    runner = _load_live_cell()
    repo = tmp_path / "repo"
    sources = {
        "player": "runtime/adapters/player/run_player_turn.mjs",
        "kp": "runtime/adapters/narrator/run_narration.mjs",
    }
    for role, relative in sources.items():
        _write(repo / relative, f"// {role} prompt v1\n")
    planned = {role: _sha256(repo / relative) for role, relative in sources.items()}
    _write(repo / sources["player"], "// player prompt changed after planning\n")
    monkeypatch.setattr(runner, "REPO_ROOT", repo)
    monkeypatch.setattr(
        runner.live_match,
        "run_live_match",
        lambda *args, **kwargs: pytest.fail("live match must not run after hash drift"),
    )
    cell_input = {
        "cell_id": "careful__seed-3__nightly",
        "seed": 3,
        "max_turns": 1,
        "scenario": {"scene_id": "neutral-entry"},
        "initial_state": {
            "campaign_id": "eval-neutral",
            "investigator_id": "inv1",
            "character": {"schema_version": 1, "id": "inv1"},
            "public_state": {"active_scene_id": "neutral-entry"},
        },
        "player_model": {"provider": "coding-relay", "id": "gpt-5.6-luna"},
        "kp_model": {"provider": "zhipu-coding", "id": "glm-5.2"},
        "prompt_sources": sources,
        "prompt_hashes": planned,
    }
    with pytest.raises(ValueError, match="prompt hash mismatch: player"):
        runner.run_live_cell(cell_input, tmp_path / "cell", env={})


@pytest.mark.parametrize("source_kind", ["missing", "outside"])
def test_live_cell_rejects_missing_or_outside_prompt_source(
    tmp_path, monkeypatch, source_kind
):
    runner = _load_live_cell()
    repo = tmp_path / "repo"
    player = _write(
        repo / "runtime/adapters/player/run_player_turn.mjs", "// player\n"
    )
    narrator = _write(
        repo / "runtime/adapters/narrator/run_narration.mjs", "// narrator\n"
    )
    sources = {
        "player": (
            "runtime/adapters/player/missing.mjs"
            if source_kind == "missing"
            else str(_write(tmp_path / "outside.mjs", "// outside\n"))
        ),
        "kp": "runtime/adapters/narrator/run_narration.mjs",
    }
    monkeypatch.setattr(runner, "REPO_ROOT", repo)
    cell_input = {
        "cell_id": "careful__seed-3__nightly",
        "seed": 3,
        "max_turns": 1,
        "scenario": {"scene_id": "neutral-entry"},
        "initial_state": {
            "campaign_id": "eval-neutral",
            "investigator_id": "inv1",
            "character": {"schema_version": 1, "id": "inv1"},
            "public_state": {"active_scene_id": "neutral-entry"},
        },
        "player_model": {"provider": "coding-relay", "id": "gpt-5.6-luna"},
        "kp_model": {"provider": "zhipu-coding", "id": "glm-5.2"},
        "prompt_sources": sources,
        "prompt_hashes": {"player": _sha256(player), "kp": _sha256(narrator)},
    }
    message = "missing prompt source: player" if source_kind == "missing" else (
        "prompt source escaped repository: player"
    )
    with pytest.raises(ValueError, match=message):
        runner.run_live_cell(cell_input, tmp_path / "cell", env={})


@pytest.mark.parametrize("owned_child", ["workspace", "playtest"])
def test_live_cell_rejects_symlinked_runner_owned_directory(
    tmp_path, monkeypatch, owned_child
):
    runner = _load_live_cell()
    cell_dir = tmp_path / "cell"
    cell_dir.mkdir()
    outside = tmp_path / f"outside-{owned_child}"
    outside.mkdir()
    sentinel = outside / "sentinel.txt"
    sentinel.write_text("outside must remain unchanged\n", encoding="utf-8")
    (cell_dir / owned_child).symlink_to(outside, target_is_directory=True)
    before = {path.name: path.read_bytes() for path in outside.iterdir()}

    monkeypatch.setattr(
        runner.live_match,
        "run_live_match",
        lambda *args, **kwargs: _fake_attested_match(
            runner, Path(kwargs["run_dir"])
        ),
    )
    with pytest.raises(
        ValueError, match=f"unsafe runner-owned directory: {owned_child}"
    ):
        runner.run_live_cell(_canonical_live_cell_input(), cell_dir, env={})

    after = {path.name: path.read_bytes() for path in outside.iterdir()}
    assert after == before
    if owned_child == "playtest":
        assert not (cell_dir / "workspace").exists()


@pytest.mark.parametrize("attack", ["symlink", "directory"])
def test_live_cell_rejects_unsafe_fixed_artifact_target(
    tmp_path, monkeypatch, attack
):
    runner = _load_live_cell()
    cell_dir = tmp_path / "cell"
    cell_dir.mkdir()
    if attack == "symlink":
        outside = tmp_path / "outside-evidence.json"
        outside.write_text("outside must remain unchanged\n", encoding="utf-8")
        (cell_dir / "evidence.json").symlink_to(outside)
        target = "evidence.json"
    else:
        outside = None
        (cell_dir / "transcript.jsonl").mkdir()
        target = "transcript.jsonl"

    monkeypatch.setattr(
        runner.live_match,
        "run_live_match",
        lambda *args, **kwargs: _fake_attested_match(
            runner, Path(kwargs["run_dir"])
        ),
    )

    with pytest.raises(ValueError, match=f"unsafe runner-owned artifact: {target}"):
        runner.run_live_cell(_canonical_live_cell_input(), cell_dir, env={})

    if outside is not None:
        assert outside.read_text(encoding="utf-8") == (
            "outside must remain unchanged\n"
        )


def test_live_cell_allows_reuse_of_regular_runner_owned_paths(tmp_path, monkeypatch):
    runner = _load_live_cell()
    cell_dir = tmp_path / "cell"
    monkeypatch.setattr(
        runner.live_match,
        "run_live_match",
        lambda *args, **kwargs: _fake_attested_match(
            runner, Path(kwargs["run_dir"])
        ),
    )

    first = runner.run_live_cell(_canonical_live_cell_input(), cell_dir, env={})
    second = runner.run_live_cell(_canonical_live_cell_input(), cell_dir, env={})

    assert first["status"] == second["status"] == "PASS"
    assert (cell_dir / "workspace").is_dir()
    assert (cell_dir / "playtest").is_dir()


def test_missing_prerequisites_mark_cell_not_run_with_reasons(tmp_path: Path):
    matrix = _load()
    config = {
        "schema_version": 1,
        "eval_spec": "eval-spec-v1",
        "persona_ids": ["careful_investigator"],
        "seeds": [11],
        "cases": [
            {
                "case_id": "missing-runner-case",
                "runner": "fake",
                "runner_path": "does-not-exist.py",
                "scenario_fixture": "missing-scenario.json",
                "initial_state_fixture": "missing-state.json",
                "player_model": {"provider": "fixture", "id": "player-1"},
                "kp_model": {"provider": "fixture", "id": "kp-1"},
                "prompt_hashes": {"player": "a" * 64, "kp": "b" * 64},
                "require_credentials": ["COC_EVAL_PLAYER_API_KEY"],
            }
        ],
    }
    plan = matrix.build_matrix_plan(
        root=REPO,
        suite="nightly",
        configuration=config,
        credential_env={},
    )
    assert len(plan["cells"]) == 1
    cell = plan["cells"][0]
    assert cell["status"] == "NOT_RUN"
    reasons = set(cell["not_run_reasons"])
    assert "missing_runner_path" in reasons
    assert "missing_scenario_fixture" in reasons
    assert "missing_initial_state_fixture" in reasons
    assert "missing_credentials:COC_EVAL_PLAYER_API_KEY" in reasons


@pytest.mark.parametrize("unsafe_id", ["../nightly", "/tmp/nightly", "nested/case"])
def test_matrix_plan_rejects_unsafe_case_id(tmp_path: Path, unsafe_id: str):
    matrix = _load()
    runner = _fake_runner_script(tmp_path / "fake_runner.py")
    scenario = _write_json(tmp_path / "scenario.json", {"scene_id": "s1"})
    state = _write_json(tmp_path / "state.json", {"public": True})
    config = {
        "schema_version": 1,
        "eval_spec": "eval-spec-v1",
        "persona_ids": ["careful_investigator"],
        "seeds": [3],
        "cases": [
            {
                "case_id": unsafe_id,
                "runner": "fake",
                "runner_path": str(runner),
                "scenario_fixture": str(scenario),
                "initial_state_fixture": str(state),
                "player_model": {"provider": "fixture", "id": "player-1"},
                "kp_model": {"provider": "fixture", "id": "kp-1"},
                "prompt_hashes": {"player": "a" * 64, "kp": "b" * 64},
            }
        ],
    }
    with pytest.raises(ValueError, match="case_id must be a safe identifier"):
        matrix.build_matrix_plan(
            root=REPO,
            suite="nightly",
            configuration=config,
            credential_env={},
        )


def test_matrix_plan_rejects_unsafe_persona_id():
    matrix = _load()
    config = {
        "schema_version": 1,
        "eval_spec": "eval-spec-v1",
        "persona_ids": ["../careful_investigator"],
        "seeds": [3],
        "cases": [{"case_id": "nightly"}],
    }
    with pytest.raises(ValueError, match="persona_id must be a safe identifier"):
        matrix.build_matrix_plan(
            root=REPO,
            suite="nightly",
            configuration=config,
            credential_env={},
        )


@pytest.mark.parametrize("attack", ["traversal", "absolute", "separator"])
def test_execute_matrix_rejects_cell_directory_escape(tmp_path: Path, attack: str):
    matrix = _load()
    out = tmp_path / "matrix-out"
    if attack == "traversal":
        cell_id = "../escaped-cell"
        escaped = out / "escaped-cell"
    elif attack == "absolute":
        escaped = tmp_path / "absolute-cell"
        cell_id = str(escaped)
    else:
        cell_id = "nested/cell"
        escaped = out / "cells" / "nested" / "cell"
    plan = {
        "schema_version": 1,
        "eval_spec": "eval-spec-v1",
        "suite": "nightly",
        "cells": [
            {
                "cell_id": cell_id,
                "persona_id": "careful_investigator",
                "case_id": "nightly",
                "seed": 3,
                "status": "NOT_RUN",
                "not_run_reasons": ["fixture"],
            }
        ],
    }
    with pytest.raises(ValueError, match="cell_id must be a safe identifier"):
        matrix.execute_matrix_plan(plan, root=REPO, output=out)
    assert not (escaped / "run-manifest.json").exists()


def test_execute_matrix_plan_runs_ready_cells_with_fake_adapter(
    tmp_path: Path, monkeypatch
):
    matrix = _load()
    runner = _fake_runner_script(tmp_path / "fake_runner.py")
    scenario = _write_json(tmp_path / "scenario.json", {"scene_id": "s1"})
    state = _write_json(tmp_path / "state.json", {"public": True})
    config = {
        "schema_version": 1,
        "eval_spec": "eval-spec-v1",
        "persona_ids": ["careful_investigator"],
        "seeds": [3],
        "cases": [
            {
                "case_id": "fake-ready-case",
                "runner": "fake",
                "runner_path": str(runner),
                "scenario_fixture": str(scenario),
                "initial_state_fixture": str(state),
                "player_model": {"provider": "fixture", "id": "player-1"},
                "kp_model": {"provider": "fixture", "id": "kp-1"},
                "prompt_sources": {"player": str(runner), "kp": str(runner)},
                "judge": {"enabled": True, "rubric_id": "agency-and-fun"},
            }
        ],
    }
    plan = matrix.build_matrix_plan(
        root=REPO,
        suite="nightly",
        configuration=config,
        credential_env={},
    )
    assert plan["cells"][0]["status"] == "READY"
    baseline = _write_baseline_matrix(tmp_path / "baseline", plan)
    observed = {}

    def fake_judge(request, rubric, **kwargs):
        observed["request"] = request
        observed["kwargs"] = kwargs
        return {
            "evaluator": {"provider": "coding-relay", "id": "gpt-5.6-sol"},
            "request_sha256": request["request_sha256"],
            "winner": "B",
            "dimension_scores": {
                rubric["dimensions"][0]["dimension_id"]: 4,
            },
            "findings": [],
            "reasons": ["The public turns support side B."],
        }

    monkeypatch.setattr(matrix.secrets, "randbits", lambda bits: 987654321)
    monkeypatch.setattr(matrix.judge, "invoke_sol_judge", fake_judge)
    out = tmp_path / "matrix-out"
    results = matrix.execute_matrix_plan(
        plan,
        root=REPO,
        output=out,
        baseline_dir=baseline,
    )
    assert results["schema_version"] == 1
    assert results["cells"][0]["status"] == "PASS"
    assert (out / "matrix-plan.json").is_file()
    assert (out / "matrix-results.json").is_file()
    assert (out / "aggregate-summary.json").is_file()
    cell_dir = out / "cells" / results["cells"][0]["cell_id"]
    assert (cell_dir / "run-manifest.json").is_file()
    assert (cell_dir / "judge-request.json").is_file()
    assert (cell_dir / "judge-result.json").is_file()
    public_payload = json.dumps(observed["request"], ensure_ascii=False)
    assert "旧版公开叙事" in public_payload
    assert "新版公开叙事" in public_payload
    assert "fixture-a" not in public_payload
    assert "fixture-b" not in public_payload
    assert "keeper_secret" not in public_payload
    assert "must-not-reach-judge" not in public_payload
    assert "seed" not in observed["request"]
    assert observed["request"]["public_context"]["seed"] == 3
    assert results["cells"][0]["judge_result"]["evaluator"] == {
        "provider": "coding-relay",
        "id": "gpt-5.6-sol",
    }
    cell_input = json.loads((cell_dir / "cell-input.json").read_text(encoding="utf-8"))
    assert cell_input["prompt_sources"] == {
        "player": str(runner),
        "kp": str(runner),
    }
    plan_hash = results["artifact_hashes"]["matrix-plan.json"]
    assert plan_hash == _sha256(out / "matrix-plan.json")


def test_judged_matrix_marks_missing_baseline_not_run(tmp_path: Path, monkeypatch):
    matrix = _load()
    runner = _fake_runner_script(tmp_path / "fake_runner.py")
    scenario = _write_json(tmp_path / "scenario.json", {"scene_id": "s1"})
    state = _write_json(tmp_path / "state.json", {"public": True})
    config = {
        "schema_version": 1,
        "eval_spec": "eval-spec-v1",
        "persona_ids": ["careful_investigator"],
        "seeds": [3],
        "cases": [
            {
                "case_id": "missing-baseline",
                "runner": "fake",
                "runner_path": str(runner),
                "scenario_fixture": str(scenario),
                "initial_state_fixture": str(state),
                "player_model": {"provider": "fixture", "id": "player-1"},
                "kp_model": {"provider": "fixture", "id": "kp-1"},
                "prompt_sources": {"player": str(runner), "kp": str(runner)},
                "judge": {"enabled": True, "rubric_id": "agency-and-fun"},
            }
        ],
    }
    plan = matrix.build_matrix_plan(
        root=REPO,
        suite="nightly",
        configuration=config,
        credential_env={},
    )
    monkeypatch.setattr(
        matrix.judge,
        "invoke_sol_judge",
        lambda *args, **kwargs: pytest.fail("judge must not run without baseline"),
    )

    results = matrix.execute_matrix_plan(
        plan,
        root=REPO,
        output=tmp_path / "out",
    )

    cell = results["cells"][0]
    assert cell["status"] == "NOT_RUN"
    assert cell["not_run_reasons"] == ["missing_baseline_evidence"]
    assert results["aggregate"]["hard_findings_override_judge"] is True

    def fake_judge(request, rubric, **kwargs):
        return {
            "evaluator": {"provider": "coding-relay", "id": "gpt-5.6-sol"},
            "request_sha256": request["request_sha256"],
            "winner": "tie",
            "dimension_scores": {
                rubric["dimensions"][0]["dimension_id"]: 3,
            },
            "findings": [],
            "reasons": ["The public turns support a tie."],
        }

    monkeypatch.setattr(matrix.judge, "invoke_sol_judge", fake_judge)
    judged = matrix.execute_matrix_plan(
        plan,
        root=REPO,
        output=tmp_path / "judged",
        baseline_dir=tmp_path / "out",
    )
    assert judged["cells"][0]["status"] == "PASS"
    assert (tmp_path / "judged" / "cells" / cell["cell_id"] / "judge-result.json").is_file()


def test_public_turn_loader_never_falls_back_to_unfiltered_transcript(tmp_path: Path):
    matrix = _load()
    cell_dir = tmp_path / "cell"
    _write(
        cell_dir / "transcript.jsonl",
        json.dumps(
            {
                "turn": 1,
                "role": "keeper_internal",
                "text": "private keeper prose",
            }
        )
        + "\n",
    )

    assert matrix._public_cell_turns(cell_dir) == []


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("player_model", {"provider": "fixture", "id": "other-player"}),
        ("max_turns", 99),
        ("scenario_sha256", "0" * 64),
    ],
)
def test_judged_matrix_rejects_mismatched_baseline_identity(
    tmp_path: Path, monkeypatch, field: str, value: object
):
    matrix = _load()
    runner = _fake_runner_script(tmp_path / "fake_runner.py")
    scenario = _write_json(tmp_path / "scenario.json", {"scene_id": "s1"})
    state = _write_json(tmp_path / "state.json", {"public": True})
    config = {
        "schema_version": 1,
        "eval_spec": "eval-spec-v1",
        "persona_ids": ["careful_investigator"],
        "seeds": [3],
        "cases": [
            {
                "case_id": "identity-mismatch",
                "runner": "fake",
                "runner_path": str(runner),
                "scenario_fixture": str(scenario),
                "initial_state_fixture": str(state),
                "player_model": {"provider": "fixture", "id": "player-1"},
                "kp_model": {"provider": "fixture", "id": "kp-1"},
                "prompt_sources": {"player": str(runner), "kp": str(runner)},
                "judge": {"enabled": True, "rubric_id": "agency-and-fun"},
            }
        ],
    }
    plan = matrix.build_matrix_plan(
        root=REPO,
        suite="nightly",
        configuration=config,
        credential_env={},
    )
    baseline = _write_baseline_matrix(
        tmp_path / "baseline",
        plan,
        identity_overrides={field: value},
    )
    monkeypatch.setattr(
        matrix.judge,
        "invoke_sol_judge",
        lambda *args, **kwargs: pytest.fail("judge must not run on identity mismatch"),
    )

    results = matrix.execute_matrix_plan(
        plan,
        root=REPO,
        output=tmp_path / "out",
        baseline_dir=baseline,
    )

    cell = results["cells"][0]
    assert cell["status"] == "NON_COMPARABLE"
    assert cell["identity_mismatches"] == [field]
    assert not (tmp_path / "out" / "cells" / cell["cell_id"] / "judge-result.json").exists()


def test_hard_runner_findings_prevent_favorable_judge_override(
    tmp_path: Path, monkeypatch
):
    matrix = _load()
    runner = _write(
        tmp_path / "ineligible_runner.py",
        """#!/usr/bin/env python3
import json, sys
from pathlib import Path
payload = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
out = Path(sys.argv[2])
out.mkdir(parents=True, exist_ok=True)
(out / "player-view.jsonl").write_text(
    json.dumps({"turn_number": 1, "player_text": "行动", "narration": "结果"}) + "\\n",
    encoding="utf-8",
)
(out / "run-manifest.json").write_text(
    json.dumps({
        "status": "PASS",
        "cell_id": payload["cell_id"],
        "evidence_findings": ["missing_public_roll"],
    }) + "\\n",
    encoding="utf-8",
)
print(json.dumps({
    "status": "PASS",
    "cell_id": payload["cell_id"],
    "evidence_findings": ["missing_public_roll"],
}))
""",
    )
    runner.chmod(runner.stat().st_mode | stat.S_IXUSR)
    scenario = _write_json(tmp_path / "scenario.json", {"scene_id": "s1"})
    state = _write_json(tmp_path / "state.json", {"public": True})
    config = {
        "schema_version": 1,
        "eval_spec": "eval-spec-v1",
        "persona_ids": ["careful_investigator"],
        "seeds": [3],
        "cases": [
            {
                "case_id": "hard-finding",
                "runner": "fake",
                "runner_path": str(runner),
                "scenario_fixture": str(scenario),
                "initial_state_fixture": str(state),
                "player_model": {"provider": "fixture", "id": "player-1"},
                "kp_model": {"provider": "fixture", "id": "kp-1"},
                "prompt_sources": {"player": str(runner), "kp": str(runner)},
                "judge": {"enabled": True, "rubric_id": "agency-and-fun"},
            }
        ],
    }
    plan = matrix.build_matrix_plan(
        root=REPO,
        suite="nightly",
        configuration=config,
        credential_env={},
    )
    baseline = _write_baseline_matrix(tmp_path / "baseline", plan)
    monkeypatch.setattr(
        matrix.judge,
        "invoke_sol_judge",
        lambda *args, **kwargs: pytest.fail("hard findings must prevent judging"),
    )

    results = matrix.execute_matrix_plan(
        plan,
        root=REPO,
        output=tmp_path / "out",
        baseline_dir=baseline,
    )

    assert results["cells"][0]["status"] == "FAIL"
    assert results["cells"][0]["hard_findings"] == ["missing_public_roll"]
    assert results["aggregate"]["hard_findings"] == ["missing_public_roll"]
    assert results["aggregate"]["hard_findings_override_judge"] is True


def test_player_request_excludes_keeper_only_fields(tmp_path: Path):
    matrix = _load()
    runner = _fake_runner_script(tmp_path / "fake_runner.py")
    scenario = _write_json(
        tmp_path / "scenario.json",
        {"scene_id": "s1", "keeper_secret": "ritual-true-name"},
    )
    state = _write_json(
        tmp_path / "state.json",
        {
            "public_state": {"location": "hall"},
            "keeper_only": {"true_culprit": "hidden"},
            "player_evaluation_notes": "judge should never see this in KP input",
        },
    )
    config = {
        "schema_version": 1,
        "eval_spec": "eval-spec-v1",
        "persona_ids": ["careful_investigator"],
        "seeds": [5],
        "cases": [
            {
                "case_id": "view-separation-case",
                "runner": "fake",
                "runner_path": str(runner),
                "scenario_fixture": str(scenario),
                "initial_state_fixture": str(state),
                "player_model": {"provider": "fixture", "id": "player-1"},
                "kp_model": {"provider": "fixture", "id": "kp-1"},
                "prompt_hashes": {"player": "e" * 64, "kp": "f" * 64},
            }
        ],
    }
    plan = matrix.build_matrix_plan(
        root=REPO,
        suite="nightly",
        configuration=config,
        credential_env={},
    )
    out = tmp_path / "view-out"
    results = matrix.execute_matrix_plan(plan, root=REPO, output=out)
    cell_id = results["cells"][0]["cell_id"]
    player_request = json.loads(
        (out / "cells" / cell_id / "player-request.json").read_text(encoding="utf-8")
    )
    kp_request = json.loads(
        (out / "cells" / cell_id / "kp-request.json").read_text(encoding="utf-8")
    )
    player_encoded = json.dumps(player_request, ensure_ascii=False)
    assert "keeper_secret" not in player_encoded
    assert "ritual-true-name" not in player_encoded
    assert "true_culprit" not in player_encoded
    assert "keeper_only" not in player_encoded
    kp_encoded = json.dumps(kp_request, ensure_ascii=False)
    assert "player_evaluation_notes" not in kp_encoded
    assert "judge should never see this in KP input" not in kp_encoded


def test_matrix_cli_plan_only_writes_evidence(tmp_path: Path, capsys):
    cli = _load_cli()
    out = tmp_path / "cli-matrix"
    code = cli.main(
        [
            "matrix",
            "--suite",
            "nightly",
            "--root",
            str(REPO),
            "--output",
            str(out),
            "--plan-only",
        ]
    )
    captured = capsys.readouterr()
    payload = json.loads(captured.out)
    assert code in {0, 1, 2}
    assert payload["suite"] == "nightly"
    assert (out / "matrix-plan.json").is_file()
    assert payload["cell_count"] == len(payload["cells"])


def test_nightly_suite_remains_not_run_without_ai_player_matrix_capability(
    tmp_path: Path, capsys
):
    cli = _load_cli()
    code = cli.main(
        [
            "run",
            "--suite",
            "nightly",
            "--root",
            str(REPO),
            "--output",
            str(tmp_path / "nightly"),
        ]
    )
    payload = json.loads(capsys.readouterr().out)
    assert code == 2
    assert payload["status"] == "NOT_RUN"
    assert "ai_player_matrix" in payload["missing_capabilities"]
