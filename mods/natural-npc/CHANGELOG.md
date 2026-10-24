## 1.7.3

"First impression" says when the roll is due (the first time the investigator asks this person for something they would not give just anyone) instead of asking the Keeper to decide whether it matters. A MiniMax Keeper deliberated that question at length for every new speaker and reversed its own decision within one turn (2026-10-24, contract §263.4). 1.7.2 was a local test draft of the same rule, never released.

## 1.7.1

Keep incidental speakers on the existing person-establishment path before dialogue. Portrayal dice remain private initialization, separate from NPC actions, played relationships and story facts; resident guidance stays compact.

# Natural NPC

## 1.7.0
- Adds five twelve-row random tables for every human NPC, including people improvised at the table. Temperament, values and speech habits are stable seeds; emotion and social manner are initial state. The kernel initializes them once, preserves them in campaign state and projects them to the Keeper and personality author.
- Adds resident guidance for expressing individuality through motives, listening and speech without forcing longer answers or constant emotional gestures. Authored and accepted personality take precedence; current recorded mood replaces initial emotion and may change through the existing NPC mood effect. Package state_version stays 1; existing package locks remain immutable until an explicit upgrade.

## 1.6.4
- Removes the obsolete language-script rejection claim while preserving foreign-speech guidance. Guidance only; state_version stays 1, no state migration is needed, and existing package locks remain immutable.

## 1.6.3
- Separates optional first impressions from uncertain consequential requests. A willing person's ordinary assistance and obvious information need no roll; actual influence or contested access uses the existing social resolver. Keeper judgement, public max(APP, Credit Rating), once-per-pair reuse and frozen results remain unchanged. This is guidance only; state_version stays 1 and no state migration is needed. Existing package locks remain immutable.

## 1.6.2
- Shortens the first-impression instructions to keep default package guidance within the existing 65,536-byte budget. Keeper judgement, public Regular max(APP, Credit Rating), once-per-pair reuse, optional contacts, greeting and authored no-roll behavior are unchanged. The new version preserves frozen 1.6.1 packages; no state migration is needed.

## 1.6.1
- The same Keeper decides when a first impression matters and calls the existing resolver. The retired host/Jev contact route is no longer its execution owner. Pending contacts remain optional; the kernel still owns the public dice, higher characteristic and once-per-pair result. No state migration or new agent is introduced.

## 1.6.0
- The first impression is rolled only when it matters (contract §224.3, user ruling 2026-10-10, per the Keeper Rulebook: Credit Rating gauges first impressions, p.60; a roll needs tension and something at stake, pp.82-83). The kernel no longer rolls it the moment people share a scene: the host offers it as a check option and Jev selects it when the investigator seeks something from the person, approaches them socially, must get past them, or the person is hostile or suspicious. Otherwise no roll is made and the person is played from their own disposition.
- Only the "First impression" section of `agent.md` and the manifest description change. The trigger stays `presence`, the requirements, settings and `sections.json` are unchanged.

## 1.5.0
- The first impression is rolled by the kernel the moment a person first shares a scene with an investigator (contract §178): the check's trigger is `presence`, and the package requires `checks.presence.v1`. On two Blood Road tables of 2026-10-04 the Keeper called `resolve` for it zero times, and the single loop's clerk asked whether the player had declared it, which a player never does; of the App's 17 tables of 10-02..10-04 with three or more turns, 3 rolled any. Nothing about a meeting needs judging: the higher of Appearance and Credit Rating is rolled when the ledger puts the people together.
- Only the "First impression" section of `agent.md` is new text: the kernel rolls, the Keeper never resolves it, and where the result arrives. Its `sections.json` entry (§183.1) and every other section keep their bytes from 1.4.6, the intent reading of 1.4.5 included. A campaign locked to 1.4.6 or earlier keeps the Keeper-called `contact` check until it is upgraded.

## 1.4.6
- Declares the sections of `agent.md` (`sections.json`, `instructions.sections.v1`, contract §183): which ride every turn and which a turn loads by its topics, the table's state or the Keeper's calls, for a table whose instructions exceed the instruction budget. Under the budget, as every table is today, the whole text goes as before.
- `brief.md` is gone. A 2026-10-04 probe of real provider requests found the Keeper received the full `agent.md` every turn; the brief existed only in the capsule (§183, evidence).
- `agent.md` gains two headings, "First impression" over the opening paragraphs and "The impression in play" before "Let the frozen result change"; no sentence changes.

## 1.4.5
- What the asker is after (contract §179.1): before a person answers, the Keeper knows the answer the investigator would need to act on. Someone willing gives it complete enough to use; someone with a reason to hide it hides exactly that point. App table `game-8e41c325` (Blood Road, 2026-10-04), turn 3: asked where to eat and sleep, two willing men gave a place's name and 「往前开一点」, though the Keeper held the book's description of the place and had set one of them as eager to talk about the road. Owner, same day: any question is read for the answer the player wants, so a willing person gives it clearly and a person who wants to hide something hides exactly that; this belongs to this package, not to the prose package.
- The brief gains "Give or hide the answer." (25 bytes; the shared ceiling is under 5000 bytes, 26 were left). The language paragraph and every other sentence keep their bytes.

## 1.4.4
- Restores the language paragraph of the brief word for word from 1.4.2. The 1.4.3 compression reworded the language-barrier rules (it dropped "bound or not", "never rewrite the book", "Read the sheet with `look` if needed: Language values limit both directions", "keep the intent", "never in documents"), which were not this change's to shorten; `tests/kernel/test_language_barrier.py` caught one of them. The asking rule is one shorter sentence; the full rule stays in `agent.md`.

## 1.4.3
- Asking for something: a request this person might grant is uncertain and rolled, with an opposing motive as strong as the ask cuts against them; a request nobody in their position would grant without a reason (goods, labour or a secret for nothing) is not uncertain, gets no roll, and is refused outright in their register. A reason the fiction supports puts it back in the range the dice decide. The brief is compressed to keep all active briefs within 5000 bytes.

## 1.4.2

An absent NPC language is unknown, not permission for fluent conversation. The
Keeper establishes a working language from the explicit setting and exchange,
respects authored exceptions, and records supported table facts through the existing
dossier effect when lawful. Opening-turn write restrictions still apply, without
removing the investigator's comprehension limits. No locale table or new lane.

Player words express intent, not guaranteed fluency. The full instructions and
per-turn reminder apply the sheet's Language value to both speaking and listening;
the audit no longer exempts an exchange merely because `speaks` is missing. It joins
the shared delivery audit on later turns too, not only on first-impression rolls.
`language_mixing` changes presentation only. Ordinary conversation still has no roll.
Existing campaign locks remain unchanged until an explicit package upgrade.

## 1.4.1

Adopts the §101 runtime-file allowlist. Only the manifest and referenced Keeper/auditor instructions
enter campaign homes; engineering history remains in the source tree.

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
