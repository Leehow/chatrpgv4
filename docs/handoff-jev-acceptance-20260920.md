# Jev acceptance handoff after build and integration closeout

Status: **writer-budget repair, final runtime build and integration closeout completed.** The two acceptance workstreams below are handed off; no further implementation or play is running in this task.

The user's latest scope is explicit: finish the terminal writer-budget repair, final runtime build and integration regressions here; leave the two remaining acceptance workstreams below to another AI. Do not restart architecture design or repeat completed work merely because this is a new session.

Read this document first. [The earlier detailed handoff](handoff-jev-unified-refactor-20260920.md) retains architecture, code maps, source/credential handling and older evidence. Its original unresolved-budget/build paragraphs are historical and superseded by this closeout. Normative interfaces remain in `docs/kernel-rpc.md` §122 and the unified spec/tickets.

## Completed closeout boundary

- Checkout: `/Users/haoli/leehow/code/chatrpgv4-wt-pi-coc-v2`, branch `0.9.4a`. The implementation base was `d9ad5fecda705a375b5078e15e4b3eecf3339e7f`; the subsequent user-authorized commit containing this handoff records the refactor. Preserve any additional dirty/untracked files and all retained evidence.
- Terminal `narrate`/`ask` no longer require a second future-writer reservation after the real writer has already been funded. Actual review and corrective provider work still debit the original task budget/deadline. Cancellation refunds only unused escrow. Eleven writer lifecycle regressions pass.
- The final source-preparation authority uses the real `session:<id>` scope owner. A never-claimed matching prefetch entry may receive its first operation binding atomically under the queue lock; zero attempts and no prior authority, owner, lease or work directory are required. Another operation or a running/historical job remains unavailable for adoption. Eight source owner tests pass, including a competing first-bind race and unchanged-call retry.
- Source publication replay bindings now survive the actual `TaskStore` validator and serialization, including cancellation after an advance. Foreign-root/scope/duplicate publication records still refuse. A child budget persistence loop has an explicit parent-ID type.
- Source completion, graph pointer and exact advance publish in one authoritative metadata write. Four injected fault boundaries prove cold request/finish replay, including an interrupted queue update and rejection after a foreign publication. The independent closeout review records bounded GO.
- Deferred provider notices stop at a closed/replaced table, including closure while awaiting UI wording, and cannot throw an unhandled stale-context error after disposal. Existing outage, memory-read and host lifecycle regressions pass (27 cases).
- Optional presenter budget is omitted when absent, retaining the prior caller shape.
- The compact pacing floor stays within the existing 2 KiB style budget without dropping a first-turn directive. Its semantics remain selected-goal completion, real unselected decisions and no invented progress obligation. Twenty-four capsule tests pass; the budget was not raised.
- Existing tests were updated only for actual new contracts: `recall.query`, canonical snapshot fields, charged admission, finite child retry settings, explicit post-freeze TS methods/authority, and dependency resolution for isolated bundles. Frozen Python oracle files were not changed. Invalid out-of-catalog memory judgments still fail before publication.

