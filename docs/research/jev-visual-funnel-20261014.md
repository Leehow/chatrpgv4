# Jev visual funnel component results

Date: 2026-10-14. These are real Jev calls and real PDF images, not a campaign, gameplay test or packaged-App acceptance. The implementation is specified in [jev-visual-funnel.md](../specs/jev-visual-funnel.md).

## What was measured

Compare jev-1.14.0 single-page existence/Box requests with resized montage filtering and final-page existence/Box requests, using the same renderer, four concurrent requests, source bytes and target. Each montage image is at most 1568 pixels per dimension. Inputs, montage geometry, actual answers, transport traces and usage are retained. No secret headers are recorded. The baseline is the same new visual model operating per page, not the former Pi reader; its timings cannot establish total reading-pipeline savings.

| Source and range | Order | Baseline calls / wall / input tokens | Funnel calls / wall / input tokens | Found target pages |
| --- | --- | --- | --- | --- |
| The Haunting, physical 1-17 | Funnel first | 17 / 5.082 s / 116820 | 5 / 3.045 s / 37004 | 7, 17 in both arms |
| Registered book-3, physical 26-41 | Baseline first | 16 / 5.015 s / 109625 | 2 / 2.012 s / 16337 | 30 in both arms |

Wall time fell 40.1% and 59.9%; input tokens fell 68.3% and 85.1%. Listed-price input costs were $0.00490644 vs $0.001554168 and $0.00460425 vs $0.000686154. Both comparisons completed without missing answers. There is one measured pair per source, not a latency distribution or general accuracy estimate.

The root inspected both source contact sheets and the original target pages/crops. All three visible map pages were found. Four additional uncertain Haunting pages and one uncertain book-3 page remain advisory leads, not positive detections. The Haunting page-7 proposed crop retains the floor plans but cuts the title and scale partly. The page-17 proposed geometry crossed the actual printed-page rectangle in the padded image and was withheld. Book-3 page-30 contains the map and its border. Box remains an author navigation proposal, never an automatically published crop or privacy decision.

These comparisons used policy v2. The final v3 leaves the model questions and page refinement unchanged, and additionally forwards valid lower-confidence boxes as explicitly `tentative` hints. A real production source-driver projection with the broader visual-asset question returned existence 0.93 and Box confidence 0.58: the mapped tentative hint and the full original page reached the actual reader context. Evidence: `.coc/experiments/jev-visual-driver-20261014-av3wtS/`. A final v3 run returned existence 0.94, Box confidence 0.6 and the original full page: `.coc/experiments/jev-visual-driver-20261014-wP4SUO/`. The earlier strict smoke expectation of a high-confidence box failed at confidence 0.47; it is retained at `.coc/experiments/jev-visual-driver-20261014-7qLjlC/`, not relabeled as a successful attempt. This verifies host-to-reader supply, not author use or publication.

## Preserved adverse first attempt

The first policy asked for material or a related pointer and refined every score above 0.1. It took 22 calls / 16.240 s / 147557 reported input tokens, versus 17 / 11.039 s / 109731 for its baseline, with a network failure in each arm. Almost every coarse tile survived. This was not a successful optimization. The revised policy asks about visible targets, refines scores at least 0.35, and retains lower uncertain scores for the original reader without magnifying them repeatedly. No failed evidence was deleted or relabeled.

Evidence directories, relative to the repository:

- Adverse: `.coc/experiments/jev-visual-funnel-20261014-fIdwYD/`
- Haunting revised: `.coc/experiments/jev-visual-funnel-20261014-gug5Do/`
- Book-3 revised: `.coc/experiments/jev-visual-funnel-20261014-HwX58a/`

Reproduce with Node 24: `node experiments/jev-visual-funnel/compare.mjs [pdf] [target] [first] [last]`. Set `JEV_COMPARISON_ORDER=funnel-first` to reverse arm order. The existing canonical vault helper mounts only the Jev secret through the shared resolver in memory.

## Long context preserves a previously clipped condition

The Haunting page 4 states near its end that Pastor Michael Thomas escaped prison in 1917. With the former 2800-character page excerpt, its Noul was 0.02; with the complete original page in the new sixteen-page request, it was 0.98. The new request explicitly enabled long context and retained the exact page text.

