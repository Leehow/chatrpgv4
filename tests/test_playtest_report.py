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
    write_jsonl(run_dir / "evaluator-notes.jsonl", [
        {"severity": "low", "category": "immersion", "text": "Good opening."}
    ])
    (run_dir / "playtest.json").parent.mkdir(parents=True, exist_ok=True)
    (run_dir / "playtest.json").write_text(json.dumps({
        "run_id": "run-1",
        "scenario": "smoke-test",
        "player_profile": "careful_investigator",
        "scores": {"immersion": 4, "rules_accuracy": 3},
    }))

    battle_path = coc_playtest_report.generate_battle_report(run_dir)
    evaluation_path = coc_playtest_report.generate_evaluation_report(run_dir)

    assert "## Session Timeline" in battle_path.read_text()
    assert "I search the desk." in battle_path.read_text()
    assert "## Scorecard" in evaluation_path.read_text()
    assert "rules_accuracy: 3" in evaluation_path.read_text()
