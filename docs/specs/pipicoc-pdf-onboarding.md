# PipiCOC scenario selection and PDF onboarding

Current implementation: [fast guided PDF onboarding](fast-guided-pdf-onboarding.md)
provides early source-grounded character creation, app-owned background preparation,
an extension-provided progress overlay and one readiness handoff. Its final acceptance
and measured limits are recorded there; the records below describe the earlier flow.

Status: selective PDF preparation, early skeleton and PipiCOC onboarding are implemented on 0.9.0a; the actual in-app-browser Masks Peru chapter and source-based settlement are complete after observed repairs. The main table is completed, with original ending turn 64 preserved and late accounting committed in turn 66; current UI turn 67 awaits input before the next chapter. Cold2 produced a valid 16-page skeleton in about 114 seconds, while reviewed opening preparation required a retained retry. Preserve all evidence and concurrent unrelated changes; this is not a pristine uninterrupted performance run.

## Intent and acceptance

The user wants an ordinary player to choose a scenario in the empty conversation, upload an original PDF, see truthful preparation progress, create an investigator and start playing without terminal commands or restarting the application. The three equal entry points are preset scenarios, PDF upload and already prepared scenarios. They belong in the blank conversation area shown in the user's screenshot, not a separate settings page.

Success requires the same frontend flow in the Codex in-app browser, using xai/grok-4.6 with low thinking, followed by at least one complete authored chapter of the exact source `/Users/haoli/Documents/TRPG/coc英文/Call of Cthulhu - Masks of Nyarlathotep (Larry DiTillio, Lynn Willis, Mike Mason etc.).pdf`. The main assistant is the sole player, one natural action at a time. A fixture, direct campaign construction outside the product, a paused opening, or a count of turns is not a chapter completion.

## Scope and decisions

- Reuse the visual ReadingService and the existing kernel setup methods. No OCR fallback, second rules engine or fake Keeper.
- Expose the product workflow through the existing authenticated extension invoke transport. Upload sequential bounded chunks so Web and Electron share the same path. Preserve original bytes and resumable preparation jobs.
- Keep acknowledged upload bytes separate from skeleton discovery, selected-page reading, independent review and opening readiness. Show actual progress, actionable errors, pause/resume and explicit opening choice. No full-page prerequisite, fake time estimate or all-book-ready label.
- The host owns upload/job/campaign identifiers. Forms pass semantic choices; the kernel creates all character numbers. Preserve the selected session's model and thinking, including reader subprocesses.
- Persist the campaign binding before starting the canonical Keeper in that same UI session. No application restart between character creation and play. Existing conversations remain ordinary transcripts.
- Preserve the original experiment under `.coc/playtests/pipicoc-masks-browser/`; current play evidence is `.coc/playtests/masks-agentic-browser/`, with separate cold trials in `masks-final-cold/` and `masks-final-cold-2/`. Do not erase previous campaigns or source evidence.

## Execution

1. Contract and transport: bounded uploads, reusable preparation, setup, session binding and explicit thinking propagation.
2. Empty-session interface: three source cards, upload/drop state, progress/recovery, opening and character forms, preview/start.
3. Focused regression and build; verify the actual UI with the in-app browser.
4. Fresh specified PDF through the UI, verify xAI/low on actual requests, play a complete chapter and fix observed system/UX failures.
5. Record evidence, limitations and commits. Update this file at milestones rather than creating additional ledgers.

## External checks

