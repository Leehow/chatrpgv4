# NPC mind: a talk ledger, held knowledge and commitments for every person

Status: draft, awaiting owner review (not ready-for-agent until the owner approves)

Contract: `docs/kernel-rpc.md` §258 (written by ticket 01). Owner request 2026-10-23 (project thread
"NPC 系统重新设计"): people repeat themselves; redesign NPC management after studying how RPGs and open engines
manage NPC parameters, conversation records and what each person knows. Sandbox first is the owner's standing
preference (ticket 00).

## Problem Statement

In the 2026-10-23 Blood Road run (MiniMax, Esso station, A → diner → A, 15 turns) people repeated lines the book never
gave them: "九点二十回来取货" in five turns and from two different people, "中午十二点去最后一站" twice in one turn,
Nate's "这加油站最近怎么样" verbatim, Russ asking "你去哪、待多久" again. §257.17 `said` only covers testimony
exhibits, so none of these were caught. The evidence (owner's Mac,
`chatrpgv4-wt-module-units/.coc/test-runs/module-exhibits-live-20261022/signs/home/.coc/`) shows one causal chain:

1. **Forced content becomes a fake appointment.** Opening, turn 0: `answer/offer/ask` require non-empty content, so the
   Keeper filled Russ's offer with `service_at{provider:npc_2, items:["investigator_1"], when:09:20, fulfillment:takeaway}`
   (expression task `1c7aed00…`). The author spoke it as "如果你九点二十分来取……". Nothing in the book or the
   player's input asked for it.
2. **Memory turns spoken words into a promise everybody holds.** The memory lane extracted
   `promise: 拉塞尔承诺……九点二十回来取货` with `knowers` = everyone present (`memory/candidates.jsonl` mem:t0-6, mem:t2-2).
3. **Bystanders get the promise as their own content.** `npcCommitments` (`kernel-ts/npc/perspective.ts:72`) returns a
   promise for a person who is its subject **or any knower**; `commitments` is a `MATERIAL_FIELDS` field
   (`runtime/decision-content.ts:79`), so the catalog issued the same promise as `fact_6` for Russ and `fact_7` for Nate.
   Nate then "confirmed" Russ's pickup time in his own words (turn 2).
4. **Nothing says the listener already heard it.** Catalog facts carry no "told to whom, how often". Facing "answer
   needs content", the Keeper reselected the one commitment it had, turn after turn.
5. **The author is told to repeat.** `DECISION_AUTHOR_INSTRUCTION` (`runtime/isolated-expression.ts:159`): "Every
   current selected response must still be rendered, including a repeated answer when the player asks again; history
   cannot cancel it." The repeat detector (`repeatedLines`) only produces a warning for the next Keeper capsule; the
   author never sees it.

Underneath: in v4 the deterministic writers for cognition, disclosures and commitments are dead (they lived on
`apply.event`, wiring audit N1/N2). What a person said is recorded four different ways (turn `speech[]`, ledger
`said`/`spoke` pointers and counters, `recent_speech` text, memory candidates), none of them keyed by **what was
communicated to whom**. The §257.17 `said` set lives only in host memory and is lost on reload.

## What other systems do (summary; full notes in the project file `npc-redesign/调研笔记.md`)

| System | Mechanism | What we take |
|---|---|---|
| Inform 7 Threaded Conversation, Emily Short | quips are `said/unsaid/repeatable`; facts known/unknown per character incl. the player; NPCs learn facts they overhear; a repeated question is answered by recalling, not restating | per (speaker, fact, listener) told state; overhearing; "recall instead of repeat" |
| Ink, Yarn Spinner | visit counts, `once`; Yarn saliency `Best Least Recently Viewed` (most specific, then least shown) | counters on every selectable item; prefer what has not been said |
| Valve Dynamic Dialog (Ruskin, GDC 2012), Hades | rules match facts, most specific wins; after a line, facts are written back; every line has an id and a played record | after every delivered line, a deterministic write-back keyed by id |
| Talk of the Town (Ryan et al., AIIDE 2015) | belief facets with evidence: observation, statement, lie, eavesdropping, mutation, forgetting; source, time, location kept | each held proposition has a source (book, saw, told by X, overheard), so a lie or rumour keeps its origin |
| Generative Agents (Park et al. 2023), MemGPT | memory stream with recency/importance/relevance; core memory edited only through tools | the narrator gets a briefing built from state, not raw history; only one path writes state |
| Bethesda CK, Disco Elysium | `Say Once`, info refusal, displayed status per node; disposition per actor | displayed status per item; attitude is per target |
| Tabletop (Alexandrian, Blades clocks, CoC NPC cards) | knows / volunteers / tells if asked / won't tell; clocks advance with time | disclosure tier per held fact; commitments have due times so the situation changes instead of the line |

