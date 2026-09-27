Status: landed（合入集成分支 claude/npc-as-actor-20260926 @ 5c6c46519，2026-09-26；证据段按工单 17 worker 的遥测核查修正：书记员没出拳，出拳的是 KP，见工单 19）
Spec: docs/specs/npc-acts-first.md（第九节「C4 桌」）

# 17 — 战斗里玩家说的话不一定是一拳

## 证据

C4 T8：战斗进行中，玩家说「钱呢？你说的二十块，现在就给我。」正文写「你的拳头从他举起的胳膊外面擦过去」——玩家没有声明出拳。**更正（worker 按遥测核查）：** 书记员没有绑攻击——compile 判 `act: none` 0.91 把攻击候选判掉了；出拳的是 KP 自己（见工单 19）。本票仍然成立的部分是书记员一侧的同类漏洞：`act` 没过闸（低于闸或 unclear）时，攻击会落到 route 的 need 问题，一个 `now` 就能在没读玩家声明的情况下绑定攻击；逃跑步骤则根本没有 compile 读者。同桌 T9 的题外话「我其实是个大学生」也被 resolve 了一次。

## Scope

- 会话里投资者自己回合的攻击候选（`candidates.ts` 的 `sessionCandidates`，投资者侧）只有在 compile 的 `act` 特征判为 combat（或 route 的 need 问题明确选中攻击）时才绑；一句要钱、问话、题外话在会话里的路由结果应是「不攻击、把回合交给 KP」（KP 可以用 `hold`/社交检定/`combat:end` 处理），而不是默认出拳。
- 会话视图给投资者发的 `combat:attack` 行仍在（KP 可用），只是书记员不再对非攻击声明自动绑它。
- 契约 §135 加带日期的注；§143.16 记这条。

## Not in scope

- NPC 侧（§143.4 已经不再默认攻击）。

## Acceptance

- loop 用例：战斗中玩家声明「钱呢？现在就给我」→ 无 `resolve:combat:attack` 的 bind 行，回合交给 KP；声明「我又是一拳」→ 照旧绑攻击。
- 变异：把 compile 判据去掉，第一条逮住。
