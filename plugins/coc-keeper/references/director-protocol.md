# Director Protocol

DirectorPlan schema and scoring engine reference. See `docs/superpowers/specs/2026-07-05-story-director-design.md` for full design.

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
