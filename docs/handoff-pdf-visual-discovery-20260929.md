# PDF visual discovery and image delivery handoff — 2026-09-29

## Stop instruction and repository state

The user requested: “你这先提交然后写交接文档，你没有额度了”. Implementation, packaging and testing stopped at this point. This document records existing evidence; it does not claim a new verification run.

- Checkout: `/Users/haoli/leehow/code/chatrpgv4-wt-pi-coc-v2`.
- Branch: `0.9.6a`; working tree was clean before this document.
- HEAD at handoff preparation: `7d83b8fc7`, an external merge involving `claude/lane-thinking-off-20260929`. Do not undo or absorb another task's work.
- This task's implementation is already committed in the three commits below. No code remains waiting to be committed.
- The latest installed App contains `9d721814da2293e2fe5f86c68fe4d9cce47091c4`, not the newer repository HEAD. The newer external lane fix has not been packaged or verified by this task.
- Historical `0.9.5a` was preserved at `58f5889d3341b7d90fcc9e7cf0fe4108530579b6`.
- No worktree was created or adopted by this task. Last process check found no task-owned prototype, test or package process. An unrelated Claude remote-test probe was running and was left alone.

## Intent and acceptance boundary

Make PDF maps and pictures discoverable and usable after the Jev text optimization, without delaying character creation or the playable opening. Jev handles text and bounded choices; a tool-enabled Pi reader handles vision. The host owns source references, original-pixel extraction and publication. Background work publishes incrementally.

The user prioritizes module logic and relationships over exhaustive parameter transcription. Character guidance is advisory, never a forced build restriction. Use Grok Build Grok 4.5 / low, following the user's override of the older 4.7 default.

**Status: source discovery, asset publication and image display are implemented. Full live acceptance is still open:** an existing newspaper image was visibly displayed in the App, but a new image delivery and a map reveal in natural play were blocked before completion.

## Commits and implementation

### `9cb667f3317b12bec83b9e14cc6d235defc3606d`

Discover PDF visuals in background and publish independently reviewed assets.

The existing reading queue now has two bounded detail-job forms:

1. `visual_scan: {first,last}`: at most 20 physical PDF pages per contact sheet, one queued/running scan per module. Vision Pi returns only `visual_candidates` with page, closed kind and label. Labels are private navigation hints, not module facts. Successful overview delivery is checked before publication. Overview-only tasks need no original-page request log. They do not grant scene readiness.
2. `visual_asset: {page}`: at most two queued/running asset jobs by read-ahead; maps and handouts precede illustrations. The nominated original page goes directly to the reader. Existing extraction, review and publication produce individual assets and graph links. Text relevance cannot discard a visual candidate. Original-page evidence remains mandatory, even for an empty/unavailable result. Scene nodes remain thin and cannot gain readiness from a visual task.

Source-bound scan/candidate metadata and accepted material markers survive restart/scoped copies. Ordinary map requests combine native map candidates with discovered map/uncertain pages. No whole-book atlas is required before play.

An adverse prototype exposed incorrect map reveal rectangles passing the old review. The new private review preview draws exact `source_box` rectangles in the cropped asset's coordinate frame, with R1/R2 markers. Successful preview delivery and digest are checked. Incorrect place correspondence, private annotation leakage and coordinate-frame errors are logic findings. Review applies to record roots and leaf paths. Jev text-only review cannot approve visual geometry. Repair authors receive the overlays; players do not.

Main entry points:

- `kernel-ts/modules/visual-discovery.ts`, `reading.ts`, `visual.ts`.
- `runtime/jev/source-reader-driver.ts`, `runtime/tasks.ts`.
- `extensions/module/reader.ts`, `reader-submit.ts`, `reading-service.ts`, `reader-review.ts`.
- `extensions/module/map-review-preview.ts`.
- `content/setup/visual-discovery.md`, `visual-assets.md`.
- Contract: `docs/kernel-rpc.md` §152–152.2.

### `6c1a749401bbea90da40cc2c0423c18b3e4f6461`

Display delivered PDF image handouts in cards and the case board.

The producer was not the only missing seam: image handouts already on disk were rendered as non-opening rows, and the board filtered image-only documents out.

- New `Electron/packages/pi-backend/src/coc-handout-images.ts` hydrates approved raster files only from the current campaign/module roots. It checks realpath containment, symlink escapes, size, signature/MIME and private visibility. Campaign binding uses `module_id`. Bytes stay in presentation output, not model context or saved raw rows.
- `kernel-ts/read/handout-document.ts` includes image descriptors from delivered receipts; membership remains controlled by `world.handouts_shown`. Merely having a file does not reveal it, including after rewind.
- Apply/mechanics preserve optional image metadata alongside text.
- `pipicoc/mechanics.js` and `pipicoc/board.js` reuse zoom/pan viewers for original handout images and retain any accompanying text.
- Contract: §152.3.

