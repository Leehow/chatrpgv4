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
