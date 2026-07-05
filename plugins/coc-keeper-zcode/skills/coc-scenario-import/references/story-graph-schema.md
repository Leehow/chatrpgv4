# Scenario Story-Graph Schema

模组编译产出的 7 个 JSON 文件 schema + 字段说明 + 完整示例。文件存于 `campaigns/<id>/scenario/`，由 coc-scenario-import 的"剧情图编译"流程产出，被 coc-story-director 在运行期消费。

源 spec：`docs/superpowers/specs/2026-07-05-story-director-design.md` 的 "Scenario Story-Graph Schema" 章节。

编译期硬断言（由 `scripts/coc_scenario_compile.py --validate` 校验）：

- 每个 `importance: critical` 的 conclusion 的 `clues.length >= minimum_routes`（默认 3）
- 每个 scene 的 `dramatic_question` 非空
- 每个 NPC 有非空 `agenda`
- `module-meta.structure_type` ∈ 7 合法值
- `improvisation-boundaries.keeper_secrets` 与 player-safe 内容物理隔离
- `pacing-map` 的 horror_stage 序列在场景访问顺序上大体单调递进（ordinary→wrongness→pattern→revelation）

---

## 1. module-meta.json

模组元数据。声明结构原型、时代、内容警告、胜利条件、来源 PDF。

**字段：**

- `schema_version` (int)：schema 版本号，当前为 `1`。
- `scenario_id` (string)：模组唯一标识（kebab-case）。
- `title` (string)：模组标题。
- `structure_type` (string)：结构原型，决定 director 的 Layer 2 权重表。∈ `{linear_acts, time_loop, branching_investigation, hub_sandbox, multi_faction, campaign_sequel, hybrid_mega}`。
- `era` (string)：时代背景（如 `1920s`、`modern`）。
- `content_flags` (string[])：内容警告标签（如 `supernatural_horror`、`child_endangerment`）。
- `win_condition` (string)：胜利条件简述。
- `source_pdf` (string)：来源 PDF 路径。

**示例：**

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

---

## 2. story-graph.json

场景图。列出模组的所有场景、每个场景的戏剧问题、进入/退出条件、可用线索、关联 NPC、压力动作、调性、可即兴范围。

**字段：**

- `scenes` (object[])：场景数组。每个 scene：
  - `scene_id` (string)：场景唯一标识。
  - `scene_type` (string)：场景类型（如 `investigation`、`social`、`combat`、`exploration`）。
  - `dramatic_question` (string)：该场景要回答的戏剧问题（非空，编译期硬断言）。
  - `entry_conditions` (string[])：进入场景的条件。
  - `exit_conditions` (string[])：退出场景的条件。
  - `available_clues` (string[])：该场景可交付的 clue_id 列表（引用 clue-graph.json）。
  - `npc_ids` (string[])：该场景出现的 NPC（引用 npc-agendas.json）。
  - `pressure_moves` (string[])：导演可用的压力动作（如关闭时间、陌生人监视）。
  - `tone` (string[])：调性关键词（感官/氛围词）。
  - `allowed_improvisation` (string[])：该场景内允许即兴的范围（含反向约束如 "do not invent new cult fact"）。

**示例：**

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

---

## 3. clue-graph.json

线索图。把模组的"结论"建模为节点，每个结论挂多条可独立发现的线索路径。critical 结论至少 3 条路径（编译期硬断言）。

**字段：**

- `conclusions` (object[])：结论数组。每个 conclusion：
  - `conclusion_id` (string)：结论唯一标识。
  - `importance` (string)：`critical` | `major` | `minor`。`critical` 触发最低路径数校验。
  - `minimum_routes` (int)：最少路径数（critical 默认 3）。
  - `clues` (object[])：线索路径数组。每条 clue：
    - `clue_id` (string)：线索唯一标识。
    - `delivery` (string)：交付方式（技能 + 场景）。
    - `visibility` (string)：`player-safe` | `keeper-only`。
  - `fallback_policy` (string)：当多数路径被错过时导演的兜底策略。

**示例：**

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

---

## 4. npc-agendas.json

NPC 议程。每个 NPC 的欲望、恐惧、秘密、声线、与调查员的关系——驱动导演的 `npc_moves`。

**字段：**

- `npcs` (object[])：NPC 数组。每个 NPC：
  - `npc_id` (string)：NPC 唯一标识（被 story-graph 引用）。
  - `agenda` (string)：NPC 想要什么（非空，编译期硬断言）。
  - `fear` (string)：NPC 害怕什么。
  - `secret` (string)：NPC 隐藏的信息。
  - `voice` (string)：声线/说话风格。
  - `relationship_to_investigators` (string)：与调查员的关系（如 `neutral_stranger`、`ally`、`adversary`）。

**示例：**

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

---

## 5. threat-fronts.json

威胁前沿。把模组的活跃威胁建模为 fronts，每个 front 含 dangers（冲动+招式）和 clocks（段数+可见症状+满段后果）。导演的 `pressure_moves` 据此 tick。

**字段：**

- `fronts` (object[])：前沿数组。每个 front：
  - `front_id` (string)：前沿唯一标识。
  - `scope` (string)：作用域（`scenario` 全模组 / `scene` 单场景）。
  - `dangers` (object[])：危险源数组。每个 danger：
    - `id` (string)：危险源标识。
    - `impulse` (string)：危险源的冲动（它想做什么）。
    - `moves` (string[])：可用招式列表。
  - `clocks` (object[])：压力钟数组。每个 clock：
    - `clock_id` (string)：钟唯一标识。
    - `segments` (int)：总段数。
    - `on_tick_visible` (string[])：每 tick 玩家可见的症状。
    - `on_full` (string)：满段后果。

**示例：**

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

---

## 6. pacing-map.json

节奏曲线。为每个场景设定目标紧张度和恐怖阶段。导演的 `narrative_directives.horror_escalation_stage` 据此推进。

**字段：**

- `pacing_curve` (object[])：节奏点数组，按期望访问顺序。每个点：
  - `scene_id` (string)：场景标识（引用 story-graph.json）。
  - `tension_target` (string)：目标紧张度（`low` / `medium` / `high` / `climax`）。
  - `horror_stage` (string)：恐怖阶段（`ordinary` → `wrongness` → `pattern` → `revelation`）。访问顺序上大体单调递进（编译期硬断言）。

**示例：**

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

---

## 7. improvisation-boundaries.json

即兴边界。声明导演可即兴的范围、绝不可即兴的内容、以及 keeper_secrets（绝不向玩家揭示）。`keeper_secrets` 与 player-safe 内容必须物理隔离（编译期硬断言）。

**字段：**

- `invent_allowed` (string[])：允许即兴的范围（如次要职员、天气、闲笔对白）。
- `never_invent` (string[])：绝不可即兴的内容（如新 Mythos 实体、新邪教正典事实、clue-graph 之外的线索内容）。
- `keeper_secrets` (string[])：keeper-only 秘密（绝不向玩家揭示；与 player-safe 物理隔离）。

**示例：**

```json
{
  "invent_allowed": ["minor clerks", "local color NPCs", "weather", "incidental dialogue"],
  "never_invent": ["new Mythos entities", "new cult canonical facts", "clue content not in clue-graph"],
  "keeper_secrets": ["corbitt-is-buried-below", "flesh-ward-mechanics", "dominate-spell"]
}
```
