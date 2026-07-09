# COC 场景数据接通实现计划（Scenario Data Wiring）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **实现进度对账（2026-07-10）：全部 Task 已落地提交。** 执行时 checkbox 未逐项勾选，以 commit 对账：
> Task1 `6f6c174`（_scene_tags 接线）· Task2 `a452caa`（校验软警告）· Task3-5 `2ae9d8a`（schema/protocol/SKILL 合约）· Task6 `7822913`（white-war affordances+opening tag）· Task7 `21da731` + 修复 `6d1ca34`/`2a542e9`/`cdf340f`（开场 storylet 真正触发并胜选）· Task8 全量回归。
> **原"已知范围边界"已收口**：`arrival`/`first_contact` 场景型 storylet 已入库（`arrival-terrain-wrong-note`/`arrival-predecessor-trace`/`first-contact-sound-answers-back`/`first-contact-scale-collapse`），white-war 的 crossing-saddle/austrian-positions 标 `arrival`、blast-chamber/whistle-approaches 标 `first_contact`，端到端选中测试见 `tests/test_storylets.py::test_e2e_white_war_scene_entries_summon_tagged_storylets_real_data`。

**Goal:** 让 P0-1（多线分叉）/P0-3（storylet 触发）/P0-4（focus 刷新）三个"机制已实现"的缺陷在生产真正生效，方法是：扩展 LLM 编译合约 + 给 white-war starter 场景补真实数据 + 修 storylet 匹配接线 + 校验器软警告 + 库内补开场 storylet。

**Architecture:** 编译是 LLM 驱动（SKILL 指导 LLM 读 PDF 产 JSON），脚本只校验。所以"让字段可靠出现"分三层：(1) 扩展 LLM-facing 合约文档（SKILL + compile-protocol + story-graph-schema）告知要产什么；(2) 给 white-war 补参考数据让现成场景立刻生效；(3) 校验器加软警告兜底。同时修一个发现的接线缺陷：storylet 触发谓词读 `scene.storylet_tags`，但匹配器读 `scene.tags/tone/scene_type`——字段不通，触发后匹配不上。

**Tech Stack:** Python 3（校验器 + 测试），JSON 数据文件（story-graph / storylet-library），Markdown 合约文档（SKILL / compile-protocol / schema）。

## Global Constraints

- **Dual-Track Law（AGENTS.md）**：运行时 + 数据 + 文档改动先动 `plugins/coc-keeper/`，再 `# single-track: edit plugins/coc-keeper/ only` + `--check`。story-graph-schema.md / compile-protocol.md / SKILL.md 若在 drift allowlist 则 sync 做替换，否则逐字节同步。
- **Semantic Matcher Constitution（AGENTS.md）**：所有新增字段（affordances/route_type/storylet_tags/scene_tags）是**结构化编译产物**（LLM 读模组后产出的显式字段/枚举），不是运行时扫文本。route_type 必须是固定枚举值。
- **校验器是软警告不是硬错误**：`affordances`/`storylet_tags` 不是所有场景都需要（combat/exploration 可能不需要多路线），所以校验器只对 social/investigation 场景缺 affordances 发 warning，不发 error。
- **测试门禁**：改 shared 行为后至少跑：
  ```
  PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/test_plugin_metadata.py tests/test_scenario_compile.py tests/test_storylets.py -q -p no:cacheprovider
  # single-track: no sync script required
  ```
- **关键真实接线点（已核实）**：
  - 触发谓词 `infer_storylet_trigger`（`coc_narrative_enrichment.py:1014-1028`，Task 7 加）读 `scene.storylet_tags`。
  - 匹配器 `_scene_tags(ctx)`（`coc_storylets.py:296-303`）读 `scene.tags ∪ scene.tone ∪ scene.scene_type`，**不读 storylet_tags**。
  - storylet 端用 `storylet.scene_tags` 字段（`coc_storylets.py:379-381,457-458`）。
  - 校验器场景硬断言仅 `scene_id` + `dramatic_question`（`coc_scenario_compile.py:79-83`）。
  - storylet-library.json 每个 storylet 有 `scene_tags: []`（当前全空）。

---

## Task 序列总览

