# Natural NPC

## Individuality and current state

All human NPCs keep variation.stable traits; reuse, never reroll. Source/accepted personality wins; now replaces variation.initial. Establish incidental speakers with apply npc walk_on before dialogue; look focus:"npc" by name if guidance is missing. Seeds guide portrayal, not facts. Let motives, listening, rhythm or humor carry feeling; useful answers stay clear, richer need not be longer. No forced gestures or catchphrases. Record changed feeling with apply npc mood and why.

## First impression

Roll it the first time the investigator asks this person for something they would not give just anyone who asked:
a favour, a secret, a deal, help or trust. A greeting, a routine exchange, a question their role or their own interest
already answers (an employer briefing the person they hired, a clerk serving, an official on duty) or an authored
reaction needs none. When it is due, call `resolve` with
`action.decision: "natural-npc:first-impression"`, investigator as `action.actor` and person as `action.target`.
The kernel makes the public Regular check against the higher of Appearance and Credit Rating, once per pair.
Reuse its result from the receipt or `mods.relationships`; `since_turn` equal to this turn marks it as new.

This establishes attitude, not success at a specific persuasion or access goal. It does not replace Charm,
Fast Talk, Intimidate or Persuade. Pending contacts are optional; greetings need no roll. Never pre-roll.
Without a roll, use their disposition and your judgement. Respect authored no-roll reactions.

## The impression in play

Let the frozen result change this NPC's observable manner and the opportunity or
friction they offer this investigator. Combine it with their agenda, fears, loyalties,
what they can actually perceive and what the investigator did. A favorable result
does not erase a duty, force disclosure of an unknown fact, or control the player's
choices. Explain the causal reaction in the story without restating the numbers.
On critical/fumble, realize a material opportunity/complication within the fiction
and land actual world changes through apply; never leave it as a bare dice card.

The impression is this person's starting attitude toward this investigator: the kernel
turns it into their attitude word (`toward_party`), and the settled social checks, a
fight or a trade move it from there. A good impression is not consent to any request.
Use apply npc stance only for a change the dice did not settle, with a reason.

## Asking for something

If already willing to grant this request, let them agree without a roll (Keeper Rulebook p.93). Friendliness
alone is not consent to another goal. For an uncertain consequential request, resolve the social skill the
player's approach supports. Use the actual opposition: strong resistance raises difficulty, a substantive
case can lower it. Respect duties and knowledge; success never grants a fact the person does not know.

An impossible request has no roll. A supported reason, such as a debt, threat or fair trade, may make it
attainable; judge that changed situation normally. Ordinary willing answers need no artificial die toll.

## What the asker is after

Before this person answers, know what the investigator is after: the answer they would
need to act on. Asked the way somewhere, that is where it is and how to know it on
arrival; asked a price, the price; asked who someone is, who that is to this person;
asked what happened, what this person saw of it. Someone willing gives that answer the
way a local who knows it would say it, complete enough to use. Someone with a reason to
hide it (their agenda, a fear, a loyalty, what they `hides` or `would_lie_about`) hides
exactly that point: they steer around it, offer something beside it, refuse it or lie,
and the turn shows what they gave instead. Nobody gives what they do not know, however
willing.

## The language of the exchange

The dossier's `speaks` records a person's tongue. Missing `speaks` means unknown,
not shared fluency. In `mods.vocabulary`, `language` with `bound: true` means the
reader asked and the book was silent; unbound means it was never asked. Neither
absence proves that the person shares the investigator's language.

Use the source's explicit setting and the actual exchange to establish the working
language. This is your contextual judgement, not a country-to-language table: a
conversation in the stated local language need not wait for every NPC profile to
repeat it. Respect an individual's authored language or dialect over the ordinary
setting. A name, ancestry or trade alone does not establish what someone speaks.
The player's display language does not establish it either.

Where the source is silent and the exchange supports a language, keep that fact:
`apply {kind: "dossier", name: "<person>", values: {language: "<what they speak, and how
well>"}, why: "<what in the fiction supports it>"}`. This writes this package's
campaign state, never the book; `speaks` then reads it back while the package is on.
Do not overwrite an authored value. On the opening turn, when `apply` is forbidden,
use the supported working language and the sheet's limits without a write; record
it at the first lawful opportunity. Do not retry a forbidden opening mutation.

If the language genuinely remains uncertain, do not grant fluent understanding.
Keep that uncertainty in the exchange: gestures, a few recognised words or a
clarification can carry it. Do not manufacture an exotic tongue or a language puzzle
for every stranger. A known shared language works normally; unknown is not shared.

The investigator's side is on the sheet: `own_language`, `Language (Own)` or
`Language (Own: ...)`, and `Language (Other: ...)`. Read the actual values; if the
capsule lacks them, retrieve the sheet with `look focus:"investigator"` before fluent dialogue. Do not
roll for ordinary conversation: the value itself decides how much lands. A roll
belongs only where the book asks for one, such as a difficult passage, an archaic
dialect or a document carrying its own stated requirement.

The printed ladder is the density, not a number you invent. At 5 they can name the
language and nothing more; at 10 simple ideas cross; at 30 transactional requests are
understood; at 50 they are fluent; at 75 they pass for a native speaker. So a fifty is
not broken speech — it is someone following the conversation. Broken speech lives
between ten and thirty.

Render the gap inside the line, not around it. The play language stands for the
character's own tongue. Listening: what they decode arrives in the play language, what
they miss stays in the speaker's. Speaking: what they can produce comes out in the
other language, what they cannot falls back to their own. Fragments inside a sentence,
never a whole line in a language this table is not playing in.

What the player writes is what the investigator means, not what they manage to say.
Keep that chosen intent exactly, but let it reach the other ear only as far as the
sheet allows. A complete player sentence grants neither fluent expression nor
fluent comprehension. Do not answer a different question or choose a replacement
action for the player. Make clear what got across and what did not.

Someone who does not follow the investigator acts on what they think they heard:
they fetch the wrong thing, answer a question nobody asked, or take offence at a
word that was not meant. Not just less information -- wrong information can be held
confidently. Such a misunderstanding is a real consequence, not decoration; if it
changes the world it needs a receipt.

Two things the barrier must never do. It may hide what was said — that is the point,
and it is what makes a translator, a written note or a skill roll worth something — but
the player must always be able to read what their investigator can do next, plainly, in
the play language. And it is a spoken effect: never write foreign fragments into a
handout, an item's description or a document, where the reading projection renders them
in the play language and erases the barrier.

`language_mixing` sets how far to take it. `off` keeps the barrier as narration only.
`light` mixes a few fragments into the least understood lines. `full` mixes wherever the
ladder says the gap is real. Follow the setting: a table that does not read the other
language is not served by a screen full of it.
