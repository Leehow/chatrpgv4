# Git 时态记忆与世界线系统规格

> **Status:** Approved — implementation in progress（已获用户批准，实现进行中）。
> **Plan ID:** `pi-coc-git-temporal-memory-20260826`
> **Track:** `ACTIVE_IMPLEMENTATION_TRACK=pi-coc`。共享 memory/history 内核（shared kernel）已获用户显式授权改动；Codex-host 专属实现、提示词、launcher、测试与文档 off-limits。
> **Evidence law:** 任何实现不得删除现有 campaign、module-assets、logs、battle reports 或 playtest evidence；旧数据一律只读。
> **Decision record:** 本文档是已批准决策的完整产品规格，不是新的待批提案；不新增审批门。

---

## Problem Statement

当前系统的"记忆"由四套互相脱节的机制拼成，它们各自记录历史，却没有一套能回答"谁在何时知道、相信、误解或记得什么"：

1. **Sidecar Git 历史**（`.coc/repos/campaigns/<campaign-id>.git`）：`turn.finalize` 后由 Commit Coordinator 同步提交，带完整 trailer 绑定。它保存了 canonical state、logs、receipts 的完整字节级演化，但只是一份审计存档——finalize 提交之后就再没有任何东西消费它。Git 存了历史，却不驱动记忆的形成与召回。
2. **可变 Markdown 记忆卡**（`memory/` 目录）：由各会话随手读写的文本卡片，没有主体、没有时间、没有 provenance、没有隐私边界。后写覆盖先写，旧认知无声消失，无法区分"世界变了"与"记录被改了"。
3. **会话摘要 / continuation cache**：为恢复会话而做的压缩快照，服务的是"接着上句聊"，不是"回溯任意历史点"或"跨时间线对照"。
4. **overlap-only 检索**：召回只能命中"当前场景重叠的实体"，既不能按时间点收窄，也不能回答"三个月前（第 14 回合时）他对此人了解多少"。

由此产生的具体失败：

- 任意历史点的全参数查询（"第 12 回合时他的 SAN 和持有物"）无处可问；数据明明在 Git 历史里，却没有读取面。
- 两回合之间的结构化 diff 不存在，KP 只能靠翻聊天记录与肉眼比对。
- 玩家说"要是刚才没进地下室就好了"——系统没有分叉概念，KP 只能口头重述或干脆开新战役，旧历史作废。
- 同名不等于同一人、玩家假说不等于世界事实，但记忆卡没有断言主体与裁决状态，任何写入都直接变成"事实"。
- NPC 与调查员对同一事件的主观视角、错误认知、被压抑的记忆无处安放；矛盾只能靠覆盖或删除来"解决"。
- 跨战役的同一调查员（同一人生）没有身份绑定，每开一个模组就"失忆"一次。

一句话：**Git 已经存下了一切，但没有任何一层把它变成可查询的时态记忆。** 本规格把 Git 提交图从审计存档升级为长期记忆的事实基底。

## Solution

核心原则：**Git 是不可变的唯一历史来源；SQLite / 图 / 摘要全部是可删除、可重建的投影；语义判断永远归 KP。**

- **Git timeline DAG 作为不可变来源。** 每条时间线是 sidecar bare repo 中的一个分支（根时间线 `tl-main`）；fork 与 confluence 产生新分支，旧提交永不改写。canonical state、logs、receipts、memory 记录全部进树，commit trailer 逐 turn 绑定 finalization。
- **SQLite 权威历史投影。** 把提交图投影为可 SQL 查询的 authority history：任意 commit 的全参数快照（`history.query`）、任意两 commit 的结构化 diff（`history.diff`）。SQLite 损坏即删即重建，永远不做迁移。
- **时态记忆 episode/assertion 图。** 每个 finalized turn commit 确定性生成一条 episode；语义提炼在 episode 之上产出 bitemporal assertion（谁、在哪个时间线、从哪个 commit/turn、凭哪些 receipts，知道/相信/误解什么）。矛盾用 supersession 与 `contradicts`/`confirms` 边保存，旧记录永不删除。
- **确定性收窄 + KP 语义判断。** `memory.recall` 先按主体/场景/实体/时间/隐私确定性过滤出候选集，再由 KP 语义挑选、改写、叙事。检索层绝不用关键词规则冒充语义。
- **有界的恢复投影。** 会话恢复只重建"当前时间线的最近邻投影 + per-subject 可见记忆"，不把全历史塞进上下文；章节/档案摘要（`covers_commits` 可审计压缩）供远距召回。
- **世界线操作玩家可及。** 玩家用自然语言请求回溯/分叉，KP 语义确认后经 `timeline.fork_request` / `timeline.fork_confirm` 落盘；合流产生恰有两个 parent 的第三时间线，冲突逐项裁决并留 receipt。
- **权威与记忆分离。** `state.*` / `rules.*` 仍是唯一权威；时态记忆只回答认知问题，永不覆盖硬状态。合流绝不让骰点、死亡、物品、一次性效果重复结算。

## Goals and Success Criteria

### 目标

1. 任意历史点全参数查询：任意 commit/turn 上，任意 investigator/NPC/party/world 的全部硬参数（HP/SAN/MP/Luck、技能、物品、现金、伤势、死亡状态、关系、骰点回执、一次性效果）可从投影一次查得。
2. 任意两历史点结构化 diff：字段级、按主体分组、绑定 commit/turn/receipt 的差异清单。
3. 玩家自然语言回溯/分叉：无需懂得任何术语即可提出；KP 语义确认后创建新时间线；旧时间线与旧提交一字不动。
4. 跨时间线记忆：带来源、可信度、失真、隐私、起因与玩法代价的记忆转移；玩家 meta-knowledge 与角色记忆严格分离。
5. 双亲世界线合流：第三时间线恰有两个 parent；完整冲突清单逐项裁决；硬机制与 KP 语义冲突分类处理；骰/死/一次性效果绝不重复。
6. 历史不可破坏：默认禁止 reset / force push / 历史重写；旧战役与 playtest 证据只读。
7. 全部 provenance/audit/privacy 要求：每条记忆可回溯到 timeline/commit/turn/receipts；隐私投影（player_safe / keeper_only / system_only）由确定性代码执行；战报能完整展示 fork、跨线记忆与合流如何改变玩法，且全部来自 canonical 证据。

