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
