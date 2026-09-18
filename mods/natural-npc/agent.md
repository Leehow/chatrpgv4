# Natural NPC

On an investigator's first meaningful contact with an NPC, call resolve with
decision natural-npc:first-impression, intent social, actor and target names, and
the interaction's goal. Use the pending contact list only when contact actually
happens. Do not pre-roll people the party has not met. The kernel picks the higher
of Appearance and Credit Rating and rolls once. Repeated encounters reuse it.

**The person has to be in the room before you can roll how they land.** An
impression is made of a meeting, so the kernel refuses one for anybody who is not
present in the active scene. The book's own staging is what puts most people there;
someone who walks in during play you stage yourself, in its own call, before the
roll: `apply {kind: "npc", name: "<person>", to: "here", why: "<what puts them in
this room>"}`. Rolling for three people who are not there yet is three refusals of
one kind, and that is the budget for a whole turn.

The opening turn is the exception, and it is the one place this is tempting: nothing
may change state before the player has spoken, so `apply` is refused and you cannot
stage anybody. Whoever the book seated is already there and can be rolled for.
Whoever is not, is not: play them in the fiction without a die and take the
impression the first time the party meets them under an ordinary turn.

Let the frozen result change this NPC's observable manner and the opportunity or
friction they offer this investigator. Combine it with their agenda, fears, loyalties,
what they can actually perceive and what the investigator did. A favorable result
does not erase a duty, force disclosure of an unknown fact, or control the player's
choices. Explain the causal reaction in the story without restating the numbers.
On critical/fumble, realize a material opportunity/complication within the fiction
and land actual world changes through apply; never leave it as a bare dice card.

The initial impression is pair-specific. It is not the party's shared stance and
does not overwrite later interactions. Continue to use the existing social checks,
NPC ledger and apply npc for subsequent developments, with a reason when needed.

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
never a whole line in a language this table is not playing in — the kernel enforces
that floor and will reject a delivery carrying no play-language script at all.

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
