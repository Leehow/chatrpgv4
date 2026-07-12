#!/usr/bin/env python3
"""Host-parity normalization and fixed replay divergence for eval-spec-v1."""
from __future__ import annotations

import hashlib
import json
import os
import re
import tempfile
from pathlib import Path
from typing import Any


EVAL_SPEC = "eval-spec-v1"
HOST_IDS = ("codex", "zcode", "cursor", "ci", "local")
CLASSIFICATIONS = frozenset({"allowed", "beneficial", "regression"})
STRUCTURAL_FIELDS = (
    "scene",
    "rules_request",
    "state_sha256",
    "reveal_set",
    "pending_choice_revision",
)

# Explicit allowlist of volatile *labelled* provenance patterns only.
# These never scan free narration for meaning.
_VOLATILE_LINE_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"^(-\s*Host:\s*).+$", re.IGNORECASE),
    re.compile(r"^(-\s*Run ID:\s*).+$", re.IGNORECASE),
    re.compile(r"^(-\s*Started at:\s*).+$", re.IGNORECASE),
    re.compile(r"^(-\s*Completed at:\s*).+$", re.IGNORECASE),
    re.compile(r"^(-\s*Duration seconds:\s*).+$", re.IGNORECASE),
    re.compile(r"^(-\s*Absolute path:\s*).+$", re.IGNORECASE),
)
_ISO_TIMESTAMP = re.compile(
    r"\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?\b"
)
_ABSOLUTE_PATH = re.compile(r"(?<![A-Za-z0-9_])/(?:tmp|var|Users|home)/[^\s]+")
_DURATION_VALUE = re.compile(
    r"(Duration seconds:\s*)([0-9]+(?:\.[0-9]+)?)", re.IGNORECASE
)
_HOST_VALUE = re.compile(
    r"(Host:\s*)(" + "|".join(re.escape(item) for item in HOST_IDS) + r")\b",
    re.IGNORECASE,
)
_RUN_ID_VALUE = re.compile(r"(Run ID:\s*)(\S+)", re.IGNORECASE)


def _write_text_atomic(path: Path, text: str) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            "w",
            encoding="utf-8",
            dir=path.parent,
            prefix=f".{path.name}.",
            suffix=".tmp",
            delete=False,
        ) as handle:
            temp_path = Path(handle.name)
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_path, path)
        temp_path = None
    finally:
        if temp_path is not None:
            try:
                temp_path.unlink(missing_ok=True)
            except OSError:
                pass
    return path


def _write_json_atomic(path: Path, payload: Any) -> Path:
    return _write_text_atomic(
        path,
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
    )


def normalize_report_for_host_parity(text: str) -> str:
    """Normalize only explicitly volatile provenance labels for host parity."""
    if not isinstance(text, str):
        raise TypeError("report text must be a string")
    lines: list[str] = []
    for line in text.splitlines():
        replaced = line
        for pattern in _VOLATILE_LINE_PATTERNS:
            match = pattern.match(replaced)
            if match:
                label = match.group(1)
                if re.search(r"Host:\s*", label, re.IGNORECASE):
                    replaced = f"{label}<HOST>"
                elif re.search(r"Run ID:\s*", label, re.IGNORECASE):
                    replaced = f"{label}<RUN_ID>"
                elif re.search(r"Started at:\s*", label, re.IGNORECASE):
                    replaced = f"{label}<TIMESTAMP>"
                elif re.search(r"Completed at:\s*", label, re.IGNORECASE):
                    replaced = f"{label}<TIMESTAMP>"
                elif re.search(r"Duration seconds:\s*", label, re.IGNORECASE):
                    replaced = f"{label}<DURATION>"
                elif re.search(r"Absolute path:\s*", label, re.IGNORECASE):
                    replaced = f"{label}<ABS_PATH>"
                break
        replaced = _HOST_VALUE.sub(r"\1<HOST>", replaced)
        replaced = _RUN_ID_VALUE.sub(r"\1<RUN_ID>", replaced)
        replaced = _DURATION_VALUE.sub(r"\1<DURATION>", replaced)
        replaced = _ISO_TIMESTAMP.sub("<TIMESTAMP>", replaced)
        replaced = _ABSOLUTE_PATH.sub("<ABS_PATH>", replaced)
        lines.append(replaced)
    return "\n".join(lines) + ("\n" if text.endswith("\n") else "")


