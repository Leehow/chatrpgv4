# Pi-Coc TextGraph specification

> **Status:** T0 and T1 implemented on `claude/pi-coc-text-graph-20260901`.
> T2–T5 are specified and **not** authorized. T1 is behaviour-preserving:
> every migrated vocabulary is bit-identical and the model-visible contract
> archive rebuilds byte-identical. See the Implementation log.
> **ID:** `pi-coc-text-graph-runtime`
> **Track:** `ACTIVE_IMPLEMENTATION_TRACK=pi-coc`; Codex-host implementation,
> adapters, prompts, launchers, tests, and documentation remain off-limits.
> **Scope owner:** the settled-output presentation surface inside
> `plugins/coc-keeper/`.
> **Last updated:** 2026-09-01 (T1 implementation pass; see the Implementation log)
> **Depends on:** [ADR 0003 system ontology composition registry](../adr/0003-system-ontology-composition-registry.md),
> [DirectorGraph](pi-coc-director-graph-runtime.md) (structural template and
> implementation log), [`docs/ruleset-contract.md`](../ruleset-contract.md).
> **Evidence base:** [Text-layer obligation inventory](../status/text-layer-obligation-inventory.md)
> — measured on `0.8.1a@65ca572b`, re-verified unchanged on `0.8.1a@3fff1f8a`.

The words MUST, MUST NOT, SHOULD, and MAY below are acceptance requirements.

---

## 1. User job, success condition, and hollow delivery

The user wants the layer that decides **what the player must be told** to be a
source-controlled artifact bound to settled state, and wants the layer that
decides **whether the prose is any good** to stop being a hardcoded Chinese
phrase table that silently rewrites the Keeper's sentences.

Those are two different jobs, and today they are one 519-line module plus a
4526-line finalizer. The first job is structural and is already being done
correctly, in code, invisibly. The second is semantic and is being done wrongly,
by regex, in one language, unreachably.

Success looks like:

- every obligation kind, coverage vocabulary, segment type and review rule is a
  node in one validated artifact rather than a literal in code or a copy in a
  TypeScript projection;
- the obligation plane is **derived** — computed from settled receipts and
  RuleGraph `effect` nodes — so it needs no source corpus, no independent
  review, and no new model-visible operation;
- the craft plane carries `rulebook-source` evidence where a Keeper-craft page
  genuinely says it and `authored-house-doctrine` otherwise, with the same three
  accountability fields DirectorGraph requires;
- **no regex, phrase table, substitution table or style score survives** in the
  text layer, and the deleted matchers are replaced by semantic ids the KP
  reasons about;
- a Keeper running an English table gets the same obligations as one running a
  Chinese table, because structured obligations have no language;
- `graph:text:production` stops being `absent-production-artifact` in the system
  ontology registry, and its `renders-settled-output` edges to RuleGraph effects
  are machine-validated;
- the Keeper's turn-facing surface does not change at all — 147 operations
  before, 147 after.

Hollow delivery includes:

- **moving the eight regexes into JSON.** A phrase table in an artifact is still
  a phrase table; §6 law 2 forbids it in either location;
- **declaring the layer reached because `turn.finalize` is called.** DirectorGraph
  passed every gate it declared and was then found never to be invoked. The
  inverse trap applies here: the operations are reached (§1.3 of the inventory),
  but a slice is complete only when the *graph's values* are what those
  operations read. A test that the operation runs is not a test that the graph
  is read;
- **scanning only Python.** The obligation namespace has four live copies in
  `pi/lib/tool-contract-projection.ts`. A Python-only residue gate would report
  a clean migration over four surviving duplicates;
- **letting TextGraph judge prose.** Coverage verification is presence and
  verbatim binding. Whether a sentence is good stays a semantic judgment;
- **adding a model-visible operation.** The surface is 147 and stays 147;
- **inventing rulebook citations** for craft directives whose origin is a past
  playtest or an unrecorded decision. `origin: unknown-legacy-tuning` is the
  honest answer and is an acceptable one;
- **copying a record body the graph only names** — the `storylet` mistake from
  DirectorGraph D1, which produced a 464KB artifact and a second copy of two
  package tables;
- **retuning any value during T1–T4**, which would destroy the baseline;
- **claiming completeness while `coc_narration_style.py` still holds a matcher.**

### 1.1 Scope

| In scope | Out of scope |
| --- | --- |
| Obligation kinds, coverage vocabulary, segment types, realization and input-handling values, agency claim types | Rules settlement, dice, state transactions |
| Review-rule and craft-directive vocabulary | Whether any given prose is good |
| `renders-settled-output` links to RuleGraph `effect` nodes | Any authority over what the effect *is* |
| Deleting the eight regexes, two phrase tables and the substitution table | The Director's horror-profile weights (§1.2) |
| Registry promotion of `graph:text:production` | New model-visible operations |
| The `_narration_budget` ladder and the ~13 other text tunables | Retuning any of them before T5 |
| Recording unexplained values as unexplained | Inventing explanations |

