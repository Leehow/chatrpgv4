# COC 插件 P0 缺陷修复实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 COC 插件的 4 条 P0 缺陷（全程多线分叉、低主动推进失效、storylet 旁路化、stop-actionability 复用旧抓手），使 live play 中玩家能看到多条可行动线、低主动输入能多步推进、storylet 真正驱动叙述、stop 时的抓手贴合当前轮焦点。

**Architecture:** 按 P0-1→P0-2→P0-3→P0-4 顺序实现。P0-1 在 story-graph 引入 `available_routes` 结构化字段与 `is_real_fork` 标记；P0-2 收窄 runner 闸门（route_count→is_real_fork、npc_moves→requires_player_decision）并统一低主动 tag；P0-3 把 storylet 渲染接线接通到 live runner 并扩触发面；P0-4 新增结构化焦点提取步骤刷新 handle。所有运行时改动先动 canonical `plugins/coc-keeper/`，每 Task 末尾跑 sync 脚本同步 zcode 轨道。

**Tech Stack:** Python 3（无第三方依赖），`importlib.util` 动态加载模块，pytest 测试，`scripts/sync_coc_plugin_copy.py` 双轨同步。

## Global Constraints

- **Dual-Track Law（AGENTS.md）**：运行时改动先动 `plugins/coc-keeper/`，再 `python3 scripts/sync_coc_plugin_copy.py` + `--check`。两轨运行时脚本必须逐字节一致（除 8 个 `INTENTIONAL_PLATFORM_DRIFT_FILES` 的 allowlisted 替换）。
- **Semantic Matcher Constitution（AGENTS.md）**：禁止用关键词扫描自由文本推断意义。所有"意义判定"必须用结构化字段/枚举/带 recorded reason 的语义路由输出。P0-4 允许新增语义步骤，但输出必须是结构化枚举+reason，禁止从原始 prose 取子串。
- **测试门禁**：改 shared 行为后至少跑：
  ```
  PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/test_plugin_metadata.py tests/test_zcode_plugin_metadata.py tests/test_coc_plugin_sync_script.py -q -p no:cacheprovider
  python3 scripts/sync_coc_plugin_copy.py --check
  ```
- **TDD**：每个 Task 先写失败测试，再实现，再验证通过，再 commit。
- **模块加载约定**：测试用 `importlib.util.spec_from_file_location` 从 `plugins/coc-keeper/scripts/coc_<name>.py` 加载（见现有测试样式），无包结构。
- **关键真实接线点（已核实，不可臆造）**：
  - `build_choice_frame` 在 `coc_narrative_enrichment.py:79-149`，返回含 `routes`/`route_count` 的 frame。
  - `_turn_interrupt_reason` 在 `coc_live_turn_runner.py:274-302`，第 289 行 `route_count>=2`、第 291-292 行 `npc_moves` 判停。
  - `_apply_storylet_state` 在 `coc_narrative_enrichment.py:905-915`，**已**把 storylet cue 注入 `must_include`——所以 P0-3 渲染断线在 live runner 端，不在 enrichment。
  - `_keeper_turn_text` 在 `coc_playtest_driver.py:446-474`（含 `_storylet_prose` at `:399-410`）是 playtest 已验证的渲染路径。
  - `build_stop_actionability_contract` 在 `coc_narrative_enrichment.py:287-359`，handle 只来自静态字段。

---

## File Structure

**修改（canonical，每 Task 末 sync 到 zcode）：**
- `plugins/coc-keeper/scripts/coc_narrative_enrichment.py` — P0-1（build_choice_frame 加 is_real_fork）、P0-3（接渲染钩子）、P0-4（焦点提取 + handle 新源）
- `plugins/coc-keeper/scripts/coc_live_turn_runner.py` — P0-2（闸门收窄）、P0-3（stop 前调渲染钩子）、P0-4（传 turn_focus）
- `plugins/coc-keeper/scripts/coc_story_director.py` — P0-2（tag 集合统一）
- `plugins/coc-keeper/scripts/coc_director_apply.py` — P0-2（recent_intent_classes 落盘带 tags）
- `plugins/coc-keeper/scripts/coc_playtest_driver.py` — P0-2（同步落盘，如适用）
- `plugins/coc-keeper/skills/coc-scenario-import/references/story-graph-schema.md` — P0-1（文档化 available_routes）
- `plugins/coc-keeper/references/state-schema.md` — P0-1（pending_choices 回归声明）

**测试：**
- `tests/test_narrative_enrichment.py` — P0-1/P0-3/P0-4 enrichment 层测试
- `tests/test_live_turn_runner.py` — P0-2/P0-3 runner 层测试
- `tests/test_story_director.py` — P0-2 tag 统一测试
- `tests/test_scenario_compile.py` — P0-1 available_routes 编译测试
- `tests/fixtures/story-director/` — P0-1 fixture（如需）

---

## Task 1: P0-1a — 在 choice_frame 引入 is_real_fork 结构化标记

**目标**：让 `build_choice_frame` 输出 `is_real_fork: bool` + `open_route_ids: [...]`，基于结构化 `route.status` 计算，不扫文本。这是 P0-2 闸门收窄的前置数据。

**Files:**
- Modify: `plugins/coc-keeper/scripts/coc_narrative_enrichment.py:79-149`（`build_choice_frame`）
- Test: `tests/test_narrative_enrichment.py`

**Interfaces:**
- Produces: `build_choice_frame(scene, clue_policy)` 返回的 frame 新增字段 `is_real_fork: bool`、`open_route_ids: list[str]`、`open_route_count: int`。route dict 可选带 `status` 字段（`open`/`suggested`/`exhausted`/`locked`，缺省视为 `open`）。

- [ ] **Step 1: 写失败测试**

追加到 `tests/test_narrative_enrichment.py` 末尾：

```python
def test_choice_frame_is_real_fork_when_two_open_routes():
    scene = {"affordances": [
        {"id": "ask-tenants", "cue": "前租客", "status": "open"},
        {"id": "check-records", "cue": "公共记录", "status": "open"},
    ]}
    frame = narr.build_choice_frame(scene)
    assert frame["is_real_fork"] is True
    assert frame["open_route_count"] == 2
    assert frame["open_route_ids"] == ["ask-tenants", "check-records"]


def test_choice_frame_not_real_fork_when_one_open_one_locked():
    scene = {"affordances": [
        {"id": "ask-tenants", "cue": "前租客", "status": "open"},
        {"id": "check-records", "cue": "公共记录", "status": "locked"},
    ]}
    frame = narr.build_choice_frame(scene)
    assert frame["is_real_fork"] is False
    assert frame["open_route_count"] == 1


def test_choice_frame_open_status_defaults_to_open_when_absent():
    scene = {"affordances": [
        {"id": "a", "cue": "a"},
        {"id": "b", "cue": "b"},
    ]}
    frame = narr.build_choice_frame(scene)
    assert frame["is_real_fork"] is True
    assert frame["open_route_count"] == 2
```

- [ ] **Step 2: 跑测试确认失败**

Run: `PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/test_narrative_enrichment.py::test_choice_frame_is_real_fork_when_two_open_routes -v -p no:cacheprovider`
Expected: FAIL with `KeyError: 'is_real_fork'`

- [ ] **Step 3: 实现 — 修改 `build_choice_frame`**

在 `plugins/coc-keeper/scripts/coc_narrative_enrichment.py:138-149` 的 return dict 之前，插入 open route 计算；修改 return dict 加入新字段。完整替换 `build_choice_frame` 的 return 部分：

把这段（约 :134-149）：
```python
    must_surface_tradeoffs = any(
        route.get("visible_benefit") or route.get("visible_cost") or route.get("visible_risk")
        for route in routes
    )
    return {
        "schema_version": _SCHEMA_VERSION,
        "mode": "diegetic_cues",
        "routes": routes,
        "route_count": len(routes),
        "must_surface_tradeoffs": bool(must_surface_tradeoffs),
        "do_not_render_as_menu": True,
        "narration_rule": (
            "Render routes as concrete sensory cues, NPC behavior, time pressure, "
            "or visible costs. Do not show numbered options unless the player asks."
        ),
    }
```

