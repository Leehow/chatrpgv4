# NPC mind, P0: honest decisions and a communication ledger

Status: ready-for-agent (owner approved 2026-10-23: "按他的推荐来就行" — 5-level disposition model, P0 first)

Contract: `docs/kernel-rpc.md` §258 (written by ticket 02). Design: `docs/research/npc-schema-v3-20261023.md`
(the whole NPC schema; this spec is its first phase only). Evidence and review: project files `npc-redesign/`
(module survey of 15 books, rulebook rules, owner's DeepFiles runbook, 13 systems' verified schemas, two rounds of
web-ChatGPT review). Owner thread: "NPC 系统重新设计".

## Problem Statement

People in play repeat themselves and repeat each other. In the 2026-10-23 Blood Road run (MiniMax, Esso station,
15 turns) "九点二十回来取货" was said in five turns and by two different people; Nate's and Russ's lines recurred
verbatim. The recorded author tasks and kernel state show one causal chain:

1. **The packet forces content.** `answer/ask/offer/clarify/report/warn` require non-empty content
   (`runtime/decision-content.ts:29`). At the opening, with nothing suitable, the Keeper filled Russ's offer with
   `service_at{items:["investigator_1"], when:09:20, fulfillment:takeaway}` — an appointment that exists nowhere.
2. **Memory turns words into everyone's promise.** The memory lane extracted a `promise` with every present
   person as a knower (`memory/candidates.jsonl` mem:t0-6).
3. **Bystanders receive it as their own content.** `npcCommitments` (`kernel-ts/npc/perspective.ts:72`) returns a
   promise for its subject **or any knower**, and `commitments` is a catalog material field
   (`runtime/decision-content.ts:79`). The same promise was issued to Russ (fact_6) and Nate (fact_7).
4. **Nothing records what was already said to whom.** Catalog rows carry no told marks; the Keeper reselects.
5. **The author is told to repeat.** `DECISION_AUTHOR_INSTRUCTION` (`runtime/isolated-expression.ts:159`):
   "including a repeated answer when the player asks again; history cannot cancel it".

Under v4 the deterministic writers of cognition, disclosure and commitments are dead (they lived on `apply.event`).
"Who said what to whom" exists nowhere; §257.17 `said` (branch `claude/exhibits-readable-signs`, unmerged) covers
testimony only and lives in host memory.

## Solution

P0 makes four changes, none of which touches the module reader:

1. **Honest decisions.** A person with nothing to add can say so: `knowledge_status` gains `nothing_more`, and the
   Keeper instruction says an `offer` needs something the person actually offers (otherwise greet/acknowledge).
   `service_at.items` may not name people.
2. **A communication ledger in four events** (ChatGPT review F1): *selected* (the packet chose content for a
   speaker and recipients), *expressed* (the author's say token for that response is present: `attested`, or
   `missing/truncated/malformed/empty`), *received* (addressed recipients and present listeners, by presence at
   publication), *believed* (not in P0: P0 writes no belief). Events carry stable ids and fold into
   `told[speaker][content][listener] = {new, refer, unverified, last_turn}`; everything rebuilds from turn records.
3. **Content identity and told marks.** Every catalog row issued to an actor carries a stable `content_id`
   (graph claim / exhibit / memory id / document / normalized constructor) and its told marks for each recipient.
   Each selected content item has a `strategy`: `new | refer | restate | clarify | update`. When a selected item was
   already told to that recipient and the Keeper gave no strategy, the host settles it as `refer` (no refusal, no
   extra Keeper round). `update` requires another new item in the same response.
4. **Commitments need an origin.** A delivered (`attested`) `offer` with a constructor creates a *Proposal* held by
   the speaker; acceptance (existing `player_acceptance`) makes a *Commitment* with obligor, beneficiaries and origin
   event. `npcCommitments` returns only obligor's own. Memory-lane promises without an origin event are quarantined:
   kept as memory, never issued as anyone's content. A bystander who heard a promise gets nothing as their own.

