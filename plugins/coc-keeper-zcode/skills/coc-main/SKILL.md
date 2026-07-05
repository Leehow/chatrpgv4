---
name: coc-main
description: Activate and orchestrate COC mode in ZCode. Use only when the user explicitly asks to activate, enter, continue, pause, save, or exit Call of Cthulhu play inside ZCode.
---

# COC Main

## Activation

Use this skill only after an explicit COC activation request such as `activate COC mode`, `enter COC mode`, `start COC game`, `continue COC campaign`, or equivalent Chinese natural language.

Do not proactively offer COC mode during ordinary ZCode work.

## Workflow

1. Load `../../references/mode-protocol.md`.
2. If no `.coc/` workspace exists, use `../../scripts/coc_state.py` through Python or direct function inspection to create it.
3. Select the visible play language at campaign setup, defaulting to `zh-Hans`, and persist it as `play_language`.
4. Select or create a campaign before character creation or play.
5. Bind or import a scenario with `coc-scenario-import`, extending `localized_terms` for the campaign language when names, places, handouts, scenario titles, or special terms need customary local rendering.
6. Select, create, or link investigators with `coc-character`.
7. Route ordinary play to `coc-keeper-play`.
8. Route rules questions and challenges to `coc-meta`.
9. Route combat, chase, and sanity events to their subsystem skills.
10. On pause or exit, summarize safely, write memory/log entries, and leave COC mode.

## Hard Rules

- Keep the user-facing experience immersive unless the user enters `[meta]`.
- Use ASCII system markers only.
- Use `[spoiler_warning]` before revealing Keeper-only information.
- Treat rules JSON as the runtime authority for common calculations.
- Render player-visible dialogue, skill display names, and visible Mechanical Log summaries in `play_language`; keep machine markers, JSON keys, canonical skill keys, rule enum values, and hidden Mechanical Log audit anchors stable.
