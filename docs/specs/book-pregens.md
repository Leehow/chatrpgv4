# A book's pregenerated investigators are offered

Status: BP-01..BP-04 implemented in the continuation integration; BP-05 live source verification pending; BP-06..BP-08 deferred.

Contract: `docs/kernel-rpc.md` §207. Amends §21.2, §21.5, §22.2's `material`, §22.3's review, §151.3's claim check and §174.3.

**Intent.** A player who asks to play one of the book's own pregenerated investigators gets them offered and seated, for a
book imported from a PDF as for a starter. Success: on Cold Harvest, `browse-library` lists the eight investigators of
Appendix A with their pages, and loading one seats a card whose every number is the page's. Hollow: a hand-written pregens
folder for Cold Harvest; a contract with no producer; numbers that look right but nobody compared with the page; a fix
that covers only starters, or only this book.

## 1. What went wrong (evidence)

- **The ask.** 2026-10-08 14:49Z, campaign `game-fcf25166-…` on Cold Harvest (`book-2`, a translated PDF): the player said
  「用模组里的预设调查员吧」; setup's `browse-library` returned `investigators: []`; the guide answered
  「我这里没有找到可直接选用的预设调查员」.
- **The book.** §2 (p9): 「几个预设调查员卡可以在附录 A 找到」. Appendix A (pp38–42): 「提前为玩家准备了 8 个预设角色」 — Timur
  Yarov, Leonid Macinko, Katya Shemkov, Alexsandr Bure, Zhores Zamyatin, Mikhail Akhmerov, Nikita Ghukov and Maxim Kravchuk.
  Each has an English stat block printed **as a raster picture** beside a Chinese background in text. The native
  text and the stored page transcript (§191) carry the backgrounds and none of the numbers.
- **What `browse-library` reads.** `investigator.list` reads `.coc/investigators/` only (§21.1): cards saved from earlier
  campaigns. A module's pregens never reach it, not even a starter's: `content/starters/<id>/pregens/<id>/character.json`
  is read only by `campaign.create {pregen}` (the driver's `--pregen`), which refuses any module that is not a starter
  (`pregens exist only for starters`). The App's setup creates the campaign first and browses after, so it could offer
  no pregen of any book.
- **What the reading lane already does.** It sees the appendix. Detail readings `read-43`, `read-44` and `read-47` opened
  pp38–40 and generation 75 holds Timur Yarov and Leonid Macinko as `npc` nodes with `mechanics.profile` numbers read off
  the pictures; Bure, Akhmerov, Ghukov and Kravchuk as `npc` nodes without numbers; and `location-timur-yarov`,
  `location-leonid-macinko`, `location-zhores-yevgenovich-zamyatin` with no properties. Yarov's profile matches the
  page's characteristics and skills, and drops the printed Luck 50 and DB 0. The closed node kind `investigator-template`
  is in the graph contract (v3) and the lookups already rank it last with `TEMPLATE_NOTE`, but no reader instruction names
  it, no shape gives it a sheet, and nothing reads one.

So there are two system gaps: no producer of a book's pregens (the reader writes them as people), and no consumer that
offers any module's pregens in setup. Neither is a Cold Harvest gap.

## 2. Decisions

1. **The record is an `investigator-template` node with `properties.sheet`** in the starter pregens' shape (§174.1's
   schema): what the sheet prints and nothing else. A stat block is not a person (§17.2), and the Keeper never plays a
   pregen; writing them as `npc` is the defect memory "validator checks accounting, not content" already recorded on the
   older pipeline (four pregen sections of which three were extracted as NPCs: every number true, every category wrong,
   invisible to every per-field check). The cure there and here is the pipeline's own kind, not a list of names.
2. **The shape is `properties.sheet`, not `mechanics.profile` on a template.** The deliverable is a character.json-shaped
   card, and what the reviewer checks should be what the player gets: one shape end to end, no projection between the
   reviewed numbers and the loaded ones. The numeric parts reuse the shared validators (skill names through §136.4's
   `nameResolves`, weapons through §136's weapon shape, DB through the ruleset's damage-bonus table).
3. **Accounting, not content.** No sheet key is required and no value is judged plausible; nothing is computed (no half or
   fifth values, no HP from CON+SIZ, no DB from STR+SIZ, no Luck from the rules) and nothing is filled. The provenance that
   replaces a required-field list (the memory's second lesson: relaxing a constraint without provenance turns silent
   deletion into silent fabrication) is per number: every leaf of the sheet's numbers is a review pointer, strict.
4. **The check is the existing reader/reviewer machinery.** A pregen sheet is drafted by the visual reader and checked by
   a fresh reviewer that opens the page, like any record (§22.3). What changes is only which pointers are owed and how a
   verdict counts: every leaf of `sheet.age`, `characteristics`, `derived`, `skills`, `weapons` and `cash` is owed under
   either review policy, never folded into the record's root, and never advisory — §192.1's `distinct_from` and §199.2's
   person statements are the precedent (a statement the table will act on as fact is not a "parameter difference"). A
   deterministic "the number is in the page text" check cannot work here: Cold Harvest prints the numbers as pictures.
5. **Jev never clears a sheet.** §151.3's claim check reads native text; the numbers are on the page image.
6. **The producer is a `pregens` material reading, read on demand, once per book.** The player asked: `browse-library`
   is the demand, so the setup host asks for the reading before listing (foreground, within the setup wait), and a
   material row settles it for the book (an empty one when the book prints none). Not a background read at preparation:
   §182 forbids reading what publishes nothing, and most books print no pregens. The record rule itself is in `read.md`,
   so any reading that meets a pregen (an answer about "Timur", a scene's detail read) writes the template, not a person.
7. **The offering covers starters too.** `investigator.list {campaign}` lists the campaign's module's pregens: a starter's
   `pregens/` folders, any other module's templates. `investigator.load {campaign, pregen}` seats one. The Haunting's two
   pregens reach `browse-library` for the first time.
8. **The book's numbers stay as printed, and loading never blocks on the budget** (owner 2026-10-08, relayed for S10:
   「超预算不用管，不要阻塞」). `investigator.load` computes no budget; `pregen` is a seated receipt source, so
   `setup.complete` skips the completeness and confirmation checks as it does for a library card or a template (§174.3).
   The owner dropped S10's arithmetic/display item; this slice neither computes nor displays a budget.

