# Band then roll: Jev picks the band, the kernel rolls the number

Status: **ready-for-agent** (BR-01 to BR-05; BR-06 is `ready-for-human` until the owner rules on the consequence
boundary, see Further Notes). Written 2026-09-26 from the owner's proposal in conversation ("对于很多参数都是他根据上下文决定一个范围然后 roll 一个结果").
Branch: `0.9.5a` (written on `0.9.5a` at `ac8a2f0c7`).
Parent spec: `docs/specs/pi-native-single-loop.md` and its ruling **Parameter binding never goes to the LLM**
(contract §135.28, SL-12). This spec adds the fifth binding path that ruling left out: a number the book does not
print, chosen as a band from a rules table and rolled by the kernel.
Related: `docs/specs/rules-as-data.md` (§136: rules are data; `stated` amounts, §136.22), `docs/specs/npc-as-actor.md`
(the NPC numbers this spec pins), ADR-0005 (object identity and usage: the usage profile the creator derives),
ADR-0006 (the driven loop the clerk runs in). Skill `typesafe-jev` (`~/.claude/skills/typesafe-jev`) is the reference
for what Jev can answer; its rule "Jev does not generate numbers" is the premise here.

## Why this spec exists (evidence recorded 2026-09-26, on the retained tables)

Measured over every campaign directory with five or more turns under the worktrees and the App
(227 campaigns, 4,653 turns; receipts of setup turn 0 excluded from value profiles) and the 25 tables that ran
the hybrid-v1 engine (`lane: "run"` telemetry):

- **Speed.** Per step, median / p90: a Jev decision 0.31 s / 0.63 s; a kernel operation 1.0 s / 5.2 s; an LLM
  inference 7.0 s / 17.9 s. Every apply parameter still written by the model costs an inference step.
- **What the model still writes on hybrid tables** (admission `proposed` rows, by effect kind): clue 150, time 143,
  handout 33, object 27, move 27, item 14, person 10, cash 6, threat 6, and one each of usage, note, define, damage,
  flag. The clerk wrote move 157, clue 91, item 10, cash 10. `time` has no candidate at all.
- **Numbers the Keeper invents today.** `time.minutes`: 2,199 writes, 94 distinct values, the top twelve
  (10, 15, 5, 20, 40, 240, 25, 1, 2, 30, 45, 90) cover about four fifths. `npc.skill` pins: 26, values such as
  Fighting (Brawl) 25, Dodge 25, DEX 50. `item.weapon`: 88 of 779 items carried a profile, 18 distinct ids.
  `threat`: every advance one segment. `item.quantity`: 767 of 779 are 1. `cash.delta`: 150 of 325 are the
  book's $20 advance; the rest are prices and quotes.
- **Travel is written twice.** 912 of 1,376 moves landed with 0 minutes; the shipped starter's graph has 280
  `route-to` relations and not one `travel_minutes`. 262 Keeper `time` writes sit in the same call as a
  0-minute move, and 365 `time.why` lines say "from X to Y".
- **The kernel already rolls inside a band.** `npc.archetype`: the Keeper names one of three tiers from
  `npc-stat-archetypes.json`, the kernel rolls every characteristic and skill inside the tier's ranges with its
  seeded dice, once. `stated` time: a dice string is rolled by `rollExpression` with the same dice. Nothing here
  invents a mechanism; it moves who names the band.
- **The band tables exist and have no consumer.** `time-costs.json` (twelve activity categories with
  min/default/max minutes; its own note says it was written "for validating LLM time estimates", and no
  TypeScript reads it), `hazards.json` `severity` (minor 1D3, moderate 1D6, severe 1D10, deadly 2D10, terminal 4D10,
  Keeper Rulebook p.124; read only by the §136 catalog), `npc-stat-archetypes.json` (three tiers),
  `weapons.json` (106 profiles).
