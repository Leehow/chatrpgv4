# NPC portrayal: the Keeper says what a person does, the author makes it seen

Status: draft (design only; awaiting owner review and a web-ChatGPT critique)

Contract: `docs/kernel-rpc.md` §260 (drafted with this spec). Builds on §254 (author craft sections and grants), §255
(kept looks) and §258 (NPC mind; its P1 attitude model). Research: `docs/research/npc-portrayal-lotm-20261023.md`
(how 诡秘之主 renders people other than the protagonist). Owner thread: "NPC 描写文笔" (2026-10-23).

## Problem Statement

People at the table read as reports. The Keeper decides what a person says and how they stand toward the investigator,
but nothing carries what the person *does* with their body, and the author is told not to supply it: a silent response
"supplies no physical action" and the author may choose only "small expressive gestures" (`DECISION_AUTHOR_INSTRUCTION`).
So the prose either gives a nod and a smile to everyone or stacks adjectives on someone who does not matter this
moment. The owner wants what 诡秘之主 does: a reader sees the scene at once, the person the moment is about is written as
a picture (hands, face, eyes, pauses), and people the reader does not care about right now get one line.

Three gaps, all system-level:

1. **No channel for a person's behavior.** `Interaction` (`runtime/decision-content.ts`) carries act, recipients and
   content only. A Keeper that wants the clerk to back away toward the shotgun has nowhere to put it.
2. **No permission to invent behavior.** §254.6 grants `surface_detail` (places) and `appearance` (looks of an
   undescribed person). Nothing bounds what the author may invent of a person's expression, posture, gestures, voice,
   pauses or habits, so the core forbids it by default.
3. **No notion of attention.** The author receives every present person the same way. Nothing tells it whose state
   changed this turn, who is being spoken to, and who is merely in the room.

The old natural-npc and npc-voice packages are dead under v4 (they fed the Keeper-writes path).

## Solution

1. **The Keeper writes a beat.** Every interaction (including `silent`) may carry `beat`: one short plain clause of what
   the person does this moment ("backs off toward the shotgun on the wall", "keeps wiping the same glass"). A beat is
   direction, not prose, and never a state change: anything that moves a person, an item, money or a wound is an outcome.
2. **The host marks attention.** After settlement the host gives each present, seen person a `focus` tier from the
   settled turn alone: `focus` (their state changed this turn, the investigator's settled action landed on them, or
   they meet the investigator for the first time and act), `engaged` (they respond or carry a beat), `background`
   (present, no response, no beat). It also marks `first_meeting` and `changed` (what changed: disposition, mood,
   condition, trust/fear/pressure).
3. **The author sees the person's public bearing.** Beside each presence entry: public disposition toward the
   investigators, mood text, condition, and the visible part of trust/fear/pressure (§258 P1). Concealed parts never
   reach the author; they surface only through a beat the Keeper writes or a settled Psychology result.
4. **A new core grant `bearing`.** For a supplied person, the author may invent expression, gaze, posture, gesture, voice
   quality, pace, pauses, the handling of things they already hold or that are fixed at hand, and one recurring habit,
   expressing their supplied state and beat. It changes no state, moves no one between places, hands nothing over,
   adds no speech beyond the selected response, and reveals nothing concealed.
5. **A new package, NPC Portrayal (写实人物).** Author-only, default on, slot `bearing`, on the new settled fact
   `people`, granting `bearing`. Its text teaches the craft distilled from the research: detail by attention tier, a
   first-meeting portrait then only change, emotion shown not named, beats short and placed at turns of the exchange,
   pauses measured in time, signal families for each disposition and for fear, pressure, concealment and power, one
   habit per person used sparingly, and what not to describe. It ships a short Keeper resident section on writing beats.
6. **The author instruction is amended** to say a beat or the `bearing` grant may supply physical behavior, and to drop
   "supplies no physical action".

## User Stories

1. As a player, I want the person I am talking to written so that I can see them, so that the scene appears in front of me.
2. As a player, I want people who do not matter this moment given one line, so that the prose does not drag.
3. As a player, I want a person whose attitude just changed to show it in their body, so that I notice the turn in the conversation.
4. As a player, I want emotions shown rather than named, so that I read people the way my investigator does.
5. As a player, I want a liar or a frightened person who hides it to give nothing away unless my investigator saw through them, so that Psychology matters.
6. As a player, I want a person's habit to come back now and then, so that I recognise them.
7. As a player, I want a person's invented behavior never to move them, hand me anything or decide anything, so that the rules still decide what happens.
8. As a player, I want a person met for the first time drawn once and then only their changes, so that I am not told the same thing twice.
9. As the Keeper, I want to say in a few words what a person does, so that I spend my attention on decisions, not prose.
10. As the Keeper, I want consequential acts kept in outcomes and beats kept to behavior, so that a beat never becomes an action the kernel did not settle.
11. As the author, I want each present person marked by attention, first meeting and what changed, so that I know where to spend detail.
12. As the author, I want a bounded permission to invent behavior, so that I can write a picture without inventing facts.
13. As the owner, I want portrayal craft in a package, so that changing how people are written means changing a package.
14. As the owner, I want each turn's tiers and the portrayal section recorded, so that a turn with flat people can be explained.
15. As a package author, I want the `people` fact and the `bearing` grant in the closed lists, so that I can ship portrayal craft without host code.
16. As a maintainer, I want the bearing projection to read today's relationship fields and §258 P1's attitude when it lands, so that this does not wait on P1.

