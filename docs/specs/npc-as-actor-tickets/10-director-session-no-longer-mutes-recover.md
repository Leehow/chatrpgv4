Status: ready-for-agent
Spec: docs/specs/npc-as-actor.md（D5）

# 10 — 导演：session 不再屏蔽 RECOVER

`score()`（`kernel-ts/read/director.ts:178`）有活跃 session 就返回 SUBSYSTEM，四个 RECOVER 信号在战斗里永不打分。排在 01、02 之后做，否则只是换个节拍名。

## Depends on

- 01、02（offer 的 consequence 池有意图行可投）。

## Scope

- `score()`：session 覆盖改为 SUBSYSTEM 得 1.0 并进入正常加权，其余节拍照常打分并进 `scores`（前三）；`override` 字段保留为 `session`，`reason` 不变。`dying`、`fumble`、`pending_choice` 三个覆盖不动。
- `directorOffer` 的 SUBSYSTEM 顺序保持 `consequence, pressure, person`；`consequence` 池已含 01 的 `npc.intents` 行。
- `content/director/director-graph.json` 不改分值；契约 §13.3 与 §34 D3 加一句。
- 遥测 `director` 行加 `scores` 里是否含 RECOVER，供工单 11 统计。

## Not in scope

- 为战斗另造 `blocked_attempts`（对抗骰无整数阈值，保持）。

## Acceptance

- `tests/kernel/test_director_scoring.py` 加用例：session 活跃且 `repeat_input` 为真时 `scores` 含 RECOVER 且 `beat` 仍为 SUBSYSTEM；`hit_rules` 不变。
- 变异用例：把提前返回加回去，该用例必须红。
- 现有 `test_director_scoring.py` 与 `test_turn_floor.py` 全绿。
