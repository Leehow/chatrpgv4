"""Player brain adapter: spawn constrained subprocess bridge, parse player turn."""
from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path
from typing import Any

PLAYER_REQUEST_KEYS = (
    "public_state",
    "narration",
    "character_card",
    "transcript_tail",
    "pending_choice",
)
PLAYER_OPTIONAL_REQUEST_KEYS = ("persona_id", "persona_prompt_directives")
_SAFE_PERSONA_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")

# Mirrored from plugins/coc-keeper/scripts/coc_intent_router.py
# ``_PRIMARY_INTENT_ENUM`` (source of truth). Runtime must not import plugin
# scripts (Runtime Track); keep this frozenset in sync via
# tests/test_intent_router.py::test_player_adapter_intent_class_enum_stays_in_sync_with_router.
CANONICAL_INTENT_CLASSES = frozenset(
    {
        "investigate",
        "social",
        "move",
        "combat",
        "flee",
        "meta",
        "stuck",
        "idle",
        "ambiguous",
        "montage",
        "cast",
    }
)

# Fixed protocol markers from coc_player_action — format recovery only, not
# semantic keyword matching (Semantic Matcher Constitution).
_PLAYER_ACTION_TOOL = "coc_player_action"
_PLAYER_PROTOCOL_LABELS = ("player_text:", "intent_class:", "player_notes:")


def recover_player_action_scaffolding(text: str) -> dict[str, str] | None:
    """Extract coc_player_action field values from prose that embeds our labels.

    Models sometimes emit the tool call as concatenated prose, e.g.
    ``coc_player_actionplayer_text: ...intent_class: socialplayer_notes: ...``.
    When those fixed protocol markers are present, recover the real fields
    instead of treating the whole blob as in-character player_text.
    """
    if not isinstance(text, str):
        return None
    raw = text.strip()
    if not raw:
        return None
    if _PLAYER_ACTION_TOOL not in raw and "player_text:" not in raw:
        return None
    # Require at least one field label — otherwise leave ordinary prose alone.
    if "player_text:" not in raw:
        return None

    work = raw
    tool_idx = work.find(_PLAYER_ACTION_TOOL)
    if tool_idx >= 0:
        # Drop a leading tool-name glue prefix when present.
        after_tool = work[tool_idx + len(_PLAYER_ACTION_TOOL) :]
        if "player_text:" in after_tool:
            work = after_tool.lstrip()

    markers: list[tuple[int, str]] = []
    for label in _PLAYER_PROTOCOL_LABELS:
        idx = work.find(label)
        if idx >= 0:
            markers.append((idx, label))
    if not markers:
        return None
    markers.sort(key=lambda item: item[0])
    if markers[0][1] != "player_text:":
        # player_text must be the first recoverable field.
        pt_idx = work.find("player_text:")
        if pt_idx < 0:
            return None
        markers = [(pt_idx, "player_text:")] + [
            m for m in markers if m[1] != "player_text:" and m[0] > pt_idx
        ]

    fields: dict[str, str] = {}
    for i, (idx, label) in enumerate(markers):
        start = idx + len(label)
        end = markers[i + 1][0] if i + 1 < len(markers) else len(work)
        value = work[start:end].strip()
        key = label[:-1]  # strip trailing colon
        if value:
            fields[key] = value

    player_text = fields.get("player_text")
    if not player_text:
        return None
    return fields


def _player_dir() -> Path:
    return Path(__file__).resolve().parent


def _default_runner() -> Path:
    return _player_dir() / "run_player_turn.mjs"


def _runner_cmd(runner_path: Path) -> list[str]:
    """Invoke .mjs/.js via node; otherwise run the path directly (fake runners)."""
    if runner_path.suffix.lower() in {".mjs", ".js"}:
        return ["node", str(runner_path)]
    return [str(runner_path)]


def parse_runner_response(raw: dict[str, Any]) -> dict[str, Any]:
    """Validate runner JSON envelope and return player_text (+ optional fields).

    Optional ``intent_class`` is structured semantic evidence from the player
    brain (canonical enum). Invalid values are a bridge contract violation.

    When ``player_text`` embeds our own ``coc_player_action`` protocol markers
    (prose-degradation of a tool-shaped reply), recover the real field values
    before returning.
    """
    if not isinstance(raw, dict):
        raise RuntimeError("player runner response must be a JSON object")
    if raw.get("ok") is not True:
        err = raw.get("error") or "player runner returned ok=false"
        raise RuntimeError(str(err))
    pending_response = raw.get("pending_choice_response")
    player_text = raw.get("player_text", "")
    if not isinstance(player_text, str) or (
        not player_text.strip() and pending_response is None
    ):
        raise RuntimeError("player runner response missing non-empty player_text string")

    notes = raw.get("player_notes")
    intent_class = raw.get("intent_class") if "intent_class" in raw else None
    recovered = recover_player_action_scaffolding(player_text) if player_text else None
    if recovered:
        player_text = recovered["player_text"]
        if recovered.get("player_notes"):
            notes = recovered["player_notes"]
        if recovered.get("intent_class") and intent_class is None:
            intent_class = recovered["intent_class"]

    result: dict[str, Any] = {"ok": True, "player_text": player_text}
    if notes is not None:
        if not isinstance(notes, str):
            raise RuntimeError("player_notes must be a string when present")
        result["player_notes"] = notes
    if intent_class is not None:
        if not isinstance(intent_class, str) or intent_class not in CANONICAL_INTENT_CLASSES:
            raise RuntimeError(
                f"player runner intent_class {intent_class!r} is not a canonical "
                f"intent class (bridge contract violation)"
            )
        result["intent_class"] = intent_class
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
        if response_mode not in {"tool", "prose_fallback"}:
            raise RuntimeError("response_mode must be tool or prose_fallback")
        result["response_mode"] = response_mode
    usage = raw.get("usage")
    if usage is not None:
        result["usage"] = _validate_usage(usage)
    if pending_response is not None:
        if not isinstance(pending_response, dict) or set(pending_response) != {
            "choice_id", "responder", "revision", "action",
        }:
            raise RuntimeError(
                "pending_choice_response must contain exactly choice_id, responder, revision, and action"
            )
        if (
            not isinstance(pending_response.get("choice_id"), str)
            or not pending_response["choice_id"].strip()
            or pending_response.get("responder") != "player"
            or isinstance(pending_response.get("revision"), bool)
            or not isinstance(pending_response.get("revision"), int)
            or pending_response["revision"] < 0
            or not isinstance(pending_response.get("action"), str)
            or not pending_response["action"].strip()
        ):
            raise RuntimeError("pending_choice_response has invalid player choice fields")
        result["pending_choice_response"] = dict(pending_response)
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


