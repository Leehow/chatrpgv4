# Jev prescreen: dependency and provenance repair

Date: 2026-09-21. Branch: `0.9.4a`, HEAD `fb5c4c324` plus the existing uncommitted prescreen implementation.

The intended outcome is trustworthy supplementary context and an honest measurement of its
benefit. Passing tests or counting preselection calls alone does not establish faster or better
Keeper play. This change repairs two deterministic defects. The user subsequently supplied a
credential and explicitly delegated live A/B to non-Astra workers, including PDF modules.
Three independent `gpt-5.6-sol` verification lanes have finished and their full handoffs were
reviewed. Haunting and Desire completed exploratory paired episodes; Masks was blocked before
play. The two deterministic repairs passed; stable end-to-end speedup and complete PDF product
acceptance are not established. A late audit also found concurrent source/build changes during
the Desire comparison, retained explicitly below.

## Confirmed root causes

### A supplement could evict its own evidence dependency

`context-runtime.ts` removes source candidates whose bodies are in the prepared workspace.
That creates a dependency: the prescreen assumes the workspace will supply those bodies.
However, both the full-request overhead check and `projectedMessages` previously reserved
the prescreen first. When only one optional message fit, the workspace disappeared even
though it would have survived with preselection disabled. No model error was needed.

Both packing stages now reserve the ordinary workspace first. The tested invariant is:
if the request without a supplement retains the workspace, adding a supplement must retain
it too. Current player input, capsule, tool pairing and the existing ceiling still precede
both optional messages. This is a dependency-order repair, not a larger context budget.

### A source reference was reduced to an unqualified string

`sourceReference` already produces a locator and exact coverage, including selected-field
scope, `entity_complete: false`, and an explicit range when an 8192-byte excerpt is used.
The prescreen candidate adapter discarded that metadata. A later budget omission discarded
even the body, leaving an indistinguishable label such as `scene evidence`.

The adapter now carries the original locator and coverage unchanged. Each source row has a
named ordinary module/rule lookup beside it. Budget-omitted rows retain the same provenance
and lookup. The host creates these references from existing candidate metadata; Jev does not
copy or regenerate them. The fix does not claim an excerpt is a complete entity.

### Repeated zero selections still have a foreground cost

Preselection is awaited before the Keeper request. State/source changes invalidate the prepared
context and can trigger another selection within the same player turn. The retained earlier
book-2 run contains 12 empty selections taking 27484 ms in aggregate, plus three timeout or
cancellation fallbacks. Equal token counts do not establish identical input or safe cache reuse.
These observations explain where time is spent, but do not prove the net effect on a turn:
preselection might avoid later Keeper rounds. No cache, semantic shortcut, timeout increase or
provider-policy change was added without that measurement.

## External cross-check

