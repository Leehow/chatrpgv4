# 时态记忆契约（temporal-memory-1）

> **Status:** 实现状态（不宣称未发生的完成）：契约层（`coc_temporal_memory_contract.py`）、时态记忆核心（`coc_temporal_memory.py` + 时间线 DAG）、SQLite 历史投影（`coc_history_projection*.py`）、检索分层（`coc_temporal_retrieval.py`）与范围/隐私切片均已在主分支实现并配确定性测试。Host 集成（正常游玩中 KP 对全部 canonical 消费面的可发现性、玩家自然语言入口）与插件验收（plugin-acceptance）尚未完成；按 Feature Integration 纪律整个特性仍为 `unintegrated`，不得宣称产品支持或验收完成。
> **ID:** `temporal-memory-contract`
> **Scope:** 共享记忆内核契约层（`plugins/coc-keeper/scripts/coc_temporal_memory_contract.py`）。契约冻结：实现 worker 只消费，不在此层外重定义。
> **Tracks:** `ACTIVE_IMPLEMENTATION_TRACK=pi-coc`；Codex-host 专属文件 off-limits。
> **Decision record:** plan `pi-coc-git-temporal-memory-20260826`

---

## 1. 权威与数据分层

- `state.*` / `rules.*` 保持权威。时态记忆是 advisory：回答"谁在何时知道、相信、误解或记得什么"，永不覆盖硬状态。
- Git 提交图是不可变历史来源；一切索引/SQLite/摘要是可删除、可重建投影。
- 记录**不含任何墙钟字段**（无 `recorded_at`/`timestamp` 等）：recorded 时间由代码从 `source_commit` 投影，重放字节等价。
- Commit SHA 与 receipt id 是机器完整性证据，由代码附加与校验；模型面对的只有语义 ID（遵守 Model-Facing Identifier Law）。

## 2. 语义 ID 文法

统一文法：`^[a-z0-9][a-z0-9._:-]*(?:-[a-z0-9][a-z0-9._:-]*)+$`（小写、kebab、≤128）。前缀即类型：

| 记录 | 格式 | 构造器 |
| --- | --- | --- |
| subject | `subject-<kind>-<slug>`；world/party 为 `subject-world-<campaign>`（精确）；npc 为 `subject-npc-<campaign>-<slug>`（前缀） | `subject_id_for()` |
| entity | `entity-<kind>-<slug>`（kind 内嵌首 token） | `entity_id_for()` |
| assertion | `mem-<campaign>-<slug>`（campaign 域）；跨战役为 `mem-xc-<slug>` | — |
| episode | `episode-<campaign>-<timeline>-turn-<n>`，由 (campaign, timeline, turn) 确定性导出，校验必须逐字相等 | `episode_id_for()` |
| timeline | `tl-<slug>`；根固定 `tl-main` | — |
| confluence | `confluence-<campaign>-<merged-timeline>` | — |
| conflict | `conflict-<confluence 余段>-<slug>`（嵌套于所属 confluence） | `conflict_id_for()` |
| transfer | `transfer-<campaign>-<from>-to-<to>` | `transfer_id_for()` |
| backlog | `backlog-<campaign>-t<turn>-<slug>` | `backlog_id_for()` |

后台提炼候选的约定（非强制文法）：`mem-<campaign>-t<turn>-c<ordinal>`。

## 3. 记录模式（closed field sets）

未知字段即校验错误（schema 冻结，clean-slate `temporal-memory-1`，无迁移、无双读）。各记录的完整字段集合见模块常量 `*_FIELDS`。要点：

### Subject / Entity
- `SUBJECT_KINDS`: world/investigator/npc/party/keeper/player。investigator/keeper/player 可跨战役（`campaign_id` 可空）；world/party/npc 战役域。
- Entity 默认战役域；`campaign_id=None` 的实体必须带显式 `same_entity_as` 绑定。
- 解析（`resolve_subject_ids` / `resolve_entity_ids` + `require_unique_id`）只做精确匹配；同名多 ID = 歧义错误，永不自动合并。跨战役同身份只经 `same_subject_as` / `same_entity_as` 边成立。
- **同 id 重写法则**：subject/entity 的同 id 写入只允许字节等价重放，或经 `is_sanctioned_identity_extension()` 认可的显式不可变扩展——`SUBJECT_IMMUTABLE_FIELDS` / `ENTITY_IMMUTABLE_FIELDS`（kind、campaign 域、display_name、subject_ref）逐字段不变，`aliases` / `same_subject_as` / `same_entity_as` 只能按原序追加新唯一项（前缀保持，删除/重排/改写均拒绝）。静默替换身份、战役域、别名或等价边是错误（fail closed）。

