# CoC Director 全维度问题清单（供 GPT Pro 咨询）

> **本文档汇总 The Haunting 完整跑局暴露的所有问题，按 D1-D6 六个评估维度组织。**
> 之前的文档（`2026-07-06-rule-result-loop-problem.md`）只覆盖了 D1 的回路缺口；本文档是完整版。
> v4 跑局数据：`.coc/playtests/haunting-fullrun/session-report-v4.json`（15 回合，The Haunting）
> v3 对比基线：`chatrpgv3/artifacts/sim-haunting-fullrun.md`

## 项目背景（简述）

Call of Cthulhu 7e（40 周年规则书）的 Codex 插件。核心是一个 **deterministic 剧情导演层**（coc_story_director.py），每回合读规则状态 + 模组剧情图，产出 DirectorPlan JSON。

```
coc_story_director  = 导演脑（deterministic，选动作 + 评分）
coc-keeper-play     = 叙事层（LLM 读 DirectorPlan 写中文散文）
coc_roll/sanity/... = 裁判层（规则引擎，骰值/SAN/伤害）
coc_director_apply  = 写回层（plan 效果落盘：clue/tension/scene）
coc_playtest_driver = 多回合跑局驱动器（player→director→rules→apply 循环）
```

**核心理念：禁止硬编码文字判定，用 LLM 语义方式约束。** director 是 deterministic 的（选动作），但不写叙事文本；叙事由 LLM 按 narrative_directives 语义生成；规则数据从 JSON 读。

## 评分总表

| 维度 | v3 | v4 | 差距 | 一句话问题 |
|---|---|---|---|---|
| D1 规则合规 | 4 | 3 | -1 | 骰值全对，但失败不 gate 揭示（骰值沦为剧场效果） |
| D2 剧情覆盖 | 2 | 4 | +2 | 调查主线走完，但没到终战（house/basement/confrontation） |
| D3 叙事沉浸 | 4 | 3 | -1 | 契约扎实但 beats 单薄 + 内嵌 roll/reveal 矛盾 |
| D4 自主推进 | 1 | 4 | +3 | 4 次自主转场，但 RECOVER stall loop（idle 时死循环） |
| D5 事件流 | 3 | 3 | 0 | 字段完整但 sanity 检定未接入 driver |
| D6 节奏张力 | 2 | 3 | +1 | 有升级曲线但只到 medium，15 回合全 investigation 节奏单一 |

**核心矛盾：v4 在 D4（自主推进）取得决定性突破（v3 最致命的病），但其他 5 个维度仍有真实问题，没有一项到 5 分。**

---

## D1 — 规则合规性（v4: 3/5）

### 问题：检定失败不 gate 线索揭示

**现象：** driver 执行了检定（骰值 100% 正确），但失败结果不回写影响揭示。

```
T5: Library Use 82/50 = 失败 → 线索 clue-1835-merchant-builds 仍揭示 ❌
T9: Library Use 95/50 = 失败 → 线索 clue-corbitt-will-executor-thomas 仍揭示 ❌
```

**根因：** 规则层→导演层回路未闭合。director 先决定揭示 → driver 跑检定 → apply 无条件执行揭示。

**我们的约束：** 不要机械门禁（"失败=不给"）。我们想要 director 语义判断失败后果——可能是部分信息/误导/时间代价/风险/替代路径/ Idea Roll 兜底。详见 `2026-07-06-rule-result-loop-problem.md`（专门问 GPT Pro 的文档）。

### 问题：sanity 检定未接入 driver

driver 只执行 `skill_check` 类的 rules_requests，不执行 `sanity_check`（SanitySession 是有状态对象，复杂度高）。所以恐怖遭遇（飞床/Corbitt 复活）的 SAN 损失在 driver 跑局里没发生。

**影响：** D6 的"恐怖有代价"无法验证——角色 SAN 永远不变，恐怖场面没有机制后果。

---

## D2 — 剧情覆盖（v4: 4/5）

### 问题：没到终战场景

**现象：** 15 回合全部消耗在 5 个调查场景（knott-briefing → boston-globe → central-library → hall-of-records → central-police-station），没到 chapel-investigation / house-investigation / basement-confrontation / aftermath。