### 1.2 One boundary stated explicitly, not by omission

`_HORROR_AXES`, `_HORROR_STAGE_BASE`, `_HORROR_TAG_WEIGHTS` and
`build_horror_profile` live in `coc_narration_style.py` but are consumed only by
`coc_story_director.py:4419`, inside the `director.advise` payload. They are
15 pacing-doctrine weights and they belong to DirectorGraph.

They are named here because DirectorGraph's correction 6 was that *"out of
scope" was hiding duplicate copies*: excluding a thing from migration is not the
same as excluding it from the residue gate. The T1 gate MUST scan them and MUST
carry an explicit, reasoned exclusion for them, never a silent omission.

---

## 2. Why this graph is not like the other three

| Graph | Evidence is | A defect looks like |
| --- | --- | --- |
| ModuleGraph | module PDF pages | wrong or missing extraction |
| RuleGraph | rulebook pages | disagreement with the book |
| DirectorGraph | there is no book | nobody can say why the number is that number |
| **TextGraph** | **the settled receipt itself** | **something settled and the player was never told** |

This is the cheapest of the four, and the reason is worth stating precisely.

DirectorGraph had to invent an accountability regime because pacing doctrine has
no source. RuleGraph had to build a rulebook corpus, an extraction pipeline and
an independent review lane because rules fidelity has a source and the source is
2000 pages of PDF. RuleGraph stalled on exactly that cost.

**TextGraph's obligation plane needs neither.** Its evidence is the settled
receipt that already exists in `logs/`, produced by the rules layer, this turn.
`_build_obligations` already derives every obligation from those receipts and
authors none of them. The graph is not a new source of truth; it is a
declaration of the vocabulary and derivation laws that code applies today
implicitly.

The craft plane does carry the DirectorGraph-style accountability burden — but
it is small (§5.2) and it is the half that mostly gets *deleted*.

### 2.1 The reachability argument, stated once

DirectorGraph's implementation log ends with an open question: is that layer
reached in play? It is not — 2 calls in 3703. Reachability is the check the
DirectorGraph work performed last.

For TextGraph it was performed first, and it is settled:

| | corpus (67 runs, 3703 canonical calls) |
| --- | --- |
| `turn.finalize` | 321 — **rank 1 of 147** |
| `turn.output_context` | 286 — **rank 2 of 147** |
| `narration.review` | 200 — **rank 7 of 147** |
| text layer total | **807 (21.8%)** |
| `director.advise` + `storylets.suggest` | **2 (0.05%)** |

Commands and per-session figures are in the inventory §1. The text layer is
reached roughly 400× more often than the layer whose graph is already built.

### 2.2 The evidence that the two planes are really different

The same operation, `narration.review`, contains both planes today. Across 293
recorded reviews (inventory §2.3):

| Half | Shape | Result |
| --- | --- | --- |
| `state_authority_review` | structured claims bound to a settled `source_effect_id` | 281 dispositions; **58 claims, 58 of 58 correctly bound** |
| `findings` | free prose-quality rule vocabulary | **0 findings, ever, of any rule id** |

The structured half works on every turn. The textual half has never fired once
— including `over_length`, which the code raises automatically. That is not a
prompt problem to be tuned; it is the design telling us which plane carries
weight.

---

## 3. Binding design decisions

1. **TextGraph is data, not control flow.** `_build_obligations`,
   `_build_sanity_bout_obligations`, `validate_coverage` and
   `build_output_context` keep their current implementations and read their
   vocabularies and derivation laws from the graph. No traversal produces an
   obligation.
2. **The authority plane is `presentation`,** as ADR 0003 already fixed. The
   graph MUST NOT gate play. Its only outward relation is
   `renders-settled-output`, `authority_effect: presentation-only`.
3. **Two planes and one law:** obligation (§4.1), craft (§4.2), and §6 law 2
   above both.
4. **Three evidence classes** (§5), with `authored-house-doctrine` carrying
   mandatory `rationale`, `origin` and `falsifiable_by`.
5. **No new model-visible operation.** `turn.output_context` projects,
   `turn.finalize` verifies coverage, `narration.review` takes the rule
   vocabulary. All three keep their exact current schemas apart from the
   additive publication in T4 §8. Operation count stays **147**.
6. **No prose is pattern-matched, anywhere, ever.** §6 law 2. This is the whole
   point and it is not negotiable for convenience.
7. **Migration never retunes.** T1–T4 MUST produce bit-identical behavior for
   every existing turn. Only T5 changes a value, and only with a recorded
   experiment.
8. **Storage is ordinary validated JSON.** No graph database, no embedding
   store, no style-scoring DSL.
9. **Vocabulary nodes carry identity and order, never the body of a record they
   name.** RuleGraph effect nodes stay in `rule-graph.json`; TextGraph
   references them by semantic id through `renders-settled-output`. A
   `no_body_copy_law` test MUST enforce this from T1, because DirectorGraph
   learned it the expensive way.
