# SL-97 phase 2a relabel: today's lane against the 720 cases phase 2a replayed

Ticket: `docs/specs/pi-native-single-loop-tickets/97-jev-admission-confident-enough-to-settle.md`. Contract:
`docs/kernel-rpc.md` §32.2, §32.10, §32.11, §32.12.3. No product code changed. This is phase 2a's own "next step"
(`results/sl97b/README.md`): "the cheapest step needs no Jev call: relabel the 720 replayed cases with the current
lane (two runs each) and re-score the stored typed answers with `sl97b-analyze.mjs`."

## What this measures

Phase 2a's stored typed answers were scored against the *historical* lane label baked into the bank at build time
(mostly 2026-09-11/12 persona-bench runs on `xai/grok-4.6` under that day's admission prompt). Since then the
prompt changed twice (the 09-15 "a part of a registered place is that place" amendment, the 09-21/23 "agency
precedes consent" clarification) and the owner's lane model changed to `grok-build/grok-4.5` at thinking `low`.
This folder relabels the same 720 cases with **today's** `admissionSystemPrompt`/`admissionRequest`
(`extensions/kernel/admission.ts`, unchanged by this measurement) and that model, twice each, live, then re-scores
phase 2a's already-stored typed answers against the new labels. No new Jev call anywhere in this folder.

## Commands (exact, reproducible)

Run from the worktree root. `<bank>` regenerates byte-identical to phase 1/2a's bank (verified: 5362 cases, and the
gate #23 home is already inside `--home .../chatrpgv4-wt-gate-13ce6a7dd/.coc` below, so no separate `--extra` bank
is needed here):

```
node experiments/admission-jev-bank/build.mjs --out <bank-dir> \
  --home /Users/haoli/leehow/code/chatrpgv4-wt-pi-coc-v2/.coc \
  --home /Users/haoli/leehow/code/chatrpgv4-wt-gate-13ce6a7dd/.coc \
  --home /Users/haoli/leehow/code/chatrpgv4-wt-gate-13ce6a7dd-masks/.coc \
  --home /Users/haoli/leehow/code/chatrpgv4-wt-gate-32e1d584f/.coc \
  --home /Users/haoli/leehow/code/chatrpgv4-wt-gate-d08fa2ebb/.coc \
  --home /Users/haoli/leehow/code/chatrpgv4-wt-gate-d08fa2ebb-43/.coc \
  --home /Users/haoli/leehow/code/chatrpgv4-wt-gate-d08fa2ebb-43low/.coc \
  --home /Users/haoli/leehow/code/chatrpgv4-wt-gate-d64c7a7c4/.coc \
  --home /Users/haoli/leehow/code/chatrpgv4-wt-gate-f332d72bc/.coc \
  --home "/Users/haoli/Library/Application Support/Pipi/pipicoc/pi-coc/.coc" \
  --sessions "/Users/haoli/Library/Application Support/Pipi/pipicoc/pi-coc/agent/ui-sessions/play"
```

The 390 main-sample ids are every `id` in `results/sl97b/it1-v1-rerun.jsonl`; the 330 holdout ids are
`results/sl97b/holdout-ids.txt` verbatim. Both were checked against the rebuilt bank before any live call: all 720
ids resolve, and the rebuilt bank's `lane.verdict` matches the historical label stored in `it1-v1-rerun.jsonl` for
every one of the 390 main-sample cases (0 mismatches) -- the same evidence, reprojected the same way.

**Relabel, live** (`.pi/coc-agent/auth.json` holds the grok-build credential the App itself uses; never printed):

```
node experiments/admission-jev-bank/sl97c-relabel.mjs \
  --bank <bank-dir>/bank.jsonl \
  --main-ids <390-ids.txt> --holdout-ids results/sl97b/holdout-ids.txt \
  --out results/sl97c/relabel.jsonl \
  --auth .pi/coc-agent/auth.json \
  --model grok-build/grok-4.5 --thinking low --runs 2 --concurrency 6
```

**Labels and the measurement report** (no call):

```
node experiments/admission-jev-bank/sl97c-labels.mjs --relabel results/sl97c/relabel.jsonl --out results/sl97c
```

**Re-score phase 2a's stored typed answers** (no call), once per sample x label definition. `R` is
`experiments/admission-jev-bank/results`; arms are exactly phase 2a's own (`results/sl97b/README.md`'s "Analysis"
commands), with `--labels` the only addition:

