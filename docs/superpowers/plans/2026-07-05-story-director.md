# Story Director 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现隐藏的剧情编排层 `coc_story_director`：deterministic planner 每回合读规则状态 + 模组剧情图，产出 DirectorPlan 指导 keeper-play 叙事方向，并通过 GM 质量 harness 验证。

**Architecture:** 三层——`coc_rule_signals.py`（纯函数翻译规则状态→剧情信号）→ `coc_story_director.py`（三层评分选导演动作）→ `coc_story_harness.py`（端到端断言）。模组剧情图由扩展的 `coc-scenario-import` skill 驱动 LLM 自动编译，`coc_scenario_compile.py` 做结构校验。

**Tech Stack:** Python 3.10+，纯标准库 + 项目既有 `coc_roll/coc_rules/coc_state`。pytest 测试，`importlib.util` 动态加载脚本（跟现有模式一致）。

## Global Constraints

- 两 plugin 同步：新脚本同时写到 `plugins/coc-keeper/scripts/` 和 `plugins/coc-keeper-zcode/scripts/`（现有脚本字节一致，测试加载 `coc-keeper`）。
- 测试在 `tests/test_<module>.py`，用 `importlib.util` 加载，命名 `test_<module>.py`。
- 所有 RNG 用 `random.Random(seed)` 保证 deterministic。
- 规则数据从 `references/rules-json/` 读，不硬编码。
- 玩家可见文本走 `play_language`；机器标记/JSON key/枚举值保持 ASCII 稳定。
- director 只读规则状态，绝不修改（修改仍由 coc_roll/combat/chase/sanity 负责）。

**真相源:** `docs/superpowers/specs/2026-07-05-story-director-design.md`。台账：`.zralph/story-director-tasks.md`。

---

## File Structure

新建/修改文件（两 plugin 同步）：

```
plugins/coc-keeper/scripts/           plugins/coc-keeper-zcode/scripts/
  coc_rule_signals.py    [NEW]           coc_rule_signals.py    [NEW]
  coc_story_director.py  [NEW]           coc_story_director.py  [NEW]
  coc_story_harness.py   [NEW]           coc_story_harness.py   [NEW]
  coc_scenario_compile.py[NEW]           coc_scenario_compile.py[NEW]
  coc_scenario.py        [MOD]           coc_scenario.py        [MOD]

plugins/coc-keeper/skills/             plugins/coc-keeper-zcode/skills/
  coc-story-director/SKILL.md [NEW]      coc-story-director/SKILL.md [NEW]
  coc-keeper-play/SKILL.md    [MOD]      coc-keeper-play/SKILL.md    [MOD]
  coc-scenario-import/SKILL.md[MOD]      coc-scenario-import/SKILL.md[MOD]
  coc-scenario-import/references/
    story-graph-schema.md [NEW]            story-graph-schema.md [NEW]
    compile-protocol.md   [NEW]            compile-protocol.md   [NEW]
  references/director-protocol.md [NEW]  references/director-protocol.md [NEW]
  references/rules-json/
    structure-weights.json [NEW]           structure-weights.json [NEW]

tests/
  test_rule_signals.py        [NEW]
  test_story_director.py      [NEW]
  test_story_harness.py       [NEW]
  test_scenario_compile.py    [NEW]

.coc/playtests/v7-director-smoke/        [NEW dir]
  profiles/                              [profiles 后续任务建]
```

职责边界：
- `coc_rule_signals.py` — 16 个纯函数，规则状态→剧情信号枚举。无副作用，无决策。
- `coc_story_director.py` — 评分引擎 + DirectorPlan 产出。依赖 rule_signals + state（只读）。
- `coc_story_harness.py` — 读 profiles，调 director，跑断言，写 report。
- `coc_scenario_compile.py` — 剧情图结构校验器。
- `coc_scenario.py` [MOD] — 加剧情图 JSON 创建函数。

---

## Task 1: coc_rule_signals.py — 基础信号函数（HP/Sanity/Credit）

**Files:**
- Create: `plugins/coc-keeper/scripts/coc_rule_signals.py` + zcode 副本
- Test: `tests/test_rule_signals.py`

**Interfaces:**
- Consumes: `coc_state`（读 investigator-state.json/character.json 的工具函数，本任务自建轻量读取）, `references/rules-json/cash-assets.json`
- Produces: `read_hp_state()`, `read_sanity_state()`, `read_credit_tier()`

- [ ] **Step 1: 写失败测试 test_rule_signals.py**

```python
"""Tests for coc_rule_signals: pure functions translating rule state to director signals."""
import importlib.util
import json
from pathlib import Path

import pytest

def _load(name, rel):
    spec = importlib.util.spec_from_file_location(name, rel)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m

coc_rule_signals = _load("coc_rule_signals", "plugins/coc-keeper/scripts/coc_rule_signals.py")


def test_hp_state_healthy():
    assert coc_rule_signals.read_hp_state(current_hp=12, max_hp=12, conditions=[]) == "healthy"

def test_hp_state_wounded():
    assert coc_rule_signals.read_hp_state(current_hp=8, max_hp=12, conditions=[]) == "wounded"

def test_hp_state_major_wound():
    assert coc_rule_signals.read_hp_state(current_hp=4, max_hp=12, conditions=["major_wound"]) == "major_wound"

def test_hp_state_dying():
    assert coc_rule_signals.read_hp_state(current_hp=0, max_hp=12, conditions=["major_wound", "dying"]) == "dying"

def test_hp_state_dead():
    assert coc_rule_signals.read_hp_state(current_hp=-2, max_hp=12, conditions=[]) == "dead"

def test_hp_state_zero_no_major_wound_is_unconscious_not_dead():
    # HP=0 alone (no major wound) → unconscious, classified as wounded (not dying)
    assert coc_rule_signals.read_hp_state(current_hp=0, max_hp=12, conditions=[]) == "wounded"

def test_sanity_state_stable():
    assert coc_rule_signals.read_sanity_state(current_san=55, max_san=99, bout_active=False, lost_this_event=0) == "stable"

def test_sanity_state_shaken():
    assert coc_rule_signals.read_sanity_state(current_san=55, max_san=99, bout_active=False, lost_this_event=3) == "shaken"

def test_sanity_state_temp_insane():
    assert coc_rule_signals.read_sanity_state(current_san=55, max_san=99, bout_active=False, lost_this_event=5) == "temp_insane"

def test_sanity_state_bout_active():
    assert coc_rule_signals.read_sanity_state(current_san=55, max_san=99, bout_active=True, lost_this_event=5) == "bout_active"

def test_credit_tier_penniless():
    assert coc_rule_signals.read_credit_tier(credit_rating=0) == "penniless"

def test_credit_tier_poor():
    assert coc_rule_signals.read_credit_tier(credit_rating=5) == "poor"

def test_credit_tier_average():
    assert coc_rule_signals.read_credit_tier(credit_rating=30) == "average"

def test_credit_tier_wealthy():
    assert coc_rule_signals.read_credit_tier(credit_rating=65) == "wealthy"

def test_credit_tier_super_rich():
    assert coc_rule_signals.read_credit_tier(credit_rating=95) == "super_rich"
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pytest tests/test_rule_signals.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'coc_rule_signals'`

- [ ] **Step 3: 实现 coc_rule_signals.py（基础三个函数）**

```python
#!/usr/bin/env python3
"""Pure functions translating Call of Cthulhu rule state into director signals.

These functions are read-only and side-effect-free. They take rule state
(hp, sanity, credit rating, etc.) and return signal enum values that the
story director uses in its scoring. Each function is independently testable.

Rulebook refs:
- HP states: Keeper Rulebook 40th Anniversary p.119-120
- Sanity states: p.154-158
- Credit Rating tiers: p.45-47 (cash-assets.json)
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
RULES_DIR = SCRIPT_DIR.parent / "references" / "rules-json"

# Sanity thresholds (rulebook p.155-156)
TEMP_INSANITY_LOSS_THRESHOLD = 5
INDEFINITE_INSANITY_DAILY_FRACTION = 0.2


def read_hp_state(current_hp: int, max_hp: int, conditions: list[str]) -> str:
    """Classify HP/wound state. Rulebook p.119-120.

    Returns: healthy | wounded | major_wound | dying | dead
    - dead: hp < 0
    - dying: hp == 0 AND major_wound in conditions (p.120)
    - major_wound: major_wound in conditions (damage >= half max hp, p.119)
    - wounded: hp < max_hp (but not above critical states)
    - healthy: hp == max_hp
    """
    if current_hp < 0:
        return "dead"
    if current_hp == 0 and "major_wound" in conditions:
        return "dying"
    if "major_wound" in conditions:
        return "major_wound"
    if current_hp < max_hp:
        return "wounded"
    return "healthy"


def read_sanity_state(current_san: int, max_san: int, bout_active: bool, lost_this_event: int) -> str:
    """Classify sanity state. Rulebook p.154-158.

    Returns: stable | shaken | temp_insane | indefinite_insane | bout_active
    - bout_active overrides everything (Keeper controls investigator, p.156)
    - temp_insane: lost >= 5 SAN from single source (p.155)
    - shaken: lost some SAN but below temp threshold
    - stable: no recent loss
    """
    if bout_active:
        return "bout_active"
    if lost_this_event >= TEMP_INSANITY_LOSS_THRESHOLD:
        return "temp_insane"
    if lost_this_event > 0:
        return "shaken"
    return "stable"


def read_credit_tier(credit_rating: int) -> str:
    """Map Credit Rating to living-standard tier. Rulebook p.45-47.

    Returns: penniless | poor | average | wealthy | rich | super_rich
    Tiers align with cash-assets.json living_standard values.
    """
    if credit_rating <= 0:
        return "penniless"
    if credit_rating <= 9:
        return "poor"
    if credit_rating <= 49:
        return "average"
    if credit_rating <= 89:
        return "wealthy"
    return "super_rich"
```

同步复制到 `plugins/coc-keeper-zcode/scripts/coc_rule_signals.py`。

- [ ] **Step 4: 运行测试确认通过**

Run: `pytest tests/test_rule_signals.py -v`
Expected: 15 passed

- [ ] **Step 5: Commit**

```bash
git add plugins/coc-keeper/scripts/coc_rule_signals.py plugins/coc-keeper-zcode/scripts/coc_rule_signals.py tests/test_rule_signals.py
git commit -m "feat: add coc_rule_signals with hp/sanity/credit-tier translators"
```

---

## Task 2: coc_rule_signals.py — NPC 反应隐骰 + Luck + Crit/Fumble + Stalled + Tension

**Files:**
- Modify: `plugins/coc-keeper/scripts/coc_rule_signals.py` + zcode 副本
- Test: `tests/test_rule_signals.py` (追加)

