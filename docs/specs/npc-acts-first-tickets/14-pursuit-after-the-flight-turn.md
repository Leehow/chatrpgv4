Status: landed（合入集成分支 claude/npc-as-actor-20260926 @ 085ce0bf6，2026-09-26）
Spec: docs/specs/npc-acts-first.md（第九节「真桌 C」）

# 14 — 逃走的人下一回合还追得上

## 证据（真桌 `npc-acts-c`，`.coc/playtests/npc-acts-c-20260926T125610Z`）

- T4：诺特的生成行动「推开椅子转身冲出门」绑成 `flee`，引擎打 `fled`、战斗结束；KP 照 §142.10/§143.12 的提示在同一回合写了 `apply npc to: away`，正文写他跑下楼喊警察。都对。
- T5：玩家「追出门顺楼梯往下追」。KP 三次 `resolve chase:start`：带 `target: Steven Knott` → `unknown_entity: Steven Knott is not in the current scene`（他已 `away`）；去掉 target → `needs: a chase needs a pursuer with a stat block present in the scene`（退回旧形状的文案，而且是误导）。KP 只好 `apply npc to: 这里` 再 `to: corbitt-house-ground`，把人挪进了科比特宅——从此他不在场，`npc_act` 再也不触发，T6 零收据、T7 只剩散文。
- 根子：§143.12 的「常备逃跑」窗口被同一回合的 `to: away` 取消了（13 的 handoff 写明「the NPC is moved (`to`)」会结束窗口），而提示恰恰让 KP 在逃跑那一回合就写 `to: away`。追的人永远慢一回合。

## Scope

- 逃跑那一回合写下的 `to: away`（或任何 `to`）不结束常备逃跑的窗口：直到下一回合玩家声明结算之前，`chase:start target:<npc>` 仍然认这个刚逃走的人当猎物，追逐开在玩家当前场景（他刚从这里跑出去）；追逐结束 `escaped` 才真的把他算作离场。
- `chase:start` 没有 `target` 时，若上一回合有人从本场景逃走，`needs` 的 `fix` 点名那个人当猎物（`options: [<handle>]`），不再说「需要在场的追者」。
- `unknown_entity ... not in the current scene` 对刚逃走的人不成立：拒绝文案要区分「不在场」和「刚从这里跑掉、还追得上」。
- 契约 §143.13；§143.12 加带日期的注。

## Not in scope

- 街面/楼梯这种书上没有的地点（扁平地点模型，记忆 `flat-locus-model-punishes-detail`）——本票只让追逐开得了，不造新场景。

## Acceptance

- pytest（Corbitt 夹具）：Corbitt 逃跑 + 同回合 `apply npc to: away` + narrate；下一回合玩家 `chase:start target: Walter Corbitt` → 追逐开在当前场景，slots `[investigator pursuer, corbitt quarry]`；再下一回合（玩家没追）→ 才是 `unknown_entity`。
- 无 target 的 `chase:start` 在那一回合 → `needs` 的 `options` 含 `walter-corbitt`。
- 变异：把「`to` 结束窗口」改回去，第一条用例逮住。