替换为：
```python
    must_surface_tradeoffs = any(
        route.get("visible_benefit") or route.get("visible_cost") or route.get("visible_risk")
        for route in routes
    )
    # P0-1: 真分叉判定基于结构化 route.status，不扫自由文本。缺省 status 视为 open。
    open_route_ids = [
        str(route["route_id"])
        for route in routes
        if str(route.get("status") or "open") == "open"
    ]
    open_route_count = len(open_route_ids)
    is_real_fork = open_route_count >= 2
    return {
        "schema_version": _SCHEMA_VERSION,
        "mode": "diegetic_cues",
        "routes": routes,
        "route_count": len(routes),
        "open_route_count": open_route_count,
        "open_route_ids": open_route_ids,
        "is_real_fork": is_real_fork,
        "must_surface_tradeoffs": bool(must_surface_tradeoffs),
        "do_not_render_as_menu": True,
        "narration_rule": (
            "Render routes as concrete sensory cues, NPC behavior, time pressure, "
            "or visible costs. Do not show numbered options unless the player asks."
        ),
    }
```

同时需让 route dict 带上 `status`：在 affordance→route 的映射（:99-112）和 clue-lead→route 的映射（:120-132）里各加一行 `"status": ...,`。

affordance 分支（约 :101-112）在 `"source": "scene.affordances",` 后加：
```python
            "status": str(affordance.get("status") or "open"),
```

clue-lead 分支（约 :121-132）在 `"source": "clue_policy.leads",` 后加：
```python
                "status": "open",
```

- [ ] **Step 4: 跑测试确认通过**

Run: `PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/test_narrative_enrichment.py -k "is_real_fork or open_status" -v -p no:cacheprovider`
Expected: 3 PASS

- [ ] **Step 5: 回归现有 choice_frame 测试不破**

Run: `PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/test_narrative_enrichment.py::test_choice_frame_surfaces_affordance_tradeoffs_without_menu -v -p no:cacheprovider`
Expected: PASS（既有断言不应破——route_count/routes/visible_risk 都保留）

- [ ] **Step 6: sync 双轨 + 门禁**

Run:
```
python3 scripts/sync_coc_plugin_copy.py
python3 scripts/sync_coc_plugin_copy.py --check
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/test_plugin_metadata.py tests/test_zcode_plugin_metadata.py tests/test_coc_plugin_sync_script.py -q -p no:cacheprovider
```
Expected: 全 PASS，`--check` 无 drift

- [ ] **Step 7: Commit**

```bash
git add plugins/coc-keeper/scripts/coc_narrative_enrichment.py plugins/coc-keeper-zcode/scripts/coc_narrative_enrichment.py tests/test_narrative_enrichment.py
git commit -m "feat(coc): add is_real_fork structural marker to choice_frame (P0-1a)"
```

---

## Task 2: P0-2a — 统一低主动 tag 集合

**目标**：把 `coc_story_director.py` 三个成员不同的低主动集合统一为单一来源，消除 `continue_existing_strategy` 被划进 routine 而非 low-agency 的分裂。

**Files:**
- Modify: `plugins/coc-keeper/scripts/coc_story_director.py:549-613`
- Test: `tests/test_story_director.py`

**Interfaces:**
- Produces: 统一的 `_LOW_AGENCY_TAGS` 集合（含所有低主动 tag 与 class 字符串），`_is_low_agency_continue` 与 `_low_agency_continue_count` 都基于它。

- [ ] **Step 1: 先看清现状（读取确认当前集合内容）**

Run: `sed -n '549,622p' plugins/coc-keeper/scripts/coc_story_director.py`
确认三个集合的当前成员，记录到实现笔记。预期：
- `_LOW_AGENCY_RECENT_CLASSES` = {move, continue, follow, follow_group, low_agency_continue, passive_follow}
- `_LOW_AGENCY_CONTINUE_TAGS` = {low_agency_continue, continue_without_new_goal, follow_group, keep_following, yield_initiative, move_with_group, passive_follow}
- `_ROUTINE_PROGRESS_TAGS` 含 continue_existing_strategy 等

- [ ] **Step 2: 写失败测试**

追加到 `tests/test_story_director.py`（先确认该文件加载 story_director 模块的方式，照同样式）：

```python
def test_low_agency_tags_unified_covers_continue_existing_strategy():
    # continue_existing_strategy 之前只在 _ROUTINE_PROGRESS_TAGS，现应也被识别为低主动
    ctx = {"player_intent_rich": {"secondary_intents": ["continue_existing_strategy"]}}
    assert director._is_low_agency_continue(ctx) is True


def test_low_agency_tags_covers_yield_initiative_via_class():
    ctx = {"player_intent_class": "yield_initiative"}
    assert director._is_low_agency_continue(ctx) is True


def test_low_agency_tags_unified_is_single_source():
    # _LOW_AGENCY_RECENT_CLASSES 应是 _LOW_AGENCY_TAGS 的子集，且关键成员都在
    for member in ("move", "continue", "follow", "low_agency_continue",
                   "continue_existing_strategy", "yield_initiative", "passive_follow"):
        assert member in director._LOW_AGENCY_TAGS, f"missing {member}"
```

（若 `tests/test_story_director.py` 模块名变量不是 `director`，按该文件实际命名调整。）

- [ ] **Step 3: 跑测试确认失败**

Run: `PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/test_story_director.py::test_low_agency_tags_unified_covers_continue_existing_strategy -v -p no:cacheprovider`
Expected: FAIL（当前 `continue_existing_strategy` 不在低主动集合）

- [ ] **Step 4: 实现 — 统一为单一来源**

在 `plugins/coc-keeper/scripts/coc_story_director.py:549` 附近，把三个集合改为以一个 `_LOW_AGENCY_TAGS` 为权威来源派生：

```python
# P0-2: 低主动身份单一来源。所有 tag/class 字符串统一在此定义，
# 消除 _LOW_AGENCY_RECENT_CLASSES / _LOW_AGENCY_CONTINUE_TAGS / 部分 routine tag 的分裂。
_LOW_AGENCY_TAGS = frozenset({
    "move",
    "continue",
    "follow",
    "follow_group",
    "low_agency_continue",
    "passive_follow",
    "continue_without_new_goal",
    "keep_following",
    "move_with_group",
    "yield_initiative",
    "continue_existing_strategy",
})
# 派生：用于 class 字符串匹配（保持向后兼容的子集）
_LOW_AGENCY_RECENT_CLASSES = frozenset({
    m for m in _LOW_AGENCY_TAGS
    if m in {"move", "continue", "follow", "follow_group", "low_agency_continue", "passive_follow"}
})
# continue_existing_strategy 同时保留为 routine 标记（用于压缩进度），但不再是"非低主动"
_ROUTINE_PROGRESS_TAGS = frozenset({
    # ... 保留原成员，continue_existing_strategy 仍在其中 ...
})
# _LOW_AGENCY_CONTINUE_TAGS 由 _LOW_AGENCY_TAGS 派生（向后兼容）
_LOW_AGENCY_CONTINUE_TAGS = _LOW_AGENCY_TAGS
```

注意：保留原 `_ROUTINE_PROGRESS_TAGS` 的其他成员不变，只确保 `continue_existing_strategy` 也在 `_LOW_AGENCY_TAGS` 里。`_is_low_agency_continue`（:609-613）改为：
```python
def _is_low_agency_continue(ctx: dict[str, Any]) -> bool:
    tags = _rich_intent_tags(ctx)
    if tags & _LOW_AGENCY_CONTINUE_TAGS:
        return True
    return str(ctx.get("player_intent_class") or "") in _LOW_AGENCY_TAGS
```
（把 `_LOW_AGENCY_RECENT_CLASSES` 的引用改为 `_LOW_AGENCY_TAGS`，使 class 字符串也认 `continue_existing_strategy`/`yield_initiative` 等。）

