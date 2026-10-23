# Module exhibits: tickets

Spec: `docs/specs/module-exhibits.md`. Contract: `docs/kernel-rpc.md` §257.

Task graph: 01 first; then 02, 03, 05, 06 in parallel; 04 after 03; 07 after 02 and 05; 08 after 02 and 03; 09 last.

## 01: Exhibits are part of the graph contract

**What to build:** shard contract v5 with the optional `exhibits` array and its deterministic checker; v4 shards load
unchanged; §257 written in `docs/kernel-rpc.md`.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] A v5 shard with valid exhibits is accepted and its exhibits are readable from the accepted graph.
- [ ] A v4 shard (no `exhibits`) is accepted unchanged.
- [ ] Each checker refusal is a named reason: unknown carrier/owner, owners on the wrong kind, testimony/voice without owners, testimony owner without a knowledge relation, bad `teaches` target, missing `source_refs`, oversize surface, a person's known name literally in a surface.
- [ ] A refused exhibit is dropped with its reason; the rest of the shard is accepted.
- [ ] §257 documents shape, checker and the author boundary (`teaches`, `keeper_note`, `label` never reach the author).

## 02: The reader extracts exhibits in its existing reads

**What to build:** opening and detail read instructions extract exhibits for the nodes they make ready, with the
player-safety law, `{{who:}}`, carrier scoping and voice sample lines; `material: "exhibits"` detail reads; review
gains the player-safety item.

**Blocked by:** 01.

**Status:** ready-for-agent

- [ ] Reader instructions no longer forbid dialogue, mannerisms or read-aloud; they define exhibits as in the spec (English only).
- [ ] A detail read with `material: "exhibits"` is a valid read job and writes only exhibits for its focus.
- [ ] Review records a player-safety verdict per exhibit; a leaking exhibit is dropped with the reason.
- [ ] Instruction byte/content tests updated; sandbox reader probe rerun on the owner's Mac with MiniMax shows the five sandbox defects gone or recorded.

## 03: Revealing an exhibit (tracer bullet: document and perception)

**What to build:** the catalog issues `exhibit_N` for in-scope document/perception exhibits with Keeper label and clue
state; `reveal:[{exhibit_ref}]` settles; a taught clue is discovered through its existing validation in the same
atomic settlement; the author receives the surface only, with `{{who:}}` resolved and the verbatim note.

**Blocked by:** 01.

**Status:** ready-for-agent

- [ ] The Keeper catalog lists in-scope exhibits without surfaces; out-of-scope carriers are not issued.
- [ ] Revealing an exhibit that teaches a clue discovers the clue once; revealing it again does not rediscover.
- [ ] A missing check or absent carrier refuses the whole packet with a repair naming it.
- [ ] The author's decision input carries `{kind, channel, carrier, surface, stance}` and never `teaches`, `keeper_note` or `label`.
- [ ] `{{who:}}` resolves to the epithet before an introduction and to the name after.
- [ ] Issued, selected and refused exhibits and author exhibit bytes are in the decision-content telemetry.
- [ ] Packet guidance prefers the exhibit over `apply clue` when one exists.

## 04: Testimony, lies and deflections

**What to build:** testimony exhibits are issued with owners and stance; `interactions[].content:[{exhibit_ref}]`
binds only for an owner; lie/deflection carries the speaker-claim authority line to the author.

**Blocked by:** 03.

**Status:** ready-for-agent

- [ ] An owner speaking a testimony exhibit settles; a non-owner is refused with the owners named.
- [ ] A lie reaches the author as the speaker's claim with the authority line; a fact testimony has the plain line.
- [ ] A testimony that teaches a clue discovers it under the same rules as 03.

## 05: First sight only from player-facing material

**What to build:** first sight takes description/appearance exhibits, else hand-authored `properties.description`/
`appearance`, else undescribed; the summary and biography fallbacks are removed.

**Blocked by:** 01.

**Status:** ready-for-agent

- [ ] A scene with only a Keeper summary is undescribed; with a description exhibit it carries the surface.
- [ ] A person with only a biography is undescribed; with an appearance exhibit it carries the surface.
- [ ] Existing first-sight tests updated to the new sources; kept looks (§255) still win over exhibits for the same subject.

## 06: Voice reaches the author

**What to build:** voice exhibits ride in `decisionPerson` as `speech_style`; narration-craft and zh-optimize author
sections refer to it; both packages version-bumped with changelogs.

**Blocked by:** 01.

**Status:** ready-for-agent

- [ ] A present person with a voice exhibit has `speech_style` in the author input; without one, none.
- [ ] Package byte changes carry version bumps; mod version tests pass.

## 07: Legacy graphs get exhibits in the background

**What to build:** the first turn a scene without exhibits is current, the host queues one background
`material: "exhibits"` detail read for it; the turn never waits; clue disclosure keeps today's fact until it lands.

**Blocked by:** 02, 05.

**Status:** ready-for-agent

- [ ] Entering such a scene queues exactly one read; re-entering while queued or done queues none.
- [ ] The turn is not delayed by the read; when it lands the next catalog refresh issues the scene's exhibits.

## 08: Mid-play lookups can become exhibits

**What to build:** `lookup source prepare` yields exhibits through the same detail read; the tool description says
answers stay Keeper-only and prepare is how book material becomes disclosable.

**Blocked by:** 02, 03.

**Status:** ready-for-agent

- [ ] A prepare for an object's document produces a document exhibit the next catalog issues.
- [ ] `lookup source answer` output never reaches the author.

## 09: Live acceptance

**What to build:** a recorded live run on the owner's Mac (MiniMax 3.1 medium, real driver, one input per turn)
covering first sight, a found handout, testimony, a lie and a prepare-then-disclose lookup; evidence kept.

**Blocked by:** 03, 04, 05, 06, 07, 08.

**Status:** ready-for-human

- [ ] Author task inputs contain no Keeper text; prose carries the handout's content; `discovered_clues` written once.
- [ ] Findings and evidence paths appended under `## Comments` of the spec.

## Comments
