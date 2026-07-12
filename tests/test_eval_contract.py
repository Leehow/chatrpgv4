from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest


REPO = Path(__file__).resolve().parents[1]
CONTRACT_PATH = REPO / "plugins" / "coc-keeper" / "scripts" / "coc_eval_contract.py"
CLI_PATH = REPO / "plugins" / "coc-keeper" / "scripts" / "coc_eval.py"


def _load(name: str, path: Path):
    assert path.is_file(), f"missing implementation module: {path}"
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def contract_module():
    return _load("coc_eval_contract_test", CONTRACT_PATH)


def cli_module():
    return _load("coc_eval_cli_test", CLI_PATH)


def write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def write_jsonl(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows),
        encoding="utf-8",
    )


def make_run(tmp_path: Path, *, rolls: list[dict], language: str = "zh-Hans") -> Path:
    run_dir = tmp_path / "run-1"
    campaign_dir = run_dir / "sandbox" / ".coc" / "campaigns" / "run-1"
    write_json(
        run_dir / "playtest.json",
        {
            "schema_version": 1,
            "run_id": "run-1",
            "campaign_id": "run-1",
            "play_language": language,
            "scenario": "Contract Fixture",
            "audit_profile": "report_contract_fixture",
        },
    )
    write_json(
        campaign_dir / "campaign.json",
        {
            "schema_version": 1,
            "campaign_id": "run-1",
            "title": "Contract Fixture",
            "play_language": language,
        },
    )
    write_json(campaign_dir / "party.json", {"investigator_ids": ["ada"]})
    write_jsonl(campaign_dir / "logs" / "rolls.jsonl", rolls)
    write_jsonl(campaign_dir / "logs" / "events.jsonl", [])
    write_json(
        run_dir / "sandbox" / ".coc" / "investigators" / "ada" / "character.json",
        {"id": "ada", "name": "艾达", "skills": {"Spot Hidden": 60}},
    )
    artifacts = run_dir / "artifacts"
    artifacts.mkdir(parents=True, exist_ok=True)
    (artifacts / "battle-report.md").write_text(
        "# Battle Report\n\n"
        "## Actual Play Replay <!-- report-anchor: Actual Play Replay -->\n\n"
        "- Turn 1 Player: \"我查看房间。\"\n\n"
        "## Mechanical Log <!-- report-anchor: Mechanical Log -->\n\n"
        "### Important Rolls <!-- report-anchor: Important Rolls -->\n\n"
        "- legacy formatter output\n\n"
        "## Session Ending <!-- report-anchor: Session Ending -->\n\n"
        "- Fixture ended.\n",
        encoding="utf-8",
    )
    return run_dir


def public_roll(roll_id: str = "r-001") -> dict:
    return {
        "roll_id": roll_id,
        "type": "roll",
        "actor": "ada",
        "visibility": "public",
        "decision_id": "turn-001",
        "payload": {
            "skill": "Spot Hidden",
            "roll": 73,
            "effective_target": 60,
            "difficulty": "regular",
            "outcome": "failure",
        },
    }


def write_manifest(path: Path, *, benchmark_version: str) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    target = path / "run-manifest.json"
    write_json(
        target,
        {
            "schema_version": 1,
            "eval_spec": "eval-spec-v1",
            "benchmark_version": benchmark_version,
            "report_schema_version": 2,
            "case_id": "fixture",
            "seed": 42,
            "initial_state_sha256": "same-state",
        },
    )
    return target


def test_benchmark_manifest_exposes_only_named_suites():
    contract = contract_module()
    manifest = contract.load_benchmark_manifest(REPO)

    assert manifest["eval_spec"] == "eval-spec-v1"
    assert set(manifest["suites"]) == {
        "smoke",
        "pr",
        "nightly",
        "release",
        "diagnostic",
    }
    with pytest.raises(ValueError, match="unknown evaluation suite"):
        contract.resolve_suite(manifest, "whatever-this-agent-invented")


def test_phase_one_release_suite_fails_closed_for_unimplemented_capabilities():
    contract = contract_module()
    manifest = contract.load_benchmark_manifest(REPO)
    release = contract.resolve_suite(manifest, "release")

    assert "ai_player_matrix" in release["required_capabilities"]
    assert "ai_player_matrix" not in manifest["implemented_capabilities"]


