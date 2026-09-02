# Module reachability ledger

> **Generated** by `scripts/gen_module_reachability_ledger.py` over
> `plugins/coc-keeper/references/starter-scenarios/the-haunting`.
> Do not hand-edit. Regenerated and compared by
> `tests/test_module_reachability_ledger.py`, so it cannot rot.
> **Spec:** [pi-coc-module-reachability-lint](../specs/pi-coc-module-reachability-lint.md) §8
> **Contract:** `coc.module-reachability-lint.v1`, schema version 1

This records what the reachability lint measured on the committed
starter, per check code, so a reader can tell a clean check from an
unmeasurable one. A zero in the findings column means one of two very
different things, and only the `measured` column separates them.

## Scope: the committed starter only

The specification's evidence base (§2) measured five scenario sets. Four
of them are compiled campaigns under `.coc/`, which is gitignored
runtime data: timestamped local imports that no fresh clone has. A
ledger that read them would regenerate differently on every machine and
fail its own drift test everywhere except the checkout that wrote it.
Those four stay in the lint's ground-truth tests, which skip when the
directory is absent. What is published here is only what every clone can
reproduce byte-for-byte: the one scenario set the repository ships.

## Summary

| | Value |
| --- | --- |
| Scenario | `the-haunting` |
| `progressive` | false |
| Scenes | 12 |
| Documents present | 5 |
| Documents absent | 0 |
| Check codes in the catalogue | 15 |
| ...measured on this scenario | 15 |
| ...`not-measured` | 0 |
| ...measured and silent | 14 |
| Findings | 1 |
| ...severity `defect` | 0 |
| ...severity `observation` | 1 |
| ...completeness `dead` | 1 |
| ...completeness `pending-materialization` | 0 |
| ...completeness `not-measured` | 0 |

Documents present: `clue-graph.json`, `module-meta.json`, `quests.json`,
`story-graph.json`, `threat-fronts.json`.

Documents absent: none.

Codes not measured: none.

## Per check code

`measured` is `no` when the document a code reads is absent from this
scenario set, or when the scenario never uses the field the code needs.
Such a code yields no findings and no pass; it is simply not evidence.

| code | severity when `dead` | measured | findings | `dead` | `pending-materialization` | `not-measured` |
| --- | --- | :-: | --: | --: | --: | --: |
| `edge-target-unknown` | defect | yes | 0 | 0 | 0 | 0 |
| `available-clue-unknown` | defect | yes | 0 | 0 | 0 | 0 |
| `clue-unplaced` | defect | yes | 0 | 0 | 0 | 0 |
| `gate-clue-unobtainable` | defect | yes | 0 | 0 | 0 | 0 |
| `quest-destination-unknown` | defect | yes | 0 | 0 | 0 | 0 |
| `front-scene-unknown` | defect | yes | 0 | 0 | 0 | 0 |
| `duplicate-record-id` | defect | yes | 0 | 0 | 0 | 0 |
| `start-scene-count` | observation | yes | 0 | 0 | 0 | 0 |
| `scene-unreachable` | observation | yes | 0 | 0 | 0 | 0 |
| `scene-terminal-undeclared` | observation | yes | 0 | 0 | 0 | 0 |
| `conclusion-behind-unreachable-scenes` | observation | yes | 0 | 0 | 0 | 0 |
| `gate-self-locks` | defect | yes | 0 | 0 | 0 | 0 |
| `conclusion-clues-share-one-scene` | observation | yes | 1 | 1 | 0 | 0 |
| `routes-not-declared` | observation | yes | 0 | 0 | 0 | 0 |
| `conclusion-without-clues` | observation | yes | 0 | 0 | 0 | 0 |

Every one of the 15 codes was measurable on this scenario set: all 5
documents the lint reads are present, and 1 of its 12 scenes declares
`is_final`, so `scene-terminal-undeclared` has a field to check. No row
above is a silent non-measurement. The column still earns its place — it is
what a progressive import will fill — but this starter does not exercise it.

## Findings

| code | severity | completeness | subject | declared | counted |
| --- | --- | --- | --- | --- | --- |
| `conclusion-clues-share-one-scene` | observation | `dead` | `corbitt-house-documentary-history` (conclusion) | `{}` | `{"clues": 3, "context_independent_routes": 1, "scene_independent_routes": 1}` |

`conclusion-clues-share-one-scene` on `corbitt-house-documentary-history`:
every clue for this conclusion is obtainable in only one scene. Related ids:
`central-library`, `clue-house-built-1835`, `clue-neighbor-lawsuit-1852`,
`clue-second-lawsuit-outcome-unrecorded`.

## Why the ModuleGraph could not have answered this

Recomputed here from the starter's own files, because the point of the
section is a contradiction between two artifacts and a copied number
would stop being a measurement the moment either one changed.

| | Value |
| --- | --- |
| `module-graph.json` nodes | 145 |
| ...relations | 322 |
| ...claims | 322 |
| Coverage domains | 10 |
| ...distinct reported states | `accepted` |
| ...reported `accepted` | 10 |
| `clue` nodes in the graph | 39 |
| ...carrying an acquisition relation | 0 |
| Acquisition relations in the graph, all subjects | 13 |
| Clues declared in `clue-graph.json` | 39 |
| ...placed in a scene's `available_clues` | 39 |
| Distinct clue ids across all `available_clues` | 39 |

Acquisition relations are the ModuleGraph contract's authored access routes,
`delivered-by`, `discoverable-at`. Every one of the 13 in this graph has a
non-`clue` subject:

- `handout`: 12
- `tome`: 1

So the graph reports all 10 coverage domains `accepted` — `causal` and
`knowledge` among them — while every one of its 39 `clue` nodes carries zero
acquisition relations. The 39 clues the module declares are nevertheless all
placed correctly, in the projected `story-graph.json`, through scene
`available_clues`. The causal placement lives entirely in the projection and
not at all in the graph.

**Coverage is a self-report about which domains an extraction reviewed.** It
is not evidence that the structure was captured. A reachability check run
against the graph would report 39 unobtainable clues on a starter that plays
correctly, which is why the lint's input is the projected ProjectionSet the
Keeper actually reads, never the graph.

The same graph holds no node of these kinds at all, which is why ending
reachability and requirement closure are out of scope rather than clean:

- `clock`: 0
- `ending`: 0
- `outcome`: 0
- `requirement`: 0

## What this measures

A clean row means one scenario set contradicted itself in no way this
catalogue can express. It does not mean the module is playable, that its
clues are findable in practice, that its pacing works, or that a Keeper
can run it. Every check here is arithmetic over ids, enums, booleans and
integers the scenario already declares; none of them reads a word of
prose, and none of them has an opinion about which clue matters.

Thresholds come only from the module's own `minimum_routes` and
`importance`. A conclusion with one acquisition route is not a defect —
a conclusion that *declares* three and provides one is, because that is
the module contradicting itself rather than the lint disagreeing with a
design. Nothing in this ledger licenses inventing a second route.

A `not-measured` row is the most important thing on the page. The lint
cannot pass a check whose document is missing or whose field the
scenario never uses, so it says so instead of scoring a silent zero as
a success. Reading such a row as "clean" is exactly the mistake the
completeness class exists to prevent, and the same holds for a
progressive skeleton: `pending-materialization` is unbuilt structure,
not a broken module.

This ledger covers one scenario set. It is not a measure of the lint's
coverage — that lives in the per-check and mutation tests — and a clean
starter says nothing about any imported campaign.
