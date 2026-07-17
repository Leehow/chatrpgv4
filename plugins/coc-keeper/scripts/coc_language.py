#!/usr/bin/env python3
from __future__ import annotations

import re
from copy import deepcopy
from typing import Any


DEFAULT_PLAY_LANGUAGE = "zh-Hans"

# These machine-facing abbreviations are valid visible labels on their own,
# but ordinary prose may contain the same byte sequence inside a larger word.
# ASCII boundaries keep table-label localization exact without classifying prose.
BOUNDARY_SAFE_ASCII_TERMS = frozenset({
    "STR", "CON", "SIZ", "DEX", "APP", "INT", "POW", "EDU", "SAN", "LUCK",
})

_LANGUAGE_ALIASES = {
    "de": "german",
    "de-de": "german",
    "german": "german",
    "德语": "german",
    "it": "italian",
    "it-it": "italian",
    "italian": "italian",
    "意大利语": "italian",
    "la": "latin",
    "latin": "latin",
    "拉丁语": "latin",
    "en": "english",
    "en-us": "english",
    "en-gb": "english",
    "english": "english",
    "英语": "english",
    "fi": "finnish",
    "finnish": "finnish",
    "芬兰语": "finnish",
    "sv": "swedish",
    "swedish": "swedish",
    "瑞典语": "swedish",
}


def _normalize_language_name(value: Any) -> str:
    text = str(value or "").strip().lower()
    return _LANGUAGE_ALIASES.get(text, text)


def _language_name_from_skill_key(skill_key: str) -> tuple[str | None, bool]:
    key = str(skill_key or "").strip()
    if not key:
        return None, False

    prefixes = (
        ("Language (Own:", True),
        ("Language (Other:", False),
        ("Other Language (", False),
    )
    for prefix, is_own in prefixes:
        if key.startswith(prefix) and key.endswith(")"):
            return key[len(prefix):-1].strip(), is_own

    if key.startswith("Language (") and key.endswith(")"):
        body = key[len("Language ("):-1].strip()
        if body == "Own":
            return None, True
        if body == "Other":
            return None, False
        return body, False

    return None, False


def language_skill_for_source(
    investigator: dict[str, Any] | None,
    source_language: str | None,
) -> dict[str, Any]:
    """Read an investigator's structured language skill for a source language."""
    target = _normalize_language_name(source_language)
    skills = (investigator or {}).get("skills") or {}
    best = {
        "source_language": source_language,
        "skill_key": None,
        "skill_value": 0,
        "native": False,
    }
    if not target:
        return best

    for skill_key, raw_value in skills.items():
        language_name, is_own = _language_name_from_skill_key(skill_key)
        if _normalize_language_name(language_name) != target:
            continue
        try:
            value = int(raw_value or 0)
        except (TypeError, ValueError):
            value = 0
        if value >= int(best["skill_value"]):
            best = {
                "source_language": source_language,
                "skill_key": skill_key,
                "skill_value": value,
                "native": bool(is_own and value > 0),
            }
    return best


def dialogue_comprehension_tier(skill_value: int, *, native: bool = False) -> str:
    if native or skill_value >= 50:
        return "fluent"
    if skill_value >= 20:
        return "partial"
    if skill_value >= 1:
        return "gist"
    return "none"


def _foreign_dialogue_visible_text_zh(
    source_text: str,
    tier: str,
    *,
    translation: str | None = None,
    partial_translation: str | None = None,
    gist: str | None = None,
) -> tuple[str, str | None, bool]:
    quoted = f"“{source_text}”"
    if tier == "none":
        return (
            f"{quoted}\n你听不懂具体意思，只能从语气、表情和动作判断情绪。",
            None,
            False,
        )
    if tier == "gist":
        if gist:
            return f"{quoted}\n你只能抓到零碎意思：{gist}", gist, False
        return f"{quoted}\n你只听出几个零碎词，意思仍很不稳。", None, False
    if tier == "partial":
        if partial_translation:
            return f"{quoted}\n你大概听出：{partial_translation}", partial_translation, True
        if gist:
            return f"{quoted}\n你大概听出一部分：{gist}，但细节仍不稳。", gist, False
        return f"{quoted}\n你大概听懂了一部分，但细节仍不稳。", None, False
    if translation:
        return f"{quoted}\n你听懂了：{translation}", translation, True
    return f"{quoted}\n你听懂了这句话。", None, False


def render_foreign_dialogue_for_investigator(
    *,
    source_text: str,
    source_language: str,
    investigator: dict[str, Any] | None,
    translation: str | None = None,
    partial_translation: str | None = None,
    gist: str | None = None,
    play_language: str = DEFAULT_PLAY_LANGUAGE,
) -> dict[str, Any]:
    """Render NPC dialogue through the investigator's structured language skill.

    This helper does not translate source text. It only decides whether a
    Keeper/semantic layer supplied translation, partial translation, or gist is
    player-visible for this investigator.
    """
    skill = language_skill_for_source(investigator, source_language)
    skill_value = int(skill["skill_value"])
    tier = dialogue_comprehension_tier(skill_value, native=bool(skill["native"]))

    if play_language == "zh-Hans":
        visible_text, understood_text, translation_visible = _foreign_dialogue_visible_text_zh(
            source_text,
            tier,
            translation=translation,
            partial_translation=partial_translation,
            gist=gist,
        )
    else:
        quoted = f"\"{source_text}\""
        if tier == "none":
            visible_text, understood_text, translation_visible = (
                f"{quoted}\nYou do not understand the exact words; only tone and body language carry through.",
                None,
                False,
            )
        elif tier == "gist":
            understood_text = gist
            visible_text = f"{quoted}\nYou catch only fragments: {gist}" if gist else f"{quoted}\nYou catch only fragments."
            translation_visible = False
        elif tier == "partial":
            understood_text = partial_translation or gist
            visible_text = (
                f"{quoted}\nYou roughly make out: {understood_text}"
                if understood_text else f"{quoted}\nYou understand part of it, but not reliably."
            )
            translation_visible = bool(partial_translation)
        else:
            understood_text = translation
            visible_text = f"{quoted}\nYou understand: {translation}" if translation else f"{quoted}\nYou understand the sentence."
            translation_visible = bool(translation)

    return {
        "source_language": source_language,
        "source_text": source_text,
        "skill_key": skill["skill_key"],
        "skill_value": skill_value,
        "native": skill["native"],
        "comprehension": tier,
        "understood_text": understood_text,
        "translation_visible": translation_visible,
        "visible_text": visible_text,
    }

