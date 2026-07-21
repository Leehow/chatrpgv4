"""Typed, player-safe runtime projection over canonical COC state loaders."""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path
from typing import Any, Mapping


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


def _load_plugin_locator():
    return _load_module("runtime_plugin_locator_gateway", _engine_dir() / "plugin_locator.py")


def _load_coc_state(
    workspace: Path | str | None = None,
    resolved_config: Mapping[str, Any] | None = None,
):
    path = _load_plugin_locator().plugin_scripts_dir(
        workspace, resolved_config=resolved_config
    ) / "coc_state.py"
    return _load_plugin_locator().load_plugin_module(
        "runtime_coc_state_gateway", path
    )


def _load_coc_rulesets(
    workspace: Path | str | None = None,
    resolved_config: Mapping[str, Any] | None = None,
):
    path = _load_plugin_locator().plugin_scripts_dir(
        workspace, resolved_config=resolved_config
    ) / "coc_rulesets.py"
    return _load_plugin_locator().load_plugin_module(
        "runtime_coc_rulesets_gateway", path
    )


def _default_investigator_resource_fields() -> tuple[str, ...]:
    """Workspace-less import-time binding over the default ruleset manifest."""
    rulesets = _load_coc_rulesets()
    return tuple(
        rulesets.ruleset_projected_resource_fields(rulesets.DEFAULT_RULESET_ID)
    )


# Phase 1 seam 3: investigator resource gauges projected by
# ``load_investigator`` are read from the active ruleset manifest
# ``resources[*].projected`` (docs/ruleset-contract.md §6). This module
# constant is the workspace-less default-ruleset binding; instance
# projections resolve the campaign's own bound ruleset. One declared place:
# update the manifest, not call sites.
INVESTIGATOR_RESOURCE_FIELDS = _default_investigator_resource_fields()


def _typed_int(value: Any) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) else None


class RuntimeStateGateway:
    """Load runtime state through ``coc_state`` with sanitized health diagnostics."""

    def __init__(
        self,
        workspace: Path | str,
        campaign_id: str,
        investigator_id: str | None = None,
        *,
        resolved_config: Mapping[str, Any] | None = None,
    ) -> None:
        self._paths = _load_paths()
        self.workspace = self._paths.workspace_root(workspace)
        self.resolved_config = dict(resolved_config) if resolved_config is not None else None
        self._state = _load_coc_state(self.workspace, self.resolved_config)
        self._rulesets = _load_coc_rulesets(self.workspace, self.resolved_config)
        self._resource_fields: tuple[str, ...] | None = None
        self._ruleset_id: str | None = None
        self._actor_state_dirname: str | None = None
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
        if state in {"actor", "investigator"} and investigator_id is not None:
            return self._paths.actor_state_path(
                self.campaign_dir, investigator_id, self._actor_state_dir()
            )
        raise ValueError("invalid runtime state kind")

    def load_campaign(self) -> dict[str, Any]:
        return self._state.load_campaign_state(self.campaign_dir)

    def load_world(self) -> dict[str, Any]:
        return self._state.load_world_state(self.campaign_dir)

    def load_pacing(self) -> dict[str, Any]:
        return self._state.load_pacing_state(self.campaign_dir)

    def _investigator_resource_fields(self) -> tuple[str, ...]:
        """Projected resource fields for this campaign's bound ruleset.

        Read once per gateway from the campaign's persisted ``ruleset_id``;
        an unreadable or missing campaign.json falls back to the default
        ruleset through ``get_campaign_ruleset_id`` — the same tolerance the
        campaign-less path always had, with no new failure mode.
        """
        if self._resource_fields is None:
            path = self._paths.contained_path(
                self.campaign_dir, self.campaign_dir / "campaign.json"
            )
            try:
                raw = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, UnicodeDecodeError, json.JSONDecodeError):
                raw = None
            ruleset_id = self._rulesets.get_campaign_ruleset_id(
                raw if isinstance(raw, dict) else None
            )
            self._resource_fields = tuple(
                self._rulesets.ruleset_projected_resource_fields(ruleset_id)
            )
            self._ruleset_id = ruleset_id
        return self._resource_fields

    def _active_ruleset_id(self) -> str:
        if self._ruleset_id is None:
            campaign = self.load_campaign()
            self._ruleset_id = self._rulesets.get_campaign_ruleset_id(campaign)
        return self._ruleset_id

    def _actor_state_dir(self) -> str:
        if self._actor_state_dirname is None:
            self._actor_state_dirname = self._rulesets.ruleset_actor_state_dir(
                self._active_ruleset_id()
            )
        return self._actor_state_dirname

    def _actor_issue_name(self) -> str:
        return "investigator" if self._active_ruleset_id() == "coc7" else "actor"

    def load_actor(self, investigator_id: str) -> dict[str, Any]:
        investigator_id = self._paths.validate_id(investigator_id, "actor_id")
        payload = self._state.load_ruleset_actor_state(
            self.campaign_dir, investigator_id
        )
        conditions = payload.get("conditions")
        if conditions is None:
            conditions = []
        elif not isinstance(conditions, list) or not all(
            isinstance(condition, str) for condition in conditions
        ):
            self._issue(self._actor_issue_name(), "invalid_fields")
            conditions = []
        resource_fields = self._investigator_resource_fields()
        resource_values = payload.get("resources")
        entry: dict[str, Any] = {
            "id": investigator_id,
            "resources": {},
        }
        for field in resource_fields:
            key = field.removeprefix("current_")
            raw_value = (
                resource_values.get(key)
                if isinstance(resource_values, dict)
                else payload.get(field)
            )
            value = _typed_int(raw_value)
            entry["resources"][key] = value
            # Flat projected fields are retained for existing CoC7 consumers.
            entry[field] = value
        entry["conditions"] = list(conditions)
        if any(
            value is None for value in entry["resources"].values()
        ):
            self._issue(self._actor_issue_name(), "invalid_fields")
        return entry

    def load_investigator(self, investigator_id: str) -> dict[str, Any]:
        """Compatibility alias for the package-neutral actor projection."""
        return self.load_actor(investigator_id)

    def load_actors(self) -> list[dict[str, Any]]:
        save = self._paths.contained_path(self.campaign_dir, self.campaign_dir / "save")
        actor_dir = self._paths.contained_path(save, save / self._actor_state_dir())
        if not actor_dir.is_dir():
            return []
        entries: list[dict[str, Any]] = []
        for path in sorted(actor_dir.glob("*.json")):
            try:
                investigator_id = self._paths.validate_id(path.stem, "actor_id")
            except ValueError:
                self._issue(self._actor_issue_name(), "invalid_identifier")
                continue
            entries.append(self.load_actor(investigator_id))
        return entries

    def load_investigators(self) -> list[dict[str, Any]]:
        """Compatibility alias for callers using the historical key."""
        return self.load_actors()

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
        """Return exact-current state or raise ``unsupported_save_schema``.

        Health remains useful for non-core optional projections, but core
        campaign state never degrades into usable-looking defaults.
        """
        self._state.validate_campaign_generation(
            self.campaign_dir,
            actor_id=self.investigator_id,
        )
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
            actors = [self.load_actor(self.investigator_id)]
        else:
            actors = self.load_actors()
        return {
            "campaign": self.load_campaign(),
            "world": self.load_world(),
            "pacing": self.load_pacing(),
            "actors": actors,
            "investigators": actors,
            "state_health": self.health(),
        }
