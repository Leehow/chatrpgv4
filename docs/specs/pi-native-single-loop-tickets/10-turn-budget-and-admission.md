Status: ready-for-human
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

### 2026-09-23 — implemented on `claude/sl10-budget-admission-20260923`, merged with 0.9.5a at `8e017016a`

**Commits.**

- `f4e8285a5`: contract (then §135.11, now §135.25; and §32.11), the measurement above, and the threshold. This
  landed before the code.
- `f691f824a`: the run's time budget.
- `30de32441`: the bookkeeping admission fast path.
- `60eb83dc9`: the replay arms (`--arm before|after`) and recorded live latencies (`--latency live`).
- `d199bca9d`: a budget compose tells the Keeper why.
- `fbd468974`: replay workspace removal retries.
- `d0415111f` and `d0bbceb6d`: merges of 0.9.5a. The budget became §135.25, because the prose-delivery fix owns
  §135.11 and SL-11 owns §135.20–§135.24. The budget now sits before the turn close. The SL-00 inventory follows
  the typed adapter into `typedAttempt`.
- The commit that carries this comment: this comment, the status, the manifest and the replay results.

**Contract.**

- **§135.25, the run's time budget.** `PI_COC_TURN_BUDGET_MS` (default 45 000) is read per run.
  - The policy stamps the elapsed time into its own state when it folds each step, so `next` stays pure.
  - A Keeper batch and a running step are never cut. A forced step that needs no model still runs.
  - A compose that is already owed keeps its reason: the turn close's steer, or the route's finish.
  - Otherwise the next step is `infer(compose)`, reason `run_budget`. Its `coc-clerk` note asks the Keeper to close
    the turn now.
  - Pending clerk steps are listed as `deferred_by_budget`: on the compose's note, on the next run's first note
    (`deferred_last_turn`), and in `lane: "run"` / `event: "budget"` rows. The rows carry `budget_ms`,
    `elapsed_ms`, `elapsed_at_compose` and `decision` (`compose`, `compose_owed`, `model_batch`, `turn_close`,
    `forced_step` or `summary`).
  - A budget compose that ends in prose still goes through §135.11's `turn_close`.
- **§32.11, the bookkeeping fast path.** It applies to an `apply` batch whose every triggering kind is `move`,
  `clue`, `handout` or `time`, whatever the reviewer setting.
  - The batch goes to the typed family first. A typed admission of every line at
    `PI_COC_ADMISSION_FAST_MIN_CONFIDENCE` (0.87; `off` disables) stands with no lane call.
  - Anything else escalates to the configured reviewer: a refusal on any line, a lower confidence, or any
    non-verdict. The fast path never refuses and never admits on a failure.
  - Every reviewed admission row carries `path: typed|lane` with `ms`. A fast-path row adds `fast_path`,
    `fast_min_confidence`, `typed_rule` and, when it escalates, `jev_fallback` (`typed_refusal` or `low_confidence`).

**Replays on the product driver, merged state, 3 runs per arm.**

- `before` sets the budget out of reach and turns the fast path off (`PI_COC_TURN_BUDGET_MS=3600000`,
  `PI_COC_ADMISSION_FAST_MIN_CONFIDENCE=off`), which is the parent's behaviour. `after` is the branch.
- The instrument replays the live Keeper and the live admission verdicts.
  - *instant*: both answer at once, as SL-02 reported. Wall time is Jev, the kernel and the host.
  - *live*: each waits its recorded live time. This is the only way a replay meets the 45 s budget and shows the
    lane's cost.
- Jev is live. Traces are in `experiments/single-loop-routing/results/sl10-*`.

