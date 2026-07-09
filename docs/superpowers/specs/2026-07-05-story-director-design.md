# COC Story Director — Design Spec

**Date:** 2026-07-05
**Status:** Approved (brainstormed through 6 sections)
**Scope:** 在现有规则层之上新增隐藏的剧情编排层 `coc-story-director`。本 spec 覆盖 v1 全部决策：架构分层、DirectorPlan schema、规则状态→剧情信号映射、三层评分引擎、GM 质量 harness、模组自动编译方案。背景论证见 `2026-07-05-story-director-blueprint.md`。

## Motivation

当前插件规则层已成熟（combat/chase/sanity/character/state 都有结构化状态 + audit，pytest 396 passed），但 `coc-keeper-play` 的循环仍是 7 步薄壳——LLM 每回合做 GM 决策（该给线索还是施压、NPC 该主动还是隐藏、节奏该放慢还是剪辑）全靠临场，没有可测的"导演脑"。

补更多规则（装备/魔法/更多怪物）本质仍是"规则器"。跑团的灵魂是 GM 如何把模组变成有节奏、有情绪、有选择后果的共同叙事。本设计新增一个 **deterministic 的剧情编排层**，给 keeper-play 提供"下一步该怎么跑"的导演决策。

**两个关键约束塑造了本设计：**

1. **规则状态反向影响剧情**——Credit Rating 影响 NPC 态度、HP 状态约束行动、大成功/大失败强制剧情后果、SAN 状态接管调查员。director 不能脱离规则层独立存在。规则书全量调研发现 22 个"规则→剧情"耦合点跨 11 域（见 Rulebook Couplings 表）。
2. **模组结构差异巨大**——12 个参考模组归为 7 种结构原型（线性/时间循环/分支调查/地点沙盒/多阵营/战役续作/混合巨结构）。director 不能假设线性调查。

**Goal:** 一个 deterministic planner，每回合读规则状态 + 场景 + 模组剧情图，产出 DirectorPlan JSON 指导 keeper-play 的叙事方向，且可通过 harness 机读核验"有没有灵魂"。

## Non-Goals

- **完整记忆层**——semantic-cards 检索打分、向量库、embeddings。v1 的 DirectorPlan 保留 `memory_reads/writes` schema 字段，但只读 session-summaries 或留空。
- **LLM 兜底分支**——director v1 全 deterministic，符合蓝图"第一版不用 LLM 也能工作"主张。LLM 只在 keeper-play 最终润色叙事时介入。
- **全部 22 规则耦合点**——v1 只接 10 个高价值耦合点的 director 评分（见 Rulebook Couplings 表的 v1 列）。
- **全部 12 模组的剧情图编译**——v1 只验证 3 个代表模组（The Haunting / 人煎百味 / 血色公路）。
- **PDF→JSON 硬解析代码**——模组剧情图由 skill 驱动 LLM 用 宿主原生检索（grep/read）生成，脚本只做结构校验。
- ** Bonds/关系点数机制**——40 周年规则书核心规则无此机制（Pulp Cthulhu 才有），不建模。

## Architecture

### Component boundaries

