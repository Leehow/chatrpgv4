# COC State Schema

## Workspace

Runtime data lives under the current project `.coc/` directory:

`campaigns/<id>/save/director-strategy-state.json` is an apply-owned
schema-version-1 snapshot. It contains `strategy_type`, specialized structured
state such as `loop_number`, `player_retained_memory_ids`, or
`ranked_faction_ids`, and `last_decision_id`. It never stores scenario prose or
Keeper secrets.

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

Top-level indexes provide machine-readable entry points across the workspace:

```text
.coc/indexes/
├── investigators.json
├── campaigns.json
├── pdf-catalog.json
└── module-catalog.json
```

`investigators.json` records reusable investigator ids, display names, and paths to `creation.json`, `character.json`, `history.jsonl`, `development.jsonl`, and `inventory-history.jsonl`. `campaigns.json` records campaign ids, titles, status, play language, party file, and paths to each campaign's `save/`, `memory/`, and `logs/` folders. Campaign lifecycle `status` values describe only campaign saves; use `concluded` for a finished scenario, not `complete`, so save files and semantic requests do not read like Codex thread-goal completion signals.

## Reusable Investigators

Investigators are reusable assets:

```text
.coc/investigators/<investigator-id>/
├── creation.json
├── character.json
├── history.jsonl
├── development.jsonl
└── inventory-history.jsonl
```

`creation.json` preserves the original rulebook creation workflow and finance/skill allocation evidence. `character.json` is the reusable long-term sheet. Permanent changes are written to the investigator library only during explicit development, recovery, import, or campaign-ending workflows.

## Campaigns

Campaigns store temporary and scenario-specific state:

```text
.coc/campaigns/<campaign-id>/
├── campaign.json
├── party.json
├── save/
│   ├── world-state.json            # active scene, discovered clue ids, decisions, refs
│   ├── active-scene.json           # current player-safe scene pointer / next-turn contract
│   ├── flags.json                  # clue, decision, and spoiler-reveal flags
│   ├── pacing-state.json           # turn number, tension level, recent intent classes/tags
│   ├── threat-state.json           # threat-front clock segments
│   ├── npc-state.json              # persisted NPC persona cards + stat promotions
│   │                               # + "psych" namespace: per-NPC trust/fear/suspicion,
│   │                               #   known_facts / lies_told / promises (coc_npc_state)
│   ├── storylet-ledger.json        # storylet anti-repeat signatures + usage ledger
│   ├── time-state.json             # in-fiction world clock
│   ├── time-triggers.json          # scheduled time-based triggers
│   ├── sanity-state/               # canonical per-investigator SAN sessions
│   │   └── <investigator-id>.json  # bouts, episodes, caps, current/max SAN
│   ├── sanity.json                 # legacy single-investigator compatibility mirror
│   ├── development-settlements/    # ending receipts, recovery journals, reward receipts
│   ├── combat.json                 # combat session state (only during combat)
│   ├── chase.json                  # chase session state (only during chases)
│   ├── character-creation-draft.json  # in-progress creation workflow state
│   └── investigator-state/         # per-investigator campaign-local HP/SAN/conditions
├── scenario/                       # compiled story-graph, clue-graph, npc-agendas,
│                                   # threat-fronts, pacing-map, improvisation-boundaries
├── artifacts/                      # DirectorPlan JSON per decision_id
├── index/
├── memory/
│   ├── session-summaries.jsonl     # player-safe running recaps (resume + battle reports)
│   ├── cards/
│   │   ├── player-safe/            # retrievable memory cards, player-visible
│   │   └── keeper-only/            # retrievable memory cards, keeper-side
│   ├── context-packs/              # precomputed retrieval packs
│   └── index.json                  # memory card index
├── logs/
│   ├── events.jsonl                # story events
│   ├── rolls.jsonl                 # mechanical roll events
│   ├── audit.jsonl                 # Keeper-facing audit events (e.g. spoiler reveals)
│   ├── live-turn-runtime.jsonl     # run_live_turn receipts (decision ids, intent
│   │                               # resolution, recording mode, auto-advance)
│   ├── scene-state-patches.jsonl   # detailed state_patch payloads (queued)
│   ├── storylet-scheduler.jsonl    # OPTIONAL debug: storylet trigger/deck/filter
│   │                               # traces (off by default; see live-turn-internals)
│   ├── scene-progress.jsonl        # bridge/transition scene governance traces
│   ├── npc-agency.jsonl            # NPC agency move decision traces
│   ├── npc-generation.jsonl        # NPC genesis pipeline audits
│   ├── npc-stat-upgrade.jsonl      # NPC stat-profile promotion audits
│   ├── time.jsonl                  # world-clock advancement log
│   ├── intent-eval/                # intent router request/result artifacts
│   ├── pending-turns/              # queued fast-mode JSONL batches awaiting flush
│   ├── flush-attempts.jsonl        # background recorder flush markers
│   └── maintenance-flush.jsonl     # out-of-band forced flush audits
└── snapshots/
```

