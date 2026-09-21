Status: accepted
Execution: complete
Parent design: #101
Stage: S0
Model: gpt-6-astra
Helper: gpt-5.6-terra for contract fixtures/tests only; no contract or kernel writes

# Freeze unified contracts and compatibility boundaries

Freeze the implementation-facing contracts before any dependent runtime work. The parent design remains authoritative; #100 is historical, while #92–#98 KIC and #99 pacing are referenced without duplication or completion claims.

## Scope

- Define `IntentBinding`, `PlanPacket`, `TaskContext`, `DecisionBatch`, `DecisionResult`, `OperationProposal`, `ObservationPacket`, `TaskResult`, SourceRef, source proof classes, read-set/version bindings, and per-domain failure ownership.
- Separate host-only opaque handles from model-visible semantic aliases.
- Record native-extractive consultation as native-text evidence that cannot publish, prepare, execute, or prove scanned absence.
- Freeze compatibility points for #99 without adding a second progress judge and for #92–#98 without changing KIC behavior.
- Add the required implementation contract amendment to `docs/kernel-rpc.md` before dependent code.

## Proposed exclusive write set

- `docs/kernel-rpc.md` — new append-only contract section.
- `runtime/jev/contracts.ts` — new shared types.
- `tests/extension/jev-contracts.test.mjs` — contract/runtime boundary checks.

Everything else is read-only. No source-domain implementation belongs here.

**Subassignment boundary:** Terra may own `tests/extension/jev-contracts.test.mjs` and fixtures only. Astra owns the contract text and shared types.

## Acceptance

- Exhaustive type checks cover every outcome and proof class.
- Tests reject invented executable IDs, unauthorized capabilities, prose/code/URLs in Jev typed results, missing required targets, and a universal failure policy.
- Reader/writer compatibility is explicit for legacy and new shapes.
- The contract review records that Jev telemetry is not truth, consent, or a game statistic.

## Retirement and rollback

No incumbent path retires. If existing owner outcomes cannot be represented without flattening domain authority, T01 fails and #101 is revised; T02–T15 remain blocked.

## Completion evidence

- The authoritative append-only §122 is present in `docs/kernel-rpc.md`.
- `runtime/jev/contracts.ts` implements the frozen initial encoding and compiles.
- `tests/extension/jev-contracts.test.mjs` passes 10/10; the Astra lead reviewed the Terra-owned test slice.
- T01 is accepted. This does not accept T02 or any hybrid product rollout.

## Not this ticket

No model/provider call, runtime loop, SourceRef resolver, push, package, restart, Python production work, or play acceptance. Ticket publication is owned by the lead through the repository-local tracker.
