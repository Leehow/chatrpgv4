#!/usr/bin/env python3
"""RuleGraph compiler (R1 slice of the pi-coc RuleGraph spec).

This module owns only the deterministic artifact seam of a RuleGraph.  A
semantic extractor (the model/Keeper) proposes one ``RuleGraphCandidate``
per bounded source packet; this compiler validates it against the closed
v1 contract, binds source evidence (reusing the ModuleGraph evidence
machinery), merges accepted shards, and deterministically rebuilds one
``RuleGraph`` plus a ``RuleGraphBuildManifest``.

The compiler NEVER:
  - rolls dice, recomputes resolver output, or writes campaign state;
  - promotes source claims to canon or reveals secrets;
  - renders narration or changes any Keeper-visible operation.

Digests and hashes are machine-computed integrity evidence.  A model must
never author or relay them; semantic IDs only appear on model-visible
surfaces.

Trust anchor: ``accept()`` persists each AcceptedRuleShard into a
machine-owned build-evidence root; ``build()`` loads those bytes by
semantic shard id (or by in-process object identity of the same
``accept()`` return).  A caller-carried digest is never the trust
anchor.  Integrity is against drift and channel mistakes; the evidence
root inherits the repository's own trust level.  No HMAC or keys.
"""
from __future__ import annotations

import copy
import hashlib
import json
import os
import re
import sys
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import coc_module_graph as _mg

CONTRACT_PATH = (
    SCRIPT_DIR.parent / "references" / "rule-graph-contract-v1.json"
)
CONTRACT = json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))

CONTRACT_ID = str(CONTRACT["contract_id"])
SCHEMA_VERSION = int(CONTRACT["schema_version"])
EXTRACTION_PACKET_CONTRACT_ID = str(CONTRACT["extraction_packet_contract_id"])
EVIDENCE_CONTRACT_ID = str(CONTRACT["evidence_contract_id"])
CANDIDATE_CONTRACT_ID = str(CONTRACT["candidate_contract_id"])
SHARD_CONTRACT_ID = str(CONTRACT["shard_contract_id"])
GRAPH_CONTRACT_ID = str(CONTRACT["graph_contract_id"])
BUILD_MANIFEST_CONTRACT_ID = str(CONTRACT["build_manifest_contract_id"])

NODE_KINDS = frozenset(CONTRACT["node_kinds"])
RELATION_KINDS = frozenset(CONTRACT["relation_kinds"])
RULE_FAMILIES = frozenset(CONTRACT["rule_families"])
CONDITION_COMBINATORS = frozenset(CONTRACT["condition_combinators"])
CONDITION_OPERATORS = frozenset(CONTRACT["condition_operators"])
DECISION_INPUT_OWNERSHIP = frozenset(CONTRACT["decision_input_ownership"])
AUTHORITIES = frozenset(CONTRACT["authority"])
AUDIENCES = frozenset(CONTRACT["audience"])
VISIBILITIES = frozenset(CONTRACT["visibility"])
COVERAGE_STATUSES = frozenset(CONTRACT["coverage_status"])
FAMILY_RUNTIME_OWNERSHIP = frozenset(CONTRACT["family_runtime_ownership"])
LEGACY_SURFACE_LIFECYCLE = frozenset(CONTRACT["legacy_surface_lifecycle"])
REVIEW_STATUSES = frozenset(CONTRACT["review_status"])
REGISTERED_CONDITION_PATHS = frozenset(CONTRACT["registered_condition_paths"])
NODE_PROPERTY_KEYS = CONTRACT["node_property_keys"]

SEMANTIC_ID_RE = re.compile(r"^[a-z][a-z0-9-]*(?::[a-z0-9][a-z0-9-]*)+$")
KEBAB_ID_RE = re.compile(r"^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$")
SPAN_ID_RE = re.compile(r"^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")

SOURCE_SELECTION_REQUIRED = frozenset(CONTRACT["source_selection_required_keys"])
SOURCE_SELECTION_KEY = frozenset(CONTRACT["source_selection_keys"])
CANDIDATE_KEY = frozenset(CONTRACT["candidate_keys"])
NODE_KEY = frozenset(CONTRACT["node_keys"])
OPTIONAL_NODE_KEY = frozenset(CONTRACT["optional_node_keys"])
RELATION_KEY = frozenset(CONTRACT["relation_keys"])
SHARD_KEY = frozenset(CONTRACT["shard_keys"])
BUILD_MANIFEST_KEY = frozenset(CONTRACT["build_manifest_keys"])
SHARD_IDENTITY_KEY = frozenset(CONTRACT["shard_identity_keys"])
FINDING_KEY = frozenset(CONTRACT["finding_keys"])
OPTIONAL_FINDING_KEY = frozenset(CONTRACT["optional_finding_keys"])
KNOWN_NODE_KEY = frozenset(CONTRACT["known_node_keys"])
EXTRACTION_PACKET_KEY = frozenset(CONTRACT["extraction_packet_keys"])
MODEL_PACKET_KEY = frozenset(CONTRACT["model_packet_keys"])
GRAPH_KEY = frozenset(CONTRACT["graph_keys"])
HEALING_COMMAND_PHASES = CONTRACT["healing_command_phases"]
ACCEPTANCE_RECEIPT_CONTRACT_ID = "coc.rule-graph-review-receipt.v1"
ACCEPTANCE_RECEIPT_KEY = frozenset(
    {
        "contract_id",
        "schema_version",
        "ruleset_id",
        "family_id",
        "section_id",
        "shard_id",
        "candidate_sha256",
        "packet_sha256",
        "shard_sha256",
    }
)
_COMPARISON_OPS = frozenset(
    {"eq", "neq", "lt", "lte", "gt", "gte", "contains", "not-contains"}
)
_NARY_COMBINATORS = frozenset({"all", "any"})

# Deterministic source-vs-derivative discrepancy table (recon B).  The source
# example, current combat implementation, and healing regression all use
# ceiling-half for the odd max-HP major-wound threshold; the coC7 checklist
# predicate (a derivative) used floor-half.  R1 records this as a Finding and
# NEVER rewrites the graph's source claim to match a derivative.
SOURCE_VS_DERIVATIVE_DISCREPANCIES: dict[str, dict[str, Any]] = {
    "ceiling-half-major-wound-threshold": {
        "source_formula": "(hp_max + 1) // 2",
        "source_example": "11 HP max therefore clears at 6",
        "derivative_formula": "hp_max // 2",
        "derivative_example": "11 HP max therefore clears at 5",
        "status": "mismatch",
    }
}

# Sentinel returned by accept/build when validation fails.  Mirrors the
# ModuleGraph convention of returning findings rather than raising.
PROBLEM = "findings"