Common lesson: no engine relies on the realiser to remember. State is written deterministically after delivery and
read as eligibility marks before the next choice; repeated questions are answered by reference, not by replay.

## Solution

Every person gets a **mind**: three persisted ledgers, all written by the host from settled, delivered facts, and one
read model that both the Keeper and the author see a slice of.

1. **Talk ledger** (new, `talk.jsonl` in the campaign, rebuildable from `turns/*.json`): one row per delivered
   interaction: `{id:"talk:tN-k", turn, clock, scene, speaker, to[], heard_by[], act, items[], delivery}`.
   `items` are canonical **prop keys** (below); `heard_by` is everyone present when it was spoken (presence evidence,
   not a claim); `delivery` is `full | partial | none` from the speaker's say spans in the committed text. Written by a
   deterministic post-publication writer reading the packet's hydrated `interactions` and the committed `speech[]`.
   This replaces the dead `apply.event` disclosure/cognition writers and the in-memory §257.17 `said` set.
2. **Held knowledge** (per person): `{holder, prop, status: knows|believes|hides|lies_about, source, tier}`.
   Seeded from the graph (`knows/believes/asserts/hides` claims, testimony exhibit owners, `would_lie_about`);
   `source` is `book | observed | told{by,talk} | overheard{by,talk}`; `tier` is `volunteers | if_asked | pressed |
   never` (from the graph when given, else `if_asked`). A talk row adds `told`/`overheard` entries for every person in
   `to`/`heard_by`: the listener now knows "*X said P*", attributed, never P as their own claim.
3. **Commitments** (per promisor): `{id, by, to[], what, due?, status: offered|open|kept|broken|withdrawn, made_in:talk}`.
   `what` is the typed constructor value (`service_at`, `planned_visit`, …). A delivered `offer` creates `offered`; the
   existing `player_acceptance` turns it `open`; kernel outcomes (purchase, arrival) or a Keeper command close it.
   A commitment exists **only** with a backing talk row. Memory-lane promise candidates without one are kept as
   memory but are not issued as anyone's content.
4. **Prop key** — the identity of "the same thing said": graph claim id, exhibit id, memory candidate id, document
   id, or for a constructor `sha256(predicate + normalized params)`. Two rows with the same key are the same
   communication. `told[(speaker, prop, listener)] = {times, first_turn, last_turn}` is a fold over the talk ledger.
5. **NPC sheet** (read model, `npc.sheet`): identity and parameters (module profile, personality, variation, voice,
   stats/skills), state (presence, activity, mood, condition), agenda (goals, fears, intents), attitude **per target**
   (directed relationship affinity, ledger stance, first-impression result), held knowledge with told marks, open
   commitments with due status, last three own lines. `table.capsule present[]` and the author's `people[]` are slices
   of this one model instead of separate ad-hoc projections.

**Keeper side.** Every catalog row (fact, exhibit, constructor echo) carries `told:{to:[investigator_1], times, last_turn}`
for the actor it is issued to. A person is issued only props they hold as their own (book, observed, own commitment);
a prop they only heard is issued as `heard` and may be selected only in `report`, reaching the author attributed
("拉斯说过……"). A new content kind `{told_ref:"talk_N"}` means "refer back to what I already said". If the Keeper
selects a prop already told to the same recipient as fresh content, the host converts it to `told_ref` (no refusal,
no extra round trip) and the next capsule says so once. `knowledge_status` gains `nothing_more`, so "answer" has an
honest content when a person has nothing new; forced content stops producing invented appointments.

**Author side.** A `told_ref` claim reaches the author as `{kind:"callback", gist, times, last_turn}`. The instruction
"history cannot cancel it" is replaced: a callback is a short back-reference in new words; at times ≥ 2 the person
shows it (terse, impatient, or asks why the question again) in their own register; never reuse a sentence from
`recent_public`. `people[]` gains `told_you` (≤ 6 gists of what this person already told the investigators) and
`commitments` (open ones they made, with due status), so the author does not invent a second appointment.

**World side.** An open commitment whose `due` has passed is shown in the Keeper card as `due` / `overdue`, so the
situation changes (Blades clock idea) instead of the line repeating.

## User Stories

