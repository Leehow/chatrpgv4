#!/usr/bin/env python3
from __future__ import annotations

from copy import deepcopy
from typing import Any


DEFAULT_PLAY_LANGUAGE = "zh-Hans"

BASE_REPORT_LABELS = {
    "roll_sentence": "- {skill}: {actor} rolled {roll} vs {target} -> {outcome}",
    "difficulty": "Difficulty",
    "goal": "Goal",
    "difficulty_rationale": "Difficulty Rationale",
    "failure_consequence": "Failure Consequence",
    "pushed_roll": "Pushed Roll",
    "push_justification": "Push Justification",
    "foreshadowed_failure": "Foreshadowed Failure",
    "skill_check_earned": "Skill Check Earned",
    "san_loss": "SAN Loss",
    "yes": "yes",
    "no": "no",
}

BASE_EMPTY_REPORT_LINES = {
    "combat_summary": "- No combat summary recorded.",
    "chase_summary": "- No chase summary recorded.",
    "chase_tracker": "- No chase tracker recorded.",
    "sanity_summary": "- No sanity summary recorded.",
}

LANGUAGE_PROFILES: dict[str, dict[str, Any]] = {
    "zh-Hans": {
        "language": "zh-Hans",
        "display_name": "Simplified Chinese",
        "output_instruction": "Use Simplified Chinese for player-visible narration, table dialogue, recaps, and reports.",
        "name_policy": "Foreign names should use Chinese transliterations or conventional translated names.",
        "term_policy": "Use localized_terms.zh-Hans for people, places, factions, handouts, scenario titles, and special terms.",
        "report_labels": {
            "roll_sentence": "- {skill}：{actor}掷出 {roll} / {target}，结果{outcome}。",
            "difficulty": "难度",
            "goal": "目的",
            "difficulty_rationale": "难度说明",
            "failure_consequence": "失败后果",
            "pushed_roll": "推骰",
            "push_justification": "推骰理由",
            "foreshadowed_failure": "预告失败后果",
            "skill_check_earned": "成长标记",
            "san_loss": "SAN 损失",
            "yes": "yes",
            "no": "no",
        },
        "empty_report_lines": {
            "combat_summary": "- 本轮没有触发战斗场面。",
            "chase_summary": "- 本轮没有触发追逐场面。",
            "chase_tracker": "- 本轮没有追逐状态需要追踪。",
            "sanity_summary": "- 本轮没有触发理智检定或疯狂事件。",
        },
        "outcome_labels": {
            "critical": "大成功",
            "extreme_success": "极难成功",
            "hard_success": "困难成功",
            "regular_success": "普通成功",
            "success": "成功",
            "failure": "失败",
            "fumble": "大失败",
        },
        "difficulty_labels": {
            "regular": "普通",
            "hard": "困难",
            "extreme": "极难",
            "opposed": "对抗",
            "combined": "联合",
            "sanity": "理智",
        },
        "raw_payload_fallback": False,
    },
    "en-US": {
        "language": "en-US",
        "display_name": "English",
        "output_instruction": "Use English for player-visible narration, table dialogue, recaps, and reports.",
        "name_policy": "Use customary English names and established scenario terminology.",
        "term_policy": "Use localized_terms.en-US for player-visible aliases when the source term needs an English table form.",
        "report_labels": BASE_REPORT_LABELS,
        "empty_report_lines": BASE_EMPTY_REPORT_LINES,
        "outcome_labels": {},
        "difficulty_labels": {},
        "raw_payload_fallback": True,
    },
    "ja-JP": {
        "language": "ja-JP",
        "display_name": "Japanese",
        "output_instruction": "Use Japanese for player-visible narration, table dialogue, recaps, and reports.",
        "name_policy": "Foreign names should use customary Japanese katakana forms or established translated names.",
        "term_policy": "Use localized_terms.ja-JP for people, places, factions, handouts, scenario titles, and special terms.",
        "report_labels": {
            "roll_sentence": "- {skill}：{actor}は {roll} / {target} を振り、結果は{outcome}。",
            "difficulty": "難易度",
            "goal": "目的",
            "difficulty_rationale": "難易度の理由",
            "failure_consequence": "失敗時の結果",
            "pushed_roll": "プッシュロール",
            "push_justification": "プッシュ理由",
            "foreshadowed_failure": "失敗予告",
            "skill_check_earned": "成長チェック",
            "san_loss": "SAN 喪失",
            "yes": "yes",
            "no": "no",
        },
        "empty_report_lines": {
            "combat_summary": "- 今回は戦闘場面は発生していない。",
            "chase_summary": "- 今回はチェイス場面は発生していない。",
            "chase_tracker": "- 今回は追跡するチェイス状態はない。",
            "sanity_summary": "- 今回は正気度判定や狂気イベントは発生していない。",
        },
        "outcome_labels": {
            "critical": "クリティカル",
            "extreme_success": "イクストリーム成功",
            "hard_success": "ハード成功",
            "regular_success": "レギュラー成功",
            "success": "成功",
            "failure": "失敗",
            "fumble": "ファンブル",
        },
        "difficulty_labels": {
            "regular": "レギュラー",
            "hard": "ハード",
            "extreme": "イクストリーム",
            "opposed": "対抗",
            "combined": "複合",
            "sanity": "正気度",
        },
        "raw_payload_fallback": True,
    },
}


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
        "term_policy": f"Use localized_terms.{language} for player-visible people, places, factions, handouts, scenario titles, and special terms.",
    })
    profile["empty_report_lines"] = BASE_EMPTY_REPORT_LINES
    return profile
