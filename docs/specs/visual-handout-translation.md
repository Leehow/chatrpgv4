# Read a pictured handout in the player's language

Status: implemented on branch `claude/visual-handout-translation-20260929` (contract §155, streamed one-step design after the owner's 2026-09-29 ruling); installed-App acceptance (VT-05) still owed. Tickets: [visual-handout-translation-tickets.md](visual-handout-translation-tickets.md).
Date: 2026-09-29
Baseline inspected: 0.9.6a at beafa3019.
Related contract: §152.3 (image handouts reach the player), §23 / §80 (presentation lanes; module summaries are Keeper material), the Mod document reading version (§ "Projection is host presentation", `extensions/mods/document-presentation.ts`), §35.1 (host controls with no kernel RPC), §37.10.1 (image reading stays on a vision model), §39.2 (map words).

## Owner request (2026-09-29)

> 剪报这里应该有个翻译按钮，点击能翻译成玩家语言，这个是中文，如果是非中文玩家不就看不懂了么，或者其他语言的模组

## Problem

A handout cropped from a PDF page reaches the player as the original bitmap (§152.3), and nothing else. On the Dust to Dust table the clipping 「盗墓贼又光顾马丁滩啦！」 is Chinese pixels; a player whose `play_language` is anything else gets an image they cannot read. The same holds for an English, French or German module read by a Chinese player.

Where it breaks:

- **No text layer exists.** The visual reader is told not to transcribe pictured text; the host copies pixels (`content/setup/visual-assets.md:9-12`). The graph node's `summary` is a short Keeper-side identifier in the source language (§80), never shown to the player.
- **The handouts lane cannot see it.** It projects only `<campaign>/handouts/*.md` (`extensions/module/character-presentation.ts:249-263`). An image-only handout writes no `.md` (`kernel-ts/apply/entities.ts:360-369`), so its body, and even its title, are never projected.
- **Probable side effect, unverified:** the lane's collector counts the image row's name as missing, but the lane's input can never supply it, so every sheet or board read may start the lane again (`character-presentation.ts:234-240` vs `:253`; `Electron/packages/pi-backend/src/index.ts:10119-10143`). This has to be settled before a new lane is hung on the same key.
- **Map bitmaps have the same gap in a milder form.** §39.2 projects the captions (title, region and level labels), so a map is usable, but words printed on the bitmap (「To Arkham & Kingsport」 on the village map) stay in the source language.

## Solution

A **translate** control on every image handout row, in the transcript and on the case board. It is always shown: whether the handout is already in the player's language is decided by the model (`keep`), never by code. Pressing it:

1. **Reads the picture in one streamed vision completion** (owner ruling 2026-09-29, after the first version, a transcription step and a projection step, measured ~35 s before the first character). A Pi child with no tools is shown the delivered image as an attachment and writes the reading version in the play language: a `keep` or `translate` verdict on the first line, then the title, then the body, with `[…]` for anything it cannot read. The host relays what it has written so far, so the player watches the text arrive; the result is cached by the image's `asset_digest`, the play language and the instruction file's digest. It is presentation material for the player's own reading, never written to the graph and never shown to the Keeper.
2. **Names as the table knows them.** The brief carries the campaign's saved projections for the play language (people, places, clues), so a person the table already calls by a name keeps it.
3. **Shows it beside the original.** The row gets an original / reading toggle. The picture stays; the reading version appears in the row's existing body slot, growing while it is written. Pending, failed-with-retry and "already in your language" are visible states. Nothing about it is silent.

## Decisions

- **Only what the player holds.** Only handouts in `world.handouts_shown` that were delivered, with the same scope, visibility and byte checks as `handoutImage` (§152.3). No new reveal. A clipping the table has not handed over cannot be read through this control.
- **No turn, no receipt, no kernel RPC.** It is a host control (§35.1), like zoom. It answers within the 15 s invoke ceiling with `pending` (and the reading so far), and the renderers ask again every 400 ms. The Keeper does not see the result; making it Keeper-visible later needs its own named lane.
- **One step, the table's vision model.** Reading a picture needs image input (§37.10.1: the table's vision model; `model_without_images` when there is none), at the presentation lane's effort. The fast-model setting today has no vision check, and a child that is handed a picture on a text-only model writes plausible text from nothing; the reading refuses instead.
- **A zero-tool completion, by ruling.** Agents.md reserves those for short output on the critical path and asks before any other. The owner chose this shape in the turn that asked for streaming (2026-09-29); the reasons and the limits are contract §155.9. A tool-enabled child writes its answer in one file write and cannot stream.
- **Honest source.** The text is model-produced reading text, not a verbatim source reference (`docs/specs/verbatim-source-references.md`). It is labelled as a reading version, and the original image stays one tap away.
- **Words are data.** Captions and error codes live in `content/ui/en/*.json` and are projected like every other UI word; no language text in `pipicoc/*.js` or the host.
- **The handouts lane settles on image-only rows (VT-01).** An image-only handout's title reaches the play language through the handouts lane, which is now given the titles no file carries (§155.10). Found live in the installed App: the lane was respawning every 4-8 s on such a campaign.

## Out of scope

- Re-drawing the image with translated text (image editing). The reading version is text beside the picture.
- Reading at publication or delivery time for every visual asset. It is on demand; pre-warming at delivery can be measured later.
- Words printed on map bitmaps. The captions already carry the places; bitmap words are a possible follow-up using the same streamed reading.
- Duplicate handout nodes for one printed card (cards #1–#5 of Dust to Dust have two or three nodes each). That is the publication-identity work in `session-maps-tickets/92-one-living-map-per-place.md`.
