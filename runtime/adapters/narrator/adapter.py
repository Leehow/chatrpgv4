"""Narrator adapter: spawn constrained subprocess bridge, parse KP narration."""
from __future__ import annotations

import copy
import json
import subprocess
from pathlib import Path
from typing import Any

NARRATOR_REQUEST_KEYS = (
    "narration_envelope",
    "last_player_text",
    "play_language",
    "recent_narrations",
)

# Planner-side fields that must never reach the narrator model.
_ENVELOPE_DROP_KEYS = frozenset({"rationale", "keeper_secrets", "director_rationale"})


def _narrator_dir() -> Path:
    return Path(__file__).resolve().parent


def _default_runner() -> Path:
    return _narrator_dir() / "run_narration.mjs"


def _runner_cmd(runner_path: Path) -> list[str]:
    """Invoke .mjs/.js via node; otherwise run the path directly (fake runners)."""
    if runner_path.suffix.lower() in {".mjs", ".js"}:
        return ["node", str(runner_path)]
    return [str(runner_path)]


def sanitize_narration_envelope(envelope: Any) -> dict[str, Any]:
    """Return a deep copy of the envelope without planner-only fields.

    The envelope is already spoiler-safe by construction from
    ``build_narration_envelope``; this only drops planner-side rationale and
    any accidental keeper_secrets key.
    """
    if not isinstance(envelope, dict):
        return {}
    def clean(value: Any) -> Any:
        if isinstance(value, dict):
            return {
                key: clean(item)
                for key, item in value.items()
                if key not in _ENVELOPE_DROP_KEYS
            }
        if isinstance(value, list):
            return [clean(item) for item in value]
        return copy.deepcopy(value)
    return clean(envelope)


def prepare_narrator_request(request: dict[str, Any]) -> dict[str, Any]:
    """Validate and sanitize a narrator request before spawning the runner."""
    if not isinstance(request, dict):
        raise ValueError("narrator_send_turn request must be a dict")
    for key in NARRATOR_REQUEST_KEYS:
        if key not in request:
            raise ValueError(f"narrator_send_turn request missing {key!r}")
    prepared = dict(request)
    prepared["narration_envelope"] = sanitize_narration_envelope(
        request.get("narration_envelope")
    )
    recent = prepared.get("recent_narrations")
    if recent is None:
        prepared["recent_narrations"] = []
    elif not isinstance(recent, list):
        raise ValueError("recent_narrations must be a list")
    else:
        prepared["recent_narrations"] = [str(x) for x in recent[-2:]]
    prepared["last_player_text"] = str(prepared.get("last_player_text") or "")
    prepared["play_language"] = str(prepared.get("play_language") or "zh-Hans")
    review_mode = prepared.get("review_mode")
    if review_mode is not None and review_mode != "operator_long_play":
        raise ValueError("review_mode must be operator_long_play when present")
    public_tail = prepared.get("public_transcript_tail")
    if public_tail is None:
        prepared["public_transcript_tail"] = []
    elif not isinstance(public_tail, list):
        raise ValueError("public_transcript_tail must be a list")
    else:
        safe_tail: list[dict[str, str]] = []
        for item in public_tail[-8:]:
            if not isinstance(item, dict):
                continue
            role = item.get("role")
            text = item.get("text")
            if role not in {"player", "keeper"} or not isinstance(text, str):
                continue
            if text.strip():
                safe_tail.append({"role": role, "text": text.strip()})
        prepared["public_transcript_tail"] = safe_tail
    return prepared


