"""Bounded, recoverable in-process sessions for the COC runtime SDK."""
from __future__ import annotations

import copy
import fcntl
import hashlib
import importlib.util
import json
import math
import os
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


class TelemetryPersistenceError(RuntimeError):
    """A turn committed, but its required telemetry receipt did not persist."""

    kind = "telemetry_persistence_failed"
    turn_committed = True

    def __init__(self) -> None:
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
        worker_pool: Any | None = None,
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
        self._worker_pool = worker_pool
        self._worker_scopes: dict[str, list[Any]] = {}

    def register_worker_scope(self, session_id: str, worker_key: Any) -> None:
        with self._lock:
            scopes = self._worker_scopes.setdefault(session_id, [])
            if worker_key not in scopes:
                scopes.append(worker_key)

    def _close_worker_scopes(self, session_id: str) -> None:
        scopes = self._worker_scopes.pop(session_id, [])
        if self._worker_pool is not None:
            for worker_key in scopes:
                self._worker_pool.close_scope(worker_key)

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
            self._close_worker_scopes(session_id)
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
        # Freeze/validate the resolved pipeline at creation, not only when a
        # later snapshot happens to be requested.
        self._brain_label_for_config(candidate.get("resolved_config"))
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
            self._close_worker_scopes(sid)
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
        if self._brain_label_for_config(payload["resolved_config"]) != payload["brain_at_create"]:
            raise ValueError("session record is not recoverable")
        return payload

    @staticmethod
    def _brain_label_for_config(config: Mapping[str, Any]) -> str:
        """Compatibility display label derived from the frozen v2 pipeline.

        ``brain_at_create`` remains in the snapshot only so v1 SDK consumers
        can render a stable status label.  It is never used for dispatch;
        deterministic planner/rules execution comes from ``resolved_config``.
        """
        if not isinstance(config, Mapping):
            raise ValueError("session record is not recoverable")
        if config.get("schema_version") == 1 and isinstance(config.get("schema_version"), int):
            brain = config.get("brain")
            if brain in {"debug", "pi"}:
                return str(brain)
            raise ValueError("session record is not recoverable")
        expected = {"schema_version", "planner", "rules", "narrator", "player"}
        if (
            set(config) != expected
            or isinstance(config.get("schema_version"), bool)
            or not isinstance(config.get("schema_version"), int)
            or config.get("schema_version") != 2
        ):
            raise ValueError("session record is not recoverable")
        for name, kinds in {
            "planner": {"deterministic"},
            "rules": {"deterministic"},
            "narrator": {"template", "pi"},
            "player": {"human", "pi"},
        }.items():
            component = config.get(name)
            if not isinstance(component, Mapping) or set(component) != {"kind"}:
                raise ValueError("session record is not recoverable")
            if component.get("kind") not in kinds:
                raise ValueError("session record is not recoverable")
        return "pi" if config["narrator"]["kind"] == "pi" else "debug"

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


_PUBLIC_PLAYER_INTENT_FIELDS = frozenset({
    "primary_intent",
    "secondary_intents",
    "target_entities",
    "risk_posture",
    "explicit_roll_request",
    "player_hypothesis",
    "action_atoms",
    "npc_interactions",
})
_RISK_POSTURES = frozenset({"cautious", "neutral", "reckless"})


def _canonical_intent_classes() -> frozenset[str]:
    """Load the runtime enum that is contract-tested against the router."""
    path = _repo_root() / "runtime" / "adapters" / "player" / "adapter.py"
    adapter = _load_module("runtime_session_player_adapter", path)
    values = getattr(adapter, "CANONICAL_INTENT_CLASSES", None)
    if not isinstance(values, frozenset) or not all(type(item) is str for item in values):
        raise RuntimeError("canonical player intent enum is unavailable")
    return values