10. **The residue gate is cross-language and covers the whole text surface from
    T1**, including files T1 does not migrate. Scope of migration and scope of
    scanning are different things (§1.2, §8 T1).

---

## 4. Graph shape

Artifact: `plugins/coc-keeper/references/text-graph.json`
Contract: `plugins/coc-keeper/references/text-graph-contract-v1.json`
Contract id: `coc.text-graph-contract.v1`

### 4.1 Obligation plane — what MUST be narrated

Derived, never authored. Evidence class `settled-effect-derived` for every node
here.

| `node_kind` | Migrates from | Count | Note |
| --- | --- | ---: | --- |
| `obligation-kind` | `roll:` / `first-impression:` / `sanity_bout:` id grammars | 3 | `sanity_bout` has fired 0 times in 506 finalizations; it stays, and the fact is recorded |
| `coverage-field` | `COVERAGE_FIELDS` | 9 | closed schema; unknown field is already a hard error |
| `realization-mode` | `REALIZATION_VALUES` | 2 | |
| `player-input-handling` | `PLAYER_INPUT_HANDLING_VALUES` | 3 | |
| `segment-type` | `MECHANIC_SEGMENT_TYPES` **plus `fiction`** | **5** | see the ordinal law below |
| `agency-claim-type` | `AGENCY_CLAIM_TYPES` (6 voluntary + 2) | 8 | |
| `roll-visibility-class` | `PLAYER_FACING_ROLL_VISIBILITIES` + `SUPERSEDED_ROLL_VISIBILITIES` | 6 | |
| `substantive-effect-status` | `applied` / `missing` / `not_required` | 3 | |

**Ordinal law.** Declaration order is behaviourally observable in four places
and node ids sort alphabetically, so every node above MUST carry an explicit
`ordinal`:

1. `SEGMENT_TYPE_ORDER` maps four segment types to 0–3 explicitly;
2. `fiction` is not in that map, yet `coc_turn_finalization.py:563` requires
   `segments[0].segment_type == "fiction"` — a fifth type with an implicit
   ordinal of −1;
3. `_narration_budget` is a first-match-wins ladder (§4.2);
4. `_CRISIS_RENDER_REQUIRED_SLOTS` is emitted as `render_sequence` in
   declaration order.

This is DirectorGraph correction 4, which silently reordered a scoring loop.
Here it would silently reorder the player-visible output.

### 4.2 Craft plane — how it should be rendered

| `node_kind` | Purpose | Migrates from | Count |
| --- | --- | --- | ---: |
| `review-rule` | one semantic id the KP may cite in `narration.review.findings` | `allowed_rule_ids` + the six rule ids the deleted regexes emitted | 4 enforced + up to 6 promoted from §8 T4 |
| `craft-directive` | advisory Keeper-craft guidance | `required_rules` (6), the `rewrite_directive` prose of each deleted matcher, `repetition_policy`, `action_uptake_review`, `final_output_pass` | ~20 |
| `render-slot` | one named crisis-frame slot | `_CRISIS_RENDER_REQUIRED_SLOTS` | 7, ordered |
| `render-prohibition` | a named thing player-visible text must not contain | `_PLAYER_VISIBLE_MUST_NOT` | 3 |
| `style-axis` | an `avoid` / `prefer` register id | the zh and non-zh lists | 5 + 4, with an applicability field for the zh-only `translationese` |
| `narration-budget-mode` | one rung of the length ladder | `_narration_budget` | 4, ordered |
| `text-threshold` | a named numeric gate | §5.2 | ~13 |

### 4.3 Relations

Internal: `part-of`, `orders`, `constrains`, `advises`, `applies-to-language`,
`triggered-by`, `supersedes`.

Cross-graph: **only** `renders-settled-output`, per ADR 0003 —
`text → rule.effect | live-state.live-state-fact`,
`authority_effect: presentation-only`. TextGraph MUST NOT emit `grounded-by`,
`uses-rule`, `invokes-capability`, or any other relation kind.

---

## 5. Evidence classes

Every node MUST declare exactly one.

| Class | Meaning | Required fields |
| --- | --- | --- |
| `settled-effect-derived` | the value follows from a settled receipt or a RuleGraph effect; the graph declares the derivation law, not the value | a `renders-settled-output` edge to a real `rule.effect` / `live-state.live-state-fact`, **or** a named receipt field that produces it |
| `rulebook-source` | a Keeper-craft page genuinely says this | `evidence_span_ids` bound to real pages, exactly as RuleGraph binds its rules |
| `authored-house-doctrine` | a design claim this project makes | `rationale`, `origin`, `falsifiable_by` |

`authored-house-doctrine` field semantics are DirectorGraph's, unchanged:
`rationale` is why this value in one sentence; `origin` is a commit, a playtest
finding, a retired spec, or the literal token `unknown-legacy-tuning` — guessing
is prohibited; `falsifiable_by` names the experiment that could refute it.

### 5.1 Expected starting distribution

