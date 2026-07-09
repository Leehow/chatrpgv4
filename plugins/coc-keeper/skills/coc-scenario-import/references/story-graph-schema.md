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
  - `affordances` (object[], optional)：该场景自然露出的可行动线（diegetic routes，非玩家菜单）。开场与多分叉场景应至少 2 条，让玩家有选择权、不被线性推向单一出口。每条含 `id`（route 标识）、`cue`（可行动的感官/叙事提示）、可选 `route_type`（**固定枚举**，选最贴切的：`tenant_history` 前租客/房史、`reward_scope` 报酬范围、`direct_entry` 直接进入、`npc_question` 向 NPC 追问、`environment` 环境调查、`investigative_lead` 调查线索、`scene_affordance` 场景通用——运行时 focus 提取按此枚举匹配玩家结构化意图）、可选 `status`（`open`/`suggested`/`exhausted`/`locked`，缺省视为 `open`）。引擎据此结构化计算 `is_real_fork`（≥2 条 open route），仅在真分叉时才把选择交给玩家。
  - `storylet_tags` (string[], optional)：该场景在进入时可触发的 storylet 语义标签（如 `opening_briefing`/`arrival`/`first_contact`）。当玩家首次进入该场景（source_event_type 为 `scene_transition`/`scene_enter`）时，引擎会触发 `storylet_tags` 匹配的 storylet beat（storylet 端用其 `scene_tags` 字段匹配）。调查/社交开场场景宜标 1-2 个，让开场不只靠骰子事件也能调度剧情片段。
  - `npc_ids` (string[])：该场景出现的 NPC（引用 npc-agendas.json）。
  - `pressure_moves` (string[])：导演可用的压力动作（如关闭时间、陌生人监视）。
  - `tone` (string[])：调性关键词（感官/氛围词）。
  - `allowed_improvisation` (string[])：该场景内允许即兴的范围（含反向约束如 "do not invent new cult fact"）。
  - `on_enter` (object, optional)：场景首次进入时引擎自动触发的钩子。子字段：
    - `san_triggers` (object[])：进入场景时自动发起的 SAN 检定。每条含 `trigger_id`（去重标识）、`source`（SAN 来源描述）、`san_loss_success`（成功时损失，如 0）、`san_loss_fail_expr`（失败时损失表达式，如 "1"、"1D6"、"1D6/1D12"）、可选 `creature_type`（怪物类型，用于"习惯化"上限）、`tag`（violence/unnatural/helplessness 等分类）。同一 trigger_id 只触发一次。
    - `clock_ticks` (object[])：进入场景时自动推进的威胁时钟。每条含 `clock_id`（引用 threat-fronts.json 的 clock）和可选 `reason`。
    - `danger_attacks` (object[])：战斗场景中 director 自动解析的 danger 攻击。每条含 `danger_id`（引用 threat-fronts.json 的 danger）和可选 `attack_name`（指定该 danger 的某个 attack_profile；不指定则用第一个）。

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
    - `delivery` (string)：交付方式（技能 + 场景）。**遗留字段**，保留作字符串启发式回退之用；新数据应优先填 `delivery_kind` 等结构化字段（见下）。
    - `visibility` (string)：`player-safe` | `keeper-only`。
    - `delivery_kind` (string，可选)：结构化交付类型。导演优先读这个字段而不是猜 `delivery`。取值：
      - `skill_check` — 需要一次技能检定才能浮出（obscured），配合 `skill` + `difficulty`。
      - `obvious` — 直接给出，无检定（叙述者交付）。
      - `handout` — 以手稿/文件形式给出（obvious）。
      - `npc_dialogue` — 通过 NPC 对白给出（obvious）。
      - `environmental` — 通过环境描写给出（obvious）。
    - `skill` (string，可选)：当 `delivery_kind=skill_check` 时使用的技能名（如 `Spot Hidden`、`Library Use`）。其它 `delivery_kind` 留空。
    - `difficulty` (string，可选)：技能检定难度 `regular` | `hard` | `extreme`，默认 `regular`。仅 `skill_check` 有效。
    - `player_safe_summary` (string，可选)：可向玩家揭示的、面向玩家的安全摘要文本（导演会把它放入 `narrative_directives.must_include`）。**遗留字段 `player_visible_anchor` 仍被读取作回退**，两者都存在时优先用 `player_safe_summary`。
    - `handout_asset_id` (string，可选)：当这条线索带有一张可向玩家展示的手稿/地图/剪报/肖像图片时，填入 `index/handout-assets.json` 中已登记的 `asset_id`。导演应用层（`coc_director_apply.apply_plan`）在产出 `clue_reveal` 事件时会读 `scenario/clue-graph.json` 找到这条 clue，再通过 `coc_scenario.load_handout_assets` 解析该 asset，把 `handout_asset_id` + `handout_title` + `handout_summary` + `player_visible` 渲染提示附到事件上。没有此字段时事件保持原样（向后兼容）。详见下方「handout-assets.json」一节。
    - `source_refs` (object[]，可选)：溯源引用数组，指向来源 PDF 中的具体位置。每条 `source_ref` 含 4 个规范字段：
      - `source_id` (string)：稳定 id（如 `pdf:the-haunting`），用于跨文件交叉引用。
      - `path` (string)：PDF 文件路径（相对或绝对，如 `pdf/Call Of Cthulhu Keeper Rulebook 40th Anniversary (Sandy Petersen).pdf`）。
      - `page` (int)：0 基 PDF 页码（与 pdf_cache 一致）。
      - `grep_anchor` (string)：该页中一句可辨识的短语，可用 `grep` 对 pdf_cache markdown 验证。
    - 线索路由可选字段（lead graph 用）：导演按这些字段在多条等价路径中路由，缺省时回退默认值。
      - `route_priority` (float，可选)：0.0-1.0，越高代表越直接/可能的路径（默认 0.5）。
      - `leads_to` (string[]，可选)：该线索自然指向的 scene_id/npc_id 列表。
      - `risk` (string，可选)：`low` | `medium` | `high`，走这条路径的风险等级。
      - `requires_player_action` (string，可选)：玩家为获取此线索必须执行的动作描述。
  - `fallback_policy` (string)：当多数路径被错过时导演的兜底策略。

