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


def write_json(path: Path, payload: dict):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload))


def test_generate_battle_and_evaluation_reports(tmp_path):
    run_dir = tmp_path / ".coc" / "playtests" / "run-1"
    campaign_dir = run_dir / "sandbox" / ".coc" / "campaigns" / "run-1"
    investigator_dir = run_dir / "sandbox" / ".coc" / "investigators" / "ada-king"

    write_json(campaign_dir / "campaign.json", {
        "campaign_id": "run-1",
        "title": "The Haunting Test",
        "scenario_id": "the-haunting",
        "era": "1920s",
        "dice_mode": "codex",
        "spoiler_policy": "warn_before_reveal",
        "status": "active",
    })
    write_json(campaign_dir / "party.json", {
        "investigator_ids": ["ada-king"],
    })
    write_json(campaign_dir / "scenario" / "scenario.json", {
        "scenario_id": "the-haunting",
        "title": "The Haunting",
        "module_source": "pdf/the-haunting.pdf",
        "opening_scene": "The investigators arrive at the old Corbitt house.",
    })
    write_json(investigator_dir / "character.json", {
        "id": "ada-king",
        "name": "Ada King",
        "player_name": "Virtual Player A",
        "occupation": "Antiquarian",
        "era": "1920s",
        "characteristics": {
            "STR": 60,
            "CON": 55,
            "SIZ": 65,
            "DEX": 50,
            "APP": 45,
            "INT": 70,
            "POW": 55,
            "EDU": 75,
        },
        "derived": {
            "HP": 12,
            "MP": 11,
            "SAN": 55,
            "MOV": 8,
            "damage_bonus": "0",
            "build": 0,
        },
        "skills": {
            "Dodge": 25,
            "Library Use": 60,
            "Spot Hidden": 55,
        },
    })
    write_jsonl(run_dir / "transcript.jsonl", [
        {
            "turn": 1,
            "role": "keeper_under_test",
            "speaker": "KP",
            "mode": "play",
            "text": "The room is cold.",
        },
        {
            "turn": 2,
            "role": "player_simulator",
            "speaker": "Ada King",
            "mode": "play",
            "intent": "search desk",
            "text": "I search the desk.",
        },
    ])
    write_jsonl(campaign_dir / "logs" / "rolls.jsonl", [
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
    write_jsonl(campaign_dir / "logs" / "events.jsonl", [
        {
            "type": "scene",
            "actor": "keeper_under_test",
            "payload": {"scene_id": "intro", "summary": "Smoke-test scene opened."},
        }
    ])
    write_jsonl(campaign_dir / "memory" / "session-summaries.jsonl", [
        {
            "session_id": "session-1",
            "summary": "Ada searched the cold room, found that the desk had been disturbed, and stayed cautious.",
        }
    ])
    write_jsonl(run_dir / "player-feedback.jsonl", [
        {"category": "kp_clarity", "score": 4, "text": "KP gave clear choices."},
        {"category": "immersion", "score": 5, "text": "The opening felt tense without spoiling secrets."},
    ])
    write_jsonl(run_dir / "evaluator-notes.jsonl", [
        {"severity": "low", "category": "immersion", "text": "Good opening."},
        {"severity": "low", "category": "state_integrity", "text": "Campaign validation returned no errors."},
        {"severity": "low", "category": "spoiler_safety", "text": "No leaks observed."},
        {"severity": "low", "category": "meta_quality", "text": "Meta question paused play and returned cleanly."},
    ])
    write_json(run_dir / "playtest.json", {
        "run_id": "run-1",
        "campaign_id": "run-1",
        "campaign_title": "The Haunting Test",
        "scenario": "The Haunting",
        "scenario_id": "the-haunting",
        "module_source": "pdf/the-haunting.pdf",
        "era": "1920s",
        "dice_mode": "codex",
        "spoiler_policy": "warn_before_reveal",
        "player_profile": "careful_investigator",
        "audit_profile": "haunting_module",
        "module_coverage": ["knott_hiring", "bed_attack"],
        "subsystems_covered": ["investigation", "sanity"],
        "scores": {"immersion": 4, "rules_accuracy": 3},
        "passed_test_cases": ["activation_resume", "basic_roll"],
        "failed_test_cases": ["spoiler_warning"],
        "recommended_fixes": ["Populate spoiler warning transcript checks."],
    })

    battle_path = coc_playtest_report.generate_battle_report(run_dir)
    evaluation_path = coc_playtest_report.generate_evaluation_report(run_dir)

    battle_text = battle_path.read_text()
    evaluation_text = evaluation_path.read_text()

    assert "## Run Setup" in battle_text
    assert "Campaign: The Haunting Test" in battle_text
    assert "Era: 1920s" in battle_text
    assert "Dice Mode: codex" in battle_text
    assert "Spoiler Policy: warn_before_reveal" in battle_text
    assert "## Module" in battle_text
    assert "Scenario ID: the-haunting" in battle_text
    assert "Source: pdf/the-haunting.pdf" in battle_text
    assert "## Character Dossier" in battle_text
    assert "Ada King" in battle_text
    assert "Ada King (ada-king)" in battle_text
    assert "STR: 60" in battle_text
    assert "HP: 12" in battle_text
    assert "Library Use: 60" in battle_text
    assert "## Session Transcript" in battle_text
    assert "KP: The room is cold." in battle_text
    assert "Player: I search the desk." in battle_text
    assert "Intent: search desk" in battle_text
    assert "## Mechanical Log" in battle_text
    assert "Library Use: ada-king rolled 80 vs 60 -> failure" in battle_text
    assert "scene: intro - Smoke-test scene opened." in battle_text
    assert "## Story Recap" in battle_text
    assert "Ada searched the cold room" in battle_text
    assert "## Player Feedback On KP" in battle_text
    assert "kp_clarity: 4 - KP gave clear choices." in battle_text
    assert "No roll extraction in V1 report" not in battle_text
    assert "No state diff extraction in V1 report" not in battle_text

    assert "V1 report generated" not in evaluation_text
    assert "## Playtest Profile" in evaluation_text
    assert "Audit Profile: haunting_module" in evaluation_text
    assert "Player Profile: careful_investigator" in evaluation_text
    assert "Module Coverage: knott_hiring, bed_attack" in evaluation_text
    assert "Subsystems Covered: investigation, sanity" in evaluation_text
    assert "## Scorecard" in evaluation_text
    assert "rules_accuracy: 3" in evaluation_text
    assert "- activation_resume" in evaluation_text
    assert "- spoiler_warning" in evaluation_text
    assert "[low] state_integrity: Campaign validation returned no errors." in evaluation_text
    assert "[low] spoiler_safety: No leaks observed." in evaluation_text
    assert "[low] meta_quality: Meta question paused play and returned cleanly." in evaluation_text
    assert "- Populate spoiler warning transcript checks." in evaluation_text