```
coc-keeper-play/SKILL.md   # EXTEND — 改循环接入 director（v1 直接改）
   └─ LLM 读 SKILL.md，按 DirectorPlan.handoff 决定走规则层还是直接叙事

coc_story_director.py      # NEW — deterministic planner
   ├─ build_director_context()    读 save/logs/scenario → DirectorContext
   ├─ apply_rule_signals()        调 coc_rule_signals 翻译规则状态为信号
   ├─ score_scene_options()       三层评分：base × structure_weight × rule_signal_mod
   ├─ select_clue_policy()        选 reveal/withhold/fallback
   ├─ tick_pressure_clocks()      推进 threat-fronts clocks
   └─ write_director_plan()       产出 DirectorPlan JSON
   ├─ depends on: coc_rule_signals (纯函数), coc_state (读 save)
   └─ consumed by: coc_story_harness.py (测试), coc-keeper-play/SKILL.md (运行期)

coc_rule_signals.py        # NEW — 规则状态→剧情信号（纯函数，无决策）
   ├─ read_hp_state()             hp/max_hp/conditions → "healthy|wounded|major_wound|dying|dead"
   ├─ read_sanity_state()         san/bout flags → "stable|shaken|temp_insane|indefinite_insane|bout_active"
   ├─ read_credit_tier()          cr → 6 档分层
   ├─ roll_npc_reaction()         APP/CR concealed roll → disposition
   ├─ read_luck_signal()          luck 值 + 上轮消耗 → "high|moderate|low|depleted" + spent flag
   ├─ read_critical_fumble()      last roll → flags
   ├─ read_stalled_turns()        logs → stalled 计数
   ├─ read_tension_clock()        pacing-state → tension_level + lethal_chances_used
   └─ (v2 翻译函数：D4/D5/F1/F3/H1/A3，写全但 director 暂不引用)
   ├─ depends on: coc_state, coc_sanity, coc_combat (只读)
   └─ consumed by: coc_story_director.py

coc_story_harness.py       # NEW — GM 质量 harness（端到端走 keeper-play 循环）
   ├─ profiles/ 读 JSON player_intent
   ├─ 调 director 产 DirectorPlan → 写 artifacts/
   └─ 跑 6 类断言（agency/clue_robustness/pacing/npc_life/memory/horror/safety/rules_fidelity）

coc_scenario_compile.py    # NEW — 剧情图结构校验器（Layer 2）
   ├─ validate_story_graph()      scene 的 dramatic_question 非空等
   ├─ validate_clue_graph()       critical conclusion ≥3 routes
   ├─ validate_npc_agendas()      每个 NPC 有 agenda
   └─ validate_module_meta()      structure_type ∈ 7 合法值
   └─ consumed by: coc-scenario-import skill（LLM 编译后跑校验）

coc-story-director/SKILL.md # NEW — 内部顾问 skill（声明 director 的角色/输入/输出/硬规则）
coc-scenario-import/SKILL.md # EXTEND — 新增"剧情图编译"流程章节
coc-scenario-import/references/
   story-graph-schema.md    # NEW — 7 个剧情图 JSON 的 schema + 示例（给 LLM 读）
   compile-protocol.md      # NEW — 解析步骤 + 7 种 structure_type 判定指引
references/director-protocol.md # NEW — DirectorPlan schema + 评分规则说明
```

### 分层职责

```
┌─────────────────────────────────────────────────────────┐
│ coc-keeper-play (SKILL.md) ◄─ v1 改循环                  │
│  新循环：读输入 → build context → director → 规则(如需)   │
│         → 回填 → 沉浸式输出 → 写 events/director/memory  │
└─────────────────────────────────────────────────────────┘
        ▲ 读取 DirectorPlan        ▲ 读取 save 规则状态
        │                          │
┌───────┴──────────────────┐  ┌────┴──────────────────────┐
│ coc_story_director.py    │  │ 规则状态读取层（只读）      │
│  build_director_context()│←─│  investigator-state:       │
│  apply_rule_signals()    │  │    hp/major_wound/dying    │
│  score_scene_options()   │  │    sanity/insane/phobias   │
│  select_clue_policy()    │  │    credit_rating/app       │
│  tick_pressure_clocks()  │  │    luck/cthulhu_mythos     │
│  write_director_plan()   │  │    skills/backstory/era    │
└──────────┬───────────────┘  │  flags: clues/decisions    │
           │                  │  subsystem: combat/chase/  │
           │ DirectorContext  │    sanity 状态              │
           ▼                  └────────────────────────────┘
┌──────────────────────────────────────────────────────────┐
│ scenario/ 剧情图（数据，按模组编译）                       │
│  story-graph / clue-graph / npc-agendas / threat-fronts   │
│  pacing-map / improvisation-boundaries / module-meta      │
└──────────────────────────────────────────────────────────┘
```

director 与规则层关系：**只读**。通过 `coc_rule_signals.py` 把规则状态翻译成剧情信号，翻译是纯函数无副作用，director 不修改任何规则状态。规则状态的修改仍由 coc_roll/combat/chase/sanity 负责，director 只消费。

## DirectorPlan Schema

director 每回合输出一个 DirectorPlan JSON。所有 id 是稳定 ASCII；玩家可见文本由 keeper-play 按 play_language 渲染。

