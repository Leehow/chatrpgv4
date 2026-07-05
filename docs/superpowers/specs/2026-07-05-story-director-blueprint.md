# COC Story Director — 剧情编排层设计蓝图

**Date:** 2026-07-05
**Status:** 设计进行中（brainstorming → 已确认方案 A，正在分章节定稿）
**Scope:** 在现有规则层之上新增隐藏的剧情编排层 `coc-story-director`：`SKILL.md` + `coc_story_director.py` + `coc_rule_signals.py` + `coc_story_harness.py`，以及模组"剧情图"文件 schema、规则状态→剧情信号映射、GM 质量 harness 评测项。目标是让插件从"规则检索器"变成"有导演脑的 KP"。

> **本文件是本任务的唯一真相源（single source of truth）。** 下文两部分：
> - **[A] 决策台账与进度** —— 每次确认一个决策就更新这里。上下文被压缩/腐烂时，先读本节找回定位。
> - **[B] 原始设计讨论** —— 蓝图原文，论证与背景，不轻易改动。

---

## [A] 决策台账与进度

> **使用约定：** 每完成一个设计决策或里程碑，更新对应行的 `状态`，并在 `进度日志` 追加一行。`v1 范围` 列出本轮明确做与不做的边界。

### A.0 当前进度（最后更新：2026-07-05 design session）

- [x] 蓝图存档（本文件 [B] 节）
- [x] brainstorming 启动
- [x] 范围切片确认：**闭环 + harness 验证**（不做完整记忆层/向量库）
- [x] 集成方式确认：**独立 Python 模块 + v1 直接接 keeper-play 循环**
- [x] 决策强度确认：**真决策**（deterministic planner 选一个导演动作，方案 A）
- [x] harness 输入确认：**JSON profile 驱动**，放 `.coc/playtests/v7-director-smoke/profiles/`
- [x] 模组类型调研：12 个模组归为 7 种结构原型（见 A.3）
- [x] 规则耦合调研：22 个"规则→剧情"耦合点跨 11 域（见 A.4）
- [ ] 设计 Section 2 定稿：DirectorPlan schema + 规则信号注入方式
- [ ] 设计 Section 3 定稿：v1 接入哪些规则耦合点（从 22 个里选）
- [ ] 设计 Section 4 定稿：评分规则表（按 structure_type 参数化）
- [ ] 设计 Section 5 定稿：harness 断言项 + 验证模组选择
- [ ] 写正式 design spec（本文件定稿后另存为 `-design.md`）
- [ ] spec 自审 + 用户复审
- [ ] 转 writing-plans 出实现计划

### A.1 v1 范围（做 / 不做）

**v1 做：**
- `coc_story_director.py` —— deterministic planner，含 `apply_rule_signals()` / `score_scene_options()` / `write_director_plan()`
- `coc_rule_signals.py` —— 22 耦合点中 v1 选定子集的"规则状态→剧情信号"纯函数映射（独立可测）
- `coc-story-director/SKILL.md` —— 内部顾问 skill
- `coc-keeper-play/SKILL.md` —— **改循环**，接入 director（端到端打通）
- `coc_story_harness.py` —— GM 质量评测，走完整 keeper-play 循环
- `references/director-protocol.md` —— DirectorPlan schema + 评分规则说明
- 模组剧情图编译：**≥2 种结构原型**的代表模组（待 Section 5 定）
- harness profiles：`.coc/playtests/v7-director-smoke/profiles/`，JSON 驱动

**v1 不做（明确切掉，留给后续轮次）：**
- 完整记忆层：semantic-cards 检索打分、向量库、embeddings（DirectorPlan 的 `memory_reads/writes` 字段先留 schema，v1 只读 session-summaries 或留空）
- 其余 10 个模组的剧情图编译
- LLM 兜底分支（director 全 deterministic，符合蓝图"第一版不用 LLM 也能工作"）
- 完整 22 耦合点实现（v1 只选高价值子集，见 A.4 / Section 3）

### A.2 已确认架构决策

