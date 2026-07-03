import importlib.util
import json
from pathlib import Path


def load_module(name: str, relative_path: str):
    path = Path(relative_path)
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


coc_playtest_report = load_module("coc_playtest_report", "plugins/coc-keeper/scripts/coc_playtest_report.py")


def write_jsonl(path: Path, events: list[dict]):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(json.dumps(event) for event in events) + "\n")


def test_generate_battle_and_evaluation_reports(tmp_path):
    run_dir = tmp_path / ".coc" / "playtests" / "run-1"
    write_jsonl(run_dir / "transcript.jsonl", [
        {"turn": 1, "role": "keeper_under_test", "text": "The room is cold."},
        {"turn": 2, "role": "player_simulator", "text": "I search the desk."},
    ])
    write_jsonl(run_dir / "sandbox" / ".coc" / "campaigns" / "run-1" / "logs" / "rolls.jsonl", [
        {
            "type": "roll",
            "actor": "ada-king",
            "payload": {
                "skill": "Library Use",
                "target": 60,
                "effective_target": 60,
                "roll": 80,
                "outcome": "failure",
            },
        }
    ])
    write_jsonl(run_dir / "sandbox" / ".coc" / "campaigns" / "run-1" / "logs" / "events.jsonl", [
        {
            "type": "scene",
            "actor": "keeper_under_test",
            "payload": {"scene_id": "intro", "summary": "Smoke-test scene opened."},
        }
    ])
    write_jsonl(run_dir / "evaluator-notes.jsonl", [
        {"severity": "low", "category": "immersion", "text": "Good opening."},
        {"severity": "low", "category": "state_integrity", "text": "Campaign validation returned no errors."},
        {"severity": "low", "category": "spoiler_safety", "text": "No leaks observed."},
    ])
    (run_dir / "playtest.json").parent.mkdir(parents=True, exist_ok=True)
    (run_dir / "playtest.json").write_text(json.dumps({
        "run_id": "run-1",
        "scenario": "smoke-test",
        "player_profile": "careful_investigator",
        "scores": {"immersion": 4, "rules_accuracy": 3},
        "passed_test_cases": ["activation_resume", "basic_roll"],
        "failed_test_cases": ["spoiler_warning"],
        "recommended_fixes": ["Populate spoiler warning transcript checks."],
    }))

    battle_path = coc_playtest_report.generate_battle_report(run_dir)
    evaluation_path = coc_playtest_report.generate_evaluation_report(run_dir)

    battle_text = battle_path.read_text()
    evaluation_text = evaluation_path.read_text()

    assert "## Session Timeline" in battle_text
    assert "I search the desk." in battle_text
    assert "Library Use: ada-king rolled 80 vs 60 -> failure" in battle_text
    assert "scene: intro - Smoke-test scene opened." in battle_text
    assert "No roll extraction in V1 report" not in battle_text
    assert "No state diff extraction in V1 report" not in battle_text

    assert "## Scorecard" in evaluation_text
    assert "rules_accuracy: 3" in evaluation_text
    assert "- activation_resume" in evaluation_text
    assert "- spoiler_warning" in evaluation_text
    assert "[low] state_integrity: Campaign validation returned no errors." in evaluation_text
    assert "[low] spoiler_safety: No leaks observed." in evaluation_text
    assert "- Populate spoiler warning transcript checks." in evaluation_text
