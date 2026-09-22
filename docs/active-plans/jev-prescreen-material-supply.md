# Jev prescreen material supply implementation

Status: In progress. The user resumed implementation and explicitly authorized wiring/refactoring the four observed latency gaps on 2026-09-22. Specification #108 plus contract section 126 define that extension. No live-performance or packaged-product completion is claimed.

## Objective and acceptance

Implement [the material supply specification](../specs/jev-prescreen-material-supply.md): actual module/PDF/rule/memory/history/person/object/session material reaches the real Keeper request before avoidable exploration. Preserve exact sources, current state, attribution, unknowns and game authority. Validate all G1–G8 goals, final-request budgeting, freshness and cancellation. Real acceptance uses the canonical RPC driver, Grok Keeper and the main session as sole player; Haunting, short PDF and long PDF remain separate gates.

The user invoked the implement skill. Apply TDD at the already confirmed seams, focused typechecks/tests during work, full suites at the end, code review, then a scoped commit on the current branch. Do not push, package, install or restart the App without that release-stage authorization. A source implementation and a commit do not establish shipped-App acceptance.

## Current checkout and preservation

- Branch: `0.9.4a`, current latest alpha branch; starting HEAD `fb5c4c3243ceea0cdd26f127783f3ae19aecc82e`.
- Existing uncommitted preselection and credential integration are present alongside unrelated active NPC/onboarding changes. Never revert, stash, stage-all or absorb unrelated changes.
- Initial snapshots of 16 potentially affected files and their existing diff: `.tmp/team-lead/jev-prescreen-baseline-K1QKFU/`.
- Active NPC work owns `kernel-ts/read/assemble.ts`, NPC modules and its additions to shared handlers/registry. Keep those off worker scope; coordinate an additive integration only if required.
- Existing Jev credential lane is idle. Reuse its credential reader. Separate any required setting additions from its previously uncommitted implementation when assembling the commit.
- No task-created worktree or branch exists. Current TypeScript kernel only; never restore historical Python or alter frozen oracle evidence.
- Repository-local Markdown is the implementation tracker. The existing remote #108 is a spec mirror; this work does not create more remote tickets.

## Ownership and current work

All existing worker lanes remain Codex / pinned `gpt-5.6-sol` / oneshot / no children / no commits, respecting the user's non-Astra constraint. Root owns docs/contracts, review, integration decisions and serial validation. Code paths have one writer at a time.

| Slice | Owner | Status | Scope / next evidence |
| --- | --- | --- | --- |
| Contract and preservation | root | Contract frozen | Additive host-only boundaries recorded in kernel contract §124 |
| Kernel material supply | jev_ab_desire | Component implementation reviewed/verified, integration pending | Root reproduced green RPC/config/foundation bundle (36/36); pagination-independent history, real family clauses, corruption refusal and legacy record compatibility repaired |
| Original source supply | jev_ab_masks | Component reviewed/verified | Immutable answer seed, candidate budget separation and current extraction checkpoint checks implemented; root verified source/domain/isolation 15/15 before final extraction case |
| Host selection and final request | jev_ab_haunting | Component reviewed; full/live gates pending | Root and independent findings repaired; 66 focused tests reported; root strict ES2023 host typecheck passed after typed guards and cached rich-content regression |
| Product feature activation | jev_ab_desire | Implemented; request/App integration pending | Public config/status/manifest and React boolean persistence tests green; source module added to current vocabulary guard |
| Integrated request acceptance | root | Pending | Real current TypeScript reads through actual context hooks to outgoing request; G1–G8 and failure cases |
| True play and A/B | root | Pending | Freeze runtime/source/settings; observe actual use, new/repeated reads and complete player wait |
| Code review / full suites / scoped commit | root + reviewer | Pending | Preserve unrelated dirty work, verify exact candidate commit and report any open acceptance gate |

## Decisions