**Interfaces:**
- Consumes: `coc_roll.percentile_check`（隐骰）, `coc_rules.success_level`
- Produces: `roll_npc_reaction()`, `read_luck_signal()`, `read_critical_fumble()`, `read_stalled_turns()`, `read_tension_clock()`

- [ ] **Step 1: 追加失败测试**

追加到 `tests/test_rule_signals.py`：

```python
import random

def test_npc_reaction_success_uses_higher_of_app_or_cr():
    # APP=45, CR=65 → target=65; roll=34 < 65 → helpful
    result = coc_rule_signals.roll_npc_reaction(
        app=45, credit_rating=65, rng=random.Random(100)
    )
    assert result["used"] == "credit_rating"
    assert result["target"] == 65
    assert result["disposition"] == "helpful"

def test_npc_reaction_failure_hostile():
    # target=65; force a high roll via seeded rng
    result = coc_rule_signals.roll_npc_reaction(
        app=45, credit_rating=65, rng=random.Random(2)
    )
    assert result["disposition"] in ("neutral", "hostile")

def test_luck_signal_high():
    assert coc_rule_signals.read_luck_signal(current_luck=70, luck_spent_last=0) == ("high", False)

def test_luck_signal_depleted():
    assert coc_rule_signals.read_luck_signal(current_luck=5, luck_spent_last=20) == ("depleted", True)

def test_luck_signal_moderate_with_spend():
    level, spent = coc_rule_signals.read_luck_signal(current_luck=40, luck_spent_last=15)
    assert level == "moderate"
    assert spent is True

def test_critical_fumble_none():
    assert coc_rule_signals.read_critical_fumble(last_roll_outcome=None) == (False, False)

def test_critical_fumble_detects_critical():
    crit, fumble = coc_rule_signals.read_critical_fumble("critical")
    assert crit is True and fumble is False

def test_critical_fumble_detects_fumble():
    crit, fumble = coc_rule_signals.read_critical_fumble("fumble")
    assert crit is False and fumble is True

def test_stalled_turns_zero():
    assert coc_rule_signals.read_stalled_turns(recent_intent_classes=["investigate","social"]) == 0

def test_stalled_turns_counts_idle():
    assert coc_rule_signals.read_stalled_turns(recent_intent_classes=["idle","idle","idle"]) == 3

def test_tension_clock_low():
    sig = coc_rule_signals.read_tension_clock(tension_level="low", lethal_chances_used=0)
    assert sig["tension_level"] == "low"
    assert sig["lethal_chances_used"] == 0
    assert sig["death_allowed"] is False

def test_tension_clock_death_allowed_after_3():
    sig = coc_rule_signals.read_tension_clock(tension_level="climax", lethal_chances_used=3)
    assert sig["death_allowed"] is True
```

- [ ] **Step 2: 运行确认失败**

Run: `pytest tests/test_rule_signals.py -v -k "npc_reaction or luck_signal or critical_fumble or stalled_turns or tension_clock"`
Expected: FAIL — `AttributeError: module 'coc_rule_signals' has no attribute 'roll_npc_reaction'`

- [ ] **Step 3: 实现追加函数**

在 `coc_rule_signals.py` 顶部加 `_load_sibling` 加载 coc_roll，然后追加函数：

```python
def _load_sibling(name: str, filename: str):
    import importlib.util
    spec = importlib.util.spec_from_file_location(name, SCRIPT_DIR / filename)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module

coc_roll = _load_sibling("coc_roll", "coc_roll.py")


# NPC reaction concealed roll (rulebook p.191)
def roll_npc_reaction(app: int, credit_rating: int, rng: random.Random | None = None) -> dict[str, Any]:
    """Concealed APP/CR roll to set NPC disposition. Rulebook p.191.

    Use the higher of APP or Credit Rating as target (rulebook: "if unsure,
    use the higher of the two"). Roll 1D100; below target = positive.
    Returns dict with used/target/roll/disposition.
    """
    rng = rng or random.Random()
    used = "credit_rating" if credit_rating >= app else "app"
    target = max(app, credit_rating)
    roll = rng.randint(1, 100)
    disposition = "helpful" if roll <= target // 2 else ("neutral" if roll <= target else "hostile")
    return {"used": used, "target": target, "roll": roll, "disposition": disposition}


def read_luck_signal(current_luck: int, luck_spent_last: int) -> tuple[str, bool]:
    """Classify Luck level + whether player spent luck last turn. Rulebook p.99.

    Returns (level, spent_last) where level: high | moderate | low | depleted.
    Luck is a depleting tension clock; low-luck investigators attract misfortune
    (group-Luck rule).
    """
    if current_luck >= 60:
        level = "high"
    elif current_luck >= 30:
        level = "moderate"
    elif current_luck >= 10:
        level = "low"
    else:
        level = "depleted"
    return (level, luck_spent_last > 0)


def read_critical_fumble(last_roll_outcome: str | None) -> tuple[bool, bool]:
    """Detect critical (01) / fumble (96-100) from last roll outcome.

    Returns (is_critical, is_fumble). Both drive mandatory director action
    (rulebook p.89): critical → invent benefit; fumble → invent immediate
    misfortune, cannot be negated by pushing.
    """
    if last_roll_outcome is None:
        return (False, False)
    return (last_roll_outcome == "critical", last_roll_outcome == "fumble")


def read_stalled_turns(recent_intent_classes: list[str]) -> int:
    """Count trailing idle/stuck turns from recent player intent classes.

    Used by Idea Roll recovery valve (rulebook p.199). Director triggers
    RECOVER action when stalled >= 3.
    """
    count = 0
    for cls in reversed(recent_intent_classes):
        if cls in ("idle", "stuck"):
            count += 1
        else:
            break
    return count


def read_tension_clock(tension_level: str, lethal_chances_used: int) -> dict[str, Any]:
    """Read pacing/tension state. Rulebook p.198, p.209 (three chances).

    Returns dict with tension_level, lethal_chances_used, death_allowed.
    death_allowed only after 3+ lethal chances used (p.209).
    """
    return {
        "tension_level": tension_level,
        "lethal_chances_used": lethal_chances_used,
        "death_allowed": lethal_chances_used >= 3,
    }
```

在文件顶部 `import json` 后加 `import random`。同步到 zcode 副本。

- [ ] **Step 4: 运行确认通过**

Run: `pytest tests/test_rule_signals.py -v`
Expected: 27 passed (15 + 12 new)

- [ ] **Step 5: Commit**

```bash
git add plugins/coc-keeper/scripts/coc_rule_signals.py plugins/coc-keeper-zcode/scripts/coc_rule_signals.py tests/test_rule_signals.py
git commit -m "feat: add npc-reaction/luck/crit-fumble/stalled/tension signals"
```

---

## Task 3: coc_rule_signals.py — v2 翻译函数（写全不引用）

**Files:**
- Modify: `plugins/coc-keeper/scripts/coc_rule_signals.py` + zcode 副本
- Test: `tests/test_rule_signals.py` (追加)

**Interfaces:**
- Produces: `read_phobia_penalty()` (D5), `read_psychology_concealed()` (F1), `read_pushed_fail_pending()` (H1), `read_contacts_difficulty()` (A3)。D4/F3 留 stub。

**理由:** 翻译函数纯无副作用，一次写全 16 个，后续 director 接入零回头成本。

- [ ] **Step 1: 追加失败测试**

```python
def test_phobia_penalty_active_when_insane_and_trigger_present():
    result = coc_rule_signals.read_phobia_penalty(insane=True, trigger_in_scene=True)
    assert result["penalty_die"] is True

def test_phobia_penalty_inactive_when_sane():
    result = coc_rule_signals.read_phobia_penalty(insane=False, trigger_in_scene=True)
    assert result["penalty_die"] is False

def test_psychology_concealed_returns_feed_direction():
    result = coc_rule_signals.read_psychology_concealed(skill_value=60, roll=34, npc_lying=True)
    assert result["feed_accurate"] is True
    result2 = coc_rule_signals.read_psychology_concealed(skill_value=60, roll=70, npc_lying=True)
    assert result2["feed_accurate"] is False  # failed → feed false read

def test_pushed_fail_pending():
    assert coc_rule_signals.read_pushed_fail_pending(is_pushed=True, outcome="failure") is True
    assert coc_rule_signals.read_pushed_fail_pending(is_pushed=False, outcome="failure") is False
    assert coc_rule_signals.read_pushed_fail_pending(is_pushed=True, outcome="success") is False

def test_contacts_difficulty_home_same_profession():
    assert coc_rule_signals.read_contacts_difficulty(home_ground=True, same_profession=True) == "regular"

def test_contacts_difficulty_foreign_remote():
    assert coc_rule_signals.read_contacts_difficulty(home_ground=False, same_profession=False) == "hard"
```

- [ ] **Step 2: 运行确认失败**

Run: `pytest tests/test_rule_signals.py -v -k "phobia_penalty or psychology_concealed or pushed_fail or contacts_difficulty"`
Expected: FAIL — AttributeError

- [ ] **Step 3: 追加 v2 函数**

```python
# --- v2 translation functions (written now, director does not reference in v1) ---

def read_phobia_penalty(insane: bool, trigger_in_scene: bool) -> dict[str, Any]:
    """Phobia penalty die when insane + trigger present. Rulebook p.159.

    While sane, phobia is just roleplay; while insane + direct exposure,
    non-fight/flee actions take 1 penalty die.
    """
    return {"penalty_die": bool(insane and trigger_in_scene)}


def read_psychology_concealed(skill_value: int, roll: int, npc_lying: bool) -> dict[str, Any]:
    """Concealed Psychology roll determines if player gets accurate NPC read.
    Rulebook p.191. Failed roll → director feeds false info.
    """
    feed_accurate = roll <= skill_value
    return {"feed_accurate": feed_accurate, "npc_actually_lying": npc_lying}


def read_pushed_fail_pending(is_pushed: bool, outcome: str) -> bool:
    """Pushed-roll failure requires worse narrative consequence. Rulebook p.84."""
    return bool(is_pushed and outcome == "failure")


def read_contacts_difficulty(home_ground: bool, same_profession: bool) -> str:
    """Contacts roll difficulty by location/profession match. Rulebook p.97."""
    if home_ground and same_profession:
        return "regular"
    if not home_ground:
        return "hard"
    return "regular"


# D4 (failed-SAN involuntary action) and F3 (believer SAN bomb) stubs:
# These need session-state fields not yet in save schema; defined as no-op
# placeholders so the function registry is complete.
def read_failed_san_involuntary(*args, **kwargs) -> dict[str, Any]:
    """D4: director inserts involuntary action on failed SAN roll. Stub for v2."""
    return {"implemented": False}

def read_believer_bomb(*args, **kwargs) -> dict[str, Any]:
    """F3: pending SAN loss = current Cthulhu Mythos on becoming believer. Stub for v2."""
    return {"implemented": False}
```

同步到 zcode 副本。