MDN's [file upload progress guidance](https://developer.mozilla.org/en-US/docs/Web/API/XMLHttpRequest/upload) confirms that transfer progress must report bytes actually transferred; our existing WebSocket/IPC transport uses acknowledged bounded chunks instead of adding a Web-only upload endpoint. xAI's [reasoning contract](https://docs.x.ai/developers/model-capabilities/text/reasoning) supports Grok 4.6 low reasoning; verify its wire value, not only the label in the UI. The existing Pi host contract already documents thinkingLevelMap and repository-local credentials.

## Current evidence

The three source entry points, upload, preparation pause/resume, character drafting, server-side restoration, canonical character creation and the opening handoff have been exercised in the in-app browser. The exact source is 46,556,793 bytes and 669 pages. Actual reader requests confirm xai/grok-4.6 with low reasoning. Preparation now publishes an independently reviewed skeleton with no ready nodes before presenting authored opening choices. Start requires reviewed opening material; choosing a skeleton alone cannot authorize play.

The main table progressed through Lima and Puno to the ruins, repaired the Golden Ward and returned to Lima. The Charnel Pit turn-43 pause remains historical evidence. Source repair published generation 17 after 43 independent review units; play subsequently exercised the repaired material. Turn 63 formally set the ward-restored flag; turn 64 committed the chapter ending. Missing reward/growth accounting was then repaired without reopening the adventure or rewriting that ending: a fresh source lookup published generation 18 and turn 66 settled it through the canonical development decision.

The import 213e1634-5601-4c20-a9af-06f72234234d in `.coc/research/masks-browser-home` is paused after 432 pages, with no campaign created. Keep its PDF, queue and transcripts. Its full-page prerequisite is rejected and the run is `invalid-for-intent` / `invalid-for-fast-opening-acceptance`; do not resume it as the new cold acceptance.

## Completed execution and limits

1. The existing table resumed normally, reached the repaired spatial material and completed the authored restored-ward ending. Earlier turns and failures remain intact.
2. The Keeper independently read source rewards through the normal Pi reader/review path, then completed missed development accounting through the UI. No scripted player or direct campaign/source edits substituted for this flow.
3. Final integrated kernel/extension checks passed; Electron matched its inherited baseline. Stable cold opening performance and packaged-app acceptance are separate, unproven claims. The chapter is accepted from its source-backed ending and actual settlement, not its turn count.

## Superseded 40-way indexing experiment

The earlier implementation queued 12-page batches across the whole book and reached 40 actual concurrent readers. This proves the lease/pool mechanism can run concurrently, not that the algorithm meets the user's intent. The next experiment retains concurrency capacity but lets Pi select independent source questions. No automatic all-book scan or OCR prerequisite survives the target design.

## Historical sandbox phase checkpoint

Before production migration, the sandbox demonstrated skeleton-first source access and question-specific requests at the seam. The retained experiment history, rejected variants and original outstanding gates remain in the visual-reader spec. Production migration and the browser chapter acceptance have since occurred. Raw source reading, independent review, source-material probes and real browser gameplay remain separate evidence levels. Summed phase durations are not measured UI upload-to-play latency.

### Browser run after selective integration (historical chapter-only acceptance)

Evidence: `.coc/playtests/masks-agentic-browser/run.json`; isolated home `.coc/research/masks-agentic-browser-home`. Cold upload bound the exact Masks source, then published reviewed opening material from 27 pages. The first pool used 38 concurrent reviewers. Retained failures led to atomic image cache publication, per-unit retry, explicit Start without a synthetic message, and recovery of the opening activity epoch lost before Pi RPC subscription. A fresh repeated upload reused the reviewed source; this is warm reuse, not another cold latency result.

Real table: `game-3642e5f2-8acb-4d17-9394-9f173764caf2`, browser session `4352d376-9e7b-4103-a802-b399e3317d35`, investigator Lin Yuan, Grok 4.6 low. Main assistant was the sole player. The opening and subsequent source-backed travel occurred in the UI. Real source waits, persisted choice buttons, exact-question rejoining, Appraise/Persuade/DEX checks, SAN changes and player-requested Luck spending were observed. The final state is turn 67 awaiting_player at the museum, campaign completed with original ending turn 64, HP 8, SAN 32, Luck 5, Spot Hidden 51.

Foreground reading has a slot alongside background reading; all reader/reviewer children share 40 permits per host. Same-focus jobs serialize, and ready-entity deltas retain accepted facts. Spatial audit against original pages exposed an omitted no-roll access condition and truncated connectivity. Full scene look now retains authored sublocation/rule descriptions, compact previews mark truncation, and location-linked maps appear in scene assets. Source repair evidence is `.coc/playtests/masks-agentic-browser/source-repair/events.jsonl` (generation 17 ready at 2026-09-08T00:57:32.349Z). Actual restoration is recorded in turn 63's flag receipt and the original turn-64 conclusion, commit `cb239ff`.

The first chapter close skipped rewards and growth, exposing the completed-campaign accounting gap. After the general fix, the player asked through the UI for source-based accounting. Real `read-14` targeted `Ward restored` with the exact reward/development question, viewed original page 86, passed independent review using pages 86/89, and published generation 18. Turn 66 then resolved `development:end-session` with source-derived expression `1D8`; its frozen roll was 1, SAN changed 31→32, normal optional Luck recovery changed 0→5, and Spot Hidden grew 45→51. The 5 Luck was not the optional Pulp 10-point chapter reward. The PASS settlement is bound to `ending-campaign-turn-64`, and commit `7cf49f0` closes the accounting turn while preserving the original completed campaign and ending. No next chapter started. See `.coc/playtests/masks-agentic-browser/REPORT.md` for the compact evidence map.

### Early skeleton, retry and reload evidence

The first trial in `.coc/playtests/masks-final-cold/run.json` incorrectly offered a noninteractive teaser as an opening; retain it as failed opening-choice acceptance. The next trial, `.coc/playtests/masks-final-cold-2/run.json`, started with a fresh module store and local page cache. Upload began at 2026-09-07T23:43:33.670Z; the reviewed skeleton completed at 23:45:28Z, about 114 seconds later, after 16 pages. It offered two genuine starts and published no ready material. Provider/OS caches were not controlled.

Cold2's first selected-opening attempt failed because a reviewer recalculated a printed NPC MOV from investigator formulas. After correcting instructions to preserve authored NPC overrides, the retained retry completed at 2026-09-08T00:05:52Z. Human choice delay, failed preparation and retry are retained; this is not a clean uninterrupted speed benchmark. The provisional five-minute fully reviewed opening target is not established.

Later on `localhost:5181`, a new empty session in the same cold2 home showed all three entries. The main assistant selected Masks from the parsed-book library, entered name `许舟` and concept `来秘鲁整理古籍的学者，先观察再行动。`, and reloaded the browser. Both draft fields survived. Selecting Start: Lima reused the cached opening and reached the Create character step. No new campaign was created. This validates warm selection and reload recovery, not another cold preparation time.

### Regression checkpoint

Earlier implementation checkpoints passed 5 onboarding, 27 parallel kernel and 8 reader-service tests, then 1055 kernel/play and 112 extension tests; these counts remain historical. The next broad checkpoint passed 1061 kernel/play and 113 extension tests, followed by 35 focused readiness/dossier tests and 37 spatial projection tests. Final postgame checks passed **1097 kernel/play tests** (258.96 seconds, exit 0) and **119 extension tests** (exit 0). Final Electron comparison retained **197 known failures, none new**; targeted UI mechanics passed **16**, external-auth lifecycle passed **15**, and the web build exited **0**. Logs and exit files are under `.coc/playtests/masks-agentic-browser/final-checks/`. Tests support the implementation; separate actual browser/canonical records establish the Peru chapter and settlement. Packaged-app acceptance and stable uninterrupted cold-opening performance are not claimed.

### Cross-chapter continuation correction

The original acceptance missed continuation after accounting: the Peru ending had
incorrectly completed the entire campaign. This is a product defect, not proof that
the next chapter requires a new campaign or character. Acceptance now additionally
requires the same browser campaign to reach the next authored chapter with prior
rewards, investigator growth, flags and historical records preserved.

The existing ending effect now requires chapter/campaign scope. Legacy unscoped
chapter endings can be explicitly reclassified through a new audited turn after
accounting; no save edits or repeated awards are needed. Normal chapter endings keep
the campaign active. The existing source lookup and move/via path then prepares and
enters the next scene. Evidence for the correction is retained separately under
`.coc/playtests/masks-chapter-continuation/`; the earlier report remains a historical
record, including the mistaken completion claim.

The browser continuation succeeded on the same campaign. Turn 68 reclassified the
legacy ending; all 71 pre-existing character, accounting and turn files matched
their pre-correction hashes. The original ending turn 64 and its rewards remain.
Source reading prepared the New York opening (generation 19); turns 70/71 moved
through the old friend's message into `the-big-apple`, where Elias calls with the
Chelsea Hotel meeting. Turn 72 awaits the player, with campaign status active.
SAN 32, Luck 5 and Spot Hidden 51 remain; HP 8→12 is separately receipted recovery
during the four-year time skip. No development or reward settlement was repeated.
