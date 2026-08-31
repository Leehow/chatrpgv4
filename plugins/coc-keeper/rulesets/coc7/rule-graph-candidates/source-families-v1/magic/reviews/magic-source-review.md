# Magic family source review

- Reviewer identity: `codex-reviewer-magic-source-20260831`
- Producer identity: `coc.rule-graph-compiler.v1`
- Source PDF SHA-256:
  `a860499cf34b40cac385f51b6e667ab37ec0796c7329494def08c8b161fd71eb`
- Reviewed PDF indices: Chapter 9 window 181, 183-191; Grimoire/source-gap
  windows 251, 253-277, 279-311 (blank art pages 182, 252, 278, 288 excluded)
- Visual evidence:
  - `/private/tmp/pi-coc-rule-families-20260831/visual-review/magic-core-contact.jpg`
  - `/private/tmp/pi-coc-rule-families-20260831/visual-review/grimoire-a-contact.jpg`
  - `/private/tmp/pi-coc-rule-families-20260831/visual-review/grimoire-b-contact.jpg`
- Verdict: **ACCEPTED for complete source-backed magic family coverage; not
  promoted in this lane**

## Source coverage

The accepted shard binds the source rules for MP economy, spell learning from
books/people/entities, first and subsequent casting, pushed casting,
disruption, and the actual Chapter 12 spell/variation material. Its non-null
digest proves acceptance of this bounded source extraction.

## Resolved review findings

### Removed records without rulebook source

The following former `spells.json` records do not occur anywhere in the 465-page OCR
corpus: Mantle of Cthulhu, Resurrection of Me, Seal of Nyarlathotep, See
Invisible, Steal Mind, Summon Hellfire, Swim Like a Fish, Touch of Death, True
Seeing, and Walk the Path. Their stored `source_page` values 270-286 resolve to
PDF indices 281-297, which visually and textually contain Chapter 13 Artifacts
and Alien Devices and Chapter 14 Monsters, not Grimoire spells. There is no
page-backed text from this PDF with which to accept them. Commit `cc344935`
removed those records from the CoC7 production catalog instead of retaining
unsupported derivative content.

### Source/runtime semantic disagreement

PDF indices 187-190 establish four material differences:

1. a failed pushed casting still works normally; runtime reports failure;
2. disrupted casting still pays SAN and MP; runtime interruption charges MP
   and explicitly records zero SAN;
3. the source's minor/major 1D8 consequence tables differ from runtime data;
4. entity teaching calls for a successful INT roll, while runtime applies the
   Hard INT rule used for book/person learning.

Commit `cc344935` corrected all four runtime/data mismatches from the exact
source pages and replaced both 1D8 tables with the page text. The regenerated
candidate now has `coverage.magic=accepted`, no exception nodes, no unresolved
applicable rules, and no source blocker. Runtime ownership remains
`legacy/visible`; production graph/manifest and operation archive/policy remain
unchanged.