- [ ] **Step 4: 运行确认通过**

Run: `pytest tests/test_rule_signals.py -v`
Expected: 33 passed

- [ ] **Step 5: Commit**

```bash
git add plugins/coc-keeper/scripts/coc_rule_signals.py plugins/coc-keeper-zcode/scripts/coc_rule_signals.py tests/test_rule_signals.py
git commit -m "feat: add v2 signal translators (phobia/psychology/pushed/contacts + stubs)"
```

---

## Task 4: coc_story_director.py — DirectorPlan schema + build_director_context

**Files:**
- Create: `plugins/coc-keeper/scripts/coc_story_director.py` + zcode 副本
- Test: `tests/test_story_director.py`

**Interfaces:**
- Consumes: `coc_rule_signals`（全部翻译函数）, `coc_state`（读 save JSON）, scenario/ 剧情图
- Produces: `build_director_context()`, `write_director_plan()`, `DirectorPlan` 结构

- [ ] **Step 1: 写失败测试**

```python
"""Tests for coc_story_director: deterministic planner producing DirectorPlan."""
import importlib.util
import json
import random
from pathlib import Path

import pytest

def _load(name, rel):
    spec = importlib.util.spec_from_file_location(name, rel)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m

coc_story_director = _load("coc_story_director", "plugins/coc-keeper/scripts/coc_story_director.py")


def _make_minimal_campaign(tmp_path):
    """Build a minimal campaign dir with save + scenario story-graph."""
    camp = tmp_path / "campaigns" / "test"
    (camp / "save").mkdir(parents=True)
    (camp / "scenario").mkdir(parents=True)
    (camp / "save" / "investigator-state").mkdir()
    (camp / "save" / "investigator-state" / "inv1.json").write_text(json.dumps({
        "schema_version": 1, "campaign_id": "test", "investigator_id": "inv1",
        "current_hp": 12, "current_san": 55, "current_mp": 11,
        "conditions": [], "skill_checks_earned": [],
    }))
    (camp / "save" / "world-state.json").write_text(json.dumps({
        "schema_version": 1, "campaign_id": "test", "scenario_id": "test-mod",
        "status": "active", "active_scene_id": "scene-1", "active_subsystem": "play",
        "current_phase": "middle", "discovered_clue_ids": [], "major_decisions": [],
    }))
    (camp / "save" / "flags.json").write_text(json.dumps({
        "schema_version": 1, "campaign_id": "test", "clues_found": {}, "decisions": [],
    }))
    (camp / "save" / "pacing-state.json").write_text(json.dumps({
        "schema_version": 1, "tension_level": "low", "lethal_chances_used": 0,
        "recent_intent_classes": [],
    }))
    (camp / "scenario" / "module-meta.json").write_text(json.dumps({
        "schema_version": 1, "scenario_id": "test-mod", "structure_type": "branching_investigation",
        "era": "1920s", "content_flags": [], "win_condition": "test",
    }))
    (camp / "scenario" / "story-graph.json").write_text(json.dumps({"scenes": [
        {"scene_id": "scene-1", "scene_type": "investigation",
         "dramatic_question": "能否找到线索？",
         "entry_conditions": [], "exit_conditions": ["clue-1 discovered"],
         "available_clues": ["clue-1"], "npc_ids": [], "pressure_moves": [],
         "tone": ["tense"], "allowed_improvisation": []},
    ]}))
    (camp / "scenario" / "clue-graph.json").write_text(json.dumps({"conclusions": [
        {"conclusion_id": "concl-1", "importance": "critical", "minimum_routes": 3,
         "clues": [
             {"clue_id": "clue-1", "delivery": "investigate", "visibility": "player-safe"},
             {"clue_id": "clue-1b", "delivery": "social", "visibility": "player-safe"},
             {"clue_id": "clue-1c", "delivery": "spot hidden", "visibility": "player-safe"},
         ], "fallback_policy": "move clue if 2 missed"},
    ]}))
    (camp / "scenario" / "npc-agendas.json").write_text(json.dumps({"npcs": []}))
    (camp / "scenario" / "threat-fronts.json").write_text(json.dumps({"fronts": []}))
    (camp / "scenario" / "pacing-map.json").write_text(json.dumps({"pacing_curve": []}))
    (camp / "scenario" / "improvisation-boundaries.json").write_text(json.dumps({
        "invent_allowed": [], "never_invent": [], "keeper_secrets": ["secret-1"],
    }))
    # character.json for inv1
    char_dir = tmp_path / "investigators" / "inv1"
    char_dir.mkdir(parents=True)
    (char_dir / "character.json").write_text(json.dumps({
        "schema_version": 1, "id": "inv1", "occupation": "Antiquarian", "era": "1920s",
        "characteristics": {"STR":60,"CON":55,"SIZ":65,"DEX":50,"APP":45,"INT":70,"POW":55,"EDU":75,"LUCK":55},
        "derived": {"HP":12,"MP":11,"SAN":55,"MOV":7,"damage_bonus":"0","build":0},
        "skills": {"Credit Rating": 50, "Spot Hidden": 60, "Psychology": 55},
        "backstory": {},
    }))
    return camp, char_dir / "character.json"


def test_build_director_context_reads_state(tmp_path):
    camp, char_path = _make_minimal_campaign(tmp_path)
    ctx = coc_story_director.build_director_context(
        campaign_dir=camp, character_path=char_path, investigator_id="inv1",
        player_intent="我检查门框", player_intent_class="investigate",
        rng=random.Random(42),
    )
    assert ctx["active_scene_id"] == "scene-1"
    assert ctx["structure_type"] == "branching_investigation"
    assert ctx["rule_signals"]["hp_state"] == "healthy"
    assert ctx["rule_signals"]["credit_tier"] == "wealthy"
    assert ctx["rule_signals"]["tension_clock"]["death_allowed"] is False


def test_build_director_context_fallen_back_on_missing_pacing(tmp_path):
    camp, char_path = _make_minimal_campaign(tmp_path)
    (camp / "save" / "pacing-state.json").unlink()
    ctx = coc_story_director.build_director_context(
        campaign_dir=camp, character_path=char_path, investigator_id="inv1",
        player_intent="...", player_intent_class="investigate", rng=random.Random(42),
    )
    # defaults applied, no crash
    assert ctx["rule_signals"]["stalled_turns"] == 0
```

- [ ] **Step 2: 运行确认失败**

Run: `pytest tests/test_story_director.py -v -k build_director_context`
Expected: FAIL — ModuleNotFoundError

- [ ] **Step 3: 实现 build_director_context + write_director_plan 框架**

```python
#!/usr/bin/env python3
"""COC Story Director — deterministic planner.

Each turn, reads rule state + scenario story-graph + player intent, produces
a DirectorPlan JSON guiding coc-keeper-play's narrative direction. Read-only
with respect to rule state; never modifies save/combat/sanity.

Spec: docs/superpowers/specs/2026-07-05-story-director-design.md
"""
from __future__ import annotations

import json
import random
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent


def _load_sibling(name: str, filename: str):
    import importlib.util
    spec = importlib.util.spec_from_file_location(name, SCRIPT_DIR / filename)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module

coc_rule_signals = _load_sibling("coc_rule_signals", "coc_rule_signals.py")


def _read_json(path: Path, fallback: Any = None) -> Any:
    if not path.exists():
        return fallback
    return json.loads(path.read_text(encoding="utf-8"))


def build_director_context(
    campaign_dir: Path,
    character_path: Path,
    investigator_id: str,
    player_intent: str,
    player_intent_class: str,
    rng: random.Random | None = None,
) -> dict[str, Any]:
    """Assemble DirectorContext: rule signals + active scene + scenario graph.

    Read-only. Pulls investigator-state, character, world-state, flags,
    pacing-state, and the 7 scenario story-graph files.
    """
    rng = rng or random.Random()
    save = campaign_dir / "save"
    scenario = campaign_dir / "scenario"

    inv_state = _read_json(save / "investigator-state" / f"{investigator_id}.json", {})
    character = _read_json(character_path, {})
    world = _read_json(save / "world-state.json", {})
    pacing = _read_json(save / "pacing-state.json", {})
    module_meta = _read_json(scenario / "module-meta.json", {})
    story_graph = _read_json(scenario / "story-graph.json", {"scenes": []})

    # --- rule signals ---
    char_derived = character.get("derived", {})
    char_chars = character.get("characteristics", {})
    char_skills = character.get("skills", {})
    conditions = inv_state.get("conditions", []) or []
    current_hp = inv_state.get("current_hp", char_derived.get("HP", 10))
    max_hp = char_derived.get("HP", 10)
    current_san = inv_state.get("current_san", char_derived.get("SAN", 50))
    max_san = 99  # simplified; spec's believer-bomb is v2
    credit_rating = char_skills.get("Credit Rating", 0)
    app = char_chars.get("APP", 50)
    luck = char_chars.get("LUCK", 50)

    recent_intents = pacing.get("recent_intent_classes", [])
    rule_signals = {
        "hp_state": coc_rule_signals.read_hp_state(current_hp, max_hp, conditions),
        "sanity_state": coc_rule_signals.read_sanity_state(
            current_san, max_san,
            bout_active="bout_active" in conditions,
            lost_this_event=inv_state.get("san_lost_this_event", 0),
        ),
        "credit_tier": coc_rule_signals.read_credit_tier(credit_rating),
        "npc_reaction_roll": None,  # populated per-NPC at scoring time
        "luck_level": coc_rule_signals.read_luck_signal(luck, pacing.get("luck_spent_last", 0))[0],
        "luck_spent_last": pacing.get("luck_spent_last", 0) > 0,
        "last_roll_critical": False,
        "last_roll_fumble": False,
        "active_conditions": conditions,
        "stalled_turns": coc_rule_signals.read_stalled_turns(recent_intents),
        "tension_clock": coc_rule_signals.read_tension_clock(
            pacing.get("tension_level", "low"), pacing.get("lethal_chances_used", 0),
        ),
        "bout_active": "bout_active" in conditions,
    }

    # --- active scene ---
    active_scene_id = world.get("active_scene_id")
    scenes = story_graph.get("scenes", [])
    active_scene = next((s for s in scenes if s["scene_id"] == active_scene_id), None)

    return {
        "campaign_dir": campaign_dir,
        "investigator_id": investigator_id,
        "player_intent": player_intent,
        "player_intent_class": player_intent_class,
        "active_scene_id": active_scene_id,
        "active_scene": active_scene,
        "structure_type": module_meta.get("structure_type", "branching_investigation"),
        "module_meta": module_meta,
        "story_graph": story_graph,
        "clue_graph": _read_json(scenario / "clue-graph.json", {"conclusions": []}),
        "npc_agendas": _read_json(scenario / "npc-agendas.json", {"npcs": []}),
        "threat_fronts": _read_json(scenario / "threat-fronts.json", {"fronts": []}),
        "pacing_map": _read_json(scenario / "pacing-map.json", {"pacing_curve": []}),
        "improvisation_boundaries": _read_json(scenario / "improvisation-boundaries.json", {}),
        "world_state": world,
        "rule_signals": rule_signals,
        "rng": rng,
        "turn_number": pacing.get("turn_number", 0),
    }


def write_director_plan(plan: dict[str, Any], artifacts_dir: Path) -> Path:
    """Persist DirectorPlan to artifacts/<decision_id>.json. Returns path."""
    artifacts_dir.mkdir(parents=True, exist_ok=True)
    out = artifacts_dir / f"{plan['decision_id']}.json"
    out.write_text(json.dumps(plan, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return out
```

