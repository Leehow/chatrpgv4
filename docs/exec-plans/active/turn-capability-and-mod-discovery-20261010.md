# Turn Capability and Mod Discovery — Execution Plan (20261010)

Status: approved for implementation of #112, solo. No acceptance gate is checked.

## Approval

- Approved spec: `docs/specs/turn-capability-and-mod-discovery.md`, tracking issue #112.
- Approval: the current user explicitly authorized implementing #112, working solo.
- Scope of this plan is limited to the work recorded here.

## Objective

Replace the all-tools and whole-instruction default with turn-scoped capability and schema discovery, integrated into the existing hybrid RunDriver, context assembly, Jev decision port, Mod catalogue and section read, and canonical dispatcher, per the approved spec.

## Baseline

- Initial HEAD: `4ccc69e45`, on latest 0.9.7a.
- The spec's baseline reference is ca51d7dfc; migration impact is reported against it separately.

## Foreign dirty files (not owned by this plan)

These belong to the active pytest optimization thread. They must not be staged, committed, adopted or reverted by this work:

- `README.md`
- `docs/kernel-rpc.md`
- `kernel-ts/json.ts`
- `scripts/select-tests.mjs`
- `tests/extension/ts-kernel-foundation.test.mjs`
- untracked `tests/extension/test-selection.test.mjs`

## Acceptance (all unchecked)

- [ ] Contract amendment applied after the shared contract file is clean.
- [ ] Pure schema and capability view parity verified at the public `context_with_system` seam.
- [ ] Versioned Mod index and detail selection implemented.
- [ ] Expansion, readiness and telemetry implemented.
- [ ] Focused and full LAN gates pass.
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

- SQLite worktree is separately owned and not integrated.
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
