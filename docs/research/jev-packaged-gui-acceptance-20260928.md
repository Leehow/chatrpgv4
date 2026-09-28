# Packaged App / Computer Use acceptance — 2026-09-28

Status: **acceptance failed**. Canonical package verified, character creation completed and six actual UI player turns delivered. Rapid entry, source-backed destination continuity and NPC identity did not meet the intended experience. No production source changes were made during this acceptance run.

## Frozen artifact and method

- Canonical App: `/Applications/PipiCOC.app`; receipt commit `ea97173eeedcc1ddb8267edd1157b2d8a29dd0ab`, created 2026-09-28T17:08:43.259Z. Stable local certificate `PipiUI Dev`, leaf 108232C5A713C15A869FC4C267E18D2E35CD276C; TeamIdentifier is unset, signature is not ad hoc. Running main PID verified as 82142 at launch.
- Packaging first failed on a codeload connection timeout. Retried with all four manifest archives hash-verified; successful package log `.pi/jev-gui-package-20260928-retry.log`. Staging was empty afterward. Removed the exact obsolete Trash LaunchServices registration; final registry and Spotlight resolve only the canonical bundle. No campaign or source evidence was deleted.
- Actual player input uses native Computer Use in the canonical App, as explicitly requested. No driver, synthetic player or direct state edit substitutes for UI play. Read-only telemetry is diagnostic evidence.
- Fresh project: `/Users/haoli/leehow/playtests/jev-gui-20260928`. Grok Build 4.5 / low verified in UI; Jev credential saved and context preselection enabled. Grok login was restored by the user before the test. Authentication time is excluded.
- Source: `[COC模组翻译]归于尘埃 -Dust to Dust.pdf`, 23 pages, SHA256 `33752412d20f4b6938760826d0d474506072b239ccb3f491b27c398c1f609873`. No existing App module for this source before import; new module `book-5`.
- Import ID: `8b80433e-5505-42b8-b783-74e86e6d546f`; UI session `b7c6f7e2-bcd0-4960-99af-e1f7fba99121`; campaign `game-c67942b2-a423-45fd-bd2c-4007582517bb`.

## Setup observations

1. File-open click at 18:04:25.514Z; campaign result at 18:05:32.201Z (66.7 s). Visible introduction and editable character input observed at 68.7 s. Public era/place appeared; while searching, all four fields remained generic until accepted guidance.
2. Native source catalog had 21 text-bearing pages. Jev page and excerpt decisions succeeded rapidly. At 18:04:34.918Z, source.project failed with `Opening identity requires original-page fallback for this source`; no guide generation had run. Producer at `runtime/jev/source-reference.ts` requires at least one PDF bookmark for opening identity. Missing bookmarks therefore force the full visual guidance path even with useful original text already found. This is a confirmed performance limitation, not a slow Jev inference.
3. Character concept: a 35-year-old Arkham freelance photojournalist, family connection to Martin, observation/research focus, basic firearm skills. A card with Handgun 20 and Rifle/Shotgun 25 was shown; the UI allowed confirmation despite a nonstandard-points warning. Player build freedom was preserved in this example.
4. Clicking the card confirmation showed `module 'book-5' is not installed and not opening_ready`. The setup continued waiting for opening preparation; after more than four minutes from import no playable scene was available. The Keeper asked the player to send another message to check progress. This is not acceptable evidence of quick entry to play.
5. Both library `modules/book-5` and campaign `module-campaigns/<campaign>/modules/book-5` were separately preparing opening/index work. They use the same original PDF; inspect this ownership overlap before proposing a fix. Do not assume the library's progress means the campaign has equivalent published readiness.
6. A stalled library review unit returned Grok Build HTTP 500 `Auth context expired` at 18:12:27.438Z and retried. Another successful review took 200.616 s. The UI continued displaying checking progress; this elapsed time includes provider failure/retry and is not a pure retrieval benchmark.
7. Library opening readiness finally arrived at 18:15:17.832Z: 652.3 s after the file-open click. The App automatically started play afterward. Campaign telemetry confirms `loop_engine: hybrid-v1`, `layout: compiled`. Opening narration committed at 18:16:16Z, 710.5 s from file-open (11 min 50.5 s, including character interaction and human/UI observation gaps). Do not call the entire interval model latency. The first draft event was at 18:06:12.844Z, 21.3 s after the character concept; a later draft event was at 27.2 s. The visible card was observed at about 56 s, so that observation is an upper bound rather than exact generation time.
8. While the first run waited, a second UI session selected existing Blood Road from the library. Import `d0c865b8-6305-4cfb-b630-5ce7674bf9da`, session `0c9e06c8-b2c5-4f94-9702-7e8f8524e106`, campaign `game-65c0a12f-b69b-4f6c-b98d-e20bc99eba5e`. Its guidance preparation started at 18:10:40Z using Grok Build 4.5/low. `referenceGuidance` returns early when graph_present is true and no source_reference exists, so this library route restarted visual guidance instead of migrating existing material onto the fast path. These timings are not a cold-source comparison and overlap the first run's retries. A second basic-driving/basic-firearms character concept was submitted through UI.

## Six live player turns

Times below are durable `opened_at` to `closed_at`, rounded to the stored second. UI observations occurred later and include polling gaps; they are not exact end-to-end latency. Main provider requests exclude Jev, source-reader, NPC and verification lanes. The final turn includes a failed connection attempt.