- Reuse the existing preselection custom message and existing kernel read seam. Do not introduce another generic MaterialAccess controller or MaterialRef authority.
- Pass actual projected baseline messages and available bytes to preselection. Only final outgoing messages establish delivered material; prepared workspace is not supplied evidence.
- Extend the existing workspace host-only request with a versioned catalog/read/check view. Host catalog keys are navigation only; shared SourceRef remains the provenance contract.
- Source candidate preparation is an adapter over the existing host source runtime and ReadingService, independent of the broader planner/task-runtime product toggle.
- New material content must be useful for selection, with explicit partial coverage. No tests that supply only mocked names as proof of full material supply.
- A/B primary comparison is off versus full supply. Lightweight comparison is optional diagnostic. Source/preparation/cache divergence ends direct same-state attribution unless equivalence is proved.
- Relevant external implementation checks were performed during spec authoring (Anthropic contextual retrieval and Azure retrieval activity/budget reporting); neither their infrastructure nor claimed speed is adopted.
- New current repository acceptance guidance selects `grok-build/grok-4.7-build-fast` with low thinking by default. Preserve that concurrent change; future A/B must freeze and report the same actual model on both arms rather than silently mixing the earlier 4.6 results.
- §124.2 now freezes compatible checked-answer artifact copy at the initial campaign source fork, with existing locks, integrity and atomic publication. It never copies queued/running jobs or publication authority.

## Verification record

- Pre-implementation audit reproduced a final-budget omission: prepared workspace excluded its scene from preselection, then workspace was dropped while the smaller prescreen survived, leaving the scene absent.
- Memory/NPC journal freshness is a confirmed structural gap, not a confirmed wrong live delivery.
- Contract §124 froze before implementation dispatch; all three workers acknowledged exact ownership and the non-Astra model.
- Initial implementation stage: baseline typecheck started; no new model calls or live play have run yet.
- Root verification: `node --test` over feature config, kernel materials, catalog, workspace and TS foundation passed 36/36 (about 27 seconds), after the kernel review corrections.
- Root review distinguished successful-attempt Jev cost reporting (already present) from missing conservative failed/retried reservation carryover; the latter remains part of the host revision.
- Independent integration review is running in `jev_ab_desire` after its activation implementation. Host changes are not accepted until revised memory consumption, content-aware dedup, memo freshness, actual supplementation and selective reuse are verified.
- Independent re-review resolved all four remaining findings; no blocker in that reviewed set. Fresh/reuse now share source extraction checkpoint checks and protect richer material from same-locator thin context.
- Unified source build passed. Root full extension run: 2287/2288 passed; sole failure was an old provider-discovery test not awaiting the concurrently introduced async Grok provider factory. One-line await keeps the original assertions; its full file passed 22/22. Final full extension rerun is active.
- Current base advanced independently to `fe8e92b456671df130e3dd657e70a822af884d75` (NPC integration). It preserved this task's uncommitted changes. Compare selective integration against the current base and the initial snapshot; do not rewrite that commit.
- A/B operational preflight: only a freshly assembled complete runtime closure is immutable; the repo launcher overrides resource-root env. Use the assembled launcher and separate whole-home clones after normal setup. Current short PDF is source-ready; the known Masks opening/guidance and App-home Mod-byte conflicts still block its normal setup path. No live run has started yet.

## Integrated validation and live evidence (2026-09-22)

- The parallel Pi owner committed `60558af7d` (Pi 0.87.0). That owner's temporary commit composition removed shared dirty context/contract content; all affected writers paused until the original dirty content was restored at 09:09:43 UTC. Root verified the restoration rather than resetting another owner's work. This task's frozen runtime evidence remained unchanged.
- The original credential owner supplied a read-only ownership handoff, confirmed it had stopped writing, and identified all consumer hunks. Root integrated the required credential/activation foundation separately as **`85faec8b4`**. Its exact staged tree `98f5519fe1de57473de4654d76280848f358bb70` was exported to an ordinary source directory (not a Git worktree), built and tested independently: 55 Node tests and 8 backend/UI tests passed. No Grok provider refresh, packaging, admission, driver or material-supply files entered this commit. The material-supply implementation remains uncommitted pending the live repairs.

