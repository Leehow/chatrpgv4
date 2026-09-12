# Natural NPC

## 1.4.0

1.3.0 told the Keeper to stage the person first, which on the opening turn is advice it
cannot take: nothing may change state before the player has spoken, so `apply` is refused.
A live table read that line, tried it, was refused, and then found its first-impression
target did not resolve either -- the opening scene was empty. The kernel now seats the start
scene's own cast first, so the book's people are there to be rolled for; this says what to
do about anyone who is not.

It says it in the full instructions only. The per-turn reminders share a 4 KB budget and had
three bytes left, and the brief is the wrong place for it: the opening turn is the one turn
that reads the full text anyway, and on any later turn the kernel's own refusal now names the
person, lists who is present, and gives the `apply` that stages them.

## 1.3.0

The instructions now say the person has to be in the room. An impression is made of a
meeting, so the kernel has always refused one for anybody not present in the active scene,
but nothing here said so. On a book the module graph already staged, walking in is enough
and the omission never showed. On an imported book the people arrive when the Keeper puts
them there -- in the very turn the party meets them -- so first contact hit that refusal
every time.

The refusal itself carried no `fix` and no `details`, so three impressions for three people
in one message read as one wall hit three times and shut `resolve` for the rest of the turn.
A live table opened Masks in Bar Cordano, met Larkin, Mendoza and Elias, and delivered a
turn with no mechanics at all: the Keeper staged all three correctly one call later and by
then could no longer roll.

## 1.2.0

Requires `graph.vocabulary.table.v1`. No shipped book names anyone's tongue -- The Haunting
gives its eleven people the five core words and nothing else -- so a feature that could only
read `speaks` off the source was a feature that never ran. Where the source is silent, the
Keeper can now establish a person's tongue at the table and keep it, and that record lives in
this package's own state: the book is not written to, and turning this package off takes the
word with it. A word the source does give still wins, and establishing over it is refused.

The Keeper is told to default to a shared language and to establish one only where the
fiction already settled it. Never from a name, a trade or a neighbourhood.

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
