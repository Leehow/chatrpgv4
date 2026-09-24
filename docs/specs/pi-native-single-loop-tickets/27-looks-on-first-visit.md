Status: ready-for-human
Stage: SL-27 (P2; extends SL-15)
Spec: docs/specs/pi-native-single-loop.md (Ruling: "The Keeper is shown what the run has read")

# SL-27 — Looks on a first visit: carry the scene's source passages; resolve clue labels

## Evidence (long live gate, campaign longgate-haunting-1010)
- 18 look/lookup/recall calls in 20 turns (turns 1, 6, 10, 11, 15, 16, 19, 20), each a model round; kinds: `source` (book passages, 6), `module` (scene/handle queries, 5), `rule` (1), `adaptation` (3), `look scene` (3), `look object "Corbitt Diaries"` (unknown_entity: the clue is `corbitt-diaries`).
- The prescreen already locates source passages for the scene (read rows: `located` cards) and SL-15 carries scene/person/session views but not source text.

## Scope
1. Measure: for each look on the table, was its answer already in the prescreen's materials or the carried section (byte overlap)? Pre-register.
2. Contract (§135.31 amendment): on a scene's first visit in a run the carried section includes the scene's located source passages (from the prescreen, under the carried ceilings); `look object/name` resolves clue and handout labels the kernel knows (by label in either language) before answering unknown_entity.
3. Implement; tests, mutation-killable; replay the long gate's turn 10 and 19 states with the recorded Keeper and report looks before/after.

## Comments

### 2026-09-24: implemented on `claude/sl27-20260924`

Branched from the integration branch at `1dccf4578`. No push, no package, no live table.

The gate's campaign is `longgate-haunting-0624` (this ticket and SL-02's comment say `-1010`). The evidence is in
`chatrpgv4-wt-integ-sl/.coc/campaigns/longgate-haunting-0624` and in `.coc/playtests/longgate-haunting-0624-20260924T102454Z`,
and it was only read. The replay fixtures are `experiments/single-loop-routing/fixtures/longgate` plus `longgate-t{1,6,10,11,13,15,16,19,20}`, built with `gate-fixture.mjs`.

**Commits**

