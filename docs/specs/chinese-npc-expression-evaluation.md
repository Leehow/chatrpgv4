# 中文 NPC 表达评估报告（2026-10-02）

## 结论与停止决定

**没有 demonstrated improvement。** S2 自动 Jev screen 未通过，因此现在停止 legacy propagation 与 genuine play；不发布、不宣称质量验收，也不宣称新风格已改善表达。候选仍是 unmerged/unreleased。该停止是本轮 screen 的决定，不是对新风格普遍更差的结论。

## 数字与限制（分列）

### 数字

- facts 总结：24 pairs、12 contexts、3 clusters。
- 结果：wins 1、losses 2、ties 0、unknown 21；`consistentlyWorse: true`；`serious: 0`、`newUnclear: 22`、`nonTiePreferenceRate: 0.3333333333333333`。
- 三个 cluster 的 axis deltas：`benson-hardware|彼得·本森` naturalness -0.1825、coherence -0.04499999999999993；`abattoir-surrounding-roads|赛斯` naturalness -0.04062499999999997、coherence -0.07437500000000002；`last-stop-bar|罗伯特·泰勒` naturalness -0.41500000000000004、coherence -0.3475000000000002。
- 材料/实现记录：curated 32（LOTM 25、Witcher 7），curated references verified 128，considered 305，writer calls 48；writer 是 `flapcode/gpt-6-luna low`。
- 预算：default 400 bytes、declared 1200 bytes、actual candidate brief 812 bytes；capability `mods.language-brief-budget.v1`，field `brief_budget_bytes`。
- 检查：focused language alignment 13、prior singlepass unified voice and domain 25、kernel typecheck passed；full suite、code review、commit pending。standalone runtime typecheck 的既有 `source-ref.ts:78` error 仍复现，未修无关问题。

### 限制与未知

- 12 contexts 只来自 3 个 scene-character clusters，且 Seth 占比较多；不是 12 个独立场景，也不能当作 12 个独立重复实验。
- 21 个 preference judgments unresolved，22 个 new-arm fact/identity checks unclear；这些是未决/不清楚，不是 22 个已证明的事实错误。
- 质量分数不能证明 human preference、因果关系或 genuine play 接受度；screen 也不是真人回合。
- 4 个小型 independent calibration examples 只是 preliminary，不是 general calibrated validation。
- 812-byte reminder 在 full-guidance snapshots 之后加入，未进入本次 A/B；不能据此声称 reminder 带来改善。
- Keeper genuine play 未运行（`not run: gate failed`），legacy propagation 未实现（screen stop condition）。没有 C/B、新 cards、legacy world update、driver liveplay、packaging、installation 或 deployment 的证据。

## 输入与耗时记录

- A：独立作者进程中位耗时 44.1 秒；未缓存输入 368041 tokens，缓存输入 419840 tokens；输出 12972 tokens。
- B：独立作者进程中位耗时 48.2 秒；未缓存输入 396198 tokens，缓存输入 286208 tokens；输出 13180 tokens。

这些是离线带工具作者的记录，包含工具往返与 provider 重试，不是玩家等待时间。Flapcode 计价未核验，不能从 SDK 的零价格字段推导实际费用。原始字段保存在 [offline-ba-usage.json](/Users/haoli/Documents/TRPG/小说/对白研究-20261001/implementation-20261002/offline-ba-usage.json)。

## 原始 A/B 证据（按来源位置直接物化）

### 1. bloodroad-21｜benson-hardware|彼得·本森

**玩家原话**

> 我要一套，先请他确定总价，按他说的价钱付清。我介绍自己叫杰克，是汽车修理工，也问他怎么称呼；然后聊起那些关门的店和停卖的枪柜，问这镇子这些年是不是发生过什么变故。

**A**

> {{say:彼得·本森}}两美元，伙计，收好了。叫我彼得·本森就行。镇上这些年确实变了些，十六年前有一帮危险的人拿孩子们来逼我，我才把枪和子弹停了。后来有些店也陆续关了，生意越来越难做；你在这儿走动，离塞斯和他那帮人远一点，也替自己留个心眼。{{/say}}

**B**

