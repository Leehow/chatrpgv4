# W1 桥真实游玩证据 — 2026-09-02

> **Status:** 桥机制在真实游玩中被证明在场；**非空公开效果绑定待自然发生**。
> **Track:** `ACTIVE_IMPLEMENTATION_TRACK=pi-coc`
> **Run:** `.coc/playtests/w1-bridge-live-20260902/`（已停止，战役保留）
> **Spec:** [pi-coc-cross-graph-wiring.md §5 W1 门 5](../specs/pi-coc-cross-graph-wiring.md)

## 方法（照 Pi-Coc 验收法）

真 `pi-coc --mode rpc`（launcher `plugins/coc-keeper/pi/bin/pi-coc`，`--thinking low`），
KP 为 `xai/grok-4.5`（coc-agent 会话配置），本会话当唯一玩家，一次一句自然回复，
从头到尾无脚本。驱动 `play_rpc_driver.py` 只做传输：发玩家输入、记事件；
不结算、不渲染、不决策。模组：The Haunting（starter）。

## 运行量

- 43 条玩家回复 / 44 条 KP 交付（`artifacts/battle-report-evidence.json`：
  dialogue_role_counts），25+ 个收尾回合；
- `rules.settle` 调用 6 次，成功 5 次：`decision:coc7:core-check:ordinary-check` ×3
  （侦查/攀爬）、`decision:coc7:sanity:check` ×2——**全部 graph-owned 族**；
- 理智从 60 → 56（床自行挪动、干尸暗室、理智大失败各真实结算）；
- 战报导出：`artifacts/battle-report.md` + `battle-report-evidence.json`，
  分类 INCOMPLETE（暂停局无结构化结局，`ending_and_development` 维度因此
  FAIL——如实记录）；dice / transcript / character 维度 PASS。

## 桥在场证据

1. **字段真实挂载**：graph-owned 结算对应的玩家可见效果上出现
   `rule_effect_refs`。示例：SAN 标量效果
   `turn-effect-v1:5c881efd…`，`source_decision_id: roll-san-bed-moves-v1`，
   `rule_effect_refs: []`（`logs/turn-finalizations.jsonl`）。
2. **空列表是正确的**：core-check 与 sanity 两族在十族图中**没有公开 emits
   效果**（其效果集为 keeper-only 或无）；桥按设计挂空引用，不是丢字段。
3. **守护在场**：全程无 `luck-spend-mutate` 或任何 keeper-only 效果进入
   玩家可见渲染。
4. **位等价未破**：旧收据形状不带新字段；`_stable_effect_id` 摘要输入未动
   （工作树 12 测试 + 主线回归在合并时已验证）。

## 未证明的（如实记录，不补造）

- **非空 `rule_effect_refs` 未在真实游玩出现**：三条已画的
  `renders-settled-output` 边（healing 三效果）需要「HP 伤害 → 急救/医疗结算」
  的自然链条；本局唯一的物理伤害事件（梯子坠落，攀爬失败）被 KP 判为轻微
  擦伤，未产生 HP 结算；本局也未到结局（development 族）。
- 社交易的 `pc-refusal-penalty` 未出现：两次对诺特的加价施压他都让步了——
  制造拒绝属于脚本行为，违反验收法，不做。
- 因此：桥的**机制**被真实游玩证明；**非空公开效果 → 渲染段落的指认**待
  下一次自然出现的伤害结算或战役结局时补记。该缺口已写进规范实现日志。
- W1 第二步的测量进一步收窄了路径：账本中 19 个 `no-consumer-yet` 效果
  （chase 6 / development 5 / magic 7 / social 1）的共同原因是其结算执行器
  只返回嵌套收据、无顶层 `player_state_receipt`，`rules.settle` 调用不产生
  `_project_state_deltas` 可渲染的东西——只有 healing 三适配器返回顶层收据，
  所以真边只有 3 条。未来要让这些族上线，需要的是收据投影层的独立切片，
  不属于本接线规范。

## 附带观察（不属本切片）

- 楼梯坠落未落 HP 是 KP 语义裁量（合理），但意味着「自然伤害」在轻险场景
  罕见；healing 边的真游玩证据本来就需要更重的险情或结局成长。
- KP 全程使用 `coc_discover` / `scene.context` / `rules.context` 正常发现面，
  无 harness 干预；两次重试失败后自行修正参数（收据可操作）。
