# COC P1 节奏+文字 修复实现计划（波次 4）

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** 修 P1-1（过渡场景拖长）、P1-2（无行动点也停）、P1-3（roll density 不合并）、P1-7（prose guard 不全+不通电）、P1-8（语言能力不通电）、P2-2（crit/fumble 无条件 high）。

**Architecture:** 按低风险先行：(1) P2-2 crit/fumble 按动作赌注校准冲突级别；(2) P1-7/P1-8 把已实现的 guard/language 通电到 narration contract 强制钩子；(3) P1-2 stop 时 handle 空→反压继续推进；(4) P1-3 跨回合 roll 密度合并；(5) P1-1 进度契约/beat 上限。

## 决策与默认（controller 拍板）

1. **P2-2**：crit/fumble 的 conflict_level 改由"动作赌注"（`risk_level` 结构化字段）决定——low 风险动作的 crit/fumble 触发 low/medium beat，high/lethal 才 high。difficulty 仍不升冲突（保持现状）。
2. **P1-7/P1-8**：guard 和 language 是 advisory（SKILL 让 LLM "mentally apply"）。通电方式 = 在 narration contract 层强制：director/enrichment 在生成含外语对话或 prose 的 narration 时，把 guard/language 的结构化结果（passed/tier）写进 `narrative_directives`，contract 校验 `passed`。不强行在 runner 同步调 guard 扫全文（性能风险）；用 contract 字段强制 narrator 遵守。
3. **P1-2**：runner 在 `immediate_handles` 为空且非真分叉时不停——继续推进；或在 stop_actionability 空 `requires_keeper_rewrite` 时反压。选后者（反压回路：空 handle 触发继续推进）。
4. **P1-3**：引入跨回合 roll-density 记忆（按 `(skill,kind,axis)` 记最近 N 回合），同质重复达阈值合并为 montage 单检定。保守：只合并玩家 action_atoms 的跨回合同质，导演检定（SAN/danger/clue）暂不纳入（避免改变规则语义）。
5. **P1-1**：让 runner/director 读 `compression_budget.max_beats`，超限强制 emit `must_change_state` 的 scene_exit_pressure。同时扩 `_BRIDGE_SCENE_KINDS` 识别（加 `exploration`？或按 pacing_role 识别）。保守：加 beat 上限读取，不过度改 scene_type 识别（exploration 不全是过渡场景）。
6. **spec 行号修正**：post-P0 偏移，本 plan 用探查确认的当前行号。

## Global Constraints

- Dual-Track + Constitution + 测试门禁（同前）。
- 关键接线点（已核实，当前行号）：
  - `coc_narrative_enrichment.py:infer_storylet_trigger` fumble L932/critical L947 硬编码 "high"；`risk_level` 在 L957（risky_failure 用）。
  - `coc_narrative_enrichment.py:build_stop_actionability_contract` L407 `requires_keeper_rewrite`（runner 从不读）。
  - `coc_narrative_enrichment.py:build_action_chain_requests` L656 只看当前回合 atoms；`_apply_roll_density_guard` L629。
  - `coc_live_turn_runner.py` stop loop L480-500；`requires_keeper_rewrite` 不在 runner。
  - `coc_story_director.py:_compression_budget` L728-739（写入 directive，从不读）；`_BRIDGE_SCENE_KINDS` L57；`_scene_exit_pressure_directive` L884-924。
  - `coc_narration_style.py:guard_player_visible_text` L351-380（advisory）；短语表 L36-63。
  - `coc_language.py:render_foreign_dialogue_for_investigator` L140-202（从不被 runner 调）。

---

## Task 1: P2-2 — crit/fumble conflict 按动作赌注校准

**目标**：fumble/critical 的 `conflict_level` 从硬编码 "high" 改为按 `risk_level` 校准。

**Files:** `coc_narrative_enrichment.py:infer_storylet_trigger` (L925-951); `tests/test_narrative_enrichment.py`

- [ ] Step 1: 失败测试 — fumble on a `risk_level:"low"` 动作 → conflict_level != "high"（应为 "medium" 或 "low"）；critical on `risk_level:"high"` → "high"。
- [ ] Step 2: 实现 — 在 fumble/critical 分支，读 `result.get("risk_level")`：`{"high","lethal","severe"}` → "high"，`{"medium"}` → "medium"，否则 "medium"（crit/fumble 仍是有意义的 beat，不低于 medium）。替换两处硬编码。
- [ ] Step 3: 回归 + sync + commit `fix(coc): calibrate crit/fumble storylet conflict by action risk (P2-2)`。

## Task 2: P1-7 — prose guard 通电到 narration contract

**目标**：guard 不再纯 advisory——narration contract 携带 guard 的结构化要求（`final_output_pass.required` + 短语黑名单类别），narrator 必须遵守。同时扩充短语表覆盖（被动腔/总结腔/解释腔分类）。

**Files:** `coc_narration_style.py`（扩短语表 + contract 字段）; `coc_narrative_enrichment.py`（enrich 时注入 guard contract 到 narrative_directives）; `tests/test_narration_style.py`

