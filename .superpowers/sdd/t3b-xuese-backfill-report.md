# T3b — 血色公路 (xuese-gonglu) story-graph backfill (delivery_kind + source_refs)

**Status:** ✅ Complete
**Date:** 2026-07-05
**Branch:** `codex/source-refs-delivery`
**Scenario (gitignored sandbox artifact):**
`.coc/playtests/v7-director-smoke/sandbox/.coc/campaigns/xuese-gonglu/scenario/`

## What was done

Backfilled the four xuese-gonglu (血色公路 / "Blood Highway") story-graph JSON
files with structured `delivery_kind` / `skill` / `difficulty` /
`player_safe_summary` / `source_refs` fields, mapping every clue / scene / npc /
front to its source PDF page (0-based pdf_cache index) plus a distinctive
`grep_anchor` phrase verified to actually appear in that page's markdown. All
existing free-text fields (`delivery`, `visibility`, `keeper_note`, `agenda`,
`dramatic_question`, `pressure_moves`, etc.) were preserved unchanged for
backward compatibility.

This is the **hybrid_mega probe** analogue of T2 (Haunting) and T3a
(renjian-baiwei): same field set, same verification method, applied to the
first ~40 pages + event-timeline + Hunt appendix of a 111-page Chinese 1970s
Texas cannibal-serpent-cult module. The probe covers Act 1 (town arrival +
sandbox investigation) and Act 2 (the Hunt vehicular ambush); the downstream
dungeon-crawl (base/mine/temple) is intentionally out of scope.

## Coverage

| File              | Entities | With `source_refs` | Structured delivery fields |
|-------------------|---------:|-------------------:|----------------------------|
| clue-graph.json   | 45 clue instances (41 unique IDs) | 45 (100%) | 42 player-safe clues get delivery_kind + player_safe_summary (skill/difficulty on the 15 skill_check clues); 3 keeper-only clues get source_refs only |
| story-graph.json  | 13 scenes | 13 (100%) | n/a (scenes only get source_refs) |
| npc-agendas.json  | 22 NPCs   | 22 (100%) | n/a |
| threat-fronts.json| 4 fronts  | 4 (100%)  | n/a |

Total: **84 entities, all carrying `source_refs`** — **113 individual ref
entries**, every one anchor-verified (see below).

Note on clue counts: the same logical `clue_id` (e.g. `clue-john-thunder-lore`,
`clue-barbershop-missing-plates`, `clue-miller-family-news`) legitimately
appears under 2 conclusions where it supports both; each instance was backfilled
independently. 41 unique IDs × 45 instances.

## Page-mapping method

1. Extracted the module PDF (`血色公路.pdf`, 111 pages) via pdf_cache using
   `parse_pymupdf4llm.py`.
2. Extracted **each page individually** (0-40, plus 75-80 for the event
   timeline + Hunt appendix) to map content → exact 0-based PDF page index.
   The consolidated `--pages 0-40` markdown has no page markers, so per-page
   extraction was required to pin content.
3. Pages **3** (content-warning bleed), **17**, **18** are sparse/near-empty
   in the OCR output (image-only or blank separators).
4. For every entity picked a `grep_anchor` that is (a) distinctive and (b)
   present verbatim on the cited page, then verified with `grep -qF` against the
   extracted page file. **All 113 anchors pass** (see verification below).

### Module layout (page → content) — probe-relevant subset

