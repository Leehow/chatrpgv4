# Task 1 Report: Roll Contract Normalization

## Scope

- Task: `Task 1: Roll Contract Normalization`
- Requirements source: `/Users/haoli/leehow/code/chatrpgv4-zcode/.superpowers/sdd/task-1-brief.md`
- Branch: `codex/director-orchestration-hardening`
- Base commit: `f6b947940178235473326e269bef028398f826ca`
- Constraint honored: modified only the Codex plugin track; did not edit `plugins/coc-keeper-zcode/`
- Constraint honored: did not modify, stage, or include `AGENTS.md`

## TDD Evidence

### RED tests added

Added the exact tests requested by the brief:

- `tests/test_story_director.py::test_obscured_clue_rules_request_includes_roll_contract`
- `tests/test_narrative_enrichment.py::test_action_atom_requests_include_roll_contract`
- `tests/test_playtest_driver.py::test_driver_roll_payload_preserves_roll_contract`

### RED command

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest \
  tests/test_story_director.py::test_obscured_clue_rules_request_includes_roll_contract \
  tests/test_narrative_enrichment.py::test_action_atom_requests_include_roll_contract \
  tests/test_playtest_driver.py::test_driver_roll_payload_preserves_roll_contract \
  -q -p no:cacheprovider
```

Observed failure:

- 3 tests failed
- Expected failure mode matched the brief: `KeyError: 'roll_contract'`

### GREEN implementation

Implemented the minimal scoped changes required to make the new tests pass:

- Added `_roll_contract(...)` helper in `plugins/coc-keeper/scripts/coc_story_director.py`
- Attached `roll_contract` to director-generated roll-facing requests:
  - obscured clue `skill_check`
  - scene/subsystem `sanity_check`
  - danger `opposed_check`
  - death-clock `characteristic_check`
- Added `_atom_roll_contract(...)` in `plugins/coc-keeper/scripts/coc_narrative_enrichment.py`
- Attached `roll_contract` to action-atom-derived requests
- Preserved `roll_contract` in driver roll payloads, including SAN auto-settlement

### GREEN command

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest \
  tests/test_story_director.py::test_obscured_clue_rules_request_includes_roll_contract \
  tests/test_narrative_enrichment.py::test_action_atom_requests_include_roll_contract \
  tests/test_playtest_driver.py::test_driver_roll_payload_preserves_roll_contract \
  -q -p no:cacheprovider
```

Observed result:

- 3 tests passed

## Files Changed

- `plugins/coc-keeper/scripts/coc_story_director.py`
- `plugins/coc-keeper/scripts/coc_narrative_enrichment.py`
- `plugins/coc-keeper/scripts/coc_playtest_driver.py`
- `tests/test_story_director.py`
- `tests/test_narrative_enrichment.py`
- `tests/test_playtest_driver.py`

## Tests Run

### Required task tests

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest \
  tests/test_story_director.py::test_obscured_clue_rules_request_includes_roll_contract \
  tests/test_narrative_enrichment.py::test_action_atom_requests_include_roll_contract \
  tests/test_playtest_driver.py::test_driver_roll_payload_preserves_roll_contract \
  -q -p no:cacheprovider
```

- RED: `3 failed` with expected `KeyError: 'roll_contract'`
- GREEN: `3 passed`

### Focused regression suite

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest \
  tests/test_story_director.py \
  tests/test_narrative_enrichment.py \
  tests/test_playtest_driver.py \
  -q -p no:cacheprovider
```

- Result: `78 passed`

### Project-required plugin checks

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest \
  tests/test_plugin_metadata.py tests/test_zcode_plugin_metadata.py tests/test_coc_plugin_sync_script.py \
  -q -p no:cacheprovider
python3 scripts/sync_coc_plugin_copy.py --check
```

Observed result:

- `tests/test_plugin_metadata.py`: passed
- `tests/test_zcode_plugin_metadata.py`: failed because Codex/ZCode copies now differ in:
  - `scripts/coc_narrative_enrichment.py`
  - `scripts/coc_playtest_driver.py`
  - `scripts/coc_story_director.py`
- `tests/test_coc_plugin_sync_script.py`: failed because `scripts/sync_coc_plugin_copy.py --check` reports the same drift

This failure is expected under the current controller instruction for this task:
implement only in the Codex track now and do not edit the ZCode copy during this task.

## Self-Review

- Scope stayed within the owned implementation/test files plus the required task report file.
- The new behavior is normalized around structured `roll_contract` payloads only.
- No keyword-based semantic classification was added.
- Driver propagation is pass-through only; no extra rule behavior was introduced.
- `AGENTS.md` remained untouched and unstaged.
- Residual concern: repository-level dual-track sync checks remain red until the controller performs the later Codex→ZCode sync step.

## Critical Finding Fix

### Finding

Review found that runtime director still fell back to legacy clue delivery inference without emitting any warning when a revealed critical clue lacked structured `delivery_kind`.

### Root Cause

- `_resolve_clue_delivery(...)` already supported compatibility fallback from missing `delivery_kind` to legacy `delivery` string inference.
- `_select_clue_policy(...)` consumed that fallback result but dropped the fact that compatibility inference had been used.
- Result: runtime plans had no structured audit trail for critical clues that relied on legacy delivery inference.

### RED test added

- `tests/test_story_director.py::test_critical_legacy_delivery_fallback_emits_warning`

This test asserts that a `REVEAL` plan built from the minimal critical clue graph includes:

- `plan["clue_policy"]["delivery_warnings"]`
- warning reason text containing `legacy delivery`
- warning reason text containing the selected clue id `clue-1`

### RED command

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest \
  tests/test_story_director.py::test_obscured_clue_rules_request_includes_roll_contract \
  tests/test_story_director.py::test_critical_legacy_delivery_fallback_emits_warning \
  tests/test_narrative_enrichment.py::test_action_atom_requests_include_roll_contract \
  tests/test_playtest_driver.py::test_driver_roll_payload_preserves_roll_contract \
  -q -p no:cacheprovider
```

Observed failure:

- `test_critical_legacy_delivery_fallback_emits_warning` failed with `KeyError: 'delivery_warnings'`
- Other focused Task 1 tests still passed

### Fix implemented

Scoped changes:

- Added `_find_clue_conclusion(...)` in `plugins/coc-keeper/scripts/coc_story_director.py`
- Extended `_select_clue_policy(...)` to emit `delivery_warnings` when:
  - a clue is selected for `REVEAL`
  - its clue record lacks structured `delivery_kind`
  - its parent conclusion has `importance == "critical"`

Warning payload is audit-only and structured:

- `clue_id`
- `reason`
- `fallback_mode`

No gameplay branching or new keyword-based decision logic was added.

### GREEN command

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest \
  tests/test_story_director.py::test_obscured_clue_rules_request_includes_roll_contract \
  tests/test_story_director.py::test_critical_legacy_delivery_fallback_emits_warning \
  tests/test_narrative_enrichment.py::test_action_atom_requests_include_roll_contract \
  tests/test_playtest_driver.py::test_driver_roll_payload_preserves_roll_contract \
  -q -p no:cacheprovider
```

Observed result:

- `4 passed`

### Files changed for this fix

- `plugins/coc-keeper/scripts/coc_story_director.py`
- `tests/test_story_director.py`
- `.superpowers/sdd/task-1-report.md`