```json
{
  "decision_id": "director-<ts>-<seq>",
  "turn_input": {
    "player_intent": "玩家声明的行动（原文摘要）",
    "player_intent_class": "investigate|social|combat|flee|meta|stuck|idle",
    "active_scene_id": "archive-research",
    "turn_number": 7
  },

  "scene_action": "REVEAL|DEEPEN|PRESSURE|CHARACTER|CHOICE|CUT|MONTAGE|SUBSYSTEM|RECOVER|PAYOFF",

  "dramatic_question": "玩家这场戏要回答的戏剧问题",
  "pacing_mode": "slow_burn|investigation|social|pressure|climax|aftermath",
  "tension_delta": "+1|0|-1",

  "rule_signals": {
    "hp_state": "healthy|wounded|major_wound|dying|dead",
    "sanity_state": "stable|shaken|temp_insane|indefinite_insane|bout_active",
    "credit_tier": "penniless|poor|average|wealthy|rich|super_rich",
    "npc_reaction_roll": { "used": "credit_rating|app", "roll": 34, "target": 60, "disposition": "helpful|neutral|hostile" },
    "luck_level": "high|moderate|low|depleted",
    "luck_spent_last": 0,
    "last_roll_critical": false,
    "last_roll_fumble": false,
    "active_conditions": ["major_wound","prone"],
    "stalled_turns": 0,
    "tension_level": "low|medium|high|climax",
    "lethal_chances_used": 0,
    "bout_active": false
  },

  "clue_policy": {
    "reveal": ["clue-id"],
    "withhold": ["keeper-secret-id"],
    "fallback_routes": ["alt-clue-id"],
    "clue_type": "obvious|obscured"
  },
  "npc_moves": [
    {
      "npc_id": "npc-x",
      "agenda": "隐藏|试探|引诱|阻挠|求助",
      "emotional_tone": "紧张但礼貌",
      "secret_limit": "不要透露 keeper_secret",
      "disposition_source": "rule_signal:npc_reaction_roll"
    }
  ],
  "pressure_moves": [
    { "clock_id": "cult-alert", "tick": 1, "visible_symptom": "远处出现同一辆黑色轿车", "reason": "stalled_2_turns" }
  ],
  "rules_requests": [
    { "kind": "skill_check", "skill": "Spot Hidden", "reason": "只有玩家主动检查门框才触发", "difficulty": "regular|hard|extreme", "bonus_penalty_dice": 0 }
  ],
  "memory_reads": [],
  "memory_writes": [],

  "narrative_directives": {
    "tone": ["dust","bureaucratic indifference"],
    "must_include": ["门框上的新划痕"],
    "must_not_reveal": ["corbitt-is-buried-below"],
    "improvisation_allowed": ["invent minor clerk"],
    "horror_escalation_stage": "ordinary|wrongness|pattern|revelation"
  },

  "handoff": "rules|narration",
  "rationale": "为什么选这个动作（审计用，不展示给玩家）"
}
```

### 字段语义

- **`rule_signals`**：director 读到的规则状态快照。嵌入输出的目的：审计 + harness 断言可见 director 的决策依据，与项目 combat/chase "状态可被机读核验"的既有风格一致。
- **`scene_action`**：10 个导演动作之一，每回合只选一个（蓝图核心算法：不要一口气又给线索、又上怪、又推进 NPC）。
- **`handoff`**：显式声明 keeper-play 这轮是否走规则层。`rules` → keeper-play 调 coc_roll/combat 等；`narration` → keeper-play 直接写叙事。
- **`rationale`**：审计字段，记录评分选择理由，不展示给玩家。harness 可用它验证决策可解释性。

### 两阶段信号注入（关键设计）

```
阶段 1（coc_rule_signals.py，纯函数，无 director 决策）
  读 save/investigator-state/combat/sanity → 产出 rule_signals dict
  纯翻译，每个信号可独立单测。例：read_hp_state(hp, max_hp, conditions) -> "major_wound"

阶段 2（coc_story_director.py，评分 + 选择）
  rule_signals 作为 DirectorContext 的一部分进入评分表
  每个导演动作的评分函数引用 rule_signals 字段
  例：score(RECOVER) ↑ 当 rule_signals.sanity_state == "temp_insane" 且玩家 stuck
```

分离理由：`coc_rule_signals.py` 是纯翻译，一次写全 22 耦合点的翻译函数（哪怕 v1 director 只用 10 个），后续接 director 不用回头改。director 评分逻辑按 v1 范围分批接入。

## Rulebook Couplings（规则→剧情耦合，22 个跨 11 域）

调研对象：Keeper Rulebook 40th Anniversary 全 465 页。页码为印刷页。

### v1 接入（10 个）—— director 评分表直接引用

