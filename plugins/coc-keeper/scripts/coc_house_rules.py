#!/usr/bin/env python3
"""Turn a house rule stated in prose into a versioned, case-backed patch.

A table says "we don't spend Luck in this campaign" or "reading a Mythos tome
always costs a night".  Today the only thing in this repository called a house
rule is a label ``coc_state.py`` applies when a stat adjustment names something
that is not a known derived key -- it carries no rule reference, no scope, no
version, and the rules layer never reads it.  This module is the path from the
sentence to a record the system can actually reason about.

The pipeline, per docs/specs/pi-coc-rule-override-and-session-rulings.md §5:

    natural language
      -> deterministic request carrying a CLOSED catalogue of legal targets
      -> external semantic step, digest-bound to that request
      -> RulePatch candidate
      -> deterministic validation
      -> generated cases the user confirms
      -> versioned patch

Two things make this honest rather than a prompt with extra steps.

**The prose is never parsed by code.**  Deciding what a sentence means is a
semantic act, so it happens in the semantic step, and this module validates the
result instead of pattern-matching the input.  No keyword list, phrase table, or
regex over the user's sentence appears anywhere below; the sentence is carried
into the request verbatim and is never read again.

**The user confirms cases, not prose.**  A patch arrives with a positive case
(a situation it changes, with before and after), a negative case (one a reader
might expect it to change and it does not), and a boundary case where its scope
ends.  A patch whose behaviour cannot be stated that way has not been
understood well enough to admit, so an empty case set is refused rather than
accepted with a shrug.  What the user says yes to is the cases.

Scope boundary: a confirmed patch here is a *record*.  Admitting it to the rule
graph and enforcing it is slice R2, and executing its cases as regression tests
follows that.  Nothing in this module changes an adjudication.
"""
from __future__ import annotations

import copy
import hashlib
import json
import re
import sys
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from coc_fileio import write_json_atomic as _write_json_atomic

CONTRACT_ID = "coc.house-rule-patch.v1"
SCHEMA_VERSION = 1
EVALUATOR_ID = "coc-house-rule-compiler"
REQUEST_KIND = "coc_house_rule_compile_request"
REQUEST_FILENAME = "house-rule-compile-request.json"
RESULT_FILENAME = "house-rule-compile-result.json"

DOCUMENT_NAME = "house-rules.json"

#: Semantic id grammar.  Two capped hyphenated segments minimum, for the reason
#: the ruling module records: a single-segment `[a-z0-9]+` accepts a lowercase
#: hex digest, which is the one shape the Model-Facing Identifier Law exists to
#: exclude.  No grammar stops a digest chopped into runs; the real guarantee is
#: that code generates digests and never asks a model to relay one.
_SEGMENT = r"[a-z0-9]{1,24}"
PATCH_ID_RE = re.compile(rf"^patch:{_SEGMENT}(?:-{_SEGMENT}){{1,11}}$")

#: A patch says what it does to its target.  Priority never decides this; it
#: only orders patches that have each declared one (spec §3.2).
RELATIONS: tuple[str, ...] = ("overrides", "augments", "disables", "enables")

#: The ladder, most specific first.  Adopted from the gitignored
#: coc7-core-rulegraph-v0.1 reference pack and reproduced in the spec, because
#: a taxonomy recorded only in an untracked directory does not survive a clean
#: working tree.
LAYERS: tuple[str, ...] = (
    "system_safety",
    "session_ruling",
    "house_rule",
    "campaign_patch",
    "module_supplement",
    "era_supplement",
    "official_optional",
    "core",
)

#: Layers a house-rule import may write.  `system_safety` and `core` are not
#: negotiable from a table's prose, and `session_ruling` belongs to the ruling
#: path, which has its own lifetime rules.
AUTHORABLE_LAYERS: frozenset[str] = frozenset({"house_rule", "campaign_patch"})

SCOPES: tuple[str, ...] = ("campaign", "session", "scene")
CASE_KINDS: tuple[str, ...] = ("positive", "negative", "boundary")
STATUSES: tuple[str, ...] = ("proposed", "confirmed", "rejected", "superseded")

CASE_FIELDS: frozenset[str] = frozenset({
    "kind", "situation", "without_patch", "with_patch",
})

PATCH_FIELDS: frozenset[str] = frozenset({
    "patch_id", "relation", "target", "layer", "scope", "version",
    "reason", "statement", "cases",
})

RECORD_FIELDS: frozenset[str] = frozenset({
    "patch", "status", "request_sha256", "source_text", "decided_reason",
})

DOCUMENT_FIELDS: frozenset[str] = frozenset({
    "contract_id", "schema_version", "campaign_id", "patches",
})

PROVENANCE_FIELDS: frozenset[str] = frozenset({
    "kind", "request_sha256", "reviewed_artifact",
})
PROVENANCE_KIND = "house_rule_semantic_compile"

