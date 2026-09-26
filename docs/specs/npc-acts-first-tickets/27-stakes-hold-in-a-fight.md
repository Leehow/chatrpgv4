Status: ready-for-agent（2026-09-26，真桌 D T4/T7 发现）
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
