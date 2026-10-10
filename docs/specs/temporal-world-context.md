# Temporal World: Clock-Aware Scene and NPC Context

## Problem Statement

When in-game time reaches deep night, the game currently presents ordinary streets, people and public facilities as if it were daytime. Players see the same pedestrian density, open shops and awake residents at 03:00 as at noon. This is wrong in two directions:

- Residential households often rest at night, yet the world does not reliably reflect that. There is no durable ordinary wakefulness record that a later routine judgment can consult, so the Keeper may lose an already-established awakening.
- Night entertainment, night work and emergencies can remain active, and the model has no durable way to hold that context so it stays consistent across turns.

Closed public service also does not make all physical entry impossible. Window entry, detection, object acquisition and the time actually consumed are separate outcomes. The current time-fit instruction explicitly judges a declared activity without requiring completion evidence; that risks charging the full planned cost of a blocked action. An OOC time charge was observed during the preceding diagnosis; unavailable-service and blocked-access costs require regression and live coverage rather than being claimed as already-measured universal failures.

The canonical local game clock is already projected to the Keeper. The missing system path is its connection to durable, provenance-bearing temporal context and reassessment. Historical scene prefetch is also keyed by scene without a day-part boundary, so a same-scene night change can keep daytime background.

Routine social behaviour (when households sleep, when services open, what night activity is plausible in a given society or era) is not a fixed foundation truth. It varies by era, place and fiction, so it is handled by an optional, Mod-owned strategy rather than by the kernel.

## Solution

The work is split into two layers.

### Foundation temporal record and provenance APIs (kernel, mandatory)

These are foundation behaviour, not switchable through a Mod:

- A new `scene` apply effect records the contextual state of an existing scene (service, crowd, activity summary) with provenance and optional review timing. It establishes context only; it never moves anyone, grants access, transfers items, reveals discoveries or completes actions.
- A new `activity` variant of the `npc` apply effect records an NPC's wakefulness and a short activity summary with provenance, and never changes position or combat conditions. Inferred updates cannot overwrite observed or established records. Real transitions are recorded as observed or established events with a reason.
- The kernel stamps every record with the canonical game clock, scene and turn. Capsule and named views show provenance, recorded clock, current applicability and whether review is needed. Review is triggered by missing records, changes in time-of-day/day/anchor, passing a declared review boundary, or an NPC moving to another place. Stale priors are never shown as fresh observations.
- The Keeper is given a clear instruction to reassess before portraying service, street activity or ordinary NPC response after a relevant transition, and to record materially established changes through the existing apply path.
- Time-fit accounting counts the actual completed or attempted portion of the action and its known result, not the full proposed duration.

### Optional strategy Mod: `daily-life` (Mod-owned, switchable)

The social-routine strategy is a Mod, not kernel behaviour:

- The Mod supplies a table and resident guidance through one advice channel:
  - **`temporal_context`** is the only contribution the Mod makes to the kernel's contributes surface. It carries the candidate routine table (`contexts.json`).
  - **Resident guidance** (`agent.md`) is an optional, explicitly declared package-file reference in the Mod manifest. It is not a contribution of `instructions`. Resident guidance and the rows selected for the current scene travel together in their own bounded **`coc-temporal-advice`** channel, which does not use `contributes.instructions` and does not draw from the old instruction budget.
- Jev judges each of the nine advice rows as an independent decision with its own Noul (one Noul per row); several rows may match at once. The judge input for each row is the clock, the scene, the people present, the actual flag rows, recent events and any retrieved original materials. Jev judges era, place and scene purpose from the authored and established fiction.
- Actual selection thresholds come from campaign settings and are exposed to the host as plain numbers. The Mod contains no hardcoded hours and no semantic classifiers.
- Code performs clock arithmetic and stale-result fencing. Jev does not do date arithmetic and does not write facts.
- Resident fallback guidance may be delivered while the judge is unavailable. No rows are selected unless the whole issued batch returns complete, valid Jev answers. Table matches never commit world state.
- Low-confidence or unavailable decisions fall back to the Keeper. They never default everybody awake or asleep and never stop the player.
- Turning the Mod off removes both the row advice and the resident guidance channel, while keeping the clock and all recorded facts.
- There are no universal numeric closing or sleep hours. The table, not the code, carries era and place differences.

All judgments are open semantic judgments from the canonical clock, place purpose, the authored/established fiction and compatible historical reference. The system does not use a universal closing/sleep-hour table in code, the operating system clock, a scripted Keeper, a semantic keyword classifier, a no-tool text-generation lane, ethnicity or region stereotypes, or prewritten night scenes.