RESULT_FIELDS: frozenset[str] = frozenset({
    "schema_version", "evaluator_id", "evaluation_provenance", "patch",
})


class HouseRuleError(ValueError):
    """A request, result, or patch could not be accepted."""


# --------------------------------------------------------------------------
# Request
# --------------------------------------------------------------------------

def _canonical_bytes(payload: Any) -> bytes:
    return json.dumps(
        payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False
    ).encode("utf-8")


def request_sha256(request: dict[str, Any]) -> str:
    return hashlib.sha256(_canonical_bytes(request)).hexdigest()


def target_catalogue(ruleset_dir: Path | str) -> list[dict[str, str]]:
    """Every patchable target in one ruleset's rule graph.

    A patch may only name something in here.  The catalogue is what stops the
    semantic step inventing a plausible-sounding rule id: the choice is from a
    closed set, and a target outside it is refused rather than created.
    """
    path = Path(ruleset_dir) / "rule-graph.json"
    try:
        graph = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise HouseRuleError(f"cannot read {path}") from exc
    rows: list[dict[str, str]] = []
    for node in graph.get("nodes") or []:
        if not isinstance(node, dict):
            continue
        kind = node.get("node_kind")
        if kind not in {"rule", "decision"}:
            continue
        node_id = node.get("node_id")
        if not isinstance(node_id, str) or not node_id:
            continue
        rows.append({
            "target_id": node_id,
            "target_kind": str(kind),
            "name": str(node.get("name") or ""),
            "family_id": str((node.get("properties") or {}).get("family_id") or ""),
        })
    rows.sort(key=lambda row: (row["target_kind"], row["target_id"]))
    return rows


def build_compile_request(
    *,
    campaign_id: str,
    source_text: str,
    ruleset_dir: Path | str,
    ruleset_id: str = "coc7",
) -> dict[str, Any]:
    """One request the semantic step answers.

    ``source_text`` is the table's own sentence, carried verbatim.  It is never
    read by this module -- not here, not in validation, not in retrieval.
    """
    if not isinstance(source_text, str) or not source_text.strip():
        raise HouseRuleError("source_text must be a non-empty string")
    return {
        "schema_version": SCHEMA_VERSION,
        "kind": REQUEST_KIND,
        "contract_id": CONTRACT_ID,
        "campaign_id": str(campaign_id),
        "ruleset_id": str(ruleset_id),
        "source_text": source_text,
        "legal_relations": list(RELATIONS),
        "legal_layers": sorted(AUTHORABLE_LAYERS),
        "legal_scopes": list(SCOPES),
        "required_case_kinds": list(CASE_KINDS),
        "targets": target_catalogue(ruleset_dir),
    }


def write_compile_request(directory: Path | str, request: dict[str, Any]) -> Path:
    path = Path(directory) / REQUEST_FILENAME
    _write_json_atomic(path, request, indent=2, ensure_ascii=False,
                       trailing_newline=True)
    return path


# --------------------------------------------------------------------------
# Validation
# --------------------------------------------------------------------------

def _closed(value: Any, fields: frozenset[str], label: str) -> list[str]:
    if not isinstance(value, dict):
        return [f"{label} must be an object"]
    errors = []
    missing = sorted(fields - set(value))
    unexpected = sorted(set(value) - fields)
    if missing:
        errors.append(f"{label} missing: {', '.join(missing)}")
    if unexpected:
        errors.append(f"{label} unexpected: {', '.join(unexpected)}")
    return errors


def _nonempty_str(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())


def validate_cases(cases: Any) -> list[str]:
    """Cases are the thing the user actually confirms, so they carry weight.

    Every kind must be present.  A patch whose behaviour cannot be stated as a
    situation with a before and an after has not been understood well enough to
    admit, and admitting it anyway would mean nobody can ever tell whether it
    did what the table asked.
    """
    errors: list[str] = []
    if not isinstance(cases, list) or not cases:
        return ["patch.cases must be a non-empty array"]
    seen_kinds: set[str] = set()
    for index, case in enumerate(cases):
        label = f"patch.cases[{index}]"
        case_errors = _closed(case, CASE_FIELDS, label)
        if case_errors:
            errors.extend(case_errors)
            continue
        kind = case.get("kind")
        if kind not in CASE_KINDS:
            errors.append(f"{label}.kind must be one of {', '.join(CASE_KINDS)}")
        else:
            seen_kinds.add(kind)
        for field in ("situation", "without_patch", "with_patch"):
            if not _nonempty_str(case.get(field)):
                errors.append(f"{label}.{field} must be a non-empty string")
        if (
            _nonempty_str(case.get("without_patch"))
            and _nonempty_str(case.get("with_patch"))
        ):
            changed = case["without_patch"].strip() != case["with_patch"].strip()
            if kind == "positive" and not changed:
                errors.append(
                    f"{label} is positive but states the same outcome with and "
                    "without the patch"
                )
            if kind == "negative" and changed:
                errors.append(
                    f"{label} is negative but states a different outcome with "
                    "the patch"
                )
    for kind in CASE_KINDS:
        if kind not in seen_kinds:
            errors.append(f"patch.cases must include a {kind} case")
    return errors


