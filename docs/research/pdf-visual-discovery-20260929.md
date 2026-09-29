# Incremental PDF visual discovery — 2026-09-29

## Intent and scope

Keep the Jev/native-text path fast enough to start playing, while independently discovering PDF images and maps and making accepted assets available incrementally. A text match never proves visual completeness. Existing graph/asset consumers, source binding, foreground priority and player reveal boundaries remain authoritative. No OCR stack, replacement scheduler or extra Keeper is introduced.

Baseline: d120e1f92 on 0.9.6a. The earlier work was already committed; 0.9.5a remains unchanged. Contract §152 and JPDF-04 own this repair. Prototype decisions from 4ba527fdf and 0a7a63ad are retained: exact original text stays host-owned and visual gaps remain explicit. The existing contact-sheet and original-page tools are reused.

## What changed

- The fast reference path's existing read-ahead queues one bounded visual discovery range (up to 20 physical pages), independently of source-story units. Sparse and text-rich pages have the same coverage obligation.
- A tool-enabled visual Pi first sees the labelled overview and submits private page/kind/label navigation candidates. Successful image delivery is checked. It writes no graph facts, crop coordinates or scene readiness in this phase; an approximate title is not promoted to an authored fact.
- Separate nominated-page jobs reopen originals and publish assets, map regions and identity links through the existing independent review and asset renderer. At most two are queued/running by read-ahead. Maps and handouts precede illustrations; current foreground reads retain their normal priority.
- Discovery and accepted asset preparation persist across restarts and scoped copies. A failed asset cannot hold all other candidates. Existing text map candidates cannot suppress separately discovered map pages.
- Short dedicated prompts replace the long general source-author instructions for these two phases. Discovery has a three-request allowance; ordinary source reading remains unchanged.
- Map review now includes host-rendered private overlays showing the actual source_box coordinates in the cropped asset. The reviewer must demonstrably consume each required overlay as well as original evidence. Map instructions cover record roots and leaf pointers; wrong geography or private annotation exposure is a logic failure. Map review cache identity is versioned. The author receives those same rendered-coordinate aids during repair.

## Retained original-PDF evidence

All runs use Grok Build Grok 4.5 / low and the original Dust to Dust PDF. These are real source-component runs, explicitly not Keeper/player acceptance. The harness uses the real runtime, ReadingService, typed kernel queue/publication and Pi reader/reviewer. Its unrelated initial index job is cancelled through the production API to isolate the source component; no scenario graph or player receipt is manually manufactured.

Evidence root: `.pi/prototypes/visual-discovery/`. Scripts `live.mjs` and `review-overlay.mjs` retain exact reproduction code. Every failed/interrupted run remains.

1. `run-2026-09-29T06-44-14-031Z`: combined discovery and extraction kept zooming/transcribing; the harness's default 120-second wait ended it before publication. This used the first emitted candidate and is adverse design evidence, not the final path.
2. `run-2026-09-29T06-49-00-869Z`: shorter instructions still caused repeated crop refinement across the batch. It was deliberately interrupted; this motivated separating navigation from asset work.
3. `run-2026-09-29T07-01-01-477Z`: discovery returned in about 10 seconds/two model requests, but the host assumed an original-page requests log must exist. Corrected that assumption only for navigation-only jobs; original asset evidence remains mandatory.
4. `run-2026-09-29T07-05-21-960Z`: the 20-page directory committed in 11.071 s (author 10.657 s, two calls, 11,795 input / 552 output tokens). Maps on physical pages 8, 10 and 12 were nominated. Page 12's floorplan had previously lacked a real image file in the GUI campaign's graph. Page 8 then published independently in 82.385 s and page 12 in 102.826 s. These were real PNGs and graph links, but manual inspection found misplaced reveal boxes: the first coordinate review was insufficient. Those outputs are not accepted as proof of correct region reveal.
5. Overlay re-review in that module's `work/overlay-review-1790666470363`: the real reviewer rejected the inn and Feld-house boxes as logic errors after viewing rendered overlays. An earlier overlay probe placed its task outside the bound module work directory and was correctly refused by reader confinement; access rules were not relaxed.
6. `run-2026-09-29T07-25-07-642Z`: the directory committed in 14.176 s with two calls. Page 8's first candidate was rejected for its Feld-house region, repaired, re-reviewed and published in 235.526 s. Page 12 then published independently in 93.990 s. The final village overlay was manually inspected: the corrected inn and Feld-house boxes reach marks 1 and 5. The second map has three floor regions. Original paths, observations, successful image delivery, drafts, reviews, repair findings and asset digests are retained under the run.

