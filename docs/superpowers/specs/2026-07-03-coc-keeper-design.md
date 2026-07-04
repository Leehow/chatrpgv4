# COC Keeper Codex Plugin Design

Date: 2026-07-03
Status: Draft for user review

## Vision

`coc-keeper` is a local Codex plugin for playing Call of Cthulhu inside Codex chat. It should feel like an immersive tabletop session, not a utility panel. The user plays as the player. Codex acts as Keeper after the user explicitly activates COC mode.

The plugin provides mode instructions, multiple focused skills, Python scripts, structured rules data, and persistent project-local campaign storage. It does not require a UI. The first implementation should not require MCP, but the architecture should leave room for a future MCP state engine.

The long-term goal is:

```text
Normal Codex conversation
-> user explicitly activates COC mode
-> Codex becomes Keeper
-> user chooses or creates a campaign
-> user binds/imports an authored scenario module
-> user creates/selects reusable investigators
-> Codex runs immersive play
-> rules resolve through structured JSON and deterministic scripts
-> campaign state, memory, logs, indexes, and character history persist
-> user pauses/exits
-> later activation resumes safely from stored state
```

## Non-Goals

- Do not build a visual UI in the first phase.
- Do not make Codex proactively ask whether to enter COC mode during ordinary coding or chat.
- Do not depend on MCP for V1.
- Do not treat PDFs as the runtime rules authority for common checks.
- Do not store reusable investigators only inside a single campaign.
- Do not expose Keeper-only spoilers without warning and confirmation.
- Do not use non-ASCII system markers, machine identifiers, JSON keys, status values, or filenames.

## Activation Model

COC mode is passive until explicitly activated. Examples:

```text
activate COC mode
enter COC mode
start COC game
continue COC campaign
激活 COC 模式
进入 COC 跑团
继续 COC 战役
```

Once activated, Codex stays in COC mode until the user says to exit or pause. Examples:

```text
exit COC mode
pause COC mode
save and exit
退出 COC 模式
暂停跑团
保存并退出
```

Activation always starts with campaign selection or creation. The flow is:

```text
activate COC mode
-> choose/create campaign
-> choose visible play language, defaulting to `zh-Hans`
-> bind/import scenario
-> choose/create investigators
-> start or resume immersive play
```

## Language And Localized Terms

Each campaign persists `play_language`, defaulting to `zh-Hans`, plus a `language_profile` and a `localized_terms` map keyed by language. The player may choose another visible play language at setup; if they do not choose, the Keeper uses Chinese for player-visible narration and table dialogue. The `language_profile` records the output instruction, name policy, term policy, `report_heading_labels`, `report_field_labels`, `report_value_labels`, `speaker_labels`, `transcript_labels`, `transcript_mode_labels`, `character_dossier_labels`, `chronicle_labels`, `feedback_labels`, `chase_tracker_labels`, `empty_report_lines`, and report labels for that language.

For `zh-Hans`, foreign people, places, factions, handouts, campaign titles, scenario titles, player-visible module source labels, player-visible skill display names, and special terms should use `localized_terms` with Chinese transliterations or conventional translated names. For other languages, the same map holds customary local forms for that language. Event-level `localized_text[play_language]` is preferred for full player-visible prose and must still be rendered through `localized_terms[play_language]` before it appears in player-view or reports; if absent, reports fall back to `localized_terms[play_language]` for names, setting terms, and skill display names.

The localization layer applies only to player-visible narration, NPC speech, player prompts, player-view transcript text and speaker display values, public character state, recaps, and reports. `player-view.jsonl` must keep a stable safe event structure, but its visible `text`, `speaker`, and `localized_text[play_language]` values should be rendered for `play_language`, including system roll summaries, speaker/profile labels, success levels, and skill display names. When a player-view transcript row keeps canonical `intent` or `ruling` enum values, it should also expose `intent_display` or `ruling_display` rendered from `localized_text[play_language]` plus `localized_terms[play_language]`, so consumers do not have to show the canonical enum. When `player-view.jsonl` or `player-feedback.jsonl` rows keep canonical `player_profile` enum values, they should also expose `player_profile_display` from `player_profile_labels[play_language]`, so player-visible surfaces never need to render the enum. Its `public_character_state` entry must render scenario display fields, investigator names, occupations, player-visible skill display keys, derived display values, and backstory values through `localized_terms[play_language]` or language-profile labels. Keep machine-facing markers, JSON keys, filenames, canonical skill keys, rule enum values, stable IDs, and hidden Mechanical Log audit anchors stable. Stored transcript payload fields and reusable investigator/campaign source files stay canonical, but source `transcript.jsonl` rows that can appear in evaluator or replay views must also carry player-language display companions such as `speaker_display`, `text_display`, `intent_display`, `ruling_display`, and `player_profile_display` when the canonical value is not itself suitable for the selected play language. Player-visible skill display names render through `localized_terms[play_language]` while stored JSON preserves canonical skill keys and visible Mechanical Log summaries may render selected-language skill display names.

## System Markers

All machine-facing markers must be ASCII English. Chinese can appear in natural language narration, but not in parser-facing tags or status values.

Allowed marker style:

```text
[in_game]
[/in_game]
[meta]
[/meta]
[spoiler_warning]
[system_note]
[roll]
[combat]
[chase]
[sanity]
```

Avoid any parser-facing marker written in Chinese or other non-ASCII text.

## Immersion And Meta-Game Boundary

The main play loop should be immersive by default:

- scene descriptions
- NPC dialogue
- player action feedback
- diegetic consequences
- concise roll requests
- narrative consequences after resolution

Rules explanations, system state, parameter inspection, and disputes go through the meta subsystem. The user may enter meta mode with phrases such as:

```text
meta:
rules question:
system question:
pause narration
explain this roll
show parameters
I challenge this ruling
这个判定为什么这样？
解释一下规则
```

Meta answers should be wrapped with `[meta]` and `[/meta]`. Returning to play should use `[in_game]` and `[/in_game]` only if a marker helps the transition.

If a meta answer would reveal Keeper-only scenario information, Codex must first emit `[spoiler_warning]`, explain the risk, and wait for confirmation before revealing it.

## Spoiler Policy

Default policy: `warn_before_reveal`.

Codex as Keeper may know full scenario information, but the player view only receives what the investigator can perceive, infer, or has discovered. Keeper-only information includes:

- hidden clues
- true NPC motives
- future scene triggers
- monster identities not yet discovered
- scenario timeline secrets
- alternate endings
- module solutions

When the user explicitly asks for Keeper-only information, Codex must warn first:

```text
[spoiler_warning]
This may reveal Keeper-only scenario information and affect play. Confirm if you want to see it.
[/spoiler_warning]
```

After confirmation, Codex may reveal only the requested scope and should log the reveal to `logs/audit.jsonl`. Completion-oriented playtest suites must prove this with structured `spoiler_protocol` transcript stages (`warning_issued`, `player_confirmed`, `limited_reveal`) plus a matching `type: spoiler_reveal` audit-log row; player-facing views may show confirmed reveal text but must not expose internal Keeper secret ids.

## Architecture

The plugin is skill-led with Python support scripts.

```text
coc-keeper/
├── .codex-plugin/
│   └── plugin.json
├── skills/
│   ├── coc-main/
│   ├── coc-campaign-state/
│   ├── coc-rules-engine/
│   ├── coc-character/
│   ├── coc-scenario-import/
│   ├── coc-keeper-play/
│   ├── coc-meta/
│   ├── coc-playtest/
│   ├── coc-combat/
│   ├── coc-chase/
│   ├── coc-sanity/
│   └── coc-mythos-reference/
├── scripts/
│   ├── coc_roll.py
│   ├── coc_state.py
│   ├── coc_character.py
│   ├── coc_scenario.py
│   ├── coc_rules.py
│   ├── coc_playtest_report.py
│   └── coc_validate.py
├── references/
│   ├── AGENTS-coc-mode-template.md
│   ├── mode-protocol.md
│   ├── state-schema.md
│   ├── rules-json-guide.md
│   └── rules-json/
└── tests/
    ├── test_roll.py
    ├── test_character.py
    ├── test_state.py
    ├── test_rules_json.py
    └── test_playtest_report.py
```