| 决策点 | 选择 | 理由 |
|---|---|---|
| 方案形态 | **A：规则优先级 + 评分表** | 完全可测，符合"deterministic planner"主张；B 状态机违背 prep-situations，C LLM 兜底破坏可测性 |
| director 与规则层关系 | **读规则状态**（只读），通过 `coc_rule_signals.py` 转成剧情信号 | 规则状态（hp/san/cr/luck...）反向影响剧情决策，不能脱离规则层独立存在 |
| 集成方式 | **独立模块 + v1 直接接 keeper-play 循环** | 像 coc_combat 一样可独立测；用户要求直接测端到端 |
| 决策强度 | **真决策**：每回合选一个导演动作 | 符合蓝图核心算法主张 |
| harness 形态 | **JSON profile 驱动 + 端到端走 keeper-play** | 与现有 v1-v6 playtest 形态一致 |
| 模组鲁棒性 | **按 structure_type 参数化评分权重** | 7 种结构原型，单一假设会失败 |
| 记忆层 | **v1 不做**，schema 留位 | 避免范围爆炸 |

### A.3 模组类型分布（12 模组 → 7 结构原型）

调研对象：`/Users/haoli/leehow/code/chatrpgv4/pdf/model/` 12 个 PDF。

| 结构原型 | 代表模组 | director 核心能力需求 |
|---|---|---|
| 线性/分幕 | Cursed Be the City, King of Shreds | scene 顺序推进 |
| 时间循环 | An Amaranthine Desire | 跨迭代记忆/知识状态 |
| 分支调查（线索沙盒） | Cold Harvest, Dust to Dust | 无序线索图、lead graph |
| 据点式地点沙盒 | 人煎百味, Garden of Earthly Delights | 地点列表、自由移动、地点触发场景 |
| 多阵营政治网 | They Did Not Think It Too Many | 阵营关系模型、社交解决路径 |
| 战役续作 | Herald of the Yellow King | 跨模组状态、前作角色回调 |
| 混合巨结构 | 血色公路（111 页） | 沙盒+时间线+地城 全部组合 |

非场景资料书 1 个：黑暗时代的哈斯塔崇拜（Coven vs Court 分类法 → 可当阵营生成器）。

**设计约束：** director 评分规则表必须按 `structure_type` 选权重；`血色公路` 是终极压力测试。

### A.4 规则→剧情耦合点（22 个，跨 11 域）

调研对象：Keeper Rulebook 40th Anniversary 全 465 页。详见正式 spec 的耦合明细表。v1 优先级：

| 优先级 | 耦合点 | 域 | 规则书页 | 现状 |
|---|---|---|---|---|
| ⭐⭐⭐ | APP/CR NPC 反应检定（concealed roll 设 NPC 情绪） | A2 | p.191 | 完全没实现 |
| ⭐⭐⭐ | Idea Roll 卡住恢复阀（成功给线索/失败 in medias res） | I1 | p.199 | 完全没实现 |
| ⭐⭐ | Credit Rating 分层→场景准入/NPC 态度 | A1 | p.45-47 | 有数据，无剧情映射 |
| ⭐⭐ | Major Wound/Dying/Unconscious→行动约束+死亡钟 | B1-3 | p.120 | 部分（combat conditions） |
| ⭐⭐ | 临时疯狂/疯狂发作→接管调查员+改 backstory | D1,D3 | p.155-158 | 有阈值数据+bout 表，无触发逻辑 |
| ⭐⭐ | 大成功(01)→director 编造利好 / 大失败(96-100)→编造厄运 | C1,C2 | p.89 | 有阈值，无 director 动作 |
| ⭐⭐ | NPC Luck pool（反派逃脱阀） | E2 | p.199 | 完全没实现 |
| ⭐ | 失败 SAN roll→插入非自愿动作 / 恐惧症激活罚骰 | D4,D5 | p.154,159 | 有种类数据，无触发 |
| ⭐ | Psychology 隐骰→喂假情报 | F1 | p.191 | 无 |
| ⭐ | Pushed fail→必须更糟后果 | H1 | p.84 | 有 foreshadow 数据，无生成 |
| ⭐ | 张力钟+"三次免死"+怪物脱敏 | K1 | p.198,209 | 无 |

**v1 选定子集：待 Section 3 确认**（候选：A1/A2/B1-3/C1-2/D1/D3/I1，约 8-10 个高价值耦合）。

### A.5 进度日志

- `2026-07-05` 蓝图原文存档（[B] 节）
- `2026-07-05` brainstorming 启动；确认范围=闭环+harness；集成=独立模块+接 keeper-play；决策=真决策方案 A；harness=JSON profile
- `2026-07-05` 模组类型调研完成（7 结构原型）；规则耦合调研完成（22 耦合点/11 域）
- `2026-07-05` 架构修订：新增 `coc_rule_signals.py` 独立模块；v1 直接改 keeper-play 循环

