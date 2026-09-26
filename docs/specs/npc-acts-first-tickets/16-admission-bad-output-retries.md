Status: ready-for-agent（2026-09-26，真桌 C3 T3 发现；不在本 spec 主线，顺手立票）
Spec: docs/specs/npc-acts-first.md（第九节「C3 桌」）

# 16 — 准入车道的坏 JSON 重试一次，不拒玩家的行动

## 证据

C3 T3：玩家「照他脸上一拳」，准入车道（§32，deepseek-v4.1-flash）2.1 s 返回但 `bad_output: JSON parse failed at position 36`，宿主把这次 resolve 拒成「The action review is unavailable, so this action cannot be settled now」。KP 于是把一场没有掷过骰的打斗写进正文（校验器 `player_agency`），整回合零收据。同一个模型的生成车道（§139.2）对坏输出是重试一次再放弃。

## Scope

- 准入车道对 `bad_output` 重试一次（同一 deadline 内，带一句「上一次不是合法 JSON」），第二次仍坏才 `unavailable`；遥测记 `attempts`。
- `unavailable` 时对**调查员自己的声明**（compile/route 选中的玩家行动）不拒绝：按 §32 的已有规则退到 `review_pending`/晚准入，或按 typed 证据准入，而不是让回合无机制。具体走哪条按 §32.12 现状定，handoff 说明。
- 契约 §32 加带日期的注。

## Acceptance

- ext 用例（假 provider）：第一次坏 JSON、第二次好 → 准入正常；两次坏 → `unavailable` 且玩家的攻击仍被结算（骰子落地），遥测 `attempts: 2`。
- 变异：去掉重试，第一条逮住。
