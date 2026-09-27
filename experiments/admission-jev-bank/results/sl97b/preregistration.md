# SL-97 phase 2a: pre-registration (written 2026-09-27 before any live call of this phase)

## What is replayed
- Phase 1's bank sample, `--per-class 90 --seed 1`, over the same bank (`bank.jsonl`, 5 362 cases, built 2026-09-26 18:24Z),
  minus the 90 cases whose lane gave no verdict (`--skip-unlabelled`: they measure no agreement), plus every case of the
  newest gate table (#23, `longgate23-haunting-1350`, 30 cases, 19 of them not in the sample). 390 cases, 20 `cash`
  (lane-only by §32.10, no call), 370 typed.
  The masks table of the same build (`masks-1350`) has no `telemetry.jsonl`, so it has no admission rows to pair: none.
- Shape dry run: v1 412 requests, v2 371 requests (v2 packs every line of a proposal into one request while it fits).

## Arms
- `v1-phase1` (stored, phase 1): the product's family as the product reads it (top verdict per line, 5-option confidence).
- `v1-max` (re-run): the same, re-run now; checks reproducibility and records each line's probabilities.
- `v1-sum`: the re-run's admitting mass per line (authorized + entailed + not_player_action), confidence |2p-1|.
  This is "collapse the admitting labels" alone, with v1's question and state unchanged.
- `v2-roles`: the role-first family (`admission-roles.ts`).
- `v2-single`: the ablation question inside the same v2 requests (one collapsed Choice, role-aware criteria, v2 state).

## Settle rule and the floor
- A typed answer settles a batch as admitted when every line admits and the batch confidence (minimum over lines) is
  at least T. A false admit is a settled admit the lane refused (`not_authorized` or `uncertain`).
- `review_pending` is not a label; those cases are reported apart.
- The lane's disagreement floor, from every retained re-run of the lane on the same case (SL-24, SL-30, SL-39,
  `sl97b-analyze.mjs`): same-model repeats, of one run's admits, the share another run refused = **1.8%** (1 640
  ordered pairs); cross-model (SL-39's alternatives) = 6.7% (4 342 pairs).

## Decision rule for a per-class threshold (fixed now)
Classes are the batch's closed effect kinds: `time`, `move` (move ± time), `clue` (clue/handout ± time), `resolve`,
`other`. For a class, recommend the lowest T in {0.5, 0.6, 0.7, 0.8, 0.85, 0.87, 0.9, 0.95} with
(1) at least 10 settled admits in that class, and (2) false-admit share at the bank's own label mix <= 1.8%.
Report the Wilson 95% upper bound on the raw share beside it; where that bound exceeds 6.7% the recommendation is
marked provisional (the sample cannot exclude cross-model-level disagreement). If no T qualifies: no recommendation.

## Predictions (checked after the run, whichever way they fall)
- P1: v2-roles median confidence > 0.6 (v1 0.45).
- P2: v2-roles same-admission on lane `not_player_action` >= 70% (v1 40%).
- P3: lane `not_authorized` stays the hard class: v2-roles same-admission <= 40% (v1 20%); admit/refuse agreement at
  T=0 >= 65% (v1 57%).
- P4: at T=0.87, v2-roles settles >= 15% of labelled typed cases with bank-mix false-admit share <= 1.8%.
- P5: v1-sum gets less than half of v2-roles' settled share at T=0.87.
- P6: v2 latency p50 <= 600 ms, p90 <= 900 ms.

## Budget
At most about 800 live calls per iteration, at most 3 iterations. Iteration 1 = v1 re-run (412) + v2 (371) = 783.

## Addendum before iteration 3 (written after iterations 1 and 2, before any iteration-3 call)

Iterations 1 and 2 changed the questions after reading this sample's own errors, so the main sample's numbers for
2a.2 and later are optimistic. Iteration 3 therefore has two parts:

- **A.** Revision 2a.3 (2a.2 plus `order_i`, and "a skill or approach other than the one the player named" in
  `keeper_choice`) on the same main sample (about 380 calls).
- **B.** A holdout the design never saw (`sl97b-holdout.mjs`, seed 2): bank cases not in phase 1's 461-case sample
  and not among the 19 gate-#23 extras, lane-labelled, no `cash`, `apply` batches of the three fast-path classes
  (`time`, `move`, `clue`), per class up to 50 lane refusals and 60 lane admits (about 330 cases). Only one revision
  runs there, chosen by this rule on the main sample: at T=0.9, over the `time`+`move`+`clue` classes, the larger
  (settled admits - 55 x false admits), 55 being the reciprocal of the 1.8% floor (one false admit per 55 settled
  admits is exactly at the floor); a tie goes to 2a.2 (fewer questions).

The per-class recommendation is made from the holdout, with this one amendment to the rule above: because the
holdout is stratified by class and by lane admit/refuse, "false-admit share at the bank's own label mix" is computed
per class as r·a / (r·a + (1-r)·b), a = P(settled admit | lane refused), b = P(settled admit | lane admitted),
r = that class's refusal rate in the whole bank (time 6.7%, move 15.0%, clue 12.7%). The rule is otherwise
unchanged: at least 10 settled admits, share <= 1.8%, lowest such T; the upper bound (Wilson upper on a, Wilson
lower on b) is reported, and above 6.7% the recommendation is provisional.
