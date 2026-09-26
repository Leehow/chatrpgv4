Status: ready-for-agent（2026-09-26 用户追加；「自己的表 vs 幸运骰」一处待确认，按推荐先做自己的表）
Spec: docs/specs/npc-acts-first.md（D9）

# 09 — 无准备局面的威胁骰

## Scope

- 规则数据 `content/rulesets/coc7/rules-json/npc-stakes.json`（进 §136 目录与校验器）：`contract_id`、`note`、`rungs`（有序，每档 `{name, severe_at_most, escalates_at_most, lines: {severe, escalates}}`，`lines` 是给生成器的程度句，英文数据、投影时随 play_language 走两条腿的规则）、`base_by_disposition`（倾向词 → 档）、`base_by_archetype`（原型 → 档）、`default_rung`、`shifts`（`attacked_this_turn`、`hp_at_most_half`、`table_clock_past_half`、`stance_friendly` 各 ±1，数字在表里）。内核写零阈值。
- 内核 `kernel-ts/npc/stakes.ts`：`rollStakes(graph, world, node, turn, records)` → 判「无准备」（01 的 `constraints` 为空）→ 档 = 基础档 + 位移（夹在首尾档之间）→ d100（走内核既有的种子 RNG，测试可定）→ `roll` 收据 `{kind: 'roll', family: 'stakes', actor: <handle>, rung, shifts: [名], roll, outcome, visibility: 'keeper'}`，不进玩家的机制卡（§16.5）；每人每回合最多一条（已有则复用）。
- 01 的包加 `stakes: {rung, outcome, line} | null`（`null` = 有准备或本回合没掷）；`situation.ts` 小改（01 合入后）。
- 触发点由 03 的 `npc_act` 步骤在生成前调用（03 的 worker 接口：`npc.situation` 内部调 `rollStakes` 并写收据，或单独方法 `npc.stakes`——二选一，推荐前者，包里一次拿全）。
- 契约 §139.8。

## Not in scope

- 武器允许（03）；没有 NPC 在场的随机事件（导演层，另立 spec）；band-then-roll 的 Jev 选档（本线没有它）。

## Acceptance

- pytest：Corbitt 的战斗里（`test_npc_standing_action.py` 的夹具），投资者打中他一次后读包：`stakes.rung` 比基础档高一档（`shifts` 含 `attacked_this_turn`），收据 `family: stakes` 在 `table.status` 的收据里且 `visibility: keeper`；玩家侧的机制卡（`mechanics`）里没有它。
- 有准备的情形（给他一条 Mod 接触行或预定反应）→ `stakes: null`，无收据。
- 固定种子下 outcome 可预期（severe / escalates / nothing 各至少一个用例，靠种子挑）。
- 变异：把 `attacked_this_turn` 位移删掉，第一条用例必须逮住；把 `visibility: keeper` 删掉，机制卡用例逮住。