| 耦合 | 域 | 规则书 | 信号字段 | director 评分怎么用 |
|---|---|---|---|---|
| A1 CR 分层→准入 | A | p.45-47 | `credit_tier` | 高 CR→NPC polite/放行；低 CR→NPC 冷淡/需 bribing |
| A2 APP/CR NPC 反应隐骰 | A | p.191 | `npc_reaction_roll` | 决定 NPC disposition，驱动 npc_moves.emotional_tone |
| B1-3 HP 状态→行动约束 | B | p.120 | `hp_state` | major_wound/dying→PRESSURE/SUBSYSTEM 优先，阻断"我冲上去"类声明 |
| C1 大成功→编造利好 | C | p.89 | `last_roll_critical` | 触发 PAYOFF/REVEAL 升级（在成功基础上额外给） |
| C2 大失败→编造厄运 | C | p.89 | `last_roll_fumble` | 触发 PRESSURE 升级，且不可被 push 取消 |
| D1 临时疯狂阈值 | D | p.155 | `sanity_state` | temp_insane→触发 SUBSYSTEM(sanity) + bout 流程 |
| D3 疯狂发作→接管 | D | p.156 | `bout_active` | bout 期间 director 接管调查员动作 + 抑制 SAN 损失调用 |
| E1 Luck 消耗=玩家优先级信号 | E | p.99 | `luck_spent_last` + `luck_level` | 大额 luck spend→director 识别"玩家在乎"，给戏剧化险情 |
| I1 Idea Roll 卡住恢复阀 | I | p.199 | `stalled_turns` | stalled ≥ N→RECOVER（成功给线索/失败 in medias res） |
| K1 张力钟+三次免死 | K | p.198,209 | `tension_level` + `lethal_chances_used` | 评分表全局调节器；≥3 次免死前不让致死结局 |

### v2 翻译（6 个）—— coc_rule_signals.py 写函数，director 暂不引用

D4(失败SAN非自愿动作)、D5(恐惧症激活罚骰)、F1(Psychology隐骰)、F3(believer SAN bomb)、H1(pushed fail后果)、A3(Contacts难度)。

理由：翻译函数纯无副作用，一次写全不浪费；但 director 引用它们需配套场景逻辑（如"director 主动布置恐惧症触发场景"），v1 模组里触发机会少。

### 不接入（6 个）—— v1 不实现翻译函数

D2(长期疯狂)、D6(妄想/现实检定)、E2(NPC luck pool)、F2(clue obvious/obscured 标注)、G1(情境→罚骰目录)、J1(时代/背景→NPC 语调)。

理由：需新 save schema 字段（NPC luck pool、delusion 标志）或改 clue-graph schema；J1 是软建议难量化。留给后续轮次。

## Scoring Engine（三层评分）

每回合对 10 个导演动作逐一算分，取最高分动作。

```
final_score(action) =
    base_score(action, context)        # Layer 1: 规则状态 + 场景状态触发的硬性分
  × structure_weight(action, type)     # Layer 2: 模组结构原型对该动作的偏好
  × rule_signal_mod(action, signals)   # Layer 3: 强制性规则覆盖
```

### Layer 1 — base_score（与结构无关的触发条件）

| 动作 | 触发条件（满足即给基础分） |
|---|---|
| REVEAL | 玩家声明主动调查 + 当前场景有未发现线索 + 该线索 deliverable 于本场景 |
| DEEPEN | 玩家在调查但未触及结论 + 当前场景 dramatic_question 未答 |
| PRESSURE | 任一 clock 接近满（≥2/3）或玩家 stalled |
| CHARACTER | 当前场景有带 agenda 的 NPC 且本回合未被激活 |
| CHOICE | 玩家意图模糊（intent_class=idle/ambiguous）+ 多条线索可走 |
| CUT | 当前场景 dramatic_question 已答 + exit_condition 满足 |
| MONTAGE | 玩家声明"快速过"类元动作 + 后续无张力过程 |
| SUBSYSTEM | 玩家声明 combat/flee/cast 或 rule_signals 强制（见 Layer 3） |
| RECOVER | stalled_turns ≥ 阈值（默认 2）或玩家显式求助 |
| PAYOFF | 存在未回收的记忆/旧选择 且当前场景有 reactivation_cue 命中 |

### Layer 2 — structure_weight（按 7 种原型的偏好，JSON 数据可调）