```
for DEF in both-refuse either-refuse; do
  node experiments/admission-jev-bank/sl97b-analyze.mjs --bank <bank-dir>/bank.jsonl --out results/sl97c/analysis-main-$DEF \
    --labels results/sl97c/labels-main-$DEF.json \
    --arm "v1-phase1=max:$R/sl97/replay-live.jsonl" --arm "v1-rerun=max:$R/sl97b/it1-v1-rerun.jsonl" \
    --arm "v1-rerun-sum=sum:$R/sl97b/it1-v1-rerun.jsonl" --arm "it1-2a.1=sum:$R/sl97b/it1-v2-2a.1.jsonl" \
    --arm "it1-2a.1-single=single:$R/sl97b/it1-v2-2a.1.jsonl" --arm "it2-2a.2=sum:$R/sl97b/it2-v2-2a.2.jsonl" \
    --arm "it2-2a.2-single=single:$R/sl97b/it2-v2-2a.2.jsonl" --arm "it3-2a.3=sum:$R/sl97b/it3-v2-2a.3.jsonl" \
    --arm "it3-2a.3-single=single:$R/sl97b/it3-v2-2a.3.jsonl"
  node experiments/admission-jev-bank/sl97b-analyze.mjs --bank <bank-dir>/bank.jsonl --out results/sl97c/analysis-holdout-$DEF \
    --labels results/sl97c/labels-holdout-$DEF.json \
    --arm "holdout-2a.3=sum:$R/sl97b/it3-holdout-v2-2a.3.jsonl" \
    --arm "holdout-2a.3-single=single:$R/sl97b/it3-holdout-v2-2a.3.jsonl"
done
```

**The ticket's own thresholds (0.8, 0.85, 0.87, 0.9, 0.95), per revision and class** (no call, reads the four
`analysis.json` files above):

```
node experiments/admission-jev-bank/sl97c-key-thresholds.mjs --dir results/sl97c
```

**Tests** (synthetic input only, no calls):

```
node --test experiments/admission-jev-bank/sl97b-analyze.test.mjs experiments/admission-jev-bank/bank-core.test.mjs \
  experiments/admission-jev-bank/admission-roles.test.mjs
```

## The two label definitions

Two runs give a case's batch two independent decisions. Because the pre-registered lane floor (`results/sl97b`) is
itself only about 1.8% (same model) to 6.7% (cross model), a single run's label is noisy enough that the choice of
how to combine two runs matters:

- **both-refuse**: "refused by today's lane" only when *both* runs refused (admitted needs just one run to admit).
- **either-refuse**: "refused by today's lane" when *either* run refused (admitted needs both runs to admit).

A case is excluded from a definition's label file when it cannot be decided under that rule (e.g. one run timed
out or errored and the other alone does not settle the question either way for that rule).

## Results

Full detail in `relabel-summary.md`, `key-thresholds.md` and `analysis-{main,holdout}-{both,either}-refuse/analysis.md`.
Numbers only; no design recommendation is made here (phase 2a's own recommendation stands as written unless the
owner asks for a new one from this data).

- **2 806 lane calls** (`grok-build/grok-4.5`, thinking `low`): 1 440 batch-level (720 cases x 2 runs) + 1 366
  per-line (one call per line alone, for every batch with more than one proposal line, both runs). 2 failures
  (`model_error`, both landing at the 60 s measurement cap), 0 `review_timeout` at that cap. 8.7% of calls exceeded
  the product's real 13 s cap (`over_13s`) -- close to the ticket's own historical ~9% (1 review in 11).
