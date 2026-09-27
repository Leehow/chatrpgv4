# SL-97 phase 2a: a role-first typed admission question, measured offline

Ticket: `docs/specs/pi-native-single-loop-tickets/97-jev-admission-confident-enough-to-settle.md`. Contract: `docs/kernel-rpc.md`
§32.2, §32.3, §32.10, §32.11, §32.12.3. No product code changed. Everything here is experiment code under
`experiments/admission-jev-bank/` and its outputs. The decisions were fixed in advance in `preregistration.md`, and its
addendum was written before iteration 3.

## Answer first

- **The redesign moves the typed reviewer a long way, but not far enough for the pre-registered bar. No settle threshold is
  recommended.**
- On data the design never saw (the iteration-3 holdout), the best candidate, 2a.3, at T=0.87 would settle about 29% of
  `time` batches. Of those settled admits, 2.3% are ones the lane refused (upper bound 7.1%), at the class's own refusal
  rate.
- The bar is 1.8%: of one lane run's admits, the share another run of the same lane refused. `move` and `clue` are
  further off.
- **The biggest single limit is the labels, not the question.**
  - 310 of the 390 main-sample cases and 307 of the 330 holdout cases are persona-bench runs from 2026-09-11/12.
  - They were labelled mostly by grok-4.6 (529 of 617; the rest deepseek-v4-flash) under the lane prompt of that day. That
    prompt predates the 09-15 "a part of a registered place is that place" amendment and the 09-21/23 "agency precedes
    consent" clarification.
  - Reading the confident false admits, most are refusals the current policy would not make, for example
    「那我先看半开的那扇门。」 ("then I'll look at the half-open door first") → 5 minutes opening that door, refused.
  - On real-table labels (70 cases in the main sample) no revision makes a confident false admit. But that subset has
    only 6 lane refusals, so it bounds nothing.
- **The cheapest next step needs no Jev call.**
  - Every typed answer is stored with full distributions.
  - Relabel the 720 replayed cases with the current lane, two runs each (lane calls, not Jev).
  - Then re-score all four revisions offline with `sl97b-analyze.mjs`. That also gives the same-case lane floor.

## What was replayed

- **Main sample** = phase 1's sample (`--per-class 90 --seed 1` over phase 1's 5 362-case bank), minus the 90 cases
  whose lane gave no verdict, plus every case of gate #23's table (`longgate23-haunting-1350`, 30 cases, 19 new).
  - That is 390 cases. 20 are `cash` batches, which are lane-only by §32.10 and make no call. 370 are typed.
  - 361 carry a lane verdict. 9 are `review_pending`, which is not a label and is reported apart.
  - The masks table built from the same commit (`masks-1350`) has no `telemetry.jsonl`, so it has no admission rows
    to pair (`bank-g23-stats.json`).
- **Holdout** (iteration 3B, `holdout-ids.txt`): 330 cases disjoint from phase 1's 461-case sample and from the 19
  gate-#23 extras.
  - Only lane-labelled `apply` batches, no `cash`, of the three fast-path classes.
  - Per class, 50 lane refusals and 60 lane admits (`sl97b-holdout.mjs`, seed 2).
- **Live calls: 1 895 in total**, each counted from the adapter's HTTP-attempt trace. Nothing failed and nothing
  fell back.

| iteration | what | calls |
| --- | --- | --- |
| 1 | v1 re-run (412) + 2a.1 (371) | 783 |
| 2 | 2a.2 | 378 |
| 3 | 2a.3 on the main sample (380) + 2a.3 on the holdout (354) | 734 |

## The design

Phase 1 found two structural causes of low confidence in the §32.10 family:
- **Half the low-confidence lines were the world's response.** An NPC's answer or a manifestation was judged as if the
  player had to choose it.
- **Admitting mass was split.** Three of the five verdicts admit, but the batch read only the top option's 5-way
  confidence, so an answer split 0.45 `authorized` / 0.35 `entailed` scored about 0.31 while P(admit) was 0.9.

**Shape: roles first, one question per judgment, host arithmetic** (`admission-roles.ts`).
- The family follows the lane's own order ("agency precedes consent", §32.2) and the Jev skill's guidance:
  - decompose into atomic questions;
  - fan them out over one state;
  - keep facts in state and judgments in questions;
  - sum the admitting options;
  - combine in code with the weakest judgment winning (the function-calling cookbook).