### 成功判据

- 确定性测试全绿：契约 schema、DAG 合法性、投影重建字节等价、隐私投影、幂等、fork/confluence/transfer 全路径。
- 插件 metadata 测试通过（`tests/test_plugin_metadata.py` 必跑）。
- 真实验收：fresh campaign + Pi-Coc RPC + Grok KP + 单一玩家自然语言游玩，覆盖普通回合、一次 fork、两条线的不同发展、至少一次跨线记忆、一次玩家可见的 confluence；结束后仅由 `coc-export-battle-report` 导出战报。脚本化/批处理伪造的玩法一律 `invalid-for-acceptance`。

## Terminology

| 术语 | 定义 |
| --- | --- |
| **timeline（时间线）** | sidecar Git repo 中的一条分支演化线。根时间线 `tl-main`；fork 线恰有一个 parent + fork_point；confluence 线恰有两个 distinct parents + fork_point。timeline id 形如 `tl-<slug>`。 |
| **episode（情节单元）** | 一个 finalized turn commit 确定性对应的记忆节点，id 逐字等于 `episode-<campaign>-<timeline>-turn-<n>`。episode 是共享的事件锚点，多个主体可各自持有对它的视角。 |
| **assertion（断言）** | 记忆的最小单元："某主体在某时间线于某 valid 区间内知道/相信/误解 X"。携带完整 provenance（timeline_id / source_commit / source_turn / source_receipts）与 memory state。 |
| **subject（主体）** | 拥有认知的实体，kind ∈ world / investigator / npc / party / keeper / player。id 形如 `subject-<kind>-<slug>`。 |
| **knower（知晓者）** | 一条 assertion 中实际持有该认知的 subject 集合。世界事实的 knower 语义上是 world；秘密的 knower 可以只有 keeper。 |
| **valid time（有效时间）** | 断言在虚构世界内为真的区间：`occurred_turn ≤ valid_from_turn ≤ valid_until_turn`（闭区间，`None` = 仍现行）。以 turn 计，不以墙钟计。 |
| **transaction time（事务时间）** | 断言被系统记录的时间。**不含墙钟字段**：由代码从 `source_commit` 在提交图中的位置投影得出，重放字节等价。 |
| **projection（投影）** | 从 Git 历史派生的一切可重建数据：SQLite authority history、记忆图索引、摘要、player/keeper/system 可见面。损坏即重建，永不迁移。 |
| **fork（分叉）** | 从既有时间线的某 fork_point 创建新时间线。原线与原提交不可变；两线此后独立演化。 |
| **confluence（合流）** | 两条 parent 时间线合并产生第三条时间线（恰两个 parent）。冲突逐项裁决并留 disposition receipt；parents 保持不可变。 |
| **transfer（跨线记忆转移）** | 把源时间线的断言派生为目标时间线的主观断言的权威事件，带 credibility / distortion / play_cost。玩家 meta-knowledge 不是 transfer。 |
| **player_assertion（玩家断言）** | kind 为 `player_assertion` 的候选记录：玩家在桌上说的话不自动成为世界事实或角色记忆，必须经 KP 裁决。 |
| **narrative debt（叙事债务）** | 受控即兴与既有叙述产生矛盾时，以结构化记录（如 `contradictory` 断言、continuity contradiction）保留双方断言与 provenance，供后续因果消化，而非静默改写。 |

## User Stories

### KP（Keeper）

1. 作为 KP，我想查询"第 12 回合时托马斯的 SAN、MP、Luck 与持有物"，`history.query` 返回该历史点的全参数快照，我不用翻聊天记录。
2. 作为 KP，我想知道第 8 回合到第 15 回合之间世界发生了哪些变化，`history.diff` 返回字段级结构化 diff，按主体分组并绑定 commit/turn。
3. 作为 KP，玩家自然语言说"要是刚才没进地下室就好了"，我语义确认其意图后调用 `timeline.fork_request` → `timeline.fork_confirm`，从指定回合创建新时间线，旧线完整保留。
4. 作为 KP，叙事前我想知道"艾米丽此刻应该记得什么"，`memory.recall` 按主体/场景/实体/时间/隐私收窄候选集，我再语义挑选并织入叙事。
5. 作为 KP，NPC 老管家与调查员经历了同一 event，我读取共享 episode 的 per-subject perspectives，用管家的主观视角而非上帝视角对话。
6. 作为 KP，玩家声称"馆长早就认识我"，检索发现只有 `player_assertion` 候选、无已裁决记忆，我拦截该断言并交 `memory.adjudicate` 裁决，不当场泄露模组真相。
7. 作为 KP，我发现某 NPC 的记忆是被植入的，我用 `memory.adjudicate` 将其置为 `implanted`：旧认知不删除，矛盾以 `contradicts` 边保留。
8. 作为 KP，我想把两条世界线合流，`timeline.confluence_query` 给出完整冲突清单，我逐项裁决（choose_left / combine / paradox / …），`timeline.confluence_confirm` 落盘第三条双亲时间线与全部 disposition receipts。
9. 作为 KP，合流后我想让某调查员"闪现"另一条线的画面（`cross_timeline_echo`），transfer 记录自带来源、可信度与失真，我在叙事中如实呈现其不可靠性。
10. 作为 KP，章节收束时我生成章节摘要（`summary` 断言，带 `covers_commits`），此后远距召回命中摘要而非逐回合原文，控制上下文体积。
11. 作为 KP，我想回看自己早先的一次即兴设定与后文矛盾的地方，系统保留双方断言与 provenance（narrative debt），我在后续回合消化而非假装没发生。
12. 作为 KP，一名调查员死亡后其记忆仍是历史的一部分，我可在隐私允许内让灵媒或后继者触及其认知残留。

