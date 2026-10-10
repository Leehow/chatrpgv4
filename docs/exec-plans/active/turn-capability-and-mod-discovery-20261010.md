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
- [x] Current full LAN gate passes, including focused coverage (e63bccb98, exit0; earlier failing snapshots retained).
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
