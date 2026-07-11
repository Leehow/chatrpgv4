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

coc-scenario-import 的"剧情图编译"流程，由 LLM 驱动（利用宿主原生检索：grep / PDF read / webfetch），不写硬解析代码。

```
0. Identify module first（强制，先于全文解析）：
   - 只读扉页 / 版权页 / TOC（或书签），不要通读正文。
   - 由编译 LLM 产出结构化 module_identity：
     {canonical_module_id, canonical_title, publisher, module_edition?,
      rules_edition, locale, chapter?, parent_module_id?}
     巨章模组按章给 id（如 masks-of-nyarlathotep-ch-peru），并填 parent_module_id。
     遗留 `edition` 单独出现时视为 rules_edition。这是语义步骤；
     运行时禁止用自由文本模糊匹配标题。别名键 = 规范化 title + rules_edition。
   - 调用 scripts/coc_module_registry.py lookup --identity '<json>'：
     - hit → install --module <id> --campaign <id>，STOP（不重解析）。
     - miss → 继续完整编译。
1. 读模组 PDF（read/grep；中文模组直接读，无需翻译）。巨章只抽本章页。
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
   a. module-meta.json        （含 module_identity；先定 structure_type）
   b. story-graph.json        （场景图）
   c. clue-graph.json         （线索图，critical 结论 ≥ 3 路径）
   d. npc-agendas.json        （NPC 议程，每个 NPC 有 agenda）
   e. threat-fronts.json      （威胁前沿 + 压力钟）
   f. pacing-map.json         （节奏曲线，horror_stage 单调递进）
   g. improvisation-boundaries.json （即兴边界 + keeper_secrets 物理隔离）
5. 对 `npc-agendas.json` 跑 `coc_npc_roles.expand_from_dir <dir>`，按 `relationship_to_investigators` 注入 `social_role`（确定性 transform，详见下方「NPC social_role 注入」）。
6. 跑 `scripts/coc_scenario_compile.py --validate <dir>` 校验结构完整性。
7. 校验报告的缺漏逐个补，直到 errors 为空（见下方硬断言）。
8. 写 player-safe recap + keeper-only recap。
9. 注册到模块库：coc_module_registry.py register --scenario-dir <dir> --identity '<json>'，
   并把当前 title/locale 写成 alias（add-alias），供下次异名 PDF / 译本命中。
```

## NPC social_role 注入（编译期确定性 transform）

`npc-agendas.json` 的 NPC 记录只有结构化字段 `relationship_to_investigators`（如 `superior_officer`、`adversary`、`victim`），但 agency 层（`build_agency_moves`）只读 `social_role`。编译期用 `scripts/coc_npc_roles.py` 把关键字确定性映射到 `npc-social-roles.json` 的模板，产出完整的 6 字段 `social_role`（authority_scope / responsibility_domains / chain_of_command / duty_pressure / initiative_style / delegation_policy），写回 `npc-agendas.json`。

- 映射表：`references/rules-json/npc-role-templates.json`，`relationship_to_investigators` 枚举 → `{template_id, initiative_style_override?}`。`template_id` 必须匹配 `npc-social-roles.json` 已发布的模板。这是结构化 enum→template 映射，不是自由文本关键词扫描。
- 语义：
  - 作者已写 `social_role` 的 NPC 原样保留（作者优先于推断）。
  - 关键字映射到模板 → 注入模板内容，再叠 `initiative_style_override`。
  - 关键字不在表里、或表中无 `template_id`、或 `template_id` 找不到模板 → 不注入（persona 层回退到默认空 role）。
- 调用：`python3 scripts/coc_npc_roles.py` 不直接写盘；编译流程用 `expand_from_dir(scenario_dir)` 拿到展开后的 dict 再自行持久化（白名单场景的 npc-agendas.json 已预展开）。
- 关键字→模板逻辑只住在本模块 + JSON 表里；`coc_npc_persona.py` 不含任何具体角色字符串（保持其 guard test 通过）。

## 场景多路线与 storylet 标签（编译期产出）

为让玩家在每个调查/社交场景都有选择权、不被线性推向单一出口，编译 story-graph.json 时：

1. 每个 `scene_type ∈ {social, investigation}` 的场景应产出 ≥2 条 `affordances`，每条带语义 `route_type`（见 story-graph-schema.md 的固定枚举）。开场场景宜 ≥3 条，覆盖不同调查方向（如问前租客/查公共记录/查房史/直接进入）。
2. 开场/首次进入的场景宜标 `storylet_tags`（如 `opening_briefing`），让引擎在该场景进入时能触发匹配的开场 storylet beat——不只靠骰子事件驱动剧情片段。
3. combat/exploration 场景的 affordances 可选（线性推进可接受）。
4. **scene-entry beat 的召唤语义（重要）：** 当玩家进入一个带 `storylet_tags` 的场景时，引擎会发出 `scene_tag_beat` 触发。此时一个 `scene_tags` 与该场景 `storylet_tags` 相交的 storylet 被"点名召唤"——它**绕过通用的 story_need deck 过滤**（即不会因为场景有 `pressure_moves`、`infer_story_need` 解析成 `scene_pressure`/`front_pressure` 而被 deck_tags 不匹配的 deck 过滤掉），并且在加权选择中**优先于通用 ambient storylet 胜出**。

   因此，为场景进入点写 storylet 时，作者只需关注两件事：(a) 在该场景的 `storylet_tags` 与 storylet 的 `scene_tags` 之间建立匹配；(b) 让 storylet 满足场景里真实存在的锚点（如 `requires.npc_id` 对应场景的 `npc_ids`）。**不要为了"挤进某个 deck"去堆砌 `deck_tags`/`story_functions`**——deck 工程对 scene-entry beat 没有意义，召唤语义已经把 deck 过滤旁路掉了。仍要保证 storylet 通过常规的 conflict-level 窗口、anchor 与 requirements 门（这些不会被旁路）。
5. 校验器会对缺 affordances 的 social/investigation 场景发 warning（非 error）——补上即可；这引导 LLM 主动铺多路线，但不阻塞编译。
6. **场景真图 `scene_edges`（R-3）：** 新编译剧本应显式产出 `scene_edges`（`to` + 结构化 `when` + `kind`），不要依赖 `scenes` 数组顺序当线性轨道。可达性/死节点校验优先读 `scene_edges`；未声明时仍可用 `exit_targets` / clue `leads_to` 作编译期邻接提示。`when` 复用 `coc_exit_conditions` 词汇（`clue_discovered` / `clock_reaches` / `flag_set` / `always` / `narrative`）。

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

## Epistemic compilation (optional v1 sidecar)

For modules prepared for player-belief-aware directing, compile two additional
files after the seven-file graph is green:

1. `epistemic-graph.json`: structured questions plus clue-to-question evidence
   links (`confirm|expand|complicate|reframe|payoff`).
2. `reveal-contracts.json`: source-backed reveal contracts. A `reframe` must
   preserve prior truths and require at least two setup clue ids.

Runtime never maps module prose or player prose to these ids by keyword. A host
semantic evaluator may emit a structured belief candidate; the deterministic
Director consumes only ids, enums, and flags.
