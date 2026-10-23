# NPC portrayal: the Keeper says what a person does, the author makes it seen

Status: draft r2 (design only; revised after the web-ChatGPT review of 2026-10-23; owner decisions recorded 2026-10-23)

Contract: `docs/kernel-rpc.md` §260 (draft). Builds on §254 (author craft sections and grants), §255 (kept looks),
§168.5 (first-sight shown marks) and §258 (NPC mind). Research: `docs/research/npc-portrayal-lotm-20261023.md`.
Review: owner project files `npc-portrayal/chatgpt-review-r1.md`. Owner thread: "NPC 描写文笔" (2026-10-23).

## Problem Statement

People at the table read as reports. The Keeper decides what a person says and how they stand toward the investigator,
but nothing carries what the person *does*, and the author is told not to supply it: a silent response "supplies no
physical action" and the author may choose only "small expressive gestures" (`DECISION_AUTHOR_INSTRUCTION`). So the
prose either gives everyone a nod and a smile or spends adjectives on someone who does not matter this moment. The owner
wants what 诡秘之主 does: a reader sees the scene at once; the person the moment is about is drawn so that one can picture
them; people the reader does not care about right now get a line.

Three gaps, all system-level:

1. **No channel for a person's behavior.** `Interaction` (`runtime/decision-content.ts`) carries act, recipients and
   content only.
2. **No permission to invent behavior.** §254.6 grants `surface_detail` and `appearance`; nothing bounds what the author
   may invent of expression, posture, gesture, voice or pauses, so the core forbids it.
3. **No notion of attention.** The author receives every present person the same way.

The old natural-npc and npc-voice packages are dead under v4.

## Solution

1. **Two layers of fact (core invariant).** Settled facts (where people and things are, who holds what, contact,
   wounds, messages passed, agreements, outcomes, elapsed time) come only from the Keeper's packet and the kernel.
   The author may add *micro-presentation*: face, gaze, small posture, voice, untimed pauses, bodily detail that changes
   no interaction state. Delivered prose is public history, so the next Keeper turn sees what was written, but prose is
   never the source of an interactive entity, a spatial relation, a possession or a mechanical effect: "he touched his
   coat pocket" does not put a key in it.
2. **The Keeper writes a beat** (owner's design: KP gives the person's state and a very short line of what they do).
   One short clause of observable behavior on any response, including `silent`. It is portrayal direction; anything
   with consequence (a move, a handover, blocking a way, a signal to someone, an attack, a cost) must be a settled
   action, never a beat. Free text (owner decision 1).
3. **The host marks attention from observable events only.** Each person the investigators can perceive gets `tier`
   (`focus`, `engaged`, `background`) and `needs_introduction`, computed from what the player's turn was about and
   what settled publicly. Hidden state never feeds the computation: changing only hidden values leaves the author's
   input byte-identical.
4. **The author sees public presentation, not numbers.** Directed public disposition toward each investigator, the
   public mood text, visible condition. No trust/fear/pressure numbers, no hidden or private attitude.
5. **A new core grant `bearing`** for micro-presentation, inside the invariant above. Nonverbal behavior never creates a
   commitment, consent, a message, a belief change or a result; a settled refusal stays a refusal.
6. **Concealment in three layers.** Visible behavior (only what is public or in the beat), an investigator's impression
   (allowed, uncertain, never a conclusion), and revealed facts (only what a settled check or the observer's revealed
   knowledge establishes, across turns).
7. **A new package, NPC Portrayal (写实人物).** Author section (`slot: bearing`, `on: ["people"]`, `grants:
   ["bearing"]`) teaching selection principles from the research; a short Keeper section on beats. Enabled by default
   from the first release (owner decision 2).

## User Stories