The obligation plane (§4.1, ~39 nodes) enters almost entirely as
`settled-effect-derived`. This is the affordability claim, and it is the reason
TextGraph needs no source corpus.

The craft plane is where accountability bites. **A craft directive is
`rulebook-source` only when a Keeper-craft page actually says it.** The
inventory found no page citation anywhere in `coc_narration_style.py` — unlike
`coc_story_director.py`, whose craft directives carry nine page comments. T4
MUST NOT manufacture citations to make the distribution look better.

### 5.2 The text-layer tunables, in full

The text layer is not a tuning problem: 66 non-trivial numeric literals across
10,915 lines, 15 of which are Director-owned (inventory §5). The genuine
`authored-house-doctrine` set is small enough to list here:

| Value | Where | Note |
| --- | --- | --- |
| `_narration_budget` — 4 modes × (`max_chars`, `max_paragraphs`) = 8 numbers, 8 trigger event ids, first-match-wins | `coc_operation_turn_output.py:390` | the only real ladder; needs an ordinal |
| `over_length` factor `2` | `coc_operation_turn_output.py:844` **and** `:1260` | **already duplicated within one file** — a live instance of DirectorGraph correction 6, at a two-line distance |
| `_repair_excerpt` similarity threshold `0.5` | `coc_turn_finalization.py:3096` | governs whether a near-miss excerpt is silently repaired |
| `_repair_excerpt` minimum match size `8` | `coc_turn_finalization.py:3100` | |
| `MAX_ACCEPTED_REVISION` = `2` | `coc_turn_finalization.py` | |
| recent-event window `12` | `coc_operation_turn_output.py:836` **and** `:1252` | feeds budget derivation; **also duplicated at two sites** |

**Fraction law.** No text-layer value is currently computed as `a * n / d`, so
DirectorGraph correction 5 has no instance to fix here. The law is carried
forward anyway: any future ratio MUST be stored as `[numerator, denominator]`
and never as a quotient. The `2×` over-length factor is an integer multiplier
and is stored as the integer `2`.

---

## 6. Authority laws

These MUST appear verbatim in the contract's `authority_laws`.

1. TextGraph is presentation-only. It never gates, blocks, reorders or vetoes a
   player action, a Keeper choice, a scene transition, or a rules settlement.
   It never mutates state.
2. **TextGraph never pattern-matches player or Keeper prose.** No regular
   expression, phrase list, substitution table, keyword set, or style score may
   exist in this layer or in its artifact. The graph computes obligations from
   settled state and hands the model a vocabulary of constraint and review-rule
   semantic ids. Whether prose is good is a semantic judgment that belongs to
   the Keeper.
3. TextGraph never rewrites Keeper-authored text. It may declare an obligation
   uncovered and it may carry an advisory finding; it may not substitute words.
4. TextGraph supplies data to the existing finalization implementation. It is
   never traversed to produce an obligation, a coverage decision, or an output,
   and no universal graph interpreter may be built over it.
5. Coverage verification is presence, closed-vocabulary membership, and verbatim
   binding. It is never a prose-quality judgment.
6. Obligations are derived from settled receipts and RuleGraph effects. TextGraph
   authors no obligation and invents no effect.
7. Absence is not prohibition. A beat, a register, or a craft directive not
   present in the graph is not thereby forbidden to the Keeper.
8. TextGraph is language-independent. An obligation MUST NOT depend on
   `play_language`, and no node may be reachable in one language only. A craft
   directive MAY declare language applicability; an obligation may not.

---

## 7. Runtime seam

```text
TextRuntime.vocabulary()            -> obligation_kinds, coverage_fields,
                                       realization_modes, player_input_handling,
                                       segment_types (ordered),
                                       agency_claim_types,
                                       roll_visibility_classes
TextRuntime.craft(language)         -> review_rules, craft_directives,
                                       render_slots (ordered),
                                       render_prohibitions, style_axes,
                                       budget_modes (ordered), thresholds
```

`_build_obligations`, `_build_sanity_bout_obligations`, `validate_coverage`,
`_narration_budget` and the `allowed_rule_ids` check read named values from
these instead of literals. Their control flow does not change.

Failure semantics: a missing or invalid TextGraph MUST fail closed at load with
a host-internal finding. It MUST NOT silently fall back to embedded literals,
because a silent fallback reintroduces exactly the untracked duplicates this
specification exists to eliminate — and because `turn.finalize` is the product's
most-called operation, a silent fallback there would be invisible and universal.

---

## 8. Implementation slices

Each slice requires separate authorization. **T0 is complete; T1 is not
authorized.**

### T0 — this specification
Deliverables: this document and
[the text-layer obligation inventory](../status/text-layer-obligation-inventory.md).
Gate: reviewed by the user; no conflict with ADR 0003 authority laws; every
figure carries the command that produced it.

**T0 outcome:** the brief's structural claims all hold; four of its figures did
not reproduce and are corrected in the inventory (§1.2, §4.1, §7 there). The
most consequential correction is favourable: the production RuleGraph carries
**23** source-bound `effect` nodes with `emits` relations, not 3.

