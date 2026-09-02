# 《新 pi-coc 的重新设计》与现状的对照 — 2026-09-02

Track: `ACTIVE_IMPLEMENTATION_TRACK=pi-coc`。基线 `0.8.1a` @ `cc82c823`。

本文只记录**当天核对过的事实**，每条都给了查证方式。它不是计划书，是一份
「设计文档要求什么、代码里已经有什么、真正缺什么」的对照。

---

## 结论先行：缺的不是 Director，是 Director 不在回合路径上

设计文档第九节要求把实时通道拆成 Director / Narrator / Verifier，Director
「提出检定」并交出结构化 `TurnPlan`，且**没有直接写数据库的能力**；第三节要求
每回合是一个 13 步事务，`DirectorProposesTurnPlan` → `ValidatePlan` →
`ResolveRules` → `CommitEventBatch`。

这套东西在仓库里**已经存在，而且被测试覆盖**：

| 组件 | 位置 | 职责 |
| --- | --- | --- |
| 意图解析 | `scripts/coc_intent_router.py` | 语义评估器，封闭枚举 `investigate/social/move/combat/flee/meta/stuck/idle/ambiguous/montage/cast` |
| Story Director | `scripts/coc_story_director.py` | 产出 `rule_requests`，并区分阻塞与非阻塞（`_blocking_rule_requests`） |
| 回合编排 | `scripts/coc_live_turn_runner.py` | 玩家输入 → Story Director → 叙事增强 → 规则 → 回填 → apply/save/logs |

**但它不在 Pi 的回合路径上。** 在 `coc_operation_kernel.py`、`coc_toolbox.py`
和 `pi/extensions/index.ts` 里搜索 `intent_router` / `parse_intent` /
`live_turn_runner`，零命中。Pi 的 KP 直接调用工具箱操作，没有意图分类，没有
Director 计划，没有 `rule_requests`。

Director 唯一进入 Keeper 表面的形式是 `director.advise`
（`kp_surface: advice`，工具 `coc_advice`）——**建议性的**。KP 不调用，就没有人
提出检定。

### 这个缺口的实测后果

2026-09-02 用造景诊断跑了六条真实 Grok lane（`debug-gate9-depth-10-r6`），每条
先把调查员放进指定场景、指定 NPC 在场，再送一条玩家行动：

| 玩家行动 | 规则上应走 | KP 实际路径 |
| --- | --- | --- |
| 转身逃跑 | 战斗脱离 → 追逐 | `scene.context` → `state.journal` → `turn.finalize` |
| 擒抱按墙 | 战斗机动 | 同上，无规则调用 |
| 潜行过敌 | 对抗检定 | 同上，无规则调用 |
| 图书馆查档 | 常规检定 | 同上，无规则调用 |
| 凑近看恐怖之物 | 理智检定 | `rules.context` → `rules.settle`（**唯一进入规则层的**） |

六条里五条完整定稿了一个回合，一次规则调用都没有，全程合法。唯一判定的那条，
是因为地下室场景带着作者写好的 SAN 触发。

**规律：KP 进入规则层是被场景里作者写好的触发牵引的，不是被玩家行动牵引的。**
这解释了录制语料 56 份里 31 份是 core-check（都来自作者写好的技能检定），也解释
了为什么补完 `combat:flee → chase:start` 这条边之后追逐仍未触发——边是「结算之后
往哪走」，问题出在压根没开始结算。

### 为什么提示词补不上

`pi/prompts/host-system-play.md` 共 622 行。强制进入规则层的指令只有一条
（第 345 行）：玩家的攻击、射击、近战、闪避、反击**必须**通过战斗规则卡结算。
其余的强制项都是**写入类**约束（线索不写 `state.record_clue` 不算发现、物品不写
`state.item_grant` 不算到手），管的是「叙事不能凭空造既成事实」。

全文没有一条通用规则说「不确定 + 有代价 + 有对抗 = 去要牌」。搜索
ordinary-check / core-check / skill check 只有四处命中，全是**反向**约束：别拿
普通检定代替火器格斗、没有可观察问题就别掷、初次见面用 `npc.reaction`。提示词
一直在教它不要乱掷，从没教它必须掷。

另有约 120 行是标识语法表（`route_id`、`weapon_ref` 等字段格式），篇幅远超「何时
判定」的全部内容，且只在 KP 已经决定调用工具之后才有用。

结论：这是架构问题，不该往第 623 行加。设计文档第四节给的规则节点范式已经指明
方向——`trigger: action_kind: uncertain_action` / `guards: tension_or_conflict`
应当是**图谱里的数据**，不是散文。

---

## 七张图与内核概念的逐项状态

状态取值：`已实现` / `部分` / `已建成但未接入` / `缺失`。