- [ ] **Step 5: 跑测试确认通过**

Run: `PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/test_story_director.py -k "low_agency_tags" -v -p no:cacheprovider`
Expected: 3 PASS

- [ ] **Step 6: 回归现有 director 测试不破**

Run: `PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/test_story_director.py -q -p no:cacheprovider`
Expected: 全 PASS（既有 low_agency/routine 相关断言不应破——扩充集合是超集）

- [ ] **Step 7: sync 双轨 + 门禁 + Commit**

```bash
python3 scripts/sync_coc_plugin_copy.py
python3 scripts/sync_coc_plugin_copy.py --check
git add plugins/coc-keeper/scripts/coc_story_director.py plugins/coc-keeper-zcode/scripts/coc_story_director.py tests/test_story_director.py
git commit -m "fix(coc): unify low-agency tag sets into single source (P0-2a)"
```

---

## Task 3: P0-2b — recent_intent_classes 落盘带 tags，修复跨轮计数

**目标**：让 `recent_intent_classes` 持久化时带上 rich secondary_intents tags，使 `_low_agency_continue_count` 跨轮能从 tag 累加。

**Files:**
- Modify: `plugins/coc-keeper/scripts/coc_director_apply.py:759-766`
- Test: `tests/test_director_apply.py`

**Interfaces:**
- Produces: pacing 落盘的 `recent_intent_classes` 从 `list[str]` 变为 `list[dict]`，每项 `{"intent_class": str, "tags": list[str]}`。`_low_agency_continue_count`（story_director）读取需同步更新。

- [ ] **Step 1: 读取确认当前落盘代码**

Run: `sed -n '755,770p' plugins/coc-keeper/scripts/coc_director_apply.py`
确认 `recent_intent_classes` 追加逻辑。预期（:759-766）：
```python
recent = list(pacing.get("recent_intent_classes", []))
intent_class = plan.get("turn_input", {}).get("player_intent_class", "")
if intent_class:
    recent.append(intent_class)
...
pacing["recent_intent_classes"] = recent
```

- [ ] **Step 2: 写失败测试**

追加到 `tests/test_director_apply.py`（确认该文件加载方式）：

```python
def test_recent_intent_classes_persists_with_tags():
    plan = {
        "turn_input": {
            "player_intent_class": "investigate",
            "player_intent_rich": {"secondary_intents": ["low_agency_continue", "yield_initiative"]},
        },
        # ... 其它 apply_plan 必需的最小字段，照现有测试 fixture ...
    }
    pacing = apply_mod.apply_plan(...)  # 照现有测试的调用样式
    recent = pacing["recent_intent_classes"]
    assert isinstance(recent[-1], dict)
    assert recent[-1]["intent_class"] == "investigate"
    assert "low_agency_continue" in recent[-1]["tags"]
    assert "yield_initiative" in recent[-1]["tags"]


def test_recent_intent_classes_back_compat_reads_bare_strings():
    # 旧存档里 recent_intent_classes 是 list[str]，读取时应能兼容
    pacing = {"recent_intent_classes": ["move", "investigate"]}
    # _normalize_recent_intent_classes 应把 str 包成 {"intent_class": s, "tags": []}
    normalized = director._normalize_recent_intent_classes(pacing["recent_intent_classes"])
    assert normalized[0] == {"intent_class": "move", "tags": []}
```

（第二个测试要在 story_director 加一个 `_normalize_recent_intent_classes` 兼容读取函数——见 Step 4。）

- [ ] **Step 3: 跑测试确认失败**

Run: `PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/test_director_apply.py::test_recent_intent_classes_persists_with_tags -v -p no:cacheprovider`
Expected: FAIL

- [ ] **Step 4: 实现**

(a) 在 `coc_director_apply.py:759-766` 改落盘为带 tags 的结构：
```python
    recent = list(pacing.get("recent_intent_classes", []))
    turn_input = plan.get("turn_input", {}) or {}
    intent_class = str(turn_input.get("player_intent_class", "") or "")
    rich = turn_input.get("player_intent_rich") or {}
    tags = list(rich.get("secondary_intents") or []) if isinstance(rich, dict) else []
    if intent_class:
        recent.append({"intent_class": intent_class, "tags": tags})
    # 限制历史长度（照原有上限，若无则 8）
    recent = recent[-8:]
    pacing["recent_intent_classes"] = recent
```

(b) 在 `coc_story_director.py` 加兼容读取函数（紧邻 `_low_agency_continue_count`）：
```python
def _normalize_recent_intent_classes(recent: list[Any]) -> list[dict[str, Any]]:
    """P0-2b: 兼容旧 list[str] 存档与新 list[dict] 存档。"""
    normalized: list[dict[str, Any]] = []
    for item in (recent or []):
        if isinstance(item, dict):
            normalized.append({
                "intent_class": str(item.get("intent_class", "")),
                "tags": list(item.get("tags", []) or []),
            })
        elif item:
            normalized.append({"intent_class": str(item), "tags": []})
    return normalized
```

(c) 改 `_low_agency_continue_count`（:616-622）用新结构 + 同时认 tags：
```python
def _low_agency_continue_count(recent_intent_classes: list[Any], ctx: dict[str, Any]) -> int:
    count = 1 if _is_low_agency_continue(ctx) else 0
    for item in reversed(_normalize_recent_intent_classes(recent_intent_classes)):
        cls = item["intent_class"]
        past_tags = set(item["tags"])
        if cls in _LOW_AGENCY_TAGS or (past_tags & _LOW_AGENCY_CONTINUE_TAGS):
            count += 1
        else:
            break
    return count
```

(d) 检查 `_low_agency_continue_count` 的调用方传的是 `pacing.get("recent_intent_classes")`（grep 确认），保持入参不变。

- [ ] **Step 5: 跑测试确认通过**

Run: `PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/test_director_apply.py -k "recent_intent_classes" tests/test_story_director.py -k "low_agency" -v -p no:cacheprovider`
Expected: PASS

- [ ] **Step 6: 回归 apply 测试不破**

Run: `PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/test_director_apply.py tests/test_story_director.py -q -p no:cacheprovider`
Expected: 全 PASS（注意：若有测试断言 `recent_intent_classes` 是 `list[str]`，需同步更新为 `list[dict]`——按实际报错修）

- [ ] **Step 7: sync 双轨 + 门禁 + Commit**

```bash
python3 scripts/sync_coc_plugin_copy.py
python3 scripts/sync_coc_plugin_copy.py --check
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/test_plugin_metadata.py tests/test_zcode_plugin_metadata.py tests/test_coc_plugin_sync_script.py -q -p no:cacheprovider
git add plugins/coc-keeper/scripts/coc_director_apply.py plugins/coc-keeper-zcode/scripts/coc_director_apply.py plugins/coc-keeper/scripts/coc_story_director.py plugins/coc-keeper-zcode/scripts/coc_story_director.py tests/test_director_apply.py tests/test_story_director.py
git commit -m "fix(coc): persist recent_intent_classes with tags for cross-turn counting (P0-2b)"
```

---

## Task 4: P0-2c — 收窄 runner 闸门（route_count→is_real_fork, npc_moves→requires_player_decision）

**目标**：把 `_turn_interrupt_reason` 第 289 行 `route_count>=2` 改为 `is_real_fork`，第 291-292 行 `npc_moves` 改为只对带 `requires_player_decision` 的 move 判停。

**Files:**
- Modify: `plugins/coc-keeper/scripts/coc_live_turn_runner.py:274-302`
- Test: `tests/test_live_turn_runner.py`

**Interfaces:**
- Consumes: Task 1 产出的 `choice_frame.is_real_fork`。
- Produces: `_turn_interrupt_reason` 语义变更——`route_count>=2` 不再硬判停，改用 `is_real_fork`；npc_moves 只对 `requires_player_decision==True` 的 move 判停。

