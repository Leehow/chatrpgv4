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
├── repos/
│   └── campaigns/                 # sidecar bare git: <campaign-id>.git
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
│   ├── run-identity.json           # frozen table-run identity (schema_version 1)
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
│   ├── quest-state.json            # quest runtime states (schema_version 1:
│   │                               #   authored→offered→active→
│   │                               #   completed|failed|abandoned, all writes
│   │                               #   decision_id-idempotent; quests never
│   │                               #   appear player-safe before offered)
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
│                                   #   entries[] (kind gear|weapon) gained in play;
│                                   #   gear entries may carry consumable: true and
│                                   #   quantity: N (state.item_use spends charges,
│                                   #   the entry leaves the inventory at zero),
│                                   #   lost_weapon_ids[] for sheet weapons lost
│                                   # + optional "cash": runtime cash ledger v2 —
│                                   #   schema_version 2, balances{CODE:{amount,
│                                   #   unit?}}, mixed ledger[] (decision_id, op,
│                                   #   amount, currency, source, reason,
│                                   #   localized_reason, balances, recorded_at,
│                                   #   game_time). Not sheet cash strings,
│                                   #   rules.cash_assets, or cash_semantic.
│                                   # + optional "finance": runtime Assets /
│                                   #   living standard / inclusive Spending
│                                   #   Level authority, seeded once from
│                                   #   chargen. Not the sheet snapshot and
│                                   #   not toolbox-asset-heads.json.
├── scenario/                       # compiled story-graph, clue-graph, npc-agendas,
│                                   # threat-fronts, pacing-map, improvisation-boundaries
├── artifacts/                      # DirectorPlan JSON per decision_id
├── index/
├── memory/
│   ├── session-summaries.jsonl     # player-safe running recaps (resume + battle reports)
│   ├── temporal/                   # sole live temporal-memory runtime records
│   ├── cards/                      # immutable legacy Markdown-card evidence
│   ├── context-packs/              # immutable legacy evidence
│   └── index.json                  # immutable legacy card evidence index
├── logs/
│   ├── events.jsonl                # story events
│   ├── rolls.jsonl                 # mechanical roll events
│   ├── audit.jsonl                 # Keeper-facing audit events (e.g. spoiler reveals)
│   ├── toolbox-calls.jsonl         # ordered canonical operation evidence
│   ├── pending-narration-drafts.jsonl
│   │                               # append-only schema-v1 Keeper-only exact draft receipts;
│   │                               # sole pending-draft text authority for review/recovery
│   ├── turn-finalizations.jsonl    # immutable rendered turn receipts + exact hashes
│   ├── table-transcript.jsonl      # exact player/Keeper text actually bound to play
│   │                               #   record_kind: table_opening | player_turn |
│   │                               #   finalized_keeper; opening uses
│   │                               #   source_ref=table.opening#<decision_id>, turn=0
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

`logs/pending-narration-drafts.jsonl` is the sole canonical authority for exact
pending narration bytes. Each append-only schema-v1 receipt binds
`campaign_id`, semantic `review_decision_id`, `review_id`, `turn_id`,
`source_digest`, `revision`, `draft_sha256`, exact `draft_text`, UTF-8 byte
count, review/request digests, `secrecy: keeper_only`, producer kind, and the
materialization decision/provenance under one receipt digest. Normal
`narration.review` writes/reuses this receipt before review evidence; an orphan
receipt is harmless until a matching canonical review exists. Historical
recovery is explicit through `state.recover_pending_narration_draft`, which
may read only matching successful `narration.review` rows from
`logs/toolbox-calls.jsonl`. `turn.output_context` never scans audit or session
transcripts and fails closed when a reviewed pending turn lacks one unique,
fully bound receipt. Draft text is bounded to 8192 UTF-8 bytes and never enters
player projections before successful finalization.

`party.json` references reusable investigator ids. Campaign-specific HP, SAN, conditions, and scene position live under `save/`.

