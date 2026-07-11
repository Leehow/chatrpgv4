"""Typed, player-safe runtime projection over canonical COC state loaders."""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path
from typing import Any, Callable


def _load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


def _engine_dir() -> Path:
    return Path(__file__).resolve().parent


def _load_paths():
    return _load_module("runtime_paths_gateway", _engine_dir() / "paths.py")


def _load_coc_state():
    path = Path(__file__).resolve().parents[2] / "plugins" / "coc-keeper" / "scripts" / "coc_state.py"
    return _load_module("runtime_coc_state_gateway", path)


def _typed_int(value: Any) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) else None


class RuntimeStateGateway:
    """Load runtime state through ``coc_state`` with sanitized health diagnostics."""

    def __init__(
        self,
        workspace: Path | str,
        campaign_id: str,
        investigator_id: str | None = None,
    ) -> None:
        self._paths = _load_paths()
        self._state = _load_coc_state()
        self.workspace = self._paths.workspace_root(workspace)
        self.campaign_id = self._paths.validate_id(campaign_id, "campaign_id")
        self.investigator_id = (
            self._paths.validate_id(investigator_id, "investigator_id")
            if investigator_id is not None
            else None
        )
        self.campaign_dir = self._paths.campaign_dir(self.workspace, self.campaign_id)
        self._issues: list[dict[str, str]] = []

    def _issue(self, state: str, code: str) -> None:
        issue = {"state": state, "code": code}
        if issue not in self._issues:
            self._issues.append(issue)

    def _state_path(self, state: str, investigator_id: str | None = None) -> Path:
        if state == "campaign":
            return self._paths.contained_path(
                self.campaign_dir, self.campaign_dir / "campaign.json"
            )
        save = self._paths.contained_path(self.campaign_dir, self.campaign_dir / "save")
        if state == "world":
            return self._paths.contained_path(save, save / "world-state.json")
        if state == "pacing":
            return self._paths.contained_path(save, save / "pacing-state.json")
        if state == "investigator" and investigator_id is not None:
            investigator_id = self._paths.validate_id(investigator_id, "investigator_id")
            inv_dir = self._paths.contained_path(save, save / "investigator-state")
            return self._paths.contained_path(inv_dir, inv_dir / f"{investigator_id}.json")
        raise ValueError("invalid runtime state kind")

    def _diagnose(self, path: Path, kind: str) -> str:
        if not path.exists():
            return "missing"
        try:
            text = path.read_bytes().decode("utf-8")
        except UnicodeDecodeError:
            return "invalid_utf8"
        except OSError:
            return "corrupt"
        try:
            raw = json.loads(text)
        except json.JSONDecodeError:
            return "invalid_json"
        if not isinstance(raw, dict):
            return "non_object"
        version = raw.get("schema_version", 1)
        if isinstance(version, bool) or not isinstance(version, int) or version < 1:
            return "invalid_schema"
        if version > int(self._state.CURRENT_SCHEMA_VERSIONS.get(kind, 1)):
            return "forward_version"
        return "ok"

    def _load(
        self,
        *,
        state: str,
        kind: str,
        path: Path,
        fallback: dict[str, Any],
        loader: Callable[[Path], dict[str, Any]],
    ) -> dict[str, Any]:
        diagnosis = self._diagnose(path, kind)
        if diagnosis != "ok":
            self._issue(state, diagnosis)
        if diagnosis in {"forward_version", "invalid_schema"}:
            return dict(fallback)
        try:
            payload = loader(self.campaign_dir)
        except (OSError, UnicodeDecodeError, ValueError, TypeError):
            # Forward versions are intentionally not rewritten or backed up;
            # the caller gets an explicit health failure with no raw error.
            if diagnosis == "ok":
                self._issue(state, "invalid_schema")
            return dict(fallback)
        return payload if isinstance(payload, dict) else dict(fallback)

    def load_campaign(self) -> dict[str, Any]:
        path = self._state_path("campaign")
        return self._load(
            state="campaign",
            kind="campaign",
            path=path,
            fallback={"schema_version": 1, "campaign_id": self.campaign_id},
            loader=self._state.load_campaign_state,
        )

    def load_world(self) -> dict[str, Any]:
        path = self._state_path("world")
        return self._load(
            state="world",
            kind="world",
            path=path,
            fallback={"schema_version": 1},
            loader=self._state.load_world_state,
        )

    def load_pacing(self) -> dict[str, Any]:
        path = self._state_path("pacing")
        return self._load(
            state="pacing",
            kind="pacing",
            path=path,
            fallback={"schema_version": 1},
            loader=self._state.load_pacing_state,
        )

    def load_investigator(self, investigator_id: str) -> dict[str, Any]:
        investigator_id = self._paths.validate_id(investigator_id, "investigator_id")
        path = self._state_path("investigator", investigator_id)
        payload = self._load(
            state="investigator",
            kind="investigator",
            path=path,
            fallback={"schema_version": 1, "investigator_id": investigator_id},
            loader=lambda campaign: self._state.load_investigator_state(
                campaign, investigator_id
            ),
        )
        conditions = payload.get("conditions")
        if not isinstance(conditions, list) or not all(
            isinstance(condition, str) for condition in conditions
        ):
            self._issue("investigator", "invalid_fields")
            conditions = []
        entry = {
            "id": investigator_id,
            "current_hp": _typed_int(payload.get("current_hp")),
            "current_san": _typed_int(payload.get("current_san")),
            "current_mp": _typed_int(payload.get("current_mp")),
            "conditions": list(conditions),
        }
        if any(
            payload.get(key) is not None and entry[key] is None
            for key in ("current_hp", "current_san", "current_mp")
        ):
            self._issue("investigator", "invalid_fields")
        return entry

    def load_investigators(self) -> list[dict[str, Any]]:
        save = self._paths.contained_path(self.campaign_dir, self.campaign_dir / "save")
        inv_dir = self._paths.contained_path(save, save / "investigator-state")
        if not inv_dir.is_dir():
            return []
        entries: list[dict[str, Any]] = []
        for path in sorted(inv_dir.glob("*.json")):
            try:
                investigator_id = self._paths.validate_id(path.stem, "investigator_id")
            except ValueError:
                self._issue("investigator", "invalid_identifier")
                continue
            entries.append(self.load_investigator(investigator_id))
        return entries

    def health(self) -> dict[str, Any]:
        codes = {issue["code"] for issue in self._issues}
        status = "ok"
        if codes & {
            "corrupt", "invalid_utf8", "invalid_json", "non_object",
            "forward_version", "invalid_schema",
        }:
            status = "error"
        elif codes:
            status = "degraded"
        return {"status": status, "issues": list(self._issues)}

    def record_invalid_fields(self, state: str) -> None:
        """Record a schema-safe projection loss without exposing raw values."""
        self._issue(state, "invalid_fields")

    def validate_consumed_paths(self) -> dict[str, Path]:
        """Revalidate the complete runtime save boundary on demand."""
        return self._paths.campaign_save_paths(
            self.campaign_dir, self.investigator_id or "gateway"
        )

    def load(self) -> dict[str, Any]:
        """Return typed state objects and a sanitized health projection."""
        state_paths = self.validate_consumed_paths()
        for state_name, expected in (
            ("subsystem_state", 3), ("combat_state", 2),
            ("sanity_state", 1), ("chase_state", 4),
        ):
            path = state_paths[state_name]
            if not path.exists():
                continue
            try:
                raw = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, UnicodeDecodeError, json.JSONDecodeError):
                self._issue(state_name.removesuffix("_state"), "corrupt")
                continue
            version = raw.get("schema_version") if isinstance(raw, dict) else None
            if (isinstance(version, bool) or not isinstance(version, int)
                    or version != expected):
                self._issue(state_name.removesuffix("_state"), "invalid_schema")
        if self.investigator_id is not None:
            exact_path = self._state_path("investigator", self.investigator_id)
            if exact_path.exists():
                investigators = [self.load_investigator(self.investigator_id)]
            else:
                self._issue("investigator", "missing")
                investigators = []
        else:
            investigators = self.load_investigators()
        return {
            "campaign": self.load_campaign(),
            "world": self.load_world(),
            "pacing": self.load_pacing(),
            "investigators": investigators,
            "state_health": self.health(),
        }
