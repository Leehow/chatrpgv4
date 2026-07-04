# COC Keeper V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the V1 playable kernel for a repo-local `coc-keeper` Codex plugin with structured rules JSON, deterministic Python scripts, persistent `.coc/` state helpers, and playtest reporting.

**Architecture:** Create a repo-local plugin at `plugins/coc-keeper/`. Keep skills as concise instructions, keep deterministic behavior in Python scripts, and keep frequent COC rules in `references/rules-json/`. Tests exercise Python scripts directly and validate plugin/skill metadata.

**Tech Stack:** Python 3 standard library, `pytest`, `pypdf` for lightweight PDF metadata, Codex plugin manifest, Codex skill folders.

## Global Constraints

- COC mode must activate only when the user explicitly asks for COC mode.
- No UI and no MCP in V1.
- Runtime rules calculations use structured JSON first, not ad hoc PDF lookup.
- Campaign runtime data lives under the current project `.coc/`.
- Reusable investigators live under `.coc/investigators/`, outside individual campaigns.
- Playtest data lives under `.coc/playtests/` and must not mutate real campaigns or real investigator history.
- Keeper-only information requires `[spoiler_warning]` and confirmation before reveal.
- All machine-facing markers, filenames, JSON keys, and status values use ASCII English.
- Use TDD for production Python code: write a failing test, verify failure, implement minimal code, verify pass.
- Do not track `pdf/`, `.coc/`, or `.DS_Store`.

---

## File Structure

Create and modify these files:

- Create `plugins/coc-keeper/.codex-plugin/plugin.json`: Codex plugin manifest.
- Create `plugins/coc-keeper/references/mode-protocol.md`: activation, immersion, meta, and spoiler protocol.
- Create `plugins/coc-keeper/references/state-schema.md`: `.coc/` state layout and JSON record contracts.
- Create `plugins/coc-keeper/references/rules-json-guide.md`: rules JSON conventions.
- Create `plugins/coc-keeper/references/rules-json/*.json`: V1 rules seed tables.
- Create `plugins/coc-keeper/scripts/coc_rules.py`: load/query rules JSON and compute common thresholds.
- Create `plugins/coc-keeper/scripts/coc_roll.py`: dice expressions and percentile checks.
- Create `plugins/coc-keeper/scripts/coc_character.py`: derived investigator values and development helpers.
- Create `plugins/coc-keeper/scripts/coc_state.py`: create `.coc/` workspace, campaigns, investigators, logs, and snapshots.
- Create `plugins/coc-keeper/scripts/coc_scenario.py`: catalog PDFs and create scenario skeletons.
- Create `plugins/coc-keeper/scripts/coc_playtest_report.py`: generate battle and evaluation reports.
- Create `plugins/coc-keeper/scripts/coc_validate.py`: validate rules and `.coc/` state shape.
- Create `plugins/coc-keeper/skills/*/SKILL.md`: V1 skill instructions.
- Create `tests/test_rules.py`: tests for rules loader and threshold calculations.
- Create `tests/test_roll.py`: tests for dice and percentile checks.
- Create `tests/test_character.py`: tests for derived values and age modifiers.
- Create `tests/test_state.py`: tests for workspace, campaign, investigator, logs, and snapshots.
- Create `tests/test_scenario.py`: tests for PDF catalog and scenario skeleton output.
- Create `tests/test_playtest_report.py`: tests for report generation.
- Create `tests/test_plugin_metadata.py`: tests for plugin manifest and skill frontmatter.

---

### Task 1: Scaffold Repo-Local Plugin

**Files:**
- Create: `plugins/coc-keeper/.codex-plugin/plugin.json`
- Create: `plugins/coc-keeper/skills/`
- Create: `plugins/coc-keeper/scripts/`
- Create: `plugins/coc-keeper/references/`
- Modify: `.gitignore`
- Test: `tests/test_plugin_metadata.py`

**Interfaces:**
- Produces: plugin root at `plugins/coc-keeper`.
- Produces: manifest JSON with `name: "coc-keeper"` and `skills: "./skills/"`.
- Consumed by: all later plugin tasks.

- [ ] **Step 1: Write the failing metadata test**

```python
# tests/test_plugin_metadata.py
import json
from pathlib import Path


PLUGIN_ROOT = Path("plugins/coc-keeper")


def test_plugin_manifest_declares_coc_keeper_skill_plugin():
    manifest_path = PLUGIN_ROOT / ".codex-plugin" / "plugin.json"
    assert manifest_path.exists()

    manifest = json.loads(manifest_path.read_text())
    assert manifest["name"] == "coc-keeper"
    assert manifest["version"] == "0.1.0"
    assert manifest["skills"] == "./skills/"
    assert manifest["interface"]["displayName"] == "COC Keeper"
    assert "Call of Cthulhu" in manifest["description"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_plugin_metadata.py::test_plugin_manifest_declares_coc_keeper_skill_plugin -v`

