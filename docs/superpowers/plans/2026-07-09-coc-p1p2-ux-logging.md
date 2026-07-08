# COC P2 UX+记录 修复实现计划（波次 5）

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** 修 P2-1（奖励骰展示不透明）、P2-3'（角色列表 registry）、P2-4'（跨模块 API 索引）、P2-5（PDF 图片/handout）、P2-6（flush 可靠性，保守）、P2-7（日志扩展）。

**Architecture:** 按低风险先行：(1) P2-1 formatter 展示分量；(2) P2-3'/4' 小 helper；(3) P2-7 日志扩展；(4) P2-5 handout 接通；(5) P2-6 flush 可靠性（保守，不并行化主流程）。

## 决策与默认（controller）

1. **P2-1**：`format_percentile_result` 默认展示十位/个位构成（即便无 modifier），极简模式可折叠。
2. **P2-3'**：加 `list_investigators(coc_root)` 扫 `.coc/investigators/*/character.json`。
3. **P2-4'**：加跨模块 `coc_api_index()` 聚合（coc_roll + 选定的 coc_rules 公共函数）；不加 `/coc-help` 命令（那是 client 层，超出脚本范围）。
4. **P2-5**：handout 注册表读通——clue/scene 加可选 `handout_asset_id` 结构化字段；clue_reveal 事件带 asset ref；narration contract 在 player_visible 时提示渲染。
5. **P2-6 保守**：只做 flush 可靠性（ack/超时/健康检查），**不**强行并行化主流程 director/enrichment/rules（风险高，章程明确降级）。`completion_required_before_narration` 保持 False（narration 不阻塞），但加 pending-stuck 健康检查 + 超时强制 flush。
6. **P2-7**：NPC 生成 + clue 选择加 candidate_counts/rejected_examples trace（仿 storylet）；live runner 补写 audit.jsonl 的 spoiler_reveal。

## Global Constraints
同前。关键接线点（已核实）：
- `coc_roll.py:format_percentile_result` L169-198；opaque 分支 L179-182。
- `coc_state.py` 无 list 函数；investigators 在 `.coc/investigators/<id>/`。
- `coc_roll.py:public_api_index` L201-229；其它模块无 index。
- `coc_scenario.py:create_scenario_skeleton` L81-93 写 handout-assets.json；无代码读。clue_reveal `coc_director_apply.py:726-728`。
- `coc_async_recorder.py:spawn_background_flush` L188-200（fire-and-forget）；`completion_required_before_narration` runner L554/563/593 硬编码 False。
- 日志：storylet-scheduler 有 candidate_counts（`coc_director_apply.py:286-302`）；NPC/clue 无；audit.jsonl 仅 `coc_playtest_harness.py:4075`。

---

## Task 1: P2-1 — 奖励骰展示分量
- Modify `coc_roll.py:format_percentile_result` (L169-198): 默认展示十位/个位构成（`{roll} = 十位 {tens} + 个位 {units}`），即便无 modifier。保留极简模式参数。
- Test: test_roll.py 加无-modifier 展示分量的测试。
- Sync + commit `feat(coc): show tens/units breakdown in percentile result (P2-1)`.

## Task 2: P2-3' — list_investigators registry
- Create/modify `coc_state.py`: `list_investigators(coc_root) -> list[{investigator_id, name, occupation, ...}]` 扫 `.coc/investigators/*/character.json`。
- Test: test_character.py 或 test_state.py。
- Sync + commit `feat(coc): add list_investigators registry (P2-3')`.

## Task 3: P2-4' — 跨模块 API 索引
- Modify `coc_roll.py`: 加 `coc_api_index()` 聚合 coc_roll public_api_index + 选定 coc_rules 公共函数（half_value/fifth_value/difficulty_target/success_level/damage_bonus_build/movement_rate）。或新模块 `coc_api.py`。
- Test.
- Sync + commit `feat(coc): cross-module helper API index (P2-4')`.

## Task 4: P2-7 — 日志扩展（NPC/clue trace + live audit）
- Modify `coc_npc_persona.py` generation log + `coc_director_apply.py`: NPC 生成记录 candidate 信息（已有 generation_log，加 rejected/why-not 若有）；clue 选择加 candidate trace（仿 storylet scheduler）。
- Modify `coc_live_turn_runner.py`: live 路径补写 audit.jsonl 的 spoiler_reveal 事件。
- Test.
- Sync + commit `feat(coc): extend NPC/clue decision logging + live audit.jsonl (P2-7)`.

## Task 5: P2-5 — handout 接通
- Modify schema (story-graph-schema.md): clue/scene 加可选 `handout_asset_id`。
- Modify `coc_director_apply.py:clue_reveal` (L726-728): 带 asset ref（从 clue 的 handout_asset_id）。
- Modify `coc_narrative_enrichment.py` 或 narration contract: player_visible handout 提示渲染（Codex 绝对路径 Markdown 图；ZCode 标题+摘要，符合 sync drift）。
- Apply to white-war（若有 handout 素材；否则只接机制 + 文档）。
- Test + sync + commit `feat(coc): wire handout assets into clue reveal + narration (P2-5)`.

## Task 6: P2-6 — flush 可靠性（保守）
- Modify `coc_async_recorder.py`: spawn_background_flush 加可选 ack/超时（不阻塞 narration，但记录 flush 状态）；加 `pending_stuck_check`（pending 超阈值/超时标记）。
- Modify `coc_live_turn_runner.py`: 用 pending_stuck_check 在 maintenance 路径触发强制 flush。
- **不**并行化主流程（章程降级）。`completion_required_before_narration` 保持 False。
- Test + sync + commit `feat(coc): reliable handout flush with stuck-check (P2-6, conservative)`.

## Task 7: 波次 5 全量回归

## Self-Review
覆盖 P2-1/3'/4'/5/6/7。范围边界：P2-6 不并行化主流程；P2-4' 不加 client 层 /coc-help 命令；P2-5 若 white-war 无 handout 素材则只接机制+文档。
