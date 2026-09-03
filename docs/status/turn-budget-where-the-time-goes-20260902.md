# 回合耗时：时间到底花在哪 — 2026-09-02

诊断跑 r46 / r47（造景 lane，真 Grok KP，各 3 条）。全部数字来自 `317dddf4`
加进 lane 记录的时间探针：每个工具事件带 `at_ms`（lane 自己的单调时钟）与
`lane_phase`，每条助手消息带时刻与产出字符数。

**在此之前所有关于回合预算的说法都是推断**——记录只有调用顺序，没有时刻，
280 秒的一轮和 120 秒的一轮在记录里长得一模一样。

## 结论：不是一个原因，是六个，而规则层不在其中

### 一、工具执行只占 3%

r46 三条 lane：窗口 199–217 秒，工具执行合计 **6–9 秒**。

最慢的工具是 `session.resume`（4.2–6.7 秒），其次 `turn.finalize`（约 1 秒），
`rules.settle` / `rules.context` 都在 **0.2–0.5 秒**。

**规则层的执行速度对预算几乎无影响。** 97% 的时间是模型在生成。

### 二、回合开始前就花掉 53–63 秒

按 `lane_phase` 切开（r47）：

| lane | 总计 | resume 阶段 | resume 结束→回合首调用 | 回合本身 |
| --- | --- | --- | --- | --- |
| phase-1 | 345s | 40s | **53s** | 229s |
| phase-2 | 276s | 2s | **63s** | 193s |
| phase-3 | 323s | 2s | **63s** | 240s |

这段空档里模型做了 5 次以上往返（消息时刻 3s / 7s / 9.5s / 14–16s / 27–47s），
**产出的可见文本全部是 0 字符**——纯思考与工具调用握手，玩家的动作还没被看到。

### 三、回合内部是长尾，不是均匀延迟

回合阶段 84 个「一次调用结束到下次调用开始」的间隔：

- 中位数 **3.4 秒**，均值 7.7 秒，p90 20.7 秒，最大 42.7 秒
- **84 个里有 56 个短于 10 秒，加起来只占 107 秒（17%）**
- **最长的 5 个占 191 秒（29%）**

所以「往返多」和「有几次想很久」都成立，但后者更贵。

最长的那几次，位置高度一致：

| 时长 | 位置 |
| --- | --- |
| 35.2 / 35.9 / 36.2s | `turn.output_context` → `turn.finalize`（**三条 lane 全部**） |
| 42.7s | `state.journal` → `turn.output_context` |
| 28.7 / 27.6s | `rules.settle` → `rules.settle` |

第一行是**写叙事**——每条 lane 都花 35 秒左右，合计 107 秒（回合时间的 16%）。
这一项难以压缩：它是产品的核心产出。

### 四、四分之一的往返是 Keeper 在查文档

r47 回合阶段 87 次调用中，**22 次是查资料**：

- `read` 12 次，打开的是仓库里的技能文件——`coc-keeper-play/SKILL.md`、
  `coc7/skills/coc-combat/SKILL.md`、`coc-sanity/SKILL.md`、`coc-chase/SKILL.md`、
  以及 `references/` 下的文档
- `discover` 10 次，查操作 schema（`state.record_clue`、`sanity.execute`、
  `combat.resolve`、`rules.settle` 等）

其后的模型时间合计 **124 秒，占回合的 19%**。

按需读技能是设计如此，但代价现在有数了：**每次查阅是一次完整往返**。

### 五、三分之一的结算是重试

r47：`rules.settle` **17 次成功、9 次失败**。失败分布为
`subsystem_transaction_failed` ×3、`blocked_by_pending_choice` ×3，
`rule_decision_stale` / `opaque_identity_grammar` / `chase_candidate_invalid` 各 1。

这些拒绝本身是正确且可行动的（见 `rule-layer-goal-20260902.md`），但每一次
仍然是一次往返加一次思考。

### 六、pi runtime 的 replan：单项最大,而且是纯 runtime 开销

扩展在 `tool_result` 上有这条：当工具结果**改变了「活动工具接口」**（活动工具名
及其 description / parameters / promptGuidelines 的摘要）时,返回
`{replan: true}`——pi-core 丢弃这一批剩下的调用,强制重新规划。

`coc-tool-working-set-replan` 审计从写下起就在记,**但任何 lane 都记不到它**：
记录器只把 `coc-tool-working-set` 映射进可选类别,replan 落进未分化的 rpc 流。
审计存在,不可读。`a975c003` 把它变成可选、带时刻、带相位。

r48 三条 lane：**每条 5–6 次 replan,全部在回合阶段**,触发者是
`state.journal`、`turn.output_context`、`turn.finalize`、`discover`、
`session.resume`。

**代价的干净测量。** 直接比较「replan 之后」与「其余」是有混淆的——replan 恰好
触发在写叙事的那几个操作上。用**同一类语义无关的调用**（`discover` / `read`,
纯查 schema,不写叙事、不改状态）分离：

| | n | 中位数 | 均值 | 最大 |
| --- | --- | --- | --- | --- |
| 查 schema **且触发 replan** | 6 | **32.8s** | 35.2s | 68.7s |
| 查 schema 未触发 replan | 13 | **0.0s** | 1.8s | 15.8s |

同样的调用,唯一差别是有没有改变工具接口。**33 秒对 0 秒。**
按每回合 5–6 次算,仅此一项就是 **165–200 秒**,单独已超 180 秒预算。

样本小（n=6),这一点要说明；但两组的分离程度不像噪音。

**为什么查个 schema 会改变工具接口**：这个产品的类型化工具面是**随状态变形**的
——`combat.resolve` / `chase.execute` 结算后清除并重绑类型化绑定,`nextOperations`
变化时重新 `applyKpActiveTools()`,工具的 parameters 由宿主按决策预填。设计上这
正是「卡片自带确切参数」那个特性,代价是每次变形都被 runtime 变成一次重新规划。

**这是产品设计与 runtime 机制的交互,不是任何一边单独的缺陷。**

## 一个被数据否掉的假设

我原以为耗时和「模型写得多」有关。**不是**：回合阶段三条 lane 各产出
**250–320 个字符**，分散在 43–59 条消息里。模型在做大量短往返，不是在写长文。

## 由此可得的可行方向（未实施，仅记录）

1. **合并查文档的往返**——把 SKILL.md 里回合中真正需要的部分前置到提示词或卡片，
   可能省下 19% 里的大部分。
2. **压缩 resume 握手**——53–63 秒发生在玩家动作被看到之前，且不产出任何文本。
3. **叙事那 35 秒基本是底线**，不该拿它开刀。
4. 规则层继续优化执行速度**不会改善预算**（它只占 3%）。
5. **减少工具接口的变形次数**——第六项是单项最大。类型化工具面每变形一次就是一次
   重新规划；如果同一回合内的多次变形能合并、或让查 schema 不改变接口,收益直接
   按 33 秒/次计。这条要动 pi 扩展的工具注册策略,风险最高,应当先做 1 再评估。

## 方法说明

探针本身有测试钉住（`tests/test_pi_coc_debug_experiment.py`）：每个工具行必须带
整数 `at_ms` 和 `resume`/`turn` 之一的 `lane_phase`，且时刻单调不减。去掉
`lane_phase` 该测试立刻失败。
