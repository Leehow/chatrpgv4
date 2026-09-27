Status: ready (filed 2026-09-26, owner's choice after long gate #23: "拆条并行 + 长线改 Jev"; batch 18; P1 latency)
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