BASE_REPORT_LABELS = {
    "roll_sentence": "- {skill}: {actor} rolled {roll} vs {target} -> {outcome}",
    "die_roll_sentence": "- {skill}: {actor} rolled {die} = {roll} ({breakdown}) -> {outcome}",
    "die_face": "die roll",
    "fixed_modifier": "fixed modifier",
    "roll_breakdown_separator": "; ",
    "difficulty": "Difficulty",
    "goal": "Goal",
    "difficulty_rationale": "Difficulty Rationale",
    "failure_consequence": "Failure Consequence",
    "pushed_roll": "Pushed Roll",
    "push_justification": "Push Justification",
    "foreshadowed_failure": "Foreshadowed Failure",
    "skill_check_earned": "Skill Check Earned",
    "san_loss": "SAN Loss",
    "san_change": "SAN Change",
    "rule_refs": "Rule Refs",
    "yes": "yes",
    "no": "no",
    "localized_terms_summary": "{count} entries (recorded in playtest.json)",
    "feedback_line": "- {category} {score}/5: {voice}: \"{text}\"",
    "feedback_voice_default": "Player feedback",
    "feedback_voice_profile": "{profile} feedback",
}

BASE_EMPTY_REPORT_LINES = {
    "combat_summary": "- No combat summary recorded.",
    "combat_tracker": "- No combat tracker recorded.",
    "chase_summary": "- No chase summary recorded.",
    "chase_tracker": "- No chase tracker recorded.",
    "sanity_summary": "- No sanity summary recorded.",
}

BASE_SPEAKER_LABELS = {
    "keeper": "KP",
    "player": "Player",
    "single_player": "Single Player",
    "system": "system",
}

BASE_TRANSCRIPT_LABELS = {
    "turn_format": "Turn {turn}",
    "mode": "Mode",
    "intent": "Intent",
    "ruling": "Ruling",
}

BASE_TRANSCRIPT_MODE_LABELS = {
    "play": "play",
    "roll": "roll",
    "meta": "meta",
}

BASE_REPORT_HEADING_LABELS = {
    "Battle Report": "Battle Report",
    "Run Setup": "Run Setup",
    "Module": "Module",
    "Handouts": "Handouts",
    "Investigator Creation": "Investigator Creation",
    "Character Dossier": "Character Dossier",
    "Final Recorded State": "Final Recorded State",
    "Investigator Chronicle": "Investigator Chronicle",
    "Scene-by-Scene Replay": "Scene-by-Scene Replay",
    "Actual Play Replay": "Actual Play Replay",
    "Session Transcript": "Session Transcript",
    "Major Player Decisions": "Major Player Decisions",
    "Rules & Rolls Recap": "Rules & Rolls Recap",
    "Mechanical Log": "Mechanical Log",
    "Important Rolls": "Important Rolls",
    "State Changes": "State Changes",
    "Combat Summary": "Combat Summary",
    "Chase Summary": "Chase Summary",
    "Chase Tracker": "Chase Tracker",
    "Sanity Summary": "Sanity Summary",
    "Clues Found": "Clues Found",
    "Session Ending": "Session Ending",
    "Story Recap": "Story Recap",
    "Player Feedback On KP": "Player Feedback On KP",
    "Localization Appendix": "Localization Appendix",
    "Combat Tracker": "Combat Tracker",
    "Epistemic Experience": "Epistemic Experience",
    "Tool Reliability": "Tool Reliability",
    "Narrative Adherence": "Narrative Route Coverage (Not Ending Outcome)",
}

BASE_REPORT_FIELD_LABELS = {
    "Run ID": "Run ID",
    "Campaign ID": "Campaign ID",
    "Campaign": "Campaign",
    "Audit Profile": "Audit Profile",
    "Simulation Method": "Simulation Method",
    "Era": "Era",
    "Dice Mode": "Dice Mode",
    "Spoiler Policy": "Spoiler Policy",
    "Play Language": "Play Language",
    "Language Profile": "Language Profile",
    "Localized Terms": "Localized Terms",
    "Player Profile": "Player Profile",
    "Scenario": "Scenario",
    "Scenario ID": "Scenario ID",
    "Source": "Source",
    "Opening Scene": "Opening Scene",
}

