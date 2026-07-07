# 内置开箱即玩模组《白色战争》实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 COC 插件内置一个开箱即玩的 OGL 改编剧本《白色战争》(The White War)，新人在创建战役后被主动引导选择「自带剧本 / 内置剧本」，零 PDF 准备即可开玩。

**Architecture:** OGL 双轨——OGC 数值（Polyp Horror 怪物、寒冷规则、武器）忠实打包进 `rules-json/the-white-war.json` 并登记 `module.white_war.*` 规则命名空间；剧情/地点/NPC/对话为 Product Identity，故以「冰封竖井释放远古实体」的 OGC 抽象前提原创一个等价探险（7 个 story-graph JSON）。新增 Python loader `coc_starter.py` 负责列出/安装内置剧本到 campaign 目录。coc-main 工作流插入一个 Hard Rule：新档无剧本时强制弹出二选一引导。

**Tech Stack:** Python 3（stdlib only，无新依赖）、JSON、Markdown、pytest。两个插件轨由 `scripts/sync_coc_plugin_copy.py` 自动同步（`rglob` 全量镜像，新文件无需改 sync 脚本）。

## Global Constraints

- **法律双轨不可逾越**：OGC 数值（Polyp Horror stat block p8-10、寒冷规则、武器数据）可忠实分发并附完整 OGL §15 归属；剧情/地点/人物/对话/地图属 Product Identity，**不得**逐字照搬——必须原创姓名、地点、场景描写、对话。所有 NPC 对话强制原创。
- **rule id 正则**：`^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$`（全小写，点分段）。"The White War" → `module.white_war.*`。
- **scenario 文件契约**：director 运行期只读 `campaigns/<id>/scenario/` 下 7 个 story-graph JSON（`coc_story_director.py:95-183`）。内置剧本必须经 loader 拷贝进该位置才能跑。
- **校验器约束**：scenario 目录必须通过 `coc_scenario_compile.py --validate` 无 error；critical conclusion 的 clues 数 ≥ minimum_routes（默认 3）；每个 scene 的 `dramatic_question` 非空；每个 NPC 有非空 `agenda`；`keeper_secrets` 不得与 player-safe clue_id 撞名。
- **双轨同步**：所有 `plugins/coc-keeper/` 下的改动，完成后必须跑 `python3 scripts/sync_coc_plugin_copy.py` 同步到 `plugins/coc-keeper-zcode/`，再跑 `--check` 确认一致。
- **回归门禁**：每批任务结束至少跑 `pytest tests/test_plugin_metadata.py tests/test_zcode_plugin_metadata.py tests/test_coc_plugin_sync_script.py -q -p no:cacheprovider` + `python3 scripts/sync_coc_plugin_copy.py --check`。
- **era 登记约束**：`coc_state.py:307` 的 `_ERA_CLOCKS` 字典决定 era 时钟初始化；新增 `ww1` era 必须在此登记，否则回退 1920s 默认。

## File Structure

**新建文件**:
- `plugins/coc-keeper/references/rules-json/the-white-war.json` — OGC 规则包（Polyp Horror/寒冷/武器/半物质致命度）。
- `plugins/coc-keeper/references/starter-scenarios/the-white-war/module-meta.json` — 剧本元数据（含 OGL 字段）。
- `plugins/coc-keeper/references/starter-scenarios/the-white-war/story-graph.json` — 11 个 scene 的剧情图。
- `plugins/coc-keeper/references/starter-scenarios/the-white-war/clue-graph.json` — 线索/结论图。
- `plugins/coc-keeper/references/starter-scenarios/the-white-war/npc-agendas.json` — NPC 议程。
- `plugins/coc-keeper/references/starter-scenarios/the-white-war/threat-fronts.json` — 威胁前沿。
- `plugins/coc-keeper/references/starter-scenarios/the-white-war/pacing-map.json` — 节奏曲线。
- `plugins/coc-keeper/references/starter-scenarios/the-white-war/improvisation-boundaries.json` — 即兴边界（含 keeper_secrets）。
- `plugins/coc-keeper/references/starter-scenarios/the-white-war/pregen-investigators.json` — 5 个改编 pre-gen 调查员。
- `plugins/coc-keeper/references/starter-scenarios/the-white-war/OGL-LICENSE.txt` — OGL v1.0a 全文。
- `plugins/coc-keeper/references/starter-scenarios/the-white-war/README.md` — OGL §15 归属 + OGC/PI 划分说明。
- `plugins/coc-keeper/scripts/coc_starter.py` — loader（list/install + CLI）。
- `tests/test_starter_scenarios.py` — loader + scenario 校验测试。
- `tests/test_white_war_rules.py` — OGC 规则包 + rule-index 登记 + CE→7e 转换约定测试。

**修改文件**:
- `plugins/coc-keeper/references/rules-json/rule-index.json` — 追加 `module.white_war.*` 规则条目。
- `plugins/coc-keeper/scripts/coc_validate.py:10-46` — `REQUIRED_RULE_FILES` 追加 `the-white-war.json`。
- `plugins/coc-keeper/scripts/coc_rules.py:245-250` — 泛化 `the_haunting_rules()` 为 `module_rules(scenario_id)`，`the_haunting_rules` 改薄包装。
- `plugins/coc-keeper/scripts/coc_state.py:307-326` — `_ERA_CLOCKS` 追加 `ww1` 条目。
- `plugins/coc-keeper/skills/coc-main/SKILL.md` — 工作流插入引导节点 + Hard Rule。
- `README.md` — 版权章节追加 OGL starter scenario 声明。

（以上 `plugins/coc-keeper/` 的改动由 sync 自动镜像到 `plugins/coc-keeper-zcode/`。）

---

## Task 1: OGC 规则包 `the-white-war.json`

**Files:**
- Create: `plugins/coc-keeper/references/rules-json/the-white-war.json`
- Test: `tests/test_white_war_rules.py`

**Interfaces:**
- Produces: `the-white-war.json` 文件，顶层结构 `{scenario_id, module_title, source_note, rules, weapons}`，`rules` 是 dict（key=规则短名，value 含 `source_rule_id`）；被 Task 5 的 `module_rules()` 加载，被 Task 3 的 rule-index 引用。

**法律约束**: 所有数值忠实取自 OGC（PDF p8-10 怪物描述 + p3-5 寒冷规则 + p4 武器数据）。规则 id 全小写。

- [ ] **Step 1: 写失败测试**

Create `tests/test_white_war_rules.py`:

```python
#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path

import pytest

PLUGIN_ROOT = Path(__file__).resolve().parent.parent / "plugins" / "coc-keeper"
RULES_DIR = PLUGIN_ROOT / "references" / "rules-json"


@pytest.fixture()
def white_war_table():
    return json.loads((RULES_DIR / "the-white-war.json").read_text(encoding="utf-8"))


def test_top_level_structure(white_war_table):
    assert white_war_table["scenario_id"] == "the-white-war"
    assert white_war_table["module_title"] == "The White War"
    assert "source_note" in white_war_table
    assert isinstance(white_war_table["rules"], dict)
    assert isinstance(white_war_table["weapons"], list)


def test_polyp_horror_stat_block_is_ogc_faithful(white_war_table):
    """Polyp Horror 数值忠实于 OGC (PDF p8-10)，属 Open Game Content。"""
    horror = white_war_table["rules"]["polyp_horror"]
    assert horror["source_rule_id"] == "module.white_war.polyp_horror"
    assert horror["str"] == 100
    assert horror["con"] == 100
    assert horror["dex"] == 15
    assert horror["int"] == 25
    assert horror["pow"] == 30
    assert horror["hp"] == 100
    assert horror["san_loss"] == "1D6/1D12"
    assert horror["retreat_below_hp"] == 20
    assert horror["size_bonus_percent"] == 20


def test_rule_ids_all_lowercase_dotted(white_war_table):
    """所有 source_rule_id 符合 rule-index 正则 ^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$"""
    import re
    pattern = re.compile(r"^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$")
    for key, rule in white_war_table["rules"].items():
        rid = rule["source_rule_id"]
        assert pattern.match(rid), f"rule id {rid} 不符合正则"
        assert rid.startswith("module.white_war."), f"rule id {rid} 命名空间错误"


def test_cold_exposure_rule_present(white_war_table):
    cold = white_war_table["rules"]["cold_exposure"]
    assert cold["source_rule_id"] == "module.white_war.cold_exposure"
    assert cold["outdoor_temp_celsius"] == -30
    assert cold["hp_damage_per_interval"] == "1D8"
    assert cold["interval_minutes"] == 5


def test_weapons_have_7e_stats(white_war_table):
    """武器转成 7e 约定：每件有 weapon_id/name/damage/range。"""
    for w in white_war_table["weapons"]:
        assert "weapon_id" in w
        assert "name" in w
        assert "damage" in w
    ids = {w["weapon_id"] for w in white_war_table["weapons"]}
    assert "mannlicher_carcano_rifle" in ids
    assert "beretta_9mm_pistol" in ids
```

- [ ] **Step 2: 运行测试确认失败**

Run: `PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/test_white_war_rules.py -q -p no:cacheprovider`
Expected: FAIL — `FileNotFoundError`（the-white-war.json 不存在）。

- [ ] **Step 3: 写 `the-white-war.json`（OGC 数值忠实）**

Create `plugins/coc-keeper/references/rules-json/the-white-war.json`. 数值取自 OGC（PDF p3-5 寒冷规则、p4 武器、p8-10 Polyp Horror 怪物描述——均属 Open Game Content）:

```json
{
  "scenario_id": "the-white-war",
  "module_title": "The White War",
  "source_note": "Open Game Content adapted from 'The White War' by Paul StJohn Mackintosh (Cthulhu Reborn Publishing, 2023), published under the Open Gaming License v1.0a. Per the source OGC declaration, numeric game data and creature descriptions (PDF p8-10) are Open Game Content; plots, locations, characters, and dialogue are Product Identity and are NOT reproduced here.",
  "rules": {
    "polyp_horror": {
      "source_rule_id": "module.white_war.polyp_horror",
      "str": 100,
      "con": 100,
      "dex": 15,
      "int": 25,
      "pow": 30,
      "hp": 100,
      "db": 0,
      "build": 8,
      "movement": 10,
      "san_loss": "1D6/1D12",
      "retreat_below_hp": 20,
      "size_bonus_percent": 20,
      "armor_points": 0,
      "attacks": {
        "tentacle_slash": {
          "skill_percent": 60,
          "lethality_rating": 50,
          "knock_down": true,
          "ignores_armor": true
        },
        "wind_blast": {
          "skill_percent": 99,
          "area_of_effect_yards": 3,
          "damage_environmental": "1D8 or 1D10 on impact, or falling damage",
          "dodge_resisted_by": "Athletics"
        }
      },
      "special_abilities": {
        "unnatural_matter": "non-Lethal successful attacks deal max 1 HP; see module.white_war.lethality_vs_semi_material",
        "flying": true,
        "penetrating_attacks": "all Polyp Horror attacks ignore armor entirely",
        "daylight_penalty_percent": -20,
        "daylight_wind_reactivation_prep_rounds": 1
      }
    },
    "cold_exposure": {
      "source_rule_id": "module.white_war.cold_exposure",
      "outdoor_temp_celsius": -30,
      "windchill_temp_celsius": -40,
      "interval_minutes": 5,
      "hp_damage_per_interval": "1D8",
      "stun_threshold": "immobile and suffer 1D8 HP every 5 min",
      "warmth_recovery": "1 CON point per minute of warmth/shelter",
      "outdoor_resource_cost_per_interval": 1,
      "extreme_effort_con_test": "CON x5 to avoid Exhaustion",
      "frostbite_fumble_hp": 1,
      "tunnel_interior_temp_celsius": 0,
      "fully_prepared_in_shelter": true
    },
    "lethality_vs_semi_material": {
      "source_rule_id": "module.white_war.lethality_vs_semi_material",
      "lethality_below_15_percent": "no damage at all",
      "lethality_15_plus_odd_roll": "attack passes through, no damage",
      "lethality_15_plus_even_roll": "Hit Point damage equal to Lethality Rating",
      "applies_to": "Polyp Horror and other semi-material entities"
    },
    "daylight_penalty": {
      "source_rule_id": "module.white_war.daylight_penalty",
      "all_skills_penalty_percent": -20,
      "behavior": "stays in shadows at mountain base in whirl-of-snow form",
      "wind_reactivation_cost": "1 round preparation, 5 resource points",
      "applies_to": "Polyp Horror"
    },
    "conclusion_sanity_rewards": {
      "source_rule_id": "module.white_war.conclusion_sanity_rewards",
      "forced_retreat_reward": "1D6 SAN",
      "mission_completed_reward": "1D3 SAN",
      "truth_suppressed_reward": "1D3 SAN",
      "white_friday_guilt_loss": "0/1D6 SAN [helplessness]"
    },
    "avalanche_damage": {
      "source_rule_id": "module.white_war.avalanche_damage",
      "damage": "10D6",
      "entity_not_immune": true,
      "str_test_to_avoid_being_swept": "STR x5",
      "trigger_chance_per_shot": "1%",
      "trigger_chance_per_grenade": "5%",
      "signal_call_chance_per_turn": "30%"
    }
  },
  "weapons": [
    {
      "weapon_id": "mannlicher_carcano_rifle",
      "name": "Mannlicher-Carcano 6.5mm rifle",
      "skill": "Firearms (Rifle)",
      "damage": "1D12+2",
      "range_yards": 150,
      "ammo_per_clip": 6,
      "spare_clips_typical": 4,
      "condition": "heavily worn"
    },
    {
      "weapon_id": "beretta_9mm_pistol",
      "name": "Beretta Brevetta 9mm pistol",
      "skill": "Firearms (Handgun)",
      "damage": "1D10",
      "range_yards": 15,
      "ammo_per_clip": 8,
      "carried_by": "lieutenant",
      "condition": "heavily worn"
    },
    {
      "weapon_id": "bessozzi_pineapple_grenade",
      "name": "Bessozzi pineapple grenade",
      "skill": "Athletics (Throw)",
      "damage": "3D6",
      "lethality_rating_7e_house_rule": 12,
      "kill_radius_yards": 4,
      "base_range_yards": 45
    },
    {
      "weapon_id": "trench_knife",
      "name": "Trench knife",
      "skill": "Fighting (Brawl)",
      "damage": "1D6",
      "range": "melee"
    },
    {
      "weapon_id": "entrenching_tool",
      "name": "Entrenching tool",
      "skill": "Fighting (Melee)",
      "damage": "1D8+1",
      "range": "melee"
    },
    {
      "weapon_id": "makeshift_club",
      "name": "Makeshift club",
      "skill": "Fighting (Melee)",
      "damage": "1D6",
      "range": "melee"
    }
  ]
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/test_white_war_rules.py -q -p no:cacheprovider`
Expected: PASS (5 tests)。

