#!/usr/bin/env python3
"""Derive eval-spec-v1 comparison metrics from bound structured run evidence."""
from __future__ import annotations

import hashlib
import json
import math
import os
import tempfile
from collections import Counter
from pathlib import Path
from typing import Any


EVAL_SPEC = "eval-spec-v1"
METRIC_RESULTS_PATH = Path("artifacts/metric-results.json")


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _write_text_atomic(path: Path, text: str) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            "w", encoding="utf-8", dir=path.parent,
            prefix=f".{path.name}.", suffix=".tmp", delete=False,
        ) as handle:
            temporary = Path(handle.name)
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
        temporary = None
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
    return path


def _read_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        return None


def _read_jsonl(path: Path) -> list[dict[str, Any]] | None:
    rows: list[dict[str, Any]] = []
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except (OSError, UnicodeError):
        return None
    for line in lines:
        if not line.strip():
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            return None
        if not isinstance(row, dict):
            return None
        rows.append(row)
    return rows


def _percentile(values: list[float], probability: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    if len(ordered) == 1:
        return ordered[0]
    position = min(1.0, max(0.0, probability)) * (len(ordered) - 1)
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return ordered[lower]
    weight = position - lower
    return ordered[lower] * (1.0 - weight) + ordered[upper] * weight


def _route_ids(turn: dict[str, Any]) -> tuple[str, ...]:
    frame = turn.get("choice_frame")
    if not isinstance(frame, dict):
        return ()
    direct = frame.get("open_route_ids")
    if isinstance(direct, list):
        return tuple(sorted(str(value) for value in direct if value not in (None, "")))
    values: list[str] = []
    for route in frame.get("routes") or []:
        if not isinstance(route, dict):
            continue
        route_id = route.get("route_id") or route.get("route") or route.get("id")
        if route_id not in (None, ""):
            values.append(str(route_id))
    return tuple(sorted(set(values)))


def _has_structured_progress(turn: dict[str, Any]) -> bool:
    if turn.get("scene_transition") is True or isinstance(turn.get("pending_choice"), dict):
        return True
    frame = turn.get("choice_frame")
    if isinstance(frame, dict) and frame.get("is_real_fork") is True:
        return True
    return any(
        isinstance(turn.get(field), list) and bool(turn[field])
        for field in (
            "clue_revealed",
            "rule_results",
            "subsystem_results",
            "storylet_moves",
            "incident_moves",
            "npc_moves",
        )
    )


def _structural_stalls(rows: list[dict[str, Any]]) -> tuple[int, int]:
    stalled = 0
    total = 0
    previous: dict[str, Any] | None = None
    for row in rows:
        turn = row.get("keeper_turn") if isinstance(row.get("keeper_turn"), dict) else row
        if not isinstance(turn, dict):
            continue
        total += 1
        if previous is not None:
            same_scene = (
                turn.get("scene_id") not in (None, "")
                and turn.get("scene_id") == previous.get("scene_id")
            )
            same_routes = _route_ids(turn) == _route_ids(previous)
            if same_scene and same_routes and not _has_structured_progress(turn):
                stalled += 1
        previous = turn
    return stalled, total


def _add_completeness_findings(counts: Counter[str], receipt: Any) -> None:
    if not isinstance(receipt, dict):
        counts["report_contract_failed"] += 1
        return
    mapped = 0
    mappings = (
        ("missing_required_public_roll", "missing_roll_ids"),
        ("duplicate_rendered_roll", "duplicate_roll_ids"),
        ("duplicate_rendered_roll", "duplicate_source_roll_ids"),
        ("untraced_rendered_roll", "untraced_roll_ids"),
        ("malformed_evidence_jsonl", "incomplete_required_public_roll_ids"),
        ("malformed_evidence_jsonl", "missing_source_comment_roll_ids"),
        ("malformed_evidence_jsonl", "parse_errors"),
    )
    for finding_id, field in mappings:
        values = receipt.get(field)
        count = len(values) if isinstance(values, list) else 0
        counts[finding_id] += count
        mapped += count
    if receipt.get("source_logs_present") is False:
        counts["malformed_evidence_jsonl"] += 1
        mapped += 1
    if receipt.get("passed") is not True and mapped == 0:
        counts["report_contract_failed"] += 1


def _add_manifest_findings(counts: Counter[str], manifest: Any) -> None:
    if not isinstance(manifest, dict):
        counts["malformed_evidence_jsonl"] += 1
        return
    for finding in manifest.get("hard_findings") or []:
        if isinstance(finding, str) and finding:
            counts[finding] += 1


def _safe_evidence_file(root: Path, path: Path) -> bool:
    if path.is_symlink() or not path.is_file():
        return False
    try:
        path.resolve().relative_to(root.resolve())
    except ValueError:
        return False
    return True


def collect_metric_results(
    output: Path | str,
    lanes: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    """Aggregate only structured lane payloads and their bound artifact trees."""
    root = Path(output).resolve()
    hard: Counter[str] = Counter()
    completion_done = 0
    completion_total = 0
    stalled_turns = 0
    measured_turns = 0
    invocation_count = 0
    fallback_count = 0
    player_turns = 0
    durations: list[float] = []
    token_total = 0
    usage_invocations = 0
    source_paths: dict[str, str] = {}
    semantic_gates: Counter[str] = Counter()

    def bind(path: Path) -> None:
        if _safe_evidence_file(root, path):
            source_paths[path.relative_to(root).as_posix()] = _sha256(path)

    def consume_ledger(path: Path) -> None:
        nonlocal invocation_count, fallback_count, player_turns
        nonlocal token_total, usage_invocations
        if not _safe_evidence_file(root, path):
            hard["malformed_evidence_jsonl"] += 1
            return
        rows = _read_jsonl(path)
        bind(path)
        if rows is None:
            hard["malformed_evidence_jsonl"] += 1
            return
        for row in rows:
            invocation_count += 1
            if row.get("role") == "player":
                player_turns += 1
            if row.get("fallback_kind") not in (None, ""):
                fallback_count += 1
            duration = row.get("duration_seconds")
            if (
                type(duration) in (int, float)
                and not isinstance(duration, bool)
                and math.isfinite(float(duration))
                and float(duration) >= 0
            ):
                durations.append(float(duration))
            usage = row.get("usage")
            if not isinstance(usage, dict):
                continue
            values = (usage.get("input_tokens"), usage.get("output_tokens"))
            if all(type(value) is int and value >= 0 for value in values):
                token_total += int(values[0]) + int(values[1])
                usage_invocations += 1

    matrix_root = root / "lanes" / "matrix"
    cells_root = matrix_root / "cells"
    if cells_root.is_dir() and not cells_root.is_symlink():
        for cell_dir in sorted(cells_root.iterdir()):
            if cell_dir.is_symlink() or not cell_dir.is_dir():
                hard["malformed_evidence_jsonl"] += 1
                continue
            manifest_path = cell_dir / "run-manifest.json"
            manifest = _read_json(manifest_path) if _safe_evidence_file(root, manifest_path) else None
            bind(manifest_path)
            _add_manifest_findings(hard, manifest)
            receipt = (
                manifest.get("evaluation_contract_receipt")
                if isinstance(manifest, dict) else None
            )
            if isinstance(receipt, dict):
                completion_total += 1
                completion_done += int(receipt.get("reached_terminal") is True)
            completeness_path = cell_dir / "playtest" / "artifacts" / "report-completeness.json"
            completeness = (
                _read_json(completeness_path)
                if _safe_evidence_file(root, completeness_path) else None
            )
            bind(completeness_path)
            _add_completeness_findings(hard, completeness)
            keeper_path = cell_dir / "keeper-view.jsonl"
            if _safe_evidence_file(root, keeper_path):
                rows = _read_jsonl(keeper_path)
                bind(keeper_path)
                if rows is None:
                    hard["malformed_evidence_jsonl"] += 1
                else:
                    stalled, total = _structural_stalls(rows)
                    stalled_turns += stalled
                    measured_turns += total
            consume_ledger(cell_dir / "runner-invocations.jsonl")
    matrix_lane = lanes.get("matrix")
    if isinstance(matrix_lane, dict):
        for cell in matrix_lane.get("cells") or []:
            if not isinstance(cell, dict):
                continue
            for gate in cell.get("judge_gates") or []:
                if isinstance(gate, dict) and isinstance(gate.get("status"), str):
                    semantic_gates[gate["status"]] += 1

    for lane_id in ("continuity-25", "continuity-50"):
        lane = lanes.get(lane_id)
        if not isinstance(lane, dict):
            continue
        expected = lane.get("turn_count")
        accepted = lane.get("accepted_turns")
        if type(expected) is int and expected > 0 and isinstance(accepted, list):
            completion_total += expected
            completion_done += min(expected, len({value for value in accepted if type(value) is int}))
        for finding in lane.get("findings") or []:
            if isinstance(finding, str) and finding:
                hard[finding] += 1
            elif isinstance(finding, dict) and isinstance(finding.get("code"), str):
                hard[finding["code"]] += 1
        lane_root = root / "lanes" / lane_id
        if lane_root.is_dir() and not lane_root.is_symlink():
            for path in sorted(lane_root.glob("segments/*/runner-invocations.jsonl")):
                consume_ledger(path)
            for path in sorted(lane_root.glob("segments/*/keeper-view.jsonl")):
                if not _safe_evidence_file(root, path):
                    hard["malformed_evidence_jsonl"] += 1
                    continue
                rows = _read_jsonl(path)
                bind(path)
                if rows is None:
                    hard["malformed_evidence_jsonl"] += 1
                else:
                    stalled, total = _structural_stalls(rows)
                    stalled_turns += stalled
                    measured_turns += total

    registered = lanes.get("registered-cases")
    if isinstance(registered, dict):
        for case in registered.get("cases") or []:
            if (
                isinstance(case, dict)
                and case.get("status") == "FAIL"
                and isinstance(case.get("case_id"), str)
            ):
                hard[f"registered_case_failure:{case['case_id']}"] += 1

    completion_rate = completion_done / completion_total if completion_total else 0.0
    stuck_rate = stalled_turns / measured_turns if measured_turns else 0.0
    fallback_rate = fallback_count / invocation_count if invocation_count else 0.0
    tokens_per_turn = token_total / player_turns if player_turns else 0.0
    return {
        "schema_version": 1,
        "eval_spec": EVAL_SPEC,
        "metric_method": "structured-runtime-evidence-v1",
        "hard_findings": [
            {"finding_id": finding_id, "count": count}
            for finding_id, count in sorted(hard.items())
            if count > 0
        ],
        "rates": {
            "completion_rate": round(completion_rate, 6),
            "stuck_turn_rate": round(stuck_rate, 6),
            "fallback_rate": round(fallback_rate, 6),
        },
        "performance": {
            "p95_latency_seconds": round(_percentile(durations, 0.95), 6),
            "tokens_per_turn": round(tokens_per_turn, 6),
        },
        # Subjective A/B judgments remain matrix-owned; this aggregate must not
        # reinterpret one comparative score as an absolute score for either side.
        "subjective": {},
        "accepted_tradeoffs": [],
        "coverage": {
            "completion_units": completion_total,
            "completed_units": completion_done,
            "measured_turns": measured_turns,
            "structural_stall_turns": stalled_turns,
            "invocations": invocation_count,
            "fallback_invocations": fallback_count,
            "latency_samples": len(durations),
            "usage_invocations": usage_invocations,
            "player_turns": player_turns,
            "semantic_judge_gates": dict(sorted(semantic_gates.items())),
        },
        "sources": [
            {"path": path, "sha256": digest}
            for path, digest in sorted(source_paths.items())
        ],
    }


def write_metric_results(
    output: Path | str, payload: dict[str, Any]
) -> Path:
    return _write_text_atomic(
        Path(output) / METRIC_RESULTS_PATH,
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
    )
