"""Bounded, recoverable in-process sessions for the COC runtime SDK."""
from __future__ import annotations

import copy
import importlib.util
import json
import math
import re
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Callable, Mapping


class UnknownSessionError(Exception):
    """Stable public error for an unknown, closed, or expired session."""

    kind = "unknown_session"

    def __init__(self, session_id: str | None = None) -> None:
        self.session_id = session_id
        super().__init__(self.kind)


class SessionRegistry:
    """Thread-safe session metadata store with TTL and restart recovery.

    Only metadata needed to reconstruct a session is kept.  The registry never
    persists player text, credentials, adapter process handles, absolute paths,
    or monotonic timestamps (which have no meaning after a restart).
    """

    SNAPSHOT_SCHEMA_VERSION = 1
    _SNAPSHOT_NAME = "sessions.json"
    _PERSISTED_KEYS = (
        "session_id",
        "campaign_id",
        "investigator_id",
        "character_relpath",
        "resolved_config",
        "brain_at_create",
    )
    _UNRECOVERABLE_CONFIG_KEY_PARTS = (
        "secret", "token", "password", "apikey", "credential", "input",
        "handle", "process", "socket", "authorization", "cookie",
        "privatekey", "accesskey", "signingkey", "passphrase", "bearer",
        "jwt",
    )
    _UNRECOVERABLE_CONFIG_VALUE_PATTERNS = (
        re.compile(r"(?:^|\s)(?:proxy-)?authorization\s*:", re.IGNORECASE),
        re.compile(r"(?:^|\s)(?:set-)?cookie\s*:", re.IGNORECASE),
        re.compile(r"\bbearer\s+[A-Za-z0-9._~+/=-]{3,}", re.IGNORECASE),
        re.compile(r"-----BEGIN(?: [A-Z0-9]+)? PRIVATE KEY-----", re.IGNORECASE),
        re.compile(r"^[a-z][a-z0-9+.-]*://[^/\s:@]+:[^/\s@]+@", re.IGNORECASE),
    )

    def __init__(
        self,
        *,
        ttl_seconds: float = 30 * 60,
        monotonic: Callable[[], float] = time.monotonic,
    ) -> None:
        if (
            isinstance(ttl_seconds, bool)
            or not isinstance(ttl_seconds, (int, float))
            or not math.isfinite(ttl_seconds)
            or ttl_seconds <= 0
        ):
            raise ValueError("ttl_seconds must be a positive finite number")
        self._ttl_seconds = float(ttl_seconds)
        self._monotonic = monotonic
        self._lock = threading.RLock()
        self._sessions: dict[str, dict[str, Any]] = {}
        # ID -> owning workspace. ``None`` is an in-process tombstone for an
        # unknown ID and is intentionally never serialized into a workspace.
        self._tombstones: dict[str, Path | None] = {}

    def __len__(self) -> int:
        with self._lock:
            self._expire_locked()
            return len(self._sessions)

    def _now(self) -> float:
        value = self._monotonic()
        if (
            isinstance(value, bool)
            or not isinstance(value, (int, float))
            or not math.isfinite(value)
        ):
            raise RuntimeError("monotonic clock returned an invalid value")
        return float(value)

    def _expired(self, record: Mapping[str, Any], now: float) -> bool:
        last = record.get("last_access_monotonic")
        return not isinstance(last, (int, float)) or now - float(last) >= self._ttl_seconds

    def _expire_locked(self, now: float | None = None) -> list[str]:
        now = self._now() if now is None else now
        expired = [
            session_id for session_id, record in self._sessions.items()
            if self._expired(record, now)
        ]
        for session_id in expired:
            record = self._sessions.pop(session_id, None)
            workspace = record.get("workspace")
            self._tombstones[session_id] = (
                Path(workspace).resolve(strict=False)
                if isinstance(workspace, (str, Path)) else None
            )
        return sorted(expired)

    @staticmethod
    def _require_session_id(session_id: str) -> str:
        if not isinstance(session_id, str) or not session_id:
            raise ValueError("invalid session_id")
        return session_id

    @staticmethod
    def _copy_record(record: Mapping[str, Any]) -> dict[str, Any]:
        return copy.deepcopy(dict(record))

    def create(
        self,
        record: Mapping[str, Any],
        *,
        session_id: str | None = None,
    ) -> str:
        """Store a recoverable record and return a newly allocated ID.

        Supplying ``session_id`` is reserved for deterministic tests and is
        still denied for every tombstoned ID, so a close/expiry can never be
        revived by an old snapshot or a caller retry.
        """
        if not isinstance(record, Mapping):
            raise TypeError("session record must be a mapping")
        candidate = self._copy_record(record)
        now = self._now()
        with self._lock:
            self._expire_locked(now)
            if session_id is not None:
                sid = self._require_session_id(session_id)
                if sid in self._tombstones:
                    raise ValueError("session_id is tombstoned")
                if sid in self._sessions:
                    raise ValueError("session_id already exists")
            else:
                for _attempt in range(128):
                    sid = f"sess_{uuid.uuid4().hex[:16]}"
                    if sid not in self._tombstones and sid not in self._sessions:
                        break
                else:  # pragma: no cover - protects against a broken UUID source.
                    raise RuntimeError("unable to allocate a unique session_id")
            candidate["session_id"] = sid
            candidate["last_access_monotonic"] = now
            self._sessions[sid] = candidate
        return sid

    def get(self, session_id: str) -> dict[str, Any]:
        """Return a deep copy and count this access against the TTL."""
        sid = self._require_session_id(session_id)
        now = self._now()
        with self._lock:
            self._expire_locked(now)
            record = self._sessions.get(sid)
            if record is None:
                raise UnknownSessionError(sid)
            record["last_access_monotonic"] = now
            return self._copy_record(record)

    def touch(self, session_id: str) -> dict[str, Any]:
        """Refresh an active session and return an isolated copy."""
        return self.get(session_id)

    def close(self, session_id: str) -> None:
        """Close a session permanently; repeated close is intentionally safe."""
        sid = self._require_session_id(session_id)
        with self._lock:
            record = self._sessions.pop(sid, None)
            workspace = record.get("workspace") if isinstance(record, dict) else None
            self._tombstones[sid] = (
                Path(workspace).resolve(strict=False)
                if isinstance(workspace, (str, Path)) else None
            )

    def expire(self) -> list[str]:
        """Evict idle sessions and return their deterministic IDs."""
        with self._lock:
            return self._expire_locked()

    def _snapshot_path(self, workspace: Path | str) -> tuple[Path, Path]:
        paths = _load_paths()
        root = paths.workspace_root(workspace)
        coc = paths.coc_root(root)
        runtime_dir = paths.contained_path(coc, coc / "runtime")
        return root, paths.contained_path(runtime_dir, runtime_dir / self._SNAPSHOT_NAME)

    def _serialize_record(self, record: Mapping[str, Any]) -> dict[str, Any]:
        payload = {key: copy.deepcopy(record[key]) for key in self._PERSISTED_KEYS if key in record}
        # Recovery must be deterministic and must never accept a half record.
        if set(payload) != set(self._PERSISTED_KEYS):
            raise ValueError("session record is not recoverable")
        if (
            not isinstance(payload["session_id"], str)
            or not isinstance(payload["campaign_id"], str)
            or not isinstance(payload["investigator_id"], str)
            or not isinstance(payload["character_relpath"], str)
            or Path(payload["character_relpath"]).is_absolute()
            or ".." in Path(payload["character_relpath"]).parts
            or not isinstance(payload["brain_at_create"], str)
            or not isinstance(payload["resolved_config"], dict)
        ):
            raise ValueError("session record is not recoverable")
        payload["resolved_config"] = self._recoverable_config(payload["resolved_config"])
        if payload["resolved_config"].get("brain") != payload["brain_at_create"]:
            raise ValueError("session record is not recoverable")
        return payload

    @classmethod
    def _recoverable_config(cls, value: Any) -> Any:
        """Return a JSON-only frozen config or reject sensitive/pathful state."""
        def visit(current: Any) -> Any:
            if current is None or isinstance(current, (bool, int)):
                return current
            if isinstance(current, float):
                if not math.isfinite(current):
                    raise ValueError("session record is not recoverable")
                return current
            if isinstance(current, str):
                # Runtime configuration has no legitimate absolute filesystem
                # value. Relative command/config labels remain recoverable.
                if Path(current).is_absolute():
                    raise ValueError("session record is not recoverable")
                if any(
                    pattern.search(current)
                    for pattern in cls._UNRECOVERABLE_CONFIG_VALUE_PATTERNS
                ):
                    raise ValueError("session record is not recoverable")
                return current
            if isinstance(current, list):
                return [visit(item) for item in current]
            if isinstance(current, dict):
                clean: dict[str, Any] = {}
                for key, item in current.items():
                    normalized_key = (
                        re.sub(r"[^a-z0-9]", "", key.lower())
                        if isinstance(key, str) else ""
                    )
                    if not isinstance(key, str) or any(
                        marker in normalized_key
                        for marker in cls._UNRECOVERABLE_CONFIG_KEY_PARTS
                    ):
                        raise ValueError("session record is not recoverable")
                    clean[key] = visit(item)
                return clean
            raise ValueError("session record is not recoverable")

        return visit(value)

    def snapshot(self, workspace: Path | str) -> Path:
        """Atomically save recoverable metadata for exactly one workspace."""
        root, path = self._snapshot_path(workspace)
        now = self._now()
        with self._lock:
            self._expire_locked(now)
            records = [
                self._serialize_record(record)
                for _sid, record in sorted(self._sessions.items())
                if Path(record.get("workspace")).resolve(strict=False) == root
            ]
            payload = {
                "schema_version": self.SNAPSHOT_SCHEMA_VERSION,
                "sessions": records,
                "closed_session_ids": sorted(
                    session_id for session_id, owner in self._tombstones.items()
                    if owner == root
                ),
            }
        path.parent.mkdir(parents=True, exist_ok=True)
        temp = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
        try:
            temp.write_text(json.dumps(payload, ensure_ascii=True, indent=2) + "\n", encoding="utf-8")
            temp.replace(path)
        finally:
            if temp.exists():
                temp.unlink()
        return path

    def restore(self, workspace: Path | str) -> list[str]:
        """Restore one workspace snapshot using the supplied workspace root.

        The snapshot deliberately contains no path.  Passing a workspace is
        therefore mandatory and is the only source used to rebuild all paths.
        Malformed snapshots are rejected without partially changing memory.
        """
        root, path = self._snapshot_path(workspace)
        if not path.exists():
            return []
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ValueError("invalid session snapshot") from exc
        if (
            not isinstance(payload, dict)
            or set(payload) != {"schema_version", "sessions", "closed_session_ids"}
            or isinstance(payload["schema_version"], bool)
            or not isinstance(payload["schema_version"], int)
            or payload["schema_version"] != self.SNAPSHOT_SCHEMA_VERSION
        ):
            raise ValueError("invalid session snapshot")
        serialized = payload.get("sessions")
        closed = payload.get("closed_session_ids")
        if not isinstance(serialized, list) or not isinstance(closed, list) or not all(isinstance(s, str) for s in closed):
            raise ValueError("invalid session snapshot")
        paths = _load_paths()
        if len(set(closed)) != len(closed):
            raise ValueError("invalid session snapshot")
        closed_ids = set(closed)
        try:
            for sid in closed_ids:
                paths.validate_id(sid, "session_id")
        except ValueError as exc:
            raise ValueError("invalid session snapshot") from exc
        restored: list[tuple[str, dict[str, Any]]] = []
        restored_ids_seen: set[str] = set()
        for item in serialized:
            if not isinstance(item, dict) or set(item) != set(self._PERSISTED_KEYS):
                raise ValueError("invalid session snapshot")
            sid = self._require_session_id(item["session_id"])
            if sid in closed_ids or sid in restored_ids_seen:
                raise ValueError("invalid session snapshot")
            restored_ids_seen.add(sid)
            try:
                paths.validate_id(sid, "session_id")
                paths.validate_id(item["campaign_id"], "campaign_id")
                paths.validate_id(item["investigator_id"], "investigator_id")
                character_relpath = paths.canonical_workspace_relative_path(
                    root,
                    item["character_relpath"],
                    field="character_path",
                    allowed_root=paths.coc_root(root),
                )
                if character_relpath != item["character_relpath"]:
                    raise ValueError("invalid character_path")
                self._serialize_record(item)
            except (KeyError, TypeError, ValueError):
                raise ValueError("invalid session snapshot")
            restored_record = self._copy_record(item)
            restored_record["workspace"] = root
            restored.append((sid, restored_record))
        now = self._now()
        with self._lock:
            self._expire_locked(now)
            self._tombstones.update({session_id: root for session_id in closed_ids})
            restored_ids: list[str] = []
            for sid, record in restored:
                if sid in self._tombstones or sid in self._sessions:
                    continue
                record["last_access_monotonic"] = now
                self._sessions[sid] = record
                restored_ids.append(sid)
        return sorted(restored_ids)