1. As a player, I want the person the moment is about drawn so that I can picture them, so that the scene appears in front of me.
2. As a player, I want people who do not matter this moment given a line or nothing, so that the prose does not drag.
3. As a player, I want a visible change in someone written into their body, so that I notice the turn in the exchange.
4. As a player, I want emotions shown rather than named, so that I read people the way my investigator does.
5. As a player, I want a liar or someone hiding fear to give nothing away that my investigator has no grounds to see, so that Psychology matters.
6. As a player watching two people argue, I want the argument written as the thing I am watching, so that I do not miss what matters because nobody spoke to me.
7. As a player, I want a person's behavior never to move them, hand me anything, block me, signal anyone or decide anything unless the rules settled it, so that the rules still decide what happens.
8. As a player, I want someone I have already seen not reintroduced, so that I am not told the same thing twice.
9. As a player, I want a refusal to read as a refusal however it is performed, so that the prose never reverses a decision.
10. As the Keeper, I want to say in a few words what a person does, so that my attention goes to decisions, not prose.
11. As the author, I want each perceivable person marked by attention and whether they need an introduction, so that I know where to spend detail.
12. As the author, I want a bounded permission for micro-presentation, so that I can write a picture without inventing facts.
13. As the owner, I want portrayal craft in a package, so that changing how people are written means changing a package.
14. As the owner, I want each turn's tiers and the portrayal section recorded, so that a turn with flat people can be explained.
15. As a maintainer, I want hidden NPC state provably unable to change the author's input, so that portrayal cannot leak secrets.

## Implementation Decisions

- **Beat.** `beat?: string` (trimmed, 1–120 characters, one clause) on every `Interaction` branch. Schema description
  and the Keeper section: observable behavior of this person this moment; never words (content), never a move, handover,
  block, signal to another person, attack, cost or anything the kernel settles. The host judges no meaning. A beat does
  not raise a person's tier. Silent + beat is nonverbal behavior.
- **Who is perceivable.** v1 uses the delivery's existing perception: `decision_context.scene.presence.people` (people
  in the investigator's scene the delivery may show, as `seenPerson` and presence already decide), visual and audible.
  A person kept out of sight stays out. Audio-only and remote channels (behind a door, on the telephone, a letter) wait
  for §258 P2's `channel`/`audience`; until then such a person gets no bearing and the craft says to describe a voice
  only through what is heard. Per-investigator projection also waits for §258 P2 (tables are single-investigator today).
- **Attention.** Pure host function over publicly settled data only:
  - `focus`: the person the player's input acted on or addressed (settled check or outcome targeting them, or the
    investigator's speech addressed to them), a person whose response is the substance of the moment (a response that
    answers, refuses, warns or reports, to anyone the investigators can perceive, including another NPC), or a person
    with a public outcome this input (arrived, left, hurt, changed public disposition).
  - `engaged`: any other person with a selected response.
  - `background`: everyone else perceivable.
  No cap on focus count; the craft says a shared event can be written as one picture. Hidden fields
  (`trust`, `fear`, `pressure`, `control`, private disposition, hidden mood) are never inputs.
- **Introduction.** `needs_introduction: true` when the observer has no earlier delivery that showed this person
  (§168.5 `shown`), read before this turn's write-back; §255 looks never stand in for observation history.
- **Public presentation.** `presence.people[].bearing = {tier, needs_introduction?, toward?: [{ref, disposition}],
  mood?, condition?}`. `toward` is the directed public disposition toward each investigator (§258 `public` when set,
  else the disposition, only when the state does not mark it hidden); before §258 P1 it maps today's directed affinity
  by a closed enum map (`hostile→hostile`, `guarded→unfriendly`, `neutral→neutral`, `friendly→friendly`). `mood` only
  when public. No numbers reach the author.
- **Concealment and revealed knowledge.** Core instruction: visible behavior comes from the beat and public
  presentation; an investigator's impression may be written as uncertain ("seems") and never as a conclusion; a
  concealed feeling, lie or motive is stated only as far as the observer's revealed knowledge (earlier turns included)
  or a check settled this input establishes, and only what it establishes. §257.17 `tell` and §258 `mode: lie` stay
  Keeper-side.