- [ ] **Step 5: 提交**

```bash
git add plugins/coc-keeper/references/rules-json/the-white-war.json tests/test_white_war_rules.py
git commit -m "feat(coc): add OGC rules package the-white-war.json (Polyp Horror, cold, weapons)"
```

---

## Task 2: rule-index 登记 + REQUIRED_RULE_FILES

**Files:**
- Modify: `plugins/coc-keeper/references/rules-json/rule-index.json`
- Modify: `plugins/coc-keeper/scripts/coc_validate.py:10-46`
- Test: `tests/test_white_war_rules.py`（追加测试）

**Interfaces:**
- Consumes: Task 1 的 `the-white-war.json`（`source_table` 必须指向它）。
- Produces: `module.white_war.*` 在 rule-index 登记；`the-white-war.json` 进入 `REQUIRED_RULE_FILES`，使 `coc_validate.py` 校验通过。

- [ ] **Step 1: 写失败测试**

Append to `tests/test_white_war_rules.py`:

```python
def test_rule_index_contains_white_war_entries():
    """所有 module.white_war.* 规则登记进 rule-index.json。"""
    index = json.loads((RULES_DIR / "rule-index.json").read_text(encoding="utf-8"))
    ids = {r["id"] for r in index["rules"]}
    expected = {
        "module.white_war.polyp_horror",
        "module.white_war.cold_exposure",
        "module.white_war.lethality_vs_semi_material",
        "module.white_war.daylight_penalty",
        "module.white_war.conclusion_sanity_rewards",
        "module.white_war.avalanche_damage",
    }
    missing = expected - ids
    assert not missing, f"rule-index 缺少: {missing}"


def test_rule_index_white_war_entries_have_correct_source_table():
    index = json.loads((RULES_DIR / "rule-index.json").read_text(encoding="utf-8"))
    for r in index["rules"]:
        if r["id"].startswith("module.white_war."):
            assert r["source_table"] == "the-white-war.json", f"{r['id']} source_table 错误"
            assert r["category"] == "module_rule", f"{r['id']} category 错误"
            assert r["module"] == "The White War", f"{r['id']} module 字段错误"


def test_required_rule_files_includes_white_war():
    """coc_validate.py 的 REQUIRED_RULE_FILES 必须含 the-white-war.json，否则校验报 missing。"""
    import importlib.util
    spec = importlib.util.spec_from_file_location(
        "coc_validate", PLUGIN_ROOT / "scripts" / "coc_validate.py"
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    assert "the-white-war.json" in mod.REQUIRED_RULE_FILES
```

- [ ] **Step 2: 运行测试确认失败**

Run: `PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/test_white_war_rules.py -q -p no:cacheprovider`
Expected: 3 个新测试 FAIL（rule-index 无 white_war 条目、REQUIRED_RULE_FILES 不含）。

- [ ] **Step 3: 在 rule-index.json 追加 6 条规则**

Read `plugins/coc-keeper/references/rules-json/rule-index.json`，找到 `the-haunting` 规则条目块（`module.haunting.*`，约在 :402-494 行附近）作为格式模板。在该块的 `]` 之前（rules 数组末尾）追加这 6 条（保持与现有条目相同的字段结构 `id/category/source_table/source_note/numeric`）。示例（`numeric` 字段填关键数值）:

```json
{
  "id": "module.white_war.polyp_horror",
  "category": "module_rule",
  "module": "The White War",
  "source_table": "the-white-war.json",
  "source_note": "Polyp Horror stat block (OGC, source PDF p8-10). Semi-material; tentacle slash Lethality 50% + knock down; wind blast; ignores armor; SAN 1D6/1D12; retreats at <=20 HP.",
  "numeric": {"str": 100, "con": 100, "dex": 15, "int": 25, "pow": 30, "hp": 100, "san_loss": "1D6/1D12", "retreat_below_hp": 20}
},
{
  "id": "module.white_war.cold_exposure",
  "category": "module_rule",
  "module": "The White War",
  "source_table": "the-white-war.json",
  "source_note": "Cold exposure rules (OGC, source PDF p3-5). Outdoor -30C (-40C windchill); 1D8 HP per 5 min; tunnel interior 0C.",
  "numeric": {"outdoor_temp_celsius": -30, "hp_damage_per_interval": "1D8", "interval_minutes": 5}
},
{
  "id": "module.white_war.lethality_vs_semi_material",
  "category": "module_rule",
  "module": "The White War",
  "source_table": "the-white-war.json",
  "source_note": "Lethality vs semi-material entities (OGC). Lethality <15% no damage; >=15% even roll = HP damage equal to rating, odd = pass through.",
  "numeric": {"lethality_threshold": 15}
},
{
  "id": "module.white_war.daylight_penalty",
  "category": "module_rule",
  "module": "The White War",
  "source_table": "the-white-war.json",
  "source_note": "Polyp Horror daylight penalty (OGC). -20% all skills in daylight; wind reactivation needs 1 round prep.",
  "numeric": {"all_skills_penalty_percent": -20}
},
{
  "id": "module.white_war.conclusion_sanity_rewards",
  "category": "module_rule",
  "module": "The White War",
  "source_table": "the-white-war.json",
  "source_note": "Conclusion SAN rewards (OGC). Forced entity retreat +1D6; mission complete +1D3; truth suppressed +1D3; White Friday guilt 0/1D6.",
  "numeric": {"forced_retreat": "1D6", "mission_complete": "1D3", "truth_suppressed": "1D3"}
},
{
  "id": "module.white_war.avalanche_damage",
  "category": "module_rule",
  "module": "The White War",
  "source_table": "the-white-war.json",
  "source_note": "Avalanche damage vs Polyp Horror (OGC). 10D6 damage; entity not immune; STR x5 to avoid being swept.",
  "numeric": {"damage": "10D6", "entity_not_immune": true}
}
```

追加时注意 JSON 语法（前一条末尾逗号、数组闭合）。可用 `python3 -c "import json; json.load(open('plugins/coc-keeper/references/rules-json/rule-index.json'))"` 验证 JSON 合法。

- [ ] **Step 4: 把 `the-white-war.json` 加入 REQUIRED_RULE_FILES**

In `plugins/coc-keeper/scripts/coc_validate.py`，在 `REQUIRED_RULE_FILES` 列表中 `"the-haunting.json",`（约第 34 行）之后追加一行:

```python
    "the-white-war.json",
```

- [ ] **Step 5: 运行测试确认通过**

Run: `PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/test_white_war_rules.py -q -p no:cacheprovider`
Expected: PASS (8 tests)。

- [ ] **Step 6: 跑 coc_validate 确认整体规则校验通过**

Run: `PYTHONDONTWRITEBYTECODE=1 python3 plugins/coc-keeper/scripts/coc_validate.py plugins/coc-keeper 2>&1 | tail -20`
Expected: 无 error（exit 0 或仅 warnings）。若有 `invalid rule-index id` 检查全小写；若有 `missing source_table entry` 检查文件名拼写。

- [ ] **Step 7: 提交**

```bash
git add plugins/coc-keeper/references/rules-json/rule-index.json plugins/coc-keeper/scripts/coc_validate.py tests/test_white_war_rules.py
git commit -m "feat(coc): register module.white_war.* rules in rule-index and REQUIRED_RULE_FILES"
```

---

## Task 3: loader `coc_starter.py`

**Files:**
- Create: `plugins/coc-keeper/scripts/coc_starter.py`
- Test: `tests/test_starter_scenarios.py`

**Interfaces:**
- Consumes: Task 1 的 `the-white-war.json`（间接，通过 rule-index）；Task 4-9 的 starter scenario 文件（`module-meta.json` 等被 list 读取；install 拷贝 7 个 story-graph JSON）。
- Produces:
  - `list_starter_scenarios() -> list[dict]`：枚举内置剧本，返回 `[{scenario_id, title, one_liner, structure_type, era, content_flags}]`。
  - `install_starter(root: Path, campaign_id: str, scenario_id: str) -> Path`：拷贝 7 个 story-graph JSON + pregen 到 `campaigns/<id>/scenario/`，写 campaign.json 字段，返回 scenario 目录。幂等：目标已有 scenario 报错。
  - `STARTER_SCENARIO_FILES`：7 个 story-graph 文件名的元组常量（供测试引用）。
  - CLI: `python3 coc_starter.py list` / `install --campaign <id> --scenario <id> [--root <path>]`。

- [ ] **Step 1: 写失败测试**

Create `tests/test_starter_scenarios.py`:

```python
#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

PLUGIN_ROOT = Path(__file__).resolve().parent.parent / "plugins" / "coc-keeper"
SCRIPTS_DIR = PLUGIN_ROOT / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

import coc_starter  # noqa: E402


def test_list_starter_scenarios_returns_white_war():
    starters = coc_starter.list_starter_scenarios()
    assert len(starters) >= 1
    ww = next(s for s in starters if s["scenario_id"] == "the-white-war")
    assert ww["title"] == "The White War"
    assert ww["structure_type"] == "linear_acts"
    assert ww["era"] == "ww1"
    assert isinstance(ww["content_flags"], list)
    assert "one_liner" in ww and ww["one_liner"]


def test_install_starter_copies_seven_files(tmp_path):
    root = tmp_path / ".coc"
    # 用 coc_state 建一个真 campaign
    sys.path.insert(0, str(SCRIPTS_DIR))
    import coc_state  # noqa: E402
    coc_state.ensure_workspace(root)
    campaign_path = coc_state.create_campaign(root, "test-camp", "Test", era="ww1")
    campaign_dir = campaign_path.parent

    scenario_dir = coc_starter.install_starter(root, "test-camp", "the-white-war")

    for fname in coc_starter.STARTER_SCENARIO_FILES:
        assert (scenario_dir / fname).exists(), f"{fname} 未拷贝"
    # pregen 也拷贝
    assert (scenario_dir / "pregen-investigators.json").exists()


def test_install_starter_writes_campaign_fields(tmp_path):
    root = tmp_path / ".coc"
    sys.path.insert(0, str(SCRIPTS_DIR))
    import coc_state  # noqa: E402
    coc_state.ensure_workspace(root)
    coc_state.create_campaign(root, "test-camp", "Test", era="ww1")

    coc_starter.install_starter(root, "test-camp", "the-white-war")

    campaign = json.loads(
        ((root / "campaigns" / "test-camp" / "campaign.json")).read_text("utf-8")
    )
    assert campaign["active_scenario_id"] == "the-white-war"
    assert campaign["era"] == "ww1"


def test_install_starter_is_idempotent_error(tmp_path):
    """重复 install 同 scenario 应报错而非覆盖。"""
    root = tmp_path / ".coc"
    sys.path.insert(0, str(SCRIPTS_DIR))
    import coc_state  # noqa: E402
    coc_state.ensure_workspace(root)
    coc_state.create_campaign(root, "test-camp", "Test", era="ww1")
    coc_starter.install_starter(root, "test-camp", "the-white-war")

    with pytest.raises((FileExistsError, ValueError)):
        coc_starter.install_starter(root, "test-camp", "the-white-war")


def test_install_staller_unknown_scenario_errors(tmp_path):
    root = tmp_path / ".coc"
    sys.path.insert(0, str(SCRIPTS_DIR))
    import coc_state  # noqa: E402
    coc_state.ensure_workspace(root)
    coc_state.create_campaign(root, "test-camp", "Test", era="ww1")

    with pytest.raises((FileNotFoundError, ValueError)):
        coc_starter.install_starter(root, "test-camp", "nonexistent-scenario")
```

- [ ] **Step 2: 运行测试确认失败**

Run: `PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/test_starter_scenarios.py -q -p no:cacheprovider`
Expected: FAIL — `ModuleNotFoundError: coc_starter`（以及 Task 4-9 文件尚未存在的连锁失败）。