The layer model is:

```text
Layer 1: Mode protocol
Layer 2: Skills
Layer 3: Python scripts
Layer 4: Rules JSON
Layer 5: Project-local COC data
Layer 6: Source PDFs and authored modules
```

## Skill Map

### `coc-main`

The mode orchestrator. It activates only on explicit COC mode requests and owns the current high-level phase.

Responsibilities:

- enter and exit COC mode
- create or select campaigns
- load `.coc/` state
- route to setup, character creation, scenario import, play, combat, chase, sanity, or meta
- keep player view and Keeper view separated
- enforce spoiler warnings
- summarize and persist session state on exit

### `coc-campaign-state`

The persistence protocol skill.

Responsibilities:

- define `.coc/` workspace layout
- create campaign folders
- create reusable investigator folders
- read and write campaign save files
- append JSONL logs
- create snapshots
- validate state
- explain recovery and repair options

### `coc-rules-engine`

The structured rules skill. Runtime calculations must use JSON tables and scripts, not ad hoc PDF lookup.

Responsibilities:

- skill checks
- difficulty levels
- bonus and penalty dice
- success levels
- fumbles and criticals
- half/fifth values
- damage bonus and build
- rules source references

### `coc-character`

Investigator creation and long-term maintenance.

Responsibilities:

- full guided investigator creation
- quick investigator generation
- age modifiers
- occupations
- occupation and personal interest skill points
- backstory fields
- equipment, cash, and assets
- derived values
- development phase changes
- reusable investigator history

### `coc-scenario-import`

Authored module import and indexing.

Responsibilities:

- catalog PDFs under `pdf/`
- support rulebook built-in scenarios and external module PDFs
- create scenario skeletons
- extract outline/page maps
- preparse scenario structure where practical
- build source maps
- keep Keeper-only data separated
- support on-demand detail lookup during play

### `coc-keeper-play`

The immersive play loop.

Responsibilities:

- describe scenes
- portray NPCs
- parse player actions
- call for checks
- reveal clues appropriately
- manage pacing
- use Idea Rolls when play stalls
- transition to combat, chase, sanity, rules, or meta subsystems
- avoid changing authored scenario facts without a clear Keeper ruling

### `coc-meta`

The out-of-character subsystem.

Responsibilities:

- answer rules questions
- explain current parameters
- inspect system state
- handle player challenges to rulings
- show safe source references
- correct mistakes with audit logging
- pause and resume narration cleanly

### `coc-playtest`

The automated playtest and evaluation skill. This skill tests the Keeper system and should not be used for normal player-facing campaign play.

Responsibilities:

- run isolated test campaigns under `.coc/playtests/`
- coordinate a Keeper-under-test role, one or more simulated player roles, and an evaluator role
- keep simulated players from reading Keeper-only files
- define test scenarios for character creation, ordinary investigation, meta questions, combat, chase, sanity, spoilers, save, and resume
- capture complete transcripts and state transitions
- compare state files, logs, and memory against expected invariants
- produce detailed battle reports and evaluation reports
- flag rule mistakes, immersion breaks, spoiler leaks, state persistence errors, and recovery failures

### `coc-combat`

The combat subsystem.

Responsibilities:

- establish combatants
- DEX order
- surprise
- dodge and fight back
- maneuvers
- melee and firearms basics
- armor and damage
- major wounds
- unconsciousness, dying, and healing
- persist `save/combat.json`

### `coc-chase`

The chase subsystem.

Responsibilities:

- establish chase groups
- MOV and speed adjustments
- location chains
- DEX order and per-round turn order
- barriers and hazards
- movement actions
- conflict during chases
- vehicle chases and collision basics
- persist `save/chase.json`

### `coc-sanity`

The sanity subsystem.

Responsibilities:

- SAN rolls
- sanity loss
- temporary insanity threshold
- indefinite insanity threshold
- bouts of madness
- phobias and manias
- recovery
- player-facing versus Keeper-only effects

### `coc-mythos-reference`

Mythos reference skill for monsters, spells, tomes, artifacts, and deities.

Responsibilities:

- provide Keeper-safe internal references
- avoid premature player spoilers
- support scenario import and combat stat lookup
- cite source pages where available

## Project Data Layout

COC runtime data lives in the current project under `.coc/`.

```text
.coc/
├── rules/
├── investigators/
├── campaigns/
├── playtests/
├── indexes/
├── module-library/
└── exports/
```

### Reusable Investigator Library

Investigators are reusable assets, not campaign-owned files.

```text
.coc/
└── investigators/
    └── <investigator-id>/
        ├── creation.json
        ├── character.json
        ├── history.jsonl
        ├── development.jsonl
        ├── inventory-history.jsonl
        └── portraits/
```

`creation.json` records the rulebook Chapter 3 investigator creation workflow: generated characteristics, occupation, occupation skill points, personal interest skill points, `skill_allocation`, credit rating, backstory, and starting equipment. `skill_allocation` records base values, occupation point spending, personal-interest point spending, final skill values, and unallocated point totals. `character.json` is the authoritative current long-term sheet. `history.jsonl` records cross-campaign experiences. `development.jsonl` records permanent growth and recovery. Campaign-specific temporary state lives inside the campaign.

At campaign end:

```text
campaign ending
-> summarize investigator experience
-> write permanent changes to character.json
-> append history.jsonl
-> append development.jsonl
-> preserve campaign ending records
```

### Campaign Data

```text
.coc/
└── campaigns/
    └── <campaign-id>/
        ├── campaign.json
        ├── party.json
        ├── save/
        │   ├── world-state.json
        │   ├── active-scene.json
        │   ├── flags.json
        │   ├── combat.json
        │   ├── chase.json
        │   └── investigator-state/
        │       └── <investigator-id>.json
        ├── scenario/
        │   ├── scenario.json
        │   ├── locations.json
        │   ├── npcs.json
        │   ├── clues.json
        │   ├── timeline.json
        │   ├── handouts.json
        │   └── keeper-secrets.json
        ├── index/
        │   ├── source-map.json
        │   ├── scene-index.json
        │   ├── npc-index.json
        │   ├── clue-index.json
        │   └── rule-ref-index.json
        ├── memory/
        │   ├── session-summaries.jsonl
        │   ├── discovered-facts.json
        │   ├── unresolved-threads.json
        │   ├── npc-relationships.json
        │   ├── player-preferences.json
        │   └── keeper-notes.md
        ├── logs/
        │   ├── events.jsonl
        │   ├── rolls.jsonl
        │   └── audit.jsonl
        └── snapshots/
```

Directory roles:

- `save/`: current recoverable game state
- `scenario/`: structured authored scenario facts
- `index/`: lookup indexes and source references
- `memory/`: long-running play memory and summaries
- `logs/`: append-only event and audit trails
- `snapshots/`: point-in-time backup states

### Cross-Campaign Indexes

```text
.coc/
└── indexes/
    ├── pdf-catalog.json
    └── module-catalog.json
```

These files catalog available source PDFs and imported modules across campaigns in the current workspace.

### Playtest Runs

Automated and semi-automated tests write to `.coc/playtests/` so they do not pollute real campaigns, investigator history, or module indexes.

