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


class KeeperFinalizationBlockedError(RuntimeError):
    """A Keeper may have settled state, but exact finalized output was blocked."""

    kind = "keeper_finalization_blocked"
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


def _load_plugin_locator():
    return _load_module("runtime_plugin_locator", _engine_dir() / "plugin_locator.py")


def _load_public_state():
    return _load_module("runtime_public_state", _engine_dir() / "public_state.py")


def _load_keeper_adapter():
    path = _repo_root() / "runtime" / "adapters" / "keeper" / "adapter.py"
    return _load_module("runtime_keeper_adapter", path)


def _load_intent_contract():
    return _load_module("runtime_intent_contract", _engine_dir() / "intent_contract.py")


def _validate_player_intent(player_intent: Any) -> dict[str, Any]:
    """Delegate validation to the host-neutral structured intent contract."""
    contract = _load_intent_contract()
    return contract.validate_player_intent(player_intent)


def _validate_rng_seed(rng_seed: Any) -> int | str:
    if type(rng_seed) not in {int, str}:
        raise TypeError("rng_seed must be an exact non-boolean int or str")
    return rng_seed


def _load_events_module():
    path = _engine_dir() / "events.py"
    return _load_module("runtime_session_events", path)


def _load_telemetry_module():
    path = _engine_dir() / "telemetry.py"
    return _load_module("runtime_session_telemetry", path)


def _load_runtime_ops_module(workspace: Path | str | None = None):
    path = _load_plugin_locator().plugin_scripts_dir(workspace) / "coc_runtime_ops.py"
    return _load_module("runtime_session_coc_runtime_ops", path)


def _load_operation_router_module():
    path = _repo_root() / "runtime" / "adapters" / "pi" / "operation_router.py"
    return _load_module("runtime_session_operation_router", path)


def setup_workspace_operation(
    workspace: Path | str,
    operation: dict[str, Any],
) -> dict[str, Any]:
    """Execute canonical onboarding before a runtime session exists."""
    root = _load_paths().workspace_root(workspace)
    return _load_runtime_ops_module(root).execute_setup_operation(
        root, operation=operation
    )


def _file_size(path: Path) -> int:
    try:
        return path.stat().st_size
    except OSError:
        return 0