The old clipped representation used four requests / 0.739 s / 13016 input tokens. Complete text used one / 1.365 s / 14944 input tokens. This is a correctness improvement with higher latency and input usage for this sample, not a universal speedup. Long context stays demand-driven.

Evidence: `.coc/experiments/jev-text-context-20261014-g1kGZw/`. Reproduce with `node experiments/jev-visual-funnel/text-context.mjs`.

## Validation status

The default fast suite passed 130 tests. Six directly affected files passed 63 focused tests before the final current-need guard. The dedicated new suite then passed eight tests, including an image-only PDF whose negative visual judgment must still reach the original reader. Page-transcript, source-reference and typed-task files separately passed 20 tests. The tests exercise actual transport packing and the real PDF montage/source-reader seam with injected typed decisions; they are deterministic regression evidence, not live gameplay.

The broader import-selected suite passed on leehow-pc: 4239 extension tests across 496 files, 2162 native integration tests and 12 routing-loop tests, all exit 0, 860 seconds wall. Its source snapshot preceded the final current-need guard and image-estimate provenance label. Evidence: `/home/leehow/leehow/code/wt/codex-tests/.pytest-runs/chatrpgv4-wt-pi-coc-v2/run.enV9x4P6/remote-focused.log`.

After those final changes, the emitted runtime was rebuilt successfully and its 61 MB output fetched over the LAN. Final build evidence: `/home/leehow/leehow/code/wt/codex-tests/.pytest-runs/chatrpgv4-wt-pi-coc-v2/run.6Ov86n2V/remote-build.log`. A same-box follow-up of the affected funnel, source driver and decision adapter passed all 48 tests; source SHA-256 hashes and output are retained at `/home/leehow/leehow/code/wt/codex-tests/.pytest-runs/chatrpgv4-wt-pi-coc-v2/run.visual-final.LPpx9Ooq/`.

Standalone TypeScript checking encounters the existing unchanged `runtime/jev/source-ref.ts` SourceValue error; checking that file alone reproduces it. No packaged-App or total Pi-reader latency result is claimed.

## Final multi-corpus refinement

The frozen seven-PDF corpus covered eight windows, 117 physical pages and 29 human-marked map pages. Final policy v4 retained all 29 positives with no false found pages: Box-requested calls fell from 46 to 38, input tokens from 337163 to 238884, and summed observed time from 27.459 to 18.231 seconds. The measurements are component comparisons; render caches and network conditions differ. Valid mapped Box hints rose from 26 to 29, including six explicitly tentative hints. Titles or borders can still be clipped, so the full original page and independent review remain authoritative. Identification without Box used ten calls and 85480 input tokens with the same 29/29 result.

Conditional refinement skips repeated classification of found pages. Single-page localization retains the original aspect ratio and uses page-specific questions; only API-minimum padding is added when necessary. Whole native text fills ordinary-context groups first, with individually oversized pages isolated for explicit long context. The frozen positive/contradictory text probes returned .92/.02 for Cold Harvest, .98/.01 for Cursed, and .99/.01 for Masks, with two ordinary-context groups per sixteen-page window. These explicit-fact probes do not establish all reader semantic behavior.

The first aspect-ratio trial still used collage questions and missed Masks page 200 (.22). That failed trial remains preserved independently of the corrected final run. One fresh per-page baseline request also failed with a network error; its aggregate is not a clean comparison. Full raw evidence and visual review remain in `.coc/experiments/jev-stress-20261014-multicorpus/optimization-report.md`.

Final focused LAN validation passed 4252 extension tests across 497 files, 2167 native integration tests and 12 routing tests, exit 0. Local fast tests passed 130 and the three directly affected suites passed 52. The emitted runtime's embedded sources matched both final production file SHA-256 hashes. LAN evidence: `/home/leehow/leehow/code/wt/codex-tests/.pytest-runs/chatrpgv4-wt-pi-coc-v2/run.JK9gZLWK/`; emitted build: `run.lq3VMvcc/` under the same parent. The pre-existing standalone SourceValue typing error remains outside this work.
