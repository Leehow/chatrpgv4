# Page transcripts: the book's text in the order a reader reads it

Status: accepted (owner 2026-10-07: 「可以，说明这个方案可行啊，这个不需要指定模型，就用玩家用的模型就行，那你写spec来实现吧，记得图谱解析那边的接线，还有我们内置模组的处理」; then 「解析后的文本跟着pdf哈希保存，以后玩家再次玩或者上传相同的pdf不用重复解析」; window: 「跟着读书窗口逐章做…但是你需要多读一章连接的章节（有些模组是地点）这样玩家可以无缝进入新的章节或者区域不用等」; merge and package when the gates are green)
Date: 2026-10-07
Baseline: `0.9.7a` at `562e2d1d2`. Branch: `claude/page-transcript-20261007`.
Contract: §191 of `docs/kernel-rpc.md`. Amends §22.1 (the `search` operation), §22.6 (the "no transcription layer" sentence
is about drafts and stays; this is a navigation layer beside the native text), §182.3 (the window gains connected
chapters for transcripts only) and the product invariant in `Agents.md` ("OCR/Markdown 资料包生产路径已退役").
Tickets: `docs/specs/page-transcript-tickets.md`.

## Problem Statement

The host reads a PDF's text with PDF.js (`nativePageText`, `extensions/module/source.ts`): every text item, a newline
where PDF.js marks a line end. That text is exact -- on 血色公路 pages 17-21 it equals MinerU 4.0's standard tier character
for character once MinerU's map OCR is removed (2026-10-07; the "dropped 一" seen earlier was MinerU's flash extractor,
not the PDF) -- but it is in **drawing order**, not reading order, and it holds **nothing that is only pixels**:

- two columns interleave and boxed text comes last (血色公路 p.17: the radio quote and the arrival paragraph after the
  gas-station NPCs); a sidebar sits between the two halves of a sentence (卡尔克萨之子 p.19, Orient Express p.228); a
  Keeper note comes after the next NPC;
- 10 of 血色公路's 111 pages and all 257 pages of *The Nyarlathotep Cycle* have no text layer; stat blocks drawn as
  pictures (冰冷的收获 p.41) and map legends (血色公路 p.18) are absent.

Every consumer that reads this text **for meaning** gets the drawing order: the scene text the Keeper receives when it
lands on a book place (§22.4.7, `landOnIndex`, `landPerson`), the cast reader's pages (§177.2), the Jev source driver's
page leads, need-read text and navigation projection, the reader's `pdf search`, the Keeper prescreen's literal search
and consultation units, the §190.1 window-place question. MinerU would fix the order but costs players a 1.6 GB Python
runtime, 2 GB of models, 4.3 GB of resident memory and 15-28 minutes per book (`mineru-4-on-mac-20261007`).

**The probe that decided this (2026-10-07, scratchpad `pagelayout/`, `corpus/`, `corpus-grok/`, pre-registered).** A
tools Pi agent sees the rendered page and the page's PDF.js lines, numbered, and writes Markdown whose text is only line
placeholders (`{L5-L9}`); the host fills the exact lines back in. 17 books (Chinese Word and typeset translations,
PowerPoint 血色公路, Chaosium English, a scanned book, handout packs), 58 pages sampled at 25/55/85% of each book,
MinerU 4.0 as a second opinion:

| | gpt-6-luna low | grok-4.5 low |
|---|---|---|
| every line used exactly once, first attempt | 41/42 text pages | 42/42 |
| pages whose order the lead judged wrong against the image | 1 | 3 (all within one section or one sidebar) |
| text-layer strings retyped instead of placed | 6 pages, 22 strings | 3 pages, 6 |
| per page, median | 8.6 K in / 644 out / 55 s | 5.4 K in / 778 out / 16 s |

MinerU itself misordered 2 of the pages the agent got right. On clean scans both models matched MinerU at 0.99-1.0.
Text inside pictures is read by the agent and marked as such; it misreads stylised lettering ("Main Courtyard" as "Main
Garden" by luna). The owner ruled the format must not be hard-coded (「这个格式不能硬编码，因为每个模组格式不一样…让agent同时看图页和pdf.js的文字，然后让agent自己安排格式设计」): column thresholds and font-size headings were tried
and rejected.

**The hollow delivery to avoid:** a transcript store that no consumer reads; a transcript used as evidence; a model that
retypes or "corrects" the book's words; a layout rule in code; a transcript that blocks play while it is made; a second
parse of a book the store already holds.

## Solution

**T1 Lines.** A host operation returns each page's native text split into its non-empty lines -- exactly the strings
`sourceText` already yields, split at its newlines, whitespace-only lines left out -- with the page label and the native
`text_sha256`. The lines are the unit the agent places.

**T2 The layout agent.** One tools Pi child per page (`read,write,edit`), run through the reader child path with **the
model and thinking level the reading lane already uses** (`ReadingService` `deps.model()`; no new model setting; a model
without vision transcribes nothing and the page keeps its native text). It reads `page.png` (the existing render path)
and `lines.txt`, and writes `layout.md` under `content/setup/page-transcript.md`: any Markdown structure the page needs;
text-layer text only as placeholders; page furniture in a drop list; text visible only in the image between image-text
markers; one-line figure notes. Text work stays a tools agent (Agents.md "文本工作必须跑成带工具的 Pi agent").

**T3 Assembly holds the words fixed.** Deterministic host code turns the layout into the stored page:

- free text equal to a line's text is mapped back to that line (unused) or removed (already placed); any other free text
  outside figure notes and image-text is removed and counted;
- a line used twice keeps its first place; a line never placed sends the page to one repair child with the missing line
  numbers; still missing after it, the lines are appended in native order under an `unplaced` block;
- `text` is the **exact layer**: every native line exactly once, in transcript order, blocks separated by a blank line,
  dropped lines last. The host checks that the multiset of its lines equals the native lines, so `text` is a permutation
  of the book's own words and nothing else (§148's exact-excerpt rule survives);