- Per proposed line, all questions go in one request, independent of each other and over one state:
  - `role_i`: who acts in this line.
    - `investigator_act`: going, searching, taking, persuading, paying, rolling for such an attempt.
    - `world_response`: a person's reply, handover or initiative; what a search turns up; something done to the
      investigator; a roll the rules impose; a consequence.
    - `time_passing`.
  - `choice_i`, read as the investigator's act: `chosen` | `routine_step` | `keeper_choice` | `unclear`.
  - `result_i`, read as the world's response: `answers_player` | `world_on_its_own` | `needs_unchosen_act` | `unclear`.
  - `span_i`, read as time: `activity_time` | `imposed_time` | `unchosen_time` | `unclear`.
  - `target_i` (2a.2 on): whom or what the act is aimed at, and whether the player's words addressed it:
    `addressed` | `no_target` | `not_addressed`.
  - `gate_i` (2a.2 on): whether the line gets past a gatekeeper, refusal, locked way, price or danger that the player's
    words did not take on: `no_obstacle` | `player_takes_it_on` | `skips_obstacle`.
  - `order_i` (2a.3): whether the line gets ahead of a step ("first … then …") or a condition ("if …") the player set:
    `in_step` | `ahead_of_plan`.
  - `missing_i` and `basis_i`: §32.10's refusal-text questions, unchanged.
- The host combines them. A(q) is the summed probability of question q's admitting options, a closed membership:
  - `P_admit_i = min( P(act)·min(A(choice), A(target)) + P(world)·A(result) + P(time)·A(span), A(gate), A(order) )`
  - Line confidence = |2·P_admit − 1|, the TypeSafe Choice confidence with n = 2. The batch confidence is the minimum
    over lines, as in §32.10.
  - The lane-shaped label (authorized / entailed / not_player_action / not_authorized / uncertain) comes from the
    dominant role, and is used only for telemetry and exact agreement.
- **§32.3 packing.**
  - Same input and same windows as the lane.
  - The newest delivery is split out as `justTold`: what the player is answering.
  - Each proposal line carries its closed `kind`, parsed from the host's own line grammar.
  - The 10-rule list is gone from state. Policy lives in each question's criteria, and state carries a field legend
    that says every why/how/goal/method/stakes/via/label field is the Keeper's own text.
  - All lines share one request while they fit the packing bound: 371–380 calls against v1's 412.
- **Ablation, at no extra call.** `single_i` is one collapsed 5-option Choice with role-aware criteria. Also `v1-sum`:
  v1's own stored distribution with its three admitting verdicts summed.
- **No semantic lists.** Jev answers every semantic question. The host packs, parses the closed effect kind, sums and
  gates.

Why each revision changed:
- **2a.1 → 2a.2.**
  - On lane-refused `resolve` lines, Jev put its mass on `routine_step` (0.46), not `keeper_choice`. A Keeper-staged
    social roll with a clerk the player never addressed read as a routine step.
  - `routine_step` was narrowed, and `target` and `gate` were added.
  - `time` lines were weakly separated (fits 0.76 on admitted vs 0.68 on refused lines), so `span` and `result` got two
    admitting readings.
- **2a.2 → 2a.3.** Of the 10 confident false admits left, most were the Keeper jumping to a later step of a plan the
  player ordered, or acting on a condition the player set, plus one skill swap (the player named Credit Rating and the
  Keeper rolled Charm).

## Results per iteration (main sample; holdout last)

"Same admission" means typed admit/refuse = lane admit/refuse. A false admit is a typed-settled admit the lane refused.

FA share has three readings:
- over the settled admits of the stratified sample;
- reweighted to the bank's own lane-label mix;
- per class, at the class's own bank refusal rate: r·a/(r·a+(1−r)·b), with a = P(settle | lane refused) and
  b = P(settle | lane admitted). The Wilson bound on each gives the upper figure.

### Iteration 1: v1 re-run vs 2a.1 (783 calls)