BASE_REPORT_VALUE_LABELS = {
    "baseline": "baseline",
    "rulebook_smoke": "rulebook_smoke",
    "haunting_module": "haunting_module",
    "chase_drill": "chase_drill",
    "multi_profile_pressure": "multi_profile_pressure",
    "transcript_driven_virtual_table": "transcript_driven_virtual_table",
    "codex": "codex",
    "warn_before_reveal": "warn_before_reveal",
    "Simplified Chinese": "Simplified Chinese",
    "English": "English",
    "Japanese": "Japanese",
    "careful_investigator": "careful_investigator",
    "reckless_investigator": "reckless_investigator",
    "skeptical_rules_lawyer": "skeptical_rules_lawyer",
    "multi_profile_matrix": "multi_profile_matrix",
}

BASE_CHARACTER_DOSSIER_LABELS = {
    "Player": "Player",
    "Occupation": "Occupation",
    "Era": "Era",
    "Characteristics": "Characteristics",
    "Characteristic Half/Fifth Values": "Characteristic Half/Fifth Values",
    "Derived": "Derived",
    "damage_bonus": "DB",
    "build": "Build",
    "Skills": "Skills",
    "Skill Half/Fifth Values": "Skill Half/Fifth Values",
    "Backstory": "Backstory",
    "Description": "Description",
    "Ideology/Beliefs": "Ideology/Beliefs",
    "Traits Detail": "Traits Detail",
    "Significant People": "Significant People",
    "Meaningful Locations": "Meaningful Locations",
    "Treasured Possessions": "Treasured Possessions",
    "Traits": "Traits",
    "Injuries & Scars": "Injuries & Scars",
    "Phobias & Manias": "Phobias & Manias",
}

BASE_CREATION_LABELS = {
    "Rulebook Source": "Rulebook Source",
    "Method": "Method",
    "Rulebook Steps": "Rulebook Steps",
    "Characteristics": "Characteristics",
    "Characteristic Half/Fifth Values": "Characteristic Half/Fifth Values",
    "Age": "Age",
    "Age Adjustments": "Age Adjustments",
    "Derived Attributes": "Derived Attributes",
    "Occupation": "Occupation",
    "Occupation Skill Points": "Occupation Skill Points",
    "Personal Interest Skill Points": "Personal Interest Skill Points",
    "Credit Rating": "Credit Rating",
    "Rulebook Occupation Range": "rulebook occupation range",
    "Living Standard": "Living Standard",
    "Cash": "Cash",
    "Assets": "Assets",
    "Spending Level": "Spending Level",
    "Skill Allocation": "Skill Allocation",
    "Skill Half/Fifth Values": "Skill Half/Fifth Values",
    "Base": "Base",
    "Personal Interest": "Personal Interest",
    "Unallocated": "Unallocated",
    "Backstory": "Backstory",
    "Equipment": "Equipment",
    "Notes": "Notes",
    "standard_rulebook_chapter_3": "standard rulebook Chapter 3",
    "Call of Cthulhu Keeper Rulebook Chapter 3": "Call of Cthulhu Keeper Rulebook Chapter 3",
}

BASE_CHRONICLE_LABELS = {
    "History": "History",
    "Development": "Development",
    "Inventory History": "Inventory History",
    "Final HP": "Final HP",
    "Final SAN": "Final SAN",
    "Notable Events": "Notable Events",
    "Unresolved Threads": "Unresolved Threads",
    "Development Entry": "Development Entry",
    "Development Check Earned": "Development Check Earned",
    "Development Phase Summary": "Development Phase Summary",
    "Status": "Status",
    "Roll": "Roll",
    "Source Kind": "Source Kind",
    "Source Event": "Source Event",
    "earned": "earned",
    "Skill Checks Earned": "Skill Checks Earned",
    "Rewards": "Rewards",
    "Permanent Changes": "Permanent Changes",
    "Carryover Notes": "Carryover Notes",
    "Items": "Items",
    "Cash": "Cash",
    "Notes": "Notes",
    "pending_player_rolls": "pending_player_rolls",
}

BASE_FEEDBACK_LABELS = {
    "kp_clarity": "kp_clarity",
    "rules_helpfulness": "rules_helpfulness",
    "immersion": "immersion",
    "pacing": "pacing",
    "fairness": "fairness",
    "agency": "agency",
    "meta_quality": "meta_quality",
    "spoiler_safety": "spoiler_safety",
    "module_fidelity": "module_fidelity",
    "combat_readability": "combat_readability",
    "chase_readability": "chase_readability",
}

BASE_CHASE_TRACKER_LABELS = {
    "Chase ID": "Chase ID",
    "State File": "State File",
    "Status": "Status",
    "Round": "Round",
    "DEX order": "DEX order",
    "Participants": "Participants",
    "Location Chain": "Location Chain",
    "Rounds": "Rounds",
    "Outcome": "Outcome",
    "movement_actions": "actions",
    "position": "position",
    "round_format": "Round {round}",
    "start": "start",
    "clear": "clear",
    "hazard": "hazard",
    "barrier": "barrier",
    "escape": "escape",
    "quarry": "quarry",
    "pursuer": "pursuer",
    "resolved": "resolved",
}