`save/investigator-state/` and `save/sanity-state/` are **package-owned**
directories, declared by the active ruleset's `manifest.json` `state_dirs`
(docs/ruleset-contract.md §6) rather than by kernel literals: the kernel
creates `save/investigator-state/` at campaign init because coc7 flags it
`create_on_init` and gives it semantic `role: actor_state`. Every ruleset has
exactly one such role. Package-neutral actors are created through
`setup.invoke` / `actor.create` after resolver `validate_actor`, and persist an
identity/version-bound envelope containing opaque `sheet`, manifest-keyed
integer `resources`, and state-bound mutation `decisions`. CoC7 keeps the
existing investigator-state shape; the shared actor accessor maps the role to
that directory without changing its schema. Generic `rules.resource_delta`
reads current state itself, atomically writes the new value and receipt there,
and only then materializes its toolbox ledger entry.
`save/sanity-state/` remains lazy and is created by the sanity subsystem that
owns it.

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
runtime truth (idempotent replay). Consumable gear entries carry
`consumable: true` plus `quantity: N`; `state.item_use` decrements the count
and removes the entry at zero, so a spent bandage is really gone. Permanent
library write-back happens only at development settlement (see
`inventory-history.jsonl` above).

Runtime cash is campaign-local on the same investigator-state file. Play
grants and spends use `state.cash_grant` / `state.cash_spend` /
`state.cash_query` with a structured amount, currency, source id, internal
`reason`, player-safe `localized_reason` (current `play_language`), and
`decision_id`. The toolbox stamps `game_time`; callers never pass wall-clock
time. Player-facing finalization projects `localized_reason` plus
`game_time`/`player_time` only — never raw `reason` or `recorded_at`. Schema v2 is
`{schema_version:2, balances:{USD:{amount}, GBP:{amount, unit?}}, ledger}`.
Each currency has independent before/after and insufficient_funds. There is
no FX. ASCII currency codes are case-insensitive (`usd`→`USD`); identity
aliases such as `美元`/`美金`/`dollar` map to `USD` and `英镑`/`pound` to
`GBP` without converting amounts. Omitting `unit` reuses the recorded unit
for that wallet; a different unit fails closed. Mixed-currency ledgers are allowed. The ledger is the audit trail;
rows carry `recorded_at` (wall audit) and `game_time` (canonical campaign
stamp from toolbox/`coc_time.current_stamp`). Old single-wallet
`{amount,currency,seeded}` shapes and player-facing `ts` rows are rejected
as `state_corrupt` with no migration. Character-sheet `cash` prose,
`rules.cash_assets` lifestyle lookup, and starting-only
`state.cash_semantic` never mutate this balance. Absent cash is empty
balances until the first successful grant. Spend fails closed on
insufficient funds in that currency. Amounts with more than two decimal
places are rejected. Direct grant/spend rows use `state.cash_grant` /
`state.cash_spend`. Composite producers may append the same ledger with
`tool: state.purchase` on `op: spend` and `tool: state.assets_liquidate`
on `op: grant`; any other tool name fails closed. Cash `decision_id`
values remain unique across the whole cash ledger. The investigator-state
file also stores `operation_receipts` for cash grants and spends; replay
repairs the event and toolbox ledger from that receipt and never applies
the same `decision_id` twice. Successful cash mutations expose
`changed: true` plus `investigator_id` on the toolbox result so
`turn.finalize` can project each delta exactly once. There is no second
cash engine and no free-text amount parse.

Runtime finance is a sibling object on the same investigator-state file,
never the chargen sheet and never `save/toolbox-asset-heads.json` (cash
integrity heads only). Exact current schema:
`{schema_version:1, period, currency, living_standard, spending_level
{amount,currency,unit?}, assets {schema_version:1, balances, ledger},
receipts {state.purchase:{}, state.assets_liquidate:{}}, seed
{decision_id,source}}`. Assets ledger ops are `seed` / `adjust`
(`setup.chargen_run`) and `liquidate` (`state.assets_liquidate`); amounts
and chain checks match cash. Inclusive Spending Level is a typed current
amount, not a remaining daily meter. Missing, extra, old-version, or
broken finance fails closed with no migration and no zero default.
`state.finance_query` reads this envelope plus current cash. `seed.source`
must be `chargen-credit-rating`; when Assets exist the initial `seed` ledger
row must use that same chargen `decision_id`. Receipt `decision_id` values
are unique across `state.purchase` and `state.assets_liquidate` buckets.
Each receipt carries `fingerprint` over tool+request and `integrity_digest`
over schema/tool/decision/request/fingerprint/result. Purchase results are
closed (`payment_mode` spending_level|cash|aggregate_cash, item, charged
amount, cash before/after, local_date, settled/settled_by,
aggregated_from). Liquidation results bind Assets and cash before/after
plus `linked_time_decision_id`.
`state.purchase` and `state.assets_liquidate` write investigator-state
receipts first, then cash heads (when cash moved), events, and the toolbox
ledger. Exact replay repairs those sidecars from the state receipt; a
toolbox ledger row without that receipt is corruption. Spending-Level
purchases write no cash row and stay `settled: false` until an
`aggregate_cash` decision marks them. Liquidation consumes one positive
`state.advance_time` decision via `linked_time_decision_id`.

