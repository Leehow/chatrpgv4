# JPDF-12: Show public module facts as preparation progresses

Status: ready-for-agent
Execution: authorized; waiting on declared blockers.
Parent: [Jev PDF demand reading](../jev-pdf-demand-reading.md), D14 and user stories 38–39.

## Required prototype evidence

Read the [mandatory prototype-use gate and ticket 12 evidence map](../jev-pdf-demand-reading-tickets.md#required-prototype-evidence) before implementation or acceptance work. [Prototype report](../../research/jev-playable-entry-prototype-20260927.md).

Read the real source event/measurement flow and minimal brief outcomes together with spec D14. There is no tested product UI prototype; prove real field events reach the public panel rather than treating the timing-report slider as UI acceptance.

## What to build

While the creation brief is being prepared, the existing onboarding panel shows the real state of a few public fields and retains each available result: era, starting place, public premise and source-backed character advice or warnings. The player can follow meaningful progress and begin creation as soon as its actual gate passes; advice does not constrain the confirmed card.

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

Prototype-to-production mapping before code: minimal-entry commit `0a7a63ad8117f80a301c80c515e91245ab084b52`, `experiments/jev-playable-entry/run.mjs` and the retained 49.2/73.1 s Blood Road/Masks source briefs show that the player waits for the few public setup facts, while locator calls finish much earlier. The prototype's timing slider was diagnostic only and supplied no UI field events. Production therefore uses the existing `ReadingService.progress` → onboarding worker progress line → `CocOnboarding` status region; it projects only public fields from the checked author candidate and confirms them after accepted publication. The host persists the latest field snapshot under the current source/opening/phase attempt. The missing UI prototype is an explicit deviation: final verification must observe a real progressing source read in the panel, not a timer mock or screenshot of the timing report.

Source UI evidence, 2026-09-28: the actual local browser host imported the original Blood Road PDF into `.pi/jpdf-ui-live-home`, with the visible model set to Grok 4.5/low. Import `62f54f21-99b7-4468-8ca3-32937305c52f` records searching at 03:55:26.761 UTC, found/checking at 03:56:11.632/634 and confirmed at 03:56:32.808. All values were source-reviewed before display; the creation brief took 66.0 s, which still misses the separate 60 s target. The browser showed checking labels and later retained the four confirmed values during opening work. Reload recovered them from the host snapshot. Screenshot: `output/playwright/jpdf/public-confirmed-during-opening.png`; worker/public artifacts remain under the import and module stores. The visible advice retains the 55% source warning and explicitly leaves character choices with the player.

The first UI pass exposed two integration gaps: confirmed values disappeared when onboarding switched to the preparation overlay, so that overlay now retains era/place in its folded header and all four fields in its body; unrelated background-index progress could overwrite the opening stage, so worker progress now filters by the actual reading purpose. The screenshot verifies the retained overlay after reload. Public wording also contained an instruction to the setup guide; the source author/reviewer prompt now requires direct player-facing wording. Mixed confirmed/needs-choice values still need live Masks evidence. The in-app browser rejected local URLs; the project-approved Playwright CLI drove a real Chromium browser instead. No packaged App was built or replaced.

Follow-up audit: this first browser host had an isolated source profile with no Jev vault secret. Its managed preparation settings correctly cleared the inherited CLI key, so the 66.0 s brief and the later slow opening used the documented ordinary Pi visual fallback, not the native Jev driver. No `source-driver.jsonl` exists for that import. The UI transport/persistence evidence remains valid; this run is invalid as Jev speed evidence. The next source host reads the existing App vault through its explicit `vaultDir` option, without copying credentials or weakening the managed-settings boundary.

The correctly bound native source UI uses `.pi/jpdf-ui-native-home`, import `21d6064d-efdf-4e55-9a90-6461df7521e2`. Its `read-1`/`read-3` directories contain actual RunDriver/Jev traces and checked completion receipts. The visible Grok 4.5/low interface showed source searching, then confirmed public facts retained during creation and opening preparation; `output/playwright/jpdf/native-public-searching.png` and `native-public-confirmed.png` were captured and visually inspected. Guidance searching began at 04:16:28.114 UTC and fields were confirmed at 04:17:57.329 (89.2 s, failing the 60 s cap). The author had to reopen the omitted opening page after initial image selection; candidate ordering has since been corrected. The first interaction published at 04:21:41.431, about 223 s after its start. These are real source/UI results, not completed-card or first-player-action timings. Cost and latency acceptance remain open.
