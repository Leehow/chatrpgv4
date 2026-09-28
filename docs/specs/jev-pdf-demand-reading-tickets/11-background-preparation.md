# JPDF-11: Continuous background preparation yields to actual demand

Status: ready-for-agent
Execution: authorized; waiting on declared blockers.
Parent: [Jev PDF demand reading](../jev-pdf-demand-reading.md), D0/D5/D10/D12.

## Required prototype evidence

Read the [mandatory prototype-use gate and ticket 11 evidence map](../jev-pdf-demand-reading-tickets.md#required-prototype-evidence) before implementation or acceptance work. [Prototype report](../../research/jev-playable-entry-prototype-20260927.md).

Read schedule.mjs, the source gate ports and the actual scheduling events. Carry forward foreground dispatch and the 74.2-second background pause/resume, with in-flight calls, provider delay and unresolved parameter limits kept explicit.

## What to build

After the small foreground brief is usable, the existing source queue continuously reads, independently reviews and publishes remaining module material using available capacity. Selected-opening preparation and current player demands take priority. Accepted work is reused as play advances, without waiting for complete book extraction.

## Blocked by

- [JPDF-05 — Playable first scene and dependency lifecycle](05-opening-dependencies.md).

## Acceptance criteria

- [ ] Before work, record the pinned prototype commit/files, an observed case/outcome and its production mapping in this ticket; include them in any delegated assignment.
- [ ] At review, provide prototype decision/case → implementation location → verification evidence, with reasons/evidence for deviations. Missing correspondence or an unexplained deviation fails acceptance.
- [ ] Contract priority, bounded work units, pause/resume, promotion and source validity through the existing queue before code. No second importer or authoritative fact graph.
- [ ] A real remaining source unit advances through independent review/publication without a new player request, while creation/play is available and other ranges remain pending.
- [ ] Current creation/play demand receives capacity before speculative work; selected-opening preparation precedes unrelated book work. Record queue wait and the actual boundary at which background work yields.
- [ ] An actual demand for a pending background unit promotes or joins that work and receives accepted evidence, without duplicating the same expensive read or using an unfinished draft as fact.
- [ ] Already running provider calls have explicit yield/cancellation behavior; a background job cannot reserve all future capacity for an unbounded full-book task. Measure residual foreground delay instead of assuming instant preemption.
- [ ] Restart preserves accepted results and pending ranges. Source/opening changes revalidate affected work. Available capacity resumes background progress after foreground demand subsides.
- [ ] Budget exhaustion, provider failure and unfinished coverage remain visible as pending/paused work; they neither claim completeness nor revoke unrelated accepted readiness.
- [ ] Report foreground, selected-opening and remaining-background cost with a non-duplicated total. Background completion has its own state and never gates creation or an already prepared scene.

## Verification

Use existing source preparation and actual request/publication events to observe autonomous background progress, foreground promotion, evidence reuse and resumed progress. Controlled scheduling tests establish queue ownership and recovery; a live native source probe measures provider contention, and JPDF-09 verifies the player experience through the canonical RPC driver.

## Scope boundary

Extend source scheduling only. No provider infrastructure change, new generic scheduler, full-book foreground extraction, synthetic play or relaxation of evidence/review rules.

## Comments

2026-09-27: Added for the owner's clarified requirement that later content keeps parsing in the background. On-demand lookup alone does not deliver this behavior.

2026-09-28 implementation correspondence: minimal-entry 0a7a63ad8117f80a301c80c515e91245ab084b52 schedule.mjs records a 74.2 s cooperative background pause; production uses ReadingService.waitForPriority at the existing provider reservation handshake, not the prototype file flag. The already granted request completes; later grants wait without spending budget or tripping the stall watchdog. reading-service.test.mjs and jev-provider-budget.test.mjs cover yield/resume and real child dispatch; ts-kernel-modules.test.mjs covers deferred detail promotion, exact closure and neighboring-scene advance. The Blood calibration run records index read-2 priority_resumed after 157,706 ms followed by handoff on evaluation shutdown; this is real scheduling evidence, not whole-book completion. Original pre-code mapping was in shared source work; this late individual-ticket correspondence is not represented as a prior comment. Whole-book completion and total cost remain open.
