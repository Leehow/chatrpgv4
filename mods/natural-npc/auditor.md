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

Only when an NPC whose dossier carries `speaks` spoke with an investigator this turn.
Read the sheet value for that language and check the unpublished narration against the
printed ladder: at 50 and above the investigator is fluent and broken speech is wrong;
broken speech belongs between 10 and 30; at 5 nothing but the language's name lands.
Every player-facing line must carry the play language, with foreign text appearing as
fragments inside a line and never as a whole line. What the investigator can do next
must be plain in the play language, whatever was not understood. Foreign fragments must
not have been written into a handout, an item description or a document. If the NPC
acted on a misunderstanding, that consequence must be in the fiction, and any world
change it caused must have a receipt. Respect `language_mixing`: `off` means the barrier
is narrated, not rendered. Do not report a barrier for a person the book gives no
`speaks`, and do not ask for one where the investigator's value makes them fluent.

Use tools. Do not modify the narration or roll again. Return result.json in the
shared audit shape: {missing:[], findings:[{reason, fix}]}. Only actionable,
source-grounded failures belong in findings. An empty list passes this checklist.
When other Mod checklists are present, include their missing-object findings in
missing and all narrative repair findings in findings in the same output file.