- **A closed enum is not yet an answer.** The one consequence-shaped closed bind tried so far, `npc-disposition`,
  went to the Keeper 5 of 5 times at confidence 0.31 (avoids_fighting 0.45 / unknown 0.39). Every band question
  below needs the person's or the action's material in its state, not only the options (the prototype's
  read-then-route lifted the declared move from 0.52 to 0.79).

## Problem Statement

The Keeper (the model) spends inference steps writing numbers that are not judgments of fiction but positions on
a scale the rulebook already prints: how long a search of one room takes, which stat tier a bartender belongs to,
which weapon profile a brass-knuckled knife is closest to, how hard a fall hurts. Each such number costs a
model round trip of about seven seconds at the median, and the number that lands is the model's own, recorded
as `basis: "keeper"`, indistinguishable in the audit from a number the fiction demanded. Where the book prints the
number, §136.22 already lets the Keeper name it (`stated`) instead of writing it. Where the book prints only a
scale, nothing lets anyone name the rung.

The single loop's clerk cannot take these steps either: §135.28 binds a clerk parameter one of four ways (Jev
picks a closed option, a rules default, a value the kernel issued, a sentence composed by code), and none of
them produces a number that is not already in the data. So the clerk's writes stop at moves and clues, and the
`time` effect, the most frequent apply kind on every table, is model-written every time.

## Solution

A fifth binding path, **banded**: the host offers Jev the rungs of a rules table as a closed choice, Jev names
the rung that fits the fiction, and the kernel rolls the number inside that rung with its seeded dice, in the
same transaction as the effect, and records whose number it was. The Keeper may name a rung the same way, in
its own call, instead of writing a number.

- **Bands are rows of rules tables, never lists written for this feature**: the archetype tiers, the weapon
  profiles, the hazard severity ladder, the time-cost categories. A band question's criteria are the rows'
  own descriptions.
- **The roll is the kernel's.** The host and the Keeper send a band; the kernel resolves it, rolls, and mints
  the receipt with `basis: "banded"`, the band's handle and the roll. A band beside the number it fills is
  refused, exactly as `stated` beside an amount is. A book-stated amount beats a band.
- **The band is the judgment, the roll is the randomness.** The rung is the top of Jev's distribution when its
  confidence clears the table's gate; below the gate the parameter is the Keeper's, as §135.28 already says.
  The distribution is recorded, never sampled from (see Further Notes).
- **Three places use it now, without touching who owns consequences.** (1) An NPC the book gave no numbers,
  when a check against them needs a stat block: the tier is bound and pinned by the host on the kernel's own
  `needs` refusal, on both engines, and the refused step is retried once. (2) The weapon profile of a thing:
  on the kernel's `needs weapon` refusal, and as the preset a definition's numeric parameters are copied from,
  so the item creator writes prose and traits, not dice. (3) Travel minutes on the module graph's routes,
  filled once at build from the time-cost table, so a move carries its own time and the Keeper's separate
  travel `time` disappears.
- **Two places run in shadow.** Time-cost bands for the Keeper's own `time` writes and severity bands for its
  own `damage` writes are asked of Jev after the fact and recorded beside the Keeper's number, executing
  nothing, so the owner can rule on the consequence boundary with numbers in hand.

From the player's chair: a fight against the landlord does not stall for a model call to decide how tough a
landlord is; the walk from the office to the newspaper takes the same twenty-five minutes every time; the
knife from the cellar hits like the rulebook's knife.

## User Stories

1. As a player, I want the walk between two places to cost the same time every time I take it, so that the
   clock is a fact of the map and not a fresh guess each turn.
2. As a player, I want a fight against someone the book never gave numbers to start in the turn I declare it,
   so that the table does not stall while the Keeper is asked which kind of person my opponent is.
3. As a player, I want the numbers behind such a person to be rolled once and kept, so that the same bartender
   is the same bartender next week.
4. As a player, I want an improvised weapon to hit the way the rulebook's nearest weapon hits, so that a
   lead pipe is a lead pipe and not whatever the model felt like that turn.