- [ ] **Step 3: 写 `coc_starter.py`**

Create `plugins/coc-keeper/scripts/coc_starter.py`:

```python
#!/usr/bin/env python3
"""Loader for built-in starter scenarios.

Starter scenarios are pre-packaged, play-ready scenarios shipped with the
plugin under `references/starter-scenarios/<id>/`. They let new players
start a game with zero PDF preparation.

`install_starter` copies the seven story-graph JSON files (plus
pregen-investigators.json) into a campaign's `scenario/` directory, which is
the only location the runtime Story Director reads
(`coc_story_director.py:95`). The campaign.json is updated with
active_scenario_id/era.
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

PLUGIN_ROOT = SCRIPT_DIR.parent
STARTER_DIR = PLUGIN_ROOT / "references" / "starter-scenarios"

# The seven story-graph JSON files the Story Director reads (see
# coc_story_director.py:95-183). Pregen-investigators.json is copied
# alongside but is not a director-read file.
STARTER_SCENARIO_FILES = (
    "module-meta.json",
    "story-graph.json",
    "clue-graph.json",
    "npc-agendas.json",
    "threat-fronts.json",
    "pacing-map.json",
    "improvisation-boundaries.json",
)


def list_starter_scenarios() -> list[dict[str, Any]]:
    """Enumerate built-in starter scenarios from their module-meta.json files.

    Returns one dict per starter: scenario_id, title, one_liner,
    structure_type, era, content_flags.
    """
    out: list[dict[str, Any]] = []
    if not STARTER_DIR.is_dir():
        return out
    for child in sorted(STARTER_DIR.iterdir()):
        meta_path = child / "module-meta.json"
        if not meta_path.is_file():
            continue
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        out.append(
            {
                "scenario_id": meta["scenario_id"],
                "title": meta["title"],
                "one_liner": meta.get("one_liner", ""),
                "structure_type": meta["structure_type"],
                "era": meta["era"],
                "content_flags": meta.get("content_flags", []),
            }
        )
    return out


def install_starter(root: Path, campaign_id: str, scenario_id: str) -> Path:
    """Copy a starter scenario into a campaign's scenario/ directory.

    Idempotency: raises FileExistsError if the campaign already has any of
    the seven story-graph files (i.e. a scenario is already bound).
    Raises FileNotFoundError if the starter scenario_id is unknown.
    Returns the scenario directory path.
    """
    src_dir = STARTER_DIR / scenario_id
    if not src_dir.is_dir():
        raise FileNotFoundError(f"unknown starter scenario: {scenario_id}")

    coc_root = _coc_root(root)
    campaign_dir = coc_root / "campaigns" / campaign_id
    if not campaign_dir.is_dir():
        raise FileNotFoundError(f"unknown campaign: {campaign_id}")

    scenario_dir = campaign_dir / "scenario"
    # Idempotency: refuse to clobber an existing scenario.
    for fname in STARTER_SCENARIO_FILES:
        if (scenario_dir / fname).exists():
            raise FileExistsError(
                f"campaign {campaign_id} already has scenario file {fname}; "
                " refusing to overwrite. Remove it first to re-install."
            )

    for fname in STARTER_SCENARIO_FILES:
        shutil.copy2(src_dir / fname, scenario_dir / fname)
    # Pregen investigators (optional, not director-read).
    pregen_src = src_dir / "pregen-investigators.json"
    if pregen_src.is_file():
        shutil.copy2(pregen_src, scenario_dir / "pregen-investigators.json")

    _update_campaign_json(campaign_dir, scenario_id)
    return scenario_dir


def _coc_root(root: Path) -> Path:
    # Mirror coc_state.coc_root: if `root` already ends in .coc, use it;
    # otherwise treat it as the workspace root containing `.coc/`.
    root = Path(root)
    if root.name == ".coc":
        return root
    return root / ".coc"


def _update_campaign_json(campaign_dir: Path, scenario_id: str) -> None:
    campaign_path = campaign_dir / "campaign.json"
    campaign = json.loads(campaign_path.read_text(encoding="utf-8"))
    campaign["active_scenario_id"] = scenario_id
    # Align era with the scenario's module-meta if present.
    meta_path = STARTER_DIR / scenario_id / "module-meta.json"
    if meta_path.is_file():
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        campaign["era"] = meta.get("era", campaign.get("era", "1920s"))
    campaign["updated_at"] = _now_iso()
    campaign_path.write_text(
        (json.dumps(campaign, indent=2, ensure_ascii=False) + "\n").encode("utf-8")
    )


def _now_iso() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="List or install built-in starter scenarios.")
    sub = parser.add_subparsers(dest="cmd", required=True)

    sub.add_parser("list", help="list available starter scenarios")

    inst = sub.add_parser("install", help="install a starter scenario into a campaign")
    inst.add_argument("--campaign", required=True)
    inst.add_argument("--scenario", required=True)
    inst.add_argument("--root", default=".coc", help="path to .coc workspace")

    args = parser.parse_args(argv)

    if args.cmd == "list":
        for s in list_starter_scenarios():
            print(f"{s['scenario_id']}\t{s['title']}\t{s['one_liner']}")
        return 0
    if args.cmd == "install":
        path = install_starter(Path(args.root), args.campaign, args.scenario)
        print(f"installed {args.scenario} -> {path}")
        return 0
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 4: 运行测试**

Run: `PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/test_starter_scenarios.py -q -p no:cacheprovider`
Expected: `test_list_starter_scenarios_returns_white_war` 仍 FAIL（Task 4 的 module-meta.json 还没建），但 `import coc_starter` 成功。其余 install 测试因 module-meta 缺失而 FAIL。这是预期的——Task 4-9 建好 scenario 文件后这些测试会转 PASS。

- [ ] **Step 5: 提交（loader 框架先入库）**

```bash
git add plugins/coc-keeper/scripts/coc_starter.py tests/test_starter_scenarios.py
git commit -m "feat(coc): add coc_starter.py loader for built-in starter scenarios"
```

---

## Task 4: module-meta.json + OGL 合规文件

**Files:**
- Create: `plugins/coc-keeper/references/starter-scenarios/the-white-war/module-meta.json`
- Create: `plugins/coc-keeper/references/starter-scenarios/the-white-war/OGL-LICENSE.txt`
- Create: `plugins/coc-keeper/references/starter-scenarios/the-white-war/README.md`

**法律约束**: module-meta 的 OGL 字段（license/copyright_notice/attribution/author/open_content_note）必须完整准确，§15 COPYRIGHT NOTICE 逐字照抄源 PDF。`one_liner` 面向新人，通俗。

- [ ] **Step 1: 写 `module-meta.json`**

Create `plugins/coc-keeper/references/starter-scenarios/the-white-war/module-meta.json`:

```json
{
  "schema_version": 1,
  "scenario_id": "the-white-war",
  "title": "The White War",
  "one_liner": "1916 年意大利阿尔卑斯前线，一支山地巡逻队调查冰川上失踪的奥军阵地，唤醒了冰封万年的远古存在。开箱即玩，无需剧本 PDF。",
  "structure_type": "linear_acts",
  "era": "ww1",
  "content_flags": ["supernatural_horror", "graphic_violence", "madness", "warfare"],
  "win_condition": "调查员查清冰川异象的来源，在 Polyp Horror 的猎杀中幸存并返回意军防线；理想结局是逼退或消灭实体并查明 White Friday 灾难的因果。",
  "source_pdf": null,
  "source_pdf_pages": null,
  "summary": "An original derivative scenario built on OGC game data from 'The White War' (Paul StJohn Mackintosh, 2023). An Italian Alpini patrol investigates an abandoned Austrian position honeycombing a Marmolada glacier and unwittingly disturbs a primordial entity sealed in the ice since before the last Ice Age.",
  "player_safe_summary": "1916 年 12 月，意大利阿尔卑斯狙击兵团一支前沿巡逻队奉命侦察冰川对面的奥军阵地——那里数夜前传来爆炸与枪声后便归于死寂。穿越风雪鞍部、钻进冰隧道后，他们将发现一支被超自然力量撕碎的奥军驻军，以及一个不应被打开的远古竖井。",
  "keeper_secret_summary": "奥军的爆破误开了封印自上次冰期的远古竖井，释放出半物质的 Polyp Horror（飞螺族残党）。它出于好奇而非纯粹恶意探查人类，但其探查同样致命。无论调查员结局如何，次日（1916-12-13）的 White Friday 雪崩灾难都会发生——因果归属取决于调查员的行动。",
  "license": "OGL-1.0a",
  "author": "Original scenario: Paul StJohn Mackintosh (Cthulhu Reborn Publishing, 2023). Adaptation: chatrpgv4 contributors.",
  "attribution": "Adapted from 'The White War' by Paul StJohn Mackintosh (Cthulhu Reborn Publishing, 2023), published under the Open Gaming License v1.0a. See README.md for the full Section 15 COPYRIGHT NOTICE.",
  "copyright_notice": [
    "Open Game License v. 1.0, © 2000, Wizards of the Coast, Inc.",
    "Legend, © 2011, Mongoose Publishing.",
    "Unearthed Arcana, © 2004, Wizards of the Coast, Inc.",
    "Delta Green: Agent's Handbook, © 2016, Dennis Detwiller, Christopher Gunning, Shane Ivey, and Greg Stolze.",
    "Delta Green: Need to Know, © 2016, Shane Ivey and Bret Kramer.",
    "APOCTHULHU Quickstart, © 2020, Dean Engelhardt, Chad Bowser, Jo Kreil, and Michelle Bernay-Rogers.",
    "APOCTHULHU Core Rules © 2020, Dean Engelhardt, Jo Kreil, Kevin Ross, Jeff Moeller, Chad Bowser, Dave Sokolowski, Christopher Smith Adair, Fred Behrendt, Emily O'Neil, Paul Franzese, and Michelle Bernay-Rogers.",
    "APOCTHULHU System Reference Document v0.666 © 2020, Dean Engelhardt, Jo Kreil, Kevin Ross, Jeff Moeller, Chad Bowser, Dave Sokolowski, Christopher Smith Adair, Fred Behrendt, Emily O'Neil, Paul Franzese, and Michelle Bernay-Rogers.",
    "Cthulhu Eternal System Reference Document v1.0 © 2021, Dean Engelhardt, Jo Kreil, Kevin Ross, Jeff Moeller, Chad Bowser, Dave Sokolowski, Christopher Smith Adair, Fred Behrendt, Emily O'Neil, Paul Franzese, and Michelle Bernay-Rogers.",
    "Cthulhu Eternal – World War I Localization: System Reference Document v1.0 © 2023, Roger Bell_West.",
    "The White War © 2023, Paul StJohn Mackintosh."
  ],
  "open_content_note": "Open Game Content: numeric game data and creature descriptions from source PDF p8-10 (Polyp Horror stats, cold exposure rules, weapon data) — reproduced faithfully in rules-json/the-white-war.json. Product Identity from source (plots, storylines, locations, characters, dialogue, maps) is NOT reproduced; this scenario's narrative, scene names, NPC names, and dialogue are an original derivative work copyright the chatrpgv4 contributors, licensed under the project license."
}
```

- [ ] **Step 2: 写 `OGL-LICENSE.txt`（OGL v1.0a 全文）**

Create `plugins/coc-keeper/references/starter-scenarios/the-white-war/OGL-LICENSE.txt`. 从源 PDF 第 14 页（OGL 全文，§1-§15）逐字照抄完整文本。这是 OGL §10 的强制要求（"You MUST include a copy of this License with every copy of the Open Game Content You Distribute"）。文本来源：源 PDF p14，或 WotC 官方 OGL v1.0a 文本。

- [ ] **Step 3: 写 `README.md`**

Create `plugins/coc-keeper/references/starter-scenarios/the-white-war/README.md`:

```markdown
# The White War — Built-in Starter Scenario

An original derivative scenario for the COC Keeper plugin, adapted (under the
Open Gaming License v1.0a) from **"The White War"** by Paul StJohn Mackintosh,
published by Cthulhu Reborn Publishing in December 2023.

## License: Open Gaming License v1.0a

A full copy of the OGL is in `OGL-LICENSE.txt`.

## COPYRIGHT NOTICE (OGL §15)

```
Open Game License v. 1.0, © 2000, Wizards of the Coast, Inc.
Legend, © 2011, Mongoose Publishing.
Unearthed Arcana, © 2004, Wizards of the Coast, Inc.
Delta Green: Agent's Handbook, © 2016, Dennis Detwiller, Christopher Gunning, Shane Ivey, and Greg Stolze.
Delta Green: Need to Know, © 2016, Shane Ivey and Bret Kramer.
APOCTHULHU Quickstart, © 2020, Dean Engelhardt, Chad Bowser, Jo Kreil, and Michelle Bernay-Rogers.
APOCTHULHU Core Rules © 2020, Dean Engelhardt, Jo Kreil, Kevin Ross, Jeff Moeller, Chad Bowser, Dave Sokolowski, Christopher Smith Adair, Fred Behrendt, Emily O'Neil, Paul Franzese, and Michelle Bernay-Rogers.
APOCTHULHU System Reference Document v0.666 © 2020, Dean Engelhardt, Jo Kreil, Kevin Ross, Jeff Moeller, Chad Bowser, Dave Sokolowski, Christopher Smith Adair, Fred Behrendt, Emily O'Neil, Paul Franzese, and Michelle Bernay-Rogers.
Cthulhu Eternal System Reference Document v1.0 © 2021, Dean Engelhardt, Jo Kreil, Kevin Ross, Jeff Moeller, Chad Bowser, Dave Sokolowski, Christopher Smith Adair, Fred Behrendt, Emily O'Neil, Paul Franzese, and Michelle Bernay-Rogers.
Cthulhu Eternal – World War I Localization: System Reference Document v1.0 © 2023, Roger Bell_West.
The White War © 2023, Paul StJohn Mackintosh.
```

