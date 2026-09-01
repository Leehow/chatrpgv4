"""TextGraph slice T1 — contract, compiler, obligation plane, and the gate.

Spec: docs/specs/pi-coc-text-graph-runtime.md §8 T1
Inventory: docs/status/text-layer-obligation-inventory.md

The residue gate below is the most important thing in this file. DirectorGraph's
first gate covered only the ten functions its migration touched, which made it a
gate that could confirm nothing except its own work; extending it later
immediately exposed an entire unmigrated scoring engine and four duplicate
values in a file that had been declared out of scope. The gate here covers the
whole declared text surface from the first commit, and it covers TypeScript,
Markdown and JSON as well as Python, because four copies of the obligation
namespace live in an 8147-line TypeScript projection that a Python AST walk
cannot see.
"""
from __future__ import annotations

import collections
import importlib.util
import json
import re
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
PLUGIN = REPO / "plugins" / "coc-keeper"
SCRIPTS = PLUGIN / "scripts"
REFERENCES = PLUGIN / "references"


def _load(name: str, relative: str):
    path = REPO / relative
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    if str(SCRIPTS) not in sys.path:
        sys.path.insert(0, str(SCRIPTS))
    spec.loader.exec_module(module)
    return module


coc_text_graph = _load(
    "coc_text_graph_test", "plugins/coc-keeper/scripts/coc_text_graph.py"
)
coc_text_runtime = _load(
    "coc_text_runtime_test", "plugins/coc-keeper/scripts/coc_text_runtime.py"
)

CONTRACT = json.loads((REFERENCES / "text-graph-contract-v1.json").read_text("utf-8"))
ARTIFACT_PATH = REFERENCES / "text-graph.json"
ARTIFACT = json.loads(ARTIFACT_PATH.read_text("utf-8"))
MANIFEST = json.loads((REFERENCES / "text-graph-manifest.json").read_text("utf-8"))


# ---------------------------------------------------------------------------
# Contract and compiler
# ---------------------------------------------------------------------------

def test_contract_declares_the_authority_laws_the_spec_requires():
    laws = CONTRACT["authority_laws"]
    assert len(laws) == 8
    joined = " ".join(laws)
    # The law the whole slice exists to make enforceable.
    assert "never pattern-matches player or Keeper prose" in joined
    assert "No regular expression, phrase list, substitution table" in joined
    assert "never rewrites Keeper-authored text" in joined
    assert "presentation-only" in joined
    assert "language-independent" in joined


def test_contract_allows_only_the_adr_0003_outward_relation():
    """ADR 0003 gives the text plane exactly one outward relation."""
    endpoints = CONTRACT["relation_endpoints"]["renders-settled-output"]
    assert sorted(endpoints["to"]) == ["live-state-fact-ref", "rule-effect-ref"]
    outward = {
        kind for kind, spec in CONTRACT["relation_endpoints"].items()
        if any(t.endswith("-ref") for t in spec["to"])
    }
    assert outward == {"renders-settled-output"}


def test_compiler_round_trip_is_byte_stable():
    built = coc_text_graph.build_from_legacy_sources()
    assert built["graph"] == ARTIFACT
    assert built["manifest"] == MANIFEST
    again = coc_text_graph.build_from_legacy_sources()
    assert (
        coc_text_graph._canonical_json(again["graph"])
        == coc_text_graph._canonical_json(built["graph"])
    )
    assert built["manifest"]["graph_content_digest"] == MANIFEST["graph_content_digest"]


def test_built_node_counts_match_the_contract_census():
    counts = collections.Counter(node["node_kind"] for node in ARTIFACT["nodes"])
    assert dict(counts) == CONTRACT["expected_node_counts"]
    assert sum(counts.values()) == 44


def test_expected_node_counts_law_rejects_a_lost_vocabulary():
    """A migration that drops a token must fail the build, not ship quietly."""
    shard = coc_text_graph.obligation_shard()
    shard["nodes"] = [
        node for node in shard["nodes"]
        if node["node_id"] != "coverage-field:persona-fit"
    ]
    with pytest.raises(ValueError, match="expected_node_counts_law"):
        coc_text_graph.build([shard])


def test_every_node_declares_an_evidence_class_and_its_derivation():
    for node in ARTIFACT["nodes"]:
        assert node["evidence_class"] == "settled-effect-derived", node["node_id"]
        assert node["derived_from"].strip(), node["node_id"]
    # The obligation plane is derived, which is why it needs no source corpus.
    classes = {node["evidence_class"] for node in ARTIFACT["nodes"]}
    assert classes == {"settled-effect-derived"}


def test_accept_rejects_an_unaccountable_node():
    shard = coc_text_graph.obligation_shard()
    shard["nodes"][0] = dict(shard["nodes"][0], derived_from="   ")
    codes = {f["code"] for f in coc_text_graph.accept(shard)}
    assert "missing_accountability" in codes


def test_accept_rejects_an_unknown_relation_kind():
    shard = coc_text_graph.obligation_shard()
    shard["relations"] = [{
        "relation_id": "relation:text:bogus",
        "relation_kind": "grounded-by",
        "from_node_id": "obligation-kind:roll",
        "to_node_id": "obligation-kind:roll",
    }]
    codes = {f["code"] for f in coc_text_graph.accept(shard)}
    assert "unknown_relation_kind" in codes


