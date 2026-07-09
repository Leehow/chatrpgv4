# W5 Task 1 Report: P2-1 — 奖励骰展示十位/个位分量

> Status: COMPLETE
> Commit: see git log on branch `feat/w5-t1-percentile-breakdown`
> Approach: TDD (red → green), canonical-first single-track sync.

## Summary

`format_percentile_result` now shows the tens/units breakdown by default for a
plain percentile roll (no bonus/penalty dice), so the player sees how the roll
composed. A `compact=True` opt-out preserves the old minimal form.

- Before: `format_percentile_result(roll=47, ...)` → `"47/50，成功"`
- After (default): `"47/50 = 十位 4 个位 7，成功"`
- After (`compact=True`): `"47/50，成功"` (unchanged old form)

## Signature change

```python
# Before
def format_percentile_result(result: dict[str, Any], *, language: str = "zh-Hans") -> str:

# After
def format_percentile_result(
    result: dict[str, Any],
    *,
    language: str = "zh-Hans",
    compact: bool = False,
) -> str:
```

`compact` is keyword-only, defaults to `False` (breakdown shown). Existing
callers that do not pass `compact` are unaffected in call shape; only their
default output for no-modifier rolls changes from minimal to breakdown form.

Note on the brief: the brief's "REAL state" line sketched the signature as
positional `(roll, target, outcome, *, tens_values=None, ...)`. Reading the
actual code confirmed the real signature takes a single `result: dict` plus
keyword-only `language`. The implementation keeps the dict-based signature
(matching existing callers and tests) rather than inventing positional args.

## Derivation

For a plain roll, `percentile_check` returns `tens_values=[]` and
`units=None` (no dice were rolled individually — the roll came from
`rng.randint(1, 100)`). The breakdown is therefore derived from `roll`:

- `tens_digit = roll // 10`
- `units_digit = roll % 10`

Edge cases verified: roll=1 → tens 0, units 1; roll=100 (valid fumble band,
`zero_zero_result=100`) → tens 10, units 0; roll=50 → tens 5, units 0.

## Files

- `plugins/coc-keeper/scripts/coc_roll.py` (canonical): `format_percentile_result`
  restructured; `public_api_index` signature string updated to
  `format_percentile_result(result, language='zh-Hans', compact=False)`.
- `plugins/coc-keeper/scripts/coc_roll.py` (Codex track): synced via
  `scripts/sync_coc_plugin_copy.py`; byte-identical to canonical.
- `tests/test_roll.py`: +5 tests (breakdown default, roll=100 tens derivation,
  compact zh, compact en, breakdown en).

## Branches

- The opaque branch (`not tens_values or units is None or (bonus == 0 and penalty == 0)`)
  is restructured: `compact=True` returns the old minimal form; otherwise it
  derives and shows the breakdown.
- The bonus/penalty branch (lines 202-216 in the new file) is **unchanged**
  byte-for-byte. `test_format_percentile_result_shows_bonus_die_components` and
  `test_format_percentile_result_shows_penalty_die_components` still pass.

## Test summary

```
tests/test_roll.py: 17 passed (12 prior + 5 new)
Full suite: 1087 passed
Sync: plugin copies are in sync
Metadata/sync tests: 77 passed (test_roll + test_playtest_report + test_coc_plugin_sync_script + test_plugin_metadata + test_codex_plugin_metadata)
```

New tests:
- `test_format_percentile_result_shows_tens_units_breakdown_without_modifiers`
- `test_format_percentile_result_breakdown_derives_tens_digit_for_double_digit_roll`
- `test_format_percentile_result_compact_opt_out_preserves_minimal_form`
- `test_format_percentile_result_compact_opt_out_english`
- `test_format_percentile_result_breakdown_english`

## Callers

Only runtime caller: `coc_playtest_report.py:336`
`format_percentile_result(payload, language=play_language)`. That call site is
guarded by `if (payload.get("bonus") or payload.get("penalty")) and
payload.get("tens_values") and payload.get("units") is not None`, so it only
fires for bonus/penalty rolls — which take the unchanged bonus/penalty branch.
No behavior change for the playtest report path. `test_playtest_report.py`
still passes (its no-modifier roll fixtures go through the Mechanical Log
formatter, not `format_percentile_result`).

## Self-review

- [x] no-modifier roll shows tens/units breakdown by default.
- [x] `compact=True` preserves old minimal form (zh + en).
- [x] bonus/penalty branch unchanged (byte-for-byte; tests still pass).
- [x] Single-track Codex (canonical edited, codex propagated via sync script,
      `--check` clean, tracks byte-identical).
- [x] `public_api_index` signature string updated to reflect `compact=False`.

## Concerns / notes

- The default output for no-modifier rolls **changed** (minimal → breakdown).
  This is the intended P2-1 fix. Any external consumer that string-matched the
  old minimal form for a no-modifier roll and did not opt into `compact=True`
  will see the new breakdown. Within this repo, no test or caller depended on
  the old minimal no-modifier form (verified by full-suite green).
- `compact` is additive and backwards-compatible at the call site (keyword-only,
  defaulted). No caller needed updating.
- The brief's example call used positional args (`format_percentile_result(47,
  50, "regular success", ...)`); the real API is dict-based, so the TDD tests
  build a `result` dict as real callers do. This matches `percentile_check`'s
  return shape and the existing bonus/penalty tests.