## Open Game Content vs Product Identity

Per the source PDF's OGL declaration:

- **OPEN GAME CONTENT** (free to redistribute under OGL): all numeric game
  data and the creature descriptions on source PDF pages 8–10. This package
  reproduces that OGC faithfully in `../../../../rules-json/the-white-war.json`
  (Polyp Horror stat block, cold-exposure rules, weapon data).
- **PRODUCT IDENTITY** (NOT redistributed from the source): the source's
  trademarks, trade dress, maps, artwork, dialogue, plots, storylines,
  locations, and characters.

The scenario narrative in this directory (scene names, locations, NPC names,
dialogue) is an **original derivative work** by the chatrpgv4 contributors,
built on the OGC game-mechanics premise of a primordial entity released from
an ice-sealed shaft. It does not reproduce any Product Identity from the
source. The narrative is licensed under the project's license (Apache-2.0).

## Playing

This scenario is installed via the COC onboarding prompt when a new campaign
is created, or by:

```bash
python3 plugins/coc-keeper/scripts/coc_starter.py install \
  --campaign <campaign-id> --scenario the-white-war
```

Then continue play in COC mode. No PDF required.
```

- [ ] **Step 4: 验证 module-meta JSON 合法**

Run: `python3 -c "import json; json.load(open('plugins/coc-keeper/references/starter-scenarios/the-white-war/module-meta.json'))"`
Expected: 无输出（合法）。

- [ ] **Step 5: 提交**

```bash
git add plugins/coc-keeper/references/starter-scenarios/the-white-war/module-meta.json plugins/coc-keeper/references/starter-scenarios/the-white-war/OGL-LICENSE.txt plugins/coc-keeper/references/starter-scenarios/the-white-war/README.md
git commit -m "feat(coc): add The White War module-meta + OGL license and attribution files"
```

---

## Task 5: story-graph.json（11 个 scene）

**Files:**
- Create: `plugins/coc-keeper/references/starter-scenarios/the-white-war/story-graph.json`

**法律约束**: 所有 scene 的 `dramatic_question` / `pressure_moves` / `tone` / `allowed_improvisation` 文本**原创**，不照搬源 PDF 叙述句。scene_id 原创。`dramatic_question` 每条非空（编译器硬断言）。

**Schema 约束** (story-graph-schema.md:50-87): 每个 scene 必须有 `scene_id`/`scene_type`/`dramatic_question`/`entry_conditions`/`exit_conditions`/`available_clues`/`npc_ids`/`pressure_moves`/`tone`/`allowed_improvisation`。`scene_type` ∈ investigation/social/combat/exploration/resolution。

- [ ] **Step 1: 写 `story-graph.json`**

Create `plugins/coc-keeper/references/starter-scenarios/the-white-war/story-graph.json`. 11 个 scene，按 spec §5 设计。所有描述性文本原创。下面给出完整内容（scene_id 列表: mission-briefing / crossing-saddle / austrian-positions / glacier-tunnels / blast-chamber / whistle-approaches / blizzard-withdrawal / via-ferrata-climb / shelter-night-siege / dawn-counterstroke / aftermath-white-friday）:

```json
{
  "scenes": [
    {
      "scene_id": "mission-briefing",
      "scene_type": "social",
      "dramatic_question": "Will the patrol accept a reconnaissance mission whose true nature is being kept from them?",
      "entry_conditions": ["campaign_active", "no_prior_scene"],
      "exit_conditions": ["orders_received", "patrol_armed_and_briefed"],
      "available_clues": ["clue-briefing-mention-strange-sounds"],
      "npc_ids": ["npc-company-commander"],
      "pressure_moves": [
        "commander强调上级只关心情报，不关心巡逻队的死活",
        "军士提醒雪况恶劣，补给只能靠巡逻队自己背"
      ],
      "tone": ["cold", "bureaucratic", "ominous"],
      "allowed_improvisation": ["invent other ranks present at briefing", "never_invent details beyond 'strange sounds and explosions'"]
    },
    {
      "scene_id": "crossing-saddle",
      "scene_type": "exploration",
      "dramatic_question": "Can the patrol cross the killing ground without being shot, frozen, or worse?",
      "entry_conditions": ["orders_received"],
      "exit_conditions": ["reached_austrian_loopholes"],
      "available_clues": ["clue-saddle-eerily-quiet"],
      "npc_ids": [],
      "pressure_moves": [
        "any gunshot in the open is Terror-Inducing",
        "every 5 min in the open costs a Fatigue point",
        "风雪让能见度降到几米"
      ],
      "tone": ["whiteout", "wind", "tense"],
      "allowed_improvisation": ["invent minor obstacles (snow bridges, ice crust)", "never_invent enemy contact on the saddle"]
    },
    {
      "scene_id": "austrian-positions",
      "scene_type": "investigation",
      "dramatic_question": "What happened to the Austrians who held this position?",
      "entry_conditions": ["reached_austrian_loopholes"],
      "exit_conditions": ["entered_glacier_tunnel_mouth"],
      "available_clues": ["clue-hasty-abandonment", "clue-guns-turned-inward"],
      "npc_ids": ["npc-surprise-austrian-survivor"],
      "pressure_moves": [
        "a crazed survivor lunges with a bayonet from a hiding spot (DEX 12, 10 HP, bayonet 1D8)",
        "Scavenge test uncovers supplies at Uncommon scarcity"
      ],
      "tone": ["abandoned", "blue-lit", "creaking-ice"],
      "allowed_improvisation": ["invent discarded personal effects", "never_invent written Austrian orders in a readable language"]
    },
    {
      "scene_id": "glacier-tunnels",
      "scene_type": "exploration",
      "dramatic_question": "How deep does this honeycomb go, and what drove the Austrians out?",
      "entry_conditions": ["entered_glacier_tunnel_mouth"],
      "exit_conditions": ["reached_blast_chamber"],
      "available_clues": ["clue-drag-marks-deeper-in", "clue-supplies-dropped-in-retreat"],
      "npc_ids": [],
      "pressure_moves": [
        "successive Stealth tests; loudest sound is meltwater drip",
        "interior 0C, cold temporarily held at bay"
      ],
      "tone": ["claustrophobic", "echoing", "unnaturally-still"],
      "allowed_improvisation": ["invent tunnel junctions and dead ends", "never_invent a second way out that bypasses the blast chamber"]
    },
    {
      "scene_id": "blast-chamber",
      "scene_type": "investigation",
      "dramatic_question": "What did the Austrians' blasting unearth beneath the ice?",
      "entry_conditions": ["reached_blast_chamber"],
      "exit_conditions": ["noted_the_shaft", "heard_the_whistle"],
      "available_clues": ["clue-massacred-austrians", "clue-superhuman-strength-wounds", "clue-basalt-shaft-no-echo", "clue-drag-marks-into-shaft"],
      "npc_ids": [],
      "pressure_moves": [
        "SAN 0/1 [violence] at the carnage; 0/1 [unnatural] on realizing the wounds",
        "Alertness test detects a faint ominous whistling from deeper in",
        "ecrasite demolition cases still stacked by the far tunnels"
      ],
      "tone": ["slaughter", "ancient", "dread"],
      "allowed_improvisation": ["invent specifics of the Austrian dead", "never_invent the shaft's full depth or what lies at the bottom"]
    },
    {
      "scene_id": "whistle-approaches",
      "scene_type": "exploration",
      "dramatic_question": "Do the investigators obey orders and withdraw, or push deeper toward the sound?",
      "entry_conditions": ["noted_the_shaft", "heard_the_whistle"],
      "exit_conditions": ["began_withdrawal", "chose_to_push_deeper"],
      "available_clues": ["clue-whistle-source-is-animate"],
      "npc_ids": ["npc-tomasso-like-survivor"],
      "pressure_moves": [
        "the whistling grows louder and nearer, seemingly from everywhere",
        "stumbling across a survivor curled in a side cul-de-sac, hands over ears"
      ],
      "tone": ["relentless", "closing-in", "panicked"],
      "allowed_improvisation": ["invent the survivor's exact words (must be original dialogue)", "never_invent that the source is visible yet"]
    },
    {
      "scene_id": "blizzard-withdrawal",
      "scene_type": "combat",
      "dramatic_question": "Can the patrol outrun an unnatural gale across the open saddle?",
      "entry_conditions": ["began_withdrawal"],
      "exit_conditions": ["reached_via_ferrata_base", "re-entered_glacier"],
      "available_clues": ["clue-gale-coincides-with-pursuer"],
      "npc_ids": [],
      "pressure_moves": [
        "crossing now takes 10 min, Athletics every 5 min at -40%, 1D8 Fatigue per 5 min",
        "the pursuer picks off stragglers one by one",
        "1D6/1D12 SAN for those who see it resolve into a monstrous form"
      ],
      "tone": ["shrieking-wind", "whiteout", "hunted"],
      "allowed_improvisation": ["invent near-misses and falls into snow", "never_invent that the pursuer is harmed by the gale itself"]
    },
    {
      "scene_id": "via-ferrata-climb",
      "scene_type": "exploration",
      "dramatic_question": "Can the exhausted patrol scale the rock chimney to safety before the snow overhang gives way?",
      "entry_conditions": ["reached_via_ferrata_base"],
      "exit_conditions": ["reached_shelter"],
      "available_clues": [],
      "npc_ids": [],
      "pressure_moves": [
        "three Athletics/Survival(Alpine) tests over 60m; failure strands for 5 min; fumble = fall (60% Lethality)",
        "STR x5 to unstick a stranded climber",
        "each 30 min of sunset: avalanche on roll 00 (or 96-00 if a shot/explosion occurs)"
      ],
      "tone": ["vertical", "exposed", "failing-light"],
      "allowed_improvisation": ["invent handholds and loose rock", "never_invent an alternate route up that avoids the chimney"]
    },
    {
      "scene_id": "shelter-night-siege",
      "scene_type": "combat",
      "dramatic_question": "Can the patrol hold the shelter through the night against something that wants to examine them?",
      "entry_conditions": ["reached_shelter"],
      "exit_conditions": ["dawn_breaks", "patrol_wiped_out"],
      "available_clues": ["clue-entity-is-curious-not-hostile", "clue-entity-fears-daylight"],
      "npc_ids": ["npc-tomasso-like-survivor"],
      "pressure_moves": [
        "Survival(Alpine) to make shelter storm-tight (else partially-prepared cold rules)",
        "invisible echolocation vibrations through walls: 0/1D6 SAN [unnatural]",
        "1D3 attempts per night to wrench the door/windows open: summed STR opposed vs entity STR 100",
        "snatched victim is probed (1/1D8 SAN [unnatural]) then dropped onto the glacier"
      ],
      "tone": ["besieged", "queasy", "long-night"],
      "allowed_improvisation": ["invent the survivor's folkloric explanation (original dialogue)", "never_invent a known weakness for the entity"]
    },
    {
      "scene_id": "dawn-counterstroke",
      "scene_type": "combat",
      "dramatic_question": "At dawn, with the entity weakened by daylight, can the patrol seize a way out?",
      "entry_conditions": ["dawn_breaks"],
      "exit_conditions": ["escaped_to_italian_lines", "entity_destroyed_or_routed", "patrol_wiped_out"],
      "available_clues": ["clue-daylight-weakens-entity", "clue-avalanche-lethal-to-entity"],
      "npc_ids": [],
      "pressure_moves": [
        "option leap-into-snow: Athletics (min 6 dmg) else 6% Lethality, CON x5 vs stun",
        "option avalanche: each shot 1%/grenade 5% to trigger, 10D6 dmg, STR x5 to avoid being swept; entity at <=20 HP retreats",
        "option signal fire support: INT x5 to call + INT x5 to adjust, Heavy Weapons 40%+20% size; but Italian crews must make their own SAN roll",
        "option rearm from Austrian positions: Stealth vs entity Alertness; assemble 80% Lethality charge, Demolitions to detonate",
        "entity at daylight: -20% all skills, stays in shadow, wind needs 1 round to reactivate"
      ],
      "tone": ["dawn-light", "calculated-risk", "climactic"],
      "allowed_improvisation": ["invent the specific moment of the breakout", "never_invent a fifth escape option"]
    },
    {
      "scene_id": "aftermath-white-friday",
      "scene_type": "resolution",
      "dramatic_question": "Did the patrol's choices save them — or doom ten thousand men to the White Friday avalanches?",
      "entry_conditions": ["escaped_to_italian_lines"],
      "exit_conditions": ["campaign_concluded"],
      "available_clues": ["clue-white-friday-causality"],
      "npc_ids": ["npc-company-commander"],
      "pressure_moves": [
        "forced entity retreat: +1D6 SAN; mission complete: +1D3 SAN",
        "if entity survived and was left on the glacier: White Friday buries it, 0/1D6 SAN [helplessness] for guilt",
        "if the patrol triggered the avalanche themselves: blamed for the disaster, reduce 1D2 Bonds by 3",
        "if the entity was killed: no personal blame, though the disaster still comes",
        "telling the truth to high command: nobody believes them, they're separated and transferred; suppressing truth: +1D3 SAN"
      ],
      "tone": ["uneasy", "haunted", "historical"],
      "allowed_improvisation": ["invent epilogue details for survivors", "never_invent that the disaster was averted"]
    }
  ]
}
```

- [ ] **Step 2: 验证 JSON 合法 + dramatic_question 非空**

Run:
```bash
python3 -c "
import json
g = json.load(open('plugins/coc-keeper/references/starter-scenarios/the-white-war/story-graph.json'))
assert len(g['scenes']) == 11
for s in g['scenes']:
    assert s['dramatic_question'], f'{s[\"scene_id\"]} 缺 dramatic_question'
    assert s['scene_type'] in ('investigation','social','combat','exploration','resolution')