**根因（双重）：**
1. **玩家选择序列太偏调查** — 序列设计是"查环球报→查图书馆→查市政厅→查警局"，纯 investigation
2. **每场景线索密度高 + scene 转场按"线索耗尽"** — 每个调查场景有 3-4 条 clue，全发现要 3-4 回合，5 个场景就 15+ 回合

**未触达的后果：** 模组的 action 阶段（进入宅邸、飞床陷阱、地下室、Corbitt 终战、奖励结算）完全没覆盖。29 条线索只发现 11 条（38%）。

### 问题：scene 转场只看线索耗尽，不看玩家意图

**现象：** director 的 apply 层按"当前 scene 的 available_clues 全发现 → 切下一 scene"转场。但玩家说"我去礼拜堂"时，director 不会因此转场——因为玩家意图不参与转场逻辑。

**后果：** 玩家无法主动选择去哪个场景。如果玩家想跳过部分调查直奔宅邸，director 不响应。

---

## D3 — 叙事沉浸（v4: 3/5）

### 问题：beats 单薄且与 must_include 重复

**现象：** 每回合的 narration skeleton 的 beats 通常只有一行"揭示线索 X：<must_include 内容>"，和 must_include 字段几乎同义。没有感官纹理、NPC 微动作、环境细节的预置。

**对比 v3：** v3 的 GM 即兴补了"铜质锁眼周围有些许磨损""湿羊毛气味""他把信封推过桌面"这类细节。v4 的契约层没预存这个素材库，全靠叙事 LLM 临场发明。

### 问题：narration skeleton 内嵌 roll/reveal 矛盾

**现象：** T5/T9 的 skeleton 同时携带"Library Use 失败"钩子和"揭示线索"指令。LLM narrator 据此会写出"你什么都没查到……这是你查到的：1835 年富商建屋"的破绽。

**根因：** D1 回路缺口的下游表征——director 决定揭示在前，检定执行在后，skeleton 里两者并存未和解。

### 问题：没有真正的叙事散文输出

**现象：** driver 只产 narration skeleton（结构化骨架），不调 LLM 写散文。所以 D3 的"成品 prose 质量"仍未验证。

**影响：** 无法评估 v4 的实际叙事质量——只能评估"契约是否够 LLM 写出好散文"，不能评估"LLM 真的写出了好散文"。

---

## D4 — 自主推进（v4: 4/5）

### 问题：RECOVER stall loop（idle 时死循环）

**现象：** 当玩家在一个仍有未发现线索的场景里 idle（不提供明确推进意图）时，director 的 RECOVER action 会计算出 fallback 线索路由，但**不会自动揭示该线索**，而是输出一个"方向建议"。driver 无法消费这个建议（它期望明确的 REVEAL 指令，不是建议），导致 director 反复 RECOVER → driver 反复无法响应 → 死循环。

**证据：** hall-of-records 场景 T10-11 连续两回合非揭示动作（SUBSYSTEM/CHARACTER），T12 才通过 RECOVER 落地一条线索。在另一个测试序列里，T13-T25 全是 RECOVER，17 回合卡死。

**根因：** RECOVER 的语义是"给玩家方向建议"，但在无真玩家的 driver 场景里，建议无人响应。RECOVER 应在 N 回合 idle 后降级为 REVEAL（自动揭示 fallback 线索），关闭环路。

### 问题：scene 转场是线性顺序，不支持分支

**现象：** apply 层的 scene 转场按 story-graph 的 `scenes[]` 数组顺序找下一个。这对线性模组（Cursed Be the City）够用，但分支调查模组（The Haunting 有多个可并行的调查地点）会限制玩家自由。

**影响：** 玩家无法"先去礼拜堂再去图书馆"——只能按数组顺序。

---

## D5 — 事件流完整性（v4: 3/5）

### 问题：sanity/combat 事件未接入 driver

**现象：** driver 只记录 skill_check 事件 + clue_reveal + scene_transition + pressure_tick。不记录 SAN 损失、combat 回合、HP 变化、条件状态（major_wound/dying/insane）。

**根因：** SanitySession 和 CombatSession 是有状态对象，driver 没实例化它们。

### 问题：events 是扁平 list，不区分 player-safe vs keeper-only

**现象：** driver 的 events_detail 是所有事件的扁平数组，没有 player-safe / keeper-only 分离。如果直接给玩家看会泄露 keeper secret（如 clue_reveal 的 summary 含 keeper-only 内容）。

---

## D6 — 节奏张力（v4: 3/5）

