# JPDF-02: Read and review without passive image replay

Status: ready-for-agent
Execution: authorized; waiting on declared blockers.
Parent: [Jev PDF demand reading](../jev-pdf-demand-reading.md), D7/D10 and T1/T3.

## Required prototype evidence

Read the [mandatory prototype-use gate and ticket 02 evidence map](../jev-pdf-demand-reading-tickets.md#required-prototype-evidence) before implementation or acceptance work. [Prototype report 1](../../research/jev-pdf-sandbox-20260927.md); [Prototype report 2](../../research/jev-playable-entry-prototype-20260927.md).

Read the image-context experiment and actual reader/provider image traces. Carry forward the adverse first-use eviction/window results and distinguish active evidence, passive replay, explicit reopen and retry.

## What to build

A reader or independent reviewer retains its active source evidence, records sourced work, and retires completed image history without repeatedly reopening the same evidence. Select the window/checkpoint policy from sandbox results, measuring complete task cost rather than merely minimizing images per request.

## Blocked by

- [JPDF-01 — Comparable imports and dependency evidence](01-baseline-and-coverage.md).

## Acceptance criteria

- [ ] Before work, record the pinned prototype commit/files, an observed case/outcome and its production mapping in this ticket; include them in any delegated assignment.
- [ ] At review, provide prototype decision/case → implementation location → verification evidence, with reasons/evidence for deviations. Missing correspondence or an unexplained deviation fails acceptance.
- [ ] Amend the image lifecycle contract before code. Preserve the recorded transcript and all original evidence while changing outgoing request projection only.
- [ ] Identify images by source/page/crop/render identity for accounting. First images in multi-image tool results reach a successful inference opportunity before passive eviction.
- [ ] The selected active-window/checkpoint policy lowers complete task input/payload without increasing avoidable reopens or losing active evidence. Reader-authored sourced artifacts and source locators remain accessible; no model-generated replacement text is mislabeled exact original evidence.
- [ ] Explicit reopening, a different crop/resolution, and an independent review each remain legitimate new reads and are separately counted.
- [ ] A failed provider request, retry, cancellation, repeated context hook or interrupted run cannot silently consume an unseen image or suppress the retry's needed payload. Report uncertainty when transport cannot prove consumption.
- [ ] Existing reader confinement, viewed-page checks, numeric/semantic rejection and publication remain effective across author and reviewer phases.
- [ ] Replay frozen logs to quantify avoidable payload under the proposed policy, then run a real tool-enabled source task to prove retained quality and actual outgoing behavior. Counterfactual replay is labeled and never reported as measured token or wall-time reduction.

## Verification

Test through the actual context/provider seam, including first-use failure and explicit reread. Inspect the resulting accepted material and real image-delivery trace. Compare image projection alone against the frozen source task before attributing savings to Jev. Full import quality and speed remain JPDF-09's gate.

## Scope boundary

No provider swap, resolution reduction, source-review weakening or vendor upgrade. Keep notes and current images sufficient for the reader's existing work; do not prescribe irreversible eviction solely from a context-hook notification.

## Comments

2026-09-28 live evidence: the correctly configured source UI's Blood Road opening author used 845,105 input tokens over 22 model actions. The image log shows the initial six host pages shrinking to one, then zero; passive tool-image windows remained during subsequent draft/schema repair. This does not support blaming all of the cost on host-image replay. The next change retires successfully delivered source images only after a submission has left a parseable candidate/review checkpoint, while an explicit PDF reopen remains a fresh first delivery. Source/render hashes also replace positional identity for host images so moving a projection cannot accidentally reset delivery history. Unit checks cover the failed-first-delivery case, changed message position, retained transcript and explicit reopen. Live cost/quality comparison remains open; no savings are inferred from the static projection check alone.

2026-09-27: Independent of the Jev navigation implementation once the baseline is frozen.

2026-09-27 sandbox correction: first-use immediate eviction is not accepted. One Node-pinned Blood Road rerun increased total input from 177,286 to 205,648 and elapsed time from 122.4 to 148.2 seconds, with different but independently reviewed 55/57-row dossiers. Build tracing later showed both used a common older emitted reader context; this is exploratory counterevidence, not current product performance. A four-image window also failed to show stable overall savings and hit a provider timeout. See the [full report](../../research/jev-pdf-sandbox-20260927.md); select an active-work/checkpoint policy only after it improves complete-task cost and quality under the current source contract.

Implementation mapping recorded after the first source-run changes, before image-lifecycle acceptance: pinned first sandbox commit `7c073a5f104607f6631f1ed99a797393f79e9bdb`, `experiments/jev-pdf-demand/image-context.mjs` used a `message_end` success signal but retired every image after first use; its controlled repetitions above disproved a blanket first-use policy. Pinned minimal-entry commit `0a7a63ad8117f80a301c80c515e91245ab084b52` retained source/provider image traces but did not establish a whole-product image saving. The present production mapping is narrower: `reader-context.ts` keeps first/new images through unsuccessful transport and marks them sent only after a successful assistant message; `reader-image-delivery.ts`, `reader-submit.ts`, `reader-review.ts` and `reading-service.ts` require the successful, source-bound receipt for tool or host-projected original images; the source driver projects a bounded original-page set before inference. Host images retire from later passive replay only after an actual `submit_reading` attempt, with explicit PDF reopen still possible. This avoids the prototype's first-use retirement. The initial cold Blood Road host-projection attempt `jpdf-guidance-blood-03` was adverse: eight images plus a missing `node_refs` schema repair raised the first creation wait from 82 to 114 s and increased new input; it is not used to claim savings. A stricter top-level submission schema, reviewer original-page projection and post-submit image retirement now require a fresh matched measurement. These changes were made before this mapping was written; the timing deviation is retained rather than presented as prior approval evidence.
