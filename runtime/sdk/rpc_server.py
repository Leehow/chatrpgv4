"""Stdio JSON-RPC sidecar exposing the canonical runtime SDK to Node hosts.

The Node web server (``web/server-node/``) spawns this process once and talks
newline-delimited JSON over stdin/stdout. All game semantics stay in the
canonical runtime SDK / engine / keeper runner — this file is a thin typed
transport plus the plugin-bound view projections in ``runtime/sdk/web_views``.
It adds no rules, state, or narration behavior of its own.

Protocol (one JSON object per line, UTF-8):

    Request:      {"id": 1, "method": "get_state", "params": {...}}
    Response:     {"id": 1, "result": ...}
                  {"id": 1, "error": {"class": ..., "kind": ..., "message": ...}}
    Notification: {"notify": "keeper_stream", "id": 1, "data": {...}}
                  (emitted while a ``send`` request is in flight; ``id`` is the
                  originating request id so concurrent callers can correlate)

Requests are handled on worker threads so a long ``send`` turn does not block
concurrent read-only requests (same concurrency shape as the old
ThreadingHTTPServer bridge). Turn serialization is the caller's job (the Node
server holds a global turn lock), exactly as before.

Run from the repository root:

    uv run --frozen python runtime/sdk/rpc_server.py --workspace .
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import threading
from pathlib import Path
from typing import Any, Callable

_REPO_ROOT = Path(__file__).resolve().parents[2]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from runtime.sdk import api as sdk  # noqa: E402
from runtime.sdk import web_views  # noqa: E402

_WORKSPACE: Path = _REPO_ROOT

_WRITE_LOCK = threading.Lock()


def _emit(line_obj: dict[str, Any]) -> None:
    data = (json.dumps(line_obj, ensure_ascii=False) + "\n").encode("utf-8")
    with _WRITE_LOCK:
        sys.stdout.buffer.write(data)
        sys.stdout.buffer.flush()


def _log(message: str) -> None:
    sys.stderr.write(f"[rpc] {message}\n")
    sys.stderr.flush()


def _error_payload(exc: BaseException) -> dict[str, Any]:
    return {
        "class": exc.__class__.__name__,
        "kind": getattr(exc, "kind", None),
        "message": str(exc),
    }


# ---------------------------------------------------------------------------
# Methods


def _m_ping(_params: dict[str, Any]) -> dict[str, Any]:
    return {"ok": True, "workspace": str(_WORKSPACE)}


def _m_setup_workspace(params: dict[str, Any]) -> Any:
    operation = params.get("operation")
    if not isinstance(operation, dict):
        raise ValueError("operation must be a JSON object")
    return sdk.setup_workspace(_WORKSPACE, operation)


def _m_create_session(params: dict[str, Any]) -> dict[str, Any]:
    campaign_id = str(params.get("campaign_id") or "").strip()
    investigator_id = str(params.get("investigator_id") or "").strip()
    if not campaign_id or not investigator_id:
        raise ValueError("campaign_id and investigator_id are required")
    session_id = sdk.create_session(
        _WORKSPACE, campaign_id=campaign_id, investigator_id=investigator_id
    )
    return {"session_id": session_id}


def _m_get_state(params: dict[str, Any]) -> Any:
    session_id = str(params.get("session_id") or "").strip()
    if not session_id:
        raise ValueError("session_id is required")
    return sdk.get_state(session_id)


def _m_close_session(params: dict[str, Any]) -> dict[str, Any]:
    session_id = str(params.get("session_id") or "").strip()
    if not session_id:
        raise ValueError("session_id is required")
    sdk.close_session(session_id)
    return {"closed": True}


def _m_campaign_compat(params: dict[str, Any]) -> dict[str, Any]:
    campaign_id = str(params.get("campaign_id") or "").strip()
    if not campaign_id:
        raise ValueError("campaign_id is required")
    return web_views.campaign_compat(_WORKSPACE, campaign_id)


def _m_display_character(params: dict[str, Any]) -> dict[str, Any]:
    investigator_id = str(params.get("investigator_id") or "").strip()
    play_language = str(params.get("play_language") or "zh-Hans")
    if not investigator_id:
        raise ValueError("investigator_id is required")
    return {
        "character": web_views.display_character(
            _WORKSPACE, investigator_id, play_language
        )
    }


def _m_list_library_modules(_params: dict[str, Any]) -> dict[str, Any]:
    return {"modules": web_views.list_library_modules(_WORKSPACE)}


def _m_install_module(params: dict[str, Any]) -> Any:
    module_id = str(params.get("module_id") or "").strip()
    campaign_id = str(params.get("campaign_id") or "").strip()
    if not module_id or not campaign_id:
        raise ValueError("module_id and campaign_id are required")
    return web_views.install_module(_WORKSPACE, module_id, campaign_id)


def _m_public_transcript_base(params: dict[str, Any]) -> dict[str, Any]:
    campaign_id = str(params.get("campaign_id") or "").strip()
    if not campaign_id:
        raise ValueError("campaign_id is required")
    try:
        limit = int(params.get("limit", 10000))
    except (TypeError, ValueError):
        limit = 10000
    return {
        "messages": web_views.public_transcript_base(
            _WORKSPACE, campaign_id, limit=limit
        )
    }


def _m_send(params: dict[str, Any], request_id: Any) -> Any:
    session_id = str(params.get("session_id") or "").strip()
    player_input = str(params.get("input") or "").strip()
    if not session_id:
        raise ValueError("session_id is required")
    if not player_input:
        raise ValueError("input is required")
    provider = str(params.get("provider") or "").strip()
    model = str(params.get("model") or "").strip()

    def _on_stream(event: dict[str, Any]) -> None:
        try:
            _emit({"notify": "keeper_stream", "id": request_id, "data": event})
        except Exception:  # noqa: BLE001 - streaming is best-effort
            pass

    # Model selection is process-global for the runner child; set/restore
    # around the turn exactly as the old bridge did. The Node caller holds a
    # global turn lock, so concurrent env mutation cannot interleave.
    saved: dict[str, str | None] = {}
    try:
        if provider:
            saved["COC_KEEPER_MODEL_PROVIDER"] = os.environ.get(
                "COC_KEEPER_MODEL_PROVIDER"
            )
            os.environ["COC_KEEPER_MODEL_PROVIDER"] = provider
        if model:
            saved["COC_KEEPER_MODEL_ID"] = os.environ.get("COC_KEEPER_MODEL_ID")
            os.environ["COC_KEEPER_MODEL_ID"] = model
        events = sdk.send(session_id, player_input, on_keeper_stream=_on_stream)
        return {"events": events}
    finally:
        for key, value in saved.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


_METHODS: dict[str, Callable[..., Any]] = {
    "ping": _m_ping,
    "setup_workspace": _m_setup_workspace,
    "create_session": _m_create_session,
    "get_state": _m_get_state,
    "close_session": _m_close_session,
    "campaign_compat": _m_campaign_compat,
    "display_character": _m_display_character,
    "list_library_modules": _m_list_library_modules,
    "install_module": _m_install_module,
    "public_transcript_base": _m_public_transcript_base,
    "send": _m_send,
}


# ---------------------------------------------------------------------------
# Loop


def _handle(line: str) -> None:
    try:
        request = json.loads(line)
    except json.JSONDecodeError:
        _emit(
            {
                "id": None,
                "error": {
                    "class": "ProtocolError",
                    "kind": None,
                    "message": "line is not valid JSON",
                },
            }
        )
        return
    if not isinstance(request, dict):
        _emit(
            {
                "id": None,
                "error": {
                    "class": "ProtocolError",
                    "kind": None,
                    "message": "request must be a JSON object",
                },
            }
        )
        return
    request_id = request.get("id")
    method = request.get("method")
    params = request.get("params")
    if params is None:
        params = {}
    if not isinstance(method, str) or not method:
        _emit(
            {
                "id": request_id,
                "error": {
                    "class": "ProtocolError",
                    "kind": None,
                    "message": "method is required",
                },
            }
        )
        return
    if not isinstance(params, dict):
        _emit(
            {
                "id": request_id,
                "error": {
                    "class": "ProtocolError",
                    "kind": None,
                    "message": "params must be a JSON object",
                },
            }
        )
        return
    handler = _METHODS.get(method)
    if handler is None:
        _emit(
            {
                "id": request_id,
                "error": {
                    "class": "UnknownMethodError",
                    "kind": None,
                    "message": f"unknown method: {method}",
                },
            }
        )
        return
    try:
        if method == "send":
            result = handler(params, request_id)
        else:
            result = handler(params)
    except Exception as exc:  # noqa: BLE001 - error envelope is the contract
        _emit({"id": request_id, "error": _error_payload(exc)})
        return
    _emit({"id": request_id, "result": result})


def main() -> None:
    global _WORKSPACE
    parser = argparse.ArgumentParser(description="COC runtime stdio JSON-RPC sidecar")
    parser.add_argument("--workspace", default=str(_REPO_ROOT))
    args = parser.parse_args()
    _WORKSPACE = Path(args.workspace).expanduser().resolve()
    _log(f"ready workspace={_WORKSPACE}")
    for raw_line in sys.stdin.buffer:
        line = raw_line.decode("utf-8", errors="replace").strip()
        if not line:
            continue
        # Worker thread per request: a long keeper turn must not block
        # concurrent read-only state/transcript requests.
        threading.Thread(target=_handle, args=(line,), daemon=True).start()


if __name__ == "__main__":
    main()
