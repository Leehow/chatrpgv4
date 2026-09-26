Status: ready-for-agent
Spec: docs/specs/npc-as-actor.md（D2、D4）

# 09 — 逃跑的后续：在场、去向、追逐

`resolveFlee` 给任何 actor 打 `fled`（`engine.ts:1026`），然后什么都不发生：不改在场、不接追逐、不结束战斗。

## Depends on

- 02。

## Scope

- NPC `flee` 成功（引擎判定按现有 flee 规则）后同一批：`apply npc to: <目的场景 | away>`（KP 给，缺省 `away`）；若调查员选择追（下一回合玩家声明），走 `chase:start`，NPC 为 quarry；不追则该 NPC 从会话参与者里标 `fled`，会话里只剩一方能打时自动 `combat:end`（现有 `eligibleParticipant` 判定，`execution.ts:36-39`）。
- 调查员 flee 的 `continues-as chase:start` 路径不动。
- 契约 §11.5.3、L521 补 NPC 一侧。

## Not in scope

- 多 NPC 各自逃向不同地方（一次一个）。

## Acceptance

- `tests/kernel/test_npc_flee.py`：NPC 逃成功 → 在场变化、战斗自动结束；玩家追 → chase 以 NPC 为 quarry；逃失败 → 仍在场、仍在会话。
- 变异用例：删掉自动 `combat:end`，「只剩一方时会话结束」必须红。