---

## [B] 原始设计讨论（蓝图原文）

> 以下为初始设计讨论原文，保留作为背景论证。当前实现以 [A] 节台账为准。

你这个判断是对的：**现在这个项目再补战斗、追逐、SAN、装备、魔法，本质上还是"规则器"**。规则层只能保证"不会胡判"，但跑团的灵魂不是规则，而是 **GM 如何把模组变成一场有节奏、有情绪、有选择后果的共同叙事**。

我建议新增的不是一个更大的 `coc-keeper-play`，而是一个隐藏的 **剧情编排层**：

> `coc-story-director` skill + `coc_story_director.py` + `coc_story_harness.py`

它不直接面对玩家，不直接写最终叙事，而是给 `coc-keeper-play` 提供"下一步该怎么跑"的导演决策。规则层继续负责稳住规则；导演层负责让游戏有趣。

我参考了你上传的三本 CoC 资料：Keeper Rulebook、Masks of Nyarlathotep、A Time to Harvest。   也看了几个通用 TRPG GM 设计方法：The Alexandrian 的"不要预设剧情,预设局势"、三线索思想、Blades 的 clocks、Dungeon World 的 fronts。

## 先定原则：不要让 LLM "讲模组",要让它"跑局势"

CoC 规则书对 Keeper 的描述其实已经很清楚：Keeper 类似导演，玩家像不知道剧情如何发展的演员，可以自由即兴；大多数游玩是 Keeper 描述环境、NPC、遭遇，玩家说明行动，然后 Keeper 判断结果。 这说明插件不能只是"根据模组问答"，而要让 LLM 在每个回合都做一个 GM 决策：当前场景是否继续、玩家是否卡住、该给线索还是施压、NPC 该主动还是隐藏、节奏该放慢还是剪辑。

网上通用 GM 设计里有一个很关键的原则：不要准备固定 plot，而要准备 situation。The Alexandrian 直接说"Don't prep plots, prep situations"，并把 plot 定义为预定事件序列，把 situation 定义为一组会因玩家行动而变化的局势。([亚历山大网站][1]) 这和你的插件方向非常契合：模组不是固定路线，模组应该被编译成"场景节点、线索网络、NPC 目标、敌对势力时钟、可触发压力"。

所以这个插件应该变成：

```text
规则层：这个动作怎么判？骰什么？状态怎么改？
剧情编排层：现在这场戏为什么存在？张力在哪？下一步推什么？
记忆层：玩家关心过什么？NPC 记得什么？哪些线索和情绪要回响？
叙事层：把导演决策变成沉浸式中文跑团文本。
```

## 新增 skill：`coc-story-director`

这个 skill 不应该直接暴露给用户。它是 `coc-keeper-play` 的内部顾问。

它每一轮输入：

```json
{
  "player_intent": "玩家刚刚声明的行动",
  "active_scene": "当前场景",
  "scenario_context": "可用模组节点、NPC、线索、秘密",
  "campaign_state": "save/world-state + flags + investigator-state",
  "memory_context": "检索出来的关键记忆卡",
  "pacing_state": "当前节奏、张力、玩家是否卡住",
  "subsystem_status": "是否进入 combat/chase/sanity/meta"
}
```

输出一个隐藏的 `DirectorPlan`：

```json
{
  "decision_id": "director-2026-07-05-0001",
  "scene_action": "continue | cut | montage | escalate | reveal | ask_choice | subsystem",
  "dramatic_question": "玩家这场戏要回答什么问题？",
  "player_agency_read": "玩家真正想做什么，而不是字面动作",
  "pacing_mode": "slow_burn | investigation | social | pressure | climax | aftermath",
  "tension_delta": 1,
  "clue_policy": {
    "reveal": ["clue-id"],
    "withhold": ["keeper-secret-id"],
    "fallback_routes": ["alternate-clue-id"]
  },
  "npc_moves": [
    {
      "npc_id": "npc-x",
      "agenda": "隐藏/试探/引诱/阻挠/求助",
      "emotional_tone": "紧张但礼貌",
      "secret_limit": "不要透露 keeper_secret"
    }
  ],
  "pressure_moves": [
    {
      "clock_id": "cult-alert",
      "tick": 1,
      "visible_symptom": "远处出现同一辆黑色轿车"
    }
  ],
  "rules_requests": [
    {
      "kind": "skill_check",
      "skill": "Spot Hidden",
      "reason": "只有玩家主动检查门框才触发"
    }
  ],
  "memory_reads": ["mem-card-123", "npc-ledger-arty"],
  "memory_writes": [
    {
      "type": "player_interest",
      "summary": "玩家对门锁和新划痕很敏感，喜欢从细节推理"
    }
  ]
}
```

