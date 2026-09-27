# JPDF-03: Minimal module brief unlocks character creation

Status: ready-for-agent
Execution: authorized; waiting on declared blockers.
Parent: [Jev PDF demand reading](../jev-pdf-demand-reading.md), D0–D3/D9.

## Required prototype evidence

Read the [mandatory prototype-use gate and ticket 03 evidence map](../jev-pdf-demand-reading-tickets.md#required-prototype-evidence) before implementation or acceptance work. [Prototype report](../../research/jev-playable-entry-prototype-20260927.md).

Read the minimal brief task, native navigation code and author/review runs. Carry forward the missed car/Driving constraint, parent/child directory-range fix and field-level completeness checks.

## What to build

Import an original PDF and deliver the small reviewed brief needed to start character creation: era, place, premise, investigator suitability, creation constraints and necessary opening choices. Reusable native-source/Jev navigation supplies exact leads and retains access to the whole bound source.

## Blocked by

- [JPDF-10 — Native source driver](10-native-source-driver.md).

## Acceptance criteria

- [ ] Before work, record the pinned prototype commit/files, an observed case/outcome and its production mapping in this ticket; include them in any delegated assignment.
- [ ] At review, provide prototype decision/case → implementation location → verification evidence, with reasons/evidence for deviations. Missing correspondence or an unexplained deviation fails acceptance.
- [ ] Amend the source navigation/cache/index contract and register model call sites before implementation. Reuse existing source, Jev and task owners.
- [ ] Actual creation becomes usable while unrelated chapters and profiles remain pending. The gate neither waits for all-page semantic classification nor requests a full first-scene/NPC dossier; measure PDF-to-creation time.
- [ ] Check each required creation field against source instructions, including constraints omitted from an otherwise truthful draft. Retain the observed Blood Road car/Driving requirement as a grounded regression. Native parent-section ranges include descendants; source navigation caps are not completeness flags.
- [ ] Account for every physical page and exact source ranges; distinguish usable text, empty/error/uncertain text and unresolved visual coverage. Preserve physical-page/printed-label distinctions.
- [ ] A fresh source with no prepared entity graph can locate an authored opening and a distant topic using bounded batches of actual source content. No lexical prefilter or page-role hard filter silently removes recall candidates.
- [ ] Retain partial-answer/context leads and uncertain results under a calibrated policy. Closed candidates are host-owned; Jev does not generate facts, names or source locations.
- [ ] The real skeleton/index consumer uses navigation output. It reopens required original pages and publishes through existing independent review; Jev labels alone cannot satisfy viewed-source/index-complete gates.
- [ ] Reader-built section names and relationships remain tool-enabled text work. Ordinary fallback works when Jev is absent, times out or returns incomplete batches; gaps survive in telemetry/state.
- [ ] Cache identity includes source and relevant extraction/model/policy versions, supports cancellation/restart and does not rebuild merely because a new job ID was minted. Source mutation or another edition rejects reuse.
- [ ] Repeated unchanged navigation reuses results. First-setup and background indexing costs are separately visible, including fallback and partial coverage.
- [ ] Native source policy offers actual structural scopes and whole-source fallback. Jev may choose cited/adjacent/section material before a whole-book pass; failed local coverage expands without claiming absence.
- [ ] Located but unselected candidates and unsearched ranges remain available with provenance. A fixed top-k selection is not the scope-complete flag.

## Verification

Exercise fresh PDF preparation through the public host service and real TypeScript publication with deterministic boundary cases, then real Jev and tool-enabled readers on the two bound books. Trace navigation producer → reader task → accepted skeleton/opening choices. Report locating quality separately from end-to-end latency.

## Scope boundary

This slice establishes the creation gate and reusable navigation. Full index completion is separate background work. It preserves the existing visual fallback; improved mixed/scanned discovery belongs to JPDF-04 and first-scene preparation to JPDF-05. No full authoritative graph, OCR service or new retrieval framework.

## Comments

2026-09-27: The current fresh navigator is optional and skeleton-only; acceptance requires a demonstrated consumer path, not merely enabling its flags.
