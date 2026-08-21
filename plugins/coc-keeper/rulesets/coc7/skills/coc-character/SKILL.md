---
name: coc-character
description: Create, select, validate, localize, and display reusable Call of Cthulhu investigators. Use for guided or quick investigator creation, derived values, age modifiers, reusable character selection, localized cards, and cross-campaign character history; use coc-development for post-session advancement.
---

# COC Character

## Character Storage

Reusable investigators live under `.coc/investigators/<investigator-id>/`. Campaigns link to investigators instead of owning them. Keep the original creation workflow in `creation.json` and the reusable long-term sheet in `character.json`.

Temporary campaign-specific investigator state lives under `.coc/campaigns/<campaign-id>/save/investigator-state/`.

## Workflows

- **Ordinary KP path (required):** one semantic `coc_chargen_delegate` / `setup.chargen_run` after the player confirms the draft (same-turn write only when they already gave enough to complete, or explicitly asked to finish now). KP-facing fields are exactly `campaign_id`, `investigator_id`, `name`, `occupation_name`, optional `occupation_label` (zh-Hans when the catalog key is English), optional `own_language` (concrete play_language name such as 英语/国语; machine skill key stays `Language (Own)`), optional `age` 15–89, optional eight-key `assignment_priority`, optional `occupation_skill_names` / `interest_skill_names`, optional `luck` `{mode:auto_roll}`, optional `backstory`, `equipment`, `key_connection`. Never send `occupation_allocations`, `interest_allocations`, cash, or other numbers. Runtime selects `guided_quick_fire` vs `kp_guided_era_adaptive` from campaign era. Dice, age modifiers (EDU checks `purpose=investigator_creation_characteristic`; 15–19 dual Luck `investigator_creation_luck`), CR cash, `Language (Own)=EDU`, `Dodge=½DEX` stay in Python. half/fifth are card-projection only. Do not hand-assemble `investigator.create` on a standard Quick Fire era. Direct `investigator.create` is for imports/tests/runtime adaptive only.
- **Age dice receipts (generated create only).** Putting `sheet.age` on `guided_quick_fire` / `kp_guided_era_adaptive` asserts that age bracket: attach `edu_improvement_rolls` (count = bracket EDU checks) with `check_receipt` `{campaign_id,decision_id,roll_id}` bound to `rules.roll_dice` `1D100` `purpose=investigator_creation_characteristic`, and `improve_receipt` for each successful `1D10`; if the bracket keeps highest of N Luck rolls, attach `luck_roll_candidates` of N `3D6` `investigator_creation_luck` receipts. Omitting those receipts while asserting age is rejected. `creation.input_mode=import_complete_sheet` (pregen / `setup.quick_start`) sends finished characteristics and **must omit** this dice bundle — age there is biographical, not an improvement assertion.
- **Single completion path (behavior ladder).** There are not two modes. Already-given facts are hard constraints: never overwrite, never re-ask. First table question is **only** 姓名+职业概念.
  - **Empty endpoint:** the player gives name+occupation and explicitly grants the rest (「其余全由你定」/「你来定」). Do **not** chase missing dimensions with more questions. Semantically fill age, 3–6 first-six backstory strands, a **module-specific** `scenario_bound`, `equipment`, `key_connection`, `occupation_label`, and `own_language`. Present the complete draft the same turn (no invented dice or cash numbers). Call `coc_chargen_delegate` after they confirm that draft, or on that turn only if they also asked to write the card now.
  - **Partial:** they gave some of those dimensions. Ask at most 1–3 evocative in-fiction questions, **one at a time, only for still-missing** strands. After a first answer that is only name+occupation **without** granting the rest, never call `coc_chargen_delegate` on that turn.
  - **Given:** anything they already stated is locked.
  Leave 伤痕 / 恐惧与躁狂 / 秘典遭遇 for play. After the write, present `result.player_summary_zh` and the card 「## 玩家摘要」 sentences **verbatim** (every 成功/失败 and every cash/assets/spending number). Do not paraphrase, omit, invert judgments, or say「以卡内为准」。
