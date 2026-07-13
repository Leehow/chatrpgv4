from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import re
import shutil
import stat
import sys
import time
import uuid
from collections import Counter
from pathlib import Path

import pytest


REPO = Path(__file__).resolve().parents[1]
MODULE_PATH = REPO / "plugins" / "coc-keeper" / "scripts" / "coc_eval_matrix.py"
LIVE_CELL_PATH = (
    REPO / "plugins" / "coc-keeper" / "scripts" / "coc_eval_live_cell.py"
)
CLI_PATH = REPO / "plugins" / "coc-keeper" / "scripts" / "coc_eval.py"
MANIFEST_PATH = REPO / "evaluation" / "spec" / "v1" / "benchmark-manifest.json"
RUN_MANIFEST_IDENTITY_KEYS = (
    "cell_id",
    "persona_id",
    "seed",
    "case_id",
    "runner",
    "max_turns",
    "player_model",
    "kp_model",
    "persona_profile_sha256",
    "prompt_hashes",
    "runner_hashes",
    "scenario_sha256",
    "initial_state_sha256",
)


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
    runner,
    run_dir: Path,
    *,
    include_runners: bool = True,
    turns: tuple[int, ...] = (1,),
) -> dict:
    player_model = {"provider": "coding-relay", "id": "gpt-5.6-luna"}
    kp_model = {"provider": "zhipu-coding", "id": "glm-5.2"}
    player_path = REPO / "runtime" / "adapters" / "player" / "run_player_turn.mjs"
    narrator_path = REPO / "runtime" / "adapters" / "narrator" / "run_narration.mjs"
    audit = runner.live_match.secret_audit.audit_secret_claims([], [], [])
    rows = []
    for attempt, turn in enumerate(turns, 1):
        rows.extend(
            [
                {
            "schema_version": 1,
            "role": "player",
            "attempt": attempt,
            "transcript_turn": turn,
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
            "attempt": attempt,
            "transcript_turn": turn,
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
        )
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
        "persona_id": "careful_investigator",
        "seed": 3,
        "case_id": "nightly",
        "runner": "live_match",
        "max_turns": 1,
        "persona_profile_sha256": "a" * 64,
        "runner_hashes": {"runner": "b" * 64},
        "scenario_sha256": "c" * 64,
        "initial_state_sha256": "d" * 64,
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


def _fake_runner_script(
    path: Path, *, manifest_overrides: dict | None = None
) -> Path:
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
        },
        ensure_ascii=False,
        sort_keys=True,
    )
    + "\\n",
    encoding="utf-8",
)
manifest = {
            "schema_version": 1,
            "eval_spec": "eval-spec-v1",
            "status": "PASS",
            "cell_id": payload.get("cell_id"),
            "evidence_eligible": True,
            "player_model": payload.get("player_model"),
            "kp_model": payload.get("kp_model"),
            "persona_id": payload.get("persona_id"),
            "seed": payload.get("seed"),
            "case_id": payload.get("case_id"),
            "runner": payload.get("runner"),
            "max_turns": payload.get("max_turns"),
            "persona_profile_sha256": payload.get("persona_profile_sha256"),
            "prompt_hashes": payload.get("prompt_hashes"),
            "runner_hashes": payload.get("runner_hashes"),
            "scenario_sha256": payload.get("scenario_sha256"),
            "initial_state_sha256": payload.get("initial_state_sha256"),
            "artifact_hashes": {
                "player-view.jsonl": hashlib.sha256(player_view.read_bytes()).hexdigest(),
            },
}
manifest.update(json.loads(__MANIFEST_OVERRIDES__))
(out / "run-manifest.json").write_text(
    json.dumps(
        manifest,
        indent=2,
        sort_keys=True,
    )
    + "\\n",
    encoding="utf-8",
)
print(json.dumps({"status": "PASS", "cell_id": payload.get("cell_id")}))
""".replace(
        "__MANIFEST_OVERRIDES__",
        repr(json.dumps(manifest_overrides or {}, ensure_ascii=False)),
    )
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
    identity = {key: cell.get(key) for key in RUN_MANIFEST_IDENTITY_KEYS}
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
            },
            ensure_ascii=False,
            sort_keys=True,
        )
        + "\n",
    )
    manifest = _write_json(
        cell_dir / "run-manifest.json",
        {
            **identity,
            "schema_version": 1,
            "eval_spec": "eval-spec-v1",
            "status": "PASS",
            "evidence_eligible": True,
            "artifact_hashes": {"player-view.jsonl": _sha256(player_view)},
        },
    )
    plan_path = output / "matrix-plan.json"
    results_path = output / "matrix-results.json"
    _write_json(
        results_path,
        {
            "schema_version": 1,
            "eval_spec": "eval-spec-v1",
            "suite": baseline_plan["suite"],
            "cells": [
                {
                    **identity,
                    "status": "PASS",
                    "not_run_reasons": [],
                    "runner_result": {"status": "PASS", "returncode": 0},
                    "artifact_hashes": {"run-manifest.json": _sha256(manifest)},
                }
            ],
            "artifact_hashes": {"matrix-plan.json": _sha256(plan_path)},
        },
    )
    return output


def _fake_judged_plan(matrix, tmp_path: Path, *, case_id: str = "judged-case") -> dict:
    runner = _fake_runner_script(tmp_path / f"{case_id}-runner.py")
    scenario = _write_json(tmp_path / f"{case_id}-scenario.json", {"scene_id": "s1"})
    state = _write_json(tmp_path / f"{case_id}-state.json", {"public": True})
    return matrix.build_matrix_plan(
        root=REPO,
        suite="nightly",
        configuration={
            "schema_version": 1,
            "eval_spec": "eval-spec-v1",
            "persona_ids": ["careful_investigator"],
            "seeds": [3],
            "cases": [
                {
                    "case_id": case_id,
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
        },
        credential_env={},
    )


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

    tampered_result_cell = json.loads(json.dumps(result_cell))
    tampered_result_cell["artifact_hashes"]["run-manifest.json"] = "0" * 64
    with pytest.raises(ValueError, match="manifest hash"):
        matrix._attested_public_cell_turns(
            cell_dir,
            expected_cell_id="careful__seed-3__nightly",
            result_cell=tampered_result_cell,
        )

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


@pytest.mark.parametrize(
    "tamper",
    (
        "plan_suite",
        "results_schema_version",
        "results_eval_spec",
        "results_suite",
        "results_plan_hash",
        "results_manifest_hash",
        "results_cell_hard_finding",
        "results_cell_seed",
    ),
)
def test_judged_matrix_rejects_tampered_baseline_run_contract(
    tmp_path: Path, monkeypatch, tamper: str
):
    matrix = _load()
    plan = _fake_judged_plan(matrix, tmp_path, case_id=f"tamper-{tamper}")
    baseline = _write_baseline_matrix(tmp_path / "baseline", plan)
    if tamper == "plan_suite":
        path = baseline / "matrix-plan.json"
        payload = json.loads(path.read_text(encoding="utf-8"))
        payload["suite"] = "release"
    else:
        path = baseline / "matrix-results.json"
        payload = json.loads(path.read_text(encoding="utf-8"))
        if tamper == "results_schema_version":
            payload["schema_version"] = 2
        elif tamper == "results_eval_spec":
            payload["eval_spec"] = "other-spec"
        elif tamper == "results_suite":
            payload["suite"] = "release"
        elif tamper == "results_plan_hash":
            payload["artifact_hashes"]["matrix-plan.json"] = "0" * 64
        elif tamper == "results_manifest_hash":
            payload["cells"][0]["artifact_hashes"]["run-manifest.json"] = "0" * 64
        elif tamper == "results_cell_hard_finding":
            payload["cells"][0]["hard_findings"] = ["missing_public_roll"]
        else:
            payload["cells"][0]["seed"] += 1
    _write_json(path, payload)
    monkeypatch.setattr(
        matrix.judge,
        "invoke_sol_judge",
        lambda *args, **kwargs: pytest.fail("tampered baseline must not be judged"),
    )

    results = matrix.execute_matrix_plan(
        plan,
        root=REPO,
        output=tmp_path / "candidate",
        baseline_dir=baseline,
    )

    assert results["cells"][0]["status"] == "NON_COMPARABLE"
    assert results["cells"][0]["identity_mismatches"]


@pytest.mark.parametrize(
    ("tamper", "expected_status"),
    (
        ("player_model", "NON_COMPARABLE"),
        ("seed", "NON_COMPARABLE"),
        ("prompt_hashes", "NON_COMPARABLE"),
        ("manifest_only_finding", "NOT_RUN"),
    ),
)
def test_judged_matrix_reconciles_hash_bound_baseline_manifest_semantics(
    tmp_path: Path,
    monkeypatch,
    tamper: str,
    expected_status: str,
):
    matrix = _load()
    plan = _fake_judged_plan(matrix, tmp_path, case_id=f"manifest-{tamper}")
    baseline = _write_baseline_matrix(tmp_path / "baseline", plan)
    cell_id = plan["cells"][0]["cell_id"]
    manifest_path = baseline / "cells" / cell_id / "run-manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if tamper == "player_model":
        manifest["player_model"] = {"provider": "fixture", "id": "other-player"}
    elif tamper == "seed":
        manifest["seed"] = manifest["seed"] + 1
    elif tamper == "prompt_hashes":
        manifest["prompt_hashes"] = {**manifest["prompt_hashes"], "player": "0" * 64}
    else:
        manifest["evidence_findings"] = ["missing_public_roll"]
    _write_json(manifest_path, manifest)
    results_path = baseline / "matrix-results.json"
    baseline_results = json.loads(results_path.read_text(encoding="utf-8"))
    baseline_results["cells"][0]["artifact_hashes"]["run-manifest.json"] = _sha256(
        manifest_path
    )
    _write_json(results_path, baseline_results)
    monkeypatch.setattr(
        matrix.judge,
        "invoke_sol_judge",
        lambda *args, **kwargs: pytest.fail("invalid baseline must not reach Sol"),
    )

    results = matrix.execute_matrix_plan(
        plan,
        root=REPO,
        output=tmp_path / "candidate",
        baseline_dir=baseline,
    )

    assert results["cells"][0]["status"] == expected_status
    assert not (
        tmp_path / "candidate" / "cells" / cell_id / "judge-result.json"
    ).exists()


@pytest.mark.parametrize(
    ("field", "value"),
    (
        ("hard_findings", None),
        ("hard_findings", ""),
        ("hard_findings", {}),
        ("evidence_findings", None),
        ("evidence_findings", ""),
        ("evidence_findings", {}),
    ),
)
def test_run_manifest_rejects_present_malformed_finding_fields(
    tmp_path: Path, field: str, value: object
):
    matrix = _load()
    cell_dir = tmp_path / "cell"
    _write_json(
        cell_dir / "run-manifest.json",
        {
            "schema_version": 1,
            "eval_spec": "eval-spec-v1",
            "cell_id": "cell-1",
            "status": "PASS",
            field: value,
        },
    )

    with pytest.raises(ValueError, match=field):
        matrix._validated_run_manifest(cell_dir, "cell-1")


def test_run_manifest_defaults_missing_finding_fields_to_empty(tmp_path: Path):
    matrix = _load()
    cell_dir = tmp_path / "cell"
    _write_json(
        cell_dir / "run-manifest.json",
        {
            "schema_version": 1,
            "eval_spec": "eval-spec-v1",
            "cell_id": "cell-1",
            "status": "PASS",
        },
    )

    manifest = matrix._validated_run_manifest(cell_dir, "cell-1")

    assert manifest["hard_findings"] == []
    assert manifest["evidence_findings"] == []


@pytest.mark.parametrize(
    ("field", "value"),
    (
        ("hard_findings", None),
        ("hard_findings", ""),
        ("hard_findings", {}),
        ("evidence_findings", None),
        ("evidence_findings", ""),
        ("evidence_findings", {}),
    ),
)
def test_judged_matrix_blocks_malformed_manifest_findings_before_sol(
    tmp_path: Path, monkeypatch, field: str, value: object
):
    matrix = _load()
    runner = _fake_runner_script(
        tmp_path / f"malformed-{field}.py",
        manifest_overrides={field: value},
    )
    scenario = _write_json(tmp_path / "scenario.json", {"scene_id": "s1"})
    state = _write_json(tmp_path / "state.json", {"public": True})
    plan = matrix.build_matrix_plan(
        root=REPO,
        suite="nightly",
        configuration={
            "schema_version": 1,
            "eval_spec": "eval-spec-v1",
            "persona_ids": ["careful_investigator"],
            "seeds": [3],
            "cases": [
                {
                    "case_id": f"malformed-{field}",
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
        },
        credential_env={},
    )
    baseline = _write_baseline_matrix(tmp_path / "baseline", plan)
    monkeypatch.setattr(
        matrix.judge,
        "invoke_sol_judge",
        lambda *args, **kwargs: pytest.fail("malformed manifest must not reach Sol"),
    )

    results = matrix.execute_matrix_plan(
        plan,
        root=REPO,
        output=tmp_path / "candidate",
        baseline_dir=baseline,
    )

    assert results["cells"][0]["status"] == "INELIGIBLE"
    assert results["cells"][0]["hard_findings"] == ["invalid_run_manifest"]


def test_execute_matrix_rejects_forged_pass_plan_without_running_cell(
    tmp_path: Path, monkeypatch
):
    matrix = _load()
    plan = _fake_judged_plan(matrix, tmp_path, case_id="forged-pass")
    plan["cells"][0]["status"] = "PASS"
    output = tmp_path / "candidate"
    monkeypatch.setattr(
        matrix,
        "_invoke_fake_or_script_runner",
        lambda **kwargs: pytest.fail("forged PASS cell must not execute"),
    )

    with pytest.raises(ValueError, match="status"):
        matrix.execute_matrix_plan(plan, root=REPO, output=output)

    assert not output.exists()


@pytest.mark.parametrize(
    "tamper",
    (
        "schema_version",
        "eval_spec",
        "suite",
        "missing_cell_key",
        "extra_cell_key",
        "empty_prompt_hashes",
        "unrelated_prompt_hashes",
        "empty_runner_hashes",
        "unrelated_runner_hashes",
    ),
)
def test_execute_matrix_validates_full_plan_and_cell_contract_before_writes(
    tmp_path: Path, tamper: str
):
    matrix = _load()
    plan = _fake_judged_plan(matrix, tmp_path, case_id=f"plan-{tamper}")
    if tamper == "schema_version":
        plan["schema_version"] = 2
    elif tamper == "eval_spec":
        plan["eval_spec"] = "other-spec"
    elif tamper == "suite":
        plan["suite"] = "smoke"
    elif tamper == "missing_cell_key":
        plan["cells"][0].pop("runner_hashes")
    elif tamper == "extra_cell_key":
        plan["cells"][0]["unexpected"] = True
    elif tamper == "empty_prompt_hashes":
        plan["cells"][0]["prompt_hashes"] = {}
    elif tamper == "unrelated_prompt_hashes":
        plan["cells"][0]["prompt_hashes"] = {"other": "a" * 64}
    elif tamper == "empty_runner_hashes":
        plan["cells"][0]["runner_hashes"] = {}
    else:
        plan["cells"][0]["runner_hashes"] = {"other": "a" * 64}
    output = tmp_path / "candidate"

    with pytest.raises(ValueError, match="plan|cell"):
        matrix.execute_matrix_plan(plan, root=REPO, output=output)

    assert not output.exists()


@pytest.mark.parametrize("attack", ("root", "cells", "cell", "cell_bad_contract"))
def test_matrix_rejects_symlinked_baseline_paths_before_candidate_writes(
    tmp_path: Path, attack: str
):
    matrix = _load()
    plan = _fake_judged_plan(matrix, tmp_path, case_id=f"symlink-{attack}")
    baseline = _write_baseline_matrix(tmp_path / "baseline", plan)
    baseline_arg = baseline
    if attack == "root":
        baseline_arg = tmp_path / "baseline-link"
        baseline_arg.symlink_to(baseline, target_is_directory=True)
    elif attack == "cells":
        outside = tmp_path / "outside-cells"
        shutil.copytree(baseline / "cells", outside)
        shutil.rmtree(baseline / "cells")
        (baseline / "cells").symlink_to(outside, target_is_directory=True)
    else:
        cell_id = plan["cells"][0]["cell_id"]
        cell_dir = baseline / "cells" / cell_id
        outside = tmp_path / "outside-cell"
        shutil.copytree(cell_dir, outside)
        shutil.rmtree(cell_dir)
        cell_dir.symlink_to(outside, target_is_directory=True)
        if attack == "cell_bad_contract":
            baseline_plan_path = baseline / "matrix-plan.json"
            baseline_plan = json.loads(
                baseline_plan_path.read_text(encoding="utf-8")
            )
            baseline_plan["suite"] = "release"
            _write_json(baseline_plan_path, baseline_plan)
    sentinel = baseline / "sentinel.txt"
    sentinel.write_text("baseline unchanged\n", encoding="utf-8")
    output = tmp_path / "candidate"

    with pytest.raises(ValueError, match="baseline.*symlink"):
        matrix.execute_matrix_plan(
            plan,
            root=REPO,
            output=output,
            baseline_dir=baseline_arg,
        )

    assert not output.exists()
    assert sentinel.read_text(encoding="utf-8") == "baseline unchanged\n"


def test_matrix_rejects_symlinked_baseline_ancestor_before_candidate_writes(
    tmp_path: Path, monkeypatch
):
    matrix = _load()
    plan = _fake_judged_plan(matrix, tmp_path, case_id="ancestor-symlink")
    outside = tmp_path / "outside-lanes"
    _write_baseline_matrix(outside / "matrix", plan)
    baseline_run = tmp_path / "baseline-run"
    baseline_run.mkdir()
    (baseline_run / "lanes").symlink_to(outside, target_is_directory=True)
    output = tmp_path / "candidate"
    monkeypatch.setattr(
        matrix,
        "_invoke_fake_or_script_runner",
        lambda **kwargs: pytest.fail("ancestor symlink must fail before runner"),
    )

    with pytest.raises(ValueError, match="baseline.*symlink"):
        matrix.execute_matrix_plan(
            plan,
            root=REPO,
            output=output,
            baseline_dir=baseline_run / "lanes" / "matrix",
        )

    assert not output.exists()


@pytest.mark.parametrize("relationship", ("same", "output_child", "output_parent"))
def test_matrix_rejects_overlapping_baseline_and_output_before_mutation(
    tmp_path: Path, relationship: str
):
    matrix = _load()
    root = tmp_path / "overlap-root"
    plan = _fake_judged_plan(matrix, tmp_path, case_id=f"overlap-{relationship}")
    baseline = _write_baseline_matrix(root / "baseline", plan)
    if relationship == "same":
        output = baseline
    elif relationship == "output_child":
        output = baseline / "candidate"
    else:
        output = root
    sentinel = baseline / "sentinel.txt"
    sentinel.write_text("baseline unchanged\n", encoding="utf-8")
    before = {
        str(path.relative_to(baseline)): path.read_bytes()
        for path in baseline.rglob("*")
        if path.is_file()
    }

    with pytest.raises(ValueError, match="overlap"):
        matrix.execute_matrix_plan(
            plan,
            root=REPO,
            output=output,
            baseline_dir=baseline,
        )

    after = {
        str(path.relative_to(baseline)): path.read_bytes()
        for path in baseline.rglob("*")
        if path.is_file()
    }
    assert after == before
    if relationship == "output_child":
        assert not output.exists()
    if relationship == "output_parent":
        assert not (output / "matrix-plan.json").exists()


def test_manifest_declares_reachable_matrix_and_semantic_capabilities():
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
    implemented = set(manifest["implemented_capabilities"])
    required = set(manifest["suites"]["nightly"]["required_capabilities"])
    assert {"ai_player_matrix", "semantic_judge", "long_memory"} <= implemented
    assert {"ai_player_matrix", "semantic_judge", "long_memory"} <= required


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


def test_live_segment_returns_exact_canonical_turns_and_attestation(
    tmp_path, monkeypatch
):
    runner = _load_live_cell()
    scenario = json.loads(
        (
            REPO
            / "evaluation"
            / "spec"
            / "v1"
            / "fixtures"
            / "matrix"
            / "nightly-scenario.json"
        ).read_text(encoding="utf-8")
    )
    initial = json.loads(
        (
            REPO
            / "evaluation"
            / "spec"
            / "v1"
            / "fixtures"
            / "matrix"
            / "nightly-initial-state.json"
        ).read_text(encoding="utf-8")
    )
    workspace, _campaign_id, _investigator_id = runner.materialize_workspace(
        scenario, initial, tmp_path / "workspace"
    )
    observed = {}

    def fake_canonical_match(*args, **kwargs):
        observed["args"] = args
        observed["kwargs"] = kwargs
        observed["player_model"] = {
            "provider": os.environ["COC_PLAYER_MODEL_PROVIDER"],
            "id": os.environ["COC_PLAYER_MODEL_ID"],
        }
        observed["kp_model"] = {
            "provider": os.environ["COC_NARRATOR_MODEL_PROVIDER"],
            "id": os.environ["COC_NARRATOR_MODEL_ID"],
        }
        run_dir = Path(kwargs["run_dir"])
        run_dir.mkdir(parents=True)
        return {
            "run_dir": str(run_dir),
            "turns": [
                {"turn_number": turn, "decision_id": f"decision-{turn}"}
                for turn in (1, 2)
            ],
            "player_turns": [{"player_text": "fixture"}] * 2,
            "evidence": _write_attested_live_artifacts(
                runner, run_dir, turns=(1, 2)
            ),
            "metadata": {
                "run_id": "segment-1",
                "runner_kind": "external_model_bridge",
            },
        }

    monkeypatch.setattr(runner.live_match, "run_live_match", fake_canonical_match)
    model_roles = {
        "player": {"provider": "coding-relay", "id": "gpt-5.6-luna"},
        "kp": {"provider": "zhipu-coding", "id": "glm-5.2"},
    }

    result = runner.run_live_segment(
        start_turn=1,
        turn_count=2,
        workspace=workspace,
        output=tmp_path / "segment-1",
        model_roles=model_roles,
        env={},
    )

    assert result["accepted_turns"] == [1, 2]
    assert len(result["snapshot_sha256"]) == 64
    assert result["attestation"]["player_model"] == model_roles["player"]
    assert result["attestation"]["kp_model"] == model_roles["kp"]
    assert result["attestation"]["attested"] is True
    assert result["attestation"]["runners"]["segment"] == {
        "kind": "python_function",
        "identity": "coc-eval-live-segment@1",
        "path": "plugins/coc-keeper/scripts/coc_eval_live_cell.py",
        "sha256": _sha256(LIVE_CELL_PATH),
    }
    assert result["attestation"]["runners"]["player"]["identity"] == (
        "coc-runtime-player-adapter@0.79.9"
    )
    assert result["attestation"]["runners"]["narrator"]["identity"] == (
        "coc-runtime-narrator-adapter@0.79.9"
    )
    assert re.fullmatch(r"[0-9a-f]{32}", result["runner_invocation_id"])
    issued_uuid = uuid.UUID(hex=result["runner_invocation_id"])
    assert issued_uuid.version == 4
    assert issued_uuid.variant == uuid.RFC_4122
    assert result["runner_invocation_id"] != "segment-1"
    assert result["runner_invocation_source"]["kind"] == "runner_issued_uuid"
    assert result["runner_invocation_source"]["json_pointer"] == (
        "/runner_invocation_id"
    )
    metadata_descriptor = result["runner_invocation_source"]["artifact"]
    metadata_artifact = tmp_path / "segment-1" / metadata_descriptor["artifact"]
    assert metadata_descriptor["sha256"] == _sha256(metadata_artifact)
    metadata_receipt = json.loads(metadata_artifact.read_text(encoding="utf-8"))
    assert metadata_receipt["source"] == "coc_eval_live_cell.run_live_segment"
    assert metadata_receipt["runner_invocation_id"] == result[
        "runner_invocation_id"
    ]
    assert metadata_receipt["live_match_metadata"]["run_id"] == "segment-1"
    ledger_rows = [
        json.loads(line)
        for line in (
            tmp_path / "segment-1" / "runner-invocations.jsonl"
        ).read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    assert Counter((row["role"], row["transcript_turn"]) for row in ledger_rows) == Counter(
        (role, turn) for turn in (1, 2) for role in ("player", "narrator")
    )
    assert all(
        row["segment_invocation_id"] == result["runner_invocation_id"]
        and row["segment_turn"] == row["transcript_turn"]
        and row["decision_id"] == f'decision-{row["transcript_turn"]}'
        for row in ledger_rows
    )
    assert result["turn_bindings"] == [
        {"turn_number": turn, "decision_id": f"decision-{turn}"}
        for turn in (1, 2)
    ]
    assert result["evidence_class"] == "external"
    assert result["artifacts"]["invocation_ledger"]["sha256"] == _sha256(
        tmp_path / "segment-1" / "runner-invocations.jsonl"
    )
    for name in ("checkpoint_entry", "checkpoint_final", "checkpoint_resume"):
        descriptor = result["artifacts"][name]
        artifact = tmp_path / "segment-1" / descriptor["artifact"]
        assert artifact.is_file()
        assert descriptor["sha256"] == _sha256(artifact)
    entry_manifest = json.loads(
        (tmp_path / "segment-1" / "checkpoint-entry-manifest.json").read_text(
            encoding="utf-8"
        )
    )
    assert entry_manifest["schema_version"] == 2
    assert entry_manifest["kind"] == "continuity-consumed-inputs"
    assert {item["role"] for item in entry_manifest["roots"]} >= {
        "mutable_campaign_state",
        "campaign_input",
    }
    present_files = {
        item["path"]
        for item in entry_manifest["files"]
        if item["present"] is True
    }
    for root in entry_manifest["roots"]:
        expected_entries = sorted(
            path.removeprefix(f'{root["path"]}/')
            for path in present_files
            if path.startswith(f'{root["path"]}/')
        )
        assert root["entries"] == expected_entries
        assert root["entry_count"] == len(expected_entries)
        assert root["entry_list_sha256"] == hashlib.sha256(
            json.dumps(
                expected_entries,
                ensure_ascii=False,
                sort_keys=True,
                separators=(",", ":"),
            ).encode("utf-8")
        ).hexdigest()
    campaign_root = ".coc/campaigns/eval-neutral"
    assert {
        f"{campaign_root}/campaign.json",
        f"{campaign_root}/save/world-state.json",
        f"{campaign_root}/save/pacing-state.json",
        f"{campaign_root}/save/flags.json",
        f"{campaign_root}/save/investigator-state/inv1.json",
        f"{campaign_root}/save/threat-state.json",
        f"{campaign_root}/save/subsystem-state.json",
        f"{campaign_root}/logs/events.jsonl",
        f"{campaign_root}/logs/rolls.jsonl",
        f"{campaign_root}/logs/subsystem-results.jsonl",
        *{
            f"{campaign_root}/scenario/{name}"
            for name in (
                "story-graph.json",
                "clue-graph.json",
                "npc-agendas.json",
                "threat-fronts.json",
                "pacing-map.json",
                "improvisation-boundaries.json",
                "module-meta.json",
            )
        },
        ".coc/runtime.json",
        *{
            f".coc/investigators/inv1/{name}"
            for name in (
                "creation.json",
                "character.json",
                "history.jsonl",
                "development.jsonl",
                "inventory-history.jsonl",
            )
        },
    }.issubset(present_files)
    assert any(
        item["path"] == ".coc/runtime.json" and item["present"] is True
        for item in entry_manifest["files"]
    )
    assert observed["args"][0] == workspace
    assert observed["kwargs"]["max_turns"] == 2
    assert observed["player_model"] == model_roles["player"]
    assert observed["kp_model"] == model_roles["kp"]

    def fake_match_without_run_id(*args, **kwargs):
        run_dir = Path(kwargs["run_dir"])
        run_dir.mkdir(parents=True)
        return {
            "run_dir": str(run_dir),
            "turns": [{"turn_number": 1, "decision_id": "decision-second-run"}],
            "evidence": _write_attested_live_artifacts(runner, run_dir),
            "metadata": {"runner_kind": "external_model_bridge"},
        }

    monkeypatch.setattr(
        runner.live_match, "run_live_match", fake_match_without_run_id
    )
    missing_id = runner.run_live_segment(
        start_turn=1,
        turn_count=1,
        workspace=workspace,
        output=tmp_path / "segment-without-run-id",
        model_roles=model_roles,
        env={},
    )
    assert re.fullmatch(r"[0-9a-f]{32}", missing_id["runner_invocation_id"])
    assert missing_id["runner_invocation_id"] != result["runner_invocation_id"]


def test_live_segment_rejects_shifted_canonical_turn_ids(tmp_path, monkeypatch):
    runner = _load_live_cell()
    fixture_root = (
        REPO / "evaluation" / "spec" / "v1" / "fixtures" / "matrix"
    )
    workspace, _campaign_id, _investigator_id = runner.materialize_workspace(
        json.loads(
            (fixture_root / "nightly-scenario.json").read_text(encoding="utf-8")
        ),
        json.loads(
            (fixture_root / "nightly-initial-state.json").read_text(
                encoding="utf-8"
            )
        ),
        tmp_path / "workspace",
    )

    def fake_shifted_match(*args, **kwargs):
        run_dir = Path(kwargs["run_dir"])
        run_dir.mkdir(parents=True)
        return {
            "turns": [{"turn_number": turn} for turn in (2, 3)],
            "evidence": _write_attested_live_artifacts(runner, run_dir),
            "metadata": {"run_id": "shifted-segment"},
        }

    monkeypatch.setattr(runner.live_match, "run_live_match", fake_shifted_match)
    model_roles = {
        "player": {"provider": "coding-relay", "id": "gpt-5.6-luna"},
        "kp": {"provider": "zhipu-coding", "id": "glm-5.2"},
    }

    with pytest.raises(ValueError, match="exact requested turn range"):
        runner.run_live_segment(
            start_turn=1,
            turn_count=2,
            workspace=workspace,
            output=tmp_path / "shifted-segment",
            model_roles=model_roles,
            env={},
        )


def test_live_segment_rejects_checkpoint_drift_before_model_invocation(
    tmp_path, monkeypatch
):
    runner = _load_live_cell()
    fixture_root = (
        REPO / "evaluation" / "spec" / "v1" / "fixtures" / "matrix"
    )
    workspace, _campaign_id, _investigator_id = runner.materialize_workspace(
        json.loads(
            (fixture_root / "nightly-scenario.json").read_text(encoding="utf-8")
        ),
        json.loads(
            (fixture_root / "nightly-initial-state.json").read_text(
                encoding="utf-8"
            )
        ),
        tmp_path / "workspace",
    )
    _write_json(
        workspace / ".coc" / "eval-continuity-restart.json",
        {
            "schema_version": 1,
            "eval_spec": "eval-spec-v1",
            "session_id": "eval-continuity:test",
            "expected_snapshot_sha256": "0" * 64,
        },
    )
    monkeypatch.setattr(
        runner.live_match,
        "run_live_match",
        lambda *args, **kwargs: pytest.fail(
            "model runner must not start after checkpoint drift"
        ),
    )
    model_roles = {
        "player": {"provider": "coding-relay", "id": "gpt-5.6-luna"},
        "kp": {"provider": "zhipu-coding", "id": "glm-5.2"},
    }

    with pytest.raises(ValueError, match="checkpoint hash mismatch"):
        runner.run_live_segment(
            start_turn=2,
            turn_count=1,
            workspace=workspace,
            output=tmp_path / "segment-2",
            model_roles=model_roles,
            env={},
        )


@pytest.mark.parametrize(
    "drift_target",
    [
        "campaign_log",
        "investigator_character",
        "runtime_config",
        "scenario_input",
    ],
)
def test_live_segment_checkpoint_covers_all_resume_consumed_inputs(
    tmp_path, monkeypatch, drift_target
):
    runner = _load_live_cell()
    fixture_root = (
        REPO / "evaluation" / "spec" / "v1" / "fixtures" / "matrix"
    )
    workspace, campaign_id, investigator_id = runner.materialize_workspace(
        json.loads(
            (fixture_root / "nightly-scenario.json").read_text(encoding="utf-8")
        ),
        json.loads(
            (fixture_root / "nightly-initial-state.json").read_text(
                encoding="utf-8"
            )
        ),
        tmp_path / "workspace",
    )
    log_path = (
        workspace / ".coc" / "campaigns" / campaign_id / "logs" / "events.jsonl"
    )
    log_path.touch()
    baseline = runner._canonical_campaign_snapshot_sha256(workspace, campaign_id)
    _write_json(
        workspace / ".coc" / "eval-continuity-restart.json",
        {
            "schema_version": 1,
            "eval_spec": "eval-spec-v1",
            "session_id": "eval-continuity:test",
            "expected_snapshot_sha256": baseline,
        },
    )
    if drift_target == "campaign_log":
        log_path.write_text('{"event_type":"drift"}\n', encoding="utf-8")
    elif drift_target == "investigator_character":
        character_path = (
            workspace
            / ".coc"
            / "investigators"
            / investigator_id
            / "character.json"
        )
        character = json.loads(character_path.read_text(encoding="utf-8"))
        character["name"] = "drifted"
        _write_json(character_path, character)
    elif drift_target == "runtime_config":
        runtime_path = workspace / ".coc" / "runtime.json"
        runtime = json.loads(runtime_path.read_text(encoding="utf-8"))
        runtime["brain"] = "changed-before-resume"
        _write_json(runtime_path, runtime)
    else:
        scenario_path = (
            workspace
            / ".coc"
            / "campaigns"
            / campaign_id
            / "scenario"
            / "module-meta.json"
        )
        scenario = json.loads(scenario_path.read_text(encoding="utf-8"))
        scenario["win_condition"] = "changed-before-resume"
        _write_json(scenario_path, scenario)
    monkeypatch.setattr(
        runner.live_match,
        "run_live_match",
        lambda *args, **kwargs: pytest.fail(
            "model runner must not start after uncovered mutable-state drift"
        ),
    )
    model_roles = {
        "player": {"provider": "coding-relay", "id": "gpt-5.6-luna"},
        "kp": {"provider": "zhipu-coding", "id": "glm-5.2"},
    }

    with pytest.raises(ValueError, match="checkpoint hash mismatch"):
        runner.run_live_segment(
            start_turn=2,
            turn_count=1,
            workspace=workspace,
            output=tmp_path / "segment-2",
            model_roles=model_roles,
            env={},
        )


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
    cell_input = _canonical_live_cell_input()
    monkeypatch.setattr(
        runner.live_match,
        "run_live_match",
        lambda *args, **kwargs: _fake_attested_match(
            runner, Path(kwargs["run_dir"])
        ),
    )

    first = runner.run_live_cell(cell_input, cell_dir, env={})
    second = runner.run_live_cell(cell_input, cell_dir, env={})

    assert first["status"] == second["status"] == "PASS"
    for key in RUN_MANIFEST_IDENTITY_KEYS:
        assert first[key] == cell_input[key]
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


def test_execute_matrix_preserves_allowed_not_run_cell_without_invoking_runner(
    tmp_path: Path, monkeypatch
):
    matrix = _load()
    plan = matrix.build_matrix_plan(
        root=REPO,
        suite="nightly",
        configuration={
            "schema_version": 1,
            "eval_spec": "eval-spec-v1",
            "persona_ids": ["careful_investigator"],
            "seeds": [11],
            "cases": [
                {
                    "case_id": "not-run",
                    "runner": "fake",
                    "runner_path": str(tmp_path / "missing-runner.py"),
                    "scenario_fixture": str(tmp_path / "missing-scenario.json"),
                    "initial_state_fixture": str(tmp_path / "missing-state.json"),
                    "player_model": {"provider": "fixture", "id": "player-1"},
                    "kp_model": {"provider": "fixture", "id": "kp-1"},
                    "prompt_hashes": {"player": "a" * 64, "kp": "b" * 64},
                }
            ],
        },
        credential_env={},
    )
    monkeypatch.setattr(
        matrix,
        "_invoke_fake_or_script_runner",
        lambda **kwargs: pytest.fail("NOT_RUN cell must not execute"),
    )

    results = matrix.execute_matrix_plan(
        plan,
        root=REPO,
        output=tmp_path / "out",
    )

    assert results["cells"][0]["status"] == "NOT_RUN"
    assert results["cells"][0]["not_run_reasons"] == plan["cells"][0][
        "not_run_reasons"
    ]


def test_execute_matrix_preserves_runner_not_run_without_elevation(
    tmp_path: Path, monkeypatch
):
    matrix = _load()
    plan = _fake_judged_plan(matrix, tmp_path, case_id="runner-not-run")
    monkeypatch.setattr(
        matrix,
        "_invoke_fake_or_script_runner",
        lambda **kwargs: {
            "status": "NOT_RUN",
            "returncode": None,
            "not_run_reasons": ["runner_unavailable"],
        },
    )

    results = matrix.execute_matrix_plan(
        plan,
        root=REPO,
        output=tmp_path / "out",
    )

    cell = results["cells"][0]
    assert cell["status"] == "NOT_RUN"
    assert cell["not_run_reasons"] == ["runner_unavailable"]
    assert "hard_findings" not in cell


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
    plan = _fake_judged_plan(matrix, tmp_path, case_id=f"escape-{attack}")
    if attack == "traversal":
        cell_id = "../escaped-cell"
        escaped = out / "escaped-cell"
    elif attack == "absolute":
        escaped = tmp_path / "absolute-cell"
        cell_id = str(escaped)
    else:
        cell_id = "nested/cell"
        escaped = out / "cells" / "nested" / "cell"
    plan["cells"][0]["cell_id"] = cell_id
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
                item["dimension_id"]: 4 for item in rubric["dimensions"]
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
    assert results["aggregate"]["hard_findings"] == []
    assert results["aggregate"]["hard_findings_override_judge"] is False
    assert "READY" not in results["aggregate"]["status_counts"]

    def fake_judge(request, rubric, **kwargs):
        return {
            "evaluator": {"provider": "coding-relay", "id": "gpt-5.6-sol"},
            "request_sha256": request["request_sha256"],
            "winner": "tie",
            "dimension_scores": {
                item["dimension_id"]: 3 for item in rubric["dimensions"]
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


def test_matrix_runner_timeout_does_not_start_without_process_tree_supervisor(
    tmp_path: Path, monkeypatch
):
    matrix = _load()
    monkeypatch.setattr(
        matrix, "_supports_process_tree_supervisor", lambda: False, raising=False
    )
    monkeypatch.setattr(
        matrix.subprocess,
        "Popen",
        lambda *args, **kwargs: pytest.fail("unsupported timeout must not start"),
    )

    result = matrix._invoke_fake_or_script_runner(
        runner_path=tmp_path / "runner.py",
        cell_input=tmp_path / "cell-input.json",
        cell_dir=tmp_path / "cell",
        timeout_s=0.1,
    )

    assert result["status"] == "NOT_RUN"
    assert result["not_run_reasons"] == ["process_tree_supervisor_unsupported"]
    assert result["returncode"] is None


def test_matrix_runner_timeout_cleanup_and_pipe_drain_are_bounded(
    tmp_path: Path, monkeypatch
):
    matrix = _load()

    class Process:
        pid = 4343
        returncode = 0
        stdout = None
        stderr = None

    process = Process()
    stdout = matrix._TailStreamCapture(matrix._TIMEOUT_STREAM_LIMIT_BYTES)
    stderr = matrix._TailStreamCapture(matrix._TIMEOUT_STREAM_LIMIT_BYTES)
    stdout.feed(b"partial-out")
    stderr.feed(b"partial-err")
    monkeypatch.setattr(matrix.subprocess, "Popen", lambda *args, **kwargs: process)
    monkeypatch.setattr(
        matrix, "_supports_process_tree_supervisor", lambda: True, raising=False
    )
    monkeypatch.setattr(
        matrix,
        "_drain_runner_pipes",
        lambda candidate, timeout: (stdout, stderr, True, False, False),
    )

    result = matrix._invoke_fake_or_script_runner(
        runner_path=tmp_path / "runner.py",
        cell_input=tmp_path / "cell-input.json",
        cell_dir=tmp_path / "cell",
        timeout_s=0.1,
    )

    assert result["status"] == "NOT_RUN"
    assert result["timed_out"] is True
    assert result["not_run_reasons"] == [
        "execution_timeout",
        "process_tree_termination_unconfirmed",
        "process_output_drain_timeout",
    ]
    assert result["stdout"] == "partial-out"
    assert result["stderr"] == "partial-err"


def test_matrix_runner_timeout_reasons_propagate_to_cell_manifest(
    tmp_path: Path, monkeypatch
):
    matrix = _load()
    plan = _fake_judged_plan(matrix, tmp_path, case_id="runner-cleanup-timeout")
    reasons = [
        "execution_timeout",
        "process_tree_termination_unconfirmed",
        "process_output_drain_timeout",
    ]
    monkeypatch.setattr(
        matrix,
        "_invoke_fake_or_script_runner",
        lambda **kwargs: {
            "status": "NOT_RUN",
            "timed_out": True,
            "not_run_reasons": reasons,
            "returncode": None,
            "stdout": "partial-out",
            "stderr": "partial-err",
            "stdout_truncated": True,
            "stderr_truncated": False,
        },
    )

    results = matrix.execute_matrix_plan(
        plan,
        root=REPO,
        output=tmp_path / "out",
        runner_timeout_s=0.1,
    )

    cell = results["cells"][0]
    assert cell["status"] == "NOT_RUN"
    assert cell["not_run_reasons"] == reasons
    cell_dir = tmp_path / "out" / "cells" / cell["cell_id"]
    stdout_path = cell_dir / "runner-timeout-stdout.log"
    stderr_path = cell_dir / "runner-timeout-stderr.log"
    assert stdout_path.read_text(encoding="utf-8") == "partial-out"
    assert stderr_path.read_text(encoding="utf-8") == "partial-err"
    assert cell["runner_result"]["stdout_path"] == stdout_path.name
    assert cell["runner_result"]["stderr_path"] == stderr_path.name
    assert cell["runner_result"]["stdout_truncated"] is True
    assert cell["runner_result"]["stderr_truncated"] is False
    assert "stdout" not in cell["runner_result"]
    assert "stderr" not in cell["runner_result"]
    assert cell["artifact_hashes"][stdout_path.name] == _sha256(stdout_path)
    assert cell["artifact_hashes"][stderr_path.name] == _sha256(stderr_path)
    manifest = json.loads(
        (
            tmp_path / "out" / "cells" / cell["cell_id"] / "run-manifest.json"
        ).read_text(encoding="utf-8")
    )
    assert manifest["not_run_reasons"] == reasons
    assert manifest["artifact_hashes"][stdout_path.name] == _sha256(stdout_path)
    assert manifest["artifact_hashes"][stderr_path.name] == _sha256(stderr_path)


def test_timeout_stream_bound_is_exact_for_split_utf8_codepoint():
    matrix = _load()
    limit = matrix._TIMEOUT_STREAM_LIMIT_BYTES

    bounded, truncated = matrix._bounded_stream_evidence("€" + "x" * limit)

    assert truncated is True
    assert bounded == "x" * limit
    assert len(bounded.encode("utf-8")) <= limit


def test_matrix_runner_capture_is_bounded_under_high_volume_output(tmp_path: Path):
    matrix = _load()
    payload = {"status": "PASS", "hard_findings": [], "evidence_findings": []}
    runner = _write(
        tmp_path / "noisy-runner.py",
        "\n".join(
            [
                "import json, os",
                "chunk_out = b'x' * 32768",
                "chunk_err = b'y' * 32768",
                "for _ in range(128):",
                "    os.write(1, chunk_out)",
                "    os.write(2, chunk_err)",
                f"os.write(1, b'\\n' + json.dumps({payload!r}).encode('utf-8'))",
            ]
        )
        + "\n",
    )
    cell_input = _write_json(tmp_path / "cell-input.json", {"cell_id": "noisy"})
    cell_dir = tmp_path / "cell"
    cell_dir.mkdir()

    result = matrix._invoke_fake_or_script_runner(
        runner_path=runner,
        cell_input=cell_input,
        cell_dir=cell_dir,
        timeout_s=10.0,
    )

    limit = matrix._TIMEOUT_STREAM_LIMIT_BYTES
    assert result["status"] == "PASS"
    assert result["stdout_truncated"] is True
    assert result["stderr_truncated"] is True
    assert len(result["stdout"].encode("utf-8")) <= limit
    assert len(result["stderr"].encode("utf-8")) <= limit
    assert result["stdout"].endswith(json.dumps(payload))


def test_matrix_runner_timeout_kills_descendants_and_stays_not_run(tmp_path: Path):
    matrix = _load()
    sentinel = tmp_path / "orphan-sentinel.txt"
    runner = _write(
        tmp_path / "hanging-runner.py",
        "\n".join(
            [
                "import subprocess, sys, time",
                f"sentinel = {str(sentinel)!r}",
                "subprocess.Popen([sys.executable, '-c', "
                "f\"import pathlib,signal,time; signal.signal(signal.SIGTERM, signal.SIG_IGN); "
                "time.sleep(0.8); pathlib.Path({sentinel!r}).write_text('orphan')\"])",
                "time.sleep(30)",
            ]
        )
        + "\n",
    )
    scenario = _write_json(tmp_path / "scenario.json", {"scene_id": "s1"})
    state = _write_json(tmp_path / "state.json", {"public": True})
    plan = matrix.build_matrix_plan(
        root=REPO,
        suite="nightly",
        configuration={
            "schema_version": 1,
            "eval_spec": "eval-spec-v1",
            "persona_ids": ["careful_investigator"],
            "seeds": [3],
            "cases": [
                {
                    "case_id": "runner-timeout",
                    "runner": "fake",
                    "runner_path": str(runner),
                    "scenario_fixture": str(scenario),
                    "initial_state_fixture": str(state),
                    "player_model": {"provider": "fixture", "id": "player-1"},
                    "kp_model": {"provider": "fixture", "id": "kp-1"},
                    "prompt_sources": {"player": str(runner), "kp": str(runner)},
                }
            ],
        },
        credential_env={},
    )
    assert plan["cells"][0]["status"] == "READY"

    started = time.monotonic()
    results = matrix.execute_matrix_plan(
        plan,
        root=REPO,
        output=tmp_path / "out",
        runner_timeout_s=0.1,
    )
    elapsed = time.monotonic() - started

    cell = results["cells"][0]
    assert elapsed < 2
    assert cell["status"] == "NOT_RUN"
    assert cell["not_run_reasons"] == ["execution_timeout"]
    assert cell["timeout_phase"] == "matrix_runner"
    manifest = json.loads(
        (
            tmp_path / "out" / "cells" / cell["cell_id"] / "run-manifest.json"
        ).read_text(encoding="utf-8")
    )
    assert manifest["status"] == "NOT_RUN"
    assert manifest["not_run_reasons"] == ["execution_timeout"]
    time.sleep(1.0)
    assert not sentinel.exists()


def test_semantic_judge_timeout_is_distinct_not_run_evidence(
    tmp_path: Path, monkeypatch
):
    matrix = _load()
    plan = _fake_judged_plan(matrix, tmp_path, case_id="judge-timeout")
    baseline = _write_baseline_matrix(tmp_path / "baseline", plan)

    def timed_out(*args, **kwargs):
        try:
            raise TimeoutError("controlled timeout")
        except TimeoutError as exc:
            raise RuntimeError("judge request failed") from exc

    monkeypatch.setattr(matrix.judge, "invoke_sol_judge", timed_out)
    results = matrix.execute_matrix_plan(
        plan,
        root=REPO,
        output=tmp_path / "candidate",
        baseline_dir=baseline,
        judge_timeout_s=0.1,
    )

    cell = results["cells"][0]
    assert cell["status"] == "NOT_RUN"
    assert "execution_timeout" in cell["not_run_reasons"]
    assert "judge_unavailable_or_invalid" not in cell["not_run_reasons"]
    assert cell["timeout_phase"] == "semantic_judge"


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
    json.dumps({"view": "player", "turn_number": 1, "player_text": "行动", "narration": "结果"}) + "\\n",
    encoding="utf-8",
)
(out / "run-manifest.json").write_text(
        json.dumps({
            "schema_version": 1,
            "eval_spec": "eval-spec-v1",
            "status": "PASS",
            "cell_id": payload["cell_id"],
            "persona_id": payload["persona_id"],
            "seed": payload["seed"],
            "case_id": payload["case_id"],
            "runner": payload["runner"],
            "max_turns": payload["max_turns"],
            "player_model": payload["player_model"],
            "kp_model": payload["kp_model"],
            "persona_profile_sha256": payload["persona_profile_sha256"],
            "prompt_hashes": payload["prompt_hashes"],
            "runner_hashes": payload["runner_hashes"],
            "scenario_sha256": payload["scenario_sha256"],
            "initial_state_sha256": payload["initial_state_sha256"],
            "evidence_eligible": True,
        "evidence_findings": ["missing_public_roll"],
    }) + "\\n",
    encoding="utf-8",
)
print(json.dumps({
    "status": "PASS",
    "cell_id": payload["cell_id"],
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

    assert results["cells"][0]["status"] == "INELIGIBLE"
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


def test_nightly_suite_exposes_the_aggregate_pipeline_without_live_execution():
    cli = _load_cli()
    pipeline = sys.modules.get("coc_eval_pipeline")
    assert pipeline is not None
    assert callable(pipeline.run_extended_suite)
    args = cli.build_parser().parse_args(
        [
            "run",
            "--suite",
            "nightly",
            "--root",
            str(REPO),
            "--baseline",
            "/tmp/nightly-baseline",
            "--matrix-limit",
            "1",
            "--timeout",
            "30",
        ]
    )
    assert args.baseline == Path("/tmp/nightly-baseline")
    assert args.matrix_limit == 1
    assert args.timeout == 30.0