### T1 — contract, compiler, vocabulary plane, whole-surface residue gate

Deliverables: `text-graph-contract-v1.json`; `coc_text_graph.py` with
`prepare` / `accept` / `build` mirroring `coc_rule_graph.py`; the eight
obligation-plane node kinds populated (~39 nodes) with explicit ordinals; code
reads its vocabulary from the graph; registry flips `graph:text:production` to
`production-artifact` with coverage `no-proven-instance`.

Gates:

1. compiler round-trip is byte-stable;
2. the text-layer tests pass **with no assertion edited** —
   `tests/test_turn_finalization.py`,
   `test_turn_finalization_vertical.py`,
   `test_finalize_obligation_binding.py`,
   `test_toolbox_turn_output.py`,
   `test_mcp_wire_output_context.py`,
   `test_narration_style.py`,
   `test_narration_contract.py`,
   `test_narration_budget.py` —
   verified through
   `scripts/verify_against_baseline.py 0.8.1a@65ca572b <targets>`, never bare
   pytest, because the suite carries ~140 pre-existing failures and an
   already-red contract test absorbs new violations silently.
   Substituting bare pytest is a gate failure, not a workaround. (The tool
   was missing from `0.8.1a@65ca572b`; it landed in `3fff1f8a`, which this
   branch merged before starting T1.);
3. `coc_system_ontology.py` validates clean with `text` promoted;
4. `no_body_copy_law` — no TextGraph node contains the body of a RuleGraph
   effect, a receipt, or a coverage row it merely names; artifact size is
   asserted with an upper bound;
5. **the residue gate covers the whole text surface, in every language, from
   this slice.** Not the migrated functions — the surface. It MUST scan at
   minimum:

   | Path | Why |
   | --- | --- |
   | `plugins/coc-keeper/scripts/coc_turn_finalization.py` | owner |
   | `plugins/coc-keeper/scripts/coc_operation_turn_output.py` | owner |
   | `plugins/coc-keeper/scripts/coc_narration_style.py` | owner |
   | `plugins/coc-keeper/scripts/coc_narration_contract.py` | not migrated in T1 |
   | `plugins/coc-keeper/scripts/coc_turn_manifest.py` | not migrated |
   | `plugins/coc-keeper/scripts/coc_state_authority.py` | not migrated |
   | `plugins/coc-keeper/scripts/coc_live_turn_runner.py` | not migrated |
   | `plugins/coc-keeper/scripts/coc_npc_state.py` | holds a `first-impression:` copy |
   | **`plugins/coc-keeper/pi/lib/tool-contract-projection.ts`** | **holds four copies, in TypeScript** |
   | `plugins/coc-keeper/pi/prompts/host-system-play.md` | model-facing copy |
   | `plugins/coc-keeper/skills/coc-keeper-play/**/*.md` | Skill-facing copies |
   | `plugins/coc-keeper/references/mcp-operation-contracts.json` | contract copy |
   | `plugins/coc-keeper/skills/coc-export-battle-report/scripts/export_battle_report.py` | parses the namespaces |

   The gate MUST classify every hit as *migrated*, *reads-from-graph*, or
   *explicitly-excluded-with-a-reason*. A silent omission is a gate failure.
   `build_horror_profile` and its 15 weights are the reference case for
   *explicitly-excluded-with-a-reason* (§1.2);
6. no behavior change; 147 operations before and after.

### T2 — obligation derivation reads the graph

Deliverables: `_build_obligations`, `_build_sanity_bout_obligations`,
`validate_coverage` and `build_output_context` take their id grammars, closed
vocabularies and ordering laws from `TextRuntime.vocabulary()`;
`turn.output_context` projects graph-derived obligation ids.

Gates:

1. every value is **bit-identical** to the value it replaced;
2. no finalization test assertion is edited;
3. a replay gate: re-deriving obligations over the 506 preserved finalization
   records reproduces all 418 coverage rows, byte-for-byte, including the
   observed namespace split (`roll` 370, `first-impression` 48) and the four
   observed segment types;
4. the `fiction` segment type and its `segments[0]` ordering law are represented
   as graph data, not as a bare string at eight sites;
5. the residue gate from T1 still passes over the *full* surface.

### T3 — grounding plane

Deliverables: `renders-settled-output` edges from obligation kinds and segment
types to the RuleGraph `effect` nodes they render; registry references and
relations; coverage upgraded to `instance-linked`.

Gates:

1. ontology validator clean; a dangling reference fails closed;
2. every edge target is a real `rule.effect` or a registered
   `live-state.live-state-fact` — the 23 available effects are enumerated in
   inventory §7;
3. no edge kind other than `renders-settled-output` appears anywhere in the
   artifact;
4. the one `keeper-only` effect (`effect:coc7:push-luck:luck-spend-mutate`) is
   handled without leaking it into a player-visible obligation.