Expected: FAIL because `plugins/coc-keeper/.codex-plugin/plugin.json` does not exist.

- [ ] **Step 3: Scaffold plugin**

Run:

```bash
python3 /Users/haoli/.codex/skills/.system/plugin-creator/scripts/create_basic_plugin.py coc-keeper --path plugins --with-skills --with-scripts --with-assets
```

Then replace `plugins/coc-keeper/.codex-plugin/plugin.json` with:

```json
{
  "name": "coc-keeper",
  "version": "0.1.0",
  "description": "Call of Cthulhu Keeper mode plugin for Codex with structured rules, persistent campaign state, and playtest reporting.",
  "author": {
    "name": "Local developer"
  },
  "skills": "./skills/",
  "interface": {
    "displayName": "COC Keeper",
    "shortDescription": "Run Call of Cthulhu campaigns inside Codex.",
    "longDescription": "COC Keeper adds an explicit Codex mode for immersive Call of Cthulhu play, structured rules lookup, JSON campaign state, reusable investigators, module indexing, and automated playtest reports.",
    "developerName": "Local developer",
    "category": "Productivity",
    "capabilities": ["Interactive", "Write"],
    "defaultPrompt": [
      "Activate COC mode.",
      "Create a COC investigator.",
      "Run a COC playtest."
    ]
  }
}
```

Ensure `.gitignore` contains:

```gitignore
.DS_Store
pdf/
.coc/
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_plugin_metadata.py::test_plugin_manifest_declares_coc_keeper_skill_plugin -v`

Expected: PASS.

- [ ] **Step 5: Validate plugin manifest**

Run:

```bash
python3 /Users/haoli/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py plugins/coc-keeper
```

Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add .gitignore plugins/coc-keeper/.codex-plugin/plugin.json plugins/coc-keeper/skills plugins/coc-keeper/scripts plugins/coc-keeper/assets tests/test_plugin_metadata.py
git commit -m "feat: scaffold coc keeper plugin"
```

---

### Task 2: Add Rules JSON And Rules Loader

**Files:**
- Create: `plugins/coc-keeper/references/rules-json/metadata.json`
- Create: `plugins/coc-keeper/references/rules-json/damage-bonus-build.json`
- Create: `plugins/coc-keeper/references/rules-json/success-levels.json`
- Create: `plugins/coc-keeper/references/rules-json/difficulty-levels.json`
- Create: `plugins/coc-keeper/references/rules-json/sanity.json`
- Create: `plugins/coc-keeper/scripts/coc_rules.py`
- Test: `tests/test_rules.py`

**Interfaces:**
- Produces: `coc_rules.rules_dir() -> Path`
- Produces: `coc_rules.load_rule_table(name: str) -> Any`
- Produces: `coc_rules.half_value(value: int) -> int`
- Produces: `coc_rules.fifth_value(value: int) -> int`
- Produces: `coc_rules.damage_bonus_build(str_value: int, siz_value: int) -> dict`
- Produces: `coc_rules.success_level(roll: int, target: int) -> str`
- Consumed by: `coc_roll.py`, `coc_character.py`, `coc_validate.py`.

- [ ] **Step 1: Write failing rules tests**

```python
# tests/test_rules.py
import importlib.util
from pathlib import Path


def load_module(name: str, relative_path: str):
    path = Path(relative_path)
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


coc_rules = load_module("coc_rules", "plugins/coc-keeper/scripts/coc_rules.py")


def test_half_and_fifth_values_round_down():
    assert coc_rules.half_value(55) == 27
    assert coc_rules.fifth_value(55) == 11
    assert coc_rules.half_value(100) == 50
    assert coc_rules.fifth_value(100) == 20


def test_damage_bonus_and_build_use_structured_table():
    result = coc_rules.damage_bonus_build(60, 70)
    assert result == {
        "total": 130,
        "damage_bonus": "+1D4",
        "build": 1
    }


