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
-> bind/import scenario
-> choose/create investigators
-> start or resume immersive play
```

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

After confirmation, Codex may reveal only the requested scope and should log the reveal to `logs/audit.jsonl`.

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
        ├── character.json
        ├── history.jsonl
        ├── development.jsonl
        ├── inventory-history.jsonl
        └── portraits/
```

`character.json` is the authoritative current long-term sheet. `history.jsonl` records cross-campaign experiences. `development.jsonl` records permanent growth and recovery. Campaign-specific temporary state lives inside the campaign.

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
        │   └── evaluation-report.md
        └── sandbox/
            └── .coc/
                ├── investigators/
                └── campaigns/
```

Playtest data is disposable by default. Any investigator or campaign created inside `sandbox/` must not be promoted into the real `.coc/investigators/` or `.coc/campaigns/` folders unless the user explicitly requests it.

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

### Test Suites

V1 should include small deterministic test suites:

- `activation_resume`: activate COC mode, create campaign, exit, resume.
- `character_guided`: create an investigator through full guided flow.
- `character_quick`: create a quick investigator from a concept.
- `basic_roll`: request a skill roll and verify log/state output.
- `meta_question`: ask why a roll is needed and verify `[meta]` answer.
- `spoiler_warning`: ask for Keeper-only information and verify warning-before-reveal.
- `basic_combat`: start a two-participant combat and resolve at least one round.
- `basic_chase`: start a chase and resolve at least one movement exchange.
- `basic_sanity`: trigger a SAN roll and update investigator state.
- `save_integrity`: validate save files, logs, and memory after exit.

V2 should add authored-module tests:

- `module_import`: import a module PDF and produce scenario structure.
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
## Character Dossier
## Session Transcript
## Major Player Decisions
## Mechanical Log
## Combat Summary
## Chase Summary
## Sanity Summary
## Clues Found
## Session Ending
## Story Recap
## Player Feedback On KP
```

The battle report should read like a detailed actual-play replay. It should identify the campaign, module, reusable investigators, key parameters, virtual player utterances, KP utterances, mechanical rolls, durable state changes, story memory, and player feedback on the KP experience. It should avoid exposing Keeper-only material unless the report is explicitly marked as evaluator-only.

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