1. As a player, I want a person who already told me something to refer back to it instead of reciting it, so that conversation moves forward.
2. As a player, I want a person I ask the same thing twice to notice, so that people feel like they remember me.
3. As a player, I want one person's promise to stay theirs, so that a bystander does not repeat another person's appointment as if it were their own.
4. As a player, I want a bystander who overheard something to be able to tell me "he said …", so that gossip and overheard talk work.
5. As a player, I want no appointment, price or promise I never heard of, so that I can trust what people agreed.
6. As a player, I want a promise that was really made to be kept, broken or come due, so that commitments matter in the fiction.
7. As a player, I want a person with nothing new to say to say so in character, so that I am not given filler.
8. As a player, I want people to keep what they told me after I leave and come back or reload, so that state survives play.
9. As a player, I want lies and deflections to keep their origin, so that if I repeat a lie to someone else, it travels as a lie.
10. As a player, I want a person's attitude toward me and toward my companions to be separate, so that relationships are directed.
11. As the Keeper model, I want every selectable item marked with who has already been told and how often, so that I choose what is new.
12. As the Keeper model, I want an honest "nothing more" content, so that a required answer never forces me to invent one.
13. As the Keeper model, I want a person's open commitments and their due status in their card, so that I can make the world act on them.
14. As the author, I want repeats delivered as callbacks with a count, so that I know how to word them.
15. As the author, I want each person's "already told you" gists, so that I never restate them in a different scene.
16. As a maintainer, I want one deterministic record of who said what to whom, rebuildable from turn records, so that NPC memory is testable and not probabilistic.

## Implementation Decisions

- **One write path.** Only the post-publication talk writer creates talk rows; knowledge and commitment entries are
  folds over talk rows plus graph seeds plus kernel receipts. No model writes the ledgers directly. The memory lane
  keeps extracting free prose (player assertions, things said outside interactions) but its promise candidates no
  longer feed `commitments`.
- **Delivery evidence decides.** A planned interaction whose speaker has no say span in the committed text is
  `delivery:none` and teaches nobody; partial spans give `partial` (prop recorded with `partial:true`, listeners'
  knowledge marked uncertain). This keeps the v4 rule "author completion alone does not prove it was spoken".
- **Storage.** `talk.jsonl` next to `npc-ledger.json`, committed in the same store transaction as the turn; a rebuild
  (`rebuildNpcMind`) folds `turns/*.json`. Knowledge and commitments are derived files (`npc-mind.json`) rebuilt the
  same way, so old campaigns gain the ledger on first open.
- **Scope.** Per play line (campaign, worldline, loop), like §257.17; a new loop resets `told` unless the person
  `remembersAcrossLoops`.
- **§257.17 is subsumed.** Testimony `said` becomes `told.times > 0` for any investigator; the in-memory set is removed.
- **Bystander rule.** `npcCommitments` and every `MATERIAL_FIELDS` source issue a row as the person's own only when
  the person is the subject/holder; knower-only rows become `heard` rows usable in `report`.
- **Conversion, not refusal.** A repeated prop to the same recipient is converted to `told_ref` by the host; refusing
  would add a Keeper round trip to the slowest step of the turn.
- **Budgets.** Keeper card adds ≤ 400 bytes per present person (told marks are numbers; gists only in the author
  slice). Author `told_you` ≤ 6 × 120 chars per person; only people in this turn's responses.
- **Prompts.** The v4 Keeper and author instructions are edited in place (contradictory lines removed), not appended.
- **Not changed:** kernel rules, checks, purchases, presence; the packet's command set except the new content kind
  and the `nothing_more` status.

## Testing Decisions

- Behaviour through the public seams: the packet → settle → publish → next catalog/author input. Tests assert what
  the next Keeper catalog and author `decision_context` contain, not internal fold structures.
- Fixture from the Blood Road run (anonymised turn records 0–15) as a golden replay: after the rebuild, Russ holds one
  `offered` commitment; Nate and Steve hold it only as `overheard`; the catalog for turn 2 marks it `told.times:1`.
- Prior art: `tests/extension/*decision-content*`, `§257.17` said-mark tests on `claude/exhibits-readable-signs`.
- Live acceptance on the owner's Mac with MiniMax (never Opus), Blood Road, scripted repeat questions.

## Out of Scope

- NPC schedules and off-screen movement (Radiant-AI style packages).
- Generative-Agents style reflection or embedding retrieval; the cast is small enough for keys and counters.
- Rumour mutation and forgetting (Talk of the Town deterioration).
- Reviving the npc-voice lane; voice stays §257.16 exhibits plus profile.

## Further Notes

- Ticket 00 (sandbox) runs first: replay recorded author tasks with callback/told_you marks against MiniMax and count
  verbatim repeats, before changing the kernel.
- `claude/exhibits-readable-signs` (unmerged) contains §257.17; ticket 02 must land after it merges or rebase on it.