[TypeSafe's reranking cookbook](https://docs.typesafe.ai/cookbooks/rerank_typesafe) and
[Azure's semantic ranking documentation](https://learn.microsoft.com/en-us/azure/search/semantic-search-overview)
both describe semantic selection after bounded retrieval. They support keeping retrieval and
selection separate and explicitly limit selection to the supplied candidate set. Azure also
documents input truncation and output fields retained with results. These are useful analogues,
not evidence that this project's packing, source coverage or end-to-end latency is correct.

## Deterministic before/after comparison

The before artifact freezes the actual uncommitted implementation, not HEAD (where these new
files were absent). The same assertions were run against before and after code. No provider
was called and no gameplay was simulated in this comparison.

| Observation | Before | After |
| --- | ---: | ---: |
| Workspace evictions across 31 fixed byte budgets | 8 | 0 |
| Source rows retaining locators | 0/3 | 3/3 |
| Source rows retaining excerpt coverage | 0/3 | 3/3 |
| Source rows retaining ordinary lookup references | 0/3 | 3/3 |
| Focused prescreen regression assertions | 8 pass, 3 fail | 11 pass, 0 fail |

The three new regressions exercise the message ceiling, actual context hooks with system-prompt
overhead, and source excerpts that are both delivered and omitted. The byte-budget sweep is a
deterministic boundary diagnostic, not 31 independent gameplay observations.

Validation: 49 related extension tests passed, kernel TypeScript check passed, runtime build
passed, and `git diff --check` passed. No App package or deployment was produced.

## Live comparison: initial attempt and delegated continuation

The planned arms use new independent `the-haunting` campaigns, the `thomas-hayes` pregen,
Chinese player language, `xai/grok-4.6`, the existing low-thinking configuration, ordinary
`bin/pi-coc` through `tests/play/driver.py`, and `PI_COC_TASK_RUNTIME=0` / `PI_COC_JEV_S0=0`.
The only intended arm setting difference is `PI_COC_JEV_PRESELECT=0` versus `1`. The main
session is the sole player, making natural choices after each actual response.

The off arm `jev-ab-off-20260921-231305` completed its automatic opening and one driver turn:
85.996 seconds, three tool calls (`apply`, `narrate`, `narrate`), visible narrative delivered.
The daemon was stopped after settlement and all evidence was retained. This single off-arm
turn is not a completed A/B comparison or campaign acceptance.

The initial on arm was not started: `TYPESAFE_API_KEY` was absent from the environment and
was not found at the checked application-vault locations. The user was asked for the secure
storage path or an environment mount, not for plaintext in chat. An on arm without a credential
would silently disable preselection and make the comparison invalid.

After the credential was supplied, it was passed through hidden terminal input into the child
process environment, without being saved in repository/evidence files. A fresh paired Haunting
experiment started with runs `jev-ab-off-20260921-232438` and `jev-ab-on-20260921-232438`.
Both use the already validated source/build. The prior unpaired off run stays preserved and is
excluded from this pair. `live-plan.json` records settings, source hashes, metrics and limitations.

The user then explicitly requested worker-owned tests and PDF coverage. Worker routing is
`codex / verifier / pinned:gpt-5.6-sol / oneshot` for all three lanes:

| Lane | Ownership | Handoff |
| --- | --- | --- |
| `jev_ab_haunting` | Existing fresh Haunting pair, transferred after both first player turns settled | `.tmp/team-lead/worker-jev-ab-haunting-20260921.md` |
| `jev_ab_desire` | New short-PDF setup and paired play for An Amaranthine Desire | `.tmp/team-lead/worker-jev-ab-desire-20260921.md` |
| `jev_ab_masks` | New long-PDF setup and paired play for Masks, reusing the verified prepared PDF where safe | `.tmp/team-lead/worker-jev-ab-masks-20260921.md` |

Each worker is the only manual player for its lane; Grok remains the Keeper via the canonical
driver. No worker may change source/configuration or manufacture campaign state. Lanes have
distinct campaign/run ownership; simultaneous lanes share provider capacity, a measurement
limitation. Within each pair, player turns run sequentially and first-arm order alternates.

Initial Haunting observation: off turn 1 took about 72.4 seconds, on took about 63.3 seconds.
The on turn had two prescreen timeouts (3003 and 3001 ms) with actual Jev usage but no injected
prescreen. Its shorter wall time therefore does not demonstrate useful preselection. The off
turn also encountered an unavailable continuity review. Opening/recovery context rows can
carry the next turn number; align metrics with driver time windows and actual request events
rather than grouping all telemetry by `turn` alone. No speedup or quality gain is claimed.

### Haunting: completed exploratory paired episode

The lead read the complete worker response/handoff and independently recomputed totals from
driver turn files and `turn_end` events within each `started_at..ended_at` interval. Five paired
natural-intent windows ended at the Central Library after a coherent Globe research episode.
Both daemons stopped, and all ten turns delivered narrative.

| Metric | OFF | ON |
| --- | ---: | ---: |
| Full player-turn wall time | 501.186 s | 517.910 s |
| Keeper model rounds | 30 | 23 |
| Keeper tools | 39 | 31 |
| Keeper read tools | 15 | 11 |
| Prescreen successful preparations / fallbacks | 0 / 0 | 17 / 5 |
| Prescreen wall time | 0 | 53.593 s |
| Requests with prescreen injection | 0 | 18 of 23 |

ON was 16.724 seconds (3.3%) slower overall despite fewer Keeper rounds and reads. This is
observed workload, not a causal estimate: first impressions/dice, chosen social skill, narration
repair loops, continuity-review availability and concurrent provider load differed. In particular,
ON turn 1 was faster despite receiving no prescreen material. Fewer calls alone are not a latency
win, and subtracting prescreen time from the ON wall would not construct a valid counterfactual.

Both arms acquired the principal Globe story, Macario, handout, and eventual fire-cutoff receipts.
ON turn 4 nevertheless narrated that earlier reports were absent before the fire-cutoff clue had
a receipt; the verifier retained a `reveal` warning. The lead verified that both core capsules
already contained that exact fact with `discovered:false` and an NPC-dialogue gate. Therefore
this is an observed ON-only receiptless disclosure, not proof that Jev uniquely introduced the
fact or bypassed authorization. Increased source salience or reduced visibility of acquisition
cues are hypotheses, not established causes.

The built-in module had no original PDF bound, and some ordinary source lookups failed with
that explicit reason. Compiled module/handout reads kept the episode playable. This lane proves
neither raw-PDF ingestion nor whole-scenario completion.

Evidence: `.tmp/team-lead/worker-jev-ab-haunting-20260921.md`, the two `...232438` campaign/run
directories, ON `turns/0004.json`, and the lead's `haunting-reviewed.json` in the repair evidence
directory. No source/configuration changes were made by this worker.

### Masks: verified setup blocker, no live A/B

The complete Masks worker handoff was reviewed against the actual campaign/module records.
The source is the requested 669-page PDF, SHA-256
`806966db20202a020af6213695dccc0b547fc998a73dd2f1344567e2579a1942`.

Reusing the App-home prepared module hit the immutable `narration-craft 1.3.0` byte-conflict
check. The worker preserved that failure and used normal raw-PDF setup in its own fresh writable
home, without copying or modifying the App module. That path published three graph generations.
The successful prepare response was exactly
`{"ok":true,"module_id":"book-1","opening_ready":true}` inside the setup result; it did not
carry the selected `start_scene`. The new campaign persisted `module_generation=2`,
`opening_scene=null`, `status=setting_up`, `investigators=[]`, and `play_language=en`.

The module's `prepared_openings.scene-a-message-from-an-old-friend` is ready, while its latest
top-level readiness is false and reading is blocked. `prepareCharacterGuidance` cannot resolve
the selected scene and throws at `extensions/module/character-guidance.ts:135`, before a guidance
model/reviewer packet is built. This is an opening-selection/propagation failure, not established
evidence of a reviewer-model failure. `extensions/onboarding/index.ts` settles the creation step
before calling `ensureGuidance`; subsequent ordinary retry/switch requests did not recover.

The App reuse attempt took 76.488 seconds; the fresh-home setup attempts totalled 628.951 seconds,
including 572.034 seconds in source preparation. These are setup measurements, never Jev
turn measurements. Both daemons stopped cleanly. No investigator, live table, on/off pair or
prescreen injection was produced. Masks is **blocked/partial**, not passed and not a zero-speedup
result. The blocker is outside the two repaired prescreen packing/provenance seams; no unrelated
setup implementation was changed during the frozen comparison.

Primary evidence: `.tmp/team-lead/worker-jev-ab-masks-20260921.md`,
`.coc/playtests/jev-ab-masks-on-20260921a-setup/`,
`.coc/playtests/jev-ab-masks-on-20260921b-setup/`, and
`.coc/playtests/jev-ab-masks-source-20260921/.coc/`.

### An Amaranthine Desire: completed exploratory paired episode

The lead independently verified both campaigns bind to `book-3`, generation 3,
`dunwich-1895-landing`, `zh-Hans`, and the requested 41-page PDF SHA-256
`b0b3b1772fadddf168e8f4d32497b045e40a33744838fef221167b3385516c4e`.
Both completed five natural player turns, delivered narrative, and stopped their daemons.
The main Keeper counts below were independently recomputed from driver/RPC event intervals;
they include rounds that narrower skill-specific telemetry may omit.

| Metric | OFF | ON |
| --- | ---: | ---: |
| Full player-turn wall time | 899.766 s | 852.576 s |
| Keeper model rounds | 25 | 24 |
| Keeper tools | 32 | 29 |
| Keeper read tools, including recall | 15 | 11 |
| Prescreen preparations / fallbacks | 0 / 0 | 20 / 0 |
| Nonempty / empty prescreen preparations | 0 / 0 | 14 / 6 |
| Prescreen wall time | 0 | 43.543 s |
| Requests with prescreen injection | 0 | 15 |

ON was 47.190 seconds (5.2%) faster in this particular episode. Median turn time was slightly
worse: ON 155.497 versus OFF 154.745 seconds. These are observations, not a stable causal
speedup. ON ran before OFF; generated investigator stats, model/repair behavior and provider
load varied. The public investigator choices matched, but the cards were not bit-identical.
An earlier OFF setup using `zh-CN` was preserved and excluded; the compared OFF setup uses
`zh-Hans` like ON.

The starting module-store generation matched, but effective campaign-local sources later
diverged. ON published local generations 4 and 5 during turns 4 and 5. OFF's first two detail
readers failed; its local generation 4 published at 00:15:20Z, after turn 5 delivery. ON did not
warm OFF's campaign-local graph. The OFF turn-5 preparation delay explains a material portion
of the observed timing difference and must not be labeled a net Jev benefit. The shared base
module's unchanged generation 3 alone would have missed this distinction.

Both turn-3 records have a verifier `reveal` warning for the full-moon clue without its receipt.
OFF also has a turn-1 uncommitted-state warning about rope placement. These shared verification
and receipt issues cannot be classified as Jev-only failures. Internal tool/refusal/repair paths
must remain part of the measured work, even when final delivery succeeds.

Primary evidence: `.coc/playtests/jev-ab-desire-on-20260921-play/`,
`.coc/playtests/jev-ab-desire-off-20260921b-play/`, the correspondingly named campaigns, and
`desire-reviewed.json` in the repair evidence directory. The complete worker handoff records
setup attempts, investigator comparability and further quality/source details.

### Late concurrent changes and closeout

A final hash audit at 2026-09-22 00:26:55Z found external concurrent changes. The prescreen
source gained the shared Jev credential reader at 23:51:59.993Z, after Desire ON finished;
`build/extensions/table/index.mjs` was rebuilt at 00:02:27.567Z, during Desire OFF. Other
credential-integration and runtime files also changed. This task and its workers did not make
those changes, and they were preserved.

The source launcher uses `build/extensions/*/index.mjs`. Both Desire main Pi processes started
before the observed rebuild (ON 23:35:47.687Z, OFF 23:56:10.620Z), so source edits alone do not
prove that their already-loaded main extensions changed. However, later reader/lane subprocesses
can load newly emitted files, and a complete per-subprocess artifact manifest was not captured.
Consequently the Desire run does not meet a strict immutable-runtime performance control. The
Haunting episode finished before these observed edits. Earlier intermediate checks had matched;
the final audit supersedes any blanket claim that the entire experiment remained frozen.

The exact two repaired packing/provenance changes remain present. A closeout rerun of the current
prescreen suite passed 12/12 (including a concurrent added test); the original frozen repair run
had passed 49 related tests and 11 focused assertions. The broader concurrent changes were not
adopted or certified by this task. All nine owned setup/play daemon and Pi PIDs were gone at
closeout. A credential-marker scan of the owned evidence found no matches. See
`closeout-check.json` and `closeout-prescreen-tests.log`.

## Retained evidence

- `.coc/playtests/jev-prescreen-repair-20260921T231305Z/manifest.json`: before/after source hashes and status.
- The same directory's `before/`, `after/`, `before-api.mjs`, `after-api.mjs`: frozen source and diagnostic bundles.
- `baseline-tests.mjs`, `regression-tests.mjs`, `before-regressions.log`, `after-regressions.log`: identical regression comparison.
- `mechanical-ab.json`: all 31 budget cases and provenance counts.
- `focused.log`, `build.log`: validation results.
- `.coc/playtests/jev-ab-off-20260921-231305/`: real driver events, turn record and final stop result.
- `.coc/campaigns/jev-ab-off-20260921-231305/`: retained real campaign evidence.

Keep both arms on the same source revision and provider settings and report any narrative/state
divergence before comparing timings. Do not treat earlier book-2 measurements as a missing arm
or as a substitute for either requested PDF. Read complete worker handoffs before acceptance.
