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


_RULE_EFFECT_CACHE: dict[str, str] | None = None


def reset_rule_effect_cache() -> None:
    """Drop the parsed RuleGraph (tests point at a patched artifact)."""
    global _RULE_EFFECT_CACHE
    _RULE_EFFECT_CACHE = None


def _renderable_rule_effects() -> dict[str, str]:
    """Return {effect node id: visibility} from the production RuleGraph.

    Read live, so an effect that is renamed, removed, or reclassified in the
    RuleGraph breaks the TextGraph build instead of leaving a stale edge.
    Cached per process: the artifact is 2.3MB, and acceptance validates one
    edge at a time, so an uncached read would reparse it per edge.
    """
    global _RULE_EFFECT_CACHE
    if _RULE_EFFECT_CACHE is not None:
        return _RULE_EFFECT_CACHE
    try:
        graph = json.loads(RULE_GRAPH_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    _RULE_EFFECT_CACHE = {
        str(node["node_id"]): str(node.get("visibility") or "")
        for node in graph.get("nodes") or []
        if isinstance(node, dict) and node.get("node_kind") == "effect"
    }
    return _RULE_EFFECT_CACHE

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


# --------------------------------------------------------------------------
# Frozen craft-plane transcription (slice T4).
#
# Unlike the obligation plane, none of this is derived from a settled receipt:
# it is house doctrine about how prose should read. It therefore carries the
# full accountability burden — rationale, origin, falsifiable_by — and the
# origin is `unknown-legacy-tuning` wherever no spec was found. The inventory
# searched: no Keeper-craft page is cited anywhere in coc_narration_style.py,
# unlike coc_story_director.py which cites nine. Nothing here is classified
# rulebook-source, because inventing a citation to improve the distribution is
# exactly what the contract forbids.
# --------------------------------------------------------------------------

UNKNOWN = "unknown-legacy-tuning"
DELETED_MATCHER_ORIGIN = (
    "coc_narration_style.audit_player_visible_text, deleted in slice T4"
)

# (legacy_key, hard_gate, citable, rationale, origin)
#
# The first four were already enforced by narration.review. The last five are
# the semantic ids the deleted matchers raised; they survive as rules the
# Keeper may cite, which is what makes the deletion a migration rather than a
# loss. unnatural_spatial_phrase is deliberately absent — see review_rule_law.
LEGACY_REVIEW_RULES: tuple[tuple[str, bool, bool, str, str], ...] = (
    ("agency_violation", True, True,
     "the sole hard narrative finding: prose claimed a player-owned "
     "proposition without an authorizing override", UNKNOWN),
    ("semantic_repetition", False, True,
     "an already established fact, clue or quotation was restated in full "
     "instead of compressed", UNKNOWN),
    ("scope_overreach", False, True,
     "the draft reached past the settled turn into material the turn did not "
     "settle", UNKNOWN),
    ("over_length", False, True,
     "the draft ran past twice its derived length budget; advisory, and the "
     "only finding the code raises on its own", UNKNOWN),
    ("ai_summary_voice", False, True,
     "the draft read as report or log voice rather than table narration",
     DELETED_MATCHER_ORIGIN),
    ("expository_choice_summary", False, True,
     "option or blocking logic was exposed as explanation instead of being "
     "rendered as scene", DELETED_MATCHER_ORIGIN),
    ("camera_direction_staging", False, True,
     "body parts were staged like camera directions instead of naming the "
     "person and what they look at", DELETED_MATCHER_ORIGIN),
    ("passive_translation_ese", False, True,
     "literary passive construction read as translated prose rather than "
     "spoken narration", DELETED_MATCHER_ORIGIN),
    ("abstract_psychological_explanation", False, True,
     "inner state was explained abstractly instead of shown through "
     "observable behaviour first", DELETED_MATCHER_ORIGIN),
)

# (directive_id, declares, rationale, origin)
LEGACY_CRAFT_DIRECTIVES: tuple[tuple[str, str, str, str], ...] = (
    ("observable-before-interpretation", "required_rule",
     "show observable behaviour before interpreting it", UNKNOWN),
    ("player-action-uptake", "required_rule",
     "enact a committed player action as world-perspective prose before or "
     "alongside its settled outcome", UNKNOWN),
    ("rewrite-abstract-explanation-to-action", "required_rule",
     "replace abstract inner-state explanation with action, voice, posture, "
     "gaze, hesitation or physical evidence", UNKNOWN),
    ("skill-interpretation-after-visible-evidence", "required_rule",
     "place a skill-justified interpretation after the visible evidence, not "
     "before it", UNKNOWN),
    ("crisis-scene-clarity", "required_rule",
     "draft urgent physical scenes through the render frame so space, force, "
     "risk and handles are clear before prose is sent", UNKNOWN),
    ("final-prose-guard-before-output", "required_rule",
     "review a genuinely difficult draft semantically before release", UNKNOWN),
    ("repetition-policy", "policy",
     "compress an established fact; the current player action is not "
     "repetition and must still be enacted in the Keeper's own words", UNKNOWN),
    ("action-uptake-review", "policy",
     "check semantically that the draft enacts the player action without "
     "cloning the player's sentence structure", UNKNOWN),
    ("final-output-pass", "policy",
     "narration.review is advisory and invoked when the draft is hard, not on "
     "every routine turn", UNKNOWN),
    ("rewrite-ai-summary-voice", "rewrite_guidance",
     "express the same information through scene detail or NPC speech instead "
     "of report phrasing", DELETED_MATCHER_ORIGIN),
    ("rewrite-expository-choice-summary", "rewrite_guidance",
     "render the spatial setup, motion, force, worsening risk and visible "
     "handles as scene prose", DELETED_MATCHER_ORIGIN),
    ("rewrite-camera-direction-staging", "rewrite_guidance",
     "name the person and the visible focus in one natural sentence",
     DELETED_MATCHER_ORIGIN),
    ("rewrite-passive-translation-ese", "rewrite_guidance",
     "rewrite into active voice with a clear subject and concrete action",
     DELETED_MATCHER_ORIGIN),
    ("rewrite-abstract-psychological-explanation", "rewrite_guidance",
     "lead with observable behaviour and add interpretation only after visible "
     "evidence or a relevant skill result", DELETED_MATCHER_ORIGIN),
)

LEGACY_RENDER_SLOTS: tuple[str, ...] = (
    "viewpoint_anchor", "spatial_anchor", "active_motion",
    "connection_or_force", "risk_progression", "visible_affordance",
    "player_entry",
)

LEGACY_RENDER_PROHIBITIONS: tuple[str, ...] = (
    "slot_labels", "expository_choice_summary", "if_then_option_dump",
)

# (legacy_key, axis, language_applicability)
#
# translationese is the one axis the generic register drops, which is the only
# language-dependent thing left in this layer once the matchers are gone.
LEGACY_STYLE_AXES: tuple[tuple[str, str, str], ...] = (
    ("translationese", "avoid", "zh-Hans"),
    ("ai_summary_voice", "avoid", "all"),
    ("log_style_summary", "avoid", "all"),
    ("semantic_repetition", "avoid", "all"),
    ("abstract_psychological_explanation", "avoid", "all"),
    ("short_sentences", "prefer", "all"),
    ("concrete_sensory_detail", "prefer", "all"),
    ("observable_behavior", "prefer", "all"),
    ("open_ended_prompt", "prefer", "all"),
)

# (legacy_key, max_chars, max_paragraphs) in first-match-wins ladder order.
LEGACY_BUDGET_MODES: tuple[tuple[str, int, int], ...] = (
    ("climax_or_madness", 1500, 8),
    ("reveal_or_transition", 900, 5),
    ("costly_result", 550, 3),
    ("routine_resolution", 350, 2),
)

# (legacy_key, owning budget mode). routine_resolution is the fallback and has
# no triggers, which is why it is absent here.
LEGACY_BUDGET_TRIGGERS: tuple[tuple[str, str], ...] = (
    ("bout_of_madness", "climax_or_madness"),
    ("indefinite_insanity", "climax_or_madness"),
    ("permanent_insanity", "climax_or_madness"),
    ("session_ending", "climax_or_madness"),
    ("scene_transition", "reveal_or_transition"),
    ("major_reveal", "reveal_or_transition"),
    ("exceptional_effect_apply", "reveal_or_transition"),
    ("hp_change", "costly_result"),
    ("sanity_loss", "costly_result"),
    ("luck_spend", "costly_result"),
)

# (threshold_id, value, comparison, subject, rationale)
LEGACY_TEXT_THRESHOLDS: tuple[tuple[str, float | int, str, str, str], ...] = (
    ("over-length-multiplier", 2, "gt", "draft chars over budget max_chars",
     "how far past its budget a draft runs before over_length is recorded"),
    ("recent-event-window", 12, "lte", "recent events read for budget",
     "how much recent event history the length budget is derived from"),
    ("excerpt-repair-similarity", 0.5, "gte", "excerpt to paragraph ratio",
     "how close a near-miss excerpt must be before it is repaired rather "
     "than rejected"),
    ("excerpt-repair-min-match", 8, "gte", "longest common run length",
     "the shortest run that may be treated as a recovered verbatim excerpt"),
    ("max-accepted-revision", 2, "lte", "accepted narration revisions",
     "how many narration-only revisions one settlement allows"),
)


def _craft_node(
    kind: str,
    key: str,
    name: str,
    ordinal: int,
    properties: dict[str, Any],
    rationale: str,
    origin: str,
) -> dict[str, Any]:
    return {
        "node_id": f"{kind}:{_slug(key)}",
        "node_kind": kind,
        "plane": "craft",
        "name": name,
        "evidence_class": "authored-house-doctrine",
        "rationale": rationale,
        "origin": origin,
        "falsifiable_by": _falsifiable_by(kind),
        "properties": properties,
    }


_FALSIFIABLE_BY = {
    "review-rule": (
        "run a production-profile session with the rule published in the "
        "narration.review enum and one without it, over more than one turn per "
        "arm, and compare whether the Keeper cites it and whether the cited "
        "drafts read worse to a reader who is not told which arm they came from"
    ),
    "craft-directive": (
        "remove the directive from the style contract for one arm of a "
        "multi-turn production-profile session and compare the drafts blind"
    ),
    "render-slot": (
        "drop the slot from the crisis render frame for one arm and check "
        "whether players ask more clarifying questions about the scene"
    ),
    "render-prohibition": (
        "permit the prohibited shape for one arm and compare whether readers "
        "can still tell what the scene offers"
    ),
    "style-axis": (
        "remove the axis from the register for one arm of a multi-turn session "
        "and compare drafts blind"
    ),
    "narration-budget-mode": (
        "change the rung's max_chars for one arm and measure whether "
        "over_length findings and player follow-up questions move together"
    ),
    "narration-budget-trigger": (
        "remove the event type from the rung for one arm and check whether the "
        "turns it used to select are now under-written"
    ),
    "text-threshold": (
        "perturb the value and replay the preserved corpus: a threshold no "
        "replay outcome is sensitive to is a candidate for retirement"
    ),
}


def _falsifiable_by(kind: str) -> str:
    return _FALSIFIABLE_BY[kind]


def craft_shard() -> dict[str, Any]:
    """Compose the T4 craft shard from the frozen legacy declarations."""
    nodes: list[dict[str, Any]] = []
    relations: list[dict[str, Any]] = []

    for ordinal, (key, hard, citable, why, origin) in enumerate(LEGACY_REVIEW_RULES):
        nodes.append(_craft_node(
            "review-rule", key, f"review rule {key}", ordinal,
            {"legacy_key": key, "ordinal": ordinal,
             "hard_gate": hard, "citable": citable},
            why, origin,
        ))

    for ordinal, (did, declares, why, origin) in enumerate(LEGACY_CRAFT_DIRECTIVES):
        nodes.append(_craft_node(
            "craft-directive", did, f"craft directive {did}", ordinal,
            {"directive_id": did, "ordinal": ordinal, "declares": declares},
            why, origin,
        ))

    for ordinal, key in enumerate(LEGACY_RENDER_SLOTS):
        nodes.append(_craft_node(
            "render-slot", key, f"render slot {key}", ordinal,
            {"legacy_key": key, "ordinal": ordinal},
            "one blocking slot of the crisis render frame, checked for "
            "presence only and never for wording", UNKNOWN,
        ))

    for ordinal, key in enumerate(LEGACY_RENDER_PROHIBITIONS):
        nodes.append(_craft_node(
            "render-prohibition", key, f"render prohibition {key}", ordinal,
            {"legacy_key": key, "ordinal": ordinal},
            "a shape player-visible text must not take", UNKNOWN,
        ))

    for ordinal, (key, axis, lang) in enumerate(LEGACY_STYLE_AXES):
        nodes.append(_craft_node(
            "style-axis", f"{axis}-{key}", f"{axis} {key}", ordinal,
            {"legacy_key": key, "ordinal": ordinal, "axis": axis,
             "language_applicability": lang},
            f"register guidance: {axis} {key}", UNKNOWN,
        ))

    for ordinal, (key, chars, paras) in enumerate(LEGACY_BUDGET_MODES):
        nodes.append(_craft_node(
            "narration-budget-mode", key, f"length budget {key}", ordinal,
            {"legacy_key": key, "ordinal": ordinal,
             "max_chars": chars, "max_paragraphs": paras},
            "how long a turn of this kind should run before length becomes "
            "an advisory finding", UNKNOWN,
        ))

    for ordinal, (key, mode) in enumerate(LEGACY_BUDGET_TRIGGERS):
        nodes.append(_craft_node(
            "narration-budget-trigger", key, f"budget trigger {key}", ordinal,
            {"legacy_key": key, "ordinal": ordinal, "budget_mode": mode},
            "a settled event type that selects this length rung", UNKNOWN,
        ))
        relations.append({
            "relation_id": f"relation:text:budget-trigger-{_slug(key)}:part-of",
            "relation_kind": "part-of",
            "from_node_id": f"narration-budget-trigger:{_slug(key)}",
            "to_node_id": f"narration-budget-mode:{_slug(mode)}",
        })

    for ordinal, (tid, value, comparison, subject, why) in enumerate(
        LEGACY_TEXT_THRESHOLDS
    ):
        nodes.append(_craft_node(
            "text-threshold", tid, f"threshold {tid}", ordinal,
            {"threshold_id": tid, "ordinal": ordinal, "value": value,
             "comparison": comparison, "subject": subject},
            why, UNKNOWN,
        ))

    # Each rewrite directive advises the rule whose matcher it replaces.
    for directive, rule in (
        ("rewrite-ai-summary-voice", "ai_summary_voice"),
        ("rewrite-expository-choice-summary", "expository_choice_summary"),
        ("rewrite-camera-direction-staging", "camera_direction_staging"),
        ("rewrite-passive-translation-ese", "passive_translation_ese"),
        ("rewrite-abstract-psychological-explanation",
         "abstract_psychological_explanation"),
    ):
        relations.append({
            "relation_id": f"relation:text:{_slug(directive)}:advises",
            "relation_kind": "advises",
            "from_node_id": f"craft-directive:{_slug(directive)}",
            "to_node_id": f"review-rule:{_slug(rule)}",
        })

    return {
        "contract_id": SHARD_CONTRACT_ID,
        "schema_version": SCHEMA_VERSION,
        "shard_id": "shard:text:craft-doctrine",
        "plane": "craft",
        "nodes": nodes,
        "relations": relations,
    }


def build_from_legacy_sources() -> dict[str, Any]:
    return build([obligation_shard(), craft_shard()])


OBLIGATION_NAMESPACE_TS = (
    PLUGIN_ROOT / "pi" / "lib" / "text-vocabulary.generated.ts"
    if "PLUGIN_ROOT" in dir()
    else None
)


def project_obligation_namespace() -> str:
    """Render the obligation namespace TypeScript from the graph.

    `tool-contract-projection.ts` held its own copy under the self-describing
    name `PYTHON_OBLIGATION_PREFIXES`, plus two `stringSet([...])` literals --
    a second declaration of a vocabulary the graph owns, in a language the
    Python-only gates could not read. This follows the
    `operation-policy.generated.ts` precedent: one generator, one generated
    file, imports at the use sites.
    """
    import coc_text_runtime

    vocabulary = coc_text_runtime.vocabulary()
    kinds = vocabulary["obligation_kinds"]

    def render(name: str, values) -> str:
        body = ",\n".join(f'  "{value}"' for value in sorted(values))
        return f"export const {name} = [\n{body}\n] as const;\n"

    # Every vocabulary TypeScript used to declare for itself. The census
    # recorded each as a second declaration; generating them is what turns a
    # recorded duplicate into one that cannot drift.
    exported = [
        ("OBLIGATION_ID_PREFIXES", [kinds[k]["id_prefix"] for k in kinds]),
        ("OBLIGATION_KINDS", list(kinds)),
        ("AGENCY_CLAIM_TYPES", vocabulary["agency_claim_types"]),
        ("VOLUNTARY_CLAIM_TYPES", vocabulary["voluntary_claim_types"]),
        ("REALIZATION_VALUES", vocabulary["realization_values"]),
        ("COVERAGE_FIELDS", vocabulary["coverage_fields"]),
        ("PLAYER_INPUT_HANDLING_VALUES", vocabulary["player_input_handling_values"]),
    ]
    return (
        "/**\n"
        " * Generated by coc_text_graph.py from the TextGraph.\n"
        " * DO NOT EDIT. Regenerate with:\n"
        " *   python plugins/coc-keeper/scripts/coc_text_graph.py project --write\n"
        " */\n"
    ) + "".join(render(name, values) for name, values in exported)


def main(argv: list[str] | None = None) -> int:
    import argparse

    parser = argparse.ArgumentParser(description="TextGraph compiler")
    parser.add_argument(
        "command", choices=("prepare", "build", "check", "project"),
        help="stage to run",
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

    if args.command == "project":
        rendered = project_obligation_namespace()
        target = (
            REFERENCES_DIR.parent / "pi" / "lib" / "text-vocabulary.generated.ts"
        )
        if args.write:
            target.write_text(rendered, encoding="utf-8")
        current = target.read_text(encoding="utf-8") if target.is_file() else ""
        print(json.dumps(
            {"path": str(target), "drifted": current != rendered},
            ensure_ascii=False,
        ))
        return 0 if current == rendered else 1

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
