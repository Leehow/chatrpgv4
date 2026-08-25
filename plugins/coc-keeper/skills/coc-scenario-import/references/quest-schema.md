# Quest Schema v1（行动型任务实体）

任务（quest）= **行动型**目标实体：委托、押送、救援、取回、阻止、逃脱、谈判、修复、到访。
认知型目标（查明真相、拼出结论）**不进 quest**——它们已经由 `clue-graph.json` 的
conclusion 覆盖；两者是互补关系，不是竞争关系。

quest 有两层载体，同一冻结契约（`schema_version: 1`）：

1. **module-assets 实体包**：`entities/quest-<slug>.json`，经
   `coc_module_assets.py put_entity` 写入（渐进解析路径 / 源编译路径）。
   存储键是**不带前缀的 slug**（如 `escort-macario`），落盘文件为
   `entities/quest-escort-macario.json`，包内 `quest_id` 由 put_entity 规范化为
   `quest-<slug>`（Model-Facing Identifier Law：语义 id，禁随机 hex/uuid）。
2. **Scenario IR 第八文件**：`campaigns/<id>/scenario/quests.json`（**可选**）。
   缺省合法 = 无任务模组；存在则由 `coc_scenario_compile.py --validate`
   按本文硬断言校验（含跨文件引用完整性）。

运行期状态（`save/quest-state.json` 状态机）见
`plugins/coc-keeper/references/state-schema.md` 的 Quest State 一节。

---

## 1. quest_kinds：九类行动型任务（冻结枚举）

语料实证的行动型任务分类，可多选（混合任务如 `["escort-deliver", "survive-escape"]`
表示"押送途中还要活着送到"）：

| kind | 含义 |
| --- | --- |
| `commission` | 委托（受雇办事，交付物是"完成事情"本身） |
| `escort-deliver` | 押送 / 交付（把人或物安全送到目的地） |
| `rescue-protect` | 救援 / 保护（把人或地救出/守住） |
| `retrieve-collect` | 取回 / 收集（拿回物件、收集样本或信息载体） |
| `prevent-disrupt` | 阻止 / 破坏（挫败仪式、切断计划） |
| `survive-escape` | 生存 / 逃脱（活下来、撤出去） |
| `negotiate` | 社交谈判（谈成交易、说服、斡旋） |
| `restore` | 恢复 / 修复（修复圣所、解除诅咒、恢复秩序） |
| `visit-explore` | 到访 / 探查（抵达并勘察某地） |

- **`timed` 不是 kind**：限时是 `deadline` 属性（见下），任何 kind 都可挂 deadline。
- 认知型目标（"查明 X 的真相"）→ 写 `clue-graph.conclusion`，不建 quest。
- 运行时与校验器只消费上述英文 token；**禁止**新增自由文本类型词。

## 2. 字段说明（冻结；不得增删）

### 实体包 / IR 行共有的字段

- `schema_version` (int)：固定 `1`（put_entity 强制写入；IR 文件顶层同）。
- `quest_id` (string)：语义 id，必须匹配 `^quest-[a-z0-9-]+$`。实体包由存储键
  slug 派生；IR 行内显式携带。同文件内唯一（IR 硬断言）。
- `title` (string，必填)：任务标题（keeper 侧工作标题，非玩家可见渲染）。
- `localized_title` (object，可选)：`{<play_language>: 标题}`，玩家可见渲染优先用它。
- `player_safe_summary` (string，可选)：**offered 之后**可向玩家展示的安全摘要。
  玩家可见字符串遵守 `play_language`（默认 `zh-Hans`）。
- `localized_text` (object，可选)：`{<play_language>: 文本}`，完整本地化文本。
- `quest_kinds` (string[]，必填)：非空、不重复，取值限九类枚举。
- `importance` (string，必填)：`core`（主线）| `supporting`（支线）| `optional`（可选）。
- `giver` (null | object，可选)：任务给出者。
  - `{"kind": "npc", "ref_id": "npc-..."}` —— 引用 npc-agendas 的 NPC（IR 校验
    要求 ref 可解析；实体包层校验结构形状）。
  - `{"kind": "organization", "label": "..."}` —— 无单一 NPC 的组织/机构。
- `brief` (string，必填)：keeper 侧 authored 实质内容（任务详情、报酬、约束、
  幕后真相提示——keeper-only，绝不直接投影给玩家）。
- `target_refs` (object[]，可选，可空)：结构化目标引用，每项恰好
  `{"kind": "npc|location|item|clue|scene", "ref_id": "..."}`。IR 校验要求
  npc/clue/scene 引用在七文件内可解析；location/item 目标存在于 module-assets
  实体仓，由 put_entity 层负责其归属。
- `destination_scene_id` (string，可选)：目的地场景（押送/到访类常用）；IR 校验
  要求在 story-graph.json 中存在。
- `deadline` (null | object，可选)：限时属性，两种形态二选一：
  - `{"kind": "clock", "clock_id": "..."}` —— 绑定 threat-fronts 的压力钟
    （IR 校验要求 clock_id 可解析）。
  - `{"kind": "game_time", "at": "...", "display": "..."}` —— 游戏内时间点
    （`at` 为结构化时间，`display` 为玩家可见表述，遵守 play_language）。
