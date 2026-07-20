"""Keeper adapter: spawn a skills-enabled Pi coding agent for one keeper turn.

Pi runs the same architecture as Codex/Claude Code/Cursor hosts: the keeper
LLM reads the canonical ``plugins/coc-keeper/skills`` tree and drives the
turn by calling ``coc_toolbox.py`` over shell. This adapter is a thin host
shell — no alternate narration envelope or template fallback. It validates
the canonical settled-turn finalization before returning exact player text.
Failures raise; the caller decides whether to retry (network/timeout level
only).
"""
from __future__ import annotations

import hashlib
import json
import re
import subprocess
from pathlib import Path
from typing import Any

KEEPER_REQUEST_KEYS = (
    "workspace",
    "campaign_id",
    "player_input",
    "play_language",
)
FINALIZATION_FIELDS = frozenset({
    "schema_version", "finalization_id", "decision_id", "journal_decision_id",
    "journal_call_index", "source_start_index", "source_end_index",
    "source_digest", "source_roll_ids", "obligation_ids", "coverage_ids",
    "draft_sha256", "coverage_sha256", "bundle_sha256", "rendered_sha256",
    "bundle", "coverage", "segments", "rendered_text", "integrity_digest",
})
FINALIZATION_PROJECTION_FIELDS = frozenset({
    "finalization_id", "journal_decision_id", "rendered_sha256",
    "integrity_digest", "segments",
})
FINALIZATION_SEGMENT_TYPES = frozenset({
    "fiction", "public_check", "state_delta", "exceptional_effect",
})
_DIGEST_RE = re.compile(r"sha256:[0-9a-f]{64}")


class KeeperAdapterError(RuntimeError):
    """A keeper process/transport failure that may be safe to retry."""

    kind = "keeper_adapter_failed"
    turn_committed = False


class KeeperFinalizationError(KeeperAdapterError):
    """The agent may have settled state, but exact output was blocked."""

    kind = "keeper_finalization_blocked"
    turn_committed = True

    def __init__(self, message: str, *, reason: str | None = None) -> None:
        self.reason = reason
        super().__init__(message)


def _canonical_digest(value: Any) -> str:
    encoded = json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")
    return f"sha256:{hashlib.sha256(encoded).hexdigest()}"


def _valid_digest(value: Any) -> bool:
    return isinstance(value, str) and _DIGEST_RE.fullmatch(value) is not None


def _validate_segments(
    segments: Any, *, rendered_text: str, draft_sha256: str,
) -> list[dict[str, Any]]:
    if not isinstance(segments, list) or not segments:
        raise KeeperFinalizationError("finalization segments are missing", reason="malformed")
    normalized: list[dict[str, Any]] = []
    seen_source_ids: set[str] = set()
    for segment in segments:
        if not isinstance(segment, dict) or set(segment) != {
            "segment_type", "text", "source_ids",
        }:
            raise KeeperFinalizationError(
                "finalization segment has an invalid shape", reason="malformed"
            )
        segment_type = segment.get("segment_type")
        if segment_type not in FINALIZATION_SEGMENT_TYPES:
            raise KeeperFinalizationError(
                "finalization segment type is invalid", reason="malformed"
            )
        text = segment.get("text")
        source_ids = segment.get("source_ids")
        if not isinstance(text, str) or not text.strip():
            raise KeeperFinalizationError(
                "finalization segment text is empty", reason="malformed"
            )
        if not isinstance(source_ids, list) or not all(
            isinstance(value, str) and value for value in source_ids
        ):
            raise KeeperFinalizationError(
                "finalization segment source ids are invalid", reason="malformed"
            )
        if segment_type == "fiction" and source_ids:
            raise KeeperFinalizationError(
                "fiction segment must not expose source ids", reason="malformed"
            )
        if segment_type != "fiction" and not source_ids:
            raise KeeperFinalizationError(
                "mechanic segment must cite source ids", reason="malformed"
            )
        if any(source_id in seen_source_ids for source_id in source_ids):
            raise KeeperFinalizationError(
                "finalization mechanic source id is duplicated", reason="malformed"
            )
        seen_source_ids.update(source_ids)
        normalized.append({
            "segment_type": segment_type,
            "text": text,
            "source_ids": list(source_ids),
        })
    if normalized[0]["segment_type"] != "fiction":
        raise KeeperFinalizationError(
            "finalization must begin with fiction", reason="malformed"
        )
    if "\n\n".join(row["text"] for row in normalized) != rendered_text:
        raise KeeperFinalizationError(
            "finalization segments do not compose rendered_text",
            reason="rendered_mismatch",
        )
    reconstructed_draft = "\n\n".join(
        row["text"] for row in normalized if row["segment_type"] == "fiction"
    )
    if _canonical_digest(reconstructed_draft) != draft_sha256:
        raise KeeperFinalizationError(
            "finalization fiction hash mismatch", reason="digest_mismatch"
        )
    return normalized


