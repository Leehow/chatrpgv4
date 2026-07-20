# COC bounded working-set runtime

Work ID: `coc-bounded-working-set-runtime`
Status: `In Progress`
Last updated: `2026-07-19`

## Product question

Can the canonical Keeper preserve causal table prose, exact dice and visible
state changes through a long real campaign while keeping each turn's runtime
and model context proportional to the current scene rather than total campaign
history?

A hollow result would be a smaller log or a green component suite that weakens
the Keeper, hides mechanics, replaces semantic judgment with heuristics, or
never survives a real plugin-native run.

## Approved constraints

- Keep the LLM Keeper in charge of player intent, fictional causality, NPC
  motivation, pacing, improvisation, and final prose.
- Keep deterministic dice and HP/SAN/MP/Luck/ammunition/item arithmetic, exact
  player-visible mechanics, transactional state, and read-only module truth.
- Keep the mandatory causal final-output boundary. Do not turn Director,
  Storylet, narration advice, or memory retrieval into a fixed turn pipeline.
- Preserve creative campaign-local canon and continuity debt without putting
  every narrative assertion into world flags or physical inventory.
- Relevance and compaction are semantic decisions represented by structured
  lifecycle evidence; never infer them from keyword or regex hits over prose.
- Codex/CLI, MCP hosts, and Pi/headless share one canonical implementation.
  In-memory caching may accelerate a resident host but cannot be required for
  correctness.
- This is a clean-slate project. New persisted contracts use the exact current
  schema and do not add migrations or legacy readers.

## Runtime invariant

Normal turn work is bounded by:

```text
O(active scene + present actors + open threads + active effects + current turn delta)
```

It must not be bounded by total turns, total receipts, total NPCs, total
inventory history, or total narrative history. Full evidence may grow on disk
for reports and audits, but it is outside the play hot path.

## Four data planes

1. **Immutable module plane** — sparse seven-file live IR over the durable
   module asset store. Deep content remains entity/scene scoped.
2. **Canonical current-state plane** — latest world, character, NPC, presence,
   thread, clock, inventory, and exceptional-effect values.
3. **Bounded working-set plane** — a rebuildable projection containing only
   the active scene, present actors, active/open state, current turn delta, and
   a bounded set of semantically recalled capsules.
4. **Cold evidence plane** — exact transcript, tool, roll, state, and
   finalization receipts. Battle-report and explicit audit code may read it;
   ordinary play queries do not.

## Turn isolation and manifests

Every successful `state.journal` opens exactly one pending turn manifest with a
stable `turn_id`, journal identity, toolbox byte/index cursor, and current turn
number. The manifest references the bounded log slice; it does not copy full
tool envelopes.

- `turn.output_context` reads the pending manifest slice, never the complete
  toolbox history.
- `turn.finalize` closes that exact manifest. A later journal cannot open while
  it remains pending.
- A missing critical/fumble/pushed-failure effect freezes only that turn.
  Source-bound exceptional-effect repair may update the pending manifest; it
  must never absorb a later journal.
- A successful finalization advances the toolbox cursor beyond the finalized
  call. Crash recovery uses the finalization receipt plus manifest identity,
  not a replay of campaign history.
- The existing finalization receipt remains externally compatible during the
  first vertical slice. A later schema change must update direct and Pi hosts
  atomically.

After the manifest slice is proven, `state.journal` may return the same drafting
context directly. `turn.output_context(turn_id)` remains the explicit reread or
repair route. This removes one normal round trip without weakening the output
boundary.

## Revisioned working set and tool cache

Canonical writers increment only affected domain revisions. Initial domains:

```text
scene, npc_presence, world, clues, time, active_effects, party,
inventory:<actor>, npc:<npc>, thread, progressive_queue
```

Read-tool cache identity is:

```text
tool + normalized args + campaign generation + visibility scope
+ exact read-domain revision vector + module/plugin contract hashes
```

Do not use a single campaign revision: journaling or changing an off-scene NPC
must not invalidate the active scene projection.

Tool registry metadata grows from `needs_campaign` to include `access`,
`read_domains`, `write_domains`, `recovery_domains`, `response_mode`,
`context_budget`, and `audit_mode`. A query performs recovery only for a
declared domain with a pending transaction marker. Full audit becomes an
explicit maintenance/cold-path operation.

Cache policy:

- Rule tables, tool schemas, module entities, and authored NPC cards use
  content-hash caches.
- Scene/NPC/clue/inventory queries use revision-keyed full/delta/not-modified
  projections.
