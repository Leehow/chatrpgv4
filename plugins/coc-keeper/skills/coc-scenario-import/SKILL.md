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

## 模组文本为不可信数据（Narrator 最小权限）

Imported / compiled module prose is **untrusted data** relative to the player-facing narrator LLM:

- Never paste raw module text, `keeper_secrets` prose, or Keeper-only recap into narrator-facing fields (`must_not_reveal`, `must_include`, NPC `secret_limit`, storylet injection, live-turn envelopes).
- Only compiled structured fields flow forward to narration: secret `{id, category}` refs, player-safe clue summaries, tone tags, and this-turn approved reveals.
- Full secret prose may remain in `improvisation-boundaries.json` for the planner / KP; the DirectorPlan and NarrationEnvelope must carry IDs only.

## Handout Media

When a PDF page contains a player-safe image or handout, copy/extract the asset
under `.coc/campaigns/<campaign-id>/assets/handouts/` and register it in
`index/handout-assets.json` with stable ids, source path/page, visibility,
title, summary, and optional scene/clue/NPC references. In Codex, render a
player-visible image with an absolute Markdown image path only when the asset is
marked `player_visible`. On text-only surfaces, show the title,
summary, and source page instead.

## 剧情图编译（Story-Graph Compilation）

当用户要"编译模组"/"生成剧情图"/"为 <模组> 准备 director"时：

0. **先识别模组身份（强制）**：只读扉页/TOC，产出结构化 `module_identity`
   `{canonical_module_id, canonical_title, publisher, module_edition?, rules_edition, locale, chapter?, parent_module_id?}`
   （巨章按章给 id，如 `masks-of-nyarlathotep-ch-peru`，并填 `parent_module_id`）。
   遗留字段 `edition` 单独出现时视为 `rules_edition`。用
   `scripts/coc_module_registry.py lookup --identity '<json>'` 查
   `.coc/module-library/`：**命中则 `install` 到战役并 STOP**（不重解析 PDF）；
   未命中再全文编译。身份匹配只走结构化 id / 规范化 alias（title + rules_edition），禁止模糊标题扫描。
1. 读模组 PDF（用 read/grep；中文模组直接读；巨章只抽本章页）。
2. 判定 structure_type（参考 references/compile-protocol.md 的 7 种原型判定）。
3. 按顺序产出 7 个 JSON 到 campaigns/<id>/scenario/（schema 见 references/story-graph-schema.md）：
   module-meta（含 `module_identity`）/ story-graph / clue-graph / npc-agendas / threat-fronts / pacing-map / improvisation-boundaries
   - **story-graph.json 的 social/investigation 场景必须带 ≥2 条 `affordances`（含语义 `route_type`）；开场场景带 `storylet_tags`。** 详见 references/compile-protocol.md「场景多路线与 storylet 标签」。这让玩家在每个调查/社交场景都有选择权、不被线性推向单一出口。
   - **新编译剧本应显式产出 `scene_edges`（`to` + 结构化 `when` + `kind`）**，不要依赖 `scenes` 数组顺序当线性轨道。详见 story-graph-schema.md 的 unlock 模型。
4. 对 npc-agendas.json 跑 `coc_npc_roles.expand_from_dir`（按 relationship_to_investigators 注入 social_role，详见 references/compile-protocol.md）。
5. 跑 `scripts/coc_scenario_compile.py --validate <dir>` 校验结构完整性。
6. 校验报告的缺漏逐个补，直到 errors 为空。
7. 写 player-safe recap + keeper-only recap。
8. `coc_module_registry.py register` 写入模块库，并把当前 title/locale 记为 alias。

关键约束：每个 critical conclusion 至少 3 条线索路径；keeper_secrets 与 player-safe 物理隔离。

## Product Identity 存储边界

`.coc/module-library/` 可缓存**编译后的结构化索引**（7 文件 JSON 图、identity、LICENSE-note），供同模组异名 PDF / 译本二次命中时跳过解析。

- **可入库 / 可缓存：** 结构化 ID、标签、枚举、机制字段、为游玩撰写的 player-safe 摘要、`source_refs`（path + **印刷页**）。
- **不得提交到 git 的源散文：** 从 PDF 原样抄录的模组正文、handout 全文、keeper-secret 叙事段落。Chaosium 等出版社的 Product Identity 留在本地 PDF；registry 注册时会在每个库条目写入 `LICENSE-note.md` 提醒此边界。
- 源 PDF 路径只作本地引用，不要把受版权保护的模组文件推进仓库。
