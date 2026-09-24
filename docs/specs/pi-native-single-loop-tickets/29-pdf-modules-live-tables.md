Status: ready-for-agent
Stage: SL-29 (two PDF modules through the product path, each a 20-turn live table and a triage)
Spec: docs/specs/pi-native-single-loop.md; Agents.md (real-table rule: live Keeper, one sentence a turn, no fake-KP shortcuts)

# SL-29 — Two imported PDF modules: build, play 20 turns, triage

## Books (owner's copies)
- A: `/Users/haoli/Documents/TRPG/克苏鲁的呼唤/血色公路.pdf` (111 pages, 26 MB, zh-Hans).
- B: `/Users/haoli/Documents/TRPG/coc英文/Call of Cthulhu - Masks of Nyarlathotep (Larry DiTillio, Lynn Willis, Mike Mason etc.).pdf` (669 pages; `du` showed 0 B, so it may be an iCloud placeholder: read a page first to force the download and report the real size).

## Scope (one worker per book)
1. Import through the product path the App uses (find it in §20/§22 and the App/host code; the driver has a `--module` option for a registered module; the memory notes "pdf-campaign-create-was-impossible" and "reviewer-slip-kills-the-whole-book" describe past failure modes). Report the build's stages, wall time, model calls and cost markers as it goes; for B report after the first chapter and continue unless the build fails.
2. From the built module's own graph write a 20-turn player script in the book's play language (the scenes, people, obligations and checks the graph carries), one sentence a turn, branch rules by structural conditions only; pre-register class lines as `live-gate-long-preregistration.md` does.
3. Play it on the driver (hybrid-v1, PI_COC_JEV_PRESELECT=1) with the App's grok login; triage every finding by class (delivery, wall, routing, admission, binding, looks, prescreen, drops, fiction/rules, stalls) into a dated Comments entry with evidence paths; no fixes in this ticket.

## Comments

### 2026-09-24 — book A (血色公路): the App's import path fails before any reading; stopped at Scope 1 (branch `claude/pdf-a-20260924` at `f2faf4280`)