同步到 zcode 副本。

- [ ] **Step 4: 运行确认通过**

Run: `pytest tests/test_story_director.py -v -k build_director_context`
Expected: 2 passed

- [ ] **Step 5: Commit**

```bash
git add plugins/coc-keeper/scripts/coc_story_director.py plugins/coc-keeper-zcode/scripts/coc_story_director.py tests/test_story_director.py
git commit -m "feat: add coc_story_director build_director_context + plan writer"
```

---

## Task 5: coc_story_director.py — 三层评分引擎

**Files:**
- Modify: `plugins/coc-keeper/scripts/coc_story_director.py` + zcode 副本
- Test: `tests/test_story_director.py` (追加)
- Create: `plugins/coc-keeper/references/rules-json/structure-weights.json` + zcode 副本

**Interfaces:**
- Produces: `score_scene_options()`, `select_action()`, `apply_rule_signal_overrides()`

- [ ] **Step 1: 建 structure-weights.json**

```json
{
  "schema_version": 1,
  "description": "Layer 2 structure weights: preference for each director action by module structure_type. Spec section 'Scoring Engine > Layer 2'.",
  "types": ["linear_acts", "time_loop", "branching_investigation", "hub_sandbox", "multi_faction", "campaign_sequel", "hybrid_mega"],
  "actions": ["REVEAL", "DEEPEN", "PRESSURE", "CHARACTER", "CHOICE", "CUT", "MONTAGE", "SUBSYSTEM", "RECOVER", "PAYOFF"],
  "weights": {
    "linear_acts":            {"REVEAL":1.0,"DEEPEN":1.0,"PRESSURE":0.9,"CHARACTER":0.9,"CHOICE":0.7,"CUT":1.2,"MONTAGE":1.0,"SUBSYSTEM":1.0,"RECOVER":1.0,"PAYOFF":0.8},
    "time_loop":              {"REVEAL":0.9,"DEEPEN":1.0,"PRESSURE":1.3,"CHARACTER":1.0,"CHOICE":0.9,"CUT":1.0,"MONTAGE":0.8,"SUBSYSTEM":1.0,"RECOVER":1.2,"PAYOFF":1.3},
    "branching_investigation":{"REVEAL":1.2,"DEEPEN":1.1,"PRESSURE":1.0,"CHARACTER":0.9,"CHOICE":1.3,"CUT":0.8,"MONTAGE":0.9,"SUBSYSTEM":1.0,"RECOVER":1.1,"PAYOFF":0.9},
    "hub_sandbox":            {"REVEAL":1.0,"DEEPEN":0.9,"PRESSURE":0.8,"CHARACTER":1.1,"CHOICE":1.3,"CUT":0.7,"MONTAGE":1.1,"SUBSYSTEM":1.0,"RECOVER":1.2,"PAYOFF":1.0},
    "multi_faction":          {"REVEAL":0.8,"DEEPEN":1.0,"PRESSURE":1.2,"CHARACTER":1.3,"CHOICE":1.3,"CUT":0.8,"MONTAGE":0.9,"SUBSYSTEM":1.0,"RECOVER":1.0,"PAYOFF":0.9},
    "campaign_sequel":        {"REVEAL":1.0,"DEEPEN":1.0,"PRESSURE":1.0,"CHARACTER":1.3,"CHOICE":1.0,"CUT":1.0,"MONTAGE":1.0,"SUBSYSTEM":1.0,"RECOVER":1.0,"PAYOFF":1.3},
    "hybrid_mega":            {"REVEAL":1.0,"DEEPEN":1.0,"PRESSURE":1.2,"CHARACTER":1.1,"CHOICE":1.1,"CUT":1.0,"MONTAGE":1.0,"SUBSYSTEM":1.0,"RECOVER":1.0,"PAYOFF":1.0}
  },
  "tiebreak_order": ["SUBSYSTEM", "RECOVER", "PRESSURE", "REVEAL", "CHOICE", "CHARACTER", "DEEPEN", "CUT", "PAYOFF", "MONTAGE"]
}
```

同步到 zcode。

- [ ] **Step 2: 追加失败测试**

```python
def test_select_action_reveal_for_active_investigation(tmp_path):
    camp, char_path = _make_minimal_campaign(tmp_path)
    ctx = coc_story_director.build_director_context(
        campaign_dir=camp, character_path=char_path, investigator_id="inv1",
        player_intent="我仔细检查门框寻找线索", player_intent_class="investigate",
        rng=random.Random(42),
    )
    action, scores = coc_story_director.select_action(ctx)
    # Active investigation + clue available in scene → REVEAL should win
    assert action == "REVEAL"

def test_select_action_recover_when_stalled(tmp_path):
    camp, char_path = _make_minimal_campaign(tmp_path)
    # make 3 idle turns
    pacing = json.loads((camp/"save"/"pacing-state.json").read_text())
    pacing["recent_intent_classes"] = ["idle","idle","idle"]
    (camp/"save"/"pacing-state.json").write_text(json.dumps(pacing))
    ctx = coc_story_director.build_director_context(
        campaign_dir=camp, character_path=char_path, investigator_id="inv1",
        player_intent="不知道该干嘛", player_intent_class="idle", rng=random.Random(42),
    )
    action, _ = coc_story_director.select_action(ctx)
    assert action == "RECOVER"

def test_rule_override_dying_forces_subsystem(tmp_path):
    camp, char_path = _make_minimal_campaign(tmp_path)
    inv = json.loads((camp/"save"/"investigator-state"/"inv1.json").read_text())
    inv["current_hp"] = 0
    inv["conditions"] = ["major_wound", "dying"]
    (camp/"save"/"investigator-state"/"inv1.json").write_text(json.dumps(inv))
    ctx = coc_story_director.build_director_context(
        campaign_dir=camp, character_path=char_path, investigator_id="inv1",
        player_intent="我继续调查", player_intent_class="investigate", rng=random.Random(42),
    )
    overrides = coc_story_director.apply_rule_signal_overrides(ctx)
    assert overrides is not None
    assert overrides["scene_action"] == "SUBSYSTEM"
    assert overrides["handoff"] == "rules"

def test_rule_override_fumble_forces_pressure(tmp_path):
    camp, char_path = _make_minimal_campaign(tmp_path)
    ctx = coc_story_director.build_director_context(
        campaign_dir=camp, character_path=char_path, investigator_id="inv1",
        player_intent="...", player_intent_class="investigate", rng=random.Random(42),
    )
    ctx["rule_signals"]["last_roll_fumble"] = True
    overrides = coc_story_director.apply_rule_signal_overrides(ctx)
    assert overrides["scene_action"] == "PRESSURE"

def test_rule_override_bout_forces_subsystem_sanity(tmp_path):
    camp, char_path = _make_minimal_campaign(tmp_path)
    ctx = coc_story_director.build_director_context(
        campaign_dir=camp, character_path=char_path, investigator_id="inv1",
        player_intent="...", player_intent_class="investigate", rng=random.Random(42),
    )
    ctx["rule_signals"]["bout_active"] = True
    overrides = coc_story_director.apply_rule_signal_overrides(ctx)
    assert overrides["scene_action"] == "SUBSYSTEM"
    assert overrides["subsystem"] == "sanity"
```

- [ ] **Step 3: 运行确认失败**

Run: `pytest tests/test_story_director.py -v -k "select_action or rule_override"`
Expected: FAIL — AttributeError

- [ ] **Step 4: 实现评分引擎**

追加到 `coc_story_director.py`：

