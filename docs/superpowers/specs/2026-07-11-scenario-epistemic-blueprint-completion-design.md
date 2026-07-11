# Scenario Epistemic Blueprint Completion Design

**Date:** 2026-07-11  
**Status:** Approved by the user through the previously accepted optimization blueprint and the explicit request to complete it  
**Base:** `feature/scenario-epistemic-director-v1`  
**Scope:** Complete the remaining source-evidence, semantic compilation, question lifecycle, cognitive storylet, narrator-contract, and playtest-evaluation layers without changing the existing seven-file Scenario IR or making the live Director reread PDFs every turn.

## 1. Goal

Finish the full module-parsing and director-orchestration blueprint so the system can answer five different questions with separate, testable components:

1. **Can this extracted module fact be trusted?** — Source Evidence Bridge.
2. **How can authored facts change player understanding?** — Epistemic Compiler.
3. **What does the player currently believe?** — Belief State and Question Lifecycle.
4. **How should this turn change that belief?** — Multi-effect Epistemic Director and Storylet/Narrator contracts.
5. **Did the resulting play produce fair, cumulative understanding rather than random surprise?** — Epistemic Metrics and reports.

The completed runtime remains:

```text
PDF / authored module
  -> cached extraction + source evidence bundle
  -> seven-file Scenario IR
  -> epistemic sidecars + compile confidence
  -> deterministic Story Director
  -> rules / result backfill
  -> resolved epistemic contract
  -> belief/question persistence
  -> cognitive storylet + narrator envelope
  -> playtest metrics and audit
```

## 2. Non-negotiable constraints

- Shared runtime behavior lives only in `plugins/coc-keeper/`.
- Runtime meaning judgments never use hardcoded keyword hits on player or module prose.
- Semantic compilation is artifact-mediated and provenance-checked; deterministic code consumes IDs, enums, booleans, scores, and recorded reasons.
- Existing seven-file scenarios remain valid when all new files are absent.
- Keeper-secret prose never enters player-visible narration envelopes, belief snapshots, or committed module-library artifacts.
- The live Director never reads arbitrary PDF prose each turn.
- Critical reveals fail closed when source confidence is insufficient; ordinary atmosphere may degrade to presentation-only improvisation.
- No embeddings, vector database, or new runtime dependency is introduced.
- Python 3.11 remains the minimum supported version.

## 3. Project decomposition

This design is implemented as three independently verifiable subprojects.

### 3.1 Source Evidence Bridge v1

Produces and validates:

```text
index/page-map.json
index/parse-manifest.json
index/evidence-segments.jsonl
```

It upgrades PDF cache metadata with file hash, text hash, parser version, and pipeline version. It maps printed page numbers to zero-based PDF indices and records per-range parse quality. Scenario validation can then distinguish a valid source anchor from a low-confidence or stale source.

### 3.2 Epistemic Compiler and Lifecycle v2

Adds an artifact-mediated compiler:

```text
coc_epistemic_compile.py
  -> epistemic-compile-request.json
  <- epistemic-compile-result.json
  -> epistemic-graph.json
  -> reveal-contracts.json
  -> compile-confidence.json
```

It also adds explicit question closure, multi-effect clue contracts, confidence gating, and bulk migration request generation for existing compiled modules.

### 3.3 Cognitive Storylet, Narration, and Metrics v1

Adds cognitive story functions to storylet selection, a minimum-privilege narrator belief-update projection, and deterministic playtest metrics:

```text
belief_gain
curiosity_load
explanation_compression
reframe_fairness
confirmation_saturation
unexplained_surprise
parse_risk_exposure
```

## 4. Source Evidence Bridge

### 4.1 PDF cache metadata v2

Each cache entry's `.meta.json` becomes:

```json
{
  "schema_version": 2,
  "pdf": "pdf/module.pdf",
  "pages": [447, 448],
  "backend": "pymupdf4llm",
  "backend_version": "0.0.17",
  "pipeline_version": 2,
  "use_ocr": false,
  "char_count": 4832,
  "file_sha256": "...",
  "text_sha256": "...",
  "parsed_at": "2026-07-11T12:00:00"
}
```

Cache-hit policy:

- If the PDF path exists and `file_sha256` differs, the cache is stale.
- If `pipeline_version` differs, the cache is stale.
- If requested backend differs, the cache is stale.
- External cache entries also compare the external source text hash when an external source is supplied.
- Legacy metadata remains readable; absent hashes do not break tests using synthetic paths, but an existing real source file with missing or mismatched hash is reparsed.

### 4.2 Page map

Canonical shape:

```json
{
  "schema_version": 1,
  "scenario_id": "the-haunting",
  "sources": [
    {
      "source_id": "pdf:the-haunting",
      "path": "pdf/The Haunting.pdf",
      "file_sha256": "...",
      "pages": [
        {
          "pdf_index": 447,
          "printed_page": 448,
          "printed_label": "448",
          "chapter": "The Haunting"
        }
      ]
    }
  ]
}
```

A source reference may contain either `pdf_index` or `printed_page`, but not an ambiguous bare page once the source opts into page-map validation. Legacy refs with `{path, page, page_kind}` are normalized at the boundary.

### 4.3 Parse manifest

Canonical range record:

```json
{
  "range_id": "range-447-451",
  "source_id": "pdf:the-haunting",
  "pdf_indices": [447, 448, 449, 450, 451],
  "cache_path": ".coc/pdf-cache/the-haunting/pages-447-451.md",
  "file_sha256": "...",
  "text_sha256": "...",
  "backend": "pymupdf4llm",
  "backend_version": "0.0.17",
  "pipeline_version": 2,
  "quality": {
    "reading_order": 0.94,
    "tables": 1.0,
    "sidebar_isolation": 0.72,
    "entity_continuity": 0.98,
    "overall": 0.89
  },
  "review_state": "auto_accepted"
}
```

Allowed review states:

```text
auto_accepted manual_accepted needs_review rejected
```

### 4.4 Evidence segments

`evidence-segments.jsonl` records stable local evidence without committing copyrighted source prose to the module library:

```json
{
  "segment_id": "seg-p448-003",
  "source_id": "pdf:the-haunting",
  "locator": {"pdf_index": 447, "printed_page": 448},
  "segment_kind": "clue",
  "heading_path": ["The Haunting", "The House"],
  "text_sha256": "...",
  "parse_confidence": 0.91,
  "review_state": "auto_accepted",
  "grep_anchors": ["Walter Corbitt"],
  "text": "local-only text used for validation"
}
```

The `text` member is local working data and must be stripped when copying a module into `.coc/module-library/`.

### 4.5 Critical-source gate

A critical source is usable only when:

- its locator resolves through the page map;
- its range is present in the parse manifest;
- its `review_state` is `auto_accepted` or `manual_accepted`;
- its effective confidence meets `0.80` by default;
- every declared `grep_anchor` exists in the matching evidence segment.

Failure yields structured findings and, at runtime, `HOLD` plus a `source_resolution_request` rather than an invented reveal.

## 5. Artifact-mediated Epistemic Compiler

### 5.1 Request contract

`coc_epistemic_compile.py request <scenario-dir>` writes a canonical request containing:

- scenario identity and structure type;
- stable scene, clue, conclusion, NPC, front, and secret IDs;
- player-safe summaries and structured source refs;
- source-confidence summaries;
- expected output schema;
- Semantic Matcher Constitution restrictions;
- request SHA-256.

It does not infer semantics itself.

### 5.2 Result contract

The external semantic compiler returns:

```json
{
  "schema_version": 1,
  "evaluator_id": "codex-epistemic-compiler-v1",
  "evaluation_provenance": {
    "kind": "llm",
    "request_sha256": "...",
    "reviewed_artifact": "epistemic-compile-request.json"
  },
  "epistemic_graph": {},
  "reveal_contracts": {},
  "compile_confidence": {
    "schema_version": 1,
    "default_threshold": 0.8,
    "nodes": []
  },
  "reasons": {}
}
```

The installer rejects stale SHA, wrong evaluator ID, malformed schemas, unknown IDs, and missing reasons for critical questions or reframe contracts.

### 5.3 Compile confidence

Each record identifies a compiled node:

```json
{
  "node_type": "question",
  "node_id": "q-archivist-motive",
  "semantic_confidence": 0.88,
  "source_confidence": 0.91,
  "effective_confidence": 0.88,
  "source_refs": [],
  "review_state": "auto_accepted"
}
```

Effective confidence is the minimum of semantic and source confidence. Critical nodes below threshold do not drive a hard reveal.

### 5.4 Migration

`coc_epistemic_compile.py scan <root>` returns all compiled scenario directories missing any of the three sidecars. `request --all <root>` writes one request directory per scenario. It never fabricates sidecars without a provenance-valid semantic result.

## 6. Question Lifecycle v2

Questions may declare:

```json
{
  "opens_when": [],
  "closes_when": {
    "kind": "clue_any",
    "clue_ids": ["clue-a", "clue-b"]
  }
}
```

Allowed closure kinds:

```text
clue_any clue_all evidence_count flag_set scene_entered payoff explicit
```

`coc_epistemic_lifecycle.py` consumes only structured world state, committed clues, flags, visited scene IDs, and resolved effects. It emits `question_opened` and `question_answered` transitions. `explicit` and `payoff` require an authored contract; they are never guessed.

## 7. Multi-effect Epistemic Contract v2