def test_success_levels_include_fumbles_and_extreme_success():
    assert coc_rules.success_level(1, 65) == "critical"
    assert coc_rules.success_level(12, 65) == "extreme"
    assert coc_rules.success_level(31, 65) == "hard"
    assert coc_rules.success_level(60, 65) == "regular"
    assert coc_rules.success_level(80, 65) == "failure"
    assert coc_rules.success_level(100, 65) == "fumble"
    assert coc_rules.success_level(96, 40) == "fumble"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_rules.py -v`

Expected: FAIL because `plugins/coc-keeper/scripts/coc_rules.py` does not exist.

- [ ] **Step 3: Add rules JSON seed files**

Create `damage-bonus-build.json` with the V1 table from the Keeper Rulebook summary:

```json
[
  {"min": 2, "max": 64, "damage_bonus": "-2", "build": -2},
  {"min": 65, "max": 84, "damage_bonus": "-1", "build": -1},
  {"min": 85, "max": 124, "damage_bonus": "none", "build": 0},
  {"min": 125, "max": 164, "damage_bonus": "+1D4", "build": 1},
  {"min": 165, "max": 204, "damage_bonus": "+1D6", "build": 2},
  {"min": 205, "max": 284, "damage_bonus": "+2D6", "build": 3},
  {"min": 285, "max": 364, "damage_bonus": "+3D6", "build": 4},
  {"min": 365, "max": 444, "damage_bonus": "+4D6", "build": 5},
  {"min": 445, "max": 524, "damage_bonus": "+5D6", "build": 6}
]
```

Create `success-levels.json`:

```json
{
  "critical_roll": 1,
  "fumble": {
    "target_below_50": [96, 100],
    "target_50_or_above": [100, 100]
  }
}
```

Create `difficulty-levels.json`:

```json
{
  "regular": {"divisor": 1},
  "hard": {"divisor": 2},
  "extreme": {"divisor": 5}
}
```

Create `sanity.json`:

```json
{
  "temporary_insanity_loss_threshold": 5,
  "indefinite_insanity_daily_fraction": 0.2,
  "bout_duration": {
    "real_time_rounds": "1D10",
    "summary_hours": "1D10"
  }
}
```

Create `metadata.json`:

```json
{
  "schema_version": 1,
  "ruleset": "Call of Cthulhu 7th Edition",
  "source_note": "V1 seed tables are extracted from the local Keeper Rulebook PDF summaries and should be expanded in later versions."
}
```

- [ ] **Step 4: Implement `coc_rules.py`**

```python
#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path
from typing import Any


SCRIPT_DIR = Path(__file__).resolve().parent
PLUGIN_ROOT = SCRIPT_DIR.parent
RULES_DIR = PLUGIN_ROOT / "references" / "rules-json"


def rules_dir() -> Path:
    return RULES_DIR


def load_rule_table(name: str) -> Any:
    path = RULES_DIR / f"{name}.json"
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def half_value(value: int) -> int:
    return value // 2


def fifth_value(value: int) -> int:
    return value // 5


def damage_bonus_build(str_value: int, siz_value: int) -> dict[str, int | str]:
    total = str_value + siz_value
    for row in load_rule_table("damage-bonus-build"):
        if row["min"] <= total <= row["max"]:
            return {
                "total": total,
                "damage_bonus": row["damage_bonus"],
                "build": row["build"],
            }
    raise ValueError(f"STR+SIZ total out of V1 table range: {total}")


def _is_fumble(roll: int, target: int) -> bool:
    table = load_rule_table("success-levels")["fumble"]
    lower, upper = table["target_below_50" if target < 50 else "target_50_or_above"]
    return lower <= roll <= upper


def success_level(roll: int, target: int) -> str:
    if not 1 <= roll <= 100:
        raise ValueError("roll must be between 1 and 100")
    if not 1 <= target <= 100:
        raise ValueError("target must be between 1 and 100")
    if roll == load_rule_table("success-levels")["critical_roll"]:
        return "critical"
    if _is_fumble(roll, target):
        return "fumble"
    if roll <= fifth_value(target):
        return "extreme"
    if roll <= half_value(target):
        return "hard"
    if roll <= target:
        return "regular"
    return "failure"
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pytest tests/test_rules.py -v`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add plugins/coc-keeper/references/rules-json plugins/coc-keeper/scripts/coc_rules.py tests/test_rules.py
git commit -m "feat: add coc rules json loader"
```

---

### Task 3: Add Dice And Percentile Roll Script

**Files:**
- Create: `plugins/coc-keeper/scripts/coc_roll.py`
- Test: `tests/test_roll.py`

**Interfaces:**
- Consumes: `coc_rules.success_level(roll: int, target: int) -> str`
- Produces: `coc_roll.roll_expression(expression: str, rng: random.Random | None = None) -> dict`
- Produces: `coc_roll.percentile_check(target: int, difficulty: str = "regular", bonus: int = 0, penalty: int = 0, rng: random.Random | None = None) -> dict`

- [ ] **Step 1: Write failing roll tests**

