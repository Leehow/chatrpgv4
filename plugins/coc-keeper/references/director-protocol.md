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