> **向后兼容**：`delivery_kind` / `skill` / `difficulty` / `player_safe_summary` / `source_refs` / `route_priority` / `leads_to` / `risk` / `requires_player_action` / `handout_asset_id` 全部可选。没有这些字段的旧 clue-graph 仍能通过校验并正常工作——导演会回退到读取 `delivery` 字符串做启发式判断，线索路由字段缺省时回退 `route_priority=0.5`（所有路径等价）。只有当某个字段被填了但格式不对（如 `delivery_kind=skill_check` 却没给 `skill`，或 `source_ref` 缺 `source_id`/`path`/整数 `page`/`grep_anchor`）时，编译器才会发 warning（不是 error）。

**示例：**

```json
{
  "conclusions": [
    {
      "conclusion_id": "corbitt-linked-to-chapel",
      "importance": "critical",
      "minimum_routes": 3,
      "clues": [
        {
          "clue_id": "newspaper-clipping",
          "delivery": "Library Use / archive scene",
          "visibility": "player-safe",
          "delivery_kind": "skill_check",
          "skill": "Library Use",
          "difficulty": "regular",
          "player_safe_summary": "1920年的剪报提到教堂地下室的诉讼记录被转移",
          "handout_asset_id": "handout-newspaper",
          "source_refs": [
            { "source_id": "pdf:the-haunting", "path": "pdf/Call Of Cthulhu Keeper Rulebook 40th Anniversary (Sandy Petersen).pdf", "page": 92, "grep_anchor": "Chapel records were moved" }
          ]
        },
        {
          "clue_id": "neighbor-rumor",
          "delivery": "social scene / cautious inquiry",
          "visibility": "player-safe",
          "delivery_kind": "npc_dialogue",
          "player_safe_summary": "邻居提到夜里听到地下室传来低语"
        },
        {
          "clue_id": "symbol-on-doorframe",
          "delivery": "Spot Hidden / house entry",
          "visibility": "player-safe",
          "delivery_kind": "skill_check",
          "skill": "Spot Hidden",
          "difficulty": "hard",
          "player_safe_summary": "门框边缘刻着一个眼睛状的符号"
        }
      ],
      "fallback_policy": "If two routes are missed, director may move one clue to a new scene."
    }
  ]
}
```

