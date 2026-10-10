# Turn Capability and Mod Discovery — Execution Plan (20261010)

Status: approved implementation of #112, solo. Experimental wiring is committed; semantic, full-suite and live release gates remain open.

## Approval

- Approved spec: `docs/specs/turn-capability-and-mod-discovery.md`, tracking issue #112.
- Approval: the current user explicitly authorized implementing #112, working solo.
- Scope of this plan is limited to the work recorded here.

## Objective

Replace the all-tools and whole-instruction default with turn-scoped capability and schema discovery, integrated into the existing hybrid RunDriver, context assembly, Jev decision port, Mod catalogue and section read, and canonical dispatcher, per the approved spec.

## Baseline

- Initial HEAD: `4ccc69e45`, on latest 0.9.7a.
- The spec's baseline reference is ca51d7dfc; migration impact is reported against it separately.

## Initial foreign dirty files (settled by their owner)

These belonged to the pytest optimization thread and were committed by its owner in d5d41ab68. They were not absorbed by this work:

- `README.md`
- `docs/kernel-rpc.md`
- `kernel-ts/json.ts`
- `scripts/select-tests.mjs`
- `tests/extension/ts-kernel-foundation.test.mjs`
- untracked `tests/extension/test-selection.test.mjs`

## Acceptance

- [x] Contract amendment applied after the shared contract owner committed (section209, da53fd555).
- [ ] Pure schema and capability view parity verified at the public `context_with_system` seam.
- [ ] Versioned Mod index and detail selection implemented.
- [ ] Expansion, readiness and telemetry implemented.
- [ ] Final combined full LAN gate passes. Baseline e63bccb98 passed exit0; subsequent recovery/snapshot changes need their own gate and native-search integration.
- [ ] Held-out semantic matching meets pre-registered gates.
- [ ] True GUI or canonical driver acceptance passes.
- [ ] SQLite compatibility regression requirements (spec section) pass.

## Scope

- Capability split of the apply definition into semantic fragments, including npc and object subvariants, with unchanged validation.
- Versioned capability and Mod catalogues with index cards and immutable detail references.
- Two-stage selection (batched Jev relevance, then per-candidate detail questions) with deterministic host prerequisites.
- Lookup kind for read-only capability discovery and expansion.
- Readiness gate holding all effects before mutation when required material is missing.
- Index-first loading for new Mod versions only, with explicit bounded fallback.
- Public request projection and active tool declarations, without vendor patches.
- Telemetry separating request bytes from provider tokens.
- SQLite compatibility per the approved spec: source metadata through ModuleStore/sourceMetadata; no stale JSON fallback; snapshot binding; no DB transaction held across model work.

## Non-goals

- No change to the seven-verb canonical surface or to canonical apply atomicity.
- No relaxation of field shapes or constraints; selector never authorizes actions.
- No re-enabling or silent upgrade of existing legacy or locked Mod versions; legacy-full remains.
- No Python restoration.
- No Historical Reference timeout fix, no provider or model default change, no RunDriver replacement.
- No package, restart, push, delete or publish.
- No new chats, subagents or model switches.
- No Internet downloads.
- No copying or adoption of the SQLite migration branch's work; it is consumed through its published interface when integrated.

## Infrastructure

- SQLite worktree is separately owned; its owner integrated it through039b9ffaa. No duplicate migration is owned here.
- LAN probe selected `amax` for source tests and builds. Keep one heavy task per box.
- Live models and the GUI stay on the Mac.
- Preserve all evidence, campaign data and logs.

## Ordering

1. Contract amendment after shared file is clean.
2. Pure schema and capability view parity at the public seam.
3. Versioned Mod index/detail selection.
4. Expansion, readiness and telemetry.
5. Focused and full LAN gates.
6. Held-out semantic matching and true GUI/driver acceptance.

## 2026-10-10 initial implementation checkpoint