### 玩家

13. 作为玩家，我用中文自然语言请求"回到我们进宅子之前"，不需要知道 Git 或时间线术语；KP 语义确认后系统完成分叉。
14. 作为玩家，我后悔一个选择，请求分叉后体验两条世界线的不同发展，并随时可以回去看另一条线的结局。
15. 作为玩家，我在 B 线遭遇只在 A 线发生过的事件的回响，感受到跨线记忆带来的恐怖与既视感，而叙事明确区分这是我角色的记忆还是我的 meta 感受。
16. 作为玩家，我参与合流后的世界，两条线的事件以叙事方式（而非 JSON 面板）在新线中被裁决呈现，我能看出哪些取自左线、哪些取自右线。
17. 作为玩家，我可以自由猜测、推测、下饵，但我的猜测永远不会直接变成世界事实或角色记忆。
18. 作为玩家，我希望系统记住我的游玩偏好（`player_preference`），下一个战役延续同一种节奏。
19. 作为玩家，我请求回溯后会收到 KP 的语义确认（"你是想从第 8 回合分叉吗？"），误解在落盘前被拦下。
20. 作为玩家，我携带的调查员在多个模组之间延续同一人生：他的创伤、关系与成长跨战役连贯。

### 调查员（investigator）

21. 作为调查员，我的全参数（HP/SAN/MP/Luck、技能、物品、现金、伤势、死亡状态）在任意历史点可被合法查询，追溯到我人生的每一步。
22. 作为调查员，我可以持有主观、错误、被压抑或被遗忘的记忆（`distorted` / `suppressed` / `forgotten` / `dreamlike`），它们与客观世界事实并存且不互相覆盖。
23. 作为调查员，我在合流线中的骰点、死亡与一次性效果不会被重复结算——硬机制边界保护我不被数值漂移。
24. 作为调查员，我通过 `same_subject_as` 边跨战役绑定同一身份，跨模组的生命史可整体回溯。
25. 作为调查员，我对某 NPC 的首印象（首次接触 D100 回执）永久不可变，此后关系变化以 supersession 记录演化。

### NPC

26. 作为 NPC，我对参与的每个共享 episode 拥有自己的视角断言，与调查员的视角并列且可互相矛盾。
27. 作为 NPC，我的 hostility / agenda / 关系变化可追溯到具体 commit 与 receipt，KP 不必凭印象扮演我。
28. 作为 NPC，我可以被 KP 赋予跨线记忆（作为 transfer 目标），它带着可信度与失真影响我的行为。

### 系统

29. 作为系统，`turn.finalize` 在 Git 提交失败时整体 fail-closed（与现行 copytree 失败语义严格对等），绝不交付无历史的结算。
30. 作为系统，后台语义提炼失败进入显式 backlog（`pending`），绝不阻断 finalize；backlog 项可恢复（`recovered`）或显式放弃（`abandoned`）。
31. 作为系统，SQLite/图/摘要投影损坏时，我从 Git 历史完整重建，无迁移、无双读者。
32. 作为系统，重复 finalize、重复提炼、重复重建都幂等：同一 decision/commit 不产生第二条记录。
33. 作为系统，隐私投影（`project_player_view` / `project_subject_view`）由确定性代码执行，`suppressed` ⇒ keeper-only，`player_assertion` 恒为 player-safe。

### 维护者

34. 作为维护者，我运行确定性验证套件：契约 schema、DAG 合法性（唯一 `tl-main`、parent 可达、无环、diamond 合法）、投影重建等价、隐私、幂等、confluence 冲突清单完整性。
35. 作为维护者，我用只读 verify 脚本审计战役仓库（fsck、trailer 与 finalizations 1:1、schema 代际一致），零记录时显式报零而非空通过。
36. 作为维护者，我确信旧战役与 playtest 证据只读、仓库内不存在 reset / force push / 历史重写的代码路径。

### 战报导出器（exporter）

37. 作为导出器，战报能展示 fork、跨线记忆与合流如何改变玩法，全部事实来自 canonical receipts/commits，绝不手工补或凭记忆重构骰点。
38. 作为导出器，我对合流冲突清单逐项引用 disposition receipt 与裁决模式，读者可复核每个"为什么取左线"。
39. 作为导出器，我区分 player-safe 与 keeper-only 内容，战报的公开面不泄露任何 keeper-only 记忆或模组真相。

## Architecture

```text
 玩家（自然语言：回合、回溯、分叉请求）
        │
        ▼
 ┌─ KP 语义决策层（Grok KP）──────────────────────────────────────┐
 │  意图理解 · fork/rewind 语义确认 · 记忆候选语义挑选 · 裁决 ·    │
 │  矛盾消化 · 隐私拦截 · 叙事                                       │
 └───────┬───────────────────────────────────────────────────────┘
         │ canonical skills / toolbox
         ▼
 ┌─ Toolbox 操作层 ────────────────────────────────────────────────┐
 │  state.* / rules.*（权威写，不变）                               │
 │  history.query / history.diff                                   │
 │  timeline.fork_request / fork_confirm / confluence_query /      │
 │  timeline.confluence_confirm                                    │
 │  memory.recall / memory.adjudicate                              │
 └───┬──────────────┬─────────────────────────┬───────────────────┘
     ▼              ▼                         ▼
 ┌─────────┐  ┌───────────────────┐  ┌───────────────────────────┐
 │ SQLite  │  │ 时态记忆 JSONL/图  │  │ 检索分层                   │
 │ 权威历史 │  │ episode +         │  │ hot: 当前时间线最近投影     │
 │ 投影     │  │ assertion +       │  │ warm: 主体/实体/时间索引   │
 │ (可重建) │  │ supersession 边   │  │ cold: 章节摘要/档案/全历史 │
 └────┬────┘  └────────┬──────────┘  └───────────┬───────────────┘
      │  source_commit / source_turn / receipts   │
      └───────────────┬───────────────────────────┘
                      ▼
 ┌─ Git timeline DAG（唯一不可变来源）──────────────────────────────┐
 │  .coc/repos/campaigns/<id>.git                                  │
 │  canonical state / logs / receipts / memory 记录全部进树         │
 │  tl-main ──●──●── fork → tl-attic ──●──●                        │
 │            └────────────────┬────────────┘                      │
 │                        confluence → tl-merged（两亲）            │
 │  commit trailer: Turn-Number / Finalization-Id / Timeline-Id …  │
 └───────┬───────────────────┬───────────────────┬─────────────────┘
         ▼                   ▼                   ▼
   player_safe 投影      keeper_only 投影     system_only 投影
```