- `markdown` is the reading version: the structure, figure notes and image text (marked), dropped lines left out;
- `image_text` keeps what the model read off pixels, separately and labelled; it is never evidence (§22.3).

**T4 Kept by the file's digest, made once.** `<home>/.coc/source-transcripts/<file_sha256>/page-<NNNN>.json`, immutable,
atomic, version `transcript-v1`. Every module, campaign, fork and re-import of the same bytes reads the same pages; a
second table or a re-uploaded PDF makes no transcript call. One producer per page across processes (an exclusive claim
file). Shipped seeds under `<content>/source-transcripts/<file_sha256>/` are read through before the home store.

**T5 Made ahead of the table, never waited for.** The kernel's reading window (§182) names the transcript pages: the
whole book when it is short; otherwise the chapter in play, then **the chapters that hold the places the table can reach
next** (the focus scene's exits, the place it is inside, the places inside it), then the next chapter -- so a player who
walks into the next area finds its pages ready. A starter has no read-ahead and uses its shipped seeds. A consumer that
needs a page now reads the native text at once and puts the page at the front of the queue.

**T6 The readers read it.** Where the text is read for meaning, the transcript replaces the native text when it exists:
the Keeper's scene and person text on landing, the cast reader's pages, the Jev driver's page leads, need-read text and
navigation projection, the window-place question's first lines, the reader's `pdf search` and the prescreen's literal
search (which now also find image text, labelled), and the prescreen's consultation units (the exact layer, with
layer-tagged resource ids so a checkpoint re-reads the same layer). Unchanged: claim support and every evidence check
(native text and page images), reference packets and excerpt spans, the fresh-skeleton catalog, map/handout/illustration
discovery (images keep their own routes).

**T7 The built-in book.** The Haunting's shipped 17-page window (`content/starters/the-haunting/source.pdf`, physical
pages 447-463 of the 40th Anniversary Keeper Rulebook, shipped by the 2026-09-24 ruling) gets its transcripts produced
once by `scripts/build-source-transcripts.ts` with the same producer and committed beside it under
`content/source-transcripts/<its sha>/`. No page beyond that window is shipped, as for the PDF itself.

**T8 Telemetry.** One `lane: "transcript"` row per page attempt and per reuse, and one per window change.

## Success, pre-registered