- [ ] Step 1: 扩短语表 — 加被动腔（"被…所"/"为…所"）、更多总结腔（"综上所述"/"由此可见"/"不难看出"）、解释腔（"这意味着"/"换句话说"）模式。
- [ ] Step 2: 加测试 — 新短语被 audit 命中。
- [ ] Step 3: enrich 注入 — `enrich_director_plan` 把 `guard_player_visible_text` 的 contract（required pass + finding categories）写进 `narrative_directives.player_facing_style.style_guard`（确认是否已有；若有则强化 required=true）。
- [ ] Step 4: 回归 + sync + commit `feat(coc): expand prose guard phrases and wire to narration contract (P1-7)`。

## Task 3: P1-8 — 语言能力通电到 narration contract

**目标**：含外语对话的 narration contract 携带 `dialogue_comprehension` 要求——按调查员语言技能，低于 fluent 时 narrator 必须展示源语/片段。

**Files:** `coc_language.py`（已有 render 函数）; `coc_narrative_enrichment.py`（enrich 时若 scene/npc 有外语对话，注入 comprehension 要求）; `tests/`

- [ ] Step 1: 加 enrich 钩子 — 当 scene/npc 含 `foreign_language` 标记（结构化字段）时，按调查员技能算 tier，写 `narrative_directives.dialogue_comprehension`（tier + "低于 fluent 展示源语/片段"规则）。
- [ ] Step 2: 测试 — 含外语的场景，investigator 技能低 → directive 要求源语展示。
- [ ] Step 3: 回归 + sync + commit `feat(coc): wire dialogue comprehension tier into narration contract (P1-8)`。

## Task 4: P1-2 — stop 时空 handle 反压继续推进

**目标**：runner stop 时若 `immediate_handles` 空 且 非真分叉 且 未达 max_turns，不停——继续推进（让 director 在下一内回合产出抓手）。

**Files:** `coc_live_turn_runner.py`（stop loop + 读 requires_keeper_rewrite/空 handle）; `tests/test_live_turn_runner.py`

- [ ] Step 1: 失败测试 — 构造一个 handle 全空、非真分叉的 turn，断言 runner 不停在 `awaiting_player_input`（继续推进或达 max_turns）。
- [ ] Step 2: 实现 — 在 stop loop，`_should_auto_advance` 失败时，若 final_turn 的 `stop_actionability.requires_keeper_rewrite==True`（handle 空）且 `is_real_fork==False` 且 `index < max_turns-1`，则不 break，继续循环（给 director 机会产出抓手）。注意上限保护（不能无限循环）。
- [ ] Step 3: 回归 + sync + commit `fix(coc): don't stop on empty handles when not a real fork (P1-2)`。

## Task 5: P1-3 — 跨回合 roll density 合并

**目标**：跨回合同质玩家动作合并为 montage 单检定（保守：只玩家 action_atoms，不纳入导演检定）。

**Files:** `coc_narrative_enrichment.py:build_action_chain_requests`（读跨回合历史）; `coc_live_turn_runner.py`（传回合历史）; `tests/`

- [ ] Step 1: 失败测试 — 连续 3 回合同 `(skill,kind)` 动作，第 3 回合 build_action_chain_requests 标记为 montage/合并。
- [ ] Step 2: 实现 — runner 把最近 N 回合的 action_atoms 摘要传给 enrich；enrich 检测同质重复，emit `montage_after_success`/合并标记。
- [ ] Step 3: 回归 + sync + commit `feat(coc): cross-turn roll density coalescing for player atoms (P1-3)`。

## Task 6: P1-1 — 进度契约 beat 上限

**目标**：让 director 读 `compression_budget.max_beats`，超限强制 emit scene_exit_pressure（must_change_state）。

**Files:** `coc_story_director.py`（读 max_beats + 超限逻辑）; `tests/test_story_director.py`

- [ ] Step 1: 失败测试 — 场景带 `compression_budget.max_beats:3`，第 4 个低主动回合 → scene_exit_pressure must_change_state。
- [ ] Step 2: 实现 — 在 `_scene_exit_pressure_directive`，读 `low_agency_continue_count`（或 beat 计数）vs `compression_budget.max_beats`，超限加 `bridge_exhausted`/`budget_exceeded` reason。
- [ ] Step 3: 回归 + sync + commit `feat(coc): enforce compression_budget max_beats cap (P1-1)`。

## Task 7: 波次 4 全量回归

- [ ] full suite + sync gate。

## Self-Review

覆盖 P1-1/2/3/7/8 + P2-2。Constitution：crit/fumble 读结构化 risk_level；guard/language 用结构化 contract 字段（非扫 prose 判定语义——guard 是 prose 表层 lint，允许关键词，已在代码注释写明边界）；roll density 用结构化 (skill,kind)。范围边界：P1-3 不纳入导演检定；P1-1 不过度改 scene_type 识别。