- Director/Storylet/narration briefs may reuse exact input+state digests.
- Mutations use frozen `decision_id` receipts, never ordinary result caching.
- Dice replay is legal only for the same immutable roll/decision identity.
- Receipt/event lookup uses incremental ID/offset indexes.
- Resident MCP/Pi processes may add an in-memory cache above the durable
  materialized projection; CLI behavior remains equivalent after process exit.

## Scene and NPC presence

Runtime presence is canonical and may override authored scene membership.

- Scene entry returns one full projection.
- Later reads accept `since_revision` and return `delta` or `not_modified`.
- Presence deltas contain `entered_npc_ids`, `stayed_npc_ids`, and
  `exited_npc_ids` plus changed NPC patches.
- Authored NPC identity/voice/agenda is static and cached. Trust, fear,
  suspicion, pair-scoped impression, promises, lies, availability, and known
  facts are dynamic revisions.
- NPC exit evicts the hot projection and records a bounded capsule. Re-entry
  restores the latest dynamic state plus only relevant memory.
- APP, Credit Rating, Build, appearance, equipment, and other character
  factors are projected on first contact or when they materially affect the
  current ruling; unchanged values are not repeated every turn.

## Semantic compaction and case files

Scene/NPC/thread capsules preserve outcomes, canonical state changes,
unresolved references, promises, continuity debt, case-file references, and
source turn IDs. Repeated description, exhausted tactics, and tool explanation
stay only in cold evidence.

Thread lifecycle is structured as `active`, `deferred`, `resolved`, or
`archived`. The Keeper or a semantic router supplies that meaning with reasons;
runtime code does not scan prose for phrases.

Investigation documents and evidence use a separate case-file index. Physical
inventory may hold a compact `case_file_ref`, but document bodies, provenance,
clue links, and archival state do not live in the equipment list. Mutation
tools return deltas; full lists require an explicit list/status query.

## Response and evidence budgets

- Query and mutation envelopes default to deltas or compact references.
- A budget overflow returns explicit continuation/entity references; it never
  silently drops authoritative state.
- `toolbox-calls.jsonl` stores compact prompt/audit projection plus a digest or
  blob reference for large internal data. Exact player-visible mechanics and
  required report evidence remain source traceable.
- Writing cold audit evidence does not invalidate working-set caches.

## Implementation slices

1. Pending-turn manifest, bounded source cursor, failed-turn isolation.
2. Tool metadata and per-domain revisions; remove global recovery from
   unrelated query hot paths.
3. Durable working-set projection and cache service; integrate
   `scene.context`, `npc.query`, and `clues.query` first.
4. Scene/NPC full-delta-not-modified and runtime presence.
5. Delta mutation envelopes for inventory, flags, progressive queue, and other
   high-volume tools.
6. Semantic scene/NPC/thread capsules and independent case-file state.
7. Compact audit/blob references, incremental roll/receipt indexes, and
   on-demand tool-schema bundles.
8. Shorten the always-loaded Keeper skill to the product contract; move
   subsystem detail behind normal skill/tool discovery.

## Validation profile

Implementation uses thin deterministic tests only for the touched contracts:

- turn isolation and cursor recovery;
- revision invalidation and visibility-safe cache keys;
- full/delta/not-modified projections;
- NPC enter/stay/exit/re-enter state;
- mutation delta envelopes and idempotent receipt replay;
- compaction lifecycle/source references without prose keyword tests;
- exact dice/mechanics/finalization preservation.

Do not repeatedly run broad suites during early construction. As soon as the
first integrated slice is usable, run a fresh plugin-native session with the
main Codex as Keeper and a `fork_turns: "none"` Agent player. Continue to a
real ending or honestly documented operational blocker. The canonical exporter
alone writes the battle report; read the report and evidence end to end.

Primary real-run evidence is table quality plus hot-context bytes, input
tokens, tool calls, cache hits/misses and invalidation reasons, and comparable
latency at early/late turns of similar scene complexity. Component tests do
not establish product acceptance.

## Implemented first vertical slice

Slices 1–3 are now integrated far enough for normal plugin play:

- `state.journal` creates one stable pending-turn manifest and refuses to open
  a later journal until the exact turn is finalized.
- `turn.output_context` reads only the manifest's toolbox-log byte range.
  Successful finalization advances the cursor; failed exceptional-effect
  settlement remains isolated to its source turn.
- The toolbox registry declares access, read/write/recovery domains, response
  mode, and audit mode instead of treating every query as a whole-campaign
  operation.