> {{say:彼得·本森}}两块钱，收好了。这套您拿着。叫我彼得·本森就行。镇上这几年确实变了些，有些店关了，做生意的人也得多留个心眼。那些沙漠地痞不好惹，我只知道这么多；我一直叫几个孩子离塞斯和他那帮人远点。{{/say}}

### 2. bloodroad-22｜benson-hardware|彼得·本森

**玩家原话**

> 我收好补胎材料，认真谢谢彼得的提醒，说明自己只是路过住一晚，不想招惹麻烦。但总得知道哪些地方别去、什么事别碰，才能免得无意闯祸；请他具体给我指两条注意事项。

**A**

> {{say:彼得·本森}}您这么想就对了，路过住一晚，别给自己找事。真要说两条：第一，见着塞斯和他手下就绕开，别搭话，也别打听他们的事；第二，碰上那些沙漠地痞别逗留，离远点走，能回主干道就回主干道。记住这两条，基本就不会无意间撞上麻烦了。{{/say}}

**B**

> {{say:彼得·本森}}您这么说就对了。具体两条：一，见着塞思或他手下的人，能绕开就绕开，别跟他们起冲突；二，尘鬼那边的事别去招惹，听见什么也别往跟前凑。镇上有些地方，我不方便在店里细说，您只记住这两条，住一晚也就少惹些麻烦。{{/say}}

### 3. bloodroad-65｜abattoir-surrounding-roads|赛斯

**玩家原话**

> 我缓慢把车停在路肩，双手仍放在方向盘上，隔着车窗问他们为什么追我。

**A**

> {{say:赛斯}}「问这个干什么？下车，手别离开方向盘，别逼我过去替你开门。」{{/say}}

**B**

> {{say:赛斯}}「少他妈问，手离开方向盘，下车。」{{/say}}

### 4. bloodroad-99｜abattoir-surrounding-roads|赛斯

**玩家原话**

> 我压住声音再问车斗里那人：‘你认识开车的？你们到底是什么关系？’

**A**

> {{say:赛斯}}少他妈打听。你只管把嘴闭上，别问第二遍。{{/say}}

**B**

> 少他妈打听。你只管老实待着，再多一句，我就把你嘴堵上。

## 链路、文件与证据边界

- 来源与事实证据：[`facts.json`](/Users/haoli/Documents/TRPG/小说/对白研究-20261001/implementation-20261002/handoff-report/facts.json)。它记录 source base `b3bf7ed999fe50383741f103a749cd83dca5b2ce`、branch `codex/chinese-npc-expression-20261002`、writer、A/B rows、budget 与 checks。
- 计划：[`chinese-npc-expression.md`](../active-plans/chinese-npc-expression.md)。它记录 S1/S2、失败即停、独立授权预算和 pending checks。
- 规格：[`chinese-npc-expression.md`](chinese-npc-expression.md)。原历史 requirements、原 gates、one-pass 与 owner final subjective acceptance 均保留；新增 implementation record 只记录本次状态。
- guidance：[`../../mods/zh-optimize/GUIDE.md`](../../mods/zh-optimize/GUIDE.md)；changelog：[`../../mods/zh-optimize/CHANGELOG.md`](../../mods/zh-optimize/CHANGELOG.md)。候选状态、budget 与职责边界已写入，历史 entries 保留。
- 文件/module/source proof 只说明材料进入了候选包及其测试/记录；它不证明玩家真正读到候选内容，更不证明 Keeper 在 genuine play 中采用了它。facts 明确写有 `keeper_genuine_play: not run: gate failed`，且 candidate unmerged/unreleased。
- 因而，本报告不作 release claim；静态结构、索引、字节数、typecheck 或模块路径都不能替代实际玩家回合，也不能把未知当成已证错误。


<!-- Host-materialized verification state -->

```json
{
  "commit": "b51e76067",
  "code_review": "completed; fixes and limits in code-review.json",
  "focused_checks": "passed: declared-budget shape/overflow/default, language assembly, kernel typecheck, system language, NPC card package, single-pass delivery and voice ownership",
  "full_suite": "queued on leehow-pc behind unrelated PID541; owned waiting process exits on transport failure and runs exactly one full extension suite after idle",
  "release": "not merged, not released: language improvement screen failed",
  "remaining": "C/B, new cards, scoped legacy migration, provider-bound full/brief revision propagation and genuine play are not implemented because prerequisite screen failed"
}
```