def normalized_report_sha256(path: Path | str) -> str:
    report_path = Path(path)
    text = report_path.read_text(encoding="utf-8")
    normalized = normalize_report_for_host_parity(text)
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def _canonical_structural(value: Any) -> Any:
    if isinstance(value, list):
        return [_canonical_structural(item) for item in value]
    if isinstance(value, dict):
        return {
            str(key): _canonical_structural(value[key])
            for key in sorted(value)
        }
    return value


def _first_structural_divergence(
    baseline_turn: dict[str, Any],
    candidate_turn: dict[str, Any],
) -> str | None:
    for field in STRUCTURAL_FIELDS:
        if _canonical_structural(baseline_turn.get(field)) != _canonical_structural(
            candidate_turn.get(field)
        ):
            return field
    return None


def run_fixed_replay(
    case: dict[str, Any],
    *,
    root: Path | str,
    output: Path | str,
) -> dict[str, Any]:
    """Compare structured turn evidence and record the first divergence."""
    del root  # reserved for future fixture resolution against the repo root
    if not isinstance(case, dict):
        raise ValueError("fixed replay case must be an object")
    if case.get("schema_version") != 1 or case.get("eval_spec") != EVAL_SPEC:
        raise ValueError("invalid fixed replay case identity")
    case_id = case.get("case_id")
    if not isinstance(case_id, str) or not case_id:
        raise ValueError("fixed replay case_id is required")
    baseline_turns = case.get("baseline_turns")
    candidate_turns = case.get("candidate_turns")
    if not isinstance(baseline_turns, list) or not isinstance(candidate_turns, list):
        raise ValueError("baseline_turns and candidate_turns must be lists")
    classifications = case.get("divergence_classifications")
    if not isinstance(classifications, dict):
        raise ValueError("divergence_classifications must be an object")

    out = Path(output)
    artifacts = out / "artifacts"
    artifacts.mkdir(parents=True, exist_ok=True)
    diffs_path = artifacts / "state-diffs.jsonl"

    first_divergence: dict[str, Any] | None = None
    diff_rows: list[dict[str, Any]] = []
    pair_count = min(len(baseline_turns), len(candidate_turns))
    for index in range(pair_count):
        baseline_turn = baseline_turns[index]
        candidate_turn = candidate_turns[index]
        if not isinstance(baseline_turn, dict) or not isinstance(candidate_turn, dict):
            raise ValueError("replay turns must be objects")
        field = _first_structural_divergence(baseline_turn, candidate_turn)
        if field is None:
            continue
        decision_id = candidate_turn.get("decision_id")
        if not isinstance(decision_id, str) or not decision_id:
            decision_id = baseline_turn.get("decision_id")
        if not isinstance(decision_id, str) or not decision_id:
            raise ValueError("diverged turn missing decision_id")
        classification = classifications.get(decision_id)
        if classification not in CLASSIFICATIONS:
            raise ValueError(
                f"divergence classification missing or invalid for {decision_id}"
            )
        baseline_state = baseline_turn.get("state_sha256")
        candidate_state = candidate_turn.get("state_sha256")
        if not isinstance(baseline_state, str) or not isinstance(candidate_state, str):
            raise ValueError("diverged turn missing state_sha256")
        turn_number = baseline_turn.get("turn", index + 1)
        row = {
            "turn": turn_number,
            "decision_id": decision_id,
            "baseline_state_sha256": baseline_state,
            "candidate_state_sha256": candidate_state,
            "classification": classification,
        }
        diff_rows.append(row)
        first_divergence = {
            "turn": turn_number,
            "decision_id": decision_id,
            "field": field,
            "classification": classification,
        }
        break

    if first_divergence is None and len(baseline_turns) != len(candidate_turns):
        raise ValueError("turn list lengths diverge without a structural field split")

    _write_text_atomic(
        diffs_path,
        "".join(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n" for row in diff_rows),
    )
    status = "PASS"
    if first_divergence is not None and first_divergence["classification"] == "regression":
        status = "FAIL"
    result = {
        "schema_version": 1,
        "eval_spec": EVAL_SPEC,
        "case_id": case_id,
        "status": status,
        "first_divergence": first_divergence,
        "state_diffs_path": str(diffs_path),
        "artifact_hashes": {
            "state_diffs_jsonl": hashlib.sha256(
                diffs_path.read_bytes()
            ).hexdigest(),
        },
    }
    _write_json_atomic(artifacts / "fixed-replay-result.json", result)
    return result
