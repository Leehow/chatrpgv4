Status: landed @ 3febb0d6e + 9cc3939c2（2026-09-26）；2026-09-26，真桌 D T4/T7 发现
Spec: docs/specs/npc-acts-first.md（D9、D10；第九节「D 桌」）
Contract: §139.26（新）；修 §139.8 的上调

# 27 — 打架里的人威胁档不回落

## 证据（真桌 `npc-acts-d`）

KP 给诺特补了普通人档，性格 `avoids_fighting` → 底档 calm（`npc-stakes.json` 的 `base_by_disposition`）。上调只有 `attacked_this_turn`、`hp_at_most_half`、`table_clock_past_half`。T4（战斗里他自己的回合，上回合刚挨过一拳）与 T7（刚被追打、鼻子出血）都是 calm，意外概率 10%。用户的 D10 是「威胁度越高越容易出意外」；被追着打的人不是 calm。

## Scope

1. `npc-stakes.json` 的 `shifts` 加结构上调（数据，不写死在代码里）：他在一个和调查员同在的战斗 session 里；或上一回合（最新已提交回合）有收据以他为对象的攻击/伤害。各 +1（是否叠加由你按表的现有规则定，写进契约）。
2. `kernel-ts/npc/stakes.ts` 读这些新条件；表校验照旧。
3. 契约 §139.26；§139.8 加带日期的注。

## Acceptance

- pytest：avoids_fighting 的人在战斗 session 里（这回合没挨打）→ 至少 tense；上回合挨过打、这回合不在 session → 至少 tense；什么都没有 → calm 照旧。
- 变异：去掉新上调 → 第一条逮住。

## 落地记录（2026-09-26）

- `npc-stakes.json` 的 `shifts` 加 `attacked_last_turn`、`in_fight_with_investigators`（各 +1）。
- **合并前我裁定：** 这回合挨打、上回合挨打、在和调查员打的战斗里，是同一个维度（对他的暴力），一起只动一档：数据里 `shift_groups: {violence}`，三条标 `group: "violence"`，每组取最大一档、组间相加再夹紧。第一版三条相加，一拳开打的人直接从 tense 跳到 lethal（意外 45%、严重 30%），D10「越危险越容易出意外」的梯度就没了。
- 表校验更严：未声明的组、少于两条的组、组里有升有降、空的组说明，都拒。收据仍列出每条成立的上调。
- 测试：`test_npc_stakes.py` 45；一拳开打 +1 不是 +2、三条同时成立仍 +1、D T4 形状读 tense；原先的种子全部恢复。变异（组内相加）11 条失败。未真桌验证。
