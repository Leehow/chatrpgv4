#!/usr/bin/env python3
"""TextGraph compiler — obligation plane (slice T1).

Spec: docs/specs/pi-coc-text-graph-runtime.md
Inventory: docs/status/text-layer-obligation-inventory.md

TextGraph is a *presentation* graph. Unlike DirectorGraph it is not mostly a
doctrine ledger — the text layer holds 66 non-trivial numbers across 10,915
lines, 15 of them Director-owned — and unlike RuleGraph it needs no source
corpus, because its obligation plane is **derived**: every obligation the
finalizer requires is computed from a settled receipt that the rules layer
already wrote this turn.

What this slice migrates is therefore vocabulary, not tuning: the nine
module-level closed vocabularies in ``coc_turn_finalization`` that decide what
a coverage row may say, which rolls face the player, and how mechanics segments
are ordered. They matter because they cross the model-visible surface —
``turn.output_context`` and ``turn.finalize`` publish several of them as JSON
Schema enums, and an unknown token is a hard rejection — so a rename is a live
protocol break, not a refactor.

Three stages mirror ``coc_rule_graph.py`` and ``coc_director_graph.py``:

    prepare(plane)   -> a closed packet describing what may be transcribed
    accept(shard)    -> deterministic findings for one candidate shard
    build(shards)    -> merged graph + manifest with a content digest

``build_from_legacy_sources()`` composes the production artifact from the
frozen ``LEGACY_*`` tables below. Those tables are transcribed byte-identically
from the declarations they replace; moving them out of
``coc_turn_finalization.py`` IS the migration.

The compiler never judges prose, never matches a pattern, and never reads a
draft.
"""
from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
REFERENCES_DIR = SCRIPT_DIR.parent / "references"
CONTRACT_PATH = REFERENCES_DIR / "text-graph-contract-v1.json"
RULE_GRAPH_PATH = SCRIPT_DIR.parent / "rulesets" / "coc7" / "rule-graph.json"

CONTRACT = json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))

CONTRACT_ID = str(CONTRACT["contract_id"])
GRAPH_CONTRACT_ID = str(CONTRACT["graph_contract_id"])
SHARD_CONTRACT_ID = str(CONTRACT["shard_contract_id"])
PACKET_CONTRACT_ID = str(CONTRACT["packet_contract_id"])
BUILD_MANIFEST_CONTRACT_ID = str(CONTRACT["build_manifest_contract_id"])
COMPILER_IDENTITY = str(CONTRACT["compiler_identity"])
SCHEMA_VERSION = int(CONTRACT["schema_version"])

GRAPH_ID = "graph:text:production"

NODE_KINDS = frozenset(CONTRACT["node_kinds"])
OBLIGATION_NODE_KINDS = frozenset(CONTRACT["obligation_node_kinds"])
CRAFT_NODE_KINDS = frozenset(CONTRACT["craft_node_kinds"])
RELATION_KINDS = frozenset(CONTRACT["relation_kinds"])
EVIDENCE_CLASSES = frozenset(CONTRACT["evidence_classes"])
PLANES = tuple(CONTRACT["planes"])
NODE_KEYS = frozenset(CONTRACT["node_keys"])
OPTIONAL_NODE_KEYS = frozenset(CONTRACT["optional_node_keys"])
RELATION_KEYS = frozenset(CONTRACT["relation_keys"])
EVIDENCE_REQUIRED = CONTRACT["evidence_class_required_keys"]
NODE_PROPERTY_KEYS = CONTRACT["node_property_keys"]
EXPECTED_NODE_COUNTS = CONTRACT["expected_node_counts"]

SEMANTIC_ID_RE = re.compile(str(CONTRACT["semantic_id_pattern"]))

# A relation whose target lives in another graph. Its endpoint is a RuleGraph
# or live-state semantic id, so reference closure is a slice-T3 job against the
# system ontology registry, not a within-artifact lookup.
EXTERNAL_TARGET_RELATION_KINDS = frozenset({"renders-settled-output"})