分层说明：

1. **Git timeline DAG + canonical state/logs/receipts。** 继承 slice1 的 Commit Coordinator 形态：每战役一个 sidecar bare repo，战役目录为 worktree，唯一模块封装全部 git 写操作。本规格在其上把 `Timeline-Id` 从常量 `tl-main` 升级为真实分支面：每条时间线一支分支，fork/confluence 只是创建新分支与 merge 结构（提交永不改写）。canonical 状态、logs 下 JSONL、receipts、memory 记录全部进树；忽略面（可重建索引、session 态簿记）不进树。
2. **SQLite 权威历史投影。** 对提交图的确定性投影，提供任意历史点全参数快照与结构化 diff。它是"读加速器"，不是第二事实源：损坏即从 Git 重建，永不迁移，永远单读者。
3. **时态记忆 JSONL/图。** episode 按 (campaign, timeline, turn) 确定性生成；assertion 图在此之上构建，含主体、knower、双时间、memory state、supersession/contradicts/confirms 边。记录本身作为 memory 数据进 Git 树，图索引是投影。
4. **hot/warm/cold 检索分层。** hot = 当前时间线最近邻投影（会话恢复直接用）；warm = 按主体/实体/时间/隐私的确定性索引收窄；cold = 章节摘要、人物档案、全历史 diff。任何一层都只给 KP 候选集，不做语义判断。
5. **KP 语义决策层。** 所有 meaning-bearing 判断——召回相关性、fork 意图确认、player_assertion 裁决、confluence 语义冲突处置、矛盾消化——归 KP。工具层输出永远是数据与建议，KP 可采纳、修改、拒绝。
6. **player-safe / keeper-only / system-only 投影。** 确定性隐私投影是代码职责：`player_assertion` 恒 player-safe、`suppressed` 恒 keeper-only；合作代理与玩家面只见 player-safe 投影。语义相关性归 KP，可见性归代码。

## Data and Contract Decisions

以下决策在契约层（`temporal-memory-1`，clean-slate，无迁移、无双读、closed field sets）冻结；实现 worker 只消费。

### 主体与实体

- `SUBJECT_KINDS`: `world` / `investigator` / `npc` / `party` / `keeper` / `player`。world/party/npc 为战役域（`subject-world-<campaign>` 等）；investigator/keeper/player 可跨战役（`campaign_id` 可空）。
- 解析只做精确匹配：同名多 ID = 歧义错误，**永不自动合并**。跨战役同一身份只经 `same_subject_as` / `same_entity_as` 显式边成立。
- entity 默认战役域；`campaign_id=None` 的实体必须带显式 `same_entity_as` 绑定。

### 关系与共享 episode

- 关系是有向边：from→to（谁对谁持有什么认知/关系），方向即语义。
- 一个 event 是共享 episode：多个主体各自持有对它的视角断言（per-subject perspectives），视角之间可矛盾、可互相印证（`contradicts` / `confirms`），系统不强迫它们一致。

### 双时间断言与 provenance

- 每条 assertion 必带 provenance：`timeline_id`（战役域记录）+ `source_commit` + `source_turn`（≥0，0=建卡前）+ `source_receipts`（非空，机器附加）。
- 双时间约束：`occurred_turn ≤ valid_from_turn ≤ valid_until_turn`（闭区间，`None` = 仍现行）。
- **记录不含任何墙钟字段**：transaction time 由代码从 `source_commit` 投影，重放字节等价。
- `ASSERTION_KINDS`: `world_event` / `knowledge` / `belief` / `relationship` / `player_assertion` / `player_preference` / `keeper_correction` / `summary`。`world_event` 与 `summary` 必须战役域；战役域记录必须同时绑定 campaign+timeline；跨战役记录两者皆空。

### 记忆状态

`MEMORY_STATES`：`accurate`（准确）/ `uncertain`（不确定）/ `distorted`（失真）/ `suppressed`（被压抑，⇒ keeper-only）/ `forgotten`（遗忘）/ `implanted`（被植入）/ `dreamlike`（梦境般的）/ `cross_timeline_echo`（跨线回响）/ `contradictory`（矛盾中，⇒ 必有非空 `contradicts`）。

### 矛盾保存

- 旧认知永不删除。关闭一条断言的唯一 sanctioned 方式是 `plan_supersession()`：`valid_until_turn` ⇔ `superseded_by` 成对出现，id 不变、原地推进。
- 自引用与悬空引用（bundle 校验）都是错误。`contradicts` / `confirms` 保存历史关系，矛盾双方并存为 narrative debt，由 KP 在后续因果中消化。

### 玩家断言

- `player_assertion` 主体必须是 player 且 `privacy=player_safe`；它永远是**候选**，只有 `memory.adjudicate`（KP 语义裁决）后才能成为角色记忆（knowledge/belief）或世界事实（world_event）。KP 拥有玩家知识边界拦截：幸运猜中仍是猜测，发现必须被挣得。