def validate_finalization_receipt(receipt: Any) -> dict[str, Any]:
    """Strictly validate one canonical full turn-finalization receipt."""
    if (
        not isinstance(receipt, dict)
        or set(receipt) != FINALIZATION_FIELDS
        or receipt.get("schema_version") != 1
    ):
        raise KeeperFinalizationError(
            "turn finalization receipt has an invalid shape", reason="malformed"
        )
    for key in (
        "finalization_id", "decision_id", "journal_decision_id", "rendered_text",
    ):
        if not isinstance(receipt.get(key), str) or not receipt[key]:
            raise KeeperFinalizationError(
                f"turn finalization {key} is invalid", reason="malformed"
            )
    for key in (
        "source_digest", "draft_sha256", "coverage_sha256", "bundle_sha256",
        "rendered_sha256", "integrity_digest",
    ):
        if not _valid_digest(receipt.get(key)):
            raise KeeperFinalizationError(
                f"turn finalization {key} is invalid", reason="malformed"
            )
    for key in ("journal_call_index", "source_start_index", "source_end_index"):
        value = receipt.get(key)
        if isinstance(value, bool) or not isinstance(value, int) or value < 0:
            raise KeeperFinalizationError(
                f"turn finalization {key} is invalid", reason="malformed"
            )
    if (
        receipt["source_start_index"] > receipt["source_end_index"]
        or receipt["source_end_index"] != receipt["journal_call_index"]
    ):
        raise KeeperFinalizationError(
            "turn finalization source window is invalid", reason="malformed"
        )
    for key in ("source_roll_ids", "obligation_ids", "coverage_ids"):
        values = receipt.get(key)
        if (
            not isinstance(values, list)
            or not all(isinstance(value, str) and value for value in values)
            or len(values) != len(set(values))
        ):
            raise KeeperFinalizationError(
                f"turn finalization {key} is invalid", reason="malformed"
            )
    if receipt["obligation_ids"] != receipt["coverage_ids"]:
        raise KeeperFinalizationError(
            "turn finalization coverage identity is incomplete", reason="malformed"
        )
    if not isinstance(receipt.get("bundle"), dict) or not isinstance(
        receipt.get("coverage"), list
    ):
        raise KeeperFinalizationError(
            "turn finalization bundle/coverage is invalid", reason="malformed"
        )
    normalized_segments = _validate_segments(
        receipt["segments"],
        rendered_text=receipt["rendered_text"],
        draft_sha256=receipt["draft_sha256"],
    )
    expected_sources: set[tuple[str, str]] = set()
    for segment_type, source_key in (
        ("public_check", "roll_id"),
        ("state_delta", "effect_id"),
        ("exceptional_effect", "event_id"),
    ):
        rows = receipt["bundle"].get(segment_type) or []
        if not isinstance(rows, list):
            raise KeeperFinalizationError(
                "turn finalization bundle mechanic rows are invalid", reason="malformed"
            )
        for row in rows:
            source_id = row.get(source_key) if isinstance(row, dict) else None
            if not isinstance(source_id, str) or not source_id:
                raise KeeperFinalizationError(
                    "turn finalization bundle mechanic source is invalid", reason="malformed"
                )
            expected_sources.add((segment_type, source_id))
    rendered_sources = {
        (segment["segment_type"], source_id)
        for segment in normalized_segments
        if segment["segment_type"] != "fiction"
        for source_id in segment["source_ids"]
    }
    if rendered_sources != expected_sources:
        raise KeeperFinalizationError(
            "turn finalization mechanic placement is incomplete", reason="malformed"
        )
    for value, digest, label in (
        (receipt["coverage"], receipt["coverage_sha256"], "coverage"),
        (receipt["bundle"], receipt["bundle_sha256"], "bundle"),
        (receipt["rendered_text"], receipt["rendered_sha256"], "rendered"),
    ):
        if _canonical_digest(value) != digest:
            raise KeeperFinalizationError(
                f"turn finalization {label} hash mismatch", reason="digest_mismatch"
            )
    body = {key: value for key, value in receipt.items() if key != "integrity_digest"}
    if _canonical_digest(body) != receipt["integrity_digest"]:
        raise KeeperFinalizationError(
            "turn finalization integrity digest mismatch", reason="digest_mismatch"
        )
    return receipt


