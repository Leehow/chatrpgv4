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


def campaign_roll_events(run_dir: Path) -> list[dict]:
    import json

    campaign_logs = run_dir / "sandbox" / ".coc" / "campaigns"
    events: list[dict] = []
    for path in sorted(campaign_logs.glob("*/logs/rolls.jsonl")):
        events.extend(json.loads(line) for line in path.read_text().splitlines() if line.strip())
    return events


def investigator_jsonl(run_dir: Path, investigator_id: str, filename: str) -> list[dict]:
    import json

    path = run_dir / "sandbox" / ".coc" / "investigators" / investigator_id / filename
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


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


def detail_count(text: str, label: str) -> int:
    return sum(1 for line in text.splitlines() if line.startswith(f"  - {label}："))


def assert_zh_hans_locale(metadata: dict, required_terms: dict[str, str]) -> None:
    assert metadata["play_language"] == "zh-Hans"
    assert metadata["language_profile"]["language"] == "zh-Hans"
    assert "localized_terms.zh-Hans" in metadata["language_profile"]["term_policy"]
    glossary = metadata["localized_terms"]["zh-Hans"]
    for canonical, localized in required_terms.items():
        assert glossary[canonical] == localized


def assert_visible_terms_localized(text: str, required_terms: dict[str, str]) -> None:
    for canonical, localized in required_terms.items():
        assert localized in text
        assert canonical not in text


