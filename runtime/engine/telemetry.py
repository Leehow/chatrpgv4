"""Privacy-safe per-turn runtime telemetry and durable receipts."""
from __future__ import annotations

import json
import math
import os
import re
import uuid
from pathlib import Path
from typing import Any, Mapping


TELEMETRY_FIELDS = (
    "intent_ms", "director_ms", "rules_ms", "persistence_ms",
    "player_llm_ms", "narrator_llm_ms", "total_ms", "input_tokens",
    "output_tokens", "fallback", "runner",
)
_SECRET_KEY = re.compile(r"secret|token|password|credential|authorization|cookie|key", re.I)


def _millis(value: Any, name: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0:
        raise ValueError(f"telemetry {name} must be a non-negative finite number")
    return float(value)


def _tokens(value: Any, name: str) -> int | None:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise ValueError(f"telemetry {name} must be a non-negative integer or null")
    return value


def _safe_runner(value: Any) -> dict[str, str]:
    if not isinstance(value, Mapping):
        raise ValueError("telemetry runner must be a mapping")
    safe: dict[str, str] = {}
    for name, kind in value.items():
        if not isinstance(name, str) or not isinstance(kind, str):
            raise ValueError("telemetry runner must contain string labels")
        if _SECRET_KEY.search(name) or _SECRET_KEY.search(kind):
            raise ValueError("telemetry runner must not contain secret material")
        # Runner attestations are identifiers, never command arguments / paths.
        if "/" in kind or "\\" in kind or "\n" in kind or len(kind) > 128:
            raise ValueError("telemetry runner value is not a safe identifier")
        safe[name] = kind
    return safe


def make_telemetry(**values: Any) -> dict[str, Any]:
    """Normalize the exact public telemetry shape; no arbitrary extras."""
    if set(values) != set(TELEMETRY_FIELDS):
        raise ValueError("telemetry must contain exactly the runtime telemetry fields")
    telemetry = {
        name: _millis(values[name], name)
        for name in (
            "intent_ms", "director_ms", "rules_ms", "persistence_ms",
            "player_llm_ms", "narrator_llm_ms", "total_ms",
        )
    }
    telemetry["input_tokens"] = _tokens(values["input_tokens"], "input_tokens")
    telemetry["output_tokens"] = _tokens(values["output_tokens"], "output_tokens")
    if not isinstance(values["fallback"], bool):
        raise ValueError("telemetry fallback must be boolean")
    telemetry["fallback"] = values["fallback"]
    telemetry["runner"] = _safe_runner(values["runner"])
    phase_total = sum(
        telemetry[name] for name in (
            "intent_ms", "director_ms", "rules_ms", "persistence_ms",
            "player_llm_ms", "narrator_llm_ms",
        )
    )
    if telemetry["total_ms"] < phase_total:
        raise ValueError("telemetry total_ms must bound all phase spans")
    return telemetry


def write_receipt(
    campaign_dir: Path | str,
    *,
    session_id: str,
    investigator_id: str,
    telemetry: Mapping[str, Any],
    decision_ids: list[str] | None = None,
) -> Path:
    """Atomically append a reloadable receipt without input, prompts or secrets."""
    clean = make_telemetry(**dict(telemetry))
    if not isinstance(session_id, str) or not session_id or not isinstance(investigator_id, str) or not investigator_id:
        raise ValueError("telemetry receipt requires stable session and investigator IDs")
    ids = list(decision_ids or [])
    if not all(isinstance(value, str) and value for value in ids):
        raise ValueError("telemetry decision_ids must be non-empty strings")
    campaign_root = Path(campaign_dir).resolve(strict=False)
    logs_dir = campaign_root / "logs"
    if logs_dir.exists() and logs_dir.resolve(strict=False) != logs_dir:
        raise ValueError("telemetry logs path escapes campaign directory")
    target = logs_dir / "runtime-telemetry.jsonl"
    target.parent.mkdir(parents=True, exist_ok=True)
    receipt = {
        "schema_version": 1,
        "receipt_id": f"telemetry_{uuid.uuid4().hex}",
        "session_id": session_id,
        "investigator_id": investigator_id,
        "decision_ids": ids,
        "telemetry": clean,
    }
    # ``O_APPEND`` gives one write per record. A campaign turn lock serializes
    # normal callers; this remains safe if an observer writes a separate file.
    encoded = json.dumps(receipt, ensure_ascii=False, separators=(",", ":"), allow_nan=False) + "\n"
    fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
    try:
        os.write(fd, encoded.encode("utf-8"))
    finally:
        os.close(fd)
    return target


def read_receipts(campaign_dir: Path | str) -> list[dict[str, Any]]:
    """Load only fully-valid historical telemetry receipts, oldest first."""
    campaign_root = Path(campaign_dir).resolve(strict=False)
    logs_dir = campaign_root / "logs"
    if logs_dir.exists() and logs_dir.resolve(strict=False) != logs_dir:
        raise ValueError("telemetry logs path escapes campaign directory")
    target = logs_dir / "runtime-telemetry.jsonl"
    if not target.exists():
        return []
    receipts: list[dict[str, Any]] = []
    for line in target.read_text(encoding="utf-8").splitlines():
        try:
            row = json.loads(line)
            if not isinstance(row, dict) or set(row) != {
                "schema_version", "receipt_id", "session_id", "investigator_id",
                "decision_ids", "telemetry",
            }:
                continue
            if row["schema_version"] != 1 or not isinstance(row["receipt_id"], str):
                continue
            if not isinstance(row["session_id"], str) or not isinstance(row["investigator_id"], str):
                continue
            if not isinstance(row["decision_ids"], list) or not all(isinstance(item, str) for item in row["decision_ids"]):
                continue
            clean = make_telemetry(**row["telemetry"])
            receipts.append({**row, "telemetry": clean})
        except (OSError, UnicodeDecodeError, json.JSONDecodeError, TypeError, ValueError):
            continue
    return receipts


__all__ = ["TELEMETRY_FIELDS", "make_telemetry", "read_receipts", "write_receipt"]