def validate_patch(
    patch: Any,
    *,
    known_target_ids: frozenset[str] | set[str] | None = None,
) -> list[str]:
    errors = _closed(patch, PATCH_FIELDS, "patch")
    if errors:
        return errors

    patch_id = patch.get("patch_id")
    if not isinstance(patch_id, str) or not PATCH_ID_RE.fullmatch(patch_id):
        errors.append(
            "patch.patch_id must be a semantic id like 'patch:no-luck-spending'"
        )
    if patch.get("relation") not in RELATIONS:
        errors.append(f"patch.relation must be one of {', '.join(RELATIONS)}")
    layer = patch.get("layer")
    if layer not in LAYERS:
        errors.append("patch.layer is not a known layer")
    elif layer not in AUTHORABLE_LAYERS:
        errors.append(
            f"patch.layer {layer!r} may not be authored from a house rule; "
            f"allowed: {', '.join(sorted(AUTHORABLE_LAYERS))}"
        )
    if patch.get("scope") not in SCOPES:
        errors.append(f"patch.scope must be one of {', '.join(SCOPES)}")

    target = patch.get("target")
    if not _nonempty_str(target):
        errors.append("patch.target must be a non-empty string")
    elif known_target_ids is not None and target not in known_target_ids:
        errors.append(
            f"patch.target {target!r} names nothing in the rule graph; a patch "
            "may only target a rule or decision the catalogue offered"
        )

    version = patch.get("version")
    if not isinstance(version, int) or isinstance(version, bool) or version < 1:
        errors.append("patch.version must be an integer >= 1")
    for field in ("reason", "statement"):
        if not _nonempty_str(patch.get(field)):
            errors.append(f"patch.{field} must be a non-empty string")

    errors.extend(validate_cases(patch.get("cases")))
    return errors


def validate_compile_result(
    request: dict[str, Any],
    result: Any,
    *,
    known_target_ids: frozenset[str] | set[str] | None = None,
) -> list[str]:
    """Every reason this result cannot be trusted, or an empty list."""
    errors = _closed(result, RESULT_FIELDS, "result")
    if errors:
        return errors
    if result.get("schema_version") != SCHEMA_VERSION:
        errors.append(f"result.schema_version must be {SCHEMA_VERSION}")
    if result.get("evaluator_id") != EVALUATOR_ID:
        errors.append(f"result.evaluator_id must be {EVALUATOR_ID!r}")

    provenance = result.get("evaluation_provenance")
    errors.extend(_closed(provenance, PROVENANCE_FIELDS, "evaluation_provenance"))
    if isinstance(provenance, dict):
        if provenance.get("kind") != PROVENANCE_KIND:
            errors.append(f"evaluation_provenance.kind must be {PROVENANCE_KIND!r}")
        if provenance.get("reviewed_artifact") != REQUEST_FILENAME:
            errors.append(
                f"evaluation_provenance.reviewed_artifact must be {REQUEST_FILENAME!r}"
            )
        # The digest is what binds this answer to that question. Without it a
        # result compiled against a different catalogue, a different sentence,
        # or a different ruleset would be accepted as an answer to this one.
        if provenance.get("request_sha256") != request_sha256(request):
            errors.append("evaluation_provenance.request_sha256 mismatch")

    if known_target_ids is None:
        catalogue = request.get("targets")
        if isinstance(catalogue, list):
            known_target_ids = frozenset(
                str(row.get("target_id"))
                for row in catalogue
                if isinstance(row, dict) and row.get("target_id")
            )
    errors.extend(validate_patch(result.get("patch"),
                                 known_target_ids=known_target_ids))
    return errors


# --------------------------------------------------------------------------
# Persistence
# --------------------------------------------------------------------------

def new_document(campaign_id: str) -> dict[str, Any]:
    return {
        "contract_id": CONTRACT_ID,
        "schema_version": SCHEMA_VERSION,
        "campaign_id": str(campaign_id),
        "patches": [],
    }


def document_path(campaign_dir: Path | str) -> Path:
    return Path(campaign_dir) / "save" / DOCUMENT_NAME