# Machine-owned build-evidence root (never a campaign path).  Override via
# COC_RULE_GRAPH_EVIDENCE_ROOT, set_evidence_root(), or an explicit argument.
REPO_ROOT = SCRIPT_DIR.parents[2]
DEFAULT_EVIDENCE_ROOT = REPO_ROOT / "artifacts" / "rule-graph-build-evidence"
ACCEPTED_EVIDENCE_CONTRACT_ID = "coc.rule-graph-accepted-evidence.v1"
ACCEPTED_EVIDENCE_KEYS = frozenset({"contract_id", "shard_id", "accepted_shard"})
_EVIDENCE_ROOT_OVERRIDE: Path | None = None
# In-process provenance: id(accept()-returned shard object) -> frozen snapshot.
_SESSION_ACCEPTED: dict[int, dict[str, Any]] = {}


class RuleGraphError(ValueError):
    """The proposed rule graph artifact cannot be promoted."""

    def __init__(self, findings: list[dict[str, Any]]):
        super().__init__("rule graph validation failed")
        self.findings = findings


def _finding(code: str, path: str, message: str,
             evidence_span_ids: list[str] | None = None) -> dict[str, Any]:
    row: dict[str, Any] = {"code": code, "path": path, "message": message}
    if evidence_span_ids:
        row["evidence_span_ids"] = list(evidence_span_ids)
    return row