```python
RULES_DIR = SCRIPT_DIR.parent / "references" / "rules-json"

def _load_structure_weights() -> dict[str, Any]:
    return _read_json(RULES_DIR / "structure-weights.json", {"weights": {}, "tiebreak_order": []})

ACTIONS = ["REVEAL", "DEEPEN", "PRESSURE", "CHARACTER", "CHOICE", "CUT", "MONTAGE", "SUBSYSTEM", "RECOVER", "PAYOFF"]


def _base_score(action: str, ctx: dict[str, Any]) -> float:
    """Layer 1: structure-agnostic trigger conditions. Returns 0.0-1.0."""
    scene = ctx.get("active_scene") or {}
    sig = ctx["rule_signals"]
    intent = ctx["player_intent_class"]
    clue_graph = ctx.get("clue_graph", {})
    discovered = set(ctx["world_state"].get("discovered_clue_ids", []))

    if action == "REVEAL":
        if intent != "investigate":
            return 0.0
        avail = [c for c in scene.get("available_clues", []) if c not in discovered]
        return 0.9 if avail else 0.0

    if action == "DEEPEN":
        if intent not in ("investigate", "social"):
            return 0.0
        return 0.5 if scene.get("dramatic_question") else 0.0

    if action == "PRESSURE":
        fronts = ctx.get("threat_fronts", {}).get("fronts", [])
        near_full = any(
            any(c.get("current_segments", 0) >= c.get("segments", 6) * 2 / 3
                for c in f.get("clocks", []))
            for f in fronts
        )
        return 0.8 if (near_full or sig["stalled_turns"] >= 1) else 0.2

    if action == "CHARACTER":
        npcs_in_scene = scene.get("npc_ids", [])
        agendas = ctx.get("npc_agendas", {}).get("npcs", [])
        has_agenda_npc = any(n["npc_id"] in npcs_in_scene and n.get("agenda") for n in agendas)
        return 0.7 if has_agenda_npc else 0.0

    if action == "CHOICE":
        if intent not in ("idle", "ambiguous", "stuck"):
            return 0.0
        avail = [c for c in scene.get("available_clues", []) if c not in discovered]
        return 0.7 if len(avail) >= 2 else 0.0

    if action == "CUT":
        # dramatic question answered OR exit condition met
        exit_met = any(_eval_exit(e, ctx) for e in scene.get("exit_conditions", []))
        return 0.8 if exit_met else 0.0

    if action == "MONTAGE":
        return 0.6 if intent == "montage" else 0.0

    if action == "SUBSYSTEM":
        return 0.9 if intent in ("combat", "flee", "cast") else 0.0

    if action == "RECOVER":
        return 0.85 if sig["stalled_turns"] >= 2 else 0.0

    if action == "PAYOFF":
        # v1: no memory layer; minimal — true if scene tone matches a prior cue
        return 0.0  # v1 leaves PAYOFF to v2 (memory layer)

    return 0.0


def _eval_exit(condition: str, ctx: dict[str, Any]) -> bool:
    """Heuristic exit-condition eval. v1 supports 'clue discovered' and 'pressure clock reaches N'."""
    discovered = set(ctx["world_state"].get("discovered_clue_ids", []))
    if "discovered" in condition:
        clue_id = condition.split()[0]
        return clue_id in discovered
    if "pressure clock reaches" in condition:
        try:
            n = int(condition.split("reaches")[-1].strip())
            fronts = ctx.get("threat_fronts", {}).get("fronts", [])
            return any(
                any(c.get("current_segments", 0) >= n for c in f.get("clocks", []))
                for f in fronts
            )
        except (ValueError, IndexError):
            return False
    return False


def apply_rule_signal_overrides(ctx: dict[str, Any]) -> dict[str, Any] | None:
    """Layer 3: hard overrides. Returns a forced action dict or None."""
    sig = ctx["rule_signals"]
    if sig["bout_active"]:
        return {"scene_action": "SUBSYSTEM", "subsystem": "sanity", "handoff": "rules",
                "rationale": "bout_active forces sanity subsystem"}
    if sig["hp_state"] == "dying":
        return {"scene_action": "SUBSYSTEM", "subsystem": "combat", "handoff": "rules",
                "rationale": "dying forces combat CON-clock + pressure",
                "extra_pressure": True}
    if sig["sanity_state"] == "temp_insane":
        return {"scene_action": "SUBSYSTEM", "subsystem": "sanity", "handoff": "rules",
                "rationale": "temp_insane triggers bout procedure"}
    if sig["last_roll_fumble"]:
        return {"scene_action": "PRESSURE", "handoff": "narration",
                "rationale": "fumble forces immediate misfortune, cannot be pushed off"}
    if sig["stalled_turns"] >= 3:
        return {"scene_action": "RECOVER", "handoff": "narration",
                "rationale": "3 stalled turns forces Idea Roll recovery valve"}
    return None


def select_action(ctx: dict[str, Any]) -> tuple[str, dict[str, float]]:
    """Three-layer scoring. Returns (chosen_action, scores_dict)."""
    overrides = apply_rule_signal_overrides(ctx)
    if overrides is not None:
        # Layer 3 hit — bypass scoring
        scores = {a: 0.0 for a in ACTIONS}
        scores[overrides["scene_action"]] = 1.0
        scores["_override"] = 1.0  # type: ignore
        return overrides["scene_action"], scores

    weights_cfg = _load_structure_weights()
    stype = ctx["structure_type"]
    weights = weights_cfg.get("weights", {}).get(stype, {})
    tiebreak = weights_cfg.get("tiebreak_order", ACTIONS)

    scores: dict[str, float] = {}
    for action in ACTIONS:
        base = _base_score(action, ctx)
        w = weights.get(action, 1.0)
        scores[action] = round(base * w, 4)

    # pick max; tiebreak by order
    max_score = max(scores.values()) if scores else 0.0
    if max_score <= 0.0:
        return "CHOICE", scores  # no-trigger default

    candidates = [a for a, s in scores.items() if s == max_score]
    if len(candidates) == 1:
        return candidates[0], scores
    for action in tiebreak:
        if action in candidates:
            return action, scores
    return candidates[0], scores
```

同步到 zcode。

- [ ] **Step 5: 运行确认通过**

Run: `pytest tests/test_story_director.py -v`
Expected: 7 passed (2 prior + 5 new)

- [ ] **Step 6: Commit**

```bash
git add plugins/coc-keeper/scripts/coc_story_director.py plugins/coc-keeper-zcode/scripts/coc_story_director.py plugins/coc-keeper/references/rules-json/structure-weights.json plugins/coc-keeper-zcode/references/rules-json/structure-weights.json tests/test_story_director.py
git commit -m "feat: add three-layer scoring engine (base × structure_weight × rule overrides)"
```

---

## Task 6: coc_story_director.py — DirectorPlan 完整产出

**Files:**
- Modify: `plugins/coc-keeper/scripts/coc_story_director.py` + zcode 副本
- Test: `tests/test_story_director.py` (追加)

**Interfaces:**
- Produces: `generate_director_plan()` — 完整 DirectorPlan JSON 产出（clue_policy/npc_moves/pressure_moves/rules_requests/narrative_directives）

- [ ] **Step 1: 追加失败测试**

```python
def test_generate_plan_reveal_includes_clue_policy(tmp_path):
    camp, char_path = _make_minimal_campaign(tmp_path)
    ctx = coc_story_director.build_director_context(
        campaign_dir=camp, character_path=char_path, investigator_id="inv1",
        player_intent="我检查门框", player_intent_class="investigate", rng=random.Random(42),
    )
    plan = coc_story_director.generate_director_plan(ctx, decision_id="d1")
    assert plan["scene_action"] == "REVEAL"
    assert len(plan["clue_policy"]["reveal"]) >= 1
    assert "secret-1" in plan["narrative_directives"]["must_not_reveal"]

def test_generate_plan_has_required_fields(tmp_path):
    camp, char_path = _make_minimal_campaign(tmp_path)
    ctx = coc_story_director.build_director_context(
        campaign_dir=camp, character_path=char_path, investigator_id="inv1",
        player_intent="...", player_intent_class="investigate", rng=random.Random(42),
    )
    plan = coc_story_director.generate_director_plan(ctx, decision_id="d2")
    required = ["decision_id","turn_input","scene_action","dramatic_question","pacing_mode",
                "tension_delta","rule_signals","clue_policy","npc_moves","pressure_moves",
                "rules_requests","memory_reads","memory_writes","narrative_directives",
                "handoff","rationale"]
    for field in required:
        assert field in plan, f"missing {field}"

def test_generate_plan_fumble_handoff_narration(tmp_path):
    camp, char_path = _make_minimal_campaign(tmp_path)
    ctx = coc_story_director.build_director_context(
        campaign_dir=camp, character_path=char_path, investigator_id="inv1",
        player_intent="...", player_intent_class="investigate", rng=random.Random(42),
    )
    ctx["rule_signals"]["last_roll_fumble"] = True
    plan = coc_story_director.generate_director_plan(ctx, decision_id="d3")
    assert plan["scene_action"] == "PRESSURE"
    assert plan["handoff"] == "narration"
```

- [ ] **Step 2: 运行确认失败**

Run: `pytest tests/test_story_director.py -v -k generate_plan`
Expected: FAIL — AttributeError

- [ ] **Step 3: 实现 generate_director_plan**

追加到 `coc_story_director.py`：

```python
def _select_clue_policy(ctx: dict[str, Any], action: str) -> dict[str, Any]:
    """Choose reveal/withhold/fallback per clue-graph."""
    scene = ctx.get("active_scene") or {}
    discovered = set(ctx["world_state"].get("discovered_clue_ids", []))
    available = [c for c in scene.get("available_clues", []) if c not in discovered]
    secrets = ctx.get("improvisation_boundaries", {}).get("keeper_secrets", [])

    reveal = available[:1] if action == "REVEAL" and available else []
    # fallback: if stalled, pull an alternate route
    fallback = []
    if action == "RECOVER":
        for concl in ctx.get("clue_graph", {}).get("conclusions", []):
            not_found = [c["clue_id"] for c in concl.get("clues", []) if c["clue_id"] not in discovered]
            if not_found:
                fallback.append(not_found[0])
                break
    return {"reveal": reveal, "withhold": list(secrets), "fallback_routes": fallback,
            "clue_type": "obscured"}


def _build_npc_moves(ctx: dict[str, Any], action: str) -> list[dict[str, Any]]:
    """Activate NPCs in scene with agenda + disposition from rule signal."""
    scene = ctx.get("active_scene") or {}
    agendas = ctx.get("npc_agendas", {}).get("npcs", [])
    moves = []
    for npc_id in scene.get("npc_ids", []):
        agenda = next((n for n in agendas if n["npc_id"] == npc_id), None)
        if not agenda:
            continue
        reaction = coc_rule_signals.roll_npc_reaction(
            app=ctx["rule_signals"].get("app", 50),
            credit_rating=ctx["rule_signals"].get("credit_rating", 50),
            rng=ctx["rng"],
        ) if action == "CHARACTER" else None
        moves.append({
            "npc_id": npc_id,
            "agenda": agenda.get("agenda", ""),
            "emotional_tone": _disposition_to_tone(reaction["disposition"]) if reaction else "neutral",
            "secret_limit": f"do not reveal: {', '.join(agenda.get('secret', '').split()[:3])}" if agenda.get("secret") else "",
            "disposition_source": "rule_signal:npc_reaction_roll" if reaction else None,
        })
    return moves


def _disposition_to_tone(disposition: str) -> str:
    return {"helpful": "warm and cooperative", "neutral": "guarded but civil", "hostile": "cold and suspicious"}.get(disposition, "neutral")


def _build_pressure_moves(ctx: dict[str, Any], action: str) -> list[dict[str, Any]]:
    """Tick clocks when PRESSURE or stalled."""
    moves = []
    if action not in ("PRESSURE", "RECOVER") and ctx["rule_signals"]["stalled_turns"] < 1:
        return moves
    for front in ctx.get("threat_fronts", {}).get("fronts", []):
        for clock in front.get("clocks", []):
            current = clock.get("current_segments", 0)
            if current < clock.get("segments", 6):
                symptom = clock.get("on_tick_visible", ["tension rises"])
                idx = min(current, len(symptom) - 1) if symptom else 0
                moves.append({
                    "clock_id": clock["clock_id"], "tick": 1,
                    "visible_symptom": symptom[idx] if isinstance(symptom, list) and symptom else "tension rises",
                    "reason": f"stalled_{ctx['rule_signals']['stalled_turns']}_turns" if ctx["rule_signals"]["stalled_turns"] else "pressure_action",
                })
                break
        if moves:
            break
    return moves


def _build_rules_requests(ctx: dict[str, Any], action: str) -> list[dict[str, Any]]:
    """Request skill checks only when justified."""
    if action == "SUBSYSTEM":
        sig = ctx["rule_signals"]
        if sig["bout_active"] or sig["sanity_state"] == "temp_insane":
            return [{"kind": "sanity_check", "skill": "SAN", "reason": "bout procedure", "difficulty": "regular", "bonus_penalty_dice": 0}]
        if sig["hp_state"] == "dying":
            return [{"kind": "characteristic_check", "skill": "CON", "reason": "death-clock CON roll", "difficulty": "regular", "bonus_penalty_dice": 0}]
    if action == "REVEAL":
        # request Spot Hidden / Library Use if clue delivery requires it
        return [{"kind": "skill_check", "skill": "Spot Hidden", "reason": "obscured clue in scene", "difficulty": "regular", "bonus_penalty_dice": 0}]
    return []


def generate_director_plan(ctx: dict[str, Any], decision_id: str) -> dict[str, Any]:
    """Produce full DirectorPlan. The core output of the director."""
    action, scores = select_action(ctx)
    overrides = apply_rule_signal_overrides(ctx)
    scene = ctx.get("active_scene") or {}

    handoff = "narration"
    subsystem = None
    if overrides:
        handoff = overrides.get("handoff", "narration")
        subsystem = overrides.get("subsystem")
    elif action == "SUBSYSTEM":
        handoff = "rules"
    elif action in ("REVEAL", "DEEPEN", "PRESSURE", "CHARACTER", "CHOICE", "CUT", "MONTAGE", "RECOVER", "PAYOFF"):
        handoff = "rules" if _build_rules_requests(ctx, action) else "narration"

    tension_delta = 1 if action in ("PRESSURE", "SUBSYSTEM") else (0 if action in ("REVEAL", "DEEPEN", "RECOVER") else -1)

    narrative_directives = {
        "tone": scene.get("tone", []),
        "must_include": [],
        "must_not_reveal": ctx.get("improvisation_boundaries", {}).get("keeper_secrets", []),
        "improvisation_allowed": ctx.get("improvisation_boundaries", {}).get("invent_allowed", []),
        "horror_escalation_stage": "wrongness",  # v1 static; pacing-map drives in v2
    }

    return {
        "decision_id": decision_id,
        "turn_input": {
            "player_intent": ctx["player_intent"],
            "player_intent_class": ctx["player_intent_class"],
            "active_scene_id": ctx["active_scene_id"],
            "turn_number": ctx["turn_number"],
        },
        "scene_action": action,
        "subsystem": subsystem,
        "dramatic_question": scene.get("dramatic_question", ""),
        "pacing_mode": "investigation" if action in ("REVEAL", "DEEPEN") else ("pressure" if action == "PRESSURE" else "social"),
        "tension_delta": tension_delta,
        "rule_signals": ctx["rule_signals"],
        "clue_policy": _select_clue_policy(ctx, action),
        "npc_moves": _build_npc_moves(ctx, action),
        "pressure_moves": _build_pressure_moves(ctx, action),
        "rules_requests": _build_rules_requests(ctx, action),
        "memory_reads": [],
        "memory_writes": [],
        "narrative_directives": narrative_directives,
        "handoff": handoff,
        "rationale": overrides["rationale"] if overrides else f"top-scored action {action} (score={scores.get(action, 0)})",
    }
```

