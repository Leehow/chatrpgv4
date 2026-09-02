# Module pipeline unification — Stage A status

> **Status:** IMPLEMENTED (deterministic acceptance) — forward extraction pass
> and real-module/real-play acceptance remain Stage B; nothing here claims a
> product-path change.
> **Date:** 2026-09-01
> **Track:** `ACTIVE_IMPLEMENTATION_TRACK=pi-coc`
> **Spec:** [pi-coc-module-source-pipeline-unification.md](../specs/pi-coc-module-source-pipeline-unification.md)
> **Branch:** `claude/pi-coc-module-pipeline-unification-20260901` (based on
> `0.8.1a` at `65ca572b`, per the user's merge-target direction).

## Implemented

- `plugins/coc-keeper/scripts/coc_module_projection.py` — the module-agnostic
  runtime projection core:
  - one internal ProjectionSet shape loaded from either carrier: embedded node
    properties (the committed the-haunting form) or a digest-bound
    `runtime-projection.json` sidecar (the forward-path form);
  - `validate` / `project` / `parity` / `prepare-packet` / `validate-records`
    / `attach` as both library functions and a CLI;
  - `RECORD_FIELD_REGISTRY`: registered top-level record fields per projected
    document collection; an unregistered field is an exact finding
    (the `keeper_notes` dead-field class fails at validation, not at the
    table);
  - language guard: records may not carry CJK when the graph
    `source_languages` excludes CJK languages (generalizes the starter's
    English-only rule);
  - sidecar `graph_digest` binds records to the exact accepted graph bytes;
  - packet views strip `runtime_projection`, hashes, and grep anchors and
    keep only semantic `source_id + pdf_index` refs.
- `coc_starter_graph.py` now delegates `validate_starter_graph` /
  `project_starter_documents` to the core (one projector, not two); its
  the-haunting-specific identity, English-only, and complete-document-set
  checks remain local.
- `plugins/coc-keeper/skills/coc-scenario-import/SKILL.md` routes the
  projection core and states the Stage B boundary: no live import authors
  projection records until real-module + real-play acceptance.

## Deterministic evidence

- `tests/test_module_projection.py` (new, 10 tests): embedded starter graph
  validates/projects byte-equal to every committed runtime view; starter IR
  directory passes parity; sidecar round-trip, digest binding, unknown-node /
  unregistered-field / duplicate-binding / language findings; model-safe
  packet; parity `missing`/`drifted` detection; no vacuous pass on an empty
  projection.
- `tests/test_starter_graph_projection.py` unchanged and green through the
  delegated core (6 tests).
- CLI smoke: `parity` over the committed the-haunting starter reports
  `equal` for all nine documents; `prepare-packet` emits the closed
  story-graph packet.

## Honest boundary

- No runtime projection records have been authored by a real model for any
  freshly compiled module; `prepare-packet`/`validate-records`/`attach` are
  the deterministic half of that loop and are `experimental` until
  `coc-scenario-import` drives them against a real module (Stage B).
- The external `coc-pdf-pipeline` extract waves remain the operating route
  for new modules; per the spec's freeze rule its prompts stay frozen until
  Stage B is green.
- No toolbox operation, MCP contract, campaign state, or KP behavior changed
  in this stage.
