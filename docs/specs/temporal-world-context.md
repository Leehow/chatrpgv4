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
- **Baseline.** The original baseline was clean 0.9.7a at `8b33f8b4e`. Current mainline is latest 0.9.7a. Commit `efcb6f181` implements the temporal/Daily Life Mod system; `028ad047b` adds complete opt-in raw response observation; `a1eae4c6b` fixes literal pre-unit halves/quarters, including nine-and-a-half hours in Han syntax, using safe exact fraction arithmetic with full source-span binding. Completion is not claimed on any baseline; clean-current validation for the latest addition remains pending.

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

Owner approved specification, implementation and real-system testing on 2026-10-09. The root reviewed this specification. The approved Mod architecture (kernel temporal records plus the optional `daily-life` strategy Mod) is recorded here. Core implementation is complete and committed on mainline (`efcb6f181`, `028ad047b`, `a1eae4c6b`). A real investigation segment has closed with delivery of the diaries and a suspended rental listing. The full scenario remains unresolved. Full LAN `all` passed for the first two commits (ext 5408 passed, 0 failed; Python 2127 passed, 2 skipped; loop 12 passed; exit 0; 928 s). The final fractions code (`a1eae4c6b`) has 7 local regression passes, including actual kernel clock/apply/replay, and kernel typecheck passed; its LAN focused run was interrupted with exit 255 when another owner started heavy testing on the shared box. Only our verified process group was stopped and all logs were preserved; this is not a validation pass. Final clean-current `all`/build-fetch for this latest addition is pending shared resource availability. Installed App acceptance was not performed, and successful physical window entry/theft remains unverified. This is not a claim of full success.

### Projection correction (kernel)

- Missing NPC activity is explicitly projected as `unassessed`, `current: false`, `review_required` in both named and present views. It is never omitted.
- Temporal state is retained even in a name-only stub and is accounted for separately from the existing dossier quota, still within the overall outbound request ceiling.
- This repaired an actual nine-person budget regression. All names and at least four full dossiers remain.

### Verification evidence (as observed, not as success)

- **Baseline:** original clean 0.9.7a at `8b33f8b4e`. Concurrent, already-committed PDF repairs advanced the current mainline to `5b35b00de`. Implementation is committed as `efcb6f181` and `028ad047b`, followed by the literal-fractions repair `a1eae4c6b`.
- **Focused kernel check** (temporal, voice-bench, capsule): 23 passed. Type check passed.
- **NPC mood and read/privacy checks:** 123 passed.
- **Raw Grok diagnostics tests:** 18 passed.
- **Final full `all` run on mainline `5b35b00de` plus this implementation:** ext 5408 passed, 0 failed; Python 2127 passed, 2 skipped; loop 12 passed. All three exit codes and overall exit code were 0. Wall time 928 seconds; original logs retained.
- **Earlier failed/interrupted attempts** (including a shared-box overlap) remain as evidence and are not erased. The earlier full run (2126 Python passed, 1 failed, 2 skipped; 5342 extension passed, 42 failed; 12 loop passed) is preserved as failed evidence.
- **Real Jev fixture component probe:** three contexts completed in 350–772 ms. Component probe only.
- **Native Exa+Jev historical component probe:** returned original materials in 2215 ms, status ready. Not a claim of historical verification or Keeper adoption.

### Source real-Keeper play (actual observations, bounded)

Live source RPC play used explicit Grok 4.7 low, with this root as the sole public-action player. Fast generative lanes ran on `opencode-go/claude-haiku-5-5`, thinking off.

- Library open in the morning. A selected 9.5-hour wait advanced 570 minutes to 21:00. The closing, dark windows, locked front door and clerk departure were observed and recorded as a closed/quiet scene.
- An attempted side-window entry was blocked by a physical latch. No theft and no entry occurred. No successful window entry or theft has been tested.
- A 5.5-hour wait plus a separately counted 30-minute travel reached 03:26. The news vendor had closed and left; the street was almost empty except a milk delivery. Households slept; late knocks woke irritated occupants who kept door chains engaged.
- The first awakening was narrated but not recorded. After the explicit missing-NPC projection, a subsequent real awakening wrote `observed`/`awake` at 03:27 into canonical `world.json`, and later conversation retained it.
- A capped wait of at most 3 hours at the office ended at 09:00 with 149 minutes actual wait plus 30 minutes travel, not the full 180-minute cap.
- Native historical originals were actually delivered, and the same-scene evening phase was retrieved afresh.
- Real table-matching records and confirmed provider-message delivery are saved.
- These are actual observations. They do not show a controlled causal proof that one field alone changed model behaviour.
- The investigation segment closed at 09:02 when Knott accepted the diaries and paused the rental listing; the player withdrew for the day. No whole-scenario ending or victory is claimed.
- Earlier source play did not recognise "nine and a half hours" in Chinese; "9.5 hours" worked. The overnight continuation with the LAN-built fractional lexer subsequently selected exactly 570 minutes and reached 18:46, followed by a separate 180-minute wait to 21:46. That build preceded the final large-number precision guard, which passed the local regression; exact final-build validation remains pending.
- Source play is separate from installed App packaging/GUI acceptance, which was not performed.

