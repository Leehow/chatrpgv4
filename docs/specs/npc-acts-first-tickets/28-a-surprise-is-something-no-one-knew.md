Status: ready-for-agent（2026-09-26，真桌 D T2 发现）
Spec: docs/specs/npc-acts-first.md（D10；第九节「D 桌」）
Contract: §139.27（新）；修 §139.19

# 28 — 意外只给桌上没人知道的东西

## 证据（真桌 `npc-acts-d` T2）

威胁骰 tense 11 = escalates + surprise。生成器写 `produces`「折好的别墅租房广告和一支钢笔」——那张广告 T1 就在他手底下、KP 写过，钢笔也在桌上。绑成桌上物件，记成「意外」。用户要的是「掏出出乎意料的东西」；已经摆出来的不是意外。

## Scope

1. 绑定批（`npcActBatch`，不加额外的 Jev 调用）加一题：`produces` 说的东西，是不是桌上已经见过、或已知他有的（读包里的 `at_hand`、`happened`、`recent_speech` 与本回合 `state`）——开放判断交给 Jev，不写词表。过闸判「已见过」→ 不是意外：不铸物件、不走 draw，行里记 `produces_known: true`，行动照常绑定。
2. `content/setup/npc-act.md` 的许可句补半句：只写桌上没人知道他有的东西。
3. 契约 §139.27；§139.19 加带日期的注。

## Acceptance

- ext：包里 `at_hand` / `happened` 已有那样东西，Jev 夹具判「已见过」→ 无 `_produces`、无 draw，行带 `produces_known`；判「没见过」→ 照旧。
- 变异：去掉这一题 → 第一条逮住。
