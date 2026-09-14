# 88: 地图：PDF 中按需发现并复核地图后接入会话

Tracker synchronization: pending. GitHub reads began failing with EOF during the 2026-09-13 update, before any issue write or dependency change. This local ticket is the updated assignment body; the remote issue still has its previous text/blocking links. Status: ready-for-agent subject to the dependencies below. No owner has been assigned.

## Parent

https://github.com/Leehow/chatrpgv4/issues/85

## What to build

Let a fresh original PDF supply maps to the same session display used by built-in scenarios. The existing tool-enabled reader locates relevant maps, associates regions with authored places, distinguishes public/private versions, and publishes reviewed source-backed metadata and assets. A map first needed later in play must be prepared through the same demand-reading queue.

Scope: parent user stories 2, 24, 27, 28, 29, 30, 32, 33. All parent invariants apply. The production kernel is TypeScript; source reading uses the current tool-enabled Pi reader. This is the remaining work against an existing implementation; status and evidence below supersede the original planning-only wording.

## Status and retained evidence — 2026-09-13

Main unfinished vertical slice. PDF tools and publication consumers exist, but a useful partially revealed original-PDF map has not reached the conversation.

- [x] Exact physical-page/crop evidence, independent review and the common map consumer are implemented.
- [x] c4a95ec5 confines reader filesystem tools; b768722c adds navigation-only contact sheets; 8ce029e7 fixes the tool schema; 2fe2b3c3 fixes default image capability.
- [x] 29c75e15 provides bounded read recovery and a9c8773a bounds detail/coverage scope; neither proves successful PDF segmentation.
- [x] Concurrent commit 219081f9a makes a new retry begin with the source-based repair of an inherited failed draft; only a job resuming its own interrupted attempt may skip its completed read. Two targeted regression cases exist; new App acceptance remains outstanding.
- [x] Concurrent commit 8106f8477 fixes repeated host removal of source-wait prose: after one correction, a second prose leg may close through implicit narrate. Retained provider events contained thinking and text; prior provider-only attribution of stored thinking-only replies was incorrect. New installed-App acceptance is pending.
- [x] Cold Harvest's selected opening was published as generation 3. Map pages 17 and 23 were found, but its published graph contains zero map nodes.

## Remaining work for the next owner

- [ ] Establish a genuinely focused production detail request for the current map/arrival use, preserving necessary dependencies. Verify actual task/checkpoint selection; changing the question alone does not prove a fresh scope.
- [ ] Verify that the tested/installed candidate includes 219081f9a and demonstrate that an inherited oversized failed draft is re-scoped before review. The checkpoint repair already exists: do not reimplement it. Preserve artifacts and valid source/review evidence.
- [ ] Produce meaningful independently revealable subregions. The retained Cold Harvest draft has one whole-map region per image; that cannot satisfy partial farm knowledge. If geometry is uncertain, return unavailable/preparing rather than widening disclosure.
- [ ] Verify page/cropped-asset coordinate frames, source correspondence, annotation safety and independent review, then publish through the production path.
- [ ] In actual play, display one known region while another remains unknown; later knowledge can reveal another region. No manually authored acceptance graph, fake Keeper or direct campaign mutation.
- [ ] Keep failed-unit retries bounded and reuse completed positive units. Do not replace the existing scheduler or add a parser stack.
- [ ] Verify the installed/tested candidate includes 8106f8477 and demonstrate visible recovery after source waits/failures. The source fix already exists; the confirmed failure was repeated host text removal, separate from provider transport errors.
- [ ] Record fresh preparation and cached reuse separately, along with actual UI evidence. No extra directory access or model-name vision heuristics.

## Working boundary

Continue the current TypeScript kernel, host, ModuleStore/ModuleGraph and seven Keeper verbs. Preserve all saves, failed reading artifacts and source assets. Use original page images and tool-enabled Pi readers; no Docling, Marker, MinerU/PaddleOCR, production Python, model-name heuristics, manual acceptance graph edits or new map database/scheduler. Source and safety contract changes precede implementation. The user will assign owners: this update launches no worker and grants no unrelated push, cleanup or provider refactor. Unchecked original criteria mean not fully reconciled, not necessarily unimplemented.

## Acceptance criteria (original requirements retained)

- [ ] Import through the normal original-PDF setup path and produce an actual map in the current conversation using the shared map representation and viewer. Do not manually add map records to acceptance campaigns.
- [x] Use the existing Pi reader with read/write/edit/bash and original-page images, followed by independent source review. No OCR pipeline, bare provider completion, source-reading daemon, new Keeper, or production Python path is introduced.
- [ ] Preserve physical page identity, normalized region geometry, source revisions, depicted places and safe/public metadata. Support maps sharing a page with private prose, separate floors, and different public/private layouts without assuming a fixed page offset or aligned images.
- [ ] Validate source references and geometry mechanically; review map classification, region-place correspondence, completeness needed now, and annotation exclusion against original images. Unclear or contradicted material does not become deliverable.
- [ ] A map first requested after opening uses the current demand-reading path, priorities, deduplication and cancellation. Opening the scenario does not require locating or segmenting all maps in the book.
- [ ] Reuse accepted preparation on a later session/campaign while preserving separate campaign knowledge. Source publication alone never reveals regions.
- [ ] Cancellation, missing source, unsupported images or failed review returns a bounded explicit status, preserves all evidence, and never displays the entire source as a fallback. Distinguish failure of a visual reference from missing facts required for a game action.
- [ ] Verify fresh import plus later map discovery through the production setup/play path, image-reading evidence, reviewed publication, actual authorized pixels and a PipiCOC conversation card. Record cold and reused preparation separately; arbitrary-PDF reliability is not inferred from one sample.

## Blocked by

None (can start immediately once file ownership is clear).

Uses the implemented #86 baseline. No remaining ticket blocker. The concurrent reader-service repair was committed as 219081f9a; inspect it and recheck live ownership before further edits.