def test_the_only_relations_are_the_load_bearing_ones():
    """empty_relations_law — an edge exists when a consumer reads it.

    T1 shipped zero. T2 adds exactly five: obligation-source-kind part-of
    obligation-kind, which the derivation reads to know which source_kind each
    namespace may write.
    """
    relations = ARTIFACT["relations"]
    assert len(relations) == 5
    assert {r["relation_kind"] for r in relations} == {"part-of"}
    assert all(r["from_node_id"].startswith("obligation-source-kind:") for r in relations)
    assert all(r["to_node_id"].startswith("obligation-kind:") for r in relations)
    assert "empty_relations_law" in CONTRACT
    assert ARTIFACT["coverage"] == {"obligation": "accepted", "craft": "unresolved"}


def test_the_roll_namespace_source_kinds_are_the_ones_play_produced():
    """T1 carried a fabricated `source_kind: "roll"` that never occurs.

    Replaying the preserved corpus produced check 355, amount 11,
    concealed_roll 4 and first_impression 48 — and no "roll" at all.
    """
    from collections import defaultdict
    owned = defaultdict(set)
    for node in ARTIFACT["nodes"]:
        if node["node_kind"] == "obligation-source-kind":
            owned[node["properties"]["obligation_kind"]].add(
                node["properties"]["legacy_key"]
            )
    assert owned["roll"] == {"check", "amount", "concealed_roll"}
    assert owned["first-impression"] == {"first_impression"}
    assert owned["sanity_bout"] == {"sanity_bout"}
    for node in ARTIFACT["nodes"]:
        if node["node_kind"] == "obligation-kind":
            assert "source_kind" not in node["properties"], node["node_id"]


# ---------------------------------------------------------------------------
# no_body_copy_law — from the first commit, not after the mistake
# ---------------------------------------------------------------------------

def test_no_node_carries_the_body_of_a_record_it_only_names():
    for node in ARTIFACT["nodes"]:
        allowed = set(CONTRACT["node_property_keys"][node["node_kind"]])
        assert set(node["properties"]) == allowed, node["node_id"]
        for value in node["properties"].values():
            assert not isinstance(value, (list, dict)), (
                f"{node['node_id']} carries a nested payload; vocabulary nodes "
                "carry identity and order only"
            )


def test_accept_rejects_a_node_that_embeds_a_foreign_body():
    shard = coc_text_graph.obligation_shard()
    node = dict(shard["nodes"][0])
    node["properties"] = dict(node["properties"], evidence_span_ids=["span-1"])
    shard["nodes"][0] = node
    codes = {f["code"] for f in coc_text_graph.accept(shard)}
    assert "body_copy" in codes


def test_the_artifact_stays_small():
    """DirectorGraph's D1 shipped 464KB by embedding record bodies."""
    assert ARTIFACT_PATH.stat().st_size < 64 * 1024


# ---------------------------------------------------------------------------
# ordinal_law — this one protects player-visible output order
# ---------------------------------------------------------------------------

def test_mechanics_placement_order_is_pinned_and_dense():
    """SEGMENT_TYPE_ORDER decides where mechanics blocks land in the output.

    Node ids sort alphabetically (asset-delta, exceptional-effect, fiction,
    public-check, state-delta), which is NOT the placement order. If the
    runtime ever reconstructed this from id order the player would see the
    mechanics of a turn in a different sequence.
    """
    vocab = coc_text_runtime.vocabulary()
    assert vocab["segment_type_order"] == {
        "public_check": 0,
        "state_delta": 1,
        "asset_delta": 2,
        "exceptional_effect": 3,
    }
    assert list(vocab["segment_type_order"]) == [
        "public_check", "state_delta", "asset_delta", "exceptional_effect"
    ]
    alphabetical = sorted(vocab["segment_type_order"])
    assert list(vocab["segment_type_order"]) != alphabetical


def test_the_leading_segment_law_is_data_not_a_bare_string():
    """coc_turn_finalization.py:563 requires segments[0].segment_type == fiction."""
    vocab = coc_text_runtime.vocabulary()
    assert vocab["leading_segment_type"] == "fiction"
    leading = [
        node for node in ARTIFACT["nodes"]
        if node["node_kind"] == "segment-type"
        and node["properties"]["must_lead"] is True
    ]
    assert len(leading) == 1
    # fiction is not a mechanic segment type, which is exactly why it was
    # missing from MECHANIC_SEGMENT_TYPES while being the commonest type in
    # play (1746 of 2219 preserved segments).
    assert leading[0]["properties"]["mechanic"] is False
    assert leading[0]["properties"]["mechanic_placement_order"] is None


def test_every_node_carries_a_dense_ordinal_within_its_kind():
    by_kind = collections.defaultdict(list)
    for node in ARTIFACT["nodes"]:
        by_kind[node["node_kind"]].append(node["properties"]["ordinal"])
    for kind, ordinals in by_kind.items():
        assert sorted(ordinals) == list(range(len(ordinals))), kind


