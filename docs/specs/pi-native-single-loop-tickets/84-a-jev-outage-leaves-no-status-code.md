Status: ready (filed 2026-09-26 from long gate #16; batch 14)
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