- **Module-aware suggestions (required, not optional).** Use the player-safe module briefing (era, place, premise) to **offer** parameters: language that the opening actually needs, era-and-place occupations, and carried items that belong on this table. Suggest in Keeper voice; do not quiz. A 1920s American opening cannot leave the investigator unable to speak English. If `own_language` is not the module working language (e.g. 国语 at a Boston table), the delegate **must** include that working language in `occupation_skill_names` or `interest_skill_names` as `Language (English)` or `Other Language (English)` so the allocator writes it; saying 英语 in prose without the skill name does not persist. Runtime 1920s/modern default `own_language` to 英语 only when KP omits it; override when the fiction is not Anglophone. If `setup.chargen_run` returns a language warning, treat it as advisory: missing skill means they cannot operate in the module tongue; a value below the rulebook Professional band (50%) means only limited talk, not independent files/interviews/legal diction. Offer replace=True to raise it, or keep the weakness and arrange a translator/companion. The player may insist on the low setting; never silently overwrite that hard constraint.
- **`scenario_bound` is a module hook.** It must name this module's concrete opening, not a generic 「被卷入一件怪事」. When the player asks for involvement ideas, KP gives **at least one concrete suggestion already hooked on that opening** (e.g. 「Knott 的委托信已经到了你手上，约你今晚去看宅子」), optionally with one backup, not an open quiz of 熟人介绍/登报/委托. On empty or partial endpoints, fill the chosen hook on the draft.
- **Guidance closed loop.** KP tells the player these points up front (母语落具体语种、模组化卷入、时代得体的职业与随身物) as suggestions, not a form. Whatever the player description omitted among language / hook / gear is filled at the final draft from module context and shown there. Player-stated facts stay hard constraints: do not overwrite, do not re-ask.
- 红线：全程不超游，参数一律幕后派生，绝不向玩家提问数值，也绝不由 KP 把现金/资产/消费水平数字写进委托参数。
- **Naming craft.** Fit the investigator's name to `campaign.era` and the scenario's place and culture by semantic judgment: a 1920s Boston table uses period-fitting American names; a Chinese given name only when the fiction or background supports it (for example a Chinatown diaspora). 语言≠族裔：`play_language` zh-Hans does not make the character Chinese; names follow in-world culture. If the player only gives a nickname (如「大手」), treat it as a sobriquet: supply an era-and-culture formal name in fiction, and let the player correct it at confirmation—do not force a stock Chinese full name. When rendering a foreign name in zh-Hans, use a proper-character 译名 and, if needed, a reading in parentheses. Avoid stock/cliché names; a mono-cultural setting still varies region, class, or dialect so the table is not one surname. Before locking a name, self-check: 这个名字贴合 era/地域/文化吗？我是不是因为桌面语言是中文就默认了中国名？ Invent names from the Keeper's own knowledge of era, place, and culture; do not rely on a fixed name pool or a copied menu. This is Keeper semantic craft: no keyword/regex gate, no injected random-pool code.
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
  Treat the document as source context: summarize its useful substance
  conversationally in the campaign `play_language`, then ask exactly one next
  character-creation question. Never dump the Markdown document, its headings,
  generation metadata, or operational instructions into table chat.
- When the player selects an L0 module pregen with a source-backed complete
  `stats_ref` (for example, the module appendix), do not ask for a
  characteristic-generation method and do not roll Luck. Obtain every required
  source value through the canonical read-only delivery/notebook surfaces, then
  submit the complete sheet with `creation.input_mode="import_complete_sheet"`;
  omit `campaign_id`, `luck_roll_total`, and `luck_roll_receipt`. This is the
  preset route in a Pi live opening, including an era without the package-owned
  standard Quick Fire sheet. For a custom investigator, before rolling or
  assigning characteristics, ask the player to choose the characteristic
  generation method. Supported methods are the rules JSON entries in
  `../../rules-json/characteristic-dice.json`: roll in fixed order, roll a pool
  then assign results, point-buy 460, or Quick Fire array. Record the selected
  method in the creation draft and validate fixed/point-buy values with
  `../../../../scripts/coc_character.py`.