- **Grant `bearing`** in `AUTHOR_GRANT_LIMITS` (text in §260.4): micro-presentation only; props only things already in
  the supplied context (held items, kept looks, place fittings) and never to change their state or position; no change
  of a person's place or of their spatial relation to things or people that would matter to play; no contact; no
  signals or messages; no timed pause; no implied consent, commitment or result; reveals nothing concealed; never
  contradicts a kept look.
- **Settled fact `people`** joins §254.2: `presence.people` is non-empty after settlement.
- **Author instruction** edits in place (§260.6), plus the two-layer invariant and the nonverbal-semantics rule.
- **Package.** `mods/npc-portrayal/` 1.0.0, `default_enabled: true` (owner decision 2); requires
  `instructions.sections.v1`, `instructions.sections.author.v1`, `npc.bearing.v1`. Author text is the revised
  Appendix A (target well under 4 KB); Keeper text Appendix B (≤ 600 bytes). English, original wording, no novel text,
  no numeric quotas.
- **Coexistence with narration-craft.** narration-craft keeps first meeting, names, book-given looks in full and speech
  coherence; NPC Portrayal says nothing about first-meeting portraits beyond "introduce compactly when invented, then
  only what changed". The integration test reads the assembled author prompt, not the sections alone, and fails on two
  competing first-meeting rules.
- **No habit write-back in v1.** Existing mannerisms (source `presentation.mannerisms`, §258) may be used; invented
  ones are not persisted. Revisit only with evidence from continuous play.
- **Telemetry.** `lane: "author-craft"` adds `bearing: [{ref, tier, needs_introduction?, beat?: true}]`.

## Testing Decisions

1. **Deterministic contracts (no model):** hidden-only state changes leave the author input byte-identical (tier,
  presence, everything); a person out of sight gets no bearing; tiers for addressed, targeted, observed NPC-to-NPC and
  outcome cases; `needs_introduction` from shown marks, unaffected by this turn's looks write-back; `toward` mapping;
  the grant text and the `people` fact; beat schema bounds. Highest seams as in §254 tests
  (`tests/extension/author-craft-sections.test.mjs`, `kept-looks-host.test.mjs`, `turn-packet-prototype.test.mjs`).
2. **Frozen-input author runs (MiniMax 3.1, never Opus):** twelve settled inputs, three generations each: first sight
  of a key person; third meeting; three people arguing; investigator watching NPCs; hidden fear; an undetected lie; a
  Psychology success with a limited reveal; combat with hits and misses; a person handling an existing object; hostility
  turning to restraint; repeated silence and refusal; a busy room with one relevant bystander. Telephone/behind-door
  cases are added when §258 P2 channels land.
3. **A/B/C:** A old baseline; B new core (beat, projection, grant) without the package's author section; C B plus the
  section. B and C share identical settled author inputs. Blind read: can the reader picture the person, is the detail
  proportionate, is the Chinese natural, does it help understand the exchange; wins, losses and ties recorded.
  Hard violations counted separately: an unsettled result, a leaked secret, impossible sense access, an overridden
  player choice, a reversed or dropped communication, drift from a kept look. TTFT and token counts paired.
4. **Continuous live play** on the owner's Mac with the real driver, one natural input per turn, retained seed
  (Blood Road Esso station; a high-pressure scene from another module). A loss of C to B, or any hard violation, is
  fixed in the package (version bump) or reported to the owner; the default stays on unless the owner says otherwise.

## Implementation notes (2026-10-23)

- Settled checks carry no person reference today (`settled_results.checks` names labels), so a check targeting a person
  does not yet make them `focus`; their response or a public outcome usually does. Revisit if live play shows the gap.