## User Stories

1. As a player, when the game clock reaches deep night, I want ordinary residential streets and daytime public services to change plausibly while night activity can remain active, so that the world does not feel frozen in daytime.
2. As a player, when I am in a residential place at night, I want households to be presented as likely resting, so that the home feels plausible.
3. As a player, when I am in a night entertainment or working location, I want that activity to remain plausible at night, so that the city does not uniformly empty.
4. As a player, when an emergency or real event is underway at night, I want people and services to respond to it, so that night does not suppress consequences.
5. As a player, when a person has been awakened by a real event, I want them to stay awake in later turns, so that a generic clock refresh does not put them back to sleep.
6. As a player, when a public service is closed, I want physical entry to remain possible through other means where the fiction supports it, so that a closure does not block all play.
7. As a player, when I attempt an action that is only partly carried out or blocked, I want time to be charged only for the portion actually completed or attempted, so that the clock reflects what happened.
8. As a player, when I ask an out-of-character question or a service is unavailable, I want no full activity time to be charged for merely proposing that action.
9. As the Keeper, I want to record a scene's temporal context (service, crowd, activity summary) through the apply path, so that my judgments persist across turns.
10. As the Keeper, I want to record an NPC's wakefulness and activity through the apply path, so that I can keep sleeping, resting and awake people consistent.
11. As the Keeper, I want an inferred update to be prevented from overwriting an observed or established record, so that a routine guess does not erase a deliberate fact.
12. As the Keeper, I want to see each temporal record's provenance, recorded clock, applicability and review status in the capsule and named views, so that I can judge whether it is still current.
13. As the Keeper, I want a stale record to remain visible as a prior and not be presented as a fresh observation, so that I can reassess rather than repeat it.
14. As the Keeper, I want a clear instruction to reassess before portraying service, street activity or ordinary NPC responses after a relevant transition, so that I do not carry old context forward.
15. As the Keeper, I want the scene's temporal context shown alongside the current place and the active person's activity in the present and named views, so that the relevant state is visible when I narrate.
16. As the Historical Reference system, I want scene retrieval to include time-of-day and the need for typical service hours and night street activity, so that returned background matches the current time.
17. As the Historical Reference system, I want retrieval results cached per setting, scene and day part rather than per clock minute, so that the system does not churn requests, and a same-scene night change invalidates a retained daytime prefetch.
18. As an existing player with a save made before this feature, I want the save to load without invented observations, with the game requesting reassessment, so that my older game remains playable and honest.
19. As a player who prefers a plainer world, I want to turn off the Daily Life Mod and keep the clock and all recorded facts, so that I can disable routine guidance without losing anything that already happened.
20. As the Keeper, I want routine guidance to arrive as a few contextual rows selected for this scene, not as a schedule, so that I can weigh them against the fiction rather than follow a fixed hour.

## Implementation Decisions

- **Clock.** Use only the canonical local game clock for all temporal judgments. Do not read the operating system clock. The kernel does not carry a universal closing or sleep-hour table. Existing day parts are review checkpoints and may be used to trigger reassessment, but they are not semantic schedules.
- **Keeper judgment.** The Keeper performs open semantic judgments from the current clock, the purpose of the place, the authored and established fiction, and compatible historical reference. No new no-tool text-generation lane, scripted Keeper, semantic keyword classifier, ethnicity/region stereotypes or prewritten night scenes are introduced.
- **Scene effect.** Add a foundation apply effect `scene`, targeting an existing scene by name or as `here`. Its activity record contains:
  - an English summary (one sentence);
  - `basis`: `observed` | `established` | `inferred`;
  - optional `service`: `open` | `closed` | `limited` | `unknown`;
  - optional `crowd`: `quiet` | `active` | `crowded` | `unknown`;
  - optional `review_after_minutes` (positive integer).
  The effect establishes contextual state only. It does not cause movement, physical access, item transfer, discovery or action completion.
- **NPC activity variant.** Add an `activity` variant to the `npc` apply effect, as a standalone variant (like `mood`). Its fields:
  - `wakefulness`: `awake` | `asleep` | `resting` | `unknown`;
  - English summary;
  - `basis`: `observed` | `established` | `inferred`;
  - optional `review_after_minutes`.
  It does not seat or move the NPC and does not change combat conditions. Other changes are separate effects within the same atomic batch.
