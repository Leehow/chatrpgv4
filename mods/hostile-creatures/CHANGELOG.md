# Hostile Creatures

## 1.0.0
- First version (contract §180.11; `docs/specs/creature-kind.md` D18–D20). Owner rulings of 2026-10-04: animals and monsters are separated from people so that person features are not misapplied to them; a creature gets its habits, many have weaknesses, and the investigators can learn a weakness through play; "make a hostile creature optimisation mod".
- What a being is, and which machinery may treat it as a person, stays the base's (§180.1): this package only adds how a hostile creature is played. Disabling it does not give a rat an epithet again.
- `habits`, a creature word (`vocabulary.creature_profile_keys`, §180.8): the reader asks it of creature nodes at build, the creature row reads it, and the table door (`graph.vocabulary.table.v1`) accepts it on a creature where nothing authored says.
- `actor.weaknesses.v1` (§180.9): a build with this package enabled binds the weakness shape, so the reader is asked for it and the checker holds it; actor rows carry the chain (`needs` with `held_by` / `known_by` / `taught_by`, `learned_by` with `found` of `of`, `false_leads`), and the table door appends entries while the package is enabled.
- `agent.md` (English, under 4 KB) is sectioned (§183.1, `instructions.sections.v1`): the preamble is resident and carries the walk-on line; "Playing a creature" loads on `state:creature_present`; "Weaknesses" on `state:weakness_here` and `before_resolve:combat`. No brief. Under the instruction budget, as every table is today, the whole text goes.