- **Quick Fire deterministic materialization:** after semantic assignment,
  submit exactly the `investigator.create` payload contract (first `oneOf`
  branch). Allowed top-level keys are only `campaign_id`, `investigator_id`,
  `sheet`, and `creation`. Do not send top-level `name`, `occupation`,
  `assignment_order`, or `interest_allocation_intent`.
  `sheet` required keys: `id`, `name`, `skills`, `player_facing_sheet_zh`.
  Optional roleplay keys on that sheet (ordinary path: pass them on
  `setup.chargen_run` / `coc_chargen_delegate`, not by hand-assembling create):
  `backstory` (object; keys only `personal_description`, `ideology_beliefs`,
  `significant_people`, `meaningful_locations`, `treasured_possessions`,
  `traits`, `injuries_scars`, `phobias_manias`, `encounters`, `scenario_bound`;
  values are play_language prose strings; canonical ideology
  key is `ideology_beliefs`, never `ideology`), `equipment` (array of
  era-fitting item strings), `key_connection` (object with exactly
  `backstory_field` from the first six p.157 categories — `personal_description`,
  `ideology_beliefs`, `significant_people`, `meaningful_locations`,
  `treasured_possessions`, `traits` — plus prose `summary`), and machine
  `occupation`, optional `own_language`. That shape is what later SAN self-help consumes. Pass
  `occupation_label` as zh-Hans when `occupation_name` is a catalog English key.
  Pass `own_language` as the concrete play_language name (英语/国语/…). Runtime writes `Language (Own)` equal to
  post-age EDU and renders the player-facing label as 语言（该语种）; the machine key stays `Language (Own)`. `Dodge` equals
  ⌊DEX/2⌋ plus any allocated points. Do not write half/fifth into `sheet.skills`.
  Runtime may persist `cash`, `assets`, `spending_level` as
  `{amount, currency, formula?}` and `living_standard` as a string from
  `rules.cash_assets`; KP must not send those keys or any other numeric
  finance/stat fields. The generated Quick Fire sheet is closed
  (`additionalProperties` false).
  `creation` required keys: `input_mode` (`guided_quick_fire`), `method`
  (`quick_fire_array`), `characteristic_assignment_order` (the eight unique
  canonical keys in descending array-slot priority), `skill_budget`, plus
  either `creation.luck={"mode":"auto_roll"}` (runtime fills Luck) or both
  `luck_roll_total` and `luck_roll_receipt`. Occupation and interest points
  live under `creation.skill_budget.occupation_points` /
  `personal_interest_points` (`budget`, `spent`, `allocations`). Do not
  zip the fixed array or compute `INT*2` by hand. Runtime materializes
  characteristics from `[80,70,60,60,50,50,50,40]`, owns personal-interest
  `budget`/`spent` as materialized `INT*2` (aligns them when allocations sum to
  that expected value; otherwise fails with `INT=`, `expected=`, `got=`), and
  owns the Luck receipt. Prefer `creation.luck={"mode":"auto_roll"}` so create
  issues the canonical 3D6 `investigator_creation_luck` roll with deterministic
  `decision_id` `chargen-luck-{campaign_id}-{investigator_id}` (idempotent).
  The explicit `luck_roll_total` plus `luck_roll_receipt` path remains valid.
  Submit top-level `payload.campaign_id` as the current campaign. Omit
  `sheet.characteristics` and `sheet.derived`; `investigator.create` multiplies
  Luck by five and derives HP/MP/SAN/DB/Build/MOV. The Keeper still owns the
  concept and semantic priority order. Include the confirmed
  `sheet.player_facing_sheet_zh` with a non-empty `display_name` and one
  localized `skills` array; the deterministic materializer regenerates that
  array from the canonical `skills.json` zh-Hans labels and reconciled values.
  Include `creation.skill_budget` with `occupation_points` and
  `personal_interest_points` accounts. Each account contains `budget`, `spent`,
  and an `allocations` map from canonical skill key to added points. Runtime
  sums those maps, aligns or rejects personal-interest against `INT*2`,
  resolves flat, `half_DEX`, and `EDU` catalog bases, and requires every final
  machine value to equal base plus both deltas. This package selects the optional starting
  skill cap of 75 from Keeper Rulebook p.48. That optional cap constrains
  player-allocated and non-derived starting values; it never lowers an
  unallocated standard-sheet base derived directly from a characteristic.
  Thus `Language (Own)=EDU` remains 80 when Quick Fire assigns EDU 80 and no
  points are allocated to it. If a characteristic-derived base is already
  above 75, allocating any occupation or personal-interest points to that
  skill is rejected explicitly; otherwise a reconciled value pushed above 75
  is rejected before writing. Credit Rating and Cthulhu Mythos remain
  non-derived catalog bases and receive no exemption. The required default set
  is the package-owned standard 1920s sheet classification from the reviewed
  investigator sheet (PDF index 441): fixed Brawl, Handgun, Rifle/Shotgun,
  and Language (Own) remain; generic Pilot, Science, and Survival represent their
  printed player-selected group rows; other grouped/uncommon variants appear
  only when an allocation explicitly selects them. Blank sheet rows remain
  untyped. The campaign-bound investigator contract returns
  `campaign_binding.era` and `guided_quick_fire_campaign_era`. When that era
  contract reports `supported=true`, use only standard Quick Fire and set
  `sheet.era` exactly to its `required_sheet_era`. When it reports
  `status="kp_guided_era_adaptive_available"` with
  `fallback.available=true`, do not borrow the 1920s standard sheet and do not
  stop: select exactly `fallback.input_mode` (currently
  `kp_guided_era_adaptive`) from the returned schema. In that route, the KP
  chooses the era-appropriate occupation, omitted skills, reskins, and custom
  skills semantically; record `sheet.era_adaptive=true`,
  `sheet.kp_guided=true`, a matching creation record, occupation `reason`,
  `skill_point_formula`, and `formula_reason`, plus each reskin/custom skill's
  canonical base source and player-facing zh-Hans name in `skill_provenance`.
  For rolled methods, bind every characteristic and Luck to the existing
  `rules.roll_dice` receipts; Luck retains the exact
  `investigator_creation_luck` receipt. The rules layer still owns catalog
  bases, skill budgets, starting caps, derived values, age adjustments, and
  receipt verification. This is a deterministic reconciliation gate, not a
  second occupation-allocation engine. A selected L0 source pregen with a
  source-backed complete `stats_ref` instead uses the explicit
  `creation.input_mode="import_complete_sheet"` branch, including during an
  owned Pi live opening; it must not be recast as KP-guided creation. Other
  already complete external sheets use that same explicit import branch.
