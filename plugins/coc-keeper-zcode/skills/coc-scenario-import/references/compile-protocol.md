# Compile Protocol

`coc-scenario-import` 的"剧情图编译"流程指引：如何判定模组的 `structure_type`，以及完整的解析步骤序列。源 spec：`docs/superpowers/specs/2026-07-05-story-director-design.md` 的 "Module Structure Types" 与 "Module Compilation" 章节。

---

## 7 种 structure_type 判定指引

每个原型来自对 12 个参考模组的归纳。按下列特征判断模组属于哪一类（填入 `module-meta.structure_type`）。如果模组同时强满足多个原型的核心特征，归为 `hybrid_mega`。

### 1. `linear_acts` — 线性 / 分幕

**代表模组：** Cursed Be the City, King of Shreds

**核心特征：**
- 模组按 Act I / II / III 显式分幕，场景顺序推进。
- 每个 Act 有明确的进入触发和结束触发。
- 后续场景依赖前置场景的结论。

**director 能力需求：** scene 顺序推进、分幕转场。

---

### 2. `time_loop` — 时间循环

**代表模组：** An Amaranthine Desire

**核心特征：**
- 模组核心机制是时间迭代（一天/一夜重复）。
- 跨迭代保留"知识状态"但物理状态重置。
- 玩家通过累积信息打破循环。

**director 能力需求：** 跨迭代记忆/知识状态追踪、循环边界转场。

---

### 3. `branching_investigation` — 分支调查（线索沙盒）

**代表模组：** Cold Harvest, Dust to Dust, The Haunting

**核心特征：**
- 无主线性场景顺序；多个线索源可任意顺序访问。
- 核心 = 线索图（clue graph）+ lead graph，结论靠多路径线索汇聚。
- 玩家自主选择调查方向。

**director 能力需求：** 无序线索图、lead graph、fallback route 调度。

---

### 4. `hub_sandbox` — 据点式地点沙盒

**代表模组：** 人煎百味, Garden of Earthly Delights

**核心特征：**
- 一个据点（城镇/区域）+ 一组可自由移动访问的地点列表。
- 每个地点有独立的地点触发场景。
- 时间通常宽松，玩家自定行程。

**director 能力需求：** 地点列表、自由移动、地点触发场景。

---

### 5. `multi_faction` — 多阵营政治网

**代表模组：** They Did Not Think It Too Many

**核心特征：**
- 多个对立/中立阵营，各有议程。
- 解决路径偏社交/政治（结盟、平衡、背叛）。
- 阵营关系随玩家行动动态变化。

**director 能力需求：** 阵营关系模型、社交解决路径、NPC 议程交织。

---

### 6. `campaign_sequel` — 战役续作

**代表模组：** Herald of the Yellow King

**核心特征：**
- 是一个战役/系列模组的后续章节。
- 依赖跨模组状态（前作的结论、伤害、关系）。
- 前作角色可能回调。

**director 能力需求：** 跨模组状态、前作角色回调、长线伏笔兑现。

---

### 7. `hybrid_mega` — 混合巨结构

**代表模组：** 血色公路（111 页，129 书签）

**核心特征：**
- 同时强满足多个原型的核心特征（如沙盒 + 时间线 + 地牢）。
- 体量大、书签多、子系统叠加。
- 终极压力测试：能跑通它，引擎对其他原型就有信心。

**director 能力需求：** 全部能力组合、强 fallback、子系统频繁切换。

**特殊排除：** 非场景资料书（如"黑暗时代的哈斯塔崇拜"——Coven vs Court 分类法）应被检测并排除出 scenario 路由，不归入任何 structure_type，不编译剧情图。

---

## 解析步骤（Layer 1 — LLM 解析）

coc-scenario-import 的"剧情图编译"流程，由 LLM 驱动（利用 zcode 原生检索：grep / PDF read / webfetch），不写硬解析代码。

```
1. 读模组 PDF（read/grep；中文模组直接读，无需翻译）。
2. 浏览目录/书签/章节标题，估计模组规模与组织方式。
3. 判定 structure_type：
   - 检查是否显式分幕 → linear_acts
   - 检查是否有时间循环机制 → time_loop
   - 检查是否多线索源汇聚结论 → branching_investigation
   - 检查是否据点 + 地点列表 → hub_sandbox
   - 检查是否多阵营政治网 → multi_faction
   - 检查是否依赖前作/跨模组状态 → campaign_sequel
   - 多原型核心特征同时强满足 → hybrid_mega
   - 资料书/无场景结构 → 排除，不编译
4. 按下列顺序产出 7 个 JSON 到 campaigns/<id>/scenario/：
   a. module-meta.json        （先定 structure_type，作为其余 JSON 的权重依据）
   b. story-graph.json        （场景图）
   c. clue-graph.json         （线索图，critical 结论 ≥ 3 路径）
   d. npc-agendas.json        （NPC 议程，每个 NPC 有 agenda）
   e. threat-fronts.json      （威胁前沿 + 压力钟）
   f. pacing-map.json         （节奏曲线，horror_stage 单调递进）
   g. improvisation-boundaries.json （即兴边界 + keeper_secrets 物理隔离）
5. 跑 `scripts/coc_scenario_compile.py --validate <dir>` 校验结构完整性。
6. 校验报告的缺漏逐个补，直到 errors 为空（见下方硬断言）。
7. 写 player-safe recap + keeper-only recap。
```

## 编译期硬断言（Layer 2 — 脚本校验）

`coc_scenario_compile.py --validate` 检查项（不通过则报告具体缺漏，让 LLM 补）：

- 每个 `importance: critical` 的 conclusion 的 `clues.length >= minimum_routes`（默认 3）
- 每个 scene 的 `dramatic_question` 非空
- 每个 NPC 有非空 `agenda`
- `module-meta.structure_type` ∈ 7 合法值
- `improvisation-boundaries.keeper_secrets` 与 player-safe 内容物理隔离
- `pacing-map` 的 horror_stage 序列在场景访问顺序上大体单调递进（ordinary→wrongness→pattern→revelation）

## 关键约束

- 每个 critical conclusion 至少 3 条线索路径（避免玩家卡死）。
- `keeper_secrets` 与 player-safe 物理隔离（绝不混入玩家可见的 recap/scene/clue）。
- schema 是"提示"不是"约束代码"：参考 `references/story-graph-schema.md` 的字段名 + 说明 + 完整示例。
- 剧情图质量直接决定 director 的"灵魂"——Layer 2 校验不绿不交付。