- `focus` responses are every non-silent act except `greet` and `acknowledge`; those and a silent response are `engaged`.
- Mood and condition reach the author as before through `decision_context.people` (`now`, `state`); `bearing` carries
  `tier`, `needs_introduction` and directed `toward` only. `needs_introduction` is this turn's first-sight people.

## Out of Scope

- §258 P1/P2 themselves (attitude storage, hidden marks, channels, audience); this reads them when present.
- Per-investigator author projection (waits on §258 P2).
- Habit persistence; per-NPC voice masks; a second writing lane; speech wording (narration-craft, zh-optimize).
- Any code check of prose wording.

## Owner decisions (2026-10-23)

1. **Beat shape: free text.** ChatGPT recommended a small enumerated cue (host-enforceable, less expressive); the owner
   chose free text. The boundary is held by the schema description, the Keeper section and the two-layer invariant.
   If live play shows beats smuggling outcomes, report it with the turns; do not switch shape without the owner.
2. **Default: on** from the first release (ChatGPT recommended off until acceptance).

## Appendix A: author section "People in motion" (draft r2, English package text)

> Make people feel physically present, not catalogued. Choose details for what they add to this moment. Someone
> important may need almost nothing now; a bystander may earn one revealing reaction. The tier on each person guides
> emphasis, not length; it is not a quota.
>
> Background: most need no individual description. When one matters, name them by role and give the one thing they do
> or the reaction that counts. Sometimes the lack of a reaction is the detail.
>
> Engaged: let the conversation carry itself. Add a brief physical detail where the exchange changes direction, where a
> response contrasts with what came before, or where a movement makes the moment easier to see. Many lines need none.
>
> Focus: find the detail that makes this moment theirs: a posture that changes, a movement begun and abandoned, a hand
> kept too still, a voice that drops. When a reaction deserves more room, unfold a few connected observations in the
> order the eye would catch them. Do not inventory hands, eyes, face and posture by routine. A quiet reaction can weigh
> as much as a large one.
>
> People in relation: show people through each other. Who gets looked at, who is ignored, who keeps to the forms, who
> waits for whom to finish, whose behavior breaks from the room. When the investigators are watching people deal with
> each other, follow that exchange; the person who matters need not be talking to an investigator.
>
> Someone new: if you are giving them a look, make it compact and recognisable, a few things that set them apart, then
> let it rest. Later, give what is different now. A habit the person is known for can return when it fits, and means
> more when it comes differently, is cut short or is missing. Do not hand every person a signature gesture.
>
> Feeling through behavior: prefer what a person chooses to do over naming what they feel. Composure, economy of
> movement, the rhythm of their speech, how they hold the space around them often say more than an adjective. A
> reaction is not proof of a motive: a pause need not be a lie, stillness need not be confidence, courtesy need not be
> warmth. When the investigator reads someone, keep the reading uncertain. Two people with the same attitude do not get
> the same gestures; character, circumstance and station decide.
>
> Specificity: precise and economical. Use the body against what is already there: their clothes, the counter, the
> chair, what they hold. Do not invent objects to give hands something to do. A beat is direction to make seen, not an
> event to extend: never carry a gesture into an outcome no one settled. A hesitation needs no stated duration. In
> combat and urgent action keep to the settled order and results; not every movement needs a reaction.
>
> Restraint: no stock gestures, no rows of smiles and nods, no stock eye phrases, no exaggerated trembling, no strings
> of emotional adjectives. Not every reaction is significant, not every silence suspicious, not every minor character
> memorable. Write naturally in the play language, not translated English gesture formulas. Give the reader enough to
> see the person, then let the words, the situation or the silence do the rest.

## Appendix B: Keeper section "Beats" (draft r2)

> When a person visibly does something that matters to how the moment reads, give their response a beat: a few plain
> words ("keeps wiping the same glass", "stops reaching for the drawer"). The author renders it. A beat is behavior
> only: never words, a move, a handover, blocking someone, a signal to another person, an attack or a cost; those are
> actions you settle. Most responses need no beat.