`coc-keeper-play` 再根据这个计划写玩家可见文本。这样 LLM 有"导演脑"，但玩家看到的仍是自然跑团。

## 编排层应该管理 6 件事

第一是 **场景目的**。每个场景都要有一个 `dramatic_question`，例如"玩家能否发现房子不是普通凶宅？""玩家是否相信这个 NPC？""玩家是否愿意为了线索承担风险？"没有戏剧问题的场景就应该剪掉、蒙太奇或压缩。

第二是 **线索网络**。CoC 规则书里"层层揭开谜团"的写法很适合建模：谜团像洋葱，每个线索剥开一层，每层应该给玩家两三个可前进选择。 The Alexandrian 的三线索思想也很适合这里：关键结论不要只靠一条线索，任何 choke point 至少准备多条抵达路径。([亚历山大网站][1])

第三是 **NPC/势力主动性**。NPC 不能只是资料按钮。每个 NPC 应该有 agenda、fear、leverage、secret、voice、relationship。玩家不去找线索，敌人也会行动。Dungeon World 的 fronts 很适合借鉴：front 是一组 linked dangers，有 impending doom、grim portents、stakes questions、cast，用来组织反派和威胁。([地下世界SRD][2])

第四是 **节奏与压力**。Blades in the Dark 的 progress clocks 可以直接借过来：clock 不是规定玩家方法，而是追踪障碍、警觉、危险逼近、窗口关闭。官方 SRD 强调 clock 应该关于 obstacle 而不是 method，例如追踪"警戒程度"而不是"潜行过守卫"。([暗刀游戏][3]) 这正适合 CoC：`cult_alert`、`police_heat`、`sanity_pressure`、`ritual_progress`、`npc_trust`、`mythos_manifestation`。

第五是 **玩家卡住时的扶手**。CoC 规则书里的 Idea Roll 本质是"剧情续航阀"：目标是让调查回到轨道上；成功给足以继续推进的信息，失败则让调查员进入麻烦现场。它还给出非常适合 LLM GM 的 "Yes, and…" / "Yes, but…" 思路，而不是直接 No。

第六是 **安全与口味控制**。A Time to Harvest 明确把 content warning、consent、fade to black 当成 Keeper 技能的一部分。 这应该进入导演层，而不是只靠最终叙事层临场想。

## 模组需要被编译成"剧情图"，不是 PDF 摘要

当前 `scenario.json/clues.json/npcs.json/handouts.json` 还偏资料库。编排层需要一组新文件：

```text
scenario/
  story-graph.json
  clue-graph.json
  npc-agendas.json
  threat-fronts.json
  pacing-map.json
  improvisation-boundaries.json
```

`story-graph.json` 不是固定路线，而是场景节点：

```json
{
  "scene_id": "archive-research",
  "scene_type": "investigation",
  "dramatic_question": "玩家能否把公开记录和隐藏邪教联系起来？",
  "entry_conditions": [
    "player asks about public records",
    "player seeks historical ownership",
    "director uses fallback clue after stalled investigation"
  ],
  "exit_conditions": [
    "clue_chapel_link discovered",
    "player abandons research",
    "pressure clock reaches 3"
  ],
  "available_clues": ["clue-chapel-link", "clue-lawsuit"],
  "npc_ids": ["npc-archivist"],
  "pressure_moves": ["closing_time", "watched_by_stranger"],
  "tone": ["dust", "old paper", "bureaucratic indifference"],
  "allowed_improvisation": [
    "invent minor clerk",
    "invent local color",
    "do not invent new cult fact"
  ]
}
```

`clue-graph.json` 应该记录每个关键结论至少几条路径：

