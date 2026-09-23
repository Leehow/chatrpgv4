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
- **Parameters-only steps never go to the LLM** (spec ruling of the same name): the combat/chase session families are candidates built from the kernel's session view (`turn_of`, `actions[]`, `pending_defense.options`), not an LLM proposal path. Determined steps (one legal action, damage, initiative advance) are `direct`; closed choices (the NPC's defence, its target when several) are `decide(bind)`; the LLM is asked only when the player's words leave the target or weapon open, or for the prose. Acceptance adds: a replay of a fight round from the 打斗测试 table closes with one LLM step (the compose) when the player names the target, and every non-prose step carries the kernel's issued row as its basis.

## Scene obligations (scheduled here; owner, 2026-09-23)

`docs/specs/scene-obligations-as-candidates.md` (rulings Q1–Q7 recorded there) and its tickets `scene-obligations-as-candidates-tickets.md` are part of this stage:

- SO-01 (shape, validator, the haunting's morgue pair), SO-02 (kernel issuance in `table.apply.options.obligations`, settlement by flag through `resolve action.obligation`) and SO-03 (reader extraction) are SL-02 workers that do not touch the loop; they may start while SL-01 is still open.
- SO-04 is this ticket's candidate builder: clerk authority (e) = the next step of an open stated obligation; precedence `person → mod_check → obligation_check → core-check → clue/handout → move`; `guarded_by` candidates withheld; `reaction: "preordained"` suppresses the Mod contact-check candidate for that pair; hazards never become candidates; clerk-origin refusals stay off the Keeper's budget.
- The §32 research item above reports obligation checks as their own row (`basis: obligation <handle>`).

## Acceptance (design §13 SL-02 gate)

- A simple turn has no forced LLM plan; the turn-3 replay reproduces 8/8 live actions with ≤ 5 LLM steps against the product driver; special families reach the LLM only for open parameters and the prose (see the parameters-only ruling); every route distribution is in telemetry.
- With SO-01/SO-02/SO-04 on the branch (ruling Q6): on the fixture variant with the morgue pair authored, the meeting with Arty and the gatekeeper's check are selected `now` in 3/3 runs; a passing roll closes in ≤ 3 LLM steps (target 2); a failing roll is recorded as the Keeper improvising past an open obligation, not scored.