### Assertion（双时间断言）
- 必填 provenance：`timeline_id`（campaign 域时）+ `source_commit` + `source_turn`（≥0，0=建卡前）+ `source_receipts`（非空，机器附加）。
- 双时间：`occurred_turn ≤ valid_from_turn ≤ valid_until_turn`（闭区间，`None`=仍现行）。
- `ASSERTION_KINDS`: world_event / knowledge / belief / relationship / player_assertion / player_preference / keeper_correction / summary。
- `MEMORY_STATES`: accurate / uncertain / distorted / suppressed / forgotten / implanted / dreamlike / cross_timeline_echo / contradictory。
- 范围规则：world_event 与 summary 必须 campaign 域；campaign 域必须同时绑定 campaign+timeline；跨战役记录两者皆空。`player_assertion` 主体必须是 player 且 `privacy=player_safe`；`suppressed` ⇒ `keeper_only`；`contradictory` ⇒ `contradicts` 非空。
- 矛盾保存：`valid_until_turn` ⇔ `superseded_by` 成对；自引用、悬空引用（bundle 校验）都是错误；旧记录永不删除（`plan_supersession()` 是唯一 sanctioned 关闭方式，原地改写、id 不变）。
- **同 id 重放法则**：同 assertion id 的再次写入只允许两种结果——字节等价重放（digest 相等，幂等返回），或恰好等于 `is_sanctioned_supersession()` 认可的 `plan_supersession` 精确增量（仅 `SUPERSESSION_DELTA_FIELDS` = `valid_until_turn` + 新增单一 successor；其余字段含 subject/knowers/privacy/state/statement/entities/provenance/既有边全部不可变）。已关闭记录不可再次改写；其他一切同 id 变体 fail closed。
- summary（可审计压缩）必须带 `covers_commits`；该字段为 summary 专属。
- 隐私投影：`is_player_visible` / `project_player_view` / `project_subject_view`（owner-or-knower + 可选时间点，确定性 id 排序）。语义相关性判断归 KP。

### Episode
每个 finalized turn commit 确定性生成一条：id 逐字等于 `episode_id_for()`，`turn_number ≥ 1`，绑定 `commit` 与 `finalization_receipt`。**重放等价**：同 episode id 的重放要求 episode 记录与 evidence 边车（receipts、player/keeper 文本哈希、candidates）双双 canonical 等价；任何漂移（不同 commit、文本、收据、参与者、实体、候选）一律 fail closed，绝不静默接受。

### Timeline / Confluence / Transfer / Backlog
- Timeline：root（唯一 `tl-main`、无 parent）/ fork（恰 1 parent + fork_point）/ confluence（恰 2 distinct parents + fork_point）。`validate_timeline_set` 校验唯一 id、parent 可达、无环（diamond 合法）、active 指针在集合内。
- Confluence：第三时间线 + 完整冲突清单。`HARD_STATE_CONFLICT_CLASSES`（数值/资源，diff 由确定性 resolver 产出，disposition 必须带 `resolver_receipt`）vs `KP_SEMANTIC_CONFLICT_CLASSES`（KP 裁决）。每个冲突必须有 disposition（mode ∈ `DISPOSITION_MODES` + receipt）；`NON_DUPLICABLE_CONFLICT_CLASSES`（roll_receipt/one_time_effect/consumed_resource/death）禁止 `combine`/`duplicate`——骰、一次性效果、消耗、死亡绝不跨线重复。left/right 时间线顺序确定性（= parents 顺序）。
- Transfer：from≠to；每条 entry `source≠target`（目标是新断言）、`credibility ∈ [0,1]`、可选 `distortion`/`play_cost`；`validate_transfer_links` 校验 source 在源线、target 在目标线且带 `transfer_ref` 回指。
- Backlog：显式可恢复（`BACKLOG_STATUSES`: pending/recovered/abandoned；`BACKLOG_REASONS`）。提炼失败绝不阻断 `turn.finalize`（运行时不变量）。

## 4. 确定性
- `canonical_json()`：sorted keys + 紧凑分隔符，与 dict 插入顺序无关。
- `record_digest()`：canonical json 的 SHA-256；机器内部完整性证据，非模型面 ID。
- 所有枚举为冻结 tuple；成员测试是唯一接受判定。
- **生成 ID 防碰撞**：运行时派生 id（`mem-<campaign>-adj-<decision>`、`mem-<campaign>-promoted-<candidate>-<decision>`、hook successor）由 `_prefixed_id()` 按命名空间前缀 + 剩余预算构造，绝不盲目切片到 128；生成后必须做绑定到来源 decision 的显式碰撞检查——同源重放幂等复用，异源碰撞 fail closed 并要求更独特的语义 decision_id。裁决幂等以 canonical request fingerprint（candidate/action/全部修改参数）绑定 `decision_id`：同 id 异请求拒绝，缺失 fingerprint 的旧行不可验证即拒绝。
- **提交解析分层**：模型面入口 `record_turn_episode(root, campaign_id, timeline_id, turn_number, ...)` 只收语义 campaign/timeline/turn；代码经 `resolve_turn_commit()` → git 历史解析器校验该 commit 确为该时间线该回合的 finalized turn 后附上 SHA。低层 `record_episode(commit_sha, ...)` 为机器内部接口（供已持有 finalized commit 的提交协调器使用），并在文档中标明；模型永不转写 commit SHA。

## 5. 错误分类
`TemporalMemoryContractError` 基类 + 具名子类（`UnknownFieldError` / `MissingFieldError` / `ClosedEnumError` / `SemanticIdError` / `ProvenanceError` / `PrivacyError` / `SupersessionError` / `ScopeError` / `IdentityError` / `TimelineError` / `ConfluenceError` / `TransferError`），均携带 `record_kind`/`field`/`value`。运行时一律 fail-closed 捕获基类。

## 6. Out of Scope
存储布局（memory 记录在 git 树中的落盘路径）、投影重建、检索服务、语义提炼、合流 runtime、战报展示——全部由后续 worker 在本契约之上实现。旧战役数据保持只读，不迁移。
