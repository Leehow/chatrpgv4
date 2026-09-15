# NPC Voice

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