The queue correction follows the distinction between unclaimed and already leased work seen in [PostgreSQL locking for queue consumers](https://www.postgresql.org/docs/14/sql-select.html) and [SQS receive/visibility ownership](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/APIReference/API_ReceiveMessage.html). Those precedents support atomic initial claim and respect for an existing claim; this filesystem implementation still relies on its own mutex, exact source revision and publication proof, not another service's delivery guarantees.

## Verification and frozen build

Machine record: `.tmp/team-lead/jev-closeout-verification.json`. It records the source roots/digest and all 40 required emitted runtime entry hashes.

- Source digest over 659 implementation/resource files: `6bf71dfa40333a10fe2fa7643603042a3765239791e74a0b83e7ef635779030d`.
- `npm run build:runtime`: passed; this is the source runtime build, not a packaged or restarted App.
- `npm run check:kernel`: passed.
- Strict runtime/dispatcher TypeScript check: passed.
- Focused Jev and adjacent integration run: 581 passed.
- Final source/store/writer/recovery run: 33 passed, including all four publication fault boundaries.
- Full extension suite: **2209 passed**, 0 failed, using `npm run test:ext -- --test-concurrency=2`.
- Kernel/play suite: **1608 current cases passed across retained segments**: 831 prefix cases, 771 suffix cases and 6 corrected-case reruns. `.tmp/team-lead/jev-closeout-kernel-coverage.json` verifies their union against the final full collection: no missing or extra case. This was not one uninterrupted green invocation. The failed expectations were updated for conversation authority, fulfillment views and the already approved retirement of recovery debt; frozen oracle data was unchanged.

Raw logs are `.tmp/team-lead/jev-closeout-*.log`. Counts overlap; do not add them together as unique coverage. Early adverse regression runs are retained. The first broad kernel run was intentionally interrupted after 540 passes/5 capsule failures to fix the actual style-budget regression. The restarted prefix then passed 831 cases with one legacy promise-shape assertion, corrected in the continued suffix. Six remaining old expectations were corrected and all six passed on the final emitted kernel. The emitted kernel body exactly matches the isolated kernel used by the continuation (source-map comment excluded). High host load caused timeouts in an earlier parallel extension attempt; all 62 affected checks passed serially, followed by the clean full 2209-case run. Final source and all 40 entry hashes were rechecked unchanged. No paid model experiment or true-table turn was run during this closeout.

Do not edit/rebuild `build/` while a driver/reader consumes it. If source changes after the fingerprint above, update the relevant checks and record the new build before comparing acceptance runs.

## Workstream A — real promise and reward continuity

Goal: a real earlier NPC promise, including a reward absent from the authored module, is found when the player later fulfills its condition; the correct canonical effect lands once and all memory readers agree.

Existing proof to reuse:

- `.coc/playtests/jev-memory-live-03-20260920/memory-evidence.json`: exact attributed promise extraction.
- `.coc/playtests/jev-memory-live-04-20260920/memory-reader-evidence.json`: existing capsule reader consumes it without payment.
- `.coc/playtests/jev-memory-read-live-04-20260920/memory-read-evidence.json`: v5 retrieves distinct earlier needs and canonical originals, with explicit partial coverage.
- T12 deterministic fulfillment tests cover complete immutable terms, conditions, exact decimal partial payment, replay, independent promises, gift ownership and shared readers. These are contract evidence, not a played reward chain.

Execution:

1. Use the project genuine-play method: `tests/play/driver.py` starts current `bin/pi-coc` in RPC mode; configured `xai/grok-4.6` is Keeper, the main controlling AI is the sole player. One natural input, read the actual response, choose the next input. Follow repository `AGENTS.md` and `docs/acceptance.md`.
2. Continue a retained campaign or create a separate new one through the real setup owner. Establish a real finite promise in ordinary play, preserving original speaker, beneficiary, condition and reward. The existing Knott promise is a **per-day rate**; do not relabel it as a fixed total for a passing case.
3. Let meaningful intervening play occur, satisfy actual conditions through ordinary receipts, and return to claim the promised reward. Do not inject a promise/payment/condition into saved state or script both sides of a conversation.
4. Inspect the genuine source lookup, semantic judgments, prepared complete term binding, canonical `apply` receipt and read-set advancement. Verify the correct reward, no unrelated transfer, no double payment on repeat/recovery, and consistent obligations/history/recall/continuity views.
5. Preserve unknown/rate/formula/missing-identity cases as explicit unsupported or unresolved outcomes. Diagnose any gap at its producer-reader-actor seam; no scenario-specific content patch to fake acceptance.

Completion: T13 has an actual retained end-to-end chain, and T12 effect/reader acceptance is supported by the same receipts. An extracted memory, successful classifier response or synthetic kernel fixture alone does not complete this workstream.

## Workstream B — family quality, player experience and performance

Goal: prove the new copy/reference and Jev-assisted workflows preserve semantic quality and improve the intended player experience under real conditions; measure whole-workflow time and cost.

Selected families awaiting actual semantic/live gates:

- `audit.continuity.v2`, new `narration-audit` 1.2.30: exact selector materialization is implemented; verify a newly activated package actually reviews real delivered candidates with unchanged semantic safeguards. A retained v1-locked campaign remains v1.
- NPC journal v2, setup user-input references, guidance and character/map/UI/document keep-or-translate selectors: verify the active owner uses the protocol and player-facing text/identity is right. Duplicate source occurrences, Unicode/CRLF, placeholders and source omissions must stay faithful. Generated prose remains generated.
- Opt-in `PI_COC_JEV_VERIFIER=1`: paired judgment quality against the incumbent six-kind post-delivery verifier. Incomplete/unavailable results permit only the specified one-budgeted-fallback route. It remains advisory; no new world action or delivery veto.
- T15 lifecycle: same-input replan, exact incumbent handoff, owned source preparation, cancel/restart/lost settlement, separate background owners, nested provider usage and truthful partial delivery. Existing deterministic tests prove interfaces; actual whole-root telemetry remains to be measured.
- #99 pacing: `keeper-pacing` 1.3.0 and `narration-craft` 1.3.0; `npc-voice` stays 1.2.0. Actual full/brief/on-off assembly and the 4,984/5,000-byte brief bound already passed. Follow the existing paired A/B specification in `docs/specs/keeper-pacing-decision-boundaries.md`; it requires actual before/after behavior and at least two paired new campaigns with counterbalanced order, not merely toggling one Mod in the new code.

Measurements must separate Jev latency from planning, admission, source readers, Mods, writer, retries and transport. Record exact source/build, active Mod locks, model/thinking, flags, source readiness/cache state, meaningful comparable opportunities, failures and omissions. Do not use the original atomic-question benchmark, warm-cache wins or more receipts as proof of a faster/better table. Preserve adverse samples and do not average away unauthorized actions.

Completion: the selected family gates and product T15 evidence pass within explicit stated scope. Only then retire incumbent routes or broaden flags. No global speed or completed-product claim is justified by this build-only closeout.

## Runtime and evidence starting points

- Normal home campaign `jev-s2-20260920`: latest retained turn21 has canonical Knott office location. `.coc/playtests/jev-apply-live-04-20260920/apply-evidence.json` records turn20 recovery without duplicate clues, then turn21 departure prose without a move receipt. That adverse case still needs a real post-fix continuation; do not claim the movement happened.
- Fresh PDF campaign `jev-fresh-02-20260920` uses alternate home `.coc/playtests/jev-fresh-home-02-20260920`. Preserve the home override. Fresh setup/navigation and distant clinic page32 lookup already have bounded functional evidence.
- The task-owned driver `jev-apply-live-04-20260920` is stopped. Old `pacing-road-a2`/`pacing-road-b2` daemons belong to separate worktrees; ownership was not established and they were left untouched. Check process ownership before operating them.
- If a continuation guard asks for `session.resume`, do it first. Installed legacy coc-keeper MCP may return `unsupported_save_schema`; current TS `bin/pi-coc` owns these saves. Never resurrect the retired Python product or rewrite saves to satisfy that legacy plugin.
- `.tmp/team-lead/start-jev-s2.mjs <run> <campaign> [setup]` is transport-only and privately loads the already-authorized TypeSafe credential from the original task message. Use environment `TYPESAFE_API_KEY` if that private source is unavailable; no credential belongs in a handoff, repository or log.
- Record `PI_COC_TASK_RUNTIME`, `PI_COC_JEV_SOURCE`, `PI_COC_JEV_MEMORY`, `PI_COC_JEV_MEMORY_READ`, `PI_COC_JEV_RESOLVE`, `PI_COC_JEV_APPLY` and optional verifier flag explicitly. These flags do not stand in for activation/retirement acceptance.

## Preservation and finish conditions

Current product kernel is `kernel-ts/`. Keep campaign/module/playtest/task records and raw/accepted evidence. No reset, clean, stash, evidence deletion, old-Python resurrection, bulk staging, package install or App restart is authorized by this handoff. After the build closeout, the user explicitly authorized the local refactor commit on `0.9.4a`; this does not authorize pushing or release. Raw `.coc` evidence and `.tmp` verification logs remain local, preserved outside the source commit.

The user permits task-appropriate models and reserves Astra for lead/core work. Parallel work must have exclusive paths; only the main controlling AI plays the table. A future bug repair should be the smallest system-path correction supported by actual evidence, with corresponding regression and a new frozen build where needed.

Update local ticket statuses only after the appropriate observed gate. T01–T11 retain their previously accepted bounded claims. T12/T13/T14/T15 remain product/semantic acceptance work; build and regression completion does not close them all.