| | v1 (phase 1 as stored) | v1 re-run | v1 re-run, admit mass summed | 2a.1 | 2a.1 single-choice ablation |
| --- | --- | --- | --- | --- | --- |
| confidence median | 0.45 | 0.45 | 0.70 | 0.68 | 0.84 |
| same admission, lane `authorized` | 72/83 | 76/90 | 77/90 | 84/90 | 88/90 |
| … `entailed` | 70/86 | 79/96 | 83/96 | 84/96 | 91/96 |
| … `not_player_action` | 34/85 (40%) | 34/86 (40%) | 39/86 | **57/86 (66%)** | 63/86 |
| … `not_authorized` | 17/86 | 18/87 | 13/87 | 16/87 | 9/87 |
| exact agreement, T=0 | 42.4% | 41.8% | – | 54.0% | – |
| admit/refuse agreement, T=0 | 56.7% | 57.6% | 59.0% | 66.8% | 69.5% |
| T=0.87: settled admits / false admits / false refusals | 1 / 0 / 1 | 3 / 0 / 1 | 121 / 19 / 1 | 92 / 29 / 5 | 161 / 34 / 0 |
| T=0.87: FA share (sample / bank mix) | 0 / 0 | 0 / 0 | 15.7% / 6.5% | 31.5% / 9.4% | 21.1% / 8.5% |
| latency p50 / p90 (ms) | 386 / 592 | 411 / 543 | same call | 354 / 414 | same call |

The full threshold sweep for 2a.1 (and for every arm) is in `analysis-main.md`:

| T | decided (coverage) | exact | admit/refuse | false admits | false refusals | settled admits | FA share, sample / bank mix |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0.5 | 239 (66.2%) | 57.7% | 66.5% | 64 | 16 | 220 | 29.1% / 13.6% |
| 0.6 | 218 (60.4%) | 58.7% | 66.5% | 61 | 12 | 204 | 29.9% / 13.6% |
| 0.7 | 172 (47.6%) | 56.4% | 64.5% | 54 | 7 | 165 | 32.7% / 13.8% |
| 0.8 | 118 (32.7%) | 61.9% | 67.8% | 33 | 5 | 113 | 29.2% / 9.9% |
| 0.85 | 103 (28.5%) | 62.1% | 66.0% | 30 | 5 | 98 | 30.6% / 9.4% |
| 0.87 | 97 (26.9%) | 60.8% | 65.0% | 29 | 5 | 92 | 31.5% / 9.4% |
| 0.9 | 82 (22.7%) | 62.2% | 67.1% | 23 | 4 | 78 | 29.5% / 8.3% |
| 0.95 | 53 (14.7%) | 75.5% | 81.1% | 7 | 3 | 50 | 14.0% / 3.3% |

What iteration 1 showed:
- **The role split fixes the world-response problem.** Lane `not_player_action` agreement went from 40% to 66%, and
  role answers are crisp (median top role probability 0.95–1.0).
- **Summing the admitting labels alone recovers most of the confidence.** v1-sum's median is 0.70.
- **But both are confidently wrong on the same things.** `resolve` lines where the Keeper stages a roll the player did
  not ask for, and `move` lines.

### Iteration 2: 2a.2 (378 calls)

| T | decided (coverage) | exact | admit/refuse | false admits | false refusals | settled admits | FA share, sample / bank mix |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | 361 (100.0%) | 54.6% | 71.2% | 66 | 38 | 300 | 22.0% / 12.1% |
| 0.5 | 235 (65.1%) | 65.5% | 81.7% | 36 | 7 | 222 | 16.2% / 8.2% |
| 0.6 | 209 (57.9%) | 67.9% | 84.2% | 29 | 4 | 202 | 14.4% / 7.1% |
| 0.7 | 188 (52.1%) | 68.6% | 84.0% | 26 | 4 | 184 | 14.1% / 6.6% |
| 0.8 | 151 (41.8%) | 70.9% | 84.1% | 20 | 4 | 147 | 13.6% / 6.3% |
| 0.85 | 132 (36.6%) | 72.0% | 85.6% | 15 | 4 | 128 | 11.7% / 5.3% |
| 0.87 | 108 (29.9%) | 74.1% | 87.0% | 10 | 4 | 104 | 9.6% / 4.4% |
| 0.9 | 80 (22.2%) | 77.5% | 88.8% | 5 | 4 | 76 | 6.6% / 3.2% |
| 0.95 | 31 (8.6%) | 87.1% | 93.5% | 1 | 1 | 30 | 3.3% / 2.4% |