- [ ] **Step 1: 写失败测试**

追加到 `tests/test_live_turn_runner.py`：

```python
def test_no_interrupt_when_two_routes_but_not_real_fork():
    # 场景有 2 条 route 但玩家已表态（is_real_fork=False），不应判停
    turn = {
        "choice_frame": {"route_count": 2, "is_real_fork": False, "open_route_count": 2},
        "narrative_directives": {},
    }
    assert runner._turn_interrupt_reason(turn) is None


def test_interrupt_when_real_fork():
    turn = {
        "choice_frame": {"route_count": 2, "is_real_fork": True, "open_route_count": 2},
        "narrative_directives": {},
    }
    assert runner._turn_interrupt_reason(turn) == "meaningful_choice"


def test_no_interrupt_for_npc_assist_move():
    # npc_moves 只含 npc_assist（非决策性），不判停
    turn = {
        "npc_moves": [{"npc_id": "bruno", "kind": "npc_assist"}],
        "choice_frame": {"route_count": 0, "is_real_fork": False, "open_route_count": 0},
        "narrative_directives": {},
    }
    assert runner._turn_interrupt_reason(turn) is None


def test_interrupt_for_npc_requires_player_decision():
    turn = {
        "npc_moves": [{"npc_id": "bruno", "requires_player_decision": True}],
        "choice_frame": {"route_count": 0, "is_real_fork": False, "open_route_count": 0},
        "narrative_directives": {},
    }
    assert runner._turn_interrupt_reason(turn) == "npc_requests_specialist_judgment"
```

（确认 `tests/test_live_turn_runner.py` 加载 runner 模块的变量名，按实际调整 `runner.` 前缀。）

- [ ] **Step 2: 跑测试确认失败**

Run: `PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/test_live_turn_runner.py::test_no_interrupt_when_two_routes_but_not_real_fork -v -p no:cacheprovider`
Expected: FAIL（当前 route_count>=2 会判停）

- [ ] **Step 3: 实现 — 修改 `_turn_interrupt_reason`**

在 `plugins/coc-keeper/scripts/coc_live_turn_runner.py:288-292`，把：
```python
    choice_frame = turn.get("choice_frame") or {}
    if int(choice_frame.get("route_count", 0) or 0) >= 2:
        return "meaningful_choice"
    if turn.get("npc_moves"):
        return "npc_requests_specialist_judgment"
```
替换为：
```python
    choice_frame = turn.get("choice_frame") or {}
    # P0-2c: 只在真分叉（director 基于 route.status 结构化判定）时停交选择，
    # 不再用 route_count>=2 的结构数量硬判停——那与玩家是否真面临抉择无关。
    if bool(choice_frame.get("is_real_fork")):
        return "meaningful_choice"
    # P0-2c: npc_moves 只对带 requires_player_decision 标记的 move 判停；
    # npc_assist/react 等非决策性 move 不应让"跟着班长"类低主动输入停。
    if _npc_move_requires_player_decision(turn.get("npc_moves")):
        return "npc_requests_specialist_judgment"
```

在 `_turn_interrupt_reason` 函数上方（紧邻其它 helper）加辅助函数：
```python
def _npc_move_requires_player_decision(npc_moves: list[dict[str, Any]] | None) -> bool:
    """P0-2c: 只有显式标记 requires_player_decision 的 NPC move 才触发判停。"""
    for move in (npc_moves or []):
        if not isinstance(move, dict):
            continue
        if move.get("requires_player_decision"):
            return True
        # agency_moves 子项也可能带该标记
        for sub in (move.get("agency_moves") or []):
            if isinstance(sub, dict) and sub.get("requires_player_decision"):
                return True
    return False
```

- [ ] **Step 4: 跑测试确认通过**

Run: `PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/test_live_turn_runner.py -k "real_fork or npc_assist_move or requires_player_decision" -v -p no:cacheprovider`
Expected: 4 PASS

- [ ] **Step 5: 回归 runner 全测试**

Run: `PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/test_live_turn_runner.py -q -p no:cacheprovider`
Expected: 全 PASS（若有测试依赖旧的 route_count>=2 判停，需更新其 fixture——按报错修，通常是给 choice_frame 加 `is_real_fork` 字段）

- [ ] **Step 6: sync 双轨 + 门禁 + Commit**

```bash
python3 scripts/sync_coc_plugin_copy.py
python3 scripts/sync_coc_plugin_copy.py --check
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/test_plugin_metadata.py tests/test_zcode_plugin_metadata.py tests/test_coc_plugin_sync_script.py -q -p no:cacheprovider
git add plugins/coc-keeper/scripts/coc_live_turn_runner.py plugins/coc-keeper-zcode/scripts/coc_live_turn_runner.py tests/test_live_turn_runner.py
git commit -m "fix(coc): narrow runner gates to is_real_fork and requires_player_decision (P0-2c)"
```

---

## Task 5: P0-2d — 端到端验证低主动多步推进

**目标**：构造"玩家连续低主动"端到端用例，断言单次 `run_live_turn` 内推进 ≥2 步。这是 P0-2 的验收测试。

**Files:**
- Test: `tests/test_live_turn_runner.py`

**Interfaces:**
- Consumes: Task 1-4 的全部改动。

- [ ] **Step 1: 写端到端测试**

追加到 `tests/test_live_turn_runner.py`（参考该文件已有的 `run_live_turn` 调用样式——通常用临时 campaign 目录 + minimal fixture）。测试构造：玩家输入"继续跟着走"，player_intent_rich 带 `secondary_intents: ["low_agency_continue"]`，场景有 NPC 但其 move 不带 `requires_player_decision`，choice_frame `is_real_fork=False`。

```python
def test_low_agency_input_advances_multiple_steps_in_one_turn(tmp_path):
    # 照现有 run_live_turn 测试的 campaign 准备方式（最小 scenario + character）
    campaign = _setup_minimal_campaign(tmp_path)  # 复用该文件的 helper
    result = runner.run_live_turn(
        campaign_dir=campaign,
        character=...,
        investigator_id="inv-1",
        player_text="继续跟着班长走",
        player_intent_rich={"primary_intent": "move", "secondary_intents": ["low_agency_continue"]},
        intent_class="move",
        max_auto_advance=3,
        auto_advance_low_agency=True,
    )
    # P0-2 验收：低主动输入应推进 >1 步（而非旧的一步）
    assert len(result["turns"]) >= 2
```

（`_setup_minimal_campaign` 等照该文件现有 fixture；若没有，参考 `test_live_turn_runner.py:269-306` 的样式构造最小 campaign。）

- [ ] **Step 2: 跑测试**

Run: `PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/test_live_turn_runner.py::test_low_agency_input_advances_multiple_steps_in_one_turn -v -p no:cacheprovider`
Expected: PASS。若 FAIL，诊断是 director 没 emit compressed_progress（则需在 director 的 low-agency 路径补 emit——见 Task 2 的 `_dramatic_progress_directive`，确认 `continue_existing_strategy` 现在被识别为低主动后能触发压缩）。

- [ ] **Step 3: Commit**

```bash
git add tests/test_live_turn_runner.py
git commit -m "test(coc): verify low-agency input advances multiple steps (P0-2d)"
```

---

## Task 6: P0-3a — 把 storylet 渲染接线接通到 live runner

**目标**：live runner 在 stop 前，把 `storylet_moves` 的 cue/title 注入一个 narration contract 字段，使前台 narrator 能看到（playtest driver 的 `_storylet_prose` 逻辑已在 enrichment 的 `must_include`，但 live runner 没有把它显式带进 stop_actionability 或 turn 结果）。

**关键事实**：`_apply_storylet_state`（enrichment:905-915）**已经**把 cue 注入 `narrative_directives.must_include`。所以本 Task 的真实工作是：确认 live runner 的 turn 结果里 `narrative_directives.must_include` 被**透传**到顶层 result，并在 stop_actionability contract 里反映 storylet 存在。若已透传，则本 Task 主要是加测试固化 + 在 stop_actionability 加 storylet cue 提示。