def test_unordered_vocabularies_are_rebuilt_as_sets():
    """ordinal_law: do not let a consumer depend on an order the source lacked."""
    vocab = coc_text_runtime.vocabulary()
    for key in (
        "coverage_fields", "realization_values", "player_input_handling_values",
        "segment_types", "mechanic_segment_types", "agency_claim_types",
        "voluntary_claim_types", "roll_visibility_classes",
        "player_facing_roll_visibilities", "superseded_roll_visibilities",
        "substantive_effect_statuses",
    ):
        assert isinstance(vocab[key], frozenset), key


# ---------------------------------------------------------------------------
# identity_law — T1 is behaviour-preserving
# ---------------------------------------------------------------------------

# Transcribed from the frozensets this slice replaced, at 0.8.1a@3fff1f8a.
PRE_MIGRATION_VALUES = {
    "COVERAGE_FIELDS": frozenset({
        "obligation_id", "realization", "action_realization", "response",
        "causal_explanation", "persona_fit", "player_input_handling",
        "exact_excerpt", "exceptional_beat",
    }),
    "REALIZATION_VALUES": frozenset({
        "fictional_beat", "concealed_no_player_visible_beat",
    }),
    "PLAYER_INPUT_HANDLING_VALUES": frozenset({
        "abstract_completed", "specific_preserved", "not_applicable",
    }),
    "MECHANIC_SEGMENT_TYPES": frozenset({
        "public_check", "state_delta", "asset_delta", "exceptional_effect",
    }),
    "SEGMENT_TYPE_ORDER": {
        "public_check": 0, "state_delta": 1,
        "asset_delta": 2, "exceptional_effect": 3,
    },
    "VOLUNTARY_CLAIM_TYPES": frozenset({
        "voluntary_action", "voluntary_speech", "voluntary_plan",
        "voluntary_belief", "voluntary_trust", "voluntary_active_emotion",
    }),
    "AGENCY_CLAIM_TYPES": frozenset({
        "voluntary_action", "voluntary_speech", "voluntary_plan",
        "voluntary_belief", "voluntary_trust", "voluntary_active_emotion",
        "forced_behavior", "involuntary_physiology",
    }),
    "PLAYER_FACING_ROLL_VISIBILITIES": frozenset({"public", "consequence_public"}),
    "SUPERSEDED_ROLL_VISIBILITIES": frozenset({
        "superseded", "voided", "corrected_hidden", "keeper_only",
    }),
}


def test_every_migrated_vocabulary_is_bit_identical():
    finalizer = _load(
        "coc_turn_finalization_identity",
        "plugins/coc-keeper/scripts/coc_turn_finalization.py",
    )
    for name, expected in PRE_MIGRATION_VALUES.items():
        actual = getattr(finalizer, name)
        assert actual == expected, name
        assert type(actual) is type(expected), name


def test_the_model_visible_contract_archive_is_byte_identical():
    """The strongest identity proof available for this slice.

    turn.output_context and turn.finalize publish several of these
    vocabularies as JSON Schema enums, and the archive is generated from the
    live toolbox. Rebuilding it byte-identically proves the graph became the
    source without moving the model-visible surface at all.
    """
    archive = _load(
        "coc_mcp_contract_archive_test",
        "plugins/coc-keeper/scripts/coc_mcp_contract_archive.py",
    )
    rebuilt = archive.archive_to_canonical_bytes(archive.build_archive())
    on_disk = (REFERENCES / "mcp-operation-contracts.json").read_bytes()
    assert rebuilt == on_disk


def test_the_operation_surface_is_still_147():
    """surface_law: TextGraph adds no model-visible operation."""
    contracts = json.loads(
        (REFERENCES / "mcp-operation-contracts.json").read_text("utf-8")
    )
    assert contracts["operation_count"] == 147
    assert len(contracts["operations"]) == 147


# ---------------------------------------------------------------------------
# fail_closed_law
# ---------------------------------------------------------------------------

def test_a_missing_artifact_fails_closed_instead_of_falling_back(tmp_path):
    module = _load(
        "coc_text_runtime_failclosed",
        "plugins/coc-keeper/scripts/coc_text_runtime.py",
    )
    module.GRAPH_PATH = tmp_path / "absent.json"
    module.reset_cache()
    with pytest.raises(module.TextGraphUnavailable, match="fails closed"):
        module.vocabulary()


def test_a_wrong_contract_id_fails_closed(tmp_path):
    module = _load(
        "coc_text_runtime_wrongcontract",
        "plugins/coc-keeper/scripts/coc_text_runtime.py",
    )
    bogus = tmp_path / "text-graph.json"
    bogus.write_text(json.dumps({"contract_id": "nope", "nodes": []}), "utf-8")
    module.GRAPH_PATH = bogus
    module.reset_cache()
    with pytest.raises(module.TextGraphUnavailable):
        module.vocabulary()


# ---------------------------------------------------------------------------
# Registry promotion
# ---------------------------------------------------------------------------