### 问题：tension 曲线只到 medium，不上 high/crisis

**现象：** 15 回合的 tension 曲线是 `low×9 → medium×6`，没到 high 或 climax。horror_stage 走到 pattern 就停了，没到 revelation。

**根因：**
1. **threat-fronts 的 clock 没推进** — director 在调查场景不施压（PRESSURE 评分低），clock 的 current_segments 一直是 0
2. **pacing-map 的 tension_target 没真正驱动 escalation** — 虽然 director 读 pacing-map 的 horror_stage，但 tension_level 的 bump 只靠 PRESSURE 动作，而调查场景不触发 PRESSURE

### 问题：15 回合全 investigation，节奏单一

**现象：** 没有任何 action/combat/social beat 打断研究节奏。整个跑局是"档案查询模拟器"。

**根因：** 玩家选择序列全是 investigate，director 顺着 intent 推进。缺少 director 主动注入的节奏变化（如"调查到一半，诺特先生打电话催促"= PRESSURE）。

### 问题：恐怖场面无机制代价（与 D1 sanity 缺口叠加）

**现象：** 因为 sanity 检定未接入 driver，即使到了恐怖场景（如果到了的话），角色 SAN 也不会变。恐怖没有机制后果——玩家不会"感受到威胁代价"。

**对比 v3：** v3 虽然恐怖被阉割（飞床 0 伤害），但至少跑了 SAN 检定（54/60 成功，损失 0）。v4 连 SAN 检定都没跑。

---

## 问题优先级总览

| 优先级 | 问题 | 影响维度 | 修复方向 |
|---|---|---|---|
| 🔴 最高 | 检定失败不 gate 揭示（回路缺口） | D1 + D3 | 语义化失败后果（非机械门禁） |
| 🔴 最高 | RECOVER stall loop | D4 | idle N 回合后降级为 REVEAL |
| 🟡 高 | sanity 检定未接入 driver | D1 + D5 + D6 | driver 实例化 SanitySession |
| 🟡 高 | 没到终战 | D2 | pacing_budget + 玩家意图驱动转场 |
| 🟡 高 | tension 只到 medium | D6 | director 在调查中注入 PRESSURE |
| 🟡 中 | beats 单薄 | D3 | 预置感官纹理素材 |
| 🟡 中 | scene 转场不支持分支 | D4 | graph 边而非数组顺序 |
| 🟢 低 | events 不分 player/keeper | D5 | 加 privacy 字段 |
| 🟢 低 | 无真散文输出 | D3 | driver 加 --llm flag |

---

## 给 GPT Pro 的核心问题

我们不想逐个问题问，而是想问一个**架构层面的问题**：

**当前 director 的 10 个动作（REVEAL/DEEPEN/PRESSURE/CHARACTER/CHOICE/CUT/MONTAGE/SUBSYSTEM/RECOVER/PAYOFF）+ 三层评分（base × structure_weight × rule_override）是否能支撑上面所有问题的修复？还是说动作集/评分模型本身需要扩展？**

具体说：
1. **失败后果语义化**（D1）— 需要新动作（如 PARTIAL_REVEAL / MISLEAD / COST），还是现有动作 + narrative_directives 字段够？
2. **节奏多样性**（D6）— director 是否需要一个"节奏预算"概念，主动在 N 回合 investigation 后注入 PRESSURE/CHARACTER beat？
3. **分支转场**（D4）— scene 转场该从"数组顺序"改成"graph 边"吗？director 是否该参与转场决策（而不是 apply 层独占）？
4. **sanity/combat 接入**（D1/D5/D6）— driver 是否该实例化完整的 SanitySession/CombatSession，让恐怖场面有真实机制代价？还是 director 只"请求"sanity 检定，由独立的规则层执行？

我们希望 GPT Pro 给一个**整体架构建议**，而不是逐个 patch。

## 相关文档

- `2026-07-06-rule-result-loop-problem.md` — D1 回路缺口的详细问题（专门问 GPT Pro 的，含 5 个具体设计问题）
- `2026-07-06-story-director-v2-blueprint.md` — v2 蓝图（评审原文）
- `2026-07-05-story-director-design.md` — v1 正式 spec
- `.coc/playtests/haunting-fullrun/session-report-v4.json` — v4 跑局数据
- `.coc/playtests/haunting-fullrun/evaluation-v2.md` — 完整评估报告
