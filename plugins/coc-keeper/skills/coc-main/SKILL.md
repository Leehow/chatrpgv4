---
name: coc-main
description: Activate and orchestrate COC mode in Codex. Use only when the user explicitly asks to activate, enter, continue, pause, save, or exit Call of Cthulhu play inside Codex.
---

# COC Main

## Activation

Use this skill only after an explicit COC activation request such as `activate COC mode`, `enter COC mode`, `start COC game`, `continue COC campaign`, or equivalent Chinese natural language.

Do not proactively offer COC mode during ordinary Codex work.

## Workflow

1. Load `../../references/mode-protocol.md`.
2. If no `.coc/` workspace exists, use `../../scripts/coc_state.py` through Python or direct function inspection to create it.
3. Select the visible play language at campaign setup, defaulting to `zh-Hans`, and persist it as `play_language`.
4. Select or create a campaign before character creation or play.
5. **Scenario onboarding (mandatory for new campaigns).** If the selected campaign is newly created and has no bound scenario (`active_scenario_id` is empty), you MUST proactively present a clear, beginner-facing choice before doing anything else:

   > **你有现成的剧本吗？ / Do you have a scenario ready?**
   >
   > 🅰️ 我有剧本 PDF / 剧本资料 → 用 `coc-scenario-import` 导入你的剧本（I have a scenario PDF/notes → import it with `coc-scenario-import`）
   > 🅱️ 我是新手，想直接开玩 → 我们内置了开箱即玩的剧本，装上就能玩，无需任何 PDF（I'm new / I want to play right now → pick a built-in starter scenario）
   >
   > Built-in starter scenarios (run `coc-starter list` for the current list):
   > - **《白色战争》The White War** — 1916 年意大利阿尔卑斯前线，一支山地巡逻队调查冰川上传来的怪响，唤醒冰封万年的远古存在。开箱即玩。

   To install a chosen built-in scenario into the campaign, run:
   ```bash
   python3 ../../scripts/coc_starter.py install --campaign <campaign-id> --scenario <scenario-id>
   ```
   Never skip this prompt for a new empty campaign, and never wait for the user to ask. This is how new players discover they can play without owning a PDF. Continue old campaigns or campaigns that already have a bound scenario without prompting.
6. Bind or import a scenario with `coc-scenario-import` (for user-provided scenarios), extending `localized_terms` for the campaign language when names, places, handouts, scenario titles, or special terms need customary local rendering.
7. Select, create, or link investigators with `coc-character`.
8. Route ordinary play to `coc-keeper-play`.
9. Route rules questions and challenges to `coc-meta`.
10. Route combat, chase, and sanity events to their subsystem skills.
11. On pause or exit, summarize safely, write memory/log entries, and leave COC mode.

## Hard Rules

- Keep the user-facing experience immersive unless the user enters `[meta]`.
- Use ASCII system markers only.
- Use `[spoiler_warning]` before revealing Keeper-only information.
- Treat rules JSON as the runtime authority for common calculations.
- Render player-visible dialogue, skill display names, and visible Mechanical Log summaries in `play_language`; keep machine markers, JSON keys, canonical skill keys, rule enum values, and hidden Mechanical Log audit anchors stable.
- **For any newly created campaign with no bound scenario, you MUST proactively offer the scenario onboarding choice (built-in vs imported) before proceeding — never skip it, never wait for the user to ask.** New players do not know built-in scenarios exist; this prompt is the only way they find out. Phrase it in plain, beginner-friendly language and name every available built-in scenario with a one-line pitch.
