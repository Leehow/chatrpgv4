Status: ready-for-agent
Stage: SL-30 (P1; amends SL-24)
Spec: docs/specs/pi-native-single-loop.md (Ruling: "A batch is admitted line by line")

# SL-30 — Line-level admission: typed-cleared lines go through, the lane reviews the rest

## Evidence (long live gate #2, campaign longgate2-haunting-0830 under chatrpgv4-wt-integ-sl/.coc/campaigns)
- Turn 14: `apply threat` + `apply time`: typed `entailed` at 0.57 (line verdicts not_player_action, entailed), lane no verdict at 13.0 s → `review_pending`; the resend ended `review_timeout` at the 26 s hard cap. Turn 6: `apply person` + `time` + `clue`: lane 10.1 s. Plain move/clue/time batches: 2.4–4.7 s.
- Across gates #1 and #2 the slow batches always carry a `threat` or `person` line.

## Scope
1. Measure per line kind on both long tables' Keeper batches (lane ms, typed line verdict and confidence); pre-register.
2. Contract (§32.12.3): line-level admission as the ruling states; receipts per admitted line; the pending remainder's row names the lines still waiting; the Keeper's note says which lines landed.
3. Implement in extensions/kernel/admission.ts and admitAction; tests, mutation-killable; replay long gate #2's turns 6 and 14 with the recorded Keeper: the plain lines land at once, the threat/person lines follow or return pending alone.

## Comments

### 2026-09-24 — measurement 1: the corpus, the instrument and the pre-registration, before any scored run (branch `claude/sl30-20260924`, base `762d639e1`)

**Corpus.** Both long tables' Keeper `apply` reviews, from read-only copies of `chatrpgv4-wt-integ-sl/.coc/campaigns/{longgate-haunting-0624,longgate2-haunting-0830}` and their playtests, paired with their tool arguments by `experiments/admission-jev-bank/build.mjs` (53 cases, 27 `apply`). A turn's identical resend is measured once: 26 batches, 75 lines (gate #1: 11 batches, 33 lines; gate #2: 15 batches, 42 lines). Gate #2's rows carry their `proposed` lines (SL-24), so its move lines keep `registered_destination`; 19 of gate #1's are re-projected without it (SL-24's known gap). The setup prologue is omitted, as in SL-24.

**Instrument** (`experiments/admission-jev-bank/sl30-line-level.mjs`; checked once on one gate #2 case, not scored). Per batch:
- `typed`: the §32.10 family on the whole batch at minimum confidence 0, 3 runs (each line's verdict and confidence);
- `lane_batch`: the §32.2 lane (`opencode-go/deepseek-v4.1-flash`, `low`, the product prompt) on the whole batch, cap 120 s, 3 runs;
- `lane_line`: the lane on each line alone, the same context, 2 runs.

Jobs interleave by run and go through 3 workers, one call each at a time (SL-24 ran one at a time; gate #1's batch rounds can be compared with SL-24's to see whether 3 workers move the latency).

**Base rate before the run** (SL-10's 2 174 typed bookkeeping batches, per line, typed admitting at 0.87 or above): `time` 95 of 1 358 (7.0%), `move` 52 of 789 (6.6%), `clue` 23 of 1 068 (2.2%), `handout` 0 of 235, `threat` 3 of 185, `person` 0 of 20. Of the 95 `time` lines cleared at 0.87, 10 sat in a batch the lane refused (which line it refused is not recorded).

**Rules fixed now.**
- *Which lines the typed reviewer may clear* is contract, not measurement: §32.11's kinds (`move`, `clue`, `handout`, `time`) and §32.1's non-triggering kinds; never `cash` (§32.10), `item`, `object`, `usage`, `map` (§32.11).
- *The line threshold* is the fast-path confidence, `PI_COC_ADMISSION_FAST_MIN_CONFIDENCE` (0.87), as the ruling says. This measurement reports how often it fires and does not move it.
- *How the remainder is reviewed.* A fresh lane round on the remainder alone, the cleared lines shown as settled, unless the lane on single lines of the kinds that stay behind is slower at the median than the lane on the whole batches that carry them by more than 1 s; then the round already running on the whole batch decides the remainder. (Single lines stand in for remainders: at 0.87 few real remainders will exist to measure.)

**Predictions** (mine):
1. At 0.87, typed clears at most 15% of the 75 lines' 225 line-runs. Gate #2's turn 14 `time` line clears in at most 1 of 3 runs, and so does its `threat` line; no line of gate #2's turn 6 batch clears in 2 or more runs.
2. The lane on one line alone: the median of every kind is 2–6 s, and `threat` and `person` lines alone are not slower at the median than `time` and `clue` lines alone by more than 1.5 s. The kind alone is not what makes a batch slow.
3. The lane on whole batches: gate #2's turn 14 (`threat`, `time`) passes 13 s in at least 1 of 3 runs; its turn 6 (`person`, `time`, `clue`) passes 10 s in at least 1 of 3.
4. Batches of 4 or more lines are slower at the median than batches of 1–2 lines by at least 1 s.
5. No line typed-cleared at 0.87 is refused by the lane on its own (per-line false clearance 0).
