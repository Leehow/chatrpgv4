# Scene obligations as host-issuable candidates

Status: **ready-for-agent** (owner reviewed 2026-09-23 and answered Q1–Q7, recorded under "Owner rulings" below; the tickets in `scene-obligations-as-candidates-tickets.md` are scheduled inside the single-loop plan's SL-02 stage).
Branch: `0.9.5a` (written on `claude/scene-obligations-spec-20260923` from `d29fba981`).
Parent spec: `docs/specs/pi-native-single-loop.md` — this is the item its Out of Scope names ("Making the Mods and Director declare gatekeeper checks and scene obligations as candidates"), its user story 41, and its ruling **Scene data**.
Prototype this spec is bound to: `docs/specs/single-loop-step-routing.md` and `experiments/single-loop-routing/RESULTS-20260923.md` ("Misses and risks", first bullet).
Order (owner, 2026-09-23): the whole change is scheduled under SL-02 of the single-loop plan. SO-01/SO-02/SO-03 do not depend on the loop and run as SL-02 workers; SO-04 is the loop side and lands with SL-02's policy migration; SL-02's acceptance gains the morgue replay line (Rulings Q6).

## Why this spec exists (recorded verbatim)

The single-loop prototype (2026-09-23) showed that Jev carries out only the bookkeeping the player declared and answers `ask_llm` (0.74–0.89) for scene craft: who meets the investigator at the morgue and that it costs a Persuade are not facts the kernel or any Mod issues, so the Keeper is still called for them. The owner's ruling: only obligations the module states in its own text (a gatekeeper's check, a forced meeting, a scene's stated demand) become host-issuable candidates; "what usually happens" stays the Keeper's improvisation; the KP remains the boss and Jev the clerk (Jev is never the final decider; the Keeper decides whether to follow the book or improvise). Implementation comes after SL-02 of the single-loop plan.

## Problem Statement

On turn 3 of the 2026-09-23 haunting table the player said they would go to the *Globe*'s clippings morgue and get an old colleague to help them dig out the Corbitt House reports. The live Keeper spent six model calls on it. The single-loop replay took one of them away (the declared move) and stopped there: the remaining four adjudication calls were the Keeper staging Arty Wilmot, rolling his first impression, deciding that access costs a Persuade, staging Ruth Blake, and revealing the clippings. Jev routed every one of those to `ask_llm`, correctly, because nothing the host issues says that the morgue has a gatekeeper who demands a social check.

That is only half true, and the half that is false is the interesting part. The curated starter **already states the gatekeeper's check as data**: the morgue's `persuade-arty` affordance carries a typed `roll_gate` (`skill_check`, `regular`, four approaches — Persuade, Intimidate, Charm, Fast Talk — with the book's failure, fumble and push consequences), `search-clippings` and `befriend-ruth` carry `requires_completed_route_ids: ["persuade-arty"]`, and the scene carries `npc_presence_requirements` putting Ruth behind the same gate. None of it has a reader. `whereSection` (`kernel-ts/read/capsule.ts`) projects an affordance as `{id, cue, clue(s), npc}` and drops the rest; `roll_gate`, `requires_completed_route_ids` and `npc_presence_requirements` have zero consumers in `kernel-ts/`, `extensions/`, `runtime/` and the PipiCOC host; `initialWorld` (`kernel-ts/write/index.ts`) seats Ruth in the morgue from the first minute of the campaign regardless. The same is true of other book-stated demands the starter types and nobody reads (`on_enter.san_triggers`, `on_enter.danger_attacks`, `on_enter.clock_ticks`, the chapel's `optional_rules`). The Keeper learns the gate only from the prose that survives the projection: the affordance's `cue`, Arty's `role: gatekeeper` and `hides` line, and a pressure move.

The source-bound twin built from the book (`content/starters/the-haunting-rulebook/module-graph.json`) has the other half of the problem. The reader extracted the gate faithfully — `rule-globe-access`, linked `scene-boston-globe --uses-rule-->`, cited to its spans — but as prose properties (`"skills": "Charm (friendliness), Intimidate (aggression), …"`, `"difficulty": "Regular; …"`). It reaches the Keeper as one `where.rules` line; the host cannot issue it.

So the gap is a **system seam, not missing content**: there is no contract for "the module states that this place demands X before Y", no reader that turns such a statement into something the kernel can issue, no settlement that records it was met, and no way for the Keeper to be told that the clerk followed the book. Until that exists the loop's saving stops at the declared move, and the Keeper keeps being asked to re-derive what the book already wrote.

## Solution

A **stated obligation** is a demand the module's own text attaches to a scene: before the investigators get something they are trying to get there (access, a way onward, a person's help), the book says they must meet someone and/or pass a stated check. The spec makes it one small typed record in the module graph, issued by the kernel, settled through existing verbs, and consumed by the loop as a candidate the clerk may carry out and the Keeper may always override.

- **One authored shape for starters and PDF books.** A `requirement` node (a node kind the graph contract v3 already has, used by nothing today) linked from its scene by `has-requirement` (an existing relation kind). Its `properties.obligation` holds the typed demand; its check step reuses the Mod check declaration form that `natural-npc` already uses (`values`, `selection`, `difficulty`, `results`, `scope`, `trigger`). Its `source_refs` are the authority. Starters author it by hand; the visual reader extracts it with the same validator and the same independent review every other critical field gets.
- **One settlement, through existing vocabulary.** An obligation settles when its declared flag is set (`{kind: "flag_set", flag_id}` — the condition vocabulary exits already read). The kernel sets the flag in the same transaction as a passed check that names the obligation; the Keeper sets, clears or waives it with the existing `apply flag`, which has its own receipt. No new world-state key, no new `apply` kind.
- **One projection, two seats.** A kernel function projects each obligation of the active scene with its state and its next unsettled step. The complete, state-bound list is a sibling key `obligations` on `table.apply.options`; a compact Keeper-facing row joins the capsule's existing `obligations` section as `kind: "scene"`.
- **The clerk may follow the book; only the Keeper may leave it.** After SL-02, the loop turns an open obligation's next step into a candidate (the meeting as a stated person candidate; the check as an obligation-check candidate with a closed approach binder), withholds the reveals and moves the obligation guards until it is settled, and lists what it settled under "clerk did". The Keeper improvises by explicit operation. The kernel never refuses the Keeper's move, reveal or staging because an obligation is open: the module is reference, not scripture.