---

## 4. handout-assets.json

手稿资产索引。位于 `index/handout-assets.json`，由 `create_scenario_skeleton` 写成空骨架（`assets: []`），运行期由 `coc_scenario.load_handout_assets(campaign_dir)` 读取，返回 `{asset_id: asset}` 字典。当一条 clue 的 `handout_asset_id` 指向这里登记的资产时，`clue_reveal` 事件会附上解析后的展示信息。

**顶层字段：**

- `schema_version` (int)：固定 1。
- `scenario_id` (string)：所属 scenario id。
- `asset_root` (string)：资产文件根目录（相对 campaign，默认 `assets/handouts`）。
- `assets` (object[])：资产条目数组。每条 asset：
  - `asset_id` (string)：稳定唯一 id，clue 的 `handout_asset_id` 用它引用。
  - `title` (string)：展示标题。
  - `summary` (string)：面向玩家的安全摘要（无法内联显示图片时用）。
  - `source` (object)：来源定位，含 `path` (string) 与 `page` (int)。
  - `player_visible` (bool)：是否可向玩家展示。`true` 时 Codex 渲染绝对 Markdown 图片路径；ZCode/纯文本界面改展示 `title` + `summary` + 来源页。
  - `scene_refs` (string[]，可选)：关联 scene_id 列表。
  - `clue_refs` (string[]，可选)：关联 clue_id 列表。
- `display` (object)：渲染提示（codex / zcode 两条策略说明）。

**读取契约（运行期）：** `coc_scenario.load_handout_assets` 在文件缺失/不可解析/`assets` 为空时一律返回 `{}`；缺 `asset_id` 的条目被跳过。`coc_director_apply` 的 `clue_reveal` 仅在 clue 记录带 `handout_asset_id` 时调用它，把 `handout_asset_id` / `handout_title` / `handout_summary` / `player_visible` 附到事件——未登记或未设字段时不影响现有行为。

**示例：**

```json
{
  "schema_version": 1,
  "scenario_id": "the-haunting",
  "asset_root": "assets/handouts",
  "assets": [
    {
      "asset_id": "handout-newspaper",
      "title": "1920 Newspaper Clipping",
      "summary": "A clipping mentioning the chapel lawsuit.",
      "source": {"path": "pdf/module.pdf", "page": 12},
      "player_visible": true,
      "scene_refs": ["scene-archive"],
      "clue_refs": ["clue-chapel-link"]
    }
  ],
  "display": {
    "codex": "render absolute Markdown image paths when player_visible is true",
    "zcode": "show title, summary, and source page when inline image display is unavailable"
  }
}
```

> **向后兼容**：所有现存 scenario 的 `handout-assets.json` 都是空骨架（`assets: []`），`load_handout_assets` 返回 `{}`，`clue_reveal` 不携带任何 handout 字段——行为与接入前完全一致。只有当某条 clue 显式设置 `handout_asset_id` 且对应 asset 已登记时，机制才生效。

---

### source_refs（scenes / npcs / fronts 通用可选字段）

除 clue 外，`story-graph.json` 的 scene、`npc-agendas.json` 的 npc、`threat-fronts.json` 的 front 也可各自挂一个可选的 `source_refs` 数组，格式同上（4 个规范字段 `source_id` + `path` + 整数 `page` + `grep_anchor`）。用于把场景/NPC/前沿溯源到来源 PDF。当 `source_ref` 缺任一规范字段（`source_id`/`path`/整数 `page`/`grep_anchor`）时编译器发 warning（不是 error）。

**scene 示例片段：**

```json
{
  "scene_id": "archive-research",
  "source_refs": [
    { "source_id": "pdf:the-haunting", "path": "pdf/Call Of Cthulhu Keeper Rulebook 40th Anniversary (Sandy Petersen).pdf", "page": 90, "grep_anchor": "public records" }
  ]
}
```

---

## 5. npc-agendas.json