- **Latency:** all calls p50 6 558 ms / p90 12 533 ms / max 60 003 ms (n=2 806); batch-level calls only p50 6 972 ms
  / p90 14 016 ms (n=1 440).
- **Run-to-run agreement, batch level (the same-model floor under today's prompt), overall (n=719 pairs both
  decisive):** exact-verdict 85.8%, admit/refuse 95.5% (flip rate 4.5%); of run 1's admits 3.7% run 2 refused, of
  run 2's admits 1.3% run 1 refused. Per class (admit/refuse agreement): time 97.9%, move 91.9%, clue 97.4%,
  resolve 93.5%, other 93.3%. In the same units as phase 2a's own same-model floor (`sl97b-analyze.mjs laneFloor`,
  SL-24/30/39 pooled: flip rate 3.2%, i.e. of one run's admits 1.8% the other refused), this run's flip rate is
  4.5%, of run 1's admits 3.7% run 2 refused -- comparable order of magnitude, on the noisier side. The two are not
  the same measurement (different case mix, models pooled by SL-24/30/39 vs. this one model), but both agree a
  single run's label carries real noise.
- **Agreement with the old (2026-09-11/12, mostly grok-4.6) bank label, per class, admit/refuse (both-refuse
  definition; either-refuse is within 1-3 points of these, see `relabel-summary.md`):** time 71.6% (n=190), move
  64.9% (n=148), clue 76.1% (n=222), resolve 67.2% (n=122), other 69.0% (n=29); overall 70.8% (n=711). This is
  measuring prompt/model drift, not either lane's noise: the old label and today's are different measurements of
  different lanes at different times.
- **Re-scored false admits are far lower than phase 2a reported, across every fast-path class.** At T=0.87
  (both-refuse definition), main sample: 2a.2 -- time 54/0 settled/false-admits (was 54/2 against the old label),
  move 8/0 (was 8/1), clue 10/0 (was 10/1); 2a.3 -- time 19/0, move 5/0, clue 2/0 (all were already 0 against the
  old label). `resolve` keeps non-zero false admits in every revision (2a.2 31/1 at T=0.87, 2a.1 67/4). On the
  holdout (2a.3 only, both-refuse definition), T=0.87: time 23/0 (was 23/5, 2.3%), move 6/0 (was 6/2, 9.6%), clue
  1/0 (was 1/0). The either-refuse definition (stricter ground truth) recovers a handful of the old false admits
  on `resolve` (e.g. 2a.1 at T=0.87: 67/8 vs 67/4) but leaves `time`/`move`/`clue` at 0 false admits everywhere in
  both samples. Full per-threshold, per-class tables for v1, 2a.1, 2a.2 and 2a.3 (main) and 2a.3 (holdout), both
  definitions, are in `key-thresholds.md`.

## Files

- `relabel.jsonl`: one row per lane call (2806 total: 720 cases x 2 runs, batch-level, plus one call per line alone
  for every batch with more than one proposal line). Sanitized by construction: no player or proposal text, no
  `grounds`/`missing` (both can quote player words) -- verdict labels, ms, failure reason, `over_13s` only, matching
  the SL-39 addendum's committed precedent ("ids, turns, verbs, verdict labels, ms only").
- `relabel-summary.{json,md}`: run-to-run agreement (overall, per sample, per class), agreement with the old bank
  label per class, latency, failures.
- `labels-{main,holdout}-{both,either}-refuse.json`: id -> verdict maps for `sl97b-analyze.mjs --labels`.
- `analysis-{main,holdout}-{both,either}-refuse/{analysis.json,analysis.md}`: phase 2a's own tables, re-scored.
- `key-thresholds.{json,md}`: settled admits / false admits / class-natural false-admit share (with its Wilson
  upper bound) at thresholds 0.8, 0.85, 0.87, 0.9, 0.95, for v1/2a.1/2a.2/2a.3 (main) and 2a.3 (holdout), both
  label definitions -- extracted from the `analysis.json` files above, no new computation.
- The rebuilt bank (`bank.jsonl`) is not committed, same as phase 1 and phase 2a: regenerable read-only evidence.
