# Names in the request rename: hide the untold name, never corrupt a name the table owns (2026-10-06)

Status: ready-for-agent. The owner asked for a separate spec (「名字那类问题另开 spec」, 2026-10-06), after the
name-free handles acceptance table. A contract section is written first, at the next free number, and amends §103.5,
§176.5, §177.4, §177.11, §177.15 and §185.3.

Related:
- spec `docs/specs/name-free-handles.md` (§185): the identifier side is done there;
- `name-free-handles-tickets.md`: NFH-06 (resolution spread across tools) moves into this spec, and NFH-07 (an
  investigator's name pieces are known, §185.13) is its first partial fix;
- §87.8 (one junction for a person's name), §103.5 / §103.8 (untold names), §176 (epithets), §177 (the cast),
  §177.15 (Jev judges name places).

## Problem Statement

The Keeper never sees the book's name for a person the investigator has not been told about. The host enforces that with
a text substitution on everything it and the kernel write into the Keeper's request (§103.5). The table that accepted
§185 showed that this substitution still corrupts names the table owns. The Keeper then copies the corrupted string
back, as a reference into tool calls and as text the player reads.

Evidence: `nfh-accept-blood-road-1`, Blood Road, played 2026-10-06 on the §185 integration head with the Keeper on
flapcode/gpt-6-luna low.

1. **The investigator's own name.** The investigator is 「丹尼尔·怀特」. The untold store owner is 「丹尼尔·马瑟」, and the
   book also calls him 「丹」 (「丹外表粗犷」), so the roster held `丹尼尔` (a piece) and `丹` (a whole one-character alias).
   - **Play-1:** the piece rewrote the investigator to 「抓胡茬的红发杂货店主·怀特」. 9 of 11 refusals were
     `unknown_entity` on that string, in `cash.subject`, `object.to` and `item.to`. Every payment and hand-over failed,
     and two turns delivered nothing.
   - **After NFH-07 (pieces of investigator names are known):** the one-character alias still matched inside the name,
     giving 「抓胡茬的红发杂货店主尼尔·怀特」. Play-2 turns 4 and 7 were refused on it.
   - **Player-visible corruption:** the Keeper also wrote that string into a note the investigator writes
     (`document.text`), which the player reads.
2. **Joined words used as a name.** A name several cast rows share is shown as all their words joined
   (「抓胡茬的红发杂货店主 / 站在基地里的住民 / 红发棕眼的来客」, §177.4).
   - Here the rows are the same man. One is the graph node `red-haired-store-owner-smoker`; another is an unread cast row,
     `cast-78239617e2` "Daniel Mather", that never joined it.
   - The Keeper used the joined string as `npc.name`, and it was refused (play-2 turn 8).
3. **Dallas** (table 27, §177.15). Jev is asked whether a place is "that name or part of another word". The question can't
   separate "the same name, a different person": 「丹尼尔」 inside the investigator's name was judged to be the name. When
   Jev is unavailable, the request still renames and the delivery still holds.
4. **The owner's scan of 10-01..10-06.** 16 tool failures were in names, titles, NPCs and references: an old title not
   found, same-name ambiguity, an existing NPC treated as new, an untold name, and Dallas.
5. **Resolution is spread across tools** (NFH-01's sweep, §185.11). People and entities are resolved in about twenty places
   outside the one junction. Some compare spelling with stored state, some skip the table's word, and some never reach
   §185.3's retry. That is the input side of the same family: a name the Keeper writes correctly is still not found.
6. **The Keeper invents names.** It named the bartender (book: Robert Taylor) 「罗伊」 and the man at Mather's store
   「卡尔」, instead of copying `say_name`. Earlier tables copied the token 3 times in 4 (table 21). This needs measuring
   before any change.

## Solution

1. **Protected spans.** Before the rename replaces anything in a text, it finds every place where the text writes a name
   the table owns and the investigator knows:
   - each investigator's registered names;
   - every told person's names;
   - this table's words for people (epithets, labels, `called.name`).

   A place that overlaps one of those spans is never renamed and never held by the delivery gate. This is span-level
   string matching on names the kernel holds; NFH-07 only removed whole keys. The one-character 「丹」 then stays inside
   「丹尼尔·怀特」.
2. **Joined words resolve or name their candidates.**
   - The cast joins a row to its graph person whenever they share a whole identity (§177.1). An unread duplicate of a
     graph person stops being a separate owner, so the joined word does not arise for one man.
   - When a joined word is copied back as a reference: if every owner is the same person, it resolves to that person; if
     not, it is refused with each candidate's own word, never with the book's name.
3. **Undo the rename on a miss, for names, in both schemes.** §185.3 retries a missed reference with handle rows undone,
   in legacy campaigns only. This extends it to every rename row (shown word back to name), in name-free and legacy
   campaigns alike.
   - The first spelling that resolves wins; a spelling that resolves to several people is refused with their candidates.
   - This is the safety net for any future rename row.
4. **One junction for every reference (was NFH-06).**
   - Every tool entrance that names a person or entity goes through `ModuleGraph.resolve` plus the §87.8 junction. The
     list is in §185.11 `#### NFH-01`.
   - Stored references are compared by resolved identity.
   - Each conversion has a test that fails when it is reverted.
5. **Measure `say_name` before changing anything.** Count how often the Keeper copies `say_name` versus writing a
   different name for a book person. Then decide whether to make an invented name for a book person a `apply person`
   word, or to leave it as play (memory: Keeper fabrication is play).

## User Stories

1. As the player, I want my investigator's name never to turn into a stranger's description, so that the story and my notes say who I am.
2. As the player, I want to pay, take and hand over things without the turn failing, so that ordinary actions just work.
3. As the player, I want every turn to deliver story text, so that I never have to "send anything to continue" because of a hidden rename.
4. As the player, I want people whose names I haven't learned to stay unnamed, so that learning a name still happens in the fiction.
5. As the Keeper, I want the investigator's registered name to reach me exactly as registered, so that I can address tool calls to them.
6. As the Keeper, I want a told person's name and this table's words to stay as written, so that what I copy back resolves.
7. As the Keeper, I want a word shown for several cast rows of one person to resolve to that person, so that I can act on them.
8. As the Keeper, I want a refusal on an ambiguous word to name the candidates by their own words, so that I can choose without learning a hidden name.
9. As the Keeper, I want any string the host rename produced to resolve when I copy it, so that a rename row never strands a reference.
10. As the Keeper, I want every tool to accept the same names for a person, so that the rules don't depend on which tool I'm in.
11. As the Keeper, I want a person's name once told to resolve everywhere, so that "旧称谓找不到人" stops happening.
12. As the Keeper, I want a person I've already introduced recognised as the same person, so that the table does not mint a duplicate NPC.
13. As the owner, I want rename and gate to share one source of protected spans, so that the next name class is fixed once.
14. As the owner, I want span protection to compare strings the kernel holds, never a word list, so that the rule against hardcoded semantics holds.
15. As the owner, I want unread duplicates in the cast joined to their graph person, so that one man doesn't show as three.
16. As the owner, I want the retry on a miss to cover names in both schemes, so that old and new campaigns behave the same.
17. As the owner, I want `say_name` usage measured before anyone changes the Keeper's naming behaviour, so that we fix the right thing.
18. As a test author, I want a fixture where the investigator shares a piece and a one-character alias with an untold person, so that the play-1 and play-2 failures are pinned.
19. As a test author, I want a round-trip test (assembled request → copied string → tool call) for every rename row kind, so that a new row kind can't strand references.
20. As a kernel maintainer, I want the reference entrances listed in the contract with their conversion state, so that review can see none is missed.
21. As a worker, I want this spec to state which behaviours legacy campaigns also get, so that I don't guess.

## Implementation Decisions

- **Protected spans.**
  - The span source is one kernel function that extends NFH-07's `knownNamePieces`: the names to protect plus each
    investigator's registered names.
  - `table.untold` returns the protected names beside `people`. The host rename (`renameText` / `placesIn`) and the
    kernel delivery gate (`untoldWholeNames`, `table.untold_spans`) both skip any place that overlaps a protected
    occurrence.
  - Matching follows the rename's own rules: exact string; a Latin name is bounded by letters and digits; CJK is matched
    as a substring.
  - It applies in both schemes.
- **One-character names.** No special rule. Protected spans cover the investigator case, and §177.15's Jev judgement covers
  a character inside another word. Record in the contract that a one-character alias is matched by substring and relies on
  both.
- **The cast join.** A stored cast row joins a graph person whenever a whole identity matches, the rule §177.1 already
  states. Find why `cast-78239617e2` "Daniel Mather" did not join `red-haired-store-owner-smoker` and fix the join, not
  the display. A joined word whose owners all resolve to one node resolves to it.
- **The retry.** `renameUndo` rows gain every name→shown pair the roster can produce. It is built over-inclusively (every
  book person treated as untold) because `resolve` is synchronous. It is installed in both schemes. It still runs only on
  a miss and keeps only a spelling that resolves.
- **The junction (NFH-06).** Convert the entrances listed under §185.11 `#### NFH-01` ("The sweep") to `resolve` plus §87.8,
  one by one, each with a reverting test. Priority comes from the owner's scan: cash/owed, objects and items, notes and
  memory, chase, obligations.
- **Measurement.** A read-only script over retained tables (driver runs and campaign turn records). It counts, per book
  person asked for a name, whether the Keeper copied `say_name`, wrote another name, or deflected. No product change in
  this spec.
- Code and prompts in English; no lists or regexes for semantic questions; the Keeper-facing wording comes from existing
  rows.

## Testing Decisions

- **The seam.** The kernel in process plus the installed context runtime: `tests/extension/untold-name-path.test.mjs`,
  `investigator-name-known.test.mjs`, `legacy-rename-round-trip.test.mjs`. Assert structure and reason codes, not
  message text.
- **Fixtures.** An investigator 「丹尼尔·怀特」 beside an untold 「丹尼尔·马瑟」 who is also printed as 「丹」. A cast with an
  unread duplicate of a graph person. A legacy starter with the same shape.
- **Round trip.** For every rename row kind (whole name, piece, one-character alias, joined word, handle in legacy), take
  the assembled request, copy the string into the tool call that uses it, and assert it resolves to the original, or is
  refused with candidates when it is truly ambiguous.
- **Delivery.** A delivery naming the investigator in full is not held. A delivery naming the untold person is held.
- **Mutation.** Each fix has a test that fails when it is reverted (revert by copy).
- **Suites.** ext, py and loop on the LAN box.
- **Acceptance.** A real Blood Road table whose investigator shares a name with a book person, played through payments,
  hand-overs and writing a note. Pass when there is zero `unknown_entity` on the investigator, zero empty turns from
  rename, and no corrupted name in any delivered text or document.

## Out of Scope

- Handles and identifiers: done in §185.
- Changing the direction of §177.15's fallback when Jev is down (rename, hold). Kept as is.
- Changing how the Keeper names people; this spec only measures it.
- Migrating stored world state of old campaigns.

## Further Notes

- **Not NFH defects.** These also showed on the acceptance table:
  - unnarrated public Appearance rolls against people the player never addressed;
  - time and space continuity: the Esso station listed inside the town centre after a 3-mile drive, and that drive
    costing 30 minutes;
  - bookkeeping wording leaking into prose (「登记仍未能绑定」);
  - the occupation stored in English at setup;
  - the porch man and the store's counterman swapping descriptions.

  They are for the owner to triage separately.
- **Suggested tickets.**
  1. Protected spans: rename and gate.
  2. Cast join for unread duplicates, and joined words resolving.
  3. Undo on a miss for name rows, both schemes.
  4. The junction, in batches.
  5. The `say_name` measurement.
  6. The real table.

## Comments
