# 模组来源管线统一：单脊柱与七文件退休

> **Status:** Spec accepted (user-authorized 2026-09-01) — Stage A implemented;
> Stage B forward path proven on a real module at a live table, natural play
> partial; Stages C–E pending. Evidence:
> [Stage A](../status/module-pipeline-unification-stage-a.md)、
> [Stage B](../status/module-pipeline-unification-stage-b.md)。
> **ID:** `pi-coc-module-source-pipeline-unification`
> **Track:** `ACTIVE_IMPLEMENTATION_TRACK=pi-coc`; Codex-host 实现 off-limits。
> **Scope:** 把「PDF 解析 → 模组语义理解 → 运行时消费」收敛为一条单脊柱；定义
> ModuleGraph 对七份 Scenario IR 的正向投影合同与外部 coc-pdf-pipeline 的收缩
> 退休路径。
> **Depends on:** [module-knowledge-graph-extraction.md](module-knowledge-graph-extraction.md)、
> [module-graph-to-kp-integration.md](module-graph-to-kp-integration.md)、
> [pi-coc-causal-quest-system.md](pi-coc-causal-quest-system.md)。
> **Authorization:** 用户已明确授权本 spec 涉及的共享 `plugins/coc-keeper/`
> 文件修改（2026-09-01 当轮授权，含 Stage A 的 kernel/skill 文件清单）。

本文中的 MUST / MUST NOT / SHOULD 是验收要求。

---

## 1. User job

用户要把「PDF 模组 → 可玩战役」做成一条不别扭的管线。别扭的根源已确诊为
**双脊柱**：同一本模组的语义理解存在两条平行权威——

1. 外部 `~/.pi/coc-tools/coc-pdf-pipeline` 三波 agent 直抽七份 Scenario IR
   （生产在用）；
2. 仓库内 ModuleGraph 编译器（source-compiler 阶段已验收，`module.context`
   已接入查询面，但七文件投影 pending）。

[module-knowledge-graph-extraction.md](module-knowledge-graph-extraction.md)
自己就把「同一模组长期维护两套语义抽取权威」列为 hollow delivery，现状恰好是
这个形态。历史上六例「两边各自都对、中间断了、全程零报错」的契约断层
（keeper_notes 死字段、538 条死边、白名单裁剪等）全部长在两套系统的缝里。

成功意味着：

- 一本模组的原文只被 LLM 语义理解**一次**（ModuleGraph 编译）；
- 七份 Scenario IR、scene.context 投影、Director graph 输入全部是**确定性代码
  投影**，投影契约在仓库内有 parity 测试，白名单断层类 bug 在测试期就红；
- 外部工具收缩为纯证据供应商（PDF → source bundle），抽取 prompts/validators
  与它们必须匹配的消费契约在同一仓库同版本演进；
- 长模组按 playable unit 渐进构建，coverage 诚实标注 `unresolved`，deepen 由
  真实游玩驱动；
- 每个阶段完成都在**减少**系统里的东西（删一条重复路径），而不是净增产物。

Hollow delivery 包括：

- 新增投影层却不退休直抽路径，双脊柱变三脊柱；
- 投影器只对 starter 的反向构建图（IR→graph→IR）恒真通过，正向路径
  （语义图→投影记录→IR）从未被真实模组走通；
- parity 测试只对手写 fixture 绿，从未对真实模型抽取的图运行；
- 把「组件测试通过」当成「管线已切换」；
- 为通过校验在投影记录里编造消费端字段的值（静默编造比静默删除更危险）。

---

## 2. 目标架构：单脊柱

```text
PDF（仓库外，永不进 repo）
 └─ L0 证据层   外部工具唯一职责：PDF → source bundle
 │             （逐页 Markdown + hash + 0-based pdf_index + layer fast/detail）
 │             producer 无关：Firecrawl / PaddleOCR / MinerU 谁产都行；
 │             契约面是 coc_pdf_bundle 合同，不是任何具体工具
 └─ L1 结构层   全书 section 索引 → section plan
 │             （页范围 / 语义角色 / 默认可见性 / 待抽 aspects）
 └─ L2 语义层   ModuleGraph 编译 —— 全系统唯一一次 LLM 理解原文
 │             identity shard 先行 → aspect shards → 独立 review → merge
 └─ L3 投影层   纯确定性代码，零 LLM：
 │             七份 Scenario IR、compiled archive、Director graph 输入、
 │             handout 包，全部由图 + 投影记录物化
 └─ L4 运行层   scene 绑定卡（预拼链条）+ module.context 兜底查询
               + play 驱动的 bounded deepen（复用 steward 生命周期）
```