## Implementation Decisions

- **Beat.** `beat?: string` (1–120 characters, trimmed, one clause) on every `Interaction` branch. The schema
  description and the package's Keeper section say: what this person visibly does this moment; never a movement
  between places, a handover, an attack, a purchase or anything with a cost (those are outcomes or tools); never words
  they say (content does that). The host does not judge beat meaning; the author instruction binds it (a beat is
  rendered as behavior and never as a state change). A beat on `silent` makes the response nonverbal *behavior*.
- **Attention tiers.** A pure host function over the settled turn: hydrated responses (`actor`, `to`, `beat`), outcomes
  (`npc` changes, attitude changes from the relationship command, checks whose target is a person), §255 kept looks
  and §168.5 shown marks (first meeting), and scene presence. Precedence focus > engaged > background. At most two
  people are `focus` per turn: when more qualify, those addressed to the investigator and those whose disposition
  changed win; the rest are `engaged`. Tiers are hints for craft, never authority over facts.
- **Bearing projection.** `decision_context.scene.presence.people[].bearing = {tier, first_meeting?, changed?: string[],
  toward_party?: Disposition, mood?: string, condition?: string, felt?: {trust?, fear?, pressure?}}`. Until §258 P1 lands,
  `toward_party` maps today's directed affinity (`hostile→hostile`, `guarded→unfriendly`, `neutral→neutral`,
  `friendly→friendly`; a closed enum map, not semantics). `felt` carries only values the §258 state does not mark
  hidden; with P1 absent it is omitted. The investigator-facing `public` disposition is used when it differs from the
  true one. The beat stays on the response.
- **Concealment.** The core instruction says: a person's concealed state (a lie, hidden fear, a hidden motive) shows in
  their body only when the response's beat shows it or a settled check (Psychology) in this input revealed it. §257.17's
  `tell` and §258's disclosure `mode: lie` stay Keeper-side.
- **Grant `bearing`** joins `AUTHOR_GRANT_LIMITS`. Text in §260.4. It does not cover a person with no presence entry, and
  a kept look still binds (bearing adds behavior, never contradicts appearance).
- **Settled fact `people`** joins §254.2: a present person the investigator sees is in `presence.people` after
  settlement. Not held on a turn spent alone or with only unseen people.
- **Package.** `mods/npc-portrayal/` (id `npc-portrayal`, version 1.0.0, default enabled, requires
  `instructions.sections.v1`, `instructions.sections.author.v1`, `context.npc.v1`, `npc.mood.v1`, and the new
  `npc.bearing.v1`). `sections.json` schema 1: one resident section "Beats" (Keeper), one author section "People in
  motion" (`slot: bearing`, `on: ["people"]`, `grants: ["bearing"]`). Text in English; examples original; no novel text.
  Target ≤ 6 KB author text, ≤ 600 bytes Keeper text.
- **Coexistence with narration-craft.** Its "People on the page" (slot `people`) keeps first meeting, names, book-given
  looks in full and speech coherence; NPC Portrayal (slot `bearing`) owns behavior and detail by attention. Its
  sentence "without forcing a gesture" stays (compatible). narration-craft gets a patch release that points behavior to
  the bearing slot only if live review shows the two sections pulling apart; not in the first slice.
- **Author instruction.** "A response with mode nonverbal indicates silence only. It supplies no physical action."
  becomes: a nonverbal response is silence; its `beat`, if any, is what the person does. "Choose wording and small
  expressive gestures, not additional plot facts." becomes: choose wording and behavior within the granted bearing,
  never additional plot facts. Edited in place.
- **Telemetry.** `lane: "author-craft"` gains `bearing: [{ref, tier, first_meeting?, changed?, beat?: true}]`.
- **Habit continuity (later slice).** §255's ledger gains `manner` for people: a recurring habit the prose showed (not a
  one-off act), same write-once rule and locator; the author receives it as `presence.people[].manner`. Separate ticket,
  after live review shows invented habits drift.

## Testing Decisions

- External behavior at the highest seams: the packet schema accepts and the author input carries `beat`; the tier
  function as a pure function over settled-turn-shaped input; the author system prompt for a settled turn carries the
  bearing section, the grant text and the projection; a turn with no seen person carries none of it.
