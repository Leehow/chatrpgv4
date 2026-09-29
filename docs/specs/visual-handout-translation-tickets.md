# Read a pictured handout in the player's language — tickets

Parent: [visual-handout-translation.md](visual-handout-translation.md). Owner request 2026-09-29: a translate button on PDF clippings, for any module language and any play language.

Order: VT-01 first (it touches the same lane key); VT-02 and VT-03 in parallel; VT-04 after both; VT-05 closes.

---

## VT-01: settle the handouts lane on image-only rows

Status: needs-triage

**What to build.** Research reading (not run) suggests a respawn loop. `handoutTexts(view)` adds an image-only row's `name` to the handouts lane's wanted words (`extensions/module/character-presentation.ts:234-240`), while the lane reads only `.md` files (`:253`), so the word can never be supplied. `laneProjection` reports it missing on every sheet or board read and starts the lane again (`Electron/packages/pi-backend/src/index.ts:10119-10143`), which then emits `sheet_changed` and triggers another read. Prove or disprove it on a real table that holds an image handout (the Dust to Dust campaign holds two). If real, give an image-only row's title a lane that can actually produce it: the title is a handout title, so it belongs to this feature's projection (VT-03) or to the handouts lane's input, not to a word that is wanted forever.

**Acceptance.**
- [ ] Telemetry or a test on the real host path shows how many `handouts` lane runs one board read of an image-handout table starts, before and after.
- [ ] A test whose lane mock resolves (the existing one never resolves) fails on the loop and passes on the fix.
- [ ] An image handout's title reaches the play language or is recorded as owed; it is never silently wanted forever.

## VT-02: transcribe a delivered image handout, once per image

Status: needs-triage

**What to build.**
- **Host method.** A `coc-keeper` host method (hot `pipicoc/board.ts` handlers and cold `Electron/packages/pi-backend/src/index.ts` dispatch), `handout.reading {campaign, handout}`. It resolves the image with `handoutImage`'s gates: delivered, in `world.handouts_shown`, in scope, magic bytes matching, and under the display cap.
- **Background job.** It starts one job per `asset_digest`: a tool-enabled Pi reader on the reader axis (vision-capable, §37.10.1) with a dedicated instruction file (`content/setup/handout-transcription.md`) and a checker.
- **The transcription.** The job writes the printed text as it stands, in reading order, with its structure (headline, deck, byline, body paragraphs, captions), and marks what is illegible. It adds nothing, interprets nothing, and never uses the graph's `summary`.
- **Cache.** The result lives under a home-level cache keyed by digest and instruction digest, and is never written into the graph or a turn.
- **Answer shape.** The method answers `{pending:true}` at once, or the finished reading.
- **Refusals.** A model without image input refuses with `model_without_images`; nothing is transcribed blind.

**Acceptance.**
- [ ] Two campaigns holding the same clipping share one transcription (one reader run).
- [ ] An undelivered handout, a keeper-only one, one outside the campaign or module roots, a symlink escape, and a wrong magic byte are each refused. A test drives each one.
- [ ] The job's cost (model, rounds, tokens, wall time) is on a telemetry row. Transcription time on the two Dust to Dust clippings is measured and reported.
- [ ] A reader session on a text-only model refuses rather than answering from nothing.

## VT-03: project the transcription into the play language, as one document

Status: needs-triage

**What to build.** Project the transcription through the existing presentation protocol (`keep` / `translate`, checker, retries). The whole transcription is one source string, under a dedicated instruction file (`content/setup/handout-reading.md`: period voice, names as the table already calls them, nothing added, structure kept). The model choice is the presentation lane's (`cocFastLane`). Results are cached by digest, tag and instruction digest (the Mod document reading-version pattern, `extensions/mods/document-presentation.ts`). `keep` means already in the play language, and the UI says so.

**Acceptance.**
- [ ] A zh clipping for an `en` table and an en clipping for a `zh-Hans` table each produce a reading version. The same clipping for a `zh-Hans` table answers `keep`. No code inspects the text's script.
- [ ] People and places the table already knows are rendered with the table's names (§23 standing names).
- [ ] A changed instruction file re-projects; an unchanged one reuses the cache.

## VT-04: the control on the row and on the board

Status: needs-triage

**What to build.**
- **The control.** An image handout row gets a translate control and an original / reading toggle, both in the transcript (`pipicoc/mechanics.js` `MapRow` for handouts) and on the case board (`pipicoc/board.js`). Neither renderer can call the host from a row today, so a host-call path has to be added (the sheet panel's `api.invoke` and the illustration action are the precedents).
- **States.** Pending, failed with retry, and "already in your language" are visible.
- **Layout.** The reading version sits in the row's body slot under the picture; the picture is never replaced.
- **Words.** Captions and error codes live in `content/ui/en/*.json` and are projected; there are no CJK literals in code, and the guard test stays green.

**Acceptance.**
- [ ] UI tests: the control renders on image handout rows only; pending → ready → toggle; failure → retry; `keep` state.
- [ ] Reopening the App shows a finished reading without another model run.

## VT-05: acceptance on the installed App

Status: needs-triage

**Acceptance.**
- [ ] On an `en` campaign of Dust to Dust (a zh module), the main session plays as the player and reads both newspaper clippings through the button in the transcript and on the board.
- [ ] On a `zh-Hans` campaign of an English PDF module, the same, with an English clipping.
- [ ] The evidence (campaign ids, telemetry rows, screenshots) is recorded under `## Comments`.

## Comments