def _copy_json_only(value: Any, field: str) -> Any:
    """Copy a strict JSON value without coercing caller-owned structures."""
    if value is None or type(value) in {bool, int, str}:
        return value
    if type(value) is float:
        if not math.isfinite(value):
            raise ValueError(f"{field} must contain finite JSON numbers")
        return value
    if type(value) is list:
        return [
            _copy_json_only(item, f"{field}[{index}]")
            for index, item in enumerate(value)
        ]
    if type(value) is dict:
        copied: dict[str, Any] = {}
        for key, item in value.items():
            if type(key) is not str:
                raise TypeError(f"{field} JSON object keys must be strings")
            copied[key] = _copy_json_only(item, f"{field}.{key}")
        return copied
    raise TypeError(f"{field} must contain JSON-only values")


def _validate_json_object_list(value: Any, field: str) -> list[dict[str, Any]]:
    if type(value) is not list or not all(type(item) is dict for item in value):
        raise TypeError(f"{field} must be a list of JSON objects")
    return [_copy_json_only(item, f"{field}[{index}]") for index, item in enumerate(value)]


def _validate_player_intent(player_intent: Any) -> dict[str, Any]:
    """Validate caller-owned semantic evidence without interpreting prose."""
    if not isinstance(player_intent, Mapping):
        raise TypeError("player_intent must be an object")
    if set(player_intent) != _PUBLIC_PLAYER_INTENT_FIELDS:
        raise ValueError("player_intent must contain exactly the public intent fields")

    primary = player_intent["primary_intent"]
    if type(primary) is not str or primary not in _canonical_intent_classes():
        raise ValueError("player_intent.primary_intent is not canonical")

    string_lists: dict[str, list[str]] = {}
    for field in ("secondary_intents", "target_entities"):
        value = player_intent[field]
        if type(value) is not list or not all(type(item) is str for item in value):
            raise TypeError(f"player_intent.{field} must be a list of strings")
        string_lists[field] = list(value)

    risk_posture = player_intent["risk_posture"]
    if type(risk_posture) is not str or risk_posture not in _RISK_POSTURES:
        raise ValueError("player_intent.risk_posture is not canonical")
    explicit_roll_request = player_intent["explicit_roll_request"]
    if type(explicit_roll_request) is not bool:
        raise TypeError("player_intent.explicit_roll_request must be a boolean")
    player_hypothesis = player_intent["player_hypothesis"]
    if player_hypothesis is not None and type(player_hypothesis) is not str:
        raise TypeError("player_intent.player_hypothesis must be a string or null")

    return {
        "primary_intent": primary,
        "secondary_intents": string_lists["secondary_intents"],
        "target_entities": string_lists["target_entities"],
        "risk_posture": risk_posture,
        "explicit_roll_request": explicit_roll_request,
        "player_hypothesis": player_hypothesis,
        "action_atoms": _validate_json_object_list(
            player_intent["action_atoms"], "player_intent.action_atoms"
        ),
        "npc_interactions": _validate_json_object_list(
            player_intent["npc_interactions"], "player_intent.npc_interactions"
        ),
    }


def _validate_rng_seed(rng_seed: Any) -> int | str:
    if type(rng_seed) not in {int, str}:
        raise TypeError("rng_seed must be an exact non-boolean int or str")
    return rng_seed


def _ensure_worker_pool(registry: SessionRegistry):
    if registry._worker_pool is not None:
        return registry._worker_pool
    with registry._lock:
        if registry._worker_pool is None:
            pool_mod = _load_module(
                "runtime_session_worker_pool",
                _repo_root() / "runtime" / "adapters" / "worker_pool.py",
            )
            runner = (
                _repo_root()
                / "runtime" / "adapters" / "narrator" / "run_narration.mjs"
            )
            registry._worker_pool = pool_mod.JsonlWorkerPool(
                lambda _key: ["node", str(runner), "--server"],
                cwd=runner.parent,
            )
    return registry._worker_pool