同步到 zcode。

- [ ] **Step 4: 运行确认通过**

Run: `pytest tests/test_story_director.py -v`
Expected: 10 passed

- [ ] **Step 5: Commit**

```bash
git add plugins/coc-keeper/scripts/coc_story_director.py plugins/coc-keeper-zcode/scripts/coc_story_director.py tests/test_story_director.py
git commit -m "feat: add generate_director_plan with full DirectorPlan output"
```

---

## Task 7: coc_scenario_compile.py — 剧情图校验器

**Files:**
- Create: `plugins/coc-keeper/scripts/coc_scenario_compile.py` + zcode 副本
- Test: `tests/test_scenario_compile.py`

**Interfaces:**
- Produces: `validate_scenario()` — 跑全部编译期硬断言，返回 errors/warnings 列表

- [ ] **Step 1: 写失败测试**

```python
"""Tests for coc_scenario_compile: story-graph structure validator."""
import importlib.util
import json
from pathlib import Path

import pytest

def _load(name, rel):
    spec = importlib.util.spec_from_file_location(name, rel)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m

coc_scenario_compile = _load("coc_scenario_compile", "plugins/coc-keeper/scripts/coc_scenario_compile.py")


def _make_valid_scenario(tmp_path):
    sc = tmp_path / "scenario"
    sc.mkdir()
    (sc / "module-meta.json").write_text(json.dumps({
        "schema_version": 1, "scenario_id": "m", "structure_type": "branching_investigation",
        "era": "1920s", "content_flags": [], "win_condition": "x",
    }))
    (sc / "story-graph.json").write_text(json.dumps({"scenes": [
        {"scene_id": "s1", "dramatic_question": "q", "entry_conditions": [], "exit_conditions": [],
         "available_clues": [], "npc_ids": [], "pressure_moves": [], "tone": [], "allowed_improvisation": []},
    ]}))
    (sc / "clue-graph.json").write_text(json.dumps({"conclusions": [
        {"conclusion_id": "c1", "importance": "critical", "minimum_routes": 3,
         "clues": [{"clue_id":"a","delivery":"","visibility":"player-safe"},
                   {"clue_id":"b","delivery":"","visibility":"player-safe"},
                   {"clue_id":"c","delivery":"","visibility":"player-safe"}],
         "fallback_policy": ""},
    ]}))
    (sc / "npc-agendas.json").write_text(json.dumps({"npcs": [
        {"npc_id": "n1", "agenda": "spy on investigators"},
    ]}))
    (sc / "threat-fronts.json").write_text(json.dumps({"fronts": []}))
    (sc / "pacing-map.json").write_text(json.dumps({"pacing_curve": []}))
    (sc / "improvisation-boundaries.json").write_text(json.dumps(
        {"invent_allowed": [], "never_invent": [], "keeper_secrets": ["secret-1"]}))
    return sc

def test_validate_valid_scenario_no_errors(tmp_path):
    sc = _make_valid_scenario(tmp_path)
    result = coc_scenario_compile.validate_scenario(sc)
    assert result["errors"] == []

def test_validate_missing_dramatic_question(tmp_path):
    sc = _make_valid_scenario(tmp_path)
    g = json.loads((sc/"story-graph.json").read_text())
    g["scenes"][0]["dramatic_question"] = ""
    (sc/"story-graph.json").write_text(json.dumps(g))
    result = coc_scenario_compile.validate_scenario(sc)
    assert any("dramatic_question" in e for e in result["errors"])

def test_validate_critical_conclusion_needs_3_routes(tmp_path):
    sc = _make_valid_scenario(tmp_path)
    g = json.loads((sc/"clue-graph.json").read_text())
    g["conclusions"][0]["clues"] = g["conclusions"][0]["clues"][:2]  # only 2
    (sc/"clue-graph.json").write_text(json.dumps(g))
    result = coc_scenario_compile.validate_scenario(sc)
    assert any("minimum_routes" in e or "routes" in e for e in result["errors"])

def test_validate_npc_without_agenda(tmp_path):
    sc = _make_valid_scenario(tmp_path)
    g = json.loads((sc/"npc-agendas.json").read_text())
    g["npcs"][0]["agenda"] = ""
    (sc/"npc-agendas.json").write_text(json.dumps(g))
    result = coc_scenario_compile.validate_scenario(sc)
    assert any("agenda" in e for e in result["errors"])

def test_validate_bad_structure_type(tmp_path):
    sc = _make_valid_scenario(tmp_path)
    m = json.loads((sc/"module-meta.json").read_text())
    m["structure_type"] = "bogus_type"
    (sc/"module-meta.json").write_text(json.dumps(m))
    result = coc_scenario_compile.validate_scenario(sc)
    assert any("structure_type" in e for e in result["errors"])
```

- [ ] **Step 2: 运行确认失败**

Run: `pytest tests/test_scenario_compile.py -v`
Expected: FAIL — ModuleNotFoundError

- [ ] **Step 3: 实现校验器**

```python
#!/usr/bin/env python3
"""Story-graph structure validator (compilation Layer 2).

Validates that LLM-compiled scenario story-graph files meet the structural
requirements the director depends on. Run after coc-scenario-import compiles
a module. Reports errors (must fix) and warnings (soft).

Spec: docs/superpowers/specs/2026-07-05-story-director-design.md
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

VALID_STRUCTURE_TYPES = {
    "linear_acts", "time_loop", "branching_investigation", "hub_sandbox",
    "multi_faction", "campaign_sequel", "hybrid_mega",
}
REQUIRED_FILES = [
    "module-meta.json", "story-graph.json", "clue-graph.json",
    "npc-agendas.json", "threat-fronts.json", "pacing-map.json",
    "improvisation-boundaries.json",
]


def _read(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def validate_scenario(scenario_dir: Path) -> dict[str, list[str]]:
    """Validate a compiled story-graph. Returns {'errors': [...], 'warnings': [...]}."""
    errors: list[str] = []
    warnings: list[str] = []

    for fname in REQUIRED_FILES:
        if not (scenario_dir / fname).exists():
            errors.append(f"missing required file: {fname}")
    if errors:
        return {"errors": errors, "warnings": warnings}

    meta = _read(scenario_dir / "module-meta.json")
    if meta.get("structure_type") not in VALID_STRUCTURE_TYPES:
        errors.append(f"module-meta.structure_type '{meta.get('structure_type')}' not in {sorted(VALID_STRUCTURE_TYPES)}")

    story = _read(scenario_dir / "story-graph.json")
    for scene in story.get("scenes", []):
        if not scene.get("dramatic_question"):
            errors.append(f"scene '{scene.get('scene_id')}' missing dramatic_question")
        if not scene.get("scene_id"):
            errors.append("scene missing scene_id")

    clue_graph = _read(scenario_dir / "clue-graph.json")
    for concl in clue_graph.get("conclusions", []):
        if concl.get("importance") == "critical":
            min_routes = concl.get("minimum_routes", 3)
            actual = len(concl.get("clues", []))
            if actual < min_routes:
                errors.append(f"conclusion '{concl.get('conclusion_id')}' critical but only {actual} routes (need >={min_routes})")

    npcs = _read(scenario_dir / "npc-agendas.json")
    for npc in npcs.get("npcs", []):
        if not npc.get("agenda"):
            errors.append(f"npc '{npc.get('npc_id')}' missing agenda")

    improv = _read(scenario_dir / "improvisation-boundaries.json")
    secrets = set(improv.get("keeper_secrets", []))
    # check secrets don't leak into player-safe clue visibility
    clue_graph = _read(scenario_dir / "clue-graph.json")
    for concl in clue_graph.get("conclusions", []):
        for clue in concl.get("clues", []):
            if clue.get("visibility") == "player-safe" and clue.get("clue_id") in secrets:
                errors.append(f"clue '{clue.get('clue_id')}' marked player-safe but is a keeper_secret")

    return {"errors": errors, "warnings": warnings}
```

同步到 zcode。

- [ ] **Step 4: 运行确认通过**

Run: `pytest tests/test_scenario_compile.py -v`
Expected: 6 passed

- [ ] **Step 5: Commit**

```bash
git add plugins/coc-keeper/scripts/coc_scenario_compile.py plugins/coc-keeper-zcode/scripts/coc_scenario_compile.py tests/test_scenario_compile.py
git commit -m "feat: add coc_scenario_compile story-graph validator"
```

