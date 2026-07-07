#!/usr/bin/env python3
"""Render player-facing Call of Cthulhu character cards.

The source of truth remains the structured investigator or creation JSON. This
script renders a localized display layer into portable Markdown for use in
Codex and ZCode. Static HTML can be emitted explicitly for browser preview or
printing, but Markdown is the default card format.
"""

from __future__ import annotations

import argparse
import html
import json
import os
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


LANGUAGE_SHEET_SUFFIX = {
    "zh-Hans": "zh",
    "zh": "zh",
}


def _load_json(path: Path) -> dict[str, Any]:
    with path.open(encoding="utf-8") as handle:
        data = json.load(handle)
    if not isinstance(data, dict):
        raise ValueError(f"{path} must contain a JSON object")
    return data


def _write_json(path: Path, data: dict[str, Any]) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def detect_playwright_available(codex_home: Path | None = None) -> bool:
    codex_root = codex_home or Path(os.environ.get("CODEX_HOME", Path.home() / ".codex"))
    wrapper = codex_root / "skills" / "playwright" / "scripts" / "playwright_cli.sh"
    return wrapper.exists() and shutil.which("npx") is not None


def _should_render_html(mode: str | bool, playwright_detected: bool | None = None) -> bool:
    if mode is True or mode == "always":
        return True
    if mode is False or mode == "never":
        return False
    if mode == "auto":
        return detect_playwright_available() if playwright_detected is None else playwright_detected
    raise ValueError(f"unknown html mode: {mode}")


def _slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug or "investigator"


def _html(value: Any) -> str:
    return html.escape(str(value), quote=True)


def _repo_relative(path: Path, repo_root: Path) -> str:
    try:
        return path.resolve().relative_to(repo_root.resolve()).as_posix()
    except ValueError:
        return path.resolve().as_posix()


def _resolve_asset_path(path_text: str | None, repo_root: Path, source_path: Path) -> Path | None:
    if not path_text:
        return None
    path = Path(path_text)
    if path.is_absolute():
        return path
    repo_candidate = repo_root / path
    if repo_candidate.exists():
        return repo_candidate
    source_candidate = source_path.parent / path
    if source_candidate.exists():
        return source_candidate
    return repo_candidate


def _relative_link(from_file: Path, target: Path | None) -> str | None:
    if target is None:
        return None
    return os.path.relpath(target, from_file.parent)


def _display_sheet(character: dict[str, Any], language: str) -> dict[str, Any]:
    suffix = LANGUAGE_SHEET_SUFFIX.get(language, language)
    sheet = character.get(f"player_facing_sheet_{suffix}")
    if not isinstance(sheet, dict):
        raise ValueError(f"missing player_facing_sheet_{suffix}")
    return sheet


def _identity_name(character: dict[str, Any], sheet: dict[str, Any]) -> str:
    identity = character.get("identity", {})
    if isinstance(identity, dict):
        return str(identity.get("name") or sheet.get("display_name") or "investigator")
    return str(sheet.get("display_name") or "investigator")


def _campaign_title(campaign: dict[str, Any], language: str) -> str:
    localized_terms = campaign.get("localized_terms", {})
    terms = localized_terms.get(language, {}) if isinstance(localized_terms, dict) else {}
    title = campaign.get("title") or campaign.get("scenario", {}).get("title") or "Call of Cthulhu"
    if isinstance(terms, dict):
        title_text = str(title)
        if title_text in terms:
            return str(terms[title_text])
        for canonical, localized in sorted(terms.items(), key=lambda item: len(str(item[0])), reverse=True):
            if str(canonical) and str(canonical) in title_text:
                return str(localized)
        return title_text
    return str(title)


def _characteristics_rows(sheet: dict[str, Any]) -> list[tuple[str, str, Any]]:
    values = sheet.get("characteristics", {})
    if not isinstance(values, dict):
        return []
    rows: list[tuple[str, str, Any]] = []
    for label, entry in values.items():
        if isinstance(entry, dict):
            rows.append((str(label), str(entry.get("key", "")), entry.get("value", "")))
        else:
            rows.append((str(label), "", entry))
    return rows