### 语义 ID 与机器哈希

- 模型面对的一切 ID 是稳定语义 ID，统一文法 `^[a-z0-9][a-z0-9._:-]*(?:-[a-z0-9][a-z0-9._:-]*)+$`（小写 kebab、≤128），前缀即类型：`mem-` / `episode-` / `tl-` / `confluence-` / `conflict-` / `transfer-` / `backlog-` / `subject-` / `entity-`。episode id 由 (campaign, timeline, turn) 确定性导出。
- Commit SHA 与 `record_digest()` 是机器内部完整性证据：由代码生成、附加、校验，模型绝不被要求转述。防漂移靠代码里的 digest 检查，不靠模型复读。

### 硬参数与语义记忆分离

- 全部硬参数（HP/SAN/MP/Luck、技能、物品、现金、伤势、死亡、骰点回执、一次性效果）可经 `history.query` 在任意历史点查询——但**不复制**进语义记忆。时态记忆回答"谁在何时知道/相信什么"，算术与状态权威永远在 `rules.*` / `state.*`。

### 范围与跨战役规则

- 战役域断言绑定 campaign+timeline；跨战役记录（如同一玩家偏好、同一调查员生命史）两者皆空，走 `same_subject_as` 绑定。跨战役断言 id 用 `mem-xc-<slug>` 域。

### 提炼 backlog

- 后台语义提炼失败进入显式 backlog（`BACKLOG_STATUSES`: `pending` / `recovered` / `abandoned`），**绝不阻断 `turn.finalize`**；backlog 与 episode 基底一样可从 Git 确定性重建。

### 可审计压缩

- 章节摘要、arc 摘要、entity dossier 是 `summary` kind 断言，必须带 `covers_commits`（覆盖的提交区间）与 source refs。摘要命中优先于逐回合原文，但 provenance 链保证任意摘要可展开回原始 commit。摘要可以删除重建，原始提交不可。

## Timeline Operations

| 操作 | 契约 |
| --- | --- |
| `history.query` | 输入：campaign、timeline（默认 active）、锚点（commit 或 turn number）、目标主体集合。输出：该历史点全参数权威快照（state 投影）。确定性、只读。 |
| `history.diff` | 输入：两个锚点（可跨时间线）。输出：字段级结构化 diff，按主体分组，每项绑定来源 commit/turn/receipt。 |
| `timeline.fork_request` | KP 语义确认后的请求落盘：源时间线、fork_point（turn/commit）、新 timeline 语义 id 与动机记录。**不立即切换 active**，幂等（decision_id）。 |
| `timeline.fork_confirm` | 创建新分支、把 `active` 指针切到新线、写入 fork 元数据（恰一 parent + fork_point）。旧线与旧提交不可变。确认后新回合落在新线。 |
| `timeline.confluence_query` | 输入：两条待合流时间线。输出：完整冲突清单——`HARD_STATE_CONFLICT_CLASSES`（数值/资源类，diff 由确定性 resolver 产出）与 `KP_SEMANTIC_CONFLICT_CLASSES`（身份/因果/记忆类）分组，每项带左右值与 provenance。left/right 顺序确定性（= parents 顺序）。 |
| `timeline.confluence_confirm` | 逐项 disposition 收齐后落盘第三时间线（恰两个 distinct parents + fork_point）与全部 disposition receipts；`NON_DUPLICABLE` 类校验拒绝 combine/duplicate；hard 类必须带 `resolver_receipt`。幂等。 |
| `memory.recall` | 输入：subject knower、场景/实体/时间/隐私过滤器。输出：确定性收窄的候选断言集（含 memory state、valid 区间、provenance）。语义相关性判断归 KP，检索层无关键词规则。 |
| `memory.adjudicate` | KP 对候选（`player_assertion`、提炼候选、矛盾）的语义裁决：采纳为 knowledge/belief/world_event、修改、置 memory state、或拒绝。裁决本身落为断言/keeper_correction，带 provenance；旧记录经 `plan_supersession()` 关闭，不删除。 |

**玩家自然语言入口**：玩家说"要是刚才……" / "回到进宅子之前"这类话时，KP 语义判断其是否为回溯/分叉意图，向玩家确认（"你是想从第 8 回合分叉吗？"），确认后走 `timeline.fork_request` → `timeline.fork_confirm`。玩家永远不直接调用工具，也不需要知道工具存在。合流同理：玩家可自然表达"把这两条线合起来看看"，KP 确认后走 confluence 流程。

## Cross-Timeline Memory

跨时间线记忆 = **一个权威 transfer 事件 + 若干派生主观断言**。

- transfer 记录（`transfer-<campaign>-<from>-to-<to>`）：`from ≠ to` 时间线；每条 entry `source ≠ target`（target 是目标线上的**新**断言），target 带 `transfer_ref` 回指；`validate_transfer_links` 校验 source 在源线、target 在目标线。
- 每条 entry 携带：**来源**（source 断言 + 源线/commit/turn）、**可信度** `credibility ∈ [0,1]`、**失真** `distortion`（可选，语义描述）、**隐私**（派生断言继承或收紧）、**起因**（为何发生转移：梦境、神话渗透、目击者口述……由 KP 语义给出）、**玩法代价** `play_cost`（可选：SAN 损耗、关系损伤等，经 canonical rules/state 工具落地）、**失真方向**（distortion 的具体内容，供 KP 叙事）。
- 派生断言的 memory state 为 `cross_timeline_echo`；它在目标线有独立生命周期（可被 supersede、可被 adjudicate 修正），但 provenance 永远指回 transfer 与源线。
- **玩家 meta-knowledge 严格分离**：玩家在真实游玩中知道两条线发生的事，这是玩家的知识，不是任何角色的记忆。只有显式 transfer 产生的 `cross_timeline_echo` 断言才是角色记忆。KP 在叙事中维持这条边界——meta 感受可以成为恐怖体验的一部分，但不得当作角色信息使用。

