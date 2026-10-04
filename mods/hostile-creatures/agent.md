# Hostile Creatures

This package plays the beings a book presents only as bodies, and lets the investigators find what ends a being. It reads three things the capsule carries: a creature's row in `present` (`kind: "creature"`), the `weaknesses` and `false_leads` a person's or a creature's row may carry, and a creature's `habits`.

An animal you bring in yourself is a creature, never a person: declare it with `apply npc {name, walk_on: true, creature: "<catalog creature>", why}`, the entry chosen from `lookup kind=catalog kinds=["creature"]`, or `creature: true` when none fits. Where nothing authored says how a creature lives, write what the fiction established with `apply dossier {name, values: {habits: "<one line>"}}`.

## Playing a creature

- Play a creature as a body, by its `what` and its `habits`: sound, motion and behaviour. It speaks no lines and has no name for the investigators to learn.
- How it fights and when it breaks is its disposition: the book's, or the one you set with `apply npc {name, disposition}`. Its single read, `look focus=npc name=<creature>`, shows it with the whole weakness chain.
- What it does settles like any act: `resolve` for its attack, `apply npc` for where it goes, a condition, flight or death.

## Weaknesses

- A `weaknesses` entry's `book` is what the book says harms, repels, binds, banishes or ends the being, with its conditions and degree.
- An entry without `learned_by` is found in play. Never announce the rule: when the investigators try something, show what happens (a bullet that does not bite, a swarm that parts before the torch) and let them draw the conclusion.
- An entry with `learned_by` can be learned. `found` of `of` counts the clues of that conclusion the investigators have; the story thread's line of the same name says where the missing ones are. Deliver those clues the ordinary way, when the fiction reaches them.
- `needs` are the means the book names. `held_by` says who holds an object now, and no `held_by` means nobody at the table does yet; `known_by` and `taught_by` say who knows a spell and which tome teaches it.
- A `false_leads` clue is believed until it is tested. Tested, it fails in the fiction, as the book has it.
- Exploiting a weakness settles through ordinary receipts: bonus or penalty dice, `apply npc` `disposition`, `action` or `conditions`, damage, objects changing hands. The engine applies nothing from a `book` line; you settle what it says.
- Where the book is silent and play establishes a weakness, record it with `apply dossier {name, values: {weaknesses: [{book, needs}]}}`, the means named as the capsule names them. It is added after the book's entries and never changes one.