def parse_runner_response(raw: dict[str, Any]) -> dict[str, Any]:
    """Validate runner JSON envelope and return final_text (+ optional notes)."""
    if not isinstance(raw, dict):
        raise RuntimeError("narrator runner response must be a JSON object")
    if raw.get("ok") is not True:
        err = raw.get("error") or "narrator runner returned ok=false"
        raise RuntimeError(str(err))
    final_text = raw.get("final_text")
    if not isinstance(final_text, str) or not final_text.strip():
        raise RuntimeError("narrator runner response missing non-empty final_text string")
    result: dict[str, Any] = {"ok": True, "final_text": final_text}
    asserted_present = "asserted_fact_refs" in raw
    semantic_present = "semantic_audit" in raw
    asserted = raw.get("asserted_fact_refs")
    semantic = raw.get("semantic_audit")
    if asserted_present and not (
        isinstance(asserted, list)
        and all(isinstance(value, str) and value.strip() for value in asserted)
    ):
        raise RuntimeError("asserted_fact_refs must be a list of non-empty strings")
    if semantic_present and not isinstance(semantic, list):
        raise RuntimeError("semantic_audit must be a list")
    result["asserted_fact_refs"] = [value.strip() for value in (asserted or [])]
    result["semantic_audit"] = copy.deepcopy(semantic or [])
    result["secret_audit_complete"] = (
        raw.get("secret_audit_complete") is True
        and asserted_present
        and semantic_present
    )
    fidelity_present = "fidelity_audit" in raw
    fidelity = raw.get("fidelity_audit")
    if fidelity_present and not (
        isinstance(fidelity, list)
        and all(isinstance(record, dict) for record in fidelity)
    ):
        raise RuntimeError("fidelity_audit must be a list of objects")
    result["fidelity_audit"] = copy.deepcopy(fidelity or [])
    result["fact_fidelity_complete"] = (
        raw.get("fact_fidelity_complete") is True and fidelity_present
    )
    verifier = raw.get("fact_fidelity_verifier")
    if verifier is not None:
        if verifier != "independent_model_call":
            raise RuntimeError("fact_fidelity_verifier is unsupported")
        result["fact_fidelity_verifier"] = verifier
        verifier_identity = raw.get("fact_fidelity_verifier_identity")
        if verifier_identity != {"provider": "coding-relay", "id": "gpt-5.6-sol"}:
            raise RuntimeError(
                "fact_fidelity_verifier_identity must be coding-relay/gpt-5.6-sol"
            )
        verifier_receipt = raw.get("fact_fidelity_verifier_receipt")
        if not isinstance(verifier_receipt, dict):
            raise RuntimeError("fact_fidelity_verifier_receipt must be an object")
        if (
            verifier_receipt.get("schema_version") != 1
            or verifier_receipt.get("model_identity") != verifier_identity
            or verifier_receipt.get("transport") != "chat/completions"
            or verifier_receipt.get("response_mode") != "json_object"
            or verifier_receipt.get("grounding_contract")
            != "structured_authority_partitions_v2"
            or not isinstance(verifier_receipt.get("max_completion_tokens"), int)
            or verifier_receipt["max_completion_tokens"] <= 0
            or not isinstance(verifier_receipt.get("timeout_ms"), int)
            or verifier_receipt["timeout_ms"] <= 0
            or not isinstance(verifier_receipt.get("attempt_count"), int)
            or verifier_receipt["attempt_count"] <= 0
            or not isinstance(verifier_receipt.get("duration_ms"), int)
            or verifier_receipt["duration_ms"] < 0
        ):
            raise RuntimeError("fact_fidelity_verifier_receipt is invalid")
        verifier_receipt = copy.deepcopy(verifier_receipt)
        if "usage" in verifier_receipt:
            verifier_receipt["usage"] = _validate_usage(verifier_receipt["usage"])
        result["fact_fidelity_verifier_identity"] = copy.deepcopy(verifier_identity)
        result["fact_fidelity_verifier_receipt"] = verifier_receipt
    notes = raw.get("notes")
    if notes is not None:
        if not isinstance(notes, str):
            raise RuntimeError("notes must be a string when present")
        result["notes"] = notes
    model_identity = raw.get("model_identity")
    if model_identity is not None:
        if not (
            isinstance(model_identity, dict)
            and isinstance(model_identity.get("provider"), str)
            and model_identity["provider"].strip()
            and isinstance(model_identity.get("id"), str)
            and model_identity["id"].strip()
        ):
            raise RuntimeError("model_identity must contain non-empty provider and id")
        result["model_identity"] = {
            "provider": model_identity["provider"].strip(),
            "id": model_identity["id"].strip(),
        }
    response_mode = raw.get("response_mode")
    if response_mode is not None:
        if response_mode not in {"tool", "json", "prose_fallback"}:
            raise RuntimeError("response_mode must be tool, json, or prose_fallback")
        result["response_mode"] = response_mode
    generation_receipt = raw.get("narrator_generation_receipt")
    if generation_receipt is not None:
        if not isinstance(generation_receipt, dict):
            raise RuntimeError("narrator_generation_receipt must be an object")
        phase_timings = generation_receipt.get("phase_timings")
        if (
            generation_receipt.get("schema_version") != 1
            or generation_receipt.get("model_identity") != result.get("model_identity")
            or generation_receipt.get("transport") != "chat/completions"
            or generation_receipt.get("response_mode") != "json_object"
            or generation_receipt.get("thinking") != "disabled"
            or generation_receipt.get("reasoning_effort") != "none"
            or not isinstance(generation_receipt.get("max_tokens"), int)
            or generation_receipt["max_tokens"] <= 0
            or not isinstance(generation_receipt.get("attempt_count"), int)
            or generation_receipt["attempt_count"] <= 0
            or not isinstance(generation_receipt.get("correction_count"), int)
            or generation_receipt["correction_count"] < 0
            or generation_receipt["correction_count"]
            != generation_receipt["attempt_count"] - 1
            or not isinstance(generation_receipt.get("duration_ms"), int)
            or generation_receipt["duration_ms"] < 0
            or not isinstance(phase_timings, list)
            or not phase_timings
        ):
            raise RuntimeError("narrator_generation_receipt is invalid")
        for timing in phase_timings:
            if (
                not isinstance(timing, dict)
                or set(timing)
                != {
                    "phase", "outer_attempt", "structured_attempt_count", "duration_ms"
                }
                or timing.get("phase") not in {"narrator_generation", "fact_verification"}
                or not isinstance(timing.get("outer_attempt"), int)
                or timing["outer_attempt"] <= 0
                or not isinstance(timing.get("structured_attempt_count"), int)
                or timing["structured_attempt_count"] <= 0
                or not isinstance(timing.get("duration_ms"), int)
                or timing["duration_ms"] < 0
            ):
                raise RuntimeError("narrator_generation_receipt phase timing is invalid")
        result["narrator_generation_receipt"] = copy.deepcopy(generation_receipt)
    operator_review = raw.get("operator_review_receipt")
    if operator_review is not None:
        if (
            not isinstance(operator_review, dict)
            or operator_review.get("schema_version") != 1
            or operator_review.get("protocol") not in {
                "operator_codex_black_box_v2", "operator_long_play_v1"
            }
            or operator_review.get("status") != "pending"
            or operator_review.get("independent_fact_verification") != "NOT_RUN"
            or operator_review.get("generation_policy")
            != "single_pass_raw_narration"
        ):
            raise RuntimeError("operator_review_receipt is invalid")
        result["operator_review_receipt"] = copy.deepcopy(operator_review)
    usage = raw.get("usage")
    if usage is not None:
        result["usage"] = _validate_usage(usage)
    return result


