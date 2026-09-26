Status: ready-for-agent
Spec: docs/specs/npc-as-actor.md（D3）

# 03 — 同行不连选：宿主闸门与遥测

同一个 NPC 上一回合交了行 X，这一回合又交 X，而 X 中间没有结成终态，宿主退一次。比的是行 id，不是文本。

## Depends on

- 01、02。

## Scope

- `extensions/kernel/index.ts`：在 NPC 回合的交付前（与 floor steer 同一处，`deliveryFix`），读本回合铸的 `intent_ref`（含 `apply npc intends` 的）与该 NPC 上一已关回合的 `intent_ref`；相同且账本里该行仍是 `attempted`（未 `done`/`failed`）→ `deliveryFix` 种类 `npc_repeat`，steer 文本点名：「<名> tried <intent> last turn and it has no result on the ledger: settle it (done or failed) or choose another row」。一回合只退一次；第二腿照收（与 floor 的 D4 规则同）。
- 遥测 `lane: "npc-repeat"`：`{turn, npc, intent_ref, steered, second_leg: changed | same | none}`。
- 玩家侧不动；§113 D 的字面去重不动。

## Not in scope

- 任何 prose 比较；任何类别表。

## Acceptance

- `tests/extension/npc-repeat.test.mjs`：连续两回合同 `intent_ref` 且无终态 → 一次 steer；第二腿换行 → 收；第二腿仍同行 → 照收并记 `second_leg: same`；中间有 `failed` 收据 → 不 steer；不同 NPC 同 intent 文本 → 不 steer（id 不同）。
- 变异用例：把比较从 `intent_ref` 改成比 `intent` 文本，「不同 NPC 同文本不 steer」必须红。
