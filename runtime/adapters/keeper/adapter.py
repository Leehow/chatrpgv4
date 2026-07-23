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
import importlib.util
import json
import re
import subprocess
import threading
from pathlib import Path
from typing import Any, Callable

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


def _load_plugin_locator():
    path = _repo_root() / "runtime" / "engine" / "plugin_locator.py"
    spec = importlib.util.spec_from_file_location("runtime_plugin_locator_keeper", path)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


def default_skills_dir(workspace: Path | str | None = None) -> Path:
    return _load_plugin_locator().plugin_skills_dir(workspace)


def active_skill_dirs(workspace: Path | str, campaign_id: str) -> tuple[Path, Path]:
    return _load_plugin_locator().keeper_skill_dirs(workspace, campaign_id)


def default_toolbox_path(workspace: Path | str | None = None) -> Path:
    return _load_plugin_locator().plugin_scripts_dir(workspace) / "coc_toolbox.py"


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
    if "runtime_session_id" in prepared:
        prepared["runtime_session_id"] = str(prepared["runtime_session_id"]).strip()
        if not prepared["runtime_session_id"]:
            prepared.pop("runtime_session_id", None)
    prepared.setdefault("runtime_project_root", str(_repo_root()))
    runtime_project_root = Path(prepared["runtime_project_root"]).resolve(strict=False)
    if runtime_project_root != _repo_root():
        raise ValueError("runtime_project_root must identify the runtime installation")
    prepared["runtime_project_root"] = str(runtime_project_root)
    prepared.setdefault("skills_dir", str(default_skills_dir(prepared["workspace"])))
    if "skills_dirs" not in prepared:
        _kernel, ruleset = active_skill_dirs(
            prepared["workspace"], prepared["campaign_id"]
        )
        prepared["skills_dirs"] = [prepared["skills_dir"], str(ruleset)]
    skills_dirs = prepared.get("skills_dirs")
    if (
        not isinstance(skills_dirs, list)
        or len(skills_dirs) != 2
        or not all(isinstance(path, str) and path for path in skills_dirs)
    ):
        raise ValueError("skills_dirs must contain kernel and active ruleset paths")
    prepared.setdefault("toolbox_path", str(default_toolbox_path(prepared["workspace"])))
    tail = prepared.get("transcript_tail")
    if tail is None:
        prepared["transcript_tail"] = []
    elif not isinstance(tail, list):
        raise ValueError("transcript_tail must be a list")
    else:
        # Cold-start turns need far more than a few beats; keep a long public
        # tail so prior access, rolls, and scene moves are not re-invented.
        safe_tail: list[dict[str, str]] = []
        for item in tail[-48:]:
            if not isinstance(item, dict):
                continue
            role = item.get("role")
            text = item.get("text")
            if role not in {"player", "keeper"} or not isinstance(text, str):
                continue
            if text.strip():
                safe_tail.append({"role": role, "text": text.strip()})
        prepared["transcript_tail"] = safe_tail
    guidance = prepared.get("language_guidance")
    if guidance is not None and (
        not isinstance(guidance, list)
        or not all(isinstance(line, str) and line.strip() for line in guidance)
    ):
        raise ValueError("language_guidance must be a list of non-empty strings")
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


_STREAM_PREFIX = '{"$stream":'


class _WarmWorker:
    __slots__ = ("process", "lock", "stderr_thread", "key")

    def __init__(
        self,
        process: subprocess.Popen[str],
        *,
        key: str,
        on_stream_holder: list[Callable[[dict[str, Any]], None] | None],
    ) -> None:
        self.process = process
        self.lock = threading.RLock()
        self.key = key
        self.stderr_thread = threading.Thread(
            target=self._drain_stderr,
            args=(on_stream_holder,),
            daemon=True,
        )
        self.stderr_thread.start()

    def _drain_stderr(
        self,
        on_stream_holder: list[Callable[[dict[str, Any]], None] | None],
    ) -> None:
        assert self.process.stderr is not None
        for line in self.process.stderr:
            if line.startswith(_STREAM_PREFIX):
                callback = on_stream_holder[0]
                if callback is None:
                    continue
                try:
                    event = json.loads(line)
                except json.JSONDecodeError:
                    continue
                try:
                    callback(event)
                except Exception:
                    pass


