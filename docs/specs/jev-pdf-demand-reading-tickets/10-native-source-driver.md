# JPDF-10: A real source task runs through Pi's existing RunDriver

Status: ready-for-agent
Execution: authorized; native sandbox evidence exists, production integration waits on JPDF-01.
Parent: [Jev PDF demand reading](../jev-pdf-demand-reading.md), D1/D4/D11 and T1.

## Required prototype evidence

Read the [mandatory prototype-use gate and ticket 10 evidence map](../jev-pdf-demand-reading-tickets.md#required-prototype-evidence) before implementation or acceptance work. [Prototype report 1](../../research/jev-native-pi-reader-20260927.md); [Prototype report 2](../../research/jev-playable-entry-prototype-20260927.md).

Read both native runners and source policies, then an actual run/step/operation trace. Preserve SessionRunDriver injection, host-owned IO, real tool/result pairing and explicit source-artifact completion; adapt the research-only completion/checker to production.

## What to build

A source request enters the current vendored Pi through SessionRunDriver, uses Jev for genuinely open reading decisions and host operations for deterministic reads, enters the real model/tool path when needed, and returns a formally validated source artifact through the existing source owner.

## Blocked by

- [JPDF-01 — Comparable imports and dependency evidence](01-baseline-and-coverage.md).

## Acceptance criteria

- [ ] Before work, record the pinned prototype commit/files, an observed case/outcome and its production mapping in this ticket; include them in any delegated assignment.
- [ ] At review, provide prototype decision/case → implementation location → verification evidence, with reasons/evidence for deviations. Missing correspondence or an unexplained deviation fails acceptance.
- [ ] Freeze the source-run entry, task/source identity, budget/cancellation, projection, artifact completion and existing publication boundaries in the RPC contract before code.
- [ ] One existing source-answer request completes through real Pi run_start → decide/operate → infer where required → source submission, with actual source owner checks and no fabricated assistant/tool result or player-delivery receipt.
- [ ] Reader launcher injects the reading policy and ports. Setting an environment flag on the ordinary CLI alone does not pass. Setup's outer session need not migrate merely to give its reader child the native driver.
- [ ] Keep policy transitions pure over recorded observations; source bytes, network, I/O and side effects belong to ports. Do not introduce a second TaskRuntime or outer semantic loop.
- [ ] Model proposals use Pi's actual tool hooks and paired results once. Structural continuations execute directly; Jev is not asked to approve an already fixed next step.
- [ ] Source navigation has one consumer for incomplete pagination and open source questions. Repeated searches of the same initial 50-page window cannot masquerade as complete discovery. Keep exact-page/crop and visual overview access; verify required unknown material returns through the native source policy.
- [ ] A real newly discovered source need re-enters the same RunDriver, receives Jev-selected material and returns to the reader before dependent completion. Unavailable/unchanged failed steps preserve partial evidence and do not spin until maxSteps.
- [ ] Source projections bind exact source/image identity and recipient; author/reviewer remain separate contexts. Reuse existing SourceRef and independent source gates, not the sandbox's simplified dossier checker.
- [ ] Production artifact completion has an explicit status/evidence contract; the sandbox's undelivered/source_artifact_complete accounting is not shipped as a misleading player-turn failure or fake delivery.
- [ ] The actual launched Pi build matches the source being measured. Inference inventory and source-mode entry/exit evidence identify the new route.

## Verification

Use the existing public source request through real Pi and real TypeScript source finish/answer checks. Prove read/decision before the first model call, actual provider usage, no hidden continue loop and a required dependent reread. The [native sandbox](../../research/jev-native-pi-reader-20260927.md) supplies architectural and adverse evidence; its dossiers are not publication acceptance.

## Scope boundary

This is a narrow native source vertical, not a rewrite of Pi, the Keeper engine, setup conversation, all subprocess families or the PDF importer. JPDF-03 extends navigation strategy; JPDF-05/06/07 cover its concrete preparation consumers.

## Comments

2026-09-27: Added after the user pointed out that Pi already embeds RunDriver/Jev. The earlier sidecar-prefilter prototype cannot satisfy this ticket. Source questions, routing and operations must appear in the real Pi run trace.
