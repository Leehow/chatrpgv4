# Idea Roll Recovery Valve + Clue Signpost Ladder — 落地报告

Status: **DONE**（commit `ff6ce36`）
Date: 2026-07-10

## 做了什么

按 Keeper Rulebook ~p.199 的 Idea Roll 阶梯，把 RECOVER 从"一律付代价的兜底"升级为规则书语义的恢复阀：

- **signpost 阶梯**：`unmentioned`（从未提示 → 免费给线索）/ `mentioned`（提示过 → Regular Idea Roll）/ `obvious`（明显但错过 → Extreme Idea Roll）。
- **结构化记账**：`apply_plan` 在 `world-state.json` 新增 `clue_signposts`——CHOICE/leads 把线索标 `mentioned`，失败的 obscured 检定把线索标 `obvious`；只升不降（`_merge_clue_signposts`）。
- **director**：RECOVER 时按 fallback 线索的 signpost 等级产出 `idea_roll` rules_request（含 roll_contract；免费档不发请求）；`ROLL_REQUEST_KINDS` 增加 `idea_roll`；有 rules_requests 时强制 `handoff="rules"`。
- **driver**：执行 `idea_roll` 请求（`coc_roll.idea_roll` vs INT），结果带 signpost_level/missed_clue_id 回填。
- **apply**：成功/免费 → `idea_roll_recovery` 事件 + `recover_clean` 叙述模式（无代价）；失败 → 仍浮出线索但"in the thick of it"（`fail_forward_recovery` + 压力 tick）。
- **runner**：`idea_roll_recovery` 加入中断事件集合。

## 证据

- `plugins/coc-keeper/scripts/coc_story_director.py`（阶梯映射、_idea_roll_plan、RECOVER 请求）
- `plugins/coc-keeper/scripts/coc_director_apply.py`（_collect_signpost_updates/_merge_clue_signposts/_idea_roll_result、RECOVER 三分支）
- `plugins/coc-keeper/scripts/coc_playtest_driver.py`（idea_roll 执行）
- 测试：`tests/test_director_apply.py`（signpost 记账/不降级/成功/失败分支）、`tests/test_playtest_driver.py`（免费档不掷、mentioned 档真掷 INT）、`tests/test_story_director.py`
- 回归：全量 `pytest tests/` 1146+ passed（含插件元数据门禁）。

## 备注

- Constitution 合规：signpost 全部来自结构化事件（leads/choice routes/clue_withheld），无自由文本扫描。
- 该工作源自 director 与规则书第 10 章对齐（`tmp/pdfs/director-align/pacing-idea-clues.txt` 为对照草稿，非权威数据）。
