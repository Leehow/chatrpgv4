Status: in-progress
Execution: base apply and finite fulfillment implemented with conformance evidence; live gates pending (manifest `implemented-base-apply-and-finite-fulfillment-live-gates-pending`). Not accepted.
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

## Admission reviewer on the apply/resolve guard (2026-09-22)

Scope note, not acceptance. The admission guard every `apply` and `resolve` passes (contract §32.1, reused by the
canonical dispatcher for T11/T12 host-issued operations) gained an opt-in typed primary reviewer, contract §32.10:
`PI_COC_ADMISSION_REVIEWER=jev` puts the `action-admission` v1 decision family first and falls back to the §32.2 lane
for every non-verdict; the default remains `lane`. Where the guard runs, what it refuses, verdict reuse, the outage
streak and fail-closed unavailability are unchanged, so no T12 acceptance claim moves. Seam and mutation evidence:
`tests/extension/admission-jev.test.mjs`, `tests/extension/admission-jev-domain.test.mjs`. Offline evidence: 5 179
retained reviews reconstructed and routed by `experiments/admission-jev-bank/`; live agreement with the lane is
**unmeasured** (no Jev credential in that run), so the default does not change and the typed route is not accepted.
