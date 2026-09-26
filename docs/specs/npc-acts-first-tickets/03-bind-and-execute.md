Status: ready-for-agent（2026-09-26 用户三处按推荐拍板：快模型、书记员执行、应对库退役）
Spec: docs/specs/npc-acts-first.md（D3、D4）

# 03 — `npc.act.options` 与绑定执行

## Scope

- 内核读 `npc.act.options {campaign, name}`：D3 表里此刻对他成立的方式与各自的闭合参数选项（目标只列在场对手/在场的人，技能只列他 profile 或钉过的），全部来自既有路径，不新造结算。
- 单循环新步骤 `npc_act`（`runtime/jev/`）：包（01）→ 生成（02）→ Jev 闭合绑定（方式 + 参数；置信闸同 §135.2；unknown/none → `intention_only`）→ 书记员 `direct` 执行；收据带 `intent: {ref, text, outcome}`、`basis.generated: true`。
- 触发：
  - 会话中轮到 NPC：替换 `candidates.ts:176–215` 的常备动作段——`attack` 不再是书记员默认；`hold`/`flee` 不再直接返回；§138.14 那条随之删除。`pending_defense` 段不动。
  - 会话外：玩家声明 `settled` 之后、compose 之前，对本回合被作用的在场 NPC 各一次（收据对象是他，或 compile addressee 命中他），一回合最多 `npc_act.max_per_turn`（命名默认值 2）。
  - `overRun` 已过 → 跳过，遥测 `skipped_budget`。
- `intention_only` = `apply npc {name, intends: act, outcome: attempted}`，走 §138 已有的写入面。
- 数值：规则缺省（§135.28）；本线无 band-then-roll。

## Not in scope

- 语义同一判断与重问（04）；advice 退役（05）；KP 提示词（06）；legacy 引擎。

## Acceptance

- loop 用例（`tests/extension/single-loop-*.test.mjs`，夹具端口）：
  - 战斗中轮到诺特，夹具行「朝楼梯口喊有人打人」→ Jev 夹具选 `check{skill: 他的某技能}` 带 spend_turn → 收据 roll + `passes_turn`，`intent.text` 等于那行；回合转到调查员。
  - 同一行 Jev 答 `none` → `apply npc intends` 收据 `attempted`，不掷骰。
  - 会话外玩家一拳打中诺特（收据对象是他）→ `npc_act` 跑一次；打向别人 → 不跑。
  - 一回合三个被作用的 NPC → 只跑 2 个，遥测记第三个 `skipped_cap`。
- 变异：删掉「被作用」判断（对所有在场 NPC 都跑），max_per_turn 用例必须逮住；删掉 `basis.generated`，投影用例（05）逮住。
- pytest：`npc.act.options` 在会话外不含 `attack`/`flee`，在会话中轮到他时含且目标只列对手。
