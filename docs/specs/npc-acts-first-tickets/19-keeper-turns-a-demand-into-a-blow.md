Status: ready-for-agent（2026-09-26；工单 17 的 worker 按遥测纠正了 C4 T8 的归因后立）
Spec: docs/specs/npc-acts-first.md（第九节「C4 桌」）

# 19 — KP 把玩家的要求改写成一拳：拒绝的 fix 在教它，准入没拦

## 证据（真桌 `npc-acts-c4` 第 8 回合，按原始读数，不按归类）

玩家：「钱呢？你说的二十块，现在就给我。」（战斗进行中，轮到投资者。）

- compile：`act` 判 `none` 0.91，攻击候选被判掉交给 KP——书记员**没有**出拳（run `run-01a0de09-…` 的 bind 行只有诺特的常备防御 `t8-c3`）。我在 spec 里原先写的「路由把要钱当成一拳」是错的，已改正。
- KP 自己 `resolve {intent: combat, decision: combat:maneuver, method: "挥拳威逼，逼他把钱交出来"}`——把玩家的要求改写成了一个玩家没声明的动作（§34 D2：不发明调查员的自愿行动）。
- 内核以 `needs: a maneuver is one of the rulebook's four` 拒绝，`fix` 写着「**to simply hit instead, resolve the attack rather than the maneuver**」（`kernel-ts/combat/index.ts:149`）。
- KP 照着 fix 逐字改成 `resolve {decision: combat:attack, method: "一拳逼他把钱交出来"}`，掷骰落地。这回合遥测里**没有任何 admission 行**：准入没有复核这次攻击。
- 同一形状在记忆里有先例：错误里的 fix 会被逐字执行。

## Scope

1. **fix 不教它改成攻击。** `combat:maneuver` 缺目标时的 `fix` 改为：列出四种战技目标；「if the player's words are not one of these, this is not a maneuver; a blow is resolved only when the player declared one」——不再建议「改成攻击」。全仓扫一遍 combat 族 `needs` 的 fix 文本，凡是建议把一种战斗动作换成另一种的，同样改成「以玩家声明为准」。
2. **准入复核 KP 替投资者发起的战斗动作。** 查清 C4 T8 为什么没有 admission 行（投资者在自己回合的 `combat:attack` 是否被当作 session 步骤豁免、或攻击声明只在防御结算时复核）；KP 发起（`origin: model`）、actor 是投资者的 `combat:attack` / `combat:maneuver` 必须过准入车道，用玩家原话判 `not_authorized`。compile 已判 `act: none`（已记录）时，这可以直接作为 typed 证据拒绝，不必等车道。
3. 契约 §139.18；§32 与 §11.5 加带日期的注。

## Not in scope

- NPC 侧；书记员的路由（17 已做）。

## Acceptance

- pytest：`combat:maneuver` 缺目标的 `needs` 的 `fix` 不含「resolve the attack」；变异（把旧 fix 放回去）由一条断言「fix 不建议另一种战斗动作」逮住（挂结构：检查 fix 里是否出现 `decision` 名，而不是挂英文措辞）。
- ext 用例（真 harness + 假 admission 车道）：战斗中玩家说要钱，KP 夹具先发 maneuver 再发 attack → attack 被准入拒为 `not_authorized`，无骰子落地；玩家说「又是一拳」→ 照常。
- 变异：去掉对 KP 战斗动作的准入复核，ext 第一条逮住。