def test_the_registry_promotes_the_text_graph():
    registry = json.loads(
        (REFERENCES / "system-ontology-registry-v1.json").read_text("utf-8")
    )
    entry = next(
        g for g in registry["graphs"] if g["graph_id"] == "graph:text:production"
    )
    assert entry["availability"] == "production-artifact"
    assert entry["authority_plane"] == "presentation"
    assert entry["ontology_contract"] == "coc.text-graph.v1"
    assert entry["artifact_path"] == "plugins/coc-keeper/references/text-graph.json"
    assert (REPO / entry["artifact_path"]).is_file()

    coverage = next(c for c in registry["coverage"] if c["graph_kind"] == "text")
    assert coverage["status"] == "production-linked"
    # No renders-settled-output edge exists yet, so no instance is claimed.
    assert coverage["composition_status"] == "no-proven-instance"


def test_the_system_ontology_validator_is_clean():
    ontology = _load(
        "coc_system_ontology_test",
        "plugins/coc-keeper/scripts/coc_system_ontology.py",
    )
    findings = ontology.validate_file()
    assert findings == [], findings


# ===========================================================================
# THE RESIDUE GATE — cross-language, whole surface, from slice T1
# ===========================================================================

# Every file in the declared text surface. Migration scope and scanning scope
# are different things: most of these are NOT migrated by T1 and are scanned
# precisely because DirectorGraph's excluded-from-migration file turned out to
# be holding private copies of four migrated values.
TEXT_SURFACE: tuple[str, ...] = (
    # owners
    "plugins/coc-keeper/scripts/coc_turn_finalization.py",
    "plugins/coc-keeper/scripts/coc_operation_turn_output.py",
    "plugins/coc-keeper/scripts/coc_narration_style.py",
    # not migrated in T1, scanned anyway
    "plugins/coc-keeper/scripts/coc_narration_contract.py",
    "plugins/coc-keeper/scripts/coc_turn_manifest.py",
    "plugins/coc-keeper/scripts/coc_state_authority.py",
    "plugins/coc-keeper/scripts/coc_live_turn_runner.py",
    "plugins/coc-keeper/scripts/coc_npc_state.py",
    # not Python at all — four copies of the obligation namespace live here
    "plugins/coc-keeper/pi/lib/tool-contract-projection.ts",
    "plugins/coc-keeper/pi/prompts/host-system-play.md",
    "plugins/coc-keeper/references/mcp-operation-contracts.json",
    "plugins/coc-keeper/skills/coc-export-battle-report/scripts/export_battle_report.py",
)

# Skill references are globbed so a new one cannot appear unscanned.
SKILL_REFERENCE_GLOB = "plugins/coc-keeper/skills/coc-keeper-play/**/*.md"

CLASSIFICATIONS = frozenset({
    "declaration-migrated",
    "reads-from-graph",
    "usage-only",
    "second-declaration",
    "model-facing-copy",
})

