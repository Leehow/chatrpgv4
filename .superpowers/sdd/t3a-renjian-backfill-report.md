# T3a — 人煎百味 (renjian-baiwei) story-graph backfill (delivery_kind + source_refs)

**Status:** ✅ Complete
**Date:** 2026-07-05
**Branch:** `codex/source-refs-delivery`
**Scenario (gitignored sandbox artifact):**
`.coc/playtests/v7-director-smoke/sandbox/.coc/campaigns/renjian-baiwei/scenario/`

## What was done

Backfilled the four renjian-baiwei (人煎百味 / "The Million Flavoured Ones") story-graph
JSON files with structured `delivery_kind` / `skill` / `difficulty` /
`player_safe_summary` / `source_refs` fields, mapping every clue / scene / npc /
front to its source PDF page (0-based pdf_cache index) plus a distinctive
`grep_anchor` phrase verified to actually appear in that page's markdown. All
existing free-text fields (`delivery`, `visibility`, `keeper_note`, etc.) were
preserved unchanged for backward compatibility.

This is the standalone-module analogue of T2 (Haunting): same field set, same
verification method, applied to a 21-page Chinese modern-era hub_sandbox module
about a cannibal restaurant (Averys / Bak Bon Dzshow).

## Coverage

| File            | Entities | With `source_refs` | Structured delivery fields |
|-----------------|---------:|-------------------:|----------------------------|
| clue-graph.json | 44 clues | 44 (100%)          | 37 (delivery_kind + player_safe_summary; skill/difficulty on the 8 skill_check clues); 7 keeper-only clues get source_refs only |
| story-graph.json| 12 scenes| 12 (100%)          | n/a (scenes only get source_refs) |
| npc-agendas.json| 12 NPCs  | 12 (100%)          | n/a |
| threat-fronts.json | 4 fronts| 4 (100%)         | n/a |

Total: **72 entities, 72 `source_refs` blocks** (some entities carry 2 refs,
e.g. multi-page scenes and NPCs with separate background + stat-block pages;
total individual ref entries = **89**).

## Page-mapping method

1. Extracted the module PDF (`人煎百味1.01.pdf`, 21 pages) via pdf_cache using
   `parse_pymupdf4llm.py`.
2. Extracted **each page individually** (0-20) to map content → exact 0-based
   PDF page index. The consolidated `--pages 0-20` markdown has no page markers,
   so per-page extraction was required to pin content.
3. Pages **0** (cover) and **14** (blank separator) are empty in OCR output.
4. For every entity picked a `grep_anchor` that is (a) distinctive and (b)
   present verbatim on the cited page, then verified with `grep -qF` against the
   extracted page file. **All 89 anchors pass** (see verification below).

### Module layout (page → content)

| Pages | Content |
|------:|---------|
| 1 | Title / credits |
| 2 | Table of contents |
| 3 | Overview + background |
| 4 | NPC backgrounds: Justine, Marcus |
| 5 | NPC backgrounds: Chippy, Averys staff, believers, victims |
| 6 | Opening (apartment, dream, flatmate) + locations |
| 7 | Hub locations: hospital, university, police, shops, online |
| 8-9 | Averys ground floor, alley, office, security |
| 9-10 | Second floor: hall, statues, processing room, cold store |
| 11 | Top floor: grow room, cages, Justine's quarters |
| 12-13 | Events: ground-floor visit, Scott Wyatt, Sunday dinner, Justine's room |
| 15 | Endings (3 choices) + expansion hooks |
| 16-17 | NPC stat blocks + food/drug mechanics (BBD, Shzor-Shzong, black lotus) |
| 18-19 | Handouts #1-5 (Justine bio, invitation, menu, diary, camera) |
| 20 | Pre-gen investigators |

### Sample source_ref (one clue's full entry)

```json
{
  "clue_id": "clue-caged-living-victims",
  "delivery": "Reach the top-floor cage room — 20-30 living, maimed victims, tongues cut, sedated, being slowly butchered (1D6/1D10 SAN) / aversys-top-floor scene",
  "visibility": "player-safe",
  "delivery_kind": "environmental",
  "player_safe_summary": "顶层笼子里关着二三十名被肢解但仍活着的人，舌头被割、被药物镇静、正被缓慢切割（损失1D6/1D10理智）",
  "source_refs": [
    {
      "source_id": "pdf:renjian-baiwei",
      "path": "/Users/haoli/leehow/code/chatrpgv4/pdf/model/人煎百味1.01.pdf",
      "page": 11,
      "grep_anchor": "三个巨大的笼子"
    }
  ]
}
```

## Validator result

```
$ python3 plugins/coc-keeper/scripts/coc_scenario_compile.py \
    .coc/playtests/v7-director-smoke/sandbox/.coc/campaigns/renjian-baiwei/scenario
OK: scenario story-graph valid
```

**OK — no errors, no warnings.**

## Spot-check verification

All 89 anchors were pre-verified with `grep -qF` against per-page extraction
files. Three anchors were additionally re-verified against **freshly extracted**
pages to confirm stability of the OCR/cache:

| Entity | Page | Anchor | Result |
|--------|-----:|--------|--------|
| `clue-bbd-human-ganglia-forensics` | 3 | `捣碎的人类神经节组成` | ✓ FOUND |
| `clue-caged-living-victims` | 11 | `三个巨大的笼子` | ✓ FOUND |
| `npc-justine` (stat block) | 16 | `STR 80` | ✓ FOUND |

Final anchor-verification tally (programmatically re-checked):

| File | Anchors | OK | MISS |
|------|--------:|---:|-----:|
| clue-graph.json    | 47 | 47 | 0 |
| story-graph.json   | 16 | 16 | 0 |
| npc-agendas.json   | 18 | 18 | 0 |
| threat-fronts.json |  8 |  8 | 0 |
| **Total**          | **89** | **89** | **0** |

## Unmappable entities

**None.** Every clue, scene, NPC, and front in the renjian-baiwei story-graph
was successfully mapped to a concrete PDF page with a verifiable grep anchor.

## Notes / concerns

- **Scenario files are gitignored.** `.coc/` matches `.gitignore:3`, so the four
  JSON files are runtime/sandbox artifacts and are **not** committed to the repo
  (confirmed with `git check-ignore`). This matches the T2 Haunting pattern: the
  backfill is delivered on the filesystem; this report is the committed record.
- **delivery_kind distribution** across the 37 player-safe clues: environmental
  (8), handout (6), npc_dialogue (7), obvious (5), skill_check (8) — plus the
  remaining 7 are keeper-only (stat blocks / endings) which intentionally get
  `source_refs` but **no** `delivery_kind` / `player_safe_summary`.
- **skill_check clues (8)** carry `skill` + `difficulty`: Medicine (3),
  Computer Use (2), Psychology (2), Cook (1). Two are `hard` difficulty
  (ganglia-harvest forensics, police-chief link); the rest `regular`.
- **OCR spacing caveat.** The OCR pass occasionally inserts spaces inside CJK
  runs (e.g. `马 科斯`, `警 察局长`, `很 难识别`). Anchors that cross such a
  split were chosen to include the literal OCR spacing so `grep -qF` matches
  verbatim. If the PDF is ever re-OCRed with different spacing, a handful of
  anchors may need their internal spaces normalised.
- **player_safe_summary** values are in Chinese, short and concrete, describing
  what the player sees/learns (not keeper secrets). Keeper-only clues carry no
  summary by design.