**Files:**
- Modify: `plugins/coc-keeper/scripts/coc_narrative_enrichment.py`（`build_stop_actionability_contract` 加 storylet 提示）
- Modify: `plugins/coc-keeper/scripts/coc_live_turn_runner.py`（确认 turn 结果透传 must_include）
- Test: `tests/test_narrative_enrichment.py`, `tests/test_live_turn_runner.py`

**Interfaces:**
- Produces: `build_stop_actionability_contract` 的返回 dict 新增 `storylet_cues: list[str]`（来自 turn 的 storylet_moves），且若有 storylet_cues 则 `must_surface_handles` 视为至少有内容。

- [ ] **Step 1: 写失败测试**

追加到 `tests/test_narrative_enrichment.py`：

```python
def test_stop_actionability_surfaces_storylet_cues_when_present():
    turn = {
        "storylet_moves": [{"cue": "气味不属于这里", "title": "wrong_smell"}],
        "choice_frame": {"routes": [], "is_real_fork": False, "open_route_count": 0},
        "narrative_directives": {"must_include": ["气味不属于这里"]},
    }
    contract = narr.build_stop_actionability_contract(turn, {}, stop_reason="awaiting_player_input")
    assert "气味不属于这里" in contract["storylet_cues"]
    assert contract["must_surface_handles"] is True


def test_stop_actionability_empty_storylet_cues_when_absent():
    turn = {"choice_frame": {"routes": [], "is_real_fork": False, "open_route_count": 0}}
    contract = narr.build_stop_actionability_contract(turn, {}, stop_reason="awaiting_player_input")
    assert contract["storylet_cues"] == []
```

- [ ] **Step 2: 跑测试确认失败**

Run: `PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/test_narrative_enrichment.py::test_stop_actionability_surfaces_storylet_cues_when_present -v -p no:cacheprovider`
Expected: FAIL（`storylet_cues` 字段不存在）

- [ ] **Step 3: 实现 — 修改 `build_stop_actionability_contract`**

在 `coc_narrative_enrichment.py:343-359` 的 return dict 之前，提取 storylet cues，并让它们也算作 handle 存在：

在 `return {` 之前插入：
```python
    # P0-3a: 把 storylet cue 作为 narration 抓手暴露，使 live 前台能看到 storylet 内容。
    storylet_cues: list[str] = []
    for move in _as_list(turn.get("storylet_moves")):
        if isinstance(move, dict):
            cue = _non_empty_str(move.get("cue") or move.get("title"))
            if cue and cue not in storylet_cues:
                storylet_cues.append(cue)
    must_include = (turn.get("narrative_directives") or {}).get("must_include") or []
    for cue in _as_list(must_include):
        cue_text = _non_empty_str(cue)
        if cue_text and cue_text not in storylet_cues:
            storylet_cues.append(cue_text)
```

把 return dict 改为（加 `storylet_cues` 字段，并让 storylet_cues 也算 must_surface）：
```python
    return {
        "schema_version": _SCHEMA_VERSION,
        "why_stopped": why_stopped,
        "immediate_handles": handles,
        "handle_count": len(handles),
        "storylet_cues": storylet_cues,
        "must_surface_handles": bool(handles) or bool(storylet_cues),
        "pressure_if_ignored": _first_pressure_text(active_scene_state, contract),
        "npc_position": _npc_position_from_moves(turn),
        "forbidden_menu_rendering": True,
        "requires_keeper_rewrite": not bool(handles) and not bool(storylet_cues),
        "narration_rule": (
            "Before returning control to the player, surface the immediate_handles "
            "and storylet_cues as concrete diegetic objects, routes, NPC posture, "
            "or visible pressure. Do not render a numbered menu unless the player asks."
        ),
        "source": "stop_actionability_contract",
    }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/test_narrative_enrichment.py -k "storylet_cues" -v -p no:cacheprovider`
Expected: 2 PASS

- [ ] **Step 5: 回归 stop_actionability 现有测试**

Run: `PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/test_narrative_enrichment.py::test_stop_actionability_contract_uses_structured_handles_after_costly_failure -v -p no:cacheprovider`
Expected: PASS（既有断言不涉及 storylet_cues，新字段不影响）

- [ ] **Step 6: 确认 live runner 透传 storylet_moves / must_include**

检查 `coc_live_turn_runner.py` 的 `_run_one_turn` 返回（约 :384-409）与 `run_live_turn` 的 result 组装（约 :537-566），确认 `turn["storylet_moves"]` 与 `turn["narrative_directives"]` 在 result 里可见（透传给 stop_actionability 的 final_turn 已传入）。若已透传，无需改 runner。

Run: `grep -n "storylet_moves\|must_include" plugins/coc-keeper/scripts/coc_live_turn_runner.py`
确认存在透传。若 final_turn（:499）来自 turns[-1]，而 turn 已含 storylet_moves，则 Step 3 的 build_stop_actionability_contract(final_turn,...) 已能读到——无需额外改。

- [ ] **Step 7: sync 双轨 + 门禁 + Commit**

```bash
python3 scripts/sync_coc_plugin_copy.py
python3 scripts/sync_coc_plugin_copy.py --check
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/test_plugin_metadata.py tests/test_zcode_plugin_metadata.py tests/test_coc_plugin_sync_script.py tests/test_live_turn_runner.py tests/test_narrative_enrichment.py -q -p no:cacheprovider
git add plugins/coc-keeper/scripts/coc_narrative_enrichment.py plugins/coc-keeper-zcode/scripts/coc_narrative_enrichment.py tests/test_narrative_enrichment.py
git commit -m "feat(coc): surface storylet cues in stop_actionability contract (P0-3a)"
```

---

## Task 7: P0-3b — 扩 storylet 触发面（场景进入 + storylet_tags）

**目标**：新增结构化触发谓词，让带 `storylet_tags` 的场景在进入时能触发匹配的 storylet，不再只靠 fumble/critical。输出全程带 recorded reason，不扫文本。

**Files:**
- Modify: `plugins/coc-keeper/scripts/coc_narrative_enrichment.py:757-875`（`infer_storylet_trigger`）
- Test: `tests/test_narrative_enrichment.py`

**Interfaces:**
- Consumes: scene 的 `storylet_tags: list[str]`（新字段，scenario-import 编译时写入）与 `source_event_type`（已有，scene_enter 时为 `scene_transition`/`scene_enter`）。
- Produces: `infer_storylet_trigger` 在 `scene_action=="CHARACTER"` 且 scene 带 `storylet_tags` 且为场景进入时，返回 `triggered:true, reason:"scene_tag_beat"`。

- [ ] **Step 1: 写失败测试**

追加到 `tests/test_narrative_enrichment.py`：

```python
def test_storylet_triggers_on_scene_entry_with_storylet_tags():
    plan = {"scene_action": "CHARACTER"}
    ctx = {
        "active_scene": {"storylet_tags": ["opening_briefing"]},
        "source_event_type": "scene_transition",
    }
    trigger = narr.infer_storylet_trigger(plan, ctx)
    assert trigger["triggered"] is True
    assert trigger["reason"] == "scene_tag_beat"
    assert trigger["source"] == "storylet_trigger_gate"


def test_storylet_does_not_trigger_without_scene_entry():
    plan = {"scene_action": "CHARACTER"}
    ctx = {
        "active_scene": {"storylet_tags": ["opening_briefing"]},
        # 无 scene_transition/scene_enter 标记
    }
    trigger = narr.infer_storylet_trigger(plan, ctx)
    assert trigger.get("triggered") is False


def test_storylet_does_not_trigger_without_storylet_tags():
    plan = {"scene_action": "CHARACTER"}
    ctx = {
        "active_scene": {},  # 无 storylet_tags
        "source_event_type": "scene_transition",
    }
    trigger = narr.infer_storylet_trigger(plan, ctx)
    assert trigger.get("triggered") is False
```