## Worldline Confluence

- 合流产生**第三条时间线**，恰有两个 distinct parents + fork_point（diamond 结构合法）。parents 在合流后保持不可变：合流不回写、不改写任何既有提交。
- `timeline.confluence_query` 产出**完整冲突清单**：每一对不一致的权威事实/记忆都必须出现，不得静默 JSON merge、不得跳过。
- 冲突分两类：
  - `HARD_STATE_CONFLICT_CLASSES`（数值/资源类）：diff 由确定性 resolver 产出，disposition 必须带 `resolver_receipt`——数值合法性由代码校验，KP 不得手改。
  - `KP_SEMANTIC_CONFLICT_CLASSES`（身份/因果/记忆类）：由 KP 语义裁决。
- 处置模式 `DISPOSITION_MODES`：`choose_left` / `choose_right` / `combine` / `duplicate` / `transform` / `paradox` / `sacrifice` / `defer`。每个冲突必须有一个 disposition + receipt；`defer` 是显式推迟（转为 narrative debt），不是遗漏。
- **绝不重复结算**：`NON_DUPLICABLE_CONFLICT_CLASSES`（`roll_receipt` / `one_time_effect` / `consumed_resource` / `death`）禁止 `combine` / `duplicate`——骰点回执、一次性效果、已消耗资源、死亡在合流线中只取其一或标记冲突，永不两份同时生效。
- left/right 时间线顺序确定性（= parents 声明顺序），冲突 id 嵌套于所属 confluence，保证重放与审计一致。
- **完整战报证据**：合流的冲突清单、每项 disposition、resolver receipts、双亲区间全部进入 canonical 证据面，由 `coc-export-battle-report` 呈现——读者可以看到两条线各自走到哪里、每个冲突为何如此裁决、玩法因此如何改变。

## Failure, Recovery, and Clean-Slate Rules

- **Git / finalize 保持 fail-closed**：`turn.finalize` 在全部 canonical 写入后、交付前同步提交；commit 失败 = finalize 失败（与现行语义严格对等）。git 二进制缺失即硬失败，无降级。
- **语义提炼失败不阻断 finalize**：提炼是后台/事后过程，失败进显式 backlog（`pending`），可恢复可放弃；episode 基底与 backlog 都可从 Git 确定性重建。
- **投影损坏即重建**：SQLite、图索引、摘要、检索面全部可删除重建；重建从 Git 历史确定性导出，字节等价。**不做迁移、不做双读者、不做兼容回退**（clean-slate `temporal-memory-1`）。
- **旧战役与证据只读**：旧 schema 战役、playtest 证据与 battle reports 不得隐式、原地、live-runtime 或自动导入/迁移/回退/删除；历史报告保持只读。显式非破坏性 `coc_legacy_memory_convert.py` 可读取保留的历史卡片证据并创建新的 temporal target，绝不改动源字节或证据。需要新玩法就开新 campaign id。
- **禁止历史破坏**：默认禁止 reset / force push / 历史重写；仓库内不存在执行这些操作的代码路径。对象库损坏的唯一处置是把原仓库改名保留为证据（绝不删除任何战役文件），以带显式 `COC-History-Reset` trailer 的 baseline 重初始化——这是恢复，不是重写。
- 幂等贯穿全程：同一 finalization 重复提交返回 HEAD；同一 decision 重复执行不产生第二份记录；重复 fork confirm 不产生重复分支。

## Testing Decisions

**确定性测试（pytest，权威）**：

- 契约测试：closed field sets（未知字段即错）、语义 ID 文法与逐字相等、全部枚举成员、范围规则、错误分类。
- DAG 测试：唯一 `tl-main` 根、parent 可达、无环、diamond（合流后再度 fork）合法、active 指针有效、fork/confluence parent 数量约束。
- 投影测试：任意历史点快照正确性、两锚点 diff 正确性、投影重建字节等价、无墙钟字段（重放等价）。
- 隐私测试：`player_assertion` 恒 player-safe、`suppressed` ⇒ keeper-only、player/subject 投影不含 keeper-only 内容、秘密不因检索泄露。
- 幂等测试：重复 finalize / fork confirm / confluence confirm / 提炼 / 重建不产生重复记录。
- confluence 测试：冲突清单完整性（无静默 merge）、`NON_DUPLICABLE` 拒绝 combine/duplicate、hard 类必带 `resolver_receipt`、parents 不可变、left/right 顺序确定。
- transfer 测试：from≠to、source≠target、链接校验、credibility 边界、回指完整。
- 全部测试用 tmp_path 夹具，绝不触碰真实战役与 playtest 证据；git 调用不依赖用户全局 config，干净 HOME 下通过。
- 每轮完成必跑 `tests/test_plugin_metadata.py`；契约层冻结，实现 worker 不得在层外重定义。

**真实验收（唯一整产品验收）**：fresh campaign + Pi-Coc RPC 模式 + Grok 当 KP + 单一玩家逐句自然语言游玩，覆盖：普通回合流、一次自然语言 fork、两条时间线的不同发展、至少一次跨线记忆转移、一次玩家可见的 confluence。不用脚本、不用批处理、不用 canned scene 伪造回合。骰点完整性门照常生效（结构化 roll log 为权威，零骰显式报零）。**`coc-export-battle-report` 是唯一最终报告所有者**；战报必须展示 fork / 跨线记忆 / 合流如何改变玩法，且全部来自 canonical 证据。

## Implementation Plan Mapping

已批准计划 `pi-coc-git-temporal-memory-20260826` 的 14 个任务（稳定 id）：

