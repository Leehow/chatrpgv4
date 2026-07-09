# T1 — Clue-graph schema changes + director `_resolve_clue_delivery` + validator warnings

**Status:** ✅ Complete
**Branch:** `codex/source-refs-delivery`
**Commit:** see `git log` (committed below)
**Date:** 2026-07-05

## What was done

Added structured clue-delivery fields (`delivery_kind` / `skill` / `difficulty` /
`player_safe_summary` / `source_refs`) so the story director reads structured data
instead of guessing from the free-text `delivery` string — while keeping full
backward compatibility (old clue-graphs without these fields still work via the
heuristic fallback).

### Code changes

**`coc_story_director.py`**
- New `_find_clue(clue_id, clue_graph)` helper.
- New `_resolve_clue_delivery(clue_id, clue_graph) -> (clue_type, skill, difficulty)`
  resolver. Priority: (1) structured `delivery_kind` field, (2) fallback to the
  existing `_infer_clue_type` string heuristic (kept as the fallback for old
  clue-graphs). `delivery_kind=skill_check` → obscured + skill/difficulty;
  `obvious`/`handout`/`npc_dialogue`/`environmental` → obvious.
- `_select_clue_policy` now calls the resolver and stashes `skill` / `difficulty`
  into the returned `clue_policy` dict.
- `_build_rules_requests` REVEAL branch now reads skill + difficulty from
  `clue_policy` instead of hardcoding Spot Hidden / regular. Falls back to
  `Spot Hidden` / `regular` when the legacy heuristic was used or skill omitted.
- `_collect_anchors` now reads `player_safe_summary` (preferred) and falls back
  to the legacy `player_visible_anchor`.

**`coc_scenario_compile.py`**
- New **warnings** (NOT errors, for backward compat) inside `validate_scenario`:
  - clue `delivery_kind=skill_check` without `skill`
  - malformed `source_refs` (missing `path` or non-integer `page`) on clues,
    scenes, npcs, and fronts.
- Consolidated a duplicate `clue_graph = _read(...)` read into a single read.
  `fronts_data` is now read once and reused.

**`story-graph-schema.md`** (both plugins)
- Documented all new optional clue fields with values + semantics.
- Added a backward-compat note: all new fields optional; old clue-graphs still
  validate cleanly.
- New full example showing structured delivery + source_refs.
- New `source_refs` subsection documenting the optional field on scenes/npcs/fronts.

### Tests added (11 new, 557 → 568 total)

**`tests/test_story_director.py`** (4 new)
- `test_resolve_delivery_structured_skill_check` — skill_check → obscured + skill + hard difficulty flows into rules_requests.
- `test_resolve_delivery_structured_obvious` — handout → obvious, no rules request, `player_safe_summary` lands in must_include.
- `test_resolve_delivery_fallback_when_no_delivery_kind` — old clue-graph → heuristic fallback still obscured.
- `test_resolve_delivery_skill_check_missing_skill_defaults_spot_hidden` — skill_check without skill → falls back to Spot Hidden / regular.

**`tests/test_scenario_compile.py`** (7 new)
- skill_check-without-skill warning.
- clue source_ref missing page / non-integer page warnings.
- scene / npc / front source_ref malformed warnings.
- well-formed source_refs → no warnings.
- old clue-graph without structured fields → no warnings (backward compat).

## Test results

- Targeted: `pytest tests/test_story_director.py tests/test_scenario_compile.py -v` → **44 passed**.
- Full suite: `pytest tests/ -q` → **568 passed** (was 557; +11 new).

## Byte-identical verification

All three modified artifacts are byte-identical across the `coc-keeper` and
`coc-keeper` plugins:

```
diff plugins/coc-keeper/scripts/coc_story_director.py          plugins/coc-keeper/scripts/coc_story_director.py
diff plugins/coc-keeper/scripts/coc_scenario_compile.py        plugins/coc-keeper/scripts/coc_scenario_compile.py
diff plugins/coc-keeper/.../story-graph-schema.md             plugins/coc-keeper/.../story-graph-schema.md
```

All three report no differences.

## Concerns / notes

- **Backward compat is preserved end-to-end**: an old clue-graph with no
  `delivery_kind` still validates with zero warnings and routes through the
  `_infer_clue_type` heuristic. Verified by dedicated tests.
- **`skill_check` without `skill`** is a soft warning at compile time and a
  runtime fallback to `Spot Hidden` / `regular` in the director — so a
  malformed-but-loadable clue-graph degrades gracefully rather than crashing.
- The legacy `player_visible_anchor` field is still read as a fallback in
  `_collect_anchors`, so existing scenarios that use it keep working unchanged.
- The duplicate `clue_graph = _read(...)` in the validator was consolidated to a
  single read; behavior unchanged for the secrets-leak check.