```json
{
  "conclusion_id": "corbitt-linked-to-chapel",
  "importance": "critical",
  "minimum_routes": 3,
  "clues": [
    {
      "clue_id": "newspaper-clipping",
      "delivery": "Library Use / archive scene",
      "visibility": "player-safe"
    },
    {
      "clue_id": "neighbor-rumor",
      "delivery": "social scene / cautious inquiry",
      "visibility": "player-safe"
    },
    {
      "clue_id": "symbol-on-doorframe",
      "delivery": "Spot Hidden / house entry",
      "visibility": "player-safe"
    }
  ],
  "fallback_policy": "If two routes are missed, director may move one clue to a new scene."
}
```

`threat-fronts.json` 则管理敌方行动：

```json
{
  "front_id": "cult-observation",
  "scope": "scenario",
  "dangers": [
    {
      "id": "watchers",
      "impulse": "observe and isolate investigators",
      "moves": [
        "appear at a distance",
        "steal a note",
        "pressure an NPC ally",
        "cut off a safe route"
      ]
    }
  ],
  "clocks": [
    {
      "clock_id": "cult-alert",
      "segments": 6,
      "on_tick_visible": [
        "陌生人记住了调查员的名字",
        "旅馆房间被翻动",
        "盟友开始害怕说话"
      ],
      "on_full": "cult directly acts against the investigator"
    }
  ]
}
```

Masks of Nyarlathotep 本身就是这种结构的最佳例子：它明确说大型战役会有复杂 clue trail、links、chapter order 可变，玩家可能跳过章节，Keeper 要灵活，不要强迫玩家去不想去的地方，遗漏章节也可以用 well-planted clue 拉回来。

## 记忆方案：不要把 memory 当 save，memory 是"注意力系统"

现在的问题不是"用 JSON 存不行"，而是**记忆和存档语义混在一起**。我建议明确四类东西：

```text
save = 世界现在真实是什么
logs = 过去发生了什么
memory = 哪些经历、关系、情绪、线索值得未来重新浮现
director = 下一场戏应该如何利用这些记忆
```

文件仍然可以存，但目录和 schema 要分层：

```text
.coc/
  memory/
    user-profile.json                 # 玩家长期偏好，不属于某个战役
    table-style.json                  # 喜欢慢烧、动作、调查、恐怖强度等
    gm-lessons.jsonl                  # 系统从 playtest/真实游玩学到的主持经验

  investigators/<investigator-id>/
    memory/
      character-memory.jsonl          # 角色长期经历、创伤、关系、执念

  campaigns/<campaign-id>/
    memory/
      episodic/session-*.jsonl        # 每场戏/每次会话经历
      semantic-cards/*.json           # 可检索记忆卡
      npc-ledger.json                 # NPC 对玩家/调查员的态度、承诺、秘密暴露
      plot-threads.json               # 未解决谜团、玩家假设、活跃线索
      player-model.json               # 当前玩家风格：谨慎/鲁莽/规则质疑/沉浸偏好
      director-notes.jsonl            # 编排层自己的隐藏笔记
      recap/player-safe.jsonl         # 玩家可见回顾
      recap/keeper-only.jsonl         # KP-only 回顾
```

每张 `semantic-card` 应该像这样：

```json
{
  "memory_id": "mem-ada-door-scratches",
  "scope": "campaign",
  "privacy": "player_safe",
  "source_event_ids": ["event-42", "roll-18"],
  "entities": ["ada-king", "corbitt-house", "front-door"],
  "tags": ["player_interest", "physical_clue", "entry_threshold"],
  "salience": 0.82,
  "decay": "session",
  "summary": "玩家对门框新划痕非常在意，并倾向用触摸、细看、绕路等方法确认危险。",
  "reactivation_cues": [
    "door",
    "lock",
    "fresh marks",
    "player inspects threshold",
    "house entry"
  ],
  "possible_payoff": "下次遇到类似入口时，给玩家一个可利用的细节或让 NPC 评论其谨慎。"
}
```

这样 LLM GM 不需要每轮读一堆 JSON。它只读：

```text
当前场景相关的 5-12 张记忆卡
当前 NPC ledger
当前 plot threads
当前 active clocks
```

记忆检索不一定马上上向量库。第一版可以纯文件 + 打分：

```text
score =
  entity_overlap * 0.30
  + unresolved_thread * 0.25
  + recentness * 0.15
  + emotional_salience * 0.15
  + player_preference_match * 0.10
  + director_pin * 0.05
```

后面再加 embeddings/vector index，不要第一版就把复杂度压到向量数据库上。