Social disclosure uses this exact order: NPC availability, fact knowledge,
fact revealability, active reaction, willingness (trust or authored leverage),
then reveal. A social clue is committed only when a matching decision is
`outcome=reveal`; lie/deflect outcomes may update NPC memory but never commit
the clue. Authored fact metadata does not implicitly populate either knowledge
list, and conflicting overlapping schedule domains are invalid (runtime reads
fail closed if an unvalidated conflict reaches them). Narrator envelopes expose a field-level public projection and omit
raw agendas, fact registries, lies, schedules, secrets, and internal agency.

Live memory is solely `temporal-memory-1`: Git-backed history, its rebuildable
projection, and `memory/temporal/` records provide all runtime recall and
adjudication. `memory/session-summaries.jsonl` remains append-only player-safe
recap evidence for resume flows and battle reports. Legacy `memory/cards/`,
`context-packs/`, and `index.json` remain immutable historical evidence on
disk; live runtime never reads or writes them. Only the explicit
non-destructive historical converter (`coc_legacy_memory_convert.py`) or
report/export evidence path may read them; the converter creates a fresh
temporal target without mutating source bytes or evidence. They are never
silently migrated or deleted.

`save/director-strategy-state.json` has `schema_version: 1` and one canonical
strategy payload: `generic`, `time_loop` (non-negative loop number plus unique
memory IDs), or `multi_faction` (unique ranked faction IDs). Malformed roots,
versions, unknown fields, and duplicate IDs are not persisted.
`create_campaign` initializes the minimal resume contract: `world-state.json` tracks active scene, subsystem, clue ids, scene unlock/visit/history (`unlocked_scene_ids`, `visited_scene_ids`, `exhausted_scene_ids`, `scene_history`), decisions, memory refs, log refs, and investigator-state refs; `active-scene.json` stores the current player-safe scene pointer; `flags.json` stores clue, decision, spoiler-reveal flags, and a structured `flags` map (truthy keys feed `flag_set` exit/unlock conditions). `campaign.json` (current `schema_version: 3`) persists `ruleset_id` — the registered ruleset package selected by public `campaign.create` (default `coc7`, resolved through `coc_rulesets`). It also persists `era_source` (`declared` when the creating caller or starter supplied the era, `authored` once the source parse or module projection established one, `unestablished` when `era` is only the placeholder needed to seed a clock) and `source_fast_facts`, one validated `coc.opening-fast-facts.v1` answer set covering `era`, `place`, `investigator_hook`, `investigator_constraints`, `player_safe_summary`, and `content_flags`. A `source` answer stores its value plus canonical page `source_refs`; an `unresolved` answer stores non-empty canonical `inspected_source_refs` proving which accepted pages were checked. Both retain current source/file/bundle/text/OCR identity and are revalidated at `investigator.contract`, campaign-bound guided Quick Fire `investigator.create`, and `campaign.link_investigator`, so a rebind or cache revision fails closed. Reusable complete-sheet creation is campaign-independent, but linking that sheet remains gated. Character creation fails closed while `era` or `place` is unestablished; the other four answers only enrich the setup briefing. The required order is `campaign.create` → `scenario.bind_pdf` → public typed `setup.adopt_source_facts` → investigator contract/create/link. The runtime kind remains `campaign.adopt_source_facts` behind that single public gateway. A current-schema campaign with a missing, malformed, unknown, manifest-mismatched, or campaign-schema-incompatible binding is rejected as `unsupported_save_schema`; persisted campaigns never fall back to the default and are never migrated. Package `state_dirs` marked `create_on_init` are resolved from this binding at creation time rather than from an import-time default. The campaign also persists `play_language` and a `localized_terms` map keyed by language, so resumed campaigns keep the same visible narration language and the same name/term vocabulary. It deliberately does **not** persist a `language_profile` label bundle; player-visible prose is written by the Keeper in the player's language rather than assembled from translated labels. Logs and memory may include `localized_text[play_language]` for player-visible prose that should be rendered directly before falling back to `localized_terms`.

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

