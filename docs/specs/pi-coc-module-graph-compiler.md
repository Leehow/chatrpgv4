# ModuleGraph 编译器：把 PDF 真的读成图谱

## 0. 一句话

现在「解析」一本 20 页模组用 **0.27 秒**，产出 1 个地点（书名）、0 个 NPC、
0 条线索——因为它**从来没有读过书**。这份规格定义把那 20 页真的读一遍、产出
图谱、并且**证明它没有编造**的那条路。

## 1. 已量到的现状（2026-09-03，《他们也没想太多》）

| 层 | 有什么 | 数量 |
|---|---|---|
| L0 证据 | `pages/*.md`，原生中文文本 | 20 页 / **33 280 字符** |
| L1 结构 | `outline.json`，`confidence: exact` | **41 行** |
| L1 骨架 | `skeleton.json` | **1 个地点**（值是书名，`parse_state: toc_only`）、0 条机制、无 `npcs` 字段、`conclusion_buckets: None` |
| L2 图谱 | — | **不存在** |
| L3 投影 | `scenario/*.json` | clues 0、locations 0、npcs 0、timeline 0 |

L1 已经识别出这本书的真实结构（任务开始、欢迎宴、位阶挑战与斗酒、布拉丹的政变、
国王遇刺、**三个分支**、女神之约、终章；12 个 NPC；6 位预设调查员；3 张 handout）。
页文本里有技能检定（洞察／灵感）、分支条件、结局。**材料齐备，缺的是读它的那一步。**

### 1.1 两个被推翻的前提

- **「并发解析能提速」**——解析不慢，是 0.27 秒的簿记；慢的那半没执行。
- **「20 页要切片并发」**——33KB 全书一次性放得进单个模型上下文。切片是给长模组
  （Masks 级）准备的，不是这本。`progressive.claim_host_work` 一次可租 40 组
  （2026-09-03 从 4 提到 40，schema 改为从 `MAX_CLAIM_LIMIT` 派生），
  **按 unit 切，短模组一个 unit = 全书**。

## 2. 分层：慢的是理解，快的是编译

借自 chatrpgv5 的 `module.md` 流水线，但**产出结构化稿的那一步归模型，不归人**。

| 环节 | 谁做 | 性质 |
|---|---|---|
| 读页、判断哪些是场景／NPC／线索／keeper-only，写成 claims | **模型**（v5 是人） | 内容判断，慢 |
| claims → 类型化 → 打包 → lint → 哈希 | 编译器 | 确定性，毫秒 |

买到三样：**确定性**（同样输入同一个 packHash）、**即时反馈**（lint 毫秒级打回）、
**安全**（模组文本自始至终只产生惰性数据，不可执行）。

## 3. 自审循环：模型迭代，闸门确定

```
pages + outline
   → 抽取 pass（模型）：产出 claims，每条带 source_refs
   → 闸一 结构 lint（机器）：15 条既有检查
   → 闸二 源头接地（机器）：claim 的名字与数字必须出现在所引页上
   → 有 finding → 原样回给模型 → 改 → 重跑
   → 双闸全绿 → 打包 → packHash → 投影七份 IR
```

### 3.1 为什么必须是两把尺子

`coc_module_reachability.py` 已有 15 条结构检查（`edge-target-unknown`、
`clue-unplaced`、`conclusion-without-clues`、`scene-unreachable`…）。它们查的是
**图自洽**，查不了**忠实**：一份场景连通、线索可达、时间线自洽、但书里根本没有
那个 NPC 的图，会全绿通过。

而且它现在把 `source_refs` 只当作**降级理由**（有溯源就把缺陷标成 pending），
不检查那条溯源是否属实。

只留结构 lint，自审循环会把「编造」优化成「**结构工整的编造**」——模型会学会讨好
闸门。这个仓库已经踩过同一族两次：**校验器只查交代不查内容**、**coverage 是自述
不是结构**。

### 3.2 闸二的判据

对每条 claim：

1. `source_refs` 非空，且每个 `pdf_index` 在本 bundle 的已接受页范围内；
2. claim 里的**专名**（NPC 名、地点名）必须在所引页文本中出现；
3. claim 里的**数字**（技能值、伤害、人数、年份）必须在所引页文本中出现——
   含个位数，规则就住在个位数里；
4. 违反 → finding，**不降级**，回给模型。

已有工具：`document-ir-extraction` skill 的
`scripts/check_number_provenance.py` 走 `source_refs` 约定做的正是第 3 条。
新增的是 1、2 与「不许降级」。

### 3.3 采纳新检查前

在**已知好**与**已知坏**两份产物上各跑一遍：对干净的模组保持安静，对一份人工
注入编造的产物必须报出来。只在坏样本上响、不在好样本上响，才算这把尺子成立。

## 4. 输出：七份 canonical IR

编译器产出 `coc_compiled_archive.CANONICAL_IR_FILES` 那七份，
经 `project_skeleton_to_campaign` 落到战役：

| 文件 | 来自 | 终局判据 |
|---|---|---|
| `story-graph.json` | 场景节点 + 分支边 | **场景 ≥ 8** |
| `clue-graph.json` | 结论桶 + 线索 | **≥ 1 条结论带 clues** |
| `npc-agendas.json` | NPC | **≥ 8** |
| `threat-fronts.json` | 威胁线 | — |
| `pacing-map.json` | 节奏 | 不许伪造：无来源就 `parse_state: unresolved` |
| `improvisation-boundaries.json` | 可编造边界 | 同上 |
| `module-meta.json` | 年代／地点／内容标记 | 年代必须是 canonical 记号 |

**每个节点可溯源到页码**（`source_refs`），这是终局判据之一，也是闸二的输入。

## 5. 与开场快速事实的关系

`setup.adopt_source_facts` 的六项开场事实**是这条路的前身**：读 3 页、答 6 个
字段、7 分 20 秒。消费者侧已于 2026-09-03 退休（引导不再有 `source-review`）。

年代／地点由 `module-meta.json` 供给之后，canonical 那半也可以退休。在此之前
`campaign.era` 仍由 `setup.adopt_source_facts` 写入，且必须是
`coc_state.resolve_era_key` 认得的记号——散文答案会被拒绝而不是静默退回 1920s
（2026-09-03 修复：一本罗马模组曾被静默记成 1920 年代）。

## 6. 验收（真产物，不是测试绿）

1. 《他们也没想太多》20 页 → story-graph 场景 ≥ 8、clue-graph ≥ 1 条带 clues 的
   结论、npc-agendas ≥ 8，每个节点带 `source_refs`；
2. 闸二在一份**人工注入编造**的 claims 上必须报出来（变异验证）；
3. 同一输入重跑 → 同一 packHash；
4. **把这本从头玩到终章**——不是几个回合，是走完场景与分支；
5. 玩测中 KP 至少使用一条图里的线索，而不是即兴编的。

判据 5 是防空心交付的那一条：图谱建好了但 KP 不读，等于没建
（参见 `ir-fields-must-match-consumer`、`give-the-kp-a-chain-not-more-panels`）。

## 7. 不做什么

- 不为「性能」切片：这本不需要，长模组才需要。
- 不加硬编码的语义列表（年代别名、NPC 名单、线索关键词）去凑 lint——那是被
  明令禁止的做法，也是把编造制度化。
- 不在图谱之外再开第二个「LLM 理解原文」的入口。
  `coc-pdf-skill-adapter` 的抽取半边仍在做这件事，属单脊柱规格 Stage G 的余额。