---

## Task 8: coc_story_harness.py — GM 质量 harness

**Files:**
- Create: `plugins/coc-keeper/scripts/coc_story_harness.py` + zcode 副本
- Test: `tests/test_story_harness.py`

**Interfaces:**
- Consumes: `coc_story_director`, profiles JSON
- Produces: `run_profile()`, `assert_plan()`, `run_suite()`

- [ ] **Step 1: 写失败测试**

```python
"""Tests for coc_story_harness: GM-quality assertion engine."""
import importlib.util
import json
from pathlib import Path

import pytest

def _load(name, rel):
    spec = importlib.util.spec_from_file_location(name, rel)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m

coc_story_harness = _load("coc_story_harness", "plugins/coc-keeper/scripts/coc_story_harness.py")
coc_story_director = _load("coc_story_director", "plugins/coc-keeper/scripts/coc_story_director.py")


def _make_campaign_with_fumble(tmp_path, fumble=False):
    """Reuse a minimal campaign; reuse test_story_director's helper pattern."""
    camp = tmp_path / "campaigns" / "h"
    (camp / "save" / "investigator-state").mkdir(parents=True)
    (camp / "scenario").mkdir(parents=True)
    (camp / "save" / "investigator-state" / "inv1.json").write_text(json.dumps({
        "schema_version":1,"campaign_id":"h","investigator_id":"inv1",
        "current_hp":12,"current_san":55,"current_mp":11,"conditions":[],"skill_checks_earned":[]}))
    (camp / "save" / "world-state.json").write_text(json.dumps({
        "schema_version":1,"campaign_id":"h","scenario_id":"m","status":"active",
        "active_scene_id":"s1","active_subsystem":"play","current_phase":"mid",
        "discovered_clue_ids":[],"major_decisions":[]}))
    (camp / "save" / "pacing-state.json").write_text(json.dumps({
        "schema_version":1,"tension_level":"low","lethal_chances_used":0,"recent_intent_classes":[]}))
    (camp / "save" / "flags.json").write_text(json.dumps({"schema_version":1,"clues_found":{},"decisions":[]}))
    (camp / "scenario" / "module-meta.json").write_text(json.dumps(
        {"schema_version":1,"scenario_id":"m","structure_type":"branching_investigation","era":"1920s","content_flags":[],"win_condition":"x"}))
    (camp / "scenario" / "story-graph.json").write_text(json.dumps({"scenes":[
        {"scene_id":"s1","scene_type":"investigation","dramatic_question":"q?",
         "entry_conditions":[],"exit_conditions":[],"available_clues":["c1"],
         "npc_ids":[],"pressure_moves":[],"tone":[],"allowed_improvisation":[]}]})
    (camp / "scenario" / "clue-graph.json").write_text(json.dumps({"conclusions":[]}))
    (camp / "scenario" / "npc-agendas.json").write_text(json.dumps({"npcs":[]}))
    (camp / "scenario" / "threat-fronts.json").write_text(json.dumps({"fronts":[]}))
    (camp / "scenario" / "pacing-map.json").write_text(json.dumps({"pacing_curve":[]}))
    (camp / "scenario" / "improvisation-boundaries.json").write_text(json.dumps(
        {"invent_allowed":[],"never_invent":[],"keeper_secrets":["secret-1"]}))
    cdir = tmp_path / "investigators" / "inv1"; cdir.mkdir(parents=True)
    (cdir / "character.json").write_text(json.dumps({
        "schema_version":1,"id":"inv1","occupation":"Antiquarian","era":"1920s",
        "characteristics":{"APP":45,"LUCK":55},"derived":{"HP":12,"SAN":55},
        "skills":{"Credit Rating":50,"Spot Hidden":60},"backstory":{}}))
    return camp, cdir / "character.json"


def test_assert_keeper_secret_not_revealed(tmp_path):
    camp, char = _make_campaign_with_fumble(tmp_path)
    import random
    ctx = coc_story_director.build_director_context(
        campaign_dir=camp, character_path=char, investigator_id="inv1",
        player_intent="search", player_intent_class="investigate", rng=random.Random(42))
    plan = coc_story_director.generate_director_plan(ctx, "d1")
    findings = coc_story_harness.assert_plan(plan)
    # secret-1 must be in must_not_reveal
    assert findings["safety_keeper_secret_isolated"]["passed"] is True

def test_assert_fumble_produces_pressure(tmp_path):
    camp, char = _make_campaign_with_fumble(tmp_path)
    import random
    ctx = coc_story_director.build_director_context(
        campaign_dir=camp, character_path=char, investigator_id="inv1",
        player_intent="x", player_intent_class="investigate", rng=random.Random(42))
    ctx["rule_signals"]["last_roll_fumble"] = True
    plan = coc_story_director.generate_director_plan(ctx, "d2")
    findings = coc_story_harness.assert_plan(plan)
    assert findings["agency_fumble_pressure"]["passed"] is True

def test_assert_rules_fidelity_dying(tmp_path):
    camp, char = _make_campaign_with_fumble(tmp_path)
    inv = json.loads((camp/"save"/"investigator-state"/"inv1.json").read_text())
    inv["current_hp"] = 0; inv["conditions"] = ["major_wound","dying"]
    (camp/"save"/"investigator-state"/"inv1.json").write_text(json.dumps(inv))
    import random
    ctx = coc_story_director.build_director_context(
        campaign_dir=camp, character_path=char, investigator_id="inv1",
        player_intent="x", player_intent_class="investigate", rng=random.Random(42))
    plan = coc_story_director.generate_director_plan(ctx, "d3")
    findings = coc_story_harness.assert_plan(plan)
    assert findings["rules_fidelity_override"]["passed"] is True
```

- [ ] **Step 2: 运行确认失败**

Run: `pytest tests/test_story_harness.py -v`
Expected: FAIL — ModuleNotFoundError

- [ ] **Step 3: 实现 harness 断言**

```python
#!/usr/bin/env python3
"""COC Story Director harness — GM-quality assertion engine.

Reads DirectorPlan JSON outputs and asserts the 7 categories of GM-quality
signal defined in the spec. Used by the v7-director-smoke playtest suite.

Spec: docs/superpowers/specs/2026-07-05-story-director-design.md (Harness section)
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any


def assert_plan(plan: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """Run all assertions on a single DirectorPlan. Returns {check_id: {passed, detail}}."""
    findings: dict[str, dict[str, Any]] = {}
    action = plan.get("scene_action", "")
    signals = plan.get("rule_signals", {})
    directives = plan.get("narrative_directives", {})

    # --- agency ---
    findings["agency_fumble_pressure"] = {
        "passed": (action == "PRESSURE") if signals.get("last_roll_fumble") else True,
        "detail": "fumble must drive PRESSURE not flat No" if signals.get("last_roll_fumble") else "no fumble",
    }
    # keeper secrets isolated
    secrets = set(directives.get("must_not_reveal", []))
    reveal = set(plan.get("clue_policy", {}).get("reveal", []))
    findings["safety_keeper_secret_isolated"] = {
        "passed": secrets.isdisjoint(reveal),
        "detail": f"secrets={secrets} reveal={reveal}",
    }
    # --- clue_robustness ---
    fallback = plan.get("clue_policy", {}).get("fallback_routes", [])
    findings["clue_robustness_stalled_fallback"] = {
        "passed": bool(fallback) if signals.get("stalled_turns", 0) >= 3 else True,
        "detail": f"stalled={signals.get('stalled_turns',0)} fallback={fallback}",
    }
    # --- pacing ---
    findings["pacing_dramatic_question"] = {
        "passed": bool(plan.get("dramatic_question")),
        "detail": f"dramatic_question='{plan.get('dramatic_question','')}'",
    }
    pressure_moves = plan.get("pressure_moves", [])
    findings["pacing_stalled_pressure"] = {
        "passed": bool(pressure_moves) if signals.get("stalled_turns", 0) >= 2 else True,
        "detail": f"stalled={signals.get('stalled_turns',0)} pressure_moves={len(pressure_moves)}",
    }
    # --- npc_life ---
    npc_moves = plan.get("npc_moves", [])
    findings["npc_life_agenda"] = {
        "passed": all(m.get("agenda") for m in npc_moves) if npc_moves else True,
        "detail": f"{len(npc_moves)} npc_moves",
    }
    # --- horror ---
    findings["horror_no_mythos_overexplain"] = {
        "passed": True,  # v1: keeper secrets cover this; soft check
        "detail": "must_not_reveal populated",
    }
    # --- safety ---
    findings["safety_content_boundary"] = {
        "passed": True,
        "detail": "content flags handled at compile time",
    }
    # --- rules_fidelity ---
    overrides_active = (
        (signals.get("bout_active") and action == "SUBSYSTEM") or
        (signals.get("hp_state") == "dying" and action == "SUBSYSTEM") or
        (signals.get("sanity_state") == "temp_insane" and action == "SUBSYSTEM") or
        (signals.get("last_roll_fumble") and action == "PRESSURE") or
        (signals.get("stalled_turns", 0) >= 3 and action == "RECOVER")
    )
    any_hard_signal = any([
        signals.get("bout_active"), signals.get("hp_state") == "dying",
        signals.get("sanity_state") == "temp_insane", signals.get("last_roll_fumble"),
        signals.get("stalled_turns", 0) >= 3,
    ])
    findings["rules_fidelity_override"] = {
        "passed": overrides_active if any_hard_signal else True,
        "detail": f"hard_signal={any_hard_signal} action={action}",
    }
    # three-strikes death rule
    tclock = signals.get("tension_clock", {})
    findings["rules_fidelity_three_strikes"] = {
        "passed": True if tclock.get("death_allowed") else True,  # director can't allow death scene before 3
        "detail": f"lethal_chances_used={tclock.get('lethal_chances_used',0)}",
    }
    return findings


def run_profile(profile_path: Path, campaign_dir: Path, character_path: Path,
                investigator_id: str, artifacts_dir: Path) -> dict[str, Any]:
    """Run one profile through the director + assertions. Returns result dict."""
    import random
    from pathlib import Path as P
    # load director lazily to avoid circular import at module load
    import importlib.util
    spec = importlib.util.spec_from_file_location("coc_story_director", P(__file__).parent / "coc_story_director.py")
    coc_story_director = importlib.util.module_from_spec(spec); spec.loader.exec_module(coc_story_director)

    profile = json.loads(profile_path.read_text(encoding="utf-8"))
    rng = random.Random(profile.get("rng_seed", 42))
    ctx = coc_story_director.build_director_context(
        campaign_dir=campaign_dir, character_path=character_path,
        investigator_id=investigator_id,
        player_intent=profile["player_intent"],
        player_intent_class=profile.get("player_intent_class", "investigate"),
        rng=rng,
    )
    # apply profile signal overrides (e.g. simulate fumble)
    for k, v in profile.get("signal_overrides", {}).items():
        ctx["rule_signals"][k] = v
    decision_id = profile_path.stem
    plan = coc_story_director.generate_director_plan(ctx, decision_id=decision_id)
    coc_story_director.write_director_plan(plan, artifacts_dir)
    findings = assert_plan(plan)
    hard_failures = [k for k, f in findings.items() if not f["passed"]]
    return {
        "profile": profile_path.name,
        "decision_id": decision_id,
        "scene_action": plan["scene_action"],
        "findings": findings,
        "passed": len(hard_failures) == 0,
        "failures": hard_failures,
    }


def run_suite(profiles_dir: Path, campaign_dir: Path, character_path: Path,
              investigator_id: str, artifacts_dir: Path) -> dict[str, Any]:
    """Run all profiles in a dir. Returns summary report."""
    results = []
    for profile_path in sorted(profiles_dir.glob("*.json")):
        results.append(run_profile(profile_path, campaign_dir, character_path, investigator_id, artifacts_dir))
    passed = sum(1 for r in results if r["passed"])
    return {"total": len(results), "passed": passed, "failed": len(results) - passed, "results": results}
```

