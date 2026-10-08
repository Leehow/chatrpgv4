# A person the book places here is here

Status: ready-for-human (RP-01..RP-04 implemented on `claude/roster-presence-20261008`; contract `docs/kernel-rpc.md` §198;
RP-05 and RP-06 are follow-ups that need the lead's word; RP-07 is the lead's acceptance; RP-08 and RP-09 are open
questions found on resumption)

Lead ruling, 2026-10-08, on real table TR-F2 run 2 (App `4ce2e4cab`, Cold Harvest, campaign
`game-565055f1-8a99-4e69-9932-ca64c0e27d93`):

1. `walk_on` on a person the table already has brings that person here. It is accepted as `to: here`, with a receipt note
   that walk_on was read that way; every existing gate still applies.
2. The opening (and any scene) shows the people its authored material places in it, by a system fix to the producer or the
   projection that owns it.

## What happened

- **Turn 0.** `look` at the opening `commander-briefs-investigators-at-hq` (`scene-source-entry-9`) answered
  `present: []`; the scene's own text (the book's §2.1) puts Captain Aganin behind the desk. The Keeper narrated
  「屋里没有人」.
- **Turns 1, 5, 18.** `apply npc {name, walk_on: true, to: here}` for Aganin, Gapon and Pyotr Abramov, each a book person
  the table had, was refused (`invalid_params`, `npc.walk_on`, `kernel-ts/apply/entities.ts`). On turn 18 the Keeper then
  narrated 「屋里仍没有回应，门也没有打开」 at Pyotr's door.
- **Every turn.** The hybrid read's `source_presence` metadata was `total: 0` on all 19 turns (campaign telemetry): the
  source-presence offer, a reference book's only road to presence (§149.1, §187.3), never offered anybody.

## Root causes (each read off the graph, the campaign and the code)

1. **The opening is an anchor that displaced the openings the graph had.** `book-2` generations 1-3 held
   `scene-investigator-introduction-1` and `-2` (§2.1 and §2.2, both `is_entrance`, both in `entry_scene_ids`, both citing
   page 9; Aganin `present-in` both). Generation 4's source-reference bind (`publishReferenceContext`,
   `kernel-ts/modules/reference.ts`) reuses an existing entrance only when exactly one cites the entry page
   (`samePage.length === 1`); with two it minted `scene-source-entry-9` (the page's text, `source_reference_anchor`, no
   relation) and made it the only entry. The campaign opens on the anchor; `sceneNpcIds(anchor)` is empty.
   **This is not the reader's extraction**: the reader linked Aganin, to the nodes the campaign no longer opens on.
2. **A projected place shows nobody.** The farm (`location-krasivyi-oktabur-3`) and the Abramov house
   (`location-abramov-house`) are source locations projected into playable scenes (§150.2). The book's people reach them
   through the scenes that happen there: Gapon `present-in` `scene-source-place-15-4` `occurs-at` the farm; Pyotr, Dmitri
   and Ekaterina `present-in` `scene-abramov-house-arrival` `occurs-at` the house. `sceneNpcIds` read only `present-in`
   into the scene's own group.
3. **A reference book can never seat anyone before its opening is narrated.** §149.1 deferred all of a reference book's
   presence to the offer (Dust to Dust's Eric Helverson, `present-in` the briefing but a conditional hook, had been in
   `present` from turn 0), the offer is judged on a later turn's route, and turn 0 admits no `npc` write.