Directory labels sometimes misread the cottage title; they remain navigation hints. Original-page extraction supplies the authoritative name. The observed directory did not nominate every text-only handout, so this is not a universal all-visual-content completeness claim; native text reading remains complementary. Full region preparation can take minutes in the background and is not included in the 11–14 second discovery metric.

## Verification

- Kernel typecheck and runtime build passed repeatedly.
- Full extension run: 3,907 passed, 0 failed, 1202.8 s (`.pi/visual-discovery-full-ext.log`).
- Full kernel/play run: 2,058 passed, 0 failed, 502.63 s (`.pi/visual-discovery-full-py.log`).
- Design changed in response to the real probes while broad regression ran; those counts are not a claim that a final immutable revision was rerun in full. Subsequent affected-path verification: 167 split-navigation/queue/reader checks; 49 overlay/source/review checks; 214 combined checks; latest release follow-up 190 checks, all passed. Logs are `.pi/visual-discovery-*-tests.log` and `.pi/visual-discovery-final-focused.log`.
- Tests cover navigation without source facts, rejection without delivered overview, original-page requirements, foreground isolation, queued restart reuse, preservation of source-reference readiness, candidate supplementation, source coordinate frames, root/leaf review routing, and distinct image/source evidence.
- amax was reachable and idle, but the supplied remote launcher force-cleans previous worktrees and deletes retained test evidence. It was not used. Broad checks ran locally with restrained concurrency; no remote checkout or evidence was changed.

## Remaining installed-App gate

Package the reviewed committed source into the sole canonical App; verify stable signing and cleanup. Through Computer Use, continue the retained scenario naturally, verify a visual scan starts in the background without locking the composer, and verify actual image/map delivery. Source-component success alone does not satisfy that UI gate.

## Installed-App findings and image-consumer correction

Package 9cb667f33 installed at 07:39:26.371Z with the stable PipiUI Dev certificate and empty staging. The retained Dust campaign automatically completed visual ranges 1–20 and 21–23; its real scan also nominated page 4 as a possible newspaper/player handout. Page 8 preparation completed while pages 10 and 12 ran independently. The player bought a paper and submitted another normal action while those background jobs were active; turns 21 and 22 closed in 36 s and 40 s. The Keeper unnecessarily split the previously declared overnight plan across turns; that pacing issue is retained, not attributed to visual discovery.

The GUI exposed the other half of the reported missing images: the original newspaper PNG was present and its receipt was ready, but mechanics.js deliberately drew image-only handouts as a non-opening line, and the case board filtered out documents without text. Added player-host image hydration for live cards/restored history and held-handout descriptors from actual receipts. The viewer reuses existing image zoom/pan controls, supports text beside an original image, and does no new model inference. Host reads are constrained to the bound campaign and module, realpath checked, size bounded and raster-signature checked; a forged inline image does not bypass that materialization. Viewing cannot grant a hidden handout or survive a worldline rewind as current inventory merely because bytes remain on disk.

Follow-up checks: 80 UI mechanics/board/speech tests, 28 player-host/image-scope tests, 12 source/handout/language checks, and 15 kernel handout/frontend-view tests passed. Kernel and player-host builds passed. A second package and final visible original-image verification follow; these source/test results alone are not that final UI evidence.

The first image-display package exposed an omitted caller: the case board has distinct cold and live dispatch paths, separate from readColdSheet. Those now hydrate image handouts after glossary projection, and the live-dispatch regression uses real scoped PNG bytes. This also avoids embedding image bytes in the words sent to presentation lanes. The 28 host tests pass with the added route assertion. Native CUA briefly lost the App binding and later returned its bare shell; the App was exited normally before updating. No native rendering or access policy was changed for that observation.