- **Task 1**：修 storylet 接线——让 `_scene_tags(ctx)` 认 `scene.storylet_tags`，统一字段名。
- **Task 2**：校验器加软警告（social/investigation 缺 affordances、scene 缺 storylet_tags 可选警告）。
- **Task 3**：扩展 story-graph-schema.md 文档（affordances route_type 枚举 + storylet_tags 字段）。
- **Task 4**：扩展 compile-protocol.md（编译指引：何时产 affordances/storylet_tags）。
- **Task 5**：扩展 SKILL.md（LLM 编译步骤纳入新字段）。
- **Task 6**：给 white-war story-graph 补 affordances + storylet_tags（开场 + investigation 场景）。
- **Task 7**：库内补开场/场景型 storylet（带 scene_tags，匹配 white-war 的 storylet_tags）。
- **Task 8**：端到端验收 + 全量回归。

---

## Task 1: 修 storylet 匹配接线 — `_scene_tags` 认 `storylet_tags`

**目标**：Task 7（P0-3b）的触发谓词读 `scene.storylet_tags` 产 trigger，但 `select_storylet_moves` 的匹配器 `_scene_tags(ctx)` 只读 `scene.tags/tone/scene_type`——触发后匹配不上任何带 `scene_tags` 的 storylet。本 Task 让匹配器也认 `scene.storylet_tags`，使触发→匹配链路通。

**Files:**
- Modify: `plugins/coc-keeper/scripts/coc_storylets.py:296-303` (`_scene_tags`)
- Test: `tests/test_storylets.py`

**Interfaces:**
- Produces: `_scene_tags(ctx)` 返回的集合现在也包含 `scene.storylet_tags` 的成员。这样 storylet 的 `scene_tags` 字段能匹配到场景的 `storylet_tags`。

- [ ] **Step 1: 写失败测试**

追加到 `tests/test_storylets.py`（先确认该文件加载 storylets 模块的变量名）：

```python
def test_scene_tags_includes_storylet_tags_field():
    """P0-3 wiring: _scene_tags must read scene.storylet_tags so that a
    storylet whose scene_tags match can be selected after the scene_tag_beat
    trigger fires."""
    ctx = {"active_scene": {"storylet_tags": ["opening_briefing"], "scene_type": "social"}}
    tags = coc_storylets._scene_tags(ctx)
    assert "opening_briefing" in tags
    assert "social" in tags  # scene_type still included
```

- [ ] **Step 2: 跑测试确认失败**

Run: `PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/test_storylets.py::test_scene_tags_includes_storylet_tags_field -v -p no:cacheprovider`
Expected: FAIL（`opening_briefing` 不在 tags 里）

- [ ] **Step 3: 实现**

在 `plugins/coc-keeper/scripts/coc_storylets.py` 的 `_scene_tags`（:296-303），加一行读 `storylet_tags`：

```python
def _scene_tags(ctx: dict[str, Any]) -> set[str]:
    scene = ctx.get("active_scene") or {}
    tags = set(_as_list(scene.get("tags")))
    tags.update(_as_list(scene.get("tone")))
    tags.update(_as_list(scene.get("storylet_tags")))  # P0-3 wiring: 认场景的 storylet_tags
    if scene.get("scene_type"):
        tags.add(str(scene.get("scene_type")))
    return {str(t) for t in tags if t}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/test_storylets.py::test_scene_tags_includes_storylet_tags_field -v -p no:cacheprovider`
Expected: PASS

- [ ] **Step 5: 回归 storylets 全测试**

Run: `PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/test_storylets.py -q -p no:cacheprovider`
Expected: 全 PASS（纯扩充，不破坏现有 scene_tags/tone/scene_type 匹配）

- [ ] **Step 6: sync + commit**

```bash
# single-track: edit plugins/coc-keeper/ only
# single-track: no sync script required
git add plugins/coc-keeper/scripts/coc_storylets.py plugins/coc-keeper/scripts/coc_storylets.py tests/test_storylets.py
git commit -m "fix(coc): _scene_tags reads storylet_tags so triggered storylets can match"
```

---

## Task 2: 校验器加软警告（缺 affordances / 缺 storylet_tags）

**目标**：校验器对 social/investigation 场景缺 `affordances` 发 warning（不是 error——不是所有场景都需要），引导 LLM 编译时补上。

**Files:**
- Modify: `plugins/coc-keeper/scripts/coc_scenario_compile.py:79-92`（scene 校验段）
- Test: `tests/test_scenario_compile.py`

