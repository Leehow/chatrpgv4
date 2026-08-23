#!/usr/bin/env python3
"""Build the final player-readable battle report from one real playtest run."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import tempfile
from collections import Counter
from pathlib import Path
from typing import Any


SCHEMA_VERSION = 8
JSON_OUTPUT = "battle-report-evidence.json"
MARKDOWN_OUTPUT = "battle-report.md"
METADATA_CANDIDATES = ("run.json", "playtest.json")
KEEPER_ROLES = {"keeper", "keeper_under_test", "kp", "narrator"}
PLAYER_ROLES = {"player", "player_simulator"}
DIALOGUE_ROLES = KEEPER_ROLES | PLAYER_ROLES
PUBLIC_VISIBILITIES = {"public", "consequence_public"}
# Corrected settlements remain in the audit log but must not reappear as
# player-facing battle-report dice or HP chains.
HIDDEN_PUBLIC_VISIBILITIES = {"superseded", "voided", "corrected_hidden"}
MARKDOWN_HIDDEN_KEYS = {
    "clue_graph",
    "keeper_notes",
    "keeper_secret",
    "module_truth",
    "npc_agendas",
    "notes",
    "private_notes",
    "scenario_id",
    "scenario_truth",
    "secret",
}

ZH_MECHANICAL_LABELS = {
    "Art/Craft (Photography)": "艺术/手艺（摄影）",
    "Credit Rating": "信用评级",
    "Dodge": "闪避",
    "Drive Auto": "汽车驾驶",
    "Fast Talk": "话术",
    "Fighting (Brawl)": "斗殴",
    "First Aid": "急救",
    "First Impression": "初印象",
    "History": "历史",
    "Language (Own: English)": "母语（英语）",
    "Library Use": "图书馆使用",
    "Listen": "聆听",
    "Navigate": "导航",
    "Persuade": "说服",
    "Psychology": "心理学",
    "Spot Hidden": "侦查",
    "Stealth": "潜行",
}


class ExportError(RuntimeError):
    """Raised when source or destination safety prevents an honest export."""


_TURN_FINALIZATION_MODULE: Any = None


def _turn_finalization() -> Any:
    """Read-only access to the canonical roll-visibility contract.

    Canonical caller: the dice finalization-binding gate below, which must
    share ``is_player_facing_roll`` and ``SUPERSEDED_ROLL_VISIBILITIES`` with
    the write side. The enum is read dynamically so values added later by the
    write side (e.g. an abandonment disposition) keep working here unchanged.
    """
    global _TURN_FINALIZATION_MODULE
    if _TURN_FINALIZATION_MODULE is None:
        scripts_dir = Path(__file__).resolve().parents[3] / "scripts"
        if str(scripts_dir) not in sys.path:
            sys.path.insert(0, str(scripts_dir))
        import coc_turn_finalization

        _TURN_FINALIZATION_MODULE = coc_turn_finalization
    return _TURN_FINALIZATION_MODULE


_TOOLBOX_MODULE: Any = None


def _registered_tool_names() -> set[str]:
    global _TOOLBOX_MODULE
    if _TOOLBOX_MODULE is None:
        scripts_dir = Path(__file__).resolve().parents[3] / "scripts"
        if str(scripts_dir) not in sys.path:
            sys.path.insert(0, str(scripts_dir))
        import coc_toolbox

        _TOOLBOX_MODULE = coc_toolbox
    return set(_TOOLBOX_MODULE.TOOLS)


_STATE_MODULE: Any = None
_GIT_VERIFY_MODULE: Any = None

REQUIRED_RUN_IDENTITY_FIELDS = (
    "campaign_id",
    "run_segment_id",
    "session_id",
    "plugin_version",
    "ruleset_id",
    "ruleset_version",
)
_IDENTITY_SENTINELS = {
    "missing", "unknown", "unset", "placeholder", "none", "null", "n/a", "na",
}
_HARNESS_ONLY_IDENTITY_FIELDS = (
    "run_segment_id",
    "session_id",
    "plugin_version",
    "ruleset_id",
    "ruleset_version",
)


def _plugin_scripts_dir() -> Path:
    scripts_dir = Path(__file__).resolve().parents[3] / "scripts"
    if str(scripts_dir) not in sys.path:
        sys.path.insert(0, str(scripts_dir))
    return scripts_dir


def _state_api() -> Any:
    global _STATE_MODULE
    if _STATE_MODULE is None:
        _plugin_scripts_dir()
        import coc_state

        _STATE_MODULE = coc_state
    return _STATE_MODULE


def _git_verify_api() -> Any:
    global _GIT_VERIFY_MODULE
    if _GIT_VERIFY_MODULE is None:
        _plugin_scripts_dir()
        import coc_git_history_verify

        _GIT_VERIFY_MODULE = coc_git_history_verify
    return _GIT_VERIFY_MODULE


def _identity_string(value: Any) -> str | None:
    if not isinstance(value, str) or not value.strip() or value != value.strip():
        return None
    if value.casefold() in _IDENTITY_SENTINELS:
        return None
    return value


def _campaign_workspace_root(
    run_dir: Path, campaign_relative: str | None
) -> Path | None:
    if not campaign_relative:
        return None
    parts = Path(campaign_relative).parts
    if len(parts) < 3 or parts[-2] != "campaigns" or parts[-3] != ".coc":
        return None
    prefix = parts[:-3]
    return run_dir.joinpath(*prefix) if prefix else run_dir


def _resolve_canonical_run_identity(
    run_dir: Path,
    campaign_relative: str | None,
    harness: dict[str, Any],
) -> tuple[dict[str, str], list[str], dict[str, Any]]:
    """Bind export identity to the campaign-owned record. Fail closed.

    External run.json / playtest.json may keep non-authoritative harness
    metadata. They must not override a present canonical record or discard
    matching transcript rows when that record is complete.
    """
    evidence: dict[str, Any] = {
        "source": "missing",
        "canonical_present": False,
        "harness_conflict_fields": [],
        "error": None,
    }
    findings: list[str] = []
    if campaign_relative is None:
        findings.append("campaign source directory is missing")
        return {}, findings, evidence
    campaign_dir = run_dir / campaign_relative
    state = _state_api()
    try:
        canonical = state.load_run_identity(campaign_dir)
    except state.UnsupportedSaveSchema as exc:
        evidence["source"] = "corrupt"
        evidence["error"] = exc.to_dict()
        findings.append(
            "canonical campaign run identity is corrupt or mismatched "
            f"({exc.reason})"
        )
        return {}, findings, evidence
    if canonical is None:
        findings.append("canonical campaign run identity is missing")
        return {}, findings, evidence
    identity = {
        field: str(canonical[field])
        for field in REQUIRED_RUN_IDENTITY_FIELDS
    }
    evidence["source"] = "canonical_campaign"
    evidence["canonical_present"] = True
    conflicts = [
        field
        for field in REQUIRED_RUN_IDENTITY_FIELDS
        if _identity_string(harness.get(field)) not in {None, identity[field]}
    ]
    if conflicts:
        evidence["harness_conflict_fields"] = conflicts
        findings.append(
            "harness metadata conflicts with canonical campaign run identity: "
            + ", ".join(conflicts)
        )
    return identity, findings, evidence


def _apply_authoritative_identity(
    metadata: dict[str, Any],
    identity: dict[str, str],
    *,
    canonical_present: bool,
) -> None:
    if canonical_present:
        metadata.update(identity)
        return
    for field in _HARNESS_ONLY_IDENTITY_FIELDS:
        metadata.pop(field, None)


def _bounded_state_integrity(proof: dict[str, Any] | None) -> dict[str, Any]:
    payload = proof if isinstance(proof, dict) else {}
    findings = payload.get("findings") if isinstance(payload.get("findings"), list) else []
    reason_codes = [
        str(item.get("code"))
        for item in findings
        if isinstance(item, dict) and item.get("code")
    ]
    tree = payload.get("tree") if isinstance(payload.get("tree"), dict) else {}
    counts = payload.get("counts") if isinstance(payload.get("counts"), dict) else {}
    status = payload.get("status")
    if status not in {"PASS", "FAIL", "NOT_PROVEN"}:
        status = "NOT_PROVEN"
        if "unusable_git_proof" not in reason_codes:
            reason_codes.append("unusable_git_proof")
    return {
        "status": status,
        "reason_codes": reason_codes,
        "repo_present": payload.get("repo_present") is True,
        "history_valid": payload.get("history_valid") is True,
        "fsck_ok": payload.get("fsck_ok"),
        "tree_clean": tree.get("clean"),
        "history_reset": payload.get("history_reset") is True,
        "counts": {
            "turn_commits": counts.get("turn_commits"),
            "receipts": counts.get("receipts"),
            "paired_receipts": counts.get("paired_receipts"),
        },
    }


def _collect_git_state_proof(
    run_dir: Path,
    campaign_relative: str | None,
    valid_finalizations: list[dict[str, Any]],
) -> dict[str, Any]:
    verify = _git_verify_api()
    valid_ids = [
        str(row.get("finalization_id"))
        for row in valid_finalizations
        if isinstance(row, dict) and isinstance(row.get("finalization_id"), str)
        and row.get("finalization_id")
    ]
    expected_id = valid_ids[-1] if valid_ids else None
    workspace = _campaign_workspace_root(run_dir, campaign_relative)
    if campaign_relative is None or workspace is None:
        return {
            "status": verify.STATUS_NOT_PROVEN,
            "findings": [{
                "code": "campaign_workspace_unresolved",
                "detail": "campaign workspace root could not be resolved",
                "sha": None,
                "finalization_id": expected_id,
                "path": None,
            }],
        }
    proof = verify.state_integrity_proof(
        workspace,
        Path(campaign_relative).name,
        expected_finalization_id=expected_id,
        valid_finalization_ids=valid_ids,
    )
    return proof.to_dict()


def _canonical_bytes(value: Any) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")


def _pretty_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2)


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _canonical_digest(value: Any) -> str:
    return "sha256:" + _sha256(_canonical_bytes(value))


def _stable_rows(rows: Any) -> list[dict[str, Any]]:
    """Return deterministic audit rows without inventing source meaning."""
    return sorted(
        [row for row in (rows or []) if isinstance(row, dict)],
        key=_canonical_bytes,
    )


def _flatten_document_rows(
    document: Any, map_name: str, identity_name: str, *, row_kind: str | None = None
) -> list[dict[str, Any]]:
    mapping = document.get(map_name) if isinstance(document, dict) else None
    if not isinstance(mapping, dict):
        return []
    rows: list[dict[str, Any]] = []
    for key, value in mapping.items():
        if not isinstance(value, dict):
            continue
        row = dict(value)
        row.setdefault(identity_name, str(key))
        if row_kind is not None:
            row["record_kind"] = row_kind
        rows.append(row)
    return _stable_rows(rows)


def _has_explicit_delta(value: Any) -> bool:
    """Recognize typed before/after or delta payloads; never infer from prose."""
    if not isinstance(value, dict):
        return False
    keys = {str(key) for key in value}
    if "before" in keys and "after" in keys:
        return True
    if keys & {"delta", "applied_delta", "state_delta", "change"}:
        return True
    if (
        value.get("category") in {"state_delta", "asset_delta"}
        and value.get("effect_id")
        and value.get("action") in {"added", "removed", "granted", "spent", "used"}
    ):
        return True
    before_stems = {key[:-7] for key in keys if key.endswith("_before")}
    after_stems = {key[:-6] for key in keys if key.endswith("_after")}
    return bool(before_stems & after_stems)


def _state_diff_rows(
    toolbox_calls: Any, valid_finalizations: Any
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    registered = _registered_tool_names()
    calls_by_decision = {
        str((call.get("args") or {}).get("decision_id")): call
        for call in toolbox_calls or []
        if isinstance(call, dict)
        and call.get("ok") is True
        and str(call.get("tool") or "") in registered
        and str(call.get("tool") or "").startswith("state.")
        and isinstance(call.get("args"), dict)
        and (call.get("args") or {}).get("decision_id")
    }
    for receipt in valid_finalizations or []:
        if not isinstance(receipt, dict):
            continue
        bundle = receipt.get("bundle") if isinstance(receipt.get("bundle"), dict) else {}
        for category in ("state_delta", "asset_delta"):
            for effect in bundle.get(category) or []:
                if not isinstance(effect, dict) or not _has_explicit_delta(effect):
                    continue
                source_decision_id = str(effect.get("source_decision_id") or "")
                source_call = calls_by_decision.get(source_decision_id)
                if source_call is None:
                    continue
                rows.append({
                    "source_kind": "finalization_bundle",
                    "finalization_id": receipt.get("finalization_id"),
                    "category": category,
                    "source_tool": source_call.get("tool"),
                    "effect": effect,
                })
    return _stable_rows(rows)


def _valid_scene_promotion(row: Any) -> bool:
    if not isinstance(row, dict):
        return False
    required = {
        "schema_version", "event_id", "event_type", "promotion_id", "scene_id",
        "from_role", "to_role", "from_contract_id", "to_contract_id", "reason",
        "source_event_ids", "resolved_drift_event_ids", "source_decision_id",
        "module_divergence", "request_digest", "ts",
    }
    if set(row) != required or row.get("schema_version") != 1:
        return False
    strings = required - {
        "schema_version", "source_event_ids", "resolved_drift_event_ids",
        "module_divergence",
    }
    if any(not isinstance(row.get(key), str) or not row[key].strip() for key in strings):
        return False
    source_ids = row.get("source_event_ids")
    resolved_ids = row.get("resolved_drift_event_ids")
    if (
        not isinstance(source_ids, list) or not source_ids
        or any(not isinstance(value, str) or not value for value in source_ids)
        or len(source_ids) != len(set(source_ids))
        or not isinstance(resolved_ids, list)
        or any(not isinstance(value, str) or value not in source_ids for value in resolved_ids)
        or row.get("event_type") != "scene_promotion"
        or row.get("module_divergence") is not True
        or not str(row.get("event_id")).startswith("tool-operation-v1:")
        or not str(row.get("promotion_id")).startswith("scene-promotion-v1:")
        or not str(row.get("from_contract_id")).startswith("scene-contract-v1:")
        or not str(row.get("to_contract_id")).startswith("scene-contract-v1:")
        or not str(row.get("request_digest")).startswith("sha256:")
    ):
        return False
    return True


def _valid_control_override(row: Any) -> bool:
    if not isinstance(row, dict):
        return False
    required = {
        "override_id", "subject_ref", "override_type", "source_rule_id",
        "source_ref", "active", "expiry", "allowed_scope",
    }
    if not required <= set(row) or row.get("active") is not True:
        return False
    if row.get("override_type") not in {
        "bout_of_madness", "phobia", "mania", "unconscious"
    }:
        return False
    for key in ("override_id", "subject_ref", "source_rule_id", "source_ref"):
        if not isinstance(row.get(key), str) or not row[key].strip():
            return False
    if not row["subject_ref"].startswith("pc:") or not row["source_rule_id"].startswith("core."):
        return False
    expiry = row.get("expiry")
    allowed_scope = row.get("allowed_scope")
    if (
        not isinstance(expiry, dict) or not isinstance(expiry.get("kind"), str)
        or not isinstance(allowed_scope, list) or not allowed_scope
        or any(not isinstance(value, str) or not value.strip() for value in allowed_scope)
    ):
        return False
    source_ref = row["source_ref"]
    if row["override_type"] == "bout_of_madness":
        return source_ref.startswith("sanity_bout:") and expiry.get("kind") == "rounds_remaining"
    if row["override_type"] == "unconscious":
        return source_ref.startswith("investigator_state:") and expiry.get("kind") == "condition_cleared"
    return expiry.get("kind") is not None


def _review_digest_valid(row: Any) -> bool:
    if not isinstance(row, dict) or not isinstance(row.get("review_digest"), str):
        return False
    payload = {
        key: value for key, value in row.items()
        if key not in {"review_digest", "ts"}
    }
    return row["review_digest"] == _canonical_digest(payload)


def _player_safe_impressions(psychology_document: Any) -> list[dict[str, str]]:
    realizations = (
        psychology_document.get("realizations")
        if isinstance(psychology_document, dict) else None
    )
    if not isinstance(realizations, dict):
        return []
    rows: list[dict[str, str]] = []
    for value in realizations.values():
        if not isinstance(value, dict):
            continue
        observation = value.get("visible_observation")
        if not isinstance(observation, str) or not observation.strip():
            continue
        row = {"visible_observation": observation}
        question = value.get("question")
        if isinstance(question, str) and question.strip():
            row["question"] = question
        rows.append(row)
    return sorted(rows, key=_canonical_bytes)


def _safe_source_path(run_dir: Path, relative: str) -> Path:
    relative_path = Path(relative)
    if relative_path.is_absolute() or ".." in relative_path.parts:
        raise ExportError(f"source path escapes run directory: {relative}")
    candidate = run_dir / relative_path
    try:
        candidate.resolve(strict=False).relative_to(run_dir.resolve())
    except ValueError as exc:
        raise ExportError(f"source path escapes run directory: {relative}") from exc
    return candidate


def _read_source(
    run_dir: Path,
    relative: str,
    kind: str,
    manifest: dict[str, dict[str, Any]],
    *,
    required: bool = False,
) -> Any:
    path = _safe_source_path(run_dir, relative)
    entry: dict[str, Any] = {
        "kind": kind,
        "path": relative,
        "present": False,
        "required": required,
    }
    manifest[relative] = entry
    if not path.exists():
        entry["status"] = "MISSING"
        return None
    if path.is_symlink() or not path.is_file():
        entry["status"] = "UNSAFE"
        entry["error"] = "source must be a regular non-symlink file"
        if required:
            raise ExportError(f"unsafe required source: {relative}")
        return None

    raw = path.read_bytes()
    entry.update(
        {
            "byte_count": len(raw),
            "present": True,
            "sha256": _sha256(raw),
            "status": "READ",
        }
    )
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise ExportError(f"source is not UTF-8: {relative}") from exc

    try:
        if kind == "jsonl":
            rows = [json.loads(line) for line in text.splitlines() if line.strip()]
            entry["record_count"] = len(rows)
            return rows
        value = json.loads(text)
    except json.JSONDecodeError as exc:
        raise ExportError(
            f"invalid {kind} source {relative}: line {exc.lineno}, column {exc.colno}"
        ) from exc
    entry["record_count"] = len(value) if isinstance(value, list) else 1
    return value


def _party_ids(party: Any) -> list[str]:
    if not isinstance(party, dict):
        return []
    result: list[str] = []
    for key in ("investigator_ids", "active_investigator_ids", "investigators", "members"):
        values = party.get(key)
        if not isinstance(values, list):
            continue
        for value in values:
            if isinstance(value, str):
                investigator_id = value
            elif isinstance(value, dict):
                investigator_id = value.get("investigator_id") or value.get("id")
            else:
                investigator_id = None
            normalized = str(investigator_id) if investigator_id is not None else None
            if normalized and normalized not in result:
                result.append(normalized)
    return result


def _campaign_relative(run_dir: Path, metadata: Any) -> str | None:
    campaign_id = metadata.get("campaign_id") if isinstance(metadata, dict) else None
    prefixes = ("sandbox/.coc/campaigns", ".coc/campaigns")
    for prefix in prefixes:
        if campaign_id:
            relative = f"{prefix}/{campaign_id}"
            candidate = _safe_source_path(run_dir, relative)
            if candidate.is_dir() and not candidate.is_symlink():
                return relative
        campaigns = run_dir / Path(prefix)
        if not campaigns.is_dir() or campaigns.is_symlink():
            continue
        choices = sorted(
            path for path in campaigns.iterdir() if path.is_dir() and not path.is_symlink()
        )
        if len(choices) == 1:
            return choices[0].relative_to(run_dir).as_posix()
    return None


def _is_dialogue_row(row: Any) -> bool:
    return (
        isinstance(row, dict)
        and isinstance(row.get("role"), str)
        and row["role"].casefold() in DIALOGUE_ROLES
        and isinstance(row.get("text"), str)
    )


def _dialogue_side(row: Any) -> str | None:
    if not _is_dialogue_row(row) or not row["text"].strip():
        return None
    return "keeper" if row["role"].casefold() in KEEPER_ROLES else "player"


def _card_status(value: Any) -> str:
    if value is None:
        return "MISSING"
    if not isinstance(value, dict) or not value:
        return "INVALID"
    return "PRESENT"


def _roll_visibility(row: Any) -> str:
    if not isinstance(row, dict):
        return "unknown"
    payload = row.get("payload")
    for source in (row, payload if isinstance(payload, dict) else {}):
        if source.get("superseded") is True or source.get("voided") is True:
            return "superseded"
        if source.get("player_facing") is False:
            return "superseded"
        value = source.get("visibility")
        if isinstance(value, str):
            return value
    return "public" if row.get("secret") is not True else "keeper_only"


def _roll_id(row: Any) -> str | None:
    if not isinstance(row, dict):
        return None
    payload = row.get("payload")
    for source in (row, payload if isinstance(payload, dict) else {}):
        value = source.get("roll_id")
        if isinstance(value, str) and value.strip():
            return value
    return None


def _roll_skill(row: Any) -> str | None:
    if not isinstance(row, dict):
        return None
    payload = row.get("payload")
    for source in (row, payload if isinstance(payload, dict) else {}):
        value = source.get("skill")
        if isinstance(value, str) and value.strip():
            return value
    return None


def _clue_graph_rows(clue_graph: Any) -> list[dict[str, Any]]:
    """Structured clue rows only; clue content is never projected into outputs."""
    if not isinstance(clue_graph, dict):
        return []
    rows: list[dict[str, Any]] = []
    conclusions = clue_graph.get("conclusions")
    for conclusion in conclusions if isinstance(conclusions, list) else []:
        if not isinstance(conclusion, dict):
            continue
        clues = conclusion.get("clues")
        for clue in clues if isinstance(clues, list) else []:
            if isinstance(clue, dict) and isinstance(clue.get("clue_id"), str):
                rows.append(clue)
    return rows


def _is_numeric(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _has_numeric_roll(row: Any) -> bool:
    if not isinstance(row, dict):
        return False
    payload = row.get("payload")
    if isinstance(payload, dict):
        dice = payload.get("dice")
        if isinstance(dice, dict) and _is_numeric(dice.get("total")):
            return True
    for source in (row, payload if isinstance(payload, dict) else {}):
        for key in ("roll", "rolls", "total", "result", "value"):
            value = source.get(key)
            if _is_numeric(value):
                return True
            if isinstance(value, list) and value and all(
                _is_numeric(item) for item in value
            ):
                return True
    return False


def _hidden_key(key: Any) -> bool:
    normalized = str(key).casefold()
    return (
        normalized in MARKDOWN_HIDDEN_KEYS
        or normalized.startswith(("keeper_", "private_", "hidden_", "secret_"))
        or normalized.endswith("_secret")
    )


def _player_safe(value: Any) -> Any:
    if isinstance(value, dict):
        if value.get("secret") is True or value.get("visibility") == "keeper_only":
            return {"redacted": True}
        return {
            str(key): _player_safe(child)
            for key, child in value.items()
            if not _hidden_key(key)
        }
    if isinstance(value, list):
        return [_player_safe(item) for item in value]
    return value


def _pick(mapping: Any, keys: tuple[str, ...]) -> dict[str, Any]:
    """Explicit allowlist projection; unlike _player_safe this defines a source contract."""
    if not isinstance(mapping, dict):
        return {}
    return {key: mapping[key] for key in keys if key in mapping}


def _occupation_provenance_projection(value: Any) -> dict[str, Any] | None:
    if not isinstance(value, dict):
        return None
    projected = _pick(
        value,
        ("name", "reason", "era_adaptive", "skill_point_formula", "formula_reason"),
    )
    return projected or None


def _skill_provenance_projection(value: Any) -> dict[str, dict[str, Any]] | None:
    if not isinstance(value, dict):
        return None
    projected: dict[str, dict[str, Any]] = {}
    for skill_id, entry in value.items():
        if not isinstance(skill_id, str) or not isinstance(entry, dict):
            continue
        safe_entry = _pick(
            entry,
            ("original_name", "reskinned_name", "era_adaptive", "custom"),
        )
        if safe_entry:
            projected[skill_id] = safe_entry
    return projected or None


def _skill_budget_provenance_projection(value: Any) -> dict[str, dict[str, Any]] | None:
    if not isinstance(value, dict):
        return None
    projected: dict[str, dict[str, Any]] = {}
    for account_name in ("occupation_points", "personal_interest_points"):
        account = value.get(account_name)
        if not isinstance(account, dict):
            continue
        safe_account = _pick(account, ("budget", "spent", "allocations"))
        allocations = safe_account.get("allocations")
        if isinstance(allocations, dict):
            safe_account["allocations"] = {
                skill_id: points
                for skill_id, points in allocations.items()
                if isinstance(skill_id, str) and _is_numeric(points)
            }
        if safe_account:
            projected[account_name] = safe_account
    return projected or None


def _creation_projection(creation: Any) -> dict[str, Any] | None:
    if not isinstance(creation, dict):
        return None
    projected = _pick(
        creation,
        ("input_mode", "method", "status", "age", "era", "era_adaptive", "kp_guided"),
    )
    occupation = _occupation_provenance_projection(creation.get("occupation"))
    if occupation is not None:
        projected["occupation"] = occupation
    skill_budget = _skill_budget_provenance_projection(creation.get("skill_budget"))
    if skill_budget is not None:
        projected["skill_budget"] = skill_budget
    return projected


def _character_projection(character: Any, creation: Any) -> dict[str, Any] | None:
    if not isinstance(character, dict):
        return None
    projected = _pick(character, (
        "id", "name", "display_name", "occupation", "profession", "era", "age",
        "era_adaptive", "kp_guided", "sex", "residence", "birthplace",
        "characteristics", "derived", "skills", "weapons", "equipment",
        "backstory", "credit_rating", "cash", "player_facing_sheet_zh",
    ))
    occupation = _occupation_provenance_projection(character.get("occupation"))
    if occupation is not None:
        projected["occupation"] = occupation
    skill_provenance = _skill_provenance_projection(character.get("skill_provenance"))
    if skill_provenance is not None:
        projected["skill_provenance"] = skill_provenance
    creation_projection = _creation_projection(creation)
    if creation_projection is not None:
        projected["creation"] = creation_projection
    snapshot = character.get("initial_skills_snapshot")
    if isinstance(snapshot, dict) and snapshot:
        projected["initial_skills"] = {
            str(key): value for key, value in snapshot.items()
        }
    sheet = character.get("player_facing_sheet_zh")
    if isinstance(sheet, dict):
        projected["nationality"] = sheet.get("nationality")
        initial_skills = {}
        skill_rows = []
        for row in sheet.get("skills", []) if isinstance(sheet.get("skills"), list) else []:
            if isinstance(row, dict) and isinstance(row.get("key"), str) and _is_numeric(row.get("value")):
                initial_skills[row["key"]] = row["value"]
                skill_rows.append(_pick(row, ("key", "label", "value", "half", "fifth")))
        if initial_skills:
            if "initial_skills" not in projected:
                projected["initial_skills"] = initial_skills
            projected["initial_skill_rows"] = skill_rows
    if "initial_skills" in projected:
        projected["skills"] = projected["initial_skills"]
    else:
        # Never substitute the live mutated skills map for creation-initial
        # values; omit the block and say so in the evidence.
        projected["initial_skills_validation"] = (
            "initial skills omitted: character.json carries no creation-frozen "
            "initial_skills_snapshot and no player_facing_sheet_zh; the live "
            "mutated skills map is not an initial-values source"
        )
    return projected


def _state_projection(state: Any) -> dict[str, Any] | None:
    if not isinstance(state, dict):
        return None
    projected = _pick(state, (
        "investigator_id", "name", "display_name", "current_hp", "current_san",
        "current_mp", "current_luck", "hp", "san", "mp", "luck", "conditions",
        "indefinite_insane", "temporary_insane", "permanently_insane", "bout_active",
        "phobia", "mania",
    ))
    hooks = state.get("personal_horror_hooks")
    if isinstance(hooks, list):
        projected["personal_horror_hooks"] = [
            _pick(hook, ("hook_id", "backstory_field", "summary", "woven", "payoff", "payoff_summary"))
            for hook in hooks if isinstance(hook, dict)
        ]
    return projected


def _progression_projection(world: Any, flags: Any) -> dict[str, Any]:
    world = world if isinstance(world, dict) else {}
    flags = flags if isinstance(flags, dict) else {}
    found = flags.get("clues_found") if isinstance(flags.get("clues_found"), dict) else {}
    discovered = world.get("discovered_clue_ids") if isinstance(world.get("discovered_clue_ids"), list) else list(found)
    clues = []
    for clue_id in discovered:
        if not isinstance(clue_id, str):
            continue
        receipt = found.get(clue_id) if isinstance(found.get(clue_id), dict) else {}
        clues.append({"clue_id": clue_id, **_pick(receipt, ("method", "ts"))})
    history = []
    for row in world.get("scene_history", []) if isinstance(world.get("scene_history"), list) else []:
        if isinstance(row, dict):
            history.append(_pick(row, ("scene_id", "decision_id", "entered_at_decision_id", "ts")))
    visited = [item for item in world.get("visited_scene_ids", []) if isinstance(item, str)] if isinstance(world.get("visited_scene_ids"), list) else []
    return {
        "visited_scene_ids": visited,
        "visited_scene_count": len(visited),
        "scene_history": history,
        "discovered_clues": clues,
        "major_decisions": [
            _pick(row, ("decision_id", "scene_id", "summary", "choice", "consequence", "ts"))
            for row in world.get("major_decisions", [])
            if isinstance(row, dict)
        ] if isinstance(world.get("major_decisions"), list) else [],
    }


def _npc_projection(receipts: Any) -> list[dict[str, Any]]:
    """Never project identity_contract: it is keeper-only even when it contains a name."""
    source = receipts.get("receipts") if isinstance(receipts, dict) else None
    if not isinstance(source, dict):
        return []
    result = []
    for receipt in source.values():
        if not isinstance(receipt, dict):
            continue
        event = receipt.get("event") if isinstance(receipt.get("event"), dict) else {}
        row = _pick(event, ("event_id", "decision_id", "npc_id", "scene_id", "interaction_kind", "ts"))
        if row:
            result.append(row)
    return result


def _first_impression_projection(
    document: Any, npc_receipts: Any,
) -> list[dict[str, Any]]:
    """Player-safe frozen first impressions plus their first-contact realization."""
    source = document.get("receipts") if isinstance(document, dict) else None
    engagement_source = (
        npc_receipts.get("receipts") if isinstance(npc_receipts, dict) else None
    )
    contexts: dict[str, dict[str, Any]] = {}
    for engagement in (
        engagement_source.values() if isinstance(engagement_source, dict) else []
    ):
        event = engagement.get("event") if isinstance(engagement, dict) else None
        effect = event.get("context_effect") if isinstance(event, dict) else None
        ref = event.get("first_impression_ref") if isinstance(event, dict) else None
        if isinstance(ref, str) and isinstance(effect, dict):
            contexts[ref] = effect
    projected: list[dict[str, Any]] = []
    for receipt in source.values() if isinstance(source, dict) else []:
        if not isinstance(receipt, dict):
            continue
        row = _pick(receipt, (
            "schema_version", "receipt_id", "investigator_id", "npc_id",
            "npc_display_name", "app",
            "credit_rating", "governing_attribute", "governing_value", "roll_id",
            "required_level", "achieved_level", "outcome", "passed",
            "reaction_tier", "rule_ref",
        ))
        roll_record = receipt.get("roll_record")
        if isinstance(roll_record, dict) and _is_numeric(roll_record.get("roll")):
            row["roll"] = roll_record["roll"]
        context = contexts.get(str(receipt.get("receipt_id") or ""))
        if isinstance(context, dict):
            # The report is player-safe. Full realization remains in NPC state;
            # only behavior already observable at the table is projected here.
            row["realization"] = _pick(context, ("observable_manner",))
        elif receipt.get("schema_version") == 1:
            # Preserve old campaign evidence without exposing its concealed die.
            row["legacy_contract"] = True
            row["realization"] = {
                "observable_manner": receipt.get("observable_manner"),
            }
        projected.append(row)
    return sorted(
        projected,
        key=lambda row: (
            str(row.get("investigator_id") or ""),
            str(row.get("npc_id") or ""),
        ),
    )


# Player-facing social skills (Psychology is a Keeper-concealed roll and is
# never listed). The view is a focused subset of the public-roll appendix.
SOCIAL_SKILLS = ("Charm", "Fast Talk", "Intimidate", "Persuade")


def _social_roll_projection(public_rolls: Any) -> list[dict[str, Any]]:
    """Focused player-safe view of public social-skill rolls, in log order."""
    if not isinstance(public_rolls, list):
        return []
    result = []
    for row in public_rolls:
        if not isinstance(row, dict):
            continue
        skill = _roll_skill(row)
        if skill not in SOCIAL_SKILLS:
            continue
        payload = row.get("payload") if isinstance(row.get("payload"), dict) else {}
        result.append({
            "roll_id": _roll_id(row),
            "skill": skill,
            "actor": _first_not_none(
                _first(row, ("actor", "investigator_id")),
                _first(payload, ("actor", "investigator_id")),
            ),
            "target": _first_not_none(
                _first(payload, ("effective_target", "target")),
                _first(row, ("effective_target", "target")),
            ),
            "roll": _first_not_none(
                _first(payload, ("roll", "total", "result", "value")),
                _first(row, ("roll", "total", "result", "value")),
            ),
            "outcome": _first_not_none(
                _first(payload, ("outcome", "success_level")),
                _first(row, ("outcome", "success_level")),
            ),
            "ts": row.get("ts"),
        })
    return result


def _ending_projection(events: Any) -> dict[str, Any] | None:
    if not isinstance(events, list):
        return None
    endings = [row for row in events if isinstance(row, dict) and row.get("event_type") == "session_ending"]
    if not endings:
        return None
    return _pick(endings[-1], ("ending_id", "scene_id", "kind", "summary", "decision_id", "investigator_ids", "ts", "settlement_capsule_ref"))


def _consequence_projection(events: Any, investigator_ids: list[str]) -> list[dict[str, Any]]:
    if not isinstance(events, list):
        return []
    allowed_types = {"hp_change", "sanity_loss", "combat_ended"}
    result = []
    for row in events:
        if not isinstance(row, dict) or row.get("event_type") not in allowed_types:
            continue
        if (
            row.get("superseded") is True
            or row.get("player_facing") is False
            or str(row.get("visibility") or "").casefold() in HIDDEN_PUBLIC_VISIBILITIES
            or row.get("superseded_correction") is True
        ):
            continue
        investigator_id = row.get("investigator_id")
        if investigator_id is not None and investigator_id not in investigator_ids:
            continue
        result.append(_pick(row, (
            "event_type", "investigator_id", "kind", "amount", "loss", "hp_before",
            "hp_after", "combat_id", "outcome", "ended_at_turn", "decision_id", "ts",
        )))
    return result


def _exceptional_effect_projection(document: Any) -> list[dict[str, Any]]:
    """Player-safe exceptional state; source rolls stay in keeper audit evidence."""
    effects = document.get("effects") if isinstance(document, dict) else None
    if not isinstance(effects, dict):
        return []
    projected = []
    for effect in effects.values():
        if not isinstance(effect, dict) or effect.get("visibility") == "keeper_only":
            continue
        row = _pick(effect, (
            "effect_id", "direction", "effect_kind", "player_visible_impact",
            "causal_link", "boundary", "mechanics", "visibility", "status",
            "created_at", "consumed_at", "consumed_by_roll_id",
        ))
        source_roll = effect.get("source_roll")
        if (
            isinstance(source_roll, dict)
            and source_roll.get("visibility") in PUBLIC_VISIBILITIES
            and isinstance(source_roll.get("roll_id"), str)
        ):
            row["source_roll_id"] = source_roll["roll_id"]
        projected.append(row)
    return sorted(projected, key=lambda row: str(row.get("effect_id") or ""))


def _settlement_projection(value: Any) -> dict[str, Any] | None:
    if not isinstance(value, dict):
        return None
    receipt = value.get("receipt") if isinstance(value.get("receipt"), dict) else {}
    result = receipt.get("result") if isinstance(receipt.get("result"), dict) else {}
    player_facing = (
        receipt.get("player_facing_mechanics")
        if isinstance(receipt.get("player_facing_mechanics"), dict)
        else result.get("player_facing_mechanics")
    )
    projected = {
        **_pick(value, ("ending_id", "investigator_id", "settled_at")),
        "status": receipt.get("status"),
        "improvement_checks": [
            _pick(row, ("skill", "check_roll", "gain", "value_before", "value_after", "improved", "applied_delta"))
            for row in result.get("improvement_checks", []) if isinstance(row, dict)
        ] if isinstance(result.get("improvement_checks"), list) else [],
        "luck_recovery": _pick(result.get("luck_recovery"), ("roll", "success", "gained", "luck_before", "luck_after")),
        "san_reward": _pick(result.get("scenario_san_reward") or result.get("san_reward"), ("expression", "rolls", "total", "san_before", "san_gained", "san_after")),
    }
    boundary = result.get("settlement_boundary")
    if isinstance(boundary, dict):
        projected["settlement_boundary"] = _pick(
            boundary, ("boundary_id", "session_ids", "settlement_types")
        )
    if isinstance(player_facing, dict):
        projected["player_facing_mechanics"] = _pick(
            player_facing,
            (
                "required_roll_ids", "rendered_lines", "rendered_text",
                "complete", "missing_roll_ids", "operation_id",
            ),
        )
    return projected


def _boundary_ledger_settlements(
    run_dir: Path,
    campaign_relative: str,
    ledger: Any,
    seen_refs: set[str],
    manifest: dict[str, dict[str, Any]],
) -> list[dict[str, Any]] | None:
    """Project canonical per-boundary settlement receipts from the ledger."""
    if not isinstance(ledger, dict):
        return None
    boundaries = ledger.get("boundaries")
    if not isinstance(boundaries, list) or not boundaries:
        return None
    settlements: list[dict[str, Any]] = []
    for entry in boundaries:
        if not isinstance(entry, dict):
            continue
        ref = entry.get("receipt_ref")
        if not isinstance(ref, str) or not ref or ref in seen_refs:
            continue
        seen_refs.add(ref)
        settlement = _read_source(
            run_dir, f"{campaign_relative}/{ref}", "json", manifest
        )
        projected = _settlement_projection(settlement)
        if projected is None:
            continue
        if isinstance(entry.get("boundary_id"), str):
            projected["boundary_id"] = entry["boundary_id"]
        types = entry.get("settlement_types")
        if isinstance(types, dict):
            projected["settlement_types"] = sorted(
                key for key in types if isinstance(key, str)
            )
        settlements.append(projected)
    return settlements


def _historical_ending_settlements(
    run_dir: Path,
    campaign_relative: str,
    investigator_id: str,
    seen_refs: set[str],
    manifest: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    """Project every persisted ending receipt for pre-ledger runs.

    Historical runs predate the boundary ledger; covering every ending's
    receipt keeps the canonical settlement visible instead of only the last
    ending's.
    """
    root_relative = f"{campaign_relative}/save/development-settlements/endings"
    root = _safe_source_path(run_dir, root_relative)
    if not root.is_dir() or root.is_symlink():
        return []
    settlements: list[dict[str, Any]] = []
    for ending_dir in sorted(root.iterdir(), key=lambda path: path.name):
        if ending_dir.is_symlink() or not ending_dir.is_dir():
            continue
        relative = f"{root_relative}/{ending_dir.name}/{investigator_id}.json"
        if relative in seen_refs:
            continue
        seen_refs.add(relative)
        settlement = _read_source(run_dir, relative, "json", manifest)
        projected = _settlement_projection(settlement)
        if projected is not None:
            settlements.append(projected)
    return settlements


def _source_payload(run_dir: Path, *, allow_partial: bool) -> dict[str, Any]:
    manifest: dict[str, dict[str, Any]] = {}
    metadata_source = METADATA_CANDIDATES[0]
    raw_metadata = None
    for relative in METADATA_CANDIDATES:
        if _safe_source_path(run_dir, relative).exists():
            metadata_source = relative
            raw_metadata = _read_source(run_dir, relative, "json", manifest, required=True)
            break
    if raw_metadata is None:
        raw_metadata = _read_source(run_dir, metadata_source, "json", manifest)
    metadata = _safe_metadata(raw_metadata)

    campaign_relative = _campaign_relative(run_dir, raw_metadata)

    if not metadata and campaign_relative:
        campaign_json_relative = f"{campaign_relative}/campaign.json"
        campaign_json = _read_source(run_dir, campaign_json_relative, "json", manifest)
        if isinstance(campaign_json, dict):
            metadata_source = campaign_json_relative
            raw_metadata = campaign_json
            metadata = _safe_metadata(campaign_json)

    canonical_identity, run_identity_findings, identity_evidence = (
        _resolve_canonical_run_identity(run_dir, campaign_relative, metadata)
    )
    _apply_authoritative_identity(
        metadata,
        canonical_identity,
        canonical_present=identity_evidence["canonical_present"],
    )

    final_path = run_dir / "transcript.jsonl"
    partial_path = run_dir / "partial-transcript.jsonl"
    canonical_transcript_relative = (
        f"{campaign_relative}/logs/table-transcript.jsonl"
        if campaign_relative else None
    )
    canonical_transcript_path = (
        _safe_source_path(run_dir, canonical_transcript_relative)
        if canonical_transcript_relative else None
    )
    transcript_origin = "legacy"
    if canonical_transcript_path is not None and canonical_transcript_path.exists():
        transcript_relative = canonical_transcript_relative
        transcript_candidate_present = True
        transcript_origin = "canonical"
    elif final_path.exists():
        transcript_relative = "transcript.jsonl"
        transcript_candidate_present = True
    elif partial_path.exists():
        if not allow_partial:
            raise ExportError(
                "only partial-transcript.jsonl exists; rerun with --allow-partial to export it as INCOMPLETE"
            )
        transcript_relative = "partial-transcript.jsonl"
        transcript_candidate_present = False
    else:
        transcript_relative = "transcript.jsonl"
        transcript_candidate_present = False
    transcript = _read_source(
        run_dir, transcript_relative, "jsonl", manifest,
        required=bool(
            (canonical_transcript_path is not None and canonical_transcript_path.exists())
            or final_path.exists()
            or partial_path.exists()
        ),
    ) or []
    if transcript_origin == "canonical" and identity_evidence["canonical_present"]:
        transcript = [
            row for row in transcript
            if isinstance(row, dict)
            and row.get("run_segment_id") == metadata.get("run_segment_id")
            and row.get("session_id") == metadata.get("session_id")
        ]
        manifest[transcript_relative]["included_record_count"] = len(transcript)
        manifest[transcript_relative]["projection"] = "current_run_exact_table_text"
    elif transcript_origin == "canonical":
        manifest[transcript_relative]["included_record_count"] = len(transcript)
        manifest[transcript_relative]["projection"] = "unbound_canonical_table_text"
    dialogue = []
    for source_line, row in enumerate(transcript, start=1):
        if not _is_dialogue_row(row):
            continue
        projected = {"source_line": source_line, "role": row["role"], "text": row["text"]}
        for key in ("turn", "speaker", "speaker_display", "text_display"):
            if isinstance(row.get(key), (str, int, float)):
                projected[key] = row[key]
        dialogue.append(projected)

    party = _read_source(run_dir, f"{campaign_relative}/party.json", "json", manifest) if campaign_relative else None
    investigator_ids = _party_ids(party)
    # When the campaign's party roster exists it is the complete membership:
    # never widen it by scanning shared investigator pools (repo-root runs keep
    # every campaign's investigators under .coc/investigators/, and pulling
    # them in fabricates "missing final state" failures for strangers).
    # Root scanning remains the fallback for legacy runs without party.json.
    if not investigator_ids:
        roots = [run_dir / "sandbox" / ".coc" / "investigators", run_dir / ".coc" / "investigators"]
        if campaign_relative:
            roots.insert(0, run_dir / campaign_relative / "save" / "investigator-state")
            roots.insert(1, run_dir / campaign_relative / "investigators")
        for root in roots:
            if not root.is_dir() or root.is_symlink():
                continue
            for path in sorted(root.iterdir()):
                candidate = path.stem if path.is_file() and path.suffix == ".json" else path.name
                if (path.is_file() or path.is_dir()) and not path.is_symlink() and candidate not in investigator_ids:
                    investigator_ids.append(candidate)

    investigators: list[dict[str, Any]] = []
    creation_receipt_records: list[Any] = []
    for investigator_id in investigator_ids:
        character = creation = None
        character_bases = [
            f"sandbox/.coc/investigators/{investigator_id}",
            f".coc/investigators/{investigator_id}",
        ]
        if campaign_relative:
            character_bases.insert(1, f"{campaign_relative}/investigators/{investigator_id}")
        for base in character_bases:
            if character is None:
                character = _read_source(run_dir, f"{base}/character.json", "json", manifest)
            if creation is None:
                creation = _read_source(run_dir, f"{base}/creation.json", "json", manifest)
            if character is not None:
                break
        state = _read_source(
            run_dir, f"{campaign_relative}/save/investigator-state/{investigator_id}.json",
            "json", manifest,
        ) if campaign_relative else None
        creation_receipt_records.append(creation)
        investigators.append(
            {
                "investigator_id": investigator_id,
                "character": _character_projection(character, creation),
                "creation": _creation_projection(creation),
                "state": _state_projection(state),
                "source_status": {
                    "character": _card_status(character),
                    "creation": _card_status(creation),
                    "state": _card_status(state),
                },
            }
        )

    world = flags = npc_receipts = events = clue_graph = exceptional_document = None
    first_impression_document = None
    toolbox_calls: list[dict[str, Any]] | None = None
    turn_finalizations: list[dict[str, Any]] | None = None
    advisory_adoptions: list[dict[str, Any]] | None = None
    social_document = psychology_document = None
    narration_reviews_doc: list[dict[str, Any]] | None = None
    narration_repairs_doc: list[dict[str, Any]] | None = None
    progression: dict[str, Any] = {"visited_scene_ids": [], "scene_history": [], "discovered_clues": [], "major_decisions": []}
    npc_interactions: list[dict[str, Any]] = []
    ending = None
    visible_consequences: list[dict[str, Any]] = []
    settlements: list[dict[str, Any]] = []
    if campaign_relative:
        world = _read_source(run_dir, f"{campaign_relative}/save/world-state.json", "json", manifest)
        flags = _read_source(run_dir, f"{campaign_relative}/save/flags.json", "json", manifest)
        npc_receipts = _read_source(run_dir, f"{campaign_relative}/save/npc-engagement-receipts.json", "json", manifest)
        first_impression_document = _read_source(
            run_dir,
            f"{campaign_relative}/save/npc-first-impressions.json",
            "json",
            manifest,
        )
        events = _read_source(run_dir, f"{campaign_relative}/logs/events.jsonl", "jsonl", manifest)
        clue_graph_relative = f"{campaign_relative}/scenario/clue-graph.json"
        clue_graph = _read_source(run_dir, clue_graph_relative, "json", manifest)
        if clue_graph is not None:
            manifest[clue_graph_relative]["projection"] = "structured_delivery_kind_counts_only_no_clue_content"
        toolbox_calls = _read_source(
            run_dir,
            f"{campaign_relative}/logs/toolbox-calls.jsonl",
            "jsonl",
            manifest,
        )
        turn_finalizations = _read_source(
            run_dir,
            f"{campaign_relative}/logs/turn-finalizations.jsonl",
            "jsonl",
            manifest,
        )
        advisory_adoptions = _read_source(
            run_dir,
            f"{campaign_relative}/logs/advisory-adoptions.jsonl",
            "jsonl",
            manifest,
        )
        social_document = _read_source(
            run_dir,
            f"{campaign_relative}/save/social-resolutions.json",
            "json",
            manifest,
        )
        psychology_document = _read_source(
            run_dir,
            f"{campaign_relative}/save/psychology-observations.json",
            "json",
            manifest,
        )
        narration_reviews_doc = _read_source(
            run_dir,
            f"{campaign_relative}/logs/narration-reviews.jsonl",
            "jsonl",
            manifest,
        )
        narration_repairs_doc = _read_source(
            run_dir,
            f"{campaign_relative}/logs/undelivered-output-repairs.jsonl",
            "jsonl",
            manifest,
        )
        exceptional_document = _read_source(
            run_dir,
            f"{campaign_relative}/save/exceptional-effects.json",
            "json",
            manifest,
        )
        progression = _progression_projection(world, flags)
        npc_interactions = _npc_projection(npc_receipts)
        ending = _ending_projection(events)
        visible_consequences = _consequence_projection(events, investigator_ids)
        seen_settlement_refs: set[str] = set()
        for investigator_id in investigator_ids:
            ledger_relative = (
                f"{campaign_relative}/save/development-settlements/"
                f"boundaries/{investigator_id}.json"
            )
            ledger = _read_source(run_dir, ledger_relative, "json", manifest)
            canonical = _boundary_ledger_settlements(
                run_dir, campaign_relative, ledger, seen_settlement_refs, manifest
            )
            if canonical is not None:
                settlements.extend(canonical)
                continue
            settlements.extend(
                _historical_ending_settlements(
                    run_dir,
                    campaign_relative,
                    investigator_id,
                    seen_settlement_refs,
                    manifest,
                )
            )

    finalization_contract = _turn_finalization()
    valid_finalizations = [
        row for row in (turn_finalizations or [])
        if finalization_contract._valid_finalization(row)
    ]
    invalid_finalization_rows = [
        index for index, row in enumerate(turn_finalizations or [], start=1)
        if not finalization_contract._valid_finalization(row)
    ]

    public_rolls: list[dict[str, Any]] = []
    all_rolls = None
    rolls_relative = None
    roll_dispositions: dict[str, Any] = {}
    malformed_lines: list[int] = []
    bound_roll_ids: set[str] = set()
    creation_bound_roll_ids: set[str] = set()
    zero_roll_receipt_ids: list[str] = []
    undispositioned_orphans: list[dict[str, Any]] = []
    dispositioned_orphan_ids: list[str] = []
    if campaign_relative:
        turn_finalization = finalization_contract
        superseded_visibilities = {
            str(value).casefold()
            for value in turn_finalization.SUPERSEDED_ROLL_VISIBILITIES
        }
        # Finalization receipts bind ordinary played-turn rolls: rolls.jsonl
        # rows carry no turn identity by design, and receipt validation already
        # enforces seen_sources == expected_sources. A receipt with an empty
        # source_roll_ids is the zero-roll attestation for its turn.
        for row in valid_finalizations:
            if not isinstance(row, dict):
                continue
            receipt_roll_ids = [
                value.strip()
                for value in row.get("source_roll_ids") or []
                if isinstance(value, str) and value.strip()
            ]
            if receipt_roll_ids:
                bound_roll_ids.update(receipt_roll_ids)
            elif row.get("finalization_id"):
                zero_roll_receipt_ids.append(str(row["finalization_id"]))
        # Creation, table-opening, and development receipts bind rolls outside
        # ordinary turns. Creation references were verified by
        # investigator.create; the other receipt types carry their roll ids
        # explicitly.
        creation_bound_roll_ids = turn_finalization.creation_receipt_bound_roll_ids(
            Path(campaign_relative).name,
            creation_receipt_records,
        )
        bound_roll_ids.update(creation_bound_roll_ids)
        for call in toolbox_calls or []:
            if not isinstance(call, dict) or call.get("ok") is not True:
                continue
            if call.get("tool") != "evidence.table_opening":
                continue
            for value in ((call.get("args") or {}).get("presented_roll_ids") or []):
                if isinstance(value, str) and value.strip():
                    bound_roll_ids.add(value.strip())
        endings_root_relative = f"{campaign_relative}/save/development-settlements/endings"
        endings_root = _safe_source_path(run_dir, endings_root_relative)
        if endings_root.is_dir() and not endings_root.is_symlink():
            for ending_dir in sorted(endings_root.iterdir()):
                if not ending_dir.is_dir() or ending_dir.is_symlink():
                    continue
                for receipt_path in sorted(ending_dir.glob("*.json")):
                    if receipt_path.is_symlink() or not receipt_path.is_file():
                        continue
                    settlement_doc = _read_source(
                        run_dir,
                        f"{endings_root_relative}/{ending_dir.name}/{receipt_path.name}",
                        "json",
                        manifest,
                    )
                    mechanics = (
                        ((settlement_doc or {}).get("receipt") or {}).get(
                            "player_facing_mechanics"
                        )
                        if isinstance(settlement_doc, dict)
                        else None
                    )
                    for value in (mechanics or {}).get("required_roll_ids") or []:
                        if isinstance(value, str) and value.strip():
                            bound_roll_ids.add(value.strip())
        rolls_relative = f"{campaign_relative}/logs/rolls.jsonl"
        all_rolls = _read_source(run_dir, rolls_relative, "jsonl", manifest)
        roll_dispositions_doc = _read_source(
            run_dir, f"{campaign_relative}/save/roll-dispositions.json", "json", manifest
        )
        roll_dispositions = (
            roll_dispositions_doc.get("dispositions")
            if isinstance(roll_dispositions_doc, dict)
            and isinstance(roll_dispositions_doc.get("dispositions"), dict)
            else {}
        )
        for source_line, row in enumerate(all_rolls or [], start=1):
            if _roll_visibility(row).casefold() not in PUBLIC_VISIBILITIES:
                if isinstance(row, dict):
                    roll_id = _roll_id(row)
                    visibility = _roll_visibility(row).casefold()
                    if (
                        roll_id is not None
                        and roll_id not in bound_roll_ids
                        and visibility in superseded_visibilities
                        and visibility != "keeper_only"
                    ):
                        # A would-be-public roll the write side later gave an
                        # explicit disposition (superseded/voided/abandoned):
                        # audit-listed only, never player-facing.
                        dispositioned_orphan_ids.append(roll_id)
                continue
            if not isinstance(row, dict):
                malformed_lines.append(source_line)
                continue
            if not turn_finalization.is_player_facing_roll(
                turn_finalization._flatten_roll(row)
            ):
                continue
            roll_id = _roll_id(row)
            if roll_id is None or not _has_numeric_roll(row):
                malformed_lines.append(source_line)
            if roll_id not in bound_roll_ids:
                if roll_id is not None and roll_id in roll_dispositions:
                    # Explicitly dispositioned (abandoned turn tail/correction):
                    # audit-listed only, never player-facing.
                    dispositioned_orphan_ids.append(roll_id)
                    continue
                # Fail loud: a player-facing roll bound to no canonical
                # receipt and carrying no abandonment disposition must never be
                # silently eaten nor silently rendered.
                undispositioned_orphans.append(
                    {"roll_id": roll_id, "source_line": source_line}
                )
                continue
            projected = _player_safe(row)
            assert isinstance(projected, dict)
            projected.pop("source_ref", None)
            projected.pop("source_path", None)
            public_rolls.append(projected)
        manifest[rolls_relative]["included_record_count"] = len(public_rolls)
        manifest[rolls_relative]["projection"] = "player_facing_and_bound_to_canonical_receipt"

    roll_ids = [_roll_id(row) for row in public_rolls]
    duplicate_roll_ids = sorted(
        roll_id for roll_id, count in Counter(roll_ids).items() if roll_id and count > 1
    )
    social_rolls = _social_roll_projection(public_rolls)

    role_counts = {
        "keeper": sum(_dialogue_side(row) == "keeper" for row in transcript),
        "player": sum(_dialogue_side(row) == "player" for row in transcript),
    }
    dimensions: dict[str, dict[str, Any]] = {}
    def dimension(
        name: str, passed: bool, *findings: str, status: str | None = None
    ) -> None:
        dimensions[name] = {
            "status": status or ("PASS" if passed else "FAIL"),
            "findings": list(findings),
        }

    dimension(
        "run_identity",
        not run_identity_findings,
        *(run_identity_findings or [
            "canonical campaign run identity bound the exact run segment, campaign, session, plugin, and ruleset"
        ]),
    )
    dimension("source_identity", bool(metadata) and campaign_relative is not None, "run metadata and campaign directory resolved" if metadata and campaign_relative else "run metadata or campaign directory is missing")
    transcript_findings: list[str] = []
    if not transcript_candidate_present:
        transcript_findings.append("final exact transcript source is missing")
    if role_counts["keeper"] == 0:
        transcript_findings.append("no non-empty Keeper/KP dialogue rows were found")
    if role_counts["player"] == 0:
        transcript_findings.append("no non-empty player dialogue rows were found")

    journal_decision_id_rows = [
        str((call.get("args") or {}).get("decision_id"))
        for call in toolbox_calls or []
        if isinstance(call, dict)
        and call.get("ok") is True
        and call.get("tool") == "state.journal"
        and (call.get("args") or {}).get("decision_id")
    ]
    journal_decision_ids = set(journal_decision_id_rows)
    finalization_ids = {
        str(row.get("finalization_id"))
        for row in valid_finalizations
        if isinstance(row, dict) and row.get("finalization_id")
    }
    if transcript_origin == "canonical":
        transcript_player_journal_rows = [
            str(row.get("journal_decision_id"))
            for row in transcript
            if isinstance(row, dict)
            and _dialogue_side(row) == "player"
            and row.get("journal_decision_id")
        ]
        transcript_player_journals = set(transcript_player_journal_rows)
        transcript_keeper_finalizations = {
            str(row.get("finalization_id"))
            for row in transcript
            if isinstance(row, dict)
            and _dialogue_side(row) == "keeper"
            and row.get("finalization_id")
        }
        missing_players = sorted(journal_decision_ids - transcript_player_journals)
        missing_keepers = sorted(finalization_ids - transcript_keeper_finalizations)
        orphan_players = sorted(transcript_player_journals - journal_decision_ids)
        orphan_keepers = sorted(transcript_keeper_finalizations - finalization_ids)
        duplicate_journals = sorted(
            value for value, count in Counter(journal_decision_id_rows).items()
            if count != 1
        )
        duplicate_player_rows = sorted(
            value for value, count in Counter(transcript_player_journal_rows).items()
            if count != 1
        )
        if duplicate_journals:
            transcript_findings.append(
                "state.journal decision ids are duplicated: " + ", ".join(duplicate_journals)
            )
        if duplicate_player_rows:
            transcript_findings.append(
                "accepted player rows duplicate journal bindings: " + ", ".join(duplicate_player_rows)
            )
        if missing_players:
            transcript_findings.append(
                f"exact player text is missing for {len(missing_players)} journaled turn(s)"
            )
        if missing_keepers:
            transcript_findings.append(
                f"finalized Keeper text is missing for {len(missing_keepers)} turn(s)"
            )
        if orphan_players or orphan_keepers:
            transcript_findings.append(
                "transcript contains rows that are not bound to canonical journal/finalization receipts"
            )
        for index, row in enumerate(
            [row for row in transcript if isinstance(row, dict) and _dialogue_side(row) == "player"],
            start=1,
        ):
            missing = [
                field for field in (
                    "run_segment_id", "session_id", "turn_id", "journal_decision_id"
                )
                if row.get(field) in (None, "")
            ]
            if missing:
                transcript_findings.append(
                    f"accepted player row {index} is NOT_PROVEN: missing " + ", ".join(missing)
                )
            elif (
                row.get("run_segment_id") != metadata.get("run_segment_id")
                or row.get("session_id") != metadata.get("session_id")
            ):
                transcript_findings.append(
                    f"accepted player row {index} is NOT_PROVEN: run/session identity mismatch"
                )
    else:
        transcript_findings.append(
            "legacy/unbound transcript is partial evidence only; formal completeness requires canonical table-transcript identity bindings"
        )
        if journal_decision_ids and role_counts["player"] < len(journal_decision_ids):
            transcript_findings.append(
                f"legacy transcript has {role_counts['player']} player row(s) for {len(journal_decision_ids)} journaled turn(s)"
            )
        if finalization_ids and role_counts["keeper"] < len(finalization_ids):
            transcript_findings.append(
                f"legacy transcript has {role_counts['keeper']} Keeper row(s) for {len(finalization_ids)} finalized turn(s)"
            )

    run_status = str(metadata.get("status") or "").casefold()
    if run_status in {"blocked", "in_progress", "running", "partial"}:
        transcript_findings.append(
            f"run status is {run_status}; transcript cannot be claimed final"
        )
    accepted_findings = list(transcript_findings)
    if invalid_finalization_rows:
        accepted_findings.append(
            "canonical finalization validation failed at source row(s): "
            + ", ".join(map(str, invalid_finalization_rows))
        )
    finalization_by_id = {
        str(row.get("finalization_id")): row
        for row in valid_finalizations
        if isinstance(row, dict) and isinstance(row.get("finalization_id"), str)
    }
    accepted_keeper_rows = [
        row for row in transcript
        if isinstance(row, dict) and _dialogue_side(row) == "keeper"
    ]
    authoritative_finalization_ids = [
        str(row.get("finalization_id"))
        for row in valid_finalizations
        if isinstance(row, dict) and isinstance(row.get("finalization_id"), str)
        and row.get("finalization_id")
    ]
    accepted_finalization_ids = [
        str(row.get("finalization_id"))
        for row in accepted_keeper_rows
        if isinstance(row.get("finalization_id"), str) and row.get("finalization_id")
    ]
    authoritative_counts = Counter(authoritative_finalization_ids)
    accepted_counts = Counter(accepted_finalization_ids)
    duplicate_authoritative = sorted(
        value for value, count in authoritative_counts.items() if count != 1
    )
    duplicate_accepted = sorted(
        value for value, count in accepted_counts.items() if count != 1
    )
    if duplicate_authoritative:
        accepted_findings.append(
            "authoritative finalization ids are duplicated: " + ", ".join(duplicate_authoritative)
        )
    if duplicate_accepted:
        accepted_findings.append(
            "accepted Keeper rows duplicate finalization bindings: " + ", ".join(duplicate_accepted)
        )
    missing_accepted = sorted(authoritative_counts.keys() - accepted_counts.keys())
    extra_accepted = sorted(accepted_counts.keys() - authoritative_counts.keys())
    if missing_accepted:
        accepted_findings.append(
            "authoritative finalizations missing accepted Keeper rows: " + ", ".join(missing_accepted)
        )
    if extra_accepted:
        accepted_findings.append(
            "accepted Keeper rows have no authoritative finalization: " + ", ".join(extra_accepted)
        )
    required_accepted_fields = (
        "run_segment_id", "session_id", "turn_id", "finalization_id",
        "accepted_revision", "rendered_text_sha256",
    )
    for index, row in enumerate(accepted_keeper_rows, start=1):
        absent = [
            field for field in required_accepted_fields
            if row.get(field) in (None, "")
        ]
        if absent:
            accepted_findings.append(
                f"accepted Keeper row {index} is NOT_PROVEN: missing " + ", ".join(absent)
            )
            continue
        if (
            row.get("run_segment_id") != metadata.get("run_segment_id")
            or row.get("session_id") != metadata.get("session_id")
        ):
            accepted_findings.append(
                f"accepted Keeper row {index} is NOT_PROVEN: run/session identity mismatch"
            )
            continue
        if isinstance(row.get("accepted_revision"), bool) or not isinstance(row.get("accepted_revision"), int) or row["accepted_revision"] < 1:
            accepted_findings.append(
                f"accepted Keeper row {index} is NOT_PROVEN: accepted_revision is invalid"
            )
            continue
        receipt = finalization_by_id.get(str(row.get("finalization_id")))
        if (
            not isinstance(receipt, dict)
            or receipt.get("schema_version") != 2
            or any(
                receipt.get(field) != row.get(field)
                for field in (
                    "run_segment_id", "session_id", "turn_id",
                    "finalization_id", "accepted_revision",
                )
            )
            or receipt.get("rendered_text_sha256") != row.get("rendered_text_sha256")
            or receipt.get("rendered_text") != row.get("text")
        ):
            accepted_findings.append(
                f"accepted Keeper row {index} is NOT_PROVEN: finalization revision/text/hash binding is absent or conflicting"
            )
            continue
        if transcript_origin == "canonical":
            player_sources = [
                player for player in transcript
                if isinstance(player, dict)
                and _dialogue_side(player) == "player"
                and player.get("turn_id") == receipt.get("turn_id")
                and player.get("journal_decision_id") == receipt.get("journal_decision_id")
            ]
            if len(player_sources) != 1:
                accepted_findings.append(
                    f"accepted Keeper row {index} is NOT_PROVEN: turn does not bind exactly one canonical player journal row"
                )
    transcript_complete = transcript_candidate_present and not accepted_findings
    dimension(
        "accepted_transcript",
        transcript_complete,
        *(accepted_findings or [
            "every accepted Keeper row binds run segment, session, turn, finalization, revision, and rendered-text hash"
        ]),
    )
    dice_ok = (
        all_rolls is not None
        and not malformed_lines
        and not duplicate_roll_ids
        and not undispositioned_orphans
        and not invalid_finalization_rows
    )
    dice_findings: list[str] = []
    if dice_ok:
        dice_findings.append(
            "structured public-roll evidence is traceable exactly once and every rendered roll is bound to a canonical receipt"
        )
    else:
        dice_findings.append("structured roll evidence is missing or invalid")
    if invalid_finalization_rows:
        dice_findings.append("roll binding references fail canonical finalization validation")
    if undispositioned_orphans:
        dice_findings.append(
            "public roll rows bound to no canonical receipt and carrying no abandonment disposition: "
            + ", ".join(
                f"{orphan['roll_id'] or 'MISSING_ROLL_ID'} (source line {orphan['source_line']})"
                for orphan in undispositioned_orphans
            )
        )
    dimension("dice", dice_ok, *dice_findings)
    character_ok = bool(investigators) and all(i["source_status"]["character"] == "PRESENT" and i["source_status"]["state"] == "PRESENT" for i in investigators)
    dimension("character_and_final_state", character_ok, "initial card and final dynamic state are present" if character_ok else "an investigator lacks an initial card or final state")
    authoritative_state_diffs = _state_diff_rows(toolbox_calls, valid_finalizations)
    malformed_visible_deltas: list[str] = []
    unbound_visible_deltas: list[str] = []
    registered_state_decisions = {
        str((call.get("args") or {}).get("decision_id"))
        for call in toolbox_calls or []
        if isinstance(call, dict)
        and call.get("ok") is True
        and str(call.get("tool") or "") in _registered_tool_names()
        and str(call.get("tool") or "").startswith("state.")
        and isinstance(call.get("args"), dict)
        and (call.get("args") or {}).get("decision_id")
    }
    for receipt in valid_finalizations:
        if not isinstance(receipt, dict):
            continue
        bundle = receipt.get("bundle") if isinstance(receipt.get("bundle"), dict) else {}
        for category in ("state_delta", "asset_delta"):
            for effect in bundle.get(category) or []:
                if not isinstance(effect, dict) or not _has_explicit_delta(effect):
                    malformed_visible_deltas.append(
                        f"{receipt.get('finalization_id') or 'unknown'}:{category}"
                    )
                elif str(effect.get("source_decision_id") or "") not in registered_state_decisions:
                    unbound_visible_deltas.append(
                        f"{receipt.get('finalization_id') or 'unknown'}:{category}"
                    )
    git_history_proof = _collect_git_state_proof(
        run_dir, campaign_relative, valid_finalizations
    )
    state_integrity = _bounded_state_integrity(git_history_proof)
    git_status = state_integrity["status"]
    state_findings: list[str] = []
    if not character_ok:
        state_findings.append("canonical final investigator state is missing")
    if invalid_finalization_rows:
        state_findings.append("one or more finalization rows fail the canonical receipt validator")
    if not valid_finalizations:
        state_findings.append("no canonically valid accepted finalization proves final state")
    if git_status != "PASS":
        reason_codes = state_integrity["reason_codes"]
        if reason_codes:
            state_findings.append(
                f"git state proof is {git_status}: " + ", ".join(reason_codes)
            )
        else:
            state_findings.append(f"git state proof is {git_status}")
    if malformed_visible_deltas:
        state_findings.append(
            "visible state effects lack typed before/after or delta evidence: "
            + ", ".join(sorted(malformed_visible_deltas))
        )
    if unbound_visible_deltas:
        state_findings.append(
            "typed state effects lack a successful registered canonical state operation: "
            + ", ".join(sorted(unbound_visible_deltas))
        )
    if invalid_finalization_rows or git_status == "FAIL":
        state_status = None
    elif state_findings:
        state_status = "NOT_PROVEN"
    else:
        state_status = None
    dimension(
        "state",
        not state_findings,
        *(state_findings or [
            "canonical final state is present and structured git history proof passed; "
            f"{len(authoritative_state_diffs)} genuine typed delta row(s) retained without an invented event fold"
        ]),
        status=state_status,
    )
    progression_ok = isinstance(world, dict) and isinstance(flags, dict) and bool(progression["visited_scene_ids"])
    dimension("progression", progression_ok, "visited scenes and discovered-clue receipts are projected" if progression_ok else "world progression sources or visited path are missing")
    ending_ok = ending is not None and len(settlements) >= len(investigator_ids) and bool(investigator_ids)
    dimension("ending_and_development", ending_ok, "structured ending and investigator settlements are present" if ending_ok else "structured ending or development settlement is missing")
    snapshot_findings: list[str] = []
    for inv in investigators:
        if not isinstance(inv, dict):
            continue
        character = inv.get("character") if isinstance(inv.get("character"), dict) else {}
        initial = character.get("initial_skills")
        if not isinstance(initial, dict):
            continue
        for settlement in settlements:
            if not isinstance(settlement, dict):
                continue
            if str(settlement.get("investigator_id") or "") != str(inv.get("investigator_id") or ""):
                continue
            for check in settlement.get("improvement_checks") or []:
                if not isinstance(check, dict) or not check.get("improved"):
                    continue
                skill = str(check.get("skill") or "")
                if (
                    skill in initial
                    and initial[skill] == check.get("value_after")
                    and initial[skill] != check.get("value_before")
                ):
                    snapshot_findings.append(
                        f"{inv.get('investigator_id')}: initial_skills['{skill}'] equals the post-improvement value ({check.get('value_after')}) — the live sheet leaked into the initial snapshot"
                    )
    dimension(
        "initial_final_snapshot_separation",
        not snapshot_findings,
        *(snapshot_findings or ["initial skill snapshot is creation-frozen, never the live final map"]),
    )
    boundary_ids: list[str] = []
    if campaign_relative:
        for inv_id in investigator_ids:
            boundary_ledger = _read_source(
                run_dir,
                f"{campaign_relative}/save/development-settlements/boundaries/{inv_id}.json",
                "json",
                manifest,
            )
            for row in (boundary_ledger or {}).get("boundaries") or []:
                if isinstance(row, dict) and row.get("boundary_id"):
                    boundary_ids.append(str(row["boundary_id"]))
    duplicate_boundaries = sorted({bid for bid in boundary_ids if boundary_ids.count(bid) > 1})
    boundary_findings = (
        ["duplicate settlement boundary ids: " + ", ".join(duplicate_boundaries)]
        if duplicate_boundaries
        else []
    )
    dimension(
        "settlement_uniqueness",
        not boundary_findings,
        *(boundary_findings or ["settlement boundaries are unique per session and investigator"]),
    )
    # Compatibility alias for older report consumers. The current contract is
    # settlement_uniqueness; this row carries the same evidence, not a second check.
    dimensions["settlement_session_uniqueness"] = dict(dimensions["settlement_uniqueness"])

    event_rows = [row for row in (events or []) if isinstance(row, dict)]
    promotion_candidates = [
        row for row in event_rows if row.get("event_type") == "scene_promotion"
    ]
    promotions = [row for row in promotion_candidates if _valid_scene_promotion(row)]
    unresolved_hard_drifts: list[str] = []
    for drift in event_rows:
        if (
            drift.get("event_type") != "scene_scope_drift"
            or drift.get("acceptance_severity") != "hard"
        ):
            continue
        drift_id = str(drift.get("event_id") or "").strip()
        scene_id = str(drift.get("scene_id") or "")
        resolved = any(
            str(promotion.get("scene_id") or "") == scene_id
            and drift_id
            and drift_id in {
                str(value) for value in promotion.get("source_event_ids") or []
            }
            and drift_id in {
                str(value)
                for value in promotion.get("resolved_drift_event_ids") or []
            }
            for promotion in promotions
        )
        if not resolved:
            unresolved_hard_drifts.append(drift_id or f"scene:{scene_id}:missing-event-id")
    malformed_improvised_unlocks: list[str] = []
    for event in event_rows:
        if event.get("event_type") != "clue_discovered":
            continue
        if (
            (event.get("provenance") == "improvised" or event.get("local_only") is True)
            and (
                event.get("can_unlock_authored_milestone") is not False
                or bool(event.get("newly_unlocked_scenes"))
            )
        ):
            malformed_improvised_unlocks.append(
                str(event.get("event_id") or event.get("clue_id") or "unknown")
            )
    for call in toolbox_calls or []:
        if (
            not isinstance(call, dict)
            or call.get("ok") is not True
            or call.get("tool") != "state.record_clue"
        ):
            continue
        data = call.get("data") if isinstance(call.get("data"), dict) else {}
        provenance = data.get("provenance") if isinstance(data.get("provenance"), dict) else {}
        if (
            (provenance.get("provenance") == "improvised" or provenance.get("local_only") is True)
            and (
                provenance.get("can_unlock_authored_milestone") is not False
                or bool(data.get("newly_unlocked_scenes"))
            )
        ):
            malformed_improvised_unlocks.append(
                str((call.get("args") or {}).get("decision_id") or data.get("clue_id") or "unknown")
            )
    scene_findings: list[str] = []
    malformed_promotions = len(promotion_candidates) - len(promotions)
    if malformed_promotions:
        scene_findings.append(
            f"{malformed_promotions} scene promotion row(s) fail the canonical evidence contract"
        )
    if unresolved_hard_drifts:
        scene_findings.append(
            "unpromoted hard scene-scope drift: " + ", ".join(sorted(unresolved_hard_drifts))
        )
    if malformed_improvised_unlocks:
        scene_findings.append(
            "improvised/local-only clue reports authored unlock authority: "
            + ", ".join(sorted(set(malformed_improvised_unlocks)))
        )
    dimension(
        "scene_scope",
        not scene_findings,
        *(scene_findings or ["no unpromoted hard drift or improvised authored-milestone unlock"]),
    )

    reviews_by_id: dict[str, list[dict[str, Any]]] = {}
    for row in narration_reviews_doc or []:
        if not isinstance(row, dict) or not isinstance(row.get("review_id"), str):
            continue
        reviews_by_id.setdefault(str(row["review_id"]), []).append(row)
    agency_findings: list[str] = []
    agency_not_proven: list[str] = []
    if invalid_finalization_rows:
        agency_findings.append(
            "one or more accepted-source rows fail canonical finalization validation"
        )
    if not valid_finalizations:
        agency_not_proven.append("no-valid-accepted-finalization")
    accepted_review_ids: set[str] = set()
    for receipt in valid_finalizations:
        if not isinstance(receipt, dict):
            continue
        finalization_id = str(receipt.get("finalization_id") or "unknown")
        review_ref = receipt.get("narration_review")
        review_id = (
            str(review_ref.get("review_id") or "")
            if isinstance(review_ref, dict) else ""
        )
        review_matches = reviews_by_id.get(review_id, [])
        review = review_matches[0] if len(review_matches) == 1 else None
        if len(review_matches) > 1:
            agency_findings.append(
                f"accepted revision {finalization_id} has duplicate narration review id {review_id}"
            )
        elif (
            not review_id
            or not isinstance(review, dict)
            or not _review_digest_valid(review)
            or review_ref.get("review_digest") != review.get("review_digest")
            or review.get("turn_id") != receipt.get("turn_id")
            or review.get("source_digest") != receipt.get("source_digest")
            or review.get("revision") != receipt.get("accepted_revision")
        ):
            agency_not_proven.append(finalization_id)
        elif not isinstance(review_ref.get("draft_sha256"), str):
            # Historical schema-v2 receipts did not freeze the raw draft hash.
            # They remain readable but cannot prove proposition-level review.
            agency_not_proven.append(finalization_id)
        elif review_ref.get("draft_sha256") != review.get("draft_sha256"):
            agency_findings.append(
                f"accepted revision {finalization_id} review does not bind its raw draft"
            )
        else:
            accepted_review_ids.add(review_id)
            if any(
                isinstance(finding, dict)
                and finding.get("rule_id") == "agency_violation"
                for finding in review.get("findings") or []
            ):
                agency_findings.append(
                    f"accepted revision {finalization_id} has agency_violation"
                )
        projection = (
            receipt.get("contract_projection")
            if isinstance(receipt.get("contract_projection"), dict) else {}
        )
        overrides = {
            str(row.get("override_id") or ""): row
            for row in (projection.get("control_overrides") or [])
            if isinstance(row, dict) and row.get("override_id")
        }
        player_input = projection.get("player_input")
        player_source_ref = (
            str(player_input.get("source_ref") or "")
            if isinstance(player_input, dict) else ""
        )
        authority = projection.get("agency_authority")
        authority = authority if isinstance(authority, dict) else {}
        pc_subject_refs = {
            str(value) for value in authority.get("pc_subject_refs") or []
            if isinstance(value, str) and value
        }
        physiology_sources = {
            str(row.get("source_ref") or "")
            for row in authority.get("involuntary_physiology_sources") or []
            if isinstance(row, dict)
            and row.get("source_type") == "ownership_contract"
            and isinstance(row.get("source_ref"), str)
            and row["source_ref"]
        }
        voluntary_types = {
            "voluntary_action", "voluntary_speech", "voluntary_plan",
            "voluntary_belief", "voluntary_trust",
            "voluntary_active_emotion",
        }
        for claim in receipt.get("agency_claims") or []:
            if not isinstance(claim, dict):
                agency_findings.append("accepted revision has malformed agency claim")
                continue
            claim_type = claim.get("claim_type")
            subject_ref = claim.get("subject_ref")
            source_ref = claim.get("source_ref")
            invalid = False
            reason = "has an invalid frozen agency source"
            if claim_type in voluntary_types:
                invalid = (
                    subject_ref not in pc_subject_refs
                    or not player_source_ref
                    or source_ref != player_source_ref
                    or claim.get("override_id") is not None
                )
                reason = "does not bind the exact frozen player input"
            elif claim_type == "involuntary_physiology":
                invalid = (
                    subject_ref not in pc_subject_refs
                    or source_ref not in physiology_sources
                    or claim.get("override_id") is not None
                )
                reason = "does not bind a typed physiology ownership source"
            elif claim_type == "forced_behavior":
                override = overrides.get(str(claim.get("override_id") or ""))
                invalid = (
                    not isinstance(override, dict)
                    or not _valid_control_override(override)
                    or override.get("subject_ref") != subject_ref
                    or override.get("source_ref") != source_ref
                )
                reason = "lacks its frozen active override"
            else:
                invalid = True
            if invalid:
                agency_findings.append(
                    f"agency claim {claim.get('claim_id') or 'unknown'} {reason}"
                )
    if agency_findings:
        dimension("agency", False, *agency_findings)
    elif agency_not_proven:
        dimension(
            "agency",
            False,
            "accepted revisions lack bound proposition-level review: "
            + ", ".join(sorted(agency_not_proven)),
            status="NOT_PROVEN",
        )
    else:
        dimension(
            "agency",
            True,
            "every accepted revision has an exact raw-draft-bound semantic review with no agency violation; every claim binds its frozen player, physiology, or override source",
        )

    dimension(
        "secrecy",
        True,
        "player projections are structural allowlists; concealed identifiers are verified after rendering",
    )
    dimension(
        "projection_hashes",
        True,
        "primary and audit payloads are hash-bound by the non-self-referential package manifest",
    )
    projection_ok = isinstance(flags, dict) and (npc_receipts is None or isinstance(npc_receipts, dict))
    dimension("player_safe_projection", projection_ok, "explicit per-source allowlists applied" if projection_ok else "player-safe projection sources are malformed")

    reasons: list[str] = [
        finding
        for value in dimensions.values()
        if value["status"] != "PASS"
        for finding in value["findings"]
    ]
    if not transcript_complete and transcript_relative == "partial-transcript.jsonl":
        reasons.append("partial transcript exported by explicit request")
    if all_rolls is None:
        reasons.append("structured rolls.jsonl is missing; public roll count cannot be proven")
    if malformed_lines:
        reasons.append("public roll rows lack roll_id or numerical evidence at source lines: " + ", ".join(map(str, malformed_lines)))
    if duplicate_roll_ids:
        reasons.append("duplicate public roll IDs: " + ", ".join(duplicate_roll_ids))
    if undispositioned_orphans:
        reasons.append(
            f"{len(undispositioned_orphans)} public roll rows are bound to no canonical receipt and carry no abandonment disposition: "
            + ", ".join(
                f"{orphan['roll_id'] or 'MISSING_ROLL_ID'} (source line {orphan['source_line']})"
                for orphan in undispositioned_orphans
            )
        )

    turn_capsules: dict[str, dict[str, Any]] = {}
    for call in toolbox_calls or []:
        if not isinstance(call, dict):
            continue
        turn_key = str(call.get("turn_number") if call.get("turn_number") is not None else "unassigned")
        capsule = turn_capsules.setdefault(
            turn_key,
            {
                "schema_version": 1,
                "turn_number": call.get("turn_number"),
                "visibility": "keeper_internal",
                "tool_calls": [],
                "advisory_adoptions": [],
            },
        )
        capsule["tool_calls"].append(call)
    for adoption in advisory_adoptions or []:
        if not isinstance(adoption, dict):
            continue
        decision_id = str(adoption.get("decision_id") or "")
        matched = next(
            (
                capsule
                for capsule in turn_capsules.values()
                if any(
                    isinstance(call, dict)
                    and str((call.get("args") or {}).get("decision_id") or "") == decision_id
                    for call in capsule["tool_calls"]
                )
            ),
            None,
        )
        if matched is None:
            matched = turn_capsules.setdefault(
                "unassigned",
                {
                    "schema_version": 1,
                    "turn_number": None,
                    "visibility": "keeper_internal",
                    "tool_calls": [],
                    "advisory_adoptions": [],
                },
            )
        matched["advisory_adoptions"].append(adoption)

    play_conduct_signals = _play_conduct_signals(
        dialogue=dialogue,
        public_roll_count=len(public_rolls),
        toolbox_calls=toolbox_calls,
        clue_graph=clue_graph,
        all_rolls=all_rolls,
        progression=progression,
        npc_receipts=npc_receipts,
    )

    projected_exceptional = _exceptional_effect_projection(exceptional_document)
    relationship_rewards = [
        effect for effect in projected_exceptional
        if effect.get("direction") == "benefit"
        and effect.get("effect_kind") == "bonus_die"
        and isinstance(effect.get("mechanics"), dict)
        and effect["mechanics"].get("target_id")
    ]
    sanity_event_types = {
        "sanity_loss", "bout_of_madness", "bout_ended", "temporary_insanity",
        "indefinite_insanity", "permanent_insanity", "involuntary_action",
        "phobia_gained", "mania_gained", "sanity_recovered",
        "treatment_trigger_scheduled", "turn_tail_abandoned",
    }
    audit_sanity_events = [
        row for row in (events or [])
        if isinstance(row, dict) and row.get("event_type") in sanity_event_types
    ]
    narration_rule_counts: dict[str, int] = {}
    narration_review_count = 0
    for row in narration_reviews_doc or []:
        if not isinstance(row, dict):
            continue
        narration_review_count += 1
        for finding in row.get("findings") or []:
            if isinstance(finding, dict) and finding.get("rule_id"):
                rule_id = str(finding["rule_id"])
                narration_rule_counts[rule_id] = narration_rule_counts.get(rule_id, 0) + 1
    rule_decisions = _stable_rows([
        row for row in toolbox_calls or []
        if isinstance(row, dict)
        and row.get("ok") is True
        and str(row.get("tool") or "").startswith("rules.")
        and str(row.get("tool") or "") in _registered_tool_names()
    ])
    social_rows = _flatten_document_rows(
        social_document, "resolutions", "goal_key", row_kind="social_resolution"
    )
    psychology_rows = _flatten_document_rows(
        psychology_document, "observations", "window_key", row_kind="hidden_settlement"
    ) + _flatten_document_rows(
        psychology_document, "realizations", "insight_id", row_kind="player_safe_realization"
    )
    psychology_rows = _stable_rows(psychology_rows)
    scene_budget_rows = _stable_rows([
        {"record_kind": "scene_event", **row}
        for row in event_rows
        if row.get("event_type") in {
            "scene_scope_drift", "scene_promotion", "clue_discovered"
        }
    ] + [
        {
            "record_kind": "scene_context_projection",
            "turn_number": call.get("turn_number"),
            "scene_contract": (call.get("data") or {}).get("scene_contract"),
        }
        for call in toolbox_calls or []
        if isinstance(call, dict)
        and call.get("ok") is True
        and call.get("tool") == "scene.context"
        and isinstance((call.get("data") or {}).get("scene_contract"), dict)
    ])
    narration_revision_rows = _stable_rows(
        [{
            "record_kind": (
                "accepted_finalization"
                if finalization_contract._valid_finalization(row)
                else "invalid_finalization_source"
            ),
            **row,
        } for row in turn_finalizations or [] if isinstance(row, dict)]
        + [{"record_kind": "semantic_review", **row} for row in narration_reviews_doc or [] if isinstance(row, dict)]
        + [{"record_kind": "dispositioned_revision", **row} for row in narration_repairs_doc or [] if isinstance(row, dict)]
    )
    concealed_identifiers = sorted({
        identifier
        for row in (all_rolls or [])
        if isinstance(row, dict) and _roll_visibility(row).casefold() not in PUBLIC_VISIBILITIES
        for identifier in [_roll_id(row)]
        if isinstance(identifier, str) and identifier
    } | {
        str(row.get(key))
        for row in psychology_rows
        for key in ("roll_id", "insight_id", "window_key")
        if isinstance(row.get(key), str) and row.get(key)
    })
    return {
        "completeness": {
            "classification": "COMPLETE" if not reasons else "INCOMPLETE",
            "claim_scope": "report_source_evidence_only",
            "not_claimed": ["prose_quality", "director_use", "whole_product_kp_quality", "play_conduct_quality_judgment"],
            "dimensions": dimensions,
            "dialogue_role_counts": role_counts,
            "final_transcript_present": transcript_complete,
            "reasons": reasons,
        },
        "investigators": investigators,
        "play_conduct_signals": play_conduct_signals,
        "progression": progression,
        "investigator_impressions": _player_safe_impressions(psychology_document),
        "npc_interactions": npc_interactions,
        "first_impressions": _first_impression_projection(
            first_impression_document, npc_receipts
        ),
        "social_rolls": social_rolls,
        "ending": ending,
        "visible_consequences": visible_consequences,
        "exceptional_effects": [
            effect for effect in projected_exceptional
            if effect not in relationship_rewards
        ],
        "relationship_rewards": relationship_rewards,
        "development_settlements": settlements,
        "state_integrity": state_integrity,
        "audit": {
            "schema_version": 2,
            "audience": "keeper_development_audit_only",
            "not_player_facing": True,
            "source_manifest": sorted(manifest.values(), key=lambda item: item["path"]),
            "transcript": [row for row in transcript if isinstance(row, dict)],
            "rolls_including_concealed": all_rolls or [],
            "rule_decisions": rule_decisions,
            "social_resolutions": social_rows,
            "psychology_hidden": psychology_rows,
            "scene_budget": scene_budget_rows,
            "narration_revisions": narration_revision_rows,
            "state_diffs": authoritative_state_diffs,
            "concealed_identifiers": concealed_identifiers,
            "sanity_events": audit_sanity_events,
            "dispositions": roll_dispositions,
            "turn_capsules": list(turn_capsules.values()),
            "tool_call_count": len(toolbox_calls or []),
            "advisory_adoption_count": len(advisory_adoptions or []),
            "dispositioned_orphan_rolls": {
                "count": len(dispositioned_orphan_ids),
                "roll_ids": sorted(dispositioned_orphan_ids),
            },
            "finalization_binding": {
                "bound_roll_ids": sorted(bound_roll_ids),
                "zero_roll_receipt_ids": sorted(zero_roll_receipt_ids),
                "undispositioned_orphans": _stable_rows(undispositioned_orphans),
                "git_history": git_history_proof,
            },
            "run_identity": identity_evidence,
            "narration_reviews": {
                "count": narration_review_count,
                "rule_counts": narration_rule_counts,
                "accepted_review_ids": sorted(accepted_review_ids),
            },
        },
        "public_rolls": {
            "source_present": all_rolls is not None,
            "required_count": len(public_rolls),
            "rendered_count": len(public_rolls),
            "duplicate_roll_ids": duplicate_roll_ids,
            "malformed_source_lines": malformed_lines,
            "records": public_rolls,
            "finalization_binding": {
                "contract": "render iff player-facing and bound to a canonical receipt",
                "bound_roll_id_count": len(bound_roll_ids),
                "zero_roll_turn_count": len(zero_roll_receipt_ids),
                "undispositioned_orphan_count": len(undispositioned_orphans),
                "dispositioned_orphan_count": len(dispositioned_orphan_ids),
                "git_history_status": git_status,
            },
            "status": "PASS" if all_rolls is not None and not duplicate_roll_ids and not malformed_lines and not undispositioned_orphans and not invalid_finalization_rows else "FAIL",
        },
        "run_metadata": metadata,
        "source_identity": {
            "metadata_source": metadata_source,
            "identity_source": identity_evidence.get("source"),
            "canonical_present": identity_evidence.get("canonical_present") is True,
            "campaign_id": metadata.get("campaign_id"),
            "campaign_source_directory": campaign_relative,
            "run_id": metadata.get("run_id"),
            "run_segment_id": metadata.get("run_segment_id"),
            "session_id": metadata.get("session_id"),
            "plugin_version": metadata.get("plugin_version"),
            "ruleset_id": metadata.get("ruleset_id"),
            "ruleset_version": metadata.get("ruleset_version"),
            "transcript_sha256": manifest[transcript_relative].get("sha256"),
            "transcript_source": transcript_relative,
            "harness_conflict_fields": list(
                identity_evidence.get("harness_conflict_fields") or []
            ),
            "identity_error": identity_evidence.get("error"),
        },
        "source_manifest": sorted(manifest.values(), key=lambda item: item["path"]),
        "transcript": {
            "source_record_count": len(transcript),
            "dialogue_record_count": len(dialogue),
            "records": dialogue,
        },
    }


def _turn_sort_key(key: str) -> tuple[int, Any]:
    if key == "unassigned":
        return (2, 0)
    if key.isdigit():
        return (0, int(key))
    return (1, key)


def _play_conduct_signals(
    *,
    dialogue: list[dict[str, Any]],
    public_roll_count: int,
    toolbox_calls: list[dict[str, Any]] | None,
    clue_graph: Any,
    all_rolls: list[Any] | None,
    progression: dict[str, Any],
    npc_receipts: Any,
) -> dict[str, Any]:
    """Observational structured facts about table conduct (e.g. zero-roll sessions).

    These signals only restate structured source evidence (turn numbers, roll
    log rows, module-authored delivery_kind, NPC identity contracts). They make
    no pass/fail judgment and never feed the completeness classification.
    """
    turn_count = len({row["turn"] for row in dialogue if _is_numeric(row.get("turn"))})

    tool_call_counts: dict[str, int] = {}
    for call in toolbox_calls or []:
        if not isinstance(call, dict):
            continue
        turn = call.get("turn_number")
        key = str(turn) if turn is not None else "unassigned"
        tool_call_counts[key] = tool_call_counts.get(key, 0) + 1

    discovered_clue_ids = [
        clue["clue_id"]
        for clue in progression.get("discovered_clues", [])
        if isinstance(clue, dict) and isinstance(clue.get("clue_id"), str)
    ]
    skill_check_clues: list[dict[str, Any]] | None = None
    without_roll_evidence: list[dict[str, Any]] | None = None
    if clue_graph is not None:
        discovered_set = set(discovered_clue_ids)
        skill_check_clues = [
            clue
            for clue in _clue_graph_rows(clue_graph)
            if clue["clue_id"] in discovered_set
            and clue.get("delivery_kind") == "skill_check"
        ]
        if all_rolls is not None:
            rolled_skills = {
                skill.strip().casefold()
                for row in all_rolls
                if (skill := _roll_skill(row)) is not None
            }
            without_roll_evidence = [
                clue
                for clue in skill_check_clues
                if not isinstance(clue.get("skill"), str)
                or clue["skill"].strip().casefold() not in rolled_skills
            ]

    receipts_source = npc_receipts.get("receipts") if isinstance(npc_receipts, dict) else None
    npc_total = 0
    npc_improvised = 0
    for receipt in receipts_source.values() if isinstance(receipts_source, dict) else []:
        event = receipt.get("event") if isinstance(receipt, dict) else None
        if not isinstance(event, dict):
            continue
        npc_total += 1
        if event.get("identity_contract") is None:
            npc_improvised += 1

    return {
        "schema_version": 1,
        "nature": "observational_structured_facts_only",
        "quality_judgment": "none: these signals never affect the completeness classification",
        "turn_count": turn_count,
        "public_roll_count": public_roll_count,
        "tool_call_counts_per_turn": {
            "available": toolbox_calls is not None,
            "counts": dict(sorted(tool_call_counts.items(), key=lambda item: _turn_sort_key(item[0]))),
            "total_tool_calls": len(toolbox_calls or []),
        },
        "skill_check_clue_delivery": {
            "available": clue_graph is not None and all_rolls is not None,
            "discovered_clue_count": len(discovered_clue_ids),
            "skill_check_delivery_count": len(skill_check_clues) if skill_check_clues is not None else None,
            "without_roll_evidence_count": len(without_roll_evidence) if without_roll_evidence is not None else None,
            "without_roll_evidence_clue_ids": (
                [clue["clue_id"] for clue in without_roll_evidence]
                if without_roll_evidence is not None
                else None
            ),
        },
        "npc_engagements": {
            "available": isinstance(npc_receipts, dict),
            "total_count": npc_total,
            "improvised_count": npc_improvised,
        },
    }


def _safe_host_model(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        return {}
    safe: dict[str, Any] = {}
    for key in (
        "provider",
        "model_id",
        "reasoning_effort",
        "lane",
        "background_model_policy",
    ):
        item = value.get(key)
        if isinstance(item, str) and item.strip():
            safe[key] = item
    for key in ("selected_before_activation", "switched_during_run"):
        item = value.get(key)
        if isinstance(item, bool):
            safe[key] = item
    return safe


def _safe_metadata(metadata: Any) -> dict[str, Any]:
    if not isinstance(metadata, dict):
        return {}
    allowed = (
        "run_segment_id",
        "run_id",
        "campaign_id",
        "session_id",
        "plugin_version",
        "ruleset_id",
        "ruleset_version",
        "seed",
        "play_language",
        "run_kind",
        "play_kind",
        "simulation_method",
        "started_at",
        "finished_at",
        "status",
    )
    safe = {key: metadata[key] for key in allowed if key in metadata}
    host_model = _safe_host_model(metadata.get("host_model"))
    if host_model:
        safe["host_model"] = host_model
    return safe


def _first(mapping: Any, keys: tuple[str, ...]) -> Any:
    if not isinstance(mapping, dict):
        return None
    for key in keys:
        if mapping.get(key) not in (None, ""):
            return mapping[key]
    return None


def _first_not_none(*values: Any) -> Any:
    for value in values:
        if value is not None:
            return value
    return None


def _structured_skill_labels(report: dict[str, Any]) -> dict[str, dict[str, str]]:
    """Player-facing labels already carried by each structured character card."""
    metadata = report.get("run_metadata")
    if not isinstance(metadata, dict) or metadata.get("play_language") != "zh-Hans":
        return {}
    labels_by_investigator: dict[str, dict[str, str]] = {}
    for investigator in report.get("investigators") or []:
        if not isinstance(investigator, dict):
            continue
        investigator_id = (
            investigator.get("investigator_display_name")
            or investigator.get("investigator_id")
        )
        character = investigator.get("character")
        rows = (
            character.get("initial_skill_rows")
            if isinstance(character, dict) else None
        )
        labels: dict[str, str] = {}
        for row in rows if isinstance(rows, list) else []:
            if not isinstance(row, dict):
                continue
            key = row.get("key")
            label = row.get("label")
            if (
                isinstance(key, str) and key.strip()
                and isinstance(label, str) and label.strip()
            ):
                labels[key] = label
        if isinstance(investigator_id, str):
            labels_by_investigator[investigator_id] = {
                **ZH_MECHANICAL_LABELS,
                **labels,
            }
    return labels_by_investigator


def _display_skill(
    labels_by_investigator: dict[str, dict[str, str]],
    investigator_id: Any,
    canonical_skill: Any,
) -> Any:
    if not isinstance(investigator_id, str) or not isinstance(canonical_skill, str):
        return canonical_skill
    return labels_by_investigator.get(investigator_id, {}).get(
        canonical_skill, canonical_skill
    )


def _nested_dice_display(payload: Any) -> Any:
    if not isinstance(payload, dict):
        return None
    dice = payload.get("dice")
    if not isinstance(dice, dict):
        return None
    total = dice.get("total")
    if not _is_numeric(total):
        return None
    expression = dice.get("expression")
    if isinstance(expression, str) and expression.strip():
        return f"{expression.strip()} = {total}"
    return total


def _display(value: Any) -> str:
    if isinstance(value, bool):
        return "yes" if value else "no"
    if isinstance(value, (str, int, float)):
        return str(value)
    if isinstance(value, list) and all(isinstance(item, (str, int, float)) for item in value):
        return ", ".join(map(str, value))
    return _pretty_json(value).replace("\n", " ")


def _exceptional_boundary_display(value: Any) -> str:
    if not isinstance(value, dict):
        return _display(value)
    kind = str(value.get("kind") or "unknown")
    detail = next(
        (
            value[key]
            for key in ("description", "scene_id", "marker_id", "uses")
            if value.get(key) not in (None, "")
        ),
        None,
    )
    return f"{kind}: {detail}" if detail is not None else kind


def _play_conduct_markdown(signals: dict[str, Any]) -> list[str]:
    """Player-safe observational counts; no clue content or keeper-only detail."""
    lines = [
        "## Play Conduct Signals",
        "",
        "Observational structured facts for human review. They are not pass/fail "
        "judgments and do not change the completeness classification.",
        "",
        f"- Dialogue turns: **{signals['turn_count']}**",
        f"- Public rolls: **{signals['public_roll_count']}**",
    ]
    tool_counts = signals["tool_call_counts_per_turn"]
    if tool_counts["available"]:
        if tool_counts["counts"]:
            per_turn = "; ".join(
                f"turn {turn}: {count}" for turn, count in tool_counts["counts"].items()
            )
            lines.append(f"- Tool calls per turn (from the keeper-internal toolbox log): {per_turn}")
        else:
            lines.append("- Tool calls per turn (from the keeper-internal toolbox log): no toolbox calls were logged")
    else:
        lines.append("- Tool calls per turn: keeper-internal toolbox log unavailable")
    clue_signal = signals["skill_check_clue_delivery"]
    if clue_signal["available"]:
        lines.append(
            f"- Discovered clues: {clue_signal['discovered_clue_count']}; "
            f"module-designed skill-check delivery: {clue_signal['skill_check_delivery_count']}; "
            f"without a matching authored-skill roll in the roll log: **{clue_signal['without_roll_evidence_count']}**"
        )
        clue_ids = clue_signal.get("without_roll_evidence_clue_ids") or []
        if clue_ids:
            lines.append("  - Without roll evidence: " + ", ".join(f"`{clue_id}`" for clue_id in clue_ids))
    else:
        lines.append(
            f"- Discovered clues: {clue_signal['discovered_clue_count']}; "
            "skill-check delivery evidence unavailable (clue graph or roll log missing)"
        )
    npc_signal = signals["npc_engagements"]
    if npc_signal["available"]:
        lines.append(
            f"- NPC engagements recorded: {npc_signal['total_count']}; "
            f"improvised (no authored NPC identity): **{npc_signal['improvised_count']}**"
        )
    else:
        lines.append("- NPC engagements: no structured receipts were recorded")
    lines.append("")
    return lines


def _localize_fixed_markdown_zh(markdown: str) -> str:
    """Translate exporter-owned chrome without touching exact table prose."""
    exact = {
        "# COC Actual-Play Battle Report": "# COC 实际游玩战报",
        "This is the final player-readable report produced directly from a real playtest run.": "本战报直接由一次真实跑团记录生成，供玩家阅读。",
        "> Completeness covers report-source evidence only. It does not certify prose quality, Director use, or whole-product KP quality.": "> 完整性只表示战报证据来源是否齐全，不代表叙事质量、导演方法使用情况或整体 KP 体验已经通过验收。",
        "## Investigators": "## 调查员",
        "## Development and Ending": "## 成长与结局",
        "## Investigation Chronicle": "## 调查纪要",
        "### Scene Progression": "### 场景进展",
        "### Discovered Clues": "### 已发现线索",
        "### Investigator Impressions (Not Confirmed Facts)": "### 调查员印象（非已确认事实）",
        "### NPC Interactions": "### NPC 互动",
        "### First Impressions": "### 初印象",
        "### Social Skill Rolls": "### 社交技能检定",
        "### Recorded Consequences": "### 已记录后果",
        "### Exceptional Effects": "### 特殊结果影响",
        "### Relationship / Impression Rewards": "### 关系与印象奖励",
        "### Major Decisions": "### 重大决定",
        "## Actual Play": "## 实际游玩记录",
        "## Public Rules and Dice": "## 公开规则与骰点",
        "## Play Conduct Signals": "## 游玩过程信号",
        "Observational structured facts for human review. They are not pass/fail judgments and do not change the completeness classification.": "以下是供人工复核的结构化观察，不是通过/未通过判定，也不改变完整性分类。",
        "## Completeness and Provenance": "## 完整性与来源",
        "#### Characteristics": "#### 属性",
        "#### Initial Derived Values": "#### 初始衍生数值",
        "#### Initial Skills": "#### 初始技能",
        "#### Era-Adaptive Creation": "#### 年代适配建卡",
        "#### Skill Adaptation Provenance": "#### 技能年代适配来源",
        "#### Weapons": "#### 武器",
        "#### Equipment": "#### 装备",
        "#### Backstory and Traits": "#### 背景与特质",
        "#### Personal Horror": "#### 个人恐怖",
        "No structured ending was recorded.": "未记录结构化结局。",
        "No visited-scene path was recorded.": "未记录场景访问路径。",
        "No discovered-clue receipts were recorded.": "未记录已发现线索回执。",
        "No player-visible investigator impressions were recorded.": "未记录玩家可见的调查员印象。",
        "No player-safe NPC interaction receipts were recorded.": "未记录玩家安全的 NPC 互动回执。",
        "No first-impression receipts were recorded.": "未记录初印象回执。",
        "No public social-skill rolls (Charm, Fast Talk, Intimidate, Persuade) were recorded.": "未记录公开社交技能检定（魅惑、话术、恐吓、说服）。",
        "No structured player-safe combat, HP, or SAN consequences were recorded.": "未记录结构化且玩家可见的战斗、生命值或理智值后果。",
        "No source-bound exceptional effects were recorded.": "未记录与来源检定绑定的特殊结果影响。",
        "No NPC-scoped relationship rewards were recorded.": "未记录面向特定 NPC 的关系奖励。",
        "No structured major-decision receipts were recorded.": "未记录结构化重大决定回执。",
        "No player/Keeper dialogue was recorded.": "未记录玩家与 KP 的对话。",
        "No public or consequence-public rolls occurred.": "没有发生公开骰点或公开后果骰点。",
        "- All required final-report sources passed validation.": "- 最终战报所需的全部来源均通过验证。",
        "- Keeper-only rolls, scenario truth, hidden logs, runner prompts, NPC identity contracts/agendas/voices, and secret fields are excluded.": "- 已排除仅限 KP 的骰点、模组真相、隐藏日志、运行器提示词、NPC 身份契约/议程/语气和秘密字段。",
        "- This is evidence/report-source completeness, not a prose-quality, Director-use, or whole-product KP-quality claim.": "- 这里声明的是证据与战报来源完整性，不代表叙事质量、导演方法使用情况或整体 KP 质量。",
    }
    prefixes = {
        "- Report ID:": "- 战报 ID:",
        "- Run:": "- 运行段:",
        "- Campaign:": "- 战役:",
        "- Completeness:": "- 完整性:",
        "- ID:": "- ID:",
        "- Occupation:": "- 职业:",
        "- Age:": "- 年龄:",
        "- Sex:": "- 性别:",
        "- Nationality:": "- 国籍:",
        "- Era:": "- 年代:",
        "- Residence:": "- 居住地:",
        "- Birthplace:": "- 出生地:",
        "- Credit Rating:": "- 信用评级:",
        "- Cash:": "- 现金:",
        "- Final HP:": "- 最终生命值:",
        "- Final SAN:": "- 最终理智值:",
        "- Final MP:": "- 最终魔法值:",
        "- Final Luck:": "- 最终幸运:",
        "- Conditions:": "- 状态:",
        "- Era Adaptive:": "- 年代适配:",
        "- KP Guided:": "- KP 引导:",
        "- Input Mode:": "- 输入模式:",
        "- Creation Method:": "- 建卡方法:",
        "- Occupation Rationale:": "- 职业依据:",
        "- Skill Point Formula:": "- 职业技能点公式:",
        "- Formula Rationale:": "- 公式依据:",
        "- Skill Budget Provenance:": "- 技能点预算来源:",
        "  - Occupation Points:": "  - 职业技能点:",
        "  - Personal Interest Points:": "  - 兴趣技能点:",
        "Public roll count:": "公开骰点数量:",
        "Dice completeness:": "骰点完整性:",
        "- Actor:": "- 行动者:",
        "- Check:": "- 检定:",
        "- Roll:": "- 骰点:",
        "- Raw Dice:": "- 原始骰点:",
        "- Target:": "- 目标值:",
        "- Difficulty:": "- 难度:",
        "- Outcome:": "- 结果:",
        "- Visibility:": "- 可见性:",
        "- Source:": "- 来源:",
        "- Dialogue turns:": "- 对话轮次:",
        "- Public rolls:": "- 公开骰点:",
        "- Tool calls per turn": "- 每轮工具调用",
        "- Discovered clues:": "- 已发现线索:",
        "- NPC engagements recorded:": "- 已记录 NPC 互动:",
        "- Dialogue rows rendered:": "- 已渲染对话行数:",
        "- Public rolls rendered exactly once:": "- 仅渲染一次的公开骰点:",
        "- Description:": "- 描述:",
        "- Ideology Beliefs:": "- 信念:",
        "- Significant People:": "- 重要之人:",
        "- Treasured Possessions:": "- 珍贵物品:",
        "- Traits:": "- 特质:",
        "  - Description:": "  - 描述:",
        "  - Ideology Beliefs:": "  - 信念:",
        "  - Significant People:": "  - 重要之人:",
        "  - Treasured Possessions:": "  - 珍贵物品:",
        "  - Traits:": "  - 特质:",
    }
    phrase_map = {
        "**INCOMPLETE**": "**不完整**",
        "**COMPLETE**": "**完整**",
        "**PASS**": "**通过**",
        "**FAIL**": "**未通过**",
        "run metadata and campaign directory resolved": "已解析运行元数据和战役目录",
        "every journaled player message and finalized Keeper response is present exactly once": "每条已入账玩家消息和已定稿 KP 回复都恰好出现一次",
        "structured public-roll evidence is traceable exactly once and every rendered roll is bound to a canonical receipt": "结构化公开骰点证据均可追溯、恰好出现一次，且每个已渲染骰点都绑定到规范回执",
        "initial card and final dynamic state are present": "初始角色卡和最终动态状态均存在",
        "visited scenes and discovered-clue receipts are projected": "已投影访问场景和已发现线索回执",
        "structured ending or development settlement is missing": "缺少结构化结局或成长结算",
        "explicit per-source allowlists applied": "已应用逐来源显式白名单",
        " — not recorded as woven": " — 未记录已融入剧情",
        " · payoff recorded": " · 已记录回收",
        " · Ending ": " · 结局 ",
        " (custom)": "（自创）",
        "; allocations: none": "; 分配：无",
        "; allocations:": "; 分配：",
    }
    output: list[str] = []
    in_table_transcript = False
    for line in markdown.splitlines():
        if line == "## Actual Play":
            in_table_transcript = True
            output.append(exact[line])
            continue
        elif line == "## Public Rules and Dice":
            in_table_transcript = False
        if in_table_transcript and line.startswith("### Turn "):
            left, separator, speaker = line.partition(" · ")
            turn = left.removeprefix("### Turn ")
            output.append(f"### 第 {turn} 轮{separator}{speaker}")
            continue
        if in_table_transcript:
            output.append(line)
            continue
        localized = exact.get(line, line)
        for source, target in prefixes.items():
            if localized.startswith(source):
                localized = target + localized[len(source):]
                break
        if localized.startswith("- Source Identity:"):
            localized = localized.replace("- Source Identity:", "- 来源身份:", 1)
        elif localized.startswith("- Exact Transcript:"):
            localized = localized.replace("- Exact Transcript:", "- 精确逐字记录:", 1)
        elif localized.startswith("- Dice:"):
            localized = localized.replace("- Dice:", "- 骰点:", 1)
        elif localized.startswith("- Character And Final State:"):
            localized = localized.replace("- Character And Final State:", "- 角色与最终状态:", 1)
        elif localized.startswith("- Progression:"):
            localized = localized.replace("- Progression:", "- 进展:", 1)
        elif localized.startswith("- Ending And Development:"):
            localized = localized.replace("- Ending And Development:", "- 结局与成长:", 1)
        elif localized.startswith("- Player Safe Projection:"):
            localized = localized.replace("- Player Safe Projection:", "- 玩家安全投影:", 1)
        for source, target in phrase_map.items():
            localized = localized.replace(source, target)
        outcome_labels = {
            "success": "成功",
            "regular": "普通成功",
            "hard": "困难成功",
            "extreme": "极难成功",
            "critical": "大成功",
            "failure": "失败",
        }
        difficulty_labels = {
            "regular": "普通",
            "hard": "困难",
            "extreme": "极难",
        }
        if localized.startswith("- 结果: "):
            label, separator, value = localized.partition(": ")
            localized = label + separator + outcome_labels.get(value, value)
        elif localized.startswith("- 难度: "):
            label, separator, value = localized.partition(": ")
            localized = label + separator + difficulty_labels.get(value, value)
        elif localized.startswith("- 可见性: "):
            localized = localized.replace(": public", ": 公开", 1)
        elif localized.startswith("- `") and " · D100 " in localized:
            localized = localized.replace(" / CR ", " / 信用评级 ", 1)
            localized = localized.replace(" · used APP ", " · 采用外貌 ", 1)
            localized = localized.replace(
                " · used Credit Rating ", " · 采用信用评级 ", 1
            )
            for source, target in outcome_labels.items():
                localized = localized.replace(f" · {source} ·", f" · {target} ·")
        elif localized.startswith("- `") and " · scene `" in localized:
            interaction_labels = {
                "assistance": "协助",
                "dialogue": "对话",
                "witness": "见证",
                "opposition": "对抗",
                "accompaniment": "陪同",
                "interaction": "互动",
            }
            localized = localized.replace(" · scene `", " · 场景 `", 1)
            for source, target in interaction_labels.items():
                localized = localized.replace(f" · {source} ·", f" · {target} ·", 1)
        elif (
            localized.startswith("- Public social check · ")
            or localized.startswith("- `")
        ) and " · roll " in localized:
            localized = localized.replace(" · roll ", " · 骰点 ", 1).replace(
                " vs ", " 对 ", 1
            )
            for source, target in outcome_labels.items():
                if localized.endswith(f" · {source}"):
                    localized = localized[: -len(source)] + target
                    break
        output.append(localized)
    return "\n".join(output)


def _markdown(report: dict[str, Any]) -> str:
    metadata = report["run_metadata"]
    completeness = report["completeness"]
    skill_labels = _structured_skill_labels(report)
    lines = [
        "# COC Actual-Play Battle Report", "",
        "This is the final player-readable report produced directly from a real playtest run.", "",
        f"- Run segment: `{metadata.get('run_segment_id', 'MISSING')}`",
        f"- Campaign: `{metadata.get('campaign_id', 'MISSING')}`",
        f"- Completeness: **{completeness['classification']}**", "",
        "> Completeness covers report-source evidence only. It does not certify prose quality, Director use, or whole-product KP quality.", "",
        "## Investigators", "",
    ]
    if not report["investigators"]:
        lines.extend(["No investigator evidence was found.", ""])
    for investigator in report["investigators"]:
        character = investigator.get("character") or {}
        state = investigator.get("state") or {}
        creation = investigator.get("creation")
        if not isinstance(creation, dict):
            creation = character.get("creation") if isinstance(character, dict) else None
        name = _first(character, ("name", "display_name")) or _first(state, ("name", "display_name")) or investigator.get("investigator_display_name") or "Investigator"
        occupation = _first(character, ("occupation", "profession"))
        occupation_name = (
            occupation.get("name") if isinstance(occupation, dict) else occupation
        )
        lines.extend([f"### {name}", ""])
        fields = (
            ("Occupation", occupation_name),
            ("Age", _first(character, ("age",))),
            ("Sex", _first(character, ("sex",))),
            ("Nationality", _first(character, ("nationality",))),
            ("Era", _first(character, ("era",))),
            ("Residence", _first(character, ("residence",))),
            ("Birthplace", _first(character, ("birthplace",))),
            ("Credit Rating", _first(character, ("credit_rating",))),
            ("Cash", _first(character, ("cash",))),
            (
                "Final HP",
                _first_not_none(
                    _first(state, ("current_hp", "hp", "hit_points")),
                    _first(character.get("derived"), ("HP", "hp")),
                ),
            ),
            (
                "Final SAN",
                _first_not_none(
                    _first(state, ("current_san", "san", "sanity")),
                    _first(character.get("derived"), ("SAN", "san")),
                ),
            ),
            (
                "Final MP",
                _first_not_none(
                    _first(state, ("current_mp", "mp", "magic_points")),
                    _first(character.get("derived"), ("MP", "mp")),
                ),
            ),
            ("Final Luck", _first_not_none(_first(state, ("current_luck", "luck")), _first(character.get("characteristics"), ("LUCK", "Luck")))),
            ("Conditions", _first(state, ("conditions",))),
        )
        lines.extend(f"- {label}: {_display(value)}" for label, value in fields if value not in (None, "", []))
        lines.append("")
        for heading, key in (("Characteristics", "characteristics"), ("Initial Derived Values", "derived")):
            value = character.get(key)
            if isinstance(value, dict) and value:
                lines.extend([f"#### {heading}", "", " | ".join(f"{k}: {_display(v)}" for k, v in value.items()), ""])
        is_era_adaptive = (
            character.get("era_adaptive") is True
            or character.get("kp_guided") is True
            or isinstance(creation, dict) and (
                creation.get("era_adaptive") is True
                or creation.get("kp_guided") is True
                or creation.get("input_mode") == "kp_guided_era_adaptive"
            )
        )
        if is_era_adaptive:
            lines.extend(["#### Era-Adaptive Creation", ""])
            adaptation_fields = (
                ("Era Adaptive", character.get("era_adaptive")),
                ("KP Guided", character.get("kp_guided")),
                ("Input Mode", creation.get("input_mode") if isinstance(creation, dict) else None),
                ("Creation Method", creation.get("method") if isinstance(creation, dict) else None),
            )
            lines.extend(
                f"- {label}: {_display(value)}"
                for label, value in adaptation_fields
                if value not in (None, "")
            )
            creation_occupation = (
                creation.get("occupation") if isinstance(creation, dict) else None
            )
            if not isinstance(creation_occupation, dict):
                creation_occupation = occupation if isinstance(occupation, dict) else None
            if isinstance(creation_occupation, dict):
                occupation_fields = (
                    ("Occupation Rationale", creation_occupation.get("reason")),
                    ("Skill Point Formula", creation_occupation.get("skill_point_formula")),
                    ("Formula Rationale", creation_occupation.get("formula_reason")),
                )
                lines.extend(
                    f"- {label}: {_display(value)}"
                    for label, value in occupation_fields
                    if value not in (None, "")
                )
            skill_budget = creation.get("skill_budget") if isinstance(creation, dict) else None
            if isinstance(skill_budget, dict):
                lines.append("- Skill Budget Provenance:")
                for account_name, label in (
                    ("occupation_points", "Occupation Points"),
                    ("personal_interest_points", "Personal Interest Points"),
                ):
                    account = skill_budget.get(account_name)
                    if not isinstance(account, dict):
                        continue
                    allocations = account.get("allocations")
                    allocation_text = (
                        ", ".join(
                            f"`{skill_id}` +{points}"
                            for skill_id, points in allocations.items()
                        )
                        if isinstance(allocations, dict) and allocations else "none"
                    )
                    lines.append(
                        f"  - {label}: {_display(account.get('spent'))} / "
                        f"{_display(account.get('budget'))}; allocations: {allocation_text}"
                    )
            lines.append("")
        skill_provenance = character.get("skill_provenance")
        if isinstance(skill_provenance, dict) and skill_provenance:
            lines.extend(["#### Skill Adaptation Provenance", ""])
            for skill_id, provenance in skill_provenance.items():
                if not isinstance(provenance, dict):
                    continue
                original = provenance.get("original_name")
                reskinned = provenance.get("reskinned_name")
                if not isinstance(original, str) or not isinstance(reskinned, str):
                    continue
                custom = " (custom)" if provenance.get("custom") is True else ""
                lines.append(
                    f"- `{skill_id}`: `{original}` → {reskinned}{custom}"
                )
            lines.append("")
        skill_rows = character.get("initial_skill_rows")
        if isinstance(skill_rows, list) and skill_rows:
            lines.extend(["#### Initial Skills", "", "| Skill | Full | Half | Fifth |", "|---|---:|---:|---:|"])
            for row in skill_rows:
                label = row.get("label") or row.get("key")
                key = row.get("key")
                display_label = f"{label} (`{key}`)" if label != key else str(key)
                lines.append(f"| {display_label} | {_display(row.get('value'))} | {_display(row.get('half'))} | {_display(row.get('fifth'))} |")
            lines.append("")
        elif isinstance(character.get("initial_skills"), dict) and character["initial_skills"]:
            lines.extend([
                "#### Initial Skills",
                "",
                " | ".join(
                    f"{_display_skill(skill_labels, investigator.get('investigator_display_name') or name, key)}: {_display(value)}"
                    for key, value in character["initial_skills"].items()
                ),
                "",
            ])
        for heading, key in (("Weapons", "weapons"), ("Equipment", "equipment")):
            value = character.get(key)
            if isinstance(value, list) and value:
                lines.extend([f"#### {heading}", ""])
                if key == "weapons":
                    for item in value:
                        if isinstance(item, dict):
                            name = item.get("name") or item.get("weapon_id") or "Weapon"
                            details = "; ".join(f"{k.replace('_', ' ').title()}: {_display(v)}" for k, v in item.items() if k not in {"name", "weapon_id"})
                            lines.append(f"- **{name}**{f' — {details}' if details else ''}")
                        else:
                            lines.append(f"- {_display(item)}")
                else:
                    lines.extend(f"- {_display(item)}" for item in value)
                lines.append("")
        backstory = character.get("backstory")
        if isinstance(backstory, dict) and backstory:
            lines.extend(["#### Backstory and Traits", ""])
            for key, value in backstory.items():
                if key == "scenario_id" or value in (None, "", []):
                    continue
                label = key.replace('_', ' ').title()
                if isinstance(value, dict):
                    lines.append(f"- **{label}**")
                    for child_key, child_value in value.items():
                        if child_value not in (None, "", []):
                            lines.append(f"  - {child_key.replace('_', ' ').title()}: {_display(child_value)}")
                else:
                    lines.append(f"- {label}: {_display(value)}")
            lines.append("")
        hooks = state.get("personal_horror_hooks")
        if isinstance(hooks, list) and hooks:
            lines.extend(["#### Personal Horror", ""])
            for hook in hooks:
                if isinstance(hook, dict):
                    status = "woven" if hook.get("woven") is True else "not recorded as woven"
                    payoff = " · payoff recorded" if hook.get("payoff") is True else ""
                    lines.append(f"- {_display(hook.get('summary') or hook.get('hook_id'))} — {status}{payoff}")
            lines.append("")

    lines.extend(["## Development and Ending", ""])
    ending = report.get("ending")
    if isinstance(ending, dict):
        lines.extend([f"**Outcome:** {_display(ending.get('kind') or 'conclusion')}", "", _display(ending.get("summary") or "No readable ending summary was recorded."), ""])
    else:
        lines.extend(["No structured ending was recorded.", ""])
    for settlement in report.get("development_settlements", []):
        display_name = settlement.get("investigator_display_name") or "Investigator"
        ending_ordinal = settlement.get("ending_ordinal")
        suffix = f" · Ending {ending_ordinal}" if ending_ordinal else ""
        lines.extend([f"### {display_name} Development{suffix}", ""])
        for row in settlement.get("improvement_checks", []):
            lines.append(f"- {row.get('skill')}: {row.get('value_before')} → {row.get('value_after')} (gain {row.get('applied_delta', row.get('gain'))}; check {row.get('check_roll')})")
        luck = settlement.get("luck_recovery")
        if luck:
            lines.append(f"- Luck: {luck.get('luck_before')} → {luck.get('luck_after')} (gain {luck.get('gained')}; check {luck.get('roll')}; {'recovered' if luck.get('success') else 'not recovered'})")
        san = settlement.get("san_reward")
        if san:
            dice = san.get("rolls")
            roll_text = ", ".join(map(str, dice)) if isinstance(dice, list) else san.get("total")
            lines.append(f"- SAN reward: {san.get('san_before')} → {san.get('san_after')} (gain {san.get('san_gained')}; {san.get('expression')}: {roll_text})")
        facing = settlement.get("player_facing_mechanics")
        if isinstance(facing, dict) and facing.get("rendered_lines"):
            lines.append("- Public development checks (final output hard constraint):")
            for line in facing["rendered_lines"]:
                lines.append(f"  - {line}")
            if facing.get("complete") is False:
                lines.append(
                    f"  - INCOMPLETE missing: {facing.get('missing_roll_ids') or []}"
                )
        lines.append("")

    progression = report.get("progression", {})
    lines.extend(["## Investigation Chronicle", "", "### Scene Progression", ""])
    visited_count = progression.get("visited_scene_count", 0)
    lines.extend([f"Recorded visited scenes: {visited_count}." if visited_count else "No visited-scene path was recorded.", "", "### Discovered Clues", ""])
    for clue in progression.get("discovered_clues", []):
        detail = f" — {clue['method']}" if clue.get("method") else ""
        lines.append(f"- Confirmed clue{detail}")
    if not progression.get("discovered_clues"):
        lines.append("No discovered-clue receipts were recorded.")
    lines.extend(["", "### Investigator Impressions (Not Confirmed Facts)", ""])
    for impression in report.get("investigator_impressions") or []:
        question = impression.get("question")
        prefix = f"{question}: " if isinstance(question, str) and question else ""
        lines.append(f"- {prefix}{impression.get('visible_observation', '')}")
    if not report.get("investigator_impressions"):
        lines.append("No player-visible investigator impressions were recorded.")
    lines.extend(["", "### NPC Interactions", ""])
    for npc in report.get("npc_interactions", []):
        lines.append(f"- Recorded NPC · {npc.get('interaction_kind', 'interaction')}")
    if not report.get("npc_interactions"):
        lines.append("No player-safe NPC interaction receipts were recorded.")
    lines.extend(["", "### First Impressions", ""])
    for impression in report.get("first_impressions", []):
        basis = (
            "Credit Rating"
            if impression.get("governing_attribute") == "credit_rating"
            else "APP"
        )
        result = (
            "legacy frozen receipt"
            if impression.get("legacy_contract")
            else (
                f"D100 {impression.get('roll')} · "
                f"{impression.get('achieved_level')}"
            )
        )
        realization = impression.get("realization") or {}
        lines.append(
            f"- {impression.get('investigator_display_name', 'Investigator')} → "
            f"{impression.get('npc_display_name') or 'NPC'} · APP {impression.get('app')} / "
            f"CR {impression.get('credit_rating')} · used {basis} "
            f"{impression.get('governing_value')} · {result} · "
            f"{realization.get('observable_manner', 'realization not recorded')}"
        )
    if not report.get("first_impressions"):
        lines.append("No first-impression receipts were recorded.")
    lines.extend(["", "### Social Skill Rolls", ""])
    for entry in report.get("social_rolls", []):
        parts = [
            "Public social check",
            str(_display_skill(
                skill_labels, entry.get("actor"), entry.get("skill")
            )),
        ]
        if _is_numeric(entry.get("roll")):
            roll_text = f"roll {_display(entry['roll'])}"
            if _is_numeric(entry.get("target")):
                roll_text += f" vs {_display(entry['target'])}"
            parts.append(roll_text)
        if entry.get("outcome"):
            parts.append(str(entry["outcome"]))
        lines.append("- " + " · ".join(parts))
    if not report.get("social_rolls"):
        lines.append("No public social-skill rolls (Charm, Fast Talk, Intimidate, Persuade) were recorded.")
    lines.extend(["", "### Recorded Consequences", ""])
    for event in report.get("visible_consequences", []):
        event_type = event.get("event_type", "event").replace("_", " ").title()
        details = "; ".join(f"{key.replace('_', ' ').title()}: {_display(value)}" for key, value in event.items() if key not in {"event_type", "ts"})
        lines.append(f"- **{event_type}**{f' — {details}' if details else ''}")
    if not report.get("visible_consequences"):
        lines.append("No structured player-safe combat, HP, or SAN consequences were recorded.")
    lines.extend(["", "### Exceptional Effects", ""])
    for effect in report.get("exceptional_effects", []):
        boundary = _exceptional_boundary_display(effect.get("boundary"))
        lines.append(
            f"- **{effect.get('direction', 'effect')} · {effect.get('effect_kind', 'effect')}** — "
            f"{effect.get('player_visible_impact', '')} "
            f"(cause: {effect.get('causal_link', '')}; boundary: {boundary}; "
            f"status: {effect.get('status', 'unknown')})"
        )
    if not report.get("exceptional_effects"):
        lines.append("No source-bound exceptional effects were recorded.")
    lines.extend(["", "### Relationship / Impression Rewards", ""])
    for effect in report.get("relationship_rewards", []):
        mechanics = effect.get("mechanics") or {}
        boundary = _exceptional_boundary_display(effect.get("boundary"))
        lines.append(
            f"- Investigator → "
            f"{mechanics.get('target_display_name') or 'NPC'} · {effect.get('effect_kind')} · "
            f"{effect.get('player_visible_impact', '')} "
            f"(cause: {effect.get('causal_link', '')}; skill: "
            f"{mechanics.get('skill', 'unknown')}; boundary: {boundary}; "
            f"status: {effect.get('status', 'unknown')})"
        )
    if not report.get("relationship_rewards"):
        lines.append("No NPC-scoped relationship rewards were recorded.")
    decisions = progression.get("major_decisions", [])
    lines.extend(["", "### Major Decisions", ""])
    for decision in decisions:
        lines.append(f"- {_display(decision)}")
    if not decisions:
        lines.append("No structured major-decision receipts were recorded.")
    lines.append("")

    lines.extend(["## Actual Play", ""])
    for index, row in enumerate(report["transcript"]["records"], start=1):
        side = "Keeper" if row["role"].casefold() in KEEPER_ROLES else "Player"
        speaker = row.get("speaker_display") or row.get("speaker") or side
        lines.extend([f"### Turn {row.get('turn', index)} · {speaker}", "", row["text"].strip(), ""])
    if not report["transcript"]["records"]:
        lines.extend(["No player/Keeper dialogue was recorded.", ""])

    rolls = report["public_rolls"]
    lines.extend(["## Public Rules and Dice", "", f"Public roll count: **{rolls['required_count']}**.", f"Dice completeness: **{rolls['status']}**.", ""])
    for roll_index, roll in enumerate(rolls["records"], start=1):
        payload = roll.get("payload") if isinstance(roll.get("payload"), dict) else {}
        dice = payload.get("dice") if isinstance(payload.get("dice"), dict) else {}
        actor = _first_not_none(
            _first(roll, ("actor", "investigator_id")),
            _first(payload, ("actor", "investigator_id")),
        )
        canonical_check = _first_not_none(
            _first(payload, ("skill", "attribute", "reason", "expression")),
            _first(roll, ("skill", "reason", "expression")),
        )
        lines.extend([f"### Check {roll_index}", ""])
        fields = (
            ("Actor", actor),
            (
                "Check",
                _display_skill(skill_labels, actor, canonical_check),
            ),
            (
                "Roll",
                _first_not_none(
                    _first(payload, ("roll", "rolls", "total", "result", "value")),
                    _nested_dice_display(payload),
                    _first(roll, ("roll", "rolls", "total", "result", "value")),
                ),
            ),
            ("Raw Dice", _first(dice, ("raw",))),
            (
                "Target",
                _first_not_none(
                    _first(payload, ("effective_target", "target")),
                    _first(roll, ("effective_target", "target")),
                ),
            ),
            (
                "Difficulty",
                _first_not_none(
                    _first(payload, ("difficulty",)),
                    _first(roll, ("difficulty",)),
                ),
            ),
            (
                "Outcome",
                _first_not_none(
                    _first(payload, ("outcome", "success_level")),
                    _first(roll, ("outcome", "success_level")),
                ),
            ),
            ("Visibility", _roll_visibility(roll)),
        )
        lines.extend(f"- {label}: {_display(value)}" for label, value in fields if value not in (None, "", []))
        lines.append("")
    if not rolls["records"]:
        lines.extend(["No public or consequence-public rolls occurred.", ""])

    lines.extend(_play_conduct_markdown(report["play_conduct_signals"]))

    lines.extend(["## Completeness and Provenance", ""])
    for name, result in completeness["dimensions"].items():
        lines.append(f"- {name.replace('_', ' ').title()}: **{result['status']}** — {'; '.join(result['findings'])}")
    lines.extend([f"- {reason}" for reason in completeness["reasons"]] or ["- All required final-report sources passed validation."])
    lines.extend([
        f"- Dialogue rows rendered: {report['transcript']['dialogue_record_count']}.",
        f"- Public rolls rendered exactly once: {rolls['rendered_count']}.",
        "- Keeper-only rolls, scenario truth, hidden logs, runner prompts, NPC identity contracts/agendas/voices, and secret fields are excluded.",
        "- This is evidence/report-source completeness, not a prose-quality, Director-use, or whole-product KP-quality claim.", "",
    ])
    markdown = "\n".join(lines)
    if str(metadata.get("play_language") or "").casefold().startswith("zh"):
        return _localize_fixed_markdown_zh(markdown)
    return markdown


def _safe_artifacts_dir(run_dir: Path) -> Path:
    artifacts = run_dir / "artifacts"
    if artifacts.exists():
        if artifacts.is_symlink() or not artifacts.is_dir():
            raise ExportError("artifacts must be a real directory, not a symlink or file")
    else:
        artifacts.mkdir(mode=0o755)
    for name in (JSON_OUTPUT, MARKDOWN_OUTPUT):
        output = artifacts / name
        if output.is_symlink():
            raise ExportError(f"refusing to overwrite output symlink: artifacts/{name}")
        if output.exists() and not output.is_file():
            raise ExportError(f"output is not a regular file: artifacts/{name}")
    return artifacts


def _atomic_pair(artifacts: Path, outputs: dict[str, bytes]) -> None:
    staged: dict[str, Path] = {}
    try:
        for name, content in outputs.items():
            descriptor, temporary = tempfile.mkstemp(prefix=f".{name}.", dir=artifacts)
            path = Path(temporary)
            staged[name] = path
            with os.fdopen(descriptor, "wb") as handle:
                handle.write(content)
                handle.flush()
                os.fsync(handle.fileno())
        for name in outputs:
            os.replace(staged.pop(name), artifacts / name)
        directory_fd = os.open(artifacts, os.O_RDONLY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    finally:
        for path in staged.values():
            path.unlink(missing_ok=True)


_AUDIT_DIR_NAME = "audit"


def _safe_audit_dir(artifacts: Path) -> Path:
    audit = artifacts / _AUDIT_DIR_NAME
    if audit.exists():
        if audit.is_symlink() or not audit.is_dir():
            raise ExportError("artifacts/audit must be a real directory, not a symlink or file")
    else:
        audit.mkdir(mode=0o755)
    return audit


def _jsonl_bytes(rows: list[Any]) -> bytes:
    return ("".join(
        json.dumps(row, ensure_ascii=False) + "\n" for row in rows
    )).encode("utf-8")


def _render_rules_audit(report: dict[str, Any], audit: dict[str, Any]) -> str:
    """Human-readable keeper/development audit attachment (not player-facing)."""
    completeness = audit.get("full_completeness") or report.get("completeness") or {}
    metadata = report.get("run_metadata") or {}
    lines = [
        "# 规则审计附件 (Rules Audit)",
        "",
        f"- campaign: {metadata.get('campaign_id')}",
        f"- report_id: {audit.get('report_id')}",
        f"- classification: {completeness.get('classification')}",
        "",
        "## 完整性维度",
    ]
    dimensions = completeness.get("dimensions") or {}
    if isinstance(dimensions, dict):
        dimension_rows = [
            {"dimension": name, **(row if isinstance(row, dict) else {})}
            for name, row in dimensions.items()
        ]
    else:
        dimension_rows = [
            row for row in dimensions if isinstance(row, dict)
        ]
    for dimension in dimension_rows:
        lines.append(
            f"- [{dimension.get('status')}] {dimension.get('dimension')}: "
            + "; ".join(str(reason) for reason in dimension.get("findings") or [])
        )
    for reason in completeness.get("reasons") or []:
        lines.append(f"- INCOMPLETE: {reason}")
    lines += ["", "## 全部骰点（含暗骰/Keeper-only）", ""]
    for row in audit.get("rolls_including_concealed") or []:
        if not isinstance(row, dict):
            continue
        payload = row.get("payload") if isinstance(row.get("payload"), dict) else {}
        lines.append(
            "- "
            + " | ".join(str(part) for part in (
                row.get("roll_id") or payload.get("roll_id"),
                row.get("visibility"),
                payload.get("skill") or payload.get("kind"),
                payload.get("roll"),
                payload.get("target") or payload.get("effective_target"),
                payload.get("outcome"),
            ) if part is not None)
        )
    lines += ["", "## 理智与疯狂状态转换", ""]
    for row in audit.get("sanity_events") or []:
        if not isinstance(row, dict):
            continue
        lines.append(
            f"- {row.get('event_type')}: "
            + json.dumps(row, ensure_ascii=False, sort_keys=True)[:400]
        )
    lines += ["", "## 结算与边界", ""]
    for settlement in report.get("development_settlements") or []:
        if not isinstance(settlement, dict):
            continue
        lines.append(
            f"- {settlement.get('investigator_id')} @ {settlement.get('ending_id')}: "
            f"status={settlement.get('status')} "
            f"boundary={json.dumps(settlement.get('settlement_boundary'), ensure_ascii=False)}"
        )
    dispositions = audit.get("dispositions") or {}
    lines += ["", "## 骰点处置账本", ""]
    if not dispositions:
        lines.append("- (none)")
    for roll_id, record in sorted(dispositions.items()):
        if not isinstance(record, dict):
            continue
        lines.append(
            f"- {roll_id}: {record.get('visibility')} — {record.get('reason')}"
        )
    lines += ["", "## 公开骰点绑定", ""]
    public_binding = (report.get("public_rolls") or {}).get("finalization_binding") or {}
    binding = audit.get("finalization_binding") or {}
    lines.append(f"- contract: {public_binding.get('contract')}")
    lines.append(f"- bound_roll_id_count: {len(binding.get('bound_roll_ids') or [])}")
    git_history = binding.get("git_history") if isinstance(binding.get("git_history"), dict) else {}
    lines.append(f"- git_history_status: {git_history.get('status') or public_binding.get('git_history_status')}")
    git_codes = [
        item.get("code")
        for item in (git_history.get("findings") or [])
        if isinstance(item, dict) and item.get("code")
    ]
    if git_codes:
        lines.append("- git_history_reason_codes: " + ", ".join(str(code) for code in git_codes))
    for orphan in binding.get("undispositioned_orphans") or []:
        lines.append(f"- UNDISPOSITIONED ORPHAN: {orphan}")
    reviews = audit.get("narration_reviews") or {}
    lines += ["", "## 叙事评审 findings 统计", ""]
    lines.append(f"- review count: {reviews.get('count', 0)}")
    for rule_id, count in sorted((reviews.get("rule_counts") or {}).items()):
        lines.append(f"- {rule_id}: {count}")
    lines += ["", "## 双轨审计流", ""]
    for name in (
        "transcript", "rolls_including_concealed", "rule_decisions",
        "social_resolutions", "psychology_hidden", "scene_budget",
        "narration_revisions", "state_diffs",
    ):
        value = audit.get(name) or []
        lines.append(f"- {name}: {len(value) if isinstance(value, list) else 0} row(s)")
    return "\n".join(lines) + "\n"


_PLAYER_FORBIDDEN_KEYS = {
    "audit", "keeper_internal", "source_manifest", "psychology_hidden",
    "control_overrides", "contract_projection", "scene_contract",
    "narration_revisions", "rule_decisions", "state_diffs",
}


def _forbidden_player_keys(value: Any, *, path: str = "$") -> list[str]:
    findings: list[str] = []
    if isinstance(value, dict):
        for key, child in value.items():
            child_path = f"{path}.{key}"
            if key in _PLAYER_FORBIDDEN_KEYS:
                findings.append(child_path)
            findings.extend(_forbidden_player_keys(child, path=child_path))
    elif isinstance(value, list):
        for index, child in enumerate(value):
            findings.extend(_forbidden_player_keys(child, path=f"{path}[{index}]"))
    return findings


def _apply_secrecy_validation(report: dict[str, Any], audit: dict[str, Any]) -> None:
    forbidden_paths = _forbidden_player_keys(report)
    serialized = _canonical_bytes(report).decode("utf-8")
    leaked_identifiers = [
        identifier for identifier in audit.get("concealed_identifiers") or []
        if isinstance(identifier, str) and identifier and identifier in serialized
    ]
    if not forbidden_paths and not leaked_identifiers:
        return
    findings: list[str] = []
    if forbidden_paths:
        findings.append(
            f"player projection contains {len(forbidden_paths)} forbidden audit/keeper field(s)"
        )
    if leaked_identifiers:
        findings.append(
            f"player projection contains {len(leaked_identifiers)} concealed identifier(s)"
        )
    report["completeness"]["dimensions"]["secrecy"] = {
        "status": "FAIL", "findings": findings,
    }
    report["completeness"]["reasons"].extend(findings)
    report["completeness"]["classification"] = "INCOMPLETE"
    full = audit.get("full_completeness")
    if isinstance(full, dict):
        full["dimensions"]["secrecy"] = {"status": "FAIL", "findings": findings}
        full["reasons"].extend(findings)
        full["classification"] = "INCOMPLETE"


def _player_safe_completeness(value: Any) -> dict[str, Any]:
    """Expose statuses, not internal receipt ids or engineering diagnostics."""
    source = value if isinstance(value, dict) else {}
    dimensions: dict[str, dict[str, Any]] = {}
    for name, row in (source.get("dimensions") or {}).items():
        if not isinstance(row, dict):
            continue
        status = str(row.get("status") or "FAIL")
        dimensions[str(name)] = {
            "status": status,
            "findings": [
                "verification evidence is complete"
                if status == "PASS"
                else "verification evidence is incomplete; details are in the keeper/development audit"
            ],
        }
    classification = str(source.get("classification") or "INCOMPLETE")
    return {
        "classification": classification,
        "claim_scope": source.get("claim_scope"),
        "not_claimed": list(source.get("not_claimed") or []),
        "dimensions": dimensions,
        "dialogue_role_counts": dict(source.get("dialogue_role_counts") or {}),
        "final_transcript_present": source.get("final_transcript_present") is True,
        "reasons": (
            [] if classification == "COMPLETE"
            else ["One or more verification dimensions are incomplete; details are in the keeper/development audit."]
        ),
    }


_PLAYER_ALLOWED_ID_KEYS = {
    "campaign_id", "run_segment_id", "ruleset_id", "model_id",
}


def _strip_player_internal_identity(value: Any) -> Any:
    """Remove machine identities from distribution artifacts, recursively."""
    if isinstance(value, list):
        return [_strip_player_internal_identity(item) for item in value]
    if not isinstance(value, dict):
        return value
    projected: dict[str, Any] = {}
    for raw_key, raw_value in value.items():
        key = str(raw_key)
        if key in _PLAYER_ALLOWED_ID_KEYS:
            projected[key] = _strip_player_internal_identity(raw_value)
            continue
        if (
            key == "id"
            or key.endswith("_id")
            or key.endswith("_ids")
            or key in {
                "source_ref", "source_path", "source_line",
                "settlement_capsule_ref",
            }
            or key.endswith("_sha256")
            or key.endswith("_digest")
        ):
            continue
        projected[key] = _strip_player_internal_identity(raw_value)
    return projected


def _attach_player_display_labels(source: dict[str, Any]) -> None:
    investigator_names: dict[str, str] = {}
    for investigator in source.get("investigators") or []:
        if not isinstance(investigator, dict):
            continue
        investigator_id = str(investigator.get("investigator_id") or "")
        character = investigator.get("character") if isinstance(investigator.get("character"), dict) else {}
        state = investigator.get("state") if isinstance(investigator.get("state"), dict) else {}
        display = _first(character, ("name", "display_name")) or _first(state, ("name", "display_name"))
        if investigator_id and isinstance(display, str) and display.strip():
            investigator_names[investigator_id] = display
            investigator["investigator_display_name"] = display
    for key in ("development_settlements", "first_impressions"):
        for row in source.get(key) or []:
            if not isinstance(row, dict):
                continue
            display = investigator_names.get(str(row.get("investigator_id") or ""))
            if display:
                row["investigator_display_name"] = display
    ending_refs: dict[str, int] = {}
    for settlement in source.get("development_settlements") or []:
        if not isinstance(settlement, dict):
            continue
        ending_id = str(settlement.get("ending_id") or "")
        if ending_id:
            ending_refs.setdefault(ending_id, len(ending_refs) + 1)
            settlement["ending_ordinal"] = ending_refs[ending_id]
    for key in ("social_rolls",):
        for row in source.get(key) or []:
            if isinstance(row, dict):
                actor = str(row.get("actor") or "")
                if actor in investigator_names:
                    row["actor"] = investigator_names[actor]
                elif actor:
                    row["actor"] = "Investigator"
    public = source.get("public_rolls") if isinstance(source.get("public_rolls"), dict) else {}
    for row in public.get("records") or []:
        if not isinstance(row, dict):
            continue
        actor = str(row.get("actor") or "")
        if actor in investigator_names:
            row["actor"] = investigator_names[actor]
        elif actor:
            row["actor"] = "Keeper" if actor.casefold() == "keeper" else "NPC"
        payload = row.get("payload") if isinstance(row.get("payload"), dict) else None
        if payload is not None:
            payload_actor = str(payload.get("actor") or "")
            if payload_actor in investigator_names:
                payload["actor"] = investigator_names[payload_actor]
            elif payload_actor:
                payload["actor"] = (
                    "Keeper" if payload_actor.casefold() == "keeper" else "NPC"
                )


def _collect_projection_identities(value: Any, path: str = "$") -> list[dict[str, Any]]:
    """Audit-only inventory of identities removed from player distribution."""
    rows: list[dict[str, Any]] = []
    if isinstance(value, dict):
        for key in sorted(value):
            child = value[key]
            child_path = f"{path}.{key}"
            if key not in _PLAYER_ALLOWED_ID_KEYS and (
                key == "id" or key.endswith("_id") or key.endswith("_ids")
            ):
                rows.append({"path": child_path, "value": child})
            rows.extend(_collect_projection_identities(child, child_path))
    elif isinstance(value, list):
        for index, child in enumerate(value):
            rows.extend(_collect_projection_identities(child, f"{path}[{index}]"))
    return rows


def _projection_manifest_entry(
    payload: bytes, *, path: str, distribution: str
) -> dict[str, Any]:
    return {
        "path": path,
        "distribution": distribution,
        "bytes": len(payload),
        "sha256": _sha256(payload),
    }


def _verify_projection_artifacts(artifacts: Path) -> list[str]:
    """Verify the emitted non-self-referential manifest/hash convention."""
    audit_dir = artifacts / _AUDIT_DIR_NAME
    findings: list[str] = []
    try:
        manifest = json.loads((audit_dir / "manifest.json").read_text(encoding="utf-8"))
        ledger_lines = (audit_dir / "hashes.sha256").read_text(encoding="utf-8").splitlines()
    except (OSError, json.JSONDecodeError) as exc:
        return [f"projection hash metadata cannot be read: {exc}"]
    ledger: dict[str, str] = {}
    for line in ledger_lines:
        if not line.strip() or "  " not in line:
            findings.append("hashes.sha256 contains a malformed row")
            continue
        digest, relative = line.split("  ", 1)
        ledger[relative] = digest
    expected_ledger = set((manifest.get("files") or {}).keys()) | {"manifest.json"}
    if set(ledger) != expected_ledger:
        findings.append("hashes.sha256 file set does not match manifest payloads plus manifest.json")
    for relative, expected in ledger.items():
        if relative == "hashes.sha256":
            findings.append("hashes.sha256 must exclude itself")
            continue
        if relative in {"../battle-report.md", "../battle-report-evidence.json"}:
            path = audit_dir / relative
        elif relative == "manifest.json" or relative in (manifest.get("files") or {}):
            path = audit_dir / relative
        else:
            findings.append(f"unexpected hash path: {relative}")
            continue
        if not path.is_file() or path.is_symlink():
            findings.append(f"hashed artifact is missing or unsafe: {relative}")
            continue
        actual = _sha256(path.read_bytes())
        if actual != expected:
            findings.append(f"hash mismatch: {relative}")
    for relative, entry in (manifest.get("files") or {}).items():
        if not isinstance(entry, dict):
            findings.append(f"manifest entry is malformed: {relative}")
            continue
        path = audit_dir / relative
        if not path.is_file() or path.is_symlink():
            findings.append(f"manifest artifact is missing or unsafe: {relative}")
            continue
        raw = path.read_bytes()
        if entry.get("path") != relative or entry.get("sha256") != _sha256(raw) or entry.get("bytes") != len(raw):
            findings.append(f"manifest mismatch: {relative}")
    return findings


def export_battle_report(run_dir: Path | str, *, allow_partial: bool = False) -> dict[str, Any]:
    lexical = Path(run_dir).absolute()
    if lexical.is_symlink() or not lexical.is_dir():
        raise ExportError("run directory must be an existing real directory")
    resolved = lexical.resolve()
    source = _source_payload(resolved, allow_partial=allow_partial)
    # The audit channel ships as artifacts/audit/* files only. Neither the
    # player-safe Markdown nor battle-report-evidence.json may contain
    # concealed rolls, sanity internals, or disposition internals.
    audit = source.pop("audit", {})
    source_manifest = source.pop("source_manifest", [])
    audit["source_manifest"] = source_manifest
    full_source_identity = source.get("source_identity") or {}
    audit["source_identity"] = full_source_identity
    source["source_identity"] = {
        key: full_source_identity.get(key)
        for key in (
            "campaign_id", "run_segment_id", "session_id", "plugin_version",
            "ruleset_id", "ruleset_version",
        )
        if full_source_identity.get(key) is not None
    }
    audit["full_completeness"] = json.loads(json.dumps(source.get("completeness") or {}))
    audit["development_settlements"] = json.loads(
        json.dumps(source.get("development_settlements") or [])
    )
    source["completeness"] = _player_safe_completeness(source.get("completeness"))
    identity_material = {
        "schema_version": SCHEMA_VERSION,
        "source_manifest": source_manifest,
        "source_identity": audit.get("source_identity"),
        "source_payload": source,
    }
    report_id = "coc-battle-report-" + _sha256(_canonical_bytes(identity_material))[:24]
    audit["report_id"] = report_id
    _attach_player_display_labels(source)
    audit["projection_source_identities"] = _collect_projection_identities(source)
    report = {
        "schema_version": SCHEMA_VERSION,
        "report_type": "coc_actual_play_battle_report_evidence",
        "markdown_audience": "player_safe",
        **source,
    }
    report = _strip_player_internal_identity(report)
    assert isinstance(report, dict)
    _apply_secrecy_validation(report, audit)
    json_bytes = (_pretty_json(report) + "\n").encode("utf-8")
    markdown_bytes = (_markdown(report).rstrip() + "\n").encode("utf-8")
    artifacts = _safe_artifacts_dir(resolved)
    _atomic_pair(artifacts, {JSON_OUTPUT: json_bytes, MARKDOWN_OUTPUT: markdown_bytes})
    validation = {
        "schema_version": 1,
        "completeness": audit.get("full_completeness"),
        "source_manifest": source_manifest,
        "source_identity": audit.get("source_identity"),
        "finalization_binding": audit.get("finalization_binding"),
        "projection_source_identities": audit.get("projection_source_identities") or [],
        "projection_hash_convention": {
            "manifest_covers": "two player artifacts plus every audit payload except manifest/hashes",
            "hashes_sha256_covers": "manifest entries plus manifest.json; excludes itself",
        },
    }
    audit_outputs: dict[str, bytes] = {
        "rules-audit.md": _render_rules_audit(report, audit).encode("utf-8"),
        "transcript.jsonl": _jsonl_bytes(audit.get("transcript") or []),
        "rolls.jsonl": _jsonl_bytes(_stable_rows(audit.get("rolls_including_concealed") or [])),
        "rule-decisions.jsonl": _jsonl_bytes(audit.get("rule_decisions") or []),
        "social-resolutions.jsonl": _jsonl_bytes(audit.get("social_resolutions") or []),
        "psychology-hidden.jsonl": _jsonl_bytes(audit.get("psychology_hidden") or []),
        "scene-budget.jsonl": _jsonl_bytes(audit.get("scene_budget") or []),
        "narration-revisions.jsonl": _jsonl_bytes(audit.get("narration_revisions") or []),
        "state-diffs.jsonl": _jsonl_bytes(audit.get("state_diffs") or []),
        "sanity-events.jsonl": _jsonl_bytes(audit.get("sanity_events") or []),
        "settlements.json": (_pretty_json(
            {"development_settlements": audit.get("development_settlements") or []}
        ) + "\n").encode("utf-8"),
        "dispositions.json": (_pretty_json(
            {"dispositions": audit.get("dispositions") or {}}
        ) + "\n").encode("utf-8"),
        "report-validation.json": (_pretty_json(validation) + "\n").encode("utf-8"),
    }
    audit_dir = _safe_audit_dir(artifacts)
    _atomic_pair(audit_dir, audit_outputs)
    manifest_files = {
        "../battle-report-evidence.json": _projection_manifest_entry(
            json_bytes,
            path="../battle-report-evidence.json",
            distribution="player",
        ),
        "../battle-report.md": _projection_manifest_entry(
            markdown_bytes,
            path="../battle-report.md",
            distribution="player",
        ),
        **{
            name: _projection_manifest_entry(
                payload, path=name, distribution="keeper_development_audit"
            )
            for name, payload in audit_outputs.items()
        },
    }
    manifest_bytes = (_pretty_json({
        "schema_version": 1,
        "report_id": report_id,
        "files": dict(sorted(manifest_files.items())),
    }) + "\n").encode("utf-8")
    hashes_entries = {
        relative: entry["sha256"] for relative, entry in manifest_files.items()
    }
    hashes_entries["manifest.json"] = _sha256(manifest_bytes)
    hashes_bytes = "".join(
        f"{digest}  {relative}\n"
        for relative, digest in sorted(hashes_entries.items())
    ).encode("utf-8")
    _atomic_pair(audit_dir, {
        "manifest.json": manifest_bytes,
        "hashes.sha256": hashes_bytes,
    })
    hash_findings = _verify_projection_artifacts(artifacts)
    if hash_findings:
        raise ExportError("projection hash verification failed: " + "; ".join(hash_findings))
    return report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("run_dir", type=Path, help="real COC playtest run directory")
    parser.add_argument(
        "--allow-partial",
        action="store_true",
        help="render partial-transcript.jsonl as an explicitly INCOMPLETE report",
    )
    args = parser.parse_args(argv)
    try:
        report = export_battle_report(args.run_dir, allow_partial=args.allow_partial)
    except (ExportError, OSError) as exc:
        parser.exit(2, f"error: {exc}\n")
    print(
        json.dumps(
            {
                "classification": report["completeness"]["classification"],
                "outputs": [
                    f"artifacts/{JSON_OUTPUT}",
                    f"artifacts/{MARKDOWN_OUTPUT}",
                ],
            },
            ensure_ascii=False,
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