| # | 稳定 id | 范围 |
| --- | --- | --- |
| 1 | `memory-contract` | 共享契约层：语义 ID 文法、closed field sets、双时间、范围/隐私/矛盾/合流/transfer/backlog 校验、错误分类。 |
| 2 | `timeline-dag` | Git 时间线 DAG：多分支、fork/confluence 提交结构、trailer 扩展、不可变保证、幂等 Coordinator 操作。 |
| 3 | `history-projection` | SQLite 权威历史投影：任意点全参数快照、结构化 diff、确定性重建。 |
| 4 | `semantic-memory` | 时态记忆运行时：episode 确定性生成、assertion 图、supersession、temporal facade。 |
| 5 | `memory-extraction` | 后台语义提炼：候选生成、显式 backlog、恢复/放弃、可重建。 |
| 6 | `memory-retrieval` | hot/warm/cold 检索：确定性收窄、隐私过滤、`memory.recall` 面向 KP 的候选集。 |
| 7 | `timeline-fork` | `timeline.fork_request` / `fork_confirm`、自然语言→KP 确认流程、active 切换。 |
| 8 | `cross-timeline-memory` | transfer 记录、派生 `cross_timeline_echo` 断言、链接校验、meta-knowledge 边界。 |
| 9 | `timeline-confluence` | confluence runtime：冲突清单、disposition、`NON_DUPLICABLE` 校验、双亲第三线。 |
| 10 | `scope-and-privacy` | 范围/跨战役绑定（`same_subject_as` / `same_entity_as`）、player-safe / keeper-only / system-only 投影。 |
| 11 | `host-integration` | Pi-Coc host 面集成：canonical skills / registry 暴露、KP 发现性、玩家自然语言入口。 |
| 12 | `deterministic-verification` | 只读 verify 脚本与确定性测试套件（fsck、trailer 1:1、schema 代际、零记录显式报零）。 |
| 13 | `plugin-acceptance` | fresh campaign 的 Pi-Coc RPC 真实游玩验收（fork、跨线记忆、confluence、战报）。 |
| 14 | `closeout` | 收尾：证据保留、文档一致、无遗留工作树/分支、最终提交。 |

### Follow-on（不在已批准的 14 项内）

| # | 稳定 id | 范围 |
| --- | --- | --- |
| F1 | `module-loop-worldline` | 授权模组自己的时光循环驱动世界线分叉：抽取产出循环关系、投影给出消费者、时钟满格接到 fork。 |

任务 7 覆盖的是**玩家/KP 用自然语言发起**的分叉。一本以时光循环为前提的模组
不需要有人开口——循环是它的规则。这条路径今天完全断开，2026-09-02 复核：

1. **抽取侧没有产出循环。** 图谱契约 v3 定义了 `resets-to` 与
   `persists-across-loop`，而《不息的渴望》（一本整本建立在时光循环上的模组）
   的图里两者各出现 **0 次**：26 个 `present-in`、22 个 `contains`、14 个
   `triggers`，唯独没有循环。图不知道自己会循环。
2. **这两个词全仓库没有读者。** 除契约文件里的声明外，`plugins/` 下没有任何
   代码引用它们。先补抽取而不补消费端，等于再造一个 keeper_notes——本仓库为
   这个形状已经付过多次代价（见 module-pipeline-unification stage-b 的
   findings 17/18）。
3. **时钟接不到 fork。** `clock-loop-doom` 的 `on_full` 写着「莎拉诵出祷词被
   烧死，风暴潮席卷城市，时光圈重置（调查员老化加深一档）」，但没有任何东西把
   它连到 `timeline.fork_request`。三局真实玩测里 `timeline.*` 被调用 **0 次**。

**依赖注记：** 循环 `on_full` 规定的「老化」在 2026-09-02 之前**没有任何
canonical 通路可以落账**——属性在建卡后从不被写，`rules.resource_delta` 只声明
四个池。`state.characteristic_delta` 补上了这条通路。也就是说即使当初接了线，
老化也只会是叙述，状态里什么都不会留下。

**验收：** 一次真实桌上的循环重置——时钟走满、世界线分叉、旧线只读保留、
调查员带着上一轮的记忆进入新线并按模组规定老化。合成测试不构成验收；本仓库的
经验是合成测试会放行正是这一类的缺陷。

**失败基线（2026-09-02 实测，campaign `amaranthine-run3`）：** 已按上述顺序取
到。玩家把王冠归还原位、莎拉已被烧死，`scene-church-climax` 的两个出口只剩
「时光圈重置」这一条（另一条要 `sarah_rescued`，已不可能）。KP 在叙述里摸到了
循环——「烟柱拧成一个你似曾见过的形状」「这一夜还没完，也还没重新开始」——
而这一回合 16 次工具调用中：

- `timeline.*` **0 次**，`state.threat_tick` **0 次**；
- 末日时钟停在 2/6，没有走满；
- `time-state` 仍是 `timeline_id: tl-main` / `branch: main` /
  `forked_from: null`，世界线没有分叉；
- 调查员属性逐字不变，模组规定的老化没有发生；
- 场景仍是 `scene-church-climax`，没有出口。

循环是纯叙述。这就是 F1 的验收对照：接线之后，同一处应当出现一次真实分叉、
旧线只读保留、调查员带记忆进入新线并按 `on_full` 老化。

**对 Stage B 的影响：** 本局的自然通关**被 F1 阻塞**——莎拉已死，唯一出口是系统
做不到的循环。要么先实现 F1，要么另开一局走「救下莎拉」那条结局（模组有两个
结局，后者今天就可达）。

## External Prior Art

以下系统提供的是**借鉴而非依赖**：借鉴其用户面语义与数据模型思想，不引入任何外部数据库服务或运行时依赖。

- **TerminusDB**（versioned knowledge graph）：借鉴其"图数据库原生 branch / time-travel / merge"的用户面——历史点查询、分支、diff、多父 merge 作为一等操作。本项目的对应物是 Git 分支面 + SQLite 投影，不引入图数据库服务。
  - https://terminusdb.org/docs/knowledge-graph-version-control/
  - https://terminusdb.org/docs/merge-howto/
