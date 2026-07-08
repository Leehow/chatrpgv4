# W5 Task 3 Report: P2-4' — 跨模块 API 索引

## Status
COMPLETE

## Commit
Commit directly on `release/0.15-alpha` (no feature branch).
- Message: `feat(coc): cross-module helper API index (P2-4')`
- Files: 4 changed — `plugins/coc-keeper/scripts/coc_api.py` (new), `plugins/coc-keeper-zcode/scripts/coc_api.py` (new, synced), `tests/test_api.py` (new), `.superpowers/sdd/w5-t3-report.md` (this file).
- Hash: recorded post-commit in the "Commit hash" section below (the hash is fixed once the commit is created; embedding it before committing would change it via amend, so it is read back after the commit lands).

## What was done
Created `plugins/coc-keeper/scripts/coc_api.py` with `api_index()` — a single discovery point that aggregates coc_roll's `public_api_index()` (5 roll helpers) and a curated `coc_rules` public-fn section (6 rules helpers), for a total of 11 entries.

### Implementation
- `_load_optional_sibling(name, filename)` mirrors the pattern in `coc_narrative_enrichment.py`: loads a sibling script via importlib only if its file exists; returns `None` otherwise. Wrapped in `try/except` so a sibling that fails to import (e.g. missing data files in a stripped runtime) is also treated as absent rather than crashing discovery.
- Module-level `coc_roll` and `coc_rules` are loaded via this helper at import time.
- `coc_rules_public_index()` — static descriptive surface listing the 6 curated rules fns (`half_value`, `fifth_value`, `difficulty_target`, `damage_bonus_build`, `movement_rate`, `success_level`) with hand-authored `{aliases, signature, returns}` entries matching the real signatures in `coc_rules.py`. Defined inline in `coc_api.py` (not as a method on `coc_rules`) so it stays available even when `coc_rules` cannot be loaded; this satisfies the brief's "or inline in coc_api" option and avoids mutating `coc_rules.py`.
- `api_index()` — aggregates both tracks. Roll section sourced from `coc_roll.public_api_index()` (when coc_roll loadable + has the attribute + call succeeds); rules section sourced from `coc_rules_public_index()` **but only surfaced when `coc_rules` is actually loadable** (so the index reflects what is *callable*, not just descriptive). When a sibling is absent, its section is omitted — the function never raises for a missing sibling. When both are absent, returns `{}`.

### Entry shape
Every entry mirrors coc_roll.public_api_index's shape:
```
{name: {"aliases": list[str], "signature": str, "returns": str}}
```

## Tests (TDD)
7 new tests in `tests/test_api.py` (module var `coc_api`, loaded via importlib like the other test modules):

1. `test_api_index_aggregates_roll_and_rules_helpers` — asserts both roll entries (`percentile_check` with `roll_percentile` alias, `format_percentile_result`, `roll_expression`) and rules entries (`half_value`, `fifth_value`, `difficulty_target`, `damage_bonus_build`, `movement_rate`, `success_level`) are present.
2. `test_api_index_entries_have_aliases_signature_returns_shape` — every entry is a dict with `aliases` (list), `signature` (str), `returns` (str).
3. `test_api_index_rules_signatures_are_accurate` — rules signatures contain the function name.
4. `test_coc_rules_public_index_lists_six_rules_helpers` — the curated helper returns exactly the 6 expected rules fns with correct entry shape.
5. `test_api_index_is_robust_when_coc_roll_absent` — monkeypatch `coc_roll=None`; rules section still present, roll section absent.
6. `test_api_index_is_robust_when_coc_rules_absent` — monkeypatch `coc_rules=None`; roll section still present, rules section absent.
7. `test_api_index_is_robust_when_both_siblings_absent` — both `None` → returns `{}`.

TDD cycle: wrote tests first → confirmed red (FileNotFoundError: coc_api.py missing) → implemented → confirmed green (7 passed).

## Test summary
- New `coc_api` tests: 7 passed, 0 failed.
- Full suite: 1097 passed (1090 prior baseline + 7 new), 0 failed.
- `tests/test_coc_plugin_sync_script.py`: 4 passed (sync `--check` reports "plugin copies are in sync").

## Dual-track sync
- `plugins/coc-keeper/scripts/coc_api.py` (canonical, Codex) created.
- `scripts/sync_coc_plugin_copy.py` run; `--check` reports "plugin copies are in sync".
- `diff` of the two `coc_api.py` copies: IDENTICAL.
- `coc_api.py` is not in `INTENTIONAL_PLATFORM_DRIFT_FILES`, so the two copies must stay byte-identical — confirmed.

## Self-review
- [x] `api_index()` aggregates roll + rules helpers (5 + 6 = 11 entries).
- [x] Robust to optional-sibling absence (3 robustness tests; never raises; degrades to available section, or `{}`).
- [x] Entry shape mirrors coc_roll.public_api_index (`{aliases, signature, returns}`).
- [x] `coc_rules_public_index()` helper added (inline in coc_api, per brief's "or inline in coc_api" option).
- [x] Dual-track synced (canonical created, zcode propagated via sync script, `--check` clean, byte-identical).

## Files
- Created: `plugins/coc-keeper/scripts/coc_api.py` (canonical).
- Synced: `plugins/coc-keeper-zcode/scripts/coc_api.py` (byte-identical).
- Tests: `tests/test_api.py` (7 new tests).
- Report: `.superpowers/sdd/w5-t3-report.md` (this file).

## Concerns
- None blocking.
- Design note: `coc_rules_public_index()` is a static descriptive list authored by hand (signatures match the real `coc_rules.py` functions). It does not introspect `coc_rules` at runtime, so if a rules fn signature changes, this index must be updated manually. This is the same approach `coc_roll.public_api_index()` uses (hand-authored signature strings), so it is consistent with the existing convention. A future task could add a smoke test that calls each indexed fn to catch signature drift, but that is out of scope for P2-4'.
- The rules section is only surfaced in `api_index()` when `coc_rules` is loadable (callable check), while `coc_rules_public_index()` itself is always available as a descriptive surface. This split is intentional: the descriptive helper lets a caller discover the *intended* API even in a stripped runtime, while the aggregated index reflects what is *actually callable*. Documented in the module docstring and inline comments.
- Pre-existing unrelated drift: `.superpowers/sdd/task-1-report.md` and `task-2-report.md` had uncommitted modifications before this task began (from earlier W5 work). These were left untouched and are NOT included in this commit; only W5-T3 files are staged.
