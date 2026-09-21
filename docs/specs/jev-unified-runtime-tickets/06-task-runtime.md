Status: accepted within bounded S2 core and read-only integration
Execution: complete for the T06/T07 joint S2 gate; no full product or downstream-domain claim
Parent design: #101
Stage: S2
Model: gpt-6-astra
Helper actually used: dispatch-pinned gpt-5.6-sol at high reasoning for bounded lifecycle/recovery tests and independent review because Terra capacity was unavailable

# Implement HostSessionAdapter and the single TaskRuntime lifecycle

Build the sole host runtime for foreground root tasks, scoped child tasks, and separately owned post-commit memory jobs. Domain legality remains with domain owners.

## Depends on

- T02, T04, and T05 accepted.

## Scope

- Implement Intake, optional Grounding, Planning, Deciding, Composing, Auditing, Committing, Delivering, and terminal transitions.
- Support direct draft, dependent observation rounds, bounded replanning from remaining goal plus settled receipts, source wait resume/revalidation, shutdown, and foreground priority.
- Bind new/resume/fork sessions through the accepted adapter.
- Start memory work only from committed-turn events as a separate root job.
- Integrate #99 only through its decision-boundary hook and preserve #92–#98 KIC behavior, including default-off and existing fallback.

## Proposed exclusive write set

- `runtime/host.ts`
- `runtime/jev/task-runtime.ts`
- `runtime/jev/host-session-adapter.ts` after T02 closes
- `tests/extension/jev-task-runtime.test.mjs`

**Subassignment boundary:** The helper owns lifecycle/restart tests and review only. Astra owns HostSessionAdapter, TaskRuntime, and host composition. The completed helper work ran on dispatch-pinned `gpt-5.6-sol` high after Terra was unavailable; this substitution did not widen its paths.

## Acceptance

- A real cross-tool read-only workflow completes with a dependent observation round; an exact/cached case makes zero Jev calls.
- New player input cancels obsolete foreground work but not valid committed-memory backfill.
- A genuine choice stops; quiet same-goal play is accepted without a manufactured question.
- A background job neither calls narrate nor creates a whole-turn Git commit.

## Retirement and rollback

Routing is per domain and pinned for an attempt. Disable only at a new attempt boundary while preserving checkpoints and accepted data. Domain policies are registered, never replaced by generic completion/failure rules.

## Implementation record — 2026-09-20

The shared task loop, public Pi binding, atomic task store, table-evidence read policy, and source-only opt-in launcher now exist. Core/recovery/host tests exercise real SDK hooks and the production canonical dispatcher, with controlled semantic backends explicitly limited to conformance. The kernel exposes an additive world dependency digest and opt-in receipt-bound before/after versions for actual apply settlements. Deferred Mod registration forwards those receipts; it cannot manufacture a version advance from two external snapshots.

Two retained real attempts exposed integration defects and are **not accepted**:

- `.coc/playtests/jev-s2-live-20260920`: first user request aborted before provider work because the default provider output ceiling exceeded the finite task allowance. The bounded role now requests at most 8192 output tokens; provider/model choice remains unchanged.
- `.coc/playtests/jev-s2-live-02-20260920`: Grok submitted the real plan; Jev selected look investigator, recall transcript listing, and the issued original Keeper page in dependent rounds. One next-choice answer failed strict schema validation, and delivery was refused when existing deferred equipment registration changed the broad world revision. The original response had insufficient diagnostic metadata; three separately labelled replay probes were valid, so the invalid-answer cause is still unconfirmed and validation has not been relaxed. Owned registration now advances the lease only from the actual kernel receipt and matching before/after versions.

A whole capsule was about 60k characters. The table-evidence domain now has an explicit projection with omission coverage: current locus/clock, partial investigator projection, discovered clue names and public entity identities. Original speech still requires original reads; private unspoken module terms cannot substitute for conversation evidence. Source/prose guidance is not silently truncated into apparent completeness.

Task coordination files from those attempts were preserved and moved from the initial misplaced `task-runtime/` directory into `.coc/task-runtime/`; subsequent writes use `.coc/task-runtime/` outside the canonical campaign Git tree. No campaign evidence was deleted. The setup run is `.coc/playtests/jev-s2-setup-20260920` (3 real setup turns), and the current TS campaign is `jev-s2-20260920`.

The legacy COC plugin's session.resume was called as required by the host continuation guard but reports unsupported_save_schema for this TS product campaign. Acceptance continues only through the repository's canonical tests/play driver and current bin/pi-coc; no legacy kernel is used.

The repaired combined gate passed in `.coc/playtests/jev-s2-live-05-20260920/s2-evidence.json`, with independent bounded review at `.tmp/team-lead/jev-s2-gate-review.md`:

- turn 1: real Grok plan, four complete Jev batches over growing actual observations, canonical `look -> recall transcript cards -> issued original turn-0 Keeper read`, ordinary narrate delivery, and commit `4ede2b4`;
- turn 2: direct draft with zero Jev decisions and zero operations, ordinary narrate delivery, and commit `6d05c2a`;
- durable tasks ended complete/delivered with no remaining needs; the exact original read matched retained transcript and turn record; Jev trace usage matched the durable records;
- trials 01–04 remain retained failures/partial evidence; a 27-file credential-shape scan printed no matches and found zero Bearer/API-key/token-shaped values.

The accepted run's build/launch digest is `992bc0b16e1aa2314e0aa87436cee80b38087c6dae9c10488eec68467be30b94`. It identifies that retained run only and is not a claim that future edits retain the same hash.

Acceptance is limited to S2 core lifecycle and the bounded read-only `table-evidence/2` integration. Background committed-memory owner integration remains T09. No general source/PDF, migrated memory, resolve/apply, cache, broad product, performance, or pacing A/B claim follows. #99 D4 core compatibility is complete for this boundary; full versioned Mod alignment and pacing A/B remain S6/S7 work.
