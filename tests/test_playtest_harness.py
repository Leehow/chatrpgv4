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
    assert "player-visible skill display names" in metadata["language_profile"]["term_policy"]
    glossary = metadata["localized_terms"]["zh-Hans"]
    for canonical, localized in required_terms.items():
        assert glossary[canonical] == localized


def assert_visible_terms_localized(text: str, required_terms: dict[str, str]) -> None:
    for canonical, localized in required_terms.items():
        assert localized in text
        assert canonical not in text


ZH_SKILL_TERMS = {
    "Persuade": "说服",
    "Library Use": "图书馆使用",
    "Spot Hidden": "侦查",
    "Dodge": "闪避",
    "Fighting (Brawl)": "格斗（斗殴）",
    "Locksmith": "锁匠",
    "Stealth": "潜行",
    "Charm": "魅惑",
    "Climb": "攀爬",
    "Psychology": "心理学",
}


def assert_terms_absent(text: str, canonical_terms: list[str]) -> None:
    for canonical in canonical_terms:
        assert canonical not in text


def assert_localized_report_shell(text: str) -> None:
    assert "# Battle Report / 跑团战报" in text
    assert "## Run Setup / 运行设置" in text
    assert "## Actual Play Replay / 实际跑团回放" in text
    assert "## Session Transcript / 会话记录" in text
    assert "## Player Feedback On KP / 玩家对 KP 的反馈" in text
    run_setup = section_text(text, "## Run Setup")
    assert "Campaign:" in run_setup
    assert "（战役）" in run_setup
    assert "Play Language: zh-Hans" in run_setup
    assert "（游玩语言）" in run_setup
    module_section = section_text(text, "## Module")
    assert "Opening Scene:" in module_section
    assert "（开场场景）" in module_section


def assert_localized_character_dossier_labels(text: str) -> None:
    assert "  - 职业: " in text
    assert "  - 年代: " in text
    assert "  - 属性: " in text
    assert "  - 衍生值: " in text
    assert "DB: 0" in text
    assert "体格: 0" in text
    assert "  - 技能: " in text
    assert "  - 背景:" in text
    assert "    - 描述: " in text
    assert "    - 信念/理念: " in text
    assert "    - 重要之人: " in text
    assert "    - 重要地点: " in text
    assert "    - 珍贵物品: " in text
    assert "    - 特质: " in text
    assert "  - Occupation:" not in text
    assert "  - Backstory:" not in text
    assert "    - Description:" not in text
    assert "damage_bonus:" not in text
    assert "build:" not in text
    assert "职业: 古物学者" in text
    assert "Antiquarian" not in text


def assert_player_readable_state_ids_absent(text: str, ids: list[str]) -> None:
    for state_id in ids:
        assert f"- {state_id}:" not in text
        assert f"- clue:{state_id}:" not in text
        assert f"- {state_id} -" not in text


def assert_player_readable_event_prefixes_absent(text: str, event_labels: list[str]) -> None:
    for event_label in event_labels:
        assert f"- {event_label}:" not in text


def assert_player_readable_actor_dash_prefixes_absent(text: str, actor_names: list[str]) -> None:
    for actor_name in actor_names:
        assert f"- {actor_name} - " not in text


def assert_player_readable_actor_colon_prefixes_absent(text: str, actor_names: list[str]) -> None:
    for actor_name in actor_names:
        assert f"- {actor_name}: " not in text


def assert_localized_transcript_chrome(text: str) -> None:
    assert "第 1 轮" in text
    assert "\n  - 意图:" in text or "\n  - 裁定:" in text or "\n  - 模式:" in text
    assert "- Turn " not in text
    assert " system:" not in text
    assert "\n  - Intent:" not in text
    assert "\n  - Ruling:" not in text
    assert "\n  - Mode:" not in text
    assert "\n  - 模式: roll" not in text
    assert "\n  - 模式: play" not in text
    assert "\n  - 模式: meta" not in text
    if "\n  - 模式:" in text:
        assert any(
            f"\n  - 模式: {localized_mode}" in text
            for localized_mode in ["游玩", "掷骰", "超游"]
        )


def assert_transcript_detail_values_localized(text: str, expected: list[str], forbidden: list[str]) -> None:
    for value in expected:
        assert value in text
    for value in forbidden:
        assert value not in text


def assert_localized_chronicle_labels(text: str) -> None:
    expected = [
        "经历:",
        "成长:",
        "成长阶段摘要",
        "状态: 等待玩家成长检定",
        "获得成长标记:",
        "继承备注:",
    ]
    forbidden = [
        "History:",
        "Development:",
        "Development Phase Summary",
        "Status: pending_player_rolls",
        "Skill Checks Earned:",
        "Carryover Notes:",
    ]
    for value in expected:
        assert value in text
    for value in forbidden:
        assert value not in text