def finalization_projection(receipt: dict[str, Any]) -> dict[str, Any]:
    validate_finalization_receipt(receipt)
    return {
        "finalization_id": receipt["finalization_id"],
        "journal_decision_id": receipt["journal_decision_id"],
        "rendered_sha256": receipt["rendered_sha256"],
        "integrity_digest": receipt["integrity_digest"],
        "segments": [
            {
                "segment_type": segment["segment_type"],
                "text": segment["text"],
                "source_ids": list(segment["source_ids"]),
            }
            for segment in receipt["segments"]
        ],
    }


def load_new_finalization_receipt(path: Path, offset: int) -> dict[str, Any]:
    """Load exactly one valid receipt appended after a pre-turn byte offset."""
    if isinstance(offset, bool) or not isinstance(offset, int) or offset < 0:
        raise KeeperFinalizationError("finalization offset is invalid", reason="offset_mismatch")
    try:
        with Path(path).open("rb") as handle:
            size = handle.seek(0, 2)
            if offset > size:
                raise KeeperFinalizationError(
                    "finalization offset exceeds log size", reason="offset_mismatch"
                )
            if offset:
                handle.seek(offset - 1)
                if handle.read(1) != b"\n":
                    raise KeeperFinalizationError(
                        "finalization offset is not a row boundary",
                        reason="offset_mismatch",
                    )
            handle.seek(offset)
            payload = handle.read()
    except FileNotFoundError as exc:
        raise KeeperFinalizationError(
            "keeper turn produced no finalization receipt", reason="missing"
        ) from exc
    except OSError as exc:
        raise KeeperFinalizationError(
            "keeper turn finalization log is unreadable", reason="unreadable"
        ) from exc
    try:
        lines = [line for line in payload.decode("utf-8").splitlines() if line.strip()]
    except UnicodeDecodeError as exc:
        raise KeeperFinalizationError(
            "new turn finalization bytes are not UTF-8", reason="malformed"
        ) from exc
    if len(lines) != 1:
        reason = "missing" if not lines else "ambiguous"
        raise KeeperFinalizationError(
            "keeper turn produced no finalization receipt"
            if not lines else "keeper turn produced multiple finalization receipts",
            reason=reason,
        )
    try:
        receipt = json.loads(lines[0])
    except json.JSONDecodeError as exc:
        raise KeeperFinalizationError(
            "new turn finalization receipt is malformed JSON", reason="malformed"
        ) from exc
    return validate_finalization_receipt(receipt)


def _keeper_dir() -> Path:
    return Path(__file__).resolve().parent


def _default_runner() -> Path:
    return _keeper_dir() / "run_keeper_turn.mjs"


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[3]


def default_skills_dir() -> Path:
    return _repo_root() / "plugins" / "coc-keeper" / "skills"


def default_toolbox_path() -> Path:
    return _repo_root() / "plugins" / "coc-keeper" / "scripts" / "coc_toolbox.py"