def _canonical(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _json_digest(value: Any) -> str:
    return hashlib.sha256(_canonical(value).encode("utf-8")).hexdigest()


def _ok(shard_or_graph: dict[str, Any]) -> dict[str, Any]:
    return {"ok": True, "shard": shard_or_graph}


def _ok_graph(graph: dict[str, Any], manifest: dict[str, Any]) -> dict[str, Any]:
    return {"ok": True, "graph": graph, "manifest": manifest}


def _problem(findings: list[dict[str, Any]]) -> dict[str, Any]:
    return {"ok": False, "findings": findings}


def _valid_semantic_id(value: Any) -> bool:
    return isinstance(value, str) and len(value) <= 200 and bool(
        SEMANTIC_ID_RE.fullmatch(value)
    )


def _valid_kebab_id(value: Any) -> bool:
    return isinstance(value, str) and len(value) <= 200 and bool(KEBAB_ID_RE.fullmatch(value))


def _valid_span_id(value: Any) -> bool:
    return isinstance(value, str) and bool(SPAN_ID_RE.fullmatch(value))


def _valid_source_language(value: Any) -> bool:
    return isinstance(value, str) and bool(
        re.compile(r"^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$").fullmatch(value)
    )


def set_evidence_root(path: Path | str | None) -> None:
    """Configure the machine-owned build-evidence root for this process."""
    global _EVIDENCE_ROOT_OVERRIDE
    _EVIDENCE_ROOT_OVERRIDE = Path(path) if path is not None else None


def clear_accepted_session() -> None:
    """Drop in-process accept() provenance. Tests isolate via this."""
    _SESSION_ACCEPTED.clear()


def resolve_evidence_root(explicit: Path | str | None = None) -> Path:
    if explicit is not None:
        return Path(explicit)
    if _EVIDENCE_ROOT_OVERRIDE is not None:
        return _EVIDENCE_ROOT_OVERRIDE
    env = os.environ.get("COC_RULE_GRAPH_EVIDENCE_ROOT")
    if env:
        return Path(env)
    return DEFAULT_EVIDENCE_ROOT


def evidence_root(explicit: Path | str | None = None) -> Path:
    return resolve_evidence_root(explicit)


def _check_evidence_root(root: Path) -> tuple[Path | None, list[dict[str, Any]]]:
    """Resolve once, validate, and return that Path for all subsequent I/O."""
    try:
        resolved = Path(root).resolve()
    except OSError as exc:
        return None, [_finding(
            "invalid_evidence_root",
            "/evidence_root",
            f"cannot resolve evidence root: {exc}",
        )]
    parts = resolved.parts
    for index, part in enumerate(parts[:-1]):
        if part == ".coc" and parts[index + 1] == "campaigns":
            return None, [_finding(
                "campaign_evidence_root_forbidden",
                "/evidence_root",
                "the build-evidence root must not be a campaign path",
            )]
    return resolved, []


def accepted_evidence_path(shard_id: str, root: Path | None = None) -> Path | None:
    """Return the evidence-root file for one semantic shard id, or None."""
    validated, findings = _check_evidence_root(resolve_evidence_root(root))
    if findings or validated is None:
        return None
    return _accepted_evidence_path(validated, shard_id)


def _accepted_evidence_path(validated_root: Path, shard_id: str) -> Path | None:
    """Join ``shard_id`` onto an already-validated resolved root. No re-resolve."""
    if not _valid_semantic_id(shard_id):
        return None
    if any(token in shard_id for token in ("/", "\\", "..")):
        return None
    name = shard_id.replace(":", "--") + ".json"
    return validated_root / name


def _persist_accepted_shard(shard: dict[str, Any], validated_root: Path) -> list[dict[str, Any]]:
    shard_id = shard.get("shard_id")
    path = _accepted_evidence_path(validated_root, str(shard_id or ""))
    if path is None:
        return [_finding("invalid_shard_id", "/shard_id", "cannot persist shard identity")]
    payload = {
        "contract_id": ACCEPTED_EVIDENCE_CONTRACT_ID,
        "shard_id": shard_id,
        "accepted_shard": shard,
    }
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_name("." + path.name + ".tmp")
        tmp.write_text(_canonical(payload), encoding="utf-8")
        os.replace(tmp, path)
    except OSError as exc:
        return [_finding("evidence_root_write_failed", "/evidence_root", str(exc))]
    return []


def _load_persisted_shard(
    shard_id: str, index: int, validated_root: Path
) -> tuple[dict[str, Any] | None, list[dict[str, Any]]]:
    path_label = f"/{index}"
    path = _accepted_evidence_path(validated_root, shard_id)
    if path is None:
        return None, [_finding(
            "invalid_shard_id", f"{path_label}/shard_id", "not a semantic shard id"
        )]
    if not path.is_file():
        return None, [_finding(
            "shard_not_in_evidence_root",
            f"{path_label}/shard_id",
            f"{shard_id} is absent from the machine-owned evidence root",
        )]
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        return None, [_finding(
            "evidence_root_unreadable", str(path.name), str(exc)
        )]
    if not isinstance(payload, dict):
        return None, [_finding(
            "invalid_accepted_evidence", str(path.name), "must be an object"
        )]
    if set(payload) != ACCEPTED_EVIDENCE_KEYS:
        return None, [_finding(
            "invalid_accepted_evidence",
            str(path.name),
            "must persist exactly one canonical receipt, inside accepted_shard",
        )]
    shard = payload.get("accepted_shard")
    if not isinstance(shard, dict):
        return None, [_finding(
            "invalid_accepted_evidence", str(path.name), "missing accepted_shard"
        )]
    return shard, []


def _resolve_accepted_shard(
    item: Any, index: int, root: Path
) -> tuple[dict[str, Any] | None, list[dict[str, Any]]]:
    """Resolve one build input to machine-owned accepted bytes."""
    path = f"/{index}"
    if isinstance(item, str):
        return _load_persisted_shard(item, index, root)
    if not isinstance(item, dict):
        return None, [_finding("invalid_shard", path, "must be an object or shard_id")]
    frozen = _SESSION_ACCEPTED.get(id(item))
    if frozen is not None:
        if _canonical(item) != _canonical(frozen):
            return None, [_finding(
                "caller_shard_differs_from_persisted",
                path,
                "caller mutated an accept() shard; build uses only evidence-root bytes",
            )]
        return copy.deepcopy(frozen), []
    shard_id = item.get("shard_id")
    if not isinstance(shard_id, str):
        return None, [_finding(
            "shard_not_in_evidence_root",
            f"{path}/shard_id",
            "no in-process provenance and no semantic shard id",
        )]
    persisted, findings = _load_persisted_shard(shard_id, index, root)
    if findings or persisted is None:
        return None, findings
    if _canonical(item) != _canonical(persisted):
        return None, [_finding(
            "caller_shard_differs_from_persisted",
            path,
            "caller-supplied shard body differs from the machine-owned store",
        )]
    return copy.deepcopy(persisted), []


# --------------------------------------------------------------------------- #
# prepare(SourceSelection) -> RuleExtractionPacket
# --------------------------------------------------------------------------- #
def prepare(selection: Any) -> dict[str, Any]:
    """Build a closed, model-safe extraction packet from accepted source pages.

    source_selection_keys: ruleset_id, ruleset_version, source_language,
      family_id, section_id, bundle_dirs, page_keys, known_nodes, output_budget,
      families.
    """
    findings: list[dict[str, Any]] = []
    if not isinstance(selection, dict):
        return _problem([_finding("invalid_source_selection", "/", "must be an object")])

    for key in sorted(set(selection) - SOURCE_SELECTION_KEY):
        findings.append(_finding("unknown_source_selection_key", f"/{key}", "not in contract"))
    for key in sorted(SOURCE_SELECTION_REQUIRED - set(selection)):
        findings.append(_finding("missing_source_selection_key", f"/{key}", "must be present"))

    if findings:
        return _problem(findings)

    ruleset_id = selection.get("ruleset_id")
    ruleset_version = str(selection.get("ruleset_version", ""))
    family_id = selection.get("family_id")
    section_id = selection.get("section_id")
    source_language = selection.get("source_language")
    if not _valid_kebab_id(family_id) or not _valid_kebab_id(section_id):
        findings.append(_finding("invalid_semantic_id", "/family_id:section_id", "must be kebab-case"))
    if not _valid_source_language(source_language):
        findings.append(_finding("invalid_source_language", "/source_language", "must be a BCP 47 tag"))
    if not isinstance(ruleset_id, str) or not ruleset_id:
        findings.append(_finding("invalid_ruleset_id", "/ruleset_id", "must be a non-empty string"))

    # Build evidence through the reused ModuleGraph machinery.
    try:
        page_catalog = _mg.load_page_catalog(selection.get("bundle_dirs"))
    except _mg.ModuleGraphError as exc:
        return _problem([{**f, "path": f"/bundle_dirs{f['path']}"} for f in exc.findings])

    page_keys = selection.get("page_keys")
    if not isinstance(page_keys, list) or not page_keys:
        findings.append(_finding("page_keys_required", "/page_keys", "at least one page is required"))
        return _problem(findings)

    try:
        evidence_catalog = _mg.build_evidence_packet(
            page_catalog,
            section_id=section_id,
            page_keys=page_keys,
        )
    except _mg.ModuleGraphError as exc:
        return _problem(list(exc.findings))

    evidence_view = _mg.project_evidence_for_model(evidence_catalog)
    evidence_binding = {
        "contract_id": EVIDENCE_CONTRACT_ID,
        "schema_version": 1,
        "section_id": section_id,
        "spans": [
            {
                "span_id": span.get("span_id"),
                "source_ref": copy.deepcopy(span.get("source_ref")),
            }
            for span in (evidence_catalog.get("spans") or [])
            if isinstance(span, dict)
        ],
    }

    return _ok(_extraction_packet(
        ruleset_id=ruleset_id,
        ruleset_version=ruleset_version,
        family_id=family_id,
        section_id=section_id,
        source_language=source_language,
        families=selection.get("families") or [family_id],
        known_nodes=selection.get("known_nodes") or [],
        output_budget=selection.get("output_budget") or {"max_nodes": 40, "max_relations": 80},
        evidence_view=evidence_view,
        evidence_binding=evidence_binding,
    ))


def _extraction_packet(**kwargs: Any) -> dict[str, Any]:
    return {
        "contract_id": EXTRACTION_PACKET_CONTRACT_ID,
        "schema_version": SCHEMA_VERSION,
        "ruleset_id": kwargs["ruleset_id"],
        "ruleset_version": kwargs["ruleset_version"],
        "family_id": kwargs["family_id"],
        "section_id": kwargs["section_id"],
        "source_language": kwargs["source_language"],
        "families": kwargs["families"],
        "known_nodes": kwargs["known_nodes"],
        "output_budget": kwargs["output_budget"],
        "evidence_view": kwargs["evidence_view"],
        "evidence_binding": kwargs["evidence_binding"],
    }


# --------------------------------------------------------------------------- #
# accept(RuleExtractionPacket, RuleGraphCandidate) -> AcceptedRuleShard | Findings
# --------------------------------------------------------------------------- #
def accept(packet: Any, candidate: Any, evidence_root: Path | str | None = None) -> dict[str, Any]:
    """Deterministically validate and accept one reviewed candidate.

    Persists the accepted shard into the machine-owned build-evidence root.
    Returns ``{"ok": True, "shard": AcceptedRuleShard}`` or
    ``{"ok": False, "findings": [...]}``.
    """
    if _is_problem(packet):
        return _problem([_finding("invalid_packet", "/", "packet must be a RuleExtractionPacket")])
    if not isinstance(packet, dict):
        return _problem([_finding("invalid_packet", "/", "packet must be an object")])

    findings = _validate_packet(packet)
    if findings:
        return _problem(findings)

    findings = _validate_candidate(candidate, packet)
    if findings:
        return _problem(findings)

    # Reassemble a deterministic evidence scope, never trusting model scope.
    shard = _assemble_shard(packet, candidate)
    shard["evidence_binding"] = copy.deepcopy(packet.get("evidence_binding"))
    shard["receipt"] = {
        "contract_id": ACCEPTANCE_RECEIPT_CONTRACT_ID,
        "schema_version": 1,
        "ruleset_id": packet.get("ruleset_id"),
        "family_id": packet.get("family_id"),
        "section_id": packet.get("section_id"),
        "shard_id": shard["shard_id"],
        "candidate_sha256": _json_digest(candidate),
        "packet_sha256": _json_digest(packet),
        "shard_sha256": _json_digest(shard),
    }
    validated_root, root_findings = _check_evidence_root(resolve_evidence_root(evidence_root))
    if root_findings or validated_root is None:
        return _problem(root_findings)
    persist_findings = _persist_accepted_shard(shard, validated_root)
    if persist_findings:
        return _problem(persist_findings)
    frozen = copy.deepcopy(shard)
    _SESSION_ACCEPTED[id(shard)] = frozen
    return _ok(shard)


def _is_problem(value: Any) -> bool:
    return isinstance(value, dict) and value.get("ok") is False


def _validate_packet(packet: Any) -> list[dict[str, Any]]:
    findings: list[dict[str, Any]] = []
    if set(packet) != EXTRACTION_PACKET_KEY:
        findings.append(_finding("invalid_packet_fields", "/", "must use the frozen field set"))
    if packet.get("contract_id") != EXTRACTION_PACKET_CONTRACT_ID:
        findings.append(_finding("contract_mismatch", "/contract_id", EXTRACTION_PACKET_CONTRACT_ID))
    if packet.get("schema_version") != SCHEMA_VERSION:
        findings.append(_finding("version_mismatch", "/schema_version", str(SCHEMA_VERSION)))
    for field in ("ruleset_id", "family_id", "section_id"):
        if not _valid_kebab_id(packet.get(field)):
            findings.append(_finding("invalid_semantic_id", f"/{field}", "must be kebab-case"))
    if not _valid_source_language(packet.get("source_language")):
        findings.append(_finding("invalid_source_language", "/source_language", "must be a BCP 47 tag"))
    return findings


def _validate_candidate(candidate: Any, packet: dict[str, Any]) -> list[dict[str, Any]]:
    findings: list[dict[str, Any]] = []
    if not isinstance(candidate, dict):
        return [_finding("invalid_candidate", "/", "candidate must be an object")]
    for key in sorted(set(candidate) - CANDIDATE_KEY):
        findings.append(_finding("unknown_candidate_key", f"/{key}", "not in contract"))
    if candidate.get("contract_id") != CANDIDATE_CONTRACT_ID:
        findings.append(_finding("contract_mismatch", "/contract_id", CANDIDATE_CONTRACT_ID))
    if candidate.get("schema_version") != SCHEMA_VERSION:
        findings.append(_finding("version_mismatch", "/schema_version", str(SCHEMA_VERSION)))
    if candidate.get("ruleset_id") != packet.get("ruleset_id"):
        findings.append(_finding("ruleset_mismatch", "/ruleset_id", "candidate vs packet"))
    if not _valid_source_language(candidate.get("source_language")):
        findings.append(_finding("invalid_source_language", "/source_language", "must be a BCP 47 tag"))

    # Model must not author integrity bytes.
    findings.extend(_reject_model_integrity(candidate))
    if findings:
        return findings

    coverage = candidate.get("coverage")
    findings.extend(_validate_coverage(coverage, declared_families=packet.get("families")))
    if findings:
        return findings

    node_ids, findings = _validate_nodes(candidate, packet)
    if findings:
        return findings
    findings.extend(_validate_relations(candidate, node_ids))
    if findings:
        return findings
    findings.extend(_validate_reference_closure(candidate, node_ids, packet))
    return findings


def _reject_model_integrity(candidate: Any) -> list[dict[str, Any]]:
    """Model-authored integrity bytes, digests, hashes, or sha256 fields."""
    findings: list[dict[str, Any]] = []
    if _contains_integrity_bytes(candidate):
        findings.append(_finding(
            "model_integrity_bytes",
            "/",
            "candidate must not author sha256/digest/hash integrity bytes",
        ))
    return findings


def _contains_integrity_bytes(value: Any) -> bool:
    if isinstance(value, dict):
        for key, val in value.items():
            if isinstance(key, str) and key.lower() in {
                "sha256", "digest", "hash", "content_digest", "source_digest",
            }:
                return True
            if _contains_integrity_bytes(val):
                return True
    elif isinstance(value, list):
        return any(_contains_integrity_bytes(item) for item in value)
    return False


def _validate_coverage(
    coverage: Any,
    declared_families: Any,
) -> list[dict[str, Any]]:
    findings: list[dict[str, Any]] = []
    if not isinstance(coverage, dict) or not coverage:
        return [_finding("coverage_required", "/coverage", "must be non-empty")]
    declared = set(declared_families or [])
    for family, status in coverage.items():
        path = f"/coverage/{family}"
        if status not in COVERAGE_STATUSES:
            findings.append(_finding("invalid_coverage_status", path, str(status)))
        elif family not in declared:
            findings.append(
                _finding("coverage_outside_declared_family", path, "not in the packet's families")
            )
    # Every declared family that is not assigned must be unresolved.
    for family in declared:
        if family not in coverage and family in RULE_FAMILIES:
            findings.append(
                _finding("coverage_missing_family", f"/coverage/{family}", "declared family not covered")
            )
    return findings


def _validate_nodes(candidate: Any, packet: dict[str, Any]) -> tuple[set[str], list[dict[str, Any]]]:
    findings: list[dict[str, Any]] = []
    node_ids: set[str] = set()
    nodes = candidate.get("nodes")
    if not isinstance(nodes, list) or not nodes:
        return node_ids, [_finding("nodes_required", "/nodes", "must be non-empty")]
    for index, node in enumerate(nodes):
        path = f"/nodes/{index}"
        if not isinstance(node, dict):
            findings.append(_finding("invalid_node", path, "must be an object"))
            continue
        for key in sorted(set(node) - NODE_KEY):
            findings.append(_finding("unknown_node_key", f"{path}/{key}", "not in contract"))
        node_id = node.get("node_id")
        if not _valid_semantic_id(node_id):
            findings.append(_finding("invalid_node_id", f"{path}/node_id", "must be semantic"))
        elif node_id in node_ids:
            findings.append(_finding("duplicate_node_id", f"{path}/node_id", node_id))
        else:
            node_ids.add(node_id)
        node_kind = node.get("node_kind")
        if node_kind not in NODE_KINDS:
            findings.append(_finding("invalid_node_kind", f"{path}/node_kind", "unknown kind"))
        elif _valid_semantic_id(node_id) and not node_id.startswith(f"{node_kind}:"):
            findings.append(
                _finding("node_id_kind_mismatch", f"{path}/node_id", f"must start with {node_kind}:")
            )
        if node.get("authority") not in AUTHORITIES:
            findings.append(_finding("invalid_authority", f"{path}/authority", "unknown authority"))
        if node.get("audience") not in AUDIENCES:
            findings.append(_finding("invalid_audience", f"{path}/audience", "unknown audience"))
        if node.get("visibility") not in VISIBILITIES:
            findings.append(_finding("invalid_visibility", f"{path}/visibility", "unknown visibility"))
        if not isinstance(node.get("hard_gate"), bool):
            findings.append(_finding("invalid_hard_gate", f"{path}/hard_gate", "must be boolean"))
        properties = node.get("properties")
        if not isinstance(properties, dict):
            findings.append(_finding("invalid_properties", f"{path}/properties", "must be an object"))
        else:
            allowed = NODE_PROPERTY_KEYS.get(node_kind)
            if allowed is not None:
                for key in sorted(set(properties) - set(allowed)):
                    findings.append(
                        _finding("unknown_node_property", f"{path}/properties/{key}", "not in contract")
                    )
            if node_kind == "condition":
                findings.extend(_validate_condition_expression(properties.get("expression"), path))
        findings.extend(
            _validate_span_ids(node.get("evidence_span_ids"), f"{path}/evidence_span_ids", packet)
        ) if "evidence_span_ids" in node else None
        # Node kind must be inside the packet's declared family scope.
        if node_kind == "rule-family" and node_id.rsplit(":", 1)[-1] not in packet.get("families", []):
            findings.append(_finding("family_not_declared", f"{path}/node_id", node_id))
    return node_ids, findings


def _validate_relations(candidate: Any, node_ids: set[str]) -> list[dict[str, Any]]:
    findings: list[dict[str, Any]] = []
    relations = candidate.get("relations")
    if not isinstance(relations, list):
        return [_finding("relations_required", "/relations", "must be an array")]
    seen: set[str] = set()
    for index, relation in enumerate(relations):
        path = f"/relations/{index}"
        if not isinstance(relation, dict):
            findings.append(_finding("invalid_relation", path, "must be an object"))
            continue
        for key in sorted(set(relation) - RELATION_KEY):
            findings.append(_finding("unknown_relation_key", f"{path}/{key}", "not in contract"))
        relation_id = relation.get("relation_id")
        if not _valid_semantic_id(relation_id):
            findings.append(_finding("invalid_relation_id", f"{path}/relation_id", "must be semantic"))
        elif relation_id in seen:
            findings.append(_finding("duplicate_relation_id", f"{path}/relation_id", relation_id))
        else:
            seen.add(relation_id)
        if relation.get("relation_kind") not in RELATION_KINDS:
            findings.append(_finding("invalid_relation_kind", f"{path}/relation_kind", "unknown kind"))
        for field in ("from_node_id", "to_node_id"):
            if relation.get(field) not in node_ids:
                findings.append(_finding("unknown_relation_anchor", f"{path}/{field}", "not declared"))
    return findings


def _validate_reference_closure(candidate: Any, node_ids: set[str], packet: dict[str, Any]) -> list[dict[str, Any]]:
    """Node/relation/capability/table reference closure within this packet."""
    findings: list[dict[str, Any]] = []
    relations = candidate.get("relations") or []
    # Every relation's anchors must already be nodes in this packet OR
    # declared as external in the packet's known_nodes.  We require closure
    # because R1 is a self-contained healing packet.
    known = {row.get("node_id") for row in (packet.get("known_nodes") or []) if isinstance(row, dict)}
    for index, relation in enumerate(relations):
        if not isinstance(relation, dict):
            continue
        path = f"/relations/{index}"
        for field in ("from_node_id", "to_node_id"):
            ref = relation.get(field)
            if ref not in node_ids and ref not in known:
                findings.append(_finding("unresolved_reference", f"{path}/{field}", f"no node defines {ref}"))
    # Capability and data-table references declared on nodes must resolve to
    # either a listed capability/data-table node or a known external table.
    nodes = candidate.get("nodes") or []
    for index, node in enumerate(nodes):
        if not isinstance(node, dict):
            continue
        node_kind = node.get("node_kind")
        props = node.get("properties") or {}
        if node_kind in ("capability", "data-table"):
            # Declared inline; closure holds if it is a node in the packet.
            if node.get("node_id") not in node_ids:
                findings.append(_finding("unresolved_capability", f"/nodes/{index}/node_id", ""))
    return findings


def _validate_condition_expression(expression: Any, path: str) -> list[dict[str, Any]]:
    """Fail-closed validation of the closed structural condition language.

    Every node must be exactly one recognized operator:
    combinators all/any/not, comparisons eq/neq/lt/lte/gt/gte/contains/
    not-contains, or exists.  Operands are registered paths and scalars.
    Arbitrary dicts, strings, extra keys, and missing operands are Findings.
    """
    expr_path = f"{path}/expression"
    if expression is None:
        return [_finding(
            "missing_condition_expression",
            expr_path,
            "condition node requires a closed expression",
        )]
    findings: list[dict[str, Any]] = []
    _walk_condition(expression, expr_path, findings)
    return findings


def _scalar_operand(value: Any) -> bool:
    return isinstance(value, bool) or isinstance(value, (str, int, float))


def _walk_condition(node: Any, path: str, findings: list[dict[str, Any]]) -> None:
    if not isinstance(node, dict):
        findings.append(_finding(
            "invalid_condition_expression",
            path,
            "must be an object with a recognized op",
        ))
        return
    if "op" not in node:
        findings.append(_finding(
            "invalid_condition_expression",
            path,
            "missing recognized op",
        ))
        return
    op = node["op"]
    allowed = CONDITION_OPERATORS | CONDITION_COMBINATORS
    if op not in allowed:
        findings.append(_finding("invalid_condition_operator", f"{path}/op", str(op)))
        return
    keys = set(node)
    if op in _NARY_COMBINATORS:
        extra = keys - {"op", "of"}
        if extra:
            findings.append(_finding("unknown_condition_key", path, sorted(extra)[0]))
        of = node.get("of")
        if not isinstance(of, list) or len(of) < 1:
            findings.append(_finding(
                "invalid_condition_expression",
                f"{path}/of",
                "all/any require a non-empty list",
            ))
            return
        for index, child in enumerate(of):
            _walk_condition(child, f"{path}/of/{index}", findings)
        return
    if op == "not":
        extra = keys - {"op", "of"}
        if extra:
            findings.append(_finding("unknown_condition_key", path, sorted(extra)[0]))
        of = node.get("of")
        if isinstance(of, list):
            if len(of) != 1:
                findings.append(_finding(
                    "invalid_not_arity",
                    f"{path}/of",
                    "not requires exactly one operand",
                ))
                return
            _walk_condition(of[0], f"{path}/of/0", findings)
            return
        if isinstance(of, dict):
            _walk_condition(of, f"{path}/of", findings)
            return
        findings.append(_finding(
            "invalid_not_arity",
            f"{path}/of",
            "not requires exactly one operand",
        ))
        return
    if op == "exists":
        extra = keys - {"op", "path"}
        if extra:
            findings.append(_finding("unknown_condition_key", path, sorted(extra)[0]))
        cond_path = node.get("path")
        if not isinstance(cond_path, str):
            findings.append(_finding(
                "missing_condition_operand",
                f"{path}/path",
                "exists requires a registered path",
            ))
            return
        if cond_path not in REGISTERED_CONDITION_PATHS:
            findings.append(_finding(
                "unregistered_condition_path", f"{path}/path", cond_path
            ))
        return
    extra = keys - {"op", "path", "value"}
    if extra:
        findings.append(_finding("unknown_condition_key", path, sorted(extra)[0]))
    cond_path = node.get("path")
    if not isinstance(cond_path, str):
        findings.append(_finding(
            "missing_condition_operand",
            f"{path}/path",
            "comparison requires a registered path",
        ))
    elif cond_path not in REGISTERED_CONDITION_PATHS:
        findings.append(_finding(
            "unregistered_condition_path", f"{path}/path", str(cond_path)
        ))
    if "value" not in node:
        findings.append(_finding(
            "missing_condition_operand",
            f"{path}/value",
            "comparison requires a scalar value",
        ))
    elif not _scalar_operand(node.get("value")):
        findings.append(_finding(
            "invalid_condition_expression",
            f"{path}/value",
            "value must be a scalar",
        ))


def _validate_span_ids(value: Any, path: str, packet: dict[str, Any]) -> list[dict[str, Any]]:
    if value is None:
        return []
    if not isinstance(value, list):
        return [_finding("invalid_span_ids", path, "must be an array")]
    bound_span_ids = {
        span.get("span_id")
        for span in ((packet.get("evidence_binding") or {}).get("spans") or [])
        if isinstance(span, dict) and isinstance(span.get("span_id"), str)
    }
    findings: list[dict[str, Any]] = []
    seen: set[str] = set()
    for index, span_id in enumerate(value):
        item = f"{path}/{index}"
        if not _valid_span_id(span_id):
            findings.append(_finding("invalid_span_id", item, "must be kebab-case"))
        elif span_id in seen:
            findings.append(_finding("duplicate_span_id", item, span_id))
        elif bound_span_ids and span_id not in bound_span_ids:
            findings.append(_finding("unbound_span", item, span_id))
        else:
            seen.add(span_id)
    return findings


def _assemble_shard(packet: dict[str, Any], candidate: dict[str, Any]) -> dict[str, Any]:
    shard = {
        "contract_id": SHARD_CONTRACT_ID,
        "schema_version": SCHEMA_VERSION,
        "shard_id": f"shard:{candidate.get('ruleset_id')}:{packet.get('family_id')}:{packet.get('section_id')}",
        "ruleset_id": candidate.get("ruleset_id"),
        "ruleset_version": packet.get("ruleset_version"),
        "family_id": packet.get("family_id"),
        "section_id": packet.get("section_id"),
        "source_language": candidate.get("source_language"),
        "coverage": copy.deepcopy(candidate.get("coverage")),
        "nodes": copy.deepcopy(candidate.get("nodes")),
        "relations": copy.deepcopy(candidate.get("relations")),
        "evidence_span_ids": _collect_span_ids(candidate),
    }
    return shard


def _collect_span_ids(candidate: dict[str, Any]) -> list[str]:
    ids: set[str] = set()
    for node in (candidate.get("nodes") or []):
        if isinstance(node, dict):
            ids.update(v for v in (node.get("evidence_span_ids") or []) if isinstance(v, str))
    for relation in (candidate.get("relations") or []):
        if isinstance(relation, dict):
            ids.update(v for v in (relation.get("evidence_span_ids") or []) if isinstance(v, str))
    return sorted(ids)


# --------------------------------------------------------------------------- #
# build(AcceptedRuleShard[]) -> RuleGraph + RuleGraphBuildManifest | Findings
# --------------------------------------------------------------------------- #
def _validate_shard_acceptance(shard: dict[str, Any], index: int) -> list[dict[str, Any]]:
    """Verify accept()-produced receipt and evidence binding before merge."""
    path = f"/{index}"
    findings: list[dict[str, Any]] = []
    receipt = shard.get("receipt")
    if not isinstance(receipt, dict):
        return [_finding(
            "missing_acceptance_receipt",
            f"{path}/receipt",
            "build requires the accept() receipt",
        )]
    if set(receipt) != ACCEPTANCE_RECEIPT_KEY:
        findings.append(_finding(
            "invalid_acceptance_receipt",
            f"{path}/receipt",
            "must use the frozen acceptance-receipt field set",
        ))
    if receipt.get("contract_id") != ACCEPTANCE_RECEIPT_CONTRACT_ID:
        findings.append(_finding(
            "contract_mismatch",
            f"{path}/receipt/contract_id",
            ACCEPTANCE_RECEIPT_CONTRACT_ID,
        ))
    for field in ("ruleset_id", "family_id", "section_id", "shard_id"):
        if receipt.get(field) != shard.get(field):
            findings.append(_finding(
                "acceptance_receipt_mismatch",
                f"{path}/receipt/{field}",
                "receipt identity does not match the shard",
            ))
    for digest_field in ("candidate_sha256", "packet_sha256", "shard_sha256"):
        digest = receipt.get(digest_field)
        if not isinstance(digest, str) or not SHA256_RE.fullmatch(digest):
            findings.append(_finding(
                "invalid_acceptance_receipt",
                f"{path}/receipt/{digest_field}",
                "must be a machine sha256 hex digest",
            ))
    body = {key: value for key, value in shard.items() if key != "receipt"}
    expected = _json_digest(body)
    if receipt.get("shard_sha256") != expected:
        findings.append(_finding(
            "acceptance_receipt_mismatch",
            f"{path}/receipt/shard_sha256",
            "does not match the shard body; caller mutation is rejected",
        ))
    binding = shard.get("evidence_binding")
    if not isinstance(binding, dict) or not isinstance(binding.get("spans"), list):
        findings.append(_finding(
            "missing_evidence_binding",
            f"{path}/evidence_binding",
            "accepted shards must carry the machine evidence binding",
        ))
    return findings


def build(shards: Any, evidence_root: Path | str | None = None) -> dict[str, Any]:
    """Merge accepted shards into one graph + manifest, rejecting conflicts.

    Callers nominate shards by semantic id or by passing the object
    ``accept()`` returned.  Bytes and digests always come from the
    machine-owned evidence root (or the same-session frozen snapshot).
    Deterministic: same shards in -> identical graph digest out.
    """
    findings: list[dict[str, Any]] = []
    if not isinstance(shards, list) or not shards:
        return _problem([_finding("shards_required", "/", "at least one accepted shard is required")])

    validated_root, root_findings = _check_evidence_root(resolve_evidence_root(evidence_root))
    if root_findings or validated_root is None:
        return _problem(root_findings)

    trusted: list[dict[str, Any]] = []
    for index, item in enumerate(shards):
        shard, item_findings = _resolve_accepted_shard(item, index, validated_root)
        findings.extend(item_findings)
        if shard is None:
            continue
        if set(shard) != SHARD_KEY:
            findings.append(_finding("invalid_shard_fields", f"/{index}", "must use the frozen field set"))
        if shard.get("contract_id") != SHARD_CONTRACT_ID:
            findings.append(_finding("contract_mismatch", f"/{index}/contract_id", SHARD_CONTRACT_ID))
        if shard.get("schema_version") != SCHEMA_VERSION:
            findings.append(_finding("version_mismatch", f"/{index}/schema_version", str(SCHEMA_VERSION)))
        if set(shard) == SHARD_KEY:
            findings.extend(_validate_shard_acceptance(shard, index))
        if not item_findings and set(shard) == SHARD_KEY:
            trusted.append(shard)
    if findings:
        return _problem(findings)
    shards = trusted

    ruleset_ids = {shard["ruleset_id"] for shard in shards}
    if len(ruleset_ids) != 1:
        return _problem([_finding("ruleset_mismatch", "/shards", "one graph may hold one ruleset")])

    nodes: dict[str, dict[str, Any]] = {}
    relations: dict[str, dict[str, Any]] = {}
    evidence_span_ids: set[str] = set()
    family_coverage: dict[str, str] = {}
    data_tables: set[str] = set()
    resolver_caps: set[str] = set()
    findings_list: list[dict[str, Any]] = []

    for shard in sorted(shards, key=lambda row: (row["shard_id"])):
        for fam, status in (shard.get("coverage") or {}).items():
            family_coverage[fam] = status
        # R1 promotion law: never promotion-eligible. Filled for every
        # declared family after the merge loop.
        for node in shard.get("nodes") or []:
            if not isinstance(node, dict):
                continue
            node_id = node["node_id"]
            if node_id in nodes:
                conflict = _merge_node_conflict(nodes[node_id], node)
                if conflict:
                    findings_list.append(_finding("node_conflict", f"/nodes/{node_id}", conflict))
                    continue
                nodes[node_id] = _merge_node(nodes[node_id], node)
            else:
                nodes[node_id] = copy.deepcopy(node)
            if node.get("node_kind") == "data-table" and node.get("properties", {}).get("table_name"):
                data_tables.add(node["properties"]["table_name"])
            if node.get("node_kind") == "capability" and node.get("properties", {}).get("resolver_capability"):
                resolver_caps.add(node["properties"]["resolver_capability"])
        for relation in shard.get("relations") or []:
            if not isinstance(relation, dict):
                continue
            relation_id = relation["relation_id"]
            if relation_id in relations:
                left = {k: v for k, v in relations[relation_id].items() if k != "evidence_span_ids"}
                right = {k: v for k, v in relation.items() if k != "evidence_span_ids"}
                if left != right:
                    findings_list.append(_finding("relation_conflict", f"/relations/{relation_id}", "same id different meaning"))
                    continue
                relations[relation_id]["evidence_span_ids"] = sorted(
                    set(relations[relation_id].get("evidence_span_ids") or [])
                    | set(relation.get("evidence_span_ids") or [])
                )
            else:
                relations[relation_id] = copy.deepcopy(relation)
        evidence_span_ids.update(shard.get("evidence_span_ids") or [])

    if findings_list:
        return _problem(findings_list)

    graph = {
        "contract_id": GRAPH_CONTRACT_ID,
        "schema_version": SCHEMA_VERSION,
        "ruleset_id": next(iter(ruleset_ids)),
        "ruleset_version": shards[0]["ruleset_version"],
        "source_language": shards[0]["source_language"],
        "nodes": [nodes[key] for key in sorted(nodes)],
        "relations": [relations[key] for key in sorted(relations)],
        "coverage": _aggregate_family_coverage(family_coverage),
        "family_runtime_ownership": _default_family_ownership(),
        "legacy_surface_lifecycle": {
            family: "visible" for family in sorted(RULE_FAMILIES)
        },
    }
    graph_digest = _json_digest(graph)

    manifest = {
        "contract_id": BUILD_MANIFEST_CONTRACT_ID,
        "schema_version": SCHEMA_VERSION,
        "ruleset_id": graph["ruleset_id"],
        "ruleset_version": graph["ruleset_version"],
        "source_bundles": _source_bundle_identities(shards),
        "graph_content_digest": graph_digest,
        "shards": [
            {
                "shard_id": shard["shard_id"],
                "shard_digest": _json_digest(shard),
            }
            for shard in sorted(shards, key=lambda row: row["shard_id"])
        ],
        "family_coverage": {
            family: family_coverage.get(family, "unresolved")
            for family in sorted(RULE_FAMILIES)
        },
        "family_promotion_eligibility": {
            family: {"promotion_eligible": False, "runtime_ownership": "legacy"}
            for family in sorted(RULE_FAMILIES)
        },
        "data_table_dependencies": sorted(data_tables),
        "resolver_capability_dependencies": sorted(resolver_caps),
        "compiler_identity": CONTRACT["compiler_identity"],
        "reviewer_identity": "deterministic",
        "review_status": "deterministic-accepted",
        "findings": findings_list + _source_vs_derivative_findings(),
    }
    return _ok_graph(graph, manifest)


def _merge_node_conflict(left: dict[str, Any], right: dict[str, Any]) -> str | None:
    for field in ("node_kind", "name", "authority", "audience", "visibility", "hard_gate"):
        if left.get(field) != right.get(field):
            return field
    return None


def _merge_node(existing: dict[str, Any], proposed: dict[str, Any]) -> dict[str, Any]:
    merged = copy.deepcopy(existing)
    merged["evidence_span_ids"] = sorted(
        set(existing.get("evidence_span_ids") or [])
        | set(proposed.get("evidence_span_ids") or [])
    )
    props = merged.setdefault("properties", {})
    props.update(proposed.get("properties") or {})
    return merged


def _aggregate_family_coverage(family_coverage: dict[str, str]) -> dict[str, str]:
    result = {family: "unresolved" for family in sorted(RULE_FAMILIES)}
    for family, status in family_coverage.items():
        if family in RULE_FAMILIES and status in COVERAGE_STATUSES:
            result[family] = status
    return result


def _default_family_ownership() -> dict[str, str]:
    return {family: "legacy" for family in sorted(RULE_FAMILIES)}


def _source_bundle_identities(shards: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rows: dict[str, dict[str, Any]] = {}
    for shard in shards:
        for span in (shard.get("evidence_binding") or {}).get("spans") or []:
            ref = span.get("source_ref") if isinstance(span, dict) else None
            if not isinstance(ref, dict):
                continue
            source_id = ref.get("source_id")
            if not source_id:
                continue
            key = _canonical(ref)
            if key not in rows:
                rows[key] = {
                    "source_id": source_id,
                    "bundle_sha256": ref.get("text_sha256"),
                    "file_sha256": ref.get("file_sha256"),
                }
    return [rows[key] for key in sorted(rows)]


# Recorded source-bundle identity for the coc7 healing family (MinerU full.md
# digest + original PDF digest). Machine-owned; never model-authored.
RECORDED_HEALING_SOURCE_BUNDLE = {
    "source_id": "pdf:coc7-keeper-rulebook-40th",
    "bundle_sha256": "47615458fbd8a68cb093f10d54862b9870a16146c6b41bee17e4f720da0193fa",
    "file_sha256": "a860499cf34b40cac385f51b6e667ab37ec0796c7329494def08c8b161fd71eb",
}

# Exact shadow-comparison exclusions from the R2a APPROVE-SUBSET review.
HEALING_SHADOW_EXCLUSIONS = [
    {
        "exclusion_id": "first-aid-one-hour-eligibility-enforcement",
        "exception_ref": "exception:coc7:healing:first-aid-window-uncompiled",
        "decision_ref": "decision:coc7:healing:first-aid-ordinary",
    },
    {
        "exclusion_id": "dual-rescuer-either-success-composition",
        "exception_ref": "exception:coc7:healing:first-aid-teamwork-uncompiled",
        "decision_ref": "decision:coc7:healing:first-aid-ordinary",
    },
]


def apply_healing_shadow_package(
    graph: dict[str, Any],
    manifest: dict[str, Any],
    *,
    reviewer_identity: str = "r2-candidate-review",
    review_status: str = "accepted",
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Overlay R2a shadow ownership on a compiler build() result.

    ``build()`` stays R1 (every family legacy, never promotion-eligible).
    Packaging for the healing family sets runtime ownership to shadow with
    the legacy surface still visible, records the exact shadow exclusions,
    and attaches the recorded source-bundle identity. Graph digest is
    recomputed after the ownership overlay.
    """
    graph = copy.deepcopy(graph)
    manifest = copy.deepcopy(manifest)
    family = "healing"
    graph.setdefault("family_runtime_ownership", {})[family] = "shadow"
    graph.setdefault("legacy_surface_lifecycle", {})[family] = "visible"
    digest = _json_digest(graph)
    manifest["graph_content_digest"] = digest
    promo = manifest.setdefault("family_promotion_eligibility", {}).setdefault(
        family, {"promotion_eligible": False, "runtime_ownership": "legacy"}
    )
    promo["promotion_eligible"] = False
    promo["runtime_ownership"] = "shadow"
    promo["shadow_exclusions"] = copy.deepcopy(HEALING_SHADOW_EXCLUSIONS)
    manifest["source_bundles"] = [copy.deepcopy(RECORDED_HEALING_SOURCE_BUNDLE)]
    manifest["reviewer_identity"] = reviewer_identity
    manifest["review_status"] = review_status
    findings = list(manifest.get("findings") or [])
    existing = {
        (row.get("code"), row.get("path"))
        for row in findings
        if isinstance(row, dict)
    }
    for exclusion in HEALING_SHADOW_EXCLUSIONS:
        path = (
            f"/family_promotion_eligibility/{family}/shadow_exclusions/"
            f"{exclusion['exclusion_id']}"
        )
        row = _finding(
            "executor_capability_gap",
            path,
            f"{exclusion['exclusion_id']} is source-complete via "
            f"{exclusion['exception_ref']} and is excluded from shadow comparison",
        )
        if (row["code"], row["path"]) not in existing:
            findings.append(row)
    manifest["findings"] = findings
    return graph, manifest


def _source_vs_derivative_findings() -> list[dict[str, Any]]:
    """Record known source-vs-derivative mismatches as Findings.

    Derivatives (rules-json, checklist, operation metadata) may disagree with
    the source on a computed threshold.  The compiler records the mismatch and
    never re-aligns the graph's source claim to match the derivative.
    """
    return [
        _finding(
            "source_vs_derivative_mismatch",
            "/computed_thresholds/{id}".replace("{id}", mismatch_id),
            f"source {mismatch['source_formula']} vs derivative {mismatch['derivative_formula']}",
        )
        for mismatch_id, mismatch in sorted(SOURCE_VS_DERIVATIVE_DISCREPANCIES.items())
        if mismatch.get("status") == "mismatch"
    ]


# --------------------------------------------------------------------------- #
# Healing decision -> current subsystem command SHAPE parity (pure compile).
# --------------------------------------------------------------------------- #
HEALING_COMMAND_SHAPES: dict[str, dict[str, Any]] = {
    "first-aid-stabilization": {
        "adapter": "subsystem-command",
        "kind": "stabilize",
        "phase": HEALING_COMMAND_PHASES["stabilize"],
        "payload_constants": {"method": "first_aid"},
        "payload_slots": [
            {"name": "skill_value", "ownership": "host-locked"},
            {"name": "rescuer_id", "ownership": "host-locked"},
            {"name": "pushed", "ownership": "host-locked"},
        ],
    },
    "medicine-stabilization": {
        "adapter": "subsystem-command",
        "kind": "stabilize",
        "phase": HEALING_COMMAND_PHASES["stabilize"],
        "payload_constants": {"method": "medicine"},
        "payload_slots": [
            {"name": "skill_value", "ownership": "host-locked"},
            {"name": "rescuer_id", "ownership": "host-locked"},
        ],
    },
    "dying-death-clock-tick": {
        "adapter": "subsystem-command",
        "kind": "dying_tick",
        "phase": HEALING_COMMAND_PHASES["dying_tick"],
        "payload_constants": {},
        "payload_slots": [
            {"name": "clock_kind", "ownership": "host-locked"},
        ],
    },
    "weekly-major-wound-recovery": {
        "adapter": "subsystem-command",
        "kind": "weekly_recovery",
        "phase": HEALING_COMMAND_PHASES["weekly_recovery"],
        "payload_constants": {},
        "payload_slots": [
            {"name": "complete_rest", "ownership": "keeper-semantic"},
            {"name": "poor_environment", "ownership": "keeper-semantic"},
            {"name": "medicine_skill_value", "ownership": "host-locked"},
            {"name": "caregiver_id", "ownership": "host-locked"},
        ],
    },
}


def healing_command_shape(decision_id: str) -> dict[str, Any] | None:
    """Return the current subsystem command shape for one healing decision."""
    return copy.deepcopy(HEALING_COMMAND_SHAPES.get(decision_id))
