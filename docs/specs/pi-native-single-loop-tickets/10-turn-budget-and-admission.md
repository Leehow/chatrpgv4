Status: ready-for-agent
Stage: SL-10 (right after SL-02's live gate; before SL-03)
Spec: docs/specs/pi-native-single-loop.md (Rulings: "A turn is under 60 seconds", "Parameters-only steps never go to the LLM")

# SL-10 — A per-run time budget, and the admission fast path for bookkeeping writes

## Evidence (the SL-02 live gate, 2026-09-23, campaign game-b5367f88, telemetry.jsonl)

- Declared-move turn: 85 s wall. Model calls 7 (10.9 / 2.2 / 22.6 / 4.1 / 6.3 / 2.9 / 12.9 s). §32 lane reviews: `apply` batch 11.0 s (response headers at 2.1 s, generation to 11 s), `resolve` 4.5 s and 2.8 s. Read step 2.3 s. Jev routes 4 × 0.4–0.8 s.
- SL-02's §32 measurement (02-domain-policy.md Comments): 18 clerk writes, 12 reviewed, 0 refused; the lane took 2.1 s (move) to 18.3 s (attack); the typed Jev reviewer answered "authorized" every time in 0.31–0.38 s but its confidence (0.86–0.89 on moves, 0.48–0.56 on attacks) never cleared the 0.9 minimum, so every one fell back to the lane. Memory: three earlier tables, 77 turns, zero admission refusals.

## Scope

1. **Run time budget** in `runtime/jev/step-policy.ts`: a configurable budget (default 45 s from run start; env/setting `PI_COC_TURN_BUDGET_MS`, contract-named) after which the policy's next step is the compose (`infer(compose)`) whatever the route says; pending clerk candidates are recorded as `deferred_by_budget` in telemetry and the capsule's next-turn context; the model's own pending proposals still execute (a batch is never cut mid-way). Guard interplay: the budget never pre-empts an already-running model step; it only decides the next step. Every budget decision is a `lane: "run"` row.
2. **Admission fast path (§32 research item, decided by measurement here):** for model-origin bookkeeping writes — `apply clue`, `apply handout`, `apply person`, `apply move` (and any other verb §32 does not tie to an investigator's consent: cite the section) — the typed reviewer (§32.10) admits at a threshold you measure on the SL-02/SL-07/SL-08 replays and the gate table's rows (target: the lane is called for < 20 % of such writes; refusals unchanged at 0); `resolve` on an investigator keeps the lane; a typed "not authorized"/"unknown" always escalates to the lane. Report the threshold and the numbers before the code lands; the contract records the rule and the measurement.
3. Telemetry: per-run `budget_ms`, `elapsed_at_compose`, admission `path: typed|lane` with ms.

## Acceptance

- Policy tests with stub ports: budget exceeded → compose next; a running model step is not cut; a batch in flight completes; deferred candidates listed. Mutation: budget ignored → killed.
- Admission tests at the extension seam: a bookkeeping `apply` with typed confidence above the threshold never calls the lane; below it, or "not authorized", the lane runs; `resolve` on an investigator still goes to the lane. Mutation: threshold ignored → killed.
- Replays (turn-3, fight-round, product driver): report total wall and the admission path per write before/after; turn-3 still 8/8.
- `npm run test:ext`, `uv run --frozen python -m pytest tests/kernel tests/play` green on the branch baseline; legacy untouched.