### `9d721814da2293e2fe5f86c68fe4d9cce47091c4`

Hydrate image handouts on both case-board dispatch paths.

The board has separate cold and live dispatch paths. Both now call `withHandoutImages` after glossary projection. Hydration was removed from generic character-sheet reading. The helper preserves the source object and discards forged pre-injected bytes before validated hydration. A regression exercises the actual live dispatcher.

## Evidence and timings

Detailed report: `docs/research/pdf-visual-discovery-20260929.md`.
Ticket: `docs/specs/jev-pdf-demand-reading-tickets/04-visual-discovery.md`.

Source PDF:
`/Users/haoli/Documents/TRPG/克苏鲁的呼唤/[COC模组翻译]归于尘埃 -Dust to Dust.pdf`

SHA-256: `33752412d20f4b6938760826d0d474506072b239ccb3f491b27c398c1f609873`.

Real source-component scripts and evidence are retained under `.pi/prototypes/visual-discovery/` (ignored files). These use the real runtime, reading service, kernel publisher and tool-enabled Grok 4.5 / low. They are **component evidence, not Keeper/player acceptance**.

| Run directory | Result |
| --- | --- |
| `run-2026-09-29T06-44-14-031Z` | Combined discovery/extraction caused repeated zoom/transcription and exceeded the harness's 120-second foreground wait. |
| `run-2026-09-29T06-49-00-869Z` | Shorter instructions still refined crops across the whole batch; deliberately interrupted. |
| `run-2026-09-29T07-01-01-477Z` | Discovery about 10 seconds; host incorrectly required an original-page log for overview-only work. This assumption was repaired. |
| `run-2026-09-29T07-05-21-960Z` | Discovery committed in 11.071 seconds, two calls, 11,795 input / 552 output tokens. Maps nominated on physical pages 8, 10 and 12. Page 8 published in 82.385 seconds, page 12 in 102.826 seconds, independently. Wrong reveal rectangles make this run invalid as proof of correct geometry. |
| `run-2026-09-29T07-25-07-642Z` | Final directory discovery 14.176 seconds, two calls, 11,788 input / 547 output tokens. Page 8's first wrong R5 was rejected, repaired and re-reviewed: 235.526 seconds total. Page 12: 93.990 seconds. These are background preparation times, not player-turn latency. |

Final village preview was manually inspected at:
`.pi/prototypes/visual-discovery/run-2026-09-29T07-25-07-642Z/.coc/modules/book-1/work/read-3/attempt-1/verify-2/unit-2/attempt-1-Ew7HN6/map-regions-1.png`.

Inn/Feld boxes were corrected to marks 1 and 5. Other boxes are coarse but correspond to their locations. Some crop/title edges remain clipped. Private preview legend has missing Chinese glyphs; R markers plus JSON labels remain readable. Do not claim pixel-perfect extraction or expand the task into font cleanup.

### Automated checks already completed

- Full extension suite: 3,907 passed, 0 failed, 1,202.8 seconds (`.pi/visual-discovery-full-ext.log`).
- Full kernel/play suite: 2,058 passed, 0 failed, 502.63 seconds (`.pi/visual-discovery-full-py.log`).
- These full suites ran during implementation, **not on the final merged HEAD**. Later affected checks passed: 167, 49, 214 and final 190-test groups; logs use `.pi/visual-discovery-*`.
- Handout UI: 80 passed (`.pi/visual-handout-ui-final.log`).
- Backend/image scope including live board dispatch: 28 passed (`.pi/visual-handout-board-tests.log`).
- Source/handout/language: 12 passed (`.pi/visual-handout-kernel-tests.log`).
- Kernel handout/frontend view: 15 passed (`.pi/visual-handout-py-tests.log`).
- Typecheck/build passed; logs `.pi/visual-handout-final-check.log`, `visual-handout-host-build.log`, `visual-handout-board-build.log`.

No remote evidence was cleaned. The available remote runner would force-checkout/clean retained evidence, so it was not used.

## Installed package and real GUI session

Latest verified package receipt: `2026-09-29T08:28:38.860Z`, commit `9d721814da2293e2fe5f86c68fe4d9cce47091c4`.

- Actual canonical bundle: `/Applications/PipiCOC.app`.
- Backlink: `/Users/haoli/leehow/code/pipicoc-build/PipiCOC.app` points to that bundle.
- Receipt: `/Users/haoli/leehow/code/pipicoc-build/pipicoc-package.json`.
- Stable signature: PipiUI Dev, leaf `108232c5a713c15a869fc4c267e18d2e35cd276c`.
- Task staging directories were verified removed after packaging. No duplicate bundle was installed.