def _narrator_worker_key(record: Mapping[str, Any]) -> dict[str, str]:
    runner = (
        _repo_root()
        / "runtime" / "adapters" / "narrator" / "run_narration.mjs"
    )
    return {
        "session_id": str(record["session_id"]),
        "campaign_id": str(record["campaign_id"]),
        "match_id": str(record["campaign_id"]),
        "role": f"narrator:{runner.resolve()}",
    }


def _load_events_module():
    path = _engine_dir() / "events.py"
    return _load_module("runtime_session_events", path)


def _load_telemetry_module():
    path = _engine_dir() / "telemetry.py"
    return _load_module("runtime_session_telemetry", path)


def _load_secret_audit_module():
    path = (
        _repo_root()
        / "plugins"
        / "coc-keeper"
        / "scripts"
        / "coc_secret_audit.py"
    )
    return _load_module("runtime_session_secret_audit", path)


def _replace_turn_narration(
    events: list[dict[str, Any]],
    raw_turn: dict[str, Any],
    narration: dict[str, Any],
) -> list[dict[str, Any]]:
    """Replace only a corresponding player narration event with safe Pi prose."""
    final_text = narration.get("final_text")
    if not isinstance(final_text, str) or not final_text.strip():
        return events
    decision_id = raw_turn.get("decision_id")
    retained = [
        event for event in events
        if not (
            isinstance(event, dict)
            and event.get("type") == "narration"
            and isinstance(event.get("payload"), dict)
            and event["payload"].get("decision_id") == decision_id
        )
    ]
    payload: dict[str, Any] = {"text": final_text.strip()}
    if isinstance(decision_id, str) and decision_id:
        payload["decision_id"] = decision_id
    retained.append(_load_events_module().make_event("narration", payload))
    return retained


def _safe_narration_envelope(envelope: dict[str, Any]) -> dict[str, Any]:
    """Defense in depth before an optional narrator adapter sees the envelope."""
    def clean(value: Any) -> Any:
        if isinstance(value, dict):
            return {
                key: clean(item)
                for key, item in value.items()
                if key not in {"rationale", "keeper_secrets", "director_rationale"}
            }
        if isinstance(value, list):
            return [clean(item) for item in value]
        return copy.deepcopy(value)
    return clean(envelope)


def _allowed_narrator_assertion_refs(envelope: Any) -> set[str]:
    """Derive a closed fact-ref set from structure, never generated prose."""

    omitted = {
        "must_not_reveal", "rationale", "keeper_secrets", "director_rationale",
    }
    refs: set[str] = set()

    def pointer_token(value: str) -> str:
        return value.replace("~", "~0").replace("/", "~1")

    def visit(value: Any, parts: list[str]) -> None:
        if isinstance(value, list):
            for index, item in enumerate(value):
                visit(item, [*parts, str(index)])
            return
        if isinstance(value, dict):
            for key in sorted(value):
                if isinstance(key, str) and key not in omitted:
                    visit(value[key], [*parts, key])
            return
        if value is None or type(value) in {str, int, float, bool}:
            pointer = "/" + "/".join(pointer_token(part) for part in parts)
            refs.add(f"envelope:{pointer}")

    if isinstance(envelope, dict):
        visit(envelope, [])
    return refs


