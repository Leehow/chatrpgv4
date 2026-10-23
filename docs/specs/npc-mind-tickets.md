# NPC mind: tickets

Spec: `docs/specs/npc-mind.md`. Contract: `docs/kernel-rpc.md` §258.

Task graph: 00 first (sandbox; its result may change 05/06). Then 01; then 02, 03 in parallel; 04 after 02; 05 after
02 and 03; 06 after 05; 07 after 02, 03, 04; 08 last.

## 00: Sandbox: does a callback mark stop the author repeating?

**What to build:** an `experiments/npc-mind/` probe that takes the recorded author tasks from the Blood Road run
(`expression-writes/*/task.json`), adds `told_ref` callbacks and `people[].told_you` by hand from the turn records,
swaps the "history cannot cancel it" sentence for the callback rule, and reruns the author with MiniMax (A = recorded
input, B = marked input).

**Blocked by:** None.

**Status:** ready-for-agent after owner approval

- [ ] A/B over the 6 tasks that repeated "九点二十" / "中午十二点"; count same-speaker shared runs ≥ 12 chars (`repeatedLines` rule).
- [ ] B keeps every selected claim perceptible (the player still gets an answer) and adds no fact.
- [ ] Notes in project files `npc-redesign/probe-results/`.

## 01: Talk ledger (tracer bullet)

**What to build:** §258 in `docs/kernel-rpc.md`; post-publication writer that turns hydrated `interactions` + committed
`speech[]` into `talk.jsonl` rows with prop keys, `to`, `heard_by`, `delivery`; rebuild from `turns/*.json`.

**Blocked by:** None (after 00 reports).

**Status:** draft

- [ ] A delivered answer writes one row per interaction; an interaction with no say span writes `delivery:none`.
- [ ] `heard_by` equals presence at publication; an NPC-to-NPC exchange records both.
- [ ] Rebuilding from turn records reproduces the same rows; a reload keeps them.
- [ ] Prop keys: same graph claim / exhibit / normalized constructor → same key.

## 02: Told marks in the Keeper catalog

**What to build:** fold `told[(speaker, prop, listener)]`; every catalog row issued to an actor carries
`told:{to,times,last_turn}`; §257.17 in-memory `said` replaced by the fold.

**Blocked by:** 01.

**Status:** draft

- [ ] Turn-2 catalog in the Blood Road fixture marks Russ's pickup offer `told.times:1` for investigator_1.
- [ ] Testimony `said` survives a host restart.
- [ ] Catalog byte budget test: ≤ 400 extra bytes per present person.

## 03: Commitments with a backing talk row

**What to build:** commitment fold (`offered → open → kept|broken|withdrawn`) from talk rows, `player_acceptance` and
kernel receipts; due/overdue from the clock; `npcCommitments` issues only the promisor's own; memory promise
candidates without a talk row are not issued as content.

**Blocked by:** 01.

**Status:** draft

- [ ] Fixture: Russ holds one `offered` commitment; Nate and Steve hold none of their own.
- [ ] A purchase receipt matching an open `service_at` closes it `kept`.
- [ ] An open commitment past `due` shows `overdue` in the Keeper card.

## 04: Held knowledge and overhearing

**What to build:** knowledge entries seeded from graph claims, testimony owners and `would_lie_about`, with `tier`;
talk rows add `told/overheard` entries with attribution; heard-only props are issued as `heard`, selectable only in
`report`, and reach the author attributed.

**Blocked by:** 02.

**Status:** draft

- [ ] A bystander selecting another person's prop in `answer` is refused naming `report`; in `report` the author claim reads as attributed speech.
- [ ] A lie told to the investigators and repeated by them to another NPC keeps `source: lie` in that NPC's entry.

## 05: Keeper packet: `told_ref`, conversion, `nothing_more`

**What to build:** content kind `{told_ref}`; host converts a repeated fresh selection to `told_ref`; `knowledge_status`
gains `nothing_more`; v4 Keeper instruction edited in place (repeat rule, bystander rule).

**Blocked by:** 02, 03.

**Status:** draft

- [ ] Selecting a told prop as fresh content settles as `told_ref` and the next capsule notes it once.
- [ ] `answer` with only `knowledge_status:nothing_more` is valid.
- [ ] Opening turn fixture: no `service_at` is needed to make an `offer` valid when the book gives none (offer may be omitted).

## 06: Author: callbacks, `told_you`, commitments

**What to build:** `callback` claim rendering; `people[].told_you` and `people[].commitments`; replace "history cannot
cancel it" with the callback rule and escalation by `times`.

**Blocked by:** 05.

**Status:** draft

- [ ] Author input for a repeated question has a `callback` claim and no full restatement of the earlier claim.
- [ ] Instruction test: the old sentence is gone; no new appended reminder section.

## 07: NPC sheet read model

**What to build:** `npc.sheet` RPC (identity/parameters, state, agenda, attitude per target, knowledge with told marks,
commitments, last three lines); `table.capsule present[]` and author `people[]` become slices of it.

**Blocked by:** 02, 03, 04.

**Status:** draft

- [ ] Existing capsule/author tests pass with the slices; `toward_party` (audit N3) is filled from attitude per target.

## 08: Live acceptance

**What to build:** on the owner's Mac, MiniMax for all lanes, Blood Road PDF: Esso (ask the same three questions twice
each, A → diner → A, reload, ask again).

**Blocked by:** all.

**Status:** draft

- [ ] Zero same-speaker shared runs ≥ 12 chars across the run (`repeated_line` warnings = 0).
- [ ] No bystander states another person's commitment as their own.
- [ ] No appointment, price or promise without a backing talk row.
- [ ] After reload, told marks and commitments are unchanged.
