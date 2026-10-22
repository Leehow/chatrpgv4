# Kept looks: what the prose established about a person or place is written back and reused

Status: ready-for-agent

Contract: `docs/kernel-rpc.md` §255. Owner decisions 2026-10-22 (project thread "统一实体 schema"): no unified entity
schema; the gap is that details the author improvises are never written back. After the author's bounded improvisation
(§254.6: `surface_detail`, `appearance`), a background writeback records the established description on the entity,
never blocking the delivery, so later turns reuse it and stay consistent.

## Problem Statement

The sole author may give an undescribed person a look and an unsourced place its ordinary surface detail (§254.6). The
words reach the player once and live only in that turn's prose. The next turn's author is handed the same person as a
reference and a display name only, and the same place without what was said of it, so it invents again: the clerk who
was grey-haired and stooped comes back young, a woman written with 她 becomes 他 three turns later, the cellar's brick
walls turn to stone. Nothing in the kernel records a person's pronoun or a delivered look; the private dossier never
reaches the author by design. The player reads a world that does not hold still.

## Solution

After a delivery, beside the first-sight check, a background check reads the delivered prose for the current place and
each present person who has no kept look yet. It selects the prose's own sentences that show how that place or person
looks, and the pronoun the prose uses for each person. The kernel keeps only spans it finds in that turn's delivered
text, and records them on the first-sight ledger as the entity's kept look. From then on the capsule's present people
and current place carry their kept look and pronoun, and the sole author's decision context hands them on with one
contract sentence: keep these consistent, they are what the table was already shown. A look is recorded once and never
overwritten; it travels with forks. The delivery never waits for any of this.

## User Stories

1. As a player, I want a person I met to look the same when I meet them again, so that the world feels real.
2. As a player, I want a person's pronoun to stay the one the story first used, so that I am not confused about who is who.
3. As a player, I want a place's walls, light and smell to stay as first described when I come back, so that places have identity.
4. As a player, I want the reply I am waiting for never to be slowed by this record, so that play stays fast.
5. As the owner, I want the record taken after delivery in the background, so that the author stays one tool-free call.
6. As the owner, I want the record to be the prose's own words, so that the checker never invents a look of its own.
7. As the owner, I want the kernel to refuse any span that is not in that turn's delivered text, so that only what the player saw is kept.
8. As the owner, I want a kept look never overwritten by a later check, so that the first delivered look is the table's look (§254.6: "once delivered it is the look the table keeps").
9. As the owner, I want a person with a kept look to stop being offered to the `appearance` grant, so that the author describes, not reinvents.
10. As the owner, I want the book's own description to remain the authority where it exists, so that a kept look never contradicts the module.
11. As the owner, I want nothing private kept: no name nobody said, no history, motive, knowledge or clue, so that the record cannot leak or plant leads.
12. As the owner, I want looks bounded in size, so that the capsule and the author's input stay small.
13. As the owner, I want a fork at an earlier commit to carry the looks known at that commit, so that a branch line is consistent with itself.
14. As the owner, I want the check to cover both the native typed-decision path and the legacy completion path, as first sight does, so that either table configuration records looks.
15. As the owner, I want a failed or timed-out check to record nothing and try again on a later delivery, so that a failure costs nothing permanent.
16. As the owner, I want telemetry for every check (targets, kept, pronouns, dropped spans, failures), so that live tables show whether it works.
17. As the Keeper (legacy paths where the Keeper writes), I want present people and the place to carry their kept look in the capsule, so that I keep them consistent too.
18. As the sole author, I want each present person's kept look and pronoun beside their reference, so that I can write them consistently without rereading history.
19. As the sole author, I want the current place's kept look in the scene, so that a revisit matches.
20. As a package author, I want kept looks recorded whatever package granted the improvisation, so that my package needs no host code for it.
21. As a tester, I want a live comparison on the same seed with a person met twice and a place revisited, so that consistency is judged by play.

## Implementation Decisions

- No new entity schema and no new store family. Looks live on the first-sight ledger (`first-sight.json`, beside
  `shown` and `open`) as `looks: {people: {<handle>: Look}, places: {<handle>: Look}}`, with
  `Look = {excerpts: string[], pronoun?: "he"|"she"|"they", turn, at}`. Same commit and fork machinery as §168.5:
  written after the turn closed, committed with the next turn, the turn record carries `looks` for the fork carry.
- Keys are the graph handle after identity survival (§192), as first sight keys them. People are `npc` nodes the table
  can see (`seenPerson`), including table people (§87); places are the active scene, including table-minted and
  Enhanced Locations places (they are projected scenes).
