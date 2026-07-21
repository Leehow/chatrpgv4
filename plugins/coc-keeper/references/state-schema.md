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
├── runtime/
│   └── host-sessions/              # disposable startup/compaction epoch markers
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

`creation.json` preserves the original rulebook creation workflow and finance/skill allocation evidence. `character.json` is the reusable long-term sheet. Permanent changes are written to the investigator library only during explicit development, recovery, import, or campaign-ending workflows. `inventory-history.jsonl` is the append-only ledger of settled item changes: each development settlement appends one `inventory_settled` event per net weapon/gear delta (event ids embed the ending id, so replayed settlements do not duplicate entries).

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
│   │                               # + receipt-backed "presence" live scene overlay
│   │                               # + frozen campaign-local mechanics on NPC cards
│   ├── campaign-mechanics.json     # frozen campaign-local item profiles
│   ├── storylet-ledger.json        # storylet anti-repeat signatures + usage ledger
│   ├── time-state.json             # in-fiction world clock
│   ├── time-triggers.json          # scheduled time-based triggers
│   ├── sanity-state/               # canonical per-investigator SAN sessions
│   │   └── <investigator-id>.json  # bouts, episodes, caps, current/max SAN
│   ├── sanity.json                 # legacy single-investigator compatibility mirror
│   ├── development-settlements/    # exact ending capsules + transactional receipts
│   │   ├── endings/<ending-id>/    # capsule.json + <investigator>.json/.inflight.json
│   │   ├── conclusion-rewards/     # once-per-investigator authored reward receipts
│   │   └── <investigator>.json     # derived latest compatibility mirror; never recovery truth
│   ├── combat.json                 # combat session state (only during combat)
│   ├── chase.json                  # chase session state (only during chases)
│   ├── character-creation-draft.json  # in-progress creation workflow state
│   ├── pending-turn.json           # journaled turn awaiting exact finalization
│   ├── turn-source-cursor.json     # bounded toolbox-log source cursor
│   ├── turn-manifests/             # immutable/finalized current-turn source windows
│   ├── continuation/
│   │   ├── latest.json             # atomic pointer to newest rebuildable checkpoint
│   │   ├── checkpoints/            # immutable per-finalized-turn recovery projections
│   │   └── delivery-receipts.jsonl # exact Keeper-output transport acknowledgements
│   └── investigator-state/         # per-investigator campaign-local HP/SAN/conditions
│                                   # + optional "inventory": runtime item truth —
│                                   #   entries[] (kind gear|weapon) gained in play,
│                                   #   lost_weapon_ids[] for sheet weapons lost
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
│   ├── toolbox-calls.jsonl         # ordered canonical operation evidence
│   ├── turn-finalizations.jsonl    # immutable rendered turn receipts + exact hashes
│   ├── table-transcript.jsonl      # exact player/Keeper text actually bound to play
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

`save/investigator-state/` and `save/sanity-state/` are **package-owned**
directories, declared by the active ruleset's `manifest.json` `state_dirs`
(docs/ruleset-contract.md §6) rather than by kernel literals: the kernel
creates `save/investigator-state/` at campaign init because coc7 flags it
`create_on_init`, while `save/sanity-state/` is created lazily by the sanity
subsystem that owns it.

Subsystem session files (`combat.json`, `chase.json`, and
`sanity-state/<investigator-id>.json`) are owned by the corresponding session
classes; do not hand-edit them mid-session. A matching legacy `sanity.json` is
migrated to the owner's per-investigator file and remains that investigator's
compatibility mirror. It is never overwritten by another linked party member.
`pacing-state.json`,
`threat-state.json`, `npc-state.json`, and `storylet-ledger.json` are written
by the director apply layer each turn — treat `run_live_turn(...)` as their
single ordinary-turn writer during live play. Typed `mechanics.ensure` is the
narrow exception: it transactionally promotes one NPC card or writes one
campaign-item profile with a `decision_id`, then every later use reuses that
frozen record.

`save/npc-state.json["psych"][npc_id]` is the canonical A20/A21 conversation
state. Its closed fields are `trust`, `fear`, `suspicion` (-5..5),
`known_facts`, `revealable_facts`, `lies_told`, `promises`, `lie_options`,
`deflect_options`, `deflections`, `leverage`, `active_reactions`, `availability`, and
`schedule`. Reads normalize malformed legacy values conservatively; that
normalization is not a repository-wide migration. Ordinary live turns may
change this state only through structured `npc_interactions` and typed
`npc_effects`. Free prose, skill names, agendas, and clue summaries are never
scanned to infer a tactic, target, or disclosure decision.

`save/npc-state.json["presence"][npc_id]` is the canonical explicit live
location overlay written only by `state.npc_presence`. Each current record is
bound to `presence_heads` plus a source receipt and says `present` or `absent`
for one `scene_id`. `scene.context` starts from authored `scene.npc_ids`, then
lets the latest live record add, remove, or relocate that stable NPC. NPC
engagement history, names in prose, and source `mentions[]` are never treated
as presence evidence.

`save/npc-state.json["items"][npc_id]` is the runtime NPC item override:
`current_weapons` (a list, possibly empty) replaces the authored module
loadout at combat start, and `gear` lists narrative possessions. The first
combat seeds `current_weapons` from the authored opponent spec; disarm
transfers at combat end, `state.item_grant`, and `state.item_remove` mutate
it afterwards. An absent/`null` `current_weapons` means "no runtime override
recorded" and authored module weapons apply.

