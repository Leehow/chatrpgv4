# Jev reads the book by paragraph

Status: ready-for-agent

Owner (2026-10-08): 「之前用的jev索引模组的方案现在这个模组解析更新之后是否也更新了？如果文字被规整了是否可以用jev按段落获取而不只是按页来索引？」,
then 「开这个切片，按段落取」. Contract `docs/kernel-rpc.md` §196.

## Today

- `nativeSourceCatalog` (`runtime/jev/native-source-catalog.ts`) makes one snapshot per page and layer
  (`pdf:<sha>:page:<n>:<layer>:<version>`). Since §191.7 a page with a transcript is read in the transcript layer
  (reading order). Its evidence units are `splitSourceText(text, 800)` slices (`runtime/jev/source-ref.ts`): a fixed
  length bounded at a nearby break, per page. A unit can cut a paragraph in half, hold the tail of one and the head of
  the next, and never continues across a page break. A unit carries no heading.
- On TR-F (App `d944b6b07`, Cold Harvest) every `source_catalog` row showed `materialized_pages` [1,4,7,…,48] (16 of
  48) and `search_layers {transcript: 0, native: 0, image_text: 0}`: the consultation looked at a third of the pages and
  its search found nothing in any layer.

## The change

1. **A transcript page's units are its paragraphs.** The record stores `text` (the exact layer: native lines in reading
   order) and `markdown` (the same lines joined into blocks). A block's lines are a run of consecutive `text` lines, so
   block boundaries in `text` are recoverable by aligning the two deterministically (the join rules are §191.3's:
   wide characters join with no space, a line-end hyphen joins with no space, otherwise one space; markdown syntax —
   heading marks, `>`, list marks, table pipes — is not text). One unit per body block (paragraph, list item group,
   table, quoted box); a block longer than the unit cap is split as today inside the block. Offsets stay offsets into
   `text`, so spans, digests and evidence are unchanged in kind. No `TRANSCRIPT_VERSION` bump and no re-transcription
   unless the alignment provably cannot be done from the stored record (then say so, with the failing case).
2. **A unit carries its section.** The heading blocks above it on the page (and, at the top of a page, the last heading
   path of the previous page) become the unit's `section` (e.g. 「4. 关于卡西维依阿克塔伯三号农场 › 地图」), shown to Jev with
   the candidate and to the Keeper with the excerpt.
3. **A paragraph broken by a page break is delivered whole.** When a page's last body block and the next page's first
   block are both body text and the first does not end at a sentence end (Unicode `Sentence_Terminal`, not a list of
   characters), the two units are linked (`continues` / `continued_from`): selecting either supplies both, within the
   byte budget, and the reference cites both pages.
4. **Native pages keep working.** A page with no transcript keeps today's slices; a native page with blank-line
   paragraphs may use them.
5. **Why the TR-F catalog saw a third of the pages and searched nothing** — find it (materialization budget, search
   query shape, layer wiring of §191.7) and fix it if it is a defect, or record why it is correct.

## Tickets

### PU-01 Paragraph units with sections (items 1, 2, 4)
### PU-02 Page-break continuation (item 3)
### PU-03 Materialization and search on TR-F (item 5)
### PU-04 Acceptance (lead)
Pre-registered with TR-F2: per turn, the prescreen's supplied source units are whole paragraphs with a `section`;
an offline probe replays TR-F's 12 player lines against Cold Harvest's catalog before/after and lists, per line, the
located units (count, bytes, and whether each holds the fact the book answers the line with).