def assert_terms_absent(text: str, canonical_terms: list[str]) -> None:
    for canonical in canonical_terms:
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
    visible_scene_terms = {
        "Ruth Blake": "露丝·布莱克",
        "morgue": "剪报档案室",
        "Handout": "线索资料",
        "basement door": "地下室门",
        "basement": "地下室",
        "spare bedroom": "备用卧室",
        "three-Y symbol": "三叉眼符号",
        "Mythos material": "神话材料",
        "dagger": "匕首",
    }
    report_scene_terms = {
        "basement stairs": "地下室楼梯",
        "pushed basement search": "推骰地下室搜索",
        "own-weapon clue": "以其人之物反制的线索",
        "three-Y eye symbol": "三叉眼符号",
    }

    assert audit["result"] == "pass"
    assert "PASS" in audit_text
    assert "## Positive Rulebook Evidence" in audit_text
    assert "Module coverage: 10/10" in audit_text
    assert "Bout of Madness events: 1" in audit_text
    assert "temporary_insanity_triggered markers: 1" in audit_text
    assert_zh_hans_locale(metadata, zh_terms | visible_scene_terms | report_scene_terms)
    run_setup = section_text(battle_text, "## Run Setup")
    assert "- Play Language: zh-Hans" in run_setup
    assert "Localized Terms: " in run_setup
    assert "see Localization Appendix" in run_setup
    assert "Ada King -> 艾达·金" not in run_setup
    assert "Mr. Knott -> 诺特先生" not in run_setup
    assert "The Old Corbitt Place -> 科比特老宅" not in run_setup
    assert len(run_setup.splitlines()) <= 10
    localization_appendix = section_text(battle_text, "## Localization Appendix")
    assert "Ada King -> 艾达·金" in localization_appendix
    assert "Mr. Knott -> 诺特先生" in localization_appendix
    assert "The Old Corbitt Place -> 科比特老宅" in localization_appendix
    module_section = section_text(battle_text, "## Module")
    assert "- Opening Scene: 诺特先生" in battle_text
    assert "诺特先生在 1920 年的波士顿与艾达·金会面" in module_section
    assert "meets" not in module_section
    assert "- 艾达·金 (ada-king-haunting)" in battle_text
    character_dossier = section_text(battle_text, "## Character Dossier")
    assert "Backstory:" in character_dossier
    assert "Description: 艾达·金" in character_dossier
    assert "Ideology/Beliefs: 老房子会留下居住者的记忆" in character_dossier
    assert "Significant People: 莱兰·哈特教授" in character_dossier
    assert "Meaningful Locations: 斯科利广场附近的旧书店" in character_dossier
    assert "Treasured Possessions: 裂柄铜放大镜" in character_dossier
    assert "Traits: 谨慎记笔记" in character_dossier
    assert "Ada King" not in character_dossier
    assert investigator_jsonl(run_dir, "ada-king-haunting", "history.jsonl")
    assert investigator_jsonl(run_dir, "ada-king-haunting", "development.jsonl")
    chronicle = section_text(battle_text, "## Investigator Chronicle")
    assert "History:" in chronicle
    assert "艾达·金在 The Haunting 中幸存" in chronicle
    assert "最终 HP: 3" in chronicle
    assert "最终 SAN: 49" in chronicle
    assert "Development:" in chronicle
    assert "Status: pending_player_rolls" in chronicle
    assert "Skill Checks Earned: Persuade; Library Use; Spot Hidden; Dodge; Fighting (Brawl)" in chronicle
    assert "Carryover Notes: 下次导入前先结算成长检定" in chronicle
    assert "## Scene-by-Scene Replay" in battle_text
    scene_replay = section_text(battle_text, "## Scene-by-Scene Replay")
    assert has_cjk(scene_replay)
    assert bullet_count(scene_replay) >= significant_scene_replay_count(run_dir)
    assert "- basement:" in scene_replay
    assert "- 地下室:" not in scene_replay
    assert "自家地下室" in scene_replay
    assert "地下室楼梯" in scene_replay
    assert "推骰地下室搜索" in scene_replay
    assert "以其人之物反制的线索" in scene_replay
    assert "伤害: 5 HP" in scene_replay
    assert "DEX 检定" in scene_replay
    assert_terms_absent(scene_replay, ["own-weapon clue", "three-Y eye symbol", "spare bedroom", "basement stairs", "pushed 地下室 search"])
    assert_terms_absent(scene_replay, ["Damage:", "DEX roll"])
    assert "## Actual Play Replay" in battle_text
    actual_play = section_text(battle_text, "## Actual Play Replay")
    assert_visible_terms_localized(actual_play, zh_terms)
    assert "诺特先生把一枚旧钥匙" in actual_play
    assert "Turn 6 system: Persuade：艾达·金掷出 72 / 55，结果失败。" in actual_play
    assert "Turn 42 system: POW：沃尔特·科比特掷出 34 / 90，结果困难成功；Dodge：艾达·金掷出 18 / 25，结果困难成功。浮空匕首刺空。" in actual_play
    assert "Persuade 72 vs 55" not in actual_play
    assert "regular_success" not in actual_play
    assert "Corbitt POW 34 vs 90" not in actual_play
    session_transcript = section_text(battle_text, "## Session Transcript")
    assert "Turn 6 system: Persuade：艾达·金掷出 72 / 55，结果失败。" in session_transcript
    assert "Turn 42 system: POW：沃尔特·科比特掷出 34 / 90，结果困难成功；Dodge：艾达·金掷出 18 / 25，结果困难成功。浮空匕首刺空。" in session_transcript
    assert "Persuade 72 vs 55" not in session_transcript
    assert "regular_success" not in session_transcript
    assert "Corbitt POW 34 vs 90" not in session_transcript
    visible_dialogue = "\n".join(visible_play_texts(run_dir))
    assert_visible_terms_localized(visible_dialogue, visible_scene_terms)
    assert_terms_absent(visible_dialogue, ["Regular difficulty", "pushed roll", "pushed rolls", "HP damage"])
    assert_terms_absent(visible_dialogue, ["combined roll", "Obscure clue", " chapel "])
    assert_terms_absent(visible_dialogue, ["combat round", "Rewards", "Final HP", "Final SAN"])
    assert "难度为普通" not in visible_dialogue
    assert "普通难度" in visible_dialogue
    assert "推骰" in visible_dialogue
    assert "HP 伤害" in visible_dialogue
    assert "联合检定" in visible_dialogue
    assert "隐晦线索" in visible_dialogue
    assert "教堂或科比特" in visible_dialogue
    assert "战斗轮" in visible_dialogue
    assert "奖励" in visible_dialogue
    assert "最终 HP" in visible_dialogue
    assert "最终 SAN" in visible_dialogue
    meta_events = [
        event
        for event in transcript_events(run_dir)
        if event.get("mode") == "meta" and event.get("role") in {"keeper_under_test", "player_simulator"}
    ]
    assert {event["role"] for event in meta_events} == {"keeper_under_test", "player_simulator"}
    assert "[meta]" in actual_play
    assert "[/meta]" in actual_play
    assert "为什么这里可以推骰" in actual_play
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
    rules_recap = section_text(battle_text, "## Rules & Rolls Recap")
    assert has_cjk(rules_recap)
    assert "Persuade：艾达·金掷出 72 / 55，结果失败。" in rules_recap
    assert "目的：获得《波士顿环球报》剪报档案的查阅许可" in rules_recap
    assert "难度说明：阿蒂·威尔莫特只是普通编辑" in rules_recap
    assert "失败后果：艾达·金会被阿蒂拒绝" in rules_recap
    assert "推骰：yes" in rules_recap
    assert "成长标记：yes" in rules_recap
    assert "SAN 损失：6" in rules_recap
    assert "POW：沃尔特·科比特掷出 34 / 90" in rules_recap
    assert "gain access to" not in rules_recap
    assert "clipping files" not in rules_recap
    assert "obstructive but ordinary editor" not in rules_recap
    assert " would " not in rules_recap
    assert "Goal:" not in rules_recap
    assert "Failure Consequence:" not in rules_recap
    assert "Pushed Roll:" not in rules_recap
    assert "ada-king-haunting rolled" not in rules_recap
    roll_event_count = len(campaign_roll_events(run_dir))
    assert bullet_count(rules_recap) == roll_event_count
    assert detail_count(rules_recap, "目的") == roll_event_count
    assert detail_count(rules_recap, "难度说明") == roll_event_count
    assert detail_count(rules_recap, "失败后果") == roll_event_count
    assert has_cjk(section_text(battle_text, "## Story Recap"))
    feedback = section_text(battle_text, "## Player Feedback On KP")
    assert has_cjk(feedback)
    assert "清单" in feedback
    assert "checklist" not in feedback
    assert "The Haunting Module Playthrough" in battle_text
    assert "Mr. Knott" in battle_text
    assert "Arty Wilmot" in battle_text
    assert "线索资料 2" in battle_text
    assert "Chapel of Contemplation" in battle_text
    assert zh_terms["The Old Corbitt Place"] in battle_text
    assert "Bed Attack" in battle_text
    assert "The Floating Knife" in battle_text
    assert zh_terms["Corbitt's Hiding Place"] in battle_text
    assert zh_terms["Corbitt Attacks"] in battle_text
    combat_summary = section_text(battle_text, "## Combat Summary")
    assert "奖励" in battle_text
    assert "临时疯狂" in battle_text
    assert "Bout of Madness" in battle_text
    assert "1D10 回合" in battle_text
    assert "1D10 掷出 4，所以持续 4 回合" in battle_text
    assert "艾达·金在临时疯狂中把左轮丢到地下室角落" in battle_text
    assert "Bout duration rolls: 1" in audit_text
    assert "战斗轮" in battle_text
    assert "combat round" not in combat_summary
    assert "in a 战斗轮" not in combat_summary
    assert "DEX order" not in combat_summary
    assert "opposed POW" not in combat_summary
    assert "DEX 顺序" in combat_summary
    assert "POW 对抗" in combat_summary
    state_changes = section_text(battle_text, "### State Changes")
    story_recap = section_text(battle_text, "## Story Recap")
    assert "worm-eaten book" not in state_changes
    assert "worm-eaten book" not in story_recap
    assert "虫蛀书" in state_changes
    assert "伤害: 5 HP" in battle_text
    assert "Damage: 5 HP" not in battle_text
    assert "最终 HP: 3" in battle_text
    assert "最终 SAN: 49" in battle_text
    assert "Player Feedback On KP" in battle_text
    assert "module_fidelity: 4" in battle_text
    assert "No combat summary recorded." not in battle_text
    chase_summary = section_text(battle_text, "## Chase Summary")
    assert "本模组不包含必需追逐场景" in chase_summary
    assert "追逐子系统覆盖留到独立场景" in chase_summary
    assert "本模组不包含必需追逐场景（本模组不包含必需追逐场景）" not in chase_summary
    assert "The Haunting does not include a required chase sequence" not in chase_summary
    assert "chase subsystem coverage deferred to separate scenario" not in chase_summary
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
    visible_scene_terms = {
        "print shop roof": "印刷店屋顶",
        "print-shop roof": "印刷店屋顶",
        "rain gutter": "雨水槽",
        "slick skylight hazard": "湿滑天窗危险点",
        "slick skylight": "湿滑天窗",
        "skylight": "天窗",
        "locked roof door barrier": "上锁屋顶门障碍",
        "roof door": "屋顶门",
        "laundry sheets": "晾衣布单",
        "laundry roof": "晾衣屋顶",
        "key ring": "钥匙串",
        "two locations": "两个位置",
    }

    assert audit["result"] == "pass"
    assert "PASS" in audit_text
    assert_zh_hans_locale(metadata, zh_terms | visible_scene_terms)
    run_setup = section_text(battle_text, "## Run Setup")
    assert "- Play Language: zh-Hans" in run_setup
    assert "Localized Terms: " in run_setup
    assert "see Localization Appendix" in run_setup
    assert "Ada King -> 艾达·金" not in run_setup
    assert "Nathaniel Crowe -> 内森尼尔·克劳" not in run_setup
    assert "ledger -> 账本" not in run_setup
    assert len(run_setup.splitlines()) <= 10
    localization_appendix = section_text(battle_text, "## Localization Appendix")
    assert "Ada King -> 艾达·金" in localization_appendix
    assert "Nathaniel Crowe -> 内森尼尔·克劳" in localization_appendix
    assert "ledger -> 账本" in localization_appendix
    module_section = section_text(battle_text, "## Module")
    assert "- Opening Scene: 艾达·金" in battle_text
    assert "艾达·金发现内森尼尔·克劳带着账本离开印刷店" in module_section
    assert "ledger" not in module_section
    assert "spots" not in module_section
    assert "leaving" not in module_section
    assert "- 艾达·金 (ada-king-chase)" in battle_text
    character_dossier = section_text(battle_text, "## Character Dossier")
    assert "Backstory:" in character_dossier
    assert "Description: 艾达·金" in character_dossier
    assert "Ideology/Beliefs: 线索必须在行动前被核实" in character_dossier
    assert "Significant People: 莱兰·哈特教授" in character_dossier
    assert "Meaningful Locations: 印刷店屋顶" in character_dossier
    assert "Treasured Possessions: 裂柄铜放大镜" in character_dossier
    assert "Traits: 观察细致" in character_dossier
    assert "Ada King" not in character_dossier
    assert investigator_jsonl(run_dir, "ada-king-chase", "history.jsonl")
    assert investigator_jsonl(run_dir, "ada-king-chase", "development.jsonl")
    chronicle = section_text(battle_text, "## Investigator Chronicle")
    assert "History:" in chronicle
    assert "艾达·金带着邪教账本逃脱" in chronicle
    assert "最终 HP: 12" in chronicle
    assert "最终 SAN: 55" in chronicle
    assert "Development:" in chronicle
    assert "Status: pending_player_rolls" in chronicle
    assert "Skill Checks Earned: Spot Hidden; Dodge; Locksmith; Stealth" in chronicle
    assert "Carryover Notes: 账本线索可带入后续模组" in chronicle
    assert "## Scene-by-Scene Replay" in battle_text
    scene_replay = section_text(battle_text, "## Scene-by-Scene Replay")
    assert has_cjk(scene_replay)
    assert bullet_count(scene_replay) >= significant_scene_replay_count(run_dir)
    assert "- print-shop-roof:" in scene_replay
    assert "- 印刷店屋顶:" not in scene_replay
    assert "clue:ledger-clue" in scene_replay
    assert "clue:账本-clue" not in scene_replay
    assert "艾达·金在印刷店屋顶发现内森尼尔·克劳" in scene_replay
    assert "湿滑天窗" in scene_replay
    assert_terms_absent(scene_replay, ["print shop roof", "print-shop roof", "rain gutter", "locked roof door barrier", "slick 天窗"])
    assert "## Actual Play Replay" in battle_text
    actual_play = section_text(battle_text, "## Actual Play Replay")
    assert_visible_terms_localized(actual_play, zh_terms)
    assert "Turn 4 system: Spot Hidden：艾达·金掷出 82 / 55，结果失败。" in actual_play
    assert "Turn 9 system: CON：艾达·金掷出 42 / 55，结果成功。MOV 保持 8。" in actual_play
    assert "Turn 18 system: Dodge：艾达·金掷出 19 / 35，结果普通成功；Fighting (Brawl)：内森尼尔·克劳掷出 62 / 45，结果失败。内森尼尔·克劳的短棍攻击落空。" in actual_play
    assert "Turn 20 system: Locksmith：艾达·金掷出 21 / 30，结果普通成功；Stealth：艾达·金掷出 18 / 45，结果困难成功；Spot Hidden：内森尼尔·克劳掷出 77 / 40，结果失败。艾达·金带着账本逃脱。" in actual_play
    assert "Pushed Spot Hidden 33" not in actual_play
    assert "MOV remains" not in actual_play
    assert "extreme_success" not in actual_play
    session_transcript = section_text(battle_text, "## Session Transcript")
    assert "Turn 4 system: Spot Hidden：艾达·金掷出 82 / 55，结果失败。" in session_transcript
    assert "Turn 9 system: CON：艾达·金掷出 42 / 55，结果成功。MOV 保持 8。" in session_transcript
    assert "Pushed Spot Hidden 33" not in session_transcript
    assert "MOV remains" not in session_transcript
    assert "extreme_success" not in session_transcript
    visible_dialogue = "\n".join(visible_play_texts(run_dir))
    assert_visible_terms_localized(visible_dialogue, visible_scene_terms)
    assert_terms_absent(
        visible_dialogue,
        [
            "Regular difficulty",
            "pushed roll",
            "pushed rolls",
            "speed roll",
            "location chain",
            "movement action",
            "movement actions",
            "quarry",
            "pursuer",
            "chase",
        ],
    )
    assert "难度普通" not in visible_dialogue
    assert "普通难度" in visible_dialogue
    assert "推骰" in visible_dialogue
    assert "速度检定" in visible_dialogue
    assert "位置链" in visible_dialogue
    assert "移动行动" in visible_dialogue
    assert "被追者" in visible_dialogue
    assert "追赶者" in visible_dialogue
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
    rules_recap = section_text(battle_text, "## Rules & Rolls Recap")
    assert has_cjk(rules_recap)
    assert "Spot Hidden：艾达·金掷出 82 / 55，结果失败。" in rules_recap
    assert "CON：艾达·金掷出 42 / 55，结果成功。" in rules_recap
    assert "CON：内森尼尔·克劳掷出 9 / 50，结果极难成功。" in rules_recap
    assert "速度检定" in rules_recap
    assert "移动行动" in rules_recap
    assert "被追者逃脱" in rules_recap
    assert "邪教账本" in rules_recap
    assert "确认内森尼尔·克劳行动前是否带着邪教账本" in rules_recap
    assert "步行追逐使用 CON 作为速度检定" in rules_recap
    assert "艾达·金的 MOV 会在本次追逐中降低 1" in rules_recap
    assert "confirm " not in rules_recap
    assert "before acting" not in rules_recap
    assert "On-foot chases" not in rules_recap
    assert " would " not in rules_recap
    assert "Goal:" not in rules_recap
    assert "Failure Consequence:" not in rules_recap
    assert "ada-king-chase rolled" not in rules_recap
    assert "nathaniel-crowe rolled" not in rules_recap
    roll_event_count = len(campaign_roll_events(run_dir))
    assert bullet_count(rules_recap) == roll_event_count
    assert detail_count(rules_recap, "目的") == roll_event_count
    assert detail_count(rules_recap, "难度说明") == roll_event_count
    assert detail_count(rules_recap, "失败后果") == roll_event_count
    story_recap = section_text(battle_text, "## Story Recap")
    assert has_cjk(story_recap)
    assert "屋顶追逐" in story_recap
    assert "rooftop 追逐" not in story_recap
    feedback = section_text(battle_text, "## Player Feedback On KP")
    assert has_cjk(feedback)
    assert "规则裁定" in feedback
    assert "rule decisions" not in feedback
    assert "escapes" not in feedback
    assert "逃脱" in feedback
    assert "save/chase.json" in battle_text
    assert "save/追逐.json" not in battle_text
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