def _derived_rows(sheet: dict[str, Any]) -> list[tuple[str, Any]]:
    values = sheet.get("derived", {})
    if not isinstance(values, dict):
        return []
    return [(str(label), value) for label, value in values.items()]


def _skills(sheet: dict[str, Any]) -> list[dict[str, Any]]:
    values = sheet.get("skills", [])
    return [entry for entry in values if isinstance(entry, dict)]


def _backstory_detail_blocks(character: dict[str, Any], sheet: dict[str, Any], language: str) -> list[tuple[str, list[Any]]]:
    localized = sheet.get("backstory_details")
    if isinstance(localized, list):
        blocks: list[tuple[str, list[Any]]] = []
        for block in localized:
            if not isinstance(block, dict):
                continue
            label = block.get("label")
            items = block.get("items")
            if isinstance(label, str) and isinstance(items, list) and items:
                blocks.append((label, items))
        if blocks:
            return blocks

    if language == "zh-Hans":
        return []

    backstory = character.get("backstory", {})
    if not isinstance(backstory, dict):
        return []
    detail_map = [
        ("信念", "ideology_beliefs"),
        ("重要之人", "significant_people"),
        ("重要地点", "meaningful_locations"),
        ("珍贵物品", "treasured_possessions"),
        ("特质", "traits"),
    ]
    blocks = []
    for label, key in detail_map:
        values = backstory.get(key)
        if isinstance(values, list) and values:
            blocks.append((label, values))
    return blocks


def _skill_value(entry: dict[str, Any]) -> int:
    try:
        return max(0, min(100, int(entry.get("value", 0))))
    except (TypeError, ValueError):
        return 0


def _markdown_table(rows: list[list[Any]]) -> list[str]:
    if not rows:
        return []
    width = len(rows[0])
    lines = [
        "| " + " | ".join(str(cell) for cell in rows[0]) + " |",
        "| " + " | ".join("---" for _ in range(width)) + " |",
    ]
    for row in rows[1:]:
        lines.append("| " + " | ".join(str(cell) for cell in row) + " |")
    return lines


def render_markdown(
    character: dict[str, Any],
    campaign: dict[str, Any],
    *,
    language: str,
    output_path: Path,
    repo_root: Path,
    source_path: Path,
) -> str:
    sheet = _display_sheet(character, language)
    name = str(sheet.get("display_name") or _identity_name(character, sheet))
    canonical_name = _identity_name(character, sheet)
    title = _campaign_title(campaign, language)
    portrait_path = _resolve_asset_path(
        str(sheet.get("portrait_path") or character.get("portrait", {}).get("asset_path") or ""),
        repo_root,
        source_path,
    )
    portrait_link = _relative_link(output_path, portrait_path)

    lines = [
        f"# {name}",
        "",
        f"**{canonical_name}** · **{sheet.get('era', '')}** · **{sheet.get('nationality', '')}** · **{sheet.get('occupation', '')}**",
        "",
        f"战役：{title}",
        "",
    ]
    if portrait_link:
        lines.extend([f"![{name} 立绘]({portrait_link})", ""])

    derived = _derived_rows(sheet)
    if derived:
        lines.extend(["## 状态", ""])
        lines.extend(_markdown_table([["项目", "数值"], *[[label, value] for label, value in derived]]))
        lines.append("")

    characteristics = _characteristics_rows(sheet)
    if characteristics:
        lines.extend(["## 属性", ""])
        rows = [["属性", "缩写", "数值"], *[[label, key, value] for label, key, value in characteristics]]
        lines.extend(_markdown_table(rows))
        lines.append("")

    skills = _skills(sheet)
    if skills:
        lines.extend(["## 技能", ""])
        rows = [["技能", "数值", "半值", "五分之一"]]
        rows.extend(
            [
                [
                    entry.get("label", entry.get("key", "")),
                    entry.get("value", ""),
                    entry.get("half", ""),
                    entry.get("fifth", ""),
                ]
                for entry in skills
            ]
        )
        lines.extend(_markdown_table(rows))
        lines.append("")

    weapons = sheet.get("weapons", [])
    if isinstance(weapons, list) and weapons:
        lines.extend(["## 武器", ""])
        rows = [["武器", "技能", "伤害", "射程", "弹匣", "故障"]]
        for weapon in weapons:
            if not isinstance(weapon, dict):
                continue
            rows.append(
                [
                    weapon.get("label", ""),
                    weapon.get("skill_label", ""),
                    weapon.get("damage", ""),
                    weapon.get("range", ""),
                    weapon.get("ammo_capacity", ""),
                    weapon.get("malfunction", ""),
                ]
            )
        lines.extend(_markdown_table(rows))
        lines.append("")

    summary = sheet.get("backstory_summary")
    if summary:
        lines.extend(["## 背景", "", str(summary), ""])

    for label, values in _backstory_detail_blocks(character, sheet, language):
        lines.append(f"### {label}")
        for value in values:
            lines.append(f"- {value}")
        lines.append("")

    lines.append("<!-- generated_by: coc_character_card.py -->")
    return "\n".join(lines).rstrip() + "\n"