- **Basis precedence.** An `inferred` update cannot overwrite an `observed` or `established` record. A supported actual transition (for example, an NPC being woken by a real event) is written as an `established` or `observed` event with a stated reason.
- **Stamping.** The kernel stamps every temporal record with the canonical game clock, scene and turn. Records are never edited to appear fresh.
- **Applicability and review.** Capsule and named scene/NPC views show provenance, recorded clock, current applicability and a review flag. Review is needed when: the record is absent; time-of-day, day or anchor context has changed; a declared `review_after_minutes` boundary has passed; or the NPC has moved to another place. A stale prior remains visible as a prior and is never represented as a fresh observation. The current old observation remains visible, and a routine update cannot silently overwrite it.
- **Missing-activity projection.** A person with no recorded activity is projected in named and present views as `unassessed`, `current: false`, `review_required`. It is never omitted. Temporal state is retained even in a name-only stub and is accounted separately from the existing dossier quota, still within the overall outbound request ceiling. This repaired an actual nine-person budget regression; all names and at least four full dossiers remain.
- **Transport observability (diagnostic only, not world state).** Separately opt-in `PI_COC_GROK_TRANSPORT_TRACE_RAW=1` retains SSE data/comment contents, SDK event snapshots and abort/error causes, redacts credentials, never records request bodies or actual HTTP headers, writes 0600 files in 0700 directories, leaves request/backpressure/retry/timeout behaviour unchanged, and records coverage limits explicitly. The earlier observer kept metadata only despite being called raw; this is corrected without retroactively restoring earlier evidence. OpenTelemetry integration is not added.
- **Projection.** Scene temporal context is projected with `where`. Individual activity is projected on the present/named person card and in NPC actor availability. The Keeper receives a clear reassessment instruction before portraying service, street activity or ordinary NPC response after a relevant transition. This review does not require a mandatory historical lookup, create a synthetic action, or create a user choice.
- **Opening.** At the opening, a scene context may be recorded only for the active scene. An NPC activity may be initialized only for a person already seated here. Existing opening protection for unrelated actions stays unchanged.
- **Atomicity and ordering.** Batches remain atomic, with idempotent replay and existing actor/player admission. Temporal context is bound to its position in effect order: time/travel effects occur first, and refreshed contextual records follow, so the records represent the resulting time.
- **Daily Life Mod delivery.** The `daily-life` Mod is a package with a manifest, a candidate routine table and resident guidance.
  - The manifest declares its requirements on the temporal context and package-file capabilities, `default_enabled` true for fresh campaigns, no conflicts, and settings for the selection threshold (default 0.5, range 0.1–0.9) as plain public numbers. Existing campaign locks are not silently changed.
  - Its contributes surface is `temporal_context` only. The table holds nine rows (maximum 32), separating residential street activity from individual household sleep, each with an English id slug, label, applicability criterion, exclusions and advice. The Mod uses no language maps or manually translated labels.
  - Resident guidance (`agent.md`) is referenced as an explicitly declared package file, and is delivered through the bounded `coc-temporal-advice` channel together with the selected rows. It does not go through `contributes.instructions` and does not use the old instruction budget.
- **Jev selection.** When Jev is available, it judges each of the nine rows independently (one Noul per row) and selects zero or more rows for the current scene. Each judgment receives the clock, scene, people present, actual flag rows, recent events and retrieved original materials. Code performs clock arithmetic and stale-result fencing. Jev does not write facts. Rows are selected only on a complete, valid Jev batch; an unavailable or incomplete answer yields no selected rows, and resident fallback guidance may still be delivered. Disabling the Mod removes row matching, selected advice and the resident guidance channel, while the clock and recorded facts remain.
- **Historical Reference.** Existing scene retrieval includes time-of-day and the need for typical service hours, household or night work, and street activity in its objective. Results are coalesced and cached by setting, scene and day part, not per clock minute. The full local clock remains in the relevance context. A night change within the same scene invalidates a retained daytime prefetch. Source provenance and exact/analogous boundaries are preserved. If search is unavailable, a coherent, qualified fictional portrayal is permitted, with no forced waiting or retry. The Daily Life Mod does not invent historical source claims or citations.
- **Foundation status.** Temporal records and provenance APIs are foundation behaviour, not switchable through a Mod. The social-routine strategy is optional and Mod-owned. Foundation behaviour introduces no new Keeper verb and no dependency or provider/model default change.
- **Old saves.** Saves without temporal records are readable. They request reassessment and do not invent observations.
- **Time fit.** Time-fit decisions count the actual completed or attempted portion of an action and its known result. OOC questions, unavailable service and blocked access cannot alone justify the full intended activity cost. Existing resolve arithmetic, move travel accounting, object inventory authority and player consent remain authoritative. No second action execution system is created.
- **Three ends.**
  1. Keeper writes through apply `scene` / `npc` (activity).
  2. Capsule, named views and actor availability read the records.
  3. The Keeper adopts the current context for portrayal and the next resolve/apply.
  Canonical receipts and retained telemetry record adoption, actual effects and elapsed time. Offer counts are never an obligation fed back to the Keeper.
