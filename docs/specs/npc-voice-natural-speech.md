# NPC voice: natural conversation and explicit campaign upgrades

Status: implementation integrated, 2026-09-19; genuine-table acceptance pending. Contract: kernel RPC §40.8.

## Intent and evidence

The player should hear different people answering what was actually said, not a set of repeated slogans. Installing the feature must not be confused with enabling it in an existing campaign. Passing a schema check or attributing anonymous lines to characters is not sufficient acceptance.

Two exact retained samples establish different failures (see `.pi/findings/npc-voice-audit-final.md`):

- `bg-ui-control-80111ecd9`, turn 2: npc-voice 1.1.2, full instructions and Knott's mask were present. The mask demanded abrupt speech and deadlines; delivered dialogue reused the sample's deadline and paperwork phrases.
- `game-7dca41f9-ef0a-4f3b-8516-d9c463ae2f2a`, turn 252: npc-voice was absent from the campaign lock and capsule. None of 254 saved turn capsules carried the package.

## Decisions

1. Keep the existing mask/exchanges data shape and book-authority boundary. A mask describes register and flexible habits, not compulsory catchphrases, attitudes or topics. The opening exchange is an ordinary first contact, not a mandatory brush-off. Three examples must demonstrate conversational range. Names, secrets and listener identity remain protected.
2. The Keeper answers the current utterance first. Voice changes wording, not the facts, cooperation, length or emotional reaction the scene requires. No demand to display a marker on every line; examples are not a phrase bank. Ordinary courtesy, uncertainty, agreement and direct answers are valid in every register.
3. Use the existing tool-enabled Pi task runner for the writing stage, with retained request/draft/event artifacts and no recursive package loading. A short semantic verdict remains in the validation lane. Validate naturalness, relevance, register, listener fit and copied/repeated examples; no language detection, semantic keyword rules or phrase blacklist in code. Pass the already-produced `said` field to both stages.
4. Quality review applies whether or not the source contains `voice`, including silent candidates: a quiet-sounding character is not automatically a non-speaking character. One repair is allowed; the repaired candidate must be reviewed again. A rejected or unavailable review never becomes an established new card. Play continues using the source/dossier; failures are observable and retry-bounded. No foreground prose gate or extra Keeper tool.
5. Ship npc-voice 1.2.0 with state version 2 and the required runtime capability `npc.voice.generation.v2`; older runtimes must report it incompatible rather than migrate a save they cannot run. Explicit upgrade archives the old generated dossier through the existing declarative state migration and lets the ordinary background queue regenerate current/met people. Old jobs and old turn records remain untouched. New jobs are bound to the package digest; stale results cannot overwrite newer configuration. No automatic upgrades of all packages or graph-wide generation.
6. Reuse existing `mods.configure` for a missing package or version update. The Mods panel distinguishes not added, disabled, enabled and pending states using the existing data and English-source/presenter path. No second activation mechanism. Explicitly disabled packages stay disabled.

## Ownership and changes

- Main: contract, integration and genuine-table player.
- Kernel slice: version-2 job identity/storage, configuration binding, state migration and regressions.
- Lane slice: tool-enabled writing, revised instructions, naturalness review/repair and focused fake-provider wiring tests.
- UI slice: existing campaign status visibility and focused panel tests; no panel redesign.

## Verification

Deterministic checks cover package freeze/version migration, retained evidence, source-authored protection, disabled/pending configurations, stale submit refusal, `said` propagation, rejected/unavailable review, successful repaired review, cancellation, setup-mode isolation and panel statuses. Run Python tests serially. Full integration uses the documented repository suites, with real exit codes and unrelated pre-existing failures reported separately.

Genuine acceptance uses `tests/play/driver.py` and `bin/pi-coc`, Grok as Keeper, this main session as the sole player, one natural utterance at a time. Do not use batch/scripted players or direct model completions as a substitute. Inspect actual capsules and cards alongside delivered dialogue. Exercise ordinary talk, a direct practical question, a refusal/pressure moment and a return to an earlier subject as the table permits. Evaluate response relevance, intelligibility, natural sentences, distinct register without slogan stamping, preservation of source facts and listener identity. Preserve all evidence. A technical pass is not a naturalness pass.

## Verification record (2026-09-19)

- Integrated NPC lane/package/runtime-compatibility tests: 43 passed; runtime build exited 0. UI/presenter/status tests: 44 passed. The 31-key Chinese Mod surface seed was generated by the real tool-enabled presenter, not hand-translated.
- GLM reproduced an obsolete capsule-head string assertion, updated only that assertion to the §40.8 wording, then ran voice and voice-bench tests: 31 passed, exit 0. Its remaining bounded Python tail also passed: 154 tests, exit 0.
- The broad extension run had 1744 passes and one out-of-scope continuity-audit module-resolution failure. The broad Python run timed out at 1800 seconds after 1290 observed pass markers; bounded continuation covered the remaining file families. These are not represented as one uninterrupted full-suite pass.
- Cold integration review passed; its warning about silent candidates bypassing review was subsequently fixed and covered by the integrated lane tests.
- Browser inspection covered desktop/mobile DOM states using the production panel with a fixture host. Screenshot capture was unavailable, so no responsive visual-acceptance claim is made.
- No new genuine table has been run for this change. The user prohibited Astra for testing while the main session was still Astra; project rules require that main session to be the sole player. Live acceptance awaits a non-Astra main session, with Grok as Keeper. No existing live save was upgraded or rewritten.

## Non-goals and rollout

No world/story rewriting, broad NPC personality system, global package auto-enrollment, source-book rewrites, forced catchphrase ban, foreground latency increase, or App restart/repackage in this work. Existing live saves are not hand-edited. Applying the new package to a live table goes through its bound Mods interface at a safe turn boundary; report separately whether that activation actually occurred. Keep the two original screenshot campaigns and their historical cards as evidence.
