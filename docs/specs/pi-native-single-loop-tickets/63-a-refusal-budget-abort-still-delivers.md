Status: ready (filed 2026-09-25 from long gate #10; batch 9)
Stage: SL-63 (P1, turn close)
Spec: docs/kernel-rpc.md §135.11 (turn close; SL-16 fallback), the refusal budget (§ three strikes)

# SL-63 — A run the refusal budget aborts is a delivery drop like any other: the fallback narrates

## Evidence (long gate #10 t4)
- After three `unknown_entity` refusals the refusal budget blocked the Keeper's further calls, the run ended `aborted_during_operate`, the host sent `turn_unfinished_notice`, the turn settled `settled_without_delivery` and was recorded stranded; the player saw no fiction although the compile's move had landed (the party is at the Hall of Records) and the Keeper had material. SL-16's fallback ("a turn never strands") covers refused deliveries and preparation waits, not a run the refusal budget aborts.

## Ruling (owner, 2026-09-25)
The refusal budget ends the Keeper's attempts, not the turn: when it aborts a run, the turn closes through SL-16's fallback with what landed (receipts, the carried scene) and the Keeper's last draft if any; the notice is the fallback's fallback, never the whole delivery.

## Scope
1. Contract: §135.11 addendum: `aborted_during_operate` by the refusal budget is a drop with reason `refusal_budget`; the fallback narrate runs once.
2. `runtime/jev/hybrid-engine.ts` / `extensions/kernel/index.ts` turn close: route the abort into the SL-16 path.
3. Tests, mutation-killable: a run aborted by the refusal budget delivers the fallback and is not stranded; the stranded record is not written; the gate #10 t4 replay delivers.

## Comments