| commit | what |
| --- | --- |
| `15c8ee384` | contract §135.31.1, before the code |
| `fe0f4fb7d` | kernel: `look focus=object` resolves clue and handout names (`kernel-ts/read/mods.ts` `knownLabel`, `read/handlers.ts`) |
| `0747d12fa` | engine: the scene's passages in `carried` (`runtime/jev/carried-views.ts` `scenePassages`, `runtime/jev/hybrid-engine.ts`) |
| `cdd2e7449` | `tests/extension/single-loop-looks-first-visit.test.mjs` |
| `c1a3cb5e4` | harness: `SINGLE_LOOP_DUMP_REQUESTS` dumps each replayed Keeper request and every read result (`product-entry.ts`) |
| `b50bb3f6f` | §135.31.1 amended after the first live arm (the module's source is stated; linked places count) |
| `aac10affb` | engine: the passages' head reads the module's source off the capsule's `reading` section |
| this commit | the ticket, the manifest, fixtures, results, `sl27-look-overlap.py` |

**Scope 1: measure first.** The pre-registration was written before any replay (below). Method:

- Each turn with a look was replayed on the parent `1dccf4578` with the recorded Keeper (`--llm replay`, product driver, live Jev).
- The request each read answered was dumped with the read's result.
- The answer's JSON leaf strings of at least 16 bytes were searched verbatim in three haystacks: the prescreen packet (pre), the `carried` sections (car), and the whole request (all).
- Classes: present ≥ 0.8, partial ≥ 0.2, absent below that. An error answer is not scored.

The gate's event log has 20 read calls in turns 1–20: the ticket's 18 model-origin rows, the look that the preparation wait blocked at t20, and a recall at t20 that the host did not execute.

| turn | call | outcome (live and replay) | pre | car | all | class |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | lookup module `knott-keys knott-commission` (clue) | ok | 0.09 | 0.00 | 0.15 | absent |
| 6 | lookup source `previous-tenants` | `needs: no_source_document` | – | – | – | no answer |
| 6 | lookup module `previous-tenants vittorio-macario …` (scene) | ok | 0.46 | 0.00 | 0.55 | partial |
| 10 | lookup source `corbitt-house-ground` | `no_source_document` | – | – | – | no answer |
| 10 | look scene | ok | 0.75 | 0.00 | **1.00** | present (the capsule's `where`) |
| 10 | lookup module `corbitt-house-ground kitchen storage cupboard front door` | `not_found` note | 0.00 | 0.00 | 0.00 | absent |
| 11 | lookup source `upper-floor-bedroom` | `no_source_document` | – | – | – | no answer |
| 11 | lookup module `upper-floor-bedroom poltergeist-bed …` | ok | 0.29 | 0.00 | 0.34 | partial |
| 11 | lookup rule `bed-attack floating bed` | ok | 0.00 | 0.00 | 0.00 | absent |
| 13 | look scene | ok | 0.52 | 0.00 | 0.70 | partial |
| 15 | lookup source `corbitt house ground floor basement entrance` | `no_source_document` | – | – | – | no answer |
| 16 | lookup source (the same query) | `no_source_document` | – | – | – | no answer |
| 16 | look scene | ok | 0.11 | 0.00 | **1.00** | present (the capsule) |
| 19 | lookup module `outside Corbitt House street front` (scene) | `not_found` note | 0.00 | 0.00 | 0.05 | absent |
| 19 | look object `Corbitt Diaries` | `unknown_entity` | – | – | – | no answer |
| 19 | lookup adaptation prepare (anchor `corbitt-house-ground`) | `unknown_entity` (ambiguous) | – | – | – | no answer |
| 19 | lookup adaptation prepare (anchor `scene: corbitt-house-ground`) | ok (job state) | 0.00 | 0.00 | 0.00 | absent |
| 20 | look npc `Steven Knott` | blocked `preparation_wait` | – | – | – | not replayed |
| 20 | recall transcript | not executed by the host | – | – | – | not replayed |
| 20 | lookup adaptation status | ok (job state) | – | – | – | not replayed |

The t20 replay stopped at `step_limit` before any call, from the stranded t19 state (SL-23's defect). Its reads are job state and SL-23's.

What it says:

- **The largest class is the book lookup on a module that has no book: 5 of 18.** Every `lookup kind=source` failed `no_source_document`. The prescreen had located the scene's authored units at t10, and the destination's at t11 and t15/t16. They sat in the packet among maps, rules and people, and the Keeper went to the book anyway. Nothing carried could answer a source lookup here; only the module's authored graph could, and it was already partly in front of the Keeper.
- **The scene looks asked for what the request already held.** At t10 and t16 the answer was 100% in the request (the capsule's `where`); at t13, 70%. The carried section held nothing: SL-15 carries the scene only when it changed during the run.
- **`look object "Corbitt Diaries"`** named the clue `corbitt-diaries`. Its body rode in the run's issued section. The kernel looked only at world objects.
- The module, rule and adaptation reads are partly or wholly other tickets' (SL-25 places and guards, SL-23 preparation). They are not addressed here.

Pre-registered predictions against the result: the source lookups had no answer, and none was carried; this held. The module, rule, object and adaptation predictions held. The scene-look prediction held for the carried section but not for the rest: the request held more than predicted (present, not partial, at t10 and t16), and the prescreen held 0.75 and 0.52 at t10 and t13 (predicted absent).

**Scope 2: contract §135.31.1.**

- **A.** On the run's first model step at a scene (the run's own scene, and a scene it moves into), `carried` also holds `{focus: "source", name: <scene>, view}`. The view is that scene's passages from this run's prescreen:
  - the book's `kind: "source"` materials from a read at that scene;
  - the `graph_entity` materials of the scene's own entity, and of every entity whose located unit names the scene handle (what is there, and the places that lead to or from it), grouped by locator with the units merged.

  The passages are cut under the carried 4 KiB and served last in the 12 KiB message, once per scene per run. No kernel read is made for them. The head says what they are. The module's source is stated from the capsule's `reading` section (§22: present only for a module from a document): "This module has no original document … lookup kind=source answers no_source_document here".
- **B.** `look focus=object name` falls through to a clue before `unknown_entity`: first by its play-language label (`world.clue_labels`), then by the graph's names (`graph.find(name, ["clue"])`). A handout resolves by the graph's names. The answer is `{kind, entity (the lookup-module row), label?, discovered|shown, note}`, and the note names `apply clue` / `apply handout`. A name that both a clue and a handout answer is `unknown_entity` with both as candidates.

**Where each piece lives:**

- `runtime/jev/carried-views.ts`: `scenePassages`, `PassageSource`, `readCarriedViews`'s `passages`, `CARRIED_PASSAGES_HEAD`, `CARRIED_NO_DOCUMENT`, `CARRIED_DOCUMENT`, `carriedSection(carried, {document})`.
- `runtime/jev/hybrid-engine.ts`:
  - `RunState.passages` is filled in the read step from each prescreen outcome's packet (before the issued bodies are added);
  - `RunState.document` comes from the capsule;
  - `shown.passages` records the scenes already carried;
  - `carriedFor` decides when the passages are due.
- `kernel-ts/read/mods.ts`: `knownLabel`, and `objectLook(world, name, graph)`; `kernel-ts/read/handlers.ts` passes the graph.
- `experiments/single-loop-routing/product-entry.ts` (request dump), `sl27-look-overlap.py` (the measurement).

**Decisions for the owner to confirm:**

1. **"First visit in a run" is read as the run's first model step at a scene, every run**, not the campaign's first arrival. A turn's request keeps no earlier turn's `coc-clerk` messages: t10's request held the capsule, one packet and 2.4 KB of quotations. The t10 lookup came one turn after the arrival.
2. **Linked places are part of a scene's passages.** At the ground floor the passages held the upper floor (t11) and the basement (t15/t16), the places those source lookups asked about. They are there because their units name the ground floor's handle, not because anything judged them relevant.
3. **The passages duplicate bytes the packet already carries.** The packet stays as it is, because §124.4's delivered accounting reads it. Measured per carrying step on the replays: 2.1–4.1 KB (t10 3,731 B; t11 2,629 + 2,977; t13 2,977; t15/t16 2,142; t1 4,081, truncated, in a 12,103 B message with two cards and the scene).
4. **The first version's generic sentence did not work.** It said "a built-in starter has no source beyond its graph" without saying which module is one. In all three live runs of t10, the first response went to `lookup kind=source` with the passages in front of it. The campaign-specific sentence (from the capsule's `reading`) replaced it, and the source lookups stopped (below).
5. **A handout has no play-language label on the world:** the receipt keeps one, the world does not. It resolves by the book's names only. Filing `world.handout_labels` from `apply handout` would be a new writer (and a worldline confluence key). It is not done here.

**Scope 3: replays.**

*Recorded Keeper* (the gate's calls are replayed as recorded, so the look count is fixed by construction; what changes is what the Keeper had been shown when it made them). The after-arm carried coverage of the same reads:

| turn | read | car before | car after | passages carried (bytes) |
| --- | --- | --- | --- | --- |
| 10 | look scene | 0.00 | 0.69 | ground floor, 3,731 (scene, the house map, beat) |
| 11 | lookup module upper floor | 0.00 | 0.19 | ground floor, 2,629 (the map, the upper floor) |
| 13 | look scene | 0.00 | 0.49 | upper floor, 2,977 |
| 16 | look scene | 0.00 | 0.01 | ground floor, 2,142 (the basement scene) |
| 19 | look object `Corbitt Diaries` | `unknown_entity` | answers (`kind: clue`, `corbitt-diaries`, `discovered: false`) | none located at t19 |

t1: the Globe's passages (4,081 B, truncated), after SL-15's cards and scene; the module lookup's coverage is unchanged. t6: none, because nothing the t6 prescreen located names the scene.

*Live Keeper* (`grok-build/grok-4.7-build-fast`, low, product driver `--keeper live`, 3 runs per arm, one process at a time; before = `1dccf4578` in a detached worktree with its own build; results `results/sl27-{before,after1,after}-longgate-t{10,19}-live`):

| fixture | arm | reads per run | source lookups | model calls per run | the reads |
| --- | --- | --- | --- | --- | --- |
| t10 | before | 3 / 2 / 1 | 3/3 runs | 5 / 4 / 2 | source!, scene, module; source!, scene; source! |
| t10 | after v1 (generic sentence) | 1 / 2 / 1 | 3/3 runs | 2 / 4 / 2 | source!; source!, module; source! |
| t10 | **after** | **0 / 0 / 0** | **0/3 runs** | 2 / 3 / 3 | none: the first response resolves or applies |
| t19 | before | 4 / 2 / 2 | 1 run | 6 / 6 / 4 | module ×2, adaptation!, adaptation; module, source!; module, adaptation! |
| t19 | after | 2 / 4 / 1 | 0 | 3 / 6 / 6 | object `Corbitt Diaries` (answered), module; module ×2, adaptation!, adaptation; module |

- t10 shifted in all three runs: 6 reads and 11 model calls before, 0 reads and 8 model calls after. The source lookup went from every run to none, and so did the scene look (2 of 3 runs before). Walls are not lower (37/35/20 s before, 47/33/44 s after). The Keeper spent the saved round on a Spot Hidden or an apply, and the prescreen's time is in the wall.
- t19 is inside the pre-registered noise: 8 reads before, 7 after. Its reads are destination and adaptation lookups (SL-25, SL-23), and nothing here touches them. The object look answered where it was made.
- Pre-registered expectations: t10's source lookups falling to 0–1 per run held; so did the t19 object look answering, and t19 not changing. Not predicted: the scene look also went (it had been predicted unchanged).

Pre-registration (written before the first replay; the live arm's paragraph after the recorded-Keeper measurement and before any live run):

> For each look/lookup/recall on the gate: was its answer already in what the Keeper had been shown (the prescreen packet or the coc-clerk carried section; the whole request beside)? Recorded-Keeper replay per turn on 1dccf4578; leaf strings ≥ 16 bytes of the answer searched in each haystack; present ≥ 0.80, partial 0.20-0.80, absent < 0.20; an error answer is not scored. Predictions: source lookups (t6, t10, t11, t15, t16) fail no_source_document again; look scene (t10, t13, t16) absent from the packet and carried, partial in the whole request; module lookups partial in the packet for t6 and t11, absent for t1 and t10; the rule lookup absent; look object unknown_entity; adaptation answers absent everywhere. Live arm: t10 before 2-3 reads per run, after 0-1 source lookups per run with the scene look unchanged; t19's object look answers, its count unchanged; 1 read per run is noise, only a shift across all three runs is an effect.

**Tests** (`tests/extension/single-loop-looks-first-visit.test.mjs`, 6):

- the passages of a scene from stub packet materials: a book page first, then the scene's own entity, then the entities naming the scene; the identity once and the units merged; nothing from another scene; no passages, no view;
- the ceilings:
  - the passages are served after the scene and cut under 4 KiB, with the trailing entry named;
  - past the 12 KiB message budget they are listed as `budget`;
  - the head gets the passages sentence, plus the no-document or document sentence when the module's source is known;
- at the extension seam, the emitted kernel on the Haunting with a controlled prescreen:
  - after the clerk's move, the destination's passages are carried once, never those of the scene the run left, and at no kernel read;
  - a run that stays carries its scene's passages on the first step, not again on the second, and the head carries the no-document sentence;
  - without a prescreen nothing is carried;
- `look focus=object` on the emitted kernel:
  - `Corbitt Diaries` resolves to the clue, and the entity row equals `lookup kind=module`'s;
  - a handout resolves by its title;
  - `查档的路子` resolves after `apply clue` filed it, `discovered: true`;
  - an unknown name is still `unknown_entity`.

**Mutations** (each applied to the file, the test file run alone, the file restored; the kernel ones rebuilt the runtime before and after). All 16 killed:

| mutation | file | tests failed |
| --- | --- | --- |
| M1 passages never carried | `hybrid-engine.ts` | both seam tests with a prescreen |
| M2 passages carried every step | `hybrid-engine.ts` | both seam tests |
| M3 no scene filter | `carried-views.ts` | passages of a scene |
| M4 a book page of another scene kept | `carried-views.ts` | passages of a scene |
| M5 the scene's entity not first | `carried-views.ts` | passages of a scene; both seam tests |
| M6 units not merged | `carried-views.ts` | passages of a scene |
| M7 passages ceiling ignored | `carried-views.ts` | ceilings |
| M8 passages served first | `carried-views.ts` | ceilings |
| M9 head not extended | `carried-views.ts` | ceilings; a run that stays |
| M10 the module's source not stated | `hybrid-engine.ts` | a run that stays |
| M11 passages of the run's first scene only | `hybrid-engine.ts` | after the clerk's move |
| M12 clue/handout never resolved | `mods.ts` | look focus=object |
| M13 play-language label ignored | `mods.ts` | look focus=object |
| M14 handout not resolved | `mods.ts` | look focus=object |
| M15 anything resolves to a clue | `mods.ts` | look focus=object |
| M16 `discovered` not read | `mods.ts` | look focus=object |

**Suites** (leehow-pc):

Before the merge, at `aac10affb`: `loop` 139/139 (twice); `py` 1716 passed, 2 skipped; `ext` 2903/2904 at `c1a3cb5e4` and 2901/2904 at `aac10affb`. Each time the failures were timing tests on a box at load 17-46: `admission-within-turn` "a timeout between two unavailable reviews…" (a missing `review_timeout`), `jev-source-domain` ×2 and `npc-preparation-integration` ×1. All of them pass on the Mac at the same HEAD (21/21, 13/13), and none of them reads the carried section or `look focus=object`.

After merging `claude/integ-single-loop-20260923` at `f0d90d626` (SL-25), merge `15ae618bb`. The one conflict was `RunState` and its initialiser in `runtime/jev/hybrid-engine.ts`. Both sides are kept: SL-25's `guarded` note and SL-27's `carried` passages are separate fields of the `coc-clerk` message.

```
== ext on leehow-pc @ 15ae618bb8703deaa8b95a3ebfae21bd2c480e60: exit=0 wall=164s   (2908/2908)
== loop on leehow-pc @ 15ae618bb8703deaa8b95a3ebfae21bd2c480e60: exit=0 wall=70s    (143/143)
== py on leehow-pc @ 15ae618bb8703deaa8b95a3ebfae21bd2c480e60: exit=0 wall=383s    (1719 passed, 2 skipped)
```

Live Keeper on the merged tree (`results/sl27-merged-longgate-t{10,19}-live`, 3 runs each):

| fixture | reads per run | source lookups | model calls per run | the reads |
| --- | --- | --- | --- | --- |
| t10 | 1 / 0 / 0 | 0 | 2 / 3 / 2 | module lookup (kitchen); none; none |
| t19 | 2 / 1 / 2 | 0 | 2 / 3 / 4 | scene, object `Corbitt Diaries` (answered); module; module (`corbitt-diaries Corbitt Diaries`), scene |

The t10 source lookup stays gone on the merged tree. t19 made 5 reads against 8 before, which is inside the noise, and SL-25's destination rows are new on this tree.

**Left open.**

- The parent arm's worktree (`scratchpad/sl27-parent`, detached at `1dccf4578`) is left in place; removing worktrees is outside this ticket.
- The Keeper prompt still tells it to prefer `lookup kind=source` for a factual question (`prompts/keeper.md`, "Source reading"). The carried sentence overrides that per step, only where passages were located. A run whose prescreen located nothing about its scene (t6, t19) gets no sentence. A capsule-level statement of the module's source would cover every step. That is a prompt/capsule change and was not made here.

