# Enhanced Locations Mod implementation ledger

Status: locally complete; publication not requested. Owner approval: 2026-10-19,
including specification, tickets,
implementation and real multi-place stress testing. The owner explicitly requires
a location enhancement Mod and permits necessary kernel changes.

## Intent and acceptance

Players can visit compatible places through natural language without an exhaustive
registered-exit map. A hotel, its lobby, its rooms and the front desk remain
distinguishable; returning restores their identity and current consequences.
The versioned Enhanced Locations Mod owns this enhancement. Its independent
package and state lifecycle support later iteration and migration.

Success requires the actual Keeper to use the capability in a real game, not just
schema validation, synthetic moves or a large test count. A renamed apply effect
with all old context and registration gates intact is hollow completion.

## Scope and ownership

- Source checkout: latest mainline `0.9.8a`, baseline `ad1f607f942d616f8a2f5929270a18d3ee5293bc` (ahead of origin by 30 commits).
  Existing design/research documents belong to this task. No new worktree is needed.
- One writer integrates serially. Preserve unrelated concurrent edits. No push,
  deployment, package installation, branch deletion or evidence deletion is authorized.
- Production is TypeScript only. Never restore/run the retired Python kernel.
- New package: `mods/enhanced-locations/`, backed by a named kernel capability.
- Shared transaction, arithmetic, admission, existing Mod lifecycle and raw evidence
  remain authoritative. No second Keeper, transaction manager or generic world patch.
- No new geometry engine, forced building taxonomy, template bank or split-party UI.
- Supporting kernel, host, schema, context and test changes are approved as required
  to implement the Mod. Other gameplay domains are not being redesigned.

## Tickets

