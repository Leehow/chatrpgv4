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
3. Select or create a campaign before character creation or play.
4. Bind or import a scenario with `coc-scenario-import`.
5. Select, create, or link investigators with `coc-character`.
6. Route ordinary play to `coc-keeper-play`.
7. Route rules questions and challenges to `coc-meta`.
8. Route combat, chase, and sanity events to their subsystem skills.
9. On pause or exit, summarize safely, write memory/log entries, and leave COC mode.

## Hard Rules

- Keep the user-facing experience immersive unless the user enters `[meta]`.
- Use ASCII system markers only.
- Use `[spoiler_warning]` before revealing Keeper-only information.
- Treat rules JSON as the runtime authority for common calculations.