def render_html(
    character: dict[str, Any],
    campaign: dict[str, Any],
    *,
    language: str,
    output_path: Path,
    repo_root: Path,
    source_path: Path,
) -> str:
    sheet = _display_sheet(character, language)
    name = str(sheet.get("display_name") or _identity_name(character, sheet))
    canonical_name = _identity_name(character, sheet)
    title = _campaign_title(campaign, language)
    portrait_path = _resolve_asset_path(
        str(sheet.get("portrait_path") or character.get("portrait", {}).get("asset_path") or ""),
        repo_root,
        source_path,
    )
    portrait_link = _relative_link(output_path, portrait_path)
    characteristics = _characteristics_rows(sheet)
    derived = _derived_rows(sheet)
    skills = _skills(sheet)
    weapons = sheet.get("weapons", [])

    portrait_html = ""
    if portrait_link:
        portrait_html = (
            '<figure class="portrait">'
            f'<img src="{_html(portrait_link)}" alt="{_html(name)} 立绘">'
            '<figcaption>调查员立绘</figcaption>'
            "</figure>"
        )

    derived_html = "\n".join(
        f'<div class="vital"><span>{_html(label)}</span><strong>{_html(value)}</strong></div>'
        for label, value in derived
    )
    characteristics_html = "\n".join(
        (
            '<div class="attribute">'
            f'<div><span>{_html(label)}</span><small>{_html(key)}</small></div>'
            f'<strong>{_html(value)}</strong>'
            "</div>"
        )
        for label, key, value in characteristics
    )
    top_skills = skills[:16]
    skills_html = "\n".join(
        (
            '<div class="skill">'
            f'<div class="skill-line"><span>{_html(entry.get("label", entry.get("key", "")))}</span>'
            f'<strong>{_html(entry.get("value", ""))}</strong></div>'
            '<div class="meter" aria-hidden="true">'
            f'<span style="width: {_skill_value(entry)}%"></span>'
            "</div>"
            f'<small>半值 {_html(entry.get("half", ""))} · 五分之一 {_html(entry.get("fifth", ""))}</small>'
            "</div>"
        )
        for entry in top_skills
    )
    other_skills = skills[16:]
    other_skills_html = "\n".join(
        f'<span class="tag">{_html(entry.get("label", entry.get("key", "")))} {_html(entry.get("value", ""))}</span>'
        for entry in other_skills
    )
    weapons_html = ""
    if isinstance(weapons, list) and weapons:
        rows = []
        for weapon in weapons:
            if not isinstance(weapon, dict):
                continue
            rows.append(
                "<tr>"
                f'<td>{_html(weapon.get("label", ""))}</td>'
                f'<td>{_html(weapon.get("skill_label", ""))}</td>'
                f'<td>{_html(weapon.get("damage", ""))}</td>'
                f'<td>{_html(weapon.get("range", ""))}</td>'
                f'<td>{_html(weapon.get("ammo_capacity", ""))}</td>'
                f'<td>{_html(weapon.get("malfunction", ""))}</td>'
                "</tr>"
            )
        weapons_html = (
            '<section class="section"><h2>武器与装备</h2>'
            '<table><thead><tr><th>武器</th><th>技能</th><th>伤害</th><th>射程</th><th>弹匣</th><th>故障</th></tr></thead>'
            f'<tbody>{"".join(rows)}</tbody></table></section>'
        )

    detail_html = ""
    blocks = []
    for label, values in _backstory_detail_blocks(character, sheet, language):
        items = "".join(f"<li>{_html(value)}</li>" for value in values)
        blocks.append(f"<div><h3>{_html(label)}</h3><ul>{items}</ul></div>")
    detail_html = "\n".join(blocks)

    summary = sheet.get("backstory_summary", "")
    generated_at = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

    return f"""<!doctype html>
<html lang="{_html(language)}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{_html(name)} - 调查员角色卡</title>
  <style>
    :root {{
      --bg: #16212b;
      --bg-soft: #223241;
      --paper: #f1eadc;
      --paper-deep: #ded2bc;
      --ink: #18202a;
      --muted: #5d6570;
      --line: #b9ab91;
      --teal: #1f5b58;
      --teal-dark: #163f42;
      --rust: #8f4b39;
      --gold: #a87945;
      --shadow: rgba(5, 12, 18, 0.38);
    }}
    * {{ box-sizing: border-box; }}
    body {{
      margin: 0;
      color: var(--ink);
      background:
        radial-gradient(circle at 20% 0%, rgba(49, 91, 101, 0.46), transparent 28rem),
        linear-gradient(140deg, var(--bg), var(--bg-soft));
      font-family: "Iowan Old Style", "Songti SC", "Noto Serif CJK SC", Georgia, serif;
      line-height: 1.55;
    }}
    .sheet {{
      width: min(1120px, calc(100vw - 32px));
      margin: 32px auto;
      background: var(--paper);
      border: 1px solid rgba(255, 255, 255, 0.2);
      box-shadow: 0 24px 70px var(--shadow);
      position: relative;
      overflow: hidden;
    }}
    .sheet::before {{
      content: "";
      position: absolute;
      inset: 0;
      pointer-events: none;
      background:
        linear-gradient(90deg, rgba(31, 91, 88, 0.09), transparent 34%),
        repeating-linear-gradient(0deg, rgba(24, 32, 42, 0.018), rgba(24, 32, 42, 0.018) 1px, transparent 1px, transparent 5px);
      mix-blend-mode: multiply;
    }}
    .content {{ position: relative; z-index: 1; }}
    header {{
      display: grid;
      grid-template-columns: minmax(280px, 360px) 1fr;
      min-height: 450px;
      border-bottom: 1px solid var(--line);
    }}
    .portrait {{
      margin: 0;
      border-right: 1px solid var(--line);
      background: #111923;
      position: relative;
      min-height: 450px;
    }}
    .portrait img {{
      width: 100%;
      height: 100%;
      min-height: 450px;
      object-fit: cover;
      display: block;
    }}
    .portrait figcaption {{
      position: absolute;
      left: 18px;
      bottom: 16px;
      padding: 4px 9px;
      color: #f4ead8;
      background: rgba(11, 22, 29, 0.72);
      font-size: 11px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }}
    .identity {{
      padding: 42px 44px 32px;
      display: flex;
      flex-direction: column;
      gap: 26px;
    }}
    .file-label {{
      align-self: flex-start;
      padding: 5px 10px;
      color: var(--paper);
      background: var(--teal-dark);
      font: 700 12px/1.2 ui-sans-serif, system-ui, sans-serif;
      letter-spacing: 0.12em;
      text-transform: uppercase;
    }}
    h1 {{
      margin: 0;
      color: var(--teal-dark);
      font-size: clamp(42px, 6vw, 76px);
      line-height: 0.96;
      font-weight: 800;
    }}
    .roman {{
      color: var(--muted);
      margin-top: 10px;
      font-size: 18px;
      font-style: italic;
    }}
    .summary {{
      max-width: 650px;
      margin: 0;
      font-size: 18px;
      color: #28313b;
    }}
    .meta-grid, .vitals {{
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 10px;
    }}
    .meta, .vital {{
      border: 1px solid var(--line);
      background: rgba(255, 255, 255, 0.24);
      padding: 10px 12px;
    }}
    .meta span, .vital span {{
      display: block;
      color: var(--muted);
      font: 700 11px/1.2 ui-sans-serif, system-ui, sans-serif;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }}
    .meta strong, .vital strong {{
      display: block;
      margin-top: 5px;
      font-size: 18px;
    }}
    main {{
      display: grid;
      grid-template-columns: 0.95fr 1.05fr;
      gap: 30px;
      padding: 34px 38px 42px;
    }}
    .section {{
      margin-bottom: 30px;
    }}
    h2 {{
      margin: 0 0 14px;
      padding-bottom: 8px;
      color: var(--teal-dark);
      border-bottom: 2px solid var(--teal);
      font-size: 22px;
      letter-spacing: 0.03em;
    }}
    .attribute-grid {{
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 10px;
    }}
    .attribute {{
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: 10px;
      min-height: 68px;
      border: 1px solid var(--line);
      background: rgba(255, 255, 255, 0.2);
      padding: 12px;
    }}
    .attribute span {{
      display: block;
      font-size: 17px;
      font-weight: 700;
    }}
    .attribute small {{
      color: var(--muted);
      font: 700 11px/1.2 ui-sans-serif, system-ui, sans-serif;
      letter-spacing: 0.08em;
    }}
    .attribute strong {{
      color: var(--rust);
      font-size: 28px;
      line-height: 1;
    }}
    .skills {{
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
    }}
    .skill {{
      border: 1px solid rgba(185, 171, 145, 0.9);
      background: rgba(255, 255, 255, 0.25);
      padding: 10px 11px;
    }}
    .skill-line {{
      display: flex;
      justify-content: space-between;
      gap: 12px;
      font-weight: 700;
    }}
    .skill-line span {{
      min-width: 0;
      overflow-wrap: anywhere;
    }}
    .skill-line strong {{
      color: var(--teal-dark);
      font-size: 19px;
    }}
    .meter {{
      height: 6px;
      margin: 8px 0 6px;
      background: rgba(22, 63, 66, 0.16);
      overflow: hidden;
    }}
    .meter span {{
      display: block;
      height: 100%;
      background: linear-gradient(90deg, var(--teal), var(--gold));
    }}
    .skill small {{
      color: var(--muted);
      font: 600 11px/1.2 ui-sans-serif, system-ui, sans-serif;
    }}
    .tags {{
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }}
    .tag {{
      border: 1px solid rgba(31, 91, 88, 0.28);
      background: rgba(31, 91, 88, 0.08);
      padding: 5px 8px;
      font-size: 13px;
    }}
    table {{
      width: 100%;
      border-collapse: collapse;
      background: rgba(255, 255, 255, 0.2);
      border: 1px solid var(--line);
    }}
    th, td {{
      padding: 9px 10px;
      border-bottom: 1px solid rgba(185, 171, 145, 0.65);
      text-align: left;
      vertical-align: top;
    }}
    th {{
      color: var(--paper);
      background: var(--teal-dark);
      font: 700 12px/1.2 ui-sans-serif, system-ui, sans-serif;
      letter-spacing: 0.06em;
    }}
    .backstory {{
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 14px;
    }}
    .backstory div {{
      border-left: 4px solid var(--gold);
      background: rgba(255, 255, 255, 0.2);
      padding: 12px 14px;
    }}
    .backstory h3 {{
      margin: 0 0 8px;
      color: var(--teal-dark);
      font-size: 17px;
    }}
    ul {{
      margin: 0;
      padding-left: 1.2em;
    }}
    li + li {{ margin-top: 6px; }}
    footer {{
      border-top: 1px solid var(--line);
      padding: 14px 38px 18px;
      color: var(--muted);
      font: 600 12px/1.4 ui-sans-serif, system-ui, sans-serif;
      display: flex;
      justify-content: space-between;
      gap: 12px;
    }}
    @media (max-width: 880px) {{
      header, main {{
        grid-template-columns: 1fr;
      }}
      .portrait {{
        border-right: 0;
        border-bottom: 1px solid var(--line);
      }}
      .meta-grid, .vitals, .attribute-grid, .skills, .backstory {{
        grid-template-columns: 1fr;
      }}
      .identity, main, footer {{
        padding-left: 22px;
        padding-right: 22px;
      }}
      .sheet {{
        width: min(100vw - 16px, 1120px);
        margin: 8px auto;
      }}
    }}
    @media print {{
      body {{ background: white; }}
      .sheet {{
        width: 100%;
        margin: 0;
        box-shadow: none;
        border: 0;
      }}
      .portrait img {{ max-height: 520px; }}
    }}
  </style>
</head>
<body>
  <article class="sheet">
    <div class="content">
      <header>
        {portrait_html}
        <section class="identity">
          <div class="file-label">1920年代调查员档案</div>
          <div>
            <h1>{_html(name)}</h1>
            <div class="roman">{_html(canonical_name)}</div>
          </div>
          <p class="summary">{_html(summary)}</p>
          <div class="meta-grid">
            <div class="meta"><span>战役</span><strong>{_html(title)}</strong></div>
            <div class="meta"><span>年代</span><strong>{_html(sheet.get("era", ""))}</strong></div>
            <div class="meta"><span>国籍</span><strong>{_html(sheet.get("nationality", ""))}</strong></div>
            <div class="meta"><span>年龄</span><strong>{_html(sheet.get("age", ""))}</strong></div>
            <div class="meta"><span>职业</span><strong>{_html(sheet.get("occupation", ""))}</strong></div>
            <div class="meta"><span>语言</span><strong>zh-Hans</strong></div>
          </div>
          <div class="vitals">{derived_html}</div>
        </section>
      </header>
      <main>
        <section>
          <div class="section">
            <h2>属性</h2>
            <div class="attribute-grid">{characteristics_html}</div>
          </div>
          {weapons_html}
        </section>
        <section>
          <div class="section">
            <h2>核心技能</h2>
            <div class="skills">{skills_html}</div>
          </div>
          <div class="section">
            <h2>其他技能</h2>
            <div class="tags">{other_skills_html}</div>
          </div>
        </section>
      </main>
      <section class="section" style="padding: 0 38px 38px;">
        <h2>背景</h2>
        <div class="backstory">{detail_html}</div>
      </section>
      <footer>
        <span>由 coc_character_card.py 生成</span>
        <span>{_html(generated_at)}</span>
      </footer>
    </div>
  </article>
</body>
</html>
"""