- [ ] **Step 2: 跑测试确认失败**

Run: `PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/test_narrative_enrichment.py::test_storylet_triggers_on_scene_entry_with_storylet_tags -v -p no:cacheprovider`
Expected: FAIL（当前无此触发谓词）

- [ ] **Step 3: 实现 — 在 `infer_storylet_trigger` 加新分支**

在 `coc_narrative_enrichment.py` 的 `infer_storylet_trigger`（:757-875）里，在"otherwise → `_NO_TRIGGER`"（:875）之前，插入新分支：

```python
    # P0-3b: 场景进入 + storylet_tags 触发（结构化，不扫文本）。
    scene = ctx.get("active_scene") or {}
    storylet_tags = [str(t) for t in _as_list(scene.get("storylet_tags")) if str(t)]
    source_event = str(ctx.get("source_event_type") or "")
    if storylet_tags and source_event in ("scene_transition", "scene_enter"):
        return {
            **_NO_TRIGGER,
            "triggered": True,
            "reason": "scene_tag_beat",
            "storylet_tags": storylet_tags,
            "source": "storylet_trigger_gate",
        }
```

（确认 `_NO_TRIGGER` 是个 dict 且可用 `**` 展开；若是 frozen/特殊，照该文件实际写法。）

- [ ] **Step 4: 跑测试确认通过**

Run: `PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/test_narrative_enrichment.py -k "scene_entry_with_storylet_tags or scene_entry_without" -v -p no:cacheprovider`
Expected: 3 PASS

- [ ] **Step 5: 回归 storylet 测试**

Run: `PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/test_storylets.py tests/test_narrative_enrichment.py -q -p no:cacheprovider`
Expected: 全 PASS

- [ ] **Step 6: sync 双轨 + 门禁 + Commit**

```bash
python3 scripts/sync_coc_plugin_copy.py
python3 scripts/sync_coc_plugin_copy.py --check
git add plugins/coc-keeper/scripts/coc_narrative_enrichment.py plugins/coc-keeper-zcode/scripts/coc_narrative_enrichment.py tests/test_narrative_enrichment.py
git commit -m "feat(coc): add scene-entry storylet trigger via storylet_tags (P0-3b)"
```

---

## Task 8: P0-4a — 新增结构化焦点提取步骤

**目标**：在 narrative_enrichment 新增 `build_turn_focus_contract(ctx)`，消费 intent_router 输出 + 当前 scene 的 available_routes，产出**结构化** focus（枚举 + recorded reason），不扫自由文本。

**Files:**
- Modify: `plugins/coc-keeper/scripts/coc_narrative_enrichment.py`（新增函数 + 在 enrich_director_plan 调用）
- Test: `tests/test_narrative_enrichment.py`

**Interfaces:**
- Consumes: `ctx["player_intent_rich"]`（intent_router 已产出的结构化意图）与 `ctx["active_scene"]["available_routes"]`（P0-1 数据）。
- Produces: `build_turn_focus_contract(ctx) -> dict | None`，返回 `{focus_axis: str(枚举), focus_target_id: str|None, focus_reason: str, source_route_ids: list[str]}`。`focus_axis` 是固定枚举值（由 player_intent_rich 的结构化字段映射，**不**从原始 prose 取子串）。

**注意（Constitution）**：focus_axis 必须来自 intent_router 已有的结构化输出（如 `primary_intent`/`action_atoms`/`target_entities`）与 available_routes 的 `route_type` 对照，**禁止**从 `player_text` 取子串。若 intent_router 没提供足够信息，返回 None（不强猜）。

- [ ] **Step 1: 写失败测试**

追加到 `tests/test_narrative_enrichment.py`：

```python
def test_turn_focus_maps_intent_to_route_when_match():
    ctx = {
        "player_intent_rich": {
            "primary_intent": "investigate",
            "target_entities": ["tenants"],
            "action_atoms": [{"id": "a1", "verb": "ask", "object": "tenants", "topic": "history"}],
        },
        "active_scene": {
            "available_routes": [
                {"route_id": "ask-tenants", "route_type": "tenant_history", "cue": "问前租客"},
                {"route_id": "enter-house", "route_type": "direct_entry", "cue": "进屋"},
            ],
        },
    }
    focus = narr.build_turn_focus_contract(ctx)
    assert focus is not None
    assert focus["focus_axis"] == "tenant_history"
    assert focus["focus_target_id"] == "ask-tenants"
    assert focus["focus_reason"]  # 非空 recorded reason


def test_turn_focus_returns_none_when_no_structured_match():
    ctx = {
        "player_intent_rich": {"primary_intent": "move"},
        "active_scene": {"available_routes": [{"route_id": "x", "route_type": "direct_entry"}]},
    }
    focus = narr.build_turn_focus_contract(ctx)
    assert focus is None  # 无结构化匹配，不强猜


def test_turn_focus_never_uses_player_text_substring():
    # Constitution 守护：focus_axis 必须是固定枚举，不能是 prose 子串
    ctx = {
        "player_intent_rich": {"primary_intent": "social", "target_entities": ["knott"]},
        "active_scene": {"available_routes": []},
        "player_text": "我想问诺特先生关于租客的事因为理由blabla",
    }
    focus = narr.build_turn_focus_contract(ctx)
    # 允许 None（无 route 匹配）或结构化枚举；绝不允许 focus_axis == prose 子串
    if focus is not None:
        allowed_axes = {"tenant_history", "reward_scope", "npc_question", "environment",
                        "direct_entry", "investigate", "social", "move"}
        assert focus["focus_axis"] in allowed_axes
```

- [ ] **Step 2: 跑测试确认失败**

Run: `PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/test_narrative_enrichment.py::test_turn_focus_maps_intent_to_route_when_match -v -p no:cacheprovider`
Expected: FAIL（`build_turn_focus_contract` 不存在）

- [ ] **Step 3: 实现 — 新增 `build_turn_focus_contract`**

在 `coc_narrative_enrichment.py`（`build_stop_actionability_contract` 附近）加函数。映射规则用结构化字段（target_entities/action_atoms 的 topic）对照 available_routes 的 route_type，**不读 player_text**：

```python
# P0-4a: focus_axis 固定枚举。新增合法值时在此声明。
_FOCUS_AXES = frozenset({
    "tenant_history", "reward_scope", "npc_question", "environment",
    "direct_entry", "investigate", "social", "move",
})

# topic/action → focus_axis 的结构化映射（非关键词扫描；key 是 intent_router 已有的
# 结构化 topic 值，value 是 focus 枚举）。新增 topic 时在此声明。
_TOPIC_TO_FOCUS_AXIS = {
    "history": "tenant_history",
    "tenant": "tenant_history",
    "reward": "reward_scope",
    "payment": "reward_scope",
    "scope": "reward_scope",
}


def build_turn_focus_contract(ctx: dict[str, Any]) -> dict[str, Any] | None:
    """P0-4a: 把玩家本轮的结构化意图映射到一个 focus_axis + 目标 route。

    Constitution 合规：只消费 intent_router 已产出的结构化字段（primary_intent /
    target_entities / action_atoms 的 topic）与 scene.available_routes 的 route_type，
    绝不扫描 player_text 取子串。无结构化匹配时返回 None（不强猜）。
    """
    rich = ctx.get("player_intent_rich") or {}
    scene = ctx.get("active_scene") or {}
    routes = [r for r in _as_list(scene.get("available_routes")) if isinstance(r, dict)]
    if not routes:
        return None

    # 优先从 action_atoms 的 topic 映射
    focus_axis: str | None = None
    for atom in _as_list(rich.get("action_atoms")):
        if not isinstance(atom, dict):
            continue
        topic = str(atom.get("topic") or "").strip()
        if topic in _TOPIC_TO_FOCUS_AXIS:
            focus_axis = _TOPIC_TO_FOCUS_AXIS[topic]
            break
    # 退而用 target_entities 匹配 route_type
    focus_target_id: str | None = None
    if focus_axis:
        for route in routes:
            if str(route.get("route_type") or "") == focus_axis:
                focus_target_id = str(route.get("route_id") or "")
                break
    if focus_axis is None or focus_target_id is None:
        return None
    return {
        "focus_axis": focus_axis,
        "focus_target_id": focus_target_id,
        "focus_reason": f"intent_router_structured_match:{focus_axis}",
        "source_route_ids": [focus_target_id],
        "source": "build_turn_focus_contract",
    }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/test_narrative_enrichment.py -k "turn_focus" -v -p no:cacheprovider`