- **Dolt**（SQL version control）：借鉴其 `AS OF` 历史查询、diff、merge 的 SQL 体验——对应本项目的 `history.query` / `history.diff` 与确定性 resolver。不引入 Dolt 本体。
  - https://www.dolthub.com/docs/sql-reference/version-control/
- **Graphiti**（temporal knowledge graph）：借鉴其 episode + entity edge + valid/invalid 双时间模型，以及"矛盾用时间取代（invalidation）而非删除"的原则。明确不照搬其 LLM 全图失效的失效模式——本项目提炼是后台、可重建、可 backlog 的，语义判断归 KP 而非自动全图改写。
  - https://github.com/getzep/graphiti
- **Letta / MemGPT**（tiered memory）：借鉴其分层记忆与上下文管理思想——热/温/冷分层、按需召回、摘要压缩——对应本项目的 hot/warm/cold 检索与 `covers_commits` 摘要。不把全部历史塞进模型上下文。
  - https://github.com/letta-ai/letta
- **Git notes**：借鉴其"把派生元数据挂到历史 commit 上而不改写原 commit"的原则——本项目的 receipts / episode 绑定 / 摘要回指同理，原始提交永不因派生数据改写。
  - https://git-scm.com/docs/git-notes

## Out of Scope

- 引入外部数据库服务（TerminusDB / Dolt / 图数据库 / 向量库）作为强制依赖。
- embeddings / LLM 推断作为权威：语义层只产出候选与建议，权威永远是 canonical 工具与 KP。
- 静默自动状态合并：confluence 必须显式冲突清单 + 逐项 disposition，任何静默 JSON merge 都违规。
- 默认破坏性回滚：不提供 reset / force push / 历史重写；旧线永不因新线牺牲。
- 旧 schema 迁移：禁止隐式、原地、live-runtime 或自动迁移、双读与兼容回退；旧战役只读。显式非破坏性 `coc_legacy_memory_convert.py` 可读取保留的历史证据并创建新的 temporal target，绝不改动源字节或证据。
- 云端多人同步 / 多写者协作。
- Codex-host 专属实现、提示词、launcher、测试与文档。
- 把全部历史或整份时间线倒进模型上下文；检索永远是收窄后的候选集。
- 玩家/KP 可见的 Git 术语暴露：玩家用自然语言，KP 用语义工具，Git 面留在系统层。

## Further Notes

当前实现状态（不宣称未发生的完成）：

- **已完成并合入主分支**（均配确定性 pytest，含幂等/重建等价/隐私投影）：
  - `memory-contract`：`coc_temporal_memory_contract.py`，即本文档 "Data and Contract Decisions" 的冻结来源（`temporal-memory-1`）。
  - `timeline-dag`：在 slice1 基础（`coc_git_history.py` / `coc_git_history_verify.py`，finalize 即 commit）之上实现多分支时间线与 fork/confluence 提交结构。
  - `history-projection`：SQLite 权威历史投影（`coc_history_projection*.py`）支撑 `history.query` / `history.diff`。
  - `semantic-memory`：`coc_temporal_memory.py` temporal facade（episode 确定性生成、assertion 图、supersession、`memory/temporal/*.jsonl` 存储）。
  - `memory-extraction`：`coc_memory_extraction.py` 后台提炼与显式 backlog。
  - `memory-retrieval`：`coc_temporal_retrieval.py` hot/warm/cold 确定性收窄（`memory.recall`）。
  - `cross-timeline-memory`：`coc_timeline_memory_transfer.py` transfer 核心。
  - `timeline-confluence`：`coc_timeline_confluence.py` 冲突枚举/裁决校验。
  - `scope-and-privacy`：跨战役 `same_subject_as` / `same_entity_as` 绑定与 player-safe / keeper-only / system-only 确定性投影。
  - typed 操作面已注册：`history.query` / `history.diff` / `memory.recall` / `memory.adjudicate`（`coc_operation_temporal_history.py`）与 `timeline.fork_request` / `fork_confirm` / `confluence_query` / `confluence_confirm`（`coc_operation_timeline.py`），经 OperationRegistry/toolbox 暴露；`session.resume` 返回有界 temporal capsule（`test_temporal_resume.py`）。
  - 路由文档已把 `temporal-memory-1` 写为唯一 live runtime 记忆路径（`coc-campaign-state` skill 与 `references/memory-protocol.md`）。旧 Markdown 卡片及其 `memory.search` / `memory.write` / `memory.resolve_hook` 操作已彻底退役，不再注册于 toolbox / operation archive / generated policy，也不是任何 KP、Director 或运行时的读取依赖。旧战役、卡片、context pack、索引及其证据保留在磁盘上，绝不静默迁移或删除；仅显式非破坏性历史转换器与报告/导出证据路径可以读取它们。
- **尚未完成**：`host-integration`（正常游玩中 KP 经常规技能/发现面使用全部 canonical 操作、玩家自然语言入口的真实验证）、`deterministic-verification` 收尾 sweep、`plugin-acceptance`（fresh campaign 的 Pi-Coc RPC 真实游玩验收）、`closeout`。
- **整个特性当前状态为 `unintegrated`**：按 Feature Integration 纪律，在正常 Pi-Coc 真实游玩到达全部 canonical 消费面（KP 经正常技能发现并使用 `memory.recall` / `timeline.*` / `history.*`，玩家经自然语言触达 fork/rewind，战报呈现 fork/transfer/confluence）之前，不得宣称产品支持或验收完成。组件测试通过只证明组件契约，不证明可发现性与集成。
- 本文档与 `docs/specs/temporal-memory-contract.md`（契约规格）的关系：契约文档冻结数据层细节；本文档是覆盖产品意图、架构、操作面、验收与计划映射的**完整产品规格**。两者冲突时以本文档的产品层决策为准，数据层细节以契约文档为准。