**Interfaces:**
- Produces: `validate_scenario()` 的 warnings 列表新增：当 `scene_type ∈ {social, investigation}` 且无 `affordances`（或 affordances 少于 2 条）时，加一条 warning。

- [ ] **Step 1: 写失败测试**

追加到 `tests/test_scenario_compile.py`：

```python
def test_validate_warns_when_social_scene_lacks_affordances(tmp_path):
    scenario = _make_valid_scenario()
    scenario["story-graph"]["scenes"][0].update({
        "scene_id": "briefing", "scene_type": "social",
    })
    # no affordances field
    _write_scenario(tmp_path, scenario)
    result = coc_scenario_compile.validate_scenario(tmp_path)
    warnings = " ".join(result["warnings"])
    assert "briefing" in warnings
    assert "affordances" in warnings


def test_validate_no_warning_when_social_scene_has_affordances(tmp_path):
    scenario = _make_valid_scenario()
    scenario["story-graph"]["scenes"][0].update({
        "scene_id": "briefing", "scene_type": "social",
        "affordances": [
            {"id": "ask-commander", "cue": "追问指挥官", "route_type": "npc_question", "status": "open"},
            {"id": "check-gear", "cue": "检查装备", "route_type": "environment", "status": "open"},
        ],
    })
    _write_scenario(tmp_path, scenario)
    result = coc_scenario_compile.validate_scenario(tmp_path)
    assert not any("briefing" in w and "affordances" in w for w in result["warnings"])
```

（确认 `_write_scenario` helper 的实际名称——照该文件现有测试样式。`_make_valid_scenario()` 在 :19-44。）

- [ ] **Step 2: 跑测试确认失败**

Run: `PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/test_scenario_compile.py::test_validate_warns_when_social_scene_lacks_affordances -v -p no:cacheprovider`
Expected: FAIL（无此 warning）

- [ ] **Step 3: 实现**

在 `plugins/coc-keeper/scripts/coc_scenario_compile.py` 的 scene 循环（:79-92），在现有检查后加 warning 逻辑：

```python
    for scene in story.get("scenes", []):
        if not scene.get("dramatic_question"):
            errors.append(f"scene '{scene.get('scene_id')}' missing dramatic_question")
        if not scene.get("scene_id"):
            errors.append("scene missing scene_id")
        # 软警告：social/investigation 场景宜有多路线 affordances（P0-1 数据引导）
        scene_type = str(scene.get("scene_type") or "")
        if scene_type in ("social", "investigation"):
            affordances = scene.get("affordances") or []
            if not isinstance(affordances, list) or len(affordances) < 2:
                warnings.append(
                    f"scene '{scene.get('scene_id')}' ({scene_type}) has fewer than 2 "
                    f"affordances; multi-route fork hints recommended so players have choices"
                )
```

（确认 warnings 列表变量在该函数已存在——:63 返回 dict 含 warnings。若 scene 循环在 warnings 列表构建之前，调整位置。）

- [ ] **Step 4: 跑测试确认通过**

Run: `PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/test_scenario_compile.py -k "social_scene_lacks_affordances or social_scene_has_affordances" -v -p no:cacheprovider`
Expected: 2 PASS

- [ ] **Step 5: 回归 — white-war 现有编译测试不应破**

Run: `PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/test_scenario_compile.py tests/test_starter_scenarios.py -q -p no:cacheprovider`
Expected: 全 PASS（warning 不影响 errors=0；若 test_starter_scenarios.py 断言 white-war 编译零 warning，需更新该断言——但 Task 6 会给 white-war 补 affordances 使 warning 消失）

- [ ] **Step 6: sync + commit**

```bash
# single-track: edit plugins/coc-keeper/ only
# single-track: no sync script required
git add plugins/coc-keeper/scripts/coc_scenario_compile.py plugins/coc-keeper/scripts/coc_scenario_compile.py tests/test_scenario_compile.py
git commit -m "feat(coc): warn when social/investigation scenes lack affordances"
```

---

## Task 3: 扩展 story-graph-schema.md（route_type 枚举 + storylet_tags）

**目标**：文档化 `route_type` 固定枚举（P0-4 focus 匹配要用）+ 新增 `storylet_tags` 字段说明（当前 schema 完全没提）。