## Quest State

`save/quest-state.json` (schema_version 1) is the runtime state for
action-shaped quests authored in module-assets `entities/quest-<slug>.json`
packs and the optional `scenario/quests.json` IR file (contract:
`skills/coc-scenario-import/references/quest-schema.md`). Exact shape:

```json
{
  "schema_version": 1,
  "quests": {
    "quest-escort-macario": {
      "status": "active",
      "offered_at": "<decision_id>",
      "closed_at": null,
      "close_receipt": null,
      "decision_history": ["<decision_id>", "..."]
    }
  }
}
```

- Per-quest state machine: `authored` (keeper-known stub, not yet offered) →
  `offered` → `active` → terminal `completed` | `failed` | `abandoned`.
  Quests that are `authored` (or absent) never appear in any player-safe
  projection; the `offered` transition is what first makes a quest
  player-visible, and a `secret: true` quest carries no player-safe text
  before that moment at all.
- All writes follow `state.*` discipline: transactional, idempotent by
  `decision_id`, one recorded transition per decision id; replay never
  applies the same decision twice. Machine-checkable conditions
  (`clue_discovered` / `flag_set` / `clock_reaches` from the shared
  `coc_exit_conditions` vocabulary) settle automatically on the settled-event
  path and produce a `close_receipt`; `narrative` conditions are always
  machine-False and close only by an explicit Keeper decision receipt.
- Quest progress is advisory pressure, never a gate: it never blocks
  `move_scene`, player actions, scene transitions, or endings.

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
with delivery unconfirmed. Only an explicit host acknowledgement after the
hash-bound text reached its player transport confirms that the prior
`rendered_sha256` reached the table; a later player reply is not delivery
evidence. Until confirmation, resume may replay only the prior exact
`rendered_text` (inline or fetched by `session.delivery_text` using its
finalization ID and hash); it must never reroll, reapply state, or generate
substitute prose.

`.coc/runtime/host-sessions/` is disposable workspace cache, not campaign
truth. Plugin hooks mark a new `context_epoch` at startup and compaction. The
canonical toolbox recommends `session.resume` until that exact host session and
epoch are bound to a campaign, but does not turn recovery into a fifth hard
narrative/action gate. Direct hosts without hooks still call the same operation
as their first campaign read. Concurrent host sessions are resolved by exact
session identity rather than the most recently updated marker. User prompt text
retained there remains explicitly
`unclassified_host_input` until semantic Keeper judgment and `state.journal`.

## Campaign Run Identity

`save/run-identity.json` is the campaign-owned table-run identity. Exact
current schema (`schema_version: 1`) is:

```text
schema_version, campaign_id, run_segment_id, session_id,
plugin_version, ruleset_id, ruleset_version
```

`coc_state.bind_run_identity` creates or confirms it on the ordinary
`evidence.table_opening` / table-transcript write path. First write resolves
`plugin_version` from the loaded plugin `package.json` and `ruleset_id` /
`ruleset_version` from the campaign binding. Later calls must repeat the same
campaign / run / session or raise `RunIdentityConflict` (`run_identity_conflict`)
without rewriting the file. `coc_state.load_run_identity` returns `None` when
the file is absent. A present but incomplete, sentinel, campaign-id-mismatched,
or non-`schema_version: 1` record raises `UnsupportedSaveSchema` — clean-slate,
no migration, no dual reader, no harness fallback. This record is the
authoritative identity for battle-report export. External `run.json` /
`playtest.json` stay harness-only and must not override it.

## Campaign Git History

Per-campaign history is a sidecar bare git repository at
`.coc/repos/campaigns/<campaign-id>.git`. The campaign directory is the
worktree; it never contains a `.git` directory.
`plugins/coc-keeper/scripts/coc_git_history.py` is the sole writer (Commit
Coordinator). Other agents and scripts must not invoke git against a campaign
repo. Formal decisions live in `docs/specs/campaign-git-history.md` and
`docs/adr/0001-campaign-git-history.md`.