## 3. Tickets

### BP-01 The record and its review

Status: implemented; integrated focused/all verification pending

- `kernel-ts/modules/pregen-sheet.ts`: `pregenSheetRefusals(sheet, rules, at)` — keys, types, characteristic and derived
  keys, skills resolving, weapons through the shared weapon shape, DB through the damage-bonus table.
- `checkSourceDraft` (`kernel-ts/modules/visual.ts`): `properties.sheet` only on `investigator-template` (`sheet_kind`); the
  shape; a sheet cites viewed pages; loose numbers on a template refused (`sheet_outside_seat`); the sheet pointers added to
  `required_review` under either policy (`sheetReviewPaths`, `kernel-ts/modules/sheet-review.ts`).
- `sheetReviewPath(path)` in `review-verdicts.ts`, read by `checkReview` (kernel), `reviewGroups` and `gateRefusal` (host):
  never folded, never advisory.
- Reviewer brief: `content/setup/visual-reader/review.md` and the unit brief `SHEET_REVIEW` (`reader-review.ts`).
- `claimSupportIneligibility` → `"sheet"`.
- Reader rule: `content/setup/visual-reader/read.md`, "Pregenerated investigators".

### BP-02 The `pregens` material reading

Status: implemented; integrated focused/all verification pending

- `module.read.request {purpose: "detail", material: "pregens"}`: the kernel's own focus and question
  (`PREGENS_FOCUS`, `PREGENS_QUESTION`); ready on a settled `material: "pregens"` row; the draft holds only templates with
  a sheet, all in `ready_nodes`, no claims; an empty draft is the answer "none printed".
- `visualReaderFiles(phase, purpose, material)` adds `pregens.md` for that reading.
- `ReadingService.pregens(mid, params, signal, options)`: the foreground `ensure` of that material.

### BP-03 Offering and loading

Status: implemented; integrated focused/all verification pending

- `investigator.list {campaign?}` → `pregens`, `pregens_read`.
- `investigator.load {campaign, pregen, as?}`; receipt source `pregen`; seated in `setup.complete` / `setup.steps`.

### BP-04 Setup wiring

Status: implemented; integrated focused/all verification pending

- `content/setup/steps.json`: `browse-library` takes `campaign`, its line names `pregens`; `load-investigator` takes
  `library_id` or `pregen`.
- `extensions/onboarding/index.ts`: `investigator.list` is never cached; when it answers `pregens_read: "unread"`, the host
  asks `reading.pregens` and lists again.

### BP-05 Cold Harvest through the pipeline

Status: live verification pending

- `experiments/book-pregens/cold-harvest.mjs`: a `cp -c` clone of the App's library, this worktree's kernel and host, live
  reader and reviewer children on the model the App's readings ran on today (`openai-codex/gpt-6-luna`, thinking low);
  then a scratch campaign, `investigator.list` and `investigator.load` on the clone. The App is never written.

### BP-06 Published pregens that are people

Status: needs-triage

Generation 75 of Cold Harvest keeps Yarov, Macinko, Bure, Akhmerov, Ghukov and Kravchuk as `npc` nodes and three
`location-*` nodes for pregens. A pregens reading adds templates beside them; nothing re-kinds or retires the copies, so the
Keeper's graph has both (and §199.1 shows the epithet lane wording an npc from Timur's role). A repair needs the §192.5
shape: a reviewed verdict that a published npc is the template's person, then the npc retired. Not done here.

### BP-07 An independent second transcription of the numbers

Status: needs-triage

§199.2 found the record reviewer sharing the author's misreading of a sentence. Numbers are a closed comparison, so a
blind second reader (shown the sheet's pages and the roster of names, never the draft's numbers) whose transcription the
host compares leaf by leaf would catch a shared misreading of a digit. Decide on BP-05's evidence: if the live reviewer
lets a misread number through, build it.

### BP-08 The driven setup run and `campaign.create {pregen}`

Status: needs-triage

The §151.6 driven setup run builds its `library` from `investigator.list {}` and its `load_library` move takes a
`library_id` only; it does not offer pregens yet (character creation runs the legacy guide today). `campaign.create
{pregen}` still accepts only a starter's folder.

## Comments

## Continuation decisions and local verification

The stopped draft lacked the list/load and setup consumers. The continuation adds campaign-scoped reading status, the host's foreground demand, uncached browsing and source-preserving loads. Numeric review pointers are also kept strict in review-cache reuse. Printed damage bonus `0` is the rules table's zero (`none`) without rewriting its spelling. Five real-kernel and host-boundary diagnostic cases pass. Both mutation controls are killed: advisory numeric review and deriving HP instead of preserving the printed value. The first numeric mutation survived because the test used an invalid impact label; the corrected test uses the actual closed `presentation` label. No live transcription or App acceptance is claimed.

External comparison: [Foundry actors](https://foundryvtt.com/article/actors/) exposes JSON character intake; [Roll20 character sheets](https://wiki.roll20.net/Character_sheet) places sheet values in persistent attributes. These support distinguishing stored-card intake from a fresh generation workflow. Neither provides PDF transcription accuracy or this project's source-review gate; those remain local obligations. No importer dependency was added.