- Same admission per lane label: `authorized` 80/90, `entailed` 88/96, `not_player_action` 66/86 (77%),
  `not_authorized` 22/87, `uncertain` 1/2.
- Confidence median 0.72. Latency p50 372 ms, p90 449 ms.
- 2a.2 dominates v1-sum on this sample: 76 settled admits at 3.2% bank-mix FA (T=0.9), against v1-sum's 55 at 5.8%
  (T=0.95).

Per class (settled admits / false admits, class-natural FA share with its upper bound):

| class (bank refusal rate) | T=0.8 | T=0.85 | T=0.87 | T=0.9 | T=0.95 |
| --- | --- | --- | --- | --- | --- |
| time (6.7%) | 65/3, 4.2% (<= 7.6%) | 59/2, 3.1% (<= 7.3%) | 54/2, 3.4% (<= 8.1%) | 46/1, 2.0% (<= 7.8%) | 26/1, 3.5% (<= 14.8%) |
| move (15.0%) | 15/5, 8.5% (<= 22.0%) | 12/3, 5.8% (<= 20.2%) | 8/1, 2.6% (<= 19.1%) | 3/0, 0.0% (<= 35.9%) | 0/0 |
| clue (12.7%) | 21/1, 8.5% (<= 34.4%) | 16/1, 11.0% (<= 42.9%) | 10/1, 17.1% (<= 59.2%) | 3/0, 0.0% (<= 82.4%) | 0/0 |
| resolve (16.9%) | 45/11, 7.4% (<= 14.4%) | 40/9, 6.7% (<= 14.2%) | 31/6, 5.6% (<= 14.3%) | 23/4, 5.0% (<= 15.6%) | 4/0, 0.0% (<= 36.2%) |

### Iteration 3A: 2a.3 on the main sample (380 calls)

| T | decided (coverage) | exact | admit/refuse | false admits | false refusals | settled admits | FA share, sample / bank mix |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | 361 (100.0%) | 55.1% | 68.4% | 51 | 63 | 260 | 19.6% / 10.1% |
| 0.5 | 202 (56.0%) | 66.8% | 82.7% | 21 | 14 | 174 | 12.1% / 5.7% |
| 0.6 | 172 (47.6%) | 71.5% | 86.6% | 15 | 8 | 152 | 9.9% / 4.5% |
| 0.7 | 131 (36.3%) | 73.3% | 88.5% | 10 | 5 | 119 | 8.4% / 3.5% |
| 0.8 | 92 (25.5%) | 75.0% | 88.0% | 6 | 5 | 84 | 7.1% / 2.9% |
| 0.85 | 63 (17.4%) | 76.2% | 92.1% | 0 | 5 | 56 | 0.0% / 0.0% |
| 0.87 | 49 (13.6%) | 73.5% | 89.8% | 0 | 5 | 42 | 0.0% / 0.0% |
| 0.9 | 33 (9.1%) | 78.8% | 87.9% | 0 | 4 | 28 | 0.0% / 0.0% |
| 0.95 | 12 (3.3%) | 75.0% | 83.3% | 0 | 2 | 10 | 0.0% / 0.0% |

- Same admission per lane label: `authorized` 76/90, `entailed` 78/96, `not_player_action` 55/86, `not_authorized`
  37/87 (43%, the best of any arm), `uncertain` 1/2.
- Confidence median 0.58. Latency p50 389 ms, p90 501 ms.
- The pre-registered choice rule (T=0.9, fast-path classes, settled − 55 × false admits) picked 2a.3 (20) over 2a.2 (−3)
  for the holdout.

### Iteration 3B: 2a.3 on the holdout (354 calls; the pre-registered measurement)

| T | decided (coverage) | admit/refuse | false admits | false refusals | settled admits | FA share, sample / bank mix |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | 330 (100.0%) | 66.7% | 78 | 32 | 226 | 34.5% / 9.5% |
| 0.5 | 173 (52.4%) | 71.7% | 45 | 4 | 148 | 30.4% / 8.2% |
| 0.6 | 148 (44.9%) | 72.3% | 38 | 3 | 128 | 29.7% / 8.1% |
| 0.7 | 113 (34.2%) | 74.3% | 28 | 1 | 97 | 28.9% / 8.1% |
| 0.8 | 69 (20.9%) | 78.3% | 14 | 1 | 61 | 22.9% / 6.3% |
| 0.85 | 42 (12.7%) | 78.6% | 9 | 0 | 38 | 23.7% / 6.7% |
| 0.87 | 34 (10.3%) | 79.4% | 7 | 0 | 30 | 23.3% / 6.6% |
| 0.9 | 26 (7.9%) | 80.8% | 5 | 0 | 23 | 21.7% / 5.8% |
| 0.95 | 5 (1.5%) | 80.0% | 1 | 0 | 4 | 25.0% / 7.6% |

