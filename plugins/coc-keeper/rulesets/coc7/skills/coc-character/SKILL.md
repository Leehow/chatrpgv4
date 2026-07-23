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
- After the custom campaign exists and before constructing the final creation
  payload, invoke `coc_invoke` once with
  `operation="setup.investigator_contract"` and `arguments` containing exactly
  that `campaign_id`. Retain the returned package-owned
  `result.payload_schema` through confirmation. It is the upfront machine
  contract for both deterministic Quick Fire and complete-sheet input; do not
  infer the shape from `setup.invoke`'s ruleset-agnostic object shell or query
  it again before `investigator.create`. Existing deterministic runtime
  validation and arithmetic remain authoritative.
- If the campaign has a bound scenario or PDF module, show the player-safe
  character creation briefing before rolling characteristics or choosing an
  occupation. Prefer the exact
  `result.character_creation_briefing.briefing_path` from the
  `scenario.bind_pdf` receipt; otherwise use the existing
  `campaign.character_creation.briefing_path` when present. Read that exact
  workspace-rooted path once, without `find`, `ls`, glob, or directory listing.
  Only call the shared `campaign.render_briefing` setup operation when neither
  path exists or player-safe public setup metadata later changes. The briefing
  gives module mood and investigator-fit guidance without Keeper-only spoilers.
- Before rolling or assigning characteristics, ask the player to choose the
  characteristic generation method. Supported methods are the rules JSON
  entries in `../../rules-json/characteristic-dice.json`: roll in fixed
  order, roll a pool then assign results, point-buy 460, or Quick Fire array.
  Record the selected method in the creation draft and validate fixed/point-buy
  values with `../../../../scripts/coc_character.py`.
- **Quick Fire deterministic materialization:** after semantic assignment,
  submit `creation.method="quick_fire_array"`,
  `creation.characteristic_assignment_order` as the eight unique canonical
  characteristic keys in descending array-slot order, and
  `creation.luck_roll_total` as the authoritative 3D6 total. Omit
  `sheet.characteristics` and `sheet.derived`; `investigator.create` copies the
  configured `[80,70,60,60,50,50,50,40]` array, multiplies Luck by five, and
  derives HP/MP/SAN/DB/Build/MOV deterministically. The Keeper still owns the
  concept and semantic priority order. Complete-sheet legacy creation remains
  valid when those two materialization fields are absent.
- **Quick-Fire Luck exact recipe:** invoke `coc_invoke` exactly once with
  `operation="rules.roll_dice"`, the current campaign, and `arguments`
  containing exactly `expression="3D6"`, a stable creation-scoped
  `decision_id`, and `reason="Quick-Fire investigator Luck"`. Reuse the same
  `decision_id` value on retry. Apply the COC7 creation formula to the
  authoritative returned total as `creation.luck_roll_total`; the setup rules
  layer performs `Luck = total × 5`. Do not call `rules.roll`,
  invent `rules.roll_expression`, browse the `setup` or `rules` catalogs, omit
  `decision_id`, or send the unsupported expression `3D6*5`. This exact dice
  recipe preserves deterministic rolls; investigator concept, characteristic
  assignment, occupation, backstory, and final character craft remain live
  semantic Keeper work.
- After the player confirms the final parameters, reuse the canonical
  `setup.invoke` card already returned by setup inspection and construct its
  `investigator.create` payload from the retained
  `setup.investigator_contract` schema; do not rediscover either operation or
  guess a second setup shape. Invoke `investigator.create` once with a JSON
  object (never a JSON-encoded string) whose payload contains only the fields
  allowed by the selected contract branch. Before sending, ensure the machine
  `sheet` itself contains `id` equal to that same `investigator_id` and a
  non-empty `name`. Except for the deterministic Quick Fire materialization
  shape above, include all eight `characteristics` (`STR`, `CON`, `SIZ`, `DEX`,
  `APP`, `INT`, `POW`, `EDU`), while preserving the rest of the confirmed
  sheet. Before the create call, follow the returned schema's machine-sheet
  requirements: `derived` has `HP`, `MP`, `SAN`, `Luck`, `DB`, `Build`, and
  `MOV`; a named creation method still validates against its rules array/budget;
  and every `skills` key is the canonical English machine key, including exact
  `Credit Rating`. Never put Chinese labels such as `信用评级` or `侦查` in
  `sheet.skills`; localized labels belong only in `player_facing_sheet_zh`.
  Compute derived values through the COC7 rules contract rather than translating
  or estimating them. In the machine sheet, zero damage bonus is the canonical
  string `"none"`, never the display value `"0"`; `Build` remains integer `0`.
  The setup operation rejects an invalid machine sheet
  before writing reusable character state. If the normal flow will render a Chinese
  card, put the confirmed localized view in `sheet.player_facing_sheet_zh`
  before this one create call; do not postpone it until after the machine sheet
  has been stored. If that localized view is intentionally absent, skip
  `investigator.render_card` and continue setup—the card is not an opening
  gate. After the create PASS receipt, attach it with the
  exact `campaign.link_investigator` payload (`campaign_id` and the
  `investigator_ids` array), then call `investigator.render_card` with
  `campaign_id`, `investigator_id`, and only its optional `language` /
  `html_mode` fields. Do not repeat a successful setup step. Pi calls the same
  setup gateway. The render operation turns confirmed
  `player_facing_sheet_<language>` data into Markdown, including an existing
  portrait asset when present; it defaults to Markdown only for host parity,
  so set `html_mode` to `auto` or `always` only when a browser/print artifact
  is wanted.
- A possession established in the confirmed backstory or character sheet is
  creation data, not a new runtime grant. Keep a letter, heirloom, notebook,
  or similar narrative hook in the sheet's backstory/equipment representation;
  do not also call `state.item_grant` merely because the player confirms they
  already carry it. Reserve runtime inventory operations for an effective item
  newly gained or lost during play, and then follow that operation's returned
  canonical card instead of guessing its arguments.
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

Use `../../../../scripts/coc_character.py` for derived values and validation. Use
`../../../../scripts/coc_state.py` to create or link investigator files. Use the
exact `result.character_creation_briefing.briefing_path` from the
`scenario.bind_pdf` receipt before guided creation when it is present; do not
rerender or rediscover that path. Use the shared `campaign.render_briefing`
setup operation only when the path is absent or player-safe public setup
metadata later changes. Use
`investigator.render_card` after confirmation to render localized Markdown
character cards, with optional auto-detected HTML enhancement. The underlying
renderer scripts remain available for isolated diagnostics.
