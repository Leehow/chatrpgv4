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

### 2026-09-24 — measurement 2 (scored against the pre-registration), and the decisions it forced

Results: `experiments/admission-jev-bank/results/sl30/longgates-line-level.jsonl` (306 rows: 78 typed, 78 lane on the whole batch, 150 lane on one line; 0 lane failures, 1 typed `service_error` on gate #2 turn 6 run 3). One case is dropped from every figure below: `longgate2-haunting-0830:1:2` is mis-paired by the bank builder (its row's one `proposed` line against three re-projected kinds). That leaves 25 batches, 72 lines. Gate #1's whole-batch rounds here had p50 4.0 s against SL-24's one-at-a-time 4.3 s on the same batches, so the 3 workers did not inflate the latency.

**Typed, per line** (3 runs; line-runs; "admit" = an admitting line verdict):

| kind | line-runs | admit | conf p50 | p90 | max | admit ≥ 0.70 | ≥ 0.80 | ≥ 0.87 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `clue` | 56 | 34 | 0.45 | 0.80 | 0.95 | 8 | 6 | 6 |
| `time` | 53 | 53 | 0.68 | 0.82 | 0.94 | 26 | 15 | 4 |
| `person` | 29 | 20 | 0.67 | 0.77 | 0.83 | 7 | 0 | 0 |
| `threat` | 27 | 27 | 0.60 | 0.79 | 0.85 | 6 | 3 | 0 |
| `move` | 18 | 12 | 0.60 | 0.80 | 0.82 | 3 | 3 | 0 |
| `handout` | 9 | 0 | 0.74 | 0.77 | 0.80 | 0 | 0 | 0 |
| `damage` | 6 | 6 | 0.73 | 0.78 | 0.78 | 5 | 0 | 0 |
| `cash`, `item`, `object` (not clearable) | 12 | 9 | 0.24 | | 0.46 | 0 | 0 | 0 |
| `note`, `define`, `flag` | 9 | 9 | 0.45 | | 0.63 | 0 | 0 | 0 |

At 0.87: 10 of 207 clearable line-runs (4.8%), in three batches only: gate #1 turn 13's two `clue` lines (typed `not_player_action` 0.88–0.95, 3 of 3 runs), gate #2 turn 12's `time` line (0.93–0.94, 3 of 3) and gate #1 turn 11's `time` line (0.87, 1 of 3).

**The lane on one line alone** (2 runs, uncapped): `threat` p50 3.0 s (max 4.8), `time` 3.3 (7.6), `move` 3.3 (p90 14.5, max 22.7), `person` 3.7 (p90 9.3, max 16.4), `clue` 3.7 (8.3), `handout` 3.8; all 148 line rounds p50 3.4 s. Per-line verdicts: every `threat` line alone `not_player_action` (18/18); `person` 2 of 20 `not_authorized`; `move` 1 of 12.

**The lane on whole batches** (3 runs, uncapped), 75 rounds: p50 4.0 s, p90 9.5 s, max 38.8 s; 6 over 13 s, 3 over 26 s.

| batches | rounds | p50 | p90 | max | > 13 s |
| --- | --- | --- | --- | --- | --- |
| 1–2 lines | 30 | 3.2 s | 6.5 s | 10.5 s | 0 |
| 3 lines | 21 | 4.0 s | 23.4 s | 38.8 s | 3 |
| 4+ lines | 24 | 4.4 s | 11.9 s | 36.7 s | 3 |
| carrying a `threat` line | 27 | 3.7 s | 6.4 s | 10.5 s | 0 |
| carrying a `person` line | 21 | 6.5 s | 34.9 s | 38.8 s | 6 |
| carrying neither | 27 | 3.1 s | 6.6 s | 6.9 s | 0 |

Every round over 13 s carried a `person` line; 4 of the 6 also a `move` (gate #1 turns 6 and 7, gate #1 turn 1, gate #2 turn 6). Gate #2 turn 14 (`threat`, `time`): 6.0, 4.5, 10.5 s. Gate #2 turn 6 (`person`, `time`, `clue`): 23.4, 4.7, 7.0 s.

**Per-line agreement.** No line the typed reviewer admitted at or above any threshold from 0.50 to 0.87 was refused by the lane on its own (0 of 103 line-runs at 0.50, 0 of 55 at 0.70, 0 of 10 at 0.87). The corpus is small: SL-10's bank has only batch labels, and of its 418 `time` lines typed admitting at 0.70 or above, 38 sat in a batch the lane refused (which line it refused is not recorded).

**Scoring the predictions.**
1. **Held.** 4.8% of line-runs clear at 0.87 (predicted at most 15%). Gate #2 turn 14: its `time` line 0.71 / 0.75 / 0.68, its `threat` line 0.55–0.65: neither clears in any run. Turn 6: its best line 0.72–0.75, none clears.
2. **Held.** Every kind's single-line median is 3.0–3.8 s; `threat` (3.0) and `person` (3.7) are within 0.4 s of `time` (3.3) and `clue` (3.7). What is slow is the batch with a `person` line in it, not the line.
3. **Half.** Turn 14 did not pass 13 s in any of 3 runs (predicted at least 1): its live 13 s and 26 s were the provider's tail. Turn 6 passed 10 s once (23.4 s), as predicted.
4. **Held, narrowly.** Batches of 4+ lines p50 4.4 s against 3.2 s for 1–2 lines (+1.2 s).
5. **Held.** 0 of 10 lines cleared at 0.87 refused by the lane alone.

**Decisions.**
- *The line threshold* stays the fast-path confidence, 0.87, as ruled. On the two turns that motivated the ruling it fires on no line, so **line-level admission as ruled changes nothing on long gate #2's turns 6 and 14**. It fires where the typed reviewer is sure of a line (gate #1 turn 13, gate #2 turn 12), and there no cleared line was one the lane refused.
- *The remainder* is reviewed by a fresh lane round on its own lines (the pre-registered rule: single lines p50 3.4 s against whole batches 4.0 s, not slower).
- For the owner, not decided here: at 0.70 the same corpus clears 55 line-runs, including turn 14's `time` line in 2 of 3 runs and turn 6's `time` line in 3 of 3, with no lane-alone refusal among them; the evidence for going that low is this 25-batch corpus only (a per-line lane label over SL-10's refused batches would be the measurement). The slowness is where a `person` line sits beside a `move` or others; the `threat` line is not slow.
