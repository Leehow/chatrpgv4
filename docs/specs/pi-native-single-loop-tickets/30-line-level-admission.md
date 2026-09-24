Status: ready-for-human
Stage: SL-30 (P1; amends SL-24)
Spec: docs/specs/pi-native-single-loop.md (Ruling: "A batch is admitted line by line")
Contract: docs/kernel-rpc.md §32.12.3 (amends §32.1, §32.10, §32.11, §32.12.2)

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
- For the owner, not decided here: at 0.70 the same corpus clears 55 line-runs, including turn 14's `time` line in 2 of 3 runs and turn 6's `time` line in both runs Jev answered, with no lane-alone refusal among them; the evidence for going that low is this 25-batch corpus only (a per-line lane label over SL-10's refused batches would be the measurement). The slowness is where a `person` line sits beside a `move` or others; the `threat` line is not slow.

### 2026-09-24 — replay pre-registration (before any replay run)

Fixtures `longgate30-t6` and `longgate30-t14`, built by `gate-fixture.mjs` from long gate #2 (read only; commit `b321fd185`). Recorded Keeper, live Jev, the live lane (`opencode-go/deepseek-v4.1-flash`, `low`), seed 1, 3 runs each; a `review_pending` refusal, or a result whose `admission.not_landed` is `review_pending`, is resent once at once (the whole call, which the host narrows to what did not land).

- **Product arm** (`run.mjs --fixture longgate30-tN --runs 3 --llm replay --lane live --seed 1`; the line threshold is 0.87):
  - turn 14: no line clears in any run (its `time` line typed at most 0.75 in measurement 2), so the Keeper's `threat` + `time` batch is reviewed whole; the lane admits it before the 13 s cap in at least 2 of 3 runs, and the `time` receipt lands in 3 of 3 (a run past the cap through its resend);
  - turn 6: no line clears; the Keeper's `person` + `time` + `clue` batch is admitted by the lane in at least 2 of 3 runs.
  - So the ticket's acceptance ("the plain lines land at once") is **not expected to be met** in this arm: the measurement says the typed reviewer never reaches 0.87 on these lines.
- **Exploratory arm** (`--fast-min 0.70`: the fast path and the line threshold at 0.70; not the product setting):
  - turn 14: the `time` line clears in at least 2 of 3 runs; in those runs the `threat` line left is not reviewed and the batch lands whole within 2 s of its review start, with no lane round;
  - turn 6: the `time` line clears in the runs where Jev answers; the `person` + `clue` remainder goes to the lane alone and the batch lands whole in at least 2 of 3 runs.

### 2026-09-24 — implemented, tested, replayed (branch `claude/sl30-20260924`, merged with the integration branch at `b8aced229`)

**Commits.** `b321fd185` measurement 1 and pre-registration; `8050a51b4` measurement 2 and contract §32.12.3; `c31c7ef37` replay pre-registration and the replay's two additions; `0086d8a8e` the implementation and tests; `deb53c8ab` merge of `claude/integ-single-loop-20260923` at `b8aced229` (SL-32; clean, no admission code); `17f8beee8` every line's typed confidence on the row, and the replays; the commit carrying this comment.

**Where each piece lives.**
- `extensions/kernel/admission.ts`: `lineClearable`, `clearedLines` (pure), `remainderAttempt` (the batch's typed answer on the lines left), `effectSignature` (the §32.4 key fields of one effect, now shared by `admissionRequest`); `reviewAdmissionPrimary` gains `lineLevel`, `typedAttempt`, `startedAt`, `hardCapMs` and the `ok: "split"` outcome; the typed meta gains `line_confidences`.
- `extensions/kernel/index.ts`: `admitAction` is now one `admitOne(proposal, part?)` (reuse, compile, kept pending, review, late/pending/outage/verdict, unchanged) run for the batch and, after a split, for the remainder; it narrows `payload.effects` when the remainder does not land and returns an `AdmissionPartial`; `partialAdmissionResult` puts `admission` and the `note` on the result, keeps `state.admissionSplit` for a whole-batch resend, and sets §78's flag; a kernel refusal of a narrowed batch carries `details.admission`.
- `experiments/single-loop-routing/product-entry.ts`: `--fast-min` (an exploratory arm), a replayed Keeper resends a partly landed batch whose rest is pending, and the summary carries `line_level`, `lines`, `line_confidences`.

**Tests.** New `tests/extension/admission-line-level.test.mjs`, 13 tests: `lineClearable`; `clearedLines` (0.87 at the threshold, 0.869 not, refusing lines, non-clearable kinds, fast path off, a resolve, mismatched lines, no typed lines); `remainderAttempt`; turn 14's shape (the threat left unreviewed, one call in the batch's order, no rest round) on the fake kernel and on the emitted kernel with its `time` and `threat` receipts; nothing cleared at 0.86; fast path off; the rest reviewed alone with the cleared line shown as admitted in this call and no second typed call; a rest the lane refuses (the cleared line alone lands; `admission.landed`, `admission.not_landed` with `action_not_authorized` and its `missing`, the note, the text the Keeper reads); a rest past the cap returned pending alone, at the batch's cap measured from the review's start, and collected by its own resend; a whole-batch resend applying only what did not land (`admission.already_landed`); the kernel refusing a narrowed batch (its refusal carries `details.admission`); §78 for a delivery behind a partial landing. The lane steps read their request, so which round the aborted batch round consumed does not decide a test. Updated in `admission-fast-path.test.mjs`: the typed-refusal test and the `item` test now assert the split (the confident line admitted at once, the refused or non-clearable line decided by the lane alone).

**Mutations** (each applied in place, `admission-line-level`, `admission-fast-path` and `admission-late` run, the file restored). 16 of 16 killed; M10 survived the first round (the pending row's `ms` was measured from the remainder's own start either way) and was killed after the test also bounded the call's own `ms`.

| mutation | file | failing |
| --- | --- | --- |
| M1 the line threshold exclusive | admission.ts | 1 |
| M2 every kind clearable | admission.ts | 3 |
| M3 a refusing line clears | admission.ts | 2 |
| M4 no split | admission.ts | 9 |
| M5 a remainder with no triggering kind is reviewed | index.ts | 2 |
| M6 the remainder reviewed with the whole batch's lines | index.ts | 6 |
| M7 the cleared lines not shown to the remainder's reviewer | index.ts | 1 |
| M8 a new typed call for the remainder | index.ts | 7 |
| M9 the batch not narrowed when the remainder fails | index.ts | 5 |
| M10 the remainder's cap measured from the split | index.ts | 1 (after the fix) |
| M11 no split record for a whole-batch resend | index.ts | 1 |
| M12 no §78 flag on a partial landing | index.ts | 1 |
| M13 the result says nothing of the partial landing | index.ts | 4 |
| M14 a kernel refusal of the narrowed batch drops the held-back part | index.ts | 1 |
| M15 the batch narrowed even when the remainder is admitted | index.ts | 2 |
| M16 line level only on bookkeeping batches | admission.ts | 1 |

Not covered by a test: the whole batch's key keeping the remainder's admitting verdict for the turn; a remainder admitted late (`typed_late`) inside a split.

**Replays** (as pre-registered; `results/sl30-longgate30-t14`, `-t6`, `-fast070`, and `-fast070-lines`, which re-ran the exploratory arm once `line_confidences` was on the row; the four arms of the first round ran concurrently, one run at a time within each).

*Product arm (0.87).* No line cleared in any run: every Keeper batch was reviewed whole by the lane, and every one landed.
- Turn 14 (`threat`, `time`): the lane in 3.3, 4.4 and 12.9 s (`not_player_action` ×3); the `time:t14-c3` receipt landed 3 of 3, all before the cap. As predicted.
- Turn 6 (`person`, `time`, `clue`): the lane in 9.9, 7.3 and 8.7 s; the `vittorio-bible-weapon` clue and the person landed 3 of 3. The clerk's move was admitted by the compile at 0 ms each time. As predicted.
- The ticket's acceptance ("the plain lines land at once") is **not met**, as the pre-registration said it would not be: the typed reviewer does not reach 0.87 on those lines.

*Exploratory arm (0.70; not the product setting).* **Missed**: no line cleared in any of 12 runs either. The rows of the re-run give why: in the product's own context the `time` line types at 0.48–0.60 on turn 14 and 0.55–0.61 on turn 6 (and turn 6's `clue` line is typed `not_authorized` 0.70–0.76), lower than the offline bank's 0.68–0.75. The bank's reconstruction omits the setup prologue; with the real context the typed reviewer is less sure of these lines, not more. Every batch was again admitted by the lane (4.0–9.9 s).