def test_public_percentile_roll_renders_value_target_difficulty_and_outcome(tmp_path):
    contract = contract_module()
    run_dir = make_run(tmp_path, rolls=[public_roll()])

    rendered = contract.compile_report_contract(run_dir, generate_base_report=False)
    text = Path(rendered["report_path"]).read_text(encoding="utf-8")

    assert "report-anchor: rules-and-dice" in text
    assert "[roll-id: r-001]" in text
    assert "73 / 目标 60" in text
    assert "regular" in text
    assert "failure" in text


def test_bonus_die_renders_candidates_and_selected_result(tmp_path):
    contract = contract_module()
    roll = public_roll("r-bonus")
    roll["payload"].update(
        {
            "roll": 11,
            "bonus": 1,
            "penalty": 0,
            "tens_values": [4, 1],
            "units": 1,
            "outcome": "hard_success",
        }
    )
    run_dir = make_run(tmp_path, rolls=[roll])

    result = contract.compile_report_contract(run_dir, generate_base_report=False)
    text = Path(result["report_path"]).read_text(encoding="utf-8")

    assert "个位 1" in text
    assert "十位 4/1" in text
    assert "取 11" in text


def test_damage_roll_renders_faces_modifier_total_and_state_delta(tmp_path):
    contract = contract_module()
    run_dir = make_run(
        tmp_path,
        rolls=[
            {
                "roll_id": "r-014",
                "type": "damage",
                "actor": "cultist",
                "visibility": "consequence_public",
                "decision_id": "turn-014",
                "payload": {
                    "purpose": "damage",
                    "die": "1d6+1",
                    "die_rolls": [4],
                    "flat_modifier": 1,
                    "roll": 5,
                    "hp_before": 11,
                    "hp_after": 6,
                    "outcome": "applied",
                },
            }
        ],
    )

    result = contract.compile_report_contract(run_dir, generate_base_report=False)
    text = Path(result["report_path"]).read_text(encoding="utf-8")

    assert "[roll-id: r-014]" in text
    assert "1d6+1：4 + 1 = 5" in text
    assert "HP 11 → 6" in text


def test_keeper_only_roll_is_counted_but_not_rendered(tmp_path):
    contract = contract_module()
    run_dir = make_run(
        tmp_path,
        rolls=[
            {
                "roll_id": "secret-1",
                "type": "roll",
                "actor": "keeper_under_test",
                "visibility": "keeper_only",
                "payload": {
                    "skill": "Listen",
                    "roll": 12,
                    "effective_target": 50,
                    "outcome": "hard_success",
                },
            }
        ],
    )

    result = contract.compile_report_contract(run_dir, generate_base_report=False)
    text = Path(result["report_path"]).read_text(encoding="utf-8")
    receipt = json.loads(
        (run_dir / "artifacts" / "report-completeness.json").read_text(encoding="utf-8")
    )

    assert "secret-1" not in text
    assert receipt["keeper_only_roll_count"] == 1
    assert receipt["required_public_roll_count"] == 0
    assert receipt["passed"] is True


def test_zero_public_rolls_emit_explicit_zero_statement(tmp_path):
    contract = contract_module()
    run_dir = make_run(tmp_path, rolls=[])

    result = contract.compile_report_contract(run_dir, generate_base_report=False)
    text = Path(result["report_path"]).read_text(encoding="utf-8")

    assert "本场没有发生需要记录的公开检定（公开骰数：0）。" in text
    assert "report-anchor: rules-and-dice" in text


def test_deleting_rendered_public_roll_makes_verification_fail(tmp_path):
    contract = contract_module()
    run_dir = make_run(tmp_path, rolls=[public_roll()])
    result = contract.compile_report_contract(run_dir, generate_base_report=False)
    report = Path(result["report_path"])
    text = report.read_text(encoding="utf-8")
    text = "\n".join(
        line for line in text.splitlines() if "[roll-id: r-001]" not in line
    ) + "\n"
    report.write_text(text, encoding="utf-8")

    verified = contract.verify_report_contract(run_dir)

    assert verified["status"] == "FAIL"
    assert verified["report_completeness"]["missing_roll_ids"] == ["r-001"]


def test_duplicate_roll_marker_makes_verification_fail(tmp_path):
    contract = contract_module()
    run_dir = make_run(tmp_path, rolls=[public_roll()])
    result = contract.compile_report_contract(run_dir, generate_base_report=False)
    report = Path(result["report_path"])
    report.write_text(
        report.read_text(encoding="utf-8") + "\n[roll-id: r-001]\n",
        encoding="utf-8",
    )

    verified = contract.verify_report_contract(run_dir)

    assert verified["status"] == "FAIL"
    assert verified["report_completeness"]["duplicate_roll_ids"] == ["r-001"]


