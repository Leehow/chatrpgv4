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


def transcript_events(run_dir: Path) -> list[dict]:
    import json

    return [
        json.loads(line)
        for line in (run_dir / "transcript.jsonl").read_text().splitlines()
        if line.strip()
    ]


def playtest_metadata(run_dir: Path) -> dict:
    import json

    return json.loads((run_dir / "playtest.json").read_text())


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


def assert_zh_hans_locale(metadata: dict, required_terms: dict[str, str]) -> None:
    assert metadata["play_language"] == "zh-Hans"
    glossary = metadata["localized_terms"]["zh-Hans"]
    for canonical, localized in required_terms.items():
        assert glossary[canonical] == localized


def assert_visible_terms_localized(text: str, required_terms: dict[str, str]) -> None:
    for canonical, localized in required_terms.items():
        assert localized in text
        assert canonical not in text


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
    metadata = playtest_metadata(run_dir)
    zh_terms = {
        "Ada King": "艾达·金",
        "Mr. Knott": "诺特先生",
        "Arty Wilmot": "阿蒂·威尔莫特",
        "Walter Corbitt": "沃尔特·科比特",
        "The Old Corbitt Place": "科比特老宅",
        "Corbitt's Hiding Place": "科比特的藏身处",
        "Corbitt Attacks": "科比特袭击",
    }

    assert audit["result"] == "pass"
    assert "PASS" in audit_text
    assert_zh_hans_locale(metadata, zh_terms)
    module_section = section_text(battle_text, "## Module")
    assert "- Opening Scene: 诺特先生" in battle_text
    assert "诺特先生在 1920 年的波士顿与艾达·金会面" in module_section
    assert "meets" not in module_section
    assert "- 艾达·金 (ada-king-haunting)" in battle_text
    assert "## Scene-by-Scene Replay" in battle_text
    scene_replay = section_text(battle_text, "## Scene-by-Scene Replay")
    assert has_cjk(scene_replay)
    assert bullet_count(scene_replay) >= significant_scene_replay_count(run_dir)
    assert "## Actual Play Replay" in battle_text
    actual_play = section_text(battle_text, "## Actual Play Replay")
    assert_visible_terms_localized(actual_play, zh_terms)
    assert "诺特先生把一枚旧钥匙" in actual_play
    meta_events = [
        event
        for event in transcript_events(run_dir)
        if event.get("mode") == "meta" and event.get("role") in {"keeper_under_test", "player_simulator"}
    ]
    assert {event["role"] for event in meta_events} == {"keeper_under_test", "player_simulator"}
    assert "[meta]" in actual_play
    assert "[/meta]" in actual_play
    assert "为什么这里可以 pushed roll" in actual_play
    assert "失败后果" in actual_play
    assert all("Ada King" not in text for text in visible_play_texts(run_dir))
    assert all("Mr. Knott" not in text for text in visible_play_texts(run_dir))
    assert all("Walter Corbitt" not in text for text in visible_play_texts(run_dir))
    assert all(has_cjk(text) for text in visible_play_texts(run_dir))
    major_decisions = section_text(battle_text, "## Major Player Decisions")
    assert has_cjk(major_decisions)
    assert " chose " not in major_decisions
    assert " before " not in major_decisions
    assert "ada-king-haunting:" not in major_decisions
    assert "艾达·金:" not in major_decisions
    assert "艾达·金: 艾达·金" not in major_decisions
    assert " basement" not in major_decisions
    assert " dagger" not in major_decisions
    assert "艾达·金选择先去《波士顿环球报》查剪报" in major_decisions
    assert "艾达·金相信维托里奥的提示" in major_decisions
    assert has_cjk(section_text(battle_text, "## Story Recap"))
    assert has_cjk(section_text(battle_text, "## Player Feedback On KP"))
    assert "The Haunting Module Playthrough" in battle_text
    assert "Mr. Knott" in battle_text
    assert "Arty Wilmot" in battle_text
    assert "Handout 2" in battle_text
    assert "Chapel of Contemplation" in battle_text
    assert zh_terms["The Old Corbitt Place"] in battle_text
    assert "Bed Attack" in battle_text
    assert "The Floating Knife" in battle_text
    assert zh_terms["Corbitt's Hiding Place"] in battle_text
    assert zh_terms["Corbitt Attacks"] in battle_text
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
    assert bullet_count(major_decisions) >= 5
    assert "{'" not in battle_text
    assert "'}" not in battle_text


def test_chase_drill_harness_generates_auditable_chase_report(tmp_path):
    run_dir = coc_playtest_harness.create_chase_drill_run(tmp_path, run_id="chase-drill")

    audit = coc_playtest_audit.audit_run(run_dir)
    battle_text = (run_dir / "artifacts" / "battle-report.md").read_text()
    audit_text = (run_dir / "artifacts" / "rulebook-audit.md").read_text()
    metadata = playtest_metadata(run_dir)
    zh_terms = {
        "Ada King": "艾达·金",
        "Nathaniel Crowe": "内森尼尔·克劳",
    }

    assert audit["result"] == "pass"
    assert "PASS" in audit_text
    assert_zh_hans_locale(metadata, zh_terms)
    module_section = section_text(battle_text, "## Module")
    assert "- Opening Scene: 艾达·金" in battle_text
    assert "艾达·金发现内森尼尔·克劳带着账本离开印刷店" in module_section
    assert "ledger" not in module_section
    assert "spots" not in module_section
    assert "leaving" not in module_section
    assert "- 艾达·金 (ada-king-chase)" in battle_text
    assert "## Scene-by-Scene Replay" in battle_text
    scene_replay = section_text(battle_text, "## Scene-by-Scene Replay")
    assert has_cjk(scene_replay)
    assert bullet_count(scene_replay) >= significant_scene_replay_count(run_dir)
    assert "## Actual Play Replay" in battle_text
    assert_visible_terms_localized(section_text(battle_text, "## Actual Play Replay"), zh_terms)
    assert all("Ada King" not in text for text in visible_play_texts(run_dir))
    assert all("Nathaniel Crowe" not in text for text in visible_play_texts(run_dir))
    assert all("ledger" not in text for text in visible_play_texts(run_dir))
    assert all(has_cjk(text) for text in visible_play_texts(run_dir))
    chase_decisions = section_text(battle_text, "## Major Player Decisions")
    assert has_cjk(chase_decisions)
    assert " chose " not in chase_decisions
    assert "ada-king-chase:" not in chase_decisions
    assert "艾达·金:" not in chase_decisions
    assert "艾达·金: 艾达·金" not in chase_decisions
    assert "push ledger confirmation roll" not in chase_decisions
    assert "ledger" not in chase_decisions
    assert "艾达·金冒着被发现的风险继续观察" in chase_decisions
    assert "是否带着账本" in chase_decisions
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
