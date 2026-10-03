# Active Plan — Chinese NPC Expression

## Status and user outcome
Implementation is complete in the correct owned scope. Status is **implementation and source regression complete, with limited literary-quality evidence**. The user-facing aim is contextual Chinese NPC speech that preserves source voice, knowledge, facts, and player agency without adding a second writer, semantic runtime classifier, or forced cadence. The evidence report is [npc-speech-repair-evidence.md](../specs/npc-speech-repair-evidence.md); its finite final-full and source-integration slots are not duplicated here.

## Completed behavior and seams
- Family 8 is bounded to one participation batch with independent activation and register-conflict Nouls. It may select none or at most one habit and one interaction per relevant person; source examples and their actual replies remain bounded state. Budgets remain 8 people, 24 cards, and 14,000 context bytes.
- NarrationCraft owns encounter purpose, reactive emotion, source facts, and agency. `zh-optimize` owns Chinese realization and original references. Unconditional answer-first, repeat-to-anger, and occupation-to-fixed-reaction rules are removed; source-consistent wording remains permitted without fabricated canon, authority, resources, secrets, or choices.
- `voice.job` supports exact-generation `exclude_jobs` validation (0–128 opaque nonempty strings, maximum 512 characters), with structural `invalid_params` on wrong type or overflow. Voice-only startup waits for both context and bridge, queues one current job, has no backfill, and protects source-authored/established voices. Cancellation, stale suppression, bounded pause/cooldown, retry retirement, and deferred unavailability retain their specified behavior.
- Actual serialization and capsule-to-provider inclusion must preserve owner, version, and source identity. The public seams remain `voice.job`, `voice.submit`, capsule/provider request, and genuine driver dialogue. No migration, deployment, App packaging, release, or new runtime instrumentation is in scope.

## Validation posture
Kernel typecheck passed. The first full result was 4,377/4,379 with two explicit failures; the package fixture/version update and restoration of meaningful prose-guard examples and conditional-reaction assertions resolved those failures. The linked evidence report records final 4,379/4,379, later 20/56 focused evidence, and typecheck. Focused evidence includes the supplied structural/public, lifecycle, voice/language, mood-alignment, source-protection, family-8, provenance, and provider-inclusion gates.

## Quality and next gates
Three real voices were reviewed and published: Steven Knott appeared in turn 2, and Arty Wilmot and Ruth Blake appeared in later capsules. The same-world restart preceded later-card publication. The goal-as-mask refinement prevents a current task goal becoming permanent phrasing. These observations do not erase repeated business information, an invented desk worker/documents, a repeated already-returned-key question, partly bookish dialogue, agency/details failures, reviews over 13 seconds, a missing key definition, or the incomplete ending effect. Do not claim perfection, stable quality, casual speed, statistical advantage, fresh-live acceptance of the exact current package, or App acceptance.

Keep all historical evidence and old-world locks; do not invent quotes or lore, add a prose judge, use executable semantic heuristics, or broaden scope. Literary evidence remains limited: dialogue is partly bookish and observed agency/detail failures remain.
