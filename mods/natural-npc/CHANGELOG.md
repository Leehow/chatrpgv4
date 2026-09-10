# Natural NPC

## 1.1.2

A word is bound when a module is built, not when this package is enabled, so this package
can be on and `speaks` absent from every actor in the book. That absence looked exactly
like a book that says nothing about anyone's tongue, and reading it as one would have the
Keeper decide the whole table shares a language on the strength of a question nobody
asked. The turn's mods section now carries `vocabulary`, saying whether `language` was
bound here, and the instructions read it before taking silence for an answer.

Nothing about play changes on a module that was built with the word.

## 1.1.1

- Adds `brief.md`, the per-turn form of the instructions (contract §30.7): the first turn a process opens for a campaign still carries the full text, later turns carry this reminder. Behaviour is unchanged; the capsule is smaller.

## 1.1.0

Requires `graph.vocabulary.v1`. Adds the actor dossier key `language`, which reaches the
Keeper as `speaks`: what the book says about a person's tongue, asked of the reader by
name and absent when the book is silent.

A shared language is no longer assumed. Where the book gives a person a tongue the
investigator does not fully hold, the Keeper renders the gap inside the line — the play
language for what the character's own tongue carries, the other language for what falls
outside it — with the density taken from the rulebook's printed ladder for Language
(Other), not from an invented number. Ordinary conversation is not rolled: the sheet
value decides. Rolls stay where the book asks for one.

The direction that matters is both ways. A person who does not follow the investigator
acts on what they think they heard, and that misunderstanding lands as a consequence
like any other.

The barrier may hide what was said. It may never hide what the investigator can do next,
and it never reaches a handout, an item description or a document, where the reading
projection would render it in the play language and erase it.

`language_mixing` (`off` / `light` / `full`, default `light`) sets how far to take it.

First impressions are unchanged: the same public max(APP, Credit Rating) roll, the same
pair reuse, the same result tiers, the same legacy receipts. A campaign locked to 1.0.0
keeps that package and upgrades explicitly. A module built before this version was
enabled carries no `speaks`, and nothing about it changes.

## 1.0.0

A lasting first impression on first meaningful contact, from the higher of Appearance and
Credit Rating, rolled once per investigator/NPC pair and realized by the Keeper in
character.
