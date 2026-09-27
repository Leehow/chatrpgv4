# JPDF-12: Show public module facts as preparation progresses

Status: ready-for-agent
Execution: authorized; waiting on declared blockers.
Parent: [Jev PDF demand reading](../jev-pdf-demand-reading.md), D14 and user stories 38–39.

## Required prototype evidence

Read the [mandatory prototype-use gate and ticket 12 evidence map](../jev-pdf-demand-reading-tickets.md#required-prototype-evidence) before implementation or acceptance work. [Prototype report](../../research/jev-playable-entry-prototype-20260927.md).

Read the real source event/measurement flow and minimal brief outcomes together with spec D14. There is no tested product UI prototype; prove real field events reach the public panel rather than treating the timing-report slider as UI acceptance.

## What to build

While the creation brief is being prepared, the existing onboarding panel shows the real state of a few public fields and retains each available result: era, starting place, public premise and character requirements. The player can follow meaningful progress and begin creation as soon as its actual gate passes.

## Blocked by

- [JPDF-03 — Minimal module brief](03-fresh-navigation.md).

## Acceptance criteria

- [ ] Before work, record the pinned prototype commit/files, an observed case/outcome and its production mapping in this ticket; include them in any delegated assignment.
- [ ] At review, provide prototype decision/case → implementation location → verification evidence, with reasons/evidence for deviations. Missing correspondence or an unexplained deviation fails acceptance.
- [ ] Contract public field updates and their source/opening/job/attempt bindings before code. Use the existing worker progress channel, host snapshot and onboarding panel.
- [ ] A public field changes from searching/checking to its confirmed value while other fields remain pending. Several fields may advance together or concurrently; no timed imitation of progress.
- [ ] A candidate value appears only when eligible for player disclosure and remains visibly provisional until its required checks pass. Unavailable or ambiguous values are not rendered as confirmed facts or source absence.
- [ ] Confirmed values remain visible during later work. Restart/reconnect reconstructs the public snapshot, stale attempts cannot overwrite it, and a changed opening invalidates affected fields such as era.
- [ ] Neither activity text nor values expose private identities, later plot, clue solutions, confidential chapter titles or raw reader questions. The host supplies an explicit public projection; the UI never derives labels from private trace text.
- [ ] Reuse existing English-source/presenter/cache language behavior. No language table, keyword-based secrecy filter or separate LLM call for each progress update.
- [ ] Reuse the current accessible status region; avoid repeated interrupting announcements, fabricated percentages or unsupported remaining-time claims.
- [ ] The actual creation gate still controls entry. Completed fields do not imply a playable opening, and cosmetic progress never delays an already usable creation flow.

## Verification

Trace a real bounded source field through worker → host projection → rendered row. Use the existing onboarding tests for mixed pending/confirmed fields, provisional values, stale events, source/opening changes and reconnect. Inspect the actual panel with a progressing source task; a timer-driven mock does not prove integration. Installed-App packaging remains a separately authorized gate.

## Scope boundary

Preparation status and public field results only. No new onboarding questions, overall UI redesign, changed source-readiness rules, per-tick prose generator or production packaging.

## Comments

2026-09-27: Added after the owner requested visible non-spoiler results during the 49/73-second preparation wait. This improves the wait experience while the latency work remains active.