```python
# tests/test_roll.py
import importlib.util
import random
from pathlib import Path


def load_module(name: str, relative_path: str):
    path = Path(relative_path)
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


coc_roll = load_module("coc_roll", "plugins/coc-keeper/scripts/coc_roll.py")


def test_roll_expression_returns_total_and_terms():
    result = coc_roll.roll_expression("2D6+3", rng=random.Random(4))
    assert result["expression"] == "2D6+3"
    assert result["modifier"] == 3
    assert len(result["rolls"]) == 2
    assert result["total"] == sum(result["rolls"]) + 3


def test_percentile_check_applies_hard_difficulty():
    result = coc_roll.percentile_check(60, difficulty="hard", rng=random.Random(1))
    assert result["target"] == 60
    assert result["effective_target"] == 30
    assert result["difficulty"] == "hard"
    assert result["roll"] == 18
    assert result["outcome"] == "regular"


def test_bonus_and_penalty_cancel():
    result = coc_roll.percentile_check(50, bonus=1, penalty=1, rng=random.Random(3))
    assert result["bonus"] == 0
    assert result["penalty"] == 0
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_roll.py -v`

Expected: FAIL because `coc_roll.py` does not exist.

- [ ] **Step 3: Implement minimal `coc_roll.py`**

Implement expression parsing for `NDM`, `NDM+K`, and `NDM-K`. Implement percentile checks using two d10 values where `00` is 100. Use additional tens dice for bonus or penalty and select the best or worst tens value. Import `coc_rules.py` by path so the script works without installing a package.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_roll.py -v`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/coc-keeper/scripts/coc_roll.py tests/test_roll.py
git commit -m "feat: add coc dice roller"
```

---

### Task 4: Add Investigator Character Helpers

**Files:**
- Create: `plugins/coc-keeper/scripts/coc_character.py`
- Test: `tests/test_character.py`

**Interfaces:**
- Consumes: `coc_rules.damage_bonus_build(str_value: int, siz_value: int) -> dict`
- Produces: `coc_character.derive_values(characteristics: dict[str, int], luck: int | None = None, *, age_mov_penalty: int = 0) -> dict`
- Produces: `coc_character.apply_age_modifiers(characteristics: dict[str, int], age: int, edu_improvement_rolls: list[dict] | None = None, characteristic_reductions: list[dict] | None = None) -> dict`; successful EDU improvement checks must carry the 1D10 `improvement_roll`, and age brackets with STR/CON/DEX/SIZ reductions must provide structured `characteristic_reductions`.
- Produces: `coc_character.validate_character_sheet(sheet: dict) -> list[str]`

- [ ] **Step 1: Write failing character tests**

```python
# tests/test_character.py
import importlib.util
from pathlib import Path


def load_module(name: str, relative_path: str):
    path = Path(relative_path)
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


coc_character = load_module("coc_character", "plugins/coc-keeper/scripts/coc_character.py")


def test_derive_values_calculates_hp_mp_san_db_build_and_mov():
    characteristics = {
        "STR": 60,
        "CON": 50,
        "SIZ": 70,
        "DEX": 55,
        "APP": 45,
        "INT": 65,
        "POW": 60,
        "EDU": 70,
    }
    result = coc_character.derive_values(characteristics, luck=45)
    assert result["HP"] == 12
    assert result["MP"] == 12
    assert result["SAN"] == 60
    assert result["Luck"] == 45
    assert result["DB"] == "+1D4"
    assert result["Build"] == 1
    assert result["MOV"] == 7


def test_validate_character_sheet_reports_missing_required_fields():
    errors = coc_character.validate_character_sheet({"name": "Ada"})
    assert "missing id" in errors
    assert "missing characteristics" in errors
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_character.py -v`

Expected: FAIL because `coc_character.py` does not exist.

- [ ] **Step 3: Implement minimal `coc_character.py`**

Implement derived values with COC V1 formulas:

```text
HP = floor((CON + SIZ) / 10)
MP = floor(POW / 5)
SAN = POW
Luck = provided luck or POW
DB/Build = damage_bonus_build(STR, SIZ)
MOV = 9 if DEX and STR are both greater than SIZ, 8 if either DEX or STR is at least SIZ, otherwise 7
```

Implement validation for required `id`, `name`, `characteristics`, and all eight characteristics.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_character.py -v`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/coc-keeper/scripts/coc_character.py tests/test_character.py
git commit -m "feat: add coc character helpers"
```

---

### Task 5: Add Project State Helpers

**Files:**
- Create: `plugins/coc-keeper/scripts/coc_state.py`
- Test: `tests/test_state.py`