- **Quick-Fire Luck:** prefer `creation.luck={"mode":"auto_roll"}` on
  `investigator.create`. The runtime calls the existing 3D6
  `investigator_creation_luck` implementation, reuses
  `chargen-luck-{campaign_id}-{investigator_id}` on retry, and writes
  `luck_roll_total` / `luck_roll_receipt` before materialization. The explicit
  `rules.roll_dice` path (`expression="3D6"`, `purpose="investigator_creation_luck"`,
  then copy `total`/`roll_id`) remains compatible. Do not invent a second dice
  engine or send `3D6*5`. Investigator concept, assignment, occupation,
  backstory, and final craft remain live semantic Keeper work.
- **Cash and assets are not KP numbers.** `setup.chargen_run` materializes
  sheet `cash` / `assets` / `spending_level` / `living_standard` from the
  occupation-allocated `skills["Credit Rating"]` and campaign era through
  `rules.cash_assets` when that era is `1920s` or `modern`. Do not pass those
  keys, a top-level `credit_rating`, or any cash amount on the delegate.
  First-contact reaction still reads `skills["Credit Rating"]`; do not replace
  that path. During this guided setup window, a later `rules.cash_assets`
  lookup with the confirmed canonical `Credit Rating` remains valid for
  table explanation; omit `period` to bind it to the campaign era. An explicit
  period must match that era. A campaign era without an authoritative table
  still fails closed—never borrow a 1920s table or estimate a numeric
  amount—and chargen leaves those sheet finance keys unset. Its error exposes
  the machine-readable `details.cash_semantic_disposition`. In the active
  `kp_guided_era_adaptive` route only, **after** the chargen write, follow that
  exact disposition with `state.cash_semantic`: provide a stable `record_id`,
  `basis` of `module_pregen` or `kp_era_adaptation`, a semantic `reason`, a
  `decision_id`, and player-safe `cash_description` and/or `assets`. It records
  only campaign-local KP bookkeeping with `kp_guided`/`cash_semantic`
  provenance; it cannot alter rule tables or claim a rules-derived cash amount.
  Do not call `state.cash_semantic` for `1920s`/`modern`; the sheet already
  holds the table result. Sheet `cash`/`assets`/`spending_level` is the chargen
  snapshot (card lore). The campaign cash ledger (`state.cash_grant` /
  `state.cash_spend` / `state.cash_query`) is the play-time purse the sidebar
  reads. `setup.chargen_run` create+link seeds that ledger once from the same
  1920s/modern table cash, with `localized_reason` 建卡·信用评级换算,
  idempotent on the commit `decision_id`. Era-adaptive (no table) does not seed
  the ledger: keep prose via `state.cash_semantic`, and only after opening may
  the KP grant a numeric first entry if play needs one. Pregen and
  `setup.quick_start` still leave the ledger empty.
- **Confirmation craft.** After presenting the complete investigator, close in the Keeper's own voice and invite confirmation, in campaign `play_language` (default `zh-Hans`). Recommended substance: 「哪里想改，直接说；如果确定，请回复『确定』，我们开始游戏。」 The wording may follow the table's tone. When the player corrects, jokes, hedges, or asks a follow-up, treat the sheet as not yet settled: apply the change, re-show what moved, and ask again in passing. Do not take a correction or a joke as the final nod. This is Keeper craft (should / 应当 / 习惯上); the KP judges meaning. It is not a tool-enforced or blocking gate.
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
