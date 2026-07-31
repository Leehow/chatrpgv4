#!/usr/bin/env python3
"""Render a player-safe Markdown briefing for immersive COC character creation."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import unquote_to_bytes, urlsplit

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import coc_character
import coc_fileio
import coc_rulesets
import coc_state

STRUCTURE_LABELS_ZH = {
    "linear_investigation": "线性调查",
    "node_mystery": "节点式谜团",
    "sandbox": "沙盒调查",
    "linear_acts": "线性章节",
    "time_loop": "时间循环",
    "branching_investigation": "分支调查",
    "hub_sandbox": "枢纽沙盒",
    "multi_faction": "多势力博弈",
    "campaign_sequel": "战役续篇",
    "hybrid_mega": "大型混合战役",
}

CONTENT_FLAG_LABELS_ZH = {
    "cosmic_horror": "宇宙恐怖",
    "cult_violence": "邪教暴力",
    "body_horror": "身体恐怖",
    "colonial-era themes": "殖民时代主题",
}

CHARACTERISTIC_RULES_PATH = (
    coc_rulesets.ruleset_data_dir(coc_rulesets.DEFAULT_RULESET_ID)
    / "characteristic-dice.json"
)

DEFAULT_RECOMMENDED_SKILLS = [
    ("图书馆使用", "查档、旧报、书信和机构记录。"),
    ("侦查", "在现场和旅途中捕捉不对劲的细节。"),
    ("聆听", "从谈话、门后声音和环境变化里得到线索。"),
    ("心理学", "判断证词、恐惧和隐瞒。"),
    ("说服/魅惑/话术", "打开门、争取合作、绕过阻力。"),
    ("外语", "跨文化资料和旅途沟通会更自然。"),
    ("急救", "长线调查里，受伤和疲惫往往会积累。"),
    ("闪避或射击", "不是每个危险都能靠档案解决。"),
]

PROGRESSIVE_MACHINE_SUMMARY = (
    "Progressive import: skeleton topology; deep packs fill in on demand."
)
PROGRESSIVE_MACHINE_TITLE = "Progressive Module"
GENERIC_SOURCE_BASENAMES = {
    "document",
    "document.pdf",
    "module",
    "module.pdf",
    "source",
    "source.pdf",
    "unknown",
}
MAX_PUBLIC_IDENTITY_BYTES = 4096
MAX_PERCENT_DECODE_PASSES = 8
PERCENT_ESCAPE = re.compile(r"%[0-9A-Fa-f]{2}")
WINDOWS_DRIVE_PATH = re.compile(r"^[A-Za-z]:[\\/]")
FORBIDDEN_UNICODE_CATEGORIES = frozenset({"Cc", "Cf", "Cs", "Zl", "Zp"})


def _load_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    coc_fileio.write_json_atomic(
        path, payload, indent=2, ensure_ascii=False, trailing_newline=True
    )


def public_setup_sha256(
    campaign: dict[str, Any],
    scenario: dict[str, Any],
    module_meta: dict[str, Any],
    source_map: dict[str, Any],
    *,
    language: str,
) -> str:
    """Hash only the player-safe inputs that determine a briefing.

    ``campaign.character_creation`` is deliberately excluded: it contains the
    generated pointer and timestamp, so hashing the whole campaign would make
    every render invalidate itself.
    """
    public_inputs = {
        "language": language,
        "campaign": {
            key: campaign.get(key)
            for key in (
                "title", "era", "era_source", "source_fast_facts",
                "play_language", "localized_terms",
            )
        },
        "scenario": {
            key: scenario.get(key)
            for key in (
                "scenario_id", "title", "player_safe_summary", "source",
            )
        },
        "module_meta": {
            key: module_meta.get(key)
            for key in (
                "scenario_id", "title", "era", "structure_type",
                "content_flags", "player_safe_summary", "module_identity",
            )
        },
        "source_map": {"sources": source_map.get("sources")},
    }
    encoded = json.dumps(
        public_inputs,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug or "scenario"


def _repo_relative(path: Path, repo_root: Path) -> str:
    try:
        return path.resolve().relative_to(repo_root.resolve()).as_posix()
    except ValueError:
        return path.resolve().as_posix()


def _localized_title(title: str, campaign: dict[str, Any], language: str) -> str:
    terms = campaign.get("localized_terms", {})
    localized = terms.get(language, {}) if isinstance(terms, dict) else {}
    if not isinstance(localized, dict):
        return title
    if title in localized:
        return str(localized[title])
    for canonical, translated in sorted(localized.items(), key=lambda item: len(str(item[0])), reverse=True):
        if str(canonical) and str(canonical) in title:
            return str(translated)
    return title


def _has_forbidden_unicode_category(value: str) -> bool:
    return any(
        unicodedata.category(character) in FORBIDDEN_UNICODE_CATEGORIES
        for character in value
    )


def _decode_percent_fixed_point(value: Any) -> tuple[str, bool] | None:
    input_text = str(value or "")
    if _has_forbidden_unicode_category(input_text):
        return None
    raw = input_text.strip()
    try:
        if len(raw.encode("utf-8")) > MAX_PUBLIC_IDENTITY_BYTES:
            return None
    except UnicodeEncodeError:
        return None
    current = unicodedata.normalize("NFKC", raw)
    try:
        if len(current.encode("utf-8")) > MAX_PUBLIC_IDENTITY_BYTES:
            return None
    except UnicodeEncodeError:
        return None
    changed = current != raw
    for _ in range(MAX_PERCENT_DECODE_PASSES):
        if PERCENT_ESCAPE.search(current) is None:
            return current, changed
        try:
            decoded = unquote_to_bytes(current).decode("utf-8", errors="strict")
        except (UnicodeDecodeError, UnicodeEncodeError):
            return None
        decoded = unicodedata.normalize("NFKC", decoded)
        if decoded == current:
            return None
        current = decoded
        changed = True
        try:
            if len(current.encode("utf-8")) > MAX_PUBLIC_IDENTITY_BYTES:
                return None
        except UnicodeEncodeError:
            return None
    if PERCENT_ESCAPE.search(current):
        return None
    return current, changed


def _has_unsafe_identity_character(value: str) -> bool:
    return (
        _has_forbidden_unicode_category(value)
        or "/" in value
        or "\\" in value
        or "?" in value
        or "#" in value
    )


def _public_title_candidate(value: Any) -> str:
    normalized = _decode_percent_fixed_point(value)
    if normalized is None:
        return ""
    text, _changed = normalized
    if (
        not text
        or text == PROGRESSIVE_MACHINE_TITLE
        or _has_unsafe_identity_character(text)
        or text.startswith(("~", "."))
    ):
        return ""
    try:
        if urlsplit(text).scheme:
            return ""
    except ValueError:
        return ""
    return text


def _safe_source_filename(value: Any) -> str:
    input_text = str(value or "")
    if _has_forbidden_unicode_category(input_text):
        return ""
    raw = input_text.strip()
    if not raw:
        return ""
    try:
        parsed = urlsplit(raw)
    except ValueError:
        return ""
    is_windows_path = WINDOWS_DRIVE_PATH.match(raw) is not None
    if parsed.scheme and not is_windows_path:
        if not parsed.netloc and parsed.scheme.lower() != "file":
            return ""
        encoded_path = parsed.path
    else:
        encoded_path = raw.split("#", 1)[0].split("?", 1)[0]
    normalized = _decode_percent_fixed_point(encoded_path)
    if normalized is None:
        return ""
    decoded_path, changed = normalized
    if changed and any(
        decoded_path.count(delimiter) > encoded_path.count(delimiter)
        for delimiter in ("/", "\\", ":", "?", "#")
    ):
        return ""
    path = decoded_path.replace("\\", "/")
    if path.endswith("/"):
        return ""
    segments = [segment for segment in path.split("/") if segment]
    if any(segment in {".", ".."} for segment in segments):
        return ""
    basename = segments[-1].strip() if segments else ""
    if (
        not basename
        or basename.startswith(".")
        or basename.lower() in GENERIC_SOURCE_BASENAMES
        or _has_unsafe_identity_character(basename)
        or ":" in basename
    ):
        return ""
    try:
        if urlsplit(basename).scheme:
            return ""
    except ValueError:
        return ""
    return basename


def _safe_source_title(value: Any) -> str:
    return _public_title_candidate(value)


def _safe_source_record_label(source: dict[str, Any]) -> str:
    title = _safe_source_title(source.get("title"))
    if title:
        return title
    return _safe_source_filename(source.get("filename"))


def _scenario_title(
    campaign: dict[str, Any],
    scenario: dict[str, Any],
    module_meta: dict[str, Any],
    source_map: dict[str, Any],
    language: str,
) -> str:
    source_title = _public_title_candidate(_source_label(source_map, scenario))
    for value in (
        scenario.get("title"),
        module_meta.get("title"),
        source_title,
        campaign.get("title"),
    ):
        title = _public_title_candidate(value)
        if title:
            localized_title = _public_title_candidate(
                _localized_title(title, campaign, language)
            )
            if localized_title:
                return localized_title
            break
    return "调查员创建简报" if language == "zh-Hans" else "Investigator Briefing"


def _source_label(source_map: dict[str, Any], scenario: dict[str, Any]) -> str:
    candidates: list[dict[str, Any]] = []
    source = scenario.get("source")
    if isinstance(source, dict):
        candidates.append(source)
    sources = source_map.get("sources", [])
    if isinstance(sources, list):
        candidates.extend(item for item in sources if isinstance(item, dict))
    for candidate in candidates:
        label = _safe_source_record_label(candidate)
        if label:
            return label
    return ""


def _fast_fact(campaign: dict[str, Any], name: str) -> Any:
    """Return one resolved fast-parse answer, or None when it stays unresolved.

    An `unresolved` answer is deliberately indistinguishable from a missing one
    here: the briefing simply says nothing rather than filling the blank.
    """
    facts = campaign.get("source_fast_facts") if isinstance(campaign, dict) else None
    answer = facts.get(name) if isinstance(facts, dict) else None
    if isinstance(answer, dict) and answer.get("status") == "source":
        return answer.get("value")
    return None


def _era_label(value: Any, language: str) -> str:
    text = str(value or "").strip()
    if text.lower() in {"unknown", "none", "null"}:
        return ""
    if language == "zh-Hans" and re.fullmatch(r"\d{4}s", text):
        return f"{text[:3]}0年代"
    return text


def _safe_summary(
    scenario: dict[str, Any],
    module_meta: dict[str, Any],
    title: str,
    era: str,
    language: str,
    *,
    guided_quick_fire_supported: bool,
) -> str:
    player_safe_summary = scenario.get("player_safe_summary")
    if (
        isinstance(player_safe_summary, str)
        and player_safe_summary.strip()
        and player_safe_summary.strip() != PROGRESSIVE_MACHINE_SUMMARY
    ):
        return player_safe_summary.strip()
    player_safe_summary = module_meta.get("player_safe_summary")
    if (
        isinstance(player_safe_summary, str)
        and player_safe_summary.strip()
        and player_safe_summary.strip() != PROGRESSIVE_MACHINE_SUMMARY
    ):
        return player_safe_summary.strip()
    structure_type = str(module_meta.get("structure_type") or "")
    if language == "zh-Hans":
        era_context = f"{era}，" if era else ""
        if not guided_quick_fire_supported:
            return (
                f"{title} 的开卡阶段只呈现玩家安全信息：{era_context}"
                "请根据模组公开来源，构思一个属于该时代与地点的人物；"
                "此处不补写职业、技能、金钱或装备数值。"
            )
        if structure_type == "hybrid_mega":
            return (
                f"{title}适合创建能承受长线调查压力的调查员。故事的公开气质是"
                f"{era_context}"
                "异地奔走、旧友来信、档案追索、学术圈与城市阴影。你的角色不需要知道真相，"
                "只需要有一个愿意追问、愿意远行、或无法拒绝某个求助的理由。"
            )
        return (
            f"{title} 的开卡阶段只呈现玩家安全信息：{era_context}一场逐步展开的调查。"
            "请优先考虑你的调查员为什么会接触到委托、档案、异常传闻或危险的人际关系。"
        )
    era_context = f"{era}, " if era else ""
    if not guided_quick_fire_supported:
        return (
            f"{title} character creation uses player-safe setup only: "
            f"{era_context}build a person who belongs to the source's era and "
            "place without inventing occupation, skill, money, or equipment values."
        )
    return (
        f"{title} character creation uses player-safe setup only: {era_context}investigation-first, "
        "with no Keeper-only solution or secret revealed."
    )


def _structure_label(value: Any, language: str) -> str:
    text = str(value or "").strip()
    if text.lower() in {"unknown", "none", "null"}:
        return ""
    if language == "zh-Hans":
        return STRUCTURE_LABELS_ZH.get(text, text)
    return text


def _content_flags(flags: Any, language: str) -> list[str]:
    if not isinstance(flags, list):
        return []
    labels = []
    for flag in flags:
        text = str(flag)
        if language == "zh-Hans":
            text = CONTENT_FLAG_LABELS_ZH.get(text, text)
        labels.append(text)
    return labels


def _recommended_skills(language: str) -> list[tuple[str, str]]:
    if language == "zh-Hans":
        return DEFAULT_RECOMMENDED_SKILLS
    return [
        ("Library Use", "Archives, newspapers, letters, and institutional records."),
        ("Spot Hidden", "Notice details in scenes and travel."),
        ("Listen", "Catch clues in conversation and the environment."),
        ("Psychology", "Read testimony, fear, and concealment."),
        ("Persuade/Charm/Fast Talk", "Open doors and gain cooperation."),
        ("Language (Other)", "Handle cross-cultural material and travel."),
        ("First Aid", "Long investigations accumulate injuries and fatigue."),
        ("Dodge or Firearms", "Some danger cannot be solved by research alone."),
    ]


def _generation_method_lines(language: str) -> list[str]:
    rules = _load_json(CHARACTERISTIC_RULES_PATH, {})
    methods = rules.get("generation_methods", {}) if isinstance(rules, dict) else {}
    if not isinstance(methods, dict):
        methods = {}
    point_buy = methods.get("point_buy_460", {}) if isinstance(methods.get("point_buy_460"), dict) else {}
    quick_fire = methods.get("quick_fire_array", {}) if isinstance(methods.get("quick_fire_array"), dict) else {}
    total_budget = int(point_buy.get("total_budget", 460))
    increment = int(point_buy.get("increment", 5))
    quick_array = quick_fire.get("array", [80, 70, 60, 60, 50, 50, 50, 40])
    quick_text_zh = "、".join(str(value) for value in quick_array)
    quick_text_en = ", ".join(str(value) for value in quick_array)

    if language == "zh-Hans":
        return [
            "- **按顺序投骰**：照规则逐项投出属性，适合接受命运给角色留下的锋利边角。",
            "- **投骰后分配**：先投出一组属性值，再按角色概念分配到力量、体质、体型、敏捷、外貌、智力、意志、教育。",
            f"- **点购：{total_budget} 点**：不投属性骰，按 {increment} 的倍数分配到八项属性，适合已有明确概念的调查员。",
            f"- **快速数组：{quick_text_zh}**：把这组数分配到八项属性，速度快，也比较稳。",
        ]
    return [
        "- **Roll in order**: roll each characteristic in its fixed order.",
        "- **Rolled pool assignment**: roll the pool first, then assign values to fit the concept.",
        f"- **Point-buy: {total_budget} points**: allocate the budget across the eight characteristics in steps of {increment}.",
        f"- **Quick Fire array: {quick_text_en}**: assign the preset values across the eight characteristics.",
    ]


def _unsupported_era_creation_lines(
    era: str,
    supported_eras: tuple[str, ...],
    language: str,
) -> list[str]:
    supported_labels = tuple(
        label
        for label in (_era_label(value, language) for value in supported_eras)
        if label
    )
    supported = "、".join(supported_labels) if supported_labels else "无"
    current = era or ("未确定" if language == "zh-Hans" else "unspecified")
    if language == "zh-Hans":
        support_boundary = (
            f"不能把属于{supported}的角色卡中的职业、技能、金钱或装备"
            "直接套到本战役。"
            if supported_labels
            else "当前没有可借用的自动快速建卡模板；不要自行补写职业、技能、金钱或装备数值。"
        )
        return [
            "## 年代说明",
            "",
            (
                f"- 当前自动快速建卡可靠支持的年代：{supported}。"
            ),
            (
                f"- 本战役年代为 **{current}**，与当前自动快速建卡不匹配；"
                f"{support_boundary}"
            ),
            (
                "- 如果已有经权威来源核对、与本年代相符的完整角色卡，"
                "可以交给守秘人确认后使用；否则先确定人物概念和背景，"
                "暂不生成数值。"
            ),
            "",
            "## 角色概念（暂不生成数值）",
            "",
            "- 这个人物如何属于当前时代、地点与社会关系？",
            "- 来源公开背景中的什么人、责任或事件会把 TA 带入故事？",
            "- 先记录概念与背景，不选择职业、技能或装备数值。",
        ]
    supported = ", ".join(supported_labels) if supported_labels else "none"
    sheet_label = "character sheet" if len(supported_labels) == 1 else "character sheets"
    support_boundary = (
        "Do not copy occupations, skills, money, or equipment from the "
        f"currently supported {supported} {sheet_label} into this campaign."
        if supported_labels
        else (
            "There is no reliable automatic quick-creation template to borrow; "
            "do not invent occupation, skill, money, or equipment values."
        )
    )
    return [
        "## Era Note",
        "",
        (
            "- Reliable automatic quick character creation currently supports: "
            f"{supported}."
        ),
        (
            f"- This campaign era is **{current}**, which does not match. "
            f"{support_boundary}"
        ),
        (
            "- If you already have a complete character sheet verified against "
            "an authoritative source and suited to this era, give it to the "
            "Keeper for confirmation. Otherwise, establish the character's "
            "concept and background without generating numbers yet."
        ),
        "",
        "## Character Concept (No Numbers Yet)",
        "",
        "- How does this person belong to the campaign's era, place, and society?",
        "- What person, duty, or event in the public source background draws them in?",
        "- Record concept and background only; do not choose occupation, skill, or equipment values yet.",
    ]


def render_briefing(
    campaign: dict[str, Any],
    scenario: dict[str, Any],
    module_meta: dict[str, Any],
    source_map: dict[str, Any],
    *,
    language: str = "zh-Hans",
) -> str:
    title = _scenario_title(campaign, scenario, module_meta, source_map, language)
    # An unestablished campaign era is a clock placeholder, not a fact about the
    # module. Never show it to the player; module-authored meta may still speak.
    campaign_era = (
        str(campaign.get("era") or "").strip()
        if coc_state.campaign_era_is_established(campaign)
        else ""
    )
    raw_era = campaign_era or str(module_meta.get("era") or "").strip()
    era = _era_label(raw_era, language)
    supported_eras = coc_character.guided_quick_fire_supported_eras()
    guided_quick_fire_supported = raw_era.casefold() in supported_eras
    # Fast-parse answers are player-safe by contract and outrank module meta:
    # they were read for exactly these questions.
    place = str(_fast_fact(campaign, "place") or "").strip()
    investigator_hook = str(_fast_fact(campaign, "investigator_hook") or "").strip()
    investigator_constraints = str(
        _fast_fact(campaign, "investigator_constraints") or ""
    ).strip()
    fast_summary = str(_fast_fact(campaign, "player_safe_summary") or "").strip()
    fast_flags = _fast_fact(campaign, "content_flags")
    structure = _structure_label(module_meta.get("structure_type"), language)
    source_label = _source_label(source_map, scenario)
    source = (
        _public_title_candidate(
            _localized_title(source_label, campaign, language)
        )
        if source_label
        else ""
    )
    summary = fast_summary or _safe_summary(
        scenario,
        module_meta,
        title,
        era,
        language,
        guided_quick_fire_supported=guided_quick_fire_supported,
    )
    flags = _content_flags(fast_flags or module_meta.get("content_flags"), language)
    # The one line a player most needs to invent a fitting investigator:
    # why this person ends up in the story at all. Only shown when the
    # source parse actually found it.
    hook_lines = (
        [
            "## 模组给的切入点" if language == "zh-Hans" else "## How You Get Involved",
            "",
            investigator_hook,
            "",
        ]
        if investigator_hook else []
    )
    if language != "zh-Hans":
        if not guided_quick_fire_supported:
            setup_lines = [
                line
                for line in (
                    f"- Era: {era}" if era else "",
                    f"- Place: {place}" if place else "",
                    f"- Structure: {structure}" if structure else "",
                    f"- Source: {source}" if source else "",
                    (
                        f"- Investigator requirements: {investigator_constraints}"
                        if investigator_constraints else ""
                    ),
                )
                if line
            ]
            return "\n".join(
                [
                    f"# Character Creation Briefing: {title}",
                    "",
                    "This player-safe briefing preserves public source and era context without inventing character details that lack era-appropriate support.",
                    "",
                    *setup_lines,
                    "",
                    "## Mood",
                    "",
                    summary,
                    "",
                    *hook_lines,
                    *_unsupported_era_creation_lines(
                        era, supported_eras, language
                    ),
                ]
            ).rstrip() + "\n"
        skill_lines = [f"- **{name}**: {reason}" for name, reason in _recommended_skills(language)]
        setup_lines = [
            line
            for line in (
                f"- Era: {era}" if era else "",
                f"- Place: {place}" if place else "",
                f"- Structure: {structure}" if structure else "",
                f"- Source: {source}" if source else "",
                (
                    f"- Investigator requirements: {investigator_constraints}"
                    if investigator_constraints else ""
                ),
            )
            if line
        ]
        return "\n".join(
            [
                f"# Character Creation Briefing: {title}",
                "",
                "This briefing is player-safe. It supports investigator creation without revealing Keeper-only secrets.",
                "",
                *setup_lines,
                "",
                "## Mood",
                "",
                summary,
                "",
                *hook_lines,
                "## Useful Investigator Directions",
                "",
                *skill_lines,
                "",
                "## Before You Roll",
                "",
                (
                    "Choose the characteristic generation method before "
                    "rolling or assigning values:"
                ),
                "",
                *_generation_method_lines(language),
                "",
                (
                    "Next, choose one characteristic-generation method and "
                    "describe the investigator concept. The final sheet joins "
                    "the campaign only after your confirmation."
                ),
                "",
                "- Why would this investigator follow a disturbing lead?",
                "- What person, institution, or belief makes them stay involved?",
                "- What is one strength they trust, and one weakness they know?",
            ]
        ).rstrip() + "\n"

    skill_lines = [f"- **{name}**：{reason}" for name, reason in _recommended_skills(language)]
    setup_lines = [
        line
        for line in (
            f"- **年代**：{era}" if era else "",
            f"- **地点**：{place}" if place else "",
            f"- **结构**：{structure}" if structure else "",
            f"- **来源**：{source}" if source else "",
            (
                f"- **调查员要求**：{investigator_constraints}"
                if investigator_constraints else ""
            ),
            f"- **内容提示**：{'、'.join(flags)}" if flags else "",
        )
        if line
    ]
    if not guided_quick_fire_supported:
        return "\n".join(
            [
                f"# {title}：开卡序章",
                "",
                "> 这是一份玩家安全的开卡序章，只保留公开的来源与时代背景；不会擅自补写这个年代尚无依据的建卡内容。",
                "",
                "## 模组窗口",
                "",
                *setup_lines,
                "",
                "## 氛围",
                "",
                summary,
                "",
                *hook_lines,
                *_unsupported_era_creation_lines(
                    era, supported_eras, language
                ),
            ]
        ).rstrip() + "\n"
    return "\n".join(
        [
            f"# {title}：开卡序章",
            "",
            "> 这是一份玩家安全的开卡序章，只用于营造氛围和帮助创建调查员；不会揭示守秘人秘密、谜底或未来关键线索。",
            "",
            "## 模组窗口",
            "",
            *setup_lines,
            "",
            "## 氛围",
            "",
            summary,
            "",
            *hook_lines,
            "## 适合的调查员",
            "",
            "- 有学术、新闻、医学、考古、法律、警务、旅行、社交或私人委托背景的人，都可以自然进入调查。",
            "- 最好给角色一个能被信件、旧友、档案、职业责任或异常传闻牵动的理由。",
            "- 角色不需要是战斗专家，但应该有一种面对危险仍继续追问的支点。",
            "",
            "## 开卡时有用的方向",
            "",
            *skill_lines,
            "",
            "## 开始掷点前想一想",
            "",
            "先定属性生成方式，再投骰或分配数值：",
            "",
            *_generation_method_lines(language),
            "",
            "接下来请选择一种属性生成方式，并描述你想扮演的调查员概念；最终角色卡会在你确认后加入战役。",
            "",
            "- 这个调查员为什么会愿意相信一件“不该是真的”的事？",
            "- 当证据和安全冲突时，TA 通常保护什么：名誉、朋友、真相、学生、家族，还是自己的理论？",
            "- TA 有什么适合长途调查的资源，又有什么会在压力下暴露的弱点？",
        ]
    ).rstrip() + "\n"


def render_briefing_from_campaign(
    campaign_dir: Path,
    *,
    out_dir: Path | None = None,
    repo_root: Path | None = None,
    language: str | None = None,
    write_back: bool = False,
) -> dict[str, str]:
    repo_root = repo_root or Path.cwd()
    campaign_path = campaign_dir / "campaign.json"
    scenario_path = campaign_dir / "scenario" / "scenario.json"
    module_meta_path = campaign_dir / "scenario" / "module-meta.json"
    source_map_path = campaign_dir / "index" / "source-map.json"

    campaign = _load_json(campaign_path, {})
    scenario = _load_json(scenario_path, {})
    module_meta = _load_json(module_meta_path, {})
    source_map = _load_json(source_map_path, {})
    play_language = language or str(campaign.get("play_language") or "zh-Hans")
    title = str(scenario.get("title") or module_meta.get("title") or campaign.get("title") or "scenario")
    setup_digest = public_setup_sha256(
        campaign,
        scenario,
        module_meta,
        source_map,
        language=play_language,
    )

    out_dir = out_dir or (campaign_dir / "assets" / "character-creation")
    out_dir.mkdir(parents=True, exist_ok=True)
    output_path = out_dir / f"{_slugify(title)}-briefing.md"
    output_path.write_text(
        render_briefing(campaign, scenario, module_meta, source_map, language=play_language),
        encoding="utf-8",
    )

    result = {
        "briefing_path": _repo_relative(output_path, repo_root),
        "language": play_language,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "public_setup_sha256": setup_digest,
    }
    if write_back:
        campaign["character_creation"] = {
            **(campaign.get("character_creation") if isinstance(campaign.get("character_creation"), dict) else {}),
            **result,
        }
        _write_json(campaign_path, campaign)
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--campaign-dir", type=Path, required=True)
    parser.add_argument("--out-dir", type=Path)
    parser.add_argument("--repo-root", type=Path, default=Path.cwd())
    parser.add_argument("--language")
    parser.add_argument("--write-back", action="store_true")
    args = parser.parse_args()

    result = render_briefing_from_campaign(
        args.campaign_dir,
        out_dir=args.out_dir,
        repo_root=args.repo_root,
        language=args.language,
        write_back=args.write_back,
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