From the player's chair: at the morgue, the editor who blocks the clippings is there and the social check the book demands is rolled before the Keeper is asked anything; the Keeper is called for the fiction around it and for the prose.

## User Stories

1. As a player, I want a check the module states as the price of what I just declared (getting into the clippings room) to be rolled as soon as my declaration reaches it, so that the turn does not spend a model call re-deciding what the book already decided.
2. As a player, I want the person the book says stands in my way to be on stage before that check, so that the roll is against someone who is actually in the room.
3. As a player, I want my own approach (charming, arguing, bluffing, threatening) to choose the skill among those the book allows, so that the host never picks a skill I did not take.
4. As a player, when my words do not settle which of the book's approaches I am taking, I want the Keeper to decide it rather than the host guessing, so that an ambiguous approach is never silently bound.
5. As a player, I want a failed gate to leave the way closed and the Keeper free to offer another way in, so that failure behaves the way the book and the table do today.
6. As a player, I want the book's consequences of a failed push or a fumble to be decided and narrated by the Keeper, so that no host step ever inflicts a consequence on me.
7. As a player, I want what lies past the gate (the files, the archivist who takes me down) to become reachable once I pass, in the same turn, so that success pays off without another round trip.
8. As a player, I want nothing past the gate revealed unless I was after it, so that settling the gate never carries me beyond my decision boundary.
9. As a player, I want a scene whose book states no obligation to play exactly as it does today, so that the change costs me nothing where it does not apply.
10. As a player, I want a PDF book whose reader found no obligations to play exactly as it does today, so that a thin extraction never produces invented demands.
11. As a player, I want the same receipts, dice cards and delivery as today whether the clerk or the Keeper rolled the check, so that the audit trail of my table does not depend on who routed it.
12. As a Keeper (the model), I want each obligation of the scene in my capsule with its state and its next step, so that I know what the book demands here without looking it up.
13. As a Keeper, I want to be told which obligations the clerk settled this turn and with which receipt, so that I narrate what happened and do not roll it again.
14. As a Keeper, I want to waive an obligation (improvise past the book) with one ordinary `apply flag` and a reason, so that following or leaving the book stays my decision and leaves a receipt.
15. As a Keeper, I want to reopen an obligation the clerk settled with one ordinary `apply flag`, so that a clerk mistake is reconciled by an explicit operation, never silently undone.
16. As a Keeper, I want the book's failure, fumble and push consequences for an obligation's check delivered to me as book lines with the result, so that I realise them if I choose to follow the book.
17. As a Keeper, I want a `resolve` I make myself to settle the obligation when I name it, so that the Keeper path and the clerk path write the same state.
18. As a Keeper, I want my own move, reveal or staging past an open obligation to go through unrefused, so that improvisation is never blocked by data.
19. As a Keeper, I want the book's stated check and a Mod's contact check for the same pair not to be rolled twice, so that one meeting leaves one impression.
20. As a Jev decision, I want an obligation's step offered as its own candidate with the book's demand in its label and no internal tags, so that "the book says this now" is decidable (the prototype's `now`/`later` for a person was ~50/50 without it).
21. As a Jev decision, I want the approaches of an obligation's check as a closed vocabulary to bind, so that I can complete the step without the LLM when the player's words settle it.
22. As a Jev decision, I want candidates guarded by an open obligation withheld and returned when it settles, so that I never route a reveal the book has not opened yet (the same hygiene as a `met: false` exit).
23. As the host, I want obligations issued from the module graph and world state only, never from reading the player's words or the Keeper's prose, so that no text is classified.
24. As the host, I want one projection function to feed both `table.apply.options` and the capsule, so that the Keeper's view and the clerk's candidates cannot disagree.
25. As the host, I want an obligation's settlement to be a flag written in the check's own transaction, so that recovery, worldlines and history see it exactly like every other flag.
26. As the host, I want clerk-origin refusals kept off the Keeper's refusal budget, so that a host routing failure never punishes the Keeper.
27. As the host, I want each obligation offer counted in the offer ledger and taken when it settles, so that the third end of the seam (§31) is measured, never nagged.
28. As a starter author, I want to declare an obligation in the existing module graph with the same keys a Mod uses for a check, so that there is one declaration form to learn and one validator.
29. As a starter author, I want the validator to refuse an obligation without a source reference, with a prose value in a typed slot, with an unknown skill, with a person not seated in the scene, or with a cycle, so that invented demands cannot ship.
30. As a starter author, I want an obligation that repeats a clue's own gate refused, so that each check has exactly one owner.
31. As the PDF reader, I want an instruction and a node shape for "the book says this place demands X before Y", so that I extract it as a typed record instead of a prose rule line.
32. As the independent reviewer, I want every obligation field in `critical` and every number in `required_review`, so that I check each against the page image like any other mechanical statement.
33. As the reader, I want an obligation whose difficulty or skill the page does not state to be recorded as unstated rather than filled, so that accounting replaces invention (and such a step stays with the Keeper).
34. As a Mod author, I want my check's `trigger` to be validated and read, so that the declaration key my package already ships stops being decorative.
35. As a maintainer, I want the turn-3 replay re-run on a fixture whose module carries the authored obligations, with its outcomes registered before the run, so that the saving is measured on the same turn the prototype used.
36. As a maintainer, I want the curated haunting's contradictory data (Ruth's gate that her own record says needs no roll) resolved in the same change, so that the first authored sample is clean.
37. As a maintainer, I want the zero-consumer fields this spec replaces removed where it replaces them and listed where it does not, so that no second dead copy of the gate ships.
38. As the owner, I want every open design branch this spec could not settle from the code listed as a question, so that I rule on them once before implementation.

## Implementation Decisions

### D1. What counts as a stated obligation

A stated obligation is a record that satisfies all four:

1. **Located.** It belongs to exactly one scene of the module graph (`scene --has-requirement--> requirement`).
2. **Triggered by structure.** Its trigger names graph handles, not situations: `attempt` (the investigators try to reach something the obligation *guards* — named clues, named exits, named people), or `after` (another obligation of the same module settled). Mod checks keep their existing `contact`. No other trigger is added in this spec; `arrival` and elapsed-time triggers are considered in D8 and left out because the haunting states no clerk-settleable demand that needs them.
3. **A closed demand.** An ordered list of steps, each one of: `meet` (a named person must be on stage), `check` (a stated percentile check in the Mod check declaration form), `cost` (a stated quantity of time or money; shown to the Keeper only in this spec, see Q4).
4. **Sourced.** It carries `source_refs` to the page(s) that state it (and, on a starter, the node's `evidence_span_ids`). A demand without a source reference is not an obligation; it is the Keeper's.

Everything else a scene carries — pressure moves, dramatic question, keeper notes, allowed improvisation, tone, NPC agendas and secrets, beats — stays Keeper material. See D8.

### D2. Where the haunting's obligations live today

Read from `content/starters/the-haunting/module-graph.json` (the curated starter, "the starter"), `content/starters/the-haunting-rulebook/module-graph.json` (the source-bound twin, "the twin"), and the kernel and host code that consume them. "Book states" is read from the twin's extracted, span-cited nodes; the book's text is not reproduced here. "0 consumers" means no reader under `kernel-ts/`, `extensions/`, `runtime/`, `pipicoc/` or the Electron apps (checked 2026-09-23 on `d29fba981`).

| Scene (starter handle) | What the book states | Obligation kind | Carried today, and who reads it | Only in prose / the gap | First cut |
| --- | --- | --- | --- | --- | --- |
| `commission-briefing` (Knott's office) | Knott hires them at a daily fee with an advance, keys and address; if research runs past a day he presses them. | A stated *grant* on acceptance; an elapsed-time contact. Neither is a demand. | Quest `quest-knott-commission` brief (capsule `obligations[kind=quest]`); clue `clue-knott-keys` (`obvious`); affordance cues. | The advance and the keys (cash needs a source, §58); "past a day" appears only as pressure moves in three scenes. | None (grants and elapsed triggers are out of scope, D8). |
| `newspaper-morgue` | Editor Arty Wilmot blocks the clippings; a Regular Charm, Intimidate, Persuade or Fast Talk gains access; the usual APP/Credit Rating reaction is not used for him (he is unhelpful by design); pushes escalate. On success the archivist Ruth Blake takes them to the files. Ruth, if befriended, mentions the 1878 fire. | (a) `attempt` guarding the two clippings clues: `meet` Arty, then `check` (approach among four, regular). (b) `after` (a): `meet` Ruth. (c) Ruth's remark: a handed clue, no check. | `affordances[persuade-arty].roll_gate` (typed: kind, difficulty, four approaches, failure/fumble/push consequences) — **0 consumers**; `requires_completed_route_ids` on `search-clippings`, `befriend-ruth` — **0 consumers**; `npc_presence_requirements` (Ruth after `persuade-arty`) — **0 consumers**, and `initialWorld` seats Ruth at campaign start anyway. Capsule reads: `where.affordances[].cue`, `present[].role = gatekeeper`, `hides` (Arty's "Regular difficulty"), `pressure_moves`. `natural-npc` issues `pending_contacts` first impressions for Arty and Ruth once staged. Twin: `rule-globe-access` via `uses-rule` → one `where.rules` line. | The gate, its difficulty and approaches reach the Keeper only as cue/secret prose. `befriend-ruth` carries a Regular `roll_gate` that Ruth's own record contradicts ("learn the 1878 fire cutoff without a roll") and the twin does not state — starter invention (Q3). The book's "reaction not used" for Arty contradicts the Mod's first impression (Q2). | (a) and (b). (c) stays a handed clue; the invented `roll_gate` is removed (Q3). |
| `central-library` | Each half-day of research, a Library Use roll per investigator; each success yields the next handout in order; no push, a retry costs another half-day; past a day Knott presses. | The check is already a clue gate; the time is a `cost`; the order is a sequence. | Clue gates `Library Use / regular` on three clues (conclusion entries) → projected as `gate` (§32.5) — **read**. | "Half a day" appears only in cues and pressure moves, with no minutes the kernel could apply; the handout order only in cue prose. | No new obligation (the check has an owner: the clue gate). The cost waits on Q4. |
| `hall-of-records` | Library Use for the civil records (Handout 7); the criminal files are elsewhere, and the clerk or a Law roll points them to the higher courts / police. | `attempt` guarding the exit to `higher-courts-central-police`: `check` Law, settling the flag that exit already reads. | Clue gates `Library Use / regular` — read. Exit gate `flag_set: records-serious-crime-destination-known` — **read** by `unlock_when`, but **no stated writer** (only a Keeper `apply flag`). | Who opens the exit, and how, is only in the `ask-clerk-redirect` cue and a "courtesy" pressure move. The clerk's courteous answer is judgment. | The Law route as an obligation that settles the existing flag, only if the page states its difficulty (D7 accounting); the courteous-clerk route stays the Keeper's. |
| `higher-courts-central-police` | Access to the sealed raid file needs at least one success: Law (knowing clerk Kim Debrun), Credit Rating (75 or more), Persuade, Charm or Fast Talk; pushes risk police antipathy; the Law push is concealed. | `attempt` guarding `clue-police-raid-chapel`: `check`, approach among five, one with a stated minimum. | Affordances list `skills` (untyped gate, `roll_gate` absent) — `skills` **not projected**. Clue gate `Law / regular` on the raid clue — read, and narrower than the book. | "At least one must succeed" is a pressure move; the Credit Rating threshold only in cue prose. | Yes. Authoring replaces the clue's narrower `Law` gate by the obligation (one owner, D7). |
| `neighborhood-gossip` | Asking around finds Mr. Dooley; his reaction is a D100 against APP or Credit Rating; failing that, another investigator may Charm, Fast Talk, Persuade or Intimidate. | `attempt` guarding Dooley's gossip clues: `meet` Dooley, then `check` with `selection: maximum` over APP and Credit Rating, regular — the exact `natural-npc` recipe. | `natural-npc` `pending_contacts` issues this recipe when the Mod is on; Dooley is seated from campaign start. Twin: `rule-dooley-reaction`, NPC `reaction_check` (prose). | Starter: one pressure move ("sizes them up by appearance and credit"). | Yes; served by the Mod's frozen result when the identical recipe is active (D9). The fallback approaches are a book line to the Keeper. |
| `previous-tenants` (Roxbury Sanitarium) | Gabriela is approachable but questions upset her and the interview should end quickly; Vittorio only quotes; the boys know only nightmares. | A limit judged on "upset" — not a demand. | Dossiers, `npc_dialogue` clue deliveries, pressure moves. | — | None (Keeper judgment). |
| `corbitt-house-ground` | Keys from Knott; bolts and nailed windows; the boarded cupboard holds the diaries; noises upstairs. No stated check to enter or to open the cupboard. | None. | Affordance cues, pressure moves, clue deliveries. | — | None. |
| `upper-floor-bedroom` | Corbitt lures an investigator to the spare-bedroom window and flings the bed: Spot Hidden then Dodge, damage on a hit, witnesses lose Sanity; target by lowest Luck or at random. | A hazard of Corbitt's initiative — a check the player did not declare. | `on_enter.san_triggers` (typed) — **0 consumers**; threat moves; twin `rule-bed-attack` (prose). | — | Not clerk-settleable (ruling: checks the player did not declare are boss-only; Q1). |
| `basement-rites` | The stairs need a DEX or Climb roll to descend; failure means it is too dangerous, a push risks a fall; a helper grants a bonus die. Corbitt cuts the lights. The knife in the tools is an Obscure Spot Hidden; a failed push gets someone cut. The floating knife attacks. | (a) `attempt` guarding the move `corbitt-house-ground → basement-rites`: `check`, `selection: maximum` over DEX and Climb. (b) knife search: a clue gate. (c) knife attack: hazard. | Affordance cue "(DEX/Climb)" — prose; `on_enter.clock_ticks` — **0 consumers** (already noted in §32.5); `clue-rusted-basement-dagger` delivery `environmental` with no skill while its cue says Spot Hidden. | The stairs gate and the knife gate are prose only; the dagger clue's gate data disagrees with its cue. | (a) yes, difficulty as the page states (D7). (b) fixed as a clue gate, not an obligation (tickets). (c) Q1. |
| `chapel-of-contemplation-ruins` | Near the symbol foreheads tingle (no roll); the weak floor calls for Luck, then Jump, or a ten-foot fall; the cabinet yields the journal on a look underneath or Spot Hidden; the Latin book takes hours and Read Latin. Reaching the ruins needs their location. | Entry gate (exists); floor: hazard; cabinet: clue gate; Latin: a tome procedure. | `entry_conditions` / exit `clue_discovered` — read; clue gates `Spot Hidden / regular` — read; `optional_rules.weakened_floor`, `optional_rules.liber_ivonis_initial_read` (typed) — **0 consumers** (the kernel's `optional_rules` reader is the ruleset manifest's, a different key). | — | None clerk-settleable (floor: Q1; the rest have owners). |
| `corbitt-confrontation` | Sanity loss on seeing Corbitt rise; Dominate, Flesh Ward, claws, the knife; his own dagger bypasses his wards. | Combat session; sanity on sight. | `affordances[].rules_operation` (combat engagement) — **read** (§102); `conclusion_contract` — read; `on_enter.san_triggers`, `on_enter.danger_attacks` — **0 consumers**. | — | None (session family; sanity on sight is Keeper-timed; Q1). |

What the table decides: five book-stated obligations are in the first cut — the morgue gate and the archivist it opens, the police-file gate, Dooley's reaction, the basement stairs — plus the Law route out of the Hall of Records if its difficulty is on the page. Every one of them is already stated in the twin with spans; three of them are already half-typed in the starter with no reader.

### D3. The authored shape

A `requirement` node, one per obligation, with the existing node keys. Example for the morgue gate (values abridged; the real node cites the pages the author checked):

```json
{
  "node_id": "requirement-globe-clippings-access",
  "node_kind": "requirement",
  "name": "Access to the Globe clippings",
  "visibility": "keeper-only",
  "summary": "The city editor refuses the clippings; a regular social check wins access.",
  "evidence_span_ids": ["span-page-447-anchor-1"],
  "source_refs": [{"source_id": "pdf:call-of-cthulhu-keeper-rulebook-40th-the-haunting", "pdf_index": 447, "grep_anchor": "Arty Wilmot"}],
  "properties": {
    "obligation": {
      "scene": "scene-newspaper-morgue",
      "trigger": {"kind": "attempt", "guards": {"clues": ["clue-globe-unpublished-story", "clue-macario-tragedy"]}},
      "who": "npc-arty-wilmot",
      "demand": [
        {"kind": "meet", "npc": "npc-arty-wilmot"},
        {"kind": "check", "scope": "actor-target", "target": "npc-arty-wilmot",
         "selection": "approach",
         "values": [{"path": "skills.Persuade", "label": "Persuade"}, {"path": "skills.Intimidate", "label": "Intimidate"},
                    {"path": "skills.Charm", "label": "Charm"}, {"path": "skills.Fast Talk", "label": "Fast Talk"}],
         "difficulty": "regular",
         "results": {"critical": {"settles": true}, "extreme": {"settles": true}, "hard": {"settles": true}, "regular": {"settles": true},
                     "failure": {"settles": false, "book": "He refuses; another approach, or a changed method for a push."},
                     "fumble": {"settles": false, "book": "He has the investigator thrown out and barred."}},
         "push": {"allowed": true, "book": "A failed push gets the investigator ejected and barred."}}
      ],
      "settles": {"kind": "flag_set", "flag_id": "newspaper-morgue.clippings-access"}
    }
  }
}
```

and the archivist it opens:

```json
{"node_id": "requirement-globe-archivist", "node_kind": "requirement", "properties": {"obligation": {
  "scene": "scene-newspaper-morgue",
  "trigger": {"kind": "after", "obligation": "requirement-globe-clippings-access"},
  "who": "npc-ruth-blake",
  "demand": [{"kind": "meet", "npc": "npc-ruth-blake"}],
  "settles": {"kind": "flag_set", "flag_id": "newspaper-morgue.archivist"}}}, "…": "…"}
```

with claims `scene-newspaper-morgue has-requirement requirement-…` (relations are machine-filled from claims, as for every node).

Why this shape and not another:

- **`requirement` and `has-requirement` already exist** in `content/modules/module-graph-contract-v3.json` and are unused, so starters and PDF books share one shape without a new file family or a new node kind. The alternative — a new key on the starter's scene `runtime_projection.record` — would have given starters and PDF books two shapes (PDF books have no scene records to extend) and a second projection.
- **The check step is the Mod check declaration form**, the one `natural-npc` ships (`contributes.checks[]`: `scope`, `values[{path,label}]`, `selection`, `difficulty`, six `results`, `trigger`). Two extensions, both closed: `selection` gains `approach` (the actor takes one of `values`; the host binds which, D6) beside the existing `maximum`; a value may carry `minimum` (a stated rating threshold, e.g. Credit Rating 75). `results` keeps its six keys; for an obligation each level says whether it `settles` and may carry one `book` line. The Mod validator (`kernel-ts/read/mods.ts`, the `checks` loop) and the obligation validator share one function.
- **The starter's typed `roll_gate` is the input, not a second copy.** Authoring the haunting moves `persuade-arty.roll_gate` into the requirement node and deletes it there, replaces the morgue's `requires_completed_route_ids` and `npc_presence_requirements` by the two requirement nodes' `guards`/`after`, and removes `befriend-ruth.roll_gate` (Q3). `mystery-house` keeps its copies of the same fields untouched (it has no obligations; it is the "starter without obligations" control) — their zero-consumer status is recorded in Further Notes, not fixed here.
- **`guards` names graph nodes** (clues, exits by destination scene, people), never affordance ids: affordances exist only in starter scene records, and a PDF book has none.
- **`who` names the gatekeeper or the person to be met.** It must be seated in the scene (`present-in` or the scene's `npc_ids`); an obligation cannot stage someone the book does not put there.
- **`reaction: "preordained"` (optional, Q2 ruling).** When the book states that the person's reaction roll is not used, the obligation says so and the clerk does not settle an active Mod's contact check for that pair (`natural-npc`'s first impression for Arty); the Mod's declaration stays, the Keeper may still resolve it. The only value is `preordained`; absent means the Mod's check runs as today.

### D4. Settlement

- **State is a flag.** `settles` is `{kind: "flag_set", flag_id}` — the condition shape `describeCondition`/`conditionStatus` already read for exits (§18.7). An obligation is `settled` when the flag is true, `open` otherwise; `waived` is a settled flag whose receipt came from a Keeper `apply flag` with a reason. Its `after` dependents and the guards it holds release when the flag is true.
- **A check that names the obligation settles it.** `resolve` accepts an optional `action.obligation: <handle>` (the handle the kernel issued). The kernel checks that the obligation is open, in the active scene, that its next step is a `check`, that `skill` is one of its `values` (for `selection: maximum` it takes the higher, ties as the Mod path does), that the difficulty is the stated one, and that the target is present — then runs the **ordinary check** (so push, Luck and continuations behave exactly as today). When the result level `settles`, the same transaction sets the flag and the receipt carries `obligation: {handle, settled: true}`; otherwise the result carries `obligation: {handle, settled: false, book: "<the level's book line>"}` for the Keeper. The kernel applies no consequence: route closure, ejection, damage are the Keeper's to realise (ruling: consequences are boss-only).
- **A `meet` step is settled by existing receipts.** The person is present in the active scene and has been introduced (an `npc`/`person` receipt); nothing new is written.
- **The Keeper leaves the book with `apply flag`.** Setting the flag with a `why` waives the obligation; clearing it reopens one the clerk settled. Both are ordinary receipts with their own time cost (none unless the Keeper adds one). The kernel never refuses `apply move`, `apply clue`, `apply person` or `resolve` because an obligation is open; a result that crosses an open obligation's guard carries `obligation_open: <handle>` as information, never as a refusal, and the capsule's clerk list shows the same fact as one line beside "clerk did" (Q5 ruling).
- **A `resolve` without `action.obligation` does not settle anything,** even when it is the same skill against the same person. Settlement follows the operation that claims it, never an inference from a similar-looking receipt.

### D5. Issuance

One kernel function, `sceneObligations(graph, world, scene)` (beside `whereSection` in `kernel-ts/read/`), projects the obligations of the active scene:

```
{handle, name, who?, state: "open" | "blocked" | "settled" | "waived",
 trigger: {kind, guards?: {clues: [names], exits: [names], people: [names]}, after?: handle},
 next?: {kind: "meet", person} | {kind: "check", target?, approaches: [{skill, minimum?}], selection, difficulty},
 book?: {failure?, fumble?, push?},              // Keeper-only lines
 source: [{page, anchor?}]}                       // audit; never shown to Jev
```

`blocked` is an `after` obligation whose predecessor is open. Two seats, the same rows:

- **`table.apply.options` gains a sibling key `obligations`** (complete, untruncated, bound to the same `world_revision` and `revision` as the effect candidates). This read, not `table.resolve.options`, because it is already the read of scene-authored candidates with the kernel's availability verdict (clues with `gate`, exits with `unlock_when.met`) and its `context.present` names who is on stage; `table.resolve.options` stays the investigator's profiles and the rule decisions, which the obligation check's approach binder uses as it is. A new RPC method was considered and not taken: it would add a method-table entry, a fake-kernel handler and an SL-00 inventory row for data one existing read already frames.
- **The capsule's `obligations` section gains `kind: "scene"` rows** (`{kind, name, who, state, cue}` where `cue` is the next step in one line with its page), inside the section's existing 1 KB budget; the §13.2 source table gains the row. A truncated capsule never loses a candidate, because the loop reads `table.apply.options`.
- **Guards reach the existing gate string.** `clueGate` (the one function behind `where.affordances[].clues[].gate`, `known.clues_here[].gate`, `director.reveal` and the thread's `here` rows) appends the open obligation's name to a guarded clue's gate, so every reader of "how is this obtained" agrees, and there is still one gate string.
- **`table.apply.options` candidates guarded by an open obligation keep their row** but gain `guarded_by: <handle>`; the loop withholds them (D6). The Keeper's capsule shows them as before.

### D6. Consumption by the single loop (after SL-02)

- **Candidates.** For each obligation with state `open`: a `meet` step becomes the person candidate for that person, marked as stated (label: "The book puts <person> here, <who role>, before <what they guard>") — it replaces the unmarked roster candidate for the same person rather than adding a second; a `check` step becomes an `obligation_check` candidate (label: the demand and what it guards, no page, no kernel tags). *Amended by the owner's rulings of 2026-09-23 (Comments):* a stated meeting is data — it is staged under the table's own label if the kernel issued one, else under the person's record name, with no LLM step; and a meeting the book puts before a check is carried by that check — `now` on the check runs the meeting directly first, then binds and rolls the check — while a meeting-only obligation stays a routed candidate. Candidates with `guarded_by` an open obligation are withheld, the same hygiene as an exit whose `unlock_when.met` is false. A `blocked` obligation issues nothing.
- **Precedence.** `person → mod_check → obligation_check → core-check → clue/handout → move`. The obligation check sits after the Mod contact check (a meeting's first impression comes before its demand, as at the table) and before an ordinary check.
- **Clerk authority (e), added to the ruling's (a)–(d):** the next step of a stated obligation, when Jev answers `now` above the gates. A `meet` step is (a)-shaped bookkeeping. A `check` step binds its approach: one available approach → bound; several → `decide(bind)` over the closed approaches (and the ordinary binder's closed dice-modifier choice); below the gates → `infer(bind)`, the Keeper fills it. The clerk never picks among approaches on its own, and never rolls an obligation whose next step lacks a stated difficulty (D7).
- **Stop at the decision boundary.** Settling a gate releases what it guards; it does not carry the player past what they declared. A released reveal is carried out only when Jev judges it `now` against the player's declaration, like any reveal.
- **"Clerk did."** The capsule's clerk list names each settled obligation step with its receipt and page, e.g. `obligation clippings-access: Persuade (regular) passed — settled; book p.436`. The base Keeper prompt gains one English sentence: scene obligations are what the book states this place demands; a step the clerk settled followed the book; to improvise instead, waive or reopen it with `apply flag`.
- **Refusals.** A clerk-origin operation that is refused (admission, `not_here`, a stale binding) removes that candidate for the rest of the run and hands the turn to the Keeper; it is recorded on the clerk's side and does not count toward the Keeper's per-class refusal budget.

### D7. Where the data comes from, and what the validator refuses

**Starters.** Authored `requirement` nodes in the starter's `module-graph.json`, cited to the pages the author read (`source_refs` + `evidence_span_ids`), added by the data ticket for the haunting's first-cut rows. Starters register by digest, so a new generation reaches every campaign's per-turn reads on its next `campaign.create`; the world computed at creation (who is seated where) does not change.

**PDF books.** The visual reader (`content/setup/visual-reader.md`) already tells readers to preserve "which exact obstacle requires a check" as rule nodes linked with `uses-rule`. It gains one paragraph: when the page states that a place demands a meeting or a check before the investigators get something there, also write a `requirement` node with `properties.obligation` in the D3 shape, a `has-requirement` claim from the scene, and a `calls-for-check` claim to the rule node that holds the book's wording; list every obligation field in `critical`. The draft checker (`kernel-ts/modules/visual.ts`) runs the obligation validator; numbers (`minimum`, a cost's quantity) already enter `required_review` through `numericPaths`; the independent reviewer checks each field against the page image. There is no inference from rule prose (the kernel never parses `"skills": "Charm (friendliness), …"` into approaches — that would be a hand-written semantic reading), no count gate (a book may state none), and no automatic backfill of existing modules (§22: no all-book reparsing); an existing module gains obligations only through the detail request path with an explicit question, additively reviewed. The committed twin is left as it is: it is the "PDF-built module with no obligations" control.

**Accounting, not content.** Following `document-ir-extraction`'s first rule: the validator does not require any field to be present for an obligation to exist. A `check` whose page states no difficulty carries `difficulty_unstated: true` instead of a guessed `regular`; one whose skills are not stated carries `approaches_unstated: true`. Such a step is issued to the Keeper (capsule row) and never to the clerk.

**The validator refuses** (one function, used by starter registration, the reader's check and the Mod manifest check for the shared keys):

- a `requirement` with `properties.obligation` and no `source_refs` (starters: also no `evidence_span_ids`); a PDF source ref to a page the reader did not view (existing law);
- `scene`, `who`, `meet.npc`, `target`, `guards.*`, `after` that do not resolve to a node of the right kind; `who`/`meet.npc` not seated in the scene (`present-in` or `npc_ids`);
- a `values[].path` outside `characteristics.` / `skills.`, or a skill name that does not resolve in the ruleset's skill catalogue by normalised-name match (the one name matching the repo allows); a prose string in any typed slot;
- `reaction` present with a value other than `preordained`;
- `selection` outside `{maximum, approach}`, `difficulty` outside `{regular, hard, extreme}` (or absent without `difficulty_unstated`), `results` without exactly the six levels, a `trigger.kind` outside `{attempt, after}` (Mods: `contact`), an `after` cycle, an `attempt` with empty `guards`;
- `settles` that is not `{kind: "flag_set", flag_id}` with a semantic flag id, or a flag id another obligation already settles;
- an obligation whose `check` repeats a guarded clue's own gate (same clue, a single identical skill, same difficulty): one check, one owner — the author either keeps the clue gate or moves it into the obligation and deletes it from the clue.

### D8. What is not data

- Anything without a source reference, however plausible ("an editor would want a reason").
- Keeper-improvised encounters and their demands: the live Keeper's decision to stage Ruth, the "old colleague" the player invokes, the bonus die it earned. The book states the gate; the fiction around it is the Keeper's.
- "What usually happens": pressure moves, `allowed_improvisation`, tone, the dramatic question, beats, NPC agendas, fears, secrets and voices. These are the Keeper's toolkit; putting them in the candidate list would be the menu the parent spec forbids ("the loop never replaces craft with a menu").
- Checks the player did not declare and that are not the price of something they declared: hazards (the chapel floor, the bed attack, the floating knife), sanity on sight. Boss-only (Q1 ruling: a check is host-issuable only as the stated price of something the player declared; hazards stay the Keeper's, including their dice).
- Consequences: damage, Sanity, cash, ejection, route closure. The book's lines travel to the Keeper; the Keeper applies them.
- Grants (Knott's advance and keys) and elapsed-time contacts (Knott pressing after a day): stated, but neither is a demand the investigators meet; out of this spec.
- Starter data the book does not state (Ruth's `befriend-ruth` gate): not an obligation even though it is typed; it is removed in SO-01 (Q3 ruling).

### D9. Interaction with existing rules

- **§32 action admission.** An obligation-origin `resolve` is a policy-origin operation on an investigator; §32.1 does not exempt it today. Whether a fully bound, kernel-issued, Jev-selected operation still needs §32 admission is the SL-02 research item, decided by measurement; this spec grants no exemption. The operation's invocation context carries `basis: obligation <handle>`, so SL-02's measurement can report obligation checks as their own row. Risk to measure: the reviewer judges consent from the player's words, and "get an old colleague to help me" may not read as consent to *persuade the editor*.
- **The Director.** Obligations are not beats and the Director reads none of them: no new signal, no new scoring rule, no second reveal list. The only shared surface is the gate string (D5), which keeps one owner.
- **Mods.** One declaration form (D3). The Mod validator starts validating `trigger` (today it is shipped and read by nobody; `natural-npc`'s `contact` stays valid, its bytes do not change). When an active Mod's check has the identical recipe (same value set, `selection`, `difficulty`) for the same actor–target pair as an obligation's `check` step — Dooley — the obligation step is served by the Mod's frozen result and issues no candidate of its own; the comparison is structural. The book's "reaction not used" for Arty is declared by `reaction: "preordained"` on the obligation (D3), and the module's statement wins over the Mod for the clerk (Q2 ruling).
- **Refusal budget.** Clerk-origin refusals are not the Keeper's (D6). The Keeper's own refused `resolve` with `action.obligation` counts like any refusal of its class.
- **The Keeper prompt.** Told through the capsule (`obligations[kind=scene]`, "clerk did") and one base-prompt sentence (D6). No per-scene prompt text.
- **Adaptation (§36).** An adapted scene `based_on` a scene with obligations does not inherit them (the 2026-09-15 lobby copy of the morgue lost its affordance and presence requirement the same way). Obligations stay on the authored scene; §36's `same_place` refusal already sends that case back to the authored scene.
- **The three ends (§31).** Writer: the obligation-bound `resolve` transaction and `apply flag`. Reader: `sceneObligations` into `table.apply.options` and the capsule. Actor: the clerk's candidate and the Keeper's capsule row; the offer ledger registers `obligation:<handle>` and marks it taken when its flag is set (counted by `kpi.py`, never fed back into the capsule).
- **Worldlines, recovery, history.** Settlement is a flag, so it forks, merges, replays and rolls back like every flag; no new confluence rule.

## Testing Decisions

A good test drives the real entry and asserts what the kernel issued, what receipts exist, and what the Keeper and Jev were shown — never private state or call order. Every product-behaviour test must be killable by a mutation of the code it covers.

- **Kernel projection and settlement (pytest over the emitted `build/kernel/rpc.mjs`, a fresh haunting campaign after the data ticket; build before testing):** at the morgue, `table.apply.options.obligations` lists the clippings gate `open` with `next: meet Arty` and the archivist `blocked`; after `apply person Arty`, `next` is the check with four approaches; the two clippings clue candidates carry `guarded_by`; `resolve` with `action.obligation` and a forced pass sets the flag in the same transaction, the archivist becomes `open`, the guards clear; a forced failure leaves it `open` and the result carries the level's `book` line and no consequence; a `resolve` of the same skill without `action.obligation` settles nothing; `apply flag` clears and sets it with receipts; `apply clue` on a guarded clue while open succeeds and carries `obligation_open`; the capsule row and the options row agree. Prior art: `tests/kernel/test_capsule.py`, `tests/extension/ts-kernel-read.test.mjs`.
- **A starter without obligations behaves exactly as today:** `mystery-house` and `voice-bench` capsules and both options reads, compared against a golden recorded on the parent commit, byte for byte (`mystery-house` still carries its dead `roll_gate` copies; that is the point).
- **A PDF-built module without obligations behaves exactly as today:** the committed twin (`the-haunting-rulebook`) the same way. Its `rule-globe-access` stays a `where.rules` line.
- **The haunting's other scenes do not change:** the start scene's capsule is unchanged (the first cut authors nothing at Knott's office), so the existing capsule-budget and Director tests move only where they stand at the morgue, the police, the neighbourhood or the house; any other diff is a regression.
- **Validator tests, through the real entry** (starter registration and the reader's `check`, never a helper that normalises the input first): refuse an obligation without `source_refs`; with a prose string in `values`; with an unknown skill; with `who` not seated in the scene; with an `after` cycle; with a duplicate of a clue gate; with a `difficulty` outside the enum and no `difficulty_unstated`; with a Mod `trigger` outside the enum. Accept the minimal valid node and the `difficulty_unstated` node. Each refusal case also mutates the validator (remove the rule, see the case go green) before it is accepted as coverage.
- **The Mod validator change keeps `natural-npc` loadable** at its current version and digest (Mod bytes are frozen per version).
- **Replay (the turn-3 replay, `--llm replay`, after SL-02):** a new fixture variant derived from `fixtures/turn3` with only the module slice re-registered from the authored starter (the original fixture and the live evidence are never modified), the kernel seeded and the seed recorded. Outcomes registered here, before the run:
  - route 2 (arrival at the morgue) selects the stated meeting with Arty and, after it, the gatekeeper's check as `now` above the gates in 3/3 runs;
  - if the clerk's roll passes: the archivist meeting and the two clippings reveals are carried by the host; the remaining LLM steps are one adjudication (the Keeper's time advance and whatever it adds) plus the compose — **2**, or **3** when the approach falls below the bind gate and the Keeper fills it; pass is ≤ 3 LLM steps in each passing-roll run, down from 5;
  - if the roll fails: the obligation stays `open`, the recorded Keeper calls for Ruth and the clippings execute as model-origin (the Keeper improvising past the book), and the run is reported as such, not as a pass or a failure of the saving;
  - the live actions still match by kind, decision family, skill and target (8/8), with the clerk's Persuade consuming the recorded one; a missing bonus die on the clerk's roll is a recorded difference (the binder's closed modifier choice is the only way it appears).
- **Live gate:** a real table (Grok Build 4.7 fast / low as Keeper, the main session as the one player, one sentence a turn, `tests/play/driver.py`) that reaches the morgue and the police after SL-02 lands, at the single-loop plan's SL-02/SL-05 gates. Not a worker ticket; no scripted player, no batch settle.
- **Baselines stay green:** `npm run test:ext`, `uv run --frozen python -m pytest tests/kernel tests/play` (one pytest at a time, on the ticket's own worktree, after `build:runtime`).

## Out of Scope

- Hazards and checks the player did not declare (the chapel floor, the bed attack, the floating knife, sanity on sight) as clerk-settleable candidates — ruled boss-only (Q1).
- Grants on acceptance (Knott's advance and keys) and elapsed-time contacts (Knott pressing after a day); the `arrival` trigger.
- Costs applied by the clerk — ruled out (Q4); a stated cost is carried as a Keeper-only book line and the Keeper advances the clock.
- A kernel refusal of any Keeper operation because an obligation is open.
- Fixing `mystery-house`'s copies of `roll_gate`, `requires_completed_route_ids` and `npc_presence_requirements`, the starter's other zero-consumer typed fields (`on_enter.*`, the chapel's `optional_rules`), and the gate mismatch on `clue-rusted-basement-dagger` beyond what the first cut touches.
- Backfilling obligations into existing PDF-built modules, or into the committed twin.
- Director signals, beats or scoring from obligations.
- Changing `natural-npc`'s package bytes or behaviour.
- The single-loop driver itself (the parent spec).

## Further Notes

**The finding that reframes the prototype's miss.** The prototype concluded that "who meets the investigator at the morgue and that it costs a Persuade are not facts the kernel or any Mod issues". They are not issued — but the curated starter has typed them since before the rewrite, and the reader extracts them. The missing piece is the contract between the two, which is what `docs/specs/visual-pdf-reader.md` and the `document-ir-extraction` rule "read the consumer and confirm which fields it actually projects" would have caught: `roll_gate` is the fourth recorded case of an author field with no reader (after the threat clock, `keeper_notes` behind the `scene.context` whitelist, and the NPC mechanics registry).

**Contradictions in the first authored sample.** Ruth's `befriend-ruth.roll_gate` (a Regular check with a twelve-hour retry) disagrees with Ruth's own record ("without a roll") and with the twin. The book's statement that Arty's reaction roll is not used disagrees with what `natural-npc` does on every first contact. Both are listed as owner questions rather than decided, because each is a choice between the book and something the owner already approved.

**Vocabulary.** `CONTEXT.md` has no entry for a stated obligation; if the owner accepts this spec, "stated obligation" (a demand the module's text attaches to a scene before the investigators get something there; settled by a flag; followed by the clerk, left only by the Keeper) is a candidate term for `/domain-modeling`. This spec does not edit `CONTEXT.md`.

**Contract.** When implemented, the shape lands as a new `docs/kernel-rpc.md` section (the next free number at landing; it amends §6/§13.2 for the capsule row, §32.5 for the gate string, §26 for the Mod `trigger`, and adds the `table.apply.options` key and `resolve`'s `action.obligation`). Contract first, then code.

### Owner rulings (2026-09-23; the questions below were answered "all as recommended")

- **Q1. Hazards — boss-only.** A check is host-issuable only when it is the stated price of something the player declared (a gate on an `attempt`). Involuntary hazards (the chapel floor, the bed attack, the floating knife, sanity on sight) stay the Keeper's, dice included. D8 stands.
- **Q2. Book against Mod — the book wins for the clerk.** An obligation may declare `reaction: "preordained"` (D3); then the clerk does not settle the active Mod's contact check for that pair. The Mod's declaration is unchanged and the Keeper may still resolve it. Arty carries it; Dooley does not (the book states his reaction roll, and the Mod-recipe identity rule in D9 serves it).
- **Q3. `befriend-ruth.roll_gate` — removed** in SO-01. Ruth's record and the twin state no roll; starter data the book does not state is not an obligation.
- **Q4. Costs — Keeper-applied.** No minutes are invented from "half a day". A stated cost travels as a Keeper-only `book` line; the Keeper advances the clock with its own `apply time`.
- **Q5. Crossing an open gate — `obligation_open` stays**, as information: the result carries it, the kernel never refuses, and the capsule's clerk list shows the crossing as one line beside "clerk did".
- **Q6. Replay pass line — accepted:** ≤ 3 LLM steps on a passing roll at the morgue (2 when Jev binds the approach), down from 5; a failing roll is recorded as the Keeper improvising past the book and is neither a pass nor a failure of the saving. This line is added to SL-02's acceptance.
- **Q7. First authored sample — the morgue pair only** (clippings access and the archivist). The police, Dooley, basement-stairs and Hall-of-Records rows are SO-05, after SO-04's replay meets Q6.

## Comments

### 2026-09-23 — Owner rulings on SO-04's open points (owner-delegated through the coordinator)

SO-04's replay (`experiments/single-loop-routing/RESULTS-20260923.md`) did not meet Q6: each stated meeting was an LLM
step (§135.2's open name, no table label at turn 3), and Jev answered the meeting `later` in 26/26 runs. Ruled:

1. **A stated meeting is data, not an open name.** For an obligation's `meet` step the person is named by the book (the
   NPC record's `name`, and the record's role if the starter carries one), so §135.2's open-name rule does not apply:
   the clerk stages the stated person with the record's name (the capsule's `untold.label` if the kernel already issued
   one, else the record's name), no LLM step. §135.2 carries the exception; D6 above is amended.
2. **`now` on the check carries the meeting.** The check step implies its `meet` predecessor: when Jev answers `now` for
   the `obligation_check` above the gates, the loop carries the `meet` step directly first (no separate Jev question, no
   `later` to ask), then binds and rolls the check. A `meet`-only obligation (the archivist) stays a routed candidate.
   To make the check available while the meeting is owed, the kernel's issued row gains `then` (§134.9).

Not ruled, left as they are: the Keeper's unclaimed same-skill roll settles nothing (D4 stands), so a Keeper that rolls
the book's check without `action.obligation` and a clerk that then rolls the claimed one make two rolls; and the replayed
Keeper of the turn-3 fixture predates SO-02 (it never claims, and it rolls Arty's first impression, which Q2 takes off the
clerk only). Implementation: §135.26.