_REGISTRY = SessionRegistry()
# Kept as a narrow compatibility alias for runtime path tests and callers that
# inspect whether validation registered a record.  It is not a public mutation
# API; access must go through the registry lock.
_SESSIONS = _REGISTRY._sessions


def _load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


def _engine_dir() -> Path:
    return Path(__file__).resolve().parent


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def _load_config():
    return _load_module("runtime_config", _engine_dir() / "config.py")


def _load_paths():
    return _load_module("runtime_paths", _engine_dir() / "paths.py")


def _load_public_state():
    return _load_module("runtime_public_state", _engine_dir() / "public_state.py")


def _load_debug_adapter():
    path = _repo_root() / "runtime" / "adapters" / "debug" / "adapter.py"
    return _load_module("runtime_debug_adapter", path)


def _load_pi_adapter():
    path = _repo_root() / "runtime" / "adapters" / "pi" / "adapter.py"
    return _load_module("runtime_pi_adapter", path)


def _validated_session_record(session_id: str, record: dict[str, Any]) -> dict[str, Any]:
    """Rebuild all paths from canonical record fields for every access."""
    paths = _load_paths()
    paths.validate_id(session_id, "session_id")
    root = paths.workspace_root(record["workspace"])
    campaign_id = paths.validate_id(record["campaign_id"], "campaign_id")
    investigator_id = paths.validate_id(record["investigator_id"], "investigator_id")
    campaign_dir = paths.campaign_dir(root, campaign_id)
    coc = paths.coc_root(root)
    character_relpath = record.get("character_relpath")
    if not isinstance(character_relpath, str) or Path(character_relpath).is_absolute():
        raise ValueError("invalid character_path")
    character_path = paths.contained_path(coc, root / character_relpath)
    if character_path.relative_to(root).as_posix() != character_relpath:
        raise ValueError("invalid character_path")
    state_paths = paths.campaign_save_paths(campaign_dir, investigator_id)
    config = copy.deepcopy(record.get("resolved_config"))
    if not isinstance(config, dict) or config.get("brain") != record.get("brain_at_create"):
        raise ValueError("invalid frozen runtime config")
    return {
        "session_id": session_id,
        "workspace": root,
        "campaign_id": campaign_id,
        "investigator_id": investigator_id,
        "character_relpath": character_relpath,
        "character_path": character_path,
        "campaign_dir": campaign_dir,
        "state_paths": state_paths,
        "brain_at_create": record["brain_at_create"],
        "resolved_config": config,
    }


