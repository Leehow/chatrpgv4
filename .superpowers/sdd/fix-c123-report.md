# Fix C1/C2/C3 — scene_tag_beat storylets bypass story_need filter and win selection

Status: **DONE** (ready to commit)
Branch: `release/0.15-alpha`

## The defect (verified)

Entering white-war's `mission-briefing` scene (which has `storylet_tags:
["opening_briefing"]` and 2 `pressure_moves`) fires the P0-3b `scene_tag_beat`
trigger, but an `opening_briefing` storylet was never selected. 3 seeds all
returned generic ambient storylets.

## Root cause

- **C1** — `infer_story_need` checks `_has_scene_pressure(ctx)` before
  `character_beat`. mission-briefing has `pressure_moves`, so `story_need`
  resolves to `need_id="scene_pressure"`, `candidate_decks=["scene_pressure",
  "pressure"]`. The opening storylets declare `deck_tags` of
  `character_beat`/`theme_echo`/`social` — zero intersection — so
  `_matching_deck_id` returns None and they are filtered out. white-war has
  `pressure_moves` on ALL scenes, so this blocks scene-tagged storylets
  everywhere in that scenario.
- **C2** — `_score_storylet` gave no weight boost when `storylet.scene_tags`
  matched the scene's tags, so even if deck-match passed, generic storylets
  outscored opening ones in weighted random selection.

## Changes

### `plugins/coc-keeper/scripts/coc_storylets.py` (+ mirrored in `plugins/coc-keeper/`)

1. **New helper `_is_scene_tag_summoned(storylet, ctx)`** (after
   `_has_scene_pressure`). Returns True iff the turn's trigger reason is
   `scene_tag_beat` AND the storylet's `scene_tags` intersect `_scene_tags(ctx)`.
   Structured fields only — no free-text scanning.

2. **C1 — bypass the story_need deck gate** for summoned storylets in two
   places: inside `_matches_context` (skip the `ignore_story_need`/
   `_matching_deck_id` gate, fall through to `_requirements_met`) and in the
   `select_storylet_moves` candidate loop (skip the second
   `_matching_deck_id` check). All other gates (anchor, polarity, content
   flags, conflict-level window, requirements) still apply.

3. **C2 — priority in `_score_storylet`** when the trigger reason is
   `scene_tag_beat`: summoned storylets `*= 5.0`, non-summoned generics
   `*= 0.01` (suppressed, not zeroed, so a generic fallback remains if no
   summoned candidate passes the other gates). See "Design deviation" below.

### `tests/test_storylets.py`

New real-data e2e test `test_e2e_mission_briefing_summons_opening_briefing_storylet_real_data`.
Loads the SHIPPED `storylet-library.json` and the REAL mission-briefing scene
from `the-white-war/story-graph.json` (with its `pressure_moves` intact), builds
the real `scene_tag_beat` trigger ctx, and asserts an opening_briefing storylet
is selected in >=4 of 5 seeds. The pre-existing inline test
(`test_opening_briefing_storylet_selected_on_scene_entry`) was NOT weakened —
it stays as-is.

### `plugins/coc-keeper/skills/coc-scenario-import/references/compile-protocol.md` (+ mirror)

Added item 4 to the "场景多路线与 storylet 标签" section explaining the
scene-entry summon semantics: a `scene_tag_beat`-summoned storylet bypasses the
generic story_need deck filter and wins selection, so authors should focus on
`scene_tags` matching (and real anchors) — NOT deck engineering — for
scene-entry beats.

## e2e test output — before vs after

Test seeds: `ww-1..ww-5`. `opening_ids = {opening-briefing-comrade-glance,
opening-briefing-tell-not-ask}`.

**BEFORE fix (0/5 opening):**
```
selected=['low-wrong-smell', 'low-repeated-phrase', 'low-echo-of-last-scene',
           'low-schedule-pressure', 'low-wrong-smell']
opening_ids=['opening-briefing-comrade-glance', 'opening-briefing-tell-not-ask']
AssertionError: expected an opening_briefing storylet in >=4 of 5 seeds; got 0/5.
```

**AFTER fix (5/5 opening):**
```
ww-1 -> opening-briefing-comrade-glance
ww-2 -> opening-briefing-comrade-glance
ww-3 -> opening-briefing-tell-not-ask
ww-4 -> opening-briefing-tell-not-ask
ww-5 -> opening-briefing-comrade-glance
```

## Design deviation from the brief (and why)

The brief suggested a flat `score *= 2.5` multiplier on summoned storylets. I
verified empirically that **a flat per-storylet multiplier cannot reliably make
summoned storylets win**, because of a cardinality mismatch: the library has
~15 generic ambient storylets vs ~2 summoned ones, and the generic pool's
aggregate weight grows with its size. Measured per-pick opening probability on
real mission-briefing data, with summoned-only multipliers:

| mult | per-pick opening | P(test >=4/5 passes) |
|-----:|-----------------:|---------------------:|
|  2.5 |            24.4% |                (fail) |
|   20 |            86.1% |              ~flaky   |
|   50 |            94.3% |               97.1%   |
|  100 |            97.3% |               99.3%   |

Even mult=100 leaves a ~2.7% per-pick leak (a 1-in-37 generic win), which makes
the `>=4/5` test flake ~0.7% of runs. That is not "reliable", which the brief
explicitly requires ("scene-entry on a storylet_tags-bearing scene reliably
summons a matching storylet").

The robust fix honors the brief's intent (summoned beats win selection) by
**also suppressing generic storylets while the summon trigger is active**
(suppression 0.01, not zero, to keep a fallback when no summoned candidate
qualifies). With boost=5 / suppress=0.01, measured per-pick opening = 99.54%,
P(test >=4/5) = 99.98% — genuinely reliable. This stays inside the brief's
prescribed location (`_score_storylet`) and uses the same
`_is_scene_tag_summoned` condition.

## Test summary

- `tests/test_storylets.py`: **20 passed** (incl. new e2e; pre-existing inline
  opening test unaffected).
- `tests/test_narrative_enrichment.py` + `tests/test_director_apply.py`
  (downstream consumers): **61 passed**.
- `tests/test_plugin_metadata.py` + `tests/test_plugin_metadata.py` +
  `tests/test_coc_plugin_sync_script.py`: **53 passed**.
- `sync_coc_plugin_copy.py --check`: clean ("plugin copies are in sync").

## Concerns

- The suppression factor (0.01) is a judgment call. It is large enough to make
  summoned beats dominate yet small enough that a generic can still be picked
  if no summoned candidate passes anchor/requirements/conflict-level gates
  (verified: generics still selectable when no opening storylet qualifies).
- Pre-existing unrelated working-tree edits exist in
  `.superpowers/sdd/task-1-report.md` and `task-2-report.md` (from before this
  task); they are NOT included in this commit.
