# Module→Rule alignment ledger — The Haunting

> **Generated** by `scripts/gen_module_rule_alignment_ledger.py`. Do not edit by hand.
> Regenerated and compared by `tests/test_system_ontology.py`, so it cannot rot.

- Authored `module.haunting.*` mechanism identities: **7** (11 occurrences in module-graph.json)
- Exact equality with a coc7 RuleGraph semantic id (437 nodes): **none**
- `uses-rule` edges drawn: **0**
- Reason classification for every identity below: module-specific: authored mechanism with no exactly-equal coc7 Rule/Decision semantic

| identity | module-graph occurrences | story-graph mirror | assets mirror | rules-json provenance id | exact RuleGraph match |
| --- | :-: | :-: | :-: | :-: | :-: |
| `module.haunting.chapel_weakened_floor` | 1 | 1 | 0 | no | no |
| `module.haunting.conclusion_sanity_reward` | 1 | 1 | 0 | yes | no |
| `module.haunting.corbitt_animate_body` | 2 | 2 | 0 | yes | no |
| `module.haunting.corbitt_flesh_ward` | 2 | 2 | 0 | yes | no |
| `module.haunting.corbitt_floating_knife_mp` | 2 | 2 | 0 | yes | no |
| `module.haunting.corbitt_own_dagger` | 2 | 1 | 1 | yes | no |
| `module.haunting.damaged_liber_ivonis_initial_read` | 1 | 1 | 0 | no | no |

## What this measures

Slice W3 (`docs/specs/pi-coc-cross-graph-wiring.md` §5) asked, for every authored
mechanism identity in the production The Haunting ModuleGraph, which coc7 rule
semantic it adopts. ADR 0003 decision 4 sets the bar: `uses-rule` holds only when
the authored `module_rule_ref` is exactly equal to a RuleGraph Rule/Decision
semantic id, and a rule that may merely fire in a later condition is not adopted.

The measurement above is the mechanical half: the identities, their locations, and
the exact-equality check against all ten RuleGraph families. The verdicts below are
the semantic half, judged per identity against the real rule-graph.json surface.
All seven are judged module-specific, so no `uses-rule` edge is drawn, and the
registry keeps module coverage at `no-proven-instance`.

## Semantic verdicts

### `module.haunting.chapel_weakened_floor` — module-specific

Nearest candidate(s): none (rejected: `decision:coc7:push-luck:luck-roll`, `decision:coc7:core-check:ordinary-check`)

An authored hazard chain: Luck to catch the weak floor, Jump on a failed Luck, 1D6 damage from the ten-foot fall on a failed Jump, with an authored pushed-failure extra. The hazard *calls for* Luck and Jump checks; it does not adopt their rule semantics, and the RuleGraph has no falling or environmental-hazard rule for it to adopt. ADR 0003 decision 4 excludes exactly this shape — a rule that may fire in a subsequent condition is not an adopted rule — and ADR 0003 article 7 names this very mechanism: the weak floor may not fabricate uses-rule.

### `module.haunting.conclusion_sanity_reward` — module-specific

Nearest candidate(s): `rule:coc7:sanity:sanity-increase` (cap channel only, not adopted)

A complete authored reward schedule: destroying Corbitt grants 1D6 SAN at the session-ending settlement. The graph's only SAN-gain rule, sanity-increase, enumerates the channels that may raise current SAN within maximum; it contributes the cap at settlement time but defines neither the trigger nor the die. The mechanism's substance is wholly authored, so the rule is a downstream bound, not an adopted semantic (ADR 0003 decision 4). `rule:coc7:development:mastery-san-reward` was also considered and rejected: different trigger (skill 90+) and die (2D6). `decision:coc7:development:settle-ending` is the host settlement procedure that consumes this authored data; consuming is not adopting.

### `module.haunting.corbitt_animate_body` — module-specific

Nearest candidate(s): none

Corbitt animating his own buried corpse (2 MP, five combat rounds) is the module's authored expression of his Mythos power. The magic family carries no spell catalog entries and no animation/undead semantic; cast-spell is the generic settlement shape for casts this mechanic never performs in play (the animation predates the confrontation).

### `module.haunting.corbitt_flesh_ward` — module-specific