The holdout is stratified 50 refusals / 60 admits per class, so the sample share overstates. The per-class natural share
is the fair figure:

| class (bank refusal rate) | T=0.8 | T=0.85 | T=0.87 | T=0.9 | T=0.95 |
| --- | --- | --- | --- | --- | --- |
| time (6.7%) | 43/12, 3.2% (<= 6.3%) | 29/7, 2.6% (<= 6.8%) | 23/5, 2.3% (<= 7.1%) | 18/4, 2.4% (<= 8.5%) | 3/1, 4.1% (<= 44.9%) |
| move (15.0%) | 15/2, 3.1% (<= 15.3%) | 8/2, 6.6% (<= 33.7%) | 6/2, 9.6% (<= 47.4%) | 4/1, 6.6% (<= 51.8%) | 1/0 |
| clue (12.7%) | 3/0, 0.0% (<= 37.7%) | 1/0 | 1/0 | 1/0 | 0/0 |

- Confidence median 0.53. Latency p50 407 ms, p90 602 ms.
- Same admission per lane label: `authorized` 100/126, `entailed` 45/48, `not_player_action` 3/6, `not_authorized`
  72/150.
- Two post-hoc re-readings of the same stored answers are in `analysis-holdout.md`, labelled exploratory: `order`
  dropped, and `order` on acts only. Both are worse than 2a.3 as registered (time at T=0.87: 4.6% and 4.3%), so the
  `order` question carries real signal on `time` lines too.

### The gate #23 cases (the ticket's own table)

- All 30 are in the main sample. The six stalls (`review_pending`: t2, t5, t8, t13, t15, t20) have no lane label.
- No revision settles any of them at 0.87. The best is t13's `time, clue, clue` at 0.85 (2a.3) and 0.79 (2a.2).
- t2's handout + time: 2a.2 refuses it at 0.39 and the single-choice ablation admits it at 0.50. The typed reviewer is
  as unsure as the lane was.
- #23's plain `time` lines t6, t10, t12 and t16 settle at 0.87–1.0 under 2a.2; t20's two sit at 0.72–0.77. That is the
  class where the latency win would be.

## The lane's own disagreement floor

Computed from every retained re-run of the lane on the same case: SL-24, SL-30, SL-39 latency and SL-39 alternatives
(`sl97b-analyze.mjs laneFloor`).

| pairs | ordered pairs | admit/refuse flip | of B's admits, share A refused | of A's refusals, share B admitted |
| --- | --- | --- | --- | --- |
| same model, repeated (pooled) | 1 640 | 3.2% | **1.8%** | 12.6% |
| cross model (SL-39: grok-4.7-build-fast, deepseek-v4.1-flash, qwen3.8-flash, grok-4.6) | 4 342 | 11.3% | 6.7% | 35.3% |

- Per model: deepseek-v4.1-flash 0.7–3.0%, grok-4.6 0.9%, grok-4.7-build-fast 4.7%.
- The exact-label self-agreement of the lane across re-runs is only 75% (SL-24), so exact agreement with the lane is
  capped well below 100% for any reviewer.

## Recommendation

- **No threshold is recommended.** The pre-registered rule asks for ≤ 1.8% with at least 10 settled admits on the
  holdout. No class meets it:
  - `time` is 2.3–2.6% at T 0.85–0.9, between the same-model floor and the cross-model floor;
  - `move` is 6.6–9.6%;
  - `clue` settles at most one batch.
- **What the numbers leave to the owner.** The typed reviewer is a different model, so the cross-model floor (6.7%) is
  arguably the fair comparison. On it, 2a.3 at T=0.85–0.87 would qualify for `time` on its point estimate, with its
  upper bound (6.8–7.1%) at the edge. That is not claimed here: the rule fixed in advance says 1.8%.