LANGUAGE_PROFILES: dict[str, dict[str, Any]] = {
    "zh-Hans": {
        "language": "zh-Hans",
        "display_name": "Simplified Chinese",
        "output_instruction": "Use Simplified Chinese for player-visible narration, table dialogue, recaps, and reports.",
        "name_policy": "Foreign names should use Chinese transliterations or conventional translated names.",
        "term_policy": "Use localized_terms.zh-Hans for people, places, factions, handouts, campaign titles, scenario titles, player-visible module source labels, player-visible skill display names, and special terms.",
        "report_labels": {
            "roll_sentence": "- {skill}：{actor}掷出 {roll} / {target}，结果{outcome}。",
            "die_roll_sentence": "- {skill}：{actor}掷出 {die} = {roll}（{breakdown}），结果{outcome}。",
            "die_face": "骰面",
            "fixed_modifier": "固定加值",
            "roll_breakdown_separator": "；",
            "difficulty": "难度",
            "goal": "目的",
            "difficulty_rationale": "难度说明",
            "failure_consequence": "失败后果",
            "pushed_roll": "推骰",
            "push_justification": "推骰理由",
            "foreshadowed_failure": "预告失败后果",
            "skill_check_earned": "成长标记",
            "san_loss": "SAN 损失",
            "san_change": "SAN 变化",
            "rule_refs": "规则引用",
            "yes": "是",
            "no": "否",
            "localized_terms_summary": "{count} 条（记录于 playtest.json）",
            "feedback_line": "- {category} {score}/5：{voice}：“{text}”",
            "feedback_voice_default": "玩家反馈",
            "feedback_voice_profile": "{profile}反馈",
        },
        "report_heading_labels": {
            "Battle Report": "跑团战报",
            "Run Setup": "运行设置",
            "Module": "模组",
            "Handouts": "线索资料",
            "Investigator Creation": "角色创建记录",
            "Character Dossier": "角色档案",
            "Final Recorded State": "最终记录状态",
            "Investigator Chronicle": "调查员经历",
            "Scene-by-Scene Replay": "逐场景回放",
            "Actual Play Replay": "实际跑团回放",
            "Session Transcript": "会话记录",
            "Major Player Decisions": "玩家关键决定",
            "Rules & Rolls Recap": "规则与掷骰回顾",
            "Mechanical Log": "机制日志",
            "Important Rolls": "重要掷骰",
            "State Changes": "状态变化",
            "Combat Summary": "战斗摘要",
            "Chase Summary": "追逐摘要",
            "Chase Tracker": "追逐追踪器",
            "Sanity Summary": "理智摘要",
            "Clues Found": "已发现线索",
            "Session Ending": "本次结局",
            "Story Recap": "剧情回顾",
            "Player Feedback On KP": "玩家对 KP 的反馈",
            "Localization Appendix": "本地化附录",
            "Combat Tracker": "战斗追踪器",
            "Epistemic Experience": "认知体验诊断",
            "Tool Reliability": "工具可靠性（诊断）",
            "Narrative Adherence": "叙事路径覆盖（非结局判定）",
        },
        "report_field_labels": {
            "Run ID": "运行编号",
            "Campaign ID": "战役 ID",
            "Campaign": "战役",
            "Audit Profile": "审计画像",
            "Simulation Method": "模拟方式",
            "Era": "年代",
            "Dice Mode": "骰子模式",
            "Spoiler Policy": "剧透策略",
            "Play Language": "游玩语言",
            "Language Profile": "语言配置",
            "Localized Terms": "本地化术语",
            "Player Profile": "游玩风格",
            "Scenario": "模组",
            "Scenario ID": "模组 ID",
            "Source": "来源",
            "Opening Scene": "开场场景",
        },
        "report_value_labels": {
            "baseline": "基线测试",
            "rulebook_smoke": "规则书冒烟测试",
            "haunting_module": "《鬼屋》完整模组审计",
            "chase_drill": "追逐规则演练",
            "multi_profile_pressure": "单人多风格压测",
            "transcript_driven_virtual_table": "转录驱动虚拟桌面",
            "codex": "Codex 掷骰",
            "warn_before_reveal": "剧透前警告",
            "Simplified Chinese": "简体中文",
            "English": "英语",
            "Japanese": "日语",
            "careful_investigator": "谨慎风格",
            "reckless_investigator": "鲁莽风格",
            "skeptical_rules_lawyer": "规则质疑风格",
            "multi_profile_matrix": "单人多风格开局",
        },
        "character_dossier_labels": {
            "Player": "玩家",
            "Occupation": "职业",
            "Era": "年代",
            "Characteristics": "属性",
            "Characteristic Half/Fifth Values": "属性半值/五分之一",
            "Derived": "衍生值",
            "damage_bonus": "DB",
            "build": "体格",
            "Skills": "技能",
            "Skill Half/Fifth Values": "技能半值/五分之一",
            "Backstory": "背景",
            "Description": "描述",
            "Ideology/Beliefs": "信念/理念",
            "Traits Detail": "特质详情",
            "Significant People": "重要之人",
            "Meaningful Locations": "重要地点",
            "Treasured Possessions": "珍贵物品",
            "Traits": "特质",
            "Injuries & Scars": "伤疤与伤势",
            "Phobias & Manias": "恐惧与躁狂",
        },
        "creation_labels": {
            "Rulebook Source": "规则书来源",
            "Method": "创建方法",
            "Rulebook Steps": "规则书步骤",
            "Characteristics": "生成属性",
            "Characteristic Half/Fifth Values": "属性半值/五分之一",
            "Age": "年龄",
            "Age Adjustments": "年龄调整",
            "Derived Attributes": "衍生值",
            "Occupation": "职业",
            "Occupation Skill Points": "职业技能点",
            "Personal Interest Skill Points": "个人兴趣技能点",
            "Credit Rating": "信用评级",
            "Rulebook Occupation Range": "规则书职业范围",
            "Living Standard": "生活水平",
            "Cash": "现金",
            "Assets": "资产",
            "Spending Level": "消费水平",
            "Skill Allocation": "技能分配",
            "Skill Half/Fifth Values": "技能半值/五分之一",
            "Base": "基础",
            "Personal Interest": "个人兴趣",
            "Unallocated": "未分配",
            "Backstory": "背景",
            "Equipment": "装备",
            "Notes": "备注",
            "standard_rulebook_chapter_3": "规则书第 3 章标准创建",
            "Call of Cthulhu Keeper Rulebook Chapter 3": "《克苏鲁的呼唤守秘人规则书》第 3 章",
        },
        "chronicle_labels": {
            "History": "经历",
            "Development": "成长",
            "Inventory History": "物品经历",
            "Final HP": "最终 HP",
            "Final SAN": "最终 SAN",
            "Notable Events": "重要事件",
            "Unresolved Threads": "未解线索",
            "Development Entry": "成长条目",
            "Development Check Earned": "已获得成长标记",
            "Development Phase Summary": "成长阶段摘要",
            "Status": "状态",
            "Roll": "骰值",
            "Source Kind": "来源类型",
            "Source Event": "来源事件",
            "earned": "已获得",
            "Skill Checks Earned": "获得成长标记",
            "Rewards": "奖励",
            "Permanent Changes": "永久变化",
            "Carryover Notes": "继承备注",
            "Items": "物品",
            "Cash": "现金",
            "Notes": "备注",
            "pending_player_rolls": "等待玩家成长检定",
        },
        "feedback_labels": {
            "kp_clarity": "KP 清晰度",
            "rules_helpfulness": "规则帮助度",
            "immersion": "沉浸感",
            "pacing": "节奏",
            "fairness": "公平性",
            "agency": "自主性",
            "meta_quality": "超游质量",
            "spoiler_safety": "剧透安全",
            "module_fidelity": "模组忠实度",
            "combat_readability": "战斗可读性",
            "chase_readability": "追逐可读性",
        },
        "chase_tracker_labels": {
            "Chase ID": "追逐 ID",
            "State File": "状态文件",
            "Status": "状态",
            "Round": "当前轮数",
            "DEX order": "DEX 顺序",
            "Participants": "参与者",
            "Location Chain": "位置链",
            "Rounds": "轮次",
            "Outcome": "结果",
            "movement_actions": "移动行动",
            "position": "位置",
            "round_format": "第 {round} 轮",
            "start": "起点",
            "clear": "通路",
            "hazard": "危险点",
            "barrier": "障碍",
            "escape": "逃脱点",
            "quarry": "被追者",
            "pursuer": "追赶者",
            "resolved": "已解决",
        },
        "empty_report_lines": {
            "combat_summary": "- 本轮没有触发战斗场面。",
            "combat_tracker": "- 本轮没有战斗状态需要追踪。",
            "chase_summary": "- 本轮没有触发追逐场面。",
            "chase_tracker": "- 本轮没有追逐状态需要追踪。",
            "sanity_summary": "- 本轮没有触发理智检定或疯狂事件。",
        },
        "speaker_labels": {
            "keeper": "KP",
            "player": "玩家",
            "single_player": "单人玩家",
            "system": "系统",
        },
        "transcript_labels": {
            "turn_format": "第 {turn} 轮",
            "mode": "模式",
            "intent": "意图",
            "ruling": "裁定",
        },
        "transcript_mode_labels": {
            "play": "游玩",
            "roll": "掷骰",
            "meta": "超游",
        },
        "outcome_labels": {
            "critical": "大成功",
            "extreme": "极难成功",
            "extreme_success": "极难成功",
            "hard": "困难成功",
            "hard_success": "困难成功",
            "regular": "普通成功",
            "regular_success": "普通成功",
            "success": "成功",
            "failure": "失败",
            "fumble": "大失败",
            "damage_applied": "造成伤害",
            "healing_applied": "恢复生命",
            "reward_applied": "获得奖励",
            "applied": "已生效",
        },
        "difficulty_labels": {
            "regular": "普通",
            "hard": "困难",
            "extreme": "极难",
            "opposed": "对抗",
            "combined": "联合",
            "sanity": "理智",
            "damage": "伤害",
            "reward": "奖励",
        },
        "raw_payload_fallback": False,
    },
    "en-US": {
        "language": "en-US",
        "display_name": "English",
        "output_instruction": "Use English for player-visible narration, table dialogue, recaps, and reports.",
        "name_policy": "Use customary English names and established scenario terminology.",
        "term_policy": "Use localized_terms.en-US for player-visible aliases and skill display names when the source term needs an English table form.",
        "report_labels": BASE_REPORT_LABELS,
        "report_heading_labels": BASE_REPORT_HEADING_LABELS,
        "report_field_labels": BASE_REPORT_FIELD_LABELS,
        "report_value_labels": BASE_REPORT_VALUE_LABELS,
        "character_dossier_labels": BASE_CHARACTER_DOSSIER_LABELS,
        "creation_labels": BASE_CREATION_LABELS,
        "chronicle_labels": BASE_CHRONICLE_LABELS,
        "feedback_labels": BASE_FEEDBACK_LABELS,
        "chase_tracker_labels": BASE_CHASE_TRACKER_LABELS,
        "empty_report_lines": BASE_EMPTY_REPORT_LINES,
        "speaker_labels": BASE_SPEAKER_LABELS,
        "transcript_labels": BASE_TRANSCRIPT_LABELS,
        "transcript_mode_labels": BASE_TRANSCRIPT_MODE_LABELS,
        "outcome_labels": {},
        "difficulty_labels": {},
        "raw_payload_fallback": True,
    },
    "ja-JP": {
        "language": "ja-JP",
        "display_name": "Japanese",
        "output_instruction": "Use Japanese for player-visible narration, table dialogue, recaps, and reports.",
        "name_policy": "Foreign names should use customary Japanese katakana forms or established translated names.",
        "term_policy": "Use localized_terms.ja-JP for people, places, factions, handouts, campaign titles, scenario titles, player-visible module source labels, player-visible skill display names, and special terms.",
        "report_labels": {
            "roll_sentence": "- {skill}：{actor}は {roll} / {target} を振り、結果は{outcome}。",
            "die_roll_sentence": "- {skill}：{actor}は {die} = {roll}（{breakdown}）を振り、結果は{outcome}。",
            "die_face": "出目",
            "fixed_modifier": "固定修正",
            "roll_breakdown_separator": "；",
            "difficulty": "難易度",
            "goal": "目的",
            "difficulty_rationale": "難易度の理由",
            "failure_consequence": "失敗時の結果",
            "pushed_roll": "プッシュロール",
            "push_justification": "プッシュ理由",
            "foreshadowed_failure": "失敗予告",
            "skill_check_earned": "成長チェック",
            "san_loss": "SAN 喪失",
            "san_change": "SAN 変化",
            "rule_refs": "ルール参照",
            "yes": "はい",
            "no": "いいえ",
            "localized_terms_summary": "{count} 件（playtest.json に記録）",
            "feedback_line": "- {category} {score}/5：{voice}：「{text}」",
            "feedback_voice_default": "プレイヤー感想",
            "feedback_voice_profile": "{profile}の感想",
        },
        "report_heading_labels": {
            "Battle Report": "プレイ報告",
            "Run Setup": "実行設定",
            "Module": "シナリオ",
            "Handouts": "ハンドアウト",
            "Investigator Creation": "探索者作成記録",
            "Character Dossier": "キャラクター記録",
            "Final Recorded State": "最終記録状態",
            "Investigator Chronicle": "探索者履歴",
            "Scene-by-Scene Replay": "シーン別リプレイ",
            "Actual Play Replay": "実プレイリプレイ",
            "Session Transcript": "セッション記録",
            "Major Player Decisions": "主なプレイヤー判断",
            "Rules & Rolls Recap": "ルールとロールの要約",
            "Mechanical Log": "メカニクス記録",
            "Important Rolls": "重要なロール",
            "State Changes": "状態変化",
            "Combat Summary": "戦闘要約",
            "Chase Summary": "チェイス要約",
            "Chase Tracker": "チェイス追跡",
            "Sanity Summary": "正気度要約",
            "Clues Found": "発見した手がかり",
            "Session Ending": "セッション終了",
            "Story Recap": "物語の要約",
            "Player Feedback On KP": "KP へのプレイヤーフィードバック",
            "Localization Appendix": "ローカライズ付録",
        },
        "report_field_labels": {
            "Run ID": "実行 ID",
            "Campaign ID": "キャンペーン ID",
            "Campaign": "キャンペーン",
            "Audit Profile": "監査プロファイル",
            "Simulation Method": "シミュレーション方式",
            "Era": "時代",
            "Dice Mode": "ダイス方式",
            "Spoiler Policy": "ネタバレ方針",
            "Play Language": "プレイ言語",
            "Language Profile": "言語プロファイル",
            "Localized Terms": "ローカライズ用語",
            "Player Profile": "プレイヤープロファイル",
            "Scenario": "シナリオ",
            "Scenario ID": "シナリオ ID",
            "Source": "出典",
            "Opening Scene": "導入シーン",
        },
        "report_value_labels": {
            "baseline": "ベースラインテスト",
            "rulebook_smoke": "ルールブックスモークテスト",
            "haunting_module": "『ホーンティング』全編モジュール監査",
            "chase_drill": "チェイスルールドリル",
            "multi_profile_pressure": "単独プレイヤー複数スタイル圧力テスト",
            "transcript_driven_virtual_table": "トランスクリプト駆動の仮想卓",
            "codex": "Codex ダイス",
            "warn_before_reveal": "ネタバレ前に警告",
            "Simplified Chinese": "簡体字中国語",
            "English": "英語",
            "Japanese": "日本語",
            "careful_investigator": "慎重な探索者",
            "reckless_investigator": "無謀な探索者",
            "skeptical_rules_lawyer": "ルール確認型プレイヤー",
            "multi_profile_matrix": "単独プレイヤー複数スタイル分岐",
        },
        "character_dossier_labels": {
            "Player": "プレイヤー",
            "Occupation": "職業",
            "Era": "時代",
            "Characteristics": "能力値",
            "Characteristic Half/Fifth Values": "能力値半分/五分の一",
            "Derived": "派生値",
            "damage_bonus": "DB",
            "build": "ビルド",
            "Skills": "技能",
            "Skill Half/Fifth Values": "技能半分/五分の一",
            "Backstory": "バックストーリー",
            "Description": "描写",
            "Ideology/Beliefs": "思想/信念",
            "Traits Detail": "特徴詳細",
            "Significant People": "重要人物",
            "Meaningful Locations": "重要な場所",
            "Treasured Possessions": "大切な所持品",
            "Traits": "特徴",
            "Injuries & Scars": "負傷と傷跡",
            "Phobias & Manias": "恐怖症と躁症",
        },
        "creation_labels": {
            "Rulebook Source": "ルールブック出典",
            "Method": "作成方法",
            "Rulebook Steps": "ルールブック手順",
            "Characteristics": "能力値生成",
            "Characteristic Half/Fifth Values": "能力値半分/五分の一",
            "Age": "年齢",
            "Age Adjustments": "年齢調整",
            "Derived Attributes": "派生値",
            "Occupation": "職業",
            "Occupation Skill Points": "職業技能ポイント",
            "Personal Interest Skill Points": "個人的興味技能ポイント",
            "Credit Rating": "信用",
            "Rulebook Occupation Range": "ルールブック職業範囲",
            "Living Standard": "生活水準",
            "Cash": "現金",
            "Assets": "資産",
            "Spending Level": "支出レベル",
            "Skill Allocation": "技能配分",
            "Skill Half/Fifth Values": "技能半分/五分の一",
            "Base": "基礎",
            "Personal Interest": "個人的興味",
            "Unallocated": "未配分",
            "Backstory": "背景",
            "Equipment": "装備",
            "Notes": "メモ",
            "standard_rulebook_chapter_3": "ルールブック第3章標準作成",
            "Call of Cthulhu Keeper Rulebook Chapter 3": "Call of Cthulhu Keeper Rulebook 第3章",
        },
        "chronicle_labels": {
            "History": "履歴",
            "Development": "成長",
            "Inventory History": "所持品履歴",
            "Final HP": "最終 HP",
            "Final SAN": "最終 SAN",
            "Notable Events": "主な出来事",
            "Unresolved Threads": "未解決の糸口",
            "Development Entry": "成長記録",
            "Development Check Earned": "成長チェック獲得",
            "Development Phase Summary": "成長フェイズ要約",
            "Status": "状態",
            "Roll": "ロール",
            "Source Kind": "ソース種別",
            "Source Event": "ソースイベント",
            "earned": "獲得済み",
            "Skill Checks Earned": "獲得した成長チェック",
            "Rewards": "報酬",
            "Permanent Changes": "恒久的な変化",
            "Carryover Notes": "引き継ぎメモ",
            "Items": "アイテム",
            "Cash": "現金",
            "Notes": "メモ",
            "pending_player_rolls": "プレイヤーの成長ロール待ち",
        },
        "feedback_labels": {
            "kp_clarity": "KP の明瞭さ",
            "rules_helpfulness": "ルール説明の有用性",
            "immersion": "没入感",
            "pacing": "進行速度",
            "fairness": "公平性",
            "agency": "主体性",
            "meta_quality": "メタ相談の質",
            "spoiler_safety": "ネタバレ安全性",
            "module_fidelity": "モジュール忠実度",
            "combat_readability": "戦闘の読みやすさ",
            "chase_readability": "チェイスの読みやすさ",
        },
        "chase_tracker_labels": {
            "Chase ID": "チェイス ID",
            "State File": "状態ファイル",
            "Status": "状態",
            "Round": "現在ラウンド",
            "DEX order": "DEX 順",
            "Participants": "参加者",
            "Location Chain": "ロケーション列",
            "Rounds": "ラウンド",
            "Outcome": "結果",
            "movement_actions": "移動アクション",
            "position": "位置",
            "round_format": "第 {round} ラウンド",
            "start": "開始地点",
            "clear": "通常地点",
            "hazard": "危険",
            "barrier": "障害",
            "escape": "逃走地点",
            "quarry": "逃走側",
            "pursuer": "追跡側",
            "resolved": "解決済み",
        },
        "empty_report_lines": {
            "combat_summary": "- 今回は戦闘場面は発生していない。",
            "combat_tracker": "- 今回は追跡する戦闘状態はない。",
            "chase_summary": "- 今回はチェイス場面は発生していない。",
            "chase_tracker": "- 今回は追跡するチェイス状態はない。",
            "sanity_summary": "- 今回は正気度判定や狂気イベントは発生していない。",
        },
        "speaker_labels": {
            "keeper": "KP",
            "player": "プレイヤー",
            "single_player": "単独プレイヤー",
            "system": "システム",
        },
        "transcript_labels": {
            "turn_format": "第 {turn} ターン",
            "mode": "モード",
            "intent": "意図",
            "ruling": "裁定",
        },
        "transcript_mode_labels": {
            "play": "プレイ",
            "roll": "ロール",
            "meta": "メタ",
        },
        "outcome_labels": {
            "critical": "クリティカル",
            "extreme_success": "イクストリーム成功",
            "hard_success": "ハード成功",
            "regular_success": "レギュラー成功",
            "success": "成功",
            "failure": "失敗",
            "fumble": "ファンブル",
            "damage_applied": "ダメージ適用",
            "healing_applied": "HP回復",
            "reward_applied": "報酬適用",
            "applied": "適用済み",
        },
        "difficulty_labels": {
            "regular": "レギュラー",
            "hard": "ハード",
            "extreme": "イクストリーム",
            "opposed": "対抗",
            "combined": "複合",
            "sanity": "正気度",
            "damage": "ダメージ",
            "reward": "報酬",
        },
        "raw_payload_fallback": True,
    },
}