| Pages | Content |
|------:|---------|
| 0 | Cover (image-only, OCR garbage) |
| 1 | Credits (image-only) |
| 2 | Table of contents |
| 3 | (sparse) |
| 4 | Content warnings / safety guidance |
| 5-6 | 模组信息 / 梗概 / 如何使用本模组 (overview, hooks, motivations) |
| 7-8 | 守密人信息 / 背景 (priestess, Hunt rules, Miller family, sacrifices) |
| 9-11 | 蛇人历史 + 米甸/Abattoir founding + 沙漠地痞崛起 + Osteen arrival |
| 12-13 | 运行本模组 + 镇民 complicity tiers (Af/Ap/Cf/Cw/Cu/F/O) |
| 14-15 | 营造氛围 + 序幕 (prologue / west-Texas heat) |
| 16 | 欢迎来到屠宰场 + 1. 埃索加油站 (Esso: Russ/Nate/Steve) |
| 17-18 | (sparse / Esso continuation) |
| 19 | Esso keeper-notes + 2. 维兰德住宅区 (trailer park intro) |
| 20-23 | Trailer-park loot table (corpse #18, dream notebook #37, pentagram #38, blue-stone idol #71, Pete #72, bear-trap #80) |
| 24-25 | 3. 阿巴托尔镇中心 + 3A 马瑟综合商店 + 3B 汤姆理发店 (no-children, Mather, Archie) |
| 26 | Archie keeper-note + 3C 镇政府/邮局 (Ernie) |
| 27 | 3D 最后一站 (Robert Taylor, Carlos, license plates, long pork) |
| 28 | 3E 杂货店 + 3F 银行 (Lawrence) + 3G 凯利药店 (Kelley) |
| 29 | 3H 阳光洗衣店 (Brian) + 3I 雷鸟礼品店 (Thunderbird intro) |
| 30 | Thunderbird keeper-note (De Vermis Mysteriis, John Thunder lore) + 3J/3K |
| 31 | 3L 斯考特·布朗地产 + 3M 布伦纳医生的家 (Brenner: killing room, phone line) |
| 32-33 | 4. 羔羊之血教堂 (Reverend Scott, bone wards, church history) |
| 34 | 6. 水厂 + 7. 公墓 (1955 mine collapse, 43 graves, Malcolm) + 8. 哈克特牛肉场 |
| 35 | 9. 本森五金 (Peter Benson arsenal) + 10. 六号公路餐厅 + 11. 文森特废品站 |
| 36-37 | 12. 垃圾填埋场 (Vincent CB radio, Gerald's polaroids, red-room hint) |
| 38-40 | 13. 其他房屋 (Ridge Rd / Hackett Rd / Steel Rd residents) |
| 75 | **事件时间线 0-4** (片头字幕, 抵达, 沙漠地痞注意, 被锁定为猎物, 狩猎开始) |
| 76 | Timeline 5/5A/5B/5C + 6. 捕获 |
| 80+ | **附录 Ⅰ 狩猎** (Hunt chase rules: 9 dustbillies, harpoon-crossbow, non-lethal tools, N2O) |

### Sample source_ref (one clue's full entry)

```json
{
  "clue_id": "clue-harpoon-crossbow-tactic",
  "delivery": "Witness the harpoon-crossbow tactic during the ambush — the dustbillies use non-lethal tools (beanbag guns, lassos, sedative syringes, billy clubs) because the rules require live capture / timeline-4-hunt-ambush",
  "visibility": "player-safe",
  "delivery_kind": "obvious",
  "player_safe_summary": "伏击中沙痞用鱼叉弓（八十英尺牵引线）锚住车辆，并优先使用豆袋枪、套马杆、短棍、镇静剂注射器等非致命武器，因为规则要求尽可能活捉",
  "source_refs": [
    { "source_id": "pdf:xuese-gonglu", "path": "/Users/haoli/leehow/code/chatrpgv4/pdf/model/血色公路.pdf", "page": 80, "grep_anchor": "鱼叉弓" },
    { "source_id": "pdf:xuese-gonglu", "path": "/Users/haoli/leehow/code/chatrpgv4/pdf/model/血色公路.pdf", "page": 8,  "grep_anchor": "尽可能活捉受害者" }
  ]
}
```

## Validator result

```
$ python3 plugins/coc-keeper/scripts/coc_scenario_compile.py \
    .coc/playtests/v7-director-smoke/sandbox/.coc/campaigns/xuese-gonglu/scenario
OK: scenario story-graph valid
```

**OK — no errors, no warnings.** All four JSON files also parse cleanly.

## Spot-check verification

All 113 anchors were pre-verified with `grep -qF` against per-page extraction
files. Three anchors were additionally re-verified against **freshly extracted**
pages (cache-hit re-extraction) to confirm stability of the OCR/cache:

| Entity | Page | Anchor | Result |
|--------|-----:|--------|--------|
| `clue-hunt-is-ritual` (threat-front) | 8 | `仪式化的汽车追逐战` | ✓ FOUND |
| `npc-dr-brenner` (cult second) | 31 | `高智商的反 社会分子` | ✓ FOUND |
| `clue-vincent-bros-complicity` | 36 | `民用频段无线电台` | ✓ FOUND |

Final anchor-verification tally (programmatically re-checked across all 4 files):

| File | Anchors | OK | MISS |
|------|--------:|---:|-----:|
| clue-graph.json    | 51 | 51 | 0 |
| story-graph.json   | 21 | 21 | 0 |
| npc-agendas.json   | 31 | 31 | 0 |
| threat-fronts.json | 10 | 10 | 0 |
| **Total**          | **113** | **113** | **0** |

## Unmappable entities

**None.** Every clue, scene, NPC, and front in the xuese-gonglu story-graph
was successfully mapped to a concrete PDF page with a verifiable grep anchor.

The three keeper-only cult-mechanics clues (`clue-priestess-and-tsehane-identity`,
`clue-osteen-and-brenner-structure`, `clue-base-and-temple-out-of-scope`) all
map to in-probe pages that establish the fact (the priestess is named on p7;
the complicity tiers on p13; the base/mine/temple locales are listed in the
TOC on p2). They reference out-of-scope *downstream* content but are themselves
documented in probe-scope pages.

## Notes / concerns

- **Scenario files are gitignored.** `.coc/` matches `.gitignore`, so the four
  JSON files are runtime/sandbox artifacts and are **not** committed to the repo
  (confirmed with `git check-ignore`). This matches the T2 Haunting / T3a
  renjian-baiwei pattern: the backfill is delivered on the filesystem; this
  report is the committed record.
- **Probe scope spans beyond page 40.** The task brief specified "roughly the
  first ~40 pages + event timeline + Hunt appendix". The event timeline begins
  at **p75** (事件时间线 0-4) and the Hunt chase-rule appendix at **p80**
  (附录 Ⅰ 狩猎). These pages anchor the four timeline scenes
  (`timeline-1` through `timeline-4`) and the Hunt-ambush clues
  (`clue-caltrop-flat-tire`, `clue-four-vehicle-ambush`,
  `clue-harpoon-crossbow-tactic`). All such refs were extracted and verified.
- **delivery_kind distribution** across the 42 player-safe clues: skill_check
  (15), obvious (11), environmental (8), npc_dialogue (8). The remaining 3 are
  keeper-only (cult structure / out-of-scope notes) which intentionally get
  `source_refs` but **no** `delivery_kind` / `player_safe_summary`.
- **skill_check clues (15)** carry `skill` + `difficulty`: Spot Hidden (5),
  Library Use (3), Psychology (2), POW (2), Idea/Medicine/Science (1 each).
  Eight are `hard` difficulty (barbershop missing-plates, blue-stone idol
  geology, snake-bite corpse Medicine, Archie psychopath Psychology, Brenner
  Psychology, De Vermis tome Spot Hidden, no-children Idea, four-vehicle-ambush
  is `obvious` not skill); seven `regular`.
- **OCR spacing caveat.** The OCR pass occasionally inserts spaces inside CJK
  runs (e.g. `精 神变态`, `高智商的反 社会分子`, `沙漠地痞 不是很聪明`,
  `一夜 之间消失`, `约翰 雷霆`, `骨头 和筋腱`). Anchors that cross such a
  split were chosen to include the literal OCR spacing so `grep -qF` matches
  verbatim. If the PDF is ever re-OCRed with different spacing, a handful of
  anchors (≈8) may need their internal spaces normalised. This is the same
  caveat noted in the T3a report.
- **Repeated clue IDs.** `clue-john-thunder-lore`, `clue-barbershop-missing-plates`,
  and `clue-miller-family-news` each appear under two conclusions (they support
  both a cannibal-cult reading and an ally/missing-person reading). Each
  instance was backfilled independently with the same source_ref, which is
  correct — the JSON permits duplicate clue_ids across conclusions.
- **player_safe_summary** values are in Chinese, short and concrete, describing
  what the player sees/learns (not keeper secrets). Keeper-only clues carry no
  summary by design.