层间权威法则（与既有 spec 一致，不重复其条款）：证据权威归 source bundle；
语义权威归 accepted ModuleGraph；运行时物化视图可删除重建；campaign canon
在另一权威面。

---

## 3. 六项决策（其中 D1–D3 回答 extraction spec §21 的悬置问题）

### D1 — ModuleGraph 是唯一语义权威；七份 IR 降级为确定性投影

- graph-backed 模组的七份 Scenario IR MUST 由投影层从 accepted ModuleGraph +
  投影记录物化生成；cutover（Stage D）后 MUST NOT 再对同一模组运行直抽七文件
  的第二次语义理解。
- committed / installed 的物化视图 MUST 与 fresh projection 逐字节语义相等
  （parity）；drift 使测试与安装 fail closed。
- 投影记录（runtime projection records）是图的一部分或图 digest 绑定的
  sidecar（见 §4），不是第二份语义真相：它们可随图重建，语义审查发现错误时
  回到来源重抽，不手改。

### D2 — 外部工具收缩为纯证据供应商；L1 结构索引进仓库

- `coc-pdf-pipeline` 的最终形态只保留 L0：PDF 识别、native 抽取、OCR 应答。
  其 `extract` 波次（七文件 prompts/validators）在 Stage D 后删除；其
  structure/sections 索引在 Stage C 迁入 `coc-scenario-import` 所属的仓库侧
  section 规划（extraction spec Step 2 的 parent planner 就是它的归宿）。
- OCR 需求信号反向流动：仓库侧判定哪些页需要 detail 层（保留两条确定性规则：
  `payload ∈ {entity_stats, character_sheet, handout, table}` 与 stat-block
  数值密度检查），emit host-work 请求，外部工具补 OCR 出 bundle 修订。复用
  既有 progressive host-work 生命周期，不新建队列。
- MinerU（本地 / leehow-pc VLM）作为 producer 接入 bundle 合同是独立小活，
  不阻塞任何 Stage；接入时 MUST 满足既有 `coc_pdf_bundle` 合同原样，不得
  为它开合同分叉。
- **producer 的 `source_id` MUST 是模型可投影的语义 id**（命名空间 ∈
  `pdf:/module:/source:/handout:`，其后为小写 kebab/点/下划线段，无空段、无
  hash 形 token）。它会随 `source_refs` 一路进入 KP 的模型面：消费端
  （`tool-contract-projection.ts` 的 `isNamespacedSemantic`）读不懂的 id 会被
  丢弃，而任一身份被丢弃就使整份 canonical result fail closed。因此这条在
  **bind 时 fail closed**（`coc_pdf_bundle.semantic_source_id_problem`），
  报错直接给出改法；`tests/test_pdf_bundle_source_id.py` 从消费端源码里解析
  其正则与命名空间集合做等价钉死，两边不得再各自漂移。

### D3 — 渐进机制统一为 coverage 驱动的一套

- identity + structure shard 永远先建（实测依据：11/11 模组开头 1–3 页为
  Keeper truth；9/11 模组的 stat blocks 无位置边可达，必须全书 section 索引）。
- 内容 shards 按 section × aspect 排队：短模组一次排完即 `complete`；长模组
  只建当前 playable unit，其余诚实 `unresolved`。
- deepen 请求 = 精确 section/node refs，复用既有 steward/source-worker
  生命周期；`module.context` 的 source gap 是 deepen 的输入，不是阻塞游玩的
  门。外部工具的 whole_book/on_demand 策略与图谱 coverage 在 Stage C 合并后
  只剩后者；offset 置信门保留，`blocked` 优于猜错。

### D4 — 运行时给 KP 的是链条不是面板

- 投影层预拼「scene 绑定卡」：scene → 绑定的 NPC / clue / handout / mechanics
  邻域，随 scene.context 一起到桌；`module.context` 只兜自由查询的底。
- 要 KP 自己用三个查询拼装的信息等于没给（既有教训，此处冻结为投影层职责）。

### D5 — 校验教义整体平移，不重写

以下既有教义对投影层同样是 MUST：

- **accounting, not content**：投影记录校验「有没有交代」，不硬编码「答案是
  什么」；每个消费端字段要么是有来源的值，要么是显式的缺失说明。
