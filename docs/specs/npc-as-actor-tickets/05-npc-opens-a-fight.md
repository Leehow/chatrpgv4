Status: ready-for-agent
Spec: docs/specs/npc-as-actor.md（D4）；契约 §32.9 与 `kernel-ts/combat/execution.ts:277` 记的已知缺口

# 05 — NPC 主动开打：偷袭与伏击进规则层

「An NPC cannot open the round itself」。诺特抄椅子先动手、走廊里有人从背后扑上来，今天规则层没有这一步。

## Depends on

- 02（NPC 回合是操作）。

## Scope

- 新决策 `decision:coc7:combat:open`（或复用 `surprise_attack` 加 `actor: <npc>`，由实现者按 `content/rulesets/coc7` 的决策图选一种并在契约写明理由）：NPC 行动者对在场调查员开局。规则来源：Keeper Rulebook 的 surprise（被袭者的 Listen/Spot 检定决定是否失去第一轮），闭合表放 `rules-json`，代码不写字面量。
- 开局后按现有引擎排 DEX、NPC 先动（surprise 成立时被袭者本轮不能行动），收据 `session start` 带 `opened_by: <npc>` 与 `intent_ref`。
- 玩家侧：被袭者的 standing defense（§11.5）照常自动结算；不 `ask`。
- 契约：§11.5.4 新节；`execution.ts:277` 的拒绝文本改为指向新决策。

## Not in scope

- 群体伏击的多 NPC 初始化（一次一个开局者；其余 NPC 由 KP `apply npc to: here` 后按 DEX 入序）。

## Acceptance

- `tests/kernel/test_npc_opens_fight.py`：无战斗时 NPC 开局建会话、NPC 先动；surprise 检定过则调查员第一轮跳过；收据 `opened_by`；调查员 standing defense 自动结算。
- 变异用例：删掉 surprise 表读取，「被袭者跳过第一轮」必须红。