| fixture | latency | arm | wall s | compose starts at s | LLM steps | baseline rows matched |
| --- | --- | --- | --- | --- | --- | --- |
| turn 3 | instant | before | 13.8 / 14.1 / 15.2 | 11.1 / 10.8 / 10.7 | 5 / 5 / 5 | 11/11 ×3 |
| turn 3 | instant | after | 17.1 / 14.6 / 13.2 | 13.6 / 11.3 / 10.6 | 5 / 5 / 5 | 11/11 ×3 |
| turn 3 | live | before | 138.3 / 136.5 / 136.0 | 122.6 / 121.0 / 120.5 | 5 / 5 / 5 | 11/11 ×3 |
| turn 3 | live | after | 127.0 / 125.5 / 125.9 | 111.1 / 109.8 / 110.2 | 4 / 4 / 4 | 7/11 ×3 |
| fight round | instant | before | 9.8 / 9.0 / 9.0 | 6.8 / 6.2 / 6.1 | 2 / 2 / 2 | 5/5 ×3 |
| fight round | instant | after | 11.0 / 8.7 / 8.5 | 7.5 / 6.0 / 5.6 | 2 / 2 / 2 | 5/5 ×3 |
| fight round | live | before | 51.4 / 49.8 / 50.5 | 35.5 / 34.9 / 35.5 | 2 / 2 / 2 | 5/5 ×3 |
| fight round | live | after | 50.5 / 49.6 / 49.4 | 35.4 / 34.7 / 34.4 | 2 / 2 / 2 | 5/5 ×3 |

The 11 baseline rows of turn 3 are SL-02's 8 live actions spelled out: the move, two people, three checks, two
clues, the handout, the time and the narrate. All runs ended `delivered` (`implicit_narrate` on turn 3,
`delivery_accepted` on the fight round).

**Admission path per write** (typed confidence in brackets; ms is the whole review).

- **Turn 3, instant, after.**
  - The clerk's `apply move` went typed in 2 of 3 runs: 0.88 in 377 ms, 0.89 in 417 ms. In run 3 it went to the
    lane at 0.85, under the threshold, in 613 ms.
  - The Keeper's `apply clue, clue, handout, time` escalated to the lane each time: 0.18 / 0.25 / 0.22, with the
    handout line typed `not_authorized`. The typed attempt cost 695–746 ms.
  - The three `resolve`s went to the lane. They are not on the path.
- **Turn 3, live, before.** All five reviews went to the lane: the move 2.1 s, the resolves 4.4 / 3.9 / 4.3 s,
  the Keeper's batch 3.4 s. That is 18.0 s.
- **Turn 3, live, after.** The move went typed 3 of 3 (0.89 / 0.90 / 0.87, 326–415 ms). The three resolves went
  to the lane (12.6 s). The Keeper's batch was never proposed; see the budget below.
- **Fight round, both arms.** The clerk's `resolve` attack went to the lane (live 18.3 s). The fight round has no
  bookkeeping batch.

**What the numbers say.**

- **Turn 3 "still 8/8" holds on the instant replay** (11/11 rows in 3/3 runs, 5 LLM steps, as SL-02). On instant
  replays the after arm is slower by the typed attempts (≈0.4 s on the move, ≈0.7 s on the escalated batch),
  because the replayed lane answers in milliseconds.
- **At live latency the budget does not keep turn 3 under 60 s.**
  - The Keeper's third model step began at 41–43 s, inside the budget. It took 64 s, and the budget never
    pre-empts a running step. The run crossed 45 s inside that step. The step's batch ran whole, and the next step
    was the compose, at 110 s.
  - What the budget took away was the Keeper's own last batch: the two clues, the handout and the time, which is
    the payoff the player asked for. It was not in `deferred_by_budget`, which lists only clerk candidates, so the
    next turn is not told of it.
  - The turn went from 136–138 s to 125–127 s: −1.8 s from the typed move and the rest from the missing step.
  - The replay answers a budget compose with the recorded delivery. That models a Keeper who obeys the note. A
    live Keeper may still call tools, and those run.
- **The fight round's live wall (50 s) is under the budget's reach.** Its compose starts at 35 s. The 18.3 s
  review is a `resolve` on an investigator, which keeps the lane by the ruling.
- **The owner's lever (1) as specified cannot bring these turns under 60 s.** The time is inside single model
  steps (a 64 s step on turn 3) and in the `resolve` lane reviews (12.6 s on turn 3, 18.3 s on the fight round).
  Neither is the budget's or the fast path's to cut. These are SL-11 (per-step reasoning and output) and a
  decision on resolve admission.

**Tests and mutations.**