def _runner_cmd(runner_path: Path) -> list[str]:
    if runner_path.suffix.lower() in {".mjs", ".js"}:
        return ["node", str(runner_path)]
    return [str(runner_path)]


def prepare_keeper_request(request: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(request, dict):
        raise ValueError("keeper_send_turn request must be a dict")
    for key in KEEPER_REQUEST_KEYS:
        if key not in request:
            raise ValueError(f"keeper_send_turn request missing {key!r}")
    prepared = dict(request)
    prepared["workspace"] = str(Path(prepared["workspace"]).resolve())
    prepared["campaign_id"] = str(prepared["campaign_id"])
    finalization_offset = prepared.get("finalization_offset")
    if (
        isinstance(finalization_offset, bool)
        or not isinstance(finalization_offset, int)
        or finalization_offset < 0
    ):
        raise ValueError("finalization_offset must be a non-negative integer")
    if "run_id" in prepared:
        prepared["run_id"] = str(prepared["run_id"]).strip()
        if not prepared["run_id"]:
            raise ValueError("keeper_send_turn run_id must be non-empty when supplied")
    prepared["player_input"] = str(prepared.get("player_input") or "")
    prepared["play_language"] = str(prepared.get("play_language") or "zh-Hans")
    run_policy = str(prepared.get("run_policy") or "single_session")
    if run_policy not in {"single_session", "continue_until_scenario_terminal"}:
        raise ValueError("run_policy must be single_session or continue_until_scenario_terminal")
    prepared["run_policy"] = run_policy
    prepared.setdefault("skills_dir", str(default_skills_dir()))
    prepared.setdefault("toolbox_path", str(default_toolbox_path()))
    tail = prepared.get("transcript_tail")
    if tail is None:
        prepared["transcript_tail"] = []
    elif not isinstance(tail, list):
        raise ValueError("transcript_tail must be a list")
    else:
        safe_tail: list[dict[str, str]] = []
        for item in tail[-12:]:
            if not isinstance(item, dict):
                continue
            role = item.get("role")
            text = item.get("text")
            if role not in {"player", "keeper"} or not isinstance(text, str):
                continue
            if text.strip():
                safe_tail.append({"role": role, "text": text.strip()})
        prepared["transcript_tail"] = safe_tail
    return prepared


def _raise_runner_error(raw: dict[str, Any]) -> None:
    message = str(raw.get("error") or "keeper runner returned ok=false")
    if raw.get("error_code") == KeeperFinalizationError.kind:
        reason = raw.get("error_reason")
        raise KeeperFinalizationError(
            message,
            reason=reason if isinstance(reason, str) and reason else None,
        )
    raise KeeperAdapterError(message)


def _parse_finalization_projection(raw: Any, narration: str) -> dict[str, Any]:
    if not isinstance(raw, dict) or set(raw) != FINALIZATION_PROJECTION_FIELDS:
        raise KeeperFinalizationError(
            "keeper runner finalization projection is invalid", reason="malformed"
        )
    for key in ("finalization_id", "journal_decision_id"):
        if not isinstance(raw.get(key), str) or not raw[key]:
            raise KeeperFinalizationError(
                f"keeper runner finalization {key} is invalid", reason="malformed"
            )
    for key in ("rendered_sha256", "integrity_digest"):
        if not _valid_digest(raw.get(key)):
            raise KeeperFinalizationError(
                f"keeper runner finalization {key} is invalid", reason="malformed"
            )
    segments = _validate_segments(
        raw.get("segments"),
        rendered_text=narration,
        draft_sha256=_canonical_digest("\n\n".join(
            segment.get("text", "")
            for segment in raw.get("segments", [])
            if isinstance(segment, dict) and segment.get("segment_type") == "fiction"
        ))
        if isinstance(raw.get("segments"), list) and raw["segments"]
        else "",
    )
    if _canonical_digest(narration) != raw["rendered_sha256"]:
        raise KeeperFinalizationError(
            "keeper runner rendered hash mismatch", reason="digest_mismatch"
        )
    return {
        "finalization_id": raw["finalization_id"],
        "journal_decision_id": raw["journal_decision_id"],
        "rendered_sha256": raw["rendered_sha256"],
        "integrity_digest": raw["integrity_digest"],
        "segments": segments,
    }


def parse_runner_response(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raise KeeperAdapterError("keeper runner response must be a JSON object")
    if raw.get("ok") is not True:
        _raise_runner_error(raw)
    narration = raw.get("narration")
    if not isinstance(narration, str) or not narration.strip():
        raise KeeperFinalizationError(
            "keeper runner response missing non-empty narration", reason="missing"
        )
    finalization = _parse_finalization_projection(raw.get("finalization"), narration)
    result: dict[str, Any] = {
        "ok": True,
        "narration": narration,
        "finalization": finalization,
    }
    identity = raw.get("model_identity")
    if identity is not None:
        if not (
            isinstance(identity, dict)
            and isinstance(identity.get("provider"), str)
            and identity["provider"].strip()
            and isinstance(identity.get("id"), str)
            and identity["id"].strip()
        ):
            raise KeeperAdapterError("model_identity must contain non-empty provider and id")
        result["model_identity"] = {
            "provider": identity["provider"].strip(),
            "id": identity["id"].strip(),
        }
    usage = raw.get("usage")
    if usage is not None:
        if not isinstance(usage, dict):
            raise KeeperAdapterError("usage must be an object")
        clean: dict[str, int | None] = {}
        for name in ("input_tokens", "output_tokens"):
            count = usage.get(name)
            if count is not None and (isinstance(count, bool) or not isinstance(count, int) or count < 0):
                raise KeeperAdapterError(f"usage {name} must be a non-negative integer or null")
            clean[name] = count
        result["usage"] = clean
    return result


def keeper_send_turn(
    request: dict[str, Any],
    *,
    runner_path: Path | str | None = None,
    timeout_s: float = 900,
) -> dict[str, Any]:
    """Run one full keeper turn through the skills-enabled Pi coding agent."""
    prepared = prepare_keeper_request(request)
    runner = Path(runner_path).resolve() if runner_path is not None else _default_runner()
    if not runner.exists():
        raise KeeperAdapterError(f"keeper runner not found: {runner}")

    cmd = _runner_cmd(runner)
    payload = json.dumps(prepared, ensure_ascii=False)
    try:
        proc = subprocess.run(
            cmd,
            input=payload,
            capture_output=True,
            text=True,
            timeout=timeout_s,
            cwd=prepared["workspace"],
        )
    except subprocess.TimeoutExpired as exc:
        raise KeeperAdapterError(f"keeper runner timed out after {timeout_s}s") from exc
    except FileNotFoundError as exc:
        raise KeeperAdapterError(f"failed to start keeper runner: {cmd[0]}") from exc

    stdout = (proc.stdout or "").strip()
    stderr = (proc.stderr or "").strip()
    if proc.returncode != 0:
        detail = stderr or stdout or f"exit {proc.returncode}"
        parsed: dict[str, Any] | None = None
        if stdout:
            try:
                candidate = json.loads(stdout.splitlines()[-1])
                parsed = candidate if isinstance(candidate, dict) else None
                if isinstance(parsed, dict) and parsed.get("error"):
                    detail = str(parsed["error"])
            except json.JSONDecodeError:
                pass
        if parsed is not None and parsed.get("error_code") == KeeperFinalizationError.kind:
            reason = parsed.get("error_reason")
            raise KeeperFinalizationError(
                f"keeper runner failed: {detail}",
                reason=reason if isinstance(reason, str) and reason else None,
            )
        raise KeeperAdapterError(f"keeper runner failed: {detail}")
    if not stdout:
        raise KeeperAdapterError("keeper runner produced empty stdout")
    try:
        raw = json.loads(stdout.splitlines()[-1])
    except json.JSONDecodeError as exc:
        raise KeeperAdapterError(
            f"keeper runner stdout is not JSON: {stdout[:200]!r}"
        ) from exc
    return parse_runner_response(raw)