5. As a player, I want a thing the Keeper defines mid-game to carry the rulebook's numbers for its kind, so that
   two revolvers do not fire differently because two different model calls wrote them.
6. As a player, I want a fall or a fire to hurt on the rulebook's scale, so that "severe" means the same 1D10
   at every table.
7. As a player, I want nothing about how a scene plays to change when a band is not confidently chosen, so
   that a low-confidence answer costs me nothing but the old path.
8. As a player, I want the same dice cards, receipts and delivery whether the host or the Keeper named the
   band, so that the audit trail of my table does not depend on who routed it.
9. As a player, I want my time and my hit points never to be changed by a shadow measurement, so that a
   study of the Keeper's numbers can run on my table without touching my table.
10. As a Keeper (the model), I want to name a rung of the time-cost table instead of inventing minutes, so that
    I say "a search of one room" and the kernel says how many minutes.
11. As a Keeper, I want to name a severity instead of choosing dice for harm with no attacker, so that I do not
    have to remember that a severe injury is 1D10.
12. As a Keeper, I want a band I name beside a number I also give to be refused, so that a call never carries
    two answers to one question.
13. As a Keeper, I want a book-stated amount to win over any band, so that naming a rung never overrides what
    the module printed.
14. As a Keeper, I want the kernel's `needs archetype` refusal to come back to me already satisfied when the
    host could pin the tier confidently, with a line saying which tier and why, so that my attack lands in the
    same call instead of the next one.
15. As a Keeper, I want the original refusal back unchanged when the host could not pin the tier confidently,
    so that I keep the decision when the fiction leaves it open.
16. As a Keeper, I want a `needs weapon` refusal to come back satisfied with the closest rulebook profile when
    the host could choose it confidently, so that the item lands in the same call.
17. As a Keeper, I want to override a band the host chose with an ordinary operation of my own, with its own
    receipt, so that a host mistake is reconciled in the open and never silently undone.
18. As a Keeper, I want the move I make or the clerk makes to carry the route's travel minutes from the graph,
    so that I stop writing a second `time` effect for the road.
19. As a Keeper, I want my `time` and `damage` numbers left exactly as they are while the shadow runs, so that
    the study measures me and does not steer me.
20. As a Jev decision, I want a band question whose options are the table's own rows with their own
    descriptions, and whose state carries the person or the action the band is about, so that I judge a
    situation and not a list of ids.
21. As a Jev decision, I want an ordered ladder (severity) asked as a Score and unordered kinds (time-cost
    categories, archetype tiers, weapon families) asked as a Choice, so that the primitive fits the shape of
    the table.
22. As a Jev decision, I want the weapon profile asked in two levels, the skill family first and the profiles of
    that family second, so that 106 options do not dilute one distribution.
23. As a Jev decision, I want every band question to carry a `none` or `unknown` exit, so that a thing that is
    no weapon and an action with no time cost are answerable.
24. As a Jev decision, I want the same band question on the same state never asked twice in a turn, so that a
    refusal loop cannot spend the budget on one person.
25. As the host, I want the roll to happen in the kernel with the turn's seeded dice, so that a replayed call
    returns the same number and a rolled number is never minted outside the transaction that records it.
26. As the host, I want the receipt to say `basis: "banded"` with the band's handle and the roll, so that a
    number the Keeper did not choose is never filed as the Keeper's.
27. As the host, I want the bind row to record the table, the band, the distribution and the confidence, so that
    gates are calibrated from real tables and not guessed.
28. As the host, I want a per-table confidence gate as a code constant, so that the archetype gate and the
    time-cost gate can differ and each is measured.
29. As the host, I want the archetype and weapon retry to live in the operation dispatcher the Keeper's own
    calls pass through, so that both engines get it and a policy-origin write and a model-origin write take the
    same path.
30. As the host, I want a band to fill only the slot the Keeper's own amount fills, so that `stated` and the
    kernel's issued values keep precedence.
