# T2 — Haunting story-graph backfill (delivery_kind + source_refs)

**Status:** ✅ Complete
**Date:** 2026-07-06
**Branch:** `codex/source-refs-delivery`
**Scenario (gitignored sandbox artifact):**
`.coc/playtests/v7-director-smoke/sandbox/.coc/campaigns/the-haunting/scenario/`

## What was done

Backfilled the four Haunting story-graph JSON files with structured
`delivery_kind` / `skill` / `difficulty` / `player_safe_summary` / `source_refs`
fields, mapping every clue / scene / npc / front to its source PDF page (0-based
pdf_cache index) plus a distinctive `grep_anchor` phrase verified to actually
appear in that page's markdown. All existing free-text fields (`delivery`,
`visibility`, `keeper_note`, etc.) were preserved unchanged for backward
compatibility.

## Coverage

| File            | Entities | With `source_refs` | Structured delivery fields |
|-----------------|---------:|-------------------:|----------------------------|
| clue-graph.json | 34 clues | 34 (100%)          | 34 (delivery_kind + player_safe_summary; skill/difficulty on the 13 skill_check clues) |
| story-graph.json| 11 scenes| 11 (100%)          | n/a (scenes only get source_refs) |
| npc-agendas.json| 10 NPCs  | 10 (100%)          | n/a |
| threat-fronts.json | 3 fronts| 3 (100%)         | n/a |

Total: **58 entities, 58 `source_refs` blocks** (some entities carry 2 refs,
e.g. multi-page scenes; total individual ref entries ≈ 64).

## Page-mapping method

1. Extracted Haunting scenario pages via pdf_cache (PDF pages 446–461 carry the
   scenario text; 437–445 and 462–465 are investigator sheets / handout images).
2. Extracted **each page individually** to map content → exact 0-based PDF page
   index (the consolidated `--pages 437-465` markdown has no page markers, so
   per-page extraction was required to pin content).
3. Confirmed the **printed page → PDF index offset is +11** (e.g. printed 436 =
   PDF 447), not +12 as the task brief estimated. All `page` values use the
   pdf_cache 0-based PDF index.
4. For every entity picked a `grep_anchor` that is (a) distinctive and (b)
   present verbatim on the cited page, then verified with `grep -qF` against the
   extracted page file.

### Sample source_ref (one clue's full entry)

```json
{
  "clue_id": "clue-chapel-journal-burial",
  "delivery": "Spot Hidden (or Pushed) at the chapel cabinet / chapel-investigation scene",
  "visibility": "player-safe",
  "delivery_kind": "skill_check",
  "skill": "Spot Hidden",
  "difficulty": "regular",
  "player_safe_summary": "礼拜堂废墟柜子里找到的霉烂日记，记载沃尔特·科比特依其愿望被葬于自家地下室",
  "source_refs": [
    {
      "source_id": "pdf:the-haunting",
      "path": "pdf/Call Of Cthulhu Keeper Rulebook 40th Anniversary (Sandy Petersen).pdf",
      "page": 451,
      "grep_anchor": "Walter Corbitt was buried in the basement of his house"
    }
  ]
}
```

## Validator result

```
$ python3 plugins/coc-keeper/scripts/coc_scenario_compile.py \
    .coc/playtests/v7-director-smoke/sandbox/.coc/campaigns/the-haunting/scenario
OK: scenario story-graph valid
```

**OK — no errors, no warnings.** (T1's validator treats malformed `source_refs`
and `delivery_kind=skill_check` without `skill` as *warnings*; none fired.)

## Spot-check verification

Anchors verified against freshly extracted PDF pages (4 of 4 passed):

| Entity | Page | Anchor | Result |
|--------|-----:|--------|--------|
| `clue-chapel-journal-burial` | 451 | `Walter Corbitt was buried in the basement of his house` | ✓ FOUND |
| `basement-confrontation` scene | 455 | `An old knife with an ornate hilt` | ✓ FOUND |
| `chapel-cult-residue` front | 451 | `Call for **Luck** rolls` | ✓ FOUND |
| `walter-corbitt` NPC | 460 | `About W. Corbitt, Esq` | ✓ FOUND |

All 34 clue anchors + all scene/npc/front anchors were also pre-verified with
`grep -qF` against per-page extraction files before being written.

## Unmappable entities

**None.** Every clue, scene, NPC, and front in the Haunting story-graph was
successfully mapped to a concrete PDF page with a verifiable grep anchor.

## Notes / concerns

- **Scenario files are gitignored.** `.coc/` matches `.gitignore:3`, so the four
  JSON files are runtime/sandbox artifacts and are **not** committed to the repo.
  This matches the existing T1 pattern (T1 committed code/scripts/tests, not the
  sandbox scenario). The backfill is therefore delivered on the filesystem; this
  report is the committed record of the work.
- **Offset correction.** The task brief estimated printed→PDF offset of +12; the
  actual offset measured against the bottom-of-page printed numbers in the
  extracted markdown is **+11**. All `page` values were verified against actual
  page content, so this does not affect correctness.
- **Player-safe summaries are in Chinese**, short and concrete, describing what
  the player sees/learns (not keeper secrets). Keeper-only clues
  (`clue-corbit-flesh-ward`, `clue-corbitt-undead-body`, `clue-horoscope-papers`)
  carry a `（守秘人专用）` prefix.
- **Repeated clue_ids** (e.g. `clue-vittorio-bible-own-weapon` appears in two
  conclusions) were given identical structured fields wherever they appear, so
  the mapping is consistent across conclusions.