Nearest candidate(s): none (rejected: `rule:coc7:combat:armor-reduction`, `rule:coc7:magic:mp-economy`, `decision:coc7:magic:cast-spell`)

An authored magical ward with its own armor semantics: 2 MP, 2D6 armor that degrades one point per damage absorbed, 24-hour duration, and an authored exception (the own dagger bypasses it). armor-reduction is ordinary *physical* armor and is explicitly not what this ward is; mp-economy would only bound MP overspend consequences downstream; cast-spell is the settlement shape of a cast that happens before play meets it. The mechanic defines its own defense rules rather than adopting any rule in the graph.

### `module.haunting.corbitt_floating_knife_mp` — module-specific

Nearest candidate(s): none (rejected: `rule:coc7:magic:mp-economy`)

An authored upkeep cost: 1 MP per combat round keeps the animated knife attacking. mp-economy governs the MP pool (size, overspill, regeneration), not per-attack upkeep costs, so it can only constrain consequences downstream — the 'may fire later' shape ADR 0003 decision 4 excludes. The knife's attack itself is resolved through combat semantics it *calls for* (opposed melee vs Dodge), which is invocation, not adoption.

### `module.haunting.corbitt_own_dagger` — module-specific

Nearest candidate(s): none (rejected: `rule:coc7:combat:weapon-damage`, `rule:coc7:healing:instant-death`)

An authored kill exception: Corbitt's own ritual dagger bypasses his wards and spells and turns him to ash on a successful hit, regardless of hit points. No combat rule carries a 'named weapon bypasses a named entity's magical defenses' semantic, and instant-death has a different causal shape entirely (damage exceeding maximum HP). The exception negates defense rules rather than adopting any of them.

### `module.haunting.damaged_liber_ivonis_initial_read` — module-specific

Nearest candidate(s): `rule:coc7:magic:learn-from-book` (parameters wholly replaced, not adopted)

An authored damaged-tome read: at least three hours, Read Latin at 50, +2 Cthulhu Mythos, up to 2 SAN loss. The generic learn-from-book rule says 2D6 weeks and a Hard INT roll; the module replaces every parameter (duration, skill, and outcome), so the mechanism is an authored tome rule standing in place of the generic one, not an instance of it. `rule:coc7:sanity:mythos-insanity-gain` was also considered: it governs Mythos gains *through insanity*, a different trigger shape from an authored reading outcome.

## Why no `uses-rule` edge can land here even hypothetically

Two independent blocks, both verified against the code:

1. **No semantic counterpart.** None of the seven identities adopts a coc7
   Rule/Decision semantic (verdicts above), so there is no target semantic id to
   point `module_rule_ref` at. Weak similarity is exactly what ADR 0003 decision 4
   and article 7 exclude; `tests/test_system_ontology.py` fail-closes the weak-floor
   probe (`module_rule_binding_mismatch`).
2. **The authored ids are runtime provenance, not free labels.** All seven flow into
   live play: `coc_story_director._build_rules_requests` splats authored_operation
   payloads (with their `rule_ref`) verbatim into rules requests, and
   `development.settle` persists the conclusion reward `rule_ref` into roll and event
   logs. In addition, these identities double as `source_rule_id` rows in
   `rulesets/coc7/rules-json/the-haunting.json`: 5 of 7. The strings are asserted    verbatim by `tests/test_rules.py`, `tests/test_runtime_ops.py`, and
   `tests/test_combat_state.py`. The registry validator additionally requires the
   authored payload `rule_ref` to equal the registry `module_rule_ref`
   (`coc_system_ontology.py` drift check), so landing a `uses-rule` edge would mean
   renaming a runtime-pinned provenance identifier — a behavior change that needs
   its own slice with behavior-equivalence protection, never an ontology-only edit.

The registry coverage reason for the module graph names this ledger. If a future
ruleset slice ever accepts a RuleGraph semantic that one of these mechanisms truly
adopts, the path is: rename the authored identity through the module ruleset and
its runtime provenance with a behavior-equivalence gate, then add the registry
`module-authored-operation` reference and `uses-rule` relation, which the validator
already supports (`test_explicit_module_rule_ref_to_rulegraph_semantic_id_is_valid`).