- Owned pure capability catalogue and schema projection are drafted in extensions/table/capability-catalogue.ts. They are not wired into production. Canonical validators remain unchanged.
- Four focused local Node 24 tests pass: mixed temporal schema constraints, whole-batch missing-view detection, new-field ownership refusal, and public system projection preserving original evidence. The first run exposed a stale test-only TypeBox import; corrected to the existing typebox/value package, with no dependency change.
- A read-only experiment on retained genuine GUI session declarations measured apply 58,139 bytes to 11,647 bytes for a temporal subset; no semantic or live speed claim.
- SQLite compatibility clauses were added to the spec. A proposed contract 209 is retained in the implementation report directory; canonical docs/kernel-rpc.md is still owned by the active test optimization task. Do not stage its foreign edits.
- Next: land the contract when shared file is clean, then catalogue decision runtime and actual request/dispatcher hooks. All end-to-end and release gates remain unchecked.

- Initial component commit: f6da29d60. A further two-stage discovery component is drafted with five local Node 24 tests passing: multiple candidates plus prerequisites, lazy detail reads, no-match, stale input/version and incomplete answer handling. It is not connected to production.
- Eight version-2 Mod section indexes are being authored as external drafts with the required tool-enabled Haiku 5.5/off writer; production Mod bytes and locks are unchanged.
- Quiet five-minute thread heartbeat mod is active under the repository concurrent-operation rule. It waits for the shared contract owner to settle and resumes this same task; no other thread is messaged or created.

- Shared contract owner settled in d5d41ab68; its changes are committed and preserved. Contract section 209 is now appended for this task before production integration. Pure catalogue/discovery tests total 9 passing. SQLite migration remains separately owned.

## Contract and integration draft checkpoint

- Other owner committed d5d41ab68; canonical contract section 209 is integrated in the working tree. All currently dirty implementation paths belong to #112.
- Capability runtime, read-only lookup bridge, actual context_with_system projection and version-2 Mod discovery are drafted and compile as extension bundles. Current COC_TURN_DISCOVERY default is full; selective/shadow are controlled validation modes. No production selective default claim.
- Version-2 parsing/installation has 3 local checks passing, preserving v1 behaviour. Catalogue tests 4, discovery tests 6 including the real HTTP decision adapter with a fake transport, instruction discovery tests 3, capability runtime tests 3. These are component proofs, not real gameplay.
- Eight author drafts preserve every source heading and original instruction text. Actual new parser accepts all; estimated resident body sum is 6,159 bytes vs earlier 28,942 bytes. They remain external drafts, not released packages or accepted semantic quality.
- Amax is reachable but busy at load 64.77; leehow-pc unavailable. No heavy suite was added. Await idle before focused build/test and fetching runtime.
- Next: request-capture and first-use integration regression, validate cumulative selection budget and failure paths, freeze/prepare new package versions, LAN focused gates, held-out Jev matching, then true GUI/driver proof and measured rollout. SQLite migration is still a separate dependency.

- Latest local component/request-hook run: 20 passed (six files); no real Keeper acceptance claimed. Amax became idle at load 2.41 and focused build/ext/pytest/loop is running under RT_BASE=d5d41ab68, exec session 2448. Preserve its actual exit and remote logs before updating claims.
- External candidate packages are frozen in the implementation report packages directory, versions recorded in candidate-packages.json. Every original instruction SHA256 is unchanged; only candidate metadata/manifests are new. They are not installed into user campaigns or shipped yet.
- Retained temporal evidence has 46 unique natural player inputs; held-out minimum is 60 with broad families. Need additional genuine retained inputs or explicitly labelled component cases, independent labels and a disjoint tuning split; do not call byte savings semantic acceptance.

- Evaluation split is pre-registered in report evaluation/preregistration.json: 81 held-out inputs and 149 tuning inputs from 53 genuine historical campaigns, separated by campaign. Held set covers the-haunting, book-4 and book-5. Candidate thresholds are experimental, not released/calibrated. Original source datasets are hashed and preserved.

- Focused LAN result: ext 3533 pass, 1 fail in turn.test.mjs; pytest 2128 pass/2 skip, loop 12 pass. Exit1, wall552s. Log /home/lihao/chatrpgv4-testbox/wt/codex-tests/chatrpgv4-wt-pi-coc-v2/remote-focused.log. Do not call this green.
- Initial held-out component comparison: 81/81 Jev selections complete; independent full-text labels give 74/146 needed sections selected (recall0.507), 288 extra selections, p50 644ms/p95 1049ms. Release recall0.95 is NOT met. Preserve predictions/labels; audit annotation support and missing host state, then tune only on the disjoint tuning cases and use a fresh held-out validation for changed criteria.