`save/npc-state.json["npcs"][npc_id]["mechanics"]` stores a generated actor
profile only for campaign/improvised NPCs or source NPCs carrying a reviewed
`not_authored` receipt. `save/campaign-mechanics.json["items"][item_id]`
stores the equivalent generated weapon/gear profile. These are campaign canon,
not module truth: authored source profiles stay in scenario IR, and a later
source conflict is surfaced as continuity evidence rather than silently
replacing either assertion.

Inventory during play is campaign-local. An investigator's effective weapon
set is (character-sheet weapons minus `inventory.lost_weapon_ids`) merged
with `kind: "weapon"` inventory entries; combat projections read this merged
set, so a disarmed or granted weapon is a legal combat selection. When a
combat concludes, recorded disarm transfers are committed to both sides'
runtime truth (idempotent replay). Permanent library write-back happens only
at development settlement (see `inventory-history.jsonl` above).

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
`create_campaign` initializes the minimal resume contract: `world-state.json` tracks active scene, subsystem, clue ids, scene unlock/visit/history (`unlocked_scene_ids`, `visited_scene_ids`, `exhausted_scene_ids`, `scene_history`), decisions, memory refs, log refs, and investigator-state refs; `active-scene.json` stores the current player-safe scene pointer; `flags.json` stores clue, decision, spoiler-reveal flags, and a structured `flags` map (truthy keys feed `flag_set` exit/unlock conditions). `campaign.json` (current `schema_version: 2`) persists `ruleset_id` — the ruleset package the campaign binds from creation (default `coc7`, resolved through `coc_rulesets`; older generations are rejected, never migrated) — plus `play_language`, `language_profile`, and a `localized_terms` map keyed by language, so resumed campaigns keep the same visible narration language, output instruction, name policy, term policy, report labels, and name/term localization. Logs and memory may include `localized_text[play_language]` for player-visible prose that should be rendered directly before falling back to `localized_terms`.

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

## Continuation And Context Epochs

Every successful `turn.finalize` publishes one hash-bound schema-v1 checkpoint
under `save/continuation/checkpoints/` and atomically advances `latest.json`.
The checkpoint contains only a bounded projection: canonical state identities,
hash/length/ref identities for the last public exchange, a merged KP-authored
semantic capsule, and refs back to authoritative receipts. It is a rebuildable cache, never a second
campaign ledger. The runtime retains the newest 16 checkpoint files as a ring;
older cache files may be pruned only after the new pointer has been reloaded and
hash-validated. Canonical finalization, transcript, state, and summary evidence
remains append-only, so any pruned checkpoint can be rebuilt.
The canonical direct-runtime `session.resume.data` projection is capped at
40 KiB. Coding hosts using the plugin MCP additionally receive a
`keeper_hot_v1` projection whose **complete envelope** is capped below 16 KiB,
leaving headroom under a 20,000-byte host ceiling. When
inline host input, finalized delivery text, current-turn receipts, scene detail,
or output context would cross that budget, resume replaces it with canonical
hash-bound refs and exact typed read cards (`session.delivery_text`,
`session.continuation_detail`, `turn.output_context`, or `scene.context`) rather
than generating a guessed summary.
If its shape, hash, pointer, or source identity is invalid, `session.resume`
ignores it and rebuilds from `turn-finalizations.jsonl`, `table-transcript.jsonl`,
canonical save state, and the current turn cursor.

`memory/session-summaries.jsonl[].continuation_delta` is sparse structured
meaning supplied by the Keeper: unresolved intent, identified thread lifecycle,
confirmed decisions, do-not-repeat commitments, and durable style commitments.
Runtime code validates IDs, enums, sizes, and merge identity only; it never uses
keywords or regexes to infer those meanings. Default style commitments preserve
scene/NPC/causal play, campaign language, and situational Table Wit across
compaction.

`delivery-receipts.jsonl` is append-only transport evidence. A checkpoint starts
with delivery unconfirmed. An explicit host acknowledgement or the next exact
player reply confirms that the prior `rendered_sha256` reached the table. Until
then, resume may replay only the prior exact `rendered_text` (inline or fetched
by `session.delivery_text` using its finalization ID and hash); it must never
reroll, reapply state, or generate substitute prose.

`.coc/runtime/host-sessions/` is disposable workspace cache, not campaign
truth. Plugin hooks mark a new `context_epoch` at startup and compaction. The
canonical toolbox recommends `session.resume` until that exact host session and
epoch are bound to a campaign, but does not turn recovery into a fifth hard
narrative/action gate. Direct hosts without hooks still call the same operation
as their first campaign read. Concurrent host sessions are resolved by exact
session identity rather than the most recently updated marker. User prompt text
retained there remains explicitly
`unclassified_host_input` until semantic Keeper judgment and `state.journal`.

## Logs And Memory

- `logs/*.jsonl` is append-only event history.
- `logs/events.jsonl` stores story events, `logs/rolls.jsonl` stores mechanical roll events, and `logs/audit.jsonl` stores Keeper-facing audit events such as confirmed spoiler reveals.
- In fast recording mode, verbose JSONL writes are queued under `logs/pending-turns/` and flushed by a background recorder or maintenance pass; never poll or block narration on that flush.
- `memory/session-summaries.jsonl` stores player-safe running recaps for resume and battle reports; `memory/cards/` is the director-retrievable memory store (see Campaigns above for the split).
- `snapshots/` stores point-in-time recovery copies.

## Playtests

Playtest runs use `.coc/playtests/<run-id>/sandbox/` and must not mutate real campaigns or investigators. Promote sandbox artifacts only after explicit user request.
