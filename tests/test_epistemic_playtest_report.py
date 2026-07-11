"""TDD coverage for epistemic metrics in generated playtest reports."""
import importlib.util
import json
from pathlib import Path


def _load(name: str, relative_path: str):
    spec = importlib.util.spec_from_file_location(name, relative_path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


report = _load(
    "coc_playtest_report_epistemic_tests",
    "plugins/coc-keeper/scripts/coc_playtest_report.py",
)


def _write_json(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _write_jsonl(path: Path, records: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        "".join(json.dumps(record, ensure_ascii=False) + "\n" for record in records),
        encoding="utf-8",
    )


def _run_dir(tmp_path: Path) -> tuple[Path, Path]:
    run_dir = tmp_path / "run"
    campaign_id = "case-epistemic"
    campaign_dir = run_dir / "sandbox" / ".coc" / "campaigns" / campaign_id
    for relative in ("logs", "save", "scenario", "index", "memory"):
        (campaign_dir / relative).mkdir(parents=True, exist_ok=True)
    _write_json(
        run_dir / "playtest.json",
        {
            "run_id": "run-epistemic",
            "campaign_id": campaign_id,
            "play_language": "en-US",
            "player_profile": "investigator",
        },
    )
    _write_json(
        campaign_dir / "campaign.json",
        {
            "campaign_id": campaign_id,
            "scenario_id": "scenario-epistemic",
            "title": "Epistemic Case",
            "play_language": "en-US",
        },
    )
    _write_json(campaign_dir / "party.json", {"investigator_ids": []})
    _write_json(
        campaign_dir / "scenario" / "scenario.json",
        {
            "scenario_id": "scenario-epistemic",
            "title": "Epistemic Scenario",
            "opening_scene": "scene-start",
        },
    )
    return run_dir, campaign_dir


def _healthy_events() -> list[dict]:
    return [
        {"event_type": "question_opened", "question_id": "q-fact"},
        {
            "event_type": "belief_confirmed",
            "question_id": "q-fact",
            "mode": "CONFIRM",
            "clue_ids": ["clue-a"],
        },
        {
            "event_type": "belief_complicated",
            "question_id": "q-motive",
            "mode": "COMPLICATE",
            "clue_ids": ["clue-b"],
        },
        {
            "event_type": "belief_reframed",
            "question_id": "q-motive",
            "mode": "REFRAME",
            "clue_ids": ["clue-c"],
            "setup_refs": ["clue-a", "clue-b"],
            "available_setup_refs": ["clue-a", "clue-b"],
            "preserve_fact_refs": ["truth-fact"],
            "explanation_targets": ["why-a", "why-b"],
            "reveal_contract_id": "rc-motive",
        },
    ]


def test_report_reads_belief_events_and_persists_metrics_key(tmp_path: Path):
    run_dir, campaign_dir = _run_dir(tmp_path)
    _write_jsonl(campaign_dir / "logs" / "belief-events.jsonl", _healthy_events())
    _write_json(
        campaign_dir / "save" / "belief-state.json",
        {
            "active_question_ids": ["q-motive"],
            "answered_question_ids": ["q-fact"],
        },
    )

    output = report.generate_battle_report(run_dir)
    text = output.read_text(encoding="utf-8")
    metadata = json.loads((run_dir / "playtest.json").read_text(encoding="utf-8"))

    assert "## Epistemic Experience" in text
    assert metadata["epistemic_metrics"]["belief_gain"]["count"] == 3
    assert metadata["epistemic_metrics"]["curiosity_load"]["active_count"] == 1


def test_report_includes_all_seven_metric_names(tmp_path: Path):
    run_dir, campaign_dir = _run_dir(tmp_path)
    _write_jsonl(campaign_dir / "logs" / "belief-events.jsonl", _healthy_events())

    text = report.generate_battle_report(run_dir).read_text(encoding="utf-8")

    for name in (
        "belief_gain",
        "curiosity_load",
        "explanation_compression",
        "reframe_fairness",
        "confirmation_saturation",
        "unexplained_surprise",
        "parse_risk_exposure",
        "epistemic_health",
    ):
        assert name in text


def test_report_handles_legacy_run_without_belief_events(tmp_path: Path):
    run_dir, _campaign_dir = _run_dir(tmp_path)

    output = report.generate_battle_report(run_dir)
    metadata = json.loads((run_dir / "playtest.json").read_text(encoding="utf-8"))

    assert output.exists()
    assert metadata["epistemic_metrics"]["belief_gain"]["count"] == 0
    assert "## Epistemic Experience" in output.read_text(encoding="utf-8")


def test_scripted_fixture_without_receipt_is_forced_to_sanitized_verification_sample(tmp_path: Path):
    run_dir, _campaign_dir = _run_dir(tmp_path)
    metadata = json.loads((run_dir / "playtest.json").read_text(encoding="utf-8"))
    metadata.update({
        "simulation_method": "scripted_fixture",
        "module_source": "/Users/alice/private/modules/secret.pdf",
    })
    _write_json(run_dir / "playtest.json", metadata)

    output = report.generate_battle_report(run_dir)
    text = output.read_text(encoding="utf-8")

    assert output.name == "verification-sample.md"
    assert text.startswith("# NON-GAMEPLAY Verification Sample")
    assert "Actual Play" not in text and "# Battle Report" not in text
    assert "/Users/alice" not in text and "private/modules" not in text
    assert "secret.pdf" in text


def test_report_flags_unfair_reframe_and_parse_risk(tmp_path: Path):
    run_dir, campaign_dir = _run_dir(tmp_path)
    _write_jsonl(
        campaign_dir / "logs" / "belief-events.jsonl",
        [
            {
                "event_type": "belief_reframed",
                "question_id": "q-motive",
                "mode": "REFRAME",
                "setup_refs": ["clue-a", "clue-b"],
                "available_setup_refs": ["clue-a"],
                "preserve_fact_refs": [],
                "reveal_contract_id": None,
                "compile_confidence": {
                    "ready": False,
                    "confidence": 0.4,
                    "threshold": 0.8,
                },
            }
        ],
    )
    _write_json(
        campaign_dir / "scenario" / "compile-confidence.json",
        {
            "schema_version": 1,
            "default_threshold": 0.8,
            "nodes": [
                {
                    "node_type": "question",
                    "node_id": "q-motive",
                    "importance": "critical",
                    "effective_confidence": 0.4,
                    "review_state": "needs_review",
                }
            ],
        },
    )
    _write_json(
        campaign_dir / "index" / "parse-manifest.json",
        {
            "schema_version": 1,
            "default_threshold": 0.8,
            "ranges": [
                {
                    "range_id": "range-low",
                    "review_state": "needs_review",
                    "quality": {"overall": 0.5},
                }
            ],
        },
    )

    text = report.generate_battle_report(run_dir).read_text(encoding="utf-8")
    metadata = json.loads((run_dir / "playtest.json").read_text(encoding="utf-8"))
    metrics = metadata["epistemic_metrics"]

    assert metrics["reframe_fairness"]["minimum_ratio"] == 0.5
    assert metrics["unexplained_surprise"]["count"] == 1
    assert metrics["parse_risk_exposure"]["count"] >= 1
    assert metrics["epistemic_health"]["score"] < 100
    assert "unfair_reframe" in text
    assert "parse_risk_exposure" in text