def _validated_narrator_secret_audit(
    envelope: Any,
    narration: Any,
) -> dict[str, Any] | None:
    """Return canonical exact-coverage evidence, else force template fallback."""

    if (
        not isinstance(envelope, dict)
        or not isinstance(narration, dict)
        or narration.get("response_mode") != "tool"
        or narration.get("secret_audit_complete") is not True
    ):
        return None
    asserted = narration.get("asserted_fact_refs")
    semantic = narration.get("semantic_audit")
    if (
        not isinstance(asserted, list)
        or not isinstance(semantic, list)
        or any(
            not isinstance(ref, str) or not ref or ref != ref.strip()
            for ref in asserted
        )
        or len(set(asserted)) != len(asserted)
        or not set(asserted) <= _allowed_narrator_assertion_refs(envelope)
    ):
        return None
    raw_forbidden = envelope.get("must_not_reveal", [])
    if not isinstance(raw_forbidden, list):
        return None
    forbidden: list[str] = []
    for row in raw_forbidden:
        ref = row.get("id") if isinstance(row, dict) else None
        if not isinstance(ref, str) or not ref or ref != ref.strip() or ref in forbidden:
            return None
        forbidden.append(ref)
    try:
        receipt = _load_secret_audit_module().audit_secret_claims(
            forbidden, asserted, semantic
        )
    except Exception:
        return None
    return receipt if isinstance(receipt, dict) and receipt.get("passed") is True else None


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
    if not isinstance(config, dict):
        raise ValueError("invalid frozen runtime config")
    if SessionRegistry._brain_label_for_config(config) != record.get("brain_at_create"):
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
    brain = SessionRegistry._brain_label_for_config(cfg)
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
    player_intent: dict[str, Any] | None = None,
    rng_seed: int | str | None = None,
    subsystem_request: dict[str, Any] | None = None,
    pending_choice_response: dict[str, Any] | None = None,
    durability_mode: str = "normal",
) -> list[dict[str, Any]]:
    total_started = time.perf_counter()
    turn_kwargs: dict[str, Any] = {}
    if durability_mode not in {"normal", "checkpoint"}:
        raise ValueError("durability_mode must be normal or checkpoint")
    if durability_mode == "checkpoint":
        turn_kwargs["recording_mode"] = "sync"
        turn_kwargs["recording_flush"] = "manual"
    if player_intent is not None:
        normalized = _validate_player_intent(player_intent)
        turn_kwargs["intent_class"] = normalized["primary_intent"]
        turn_kwargs["player_intent_rich"] = normalized
    if rng_seed is not None:
        turn_kwargs["rng_seed"] = _validate_rng_seed(rng_seed)
    record = get_session(session_id)
    pipeline = record["resolved_config"]
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
    # Planner and rules are deliberately deterministic for every v2 pipeline.
    # Pi gets only an already-player-safe narration envelope after that work.
    dispatched = _load_debug_adapter().debug_send_turn(
        workspace, campaign_dir, character_path, investigator_id, player_input,
        include_result=True,
        subsystem_request=subsystem_request, pending_choice_response=forwarded_pending_response,
        **turn_kwargs,
    )
    events, raw_result = dispatched
    narrator_ms = 0.0
    fallback = False
    narrator_outcomes: list[dict[str, Any]] = []
    if not (
        isinstance(pipeline.get("narrator"), dict)
        and pipeline["narrator"].get("kind") == "pi"
    ):
        try:
            _record_turn_telemetry(
                record, raw_result, total_started, narrator_ms=0.0, fallback=False,
                input_tokens=None, output_tokens=None,
                narrator=_summarize_narrator_outcomes([]),
            )
        except Exception as exc:
            raise TelemetryPersistenceError() from exc
        return events
    usage_input: int | None = None
    usage_output: int | None = None
    secret_audits: list[dict[str, Any]] = []
    worker_pool = _ensure_worker_pool(_REGISTRY)
    worker_key = _narrator_worker_key(record)
    _REGISTRY.register_worker_scope(session_id, worker_key)
    for raw_turn in raw_result.get("turns") or []:
        if not isinstance(raw_turn, dict):
            continue
        envelope = raw_turn.get("narration_envelope")
        if not isinstance(envelope, dict):
            continue
        safe_envelope = _safe_narration_envelope(envelope)
        narrator_started = time.perf_counter()
        try:
            narrated = _narrate_with_coverage_retry(
                safe_envelope,
                player_text=player_input,
                pi_narrate=_load_pi_adapter().pi_narrate,
                worker_pool=worker_pool,
                worker_key=worker_key,
            )
        except Exception:  # narration rendering fails open to deterministic events
            narrator_ms += (time.perf_counter() - narrator_started) * 1000.0
            fallback = True
            narrator_outcomes.append({
                "model_identity": None,
                "response_mode": None,
                "deterministic_fallback": True,
            })
            continue
        narrator_ms += (time.perf_counter() - narrator_started) * 1000.0
        narration = narrated["narration"]
        deterministic_fallback = narrated["deterministic_fallback"]
        usage = narration.get("usage") if isinstance(narration, dict) else None
        if isinstance(usage, dict):
            raw_input = usage.get("input_tokens")
            raw_output = usage.get("output_tokens")
            if isinstance(raw_input, int) and not isinstance(raw_input, bool):
                usage_input = (usage_input or 0) + raw_input
            if isinstance(raw_output, int) and not isinstance(raw_output, bool):
                usage_output = (usage_output or 0) + raw_output
        narrator_outcomes.append({
            "model_identity": copy.deepcopy(narration.get("model_identity"))
            if isinstance(narration, dict) else None,
            "response_mode": narration.get("response_mode")
            if isinstance(narration, dict) else None,
            "deterministic_fallback": deterministic_fallback,
        })
        if deterministic_fallback:
            fallback = True
            continue
        secret_audits.append(copy.deepcopy(narrated["secret_audit"]))
        events = _replace_turn_narration(events, raw_turn, narration)
    try:
        _record_turn_telemetry(
            record, raw_result, total_started, narrator_ms=narrator_ms, fallback=fallback,
            input_tokens=usage_input, output_tokens=usage_output,
            narrator=_summarize_narrator_outcomes(narrator_outcomes),
            secret_audits=secret_audits,
        )
    except Exception as exc:
        raise TelemetryPersistenceError() from exc
    return events


