import importlib.util
from pathlib import Path


def load_module(name: str, relative_path: str):
    path = Path(relative_path)
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


coc_playtest_harness = load_module("coc_playtest_harness", "plugins/coc-keeper/scripts/coc_playtest_harness.py")
coc_playtest_audit = load_module("coc_playtest_audit", "plugins/coc-keeper/scripts/coc_playtest_audit.py")


def has_cjk(text: str) -> bool:
    return any("\u4e00" <= char <= "\u9fff" for char in text)


def visible_play_texts(run_dir: Path) -> list[str]:
    import json

    return [
        event.get("text", "")
        for line in (run_dir / "transcript.jsonl").read_text().splitlines()
        for event in [json.loads(line)]
        if event.get("role") in {"keeper_under_test", "player_simulator"}
    ]


def campaign_state_events(run_dir: Path) -> list[dict]:
    import json

    campaign_logs = run_dir / "sandbox" / ".coc" / "campaigns"
    events: list[dict] = []
    for path in sorted(campaign_logs.glob("*/logs/events.jsonl")):
        events.extend(json.loads(line) for line in path.read_text().splitlines() if line.strip())
    return events


def significant_scene_replay_count(run_dir: Path) -> int:
    significant_types = {"scene", "clue", "damage", "sanity", "combat", "chase", "session_ending"}
    return sum(1 for event in campaign_state_events(run_dir) if event.get("type") in significant_types)


def section_text(markdown: str, heading: str) -> str:
    start = markdown.index(heading)
    rest = markdown[start + len(heading):]
    next_heading = rest.find("\n## ")
    return rest if next_heading == -1 else rest[:next_heading]


def bullet_count(text: str) -> int:
    return sum(1 for line in text.splitlines() if line.startswith("- "))


def test_rulebook_smoke_harness_generates_auditable_run(tmp_path):
    run_dir = coc_playtest_harness.create_rulebook_smoke_run(tmp_path, run_id="rulebook-smoke")

    audit = coc_playtest_audit.audit_run(run_dir)
    battle_text = (run_dir / "artifacts" / "battle-report.md").read_text()
    audit_text = (run_dir / "artifacts" / "rulebook-audit.md").read_text()

    assert audit["result"] == "pass"
    assert "PASS" in audit_text
    assert "Mr. Knott" in battle_text
    assert "Chapel of Contemplation" in battle_text
    assert "Library Use: ada-king-rulebook rolled 42 vs 60 -> regular_success" in battle_text
    assert "Pushed Roll: yes" in battle_text
    assert "Ada chose to push the failed Spot Hidden roll" in battle_text
    assert "Push Justification:" in battle_text
    assert "Foreshadowed Failure:" in battle_text
    assert "Goal: find an early public clue about Walter Corbitt and the house" in battle_text
    assert "Difficulty Rationale: The clipping files are public but poorly indexed." in battle_text
    assert "Skill Check Earned: yes" in battle_text
    assert "Session ended with Ada planning to visit the Corbitt House next." in battle_text
    assert "kp_clarity: 5 - KP explained when rolls were needed and what changed in the fiction." in battle_text
    assert "{'" not in battle_text
    assert "'}" not in battle_text
    assert (run_dir / "sandbox" / ".coc" / "campaigns" / "rulebook-smoke" / "scenario" / "clues.json").exists()
    assert (run_dir / "player-feedback.jsonl").exists()


def test_haunting_module_harness_generates_full_module_battle_report(tmp_path):
    run_dir = coc_playtest_harness.create_haunting_module_run(tmp_path, run_id="haunting-module")

    audit = coc_playtest_audit.audit_run(run_dir)
    battle_text = (run_dir / "artifacts" / "battle-report.md").read_text()
    audit_text = (run_dir / "artifacts" / "rulebook-audit.md").read_text()

    assert audit["result"] == "pass"
    assert "PASS" in audit_text
    assert "## Scene-by-Scene Replay" in battle_text
    scene_replay = section_text(battle_text, "## Scene-by-Scene Replay")
    assert has_cjk(scene_replay)
    assert bullet_count(scene_replay) >= significant_scene_replay_count(run_dir)
    assert "## Actual Play Replay" in battle_text
    assert all(has_cjk(text) for text in visible_play_texts(run_dir))
    assert has_cjk(section_text(battle_text, "## Major Player Decisions"))
    assert has_cjk(section_text(battle_text, "## Story Recap"))
    assert has_cjk(section_text(battle_text, "## Player Feedback On KP"))
    assert "The Haunting Module Playthrough" in battle_text
    assert "Mr. Knott" in battle_text
    assert "Arty Wilmot" in battle_text
    assert "Handout 2" in battle_text
    assert "Chapel of Contemplation" in battle_text
    assert "The Old Corbitt Place" in battle_text
    assert "Bed Attack" in battle_text
    assert "The Floating Knife" in battle_text
    assert "Corbitt's Hiding Place" in battle_text
    assert "Corbitt Attacks" in battle_text
    assert "Rewards" in battle_text
    assert "temporary insanity" in battle_text
    assert "combat round" in battle_text
    assert "Damage: 5 HP" in battle_text
    assert "Final HP: 3" in battle_text
    assert "Final SAN: 49" in battle_text
    assert "Player Feedback On KP" in battle_text
    assert "module_fidelity: 4" in battle_text
    assert "No combat summary recorded." not in battle_text
    assert "The Haunting does not include a required chase sequence" in battle_text
    assert "No chase summary recorded." not in battle_text
    assert "Session ending not recorded." not in battle_text
    assert battle_text.count("- ada-king-haunting: Ada chose") >= 5
    assert "{'" not in battle_text
    assert "'}" not in battle_text


def test_chase_drill_harness_generates_auditable_chase_report(tmp_path):
    run_dir = coc_playtest_harness.create_chase_drill_run(tmp_path, run_id="chase-drill")

    audit = coc_playtest_audit.audit_run(run_dir)
    battle_text = (run_dir / "artifacts" / "battle-report.md").read_text()
    audit_text = (run_dir / "artifacts" / "rulebook-audit.md").read_text()

    assert audit["result"] == "pass"
    assert "PASS" in audit_text
    assert "## Scene-by-Scene Replay" in battle_text
    scene_replay = section_text(battle_text, "## Scene-by-Scene Replay")
    assert has_cjk(scene_replay)
    assert bullet_count(scene_replay) >= significant_scene_replay_count(run_dir)
    assert "## Actual Play Replay" in battle_text
    assert all(has_cjk(text) for text in visible_play_texts(run_dir))
    assert has_cjk(section_text(battle_text, "## Major Player Decisions"))
    assert has_cjk(section_text(battle_text, "## Story Recap"))
    assert has_cjk(section_text(battle_text, "## Player Feedback On KP"))
    assert "Rooftop Chase Drill" in battle_text
    assert "Chase Summary" in battle_text
    assert "speed roll" in battle_text
    assert "MOV" in battle_text
    assert "movement actions" in battle_text
    assert "location chain" in battle_text
    assert "DEX order" in battle_text
    assert "hazard" in battle_text
    assert "barrier" in battle_text
    assert "conflict" in battle_text
    assert "quarry escapes" in battle_text
    assert "No chase summary recorded." not in battle_text
    assert (run_dir / "sandbox" / ".coc" / "campaigns" / "chase-drill" / "save" / "chase.json").exists()
