Status: ready-for-agent
Spec: docs/specs/npc-as-actor.md（D4）

# 08 — NPC 手里的东西：持有与武器

抄椅子当武器、夺走调查员的枪、把钥匙揣进口袋：今天 NPC 武器只从 profile 来，`apply npc` 没有 weapon 字段，受管实例的 owner 是调查员表 id（`kernel-ts/apply/inventory.ts:83`），东西一到 NPC 手里就没有状态。

## Depends on

- 02。

## Scope

- `apply npc` 新字段 `weapon: {name, profile: "<weapons.json id>", why}`：写 `world.npc_resources[handle].weapons[]`（与 profile 武器合并，`resolve` 的 NPC attack 认它）；`club_large` 这类即兴武器按 `weapons.json` 的 profile 取伤害，代码不写数。
- `apply item` 的 `to` 接受 NPC 名：调查员失去、`world.npc_resources[handle].holdings[]` 得到（`{name, quantity, turn, from}`）；反向 `from: <npc>` 时若他 `holdings` 里有就扣。受管实例（`define`/`object`）的 owner 允许为 NPC handle。
- 投影：`present[].holds`（最近 5 件）与 `present[].weapons`。
- 契约：L358、L1451、L1887 各加一段。

## Not in scope

- NPC 的现金账（`cash.with` 仍是账本上的名字）。

## Acceptance

- `tests/kernel/test_npc_holdings.py`：给 NPC 一件 club 后他的 attack 用 club 伤害；`apply item to: <npc>` 调查员失去、NPC holdings 增加；反向取回。
- 变异用例：删掉 holdings 写入，「NPC 持有出现在下一回合胶囊」必须红。