```text
.coc/
└── playtests/
    ├── index.json
    ├── loop-decision.json
    ├── suite-report.md
    └── <run-id>/
        ├── playtest.json
        ├── transcript.jsonl
        ├── keeper-view.jsonl
        ├── player-view.jsonl
        ├── player-feedback.jsonl
        ├── evaluator-notes.jsonl
        ├── state-diffs/
        ├── artifacts/
        │   ├── battle-report.md
        │   ├── rulebook-audit.md
        │   ├── semantic-eval-request.json
        │   ├── semantic-eval-result.json
        │   └── evaluation-report.md
        └── sandbox/
            └── .coc/
                ├── investigators/
                └── campaigns/
```

Playtest data is disposable by default. Any investigator or campaign created inside `sandbox/` must not be promoted into the real `.coc/investigators/` or `.coc/campaigns/` folders unless the user explicitly requests it.

Sandbox investigators still use the reusable investigator layout. Serious runs must write `sandbox/.coc/investigators/<investigator-id>/creation.json` before `character.json`, so the evaluator can distinguish the rulebook creation workflow from the final reusable sheet.

`index.json`, `loop-decision.json`, and `suite-report.md` are regenerated by `coc_playtest_suite.py`. They summarize all indexed playtest runs and provide a `Core Coverage Matrix` with `character_dossier`, `kp_player_transcript`, `mechanical_rolls`, `combat`, `chase`, `sanity`, `meta_game`, and `player_feedback`. Each run stores `coverage_evaluator` and `coverage_reasons` so coverage decisions are auditable.

### Semantic Matcher Constitution

The COC Keeper plugin must not use a natural-language matcher based on literal headings, keyword hits, or fixed prose fragments to prove playtest coverage, module fidelity, rule intent, spoiler safety, player intent, or KP answer quality. If a judgment depends on what human-language text means, it must be routed through an LLM semantic evaluator and must record the evaluator id plus `coverage_reasons`.

Exact matching is allowed only for machine-controlled schema fields, enum values, JSON keys, file paths, and system markers such as `coverage_evaluator`, `coverage_reasons`, `run_id`, `audit_profile`, or `subsystems_covered`. Offline deterministic tests may inject a fixture evaluator. The default non-LLM path may use structured source data only; it must not claim semantic coverage from Markdown section titles or keyword snippets.

Rulebook audits may use deterministic checks for structured machine evidence such as `module_coverage`, `subsystems_covered`, event types, chase state fields, roll payload fields, rule ids, and required source files. They must not require hardcoded natural-language report moment strings such as a specific English scene title or chase phrase as proof of module or chase quality. Human-language quality belongs in `semantic-eval-result.json`; report completeness belongs in source-to-report rendering checks that compare active structured source records with rendered artifacts.

Semantic coverage for source-gated subsystems must also be supported by machine-readable run metadata. If an evaluator claims `combat`, `chase`, or `sanity` coverage but `playtest.json.subsystems_covered` does not declare the matching enum, `coc_playtest_suite.py` must reject that run as coverage for the subsystem and surface a coverage gap. A module note that a subsystem is not applicable is useful report context, but it is not subsystem coverage.

`coc_playtest_suite.py --write-semantic-requests --root <repo-root>` writes `artifacts/semantic-eval-request.json` for each run. The harness must not fabricate `semantic-eval-result.json`; Codex or another LLM semantic evaluator reads that exact request and writes `artifacts/semantic-eval-result.json` with `schema_version`, `run_id`, `evaluator_id`, `evaluation_provenance`, `coverage`, `quality`, `root_cause_classification`, and `next_loop_fix_target`. `evaluation_provenance.kind` must be `llm`, and `evaluation_provenance.request_sha256` must match the canonical JSON hash of the reviewed request. Then `coc_playtest_suite.py --evaluator semantic-artifact --root <repo-root>` consumes those results and records the LLM evaluator id and reasons in the suite index. Missing result files must be treated as missing semantic evidence, not as permission to fall back to a natural-language matcher.

The semantic request includes `coverage_keys` and `quality_dimensions`; completion audit must reject semantic results whose reviewed request omits the required coverage, quality, or expected-output contract even when the provenance hash matches. The result `coverage` object uses the same keys as the suite matrix, and the result `quality` object scores `module_fidelity`, `rulebook_procedure`, `immersion_and_pacing`, `chinese_visible_dialogue`, `actual_play_replay`, `state_continuity`, `spoiler_safety`, `player_agency`, `virtual_player_pressure`, and `report_completeness`; each dimension includes `score`, `passed`, and a non-empty `reason`. The suite report writes `## Quality Matrix`, `## Quality Evidence`, and `quality_gaps` so the next loop can tell whether the blocker is test coverage, system behavior, report output, or design.

`loop-decision.json` is the machine-readable next-action gate. It contains `evaluated_runs`, `ignored_historical_runs`, `blockers`, `next_action`, `thread_goal_status`, `thread_goal_next_action`, and a status of either `needs_repair` or `ready_for_completion_audit`. Historical baseline runs remain visible in `Non-Passing Runs`, but they should not become current repair blockers when non-baseline evaluated runs already cover the suite. When the status is `ready_for_completion_audit`, it means the current artifact set has no suite-level coverage or quality gaps and `coc_completion_audit.py` can run; it is not a Codex thread-goal completion signal. `thread_goal_status` must stay `active_not_complete` until the external goal has separate thread-level proof. `coc_completion_audit.py` generates `.coc/playtests/completion-audit.json` and `.coc/playtests/completion-audit.md` from the suite index, semantic artifacts, active run source files, active run artifacts, and watchdog automation state. The completion audit must reject active runs that no longer have non-empty, parseable JSON/JSONL transcript, player view, Keeper view, feedback, campaign files, roll/event logs, memory summaries, and reusable investigator source records, so stale reports or semantic results cannot pass after the underlying actual-play evidence disappears, is blanked, or is no longer structured. The completion audit must also reject source shells that parse but do not contain minimum machine-readable actual-play evidence, starting with `transcript.jsonl` rows for both `keeper_under_test` and `player_simulator` with visible text; `player-view.jsonl` rows for public character state plus visible transcript turns; `keeper-view.jsonl` rows for Keeper context, `keeper_secret_ids`, and visible transcript turns; `player-feedback.jsonl` rows with a numeric `score` and visible feedback `text`; campaign `scenario/handouts.json` rows with player-visible label/title and required player-visible summary; campaign `logs/rolls.jsonl` rows with type, payload, dice roll, target, and outcome; campaign `logs/events.jsonl` rows with type and payload plus required event type enums for the active `audit_profile`; campaign memory rows with visible `summary`; reusable investigator files with skill allocation, character skills, history summary, development record, and inventory summary evidence; required pushed-roll source evidence with Keeper-owned failure consequences, player risk confirmation, stable `roll_id`, and ordered transcript stages; multi-profile pressure source evidence with each required `player_profile` enum represented in transcript and feedback rows; and meta-game source evidence with separated `mode=meta` player questions and Keeper answers in `transcript.jsonl`. For localized runs, the completion audit must also reject `player-view.jsonl` public character state that leaks canonical player-visible terms from `localized_terms[play_language]` in scenario display fields, investigator display fields, player-visible skill display keys, derived display values, or backstory values, reject player-view transcript `speaker` display values that leak canonical names, profile ids, or unlocalized English speaker tokens, reject player-view/player-feedback rows whose `player_profile_display` is missing or still equals the canonical `player_profile` enum when `player_profile_labels[play_language]` supplies a localized label, reject player-view `localized_text[play_language]` values that leak canonical player-visible terms, and reject player-view transcript `intent`/`ruling` rows whose `intent_display`/`ruling_display` is missing or still equals the canonical enum when `localized_text[play_language]` supplies a localized detail. The completion audit must reject battle-report shells that contain the required anchors but do not render the visible non-system source dialogue from `transcript.jsonl` in `Actual Play Replay` or `Session Transcript`, because a真人跑团实录 must show what KP and players actually said rather than only title placeholders. It must also reject handout sources without player-visible summaries and battle reports whose `Handouts` section omits player-visible labels, titles, summaries, or routes from `scenario/handouts.json`, so the report cannot pass while hiding the table handout register. It must also reject battle reports whose `Mechanical Log`, after stripping HTML comments, omits visible source roll evidence for any roll from `logs/rolls.jsonl`; visible evidence may be either the canonical source roll line assembled from machine fields (`skill`, `actor`, `roll`, `target`/`effective_target`, and `outcome`) or the selected `play_language` roll sentence rendered from `language_profile`, `localized_terms`, and source character names. Hidden comments such as `roll-source` are audit anchors only and must not prove player-visible actual-play output. It must reject battle reports whose Scene-by-Scene Replay or State Changes omit structured `logs/events.jsonl` `payload.summary` values, so the actual-play report cannot pass while hiding the durable scene, clue, state, combat, chase, sanity, status, or ending events. It must reject battle reports whose Player Feedback On KP section omits structured `player-feedback.jsonl` `text` values, so the report cannot pass while hiding virtual-player evaluation of the KP experience. It must reject battle reports whose Story Recap omits structured `memory/session-summaries.jsonl` `summary` values, so saved campaign memory remains visible in the actual-play record. It must reject battle reports whose Investigator Chronicle omits structured reusable-investigator `history.jsonl`, `development.jsonl`, or `inventory-history.jsonl` player-readable summary/carryover values, allowing machine glossary localization for player-visible names and scenario titles. The completion audit must cross-check the suite index against current active `semantic-eval-result.json` artifacts so stale `covered` or `passed` matrix values cannot survive after the semantic artifacts change; the supporting artifact must be one of the active run ids listed on that exact matrix entry, not merely any active run.