# path -> vocabulary -> (occurrences, classification, reason)
#
# `occurrences` counts quoted string literals only. The scan is deliberately
# conservative: it over-reports (a dict key that happens to share a token's
# spelling is counted) rather than under-reporting, because a gate that misses
# a copy is worse than one that asks a question.
CENSUS: dict[str, dict[str, tuple[int, str, str]]] = {
    "plugins/coc-keeper/scripts/coc_turn_finalization.py": {
        "obligation-source-kind": (19, "declaration-migrated", "the concealed_roll/first_impression/sanity_bout source kinds and their three semantic lookup keys; T2 replaced the fabricated `source_kind: \"roll\"` with the vocabulary play actually produces"),
        "agency-claim-type": (2, "declaration-migrated", "AGENCY_CLAIM_TYPES and VOLUNTARY_CLAIM_TYPES now read from the graph; the two remaining literals are the forced_behavior and involuntary_physiology branch comparisons"),
        "coverage-field": (71, "declaration-migrated", "COVERAGE_FIELDS reads from the graph; the rest are per-field accesses inside coverage construction and validation, which T2 migrates with the derivation laws"),
        "obligation-kind": (6, "usage-only", "namespace names appearing in messages and comments; the grammars themselves are migrated"),
        "obligation-prefix": (1, "declaration-migrated", "T2 cut this over: 13 -> 1. The three id grammars are now composed from the graph's id_prefix, and the single remaining occurrence is the semantic key that looks the prefix up"),
        "realization-mode": (1, "declaration-migrated", "T2 cut this over: 5 -> 1. The remaining occurrence is the semantic key for CONCEALED_REALIZATION"),
        "roll-visibility-class": (7, "declaration-migrated", "both visibility frozensets read from the graph; the rest are per-value comparisons"),
        "segment-type": (43, "declaration-migrated", "T2 cut this over: 51 -> 43. The eight bare 'fiction' sites and the leading-segment ordering law now read LEADING_SEGMENT_TYPE and SEGMENT_TYPES from the graph"),
        "substantive-effect-status": (5, "declaration-migrated", "T2 cut this over: the applied/missing/not_required conditional now reads graph-validated tokens; the remaining occurrences are their three semantic lookup keys plus two comments"),
    },
    "plugins/coc-keeper/scripts/coc_operation_turn_output.py": {
        "obligation-source-kind": (2, "usage-only", "two source_kind comparisons in the output projection"),
        "coverage-field": (21, "reads-from-graph", "the turn.finalize input schema is built from coc_turn_finalization.COVERAGE_FIELDS, which now resolves through the graph; the rest are field accesses"),
        "obligation-prefix": (1, "second-declaration", "line 433 builds a sanity_bout: source_ref for a control override; owned by slice T2"),
        "player-input-handling": (1, "reads-from-graph", "published as a schema enum from the migrated frozenset"),
        "roll-visibility-class": (9, "usage-only", "per-value comparisons in the output projection"),
        "segment-type": (8, "usage-only", "per-type comparisons in mechanics placement"),
        "substantive-effect-status": (2, "usage-only", "status labels copied onto the projection"),
    },
    "plugins/coc-keeper/scripts/coc_narration_style.py": {},
    "plugins/coc-keeper/scripts/coc_narration_contract.py": {
        "obligation-source-kind": (2, "usage-only", "first_impression labels on narration envelope rows"),
        "coverage-field": (1, "usage-only", "a single field access"),
        "obligation-kind": (9, "usage-only", "roll and first_impression labels on narration envelope rows"),
        "roll-visibility-class": (7, "second-declaration", "line 826 inlines {'public', 'consequence_public'} — an independent copy of PLAYER_FACING_ROLL_VISIBILITIES found by this gate; recorded, not repaired in T1"),
    },
    "plugins/coc-keeper/scripts/coc_turn_manifest.py": {},
    "plugins/coc-keeper/scripts/coc_state_authority.py": {
        "coverage-field": (8, "usage-only", "claim rows reuse exact_excerpt and source_ref spellings"),
        "segment-type": (2, "second-declaration", "line 357 iterates ('state_delta', 'asset_delta') as mechanics bundle bucket names — a partial copy of the segment vocabulary; recorded, not repaired in T1"),
    },
    "plugins/coc-keeper/scripts/coc_live_turn_runner.py": {
        "substantive-effect-status": (5, "usage-only", "FALSE POSITIVE: these are {'applied': bool} dict keys in the legacy runtime path, not the substantive-effect-status token. Kept in the census so the count is pinned rather than filtered away by a heuristic"),
    },
    "plugins/coc-keeper/scripts/coc_npc_state.py": {
        "coverage-field": (1, "usage-only", "a single field access"),
        "obligation-prefix": (1, "second-declaration", "line 1290 builds a first-impression: memory id in the same namespace; owned by slice T2"),
    },
    "plugins/coc-keeper/pi/lib/tool-contract-projection.ts": {
        "obligation-source-kind": (1, "usage-only", "one source_kind comparison in the TypeScript projection"),
        "agency-claim-type": (18, "second-declaration", "THREE independent TypeScript copies: exported const REVIEWED_AGENCY_CLAIM_TYPES (line 36) and inline claim_types arrays (lines 1290, 1673). A Python-only residue gate cannot see any of them. This is DirectorGraph correction 6 in another language"),
        "coverage-field": (27, "second-declaration", "coverage row field names re-declared in TypeScript types and projections (lines 1717, 2445, 2704)"),
        "obligation-kind": (10, "usage-only", "source_kind comparisons"),
        "obligation-prefix": (61, "second-declaration", "the full roll:/first-impression:/sanity_bout: triple appears four times plus prose, and roll: alone at roughly thirty more sites. Count grew 59 -> 61 in the 0.8.1a@bb0575d5 merge, which added a `roll:`/`first-impression:` candidate list from another slice; the gate caught the growth, which is what pinning the count is for"),
        "player-input-handling": (9, "second-declaration", "re-declared as a TypeScript union and projection literals (lines 2435, 2797)"),
        "realization-mode": (9, "second-declaration", "re-declared as a TypeScript union type at line 99 and as literals at lines 1276, 1756"),
        "roll-visibility-class": (2, "usage-only", "two comparisons"),
    },
    "plugins/coc-keeper/pi/prompts/host-system-play.md": {
        "coverage-field": (8, "model-facing-copy", "the host prompt republishes the coverage row field names to the KP"),
        "obligation-prefix": (26, "model-facing-copy", "the host prompt republishes the obligation namespaces to the KP"),
        "realization-mode": (1, "model-facing-copy", "one realization value named in prompt prose"),
    },
    "plugins/coc-keeper/references/mcp-operation-contracts.json": {
        "obligation-source-kind": (10, "reads-from-graph", "generated archive; source_kind values reach the model contract through the migrated derivation"),
        "agency-claim-type": (8, "reads-from-graph", "generated archive: the enum is built from the migrated frozenset and rebuilds byte-identically"),
        "coverage-field": (27, "reads-from-graph", "generated archive"),
        "obligation-kind": (2, "reads-from-graph", "generated archive"),
        "player-input-handling": (3, "reads-from-graph", "generated archive"),
        "realization-mode": (2, "reads-from-graph", "generated archive"),
        "roll-visibility-class": (6, "reads-from-graph", "generated archive"),
        "segment-type": (4, "reads-from-graph", "generated archive"),
    },
    "plugins/coc-keeper/skills/coc-export-battle-report/scripts/export_battle_report.py": {
        "obligation-source-kind": (2, "usage-only", "source_kind comparisons while rendering evidence"),
        "agency-claim-type": (8, "usage-only", "report rendering reads claim_type values off accepted finalizations"),
        "coverage-field": (3, "usage-only", "field accesses"),
        "obligation-kind": (15, "usage-only", "source_kind comparisons while rendering evidence"),
        "obligation-prefix": (1, "second-declaration", "line 485 parses the sanity_bout: prefix; owned by slice T2"),
        "roll-visibility-class": (15, "second-declaration", "lines 684-689 reimplement the visibility classification and return 'superseded'/'public'/'keeper_only' independently, alongside a documented import of SUPERSEDED_ROLL_VISIBILITIES; recorded, not repaired in T1"),
        "segment-type": (4, "usage-only", "segment rendering comparisons"),
        "substantive-effect-status": (3, "usage-only", "status labels rendered into the report"),
    },
    "plugins/coc-keeper/skills/coc-keeper-play/SKILL.md": {
        "coverage-field": (1, "model-facing-copy", "Skill prose"),
        "obligation-prefix": (1, "model-facing-copy", "Skill prose"),
    },
    "plugins/coc-keeper/skills/coc-keeper-play/references/compound-and-causal-finalization.md": {
        "coverage-field": (19, "model-facing-copy", "Skill reference republishes the coverage row shape to the KP"),
        "realization-mode": (1, "model-facing-copy", "Skill reference"),
        "segment-type": (1, "model-facing-copy", "Skill reference"),
    },
    # Scanned and clean. Present so the census covers the whole glob: a file
    # that starts spelling an owned vocabulary must show up as a count change,
    # not as an unnoticed new entry.
    "plugins/coc-keeper/skills/coc-keeper-play/references/horror-san-content-endings.md": {},
    "plugins/coc-keeper/skills/coc-keeper-play/references/style-scene-craft.md": {},
    "plugins/coc-keeper/skills/coc-keeper-play/references/declaration-adjudication-and-improv.md": {
        "roll-visibility-class": (1, "model-facing-copy", "Skill reference"),
    },
    "plugins/coc-keeper/skills/coc-keeper-play/references/investigators-horror-npc.md": {
        "coverage-field": (1, "model-facing-copy", "Skill reference"),
    },
    "plugins/coc-keeper/skills/coc-keeper-play/references/turn-tooling-and-typed-ops.md": {
        "obligation-source-kind": (1, "model-facing-copy", "Skill reference"),
        "coverage-field": (1, "model-facing-copy", "Skill reference"),
        "obligation-kind": (1, "model-facing-copy", "Skill reference"),
        "obligation-prefix": (25, "model-facing-copy", "Skill reference republishes the obligation namespaces to the KP"),
        "roll-visibility-class": (1, "model-facing-copy", "Skill reference"),
        "substantive-effect-status": (1, "model-facing-copy", "Skill reference"),
    },
}