| 动作 | 线性/分幕 | 时间循环 | 分支调查 | 地点沙盒 | 多阵营 | 战役续作 | 混合巨结构 |
|---|---|---|---|---|---|---|---|
| REVEAL | 1.0 | 0.9 | 1.2 | 1.0 | 0.8 | 1.0 | 1.0 |
| PRESSURE | 0.9 | 1.3 | 1.0 | 0.8 | 1.2 | 1.0 | 1.2 |
| CHOICE | 0.7 | 0.9 | 1.3 | 1.3 | 1.3 | 1.0 | 1.1 |
| CUT | 1.2 | 1.0 | 0.8 | 0.7 | 0.8 | 1.0 | 1.0 |
| MONTAGE | 1.0 | 0.8 | 0.9 | 1.1 | 0.9 | 1.0 | 1.0 |
| CHARACTER | 0.9 | 1.0 | 0.9 | 1.1 | 1.3 | 1.3 | 1.1 |
| RECOVER | 1.0 | 1.2 | 1.1 | 1.2 | 1.0 | 1.0 | 1.0 |
| PAYOFF | 0.8 | 1.3 | 0.9 | 1.0 | 0.9 | 1.3 | 1.0 |
| DEEPEN | 1.0 | 1.0 | 1.1 | 0.9 | 1.0 | 1.0 | 1.0 |
| SUBSYSTEM | 1.0 | 1.0 | 1.0 | 1.0 | 1.0 | 1.0 | 1.0 |

权重表是数据文件（`references/structure-weights.json`），可调不需改代码。

### Layer 3 — rule_signal_mod（硬覆盖，绕过评分）

某些规则信号直接锁定动作，不参与 Layer 1/2 评分：

| 规则信号 | 强制动作 | 说明 |
|---|---|---|
| `bout_active == true` | SUBSYSTEM(sanity) | 疯狂发作期间必须走 SAN 流程 |
| `hp_state == "dying"` | SUBSYSTEM(combat) + PRESSURE | 死亡钟每轮必须 CON roll |
| `sanity_state == "temp_insane"` 且未处理 | SUBSYSTEM(sanity) | 临时疯狂触发 bout 判定 |
| `last_roll_fumble == true` 且未处理 | PRESSURE（强制） | 大失败不可被 push 取消 |
| `stalled_turns >= 3` | RECOVER（强制优先） | 三轮无进展必须扶手 |
| `lethal_chances_used < 3` 且当前是致死场景 | 阻断致死结局 | 三次免死规则 |

Layer 3 命中时直接跳过 Layer 1/2 评分。这是规则忠实度的硬约束。

### 平分处理

base_score 用 0-1.0 刻度（满足触发条件给基础分，可按条件强度在 0.5-1.0 间细分）。多个动作 final_score 相同时，按优先级兜底顺序：SUBSYSTEM > RECOVER > PRESSURE > REVEAL > CHOICE > CHARACTER > DEEPEN > CUT > PAYOFF > MONTAGE。规则状态驱动的动作优先于叙事驱动的动作。

## Module Structure Types（7 种原型）

调研 12 个参考模组（`pdf/model/`）归纳：

| 结构原型 | 代表模组 | director 核心能力需求 |
|---|---|---|
| 线性/分幕 | Cursed Be the City, King of Shreds | scene 顺序推进 |
| 时间循环 | An Amaranthine Desire | 跨迭代记忆/知识状态 |
| 分支调查（线索沙盒） | Cold Harvest, Dust to Dust, The Haunting | 无序线索图、lead graph |
| 据点式地点沙盒 | 人煎百味, Garden of Earthly Delights | 地点列表、自由移动、地点触发场景 |
| 多阵营政治网 | They Did Not Think It Too Many | 阵营关系模型、社交解决路径 |
| 战役续作 | Herald of the Yellow King | 跨模组状态、前作角色回调 |
| 混合巨结构 | 血色公路（111 页，129 书签） | 沙盒+时间线+地城 全部组合 |

非场景资料书 1 个：黑暗时代的哈斯塔崇拜（Coven vs Court 分类法 → 可当阵营生成器，director 应检测并排除出 scenario 路由）。

**设计约束：** director 评分规则表按 `module-meta.structure_type` 选权重；`血色公路` 是终极压力测试——能跑通它，引擎对其他原型就有信心。

## Module Compilation（模组剧情图自动编译）

