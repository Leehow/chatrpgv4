# Author craft skills: writing craft reaches the sole author

Status: ready-for-agent

Contract: `docs/kernel-rpc.md` §254. Owner decisions 2026-10-22 (project thread "作者文字优化 skill 范式"): the core
owns what the text must be faithful to, never the craft of writing it; all craft lives in Mods as author-only skills;
the author stays one tool-free call; skills are chosen before it, mostly automatically from the settled turn, with the
Keeper requesting only rare special techniques (deferred, see Out of Scope).

## Problem Statement

Since the structured Keeper, a separate sole author writes every player-facing word, but the prose package's craft
(how sentences, atmosphere, people and a newly reached place are written) still rides the Keeper's request, which no
longer writes prose. The author sees only the core's fidelity instruction, a few style lines and two package sections
reached through host code written for one heading each. The player reads prose written without the craft the packages
were built to supply, the Keeper pays for craft it cannot use, and the same rules are repeated across the core,
packages and lanes. A package author has no way to give the writer craft except asking for host code.

## Solution

A package declares any of its instruction sections as an author section, naming a slot and the settled facts that send
it. After the Keeper's packet settles, the host evaluates a closed list of facts from what actually happened (someone
spoke, a new place is being established, the opening, a place changed, a routine stretch), picks the matching author
sections from active packages (one per slot, later package wins), reads them version-locked, and appends them to the
author's system prompt under a frame that says they shape wording only. The author also receives what an establishing
reply must convey. The prose package splits its text along three layers: the Keeper keeps the decisions, the core keeps
the delivery contract, and the author receives the craft. The two existing one-heading routes become ordinary author
sections. When the Keeper itself writes (legacy paths), it receives the author sections as before.

## User Stories

1. As a player, I want narration that follows the prose package's craft, so that scenes read as a Keeper speaking, not as a report.
2. As a player, I want a newly reached place established along the eye's path with people, things, senses, period and a hook, so that I am in the place.
3. As a player, I want the opening to set the table (where, when, why I am here), so that a new player knows what they need.
4. As a player in a Chinese game, I want NPC speech that sounds like natural spoken Chinese, so that people talk like people.
5. As a player, I want a failed move never to be written as an arrival, so that prose matches the dice.
6. As a player, I want craft never to add facts, people, clues or events, so that what I read is what the rules settled.
7. As a player, I want routine stretches summarized briefly and ambient detail kept as texture, so that quick settlement keeps working.
8. As a player, I want place descriptions to keep using the location package's guidance, so that places stay consistent.
9. As the owner, I want the core to hold no prose craft, so that changing style means changing a package, not core prompts.
10. As the owner, I want the Keeper's request free of craft it cannot use, so that its context goes to decisions.
11. As the owner, I want every turn's chosen craft recorded with its reason, slot and bytes, so that a turn whose prose got worse can be explained.
12. As the owner, I want craft text capped, so that the author's first text is not delayed by unbounded prompts.
13. As the owner, I want skills selected from settled facts by the host, so that no model call or Keeper attention is spent picking them.
14. As a package author, I want to mark a section as author-only with a slot and facts in `sections.json`, so that I can ship writing craft without host code.
15a. As a package author, I want to declare that my section needs the author to complete detail no source gives (a place's ordinary surroundings, an undescribed person's looks), so that immersive description has explicit, bounded permission.
15. As a package author, I want my package's settings to reach the author with its craft, so that toggles like coarse language still work.
16. As a package author, I want a clear refusal when my declaration is malformed (unknown fact, bad slot, selectors on an author section, missing capability), so that I fix it at install.
17. As a package author, I want two packages filling the same slot resolved by load order with the loser recorded, so that conflicts are predictable.
18. As a package author, I want my author sections hidden from the Keeper's index and its `mod` read verb, so that the Keeper is not distracted by craft.
19. As a package author, I want byte changes to keep requiring a version bump, so that locked campaigns stay reproducible.
20. As a maintainer, I want the place-description and routine-summary special cases removed, so that there is one path to the author.
21. As a maintainer, I want an author section that cannot be read to stop the turn with a named cause, so that nothing is silently substituted.
22. As a maintainer of legacy paths, I want the Keeper to receive author sections when it is the writer, so that turning the packet path off loses no craft.
23. As the owner, I want the establish duty's owed rows delivered to the author as contract data, so that what must be conveyed is not mixed into craft.
24. As a tester, I want a live comparison of the same inputs before and after, so that the change is judged by play, not by rule counts.