**Files:**
- Modify: `plugins/coc-keeper/skills/coc-scenario-import/references/story-graph-schema.md`

- [ ] **Step 1: 在 affordances 字段说明里补充 route_type 枚举**

找到 Task 10（P0-1b）加的 `affordances` 字段说明，把 `route_type` 的"可选"描述扩为枚举：

```
  - `affordances` (object[], optional)：... 每条含 `id`、`cue`、可选 `route_type`（**固定枚举**：`tenant_history` 前租客/房史、`reward_scope` 报酬范围、`direct_entry` 直接进入、`npc_question` 向 NPC 追问、`environment` 环境调查、`investigative_lead` 调查线索、`scene_affordance` 场景通用——选最贴切的；运行时 focus 提取按此枚举匹配玩家意图）、可选 `status`（`open`/`suggested`/`exhausted`/`locked`，缺省 `open`）。...
```

- [ ] **Step 2: 在 scene 字段列表加 storylet_tags**

在 `affordances` 字段之后加：

```
  - `storylet_tags` (string[], optional)：该场景在进入时可触发的 storylet 语义标签（如 `opening_briefing`/`arrival`/`first_contact`）。当玩家首次进入该场景（source_event_type 为 scene_transition/scene_enter）时，引擎会触发匹配这些 tag 的 storylet beat。调查/社交开场场景宜标 1-2 个。
```

- [ ] **Step 3: sync（确认 story-graph-schema.md 是否 drift 文件）+ 验证**

```bash
# single-track: edit plugins/coc-keeper/ only
# single-track: no sync script required
diff plugins/coc-keeper/skills/coc-scenario-import/references/story-graph-schema.md plugins/coc-keeper/skills/coc-scenario-import/references/story-graph-schema.md && echo identical
```

- [ ] **Step 4: commit**

```bash
git add plugins/coc-keeper/skills/coc-scenario-import/references/story-graph-schema.md plugins/coc-keeper/skills/coc-scenario-import/references/story-graph-schema.md
git commit -m "docs(coc): document route_type enum and storylet_tags scene field"
```

---

## Task 4: 扩展 compile-protocol.md（编译指引）

**目标**：在编译协议里告知 LLM 何时产出 affordances / storylet_tags。

**Files:**
- Modify: `plugins/coc-keeper/skills/coc-scenario-import/references/compile-protocol.md`

- [ ] **Step 1: 在编译指引加一段"场景多路线与 storylet 标签"**

在 compile-protocol.md 的 Layer 1（LLM 编译）指引段（:106 附近"LLM 驱动"声明后），加一段：

```
## 场景多路线与 storylet 标签（编译期产出）

为让玩家在每个调查/社交场景都有选择权、不被线性推向单一出口，编译 story-graph.json 时：

1. 每个 `scene_type ∈ {social, investigation}` 的场景应产出 ≥2 条 `affordances`，每条带语义 `route_type`（见 story-graph-schema.md 枚举）。开场场景宜 ≥3 条覆盖不同调查方向。
2. 开场/首次进入的场景宜标 `storylet_tags`（如 `opening_briefing`），让引擎在该场景进入时能触发匹配的开场 storylet beat。
3. combat/exploration 场景的 affordances 可选（线性推进可接受）。
4. 校验器会对缺 affordances 的 social/investigation 场景发 warning（非 error）——补上即可。
```

- [ ] **Step 2: sync + commit**

```bash
# single-track: edit plugins/coc-keeper/ only
# single-track: no sync script required
git add plugins/coc-keeper/skills/coc-scenario-import/references/compile-protocol.md plugins/coc-keeper/skills/coc-scenario-import/references/compile-protocol.md
git commit -m "docs(coc): compile-protocol guidance for affordances and storylet_tags"
```

---

## Task 5: 扩展 coc-scenario-import SKILL.md

**目标**：在 SKILL 的编译步骤里点名新字段，让 LLM 编译时纳入。

**Files:**
- Modify: `plugins/coc-keeper/skills/coc-scenario-import/SKILL.md:50-62`（剧情图编译步骤）

- [ ] **Step 1: 在编译步骤 3（产 7 JSON）后加一句字段要求**

在 SKILL.md 的"剧情图编译"步骤里，产 story-graph.json 的说明处加：