NPC 议程。每个 NPC 的欲望、恐惧、秘密、声线、与调查员的关系——驱动导演的 `npc_moves`。

**字段：**

- `npcs` (object[])：NPC 数组。每个 NPC：
  - `npc_id` (string)：NPC 唯一标识（被 story-graph 引用）。
  - `agenda` (string)：NPC 想要什么（非空，编译期硬断言）。
  - `fear` (string)：NPC 害怕什么。
  - `secret` (string)：NPC 隐藏的信息。
  - `voice` (string)：声线/说话风格。
  - `relationship_to_investigators` (string)：与调查员的关系（如 `neutral_stranger`、`ally`、`adversary`）。
  - `foreign_dialogue` (object，可选)：结构化标记，声明该 NPC 会对调查员说**非调查员母语**的对白。仅当该 NPC 在场景中实际开口、且其语言对调查员构成理解门槛时才填（如一战奥军伤兵对意大利调查员说德语）。无此字段 = 该 NPC 对白视为调查员可正常理解，enrichment 不注入 `dialogue_comprehension` 指令。子字段：
    - `source_language` (string)：NPC 所说的源语言（结构化键，如 `German`、`Latin`、`Italian`；coc_language 的 `_LANGUAGE_ALIASES` 会归一化大小写/别名）。**这是 coc_language 用来匹配调查员 `Language (Other: <lang>)` / `Language (Own: <lang>)` 技能的键**，必须填。
    - `sample_line` (string，可选)：一句示例源语台词，供 narrator 在低理解度时展示原文/片段。非语料库，仅作叙述锚点。

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
    },
    {
      "npc_id": "npc-austrian-survivor",
      "agenda": "lash out at anything that moves",
      "fear": "the thing in the tunnels",
      "secret": "his mind broke watching his squad torn apart",
      "voice": "animal, a single moaned phrase in his own language",
      "relationship_to_investigators": "adversary",
      "foreign_dialogue": {
        "source_language": "German",
        "sample_line": "Der Schrecken... unten."
      }
    }
  ]
}
```

> **运行期消费**：`coc_narrative_enrichment.build_dialogue_comprehension_directive` 扫描 `scene.npc_ids` → npc-agendas 的 `foreign_dialogue` 标记，调用 `coc_language.language_skill_for_source` + `dialogue_comprehension_tier` 计算调查员的理解档（`none`/`gist`/`partial`/`fluent`），并在 `narrative_directives.dialogue_comprehension` 注入 `[{npc_id, source_language, skill_value, comprehension, translation_visible, rule}]`。当调查员技能不可得时（runner 未把 character sheet 放进 ctx），注入占位条目（`comprehension=null`、`requires_investigator_skill=true`），由 narrator/runner 按结构化技能值回填。`source_language` 与技能值均为结构化字段，绝不对自由文本做语言扫描。

---

## 6. threat-fronts.json

威胁前沿。把模组的活跃威胁建模为 fronts，每个 front 含 dangers（冲动+招式）和 clocks（段数+可见症状+满段后果）。导演的 `pressure_moves` 据此 tick。

**字段：**

- `fronts` (object[])：前沿数组。每个 front：
  - `front_id` (string)：前沿唯一标识。
  - `scope` (string)：作用域（`scenario` 全模组 / `scene` 单场景）。
  - `dangers` (object[])：危险源数组。每个 danger：
    - `id` (string)：危险源标识。
    - `impulse` (string)：危险源的冲动（它想做什么）。
    - `moves` (string[])：可用招式列表（自由文本，供 LLM Keeper 参考）。
    - `attack_profiles` (object[], optional)：结构化攻击定义，供 director 在战斗场景自动发起对抗检定。每个 profile 含 `name`、`attack_skill`（攻击方技能，如 "Fighting"）、`attack_target_percent`（攻击方成功率，如 60）、`resist_skill`（防御方技能，如 "Dodge"）、`damage`（伤害表达式）、可选 `lethality`（致命度数值或 null）、可选 `ignores_armor`（布尔）。未提供 attack_profiles 的 danger 仍由 LLM Keeper 手动驱动。
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

## 7. pacing-map.json

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

## 8. improvisation-boundaries.json

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
