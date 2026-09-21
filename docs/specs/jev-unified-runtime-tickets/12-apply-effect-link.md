Status: planned
Execution: inactive until T05, T06, and T07 pass
Parent design: #101
Stage: S5
Model: gpt-6-astra
Helper: gpt-5.6-sol for non-kernel apply harness and tests only

# Route atomic apply and canonical effect and fulfillment links

Move the bounded ordinary apply family through the dispatcher and bind promise fulfillment to canonical effects instead of a parallel reward store.

## Depends on

- T05, T06, and T07 accepted.
- T08 only when a new source definition is genuinely required.
- #99 decision-boundary compatibility evidenced.

## Scope

- Validate whole-batch legality, read set, intent, consent, stable effect identity, and existing profile/object identity.
- Serialize and commit the batch atomically under current kernel ordering.
- Add a durable per-promise or per-instance fulfillment link to canonical effect receipts.
- Preserve object quantity, condition, ammunition, and other existing instance state.
- Recall stays read-only and never pays a reward itself.

## Proposed exclusive write set

- `kernel-ts/runtime/apply-operation.ts`
- `kernel-ts/memory/fulfillment-receipt.ts`
- the predeclared apply registration block in `extensions/kernel/index.ts` after T05 closes
- `tests/kernel/test_jev_apply.py`
- `tests/extension/jev-apply-dispatch.test.mjs`

**Subassignment boundary:** Sol may own the non-kernel harness, fixtures, and tests only. Astra owns both `kernel-ts` modules and the registration edit.

## Acceptance

- A multi-effect batch is all-or-none.
- Lost response and restart cannot duplicate an effect.
- Unsupported profile/definition refuses; partial fulfillment retains the remaining obligation; independent promise IDs do not collide.

## Retirement and rollback

Accepted receipts/effects remain authoritative when typed routing is disabled; rollback never reverses player action. Unsupported apply families stay incumbent. Base apply acceptance does not imply promise/reward acceptance.