print('OK 11 scenes')
"
```
Expected: `OK 11 scenes`。

- [ ] **Step 3: 提交**

```bash
git add plugins/coc-keeper/references/starter-scenarios/the-white-war/story-graph.json
git commit -m "feat(coc): author original story-graph for The White War (11 scenes)"
```

---

## Task 6: clue-graph.json

**Files:**
- Create: `plugins/coc-keeper/references/starter-scenarios/the-white-war/clue-graph.json`

**Schema 约束** (story-graph-schema.md:91-177): 顶层 `conclusions[]`，每个含 `conclusion_id`/`importance`(critical|major|minor)/`minimum_routes`(critical 默认 3)/`clues[]`/`fallback_policy`。每条 clue 含 `clue_id`/`delivery`/`visibility`(player-safe|keeper-only)，可选 `delivery_kind`/`skill`/`difficulty`/`player_safe_summary`。critical 的 clues.length ≥ minimum_routes（编译器硬断言）。clue_id 在 story-graph.available_clues 中被引用。

- [ ] **Step 1: 写 `clue-graph.json`**

Create `plugins/coc-keeper/references/starter-scenarios/the-white-war/clue-graph.json`. ≥2 个 critical（各 ≥3 routes）+ 2 major + 3 minor。clue_id 必须覆盖 story-graph 的所有 available_clues。visibility 严格区分 player-safe / keeper-only。文本原创:

```json
{
  "conclusions": [
    {
      "conclusion_id": "shaft-is-ancient-seal",
      "importance": "critical",
      "minimum_routes": 3,
      "description": "The basalt shaft in the blast chamber is a seal predating recorded history, stoppered by ice since before the last Ice Age.",
      "fallback_policy": "If all clue routes missed, the shelter survivor's folklore (Keeper may prompt an INT x5) supplies the 'sealed since ancient times' detail.",
      "clues": [
        {
          "clue_id": "clue-basalt-shaft-no-echo",
          "delivery": "examining the shaft mouth",
          "delivery_kind": "environmental",
          "visibility": "player-safe",
          "skill": "Science (Geology)",
          "difficulty": "regular",
          "player_safe_summary": "The shaft's inner walls are lined with black basalt, not native to these mountains; anything dropped into it produces no echo at all."
        },
        {
          "clue_id": "clue-drag-marks-into-shaft",
          "delivery": "tracking the blood trail",
          "delivery_kind": "obvious",
          "visibility": "player-safe",
          "player_safe_summary": "Drag marks and a blood trail lead from the carnage straight to the shaft's mouth — something pulled bodies down into it."
        },
        {
          "clue_id": "clue-ice-seal-blasted-away",
          "delivery": "examining the blast marks",
          "delivery_kind": "environmental",
          "visibility": "player-safe",
          "skill": "Demolitions",
          "difficulty": "regular",
          "player_safe_summary": "The Austrians were widening the chamber when they blew away a thick layer of ice capping a hole in the rock floor — the shaft wasn't dug, it was unsealed."
        },
        {
          "clue_id": "clue-survivor-folklore-of-seal",
          "delivery": "the shelter survivor's tale",
          "delivery_kind": "npc_dialogue",
          "visibility": "player-safe",
          "player_safe_summary": "A local folk tradition holds that something ancient sleeps beneath the highest glaciers, sealed since before the long winter that covered the world."
        }
      ]
    },
    {
      "conclusion_id": "austrians-triggered-release",
      "importance": "critical",
      "minimum_routes": 3,
      "description": "The Austrian demolition work blew open the ice seal and unwittingly released the entity from the shaft.",
      "fallback_policy": "If routes missed, the timing (explosions nights ago, then silence) is stated plainly by the briefing officer on recall.",
      "clues": [
        {
          "clue_id": "clue-hasty-abandonment",
          "delivery": "reading the Austrian positions",
          "delivery_kind": "skill_check",
          "skill": "Spot Hidden",
          "difficulty": "regular",
          "visibility": "player-safe",
          "player_safe_summary": "The machine-gun posts were abandoned in a hurry — loaded guns, drifted-over muzzles, wandering tracks leading back into the tunnels, none of it an orderly withdrawal."
        },
        {
          "clue_id": "clue-guns-turned-inward",
          "delivery": "inspecting the emplacements",
          "delivery_kind": "obvious",
          "visibility": "player-safe",
          "player_safe_summary": "One or two Schwarzlose guns were wrenched around to fire back into the Austrian positions — they weren't fighting the Italians."
        },
        {
          "clue_id": "clue-massacred-austrians",
          "delivery": "entering the blast chamber",
          "delivery_kind": "environmental",
          "visibility": "player-safe",
          "player_safe_summary": "The blast chamber is plastered with the torn bodies of Austrians, weapons still clutched, spent casings underfoot — they fought back against whatever came."
        },
        {
          "clue_id": "clue-superhuman-strength-wounds",
          "delivery": "examining the dead",
          "delivery_kind": "skill_check",
          "skill": "First Aid or Medicine",
          "difficulty": "regular",
          "visibility": "player-safe",
          "player_safe_summary": "The wounds were inflicted by superhuman strength and huge serrated edges — no blast or bullet did this."
        }
      ]
    },
    {
      "conclusion_id": "entity-from-flying-polyps",
      "importance": "major",
      "minimum_routes": 2,
      "description": "The entity is a Polyp Horror, one of the subterranean adversaries of the prehistoric Great Race, lingering underground for geological ages.",
      "fallback_policy": "If missed, this is purely flavor; no mechanic depends on the investigators naming it.",
      "clues": [
        {
          "clue_id": "clue-entity-is-curious-not-hostile",
          "delivery": "surviving the shelter siege",
          "delivery_kind": "environmental",
          "visibility": "keeper-only",
          "player_safe_summary": "The thing probes and discards victims rather than simply killing — it is examining humanity, not hunting for food."
        },
        {
          "clue_id": "clue-whistle-source-is-animate",
          "delivery": "fleeing the tunnels",
          "delivery_kind": "environmental",
          "visibility": "player-safe",
          "player_safe_summary": "The whistling moves. It approaches from the direction of the shaft and follows the patrol — it isn't wind."
        }
      ]
    },
    {
      "conclusion_id": "entity-fears-daylight",
      "importance": "major",
      "minimum_routes": 2,
      "description": "The entity avoids direct daylight, retreating to shadow at dawn — the key to any counterstroke.",
      "fallback_policy": "If missed, dawn breaking in scene shelter-night-siege makes the entity's withdrawal behavior obvious regardless.",
      "clues": [
        {
          "clue_id": "clue-entity-fears-daylight",
          "delivery": "observing the entity at dawn",
          "delivery_kind": "obvious",
          "visibility": "player-safe",
          "player_safe_summary": "At first light the entity withdraws to the shadows at the mountain's base, holding its whirl-of-snow form and avoiding direct sun."
        },
        {
          "clue_id": "clue-daylight-weakens-entity",
          "delivery": "engaging the entity in daylight",
          "delivery_kind": "skill_check",
          "skill": "INT x5",
          "difficulty": "regular",
          "visibility": "player-safe",
          "player_safe_summary": "In daylight the entity's reactions are sluggish — it suffers a clear penalty and needs a moment's preparation to summon its wind again."
        }
      ]
    },
    {
      "conclusion_id": "entity-retreats-when-wounded",
      "importance": "minor",
      "minimum_routes": 1,
      "description": "Brought to 20 HP or below, the entity abandons its curiosity and retreats down the shaft to heal.",
      "fallback_policy": "Keeper may state this plainly if the patrol has damaged it significantly.",
      "clues": [
        {
          "clue_id": "clue-entity-retreats-low-hp",
          "delivery": "observing the entity's behavior under fire",
          "delivery_kind": "environmental",
          "visibility": "keeper-only",
          "player_safe_summary": "Once badly hurt, the entity decides further study isn't worth the risk and flees for the shaft, killing only those in its way."
        }
      ]
    },
    {
      "conclusion_id": "avalanche-is-lethal-to-entity",
      "importance": "minor",
      "minimum_routes": 1,
      "description": "A triggered avalanche's mass impact can wound the entity where weapons cannot — it is semi-material, not immune to physics.",
      "fallback_policy": "If missed, the heavily-loaded snow overhang above the shelter is an obvious environmental feature the Keeper can draw attention to.",
      "clues": [
        {
          "clue_id": "clue-avalanche-lethal-to-entity",
          "delivery": "noticing the snow overhang above the shelter",
          "delivery_kind": "skill_check",
          "skill": "Spot Hidden",
          "difficulty": "regular",
          "visibility": "player-safe",
          "player_safe_summary": "A heavy overhang of snow has built up on the summit ridge above the shelter — plainly visible and plainly unstable, a grave avalanche risk."
        }
      ]
    },
    {
      "conclusion_id": "white-friday-causality",
      "importance": "minor",
      "minimum_routes": 1,
      "description": "Whatever the patrol does, the next day's catastrophic White Friday avalanches will come — but who is blamed depends on their choices.",
      "fallback_policy": "The disaster is historical and inevitable; the conclusion is resolved in the aftermath scene regardless of clue discovery.",
      "clues": [
        {
          "clue_id": "clue-white-friday-causality",
          "delivery": "surviving to hear the news",
          "delivery_kind": "environmental",
          "visibility": "keeper-only",
          "player_safe_summary": "On 13 December 1916 the White Friday disaster kills some 10,000 on both sides. If the patrol left the entity alive, the glacier is buried regardless; if they triggered an avalanche themselves, they shoulder the blame; only killing the entity frees them of it."
        }
      ]
    }
  ]
}
```

- [ ] **Step 2: 校验 clue_id 覆盖 story-graph 的 available_clues**

Run:
```bash
python3 -c "
import json
g = json.load(open('plugins/coc-keeper/references/starter-scenarios/the-white-war/story-graph.json'))
cg = json.load(open('plugins/coc-keeper/references/starter-scenarios/the-white-war/clue-graph.json'))
all_clue_ids = set()
for c in cg['conclusions']:
    for cl in c['clues']:
        all_clue_ids.add(cl['clue_id'])
referenced = set()
for s in g['scenes']:
    for cid in s['available_clues']:
        referenced.add(cid)
missing = referenced - all_clue_ids
assert not missing, f'story-graph 引用了不存在的 clue_id: {missing}'
# critical conclusions have enough routes
for c in cg['conclusions']:
    if c['importance'] == 'critical':
        assert len(c['clues']) >= c['minimum_routes'], f\"{c['conclusion_id']} routes 不足\"