**Interfaces:**
- Produces: `coc_state.ensure_workspace(root: Path) -> dict`
- Produces: `coc_state.create_investigator(root: Path, investigator_id: str, sheet: dict) -> Path`
- Produces: `coc_state.create_campaign(root: Path, campaign_id: str, title: str, era: str = "1920s") -> Path`
- Produces: `coc_state.link_party(root: Path, campaign_id: str, investigator_ids: list[str]) -> Path`
- Produces: `coc_state.append_jsonl(path: Path, event: dict) -> None`
- Produces: `coc_state.create_snapshot(root: Path, campaign_id: str, label: str) -> Path`

- [ ] **Step 1: Write failing state tests**

```python
# tests/test_state.py
import importlib.util
import json
from pathlib import Path


def load_module(name: str, relative_path: str):
    path = Path(relative_path)
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


coc_state = load_module("coc_state", "plugins/coc-keeper/scripts/coc_state.py")


def test_create_campaign_workspace_and_party(tmp_path):
    coc_state.ensure_workspace(tmp_path)
    investigator_path = coc_state.create_investigator(
        tmp_path,
        "ada-king",
        {"schema_version": 1, "id": "ada-king", "name": "Ada King", "characteristics": {}},
    )
    campaign_path = coc_state.create_campaign(tmp_path, "haunting-test", "The Haunting Test")
    party_path = coc_state.link_party(tmp_path, "haunting-test", ["ada-king"])

    assert investigator_path == tmp_path / ".coc" / "investigators" / "ada-king" / "character.json"
    assert campaign_path == tmp_path / ".coc" / "campaigns" / "haunting-test" / "campaign.json"
    assert json.loads(party_path.read_text())["investigator_ids"] == ["ada-king"]
    assert (tmp_path / ".coc" / "campaigns" / "haunting-test" / "memory").exists()
    assert (tmp_path / ".coc" / "campaigns" / "haunting-test" / "logs").exists()


def test_append_jsonl_and_snapshot(tmp_path):
    coc_state.ensure_workspace(tmp_path)
    coc_state.create_campaign(tmp_path, "case-1", "Case 1")
    log_path = tmp_path / ".coc" / "campaigns" / "case-1" / "logs" / "events.jsonl"
    coc_state.append_jsonl(log_path, {"type": "scene", "payload": {"id": "intro"}})
    snapshot_path = coc_state.create_snapshot(tmp_path, "case-1", "after-intro")

    assert log_path.read_text().strip().endswith('"scene", "payload": {"id": "intro"}}')
    assert snapshot_path.exists()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_state.py -v`

Expected: FAIL because `coc_state.py` does not exist.

- [ ] **Step 3: Implement minimal `coc_state.py`**

Implement atomic JSON writes with `tempfile.NamedTemporaryFile` and `Path.replace()`. Create the directory tree from the design spec. Use ISO-8601 UTC timestamps with timezone.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_state.py -v`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/coc-keeper/scripts/coc_state.py tests/test_state.py
git commit -m "feat: add coc campaign state helpers"
```

---

### Task 6: Add Scenario Catalog And Skeleton Helpers

**Files:**
- Create: `plugins/coc-keeper/scripts/coc_scenario.py`
- Test: `tests/test_scenario.py`

**Interfaces:**
- Produces: `coc_scenario.catalog_pdfs(pdf_dir: Path) -> list[dict]`
- Produces: `coc_scenario.create_scenario_skeleton(campaign_dir: Path, scenario_id: str, title: str, source: dict) -> dict`

- [ ] **Step 1: Write failing scenario tests**

```python
# tests/test_scenario.py
import importlib.util
import json
from pathlib import Path

from pypdf import PdfWriter


def load_module(name: str, relative_path: str):
    path = Path(relative_path)
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


coc_scenario = load_module("coc_scenario", "plugins/coc-keeper/scripts/coc_scenario.py")


def write_blank_pdf(path: Path, pages: int = 2):
    writer = PdfWriter()
    for _ in range(pages):
        writer.add_blank_page(width=72, height=72)
    with path.open("wb") as handle:
        writer.write(handle)


def test_catalog_pdfs_reports_page_counts(tmp_path):
    pdf_dir = tmp_path / "pdf"
    pdf_dir.mkdir()
    write_blank_pdf(pdf_dir / "module.pdf", pages=3)

    catalog = coc_scenario.catalog_pdfs(pdf_dir)
    assert catalog == [{
        "filename": "module.pdf",
        "path": str(pdf_dir / "module.pdf"),
        "page_count": 3,
        "title": None,
    }]


def test_create_scenario_skeleton_writes_required_files(tmp_path):
    campaign_dir = tmp_path / ".coc" / "campaigns" / "case-1"
    result = coc_scenario.create_scenario_skeleton(
        campaign_dir,
        "case-1-scenario",
        "Case 1 Scenario",
        {"type": "pdf", "path": "pdf/module.pdf", "page_start": 1, "page_end": 3},
    )

    assert result["scenario_id"] == "case-1-scenario"
    assert (campaign_dir / "scenario" / "scenario.json").exists()
    assert json.loads((campaign_dir / "scenario" / "locations.json").read_text()) == []
    assert json.loads((campaign_dir / "index" / "source-map.json").read_text())["sources"][0]["path"] == "pdf/module.pdf"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_scenario.py -v`