# Vocabularies the graph deliberately does NOT own, named so the gate excludes
# them explicitly rather than by omission. DirectorGraph's lesson was that
# "out of scope" and "not looked at" must never be the same thing.
EXPLICIT_EXCLUSIONS = {
    "coc_turn_finalization.ASSET_EFFECT_KINDS":
        "cash/item/purchase/assets_liquidate name state mutation kinds owned by "
        "the rules and state layers, not presentation tokens.",
    "coc_turn_finalization.MAX_ACCEPTED_REVISION":
        "a numeric threshold; text-threshold nodes arrive in slice T4.",
    "coc_operation_turn_output.allowed_rule_ids":
        "the review-rule vocabulary belongs to the craft plane, slice T4.",
    "coc_operation_turn_output._narration_budget":
        "the budget ladder is a narration-budget-mode vocabulary, slice T4.",
    "coc_narration_style._HORROR_AXES":
        "Director doctrine, not presentation: build_horror_profile is consumed "
        "only by coc_story_director.py:4419 inside the director.advise payload.",
    "coc_narration_style._HORROR_STAGE_BASE":
        "Director doctrine; four stages carrying ten weights. Same owner.",
    "coc_narration_style._HORROR_TAG_WEIGHTS":
        "Director doctrine; five tags carrying five weights. Same owner.",
    "coc_narration_style.regex-and-phrase-tables":
        "the eight re.compile objects, two phrase tables and the thirteen-pair "
        "substitution table are deleted in slice T4, not migrated. Authority "
        "law 2 forbids moving them into the artifact.",
    "numeric-doctrine-residue":
        "the numeric residue gate (66 non-trivial literals across the surface) "
        "arrives with the text-threshold nodes in slice T4. T1 owns no numeric "
        "value, so a numeric gate here would assert nothing.",
}


def _owned_tokens() -> dict[str, set[str]]:
    by_kind: dict[str, set[str]] = collections.defaultdict(set)
    for node in ARTIFACT["nodes"]:
        by_kind[node["node_kind"]].add(node["properties"]["legacy_key"])
    by_kind["obligation-prefix"] = {
        node["properties"]["id_prefix"]
        for node in ARTIFACT["nodes"]
        if node["node_kind"] == "obligation-kind"
    }
    return dict(by_kind)


def _scanned_paths() -> list[str]:
    paths = list(TEXT_SURFACE)
    paths += sorted(
        str(p.relative_to(REPO))
        for p in REPO.glob(SKILL_REFERENCE_GLOB)
    )
    return sorted(set(paths))