The completion audit must also reject battle reports whose Investigator Creation omits structured reusable-investigator `creation.json` values for generated characteristics, occupation skill points, personal-interest skill points, credit rating, skill allocation, and equipment, allowing machine glossary localization for player-visible names, occupations, skills, and gear.

The completion audit must also reject battle reports whose Character Dossier omits structured reusable-investigator `character.json` values for name/id, occupation, era, characteristics, derived values, skills, and backstory, allowing language-profile labels and glossary localization for player-visible names, occupations, skills, and character-sheet terms.

The completion audit must also reject battle reports whose Chase Tracker omits structured `save/chase.json` values for participants, DEX order, location chain, round summaries, and outcome, allowing language-profile labels and glossary localization for player-visible chase terms. Chase drills must also persist `rounds[].turns[].actor_id` entries ordered as a DEX-order subsequence, so `chase_dex_order_not_proven` can catch runs whose saved chase state cannot prove who acted first in each chase round. The completion audit must also reject final chase narration, transcript, or report text that places a participant at a different location than `save/chase.json.participants[].position`, using machine location ids plus `localized_terms[play_language]` aliases; emit `chase_transcript_position_conflict` so state continuity errors are not hidden by a correctly rendered Chase Tracker.

## Campaign File Examples

`campaign.json`:

```json
{
  "schema_version": 1,
  "campaign_id": "the-haunting-001",
  "title": "The Haunting",
  "mode": "keeper",
  "status": "setup",
  "era": "1920s",
  "active_scenario_id": "the-haunting",
  "active_scene_id": null,
  "dice_mode": "codex",
  "spoiler_policy": "warn_before_reveal",
  "active_subsystem": "setup",
  "created_at": "ISO-8601",
  "updated_at": "ISO-8601"
}
```

`party.json`:

```json
{
  "schema_version": 1,
  "campaign_id": "the-haunting-001",
  "investigator_ids": ["harvey-walters"],
  "active_investigator_ids": ["harvey-walters"]
}
```

`scenario/scenario.json`:

```json
{
  "schema_version": 1,
  "scenario_id": "the-haunting",
  "title": "The Haunting",
  "source": {
    "type": "pdf",
    "path": "pdf/Call Of Cthulhu Keeper Rulebook 40th Anniversary (Sandy Petersen).pdf",
    "page_start": 447,
    "page_end": 464
  },
  "summary": "",
  "player_safe_summary": "",
  "current_phase": "intro"
}
```

`logs/rolls.jsonl`:

```json
{"ts":"ISO-8601","type":"roll","actor":"harvey-walters","payload":{"skill":"Library Use","target":70,"difficulty":"regular","roll":42,"outcome":"success"}}
```

## Rules JSON

Core rules should be pre-normalized into JSON and treated as the runtime authority for frequent calculations.

```text
references/rules-json/
├── metadata.json
├── characteristics.json
├── skill-bases.json
├── occupations.json
├── derived-values.json
├── damage-bonus-build.json
├── difficulty-levels.json
├── rule-index.json
├── success-levels.json
├── combat.json
├── chase.json
├── sanity.json
├── weapons.json
├── equipment-1920s.json
└── equipment-modern.json
```

Rules PDF usage:

- source for initial data extraction
- source references and page citations
- fallback for low-frequency or ambiguous rules

Rules JSON usage:

- actual runtime calculations
- validation
- deterministic script behavior
- parameter display in `[meta]`
- stable `rule_refs` traceability from `logs/rolls.jsonl` and `logs/events.jsonl` back to `rule-index.json`, including core ids such as `core.percentile_check` and module ids such as `module.haunting.corbitt_flesh_ward`

Example `damage-bonus-build.json`:

```json
[
  {"min": 2, "max": 64, "damage_bonus": "-2", "build": -2},
  {"min": 65, "max": 84, "damage_bonus": "-1", "build": -1},
  {"min": 85, "max": 124, "damage_bonus": "none", "build": 0},
  {"min": 125, "max": 164, "damage_bonus": "+1D4", "build": 1},
  {"min": 165, "max": 204, "damage_bonus": "+1D6", "build": 2}
]
```

Example `success-levels.json`:

```json
{
  "critical": {"roll": 1},
  "regular": {"threshold": "target"},
  "hard": {"threshold": "half"},
  "extreme": {"threshold": "fifth"},
  "fumble": {
    "target_below_50": [96, 100],
    "target_50_or_above": [100, 100]
  }
}
```

## Python Scripts

### `coc_roll.py`

- roll dice expressions
- roll percentile checks
- apply bonus and penalty dice
- compute success levels
- optionally append roll log events

### `coc_character.py`

- derive HP, MP, SAN, Luck, DB, Build, and MOV
- calculate half and fifth values
- validate skill totals
- apply age modifiers
- apply development phase changes

### `coc_state.py`

- create `.coc/` workspace
- create campaigns
- create investigator records
- link investigators into campaign parties
- load campaign state
- append JSONL logs
- write save files atomically
- create snapshots

### `coc_scenario.py`

- catalog PDFs
- extract outlines and page maps
- create scenario skeletons
- build source-map indexes
- support rulebook built-in scenarios and external module PDFs

### `coc_rules.py`

- load rules JSON
- validate rules JSON schemas
- query rule tables by id
- return source references where available

### `coc_playtest_report.py`

- read playtest transcripts, logs, state diffs, and evaluator notes
- generate `battle-report.md`
- generate `evaluation-report.md`
- summarize player actions, Keeper rulings, rules calls, state changes, and unresolved issues
- score immersion, rules accuracy, state persistence, spoiler safety, pacing, and recovery behavior
- highlight reproducible failures with file paths and event ids

### `coc_validate.py`

- validate plugin rules JSON
- validate `.coc/` state
- validate reusable investigator records
- validate campaign consistency
- report missing or malformed files

## Play Workflows

### New Campaign

```text
activate COC mode
-> create campaign
-> set era, title, dice mode, spoiler policy
-> choose module source
-> import or bind scenario
-> select/create investigators
-> begin intro scene
```

### Resume Campaign

