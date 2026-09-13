# 89: 地图：续局、世界线与来源更新保留正确的已知范围

Tracker synchronization: pending. GitHub reads began failing with EOF during the 2026-09-13 update, before any issue write or dependency change. This local ticket is the updated assignment body; the remote issue still has its previous text/blocking links. Status: ready-for-agent subject to the dependencies below. No owner has been assigned.

## Parent

https://github.com/Leehow/chatrpgv4/issues/85

## What to build

Keep the same map knowledge usable across restarts, retries and the project's existing worldline operations, and prevent old map coordinates or future images from appearing in the wrong campaign, history view or source revision. Demonstrate both built-in and PDF-derived maps through the existing canonical state/history interfaces.

Scope: parent user stories 16, 21, 22, 23, 31, 32, 34. All parent invariants apply. The production kernel is TypeScript; source reading uses the current tool-enabled Pi reader. This is the remaining work against an existing implementation; status and evidence below supersede the original planning-only wording.

## Status and retained evidence — 2026-09-13

Persistent region ids/labels, historical embedded images and confluence union exist. Source-compatibility and visible worldline behavior still need verification and any required narrow repair.

- [x] Built-in card restart and independent campaign checks are retained.
- [x] Delivered cards embed delivery-time bytes; current worldline confluence unions region knowledge under the existing policy.

## Remaining work for the next owner

- [ ] Exercise a source/geometry update that retains region ids. Establish whether current publication/state interfaces can reuse old knowledge against changed geometry; a new image/view hash alone is not an authorization rule.
- [ ] Record the exact compatible-correction versus incompatible-change decision in the canonical contract before implementation, using existing state/history boundaries.
- [ ] Keep old cards byte-stable and current-map reads bound to active compatible sources and authorized knowledge; report unavailable updates honestly.
- [ ] Demonstrate fork, switch and confluence with different known sets and no stale foreign-line image selection.
- [ ] Cover legacy saves, separate campaigns, replay and interrupted transactions with current TypeScript interfaces.
- [ ] Use both accepted producer paths and actual UI evidence; do not reinterpret immutable generation directories as proof that old reveal semantics remain compatible.

## Working boundary

Continue the current TypeScript kernel, host, ModuleStore/ModuleGraph and seven Keeper verbs. Preserve all saves, failed reading artifacts and source assets. Use original page images and tool-enabled Pi readers; no Docling, Marker, MinerU/PaddleOCR, production Python, model-name heuristics, manual acceptance graph edits or new map database/scheduler. Source and safety contract changes precede implementation. The user will assign owners: this update launches no worker and grants no unrelated push, cleanup or provider refactor. Unchecked original criteria mean not fully reconciled, not necessarily unimplemented.

## Acceptance criteria (original requirements retained)

- [ ] After normal exit/resume, known regions and delivered maps are available without re-reading accepted source material or losing disclosure. Call session.resume first when a test continues an existing campaign.
- [ ] Two campaigns sharing one prepared module have independent knowledge and derivative authorization. Missing map state in a legacy save defaults conservatively; visits or unqualified handout markers do not imply a full reveal.
- [ ] Replay and interrupted transactions preserve exactly-once disclosure and recover through the existing campaign history/transaction machinery, without a second map-state store.
- [ ] Historical conversation cards retain the knowledge snapshot and source revision that authorized their delivery. Reopening an old card cannot silently substitute a more-revealing current image; a current-map action uses the active state.
- [ ] Fork, switch and confluence use existing worldline knowledge semantics, including explicitly supported retained knowledge, without introducing new memory rules. No foreign-line derivative is selected by a stale UI cache.
- [ ] Bind map identities, region geometry and generated views to immutable source revisions. A compatible correction is explicit; incompatible source geometry requires review before publication rather than applying old reveal coordinates to changed pixels.
- [x] Preserve campaign history, source versions, transcript, event flow, map assets and all acceptance evidence. Do not rewrite old receipts or automatically migrate unrelated campaigns.
- [ ] Verify the visible result after restart, campaign switching, historical viewing, existing worldline operations and controlled source revision changes. Use current TypeScript interfaces and actual UI inspection; frozen historical oracle data remains unchanged.

## Blocked by

- https://github.com/Leehow/chatrpgv4/issues/87
- https://github.com/Leehow/chatrpgv4/issues/88

Read-only investigation and test design may start early; final implementation/integration waits for #87 and #88 to stabilize the shared representation.
