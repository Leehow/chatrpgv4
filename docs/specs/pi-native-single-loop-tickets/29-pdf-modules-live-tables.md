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

### 2026-09-24 — Book B (Masks of Nyarlathotep), Phase 2 on `a6be446f` (integration `37c7a311e`: SL-28/30/31/32/33 + book-A harness merged): guidance passes, the opening reading fails twice with the same masked refusal; stopped at Scope 1 per the two-failure rule

Fresh home `.coc/playtests/sl29-b-run1/home`, a new registration (`book-1`, the same PDF re-inspected: sha256 unchanged, 669 pages). Worker order run exactly as `runtime/preparation.ts` spawns it (`29-book-b/worker.sh`, adapted from `29-book-a/worker.sh` for this worktree and this run's evidence directory). Model `grok-build/grok-4.7-build-fast` low, the App's grok login, Jev key from the App vault, target play language zh-Hans. Harness: `29-book-b/{worker.sh,start.sh,stages.py,play.py,triage.py}` copied from `29-book-a/` and repointed at this worktree; `script.md`/`preregistration.md` were not filled in because no campaign exists to derive them from.

**Import (Scope 1).**

| step | wall | reader/review calls | tokens in / out | result |
| --- | --- | --- | --- | --- |
| inspect | 1 s | 0 | – | `book-1`, 669 pages, no graph (fresh home; sha256 matches phase 1) |
| guidance | 77 s | 6 + 2, 1 review round | 149K / 6K | **ready**: key `88062115…`, scene `Start: Lima`, generation 1. `guidance.scene` = "Start: Lima" (Bar Cordano, 18 March 1921), `guide` = Augustus Larkin. Background index `read-2` queued, 0 pages read before the process exited. |
| opening #1 (`read-3`, focus `Start: Lima`) | 241 s | 12 + 0, 0 review rounds (never reached review) | 332K / 12K | **failed**: 2 read rounds, both `ok:false` after ~120 s each (round 1: 119.8 s, 16 image reads; round 2: 120.5 s, 16 image reads), then `ContractError: provider_budget_refused`, surfaced as the generic "The preparation stopped before it answered", `code:"needs"`, `reason:"reading_failed"`, `fix:"retry:true"` |
| opening #2 (`retry:true`, the App's retry button) | 239 s | 13 + 0, 0 review rounds | 290K / 3K | **failed**, same shape: round 1 112.3 s (11 images) `ok:false`, round 2 125.5 s (15 images) `ok:false`, then the same masked `provider_budget_refused` |
| total | ≈ 9.3 min | 31 reader + 2 review | 771K / 21K | generation 1, `opening_ready: false`; no campaign created |

Stopped here per the run instructions (fail once, retry once, stop on the second failure). `.coc/playtests/sl29-b-run1/home/.coc/campaigns/` does not exist: `converse` was never attempted. Scope 2 (script, pre-registration) and Scope 3 (the 20-turn table) were not started for book B in this run.

**P0 import: the opening reading of a busier/larger book exhausts an internal provider budget partway through, and the failure reaches every consumer as one masked, generic error.** Both attempts show the same shape: two ~120 s read rounds that each come back `ok:false` (not a clean single-round success the way book A's opening was, at 142 s / 21 calls / 1 round), then a terminal `ContractError: provider_budget_refused` that ends the worker's retry loop outright rather than looping again on `reading_timeout`. Tracing the code: `pipicoc/onboarding-worker.ts`'s `guidance`/`opening` calls never pass `reader.prepare()` an explicit provider budget, so `runtime/tasks.ts:286-288` wraps every reading task in a fresh `independentProviderBudget('standalone-reader', …)` (`runtime/jev/provider-budget.ts`) whose lease is a *fixed* `{remainingInputTokens:1_000_000, remainingOutputTokens:65_536, remainingCostUsd:10, remainingActions:16}` — sized without regard to the book, the model's declared `context_window` (500,000 for `grok-4.7-build-fast`, so one multimodal reservation alone books the model's full context per `boundProviderRequest`'s conservative accounting), or how many image-heavy round-trips a scene needs to establish. Whichever of these ceilings (or a genuine transport failure inside the child — phase 1's pre-hold run on this same book showed explicit `Provider stream timed out: no response event for 60000 ms` and `Connection error.` text before the same terminal string) actually triggers, `extensions/module/reader.ts:306` deliberately reports it to the child, and thence to `deepen-queue.json` and the App's overlay, as the single opaque string `'provider_budget_refused'` — masking which dimension (if any) was exhausted versus a plain network failure. I could not tell the two apart from the evidence this run produced, because `independentProviderBudget` wires no `record` callback (no telemetry captures the lease's remaining values) and the reader's own stderr log was empty both times. Guidance for the same book, same lease shape, succeeded at only 6 reader calls; book A's own successful opening (111 pages) needed only 21 calls in one round. Masks' Bar Cordano dinner scene (several fellow investigators, Augustus Larkin, a lot of surrounding page material per the guidance's own `viewed_pages` spanning pp. 4-120 and 621) is the first case in this ticket where a book's *opening* reading — not a later map or detail read — needs more back-and-forth than the fixed standalone budget or the transport allows, and it fails before any campaign exists, which is upstream of and blocks everything else in scope 2/3. **This is a new finding, not the same root cause as any of book A's P0-P4** (book A's were about the map gating arrival during play, a same-span transcription conflict, and lane/wall costs at the table — all downstream of a working import). It is, however, the same *symptom* phase 1 hit before the SL-32/33 hold ("transport, not content", `provider_budget_refused`), which confirms SL-32 (guidance-before-graph) and SL-33 (same-span retranscription) did not touch this failure mode: it is still open on the integration branch.

**P4 import cost note.** Both failed opening attempts (25 reader calls, 622K input tokens combined) produced zero review-side calls: the reader never got far enough to hand a draft to a reviewer, so all of that cost bought nothing toward a published graph. Guidance's background index job (`read-2`) was queued but read 0 pages before the worker process exited (same as book A's pattern of background jobs dying with the worker).

**Confound noted, not scored as a finding.** Two other live sessions were running on this Mac's grok-build login at the same time (`craft-default-on-live-20260924` in `chatrpgv4-wt-pi-coc-v2`, and a long-gate #3 investigation against `chatrpgv4-wt-integ-sl`), the same class of confound phase 1 flagged for book A's own transport failure ("book A was importing on the same login at the same time"). This run's own driver/worker processes used no other worktree's socket, so there was no state collision, only possible shared-account contention; I cannot rule it in or out with the evidence collected here.

Evidence (git-ignored, kept):
- import: `/Users/haoli/leehow/code/chatrpgv4-wt-pdf-b/.coc/playtests/sl29-b-run1/{inspect,guidance,opening}.events.jsonl` (opening's file holds both attempts, in order, separated by their `start`/`exit` markers)
- module state: `/Users/haoli/leehow/code/chatrpgv4-wt-pdf-b/.coc/playtests/sl29-b-run1/home/.coc/modules/book-1/` (`module.json` generation 1, `deepen-queue.json` with read-1..4, `work/read-{1,3,4}/attempt-1/` for reader/review requests and token accounting)
- phase-1 evidence (source inspection, sha256, earlier ENOENT/transport observations before the SL-32 hold): `/Users/haoli/leehow/code/chatrpgv4-wt-pdf-b/.coc/imports/sl29b-masks/source.pdf`, `/Users/haoli/leehow/code/chatrpgv4-wt-pdf-b/.coc/modules/book-1/` (the phase-1 registration, separate from this run's fresh home)
- harness: `docs/specs/pi-native-single-loop-tickets/29-book-b/{worker.sh,start.sh,stages.py,triage.py}` (copied from `29-book-a/`, repointed at this worktree and this run's paths). `play.py`, `script.md` and `preregistration.md` were copied from `29-book-a/` too but then deleted rather than committed unmodified: their content (the 血色公路 driving script, the Abattoir-town pre-registration lines) is book-A-specific prose that would be actively wrong under `29-book-b/`, and there is no campaign or graph for book B yet to derive a real script and pre-registration from (Scope 2 needs Scope 1 to land first).

### 2026-09-24 — book A (血色公路) SL-29A follow-up on batch-4 `a1bdf7004` (integration `claude/integ-single-loop-20260923`, SL-34/35/36/37/38/40/42 merged on top of the table above): the town's own arrival is fixed; a new reading-capacity/lease bug blocks every sub-location discovered inside it

New worktree `/Users/haoli/leehow/code/chatrpgv4-wt-sl29a-b4` (branch `claude/sl29a-b4-20260924`) at `a1bdf7004`, node_modules symlinked from `chatrpgv4-wt-pi-coc-v2`, `npm run build:runtime` done, `.pi/coc-agent` copied from `chatrpgv4-wt-sl34/.pi/coc-agent` (freshest grok-build token). The imported home was reused rather than re-imported: `chatrpgv4-wt-pdf-a/.coc/playtests/sl29-a-run2/home` (module `book-1`, generation 2, the same 4-node graph SL-29A tested) was copied into this worktree's `.coc/playtests/sl29a-b4/home` and loaded cleanly on the batch-4 build (SL-35's module-store shape change did not break it, so no fresh PDF import was needed or performed). A NEW campaign, `sl29ab4-xuese-2401`, was created from that module via the onboarding worker's `converse` action (not a reuse of SL-29A's own campaign `sl29a-xuese-1436`); harness copied and repointed at this worktree as `docs/specs/pi-native-single-loop-tickets/29-book-a-b4/{worker.sh,start.sh,play.py,triage.py,script.md}` (script unmodified from `29-book-a/script.md`), with `29-book-a-b4/preregistration.md` written and committed before the table opened. Investigator 雷·卡特 (Private Investigator, same trade/strengths as SL-29A's) was made in a live setup session (5 turns, 99.9 s, 8 tool calls, run `sl29ab4-xuese-2401-setup-20260924T171243Z`). The table was played with `29-book-a-b4/play.py` (one sentence a turn, structural branches only) on driver run `sl29ab4-xuese-2401-20260924T171528Z`, hybrid-v1, `PI_COC_JEV_PRESELECT=1`, grok-build/grok-4.7-build-fast low. A second live table (long gate #4, the Haunting) ran concurrently on this Mac from `chatrpgv4-wt-integ-sl` on the same grok-build login; no socket collision (per-run sockets), but see the confound note below. Per-turn structural table: `.coc/playtests/sl29a-b4/triage.txt` (from `29-book-a-b4/triage.py`).

**Table (Scope 3).**

| class | pre-registered line | measured | verdict |
| --- | --- | --- | --- |
| delivery | 20/20 with prose | 20/20 settled, 0 stranded, every turn delivered Keeper prose (no bare host reading-wait notice anywhere in the table) | **pass — SL-29A's original delivery failure (4 turns, notice only) is fixed (SL-37)** |
| wall | median ≤ 45 s, ≥ 80% ≤ 60 s | median 32.4 s, 16/20 ≤ 60 s (80%), max 240.1 s. Three over 60 s (t17 147.0, t18 240.1, t20 148.9), all one cause (below); without them median 30.2 s, max 63 s (t1). | fail, one new cause (not SL-34's map wait: no turn walled on the town's own map) |
| routing | a declared move to a graph destination lands; new destinations either read or narrate honestly | `apply:move:welcome-to-abattoir` (the graph's own destination, the one SL-34 targets) landed clean on **first declaration, t4** (48.2 s), and again t6 (16.3 s) and t12 (26.3 s) — **no `move:refused` tied to the town's map anywhere in this table**, versus SL-29A's 9 refused moves and 156–212 s waits on the identical declarations. Four **newly discovered** sub-locations (esso-station, mather-general-store, last-chance-bar, church-lane) were compile-selected on t7, t8, t9, t14, t17, t20 and **refused every time**; none was ever entered in 20 turns. | **town arrival fixed (SL-34)**; sub-location arrival still fails (new finding, below) |
| admission | no row > 12 s; clerk on compile | admission max 7.8 s (t9), no `review_timeout`, 12 `authorized` / 7 `entailed` / 1 `not_authorized` / 1 `not_player_action` | pass |
| binding | `infer(bind)` = 0 | 0 | pass |
| looks | ≤ 1/turn after first visit | 6 `lookup kind=source` total across the table (source-answer consultations, SL-36's path), 0 `lookup kind=module` | pass |
| prescreen | status per read | `prepared` every read, 2→6 candidates as the graph grew, 1.1–4.3 s, no fallback | pass |
| drops | every drop has a reason | `text_beside_tool_calls` 10, `floor_steer` 0; all with rows, no stranded turn | pass |
| fiction/rules | prologue rule holds; checks rolled on a held skill; NPC speech in tokens | Ordinary checks: t3 Navigate 36, t5 **Spot Hidden** 79 (SL-29A's identical bridge-inspection sentence had rolled **Engineering**, off the sheet), t6 Spot Hidden 13, t10 **Psychology** 52 (fits "read his eyes and hands for a lie" exactly), t12 **Drive Auto** 49 (雷·卡特's own stated strength), t16 Spot Hidden 95 — **no off-sheet skill rolled anywhere in this table**. Speech tally 1 resolved / 4 unresolved (the Keeper attempting NPC dialogue in scenes whose text material never arrived; same root cause as the routing/wall findings). | **SL-40's skill default confirmed fixed**; speech a minor downstream symptom |
| stalls | none; provider errors listed | 0 provider `error` rows at the table lane; reading lane carried several `provider_refused` rows (below, not a stall — each resolved to a retry or a settled failure) | pass |
| reading (PDF) | every read has a telemetry row and an outcome; no turn holds past the answer allowance; a reading wait still delivers fiction | every read/answer job has purpose/focus/ms/outcome rows; **no turn was held on a source answer past SL-36's 8 s allowance** (the turn's own draft always delivered); but the "answer" jobs themselves ran 293–400 s each in the background and this is the direct cause of the wall finding below | SL-36's per-turn allowance holds; a scope gap behind it does not (new finding) |

**Findings, one root cause each**

- **P1 wall, new — a genuinely turn-blocking `detail` read starves for minutes behind non-blocking `answer` reads sharing the same concurrency slot.** t17 (147.0 s), t18 (240.1 s) and t20 (148.9 s) are one continuous story: the town's move into `last-chance-bar` needs its own text material (`read-6`/`read-12`/`read-13`, `purpose: detail`, §22.4's unchanged text gate). By the time it queues, the reading service's foreground pool (`capacity: 3`) is already held by two `purpose: answer` jobs that SL-36 intends to become background, non-turn-blocking work past their 8 s allowance but that keep `foreground: true` and their slot for as long as they run: `read-8`/`read-9` (esso-station, 399.8 s and more, ending `source_context_changed`) and `read-10` (阿巴托尔 警长 镇长…, 293.0 s, same outcome), plus a background prefetch `detail` job for `church-lane` — a scene the player never declared or asked about. `read-6`'s own telemetry row records `queue_wait_ms: 379415` before it gets a slot. SL-36 bounds when the *turn* stops waiting on an answer; it does not bound how long the *job* keeps a concurrency slot, so a slow answer read starves a genuinely blocking detail read for minutes. Evidence: `.coc/playtests/sl29a-b4/home/.coc/module-campaigns/sl29ab4-xuese-2401/modules/book-1/deepen-queue.json` (read-4/5/6/7/8/9/10/12/13), run evidence `events.jsonl` turn 17–18 reading-lane rows.
- **P1 wall, new — SL-35's fixed-lease fix does not cover in-play reading.** Once `last-chance-bar`'s detail read gets a slot it fails three consecutive rounds with SL-35's exact signature — `provider_refused`, `reason: budget_input_tokens`, `code: task_budget_exhausted`, `ceiling: 1000000` — at 139.4 s (t17/t18 boundary), 100.8 s and 103.7 s. SL-35's scope (§20/§98 import addenda) only gave the onboarding worker's three import actions (`inspect`/`guidance`/`opening`) an explicit stage-sized `providerBudget`; the kernel's in-play `ReadingService` (`detail`/`answer` jobs dispatched by `apply`/`lookup` during table play) still falls through to `runtime/tasks.ts:286`'s un-sized default `independentProviderBudget` (1,000,000 input / 65,536 output / $10 / 16 actions per reader child) — the same lease SL-35 diagnosed, just for a caller SL-35's fix never reached. A parallel `budget_output_tokens` refusal on a different job (`church-lane`'s review round, three `review_transport_retry` at 2 s/6 s/18 s backoff) shows the same gap on the output side. Evidence: same `deepen-queue.json` job rows; `events.jsonl` `provider_refused` entries for `read-6`/`read-12`/`read-4`.
- **P2 routing, new (downstream of the two findings above) — no sub-location discovered inside the town is ever entered in a 20-turn table.** The compile correctly selected `apply:move:esso-station` (t7, t8, t9), `apply:move:mather-general-store` (t14) and `apply:move:last-chance-bar` (t17, t20), and each was correctly refused while its own text material was pending (this half is by design, unaffected by SL-34, and not a bug by itself) — but because that material never wins the starved, lease-exhausted reading pipeline within the table's pace, not one of the four newly discovered destinations is ever entered. `mather-general-store`'s detail read (`read-7`) did complete successfully, but only after t14 had already moved on; the table's one-sentence-per-turn pace never returned to it. Contrast with `welcome-to-abattoir`, whose text was already read before t1 (part of the original 4-node graph) and whose map SL-34 now delivers in the background: SL-34's "the move lands, the material arrives later" pattern has not been extended to a scene's own text material or to the read-scheduling capacity behind it, so any destination discovered *during* play is functionally unreachable once its read joins this queue. Evidence: same `deepen-queue.json`; per-turn admission/routes columns in `.coc/playtests/sl29a-b4/triage.txt`, turns 7–9, 14, 17, 20.
- **P3 fiction/rules, confirmed fixed — SL-40's ordinary-check skill default.** SL-29A's t5 (bridge inspection) rolled Engineering, absent from 雷·卡特's sheet. This table's structurally identical or comparable declarations rolled Spot Hidden (t5, t6, t16), Psychology (t10, exactly fitting "read his eyes and hands for a lie") and Drive Auto (t12, the investigator's own stated strength) — no off-sheet skill anywhere. Evidence: `turn-5.json`, `turn-10.json`, `turn-12.json` in the run's evidence dir vs SL-29A's `triage.txt` line 5 (`roll, Engineering, 15`).
- **P0 delivery/P1 wall, confirmed fixed — SL-34's map gate and SL-37's draft-kept delivery.** `welcome-to-abattoir` landed on first declaration with no `material_pending`, no `move:refused` tied to a map, and no turn over 60 s traceable to the town's own map (contrast SL-29A's 9 refused moves, 5 turns at 156–212 s, and 4 turns delivering nothing but a host notice). Not scored as a new finding; recorded to close the loop on SL-34/37's manual-check ask.
- **Not exercised this table**: SL-38 (guard unlocked by the same batch) and SL-42 (bookkeeping of a scene just left) need a two-clause declaration crossing an obligation-gated guard or a same-turn clue-then-departure, which 血色公路's 20-line script never poses (its only gate is the town's arrival, which SL-34 covers). SL-40's guarded-entrance narration (as opposed to its skill default, confirmed above) is likewise not exercised: no guard in this script is ever unmet-but-existing.
- **Confound noted, not scored as a finding.** A second live table (long gate #4) ran on the same grok-build login throughout this run. The reading jobs' `used`/`ceiling` accounting (e.g. `read-6` round 1: 505,061 of 1,000,000 input tokens used yet still refused) suggests tokens **held** by concurrent in-flight calls, not only `used` tokens, pushed the lease over its ceiling; whether that held share came from this table's own concurrent jobs (`church-lane`, `mather-general-store`, the answer jobs) alone, or was worsened by the other live table sharing the same account, cannot be told apart from the evidence collected here. The fixed-lease-sizing root cause (finding 2) does not depend on this confound: SL-35's own base evidence showed the identical signature from a single table's own import reads.
- **Not a finding, an open item**: `read-13` (`last-chance-bar` detail, third attempt) was left `state: running` in `deepen-queue.json` when the table was stopped (I stopped the daemon deliberately after turn 20). SL-34's orphan recovery (`recoverOrphans`) runs on the next `module.read.ahead`/campaign open, which has not happened yet on this campaign; this is expected under §107.1's own design, not evidence against it, but a follow-up table on `sl29ab4-xuese-2401` should confirm the job is reclaimed rather than joined as still-live.

Evidence (git-ignored, kept):
- import (reused, not re-run): `/Users/haoli/leehow/code/chatrpgv4-wt-pdf-a/.coc/playtests/sl29-a-run2/home/.coc/modules/book-1/` (source of the copy)
- setup: `/Users/haoli/leehow/code/chatrpgv4-wt-sl29a-b4/.coc/playtests/sl29ab4-xuese-2401-setup-20260924T171243Z/`
- table: playtest `/Users/haoli/leehow/code/chatrpgv4-wt-sl29a-b4/.coc/playtests/sl29ab4-xuese-2401-20260924T171528Z/` (turn-{1..20}.json, events.jsonl, driver.log); campaign `/Users/haoli/leehow/code/chatrpgv4-wt-sl29a-b4/.coc/playtests/sl29a-b4/home/.coc/campaigns/sl29ab4-xuese-2401/` (turns/0000–0020.json, telemetry.jsonl, campaign.json)
- reading: fork `/Users/haoli/leehow/code/chatrpgv4-wt-sl29a-b4/.coc/playtests/sl29a-b4/home/.coc/module-campaigns/sl29ab4-xuese-2401/modules/book-1/deepen-queue.json` (read-1..13, states and full `provider_refused`/`queue_wait_ms` rows)
- triage: `/Users/haoli/leehow/code/chatrpgv4-wt-sl29a-b4/.coc/playtests/sl29a-b4/triage.txt`
- harness (this branch only, originals under `29-book-a/` untouched): `docs/specs/pi-native-single-loop-tickets/29-book-a-b4/{worker.sh,start.sh,play.py,triage.py,script.md,preregistration.md}`
- per-turn prose (not committed, carries book-derived text): `/Users/haoli/leehow/code/chatrpgv4-wt-sl29a-b4/.coc/playtests/sl29a-b4/play.py.stdout.log`

### 2026-09-25 — book A (血色公路) SL-29A batch-5 on `de31a09b2` (integration `claude/integ-single-loop-20260923`, SL-41/43/44/45/47 merged on top of batch 4): the wall/routing defect pair is fixed — two sub-locations discovered in play are entered this table (zero in batch 4) — one new reading-pipeline defect and one carried-text/graph race found

New worktree `/Users/haoli/leehow/code/chatrpgv4-wt-sl29a-b5` (branch `claude/sl29a-b5-20260924`) at `de31a09b2`, node_modules
symlinked from `chatrpgv4-wt-pi-coc-v2`, `npm run build:runtime` done, `.pi/coc-agent` copied from
`chatrpgv4-wt-integ-sl/.pi/coc-agent`. The imported home was reused, not re-imported:
`chatrpgv4-wt-pdf-a/.coc/playtests/sl29-a-run2/home` (module `book-1`, generation 2, the same graph batch-4 tested) was
copied into this worktree's `.coc/playtests/sl29a-b5/home` (stale `.lock` files from the copy removed under
`.coc/modules/book-1` before use) and loaded cleanly. A NEW campaign, `sl29ab5-xuese-5001`, was created via the
onboarding worker's `converse` action; harness adapted from `29-book-a-b4/` as `29-book-a-b5/{worker.sh,start.sh,play.py,
triage.py,script.md}` (script unmodified), with `29-book-a-b5/preregistration.md` written and committed
(`5a8ee687f`) before the table opened. Investigator 雷·卡特 (Private Investigator, Drive Auto 55, same identity as
batch-4's) was made in a live setup session replaying batch-4's own recorded exchange turn-for-turn (5 turns, 101.7s, 9
tool calls, run `sl29ab5-xuese-5001-setup-20260925T000710Z`). The table was played with `29-book-a-b5/play.py` (one
sentence a turn, structural branches only) on driver run `sl29ab5-xuese-5001-20260925T000928Z`, hybrid-v1,
`PI_COC_JEV_PRESELECT=1`, grok-build/grok-4.7-build-fast low; no second live table shared this Mac this run (no
confound). Per-turn structural table: `.coc/playtests/sl29a-b5/triage.txt` (from `29-book-a-b5/triage.py`). The
campaign fork and reading workspace were kept (not deleted) specifically to satisfy the two captures below, which
batch-4's SL-45/47 replays lost by deleting their forks.

**Table (Scope 3).**

| class | pre-registered line | measured | verdict |
| --- | --- | --- | --- |
| delivery | 20/20 with prose | 20/20 settled, 0 stranded, every turn delivered Keeper prose | **pass** |
| wall | median ≤45s, ≥80% ≤60s | median 31.1s, 17/20 ≤60s (85%), max 71.4s (t1). Two more turns just over 60s (t7 61.6s, t19 64.8s) — **none of the three caused by a reading wait**: `reads` column is empty for all three, they are ordinary multi-tool-call latency. 0 turns waited on a reading job anywhere in the table (0 `reading_timeouts`). | **pass — batch-4's 147/240/149s reading-wait turns are gone** |
| routing | a declared move to a graph destination lands; new destinations either read or narrate honestly | `apply:move:welcome-to-abattoir` landed clean t4 (38.4s). Two **newly discovered sub-locations were both entered**: `apply:move:esso-station` t7 (61.6s) and `apply:move:last-stop` t17 (50.5s) — both landed on the book's own index text on first declaration (`material:"missing"`, `scene_text` carried, no `material_pending`/refused). Two more (`church-steeple-lane`, `mather-general-store`) were compile-selected as candidates from t3 onward and had their detail reads complete in the background, but the Keeper never issued a `move` effect toward them in this script (a routing/creative choice, not a refusal — see finding 4). | **fixed for the two destinations actually declared — batch-4 entered zero of four in 20 turns; this table entered two of four** |
| admission | no row >12s; clerk on compile | admission max 7.7s, 0 `review_timeout`, verdicts `authorized` 11 / `not_player_action` 3 / `entailed` 3 | pass |
| binding | `infer(bind)` = 0 | 0 | pass |
| looks | ≤1/turn after first visit | 12 `look`/`lookup kind=module` calls total, 3 `lookup kind=source` (counted separately) | pass |
| prescreen | status per read; own allowance | `prepared` every read, 2→9 candidates as the graph grew, `allowance_ms: 12000` on every read (confirmed in `events.jsonl`), no fallback anywhere | **pass — SL-44 confirmed: no `source_revision` fallback, no shrunk allowance** |
| drops | every drop has a reason | `text_beside_tool_calls`, `floor_steer`, `speech_steer` with rows; no stranded turn | pass |
| fiction/rules | no off-sheet skill; people from the book | Ordinary checks: t5 Spot Hidden 58, t6 Spot Hidden 68, t10 Psychology 19, t12 Drive Auto 12, t16 Spot Hidden 71 — all on 雷·卡特's own sheet, none off-sheet (SL-40's fix still holds). Speech tally 1 resolved / 6 unresolved (same pattern as batch-4: NPC dialogue attempted where the full scene record has not landed yet). | **SL-40 confirmed still fixed**; speech unresolved rate unchanged |
| stalls | none; provider errors listed | 0 provider `error` rows anywhere | pass |
| reading (PDF) | every read has a telemetry row and outcome; no turn holds past a reading | every read/answer job has purpose/focus/ms/outcome rows; **zero `budget_input_tokens` refusals anywhere in the table** (contrast batch-4's `read-6`/`read-12` signature) | **SL-41 confirmed: the fixed-lease bug is gone from in-play reads** |
| SL-45 (blocking reads go first) | a blocking detail read claims a slot at once or displaces the youngest background read; no blocking read starved for its whole run | `read-5` (esso-station) claimed with `slot_wait_ms: 580`; `read-6` (last-stop) claimed with 2/3 slots active (a free slot existed, so no displacement was needed — this table's queue depth, like batch-4's, never truly contends all 3 slots, so the displacement path itself remains proven only by the unit tests, not by a live turn) | **pass — no blocking read ever starved; the starvation defect (batch-4's P1) does not reproduce** |
| SL-47 (move into unread scene lands on index text) | a move into an unread sub-location lands on index text with a `pending` row; detail read continues in background; record carried later | Both `esso-station` (t7) and `last-stop` (t17) landed instantly with `scene_text` carried and a `pending` row naming the scene on every subsequent turn (`t18`, `t19`, `t20` all correctly show `pending: {focus: "last-stop", since_turn: 17, purpose: "detail"}`). `esso-station`'s record landed in the background 263.1s after its read claimed a slot and was carried into t16's context (`material` flipped from `"missing"` to `"ready"`, full reviewed summary). `last-stop`'s record never landed (see finding 2 below); the table ended (t20) before a next turn could show its `scene_record: {status: "unavailable"}`. | **fixed for the landing mechanism itself; the pages-cited defect it inherits from the index is not fixed (finding 1)** |
| SL-43 (one check per act) | at most one `resolve` per declared act | not exercised — this script never poses an obligation-vs-ordinary conflict on the same act (same as batch-4's own note) | not exercised |
| SL-38 / SL-42 / SL-40's guard-narration path | — | not exercised — this script's only gate is the town's own arrival | not exercised (same as batch-4) |

**Capture A — every detail read raised this table, publication outcome, and the kernel's refusal text verbatim** (from
the kept fork's `deepen-queue.json` and `work/<job>/attempt-1/findings.json`; nothing deleted after the table):

| job | scene | published? | detail |
| --- | --- | --- | --- |
| `read-2` | welcome-to-abattoir | yes, `completed` (generation 3) | — |
| `read-4` | church-steeple-lane | yes, `completed` (generation 4), background, never entered | — |
| `read-5` | esso-station | yes, `completed` (generation 5), promoted to blocking at t7's move (slot wait 580ms), record landed 263.1s later, carried at t16 | — |
| `read-6` | **last-stop** | **no — `failed` after two full rounds** (round 1: 87,873ms, 4 image reads, pages `[26,28,27,29]`; round 2: 89,242ms, 4 image reads, pages `[25,26,27,28,29,30]` — the reader *did* reach the bar's own pages both rounds) | `findings.json`/`deepen-queue.json`, verbatim: `"invalid_params: visual review did not support ['/nodes/4']: 节点把 delivery_kind 定为 skill_check。原文先写守密人可以自行决定端给PC的是否是这种肉，再写"或者"PC可以进行一个幸运检定，并没有把获知固定为必须投骰的技能检定。\nretryable: false\nnext: change_input\nfix: correct the draft using the original pages and submit again"`, structured `refusal: {message: "visual review did not support ['/nodes/4']: ...", path: "/", reason: "reading_failed"}` |
| `read-7` | mather-general-store | yes, `completed` (generation 6), background, never entered by a declared move | — |

**Capture B — every scene entered via SL-47's index-text landing, the pages the index cited, and whether they are the
scene's own pages** (verified against `source.pdf` directly with `pdftotext`):

| scene | turn entered | pages cited by the landing | scene's own section in the book | verdict |
| --- | --- | --- | --- | --- |
| esso-station | t7 | `[17, 18, 19]` | "1. 埃索加油站" (description + NPC list) begins on page 19, immediately after the town-arrival paragraph that starts on page 17 | **correct** — the cited span reaches the scene's own text |
| last-stop | t17 | `[17]` only | "3D. 最后一站食宿酒吧" (description + NPC list: 罗伯特·泰勒, 卡洛斯·加尔萨) is on pages **28–30** | **wrong — reproduces the exact defect SL-47's own ticket flagged as unresolved**: the node still cites only the town's arrival page, not its own pages, 250 pages away in citation terms though the same book |

**Findings, one root cause each**

- **P1 wall/routing, confirmed fixed — SL-41 (book-sized lease) and SL-45 (blocking reads go first) together remove batch-4's starvation/refusal pair.** Zero `budget_input_tokens` refusals anywhere; both sub-locations declared in play (esso-station, last-stop) claimed a reading slot within a second and landed their moves within normal turn latency (50–62s) instead of batch-4's 147–240s refuse-and-retry cycles. Evidence: table-wide walls above; `deepen-queue.json` read-5/read-6 `foreground`/`claimed_at` timestamps; `events.jsonl` `concurrency` rows.
- **P1 routing, confirmed fixed — SL-47 (index-text landing).** Both moves into unread sub-locations landed on first declaration with the book's own passages carried and a correctly-named `pending` row on every later turn; batch-4 entered zero of four discovered sub-locations in 20 turns, this table entered two of two attempted. Evidence: Capture A/B above; `turn-7.json`/`turn-17.json` tool results; `events.jsonl` `scene_text`/`carried`/`pending` rows.
- **P2 reading, new, not fixed — the index still cites the wrong pages for a sub-location far from the town's arrival text.** `last-stop`'s node cites only page 17 (confirmed against `source.pdf`: its own section is pages 28–30), reproducing exactly the defect SL-47's own ticket recorded as an open item ("the tool should retain the fork's queue next time" — done this table). Not a regression; a persisting root cause the owner may want its own ticket for (index-page attribution for scenes far from the section that names them).
- **P1 reading, new — a content-review false rejection blocks a scene's detail record from ever publishing, independent of any budget.** `last-stop`'s detail read reached its own pages (25–30) in both attempts but was refused at the *review* step (`reading_failed`, not `budget_input_tokens`): the reviewer decided a "mystery meat" detail's `delivery_kind` was `skill_check`, but the book's own wording gives the Keeper discretion or a Luck roll, not a forced skill check (verbatim refusal text captured in Capture A). This is a different pipeline stage than anything SL-41/43/44/45/47 touch; it is the specific defect SL-47's replay lost evidence for and asked a future run to capture. New root cause, needs its own ticket (the node review's fidelity check itself, not the reading capacity/lease/index work batch 5 shipped).
- **P2 admission/graph, new — carried index text can name a real person before the module graph registers them, and an action grounded in that text is refused as if invented.** `esso-station`'s carried pages (17–19) name three NPCs verbatim, including 内特·帕特森; the Keeper tried to place him as present at t7 (before `read-5`'s record had landed) and was refused `unknown_entity: no npc named '内特·帕特森' in the module graph` — a refusal on an action that was not invented (he is real, named on the very pages SL-47 handed the Keeper), only early. Once the record actually landed (t16), the Keeper did not retry placing him (a narrative choice, described him as scenery instead — "谁也没起身"), so no second occurrence surfaced this table, but the race (carried prose names someone the graph does not yet know) is inherent to SL-47's landing design and will recur on any book where the index's carried span names a person. New root cause; likely explains part of the persisting speech-unresolved tally (both batch-4's and this table's).
- **P3 fiction, confirmed fixed — SL-40's ordinary-check skill default (carried from batch-4).** Five ordinary checks this table (Spot Hidden ×3, Psychology, Drive Auto), all on 雷·卡特's own sheet, none off-sheet.
- **Not exercised this table**: SL-43 (no obligation-vs-ordinary conflict in this script), SL-38/SL-42/SL-40's guard-narration path (same gap as batch-4 — this script's only gate is the town's arrival).

Evidence (git-ignored, kept — the fork and reading workspace were deliberately not deleted this batch):
- setup: `/Users/haoli/leehow/code/chatrpgv4-wt-sl29a-b5/.coc/playtests/sl29ab5-xuese-5001-setup-20260925T000710Z/`
- table: playtest `/Users/haoli/leehow/code/chatrpgv4-wt-sl29a-b5/.coc/playtests/sl29ab5-xuese-5001-20260925T000928Z/` (turn-{1..20}.json, events.jsonl, driver.log)
- campaign: `/Users/haoli/leehow/code/chatrpgv4-wt-sl29a-b5/.coc/playtests/sl29a-b5/home/.coc/campaigns/sl29ab5-xuese-5001/` (turns/0000–0020.json, telemetry.jsonl, campaign.json)
- reading fork (kept, not deleted): `/Users/haoli/leehow/code/chatrpgv4-wt-sl29a-b5/.coc/playtests/sl29a-b5/home/.coc/module-campaigns/sl29ab5-xuese-5001/modules/book-1/` (`deepen-queue.json` read-1..7; `work/read-6/attempt-1/findings.json` for the verbatim refusal)
- triage: `/Users/haoli/leehow/code/chatrpgv4-wt-sl29a-b5/.coc/playtests/sl29a-b5/triage.txt`
- harness (this branch only, originals under `29-book-a-b4/` untouched): `docs/specs/pi-native-single-loop-tickets/29-book-a-b5/{worker.sh,start.sh,play.py,triage.py,script.md,preregistration.md}`
- per-turn prose (not committed, carries book-derived text): `/Users/haoli/leehow/code/chatrpgv4-wt-sl29a-b5/.coc/playtests/sl29a-b5/play.py.stdout.log`

### 2026-09-25 — book A (血色公路) SL-29A batch-6 on `787ddf480` (integration `claude/integ-single-loop-20260923`, batch 6 merged on top of batch 5: SL-48, SL-49, SL-51; SL-50 in progress, measured on the Haunting gate, not here): SL-48 confirmed live end to end (including the refused-reading case); SL-49 and SL-51 not exercised this table; one new reading-lease scope gap and one new SL-45-displacement side effect found

Measurement only, no product fixes. New worktree `/Users/haoli/leehow/code/chatrpgv4-wt-sl29a-b6` (branch
`claude/sl29a-b6-20260925`) at `787ddf480`, node_modules symlinked from `chatrpgv4-wt-pi-coc-v2` (six paths per the
marker), `npm run build:runtime` clean, `.pi/coc-agent` copied from `chatrpgv4-wt-integ-sl/.pi/coc-agent` (grok-build
token ~4.4h remaining at copy time). The imported home was reused, not re-imported:
`chatrpgv4-wt-pdf-a/.coc/playtests/sl29-a-run2/home` (module `book-1`, generation 2, the same graph batch-4/5 tested)
was copied into `.coc/playtests/sl29a-b6/home` (stale `.lock` files under `.coc/modules` removed before use) and
loaded cleanly on the batch-6 build. A NEW campaign, `sl29ab6-xuese-6001`, was created via the onboarding worker's
`converse` action (title `血色公路`, correct — no `.pdf` suffix this time, since this path calls `worker.sh` directly
rather than going through the App's upload flow that ticket 29's own P4 finding named); harness adapted from
`29-book-a-b5/` as `29-book-a-b6/{worker.sh,start.sh,play.py,triage.py,script.md}` (script unmodified), with
`29-book-a-b6/preregistration.md` written and committed (`7a6f0cdc9`) before the table opened. Investigator 雷·卡特
(Private Investigator, Drive Auto/Spot Hidden on his sheet, same identity as batch-4/5's) was made in a live setup
session replaying batch-4/5's own recorded exchange turn-for-turn (5 turns, 79.8s, 9 tool calls, run
`sl29ab6-xuese-6001-setup-20260925T014817Z`). The table was played with `29-book-a-b6/play.py` (one sentence a turn,
structural branches only) on driver run `sl29ab6-xuese-6001-20260925T015027Z`, hybrid-v1, `PI_COC_JEV_PRESELECT=1`,
grok-build/grok-4.7-build-fast low; no other worktree's `.coc/playtests` shows activity in this run's window
(01:50–02:03Z), so no known confound. Per-turn structural table: `.coc/playtests/sl29a-b6/triage.txt` (from
`29-book-a-b6/triage.py`). The campaign fork and reading workspace were kept (not deleted), per instruction.

**Table (Scope 3).**

| class | pre-registered line | measured | verdict |
| --- | --- | --- | --- |
| delivery | 20/20 with prose | 20/20 settled, 0 stranded, every turn delivered Keeper prose | **pass** |
| wall | median ≤45s, ≥80% ≤60s | median 34.8s, 20/20 ≤60s (100%), max 58.7s (t13) | **pass — best of the four SL-29A book-A tables so far (batch-5: 85%/71.4s max)** |
| routing | a declared move to a graph destination lands; new destinations either read or narrate honestly | `apply:move:welcome-to-abattoir` landed clean t4 (35.8s) and again t12 (re-affirmed on "main street", no separate node exists for it). Two newly discovered sub-locations entered: `apply:move:esso-station` t7 (44.7s) and `apply:move:mather-general-store` t13 (58.7s) — a **different pair** than batch-5's (esso-station + last-stop); `last-stop` was looked up three times (`lookup kind=module`/`kind=source` at t15, t17, t20) but never entered — the Keeper narrated honestly without inventing a move receipt to it (pre-reg class 3's alternative path, correctly taken). `church-steeple` was a background-only detail read (never a candidate the script's sentences reached). | **pass — routing honesty holds; which two of four sub-locations get entered is Keeper-choice noise across tables, not a defect** |
| admission | no row >12s | admission max 9968ms, 0 `review_timeout`, verdicts `authorized` 10 / `entailed` 4 / `not_player_action` 2 / `not_authorized` 1 | **pass** — the one `not_authorized` (t1) is the clerk correctly refusing a Keeper-proposed early move into the town when the player's actual sentence only continued on the highway; a correctly-working guard, not a defect |
| binding | `infer(bind)` = 0 | 0 | pass |
| looks | ≤1/turn after first visit | 2 `lookup kind=module` calls (t17, t20), 3 `lookup kind=source` counted separately (t15, t17, t20) | pass |
| prescreen | status per read; own allowance | `prepared` every read, 2→7 candidates as the graph grew, no fallback anywhere | pass |
| drops | every drop has a reason | `text_beside_tool_calls`, `floor_steer`, `speech_steer` with rows; no stranded turn | pass |
| fiction/rules | no off-sheet skill | Spot Hidden ×3 (t5:83, t6:22, t16:97), Drive Auto ×1 (t12:8) — all on 雷·卡特's own sheet | **SL-40 confirmed still fixed** |
| stalls | none; provider errors listed | 0 `lane:"provider-call"` error rows; driver log and `pi-stderr.log` both clean, no timeouts | pass at the turn level (see finding 1 for a background-lane exception) |
| reading (PDF) | every read has a telemetry row and outcome; no turn holds past a reading | every read/answer job has purpose/focus/ms/outcome rows; **zero `budget_input_tokens` refusals on any `detail`/`answer` job raised in play** (read-4 esso-station, read-5 last-stop, read-6/7/8/9) | **SL-41 confirmed still fixed for in-play detail/answer reads — but see finding 1: the background `index` job is not covered** |
| SL-45 (blocking reads go first) | claims a free slot at once, or displaces the youngest background read | `read-4` (esso-station, blocking) claimed with `slot_wait_ms: 126` despite a 101.6s queue wait; `read-6` (mather-general-store, blocking) claimed with `slot_wait_ms: 370` despite a 339.3s queue wait; **`read-8` (a blocking `answer` job) displaced `read-7` (a background `answer` job, `ran_ms: 54652`) when all 3 slots were held** | **fixed, and the displacement path fires live for the first time in this ticket's line of tables — batch-4/5 never contended all 3 slots; see finding 2 for what happens to the displaced job** |
| SL-47 (move into unread scene lands on index text) | lands on index text with a `pending` row; record carried later | Both `esso-station` (t7) and `mather-general-store` (t13) landed instantly (`material:"missing"`, `scene_text` carried, `material_ready:false`), no `material_pending`/refused-hard. `esso-station`'s record landed in the background at generation 5 (read-4 completed 02:02:03, ~447s after its slot claim); `mather-general-store`'s landed at generation 4 (read-6 completed 02:00:40, ~126s after slot claim). Neither record was observed carried into a later turn's note this table (the party never returned to either scene after leaving) | **fixed for the landing mechanism** |
| SL-48 (index cites a discovered scene's own pages) | own pages appear on the scene's index row after its detail read settles | See Capture B below — confirmed for all three reads raised this table, **including the refused one** | **confirmed working, strongest evidence yet for this ticket** |
| SL-49 (field-level review dispute publishes contested) | a field-level dispute publishes with a `contested` mark; a root-level one still refuses | The only dispute raised this table (`read-3` church-steeple, a claim's `reason` field, "页上只写...没有写来时的小路接回镇上街道") is a **fact** field, not a declared classification field — correctly still refused per the ruling. No `contested` map entry exists in any generation (2–5) this table | **not exercised (no classification-field dispute occurred); the one dispute seen is consistent with, not contrary to, the ruling** |
| SL-51 (person named in carried text accepted from_passage) | a `person`/`npc` write about a carried-text name is accepted `from_passage` | `esso-station`'s carried page names 拉斯·威廉姆斯/内特·帕特森/史蒂夫·布朗 verbatim (confirmed via `pdftotext`), but the Keeper never issued an `npc`/`person` effect placing any of them present this table (t7's `apply` was `move` only, `present:[]` in the result; t8 took the "nobody present" branch) — a narrative choice, same pattern batch-5 noted after its own record landed. `world.table_people` is empty for every turn of the campaign | **not exercised — the race SL-51 targets was never triggered this table** |

**Capture A — every detail read raised this table, publication outcome, and the kernel's refusal text verbatim**
(from the kept fork's `deepen-queue.json`; nothing deleted after the table):

| job | scene/focus | published? | detail |
| --- | --- | --- | --- |
| `read-1` | (index, full-book) | yes, `completed` (generation 3) after **one round refused mid-attempt** — see finding 1 | — |
| `read-2` | welcome-to-abattoir | yes, `completed` (generation 3), background | — |
| `read-3` | **church-steeple** | **no — `failed`**, one round, 111 pages | `deepen-queue.json`, verbatim: `"invalid_params: visual review found /claims/1/reason unsupported (unsupported): 页上只写"在镇中心附近的缓坡上"，并没有写来时的小路接回镇上街道。\nretryable: false\nnext: change_input\nfix: correct the draft using the original pages and submit again"`; structured `refusal: {message: "...", path: "/claims/1/reason", rule: "review_unsupported", reason: "reading_failed"}` — a **fact**-field dispute (SL-49 classifies it `unsupported`, correctly still a refusal, not a `contested` case |
| `read-4` | **esso-station** | yes, `completed` (generation 5), promoted to blocking at t7's move (`slot_wait_ms: 126`), record landed 447s after claim | — |
| `read-5` | last-stop | still `running` when the table ended and the daemon was stopped (t20); background the whole table (never promoted — no move ever declared toward it); `slot_wait_ms` for its own claim was 548.2s (it only got a slot once the other three foreground jobs finished) | — |
| `read-6` | **mather-general-store** | yes, `completed` (generation 4), promoted to blocking at t13's move (`slot_wait_ms: 370`), record landed 126s after claim | — |
| `read-7` | answer: 阿巴托尔镇上的管事人/治安官/镇长/失踪报案 | **no — `failed` after being displaced** by `read-8` (`ran_ms: 54652` before displacement) | `deepen-queue.json`, verbatim: `"source context changed; request a fresh consultation"` — see finding 2 |
| `read-8` | answer: 阿巴托尔镇上能吃饭的地方 | still `running` when the table ended | — |
| `read-9` | answer: 最后一站 | still `running` when the table ended | — |

**Capture B — every scene with a completed-or-refused-after-reading detail read this table: its graph `source_refs`
before vs. after the read, cross-checked against `source.pdf` directly with `pdftotext`** (all pages 1-based below;
the kernel's own `reading.scene_index`/`source_refs` are 0-based, +1 applied):

| scene | pre-read citation (generation 2/3) | post-read citation | scene's own section (pdftotext) | verdict |
| --- | --- | --- | --- | --- |
| esso-station | page 17 only (arrival) | pages 17, **20** | "1. 埃索加油站" heading + intro is on p.17 (same page as the town's arrival text, two-column layout); pp.18–19 are a map spread with ~1 extractable character each; the NPC list and disposition notes continue on **p.20** | **correct — SL-48 added exactly the page the read-4 draft cited (p.20), the page carrying the section's own content, not the near-empty map pages 18–19** |
| mather-general-store | page 17 only (arrival) | pages 17, **26** | "马瑟综合商店" 's own description is on **p.26** | **correct — SL-48 added exactly p.26** |
| church-steeple | page 17 only (arrival) | pages 17, **33–34** | "小路尽头的教堂" 's own description is on pp.33–34 | **correct, and this is the ticket's own "refused reading still writes the row" case, confirmed live**: `read-3` was refused at publication (Capture A), yet `module.json` `reading.scene_index` still gained `{"scene": "scene-church-steeple", "pages": [[32, 33]], "job_id": "read-3"}` (0-based, i.e. pp.33–34) — the graph node's own `source_refs` (a *published* fact) correctly stayed at page 17 only across generations 3–5, since the reading never published; only the separate, structural `reading.scene_index` row picked up the read's own pages, exactly as §22.4.8 describes |

Note on batch-5's own citation for esso-station (`[17,18,19]`, called "right" there): re-checked against the identical
`source.pdf` (same md5) this run — pages 18–19 are the near-blank map spread, not text. Batch-5 predates SL-48
(pages there were the *pre-SL-48* citation, from the initial index reading only, not updated after a detail read),
so its "right" verdict was about a coincidental overlap with the arrival page's neighbours, not a citation of the
section's own content the way this table's post-read citations are.

**Capture C — `person`/`npc` writes and carried-text registration (SL-51):** none attempted this table (see the
SL-51 table row above). Count: 0 `from_passage` registrations, 0 replacements.

**Findings, one root cause each**

- **P2 reading, new — the background `index` job is not covered by SL-41's book-sized lease; the pre-SL-41 fixed
  1,000,000-token ceiling signature recurs there.** Every `detail`/`answer` job this table (read-2, 3, 4, 5, 6, 7,
  8, 9) got a `stage_budget` telemetry row (`pageCount: 111`, per-page shares computed) before it ran. `read-1`
  (`purpose: "index"`, the fork's own full-book index-completion job, raised automatically when the campaign forked
  — not by a player action) got **no `stage_budget` row at all**, and its first provider round hit exactly SL-41's
  target defect: `provider_refused {reason: "budget_input_tokens", code: "task_budget_exhausted", dimension:
  "inputTokens", ceiling: 1000000, used: 721191, requested: 500000}` after 210s and 24 image reads. The job did not
  fail outright (an internal retry loop inside the reading service opened a fresh round with a fresh default lease,
  which is not the same as the book-sized lease SL-41 describes, and which had to re-read 32 pages essentially from
  scratch, costing another 139s + 108s of index-audit). Batch-5's byte-identical `read-1` job (same key hash, same
  book, same model) completed cleanly in one round with no refusal (87.9s, 16 image reads) — this is not book-A's
  index job being flaky in general, it is new to this run, and the missing `stage_budget` row shows the sizing
  logic simply isn't wired for `purpose: "index"` the way it is for `detail`/`answer`/`map`. Cost only (no turn
  walled on it — the job runs in the background), but it reproduces the letter of SL-41's own target signature in a
  reading path the ticket's own success line did not name ("any in-play read of this book"; the fork's own index
  completion is arguably not "in play", but it is a real, live reading path that still eats the old defect). Needs
  its own ticket or an amendment to SL-41's scope. Evidence: `telemetry.jsonl` rows at `2026-09-25T01:50:29.258Z`
  (read-2's `stage_budget`, for contrast) and `01:53:59.481–487Z` (read-1's `provider_refused`); batch-5's
  `telemetry.jsonl` `job_id:"read-1"` rows for the counter-example.
- **P2 reading, new — SL-45's displacement path fires live for the first time, and the displaced job's retry fails
  outright instead of resuming.** `read-8` (a blocking `answer` job) displaced `read-7` (a background `answer` job)
  after `read-7` had run 54.652s, at `2026-09-25T02:00:17.465Z` (`event: "displaced", for_job: "read-8", ran_ms:
  54652`) — this is the mechanism SL-45 was built for, and batch-4/5's tables never contended all 3 reading slots
  enough to trigger it (their own Comments say so explicitly). The mechanism itself worked exactly as specified: no
  blocking read (read-8) waited behind it. But `read-7`'s own next attempt then failed with `"source context
  changed; request a fresh consultation"` rather than resuming from where it was displaced — the graph had moved to
  a new generation (mather-general-store's record landed, generation 4) while `read-7` was queued, and the answer
  job's retry path treats that as a hard failure rather than re-scoping to the new context. Net effect: the
  Keeper's question about the town's sheriff/mayor/missing-persons report (t15's `lookup kind=source`) never got an
  answer this table — not because of a budget or review defect, but because a legitimate SL-45 displacement
  collided with a background answer job's staleness check. New root cause, distinct from SL-41/44/45's own scope;
  worth its own ticket (the answer-job retry-after-displacement path, not the displacement mechanism itself, which
  is confirmed working). Evidence: `deepen-queue.json` `read-7`'s `detail` field; `telemetry.jsonl` the `displaced`
  event and the surrounding `concurrency` rows for read-7/read-8.
- **P1 wall/routing, confirmed fixed — SL-41 (in-play leases) and SL-45 (blocking reads go first) together, for
  the fourth table running.** Zero `budget_input_tokens` refusals on any `detail`/`answer` job raised by a player
  action; both sub-locations declared in play claimed a reading slot within 130–370ms of becoming eligible and
  landed their moves within normal turn latency (44.7s, 58.7s). This table also has the best wall numbers of the
  four SL-29A book-A tables (100% of turns ≤60s, median 34.8s, batch-5's own two near-miss turns are gone too).
- **P1 routing, confirmed fixed — SL-47 (index-text landing), fourth table running.** Both moves into unread
  sub-locations landed on first declaration with the book's own passages carried and an honest `material:"missing"`
  receipt, never a hard refusal; the Keeper correctly declined to invent a move into `last-stop` despite looking it
  up three times.
- **P0 SL-48, confirmed working, and for the first time including the ticket's own hardest case (a refused
  reading).** All three detail reads that reached their own pages this table — two completed (esso-station,
  mather-general-store) and one refused-at-publication (church-steeple) — gained their own book pages on
  `reading.scene_index` afterward, cross-checked byte-for-byte against `source.pdf` with `pdftotext` (Capture B).
  The refused case is the exact scenario the SL-48 ticket's own test suite exercises synthetically
  (`scene-own-pages.test.mjs`'s "a refused reading... writes the row") but no prior SL-29A table had lived through:
  a real, live provider refusal on a real book, and the index row still landed correctly while the graph's own
  published `source_refs` correctly did not change (since nothing published). This is the strongest evidence this
  ticket line has produced for SL-48 and closes out the open item batch-5's own SL-48 comments flagged ("the tool
  should retain the fork's queue next time — done this table" was about batch-5; this table additionally captures
  the refused-case row that batch-5's last-stop refusal predated SL-48 entirely and so could not demonstrate).
- **Not exercised this table — SL-49 (no classification-field dispute arose; the one dispute seen was fact-level
  and correctly still refused) and SL-51 (the Keeper never placed a carried-text NPC present before their record
  landed, so the `from_passage` race was never triggered).** Both remain open questions for a future table whose
  Keeper happens to take the other branch; neither is contradicted by this table's evidence.
- **Not exercised this table (same gap as every prior SL-29A book-A table)**: SL-43 (no obligation-vs-ordinary
  conflict), SL-38/SL-42/SL-40's guard-narration path (this script's only gate is the town's own arrival).

Evidence (git-ignored, kept — the fork and reading workspace were deliberately not deleted this batch):
- setup: `/Users/haoli/leehow/code/chatrpgv4-wt-sl29a-b6/.coc/playtests/sl29ab6-xuese-6001-setup-20260925T014817Z/`
- table: playtest `/Users/haoli/leehow/code/chatrpgv4-wt-sl29a-b6/.coc/playtests/sl29ab6-xuese-6001-20260925T015027Z/` (turn-{1..20}.json, driver.log)
- campaign: `/Users/haoli/leehow/code/chatrpgv4-wt-sl29a-b6/.coc/playtests/sl29a-b6/home/.coc/campaigns/sl29ab6-xuese-6001/` (turns/0000–0020.json, telemetry.jsonl, campaign.json)
- reading fork (kept, not deleted): `/Users/haoli/leehow/code/chatrpgv4-wt-sl29a-b6/.coc/playtests/sl29a-b6/home/.coc/module-campaigns/sl29ab6-xuese-6001/modules/book-1/` (`deepen-queue.json` read-1..9; `module.json` `reading.scene_index`; `generations/generation-{2..5}/module-graph.json` for the `source_refs` diff in Capture B)
- triage: `/Users/haoli/leehow/code/chatrpgv4-wt-sl29a-b6/.coc/playtests/sl29a-b6/triage.txt`
- harness (this branch only, originals under `29-book-a-b5/` untouched): `docs/specs/pi-native-single-loop-tickets/29-book-a-b6/{worker.sh,start.sh,play.py,triage.py,script.md,preregistration.md}`
- per-turn prose (not committed, carries book-derived text): `/Users/haoli/leehow/code/chatrpgv4-wt-sl29a-b6/.coc/playtests/sl29a-b6/turns.log`

### 2026-09-25 — book A (血色公路) SL-29A batch-7 on `716d48649` (integration `claude/integ-single-loop-20260923`, batch 7 merged on top of batch 6: SL-53, SL-54, SL-55, SL-52 through stage 3, SL-50 stage 2): SL-53 confirmed fixed for every job raised, including the index job batch-6 flagged; SL-54/SL-55 not exercised (no slot contention, no mid-flight publication); one new P1/P2 finding — a `resolve` targeting an NPC blocks the whole turn for a full `reading_timeout` cycle with no SL-47-style partial-landing equivalent, and it repeats because the underlying detail read never completes

Measurement only, no product fixes. New worktree `/Users/haoli/leehow/code/chatrpgv4-wt-sl29a-b7` (branch
`claude/sl29a-b7-20260925`) at `716d48649`, node_modules symlinked from `chatrpgv4-wt-pi-coc-v2` (six paths per the
marker), `npm run build:runtime` clean, `.pi/coc-agent` copied from `chatrpgv4-wt-integ-sl/.pi/coc-agent`
(grok-build token 82.6 min remaining at copy time, above the 60-minute floor, so no substitution was needed). The
imported home was reused, not re-imported: `chatrpgv4-wt-pdf-a/.coc/playtests/sl29-a-run2/home` (module `book-1`,
generation 2, the same graph batches 4/5/6 tested) was copied into `.coc/playtests/sl29a-b7/home` (stale `.lock`
files under `.coc/modules` removed before use) and loaded cleanly on the batch-7 build. A NEW campaign,
`sl29ab7-xuese-0445`, was created via the onboarding worker's `converse` action (title `血色公路`, no `.pdf` suffix);
harness adapted from `29-book-a-b6/` as `29-book-a-b7/{worker.sh,start.sh,play.py,triage.py,script.md}` (script
unmodified), with `29-book-a-b7/preregistration.md` written and committed (`2f7b872af`) before the table opened.
Investigator 雷·卡特 (Private Investigator, Drive Auto/Spot Hidden on his sheet, same identity as batches 4/5/6's)
was made in a live setup session replaying the recorded exchange turn-for-turn (5 turns, 92.9 s, 9 tool calls, run
`sl29ab7-xuese-0445-setup-20260925T044620Z`). The table was played with `29-book-a-b7/play.py` (one sentence a turn,
structural branches only) on driver run `sl29ab7-xuese-0445-20260925T044840Z`, hybrid-v1, `PI_COC_JEV_PRESELECT=1`,
grok-build/grok-4.7-build-fast low. **Confound noted, not scored as a finding**: long gate #7 (campaign
`longgate7-haunting-0042`, worktree `chatrpgv4-wt-integ-sl`) was running concurrently on this Mac's grok-build login
throughout this table (confirmed by `ps aux` before the table opened; its daemon was never touched). Per-turn
structural table: `.coc/playtests/sl29a-b7/triage.txt` (from `29-book-a-b7/triage.py`). The campaign fork and
reading workspace were kept (not deleted), continuing batches 5/6's procedural change.

**Table-wide.** 20/20 turns settled, 0 stranded, 0 provider errors, `infer(bind)` = 0, admission max 11.3 s (0
`review_timeout`), 7 `look`/`lookup` calls total (6 of them `kind: source`, counted separately), speech 9
resolved / 3 unresolved, 0 sanity rolls (none of this script's sentences reach a sanity-triggering scene). Walls
`[47, 31, 45, 23, 21, 42, 35, 31, 30, 172, 177, 55, 32, 26, 40, 34, 25, 29, 38, 30]`; median 33.2 s, 18/20 ≤ 60 s
(90%), max 176.6 s (t11). Both turns over 60 s (t10 172.2 s, t11 176.7 s) share one cause (finding 3 below); without
them, median 31.5 s, max 55.3 s (t12) — the best "without the one cause" wall numbers this ticket's book-A line has
produced.

**Table (Scope 3), keyed to what batch 7 changed.**

| class | pre-registered line | measured | verdict |
| --- | --- | --- | --- |
| delivery | 20/20 with prose | 20/20 settled, 0 stranded, every turn delivered real Keeper prose (including t10/t11, whose drafts were kept across the reading wait — see finding 3) | **pass** |
| wall | median ≤45s, ≥80% ≤60s | median 33.2s, 18/20 ≤60s (90%), max 176.6s; both over-60s turns share one new cause (finding 3) | **pass on the line's own numbers; one new wall cause found (not any of SL-53/54/55's own targets)** |
| routing | declared move lands or narrates honestly | The Keeper moved the party from `prologue` straight to `welcome-to-abattoir` on **turn 1** (one `apply` covering the fork, the dirt road and the bridge in the same response — the graph has no separate nodes for those beats, so this is a legitimate single move, not an invented receipt), then **never left `welcome-to-abattoir` for the rest of the table**: no `esso-station`/`mather-general-store`/`last-stop`/`church-steeple` node was ever entered by a declared move (contrast batch-5's 2/4, batch-6's 2/4, batch-4's 0/4) | **not a defect — Keeper-choice/pacing noise, as batch-6 already characterized this axis; zero sub-locations entered this table because the Keeper treated the gas station and its attendant as part of the arrival scene, not a separate node** |
| admission | no row >12s | admission max 11.3s (t11), 0 `review_timeout` | pass |
| binding | `infer(bind)` = 0 | 0 | pass |
| looks | ≤1/turn after first visit | 1 `lookup kind=module` total across the table, 6 `lookup kind=source` counted separately | pass |
| prescreen | status per read; own allowance | `prepared` every read, 2→3 candidates as the graph grew, no fallback anywhere | pass |
| drops | every drop has a reason | `text_beside_tool_calls` 10, `floor_steer` 6, `speech_steer` 8 (a turn can carry more than one); all with rows, no stranded turn | pass |
| fiction/rules | no off-sheet skill | Spot Hidden ×3 (t5:55, t6:67, t16:2), Drive Auto ×1 (t12:27), Listen ×1 (t17:6) — all base/occupational skills on 雷·卡特's own sheet, none off-sheet | **SL-40 confirmed still fixed** |
| stalls | none; provider errors listed | 0 provider `error` rows anywhere (driver log and `pi-stderr.log` both clean) | pass |
| reading (PDF) | every read has a telemetry row and outcome | every one of this table's 7 reads (`read-1`..`read-7`) has purpose/focus/ms/outcome rows; **zero `budget_input_tokens`/`provider_refused` events anywhere in the table** | pass |
| SL-53 (index/skeleton job under the book-sized lease) | a `stage_budget` telemetry row before the job runs; no fixed-lease refusal | **`read-1` (`purpose: "index"`, this table's fork-completion job, the exact job type batch-6 found uncovered) got a `stage_budget` row** (`pageCount: 111`, logged 04:48:42.083Z, before it ran) and **completed cleanly in one round, 281s, zero refusals**. All 7 jobs raised this table (index, detail, answer) got a `stage_budget` row — 7/7, none missing. | **confirmed fixed — the exact gap batch-6 filed (P2: "the background `index` job is not covered... pre-SL-41 fixed 1,000,000-token ceiling signature recurs there") does not reproduce** |
| SL-54 (a displaced read resumes) | `displaced`/`resumed` rows; no `source_context_changed` failure on a resumed job | **Not exercised.** This table never contended all 3 reading slots (at most 2 concurrent: `read-1` background + `read-2` foreground at the start; every later job ran alone in the background). Zero `displaced` events, zero `resumed` events anywhere in `reading-telemetry.jsonl`. | not exercised — the mechanism batch-6 found live for the first time did not fire here, for lack of slot contention, not for lack of the fix |
| SL-55 (a running answer survives a generation move) | `finished_under`/`requeued` rows; no bare `source_context_changed` at finish | **Not exercised.** The module's fork never advanced past `generation: 2` for the whole table: `read-2` (the town's own detail read) failed at review (finding 2) and was never retried, and the five `answer` jobs never publish to the graph. With no publication ever landing mid-table, no running job could race one. Zero `finished_under`, zero `requeued` rows. | not exercised — no generation ever moved during this table |
| SL-52 (ask fan-out / accept-obligation yields) | `ask_cleared`/`settled_clue`/obligation-yield rows if triggered | **Not exercised, as pre-registered.** Zero `ask_cleared`, `settled_clue`, `obligation_check`, `guard_unlock` or `ask_clue` rows anywhere in the campaign's `telemetry.jsonl`: 血色公路's 4-node starting graph carries no obligation/accept node for this script to trigger (unlike the Haunting fixture SL-52 was built against) | not exercised, exactly as pre-registered |
| SL-50 stage 2 (writes-are-silent; note head once per run) | own counts, not a pass/fail gate against Haunting-calibrated numbers | 52 model steps total (49 across turns 1-20, 3 on the opening), 10 `text_beside_tool_calls` drops, 9 of 20 played turns needed ≥3 model steps. Against the ticket's own long-gate-#7 target lines (drops ≤7, steps ≤52, turns≥3 ≤8 — calibrated to the Haunting's longer script): steps within range, drops and turns≥3 both slightly over. | reported for comparison only, as pre-registered; inconclusive on a different, shorter script |
| SL-48 (index cites a read's own pages, even when refused) | own pages land on the index row after the read, published or not | `read-2` (welcome-to-abattoir's own detail read) **failed at review** (finding 2) yet `module.json` `reading.scene_index` still gained the read's own pages (`[[16,16],[75,75]]`, 0-based → pages 17 and 76) under `job_id: "read-2"` — the graph's own published `source_refs` correctly did not change (nothing published) | **confirmed again — third table running to show "a refused reading still writes the row" live, now on a different node (welcome-to-abattoir) and a different dispute shape (a `summary` field, not `delivery_kind`)** |
| SL-49 (field-level dispute publishes `contested`) | a classification-field dispute publishes `contested`; a fact/root dispute still refuses | `read-2`'s dispute (`/nodes/0/summary`, "the summary claims one man + several others; the station text says three men") and `read-6`'s dispute (`/status`, "unclear" on a book-wide negative) are both **fact-level**, not classification fields — correctly still hard refusals under the ruling | not exercised (no classification-field dispute arose) — consistent with, not contrary to, the ruling |
| SL-51 (a carried-text name accepted `from_passage`) | a `person`/`npc` write naming carried text is accepted `from_passage` | The NPC placed at t10 (`最靠边的那个男人`, "the man sitting at the far end") is the Keeper's own paraphrase of the carried answer text, not a name the book states verbatim — SL-51's race (a *named* person from carried text, refused `unknown_entity` before the record lands) was never posed this table | not exercised — this table's only NPC has no book-given name to test the race against |

**Findings, one root cause each**

- **P0 SL-53, confirmed fixed.** Every reading job raised this table — including `purpose: "index"`, the exact job
  type batch-6's own evidence showed running with no `stage_budget` row and hitting the pre-SL-41 fixed
  1,000,000-input-token ceiling — now gets a `stage_budget` row before it runs and completed with zero refusals.
  This closes batch-6's P2 finding outright. Evidence: `.coc/playtests/sl29a-b7/home/.coc/reading-telemetry.jsonl`
  (`event:"stage_budget"` rows for `read-1`..`read-7`, all with `pageCount: 111`); `deepen-queue.json` `read-1`
  (`state: "completed"`, `attempts: 1`, no `detail`/`refusal` field).
- **P2 reading, carried (not new) — a scene's own detail read can fail at review and is never retried while the
  party stays in that scene, so the whole rest of the table runs on SL-47's index-only text for it.**
  `welcome-to-abattoir`'s own `detail` read (`read-2`) failed at review 4 minutes into the table (a `summary` field
  the reviewer judged unsupported by the yellow-box sentence) and stayed `failed`, `attempts: 1`, for the remaining
  ~16 minutes and 19 turns the party spent in that scene. SL-47's landing mechanism means this cost no turn a wall
  (the Keeper narrated correctly from the index's carried pages the whole time, per the routing row above), but it
  means the scene's richer reviewed record (its exits, full NPC roster, clues) never arrived this table at all —
  not "later," as batches 5/6 both observed for their own sub-locations, but never. This is the same underlying gap
  those batches' own "P1 reading, new" findings named (a content-review false rejection or a lease/scheduling issue
  blocks a scene's detail record from ever publishing); batch 7 reproduces it on a different node with a different
  review objection and confirms it has no session-level retry. Evidence:
  `.coc/module-campaigns/sl29ab7-xuese-0445/modules/book-1/deepen-queue.json` `read-2` (verbatim refusal above);
  `module.json` (still generation 2 at table end).
- **P1 wall, new — a `resolve` whose target is an NPC still being read blocks the whole turn for a full
  `reading_timeout` cycle (~120-131s), with no SL-47-style partial-landing equivalent for NPC material, and it
  repeats because the underlying read never finishes.** At t10 the Keeper placed an NPC (`最靠边的那个男人`, "the man
  at the far end," paraphrased from the carried answer text, not book-named) present and raised its own `detail`
  read (`read-5`, focus `最靠边的那个男人`). The t10 `resolve` call (a first-impression check on that NPC) blocked for
  124,553 ms before returning `{code:"needs", reason:"reading_timeout", job_id:"read-5"}` — the turn still delivered
  real prose (SL-37's draft-kept behavior held: `delivery reading_wait_draft_kept`, and the final text is a genuine
  scene beat, not a bare notice). `read-5` was still `running` (never claimed a review round) when t10 ended, so at
  t11 the *next* `resolve` call against the same NPC (asking about lodging/the sheriff) blocked again — 131,353 ms,
  the exact same `job_id: "read-5"`, the exact same `reading_timeout` reason — and again delivered real prose after
  timing out. `read-5` was still `running`, unclaimed by any review round, when the table ended at t20, ten turns
  later. Unlike SL-47 (a move into an unread *scene* lands instantly on the index's own text while the detail read
  continues in the background) there is no equivalent for a `resolve` whose target is an NPC: the check simply waits
  out the full foreground timeout, twice, on the same never-finishing read, before falling back. Net cost: 256 s
  across two turns, both attributable to one job. New root cause, distinct from SL-53/54/55's own scope (it is not a
  lease-sizing, displacement or generation-move issue — `read-5` never even reached a review round to hit any of
  those paths); likely worth its own ticket (an SL-47-shaped partial-landing rule for a `resolve` blocked on its
  target NPC's own material, or a foreground-priority promotion for that specific read the way SL-45 promotes a
  blocking `detail`/`answer` job). Evidence:
  `.coc/playtests/sl29a-b7/home/.coc/campaigns/sl29ab7-xuese-0445/telemetry.jsonl` (turn 10 and turn 11 rows with
  `"reason":"reading_timeout","job_id":"read-5"`, `ms: 124549` and `ms: 131353`); `deepen-queue.json` `read-5`
  (`state: "running"` at table end); `turn-10.json`/`turn-11.json` (`tools[].name==="resolve"`, `ms` matching).
- **Not exercised this table (all new-to-batch-7 lines): SL-54 (no slot contention — max 2 concurrent jobs, never
  3), SL-55 (no generation ever moved — `read-2`'s failure and the `answer` jobs' non-publishing nature meant the
  fork stayed at generation 2 throughout), SL-52 (this book's graph has no obligation/accept node, as
  pre-registered).** None of these is contradicted by this table's evidence; each needs a table whose reading
  workload happens to hit 3-slot contention (SL-54), a mid-table publication (SL-55), or an obligation-bearing scene
  (SL-52) to be exercised live.
- **Not exercised this table (carried from every prior SL-29A book-A table): SL-43 (no obligation-vs-ordinary
  conflict), SL-38/SL-42/SL-40's guard-narration path (this script's only gate is the town's own arrival), SL-49
  (no classification-field dispute arose), SL-51 (this table's only NPC has no book-given name).**
- **SL-48, confirmed a third time, on a new node and dispute shape.** See the table row above; this is now the
  strongest-standing mechanism in this ticket's own line (three tables running, three different nodes, three
  different dispute shapes, all correctly writing the index row on a refused reading).
- **Routing/pacing note, not a defect.** Zero sub-locations entered this table (versus batch-4's 0, batch-5's 2,
  batch-6's 2) because the Keeper's turn-1 move folded the gas station and its attendant into `welcome-to-abattoir`
  itself rather than raising a separate node — consistent with batch-6's own conclusion that which/how-many
  sub-locations get entered is Keeper-choice noise across tables, not a routing defect (no invented move receipt,
  no refused move, honest narration throughout).

**Comparison with batch 6's own findings.**
- **Fixed:** SL-53 (batch-6's P2, the background index job's missing `stage_budget` row and fixed-lease refusal) —
  confirmed fixed above, no exception found.
- **Remains (same root cause, different instance):** the "a scene's detail read fails at review and is never
  retried" gap batches 5/6 both flagged (there as `last-stop`/`church-steeple`'s own reads; here as
  `welcome-to-abattoir`'s), and the reviewer's own book-wide-negative strictness (`read-6`'s refusal echoes SL-55's
  own `read-7` replay note almost verbatim: "an empty `limitations` on a book-wide negative").
- **New:** the `resolve`-blocks-on-NPC-material finding (P1 wall, above) — not seen in batches 4/5/6, because none
  of those tables raised an NPC `detail` read that a same-or-next-turn `resolve` then depended on before it
  finished.
- **Not carried forward as findings (batch-6's SL-54 displacement-retry and structural gap notes):** SL-54 could not
  be re-exercised this table (no slot contention); its own fix (resuming under the current generation rather than
  failing) is measured directly by SL-54's own ticket entry, not by this table.

Evidence (git-ignored, kept — the fork and reading workspace were deliberately not deleted this batch):
- setup: `/Users/haoli/leehow/code/chatrpgv4-wt-sl29a-b7/.coc/playtests/sl29ab7-xuese-0445-setup-20260925T044620Z/`
- table: playtest `/Users/haoli/leehow/code/chatrpgv4-wt-sl29a-b7/.coc/playtests/sl29ab7-xuese-0445-20260925T044840Z/` (turn-{1..20}.json, driver.log, events.jsonl)
- campaign: `/Users/haoli/leehow/code/chatrpgv4-wt-sl29a-b7/.coc/playtests/sl29a-b7/home/.coc/campaigns/sl29ab7-xuese-0445/` (turns/0000–0020.json, telemetry.jsonl, campaign.json)
- reading fork (kept, not deleted): `/Users/haoli/leehow/code/chatrpgv4-wt-sl29a-b7/.coc/playtests/sl29a-b7/home/.coc/module-campaigns/sl29ab7-xuese-0445/modules/book-1/` (`deepen-queue.json` read-1..7; `module.json` `reading.scene_index`)
- reading telemetry (stage_budget rows for SL-53): `/Users/haoli/leehow/code/chatrpgv4-wt-sl29a-b7/.coc/playtests/sl29a-b7/home/.coc/reading-telemetry.jsonl`
- triage: `/Users/haoli/leehow/code/chatrpgv4-wt-sl29a-b7/.coc/playtests/sl29a-b7/triage.txt`
- harness (this branch only, originals under `29-book-a-b6/` untouched): `docs/specs/pi-native-single-loop-tickets/29-book-a-b7/{worker.sh,start.sh,play.py,triage.py,script.md,preregistration.md}`
- per-turn prose (not committed, carries book-derived text): `/Users/haoli/leehow/code/chatrpgv4-wt-sl29a-b7/.coc/playtests/sl29a-b7/turns.log`

### 2026-09-25 — book A (血色公路) SL-29A batch-8 on `41672d838` (integration `claude/integ-single-loop-20260923`, batch 8 merged on top of batch 7: SL-56, SL-57): SL-56 confirmed fixed for the exact table-person shape batch-7 filed it against (the `resolve`-blocks-on-NPC-material wall is gone); SL-57 confirmed live end to end (a refused detail read retried once in the background with the reviewer's reasons, landing on the retry); one new, unrelated P1 finding — a `lookup {kind:"source", source_mode:"prepare"}` call has no allowance or landing path at all and blocks the full foreground `reading_timeout` (120,003 ms, three times this table); one new P2 finding — a batch `apply` naming several book NPCs at once, when the first not-yet-read one is hit, fails hard and fast with no landing even though the turn's own carried text names all three verbatim

Measurement only, no product fixes. New worktree `/Users/haoli/leehow/code/chatrpgv4-wt-sl29a-b8` (branch
`claude/sl29a-b8-20260925`) at `41672d838`, node_modules symlinked from `chatrpgv4-wt-pi-coc-v2` (six paths per the
marker), `npm run build:runtime` clean. Confound noted before the table opened, not touched: long gate #8 (campaign
`longgate8-haunting-0312`, worktree `chatrpgv4-wt-integ-sl`, pid 78720) was running concurrently on this Mac's
grok-build login (confirmed by `ps aux` before the table opened). The App's `.pi/coc-agent/auth.json` grok-build
entry had 26.7 minutes remaining at copy time — below the 45-minute floor set for this run — and a scan of every
`chatrpgv4-wt-*/.pi/coc-agent/auth.json` found no fresher entry anywhere (every live worktree shares the same
`expires` timestamp), so the copied entry was used as-is; the table completed without a credential stall. The
imported home was reused, not re-imported: `chatrpgv4-wt-pdf-a/.coc/playtests/sl29-a-run2/home` (module `book-1`,
generation 2, the same graph batches 4-7 tested) was copied into `.coc/playtests/sl29a-b8/home` (stale `.lock` files under
`.coc/modules` removed before use). A NEW campaign, `sl29ab8-xuese-0512`, was created via the onboarding worker's
`converse` action (title `血色公路`, no `.pdf` suffix); harness adapted from `29-book-a-b7/` as
`29-book-a-b8/{worker.sh,start.sh,play.py,triage.py,script.md}` (script unmodified), with
`29-book-a-b8/preregistration.md` written and committed (`ed89fe8fd`) before the table opened. Investigator
雷·卡特 (same identity as batches 4-7's) was made in a live setup session replaying the recorded exchange
turn-for-turn (5 turns, 98.2 s, 9 tool calls, run `sl29ab8-xuese-0512-setup-20260925T073108Z` — the same shape as
batch-7's setup). The table was played with `29-book-a-b8/play.py` (one sentence a turn, structural branches only)
on driver run `sl29ab8-xuese-0512-20260925T073327Z`, hybrid-v1, `PI_COC_JEV_PRESELECT=1`, grok-build/grok-4.7-build-
fast low. Per-turn structural table: `.coc/playtests/sl29a-b8/triage.txt` (from `29-book-a-b8/triage.py`). The
campaign fork and reading workspace were kept (not deleted), continuing batches 5-7's procedural change; two reads
(`read-10`, `read-12`) were still `running` when the daemon was stopped after turn 20 settled — their in-flight
review rounds show `reason: "review"`, `detail: "The runtime owner or operation is closed or cancelled"` at the
same timestamp as the stop call, and their job-state rows stayed `running` (not corrupted or marked `failed`); this
is an artifact of stopping the daemon after the table finished, not a live-table finding, and is called out
separately from the two reads' own earlier, genuinely live events (see SL-54 below).

**Table-wide.** 20/20 turns settled, 0 stranded, 0 provider errors, `infer(bind)` = 0, admission max 13.0 s (one row
at `cap_ms: 13000`, `review_pending`, `ok: true`; 0 `review_timeout`), 14 `lookup` calls total (8 `kind: source`,
counted separately per the class line: 5 `source_mode: answer` each exactly 8,002 ms, 3 `source_mode: prepare` each
exactly 120,003 ms — see finding 1), speech 5 resolved / 2 unresolved, 0 sanity rolls (this script's sentences do
not reach a sanity-triggering scene). Walls `[87, 33, 29, 155, 27, 37, 146, 63, 44, 60, 67, 30, 31, 91, 36, 34, 35,
23, 55, 143]`; median 40.4 s, 12/20 ≤ 60 s (60%), max 155.3 s (t4). Three turns (t4 155.3 s, t7 145.8 s, t20 142.8 s)
each spend exactly 120,003 ms of their wall inside one `lookup source_mode=prepare` call (finding 1); without those
three, median 36.0 s, max 91.3 s (t14, dominated by ordinary provider-call time, 72,287 ms across 2 calls — no
reading wait), 13/17 ≤ 60 s (76%).

**Table (Scope 3), keyed to what batch 8 changed.**

| class | pre-registered line | measured | verdict |
| --- | --- | --- | --- |
| delivery | 20/20 with prose | 20/20 settled, 0 stranded, every turn delivered real Keeper prose | **pass** |
| wall | median ≤45s, ≥80% ≤60s | median 40.4s, 12/20 ≤60s (60%), max 155.3s; three turns share one new, unrelated cause (finding 1) — without them, median 36.0s, 13/17 ≤60s (76%) | **fails on the line's own numbers this table, entirely on finding 1's account — not SL-56 or SL-57's own targets, both of which held** |
| routing | declared move lands or narrates honestly | Two `apply` moves raised all table: t1 `welcome-to-abattoir` (the town's own arrival, lands on first declaration, no wait) and t8 `esso-gas-station` (one sub-location entered — versus batch-7's 0, batch-6's 2, batch-5's 2, batch-4's 0); 马瑟综合商店/最后一站食宿酒吧 were asked about via `lookup`/`recall` but never entered as scenes this table | **not a defect — Keeper-choice/pacing noise, as batch-6/7 already characterized this axis** |
| admission | no row >12s | admission max 13.0s (t11, `review_pending`, `cap_ms: 13000`), 0 `review_timeout` | **marginal miss (1.0s over the line) — a single row at its own configured cap, not a new pattern** |
| binding | `infer(bind)` = 0 | 0 | pass |
| looks | ≤1/turn after first visit | 6 non-source lookups across 20 turns (4 `module`, 1 `catalog`, 1 `adaptation`); one turn (t17) carried 2 non-source lookups in the same turn; 8 `lookup kind=source` counted separately | **pass overall; one turn (t17) over the per-turn line** |
| prescreen | status per read; own allowance | `prepared` every read, 2-4 candidates as the graph grew, no fallback anywhere | pass |
| drops | every drop has a reason | `text_beside_tool_calls` 14, `floor_steer` 3, `speech_steer` 2 (19 total; a turn can carry more than one); all with rows, no stranded turn | pass |
| fiction/rules | no off-sheet skill | Psychology, Appearance, Drive Auto and other checks all on 雷·卡特's own sheet, none off-sheet | pass |
| stalls | none; provider errors listed | 0 provider `error` rows anywhere | pass |
| reading (PDF) | every read has a telemetry row and outcome | every one of this table's 12 reads (`read-1`..`read-12`) has purpose/focus/ms rows; 8 completed, 1 failed (`read-4`, review-refused), 1 queued (`read-8`, never claimed), 2 still running at daemon stop (`read-10`, `read-12`); **zero `budget_input_tokens`/`provider_refused` events anywhere** | pass |
| SL-53 (index/skeleton job under the book-sized lease) | a `stage_budget` row before the job runs; no fixed-lease refusal | every job that actually ran got a `stage_budget` row (12/12: `read-1`..`read-7`, `read-9`..`read-12`; `read-8` never ran), all `pageCount: 111`, zero `budget_input_tokens` refusals | **confirmed still fixed, no exception found — third table running** |
| SL-54 (a displaced read resumes) | `displaced`/`resumed` rows; no `source_context_changed` failure on a resumed job | **Exercised live for the first time in this ticket's book-A line.** `read-10` (`answer`, focus 阿巴托尔镇民与氛围) was displaced to free a slot for `read-7` (SL-57's retry) after running 72,230 ms (`event: "displaced", for_job: "read-7"`); it resumed as attempt 2 at the same `base_generation` (`resume_from` set to attempt-1's work dir) and continued reading — no `source_context_changed` failure, the job was never marked `failed`. **Gap noted**: no explicit `resumed` telemetry row (as the ticket's own success line names) appears anywhere in `reading-telemetry.jsonl` for this displacement, even though the state file (`deepen-queue.json`, `attempts: 2`) and the continued reading activity show the resumption plainly happened | **the mechanism itself works (no failure, no lost pending row); the specific `resumed` telemetry event the ticket names was not found — worth a follow-up check, not scored as a wall/delivery defect** |
| SL-55 (an answer running through a publication lands, or re-reads once) | `finished_under`/`requeued` rows; no bare `source_context_changed` at finish | The fork advanced generation 2→5 this table (unlike batch-7's stuck-at-2) as multiple reads landed while others were queued/running, with no `source_context_changed` failure anywhere; the one `requeued` row found is SL-57's own flavor (`reason: "review_refused"`), not SL-55's (`reason: "focus_changed"`); zero `finished_under` rows | **not directly exercised (no mid-flight publication observed racing a running, undisplaced job to a `focus_changed` requeue); the multiple clean generation advances are a soft positive sign, not a direct exercise** |
| SL-52 (ask fan-out / accept-obligation yields) | `ask_cleared`/`settled_clue`/obligation-yield rows if triggered | Zero `ask_cleared`, `settled_clue`, `obligation_check` or `guard_unlock` rows anywhere (`"ask_cleared":[]` is an empty compile field, not an event) | not exercised, exactly as pre-registered — this book's 4-node starting graph carries no obligation/accept node |
| SL-50 stage 2 (writes-are-silent; note head once per run) | own counts, not a pass/fail gate | 55 model steps total (52 across turns 1-20, 3 on the opening), 19 delivery drops, 7 of 20 played turns needed ≥3 model steps | reported for comparison only; drops (19) and steps (55) both somewhat above batch-7's own counts (10, 52), turns≥3 (7) about the same |
| SL-56 (NPC material never holds a turn) | table person never held (no `material_pending`/`reading_timeout` on him); book/index person lands on text; only a genuinely unnamed-anywhere person still waits | **See findings 2 and 3 below — the table-person half is confirmed fixed; the book-person landing-on-carried-text half was posed and did not land** | **fixed for the case it was filed against; a related, narrower gap found in the same feature** |
| SL-57 (a refused detail read is retried once, then settles unusable) | `requeued` row with reasons; a second refusal settles `unusable` once | **See finding 4 below — confirmed live end to end for the retry-once half; the retry succeeded, so the second-refusal/`unusable` half was not posed** | **confirmed working for the case it was exercised on** |

**Findings, one root cause each**

- **Finding 1 (new, P1 wall) — a foreground `lookup {kind:"source", source_mode:"prepare"}` call has no allowance
  or landing path at all: it blocks the full `reading_timeout` every time, to the millisecond.** Three times this
  table (t4 `query: "welcome-to-abattoir"`, t7 `query: "esso-gas-station"`, t20 `query: "最后一站食宿酒吧"`) the
  Keeper issued a `lookup` with `source_mode: "prepare"` — after the destination scene had *already* been entered
  by a successful `apply move` on a prior or the same turn, landing on SL-47's index text — apparently to pull the
  scene's fuller material before narrating in more depth. Each call took exactly `120003`/`120003`/`120003` ms
  before returning `needs: the source is still being read` (`retryable: false`). By contrast, every
  `source_mode: "answer"` call this table (5 of them, t9/t11/t13/t15/t17) returned in exactly `8002`/`8001`/`8002` ms
  — SL-36's own 8-second allowance holds precisely for the mode it actually covers (ticket 36 is scoped to
  `purpose: "answer"` only; `source_mode: "prepare"` was never in its scope). This is a distinct code path from
  SL-47 (which already lands the move itself instantly) and from SL-36 (answer-mode only): a `prepare`-mode request
  for a scene already landed on index text still has no pending/allowance treatment, and drove 360 of this table's
  1227.4 total wall-seconds (29%) across exactly 3 of 20 turns. Not seen in batches 4-7 because none of those
  tables' Keepers used this lookup mode after a move — this table's Keeper did, three separate times, on three
  different scenes. Evidence: `.coc/playtests/sl29ab8-xuese-0512-20260925T073327Z/turn-{4,7,20}.json`
  (`tools[].name==="lookup"`, `args.kind==="source"`, `args.source_mode==="prepare"`, `ms` exactly `120003`/`120003.1`/`120003`);
  contrast `turn-{9,11,13,15,17}.json` (`source_mode:"answer"`, `ms` `8002.1`/`8002.1`/`8001.9`/`8001.7`/`8002.0`).
- **Finding 2 (SL-56, confirmed fixed) — the exact table-person shape batch-7 filed no longer blocks the turn.**
  At t8-t10 the Keeper, refused when trying to place book-named NPCs (finding 3), fell back to an unnamed
  description ("灰发男人", "the grey-haired man") exactly as batch-7's Keeper did with "最靠边的那个男人". At t10 the
  first `resolve` on him failed fast (`missing target`, no NPC yet present) — not a reading wait — so the Keeper
  issued `apply {npc, person}` to establish him, which the NPC subsystem recorded as `npc-table-408a5a8f57fda4acee64`
  (`personality.origin: "table_supplement"`, i.e. a table person per §87), and the *next* `resolve` calls (a
  first-impression check, then the Psychology observation the player's sentence asked for) both succeeded
  immediately — no `material_pending`, no `reading_timeout`, anywhere in t10. Turn 10's whole wall was 60.5 s
  (compare batch-7's t10 172.1 s / t11 176.7 s, each ~125-131 s of which was exactly this same shape's
  `reading_timeout` block). This is a clean, direct confirmation that §22.4.7.1's `withTablePeople` consultation in
  the gate now works for the case the ticket was filed against. Evidence:
  `.coc/playtests/sl29a-b8/home/.coc/campaigns/sl29ab8-xuese-0512/npc-ledger.json` (key
  `npc-table-408a5a8f57fda4acee64`); `.coc/playtests/sl29a-b8/home/.coc/campaigns/sl29ab8-xuese-0512/npc/jobs/`
  (packet `npc.personality.origin: "table_supplement"`); `.coc/playtests/sl29ab8-xuese-0512-20260925T073327Z/turn-10.json`
  (`tools[]`: `resolve` "missing target" → `apply npc+person` → `resolve` ×3, none refused, wall 60.5s); zero
  `material_pending`/`reading_timeout` rows anywhere in `telemetry.jsonl` for turns 9-11.
- **Finding 3 (new, P2, same feature as SL-56) — a batch `apply` naming several book NPCs at once fails hard and
  fast on the first not-yet-ready one, with no landing even though the turn's own carried text names all three
  verbatim.** At t8 the Keeper's carried note (`focus: "scene_text"`, `esso-gas-station`) already held the book's
  own page-17 text verbatim, naming all three attendants: 拉斯·威廉姆斯 (as an alias of the book's "拉塞尔·威廉姆斯"),
  内特·帕特森 and 史蒂夫·布朗. The Keeper's `apply` placed all three as `npc` effects plus a `person` effect for the
  first, in one call; the call was refused in 22 ms (`code: "needs", reason: "material_pending", read_focus:
  "内特·帕特森"`, `retryable: false`) — the whole batch failed atomically (no partial receipts), and no read was
  queued for the person specifically (only the pre-existing scene-level `read-4`/`read-7` continued). This is not
  the same code path as finding 2's fast, correct table-person success: `内特·帕特森` is a real book name (matching a
  graph node still mid-read), and per §22.4.7.1's own comments the host should attempt `landPerson` — checking the
  turn's carried text (which literally contains "内特·帕特森") and resending with `_land_on_text` — before surfacing
  the refusal to the model. No such landing was observed: the raw refusal reached the model unchanged, and the
  Keeper recovered narratively (finding 2's fallback) rather than the product landing him on the very text it had
  just carried. Distinguish from SL-51 (never exercised in batches 4-7 for lack of a carried-text NPC name posed
  before its record lands) — this table posed exactly that race, on a real book name, and it did not land. Evidence:
  `.coc/playtests/sl29ab8-xuese-0512-20260925T073327Z/events.jsonl` (the `coc-clerk` message before t8's `apply`,
  `views[].focus==="scene_text"` carrying page 17's text with all three names verbatim; the `apply` toolcall naming
  them); `.coc/playtests/sl29a-b8/home/.coc/campaigns/sl29ab8-xuese-0512/telemetry.jsonl` (turn 8, `tool:"apply"`,
  `call_id:"t8-c2"`, `ms:22`, `reason:"material_pending"`, `read_focus:"内特·帕特森"`).
- **Finding 4 (SL-57, confirmed live end to end) — a refused detail read was retried once in the background with
  the reviewer's reasons, and the retry landed.** `read-4` (`detail`, `esso-gas-station`) failed at review 4-5
  minutes into the table: the reviewer refused `/nodes/1/aliases` and seven other paths as `unsupported` (aliases
  printed only in Chinese where the draft added an English form, a keeper-note claim not on the page, a delivery
  section mismatch, two visibility claims not marked keeper-only), `rule: "review_unsupported"`. `module.read.finish`
  queued `read-7` as `{review_retry: {of: "read-4", refused: [...8 rows...]}, foreground: false, resume_from:
  ".../read-4/attempt-1"}`, and `reading-telemetry.jsonl` recorded `{event: "requeued", job_id: "read-7", of:
  "read-4", reason: "review_refused"}` — exactly SL-57's own shape: once, in the background, carrying the reasons.
  `read-7` then completed cleanly (no second refusal), publishing generation 5 and updating `esso-gas-station`'s own
  `scene_index` row to cite `job_id: "read-7"` (SL-48 held again on the new job id). Because the retry succeeded,
  SL-57's other half (a second refusal settling the focus `unusable`, shown once) was not posed this table — a
  table whose retry is *also* refused the same way would be needed to exercise it. Evidence:
  `.coc/playtests/sl29a-b8/home/.coc/module-campaigns/sl29ab8-xuese-0512/modules/book-1/deepen-queue.json`
  (`read-4.refusal.rule:"review_unsupported"`; `read-7.review_retry.of:"read-4"`, `read-7.state:"completed"`,
  `read-7.result:{generation:5}`); `.coc/playtests/sl29a-b8/home/.coc/reading-telemetry.jsonl` (`event:"requeued"`
  row); `module.json` (`reading.scene_index` row for `esso-gas-station`, `job_id:"read-7"`).
- **SL-54, exercised live for the first time in this book-A line (see table row above) — the displacement/resume
  mechanism itself works; the named telemetry event does not appear.** Not scored as a wall or delivery defect
  (nothing failed, nothing was lost), but worth a follow-up: does `resumed` fire under a different shape, or is it
  missing from this code path?
- **Not exercised this table: SL-52 (no obligation node in this book's graph, as pre-registered), SL-55's own
  specific mid-flight-publication race (generations advanced cleanly but not via a `finished_under`/`focus_changed`
  sequence), SL-49 (both disputes seen this table — `read-4`'s and `read-6`'s — were fact-level, not
  classification-field), SL-38/SL-42/SL-40's guard-narration path (this script's only gate is the town's own
  arrival), SL-43 (no obligation-vs-ordinary conflict).**

**Comparison with batch 7's own findings.**
- **Fixed:** SL-56's own P1 (batch-7's `resolve`-blocks-on-NPC-material wall, ~125-131 s twice) — confirmed fixed
  above (finding 2), same NPC-creation shape, now 60.5 s with no reading wait at all.
- **Remains, narrower:** the "a scene's detail read fails at review and the Keeper falls back to unnamed
  description" shape recurs (batch-7's own workaround for its NPC; this table's for the gas-station attendants),
  but the underlying "refused reading never retried" gap that produced it in batches 5-7 is now fixed by SL-57 —
  this table's own retry succeeded, so the fallback in finding 3 is not from an abandoned reading but from a
  same-turn landing gap in the `apply`-batch case specifically (see finding 3).
- **New:** finding 1 (the `source_mode: "prepare"` 120 s block) and finding 3 (batch-`apply` book-NPC landing gap)
  — neither seen in batches 4-7, both novel to this table's own script/Keeper behavior, neither inside SL-56/57's
  own scope.
- **Confirmed again:** SL-53 (third table running, no exception); SL-48 (index cites the successful retry's own job
  id, fourth table running this mechanism).

Evidence (git-ignored, kept — the fork and reading workspace were deliberately not deleted this batch):
- setup: `/Users/haoli/leehow/code/chatrpgv4-wt-sl29a-b8/.coc/playtests/sl29ab8-xuese-0512-setup-20260925T073108Z/`
- table: playtest `/Users/haoli/leehow/code/chatrpgv4-wt-sl29a-b8/.coc/playtests/sl29ab8-xuese-0512-20260925T073327Z/` (turn-{1..20}.json, driver.log, events.jsonl)
- campaign: `/Users/haoli/leehow/code/chatrpgv4-wt-sl29a-b8/.coc/playtests/sl29a-b8/home/.coc/campaigns/sl29ab8-xuese-0512/` (turns/0000-0020.json, telemetry.jsonl, campaign.json, npc-ledger.json, npc/jobs/, npc/responses/)
- campaign fork (kept, not deleted): `/Users/haoli/leehow/code/chatrpgv4-wt-sl29a-b8/.coc/playtests/sl29a-b8/home/.coc/module-campaigns/sl29ab8-xuese-0512/modules/book-1/` (`deepen-queue.json` read-1..12; `module.json` `reading.scene_index`)
- reading telemetry (stage_budget/displaced/requeued rows): `/Users/haoli/leehow/code/chatrpgv4-wt-sl29a-b8/.coc/playtests/sl29a-b8/home/.coc/reading-telemetry.jsonl`
- triage: `/Users/haoli/leehow/code/chatrpgv4-wt-sl29a-b8/.coc/playtests/sl29a-b8/triage.txt`
- harness (this branch only, originals under `29-book-a-b7/` untouched): `docs/specs/pi-native-single-loop-tickets/29-book-a-b8/{worker.sh,start.sh,play.py,triage.py,script.md,preregistration.md}`
- pre-registration commit: `ed89fe8fd` (before the table opened)
- per-turn prose (not committed, carries book-derived text): `/Users/haoli/leehow/code/chatrpgv4-wt-sl29a-b8/.coc/playtests/sl29a-b8/turns.log`

### 2026-09-25 — book A (血色公路) SL-29A batch-9 on `1ed666fd0` (integration `claude/integ-single-loop-20260923`, batch 9 merged on top of batch 8: SL-58, SL-59, SL-60, SL-61, SL-62, SL-63): SL-58 confirmed fixed live (no source_mode=prepare call blocked past the ~8s allowance); SL-59 confirmed fixed for a batch where at least one effect resolves (line-level `not_landed`); SL-61 confirmed live end to end (reasoning tokens 0 on every one of 94 calls, p50 3.4s/p90 7.6s, no call over 45s); SL-60/62/63 not exercised to a conclusive result this table; one new, unrelated P1 finding — once one table-established NPC exists in a campaign, the graph's own candidate list makes every subsequent brand-new (book-absent) NPC name refuse `unknown_entity` instead of minting, so a table can never carry more than one Keeper-invented person

**Keeper model change, stated up front.** Grok-build has no quota this session. This table ran
`opencode-go/deepseek-v4.1-flash` with `--thinking off` (SL-61's own provider-data correction). Wall-time,
step-count and drop-count numbers below are **not** comparable to batches 4-8's grok tables as
regressions/improvements — a different model plays differently. Only the structural/telemetry classes
(delivery, routing mechanism, admission, binding, reading, SL-5x/6x checks) are scored as product findings.

New worktree `/Users/haoli/leehow/code/chatrpgv4-wt-sl29a-b9` (branch `claude/sl29a-b9-20260925`) at
`1ed666fd0`, node_modules symlinked from `chatrpgv4-wt-pi-coc-v2` (six paths per the marker), built via
`leehow-pc-tests`' `remote-test.sh build-fetch` (23s remote build, clean). Confound noted before the table
opened, not touched: long gate #11 (campaign `longgate11-haunting-1515`, worktree `chatrpgv4-wt-integ-sl`,
pid 86736) was running concurrently on this Mac, **on the same provider/model** as this table (confirmed by
`ps aux`); its daemon was not touched. `.pi/coc-agent/{auth.json,pipiui-settings.json,grok-build-models.json,
models-store.json}` copied from `chatrpgv4-wt-integ-sl`; `models.json` deliberately **not** copied — see the
pre-table confirmation below. The imported home was reused: `chatrpgv4-wt-pdf-a/.coc/playtests/sl29-a-run2/home`
(module `book-1`, generation 2, the same graph batches 4-8 reused) copied into `.coc/playtests/sl29a-b9/home`;
every stale `.lock` file found anywhere under the copied home was removed before use — this batch found
locks beyond `.coc/modules` too (`.coc/locks`, `.coc/mods/jobs/*/review.lock`, `.coc/campaigns/*/setup.lock`,
`.coc/module-campaigns/*`), all stale, all removed. A NEW campaign, `sl29ab9-xuese-1922`, was created via the
onboarding worker's `converse` action (title `血色公路`, no `.pdf` suffix; `guidance_key` and `start_scene`
read from the copied module's own `module.json`); harness adapted from `29-book-a-b8/` as
`29-book-a-b9/{worker.sh,start.sh,play.py,triage.py,script.md}` (script unmodified), with
`29-book-a-b9/preregistration.md` written and committed (`2e1df3e95`) before the table opened.

**Pre-table confirmation (SL-61).** `content/providers/model-corrections.json` present in this worktree
before the table opened, with `opencode-go/deepseek-v4.1-flash` and `.../deepseek-v4-flash` both
`thinkingLevelMap: {"off": "off"}`. After the setup daemon started, `daemon.json`'s
`model_confirmed.thinkingLevelMap.off` read `"off"`, and this worktree's own `.pi/coc-agent/models.json` —
absent before the table, never copied — was written by the product at host preparation with the `//`-comment
provenance note naming the two corrected models; both confirmed again on the play daemon's own `daemon.json`
before turn 1. Reasoning tokens: `events.jsonl` across the whole run (opening + 20 turns) carries 625
`"reasoning": 0` occurrences and **zero** nonzero ones; `reasoning_effort` is `null` on every one of the 97
requests (thinking sent as `disabled`, no effort field, exactly SL-61's own shape) — this table's own
telemetry.jsonl `provider-call` rows carry no `usage` field at all in this build, so the reasoning-token count
is drawn from the driver's `events.jsonl`, not `telemetry.jsonl`.

**Setup (live, `driver.py --launcher bin/pi-coc-setup`, run `sl29ab9-xuese-1922-setup-20260925T192401Z`,
replaying batches 4-8's own recorded 5-turn exchange turn-for-turn).** 5 turns, 54.9s total, 8 tool calls —
each individual turn 6.3-22.5s, none over 23s (contrast batch-8's 98.2s for the same exchange; thinking-off
deepseek is markedly faster per call, as expected, not scored as a product finding). The card: investigator
name rendered **雷·卡** (truncated — batches 4-8's setup produced 雷·卡特 from the identical script; a
Keeper-model difference in how it echoed the name back on confirmation, not a product mechanism this ticket
covers), Private Investigator, Drive Auto 50 (batches 4-8's card had Drive Auto 55). Recorded, not scored.

**Table (`29-book-a-b9/play.py`, driver run `sl29ab9-xuese-1922-20260925T192559Z`, hybrid-v1,
`PI_COC_JEV_PRESELECT=1`, `opencode-go/deepseek-v4.1-flash` thinking off).** 20/20 turns settled, 0 stranded,
99 tool calls (apply 30, lookup 28, look 17, narrate 13, resolve 6, recall 5), 94 Keeper provider calls (0
errors), admission max 13,004 ms (one row, t13, `review_pending` at its own configured `cap_ms: 13000`, 0
`review_timeout`), `infer(bind)` = 0, 45 `look`/`lookup` non-source calls, 9 `lookup kind=source` calls (0
`reading_timeout` on any of them — the first table in this line with zero), speech 11 resolved / 22
unresolved, 0 sanity rolls (script does not reach one). Walls `[32, 30, 14, 27, 24, 32, 41, 34, 31, 28, 64, 56,
62, 56, 57, 26, 57, 72, 46, 47]`; median 37.2s, 17/20 ≤ 60s (85%), max 72.1s (t18); model-call ms p50 3435,
p90 7584, **zero calls over 45s**. The module graph forked and advanced generation 2→3 (the town's own detail
read, `read-2`, landed); 10 reading jobs raised (`read-1`..`read-10`), all 10 carrying a `stage_budget` row, 0
`budget_input_tokens` refusals (SL-53 holds, fifth table running), 6 background-read displacements
(`event: "displaced"`, `read-1/3/4/6/7/8`) but **none of the six had resumed by the time the daemon was
stopped** — all six were still `state: "queued"` in `deepen-queue.json`, `attempts: 1`, when the table ended
(a heavier read-slot contention than batch-8's single displace-then-resume, plausibly this Keeper's own much
higher `lookup`/`recall` volume per turn saturating the reading slots faster than earlier grok tables).

**Table (Scope 3), keyed to what batch 9 changed.**

| class | pre-registered line | measured | verdict |
| --- | --- | --- | --- |
| delivery | 20/20 with prose | 20/20 settled, 0 stranded, every turn delivered real Keeper prose | **pass** |
| wall | median ≤45s, ≥80% ≤60s | median 37.2s, 17/20 ≤60s (85%), max 72.1s — no turn waited on a `reading_timeout` (first table in this line with none) | **pass** (not compared to grok tables — model change) |
| routing | declared move lands or narrates honestly | one `apply` move raised all table: t4 `welcome-to-abattoir` (the town's own arrival, lands on first declaration). No sub-location (esso-gas-station, 马瑟综合商店, 最后一站) was ever entered as a scene this table, despite being asked about extensively via `lookup`/`recall`/`look`; t20's own move attempt to `last-stop` refused `unknown_entity: The destination 'last-stop' is not an identified scene` | **not a defect on its own — Keeper-choice/pacing noise (this Keeper did far more research, far less committing, than grok's); plausibly downstream of the new NPC-establishment finding below (see findings)** |
| admission | no row >12s | admission max 13.0s (t13, `review_pending`, `cap_ms: 13000`), 0 `review_timeout` | **marginal miss (1.0s over the line) — same shape as batch-8's own single capped row, not a new pattern** |
| binding | `infer(bind)` = 0 | 0 | pass |
| looks | ≤1/turn after first visit | 45 non-source `look`/`lookup` across 20 turns (heavier than batch-8's 6 — this Keeper's own research style); 9 `lookup kind=source` counted separately, 0 `reading_timeout` on any | **fails the per-turn line on several turns (Keeper-style, not a product mechanism)** |
| prescreen | status per read; own allowance | `prepared` every read, 2-3 candidates as the graph grew, no fallback anywhere | pass |
| drops | every drop has a reason | `text_beside_tool_calls` and `speech_steer` rows seen, each with a reason; no stranded turn | pass |
| fiction/rules | no off-sheet skill; no push without declaration | all rolls (Navigate, Spot Hidden, Psychology, Drive Auto, Charm) on 雷·卡's own sheet; t18's `apply move` attempt correctly refused `needs: The player has not chosen this action` | pass |
| stalls | none; provider errors listed | 0 provider `error` rows anywhere | pass |
| reading (PDF) | every read has a telemetry row and outcome | all 10 reads (`read-1`..`read-10`) have purpose/focus/ms rows; 1 completed (`read-2`), 3 running at daemon stop (`read-5`,`read-9`,`read-10`), 6 displaced-and-still-queued; zero `budget_input_tokens`/`provider_refused` events anywhere | pass |
| SL-58 (`prepare`-mode lookups get the answer allowance) | pending near the 8s allowance, not a 120,003ms block | **3 of 3 `source_mode: "prepare"` calls this table (t7 7991.9ms, t15 7998.4ms, t20 8001.4ms) returned `{"source_answer":{"status":"pending",...}}` — none blocked past the allowance, none hit `reading_timeout`. t7's target (`welcome-to-abattoir`'s detail) genuinely was not ready yet (it completed at 19:32:21Z; t7 ended at 19:29:31Z), so this is a live, direct confirmation, not a scheduling artifact** | **confirmed fixed** |
| SL-59 (batch npc/person effects land line by line) | receipt count = resolvable-effect count, not zero when ≥1 resolves | **t11's 4-effect `apply` (`npc:卡尔, npc:霍默, person:卡尔, person:霍默`) landed 卡尔 (2 receipts: `npc:t11-c1`, `person:卡尔-t11-c1`, `is_error:false`) and isolated 霍默's failure as `not_landed:[{index:1,code:"unknown_entity",...},{index:3,code:"unknown_entity",...}]` — exactly the §32.12.3 line-level shape.** Every *other* multi-effect npc `apply` this table (t14, t15, t17) refused whole (`is_error:true`, no `not_landed`) — but in every one of those, **every** effect in the batch failed the same way (see the new finding below): SL-59's isolation only has something to isolate when at least one effect can land; a batch where nothing resolves has nothing to differentiate and (correctly, per its own design) falls back to the aggregate refusal | **confirmed fixed for its own stated scope** |
| SL-60 (dedicated `resumed` row) | a resumed job's row is dedicated, not only embedded | 6 displacements occurred; **none resumed before the daemon stopped** (all 6 stayed `state: "queued"`, `attempts: 1`) — no `event: "resumed"` row, dedicated or embedded, appears anywhere, because no job actually resumed | **not exercised to a conclusion — different from batch-8's own gap (a resume happened there with no dedicated row); here no resume happened at all** |
| SL-61 (deepseek Keeper thinking off) | reasoning 0 on every call | 94 provider calls, reasoning 0 on all (verified via `events.jsonl`, 625×`"reasoning": 0`, zero nonzero); p50 3.4s, p90 7.6s, 0 calls over 45s | **confirmed fixed, live** |
| SL-62 (a person's name resolved before `unknown_entity`) | `resolved_from` on a variant-name match; genuine unknowns still refuse | **Not exercised**: every `unknown_entity` refusal this table named a genuinely different person from any scene-present one (霍默/马瑟/店里的姑娘/柜台后梳发油的男人 are not variant spellings of 卡尔) — the scene-candidate fan-out correctly found nothing to clear, so `unknown_entity` stood in every case for the *right* reason (SL-62 not at fault; see the new finding below for *why* they all failed) | **not exercised — no variant-name shape appeared this script** |
| SL-63 (refusal-budget abort still delivers) | a runaway abort still delivers | Two `reason: "refusal_budget"` rows (t14, t17), both `blocked_after_exhausted: 1` — the ordinary three-strikes class block, not SL-63's `aborted_during_operate` runaway (which needs a much higher `blocked_after_exhausted`). Both turns delivered normally (the model heeded "stop trying it: close the turn with narrate" and did) | **not exercised — the softer three-strikes gate fired and worked as designed; the runaway-abort path this ticket targets was never reached** |

**Findings, one root cause each**

- **Finding 1 (new, P1, unrelated to any of SL-58..63) — once one table-established NPC exists in a campaign,
  every subsequent brand-new (book-absent) NPC name is refused `unknown_entity` instead of being minted as a
  second table person; a campaign can carry at most one Keeper-invented person for its whole run.**
  `kernel-ts/apply/entities.ts`'s `personOfEffect` (~line 93-101) refuses to mint a new table person whenever
  `graph.candidates(name, ['npc']).length` is non-zero for that name: `if(!passage&&graph.candidates(name,
  ['npc']).length)throw error;` — i.e. "the graph has *something* to say" is read as "refuse, and let the
  Keeper pick from the candidates" rather than "mint, since nothing here actually matches." But
  `kernel-ts/read/module-graph.ts`'s `candidates()` (~line 382-405) *unconditionally* appends every
  already-established table person's handle to the candidate list for any `npc`-kind query, by design and on
  purpose — its own comment says why: "deciding those are one person is the open semantic judgement this
  project forbids... nothing compares the query to these names; they are appended" (a roster to pick from, not
  a match). The two are individually correct in isolation and incompatible together: the moment one table
  person exists, `candidates()` is never empty again for *any* new npc-kind name, so `personOfEffect`'s
  emptiness test can never pass again, and no second table person can ever be established, no matter how
  lexically unrelated the new name is to the one that already exists. Reproduced five separate times this
  table, every time with the *same* offered "candidate" (卡尔, who was minted first, at t11) regardless of the
  attempted name's similarity to it: t11 (霍默, isolated per SL-59 above, alongside 卡尔's own successful
  landing in the same call), t14 (马瑟 / 马瑟先生 / 店里的姑娘, 4 attempts, whole-batch refusal each time,
  tripping the refusal budget's three-strikes block), t15 (马瑟, 1 attempt, npc+person together, still
  refused whole), t17 (霍默 / 屋里两个吃饭的男人, 4 attempts, whole-batch refusal each time, tripping the
  refusal budget a second time), t18 (霍默 alone, then 柜台后梳发油的男人 alone — a lone, single-effect
  `apply {npc: "柜台后梳发油的男人"}` with no batch and no book claim at all, still refused `unknown_entity`
  with `candidates: [卡尔]`). `npc-ledger.json` confirms the effect end to end: exactly **one** entry for the
  whole campaign (`npc-table-8e83a4c03f56c9671651`, first turn 11) — 卡尔 is the only person this table ever
  managed to establish, although the Keeper tried to introduce at least four more distinct people (a
  gas-station attendant, a shopkeeper, his shop-girl, a bar owner, two diner patrons) across nine later
  attempts. Not seen in batches 4-8: batch-8's own `npc-ledger.json` also has exactly one entry
  (`npc-table-408a5a8f57fda4acee64`) for its whole run — the defect was already there, but no earlier table's
  Keeper ever tried to name a *second* distinct book-absent person in the same campaign, so it was never
  exercised until this table's Keeper (which asked about far more named people than any prior batch) did.
  Plausibly the root cause of this table's own routing softness (no sub-location ever entered as a scene, see
  the routing row above): the Keeper kept trying and failing to name the shopkeeper/bartender it needed to
  narrate the scene, tripped the refusal budget twice, and fell back to research (`look`/`lookup`) rather than
  committing further. Evidence: `kernel-ts/apply/entities.ts` `personOfEffect` (~L93-101);
  `kernel-ts/read/module-graph.ts` `candidates()` (~L382-405, the table-roster append with its own comment);
  `.coc/playtests/sl29ab9-xuese-1922-20260925T192559Z/turn-{11,14,15,17,18}.json` (`tools[].name==="apply"`,
  `result_text`/`not_landed` showing `unknown_entity`/`candidates:["卡尔"]` for every non-卡尔 name);
  `.coc/playtests/sl29a-b9/home/.coc/campaigns/sl29ab9-xuese-1922/npc-ledger.json` (one entry, whole campaign);
  cross-reference `.coc/playtests/sl29a-b8/home/.coc/campaigns/sl29ab8-xuese-0512/npc-ledger.json` (also one
  entry, confirming the defect pre-dates this batch and was simply unexercised before).
- **SL-58, confirmed fixed live (see table row above) — the clean confirmation the ticket's own worker asked
  for.** Not a replay: a live table where the foreground `prepare` call's target genuinely was not ready yet.
  Evidence: `.coc/playtests/sl29ab9-xuese-1922-20260925T192559Z/turn-{7,15,20}.json` (`tools[].name==="lookup"`,
  `args.source_mode==="prepare"`, `ms` `7991.9`/`7998.4`/`8001.4`, `result_text` carrying
  `"status":"pending"`); `.coc/playtests/sl29a-b9/home/.coc/reading-telemetry.jsonl` (`read-2`'s `read`/`verify`
  rows timestamped `2026-09-25T19:3{0:29,1:01,1:20,1:58,2:21}` — all after t7 ended at `19:29:31Z`).
- **SL-59, confirmed fixed for its own stated scope (see table row above and finding 1).** Evidence:
  `.coc/playtests/sl29ab9-xuese-1922-20260925T192559Z/turn-11.json` (`tools[].name==="apply"`, `args.effects`
  length 4, `result_text` carrying `"receipts":["npc:t11-c1","person:卡尔-t11-c1"]` and
  `"not_landed":[{"index":1,...},{"index":3,...}]`, `is_error:false`).
- **SL-61, confirmed fixed live (see table row above).** Evidence:
  `.coc/playtests/sl29ab9-xuese-1922-20260925T192559Z/events.jsonl` (625×`"reasoning": 0`, 0 nonzero, 97×
  `"reasoning_effort": null`); `.coc/playtests/sl29ab9-xuese-1922-20260925T192559Z/daemon.json` and
  `.coc/playtests/sl29ab9-xuese-1922-setup-20260925T192401Z/daemon.json` (both
  `model_confirmed.thinkingLevelMap.off: "off"`); `.pi/coc-agent/models.json` (product-written, present only
  after the setup daemon started, carrying the `//`-comment provenance note).
- **SL-60, not exercised to a conclusion (see table row above) — a different gap shape from batch-8's.**
  Batch-8 saw a resume with no dedicated row; this table saw 6 displacements and zero resumes, so neither the
  embedded nor the dedicated row could appear. Worth a follow-up table with fewer concurrent named-lookup
  jobs (or a longer per-turn timeout) so a displaced job actually gets to resume and this ticket's own success
  line can be checked. Evidence: `.coc/playtests/sl29a-b9/home/.coc/reading-telemetry.jsonl` (6 `event:
  "displaced"` rows, 0 `event: "resumed"` rows, 0 `concurrency` rows carrying a `resumed` field);
  `.coc/playtests/sl29a-b9/home/.coc/module-campaigns/sl29ab9-xuese-1922/modules/book-1/deepen-queue.json`
  (`read-{1,3,4,6,7,8}.state: "queued"`, `attempts: 1` — never reclaimed).
- **SL-62/SL-63, not exercised (see table rows above) — both correctly not triggered, for different reasons.**
  SL-62 had no variant-name-of-a-known-person shape to resolve (every failing name really was a different
  person, per finding 1). SL-63 had no runaway abort (`blocked_after_exhausted` stayed at 1 both times the
  three-strikes gate fired; the model recovered on its own).

**Comparison with batch-8's own findings.**
- **Fixed:** SL-58's own P1 (batch-8's three 120,003ms `source_mode: "prepare"` blocks) — confirmed fixed
  above, live, on a genuinely-not-ready target. SL-59's own P2 (batch-8's whole-batch refusal on a mixed
  landable/unlandable batch) — confirmed fixed above for the shape it was filed against (t11 mirrors batch-8's
  t8 exactly: a landable name beside an unlandable one, now isolated instead of refusing whole).
- **Remains, but reframed:** batch-8's finding 3 was read as "a batch naming several book NPCs fails hard on
  the first not-yet-read one" (a `requireMaterial`/material-pending shape, per its own worker's caveat that
  this ticket's `unknown_entity`/§11.5.4 fix does not reach it). This table's own whole-batch refusals
  (t14/t15/t17) are **not** that shape — every name involved genuinely returned `unknown_entity` (not
  `material_pending`), and root-causes instead to finding 1 above, a distinct, deeper mechanism gap in
  `personOfEffect`/`candidates()` that happens to produce the same visible "whole batch refuses" symptom for
  a different reason (nothing in the batch can land at all, not "the first one blocks the rest"). Whether
  batch-8's own `requireMaterial` gap (unread book NPCs specifically) is now fixed, worse, or unaffected was
  not tested this table — the script never repeated batch-8's exact "carried scene_text already names the
  NPC verbatim" shape.
- **New:** finding 1 (the one-table-person-per-campaign cap) — not seen in batches 4-8 because none of their
  Keepers ever tried to name a second book-absent person in one campaign; the defect itself almost certainly
  pre-dates this batch (batch-8's own ledger shows the same one-entry ceiling), so it is a *newly exercised*
  finding, not a regression from batch 9's own merged tickets.
- **Confirmed again:** SL-53 (fifth table running, no exception); SL-48 (index still cites the completed
  read's own job id — `read-2` for `welcome-to-abattoir`).

Evidence (git-ignored, kept per the marker):
- setup: `/Users/haoli/leehow/code/chatrpgv4-wt-sl29a-b9/.coc/playtests/sl29ab9-xuese-1922-setup-20260925T192401Z/`
- table: playtest `/Users/haoli/leehow/code/chatrpgv4-wt-sl29a-b9/.coc/playtests/sl29ab9-xuese-1922-20260925T192559Z/` (turn-{1..20}.json, driver.log, events.jsonl, daemon.json)
- campaign: `/Users/haoli/leehow/code/chatrpgv4-wt-sl29a-b9/.coc/playtests/sl29a-b9/home/.coc/campaigns/sl29ab9-xuese-1922/` (turns/0000-0020.json, telemetry.jsonl, campaign.json, npc-ledger.json)
- campaign fork (kept, not deleted): `/Users/haoli/leehow/code/chatrpgv4-wt-sl29a-b9/.coc/playtests/sl29a-b9/home/.coc/module-campaigns/sl29ab9-xuese-1922/modules/book-1/` (`deepen-queue.json` read-1..10; `module.json` `reading.scene_index`)
- reading telemetry (stage_budget/displaced rows): `/Users/haoli/leehow/code/chatrpgv4-wt-sl29a-b9/.coc/playtests/sl29a-b9/home/.coc/reading-telemetry.jsonl`
- agent home model confirmation: `/Users/haoli/leehow/code/chatrpgv4-wt-sl29a-b9/.pi/coc-agent/models.json` (gitignored, product-written; not printed here beyond what's quoted above)
- triage: `/Users/haoli/leehow/code/chatrpgv4-wt-sl29a-b9/.coc/playtests/sl29a-b9/triage.txt`
- harness (this branch only, originals under `29-book-a-b8/` untouched): `docs/specs/pi-native-single-loop-tickets/29-book-a-b9/{worker.sh,start.sh,play.py,triage.py,script.md,preregistration.md}`
- pre-registration commit: `2e1df3e95` (before the table opened)
- per-turn prose (not committed, carries book-derived text): `/Users/haoli/leehow/code/chatrpgv4-wt-sl29a-b9/.coc/playtests/sl29a-b9/turns.log`

### 2026-09-25 — book A (血色公路) SL-29A batch-10 on `9c63c2bd6` (integration `claude/integ-single-loop-20260923`, batch 9 plus SL-64 merged on top: a campaign mints as many table persons as the Keeper introduces): **SL-64 confirmed fixed, live** — a genuinely new (book-absent) person minted with three table persons already established, the exact shape batch-9 could never get past; SL-58/59/61 confirmed still fixed; one new P2 finding (background reading-lease exhaustion, 5 `budget_input_tokens` refusals, none foreground) and one new P3 finding (a name-range off-by-one bakes the setup sentence's trailing comma into the investigator's own name, echoed into player-facing prose)

Same Keeper as batch-9: `opencode-go/deepseek-v4.1-flash`, `--thinking off` (grok-build still has no quota this session). Same book, same reused imported home, same 20-turn script, same investigator identity and backstory (Private Investigator, Drive Auto strong, tracking/investigation his trade, weak with a gun). Only the build changed: batch 9 plus SL-64.

New worktree `/Users/haoli/leehow/code/chatrpgv4-wt-sl29a-b10` (branch `claude/sl29a-b10-20260925`) at `9c63c2bd6`, six node_modules symlinks from `chatrpgv4-wt-pi-coc-v2` per the marker, built via `leehow-pc-tests`' `remote-test.sh build-fetch` (21s remote build, exit 0, clean). No confound: `ps aux` showed no other `driver.py`/opencode-go process running on this Mac at table-open time. `.pi/coc-agent/{auth.json,pipiui-settings.json,grok-build-models.json,models-store.json}` copied from `chatrpgv4-wt-integ-sl`; `models.json` deliberately **not** copied. The imported home was reused: `chatrpgv4-wt-pdf-a/.coc/playtests/sl29-a-run2/home` copied into `.coc/playtests/sl29a-b10/home`; 35 stale `.lock` files found across `.coc/locks`, `.coc/modules/{.registry.lock,book-1/*.lock}`, `.coc/campaigns/*/setup.lock`, `.coc/mods/jobs/*/review.lock`, `.coc/module-campaigns/*/modules/{.seed-book-1.lock,book-1/*.lock}` were removed before use. A NEW campaign, `sl29ab10-xuese-2036`, was created via the onboarding worker's `converse` action (title `血色公路`, no `.pdf` suffix; `module_id: book-1`, `start_scene: scene-prologue`, `guidance_key` read from the copied module's own `module.json`). Harness adapted from `29-book-a-b9/` as `29-book-a-b10/{worker.sh,start.sh,play.py,triage.py,script.md}` (script unmodified), with `29-book-a-b10/preregistration.md` written and committed (`0490f2dcf`, on `claude/integ-single-loop-20260923`) before the table opened. `triage.py` additionally fixed a latent bug inherited from batch-9's own copy (tool-call results only carry `result_text`, a JSON string — `t.get('result')` was always empty, so SL-59's `batch_person_applies` and the new SL-64 section would have silently read nothing); the fix was sanity-checked by running the corrected script read-only against batch-9's own recorded data first, which reproduced batch-9's published numbers exactly (`npc-ledger.json`: 1 entry; every non-卡尔 name refused `unknown_entity`) before this table's own data was ever read.

**Pre-table confirmation (SL-61).** `content/providers/model-corrections.json` present with `opencode-go/deepseek-v4.1-flash` and `deepseek-v4-flash` both `thinkingLevelMap.off: "off"`. After the setup daemon started, its `daemon.json` `model_confirmed.thinkingLevelMap.off` read `"off"`; this worktree's own `.pi/coc-agent/models.json` — absent before the table, never copied — was written by the product at host preparation carrying the `//`-comment provenance note naming the two corrected models; both confirmed again on the play daemon's own `daemon.json` before turn 1.

**Setup (live, `driver.py --launcher bin/pi-coc-setup`, run `sl29ab10-xuese-2036-setup-20260925T203710Z`, replaying batch-9's own recorded 5-turn exchange turn-for-turn, read from batch-9's `turn-{1..5}.json` sentences).** 5 turns, 94.6s total, 13 tool calls. Investigator name rendered **雷·卡特** in full this time (batch-9's setup truncated it to 雷·卡; model variance, not a product mechanism). Private Investigator, Drive Auto 50. **New finding (P3, see below): the confirmed card's `name` field is literally `"雷·卡特，"` — a trailing full-width comma baked into the name itself**, which then echoes into player-facing prose throughout the table.

**Table (`29-book-a-b10/play.py`, driver run `sl29ab10-xuese-2036-20260925T204000Z`, hybrid-v1, `PI_COC_JEV_PRESELECT=1`, `opencode-go/deepseek-v4.1-flash` thinking off).** 20/20 turns settled, 0 stranded, 91 tool calls (apply 34, look 16, resolve 13, narrate 13, lookup 11, recall 4), 91 Keeper provider calls (0 errors), admission max 13,002 ms (one row, t20, `review_pending` at its own `cap_ms: 13000` — the same marginal-miss shape as batches 8-9), `infer(bind)` = 0, 27 non-source `look`/`lookup` calls (lighter than batch-9's 45 — this Keeper committed to fewer research loops), 3 `lookup kind=source` calls (0 `reading_timeout` on any), speech 31 resolved / 16 unresolved, 0 sanity rolls (script does not reach one), 0 `refusal_budget` rows (batch-9 tripped it twice on the mint-refusal loop this fix removed — see below). Walls `[62, 37, 33, 34, 20, 37, 42, 71, 44, 37, 43, 47, 63, 66, 61, 35, 53, 57, 26, 88]`; median 43.3s, 14/20 ≤ 60s (70%), max 88.1s (t20, the same turn as the marginal admission miss). Model-call ms p50 4987, p90 9045.5, **zero calls over 45s**. `npc-ledger.json` entries: **4** (batch-9's whole run had exactly 1). Reading: 6 jobs raised (`read-1`..`read-6`, lighter than batch-9's 10), fork stayed at generation 2 (no advance this table — see the new P2 finding below), 5 `budget_input_tokens` refusals across 3 distinct jobs, all background, none reaching a foreground turn (0 `reading_timeout` anywhere in `turn-*.json`).

**Table (Scope 3), keyed to what SL-64 changed.**

| class | pre-registered line | measured | verdict |
| --- | --- | --- | --- |
| delivery | 20/20 with prose | 20/20 settled, 0 stranded, every turn delivered real Keeper prose | **pass** |
| wall | median ≤45s, ≥80% ≤60s | median 43.3s, 14/20 ≤60s (70%), max 88.1s — no turn waited on a `reading_timeout` | **marginal miss on the 80% line (70%); not compared to grok tables — model change, same caveat as batch-9** |
| routing | declared move lands or narrates honestly | one `apply` move raised all table: t4 `welcome-to-abattoir` (lands on first declaration, same as batch-9). No sub-location was entered as its own scene this table either — t13's move to `阿巴托尔镇主街` and t20's move to `阿巴托尔旅店` both refused `unknown_entity: not an identified scene` | **not a defect on its own — same Keeper-choice/pacing noise as batch-9, unrelated to SL-64** |
| admission | no row >12s | admission max 13.0s (t20, `review_pending`, `cap_ms: 13000`), 0 `review_timeout` | **marginal miss (1.0s over the line) — same shape as batches 8-9's own single capped row, not a new pattern** |
| binding | `infer(bind)` = 0 | 0 | pass |
| looks | ≤1/turn after first visit | 27 non-source `look`/`lookup` across 20 turns (lighter than batch-9's 45); 3 `lookup kind=source` counted separately, 0 `reading_timeout` | **fails the per-turn line on several turns (Keeper-style, not a product mechanism) — same as every prior batch** |
| prescreen | status per read; own allowance | `prepared` every read, 2-5 candidates as the graph's local roster grew, no fallback anywhere | pass |
| drops | every drop has a reason | `speech_steer`, `implicit_narrate_refused`, `text_beside_tool_calls`, `steered_leg_refused` rows seen, each with a reason; no stranded turn. Also seen (not a `lane:delivery` drop, a lower-level tool-execution skip): 7 `"The host did not execute this call."` responses across t13/t14(×2)/t15/t20(×2) — every one followed by the turn still delivering; not investigated further this batch (out of SL-64's scope) | pass on the class; the tool-skip pattern is noted, not scored |
| fiction/rules | no off-sheet skill; no push without declaration | all rolls (Navigate, Spot Hidden, Psychology, Appearance, Drive Auto, Listen, Charm) on 雷·卡特's own sheet | pass |
| stalls | none; provider errors listed | 0 provider `error` rows anywhere | pass |
| reading (PDF) | every read has a telemetry row and outcome | 6 reads (`read-1`..`read-6`) all carry purpose/focus/ms rows; fork stayed at generation 2 (no advance); 5 `budget_input_tokens` refusals (see finding below), 0 `reading_timeout` in any foreground turn | **new P2 finding, see below — not the same shape as batch-9's clean 0-refusal reading fork** |
| SL-58 (`prepare`-mode lookups get the answer allowance) | pending near the 8s allowance, not a 120,003ms block | 2 of 3 `source_mode: "prepare"` calls this table (t1 8003.8ms, t12 8000.8ms) returned `pending`; the third (t20) was one of the 7 host-skipped calls (`"The host did not execute this call."`, 0.1ms) rather than a genuine reading-service round-trip. None blocked past the allowance, none hit `reading_timeout` | **confirmed still fixed for the calls that executed** |
| SL-59 (batch npc/person effects land line by line) | receipt count = resolvable-effect count, not zero when ≥1 resolves | 10 multi-person `apply` batches this table; every one where at least one effect could resolve landed all of them (3-for-3 six times, 4-for-4 once, 6-for-6 once via a mixed batch); the one whole-batch refusal (t14, 3 shortened-name attempts, 0 receipts) had **nothing** resolvable in it (see SL-62 note below) — the same documented fallback-to-aggregate shape batch-9 already confirmed as correct | **confirmed still fixed** |
| SL-60 (dedicated `resumed` row) | a resumed job's row is dedicated, not only embedded | 0 displacements, 0 resumes this table (lighter reading load than batch-9) | **not exercised — same as batch-9, no contention this time either** |
| SL-61 (deepseek Keeper thinking off) | reasoning 0 on every call | 91 provider calls; `events.jsonl` carries 375 `"reasoning": 0"` occurrences and zero nonzero, 94 `"reasoning_effort": null`; p50 4987ms, p90 9045.5ms, 0 calls over 45s | **confirmed still fixed, live** |
| SL-62 (a person's name resolved before `unknown_entity`) | variant-name match resolves; genuine unknowns still refuse | t14: three shortened names (拉斯/内特/史蒂夫, dropping the surnames of three already-established 拉斯·威廉姆斯/内特·帕特森/史蒂夫·布朗) refused `unknown_entity` rather than resolving via the roster — the Keeper self-corrected in the same turn with the full names, which landed. This is a genuine variant-name shape SL-62 was meant to catch, but the `apply npc {to:}` gating path evidently does not consult the same resolution SL-62 wired for `person.who`/`resolve` — the turn still delivered, so this is a soft miss, not a stranded turn | **partial miss — first variant-name shape this line has seen since SL-62 landed; not investigated further (measurement only)** |
| SL-63 (refusal-budget abort still delivers) | a runaway abort still delivers | 0 `reason: "refusal_budget"` rows this table (batch-9 had 2, both tripped by repeated mint refusals on 霍默/马瑟) | **not exercised — plausibly a downstream consequence of SL-64 removing the repeated-refusal loop that tripped it in batch-9 (see Findings)** |
| **SL-64 (this batch's primary target)** | **every distinct table person the Keeper introduces mints; zero `unknown_entity` refusals whose cause is an existing table person** | **`npc-ledger.json`: 4 entries (3 `from_passage` — 拉斯·威廉姆斯/内特·帕特森/史蒂夫·布朗, all established at t1 from the scene's own carried text naming all three; 1 table-invented — 柜台后的女人, minted at t14 via a plain `apply npc {to: "here"}` with zero `from_passage` field, while 3 table persons already existed in the roster). Zero `unknown_entity` refusals anywhere in the table cited an existing table person as the reason a genuinely new name was blocked — every refusal that did occur (拉斯/内特/史蒂夫 shortened names, an actor-role schema mismatch, two unregistered-scene moves, one `look npc` on a never-established name) was for an unrelated reason (see the class rows above and Findings)** | **confirmed fixed, live — the exact defect shape from batch-9 (a second book-absent name refused solely because the roster was non-empty) did not recur once, with a clean opportunity to recur (3 table persons already on the roster) that batch-9 failed on every single time** |

**Findings, one root cause each**

- **SL-64, confirmed fixed live — the clean confirmation the ticket asked for.** Turn 14's `apply {effects: [{kind: "npc", name: "柜台后的女人", to: "here", ...}, ...]}` landed whole (`receipts: ["npc:t14-c4", "npc:t14-c4-2", "npc:t14-c4-3", "npc:t14-c4-4"]`, no `not_landed`) while `world.table_people` already held 拉斯·威廉姆斯, 内特·帕特森 and 史蒂夫·布朗 from t1. Pre-fix (`kernel-ts/apply/entities.ts`'s `personOfEffect` reading `graph.candidates(name, ['npc']).length` with the roster folded in), this exact call would have refused `unknown_entity` with `candidates: ["拉斯·威廉姆斯", "内特·帕特森", "史蒂夫·布朗"]` — precisely batch-9's own reproduced shape (t11/t14/t15/t17/t18, always the same "candidates" list regardless of the attempted name). Instead it minted cleanly, and the ledger closed the table with 4 entries instead of batch-9's 1. Evidence: `.coc/playtests/sl29ab10-xuese-2036-20260925T204000Z/turn-14.json` (`tools[].name==="apply"`, the fourth `apply` call in that turn); `.coc/playtests/sl29a-b10/home/.coc/campaigns/sl29ab10-xuese-2036/world.json` (`table_people[3]`, no `from_passage` field, `established_at: "2026-09-25T20:51:13Z"`); `.coc/playtests/sl29a-b10/home/.coc/campaigns/sl29ab10-xuese-2036/npc-ledger.json` (4 top-level handles: `npc-table-{47b0a741fc317a87ec3f,0d8183e4b3437fdc70e6,1167f365d30cd0094cc1,e508efedee80c60048be}`).
- **Finding 2 (new, P2, reading pipeline) — the campaign's own reading fork hit `budget_input_tokens` 5 times across 3 distinct background jobs, and never advanced past generation 2 this table.** `read-1` (purpose `index`, the background skeleton job SL-53's own success line targets) refused twice (267.9s and 248.4s elapsed before refusal); `read-2` (purpose `detail`, focus `welcome-to-abattoir`, an in-play deepen read — SL-41's own target) refused twice (479.6s, 392.2s); `read-4` (purpose `detail`, focus `阿巴托尔`) refused once (282.1s). All five are background jobs; none blocked a foreground turn (0 `reading_timeout` in any `turn-*.json`, confirmed by direct grep), so delivery was unaffected — the base graph's own cached material (from the reused import, already at generation 2) was sufficient for all 20 turns. But this deviates from batch-9's own clean reading fork (0 `budget_input_tokens` refusals, "SL-53 holds, fifth table running") and from SL-41's stated success line ("no `provider_refused` with `reason: budget_input_tokens` on any in-play `detail`/`answer` read"). Whether this is model-specific (deepseek's own token accounting differs from grok's), book-state-specific (this fork's own accumulated generation-2 content is larger than batch-9's fresh fork was), or a genuine regression was not investigated — measurement only, this batch. Evidence: `.coc/playtests/sl29a-b10/home/.coc/reading-telemetry.jsonl` (5 rows with `refusal: "budget_input_tokens"`, paired `event: "provider_refused"` rows, job ids `read-1`×2/`read-2`×2/`read-4`×1); `.coc/playtests/sl29a-b10/home/.coc/module-campaigns/sl29ab10-xuese-2036/modules/book-1/generations/` (only `generation-2-8bf9c59356844d25a0f9dd32704b35eb` present, no generation-3 directory).
- **Finding 3 (new, P3, cosmetic but systemic) — a name-selection range off-by-one baked the setup sentence's trailing punctuation into the investigator's own name.** Turn 4 of setup, `create-investigator`'s `profile.name` was `{source: "input:4:3", range: {first: "input:4:3/u:30", last: "input:4:3/u:34"}}` against the player's sentence "别人常找我跟丢了的人的线索，追踪失踪人口是我的老本行。**名字叫雷·卡特，**现在就做卡吧。" — counting grapheme units from 0, unit 30 is `雷`, 33 is `特` (the name's own last character), and **34 is `，`** (the full-width comma that follows the name in the sentence). The range's `last` boundary is one grapheme past the name itself, so the confirmed card's `name` field is literally `"雷·卡特，"` (verified directly in `party/investigator.json`). This is not cosmetic-only: the malformed name is the canonical stored identity and echoes into every mechanical reference to the investigator for the rest of the campaign (`resolve` calls' `actor`/`target` fields) and into player-facing rendered prose at least three times (`turn-3.json`, `turn-9.json`, `turn-10.json` all carry the literal string `雷·卡特，` inside `narrate`'s `rendered_text`). Not seen in batches 4-9 because none of their setup transcripts happened to have trailing punctuation immediately after the stated name at the exact grapheme position the range mechanism selected — this looks like a pre-existing off-by-one in the range-to-substring conversion, newly exercised by this table's own setup wording, not something SL-64 touched. Evidence: `.coc/playtests/sl29ab10-xuese-2036-setup-20260925T203710Z/turn-4.json` (the `create-investigator` tool call's `args.profile.name`); `.coc/playtests/sl29a-b10/home/.coc/campaigns/sl29ab10-xuese-2036/party/investigator.json` (`name: "雷·卡特，"`); `.coc/playtests/sl29ab10-xuese-2036-20260925T204000Z/turn-{3,9,10}.json` (`tools[].name==="narrate"`, `result_text` containing the literal string).
- **SL-58, confirmed still fixed for the calls that executed (see table row above).** Evidence: `.coc/playtests/sl29ab10-xuese-2036-20260925T204000Z/turn-{1,12}.json` (`tools[].name==="lookup"`, `args.source_mode==="prepare"`, `ms` `8003.8`/`8000.8`, `result_text` carrying `"status":"pending"`).
- **SL-59, confirmed still fixed (see table row above and SL-64 finding).** Evidence: `.coc/playtests/sl29ab10-xuese-2036-20260925T204000Z/turn-{1,8,14,15,17}.json` (multi-effect `apply` calls, receipt counts matching resolvable-effect counts).
- **SL-61, confirmed still fixed live (see table row above).** Evidence: `.coc/playtests/sl29ab10-xuese-2036-20260925T204000Z/events.jsonl` (375×`"reasoning": 0`, 0 nonzero, 94×`"reasoning_effort": null`); `.coc/playtests/sl29ab10-xuese-2036-{setup-20260925T203710Z,20260925T204000Z}/daemon.json` (both `model_confirmed.thinkingLevelMap.off: "off"`); `.pi/coc-agent/models.json` (product-written, present only after the setup daemon started).
- **SL-60, not exercised (see table row above).** No slot contention this table (lighter reading load than batch-9: 6 jobs raised versus 10, 0 displacements versus batch-9's 6). Evidence: `.coc/playtests/sl29a-b10/home/.coc/reading-telemetry.jsonl` (0 `event: "displaced"` or `"resumed"` rows).
- **SL-62, partial miss, new observation (see table row above).** The first live variant-name shape this line has been exercised against since SL-62 landed: three shortened names of already-established table persons refused instead of resolving via the roster. Not investigated further (measurement only, and the turn still delivered via the Keeper's own self-correction). Evidence: `.coc/playtests/sl29ab10-xuese-2036-20260925T204000Z/turn-14.json` (the `apply` call naming 拉斯/内特/史蒂夫, `result_text` carrying `unknown_entity` and `candidates: ["拉斯·威廉姆斯","内特·帕特森","史蒂夫·布朗"]`, immediately followed by a second `apply` in the same turn with the full names that landed).
- **SL-63, not exercised (see table row above) — plausibly downstream of the SL-64 fix.** Batch-9's two `refusal_budget` trips were both caused by the mint-refusal loop (repeated `unknown_entity` on the same new name) that SL-64 now resolves on the first attempt instead of the fourth. This table never repeated an identical refusal three times, so the three-strikes gate never fired. Not confirmed as causal (measurement only), but consistent.

**Comparison with batch-9's own findings.**
- **Fixed:** the batch-9 P1 finding itself (once one table-established NPC exists, every subsequent brand-new name refuses `unknown_entity` instead of minting) — confirmed fixed above, live, with the exact reproduction shape (3 established persons, a 4th genuinely new name) that batch-9 failed on five separate times.
- **Held:** SL-58, SL-59, SL-61 all confirmed still fixed on this build, same as batch-9 reported them.
- **New:** Finding 2 (background reading-lease exhaustion, 5 `budget_input_tokens` refusals, 0 generation advance) — not seen in batch-9's clean reading fork; Finding 3 (name-range off-by-one) — not seen in any prior batch, first table where the setup sentence happened to place punctuation at the selected range boundary. Both are unrelated to SL-64 and to each other.
- **Newly observed, not new defects:** the SL-62 partial miss (a shortened-name variant of an established person refusing instead of resolving) — the first table to exercise a real variant-name shape since SL-62 landed, surfaced only because this table now has more than one distinct established table person's exact-vs-shortened naming to test against, itself a downstream benefit of SL-64 landing.

Evidence (git-ignored, kept per the marker):
- setup: `/Users/haoli/leehow/code/chatrpgv4-wt-sl29a-b10/.coc/playtests/sl29ab10-xuese-2036-setup-20260925T203710Z/`
- table: playtest `/Users/haoli/leehow/code/chatrpgv4-wt-sl29a-b10/.coc/playtests/sl29ab10-xuese-2036-20260925T204000Z/` (turn-{1..20}.json, driver.log, events.jsonl, daemon.json, heartbeat.json)
- campaign: `/Users/haoli/leehow/code/chatrpgv4-wt-sl29a-b10/.coc/playtests/sl29a-b10/home/.coc/campaigns/sl29ab10-xuese-2036/` (turns/0000-0020.json, telemetry.jsonl, campaign.json, npc-ledger.json, world.json, party/investigator.json)
- campaign fork (kept, not deleted): `/Users/haoli/leehow/code/chatrpgv4-wt-sl29a-b10/.coc/playtests/sl29a-b10/home/.coc/module-campaigns/sl29ab10-xuese-2036/modules/book-1/` (`deepen-queue.json` read-1..6; `generations/generation-2-8bf9c59356844d25a0f9dd32704b35eb`)
- reading telemetry (budget/refusal rows): `/Users/haoli/leehow/code/chatrpgv4-wt-sl29a-b10/.coc/playtests/sl29a-b10/home/.coc/reading-telemetry.jsonl`
- agent home model confirmation: `/Users/haoli/leehow/code/chatrpgv4-wt-sl29a-b10/.pi/coc-agent/models.json` (gitignored, product-written; not printed here beyond what's quoted above)
- triage: `/Users/haoli/leehow/code/chatrpgv4-wt-sl29a-b10/.coc/playtests/sl29a-b10/triage.txt`
- harness (this branch only, originals under `29-book-a-b9/` untouched): `docs/specs/pi-native-single-loop-tickets/29-book-a-b10/{worker.sh,start.sh,play.py,triage.py,script.md,preregistration.md}` (also present, for the harness's own relative-path requirement, in `chatrpgv4-wt-sl29a-b10`'s own working tree, uncommitted there)
- pre-registration commit: `0490f2dcf` (before the table opened)
- per-turn prose (not committed, carries book-derived text): `/Users/haoli/leehow/code/chatrpgv4-wt-sl29a-b10/.coc/playtests/sl29a-b10/turns.log`