- `tests/extension/single-loop-turn-budget.test.mjs`, 6 tests:
  - the pure policy;
  - past the budget: no clerk write, compose, then the turn close;
  - inside the budget: the clerk runs;
  - a crossing model step completes and its whole two-call batch runs;
  - a forced step still runs;
  - at the extension seam (emitted kernel): the deferred move is on the compose note, on the next run's note and
    in the rows.
- `tests/extension/admission-fast-path.test.mjs`, 7 tests:
  - the threshold setting;
  - typed ≥ 0.87: no lane call, `path: typed`;
  - 0.86: the lane decides and its refusal stands;
  - a confident `not_authorized` line escalates;
  - an `uncertain` line escalates;
  - a `resolve` on an investigator makes no typed request;
  - a batch with `item` makes no typed request.
- `admission-jev.test.mjs`'s opt-in test is pinned outside the fast path (`off`).

Mutations, each run against the files above and then restored from a saved copy:

| mutation | result |
| --- | --- |
| budget ignored (`overRun` branch off) | killed: 5 of 6 budget tests fail |
| clock never stamped (`runMs` stays 0) | killed: 4 of 6 |
| forced-step exemption removed | killed: 1 (forced step) |
| owed compose not passed through (a turn-close steer's reason overwritten) | killed: 1 (pure policy) |
| fast-path threshold ignored | killed: 1 (0.86 → lane) |
| a typed refusal line admitted | killed: 2 (refusal, uncertain) |
| `resolve` put on the fast path | killed: 1 (resolve → no typed request) |

**Counts.**

- `npm run build:runtime`: exit 0 on the merged state.
- `npm run test:ext`:
  - Parent `dd7aebb32`: 2726/2730, run while the typed measurement loaded the machine. Three of the four failures
    passed alone: `jev-source-domain` ×2 and the `lanes` timing race. `npc-preparation-integration`'s
    overlap-timing test failed alone too, under concurrent pytest.
  - Merged branch: 2779/2780. The one failure, `post-delivery-continuity` "a review that could not answer…", passes
    10/10 alone. The coordinator's baseline for merged 0.9.5a is 2758. This branch adds 13 tests. The remaining 9
    are 0.9.5a's own additions after that figure; I did not separately measure 0.9.5a's head.
- `uv run --frozen python -m pytest tests/kernel tests/play`: parent 1688 passed, 1 skipped. Merged:
  1691 passed, 1 skipped, exit 0 (the merged baseline).

**Not verified.**

- No live table.
- The typed confidences come from a bank that is 92% persona-bench, with the lane as the label. The lane is not
  ground truth.
- The 0.87 threshold has no margin on that bank.
- The deferral note to the next turn lives in the engine's memory, so a restart between turns loses it.
- `kpi.py` does not yet group admission rows by `path`.

### 2026-09-24 — owner rulings after live gate #6: admission within the turn (SL-18, contract §32.12)

Live gate #6 (`gate6-haunting-0335`, turn 2) paid 57.2 s for one lane review (headers at 1.7 s, then 55 s of streaming
under the 120 s cap) and 2.8 s for the clerk's obligation check the compile had already selected; the turn took 112 s.
Across gates #3–#6 no clerk write took this ticket's fast path (the clerk's moves were typed 0.72–0.80, under 0.87), so
every one went to the lane. The owner ruled, and SL-18 implements (ticket `18-admission-within-the-turn.md`):

- **The lane review's cap is 12 s** (was 120 s; `PI_COC_ADMISSION_TIMEOUT_MS` still overrides), measured from the lane
  request; past it the review ends `review_timeout`, a refusal naming the cap, never an admit, and not an outage. This
  ticket's typed attempt keeps its own 4 s cap in front.
- **A clerk write the compile selected is admitted on the compile's evidence** (`path: "compile"`, no lane and no typed
  call) when every feature its predicate reads cleared the gate and every bound parameter has a recorded SL-12 path. It
  sits in front of this ticket's fast path for those writes only; a Keeper's bookkeeping batch, and a clerk write the
  compile did not select, still take §32.11 exactly as measured here. The 0.87 threshold and its measurement are
  unchanged.
- Every admission row carries `origin`, `path`, `ms`, and `first_byte_ms` for the lane (§32.7's addendum).