- Concealment: a response whose state marks fear hidden reaches the author with no `felt.fear`; with a settled
  Psychology success in the input, the instruction's reveal clause applies (assert the prompt and input, never prose).
- Tier precedence and the two-focus cap are deterministic; first meeting reads kept looks and shown marks.
- Package: install, sections parse, budget, version and system-language guards (`tests/extension/system-language.test.mjs`).
- Prior art: `tests/extension/author-craft-sections.test.mjs`, `tests/extension/kept-looks-host.test.mjs`,
  `tests/extension/turn-packet-prototype.test.mjs`.
- Live: owner's Mac, MiniMax 3.1 for every lane (never Opus), real driver, one natural input per turn, same retained
  seed before and after (Blood Road, Esso station: Russ and Nate give a talker, a bystander and a hostile turn). Blind
  read A (package off) vs B (on): can the reader picture the focus person, does background stay short, any invented
  state change or leaked concealment. Ties and losses are reported as such.

## Out of Scope

- §258 P1 itself (attitude storage, hidden marks); this spec reads it when present.
- The Keeper's `author_craft.requests` (§254 out of scope still).
- Per-NPC voice masks or a second writing lane; speech wording stays narration-craft and zh-optimize.
- Changing narration-craft or zh-optimize bytes in the first slice.
- Any check that judges prose by code (no regex or word lists on output).

## Further Notes

- Risk: a beat smuggling an outcome ("hands over the key"). Mitigated by schema description, the Keeper section, the
  author instruction and live review; the host cannot judge meaning. If live play shows it, the remedy is a typed
  beat, not a word list.
- Risk: more craft text slows the author's first token. The section is capped; telemetry records bytes per turn.
- Risk: everyone becomes a picture. The tier cap (two focus) and the craft's "background is one line" are the guard.

## Appendix A: draft author section "People in motion" (English, package text)

> How people move on the page. Spend detail where the moment's attention is, not by how important a person is.
>
> Each present person carries a bearing: their tier this turn, whether this is a first meeting, what changed, how they
> stand toward the investigators, their mood and condition, and sometimes what they visibly feel. A response may carry a
> beat, the Keeper's few words of what they do. Turn the beat into something seen: which hand, what it holds, where the
> eyes go, how long before they answer.
>
> Background people get one clause: what the investigator would call them and the one thing they are doing. No face, no
> inner life. If the moment gives them a reaction, give it as one picture of what they do with the space or the thing
> in reach (the barman steps back until the shelf is at his shoulders), never an adjective.
>
> Engaged people get a short action before a line now and then: every second or third line at most, a few words, at the
> point where the exchange turns or something important is said. Most lines need only who said them. A long exchange can
> run on words alone.
>
> The focus person is the one the moment is about. Write them as a sequence the eye can follow: posture, then hands,
> then face or eyes, then voice or the length of a pause, three to six beats, ending on the line or the silence.
>
> First meeting: one compact portrait (a few visible traits, the last a manner the investigator reads from them) and,
> if it fits, one object or habit that can return. After that, never repeat the portrait; give what changed, or let the
> habit return once in a while, not every turn.
>
> Show feeling, do not name it. Body and timing carry it: a pause counted in seconds, an action stopped halfway, a voice
> that climbs, a hand that finds something to hold. When the investigator reads a feeling, it is their reading
> ("seems", "as if") and may be wrong; the person never explains themself in narration. Name a feeling at most once in a
> scene, softened.
>
> Signal families, chosen for this person and moment, never as a list to recite:
> - distance under courtesy: the forms kept, the warmth taken out; a nod with neither anger nor a smile;
> - unfriendly toward hostile: shorter sentences, formal address, eyes on their task, a hand near something; open
>   hostility turns the body outward (blocking the way, a gesture to someone else), not shouting;
> - friendly toward ally: they lean in, offer more than asked, make room, hand over what is theirs to give;
> - fear rising: fewer words first, then small signs (a swallow, a hand pressed somewhere), then a choice to avoid
>   (looking away, changing the subject, putting something between); trembling and sweat only at the top;
> - pressure: half-finished movements, repeated words, fiddling with the same object;
> - power: the strong move little and slowly; let others' reactions show it.
>
> A concealed feeling or a lie shows only where the beat shows it or a settled check saw through it; otherwise the
> person's surface is what they choose to show.
>
> Objects appear when someone uses them. Do not stack adjectives, do not reach for stock eye-phrases, do not give every
> line a gesture, do not narrate a background person's thoughts.

## Appendix B: draft Keeper section "Beats" (English, package text)

> When a person does something worth seeing, give their response a beat: a few plain words of what they visibly do
> ("keeps wiping the same glass", "stops halfway reaching for the drawer"). The author turns it into prose. A beat is
> behavior, never words they say, never a move between places, a handover, an attack, a cost or anything the kernel must
> settle. If a concealed feeling should show, say so in the beat; otherwise the author shows only the surface.