### Transport trace (diagnostic, separate from world state)

- Earlier observer retained only metadata although described as raw. This is corrected. Earlier incomplete evidence is not retroactively restored.
- A new, separately opt-in `PI_COC_GROK_TRANSPORT_TRACE_RAW=1` retains SSE data and comment contents, SDK event snapshots and abort/error causes. Credentials are redacted. Request bodies and actual HTTP headers are never recorded. Files are 0600 in 0700 directories. Request, backpressure, retry and timeout behaviour are unchanged. Coverage limits are recorded explicitly.
- Local tests: 18 passed (gzip 7-byte splits, immutable hooks, credential redaction, verbatim unknown-event large integers and spacing, default metadata privacy, oversize handling).
- Native source-driver trace at exact `028ad047b`: 3 real requests; all 486 SSE events and all 486 SDK raw events retained with complete observation coverage; 0600 files.
- Measured Grok 4.7 failure: after `response.output_text.delta` at 20:05:38.551 UTC there was a 60003 ms gap with 3 incoming HTTP-body chunks (39 bytes), 3 SSE comments (33 bytes), 0 SDK raw data events and 0 SSE data events. Observer delay max 1 ms. `caller_signal` cancellation, then retry. The connection stayed live while model data stopped. Client evidence does not distinguish the model service from the forwarding service; server logs are needed. A later raw failure recorded the abort cause `Provider stream timed out: no response event for 60000 ms`, with four heartbeat comments and no SDK data. This identifies the local semantic progress watchdog cancellation; the upstream silence cause still requires origin/forwarder logs. A new real driver continuation is ongoing with no outcome yet.
- Cross-validated principles: separate opt-in message-content capture (https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/gen-ai-spans.md) and exclusion of credentials/tokens from logs (https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html). OpenTelemetry integration is not added.

### Pending validation

- Full LAN `all` passed for `efcb6f181` and `028ad047b`; archived logs retain actual exit codes. Clean-current `all`/build-fetch for `a1eae4c6b` is pending.
- The source-driver investigation segment is complete. Native historical originals and selected Mod rows were delivered in the live provider requests; observed closed-scene and awake-NPC records demonstrate actual use.
- The production package and advice channel passed kernel/host regressions and actual provider delivery; installed App behaviour remains untested.
- Threshold and disable/enable behaviour passed kernel RPC and host tests; these checks do not claim an installed App toggle walkthrough.
- Source validation is complete on `5b35b00de` plus this scoped patch; implementation commits are recorded in the handoff.
- Installed App packaging and GUI acceptance: not performed.
- The investigation segment closed at 09:02: Knott received the diaries and stopped listing the house. No whole-scenario victory or final ending is claimed.

### Implementation and validation checklist

`[x]` = implemented, per previous specification and approved evidence. `[ ]` = evidence pending.

- [x] Confirm baseline: original clean 0.9.7a at `8b33f8b4e`; current mainline is latest 0.9.7a (clean-current validation pending).
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
- [x] Implement time-fit counting of actual completed/attempted portions (Stories 7, 8). Literal pre-unit halves/quarters, including Han "nine and a half hours", are fixed in `a1eae4c6b` with exact fraction arithmetic and full source-span binding; its clean-current validation is pending.
- [x] Implement Mod delivery on the `coc-temporal-advice` channel: nine independent per-row Jev judgments, rows selected only on complete valid answers, resident fallback when judge unavailable, disable removes both channels (Stories 19, 20). Actual provider delivery and scene/NPC state writes are retained in source-driver evidence.
- [x] Implement Historical Reference time-of-day objective and day-part cache with invalidation (Stories 16, 17).
- [x] Implement old-save reassessment without invented records (Story 18).
- [x] Implement opt-in raw transport trace (`PI_COC_GROK_TRANSPORT_TRACE_RAW=1`) in `028ad047b`; 18 local tests passed; native trace of 3 real requests with all 486 SSE and 486 SDK raw events retained (Story 1 diagnostics).
- [x] Add kernel RPC/capsule seam tests for the targeted cases listed in Testing Decisions (targeted run: 23 passed; earlier 34 passed).
- [x] Add Historical Reference host cache/request seam tests (25 passed on selector/history regressions).
- [x] Run full LAN `all` for the first two commits: ext 5408 passes and 0 failures; Python 2127 passes and 2 skips; loop 12 passes; overall exit 0. Final fractions-code LAN run was interrupted (exit 255) and is not a validation pass; clean-current `all` is pending.
- [x] Run the temporal-context investigation segment through the real source RPC driver; preserve all evidence. Whole-scenario victory and successful window entry/theft are not claimed.
- [x] Record native historical originals, actual provider delivery and real scene/NPC state adoption.
- [x] Distinguish source play from installed App acceptance; packaging and GUI acceptance were not performed.
- [x] Root review under the invoked to-spec skill; issue #111 records the approved architecture and source evidence. Mainline commits are `efcb6f181`, `028ad047b`, `a1eae4c6b`.

### Prior art

- Evennia Game Time: https://www.evennia.com/docs/latest/Howtos/Howto-Game-Time.html
- Inform manual, daemons and timers: https://www.inform-fiction.org/manual/html/s20.html