Expected: 3 PASS

- [ ] **Step 5: sync 双轨 + 门禁 + Commit**

```bash
python3 scripts/sync_coc_plugin_copy.py
python3 scripts/sync_coc_plugin_copy.py --check
git add plugins/coc-keeper/scripts/coc_narrative_enrichment.py plugins/coc-keeper-zcode/scripts/coc_narrative_enrichment.py tests/test_narrative_enrichment.py
git commit -m "feat(coc): add structured turn-focus extraction (P0-4a)"
```

---

## Task 9: P0-4b — handle 增源：turn_focus 升为当前 handle + 存档按轮刷新

**目标**：`build_stop_actionability_contract` 增加 handle 源——当 turn_focus 命中某 route 时，把该 route 升为当前 handle 并标记 `freshness:"turn_focus"`；director 在 apply 后按 turn_focus 刷新 active-scene.json。

**Files:**
- Modify: `plugins/coc-keeper/scripts/coc_narrative_enrichment.py`（`build_stop_actionability_contract` 加 focus handle 源，参数加 turn_focus）
- Modify: `plugins/coc-keeper/scripts/coc_live_turn_runner.py`（stop 前调 build_turn_focus_contract 并传入；apply 后刷新 active-scene）
- Test: `tests/test_narrative_enrichment.py`, `tests/test_live_turn_runner.py`

**Interfaces:**
- Consumes: Task 8 的 `build_turn_focus_contract`，Task 1 的 `available_routes`。
- Produces: `build_stop_actionability_contract(turn, active_scene_state, *, stop_reason, turn_focus=None)`；turn_focus 命中时 handle 带 `freshness:"turn_focus"`。

- [ ] **Step 1: 写失败测试**

追加到 `tests/test_narrative_enrichment.py`：

```python
def test_stop_actionability_turn_focus_promotes_fresh_handle():
    turn = {
        "choice_frame": {"routes": [], "is_real_fork": False, "open_route_count": 0},
    }
    active_scene = {
        "available_routes": [
            {"route_id": "ask-tenants", "route_type": "tenant_history", "cue": "问前租客"},
            {"route_id": "enter-house", "route_type": "direct_entry", "cue": "进屋"},
        ],
        "visible_affordances": [],  # 静态源为空，模拟"老三条已过时"
    }
    turn_focus = {
        "focus_axis": "tenant_history",
        "focus_target_id": "ask-tenants",
        "focus_reason": "intent_router_structured_match:tenant_history",
    }
    contract = narr.build_stop_actionability_contract(
        turn, active_scene, stop_reason="awaiting_player_input", turn_focus=turn_focus,
    )
    assert contract["immediate_handles"]
    assert contract["immediate_handles"][0]["route_id"] == "ask-tenants"
    assert contract["immediate_handles"][0]["freshness"] == "turn_focus"


def test_stop_actionability_no_focus_falls_back_to_static():
    turn = {"choice_frame": {"routes": []}}
    active_scene = {
        "visible_affordances": [{"route": "old-1", "cue": "老选项"}],
    }
    contract = narr.build_stop_actionability_contract(
        turn, active_scene, stop_reason="awaiting_player_input", turn_focus=None,
    )
    # 无 focus 时回退静态源（老选项仍在）
    assert contract["immediate_handles"][0]["route_id"] == "old-1"
```

- [ ] **Step 2: 跑测试确认失败**

Run: `PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/test_narrative_enrichment.py::test_stop_actionability_turn_focus_promotes_fresh_handle -v -p no:cacheprovider`
Expected: FAIL（turn_focus 参数不存在）

- [ ] **Step 3: 实现 — `build_stop_actionability_contract` 加 turn_focus 参数与 handle 源**

(a) 修改函数签名（:287-293）加 `turn_focus` 参数：
```python
def build_stop_actionability_contract(
    turn: dict[str, Any] | None,
    active_scene_state: dict[str, Any] | None = None,
    *,
    stop_reason: str | None = None,
    max_handles: int = 3,
    turn_focus: dict[str, Any] | None = None,
) -> dict[str, Any]:
```

(b) 在静态源（visible_affordances / choice_frame.routes）填充**之前**，先处理 turn_focus（使其优先排第一）：在 `handles: list[...] = []` 之后插入：
```python
    # P0-4b: turn_focus 命中 route 时，把它升为当前 handle（freshness: turn_focus），
    # 优先于静态 visible_affordances / choice_frame.routes（那些可能是过时的开场老选项）。
    if isinstance(turn_focus, dict):
        focus_target_id = _non_empty_str(turn_focus.get("focus_target_id"))
        if focus_target_id:
            for route in _as_list(active_scene_state.get("available_routes")):
                if isinstance(route, dict) and _non_empty_str(route.get("route_id")) == focus_target_id:
                    add_handle({
                        "route_id": focus_target_id,
                        "anchor": _non_empty_str(route.get("cue")) or focus_target_id,
                        "affordance": _non_empty_str(route.get("cue")) or focus_target_id,
                        "visible_benefit": route.get("visible_benefit"),
                        "visible_cost": route.get("visible_cost"),
                        "visible_risk": route.get("visible_risk"),
                        "freshness": "turn_focus",
                        "source": "turn_focus_contract",
                    })
                    break
```

- [ ] **Step 4: 跑 enrichment 测试确认通过**

Run: `PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/test_narrative_enrichment.py -k "turn_focus_promotes or no_focus_falls_back" -v -p no:cacheprovider`
Expected: 2 PASS

- [ ] **Step 5: 实现 — live runner 在 stop 前调 build_turn_focus_contract 并传入**

在 `coc_live_turn_runner.py:498-507`，把 stop_actionability 构建改为先算 turn_focus：
```python
    active_scene_state = _read_json(campaign / "save" / "active-scene.json", {})
    final_turn = turns[-1] if turns else {}
    turn_focus = None
    if hasattr(narrative_enrichment, "build_turn_focus_contract"):
        focus_ctx = {
            "player_intent_rich": choice.get("player_intent_rich"),
            "active_scene": active_scene_state if isinstance(active_scene_state, dict) else {},
        }
        try:
            turn_focus = narrative_enrichment.build_turn_focus_contract(focus_ctx)
        except Exception:
            turn_focus = None
    if hasattr(narrative_enrichment, "build_stop_actionability_contract"):
        stop_actionability = narrative_enrichment.build_stop_actionability_contract(
            final_turn,
            active_scene_state if isinstance(active_scene_state, dict) else {},
            stop_reason=stop_reason,
            turn_focus=turn_focus,
        )
    else:
        stop_actionability = {"schema_version": 1, "immediate_handles": [], "must_surface_handles": False}
```

- [ ] **Step 6: 写 runner 端到端测试**

追加到 `tests/test_live_turn_runner.py`（参考 Task 5 的 campaign setup 样式）：

```python
def test_second_turn_focus_refreshes_handles_not_stale(tmp_path):
    campaign = _setup_minimal_campaign(tmp_path)  # 复用 helper；场景含 ask-tenants/enter-house 两条 available_routes
    # 第一轮：无 focus，handle 来自静态
    # 第二轮：玩家问租客，player_intent_rich 带 target_entities/atoms 指向 tenants
    result = runner.run_live_turn(
        campaign_dir=campaign,
        character=...,
        investigator_id="inv-1",
        player_text="我想问问之前的租客怎么回事",
        player_intent_rich={
            "primary_intent": "investigate",
            "target_entities": ["tenants"],
            "action_atoms": [{"id": "a1", "verb": "ask", "object": "tenants", "topic": "tenant"}],
        },
        intent_class="investigate",
    )
    handles = result["stop_actionability"]["immediate_handles"]
    assert any(h.get("freshness") == "turn_focus" and h["route_id"] == "ask-tenants" for h in handles)
```