```text
activate COC mode
-> list available campaigns
-> load campaign.json
-> load save/
-> load memory/
-> show player-safe recap
-> continue active scene
```

### Scenario Import

```text
catalog source PDF
-> extract outline/page map
-> create source-map index
-> preparse high-value structure
-> separate player-safe and Keeper-only content
-> write scenario/
-> write index/
```

High-value structure includes:

- scenario premise
- locations
- NPCs
- clues
- timeline
- handouts
- likely threats
- Keeper secrets
- endings

### Ordinary Play Loop

```text
describe current scene
-> wait for player action
-> decide if rules are needed
-> resolve with rules JSON and scripts
-> narrate outcome
-> update save/
-> update memory/
-> append logs/
-> continue
```

### Combat

```text
trigger combat
-> create save/combat.json
-> establish combatants
-> sort DEX order
-> run rounds
-> resolve dodge/fight back/maneuver/firearm actions
-> apply damage and conditions
-> append logs
-> end combat
-> update world state and memory
```

### Chase

```text
trigger chase
-> create save/chase.json
-> establish participants and goals
-> calculate MOV and adjustments
-> create or import location chain
-> resolve movement actions, hazards, barriers, and conflict
-> end chase
-> update world state and memory
```

### Sanity

```text
trigger SAN check
-> roll against current SAN
-> compute loss
-> check temporary insanity threshold
-> check indefinite insanity threshold
-> resolve bout if needed
-> update investigator state
-> update memory and logs
```

### Meta Challenge Or Rules Question

```text
enter [meta]
-> pause narration
-> inspect safe parameters
-> query rules JSON
-> cite PDF page only if needed
-> explain ruling
-> if prior ruling was wrong, offer correction
-> append audit log if state changes
-> return to [in_game]
```

## Playtest And Evaluation Strategy

The system needs a repeatable way to let Codex test the Keeper experience by simulating players while preserving the same immersion, state, and spoiler constraints expected in real play.

The playtest system should be treated as a separate subsystem, not as normal campaign play. Test runs write to `.coc/playtests/<run-id>/` and use sandboxed investigators and campaigns.

### Playtest Roles

Each playtest run uses three role types:

1. `keeper_under_test`
   - Runs the COC mode flow being tested.
   - Has Keeper access to scenario structure, rules JSON, save state, and memory.
   - Must follow the same spoiler and meta rules as normal play.

2. `player_simulator`
   - Simulates one or more human players.
   - Sees only `player-view` information.
   - May ask in-character questions, take risky actions, ask `[meta]` questions, challenge rulings, forget details, or make suboptimal choices.
   - Must not read Keeper-only files, scenario secrets, hidden clue graphs, or evaluator notes.

3. `evaluator`
   - Reads the full transcript, logs, state files, and source indexes after or during the run.
   - Scores the Keeper system.
   - Flags factual mistakes, rule mistakes, pacing problems, immersion breaks, spoiler leaks, state bugs, and missing memory updates.

When Codex subagents are available, `coc-playtest` should run these as separate agents where practical. If subagents are unavailable, the fallback is a transcript-driven local harness where Codex alternates roles under strict view constraints and writes each turn to the appropriate JSONL file.

### View Separation

The test harness must maintain separate streams:

```text
keeper-view.jsonl
player-view.jsonl
evaluator-notes.jsonl
transcript.jsonl
```

Rules:

- `player_simulator` receives only player-safe scene text, public character state, and explicit `[meta]` answers.
- `keeper_under_test` may access scenario secrets but must not reveal them unless the simulated player confirms a `[spoiler_warning]`.
- `evaluator` may inspect all files, but evaluator observations must not be fed back into the player simulator mid-run unless the test case explicitly tests correction behavior.
- Any accidental secret exposure is recorded as a spoiler failure.
- `player-view.jsonl` contains player-safe public character state and visible transcript turns only; source transcript rows may preserve `[meta]` and `[spoiler_warning]` protocol wrappers for tooling, but player-view visible fields must render only the display body.
- `keeper-view.jsonl` contains Keeper context, including `keeper_secret_ids`, plus the transcript view available to the Keeper.
- Active audits emit `view_separation_missing` if either view stream is missing or malformed, `player_view_secret_leak` if any `keeper-secrets.json` id appears in `player-view.jsonl`, and `player_view_protocol_wrapper_leak` if player-visible fields expose transcript protocol wrappers.

### Pushed Roll Protocol

Pushed rolls should be recorded as a table procedure, not only as a second die roll. The transcript and roll payloads should share a stable `pushed_roll_protocol.roll_id`.

Transcript stages:

```text
player_reframes_action
keeper_foreshadows_failure
player_confirms_risk
roll_resolved
```

The Keeper owns the foreshadowed failure consequence with `failure_consequence_source: keeper`; the player confirms the risk with `risk_confirmed: true`; the roll payload records `keeper_foreshadowed_failure: true` and `player_confirmation_recorded: true`.

### Test Suites

V1 should include small deterministic test suites:

- `activation_resume`: activate COC mode, create campaign, exit, resume.
- `character_guided`: create an investigator through full guided flow and write `creation.json` before `character.json`.
- `character_quick`: create a quick investigator from a concept and write summarized `creation.json` provenance.
- `basic_roll`: request a skill roll and verify log/state output.
- `meta_question`: ask why a roll is needed and verify `[meta]` answer.
- `spoiler_warning`: ask for Keeper-only information and verify warning-before-reveal.
- `basic_combat`: start a two-participant combat and resolve at least one round.
- `basic_chase`: start a chase and resolve at least one movement exchange.
- `chase_drill`: run `--profile chase-drill`, persist `save/chase.json`, and produce a Chase Summary showing speed roll, MOV, movement actions, location chain, DEX order, hazard, barrier, conflict, and why the quarry escapes.
- `basic_sanity`: trigger a SAN roll and update investigator state.
- `save_integrity`: validate save files, logs, and memory after exit.

V2 should add authored-module tests:

- `module_import`: import a module PDF and produce scenario structure.
- `haunting_module_playthrough`: run a reproducible The Haunting module-level transcript from Mr. Knott through Corbitt's defeat, including rulebook investigator creation, social access, pushed rolls, Chapel clues, house exploration, Bed Attack, basement hazards, The Floating Knife, Corbitt combat, final HP/SAN, rewards, and player feedback.
- `clue_graph`: verify important clues are discoverable through more than one route when the module supports it.
- `npc_state`: track NPC attitude, location, secrets, and status changes.
- `scene_transition`: move through linked scenes without losing source references.
- `keeper_secret_safety`: run player exploration near hidden secrets and check for leaks.
- `ruling_correction`: intentionally challenge a ruling and verify audit-backed correction.

V3 should add long-campaign tests:

- `campaign_end`: finish a scenario and write permanent investigator changes.
- `investigator_reuse`: bring a surviving investigator into a new campaign.
- `long_memory`: verify discovered facts and unresolved threads survive multiple sessions.
- `world_continuity`: carry world-state consequences into a later module.
- `snapshot_rollback`: create a snapshot and restore from it in a sandbox.

V4 should add engine tests:

- MCP tool parity if an MCP engine exists.
- SQLite or full-text index regression.
- house rule overrides.
- large module library search.
- replay/export generation.

### Simulated Player Profiles

Use multiple player simulator profiles to stress different Keeper behaviors:

- `careful_investigator`: asks questions, searches thoroughly, avoids combat.
- `reckless_investigator`: pushes rolls, touches dangerous objects, starts conflict.
- `rules_lawyer`: frequently asks `[meta]` questions and challenges rulings.
- `forgetful_player`: asks for recaps and repeats previously answered questions.
- `genre_savvy_player`: makes strong inferences that may approach spoilers.

V1 can start with one careful player and one rules lawyer. V2 should add reckless and genre-savvy profiles.