- `completion` (object，必填)：完成判定组（见 §4）。
- `failure` (object | null，可选)：失败判定组，形状同 completion。缺省 = 无机器
  失败路径（KP 仍可语义判定失败或放弃）。
- `mainline_links` (string[]，可选)：conclusion/clue id 列表——支线成果可回收进
  主线的挂点（IR 校验要求每个 id 是 clue-graph 中的 conclusion 或 clue）。
- `secret` (bool，必填)：`true` = offered 前 keeper-only。**物理隔离纪律**（同
  `improvisation-boundaries.keeper_secrets` 的精神）：`secret: true` 的任务**不得**
  携带 `player_safe_summary`——机密任务在 IR/实体包层不留任何玩家安全副本；
  玩家可见文本只在 offered 之后的运行时投影中出现。
- `provenance` (string，必填)：`"source"`（来源模组编译）| `"campaign-improvised"`
  （KP/战役即兴正典）。
- `evidence_gap` (bool，可选)：证据缺口标记。

### 实体包侧附加字段（与其他实体一致）

- `parse_state` / `updated_at`：与其他 entity pack 相同的渐进解析记账
  （put_entity 强制）。stub 档（`named_only` / `toc_only`）是页范围占位，不要求
  任务语义字段；`partial` / `body_parsed` / `deep` 必须满足完整冻结契约。
- `source_span` `{pdf_index_start, pdf_index_end}` / `page_text_sha256[]` /
  `source_refs[]` / `source_evidence`：**bundle-backed 根上 `provenance: "source"`
  的深包必须有**（与其他 pack 一致，由 put_entity 溯源 canonical 化强制）；
  `campaign-improvised` 任务豁免源证据。
- `origin`：canonical 化机器记账字段（非语义字段）。

## 3. 状态机（运行期，`save/quest-state.json`）

```
authored ──offered──▶ active ──┬─ completed
   │（keeper-known stub）       ├─ failed
   │                            └─ abandoned
   └──────────────────── abandoned（从未被提出即放弃）
```

- `authored`：keeper 已知、尚未向玩家提出。**offered 之前，该任务不得出现在任何
  player-safe 投影中**（`secret` 字段标记的就是这一档及以后隐藏语义）。
- `offered` → `active`：玩家接受/开始执行（KP 语义判断 + `state.*` 写入）。
- 终态 `completed` / `failed` / `abandoned`：一旦落定不可回退（clean-slate，无迁移）。
- 所有状态写入走 `state.*` 纪律：事务、幂等、`decision_id`；每次转移绑定一个
  decision id，重放绝不二次应用。

## 4. 完成判定分层（机器 kind / narrative KP 语义关闭）

`completion` / `failure` 是判定组：`{"all": [cond...], "any": [cond...], "narrative": "..."}`
——`all` 全部满足、`any` 任一满足、`narrative` 存在即表示**需 KP 语义关闭**。
三者至少出现一个；空组非法。

cond **复用 `coc_exit_conditions` 的 kind 词汇单一入口**（quest 绝不新增判定词，
绝不扫自由文本）：

- `{"kind": "clue_discovered", "clue_id": "..."}` —— 机器可判。
- `{"kind": "flag_set", "flag_id": "..."}` —— 机器可判（`save/flags.json` 结构化
  flags 键为真）。
- `{"kind": "clock_reaches", "threshold": N, "clock_id": "..."?}` —— 机器可判
  （缺省任一时钟）。
- `{"kind": "always"}` —— 无条件真（开放型任务）。
- `{"kind": "narrative", "description": "..."}` —— 机器永远判 False。

判定执行分层：

1. **机器可判 cond**（clue_discovered / flag_set / clock_reaches）：在事件已结算的
   既有路径上重算（先例：`coc_belief_state.apply_belief_turn` 的
   `core_objective_progress`）。达成即自动 settle + receipt（幂等，绑 decision_id）。
2. **`narrative` 条件**：机器永远判 False，**KP 显式关闭**并落 close receipt
   （先例：exit_conditions 的 `narrative` kind + CUT）。判定组里的 `narrative`
   字符串是"什么算完成"的 keeper 侧语义描述，不是可扫描的关键词。

## 5. 硬断言（put_entity / `--validate`）

由 `coc_module_assets.validate_quest_pack_contract`（唯一契约权威，两层共用）与
`coc_scenario_compile --validate` 强制：

- `quest_id` 匹配 `^quest-[a-z0-9-]+$`；IR 文件内唯一。
- `quest_kinds` 非空、不重复、全部在九类枚举内。
- `importance` ∈ `{core, supporting, optional}`；`provenance` ∈ `{source, campaign-improvised}`。
- `secret` 必须显式布尔；`secret: true` 与非空 `player_safe_summary` 互斥（物理隔离）。
- `completion` / `failure` 判定组形状合法；每个 cond 的 `kind` 走
  `coc_exit_conditions.EXIT_CONDITION_KINDS` 同一词汇入口；半截 cond（如
  `clue_discovered` 缺 `clue_id`、`clock_reaches` 缺整数 `threshold`）与自由文本
  kind（如 `"delivered_safely"`）都是硬错误；quest v1 不接受遗留字符串 cond。