def create_session(
    workspace: Path | str,
    *,
    campaign_id: str,
    investigator_id: str,
    character_path: Path | str | None = None,
) -> str:
    paths = _load_paths()
    root = paths.workspace_root(workspace)
    campaign_id = paths.validate_id(campaign_id, "campaign_id")
    investigator_id = paths.validate_id(investigator_id, "investigator_id")
    coc = paths.coc_root(root)
    campaign_dir = paths.campaign_dir(root, campaign_id)
    if character_path is None:
        resolved_character = paths.investigator_character_path(root, investigator_id)
    else:
        resolved_character = paths.contained_path(
            coc,
            Path(character_path) if Path(character_path).is_absolute() else root / Path(character_path),
        )
    character_relpath = paths.canonical_workspace_relative_path(
        root, resolved_character, field="character_path", allowed_root=coc,
    )
    paths.campaign_save_paths(campaign_dir, investigator_id)
    cfg = copy.deepcopy(_load_config().load_runtime_config(root))
    brain = cfg["brain"]
    return _REGISTRY.create({
        "workspace": root,
        "campaign_id": campaign_id,
        "investigator_id": investigator_id,
        "character_relpath": character_relpath,
        "resolved_config": cfg,
        "brain_at_create": brain,
    })


def get_session(session_id: str) -> dict[str, Any]:
    _load_paths().validate_id(session_id, "session_id")
    return _validated_session_record(session_id, _REGISTRY.get(session_id))