class _KeeperWarmServerPool:
    """Keep one ``run_keeper_turn.mjs --server`` process warm per runtime session.

    Keyed by runtime session + campaign + model so model switches start a fresh
    agent (system prompt / auth bind at process start). Streaming progress still
    flows on stderr; results are one JSONL response per request on stdout.
    """

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._workers: dict[str, _WarmWorker] = {}
        # Mutable holder so the drain thread always sees the current callback.
        self._on_stream_holder: list[Callable[[dict[str, Any]], None] | None] = [
            None
        ]

    @staticmethod
    def make_key(
        *,
        runtime_session_id: str,
        campaign_id: str,
        workspace: str,
        provider: str,
        model_id: str,
    ) -> str:
        return "|".join(
            [
                runtime_session_id.strip(),
                campaign_id.strip(),
                str(Path(workspace).resolve()),
                provider.strip(),
                model_id.strip(),
            ]
        )

    def _retire(self, key: str, worker: _WarmWorker | None = None) -> None:
        with self._lock:
            current = self._workers.get(key)
            if worker is not None and current is not worker:
                return
            worker = self._workers.pop(key, None)
        if worker is None:
            return
        process = worker.process
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=0.5)
            except subprocess.TimeoutExpired:
                process.kill()
                try:
                    process.wait(timeout=0.5)
                except subprocess.TimeoutExpired:
                    pass
        for stream in (process.stdin, process.stdout, process.stderr):
            try:
                if stream is not None:
                    stream.close()
            except OSError:
                pass

    def close_session(self, runtime_session_id: str) -> None:
        prefix = f"{runtime_session_id.strip()}|"
        with self._lock:
            keys = [key for key in self._workers if key.startswith(prefix)]
        for key in keys:
            self._retire(key)

    def _start(
        self,
        key: str,
        *,
        runner: Path,
        workspace: str,
    ) -> _WarmWorker:
        cmd = [*_runner_cmd(runner), "--server"]
        try:
            process = subprocess.Popen(
                cmd,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1,
                cwd=workspace,
            )
        except FileNotFoundError as exc:
            raise KeeperAdapterError(f"failed to start keeper runner: {cmd[0]}") from exc
        if process.stdin is None or process.stdout is None or process.stderr is None:
            process.kill()
            raise KeeperAdapterError("keeper warm runner lacks stdio pipes")
        worker = _WarmWorker(
            process, key=key, on_stream_holder=self._on_stream_holder
        )
        with self._lock:
            self._workers[key] = worker
        return worker

    def request(
        self,
        key: str,
        prepared: dict[str, Any],
        *,
        runner: Path,
        timeout_s: float,
        on_stream: Callable[[dict[str, Any]], None] | None,
    ) -> dict[str, Any]:
        import uuid

        request_id = uuid.uuid4().hex
        try:
            encoded = json.dumps(
                {"request_id": request_id, "payload": prepared},
                ensure_ascii=False,
                separators=(",", ":"),
                allow_nan=False,
            )
        except (TypeError, ValueError) as exc:
            raise KeeperAdapterError(
                "keeper warm request is not JSON serializable"
            ) from exc

        self._on_stream_holder[0] = on_stream
        with self._lock:
            worker = self._workers.get(key)
            if worker is None or worker.process.poll() is not None:
                if worker is not None:
                    self._retire(key, worker)
                worker = self._start(
                    key, runner=runner, workspace=prepared["workspace"]
                )

        try:
            with worker.lock:
                if worker.process.poll() is not None:
                    raise KeeperAdapterError("keeper warm runner exited before request")
                assert worker.process.stdin is not None
                assert worker.process.stdout is not None
                worker.process.stdin.write(encoded + "\n")
                worker.process.stdin.flush()

                # Wait for the matching response line with a timeout.
                deadline = __import__("time").monotonic() + float(timeout_s)
                while True:
                    remaining = deadline - __import__("time").monotonic()
                    if remaining <= 0:
                        raise TimeoutError(
                            f"keeper warm runner timed out after {timeout_s}s"
                        )
                    import select

                    ready, _, _ = select.select(
                        [worker.process.stdout], [], [], min(remaining, 1.0)
                    )
                    if not ready:
                        if worker.process.poll() is not None:
                            raise KeeperAdapterError(
                                "keeper warm runner exited during request"
                            )
                        continue
                    line = worker.process.stdout.readline()
                    if not line:
                        raise KeeperAdapterError(
                            "keeper warm runner closed stdout during request"
                        )
                    try:
                        parsed = json.loads(line)
                    except json.JSONDecodeError as exc:
                        raise KeeperAdapterError(
                            f"keeper warm runner stdout is not JSON: {line[:200]!r}"
                        ) from exc
                    if not isinstance(parsed, dict):
                        raise KeeperAdapterError(
                            "keeper warm runner response must be a JSON object"
                        )
                    if parsed.get("request_id") != request_id:
                        # Ignore stale/out-of-band lines rather than cross-talk fail.
                        continue
                    parsed.pop("request_id", None)
                    return parse_runner_response(parsed)
        except (BrokenPipeError, OSError, TimeoutError, KeeperAdapterError) as exc:
            self._retire(key, worker)
            if isinstance(exc, KeeperAdapterError):
                raise
            if isinstance(exc, TimeoutError):
                raise KeeperAdapterError(str(exc)) from exc
            raise KeeperAdapterError(str(exc)) from exc
        finally:
            self._on_stream_holder[0] = None


_WARM_POOL = _KeeperWarmServerPool()


def close_warm_sessions_for(runtime_session_id: str) -> None:
    """Retire warm keeper workers owned by one runtime session_id."""
    if isinstance(runtime_session_id, str) and runtime_session_id.strip():
        _WARM_POOL.close_session(runtime_session_id.strip())


