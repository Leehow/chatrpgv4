---
name: coc-scenario-import
description: Import and index authored Call of Cthulhu scenarios for COC mode. Use for rulebook scenarios, external module PDFs, scenario skeletons, source maps, Keeper-only separation, and on-demand PDF lookup.
---

# COC Scenario Import

## Import Model

Use a hybrid import strategy:

1. Preparse scenario structure into JSON skeletons.
2. Record source PDF paths and page ranges in indexes.
3. During play, look up detailed PDF material only when needed.

## Scripts

Use `../../scripts/coc_scenario.py` for:

- PDF cataloging
- page counts and metadata
- scenario skeleton files
- `index/source-map.json`
- `index/handout-assets.json` plus `assets/handouts/` for future PDF
  illustrations, maps, newspaper clippings, portraits, and player-safe
  handout images

After a PDF module or parsed scenario is bound to a campaign, generate a
player-safe character creation briefing with
`../../scripts/coc_character_creation_briefing.py`. The briefing is Markdown
only and lives under
`.coc/campaigns/<campaign-id>/assets/character-creation/`. It may use
`scenario.player_safe_summary`, public module metadata, source labels, era, and
structure type, but it must not read or summarize `keeper-secrets.json`.

## Spoiler Split

Keep player-safe summaries separate from Keeper-only material. Never reveal `keeper-secrets.json` content without `[spoiler_warning]` and confirmation.

## Handout Media

When a PDF page contains a player-safe image or handout, copy/extract the asset
under `.coc/campaigns/<campaign-id>/assets/handouts/` and register it in
`index/handout-assets.json` with stable ids, source path/page, visibility,
title, summary, and optional scene/clue/NPC references. In Codex, render a
player-visible image with an absolute Markdown image path only when the asset is
marked `player_visible`. In ZCode or text-only surfaces, show the title,
summary, and source page instead.

## 剧情图编译（Story-Graph Compilation）

当用户要"编译模组"/"生成剧情图"/"为 <模组> 准备 director"时：

1. 读模组 PDF（用 read/grep；中文模组直接读）。
2. 判定 structure_type（参考 references/compile-protocol.md 的 7 种原型判定）。
3. 按顺序产出 7 个 JSON 到 campaigns/<id>/scenario/（schema 见 references/story-graph-schema.md）：
   module-meta / story-graph / clue-graph / npc-agendas / threat-fronts / pacing-map / improvisation-boundaries
   - **story-graph.json 的 social/investigation 场景必须带 ≥2 条 `affordances`（含语义 `route_type`）；开场场景带 `storylet_tags`。** 详见 references/compile-protocol.md「场景多路线与 storylet 标签」。这让玩家在每个调查/社交场景都有选择权、不被线性推向单一出口。
4. 跑 `scripts/coc_scenario_compile.py --validate <dir>` 校验结构完整性。
5. 校验报告的缺漏逐个补，直到 errors 为空。
6. 写 player-safe recap + keeper-only recap。

关键约束：每个 critical conclusion 至少 3 条线索路径；keeper_secrets 与 player-safe 物理隔离。