`party.json` references reusable investigator ids. Campaign-specific HP, SAN, conditions, and scene position live under `save/`.

Subsystem session files (`combat.json`, `chase.json`, and
`sanity-state/<investigator-id>.json`) are owned by the corresponding session
classes; do not hand-edit them mid-session. A matching legacy `sanity.json` is
migrated to the owner's per-investigator file and remains that investigator's
compatibility mirror. It is never overwritten by another linked party member.
`pacing-state.json`,
`threat-state.json`, `npc-state.json`, and `storylet-ledger.json` are written
by the director apply layer each turn — treat `run_live_turn(...)` as their
single writer during live play.

`save/npc-state.json["psych"][npc_id]` is the canonical A20/A21 conversation
state. Its closed fields are `trust`, `fear`, `suspicion` (-5..5),
`known_facts`, `revealable_facts`, `lies_told`, `promises`, `lie_options`,
`deflect_options`, `deflections`, `leverage`, `active_reactions`, `availability`, and
`schedule`. Reads normalize malformed legacy values conservatively; that
normalization is not a repository-wide migration. Ordinary live turns may
change this state only through structured `npc_interactions` and typed
`npc_effects`. Free prose, skill names, agendas, and clue summaries are never
scanned to infer a tactic, target, or disclosure decision.

Social disclosure uses this exact order: NPC availability, fact knowledge,
fact revealability, active reaction, willingness (trust or authored leverage),
then reveal. A social clue is committed only when a matching decision is
`outcome=reveal`; lie/deflect outcomes may update NPC memory but never commit
the clue. Authored fact metadata does not implicitly populate either knowledge
list, and conflicting overlapping schedule domains are invalid (runtime reads
fail closed if an unvalidated conflict reaches them). Narrator envelopes expose a field-level public projection and omit
raw agendas, fact registries, lies, schedules, secrets, and internal agency.

Memory has two complementary tracks: `memory/session-summaries.jsonl` is the
append-only player-safe recap stream consumed by resume flows and battle
reports; `memory/cards/` + `context-packs/` + `index.json` is the retrievable
card store the Story Director queries (via `coc_memory`) for PAYOFF-style
recall. Session summaries are written at session boundaries; memory cards are
written by the apply layer when a plan carries memory_write intents.

`save/director-strategy-state.json` has `schema_version: 1` and one canonical
strategy payload: `generic`, `time_loop` (non-negative loop number plus unique
memory IDs), or `multi_faction` (unique ranked faction IDs). Malformed roots,
versions, unknown fields, and duplicate IDs are not persisted.
`create_campaign` initializes the minimal resume contract: `world-state.json` tracks active scene, subsystem, clue ids, scene unlock/visit/history (`unlocked_scene_ids`, `visited_scene_ids`, `exhausted_scene_ids`, `scene_history`), decisions, memory refs, log refs, and investigator-state refs; `active-scene.json` stores the current player-safe scene pointer; `flags.json` stores clue, decision, spoiler-reveal flags, and a structured `flags` map (truthy keys feed `flag_set` exit/unlock conditions). `campaign.json` persists `play_language`, `language_profile`, and a `localized_terms` map keyed by language, so resumed campaigns keep the same visible narration language, output instruction, name policy, term policy, report labels, and name/term localization. Logs and memory may include `localized_text[play_language]` for player-visible prose that should be rendered directly before falling back to `localized_terms`.

`pending_choices` is Keeper-facing resume state, not a player menu. It may record
latent affordances, unresolved pressures, or rules choices for continuity, but
ordinary player-facing narration must translate those entries into diegetic
cues and an open-ended prompt instead of rendering them as numbered or bulleted
actions. Visible action lists belong only to meta discussion, setup/character
creation, explicit rules subsystems, or player-requested option summaries.
**禁止**将 `pending_choices` 存为玩家可见的选项字符串数组（如 `["问租客","查记录","进屋"]`）；
玩家可见的行动暗示必须来自编译后场景的 `affordances`（见 story-graph-schema），由 narrator 转成
diegetic cue，并由 `choice_frame.is_real_fork` 决定是否在真分叉时停下交选择。`pending_choices`
只承载 Keeper 续跑所需的状态连续性，绝不承载玩家菜单。

## Logs And Memory

- `logs/*.jsonl` is append-only event history.
- `logs/events.jsonl` stores story events, `logs/rolls.jsonl` stores mechanical roll events, and `logs/audit.jsonl` stores Keeper-facing audit events such as confirmed spoiler reveals.
- In fast recording mode, verbose JSONL writes are queued under `logs/pending-turns/` and flushed by a background recorder or maintenance pass; never poll or block narration on that flush.
- `memory/session-summaries.jsonl` stores player-safe running recaps for resume and battle reports; `memory/cards/` is the director-retrievable memory store (see Campaigns above for the split).
- `snapshots/` stores point-in-time recovery copies.

## Playtests

Playtest runs use `.coc/playtests/<run-id>/sandbox/` and must not mutate real campaigns or investigators. Promote sandbox artifacts only after explicit user request.