def player_send_turn(
    request: dict[str, Any],
    *,
    runner_path: Path | str | None = None,
    timeout_s: float = 300,
    worker_pool: Any | None = None,
    worker_key: Any | None = None,
) -> dict[str, Any]:
    """Run one investigator turn through the player-brain bridge.

    ``request`` must include only player-safe fields:
    public_state, narration, character_card, transcript_tail, pending_choice,
    plus the optional structured persona pair.
    Never include director plans, keeper secrets, clue-graph, story-graph, or
    npc-agendas in the request — callers are responsible for spoiler isolation.
    """
    if not isinstance(request, dict):
        raise ValueError("player_send_turn request must be a dict")
    for key in PLAYER_REQUEST_KEYS:
        if key not in request:
            raise ValueError(f"player_send_turn request missing {key!r}")
    unsupported = set(request) - set(PLAYER_REQUEST_KEYS) - set(
        PLAYER_OPTIONAL_REQUEST_KEYS
    )
    if unsupported:
        raise ValueError(
            "player_send_turn unsupported request fields: "
            + ", ".join(sorted(str(key) for key in unsupported))
        )
    persona_id = request.get("persona_id")
    directives = request.get("persona_prompt_directives")
    if (persona_id is None) != (directives is None):
        raise ValueError("persona_id and persona_prompt_directives must appear together")
    if persona_id is not None:
        if not isinstance(persona_id, str) or not _SAFE_PERSONA_ID.fullmatch(persona_id):
            raise ValueError("persona_id must be a safe identifier")
        if (
            not isinstance(directives, list)
            or not directives
            or any(not isinstance(item, str) or not item.strip() for item in directives)
        ):
            raise ValueError("persona_prompt_directives must be a non-empty string list")
    pending = request.get("pending_choice")
    if isinstance(pending, dict) and pending.get("responder") == "keeper":
        raise ValueError("Keeper pending choices must never be sent to the player adapter")

    # A scoped pool requires a caller-owned full session/campaign/match/role
    # key. It is never inferred from player text or reused globally.
    if worker_pool is not None:
        if worker_key is None:
            raise ValueError("worker_key is required with worker_pool")
        raw = worker_pool.request(worker_key, request, timeout_s=timeout_s)
        result = parse_runner_response(raw)
        typed_response = result.get("pending_choice_response")
        _validate_pending_response(pending, typed_response)
        return result

    # Resolve against the caller's cwd *before* spawning: the subprocess runs
    # with cwd=_player_dir(), which would silently re-anchor relative paths.
    runner = Path(runner_path).resolve() if runner_path is not None else _default_runner()
    if not runner.exists():
        raise RuntimeError(f"player runner not found: {runner}")

    cmd = _runner_cmd(runner)
    payload = json.dumps(request, ensure_ascii=False)
    try:
        proc = subprocess.run(
            cmd,
            input=payload,
            capture_output=True,
            text=True,
            timeout=timeout_s,
            cwd=str(_player_dir()),
        )
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError(f"player runner timed out after {timeout_s}s") from exc
    except FileNotFoundError as exc:
        raise RuntimeError(f"failed to start player runner: {cmd[0]}") from exc

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
        raise RuntimeError(f"player runner failed: {detail}")

    if not stdout:
        raise RuntimeError("player runner produced empty stdout")

    try:
        raw = json.loads(stdout)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"player runner stdout is not JSON: {stdout[:200]!r}") from exc

    result = parse_runner_response(raw)
    typed_response = result.get("pending_choice_response")
    _validate_pending_response(pending, typed_response)
    return result


def _validate_pending_response(pending: Any, typed_response: Any) -> None:
    """Validate a model's structured choice against canonical player state."""
    if isinstance(pending, dict) and pending.get("responder") == "player":
        if not isinstance(typed_response, dict):
            raise RuntimeError("player runner must return pending_choice_response")
        allowed_actions = {
            str(option.get("action"))
            for option in (pending.get("options") or [])
            if isinstance(option, dict) and option.get("action")
        }
        if (
            typed_response.get("choice_id") != pending.get("choice_id")
            or typed_response.get("responder") != "player"
            or typed_response.get("revision") != pending.get("revision")
            or typed_response.get("action") not in allowed_actions
        ):
            raise RuntimeError("player response does not match the canonical pending choice")
    elif typed_response is not None:
        raise RuntimeError("player returned pending_choice_response without a pending choice")