## `coc-story-director` skill 草案

可以新增：

```text
plugins/coc-keeper/skills/coc-story-director/SKILL.md
plugins/coc-keeper/references/director-protocol.md
plugins/coc-keeper/scripts/coc_story_director.py
plugins/coc-keeper/scripts/coc_memory.py
plugins/coc-keeper/scripts/coc_story_harness.py
```

`SKILL.md` 大概这样：

```markdown
---
name: coc-story-director
description: Internal COC Keeper narrative orchestration layer. Use only after COC mode is active, before coc-keeper-play renders the next player-visible response, to choose scene direction, pacing, clue delivery, NPC moves, pressure clocks, and memory use. This skill does not output final narration to the player.
---

# COC Story Director

## Role

You are the hidden director layer, not the player-facing Keeper voice.

Your job is to decide what the next table moment should accomplish:
- preserve player agency
- maintain module fidelity
- advance mystery without railroading
- manage horror pacing
- activate NPC agendas
- select memories that should matter now
- route mechanical resolution to rule subsystem skills

## Inputs

Read:
- campaign save state
- active scene
- scenario story graph
- clue graph
- NPC agendas
- threat fronts and clocks
- relevant memory cards
- latest player intent
- current safety and play-language profile

## Output

Return a DirectorPlan JSON object. Do not write immersive prose.
Do not reveal Keeper-only facts.
Do not invent new canonical scenario facts unless allowed by improvisation-boundaries.json.

## Decision Loop

1. Interpret player intent.
2. Classify scene action:
   continue, cut, montage, escalate, reveal, ask_choice, subsystem.
3. Choose one dramatic question for the next beat.
4. Decide whether to reveal clue, foreshadow danger, escalate clock, or let quiet breathe.
5. Choose NPC agenda and voice constraints.
6. Select rules calls only when tension or uncertainty justifies dice.
7. Emit memory reads and memory writes.
8. Return control to coc-keeper-play.

## Hard Rules

- Prep situations, not predetermined plot.
- Never block player plans with a flat No when Yes-but or Yes-and can preserve agency.
- Critical clues must have fallback routes.
- Do not repeat identical rolls until anticlimactic.
- Horror should usually escalate from ordinary detail to wrongness to pattern to revelation.
- Memory is not recap spam; only recall what changes the current beat.
```

## `coc_story_director.py` 第一版不用 LLM 也能工作

第一版脚本应该是 deterministic planner，而不是"另一个模型调用"。它负责读 JSON、算分、输出候选计划。LLM 只在最后选择和润色。

核心函数：

```python
def build_director_context(campaign_dir, player_intent) -> DirectorContext:
    ...

def score_scene_options(context) -> list[SceneOption]:
    ...

def select_clue_policy(context, scene_option) -> CluePolicy:
    ...

def tick_pressure_clocks(context, trigger) -> list[ClockUpdate]:
    ...

def retrieve_memory_cards(context, player_intent) -> list[MemoryCard]:
    ...

def write_director_plan(context) -> DirectorPlan:
    ...
```

这让系统可测，不会全靠 prompt 玄学。

## 编排 harness 要测"有没有灵魂"，不是只测规则是否正确

现在 playtest harness 测的是规则、报告、战斗、追逐、SAN。新 harness 应该测 GM 质量：

```text
coc_story_harness.py
profiles:
  - haunting-director-smoke
  - harvest-scene-setting
  - masks-sandbox-routing
  - memory-continuity-drill
  - pacing-pressure-drill
```

评测项：

```json
{
  "agency": {
    "railroaded": false,
    "accepted_unexpected_player_plan": true,
    "used_yes_but_or_yes_and": true
  },
  "clue_robustness": {
    "critical_conclusions_have_3_routes": true,
    "missed_clue_recovered_without_spoiler": true
  },
  "pacing": {
    "scene_had_dramatic_question": true,
    "no_repeated_anticlimactic_rolls": true,
    "pressure_clock_advanced_when_stalled": true
  },
  "npc_life": {
    "npc_had_agenda": true,
    "npc_did_not_act_as_info_vendor_only": true
  },
  "memory": {
    "recalled_player_interest": true,
    "did_not_dump_irrelevant_recap": true,
    "npc_remembered_prior_interaction": true
  },
  "horror": {
    "used_foreshadowing_before_revelation": true,
    "did_not_overexplain_mythos": true
  },
  "safety": {
    "respected_content_boundaries": true,
    "kept_keeper_secrets_out_of_player_view": true
  }
}
```