Expected: FAIL because `coc_scenario.py` does not exist.

- [ ] **Step 3: Implement minimal `coc_scenario.py`**

Use `pypdf.PdfReader` for page count and metadata. Create empty structured files for `locations.json`, `npcs.json`, `clues.json`, `timeline.json`, `handouts.json`, and `keeper-secrets.json`. Create `index/source-map.json`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_scenario.py -v`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/coc-keeper/scripts/coc_scenario.py tests/test_scenario.py
git commit -m "feat: add coc scenario catalog helpers"
```

---

### Task 7: Add Playtest Report Generator

**Files:**
- Create: `plugins/coc-keeper/scripts/coc_playtest_report.py`
- Test: `tests/test_playtest_report.py`

**Interfaces:**
- Produces: `coc_playtest_report.generate_battle_report(run_dir: Path) -> Path`
- Produces: `coc_playtest_report.generate_evaluation_report(run_dir: Path) -> Path`

- [ ] **Step 1: Write failing playtest report tests**

```python
# tests/test_playtest_report.py
import importlib.util
import json
from pathlib import Path


def load_module(name: str, relative_path: str):
    path = Path(relative_path)
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


coc_playtest_report = load_module("coc_playtest_report", "plugins/coc-keeper/scripts/coc_playtest_report.py")


def write_jsonl(path: Path, events: list[dict]):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\\n".join(json.dumps(event) for event in events) + "\\n")


def test_generate_battle_and_evaluation_reports(tmp_path):
    run_dir = tmp_path / ".coc" / "playtests" / "run-1"
    write_jsonl(run_dir / "transcript.jsonl", [
        {"turn": 1, "role": "keeper_under_test", "text": "The room is cold."},
        {"turn": 2, "role": "player_simulator", "text": "I search the desk."},
    ])
    write_jsonl(run_dir / "evaluator-notes.jsonl", [
        {"severity": "low", "category": "immersion", "text": "Good opening."}
    ])
    (run_dir / "playtest.json").parent.mkdir(parents=True, exist_ok=True)
    (run_dir / "playtest.json").write_text(json.dumps({
        "run_id": "run-1",
        "scenario": "smoke-test",
        "player_profile": "careful_investigator",
        "scores": {"immersion": 4, "rules_accuracy": 3}
    }))

    battle_path = coc_playtest_report.generate_battle_report(run_dir)
    evaluation_path = coc_playtest_report.generate_evaluation_report(run_dir)

    assert "## Session Timeline" in battle_path.read_text()
    assert "I search the desk." in battle_path.read_text()
    assert "## Scorecard" in evaluation_path.read_text()
    assert "rules_accuracy: 3" in evaluation_path.read_text()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_playtest_report.py -v`

Expected: FAIL because `coc_playtest_report.py` does not exist.

- [ ] **Step 3: Implement minimal `coc_playtest_report.py`**

Read `playtest.json`, `transcript.jsonl`, and `evaluator-notes.jsonl`. Write `artifacts/battle-report.md` and `artifacts/evaluation-report.md` with the required section headers from the design spec.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_playtest_report.py -v`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/coc-keeper/scripts/coc_playtest_report.py tests/test_playtest_report.py
git commit -m "feat: add coc playtest reports"
```

---

### Task 8: Add Validation Script

**Files:**
- Create: `plugins/coc-keeper/scripts/coc_validate.py`
- Test: `tests/test_plugin_metadata.py`

**Interfaces:**
- Produces: `coc_validate.validate_rules(plugin_root: Path) -> list[str]`
- Produces: `coc_validate.validate_campaign(campaign_dir: Path) -> list[str]`
- Produces: CLI `python3 plugins/coc-keeper/scripts/coc_validate.py rules plugins/coc-keeper`

- [ ] **Step 1: Extend failing validation tests**

Add to `tests/test_plugin_metadata.py`:

```python
def test_validate_rules_script_accepts_seed_rules():
    import importlib.util

    path = PLUGIN_ROOT / "scripts" / "coc_validate.py"
    spec = importlib.util.spec_from_file_location("coc_validate", path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)

    assert module.validate_rules(PLUGIN_ROOT) == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_plugin_metadata.py::test_validate_rules_script_accepts_seed_rules -v`