print('OK clue-graph consistent')
"
```
Expected: `OK clue-graph consistent`。

- [ ] **Step 3: 提交**

```bash
git add plugins/coc-keeper/references/starter-scenarios/the-white-war/clue-graph.json
git commit -m "feat(coc): author clue-graph for The White War (2 critical, 2 major, 3 minor)"
```

---

## Task 7: npc-agendas.json

**Files:**
- Create: `plugins/coc-keeper/references/starter-scenarios/the-white-war/npc-agendas.json`

**Schema 约束** (story-graph-schema.md:192-221): 每个 NPC 含 `npc_id`/`agenda`(非空,硬断言)/`fear`/`secret`/`voice`/`relationship_to_investigators`/`name`/`keeper_note`。npc_id 必须覆盖 story-graph 的所有 npc_ids。**法律约束**: 姓名原创（不照搬源 PDF 的 Tomasso Cecchini 等 PI 姓名），agenda/voice/secret 文本原创。

- [ ] **Step 1: 写 `npc-agendas.json`**

Create `plugins/coc-keeper/references/starter-scenarios/the-white-war/npc-agendas.json`. 覆盖 story-graph 引用的 npc_id: npc-company-commander, npc-surprise-austrian-survivor, npc-tomasso-like-survivor。姓名全部原创:

```json
{
  "npcs": [
    {
      "npc_id": "npc-company-commander",
      "name": "Tenente Cardone",
      "agenda": "Get a patrol to confirm whether the Austrian positions are truly abandoned so High Command can decide to attack or hold — without spending more men than the intelligence is worth.",
      "fear": "Being held responsible for sending men into an obvious trap, or for failing to act on a real opportunity.",
      "secret": "He has been ordered to treat the patrol as expendable; the reconnaissance matters more to the battalion than any single squad.",
      "voice": "Curt, military, hides urgency behind procedure. Speaks in short declarative orders.",
      "relationship_to_investigators": "superior_officer",
      "keeper_note": "Cardone knows only what briefing said: strange sounds and explosions, then silence. He has no idea anything supernatural is involved and would not believe it."
    },
    {
      "npc_id": "npc-surprise-austrian-survivor",
      "name": "the crazed Austrian",
      "agenda": "Lash out at anything that moves; he is too far gone to distinguish friend from the thing that slaughtered his squad.",
      "fear": "The thing in the tunnels — he has seen what it does.",
      "secret": "He alone escaped the initial slaughter by hiding, and his mind broke watching his comrades torn apart.",
      "voice": "Animal, wordless except for a single terrified moaned phrase meaning 'the horror' in his own language.",
      "relationship_to_investigators": "adversary",
      "keeper_note": "DEX 12, 10 HP, bayonet (Fighting 40%, 1D8). Attacks with Surprise. If subdued and calmed, can only repeat one phrase about 'the horror' — gives nothing actionable."
    },
    {
      "npc_id": "npc-tomasso-like-survivor",
      "name": "the old mountain man",
      "agenda": "Survive. Get out of the tunnels alive and warn the soldiers to run before 'the whistler' comes for them too.",
      "fear": "The whistler; the mountains at night; being left behind.",
      "secret": "He is one of the civilian prisoners the Austrians conscripted to dig their fortifications. He knows the whistler only as a folk demon, not its true nature.",
      "voice": "Old, regional dialect, switches between lucid warning and frantic prayer. Names the thing by a local folk word for 'the whistler.'",
      "relationship_to_investigators": "victim",
      "keeper_note": "STR 12 CON 09 DEX 11 INT 12 POW 13 CHA 09, HP 11, SAN 45. Makeshift club (Fighting 50%, 1D6). Knows folklore: the whistler is a mountain demon that calls the winds and takes travelers who linger too high at night; he knows of no weakness except a vague aversion to daylight."
    }
  ]
}
```

- [ ] **Step 2: 校验 npc_id 覆盖**

Run:
```bash
python3 -c "
import json
g = json.load(open('plugins/coc-keeper/references/starter-scenarios/the-white-war/story-graph.json'))
np = json.load(open('plugins/coc-keeper/references/starter-scenarios/the-white-war/npc-agendas.json'))
ids = {n['npc_id'] for n in np['npcs']}
referenced = set()
for s in g['scenes']:
    for nid in s['npc_ids']:
        referenced.add(nid)
missing = referenced - ids
assert not missing, f'story-graph 引用了不存在的 npc_id: {missing}'
for n in np['npcs']:
    assert n['agenda'], f\"{n['npc_id']} agenda 为空\"
print('OK npc-agendas consistent')
"
```
Expected: `OK npc-agendas consistent`。

- [ ] **Step 3: 提交**

```bash
git add plugins/coc-keeper/references/starter-scenarios/the-white-war/npc-agendas.json
git commit -m "feat(coc): author npc-agendas for The White War (original NPC names, OGC stats)"
```

---

## Task 8: threat-fronts.json

**Files:**
- Create: `plugins/coc-keeper/references/starter-scenarios/the-white-war/threat-fronts.json`

**Schema 约束** (story-graph-schema.md:225-266): 顶层 `fronts[]`，每个含 `front_id`/`scope`(scenario|scene)/`scene_ref`(scope=scene时)/`dangers[]`(每个含 id/impulse/moves)/`clocks[]`(每个含 clock_id/segments/on_tick_visible/on_full)。

- [ ] **Step 1: 写 `threat-fronts.json`**

Create `plugins/coc-keeper/references/starter-scenarios/the-white-war/threat-fronts.json`:

```json
{
  "fronts": [
    {
      "front_id": "polyp-horror-pursuit",
      "scope": "scenario",
      "description": "The released Polyp Horror, curious and lethal, pursues the patrol through the glacier and besieges their refuge.",
      "dangers": [
        {
          "id": "the-whistler",
          "impulse": "to examine each human individually by seizing, probing, and discarding them",
          "moves": [
            "wind blast to whirl a target into the air (Athletics to resist, environmental damage on impact)",
            "tentacle slash (Fighting 60%, Lethality 50%, knock down, ignores armor)",
            "tear apart any human caught in the glacier tunnels",
            "retreat to the shaft when reduced to 20 HP or below"
          ]
        },
        {
          "id": "the-gale",
          "impulse": "to cut off escape across the open saddle",
          "moves": [
            "raise a shrieking gale across the col: 10 min to cross, Athletics -40% per 5 min, 1D8 Fatigue per 5 min",
            "reactivate the wind in daylight after 1 round of preparation"
          ]
        }
      ],
      "clocks": [
        {
          "clock_id": "siege-door-breach",
          "segments": 4,
          "on_tick_visible": ["the door groans and shifts", "frost cracks around the frame", "a gap widens at the lintel"],
          "on_full": "the door is wrenched open; a targeted investigator is snatched out unless they Dodge"
        },
        {
          "clock_id": "entity-curiosity-exhausted",
          "segments": 6,
          "on_tick_visible": ["the whistling circles the shelter", "vibrations pass through the walls", "a window shutter splinters"],
          "on_full": "dawn breaks; the entity withdraws to shadow, ending the siege and opening the dawn-counterstroke scene"
        }
      ]
    },
    {
      "front_id": "avalanche-risk",
      "scope": "scenario",
      "description": "The unprecedented snowfall has built a deadly overhang above the patrol's only refuge; the uneven thaw of sunset makes it increasingly unstable.",
      "dangers": [
        {
          "id": "the-overhang",
          "impulse": "to release the mountainside under the right trigger",
          "moves": [
            "at sunset, each 30-min block: avalanche on percentile 00",
            "any shot or explosion: avalanche on 96-00",
            "if unleashed: 10D6 damage to all in its path; STR x5 to avoid being swept"
          ]
        }
      ],
      "clocks": []
    },
    {
      "front_id": "cold-and-exposure",
      "scope": "scenario",
      "description": "The -30C mountain and the patrol's finite stamina are a constant adversary independent of the entity.",
      "dangers": [
        {
          "id": "the-cold",
          "impulse": "to grind down anyone caught in the open",
          "moves": [
            "outdoor exposure: 1D8 HP per 5 min, CON x5 vs Exhaustion on extreme effort, frostbite on fumble",
            "every 5 min of outdoor effort costs a Fatigue point",
            "shelter failure (failed Survival roll) reverts the patrol to partially-prepared cold rules"
          ]
        }
      ],
      "clocks": []
    }
  ]
}
```

- [ ] **Step 2: 校验 JSON 合法**

Run: `python3 -c "import json; d=json.load(open('plugins/coc-keeper/references/starter-scenarios/the-white-war/threat-fronts.json')); assert len(d['fronts'])==3; print('OK')"`
Expected: `OK`。

- [ ] **Step 3: 提交**

```bash
git add plugins/coc-keeper/references/starter-scenarios/the-white-war/threat-fronts.json
git commit -m "feat(coc): author threat-fronts for The White War (pursuit, avalanche, cold)"
```

---

## Task 9: pacing-map.json + improvisation-boundaries.json

**Files:**
- Create: `plugins/coc-keeper/references/starter-scenarios/the-white-war/pacing-map.json`
- Create: `plugins/coc-keeper/references/starter-scenarios/the-white-war/improvisation-boundaries.json`

**Schema 约束**:
- pacing-map (story-graph-schema.md:270-292): `pacing_curve[]`，每个含 `scene_id`/`tension_target`(low|medium|high|climax)/`horror_stage`(ordinary|wrongness|pattern|revelation，单调递进硬断言: 回归超 1 档报 error)。覆盖所有 11 个 scene_id。
- improvisation-boundaries (story-graph-schema.md:296-314): `invent_allowed[]`/`never_invent[]`/`keeper_secrets[]`。keeper_secrets 字符串不得与 clue-graph 里 visibility=player-safe 的 clue_id 撞名（硬断言 coc_scenario_compile.py:66-73）。用 `id: 描述` 格式最安全。

- [ ] **Step 1: 写 `pacing-map.json`**

Create `plugins/coc-keeper/references/starter-scenarios/the-white-war/pacing-map.json`. horror_stage 序列单调递进: ordinary(2) → wrongness(2) → pattern(2) → revelation(5), tension 对应递增:

```json
{
  "pacing_curve": [
    {"scene_id": "mission-briefing", "tension_target": "low", "horror_stage": "ordinary", "note": "Routine orders; the wrongness is only a rumor the patrol hasn't met."},
    {"scene_id": "crossing-saddle", "tension_target": "low", "horror_stage": "ordinary", "note": "Standard wartime peril; nothing unnatural yet."},
    {"scene_id": "austrian-positions", "tension_target": "medium", "horror_stage": "wrongness", "note": "The abandonment is wrong; guns turned inward signal something is off."},
    {"scene_id": "glacier-tunnels", "tension_target": "medium", "horror_stage": "wrongness", "note": "Signs of panicked retreat deepen the unease."},
    {"scene_id": "blast-chamber", "tension_target": "high", "horror_stage": "pattern", "note": "The massacre and the shaft crystallize the threat."},
    {"scene_id": "whistle-approaches", "tension_target": "high", "horror_stage": "pattern", "note": "The sound closing in confirms the threat is animate."},
    {"scene_id": "blizzard-withdrawal", "tension_target": "climax", "horror_stage": "revelation", "note": "Full flight under unnatural pursuit."},
    {"scene_id": "via-ferrata-climb", "tension_target": "high", "horror_stage": "revelation", "note": "Desperate physical escape; tension held below the pursuit climax."},
    {"scene_id": "shelter-night-siege", "tension_target": "climax", "horror_stage": "revelation", "note": "Sustained siege; the entity's nature is laid bare."},
    {"scene_id": "dawn-counterstroke", "tension_target": "climax", "horror_stage": "revelation", "note": "Decisive action; survival hinges on the chosen option."},
    {"scene_id": "aftermath-white-friday", "tension_target": "low", "horror_stage": "revelation", "note": "Tension releases but the horror stage holds — the disaster is revealed, not resolved."}
  ]
}
```

- [ ] **Step 2: 写 `improvisation-boundaries.json`**

Create `plugins/coc-keeper/references/starter-scenarios/the-white-war/improvisation-boundaries.json`. keeper_secrets 用 `id: 描述` 格式（id 不与 player-safe clue_id 撞名——player-safe clue_id 都以 `clue-` 开头，所以 keeper secret id 用 `secret-` 前缀）:

```json
{
  "invent_allowed": [
    "personal details of the massacred Austrian soldiers (names, effects, last moments)",
    "the exact layout of tunnel junctions and dead ends within the glacier",
    "original dialogue for the survivor NPC, in keeping with his regional dialect and terror",
    "epilogue fates for surviving investigators after they return to the lines",
    "minor environmental hazards on the saddle and the climb (snow bridges, loose rock, ice crust)"
  ],
  "never_invent": [
    "a way to destroy the Polyp Horror with ordinary small arms (only mass impact — avalanche — or reducing it to 20 HP works)",
    "a second route up the mountain that bypasses the via ferrata chimney",
    "a way to avert the White Friday disaster — it is historical and inevitable",
    "that high command believes the patrol's account of what happened",
    "a known magical weakness or ritual that banishes the entity",
    "an alternate exit from the glacier that skips the blast chamber",
    "Austrian written orders in a language the patrol can read that explain everything",
    "a fifth escape option at dawn beyond leap-into-snow, avalanche, signal-fire, or rearm"
  ],
  "keeper_secrets": [
    "secret-polyp-horror-full-stat-block: STR 100 CON 100 DEX 15 INT 25 POW 30; HP 100; tentacle slash 60% Lethality 50% + knock down; wind blast 99%; ignores armor; SAN 1D6/1D12; retreats at 20 HP. Full OGC data in rules-json/the-white-war.json.",
    "secret-entity-motive-is-curiosity: the Polyp Horror probes and discards humans out of curiosity about these fragile successors to the Great Race, not hunger — but its examination is as lethal as malice.",
    "secret-white-friday-is-inevitable: regardless of the patrol's choices, on 13 December 1916 the White Friday disaster kills ~10,000; only the attribution of blame varies.",
    "secret-entity-fears-daylight: in daylight the entity suffers -20% to all skills, holds shadow, and needs 1 round to reactivate wind — this is the key to any dawn counterstroke.",
    "secret-avalanche-is-lethal-to-entity: the entity's semi-material nature does not protect it from the 10D6 damage of a triggered avalanche; the snow overhang above the shelter is the obvious environmental weapon.",
    "secret-austrians-triggered-release: the Austrian demolition work blew away the ice seal over the shaft and released the entity; their subsequent fate is evidence of what they awoke.",
    "secret-entity-retreats-at-20hp: at 20 HP or below the entity withdraws to the shaft to heal, killing only those in its direct path out.",
    "secret-truth-unbelieved: if survivors insist on the truth, high command will not believe them; they will be separated and quietly transferred to logistics roles."
  ]
}
```

- [ ] **Step 3: 校验 keeper_secrets 不与 player-safe clue_id 撞名 + pacing 单调**

Run:
```bash
python3 -c "
import json
cg = json.load(open('plugins/coc-keeper/references/starter-scenarios/the-white-war/clue-graph.json'))
ib = json.load(open('plugins/coc-keeper/references/starter-scenarios/the-white-war/improvisation-boundaries.json'))
pm = json.load(open('plugins/coc-keeper/references/starter-scenarios/the-white-war/pacing-map.json'))
# keeper_secrets 不撞 player-safe clue_id
player_safe_ids = set()
for c in cg['conclusions']:
    for cl in c['clues']:
        if cl['visibility'] == 'player-safe':
            player_safe_ids.add(cl['clue_id'])
