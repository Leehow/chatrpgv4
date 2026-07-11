# Scenario Epistemic Blueprint Completion Review

## Scope

This review maps the approved completion design and its three implementation
plans to the code and regression coverage on
`feature/scenario-epistemic-blueprint-completion`.

The implementation preserves the Semantic Matcher Constitution: deterministic
runtime code operates on structured IDs, locators, enums, confidence records,
and committed events. It does not classify scenario meaning by scanning prose.

## 1. Source Evidence Bridge

Implemented in:

- `plugins/coc-keeper/skills/trpg-pdf-ingest/scripts/pdf_cache.py`
- `plugins/coc-keeper/scripts/coc_pdf_source.py`
- `plugins/coc-keeper/scripts/coc_source_resolution.py`
- `plugins/coc-keeper/scripts/coc_scenario.py`
- `plugins/coc-keeper/scripts/coc_scenario_compile.py`

Delivered behavior:

- cache metadata schema v2 records source and extracted-text hashes;
- cache validity includes PDF content, parser/backend identity, and pipeline
  version while preserving legacy synthetic-cache behavior;
- page identity is represented explicitly as printed page and PDF index;
- `page-map.json`, `parse-manifest.json`, and `evidence-segments.jsonl` are
  scaffolded with new scenarios;
- critical source use defaults to a 0.80 confidence threshold;
- review state, stale hash, missing range, unresolved locator, and missing
  anchor failures are structured findings;
- local evidence prose is removed before module-library or semantic artifact
  transfer;
- source-resolution requests are minimum privilege.

Regression coverage:

- `tests/test_pdf_cache.py`
- `tests/test_source_evidence_bridge.py`
- `tests/test_scenario.py`
- `tests/fixtures/epistemic/large-chapter-page-offset.json`
- `tests/test_epistemic_blueprint_e2e.py`

## 2. Artifact-Mediated Epistemic Compilation and Migration

Implemented in:

- `plugins/coc-keeper/scripts/coc_epistemic_compile.py`
- `plugins/coc-keeper/scripts/coc_compile_confidence.py`
- `plugins/coc-keeper/scripts/coc_epistemic_lifecycle.py`
- `plugins/coc-keeper/scripts/coc_scenario_compile.py`

Delivered behavior:

- compiler input is a structured, player-safe artifact rather than raw source
  prose;
- result installation is bound to the request SHA-256 and evaluator identity;
- critical questions and reframe contracts require explicit semantic reasons;
- installation validates the complete compiled scenario before atomically
  writing `epistemic-graph.json`, `reveal-contracts.json`, and
  `compile-confidence.json`;
- old scenario trees can be scanned for missing or partial sidecars and produce
  migration requests without inventing semantic content;
- critical nodes and reveal contracts are gated by structured compile
  confidence and review state.

Regression coverage:

- `tests/test_epistemic_compiler_lifecycle_v2.py`
- `tests/test_source_evidence_bridge.py`
- `tests/test_epistemic_blueprint_e2e.py`

## 3. Multi-Effect Contracts and Question Lifecycle

Implemented in:

- `plugins/coc-keeper/scripts/coc_epistemic_policy.py`
- `plugins/coc-keeper/scripts/coc_epistemic_resolve.py`
- `plugins/coc-keeper/scripts/coc_belief_state.py`
- `plugins/coc-keeper/scripts/coc_director_apply.py`
- `plugins/coc-keeper/scripts/coc_story_director.py`

Delivered behavior:

- one committed clue may independently confirm, expand, complicate, reframe,
  or pay off several question layers;
- active questions and live hypotheses rank the primary effect instead of JSON
  array order;
- an unready reframe becomes a secondary `HOLD` and cannot suppress another
  ready effect from the same clue;
- rule resolution converts every effect whose supporting clue did not commit to
  `HOLD`;
- stable effect IDs make belief updates idempotent;
- question opening and closing use structured conditions and committed events;
- v1 single-effect and no-op contracts remain readable.

Regression coverage:

- `tests/test_epistemic_compiler_lifecycle_v2.py`
- `tests/fixtures/epistemic/branching-investigation.json`
- `tests/fixtures/epistemic/multi-faction.json`
- `tests/test_epistemic_blueprint_e2e.py`

## 4. Cognitive Storylets

Implemented in:

- `plugins/coc-keeper/scripts/coc_storylets.py`
- `plugins/coc-keeper/references/rules-json/storylet-library.json`
- `plugins/coc-keeper/skills/coc-scenario-import/references/storylet-schema.md`

Delivered behavior:

- optional `epistemic_functions`, `question_layers`, and
  `requires_reveal_contract` fields are validated as structured enums;
- cognitive story needs are scheduled before generic scene-action needs when a
  resolved effect is ready;
- all ready modes and layers participate in eligibility, while the primary
  resolved mode determines the story need;
- `HOLD` and `NONE` do not summon cognitive beats;
- reframe storylets require a matching resolved effect with a compiled reveal
  contract;
- legacy untagged storylets retain their existing behavior;
- storylets remain presentation devices and cannot create new module truth.

Regression coverage:

- `tests/test_cognitive_storylets_narration_metrics.py`
- `tests/test_epistemic_storylets_additional.py`
- `tests/test_storylets.py`
- `tests/test_epistemic_blueprint_e2e.py`

## 5. Minimum-Privilege Narrator Projection

Implemented in:

- `plugins/coc-keeper/scripts/coc_epistemic_narration.py`
- `plugins/coc-keeper/scripts/coc_narration_contract.py`

Delivered behavior:

- narration envelopes include a structured `belief_update` only when an
  epistemic contract is present;
- the projection exposes question IDs, player-facing question labels, approved
  clue IDs, preservation constraints, new questions, and explanation targets;
- `truth_ref`, source prose, compiler reasons, hypothesis claims, and Keeper
  secret prose are excluded;
- `HOLD` projections explicitly forbid narrating an uncommitted update.

Regression coverage:

- `tests/test_cognitive_storylets_narration_metrics.py`
- `tests/test_narration_envelope.py`
- `tests/test_narration_contract.py`
- `tests/test_epistemic_blueprint_e2e.py`

## 6. Epistemic Metrics and Playtest Reporting

Implemented in:

- `plugins/coc-keeper/scripts/coc_epistemic_metrics.py`
- `plugins/coc-keeper/scripts/coc_playtest_report.py`

Delivered metrics:

- `belief_gain`
- `curiosity_load`
- `explanation_compression`
- `reframe_fairness`
- `confirmation_saturation`
- `unexplained_surprise`
- `parse_risk_exposure`
- `epistemic_health`

Delivered behavior:

- metrics consume structured belief/question events only;
- parse-risk exposure is scoped to effects and source ranges actually delivered
  to the player, not every unresolved node elsewhere in the module;
- the battle report persists `playtest.json.epistemic_metrics` and renders an
  isolated `Epistemic Experience` section;
- legacy runs without belief events produce a valid zero-event report.

Regression coverage:

- `tests/test_cognitive_storylets_narration_metrics.py`
- `tests/test_epistemic_metrics_scope.py`
- `tests/test_epistemic_playtest_report.py`
- `tests/test_playtest_report.py`

## 7. End-to-End Structural Fixtures

The three fixtures contain invented IDs and summaries only:

- `branching-investigation.json` exercises confirm -> complicate -> reframe,
  failed clue commitment, storylet selection, narrator projection, and belief
  persistence;
- `large-chapter-page-offset.json` exercises printed/PDF page mapping, source
  confidence, prose stripping, semantic artifact validation, and sidecar
  installation;
- `multi-faction.json` proves that one faction's evidence updates only its
  targeted hypothesis.

`tests/test_epistemic_blueprint_e2e.py` crosses the complete structural chain:

```text
source evidence
-> semantic compile artifact
-> Director multi-effect contract
-> post-rule resolution
-> belief/question persistence
-> cognitive storylet
-> narrator projection
-> epistemic metrics
```

## Compatibility and Safety Review

- No new runtime dependency was introduced.
- Existing v1 contracts, legacy storylets, and legacy reports remain supported.
- No copyrighted module prose is embedded in the E2E fixtures.
- Runtime meaning is never inferred through keyword or free-text matching.
- Storylets and narration can change presentation but cannot invent scenario
  truth.
- Low-confidence or uncommitted critical evidence fails closed through `HOLD`
  or source-resolution requests.

## Verification Command

The final branch is verified with the repository's standard command:

```bash
PYTHONDONTWRITEBYTECODE=1 python -m pytest tests/ -q -p no:cacheprovider
```

The focused suites additionally cover source evidence, compiler lifecycle,
cognitive storylets, narration, metrics, report generation, and all three E2E
fixtures.