`turn.finalize` commits after every canonical write and before delivery,
including pending-turn cleanup, source-cursor/manifest completion, and the
continuation checkpoint. Those writes and the Git commit share one exclusive
campaign lock. A new turn commit is refused while `save/pending-turn.json`
exists. The Git commit is the last step of the `turn.finalize` wrapper. A
failed commit fails finalize. Campaign creation lands one
`COC-Commit-Type: baseline` commit and does not backfill older turns. Each
finalized turn is `COC-Commit-Type: turn`. In-flight leftover
`save/commit-snapshots/` directories are neither imported, read, nor deleted.
They are ignore-face only and never prove state.

Read-only structured proof for report completeness is
`coc_git_history_verify.state_integrity_proof(...).to_dict()`. Status is
`PASS`, `FAIL`, or `NOT_PROVEN`. Consumers must read `status` plus
`findings[].code`; they must not parse CLI prose. The proof binds HEAD (sha,
commit type, finalization trailer), the latest valid receipt, the tracked
tree, and the campaign worktree. A later `COC-History-Reset` trailer makes
the proof `NOT_PROVEN` even when that later non-turn commit is the permitted
reset explanation. Missing sidecar, baseline-only, or unavailable git is
also `NOT_PROVEN`. Hash drift, dirty authoritative paths, a committed
`save/pending-turn.json`, unpaired receipts, or a wrong HEAD are `FAIL`.
A worktree-only pending turn is not that committed-pending finding. The tree
proof drift-checks only the bounded authoritative subset (`campaign.json`,
`save/world-state.json`, `logs/turn-finalizations.jsonl` after the first
finalized turn, and the non-ignored `save/` prefix); other tracked paths are
committed but not proven by it. Path helpers always return absolute paths —
git runs with cwd at the worktree, so a root-relative `--git-dir` is a hard
failure, never corruption.

The ignore face is the Coordinator constant `IGNORE_PATHS`, written only to
the bare repo `info/exclude` (never a campaign-tree `.gitignore`):
`logs/pending-turns/`, `save/session-state.json`, `save/toolbox-ledger.json`,
`save/commit-snapshots/`, `save/development-settlements/`,
`save/roll-operation-receipts.json`, `save/run-identity.lock`,
`memory/index.json`.

Crash recovery checks out only HEAD's turn-scoped `save/` subset — the same
paths the retired copytree snapshot captured. It never restores
`session-state.json`, `toolbox-ledger.json`, `development-settlements/`,
`roll-operation-receipts.json`, or a leftover `commit-snapshots/` directory.
The ignore list and the restore subset are independent.
`save/continuation/` remains a rebuildable resume cache, not the history
store.

Read-only diagnostic (reports only; never repairs; zero turn commits and zero
receipts is an explicit failure, not a vacuous pass):

```bash
uv run --frozen python plugins/coc-keeper/scripts/coc_git_history_verify.py --root . --campaign <id>
```

## Logs And Memory

- `logs/*.jsonl` is append-only event history.
- `logs/events.jsonl` stores story events, `logs/rolls.jsonl` stores mechanical roll events, and `logs/audit.jsonl` stores Keeper-facing audit events such as confirmed spoiler reveals.
- In fast recording mode, verbose JSONL writes are queued under `logs/pending-turns/` and flushed by a background recorder or maintenance pass; never poll or block narration on that flush.
- `memory/session-summaries.jsonl` stores player-safe running recaps for resume and battle reports. Live memory is solely `memory/temporal/` plus its Git-backed history and rebuildable projection; legacy `memory/cards/`, `context-packs/`, and `index.json` are immutable evidence, readable only through the explicit non-destructive historical converter (`coc_legacy_memory_convert.py`) or report/export path. The converter creates a fresh temporal target without mutating source bytes or evidence; legacy campaigns and cards are never silently migrated or deleted.
- `snapshots/` stores point-in-time recovery copies.

## Playtests

Playtest runs use `.coc/playtests/<run-id>/sandbox/` and must not mutate real campaigns or investigators. Promote sandbox artifacts only after explicit user request.
