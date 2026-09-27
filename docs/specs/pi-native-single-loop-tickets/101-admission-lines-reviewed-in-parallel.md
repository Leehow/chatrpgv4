Status: ready-for-human (filed 2026-09-26, owner's choice after long gate #23: "拆条并行 + 长线改 Jev"; batch 18; P1 latency)
Stage: SL-101 (admission: a multi-line batch is reviewed as one call per line, all at once, on the same lane model)
Spec: docs/kernel-rpc.md §32.12.2 (cap, pending), §32.12.3 (a batch is admitted line by line), §32.4 (reuse), the admission-clock work (e6b53e727, `TaskClock` through admission.ts); `extensions/kernel/admission.ts`, `extensions/lanes/subsession.ts` (`runLane`)

# SL-101: review a batch's lines in parallel, one lane call each

## Evidence (long gate #23, every model grok-4.5 low; the owner keeps that model)
- The admission lane's time by batch size:
  - 1-line batches: n=19, median 6.1 s, max 12.7 s.
  - **2- and 3-line batches: n=10, median 13.0 s**, i.e. the cap, almost every time.
  - 6 `review_pending` stalls, each followed by a resend and up to 13 s more.
- First visible prose: median 50.3 s, 16/20 within 60 s.
- grok-4.5's lowest effort is `low`, so the per-call time cannot be lowered by a setting. The batch's size is what pushes it past the cap.

## Ruling (owner, 2026-09-26)
- A batch with more than one reviewed line sends **one lane call per line, concurrently**. The batch verdict is the existing line-level combination (§32.12.3). The cap and pending rules apply per call, and the batch is pending only on the lines still pending.
- Each call gets the same §32.3 context and exactly one proposed line. The only difference is which line.
- Verdict reuse (§32.4) keys by line.
- Lines settled on `basis.compile` / `basis.consequence` / typed stay off the lane, as today.
- A one-line batch is unchanged.
- The Jev typed reviewer is not changed here; that is SL-97's longer track.

## Scope and tests
- `admission.ts` / `runLane`, using the admission-clock `TaskClock` for deterministic tests.
- Mutation-killable tests:
  - a 3-line batch makes 3 concurrent lane calls, and its wall time is the max of the three, not the sum;
  - a pending line leaves only that line pending;
  - reuse by line;
  - one-line and compile/consequence/typed paths are unchanged.
- Report the effect on the #23 cases by re-running the lane on their batches offline if feasible (the admission-jev-bank has the reconstructed inputs).
- Contract: an addendum under §32.12.3 (stable ids).

## Acceptance
Long gate #24: `review_pending` ≤ 1; admission's share of the critical path; first visible prose ≤ 60 s on 20/20.

## Comments

**Implementation (2026-09-26, `claude/sl101-20260926`, 142e30b23 on base 7d8ff69e8).** Contract §32.12.3.1 (addendum
under §32.12.3; pointers added to §32.1 and §32.4).

- *The split.* `reviewAdmissionPrimary` (`extensions/kernel/admission.ts:826`) starts one `reviewAdmission` round per
  reviewed line of an `apply` batch with two lines or more (`reviewedPerLine`, :670), each on `lineProposal` (:678): same
  prompt, model, thinking and §32.3 context, exactly one proposed line, its own hard cap from the review's start. The one
  typed attempt over the whole batch is unchanged. `perLineReview` (:897) returns when every line has its outcome, at the
  first `not_authorized` line (:952), or at the cap; the typed answer's batch rules (fast path, family, split) apply only
  while no line's lane has given a verdict (`typedRules`, :932). A one-line batch and a `resolve` take the old loop (:973).
- *The batch verdict.* `admitAction`'s `settleLines` (`extensions/kernel/index.ts:2628`) settles each line through
  `admitOne` (verdict, failure, its own late admission via `lineReading` :686, or its own pending round), then
  `combineLines` (:2600): admitted only when every line is, otherwise the whole lane-reviewed proposal is refused with the
  refusal `batchRefusal` (`admission.ts:702`) picks (refusal on grounds, `not_authorized` first > unavailable >
  `review_timeout` > `review_pending`), with `details.line_outcomes` and, when pending, `details.pending_lines`. Lines still
  running when a batch-mate refused or failed are stopped (`reviewed.abort()`) and left unsettled. Partial landing stays
  only §32.12.3's typed-cleared lines (`splitLines`, :2656; a remainder of two lines or more is reviewed per line).
- *Pending and the resend.* A pending line's round is kept under its own key; `admitLines` (:2703) finds a later call's
  lines by their own keys (`admissionLines`, :2268): a kept refusal refuses the batch at once (:2710), otherwise kept
  verdicts are reused and kept rounds re-joined (:2718) and unknown lines reviewed as their own proposal. The identical
  resend therefore waits only on the pending lines.
- *Reuse by line.* Each line's verdict is kept under the key a one-line call would have; the batch key keeps the combined
  verdict when every line was admitted. The §32.12.4 prefetch skips a batch with a known line (:2323). The outage streak
  counts one call once (:2539).
- *Telemetry.* Each line has its own `lane: "admission"` row (`line_level: "line"`, `lines`, `of_lines`, `batch_key`,
  `line_calls`, `line_ms`, `batch_ms` :2641), written after the batch's verdict and carrying `batch_admitted` and
  `batch_verdict`/`batch_reason` (`emit`, :2415). A stopped line has no row and `null` in `line_ms`.

**The reading I took of "the batch verdict is the existing line-level combination" -- the owner should confirm.** I read it
as §32.10's arithmetic over the per-line verdicts (the mapping §32.12.3 already uses for a remainder): the lane-reviewed
lines land together or not at all, so §32.1's "a clue beside a move is admitted only when the player's words authorise
both" still holds, and a refusal of one line refuses its batch-mates even when the lane admitted them on their own calls.
The other reading -- land each lane-admitted line and refuse only the refused ones, extending §32.12.3's partial landing
from typed-cleared lines to lane-judged lines -- would land more per call but changes consent semantics (a time line judged
alone could land while the trip it belongs to is refused), so I did not take it without a ruling. Switching is local:
`combineLines` would return the per-line statuses (mutation M7 below is exactly that switch).

Other decisions of mine, all in the addendum: a `not_authorized` line ends the review at once (`uncertain` waits, since a
later `not_authorized` outranks it); a typed answer arriving after a line's lane verdict no longer stands; the stopped lines
of a refused batch leave no pending round and no row.

**Tests** (single files on the Mac; leehow-pc not used):
- `node --test tests/extension/admission-lines-parallel.test.mjs` -- 18/18 pass. Covers: 3 concurrent calls, each one line
  and the same context, wall time = slowest line (manual clock: lines at 0.7/0.9/1.2 s, `batch_ms` 1200 not 2800, nothing
  lands before 1.2 s); one line past the cap leaves only it pending and the identical resend re-joins it (no new call,
  `resend_wait_ms` 500); every line past the cap re-joined; late admission per call (typed 0.72 on the late line vs the
  batch's 0.4); `not_authorized` decides at 200 ms with the others stopped and nothing pending; an admitted line never lands
  beside an `uncertain` one; a typed fast-path answer after a lane verdict does not stand; reuse by line (a retry dropping
  the refused line lands on the kept verdict plus one call for its new line; a kept refusal refuses at once) and cleared by
  new player input; one outage per call; one-line batch and `resolve` rows unchanged; typed fast path unchanged; a split's
  two-line remainder per line; prefetch collected per line and skipped for a known line; pure `reviewedPerLine`,
  `lineProposal`, `lineReading`, `batchRefusal`.
- Updated because their premise was one lane call per batch (now one per line; same intent, verdicts scripted per line via
  the new harness helper `laneByLine`): `admission`, `admission-fast-path`, `admission-jev`, `admission-late` (no-grounds
  late admission is now per line), `admission-line-level` (and its rest-round helpers now key on "admitted in this same
  call", so a batch's own per-line round cannot pass for the rest's), `involuntary-admission`, `object-usages-admission`,
  `undisclosed-cost-admission` (strengthened: the debit's refusal holds back a time line the lane admitted),
  `jev-apply-host` (two admission calls before the Mod hook).
- Final run, one file at a time, all pass: every `tests/extension/*.test.mjs` that mentions admission (47 files incl. the new
  one; e.g. `admission-within-turn` 33/33, `consequence-admission` 6/6, `apply-narrate-combined` 4/4, `admission-concurrent-batch`
  2/2), `single-loop-turn-close` 15/15, `system-language` 5/5, `contract-section-numbers` 3/3.
  `experiments/single-loop-routing/loop.test.mjs` does not touch admission and was not run. No pytest, no full suites.
- Type check: an ad-hoc `tsc --noEmit` over `admission.ts`/`index.ts` gives the same error set as the base (pre-existing
  errors only, none new).

**Mutations** (a copy of `admission.ts`/`index.ts`, restored by `cp` and md5-checked after each; against
`admission-lines-parallel.test.mjs`): every one red.

| id | mutation | red |
| --- | --- | --- |
| M1 | `reviewedPerLine` always false (one round per batch) | 11 |
| M2 | every line's call proposes the whole batch | 7 |
| M3 | no early return on a `not_authorized` line | 1 |
| M4 | lines still running are settled (pending) after a batch-mate refused | 1 |
| M5 | late admission reads the batch's typed reading, not the line's | 2 |
| M6 | no line-level reuse/re-join of known lines | 2 |
| M7 | per-line partial landing instead of the batch verdict | 3 |
| M8 | outage streak counted per line | 1 |
| M9 | prefetch ignores known lines | 1 |
| M10 | `batchRefusal` loses `not_authorized` before `uncertain` | 1 |
| M11 | no short-circuit on a kept refused line | 2 |
| M12 | known lines exclude kept pending rounds | 1 |
| M13 | typed answer may stand after a line's lane verdict | 1 |
| M14 | line rows lose the batch outcome | 10 |
| M15 | `batch_ms` is the sum of the lines | 1 |

M9 and M12 survived the first version of the file; the prefetch-with-a-known-line and every-line-pending tests were added
for them.

**Offline estimate for #23 (no live calls).** Model: each line's lane time drawn independently from the 45 single-line
grok-4.5 `low` lane rounds of gates #21 and #23 (`events.jsonl`, the true round time for pending ones from the late or
resend row: p50 5.7 s, p90 12.7 s, 2 of 45 over 13 s); a per-line batch waits max(line times). Estimated per-line wait: 2
lines p50 6.8 s / p90 12.8 s / 8.7% past the cap; 3 lines 7.9 s / 13.3 s / 12.8%; 4 lines 8.6 s / 16.7%. #23's 11
multi-line rounds (observed true p50 13.4 s, 6 pending): estimated pending 1.25 on average (p90 3; at most one in 64% of
draws), capped wait 94 s against the 120 s observed. Over all 30 of #23's lane rounds (one-line ones can pend too, 2 of 45
in the pool): 2.1 pending on average, at most one in only 38% of draws -- so the acceptance "review_pending <= 1" on #24 is
not assured by this change alone. Caveats: the independence assumption (concurrent calls to one provider may share a tail
or be rate-limited), a pool mixing `resolve` and `apply` rounds, and the owner's reading of the gate. The admission-jev
bank was not used: its cases carry the lane's batch-level labels and time, not per-line times, so without live calls the
gates' own single-line rounds are the better per-line sample.

**Left open.**
- Live: no gate has run this. Gate #24 decides `review_pending`, admission's share of the critical path and first prose.
- Provider concurrency: three to four simultaneous lane calls per batch on grok-4.5 were not measured (rate limits, a shared
  tail); the foreground provider budget queues reservations if it runs short.
- `tests/play/kpi.py`'s `admission` section counts each line's row as a review, so `reviews` rises and `review_ms` sums
  concurrent calls; the call's wait is `batch_ms`. Not changed here (no pytest in scope).
- Each call reads one line with no batch-mates (the ruling); a line whose meaning depends on another (a clue beside the move
  that makes it discoverable) is judged without it. The batch still lands whole or not at all.

- 2026-09-26 (integrator): merged. The worker's open question is settled for the existing contract. A batch lands whole or not at all (§32.10; a line's consent is read with its batch-mates, e.g. a trip's time with the trip). Landing admitted lines individually (the worker's M7) is not adopted. Gate #24 checks `review_pending` and the critical path; the offline estimate is about 2 pending per 30 rounds, so "≤ 1" is not assured.
