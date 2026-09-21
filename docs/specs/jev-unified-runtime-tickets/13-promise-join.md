Status: planned
Execution: inactive until T09, T10, and T12 pass
Parent design: #101
Stage: S4/S5 join
Model: gpt-5.6-terra

# Prove the memory plus action promise and reward join

Test the end-to-end join between committed memory and canonical effects. This ticket owns integration evidence only and does not modify kernel or production source.

## Depends on

- T09 memory writes accepted.
- T10 memory reads accepted.
- T12 effect/fulfillment links accepted.

## Scope

- Link the original promise source event to later condition evidence, due classification, existing Keeper/apply action, canonical fulfillment effect, restart, replay, partial settlement, and independent promises.
- Exercise module absence as non-cancellation of campaign-established fact.

## Proposed exclusive write set

- `tests/extension/jev-promise-reward.test.mjs`
- `tests/kernel/test_jev_promise_reward.py`
- `tests/fixtures/jev-promise-reward/`

Production paths are read-only.

## Acceptance

- A many-turn differently worded promise is recalled from its original span and paid exactly once.
- Restart/lost reply does not repay; partial payment leaves a remainder.
- Two promises from one NPC coexist; retraction differs from an independent claim; absent module text does not erase campaign truth.
- Evidence includes the memory source ref, condition receipt, effect receipt, and fulfillment link.

## Retirement and rollback

No production path retires here. Failure blocks every end-to-end promise/reward claim and T15, while independently accepted S4 and S5 base slices may remain enabled.