- Root full extension rerun passed **2288/2288**, exit 0. Kernel/play full run passed 1607 with one outdated source-answer cache expectation; the focused policy correction preserves independent attempt/lease/isolation checks, and root reran its full file: **7/7**, exit 0. The 41-minute full command was not rerun after this test-only correction; do not describe it as a single all-green invocation.
- Strict host TypeScript checking, kernel checking and the runtime build passed. Following the concurrent Pi SDK upgrade to 0.87.0, the actual context/source/prescreen bundle was rerun: **33/33**, exit 0, and runtime rebuilt.
- Full Electron validation reported nine failures: eight stale staging-directory assertions after concurrent package-hygiene changes and one static Pi source-emitter count after the SDK upgrade. Jev settings tests passed 6/6. No baseline entries were added or unrelated implementation changed to suppress these failures; full Electron/release acceptance remains open.
- Two complete immutable runtime closures are retained. The first used Pi 0.85.1 and only prepared common seeds; it is not used for timed A/B. The second uses Pi 0.87.0, has 15,168 file hashes and 13 symlinks verified, and is sealed read-only. Its assembly digest is `9706160e569d8effdae67eff012a8decb53e4e3af59542fa227c1dd2a23f012b`; proof: `.tmp/jev-prescreen-acceptance-20260922/frozen-runtime-v2.json`.
- Normal setup completed the 41-page Desire investigator and campaign in a dedicated home (four turns, 605.6 seconds). Its stopped whole home was cloned into two independent arms; all 507 file entries initially match, aggregate digest `6f28acdbf546846892aeba869dbca23d9ec08d7e8f80088c2e42007014b385b1`. Arm A enables preselection, arm B disables it; both use the same Keeper model, thinking, resource closure and consuming-process Jev credential. TaskRuntime and S0 remain off. Common setup used Pi 0.85.1; both timed play arms use 0.87.0. Initial proof: `.tmp/jev-prescreen-acceptance-20260922/desire-ab-initial.json`.
- Cold Blood Road (111 pages) setup was attempted through the ordinary product flow. Two skeleton drafts failed independent visual review for source attribution; no ready state or campaign was manufactured. Both natural turns and all source evidence remain; the owned setup daemon was stopped. This cold-source gate is blocked. A supported warm route exists through the already installed shared book and normal source/card selection, but has not been run and would be matched configuration rather than byte-identical history.
- The external COC plugin's required `session.resume` was attempted first after compaction and returned `unsupported_save_schema`; this is the older plugin, not the current TypeScript runtime. Do not use its legacy tools or rewrite the save. Real continuation remains on the current frozen `bin/pi-coc` through the canonical RPC driver.
- Initial short-PDF ON/OFF live inputs were retained, but are invalid as a controlled latency pair because automatic openings overlapped and stories diverged. ON used 141.6 seconds and six Jev calls but emitted no material after its deadline expired; OFF used 57.5 seconds. §124.3 now requires one first-opportunity optional deadline and partial completion with reserved final owner checks. Host repair is in progress; no speedup is claimed.
- Root also found a source-authority gap: raw native text was always unsupported and never passed the existing native-consultation qualification. §124.2 now requires shared source-owned eligibility/evidence/coverage policy and the same proof materializer as canonical `source.excerpts`; no broader TaskRuntime toggle or bypass is authorized. Source and host owners are integrating that path and preserving the original visual/preparation gates.
- Both live-defect repairs are now implemented, reviewed and frozen. Root independently passed source/domain/final-request 14/14, real material-family requests 6/6 and combined strict host/source TypeScript. The final full extension invocation passed **2324/2324**, exit 0 (231.8 seconds). The native qualification preserves explicit unknown/unassessed parts, semantic page excerpts, question-bound authority and exact source revalidation; partial semantic timeout now retains completed materials only after all outer-deadline owner checks.
- Frozen runtime v3 is sealed after verifying 15,168 file hashes and 13 symlinks, with Pi 0.87.0 and assembly digest `3a8923636f3a7e59696feeea12a75dbd461d32e3c8eff64746472d62939d99b1`. All workers stopped code writes before assembly. Fresh Desire C/D homes each match 507 entries (`6f28acdb…`), and Haunting A/B each match 82 entries (`0e1316dc…`). Proofs: `frozen-runtime-v3.json` and `v3-ab-initial.json` under the acceptance evidence directory. Haunting B is the first sequential v3 arm, enabled; no second live arm starts until its comparison phase ends.
- Haunting normal setup completed (three turns, 81.8 seconds), and its dedicated seed daemon is stopped. A warm Blood Road campaign also reached readiness through normal installed-source selection and character creation (four setup turns, 96.0 seconds). Its new investigator was not saved to the library by setup. The public `/coc investigator save` command refused RPC mode; that attempt did not run a gameplay turn and its owned daemon was stopped. No matched second warm campaign or state equivalence is claimed, and no manual library/save edit will be used to manufacture one.