def _read_new_jsonl_rows(path: Path, offset: int) -> list[dict[str, Any]]:
    """Read JSONL rows appended after ``offset`` bytes; tolerant of bad lines."""
    rows: list[dict[str, Any]] = []
    try:
        with path.open("rb") as handle:
            handle.seek(offset)
            payload = handle.read()
    except OSError:
        return rows
    for encoded in payload.split(b"\n"):
        if not encoded.strip():
            continue
        try:
            row = json.loads(encoded.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            continue
        if isinstance(row, dict):
            rows.append(row)
    return rows


_ROLL_EVENT_STRING_FIELDS = (
    "roll_id", "decision_id", "kind", "skill", "characteristic",
    "difficulty", "outcome", "damage_kind", "reward_kind", "die",
)
_ROLL_EVENT_INT_FIELDS = (
    "target", "effective_target", "bonus_penalty_dice", "san_loss",
    "san_before", "san_after", "hp_before", "hp_delta", "hp_after",
    "flat_modifier",
)
_ROLL_EVENT_BOOL_FIELDS = ("success", "pushed", "bout_triggered")
_PLAYER_ROLL_VISIBILITIES = frozenset({"public", "consequence_public", "player"})


def _project_roll_event(events_mod: Any, row: dict[str, Any]) -> dict[str, Any] | None:
    """Project one canonical or legacy roll-log row onto the public schema.

    Canonical v2 logs place mechanics inside ``payload`` and reserve the outer
    row for identity, visibility and provenance.  Older logs kept those fields
    flat.  Read both shapes through a closed allowlist so the runtime neither
    drops new evidence nor forwards keeper-only metadata.
    """
    nested = row.get("payload")
    sources = [nested, row] if isinstance(nested, dict) else [row]

    visibilities = [
        source.get("visibility")
        for source in sources
        if isinstance(source.get("visibility"), str)
        and source.get("visibility")
    ]
    if any(value not in _PLAYER_ROLL_VISIBILITIES for value in visibilities):
        return None

    if isinstance(nested, dict):
        outer_roll_id = row.get("roll_id")
        inner_roll_id = nested.get("roll_id")
        if (
            isinstance(outer_roll_id, str)
            and outer_roll_id
            and isinstance(inner_roll_id, str)
            and inner_roll_id
            and outer_roll_id != inner_roll_id
        ):
            return None

    def first(field: str) -> Any:
        for source in sources:
            if field in source:
                return source[field]
        return None

    payload: dict[str, Any] = {}
    roll = first("roll")
    check = first("check")
    if roll is None and isinstance(check, dict):
        roll = check.get("roll")
    if roll is None:
        for alias in ("total", "final_total", "raw_roll"):
            candidate = first(alias)
            if isinstance(candidate, int) and not isinstance(candidate, bool):
                roll = candidate
                break
    dice = first("dice")
    if roll is None and isinstance(dice, dict):
        roll = dice.get("total")
    if isinstance(roll, bool) or not isinstance(roll, int):
        return None
    payload["roll"] = roll
    for field in _ROLL_EVENT_STRING_FIELDS:
        value = first(field)
        if isinstance(value, str) and value:
            payload[field] = value
    if "decision_id" not in payload:
        command_id = first("command_id")
        if isinstance(command_id, str) and command_id:
            payload["decision_id"] = command_id
    if "kind" not in payload:
        semantic_event_type = first("event_type")
        if (
            isinstance(semantic_event_type, str)
            and semantic_event_type
            and semantic_event_type != "roll"
        ):
            payload["kind"] = semantic_event_type
    if "die" not in payload:
        for alias in ("die_expression", "expression"):
            value = first(alias)
            if isinstance(value, str) and value:
                payload["die"] = value
                break
        if "die" not in payload and isinstance(dice, dict):
            value = dice.get("expression")
            if isinstance(value, str) and value:
                payload["die"] = value
    for field in _ROLL_EVENT_INT_FIELDS:
        value = first(field)
        if not isinstance(value, bool) and isinstance(value, int):
            payload[field] = value
    for field in _ROLL_EVENT_BOOL_FIELDS:
        value = first(field)
        if isinstance(value, bool):
            payload[field] = value
    if "success" not in payload and isinstance(payload.get("outcome"), str):
        payload["success"] = payload["outcome"] in {
            "regular", "hard", "extreme", "critical",
            "regular_success", "hard_success", "extreme_success",
            "critical_success", "success",
        }
    raw_die_rolls = None
    for alias in ("die_rolls", "rolls", "individual_faces"):
        candidate = first(alias)
        if isinstance(candidate, list):
            raw_die_rolls = candidate
            break
    if raw_die_rolls is None and isinstance(dice, dict):
        raw_die_rolls = dice.get("raw")
    if isinstance(raw_die_rolls, list) and all(
        isinstance(value, int) and not isinstance(value, bool)
        for value in raw_die_rolls
    ):
        payload["die_rolls"] = list(raw_die_rolls)
    try:
        return events_mod.make_event("roll", payload)
    except ValueError:
        return None


def _project_keeper_turn_events(
    campaign_dir: Path,
    offsets: dict[str, int],
    narration_text: str,
    *,
    finalization: dict[str, Any],
    workspace: Path,
    campaign_id: str,
) -> list[dict[str, Any]]:
    """Build one finalized player output plus keeper audit/state events.

    ``turn.finalize`` already owns the deterministic public dice and mechanical
    receipts inside ``narration_text``.  Projecting raw roll events as well
    would display the same die twice.
    """
    events_mod = _load_events_module()
    events: list[dict[str, Any]] = []
    for row in _read_new_jsonl_rows(
        campaign_dir / "logs" / "toolbox-calls.jsonl", offsets["toolbox"]
    ):
        events.append(events_mod.make_event(
            "tool_call",
            {
                "tool": row.get("tool"),
                "ok": row.get("ok"),
                "args": row.get("args"),
                "warnings": row.get("warnings"),
            },
            visibility="keeper",
        ))
    if finalization.get("rendered_sha256") != _canonical_finalized_text_digest(
        narration_text
    ):
        raise KeeperFinalizationBlockedError()
    events.append(events_mod.make_event("narration", {"text": narration_text}))
    try:
        state = _load_public_state().build_public_state(
            workspace, campaign_id, None,
        )
    except Exception:
        state = None
    if isinstance(state, dict):
        final_state: dict[str, Any] = {}
        scene = state.get("active_scene_id")
        if isinstance(scene, str) and scene:
            final_state["active_scene"] = scene
        tension = state.get("tension_level")
        if isinstance(tension, str) and tension:
            final_state["tension"] = tension
        turn_number = state.get("turn_number")
        if isinstance(turn_number, int) and not isinstance(turn_number, bool):
            final_state["turn_number"] = turn_number
        if final_state:
            try:
                events.append(events_mod.make_event(
                    "state_patch",
                    {
                        "final_state": final_state,
                        "state_patch": {"applied": True},
                    },
                ))
            except ValueError:
                pass
    return events


def _keeper_turn_decision_ids(campaign_dir: Path, toolbox_offset: int) -> list[str]:
    """Project committed toolbox decision IDs into the runtime attestation."""
    result: list[str] = []
    for row in _read_new_jsonl_rows(
        campaign_dir / "logs" / "toolbox-calls.jsonl", toolbox_offset
    ):
        args = row.get("args")
        value = args.get("decision_id") if isinstance(args, dict) else None
        if value is None:
            value = row.get("decision_id")
        if isinstance(value, str) and value and value not in result:
            result.append(value)
    return result


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


_KEEPER_TURN_RETRY_MAX = 1


def _canonical_finalized_text_digest(text: str) -> str:
    encoded = json.dumps(
        text, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")
    return f"sha256:{hashlib.sha256(encoded).hexdigest()}"


def _finalized_keeper_texts_by_turn(campaign_dir: Path) -> dict[int, str]:
    """Resolve valid finalized text onto its authoritative journal turn."""
    calls = _read_new_jsonl_rows(campaign_dir / "logs" / "toolbox-calls.jsonl", 0)
    rows = _read_new_jsonl_rows(
        campaign_dir / "logs" / "turn-finalizations.jsonl", 0
    )
    adapter = _load_keeper_adapter()
    result: dict[int, str] = {}
    for row in rows:
        try:
            adapter.validate_finalization_receipt(row)
        except adapter.KeeperFinalizationError:
            continue
        index = row.get("journal_call_index")
        if (
            isinstance(index, bool)
            or not isinstance(index, int)
            or index < 0
            or index >= len(calls)
        ):
            continue
        call = calls[index]
        args = call.get("args") if isinstance(call.get("args"), dict) else {}
        data = call.get("data") if isinstance(call.get("data"), dict) else {}
        turn_number = data.get("turn_number")
        if (
            call.get("ok") is not True
            or call.get("tool") != "state.journal"
            or args.get("decision_id") != row.get("journal_decision_id")
            or isinstance(turn_number, bool)
            or not isinstance(turn_number, int)
            or turn_number in result
        ):
            continue
        result[turn_number] = row["rendered_text"]
    return result


def _recent_public_transcript(campaign_dir: Path, limit: int = 12) -> list[dict[str, str]]:
    """Rebuild a public tail, preferring exact finalized text over summaries."""
    tail: list[dict[str, str]] = []
    finalized_by_turn = _finalized_keeper_texts_by_turn(campaign_dir)
    rows = _read_new_jsonl_rows(campaign_dir / "logs" / "events.jsonl", 0)
    for row in rows:
        if row.get("event_type") != "turn":
            continue
        player_action = row.get("player_action")
        summary = row.get("summary")
        if isinstance(player_action, str) and player_action.strip():
            tail.append({"role": "player", "text": player_action.strip()})
        turn_number = row.get("turn_number")
        finalized = (
            finalized_by_turn.get(turn_number)
            if isinstance(turn_number, int) and not isinstance(turn_number, bool)
            else None
        )
        if isinstance(finalized, str) and finalized.strip():
            tail.append({"role": "keeper", "text": finalized})
        elif isinstance(summary, str) and summary.strip():
            tail.append({"role": "keeper", "text": summary.strip()})
    return tail[-limit:]


def send(
    session_id: str,
    player_input: str,
    *,
    player_intent: dict[str, Any] | None = None,
    rng_seed: int | str | None = None,
) -> list[dict[str, Any]]:
    """Run one keeper turn through the skills-enabled keeper coding agent.

    The keeper LLM reads the canonical skill tree and drives the turn with
    ``coc_toolbox.py`` calls; this engine releases only the exact canonical
    ``turn.finalize`` output. There is no alternate narration envelope or
    deterministic template fallback. A pre-settlement spawn failure retains
    one bounded retry; any possibly settled failure is blocked without replay.
    """
    total_started = time.perf_counter()
    if player_intent is not None:
        player_intent = _validate_player_intent(player_intent)
    if rng_seed is not None:
        rng_seed = _validate_rng_seed(rng_seed)
    record = get_session(session_id)
    workspace = record["workspace"]
    campaign_id = record["campaign_id"]
    campaign_dir = record["campaign_dir"]

    play_language = "zh-Hans"
    try:
        state = _load_public_state().build_public_state(
            workspace, campaign_id, record["investigator_id"]
        )
        if isinstance(state.get("play_language"), str) and state["play_language"]:
            play_language = state["play_language"]
    except Exception:
        pass

    request: dict[str, Any] = {
        "workspace": str(workspace),
        "campaign_id": campaign_id,
        "investigator_id": record["investigator_id"],
        "player_input": player_input,
        "play_language": play_language,
        "transcript_tail": _recent_public_transcript(campaign_dir),
    }
    if player_intent is not None:
        request["player_intent"] = player_intent
    if rng_seed is not None:
        request["rng_seed"] = rng_seed

    offsets = {
        "toolbox": _file_size(campaign_dir / "logs" / "toolbox-calls.jsonl"),
        "rolls": _file_size(campaign_dir / "logs" / "rolls.jsonl"),
        "finalizations": _file_size(
            campaign_dir / "logs" / "turn-finalizations.jsonl"
        ),
    }
    request["finalization_offset"] = offsets["finalizations"]

    keeper = _load_keeper_adapter()
    runner_override = os.environ.get("COC_KEEPER_RUNNER") or None
    result: dict[str, Any] | None = None
    last_error: Exception | None = None
    for _ in range(_KEEPER_TURN_RETRY_MAX + 1):
        try:
            result = keeper.keeper_send_turn(request, runner_path=runner_override)
            break
        except keeper.KeeperFinalizationError as exc:
            raise KeeperFinalizationBlockedError() from exc
        except RuntimeError as exc:
            # A crashed runner is safe to cold-retry only while it has left no
            # new toolbox/finalization evidence.  Once the agent may have
            # settled state, replaying the whole turn with new decisions is
            # more dangerous than failing closed.
            if (
                _file_size(campaign_dir / "logs" / "toolbox-calls.jsonl")
                != offsets["toolbox"]
                or _file_size(campaign_dir / "logs" / "turn-finalizations.jsonl")
                != offsets["finalizations"]
            ):
                raise KeeperFinalizationBlockedError() from exc
            last_error = exc
    if result is None:
        raise RuntimeError(f"keeper turn failed: {last_error}") from last_error

    try:
        canonical_receipt = keeper.load_new_finalization_receipt(
            campaign_dir / "logs" / "turn-finalizations.jsonl",
            offsets["finalizations"],
        )
        canonical_projection = keeper.finalization_projection(canonical_receipt)
    except keeper.KeeperFinalizationError as exc:
        raise KeeperFinalizationBlockedError() from exc
    narration_text = result.get("narration")
    finalization = result.get("finalization")
    if (
        not isinstance(narration_text, str)
        or finalization != canonical_projection
        or narration_text != canonical_receipt["rendered_text"]
    ):
        raise KeeperFinalizationBlockedError()
    events = _project_keeper_turn_events(
        campaign_dir, offsets, narration_text,
        finalization=finalization,
        workspace=workspace, campaign_id=campaign_id,
    )
    decision_ids = _keeper_turn_decision_ids(campaign_dir, offsets["toolbox"])
    try:
        _record_turn_telemetry(
            record, total_started,
            narration_text=narration_text,
            model_identity=result.get("model_identity"),
            usage=result.get("usage"),
            decision_ids=decision_ids,
            finalization=finalization,
        )
    except Exception as exc:
        raise TelemetryPersistenceError() from exc
    return events


def interact(
    session_id: str,
    player_input: str,
    *,
    semantic_route: dict[str, Any] | None = None,
    rng_seed: int | str | None = None,
) -> dict[str, Any]:
    """Natural-language entry that semantically selects turn vs typed operation.

    Coding-plugin hosts may provide their own structured semantic evidence.
    A Pi composition obtains the same shape from its constrained semantic
    router.  No runtime code classifies free prose with keyword heuristics.
    """
    if not isinstance(player_input, str) or not player_input.strip():
        raise ValueError("player_input must be non-empty")
    record = get_session(session_id)
    ops = _load_runtime_ops_module(record["workspace"])
    provenance: dict[str, Any] = {"source": "host_semantic_evidence"}
    if semantic_route is None:
        pipeline = record["resolved_config"]
        if (
            isinstance(pipeline.get("narrator"), dict)
            and pipeline["narrator"].get("kind") == "pi"
        ):
            routed = _load_operation_router_module().route_player_action(
                player_input,
                _load_public_state().build_public_state(
                    record["workspace"], record["campaign_id"], record["investigator_id"]
                ),
            )
            semantic_route = routed["semantic_route"]
            provenance = {
                "source": "pi_semantic_router",
                "model_identity": copy.deepcopy(routed.get("model_identity")),
                "fallback": routed.get("fallback") is True,
                "error_type": routed.get("error_type"),
            }
        else:
            semantic_route = {
                "schema_version": 1,
                "route": "ordinary_turn",
                "reason": "deterministic_runtime_has_no_semantic_operation_evidence",
                "operation": None,
            }
            provenance = {"source": "deterministic_fallback", "fallback": True}
    route = ops.validate_semantic_route(semantic_route)
    route_receipt = ops.record_semantic_route(
        record["campaign_dir"],
        route,
        player_text=player_input,
        provenance=provenance,
    )
    if route["route"] == "operation":
        receipt = operate(
            session_id,
            route["operation"],
            rng_seed=rng_seed,
        )
        return {
            "schema_version": 1,
            "mode": "operation",
            "routing": route_receipt,
            "receipt": receipt,
        }
    return {
        "schema_version": 1,
        "mode": "turn",
        "routing": route_receipt,
        "events": send(session_id, player_input, rng_seed=rng_seed),
    }


def operate(
    session_id: str,
    operation: dict[str, Any],
    *,
    rng_seed: int | str | None = None,
) -> dict[str, Any]:
    """Execute one canonical non-turn operation for an active session.

    This is the Pi/headless entry to the same operation gateway documented for
    Codex, Cursor, and Claude plugin hosts.
    """
    record = get_session(session_id)
    return _load_runtime_ops_module(record["workspace"]).execute_operation(
        record["workspace"],
        campaign_id=record["campaign_id"],
        investigator_id=record["investigator_id"],
        character_path=record["character_path"],
        operation=operation,
        rng_seed=_validate_rng_seed(rng_seed) if rng_seed is not None else None,
    )


def _append_runtime_row(campaign_dir: Path | str, row: dict[str, Any]) -> str:
    """Durably append one keeper runtime row; return its canonical SHA-256."""
    telemetry = _load_telemetry_module()
    encoded_row = json.dumps(
        row, ensure_ascii=False, sort_keys=True,
        separators=(",", ":"), allow_nan=False,
    ).encode("utf-8")
    digest = hashlib.sha256(encoded_row).hexdigest()
    logs_fd = telemetry._open_logs_dir(campaign_dir, create=True)
    fd = -1
    try:
        fd = telemetry._open_log_file(
            logs_fd,
            "live-turn-runtime.jsonl",
            os.O_WRONLY | os.O_CREAT | os.O_APPEND,
        )
        fcntl.flock(fd, fcntl.LOCK_EX)
        try:
            telemetry._write_all(fd, encoded_row + b"\n")
            os.fsync(fd)
        finally:
            fcntl.flock(fd, fcntl.LOCK_UN)
        os.fsync(logs_fd)
    finally:
        if fd >= 0:
            os.close(fd)
        os.close(logs_fd)
    return digest


def _record_turn_telemetry(
    record: dict[str, Any],
    total_started: float,
    *,
    narration_text: str,
    model_identity: dict[str, Any] | None,
    usage: dict[str, Any] | None,
    decision_ids: list[str],
    finalization: dict[str, Any],
) -> None:
    """Persist only timing/attestation metadata, never prompts or player text."""
    total_ms = max(0.0, (time.perf_counter() - total_started) * 1000.0)
    identity: dict[str, str] | None = None
    if (
        isinstance(model_identity, dict)
        and isinstance(model_identity.get("provider"), str)
        and isinstance(model_identity.get("id"), str)
    ):
        identity = {
            "provider": model_identity["provider"],
            "id": model_identity["id"],
        }
    if identity is not None:
        narrator = {
            "call_count": 1,
            "model_identity": identity,
            "response_mode": "tool",
            "consistent": True,
            "deterministic_fallback": False,
        }
        fallback = False
    else:
        # The keeper agent completed but did not attest its model identity;
        # record the turn as unattested rather than inventing an identity.
        narrator = {
            "call_count": 1,
            "model_identity": None,
            "response_mode": None,
            "consistent": False,
            "deterministic_fallback": True,
        }
        fallback = True
    input_tokens = None
    output_tokens = None
    if isinstance(usage, dict):
        raw_input = usage.get("input_tokens")
        raw_output = usage.get("output_tokens")
        if isinstance(raw_input, int) and not isinstance(raw_input, bool) and raw_input >= 0:
            input_tokens = raw_input
        if isinstance(raw_output, int) and not isinstance(raw_output, bool) and raw_output >= 0:
            output_tokens = raw_output
    telemetry = _load_telemetry_module().make_telemetry(
        intent_ms=0.0, director_ms=0.0, rules_ms=0.0, persistence_ms=0.0,
        player_llm_ms=0.0, narrator_llm_ms=total_ms, total_ms=total_ms,
        input_tokens=input_tokens, output_tokens=output_tokens,
        fallback=fallback,
        runner={"keeper": "pi_coding_agent", "worker": "subprocess"},
        narrator=narrator,
    )
    runtime_row = {
        "schema_version": 1,
        "event_type": "live_turn_runtime",
        "row_id": f"keeper_{uuid.uuid4().hex}",
        "session_id": record["session_id"],
        "investigator_id": record["investigator_id"],
        "decision_ids": list(decision_ids),
        "recording_mode": "sync",
        "recording_flush": "auto",
        "engine": "keeper_agent",
        "narration_sha256": hashlib.sha256(
            narration_text.encode("utf-8")
        ).hexdigest(),
        "finalization": {
            "finalization_id": finalization["finalization_id"],
            "journal_decision_id": finalization["journal_decision_id"],
            "rendered_sha256": finalization["rendered_sha256"],
            "integrity_digest": finalization["integrity_digest"],
        },
    }
    runtime_digest = _append_runtime_row(record["campaign_dir"], runtime_row)
    _load_telemetry_module().write_receipt(
        record["campaign_dir"], session_id=record["session_id"],
        investigator_id=record["investigator_id"], telemetry=telemetry,
        runtime_receipt_sha256=runtime_digest,
        decision_ids=list(decision_ids),
    )


def get_telemetry_receipts(session_id: str) -> list[dict[str, Any]]:
    """Reload this session's durable, privacy-safe telemetry receipts."""
    record = get_session(session_id)
    return [
        receipt for receipt in _load_telemetry_module().read_receipts(record["campaign_dir"])
        if receipt.get("session_id") == session_id
    ]


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
    finalization = runtime_row.get("finalization")
    if (
        not isinstance(runtime_row, dict)
        or runtime_row.get("schema_version") != 1
        or runtime_row.get("event_type") != "live_turn_runtime"
        or runtime_row.get("investigator_id") != record["investigator_id"]
        or runtime_row.get("decision_ids") != receipt.get("decision_ids")
        or receipt.get("investigator_id") != record["investigator_id"]
        or not isinstance(finalization, dict)
        or set(finalization) != {
            "finalization_id", "journal_decision_id", "rendered_sha256",
            "integrity_digest",
        }
        or not all(
            isinstance(finalization.get(key), str) and finalization[key]
            for key in ("finalization_id", "journal_decision_id")
        )
        or any(
            not isinstance(finalization.get(key), str)
            or re.fullmatch(r"sha256:[0-9a-f]{64}", finalization[key]) is None
            for key in ("rendered_sha256", "integrity_digest")
        )
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
    return {
        "schema_version": 1,
        "session_id": session_id,
        "investigator_id": record["investigator_id"],
        "decision_ids": list(receipt["decision_ids"]),
        "telemetry_receipt_id": receipt["receipt_id"],
        "runtime_receipt_sha256": runtime_receipt_sha256,
        "recording_mode": runtime_row.get("recording_mode"),
        "recording_flush": runtime_row.get("recording_flush"),
        "finalization": copy.deepcopy(finalization),
        "usage": usage,
        "narrator_llm_ms": float(latency),
        "narrator": copy.deepcopy(narrator),
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
