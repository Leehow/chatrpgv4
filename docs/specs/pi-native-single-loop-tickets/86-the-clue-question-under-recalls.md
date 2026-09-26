Status: ready-for-human (implemented 2026-09-26 on `claude/sl86-20260926`; load the `typesafe-jev` skill first)
Stage: SL-86 (P1, Stage 2b's lever: the `clue_follow_up` question's recall)
Spec: docs/specs/jev-driven-steps.md D1 (`clue_follow_up`), D2 (question hygiene), D6 2b; `runtime/jev/consequence-candidates.ts` / `consequence-route.ts`; `content/rulesets/coc7/host-budgets.json` `jev_steps.row_min/row_ratio`; skill `~/.claude/skills/typesafe-jev` (literal reading; state minimal but sufficient; `what/not_for/examples`; thresholds by cost of error)

# SL-86 — Jev clears 2 of the 9 clues the Keeper then files: the `clue_follow_up` question under-recalls, so the residual does not move

## Evidence (gate #17, execute mode)
- Offered 36 distinct (turn, clue) rows over 13 turns; cleared 2 (both filed, both right); false positives 0 (also 0/0/1 on #14/#15/#16). False negatives 7: the Keeper filed the clue the same turn while Jev's `yes` sat at 0.12–0.45 (`nailed-windows` 0.24 on "walk around the house, look at the windows, locks and the basement vents"; `catholic-wards` 0.12 and `upstairs-disturbance` 0.20 on "go in, room by room, kitchen first"; `gabriela-night-visitor` 0.37 on "find Gabriela and ask about the night they left").
- Four tables, ~140 clue rows: precision 1.0 at the current gate (`yes ≥ 0.5 and ≥ 2×no`), recall ≈ 0.2. The cost asymmetry is the reverse of what the gate assumes: a wrongly filed clue is reversible by the Keeper with a receipt (D3), a missed one costs a Keeper write (3 s + a refusal risk) — the residual Stage 2 exists to remove.

## Ruling (filed for the owner)
Two changes, measured separately on the next table: (1) the question's state carries what "reach" means for this clue — the book's `found_at` cues / the scene or object the clue sits in (§32 affordances already carry `found_at[].cues`), and the settled action's place/object/person as receipts name them — with `what / not_for / examples` criteria per the skill (the miss cases above as examples of `what`, "the player only names the place from afar" as `not_for`); (2) the clue class gets its own gate in data (`jev_steps.classes.clue_follow_up.row_min`, start at 0.35 with the ratio kept) because its error costs differ from a reaction's. Report recall/precision per table in SL-77's script; the bar to keep (2) is precision ≥ 0.9.

## Scope
- `consequence-candidates.ts` (clue detail: cues, placement), `consequence-route.ts` (instructions/criteria; per-class gate), `host-budgets.ts`/`host-budgets.json`; tests: the state carries cues; per-class gate read from data; mutation: drop the cues → the fixture question loses them.

## Comments

**2026-09-26, implemented.** Contract: `docs/kernel-rpc.md` §135.32 addendum 3 (written before code, per house rule). Both ruling items landed:

1. **State carries "reach".** `table.apply.options`'s clue row already carried the book's own affordance cues (`description.cues`, §135.30.9.2's `grantingCues`) -- the gap was only that `consequence-candidates.ts`'s `clueFollowUpCandidates` never read them. It now does, and puts them on the candidate's `detail.cues` (a `Candidate.detail`, state-only: never a write argument -- `bound` stays exactly `{kind, clue, how}`). `consequence-route.ts`'s `candidateView` now forwards a candidate's `detail` to the Jev state alongside `bound`, same as the route/compile fan-out's own candidate view already does. The Noul's `criteria` is now the skill's structured `{what, examples}` / `{not_for}` rubric (real book cue text as `examples`, never a paraphrase), and `instructions` restates the same boundary in full sentences (jaggedness #7). No new kernel field was needed; `ConsequenceNoul.criteria` widened from `string` to `DecisionDescriptor` (`contracts.ts`) to carry the structured object.
2. **Per-class gate.** `content/rulesets/coc7/host-budgets.json`'s `jev_steps` gained `classes: {"clue_follow_up": {"row_min": 0.35}}`; `row_ratio` stays the one shared value (2), per the ruling. `host-budgets.ts` gained `JevStepsBudget.classRowMin` and `thresholdsForClass(budget, class)`; `consequence-route.ts`'s `interpretConsequenceResult` takes an optional per-class threshold map (backward compatible: omitted, every call behaves byte-for-byte as before); `hybrid-engine.ts`'s `routeConsequences` builds that map from `jevStepsBudget()` for every class offered in the batch.

**Important finding for the human, before the next live table.** `noulClears`'s gate is `p >= rowMin AND p >= rowRatio*(1-p)`. Solving the ratio term alone gives `p >= rowRatio/(1+rowRatio)`, which at the shared `row_ratio: 2` is `p >= 0.667` -- a floor that binds regardless of `rowMin` whenever `rowMin <= 0.667`. Both the old shared `row_min` (0.5) and the new `clue_follow_up` override (0.35) are below that floor, so **at `row_ratio: 2` the 0.35 override is mathematically inert**: no probability clears `true` under 0.35 that would not already have cleared under 0.5 (proved in `tests/extension/consequence-host-budgets.test.mjs`, run over gate #17's actual seven miss probabilities 0.12-0.45 plus the boundary). None of gate #17's misses (max 0.45) come anywhere near 0.667 either way. The plumbing this ticket asks for (data file -> `jevStepsBudget` -> `thresholdsForClass` -> `interpretConsequenceResult`) is implemented correctly and is exactly the ticket's stated scope; **the recall gain on the next live table, if any, will come from item (1)'s better-informed criteria raising the underlying probabilities, not from item (2)'s `row_min` move as configured**. If the owner wants `row_min` alone to matter, `clue_follow_up` also needs its own `row_ratio` (something below 2, since a class whose false-negative cost dominates wants to accept a less-peaked "yes" than a false-positive-averse class does) -- that is a policy call for the owner, not made here since the ticket's ruling named only `row_min`.

**Tests.** `node --test` (this worktree, no live calls, `DecisionPort` never invoked): `tests/extension/consequence-candidates.test.mjs` (19/19), `tests/extension/consequence-route.test.mjs` (11/11), `tests/extension/consequence-host-budgets.test.mjs` (12/12), `tests/extension/consequence-shadow-gate.test.mjs`, `tests/extension/consequence-execute-mode.test.mjs`, all of `tests/extension/single-loop-*.test.mjs` (174/174) and `tests/extension/jev-*.test.mjs` (443/443) unaffected. New tests added: a clue row's cues reach `detail`/`examples` and never `bound`; a cueless row carries neither; non-string/blank cue entries are dropped; a candidate's `detail` reaches `consequenceBatch`'s wire state; a structured Noul criteria object round-trips; a per-class threshold map changes only its own class's row and `exists` row; `jevStepsBudget`/`thresholdsForClass` read `jev_steps.classes.*.row_min`, fall back field-by-field on a bad/missing/out-of-range shape, and the shipped file names `clue_follow_up: 0.35`; the mathematical-inertness finding itself is pinned as a test (`noulClears` agrees between 0.5 and 0.35 at ratio 2, over the real miss probabilities).

**Mutation evidence** (copy-edit-run-restore on a scratch copy, never `git checkout --`): dropping the cues-read in `clueFollowUpCandidates` (`const cues: string[] = []`) killed 2 tests (the row's `detail`/`examples` assertions) -- restored, 19/19 green again. Neutering `thresholdsForClass` to ignore `classRowMin` killed 1 test -- restored, 12/12 green. Neutering `interpretConsequenceResult`'s `gateFor` to ignore the per-class map killed 1 test -- restored, 11/11 green.

**Report (SL-77's script, `tests/play/jev-steps-report.py`), gate #17, offline (no live calls)**, before and after adding the recall/precision section this ticket also asked for:

*Before* (unchanged behaviour, the section did not exist):
```
-- exists rows (does the family apply at all; no keeper_did) --
class            offered  cleared=true  cleared=false  unresolved(null)
npc_reaction           6             3              0                 3
clue_follow_up        16             0              9                 7
time_cost              0             0              0                 0
```
(full per-class candidate table: `clue_follow_up` offered 43, cleared 3, true 12, false 16, other 15 -- see the ticket's own Evidence section above for the dedup-by-(turn,clue) count of 36/2/7; this script counts raw rows, not deduped, which is why the totals differ -- SL-85's duplicate-residual-row defect on turns 5/7/20 is part of that difference too.)

*After* (new section, same historical telemetry -- this campaign was played before this ticket's code existed, so the numbers reflect the *old* gate that was live when it ran, not the new one):
```
-- recall/precision (SL-86, ticket 86): false negatives are offered rows the Keeper filed but Jev did not clear --
class              tp   fp   fn  precision   recall
npc_reaction        0    1    0       0.00      n/a
clue_follow_up      3    0    9       1.00     0.25
time_cost           0    0    0        n/a      n/a
  [clue_follow_up] turn 2 key='consequence:clue_follow_up:globe-unpublished-story' yes_probability=0.39
  [clue_follow_up] turn 5 key='consequence:clue_follow_up:dooley-macario-madness' yes_probability=0.45
  [clue_follow_up] turn 5 key='consequence:clue_follow_up:dooley-macario-madness' yes_probability=0.45
  [clue_follow_up] turn 7 key='consequence:clue_follow_up:gabriela-night-visitor' yes_probability=0.37
  [clue_follow_up] turn 7 key='consequence:clue_follow_up:gabriela-night-visitor' yes_probability=0.37
  [clue_follow_up] turn 8 key='consequence:clue_follow_up:knott-macario-summary' yes_probability=0.2
  [clue_follow_up] turn 9 key='consequence:clue_follow_up:nailed-windows' yes_probability=0.24
  [clue_follow_up] turn 10 key='consequence:clue_follow_up:upstairs-disturbance' yes_probability=0.2
  [clue_follow_up] turn 10 key='consequence:clue_follow_up:catholic-wards' yes_probability=0.12
```
Precision stays 1.0 (matches the ticket's bar of >= 0.9), recall 0.25 raw (the ticket's own dedup gives 2/9 ≈ 0.22) -- both readings agree qualitatively with the Evidence section. Since this is historical telemetry from a table played under the old code, this run cannot show whether the new criteria/gate move the number; that needs a live table, which this worker was barred from running (hard rule: no live Jev/model calls).

**Not done / left for the human:** a live table to measure whether item (1)'s better criteria actually raise recall (this worker made no live Jev calls, per the hard rule); the `row_ratio` policy question raised above; SL-85 (P3) is being attempted next in this same session, after this ticket's commit.