The existing top-level primary fields remain for backward compatibility. A new `effects` list carries all independently valid cognitive effects for a committed clue:

```json
{
  "schema_version": 2,
  "mode": "COMPLICATE",
  "target_question_id": "q-motive",
  "effects": [
    {
      "effect_id": "clue-a:q-fact:confirm",
      "mode": "CONFIRM",
      "target_question_id": "q-fact",
      "deliver_clue_ids": ["clue-a"]
    },
    {
      "effect_id": "clue-a:q-motive:complicate",
      "mode": "COMPLICATE",
      "target_question_id": "q-motive",
      "deliver_clue_ids": ["clue-a"]
    }
  ]
}
```

The primary effect is ranked by active question, live hypothesis presence, importance, and strength. Secondary effects are retained when they are independently valid and do not require an unready reframe. Rule backfill resolves every effect against actual committed clues. The belief reducer applies each effect at most once by `effect_id`.

## 8. Cognitive Storylets

Storylets may declare:

```json
{
  "epistemic_functions": ["confirm", "complicate"],
  "question_layers": ["fact", "motive"],
  "requires_reveal_contract": false
}
```

New story needs:

```text
belief_confirmation
belief_expansion
belief_complication
belief_reframe
question_payoff
```

A storylet with `requires_reveal_contract: true` is eligible only when the resolved DirectorPlan contains a matching ready reveal contract. Generic storylets remain presentation devices and may not create truth, factions, culprits, gods, or motives.

## 9. Narrator Belief-Update Projection

`coc_epistemic_narration.py` converts the resolved contract into a minimum-privilege projection:

```json
{
  "mode": "COMPLICATE",
  "preserve_as_true": ["truth-archivist-lied"],
  "newly_supported": ["q-fact"],
  "newly_uncertain": ["q-motive"],
  "new_questions": ["q-selection-program"],
  "explanation_targets": ["why-preserve-one-name"],
  "must_not": []
}
```

The narration envelope includes this projection as `belief_update`. It contains no Keeper-secret prose and no truth body, only IDs, player-safe question labels, and approved constraints.

## 10. Epistemic Metrics

`coc_epistemic_metrics.py` computes deterministic metrics from structured events and source manifests.

### 10.1 Belief gain

Weighted count of confirmed, expanded, complicated, reframed, and paid-off question updates, excluding HOLD and uncommitted plans.

### 10.2 Curiosity load

Count and importance-weighted score of active unanswered questions. The report flags both zero-load stagnation and excessive unresolved-question overload.

### 10.3 Explanation compression

For each reframe/payoff, count distinct setup clues and explanation targets unified by the reveal.

### 10.4 Reframe fairness

Ratio of available required setup refs to declared setup refs, with a hard failure when a reframe event occurred below `1.0`.

### 10.5 Confirmation saturation

Longest repeated run of `confirm` treatment for the same question without an added question layer or new action affordance. This is diagnostic only and never forces a reversal.

### 10.6 Unexplained surprise

Count of reframe/payoff events missing source-backed setup, preserved prior truth, or a compiled reveal contract.

### 10.7 Parse-risk exposure

Count and weighted severity of delivered critical effects whose source confidence was below threshold, unresolved, stale, or under review.

Reports expose both raw counts and a compact `epistemic_health` summary.

## 11. Error handling

- Missing optional sidecars: legacy behavior.
- Malformed present sidecars: validation error.
- Stale semantic result SHA: installation error.
- Missing page map for a legacy scenario: warning unless strict source validation is requested.
- Missing page map for an opted-in critical source: error.
- Low-confidence critical effect: runtime HOLD and source-resolution request.
- Failed clue gate: all dependent effects resolve to HOLD.
- Duplicate effect application: ignored through stable effect IDs and the existing decision apply ledger.
- Invalid storylet cognitive tags: library load error.

## 12. Testing strategy

Each subproject uses TDD and has its own focused suite. The final gate is:

```bash
PYTHONDONTWRITEBYTECODE=1 python -m pytest tests/ -q -p no:cacheprovider
```

Required end-to-end fixtures model three structures without copying commercial prose:

- branching investigation;
- large chapter with page-number offsets;
- multi-faction scenario with competing hypotheses.

## 13. Definition of done

The full blueprint is complete when:

- PDF cache invalidation is content/version aware;
- source refs can resolve printed and PDF page identities;
- critical source confidence is machine-gated;
- sidecars can be generated through a provenance-valid semantic artifact exchange;
- existing scenarios can be scanned and queued for migration;
- question opening and closure are deterministic and persisted;
- one clue can carry multiple cognitive effects safely;
- storylet selection can serve the resolved cognitive need;
- narration receives a player-safe belief-update projection;
- reports compute all seven epistemic metrics;
- legacy scenarios remain green;
- the complete repository test suite passes.