Status: landed @ bf00c2fc7（2026-09-26）；2026-09-26，真桌 D T2 发现
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

## 落地记录（2026-09-26）

- 绑定批在有 `produces` 时多一题 `produces_known`（new / known），state 带包里的 `happened` 与 `recent_speech`；不加 Jev 调用。过闸判 known → `produced: null`、不铸物件、不拔武器，行记 `produces_known: true`；长价目表不再问第二批。
- 车道说明：许可句补上「只写这样的东西：不在 at_hand、happened、recent_speech 里的」。
- 测试：全家福第二回合再拿出来 → known；上回合正文里已出现的袖珍手枪 → known、一批、不拔；没出现过 → 照旧拔出 .25 Derringer。变异（去掉这一题）4/5 失败。未真桌验证。