def _recover_committed_receipt(prepared: dict[str, Any]) -> dict[str, Any]:
    """Recover a successful result when the runner crashed after turn.finalize."""
    workspace = Path(prepared["workspace"])
    campaign_id = str(prepared["campaign_id"])
    offset = prepared["finalization_offset"]
    log_path = (
        workspace / ".coc" / "campaigns" / campaign_id / "logs" / "turn-finalizations.jsonl"
    )
    receipt = load_new_finalization_receipt(log_path, offset)
    narration = receipt["rendered_text"]
    projection = {
        "finalization_id": receipt["finalization_id"],
        "journal_decision_id": receipt["journal_decision_id"],
        "rendered_sha256": receipt["rendered_sha256"],
        "integrity_digest": receipt["integrity_digest"],
        "segments": [
            {
                "segment_type": seg["segment_type"],
                "text": seg["text"],
                "source_ids": list(seg["source_ids"]),
            }
            for seg in receipt["segments"]
        ],
    }
    return {"ok": True, "narration": narration, "finalization": projection}


def keeper_send_turn(
    request: dict[str, Any],
    *,
    runner_path: Path | str | None = None,
    timeout_s: float = 900,
    on_stream: Callable[[dict[str, Any]], None] | None = None,
    prefer_warm: bool = True,
) -> dict[str, Any]:
    """Run one full keeper turn through the skills-enabled Pi coding agent.

    ``on_stream`` receives best-effort live progress dicts parsed from runner
    stderr marker lines (``{"$stream":...}``). Stream delivery never alters the
    result contract and callback failures never fail the turn.

    When ``prefer_warm`` is true and the request carries ``runtime_session_id``,
    the adapter reuses a long-lived ``--server`` agent process so later turns
    keep CLI-like chat memory (still gated by ``turn.finalize`` for output).
    """
    prepared = prepare_keeper_request(request)
    runner = Path(runner_path).resolve() if runner_path is not None else _default_runner()
    if not runner.exists():
        raise KeeperAdapterError(f"keeper runner not found: {runner}")

    runtime_session_id = prepared.get("runtime_session_id")
    use_warm = (
        prefer_warm
        and isinstance(runtime_session_id, str)
        and runtime_session_id.strip()
        and runner.suffix.lower() in {".mjs", ".js"}
    )
    if use_warm:
        import os

        provider = str(os.environ.get("COC_KEEPER_MODEL_PROVIDER") or "coding-relay")
        model_id = str(os.environ.get("COC_KEEPER_MODEL_ID") or "gpt-5.6-luna")
        key = _WARM_POOL.make_key(
            runtime_session_id=runtime_session_id.strip(),
            campaign_id=prepared["campaign_id"],
            workspace=prepared["workspace"],
            provider=provider,
            model_id=model_id,
        )
        try:
            return _WARM_POOL.request(
                key,
                prepared,
                runner=runner,
                timeout_s=timeout_s,
                on_stream=on_stream,
            )
        except KeeperAdapterError:
            # Fall through to one-shot cold spawn when warm worker is unhealthy
            # and no state may have been settled yet is the caller's concern;
            # here we only try cold if warm failed before a usable response.
            raise

    cmd = _runner_cmd(runner)
    payload = json.dumps(prepared, ensure_ascii=False)
    try:
        proc = subprocess.Popen(
            cmd,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            cwd=prepared["workspace"],
        )
    except FileNotFoundError as exc:
        raise KeeperAdapterError(f"failed to start keeper runner: {cmd[0]}") from exc

    stdout_parts: list[str] = []
    stderr_parts: list[str] = []

    def _drain_stdout() -> None:
        assert proc.stdout is not None
        stdout_parts.append(proc.stdout.read())

    def _drain_stderr() -> None:
        assert proc.stderr is not None
        for line in proc.stderr:
            if line.startswith(_STREAM_PREFIX):
                if on_stream is not None:
                    try:
                        event = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    try:
                        on_stream(event)
                    except Exception:
                        pass
                continue
            stderr_parts.append(line)

    stdout_thread = threading.Thread(target=_drain_stdout, daemon=True)
    stderr_thread = threading.Thread(target=_drain_stderr, daemon=True)
    stdout_thread.start()
    stderr_thread.start()
    timed_out = False
    try:
        assert proc.stdin is not None
        try:
            proc.stdin.write(payload)
            proc.stdin.close()
        except BrokenPipeError:
            pass
        proc.wait(timeout=timeout_s)
    except subprocess.TimeoutExpired:
        timed_out = True
        proc.kill()
        proc.wait()
    stdout_thread.join()
    stderr_thread.join()
    if timed_out:
        raise KeeperAdapterError(f"keeper runner timed out after {timeout_s}s")

    stdout = "".join(stdout_parts).strip()
    stderr = "".join(stderr_parts).strip()
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
            if parsed.get("turn_committed") is True:
                receipt = _recover_committed_receipt(prepared)
                return receipt
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
