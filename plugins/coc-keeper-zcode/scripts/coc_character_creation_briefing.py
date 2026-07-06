#!/usr/bin/env python3
"""Render a player-safe Markdown briefing for immersive COC character creation."""

from __future__ import annotations

import argparse
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


STRUCTURE_LABELS_ZH = {
    "linear_investigation": "线性调查",
    "node_mystery": "节点式谜团",
    "sandbox": "沙盒调查",
    "hybrid_mega": "大型混合战役",
}

CONTENT_FLAG_LABELS_ZH = {
    "cosmic_horror": "宇宙恐怖",
    "cult_violence": "邪教暴力",
    "body_horror": "身体恐怖",
    "colonial-era themes": "殖民时代主题",
}

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


def _load_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


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


def _scenario_title(campaign: dict[str, Any], scenario: dict[str, Any], module_meta: dict[str, Any], language: str) -> str:
    title = str(
        scenario.get("title")
        or module_meta.get("title")
        or campaign.get("title")
        or "Call of Cthulhu Scenario"
    )
    return _localized_title(title, campaign, language)


def _source_label(source_map: dict[str, Any], scenario: dict[str, Any]) -> str:
    source = scenario.get("source")
    if not isinstance(source, dict):
        sources = source_map.get("sources", [])
        source = sources[0] if isinstance(sources, list) and sources and isinstance(sources[0], dict) else {}
    return str(source.get("title") or source.get("filename") or source.get("path") or "未记录")


def _era_label(value: Any, language: str) -> str:
    text = str(value or "1920s")
    if language == "zh-Hans" and re.fullmatch(r"\d{4}s", text):
        return f"{text[:3]}0年代"
    return text


def _safe_summary(scenario: dict[str, Any], module_meta: dict[str, Any], title: str, language: str) -> str:
    player_safe_summary = scenario.get("player_safe_summary")
    if isinstance(player_safe_summary, str) and player_safe_summary.strip():
        return player_safe_summary.strip()
    era = _era_label(module_meta.get("era") or "1920s", language)
    structure_type = str(module_meta.get("structure_type") or "")
    if language == "zh-Hans":
        if structure_type == "hybrid_mega":
            return (
                f"{title}适合创建能承受长线调查压力的调查员。故事的公开气质是 {era}的"
                "异地奔走、旧友来信、档案追索、学术圈与城市阴影。你的角色不需要知道真相，"
                "只需要有一个愿意追问、愿意远行、或无法拒绝某个求助的理由。"
            )
        return (
            f"{title} 的开卡阶段只呈现玩家安全信息：{era}，一场逐步展开的调查。"
            "请优先考虑你的调查员为什么会接触到委托、档案、异常传闻或危险的人际关系。"
        )
    return (
        f"{title} character creation uses player-safe setup only: {era}, investigation-first, "
        "with no Keeper-only solution or secret revealed."
    )


def _structure_label(value: Any, language: str) -> str:
    text = str(value or "unknown")
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


def render_briefing(
    campaign: dict[str, Any],
    scenario: dict[str, Any],
    module_meta: dict[str, Any],
    source_map: dict[str, Any],
    *,
    language: str = "zh-Hans",
) -> str:
    title = _scenario_title(campaign, scenario, module_meta, language)
    era = _era_label(module_meta.get("era") or campaign.get("era") or "1920s", language)
    structure = _structure_label(module_meta.get("structure_type"), language)
    source = _localized_title(_source_label(source_map, scenario), campaign, language)
    summary = _safe_summary(scenario, module_meta, title, language)
    flags = _content_flags(module_meta.get("content_flags"), language)
    generated_at = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

    if language != "zh-Hans":
        skill_lines = [f"- **{name}**: {reason}" for name, reason in _recommended_skills(language)]
        return "\n".join(
            [
                f"# Character Creation Briefing: {title}",
                "",
                "This briefing is player-safe. It supports investigator creation without revealing Keeper-only secrets.",
                "",
                f"- Era: {era}",
                f"- Structure: {structure}",
                f"- Source: {source}",
                "",
                "## Mood",
                "",
                summary,
                "",
                "## Useful Investigator Directions",
                "",
                *skill_lines,
                "",
                "## Before You Roll",
                "",
                "- Why would this investigator follow a disturbing lead?",
                "- What person, institution, or belief makes them stay involved?",
                "- What is one strength they trust, and one weakness they know?",
                "",
                "<!-- generated_by: coc_character_creation_briefing.py -->",
            ]
        ).rstrip() + "\n"

    skill_lines = [f"- **{name}**：{reason}" for name, reason in _recommended_skills(language)]
    flag_line = "、".join(flags) if flags else "未记录"
    return "\n".join(
        [
            f"# {title}：开卡序章",
            "",
            "> 这是一份玩家安全的开卡序章，只用于营造氛围和帮助创建调查员；不会揭示守秘人秘密、谜底或未来关键线索。",
            "",
            "## 模组窗口",
            "",
            f"- **年代**：{era}",
            f"- **结构**：{structure}",
            f"- **来源**：{source}",
            f"- **内容提示**：{flag_line}",
            "",
            "## 氛围",
            "",
            summary,
            "",
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
            "- 这个调查员为什么会愿意相信一件“不该是真的”的事？",
            "- 当证据和安全冲突时，TA 通常保护什么：名誉、朋友、真相、学生、家族，还是自己的理论？",
            "- TA 有什么适合长途调查的资源，又有什么会在压力下暴露的弱点？",
            "",
            f"<!-- generated_at: {generated_at} -->",
            "<!-- generated_by: coc_character_creation_briefing.py -->",
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