- Durable domain revisions and query-keyed projections back
  `scene.context`, `npc.query`, and `clues.query`. Identical reads can return a
  cache hit or `not_modified`; relevant writes invalidate them without making
  process-local memory part of correctness.
- Persistent pushed-failure restrictions can now be resolved by their stated
  condition, including a failed roll whose canonical Luck adjustment changed
  it to success. Final prose exposes that the condition was satisfied.
- Extreme impaling damage renders both the rolled damage and the authoritative
  extreme total, so the public roll no longer appears to contradict the HP
  delta.

This answers the tool-state-cache question narrowly: cache immutable data and
revision-addressed read projections. Do not cache mutations as ordinary tool
results, do not make cached prose authoritative, and do not require a resident
process for correctness.

## 2026-07-19 plugin-native run

A fresh run reached a structured TPK after 23 finalized turns. It used the
canonical plugin flow with the main Codex as Keeper and a `fork_turns: none`
Agent player. The player saw the exact finalized table output each turn and
confirmed the terminal state. The subagent shared the filesystem with the
Keeper, so isolation was protocol-enforced rather than cryptographic.

Observed integration evidence:

- 240 toolbox calls across turns 0–23; the cold log continued to grow while
  finalization consumed only the pending turn's bounded source slice.
- At the turn-16 snapshot, 185 calls occupied about 1 MiB. Manifest source
  slices averaged about 29 KiB (minimum 6.6 KiB, maximum 74 KiB), rather than
  rereading the accumulated file.
- A pushed Climb failure created a persistent damaged-return-route
  restriction. A later Mechanical Repair roll missed by one, spending one Luck
  made it successful, and the new resolution lifecycle cleared the stated
  restriction.
- An extreme Spot Hidden result supplied extra causal information about the
  ritual dagger, residue, and impossible dust arc instead of acting as a plain
  permission gate. SAN and combat narration likewise preserved exact visible
  mechanics.
- The final Corbitt impale displayed the base `1D4+2+1D4 = 8`, the extreme
  impale total of 13, and HP `12 -> 0` without contradiction.
- The canonical exporter found all 32 required public/consequence-public rolls
  exactly once. Report classification remains `INCOMPLETE` because only turns
  18–23 had an exact saved player/Keeper transcript; this run is vertical-slice
  evidence, not a whole-product acceptance claim.

## What the run changed about the performance diagnosis

The architecture no longer has to reload all prior turns for final output, but
cache reuse alone is not the main remaining win. Exact queries changed often,
so the early snapshot produced ten misses, one `not_modified`, and few direct
hits. More importantly, several single-call responses were intrinsically
oversized:

- `combat.context` and `combat.resolve` returned roughly 20k-token payloads,
  including a full weapon/catalog projection that the current exchange did not
  need.
- `state.item_grant` returned the entire inventory instead of the granted-item
  delta.
- `state.end_session` returned the full development capsule rather than a
  compact player-facing settlement plus references.
- Generic `npc.advise` generated a large, bland personality silhouette for an
  authored Walter Corbitt and conflicted with module truth. The Keeper rejected
  it and recorded non-adoption. Authored NPC cards should bypass generic
  generation and project only relevant static/dynamic fields.

Therefore the next implementation order is:

1. Add compact/delta response projections to `combat.context`,
   `combat.resolve`, `state.item_grant`, and `state.end_session`; make full
   catalogs and capsules explicit cold-path queries.
2. Add runtime NPC presence revisions with enter/stay/exit deltas and an
   authoritative-card fast path. Do not spend tokens generating a generic
   substitute for module-authored identity, agenda, or voice.
3. Compact Director/NPC advice inputs and outputs, with explicit late fetches
   for deeper material.
4. Render a cross-turn Luck spend as an amendment to the source check as well
   as a current-turn Luck delta.
5. Narrow scene cache dependencies, then add semantic scene/NPC/thread
   capsules and case-file storage so evidence documents stop inflating physical
   inventory.

Continue to use thin contract tests while constructing these slices. The next
meaningful acceptance point is another fresh plugin-native run with the entire
exact transcript persisted from turn zero.

## Approved compile-on-change archive slice (2026-07-19)

The current exact-query cache is necessary but insufficient: it saves local
projection work while still returning overlapping full payloads to the Keeper.
The next approved product slice is a versioned, rebuildable materialized archive
that compiles on source/state change and keeps ordinary play reads bounded.

Acceptance ledger:

- [x] Publish hash-bound, visibility-safe, entity/scene-sharded JSON through an
  atomic manifest; never create a second authoritative module or campaign state.
- [x] Hook progressive deep-pack merge to enqueue or build affected archive
  shards outside the player's foreground path.