App home: `/Users/haoli/Library/Application Support/Pipi/pipicoc/pi-coc`.
Campaign: `game-5d82fd23-6c33-4efc-b8ef-bb65ccadf046`.
Session: `c283ca2b-3df3-43e4-bb85-b82a9d887982`.
Module: `book-5`.

Session JSONL:
`/Users/haoli/Library/Application Support/Pipi/pipicoc/pi-coc/agent/ui-sessions/play/%2FUsers%2Fhaoli%2Fleehow%2Fplaytests%2Fjev-gui-20260928/2026-09-29T00-51-08-103Z_c283ca2b-3df3-43e4-bb85-b82a9d887982.jsonl`.

Campaign evidence lives under `.coc/campaigns/<campaign>/`, especially `turns/0021.json`–`0023.json`, telemetry and world state. Private module evidence is under `.coc/module-campaigns/<campaign>/modules/book-5/`; consult `module.json.graph_file` for the actual generation and `deepen-queue.json` for background jobs.

Native Computer Use observations:

- Turn 21: buying the paper and declaring an overnight plan took about 36 seconds. Actual App scans 1–20 and 21–23 completed, nominating page 4 handouts and maps 8, 10, 12. Page 8 asset completed while others ran. The composer remained available and accepted the next action during background work.
- Turn 22: overnight/next morning action took about 40 seconds. Time receipts advanced the clock, but the Keeper unnecessarily split the already declared plan and again asked for payment. Two failed apply attempts were visible. These pacing/action issues are preserved, not claimed fixed by visual work.
- On package `9d721814d`, the restored case board visibly displayed the **original newspaper 1 bitmap** with a 100% slider and zoom/pan. An inherited crop includes the next card's heading at the bottom and clips part of the current title; no future article body was seen.
- The board correctly had no known maps because no map had been revealed in this campaign. Do not claim live map acceptance.

## Exact final blocker: turn 23

Player input:
“我把两分钱递给摊主，买下今天的新报纸，当场读有关盗墓案的那一则报道。”

08:31:24–08:31:50, about 26 seconds. `receipts=[]`.

Keeper attempted one apply batch: cash -0.02 USD, handout `arkham-advertiser-2`, today's newspaper item to Nora, and 10 minutes elapsed. The tool rejected it:

> The action review is unavailable, so this action cannot be settled now

It returned `retryable: false`, `next: change_input`, and explicitly instructed the Keeper not to retry in the same turn, narrate the service failure, or ask the player to repeat the action. The Keeper nevertheless narrated a bookkeeping outage and asked for another input. **This is an action-review/admission failure followed by a narration failure, not evidence of PDF extraction failure.** No purchase or new handout was committed.

Underlying lane failure was not diagnosed before the user's stop request. External commit `e541b3b21` (“fix(lanes): a fast model set to off no longer bricks every lane”), now merged into HEAD, may be relevant. This is a hypothesis only; this task has neither verified it against turn 23 nor packaged it.

## Resume here when authorized

1. Inspect current branch, ownership, diff and package receipt; other tasks are active. Do not overwrite their work. Read current repository contracts and macOS hygiene before packaging.
2. Compare installed `9d721814d` with current HEAD and the external lane fix. Inspect turn 23 lane telemetry/config before deciding whether any additional change is needed. Preserve Grok 4.5 / low. Never bypass action admission or fabricate receipts.
3. Continue the real campaign only after the required session-resume operation. Use native Computer Use for the requested App acceptance, with the main session as the player. Do not substitute scripted/fake Keeper play or private source knowledge for public clues.
4. Complete the legitimate second newspaper purchase, verify a newly delivered image in the card and live case board, then follow public clues toward a map and verify its image/known regions in actual play. Existing cold-board image display and source-component map tests do not close these gates.
5. Record remaining pacing/technical-failure narration accurately. Do not silently broaden this visual task into all unrelated game defects.

Operational context: Nora is a 35-year-old reporter with grave photographs. Current scene is the improvised `arkham-street-newsstand`. After turn 22 the clock was `{minutes:1380,start_local:"1925-08-28T09:00"}` (next day 08:00); the known handout was `arkham-advertiser-1`. Recheck through the proper continuation path, not by rewriting state.

Preserve every campaign, transcript, prototype and adverse result. Production kernel is TypeScript only. Do not restore old Python code, clean evidence, push, delete branches, or install a second App. No further testing or packaging was performed for this handoff.