- **数值溯源**：投影记录中的数值继承其图节点的 evidence 绑定；投影层不引入
  任何图里没有的数字。
- **指纹检查**：每修一类契约断层，加一条按指纹抓错配的确定性检查（如
  「操作性内容落在无消费者字段而消费端字段为空」）。
- **真实验收**：组件测试证明组件契约；产品声明只来自 window-equivalent play。

### D6 — 长模组策略

- `print-precedes` only；不从出版顺序制造 `play-precedes` 或 hard gate
  （Masks 验收已证明：7 条出版边、0 条游玩边）。
- per-unit builds + play 驱动 deepen；`blocked` 优于错误的 unit 边界。

---

## 4. 运行时投影合同（generalized）

### 4.1 ProjectionSet

`coc.module-graph-runtime-projection.v1` 从 starter 专用泛化为模组无关合同。
投影数据的规范形状是 **ProjectionSet**：

```json
{
  "contract_id": "coc.module-graph-runtime-projection.v1",
  "module_id": "module-<semantic-id>",
  "documents": [
    {
      "filename": "story-graph.json",
      "root": {"...": "非集合的文档根字段"},
      "collections": [
        {"name": "scenes", "node_ids": ["scene-...", "scene-..."]}
      ]
    }
  ]
}
```

每个被引用节点携带一条 `properties.runtime_projection`
`{document, collection, record}`；`record` 是该文档 collection 里的一条完整
运行时记录。两种合法载体：

- **embedded**：声明与记录都在 module 节点 / 成员节点的 properties 里
  （the-haunting starter 现状，保持合法）；
- **sidecar**：`runtime-projection.json` 与 graph generation 同目录、绑定
  graph digest（fresh 编译模组的正向路径产物）。

两种载体 MUST 通过同一个泛化校验/投影内核；投影结果 MUST 与载体无关。

### 4.2 正向路径（fresh 模组）

```text
accepted ModuleGraph
  -> prepare-projection（机器）: 闭合 ProjectionPacket
       （目标文档、collection specs、候选语义节点的 model-safe 视图）
  -> 投影抽取 pass（模型）: 按节点授权 runtime records
  -> validate（机器）: 节点绑定、身份、语言、字段 accounting、指纹检查
  -> attach（机器）: 写 digest-bound sidecar，原子安装
  -> project（机器）: 物化七份 IR，parity 报告
```

- ProjectionPacket 与 GraphShard packet 同族：闭合、model-safe、evidence 经
  图节点间接绑定；模型 MUST NOT 引入图外数字或图外实体。
- 投影抽取 pass 是「运行时形状的重述」，不是第二次读原文：它的输入是图节点
  语义 + 其 evidence spans，不是 PDF 页。
- 校验器 MUST 拒绝：引用不存在节点、同文档重复绑定、语言污染（graph
  `source_languages` 之外的语言写入 canonical 字段）、未注册的顶层字段
  （防 keeper_notes 类死字段复发）。

### 4.3 Parity 法则

- `check-parity(graph+projection, ir_dir)` 是 Stage D cutover 的验收工具：
  对每个文件报告 equal / missing / drifted。
- committed starter 的物化视图 MUST 持续等于 fresh projection（既有测试保
  留）；graph-backed campaign 安装时 drift MUST fail closed。

---

## 5. 分阶段退休路径

每个 Stage 有独立完成合同；跳阶宣称完成是 hollow delivery。

### Stage A — 泛化投影内核（implemented 2026-09-01）

1. 新增 `plugins/coc-keeper/scripts/coc_module_projection.py`：模组无关的
   ProjectionSet 校验、物化、parity、闭合 ProjectionPacket 准备与投影记录
   校验；
2. `coc_starter_graph.py` 的校验/物化委托给该内核（一个投影器，不是两个）；
3. 确定性测试覆盖：embedded 与 sidecar 载体、dangling 引用、语言污染、
   未注册字段、parity drift；
4. 既有 starter 测试保持绿。

**完成合同：** 内核对 the-haunting embedded 图与合成 sidecar fixture 均可
校验/物化/parity；正向 packet 准备器可从 installed graph 产出闭合 packet。
本 Stage 不宣称任何真实模组已走通正向路径——那是 Stage B。

### Stage B — 一本真实短模组的正向打通（forward path proven 2026-09-01）

1. 选一本已 accepted 图的短模组，真实模型跑投影抽取 pass（story-graph 域
   先行），机器校验 + parity；
2. `coc-scenario-import` 消费 prepare/validate/attach CLI，成为正向路径的
   canonical caller；
