# Story Director 实现台账

> **用途：** 持久化盯进度。上下文压缩/腐烂时，先读本文件 + 蓝图 [A] 节找回定位。
> **真相源：** `docs/superpowers/specs/2026-07-05-story-director-blueprint.md` 的 [A] 决策台账。
> 本文件与之同步，但更细：跟踪到每个设计 section / 文件 / 函数级别。

**最后更新：** 2026-07-05（实现计划已写，进入实现阶段）

---

## 当前阶段：实现中（按 plan 10 个 task 逐个执行）

**正在做：** Task 1 — coc_rule_signals.py 基础信号函数
**真相源：** `docs/superpowers/specs/2026-07-05-story-director-design.md`
**实现计划：** `docs/superpowers/plans/2026-07-05-story-director.md`（10 task）

## 实现 Task 进度

| Task | 内容 | 状态 |
|---|---|---|
| 1 | coc_rule_signals 基础（HP/Sanity/Credit） | ⏳ |
| 2 | coc_rule_signals NPC反应/Luck/Crit/Stalled/Tension | ⏳ |
| 3 | coc_rule_signals v2 翻译函数 | ⏳ |
| 4 | coc_story_director build_director_context | ⏳ |
| 5 | 三层评分引擎 | ⏳ |
| 6 | generate_director_plan 完整产出 | ⏳ |
| 7 | coc_scenario_compile 校验器 | ⏳ |
| 8 | coc_story_harness GM质量断言 | ⏳ |
| 9 | SKILL.md + references | ⏳ |
| 10 | 全量测试 + rule-index | ⏳ |

---

## 设计 Section 进度（5 节）

| Section | 内容 | 状态 |
|---|---|---|
| 1 | 架构与分层（含 coc_rule_signals.py、v1 接 keeper-play） | ✅ 已确认（修订版） |
| 2 | DirectorPlan schema + 规则信号注入 | ✅ 已确认（rule_signals 进输出 / handoff 显式声明） |
| 3 | v1 接入哪些规则耦合点（从 22 选） | ✅ 已确认（10 v1 + 6 v2 翻译 + 6 不接入） |
| 4 | 评分规则表（按 structure_type 参数化） | ✅ 已确认（三层：base × structure_weight × rule_signal_mod 硬覆盖） |
| 5 | harness 断言项 + 验证模组选择 | ✅ 已确认（Haunting/人煎百味/血色公路；6 类断言含新增 rules_fidelity） |
| 6 | 模组解析方案（LLM 解析 + 脚本校验，扩展 coc-scenario-import） | ✅ 已确认 |

### Section 6 已定决策：模组解析方案
- 三层：LLM 解析（skill 驱动，zcode 原生检索）→ 脚本校验（coc_scenario_compile.py）→ director 消费
- 扩展现有 coc-scenario-import，不新建 skill
- 新增 references/story-graph-schema.md（schema+示例给 LLM）+ compile-protocol.md（解析步骤）
- v1 验证模组改用 skill 流程自动编译（不再手写）
- 不写 PDF→JSON 硬解析代码；不做全自动化（人在回路看校验报告）

### Section 4 已定决策：三层评分结构
- `final_score(action) = base_score(action,context) × structure_weight(action,type) × rule_signal_mod(action,signals)`
- Layer 1 base_score：10 个动作各自的触发条件（与结构无关）
- Layer 2 structure_weight：7 种原型 × 10 动作的权重表（JSON 数据，可调）
- Layer 3 rule_signal_mod：硬覆盖，6 种规则信号直接锁定动作（bout_active/dying/temp_insane/fumble/stalled/lethal_chances），绕过评分
- 评分逻辑可测：每个 profile 的选择可手算复核

### Section 3 已定决策：v1 接入 10 个规则耦合点
- **v1 接入（director 评分引用）：** A1(CR分层) A2(APP/CR隐骰) B1-3(HP状态) C1(大成功) C2(大失败) D1(临时疯狂) D3(疯狂发作接管) E1(Luck信号) I1(Idea Roll) K1(张力钟+三次免死)
- **v2 翻译（coc_rule_signals.py 写函数，director 暂不引用）：** D4 D5 F1 F3 H1 A3
- **不接入（v1 不实现）：** D2 D6 E2 F2 G1 J1

### Section 2 已定决策
- `rule_signals` 嵌入 DirectorPlan 输出（审计/harness 可见 director 读到的规则状态）
- `handoff: "rules"|"narration"` 显式声明 keeper-play 这轮是否走规则层
- 两阶段分离：`coc_rule_signals.py` 纯翻译（无决策）→ `coc_story_director.py` 评分选择
- `coc_rule_signals.py` 一次写全 22 耦合点翻译函数，director 评分按 v1 范围分批接入

---

## v1 待产出文件清单

| 文件 | 类型 | 状态 |
|---|---|---|
| `plugins/coc-keeper-zcode/scripts/coc_story_director.py` | deterministic planner | ⏳ 未开始 |
| `plugins/coc-keeper-zcode/scripts/coc_rule_signals.py` | 规则状态→剧情信号（纯函数） | ⏳ 未开始 |
| `plugins/coc-keeper-zcode/scripts/coc_story_harness.py` | GM 质量 harness | ⏳ 未开始 |
| `plugins/coc-keeper-zcode/skills/coc-story-director/SKILL.md` | 内部顾问 skill | ⏳ 未开始 |
| `plugins/coc-keeper-zcode/skills/coc-keeper-play/SKILL.md` | 改循环接入 director | ⏳ 未开始（v1 要改） |
| `plugins/coc-keeper-zcode/references/director-protocol.md` | DirectorPlan schema 说明 | ⏳ 未开始 |
| `.coc/playtests/v7-director-smoke/profiles/*.json` | harness 输入 | ⏳ 未开始 |
| 模组剧情图（≥2 种结构原型） | scenario/ 数据 | ⏳ 未开始（待 Section 5 定模组） |
| `docs/superpowers/specs/2026-07-05-story-director-design.md` | 正式 design spec | ✅ 已写 + 自审完成，待用户复审 |

---

## v1 不做（边界，防止范围爬升）

- ❌ 完整记忆层（semantic-cards 检索/向量库/embeddings）
- ❌ 其余 10 个模组的剧情图编译
- ❌ LLM 兜底分支（director 全 deterministic）
- ❌ 完整 22 规则耦合点（v1 只选高价值子集）

---

## 已确认决策（快速索引，详情见蓝图 [A.2]）

1. 方案 A：规则优先级 + 评分表
2. director 读规则状态（只读），通过 `coc_rule_signals.py` 转信号
3. 独立模块 + v1 直接接 keeper-play 循环
4. 真决策：每回合选一个导演动作
5. harness：JSON profile 驱动 + 端到端
6. 评分表按 `structure_type` 参数化（7 种模组原型）
7. 记忆层 v1 不做，schema 留位

---

## 上下文腐烂恢复指引

如果你（agent）发现自己丢失了定位，按顺序做：

1. 读本文件（你正在读）
2. 读 `docs/superpowers/specs/2026-07-05-story-director-blueprint.md` 的 **[A] 决策台账**节（A.0~A.5）
3. 看"当前阶段"和"设计 Section 进度"两张表，定位到没完成的第一个 ⏳
4. 从那里继续，不要重启设计

**绝对不要：** 重新调研模组类型（A.3 已完成）、重新调研规则耦合（A.4 已完成）、重新讨论方案 A/B/C（已确认 A）。
