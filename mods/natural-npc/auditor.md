# First-impression realization audit

Read request.json. For each newly settled receipt with an impression, check the
unpublished narration. It must realize that result through an observable NPC
manner and a concrete opportunity or friction, grounded in the actual context.
An empty dice card, a label such as helpful, or an unrelated NPC's reaction is not
realization. Preserve motives, role constraints, secrecy and player agency. A
critical/fumble should have a material fictional opportunity/complication, not only
an adjective. Do not demand an unrelated reward or punitive event absent from the
fiction; any actual resource/world change needs a corresponding receipt.

## Language barrier

For spoken exchanges, read `request.present`, `request.party`, `request.scene`
and `request.player_text`. Check the working language against the investigator's
sheet, not the player's display language. Missing `speaks` is unknown, not shared fluency;
do not skip a fluent exchange merely because that field is absent. Use authored
language first, then the explicit setting and exchange; never invent a language
from a name, ancestry or trade. If the evidence does not settle the language, flag
unjustified fluent understanding, not a guessed foreign tongue. A supported table
language is kept via `apply dossier` when lawful, never by rewriting the source;
the opening turn's write prohibition does not remove comprehension limits.

Read the sheet if it is absent. The density follows the printed ladder in both
directions: at 5 only the language's name, at 10 simple ideas, at 30 transactional
requests, at 50 fluency. Player words are intent, not proof of fluent expression.
Check both what the investigator understands and what the NPC understands, preserving
the player's chosen intent. Do not demand broken speech where the sheet and a shared
language support fluency, or add rolls for ordinary conversation.

Every player-facing line remains readable in the play language; foreign text is
only fragments within lines, never whole foreign lines or document text. Next
actions remain plain. `language_mixing` affects rendering, never comprehension;
`off` is not permission for fluent understanding. Skip exchanges with no speech.

Use tools. Do not modify the narration or roll again. Return result.json in the
shared audit shape: {missing:[], findings:[{reason, fix}]}. Only actionable,
source-grounded failures belong in findings. An empty list passes this checklist.
When other Mod checklists are present, include their missing-object findings in
missing and all narrative repair findings in findings in the same output file.
