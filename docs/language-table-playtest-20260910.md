# What a real table did with the language words (2026-09-10)

A fresh Haunting campaign, Grok 4.6 keeping, a human player, four turns through
`tests/play/driver.py`. Evidence under `.coc/playtests/door4-play/` and
`.coc/playtests/door4-setup*/`.

The question was not whether the mechanism works — the kernel suite already said it
does — but whether a Keeper reaches for it, and whether what it reaches for is the
thing that was built.

## What the table did well

The barrier played, and played correctly, without being asked for:

> 「一天。二十。」每个字都咬得很短。
> 「House。」他朝窗外扬了扬下巴。「一家人。夜里出事。跑了。男人还在医院。Roxbury。」

Fragments inside the line, never a whole foreign line. The other direction landed too
— the landlord catching two words out of a sentence and the rest going to noise — and
that is the half the instructions call the more interesting one. Where the tongue was
shared (North End neighbours, asked in Italian) no barrier appeared at all, and the
Macario name recurred all morning without ever being read as a language cue.

`mods.context` carried `vocabulary` with `bound: false`, correctly: the shipped starter
graph was built without the word.

## The finding: the word is on the wrong side

`apply {kind: "dossier"}` was never used, in four turns of exactly the scenario it was
opened for. That is not because the Keeper missed it. On turn 2 it went looking for
somewhere to keep the language fact and found `apply {kind: "ruling"}` instead:

> Nino Rizzo's English is dock-phrase transactional on the language ladder; ordinary
> talk is not rolled.

It recorded the **investigator's** competence, not the NPC's tongue — and that is the
fact that actually recurs. Which language an NPC speaks was re-derived from the fiction
every time and cost nothing to re-derive: a Boston landlord speaks English, the women
outside the church speak Italian. Recording that per person adds nothing. What does not
re-derive is how much of the local tongue *this investigator* holds, and that belongs on
the sheet.

Door 4 stays: an NPC who speaks only Portuguese is a real case and the book is silent
about plenty of people. But it does not cover the common one, and nothing should be
built on the assumption that it will.

Two frictions worth naming: `ruling.anchor.entities` refuses an investigator's name, so
the Keeper's first attempt to record this was rejected and it had to retry; and the
first-impression check fired against Appearance 50 with a roll of 90, so the whole
exchange ran on a failed impression, which the prose honoured.

## The gap that made the feature inert

The card had `own_language: Italian` and no English at all, though the player's opening
sentence was "家里说意大利语，英语只能应付几句码头行话". The density rule reads the sheet;
with nothing on the sheet the Keeper had to invent, which is why it wrote a ruling.

`prompts/setup.md` already said how to spell a foreign language. Nothing said that one
the player gives must be recorded, or where to put it. Both are now stated, and no
machine check backs them: detecting "the player mentioned a language" in free prose is
the open-ended semantic classification this repo does not hardcode. The acceptance is
this playtest, run three times:

| | `Language (Other: English)` | on the ladder |
| --- | --- | --- |
| before | absent | the feature cannot fire |
| after "record it" | 50, first in the occupation list | fluent — no barrier |
| after "place it by how much" | 21, last in the list | broken speech — fires |

Both lists are spent from the front, so position is the only dial the setup agent has,
and it had not been told that.
