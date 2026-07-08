# Task 2 Report: rule-index 登记 + REQUIRED_RULE_FILES

## Status
✅ COMPLETE — all steps passed, committed on `feat/starter-scenario-the-white-war`.

## Files Changed
- `plugins/coc-keeper/references/rules-json/rule-index.json` — appended 6 `module.white_war.*` entries at the end of the `rules` array (after `core.healing.treatment`), matching the field structure (`id`/`category`/`module`/`source_table`/`source_note`/`numeric`) of the existing `module.haunting.*` entries.
- `plugins/coc-keeper/scripts/coc_validate.py` — added `"the-white-war.json",` to `REQUIRED_RULE_FILES`, immediately after `"the-haunting.json"` (line 35).
- `tests/test_white_war_rules.py` — appended 3 new tests from the brief (Step 1).

## Commit
- `ab16f31` — `feat(coc): register module.white_war.* rules in rule-index and REQUIRED_RULE_FILES` (3 files, +109 lines)

## TDD Evidence

### RED (Step 2) — before implementation
Command:
```
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/test_white_war_rules.py -q -p no:cacheprovider
```
Result: **2 failed, 6 passed**
- `test_rule_index_contains_white_war_entries` — FAILED: `rule-index 缺少: {'module.white_war.conclusion_sanity_rewards', 'module.white_war.polyp_horror', 'module.white_war.lethality_vs_semi_material', 'module.white_war.daylight_penalty', 'module.white_war.cold_exposure', 'module.white_war.avalanche_damage'}`
- `test_required_rule_files_includes_white_war` — FAILED: `assert 'the-white-war.json' in [...REQUIRED_RULE_FILES...]`
- (`test_rule_index_white_war_entries_have_correct_source_table` passed vacuously because no white_war entries existed yet — correct TDD baseline.)

### GREEN (Step 5) — after implementation
Command:
```
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/test_white_war_rules.py -q -p no:cacheprovider
```
Result: **8 passed, 1 warning** ✅
(The single warning is a pre-existing `SyntaxWarning: invalid escape sequence '\.'` in the docstring of `test_rule_ids_all_lowercase_dotted` from Task 1 — unrelated to this task.)

### JSON validity (before commit)
Command:
```
python3 -c "import json; json.load(open('plugins/coc-keeper/references/rules-json/rule-index.json'))"
```
Result: `JSON VALID` ✅

### coc_validate CLI (Step 6)
Command:
```
PYTHONDONTWRITEBYTECODE=1 python3 plugins/coc-keeper/scripts/coc_validate.py rules plugins/coc-keeper
```
Result: **no output, exit code 0** — 0 errors ✅ (id regex, uniqueness, source_table existence, and REQUIRED_RULE_FILES coverage all satisfied).

## Concerns
None. The 6 entries were added verbatim from the brief; field order and indentation match the surrounding `module.haunting.*` / `core.*` template. Pre-existing unrelated `SyntaxWarning` noted but out of scope.

---

# Task 2 Report: Generic Failure Routing and Psychology Reliability

## Status
✅ COMPLETE — implemented on `codex/director-orchestration-hardening`.

## Files Changed
- `plugins/coc-keeper/scripts/coc_director_apply.py` — added `_first_failed_contract_result(...)` and generic non-clue failure routing backfill that consumes `roll_contract` while preserving existing clue-specific and recovery precedence.
- `plugins/coc-keeper/scripts/coc_rule_signals.py` — expanded `read_psychology_concealed(...)` to emit reliability metadata and explicit "uncertain, not inverted truth" guidance on failure.
- `tests/test_director_apply.py` — appended the required RED/GREEN regression for failed non-clue roll routing.
- `tests/test_rules.py` — appended the required RED/GREEN regression for Psychology concealed-read reliability.

## TDD Evidence

### RED (before implementation)
Command:
```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest \
  tests/test_director_apply.py::test_backfill_failed_non_clue_roll_adds_failure_routing \
  tests/test_rules.py::test_psychology_concealed_failure_returns_uncertain_read_not_false_truth \
  -q -p no:cacheprovider
```

Result: **2 failed**
- `test_backfill_failed_non_clue_roll_adds_failure_routing` — `KeyError: 'failure_consequence'`
- `test_psychology_concealed_failure_returns_uncertain_read_not_false_truth` — `KeyError: 'reliability'`

This matches the briefed expected failure mode: generic non-clue failure routing was absent, and Psychology concealed reads did not expose reliability fields yet.

### GREEN (after implementation)
Command:
```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest \
  tests/test_director_apply.py::test_backfill_failed_non_clue_roll_adds_failure_routing \
  tests/test_rules.py::test_psychology_concealed_failure_returns_uncertain_read_not_false_truth \
  -q -p no:cacheprovider
```

Result: **2 passed** ✅

### Guard Verification (existing precedence still intact)
Commands:
```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest \
  tests/test_director_apply.py::test_backfill_rule_results_failure_prunes_exact_clue_anchor \
  tests/test_director_apply.py::test_backfill_rule_results_recover_marks_fallback_as_in_world_recovery \
  tests/test_director_apply.py::test_backfill_failed_non_clue_roll_adds_failure_routing \
  -q -p no:cacheprovider
```

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest \
  tests/test_rules.py::test_psychology_concealed_failure_returns_uncertain_read_not_false_truth \
  -q -p no:cacheprovider
```

Results:
- Director apply subset: **3 passed** ✅
- Rules subset: **1 passed** ✅

These checks confirm the clue-specific failure path still wins over the new generic fallback, and the new Psychology semantics behave as required.

## Self-Review
- Kept the generic failure routing behind existing `failure_event` and recovery precedence, so obscured-clue withholding behavior remains authoritative.
- Reused `roll_contract` already attached to results/requests instead of introducing keyword heuristics or new schema.
- Limited behavior change to the allowed Codex track only; no ZCode copy edits, no unrelated file churn, and no interaction with the pre-existing dirty `AGENTS.md`.

## Concerns
None.