SCANNER_LIMITS = """What this scanner does not catch, stated so the gate is not oversold:

  - a token assembled by concatenation or interpolation from parts
    (`"roll" + ":"`), because it never appears as one literal;
  - a token in unquoted prose ("the roll namespace"), which is documentation
    rather than a declaration;
  - a rename that changes both the graph and a copy in the same commit, which
    the identity tests cover instead.

It over-reports rather than under-reports: a dict key or a field name that
happens to share a token's spelling is counted, and stays counted, because a
heuristic that filtered those would also filter a real copy.
"""


def _scan() -> dict[str, dict[str, int]]:
    tokens = _owned_tokens()
    found: dict[str, dict[str, int]] = {}
    for path in _scanned_paths():
        text = (REPO / path).read_text(encoding="utf-8")
        per_kind: dict[str, int] = {}
        for kind, keys in tokens.items():
            count = 0
            for key in keys:
                pattern = (
                    r"[\"'`]" + re.escape(key)
                    if kind == "obligation-prefix"
                    else r"[\"'`]" + re.escape(key) + r"[\"'`]"
                )
                count += len(re.findall(pattern, text))
            if count:
                per_kind[kind] = count
        found[path] = per_kind
    return found


def test_every_owned_token_in_the_text_surface_is_classified():
    """The gate. Cross-language, whole surface, from the first slice.

    A hit means one of three things, and it must say which: the declaration
    moved into the graph, the file reads it from the graph, or it is a second
    copy with a named owning slice. It never goes nowhere.
    """
    found = _scan()
    problems: list[str] = []

    for path, per_kind in sorted(found.items()):
        declared = CENSUS.get(path)
        if declared is None:
            problems.append(
                f"{path}: in the scanned surface but absent from CENSUS "
                f"(found {per_kind}). Classify it; do not delete it from the surface."
            )
            continue
        for kind, count in sorted(per_kind.items()):
            if kind not in declared:
                problems.append(
                    f"{path}: {kind} appears {count}x and is unclassified — a new "
                    "copy of a vocabulary the graph owns"
                )
                continue
            expected, classification, reason = declared[kind]
            if classification not in CLASSIFICATIONS:
                problems.append(f"{path}: {kind} has unknown classification {classification!r}")
            if not reason.strip():
                problems.append(f"{path}: {kind} carries no reason")
            if count != expected:
                problems.append(
                    f"{path}: {kind} count moved {expected} -> {count}. Either a "
                    "copy was added or one was removed; update the census in the "
                    "same reviewed change."
                )
        for kind in sorted(set(declared) - set(per_kind)):
            problems.append(
                f"{path}: {kind} is in the census but no longer found; remove the "
                "stale entry so the census cannot rot"
            )

    assert not problems, (
        "TextGraph residue gate:\n  " + "\n  ".join(problems)
    )


def test_the_residue_gate_covers_the_declared_surface():
    """Guard against the gate narrowing back to a self-confirming subset.

    DirectorGraph's first gate covered only the functions its own migration
    touched. This assertion is what stops that happening here.
    """
    scanned = set(_scanned_paths())
    assert set(TEXT_SURFACE) <= scanned
    for path in scanned:
        assert (REPO / path).is_file(), path
    # Non-Python files are in the surface on purpose.
    assert any(p.endswith(".ts") for p in scanned)
    assert any(p.endswith(".md") for p in scanned)
    assert any(p.endswith(".json") for p in scanned)
    # And the census covers exactly what is scanned.
    assert set(CENSUS) == scanned


def test_the_gate_fails_when_a_new_copy_appears(tmp_path):
    """The gate must actually catch a duplicate, not merely be present."""
    tokens = _owned_tokens()
    sample = sorted(tokens["realization-mode"])
    injected = "const X = [" + ", ".join(f'"{t}"' for t in sample) + "];"
    probe = tmp_path / "new-projection.ts"
    probe.write_text(injected, encoding="utf-8")
    count = 0
    for key in sample:
        count += len(re.findall(r"[\"'`]" + re.escape(key) + r"[\"'`]", injected))
    assert count == len(sample) > 0, "the scanner must see a TypeScript array copy"


def test_every_exclusion_states_a_reason():
    for name, reason in EXPLICIT_EXCLUSIONS.items():
        assert reason.strip(), name
        assert len(reason) > 40, f"{name} needs a real reason, not a label"


def test_the_gate_states_its_own_limits():
    """A gate that oversells its coverage is worse than a narrower honest one."""
    assert "does not catch" in SCANNER_LIMITS
    assert "over-reports rather than under-reports" in SCANNER_LIMITS


def test_the_second_declarations_this_gate_found_are_recorded():
    """T1 records duplicates; it does not repair them.

    Three of these were not in the pre-slice inventory and were found by the
    gate itself, which is the point of running it before rather than after.
    """
    second = {
        (path, kind)
        for path, per_kind in CENSUS.items()
        for kind, (_, classification, _) in per_kind.items()
        if classification == "second-declaration"
    }
    for expected in (
        # in the inventory already
        ("plugins/coc-keeper/pi/lib/tool-contract-projection.ts", "obligation-prefix"),
        ("plugins/coc-keeper/scripts/coc_npc_state.py", "obligation-prefix"),
        # found by this gate
        ("plugins/coc-keeper/pi/lib/tool-contract-projection.ts", "agency-claim-type"),
        ("plugins/coc-keeper/pi/lib/tool-contract-projection.ts", "realization-mode"),
        ("plugins/coc-keeper/scripts/coc_narration_contract.py", "roll-visibility-class"),
        ("plugins/coc-keeper/scripts/coc_state_authority.py", "segment-type"),
        (
            "plugins/coc-keeper/skills/coc-export-battle-report/scripts/"
            "export_battle_report.py",
            "roll-visibility-class",
        ),
    ):
        assert expected in second, expected


