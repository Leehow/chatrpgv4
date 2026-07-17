#!/usr/bin/env python3
"""Record and verify human/Codex review evidence for operator long-play runs."""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


DIMENSIONS = ("rules", "facts", "progression", "style")
DECISIONS = {"pass", "fail"}
CURRENT_PROTOCOL = "operator_codex_black_box_v2"
LEGACY_PROTOCOL = "operator_long_play_v1"
SUBAGENT_PROTOCOL = "codex_subagent_player_v1"
ISSUE_LEDGER_NAME = "operator-issue-ledger.jsonl"
HARD_STOP_ISSUE_CLASSES = {
    "crash_or_cannot_continue",
    "persistent_state_integrity",
    "rules_integrity",
    "spoiler_integrity",
    "evidence_completeness",
}
DEFERRED_ISSUE_CLASSES = {
    "prose_or_style",
    "transition_quality",
    "compound_action_segmentation",
    "other",
}
ISSUE_CLASSES = HARD_STOP_ISSUE_CLASSES | DEFERRED_ISSUE_CLASSES
ISSUE_DISPOSITIONS = {"continue_and_accumulate", "stop_and_fix"}
_SAFE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")


def _read(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _load_sibling(name: str):
    path = Path(__file__).with_name(name)
    spec = importlib.util.spec_from_file_location(f"operator_{path.stem}", path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def validate_review(
    payload: Any, *, run_id: str, player_id: str | None = None
) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise ValueError("operator review must be an object")
    if payload.get("schema_version") != 1:
        raise ValueError("operator review schema_version must be 1")
    protocol = payload.get("protocol")
    if protocol not in {CURRENT_PROTOCOL, LEGACY_PROTOCOL, SUBAGENT_PROTOCOL}:
        raise ValueError(
            "operator review protocol must be operator_codex_black_box_v2"
        )
    if payload.get("run_id") != run_id:
        raise ValueError("operator review run_id does not match the run directory")
    reviewer = payload.get("reviewer")
    if not isinstance(reviewer, dict) or set(reviewer) != {"kind", "id"}:
        raise ValueError("reviewer must contain exactly kind and id")
    if reviewer.get("kind") not in {"human", "codex"}:
        raise ValueError("reviewer.kind must be human or codex")
    if protocol == CURRENT_PROTOCOL and reviewer.get("kind") != "codex":
        raise ValueError(
            "operator_codex_black_box_v2 requires the same main Codex as reviewer"
        )
    if not isinstance(reviewer.get("id"), str) or not reviewer["id"].strip():
        raise ValueError("reviewer.id must be non-empty")
    player: dict[str, str] | None = None
    if protocol == SUBAGENT_PROTOCOL:
        raw_player = payload.get("player")
        if (
            not isinstance(raw_player, dict)
            or set(raw_player) != {"kind", "id"}
            or raw_player.get("kind") != "codex_subagent"
            or not isinstance(raw_player.get("id"), str)
            or not raw_player["id"].strip()
        ):
            raise ValueError("codex subagent review requires an exact player actor")
        if player_id is not None and raw_player["id"] != player_id:
            raise ValueError("codex subagent review player does not match run evidence")
        if reviewer.get("kind") != "codex":
            raise ValueError("codex subagent diagnostic review requires a main Codex reviewer")
        if reviewer["id"].strip() == raw_player["id"]:
            raise ValueError("reviewer and codex subagent player must be separate actors")
        player = {"kind": "codex_subagent", "id": raw_player["id"]}
    elif "player" in payload:
        raise ValueError("player actor is supported only by codex_subagent_player_v1")
    dimensions = payload.get("dimensions")
    if not isinstance(dimensions, dict) or set(dimensions) != set(DIMENSIONS):
        raise ValueError("dimensions must contain rules, facts, progression, and style")
    normalized: dict[str, dict[str, Any]] = {}
    for name in DIMENSIONS:
        row = dimensions[name]
        if not isinstance(row, dict) or set(row) != {"decision", "notes", "evidence_refs"}:
            raise ValueError(f"dimensions.{name} has an invalid shape")
        if row.get("decision") not in DECISIONS:
            raise ValueError(f"dimensions.{name}.decision must be pass or fail")
        if not isinstance(row.get("notes"), str) or not row["notes"].strip():
            raise ValueError(f"dimensions.{name}.notes must be non-empty")
        refs = row.get("evidence_refs")
        if not isinstance(refs, list) or not refs or any(
            not isinstance(ref, str) or not ref.strip() for ref in refs
        ):
            raise ValueError(f"dimensions.{name}.evidence_refs must be a non-empty string list")
        normalized[name] = {
            "decision": row["decision"],
            "notes": row["notes"].strip(),
            "evidence_refs": [ref.strip() for ref in refs],
        }
    status = "approved" if all(
        row["decision"] == "pass" for row in normalized.values()
    ) else "changes_required"
    result = {
        "schema_version": 1,
        "protocol": protocol,
        "run_id": run_id,
        "reviewer": {"kind": reviewer["kind"], "id": reviewer["id"].strip()},
        "status": status,
        "dimensions": normalized,
        "reviewed_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "automated_fact_fidelity_pass": False,
    }
    if player is not None:
        result["player"] = player
    return result


def validate_issue(payload: Any, *, run_id: str) -> dict[str, Any]:
    """Validate one v2 long-run issue and its deterministic stop disposition."""
    if not isinstance(payload, dict):
        raise ValueError("operator issue must be an object")
    required = {
        "schema_version", "protocol", "run_id", "issue_id", "issue_class",
        "occurrence", "disposition", "summary", "turn_refs", "evidence_refs",
    }
    if set(payload) != required:
        raise ValueError("operator issue has missing or unsupported fields")
    if payload.get("schema_version") != 1:
        raise ValueError("operator issue schema_version must be 1")
    if payload.get("protocol") not in {CURRENT_PROTOCOL, SUBAGENT_PROTOCOL}:
        raise ValueError("operator issue protocol is unsupported")
    if payload.get("run_id") != run_id:
        raise ValueError("operator issue run_id does not match the run directory")
    issue_id = payload.get("issue_id")
    if not isinstance(issue_id, str) or not _SAFE_ID.fullmatch(issue_id):
        raise ValueError("operator issue_id must be a stable safe ID")
    issue_class = payload.get("issue_class")
    if issue_class not in ISSUE_CLASSES:
        raise ValueError("operator issue_class is unsupported")
    occurrence = payload.get("occurrence")
    if (
        not isinstance(occurrence, int)
        or isinstance(occurrence, bool)
        or occurrence < 1
    ):
        raise ValueError("operator issue occurrence must be a positive integer")
    disposition = payload.get("disposition")
    if disposition not in ISSUE_DISPOSITIONS:
        raise ValueError("operator issue disposition is unsupported")
    expected_disposition = (
        "stop_and_fix"
        if issue_class in HARD_STOP_ISSUE_CLASSES or occurrence >= 2
        else "continue_and_accumulate"
    )
    if disposition != expected_disposition:
        raise ValueError(
            "operator issue disposition conflicts with the v2 long-run policy"
        )
    summary = payload.get("summary")
    if not isinstance(summary, str) or not summary.strip():
        raise ValueError("operator issue summary must be non-empty")
    normalized_lists: dict[str, list[str]] = {}
    for key in ("turn_refs", "evidence_refs"):
        values = payload.get(key)
        if not isinstance(values, list) or not values or any(
            not isinstance(value, str) or not value.strip() for value in values
        ):
            raise ValueError(f"operator issue {key} must be a non-empty string list")
        normalized_lists[key] = [value.strip() for value in values]
    return {
        "schema_version": 1,
        "protocol": payload["protocol"],
        "run_id": run_id,
        "issue_id": issue_id,
        "issue_class": issue_class,
        "occurrence": occurrence,
        "disposition": disposition,
        "summary": summary.strip(),
        **normalized_lists,
        "recorded_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }


def record_issue(run_dir: Path, input_path: Path) -> Path:
    """Append one validated issue; partial/crashed runs need no final metadata."""
    run_dir = run_dir.resolve()
    run_dir.mkdir(parents=True, exist_ok=True)
    ledger = run_dir / ISSUE_LEDGER_NAME
    existing: list[dict[str, Any]] = []
    if ledger.exists():
        for line_number, line in enumerate(
            ledger.read_text(encoding="utf-8").splitlines(), start=1
        ):
            if not line.strip():
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError as exc:
                raise ValueError(
                    f"operator issue ledger line {line_number} is malformed"
                ) from exc
            if not isinstance(row, dict):
                raise ValueError(
                    f"operator issue ledger line {line_number} is not an object"
                )
            existing.append(row)
    issue = validate_issue(_read(input_path), run_id=run_dir.name)
    if any(row.get("issue_id") == issue["issue_id"] for row in existing):
        raise ValueError("operator issue_id already exists in the ledger")
    expected_occurrence = 1 + sum(
        1 for row in existing if row.get("issue_class") == issue["issue_class"]
    )
    if issue["occurrence"] != expected_occurrence:
        raise ValueError(
            "operator issue occurrence does not follow the existing class ledger"
        )
    with ledger.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(issue, ensure_ascii=False, sort_keys=True) + "\n")
        handle.flush()
        os.fsync(handle.fileno())
    return ledger


def record_review(run_dir: Path, input_path: Path) -> Path:
    run_dir = run_dir.resolve()
    metadata_path = run_dir / "playtest.json"
    metadata = _read(metadata_path)
    if not isinstance(metadata, dict) or not (
        metadata.get("operator_long_play") is True
        or metadata.get("codex_subagent_player") is True
    ):
        raise ValueError("run is not a reviewed Codex protocol artifact")
    subagent_mode = metadata.get("codex_subagent_player") is True
    contract = metadata.get("subagent_player_contract")
    actor = contract.get("actor") if isinstance(contract, dict) else None
    player_id = actor.get("id") if isinstance(actor, dict) else None
    if subagent_mode and not isinstance(player_id, str):
        raise ValueError("codex subagent player contract is invalid")
    review = validate_review(
        _read(input_path),
        run_id=run_dir.name,
        player_id=player_id if subagent_mode else None,
    )
    expected_protocol = metadata.get("operator_review_protocol") or LEGACY_PROTOCOL
    if review["protocol"] != expected_protocol:
        raise ValueError(
            "operator review protocol does not match the run's recorded contract"
        )
    output = run_dir / "operator-review.json"
    output.write_text(json.dumps(review, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    evidence = _load_sibling("coc_playtest_evidence.py")
    evidence_path = run_dir / "evidence.json"
    receipt = _read(evidence_path)
    artifacts = dict(receipt.get("artifacts") or {})
    artifacts["operator_review"] = {
        "path": output.name,
        "sha256": evidence.sha256_path(output),
    }
    receipt["artifacts"] = artifacts
    receipt["operator_long_play"] = True
    if subagent_mode:
        receipt["operator_long_play"] = False
        receipt["codex_subagent_player"] = True
        receipt["subagent_player_contract"] = contract
    evidence.write_evidence_receipt(run_dir, receipt)
    qualified_receipt = evidence.read_evidence_receipt(run_dir)
    reviewed_actual_play = (
        not subagent_mode
        and review["status"] == "approved"
        and qualified_receipt.get("play_kind") == "operator_reviewed_actual_play"
        and qualified_receipt.get("eligible_as_gameplay_evidence") is True
    )
    metadata["operator_review_status"] = review["status"]
    metadata["operator_review_path"] = output.name
    metadata["operator_reviewed_actual_play"] = bool(
        reviewed_actual_play and not subagent_mode
    )
    metadata["codex_subagent_actual_play"] = False
    metadata["eligible_as_gameplay_evidence"] = reviewed_actual_play
    metadata["evidence_reasons"] = list(
        qualified_receipt.get("evidence_reasons") or []
    )
    if subagent_mode:
        metadata["simulation_method"] = (
            "manual_protocol_blind_diagnostic_changes_required"
            if review["status"] == "changes_required"
            else "manual_protocol_blind_diagnostic_reviewed"
        )
    else:
        metadata["simulation_method"] = (
            "operator_reviewed_actual_play"
            if reviewed_actual_play
            else (
                "operator_long_play_changes_required"
                if review["status"] == "changes_required"
                else "operator_long_play_reviewed_unqualified"
            )
        )
    metadata["official_suite_status"] = "NOT_RUN"
    metadata["evidence_disclaimer"] = (
        "The reviewed manual relay remains a protocol-blind diagnostic because "
        "no Codex collaboration receipt attests the player actor."
        if subagent_mode
        else (
            "Structured operator review qualifies this artifact as actual play; "
            "it does not establish nightly or release PASS."
            if reviewed_actual_play
            else "Operator review does not qualify this run as official gameplay evidence."
        )
    )
    metadata_path.write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    # Recording a review changes evidence classification and can therefore
    # switch the canonical report basename.  Rebuild the complete evaluation
    # contract synchronously so callers never observe a newly classified base
    # report with stale/missing schema and dice-completeness receipts.
    _load_sibling("coc_eval_contract.py").compile_report_contract(
        run_dir,
        generate_base_report=True,
    )
    return output


def _main() -> int:
    parser = argparse.ArgumentParser(description="Operator long-play review evidence")
    sub = parser.add_subparsers(dest="command", required=True)
    record = sub.add_parser("record")
    record.add_argument("--run-dir", required=True)
    record.add_argument("--input", required=True)
    verify = sub.add_parser("verify")
    verify.add_argument("--run-dir", required=True)
    issue = sub.add_parser("record-issue")
    issue.add_argument("--run-dir", required=True)
    issue.add_argument("--input", required=True)
    args = parser.parse_args()
    run_dir = Path(args.run_dir)
    if args.command == "record":
        output = record_review(run_dir, Path(args.input))
    elif args.command == "record-issue":
        output = record_issue(run_dir, Path(args.input))
    else:
        output = run_dir / "operator-review.json"
        validated = validate_review(_read(output), run_id=run_dir.resolve().name)
        if validated["status"] == "approved":
            receipt = _load_sibling("coc_playtest_evidence.py").read_evidence_receipt(
                run_dir
            )
            expected_play_kind = (
                "manual_protocol_blind_diagnostic"
                if validated.get("protocol") == SUBAGENT_PROTOCOL
                else "operator_reviewed_actual_play"
            )
            subagent_review = validated.get("protocol") == SUBAGENT_PROTOCOL
            eligibility_matches = (
                receipt.get("eligible_as_gameplay_evidence") is False
                if subagent_review
                else receipt.get("eligible_as_gameplay_evidence") is True
            )
            if receipt.get("play_kind") != expected_play_kind or not eligibility_matches:
                raise ValueError(
                    "approved operator review is not linked to qualifying run evidence"
                )
    print(output)
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