- `giver` / `target_refs` / `deadline` 结构化形状合法（见 §2）。
- IR 侧跨文件引用：giver npc、npc/clue/scene target、`destination_scene_id`、
  deadline clock、`mainline_links` 必须在七文件内可解析。
- bundle-backed 根上 `provenance: "source"` 深包必须携带并被 canonical 化
  `source_span` / `page_text_sha256` / `source_refs` 溯源（与其他实体一致）。

## 6. 红线：加压不设卡（advisory，永不阻塞）

- **quest 进度永远是 advisory**：机器判定的达成/超时只产生提示与 receipt，
  **永不阻塞** `move_scene`、玩家行动、场景转场或结局。任务失败是叙事压力，
  不是引擎闸门（宪法：Director/NPC/pacing 方法返回建议，KP 采纳与否自由）。
- **无语义关键词扫描**：运行时与校验器只消费结构化字段、ID 与枚举；绝不以
  关键词命中玩家散文或任务 prose 来推断进度、意图或完成。
- **玩家可见字符串遵守 `play_language`**（默认 `zh-Hans`）：`localized_title` /
  `localized_text` / `player_safe_summary` / `deadline.display` 是玩家面；
  `brief`、cond 描述、keeper 备注是 keeper 面，永不直接投影。
- **Thin code**：仓库代码只管 schema/事务/校验/投影/记账；任务语义（何为完成、
  NPC 为何给任务、时限的叙事意义）归 KP。
- **clean-slate**：无迁移、无双读、无旧格式回退。

## 7. 完整示例（The Haunting：Knott 委托）

```json
{
  "schema_version": 1,
  "quests": [
    {
      "quest_id": "quest-investigate-corbitt-house",
      "title": "Corbitt 宅调查委托",
      "localized_title": {"zh-Hans": "科比特宅邸调查委托"},
      "player_safe_summary": "诺特先生出资委托调查员查清租客失踪与宅邸异响的底细，并出具报告。",
      "localized_text": {
        "zh-Hans": {
          "player_safe_summary": "诺特先生出资委托调查员查清租客失踪与宅邸异响的底细，并出具报告。"
        }
      },
      "quest_kinds": ["commission"],
      "importance": "core",
      "giver": {"kind": "npc", "ref_id": "npc-mr-knott"},
      "brief": "keeper-only：房产经纪人诺特隐瞒了历年租客的悲惨遭遇与教堂诉讼史；他只想要一份能让房子脱手的清白报告。报酬已预付一部分，余额凭报告支付。",
      "target_refs": [
        {"kind": "npc", "ref_id": "npc-mr-knott"},
        {"kind": "location", "ref_id": "location-corbitt-house"},
        {"kind": "clue", "ref_id": "clue-chapel-lawsuit"}
      ],
      "destination_scene_id": "corbitt-house",
      "deadline": {
        "kind": "game_time",
        "at": "1920-10-12T18:00",
        "display": "一周之内（10 月 12 日傍晚前）给出报告"
      },
      "completion": {
        "all": [
          {"kind": "clue_discovered", "clue_id": "clue-corbitt-remains"}
        ],
        "narrative": "调查员向诺特提交了令其接受（或迫使其直面真相）的报告；KP 语义确认委托了结。"
      },
      "failure": {
        "any": [
          {"kind": "clock_reaches", "clock_id": "corbitt-malice", "threshold": 6}
        ],
        "narrative": "调查员全员撤离且无人再来交差，或报告彻底失去可信度。"
      },
      "mainline_links": ["corbitt-linked-to-chapel"],
      "secret": false,
      "provenance": "source",
      "source_span": {"pdf_index_start": 100, "pdf_index_end": 104},
      "page_text_sha256": ["…页文本哈希，put_entity canonical 化…"],
      "source_refs": [{"pdf_index": 100}, {"pdf_index": 104}],
      "evidence_gap": false,
      "parse_state": "deep"
    }
  ]
}
```

对照：隐藏的邪教反制任务（`secret: true`）**不带** `player_safe_summary`——它的
玩家可见文本要等到 KP 把它 offered 到桌面之后才存在于投影层：

```json
{
  "quest_id": "quest-silence-the-witnesses",
  "title": "灭口计划",
  "quest_kinds": ["prevent-disrupt"],
  "importance": "supporting",
  "giver": {"kind": "organization", "label": "Chapel of Contemplation 信众残余"},
  "brief": "keeper-only：教团残余要在风声走漏前让多彻斯特的知情者永久沉默。",
  "deadline": {"kind": "clock", "clock_id": "cult-alert"},
  "completion": {"narrative": "教团行动被调查员挫败，或KP判定威胁解除。"},
  "secret": true,
  "provenance": "campaign-improvised"
}
```