### 三层职责

```
Layer 1 — LLM 解析（skill 驱动，利用宿主原生检索能力）
  coc-scenario-compile skill 读模组 → 产出剧情图 JSON
  工具：grep/PDF read/webfetch（宿主原生，不写硬解析代码）
  产出：scenario/ 下 7 个 JSON

Layer 2 — 脚本校验（确定性，coc_scenario_compile.py）
  读 Layer 1 产出的 JSON → 跑断言 → 报告缺漏
  断言见下方 Schema 的编译期硬断言
  不通过则报告具体缺漏，让 LLM 补

Layer 3 — director 消费（运行期）
  director 只读已校验通过的剧情图
```

理由：Codex 有成熟的 grep/read，LLM 自己能从 PDF 提取结构化数据。我们不写解析代码（不同模组结构差异大，LLM 能自适应）。但剧情图质量直接影响 director 的"灵魂"（缺 fallback route 的 clue graph 会让玩家卡死），所以 Layer 2 用脚本做硬性结构校验。

### 扩展 coc-scenario-import（不新建 skill）

```
coc-scenario-import/
  SKILL.md                  # EXTEND：新增"剧情图编译"流程章节
  references/
    story-graph-schema.md   # NEW：7 个剧情图 JSON 的 schema + 完整示例（给 LLM 读）
    compile-protocol.md     # NEW：解析步骤 + 7 种 structure_type 判定指引
  scripts/
    coc_scenario.py         # EXTEND：加 create_story_graph() 等创建函数
    coc_scenario_compile.py # NEW：Layer 2 校验器
```

SKILL.md 新增编译流程：读模组 → 判定 structure_type → 按顺序产出 7 个 JSON → 跑 `coc_scenario_compile.py --validate` → 补缺漏到全绿 → 写 recap。

schema 是"提示"不是"约束代码"：`story-graph-schema.md` 给 LLM 看字段名 + 说明 + 完整示例（skill-creator 文档强调 example beats rules），不写死的解析器。

## Scenario Story-Graph Schema

模组编译产出的 7 个 JSON 文件。存 `campaigns/<id>/scenario/`。

### module-meta.json

```json
{
  "schema_version": 1,
  "scenario_id": "the-haunting",
  "title": "The Haunting",
  "structure_type": "branching_investigation",
  "era": "1920s",
  "content_flags": ["supernatural_horror", "child_endangerment"],
  "win_condition": "resolve_corbitt_or_survive",
  "source_pdf": "pdf/Call Of Cthulhu Keeper Rulebook 40th Anniversary (Sandy Petersen).pdf"
}
```

`structure_type` ∈ `{linear_acts, time_loop, branching_investigation, hub_sandbox, multi_faction, campaign_sequel, hybrid_mega}`。

### story-graph.json

```json
{
  "scenes": [
    {
      "scene_id": "archive-research",
      "scene_type": "investigation",
      "dramatic_question": "玩家能否把公开记录和隐藏邪教联系起来？",
      "entry_conditions": ["player asks about public records", "director uses fallback clue after stalled investigation"],
      "exit_conditions": ["clue_chapel_link discovered", "player abandons research", "pressure clock reaches 3"],
      "available_clues": ["clue-chapel-link", "clue-lawsuit"],
      "npc_ids": ["npc-archivist"],
      "pressure_moves": ["closing_time", "watched_by_stranger"],
      "tone": ["dust", "old paper", "bureaucratic indifference"],
      "allowed_improvisation": ["invent minor clerk", "invent local color", "do not invent new cult fact"]
    }
  ]
}
```

### clue-graph.json

```json
{
  "conclusions": [
    {
      "conclusion_id": "corbitt-linked-to-chapel",
      "importance": "critical",
      "minimum_routes": 3,
      "clues": [
        { "clue_id": "newspaper-clipping", "delivery": "Library Use / archive scene", "visibility": "player-safe" },
        { "clue_id": "neighbor-rumor", "delivery": "social scene / cautious inquiry", "visibility": "player-safe" },
        { "clue_id": "symbol-on-doorframe", "delivery": "Spot Hidden / house entry", "visibility": "player-safe" }
      ],
      "fallback_policy": "If two routes are missed, director may move one clue to a new scene."
    }
  ]
}
```

### npc-agendas.json

