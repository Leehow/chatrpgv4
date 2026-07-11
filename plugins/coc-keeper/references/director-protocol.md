# Director Protocol

DirectorPlan schema and scoring engine reference. See `docs/superpowers/specs/2026-07-05-story-director-design.md` for full design.

## Narration specialization contract (A22–A25)

Every production plan emits `narrative_directives.render_mode` as one of
`investigation`, `social`, `pressure`, or `crisis`. A crisis envelope is valid
only when its `crisis_scene_render` contains all seven ordered, player-safe
slots; otherwise it fails closed to `pressure` and records frame findings.
Narration also receives a bounded numeric seven-axis `horror_profile`; module
overrides are superseded by scene overrides.

`coc_director_strategies.py` owns deterministic `time_loop` and
`multi_faction` state. Apply persists strategy state in
`save/director-strategy-state.json`; unsupported `special_mechanics` produce
explicit capability findings. Persisted state is schema-versioned and
canonical; malformed roots/IDs and duplicate faction IDs fail closed before
apply. Strategies consume structured values only.

External narrators return `asserted_fact_refs` and `semantic_audit` with exact
`same_fact`, `different_fact`, or `uncertain` decisions and reasons. Direct
matches, same-fact matches, uncertainty, missing evidence, or malformed
evidence use a recorded template fallback. `final_text` is never scanned to
classify secret meaning. Coverage must contain exactly one record for every
asserted×forbidden pair. The repository-owned auditor computes a canonical
receipt and coverage digest; narrator `external_success` is evidence-eligible
only when that receipt can be recomputed from the invocation ledger.

## DirectorPlan Fields

- `scene_action`: REVEAL|DEEPEN|PRESSURE|CHARACTER|CHOICE|CUT|MONTAGE|SUBSYSTEM|RECOVER|PAYOFF
- `handoff`: "rules" (keeper-play calls coc_roll/combat/etc.) | "narration" (keeper-play writes prose directly)
- `rule_signals`: snapshot of HP/sanity/credit/luck/crit-fumble/stalled/tension states director read
- `clue_policy`: reveal/withhold/fallback_routes/clue_type
- `npc_moves`: agenda + emotional_tone (driven by APP/CR reaction roll, p.191)
- `pressure_moves`: clock ticks with visible symptoms
- `rules_requests`: skill checks only when tension/uncertainty justifies dice
- `narrative_directives`: tone/must_include/must_not_reveal/improvisation_allowed/horror_escalation_stage

## Three-Layer Scoring

`final_score = base_score(action, ctx) × structure_weight(action, type) × rule_signal_mod`

Layer 3 overrides bypass scoring entirely (bout_active→SUBSYSTEM, fumble→PRESSURE, etc.).

## Epistemic Contract

`DirectorPlan.epistemic_contract` is orthogonal to `scene_action`. `mode` is one
of `NONE|CONFIRM|EXPAND|COMPLICATE|REFRAME|HOLD|PAYOFF`. The apply layer commits
a treatment only when a clue in `deliver_clue_ids` actually lands after rules
resolution. `REFRAME` carries `preserve_fact_refs`, `setup_refs`, and
`must_not`; it never invalidates earlier confirmed facts by default.

Post-rule backfill preserves the original under `planned_epistemic_contract` and exposes the narrator-safe result as both `epistemic_contract` and `narrative_directives.belief_update_contract`. If no supporting clue commits, an effective treatment becomes `HOLD`.

## Epistemic Runtime Contract v2

`DirectorContext` may include `epistemic_graph`, `reveal_contracts`,
`compile_confidence`, and persistent `belief_state`. The planner consumes only
structured IDs/enums and emits one schema-v2 contract with a primary `mode` plus
all candidate `effects`.

Active questions and live hypotheses rank the primary effect. Each effect carries
a stable `effect_id`, target question/layer, approved clue IDs, evidence strength,
and optional reframe preservation/setup constraints. Low-confidence critical
nodes and unready reframes become `HOLD`; they cannot erase a ready confirm or
complicate effect from the same clue.

After rules resolve, `coc_epistemic_resolve` writes `resolved_effects`. Only an
effect whose supporting clue committed may alter belief state. Applied effect
IDs are persisted so replay/retry cannot double-apply a treatment. Question open
and close events are reduced from structured conditions and world state.

Cognitive story needs are scheduled before generic scene-action needs:

```text
belief_confirmation
belief_expansion
belief_complication
belief_reframe
question_payoff
```

A reframe storylet requires a ready effect with `reveal_contract_id`. Storylets
may change presentation, pressure, cost, or emphasis; they may not create module
truth.

The NarrationEnvelope receives a minimum-privilege `belief_update` projection:
player-facing question labels, approved clue IDs, preservation constraints, new
questions, and explanation targets. It never receives `truth_ref`, source prose,
compiler reasons, hypothesis claims, or Keeper secret prose.
