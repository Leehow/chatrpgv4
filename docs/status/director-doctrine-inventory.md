# Director doctrine inventory (pre-DirectorGraph)

> **Status:** Read-only inventory. No code, data, or behavior was changed.
> **Date:** 2026-08-31
> **Track:** `ACTIVE_IMPLEMENTATION_TRACK=pi-coc`
> **Purpose:** establish the exact set of Director-layer tunables and vocabularies
> that a DirectorGraph would have to own, and record which of them can state a
> reason today. This file is the evidence base for
> `docs/specs/pi-coc-director-graph-runtime.md` slice D2.
> **Basis:** `claude/pi-coc-director-graph-20260831-docs` off `0.8.1a@60c1c4b4`.
>
> **Superseded for day-to-day use by** [director-doctrine-ledger.md](director-doctrine-ledger.md),
> which is generated from the built DirectorGraph and is therefore drift-proof.
> This inventory is retained as the pre-migration measurement it was: the
> estimates below (~119 tunables, 28 player-signal items) were refined during
> implementation to the exact figures the ledger reports (135 tunable values
> across 115 doctrine nodes; 34 player-signal items, because
> `_LOW_AGENCY_RECENT_CLASSES` proved to be a hand-written subset rather than a
> derivation and was migrated as its own signal group).

## Method

Every numeric literal inside a module-level function of
`plugins/coc-keeper/scripts/coc_story_director.py` was extracted by AST walk
(286 total, 130 non-trivial after dropping bare `0`/`1`). Literals were then
hand-classified into **doctrine** (a pacing/dramaturgy choice), **plumbing**
(schema versions, truncation limits, list indices) and **derived** (computed
from a cited rule). Vocabularies were extracted by exact declaration match.
Rationale was searched for in three places: an adjacent source citation
comment, the `rule-index.json` `source_note`, and the originating commit body.

No claim below rests on inference about intent; where no reason was found the
row says so.

## 1. Layer 2 — `structure-weights.json`

`plugins/coc-keeper/rulesets/coc7/rules-json/structure-weights.json`

| Item | Count |
| --- | --- |
| Structure types | 7 (`linear_acts`, `time_loop`, `branching_investigation`, `hub_sandbox`, `multi_faction`, `campaign_sequel`, `hybrid_mega`) |
| Director actions | 10 |
| Weight cells | **70** |
| Tiebreak order entries | 10 |
| **Total values** | **80** |