```json
{
  "npcs": [
    {
      "npc_id": "npc-archivist",
      "agenda": "wants to close on time, mildly helpful if treated respectfully",
      "fear": "losing job over helping suspicious outsiders",
      "secret": "knows the Chapel records were moved",
      "voice": "terse, bureaucratic",
      "relationship_to_investigators": "neutral_stranger"
    }
  ]
}
```

### threat-fronts.json

```json
{
  "fronts": [
    {
      "front_id": "cult-observation",
      "scope": "scenario",
      "dangers": [
        { "id": "watchers", "impulse": "observe and isolate investigators", "moves": ["appear at a distance", "steal a note", "pressure an NPC ally", "cut off a safe route"] }
      ],
      "clocks": [
        {
          "clock_id": "cult-alert",
          "segments": 6,
          "on_tick_visible": ["陌生人记住了调查员的名字", "旅馆房间被翻动", "盟友开始害怕说话"],
          "on_full": "cult directly acts against the investigator"
        }
      ]
    }
  ]
}
```

### pacing-map.json

```json
{
  "pacing_curve": [
    { "scene_id": "opening", "tension_target": "low", "horror_stage": "ordinary" },
    { "scene_id": "archive-research", "tension_target": "medium", "horror_stage": "wrongness" },
    { "scene_id": "corbitt-house", "tension_target": "high", "horror_stage": "pattern" },
    { "scene_id": "basement-confrontation", "tension_target": "climax", "horror_stage": "revelation" }
  ]
}
```

### improvisation-boundaries.json

```json
{
  "invent_allowed": ["minor clerks", "local color NPCs", "weather", "incidental dialogue"],
  "never_invent": ["new Mythos entities", "new cult canonical facts", "clue content not in clue-graph"],
  "keeper_secrets": ["corbitt-is-buried-below", "flesh-ward-mechanics", "dominate-spell"]
}
```

### 编译期硬断言（coc_scenario_compile.py 校验）

- 每个 `importance: critical` 的 conclusion 的 `clues.length >= minimum_routes`（默认 3）
- 每个 scene 的 `dramatic_question` 非空
- 每个 NPC 有非空 `agenda`
- `module-meta.structure_type` ∈ 7 合法值
- `improvisation-boundaries.keeper_secrets` 与 player-safe 内容物理隔离
- `pacing-map` 的 horror_stage 序列在场景访问顺序上大体单调递进（ordinary→wrongness→pattern→revelation）

## Harness（GM 质量评测）

### profiles 组织

```
.coc/playtests/v7-director-smoke/
  profiles/
    haunting/
      01-archive-first.json      # 玩家先查档案
      02-direct-entry.json       # 直接进屋
      03-rules-question.json     # 质疑规则（meta）
      04-call-police.json        # 试图报警/找NPC
      05-stuck.json              # 卡住不知去哪
    renjian-baiwei/
      01-visit-restaurant.json
      02-investigate-online.json
      03-be-friend-chef.json
    xuese-gonglu/
      01-arrive-town.json
      02-hunt-begins.json
  artifacts/                     # 每个 profile 的 DirectorPlan 输出
  report.json                    # 断言汇总（硬/软通过率）
```

每个 profile JSON 含 `player_intent` + 初始 save 状态快照 + 期望断言锚点。

### 断言项（7 类）

7 类：agency、clue_robustness、pacing、npc_life、memory、horror、safety、rules_fidelity。其中 rules_fidelity 是本项目特色强项（规则层成熟）新增的，蓝图原 6 类未覆盖。