- **TR-A Invariant.** Every stored page satisfies the permutation check (a test reads every page the corpus run stored).
- **TR-B Corpus through the product path** (the real `TranscriptService`, the App's current table model): at least eight
  books covering Chinese Word, Chinese typeset, PowerPoint, Chaosium English and a scanned book; at least 40 pages. Bars:
  >= 95% of text pages need no `unplaced` block; a second campaign on the same book and a re-import of the same file make
  zero transcript child calls; a page with no text layer stores image text or a figure note, never fails the table.
- **TR-C Real table** (`tests/play/driver.py`, live Keeper, one sentence per turn, Agents.md's acceptance method and the
  2026-10-07 narrative-coherence rule) on 血色公路 from a fresh home: the window's transcripts exist before the first
  landing; landings carry `layer: "transcript"`; the table plays on coherently. Cost recorded, no bar.

## Out of Scope

- Any change to the evidence standard, claim support, reference packets or the reader's own page viewing (§22, §186).
- MinerU or any other installed parser; a remote parse service.
- Shipping any page of a book beyond what a ruling already ships.
- Re-transcribing on a new instruction version (a later `transcript-v2` decides that).

## Comments

**2026-10-07, PT-04 (lead).** The Haunting's 17-page window transcribed with `scripts/build-source-transcripts.ts` and
grok-4.5 low in 2 min 5 s: 17/17 stored on the first attempt, no unplaced line; dropped lines are running heads, folios
and the margin rune glyphs of pp. 14-15 (and the Keeper map's title on p. 7, kept in the figure note and the exact
layer); both map pages carry their legends as labelled image text. Committed as seeds under
`content/source-transcripts/31e36f72…/` (156 KB).

**2026-10-07, TR-A and TR-B (lead, pre-registered in the session scratchpad `trb/PREREGISTER.md`).** Product path:
`scripts/build-source-transcripts.ts` driving `TranscriptService` at `c52425071`, flapcode/gpt-6-luna low (the App's
default table model), fresh home, the 17 books / 58 pages of the probe sample (Chinese Word and typeset translations,
PowerPoint, Chaosium English, a scanned book, handout packs).

| bar | result |
|---|---|
| TR-A: every record a permutation of the page's PDF.js lines (independent pdf.js re-check) | 58/58 |
| text pages (>= 4 lines) with no `unplaced` line | 42/42 (bar 95%) |
| pages stored on the first child, no repair needed | 58/58 |
| image-only pages stored (image text or figure note), none failed | 13/13 |
| second pass, same home: transcript children | 0 (17 books in 10 s) |
| the same PDF copied under another path: transcript children | 0 (reused by digest) |

Cost: per page median 13.9 K input / 800 output tokens and 33 s (max 63 s); 0.88 M input and 49 K output for the 58
pages, 3 children at a time. The run surfaced two layout faults fixed in `5a9410f7f`: a line ending in a hyphen joined
with a space ("sce- nario"), and a heading placeholder that carried the paragraph under it (now forbidden by the
instructions).

**2026-10-07, TR-C (lead, live table, pre-registered).** Fresh home at `6ebc59957`, 血色公路, Keeper flapcode/gpt-6-luna
low, the lead playing one sentence a turn: 5 setup turns, 20 play turns (arrival at the station, the car on the lift, the
owner's fear, the town, a night meeting). The Keeper described the station in the book's reading order with the three
men under the awning on the arrival turn -- RD-08's Keeper told the player nobody was there -- and the town and the
Wieland billboard from the next chapter when the player drove on. Bars: window rows written and 25 of the first window's
27 pages stored before the first landing row (the two missing pages failed); a `person_text` row with `layer: "mixed"`;
40/40 records pass the independent permutation check; play coherent. **Found:** (1) 7 of 47 page attempts failed
`no_layout` -- one child wrote its layout to a path it made up; (2) three transcript children at a time drew the provider's
rate limit onto the Keeper (18 Keeper retries on 429 while they ran) and onto the reading a turn waited for: turn 11 waited
331 s before the Keeper could start. Fixed in `e49d32246` (§191.6 "The table comes first").

**2026-10-07, TR-C2 (lead, live table, pre-registered after the fix).** Fresh home at `e49d32246`, same book and Keeper,
14 play turns as a television reporter (station, the trailer park of the next chapter in the book's words, a trail the
Keeper improvised). Bars: no `no_layout` failure (11 pages: 9 stored, 2 repaired by a fresh child); Keeper 429 retries
16 (TR-C 18; the account's rate limit binds without transcripts too, and the transcript queue itself cooled down 7
times); no play turn over 120 s (max 111 s; TR-C 331 s); 11/11 records pass the permutation check. Not observed: no
landing row fired on this table, so the landing layer was not exercised here. The price is throughput: with one child,
yielding and cooling down, 11 pages were made in 13 minutes -- the table comes first.

**2026-10-07, TR-C fix (worker, branch `claude/transcript-child-guard-20261007`).** The owner ruled on the made-up paths:
「那说明工具设计有问题啊，工具层面就不能让agent自己决定写到哪里，应该由系统来决定」. The layout child now has no file
tool; its one tool is `submit_layout`, the host writes `layout.md`, answers with the lines the layout left out, and the
child repairs in the same session (contract §191.2, §191.3; the separate repair child and `repair.txt` are gone). Not
changed and worth a ruling: every other reader or `mod` child started without `source` still runs `read,write,edit,bash`
with no tool guard (`createReaderToolGuard` binds only `source` readers) -- the cast reader (`ReadingService.readCast`),
adaptation, the NPC and voice authors, Mod definition and audit agents, and the presenters that take the default tools.
The handout reader has no tools at all and needs nothing.

**2026-10-07, TR-D (lead's live probe of the branch, 17 TR-B pages) and its fix.** The design held: nothing written
outside the work directories, no tool but `submit_layout`, every record a permutation, 0 unplaced on 15/15 text pages,
about 6K input tokens a single-submission page against 14K in TR-B. Five pages came out `repaired` with a whole first
submission: the provider failed first, Pi ended the run before its auto-retry, and the submission tool's reminder was
queued then and ran after the retried run. Fixed on the branch: the reminder is judged only on a run whose model answered
(contract §191.2, TR-C fix decisions). Separate finding, not changed: `extensions/kernel/adaptation-submit.ts` has the same
once-per-child reminder on `agent_end` and nothing in `extensions/` can see a pending retry.