- **Prior art.** Evennia separates game-time scheduling from game-related callbacks (https://www.evennia.com/docs/latest/Howtos/Howto-Game-Time.html). Inform's daemons and timers attach world changes to active objects and distinguish time-of-day from those changes (https://www.inform-fiction.org/manual/html/s20.html). These confirm separate ownership of time and state transitions. Neither justifies a universal schedule or a deterministic NPC scheduler in this model-authored TRPG.
- **Prototype reference.** Prototype primary source is commit `5f5851c3e` on `codex/temporal-world-prototype-20261009`. Its HTML shell must not enter production. Prototype counter hours and controlled dice were fictional assumptions and are not carried forward.
- **Baseline.** The original baseline was clean 0.9.7a at `8b33f8b4e`. Current mainline is latest 0.9.7a. Commit `efcb6f181` implements the temporal/Daily Life Mod system; `028ad047b` adds complete opt-in raw response observation; `a1eae4c6b` fixes literal pre-unit halves/quarters, including nine-and-a-half hours in Han syntax, using safe exact fraction arithmetic with full source-span binding. The final complete source gate and package at `a48836075` passed; bounded installed verification and remaining limitations are recorded below.

## Testing Decisions

- **Kernel seam.** Test at the existing kernel RPC/capsule seam: apply → advance time/travel → read current scene and NPC → attempt → read receipts and persistent state.
- **Context coverage.** Cover Keeper-established residential and entertainment contexts. Fixtures must not claim to prove semantic model quality.
- **Boundaries.** Test precise review boundaries within one day part, and day crossing. Do not test against a universal closing hour, because none exists.
- **Waking and protection.** Test that a woken NPC is not put back to sleep by a generic refresh, and that observed/established records are protected from inferred overwrites.
- **Review.** Test each review trigger: absence, time/day/anchor change, boundary passing, NPC move. Confirm stale priors are labelled as priors.
- **Old saves.** Load a save with no temporal records; confirm it is readable and requests reassessment with no invented records.
- **Invalid writes and atomicity.** Test invalid `scene` and `npc` activity writes and confirm full batch rollback. Test idempotent replay.
- **Time fit.** Test that actual completed/attempted portions and known results determine elapsed time; OOC questions, unavailable service and blocked access do not charge full activity cost.
- **No automatic entry or theft.** Test that closed service or temporal context never grants physical entry, transfers items or completes theft.
- **Daily Life Mod package.** Parse the Mod manifest (`mod.json`) and routine table (`contexts.json`) as JSON with node, and check that the manifest `conflicts` field is an array. Verify that item ids are unique. Check that the manifest id, version, game_api, state_version, requires, package_files, contributes and settings agree with the files: the contributes surface is `temporal_context` only; `agent.md` is declared under `package_files`, not under `instructions`; the table has 1–32 rows (nine in the current table) with unique lowercase slug ids; and every row has the required fields. Confirm that row advice and resident guidance are delivered only through the `coc-temporal-advice` channel, that rows are selected only on a complete valid Jev answer per row (with resident fallback guidance permitted when the judge is unavailable), and that table matches never commit world state. Confirm that disabling the Mod removes both channels and leaves the clock and recorded facts intact.
- **Historical Reference host cache/request seam.** Test that a same-scene day-part change invalidates the retained prefetch, and that per-minute clock changes within a day part produce no retrieval churn.
- **Live play.** Use `tests/play/driver.py` on the current source/runtime with the real Keeper, with this root as the single public-only player, one natural input per delivered turn. No fixed turn count and no forced narrative or check outcome. Preserve all evidence.
- **Acceptance distinctions.** Native historical retrieval and live portrayal require actual returned material and real delivery; mocked source tests do not satisfy them. Source play and installed App acceptance are recorded as separate evidence.

## Out of Scope

- Any operating-system clock use or a universal closing/sleep-hour table in kernel code.
- A scripted Keeper, a no-tool Keeper text lane, a semantic keyword classifier, or prewritten night scenes.
- Ethnicity or region stereotypes, or a product-wide topic list for routine rows.
- A deterministic NPC scheduler or routine simulation.
- Automatic movement, physical entry, item transfer, discovery or theft from temporal context.
- A new Keeper verb, dependency, or provider/model default change.
- Importing the prototype HTML shell or prototype counter hours and controlled dice.
- Any change to existing resolve arithmetic, move travel accounting, object inventory authority or player consent beyond the time-fit counting rule.
- Unrelated features or refactors.

## Further Notes

### Status

Owner approved specification, implementation and real-system testing on 2026-10-09. The root reviewed this specification. The approved Mod architecture (kernel temporal records plus the optional `daily-life` strategy Mod) is recorded here and is unchanged.

Current exact tested and packaged implementation source is `a488360756c139ebcf17ad5f7f5f4dbc3f75e040`. The latest clean 0.9.7a includes the accepted PDF changes. Implementation commits: `efcb6f181` (temporal records and Daily Life Mod), `028ad047b` (opt-in raw transport observation), `a1eae4c6b` (literal pre-unit fractions), `8032361f1` (terminal-error log repair), `781f96c28` (repaired local-exit replay).

Final overnight source gates all exited 0 on `a488360756c139ebcf17ad5f7f5f4dbc3f75e040`: extension 5413 passed, 0 failed; Python 2127 passed, 2 skipped; loop 12 passed; 896 seconds. Local checks: duration tests 7 passed; raw observer tests 20 passed; compile routing 17 passed; typecheck passed; native Jev destination cases 6 with expected matches.

The source real-Keeper play is bounded and is not a whole-scenario completion. The night closure of the library was observed, and in the real prior run the player physically entered at night and committed possession of one ordinary library book (`一本普通馆藏书`). Final canonical inventory verifies that the book's owner is the investigator. A persistent awake-NPC record was also observed. The whole scenario is not completed and no victory or ending is claimed.

The installed canonical App was rebuilt offline from the pre-existing testbox npm cache and pinned, verified archives, after one retained `ENOTCACHED` failure. The build used PipiUI Dev stable signing, an exact package receipt, Node 24.19 (ABI 137) and Git 2.53. The staging directory was empty and the LaunchServices/Spotlight path was unique. The native GUI old session was preserved; the independent Daily Life 1.0.0 is visible; the old campaign remains disabled; the default for new campaigns is enabled; and the actual fast model is `opencode-go/claude-haiku-5-5` with thinking off.

Installed package play delivered one real driver turn through the actual installed compiled runtime. A half-hour wait (30 minutes) crossed to 00:13 and observed a closed, dark library and a sparse street. The whole installed scenario is not completed.

At the time of the native observation, no native App GUI gameplay input and no GUI toggle walkthrough occurred. Later authorized web GUI acceptance is recorded in the GUI evidence summary (Installed App and GUI section).

Not claimed: zero time cost for a short activity (the repaired live replay charged 9 minutes), universal semantic accuracy of the routine judgments, and any whole-scenario victory. The old reduced fixture also passed, but it is not used as proof of semantic quality.

### Projection correction (kernel)

- Missing NPC activity is explicitly projected as `unassessed`, `current: false`, `review_required` in both named and present views. It is never omitted.
- Temporal state is retained even in a name-only stub and is accounted for separately from the existing dossier quota, still within the overall outbound request ceiling.
- This repaired an actual nine-person budget regression. All names and at least four full dossiers remain.

### Verification evidence (as observed, not as success)

- **Baseline:** original clean 0.9.7a at `8b33f8b4e`. The current latest clean 0.9.7a includes the accepted PDF changes. Implementation is committed as `efcb6f181`, `028ad047b` and `a1eae4c6b`, with later `8032361f1` and `781f96c28`.
- **Final overnight source gate** on `a488360756c139ebcf17ad5f7f5f4dbc3f75e040`: extension 5413 passed, 0 failed; Python 2127 passed, 2 skipped; loop 12 passed; all exit codes 0; 896 seconds. Log retained as `overnight-final-all.log`.
- **Local checks:** durations 7; transport observation 20; compile routing 17; typecheck passed; native Jev destination cases 6, expected matches.
- **Repaired live local-exit replay** (`daily-life-haunting-exact-replay-r2-20261009`): campaign turn 41 with the exact original player declaration (climbing back out through the side-alley window gap and checking the coat for the book). No move receipts were produced. The active scene remained `central-library`. Destination resolution was `none` with confidence 0.85. The actual short-activity cost was 9 minutes (band `brief_activity`, permitted range 2–10, actual cost 9), not zero. The book remained in the investigator's inventory.
- **Installed package play** (`daily-life-haunting-package-20261009`): one natural turn, Keeper wall time 46.3 s, half-hour wait (30 minutes) crossing 00:13 on 1920-10-14. Library recorded as `closed` and `quiet`, with a `review_after_minutes` of 180. Previous record (night, closed, dark, side-alley window ajar) retained as a prior.
- **Installed App packaging** on `a488360756c139ebcf17ad5f7f5f4dbc3f75e040`: runtime hashes recorded for `build/runtime/pi-hybrid.mjs`, `build/kernel/rpc.mjs` and `build/extensions/grok-build-oauth/agent/index.mjs`.
- **Earlier failed or interrupted attempts** are preserved as evidence and not erased, including the earlier full run with failures and a shared-box interruption.
- **Real Jev fixture component probe:** three contexts completed in 350–772 ms. Component probe only.
- **Native Exa and Jev historical component probe:** returned original materials in 2215 ms, status ready. Not a claim of historical verification or Keeper adoption.

### Source real-Keeper play (actual observations, bounded)

Live source RPC play used explicit Grok 4.7 low, with this root as the sole public-action player. Fast generative lanes ran on `opencode-go/claude-haiku-5-5`, thinking off. Original runs total 30; overnight runs total 8; exact repaired replays total 3.

- Library open in the morning. A selected 9.5-hour wait advanced 570 minutes to 21:00. The closing, dark windows, locked front door and clerk departure were observed and recorded as a closed/quiet scene.
- A side-window entry was blocked by a physical latch in one attempt. In the real prior run, night physical entry occurred and the player committed possession of one ordinary library book, `一本普通馆藏书` (object-item-7). Final canonical inventory verifies its owner (investigator). This is recorded as observed possession of an ordinary library book, not as any other kind of completed action.
- A 5.5-hour wait plus a separately counted 30-minute travel reached 03:26. The news vendor had closed and left; the street was almost empty except a milk delivery. Households slept; late knocks woke irritated occupants who kept door chains engaged.
- The first awakening was narrated but not recorded. After the explicit missing-NPC projection, a subsequent real awakening wrote `observed`/`awake` at 03:27 into canonical `world.json`, and later conversation retained it.
- A capped wait of at most 3 hours at the office ended at 09:00 with 149 minutes actual wait plus 30 minutes travel, not the full 180-minute cap.
- Native historical originals were actually delivered, and the same-scene evening phase was retrieved afresh.
- Real table-matching records and confirmed provider-message delivery are saved.
- These are actual observations. They do not show a controlled causal proof that one field alone changed model behaviour.
- The investigation segment closed at 09:02 when Knott accepted the diaries and paused the rental listing; the player withdrew for the day. No whole-scenario ending or victory is claimed.
- Earlier source play did not recognise "nine and a half hours" in Chinese; "9.5 hours" worked. The overnight continuation with the fractional lexer subsequently selected exactly 570 minutes.
- The repaired local-exit replay (see Verification evidence) is one live replay, not a universal semantic-accuracy guarantee. The old reduced fixture also passed.

### Installed App and GUI (actual observations, bounded)

- Canonical App bundle `/Applications/PipiCOC.app`, stable identity PipiUI Dev, signing certificate `108232c5a713c15a869fc4c267e18d2e35cd276c`. The launcher `pi-coc` started in compiled `play` mode, loop engine `hybrid-v1`, pi 1.0.0 (base commit `a13d35a742c6`, vendored).
- Native GUI: old session preserved; independent Daily Life 1.0.0 visible; old campaign still disabled; default for new campaigns enabled; actual fast model `opencode-go/claude-haiku-5-5`, thinking off, verified.
- No GUI gameplay input occurred in the native App during this observation. The native observation above is preserved as recorded.

### GUI evidence summary (authorized web GUI, bounded)

- Method: explicitly user-authorized web GUI (ego-browser taskSpace 4, page p1). Every player action was submitted through the visible textarea and send button; no synthetic Keeper or backend state mutation. Keeper grok-build/grok-4.7 (thinking low); fast lane opencode-go/claude-haiku-5-5. Transport: localhost WebSocket source host with real PiBackend and TS kernel, same renderer as the native App; transport differs from the native App. Three runtime hashes (`runtime/pi-hybrid.mjs`, `kernel/rpc.mjs`, `extensions/grok-build-oauth/agent/index.mjs`) match between source and App.
- Gameplay: five natural player inputs and six deliveries through the GUI covered the opening, a library visit, a 990-minute wait to 03:00 with the closed and quiet library, a failed closed-door attempt with no time jump, a watchman exchange, and a 360-minute wait to 09:00 when the library opened. Final state: clock 1920-10-13 09:00, scene Central Library, Corbitt House key x1, cash 70 USD.
- Daily Life toggle: campaign off then on, new-campaign default preserved, enabled after page reload. The authoritative disabled observation is `mod-disabled-snapshot.txt`; the earlier `mod-off.png` was taken immediately after disabling and is superseded.
- Basis guard: an inferred write over an observed/established activity was rejected and recovered on the next valid write; opening-transaction restriction self-recovered. Neither is a client defect.
- Slow replies: raw capture 12 attempts, all complete; per-turn wall time 48–211 s. Timing observation only; upstream cause not asserted.
- Partial screenshot delivery was progressive presentation that finished; diagnostic, not a defect.
- Limits: scoped acceptance only. Not a whole-scenario completion, not historical-hours accuracy, not all eras, not GUI burglary verification. Earlier window entry/theft and residential waking came from source play, not this GUI run.
- Report: `/Users/haoli/leehow/code/chatrpgv4-research/reports/handoff-20261008/temporal-world-implementation-20261009/gui-evidence/GUI-ACCEPTANCE.md`; machine-readable evidence is adjacent in `acceptance.json`. Native App GUI gameplay was not performed in this observation.
- Installed package play was RPC-only, as recorded in the installed evidence.

### Transport trace (diagnostic, separate from world state)

- Earlier observer retained only metadata although described as raw. This is corrected. Earlier incomplete evidence is not retroactively restored.
- A separately opt-in `PI_COC_GROK_TRANSPORT_TRACE_RAW=1` retains SSE data and comment contents, SDK event snapshots, and normalized and result-only SDK terminal error causes, including when no SSE is present. Credentials are redacted. Request bodies and actual HTTP headers are never recorded. Files are 0600 in 0700 directories. Request, backpressure, retry and timeout behaviour are unchanged. Coverage limits are recorded explicitly. Local tests: 20 passed.
- Measured Grok 4.7 failure: after `response.output_text.delta` at 20:05:38.551 UTC there was a 60003 ms gap with 3 incoming HTTP-body chunks (39 bytes), 3 SSE comments (33 bytes), 0 SDK raw data events and 0 SSE data events. Observer delay max 1 ms. `caller_signal` cancellation, then retry. The connection stayed live while model data stopped. Client evidence does not distinguish the model service from the forwarding service.
- The exact heartbeat/no-model 60-second client watchdog cause is captured: the local semantic progress watchdog cancelled with `Provider stream timed out: no response event for 60000 ms`, after four heartbeat comments and no SDK data. The upstream silence cause is still unknown without origin or forwarder logs.
- HTTP entity byte counts and timing are retained; TCP/TLS packet capture is not added. Earlier metadata-only evidence cannot be reconstructed.
- Cross-validated principles: separate opt-in message-content capture (https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/gen-ai-spans.md) and exclusion of credentials/tokens from logs (https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html). OpenTelemetry integration is not added.

### Prototype source and lifecycle (validation limitation)

- Prototype primary source and evidence are retained at `/Users/haoli/.codex/worktrees/temporal-world-prototype-20261009` on branch `codex/temporal-world-prototype-20261009`. Classification: retained primary prototype source and evidence.
- Final audit identity is clean and valid, but the audit is still pending. Closeout is blocked because the `lsof` probe cannot stat an unrelated `/Volumes/10.3.2.75` WebDAV mount. Nothing was force-closed, unmounted or deleted.
- This is a validation limitation separate from the functional source and package gates. Full lifecycle closeout is not claimed. Retry only when the probe is authoritative.

### Pending validation

- GUI gameplay and the GUI Daily Life toggle walkthrough passed via explicitly user-authorized web GUI (scoped; see GUI evidence summary). Native App GUI gameplay has not been performed.
- The whole installed scenario is not completed. Only one real installed driver turn was delivered.
- Upstream cause of the 60-second heartbeat/no-model silence requires origin or forwarder logs.
- Prototype audit and closeout are blocked by the validation limitation above.
- No universal semantic accuracy, no all-era/all-place behaviour guarantee and no zero-cost short-activity claim are made.

### Implementation and validation checklist

`[x]` = implemented, per previous specification and approved evidence. `[ ]` = evidence pending or explicitly not performed.

- [x] Confirm baseline: original clean 0.9.7a at `8b33f8b4e`; current latest clean 0.9.7a includes the accepted PDF changes.
- [x] Review prototype primary source at `5f5851c3e` on `codex/temporal-world-prototype-20261009`; exclude its HTML shell.
- [x] Author `daily-life` Mod package: `mod.json`, `contexts.json`, `agent.md` (text and data only).
- [x] Validate Mod package JSON and manifest/table agreement with a parser (Stories 19, 20). The actual production manifest contributes only `temporal_context`; `contexts.json` references its declared `agent.md` guidance file.
- [x] Implement `scene` apply effect with basis, service, crowd and review fields (Stories 9, 15).
- [x] Implement `npc` `activity` variant with wakefulness, basis and review fields (Stories 10, 11, 5).
- [x] Implement basis precedence: inferred cannot overwrite observed/established (Story 11).
- [x] Implement kernel stamping with clock, scene and turn (Story 12).
- [x] Implement applicability and review triggers in capsule and named views (Stories 12, 13).
- [x] Implement projection of scene context with `where` and activity on person card/actor availability (Story 15).
- [x] Implement missing-activity projection as `unassessed`, `current: false`, `review_required` in named and present views, retained in name-only stubs, separate from dossier quota, within the outbound ceiling (Stories 15, 18).
- [x] Implement Keeper reassessment instruction after relevant transitions (Story 14).
- [x] Implement opening constraints for scene and NPC activity (Stories 9, 10).
- [x] Implement effect-order binding and atomic batch with idempotent replay (Story 9).
- [x] Implement time-fit counting of actual completed/attempted portions (Stories 7, 8). Literal pre-unit halves/quarters are fixed in `a1eae4c6b`; the final source gate on `a488360` passed.
- [x] Implement Mod delivery on the `coc-temporal-advice` channel: nine independent per-row Jev judgments, rows selected only on complete valid answers, resident fallback when judge unavailable, disable removes both channels (Stories 19, 20). Actual provider delivery and scene/NPC state writes are retained in source-driver evidence.
- [x] Implement Historical Reference time-of-day objective and day-part cache with invalidation (Stories 16, 17).
- [x] Implement old-save reassessment without invented records (Story 18).
- [x] Implement opt-in raw transport trace (`PI_COC_GROK_TRANSPORT_TRACE_RAW=1`); 20 local tests passed, including terminal-error capture without SSE (`8032361f1`).
- [x] Add kernel RPC/capsule seam tests for the targeted cases listed in Testing Decisions.
- [x] Add Historical Reference host cache/request seam tests.
- [x] Run final full `all` on `a488360756c139ebcf17ad5f7f5f4dbc3f75e040`: extension 5413 passed, 0 failed; Python 2127 passed, 2 skipped; loop 12 passed; all exit codes 0; 896 seconds.
- [x] Repair and replay local exit (`781f96c28`): campaign turn 41, exact original declaration, no move receipts, active scene `central-library`, destination `none` (confidence 0.85), actual short-activity cost 9 minutes. Not a zero-cost or universal-accuracy claim.
- [x] Run the temporal-context investigation segment through the real source RPC driver; preserve all evidence. Night physical entry and committed possession of one ordinary library book were observed in the real prior run; final canonical inventory verifies the owner. Whole-scenario victory is not claimed.
- [x] Record native historical originals, actual provider delivery and real scene/NPC state adoption.
- [x] Build the canonical installed App offline from the pre-existing testbox npm cache and pinned verified archives after one retained `ENOTCACHED` failure; PipiUI Dev stable signing, exact package receipt, Node 24.19 ABI 137, Git 2.53, empty staging and unique LaunchServices/Spotlight path verified.
- [x] Verify native GUI: old session preserved; independent Daily Life 1.0.0 visible; old campaign disabled; fresh default enabled; actual fast model Haiku 5.5 with thinking off.
- [x] Deliver one real installed driver turn: half hour (30 minutes) crossing 00:13, closed and dark library and sparse street.
- [x] GUI gameplay input passed via explicitly user-authorized web GUI (scoped acceptance; not a whole-scenario completion; native App GUI gameplay not performed).
- [x] GUI Daily Life toggle walkthrough passed via explicitly user-authorized web GUI (campaign off/on, new-campaign default preserved, reload persistence).
- [ ] Determine the upstream cause of the heartbeat/no-model 60-second silence (requires origin or forwarder logs).
- [ ] Prototype audit and closeout: audit pending, closeout blocked by the `lsof` probe on an unrelated `/Volumes/10.3.2.75` WebDAV mount. This is a validation limitation separate from the functional gates; nothing was deleted or unmounted.
- [x] Root review under the invoked to-spec skill; issue #111 records the approved architecture and source evidence. Mainline commits are `efcb6f181`, `028ad047b`, `a1eae4c6b`, `8032361f1`, `781f96c28`.

### Prior art

- Evennia Game Time: https://www.evennia.com/docs/latest/Howtos/Howto-Game-Time.html
- Inform manual, daemons and timers: https://www.inform-fiction.org/manual/html/s20.html