- Kernel RPC `table.looks.job {campaign, turn}` returns `{turn, prose, earlier?, targets: [{kind, id, name, want:
  ["look"|"pronoun"]}]}` or `{targets: []}`: the turn's delivered `rendered_text`, the delivery before it, and for the
  scene the turn ended in, the place and present seen people still missing a look or (people) a pronoun. At most 8 targets.
- Kernel RPC `table.looks {campaign, turn, items: [{kind, id, excerpts?, pronoun?}]}`: checks closed shapes and graph
  references; keeps an excerpt only when it is located in that turn's delivered text (the §139 locator) and at most
  240 characters; at most 3 excerpts per person and 5 per place; `pronoun` from the closed list. First write wins per
  field; a field already kept is reported `already_kept` and not changed. Returns `{recorded, dropped}`.
- Pronoun is a closed enum of how the prose refers to the person; the decision is the model's, never a keyword or
  character test. `they` covers a person the prose deliberately keeps unspecified; absence means not yet established.
- The check is part of the first-sight lane (`runtime/jev/first-sight.ts`), a second question set run in the same
  after-delivery hook, not a new lane: same model choice, watchdog, thinking off, no `temperature`/`top_p`, never
  awaited by the delivery. It qualifies as a single completion under Agents.md as first sight does.
  - Legacy path: one zero-tool completion answering `{targets: [{id, excerpts: [...], pronoun?}]}`, excerpts copied
    from `prose` (or `earlier`) exactly; the host locates each before sending.
  - Native path: typed choices over the prose's sentence units (the existing `firstSightUnits` segmenter): per unit,
    which target's look it shows, or none; per person target, the pronoun the prose uses, or not established.
  - The instruction excludes from a look: names, history, motives, knowledge, relationships, anything said, actions
    that are events. Units mixing a look with such content are not kept.
- Readers. The capsule's `present` rows (`npcReferenceView` callers) gain `look` (excerpts joined, the people's
  budget respected) and `pronoun` when kept; the current place row gains `look`. Untold people keep their look (what
  they look like is seen) but never a name. The sole author's `decision_context.people[]` and `scene` pass them through;
  `DECISION_AUTHOR_INSTRUCTION` gains one sentence: a supplied look and pronoun are what earlier deliveries showed; keep
  them, add detail only within a granted improvisation, never contradict.
- Interaction with §254.6: `appearance` applies to a person "the source leaves undescribed ... or no appearance is
  supplied"; a kept look is a supplied appearance, so the grant no longer reaches a person who has one.
- Telemetry: `{lane: "first-sight", event: "looks", turn, targets, kept: {people, places}, pronouns, dropped, ms, model}`
  and the kernel's `recorded`/`dropped` rows; failures use first sight's closed reasons.

## Testing Decisions

- Good tests drive the real kernel process through RPC and assert on what a later capsule and author input carry, not
  on internals.
- Kernel (real process, `tests/extension` kernel tests like `first-sight` ones): job targets; spans not in the
  delivered text dropped; first write wins; pronoun enum; looks appear on `present` and place rows of the next capsule;
  a fork carries them.
- Host lane (pure functions plus the lane with a stubbed completion, as the first-sight lane tests): shape check,
  anchoring against prose, legacy and native paths, failure records nothing.
- Author input (as `author-craft-sections` / `location-description-author` tests): `decision_context.people[]` carries
  `look`/`pronoun` and the scene carries `look`; instruction sentence present.
- Live: same seed on the Mac, MiniMax, a person met in turn N and again in turn N+k, a place left and revisited; compare
  before/after for look and pronoun drift. Never Opus.

## Out of Scope

- A unified entity schema or merging the per-person world maps (rejected by the owner 2026-10-22).
- Objects. Their instances already carry definitions; a kept look for a thing can follow the same ledger later.
- Names. The table's word for a person is §79's `person_labels`; a name never comes from this check.
- Updating a kept look when the story changes someone (a wound, new clothes). That is state, owned by settled effects.
- Looks of places or people not in the scene the turn ended in.
- Writing book descriptions back: the book's words stay the book's; a kept look only records what prose added or used.

## Further Notes

- Depends on nothing unmerged; it reads `rendered_text` and the existing first-sight hook. It merges cleanly beside
  `claude/author-craft-resolver` (§254), which edits the author's system prompt, not `people[]`.
- §255 is taken here; §254 is the author craft branch's.

## Comments