**Import path found (the App's, not the TUI command).** PipiCOC imports a PDF through `CocOnboardingHost` (`Electron/packages/pi-backend/src/coc-onboarding.ts`), which spawns the built worker `build/pipicoc/onboarding-worker.mjs <action> <input> <configuration>` through `runtime/preparation.ts`, with `EXT_JEV_APIKEY` and `PIPIUI_EXT_SETTINGS_JEV` from `preparationEnv`. The actions run in this order: `inspect` (`sourceInfo` + `module.source.bind`: the module is registered, the PDF copied into `.coc/modules/<id>/source.pdf`), then phase `guidance` (`ReadingService.prepare({purpose: "guidance"})`, character guidance and the opening scene), then phase `opening` (`prepare({start_scene, targeted: true})`), then `converse` (`campaign.create {module, start_scene, guidance_key, play_language}`), and then character creation in a setup session and the handoff to play. `/coc module parse` answers with one line outside the TUI, so the driver cannot use it. The setup table's `prepare-module` step (`content/setup/steps.json`, `extensions/onboarding`) is a second host path. It calls `ReadingService.prepare` without a guidance fingerprint, and I did not try it: switching paths is a method change that needs the owner's word. Pregens exist only for starters (`kernel-ts/write/index.ts` `campaign.create`), so a table on a PDF module needs a character made in the setup session (`driver.py start --launcher bin/pi-coc-setup`).

**What ran.** The worker ran exactly as `runtime/preparation.ts` spawns it: source layout, agent home `.pi/coc-agent` seeded from the App's `auth.json`, Jev key read from the App vault as `gate2-start.sh` reads it, model `grok-build/grok-4.7-build-fast` with thinking `low`, play language `zh-Hans`. The PDF was copied into a git-ignored evidence directory because `inspect` writes a `pages/` cache next to the PDF it is given.

| stage | wall | model calls | result |
| --- | --- | --- | --- |
| `bin/coc-source --pdf … info` (the file opens) | 0.6 s | 0 | 111 pages, bookmarks from 目录 onward |
| `inspect` | 1.2 s | 0 | `{module_id: "book-1", replayed: false, page_count: 111}`; module `registered`, generation 0, no graph |
| `guidance` | 0.6 s | 0 | refused: the worker emitted the overlay sentence "The preparation stopped before it answered…" with detail `ENOENT … .coc/modules/book-1/module-graph.json` |
| `guidance`, `retry: true` (the App's retry button) | 0.6 s | 0 | the same ENOENT |

**P0 import (binding of the guidance key to a graph that does not exist yet).** The App cannot prepare any PDF it has not read before. `pipicoc/onboarding-worker.ts:200` computes `guidance_key = await guidanceFingerprint(...)` before it calls `reader.prepare`. `extensions/module/character-guidance.ts:61` reads `meta.graph_file || 'module-graph.json'` unconditionally. A freshly bound visual PDF has no graph until the skeleton is read, so the worker throws before any reading starts and the job fails. Retrying cannot help, because the retry runs the same `guidance` phase (`coc-onboarding.ts:376`). Before `d552e5f77` (2026-09-20, "add Jev task runtime and source-bound evidence") the graph read was guarded by `if(!source)`, so a PDF with `file_sha256` did not read the graph there. The App's own evidence matches: the last PDF import in the App home is `~/Library/Application Support/Pipi/pipicoc/pi-coc/.coc/imports/d8a1cda4-1afc-4fc9-9a6e-040a1f5d2ca6` (血色公路, 2026-09-18, `book-4`, guidance and opening ready), which predates the change. Every App import since is a starter. The `guidanceFingerprint` cases in `tests/extension/character-guidance.test.mjs` all write a `module-graph.json` first. I found no test that runs the worker's `guidance` action on a freshly bound PDF. The same code serves every book, so book B (Masks) goes through the same `guidance` phase.

Not reached, so not scored: script, pre-registration, table, and the classes delivery, wall, routing, admission, binding at the table, looks, prescreen, drops, fiction/rules and stalls. No model call, no reading job and no table was started.

Evidence (git-ignored, kept): `/Users/haoli/leehow/code/chatrpgv4-wt-pdf-a/.coc/playtests/sl29-a-import/` (`inspect.events.jsonl`, `guidance.events.jsonl`, `*.stderr.log`, `source.pdf` copy) and `/Users/haoli/leehow/code/chatrpgv4-wt-pdf-a/.coc/modules/book-1/` (`module.json`, generation 0, empty `sections.json` and `deepen-queue.json`). The harness is the session scratchpad's `pdf-a/worker.sh`. It runs `node build/pipicoc/onboarding-worker.mjs <action> '<input + home>' '{"layout":"source","backend":"typescript",…}'` with `EXT_JEV_APIKEY`, `PIPIUI_EXT_SETTINGS_JEV={"ext.jev.preselectEnabled":true}` and `ELECTRON_RUN_AS_NODE=1`.

### 2026-09-24 — book A (血色公路) after SL-32 (`b8aced229` merged, `2a691ee36`): guidance passes, the opening is refused twice on a transcription conflict with the guidance's own value; stopped at Scope 1

This run follows the App's worker order on module `book-1`, which had been bound by the earlier run. Everything else is as in the entry above: `grok-build/grok-4.7-build-fast` low, zh-Hans, App grok login, Jev key from the vault. It was the only import on the Mac. The harness is committed in `29-book-a/`: `worker.sh` spawns the built worker as `runtime/preparation.ts` does, `stages.py` summarises the import. `triage.py` was prepared for the table and never used.

| step | wall | stages (UTC) | model calls (reader+review) | tokens in / out | outcome |
| --- | --- | --- | --- | --- | --- |
| guidance | 64 s | read 13:30:24 → verify 13:31:07 (1 unit) | 4 (2+2) | 56K / 6K | ready: key `d333f169…`, scene 序幕, graph generation 1 (2 nodes: module, 序幕) |
| background index `read-2` (started by the worker) | 91 s + audit 36 s | pages 1–4, 18–19, 45, 57, 60–65, 74–75 | 12 (12+0) | 345K / 6K | completed |
| opening #1 | 192 s | read → verify (5 units) → read r2 → verify → read r3 → verify; foreground wait released at 13:33:40 (120 s, `unwaited`) and the worker re-requested | `read-3` 52 (19+33); `read-4` 18 (13+5) | 1.22M / 48K | **failed**: `needs_choice: the new reading contradicts a published value`, `retryable: false`, surfaced as the generic "The preparation stopped before it answered" with `code: needs`, `reason: reading_failed`, `fix: request the same reading with retry: true` |
| opening #2 (`retry: true`, the App's button) | 167 s | read → verify (5 units) → read r2 → verify | 34 (9+25) | 653K / 39K | **failed**, same conflict |
| total | ≈ 7.1 min | | **120** | 2.27M / 100K | generation 1, `status: assembled`, `opening_ready: false`; `converse` not possible |

**P0 import: a transcription the guidance reading published blocks every opening reading.** Both refusals name the same field (`work/read-3/attempt-1/findings.json`, `work/read-5/attempt-1/findings.json`), `/nodes/module-book-1/properties/investigator_hook`:
- existing, written by the guidance reading into generation 1: "唯一的**卡片**要求是：…轰**蹭**青少年或电视记者。"
- proposed by opening #1: "唯一的**车卡**要求是：…轰**趴**青少年或电视记者。"
- proposed by opening #2: "唯一的车卡要求是：**PC要**有理由…**理由可以包括（但不限于）**…轰趴青少年…"

These are the same sentence on the same page. The published copy carries the misreadings (卡片 for 车卡, 轰蹭 for 轰趴), and both opening readers read the page more correctly. The opening reader was shown the existing value (`read-5/attempt-1/packet.json` → `known_nodes[module-book-1].properties.investigator_hook`, node `ready: false`) and rewrote it anyway. The publication gate treats a different transcription of one source span as a contradicting fact and marks it `retryable: false` / `next: change_input`. A retry therefore passes only if the reader happens to copy the earlier misreading. §22.6 lets a node that is not yet ready have its `summary` replaced when it first becomes ready, but not its properties. So a transcription error the guidance phase put into a not-ready module node freezes, and it blocks the opening, which is the only thing a PDF campaign needs before `converse`. The player sees "retry", and each retry costs about 3 min and 35–50 calls without converging. SL-32's manual check of the same book passed on its retry, so whether an import succeeds depends on whether two readers transcribe one sentence identically. System gap, not a content patch: the conflict rule (or the reader brief for a field already published and not ready) does not tell a re-reading of the same source apart from a different fact.

**P1 import cost: a second opening reading of the same scene during the first.** When the 120 s foreground wait expired, the worker's `reading_timeout` loop re-entered `prepare`. The queue then gained `read-4` (`purpose: opening`, `repair: way_on`, focus `xu-mu`, the handle of 序幕), which read the same pages 6–8 and 16–17 while `read-3` was still in its third round (18 calls, 286K tokens). It was cancelled when the worker exited (`The runtime owner or operation is closed or cancelled` ×5). This is §90.5's connection-point repair firing on a book whose opening is still being prepared.

**P2 import (reported by SL-32, confirmed): the refusal reaches the player as the generic sentence.** The reason and field go only to `detail`, which the App's overlay does not show (§48). The player cannot know that retrying will not help.

Not reached, so not scored: `converse`, the setup session, the script, the pre-registration, the table, and every table class. No campaign exists for book A.

Evidence (git-ignored, kept): `/Users/haoli/leehow/code/chatrpgv4-wt-pdf-a/.coc/playtests/sl29-a-import/{guidance,opening}.events.jsonl` and `/Users/haoli/leehow/code/chatrpgv4-wt-pdf-a/.coc/modules/book-1/`, including `deepen-queue.json` (read-1…5 with states and details), `work/read-{1..5}/attempt-1/` (packets, drafts, `findings.json`, reader and reviewer `*.requests.jsonl`, image logs), `module.json` and `generations/generation-1-…/`.

### 2026-09-24 — book A (血色公路) end to end on `519d7c3e3` (integration `65b1e76b9`: SL-28/31/32/33): import passes, setup passes, 20 turns played, and the investigator never reaches the town

Fresh home `.coc/playtests/sl29-a-run2/home`, a new registration (`book-1`). The App's worker order was spawned as `runtime/preparation.ts` does (`29-book-a/worker.sh`). Model `grok-build/grok-4.7-build-fast` low with the App's grok login, Jev key from the App vault, zh-Hans. This was the only import on the Mac. The script and pre-registration (`29-book-a/script.md`, `29-book-a/preregistration.md`) were committed at `a6326293d` before the table opened. The table was played with `29-book-a/play.py` (one sentence a turn, structural branches only) on driver run `sl29a-xuese-1436-20260924T143912Z`, campaign `sl29a-xuese-1436`, hybrid-v1, PI_COC_JEV_PRESELECT=1. The per-turn structural table is `29-book-a/triage.txt` (from `29-book-a/triage.py`).

**Import (Scope 1).**

| step | wall | model calls (reader+review) | tokens in / out | result |
| --- | --- | --- | --- | --- |
| inspect | 1 s | 0 | – | `book-1`, 111 pages, no graph |
| guidance | 152 s | 10 (6+4), 2 review rounds | 139K / 14K | ready, key `d333f169…`, scene 序幕, generation 1 |
| opening | 142 s | 21 (11+10), 1 round, 5 units | 409K / 19K | `opening_ready: true`, generation 2 (4 nodes: module, rule 回头或继续，下场一样, 序幕, 欢迎来到"屠宰场"), `installed`. No retry needed and no same-span conflict (SL-33 holds on this book). |
| converse | <1 s | 0 | – | campaign `sl29a-xuese-1436`, `opening_scene: prologue`, title `血色公路.pdf` |
| total | ≈ 5 min | 31 | 548K / 32K | – |

The worker's background index (`read-2`) and the detail job for 欢迎来到"屠宰场" (`read-4`) were cancelled when the worker exited (`The runtime owner or operation is closed or cancelled`). The table later redid both in the campaign's fork.

**Setup (live, `driver.py --launcher bin/pi-coc-setup`, run `sl29a-xuese-1436-setup-20260924T143613Z`).** 3 turns, 53 s, 8 tool calls. The assistant opened with the guidance's prologue text and asked one question. The card was drafted from one player sentence: 雷·卡特, Private Investigator, Drive Auto 55 (meets the book's ≥ 55 constraint), revision 2. It was confirmed and handed off (`ready_for_table`). The assistant said that cash is reckoned in the modern era "because the book has no 1975 column". The rulebook's cash table stops at modern, so this is a stated fallback, not a defect.

**Table (Scope 3).** The opening (turn 0, about 53 s after the driver started) landed at the fork sign. The billboard was already behind, so script turn 3 (the billboard) was answered honestly: "小牌不在前头了". No branch fired: `present`, `moved` and `hurt` were false every time.

| class | pre-registered line | measured | verdict |
| --- | --- | --- | --- |
| delivery | 20/20 with prose | 20/20 settled, 0 stranded. In 4 turns (t4, t8, t15, t20) the player got **only the host's reading-wait notice** ("本桌需要的一段原文还在读取…随便说句话就能继续"): the Keeper's draft was dropped with `reading_wait`. | fail (4 turns with no fiction) |
| wall | median ≤ 45 s, ≥ 80% ≤ 60 s | median 30.4 s, 15/20 ≤ 60 s (75%), max 211.5 s. All five over 60 s were the 120 s foreground map wait (t4 156, t8 174, t12 158, t15 164, t20 212). Without them: median 28 s, max 45 s. | fail, one cause |
| routing | declared move to the graph's destination selected by the compile | the compile selected `apply:move:welcome-to-abattoir` on t4, t6 and t12. The Keeper tried the same move on t1, t7, t8, t14, t15 and t20. **All 9 moves refused**; active scene `prologue` for the whole table, clock 20 min. | routing right, move never lands (see P0) |
| admission | no row > 12 s; clerk on compile | 7 clerk writes on `compile` at 0 ms. t7 lane `model_error` "Request timed out." after 10.0 s (deepseek-v4.1-flash): the move was refused "review unavailable". t14 `review_pending` at the 13.0 s cap (`cause: cap`). No `review_timeout`. | fail (t14 13.0 s) |
| binding | `infer(bind)` = 0 | 0. Ordinary checks bound by compile/Jev: Navigate t2, Engineering t5, Spot Hidden t16, Listen t17. | pass |
| looks | ≤ 1 per turn after first visit | 2 `lookup kind=module` (t14 "马瑟综合商店 阿巴托尔" → not_found, t20 "最后一站食宿"), 0 `lookup kind=source` | pass |
| prescreen | status per read | `prepared` on every read, 2 candidates each (the scene never changed), 1.3–5.2 s, no fallback, no budget spent by it | pass |
| drops | every drop has a reason | text_beside_tool_calls 9, floor_steer 4, reading_wait 4, all with rows | pass |
| fiction/rules | rule holds; people from the book; checks rolled by `resolve`; speech tokens | The Keeper never narrated an arrival it had no receipt for. On t6 it kept the player at the bridge although the sentence said "到了镇口"; on t9–t11 and t13–t18 it said there was nobody to ask. No invented people, no stat blocks, no push. Psychology (t10) was correctly not rolled (no one present). The bridge check rolled **Engineering** (not on the sheet; base value) rather than a skill the investigator has. The verifier flagged player agency on t1 (parked the truck when the player said keep driving) and t15, and uncommitted state on t6 and t16. The t7 narration put host state into the fiction ("服务暂时没接上，你下一条再开过去就行"). Speech rows 0 (no NPC ever). | honest, but dead table |
| stalls | none; provider errors listed | none at the table (Keeper provider errors 0). In reading: 3 `review_transport_retry` "source reviewer failed" in `read-3` | pass |
| reading | every foreground read has rows and an outcome; timeouts listed; fork publishes; no same-span failure | the campaign forked at its first scoped read (`module-campaigns/sl29a-xuese-1436/modules/book-1`, now generation 3, 7 nodes: + scene 埃索加油站, clues 镇口人口标牌已经过时 and 加油站前的男人盯着来人). `read-1` index 97 s + audit 38 s, 11 calls. `read-2` detail 欢迎来到"屠宰场" completed 14:40:51 (before t4), 13 calls. `read-3` **map** detail (foreground, raised by the t4 move) 14:42:27–14:59:40, **79 calls (21+58), 2.12M in / 119K out, failed**. `read-4` (the map again) 14 calls, 549K in, read phase `ok: false` at 120 s, left `running` in the queue when the table stopped. | fail (P0 below) |

Cost at the table: 43 Keeper provider calls, 75 lane calls (memory 22, verifier 21, journal 21, admission 11), 43 Jev prescreen deliveries. Reading in the fork: 117 calls, about 3.3M tokens in, most of it the failed map.

**Findings, one root cause each**
- **P0 routing/reading: first arrival is gated on the scene's map, and a map that fails review blocks the destination for good.** `kernel-ts/modules/reading.ts` `requireArrivalMapMaterial` refuses `apply move` into a scene whose record carries `map_candidates` until a reviewed map that depicts it is published (§107). The scene's own text was ready (`read-2` completed before t4). But the map of Abattoir (`read-3`, question "Prepare the source-backed map Abattoir, Texas that depicts 欢迎来到"屠宰场"…") spent 17 min and 79 calls. It then failed visual review, `invalid_params: visual review did not support ['/nodes/0/properties/map_regions', …/map_regions/1,3,4/source_box/*, …/placement/*]`: the reviewer judged three region boxes misplaced against the printed markers 2b and 2c. §107 says "a false candidate may settle as no usable map; it does not loop". A real map whose regions are refused never settles, so every later move re-raises `material_pending` and re-reads. Nine refused moves in 20 turns; the town (the book's whole play space) was never entered. System gap: a map is orientation material, and a failed or pending map should not hold the move. Settle the move and deliver the map when it lands, or settle the map as unusable after a refused review.
- **P1 wall: the 120 s foreground wait is spent on the map, per move.** All five turns over 60 s were this wait (t4, t8, t12, t15, t20). The job outlived five waits and was unwaited each time (`unwaited` rows at 14:44:27, 14:48:37, 14:52:36, 14:56:25, 15:01:40).
- **P1 delivery: a turn whose only action waited on reading delivers no fiction.** On t4, t8, t15 and t20 the Keeper's draft was dropped with `reading_wait` and the player read only the host notice. Per §22.4 the notice is the host's; but a player who declared a drive got neither the drive nor anything else for 2–3 min, four times.
- **P2 admission: the lane reviewer (deepseek-v4.1-flash) timed out at 10.0 s on t7 and hit the 13 s cap on t14.** Both were the same move (key `868cdeabc5d5`, Jev `typed_refusal` fallback with confidence 0.26 and 0.62). The t7 refusal reached the fiction as "服务暂时没接上" (host state in prose, §47).
- **P2 reading cost: review transport.** `read-3` had 3 `review_transport_retry` ("source reviewer failed") and 58 review calls across 2 rounds, 2.1M input tokens for one map, which is about 4× the whole import.
- **P3 rules: the bridge check rolled Engineering**, which the investigator does not have, not a skill on the sheet. The prologue rule (turn back or continue, same end) was never exercised: the player never turned back.
- **P3 fiction: player agency.** On t1 the Keeper parked the truck when the player said keep driving (verifier `player_agency`, continuity finding). On t15 the Keeper put the player back in the truck and started it. On t16 "引擎没响" contradicted t15 (`uncommitted_state`).
- **P4 import: title `血色公路.pdf`.** The App passes the upload name, extension included, as the campaign title (`coc-onboarding.ts` `converse`: `title: job.name`).
- **P4 import: background work dies with the worker.** The worker's own index and detail jobs are cancelled at exit, so the table re-reads them (index 11 calls, detail 13 calls).
- Held: SL-32 (guidance on an unread PDF) and SL-33 (no same-span refusal, no duplicate opening reading); the fork publishes privately; no provider errors at the table; no stall; no invented NPCs or receipts.

Evidence (git-ignored, kept):
- import: `/Users/haoli/leehow/code/chatrpgv4-wt-pdf-a/.coc/playtests/sl29-a-run2/{inspect,guidance,opening,converse}.events.jsonl`; library module `…/sl29-a-run2/home/.coc/modules/book-1/`
- setup: `/Users/haoli/leehow/code/chatrpgv4-wt-pdf-a/.coc/playtests/sl29a-xuese-1436-setup-20260924T143613Z/`
- table: playtest `/Users/haoli/leehow/code/chatrpgv4-wt-pdf-a/.coc/playtests/sl29a-xuese-1436-20260924T143912Z/` (turn-N.json, events.jsonl); campaign `…/sl29-a-run2/home/.coc/campaigns/sl29a-xuese-1436/` (turns/0000–0020.json, telemetry.jsonl)
- reading: fork `…/sl29-a-run2/home/.coc/module-campaigns/sl29a-xuese-1436/modules/book-1/` (`deepen-queue.json` with read-3's full refusal, `work/read-{1..4}/`) and `…/sl29-a-run2/home/.coc/reading-telemetry.jsonl`
- per-turn prose and tool dump (not committed, it carries book-derived text): `…/sl29-a-run2/prose.txt`
### 2026-09-24 — Book B (Masks of Nyarlathotep), Phase 1: source, import path, estimate, commands (worker `claude/pdf-b-20260924`)

**Held** by the coordinator at 13:0x Z until SL-32 (guidance keyed before the first reading) lands on the integration branch. No build, model call or table is running. Scope 2–3 not started.

**Source.** Not a placeholder when checked: 46,556,793 bytes (44 MB on disk), sha256 `806966db20202a020af6213695dccc0b547fc998a73dd2f1344567e2579a1942`. pypdf opened it: 669 physical pages (667 at 594×774 pt, the cover a 1279×792 spread, one 648×828), native text layer present (≈3.2k chars/page over the first 60 pages), 27 top-level bookmarks (Introduction p.10, Prologue: Peru p.50, Ch.1 Campaign Beginning p.94, Ch.2 America p.102, England p.180, Egypt p.298, …). Read-only; the App-equivalent upload copy lives in the ignored `.coc/imports/sl29b-masks/source.pdf`, nothing tracked.

**The App's import path** (`Electron/packages/pi-backend/src/coc-onboarding.ts` → `runtime/preparation.ts` → `pipicoc/onboarding-worker.ts`):
1. upload into `<home>/.coc/imports/<job>/source.pdf`; worker `inspect` = `runtime.sourceInfo` (PDF.js, host side) + `module.source.bind` (kernel copies and digests; no model).
2. phase `guidance` (worker action `guidance`): `guidanceFingerprint` → `ReadingService.prepare({purpose: guidance})` → one tool-enabled author + one reviewer; `guidance.scene` becomes `start_scene`.
3. phase `opening` (worker action `opening`, `targeted: true`): `module.read.request {purpose: opening, focus: start_scene}` → author + up to 40 reviewers (§22.0/§22.6), publish through `module.read.finish`; `module.read.ahead` then queues the index and exits of the opening in the background.
4. `converse` = `campaign.create {module, start_scene, guidance_key, play_language}`; character creation in the setup session; handoff.
Terminal equivalents use the same `ReadingService.prepare` without the guidance purpose: setup step `prepare-module` (`content/setup/steps.json`) and `/coc module parse` (`extensions/table/commands.ts`): skeleton → `needs_choice` when the skeleton has several authored entrances → opening. The worker's own `prepare` action is that sequence plus guidance afterwards. There is no whole-book build any more (§22 replaced §14.3/§20): "the first chapter" is the opening scene's material; the rest is read by index batches (≤12 pages a task) and by on-demand/adjacent `detail` reads during play.

**Observed.**
- `inspect` 12:49:40Z: `{module_id: book-1, replayed: false, page_count: 669}` in 1.5 s, zero model calls.
- `guidance` 12:49:55Z: failed at once, zero model calls: `ENOENT … .coc/modules/book-1/module-graph.json` (worker `code: ENOENT`, overlay sentence "The preparation stopped before it answered"). Cause: `pipicoc/onboarding-worker.ts` computes `guidanceFingerprint` (which reads the graph, `extensions/module/character-guidance.ts:61`) before any reading; an unread book has no graph. Every App import in the App home since has been a `replayed` bind of a book that already had a graph (`~/Library/Application Support/Pipi/pipicoc/pi-coc/.coc/imports/*/job.json`: book-1, book-4), and `tests/extension/runtime-onboarding.test.mjs` fakes the worker, so nothing exercised a fresh book. Same defect as book A → SL-32. Evidence: `/private/tmp/…/scratchpad/sl29b/guidance.jsonl`.
- Before the hold arrived I ran the worker's `prepare` action (the reading service setup's `prepare-module` drives). **Skeleton** `read-1` 12:51:21→12:57:12Z (5 min 51 s): 1 author session (10 provider turns, 127 s, 18 page images) + 14 review units (15 sessions, 49 turns); 1.25 M input tokens (cache reads included), 28.4 K output; pi cost markers $0.00 (grok-build OAuth carries no price). Published generation 1: module node, 9 playable units (Peru, Campaign Beginning, America, England, Egypt, Kenya, Australia, China, Grand Conclusion), 2 entrance scenes, 13 claims; `needs_choice` with candidates `bar-cordano` ("Optional prologue entrance", Lima 18 March 1921) and `hotel-chelsea-room-410` ("Entrance of the campaign proper", 15 January 1925). The background index `read-2` was cancelled with zero turns when the worker exited.
- **Opening** `read-3` (focus `bar-cordano`, chosen by the structural rule "first candidate in the graph's order"): failed 12:57:34→13:00:43Z on transport, not content: round 1 116.6 s with one `Provider stream timed out: no response event for 60000 ms` retry; round 2 72.7 s with three `Connection error.`; then `ContractError: provider_budget_refused` → `reading_failed`, `fix: request the same reading with retry: true`. Book A was importing on the same login at the same time. Not retried (hold). Evidence: `.coc/modules/book-1/work/read-3/attempt-1/read-{1,2}.jsonl`, `deepen-queue.json`, `/private/tmp/…/scratchpad/sl29b/prepare2.jsonl`.

**Estimate** (the pipeline's own accounting: one author child `pi` per phase round, one reviewer child per review unit, rounds ≤ 2 + one repair; history from `…/Pipi/pipicoc-masks-latency-20260910/pi-coc/.coc/modules/book-1/work` and `wt-pi-coc-v2/.coc/playtests/jev-masks-home-20260921/.coc/modules/book-1/work`, summed by `scratchpad/sl29b/cost.py`):

| stage | sessions (author + reviewers) | provider turns | wall | notes |
| --- | --- | --- | --- | --- |
| inspect/bind | 0 | 0 | 1.5 s | observed |
| skeleton | 1 + 14 | 59 | 6 min | observed |
| guidance | 1–2 + 1–2 | 20–75 | 5–20 min | history (09-17: 2 of 4 attempts failed) |
| opening (Lima) | 1–2 + 6–73 | 30–330 | 8–12 min / attempt | history: 2 of 3 attempts failed on 09-09 |
| index (background) | ≈3 per 12-page batch | ≈40 | minutes per batch | history read-13 |
| detail read (each place entered) | 1 + 9–46 | 40–440 | 3.5–15 min | history: 6 in the Peru chapter |
Whole prior App run (guidance + opening + 6 Peru details): 139 sessions, 803 provider turns, 10.7 M input / 167 K output tokens, $11.70 in pi's markers at xai/grok-4.6 prices; on grok-build the markers read $0 and only tokens are meaningful.

**Exact commands** (worktree `/Users/haoli/leehow/code/chatrpgv4-wt-pdf-b`, `npm run build:runtime` done, `.pi/coc-agent` = copies of the App's `auth.json`, `grok-build-models.json`, `models-store.json`, `pipiui-settings.json` + a `settings.json` naming this worktree). The worker is invoked exactly as `runtime/preparation.ts` does, with `EXT_JEV_APIKEY` read from the App's vault (never printed):
```
node build/pipicoc/onboarding-worker.mjs <inspect|guidance|opening|prepare|converse> \
  '{"pdf"|"module_id":"book-1","name":"<file name>","source":"pdf","play_language":"en","model":"grok-build/grok-4.7-build-fast","thinking":"low","start_scene":"<scene>","home":"<worktree>"}' \
  '{"layout":"source","backend":"typescript","resourceRoot":"<worktree>","contentRoot":"<worktree>/content","agentHome":"<worktree>/.pi/coc-agent","nodeExecutable":"<node>","kernelEntrypoint":"<worktree>/build/kernel/rpc.mjs"}'
```
(wrapped by `scratchpad/sl29b/prep.sh`, `chain.sh` for the App's guidance→opening order, `prepare.sh` for the worker's `prepare`.) After SL-32: `guidance` then `opening` with `start_scene` = the guidance scene, retry of `read-3` via `"retry": true`; then `converse {campaign: sl29b-masks-<hhmm>}`; the investigator through the live setup session (`uv run --frozen python tests/play/driver.py start --campaign <id> --launcher bin/pi-coc-setup`; `--pregen` is starters-only, `kernel-ts/write/index.ts:486`); then the table with `tests/play/driver.py start --campaign <id> --env PI_COC_LOOP_ENGINE=hybrid-v1 --env PI_COC_JEV_PRESELECT=1` and the vault key, as `gate2-start.sh` does.