def _write_secret_audit_receipt(
    campaign_dir: Path | str,
    *,
    session_id: str,
    investigator_id: str,
    runtime_receipt_sha256: str,
    decision_ids: list[str],
    secret_audits: list[dict[str, Any]],
) -> None:
    """Persist narrator secret-audit receipts bound to the turn runtime digest."""
    telemetry = _load_telemetry_module()
    receipt = {
        "schema_version": 1,
        "session_id": session_id,
        "investigator_id": investigator_id,
        "decision_ids": list(decision_ids),
        "runtime_receipt_sha256": runtime_receipt_sha256,
        "secret_audits": copy.deepcopy(secret_audits),
    }
    encoded = (
        json.dumps(receipt, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
        + "\n"
    ).encode("utf-8")
    logs_fd = telemetry._open_logs_dir(campaign_dir, create=True)
    fd = -1
    try:
        fd = telemetry._open_log_file(
            logs_fd,
            "narrator-secret-audits.jsonl",
            os.O_WRONLY | os.O_CREAT | os.O_APPEND,
        )
        fcntl.flock(fd, fcntl.LOCK_EX)
        try:
            telemetry._write_all(fd, encoded)
            os.fsync(fd)
        finally:
            fcntl.flock(fd, fcntl.LOCK_UN)
        os.fsync(logs_fd)
    finally:
        if fd >= 0:
            os.close(fd)
        os.close(logs_fd)


def _read_secret_audits_for_runtime(
    campaign_dir: Path | str,
    runtime_receipt_sha256: str,
) -> list[dict[str, Any]]:
    """Load secret-audit receipts for one runtime turn digest; missing means []."""
    telemetry = _load_telemetry_module()
    try:
        payload = telemetry._read_log_bytes(
            campaign_dir, "narrator-secret-audits.jsonl", missing_ok=True
        )
    except ValueError:
        return []
    if not payload:
        return []
    matches: list[list[dict[str, Any]]] = []
    for encoded in payload.split(b"\n"):
        if not encoded:
            continue
        try:
            row = json.loads(encoded.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            continue
        if (
            not isinstance(row, dict)
            or row.get("schema_version") != 1
            or row.get("runtime_receipt_sha256") != runtime_receipt_sha256
            or not isinstance(row.get("secret_audits"), list)
        ):
            continue
        audits = [item for item in row["secret_audits"] if isinstance(item, dict)]
        if len(audits) != len(row["secret_audits"]):
            continue
        matches.append(copy.deepcopy(audits))
    if len(matches) != 1:
        return []
    return matches[0]


def _record_turn_telemetry(
    record: dict[str, Any],
    raw_result: dict[str, Any],
    total_started: float,
    *,
    narrator_ms: float,
    fallback: bool,
    input_tokens: int | None,
    output_tokens: int | None,
    narrator: dict[str, Any],
    secret_audits: list[dict[str, Any]] | None = None,
) -> None:
    """Persist only timing/attestation metadata, never prompts or player text."""
    phase = raw_result.get("runtime_phase_ms") if isinstance(raw_result, dict) else {}
    phase = phase if isinstance(phase, dict) else {}
    pipeline = record["resolved_config"]
    runner = {
        name: str(component.get("kind"))
        for name, component in pipeline.items()
        if name in {"planner", "rules", "narrator", "player"}
        and isinstance(component, dict)
        and isinstance(component.get("kind"), str)
    }
    runner["worker"] = (
        "jsonl_pool" if pipeline.get("narrator", {}).get("kind") == "pi"
        else "in_process"
    )
    total_ms = max(0.0, (time.perf_counter() - total_started) * 1000.0)
    parts = (
        float(phase.get("intent_ms") or 0.0),
        float(phase.get("director_ms") or 0.0),
        float(phase.get("rules_ms") or 0.0),
        float(phase.get("persistence_ms") or 0.0),
        0.0,
        max(0.0, narrator_ms),
    )
    telemetry = _load_telemetry_module().make_telemetry(
        intent_ms=max(0.0, parts[0]), director_ms=max(0.0, parts[1]),
        rules_ms=max(0.0, parts[2]), persistence_ms=max(0.0, parts[3]),
        player_llm_ms=0.0, narrator_llm_ms=parts[5],
        total_ms=max(total_ms, sum(parts)), input_tokens=input_tokens,
        output_tokens=output_tokens,
        fallback=bool(fallback), runner=runner,
        narrator=narrator,
    )
    decisions = [
        turn.get("decision_id") for turn in (raw_result.get("turns") or [])
        if isinstance(turn, dict) and isinstance(turn.get("decision_id"), str)
    ]
    runtime_digest = str(raw_result.get("runtime_receipt_sha256") or "")
    _load_telemetry_module().write_receipt(
        record["campaign_dir"], session_id=record["session_id"],
        investigator_id=record["investigator_id"], telemetry=telemetry,
        runtime_receipt_sha256=runtime_digest,
        decision_ids=decisions,
    )
    audits = [
        copy.deepcopy(item)
        for item in (secret_audits or [])
        if isinstance(item, dict)
    ]
    if runtime_digest and re.fullmatch(r"[0-9a-f]{64}", runtime_digest):
        _write_secret_audit_receipt(
            record["campaign_dir"],
            session_id=record["session_id"],
            investigator_id=record["investigator_id"],
            runtime_receipt_sha256=runtime_digest,
            decision_ids=decisions,
            secret_audits=audits,
        )


def get_telemetry_receipts(session_id: str) -> list[dict[str, Any]]:
    """Reload this session's durable, privacy-safe telemetry receipts."""
    record = get_session(session_id)
    return [
        receipt for receipt in _load_telemetry_module().read_receipts(record["campaign_dir"])
        if receipt.get("session_id") == session_id
    ]


# Bounded retries for an intermittent narrator coverage-fail. The GLM tool call
# is non-deterministic: the same player-safe envelope can fail the secret-audit
# coverage check on one invocation and pass on the next. A single coverage-fail
# must not force a deterministic fallback (which makes ``validate_attestation``
# reject the whole turn as inconsistent). Retry the *same* envelope a small,
# bounded number of times before degrading. This never relaxes the audit: every
# attempt still passes through ``_validated_narrator_secret_audit``, so a
# narration that would leak a secret can never pass — it only gives an
# intermittently-failing-but-correct narration another chance.
_NARRATOR_COVERAGE_RETRY_MAX = 2


def _narrate_with_coverage_retry(
    envelope: dict[str, Any],
    *,
    player_text: str,
    pi_narrate: Any,
    worker_pool: Any = None,
    worker_key: Any = None,
) -> dict[str, Any]:
    """Call ``pi_narrate`` for one envelope, retrying on coverage-fail.

    Returns a dict with: ``narration`` (the last narration returned, even when
    the audit failed), ``secret_audit`` (the validated receipt, or None when the
    budget was exhausted), ``deterministic_fallback`` (True when no audit), and
    ``attempts`` (number of ``pi_narrate`` invocations made).

    A hard exception from ``pi_narrate`` is not retried here (the caller's
    ``except`` path owns the fails-open fallback) — this helper only retries the
    case where the model returned a result but the secret-audit coverage check
    rejected it.
    """
    request = {
        "narration_envelope": envelope,
        "last_player_text": player_text,
        "play_language": "zh-Hans",
        "recent_narrations": [],
    }
    narration: Any = None
    attempts = 0
    for _ in range(_NARRATOR_COVERAGE_RETRY_MAX + 1):
        attempts += 1
        narration = pi_narrate(
            request, worker_pool=worker_pool, worker_key=worker_key
        )
        secret_audit = _validated_narrator_secret_audit(envelope, narration)
        if secret_audit is not None:
            return {
                "narration": narration,
                "secret_audit": secret_audit,
                "deterministic_fallback": False,
                "attempts": attempts,
            }
    return {
        "narration": narration,
        "secret_audit": None,
        "deterministic_fallback": True,
        "attempts": attempts,
    }


def _summarize_narrator_outcomes(
    outcomes: list[dict[str, Any]],
) -> dict[str, Any]:
    """Collapse adapter outcomes without retaining prose, prompts, or envelopes."""
    if not outcomes:
        return {
            "call_count": 0,
            "model_identity": None,
            "response_mode": None,
            "consistent": True,
            "deterministic_fallback": False,
        }
    first_identity = copy.deepcopy(outcomes[0].get("model_identity"))
    first_mode = outcomes[0].get("response_mode")
    deterministic_fallback = any(
        outcome.get("deterministic_fallback") is True for outcome in outcomes
    )
    consistent = (
        isinstance(first_identity, dict)
        and set(first_identity) == {"provider", "id"}
        and all(isinstance(first_identity.get(key), str) and first_identity[key]
                for key in ("provider", "id"))
        and first_mode in {"tool", "prose_fallback"}
        and not deterministic_fallback
        and all(
            outcome.get("model_identity") == first_identity
            and outcome.get("response_mode") == first_mode
            and outcome.get("deterministic_fallback") is False
            for outcome in outcomes
        )
    )
    return {
        "call_count": len(outcomes),
        "model_identity": first_identity if isinstance(first_identity, dict) else None,
        "response_mode": first_mode if first_mode in {"tool", "prose_fallback"} else None,
        "consistent": consistent,
        "deterministic_fallback": deterministic_fallback,
    }


def get_last_turn_attestation(session_id: str) -> dict[str, Any]:
    """Return a privacy-safe digest and narrator outcome for the durable turn."""
    record = get_session(session_id)
    try:
        receipts = _load_telemetry_module().read_receipts_strict(record["campaign_dir"])
    except ValueError as exc:
        raise RuntimeError("last turn telemetry receipt is unavailable") from exc
    matching_receipts = [
        receipt for receipt in receipts if receipt.get("session_id") == session_id
    ]
    if not matching_receipts:
        raise RuntimeError("last turn telemetry receipt is unavailable")
    receipt = matching_receipts[-1]
    try:
        runtime_rows = _load_telemetry_module().read_jsonl_objects_strict(
            record["campaign_dir"], "live-turn-runtime.jsonl"
        )
    except ValueError as exc:
        raise RuntimeError("last turn runtime receipt is unavailable") from exc
    expected_runtime_digest = receipt.get("runtime_receipt_sha256")
    matching_runtime_rows = []
    for candidate in runtime_rows:
        encoded_candidate = json.dumps(
            candidate, ensure_ascii=False, sort_keys=True,
            separators=(",", ":"), allow_nan=False,
        ).encode("utf-8")
        if hashlib.sha256(encoded_candidate).hexdigest() == expected_runtime_digest:
            matching_runtime_rows.append(candidate)
    if len(matching_runtime_rows) != 1:
        raise RuntimeError("last turn runtime receipt digest is missing or ambiguous")
    runtime_row = matching_runtime_rows[0]
    if (
        not isinstance(runtime_row, dict)
        or runtime_row.get("schema_version") != 1
        or runtime_row.get("event_type") != "live_turn_runtime"
        or runtime_row.get("investigator_id") != record["investigator_id"]
        or runtime_row.get("decision_ids") != receipt.get("decision_ids")
        or receipt.get("investigator_id") != record["investigator_id"]
    ):
        raise RuntimeError("last turn receipts do not agree")
    encoded = json.dumps(
        runtime_row,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")
    runtime_receipt_sha256 = hashlib.sha256(encoded).hexdigest()
    if receipt.get("runtime_receipt_sha256") != runtime_receipt_sha256:
        raise RuntimeError("last turn telemetry/runtime digest binding mismatch")
    telemetry = receipt.get("telemetry")
    if not isinstance(telemetry, dict):
        raise RuntimeError("last turn telemetry receipt is unavailable")
    narrator = telemetry.get("narrator")
    if not isinstance(narrator, dict):
        raise RuntimeError("last turn narrator attestation is unavailable")
    usage = {
        "input_tokens": telemetry.get("input_tokens"),
        "output_tokens": telemetry.get("output_tokens"),
    }
    for field, value in usage.items():
        if value is not None and (
            isinstance(value, bool) or not isinstance(value, int) or value < 0
        ):
            raise RuntimeError("last turn narrator usage is unavailable")
    latency = telemetry.get("narrator_llm_ms")
    if (
        isinstance(latency, bool)
        or not isinstance(latency, (int, float))
        or latency < 0
        or latency != latency
        or latency in (float("inf"), float("-inf"))
    ):
        raise RuntimeError("last turn narrator latency is unavailable")
    secret_audits = _read_secret_audits_for_runtime(
        record["campaign_dir"], runtime_receipt_sha256
    )
    return {
        "schema_version": 1,
        "session_id": session_id,
        "investigator_id": record["investigator_id"],
        "decision_ids": list(receipt["decision_ids"]),
        "telemetry_receipt_id": receipt["receipt_id"],
        "runtime_receipt_sha256": runtime_receipt_sha256,
        "recording_mode": runtime_row.get("recording_mode"),
        "recording_flush": runtime_row.get("recording_flush"),
        "usage": usage,
        "narrator_llm_ms": float(latency),
        "narrator": copy.deepcopy(narrator),
        "secret_audits": secret_audits,
    }


def get_state(session_id: str) -> dict[str, Any]:
    record = get_session(session_id)
    state = _load_public_state().build_public_state(
        record["workspace"], record["campaign_id"], record["investigator_id"],
    )
    state["brain"] = record["brain_at_create"]
    return state


def snapshot_workspace_sessions(workspace: Path | str) -> Path:
    """Persist the sanitized recoverable sessions owned by one workspace."""
    root = _load_paths().workspace_root(workspace)
    return _REGISTRY.snapshot(root)


def restore_workspace_sessions(workspace: Path | str) -> list[str]:
    """Restore a sanitized workspace snapshot into this process registry."""
    root = _load_paths().workspace_root(workspace)
    return _REGISTRY.restore(root)


def close_session(session_id: str) -> None:
    _load_paths().validate_id(session_id, "session_id")
    _REGISTRY.close(session_id)