def _validate_usage(value: Any) -> dict[str, int | None]:
    if not isinstance(value, dict) or set(value) != {"input_tokens", "output_tokens"}:
        raise RuntimeError("usage must contain exactly input_tokens and output_tokens")
    clean: dict[str, int | None] = {}
    for name in ("input_tokens", "output_tokens"):
        count = value[name]
        if count is not None and (
            isinstance(count, bool) or not isinstance(count, int) or count < 0
        ):
            raise RuntimeError(f"usage {name} must be a non-negative integer or null")
        clean[name] = count
    return clean


def narrator_send_turn(
    request: dict[str, Any],
    *,
    runner_path: Path | str | None = None,
    timeout_s: float = 300,
    worker_pool: Any | None = None,
    worker_key: Any | None = None,
) -> dict[str, Any]:
    """Run one KP narration turn through the narrator-brain bridge.

    ``request`` must include: narration_envelope, last_player_text,
    play_language, recent_narrations. The adapter strips planner-side
    ``rationale`` / keeper secrets before spawning.
    """
    prepared = prepare_narrator_request(request)

    if worker_pool is not None:
        if worker_key is None:
            raise ValueError("worker_key is required with worker_pool")
        return parse_runner_response(
            worker_pool.request(worker_key, prepared, timeout_s=timeout_s)
        )

    # Resolve against the caller's cwd *before* spawning: the subprocess runs
    # with cwd=_narrator_dir(), which would silently re-anchor relative paths.
    runner = Path(runner_path).resolve() if runner_path is not None else _default_runner()
    if not runner.exists():
        raise RuntimeError(f"narrator runner not found: {runner}")

    cmd = _runner_cmd(runner)
    payload = json.dumps(prepared, ensure_ascii=False)
    try:
        proc = subprocess.run(
            cmd,
            input=payload,
            capture_output=True,
            text=True,
            timeout=timeout_s,
            cwd=str(_narrator_dir()),
        )
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError(f"narrator runner timed out after {timeout_s}s") from exc
    except FileNotFoundError as exc:
        raise RuntimeError(f"failed to start narrator runner: {cmd[0]}") from exc

    stdout = (proc.stdout or "").strip()
    stderr = (proc.stderr or "").strip()

    if proc.returncode != 0:
        detail = stderr or stdout or f"exit {proc.returncode}"
        if stdout:
            try:
                parsed = json.loads(stdout)
                if isinstance(parsed, dict) and parsed.get("error"):
                    detail = str(parsed["error"])
            except json.JSONDecodeError:
                pass
        raise RuntimeError(f"narrator runner failed: {detail}")

    if not stdout:
        raise RuntimeError("narrator runner produced empty stdout")

    try:
        raw = json.loads(stdout)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"narrator runner stdout is not JSON: {stdout[:200]!r}") from exc

    return parse_runner_response(raw)
