# Jev material supply implementation acceptance — 2026-09-22

Status: in progress. Source implementation and request-boundary regressions exist; semantic use and performance are not yet accepted. This report retains failures and distinguishes actual material delivery from preparation or candidate selection.

## Implementation and test evidence

The work implements specification `docs/specs/jev-prescreen-material-supply.md` and kernel contract §124. The shared TypeScript owners now expose actual graph/rule/record/current-state material, checked source answers, native PDF text and existing memory evidence. The host computes the real retained baseline before selection, materializes selected bodies, checks current dependencies and observes the converted provider payload. Native text remains partial source evidence, never visual approval or playable preparation.

- Full extension suite: 2,288 passed, exit 0.
- Kernel/play full invocation: 1,607 passed, one failure from an old accepted-answer cache expectation. The corrected full source-answer file subsequently passed 7/7. These are two invocations, not a claimed clean full rerun.
- Kernel and strict host TypeScript checks passed. Runtime build passed. After the concurrent Pi 0.87.0 upgrade, the context/prescreen/source focused bundle passed 33/33.
- Electron full gate has nine failures outside this feature: eight old staging-directory assertions and one static Pi emitter-count assertion. Jev settings tests passed 6/6. The baseline was not changed to conceal those failures.
- Independent review found and repaired stale record revisions, rule-index-only reads, memory owner misuse, partial-context dedup, cached semantic claims, extraction freshness, unknown memory applicability and conservative provider accounting. A subsequent real run exposed the deadline-loss problem below.

Full logs and immutable-runtime proofs are retained in `.tmp/jev-prescreen-acceptance-20260922/`. Tests are evidence only for their stated seam; deterministic selection does not prove Jev semantic quality or Keeper adoption.

## Controlled resources and setup

The timed-run candidate uses a complete Pi 0.87.0 runtime closure at `.tmp/jev-prescreen-ab-runtime-20260922-v2`, not a build tree symlinked to mutable dependencies. All 15,168 file hashes and 13 symlinks were verified, then resources made read-only. Assembly digest: `9706160e569d8effdae67eff012a8decb53e4e3af59542fa227c1dd2a23f012b`. Keeper: `grok-build/grok-4.7-build-fast`, thinking `low`. Source TaskRuntime and S0 are disabled; both arms receive the same Jev credential only in their consuming processes. No key is stored in this report or evidence manifest.

The 41-page Desire source has SHA-256 `b0b3b1772fadddf168e8f4d32497b045e40a33744838fef221167b3385516c4e`. Its investigator and campaign were created by the ordinary setup agent with the main session as player. Setup used the earlier frozen Pi 0.85.1 closure (four turns, 605.6 seconds); timed play arms both use 0.87.0. After stopping setup, the dedicated complete home was cloned. Each arm initially contains the same 507 files, aggregate digest `6f28acdbf546846892aeba869dbca23d9ec08d7e8f80088c2e42007014b385b1`. Source generation is 2 and opening readiness is true. Neither game save nor readiness was manufactured.

Haunting normal setup completed in three player turns (81.8 seconds), using Pi 0.87.0. Thomas Hayes was created through the ordinary character flow after the clean library reported no saved pregen. The seed daemon was stopped before cloning. Setup duration is reported separately from play duration.

## Initial live failure: no packet after six Jev calls

Runs:

- ON: `.coc/playtests/jev-supply-desire-a-20260922/`
- OFF: `.coc/playtests/jev-supply-desire-b-20260922/`
- Campaign telemetry: `.tmp/jev-prescreen-ab-homes-20260922/desire-arm-{a,b}/.coc/campaigns/jev-supply-desire-20260922/telemetry.jsonl`

Both actual player inputs were `我准备好了，开始吧。`. ON took 141.6 seconds with five gameplay tools; OFF took 57.5 seconds with one. **These are not a valid paired speed estimate**: launching both daemons triggered concurrent automatic openings, the ON driver waited for its opening before accepting the player prompt, and the two stories/dice paths diverged. Both runs and this adverse result remain retained; both owned daemons were stopped. Future timed arms start sequentially and first establish that their automatic opening has settled.