def test_unlogged_roll_marker_makes_traceability_fail(tmp_path):
    contract = contract_module()
    run_dir = make_run(tmp_path, rolls=[])
    result = contract.compile_report_contract(run_dir, generate_base_report=False)
    report = Path(result["report_path"])
    report.write_text(
        report.read_text(encoding="utf-8") + "\n[roll-id: fabricated-99]\n",
        encoding="utf-8",
    )

    verified = contract.verify_report_contract(run_dir)

    assert verified["status"] == "FAIL"
    assert verified["report_completeness"]["untraced_roll_ids"] == [
        "fabricated-99"
    ]


def test_malformed_roll_jsonl_fails_closed_without_discarding_error(tmp_path):
    contract = contract_module()
    run_dir = make_run(tmp_path, rolls=[])
    roll_path = (
        run_dir
        / "sandbox"
        / ".coc"
        / "campaigns"
        / "run-1"
        / "logs"
        / "rolls.jsonl"
    )
    roll_path.write_text('{"roll_id":"ok"}\n{broken\n', encoding="utf-8")

    result = contract.compile_report_contract(run_dir, generate_base_report=False)
    receipt = result["report_completeness"]

    assert result["status"] == "FAIL"
    assert receipt["parse_errors"]
    assert receipt["parse_errors"][0]["line"] == 2


def test_compare_rejects_mismatched_benchmark_identity(tmp_path):
    contract = contract_module()
    baseline = write_manifest(tmp_path / "base", benchmark_version="2026.07.1")
    candidate = write_manifest(
        tmp_path / "candidate", benchmark_version="2026.08.0"
    )

    result = contract.compare_run_manifests(baseline, candidate)

    assert result["status"] == "NON_COMPARABLE"
    assert "benchmark_version" in result["identity_mismatches"]


def test_compare_fails_when_candidate_loses_report_completeness(tmp_path):
    contract = contract_module()
    baseline_manifest = write_manifest(
        tmp_path / "base", benchmark_version="2026.07.1"
    )
    candidate_manifest = write_manifest(
        tmp_path / "candidate", benchmark_version="2026.07.1"
    )
    write_json(
        baseline_manifest.parent / "artifacts" / "report-completeness.json",
        {"passed": True, "missing_roll_ids": []},
    )
    write_json(
        candidate_manifest.parent / "artifacts" / "report-completeness.json",
        {"passed": False, "missing_roll_ids": ["r-001"]},
    )

    result = contract.compare_run_manifests(
        baseline_manifest, candidate_manifest
    )

    assert result["status"] == "FAIL"
    assert result["regressions"][0]["key"] == "report_completeness"


def test_cli_rejects_agent_invented_suite(capsys):
    cli = cli_module()

    code = cli.main(
        ["run", "--suite", "invented", "--root", str(REPO)]
    )

    assert code == 1
    assert "unknown evaluation suite" in capsys.readouterr().err


def test_release_suite_is_not_run_until_required_capabilities_exist(
    tmp_path, capsys
):
    cli = cli_module()

    code = cli.main(
        [
            "run",
            "--suite",
            "release",
            "--root",
            str(REPO),
            "--output",
            str(tmp_path / "out"),
        ]
    )
    captured = capsys.readouterr()
    payload = json.loads(captured.out)

    assert code == 2
    assert payload["status"] == "NOT_RUN"
    assert "ai_player_matrix" in payload["missing_capabilities"]


def test_verify_cli_reports_ineligible_without_false_pass(tmp_path, capsys):
    cli = cli_module()
    contract = contract_module()
    run_dir = make_run(tmp_path, rolls=[public_roll()])
    contract.compile_report_contract(run_dir, generate_base_report=False)

    code = cli.main(["verify", str(run_dir)])
    payload = json.loads(capsys.readouterr().out)

    assert code == 2
    assert payload["status"] == "INELIGIBLE"
    assert payload["report_completeness"]["passed"] is True


def test_project_rules_require_canonical_eval_cli():
    text = (REPO / "AGENTS.md").read_text(encoding="utf-8")

    assert "coc_eval.py" in text
    assert "missing required public roll" in text


def test_coc_eval_skill_forbids_handwritten_substitute_reports():
    path = REPO / "plugins" / "coc-keeper" / "skills" / "coc-eval" / "SKILL.md"
    assert path.is_file()
    text = path.read_text(encoding="utf-8")

    assert "coc_eval.py run --suite" in text
    assert "must not rewrite" in text.lower()
    assert "report-completeness.json" in text
