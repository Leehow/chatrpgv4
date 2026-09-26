Status: landed（合入集成分支 claude/npc-as-actor-20260926 @ f1c7eb6ed，2026-09-26；全量套件见 spec 第八节）
Spec: docs/specs/npc-acts-first.md（第七节）

# 12 — steer 用完之后被内核拒绝的隐式稿不许掉

## 证据

工单 11 做正文标记闸门时发现的既有缺口：一回合只有一次 steer（§135.11）。steer 已经用掉之后，KP 交一份隐式稿（散文收尾，不显式调 `narrate`），内核以 `repeated_line`（§113 D）或 `intent_result_owed`（§138.7）拒掉它，宿主发不出修复指令，稿子就丢了——回合可能无交付（§135.11 addendum 对 `repeated_line` 的那次修只救了「被拒的第二稿退回第一稿」这一种形状）。工单 11 只给 `markup_in_prose` 做了「扣住稿子、steer 用完就原样重发一次」。

## Scope

- 把 11 在 `extensions/kernel/index.ts` 里做的三件事（扣住被拒的隐式稿；steer 用完时原样重发一次，遥测 `*_resent`；拒绝预算兜底也重发一次）推广到内核对隐式稿的每一种「一回合拒一次」的拒绝：`repeated_line`、`intent_result_owed`、`markup_in_prose`，按 `details.reason` 分派，不按文案匹配（记忆 `assertion-must-not-depend-on-removable-string`）。
- 内核侧：这三种拒绝在同一回合第二次到达时的行为要一致——`markup_in_prose` 已是「第二次照收 + warnings 行」；`intent_result_owed` 已是「第二次照收 + warnings 行」（§138.7）；`repeated_line` 是每次都拒（台词逐字重复不该放行）——所以 `repeated_line` 的重发不成立，改为：steer 用完后被 `repeated_line` 拒的隐式稿退回被丢的第一稿（§135.11 addendum 已有的形状）。契约把三种的第二次行为并排写清。
- 遥测：每种丢稿路径记 `lane: delivery ok:false reason`，`turn_close` 行的 `unsent_fix` 覆盖三种。
- 契约 §139.11。

## Not in scope

- `ask` 的文本；新的拒绝种类。

## Acceptance

- ext 用例（真 harness，每种一个）：steer 已用掉 + 隐式稿被 `intent_result_owed` 拒 → 原样重发一次 → 交付带 warnings；被 `repeated_line` 拒 → 第一稿交付；被 `markup_in_prose` 拒 → 已有用例不变。三种都断言回合有交付、`turn_close` 无 `unsent_fix` 之外的丢稿。
- 变异：去掉按 reason 的分派（只留 markup），`intent_result_owed` 用例必须逮住。