- Ownership mistake: build-fetch exec70982 completed and replaced main build before the active-source-process result was handled. Existing source launcher/kernel PIDs12398/12439 were still present. Do not stop them, replace their runtime again, or silently roll back. Future live validation uses an owned independent runtime snapshot; this replacement is not proof that the old session runs new code. Build-fetch exit0, remote build2s, fetched59M. Preserve this exact limitation.

- Focused failure diagnosed: capability view telemetry ran before any binding and emitted undefined turn. Suppressed unbound telemetry in capabilityRuntime.project. Original turn.test.mjs assertions were preserved; targeted LAN rerun passes all29. Full focused/all after this fix is still pending.
- SQLite/source owner integrated through039b9ffaa (12 new commits) while preserving #112 working changes. Record the new combined baseline for subsequent gates. The old “not yet merged” statement in the spec needs a factual update.
- Owned runtime-snapshot directory now holds copied build/content/mods/prompts with hashes. No symlinks exist in the copied build. Use this for live acceptance, not the shared main build or a second App.

## Resume checkpoint after first evaluation

- Production selective default remains OFF (COC_TURN_DISCOVERY defaults full). Request projection, capability lookup bridge, version-2 section parser, instruction controller and first-use holds are wired for controlled validation. No complete release or live acceptance claim.
- Retained first component run on81 held cases has recall0.507 against independent labels. It omitted host gate facts and independent examples, so it is not the complete production selection pipeline. Never overwrite or retroactively relabel this run.
- Found a real producer-reader gap: authors emitted applicability.examples, but discovery state omitted them. Added examples to both stages and a regression assertion. Added discoverySituation to carry slim canonical clues/threats/equipment/reentry/task facts. More work: pass already-available compile/host-plan facts and validate deterministic first-use requirements.
- Next evaluation must tune only on disjoint tuning inputs and use a newly reserved untouched validation subset for changed criteria. Check annotation evidence/uncertainty without changing labels to match predictions. Existing archives have real replay gate rows, but do not feed post-turn receipt kinds or Keeper output into prediction.
- Remaining: cumulative/shared-budget conformance, full request byte/token accounting after schema projection, controlled candidate installs, focused/all rerun on current039b baseline, SQLite scope regression, actual GUI/driver and cold/warm/end-to-end performance.
- Do not overwrite shared build: old source PIDs12398/12439 remain. Owned runtime-snapshot has current copied resources but predates the newest discoverySituation/examples changes; future runtime builds should be fetched to an owned independent directory, not main build.

## 2026-10-10 continuation checkpoint (07:10 UTC)