```
   - story-graph.json 的 social/investigation 场景必须带 ≥2 条 affordances（含语义 route_type）；开场场景带 storylet_tags。详见 references/compile-protocol.md「场景多路线与 storylet 标签」。
```

- [ ] **Step 2: sync + commit**

```bash
# single-track: edit plugins/coc-keeper/ only
# single-track: no sync script required
git add plugins/coc-keeper/skills/coc-scenario-import/SKILL.md plugins/coc-keeper/skills/coc-scenario-import/SKILL.md
git commit -m "docs(coc): scenario-import SKILL names affordances/storylet_tags requirement"
```

---

## Task 6: 给 white-war story-graph 补 affordances + storylet_tags

**目标**：给 white-war starter 场景补真实数据，让 P0-1/P0-3/P0-4 在现成场景立刻生效。重点：开场 mission-briefing（social）+ 3 个 investigation 场景（austrian-positions / blast-chamber，加 mission-briefing 共 1 social + 2 investigation = 3 个，符合校验器）。

**Files:**
- Modify: `plugins/coc-keeper/references/starter-scenarios/the-white-war/story-graph.json`
- Modify: `plugins/coc-keeper/references/rules-json/the-white-war.json`（若场景规则在此，确认数据源）
- Test: `tests/test_starter_scenarios.py`, `tests/test_white_war_rules.py`

**Interfaces:**
- Produces: white-war 的 social/investigation 场景带 `affordances`（≥2 条，语义 route_type）+ 开场带 `storylet_tags`。

- [ ] **Step 1: 先确认 white-war story-graph 是唯一数据源 + 现有测试断言**

Run: `grep -n "affordances\|storylet_tags\|mission-briefing\|austrian-positions" tests/test_starter_scenarios.py tests/test_white_war_rules.py`
确认测试是否断言这些场景的字段（多半没有，但确认）。

- [ ] **Step 2: 给 mission-briefing（开场 social）补数据**

在 `plugins/coc-keeper/references/starter-scenarios/the-white-war/story-graph.json` 的 mission-briefing scene（约开头），加 `affordances` + `storylet_tags`。基于该场景的 dramatic_question（任务性质被隐瞒）+ exit_conditions + pressure_moves 设计 3 条多路线：

```json
"storylet_tags": ["opening_briefing"],
"affordances": [
  {"id": "question-mission-truth", "cue": "追问指挥官这次侦察的真实目的——上级只关心情报、不关心巡逻队死活，话里有话。", "route_type": "npc_question", "status": "open"},
  {"id": "inspect-gear-supplies", "cue": "检查巡逻队的装备与补给——军士提醒雪况恶劣，补给只能自己背。", "route_type": "environment", "status": "open"},
  {"id": "size-up-squad", "cue": "打量同行的战友，看谁可靠、谁可能在压力下崩溃。", "route_type": "npc_question", "status": "open"}
]
```

- [ ] **Step 3: 给 austrian-positions（investigation）补数据**

该场景 dramatic_question 是侦察奥军阵地。加 2 条 affordances：

```json
"affordances": [
  {"id": "observe-through-glass", "cue": "用望远镜从掩体后观察阵地部署与异常。", "route_type": "investigative_lead", "status": "open"},
  {"id": "approach-wire-listen", "cue": "贴近铁丝网，听阵地里传来的怪声与爆炸节奏。", "route_type": "environment", "status": "open"}
]
```

- [ ] **Step 4: 给 blast-chamber（investigation）补数据**

加 2 条 affordances（基于爆炸室场景）：

```json
"affordances": [
  {"id": "examine-blast-residue", "cue": "检查爆炸残留物，判断这是常规炸药还是别的什么。", "route_type": "investigative_lead", "status": "open"},
  {"id": "map-tunnel-branches", "cue": "把坑道的分支走向记下来，标出哪条通向怪声源头。", "route_type": "environment", "status": "open"}
]
```

- [ ] **Step 5: 校验 JSON 合法 + 跑 starter 测试**

Run:
```
python3 -c "import json; json.load(open('plugins/coc-keeper/references/starter-scenarios/the-white-war/story-graph.json')); print('valid json')"
# single-track: edit plugins/coc-keeper/ only
# single-track: no sync script required
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/test_starter_scenarios.py tests/test_white_war_rules.py tests/test_scenario_compile.py -q -p no:cacheprovider
```
Expected: JSON 合法；测试全 PASS；white-war 编译不再触发 affordances warning（因为已补）。