DEFAULT_LOCALIZED_TERMS: dict[str, dict[str, str]] = {
    "zh-Hans": {
        "Accounting": "会计",
        "Appraise": "估价",
        "Charm": "魅惑",
        "Climb": "攀爬",
        "Credit Rating": "信用评级",
        "Dodge": "闪避",
        "Drive Auto": "汽车驾驶",
        "Electrical Repair": "电气维修",
        "Fast Talk": "话术",
        "Fighting": "格斗",
        "Fighting (Brawl)": "斗殴",
        "Firearms (Handgun)": "射击（手枪）",
        "Firearms (Rifle/Shotgun)": "射击（步枪/霰弹枪）",
        "First Aid": "急救",
        "History": "历史",
        "HP Damage": "生命值伤害",
        "HP Healing": "生命值恢复",
        "Intimidate": "恐吓",
        "Jump": "跳跃",
        "Law": "法律",
        "Library Use": "图书馆使用",
        "Listen": "聆听",
        "Locksmith": "锁匠",
        "Mechanical Repair": "机械维修",
        "Medicine": "医学",
        "Occult": "神秘学",
        "Persuade": "说服",
        "Psychology": "心理学",
        "Spot Hidden": "侦查",
        "Stealth": "潜行",
        "Track": "追踪",
        "Swim": "游泳",
        "Throw": "投掷",
        "flesh_ward": "血肉防护术",
        "Flesh Ward": "血肉防护术",
        "STR": "力量",
        "CON": "体质",
        "SIZ": "体型",
        "DEX": "敏捷",
        "APP": "外貌",
        "INT": "智力",
        "POW": "意志",
        "EDU": "教育",
        "SAN": "理智",
        "LUCK": "幸运",
        "Thomas Hayes": "托马斯·海斯",
        "Eleanor Reed": "埃莉诺·里德",
        "Steven Knott": "史蒂文·诺特",
        "Arty Wilmot": "阿蒂·威尔莫特",
        "Ruth Blake": "露丝·布莱克",
        "Mr. Dooley": "杜利先生",
        "Gabriela Macario": "加布里埃拉·马卡里奥",
        "Vittorio Macario": "维托里奥·马卡里奥",
        "Kim Debrun": "金·德布伦",
        "Walter Corbitt": "沃尔特·科比特",
        "the Hall of Records clerk": "档案馆职员",
        "Boston ambulance attendant": "波士顿救护员",
        "Boston hospital surgeon": "波士顿医院外科医生",
        "Boston hospital day physician": "波士顿医院日班医生",
        "hospital doctor": "医院医生",
        "same hospital doctor": "同一位医院医生",
        "hospital doctor same": "同一位医院医生",
        "Eleanor attending physician": "埃莉诺的主治医生",
        "ambulance medic 1920 10 24": "1920年10月24日救护员",
    },
}


