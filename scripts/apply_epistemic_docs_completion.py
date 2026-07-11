#!/usr/bin/env python3
"""Append the completed epistemic blueprint protocols to project documentation."""
from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def append_once(relative: str, marker: str, section: str) -> None:
    path = ROOT / relative
    text = path.read_text(encoding="utf-8")
    if marker in text:
        return
    path.write_text(text.rstrip() + "\n\n" + section.strip() + "\n", encoding="utf-8")


def main() -> None:
    append_once(
        "plugins/coc-keeper/skills/trpg-pdf-ingest/SKILL.md",
        "## Source Evidence Bundle and Cache Metadata v2",
        r'''
## Source Evidence Bundle and Cache Metadata v2

`pdf_cache.extract_markdown()` writes metadata schema v2. A real source file is
served from cache only when all applicable provenance fields still match:

- `file_sha256` of the PDF;
- `text_sha256` of extracted Markdown;
- parser backend and `backend_version`;
- `pipeline_version`;
- requested page set and OCR mode.

Legacy synthetic caches whose source path does not exist remain readable for
fixtures and historical tests. Existing real files with missing or mismatched
content provenance are reparsed.

Scenario import promotes parse provenance into three local indexes:

```text
index/page-map.json
index/parse-manifest.json
index/evidence-segments.jsonl
```

`page-map.json` is the only authority for converting a printed page to a
zero-based PDF index. Never guess an offset. `parse-manifest.json` records range
hashes, backend identity, quality dimensions, and one of
`auto_accepted|manual_accepted|needs_review|rejected`.
`evidence-segments.jsonl` records stable segment IDs, locators, local text
hashes, confidence, review state, and explicit grep anchors.

The `text` member of an evidence segment is local working data. Strip it before
copying a package into `.coc/module-library/` or preparing an external semantic
artifact. A critical source is usable only after locator resolution, accepted
range and segment review states, integrity checks, anchor validation, and the
configured confidence threshold (default `0.80`).
''',
    )

    append_once(
        "plugins/coc-keeper/skills/coc-scenario-import/SKILL.md",
        "## Artifact-Mediated Epistemic Compilation v2",
        r'''
## Artifact-Mediated Epistemic Compilation v2

After the canonical seven-file Scenario IR is green, compile belief-aware
sidecars through an artifact exchange. Deterministic code must not infer module
meaning itself.

```bash
python plugins/coc-keeper/scripts/coc_epistemic_compile.py request \
  <campaign>/scenario --artifacts-dir <artifacts>

# An LLM semantic evaluator reads epistemic-compile-request.json and writes
# epistemic-compile-result.json with the exact request SHA-256.

python plugins/coc-keeper/scripts/coc_epistemic_compile.py install \
  <campaign>/scenario \
  <artifacts>/epistemic-compile-request.json \
  <artifacts>/epistemic-compile-result.json
```

The request contains stable IDs, enums, explicitly player-safe summaries,
source locators/confidence, and secret `{id, category}` references. It excludes
raw NPC agenda/fear/secret prose, danger moves/impulses, full-clock outcomes,
Keeper secret prose, and local evidence text.

Installation rejects a stale request hash, wrong evaluator, malformed sidecars,
unknown or duplicate confidence-node IDs, missing reasons for critical questions
or reframe contracts, and any complete-scenario validation error. Successful
installation writes:

```text
epistemic-graph.json
reveal-contracts.json
compile-confidence.json
```

For migration:

```bash
python plugins/coc-keeper/scripts/coc_epistemic_compile.py scan <campaign-root>
python plugins/coc-keeper/scripts/coc_epistemic_compile.py request-all \
  <campaign-root> <artifact-root>
```

A partial sidecar set is reported; it is never silently filled with guessed
semantics. Missing sidecars preserve legacy Director behavior until a validated
semantic result is installed.

When a critical source cannot pass the evidence gate, emit a structured source
resolution request and keep the cognitive treatment at `HOLD`; never improvise a
replacement truth.
''',
    )

    append_once(
        "plugins/coc-keeper/skills/coc-scenario-import/references/compile-protocol.md",
        "## Source-Evidence Preflight and Semantic Artifact Exchange",
        r'''
## Source-Evidence Preflight and Semantic Artifact Exchange

Before semantic compilation:

1. build or load `page-map.json`, `parse-manifest.json`, and
   `evidence-segments.jsonl`;
2. resolve every critical `source_ref` through the page map;
3. require accepted range and relevant-segment review states;
4. verify real-file, local segment-text, and cache provenance when available;
5. require effective confidence `>= 0.80` unless the manifest explicitly sets a
   different threshold;
6. verify every declared `grep_anchor` against the relevant segment.

The compiler request is a minimum-privilege artifact. It may contain stable
scene/clue/conclusion/NPC/front/secret IDs, controlled enums, explicit
player-safe summaries, source refs, and confidence records. It may not contain
raw source text or Keeper-only agenda, fear, secret, danger-move, impulse, or
full-clock consequence prose.

The semantic evaluator returns `epistemic-compile-result.json` with
`evaluation_provenance.kind="llm"`, the canonical request SHA-256, the expected
evaluator ID, sidecars, compile confidence, and reasons for every critical
question and reframe contract. Run complete Scenario IR validation before any
sidecar is replaced.
''',
    )

    append_once(
        "plugins/coc-keeper/skills/coc-scenario-import/references/story-graph-schema.md",
        "## 11. compile-confidence.json",
        r'''
## 11. compile-confidence.json

Optional semantic readiness sidecar:

```json
{
  "schema_version": 1,
  "default_threshold": 0.8,
  "nodes": [
    {
      "node_type": "question",
      "node_id": "q-motive",
      "semantic_confidence": 0.94,
      "source_confidence": 0.89,
      "effective_confidence": 0.89,
      "review_state": "auto_accepted"
    }
  ]
}
```

`node_type` is `question|reveal_contract`. Each `(node_type,node_id)` pair is
unique and must resolve to the installed epistemic graph or reveal-contract
document. Confidence values are within `0..1`; review state is
`auto_accepted|manual_accepted|needs_review|rejected`. When the document exists,
a missing/low/unreviewed target fails closed. When the entire sidecar is absent,
legacy behavior remains available.

## 12. Epistemic Graph and Contract v2

`epistemic-graph.json.questions[].closes_when` uses structured conditions only:
`clue_any`, `clue_all`, `evidence_count`, `flag_set`, `scene_entered`, `payoff`,
or `explicit`. Runtime code never decides closure by scanning narration.

A selected clue may produce multiple independent effects. The Director contract
uses schema v2:

```json
{
  "schema_version": 2,
  "mode": "COMPLICATE",
  "effects": [
    {"effect_id": "clue-a:q-motive:complicate", "mode": "COMPLICATE"},
    {"effect_id": "clue-a:q-fact:confirm", "mode": "CONFIRM"}
  ]
}
```

The primary mode is ranked from active questions and live hypotheses; secondary
effects are retained. Post-rule resolution writes `resolved_effects`; an effect
whose clue did not commit becomes `HOLD` without suppressing other ready effects.
Stable `effect_id` values make belief persistence idempotent.
''',
    )

    append_once(
        "plugins/coc-keeper/references/director-protocol.md",
        "## Epistemic Runtime Contract v2",
        r'''
## Epistemic Runtime Contract v2

`DirectorContext` may include `epistemic_graph`, `reveal_contracts`,
`compile_confidence`, and persistent `belief_state`. The planner consumes only
structured IDs/enums and emits one schema-v2 contract with a primary `mode` plus
all candidate `effects`.

Active questions and live hypotheses rank the primary effect. Each effect carries
a stable `effect_id`, target question/layer, approved clue IDs, evidence strength,
and optional reframe preservation/setup constraints. Low-confidence critical
nodes and unready reframes become `HOLD`; they cannot erase a ready confirm or
complicate effect from the same clue.

After rules resolve, `coc_epistemic_resolve` writes `resolved_effects`. Only an
effect whose supporting clue committed may alter belief state. Applied effect
IDs are persisted so replay/retry cannot double-apply a treatment. Question open
and close events are reduced from structured conditions and world state.

Cognitive story needs are scheduled before generic scene-action needs:

```text
belief_confirmation
belief_expansion
belief_complication
belief_reframe
question_payoff
```

A reframe storylet requires a ready effect with `reveal_contract_id`. Storylets
may change presentation, pressure, cost, or emphasis; they may not create module
truth.

The NarrationEnvelope receives a minimum-privilege `belief_update` projection:
player-facing question labels, approved clue IDs, preservation constraints, new
questions, and explanation targets. It never receives `truth_ref`, source prose,
compiler reasons, hypothesis claims, or Keeper secret prose.
''',
    )

    append_once(
        "plugins/coc-keeper/skills/coc-playtest/SKILL.md",
        "## Epistemic Experience Metrics",
        r'''
## Epistemic Experience Metrics

`coc_playtest_report.py` reads structured belief events/state plus compile and
parse provenance, persists `playtest.json.epistemic_metrics`, and renders the
`Epistemic Experience` section defined in
`references/battle-report-template.md`.

The report includes `belief_gain`, `curiosity_load`,
`explanation_compression`, `reframe_fairness`, `confirmation_saturation`,
`unexplained_surprise`, `parse_risk_exposure`, and the aggregate
`epistemic_health`. These are deterministic diagnostics, not prose judgments.
`parse_risk_exposure` is scoped to cognitive nodes and parse ranges actually
delivered to the player. Legacy runs without belief events remain valid and
produce zero-event metrics.
''',
    )

    append_once(
        "docs/superpowers/reviews/2026-07-11-scenario-epistemic-blueprint-completion-review.md",
        "## Final Boundary Hardening",
        r'''
## Final Boundary Hardening

The completion pass added three fail-closed boundaries:

- semantic compile requests no longer fall back from an explicit
  `agenda_summary` to raw NPC agenda/fear/secret prose and whitelist only
  player-safe front summaries and visible clock symptoms;
- critical-source validation checks relevant evidence-segment review state and
  verifies declared local segment hashes against local text when available;
- `compile-confidence.json` rejects unsupported node types, duplicate node keys,
  unknown question/reveal-contract IDs, malformed confidence values, and invalid
  review states.

These are covered by `tests/test_epistemic_boundary_hardening.py` in addition to
the source bridge, compiler lifecycle, and three cross-layer E2E fixtures.
''',
    )

    status = r'''
## Implementation Status

**Completed on 2026-07-11.** The implementation and verification mapping is in
`docs/superpowers/reviews/2026-07-11-scenario-epistemic-blueprint-completion-review.md`.
'''
    for relative in (
        "docs/superpowers/plans/2026-07-11-source-evidence-bridge-v1.md",
        "docs/superpowers/plans/2026-07-11-epistemic-compiler-lifecycle-v2.md",
        "docs/superpowers/plans/2026-07-11-cognitive-storylets-narration-metrics-v1.md",
    ):
        append_once(relative, "## Implementation Status", status)


if __name__ == "__main__":
    main()
