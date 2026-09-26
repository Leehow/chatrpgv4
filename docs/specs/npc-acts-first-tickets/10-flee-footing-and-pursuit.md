Status: ready-for-agent（2026-09-26，两桌复核漏报的处置）
Spec: docs/specs/npc-acts-first.md（第七节「复核漏报的处置」）

# 10 — 逃跑的两条：躺着的人逃不了；玩家逃跑不自动开追逐

两条都是内核战斗引擎的事，和 01–05 不撞文件。

## 证据

- A2 桌 T6：诺特已 `prone`，KP 为他 resolve 逃跑，引擎打上 `fled` 并以 `investigators_win` 结束战斗；正文里他躺在地上没动。此后 KP 为了落第二拳把战斗又开了两次，每次因 `fled` 立刻结束（`condition:steven-knott-t6-c3`、`session:combat-end-t6-c3/c5/c7`）。
- A 桌 T12：玩家「转身出了办公室，下楼」，一次 resolve 产出 `condition fled`（调查员）、`combat-end fled`、**`chase-start`**、诺特的 CON 与 Fighting 骰、`chase-end escaped`（全部 call `t12-c3`），正文写诺特「没起身，也没追到门口」。NPC 逃跑时引擎只给提示（`kernel-ts/combat/execution.ts:417`，「a pursuit is the investigators' choice」）；玩家逃跑时追逐却是自动开的，追的人没有决定过。

## Scope

- **躺着的人逃不了**：规则数据（`combat.json` 或条件目录里加 `flee_blocked_by: [...]`，从 `engine.ts:17` 的 `VALID_CONDITIONS` 里挑规则书说不能移动的：`prone`、`unconscious`、`dying`、`dead`、`grappled`——按规则书核对后写进数据，内核不写名单）；`resolveFlee` 对带这些条件的 actor 返回 `needs`，`fix` 指出先脱离该状态（起身是一个回合的事：`hold` / 对 NPC 是 §138.5 的 `spend_turn`）。战斗结束条件不变。
- **玩家逃跑不自动开追逐**：调查员 `combat:flee` 成功后，引擎不再执行 `chase:start` 的 continuation，改为和 NPC 逃跑同形的提示（谁可能追、怎么开追逐）；追逐由追的人开：调查员追 NPC 用 `chase:start`（现状），NPC 追调查员是 03 的 `pursue` 绑定或 KP 的 `resolve chase:start actor:<npc>`。`session:combat-end fled` 照旧。
- 契约 §139.9；§11.5 追逐段加带日期的注。

## Not in scope

- 03 的 `pursue` 绑定；一回合内反复开战的守卫（行动在前之后失去动机，先记观察）。

## Acceptance

- pytest（Corbitt 夹具）：给 Corbitt `prone` 后 KP 为他 resolve flee → `needs`，`details.reason` 命名该条件，无 `fled`、战斗未结束；去掉 `prone` 后同一调用成功。
- 调查员逃跑：`session` 里只有 `combat-end fled`，无 `chase-start`；`hints` 含追逐提示；随后 KP `resolve chase:start actor: Walter Corbitt target: <investigator>` 能开追逐（NPC 当追者，若现状不允许则记为 03 的前提并在 handoff 说明）。
- 变异：把 `flee_blocked_by` 表清空 → 第一条用例逮住；把 continuation 加回 → 第二条逮住。