| 类别 | 断言项 | 类型 | 检查方式 |
|---|---|---|---|
| agency | `must_not_reveal` 不含 keeper secret | 硬 | DirectorPlan.narrative_directives.must_not_reveal ⊇ keeper-secrets |
| | 未阻断玩家意图（除非 rule_signal 硬覆盖） | 硬 | scene_action ≠ 否决性动作，除非 Layer 3 命中 |
| | fumble 时用 PRESSURE 而非 No | 硬 | last_roll_fumble → scene_action==PRESSURE |
| clue_robustness | 关键结论有 ≥3 routes（编译期） | 硬 | clue-graph 每个 critical conclusion 的 clues≥3 |
| | stalled 时走 fallback route 不走 spoiler | 硬 | stalled_turns≥3 → clue_policy.fallback_routes 非空 |
| pacing | 每个场景有 dramatic_question | 硬 | story-graph 所有 scene 非空 |
| | 无重复反高潮骰 | 软 | 连续两轮同 skill 同 reason → 警告 |
| | stalled 时 clock 推进 | 硬 | stalled_turns≥2 → pressure_moves 非空 |
| npc_life | 激活的 NPC 有 agenda | 硬 | npc_moves 每个 move 的 agenda 非空 |
| | NPC 不只当信息贩卖机 | 软 | 连续 N 轮 NPC 只给 clue 无 agenda 行动 → 警告 |
| memory | player_interest 被记录 | 软 | memory_writes 在玩家显式关注细节时非空 |
| | 无无关回忆倾倒 | 软 | memory_reads 数 ≤ 阈值（默认 5） |
| horror | 启示前有铺垫 | 软 | revelation 场景前 ≥1 个 wrongness/pattern 场景被访问 |
| | 不过度解释 mythos | 硬 | must_not_reveal 含 mythos 核心真相 |
| safety | keeper secret 不泄露 | 硬 | 全程 must_not_reveal 命中率 100% |
| | content boundary 被尊重 | 硬 | module-meta content_flags 在 tone 里被规避 |
| rules_fidelity | rule_signal 硬覆盖生效 | 硬 | bout_active→SUBSYSTEM(sanity)；dying→SUBSYSTEM(combat)+PRESSURE |
| | 三次免死规则 | 硬 | lethal_chances_used<3 时无致死结局 |

`rules_fidelity` 是本项目特色强项（规则层成熟）新增的类别，蓝图原 6 类未覆盖。

### v1 验证模组

| 模组 | 结构原型 | 验证什么 | 复杂度 |
|---|---|---|---|
| The Haunting | 线性/分支调查 | 基线 smoke：5 种玩家选择，验证 agency/clue/pacing 基础 | 低 |
| 人煎百味 | 据点式地点沙盒 | 地点自由移动 + 玩家自创素材回收；现代题材 content boundary（食人） | 中 |
| 血色公路 | 混合巨结构 | 终极压力测试：v1 只编译前 2 幕（沙盒镇 + Hunt 开始）做 probe | 高 |

模组剧情图用 Section "Module Compilation" 的 skill 流程自动编译（The Haunting 已有的 v2 资料库数据 `scenario/clues.json` 等可作为 LLM 解析的输入参考，但剧情图层级的 story-graph/clue-graph 等需重新编译产出）。harness profiles 在编译产出后针对 story-graph 设计玩家选择。

## Error Handling

- **director 找不到当前 scene**：fallback 到 DEEPEN 或 CHOICE，rationale 记录 "scene_not_found"，不崩。
- **clue-graph 缺关键 conclusion 的 routes**：编译期校验器报错阻断；运行期若仍缺，director 退化为单路径 + 标记 `clue_robustness_warning`。
- **rule_signals 读取失败**（如 investigator-state 损坏）：director 用默认值（hp_state=healthy 等），rationale 记录 `signal_fallback`，harness 软断言会捕获。
- **评分全 0**：兜底选 CHOICE（给玩家清晰方向），rationale 记录 `no_trigger_default`。
- **Layer 3 多个硬覆盖同时命中**：按 SUBSYSTEM > RECOVER > PRESSURE 优先级，rationale 记录所有命中的信号。

## Testing

- **coc_rule_signals.py**：每个翻译函数纯单元测试（输入状态 → 输出信号枚举值）。16 个函数（10 v1 + 6 v2）全覆盖。
- **coc_story_director.py**：每个 profile 的 DirectorPlan 选择可手算复核（deterministic）。测试用固定 RNG seed 保证 npc_reaction_roll 等可复现。
- **coc_scenario_compile.py**：每个编译期硬断言的正反例测试。
- **coc_story_harness.py**：6+1 类断言，3 个模组 × 多 profile 的端到端通过率报告。
- **集成测试**：keeper-play SKILL.md 改循环后，验证 DirectorPlan.handoff 正确路由到规则层或叙事层。

## References

- 背景论证：`docs/superpowers/specs/2026-07-05-story-director-blueprint.md`
- 持久台账：`.zralph/story-director-tasks.md`
- 规则书：Keeper Rulebook 40th Anniversary（465 页）
- 参考模组：`pdf/model/` 12 个 PDF
- 通用 GM 设计：The Alexandrian (dont-prep-plots / 三线索)、Dungeon World (fronts)、Blades in the Dark (progress clocks)