- Shared accounting: both discovery controllers now use the existing preparationBudget port and foreground parent reservations. Selective/shadow initialization occurs before storage hydration, so that elapsed time consumes the same deadline. This does not itself interrupt the source owner's synchronous SQLite busy wait; the SQL lock bound remains an unproven release gate.
- Host compile and current operation handoff added to section209.6. It binds campaign/worldline/loop/turn and task-source revision, carries slim current compile/task facts, seeds structural apply fragments and existing before-apply section triggers, and never creates execution authority. Unbound/no-Jev runs publish no handoff. Engine and normal-context point checks pass, including rejection of a stale source handoff.
- Corrected visibility/readiness: a dependency actually included in the current schema is ready; repeated calls before expansion projection stay blocked and widen to an explicit full view. Repeated missing package delivery records unavailable instead of pretending the detail was loaded. Relevant clues, task facts, schema versions and mode changes invalidate the selection cache. Source publication clears old selector state immediately.
- Added request_projection telemetry separating schema/prose/Mod JSON bytes and canonical versus projected schema size; provider_projection records adapter JSON bytes/digest only, explicitly before later hooks and never as wire bytes or provider tokens. No credentials or payload text is recorded.
- Current small component suite:24 discovery/schema/index checks plus5 language guards pass;2 engine projection checks pass. Later two added handoff scope checks pass in the context file. Run the combined current suite again for the final count; no full-suite claim.
- Focused LAN snapshot run65602 (uploaded before the later source-binding and fixture fixes) finished exit1,wall556s:ext3530 pass/14 fail,py2128 pass/2 skip,loop12 pass. Most failures were the new producer dereferencing absent run.scope in no-Jev paths; it is now guarded by a coherent scope and source revision. One fixture incorrectly used wakefulness at the NPC top level instead of activity; fixed without relaxing canonical shape. Source tests after upload changed, so this run is not evidence for current HEAD. Preserve remote-focused.log and pf/logs before the next run.
- Reused81-case diagnostic v2 is preserved separately.57 selective cases:63/115 prior needed labels selected,recall0.548;16 full fallbacks and8 incoherent/missing gate snapshots are excluded from selective success. It is a diagnostic, not untouched validation. Default remains full.
- A fresh campaign-isolated split is reserved before tuning:61 validation inputs from8 campaigns,88 tuning inputs. Files evaluation/preregistration-v2.json, validation-v2-inputs.json and tuning-v2-inputs.json. Do not inspect or tune validation predictions before criteria are frozen.
- Annotation audit attempt1 hit the existing1M input-token budget at112.8s and left100/146 draft pair judgments. Attempt2, restricted to41 natural-NPC cases, returned a two-case partial at60.9s after oversized write attempts. Exact names/source phrases and coverage are not valid. Both are incomplete and invalid-for-acceptance; do not use them to revise gold or report improved recall. Preserve raw events and outcome files. Next approach must use bounded small batches with deterministic completeness/source-evidence gates, not repeat whole-corpus drafts or silently switch Haiku5.5.
- Next: preserve this focused run's logs, rerun current full LAN gate without replacing the Mac build, fetch fresh artifacts only into an owned independent runtime directory, then finish bounded semantic calibration/untouched validation, SQLite regression and genuine GUI/driver plus cold/warm performance. No candidate package or selective default is released.
- Prior-art cross-check: gRPC deadline propagation subtracts elapsed work (https://grpc.io/docs/guides/deadlines/); AWS shared retry quota constrains repeated attempts (https://docs.aws.amazon.com/sdkref/latest/guide/feature-retry-behavior.html). They support inherited deadlines and bounded repeated work; provider reservation accounting remains this project's existing implementation, not a copied retry policy.

## 2026-10-10 full gate and runtime checkpoint (07:25 UTC)

- Implementation fix commit e63bccb98 is clean and available for serial integration. Complete amax all at that exact commit passed exit0,wall606s:ext5475 pass/1 skip (5476 tests),py2128 pass/2 skip,loop12 pass. Raw logs copied to report lan-all-e63bccb98 before any future test overwrites the remote scratch. Earlier focused failures remain in lan-focused-0710. No tests or oracle expectations were weakened.
- Current normal-context handoff tests cover four paths: selected first-use hold, foreground-budget refusal before provider dispatch, deterministic current host operation/section seeding, and stale source-handoff rejection. Combined small check count after the last added handoff cases is31 plus2 targeted engine checks; the all gate is the stronger proof.
- Fresh remote build copied over the LAN into report runtime-e63bccb98, with exact kernel/host/hybrid/table hashes and all-gate provenance in snapshot-receipt.json. Resources and provider manifests copied; Mac native dependencies use an explicitly recorded read-only node_modules link. This is an owned source-mode validation snapshot, not a standalone package or live acceptance. Old runtime-snapshot and the shared Mac build were preserved. Original source processes12398/12439 remain untouched.
- Bounded eight-case tool-enabled Haiku5.5 batches produced complete narrow audit data for41 unique inputs (two natural-NPC sections, exact names and source phrases mechanically checked). Five batches completed normally;batch2 hit its6-request limit after writing8 structurally complete cases (transport error retained), and was not rerun/overwritten. Remaining batches used10 requests and completed. Combined diagnostic has36 disagreements with prior needed labels. It does not replace gold, tune the validation set, or establish recall; original81 labels/predictions and invalid partial audit outputs remain intact.
- Search coordination: native-search owner supplied branch0ffe474c5 and asked for committed shared seams. Read-only comparison is in native-search-compatibility.json. Lookup capability survives there, provider-hosted search lives outside the canonical Pi tool view, and non-system native_search_scope notes survive our system projection. Native policy/scope integration has not been tested jointly with e63 here. Search ownership takes precedence; do not restore old Exa/library/lookup/query-author/prefetch machinery.
- Historical Reference candidate1.3.0 from the old instruction body collides with the native-search source1.3.0 and is marked obsolete. Never install/publish it. After the search owner integrates, regenerate discovery metadata from the new original instructions with a new version (at least1.4.0), using the required tool-enabled writer. Other frozen candidate evidence stays unchanged. GUI/driver acceptance must use the authoritative combined native-search runtime, not claim the old e63 history path is final.
- Remaining release gates: comprehensive independently supported semantic labels/calibration on88 tuning cases; freeze criteria and evaluate untouched61 validation cases; SQLite error/scope/lock tests; provider-delivery and lookup recovery paths under selective mode; normal candidate installs and real GUI/driver acceptance; cold/warm provider cache/first/final latency. Default remains full, no candidate published, no App packaged or restarted.

## 2026-10-10 lookup and SQL conformance slice (07:55 UTC)

- Purpose lookup now caches identical in-flight, successful and failed decisions by bound epoch. A query outage widens only its current request to full_fallback and holds writes until that full schema is projected. Stale query results cannot widen a successor; a late initial selection cannot override an epoch already widened. Three new meaningful regression cases pass in capability-runtime.test.mjs; named unknown-name validation stays unchanged.
- Selective/shadow context now refreshes after successful writes even when prescreen/workspace/expression are off. The normal handoff fixture verifies the new clock in the append-only capsule-update, preserving the original capsule prefix.
- Hydration and the final read-only table.capsule identity check spend the existing preparation/foreground deadline. Final comparison binds campaign/worldline/loop/turn, task-source and task-world revisions; queue bookkeeping remains outside task-source. Stale or failed checks discard current ephemeral schema/guide packets and retain bounded conversation evidence with a diagnostic, without changing the canonical transcript. Late reads cannot refill an invalidated cache or clear a newer generation.
- New discovery-sqlite-binding.test.mjs exercises actual SourceState/sourceMetadata/sourceRevision SQL with host hooks: queue/other-scope stability, same-scope publication after Jev begins without a bus notification, corrupt imported SQL with valid JSON still present, pending hydration deadline and a real exclusive SQL lock in an owned reader child. All5 pass locally. The blocked reader remains alive when the host's300ms allowance returns; releasing the test lock lets it exit, and its late result does not populate cache. A peer write and successful truncating checkpoint during the decision call show that the SQL snapshot is not pinned across model work. These are deterministic seam tests, not live gameplay or a blanket source-store latency claim.
- Scope remains #112. No new RPC or source authority was introduced; the existing table.capsule read is reused. No source schema, database busy_timeout, SQLite owner worktree, package, App process, shared build or model default was changed. Extra identity-read bytes/time are telemetered as host work, not provider tokens, and still need live cold/warm measurement.
- External checks support the design: SQLite WAL snapshot isolation permits concurrent readers/writers but an open snapshot remains old until its transaction ends (https://www.sqlite.org/isolation.html, https://www.sqlite.org/wal.html); propagated deadlines subtract elapsed work (https://grpc.io/docs/guides/deadlines/). No long SQL transaction is used to freeze an external model call.
- Next: commit the tested slice, run the affected LAN focused gate after an idle probe, preserve raw logs, then continue semantic calibration and authoritative native-search integration/GUI/performance. Baseline all evidence stays valid for e63 only; newest code is not called fully green until validated. The untouched61 validation cases remain untouched.

## 2026-10-10 focused and tuning-label checkpoint (08:20 UTC)

- Recovery/SQL slice committed988ea7f64. Amax focused at that commit finished exit1,wall526s:ext2727 pass/1 fail,py2128 pass/2 skip,loop12 pass. The sole failure is retired historical-reference-request.test.mjs's expected second Exa call (actual1), under the concurrent run. Its unchanged isolated case passed1/1 at the same remote snapshot in21.4s. Preserve both results; do not call the original focused aggregate green or restore the retired search path. Logs copied to report lan-focused-988ea7f64.
- Follow-up closes a readiness hole: an unavailable source check now holds apply/resolve until a verified current request arrives. Withdrawing stale capsule/schema data no longer erases the required-material guard. The5 SQL cases also assert this no-commit hold; all pass. This follow-up was made after the focused upload and needs its own validation on the final combined runtime.
- Independent tuning labels now use4-case tool-enabled Haiku5.5 batches and4 bounded original-source shards. Scope is88 tuning inputs and27 non-Historical-Reference sections; the61 validation cases are not opened. Historical sections are excluded until the native-search source is authoritative. These are component labels, not gameplay or a complete benchmark.
- At batch18, a source quote omitted an original newline. The strict literal gate rejected it. The original failed result and validation remain. A separate result-aligned.json restores only whitespace to a unique original source span; citation-alignment.json records offset/from/to, and a structural comparison proves labels and other evidence unchanged. The unchanged literal gate then passes. No semantic relabeling, threshold tuning or prediction-based correction occurred.
- Author progress:17 batches/68 inputs passed directly;batch18's4 inputs have the separate exact-span alignment proof;remaining batches19-22 resumed in exec76716. Preserve any failure, inspect actual output and transport outcome, and merge only fully gated cases. Earlier exec33320 ended at the first citation fault and is closed; do not wait or relaunch it.
- Next: commit the readiness follow-up without claiming complete acceptance, finish and freeze valid tuning labels, run current production selectors against them, improve only from tuning evidence, regenerate native historical metadata after integration, then evaluate untouched61 and real GUI/driver/cache/latency. Final combined all remains unchecked.

## 2026-10-10 frozen tuning replay checkpoint (08:32 UTC)

- Readiness follow-up committedc49c4b3da; main checkout clean. The latest9 local SQL/context checks pass. Baseline full gate remains tied to e63; focused988 failed1 retired Exa timing expectation and its unchanged isolated rerun passed. No later full/GUI acceptance claim.
- All88 tuning inputs now have structurally gated independent labels for27 non-historical original sections, frozen in evaluation/tuning-labels-v3/tuning-gold.json with receipt/hashdf0f79d9037dfdbc17edbee520dff68a6aad9de36bd9ecfbd3a9675e9a6476a2. There are235 needed and167 uncertain annotations. Twenty-one batches passed directly;batch18 preserves the separate one-quote whitespace alignment proof without any label change. Every author outcome succeeded. No prior predictions or labels were supplied to these writers; no held validation input was read.
- The current production Mod controller's tuning component replay is complete in tuning-predictions-v3.jsonl. It uses actual recorded gate snapshots, compile features, examples and the real closed topic catalogue (the earlier diagnostic incorrectly supplied no topics).85 selected outcomes,0 full fallbacks,3 missing coherent gate snapshots. Against the frozen labels:103/232 needed selected,recall0.444,285 extra selections,p50 648ms,p95 977ms. This fails the0.95 requirement and is not a held-out/gameplay/release result. Preserve this run; do not overwrite it, count unavailable rows as success or change thresholds against the61 validation cases.
- Largest misses: carried-equipment registration39, stalled-turn guidance16, threat clocks12, favour guidance10, language guidance10 and object management9. Some may expose annotation eligibility problems (a boolean unregistered-equipment flag does not identify an unparameterized weapon or show an item being used; stall false is not evidence that the stall rule is due), while other misses may be genuine selector/context omissions. Exact quotes prove textual traceability, not semantic correctness. Audit conditions from complete original sources and pre-inference inputs, blind to predictions/index summaries, before treating these labels as reliable calibration authority. Do not silently relabel to improve measured recall. A small ordinaryGrok4.7/low quality audit is within the preserved model pair if Haiku eligibility reasoning remains inadequate; fast lanes remainHaiku5.5/off and no model defaults change.
- Next ready work: review current-snapshot availability and provider-retention recovery on the combined native runtime; validate c49 guard with the appropriate LAN scope after integration; independently resolve conditional-label support on tuning data; then adjust only authorized discovery criteria/context/mandatory seeds, freeze and finally evaluate the untouched61. Native historical candidate remainsobsolete until regenerated from the authoritative native source. Root is still the sole natural player for eventual GUI/driver acceptance.

## 2026-10-10 native integration checkpoint (08:49 UTC)

- Read the source owner's actual task state: the human paused its Historical Reference heartbeat, so it will not automatically integrate. Its original instruction authorized coordinating/solving these seams with native search authoritative. Main was clean, the owner idle and no Git operation active; root serially merged0ffe474c5 into latest0.9.7a without changing the owner's worktree or automation. Merge f1816033 is committed. No conflict occurred; native policy/scope, capability lookup, section209 and all current discovery handoff/SQL guards are preserved. No retired Exa/library/query-author/prefetch path was restored.
- Combined local native/schema/context/SQL/language run passes35 checks. A further normal-context assertion verifies that the non-system native_search_scope note survives schema projection unchanged. Small encounter-context correction now carries actual met_turns/last_turn/last_spoke_turn fields instead of falsely inferring never-met from never-spoke; its regression passes. These changes need the final combined LAN gate; no new shared build has been written.
- OrdinaryGrok4.7/low blind27-section/four-case quality audit timed out at300s after three requests; no result file. Raw outcome/events retained in evaluation/quality-audit-grok-01. It is invalid-for-acceptance; do not claim that another model validated the labels. A two-section/four-case Haiku conditional audit is running separately (exec89482), with original complete text and current facts only, no labels/predictions/index summaries.
- Historical candidate1.4.0 authored by tool-enabledHaiku5.5/off from the newly integrated native original body. Real parseSections accepts all4 headings, manifest/version contract and unchanged agent.md SHA. Native search and setting/reference invariants conservatively remain resident; Prices and A disputed price gain situational applicability. Kept external in report native-historical-candidate-1.4.0/package, not installed or shipped. The original obsolete1.3 discovery candidate remains untouched.
- Amax was busy with the separately owned pdf-read-repair all suite; no task was stacked. It later became idle. Next: commit only this task's encounter/projection proof changes, probe again and run the combined full gate, fetch emitted artifacts only into a fresh owned source-mode snapshot, inspect the conditional audit and continue semantic calibration followed by untouched61 and actual GUI/driver/cache/latency. Source-owner pause is not a reason to leave the native integration waiting forever.

## 2026-10-10 combined gate in flight (08:55 UTC)

- Encounter facts/native-scope proof committede0913acb8 on merged native baselinef1816033; checkout clean. Latest local component/native run26/26 passes. Full LAN all started after an idle amax probe, exec41300, remote /home/lihao/chatrpgv4-testbox/wt/codex-tests/chatrpgv4-wt-pi-coc-v2. Do not duplicate it, overwrite Mac build or infer success before its actual exit. Preserve remote-all.log and pf/logs after completion, then fetch to a new owned runtime directory for genuine acceptance.
- Native Historical candidate1.4.0 writer finished normally31.8s. Actual parser validation and original-body SHA proof are in report native-historical-candidate-1.4.0/validation.json. It remains external/uninstalled/unreleased; old obsolete candidate retained.
- The narrowed independent conditional audit (Haiku5.5/off, two original rules and four actual inputs) completed14.4s. It finds both carried-equipment registration and stalled-turn rules not_required in these particular cases, with explicit source conditions/current evidence. There are2 disagreements with prior needed labels; this is diagnostic only. Two quoted spans collapsed original newlines; separate result-aligned.json and citation-alignment.json restore only unique literal source whitespace and prove all statuses/conditions/input evidence unchanged. Original outputs and receipt remain. No old labels or predictions were supplied, no recall was recomputed and no validation input was opened.
- Do not keep repeating a full27-section labeling task after its inadequacy. Next annotation work should narrowly review actual source-condition support, separate annotation defects from omitted current facts and true selector misses, and preserve an audit trail. Exact textual citations alone are insufficient. Avoid threshold tuning on unreliable labels or any peeking at the61 held cases. The first85-case tuning selection run remains failed at0.444 and default remains full.
- The prior ordinaryGrok audit is definitively closed withcode143/timedOut300s,3 actions/1 unknown call,no result.json; no need to poll it. The conditional audit and native author are also closed. Full LAN exec41300 is the only pending operation from this checkpoint.
