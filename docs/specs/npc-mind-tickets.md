# NPC mind, P0: tickets

Spec: `docs/specs/npc-mind.md`. Contract: `docs/kernel-rpc.md` §258. Design: `docs/research/npc-schema-v3-20261023.md`.

Task graph: 01 and 02 first, in parallel; 03 after 02; 04 after 02; 05 after 03 and 04; 06 after 05; 07 last.

## 01: Sandbox: the author renders refer/restate without repeating

**What to build:** run `experiments/npc-mind/callback-probe.mjs` on the owner's Mac (MiniMax) over the recorded Blood
Road author tasks: A = recorded, B = told items as `refer` with count, the "history cannot cancel it" sentence replaced.

**Blocked by:** None.

**Status:** ready-for-agent

- [ ] Same-speaker shared runs ≥ 12 chars counted per arm; B keeps every selected claim perceptible and adds no fact.
- [ ] Result notes in project files `npc-redesign/probe-results/`; wording of the author rule adjusted if B fails.

## 02: Communication events (tracer bullet)

**What to build:** §258 in `docs/kernel-rpc.md`; host mints one unit per selected response and passes
`_delivery_evidence.selections`; the say token accepts `{{say:npc_N|Uk}}`; the commit stores
`record.communication` (selected, expressed status per unit, received by addressed/present); `rebuildCommunication`
folds `told` from turn records.

**Blocked by:** None.

**Status:** ready-for-agent

- [ ] A delivered answer stores one selection, an `attested` expression and its receptions; a response whose unit has no say span stores `missing`.
- [ ] Unknown unit ids are protocol errors and create nothing; truncated/malformed/empty are recorded as such.
- [ ] Old say tokens without a unit still resolve speakers as before.
- [ ] Rebuild from turn records reproduces the folds; replay is idempotent; another worldline/loop has its own counts.

## 03: Content identity and told marks in the catalog

**What to build:** every catalog row issued to an actor carries `content_id` and `told` per recipient
(`new/refer/unverified/last_turn`); ≤ 6 told rows per present person; §257.17 `said` derived from the fold.

**Blocked by:** 02.

**Status:** ready-for-agent

- [ ] Same graph claim / exhibit / memory id / constructor → same `content_id` across turns; different kinds never collide.
- [ ] After a delivered answer, the next catalog marks that row `told.new:1` for that investigator; testimony `said` survives a restart.
- [ ] An unverified delivery shows `unverified:1` and the planned turn.

## 04: Honest decisions and commitment origins

**What to build:** `knowledge_status:nothing_more`; `service_at.items` refuses people; Keeper instruction lines for
"offer needs something offered"; Proposal from an attested offer, Commitment on acceptance, settled by kernel
receipts; `npcCommitments` returns only the obligor's; memory promises without an origin are quarantined from catalogs.

**Blocked by:** 02.

**Status:** ready-for-agent

- [ ] `answer` with only `nothing_more` is valid; `service_at` naming investigator_1 as an item is refused with a repair.
- [ ] Blood Road fixture: Nate's and Steve's catalogs carry no commitment row of Russ's; no row comes from mem:t0-6 / mem:t2-2.
- [ ] An accepted offer becomes a Commitment with obligor, beneficiary and origin event; a matching purchase receipt settles it.

## 05: Strategy on selected content

**What to build:** content items accept `strategy`; host defaults a told item to `refer`; `update` requires another
new item; the next capsule notes a defaulted refer once; hydrated claims carry strategy and count to the author.

**Blocked by:** 03, 04.

**Status:** ready-for-agent

- [ ] Reselecting a told item without strategy settles as refer and records `refer` in the fold.
- [ ] `restate` and `clarify` are honoured; `update` without a new item is refused naming the missing item.

## 06: Author rendering

**What to build:** replace the "history cannot cancel it" sentence with the strategy rule (from ticket 01's result);
render refer/restate/clarify/update; author instructed to tag each response's speech with its unit.

**Blocked by:** 05.

**Status:** ready-for-agent

- [ ] Instruction test: the old sentence is gone; no appended section.
- [ ] Author input for a repeated ask carries the strategy and count, not a second full claim.

## 07: Live acceptance

**What to build:** owner's Mac, MiniMax on every lane, Blood Road PDF from an empty home: Esso station, ask the same
three questions twice each, ask once "再说一遍", go to the diner and back, reload, ask again.

**Blocked by:** all.

**Status:** ready-for-agent

- [ ] No Proposal or Commitment without an origin event; no invented appointment at the opening.
- [ ] No bystander states another person's offer as their own.
- [ ] Repeats come as refer unless the player asked for a repeat; zero same-speaker shared runs ≥ 12 chars outside restate.
- [ ] After reload, told folds and commitments unchanged; full test suite green or failures listed against base.