# ---------------------------------------------------------------------------
# Authority law 2, asserted against the artifact itself
# ---------------------------------------------------------------------------

def test_the_artifact_contains_no_matcher():
    """No regex, phrase list, or substitution table may enter the graph."""
    raw = ARTIFACT_PATH.read_text(encoding="utf-8")
    for marker in ("re.compile", "\\\\b", "(?:", "[^", ".*", "regex", "pattern"):
        assert marker not in raw, marker
    for node in ARTIFACT["nodes"]:
        for value in node["properties"].values():
            assert not isinstance(value, str) or len(value) < 64, node["node_id"]


# ---------------------------------------------------------------------------
# T2 gate 4 — `fiction` is data, not a bare string at eight sites
# ---------------------------------------------------------------------------

def test_no_bare_fiction_literal_remains_in_the_finalizer():
    """This one lands in player-visible output, not an internal loop.

    Before T2 the leading segment type was spelled as a bare string at eight
    sites and its ordering law lived at coc_turn_finalization.py:563. Both are
    graph data now.
    """
    source = (SCRIPTS / "coc_turn_finalization.py").read_text("utf-8")
    assert '"fiction"' not in source
    assert "'fiction'" not in source
    assert "LEADING_SEGMENT_TYPE" in source
    # The membership check no longer unions a literal into the frozenset.
    assert '{"fiction", *MECHANIC_SEGMENT_TYPES}' not in source
    assert "allowed_segment_types = set(SEGMENT_TYPES)" in source


def test_the_leading_segment_ordering_law_reads_the_graph():
    source = (SCRIPTS / "coc_turn_finalization.py").read_text("utf-8")
    assert (
        'if segments[0].get("segment_type") != LEADING_SEGMENT_TYPE:' in source
    ), "the segments[0] ordering law must compare against graph data"


def test_the_id_grammars_are_composed_from_the_graph_prefix():
    """Obligation ids are composed, never parsed by splitting on a colon.

    Source ids contain colons (`npc-first-impression-v2:eb57c5df...`), so a
    split-based parse would truncate them.
    """
    source = (SCRIPTS / "coc_turn_finalization.py").read_text("utf-8")
    for spelling in ('f"roll:{', 'f"first-impression:{', 'f"sanity_bout:{'):
        assert spelling not in source, spelling
    for constant in (
        "ROLL_OBLIGATION_PREFIX",
        "FIRST_IMPRESSION_OBLIGATION_PREFIX",
        "SANITY_BOUT_OBLIGATION_PREFIX",
    ):
        assert constant in source, constant


def test_the_synthetic_repair_source_kind_is_excluded_not_migrated():
    """`repair` is written by the undelivered-narration path and produced by no
    settled receipt, so calling it settled-effect-derived would be false."""
    source = (SCRIPTS / "coc_turn_finalization.py").read_text("utf-8")
    assert '_REPAIR_SOURCE_KIND = "repair"' in source
    owned = {
        node["properties"]["legacy_key"] for node in ARTIFACT["nodes"]
        if node["node_kind"] == "obligation-source-kind"
    }
    assert "repair" not in owned


def test_the_model_facing_obligation_labels_are_unchanged():
    """`_obligation_public_label` builds the semantic handles the KP reads.

    It now composes them from the graph's prefixes. These six shapes are every
    branch of that function, pinned byte-for-byte against the pre-T2 spellings.
    """
    finalizer = _load(
        "coc_turn_finalization_labels",
        "plugins/coc-keeper/scripts/coc_turn_finalization.py",
    )
    cases = [
        ({"source_kind": "first_impression", "npc_display_name": "Mr Knott"},
         "first-impression:mr-knott"),
        ({"source_kind": "first_impression", "npc_display_name": ""},
         "first-impression"),
        ({"source_kind": "sanity_bout"}, "sanity_bout"),
        ({"source_kind": "check", "skill": "Spot Hidden"}, "roll:spot-hidden"),
        ({"source_kind": "amount"}, "roll:amount"),
        ({"source_kind": ""}, "roll"),
    ]
    for row, expected in cases:
        assert finalizer._obligation_public_label(row) == expected, row


def test_the_segment_vocabulary_still_unions_the_way_the_source_did():
    finalizer = _load(
        "coc_turn_finalization_segments",
        "plugins/coc-keeper/scripts/coc_turn_finalization.py",
    )
    assert set(finalizer.SEGMENT_TYPES) == {
        finalizer.LEADING_SEGMENT_TYPE, *finalizer.MECHANIC_SEGMENT_TYPES
    }
    assert finalizer.LEADING_SEGMENT_TYPE not in finalizer.MECHANIC_SEGMENT_TYPES
