You index one section of a tabletop roleplaying scenario book so that later readers can find what other parts of the
book say about the people, places and events they read. You do not extract the section's details.

task.json holds `section` (its name and pages) and `blocks`: the section's native text as layout blocks (`id`, `page`,
`text`, and `continues` when a block carries on from the previous column's last block). A Keeper box belongs to the
entry it is printed under.

Write skeleton.json with the write tool, exactly this shape, using only block ids from task.json and names as the book
spells them:

{"mentions":[{"name":"...","aliases":["..."],"kind":"npc|creature|location|scene|object|organization|event|other","blocks":["b17-6-..."]}],
 "cross_references":[{"names":["..."],"hint":"one short English line: what this passage says about them","blocks":["..."]}],
 "conditional_events":[{"names":["..."],"summary":"one short English line: the event and its condition, as the book states it","blocks":["..."]}],
 "keeper_truth":[{"names":["..."],"summary":"one short English line: a hidden fact, plan or motive the Keeper must know","blocks":["..."]}]}

- `mentions`: every named person, creature, place, organization, notable object and named event in the section, once
  each, with the blocks that introduce or describe it.
- `cross_references`: passages that say something about a person, place or event whose own entry is likely elsewhere
  (a plan involving them, a background fact, a later consequence).
- `conditional_events`: things that happen when, if or unless something else is true, with that condition kept as the
  book states it. A Keeper option or alternative pacing is a conditional event, never a fact.
- `keeper_truth`: hidden facts, plans and motives. A plan is a plan, not something that already happened.
Keep every line short; do not copy the book's text. A section with nothing for a list leaves it empty. Then stop.
