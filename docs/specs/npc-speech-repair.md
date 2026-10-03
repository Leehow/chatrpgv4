# Chinese NPC speech repair

## Purpose and boundaries
Make Chinese NPC speech respond to the whole encounter while preserving source truth, established voice, knowledge, and player agency. The host owns context, scheduling, cancellation, and publication; the TypeScript kernel owns structural validation, generation identity, state, and public RPC behavior. Existing public seams (`voice.job`, `voice.submit`, capsule/provider request, and genuine driver dialogue) are approved. No runtime rewrite, migration, new Keeper verb, planner, provider bypass, second prose writer/reviewer, deployment, or App-packaging claim is included.

## User stories (12)
1. A player receives a response to the whole current action, not a canned agenda.
2. Established source voice is preserved; generated voices distinguish NPCs without caricature or catchphrases.
3. A direct question may receive a direct answer, while variable, formal, long, quiet, or refusing speech remains possible when warranted.
4. Speech respects listener identity, knowledge, facts, and agency.
5. A host can request bounded participation and interaction references, or none.
6. Selected references survive exact Pi serialization into the existing Keeper request.
7. Preparation is bounded, cancellable, and does not delay ordinary play.
8. Failed or unavailable preparation falls back without hammering every NPC.
9. Generated voice belongs to the enabled owner namespace and exact generation.
10. Source-authored and established voices cannot be overwritten.
11. Retired work cannot block a later eligible person.
12. Genuine dialogue evidence is reviewed without claiming unproved naturalness.

## Selection contract
Use expression family **8**, one batch of participation, independent activation, and register-conflict Nouls. Select none or at most one habit and one interaction per relevant person; keep existing cancellation, cache/source bindings, and the same context/card/byte budgets: at most 8 people, 24 cards, 14,000 context bytes. State retains bounded source example context and its reply; register-conflict judges the examples’ actual demonstrated wording alongside the pattern. Cards are advice only and assign no facts, traits, actions, state, authority, or voice mutation. No additional question family, prose reviewer, or rewrite is introduced.

## Voice job and lifecycle
`voice.job` accepts optional host-owned `exclude_jobs`, an array of 0..128 opaque nonempty strings, each at most 512 characters. Wrong type or overflow is a structural `invalid_params` refusal. Exclusions match exact current campaign/person/package generation job IDs only; foreign or stale generation IDs cannot suppress current work. Default behavior and order remain unchanged. Source-authored or established voices are never overwritten.

Voice opts in to exactly one initial current-campaign job, only after both session context and bridge are ready (either arrival order). It is Voice-only, has no `backfill` flag, and never sweeps the book. Existing six-job/dispatch and cancellation behavior remains. `Queue.pauseFor` uses one bounded timer (maximum 60,000 ms), cleans it on cancellation, and does not block foreground. Voice unavailability uses a default 15,000 ms cooldown; spent attempts are never reset.

A host-local failure is classified as `rejected`, `unavailable`, or `cancelled` by process/artifact/review stages, never by regex or interpretation of error prose. Rejection retires after the current job has used at most two attempts and moves to a later eligible person. Unavailability defers the current drain with remaining allowance rather than immediately trying every NPC. Cancellation fails and publishes nothing, including stale artifacts.

## Writing ownership and constraints
NarrationCraft owns encounter purpose, reactive emotion, source facts, and agency. `zh-optimize` owns Chinese linguistic realization and original references. Full, brief, voice-owner guidance, and the Chinese addendum must agree. Remove unconditional answer-first, repeat-to-anger, and occupation-to-fixed-reaction rules. Do not fabricate canon, authority, resources, secrets, or player choices; source-consistent responsive expression and fresh wording are permitted. Preserve flexible variable/formal/long/quiet/refusal modes and the single-draft law. Masks and examples demonstrate range, not compulsory markers; examples answer their actual preceding words.

## Validation and evidence
Use focused structural/public tests, host first-ready/retired/deferred/cancelled tests, source-authored/established guards, actual serialization provenance, and capsule-to-provider inclusion. Then use the permitted full LAN extension suite and kernel typecheck/build. Frozen offline comparisons are diagnostic; live review uses the approved driver and one natural-language player utterance at a time. Every pending test remains pending until recorded; no historical record proves current naturalness. Preserve old-world locks, source cards, historical evidence, and dirty plans; no automatic migration. App/source version consistency is a separate gate; source tests do not claim App acceptance. No network release, push, or deletion of evidence.