def render_cards(
    character_path: Path,
    campaign_path: Path,
    out_dir: Path,
    *,
    repo_root: Path,
    language: str = "zh-Hans",
    html_mode: str | bool = "auto",
    playwright_detected: bool | None = None,
    write_back: bool = False,
) -> dict[str, str]:
    character = _load_json(character_path)
    campaign = _load_json(campaign_path)
    sheet = _display_sheet(character, language)
    slug = _slugify(_identity_name(character, sheet))
    out_dir.mkdir(parents=True, exist_ok=True)
    markdown_path = out_dir / f"{slug}-character-card.md"

    markdown_path.write_text(
        render_markdown(
            character,
            campaign,
            language=language,
            output_path=markdown_path,
            repo_root=repo_root,
            source_path=character_path,
        ),
        encoding="utf-8",
    )

    result: dict[str, str] = {
        "markdown_path": _repo_relative(markdown_path, repo_root),
        "language": language,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }
    if _should_render_html(html_mode, playwright_detected):
        html_path = out_dir / f"{slug}-character-card.html"
        html_path.write_text(
            render_html(
                character,
                campaign,
                language=language,
                output_path=html_path,
                repo_root=repo_root,
                source_path=character_path,
            ),
            encoding="utf-8",
        )
        result["html_path"] = _repo_relative(html_path, repo_root)
    if write_back:
        character["character_cards"] = result
        _write_json(character_path, character)
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--character", type=Path, required=True, help="confirmed character or creation draft JSON")
    parser.add_argument("--campaign", type=Path, required=True, help="campaign.json path")
    parser.add_argument("--out-dir", type=Path, required=True, help="directory for generated card files")
    parser.add_argument("--repo-root", type=Path, default=Path.cwd())
    parser.add_argument("--language", default="zh-Hans")
    parser.add_argument(
        "--html",
        choices=("auto", "always", "never"),
        nargs="?",
        const="always",
        default="auto",
        help="HTML output policy: auto detects Playwright, always forces HTML, never emits Markdown only",
    )
    parser.add_argument("--write-back", action="store_true", help="record generated card paths in the source JSON")
    args = parser.parse_args()

    result = render_cards(
        args.character,
        args.campaign,
        args.out_dir,
        repo_root=args.repo_root,
        language=args.language,
        html_mode=args.html,
        write_back=args.write_back,
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