31. As the host, I want travel minutes filled at build from the book when it states them and from a
    time-cost band once when it does not, recorded with their provenance on the edge, so that the graph is
    data and no per-turn Jev call is spent on a road.
32. As the host, I want the item creator's job packet to carry the host-chosen preset and the creator to copy
    its numbers unless the description states a physical contradiction, so that a definition's dice are
    traceable to a rulebook row.
33. As the host, I want the enhanced-items auditor to refuse a parameter that departs from the preset without a
    stated contradiction, so that "use presets as evidence" becomes a checked rule.
34. As the host, I want the shadow lane to ask its questions from the player's declaration and the turn's
    receipts, never from the Keeper's `why`, so that the answer is not read off the Keeper's own number.
35. As the host, I want the shadow to record the Keeper's number, the band, the band's range and whether the
    Keeper's number fell inside it, so that the report is a hit rate and not an impression.
36. As the owner, I want the consequence boundary (§135.3, §136.24) left exactly where it is by this spec,
    so that executing time and damage bands is a ruling I make with the shadow's numbers, not a side effect.
37. As the owner, I want a kpi count of receipts by basis (`keeper` / `stated` / `banded`) per kind, so that
    "how many numbers does the model still invent" is one line per table.
38. As a maintainer, I want no new world-state key and no new receipt kind, so that recovery, worldlines and
    history see a banded receipt exactly like every other receipt of its kind.
39. As a maintainer, I want the band tables' rows to be the only source of a band's range, so that changing a
    range is a data change in one file with a source note.
40. As a maintainer, I want a kernel that does not know a band and a schema that does not offer it to fail
    closed and loudly, so that a half-shipped band never lands a number.

## Implementation Decisions

### D1. The fifth binding path