### Metrics

Each playtest should produce scores from 1 to 5:

- `immersion`: scene flow, atmosphere, NPC voice, and lack of system leakage.
- `rules_accuracy`: correctness of rolls, thresholds, damage, SAN, combat, chase, and character math.
- `state_integrity`: whether JSON saves, logs, memory, and indexes match the transcript.
- `spoiler_safety`: whether hidden information stayed hidden until confirmed.
- `meta_quality`: usefulness and clarity of rules/system explanations.
- `pacing`: whether the Keeper avoided stalls, overlong exposition, and unnecessary rolls.
- `recovery`: whether exit, resume, correction, and rollback paths worked.

Reports should also include:

- pass/fail per test case
- reproducible event ids
- affected files
- recommended fixes
- severity levels

### Battle Report Output

`battle-report.md` is the human-readable session report. Despite the name, it covers the whole playtest, not only combat.

Required sections:

```text
# Battle Report

## Run Setup
## Module
## Handouts
## Investigator Creation
## Character Dossier
## Investigator Chronicle
## Session Transcript
## Major Player Decisions
## Mechanical Log
## Combat Summary
## Chase Summary
## Chase Tracker
## Sanity Summary
## Clues Found
## Session Ending
## Story Recap
## Player Feedback On KP
```

For active localized runs, the visible Markdown heading and field labels should use `language_profile.report_heading_labels` and `language_profile.report_field_labels`; canonical tooling anchors stay in ASCII HTML comments such as `<!-- report-anchor: Run Setup -->` and `<!-- field-anchor: Campaign -->`. A Chinese run should therefore render visible headings like `# 跑团战报 <!-- report-anchor: Battle Report -->`, not `# Battle Report / 跑团战报`; otherwise emit `report_shell_not_localized`.

The battle report should read like a detailed actual-play replay. It should identify the campaign, module, reusable investigators, character creation parameters, virtual player utterances, KP utterances, mechanical rolls, durable state changes, story memory, handout register, and player feedback on the KP experience. `## Handouts` must render structured `scenario/handouts.json` player-visible labels, titles, required summaries, and routes through `localized_text[play_language]` and `localized_terms[play_language]`, while keeping stable handout ids in JSON; otherwise emit `source_handout_summary_missing` or `battle_report_handouts_missing`. `## Clues Found` describes which clues were discovered during play and does not replace the source handout register. `## Investigator Creation` must render sandbox investigator `creation.json` before `## Character Dossier`, showing the rulebook Chapter 3 workflow: generated characteristics, occupation, occupation skill points, personal interest skill points, `skill_allocation`, credit rating, backstory, and starting equipment; otherwise emit `investigator_creation_missing` or `investigator_skill_allocation_missing`. Requirement: skill_allocation final values must match character.json skills; otherwise emit `investigator_skill_allocation_mismatch`, because creation workflow, character dossier, and roll targets must describe the same investigator. `## Investigator Chronicle` must render sandbox investigator `history.jsonl` and `development.jsonl` entries so the evaluator can see what would carry into a later story without mutating the real investigator library. Active localized Run Setup display values such as dice mode, spoiler policy, play language, language profile, localized-term summary, and player profile must render through `language_profile.report_value_labels` or language report templates while preserving canonical values in JSON; otherwise emit `run_setup_values_not_localized`. The localized-term summary should be a short localized count pointing to `playtest.json`; the battle report must not render the full `localized_terms` glossary as a visible Localization Appendix because that is source metadata, not actual-play transcript. Active localized Campaign, Scenario, and Source display values must render through `localized_terms[play_language]` while preserving canonical values and file paths in JSON; otherwise emit `module_metadata_values_not_localized`. Actual Play Replay and Session Transcript turn/detail display labels must render through `language_profile.transcript_labels`, speaker labels through `language_profile.speaker_labels`, and mode display values through `language_profile.transcript_mode_labels`; otherwise emit `transcript_labels_not_localized`. Transcript intent/ruling display values must render through `localized_text[play_language]` while preserving canonical values in JSON; otherwise emit `transcript_detail_values_not_localized`. Active localized `## Investigator Chronicle` labels and player-visible status values must render through `language_profile.chronicle_labels`; otherwise emit `investigator_chronicle_labels_not_localized`. Active localized `## Player Feedback On KP` metric labels must render through `language_profile.feedback_labels`; otherwise emit `player_feedback_labels_not_localized`. Active localized `## Player Feedback On KP` entries must render direct virtual-player feedback voice through `language_profile.report_labels.feedback_voice_default`, `feedback_voice_profile`, and `feedback_line` rather than only a scorecard row; otherwise emit `player_feedback_voice_missing`. Active localized `## Character Dossier` sections must render occupation, era, characteristics, derived values, skills, backstory, and backstory subfields through `language_profile.character_dossier_labels`; otherwise emit `character_dossier_labels_not_localized`. Derived value labels such as `damage_bonus` and `build` must render through `language_profile.character_dossier_labels` rather than leaking JSON keys; otherwise emit `character_dossier_derived_labels_not_localized`. Player-readable Character Dossier values such as occupation names must also apply `localized_terms[play_language]`; otherwise emit `character_dossier_terms_not_localized`. Player-visible skill display names in Character Dossier, Investigator Chronicle, Actual Play Replay, Session Transcript, Rules & Rolls Recap, Mechanical Log, and Chase Tracker must apply `localized_terms[play_language]` while preserving canonical skill keys in JSON and hidden audit anchors; otherwise emit `report_skill_names_not_localized`. Player-readable report sections, including Scene-by-Scene Replay and Combat/Chase/Sanity summaries, must render localized actor display names and avoid internal actor ids; otherwise emit `report_actor_ids_not_localized`. Player-readable Scene-by-Scene Replay must render status events such as final HP, final SAN, rewards, chase outcome, and durable end-state summaries; otherwise emit `status_event_not_rendered`. Player-readable Scene-by-Scene Replay and Clues Found entries must render scene/clue summaries without `scene_id` or `clue_id` prefixes; otherwise emit `report_state_ids_not_localized`. Scene-by-Scene Replay entries must not use raw event type enum prefixes such as `damage:` or `session ending:`; otherwise emit `report_event_type_labels_not_localized`. Scene-by-Scene Replay entries must not use actor-dash log prefixes such as `艾达·金 - ...`; otherwise emit `report_actor_dash_prefix`. Combat/Chase/Sanity summary entries must not use actor-colon log prefixes such as `KP:` or `艾达·金:`; otherwise emit `report_actor_colon_prefix`. If a summary sentence already begins with the localized actor name, the report should avoid repeating it as a separate prefix; otherwise emit `report_actor_label_repeated`. Active localized runs must also render empty combat/chase/sanity/chase-tracker states through `language_profile.empty_report_lines`; otherwise emit `localized_empty_placeholders_not_rendered`. Multi-profile pressure reports must persist `player_profile_labels` for the selected language and render those labels instead of profile ids in actual-play, transcript, and feedback sections; otherwise emit `player_profile_labels_not_localized`. When a run writes `save/chase.json`, `## Chase Tracker` must render participants, DEX order, location chain, rounds, and outcome from that JSON so the chase can be audited without reverse-engineering prose. Active localized Chase Tracker labels, roles, status/difficulty values, locations, round summaries, and outcome text must render through `language_profile.chase_tracker_labels`, `localized_terms`, or `localized_text`; otherwise emit `chase_tracker_labels_not_localized`. Canonical ids remain allowed in Character Dossier, stored JSON, and Chase Tracker only as secondary audit anchors such as parenthesized ids after localized display names; hidden comments may also carry canonical audit anchors. It should avoid exposing Keeper-only material unless the report is explicitly marked as evaluator-only.