The ON player's prescreen work returned `fallback: cancelled_or_timeout` after 4,050 ms, with six Jev calls, 50,169 reported input tokens and 3,008 output tokens. Usage was marked incomplete, so those numbers are not a complete bill. There was no prepared/delivered packet for the player's request. Later context requests in the same turn correctly reported the already exhausted budget, rather than silently refreshing it.

The first Keeper provider request began 6.004 seconds after `table.player_input` began. The original clock was armed before mandatory input/preflight/NPC work, leaving about four seconds for actual optional work. Selection awaited all initial batches and threw on an incomplete batch or expired signal. This lost successful independent results and left no time for final owner validation. The failure is a product defect in useful partial delivery; it is not evidence that broad PDF access is useless.

The revised §124.3 requires one optional absolute deadline at the first eligible context, narrower semantic work and reserved finalization time. Completed decisions may survive an optional timeout only when their real materials pass every final check before the outer deadline. Cancellation, staleness and outer expiry still forbid publication. This preserves the six-second starting allowance without granting a fresh allowance per tool call. It may add that bounded allowance after slow mandatory preflight, so actual player wait must still be measured.

This design was cross-checked against [gRPC deadline propagation](https://grpc.io/docs/guides/deadlines/) and [Amazon's timeout and retry guidance](https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/). They support measuring realistic downstream latency, propagating remaining budgets and avoiding repeated retry amplification. They do not establish the correct reserve value for this application or prove its performance benefit.

## Long PDF source gate

Cold Blood Road (`111` pages, SHA-256 `9cc71c34dd62462f0f3c7bf765defc4bc49667f1f9fee3f0ac172a32464da50c`) was attempted in a clean dedicated home through normal setup. Two skeleton drafts failed independent visual review on source attribution. Setup never reached readiness. The two actual player turns totalled 505.7 seconds; all source drafts, reviews and events remain at `.coc/playtests/jev-supply-blood-road-setup-20260922/` and its dedicated seed home. The owned process was stopped. This is a cold-source blocker, not a completed PDF acceptance case.

A warm route through the normally installed `book-2` is being evaluated with normal source and character-library operations. It must be reported as matched configuration if campaigns are created independently; it cannot be called a byte-identical clone or used to claim the cold setup defect disappeared. No selective module copy, manual graph publication or save edit is authorized by this workaround.

The warm campaign `jev-supply-blood-warm-a-20260922` reached readiness through normal setup (four turns, 96.0 seconds), then its ordinary automatic opening completed. Setup did not save the new card to the investigator library. `/coc investigator save` explicitly refused RPC mode, so the driver could not produce a gameplay turn for that command and was stopped after confirming the refusal. The library/card was not manually patched. A second matched warm arm has not been established. This operational limitation is separate from both source preparation and prescreen quality.

## Integration ownership

The parallel Pi 0.87.0 upgrade is commit `60558af7d`. Its temporary commit composition removed shared dirty files and then restored them; this task paused writers until the restored `PRESCREEN_TYPE`, host integration and §124 contract were verified. Frozen live evidence was unaffected.

After the original credential owner supplied a precise handoff and stopped writing, the necessary shared credential/activation foundation was committed as `85faec8b4`. Root validated its exact staged-tree source export with a successful runtime build, 55 Node tests and 8 backend/UI tests. Material supply, Grok changes, packaging, admission and driver changes were excluded. The remaining implementation is still under live-defect repair and has not been committed or released.

## Open acceptance

| Gate | Current evidence and limit |
| --- | --- |
| Actual baseline, bytes, final payload observation | Request tests pass; real ON failure delivered no packet. |
| All material families at final request | Owner-level tests exist; additional real-owner-to-payload regressions in progress. |
| G1–G8 semantic distinctions | Audited individually; prior case bank uses a different diagnostic shape and is not production acceptance. |
| Optional timeout retains useful current material | Confirmed live defect; repair and retest in progress. |
| Keeper uses delivered material and avoids repeat reads | Not yet established. |
| Haunting performance | Seed ready; comparison not yet run. |
| Short PDF performance | First pair invalid for causal speed attribution and ON material delivery failed. |
| Long PDF performance | Cold setup blocked; warm normal path not yet accepted. |
| Product setting / installed App | Source setting tests pass; canonical App not packaged or launched for this task. |
| Selective commit | Credential/activation foundation committed separately; material-supply commit awaits live-defect repairs and validation. |
