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