**Extraction gaps seen on the way** (the graph-grounding worker's, not fixed here): Vasili Smolsky is in `cast.json` and
not in the graph (TR-F2 turns 12-13); nothing relates Gapon to `location-gapon-house`; the reader writes `located-in` from
people to places (Pyotr `located-in` the Abramov house), which §198.2 does not read as presence (`present-in` is the
graph standard's placement relation, invariant `actor_in_no_scene`).

## The change (contract §198)

- **§198.1** `walk_on` on someone the table already has is their arrival: staged without `walk_on`, with `to: here` when
  it names no `to` and opens no standalone variant; receipt `walk_on_read`, result `walk_on_read` and `walk_on_note`
  naming them by the table's word. Every other gate unchanged.
- **§198.2** `ModuleGraph.scenePeople` / `sceneNpcIds`: a scene's own people, plus the people of the scenes that
  `occurs-at` it (a place), plus, for an anchor opening, the people of the `is_entrance` scenes citing its pages. Every
  `sceneNpcIds` reader gains it; the `source_presence` offer carries `placed_by`.
- **§198.3** The opening of a reference book is judged before it is narrated: `table.open` lists `opening_people`; the
  host asks Jev one Noul per person (family `opening-presence`) and seats those at or above 0.7 with one `table.apply`;
  the opening admits that seat and nothing else of the kind, and a batch of seats leaves the opening owed.

## Tickets

### RP-01 walk_on on someone the table has is their arrival (§198.1)
Status: ready-for-human (implemented)
`kernel-ts/apply/entities.ts` (`personOfEffect`, `stageNpc`), `kernel-ts/apply/index.ts` (result note),
`extensions/kernel/tools.ts` (the `walk_on` description ships with it, §87.6). Tests: `roster-presence.test.mjs` (§198.1),
`tests/kernel/test_walk_on_gate.py` (`test_walk_on_for_someone_this_table_has_is_their_arrival`, replacing the refusal test),
`survivor-map.test.mjs` (§198.1 with §192.3: the arrival is the `to` write, under the node that stands for the person, and
clears a copy's entry).

### RP-02 Who the book places in a scene (§198.2)
Status: ready-for-human (implemented)
`kernel-ts/read/module-graph.ts` (`scenePeople`, `displacedOpenings`), `kernel-ts/runtime/apply-operation.ts`
(`placed_by`), `kernel-ts/modules/obligation-shape.ts` (message). Tests: `roster-presence.test.mjs` (§198.2).

### RP-03 The opening seat in the kernel (§198.3, kernel half)
Status: ready-for-human (implemented)
`kernel-ts/read/capsule.ts` (`unplacedPeople`, `openingPeopleView`), `kernel-ts/write/index.ts` (`opening_people`,
`opening_call_ordinal`), `kernel-ts/apply/entities.ts` (`refuseUnlessOpeningSeat`, `openingSeatShape`),
`kernel-ts/apply/index.ts` (the gate, `keepOpening`), `kernel-ts/write/store.ts`, `kernel-ts/transactions.ts`.
Tests: `roster-presence.test.mjs` (§198.3).

### RP-04 The opening judge at the host (§198.3, host half)
Status: ready-for-human (implemented; the bar 0.7 is not yet calibrated on live rows)
`runtime/jev/opening-presence.ts`, `extensions/kernel/opening-presence.ts`, `extensions/kernel/index.ts` (session start,
the call ordinal on reopen). Tests: `opening-presence.test.mjs` (the lane), `opening-presence-table.test.mjs` (the real
entry, real kernel, the product's Jev adapter with `fetch` answered; with the answer held back 600 ms, the opening run's
capsule and the Keeper's `look` carry the captain and not the visitor).

### RP-05 The anchor's exits, clues and assets (follow-up)
Status: needs-triage
The anchor stands for its displaced openings for people only. TR-F2's opening listed no exit to the farm although
`scene-investigator-introduction-2` routes there, and its clues (`clue-smolskaya-denunciation`, `clue-kravchuk-family-fled`)
are discoverable at that opening. Either the bind relates the anchor to the openings it displaced (a producer change, for
new binds) and the group or the exit/clue readers follow it, or the same read-time rule extends to `sceneExits` and
`sceneClueIds`. Needs the lead's word on the shape.

### RP-06 The host's move body reads the destination's own present-in only (follow-up)
Status: needs-triage
`runtime/jev/candidate-bodies.ts` builds `people_there` from the destination's `present-in` relations in `lookup`, so a
place's people (§198.2) are missing from the move candidate's body. The kernel lookup could carry the destination's
`scenePeople`, or the body could read the offer.

### RP-07 Acceptance (lead)
Status: ready-for-human
A new Cold Harvest campaign on the packaged App: the opening shows Aganin; a walk_on on a person the table has lands as an
arrival with no refusal; at the farm and the Abramov house the offer lists Gapon and Pyotr. Dust to Dust's opening: the
judge leaves Eric Helverson unseated (§149.1). The opening-presence rows' `nouls` calibrate the bar.

### RP-08 walk_on on an unread cast person (open question)
Status: needs-triage
A person the book's cast has and the graph does not (TR-F2's Vasili Smolsky) is not "someone this table has" in §198.1's
sense: `walk_on` under their name is still §177.3's `book_name` refusal (its fix says to leave `walk_on` out; without it
the write lands on the cast's pages, §177.6). Reading `walk_on` there as that write would amend §177.3; needs the lead's word.

### RP-09 The opening when the judge seats nobody (open question)
Status: needs-triage
Jev unconfigured, failing (TR-F2 run 2 saw 503s on other families) or later than 4,000 ms seats nobody, and the opening's
`present` is empty as on TR-F2 run 2. Nothing at the opening tells the Keeper the book places someone there whom nobody
seated; from turn 1, §198.1 lands the Keeper's own `walk_on`. Whether `look`/the capsule should name the unplaced people at
the opening (the Keeper then judging the text itself) needs the lead's word: it is §149.1's question again.

