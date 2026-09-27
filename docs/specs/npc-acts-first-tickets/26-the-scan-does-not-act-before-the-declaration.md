Status: landed @ 6607e5b13 + 891340596（2026-09-26；真桌 D T3 发现；工单 21 带来的回退）
Spec: docs/specs/npc-acts-first.md（D4；第九节「D 桌」）
Contract: §143.25（新）；修 §143.20 的扫描时机

# 26 — 扫描不抢在调查员的动作之前

## 证据（真桌 `npc-acts-d` T3）

玩家「我走过去，照他脸上就是一拳」。compile 的 `act` 以 1.0 判 combat；路由选中了普通检定（`need` now 0.47，靠领先幅度 0.64 对 0.33 过闸），但它的绑定没定下来，出拳留给 KP（`clerk_unbound`）——更正：我原先写成「0.47 没过闸」，worker 按遥测查实。工单 21 让扫描在 KP 第一次模型步之前就跑，于是诺特拿到的是「照他脸上就是一拳」这句**还没结算**的声明，生成「侧身让开门口，抬脚朝外走去」，绑成 `leave`，`to: away` 记 done——人走了；KP 随后结算这一拳时只能先 `apply npc to: here`（「他刚才就在这张桌子对面」）把他拉回来。T4 他在战斗里自己的回合又生成同一件事，因为 T3 那行已记 done，闸放行。B2 全是说话，没暴露。

## Scope

1. 扫描在 KP 第一次模型步之前跑（§143.20）的前提加一条结构判据：**这回合 compile 的 `act` 过闸读成了战斗动作（combat / flee，内核的封闭动作词表），而这回合没有书记员的战斗步骤落地**时，声明指向的那个人（compile 的 addressee / target 过闸点名的人，或 `acted_on`）不在模型步之前行动——他的反应走他自己的战斗回合（§142 的 forced turn）或落地步骤之后的扫描。其他在场的人照常。
2. 不读散文、不列词：判据只用 compile 的封闭 `act` 行与已有的落地记录。
3. 契约 §143.25；§143.20 加带日期的注。

## Acceptance

- loop（重放 D T3 的形状）：compile act=combat 过闸、没有书记员战斗步骤落地、诺特在对话中 → 模型步之前没有他的 `npc_act` 行；落地一个战斗步骤后的扫描照常。
- loop：同回合另一个在场、没被这一拳指向的人照常以 engaged 行动。
- 变异：去掉判据 → 第一条逮住。

## 追加（2026-09-26，集成头 c94b1d682 的全量）

全量在 c94b1d682：pytest 1886/2 skip 全绿；**loop 224/239、ext 3407/3416**，失败全是毫秒级确定性失败，不是负载：

- `experiments/single-loop-routing/loop.test.mjs`：needs judged now…（扫描插在「人物 A」的 **LLM 绑定**之前，排到了书记员步骤前面）、low-confidence need…、ask_llm with nothing selected…、same question…escalates、after an LLM step…、exhausted Jev budget…、closed choice among issued actions…
- `tests/extension/single-loop-binding.test.mjs`：§135.28 的三条
- `tests/extension/single-loop-prescreen-budget.test.mjs`：spent decision budget composes once…
- `tests/extension/single-loop-run-driver.test.mjs`：SL-01 gate…、without a Jev key…
- `tests/extension/single-loop-turn-budget.test.mjs`：the pure policy: a spent time budget…、a model step that crosses the budget…
- `tests/extension/host-state-not-fiction.test.mjs`：a delivery made under an adaptation wait carries the host's own notice（`said once per delivered turn: []`）

**设计更正（本工单一并做）：** §143.20 的「KP 第一次模型步之前扫描一次」实现成了「第一次 `infer` 之前」，其中包括书记员中途交给模型的 **LLM 绑定**（`purpose: bind`）。扫描应当在 KP 写这回合的模型步（adjudicate / compose）之前，不在书记员工作中途的绑定之前；再加上正文的战斗动作判据。然后逐条过上面这些用例：设计变了的，按新设计改断言并在交接里逐条写理由（夹具里写 `npcScanned: []` 表示「这条用例不关心扫描」也行，但要说明）；行为错了的修代码。不许整体放宽断言。适应等待那条要查清是扫描吞了提示还是别的原因。

## 落地记录（2026-09-26）

- **时机：** 扫描只排在 KP 写回合的模型步（adjudicate / compose）之前，不再排在书记员中途的 LLM 绑定之前（`next` 的 `turnWriting`）。
- **战斗扣住：** compile 过闸读出战斗动作（act 为 combat/flee，或已下发的战斗步骤/先手的决定）且没有非强制的书记员 combat/chase 步骤落地时，扫描扣住这一击指向的人：compile 点名的 → 没点名则被作用的 → 都没有则在对话中的人（**worker 的决定，超出工单原文**：D T3 compile 谁都没点名、诺特只是在对话中；于是两人都在对话中、一拳没点名谁时，两人都不在 KP 这一步之前行动）。被扣的人不记 seen、不占上限，记一条 `npc_held`。
- **16 条移位用例逐条：** 3 条时机修正后原样通过（现在守着修正）；7 条是路由/绑定用例，夹具写 `npcScanned: []` 并注释；5 条把那一次扫描写进期望序列；`host-state-not-fiction` 那条不是扫描，是测试读遥测读早了的竞态，改测试等 decision 行。
- 变异：扣住关掉 → D T3 与埃德娜两条逮住；`turnWriting` 退回任何 infer → 三条原样用例逮住。
