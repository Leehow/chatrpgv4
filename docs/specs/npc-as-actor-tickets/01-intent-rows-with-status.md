Status: ready-for-agent
Spec: docs/specs/npc-as-actor.md（D1）

# 01 — 意图行有状态：应对库、折叠、重算、投影

让 NPC 的应对库知道自己哪一行已经被执行过、哪一行悬着，让 advice 车道不再连选已做完的事，让 KP 在胶囊里看到「他试过什么、结果如何」。

## Depends on

- 无。在 `0.9.5a` 上开工。

## Scope

- `kernel-ts/npc/responses.ts`：`checked()` 给每行铸 `id`（该行 `{intent, when}` 的 digest）；库文件每行加 `status: open | attempted | done | failed | abandoned`（新库全 `open`）与 `history: [{turn, receipt?, outcome}]`。重算（`npc.responses.job` 带 `refresh`）时把旧库的行连状态一起放进 packet，模型看得到已试过的行；新库里与任何终态行 `intent` 相同的行（digest 相等）在 `checked()` 处拒绝。
- 重算条件加两条，在 `extensions/npc/index.ts` 的 refresh 判断旁：该 NPC 的账本 stance 值变化；该 NPC 有行进入终态且库中 `open` 行少于设置 `min_open_rows`（缺省 3）。现有 `no_suitable_candidate` 触发保留。
- 折叠：`kernel-ts/write/contributions.ts` 的 NPC fold 读回合收据里的 `intent_ref`（工单 02 铸）与 `apply npc intends` 变体，写行状态与 `history`。`attempted` 行在下一回合未结成终态、且该 NPC 该回合铸了别的 `intent_ref`，标 `abandoned` 并记替代行。账本条目加 `intents: [{id, status, since_turn, last_turn}]`（最近 5 行），是行状态的镜像，不是第二份真相。
- 投影：`kernel-ts/read/capsule.ts` 的 `present[].history.intents`（最近 3 行，带状态与回合）；`kernel-ts/read/offer.ts` 的 `consequence` 池加来源 `npc.intent`：每个 `attempted` 行投一条「<名>上回合试图 <intent>，结果未定，这一条还悬着」，排在失败检定之前，`from: "npc.intents"`。
- advice 车道（`runtime/jev/npc-responses.ts`）的候选集 = `open` 行 ∪ 该 NPC 的 `attempted` 行；终态行不进候选。候选集为空按现有 `no_suitable_candidate` 走。
- 契约：`docs/kernel-rpc.md` 新 §，写行的形状、状态机、重算条件、投影字段；`§17.3` 账本表加 `intents` 一行；`§12.1` 不加事件。

## Not in scope

- 铸 `intent_ref` 的操作（工单 02）；闸门（工单 03）。
- 改模型提示词里对 NPC 的措辞。

## Acceptance

- `tests/kernel/test_npc_intents.py`（走 RpcClient 真实入口）：一行被一条带 `intent_ref` 的 roll 收据折成 `attempted`，下一回合被 `apply npc intends outcome: failed` 折成 `failed`；stance 变化触发重算 job；重算 packet 含旧行与状态；与终态行同 intent 的新行被 `checked()` 拒绝；`present[].history.intents` 与 offer 的 `npc.intents` 行出现在下一回合胶囊里。
- 变异用例：删掉 fold 里对 `intent_ref` 的读取，「attempted 行进 offer」的用例必须红。
- 夹具取自 09-23 那桌（`npc/jobs/19d842aa….json` 的库与 `turns/0003–0009.json`）：给回合 3 的 item 与 cash 收据补上「End the arrangement」那行的 `intent_ref` 后折叠，该行为 `done`；回合 4–9 的 advice 候选集不再含它。夹具是那桌的字节加一个字段，不是手搓的归一化字典（记忆 `tests-must-travel-the-real-path`）。
- `npm run test:ext` 与 `pytest tests/kernel` 基线不退（基线见记忆：ext 全绿；pytest 走 `uv run --frozen`）。