Player-readable Scene-by-Scene Replay must also render `resource_change` events when a rulebook-required resource changes. The Haunting specifically requires Corbitt Magic points to be tracked for Flesh Ward (`reason: flesh_ward`), The Floating Knife, and Corbitt's body movement; otherwise emit `haunting_corbitt_magic_points_missing`. The Haunting final Corbitt resolution must also record a structured combat event with `rulebook_exception: own_dagger_ignores_spells`, `flesh_ward_bypassed: true`, the pre-hit Flesh Ward armor state, and a player-visible summary explaining that Corbitt's own dagger destroys him regardless of Flesh Ward or other spells; otherwise emit `haunting_corbitt_own_dagger_exception_missing`.

Rules & Rolls Recap boolean display values such as pushed-roll and skill-check-earned flags must render through `language_profile.report_labels`; otherwise emit `report_boolean_values_not_localized`.

Story Recap entries must render memory summaries without `session_id` or memory id prefixes; otherwise emit `report_memory_ids_not_localized`.

### Suite Report Output

After multiple serious playtests, `coc_playtest_suite.py` should generate `.coc/playtests/index.json` and `.coc/playtests/suite-report.md`.

`suite-report.md` is the cross-run table of contents and coverage proof. It should include `## Run Index`, `## Non-Passing Runs`, `## Loop Decision`, `## Core Coverage Matrix`, `## Coverage Evidence`, `## Quality Matrix`, `## Quality Evidence`, and `## Remaining Gaps`. The coverage matrix must report `character_dossier`, `kp_player_transcript`, `mechanical_rolls`, `combat`, `chase`, `sanity`, and `player_feedback` so the evaluator can see whether the current playtest set covers the requested Keeper workflows without hiding failed or missing audits.

The `semantic-artifact` evaluator is the preferred path when Codex is available as evaluator. It should read `semantic-eval-result.json`, preserve `evaluation_provenance`, `root_cause_classification`, and `next_loop_fix_target` for the next repair loop. `coc_completion_audit.py` then performs the artifact-level completion audit once `loop-decision.json` says `ready_for_completion_audit`, including the `request_sha256` provenance check.

### Rulebook Alignment Audit

Every serious playtest run must also generate `rulebook-audit.md` with `coc_playtest_audit.py`. This is the control loop for deciding whether the battle report resembles a real Call of Cthulhu session as described in the Keeper Rulebook, rather than a smoke-test transcript with nicer formatting.

`coc_playtest_harness.py` provides reproducible baselines for this loop. The `rulebook-smoke` profile should generate a small The Haunting-derived run with a real opening hook, player intent, Keeper rulings, an investigation roll, clue flow, a sanity prompt, memory, feedback, and then run the report and audit generators. The `haunting-module` profile should generate a module-level The Haunting transcript with Mr. Knott, Arty Wilmot, Chapel clues, The Old Corbitt Place, Bed Attack, basement hazards, The Floating Knife, Corbitt's Hiding Place, Corbitt combat, Corbitt Magic points `resource_change` events for `flesh_ward`, `floating_knife_attack`, and `animate_body`, a structured `own_dagger_ignores_spells` combat exception showing why Flesh Ward no longer protects Corbitt when his own dagger hits, final HP/SAN, rewards, explicit Chase Summary non-applicability, sandbox investigator `creation.json`, `history.jsonl`, `development.jsonl`, and player feedback. The `chase-drill` profile should generate a rulebook chase drill that writes `save/chase.json`, writes sandbox investigator `creation.json`, `history.jsonl`, and `development.jsonl`, shows speed roll, MOV, movement actions, location chain, DEX order, hazard, barrier, conflict, and why the quarry escapes, and renders `save/chase.json` as `## Chase Tracker`.

The audit loop is:

1. Generate `battle-report.md` and `evaluation-report.md`.
2. Run `coc_playtest_audit.py <run-dir>` and inspect `artifacts/rulebook-audit.md`.
3. If the audit fails, classify the blocker before changing code:
   - `test_gap`: the simulated test did not exercise enough COC play.
   - `system_gap`: the Keeper system did not execute or record rulebook-required behavior.
   - `report_gap`: the source data exists, but the battle report did not show it.
   - `design_gap`: the blueprint does not yet require the behavior.
4. Read `## Blueprint Cross-Check` to decide whether the problem is missing design or `designed_not_implemented`.
5. Apply the smallest fix named in `## Next Loop Fix Target`.
6. Regenerate reports and rerun the audit until it passes or exposes the next highest-priority gap.

`rulebook-audit.md` must contain `## Positive Rulebook Evidence`, `## Root Cause Classification`, `## Blueprint Cross-Check`, and `## Next Loop Fix Target`.

The baseline audit should reject a run when the battle report omits a pushed roll, status event, session ending, mechanical detail such as roll goals and difficulty rationale, when source transcript turn bases are not contiguous, or when report text leaks raw payload dictionaries instead of player-readable prose. Turn suffixes such as `48a` are allowed for inserted subturns, but missing numeric bases should emit `transcript_turn_sequence_gap`. Active serious runs must also reject missing `player-view.jsonl` / `keeper-view.jsonl` with `view_separation_missing`, reject Keeper secret ids in `player-view.jsonl` with `player_view_secret_leak`, and reject player-visible protocol wrappers in `player-view.jsonl` with `player_view_protocol_wrapper_leak`. Chase scenarios whose outcome depends on a carried objective must write an `item_transfer` event with stable `item_id`, `from_actor`, `to_actor`, `source_turn`, and matching `chase_id`, plus a player-visible localized summary; otherwise the audit emits `chase_object_transfer_missing`.

When `playtest.json` sets `audit_profile: haunting_module`, the audit should additionally require:

- required The Haunting beats in `module_coverage`
- social, pushed-roll, sanity, damage, and combat subsystem coverage
- structured Keeper-controlled NPC roleplay turns for core social/investigation scenes, including Mr. Knott, Arty Wilmot, Gabriela Macario, and Vittorio Macario, rendered with localized `KP[NPC]` labels in Actual Play Replay and Session Transcript; otherwise emit `haunting_npc_dialogue_missing`
- sandbox investigator creation records with rulebook Chapter 3 steps, generated characteristics, skill-point formulas, `skill_allocation`, credit rating, backstory, and starting equipment; otherwise emit `investigator_creation_missing` or `investigator_skill_allocation_missing`
- skill_allocation final values must match character.json skills; otherwise emit `investigator_skill_allocation_mismatch`
- sandbox inventory-history records for carryover keys, handouts, weapons, cash, evidence, and optional items; otherwise emit `investigator_inventory_history_missing`
- enough transcript turns, player intents, Keeper rulings, and major player decisions to resemble an actual-play report
- recorded floating-knife and Corbitt combat resolution
- Corbitt Magic points `resource_change` events for Flesh Ward's variable Magic point armor cost, The Floating Knife's 1 Magic point combat-round cost, and Corbitt's 2 Magic points body-movement cost; otherwise emit `haunting_corbitt_magic_points_missing`
- a structured `own_dagger_ignores_spells` combat event showing that the recovered Corbitt dagger bypasses Flesh Ward and other spells when it hits Corbitt; otherwise emit `haunting_corbitt_own_dagger_exception_missing`
- if a structured roll payload sets `temporary_insanity_triggered: true`, a `bout_of_madness` event and battle-report `疯狂发作` entry showing `mode`, Keeper control boundary, `control_returned: true`, and recovery note. `mode: real_time` requires the 1D10-round loss-of-control episode, actual `duration_roll`/`duration_rounds`, and one keeper-controlled `rounds[]` entry for each bout round. `mode: summary` requires `summary_table: table_viii_summary`, `summary_roll`, and `summary_result` instead of `duration_rounds`/`rounds`; The Haunting's Corbitt temporary-insanity scene must use summary mode when the investigator is alone.
- final HP, final SAN, rewards, and unresolved state
- a Chase Summary entry explaining that The Haunting has no required chase sequence, unless the run intentionally adds a chase scene

