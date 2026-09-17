# NPC Voice

## 1.1.2
- Adopts the §101 runtime-file allowlist; the engineering changelog is no longer frozen into campaign homes.

## 1.1.1
- A mask is not a stamp (chat bench table 2, 2026-09-16: the docker said 「老子喝完就走，伙计」 three times and growled from across the room every turn; the constable stacked all three of his habits in every line). The address term or the ending habit, not both in every sentence; no line said twice at a table; a bystander speaks only with something new. Distinguishability was already 41/41 on the lineup; this is for the other half of the ask, sounding like a person.

## 1.1.0
- Masks, not sample lines (user ruling 2026-09-16: the spotlight is the player's, NPCs need no personality, they need to be told apart and to sound like people). The two-line `sample_lines` word is replaced by `voice_mask` (one line: address terms, a sentence-ending habit, the level of the words, one pet phrase) and `exchanges` (three "stranger → reply" lines). The capsule seats them in a new `voices` section instead of `present[]`. The instruction stops asking that every line wants something — that rule produced aphorisms — and asks for three things: wear the mask on every line, talk like a person (acknowledge, say the mundane thing, drift and return, no aphorisms), serve the player (react to what was just said, leave something to say back). Research and acceptance in docs/specs/npc-voice-mask.md.

## 1.0.1
- Whole spoken sentences, not fragments (2026-09-15 user report on both models: choppy, odd breaks, not colloquial). 1.0.0 told the Keeper "half sentences, leave the end off" and the Keeper obeyed as a style; talk is connected sentences with connectives, end-particles and address terms, long and short alternating, a fragment one beat at most. Adds: every line wants something and may answer a different question; a person hiding something talks more, not less; one recurring habit per person instead of adjectives. Craft sources in docs/specs/npc-speech.md.

## 1.0.0

Contract §40.5. A survey of the two predecessor products found the same thing twice: a
style note ("speaks calmly") does nothing for a Keeper, and a line does. The authored
`voice` field is the best case and most imported books have nothing in it, so for most
people at most tables there was never anything to perform from.

This package adds the dossier word `sample_lines`, read at the table as `sounds like`:
at most two short lines, one at ease and one under strain, in the campaign's play
language. A book that prints someone's speech answers the reader's `ask` and keeps its
own lines; for everyone the book left silent, a background lane (`extensions/npc-voice`,
the §17.10 shape) writes them once per person and never again. The value lands in this
package's own state (§28.7), so the book is never written to, the word dies with the
package, and it is campaign-scoped.

The two things the instructions exist to say. **`sounds like` is the register, never a
line to read out** — the predecessors told the GM to follow the voice card strictly, and
strictly followed, two lines become the only two lines the person ever says. And **a line
is spoken by that mouth**: the words of that person's trade, class, schooling, era and
place, said aloud rather than written, with the oath or the euphemism that mouth would
actually produce. Two people at the table who sound alike is the Keeper's fault.

`coarse_language` (default on) moves the vocabulary, not the temper: off, a coarse person
reaches for the strongest thing they will say in company and is still a coarse person.

No table anywhere in this package maps a trade, a class or a place to a way of speaking,
and nothing detects a language. The judgement is the lane's for `sample_lines` and the
Keeper's at the table; validation is shape only.

### Pending: `shape: "lines"` on the contributed key

§40.5 gives `sample_lines` a `shape: "lines"` slot — its value is a list of two bounded
strings rather than one line. `validateVocabulary` in `kernel-ts/read/mods.ts` requires a
contributed profile key to carry exactly `ask`, `key` and `label`, and refuses any other
field; the refusal is thrown out of `readModCatalog`, so a shipped manifest carrying
`shape` today does not merely disable this package, it fails the whole builtin catalog and
a kernel process cannot answer at all. The slot is therefore declared in the same change
that teaches the kernel about it. `tests/extension/npc-voice-package.test.mjs` pins the
pair together, so neither half can land alone.