def load_document(campaign_dir: Path | str) -> dict[str, Any]:
    path = document_path(campaign_dir)
    if not path.is_file():
        return new_document(Path(campaign_dir).name)
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise HouseRuleError(
            f"{DOCUMENT_NAME} is unreadable; refusing to replace it"
        ) from exc
    if (
        not isinstance(payload, dict)
        or set(payload) != DOCUMENT_FIELDS
        or payload.get("contract_id") != CONTRACT_ID
        or payload.get("schema_version") != SCHEMA_VERSION
        or not isinstance(payload.get("patches"), list)
    ):
        raise HouseRuleError(f"{DOCUMENT_NAME} does not match the current schema")
    return payload


def _save(campaign_dir: Path | str, document: dict[str, Any]) -> None:
    document["patches"].sort(
        key=lambda row: (
            str((row.get("patch") or {}).get("patch_id")),
            int((row.get("patch") or {}).get("version") or 0),
        )
    )
    _write_json_atomic(document_path(campaign_dir), document, indent=2,
                       ensure_ascii=False, trailing_newline=True)


def propose_patch(
    campaign_dir: Path | str,
    *,
    request: dict[str, Any],
    result: dict[str, Any],
    known_target_ids: frozenset[str] | set[str] | None = None,
) -> dict[str, Any]:
    """Record a validated candidate as ``proposed``.  It is not in force.

    Proposing is deliberately separate from confirming: what the user agrees to
    is the cases, and they cannot agree to them before they exist.
    """
    errors = validate_compile_result(request, result,
                                     known_target_ids=known_target_ids)
    if errors:
        raise HouseRuleError("; ".join(errors))
    patch = copy.deepcopy(result["patch"])
    document = load_document(campaign_dir)
    for row in document["patches"]:
        existing = row.get("patch") or {}
        if (
            existing.get("patch_id") == patch["patch_id"]
            and existing.get("version") == patch["version"]
        ):
            if existing == patch and row.get("status") == "proposed":
                return {"record": row, "recorded": False, "reason": "replay"}
            raise HouseRuleError(
                f"patch {patch['patch_id']!r} version {patch['version']} already "
                "exists; raise the version instead of rewriting it"
            )
    record = {
        "patch": patch,
        "status": "proposed",
        "request_sha256": request_sha256(request),
        "source_text": request.get("source_text"),
        "decided_reason": None,
    }
    unexpected = _closed(record, RECORD_FIELDS, "record")
    if unexpected:
        raise HouseRuleError("; ".join(unexpected))
    document["patches"].append(record)
    _save(campaign_dir, document)
    return {"record": record, "recorded": True, "reason": "proposed"}


def decide_patch(
    campaign_dir: Path | str,
    *,
    patch_id: str,
    version: int,
    accept: bool,
    decided_reason: str,
) -> dict[str, Any]:
    """The confirmation gate.  Only a confirmed patch is ever surfaced.

    A rejected patch is kept, not deleted: a table that said no to a house rule
    said something, and re-proposing it later without that history would lose
    the fact that it was already considered.
    """
    if not _nonempty_str(decided_reason):
        raise HouseRuleError("decided_reason must be a non-empty string")
    document = load_document(campaign_dir)
    for row in document["patches"]:
        patch = row.get("patch") or {}
        if patch.get("patch_id") != patch_id or patch.get("version") != version:
            continue
        if row.get("status") != "proposed":
            raise HouseRuleError(
                f"patch {patch_id!r} version {version} is {row.get('status')!r}, "
                "not proposed"
            )
        row["status"] = "confirmed" if accept else "rejected"
        row["decided_reason"] = decided_reason
        if accept:
            for other in document["patches"]:
                other_patch = other.get("patch") or {}
                if (
                    other_patch.get("patch_id") == patch_id
                    and other_patch.get("version") != version
                    and other.get("status") == "confirmed"
                ):
                    other["status"] = "superseded"
        _save(campaign_dir, document)
        return {"patch_id": patch_id, "version": version, "status": row["status"]}
    raise HouseRuleError(f"no proposed patch {patch_id!r} version {version}")


def confirmed_patches(
    campaign_dir: Path | str,
    *,
    target: str | None = None,
) -> list[dict[str, Any]]:
    """Confirmed patches, optionally for one target, deterministically ordered.

    Ordered by layer specificity first, so a reader sees the most specific
    declaration before the more general one.  Ordering is not resolution: a
    conflict between two declared patches is the compiler's to raise (§3.2),
    never something decided by reading this list top-down.
    """
    document = load_document(campaign_dir)
    rows = [
        row for row in document["patches"]
        if row.get("status") == "confirmed"
        and (target is None or (row.get("patch") or {}).get("target") == target)
    ]
    order = {layer: index for index, layer in enumerate(LAYERS)}
    rows.sort(key=lambda row: (
        order.get((row.get("patch") or {}).get("layer"), len(LAYERS)),
        str((row.get("patch") or {}).get("patch_id")),
        -int((row.get("patch") or {}).get("version") or 0),
    ))
    return rows
