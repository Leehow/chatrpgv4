Status: landed（合入集成分支 claude/npc-as-actor-20260926 @ f1cfe0192，2026-09-26；全量套件见 spec 第八节）
Spec: docs/specs/npc-acts-first.md（第七节）

# 13 — 追逐引擎要认 NPC 当猎物

## 证据

工单 10 在 Corbitt 夹具上实测：`resolve chase:start` 只有一种形状——`chaseSlots` 把在场每个有数值的对手都当追者，调查员永远是猎物，`actor` 不选追者，`target` 只在点名 NPC 时缩小追者集合，`intent` 必须是 `flee`。于是 §142.10 那条「NPC 逃了，调查员要追就 `chase:start target <npc>`」的提示，照做会开出一场**调查员被逃跑的 NPC 追**的追逐（实测 `[thomas-hayes quarry, walter-corbitt pursuer]`）。也就是说，引擎里从来没有「调查员追 NPC」这回事；NPC 逃跑的后续（工单 09 的 §142.10）一半是空的。

## Scope

- 追逐引擎（`kernel-ts/chase/*`、`kernel-ts/resolve/pipeline.ts` 的 `chase:start`）接受 NPC 当猎物：`resolve chase:start {actor: <investigator>, target: <npc>}` 开一场调查员追 NPC 的追逐；追者 = 点名的调查员（或全队，按 `actor` 缺席时的既有规则），猎物 = 那个刚 `fled` 的 NPC；`intent` 允许 `move`/`combat`/`flee` 中的合适一种（按既有意图规则，不再只认 `flee`），拒绝时的文案说清缺什么（现状那句「needs a pursuer with a stat block」列着那个人却拒他，是误导）。
- NPC 猎物的数值来自他的 profile（MOV、CON、Dodge 等，按 §136 的形状），缺则 `needs`，不缺省。
- 追逐的结果对 NPC 猎物：`escaped` → `apply npc to: away`（去向由 KP 或 03 的行动定）；`caught` → 回到战斗或按 §11.5 的追逐结束规则。
- 工单 10 改过的 §142.10 提示改回真话：「要追，`resolve chase:start actor:<investigator> target:<npc>`」。
- 契约 §143.12；§11.5 追逐段加带日期的注。

## Not in scope

- 03 的 `pursue`（NPC 追调查员，那个形状引擎今天就有）；追逐规则本身的改动。

## Acceptance

- pytest（Corbitt 夹具）：Corbitt 逃跑后调查员 `chase:start target: Walter Corbitt` → 会话 `chase` 的 slots 是 `[thomas-hayes pursuer, walter-corbitt quarry]`；跑到 `escaped` 或 `caught` 各一例；缺 MOV 的 NPC → `needs` 点名字段。
- 旧形状不变：调查员逃、NPC 追的用例（工单 10 的）照过。
- 变异：把猎物角色判断改回「调查员永远是猎物」，第一条用例逮住。
