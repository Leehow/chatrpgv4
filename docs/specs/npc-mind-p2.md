# NPC mind, P2: what the investigators said, and asides

Status: in progress (owner 2026-10-23: "派个worker修，你继续做" after P1 merged into 0.9.8a at 5f5336750)

Contract: `docs/kernel-rpc.md` §258.9. Design: `docs/research/npc-schema-v3-20261023.md` (§3-C receive, F4 audience).
P0: `docs/specs/npc-mind.md`. P1: `docs/specs/npc-mind-p1.md`.

## Problem Statement

After P1 people know what other people said in their hearing, but not what the investigators said. The investigator's
words exist only as the raw `player_text` of each turn; nothing ties them to who was addressed or who was present. So a
person asks again what the player already told them ("你们是来干什么的？"), and a bystander cannot know what the player said
to someone else. And every line is heard by everyone present: a person cannot say something to one investigator only.

## Solution

1. **What the investigators said.** Each publication records the player's words as an attested event of that
   investigator, addressed to the people who answered them and heard by the rest present. Each person's catalog gets
   `party_said` facts: what the investigator said to them or in their hearing, as the investigator's claim.
2. **Asides.** An interaction may be said as `channel: "aside"`: only its addressees receive it; nobody overhears it.

## User Stories

1. As a player, I want a person I told who I am not to ask me again, so that conversation moves on.
2. As a player, I want a bystander to know what I said in front of them, so that witnesses are consistent.
3. As a player, I want what I claim to stay my claim, so that a lie I tell is not world truth.
4. As the Keeper model, I want to whisper something to one investigator, so that a secret is not heard by the others present.
5. As a maintainer, I want all of it rebuilt from turn records.

## Implementation Decisions

- The event comes from `turn.player_text` at the narrate/ask commit (`communicationRecord`), only when there are selections.
- The speaker is the single investigator the selections answered, else `investigator_1` at a one-investigator table.
- `party_said` rows are separate from `heard`; `heardView` skips investigator events.
- `channel` passes from the interaction to the host selection and to the author response unchanged.

## Testing Decisions

- Through public seams: record → look view → catalog → hydrate; packet schema for `channel`.
- Live: owner's Mac, MiniMax, Blood Road: tell Russ who you are with Nate present; next turn ask Nate; then ask Russ
  something related: neither asks who you are again. An aside from Russ to the investigator is not repeated by Nate.

## Slice 2 (owner 2026-10-23 16:07Z: "你把剩下的全部做完吧，不要问我了")

3. **Telephone and letters** (§258.10): `channel: phone | letter` reach only `to`, from a speaker who need not be present.
4. **Offers and deals** (§258.11): an attested offer is a proposal; the Keeper's `agreement` command marks it accepted,
   declined or withdrawn, and an accepted deal (a commitment of the speaker) kept, broken or withdrawn. Both reach the
   Keeper as facts of kind `proposal` and `commitment`, rebuilt from turn records.

## Not built, and why

- **GateExpr and disclosure rules.** They need the module reader to write gates the books state, and today's clue checks
  and §257.17 testimony stance (lie, deflection, `needs <skill>`) already gate and shade testimony at the table. Building a
  second gate language before the reader can fill it would leave it empty.
- **Belief events.** `heard` (§258.8) and `party_said` (§258.9) already are the "X said P" beliefs, attributed; a separate
  belief store would duplicate them.
- **D4** (a refer the author did not voice; a restatement that contradicts the original). Attestation is per speaker, not per
  item, and judging contradiction needs meaning, which the host never claims (`semantic_verified` is always false).
- **Reader changes** (NPC definition reads, schedules, triggers, phases, cohorts) and **per-audience author projection** for
  several investigators: reader work with its own spec, and tables are one investigator today.
