# JPDF-04: Visual gaps remain discoverable

Status: ready-for-agent
Execution: authorized; waiting on declared blockers.
Parent: [Jev PDF demand reading](../jev-pdf-demand-reading.md), D2/D7 and visual cases in T2/T4.

## Required prototype evidence

Read the [mandatory prototype-use gate and ticket 04 evidence map](../jev-pdf-demand-reading-tickets.md#required-prototype-evidence) before implementation or acceptance work. [Prototype report 1](../../research/jev-native-pi-reader-20260927.md); [Prototype report 2](../../research/jev-playable-entry-prototype-20260927.md).

Read source materialization and searched/unsearched/empty-page evidence. Preserve exact original-page access and explicit visual gaps; the prototype does not establish scanned/mixed-source coverage.

## What to build

A requested map, handout, table or other visual source remains findable when native text is absent, misleading or coexists with important visual content. The locator hands the real reader original-page candidates with honest coverage.

## Blocked by

- [JPDF-03 — Whole-source Jev navigation](03-fresh-navigation.md).

## Acceptance criteria

- [ ] Before work, record the pinned prototype commit/files, an observed case/outcome and its production mapping in this ticket; include them in any delegated assignment.
- [ ] At review, provide prototype decision/case → implementation location → verification evidence, with reasons/evidence for deviations. Missing correspondence or an unexplained deviation fails acceptance.
- [ ] Extend the navigation coverage contract to preserve independent text and visual observations; a text-rich page is never automatically visually complete.
- [ ] Demonstrate candidate discovery for both sparse/scanned pages and text-rich pages containing relevant visual material, through native references and bounded visual navigation.
- [ ] Overview sheets nominate pages only. Readers and independent reviewers reopen originals/crops at sufficient resolution before any source fact, number, map region or handout is accepted.
- [ ] Preserve map/text connectivity, physical-page identity and reveal boundaries; private annotations cannot leak through accelerated retrieval.
- [ ] No OCR, character-density threshold or image-object heuristic supplies a semantic verdict. Unavailable/ambiguous evidence remains unresolved and resumable.
- [ ] Record all visual discovery, fallback and review costs. A fallback requiring substantial scanning is reported honestly, not hidden behind a fast text-stage metric.
- [ ] A later need can revisit an unresolved visual candidate without discarding accepted textual navigation or declaring the original page empty.

## Verification

Use held-out source cases with sparse maps, mixed pages and layout-sensitive parameters at the same public source/read/review seam. Include a synthetic isolation test where a textual match exists but the decisive information is visual. Synthetic tests supplement the original-book evidence.

## Scope boundary

Keep the existing page renderer, overview and source-review ownership. No second asset importer or blanket up-front high-resolution read of all pages; scanned-source parity with native-text speed is not promised.

## Comments

2026-09-27: Can proceed alongside JPDF-05 after shared navigation is available; both serialize changes to shared source interfaces.

Implementation mapping: native prototype `4ba527fdf06bb0429b3984ac4ceab4e95ea38ec2` and minimal-entry `0a7a63ad8117f80a301c80c515e91245ab084b52`, their source materialization and coverage records, demonstrate exact original-page/crop access but do not establish scanned-source completeness. Production retains the existing PDF info/search/overview/pages tools and independent review. The native catalog now records structural text availability per physical page and keeps visual coverage explicitly unassessed for text-rich pages too. A map request first reuses the source index's exact scene identity to choose its map candidates; unknown identity retains ordinary broader discovery. The original-image submission gate continues to reject overview-only evidence. Original-book held-out visual cases remain an acceptance gate.
