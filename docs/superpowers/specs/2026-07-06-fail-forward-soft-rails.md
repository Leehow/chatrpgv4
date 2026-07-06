# Fail-forward soft rails for CoC Director

## Goal

Player-facing play should not deadlock when a player misses a clue roll, has poor luck, or cannot decide what to do next. The Keeper may still withhold an exact obscured clue after a failed check, but the failed beat must leave the fiction in motion.

## Pattern

Use rule results as a routing signal rather than a binary door.

- Success: commit the exact clue.
- Ordinary failure: withhold the exact clue, add a cost, and keep a fallback route alive.
- Fumble or pushed-roll failure: sharpen the cost, increase pressure, or move danger closer.
- Multi-turn stall: RECOVER commits one fallback route with a cost, rather than repeating advice.

## Costs that preserve immersion

Prefer consequences that belong inside the scene: time loss, a noisy search, NPC suspicion, a closed office, missing paperwork, a returned phone call, a rival noticing the investigators, or a threat clock tick.

## Narration contract

After rules resolve, the runtime should call `backfill_rule_results(plan, rules_results)` before narration. This returns a narration-ready DirectorPlan with:

```json
{
  "rules_results": [],
  "resolved_clue_policy": {
    "planned_reveals": [],
    "committed_reveals": [],
    "withheld_reveals": [],
    "fallback_recovered": [],
    "pending_rule_result": false,
    "extra_pressure_moves": []
  },
  "narrative_directives": {
    "failure_consequence": {
      "narration_mode": "withhold_exact_clue_with_cost|recover_with_cost",
      "consequence_type": "time_pressure_and_alternate_route_hint|fallback_route_surfaces",
      "severity": "regular|hard",
      "fallback_routes": [],
      "costs": ["time_pressure"],
      "must_not_claim": []
    }
  }
}
```

For a failed obscured clue check, `must_include` is pruned so the narrator does not accidentally reveal the exact clue anchor. The narrator should instead describe the failed approach, the cost, and the next in-fiction route that remains available.

For stalled RECOVER, the fallback should be presented as something happening inside the world, never as a table-level hint.

## Implementation hooks

- `coc_playtest_driver.py` now executes `DirectorPlan.rules_requests` before apply.
- `coc_playtest_driver.py` now records `resolved_clue_policy` and `failure_consequence` in its turn report.
- `coc_director_apply.py` now gates obscured clue commitment on rule results.
- `coc_director_apply.py` exposes `backfill_rule_results(...)` so the narrator sees a reconciled plan.
- A failed obscured roll logs `clue_withheld` and `failure_consequence` events instead of adding the clue to `world-state.discovered_clue_ids`.
- A RECOVER action with `stalled_turns >= 3` and `fallback_routes` commits one fallback clue/lead with a pressure cost.