### T4 — craft plane, and the deletion

This is the slice that pays the user back. Deliverables: `review-rule`,
`craft-directive`, `render-slot`, `render-prohibition`, `style-axis`,
`narration-budget-mode` and `text-threshold` nodes; publication of the review
vocabulary to the model; and the deletion.

Deleted outright, replaced by nothing:

- `_ZH_FINAL_REWRITE_REPLACEMENTS` (13 pairs, 6 of them fragments of one
  verbatim playtest sentence) and the two `re.sub` cleanups that only run inside
  it;
- `_UNNATURAL_SPATIAL_PHRASES` (2, same sentence);
- `audit_final_text` and `append_narration_audit_records` — zero callers
  anywhere, including tests; zero `narration-audit.jsonl` files in 67 runs.

Deleted and replaced by a `review-rule` semantic id plus its existing
`rewrite_directive` as craft prose: all **eight** `re.compile` objects,
`_AI_SUMMARY_PHRASES` (11), `_EXPLANATION_PHRASES` (4), `_INNER_STATE_TERMS`
(11) and `_ABSTRACT_ACTIONS` (7) — the last two exist only to interpolate two
of the regexes and have no other reader.

Gates:

1. **`grep -c 're\.compile' plugins/coc-keeper/scripts/coc_narration_style.py`
   returns 0**, and no phrase list, substitution table or keyword set remains in
   the text layer or in `text-graph.json`;
2. the six rule ids the deleted matchers emitted survive as `review-rule` nodes;
   none is lost;
3. **the review vocabulary is published.** Today `semantic_repetition`,
   `scope_overreach` and `over_length` are enforced by `allowed_rule_ids` and
   appear nowhere in the model-visible contract — `findings` is a bare
   `{"type": "array"}`. T4 MUST add the closed `items` schema with the rule-id
   enum, sourced from the graph. This is an additive schema fix inside an
   existing operation; it MUST NOT change the operation count, which stays 147;
4. every `authored-house-doctrine` node has all three accountability fields
   present and non-empty; no `rulebook-source` node cites a page that does not
   exist;
5. no value is retuned. `_narration_budget`'s eight numbers move unchanged;
6. the residue gate passes over the full surface, in both languages.

### T5 — language independence, then the accountable practice

Deliverables: proof that an English table gets the same obligations; and the
first falsifiable craft change.

Gates:

1. **the language gate.** Two `pi-coc --mode rpc` sessions over the same
   settled checkpoint, one `zh-Hans` and one `en`, MUST produce identical
   obligation ids, identical coverage requirements and identical segment types.
   Today the equivalent English input produces zero findings and
   `deterministic_guard: "unavailable"` (inventory §4.2); after T4 the
   structural half must be language-blind. Craft directives may legitimately
   differ by language, and the diff MUST show exactly which ones and why;
2. real `pi-coc` play per the AGENTS.md playtest method — live KP, one player
   reply at a time. No batch settle, no synthetic turns, no scripted player.
   A fake-KP shortcut invalidates this gate outright;
3. one craft value per experiment, with the outcome recorded whether it supports
   or refutes the change;
4. `narration.review.findings` is measured again. It has fired **0 times in 293
   reviews**. If publishing the vocabulary (T4 gate 3) does not move that
   number, the honest conclusion is that three of the four rule ids should be
   retired, not that the KP needs more prompting. **Recording that outcome is a
   pass, not a failure.**

T5 is deliberately open-ended. TextGraph is complete when T1–T4 land; T5 is the
practice the artifact exists to enable.

---

## 9. Validation matrix

| Area | Check |
| --- | --- |
| Contract | closed schema; unknown fields rejected |
| Compiler | `prepare` / `accept` / `build` round-trip byte-stable |
| Identity | T1–T4 behavior bit-identical to the `0.8.1a@65ca572b` baseline, verified via `scripts/verify_against_baseline.py`, never bare pytest |
| Replay | 418 preserved coverage rows re-derive byte-for-byte |
| No matcher | zero `re.compile`, phrase lists, substitution tables or style scores in the layer or the artifact |
| No body copy | no node contains a RuleGraph effect body, a receipt, or a coverage row |
| Ordinal | every order-observable vocabulary carries an explicit `ordinal` |
| Accountability | no `authored-house-doctrine` node missing a required field |
| Residue | cross-language gate over the full surface; every hit classified |
| Authority | no relation kind other than `renders-settled-output`; no target outside the ADR 0003 allowed kinds |
| Registry | `coc_system_ontology.py` clean with `text` promoted |
| Surface | operation count is 147 before and after every slice |
| Language | identical obligations in a `zh-Hans` and an `en` session |

---

## 10. Known findings carried in from the inventory

Recorded, not repaired by this specification.

1. **The commissioning brief's session figures do not reproduce.** The cited
   evidence directory holds 45 canonical toolbox calls (67 host tool
   executions), not 317. The structural claim — text layer largest, Director
   zero — holds at 40.0% and 0.0%, and is confirmed corpus-wide.
