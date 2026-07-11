# Live Turn Internals (DEBUG ONLY)

**This document describes the internal pipeline that `run_live_turn(...)`
executes on your behalf. It exists for isolated bug hunts and subsystem
development only. Never hand-stitch these steps during normal table play —
manual stitching loses auto-advance, fast/background recording,
`stop_actionability`, cross-turn action signatures, and the
`logs/live-turn-runtime.jsonl` receipt.**

The canonical narration envelope carries explicit `render_mode`, an optional
validated `render_frame`, and bounded `horror_profile`. Choice/NPC projections
are public whitelists. The narrator bridge returns structured fact assertions
and semantic audit evidence; live match records a template fallback in its
invocation ledger when that audit fails closed.

Internal pipeline (owned by `scripts/coc_live_turn_runner.py`):

1. Resolve the turn's semantic intent. Caller-supplied `intent_class` /
   `player_intent_rich` wins; otherwise `coc_intent_router.parse_intent` runs
   (machine carve-outs: empty → `idle`, leading `[` → `meta`; everything else
   goes through the semantic evaluator). With no semantic evidence the intent
   degrades to `ambiguous` and the degradation is recorded in
   `intent_resolution` — it is never silently defaulted to `investigate`.
2. Read player input + campaign state + scenario story-graph via
   `build_director_context`. For manual/live campaigns with missing
   `story-graph.json`, the live-story bridge derives a runtime scene from
   `save/active-scene.json`; the turn must still run through
   `build_director_context` before narration.
3. Call the Story Director (`scripts/coc_story_director.py`) to generate a
   DirectorPlan.
4. Apply the narrative enrichment pass
   (`scripts/coc_narrative_enrichment.py`):
   - turn scene affordances / clue leads into a hidden `choice_frame`;
   - turn semantically parsed `player_intent_rich.action_atoms` into chained
     `rules_requests`;
   - activate NPC `reaction_triggers`, relationship clocks, voice seeds,
     desire/fear/leverage;
   - infer the current story need, select matching storylet decks, then roll
     `storylet_moves` from the deterministic storylet engine with
     conflict-level pacing;
   - surface optional `incident_moves` only as legacy side beats that
     reinforce the main tension.
5. Execute the plan's `rules_requests` deterministically and backfill rule
   results into the plan.
6. Apply the resolved plan (`coc_director_apply.apply_plan`): save, logs,
   pacing-state, memory writes, scene transitions.
7. Repeat internally (auto-advance) for compressed low-agency continuation
   until an interrupt appears or `max_auto_advance` is exhausted, then build
   `stop_actionability` and return narration material.

When debugging a single stage, prefer driving that stage's module directly in
a sandbox campaign over re-implementing this sequence in chat.

## Optional debug logs

- `logs/storylet-scheduler.jsonl` — storylet trigger/deck/filter decision
  traces written by `coc_director_apply`. **Default OFF** (no runtime readers).
  Enable with env `COC_DEBUG_STORYLET_SCHEDULER=1` or campaign.json
  `{"debug": {"storylet_scheduler_log": true}}`.