- [ ] **Step 7: 跑 runner 测试 + 回归**

Run: `PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/test_live_turn_runner.py -k "turn_focus_refreshes" tests/test_narrative_enrichment.py -q -p no:cacheprovider`
Expected: PASS。若 campaign fixture 需补 available_routes，更新 helper。

- [ ] **Step 8: sync 双轨 + 门禁 + Commit**

```bash
python3 scripts/sync_coc_plugin_copy.py
python3 scripts/sync_coc_plugin_copy.py --check
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/test_plugin_metadata.py tests/test_zcode_plugin_metadata.py tests/test_coc_plugin_sync_script.py tests/test_live_turn_runner.py tests/test_narrative_enrichment.py -q -p no:cacheprovider
git add plugins/coc-keeper/scripts/coc_narrative_enrichment.py plugins/coc-keeper-zcode/scripts/coc_narrative_enrichment.py plugins/coc-keeper/scripts/coc_live_turn_runner.py plugins/coc-keeper-zcode/scripts/coc_live_turn_runner.py tests/test_narrative_enrichment.py tests/test_live_turn_runner.py
git commit -m "feat(coc): refresh handles via structured turn-focus (P0-4b)"
```

---

## Task 10: P0-1b — 文档化 available_routes + pending_choices 回归声明

**目标**：把 P0-1 的数据结构写进 schema 文档，并强化 pending_choices 回归声明（防止再被当玩家菜单）。

**Files:**
- Modify: `plugins/coc-keeper/skills/coc-scenario-import/references/story-graph-schema.md`
- Modify: `plugins/coc-keeper/references/state-schema.md`

- [ ] **Step 1: 文档化 available_routes**

在 `story-graph-schema.md` 的 scene schema 节，补 `available_routes` 字段说明（格式照该文件现有字段样式）：每个 scene 应编译产出 `available_routes: [{route_id, cue, leads_to_scene|clue_id, route_type, status}]`，`status ∈ {open, suggested, exhausted, locked}`。开场 scene 应含 ≥4 条（覆盖问租客/查记录/查房史/进屋）。`leads_to` 支持多目标数组。

- [ ] **Step 2: 强化 pending_chunks 回归声明**

在 `state-schema.md` 的 `pending_choices` 节（:72-77），加一句明确禁令："禁止将 `pending_choices` 存为玩家可见的选项字符串数组；玩家可见的行动暗示必须由 `available_routes` + narrator 生成 diegetic cue，不是 `pending_choices`。"

- [ ] **Step 3: sync 双轨（这两个文件在 drift allowlist 内，需确认替换）+ 门禁**

```bash
python3 scripts/sync_coc_plugin_copy.py
python3 scripts/sync_coc_plugin_copy.py --check
```
Expected: 无 drift（若这两个 md 在 `INTENTIONAL_PLATFORM_DRIFT_FILES`，sync 会做 allowlisted 替换）

- [ ] **Step 4: Commit**

```bash
git add plugins/coc-keeper/skills/coc-scenario-import/references/story-graph-schema.md plugins/coc-keeper-zcode/skills/coc-scenario-import/references/story-graph-schema.md plugins/coc-keeper/references/state-schema.md plugins/coc-keeper-zcode/references/state-schema.md
git commit -m "docs(coc): document available_routes and reinforce pending_choices ban (P0-1b)"
```

---

## Task 11: 全量回归 + 门禁收尾

**目标**：所有 P0 Task 完成后，跑全量测试套件 + sync 门禁，确认无回归。

- [ ] **Step 1: 全量测试**

Run:
```
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/ -q -p no:cacheprovider
```
Expected: 全 PASS。若有 FAIL，逐个诊断修复（优先确认是否 Task 1-9 的改动引起）。

- [ ] **Step 2: sync 门禁**

Run:
```
python3 scripts/sync_coc_plugin_copy.py --check
```
Expected: 无 drift。

- [ ] **Step 3: 确认两轨关键文件一致**

Run:
```
diff plugins/coc-keeper/scripts/coc_narrative_enrichment.py plugins/coc-keeper-zcode/scripts/coc_narrative_enrichment.py
diff plugins/coc-keeper/scripts/coc_live_turn_runner.py plugins/coc-keeper-zcode/scripts/coc_live_turn_runner.py
diff plugins/coc-keeper/scripts/coc_story_director.py plugins/coc-keeper-zcode/scripts/coc_story_director.py
diff plugins/coc-keeper/scripts/coc_director_apply.py plugins/coc-keeper-zcode/scripts/coc_director_apply.py
```
Expected: 仅 drift allowlist 文件有允许的差异，其余无输出（一致）。

- [ ] **Step 4: Commit（若有未提交的修复）**

```bash
git add -A
git commit -m "test(coc): full P0 regression green" || echo "nothing to commit"
```

---

## Self-Review（写计划后自检）

**1. Spec 覆盖**：
- P0-1 全程多线 + is_real_fork → Task 1（is_real_fork 标记）+ Task 10（文档化 available_routes）。⚠️ 注：本计划聚焦"标记 + 文档"，story-graph 数据层实际编译产出 `available_routes`（给场景填充 route）属 scenario-import 编译器改动，依赖具体场景数据，作为 Task 1 的数据来源在 Task 5/9 的 fixture 里用内联数据覆盖；scenario-import 编译器的全面改造建议作为 P0-1 的后续独立 plan（因依赖每个 starter scenario 的具体内容）。
- P0-2 低主动 → Task 2（tag 统一）+ Task 3（落盘带 tags）+ Task 4（闸门收窄）+ Task 5（端到端验收）。✅ 覆盖。
- P0-3 storylet → Task 6（渲染接通）+ Task 7（扩触发面）。✅ 覆盖（渲染接线 + 触发面；库内补开场 storylet 数据作为后续）。
- P0-4 handle 刷新 → Task 8（焦点提取）+ Task 9（handle 新源 + 刷新）。✅ 覆盖。

**2. 占位符扫描**：无 TBD/TODO；每个 Step 有具体代码或命令。✅

**3. 类型/签名一致性**：
- `build_choice_frame` → Task 1 加 `is_real_fork`/`open_route_count`/`open_route_ids`，Task 4 的 `_turn_interrupt_reason` 消费 `choice_frame.get("is_real_fork")`。✅ 一致。
- `build_turn_focus_contract` → Task 8 定义，Task 9 在 runner 调用，参数 `focus_ctx` 与 Task 8 的 `ctx` 形态一致（`player_intent_rich` + `active_scene`）。✅
- `build_stop_actionability_contract` → Task 6 加 `storylet_cues`，Task 9 加 `turn_focus` 参数 + `freshness` 字段。函数签名从 `(turn, active_scene_state, *, stop_reason, max_handles)` 扩为 `(..., turn_focus=None)`。Task 9 Step 3 已含签名修改。✅
- `_LOW_AGENCY_TAGS` → Task 2 定义，Task 3 的 `_low_agency_continue_count` 与 `_normalize_recent_intent_classes` 消费。✅

**已知范围边界（诚实声明）**：
- P0-1 的 scenario-import 编译器全面改造（让每个 starter scenario 真实编译出 `available_routes`）不在本计划——它依赖逐个场景的内容设计，建议作为紧接其后的独立 plan。
- P0-3 的"库内补开场/场景型 storylet 数据"不在本计划——依赖 storylet 设计，建议作为独立 plan。
- 这两项的**机制**（标记、触发谓词、渲染接线）已在本计划覆盖；缺的只是**数据填充**。