**Rationale status: none live.** The file's own `description` field and the
`rule-index.json` record `director.structure_weights` both point at
`docs/superpowers/specs/2026-07-05-story-director-design.md`. That path does
not exist; `docs/superpowers/specs/` is not present in the tree, and the
`source_note` has already been rewritten to redirect to the tombstone index.
The originating commit is `04643e69` (2026-07-06, *"feat: add three-layer
scoring engine (base × structure_weight × rule overrides)"*) whose body is the
subject line only.

Consequence: all 80 values are `authored-doctrine` with `origin:
unknown-legacy-tuning`. No cell can currently answer "why this number".

## 2. Layer 1 — `_base_score()` ([coc_story_director.py:1673](../../plugins/coc-keeper/scripts/coc_story_director.py))

51 numeric literals across 33 lines. Doctrine tunables:

| Action | Value(s) | Condition | Cited source |
| --- | --- | --- | --- |
| REVEAL | `0.9` / `0.75` | intent investigate / social | — |
| DEEPEN | `0.5` | scene has `dramatic_question` | — |
| PRESSURE | `0.85` | yielded scene (low-agency ≥ 2 + pressure available) | — |
| PRESSURE | `0.8` | clock near full **or** `stalled_turns >= 1` | — |
| PRESSURE | `0.2` | otherwise | — |
| PRESSURE | `2/3` | clock "near full" fraction | — |
| PRESSURE | `+0.1` / `-0.1`, caps `0.95` / `0.05` | risk posture reckless / cautious | — |
| PRESSURE | `+0.1` | `pushed_fail_pending` | **p.83-85** ✅ |
| CHARACTER | `0.7` | scene NPC has an agenda | — |
| CHOICE | `0.7`, threshold `>= 2` | ≥ 2 undiscovered clues | — |
| CUT | `1.0` | explicit move intent | — |
| CUT | `0.8` | exit condition met | — |
| CUT | `0.7` | main line complete, scene not final | — |
| CUT | `min(0.85, 0.45 + 0.15 × stalled)`, gate `>= 2` | stalled transition pressure | — |
| MONTAGE | `0.6` | intent montage | — |
| SUBSYSTEM | `0.9` | intent combat / flee / cast | — |
| RECOVER | `0.85`, gate `>= 2` | stalled turns | — |
| PAYOFF | `min(0.85, 0.15 + top × 0.12)` | structured entity overlap | — |

**24 doctrine tunables; 1 has a cited source.**

### Recorded finding — stale reasoning comment

The PAYOFF branch's own comment ([coc_story_director.py:1807](../../plugins/coc-keeper/scripts/coc_story_director.py))
justifies its scale by saying a weak match "scores ~0.27, below REVEAL's
0.55-0.85". REVEAL in the same function returns `0.9` / `0.75`. The comment
describes a REVEAL range the code no longer has, so at least one of these two
branches was retuned without updating the reasoning that justified the other.
This is recorded as evidence, not repaired here.

## 3. Layer 3 — overrides, gates and ladders

| Location | Value | Cited source |
| --- | --- | --- |
| `apply_rule_signal_overrides` | `low_agency_continue_count >= 2` + `scene_pressure_available` | — |
| `apply_rule_signal_overrides` | `stalled_turns >= 3` | — |
| `_scene_exit_pressure_directive` | `continue_count >= 2` | — |
| `_apply_fair_warning_ladder` | `lethal_chances_used >= 3` | **p.209** ✅ |
| `_compression_budget` | `max_beats` default `4`, range `2..8` | — |
| `_compression_budget` | `min_beats` default `2`, range `1..max` | — |
| `_compression_budget` | `max_minutes` default `10`, range `1..30` | — |
| `_low_agency_max_beats` | fallback `4` | — |
| `_build_pressure_moves` | gate `stalled_turns < 1`; low-agency `>= 2` | — |
| `_build_pressure_moves` | affinity rank ladder `6,5,4,3,2,1,0` over `scene_clock_refs > danger_ids > scene_ids > threat_front_ids > scene_tags_any > faction_ids > fallback` | — |
| `_clue_route_priority` | default `0.5` | — |

**~17 further tunables; 1 has a cited source.**

## 4. Vocabularies

In code — `coc_story_director.py`:

| Declaration | Items |
| --- | --- |
| `ACTIONS` | 10 |
| `_LOW_AGENCY_TAGS` | 11 |
| `_LOW_AGENCY_RECENT_CLASSES` (derived subset) | 6 |
| `_ROUTINE_PROGRESS_TAGS` | 8 |
| `_DRAMATIC_PROGRESS_ADVANCE_UNTIL` | 6 |
| `_NON_BLOCKING_RULE_REQUEST_KINDS` | 1 |
| `_SOCIAL_REVEAL_DELIVERY_KINDS` | 2 |
| **Total** | **44** |

In data:

| File | Items |
| --- | --- |
| `structure-weights.json` | 7 structure types, 10 actions |
| `storylet-library.json` | **77** storylets, 4 conflict levels, 4 selection-contract clauses |
| `time-costs.json` | **16** categories |

`storylet-library.json` is the best-shaped part of the layer: each storylet
already carries `family_id`, `trope_id`, `conflict_score`, `base_weight`,
`epistemic_functions`, `question_layers`, `dramatic_function`,
`structure_affinity`, `eligible_scene_types`, `horror_stage` and `requires`.
It is a typed node table in all but name and should migrate first.

### Recorded finding — index drift

`rules-json/rule-index.json` disagrees with the data it indexes:

| Record | Index claims | Actual |
| --- | --- | --- |
| `director.storylet_library` | `storylet_count: 64` | **77** |
| `core.time.cost_categories` | `category_count: 15` | **16** |

Both are stale counts in the index, not missing data. Recorded, not repaired.

## 5. What *is* source-bound today

The Director's **craft directives** — as opposed to its scoring — do carry
rulebook citations in comments:

| Directive | Citation |
| --- | --- |
| Idea Roll signpost ladder | p.199 |
| Pushed-roll failure → PRESSURE nudge | p.83-85 |
| Fair Warning lethal ladder | p.209 |
| Personal-horror hooks | p.193-194 |
| Delusion seeding during underlying insanity | p.162-163 |
| Scare-craft expectation-break tropes | p.207-211 |
| Monster presentation contract | p.280-282 |
| Mythos bleak tone injection | p.212 |
| HP / Sanity / Credit Rating signal tiers (`coc_rule_signals.py`) | p.119-120, p.154-158, p.45-47 |

These are `rule-derived` and can bind to real pages under the same discipline
the RuleGraph already uses. They are comments today, not machine edges.

## 6. Test pinning

Director tests total 9827 lines across five files. They assert **outcomes**
(`plan["scene_action"] == "CUT"`, `reason_code`, `time_advance.category`,
`mode`), not scores. Sampling `test_story_director.py` for the doctrine
literals: `0.85`, `0.8`, `0.7`, `0.45`, `0.15`, `0.12`, `0.6` appear **zero**
times; no assertion references `structure_weights` or a weight cell.

Two consequences for the migration:

1. **D1/D2 are safe.** Moving these values into a graph without changing them
   cannot break an assertion, because no assertion reads them.
2. **There is no regression net on the values themselves.** Nothing would fail
   if a weight silently changed. This is exactly why slice D4 must capture a
   DebugExperiment behavioral baseline *before* D5 touches any number.

## 7. Verdict

| Evidence class | Count | Notes |
| --- | --- | --- |
| `authored-doctrine`, `origin: unknown-legacy-tuning` | **~119** (80 weights + 24 Layer-1 + ~15 Layer-3) | no citation, no live spec, not test-pinned |
| `rule-derived` (citable to a page) | 2 scoring tunables + 9 craft directives | comments only today |
| `module-derived` | storylet `structure_affinity`, scene exit conditions, threat clocks | already structured |
| Vocabulary items to migrate | 44 in code + 77 storylets + 16 time categories + 7 structure types | mostly mechanical |

**The headline number: roughly 119 of ~123 Director tunables cannot state a
reason today, and none of them is protected by a test.**

That is the finding that justifies slice D2. It also sets D2's honest
deliverable: not "explain 119 numbers", but "record which 119 numbers nobody
can explain", so that D5 can retire them one falsifiable experiment at a time.

## Boundary

This inventory covers the Director's **decision** surface
(`coc_story_director.py`, `coc_director_strategies.py`, and the three data
files). It deliberately does not inventory `coc_director_apply.py` (4346
lines): that file owns receipts, NPC agency persistence, clue-gate disclosure
and state commits. Those are execution and state, not doctrine, and are out of
scope for DirectorGraph.