- [x] Make the current-scene hot path consume one bounded play packet with
  explicit covered domains and drill-down references instead of requiring
  overlapping scene/NPC/clue/whole-module-secret reads.
- [x] Scope secret retrieval by current scene or explicit entity; keep an
  explicit cold-path whole-module audit mode rather than dumping it by default.
- [x] Compile static tool contracts once per plugin contract hash and expose a
  small hotset plus canonical discover/invoke access to long-tail operations.
- [x] Shorten always-loaded Keeper guidance into a routing contract while
  preserving the canonical product constitution and host parity.
- [x] Preserve synchronous authority for player-intent judgment, dice,
  HP/SAN/Luck arithmetic, transactional state, and turn finalization. Background
  semantic artifacts remain provenance-bearing advice, never a fixed pipeline.
- [x] Re-run the same real Grok/Codex KP benchmark and report initial schema
  bytes, foreground context bytes, model/tool turns, cache-read tokens,
  finalizer retries, and wall time. Component tests alone are not acceptance.

Implementation order: archive/read-model core and scoped scene packet first;
tool-contract hotset second; skill routing third; real-host A/B last.

### Archive-slice outcome

- The materialized archive now publishes generation-sharded JSON behind one
  atomic, hash-bound manifest. Normal reads validate the manifest and selected
  shards without rescanning or rehashing all seven source IR files.
- Progressive deep-pack work publishes after its background merge. Direct IR
  writes may publish synchronously as best-effort rebuildable output, but an
  archive failure never rolls back or replaces canonical IR.
- `scene.context` and active-scene `secrets.briefing` consume bounded archive
  packets with exact drill-down references. Whole-module secrets require an
  explicit audit scope.
- Grok MCP discovery fell from 68 advertised operations / 66,980 compact JSON
  bytes to 14 advertised tools / 16,042 bytes. The three meta operations
  preserve exact discover/invoke access to all 66 canonical operations, and
  the static contract archive fails closed on registry drift.
- The always-loaded Keeper skill fell from 59,391 bytes to 12,983 bytes;
  six routed normative references retain the detailed contracts.
- One same-state, same-input probe completed in 84 seconds on Grok and 178
  seconds on Codex (2.12x wall-time difference). The Grok run used nine model
  turns, 456,320 cache-read tokens, no retries, and the compiled archive. The
  Codex subagent surface exposed tool counts and wall time but not model-token
  counters, so unavailable counters are recorded as unavailable rather than
  estimated.
- A revised-hotset probe directly recorded the material non-first-contact NPC
  engagement. It exposed and then verified fixes for historical finalization
  receipt compatibility and post-journal exact idempotent replay. Resuming the
  same pending turn completed `turn.output_context -> turn.finalize` in 18
  seconds with zero discovery or retries. This is an experience probe, not a
  whole-product acceptance claim.

## Per-turn continuation slice (2026-07-19)

The long-run degradation diagnosis also exposed a second boundary: a fast
working set does not help after host compaction or process close unless the new
model context can recover the exact current transaction, public exchange, and
semantic commitments without rereading history.

- `turn.finalize` now publishes an immutable, hash-bound continuation checkpoint
  after the bounded source cursor advances. A missing, stale, or corrupt cache is
  rebuilt from canonical finalization/transcript/state receipts.
- `session.resume` is the first listed campaign operation. It returns exactly one
  of `pending_finalization`, `open_turn_recovery`, or `awaiting_player`, plus the
  current source-window receipts, scene packet, semantic capsule, and exact
  delivery status. It does not create a mandatory Keeper turn pipeline.
- Codex/Grok plugin hooks mark startup and compaction epochs. The toolbox itself
  enforces the rehydration gate, while the hot PreToolUse wrapper fast-passes
  unrelated source tools without starting Python.
- Sparse semantic deltas merge by stable IDs. They preserve unresolved player
  intent, thread lifecycle, confirmed decisions, do-not-repeat constraints,
  scene/NPC/causal craft, play language, and Table Wit; runtime code never infers
  those semantics from free-prose keywords.
- Delivery acknowledgements are separate from fiction/state. Unconfirmed prior
  output can only be replayed byte-for-byte; a later exact player response proves
  it was seen and closes the transport uncertainty.

Component coverage proves checkpoint publication/rebuild, open-transaction
recovery, host epoch blocking, delivery confirmation, input privacy, and hook
bypass denial. Whole-product acceptance still requires a real plugin-native
close/reopen or compaction probe with an Agent player and exact battle report.
