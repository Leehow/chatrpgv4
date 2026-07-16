"""Keeper adapter: spawn a skills-enabled Pi coding agent for one keeper turn.

Pi runs the same architecture as Codex/Claude Code/Cursor hosts: the keeper
LLM reads the canonical ``plugins/coc-keeper/skills`` tree and drives the
turn by calling ``coc_toolbox.py`` over shell. This adapter is a thin host
shell — no narration envelope, no secret audit, no template fallback.
Failures raise; the caller decides whether to retry (network/timeout level
only).
"""
from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any

KEEPER_REQUEST_KEYS = (
    "workspace",
    "campaign_id",
    "player_input",
    "play_language",
)


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


def parse_runner_response(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raise RuntimeError("keeper runner response must be a JSON object")
    if raw.get("ok") is not True:
        raise RuntimeError(str(raw.get("error") or "keeper runner returned ok=false"))
    narration = raw.get("narration")
    if not isinstance(narration, str) or not narration.strip():
        raise RuntimeError("keeper runner response missing non-empty narration")
    result: dict[str, Any] = {"ok": True, "narration": narration.strip()}
    identity = raw.get("model_identity")
    if identity is not None:
        if not (
            isinstance(identity, dict)
            and isinstance(identity.get("provider"), str)
            and identity["provider"].strip()
            and isinstance(identity.get("id"), str)
            and identity["id"].strip()
        ):
            raise RuntimeError("model_identity must contain non-empty provider and id")
        result["model_identity"] = {
            "provider": identity["provider"].strip(),
            "id": identity["id"].strip(),
        }
    usage = raw.get("usage")
    if usage is not None:
        if not isinstance(usage, dict):
            raise RuntimeError("usage must be an object")
        clean: dict[str, int | None] = {}
        for name in ("input_tokens", "output_tokens"):
            count = usage.get(name)
            if count is not None and (isinstance(count, bool) or not isinstance(count, int) or count < 0):
                raise RuntimeError(f"usage {name} must be a non-negative integer or null")
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
        raise RuntimeError(f"keeper runner not found: {runner}")

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
        raise RuntimeError(f"keeper runner timed out after {timeout_s}s") from exc
    except FileNotFoundError as exc:
        raise RuntimeError(f"failed to start keeper runner: {cmd[0]}") from exc

    stdout = (proc.stdout or "").strip()
    stderr = (proc.stderr or "").strip()
    if proc.returncode != 0:
        detail = stderr or stdout or f"exit {proc.returncode}"
        if stdout:
            try:
                parsed = json.loads(stdout.splitlines()[-1])
                if isinstance(parsed, dict) and parsed.get("error"):
                    detail = str(parsed["error"])
            except json.JSONDecodeError:
                pass
        raise RuntimeError(f"keeper runner failed: {detail}")
    if not stdout:
        raise RuntimeError("keeper runner produced empty stdout")
    try:
        raw = json.loads(stdout.splitlines()[-1])
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"keeper runner stdout is not JSON: {stdout[:200]!r}") from exc
    return parse_runner_response(raw)
