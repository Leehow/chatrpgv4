Status: ready-for-agent
Spec: docs/specs/npc-as-actor.md（D2）

# 02 — NPC 的一轮是一次操作：单循环 NPC 步骤、`other` 不缺省、hold/flee 出收据、`apply npc intends` 兜底

NPC 自己的回合不再以散文结束。模型为 NPC 选的每件事都变成一次操作，铸一条带 `intent_ref` 的收据；引擎结算不了的事也留一条账。

## Depends on

- 01（`intent_ref` 指向的行 id 与状态机）。

## Scope

- 单循环（`docs/specs/pi-native-single-loop.md` 的 NPC 自由选择步骤，实现见 `runtime/jev/candidates.ts` 与 policy）：当 session 的 `turn_of` 是 NPC 且 `standing_action` 为 null，候选 = 该 NPC 的应对库候选（01）∪ session 发行的闭合动作（attack 带目标与武器、maneuver、flee、other、cast）。模型（或 Jev，当候选是闭合行时）选一行，宿主绑参数执行，收据带 `intent_ref`。选中应对库行而该行没有引擎动作时，走下面的兜底。
- 收据字段：`kernel-ts/resolve/*` 与 `kernel-ts/apply/*` 铸的 roll / delta / session / npc / threat / person 收据接受可选 `intent_ref: string`（行 id），原样落盘，mechanics 投影不画它（Keeper-only）。
- `other`（`kernel-ts/combat/engine.ts:605,607`）：删除 `|| 'Spot Hidden'` 与 `|| 50`。NPC 行动者的技能与目标值只来自 `npcProfile`（书上或 `apply npc skill/archetype` 钉的）；缺了报 `needs`，`details.needs.field: "skill"`，`fix` 指向 `apply npc skill {name, skill: {name, value}, why}`。调查员行动者不变（表上有值）。
- `hold`：走现有的 `apply npc action: hold`（§11.5.3 的 Keeper 覆盖，本回合有效），收据带 `intent_ref`；不新造第二条 hold。`flee`：走 `resolveFlee`，同一批里要求（或由宿主补）`apply npc to: away`；去向与追逐见工单 09。
- `apply npc` 新变体 `{kind: "npc", name, intends: "<一句>", outcome: "attempted" | "done" | "failed" | "abandoned", intent_ref?, why}`：只写账本行状态（01 的 fold），不写任何 `world.*` 数值；与 `to`/`stance`/`dead`/`skill`/`archetype`/`conditions` 互斥（同批分两条 effect）。收据 `npc:<slug>-t<n>-c<k>`，`visibility: keeper`，事件 `npc-changed`（`data.intends`, `data.outcome`）。`checked` 长度上限同 responses 行（400 字符）。
- 工具表（`extensions/kernel/tools.ts` 的 `apply npc` 描述）与 `prompts/keeper.md` 的 present 段各加一句：NPC 轮到自己时做的事必须落一条收据；引擎结算不了的用 `intends`/`outcome` 记账；上回合 `attempted` 的行这回合先结。措辞是英文、Keeper-facing，不出现在玩家文本。
- `kernel-ts/combat/standing-words.ts` 注释与契约 §11.5.3：`hold`/`flee` 是「交给 KP 选择，选择落收据」。

## Not in scope

- 闸门（03）。NPC 在 session 外行动（04）。NPC 开局（05）。

## Acceptance

- `tests/kernel/test_npc_round_operation.py`：NPC 回合 `other` 无技能时 `needs` 且不掷骰；钉了 `skill` 后掷且收据带 `intent_ref`；`hold` 铸 `npc` 收据；`apply npc intends` 写行状态、不动 `npc_resources`、与 `to` 同 effect 报 `invalid_params`。
- `tests/extension/npc-round.test.mjs`：单循环里 NPC 回合的候选集含应对库行与 session 动作，模型选行后宿主执行并铸收据；NPC 回合结束时该回合至少一条 `intent_ref` 收据或一条 `intends` 收据，否则宿主记 `lane: "npc-round", missing: true`（遥测，不拦，03 再拦）。
- 变异用例：把 `|| 50` 加回去，「无技能时 needs」必须红。
- `check:kernel`、`npm run test:ext`、`pytest tests/kernel` 基线不退。