Expected: FAIL because `coc_validate.py` does not exist.

- [ ] **Step 3: Implement minimal `coc_validate.py`**

Check that the rules JSON directory exists and required V1 files are valid JSON:

```python
REQUIRED_RULE_FILES = [
    "metadata.json",
    "damage-bonus-build.json",
    "success-levels.json",
    "difficulty-levels.json",
    "sanity.json",
]
```

For campaign validation, check required subdirectories: `save`, `scenario`, `index`, `memory`, `logs`, and `snapshots`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_plugin_metadata.py::test_validate_rules_script_accepts_seed_rules -v`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/coc-keeper/scripts/coc_validate.py tests/test_plugin_metadata.py
git commit -m "feat: add coc validation helpers"
```

---

### Task 9: Add V1 Skill Instructions

**Files:**
- Create: `plugins/coc-keeper/skills/coc-main/SKILL.md`
- Create: `plugins/coc-keeper/skills/coc-campaign-state/SKILL.md`
- Create: `plugins/coc-keeper/skills/coc-rules-engine/SKILL.md`
- Create: `plugins/coc-keeper/skills/coc-character/SKILL.md`
- Create: `plugins/coc-keeper/skills/coc-scenario-import/SKILL.md`
- Create: `plugins/coc-keeper/skills/coc-keeper-play/SKILL.md`
- Create: `plugins/coc-keeper/skills/coc-meta/SKILL.md`
- Create: `plugins/coc-keeper/skills/coc-playtest/SKILL.md`
- Create: `plugins/coc-keeper/skills/coc-combat/SKILL.md`
- Create: `plugins/coc-keeper/skills/coc-chase/SKILL.md`
- Create: `plugins/coc-keeper/skills/coc-sanity/SKILL.md`
- Create: `plugins/coc-keeper/skills/coc-mythos-reference/SKILL.md`
- Test: `tests/test_plugin_metadata.py`

**Interfaces:**
- Produces: valid skill frontmatter with `name` and `description`.
- Consumed by: Codex skill discovery.

- [ ] **Step 1: Write failing skill metadata test**

Add to `tests/test_plugin_metadata.py`:

```python
def test_all_v1_skills_have_valid_frontmatter():
    expected = {
        "coc-main",
        "coc-campaign-state",
        "coc-rules-engine",
        "coc-character",
        "coc-scenario-import",
        "coc-keeper-play",
        "coc-meta",
        "coc-playtest",
        "coc-combat",
        "coc-chase",
        "coc-sanity",
        "coc-mythos-reference",
    }
    found = set()
    for skill_path in (PLUGIN_ROOT / "skills").glob("*/SKILL.md"):
        text = skill_path.read_text()
        assert text.startswith("---\\n")
        header = text.split("---", 2)[1]
        name_line = next(line for line in header.splitlines() if line.startswith("name: "))
        description_line = next(line for line in header.splitlines() if line.startswith("description: "))
        name = name_line.split(": ", 1)[1].strip()
        description = description_line.split(": ", 1)[1].strip()
        assert name == skill_path.parent.name
        assert len(description) > 40
        found.add(name)
    assert found == expected
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_plugin_metadata.py::test_all_v1_skills_have_valid_frontmatter -v`

Expected: FAIL because skill files are missing.

- [ ] **Step 3: Create skill files**

Create each `SKILL.md` with concise instructions:

- `coc-main`: activation, routing, exit, spoiler discipline.
- `coc-campaign-state`: `.coc/` layout, reusable investigator library, logs, snapshots.
- `coc-rules-engine`: use rules JSON and scripts for common calculations.
- `coc-character`: full and quick investigator creation.
- `coc-scenario-import`: PDF catalog, scenario skeleton, source map, Keeper-only split.
- `coc-keeper-play`: immersive play loop.
- `coc-meta`: out-of-character questions and ruling challenges.
- `coc-playtest`: isolated simulated-player testing and report generation.
- `coc-combat`: V1 combat state and common actions.
- `coc-chase`: V1 chase state and movement exchange.
- `coc-sanity`: SAN roll and basic insanity thresholds.
- `coc-mythos-reference`: monsters, spells, tomes, artifacts, and spoiler-safe references.

Each skill body must mention relevant scripts or references by relative path when used.

- [ ] **Step 4: Run skill frontmatter test**

Run: `pytest tests/test_plugin_metadata.py::test_all_v1_skills_have_valid_frontmatter -v`

Expected: PASS.

- [ ] **Step 5: Run skill creator validation**