`BindingPath` gains `banded`. A closed parameter is **banded** when its vocabulary is the rows of a band table
(D2) and its value is a number or a dice expression that the table's row supplies as a range, a dice string or
a set of per-stat ranges. The bind question offers the rows as criteria; each criterion's text is the row's own
description from the table (the archetype's fix text, the hazard row's rulebook note, the time-cost category's
name and range, the weapon's display name and skill). The bound value the clerk writes is the **band's handle**,
never a number. The kernel turns the handle into the number.

Precedence among the paths is unchanged and extended by one row: `stated` (the kernel issued the value, or the
book states the amount, §136.22) beats `banded`; `banded` beats `rule-default`; a parameter with neither an
answer above the gate nor a default is the Keeper's (`keeperOwns`, §135.28). Nothing here creates an
`infer(bind)`.

### D2. Band tables are rules data

A **band table** is a rules-json table (or a section of one) whose rows each carry a range. Four are bound by
this spec, none is authored for it:

| table | rows | what a row supplies | primitive |
| --- | --- | --- | --- |
| `npc-stat-archetypes` | three tiers | per-characteristic and per-skill `[lo, hi]` | Choice |
| `weapons` | 106 profiles, grouped by `skill` | the profile itself (damage die, range, uses, magazine, malfunction, impale, damage-bonus rule) | Choice in two levels: skill family, then profile (beam 3) |
| `hazards.severity` | five ordered rungs | `damage_expr` | Score (rungs in the table's order) |
| `time-costs.categories` | twelve activity categories | `[min, max]` minutes and a `default` | Choice |

The catalog of band tables and the field each binds (`npc.archetype`, `item.weapon` and the creator's preset,
`damage.band`, `time.band`, and the route edge's `travel_minutes`) is one closed registry beside §136's catalog,
read by the kernel, the candidate builder and the shadow lane. A table is a band table only if it is in the
registry; nothing scans rules-json for ranges.

`time-costs.json` changes only its `source_note` (the Python-era clamp script it describes no longer exists;
the note says what the table is now) and gains nothing. The `local_travel` and `long_travel` categories are
offered only to the build-time route fill (D6), never in a per-turn question: a move's time is the edge's.

### D3. The kernel rolls, in the transaction, and stamps the basis

The public `apply` schema gains `band` on `time` and `damage` (both effects already accept `stated`; `minutes`
and `dice` are already optional for that reason). `npc.archetype` and `item.weapon` keep their fields: the
band is the field's value, as today.

The kernel resolves `band` by the registry: `time.band` names a time-cost category and the kernel rolls one
integer uniformly in `[min, max]` with `kernel.rng` (the same seeded dice as `stated_roll` and the archetype
roll); `damage.band` names a severity rung and the kernel rolls its `damage_expr` where it rolls `dice` today.
The roll happens inside the apply transaction; a replayed call replays the journaled result and never rolls
again (T12's same-call rule, unchanged).

Refusals mirror §136.22: `band_unknown` (`unknown_entity`; `details.options` lists the table's rows),
`band_conflict` (`invalid_params`; `band` beside `minutes` / `dice`, or beside `stated`; `details.fields`),
`band_none` (`invalid_params`; `band` on an effect kind the registry does not bind). The `fix` texts name the
`details` keys they point at (the §8 host decision: what a fix names, the model sees).

The receipt of every banded effect carries `basis: "banded"`, `band: <handle>` and the roll: `band_roll:
{min, max, total}` for time, the ordinary damage roll receipt for damage. `stampBasis` is the one writer of the
basis on these kinds and gains the third word. Archetype and weapon receipts already name the tier or the
profile; they gain `basis: "banded"` only on the bind row (D7), not on the kernel receipt, because the kernel
cannot tell who chose the field.

The mechanics projection changes nothing: a banded time is a time card, a banded damage is a damage card.
Numbers stay off the prose (§16.3).

### D4. The band is the top of the distribution above a gate; the distribution is recorded

`clerkBind` takes the band Jev chose when the answer's confidence is at or above the table's gate, a code
constant per band table (initial values are placeholders to be calibrated from the bind rows and the shadow
lane; the admission lesson applies: a gate set by hand at 0.87 never opened). Below the gate the parameter takes
its rules default when it has one (time-cost `default` is **not** a default of a band that was not chosen; a
time band has no rules default) and is otherwise the Keeper's. The distribution and confidence are recorded on
the bind row whatever the outcome.

The band is never sampled from the distribution. The alternative (keep rungs to 0.8 cumulative mass,
renormalise, draw one) was considered in the design conversation and set aside: Jev's probabilities are
calibrated confidence about which rung is right, not the world's randomness, so drawing from them would turn
"the model is unsure whether you glanced or searched" into a one-in-three chance of a five-minute search. The
roll inside the rung is the randomness this spec adds. Revisit with shadow data if the argmax rung is often
wrong by one.

### D5. Where the band is bound now: the kernel's own `needs`, on both engines

Two kernel refusals already name a band table's rows in `details.needs.options`: `needs {field: "archetype"}`
(a combat or a check against a person with no stat block) and `needs {field: "weapon"}` (an item whose
`weapon` is not a profile). The kernel extension's canonical operation dispatcher, which every Keeper call and
every clerk call passes through (§135.4), gains one recovery: when a call is refused with a `needs` whose
`field` is in the band registry, the host asks Jev the band question (D1, D2), and if the answer clears the
gate it writes the pin as its own operation (`apply npc {name, archetype}` / the same `apply item` with
`weapon` set), with a call id minted from the one ordinal (host writes need a minted call id; a self-made id is
refused), then retries the refused call once. The Keeper sees the retried result, plus a `clerk_did` line naming
the band and its confidence. Below the gate, on a spent Jev budget, or when Jev is unavailable, the Keeper sees
the original refusal unchanged.

Guards: the same `needs` for the same person or thing is asked of Jev at most once per turn (the second time
escalates to the Keeper by returning the refusal); the retry is one, never a loop; the pin is admitted like any
clerk write (§32) and is a parameter of an operation the Keeper or the player already chose, so it stays inside
§135.3's clerk authority (the tier is not a consequence: it is the stat block the declared check needs). The
state of the archetype question is the person's capsule dossier (`present[]` row: role, wants, fears, the
table's own label) and the declaration that needed the numbers; the state of the weapon question is the item's
name and `why` and, when it exists, the definition's description.

This lives in the dispatcher and not in the driven loop so that the legacy engine and hybrid-v1 both get it,
and so that the pin taken for a Keeper's model-origin call and for a clerk's policy-origin call is one code
path. The single loop's own candidates are unchanged by this decision; a clerk candidate refused `needs
archetype` goes through the same recovery.

### D6. Travel minutes are data, filled once

Module registration (the starter's and a built book's) fills `travel_minutes` on every `route-to` relation that
lacks it: from the book when the reader extracted a stated travel time (a `time_cost` shape on the route, §136),
else by one Jev Choice over the travel categories of `time-costs` per edge, in the build, with the two scenes'
names, summaries and places as state, taking the category's `default` (the same road is the same length every
time: this is the one band that is not rolled). The edge records `travel: {basis: "stated" | "banded", band?,
confidence?}`. An edge that already carries minutes is untouched. The shipped starters are regenerated once in a
data ticket and reviewed by diff; a module built before this spec keeps its zero minutes until rebuilt
(campaigns are compile snapshots).

The move effect's existing default ("omitted means the value on the graph edge") then carries the time, for the
clerk's moves and the Keeper's; the capsule's `exits[].travel_minutes` already projects it. No prompt change
tells the Keeper to stop writing travel time: the offer ledger and the kpi (D8) measure whether it does.

### D7. The item creator copies a preset

The kernel's definition and usage job packet (`request.catalogs` today carries the whole weapons table for a
weapon) gains `request.preset`: the weapon profile the host chose by the two-level band question before the
job is filed, with its confidence, when the answer clears the gate; absent otherwise. The enhanced-items package
(a new version, since package bytes are frozen per version) changes two rules: the creator's weapon parameters
are the preset's, copied field for field, and may depart from it only where the definition's description states
a physical fact that contradicts the preset, saying so in `basis`; the auditor refuses a parameter that departs
from `request.preset` without such a statement. Prose, traits, the document and the player view stay generated
in the play language. Without a preset the package behaves as today (the presets catalog as evidence). Spell
and item categories are unchanged.

### D8. Telemetry, the Keeper's note, and the kpi

- Every banded bind writes a `lane: "run"`, `event: "bind"` row (§135.28's row) whose record has `path:
  "banded"`, `table`, `band`, `confidence`, `distribution`, and, once the kernel answered, the roll. The D5
  recovery writes the same row with `origin` naming the refused call.
- The Keeper's `coc-clerk` note (`clerk_did[].binding`) gains the line for a banded parameter: "band:
  single_room_search (10–45 min), rolled 27; the player's words placed it there. To rule otherwise, settle it
  with your own operation." (System language; Keeper-only.)
- `tests/play/kpi.py` counts receipts of the five §136.22 kinds plus archetype pins and weapon profiles by
  `basis` (`keeper` / `stated` / `banded`), one line per table.

### D9. The shadow lane for time and damage

After a model-origin `apply time {minutes}` or `apply damage {dice}` succeeds, the host asks Jev the band
question for that effect in the background (the same question D1 would ask; state = the player's declaration
of the turn and the receipts settled before this call, never the Keeper's `why` or `minutes`) and writes one
`lane: "band-shadow"` row: `{turn, call_id, kind, table, keeper_value, band, range, inside: bool, confidence,
distribution, ms}`. It executes nothing, changes no receipt, no card and no prose, and never holds the turn
(it is fire-and-forget after the tool result, like the verifier). A report script over the rows gives, per table
and per kind, the hit rate (Keeper's number inside the argmax band), the rate above each candidate gate, and
the Jev seconds spent. That report is the input to the owner's ruling in Further Notes.

### D10. What is not a band

Money is never rolled (§58: every amount names its source; a rolled price is a fabricated price with a
receipt). A threat's advance is `{one segment, hold, give ground}`, not a range, and stays the Keeper's (§30.9).
Quantities default to 1. Open names (an improvised thing, a walk-on person), `why`, `how`, `label`, `via`, a
note's text, a ruling's statement, a definition's description, a document's text are prose or open vocabulary
and remain the Keeper's or the creator's. A band never fills a value the kernel issues or the book states.

## Testing Decisions

A good test drives the real entry (the emitted kernel over RPC; the kernel extension's dispatcher with the
vendored driver and stub Jev ports; the tool schema), and asserts what was returned, which receipts exist with
which basis, and what the Keeper and Jev were shown; never private state or call order. Every product-behaviour
test is killable by a mutation of the code it covers, and the mutation record is kept in the ticket's Comments.
A "forced" roll is a recorded seed for exactly that call sequence; the dice are seeded, never stubbed (prior art:
`tests/kernel/test_stated_operations.py`).

- **Kernel (pytest over `build/kernel/rpc.mjs`, a derived haunting; build first, one pytest at a time, on the
  ticket's own worktree):** `apply time {band}` lands minutes inside the category's range with `basis:
  "banded"`, `band` and `band_roll`, and the same seed gives the same total; `apply damage {band}` rolls the
  rung's dice with `basis: "banded"`; `band` beside `minutes` / `dice` / `stated` is `band_conflict` and writes
  nothing; an unknown band is `band_unknown` with the rows in `details.options`; `band` on `cash` is
  `band_none`; a replayed banded call returns the journaled total; the rest recovery (≥360) and MP recovery
  (≥60) fire on a banded time exactly as on a Keeper's; the `needs archetype` and `needs weapon` refusals are
  unchanged at the kernel (the recovery is the host's).
- **Tool schema (node:test, prior art `tests/extension/stated-operations.test.mjs`):** `band` offered on
  `time` and `damage` and nowhere else; every old shape still valid; the fake kernel answers `band` with a
  banded receipt and refuses `band_conflict`.
- **Dispatcher recovery (node:test with the vendored driver, `harness.mjs` and stub decision ports; prior art
  `tests/extension/single-loop-binding.test.mjs`):** a Keeper `resolve` against an unpinned person refused
  `needs archetype` → Jev (stub) answers a tier above the gate → the host's `apply npc archetype` lands with a
  minted call id and admission → the retried `resolve` succeeds → the Keeper's tool result is the retried
  result with the `clerk_did` band line; the same with Jev below the gate → the original refusal, byte for
  byte, and no write; the same person asked twice in one turn → the second refusal goes to the Keeper without a
  Jev call; a spent Jev budget or an unavailable Jev → no call, original refusal; on the hybrid engine a clerk
  candidate takes the same path and its bind row reads `path: "banded"`; `needs weapon` the same way with the
  two-level choice and `none`.
- **Creator preset (node:test over the mods job seam, prior art the existing enhanced-items and
  `mods` tests):** a weapon definition's job packet carries `request.preset` when the stub answers above the
  gate and not otherwise; the auditor refuses a result whose damage departs from the preset with no contradiction
  in `basis`, accepts one that states it, and accepts a packet without a preset exactly as today; the package
  loads at its new version and digest, and the old version at the old digest.
- **Route fill (pytest over registration, and the reader's `check`):** a starter whose route lacks minutes
  registers with minutes filled from the stub's category `default` and `travel.basis: "banded"`; a route with
  stated minutes is untouched; the regenerated shipped starters differ from the parent only on `route-to`
  relations (diff reviewed in the ticket); every capsule and options golden of every starter is unchanged
  except `exits[].travel_minutes`.
- **Shadow (node:test):** a model-origin `apply time` writes one `band-shadow` row with every D9 field and the
  turn record is byte-identical to the parent commit's; removing the recording fails the test; the row is never
  written for a clerk write or for a `stated` write; the shadow never delays the tool result (asserted on the
  result's timestamp against the row's).
- **Replay (`experiments/single-loop-routing`, the turn-3 fixture, after D6's data):** the clerk's move to the
  morgue carries the edge's minutes; the recorded Keeper `time 25` for the same road is reported as a
  redundant write, not scored; 8/8 live actions still match by kind.
- **Live gate (not a worker ticket):** a real table (the standing Keeper model, the main session as the one
  player, one sentence a turn, `tests/play/driver.py`) that reaches a fight against a person the book gave no
  numbers; the turn's LLM steps compared with the 2026-09-26 table in `npc-as-actor.md` Appendix B, and the
  kpi's basis line for the table.
- **Baselines green:** `npm run test:ext`, `uv run --frozen python -m pytest tests/kernel tests/play` on the
  rebuilt emitted kernel; the heavy suites on leehow-pc with the machine-level lock.

Seams, from highest to lowest: the kernel RPC seam (everything the kernel decides: roll, basis, refusals, route
fill); the kernel extension's dispatcher seam with stub Jev ports (the recovery, the bind rows, the note, the
shadow); the tool schema seam (that a field exists). No new seam is introduced.

## Out of Scope

- Executing time or damage bands as clerk writes, or offering them as loop candidates: BR-06, blocked on the
  owner's ruling (Further Notes). This spec only measures them.
- Money: no band, no roll, ever (§58).
- Threat clocks (§30.9), sanity loss ladders (a consequence; the sanity table carries no sample-loss ladder as
  data today), NPC stance and movement, note, ruling, flag values.
- Sampling the band from the distribution (D4).
- Play-language labels (`label` on clue, scene, handout, item): a lane concern, not Jev's and not the
  Keeper's inline.
- The 262 `npc to: away` writes the Keeper makes when the party leaves a scene (presence is already
  scene-bound in the kernel, so most of these are redundant): observed, not changed here.
- Editing the ranges of any band table. Changing `weapons.json`, `hazards.json` or
  `npc-stat-archetypes.json` rows.
- The legacy Python-era clamp the `time-costs.json` note describes.
- Backfilling travel minutes into campaigns already created (compile snapshots) or into PDF books already
  built; they gain them on rebuild.

## Further Notes

**The ruling BR-06 waits for.** §135.3 lists the clerk's authority and calls consequences (damage, sanity,
cash beyond the declared) boss-only; §136.24 says the clerk acts "never for a hazard or a consequence"; the
memory rule "the module is a reference, the clock is the Keeper's pacing instrument" says the same of time.
Letting the clerk land a banded `time` for the player's declared action, or a banded `damage` for a hazard the
book states, amends those three. The owner said (2026-09-26) to build the parameter side first and rule on the
consequence side with the shadow's numbers. BR-06's ticket is filed `ready-for-human` with the question:
*may the clerk land the banded time of the player's own declared action, and the banded damage of a
book-stated hazard, when the rung clears its gate?* The shadow report (D9) is the evidence to rule on.

**On calibration.** Every gate in this spec is a placeholder until the bind rows and the shadow rows exist. The
admission lane's history is the warning: a hand-set gate of 0.87 never opened on a real table while typed
answers sat at 0.42–0.73. Ship the gates low enough to measure, then move them.

**On Jev's reach.** The archetype question's state must carry the person (role, wants, fears, the label), not
the name alone; the disposition bind's 0.31 was asked with the fight's view but without the person. The weapon
question's state must carry the thing's description when a definition exists. The skill's checklist applies to
each question written under this spec.

**On the Keeper naming bands itself.** `time.band` and `damage.band` are on the public schema, so the Keeper
may name a rung instead of a number today, with no prompt change. Whether the base prompt should say so is a
prose-mod question and is not decided here.

## Comments

(none yet)
