# Read a pictured handout in the player's language — tickets

Parent: [visual-handout-translation.md](visual-handout-translation.md). Owner request 2026-09-29: a translate button on PDF clippings, for any module language and any play language.

Order: VT-01 first (it touches the same lane key); VT-02 and VT-03 in parallel; VT-04 after both; VT-05 closes.

---

## VT-01: settle the handouts lane on image-only rows

Status: done (merged; contract §155.10)

**What was built.** The loop was real, seen live in the installed App (a `handouts` worker respawn every 4-8 s on a campaign holding two image-only clippings) and reproduced on the real host path: one board read started 5 lane runs before the test's re-read cap stopped it, and the title never reached the play language. The host now hands the lane the row names no file carries (`handout_names`), and `prepareHandoutPresentation` joins them to the file rows.

**Acceptance.**
- [x] Before/after run counts on the real host path: 5+ (one per re-read, unbounded) before, 1 after, with 0 for the re-read its landing causes (`coc-handout-lane.test.ts`).
- [x] A test whose lane mock resolves fails on the loop and passes on the fix (mutation-checked: host, presentation layer and onboarding key each reverted in turn).
- [x] An image handout's title reaches the play language through the lane.

## VT-02 + VT-03: read a delivered image handout in the play language, streamed

Status: done (contract §155.1-§155.5, §155.9)

The two tickets became one when the owner asked for streaming (2026-09-29): a transcription step and a projection step, each a tool-enabled child, measured about 35 s before the first character (21-22 s + 11-13 s on `grok-build/grok-4.5`), and a tool-enabled child writes its answer in one file write. The shipped shape is one zero-tool vision completion that streams the reading (§155.3, §155.9).

**Acceptance.**
- [x] Host method `handout.reading`; the gates of `handoutImage` shared through `handoutImageFile`; an undelivered handout, a keeper-only one, one outside the campaign or module roots, a symlink escape and a wrong magic byte are each refused (`coc-handout-images.test.ts`, `coc-handout-reading.test.ts`).
- [x] A cost row per model round (model, effort, wall time, tokens) in `telemetry.jsonl`; time measured on the two Dust to Dust clippings (see Comments).
- [x] A text-only table model refuses with `model_without_images` before any child starts; a cached reading needs none.
- [x] `keep` is the model's verdict; no code inspects a script (`handout-reading.test.mjs`, the worker test).
- [x] The reading is reported while it is written (several growing states before the child ends), reused from the cache by digest, tag and instruction; a changed instruction re-reads.
- [x] The names the table already uses reach the brief.

## VT-04: the control on the row and on the board

Status: done

**Acceptance.**
- [x] The control renders on image handout rows only, in the transcript (`pipicoc/mechanics.js`) and on the case board (`pipicoc/board.js`); the transcript gets a host-call path (`onInvoke`, §155.8); states pending, failed with retry, already in your language, ready with an original / reading toggle.
- [x] Words are data: the `handout` surface and two `errors` codes, projected; no CJK in the renderers.
- [x] The reading appears as it is written (400 ms polls of the job's partial reading).
- [ ] Reopening the App: a row asks again when pressed and the disk cache answers without a model run (it does not ask on mount, so that scrolling starts no job).

## VT-05: acceptance on the installed App

Status: owed

**Acceptance.**
- [ ] On an `en` campaign of Dust to Dust (a zh module), the main session plays as the player and reads both newspaper clippings through the button in the transcript and on the case board.
- [ ] On a `zh-Hans` campaign of an English PDF module, the same, with an English clipping.
- [ ] The evidence (campaign ids, telemetry rows, screenshots) is recorded under `## Comments`.

## Comments

2026-09-29, host path with a real model (not the installed App): the built worker with a real `pi` child and `grok-build/grok-4.5`, on the two Dust to Dust clippings copied from the installed App's module work folder. First version (two steps, since replaced): clipping 1 to `en` 22 s + 11 s, faithful English with the cropped headline marked `[…]`; the same clipping to `zh-Hans` answered `keep` from the cached transcription in 6 s; clipping 2 to `en` 21 s + 13 s.