def test_multi_profile_pressure_run_records_distinct_virtual_players(tmp_path):
    stale_artifacts = tmp_path / ".coc" / "playtests" / "multi-profile-pressure" / "artifacts"
    stale_artifacts.mkdir(parents=True)
    (stale_artifacts / "semantic-eval-request.json").write_text("{}")
    (stale_artifacts / "semantic-eval-result.json").write_text("{}")

    run_dir = coc_playtest_harness.create_multi_profile_pressure_run(tmp_path, run_id="multi-profile-pressure")

    audit = coc_playtest_audit.audit_run(run_dir)
    battle_text = (run_dir / "artifacts" / "battle-report.md").read_text()
    metadata = playtest_metadata(run_dir)

    assert audit["result"] == "pass"
    assert metadata["audit_profile"] == "multi_profile_pressure"
    assert metadata["player_profile"] == "multi_profile_matrix"
    assert metadata["player_profiles_tested"] == [
        "careful_investigator",
        "reckless_investigator",
        "skeptical_rules_lawyer",
    ]
    actual_play = section_text(battle_text, "## Actual Play Replay")
    assert "Player[careful_investigator]" in actual_play
    assert "Player[reckless_investigator]" in actual_play
    assert "Player[skeptical_rules_lawyer]" in actual_play
    assert "先查房契和旧报纸" in actual_play
    assert "我直接去二楼" in actual_play
    assert "[meta] 我想质疑一下" in actual_play
    assert "规则裁定" in actual_play
    character_dossier = section_text(battle_text, "## Character Dossier")
    assert "Backstory:" in character_dossier
    assert "Description: 艾达·金" in character_dossier
    assert "Ideology/Beliefs: 公开记录比传闻可靠" in character_dossier
    assert "Significant People: 莱兰·哈特教授" in character_dossier
    assert "Meaningful Locations: 波士顿档案馆阅览室" in character_dossier
    assert "Treasured Possessions: 裂柄铜放大镜" in character_dossier
    assert "Traits: 谨慎记笔记" in character_dossier
    assert "Ada King" not in character_dossier
    assert investigator_jsonl(run_dir, "ada-king-pressure", "history.jsonl")
    assert investigator_jsonl(run_dir, "ada-king-pressure", "development.jsonl")
    chronicle = section_text(battle_text, "## Investigator Chronicle")
    assert "History:" in chronicle
    assert "艾达·金经历了三种玩家风格压测" in chronicle
    assert "Development:" in chronicle
    assert "Status: pending_player_rolls" in chronicle
    assert "Skill Checks Earned: Library Use; Spot Hidden" in chronicle
    assert "Carryover Notes: 后续故事入口保留为沉思教堂记录" in chronicle
    assert all(has_cjk(text) for text in visible_play_texts(run_dir))
    feedback = section_text(battle_text, "## Player Feedback On KP")
    assert "careful_investigator:" in feedback
    assert "reckless_investigator:" in feedback
    assert "skeptical_rules_lawyer:" in feedback
    assert not (run_dir / "artifacts" / "semantic-eval-request.json").exists()
    assert not (run_dir / "artifacts" / "semantic-eval-result.json").exists()