3. 一次 fresh Pi-Coc RPC 真实游玩，KP 从投影出的 IR 正常开局。

**完成合同：** 真实模组、真实模型、真实游玩三者齐备才可标 `integrated`。

**2026-09-01 实测结论**（《不息的渴望》，zh-Hans，41 页）：前两项已满足——9 个
shard 经真实模型抽取、独立审查、确定性接受，图 86 节点，投影出的七文件 IR 通过
`validate_compiled_scenario`（0 错 0 警）与 parity；Grok 4.5 在真实 RPC 桌上用
模组自己的开场与时钟开桌，并以投影出的人物卡跑了一个真骰调查回合。第三项只完成
到第二回合：一个既有的「大失败 → 特殊影响 → roll handle 失效」引擎缺陷卡住封账，
与模组投影无关，留给其归属轨。详见 Stage B 状态文档。

### Stage C — L1 迁入仓库 + 渐进统一

structure/sections 规划进 `coc-scenario-import`；OCR 需求走 host-work 请求；
外部工具删 structure/sections 索引；两套渐进合一（D3）。

### Stage D — cutover 与删除

graph-backed 模组禁止直抽七文件；外部工具删 `extract.mjs` 与七套
prompts/validators（教义并入图谱侧 review 清单与本 spec §3-D5）；此后
七份 IR 只能来自投影。

### Stage E — 长模组

Masks 第一章按 D3/D6 建图并投影，真实游玩中以 deepen 补后续 unit。

**冻结期规则：** Stage B 绿之前，外部工具的 extract prompts 冻结（不修不
补），避免双写期两边漂移。

---

## 6. 确定性校验（Stage A 范围）

自动化测试对以下事项具有权威：

- ProjectionSet 合同形状与 contract_id；
- 两种载体到同一内部形状的加载等价；
- 投影节点绑定：每条 record 恰绑定一个存在的图节点，无重复、无 dangling；
- 物化输出与载体无关；
- parity 报告对 equal / missing / drifted 三态的正确判定；
- 语言守恒：canonical 记录不携带 graph `source_languages` 之外的语言脚本
  （以 CJK 守卫实现，与既有 starter 英文守卫同构）；
- 字段注册：record 顶层字段必须属于该文档的已注册字段集，未注册字段给出
  exact finding（防死字段）；
- ProjectionPacket 的 model-safe 性：无 hash、path、opaque ID；
- 空图、零节点、缺 projection 声明不得 vacuous pass。

自动化测试 MUST NOT 用关键词推断记录的语义质量、场景好坏或模组理解正确性。

---

## 7. Failure semantics

| Failure | Required behavior |
| --- | --- |
| projection 声明缺失/合同不符 | fail closed，exact finding；不回退到猜测 |
| record 引用不存在节点 | 拒绝；不做最近名替换 |
| 同文档字段未注册 | 拒绝并列出字段名；注册需改合同+测试，不静默放行 |
| 语言污染 | 拒绝；翻译属于 KP presentation 层 |
| sidecar digest 与 graph 不符 | 拒绝加载；重新 attach |
| parity drift | 安装 fail closed；报告 per-file 差异 |
| 投影抽取模型不可用 | Stage B 起：保持 pending，不降级为代码拼装语义 |

---

## 8. Non-goals

- 不新建第二 PDF 解析器或 OCR 依赖（PDF Source Bundle Contract 不变）；
- 不引入 Neo4j / embedding / GraphRAG；
- 不改变 campaign state、rules、finalization、Git history 权威；
- 不在本 spec 实现 causal.context / Quest v2；
- 不迁移历史非 graph-backed campaign（clean-slate 政策不变）；
- Stage A 不宣称任何产品能力变化。

---

## 9. Cross-references

| Source | Relationship |
| --- | --- |
| `module-knowledge-graph-extraction.md` | L2 语义层权威；本 spec 回答其 §21 悬置决策 D1–D3。 |
| `module-graph-to-kp-integration.md` | L4 查询面权威；其 §4.2 staged retirement 由本 spec §5 具体化。 |
| `plugins/coc-keeper/skills/coc-scenario-import/SKILL.md` | 唯一 parent import owner；Stage B 起为正向路径 canonical caller。 |
| `plugins/coc-keeper/scripts/coc_starter_graph.py` | embedded 载体的既有实现；Stage A 委托内核。 |
| `Agents.md` → PDF Source Bundle Contract | L0 证据层合同，不变。 |