| Turn | Natural player action | Runtime seconds | Main requests | Model lookup calls | Result |
| --- | --- | ---: | ---: | ---: | --- |
| 1 | Read the newspaper for time, place and witnesses | 38 | 2 | 1 | Correctly conveyed six-year-old burial, police chief, linked towns and the after-1-AM appeal. Checked against the actual handout image. |
| 2 | Go to police and ask for the investigating officer | 41 | 2 | 0 | Law roll and source-backed footprints/ladder/watchman clue delivered. Prose placed the player at the police desk, but state stayed investigator-briefing with no move receipt. |
| 3 | Go to the cemetery and ask watchman Pender about his shift | 38 | 3 | 4 | Original source answer returned in 2.259 s, but the destination still went to adaptation/review and blocked arrival. Only time was committed. |
| 4 | Remain with the officer and compare linked thefts | 50 | 3 | 0 | The previously described patrol officer became Eric, the victim's son, without an intelligible transition. apply/narrate refusals added repair attempts. |
| 5 | Ask whether he is the officer or the victim's son | 21 | 2 | 0 | Eric said he was not police and had just arrived. This only partially repaired the visible identity contradiction. An adaptation_stale refusal was recorded. |
| 6 | Ask Eric to wait, then try the cemetery again | 79 | 8 | 3 | Connection error and repeated table_act_unsettled/purpose_repeated/intent_result_owed refusals. The final narration still could not reach the cemetery. |

Median committed runtime interval was 39.5 s. These are not six successful story advances: two attempts at the same source-backed destination failed. The last committed narration was visible while the App continued showing model activity; stopped that remaining foreground generation through the UI. The final receipt remains intact. App left open on this failed arrival; the second campaign remains at its unconfirmed card, with opening preparation ready. All evidence and background preparation remain retained.

## Retrieval and logical quality verdict

- **Jev really ran.** Every player turn entered actual hybrid-v1. Source catalogs, read/follow/discover decisions and delivered packets were recorded. Successful pre-read preparations took 3.169, 4.023, 4.988, 5.011 and 10.337 s, with 3–13 selected materials. Their supplied-source lists were graph/committed/rule material; catalog discovery alone does not prove original excerpts reached the main model.
- **Original-text fallback really worked in one demanded lookup.** Turn 3 returned original physical-page-4 text about Pender and the police clues in 2.259 s. It was initiated by the Keeper after pre-read rather than completing entirely before first inference. It did not unblock travel: scene lookup led to `lookup adaptation prepare` despite available original evidence. This is the important remaining producer → consumer → action gap.
- **Identity/placement are not reliable enough.** Eric was already in `world.present` from opening turn 0, while the source describes him as a conditional hook if investigators refuse the investigation. The player had explicitly accepted the investigation. All six turns still record investigator-briefing as scene and Eric as present, despite police-desk prose. The turn-4 identity contradiction therefore has a concrete state/projection mismatch behind it; this report does not attribute it to the new late-source-presence candidate without further evidence.
- **Some content quality is good.** Newspaper facts matched the supplied original image; police clues and the Law check matched the original passage. Basic weapon skills were preserved and the card's warning did not become a mandatory build restriction. No private ending was exposed in these six replies. This narrow result does not establish whole-module completeness, special-rule/item accuracy or future-link coverage.
- **Token savings are not accepted.** Most turns still needed 2–3 main calls and the last needed 8 attempts. Jev pre-read and later source lookup coexist; no same-state baseline proves reduced total tokens. An available source catalog, low Jev cost or background publication is not sufficient evidence for the user's token goal.

## Required follow-up, not implemented in this test

1. Remove the dependency of source-reference readiness on PDF bookmarks: enumerate source-backed opening candidates from exact text locations and retain original identity/conditions. Keep full graph authoring/review off the foreground when original text suffices.
2. Allow existing-library modules to acquire an original-reference packet without repeating the old visual-guidance path. Reconcile library and campaign work through their existing publication/ownership contract rather than run duplicate opening preparation.
3. Connect selected original place/NPC evidence to the ordinary host-owned scene/presence operations. Preserve conditional appearance and actual location; do not force a known source destination through unrelated adaptation just because its complete graph node is missing.
4. Surface/recover provider authentication failures explicitly, and finish the UI turn when its final delivery is complete. Review repair loops against the actual unresolved obligation instead of treating retries as progress.

The next acceptance must repeat fresh PDF → confirmed card → early travel plus NPC follow-up on the fixed artifact. A faster child lookup alone cannot close these failures.

## Durable evidence

App data root: `/Users/haoli/Library/Application Support/Pipi/pipicoc/pi-coc`.

- `.coc/imports/<import>/job.json` and `events.jsonl`.
- `.coc/modules/book-5/work/source-reference-0bd3c850-b529-43f0-bd1d-c134b3cf103c/source-driver.jsonl`, `events.jsonl`, `run-result.json`.
- `.coc/modules/book-5/work/read-3/` and `.coc/module-campaigns/<campaign>/modules/book-5/work/read-1/` retain separate opening attempts.
- `.coc/campaigns/<campaign>/telemetry.jsonl` and later turn receipts.
- `agent/ui-sessions/play/%2FUsers%2Fhaoli%2Fleehow%2Fplaytests%2Fjev-gui-20260928/2026-09-28T17-11-48-106Z_b7c6f7e2-bcd0-4960-99af-e1f7fba99121.jsonl`.

No latency comparison against another scenario or previous CLI run is a controlled A/B result. Character draft display, user confirmation time, source preparation, opening narration and each player action will be reported separately.

Compact metric extraction: `.pi/jev-gui-turn-metrics-20260928.json`. The original JSONL/turn files remain authoritative; screenshots and UI actions are retained in this task's Computer Use history.
