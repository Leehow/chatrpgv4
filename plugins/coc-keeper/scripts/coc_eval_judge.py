#!/usr/bin/env python3
"""Focused coding-relay transport for blinded eval-spec-v1 judging."""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from collections.abc import Mapping
from pathlib import Path
from typing import Any


SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import coc_eval_semantic as semantic


SOL_MODEL = "gpt-5.6-sol"
SOL_EVALUATOR = {"provider": "coding-relay", "id": SOL_MODEL}
DEFAULT_BASE_URL = "http://127.0.0.1:18888/v1"
_FORBIDDEN_REQUEST_KEYS = frozenset(
    {
        "baseline",
        "candidate",
        "keeper_secret",
        "keeper_secrets",
        "expected_route",
        "expected_routes",
        "forbidden_outcome",
        "forbidden_outcomes",
        "judge_label_mapping",
        "label_mapping",
        "private_mapping",
    }
)
_BLINDED_REQUEST_KEYS = frozenset(
    {
        "pair_id",
        "labels",
        "public_context",
        "turn_ids",
        "rubric_id",
        "rubric_version",
        "sides",
        "request_sha256",
    }
)


def resolve_api_key(env: Mapping[str, str] | None = None) -> str:
    """Resolve relay auth without exposing or persisting the selected value."""
    values = env if env is not None else os.environ
    return (
        values.get("CODING_RELAY_API_KEY")
        or values.get("OPENAI_API_KEY")
        or "local-coding-relay"
    )


def _validate_blinded_keys(value: Any, *, path: str = "request") -> None:
    if isinstance(value, dict):
        for key, item in value.items():
            normalized = str(key).lower()
            if normalized in _FORBIDDEN_REQUEST_KEYS:
                raise ValueError(f"private field in blinded request: {path}.{key}")
            _validate_blinded_keys(item, path=f"{path}.{key}")
    elif isinstance(value, list):
        for index, item in enumerate(value):
            _validate_blinded_keys(item, path=f"{path}[{index}]")


def build_chat_payload(
    request: dict[str, Any], rubric: dict[str, Any]
) -> dict[str, Any]:
    """Build one blinded A/B JSON-only Chat Completions request."""
    if not isinstance(request, dict) or not isinstance(rubric, dict):
        raise ValueError("request and rubric must be objects")
    if set(request) != _BLINDED_REQUEST_KEYS:
        raise ValueError("blinded request schema mismatch")
    if request.get("labels") != ["A", "B"]:
        raise ValueError("blinded request schema requires A/B labels")
    sides = request.get("sides")
    if not isinstance(sides, dict) or set(sides) != {"A", "B"}:
        raise ValueError("blinded request schema requires A/B sides")
    public_context = request.get("public_context")
    turn_ids = request.get("turn_ids")
    if not isinstance(public_context, dict):
        raise ValueError("blinded request schema requires public_context")
    semantic.validate_public_context(public_context)
    if not isinstance(turn_ids, list) or not turn_ids or not all(
        isinstance(item, str) and item for item in turn_ids
    ):
        raise ValueError("blinded request schema requires turn_ids")
    for side, rows in sides.items():
        if not isinstance(rows, list):
            raise ValueError(f"blinded request schema requires side {side} turns")
        for row in rows:
            if not isinstance(row, dict) or not set(row) <= semantic.PUBLIC_TURN_KEYS:
                raise ValueError("blinded request turn schema mismatch")
            if not all(isinstance(value, str) for value in row.values()):
                raise ValueError("blinded request turn values must be strings")
            if row.get("turn_id") not in turn_ids:
                raise ValueError("blinded request turn_id mismatch")
    request_body = {
        key: value for key, value in request.items() if key != "request_sha256"
    }
    if request.get("request_sha256") != semantic.canonical_sha256(request_body):
        raise ValueError("blinded request_sha256 mismatch")
    if (
        request.get("rubric_id") != rubric.get("rubric_id")
        or request.get("rubric_version") != rubric.get("rubric_version")
    ):
        raise ValueError("blinded request rubric mismatch")
    _validate_blinded_keys(request)
    rubric_payload = {
        "rubric_id": rubric.get("rubric_id"),
        "rubric_version": rubric.get("rubric_version"),
        "description": rubric.get("description"),
        "dimensions": rubric.get("dimensions"),
        "finding_codes": rubric.get("finding_codes"),
    }
    result_contract = {
        "request_sha256": request.get("request_sha256"),
        "winner": "A | B | tie | uncertain",
        "dimension_scores": "object keyed by declared dimension_id",
        "findings": [
            {
                "label": "one declared finding code",
                "turn_id": "one supplied turn_id",
                "side": "A | B",
                "evidence_span": {
                    "start": "zero-based inclusive character offset",
                    "end": "zero-based exclusive character offset",
                },
                "reason": "public evidence only",
            }
        ],
        "reasons": ["at least one concise public-evidence reason"],
    }
    content = json.dumps(
        {
            "request": request,
            "rubric": rubric_payload,
            "result_contract": result_contract,
        },
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return {
        "model": SOL_MODEL,
        "messages": [
            {
                "role": "system",
                "content": (
                    "Evaluate the supplied blinded A/B public turns under the "
                    "declared rubric. Use only supplied public evidence and return "
                    "exactly one JSON object matching result_contract."
                ),
            },
            {"role": "user", "content": content},
        ],
        "response_format": {"type": "json_object"},
    }


def _post_json(
    url: str,
    headers: dict[str, str],
    payload: dict[str, Any],
    timeout: float,
) -> dict[str, Any]:
    if timeout <= 0:
        raise ValueError("timeout must be positive")
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            raw = response.read()
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise RuntimeError(f"Sol judge request failed: {type(exc).__name__}") from exc
    try:
        decoded = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError("Sol judge returned malformed JSON") from exc
    if not isinstance(decoded, dict):
        raise ValueError("Sol judge response must be an object")
    return decoded


def parse_single_json_result(raw: dict[str, Any]) -> dict[str, Any]:
    """Extract exactly one JSON object from a Chat Completions response."""
    if not isinstance(raw, dict):
        raise ValueError("Chat Completions response must be an object")
    choices = raw.get("choices")
    if not isinstance(choices, list) or len(choices) != 1:
        raise ValueError("Chat Completions response requires exactly one choice")
    choice = choices[0]
    message = choice.get("message") if isinstance(choice, dict) else None
    content = message.get("content") if isinstance(message, dict) else None
    if not isinstance(content, str) or not content.strip():
        raise ValueError("Chat Completions choice has no text content")
    try:
        result = json.loads(content)
    except json.JSONDecodeError as exc:
        raise ValueError("Sol judge content must be one JSON object") from exc
    if not isinstance(result, dict):
        raise ValueError("Sol judge content must be one JSON object")
    return result


def invoke_sol_judge(
    request: dict[str, Any],
    rubric: dict[str, Any],
    *,
    base_url: str = DEFAULT_BASE_URL,
    api_key: str,
    timeout_s: float,
) -> dict[str, Any]:
    payload = build_chat_payload(request, rubric)
    raw = _post_json(
        f"{base_url.rstrip('/')}/chat/completions",
        {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        payload,
        timeout_s,
    )
    result = parse_single_json_result(raw)
    result["evaluator"] = dict(SOL_EVALUATOR)
    semantic.validate_judge_result(request, result, rubric=rubric)
    return result
