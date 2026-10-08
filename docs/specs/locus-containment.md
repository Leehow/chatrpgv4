# A place is inside places

Status: integration-in-progress (stopped worker WIP copied from `claude/locus-model-20261008` into `codex/handoff-20261008-integration`)
Date: 2026-10-08
Contract: §204 of `docs/kernel-rpc.md`.
Evidence: TR-F2 run 2 (Cold Harvest, `game-565055f1-8a99-4e69-9932-ca64c0e27d93`) and run 3 (The Haunting,
`game-af36b938-4ca6-421e-bdec-759080123f69`), App 4ce2e4cab; the lead's logs `run2-frozen.log` and `run3-frozen.log`.
Related memory: "flat locus model punishes detail" (2026-09-15): locus = handle means the more precisely a player speaks,
the more they are refused; the root fix is a locus identity with containment that every consumer honours.

## Intent

The player says where the investigator goes in their own words: a house on the farm, the room where the body lies, the
chapel a clue just named. The table should take them there. Success: a move from one house on a farm to another lands
as one move; a place the Keeper establishes knows what it lies in and what the book says about it; a person's name is
never treated as a place; the place list the Keeper reads holds places. Hollow delivery: a prompt sentence telling the
Keeper to stop routing through the farm; a hand-written place for Galena's house; a field on the capsule nobody reads.

## What went wrong, by turn

| Turn | What happened | Root cause |
| --- | --- | --- |
| run 2 T10 | `smolskaya-home` minted from the farm with no `within` | The placement lane's Choice (spread 0.32 / 0.29 / 0.36 over two farm nodes and `none`) vetoed `inside` Nouls of 0.91 and 0.91; nothing else gives a mint a container. None of the nine mints in the App's campaigns has `within`. |
| run 2 T16 | "farm first, then the Abramov house"; admission refused the farm line | From the mint the capsule's only way out was the farm (the route back); the kernel reads containment nowhere, so a sibling house was not reachable or shown. |
| run 2 T3 | Gapon's person handle used as a move destination | Nothing resolves a person to where they are or says a person is not a place. |
| run 2 open | `module.places` listed three people | The visual-asset job may draft only `asset`, `handout`, `scene`, `location`; a portrait's `depicts` needed a target, so it minted three `location` nodes named after the people (p37, p39). |
| run 2 T9–T13 | Galena's house is in the book (p21 §6.2) but not the graph; the mint never got p21 | A reader cannot have produced it (p21 was never read by T9); the mint had no tie to the book's mention. |
| run 3 T11 | `not_reachable chapel from hall-of-records` | The book's road runs `chapel → hall-of-records` (travel, always); `apply move` read `route-to` one way only. The clue that named the chapel had not landed (a ledger matter, S5), so a clue-unlock rule would not have helped this turn. |
| run 3 T16 | a move into the basement landed while the prose stayed upstairs | Admission's judgement (S1). The locus side: the basement is its own place inside the house, and `registered_destination` said nothing about the house. |

## Decisions

1. **Containment is read from the book's relations, both authored directions** (`located-in`, `part-of`, incoming
   `contains`), with `occurs-at` as "the same place" and co-location for a scene that occurs at two places. Nothing is
   inferred from names or prose.
2. **Reachability honours containment and reads a road both ways.** `via` stays the escape hatch.
3. **A mint lies in the place the party stood in unless the Keeper or the lane says otherwise.** The lane's `inside`
   no longer needs the Choice's confidence; it takes the innermost clearing candidate; `none` with confidence writes
   `within: null` (`outside`).
4. **Places the book names but the graph lacks: the Keeper's establish binds to the book's mention** (option 2 of the
   lead's two). By evidence: reading is windowed and behind the table (p21 unread at T9), a dwelling rule for the reader
   would ask for nineteen houses on one farm and cannot be checked by a deterministic gate, and the mint is the one moment
   the system knows a place is needed; at T10 it landed and only the book's text was missing afterwards. The binding runs
   in the background through the source reference read the Keeper's `lookup kind=source` already uses, and the bound
   pages make the mint cite the book (window, section read, `where.book`, the prescreen's cited pages).
5. **A person is never a place.** A move to a person goes to where they are, else is refused with the candidates.
6. **The producer of person-named places is fixed at the visual draft**, and published graphs are read without them
   (name equality only).

## Implementation record

- The WIP's hierarchy, mint defaults, person destination and visual identity changes are integrated with §197..§203.
- Completed its missing placement owner: independent inside Nouls, innermost topology, outside/null, explicit within
  preservation, and table-origin candidates. Placement family 2; admission v1 4 and role-first 2a.7 retain §197's speech
  boundary with §204's distinction between registered interior places and unregistered parts of a place.
- Completed the host book-binding caller. The real apply result carries receipt names, not bodies; the owner reads the
  matching committed bodies through the private receipt projection before starting the existing source reference.
  The binding writes on its own file lock and never changes world state. Checked excerpts only, 4 pages, 1,200 characters.
- Local diagnostics: real kernel containment/binding/person/reverse-road 5/5; file-lock ownership control 1/1;
  binding owner 4/4; placement decisions 4/4; visual checker and scoped vocabulary 3/3. These are not live tables.
- `place-binding-host.test.mjs` covers the actual model tool path and emitted kernel; it needs the current box build.
  Focused/all and live acceptance remain pending. Existing placement integration tests now expect the kernel's explicit
  active-place default when the lane leaves a mint unchanged; no gate was weakened.

## Mutation checks

- Reintroducing the Choice confidence veto: the independent-inside case fails.
- Removing containment reachability: the room move fails `not_reachable`.
- Removing binding serialization: the initial RPC-only concurrent case survived because its surrounding path serialized
  the requests. A new control holds the first actual file read and observes the second owner's lock/read boundary without
  wall-clock assumptions; removing the lock now fails before stale data can be read. Saved files restored by copy.
