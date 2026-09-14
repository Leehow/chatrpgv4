# 90: 地图：在当前会话随时回看已知地图与楼层

Tracker synchronization: pending. GitHub reads began failing with EOF during the 2026-09-13 update, before any issue write or dependency change. This local ticket is the updated assignment body; the remote issue still has its previous text/blocking links. Status: ready-for-agent subject to the dependencies below. No owner has been assigned.

## Parent

https://github.com/Leehow/chatrpgv4/issues/85

## What to build

Complete everyday session access: the player can ask for a map naturally, reopen already available maps directly, zoom and pan, and select among already-known maps or floors without spending a turn. Reuse the first slice's map projection and image module; this slice can proceed without waiting for the richer disclosure and PDF producers because both use that same contract.

Scope: parent user stories 3, 4, 5, 6, 8, 18, 19, 24. All parent invariants apply. The production kernel is TypeScript; source reading uses the current tool-enabled Pi reader. This is the remaining work against an existing implementation; status and evidence below supersede the original planning-only wording.

## Status and retained evidence — 2026-09-13

The conversation map card, local zoom and supplied known-level selector exist. Multi-map/navigation/failure-state acceptance remains incomplete.

- [x] The built-in card was opened, zoomed and reopened after App restart without another model request.
- [x] Focused UI tests exercise level selection and absence of an image for an unavailable map.

## Remaining work for the next owner

- [ ] Demonstrate two known maps with similar labels retaining separate identities and historical cards.
- [ ] Make already-available maps discoverable through current conversation/viewer affordances, without adding a general map-management subsystem.
- [ ] Verify practical pan/scroll at zoom and known-only map/floor controls, including tooltips, thumbnails and accessibility metadata.
- [ ] Prove viewer operations do not call a model or change time, RNG, receipts, items, clues or map knowledge.
- [ ] Exercise missing-byte/unavailable recovery, preserve normal handouts and retain player-language labels.
- [ ] Repair only gaps demonstrated in the existing viewer; collect real App interaction evidence.

## Working boundary

Continue the current TypeScript kernel, host, ModuleStore/ModuleGraph and seven Keeper verbs. Preserve all saves, failed reading artifacts and source assets. Use original page images and tool-enabled Pi readers; no Docling, Marker, MinerU/PaddleOCR, production Python, model-name heuristics, manual acceptance graph edits or new map database/scheduler. Source and safety contract changes precede implementation. The user will assign owners: this update launches no worker and grants no unrelated push, cleanup or provider refactor. Unchecked original criteria mean not fully reconciled, not necessarily unimplemented.

## Acceptance criteria (original requirements retained)

- [ ] The Keeper can place the useful current map in its normal structured delivery, and a natural request for the map receives the appropriate existing public view without revealing new regions.
- [ ] Provide a discoverable current-session entry for already available maps, plus usable zoom/pan and known-only map/floor selection. Opening or navigating these views requires no new model request.
- [ ] Every viewer operation is read-only: no fictional time, movement, RNG, receipts, item/clue acquisition or additional map disclosure. A viewer action is not a synthetic Keeper turn.
- [ ] Map names, floor tabs, thumbnails, tooltips, accessibility text and empty/error states reveal no unknown region or private source metadata.
- [ ] Multiple maps retain their identities even with similar names, and selecting a map does not replace a different historical card. Honor the source/knowledge view identities established in the first slice.
- [x] Use the existing open play-language projection for interface text and added labels. Preserve authored source lettering and physical-handout text; do not add language-specific tables or pixel-translation machinery.
- [ ] Render valid images as images, with honest unavailable/preparing states and a recoverable missing-byte experience. Keep the existing text-handout and non-map conversation flows working.
- [ ] Verify real PipiCOC interactions and the existing UI/asset interfaces, including no-model/no-state-change reopening. A screenshot of an external source viewer or a file link alone does not satisfy session display.

## Blocked by

None (can start immediately once file ownership is clear).

Uses the implemented #86 baseline and can run in parallel with #87/#88. Coordinate any shared host image-contract changes rather than editing concurrently.
