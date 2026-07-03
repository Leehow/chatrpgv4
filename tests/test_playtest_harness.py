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
