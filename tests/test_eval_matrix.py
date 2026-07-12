from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import stat
import sys
from pathlib import Path


REPO = Path(__file__).resolve().parents[1]
MODULE_PATH = REPO / "plugins" / "coc-keeper" / "scripts" / "coc_eval_matrix.py"
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


def _fake_runner_script(path: Path) -> Path:
    script = """#!/usr/bin/env python3
import json, sys
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
(out / "run-manifest.json").write_text(
    json.dumps(
        {
            "status": "PASS",
            "cell_id": payload.get("cell_id"),
            "runner": "fake",
            "player_model": payload.get("player_model"),
            "kp_model": payload.get("kp_model"),
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
        assert cell["status"] in {"READY", "NOT_RUN"}
        if cell["status"] == "NOT_RUN":
            assert cell["not_run_reasons"]


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


def test_execute_matrix_plan_runs_ready_cells_with_fake_adapter(tmp_path: Path):
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
                "prompt_hashes": {"player": "c" * 64, "kp": "d" * 64},
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
    out = tmp_path / "matrix-out"
    results = matrix.execute_matrix_plan(plan, root=REPO, output=out)
    assert results["schema_version"] == 1
    assert results["cells"][0]["status"] == "PASS"
    assert (out / "matrix-plan.json").is_file()
    assert (out / "matrix-results.json").is_file()
    assert (out / "aggregate-summary.json").is_file()
    cell_dir = out / "cells" / results["cells"][0]["cell_id"]
    assert (cell_dir / "run-manifest.json").is_file()
    assert (cell_dir / "judge-request.json").is_file()
    plan_hash = results["artifact_hashes"]["matrix-plan.json"]
    assert plan_hash == _sha256(out / "matrix-plan.json")


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