- [ ] **Step 6: commit**

```bash
git add plugins/coc-keeper/references/starter-scenarios/the-white-war/story-graph.json plugins/coc-keeper/references/starter-scenarios/the-white-war/story-graph.json
git commit -m "feat(coc): white-war scenes get affordances + opening storylet_tags"
```

---

## Task 7: 库内补开场/场景型 storylet（带 scene_tags）

**目标**：storylet-library 当前 65 条全通用、`scene_tags: []` 全空。补少量开场/场景型 storylet，带 `scene_tags`（如 `opening_briefing`）匹配 white-war 的 storylet_tags，让 Task 7（P0-3b）的触发谓词触发后真能选中。

**Files:**
- Modify: `plugins/coc-keeper/references/rules-json/storylet-library.json`
- Test: `tests/test_storylets.py`

**Interfaces:**
- Produces: storylet-library 新增 2-3 条 storylet，`scene_tags` 非空（匹配场景的 storylet_tags）。

- [ ] **Step 1: 先看一个现有 storylet 的完整字段模板**

Run: `python3 -c "import json; lib=json.load(open('plugins/coc-keeper/references/rules-json/storylet-library.json')); print(json.dumps(lib['storylets'][0], ensure_ascii=False, indent=2))"`
照这个字段结构（storylet_id/title/family_id/conflict_level/dramatic_function/scene_actions/eligible_scene_types/horror_stage/scene_tags/requires/serves/anti_repeat/cue/beat/effects）写新条目。

- [ ] **Step 2: 加 2 条开场 storylet**

在 storylet-library.json 的 storylets 数组末尾加（匹配 `opening_briefing` scene_tag）：

```json
{
  "storylet_id": "opening-briefing-tell-not-ask",
  "title": "简报里的沉默",
  "family_id": "opening_tension",
  "trope_id": "withheld_mission_truth",
  "conflict_level": "low",
  "conflict_score": 1,
  "base_weight": 1.0,
  "dramatic_function": ["CHARACTER", "DEEPEN"],
  "scene_actions": ["CHARACTER", "DEEPEN"],
  "scope": "scene",
  "structure_affinity": ["linear_acts", "branching_investigation", "hub_sandbox", "hybrid_mega"],
  "eligible_scene_types": ["social"],
  "horror_stage": ["ordinary", "wrongness"],
  "scene_tags": ["opening_briefing"],
  "requires": {"npc_id": true, "unrevealed_clue": false, "active_front": false, "scene_pressure": false},
  "serves": {"mainline": true, "can_deepen_npc": true, "can_surface_choice": true},
  "anti_repeat": {"cooldown_turns": 12, "max_per_session": 1, "exclude_if_family_used_recently": true, "exclude_if_trope_used_recently": false},
  "cue": "下达命令的人把真相咽回去半句，眼神在地图上多停了一拍。",
  "beat": "在简报里埋下'这次任务没说全'的张力，给玩家追问的抓手。",
  "effects": {"narrative_move": "在简报里埋下'这次任务没说全'的张力，给玩家追问的抓手。", "clue_handling": "May foreshadow a withheld clue; never reveals it.", "pressure": "No automatic clock tick.", "conflict_shift": 0}
},
{
  "storylet_id": "opening-briefing-comrade-glance",
  "title": "战友的侧目",
  "family_id": "opening_tension",
  "trope_id": "squad_doubt",
  "conflict_level": "low",
  "conflict_score": 1,
  "base_weight": 1.0,
  "dramatic_function": ["CHARACTER"],
  "scene_actions": ["CHARACTER"],
  "scope": "scene",
  "structure_affinity": ["linear_acts", "branching_investigation", "hub_sandbox", "hybrid_mega"],
  "eligible_scene_types": ["social"],
  "horror_stage": ["ordinary", "wrongness"],
  "scene_tags": ["opening_briefing"],
  "requires": {"npc_id": false, "unrevealed_clue": false, "active_front": false, "scene_pressure": false},
  "serves": {"mainline": true, "can_deepen_npc": true},
  "anti_repeat": {"cooldown_turns": 10, "max_per_session": 1, "exclude_if_family_used_recently": true, "exclude_if_trope_used_recently": false},
  "cue": "旁边一名老兵和你对上眼神，又飞快地移开——他知道的比说的多。",
  "beat": "用战友的反应侧面烘托任务的异样，不直接揭示。",
  "effects": {"narrative_move": "用战友的反应侧面烘托任务的异样。", "clue_handling": "No clue binding.", "pressure": "No automatic clock tick.", "conflict_shift": 0}
}
```