- **Before any product change (phase 2b)**, the measurement needs labels made under today's policy:
  - Relabel the 720 replayed cases (`it*-v2-*.jsonl` ids and `holdout-ids.txt`) with the product lane.
  - Use the current prompt and the owner's lane model, two runs per case.
  - Re-score the stored typed answers with `sl97b-analyze.mjs`. No Jev call is needed.
  - Closing `build.mjs`'s `registered_destination_omitted` gap (1 055 bank cases) would matter for the `move` class in
    that relabelling.

## Caveats

- **Label drift.** The same point as "Answer first", measured:
  - The false admits sit in the persona-bench labels. On real-table labels (70 cases, 6 refusals), every revision has 0
    confident false admits.
  - Of the holdout's 9 confident (≥ 0.85) false admits, my reading is:
    - 7 are refusals the current prompt would not make: explicit door, walk, wait, copy or descend actions, and two moves
      that name the place;
    - 1 is ambiguous: 30 minutes for a clerk to pull the files the player asked for;
    - 1 looks like real overreach: the player asked how long a search takes, and the Keeper committed 2 hours.
  - That is a reading, not a measurement.
- **Jev is not bit-reproducible here.** The v1 re-run sent requests identical to phase 1's (the request code is
  unchanged since then):
  - same batch verdict on 327 of 351 cases;
  - line verdicts equal on 319;
  - |Δ confidence| median 0.03, p90 0.09, max 0.20.
  - A threshold near 0.87 therefore flips cases between runs. Any threshold needs margin.
- **Tuning.** Iterations 2 and 3 were designed after reading the main sample's errors, which is why the holdout exists.
  2a.3's zero false admits at T ≥ 0.85 on the main sample did not survive it.
- **Reconstruction.** The same offline gaps as phase 1 apply: setup prologue omitted, `registered_destination` omitted on
  re-projected move lines, answered options unknown.

## Predictions (pre-registered) against outcomes