def send(
    session_id: str,
    player_input: str,
    *,
    subsystem_request: dict[str, Any] | None = None,
    pending_choice_response: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    record = get_session(session_id)
    brain = record["brain_at_create"]
    workspace = record["workspace"]
    campaign_id = record["campaign_id"]
    campaign_dir = record["campaign_dir"]
    character_path = record["character_path"]
    investigator_id = record["investigator_id"]
    forwarded_pending_response: dict[str, Any] | None = None
    if pending_choice_response is not None:
        if subsystem_request is not None:
            raise ValueError("submit either subsystem_request or pending_choice_response")
        state = _load_public_state().build_public_state(workspace, campaign_id, investigator_id)
        pending = state.get("pending_choice")
        if (
            not isinstance(pending, dict)
            or not isinstance(pending_choice_response, dict)
            or pending_choice_response.get("choice_id") != pending.get("choice_id")
            or pending_choice_response.get("responder") != "player"
            or pending_choice_response.get("revision") != pending.get("revision")
            or pending_choice_response.get("action") not in {
                option.get("action") for option in pending.get("options", []) if isinstance(option, dict)
            }
        ):
            raise ValueError("pending_choice_response does not match canonical player choice")
        if pending.get("kind") == "combat_defense":
            subsystem_request = {
                "kind": "combat_defend",
                "payload": {
                    "decision_id": f"runtime-defense-{pending['attack_id']}-{pending['revision']}",
                    "revision": pending["revision"], "actor_id": investigator_id,
                    "attack_command_id": pending["attack_id"],
                    "defense_kind": pending_choice_response["action"],
                },
            }
        else:
            forwarded_pending_response = dict(pending_choice_response)
    if brain == "debug":
        return _load_debug_adapter().debug_send_turn(
            workspace, campaign_dir, character_path, investigator_id, player_input,
            subsystem_request=subsystem_request, pending_choice_response=forwarded_pending_response,
        )
    if brain == "pi":
        if subsystem_request is not None:
            raise ValueError("typed subsystem_request is not supported by the pi brain")
        if forwarded_pending_response is not None:
            raise ValueError("typed pending_choice_response is not supported by the pi brain")
        return _load_pi_adapter().pi_send_turn({
            "workspace": str(workspace), "campaign_id": campaign_id,
            "investigator_id": investigator_id, "character_path": str(character_path),
            "player_text": player_input,
        })
    raise ValueError(f"unsupported brain: {brain!r}")


def get_state(session_id: str) -> dict[str, Any]:
    record = get_session(session_id)
    state = _load_public_state().build_public_state(
        record["workspace"], record["campaign_id"], record["investigator_id"],
    )
    state["brain"] = record["brain_at_create"]
    return state


def close_session(session_id: str) -> None:
    _load_paths().validate_id(session_id, "session_id")
    _REGISTRY.close(session_id)