| 设计文档要求 | 状态 | 依据 |
| --- | --- | --- |
| 1. Canon Graph：Claim 为第一等公民，带 holder / truth_status / visibility | 部分 | `coc_belief_state.py` 有信念快照与 append-only 认知事件（CONFIRM/EXPAND/COMPLICATE）；`coc_module_graph.py` 有 `asserted_by_ids` / `known_by_ids`。没有统一的 `Claim` 对象与 `mode: belief` 建模 |
| 2. Mystery Graph：线索/命题/获取路线/可达性检查 | 已实现 | `clues.query`、路线 `grants_clue_ids`、模组编译期可达性检查 |
| 3. Narrative Graph：义务/场景机会/压力时钟/导回策略 | 已实现 | `director-graph.json`、`coc_director_graph.py`、威胁时钟、`quest.*` 五个操作 |
| 4. Rule Graph：适用关系 + 类型化执行 | 已实现（执行侧） | 435 节点 / 670 关系，十族 `family_runtime_ownership=graph`，源绑定到规则书页码 |
| 4b. 规则节点的 `trigger` / `guards`（何时适用） | **缺失** | 26 个条件节点的事实命名空间是 sanity/actor/chase/receipt/development/time/magic/campaign；`intent` 只有唯一一条 `intent.pushed`。`action_kind` / `uncertain_action` / `declared_goal` 在规则运行时中不存在 |
| 4c. 规则层级与显式覆盖关系（OVERRIDES/AUGMENTS/DISABLES） | 缺失 | 图谱里没有覆盖类关系；村规导入流程未实现 |
| 5. World Graph：事件投影出的世界 | 已实现 | 每战役一个 git 仓库，`canonical-events.jsonl`，turn-effect 提交，状态投影 |
| 6. Epistemic Graph：每角色视角 | 已实现 | `coc_epistemic_*.py` 六个模块 + `epistemic-contract.json` + `epistemic.query` |
| 7. Presentation Graph：输出契约 | 已实现 | TextGraph T0–T5 已并入；`narration.review` 做 Claim/Style 审计 |
| 三、回合作为事务 | 部分 | 有 `state.journal` → `turn.output_context` → `narration.review` → `turn.finalize` 的义务链与收据；**没有** `TurnPlan` / `ValidatePlan` 前置阶段 |
| 三、Pending Choice | 已实现 | `rules.context` 卡 + `pending-choice` 节点 + 推骰/幸运续接 |
| 四、三种时间（因果/故事/知识） | 部分 | 因果序与故事时间有（`logs/time.jsonl`、`time.advance`）；知识时间只有 `known_by_*` 标志，没有 per-holder 时间戳 |
| 四、离屏事件调度 | 部分 | 有威胁时钟与压力推进；没有到期事件优先队列 |
| 五、事件 DAG + 分支 | 已实现 | `timeline.fork_request` / `fork_confirm` / `transfer` / `confluence_*`，`history.diff` / `query`，git 式回溯 |
| 六、时间循环双层状态 | 缺失 | 无 meta-persistent 层 |
| 七、Context Capsule | 部分 | `scene.context` / `actions.list` 是有界投影，16 KB 传输预算做压缩；不是文档描述的统一胶囊结构 |
| 八、模组编译器 | 已实现 | PDF → IR → 图谱包，来源对齐到页码/块，编译期 lint |
| 九、Director / Narrator / Verifier 三通道 | **已建成但未接入** | 见上文。Verifier 侧 `narration.review` 已在线，但与 KP 同一模型通道 |
| 九、确定性内核 | 已实现 | 掷骰、难度、幸运、推骰、SAN、战斗、追逐、时间、事件提交、重放 |
| 十二、Pi 只给领域工具，移除 bash/write/network | 已实现 | 148 个操作全部是领域操作；KP 表面无文件系统与网络工具 |
| 十三、Pi core 改进项（外部状态适配器、回合事务、能力域工具等） | 缺失 | 目前靠 patch-package 在 `runtime/adapters/keeper/patches/` 打两个补丁（replan 钩子），没有上游抽象 |

---

## 真正缺的东西，按依赖排序

1. **玩家意图成为图谱可读的事实。** 没有 `intent.action_kind` 这类事实，规则节点
   就写不出 `trigger`，Director 的计划也没有可校验的对象。现有
   `coc_intent_router` 的封闭枚举（含 `flee`）可以直接复用，但它是文件中介的
   离线 LLM 交换（`.intent-eval/` 请求-结果文件），需要改成 Pi 内的模型通道。
   注意：它**故意不是关键词匹配**——缺少语义证据时降级为 `ambiguous` 并记录，
   不允许回落到关键词。这条约束必须保留。

2. **规则节点的 trigger / guards。** 有了意图事实之后，把「不确定 + 有对抗/风险
   = 需要检定」写进图谱，而不是提示词。

3. **回合事务加上前置阶段。** `TurnPlan` → `ValidatePlan` 放在现有义务链之前，
   让「没有 rule_requests 的对抗性回合」在校验期就被拦下，而不是靠 KP 自觉。

4. 其余（覆盖关系与村规、知识时间、离屏事件队列、时间循环双层、Context Capsule
   统一化、Pi core 抽象）都不阻塞上面三条，可以之后再排。

---

## 一个必须避免的误判

不要把这份设计文档读成「现在这套要推倒重做」。逐项核对下来，七张图里五张已实现
或接近实现，确定性内核、事件 DAG、模组编译器、输出契约都在线。真正的断点只有
一处：**决定何时进入规则层的那个阶段被建成了却没有接进产品回合**。

修这一处，比重写任何一张图的收益都大，而且今天的造景诊断已经能直接验证它——
同样六条 lane，接入后应当有五条进入规则层，而不是一条。
