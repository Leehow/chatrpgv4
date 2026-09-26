Status: ready-for-human (implemented 2026-09-26)
Stage: SL-84 (P2, Jev adapter telemetry)
Spec: docs/kernel-rpc.md §122 (DecisionResult failure codes), §135.32 D2.7 (outage degrades to the Keeper); `runtime/jev/decision-adapter.ts` (`AdapterTrace` `attempt`/`retry`/`failure` events exist but are not persisted), `runtime/jev/hybrid-engine.ts` (`jev_service_error` rows)

# SL-84 — Seven turns of Jev service errors on gate #16 and no row says which HTTP status it was

## Evidence
- Gate #16 turns 8–14: every compile/route/consequence/admission-fast-path call answered `status: unavailable, reason: jev_service_error` in 200–440 ms with `jev_input_tokens: 0`; the prescreen reported "Adaptive material retrieval: unavailable". The adapter's `AdapterTrace` (`attempt` with `status`, `retry` with `reason`, `failure` with `code`) is emitted to a callback that the engine does not record, so the campaign's telemetry cannot tell 429 (our rate limit — another session was also using Jev) from 529 (provider overload) from 401.
- The product degraded correctly (20/20 delivered), which is exactly why the outage would have gone unnoticed without the triage's route column.

## Ruling
Every Jev attempt that fails writes one telemetry row `{lane: "jev", event: "attempt_failed", family, status (HTTP) | code (network/timeout), retry: n, ms}` and the batch-level failure writes `{lane: "jev", event: "batch_failed", family, code, attempts}`; the existing `jev_service_error` rows gain `jev_status`. Rate-limit responses (429) also record the `retry-after` header when present. No content of the request or response is written.

## Scope
- `runtime/jev/hybrid-engine.ts` (subscribe the engine's `record` to the adapter's `trace`), `runtime/jev/decision-adapter.ts` (status on `failure`), `extensions/kernel/admission.ts` fast path; contract §122 addendum; tests with a stub fetcher returning 429/529/network error → rows with the code; the triage script counts them.

## Comments

**2026-09-26, implemented (Claude Fable 5.1, worktree `chatrpgv4-wt-sl84`, branch `claude/sl84-20260926`).** Contract §122 addendum written first (`docs/kernel-rpc.md`, "Jev attempt/batch failure telemetry (2026-09-26, SL-84)", under §122's "Failure and outage ownership"), then code:

- `runtime/jev/contracts.ts`: `DecisionResult.failure` gains an optional `status?: number | string` (the last attempt's HTTP status, or its network/timeout code when no response ever arrived; absent when the batch never dispatched).
- `runtime/jev/decision-adapter.ts`: the retry loop now traces every completed round trip (`kind: 'attempt'`, carrying `family`, `ms`, and either `status` or a `code` of `'network_error'`/`'timeout'`; a 429's raw `retry-after` header text rides as `retryAfter`), and the batch `failure` trace gains `family`/`status`. `unavailable()`/`settleUnknown()` thread the same last-known status onto the returned `DecisionResult.failure.status`. A new exported `jevFailureTelemetry(record)` turns those trace events into the ticket's two rows (`attempt_failed`, `batch_failed`); a successful attempt or batch writes nothing, and no request/response content is ever passed to `record`.
- `runtime/jev/hybrid-engine.ts`: `record` is now defined before the adapter it feeds, and `createDecisionAdapter(...)`'s `trace` option is wired to `jevFailureTelemetry(record)`. The route/compile, reask and consequence `record({lane:'route', ...})` calls each gain `jev_status` straight from the same `DecisionResult.failure.status` already in scope at that call site.
- `runtime/jev/admission-domain.ts`: `interpretAdmissionJev`'s fallback and `runAdmissionJev`'s `fallback` helper now carry an optional `jevStatus` from `result.failure?.status` through to `AdmissionJevResult`.
- `extensions/kernel/admission.ts`: `typedAttempt`'s own `createDecisionAdapter(...)` call also gets `trace: jevFailureTelemetry(...)` (writing through the caller's own telemetry `record`), and its `meta` gains `jev_status` when the typed attempt fell back with one.
- `tests/play/jev-steps-report.py`: a new "jev outages" section reads `{lane:"jev", event:"attempt_failed"|"batch_failed"}` rows and prints the outage turns, the attempt statuses/codes seen, and batch failures by family.
- `tests/play/long-gate-triage.py` does not exist in this tree (only lives in the session scratchpad per the marker) — skipped as instructed.

**Tests** (`node --test`, this worktree, real build via `npm run build:runtime` first — `build/` was entirely missing here, a pre-existing worktree gap unrelated to this ticket):
- New `tests/extension/jev-failure-telemetry.test.mjs` (11 tests): unit tests of `jevFailureTelemetry` on synthetic trace events (429+retry-after, 529, network error, timeout, a clean attempt/batch writing nothing, a `batch_failed` row) plus end-to-end tests through the real `createDecisionAdapter` with stub fetchers for all four required failure shapes (429 retried into success, 529 exhausting retries, a network `TypeError`, and an attempt-timeout abort), asserting on both the recorded telemetry rows and `DecisionResult.failure.status`.
- Extended `tests/extension/admission-jev-domain.test.mjs` with two cases for `jevStatus` propagation (present when `failure.status` is set, absent otherwise).
- Extended `tests/extension/single-loop-compile.test.mjs` with one end-to-end case through the real `createHybridEngine` (stub `DecisionPort`) proving the recorded `lane:"route", purpose:"compile"` row carries `jev_status: 529` alongside `reason: "jev_service_error"`.
- Full required run: `jev-decision-adapter.test.mjs`, `jev-failure-telemetry.test.mjs`, `admission-jev-domain.test.mjs`, `admission-jev.test.mjs`, `consequence-route.test.mjs`, `consequence-shadow-gate.test.mjs`, `consequence-host-budgets.test.mjs`, `consequence-candidates.test.mjs`, `single-loop-compile.test.mjs` — 91/91 pass. All 16 `single-loop-*.test.mjs` files (174 tests) also pass.
- **Mutation evidence** (copy-based: `cp` the real file to the scratch dir, edit the real file in place, run, `cp` the backup back — never `git checkout --`): (1) changing `retry: event.attempt - 1` to `event.attempt` in `jevFailureTelemetry` is caught by the 529-exhaustion end-to-end test's retry-count assertion; (2) forcing `const failed = false` (disabling attempt-failure detection) is caught by the timeout end-to-end test (and would fail several others); (3) dropping `lastStatus` from the `unavailable(...)` call in `settleUnknown` is caught by the network-error and timeout end-to-end tests' `result.failure.status` assertions; (4) removing the `jevStatus` propagation in `interpretAdmissionJev`'s fallback branch is caught by the new admission-domain test. All four mutations were reverted from the scratch backups afterward; `diff` against the backups confirmed a clean restore.

**Could not do / left for review:** did not run the full `test:ext`/`pytest` suites (per instructions, left for post-merge); did not touch `tests/play/long-gate-triage.py` since it is not part of this worktree. No live Jev/model calls were made — all adapter tests use stub `fetcher`s (429/529/network-error/timeout) per the hard rule.
- Live (gate #17): rows present — one `attempt_failed` 404 (`action-admission`), one timeout (`keeper-support-agent`); both isolated.