- P1 (2a.1 median confidence > 0.6): **held**, 0.68.
- P2 (2a.1 `not_player_action` same admission ≥ 70%): **failed**, 66%. 2a.2 reached 77%.
- P3 (`not_authorized` ≤ 40% and admit/refuse ≥ 65%): **held**, 18% and 66.8%.
- P4 (T=0.87 settles ≥ 15% at bank-mix FA ≤ 1.8%): **failed**. 2a.1 settled 25% at 9.4%.
- P5 (v1-sum < half of 2a.1's settled share at T=0.87): **failed**. Summing alone settled more (121 vs 92) at a lower FA
  (6.5% vs 9.4%). It was the target/gate/order decomposition in 2a.2/2a.3, not the role split alone, that bought
  precision.
- P6 (latency p50 ≤ 600 ms, p90 ≤ 900 ms): **held** in every run (p50 354–411 ms, p90 414–602 ms). Eight to ten
  questions per line cost about the same as v1's three.

## Exact commands

Run from the worktree root. The phase-1 bank is regenerated by the command in `../sl97/README.md`; `<bank>` is its
`bank.jsonl`. The key is exported only in the running shell, never printed or stored:

```
export EXT_JEV_APIKEY="$(node -e "import('./experiments/single-loop-routing/vault.mjs').then(async m => { const v = await m.readVaultSecret('EXT_JEV_APIKEY'); process.stdout.write(String(v || '')); })")"
```

**Gate #23 bank.** 30 cases. `masks-1350` has no telemetry.

```
node experiments/admission-jev-bank/build.mjs --out <g23> \
  --home /Users/haoli/leehow/code/chatrpgv4-wt-gate-13ce6a7dd/.coc \
  --home /Users/haoli/leehow/code/chatrpgv4-wt-gate-13ce6a7dd-masks/.coc
```

**Iterations.** The main-sample flags are the same each time; only the design and revision change:

```
M="--bank <bank> --extra <g23>/bank.jsonl --port live --per-class 90 --seed 1 --skip-unlabelled --concurrency 6"
node experiments/admission-jev-bank/replay.mjs $M --out <it1> --design v1                              # iteration 1, v1 re-run
node experiments/admission-jev-bank/replay.mjs $M --out <it1> --design v2 --revision 2a.1 --ablation   # iteration 1, 2a.1
node experiments/admission-jev-bank/replay.mjs $M --out <it2> --design v2 --revision 2a.2 --ablation   # iteration 2
node experiments/admission-jev-bank/replay.mjs $M --out <it3> --design v2 --revision 2a.3 --ablation   # iteration 3A
```

(In zsh, spell the flags out instead of `$M`: zsh does not split words.)

Iteration 1's 2a.1 run predates the `--revision` flag. Its output was named `replay-live-v2.jsonl` and is kept here as
`it1-v2-2a.1.jsonl`. Revision 2a.1 in the committed module rebuilds all 370 of its requests byte for byte, which was
checked by digest before iteration 2.

**Holdout** (iteration 3B). The builder writes the same 330 ids as `holdout-ids.txt`:

```
node experiments/admission-jev-bank/sl97b-holdout.mjs --bank <bank> \
  --exclude experiments/admission-jev-bank/results/sl97/replay-live.jsonl \
  --exclude experiments/admission-jev-bank/results/sl97b/it2-v2-2a.2.jsonl --out <holdout.jsonl>
node experiments/admission-jev-bank/replay.mjs --bank <holdout.jsonl> --out <it3h> --port live --concurrency 6 \
  --design v2 --revision 2a.3 --ablation
```

**Analysis.** No calls. `R` is `experiments/admission-jev-bank/results`.

```
node experiments/admission-jev-bank/sl97b-analyze.mjs --bank <bank> --bank <g23>/bank.jsonl --out <a> \
  --arm "v1-phase1=max:$R/sl97/replay-live.jsonl" --arm "v1-rerun=max:$R/sl97b/it1-v1-rerun.jsonl" \
  --arm "v1-rerun-sum=sum:$R/sl97b/it1-v1-rerun.jsonl" --arm "it1-2a.1=sum:$R/sl97b/it1-v2-2a.1.jsonl" \
  --arm "it1-2a.1-single=single:$R/sl97b/it1-v2-2a.1.jsonl" --arm "it2-2a.2=sum:$R/sl97b/it2-v2-2a.2.jsonl" \
  --arm "it2-2a.2-single=single:$R/sl97b/it2-v2-2a.2.jsonl" --arm "it3-2a.3=sum:$R/sl97b/it3-v2-2a.3.jsonl" \
  --arm "it3-2a.3-single=single:$R/sl97b/it3-v2-2a.3.jsonl" \
  --arm "it3-2a.3-no_order(exploratory)=no_order:$R/sl97b/it3-v2-2a.3.jsonl" \
  --arm "it3-2a.3-order_on_acts(exploratory)=order_on_acts:$R/sl97b/it3-v2-2a.3.jsonl"
node experiments/admission-jev-bank/sl97b-analyze.mjs --bank <bank> --bank <g23>/bank.jsonl --out <b> \
  --arm "holdout-2a.3=sum:$R/sl97b/it3-holdout-v2-2a.3.jsonl" \
  --arm "holdout-2a.3-single=single:$R/sl97b/it3-holdout-v2-2a.3.jsonl" \
  --arm "holdout-2a.3-no_order(exploratory)=no_order:$R/sl97b/it3-holdout-v2-2a.3.jsonl" \
  --arm "holdout-2a.3-order_on_acts(exploratory)=order_on_acts:$R/sl97b/it3-holdout-v2-2a.3.jsonl"
```

**Tests.** Synthetic input only, no calls:

```
node --test experiments/admission-jev-bank/admission-roles.test.mjs experiments/admission-jev-bank/sl97b-analyze.test.mjs \
  experiments/admission-jev-bank/bank-core.test.mjs
```

## Files

- `preregistration.md`: the rules fixed before the live runs, plus the addendum written before iteration 3.
- `it1-v1-rerun*.json[l]`, `it1-v2-2a.1*`, `it2-v2-2a.2*`, `it3-v2-2a.3*`, `it3-holdout-v2-2a.3*`: one row per case.
  - Ids, lane label, route, the typed verdict and confidence, per-line admit mass, and every per-question distribution.
  - No player or proposal text.
- `analysis-main.{json,md}` and `analysis-holdout.{json,md}`: every arm and threshold, per lane label, per class, per
  source (persona-bench vs table), and the lane floor.
- `holdout-ids.txt` and `bank-g23-stats.json`.
- The banks themselves (`bank.jsonl`, the holdout bank) are not committed. They carry player text and are regenerable
  by the commands above, as in phase 1.