**Suites** (leehow-pc):
- `ext on leehow-pc @ 17f8beee8da5ad909d9f4952d9036f91a0d98055: exit=0 wall=205s` (2955/2955); also at `deb53c8ab`, 2955/2955.
- `loop on leehow-pc @ 17f8beee8da5ad909d9f4952d9036f91a0d98055: exit=0 wall=100s` (149/149).
- pytest was not run: nothing the kernel reads changed (`kernel-ts/`, `content/`, `tests/kernel`, `tests/play` untouched).

**What this means, and what is open.**
- Line-level admission works as ruled and is proven at the seam, but on the long tables it fires rarely (4.8% of line-runs offline, 0 of 6 Keeper batches in the replays), and never on the turns that motivated it. The ruling's premise ("the typed reviewer clears the plain lines") holds for latency, not for confidence.
- What made turn 14 slow live was the provider's tail: the same batch answers in 3.3–12.9 s now. What is slow repeatably is a batch with a `person` line beside a `move` or others (every lane round over 13 s in measurement 2), not a `threat` line.
- For the owner: a lower line threshold would not have helped either (0.70 cleared nothing in the product context). Levers that would: the typed family's calibration on these lines in the real context, or putting the `person` line's staging outside the lane's batch (it is a non-triggering kind, §32.1). Neither is decided here.
- `kpi.py` does not yet group `line_level` rows. No live table.