2. **The production RuleGraph has 23 effect nodes, not 3.** The brief's figure
   was correct at `0.8.1a@60c1c4b4`; 80 commits of family work later there are
   23 effects with 23 `emits` relations across six families, each carrying
   `evidence_span_ids` and a `visibility` field. The obligation plane is far
   better supplied than assumed.
3. **`_ZH_FINAL_REWRITE_REPLACEMENTS` has 13 entries, not 25**, and three tables
   were missing from the brief's census of eight (`_AI_SUMMARY_PHRASES` 11,
   `_HORROR_STAGE_BASE` 4/10, `_HORROR_TAG_WEIGHTS` 5/5, plus
   `_EXPOSITORY_CHOICE_SUMMARY_RES` 4 regexes).
4. **The style module's regex engine has no production reach on the pi-coc
   path.** It runs only under `runtime/adapters/debug`, and no
   `narration-audit.jsonl` exists in any of the 67 preserved runs. Its
   declarative half reaches the KP only through `narration.brief`, called 2
   times in 3703.
5. **When it does run, it silently rewrites Keeper prose** from a table seeded
   by one White War playtest sentence. Demonstrated with a command in inventory
   §4.2.
6. **Three of the four review rule ids are enforced but never published.**
   `findings` is declared as a bare array with no `items` and no enum; only
   `agency_violation` appears in the model-visible contract. Zero findings in
   293 reviews is the expected consequence. T4 gate 3 fixes it.
7. **The obligation namespace has copies in seven places outside its owner**,
   four of them in an 8138-line TypeScript projection a Python-only gate cannot
   see. This is DirectorGraph correction 6 found *before* scope was declared
   rather than after.
8. **`over_length`'s `2×` factor is already duplicated** at
   `coc_operation_turn_output.py:844` and `:1260` — the same defect at a
   two-line distance.
9. **`fiction` is a fifth segment type outside `MECHANIC_SEGMENT_TYPES`**,
   spliced in at eight sites, the most common type in play (1746 of 2219
   segments), and governed by a separate ordering law at line 563.
10. **`sanity_bout:` obligations and `concealed_no_player_visible_beat`
    realizations have never occurred** in 506 preserved finalizations. Both stay
    in the vocabulary; the fact is recorded so that T5 can ask whether they are
    unreachable or merely rare.
11. **The system ontology registry's `module` coverage row is stale**, still
    describing "the current production healing-only RuleGraph" beside a `rule`
    row that correctly reports ten families. A shared file, outside this slice.
12. **The baseline verification tool was not on this branch's base.**
    ~~`scripts/verify_against_baseline.py` and
    `docs/repository-health/verifying-against-a-baseline.md` exist only on
    `claude/pi-coc-director-graph-20260831-docs`.~~ **Resolved.** That branch
    landed; `0.8.1a@3fff1f8a` carries both, and this branch merged it before
    T1. Re-measurement after the merge confirmed every inventory figure
    unchanged, including the 23 RuleGraph effect nodes and the 147 operations.

---

## Implementation log

What the slices actually produced, including where this specification was wrong.

| Slice | Outcome |
| --- | --- |
| T0 | This document plus the inventory. Four brief figures corrected. |
| T1 | Contract, compiler, 39 obligation-plane nodes, registry promotion, and the cross-language residue gate. Behaviour unchanged; the model-visible contract archive rebuilds byte-identical. |
| T2–T5 | Not started. |

### T1, as built

- `plugins/coc-keeper/references/text-graph-contract-v1.json` — closed contract,
  eight authority laws verbatim from §6, plus `ordinal_law`, `no_body_copy_law`,
  `residue_law`, `surface_law`, `empty_relations_law` and
  `expected_node_counts_law`.
- `plugins/coc-keeper/scripts/coc_text_graph.py` — `prepare` / `accept` /
  `build` mirroring `coc_rule_graph.py` and `coc_director_graph.py`.
- `plugins/coc-keeper/references/text-graph.json` — 39 nodes, 19KB.
- `plugins/coc-keeper/scripts/coc_text_runtime.py` — the §7 seam, fail-closed.
- `coc_turn_finalization.py` — nine module-level frozensets now read from the
  graph; every one verified bit-identical and same-typed.
- The registry flips `graph:text:production` to `production-artifact`, coverage
  `production-linked` / `no-proven-instance`, and
  `system-ontology-contract-v1.json` gains `node_ontology_contract:
  "coc.text-graph.v1"` for the `text` kind. The ontology validator is clean.
- `tests/test_text_graph.py` — 29 tests including the gate.

### Corrections this specification needed

1. **The residue gate had to be a token census, not an AST walk.** §8 T1 was
   written by analogy with DirectorGraph, whose residue is numeric. TextGraph's
   residue is *string vocabulary*, and its worst copies are in TypeScript. A
   numeric AST gate here would have asserted nothing at all. The gate is a
   cross-language census: 563 quoted occurrences of 42 owned tokens across 19
   files, each classified `declaration-migrated`, `reads-from-graph`,
   `usage-only`, `second-declaration` or `model-facing-copy`. The numeric gate
   is explicitly deferred to T4, where `text-threshold` nodes exist.

