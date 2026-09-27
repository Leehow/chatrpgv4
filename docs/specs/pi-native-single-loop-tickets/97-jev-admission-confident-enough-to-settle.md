Status: ready (filed 2026-09-26 from long gate #23; batch 18; P1 — latency: the owner's 60 s first-prose target missed on 4 of 20 turns)
Stage: SL-97 (admission: the typed Jev reviewer answers in half a second but is too unsure to settle, so the grok lane pays 7–13 s)
Spec: docs/kernel-rpc.md §32.10 (typed reviewer family), §32.11 (bookkeeping fast path, `PI_COC_ADMISSION_FAST_MIN_CONFIDENCE` 0.87), §32.12.2/§32.12.3 (cap, pending, line-level); `extensions/kernel/admission.ts`, `runtime/jev/admission-domain.ts`, `experiments/admission-jev-bank/` (`build.mjs`, `replay.mjs --port live --per-class N`); skill `~/.claude/skills/typesafe-jev` (Jev primitives, criteria design, calibration)

# SL-97: the typed admission is confident where the lane would agree

## Evidence (long gate #23, `longgate23-haunting-1350`, 13ce6a7dd, everything grok-4.5 low)
- **Time to the first visible prose: median 50.3 s, max 72.9, 16 of 20 under 60 s.** #22 (admission lane on grok-4.3, thinking off, since banned) had median 29.7 and 20 of 20.
- Admission lane on grok-4.5 low, 33 reviews:
  - p50 6.8 s, p90 13.0 s;
  - **6 reviews stalled at the 13 s cap** (`review_pending`: t2, t5, t8, t13, t15, t20), each costing the cap, a resend call and up to 13 s more;
  - Keeper calls 2.45 per turn, against 1.75 in #22.
- grok-4.5's lowest reasoning effort is `low`; the catalog offers low, medium and high only. So the lane cannot be made faster by a setting, and the owner rules the model: all grok-4.5 low.
- **The typed Jev reviewer already runs first on 19 batches** (§32.11 fast path) and answers in about 0.5 s. But it settled only one:
  - the rest fell back on low confidence, e.g. t2 `line_verdicts [not_authorized, entailed]`, `line_confidences [0.24, 0.57]`, `jev_fallback: typed_refusal`;
  - the fast threshold is 0.87.
- §32.10's own note: "Agreement with the lane was not measured: no live Jev credential was available". The live key is available now.

## Scope
**Phase 1 — measurement, no product change (a test worker).**
- Build or refresh the case bank (`build.mjs`), including the #23 cases.
- Run `replay.mjs --port live` per class.
- Report:
  - agreement with the lane label by class;
  - false admits (typed admits where the lane refused) and false refusals, at each confidence threshold;
  - latency p50/p90;
  - where the confidence mass sits.
- Read 20 low-confidence cases: is it the input (missing context, ambiguous lines), the criteria, or genuine ambiguity?

**Phase 2 — design (an implementation worker), from phase 1's numbers.**
- Make the typed admission confident where it should be. Levers:
  - per-line Choice with explicit criteria;
  - the context §32.3 packs for it;
  - fan-out;
  - calibration per the Jev skill.
- Choose the settle threshold per class by measured false-admit rate.
- The lane stays the fallback for what the typed reviewer is unsure of.
- No hard-coded semantic lists. The owner's rule: Jev judges semantically, the host only packs and gates.

## Acceptance
- Phase 1 report.
- Phase 2: on the bank, false admits at or below the lane's disagreement floor.
- Long gate #24: typed-settled share, admission's share of the critical path, first visible prose ≤ 60 s on 20/20.

## Comments

**Phase 1 measurement (2026-09-26, no product change).** Raw outputs, commands and the 20-case read are in
`experiments/admission-jev-bank/results/sl97/` (`README.md`, `bank-stats.json`, `replay-live.jsonl`,
`replay-live-summary.json`, `replay-live-derived.json`, `low-confidence-cases.md`).

- **Bank refreshed** over the persona-bench/main corpus (`chatrpgv4-wt-pi-coc-v2/.coc`), every
  `chatrpgv4-wt-gate-*` worktree (#17–#23, including this ticket's own `longgate23-haunting-1350`), and the App
  home + its session logs: 6 306 review rows / 247 campaigns → 5 362 paired cases (944 unpaired). By lane verdict:
  authorized 3 566, not_authorized 726, entailed 723, not_player_action 170, unavailable 166, uncertain 2,
  review_pending 9. By source: persona-bench 4 785, driver tables 549, sessions 28. Gap found, not fixed: gate
  #19's driver `turn-N.json` files all recorded `"tools": []`, so its 33 retained rows pair to nothing (a logging
  gap in that run, not in `build.mjs`). The masks table under `chatrpgv4-wt-gate-13ce6a7dd-masks` was still running
  (no `final.json` yet) and correctly contributed nothing.
- **Live replay**, `--per-class 90` (chosen from a `--port shape` dry run to stay near the ~600-call budget): 461
  cases sampled, 32 `cash`-tagged (lane-only, no Jev call), 429 typed-attempted, **496 live Jev calls total**, 31 s
  wall clock at `--concurrency 6`.
- **Agreement with the lane** (371 labelled cases, 351 decided at threshold 0 = 94.6% coverage): exact-verdict
  agreement 41.3%, admit/refuse agreement 57.0%, 73 false admits, 78 false refusals. Per-class exact agreement at
  threshold 0: authorized 53/83 decided, entailed 63/86, not_authorized 17/86, not_player_action 12/85.
- **At the fast-path default (0.87, not in `replay.mjs`'s own threshold array — computed by hand in
  `replay-live-derived.json` with the same logic `summarize()` uses):** 2 of 371 decided (0.5% coverage), 1 exact
  agreement, 0 false admits, 1 false refusal. At 0.9: 2 decided. At 0.95: 0 decided. The typed reviewer essentially
  never reaches the family's own confidence bar on this bank.
- **Confidence:** mean 0.455, median 0.44 (n=351, all typed-decided cases) — full histogram per lane-label class
  and per typed verdict in `replay-live-derived.json`.
- **Latency:** case-round p50 375 ms / p90 548 ms / max 1 229 ms (typed-only, n=351; 386/592/1 229 ms including
  fallback rounds, n=429). This is the whole case's parallel `Promise.all` round, not one HTTP call, for the ~13%
  of cases that pack into 2+ line-batches.
- **20 low-confidence cases read** (confidence < 0.6, 339 of 429 typed cases qualify) in `low-confidence-cases.md`,
  including the ticket's own #23 t2 case (this replay: `not_authorized` 0.51 / `entailed` 0.61, lane
  `review_pending`; the ticket's live numbers were 0.24/0.57 — the offline reconstruction is not bit-identical to
  what the table saw, though both are low and land the same way). Rollup across the 20: 10 of 20 are NPC- or
  environment-delivered content (a clue that is an NPC's answer or a Mythos manifestation, not a thing the
  player's own line names) — the largest single driver of low confidence in this sample; 3 are
  `authorized`↔`entailed` label mismatches (both admit, so not a real disagreement); 3 look like general
  `time`-line calibration (clear cases that still score mid-low); 2 are reconstruction/packing gaps specific to
  this offline replay (a clipped player line, a missing `registered_destination`); 2 are genuine ambiguity in what
  action was actually declared.
- **Nothing blocked.** `replay.mjs` ran as committed, no fix needed, no product code touched. `bank.jsonl` itself
  (~25.7 MB, 5 362 cases) is not committed — regenerable read-only evidence, reproduced by the exact command in
  `results/sl97/README.md`.

Numbers only; phase 2 (design, threshold choice, any code change) is left to that worker.

**Phase 2a: design, offline only (2026-09-27, worktree `chatrpgv4-wt-sl97b`, branch `claude/sl97b-20260926`, base 7d8ff69e8).**
No product code changed. Code: `experiments/admission-jev-bank/admission-roles.ts` (the alternative typed port),
`replay.mjs --design v2 --revision 2a.1|2a.2|2a.3`, `sl97b-analyze.mjs`, `sl97b-holdout.mjs`, with tests. Results, the
pre-registration and the exact commands are in `experiments/admission-jev-bank/results/sl97b/` (`README.md`).

- **Design: roles first, one question per judgment, host arithmetic.**
  - Per line, one request fans out independent Choices over one state: `role` (investigator's act, world's response,
    time), then `choice`, `result` and `span`, each read as if that role applied. 2a.2 adds `target` (did the player
    address whom or what the act is aimed at) and `gate` (does it skip an obstacle the player didn't take on). 2a.3 adds
    `order` (does it get ahead of a step or condition the player set).
  - The host sums each question's admitting options, weighs them by the role distribution and takes the weakest
    judgment. Confidence is |2·P(admit) − 1|.
  - §32.3 packing: facts only (no rules list), the newest delivery apart as `justTold`, each line's closed `kind`.
    Almost every proposal is one request.
  - No semantic list: Jev judges, the host packs, sums and gates.
- **Budget.** 1 895 live calls over three iterations:
  - iteration 1: v1 re-run 412 + 2a.1 371 = 783;
  - iteration 2: 2a.2, 378;
  - iteration 3: 2a.3 on the sample 380 + on a holdout 354 = 734.
  - Latency p50 354–411 ms, p90 414–602 ms in every run.
- **Main sample** (phase 1's 371 labelled cases plus 19 new gate-#23 cases; 361 lane-labelled typed):
  - Admit/refuse agreement at T=0: v1 57.6% → 2a.1 66.8% → 2a.2 71.2% → 2a.3 68.4%.
  - Lane `not_player_action` same-admission: 40% → 66% → 77% → 64%.
  - At T=0.87, settled admits / false admits: v1 3/0, v1 with admitting mass summed 121/19, 2a.1 92/29, 2a.2 104/10,
    2a.3 42/0.
- **Holdout** (330 disjoint time/move/clue batches, 50 lane refusals and 60 admits per class; the pre-registered
  measurement, since iterations 2–3 read the sample's errors): 2a.3 at T=0.87 settles 30 with 7 false admits.
  - Per class, at its own bank refusal rate: `time` 2.3% of settled admits lane-refused (upper bound 7.1%, about 29% of
    time batches settled); `move` 9.6%; `clue` settles one.
- **Lane floor**, from SL-24/30/39 re-runs of the lane on the same cases: of one run's admits, 1.8% refused by another run
  of the same model (1 640 pairs); 6.7% across models (4 342 pairs).
- **Recommendation: none.** No class meets the pre-registered bar (≤ 1.8% with at least 10 settled admits, on the
  holdout). `time` sits between the same-model floor and the cross-model floor. Which floor applies is the owner's
  call; the rule fixed in advance says 1.8%.
- **Found on the way.**
  - The false admits sit in 2026-09-11/12 persona-bench labels (grok-4.6 under the pre-09-15 lane prompt). Most of those
    I read are refusals the current prompt would not make.
  - On real-table labels (70 cases) no revision makes a confident false admit, but they hold only 6 refusals.
  - Jev is not bit-reproducible: identical v1 requests agreed on 327 of 351 batch verdicts, with |Δ confidence| p90 0.09.
- **Next.** The cheapest step needs no Jev call: relabel the 720 replayed cases with the current lane (two runs each) and
  re-score the stored typed answers with `sl97b-analyze.mjs`. Product integration (phase 2b) should wait for that.

**Phase 2a relabel (2026-09-27, worktree `chatrpgv4-wt-sl97c`, branch `claude/sl97c-20260926`, base `4811ddf06`).**
No product code changed; no new Jev call. Code: `experiments/admission-jev-bank/sl97c-relabel.mjs`,
`sl97c-labels.mjs`, `sl97c-key-thresholds.mjs`, plus a `--labels` option added to `sl97b-analyze.mjs`. Results and
the exact commands are in `experiments/admission-jev-bank/results/sl97c/` (`README.md`).

- **Relabelled the same 720 cases phase 2a replayed** (390 main + 330 holdout) with today's
  `admissionSystemPrompt`/`admissionRequest` (unchanged) and the owner's current lane model
  (`grok-build/grok-4.5`, thinking `low`), two runs each, batch-level plus one call per proposal line alone for
  every multi-line batch (both runs): **2 806 live lane calls**, 2 failures (`model_error`, both at the 60 s
  measurement cap), 0 `review_timeout`. 8.7% of calls exceeded the product's real 13 s cap. Latency: all calls p50
  6 558 ms / p90 12 533 ms (n=2 806); batch-level only p50 6 972 ms / p90 14 016 ms (n=1 440).
- **Run-to-run agreement (batch level, the same-model floor under today's prompt), n=719 decided pairs:** exact
  85.8%, admit/refuse 95.5% (flip rate 4.5%; of run 1's admits 3.7% run 2 refused, of run 2's admits 1.3% run 1
  refused). Per class (admit/refuse): time 97.9%, move 91.9%, clue 97.4%, resolve 93.5%, other 93.3%. Phase 2a's
  own same-model floor (SL-24/30/39 pooled) was a 3.2% flip rate; this single-model measurement's 4.5% is the same
  order of magnitude, on the noisier side.
- **Agreement with the old (mostly 2026-09-11/12 grok-4.6) bank label, per class** (both-refuse combination of the
  two runs; either-refuse is within 1-3 points): time 71.6% (n=190), move 64.9% (n=148), clue 76.1% (n=222),
  resolve 67.2% (n=122), other 69.0% (n=29); overall 70.8% (n=711).
- **Re-scored false admits against the new labels are far lower than phase 2a reported, on every fast-path class.**
  At T=0.87 (both-refuse), main sample: 2a.2 -- time 54/0 settled/false-admits (was 54/2 against the old label),
  move 8/0 (was 8/1), clue 10/0 (was 10/1); 2a.3 -- time 19/0, move 5/0, clue 2/0 (already 0 against the old
  label). `resolve` keeps non-zero false admits in every revision (2a.2 31/1 at T=0.87, 2a.1 67/4). Holdout (2a.3
  only), T=0.87: time 23/0 (was 23/5, 2.3%), move 6/0 (was 6/2, 9.6%), clue 1/0 (was 1/0). The either-refuse
  (stricter ground truth) definition recovers some of the old false admits on `resolve` (e.g. 2a.1 at T=0.87: 67/8
  vs 67/4) but leaves `time`/`move`/`clue` at 0 false admits everywhere in both samples. Full per-threshold tables
  in `results/sl97c/key-thresholds.md`.
- Numbers only; no new recommendation is made. Phase 2a's recommendation ("no threshold is recommended", the
  pre-registered 1.8% bar) stands as written -- this data would change the picture if the owner asks for a new
  recommendation from it, but that is not done here.