（确认 conflict_score/base_weight/effects 字段类型与现有 storylet 一致。）

- [ ] **Step 3: 校验 JSON + 跑 storylet 测试**

Run:
```
python3 -c "import json; lib=json.load(open('plugins/coc-keeper/references/rules-json/storylet-library.json')); print('count:', len(lib['storylets']))"
# single-track: edit plugins/coc-keeper/ only
# single-track: no sync script required
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/test_storylets.py -q -p no:cacheprovider
```
Expected: count 增加 2；测试全 PASS（新 storylet 满足 selection_contract）。

- [ ] **Step 4: 加端到端匹配测试**

追加到 `tests/test_storylets.py`：构造一个 ctx，active_scene 带 `storylet_tags: ["opening_briefing"]`，`source_event_type: "scene_transition"`，断言 `infer_storylet_trigger` 触发且 `select_storylet_moves` 能选中带 `scene_tags: ["opening_briefing"]` 的 storylet（照该文件现有 select_storylet_moves 调用样式）。

- [ ] **Step 5: commit**

```bash
git add plugins/coc-keeper/references/rules-json/storylet-library.json plugins/coc-keeper/references/rules-json/storylet-library.json tests/test_storylets.py
git commit -m "feat(coc): add opening-briefing storylets with scene_tags"
```

---

## Task 8: 端到端验收 + 全量回归

**目标**：验证整条链路——white-war 开场场景进入时 storylet 触发并选中、affordances 产出 is_real_fork、focus 能匹配——且全量测试无回归。

- [ ] **Step 1: 端到端 storylet 触发+选中测试**

确认 Task 7 Step 4 的测试覆盖：场景带 storylet_tags + 场景进入 → trigger fired + storylet selected。

- [ ] **Step 2: 全量测试**

Run:
```
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/ -q -p no:cacheprovider
```
Expected: 全 PASS。

- [ ] **Step 3: sync 门禁 + 单轨一致性**

Run:
```
# single-track: no sync script required
diff plugins/coc-keeper/references/starter-scenarios/the-white-war/story-graph.json plugins/coc-keeper/references/starter-scenarios/the-white-war/story-graph.json && echo identical
diff plugins/coc-keeper/references/rules-json/storylet-library.json plugins/coc-keeper/references/rules-json/storylet-library.json && echo identical
```

- [ ] **Step 4: commit（若有未提交修复）**

```bash
git add -A
git commit -m "test(coc): scenario-data wiring e2e + full regression green" || echo "nothing to commit"
```

---

## Self-Review

**1. Spec 覆盖**：
- P0-1 生产生效（affordances→is_real_fork）→ Task 6（white-war 数据）+ Task 2（校验引导）+ Task 3-5（合约）。✅
- P0-3 生产生效（storylet 触发+选中）→ Task 1（接线修复）+ Task 6（storylet_tags）+ Task 7（库 storylet）。✅
- P0-4 生产生效（focus 匹配 route_type）→ Task 6（route_type 数据）+ Task 3（route_type 枚举文档）。✅
- 接线缺陷（storylet_tags 字段不通）→ Task 1。✅

**2. 占位符**：每个 Step 有具体代码/JSON/命令。✅

**3. 一致性**：route_type 枚举在 Task 3（文档）+ Task 6（数据）+ 已有 P0-4 代码（`_TOPIC_TO_FOCUS_AXIS` 间接匹配）一致；storylet_tags（scene 端）与 scene_tags（storylet 端）经 Task 1 的 `_scene_tags` 桥接。✅

**已知范围边界**：
- 本计划让 P0 在 **white-war** 场景生效 + 为**未来场景编译**建立合约。其它已有场景（如 haunting fullrun 的 playtest artifact）在 `.coc/`（gitignored），不在本计划范围。
- storylet 库只补开场型（`opening_briefing`）；其它场景型 tag（`arrival`/`first_contact`）的 storylet 留作后续按需补。