2. **The gate found five second-declarations the inventory missed**, three of
   them outside the file the inventory had flagged:

   | Site | What it duplicates |
   | --- | --- |
   | `tool-contract-projection.ts:36` `REVIEWED_AGENCY_CLAIM_TYPES` | `VOLUNTARY_CLAIM_TYPES`, as an exported const |
   | `tool-contract-projection.ts:1290, 1673` | `VOLUNTARY_CLAIM_TYPES` again, twice inline |
   | `tool-contract-projection.ts:99` | `REALIZATION_VALUES`, as a TypeScript union type |
   | `coc_narration_contract.py:826` | `PLAYER_FACING_ROLL_VISIBILITIES`, inlined as `{"public", "consequence_public"}` |
   | `coc_state_authority.py:357` | the mechanics segment vocabulary, as `("state_delta", "asset_delta")` |
   | `export_battle_report.py:684-689` | the roll visibility classification, reimplemented beside a documented import of the real one |

   The inventory recorded the obligation namespace as having copies in seven
   files. It is worse than that: `tool-contract-projection.ts` holds independent
   copies of **five** owned vocabularies, not one. Recorded, not repaired — T1
   is contract, compiler, vocabulary and the gate.

3. **`substantive-effect-status` had no declaration to migrate.** The
   `applied` / `missing` / `not_required` vocabulary exists only as one inline
   conditional expression in `_build_obligations`. It is an undeclared closed
   set — exactly what the graph exists to surface — and is represented as three
   nodes whose consumption is T2's job.

4. **The census must over-report rather than filter.** `coc_live_turn_runner.py`
   contains five `{"applied": ...}` dict keys that collide with a status token.
   A heuristic that filtered them would also filter a real copy, so they stay in
   the census, labelled as the false positive they are. A gate that asks a
   question is better than one that quietly answers it.

5. **The strongest identity proof was not in the gate list.**
   `mcp-operation-contracts.json` is a generated archive whose schemas are built
   from these very frozensets. Rebuilding it byte-identically proves the graph
   became the source *and* that the model-visible surface did not move — better
   evidence than any assertion about the Python constants alone. It is now a
   test.

6. **Zero relations is the correct T1 shape.** §4.3 lists seven internal
   relation kinds; the obligation plane needs none of them. The two structural
   facts that could have been edges — the voluntary subset of agency claim types
   and the player-facing/superseded split of roll visibility classes — are node
   properties, because that is exactly how the source reconstructs both
   frozensets. The contract records this as `empty_relations_law` so a later
   slice cannot mistake the absence for an oversight.

7. **The gate proved itself during the slice.** Its first run rejected the
   census for omitting two `coc-keeper-play` reference files that contain no
   owned token at all. A gate that only listed files with hits would have
   allowed a new copy to appear in an unlisted file; globbing the directory and
   requiring an explicit empty entry is what closes that.

8. **The baseline tool reports one false `masked_new_violation` when run from a
   worktree, and it is not the defect that `3fff1f8a` fixed.** T1's verification
   returned `verdict: "regressions"` on counts that say the opposite:

   ```
   failing_here 20   failing_on_baseline 20   regressions 0
   baseline_only 0   failures_in_new_tests 0  masked_new_violations 1
   masked_new_violations: ["../../../Library/Frameworks/.../python3.14/subprocess.py"]
   ```

   The single entry is a Python **stdlib** file, reached through
   `test_finalize_obligation_binding.py`, which shells out to `node`. That test
   fails identically on both trees. What differs is only how pytest *renders*
   the stdlib frame: this worktree sits three levels under `/Users/haoli`, so
   pytest prints the frame relative (`../../../Library/...`), while the baseline
   worktree sits deep under `/private/var/folders/...`, so pytest prints the
   same file absolutely (`/Users/haoli/Library/...`). One file, two spellings,
   one spurious set difference.

   `3fff1f8a` normalises the two *repo roots*; it does not reconcile a path that
   escapes above the root via `../`, nor a relative-versus-absolute rendering of
   the same file. Resolving each extracted path to an absolute path before the
   set diff would close it. Not repaired here: `scripts/verify_against_baseline.py`
   is repo-health infrastructure owned by the DirectorGraph work, and silently
   patching another slice's shared tool is the boundary AGENTS.md says to report
   rather than cross.

   The verification question was still answered, directly rather than through
   the tool's verdict string: the same 20 tests fail on both trees, zero
   regressions, zero baseline-only, and two of the failures were reproduced
   by hand on a baseline worktree at the same file and line
   (`test_narration_budget.py:2568`, `assert True is False`;
   `test_settled_output_recovery_reaches_finalization_receipt`, node exit 1).
   All 20 are pre-existing and unrelated to the text layer.
