---
name: coc-character
description: Create and maintain reusable Call of Cthulhu investigators. Use for full guided investigator creation, quick generation, derived values, age modifiers, validation, development, and cross-campaign character history.
---

# COC Character

## Character Storage

Reusable investigators live under `.coc/investigators/<investigator-id>/`. Campaigns link to investigators instead of owning them. Keep the original creation workflow in `creation.json` and the reusable long-term sheet in `character.json`.

Temporary campaign-specific investigator state lives under `.coc/campaigns/<campaign-id>/save/investigator-state/`.

## Workflows

- Full guided creation: characteristics, age, occupation, skills, backstory, equipment, derived values.
- Quick creation: ask for a concept, generate a valid investigator, then ask for confirmation.
- If the campaign has a bound scenario or PDF module, show the player-safe
  character creation briefing before rolling characteristics or choosing an
  occupation. Use the existing `campaign.character_creation.briefing_path` when
  present; otherwise generate it with
  `../../scripts/coc_character_creation_briefing.py`. The briefing gives module
  mood and investigator-fit guidance without Keeper-only spoilers.
- After the player confirms the final parameters, generate a reusable machine
  sheet plus player-facing character cards. Use `../../scripts/coc_character_card.py`
  to render the confirmed `player_facing_sheet_<language>` data into Markdown,
  including an existing portrait asset when present. The script's default
  `--html auto` also emits a static HTML card when Playwright is detected; use
  `--html never` for Markdown-only environments.
- Import: validate JSON before linking it to a campaign.
- Development: write permanent changes back to investigator history only at explicit development or campaign-ending moments.

## Player-Facing Localization

Render player-visible character creation prompts, confirmations, and character
sheets in the campaign `play_language`, defaulting to `zh-Hans`. Keep JSON keys,
canonical skill keys, rule enum values, and audit anchors stable in English, and
add localized display companions for player surfaces.

For Chinese play, show characteristics, derived attributes, occupations, skills,
weapons, equipment, and backstory labels in Chinese. Use translated labels such
as `力量`, `体质`, `敏捷`, `外貌`, `意志`, `体型`, `智力`, `教育`, `幸运`,
`生命值`, `魔法值`, `理智`, `移动力`, `射击（手枪）`, `闪避`, `图书馆使用`,
`侦查`, `聆听`, `神秘学`, and `信用评级`. Preserve the canonical source key
beside or beneath the display label only when a debugging or audit view needs it.

When a language specialization is known, render it in the visible label, e.g.
`母语（芬兰语）` for canonical `Language (Own)` or `外语（拉丁语）` for canonical
`Language (Other: Latin)`.

## Scripts

Use `../../scripts/coc_character.py` for derived values and validation. Use
`../../scripts/coc_state.py` to create or link investigator files. Use
`../../scripts/coc_character_creation_briefing.py` before guided creation when
a scenario is already bound. Use
`../../scripts/coc_character_card.py` after confirmation to render localized
Markdown character cards, with optional auto-detected HTML enhancement.
