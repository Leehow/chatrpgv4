Status: accepted within bounded S2 core and read-only integration
Execution: complete for the T06/T07 joint S2 gate; no cache, broad domain, product, quality, latency, or cost-advantage claim
Parent design: #101
Stage: S2
Model: dispatch-pinned gpt-5.6-sol at high reasoning

# Implement pinned Jev DecisionAdapter and bounded transport

Add the typed Jev transport without turning Jev into a generative lane, an authority, or a source of free values.

## Depends on

- T01, T02, and T04 accepted. Section 122 freezes `DecisionPort`, so T07 implementation may proceed in parallel with T06.
- T06 is a joint acceptance dependency, not an implementation prerequisite. Neither module enables a domain by itself.

## Scope

- Native host fetch to pinned `jev-1.13.0`; no new SDK dependency.
- Bind Choice, Score, and Noul answers to host-issued candidates and versioned question families.
- Enforce conservative 32k total packing with explicit UTF-8 byte upper-bound provenance and bound concurrency.
- Reject Choice groups beyond 255 with typed `packing_limit` until an owning family defines an exact semantics-preserving decomposition. A tournament or synthetic global winner is not inferred.
- The first slice has no cache. Every accepted request is attempt-local, and trace records that cache is disabled; a later cache must bind family/model/state/candidate order/audience/trust stage.
- Preserve disabled/unconfigured incumbent behavior and owner-specific unavailable/incomplete outcomes.

## Proposed exclusive write set

- `runtime/jev/decision-adapter.ts`
- `runtime/jev/question-packing.ts`
- `tests/extension/jev-decision-adapter.test.mjs`

## Acceptance

- Tests cover packing limits, CJK, duplicate correlation keys, missing/unknown/rejected/service-failure results, timeout/cancel, cache isolation, and no deadline-renewing retry.
- Free prose, code, URLs, generated IDs, and unbound numeric/date/record fields are rejected.
- An unavailable generation client does not block a task that does not declare a generation fallback.

## Implementation evidence

- `runtime/jev/decision-adapter.ts` exports `createDecisionAdapter(options): DecisionPort` using native fetch, the static official endpoint, pinned `jev-1.13.0`, in-memory Bearer authorization, bounded concurrency, family-owned retry policy, absolute lease deadlines, and one logical usage reservation.
- `runtime/jev/question-packing.ts` validates and clones the complete state, targets, ordered descriptors, and question keys without truncation. Request and response reservation estimates are explicitly `utf8_json_bytes_token_upper_bound`, not claimed tokenizer counts.
- `tests/extension/jev-decision-adapter.test.mjs`: 12/12 focused cases pass. They cover CJK and exact request shape, duplicate keys and packing limits, strict response coverage/envelopes, sanitized answer-schema observability, verified cent-grid probability rounding without normalization, disabled/unconfigured behavior, 429/529 and Retry-After handling, no auth/schema retry, advisory telemetry, conservative unknown-attempt accounting, cancellation/timeout/late response, bounded concurrency, no-cache isolation, and budget reservation/overrun.
- Focused esbuild and the exact strict TypeScript command pass.

The combined live gate passed in `.coc/playtests/jev-s2-live-05-20260920/s2-evidence.json`, reviewed at `.tmp/team-lead/jev-s2-gate-review.md`. Turn 1 persisted four complete Jev batches over three dependent canonical reads, with trace usage exactly matching the durable task record; turn 2 completed with zero Jev decisions and zero operations. Both delivered through ordinary narrate and canonical commits. Trials 01–04 remain failures/partial evidence, and the reviewed credential-shape scan found no key-shaped values.

This accepts T07 only as part of the bounded S2 core/read-only integration. The adapter still has no cache, and no general source/PDF, memory, mutation, consumer migration, broad product, performance, pacing A/B, quality, or cost-advantage claim follows. The accepted build/launch hash in the retained evidence identifies that run and is not asserted to remain current after future edits.

## Retirement and rollback

Typed routing is per family and attempt. Disabling it restores the declared incumbent. Score/Noul never becomes source fact, consent, resource value, or game statistic.
