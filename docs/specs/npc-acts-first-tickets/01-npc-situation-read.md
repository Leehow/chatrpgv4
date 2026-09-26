Status: ready-for-human（三处拍板后转 ready-for-agent）
Spec: docs/specs/npc-acts-first.md（D1）

# 01 — `npc.situation`：他此刻的处境

## Scope

- 新内核读 `npc.situation {campaign, name}`（或 `table.look focus=npc` 加 `situation` 节，二选一，实现时按 §11 的读法约定定），返回 D1 的八段：是谁、刚发生在他身上的事、状态、手边、做过什么、常备计划、约束、裁剪记录。
- 「刚发生在他身上的事」由代码从本回合与上一回合的收据拼成短句（复用 `runtime/jev/composed-arguments.ts` 的拼句约定，落在内核侧则新建 `kernel-ts/npc/situation.ts`）：主语或对象是他的 roll/delta/condition/item/cash/coercion/npc 收据；compile 的 addressee 命中他时带玩家原话。
- 字节预算 6 KB（`host-budgets.json` 命名默认值），从「常备计划」「约束」「手边」起裁，`truncated: [段名]`。
- `npcPerspective`（`kernel-ts/npc/perspective.ts`）不改形状；本读只**组合**它。

## Not in scope

- 生成、绑定、任何写入。
- 其他 NPC 的秘密、调查员的卡、导演信号。

## Acceptance

- 用例走真实内核（pytest）：一桌里诺特被打中一次、被夺走现金一次，读出的「刚发生的事」有这两句且没有第三句；HP 分数、立场、在场名单正确；他有一条 `attempted` 意图时「做过什么」含该行与状态。
- 变异：把上一回合的收据从窗口里去掉，用例必须失败（读到的事少一句）。
- 预算：塞入 30 行常备计划，返回 ≤ 6 KB 且 `truncated` 含 `plans`。