## Implementation Decisions

- Declaration: a new section kind `author` with `slot` and `on`, behind a new package capability; no topics, gates,
  triggers or threshold; schema 1 and 2. The capsule's indexed row carries it with its key, slot, facts and bytes.
- Bounded improvisation (owner 2026-10-22): an author section may grant `surface_detail` or `appearance`, a closed core
  list whose limits the core defines once in the author's prompt; the package says where it is wanted and how to write it.
- Settled facts are a closed host list: `always`, `speech`, `establish`, `opening`, `place`, `routine`, each defined
  in §254.2 from post-settlement data only.
- A package whose sections are all author sections carries an empty resident text for the Keeper.
- Host resolver module (kernel extension side): input is the post-settlement capsule, the author's decision context
  and the packet; output is the ordered craft text plus a telemetry record. Slot resolution by load order; byte cap
  32768 on section text, omitting last first; read failure is an author-input failure.
- The author system prompt appends one framed craft block after the core instruction and transport note.
- `decision_context.establish = {why, owes}` when the establish duty holds after settlement.
- Place description and routine summary become author sections of their packages (version bumps); the
  location-description and routine-instruction plumbing is retired; the routine keeps `{acts, ambient?}`.
- narration-craft is split by layer: Keeper resident text keeps what the turn puts at issue, how far an action is
  carried, how a person decides what to say, and state recording; author sections carry sentences, register and
  atmosphere, people's portrayal and speech craft, scene detail (slot per concern), establishing a place
  (`establish`) and opening the table (`opening`). Markup conventions stay core (the author instruction owns
  `{{say:npc_N}}`). Minor version bump with changelog.
- zh-optimize becomes sectioned; its speech guidance is an author section on `speech`. Expression cards are unchanged
  in this spec.
- Keeper-writes fallback: when the decision-author path is off, the host's Keeper section message carries every
  author section of schema-1 packages every turn.
- Keeper capsule head rewrites (`instruction-audience`) and duplicated core craft are not touched here.

## Testing Decisions

- Test external behavior at the highest seams: the kernel's package parse and capsule rows (real kernel process via the
  integration support), the host resolver as a pure function over capsule-shaped input, and the author system prompt
  as produced for a settled turn.
- Prior art: `tests/extension/reference-instruction-sections.test.mjs`, `tests/extension/location-description-author.test.mjs`,
  `tests/extension/quick-settlement-mod.test.mjs`, the shipped package instruction-budget and version tests.
- A failed move with an arrival-only skill must not send it; a speech-only turn sends speech craft; slot conflicts and
  the byte cap are deterministic.
- Heavy suites run on the LAN test box; live acceptance follows Agents.md (MiniMax 3.1 medium, real driver, one input
  per turn) with the same retained seed before and after.

## Out of Scope

- The Keeper's optional `author_craft.requests` for special techniques (no package ships one yet; adding the field
  without a consumer would be a dead seam).
- Moving expression cards, voice masks, the speech-edit lane or narration-audit.
- Removing core duplicated craft (capsule head first-sight lines, `instruction-audience` rewrites, Keeper prompt lines).
- Discovery-v2 packages' author sections in the Keeper-writes fallback.

## Further Notes

Risk named by the design review: decisions hidden inside craft text. The split is by layer, not by file; the Keeper's
resident text must keep every sentence that decides what happens.

## Comments
