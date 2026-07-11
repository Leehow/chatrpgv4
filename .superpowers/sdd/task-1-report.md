# Task 1 Report: Canonical structured player turns and deterministic replay seeds

## Status

DONE

Baseline: `c0050886a58c4c6ccbec61bdf01390a7eea17205`

## Implemented contract

- Extended the public SDK and session entry point to accept
  `player_intent` and one-turn `rng_seed` keyword arguments.
- Added strict, non-semantic validation for the exact eight-field public intent
  shape. Primary intent uses the runtime enum that is contract-tested against
  the canonical intent router. Risk posture, booleans, string lists, JSON-only
  action atoms/NPC interactions, missing fields, and unknown fields fail closed.
- Added exact seed validation: only plain, non-boolean `int` and `str` values
  are accepted; values are forwarded without coercion and are not stored in
  session metadata.
- Forwarded caller intent as both `intent_class` and `player_intent_rich`, so
  the live runtime records `source == "caller_intent_class"` and consumes the
  structured action atoms without classifying player prose.
- Recorded `rng_seed` directly in each applicable `live_turn_runtime` receipt
  while the runner still holds the campaign lock. This avoids a racy session-
  layer rewrite and does not put the seed in returned Events or narration.
- Documented the JSON-equivalent one-turn input contract in `PROTOCOL.md`.

The runner received a two-line, Task-1-specific extension beyond the original
five-file brief so seed-to-receipt association remains atomic and machine-
verifiable. The lead explicitly approved this narrow expansion.

## TDD evidence

RED command:

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest \
  tests/test_runtime_sdk_debug.py \
  tests/test_runtime_session_lifecycle.py \
  -q -p no:cacheprovider
```

Observed before production changes: `27 failed, 46 passed`. Failures were the
expected missing `send()` keywords and missing private validators.

GREEN evidence after implementation:

- SDK/session contract: `73 passed` (16 existing legacy-config deprecation warnings).
- Live runner + intent router: `79 passed`.
- Required plugin metadata check: `48 passed`.
- `git diff --check`: clean.

The SDK tests cover structured investigate and social turns, exact receipt
provenance/seed, absence of the seed from player-visible Events, deterministic
roll payload replay from identical pre-turn snapshots, and rejection before
campaign mutation. Validator tests cover accepted exact values, deep-copy
isolation, all public field types, exact field sets, non-JSON values, non-finite
numbers, booleans, collections, and non-exact scalar seeds.

## Files changed

- `runtime/sdk/api.py`
- `runtime/engine/session.py`
- `runtime/protocol/PROTOCOL.md`
- `plugins/coc-keeper/scripts/coc_live_turn_runner.py`
- `tests/test_runtime_sdk_debug.py`
- `tests/test_runtime_session_lifecycle.py`
- `.superpowers/sdd/task-1-report.md`

## Self-review and concerns

- No free-text keyword matching or prose-derived intent behavior was added.
- Omitted seeds retain the runner's existing time-based production entropy;
  the receipt records `null` rather than exposing the generated entropy.
- No seed or structured receipt metadata enters player-visible narration.
- No push, deploy, destructive Git operation, or unrelated refactor was done.
- Concerns: none. The warning-only focused output comes from the pre-existing
  legacy `runtime.json` fixtures and is unrelated to this change.