for ks in ib['keeper_secrets']:
    ks_id = ks.split(':',1)[0]
    assert ks_id not in player_safe_ids, f'keeper_secret {ks_id} 撞 player-safe clue_id'
# pacing horror_stage 单调 (回归超1档报错)
order = {'ordinary':0,'wrongness':1,'pattern':2,'revelation':3}
prev = 0
for p in pm['pacing_curve']:
    cur = order[p['horror_stage']]
    assert cur >= prev - 0 or (prev - cur) <= 1, f\"{p['scene_id']} 回归超1档\"
    prev = max(prev, cur)
# pacing 覆盖所有 scene
g = json.load(open('plugins/coc-keeper/references/starter-scenarios/the-white-war/story-graph.json'))
scene_ids = {s['scene_id'] for s in g['scenes']}
paced = {p['scene_id'] for p in pm['pacing_curve']}
assert scene_ids == paced, f'pacing 未覆盖: {scene_ids ^ paced}'
print('OK pacing + boundaries consistent')
"
```
Expected: `OK pacing + boundaries consistent`。

- [ ] **Step 4: 提交**

```bash
git add plugins/coc-keeper/references/starter-scenarios/the-white-war/pacing-map.json plugins/coc-keeper/references/starter-scenarios/the-white-war/improvisation-boundaries.json
git commit -m "feat(coc): author pacing-map and improvisation-boundaries for The White War"
```

---

## Task 10: pregen-investigators.json + scenario 编译校验

**Files:**
- Create: `plugins/coc-keeper/references/starter-scenarios/the-white-war/pregen-investigators.json`

**法律约束**: 数值（STR/CON/技能%）是 OGC 可忠实保留；**姓名与背景原创**（不照搬源 PDF 的 Angelo Martinelli / Arturo Ferrero / Domenico Gallo / Gianfranco Croce / Roberto Cattaneo 等 PI 姓名）。

**Schema**: pregen 不是 director-read 文件，无严格 schema；用与现有调查员角色卡一致的结构（参考 `coc_character.py` 的调查员 JSON 形态）。

- [ ] **Step 1: 查看现有调查员角色卡结构作为模板**

Run: `ls plugins/coc-keeper/scripts/coc_character.py && grep -n "def create_investigator\|\"str\"\|\"con\"\|skills" plugins/coc-keeper/scripts/coc_character.py | head -15`
记录字段名（str/con/dex/skills 等）。

- [ ] **Step 2: 写 `pregen-investigators.json`**

Create `plugins/coc-keeper/references/starter-scenarios/the-white-war/pregen-investigators.json`. 5 个调查员，职业与数值忠实 OGC，姓名与背景原创。CE→7e 技能名映射按 spec §6（Firearms→射击分 Handgun/Rifle/Shotgun；Melee Weapons→格斗；Alertness→侦查；Athletics→攀爬等）。结构对齐 Step 1 查到的字段:

```json
{
  "scenario_id": "the-white-war",
  "investigators": [
    {
      "investigator_id": "pregen-alpini-rifleman-1",
      "name": "原创姓名（步兵，23岁）",
      "age": 23,
      "occupation": "Italian Alpini Rifleman",
      "str": 15, "con": 12, "dex": 13, "int": 14, "pow": 14, "cha": 8, "siz": 13,
      "hp": 14, "db": "+1D4", "build": 1, "movement": 8,
      "san": 70, "san_bp": 56,
      "armor": "1 point (heavy padded winter survival gear)",
      "skills": {
        "射击(Rifle)": 60, "格斗(Brawl)": 70, "攀爬": 70, "跳跃": 50, "侦查": 60,
        "急救": 50, "潜行": 40, "自然学": 30, "导航": 50, "匿踪": 40,
        "生存(高山)": 50, "重型武器": 40, "炮兵": 40, "手艺(厨艺)": 20,
        "外语(德语)": 20, "闪避": 50
      },
      "weapons": [
        {"name": "Mannlicher-Carcano 6.5mm rifle", "skill": "射击(Rifle)", "damage": "1D12+2", "ammo": 6, "condition": "heavily worn"},
        {"name": "Bessozzi pineapple grenade", "skill": "Athletics(Throw)", "damage": "3D6"}
      ],
      "resources_checks": 2,
      "background": "原创作家背景：一名来自多洛米蒂山谷的年轻猎人，战前靠打猎养家。"
    },
    {
      "investigator_id": "pregen-alpini-lieutenant",
      "name": "原创姓名（中尉军官，30岁）",
      "age": 30,
      "occupation": "Italian Alpini Lieutenant",
      "str": 10, "con": 14, "dex": 14, "int": 15, "pow": 16, "cha": 11, "siz": 12,
      "hp": 12, "db": "0", "build": 0, "movement": 8,
      "san": 80, "san_bp": 64,
      "armor": "1 point (heavy padded winter survival gear)",
      "skills": {
        "射击(Handgun)": 70, "格斗(Melee)": 50, "攀爬": 50, "跳跃": 50, "侦查": 40,
        "话术": 60, "说服": 70, "骑术": 60, "导航": 60, "军事科学": 50,
        "生存(高山)": 40, "社交礼仪": 60, "闪避": 50, "格斗(Brawl)": 90
      },
      "weapons": [
        {"name": "Beretta Brevetta 9mm pistol", "skill": "射击(Handgun)", "damage": "1D10", "ammo": 8, "condition": "heavily worn"},
        {"name": "Trench knife", "skill": "格斗(Brawl)", "damage": "1D6"}
      ],
      "resources_checks": 3,
      "background": "原创作家背景：皮埃蒙特贵族出身的职业军官，对部下有强烈责任感。"
    },
    {
      "investigator_id": "pregen-alpini-rifleman-2",
      "name": "原创姓名（步兵，22岁）",
      "age": 22,
      "occupation": "Italian Alpini Rifleman",
      "str": 10, "con": 10, "dex": 15, "int": 13, "pow": 12, "cha": 13, "siz": 11,
      "hp": 10, "db": "0", "build": 0, "movement": 9,
      "san": 60, "san_bp": 48,
      "armor": "1 point (heavy padded winter survival gear)",
      "skills": {
        "射击(Rifle)": 80, "格斗(Melee)": 70, "攀爬": 70, "侦查": 60, "急救": 50,
        "潜行": 80, "自然学": 70, "导航": 50, "说服": 60, "精神分析": 50,
        "生存(高山)": 50, "重型武器": 40, "炮兵": 40, "手艺(屠体处理)": 60
      },
      "weapons": [
        {"name": "Mannlicher-Carcano 6.5mm rifle", "skill": "射击(Rifle)", "damage": "1D12+2", "ammo": 6, "condition": "heavily worn"}
      ],
      "resources_checks": 2,
      "background": "原创作家背景：战前是山地猎人的学徒，对高山野兽的解剖了如指掌。"
    },
    {
      "investigator_id": "pregen-alpini-sergeant",
      "name": "原创姓名（中士，23岁）",
      "age": 23,
      "occupation": "Italian Alpini Sergeant",
      "str": 15, "con": 12, "dex": 13, "int": 14, "pow": 14, "cha": 8, "siz": 13,
      "hp": 14, "db": "+1D4", "build": 1, "movement": 8,
      "san": 70, "san_bp": 56,
      "armor": "1 point (heavy padded winter survival gear)",
      "skills": {
        "射击(Rifle)": 60, "格斗(Melee)": 70, "攀爬": 70, "侦查": 60, "急救": 50,
        "潜行": 50, "导航": 50, "话术": 50, "爆破": 40, "重型机械": 50,
        "重型武器": 40, "生存(高山)": 50, "格斗(Brawl)": 70, "手艺(机械)": 60, "机械维修": 50
      },
      "weapons": [
        {"name": "Mannlicher-Carcano 6.5mm rifle", "skill": "射击(Rifle)", "damage": "1D12+2", "ammo": 6, "condition": "heavily worn"},
        {"name": "Bessozzi pineapple grenade", "skill": "Athletics(Throw)", "damage": "3D6"},
        {"name": "Entrenching tool", "skill": "格斗(Melee)", "damage": "1D8+1"}
      ],
      "resources_checks": 2,
      "background": "原创作家背景：战前是机车技工，能把任何机械修好，也能把它们拆散。"
    },
    {
      "investigator_id": "pregen-alpini-rifleman-3",
      "name": "原创姓名（步兵，21岁）",
      "age": 21,
      "occupation": "Italian Alpini Rifleman",
      "str": 10, "con": 10, "dex": 15, "int": 13, "pow": 12, "cha": 13, "siz": 11,
      "hp": 10, "db": "0", "build": 0, "movement": 9,
      "san": 60, "san_bp": 48,
      "armor": "1 point (heavy padded winter survival gear)",
      "skills": {
        "射击(Rifle)": 60, "格斗(Brawl)": 70, "攀爬": 70, "侦查": 60, "急救": 50,
        "潜行": 40, "导航": 50, "爆破": 40, "重型武器": 40, "洞察": 50,
        "生存(高山)": 50, "机械维修": 40
      },
      "weapons": [
        {"name": "Mannlicher-Carcano 6.5mm rifle", "skill": "射击(Rifle)", "damage": "1D12+2", "ammo": 6, "condition": "heavily worn"},
        {"name": "Trench knife", "skill": "格斗(Brawl)", "damage": "1D6"}
      ],
      "resources_checks": 2,
      "background": "原创作家背景：刚从军校毕业的年轻士兵，第一次上真正的山地前线。"
    }
  ]
}
```

注：上面的 `"name": "原创姓名（...）"` 是占位，实施时填入原创意大利姓名（**不**用源 PDF 的 Angelo/Arturo/Domenico/Gianfranco/Roberto）。可由实施者自行拟定，如：步枪手1 → "Luca Benedetti"、中尉 → "Federico Marchetti"、步枪手2 → "Pietro Rosso"、中士 → "Stefano Albertini"、步枪手3 → "Matteo Conti"。这些是通用意大利姓，非源 PI。

- [ ] **Step 3: 跑 scenario 编译校验（关键验收点）**

Run:
```bash
PYTHONDONTWRITEBYTECODE=1 python3 plugins/coc-keeper/scripts/coc_scenario_compile.py plugins/coc-keeper/references/starter-scenarios/the-white-war --validate 2>&1 | tail -30
```
Expected: `0 errors`。若有 error 按提示修：
- `dramatic_question empty` → 检查 story-graph 对应 scene。
- `clues.length < minimum_routes` → critical conclusion 的 clues 不足，补 clue。
- `npc agenda empty` → 检查 npc-agendas。
- `keeper_secrets clashes with player-safe clue_id` → 改 keeper_secret 的 id 前缀。
- `horror_stage regression > 1` → 调整 pacing-map 顺序。
- `structure_type invalid` → module-meta 用 linear_acts。
- 重复跑直到 0 errors。

- [ ] **Step 4: 跑 loader 测试（应全部转 PASS）**

Run: `PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/test_starter_scenarios.py tests/test_white_war_rules.py -q -p no:cacheprovider`
Expected: PASS (全部)。

- [ ] **Step 5: 提交**

```bash
git add plugins/coc-keeper/references/starter-scenarios/the-white-war/pregen-investigators.json
git commit -m "feat(coc): add pregen investigators for The White War (OGC stats, original names)"
```

---

## Task 11: era "ww1" 登记

**Files:**
- Modify: `plugins/coc-keeper/scripts/coc_state.py:307-326`

**约束**: 在 `_ERA_CLOCKS` 字典加 `ww1` 条目，时钟指向 1916-12-12（剧本开始日，White Friday 前一天），时区 Europe/Rome。

- [ ] **Step 1: 写失败测试**

Append to `tests/test_starter_scenarios.py`:

```python
def test_ww1_era_registered_in_state_clocks():
    """coc_state 的 _ERA_CLOCKS 必须含 ww1，否则 install 后 campaign era 不匹配。"""
    import importlib.util
    spec = importlib.util.spec_from_file_location(
        "coc_state", PLUGIN_ROOT / "scripts" / "coc_state.py"
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    # _ERA_CLOCKS 是 _initialize_campaign_runtime_files 内的局部字典；
    # 通过创建一个 ww1 campaign 检查 time-state 来间接验证。
    import tempfile
    with tempfile.TemporaryDirectory() as td:
        root = Path(td) / ".coc"
        mod.ensure_workspace(root)
        mod.create_campaign(root, "era-test", "Test", era="ww1")
        ts = json.loads((root / "campaigns" / "era-test" / "save" / "time-state.json").read_text("utf-8"))
        assert ts["local_datetime"].startswith("1916-12"), f"ww1 era 时钟未指向 1916-12: {ts['local_datetime']}"
```

- [ ] **Step 2: 运行测试确认失败**

Run: `PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/test_starter_scenarios.py::test_ww1_era_registered_in_state_clocks -q -p no:cacheprovider`
Expected: FAIL（ww1 era 不存在，回退 1920s，断言 `1916-12` 失败）。

- [ ] **Step 3: 在 `coc_state.py` 的 `_ERA_CLOCKS` 加 ww1**

在 `coc_state.py:307` 的 `_ERA_CLOCKS = {` 字典里，`"1920s": {...}` 条目之前或之后追加:

```python
        "ww1": {
            "calendar_mode": "gregorian",
            "local_datetime": "1916-12-12T06:30:00",
            "timezone": "Europe/Rome",
            "display": "1916-12-12 06:30",
        },
```

- [ ] **Step 4: 运行测试确认通过**

Run: `PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/test_starter_scenarios.py -q -p no:cacheprovider`
Expected: PASS (全部含新测试)。

- [ ] **Step 5: 提交**

```bash
git add plugins/coc-keeper/scripts/coc_state.py tests/test_starter_scenarios.py
git commit -m "feat(coc): register ww1 era clock (1916-12-12) for The White War"
```

---

## Task 12: 泛化 `module_rules()` in coc_rules.py

**Files:**
- Modify: `plugins/coc-keeper/scripts/coc_rules.py:245-250`

**约束**: 把 `the_haunting_rules()` 泛化为 `module_rules(scenario_id)`，按 scenario_id 读 `rules-json/<id>.json`。`the_haunting_rules` 保留为薄包装维持向后兼容。

- [ ] **Step 1: 写失败测试**

Append to `tests/test_white_war_rules.py`:

```python
def test_module_rules_loads_by_scenario_id():
    """module_rules('the-white-war') 应返回该模组的 rules dict。"""
    import importlib.util
    spec = importlib.util.spec_from_file_location(
        "coc_rules", PLUGIN_ROOT / "scripts" / "coc_rules.py"
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    result = mod.module_rules("the-white-war")
    assert result["scenario_id"] == "the-white-war"
    assert "polyp_horror" in result["rules"]


def test_the_haunting_rules_backward_compat():
    """the_haunting_rules() 薄包装仍可用。"""
    import importlib.util
    spec = importlib.util.spec_from_file_location(
        "coc_rules", PLUGIN_ROOT / "scripts" / "coc_rules.py"
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    result = mod.the_haunting_rules()
    assert result["scenario_id"] == "the-haunting"
```

- [ ] **Step 2: 运行测试确认失败**

Run: `PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/test_white_war_rules.py::test_module_rules_loads_by_scenario_id -q -p no:cacheprovider`
Expected: FAIL — `module_rules` 不存在。

- [ ] **Step 3: 改 `coc_rules.py`**

In `coc_rules.py:245-250`，替换 `the_haunting_rules` 函数:

```python
def module_rules(scenario_id: str) -> dict[str, Any]:
    table = load_rule_table(scenario_id)
    return {
        "scenario_id": str(table["scenario_id"]),
        "rules": _json_copy(table["rules"]),
    }


def the_haunting_rules() -> dict[str, Any]:
    """Backward-compatible wrapper; prefer module_rules('the-haunting')."""
    return module_rules("the-haunting")
```

- [ ] **Step 4: 运行测试确认通过**

Run: `PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/test_white_war_rules.py -q -p no:cacheprovider`
Expected: PASS (全部)。

- [ ] **Step 5: 提交**

```bash
git add plugins/coc-keeper/scripts/coc_rules.py tests/test_white_war_rules.py
git commit -m "feat(coc): generalize the_haunting_rules into module_rules(scenario_id)"
```

---

## Task 13: coc-main 新人引导节点 + Hard Rule

**Files:**
- Modify: `plugins/coc-keeper/skills/coc-main/SKILL.md`

**约束**: 工作流第 4 步之后插入引导；Hard Rules 段加强制引导规则。措辞面向新手、中英双语。仅在「新 campaign 且 active_scenario_id 为空」触发。

- [ ] **Step 1: 改工作流，在第 4、5 步之间插入引导**

Edit `plugins/coc-keeper/skills/coc-main/SKILL.md`。在 Workflow 列表的第 4 项与第 5 项之间插入新的一步（后续编号顺延）:

将:
```markdown
4. Select or create a campaign before character creation or play.
5. Bind or import a scenario with `coc-scenario-import`, extending `localized_terms` for the campaign language when names, places, handouts, scenario titles, or special terms need customary local rendering.
```

改为:
```markdown
4. Select or create a campaign before character creation or play.
5. **Scenario onboarding (mandatory for new campaigns).** If the selected campaign is newly created and has no bound scenario (`active_scenario_id` is empty), you MUST proactively present a clear, beginner-facing choice before doing anything else:

   > **你有现成的剧本吗？ / Do you have a scenario ready?**
   >
   > 🅰️ 我有剧本 PDF / 剧本资料 → 用 `coc-scenario-import` 导入你的剧本（I have a scenario PDF/notes → import it with `coc-scenario-import`）
   > 🅱️ 我是新手，想直接开玩 → 我们内置了开箱即玩的剧本，装上就能玩，无需任何 PDF（I'm new / I want to play right now → pick a built-in starter scenario）
   >
   > Built-in starter scenarios (run `coc-starter list` for the current list):
   > - **《白色战争》The White War** — 1916 年意大利阿尔卑斯前线，一支山地巡逻队调查冰川上传来的怪响，唤醒冰封万年的远古存在。开箱即玩。

   To install a chosen built-in scenario into the campaign, run:
   ```bash
   python3 ../../scripts/coc_starter.py install --campaign <campaign-id> --scenario <scenario-id>
   ```
   Never skip this prompt for a new empty campaign, and never wait for the user to ask. This is how new players discover they can play without owning a PDF. Continue old campaigns or campaigns that already have a bound scenario without prompting.
6. Bind or import a scenario with `coc-scenario-import` (for user-provided scenarios), extending `localized_terms` for the campaign language when names, places, handouts, scenario titles, or special terms need customary local rendering.
```

（后续步骤 6→7、7→8、8→9、9→10、10→11 编号顺延。）

- [ ] **Step 2: 在 Hard Rules 段追加强制引导规则**

在 `## Hard Rules` 列表末尾追加:

```markdown
- **For any newly created campaign with no bound scenario, you MUST proactively offer the scenario onboarding choice (built-in vs imported) before proceeding — never skip it, never wait for the user to ask.** New players do not know built-in scenarios exist; this prompt is the only way they find out. Phrase it in plain, beginner-friendly language and name every available built-in scenario with a one-line pitch.
```

- [ ] **Step 3: 重新编号后续工作流步骤**

检查 `## Workflow` 列表，确保插入后编号连续（1-11）。原 5-10 全部 +1。

- [ ] **Step 4: 提交**

```bash
git add plugins/coc-keeper/skills/coc-main/SKILL.md
git commit -m "feat(coc): add mandatory scenario onboarding prompt for new campaigns in coc-main"
```

---

## Task 14: README 版权章节 + 双轨同步

**Files:**
- Modify: `README.md`（版权章节）
- Run: `scripts/sync_coc_plugin_copy.py`

- [ ] **Step 1: 在 README 版权章节追加 OGL starter scenario 声明**

在 `README.md` 的 `## 版权与声明 / Copyright Notice` 段（约 :212-216）之后、`## License` 之前，追加一段:

```markdown
### Built-in Starter Scenarios (OGL)

This repository ships one built-in, play-ready starter scenario — **The White War** — adapted under the Open Gaming License v1.0a from the OGC game data of "The White War" by Paul StJohn Mackintosh (Cthulhu Reborn Publishing, 2023). The numeric game data and creature statistics (Open Game Content per the source's OGL declaration) are reproduced faithfully in `plugins/coc-keeper/references/rules-json/the-white-war.json`; the scenario's narrative, scene names, NPC names, and dialogue are an original derivative work (the source's Product Identity — plots, locations, characters — is NOT reproduced).

A full copy of the OGL and the complete Section 15 COPYRIGHT NOTICE are included with the scenario at `plugins/coc-keeper/references/starter-scenarios/the-white-war/`. This built-in scenario does not include any copyrighted rulebook or adventure PDF; it lets new players start playing with zero PDF preparation.
```

- [ ] **Step 2: 同步到 ZCode 轨**

Run: `python3 scripts/sync_coc_plugin_copy.py 2>&1 | tail -5`
Expected: 无输出（成功）或列出同步的文件。

- [ ] **Step 3: 校验两轨一致**

Run: `python3 scripts/sync_coc_plugin_copy.py --check 2>&1 | tail -5`
Expected: 无输出（clean）。

- [ ] **Step 4: 提交**

```bash
git add README.md plugins/coc-keeper-zcode/
git commit -m "docs(coc): document OGL starter scenario in README; sync ZCode track"
```

---

## Task 15: 全套回归校验 + 手动验收

**Files:** 无（仅运行校验）

- [ ] **Step 1: 跑全套插件测试**

Run:
```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/test_plugin_metadata.py tests/test_zcode_plugin_metadata.py tests/test_coc_plugin_sync_script.py tests/test_starter_scenarios.py tests/test_white_war_rules.py -q -p no:cacheprovider
```
Expected: ALL PASS。若有 sync 不一致，跑 Task 14 Step 2 重新同步。

- [ ] **Step 2: 跑 coc_validate 整体规则校验**

Run: `PYTHONDONTWRITEBYTECODE=1 python3 plugins/coc-keeper/scripts/coc_validate.py plugins/coc-keeper 2>&1 | tail -10`
Expected: 无 error。

- [ ] **Step 3: 跑 scenario 编译校验（ZCode 轨也跑一遍）**

Run:
```bash
PYTHONDONTWRITEBYTECODE=1 python3 plugins/coc-keeper/scripts/coc_scenario_compile.py plugins/coc-keeper/references/starter-scenarios/the-white-war --validate
PYTHONDONTWRITEBYTECODE=1 python3 plugins/coc-keeper/scripts/coc_scenario_compile.py plugins/coc-keeper-zcode/references/starter-scenarios/the-white-war --validate
```
Expected: 两个都 `0 errors`。

- [ ] **Step 4: 验证 loader CLI**

Run:
```bash
python3 plugins/coc-keeper/scripts/coc_starter.py list
```
Expected: 输出一行 `the-white-war<TAB>The White War<TAB>...one_liner...`。

- [ ] **Step 5: 手动验收全流程（在临时目录，不污染真实 .coc）**

Run:
```bash
TMP=$(mktemp -d)
python3 -c "
import sys; sys.path.insert(0,'plugins/coc-keeper/scripts')
import coc_state, coc_starter
from pathlib import Path
root = Path('$TMP')
coc_state.ensure_workspace(root)
coc_state.create_campaign(root,'acceptance','Acceptance Test', era='ww1')
p = coc_starter.install_starter(root,'acceptance','the-white-war')
print('installed to', p)
import json
c = json.load(open(root/'campaigns/acceptance/campaign.json'))
print('active_scenario_id:', c['active_scenario_id'], '| era:', c['era'])
print('7 files present:', all((p/f).exists() for f in coc_starter.STARTER_SCENARIO_FILES))
"
rm -rf "$TMP"
```
Expected: `active_scenario_id: the-white-war | era: ww1` + `7 files present: True`。

- [ ] **Step 6: 跑 sync --check 最终确认**

Run: `python3 scripts/sync_coc_plugin_copy.py --check`
Expected: clean（无输出）。

- [ ] **Step 7: 最终提交（如有残留改动）**

```bash
git status --short
# 若有未提交改动:
git add -A && git commit -m "test(coc): verify full starter-scenario pipeline"
```

---

## Self-Review 结果

**1. Spec 覆盖检查**:
- 法律双轨（OGC 数值 + 原创改编）→ Task 1（OGC 规则包）+ Task 4-10（原创 scenario JSON，姓名/对话原创）✅
- OGL §15 归属 + license 文件 → Task 4（README + OGL-LICENSE.txt + module-meta 字段）✅
- 新人引导节点（Hard Rule，仅新档无剧本）→ Task 13 ✅
- loader（list/install 幂等）→ Task 3 ✅
- era "ww1" 登记 → Task 11 ✅
- module_rules 泛化 → Task 12 ✅
- rule-index 登记 + REQUIRED_RULE_FILES → Task 2 ✅
- 两轨同步 → Task 14 + 每个 Task 的 sync ✅
- 测试与校验 → Task 1/2/3/10/11/12 测试 + Task 15 全套回归 ✅
- CE→7e 转换 → Task 1（武器/Lethality house rule）+ Task 10（技能名映射）✅

**2. 占位符扫描**: Task 10 的 pregen `name` 字段标了「原创姓名」并给出建议姓，需实施者填入——这是内容创作而非占位（计划已说明不用源 PI 姓名）。其余无 TBD/TODO。

**3. 类型一致性**: `list_starter_scenarios` 返回字段（scenario_id/title/one_liner/structure_type/era/content_flags）与 module-meta（Task 4）字段、loader 读取（Task 3）一致。`install_starter` 返回 Path 与测试断言一致。`STARTER_SCENARIO_FILES` 在 Task 3 定义、Task 3/15 测试引用。`module_rules(scenario_id)` 签名在 Task 12 定义、测试引用。

无遗漏。
