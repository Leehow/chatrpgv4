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

## Comments

### 2026-09-23 — the admission measurement and the threshold, before the code (worker on `claude/sl10-budget-admission-20260923`)

Recorded before the fast-path code commit, as the ticket asks. The rule and the table are contract §32.11; the
budget is §135.25 (renumbered from §135.11 at the merge with the prose-delivery fix, which owns §135.11).

**Which writes are "bookkeeping writes".** An `apply` batch that §32.1 puts to review and whose every triggering
kind is `move`, `clue`, `handout` or `time`. `person` is never reviewed (§32.1 lists it as non-triggering), so it
needs no fast path. `time` is added to the owner's four because §32.2 makes routine time inherent in a chosen
action entailed, not its own consent. `cash`, `item`, `object`, `usage` stay with the lane because §32.2 ties
them to consent (limits and undisclosed prices; surrender of possessions; pickup/transfer is a real proposed
action). `map` stays: §32 says nothing about what it commits. `resolve` stays with the configured reviewer.

**Corpus 1: the replays and the gate table (what the ticket names).**

| source | write | typed (SL-02 typed arm, 3 runs) | lane |
| --- | --- | --- | --- |
| turn 3 | clerk `apply move` (policy origin) | authorized 0.86 / 0.88 / 0.89 | authorized (live 2.1 s) |
| turn 3 | Keeper `apply clue, clue, handout, time` | lines entailed, entailed, **not_authorized** (handout), entailed; 0.17 / 0.23 / 0.27 | entailed (live 3.4 s) |
| fight round | no bookkeeping batch (three `resolve`s) | — | — |
| gate table `game-b5367f88` t1 | `apply clue ×4, cash, define, object, handout, move` | not a bookkeeping batch (`cash`, `object`) | authorized (live 11.0 s) |

SL-07/SL-08 ran the lane arm only (no typed answers); their writes are the same as SL-02's. So on the ticket's
own corpus the fast path can take at most the clerk's move: one of the two bookkeeping writes of turn 3, and
none of the gate table's 11.0 s batch.

**Corpus 2: the retained bank** (`experiments/admission-jev-bank/build.mjs`, rebuilt 2026-09-23 read-only over
the App home `.coc` with its play sessions and the main checkout's `.coc`: 5 903 review rows, 5 204 paired
cases). Its 2 174 lane-labelled bookkeeping batches were typed live at minimum confidence 0
(`sl10-typed-distribution.mjs`; per-case rows in `results/sl10-bookkeeping/typed-distribution.jsonl`; thresholds
by `sl10-analyze.py`, no further calls): 2 169 answered, 5 typed non-verdicts. Lane labels: authorized 1 229,
entailed 572, not_player_action 120, not_authorized 247, uncertain 1. Source: persona-bench 1 994, table 175.

- Every line typed admitting: 1 570 (72.4%). Their review confidence (minimum line confidence) p10 / p25 / p50 /
  p75 / p90 = 0.23 / 0.34 / 0.45 / 0.61 / 0.73.
- Of the 248 lane refusals, 110 were typed admitting on every line (at any confidence).
- Typed latency: 468 ms p50, 627 ms p90, 1 792 ms max. The retained lane took 32.5 s p50, 77.6 s p90 (mostly
  grok-4.6).

| threshold *T* | typed admits alone | lane called | lane refusals typed-admitted |
| --- | --- | --- | --- |
| 0 | 1 570 | 27.6% | 110 |
| 0.3 | 1 277 | 41.1% | 64 |
| 0.5 | 660 | 69.6% | 23 |
| 0.6 | 421 | 80.6% | 11 |
| 0.7 | 212 | 90.2% | 4 |
| 0.8 | 87 | 96.0% | 1 |
| 0.86 | 41 | 98.1% | 1 |
| **0.87** | **34** | **98.4%** | **0** |
| 0.9 | 17 | 99.2% | 0 |

By shape (lane refusals typed-admitted at 0.7 / 0.8 / 0.9): single-line `move` 4 / 1 / 0 (the one at 0.86);
single-line `time` 0 / 0 / 0 with 51 / 9 / 0 admitted; every multi-line batch shape admits almost nothing above
0.7. On the 175 table-source cases alone there is no false admission at *T* ≥ 0.5 (46 admitted, 74% lane).

A second score was tried and rejected: the minimum over lines of the probability mass on admitting verdicts
(authorized + entailed + not_player_action). It is worse: at 0.95 it still admits 17 lane refusals.

**Threshold chosen: 0.87** (`PI_COC_ADMISSION_FAST_MIN_CONFIDENCE`), the lowest *T* at which no lane refusal
in the bank is typed-admitted, with no margin (the highest-confidence false admission is 0.86).

**The ticket's targets do not both hold with this typed family.** "Refusals unchanged at 0" read as "the fast
path admits nothing the lane would refuse" needs *T* ≥ 0.87, where the lane is still called for 98.4% of
bookkeeping batches. "The lane for < 20% of such writes" is not reached at any *T*: 27.6% of batches carry a
typed refusal on some line and always escalate, and at *T* = 0 the fast path would admit 110 of the 248 lane
refusals, which is removing admission for speed (spec Out of Scope). Read literally, "refusals unchanged at 0"
(the replays' refusal count stays 0) holds at any *T*, because a typed refusal never stands on this path; that
reading would allow *T* = 0, and it is not taken for the reason just given. What is left for the owner: accept
some false admissions, calibrate a new typed family on this bank (the confidences are low, not wrong in rank:
false admissions fall from 110 to 1 between *T* = 0 and 0.8), or leave the admission latency to SL-11. The cost
of the path as chosen is the typed attempt in front of the lane on every escalated batch (≈0.5 s).