The author renders `refer` as a brief back-reference in new words (repeated asks show in the person's register),
`restate` as a restatement, `clarify` as an explanation, `update` with what changed. The "history cannot cancel it"
sentence is replaced. The say token carries the response unit: `{{say:npc_2|U1}}…{{/say}}` (one unit per selected
response, host-minted; unknown units are protocol errors, never new content).

## User Stories

1. As a player, I want a person who has nothing new to say to say so in character, so that I am not handed invented offers.
2. As a player, I want no appointment or promise I never agreed to, so that I can trust deals.
3. As a player, I want one person's offer to stay theirs, so that a bystander never repeats it as their own.
4. As a player, I want a person who already told me something to refer back to it, so that conversation moves on.
5. As a player, I want to be able to ask someone to repeat or explain, so that I can still get it again when I need it.
6. As a player, I want what people told me to survive leaving, returning and reloading, so that state is stable.
7. As the Keeper model, I want every selectable item marked with who has been told and how often, so that I choose what is new.
8. As the Keeper model, I want to pick how a repeat is said (refer, restate, clarify, update), so that I keep judgment over the exchange.
9. As the Keeper model, I want to see that an item was planned last turn but its delivery is unverified, so that zero counts do not mislead me.
10. As the author, I want each repeat delivered with its strategy and count, so that I know how to word it.
11. As a maintainer, I want who-said-what-to-whom as stable events rebuildable from turn records, so that NPC memory is testable.

## Implementation Decisions

- **Ownership.** Selection events come from the hydrated packet responses; expression from the committed say tokens;
  reception from `npc_presence` at publication (P0: speech channel only). Proposals and commitments live in a world
  ledger indexed by obligor, not inside NPC state. No model writes any of these directly.
- **Persistence.** Selections ride host-only in `_delivery_evidence.selections` to the narrate commit and are stored
  in the turn record with the expression outcomes (`record.communication`). Folds (`told`, proposals, commitments)
  are derived files rebuilt from `turns/*.json` (`rebuildCommunication`), like `rebuildNpcLedger`.
- **Event identity.** `{campaign, worldline, loop, turn, seq}` plus a content hash; replays are idempotent; another
  worldline or loop starts its own counts (people who `remembersAcrossLoops` keep theirs).
- **Content identity.** Explicit per source kind; never a hash shared across kinds. Two memory candidates restating
  the same promise stay distinct unless they share an origin event.
- **Strategy default.** Absent strategy on a told item → `refer`. Absent strategy on an untold item → `new`. The next
  capsule notes a host-defaulted `refer` once.
- **Unverified delivery.** `missing/truncated/malformed/empty` count as `unverified`: shown to the Keeper, never
  counted as knowledge transfer, never creating a Proposal.
- **§257.17.** Testimony `said` becomes `told.new > 0` for any investigator; the in-memory set is dropped when this
  lands (rebase on the signs branch if it merges first).
- **Disposition model (owner decision).** Five levels `hostile|unfriendly|neutral|friendly|ally` plus optional
  trust/fear/pressure 0–5 and a separate control state. P0 only documents it in §258; implementation is P1.
- **Budgets.** Told marks add at most 120 bytes per catalog row; at most 6 told rows per present person reach the
  Keeper; the author receives strategy + count only.
- **Prompts** are edited in place; no appended reminder sections.

## Testing Decisions

- Through public seams: packet → settle → publish → next catalog / author input / rebuilt folds. No assertions on
  private fold structures.
- Golden fixture from the Blood Road run (turn records 0–15, anonymised): after rebuild, no commitment exists; Russ
  holds no Proposal for 09:20 (the offer was never accepted and its constructor names a person, so the new check
  refuses it); Nate's catalog has no row of Russ's.
- ChatGPT review tests 1–3 adapted as acceptance: no invented 09:20 when nothing fits; a real offer heard by Nate
  stays Russ's; a second ask is answered as refer/restate without losing new information.
- Prior art: `tests/extension/*decision-content*`, `repeatedLines` tests, §257.17 tests on the signs branch.
- Live: owner's Mac, MiniMax for every lane (never Opus), Blood Road PDF.

## Out of Scope (P1–P3 in the design doc)

- Belief events, three-layer knowledge, GateExpr, disclosure rules, social difficulty derivation, attitude storage.
- Reader changes (NPC definition reads), schedules, triggers, phases, cohorts, per-audience author projection.
- Migration and targeted re-reads of old graphs.

## Further Notes

- The verbatim-repeat count (same-speaker shared run ≥ 12 chars) stays a quality metric, not the correctness test.
- `semantic_verified` is always false: the say token proves attribution, not meaning.
