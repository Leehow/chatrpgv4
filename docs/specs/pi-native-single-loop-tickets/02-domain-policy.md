Status: needs-triage
Stage: SL-02
Spec: docs/specs/pi-native-single-loop.md

# SL-02 — Migrate the domain policies; the plan is no longer the entry

Move table evidence (the prescreen), ordinary resolve/apply and the routing fan-out into the RunPolicy; make the plan an optional artifact; remove `submit_plan_packet` from the hybrid tool set; one tool catalog for the LLM and Jev; `infer(bind)` for open parameters.

## Depends on

- SL-01 accepted.

## Scope

- Candidates from real state only (kernel apply options with availability, scene assets, uninstroduced people under the capsule's label, Mod pending contacts, ordinary check with the closed binder, active-session families, located entities); no internal tags; consumed keys.
- Read first, re-read after a scene change; the prescreen allowance becomes the run's Jev budget.
- Jev's own tools (read more, locate, bind); the LLM fills open parameters when Jev chose the operation.
- `IntentBinding` required, `Requirements` and `PlanArtifact` optional; complex inputs get a `PlanArtifact` inside the run, never a second executor.

## Rulings that bind this ticket (spec, "Rulings")

- The clerk's authority list (a–d) and the boss-only list are the candidate policy; `needs_player` never becomes an `ask` without the Keeper.
- Keeper batches with order and one success/failure branch per step; a fallen branch returns to the Keeper.
- Clerk steps are committed at once and listed in the capsule as "clerk did"; reversal is an explicit Keeper operation.
- Research item (decide by measurement, report before closing): whether a fully-bound, kernel-issued, Jev-selected operation still passes §32 admission, or whether §32.10's typed admission (or none) is enough for policy-origin operations.
- The compose step streams raw prose; the delivery card replaces it in place when the turn closes.

## Acceptance (design §13 SL-02 gate)

- A simple turn has no forced LLM plan; the turn-3 replay reproduces 8/8 live actions with ≤ 5 LLM steps against the product driver; special families still reach an LLM proposal path; every route distribution is in telemetry.