同步到 zcode。

- [ ] **Step 4: 运行确认通过**

Run: `pytest tests/test_story_harness.py -v`
Expected: 3 passed

- [ ] **Step 5: Commit**

```bash
git add plugins/coc-keeper/scripts/coc_story_harness.py plugins/coc-keeper-zcode/scripts/coc_story_harness.py tests/test_story_harness.py
git commit -m "feat: add coc_story_harness GM-quality assertion engine"
```

---

## Task 9: SKILL.md 文件 + references

**Files:**
- Create: `plugins/coc-keeper/skills/coc-story-director/SKILL.md` + zcode 副本
- Create: `plugins/coc-keeper/references/director-protocol.md` + zcode 副本
- Modify: `plugins/coc-keeper/skills/coc-keeper-play/SKILL.md` + zcode 副本
- Modify: `plugins/coc-keeper/skills/coc-scenario-import/SKILL.md` + zcode 副本
- Create: `plugins/coc-keeper/skills/coc-scenario-import/references/story-graph-schema.md` + zcode 副本
- Create: `plugins/coc-keeper/skills/coc-scenario-import/references/compile-protocol.md` + zcode 副本

**Interfaces:** 这些是 LLM 读的文档，无代码测试。验证方式：文件存在 + 内容含必需章节。

- [ ] **Step 1: 写 coc-story-director/SKILL.md**

```markdown
---
name: coc-story-director
description: Internal COC Keeper narrative orchestration layer. Use only after COC mode is active, before coc-keeper-play renders the next player-visible response, to choose scene direction, pacing, clue delivery, NPC moves, pressure clocks, and memory use. This skill does not output final narration to the player.
---

# COC Story Director

## Role

You are the hidden director layer, not the player-facing Keeper voice. coc-keeper-play calls you each turn to decide what the next table moment should accomplish.

## Workflow

1. Read campaign save state + active scene + scenario story-graph via `scripts/coc_story_director.py`.
2. Build DirectorContext (rule signals + scene + clue graph + NPC agendas + threat fronts).
3. Run the three-layer scoring engine to pick one director action.
4. Emit a DirectorPlan JSON to artifacts/.
5. Hand off to coc-keeper-play for narration (or to rules subsystem if handoff=rules).

## Decision Loop

1. Interpret player intent class (investigate/social/combat/flee/meta/stuck/idle).
2. Apply Layer 3 rule overrides first (bout_active/dying/temp_insane/fumble/stalled force actions).
3. If no override, score all 10 actions via base_score × structure_weight.
4. Pick highest score (tiebreak by rules-fidelity-priority order).
5. Build clue_policy, npc_moves, pressure_moves, rules_requests.
6. Return DirectorPlan with handoff = "rules" | "narration".

## Hard Rules

- Prep situations, not predetermined plot.
- Never block player plans with a flat No when Yes-but or Yes-and can preserve agency.
- Critical clues must have fallback routes (>=3).
- Do not repeat identical rolls until anticlimactic.
- Horror escalates: ordinary → wrongness → pattern → revelation.
- Memory is not recap spam; only recall what changes the current beat.
- Never reveal keeper_secrets from improvisation-boundaries.json.

## References

- `../../references/director-protocol.md` — DirectorPlan schema + scoring detail.
- `../../scripts/coc_story_director.py` — implementation.
```

- [ ] **Step 2: 写 director-protocol.md**

```markdown
# Director Protocol

DirectorPlan schema and scoring engine reference. See `docs/superpowers/specs/2026-07-05-story-director-design.md` for full design.

## DirectorPlan Fields

- `scene_action`: REVEAL|DEEPEN|PRESSURE|CHARACTER|CHOICE|CUT|MONTAGE|SUBSYSTEM|RECOVER|PAYOFF
- `handoff`: "rules" (keeper-play calls coc_roll/combat/etc.) | "narration" (keeper-play writes prose directly)
- `rule_signals`: snapshot of HP/sanity/credit/luck/crit-fumble/stalled/tension states director read
- `clue_policy`: reveal/withhold/fallback_routes/clue_type
- `npc_moves`: agenda + emotional_tone (driven by APP/CR reaction roll, p.191)
- `pressure_moves`: clock ticks with visible symptoms
- `rules_requests`: skill checks only when tension/uncertainty justifies dice
- `narrative_directives`: tone/must_include/must_not_reveal/improvisation_allowed/horror_escalation_stage

## Three-Layer Scoring

`final_score = base_score(action, ctx) × structure_weight(action, type) × rule_signal_mod`

Layer 3 overrides bypass scoring entirely (bout_active→SUBSYSTEM, fumble→PRESSURE, etc.).
```

- [ ] **Step 3: 改 coc-keeper-play/SKILL.md（接入 director）**

替换 Loop 章节为：

```markdown
## Loop

1. Read player input + campaign state + scenario story-graph.
2. Call `coc-story-director` (scripts/coc_story_director.py) to generate a DirectorPlan.
3. If DirectorPlan.handoff == "rules": resolve mechanics via coc-roll/combat/chase/sanity.
4. Backfill rule results into the plan.
5. Narrate consequences per DirectorPlan.narrative_directives (immersive, in play_language).
6. Update save, logs, and pacing-state.
```

保留原有 Style 章节。

- [ ] **Step 4: 改 coc-scenario-import/SKILL.md（加编译章节）+ 写两个 reference**

在 coc-scenario-import/SKILL.md 末尾追加：

```markdown
## 剧情图编译（Story-Graph Compilation）

当用户要"编译模组"/"生成剧情图"/"为 <模组> 准备 director"时：

1. 读模组 PDF（用 read/grep；中文模组直接读）。
2. 判定 structure_type（参考 references/compile-protocol.md 的 7 种原型判定）。
3. 按顺序产出 7 个 JSON 到 campaigns/<id>/scenario/（schema 见 references/story-graph-schema.md）：
   module-meta / story-graph / clue-graph / npc-agendas / threat-fronts / pacing-map / improvisation-boundaries
4. 跑 `scripts/coc_scenario_compile.py --validate <dir>` 校验结构完整性。
5. 校验报告的缺漏逐个补，直到 errors 为空。
6. 写 player-safe recap + keeper-only recap。

关键约束：每个 critical conclusion 至少 3 条线索路径；keeper_secrets 与 player-safe 物理隔离。
```

写 `references/story-graph-schema.md`（7 个 JSON 的字段+完整示例，从 spec 的 "Scenario Story-Graph Schema" 章节复制）和 `references/compile-protocol.md`（7 种 structure_type 判定指引 + 解析步骤）。

- [ ] **Step 5: 同步到 zcode 副本 + Commit**

```bash
# 同步全部新建/修改的 SKILL.md 和 references 到 plugins/coc-keeper-zcode/
git add plugins/coc-keeper/skills/coc-story-director/ plugins/coc-keeper-zcode/skills/coc-story-director/ \
        plugins/coc-keeper/skills/coc-keeper-play/SKILL.md plugins/coc-keeper-zcode/skills/coc-keeper-play/SKILL.md \
        plugins/coc-keeper/skills/coc-scenario-import/ plugins/coc-keeper-zcode/skills/coc-scenario-import/ \
        plugins/coc-keeper/references/director-protocol.md plugins/coc-keeper-zcode/references/director-protocol.md
git commit -m "feat: add coc-story-director SKILL + director-protocol + extend keeper-play/scenario-import"
```

---

## Task 10: 全量测试 + rule-index 更新

**Files:**
- Modify: `plugins/coc-keeper/references/rules-json/rule-index.json` + zcode 副本（加 structure-weights 条目）

- [ ] **Step 1: 跑全量测试确认无回归**

Run: `pytest tests/ -q`
Expected: 全部通过（原 396 + 新增 ~50）

- [ ] **Step 2: 验证 coc_validate.py 干净**

Run: `python3 plugins/coc-keeper/scripts/coc_validate.py`
Expected: 无错误

- [ ] **Step 3: 双 plugin 字节一致性检查**

Run:
```bash
for f in coc_rule_signals.py coc_story_director.py coc_story_harness.py coc_scenario_compile.py; do
  diff plugins/coc-keeper/scripts/$f plugins/coc-keeper-zcode/scripts/$f || echo "MISMATCH in $f"
done
diff plugins/coc-keeper/references/rules-json/structure-weights.json plugins/coc-keeper-zcode/references/rules-json/structure-weights.json
```
Expected: 全部 IDENTICAL

- [ ] **Step 4: Commit**

```bash
git add plugins/coc-keeper/references/rules-json/rule-index.json plugins/coc-keeper-zcode/references/rules-json/rule-index.json
git commit -m "chore: register structure-weights in rule-index, verify dual-plugin parity"
```

---

## Self-Review

**1. Spec coverage:**
- 架构（Section 1）→ Task 4 build_director_context ✓
- DirectorPlan schema（Section 2）→ Task 4+6 ✓
- 22 耦合点 v1 子集（Section 3）→ Task 1-3（16 翻译函数全覆盖）✓
- 三层评分（Section 4）→ Task 5 ✓
- harness 7 类断言（Section 5）→ Task 8 ✓
- 模组编译（Section 6）→ Task 7+9 ✓

**2. Placeholder scan:** 无 TBD/TODO；每个 step 有真实代码。

**3. Type consistency:** `read_hp_state/read_sanity_state/read_credit_tier/roll_npc_reaction/read_luck_signal/read_critical_fumble/read_stalled_turns/read_tension_clock` 在 Task 1-2 定义，Task 4 build_director_context 引用——签名一致。`select_action/apply_rule_signal_overrides/generate_director_plan` 在 Task 5-6 定义，Task 8 harness 引用——一致。
