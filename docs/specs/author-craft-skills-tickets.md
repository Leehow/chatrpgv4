# Author craft skills: tickets

Spec: `docs/specs/author-craft-skills.md`. Contract: `docs/kernel-rpc.md` §254.

## 01: An author section reaches the sole author (routine summary as the first consumer)

**What to build:** a package can declare an author section; after settlement the host picks it by its facts and
appends it to the author's system prompt, with telemetry. Quick Settlement's routine section is the first real
consumer, replacing its one-heading route.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] Malformed author declarations are refused at install (fact, slot, selectors, capability).
- [ ] The capsule row carries kind, slot, facts, key and bytes; the Keeper index, `mod` read and topic/call selection never include it.
- [ ] A routine turn's author prompt carries the routine section; a turn without routine does not.
- [ ] Slot override by load order and the byte cap are recorded in `lane: "author-craft"`.
- [ ] quick-settlement version bumped with changelog; routine instruction plumbing removed.

## 02: The place description is an author section

**What to build:** Enhanced Locations' place description reaches the author through the resolver on the `place`
fact; the location-description route is retired.

**Blocked by:** 01.

**Status:** ready-for-agent

- [ ] A settled place change or first-sight place sends it; a turn with neither does not.
- [ ] enhanced-locations version bumped; existing location author tests updated to the new route.

## 03: The prose package writes through the author

**What to build:** narration-craft split by layer. The Keeper keeps decisions; the author receives base prose,
register, people and speech portrayal, scene detail, establishing a place (on `establish`, with the owed rows in
`decision_context.establish`) and opening the table (on `opening`).

**Blocked by:** 01.

**Status:** ready-for-agent

- [ ] Every decision sentence of the old text is in the Keeper's resident text; every craft sentence is in an author section.
- [ ] An arrival that failed does not send establishing craft; a real arrival sends it with the owed rows.
- [ ] Settings ride with the craft; version bumped with changelog; instruction budget tests pass.

## 04: Natural Chinese speech is an author skill

**What to build:** zh-optimize's speech guidance becomes an author section on `speech`.

**Blocked by:** 01.

**Status:** ready-for-agent

- [ ] A Chinese game turn with selected NPC speech carries it; a silent turn does not.
- [ ] Version bumped; expression cards unchanged.

## 05: The Keeper gets author craft when it is the writer

**What to build:** with the decision-author path off, every author section of schema-1 packages rides the Keeper's
section message each turn.

**Blocked by:** 01.

**Status:** ready-for-agent

- [ ] Packet path off: author sections selected with `why: writer`; packet path on: never selected for the Keeper.

## 06: Live comparison

**What to build:** the same retained seed played before and after on the real driver (MiniMax 3.1 medium), judged on
correctness, completeness, Chinese prose and author first-text latency.

**Blocked by:** 02, 03, 04, 05.

**Status:** ready-for-human

- [ ] Evidence recorded under the test storage contract; findings reported to the owner.

## Comments