def _renderable_rule_effects() -> dict[str, str]:
    """Return {effect node id: visibility} from the production RuleGraph.

    Read live, so an effect that is renamed, removed, or reclassified in the
    RuleGraph breaks the TextGraph build instead of leaving a stale edge.
    """
    try:
        graph = json.loads(RULE_GRAPH_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return {
        str(node["node_id"]): str(node.get("visibility") or "")
        for node in graph.get("nodes") or []
        if isinstance(node, dict) and node.get("node_kind") == "effect"
    }

# --------------------------------------------------------------------------
# Frozen legacy declarations being migrated out of coc_turn_finalization.py.
#
# Order below is the exact source declaration order. Per the contract's
# ordinal_law, only two of these orders are behaviourally observable —
# SEGMENT_TYPE_ORDER and the leading-segment law — and the runtime rebuilds the
# rest as unordered sets so no consumer can start depending on an order the
# frozensets never had.
# --------------------------------------------------------------------------

# coc_turn_finalization._build_obligations (roll:, first-impression:) and
# _build_sanity_bout_obligations (sanity_bout:). These three id namespaces are
# the entire obligation vocabulary; a fourth would be a new kind of thing the
# player must be told about.
LEGACY_OBLIGATION_KINDS: tuple[tuple[str, str, str], ...] = (
    # (legacy_key, id_prefix, builder)
    ("roll", "roll:", "_build_obligations"),
    ("first-impression", "first-impression:", "_build_obligations"),
    ("sanity_bout", "sanity_bout:", "_build_sanity_bout_obligations"),
)

# The source_kind each namespace may write onto an obligation row.
#
# T1 carried a single `source_kind: "roll"` scalar on the roll namespace. That
# value never occurs: `_build_obligations` writes "concealed_roll" for a hidden
# roll and otherwise whatever `_roll_kind` returns, which is "amount" or
# "check". Replaying the preserved corpus produced check 355, amount 11,
# concealed_roll 4 and first_impression 48 — and no "roll" at all. A node
# property that names nothing is exactly the unaccountable value this graph
# exists to remove, so the scalar is gone and the real vocabulary is here.
LEGACY_OBLIGATION_SOURCE_KINDS: tuple[tuple[str, str], ...] = (
    # (legacy_key, owning obligation-kind legacy_key)
    ("check", "roll"),
    ("amount", "roll"),
    ("concealed_roll", "roll"),
    ("first_impression", "first-impression"),
    ("sanity_bout", "sanity_bout"),
)

LEGACY_COVERAGE_FIELDS: tuple[str, ...] = (
    "obligation_id", "realization", "action_realization", "response",
    "causal_explanation", "persona_fit", "player_input_handling",
    "exact_excerpt", "exceptional_beat",
)

LEGACY_REALIZATION_VALUES: tuple[str, ...] = (
    "fictional_beat", "concealed_no_player_visible_beat",
)

LEGACY_PLAYER_INPUT_HANDLING_VALUES: tuple[str, ...] = (
    "abstract_completed", "specific_preserved", "not_applicable",
)

# fiction is NOT a member of MECHANIC_SEGMENT_TYPES, yet it is the most common
# segment type in play (1746 of 2219 preserved segments) and carries its own
# ordering law at coc_turn_finalization.py:563 — segments[0] must be fiction.
# It is represented here so the vocabulary is complete; the eight bare-string
# sites that still spell it migrate in T2.
LEGACY_SEGMENT_TYPES: tuple[tuple[str, bool, int | None, bool], ...] = (
    # (legacy_key, mechanic, mechanic_placement_order, must_lead)
    ("fiction", False, None, True),
    ("public_check", True, 0, False),
    ("state_delta", True, 1, False),
    ("asset_delta", True, 2, False),
    ("exceptional_effect", True, 3, False),
)

# AGENCY_CLAIM_TYPES is literally `{*VOLUNTARY_CLAIM_TYPES, "forced_behavior",
# "involuntary_physiology"}`, so the subset relation is carried as a property
# rather than an edge: that is how the source reconstructs both frozensets.
LEGACY_AGENCY_CLAIM_TYPES: tuple[tuple[str, bool], ...] = (
    ("voluntary_action", True),
    ("voluntary_speech", True),
    ("voluntary_plan", True),
    ("voluntary_belief", True),
    ("voluntary_trust", True),
    ("voluntary_active_emotion", True),
    ("forced_behavior", False),
    ("involuntary_physiology", False),
)

LEGACY_ROLL_VISIBILITY_CLASSES: tuple[tuple[str, bool, bool], ...] = (
    # (legacy_key, player_facing, superseded)
    ("public", True, False),
    ("consequence_public", True, False),
    ("superseded", False, True),
    ("voided", False, True),
    ("corrected_hidden", False, True),
    ("keeper_only", False, True),
)

# From the conditional expression in _build_obligations that sets
# substantive_effect_status. There is no frozenset for it in the source; the
# vocabulary is implicit in one expression, which is exactly the kind of
# undeclared closed set this graph exists to surface.
LEGACY_SUBSTANTIVE_EFFECT_STATUSES: tuple[str, ...] = (
    "applied", "missing", "not_required",
)

# What each obligation-plane vocabulary is derived from, for the contract's
# accountability_law. These are receipt fields and settlement facts, not
# design choices — which is why the whole plane is settled-effect-derived and
# needs no source corpus.
DERIVED_FROM: dict[str, str] = {
    "obligation-kind": (
        "settled receipts in the pending turn window: rules.roll/rules.push roll "
        "receipts, first-impression context effects, and sanity bout events"
    ),
    "obligation-source-kind": (
        "the source_kind written onto each obligation row by _build_obligations "
        "and _build_sanity_bout_obligations: the roll's visibility decides "
        "concealed_roll, otherwise _roll_kind returns amount or check"
    ),
    "coverage-field": (
        "the closed coverage row schema turn.finalize accepts, validated by "
        "coc_turn_finalization.validate_coverage"
    ),
    "realization-mode": (
        "whether the settled roll was player-facing; a concealed roll may close "
        "without a visible beat, every other obligation may not"
    ),
    "player-input-handling": (
        "how the settled turn's player_action was carried into the rendered beat"
    ),
    "segment-type": (
        "the settled mechanics projection: public rolls, state deltas, asset "
        "deltas and exceptional effect applications, plus the fiction body"
    ),
    "agency-claim-type": (
        "the settled control-override receipts and the player-authored input "
        "that authorize a proposition about the investigator"
    ),
    "roll-visibility-class": (
        "the visibility field written on each settled roll receipt"
    ),
    "substantive-effect-status": (
        "whether an exceptional_effect apply receipt exists for the settled "
        "critical/fumble/pushed-failure roll it must be bound to"
    ),
}


def _slug(token: str) -> str:
    """Map a legacy token to a kebab-case semantic id segment."""
    return token.strip().lower().replace("_", "-")


def _finding(code: str, path: str, message: str) -> dict[str, str]:
    return {"code": code, "path": path, "message": message}


def legacy_vocabulary() -> dict[str, list[str]]:
    """Return every legacy vocabulary token, keyed by target node_kind."""
    return {
        "obligation-kind": [row[0] for row in LEGACY_OBLIGATION_KINDS],
        "obligation-source-kind": [row[0] for row in LEGACY_OBLIGATION_SOURCE_KINDS],
        "coverage-field": list(LEGACY_COVERAGE_FIELDS),
        "realization-mode": list(LEGACY_REALIZATION_VALUES),
        "player-input-handling": list(LEGACY_PLAYER_INPUT_HANDLING_VALUES),
        "segment-type": [row[0] for row in LEGACY_SEGMENT_TYPES],
        "agency-claim-type": [row[0] for row in LEGACY_AGENCY_CLAIM_TYPES],
        "roll-visibility-class": [row[0] for row in LEGACY_ROLL_VISIBILITY_CLASSES],
        "substantive-effect-status": list(LEGACY_SUBSTANTIVE_EFFECT_STATUSES),
    }


# --------------------------------------------------------------------------
# Stage 1 — prepare
# --------------------------------------------------------------------------

def prepare(plane: str) -> dict[str, Any]:
    """Build a closed packet describing what one plane may transcribe."""
    if plane not in PLANES:
        raise ValueError(f"unknown plane {plane!r}")
    kinds = (
        sorted(OBLIGATION_NODE_KINDS) if plane == "obligation"
        else sorted(CRAFT_NODE_KINDS)
    )
    legacy_sources = (
        [
            "coc_turn_finalization.COVERAGE_FIELDS",
            "coc_turn_finalization.REALIZATION_VALUES",
            "coc_turn_finalization.PLAYER_INPUT_HANDLING_VALUES",
            "coc_turn_finalization.MECHANIC_SEGMENT_TYPES",
            "coc_turn_finalization.SEGMENT_TYPE_ORDER",
            "coc_turn_finalization.AGENCY_CLAIM_TYPES",
            "coc_turn_finalization.VOLUNTARY_CLAIM_TYPES",
            "coc_turn_finalization.PLAYER_FACING_ROLL_VISIBILITIES",
            "coc_turn_finalization.SUPERSEDED_ROLL_VISIBILITIES",
            "coc_turn_finalization._build_obligations",
            "coc_turn_finalization._build_sanity_bout_obligations",
        ] if plane == "obligation" else [
            "coc_operation_turn_output.allowed_rule_ids",
            "coc_operation_turn_output._narration_budget",
            "coc_narration_style._CRISIS_RENDER_REQUIRED_SLOTS",
            "coc_narration_style._PLAYER_VISIBLE_MUST_NOT",
            "coc_narration_style.player_visible_style_guard_contract",
            "coc_narration_style.player_facing_style_contract",
        ]
    )
    return {
        "contract_id": PACKET_CONTRACT_ID,
        "schema_version": SCHEMA_VERSION,
        "plane": plane,
        "available_node_kinds": kinds,
        "legacy_sources": legacy_sources,
    }


# --------------------------------------------------------------------------
# Stage 2 — accept
# --------------------------------------------------------------------------

def accept(
    shard: Any, known_node_ids: frozenset[str] | None = None
) -> list[dict[str, str]]:
    """Deterministically validate one candidate shard. Returns findings."""
    findings: list[dict[str, str]] = []
    if not isinstance(shard, dict):
        return [_finding("invalid_shard", "/", "shard must be an object")]
    if set(shard) != frozenset(CONTRACT["shard_keys"]):
        findings.append(_finding(
            "shard_key_mismatch", "/", "shards use the exact closed key set"
        ))
    if shard.get("contract_id") != SHARD_CONTRACT_ID:
        findings.append(_finding(
            "wrong_contract_id", "/contract_id", str(shard.get("contract_id"))
        ))
    plane = shard.get("plane")
    if plane not in PLANES:
        findings.append(_finding("unknown_plane", "/plane", str(plane)))
    allowed_kinds = (
        OBLIGATION_NODE_KINDS if plane == "obligation"
        else CRAFT_NODE_KINDS if plane == "craft"
        else NODE_KINDS
    )

    nodes = shard.get("nodes")
    if not isinstance(nodes, list):
        return findings + [_finding("invalid_nodes", "/nodes", "nodes must be an array")]

    seen: set[str] = set()
    for index, node in enumerate(nodes):
        path = f"/nodes/{index}"
        if not isinstance(node, dict):
            findings.append(_finding("invalid_node", path, "node must be an object"))
            continue
        node_id = str(node.get("node_id") or "")
        kind = str(node.get("node_kind") or "")

        if kind not in NODE_KINDS:
            findings.append(_finding("unknown_node_kind", f"{path}/node_kind", kind))
        elif kind not in allowed_kinds:
            findings.append(_finding(
                "node_kind_outside_plane", f"{path}/node_kind",
                f"{kind} does not belong to plane {plane!r}",
            ))

        if not SEMANTIC_ID_RE.fullmatch(node_id):
            findings.append(_finding("invalid_semantic_id", f"{path}/node_id", node_id))
        elif not node_id.startswith(f"{kind}:"):
            findings.append(_finding(
                "node_id_kind_mismatch", f"{path}/node_id",
                f"node id must begin with {kind!r}",
            ))
        if node_id in seen:
            findings.append(_finding("duplicate_node_id", f"{path}/node_id", node_id))
        seen.add(node_id)

        extra = set(node) - NODE_KEYS - OPTIONAL_NODE_KEYS
        if extra:
            findings.append(_finding("unknown_node_key", path, ", ".join(sorted(extra))))
        missing = NODE_KEYS - set(node)
        if missing:
            findings.append(_finding("missing_node_key", path, ", ".join(sorted(missing))))

        properties = node.get("properties")
        if not isinstance(properties, dict):
            findings.append(_finding(
                "invalid_properties", f"{path}/properties", "must be an object"
            ))
        elif kind in NODE_PROPERTY_KEYS:
            allowed = set(NODE_PROPERTY_KEYS[kind])
            unknown = set(properties) - allowed
            if unknown:
                findings.append(_finding(
                    "unknown_property", f"{path}/properties", ", ".join(sorted(unknown))
                ))
            absent = allowed - set(properties)
            if absent:
                findings.append(_finding(
                    "missing_property", f"{path}/properties", ", ".join(sorted(absent))
                ))
            ordinal = properties.get("ordinal")
            if not isinstance(ordinal, int) or isinstance(ordinal, bool) or ordinal < 0:
                findings.append(_finding(
                    "invalid_ordinal", f"{path}/properties/ordinal", str(ordinal)
                ))

        findings.extend(_accountability_findings(node, path))
        findings.extend(_no_body_copy_findings(node, path))

    relations = shard.get("relations")
    if not isinstance(relations, list):
        findings.append(_finding("invalid_relations", "/relations", "must be an array"))
    else:
        for index, relation in enumerate(relations):
            path = f"/relations/{index}"
            if not isinstance(relation, dict):
                findings.append(_finding("invalid_relation", path, "must be an object"))
                continue
            relation_kind = relation.get("relation_kind")
            if relation_kind not in RELATION_KINDS:
                findings.append(_finding(
                    "unknown_relation_kind", f"{path}/relation_kind", str(relation_kind)
                ))
            if set(relation) != RELATION_KEYS:
                findings.append(_finding(
                    "relation_key_mismatch", path,
                    "relations use the exact closed key set",
                ))
            resolvable = seen | (known_node_ids or frozenset())
            endpoints = (
                ("from_node_id",) if relation_kind in EXTERNAL_TARGET_RELATION_KINDS
                else ("from_node_id", "to_node_id")
            )
            for endpoint in endpoints:
                target = str(relation.get(endpoint) or "")
                if target and target not in resolvable:
                    findings.append(_finding(
                        "dangling_relation", f"{path}/{endpoint}", target
                    ))
            if relation_kind == "renders-settled-output":
                findings.extend(_renders_settled_output_findings(relation, path))
    return findings


def _renders_settled_output_findings(
    relation: dict[str, Any], path: str
) -> list[dict[str, str]]:
    """Contract renders_settled_output_law.

    The keeper-only check is the one with a consequence outside the validator:
    an edge here declares that the effect reaches the player, so pointing it at
    keeper-only material is a secrecy defect that would show up at the table.
    """
    target = str(relation.get("to_node_id") or "")
    effects = _renderable_rule_effects()
    if not effects:
        return [_finding(
            "rule_graph_unavailable", f"{path}/to_node_id",
            "renders-settled-output cannot be validated without the production "
            "RuleGraph; the build fails closed rather than accepting an "
            "unverifiable cross-graph claim",
        )]
    if target not in effects:
        return [_finding(
            "unknown_rule_effect", f"{path}/to_node_id",
            f"{target} is not an effect node in the production RuleGraph",
        )]
    if effects[target] != "public":
        return [_finding(
            "keeper_only_target", f"{path}/to_node_id",
            f"{target} is {effects[target]!r}; presentation may not declare it "
            "rendered to the player",
        )]
    return []


def _accountability_findings(node: dict[str, Any], path: str) -> list[dict[str, str]]:
    """Contract accountability_law: every node says where its value came from."""
    findings: list[dict[str, str]] = []
    evidence_class = node.get("evidence_class")
    if evidence_class not in EVIDENCE_CLASSES:
        return [_finding(
            "missing_evidence_class", f"{path}/evidence_class", str(evidence_class)
        )]
    for field in EVIDENCE_REQUIRED[evidence_class]:
        value = node.get(field)
        ok = (
            bool(value) if field == "source_refs"
            else isinstance(value, str) and bool(value.strip())
        )
        if not ok:
            findings.append(_finding(
                "missing_accountability", f"{path}/{field}",
                f"{evidence_class} requires a non-empty {field}",
            ))
    return findings


# Keys that only ever appear on a record this graph names but does not own: a
# RuleGraph effect body, a settled receipt, or a coverage row.
_FOREIGN_BODY_KEYS = frozenset({
    "nodes", "relations", "evidence_span_ids", "coverage", "segments",
    "obligations", "rendered_text", "draft_text", "exact_excerpt",
    "action_realization", "causal_explanation", "persona_fit", "response",
    "effect_kind", "storylets", "roll_id", "bundle",
})


def _no_body_copy_findings(node: dict[str, Any], path: str) -> list[dict[str, str]]:
    """Contract no_body_copy_law: nodes carry identity and order, not bodies.

    DirectorGraph's D1 first embedded full storylet and time-cost payloads,
    which made the artifact 464KB and created a second copy of two package
    tables whose real consumers still read the originals. The check is cheap
    and it runs from the first commit here rather than after the mistake.
    """
    properties = node.get("properties")
    if not isinstance(properties, dict):
        return []
    offending = sorted(_FOREIGN_BODY_KEYS & set(properties))
    if offending:
        return [_finding(
            "body_copy", f"{path}/properties",
            "node carries the body of a record it only names: " + ", ".join(offending),
        )]
    return []


# --------------------------------------------------------------------------
# Stage 3 — build
# --------------------------------------------------------------------------

def _canonical_json(payload: Any) -> str:
    return json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def build(shards: list[dict[str, Any]]) -> dict[str, Any]:
    """Merge accepted shards into one graph plus its build manifest."""
    nodes: list[dict[str, Any]] = []
    relations: list[dict[str, Any]] = []
    plane_coverage = {plane: "unresolved" for plane in PLANES}
    shard_ids: list[str] = []

    all_node_ids = frozenset(
        str(node.get("node_id") or "")
        for shard in shards
        for node in (shard.get("nodes") or [])
        if isinstance(node, dict)
    )
    for shard in shards:
        findings = accept(shard, known_node_ids=all_node_ids)
        if findings:
            raise ValueError(
                f"shard {shard.get('shard_id')!r} is not acceptable: {findings}"
            )
        shard_ids.append(str(shard["shard_id"]))
        nodes.extend(shard["nodes"])
        relations.extend(shard["relations"])
        plane_coverage[str(shard["plane"])] = "accepted"

    counts: dict[str, int] = {}
    for node in nodes:
        counts[node["node_kind"]] = counts.get(node["node_kind"], 0) + 1
    for kind, expected in EXPECTED_NODE_COUNTS.items():
        actual = counts.get(kind, 0)
        if actual != expected:
            raise ValueError(
                f"expected_node_counts_law: {kind} built {actual}, contract "
                f"pins {expected}. Either the source declaration changed and "
                f"the contract must be updated in the same reviewed change, "
                f"or the migration lost something."
            )

    nodes.sort(key=lambda row: row["node_id"])
    relations.sort(key=lambda row: row["relation_id"])

    graph = {
        "contract_id": GRAPH_CONTRACT_ID,
        "schema_version": SCHEMA_VERSION,
        "graph_id": GRAPH_ID,
        "nodes": nodes,
        "relations": relations,
        "coverage": plane_coverage,
    }
    manifest = {
        "contract_id": BUILD_MANIFEST_CONTRACT_ID,
        "schema_version": SCHEMA_VERSION,
        "graph_id": GRAPH_ID,
        "graph_content_digest": hashlib.sha256(
            _canonical_json(graph).encode("utf-8")
        ).hexdigest(),
        "shards": sorted(shard_ids),
        "plane_coverage": plane_coverage,
        "compiler_identity": COMPILER_IDENTITY,
        "node_counts": dict(sorted(counts.items())),
    }
    return {"graph": graph, "manifest": manifest}


# --------------------------------------------------------------------------
# Production artifact composition
# --------------------------------------------------------------------------

def _node(
    kind: str,
    legacy_key: str,
    name: str,
    ordinal: int,
    properties: dict[str, Any] | None = None,
    *,
    id_token: str | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {"legacy_key": legacy_key, "ordinal": ordinal}
    payload.update(properties or {})
    return {
        "node_id": f"{kind}:{id_token or _slug(legacy_key)}",
        "node_kind": kind,
        "plane": "obligation",
        "name": name,
        "evidence_class": "settled-effect-derived",
        "derived_from": DERIVED_FROM[kind],
        "properties": payload,
    }


def obligation_shard() -> dict[str, Any]:
    """Compose the T1 obligation shard from the frozen legacy declarations."""
    nodes: list[dict[str, Any]] = []

    for ordinal, (key, prefix, builder) in enumerate(LEGACY_OBLIGATION_KINDS):
        nodes.append(_node(
            "obligation-kind", key,
            f"obligations in the {prefix} namespace", ordinal,
            {"id_prefix": prefix, "builder": builder},
        ))

    for ordinal, (key, owner) in enumerate(LEGACY_OBLIGATION_SOURCE_KINDS):
        nodes.append(_node(
            "obligation-source-kind", key,
            f"source kind {key}", ordinal, {"obligation_kind": owner},
        ))

    for ordinal, key in enumerate(LEGACY_COVERAGE_FIELDS):
        nodes.append(_node(
            "coverage-field", key, f"coverage row field {key}", ordinal
        ))

    for ordinal, key in enumerate(LEGACY_REALIZATION_VALUES):
        nodes.append(_node(
            "realization-mode", key, f"realization {key}", ordinal
        ))

    for ordinal, key in enumerate(LEGACY_PLAYER_INPUT_HANDLING_VALUES):
        nodes.append(_node(
            "player-input-handling", key, f"player input handling {key}", ordinal
        ))

    for ordinal, (key, mechanic, placement, must_lead) in enumerate(LEGACY_SEGMENT_TYPES):
        nodes.append(_node(
            "segment-type", key, f"output segment {key}", ordinal,
            {
                "mechanic": mechanic,
                "mechanic_placement_order": placement,
                "must_lead": must_lead,
            },
        ))

    for ordinal, (key, voluntary) in enumerate(LEGACY_AGENCY_CLAIM_TYPES):
        nodes.append(_node(
            "agency-claim-type", key, f"agency claim {key}", ordinal,
            {"voluntary": voluntary},
        ))

    for ordinal, (key, facing, superseded) in enumerate(LEGACY_ROLL_VISIBILITY_CLASSES):
        nodes.append(_node(
            "roll-visibility-class", key, f"roll visibility {key}", ordinal,
            {"player_facing": facing, "superseded": superseded},
        ))

    for ordinal, key in enumerate(LEGACY_SUBSTANTIVE_EFFECT_STATUSES):
        nodes.append(_node(
            "substantive-effect-status", key,
            f"substantive effect status {key}", ordinal,
        ))

    # The first load-bearing edges: the derivation reads them to decide which
    # source_kind an obligation may carry. See empty_relations_law.
    relations = [
        {
            "relation_id": f"relation:text:source-kind-{_slug(key)}:part-of",
            "relation_kind": "part-of",
            "from_node_id": f"obligation-source-kind:{_slug(key)}",
            "to_node_id": f"obligation-kind:{_slug(owner)}",
        }
        for key, owner in LEGACY_OBLIGATION_SOURCE_KINDS
    ]

    return {
        "contract_id": SHARD_CONTRACT_ID,
        "schema_version": SCHEMA_VERSION,
        "shard_id": "shard:text:obligation-vocabulary",
        "plane": "obligation",
        "nodes": nodes,
        "relations": relations,
    }


def build_from_legacy_sources() -> dict[str, Any]:
    return build([obligation_shard()])


def main(argv: list[str] | None = None) -> int:
    import argparse

    parser = argparse.ArgumentParser(description="TextGraph compiler")
    parser.add_argument(
        "command", choices=("prepare", "build", "check"), help="stage to run"
    )
    parser.add_argument("--plane", default="obligation", choices=list(PLANES))
    parser.add_argument(
        "--write", action="store_true",
        help="write the production artifact and manifest",
    )
    args = parser.parse_args(argv)

    if args.command == "prepare":
        print(json.dumps(prepare(args.plane), ensure_ascii=False, indent=2))
        return 0

    built = build_from_legacy_sources()
    if args.command == "check":
        current = json.loads(
            (REFERENCES_DIR / "text-graph.json").read_text(encoding="utf-8")
        )
        drifted = _canonical_json(current) != _canonical_json(built["graph"])
        print(json.dumps({"drifted": drifted}, ensure_ascii=False))
        return 1 if drifted else 0

    if args.write:
        (REFERENCES_DIR / "text-graph.json").write_text(
            json.dumps(built["graph"], ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        (REFERENCES_DIR / "text-graph-manifest.json").write_text(
            json.dumps(built["manifest"], ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
    print(json.dumps(built["manifest"], ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