Run:

```bash
for skill in plugins/coc-keeper/skills/*; do
  python3 /Users/haoli/.codex/skills/.system/skill-creator/scripts/quick_validate.py "$skill"
done
```

Expected: each invocation exits 0.

- [ ] **Step 6: Commit**

```bash
git add plugins/coc-keeper/skills tests/test_plugin_metadata.py
git commit -m "feat: add coc keeper skills"
```

---

### Task 10: Add Reference Protocol Documents

**Files:**
- Create: `plugins/coc-keeper/references/mode-protocol.md`
- Create: `plugins/coc-keeper/references/state-schema.md`
- Create: `plugins/coc-keeper/references/rules-json-guide.md`
- Test: `tests/test_plugin_metadata.py`

**Interfaces:**
- Produces: references loaded by skills on demand.
- Consumed by: `coc-main`, `coc-campaign-state`, and `coc-rules-engine`.

- [ ] **Step 1: Write failing reference test**

Add to `tests/test_plugin_metadata.py`:

```python
def test_reference_documents_exist_and_use_ascii_system_markers():
    reference_names = ["mode-protocol.md", "state-schema.md", "rules-json-guide.md"]
    for name in reference_names:
        path = PLUGIN_ROOT / "references" / name
        assert path.exists()
        text = path.read_text()
        assert "[meta]" in text or name != "mode-protocol.md"
        assert "[spoiler_warning]" in text or name != "mode-protocol.md"
        for marker in ["[超游]", "[剧透警告]", "[回到游戏]"]:
            assert marker not in text
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_plugin_metadata.py::test_reference_documents_exist_and_use_ascii_system_markers -v`

Expected: FAIL because references are missing.

- [ ] **Step 3: Create references**

Create `mode-protocol.md` with:

- passive activation phrases
- exit phrases
- `[in_game]`, `[meta]`, `[spoiler_warning]`, `[system_note]`
- Keeper role and player role
- no non-ASCII machine markers

Create `state-schema.md` with:

- `.coc/investigators/`
- `.coc/campaigns/`
- `.coc/playtests/`
- reusable investigator versus campaign temporary state
- logs and snapshots

Create `rules-json-guide.md` with:

- rules JSON as runtime authority
- PDF as source/reference
- V1 rule files and key names

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_plugin_metadata.py::test_reference_documents_exist_and_use_ascii_system_markers -v`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/coc-keeper/references/mode-protocol.md plugins/coc-keeper/references/state-schema.md plugins/coc-keeper/references/rules-json-guide.md tests/test_plugin_metadata.py
git commit -m "docs: add coc keeper protocol references"
```

---

### Task 11: Final Validation

**Files:**
- Modify only if validation finds a concrete failure in files from earlier tasks.
- Test: all tests and plugin validations.

**Interfaces:**
- Consumes: all prior tasks.
- Produces: validated V1 playable-kernel foundation.

- [ ] **Step 1: Run full test suite**

Run: `pytest -v`

Expected: all tests PASS.

- [ ] **Step 2: Run plugin validation**

Run:

```bash
python3 /Users/haoli/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py plugins/coc-keeper
```

Expected: exit 0.

- [ ] **Step 3: Run skill validation**

Run:

```bash
for skill in plugins/coc-keeper/skills/*; do
  python3 /Users/haoli/.codex/skills/.system/skill-creator/scripts/quick_validate.py "$skill"
done
```

Expected: every command exits 0.

- [ ] **Step 4: Run whitespace check**

Run: `git diff --check`

Expected: exit 0.

- [ ] **Step 5: Commit final fixes if any**

If validation required edits:

```bash
git add plugins tests
git commit -m "chore: validate coc keeper v1 foundation"
```

If no edits were needed, do not create an empty commit.

## Self-Review

Spec coverage:

- Passive activation is covered by `coc-main` and `mode-protocol.md`.
- Rules JSON authority is covered by Task 2 and `rules-json-guide.md`.
- Python deterministic helpers are covered by Tasks 2 through 8.
- Reusable investigators and campaign state are covered by Task 5 and `state-schema.md`.
- Scenario PDF catalog and skeleton import are covered by Task 6.
- Playtest reporting is covered by Task 7 and `coc-playtest`.
- Skills are covered by Task 9.
- Plugin validation is covered by Tasks 1 and 11.

Placeholder scan:

- The plan contains no open placeholder tokens or undefined future work markers.
- Each code-producing task includes test-first steps and exact verification commands.

Type consistency:

- Script functions referenced by tests match the interfaces listed in each task.
- The plugin root is consistently `plugins/coc-keeper`.
- The runtime state root is consistently `.coc/`.