A Time to Harvest 里有一个非常好的节奏例子：不要让玩家在废墟中每条街都重复 Stealth，因为连续重复检定会反高潮；每个主要地点一次就够，要让玩家感到进展，用小障碍积累张力并驱向高潮。 这个可以直接变成 harness 检查：`pacing_repeated_roll_antipattern`。

## 编排层的核心算法：每回合选一个"导演动作"

每个玩家输入后，导演层只做一个主动作，不要一口气又给线索、又上怪、又推进 NPC、又写回忆。建议动作集：

```text
REVEAL        给线索或确认玩家推理
DEEPEN        增加谜团层次，但不给结论
PRESSURE      推进 clock、敌人靠近、时间流逝
CHARACTER     让 NPC/调查员关系产生变化
CHOICE        给玩家两个或三个清晰方向
CUT           剪到下一个有意义的场景
MONTAGE       压缩无张力过程
SUBSYSTEM     交给规则层：roll/combat/chase/sanity/meta
RECOVER       玩家卡住时给 idea/fallback clue
PAYOFF        回收旧记忆、旧选择、旧恐惧
```

这样 LLM GM 会更像人类 KP：它知道此刻该"收"还是"放"。

## 跟现有层的集成方式

现在的 `coc-keeper-play` 循环可以改成：

```text
1. 读取玩家输入
2. 读取 save/logs/memory/scenario
3. 调 coc-story-director 生成 DirectorPlan
4. 如果 DirectorPlan 需要规则，调用 coc-roll/combat/chase/sanity
5. 把规则结果回填 DirectorPlan
6. coc-keeper-play 只负责最终沉浸式输出
7. 写 events.jsonl、director-notes.jsonl、memory cards、save updates
```

也就是：

```text
coc-keeper-play = 演员/主持声音
coc-story-director = 导演/编排脑
coc-rules/combat/chase/sanity = 裁判
coc-memory = 长期连续性和玩家画像
```

## 最重要的一点：模组忠实不等于照本宣科

`Masks` 明确要求 Keeper 读懂大局、知道该强调什么、略过什么、暗示什么、威胁什么、轻描淡写什么。它甚至建议把每章重要场景和地点提炼成 bullet points，记下最重要的三件事，帮助驱动调查员朝正确方向行动。

这就是我们要自动化的东西。不是把 PDF 摘给玩家，而是为每个模组生成：

```text
本章必须保住的核心真相
本章可自由发挥的连接组织
本章 NPC 的欲望和恐惧
本章玩家可能卡住的位置
本章可移动线索
本章压力时钟
本章节奏曲线
本章安全边界
```

LLM GM 有了这些，才会像 KP，而不是规则检索器。

## 推荐落地顺序

第一步不要做大而全。先做一个可跑的 `haunting-director-smoke`：

```text
输入：
玩家在 The Haunting 开场中做出 5 种不同选择：
1. 先查档案
2. 直接进屋
3. 质疑规则
4. 试图报警/找 NPC 帮忙
5. 卡住不知去哪

输出：
DirectorPlan 是否能：
- 保留玩家选择
- 不泄露 Keeper-only 信息
- 通过不同方式给关键线索
- 在玩家拖延时推进压力
- 记住玩家风格
- 给 coc-keeper-play 生成好用的叙事指令
```

然后再扩到 A Time to Harvest 的"scene setting"，因为它本身就鼓励开局前让玩家描述日常生活，Keeper 记录教授、朋友、室友等玩家自创素材，并在后面回收，这正是记忆层的最佳测试样本。

我的建议是：**不要再优先补规则层了。下一步先实现 `coc-story-director`，哪怕它第一版只是 deterministic JSON planner。** 只要这个层跑起来，当前规则器才会变成一个真正的 LLM GM 插件的地基，而不是最终产品。

[1]: https://thealexandrian.net/wordpress/4147/roleplaying-games/dont-prep-plots "The Alexandrian  » Don't Prep Plots"
[2]: https://www.dungeonworldsrd.com/gamemastering/fronts/ "Fronts – Dungeon World SRD"
[3]: https://bladesinthedark.com/progress-clocks "Progress Clocks | Blades in the Dark RPG"