| Slice | Issue | State | Outcome |
|---|---|---|---|
| EL-00 | [#115](https://github.com/Leehow/chatrpgv4/issues/115) | specified; locally accepted | Normative contract, Mod boundary and acceptance plan |
| EL-01 | [#116](https://github.com/Leehow/chatrpgv4/issues/116) | implemented; locally validated | Versioned package, capability, stable state and graph/read projection |
| EL-02 | [#117](https://github.com/Leehow/chatrpgv4/issues/117) | implemented; RPC regression passed | Atomic Mod writes, creation, local position, passages, feature continuity |
| EL-03 | [#118](https://github.com/Leehow/chatrpgv4/issues/118) | implemented; host and live paths validated | Separate place tool, native decisions, admission and final author consumption |
| EL-04 | [#119](https://github.com/Leehow/chatrpgv4/issues/119) | implemented; projection and live demand validated | Demand-loaded Mod contract/material, history projection and request evidence |
| EL-05 | [#120](https://github.com/Leehow/chatrpgv4/issues/120) | locally complete; existing baseline failure recorded | Regression, real travel stress, restart/return continuity and final report |

The contract and per-issue acceptance govern the slices. Record actual completion,
commits and validation here at meaningful milestones; do not close on code alone
when a ticket requires live evidence.

## Required behavior matrix

1. A compatible unregistered ordinary hotel can be established and entered without
   separately discovering a construction tool or running another generation agent.
2. A known authored or previously created destination reuses its identity. Source
   coverage gaps are not mistaken for nonexistent places.
3. A hotel, lobby, room and corner/feature have explicit containment or relative
   position; containment alone grants neither passage nor zero travel time.
4. Two hotels can each contain room 203. Local and qualified references disambiguate
   them; ambiguous references produce a useful correction rather than a nearest match.
5. Approaching the desk and looking toward it have different location results.
6. Doors, windows and other stable features can be referred to again; meaningful
   changes persist. They do not automatically become carried inventory.
7. Failed atomic batches leave no dependent place/position/time changes. Real
   partial journeys commit only their actual accepted stages, with concrete causes.
8. A truly indivisible mixed-domain batch uses the same location handler and sees
   earlier staged state. Retrying does not duplicate places or charge time twice.
9. Native and standalone entrances reach the same Mod behavior; a closed issued
   destination enum cannot reintroduce the unknown-place wall.
10. Relevant Mod detail can be requested mid-turn. A quiet turn retains only a small
    entry/current position, with host-owned long guidance omitted from the request.
11. Mod disable/version migration preserves stored places and history; raw source,
    transcripts and receipts are never rewritten.
12. Author output, actual receipts, public scene details and later references agree.

## Validation and resource plan

- LAN probe: amax unavailable; leehow-pc reachable and idle. Heavy builds/ext,
  integration and loop suites use the existing remote-test runner, one heavy suite
  per box. Small meaningful tests can run locally. No dependency change is planned.
- Use the existing quick checks and focused selector while iterating, then the
  complete applicable regression suites. Preserve logs and real exit statuses.
- Live play remains on the Mac via `tests/play/driver.ts` RPC and `bin/pi-coc`.
  The root agent is the only player, one natural message per actual Keeper turn.
  No scripted player, fake Keeper, keyword router or synthetic acceptance log.
- Explicit live profile: `minimax-cn/MiniMax-M3.1-Flash-Preview`, medium, final
  author and supporting lanes included. Only observed quota exhaustion permits
  `grok-build/grok-4.5`, high; preserve that error and verify the actual switch.
- Read the test storage contract before creating data (done). Reuse a retained seed
  through `scripts/test-workspace.mjs` or driver `--seed-home`, with default 4 GiB
  seed / 512 MiB changed+raw output / 10 GiB free-space admission. Record actual
  paths and before/after capacity at test start. Fresh small synthetic fixtures use
  the existing scratch lifecycle; formal campaigns and all live evidence persist.
- Travel tests follow the actual fiction across several kinds and scales of place.
  They include return, local positioning, compatible improvisation and an actual
  obstacle when encountered. A local stress excursion is not claimed as a complete
  mystery or chapter. Counts alone are not acceptance.
- Report actual provider request declaration/history size, available cache/input
  usage and latency separately. No token/latency saving is assumed from source bytes.

## Specification checkpoint (historical)

- Goal is active. Design and two GPT-6 Pro rounds are retained in the linked research.
- Current owner clarification supersedes the draft's optional-guidance-only Mod
  boundary. Supporting kernel work is explicitly authorized.
- This checkpoint preceded publication of section 242 and issues #115–#120.

## Implementation checkpoint

- Section 242 and six issues are filed (#115–#120). The package is `enhanced-locations` 1.0.0, state version 1, requiring `locations.v1`.
- One typed place effect serves direct submit, native output and mixed apply. Canonical movement owns actual arrival and time; local position and observable features live in Mod state.
- A real RPC regression exposed the legacy scene-part fallback swallowing an explicitly new child. New registration now uses exact identity before minting; no qualified child is silently replaced by its parent.
- RPC integration: 4/4 passed on leehow-pc; log `/home/leehow/leehow/code/wt/codex-tests/.pytest-runs/chatrpgv4-wt-pi-coc-v2/run.elEDqAlk/remote-integration.log`. Earlier failing logs retained.
- Context projection keeps a stable small place entry and removes detailed location grammar from the resident apply declaration. Explicit inspection returns full canonical schemas and locked Mod sections. A request-only projection omits old host inspection detail, preserving raw history and assistant continuations. Native location schema is offered after a relevant place read in the current input, but complete canonical calls still execute without a read prerequisite.
- Concurrent unrelated rendering repairs advanced HEAD through `771fe8c62`; their changes are preserved. Heavy focused regression is running before live acceptance.

## Regression checkpoint and automatic continuation

- Specification commit: `7f412a120`.
- First LAN focused snapshot: 525 extension files, 4,634 passing / 15 failing assertions (plus skipped cases); integration 2,225 passing / 2 failing; routing loop 12/12. Log: `/home/leehow/leehow/code/wt/codex-tests/.pytest-runs/chatrpgv4-wt-pi-coc-v2/run.QcfXjXIq/remote-focused.log`. This is retained diagnostic evidence, not final acceptance.
- New interface expectations and explicit legacy instruction-budget fixture profiles are being updated; original Python/frozen results are untouched. A required `using_skill` annotation is now present in both place variants. Provider system accounting uses the actual projected location declaration.
- The existing `extension-words` unused `turn_unfinished_notice` finding is outside location scope and will be checked against baseline rather than silently altered.
- Current local structural slice: 20/20. Latest LAN targeted batch: 48/49 before the annotation fix; latest code awaits repeat.
- The shared LAN slot was temporarily busy. The queued pressure/profile run completed; its results are recorded below. No busy override was used.
- At this checkpoint a bounded local RPC file supplied fast feedback and live play had not started.

## Live acceptance started

- Implementation commit: `f05190299`; working tree was clean at the start. Latest bounded local RPC: 6/6 passed (`.coc/test-runs/enhanced-locations-20261019/location-rpc-local-2.log`, canonical runner evidence `.coc/test-runs/integration-ts-VPRj5z/`). Structural checks 20/20, annotation schema 1/1, kernel TypeScript check passed.
- LAN pressure regression now passes both normal and expanded-name cases. The two historical instruction profiles pass with Enhanced Locations explicitly disabled in their private fixture; original assertions/frozen files were not changed. Latest annotation test passes after distinguishing root object constraints from root union variants.
- Runtime build fetched from leehow-pc (64 MiB LAN transfer); no App packaging.
- First live attempt `enhanced-locations-live-20261019` stopped with actual `Provider is not configured: minimax-cn`, before KP inference. This is environment evidence, not a quota exhaustion or movement failure. The raw run remains.
- Existing App credential is read by a transport-only wrapper and passed as `MINIMAX_CN_API_KEY` to the isolated driver process. No credential is printed, copied into source configuration or committed.
- Initial credential-bridged run: `enhanced-locations-live-20261019-auth` (stopped), campaign `locations-stress-20261019`, private workspace `.coc/test-workspaces/enhanced-locations-01a154d0`. Startup and completed requests confirm MiniMax M3.1/medium. Its opening delivered the commission offer; the subsequent action stopped because the source Jev credential was unavailable. A transport-only bridge now reads both existing App credentials without writing secret copies.

## Latest live repair checkpoint

- The same campaign is retained across all restarts. There are no synthetic player turns or manually written campaign facts. Failed raw runs remain under `.coc/playtests/enhanced-locations-live-20261019*`.
- `configured` exposed literal missing-parent arguments and the native move-plus-time prohibition. Field-specific parent correction and explicit post-arrival time now use the existing atomic transaction.
- `repair1` exposed an uncertain location consent score (selection .42, restriction .12). Enhanced location consent now explains its actual entry/position scope and distinguishes Keeper additions from a player construction action. It retains the original thresholds and independent restrictions; no automatic authorization was added.
- `repair2` turn 1 genuinely established and entered an ordinary hotel, delivered the clerk interaction, charged 30 travel minutes plus 2 activity minutes, and no lodging payment. Its first invalid parent was corrected within the actual turn. Turn 2 exposed an overly strict parser rule for a harmless standalone `beyond_travel` marker. The parser now agrees with its declared schema and canonical apply semantics.
- Protocol regression: 62/62; location RPC regression: 7/7; current location/consent seam tests: 22/22; typed family tests: 14/14; kernel TypeScript check passed. Logs are in `.coc/test-runs/enhanced-locations-20261019/`. Tests and real play remain separate evidence.
- Full runs `run.uloxHF70` and the following all-run were deliberately stopped with exit 143 for live repairs; neither is final passing evidence. Their raw artifacts were retained by the canonical runner. Do not count them as a completed regression.
- `repair3` delivered the request to view a room, then exposed nested item envelopes with exact boolean strings. The existing schema-owned transport decoder now handles those exact booleans and records repairs; array/boolean transport regressions pass. The delivered schema and Mod also distinguish registration-only establishment from an actual move with additions.
- Current live run: `enhanced-locations-live-20261019-repair4`, same campaign/workspace, explicit MiniMax M3.1/medium. Runtime fetched from `run.YnTsax3r`. Continue one natural player input at a time, validate room/local-feature/revisit/restart behavior, then run the final full LAN regression after the live path stabilizes.
- Fast gate is again 130/130. The bounded Jev call is now classified in SL-00. The two historical fixture files passed all 28 cases on LAN (`run.v7PRZmAV`); their native counterpart fingerprints and revalidation record are updated without changing original/frozen assertion inventories. The complete migration checker reports 1,792/1,792 validated cases.

## Current continuation checkpoint

- Repair commits: `bb4adcaed` and immutable package patch `11c2fd87d`. The current package is 1.0.1 (state schema 1). The retained live campaign was upgraded through ordinary `mods.configure`; operator evidence is `live-mod-upgrade.json`. No campaign facts were hand-edited.
- Later live attempts exposed missing disclosure consumers: direct place calls did not fire `before_apply:place`, and first spatial decisions still saw the deferred native grammar. Direct/native triggers and result invalidation now share the existing context path. A bounded input-scoped Jev relevance question enables full place declarations and locked Mod guidance before the first spatial inference. Negative inputs keep the entry; later invocations can disclose missed detail. The question is advisory context, never action authority.
- Real relevance evidence: turn 12 answered .79 in 319 ms, 470 input / 20 output tokens. This is one observed cost, not a latency-saving claim.
- `repair8` exposed double qualification of a child name and an unhelpful occupancy declaration. Qualified additions now canonicalize once. Crowd descriptions state the existing presence rule and the unknown option. The RPC file now passes 8/8, including qualified child identity and local lookup (`integration-ts-7Wbng0`).
- **`repair9` is invalid-for-acceptance**: the author narrated room entry after an empty packet, but the actual saved party stayed in the hotel lobby. Its raw transcript and world evidence are retained unchanged. Do not claim that room entry succeeded.
- A positively selected spatial input now receives a short native completion review when its packet proposes no spatial execution. An empty/glance-only replacement for the chosen visit is corrected before any world effects or author. Real obstacles and already settled steps remain valid outcomes. Provider-facing place object unions expose their properties under an explicit object root while retaining canonical branch validation.
- Latest deterministic evidence: native direct-route correction and empty-packet prevention 2/2 (`location-coverage-component.log`); location/relevance/transport units 10/10; fast gate 130/130; kernel TypeScript check passed. These are component checks, not real travel acceptance.
- **Active run: `enhanced-locations-live-20261019-repair10`**, same campaign and private workspace, explicit MiniMax M3.1/medium. Runtime build is `run.QEWldbKd` (LAN). Current source changes after `11c2fd87d` are task-owned and not yet committed. Continue the actual chosen room entry and verify prose against receipts and saved position, then local features, return, another compatible place and restart continuity. The final full LAN regression has not yet run on this stabilized source.
- The only genuinely completed new-place trip so far is entry to the ordinary hotel (`repair2` t1). Later waiting prose and the false room arrival are not successful travel evidence. Keep the goal active until the requested real exploration works.

## Verified room arrival and local-position diagnosis

- `repair10` turn 1 genuinely entered `市中心廉价旅馆 / 三楼尽头单人房`: a canonical move receipt, the new room record and the delivered room description agree. The room identity is `scene-location-f1dccd37-1a17-495f-8a12-635cc461942e`; its containing hotel retains `scene-location-76342581-19da-4d81-ad71-c405198629fc`. No lodging payment was settled.
- `repair10` turn 2 is **invalid-for-acceptance** for local position/window state: prose walked and opened the window, but only time settled. Position remained the room without a feature, and no window-state change occurred. Raw evidence is retained.
- `repair11` turn 1 ended with the actual `Expected a private composition brief or reference answer` failure; turn 2 charged observation time without moving. Neither is a successful local approach.
- `repair12` turn 1 correctly refused both time-only/NPC-substitution packets before effects and prose, but the Keeper did not repair the player's selected approach. The completion batch now preserves six atomic movement/feature probabilities and composes them in code. Context selection now directly asks movement, feature change and spatial-reference propositions, replacing the ambiguous question about whether the full contract would help.
- Closed-Jev diagnostics are separate component evidence: reconstructed time-only window approach returns movement selected .92 / accounted .09; direct declaration selection returns .89. These are not live-play successes. Unit/discovery checks 15/15 and native empty-packet prevention 1/1 pass; fast gate remains 130/130 and the TypeScript kernel check passes after correcting reference typing.
- Current live continuation: `enhanced-locations-live-20261019-repair12`, same retained campaign, explicit MiniMax M3.1/medium. The full LAN regression remains outstanding until the source and actual travel path stabilize.

- `d892bd0a5` commits demand disclosure, atomic decision review and local correction. `repair13` turn 1 genuinely moved to `铁架床` (relation `beside`) after one same-turn correction; a separate read-only native RPC inspection confirms that saved position. The pure author no longer invents the requested window action. Final LAN `all` is running against this source while real travel continues.

- `repair13` genuinely established/entered `市中心街角咖啡馆` (turn 4) and committed its `窗边座位` position (turn 5). No order or payment was selected or settled. Turn 6 stayed seated, made a genuine Listen check and charged its canonical time; location relevance correctly returned all three negative answers, and no completion batch ran. The context hook recorded system_bytes 137143 for spatial inputs versus 126926 for that quiet input, a 10217-byte difference in this observed host projection, not a token/latency savings claim.
- Window/front-desk attempts then exposed a missing consent consumer: enhanced proposals lacked the canonical destination names/description already supplied for legacy movement. The new scoped public location/selected-feature projection reaches the same independent admission check and participates in its cache identity. It never supplies permission. A read-only diagnostic with the actual window description admits the selected approach (.81 selection/.15 restriction) and refuses the explicit look-only control (.33/.59); component evidence only. Units 26/26 and the native producer/consumer regression 1/1 pass.

- `repair13` turn 7 did not enter the bookstore: nested item-array envelopes plus a blank `within` prevented useful parameter correction. Native transport now preserves independent exact syntax repairs, exposing the actual invalid parent; all semantic values and canonical validation remain unchanged. Structural/transport/consent units passed 34/34 before the latest continuation-schema check.
- The first complete LAN snapshot at `d892bd0a5` is retained while regression corrections are prepared. A location applicability failure now discloses material without claiming a selected spatial action. Cancellation guards run before creating its review lease. Test event-bus doubles now implement the emitted event, and historical whole-instruction/writing profiles explicitly disable the independent demand-only Mod. Existing safety assertions remain in force. Live campaign plus raw run storage is approximately 44 MiB, below the approved 512 MiB changed/raw bound; no evidence was removed.

## Full regression repair checkpoint

- Complete snapshot `run.OZv0bkDX` at `d892bd0a5`: extension 6233 total / 6193 pass / 31 fail (remaining cases skipped), integration 2237/2237, routing 12/12; overall exit 1, 1183 seconds. The raw complete run is retained.
- Fixes are committed as `f327a712f` and `4756e31cd`: canonical location/selected-feature identity reaches consent; native transport retains exact independent repairs; only answered spatial selection enables the completion review; retired context requests cannot create newer-input work; host-settled arrivals can still refine a local feature position; mixed apply place effects activate disclosure.
- Revalidation: cancellation before hydration and after preselection 2/2; exact native correction/arrival/empty-packet prevention 3/3; historical instruction/writing profiles 4/4; location/discovery units 17/17; location/consent units 27/27; fast gate 130/130; kernel TypeScript check passes. Event fixture changes supply the missing EventEmitter method without removing original disclosure/name assertions. The existing unused `turn_unfinished_notice` caption remains outside scope.
- A second complete LAN run is next, after fetching the stable runtime. Live restart will use the same campaign and explicit MiniMax M3.1/medium; previous failed arrivals remain failures.

## Second full regression and movement accounting

- Complete snapshot `run.bQ24V6XP` at `4756e31cd`: extension 6243 total / 6232 pass / 2 fail / 9 skipped, integration 2237/2237 and routing 12/12; overall exit 1, 1160 seconds. Remaining failures were the six-result expanded-handle pressure fixture and the pre-existing unused caption.
- The pressure fixture's original `expectedBatch` was empty because the run projection emits custom supplements while Pi carries native calls/results independently. Its old fit precondition was therefore vacuous. Capture the actual issued assistant calls and six original operation results instead. Reserve 16 KiB of the old capsule padding for additional mandatory grammar/disclosure, retaining all six 26,000-character results, 500 expanded handles, content equality, native pairing and the unchanged 393,216-byte total request ceiling. The expanded case must actually reclaim its obsolete capsule duplicate. This is a fixture correction, not a production budget increase or an allocation bypass.
- Real `repair14` entered the bookshop, committed its innermost aisle position, looked toward its window without moving, returned to the cafe, established an outdoor alley, returned to the original inn/front desk and room, approached the room windows and opened the back window a narrow crack. Read-only native RPC confirms the saved position and window state. Original records and descriptions are reused; no payment/order was invented.
- `repair14` turn 10 then exposed an overconstraint in completion review: semantic accounting (.58 then .49) vetoed an actual legacy room-to-lobby move before ordinary admission. Coverage version 4 now reuses the input's independent selection probabilities and accounts for typed operation classes in code. Mandatory consent remains the sole target/scope authority. Only a selected missing dimension asks its obstacle question; a real operation needs no duplicate completion inference. Empty/time-only replacement still fails its missing dimension.
- The context discovery clone also retains the selected `context` families instead of dropping that third set. No destination is selected or authorized by discovery.
- Version 4 unit checks 27/27, native correction components 2/2, fast gate 130/130 and the kernel TypeScript check pass. Runtime fetched from LAN `run.aTSNpLcn`, including the recorded working-tree overlay. Active real run is `enhanced-locations-live-20261019-repair15` on the same campaign; final full regression and restart/state continuity remain required.

## Final live acceptance

- Production repair `5d6a1a308` is committed. `repair15` genuinely returned from the room to the existing front desk; actual completion metadata records `jev_calls:0`, preserving ordinary admission and successful registered-reference correction.
- Before/after a stopped/restarted driver, the room definition, window state and front-desk position compare exactly equal. The retained `restart` run later committed a window-side position and described the original narrow crack, then closed the back window while preserving its broken latch. Read-only RPC confirms the actual state; neither uncommitted proposals nor failed deliveries count as arrivals.
- A fresh campaign, `locations-cold-20261019`, in the same private workspace used canonical pregen creation. It visited the authored Corbitt exterior, established/entered an unregistered pharmacy, approached its counter, returned to the authored place, used standalone `place inspect` and revisited the same pharmacy. Complete definitions/features compare equal; a final separate local move committed the counter position. The real run was stopped normally after turn 10.
- Keep failures visible: a composite restart command failed on feature/NPC parameters without committing; the next arrival committed but its author received an actual MiniMax HTTP 504. Another restart turn and fresh observation failed the native publication protocol. Fresh commission transfer corrected an invalid owner but encountered held-act publication after settlement. None is counted as successful location delivery, and none was repaired by changing campaign facts or widening into unrelated subsystems.
- Actual Keeper, author and NPC assistant metadata all report MiniMax M3.1/medium (`live-all-profile-audit.json`); no quota exhaustion or model substitution occurred. The shared private workspace plus all raw live runs is approximately 67 MiB, below the admitted 512 MiB bound, with no evidence deletion.
- Final LAN `all` completed against `5d6a1a308`; the complete native-output file is 55/55, including both pressure cases. Full results follow below. The compact acceptance report is `docs/acceptance/enhanced-locations-20261019.md`.

## Final regression and handoff

- Complete final LAN `run.sq9sNUff` at `5d6a1a308`: extension 6243 total / 6233 pass / 1 fail / 9 skipped; native integration 2237/2237; routing 12/12; overall exit 1, 1162 seconds. The only failure is the unchanged, pre-existing unused caption guard. No new regression remains.
- Native metadata confirms exit 0 and JUnit has zero failure/error nodes. Its 2236 leaf cases plus one parent suite match Node's 2237 pass summary. Both files and the source SHA-256 manifest are retained locally under `.coc/test-runs/enhanced-locations-20261019/final3-*`; critical implementation hashes match this checkout. The remote full-run archive preserves logs, source head, empty source diff, exit files and fixtures.
- The final main/cold driver processes stopped normally, with no remaining owned campaign process. Final main state preserves the closed back window/broken latch and the original room; the cold campaign ends at the original pharmacy counter. All raw failed and successful evidence remains.
- Acceptance report: [Enhanced Locations Mod acceptance](../../acceptance/enhanced-locations-20261019.md). Implementation and required acceptance are locally complete. Issues #115–#120 remain open pending publication; no push or App installation was requested/performed. Known provider/native publication limitations remain in the report rather than being counted as passing turns.
