#!/usr/bin/env python3
"""Compare spoiler-aware and spoiler-blind structured route ledgers.

Classification is accepted only from an artifact-mediated semantic result bound
to the exact request SHA. Free-prose keyword matchers are rejected.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import secrets
import stat
import sys
from pathlib import Path
from typing import Any


SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

ROUTE_CLASSIFICATIONS = frozenset(
    {
        "optional",
        "insufficiently_signposted",
        "mechanically_blocked",
        "reasonably_undiscovered",
    }
)
ARTIFACT_NAMES = ("route-comparison.json", "route-comparison.md")


def request_sha256(request: dict[str, Any]) -> str:
    encoded = json.dumps(
        request, sort_keys=True, separators=(",", ":"), ensure_ascii=False
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _require_dict(value: Any, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError(f"{label} must be an object")
    return value


def _require_list(value: Any, label: str) -> list[Any]:
    if not isinstance(value, list):
        raise ValueError(f"{label} must be a list")
    return value


def _scene_ids(ledger: dict[str, Any]) -> set[str]:
    scenes = _require_list(ledger.get("scenes"), "ledger.scenes")
    ids: set[str] = set()
    for index, scene in enumerate(scenes):
        if not isinstance(scene, dict):
            raise ValueError(f"ledger.scenes[{index}] must be an object")
        scene_id = scene.get("scene_id")
        if not isinstance(scene_id, str) or not scene_id.strip():
            raise ValueError(f"ledger.scenes[{index}].scene_id is required")
        ids.add(scene_id.strip())
    return ids


def _edge_ids(ledger: dict[str, Any]) -> set[str]:
    edges = _require_list(ledger.get("edges"), "ledger.edges")
    ids: set[str] = set()
    for index, edge in enumerate(edges):
        if not isinstance(edge, dict):
            raise ValueError(f"ledger.edges[{index}] must be an object")
        edge_id = edge.get("edge_id")
        if not isinstance(edge_id, str) or not edge_id.strip():
            raise ValueError(f"ledger.edges[{index}].edge_id is required")
        ids.add(edge_id.strip())
    return ids


def build_route_comparison_request(
    run_a_ledger: dict[str, Any],
    run_b_ledger: dict[str, Any],
) -> dict[str, Any]:
    run_a = _require_dict(run_a_ledger, "run_a_ledger")
    run_b = _require_dict(run_b_ledger, "run_b_ledger")
    a_scenes = _scene_ids(run_a)
    b_scenes = _scene_ids(run_b)
    a_edges = _edge_ids(run_a)
    b_edges = _edge_ids(run_b)
    only_a_scenes = sorted(a_scenes - b_scenes)
    only_a_edges = sorted(a_edges - b_edges)
    request = {
        "schema_version": 1,
        "run_a": {
            "scenes": sorted(a_scenes),
            "edges": sorted(a_edges),
        },
        "run_b": {
            "scenes": sorted(b_scenes),
            "edges": sorted(b_edges),
        },
        "run_a_only": {
            "scenes": only_a_scenes,
            "edges": only_a_edges,
        },
        "classification_enum": sorted(ROUTE_CLASSIFICATIONS),
        "expected_output_schema": {
            "required": [
                "evaluator_id",
                "request_sha256",
                "classifications",
            ],
            "classification_required": [
                "route_kind",
                "route_id",
                "classification",
                "evidence_refs",
                "reason",
            ],
        },
    }
    return request


def _reject_keyword_classification(result: dict[str, Any]) -> None:
    method = result.get("classification_method")
    if method is None:
        return
    if method in {"keyword", "prose_keyword", "string_match", "regex"}:
        raise ValueError("prose keyword classification is rejected")
    if method not in {"semantic_evaluator", "artifact_mediated_semantic"}:
        raise ValueError("unsupported classification_method")


def validate_route_comparison_result(
    request: dict[str, Any],
    result: dict[str, Any],
) -> dict[str, Any]:
    req = _require_dict(request, "request")
    res = _require_dict(result, "result")
    _reject_keyword_classification(res)

    expected_sha = request_sha256(req)
    observed_sha = res.get("request_sha256")
    if observed_sha != expected_sha:
        raise ValueError("result request_sha256 does not match request")

    evaluator_id = res.get("evaluator_id")
    if not isinstance(evaluator_id, str) or not evaluator_id.strip():
        raise ValueError("result.evaluator_id is required")

    classifications = _require_list(res.get("classifications"), "result.classifications")
    expected_scenes = list(req.get("run_a_only", {}).get("scenes") or [])
    expected_edges = list(req.get("run_a_only", {}).get("edges") or [])
    expected_keys = {
        ("scene", scene_id) for scene_id in expected_scenes
    } | {("edge", edge_id) for edge_id in expected_edges}

    seen: set[tuple[str, str]] = set()
    normalized: list[dict[str, Any]] = []
    for index, item in enumerate(classifications):
        if not isinstance(item, dict):
            raise ValueError(f"classifications[{index}] must be an object")
        route_kind = item.get("route_kind")
        route_id = item.get("route_id")
        classification = item.get("classification")
        evidence_refs = item.get("evidence_refs")
        reason = item.get("reason")
        if route_kind not in {"scene", "edge"}:
            raise ValueError(f"classifications[{index}].route_kind invalid")
        if not isinstance(route_id, str) or not route_id.strip():
            raise ValueError(f"classifications[{index}].route_id required")
        if classification not in ROUTE_CLASSIFICATIONS:
            raise ValueError(f"classifications[{index}].classification invalid")
        if not isinstance(evidence_refs, list) or not evidence_refs:
            raise ValueError(f"classifications[{index}].evidence_refs required")
        if not isinstance(reason, str) or not reason.strip():
            raise ValueError(f"classifications[{index}].reason required")
        key = (route_kind, route_id.strip())
        if key in seen:
            raise ValueError(f"duplicate classification for {route_kind}:{route_id}")
        seen.add(key)
        normalized.append(
            {
                "route_kind": route_kind,
                "route_id": route_id.strip(),
                "classification": classification,
                "evidence_refs": list(evidence_refs),
                "reason": reason.strip(),
            }
        )

    if seen != expected_keys:
        missing = sorted(expected_keys - seen)
        unexpected = sorted(seen - expected_keys)
        raise ValueError(
            "classifications must cover each Run-A-only route exactly once; "
            f"missing={missing!r} unexpected={unexpected!r}"
        )

    return {
        "schema_version": 1,
        "evaluator_id": evaluator_id.strip(),
        "request_sha256": expected_sha,
        "classification_method": res.get("classification_method")
        or "artifact_mediated_semantic",
        "classifications": normalized,
        "run_a_only": {
            "scenes": expected_scenes,
            "edges": expected_edges,
        },
    }


def _write_artifacts_atomic(run_dir: Path, payload: dict[str, Any], markdown: str) -> dict[str, Path]:
    root = Path(run_dir).resolve(strict=True)
    artifacts = root / "artifacts"
    artifacts.mkdir(mode=0o755, exist_ok=True)
    named = os.stat(artifacts, follow_symlinks=False)
    if not stat.S_ISDIR(named.st_mode) or artifacts.resolve(strict=True) != artifacts:
        raise RuntimeError("unsafe playtest artifacts directory")
    directory_flag = getattr(os, "O_DIRECTORY", None)
    nofollow_flag = getattr(os, "O_NOFOLLOW", None)
    if directory_flag is None or nofollow_flag is None:
        raise RuntimeError("runtime lacks safe artifact write primitives")
    directory_fd = os.open(
        artifacts,
        os.O_RDONLY | directory_flag | nofollow_flag | getattr(os, "O_CLOEXEC", 0),
    )
    identity = (named.st_dev, named.st_ino)
    written: dict[str, Path] = {}

    def verify() -> None:
        opened = os.fstat(directory_fd)
        current = os.stat(artifacts, follow_symlinks=False)
        if (
            not stat.S_ISDIR(opened.st_mode)
            or not stat.S_ISDIR(current.st_mode)
            or (opened.st_dev, opened.st_ino) != identity
            or (current.st_dev, current.st_ino) != identity
        ):
            raise RuntimeError("artifacts directory changed during write")

    try:
        for basename, text in (
            ("route-comparison.json", json.dumps(payload, ensure_ascii=False, indent=2) + "\n"),
            ("route-comparison.md", markdown),
        ):
            verify()
            temp_name = None
            temp_fd = None
            replaced = False
            try:
                for _ in range(16):
                    candidate = f".{basename}.{secrets.token_hex(12)}.tmp"
                    try:
                        temp_fd = os.open(
                            candidate,
                            os.O_WRONLY
                            | os.O_CREAT
                            | os.O_EXCL
                            | nofollow_flag
                            | getattr(os, "O_CLOEXEC", 0),
                            0o600,
                            dir_fd=directory_fd,
                        )
                        temp_name = candidate
                        break
                    except FileExistsError:
                        continue
                if temp_fd is None or temp_name is None:
                    raise RuntimeError("could not allocate route comparison temp file")
                data = text.encode("utf-8")
                view = memoryview(data)
                while view:
                    view = view[os.write(temp_fd, view) :]
                os.fsync(temp_fd)
                os.close(temp_fd)
                temp_fd = None
                verify()
                os.replace(temp_name, basename, src_dir_fd=directory_fd, dst_dir_fd=directory_fd)
                replaced = True
                written[basename] = artifacts / basename
            finally:
                if temp_fd is not None:
                    os.close(temp_fd)
                if temp_name is not None and not replaced:
                    try:
                        os.unlink(temp_name, dir_fd=directory_fd)
                    except FileNotFoundError:
                        pass
        os.fsync(directory_fd)
    finally:
        os.close(directory_fd)
    return written


def _render_markdown(comparison: dict[str, Any]) -> str:
    lines = [
        "# Route Comparison",
        "",
        f"- Evaluator: {comparison['evaluator_id']}",
        f"- Request SHA-256: `{comparison['request_sha256']}`",
        f"- Method: {comparison['classification_method']}",
        "",
        "## Run-A-only Classifications",
        "",
    ]
    if not comparison["classifications"]:
        lines.append("- None; Run B covered every structured Run A scene/edge.")
    else:
        for item in comparison["classifications"]:
            refs = ", ".join(str(ref) for ref in item["evidence_refs"])
            lines.append(
                f"- `{item['route_kind']}:{item['route_id']}` → "
                f"**{item['classification']}** — {item['reason']} "
                f"(evidence: {refs})"
            )
    lines.append("")
    return "\n".join(lines)


def compare_routes(
    run_dir: Path,
    run_a_ledger: dict[str, Any],
    run_b_ledger: dict[str, Any],
    semantic_result: dict[str, Any],
    *,
    request: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Validate semantic classifications and write route comparison artifacts."""
    built_request = request or build_route_comparison_request(run_a_ledger, run_b_ledger)
    comparison = validate_route_comparison_result(built_request, semantic_result)
    markdown = _render_markdown(comparison)
    paths = _write_artifacts_atomic(Path(run_dir), comparison, markdown)
    return {
        "comparison": comparison,
        "request": built_request,
        "artifacts": {name: str(path) for name, path in paths.items()},
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Compare structured playtest route ledgers.")
    parser.add_argument("--run-dir", required=True)
    parser.add_argument("--run-a-ledger", required=True)
    parser.add_argument("--run-b-ledger", required=True)
    parser.add_argument("--semantic-result", required=True)
    parser.add_argument("--request", default=None)
    args = parser.parse_args(argv)

    def _load(path: str) -> dict[str, Any]:
        payload = json.loads(Path(path).read_text(encoding="utf-8"))
        if not isinstance(payload, dict):
            raise ValueError(f"{path} must contain a JSON object")
        return payload

    request = _load(args.request) if args.request else None
    outcome = compare_routes(
        Path(args.run_dir),
        _load(args.run_a_ledger),
        _load(args.run_b_ledger),
        _load(args.semantic_result),
        request=request,
    )
    print(json.dumps(outcome["artifacts"], ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