def default_localized_terms(play_language: str | None = None) -> dict[str, str]:
    """Built-in table vocabulary; run metadata may override any entry."""
    return deepcopy(DEFAULT_LOCALIZED_TERMS.get(play_language or DEFAULT_PLAY_LANGUAGE, {}))


def localize_terms(value: Any, terms: dict[str, str]) -> str:
    """Apply table vocabulary with ASCII boundaries for mechanical abbreviations."""
    localized = str(value)
    for canonical, replacement in sorted(
        terms.items(),
        key=lambda item: len(str(item[0])),
        reverse=True,
    ):
        canonical_text = str(canonical)
        replacement_text = str(replacement)
        if canonical_text in BOUNDARY_SAFE_ASCII_TERMS:
            pattern = re.compile(
                rf"(?<![A-Za-z0-9_]){re.escape(canonical_text)}(?![A-Za-z0-9_])"
            )
            localized = pattern.sub(lambda _match: replacement_text, localized)
        else:
            localized = localized.replace(canonical_text, replacement_text)
    return localized


def language_profile(play_language: str | None = None) -> dict[str, Any]:
    language = play_language or DEFAULT_PLAY_LANGUAGE
    if language in LANGUAGE_PROFILES:
        return deepcopy(LANGUAGE_PROFILES[language])
    profile = deepcopy(LANGUAGE_PROFILES["en-US"])
    profile.update({
        "language": language,
        "display_name": language,
        "output_instruction": f"Use {language} for player-visible narration, table dialogue, recaps, and reports.",
        "name_policy": f"Use customary {language} forms for names and setting terms when available.",
        "term_policy": f"Use localized_terms.{language} for player-visible people, places, factions, handouts, campaign titles, scenario titles, player-visible module source labels, player-visible skill display names, and special terms.",
    })
    profile["empty_report_lines"] = deepcopy(BASE_EMPTY_REPORT_LINES)
    profile["speaker_labels"] = deepcopy(BASE_SPEAKER_LABELS)
    profile["transcript_mode_labels"] = deepcopy(BASE_TRANSCRIPT_MODE_LABELS)
    profile["report_heading_labels"] = deepcopy(BASE_REPORT_HEADING_LABELS)
    profile["report_field_labels"] = deepcopy(BASE_REPORT_FIELD_LABELS)
    profile["report_value_labels"] = deepcopy(BASE_REPORT_VALUE_LABELS)
    profile["character_dossier_labels"] = deepcopy(BASE_CHARACTER_DOSSIER_LABELS)
    profile["creation_labels"] = deepcopy(BASE_CREATION_LABELS)
    profile["chronicle_labels"] = deepcopy(BASE_CHRONICLE_LABELS)
    profile["feedback_labels"] = deepcopy(BASE_FEEDBACK_LABELS)
    profile["chase_tracker_labels"] = deepcopy(BASE_CHASE_TRACKER_LABELS)
    return profile
