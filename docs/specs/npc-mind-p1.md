# NPC mind, P1: directed attitude and what people overheard

Status: ready-for-agent (owner 2026-10-23: "继续做" after P0 merged into 0.9.8a at 27602c8e3)

Contract: `docs/kernel-rpc.md` §258.7–§258.8. Design: `docs/research/npc-schema-v3-20261023.md` (§3-E attitude, §3-C believe event).
P0: `docs/specs/npc-mind.md`.

## Problem Statement

Two gaps remain after P0. People have no usable attitude: the Keeper's `relationship` command takes four words
(`hostile|guarded|neutral|friendly`) with nothing about trust, fear or pressure, nothing about a person being charmed,
coerced or possessed, and the author receives the same word the Keeper wrote, so a person who hides contempt behind
politeness cannot be portrayed. A separate legacy stance score (social rolls, `npc-ledger.json`) moves toward the party
and is shown to nobody in the decision path.

And people do not know what was said in front of them. P0 records who heard each attested line (`heard`), but no catalog
uses it: Nate, standing beside Russ, cannot later say "Russ told you the diner is west" unless the memory lane happened
to extract it, and when it did, P0 correctly stopped treating it as Nate's own promise but gave him nothing in its place.

## Solution

1. **Directed attitude.** The `relationship` command becomes `{kind:"relationship", actor, toward, disposition,
   trust?, fear?, pressure?, public?, hidden?, control?}`: `disposition` is `hostile|unfriendly|neutral|friendly|ally`
   (the old `affinity` words are still read: `guarded` is `unfriendly`), the three numbers are 0–5, `public` is the
   disposition the person shows (default: the same), `hidden` lists what they conceal (`disposition`, `mood`), and
   `control` is `none|charmed|coerced|possessed|drugged|enthralled` by `toward`. The Keeper sees one parsed `attitude`
   row per target; the author sees only `public` toward each person: no number, no control and no mark that something is
   hidden, so a change to concealed state alone leaves the author input unchanged (agreed with §260, NPC portrayal).
2. **What people overheard.** For each present person, the kernel lists the attested lines others said in their
   presence (`heard`, newest first, at most 6: speaker, gist, turn). The catalog issues them to that person as
   `heard` facts. A `heard` fact may be said only with attribution: the author's claim carries
   `authority: "What <speaker> said in their hearing; attribute it, it is not their own knowledge or promise."`

## User Stories

1. As a player, I want a shopkeeper who dislikes me but is polite to look polite, so that I have to read them.
2. As a player, I want someone frightened or coerced to behave like it, so that pressure and leverage matter.
3. As the Keeper model, I want one line per person per target with disposition and optional trust/fear/pressure, so that I judge social moves.
4. As the Keeper model, I want to mark a person as charmed or possessed apart from how they feel, so that control is not mistaken for friendship.
5. As the author, I want only what the person shows, so that I never leak a hidden attitude or mood.
6. As a player, I want a bystander to be able to repeat what someone else told me, attributed, so that witnesses are useful.
7. As a player, I want a bystander never to present what they overheard as their own knowledge or promise.
8. As a maintainer, I want attitude and overheard lines rebuilt from turn records and canonical events only.

## Implementation Decisions

- Attitude rows are the existing canonical event relationships (`directed_relationship` statements); the statement
  JSON gains the new fields. Newest per target wins. Old statements with `affinity` are read as disposition.
- `control` is directed toward the controller; `none` clears it.
- The KP projection is `attitude: [{toward, disposition, trust?, fear?, pressure?, public?, hidden?, control?, since_turn}]`
  on the person (≤6); the legacy party stance stays where the read already shows it (`ledger.stance`).
- The author projection (`decisionPerson.relationships`) is `{toward, public}`, where `public` is the shown value (public,
  else disposition, else neutral when the disposition is hidden). A hidden mood drops the person's `now`. §260 reads
  `public` for its `bearing.toward[].disposition`; anything new about people for the author goes under §260's `bearing`.
- `heard` comes from turn-record `communication` events whose `heard` includes this person and whose status is
  `attested`; `selected` items' `gist` and the speaker's ref. Same worldline and loop, before the current turn.
- Heard facts carry `content_id` of the original item so a repeat by the bystander is told-marked like any other.

## Testing Decisions

- Through public seams: packet → compile → event statement → look → decisionCharacter / decisionPerson / catalog.
- Prior art: `tests/extension/npc-communication.test.mjs`, `decision-only-v4.test.mjs`.
- Live: owner's Mac, MiniMax on every lane, Blood Road at the Esso station: Russ tells the player something with Nate
  present; next turn the player asks Nate about it; Nate attributes it to Russ. A hostile-but-polite attitude is
  rendered politely.

## Out of Scope (P2)

- Disclosure rules and GateExpr (today's clue checks and §257.17 testimony stance cover gated and lying testimony).
- Proposal/Commitment/Agreement ledger; D4 (a refer the author did not voice, or a contradicting restatement).
- Reader changes, schedules, triggers, phases, cohorts, per-audience author projection.

## Further Notes

- Social difficulty already exists (`kernel-ts/resolve/social.ts`, npc defense and motive); P1 does not change it.