def assert_feedback_labels_localized(text: str, expected: list[str], forbidden: list[str]) -> None:
    for value in expected:
        assert value in text
    for value in forbidden:
        assert value not in text


def assert_run_setup_values_localized(text: str, expected_profile: str) -> None:
    expected = [
        "Dice Mode: Codex 掷骰（骰子模式）",
        "Spoiler Policy: 剧透前警告（剧透策略）",
        "Language Profile: 简体中文（语言配置）",
        "条（见本地化附录）（本地化术语）",
        f"Player Profile: {expected_profile}（玩家画像）",
    ]
    forbidden = [
        "Dice Mode: codex",
        "Spoiler Policy: warn_before_reveal",
        "Language Profile: Simplified Chinese",
        "entries (see Localization Appendix)",
        "careful_investigator",
        "reckless_investigator",
        "multi_profile_matrix",
    ]
    for value in expected:
        assert value in text
    for value in forbidden:
        assert value not in text


def assert_module_metadata_values_localized(
    run_setup: str,
    module_section: str,
    *,
    campaign: str,
    scenario: str,
    source: str,
    forbidden: list[str],
) -> None:
    combined = f"{run_setup}\n{module_section}"
    expected = [
        f"Campaign: {campaign}（战役）",
        f"Scenario: {scenario}（模组）",
        f"Source: {source}（来源）",
    ]
    for value in expected:
        assert value in combined
    for value in forbidden:
        assert value not in combined


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
    assert_zh_hans_locale(metadata, zh_terms | visible_scene_terms | report_scene_terms | ZH_SKILL_TERMS)
    assert metadata["localized_terms"]["zh-Hans"]["Antiquarian"] == "古物学者"
    assert_localized_report_shell(battle_text)
    run_setup = section_text(battle_text, "## Run Setup")
    assert "- Play Language: zh-Hans" in run_setup
    assert "Localized Terms: " in run_setup
    assert_run_setup_values_localized(run_setup, "谨慎调查员")
    assert "Ada King -> 艾达·金" not in run_setup
    assert "Mr. Knott -> 诺特先生" not in run_setup
    assert "The Old Corbitt Place -> 科比特老宅" not in run_setup
    assert len(run_setup.splitlines()) <= 10
    localization_appendix = section_text(battle_text, "## Localization Appendix")
    assert "Ada King -> 艾达·金" in localization_appendix
    assert "Mr. Knott -> 诺特先生" in localization_appendix
    assert "The Old Corbitt Place -> 科比特老宅" in localization_appendix
    module_section = section_text(battle_text, "## Module")
    assert_module_metadata_values_localized(
        run_setup,
        module_section,
        campaign="《鬼屋》模组实录",
        scenario="《鬼屋》",
        source="《克苏鲁的呼唤守秘人规则书》40周年纪念版 PDF",
        forbidden=[
            "The Haunting Module Playthrough",
            "Scenario: The Haunting",
            "pdf/Call Of Cthulhu Keeper Rulebook",
        ],
    )
    assert "- Opening Scene: 诺特先生" in battle_text
    assert "诺特先生在 1920 年的波士顿与艾达·金会面" in module_section
    assert "meets" not in module_section
    assert "- 艾达·金 (ada-king-haunting)" in battle_text
    character_dossier = section_text(battle_text, "## Character Dossier")
    assert_localized_character_dossier_labels(character_dossier)
    assert "描述: 艾达·金" in character_dossier
    assert "信念/理念: 老房子会留下居住者的记忆" in character_dossier
    assert "重要之人: 莱兰·哈特教授" in character_dossier
    assert "重要地点: 斯科利广场附近的旧书店" in character_dossier
    assert "珍贵物品: 裂柄铜放大镜" in character_dossier
    assert "特质: 谨慎记笔记" in character_dossier
    assert "Ada King" not in character_dossier
    assert "说服: 55" in character_dossier
    assert "图书馆使用: 60" in character_dossier
    assert "侦查: 55" in character_dossier
    assert "闪避: 25" in character_dossier
    assert "格斗（斗殴）: 40" in character_dossier
    assert "Persuade: 55" not in character_dossier
    assert "Library Use: 60" not in character_dossier
    assert "Spot Hidden: 55" not in character_dossier
    assert "Dodge: 25" not in character_dossier
    assert "Fighting (Brawl): 40" not in character_dossier
    assert investigator_jsonl(run_dir, "ada-king-haunting", "history.jsonl")
    assert investigator_jsonl(run_dir, "ada-king-haunting", "development.jsonl")
    chronicle = section_text(battle_text, "## Investigator Chronicle")
    assert_localized_chronicle_labels(chronicle)
    assert "艾达·金在《鬼屋》中幸存" in chronicle
    assert "最终 HP: 3" in chronicle
    assert "最终 SAN: 49" in chronicle
    assert "获得成长标记: 说服; 图书馆使用; 侦查; 闪避; 格斗（斗殴）" in chronicle
    assert "继承备注: 下次导入前先结算成长检定" in chronicle
    assert "## Scene-by-Scene Replay" in battle_text
    scene_replay = section_text(battle_text, "## Scene-by-Scene Replay")
    assert has_cjk(scene_replay)
    assert bullet_count(scene_replay) >= significant_scene_replay_count(run_dir)
    assert_player_readable_state_ids_absent(
        scene_replay,
        ["basement", "corbitt-dagger", "own-weapon-clue", "corbitt-defeated"],
    )
    assert_player_readable_event_prefixes_absent(
        scene_replay,
        ["damage", "sanity", "combat", "bout of madness", "chase", "session ending"],
    )
    assert_player_readable_actor_dash_prefixes_absent(scene_replay, ["艾达·金"])
    assert "自家地下室" in scene_replay
    assert "地下室楼梯" in scene_replay
    assert "推骰地下室搜索" in scene_replay
    assert "以其人之物反制的线索" in scene_replay
    assert "床铺袭击造成艾达·金 5 HP 伤害；HP 12 -> 7。" in scene_replay
    assert "推骰地下室搜索失败造成艾达·金 4 HP 伤害；HP 7 -> 3。" in scene_replay
    assert "DEX 检定" in scene_replay
    assert "ada-king-haunting -" not in scene_replay
    assert "艾达·金 - 艾达·金" not in scene_replay
    assert "- 艾达·金用借助外套战技" in scene_replay
    assert_terms_absent(scene_replay, ["own-weapon clue", "three-Y eye symbol", "spare bedroom", "basement stairs", "pushed 地下室 search"])
    assert_terms_absent(scene_replay, ["Damage:", "DEX roll"])
    assert "## Actual Play Replay" in battle_text
    actual_play = section_text(battle_text, "## Actual Play Replay")
    assert_visible_terms_localized(actual_play, zh_terms)
    assert_localized_transcript_chrome(actual_play)
    assert_transcript_detail_values_localized(
        actual_play,
        ["询问委托条件和近期线索", "无需检定", "询问推骰裁定", "推骰说明"],
        ["ask terms and immediate leads", "no_roll_needed", "ask 推骰-roll ruling", "pushed_roll_explanation"],
    )
    assert "诺特先生把一枚旧钥匙" in actual_play
    assert "第 6 轮 系统: 说服：艾达·金掷出 72 / 55，结果失败。" in actual_play
    assert "第 42 轮 系统: POW：沃尔特·科比特掷出 34 / 90，结果困难成功；闪避：艾达·金掷出 18 / 25，结果困难成功。浮空匕首刺空。" in actual_play
    assert "Persuade 72 vs 55" not in actual_play
    assert "Persuade：" not in actual_play
    assert "Dodge：" not in actual_play
    assert "regular_success" not in actual_play
    assert "Corbitt POW 34 vs 90" not in actual_play
    session_transcript = section_text(battle_text, "## Session Transcript")
    assert_localized_transcript_chrome(session_transcript)
    assert_transcript_detail_values_localized(
        session_transcript,
        ["询问委托条件和近期线索", "无需检定", "询问推骰裁定", "推骰说明"],
        ["ask terms and immediate leads", "no_roll_needed", "ask 推骰-roll ruling", "pushed_roll_explanation"],
    )
    assert "第 6 轮 系统: 说服：艾达·金掷出 72 / 55，结果失败。" in session_transcript
    assert "第 42 轮 系统: POW：沃尔特·科比特掷出 34 / 90，结果困难成功；闪避：艾达·金掷出 18 / 25，结果困难成功。浮空匕首刺空。" in session_transcript
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
    assert any(
        event.get("role") == "system" and event.get("mode") == "roll"
        for event in transcript_events(run_dir)
    )
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
    assert "说服：艾达·金掷出 72 / 55，结果失败。" in rules_recap
    assert "图书馆使用：艾达·金掷出 22 / 60，结果困难成功。" in rules_recap
    assert "侦查：艾达·金掷出 28 / 55，结果普通成功。" in rules_recap
    assert "目的：获得《波士顿环球报》剪报档案的查阅许可" in rules_recap
    assert "难度说明：阿蒂·威尔莫特只是普通编辑" in rules_recap
    assert "失败后果：艾达·金会被阿蒂拒绝" in rules_recap
    assert "推骰：是" in rules_recap
    assert "成长标记：是" in rules_recap
    assert "成长标记：否" in rules_recap
    assert "SAN 损失：6" in rules_recap
    assert "POW：沃尔特·科比特掷出 34 / 90" in rules_recap
    assert "Persuade：" not in rules_recap
    assert "Library Use：" not in rules_recap
    assert "Spot Hidden：" not in rules_recap
    assert "Dodge：" not in rules_recap
    assert "gain access to" not in rules_recap
    assert "clipping files" not in rules_recap
    assert "obstructive but ordinary editor" not in rules_recap
    assert " would " not in rules_recap
    assert "Goal:" not in rules_recap
    assert "Failure Consequence:" not in rules_recap
    assert "Pushed Roll:" not in rules_recap
    assert "推骰：yes" not in rules_recap
    assert "成长标记：yes" not in rules_recap
    assert "成长标记：no" not in rules_recap
    assert "ada-king-haunting rolled" not in rules_recap
    roll_event_count = len(campaign_roll_events(run_dir))
    assert bullet_count(rules_recap) == roll_event_count
    assert detail_count(rules_recap, "目的") == roll_event_count
    assert detail_count(rules_recap, "难度说明") == roll_event_count
    assert detail_count(rules_recap, "失败后果") == roll_event_count
    story_recap = section_text(battle_text, "## Story Recap")
    assert has_cjk(story_recap)
    assert "session-1:" not in story_recap
    feedback = section_text(battle_text, "## Player Feedback On KP")
    assert has_cjk(feedback)
    assert_feedback_labels_localized(
        feedback,
        ["KP 清晰度: 5", "沉浸感: 4", "模组忠实度: 4", "战斗可读性: 4"],
        ["kp_clarity:", "immersion:", "module_fidelity:", "combat_readability:"],
    )
    assert "清单" in feedback
    assert "checklist" not in feedback
    assert "playtest" not in feedback
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
    bout_visible_sections = "\n".join(
        section_text(battle_text, heading)
        for heading in ["## Scene-by-Scene Replay", "## Actual Play Replay", "## Session Transcript", "## Sanity Summary"]
    )
    assert "疯狂发作" in bout_visible_sections
    assert "Bout of Madness" not in bout_visible_sections
    assert "1D10 回合" in battle_text
    assert "1D10 掷出 4，所以持续 4 回合" in battle_text
    assert "艾达·金在临时疯狂中把左轮丢到地下室角落" in battle_text
    assert "Bout duration rolls: 1" in audit_text
    assert "战斗轮" in battle_text
    assert "combat round" not in combat_summary
    assert "- KP:" not in combat_summary
    assert "ada-king-haunting:" not in combat_summary
    assert "- 艾达·金:" not in combat_summary
    assert "艾达·金: 艾达·金" not in combat_summary
    assert "- 艾达·金用借助外套战技抓住浮空匕首" in combat_summary
    assert "in a 战斗轮" not in combat_summary
    assert "DEX order" not in combat_summary
    assert "opposed POW" not in combat_summary
    assert "DEX 顺序" in combat_summary
    assert "POW 对抗" in combat_summary
    sanity_summary = section_text(battle_text, "## Sanity Summary")
    assert "- KP:" not in sanity_summary
    assert "ada-king-haunting:" not in sanity_summary
    assert_player_readable_actor_colon_prefixes_absent(sanity_summary, ["艾达·金"])
    assert "艾达·金: 艾达·金" not in sanity_summary
    assert "- 艾达·金因床铺袭击失败 SAN 1/1D4" in sanity_summary
    assert "- 科比特起身时艾达·金失败 SAN 1/1D8" in sanity_summary
    assert "- 疯狂发作：艾达·金在临时疯狂中把左轮丢到地下室角落" in sanity_summary
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
    assert "模组忠实度: 4" in battle_text
    assert "No combat summary recorded." not in battle_text
    chase_summary = section_text(battle_text, "## Chase Summary")
    assert "- KP:" not in chase_summary
    assert "本模组不包含必需追逐场景" in chase_summary
    assert "追逐子系统覆盖留到独立场景" in chase_summary
    assert "本模组不包含必需追逐场景（本模组不包含必需追逐场景）" not in chase_summary
    assert "The Haunting does not include a required chase sequence" not in chase_summary
    assert "chase subsystem coverage deferred to separate scenario" not in chase_summary
    assert "No chase summary recorded." not in battle_text
    assert "Session ending not recorded." not in battle_text
    clues_found = section_text(battle_text, "## Clues Found")
    assert_player_readable_state_ids_absent(
        clues_found,
        ["globe-clipping", "chapel-journal", "corbitt-dagger", "own-weapon-clue"],
    )
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
    assert_zh_hans_locale(metadata, zh_terms | visible_scene_terms | ZH_SKILL_TERMS)
    assert metadata["localized_terms"]["zh-Hans"]["Antiquarian"] == "古物学者"
    assert_localized_report_shell(battle_text)
    run_setup = section_text(battle_text, "## Run Setup")
    assert "- Play Language: zh-Hans" in run_setup
    assert "Localized Terms: " in run_setup
    assert_run_setup_values_localized(run_setup, "鲁莽调查员")
    assert "Ada King -> 艾达·金" not in run_setup
    assert "Nathaniel Crowe -> 内森尼尔·克劳" not in run_setup
    assert "ledger -> 账本" not in run_setup
    assert len(run_setup.splitlines()) <= 10
    localization_appendix = section_text(battle_text, "## Localization Appendix")
    assert "Ada King -> 艾达·金" in localization_appendix
    assert "Nathaniel Crowe -> 内森尼尔·克劳" in localization_appendix
    assert "ledger -> 账本" in localization_appendix
    module_section = section_text(battle_text, "## Module")
    assert_module_metadata_values_localized(
        run_setup,
        module_section,
        campaign="屋顶追逐演练",
        scenario="屋顶追逐演练",
        source="基于《守秘人规则书》第 7 章：追逐的内部演练",
        forbidden=[
            "Campaign: Rooftop Chase Drill",
            "Scenario: Rooftop Chase Drill",
            "internal drill based on Keeper Rulebook Chapter 7: Chases",
        ],
    )
    assert "- Opening Scene: 艾达·金" in battle_text
    assert "艾达·金发现内森尼尔·克劳带着账本离开印刷店" in module_section
    assert "ledger" not in module_section
    assert "spots" not in module_section
    assert "leaving" not in module_section
    assert "- 艾达·金 (ada-king-chase)" in battle_text
    character_dossier = section_text(battle_text, "## Character Dossier")
    assert_localized_character_dossier_labels(character_dossier)
    assert "描述: 艾达·金" in character_dossier
    assert "信念/理念: 线索必须在行动前被核实" in character_dossier
    assert "重要之人: 莱兰·哈特教授" in character_dossier
    assert "重要地点: 印刷店屋顶" in character_dossier
    assert "珍贵物品: 裂柄铜放大镜" in character_dossier
    assert "特质: 观察细致" in character_dossier
    assert "Ada King" not in character_dossier
    assert "侦查: 55" in character_dossier
    assert "闪避: 35" in character_dossier
    assert "锁匠: 30" in character_dossier
    assert "潜行: 45" in character_dossier
    assert "Spot Hidden: 55" not in character_dossier
    assert "Dodge: 35" not in character_dossier
    assert "Locksmith: 30" not in character_dossier
    assert "Stealth: 45" not in character_dossier
    assert investigator_jsonl(run_dir, "ada-king-chase", "history.jsonl")
    assert investigator_jsonl(run_dir, "ada-king-chase", "development.jsonl")
    chronicle = section_text(battle_text, "## Investigator Chronicle")
    assert_localized_chronicle_labels(chronicle)
    assert "艾达·金带着邪教账本逃脱" in chronicle
    assert "最终 HP: 12" in chronicle
    assert "最终 SAN: 55" in chronicle
    assert "获得成长标记: 侦查; 闪避; 锁匠; 潜行" in chronicle
    assert "继承备注: 账本线索可带入后续模组" in chronicle
    assert "## Scene-by-Scene Replay" in battle_text
    scene_replay = section_text(battle_text, "## Scene-by-Scene Replay")
    assert has_cjk(scene_replay)
    assert bullet_count(scene_replay) >= significant_scene_replay_count(run_dir)
    assert_player_readable_state_ids_absent(scene_replay, ["print-shop-roof", "ledger-clue"])
    assert_player_readable_event_prefixes_absent(scene_replay, ["chase", "session ending"])
    assert "ada-king-chase -" not in scene_replay
    assert_player_readable_actor_dash_prefixes_absent(scene_replay, ["艾达·金"])
    assert "艾达·金在印刷店屋顶发现内森尼尔·克劳" in scene_replay
    assert "艾达·金的闪避成功，穿过湿滑天窗且没有损失移动行动。" in scene_replay
    assert "艾达·金用锁匠通过上锁屋顶门障碍，到达晾衣屋顶。" in scene_replay
    assert "艾达·金的潜行胜过内森尼尔·克劳失败的侦查，带着账本结束追逐。" in scene_replay
    assert "湿滑天窗" in scene_replay
    assert_terms_absent(scene_replay, ["print shop roof", "print-shop roof", "rain gutter", "locked roof door barrier", "slick 天窗"])
    assert "## Actual Play Replay" in battle_text
    actual_play = section_text(battle_text, "## Actual Play Replay")
    assert_visible_terms_localized(actual_play, zh_terms)
    assert_localized_transcript_chrome(actual_play)
    assert_transcript_detail_values_localized(
        actual_play,
        ["确认被偷走的账本", "推骰确认账本", "建立追逐", "通过障碍并躲藏"],
        ["spot the stolen ledger", "push ledger confirmation", "chase_setup", "pass barrier and hide"],
    )
    assert "第 4 轮 系统: 侦查：艾达·金掷出 82 / 55，结果失败。" in actual_play
    assert "第 9 轮 系统: CON：艾达·金掷出 42 / 55，结果成功。MOV 保持 8。" in actual_play
    assert "第 18 轮 系统: 闪避：艾达·金掷出 19 / 35，结果普通成功；格斗（斗殴）：内森尼尔·克劳掷出 62 / 45，结果失败。内森尼尔·克劳的短棍攻击落空。" in actual_play
    assert "第 20 轮 系统: 锁匠：艾达·金掷出 21 / 30，结果普通成功；潜行：艾达·金掷出 18 / 45，结果困难成功；侦查：内森尼尔·克劳掷出 77 / 40，结果失败。艾达·金带着账本逃脱。" in actual_play
    assert "Pushed Spot Hidden 33" not in actual_play
    assert "MOV remains" not in actual_play
    assert "extreme_success" not in actual_play
    session_transcript = section_text(battle_text, "## Session Transcript")
    assert_localized_transcript_chrome(session_transcript)
    assert_transcript_detail_values_localized(
        session_transcript,
        ["确认被偷走的账本", "推骰确认账本", "建立追逐", "通过障碍并躲藏"],
        ["spot the stolen ledger", "push ledger confirmation", "chase_setup", "pass barrier and hide"],
    )
    assert "第 4 轮 系统: 侦查：艾达·金掷出 82 / 55，结果失败。" in session_transcript
    assert "第 9 轮 系统: CON：艾达·金掷出 42 / 55，结果成功。MOV 保持 8。" in session_transcript
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
    assert "侦查：艾达·金掷出 82 / 55，结果失败。" in rules_recap
    assert "CON：艾达·金掷出 42 / 55，结果成功。" in rules_recap
    assert "CON：内森尼尔·克劳掷出 9 / 50，结果极难成功。" in rules_recap
    assert "速度检定" in rules_recap
    assert "移动行动" in rules_recap
    assert "被追者逃脱" in rules_recap
    assert "邪教账本" in rules_recap
    assert "确认内森尼尔·克劳行动前是否带着邪教账本" in rules_recap
    assert "步行追逐使用 CON 作为速度检定" in rules_recap
    assert "艾达·金的 MOV 会在本次追逐中降低 1" in rules_recap
    assert "推骰：是" in rules_recap
    assert "成长标记：是" in rules_recap
    assert "成长标记：否" in rules_recap
    assert "Spot Hidden：" not in rules_recap
    assert "Dodge：" not in rules_recap
    assert "Locksmith：" not in rules_recap
    assert "Stealth：" not in rules_recap
    assert "confirm " not in rules_recap
    assert "before acting" not in rules_recap
    assert "On-foot chases" not in rules_recap
    assert " would " not in rules_recap
    assert "Goal:" not in rules_recap
    assert "Failure Consequence:" not in rules_recap
    assert "推骰：yes" not in rules_recap
    assert "成长标记：yes" not in rules_recap
    assert "成长标记：no" not in rules_recap
    assert "ada-king-chase rolled" not in rules_recap
    assert "nathaniel-crowe rolled" not in rules_recap
    roll_event_count = len(campaign_roll_events(run_dir))
    assert bullet_count(rules_recap) == roll_event_count
    assert detail_count(rules_recap, "目的") == roll_event_count
    assert detail_count(rules_recap, "难度说明") == roll_event_count
    assert detail_count(rules_recap, "失败后果") == roll_event_count
    story_recap = section_text(battle_text, "## Story Recap")
    assert has_cjk(story_recap)
    assert "session-1:" not in story_recap
    assert "屋顶追逐" in story_recap
    assert "rooftop 追逐" not in story_recap
    feedback = section_text(battle_text, "## Player Feedback On KP")
    assert has_cjk(feedback)
    assert_feedback_labels_localized(
        feedback,
        ["KP 清晰度: 5", "追逐可读性: 5", "沉浸感: 4"],
        ["kp_clarity:", "chase_readability:", "immersion:"],
    )
    assert "规则裁定" in feedback
    assert "rule decisions" not in feedback
    assert "escapes" not in feedback
    assert "逃脱" in feedback
    assert "save/chase.json" in battle_text
    assert "save/追逐.json" not in battle_text
    assert "Chase Summary" in battle_text
    chase_summary = section_text(battle_text, "## Chase Summary")
    assert "- KP:" not in chase_summary
    assert "ada-king-chase:" not in chase_summary
    assert_player_readable_actor_colon_prefixes_absent(chase_summary, ["艾达·金"])
    assert "- 艾达·金的闪避成功，穿过湿滑天窗且没有损失移动行动。" in chase_summary
    assert "- 艾达·金用锁匠通过上锁屋顶门障碍，到达晾衣屋顶。" in chase_summary
    assert "- 艾达·金的潜行胜过内森尼尔·克劳失败的侦查，带着账本结束追逐。" in chase_summary
    assert "## Chase Tracker" in battle_text
    chase_tracker = section_text(battle_text, "## Chase Tracker")
    assert "- 追逐 ID: rooftop-chase" in chase_tracker
    assert "- 状态: 已解决" in chase_tracker
    assert "- 当前轮数: 2" in chase_tracker
    assert "- DEX 顺序: 内森尼尔·克劳 (nathaniel-crowe) -> 艾达·金 (ada-king-chase)" in chase_tracker
    assert "- 参与者:" in chase_tracker
    assert "- 艾达·金 (ada-king-chase) | 被追者 | MOV 8 -> 8 | DEX 50 | 移动行动 1 | 位置 晾衣屋顶 (laundry-roof)" in chase_tracker
    assert "- 内森尼尔·克劳 (nathaniel-crowe) | 追赶者 | MOV 8 -> 9 | DEX 60 | 移动行动 2 | 位置 上锁屋顶门 (locked-roof-door)" in chase_tracker
    assert "- 位置链:" in chase_tracker
    assert "- 印刷店屋顶 (print-shop-roof) [起点]" in chase_tracker
    assert "- 湿滑天窗 (slick-skylight) [危险点, 普通, 闪避]" in chase_tracker
    assert "- 上锁屋顶门 (locked-roof-door) [障碍, 普通, 锁匠]" in chase_tracker
    assert "- 轮次:" in chase_tracker
    assert "- 第 1 轮:" in chase_tracker
    assert "- 第 2 轮:" in chase_tracker
    assert "内森尼尔·克劳有 2 个移动行动" in chase_tracker
    assert "艾达·金花费 1 个行动穿过湿滑天窗危险点" in chase_tracker
    assert "- 结果: 被追者逃脱" in chase_tracker
    assert "Status: resolved" not in chase_tracker
    assert " | quarry | " not in chase_tracker
    assert " | pursuer | " not in chase_tracker
    assert "actions 1" not in chase_tracker
    assert "position laundry-roof" not in chase_tracker
    assert "Round 1: Nathaniel has" not in chase_tracker
    assert "Outcome: quarry escapes" not in chase_tracker
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
    clues_found = section_text(battle_text, "## Clues Found")
    assert_player_readable_state_ids_absent(clues_found, ["ledger-clue"])
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
    assert metadata["player_profile_labels"]["zh-Hans"] == {
        "careful_investigator": "谨慎调查员",
        "reckless_investigator": "鲁莽调查员",
        "skeptical_rules_lawyer": "规则质疑玩家",
    }
    assert_zh_hans_locale(metadata, {"Library Use": "图书馆使用", "Spot Hidden": "侦查"})
    actual_play = section_text(battle_text, "## Actual Play Replay")
    assert_localized_transcript_chrome(actual_play)
    assert "第 4 轮 系统: 图书馆使用：艾达·金掷出 29 / 60，结果困难成功。" in actual_play
    assert_transcript_detail_values_localized(
        actual_play,
        ["请求谨慎调查路线", "鲁莽闯入危险", "质疑 KP 裁定", "收束本轮"],
        ["request careful research route", "rush into danger", "challenge keeper ruling", "session_wrap"],
    )
    assert "玩家[谨慎调查员]" in actual_play
    assert "玩家[鲁莽调查员]" in actual_play
    assert "玩家[规则质疑玩家]" in actual_play
    assert "Player[careful_investigator]" not in actual_play
    assert "Player[reckless_investigator]" not in actual_play
    assert "Player[skeptical_rules_lawyer]" not in actual_play
    run_setup = section_text(battle_text, "## Run Setup")
    assert_run_setup_values_localized(run_setup, "多玩家画像矩阵")
    module_section = section_text(battle_text, "## Module")
    assert_module_metadata_values_localized(
        run_setup,
        module_section,
        campaign="守秘人多玩家画像压力测试",
        scenario="《鬼屋》开场压力矩阵",
        source="《克苏鲁的呼唤守秘人规则书》40周年纪念版 PDF",
        forbidden=[
            "Keeper Multi-Profile Pressure Test",
            "The Haunting Opening Pressure Matrix",
            "pdf/Call Of Cthulhu Keeper Rulebook",
        ],
    )
    assert "先查房契和旧报纸" in actual_play
    assert "我直接去二楼" in actual_play
    assert "[meta] 我想质疑一下" in actual_play
    assert "规则裁定" in actual_play
    character_dossier = section_text(battle_text, "## Character Dossier")
    assert_localized_character_dossier_labels(character_dossier)
    assert "描述: 艾达·金" in character_dossier
    assert "信念/理念: 公开记录比传闻可靠" in character_dossier
    assert "重要之人: 莱兰·哈特教授" in character_dossier
    assert "重要地点: 波士顿档案馆阅览室" in character_dossier
    assert "珍贵物品: 裂柄铜放大镜" in character_dossier
    assert "特质: 谨慎记笔记" in character_dossier
    assert "Ada King" not in character_dossier
    assert "图书馆使用: 60" in character_dossier
    assert "侦查: 55" in character_dossier
    assert "Library Use: 60" not in character_dossier
    assert "Spot Hidden: 55" not in character_dossier
    assert investigator_jsonl(run_dir, "ada-king-pressure", "history.jsonl")
    assert investigator_jsonl(run_dir, "ada-king-pressure", "development.jsonl")
    chronicle = section_text(battle_text, "## Investigator Chronicle")
    assert_localized_chronicle_labels(chronicle)
    assert "艾达·金经历了三种玩家风格压测" in chronicle
    assert "规则质疑获得独立规则解释" in chronicle
    assert "meta 质疑" not in chronicle
    assert "获得成长标记: 图书馆使用; 侦查" in chronicle
    assert "继承备注: 后续故事入口保留为沉思教堂记录" in chronicle
    scene_replay = section_text(battle_text, "## Scene-by-Scene Replay")
    assert_player_readable_state_ids_absent(
        scene_replay,
        ["knott-office", "deed-note", "fresh-scratches"],
    )
    assert_player_readable_event_prefixes_absent(scene_replay, ["session ending"])
    major_decisions = section_text(battle_text, "## Major Player Decisions")
    assert "规则质疑玩家以超游模式要求 KP 解释不同玩家风格对应的检定和风险" in major_decisions
    assert "meta 模式" not in major_decisions
    clues_found = section_text(battle_text, "## Clues Found")
    assert_player_readable_state_ids_absent(clues_found, ["deed-note", "fresh-scratches"])
    story_recap = section_text(battle_text, "## Story Recap")
    assert has_cjk(story_recap)
    assert "session-1:" not in story_recap
    assert all(has_cjk(text) for text in visible_play_texts(run_dir))
    feedback = section_text(battle_text, "## Player Feedback On KP")
    assert_feedback_labels_localized(
        feedback,
        ["KP 清晰度: 5", "自主性: 4", "超游质量: 5"],
        ["kp_clarity:", "agency:", "meta_quality:"],
    )
    assert "谨慎调查员:" in feedback
    assert "鲁莽调查员:" in feedback
    assert "规则质疑玩家:" in feedback
    assert "careful_investigator:" not in feedback
    assert "reckless_investigator:" not in feedback
    assert "skeptical_rules_lawyer:" not in feedback
    assert "No combat summary recorded." not in battle_text
    assert "No chase summary recorded." not in battle_text
    assert "No chase tracker recorded." not in battle_text
    assert "No sanity summary recorded." not in battle_text
    assert "本轮没有触发战斗场面。" in section_text(battle_text, "## Combat Summary")
    assert "本轮没有触发追逐场面。" in section_text(battle_text, "## Chase Summary")
    assert "本轮没有追逐状态需要追踪。" in section_text(battle_text, "## Chase Tracker")
    assert "本轮没有触发理智检定或疯狂事件。" in section_text(battle_text, "## Sanity Summary")
    assert not (run_dir / "artifacts" / "semantic-eval-request.json").exists()
    assert not (run_dir / "artifacts" / "semantic-eval-result.json").exists()