When `playtest.json` sets `audit_profile: chase_drill`, the audit should additionally require:

- `chase` declared in `subsystems_covered`
- `save/chase.json` with participants, location chain, round log, and outcome
- DEX-order proof through participant `dex`, `dex_order`, and `rounds[].turns[].actor_id`; otherwise emit `chase_dex_order_not_proven`
- multi-profile chase pressure from reckless, skeptical-rules, and genre-savvy player profiles, including meta questions about movement actions, pushed-roll boundaries, and spoiler-safe answers; otherwise emit `chase_player_profile_pressure_missing`
- typed major-player decision events with stable `decision_kind` values for pushed confirmation, objective possession, hazard choice, and barrier/hide choice; otherwise emit `chase_decisions_too_thin`
- Chase Summary text that explains speed roll, MOV, movement actions, DEX order, hazards, barriers, conflict, and escape/capture
- populated `## Chase Tracker` text that renders `save/chase.json` participants, DEX order, location chain, rounds, and outcome; otherwise emit `chase_tracker_not_rendered`
- carried-object continuity through an `item_transfer` event when the quarry escapes with the chase prize; otherwise emit `chase_object_transfer_missing`
- player feedback and evaluator notes specific to chase readability

### Evaluation Report Output

`evaluation-report.md` is the engineering assessment.

Required sections:

```text
# Evaluation Report

## Overall Result
## Scorecard
## Passed Test Cases
## Failed Test Cases
## Rule Accuracy Findings
## State Integrity Findings
## Spoiler Safety Findings
## Immersion Findings
## Meta-Game Findings
## Reproducible Bugs
## Recommended Fixes
## Regression Tests To Add
```

Findings should cite transcript event ids, log paths, and relevant state files. If a failure involves rules, cite the rules JSON table and source PDF page when available.

### Playtest Acceptance Gate

Before claiming a Keeper implementation is ready for real play, it must pass:

- all V1 test suites
- no high-severity spoiler leaks
- no state corruption after save/resume
- no unlogged rolls
- no permanent investigator changes written from a sandbox run
- no `investigator_creation_missing`, `investigator_chronicle_missing`, or `investigator_chronicle_not_rendered` findings in serious active runs
- no `temporary_insanity_bout_missing`, `temporary_insanity_bout_mode_mismatch`, `temporary_insanity_bout_duration_missing`, `temporary_insanity_bout_rounds_missing`, or `temporary_insanity_bout_not_rendered` findings when a sanity result triggers temporary insanity
- evaluator score of at least 4 for state integrity and spoiler safety

## Version Roadmap

### V1: Playable Kernel

Goal: make the system playable inside Codex with durable saves.

Scope:

- plugin scaffold
- passive COC mode activation
- Keeper role by default
- `.coc/` workspace creation
- reusable investigator library
- campaign save, memory, logs, indexes, and snapshots structure
- first rules JSON tables
- Python scripts for rolls, character derivation, state, scenario catalog, validation
- full guided investigator creation
- quick investigator generation
- PDF catalog and basic source map
- scenario skeleton import
- minimal ordinary play loop
- minimal combat state
- minimal chase state
- SAN roll and basic insanity thresholds
- `[meta]` subsystem
- `[spoiler_warning]` flow
- save and resume
- `coc-playtest` skill
- isolated `.coc/playtests/` sandbox runs
- battle report and evaluation report generation

Acceptance:

- user can activate COC mode only by explicit request
- user can create a campaign
- user can bind a rulebook scenario or external PDF module skeleton
- user can create or select an investigator
- user can play a short scene with at least one roll
- state persists under `.coc/`
- exit creates a player-safe session summary
- next activation resumes from saved state
- V1 playtest suite produces `battle-report.md` and `evaluation-report.md`
- no high-severity spoiler leak or state corruption appears in V1 playtest output

### V2: Reliable Module Runner

Goal: run authored modules more reliably with better structure and anti-spoiler behavior.

Scope:

- richer scenario import
- clue graph
- scene graph
- NPC state and motives
- timeline triggers
- handout handling
- source map precision improvements
- player-safe recap versus Keeper recap
- better `[meta]` parameter inspection
- audit-backed correction flow
- fuller combat and chase rules
- weapons and equipment tables
- occupation tables
- skill base tables
- development phase support
- authored-module playtest suites
- simulated player profiles beyond the careful baseline

Acceptance:

- imported modules have useful locations, NPCs, clues, and Keeper secrets
- Codex can run a module scene without accidentally exposing secrets
- the The Haunting module-level playtest produces a detailed battle report and passes `audit_profile: haunting_module`
- Codex can explain why a check is requested
- Codex can recover from or correct an erroneous ruling
- session memory tracks discovered facts and unresolved threads
- evaluator can cite module-running failures with transcript event ids and state paths

### V3: Long Campaign Platform

Goal: support investigators and worlds across multiple stories.

Scope:

- investigator lifelong profile
- campaign ending workflow
- cross-campaign investigator history
- permanent injury, phobia, mania, enemies, allies, relationships, and Mythos knowledge
- development and recovery automation
- recurring NPCs, organizations, and locations
- world-state continuity across modules
- player preference memory
- campaign archive
- investigator import/export
- snapshot rollback workflow
- multi-session and cross-campaign playtests

Acceptance:

- an investigator can finish one scenario and enter another with persistent history
- permanent changes are written back to the investigator library
- campaign ending produces both player-safe and Keeper records
- later campaigns can reference prior events without mixing temporary saves into long-term state
- playtests prove investigator reuse without writing sandbox changes into the real investigator library

### V4: Engineization

Goal: turn the skill-led system into a stronger local runtime while preserving the Codex chat experience.

Possible scope:

- MCP state engine
- SQLite full-text indexes
- stronger schema validation
- module preprocessing pipeline
- house-rules.json
- RAW versus Keeper ruling explanation
- more complete magic, tomes, monsters, automatic fire, vehicles, and environmental hazards
- scenario authoring tools
- replay and campaign report export
- multi-player preparation without UI dependency
- formal playtest harness integration with MCP or equivalent tool calls

Acceptance:

- state operations can be performed through formal tools
- large module libraries are searchable
- rules disputes can distinguish RAW, structured data, and Keeper rulings
- campaigns can be exported as readable after-action reports
- engine-level tests can replay or reproduce failed Keeper sessions

## Implementation Strategy

Build in this order:

1. Scaffold plugin and skill folders.
2. Write mode protocol and state schema references.
3. Create rules JSON seed tables.
4. Implement Python script foundation.
5. Add tests for rules and state operations.
6. Implement playtest report generation and sandbox layout.
7. Write COC skills.
8. Write `coc-playtest` skill and V1 playtest suite definitions.
9. Validate plugin manifest and skill metadata.
10. Run a local dry run with the existing Keeper Rulebook PDF.
11. Run the V1 playtest suite and generate battle/evaluation reports.
12. Iterate on missing schema fields and play-loop friction.

Do not start by implementing MCP. Keep the Python scripts small and deterministic so they can become MCP tool internals later.

## Open Questions

- Should the plugin live in `~/plugins/coc-keeper` with personal marketplace registration, or inside this workspace first?
- Should V1 include a local `AGENTS.md` adapter template only, or should it also install one into the current project?
- How much of the Keeper Rulebook should be converted into rules JSON in V1 versus V2?
- Should external module PDFs be copied into `.coc/module-library/` or referenced from their original path?
- Should snapshots be created automatically at every exit or only when requested?
- Should playtests default to Codex subagents when available, or should the transcript-driven fallback be the default for reproducibility?
- Should evaluator-only battle reports be allowed to include Keeper spoilers by default, or require an explicit report flag?