### 2026-09-24 — the owner's amendment: lines no reviewer reads are not sent to the lane

**Ruling (owner, via the coordinator, 2026-09-24).** Of the two levers in the previous comment, the second, made structural: an `apply` effect of a kind §32.1 never reviews on its own (`person`, `threat`, `npc`, `flag`, `note`, `define`, `damage` and the rest of that class; also a scene rename and an `object` adoption, which §32.1's predicate already exempts) is removed from the lines the lane sees and lands with the batch on the same call. The lane reviews only `move`, `clue`, `handout`, `time`, `cash`, `item`, `object`, `usage`, `map`; `resolve` unchanged. The line-level machinery stays. No recalibration of the typed family here.

**Implementation** (`785487730`):
- `admissionRequest` (`extensions/kernel/admission.ts`) builds an `apply` proposal's lines and kinds from the reviewed effects only, with `proposal.effects` mapping each line to its effect; the key is still the whole batch's (§32.4). The typed reviewer reads the same lines (§32.10: both reviewers read one proposal).
- `admitAction` (`extensions/kernel/index.ts`) maps line indices through `proposal.effects`. When a split's rest does not land, the call lands the cleared lines **and** the unreviewed effects (`landing`), in the batch's order, and the whole-batch resend record covers all of them. A refusal of the reviewed lines refuses the call as before: nothing lands.
- Contract §32.12.3 amended with the rule and its reason: batches with a `person` line had lane p90 34.9 s against 6.6 s for batches with neither, all 6 rounds over 13 s carried one, and every `threat` line alone was `not_player_action` (18/18).

**Tests** (`admission-line-level.test.mjs`, now 16): turn 14's `threat` + `time`, where the lane and the typed reviewer read only the `time` line, and both land, on the fake and the emitted kernel (with `time:` and `threat:` receipts); a `person` + `move` batch where the lane sees only the move and the person lands; a lane refusal of the reviewed lines lands nothing; a split whose rest is refused lands the cleared and the unreviewed lines. The earlier tests that used `threat` as the clearable line now use `time` + `clue`.

**Mutations** (all 18 rerun on the amended tree):
- M17 (unreviewed lines sent to the reviewers again) is killed by 4 tests. M18 (unreviewed lines held back with a refused rest) is killed by 1.
- M1–M4 and M6–M16 are still killed.
- M5 (a rest with no triggering kind is reviewed anyway) now survives. It is an equivalent mutant: since the amendment, a rest holds only reviewed lines, so the unreviewed-rest guard it mutates cannot be reached. The guard stays, with a comment saying so.

**Replays** (merged tree `505b6a9e3`, integration at `9ab3e753f` with SL-31; `results/sl30-amended-longgate30-t14`, `-t6`; recorded Keeper, live Jev, live lane, seed 1, 3 runs each). Every baseline row matched in 6 of 6 runs.

| turn | the lane read | lane rounds | before the amendment (same arm, `results/sl30-longgate30-*`) |
| --- | --- | --- | --- |
| 14 | `apply time` only | 6.9, 3.7, 6.8 s | 3.3, 4.4, 12.9 s (`threat` + `time`) |
| 6 | `apply time`, `apply clue` | 6.0, 7.0, 5.8 s | 9.9, 7.3, 8.7 s (`person` + `time` + `clue`) |

What landed:
- turn 14: the move (compile), the STR roll, `threat corbitt-haunting`, and the `time` receipt (`time:t14-c3` or `-c4`);
- turn 6: the move (compile), the first-impression roll, `person Vittorio Macario`, `time 40`, and `clue vittorio-bible-weapon`.

The coordinator's expectation was every lane round under about 5 s. That is **not met**: only 1 of 6 rounds came in under 5 s, and the rest took 5.8–7.0 s. Turn 6's median fell from 8.7 to 6.0 s. Turn 14's did not fall (6.8 against 4.4 s), with n = 3 each. The typed confidence on the `time` line alone is 0.51–0.65, so nothing cleared on the line path either.