## Remaining gates

Implementation and bounded request/component validation have landed in the worktree, with independent review findings repaired. Real semantic use, all G1–G8 runtime cases, per-group live-performance improvement, selective commit and packaged-App acceptance remain open. Update this ledger before handoff; a test count, delivered packet or completed setup does not establish performance or full product completion.

## Resumed latency repair (user-authorized 2026-09-22)

The user wants preselection and preparation to remove real waits and redundant Keeper work. Success means necessary material and check choices reach actual requests and reduce avoidable serial stages; unrelated item enrichment does not hold the player turn. A hollow delivery would report component accuracy, injected bytes or a new plan without reducing the repeated real waits.

The frozen v3 Haunting comparison is complete but not successful: OFF 59.952 / 123.803 / 74.740 seconds, ON 65.811 / 148.291 / 65.715 seconds. Totals are 258.495 and 279.817 seconds. All owned daemons are stopped. The ON second turn had six Keeper requests (43.351 seconds total), one apply (56.346 seconds, including 44.884 seconds creator work and 10.033 seconds admission), a refused resolve (11.456 seconds), 23.607 seconds implicit delivery/audit, and 3.616 seconds prescreen. The later 10.116-second verifier started after delivery and is not part of the 148.291-second foreground wait. The continuity audit failed artifact validation after targeted repair and delivered unreviewed; this is not a quality pass.

Confirmed material gaps: initial graph scan 46 nodes but only 23 emitted in the first mixed page; host always requests cursor 0/limit 48; selected 14 but delivered 3 under the fixed 16 KiB packet; seven initial decision groups plus one coverage call exhaust eight actions; recent read hints are still gated on the old workspace mode. Counts alone are not semantic recall. The complete original Jev selection trace was not retained, so do not pretend every dropped candidate has an individually reconstructed decision.

New bounded lanes retain Codex / implementer / pinned gpt-5.6-sol / oneshot / no children / no commits:

- `jev_ab_masks`: item identity versus background enrichment. First give the smallest exact representation/owner change; root freezes it before code.
- `jev_ab_desire`: reuse ordinary-resolve policy for read-only advisory check preparation. No actual resolve, no standalone planner and no edits to the shared context owner until coordinated integration.
- `jev_ab_haunting`: material candidate continuation, current-read reuse and packing/coverage repair. The shared context-runtime/workspace/preparation-budget files are temporarily owned by #109; wait for an explicit hash-bound handoff before editing those paths.
- Root: contracts, ownership, primary-source design comparison, independent review, serial integrated validation and actual player turns. The existing provider/request and true-play acceptance seam remains user-confirmed; component tests diagnose faults only.

#109 owner (thread `01a0c672-dfbc-7f51-bea4-89aeba362af0`) acknowledged the shared-file collision and will hand over context-runtime.ts, workspace.ts and preparation-budget.ts after its current slice. Its NPC prepare/finalize/automaticWaitMs bridge, limited perspectives and existing parent budget must be preserved. No reset, stash, speculative merge, source restore, broad commit, App package or restart is authorized.

Existing external precedent checked during this investigation: TypeSafe's typed independent questions support bounded route/profile selection; Anthropic's routing/parallelization guidance supports moving independent preparation off serial paths. Neither guarantees speedup here. The repaired real path and controlled evidence decide acceptance.
