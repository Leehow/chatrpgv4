# COC Story Director — 剧情编排层设计蓝图

**Date:** 2026-07-05
**Status:** Blueprint (待实现)
**Scope:** 在现有规则层之上新增隐藏的剧情编排层 `coc-story-director`：`SKILL.md` + `coc_story_director.py` + `coc_memory.py` + `coc_story_harness.py`，以及模组"剧情图"文件 schema、记忆分层方案、GM 质量 harness 评测项。目标是让 LGM 从"规则检索器"变成"有导演脑的 KP"。

---

> 本文件为设计蓝图原文存档，下文为设计讨论内容。

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
