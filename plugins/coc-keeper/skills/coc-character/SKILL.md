---
name: coc-character
description: Create, select, validate, localize, and display reusable Call of Cthulhu investigators. Use for guided or quick investigator creation, derived values, age modifiers, reusable character selection, localized cards, and cross-campaign character history; use coc-development for post-session advancement.
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
  present; otherwise call the shared `campaign.render_briefing` setup
  operation. The briefing gives module
  mood and investigator-fit guidance without Keeper-only spoilers.
- Before rolling or assigning characteristics, ask the player to choose the
  characteristic generation method. Supported methods are the rules JSON
  entries in `references/rules-json/characteristic-dice.json`: roll in fixed
  order, roll a pool then assign results, point-buy 460, or Quick Fire array.
  Record the selected method in the creation draft and validate fixed/point-buy
  values with `../../scripts/coc_character.py`.
- After the player confirms the final parameters, persist the reusable machine
  sheet through the shared `investigator.create` setup operation and attach it
  with `campaign.link_investigator`. Pi calls the same setup gateway. Then call
  the shared `investigator.render_card` setup operation
  to render the confirmed `player_facing_sheet_<language>` data into Markdown,
  including an existing portrait asset when present. The shared operation
  defaults to Markdown only for host parity; explicitly set `html_mode` to
  `auto` or `always` when a browser/print artifact is wanted.
- Import: validate JSON before linking it to a campaign.
- Personal horror hooks: at the end of creation, once backstory is confirmed,
  derive 1-2 initial hooks from the strongest backstory entries (a missing
  significant person, an heirloom possession, a haunted meaningful location…)
  and record them with `coc_state.add_personal_horror_hook(campaign_dir,
  investigator_id, hook_id=..., backstory_field=..., summary=...)`. The
  `backstory_field` must be one of the nine p.157 categories. These hooks are
  what the Story Director weaves into CHARACTER beats and pays off later.

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

Do not let raw `backstory` fields leak into Chinese character cards. Put all
player-visible background prose and detail blocks in `player_facing_sheet_zh`
(`backstory_summary` and optional `backstory_details`) before rendering. Raw
English/canonical backstory is audit data unless explicitly localized.

<!-- HOST_NATIVE_IMAGEGEN_BEGIN -->
## Host-Native Portrait Generation

Portrait generation uses the **current host's built-in image tool** when one
exists. Prefer that host tool; do not call another host's image stack (for
example, do not invoke Codex `imagegen` while running on Grok Build).

| Host | Built-in image path | Portrait behavior |
|------|---------------------|-------------------|
| **Codex** | system `imagegen` skill + built-in `image_gen` (no `OPENAI_API_KEY`) | generate when the user asks |
| **Grok Build** | built-in `image_gen` / Imagine | generate when the user asks |
| **Claude Code / Cursor / Kimi / hosts without image tools** | none | skip portrait generation; continue character creation |

When generating:

1. Use the investigator's confirmed identity, age, nationality, era,
   occupation, backstory, equipment, and campaign tone for a concise historical
   portrait prompt.
2. Avoid spoilers, Mythos reveals, modern clothing, modern weapons, and action
   poses unless the user explicitly requests them.
3. Copy every project-referenced portrait into the workspace. Prefer
   `.coc/investigators/<investigator-id>/portraits/` after the reusable
   investigator exists. During campaign setup before a final investigator id
   exists, use `.coc/campaigns/<campaign-id>/assets/portraits/`.
4. Record the final asset path, prompt summary, generation tool/host, and
   status in the creation draft or investigator sheet under a `portrait` field.
   Do not leave a project-referenced portrait only under a host cache such as
   `$CODEX_HOME/generated_images` or a Grok session image temp path.
<!-- HOST_NATIVE_IMAGEGEN_END -->

## Scripts

Use `../../scripts/coc_character.py` for derived values and validation. Use
`../../scripts/coc_state.py` to create or link investigator files. Use the
shared `campaign.render_briefing` setup operation before guided creation when a
scenario is already bound. Use `investigator.render_card` after confirmation
to render localized Markdown character cards, with optional auto-detected HTML
enhancement. The underlying renderer scripts remain available for isolated
diagnostics.
