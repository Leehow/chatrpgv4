#!/usr/bin/env python3
"""Canonical operation descriptors and per-toolbox registry.

The registry is deliberately instance-owned.  ``coc_toolbox.py`` creates one
registry for each loaded toolbox module, then exposes ``legacy_tools`` for the
existing CLI, MCP adapter, and tests.  Canonical consumers use immutable
``OperationSpec`` values; the dict surface is a compatibility adapter only.
"""
from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass, replace
from types import MappingProxyType
from typing import Any, Callable, Iterable, Iterator, Mapping


Handler = Callable[[Any, dict[str, Any]], tuple[Any, list[str], list[str]]]
PolicyResolver = Callable[[str], Mapping[str, Any]]

_ACCESS_MODES = frozenset({"query", "mutation"})
_EXECUTION_CLASSES = frozenset({
    "parallel_read", "serial_campaign", "serial_global",
})


def _freeze(value: Any) -> Any:
    if isinstance(value, Mapping):
        return MappingProxyType({str(key): _freeze(item) for key, item in value.items()})
    if isinstance(value, (list, tuple)):
        return tuple(_freeze(item) for item in value)
    if isinstance(value, set):
        return frozenset(_freeze(item) for item in value)
    return deepcopy(value)


def _thaw(value: Any) -> Any:
    if isinstance(value, Mapping):
        return {key: _thaw(item) for key, item in value.items()}
    if isinstance(value, (tuple, frozenset)):
        return [_thaw(item) for item in value]
    return deepcopy(value)


@dataclass(frozen=True, slots=True)
class OperationPolicy:
    audience: str
    phases: tuple[str, ...]
    contract: str
    advisory: bool
    kp_surface: str
    discovery: str = "surface"

    @classmethod
    def from_mapping(cls, value: Mapping[str, Any]) -> "OperationPolicy":
        required = {"audience", "phases", "contract", "advisory", "kp_surface"}
        missing = sorted(required - set(value))
        if missing:
            raise ValueError(
                "operation policy missing fields: " + ", ".join(missing)
            )
        phases = tuple(str(phase) for phase in value["phases"])
        if not phases:
            raise ValueError("operation policy phases must not be empty")
        discovery = str(value.get("discovery") or "surface")
        if discovery not in {"surface", "exact"}:
            raise ValueError(f"invalid operation discovery mode: {discovery}")
        return cls(
            audience=str(value["audience"]),
            phases=phases,
            contract=str(value["contract"]),
            advisory=bool(value["advisory"]),
            kp_surface=str(value["kp_surface"]),
            discovery=discovery,
        )

    def public(self) -> dict[str, Any]:
        return {
            "audience": self.audience,
            "phases": list(self.phases),
            "contract": self.contract,
            "advisory": self.advisory,
            "kp_surface": self.kp_surface,
            "discovery": self.discovery,
        }


@dataclass(frozen=True, slots=True)
class OperationSpec:
    name: str
    summary: str
    params: Mapping[str, Mapping[str, Any]]
    needs_campaign: bool
    access: str
    read_domains: tuple[str, ...]
    write_domains: tuple[str, ...]
    recovery_domains: tuple[str, ...] | None
    response_mode: str
    audit_mode: str
    strict_read_only: bool
    execution_class: str
    policy: OperationPolicy
    handler: Handler

    def legacy(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "summary": self.summary,
            "params": _thaw(self.params),
            "needs_campaign": self.needs_campaign,
            "access": self.access,
            "read_domains": self.read_domains,
            "write_domains": self.write_domains,
            "recovery_domains": self.recovery_domains,
            "response_mode": self.response_mode,
            "audit_mode": self.audit_mode,
            "strict_read_only": self.strict_read_only,
            "execution_class": self.execution_class,
            "policy": self.policy.public(),
            "handler": self.handler,
        }

    def describe(self) -> dict[str, Any]:
        row = self.legacy()
        row.pop("handler")
        row["read_domains"] = list(self.read_domains)
        row["write_domains"] = list(self.write_domains)
        row["recovery_domains"] = (
            None if self.recovery_domains is None else list(self.recovery_domains)
        )
        row.pop("strict_read_only")
        return row


class _LegacyToolMap(dict[str, dict[str, Any]]):
    """Mutable compatibility dict that invalidates replaced canonical specs."""

    def __init__(self, owner: "OperationRegistry") -> None:
        super().__init__()
        self._owner = owner

    def __setitem__(self, key: str, value: dict[str, Any]) -> None:
        dict.__setitem__(self, key, value)
        self._owner._specs.pop(key, None)

    def __delitem__(self, key: str) -> None:
        dict.__delitem__(self, key)
        self._owner._specs.pop(key, None)

    def pop(self, key: str, default: Any = None) -> Any:
        present = key in self
        value = dict.pop(self, key, default)
        if present:
            self._owner._specs.pop(key, None)
        return value


class OperationRegistry:
    """Explicit registry with immutable canonical specs and a legacy adapter."""

    def __init__(
        self,
        *,
        policy_resolver: PolicyResolver,
        ephemeral_prefixes: tuple[str, ...] = ("test.",),
    ) -> None:
        self._policy_resolver = policy_resolver
        self._ephemeral_prefixes = ephemeral_prefixes
        self._specs: dict[str, OperationSpec] = {}
        self._legacy_tools = _LegacyToolMap(self)

    @property
    def specs(self) -> Mapping[str, OperationSpec]:
        return MappingProxyType(self._specs)

    @property
    def legacy_tools(self) -> dict[str, dict[str, Any]]:
        return self._legacy_tools

    def _policy_for(self, name: str) -> OperationPolicy:
        try:
            return OperationPolicy.from_mapping(self._policy_resolver(name))
        except KeyError:
            if not name.startswith(self._ephemeral_prefixes):
                raise
            return OperationPolicy(
                audience="audit",
                phases=("ending",),
                contract="none",
                advisory=False,
                kp_surface="none",
            )

    def tool(
        self,
        name: str,
        summary: str,
        params: dict[str, dict[str, Any]],
        *,
        needs_campaign: bool = True,
        access: str = "mutation",
        read_domains: tuple[str, ...] = (),
        write_domains: tuple[str, ...] = (),
        recovery_domains: tuple[str, ...] | None = None,
        response_mode: str = "full",
        audit_mode: str = "full",
        strict_read_only: bool = False,
        execution_class: str = "serial_campaign",
    ) -> Callable[[Handler], Handler]:
        if access not in _ACCESS_MODES:
            raise ValueError(f"invalid tool access mode: {access}")
        if strict_read_only and not (
            access == "query"
            and not write_domains
            and recovery_domains == ()
            and response_mode == "full"
            and audit_mode == "reference"
        ):
            raise ValueError(
                "strict_read_only requires query access, empty write/recovery "
                "domains, full response mode, and reference audit mode"
            )
        # Scheduling is fail-closed: only a reviewed read may opt into parallel
        # execution; absent or unrecognized declarations stay campaign-serial.
        if execution_class not in _EXECUTION_CLASSES:
            execution_class = "serial_campaign"
        if execution_class == "parallel_read" and not strict_read_only:
            raise ValueError("parallel_read requires strict_read_only")

        def decorate(handler: Handler) -> Handler:
            if name in self._specs or name in self._legacy_tools:
                raise ValueError(f"duplicate operation registration: {name}")
            spec = OperationSpec(
                name=name,
                summary=summary,
                params=_freeze(params),
                needs_campaign=bool(needs_campaign),
                access=access,
                read_domains=tuple(read_domains),
                write_domains=tuple(write_domains),
                recovery_domains=(
                    None if recovery_domains is None else tuple(recovery_domains)
                ),
                response_mode=response_mode,
                audit_mode=audit_mode,
                strict_read_only=bool(strict_read_only),
                execution_class=execution_class,
                policy=self._policy_for(name),
                handler=handler,
            )
            self._store(spec)
            return handler

        return decorate

    def _store(self, spec: OperationSpec) -> None:
        self._specs[spec.name] = spec
        dict.__setitem__(self._legacy_tools, spec.name, spec.legacy())

    def require_decision_ids(self, names: Iterable[str]) -> None:
        for name in names:
            spec = self._specs.get(name)
            if spec is None:
                raise RuntimeError(f"mutating toolbox tool is not registered: {name}")
            params = _thaw(spec.params)
            decision = params.get("decision_id")
            if not isinstance(decision, dict):
                raise RuntimeError(f"mutating toolbox tool lacks decision_id: {name}")
            decision["required"] = True
            self._store(replace(spec, params=_freeze(params)))

    def validate_policies(
        self, expected: Mapping[str, Mapping[str, Any]]
    ) -> None:
        if set(expected) != set(self._specs):
            missing = sorted(set(expected) - set(self._specs))
            extra = sorted(set(self._specs) - set(expected))
            raise ValueError(
                f"operation registry/policy mismatch: missing={missing!r} extra={extra!r}"
            )
        for name, raw in expected.items():
            normalized = OperationPolicy.from_mapping(raw)
            if self._specs[name].policy != normalized:
                raise ValueError(f"operation policy drift at registration: {name}")

    def get(self, name: str) -> OperationSpec:
        return self._specs[name]

    def describe(self, name: str) -> dict[str, Any]:
        return self.get(name).describe()

    def query(
        self,
        *,
        audience: str | None = None,
        phase: str | None = None,
        kp_surface: str | None = None,
        contract: str | None = None,
        discovery: str | None = None,
    ) -> list[str]:
        selected: list[str] = []
        for name, spec in self._specs.items():
            policy = spec.policy
            if audience is not None and policy.audience != audience:
                continue
            if phase is not None and phase not in policy.phases:
                continue
            if kp_surface is not None and policy.kp_surface != kp_surface:
                continue
            if contract is not None and policy.contract != contract:
                continue
            if discovery is not None and policy.discovery != discovery:
                continue
            selected.append(name)
        return sorted(selected)

    def __iter__(self) -> Iterator[str]:
        return iter(self._specs)

    def __len__(self) -> int:
        return len(self._specs)


# --------------------------------------------------------------------------- #
# Extracted cross-domain execution runtime
# --------------------------------------------------------------------------- #

import argparse
from contextlib import ExitStack
from copy import deepcopy
import hashlib
import importlib.util
import json
import os
import random
import re
import stat
import sys
import time
from datetime import datetime, timedelta, timezone
from difflib import get_close_matches as _close_matches
from pathlib import Path
from typing import Any, Callable, Mapping

_HERE = Path(__file__).resolve().parent

_SAFE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")

def _load_sibling(name: str, filename: str):
    if name in sys.modules:
        return sys.modules[name]
    spec = importlib.util.spec_from_file_location(name, _HERE / filename)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module

coc_state = _load_sibling("coc_state", "coc_state.py")

coc_fileio = _load_sibling("coc_fileio", "coc_fileio.py")

coc_flag_state = _load_sibling("coc_flag_state_toolbox", "coc_flag_state.py")

coc_roll = _load_sibling("coc_roll", "coc_roll.py")

coc_language = _load_sibling("coc_language", "coc_language.py")

coc_rules = _load_sibling("coc_rules", "coc_rules.py")

coc_rulesets = _load_sibling("coc_rulesets", "coc_rulesets.py")

coc_rule_signals = _load_sibling("coc_rule_signals", "coc_rule_signals.py")

coc_rules_runtime = _load_sibling("coc_rules_runtime", "coc_rules_runtime.py")

coc_scene_graph = _load_sibling("coc_scene_graph", "coc_scene_graph.py")

coc_npc_state = _load_sibling("coc_npc_state", "coc_npc_state.py")

coc_npc_identity = _load_sibling("coc_npc_identity_toolbox", "coc_npc_identity.py")

coc_npc_event_chain = _load_sibling(
    "coc_npc_event_chain_toolbox", "coc_npc_event_chain.py"
)

coc_first_impression = _load_sibling(
    "coc_first_impression", "coc_first_impression.py"
)

coc_async_recorder = _load_sibling(
    "coc_async_recorder_toolbox", "coc_async_recorder.py"
)

coc_time = _load_sibling("coc_time", "coc_time.py")

coc_storylets = _load_sibling("coc_storylets", "coc_storylets.py")

coc_belief_state = _load_sibling("coc_belief_state_toolbox", "coc_belief_state.py")

coc_quest_state = _load_sibling("coc_quest_state_toolbox", "coc_quest_state.py")

coc_exceptional_effects = _load_sibling(
    "coc_exceptional_effects", "coc_exceptional_effects.py"
)

coc_turn_manifest = _load_sibling("coc_turn_manifest", "coc_turn_manifest.py")

coc_git_history = _load_sibling("coc_git_history", "coc_git_history.py")

coc_continuation = _load_sibling("coc_continuation", "coc_continuation.py")

coc_host_context = _load_sibling("coc_host_context", "coc_host_context.py")

coc_working_set_cache = _load_sibling(
    "coc_working_set_cache", "coc_working_set_cache.py"
)

coc_turn_finalization = _load_sibling(
    "coc_turn_finalization", "coc_turn_finalization.py"
)

coc_development = _load_sibling("coc_development_toolbox", "coc_development.py")

coc_runtime_ops = _load_sibling("coc_runtime_ops_toolbox", "coc_runtime_ops.py")

coc_subsystem_executor = _load_sibling(
    "coc_subsystem_executor_toolbox", "coc_subsystem_executor.py"
)

coc_inventory = _load_sibling("coc_inventory", "coc_inventory.py")

coc_cash = _load_sibling("coc_cash", "coc_cash.py")

coc_finance = _load_sibling("coc_finance", "coc_finance.py")

coc_mechanics = _load_sibling("coc_mechanics_toolbox", "coc_mechanics.py")

coc_action_resolver = _load_sibling(
    "coc_action_resolver_toolbox", "coc_action_resolver.py"
)

coc_module_project = _load_sibling(
    "coc_module_project_toolbox", "coc_module_project.py"
)

coc_compiled_archive = _load_sibling(
    "coc_compiled_archive_toolbox", "coc_compiled_archive.py"
)

coc_opening_phase = _load_sibling("coc_opening_phase", "coc_opening_phase.py")

coc_opening_recovery = _load_sibling(
    "coc_opening_recovery", "coc_opening_recovery.py"
)

coc_handouts = _load_sibling("coc_handouts_toolbox", "coc_handouts.py")

_LEDGER_MAX_ENTRIES = 300

_LEDGER_SCHEMA_VERSION = 2

_LEDGER_FIELDS = frozenset({"schema_version", "entries"})

_LEDGER_ENTRY_V2_FIELDS = frozenset({
    "entry_schema_version", "tool", "decision_id", "ts", "data",
})

_LEDGER_ENTRY_V3_FIELDS = frozenset({
    *_LEDGER_ENTRY_V2_FIELDS,
    "source_receipt_required",
    "source_receipt_manifest",
})

_LEDGER_ENTRY_V4_FIELDS = frozenset({
    *_LEDGER_ENTRY_V2_FIELDS,
    "invalidation",
})

_LEDGER_ENTRY_V5_FIELDS = frozenset({
    *_LEDGER_ENTRY_V3_FIELDS,
    "invalidation",
})

_TOOL_TRANSIENT_RETRY_ATTEMPTS = 3

_TOOL_TRANSIENT_RETRY_DELAY_SECONDS = 0.05

_SKILL_BASES_CACHE: dict[str, tuple[str, int]] | None = None

_SKILL_CATALOG_CACHE: dict[str, dict[str, Any]] | None = None

def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

class ToolError(ValueError):
    def __init__(
        self,
        code: str,
        message: str,
        *,
        violations: list[dict[str, str]] | None = None,
        details: dict[str, Any] | None = None,
    ):
        super().__init__(f"{code}: {message}")
        self.code = code
        self.message = message
        self.violations = violations
        self.details = deepcopy(details) if isinstance(details, dict) else None

class Ctx:
    """Resolved campaign context shared by tool handlers."""

    def __init__(
        self,
        root: Path,
        campaign_id: str | None,
        *,
        execution_class: str = "serial_campaign",
    ):
        self.root = root
        self.execution_class = (
            execution_class
            if isinstance(execution_class, str)
            and execution_class in {
                "parallel_read", "serial_campaign", "serial_global",
            }
            else "serial_campaign"
        )
        self.coc_root = root / ".coc"
        self.campaign_id = campaign_id
        if campaign_id:
            self.campaign_dir = self.coc_root / "campaigns" / campaign_id
            if not self.campaign_dir.is_dir():
                raise ToolError("unknown_campaign", f"no campaign at {self.campaign_dir}")
        else:
            self.campaign_dir = None
        self._scenario_cache: dict[str, Any] = {}
        self._roll_ids: set[str] | None = None
        self._roll_sequence = 0

    def scenario(self, name: str) -> dict[str, Any]:
        """Load a compiled scenario file (cached). Missing file -> {}."""
        if name in self._scenario_cache:
            return self._scenario_cache[name]
        data: dict[str, Any] = {}
        if self.campaign_dir is not None:
            path = self.campaign_dir / "scenario" / name
            if path.is_file():
                try:
                    loaded = json.loads(path.read_text(encoding="utf-8"))
                    if isinstance(loaded, dict):
                        data = loaded
                except (json.JSONDecodeError, OSError):
                    data = {}
        self._scenario_cache[name] = data
        return data

    @property
    def story_graph(self) -> dict[str, Any]:
        return self.scenario("story-graph.json")

    @property
    def clue_graph(self) -> dict[str, Any]:
        return self.scenario("clue-graph.json")

    @property
    def npc_agendas(self) -> dict[str, Any]:
        return self.scenario("npc-agendas.json")

    @property
    def module_meta(self) -> dict[str, Any]:
        return self.scenario("module-meta.json")

    def world(self) -> dict[str, Any]:
        return coc_state.load_world_state(self.campaign_dir)

    def save_world(self, world: dict[str, Any]) -> None:
        coc_state.write_json_atomic(self.campaign_dir / "save" / "world-state.json", world)

    def pacing(self) -> dict[str, Any]:
        return coc_state.load_pacing_state(self.campaign_dir)

    def save_pacing(self, pacing: dict[str, Any]) -> None:
        coc_state.write_json_atomic(self.campaign_dir / "save" / "pacing-state.json", pacing)

    def flags(self) -> dict[str, Any]:
        path = self.campaign_dir / "save" / "flags.json"
        if not path.is_file():
            return coc_flag_state.new_flag_document(campaign_id=self.campaign_id)
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError, UnicodeError) as exc:
            raise ToolError(
                "state_corrupt",
                "save/flags.json exists but is unreadable or invalid JSON; refusing to replace canonical flag state",
            ) from exc
        if not coc_flag_state.valid_flag_document_structure(data):
            raise ToolError(
                "state_corrupt",
                "save/flags.json does not match the current schema-v3 document",
            )
        if data.get("campaign_id") not in (None, self.campaign_id):
            raise ToolError("state_corrupt", "save/flags.json campaign identity is invalid")
        receipts = data[_SOURCE_RECEIPTS_KEY]
        for tool_name, tool_receipts in receipts.items():
            if tool_name != "state.set_flag" or not isinstance(tool_receipts, dict):
                raise ToolError(
                    "state_corrupt",
                    f"save/flags.json has invalid receipts for {tool_name}",
                )
            for decision_id, receipt in tool_receipts.items():
                if (
                    not _stored_toolbox_receipt_valid(receipt)
                    or receipt.get("tool") != tool_name
                    or str(receipt.get("decision_id") or "") != str(decision_id)
                ):
                    raise ToolError(
                        "state_corrupt",
                        f"save/flags.json has an invalid current receipt for {tool_name}",
                    )
        for flag_id, head in (data.get("flag_heads") or {}).items():
            if not coc_flag_state.valid_entity_head(
                head, entity_kind="flag", entity_id=str(flag_id)
            ):
                raise ToolError(
                    "state_corrupt",
                    f"save/flags.json has an invalid live head for flag '{flag_id}'",
                )
        director_receipts = data[coc_flag_state.DIRECTOR_FLAG_RECEIPTS_KEY]
        if not coc_flag_state.valid_director_flag_receipt_map(director_receipts):
            raise ToolError(
                "state_corrupt",
                "save/flags.json has an invalid director flag receipt map",
            )
        return data

    def save_flags(self, flags: dict[str, Any]) -> None:
        coc_state.write_json_atomic(self.campaign_dir / "save" / "flags.json", flags)

    def log_event(self, record: dict[str, Any]) -> None:
        record.setdefault("ts", _now_iso())
        coc_state.append_jsonl(self.campaign_dir / "logs" / "events.jsonl", record)

    def _next_roll_id(self) -> str:
        """Return a campaign-local, source-stable id for one actual dice event."""
        if self._roll_ids is None:
            self._roll_ids = set()
            path = self.campaign_dir / "logs" / "rolls.jsonl"
            if path.is_file():
                for line in path.read_text(encoding="utf-8").splitlines():
                    try:
                        row = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    if isinstance(row, dict) and row.get("roll_id") not in (None, ""):
                        self._roll_ids.add(str(row["roll_id"]))
            self._roll_sequence = len(self._roll_ids)
        prefix = re.sub(r"[^A-Za-z0-9._:-]+", "-", str(self.campaign_id or "campaign"))
        while True:
            self._roll_sequence += 1
            candidate = f"toolbox-{prefix}-{self._roll_sequence:06d}"
            if candidate not in self._roll_ids:
                self._roll_ids.add(candidate)
                return candidate

    def prepare_roll(self, record: dict[str, Any]) -> dict[str, Any]:
        """Freeze one canonical roll row without materializing it yet.

        The nested payload is the evaluation/report contract.  Flat fields stay
        in place for older runtime consumers that predate that contract.
        """
        canonical = dict(record)
        roll_id = str(canonical.get("roll_id") or self._next_roll_id())
        canonical["roll_id"] = roll_id
        canonical.setdefault("event_type", "roll")
        canonical.setdefault("type", "roll")
        canonical.setdefault(
            "actor",
            canonical.get("actor_id") or canonical.get("investigator_id") or "keeper",
        )
        canonical.setdefault("visibility", "public")
        canonical.setdefault("source", "keeper_toolbox")
        canonical.setdefault("source_ref", f"logs/rolls.jsonl#{roll_id}")
        canonical.setdefault("ts", _now_iso())
        if not isinstance(canonical.get("payload"), dict):
            metadata = {
                "actor", "actor_id", "event_type", "kind", "payload", "roll_id",
                "source", "source_ref", "ts", "type", "visibility",
            }
            canonical["payload"] = {
                key: value for key, value in canonical.items() if key not in metadata
            }
        canonical["payload"].setdefault("roll_id", roll_id)
        return canonical

    def log_roll(self, record: dict[str, Any]) -> dict[str, Any]:
        """Append one canonical roll while retaining legacy flat fields."""
        canonical = self.prepare_roll(record)
        coc_state.append_jsonl(self.campaign_dir / "logs" / "rolls.jsonl", canonical)
        return canonical

    # -- investigators -------------------------------------------------------

    def party_ids(self) -> list[str]:
        path = self.campaign_dir / "party.json"
        if path.is_file():
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
                return [str(i) for i in (data.get("investigator_ids") or [])]
            except (json.JSONDecodeError, OSError):
                pass
        return []

    def sheet(self, investigator_id: str) -> dict[str, Any]:
        path = self.coc_root / "investigators" / investigator_id / "character.json"
        if not path.is_file():
            raise ToolError("unknown_investigator", f"no character sheet for {investigator_id}")
        data = coc_runtime_ops.read_development_guarded_character(
            self.campaign_dir, investigator_id, path
        )
        if not isinstance(data, dict):
            raise ToolError("bad_character_sheet", f"character sheet must be an object: {path}")
        return data

    def inv_state_path(self, investigator_id: str) -> Path:
        return self.campaign_dir / "save" / "investigator-state" / f"{investigator_id}.json"

    def inv_state(
        self,
        investigator_id: str,
        *,
        character_snapshot: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        path = self.inv_state_path(investigator_id)
        if not path.is_file():
            coc_state.seed_investigator_state_if_missing(
                self.root,
                self.campaign_id,
                investigator_id,
                sheet=(
                    character_snapshot
                    if character_snapshot is not None
                    else self.sheet(investigator_id)
                ),
            )
        return json.loads(path.read_text(encoding="utf-8"))

    def save_inv_state(self, investigator_id: str, state: dict[str, Any]) -> None:
        coc_state.write_json_atomic(self.inv_state_path(investigator_id), state)

    def campaign_mechanics(self) -> dict[str, Any]:
        path = self.campaign_dir / "save" / "campaign-mechanics.json"
        if not path.is_file():
            return {"schema_version": 1, "items": {}}
        try:
            document = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError) as exc:
            raise ToolError(
                "state_corrupt", "save/campaign-mechanics.json is unreadable",
            ) from exc
        if (
            not isinstance(document, dict)
            or document.get("schema_version") != 1
            or not isinstance(document.get("items"), dict)
        ):
            raise ToolError(
                "state_corrupt",
                "save/campaign-mechanics.json does not match schema version 1",
            )
        return document

    def save_campaign_mechanics(self, document: dict[str, Any]) -> None:
        coc_state.write_json_atomic(
            self.campaign_dir / "save" / "campaign-mechanics.json", document,
        )

    # -- idempotency ledger ---------------------------------------------------

    def _ledger_path(self) -> Path:
        return self.campaign_dir / "save" / "toolbox-ledger.json"

    @staticmethod
    def _ledger_key(tool: str, decision_id: str) -> str:
        return json.dumps([str(tool), str(decision_id)], ensure_ascii=False, separators=(",", ":"))

    def _load_ledger(self) -> dict[str, Any]:
        path = self._ledger_path()
        if not path.is_file():
            return {"schema_version": _LEDGER_SCHEMA_VERSION, "entries": {}}
        try:
            ledger = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError, UnicodeError) as exc:
            raise ToolError(
                "state_corrupt",
                "save/toolbox-ledger.json is unreadable; refusing to replace it",
            ) from exc
        if (
            not isinstance(ledger, dict)
            or set(ledger) != set(_LEDGER_FIELDS)
            or ledger.get("schema_version") != _LEDGER_SCHEMA_VERSION
            or not isinstance(ledger.get("entries"), dict)
        ):
            raise ToolError(
                "state_corrupt",
                "save/toolbox-ledger.json does not match the current schema",
            )
        for key, entry in ledger["entries"].items():
            if not isinstance(entry, dict):
                raise ToolError("state_corrupt", "toolbox ledger entry is invalid")
            entry_schema = entry.get("entry_schema_version")
            expected_fields = (
                _LEDGER_ENTRY_V2_FIELDS
                if entry_schema == 2
                else _LEDGER_ENTRY_V3_FIELDS
                if entry_schema == 3
                else _LEDGER_ENTRY_V4_FIELDS
                if entry_schema == 4
                else _LEDGER_ENTRY_V5_FIELDS
                if entry_schema == 5
                else None
            )
            tool_name = entry.get("tool")
            decision_id = entry.get("decision_id")
            if (
                expected_fields is None
                or set(entry) != set(expected_fields)
                or not isinstance(tool_name, str)
                or not tool_name
                or not isinstance(decision_id, str)
                or not decision_id
                or not isinstance(entry.get("ts"), str)
                or not entry["ts"]
                or str(key) != self._ledger_key(tool_name, decision_id)
                or (
                    entry_schema in {3, 5}
                    and entry.get("source_receipt_required") is not True
                )
            ):
                raise ToolError(
                    "state_corrupt",
                    "toolbox ledger entry does not match its current composite key schema",
                )
            if entry_schema in {3, 5}:
                _ledger_requires_source_receipt(entry)
        return ledger

    def ledger_lookup(self, tool: str, decision_id: str | None) -> dict[str, Any] | None:
        if not decision_id:
            return None
        path = self._ledger_path()
        if not path.is_file():
            return None
        ledger = self._load_ledger()
        entries = ledger["entries"]
        entry = entries.get(self._ledger_key(tool, str(decision_id)))
        if entry is not None:
            invalidation = entry.get("invalidation")
            if isinstance(invalidation, dict):
                raise ToolError(
                    "decision_invalidated",
                    f"{tool} decision_id '{decision_id}' belongs to a turn tail "
                    "invalidated by session.resume; use a fresh decision_id",
                    details=deepcopy(invalidation),
                )
            return entry
        return None

    def ledger_invalidate(
        self,
        decisions: set[tuple[str, str]],
        *,
        reason: str,
        source: str,
    ) -> list[str]:
        """Tombstone durable idempotency results whose state was rolled back."""
        if not decisions:
            return []
        ledger = self._load_ledger()
        entries = ledger["entries"]
        invalidated: list[str] = []
        now = _now_iso()
        for tool, decision_id in sorted(decisions):
            key = self._ledger_key(tool, decision_id)
            entry = entries.get(key)
            if not isinstance(entry, dict):
                continue
            if isinstance(entry.get("invalidation"), dict):
                invalidated.append(key)
                continue
            entry = deepcopy(entry)
            entry["entry_schema_version"] = (
                5 if entry.get("entry_schema_version") == 3 else 4
            )
            entry["invalidation"] = {
                "reason": reason,
                "source": source,
                "invalidated_at": now,
            }
            entries[key] = entry
            invalidated.append(key)
        if invalidated:
            coc_state.write_json_atomic(self._ledger_path(), ledger)
        return invalidated

    def ledger_record(
        self,
        decision_id: str | None,
        tool: str,
        data: Any,
        *,
        source_receipt_manifest: dict[str, Any] | None = None,
    ) -> None:
        if not decision_id:
            return
        path = self._ledger_path()
        ledger = self._load_ledger()
        entries = ledger["entries"]
        existing = entries.get(self._ledger_key(tool, str(decision_id)))
        if isinstance(existing, dict) and isinstance(
            existing.get("invalidation"), dict
        ):
            raise ToolError(
                "decision_invalidated",
                f"{tool} decision_id '{decision_id}' was invalidated by a "
                "turn-tail restore and cannot be reused; use a fresh decision_id",
                details=deepcopy(existing["invalidation"]),
            )
        entry = {
            "entry_schema_version": 3 if source_receipt_manifest is not None else 2,
            "tool": tool,
            "decision_id": str(decision_id),
            "ts": _now_iso(),
            "data": data,
        }
        if source_receipt_manifest is not None:
            entry["source_receipt_required"] = True
            entry["source_receipt_manifest"] = deepcopy(
                source_receipt_manifest
            )
        entries[self._ledger_key(tool, str(decision_id))] = entry
        if len(entries) > _LEDGER_MAX_ENTRIES:
            ordered = sorted(entries.items(), key=lambda kv: str(kv[1].get("ts", "")))
            for key, _ in ordered[: len(entries) - _LEDGER_MAX_ENTRIES]:
                entries.pop(key, None)
        coc_state.write_json_atomic(path, ledger)

def _rng(args: dict[str, Any]) -> random.Random:
    seed = args.get("seed")
    return random.Random(seed) if seed is not None else random.Random()

def _rules_resolver(ctx: Ctx, capability: str | None = None):
    """Resolver of the ruleset bound to the active campaign (contract §4).

    Phase 1 seam 2: ``rules.*`` handlers obtain every ruleset behavior
    (dice, checks, SAN/damage arithmetic, lookups, healing-chain requests)
    through this one registry lookup instead of importing
    ``coc_rules``/``coc_roll``/``coc_sanity`` directly. Campaign-less tools
    resolve the default ruleset. Direct module imports that remain below are
    kernel receipt-integrity validation (dice evidence re-derivation) or
    non-``rules.*`` subsystem code (combat profile, npc.reaction).
    """
    campaign = None
    if ctx.campaign_dir is not None:
        campaign = coc_state.load_campaign_state(ctx.campaign_dir)
    resolver = coc_rulesets.get_resolver(campaign)
    if capability is None:
        return resolver
    try:
        advertised = resolver.public_api_index()
    except Exception as exc:
        raise ToolError(
            "invalid_ruleset",
            "active ruleset public_api_index failed",
        ) from exc
    if isinstance(advertised, dict):
        supported = capability in advertised
    elif isinstance(advertised, (list, tuple, set, frozenset)):
        supported = capability in {
            value for value in advertised if isinstance(value, str)
        }
    else:
        raise ToolError(
            "invalid_ruleset",
            "active ruleset public_api_index must be an object or string list",
        )
    if not supported or not callable(getattr(resolver, capability, None)):
        ruleset_id = coc_rulesets.get_campaign_ruleset_id(campaign)
        raise ToolError(
            "unsupported_ruleset_operation",
            f"ruleset {ruleset_id!r} does not support {capability!r}",
        )
    return resolver

def _active_ruleset_id(ctx: Ctx) -> str:
    campaign = (
        coc_state.load_campaign_state(ctx.campaign_dir)
        if ctx.campaign_dir is not None
        else None
    )
    return coc_rulesets.get_campaign_ruleset_id(campaign)

TOOLS: dict[str, dict[str, Any]] = {}
tool: Any = None

def _working_set_domain_paths(
    ctx: Ctx, domains: tuple[str, ...]
) -> dict[str, tuple[Path, ...]]:
    campaign = ctx.campaign_dir
    save = campaign / "save"
    scenario = campaign / "scenario"
    known: dict[str, tuple[Path, ...]] = {
        "scene": (scenario / "story-graph.json",),
        "world": (save / "world-state.json",),
        "pacing": (save / "pacing-state.json", save / "active-scene.json"),
        "clues": (scenario / "clue-graph.json",),
        "handouts": (
            scenario / "handouts.json",
            campaign / "index" / "handout-assets.json",
        ),
        "npc": (
            scenario / "npc-agendas.json",
            scenario / "module-meta.json",
            save / "npc-state.json",
            save / coc_first_impression.FILENAME,
        ),
        "npc_presence": (
            scenario / "story-graph.json",
            save / "world-state.json",
            save / "npc-state.json",
            save / coc_first_impression.FILENAME,
        ),
        "time": (save / "time-state.json", save / "time-markers.json"),
        "active_effects": (save / coc_exceptional_effects.FILENAME,),
        "attempts": (save / "roll-operation-receipts.json",),
        "flags": (save / "flags.json",),
        # The compiled archive is a rebuildable read model, but scene.context
        # consumes it directly.  Its atomic manifest/status pair must therefore
        # participate in query-cache invalidation even when canonical scenario
        # IR and live campaign state are unchanged (for example after a
        # compiler-contract upgrade followed by writer-side republish).
        "module_archive": (
            save / coc_compiled_archive.ARCHIVE_DIRNAME / coc_compiled_archive.MANIFEST_NAME,
            save / coc_compiled_archive.ARCHIVE_DIRNAME / coc_compiled_archive.STATUS_NAME,
        ),
        "mechanics": (
            scenario / "module-meta.json",
            scenario / "npc-agendas.json",
            save / "npc-state.json",
            save / "campaign-mechanics.json",
        ),
    }
    party_paths: list[Path] = [campaign / "party.json"]
    for investigator_id in ctx.party_ids():
        party_paths.extend((
            ctx.coc_root / "investigators" / investigator_id / "character.json",
            save / "investigator-state" / f"{investigator_id}.json",
            save / "sanity-state" / f"{investigator_id}.json",
        ))
    known["party"] = tuple(party_paths)
    asset_root_id = (
        coc_module_project.campaign_asset_root_id(campaign)
        if campaign is not None else None
    )
    if asset_root_id:
        module_root = coc_module_project.coc_module_assets.assets_root(ctx.root) / asset_root_id
        known["module_progressive"] = (
            module_root / "parse-queue.json",
            *tuple(sorted((module_root / "host-work").glob("*.json"))),
        )
    return {
        domain: known[domain]
        for domain in domains
        if domain in known
    }

_CONTINUATION_DOMAINS = (
    "scene", "world", "pacing", "clues", "npc", "npc_presence", "time",
    "active_effects", "attempts", "flags", "party", "module_progressive",
)

def _continuation_revision(ctx: Ctx) -> tuple[dict[str, int], str]:
    return coc_working_set_cache.revision_vector(
        ctx.campaign_dir,
        _working_set_domain_paths(ctx, _CONTINUATION_DOMAINS),
    )

_PI_OPENING_SETUP_ALLOWED_OPERATIONS = frozenset({
    "progressive.prepare_opening",
    "progressive.opening_bootstrap",
    "progressive.project_opening",
    "progressive.on_enter_scene",
    "progressive.claim_host_work",
    "progressive.fulfill_host_work",
    "progressive.renew_host_work_leases",
    "progressive.release_host_work_leases",
    "setup.adopt_source_facts",
    "setup.investigator_contract",
    "setup.chargen_run",
    "rules.cash_assets",
})

_PI_OPENING_SETUP_ALLOWED_SETUP_KINDS = frozenset({
    "actor.create",
    "investigator.create",
    "campaign.link_investigator",
    "campaign.render_briefing",
    "investigator.render_card",
})

_PI_OPENING_PHASE_QUERY_OPERATIONS = frozenset({"setup.phase"})

def _opening_host_work_mode(execution_class: Any) -> str:
    """Choose observation only from the canonical execution classification."""
    return "pure_read" if execution_class == "parallel_read" else "mutating"

_OPENING_SETUP_ACL_BLOCK_ALL: dict[str, Any] = {
    "operations": frozenset(),
    "setup_kinds": frozenset(),
    "chargen_dice": None,
    "era_adaptive_cash": False,
    "exact_next_operation_only": False,
}

_OPENING_SETUP_ACL_CHARACTER_SETUP: dict[str, Any] = {
    "operations": _PI_OPENING_SETUP_ALLOWED_OPERATIONS,
    "setup_kinds": _PI_OPENING_SETUP_ALLOWED_SETUP_KINDS,
    "chargen_dice": "policy_scoped",
    "era_adaptive_cash": True,
    "exact_next_operation_only": False,
}

_OPENING_SETUP_ACL: dict[str, dict[str, Any]] = {
    coc_opening_phase.SUB_PHASE_CONTRACT_INVALID: _OPENING_SETUP_ACL_BLOCK_ALL,
    coc_opening_phase.SUB_PHASE_REVIEW_FAILED: _OPENING_SETUP_ACL_BLOCK_ALL,
    coc_opening_phase.SUB_PHASE_REVIEW_REQUIRED: {
        "operations": frozenset({
            "setup.adopt_source_facts",
            "setup.investigator_contract",
            "rules.cash_assets",
        }),
        "setup_kinds": _PI_OPENING_SETUP_ALLOWED_SETUP_KINDS,
        "chargen_dice": "quick_fire_only",
        "era_adaptive_cash": False,
        "exact_next_operation_only": False,
    },
    coc_opening_phase.SUB_PHASE_FACTS_ADOPTION_REQUIRED: {
        "operations": frozenset(),
        "setup_kinds": frozenset(),
        "chargen_dice": None,
        "era_adaptive_cash": False,
        "exact_next_operation_only": True,
    },
    coc_opening_phase.SUB_PHASE_MATERIALIZATION: (
        _OPENING_SETUP_ACL_CHARACTER_SETUP
    ),
    coc_opening_phase.SUB_PHASE_SELECTION: _OPENING_SETUP_ACL_CHARACTER_SETUP,
    coc_opening_phase.SUB_PHASE_CHARACTER_SETUP_REQUIRED: (
        _OPENING_SETUP_ACL_CHARACTER_SETUP
    ),
}

def _pi_opening_source_contract_error_gate(
    campaign_id: str,
    *,
    code: str,
    message: str,
    asset_root_id: str | None = None,
    opening_phase: str = coc_opening_phase.PHASE_MODULE_PREPARATION,
) -> dict[str, Any]:
    """Keep a persisted Pi source binding fail-closed when it cannot resolve."""
    return {
        "schema_version": 1,
        "status": "blocked",
        "hard_gate": True,
        "activation_allowed": False,
        "phase": coc_opening_phase.SUB_PHASE_CONTRACT_INVALID,
        "opening_phase": str(opening_phase),
        "campaign_id": str(campaign_id),
        **({"asset_root_id": asset_root_id} if asset_root_id else {}),
        "source_contract_error": {
            "code": str(code),
            "message": str(message),
        },
        "next_operation": None,
        "instruction": (
            "the persisted source-bound opening contract is invalid; do not "
            "resume, rediscover, rebind, inspect live-play state, mutate play, "
            "or narrate an opening until the source contract is repaired"
        ),
    }

def _pi_opening_character_setup_envelope(
    derived: dict[str, Any],
) -> dict[str, Any] | None:
    """Format the character-setup discriminator from the phase derivation."""
    character_setup = derived["detail"]["character_setup"]
    if not character_setup.get("resume_gate_required"):
        return None
    campaign_id = str(derived["campaign_id"])
    input_mode = character_setup.get("input_mode")
    envelope: dict[str, Any] = {
        "schema_version": 1,
        "status": "blocked",
        "hard_gate": True,
        "activation_allowed": False,
        "phase": coc_opening_phase.SUB_PHASE_CHARACTER_SETUP_REQUIRED,
        "opening_phase": derived["phase"],
        "campaign_id": campaign_id,
    }
    if input_mode == "kp_guided_era_adaptive":
        envelope.update({
            "character_setup_policy": "kp_guided_era_adaptive",
            "character_setup_input_mode": input_mode,
            "next_operation": None,
            "instruction": (
                "complete one KP-guided era-adaptive investigator creation and "
                "exact campaign link before opening play"
            ),
        })
        return envelope
    envelope.update({
        "character_setup_policy": "guided_quick_fire",
        "next_operation": None,
        "instruction": (
            "complete one guided Quick Fire investigator creation and exact "
            "campaign link before opening play"
        ),
    })
    return envelope

def _pi_opening_setup_gate(
    root: Path,
    campaign_id: str | None,
    *,
    include_character_setup: bool = False,
    host_work_mode: str = "mutating",
) -> dict[str, Any] | None:
    """Return the persisted Pi opening gate until source projection is fresh.

    Single decision source: ``coc_opening_phase.derive_opening_phase``. This
    function only formats that derivation into the persisted gate envelope.
    ``host_work_mode="pure_read"`` changes only lifecycle observation; role,
    session, ACL, secrecy, and availability checks still use this full gate.
    Starter campaigns are no longer short-circuited before the machine runs —
    they simply derive a satisfied ``module_preparation`` and therefore expose
    no source gate, which is the behavior they always had.
    """
    if str(os.environ.get("COC_HOST") or "").lower() != "pi" or not campaign_id:
        return None
    campaign_dir = root / ".coc" / "campaigns" / str(campaign_id)
    if not campaign_dir.is_dir():
        return None
    derived = coc_opening_phase.derive_opening_phase(
        root,
        str(campaign_id),
        host_work_mode=host_work_mode,
    )
    preparation = derived["detail"]["module_preparation"]
    sub_phase = preparation["sub_phase"]
    if sub_phase is None:
        # Module preparation is satisfied. Only a source-bound campaign whose
        # current projection is fresh may still be sent back to character
        # setup, and only when the caller asked for that discriminator.
        # A starter resume is character setup but not a hard gate: it succeeds
        # and carries the player-safe ``character_creation`` projection.
        if include_character_setup and preparation["source_gated"]:
            return _pi_opening_character_setup_envelope(derived)
        return None
    campaign_id = str(campaign_id)
    opening_phase = derived["phase"]
    if sub_phase == coc_opening_phase.SUB_PHASE_CONTRACT_INVALID:
        error = preparation["contract_error"] or {}
        return _pi_opening_source_contract_error_gate(
            campaign_id,
            code=str(error.get("code") or "opening_source_contract_invalid"),
            message=str(error.get("message") or ""),
            asset_root_id=error.get("asset_root_id"),
            opening_phase=opening_phase,
        )
    if sub_phase == coc_opening_phase.SUB_PHASE_REVIEW_FAILED:
        return {
            "schema_version": 1,
            "status": "failed",
            "hard_gate": True,
            "activation_allowed": False,
            "phase": coc_opening_phase.SUB_PHASE_REVIEW_FAILED,
            "opening_phase": opening_phase,
            "campaign_id": campaign_id,
            "source_provenance": preparation["source_provenance"],
            "required_source_owner": "coc-opening-source-coordinator",
            "character_setup_complete": bool(
                derived["detail"]["character_setup"]["party_linked"]
            ),
            "source_review_failure": deepcopy(preparation["review_failure"]),
            "next_operation": None,
            "instruction": (
                "the canonical opening source coordinator terminated without "
                "a reviewed playable opening; do not retry, rebind, invent, "
                "project, mutate play, or narrate from the locator hint"
            ),
        }
    if sub_phase == coc_opening_phase.SUB_PHASE_REVIEW_REQUIRED:
        review_task = preparation["review_task"] or {}
        return {
            "schema_version": 1,
            "status": "blocked",
            "hard_gate": True,
            "activation_allowed": False,
            "phase": coc_opening_phase.SUB_PHASE_REVIEW_REQUIRED,
            "opening_phase": opening_phase,
            "campaign_id": campaign_id,
            "scenario_id": review_task.get("scenario_id"),
            "source_provenance": preparation["source_provenance"],
            "required_source_owner": "coc-opening-source-coordinator",
            "opening_review_generation": review_task.get(
                "opening_review_generation"
            ),
            "character_setup_complete": bool(
                derived["detail"]["character_setup"]["party_linked"]
            ),
            "next_operation": None,
            "instruction": (
                "retain this fast locator only as spoiler-free character "
                "background; the canonical coc-opening-source-coordinator must "
                "visually review and rebind the complete current player-facing "
                "opening window before progressive preparation, projection, "
                "table-opening evidence, scene mutation, or narration"
            ),
        }
    if sub_phase == coc_opening_phase.SUB_PHASE_FACTS_ADOPTION_REQUIRED:
        transport = preparation["facts_transport"] or {}
        return {
            "schema_version": 1,
            "status": "blocked",
            "hard_gate": True,
            "activation_allowed": False,
            "phase": coc_opening_phase.SUB_PHASE_FACTS_ADOPTION_REQUIRED,
            "opening_phase": opening_phase,
            "campaign_id": campaign_id,
            "scenario_id": transport.get("scenario_id"),
            "opening_review_generation": transport.get(
                "opening_review_generation"
            ),
            "next_operation": deepcopy(derived["next_operation"]),
            "instruction": (
                "invoke this exact sealed setup.adopt_source_facts "
                "card before opening selection or character setup"
            ),
        }
    asset_root_id = str(preparation["asset_root_id"] or "")
    if sub_phase == coc_opening_phase.SUB_PHASE_MATERIALIZATION:
        watch = preparation["watch"] or {}
        if not isinstance(watch, dict):
            watch = {}
        watch_status = str(preparation["watch_status"] or "pending")
        decision = coc_opening_recovery.recover_materialization_watch(
            root,
            campaign_dir,
            watch_status=watch_status,
            watch=watch,
            asset_root_id=asset_root_id,
            host_work_mode=host_work_mode,
            module_project=coc_module_project,
        )
        gate = {
            "schema_version": 1,
            "status": "blocked",
            "hard_gate": True,
            "activation_allowed": False,
            "phase": coc_opening_phase.SUB_PHASE_MATERIALIZATION,
            "opening_phase": opening_phase,
            "campaign_id": campaign_id,
            "asset_root_id": asset_root_id,
            "source_lifecycle_status": decision["source_lifecycle_status"]
            or watch_status,
            "next_operation": None,
            "instruction": (
                "retain the accepted opening_bootstrap receipt and wait for its "
                "host terminal lifecycle; do not rebind, rediscover, resume, "
                "move a scene, or narrate an opening"
            ),
        }
        action = decision["action"]
        if action == coc_opening_recovery.ACTION_REFRESH_PROJECTION:
            # A completed watch whose projection no longer recomputes against
            # current repository evidence (e.g. background deepen rewrote the
            # durable packs) must never leave the Keeper with a null
            # next_operation: re-issue the explicit projection refresh card.
            # Post-delivery the delivered receipt is pinned and this branch is
            # unreachable for legitimate deepen drift.
            refresh = _opening_card(
                str(decision["operation"]),
                dict(decision["prefilled_arguments"]),
                list(decision["missing_arguments"]),
            )
            refresh.update({
                "hard_gate": True,
                "authority": "canonical_setup",
                "reason": (
                    "the delivered opening projection no longer recomputes "
                    "against current repository evidence; re-project it "
                    "explicitly before any live-play operation"
                ),
            })
            gate["next_operation"] = refresh
            gate["instruction"] = (
                "invoke this exact progressive.project_opening card to refresh "
                "the opening projection; do not rebind, rediscover, resume, "
                "move a scene, or narrate an opening first"
            )
        elif action == coc_opening_recovery.ACTION_REARM_BOOTSTRAP:
            rearm = _opening_card(
                str(decision["operation"]),
                dict(decision["prefilled_arguments"]),
                list(decision["missing_arguments"]),
            )
            rearm.update({
                "hard_gate": True,
                "authority": "canonical_setup",
                "reason": (
                    "the retained opening source lifecycle has no live owner; "
                    "re-issue the bootstrap for the same retained opening "
                    "instead of waiting for a terminal event that can no "
                    "longer arrive"
                ),
            })
            gate["retained_start_location_id"] = decision[
                "retained_start_location_id"
            ]
            gate["next_operation"] = rearm
            if decision["lost_kind"] == "dispatch_lost":
                gate["instruction"] = (
                    "the opening host-work was never claimed; invoke this "
                    "exact progressive.opening_bootstrap card for the same "
                    "retained opening to re-issue dispatch; do not rebind, "
                    "rediscover, or narrate an opening"
                )
            else:
                gate["instruction"] = (
                    "the opening source lifecycle owner is gone; invoke this "
                    "exact progressive.opening_bootstrap card for the same "
                    "retained opening; do not rebind, rediscover, or narrate "
                    "an opening"
                )
        elif action == coc_opening_recovery.ACTION_LOST_AFTER_PLAY:
            gate["instruction"] = (
                "opening source work was lost after scene evidence began; "
                "do not re-bootstrap over played state"
            )
        elif action == coc_opening_recovery.ACTION_POLL_STATUS:
            wait = _opening_card(
                str(decision["operation"]),
                dict(decision["prefilled_arguments"]),
                list(decision["missing_arguments"]),
            )
            wait.update({
                "hard_gate": True,
                "authority": "canonical_setup",
                "reason": (
                    "opening source materialization is still pending host "
                    "coordinator fulfillment; poll this exact status card "
                    "and retain the accepted bootstrap receipt rather than "
                    "rebinding, rediscovering, or narrating an opening"
                ),
            })
            gate["next_operation"] = wait
            gate["instruction"] = (
                "opening source materialization is pending; invoke this exact "
                "progressive.status card to re-check lifecycle progress; do "
                "not rebind, rediscover, resume, move a scene, or narrate an "
                "opening"
            )
        return gate
    next_operation = _opening_card("progressive.prepare_opening", {}, [])
    next_operation.update({
        "hard_gate": True,
        "authority": "canonical_setup",
        "reason": (
            "Select the shortest sufficient source opening before any live-play "
            "operation."
        ),
    })
    return {
        "schema_version": 1,
        "status": "blocked",
        "hard_gate": True,
        "activation_allowed": False,
        "phase": coc_opening_phase.SUB_PHASE_SELECTION,
        "opening_phase": opening_phase,
        "campaign_id": campaign_id,
        "asset_root_id": asset_root_id,
        "next_operation": next_operation,
        "instruction": (
            "invoke this exact progressive.prepare_opening card now; do not "
            "rebind, rediscover, resume, inspect scene/play APIs, or narrate an "
            "opening first"
        ),
    }

def _quick_fire_chargen_dice(args: dict[str, Any]) -> bool:
    """The canonical investigator-creation dice recipes, purpose-bound."""
    allowed = {"expression", "decision_id", "purpose", "reason"}
    purpose = args.get("purpose")
    expression = args.get("expression")
    canonical_recipe = (
        purpose == "investigator_creation_luck" and expression == "3D6"
    ) or (
        purpose == "investigator_creation_characteristic"
        and expression in {"3D6", "2D6+6", "1D100", "1D10"}
    )
    return bool(
        set(args) <= allowed
        and {"expression", "decision_id", "purpose"} <= set(args)
        and canonical_recipe
        and (
            "reason" not in args
            or args.get("reason") is None
            or isinstance(args.get("reason"), str)
        )
        and bool(str(args.get("decision_id") or "").strip())
    )

def _era_adaptive_chargen_dice(args: dict[str, Any]) -> bool:
    """The era-adaptive KP-guided characteristic dice contract.

    B2 moves this into the investigator contract data so the two built-in
    modules stop forking here; this milestone only routes it through the table.
    """
    return bool(
        set(args) <= {"expression", "decision_id", "reason"}
        and {"expression", "decision_id"} <= set(args)
        and args.get("expression") in {"3D6", "2D6+6"}
        and (
            "reason" not in args
            or args.get("reason") is None
            or isinstance(args.get("reason"), str)
        )
        and bool(str(args.get("decision_id") or "").strip())
    )

def _pi_opening_setup_operation_allowed(
    name: str,
    args: dict[str, Any],
    gate: dict[str, Any] | None = None,
) -> bool:
    """Decide one operation against the single per-phase allow table."""
    gate = gate if isinstance(gate, dict) else {}
    if name in _PI_OPENING_PHASE_QUERY_OPERATIONS:
        return True
    row = _OPENING_SETUP_ACL.get(
        str(gate.get("phase") or ""),
        _OPENING_SETUP_ACL_CHARACTER_SETUP,
    )
    if row["exact_next_operation_only"]:
        next_operation = gate.get("next_operation")
        expected = (
            next_operation.get("operation")
            if isinstance(next_operation, dict)
            else None
        )
        expected_arguments = (
            next_operation.get("arguments")
            if isinstance(next_operation, dict)
            else None
        )
        return bool(name == expected and args == expected_arguments)
    if name == "rules.roll_dice":
        mode = row["chargen_dice"]
        if mode is None:
            return False
        if _quick_fire_chargen_dice(args):
            return True
        return bool(
            mode == "policy_scoped"
            and gate.get("character_setup_policy") == "kp_guided_era_adaptive"
            and _era_adaptive_chargen_dice(args)
        )
    if name == "state.cash_semantic":
        return bool(
            row["era_adaptive_cash"]
            and gate.get("character_setup_policy") == "kp_guided_era_adaptive"
        )
    if name == "setup.invoke":
        return str(args.get("kind") or "") in row["setup_kinds"]
    return name in row["operations"]

def _scene_by_id(story_graph: dict[str, Any], scene_id: str | None) -> dict[str, Any] | None:
    if not scene_id:
        return None
    for scene in story_graph.get("scenes") or []:
        if isinstance(scene, dict) and str(scene.get("scene_id")) == str(scene_id):
            return scene
    return None

def _all_clues(clue_graph: dict[str, Any]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for conclusion in clue_graph.get("conclusions") or []:
        if not isinstance(conclusion, dict):
            continue
        for clue in conclusion.get("clues") or []:
            if isinstance(clue, dict) and clue.get("clue_id"):
                entry = dict(clue)
                entry["conclusion_id"] = conclusion.get("conclusion_id")
                out.append(entry)
    return out

def _clue_by_id(clue_graph: dict[str, Any], clue_id: str) -> dict[str, Any] | None:
    for clue in _all_clues(clue_graph):
        if str(clue.get("clue_id")) == str(clue_id):
            return clue
    return None

def _npc_by_id(npc_agendas: dict[str, Any], npc_id: str) -> dict[str, Any] | None:
    return coc_npc_identity.resolve_authored_npc(npc_agendas, npc_id)

def _npc_identity_contract(
    npc: dict[str, Any],
    active_scene_id: str | None,
) -> dict[str, Any]:
    return coc_npc_identity.identity_contract(npc, active_scene_id)

def _campaign_npc_projection_index(
    ctx: Ctx, npc_state: dict[str, Any]
) -> tuple[set[str], dict[str, str], set[str], dict[str, Any], dict[str, str]]:
    """Index campaign-local NPC ids and their player-safe stable names.

    Both npc.query and scene.context consume this same projection so an
    improvised contact cannot exist in relationship state yet disappear from
    scene grounding merely because the module did not author an agenda row.
    """
    try:
        campaign_id = coc_npc_event_chain.resolve_campaign_id(ctx.campaign_dir)
        impression_document = coc_first_impression.load_document(
            ctx.campaign_dir, campaign_id
        )
    except ValueError as exc:
        raise ToolError("state_corrupt", str(exc)) from exc

    campaign_names: dict[str, str] = {}
    accepted_table_names: dict[str, str] = {}
    name_conflicts: set[str] = set()
    receipt_npc_ids: set[str] = set()
    for pair in sorted((impression_document.get("receipts") or {})):
        receipt = impression_document["receipts"][pair]
        npc_id = str(receipt.get("npc_id") or "").strip()
        if not npc_id:
            continue
        receipt_npc_ids.add(npc_id)
        display_name = str(receipt.get("npc_display_name") or "").strip()
        if not display_name:
            continue
        accepted_table_names.setdefault(npc_id, display_name)
        prior_name = campaign_names.setdefault(npc_id, display_name)
        if prior_name != display_name:
            name_conflicts.add(npc_id)

    persona_cards = (
        npc_state.get("npcs") if isinstance(npc_state.get("npcs"), dict) else {}
    )
    psych_by_id = (
        npc_state.get("psych") if isinstance(npc_state.get("psych"), dict) else {}
    )
    campaign_npc_ids = {
        str(npc_id).strip()
        for source in (persona_cards, psych_by_id)
        for npc_id in source
        if str(npc_id).strip()
    } | receipt_npc_ids
    for npc_id, card in persona_cards.items():
        if npc_id in campaign_names or not isinstance(card, dict):
            continue
        raw_name = card.get("name")
        if isinstance(raw_name, dict):
            raw_name = raw_name.get("value")
        if not isinstance(raw_name, str):
            raw_name = card.get("display_name")
        name = str(raw_name or "").strip()
        if name:
            campaign_names[str(npc_id)] = name
    return (
        campaign_npc_ids,
        campaign_names,
        name_conflicts,
        impression_document,
        accepted_table_names,
    )

_ROLL_GATED_DELIVERY_KINDS = frozenset({"skill_check", "characteristic_check"})

_ROLL_GATED_DISCOVERY_MODES = frozenset({"check", "conditional_check"})

def _clue_is_roll_gated(clue: dict[str, Any]) -> bool:
    """Return True only for explicit check modes or starter check delivery."""
    discovery = clue.get("discovery")
    if isinstance(discovery, dict):
        mode = str(discovery.get("mode") or "")
        return mode in _ROLL_GATED_DISCOVERY_MODES
    return str(clue.get("delivery_kind") or "") in _ROLL_GATED_DELIVERY_KINDS

def _clue_roll_gate_skills(clue: dict[str, Any]) -> list[str]:
    """Structured skill labels the module binds to a roll-gated clue."""
    skills: list[str] = []
    discovery = clue.get("discovery")
    if isinstance(discovery, dict):
        primary = discovery.get("skill")
        if isinstance(primary, str) and primary.strip():
            skills.append(primary.strip())
    primary = clue.get("skill")
    if isinstance(primary, str) and primary.strip():
        label = primary.strip()
        if label.casefold() not in {skill.casefold() for skill in skills}:
            skills.append(label)
    affordance = clue.get("affordance")
    if isinstance(affordance, dict):
        for value in affordance.get("skills") or []:
            if isinstance(value, str) and value.strip():
                label = value.strip()
                if label.casefold() not in {skill.casefold() for skill in skills}:
                    skills.append(label)
    return skills

def _logged_roll_skills(ctx: Ctx) -> set[str] | None:
    """Casefolded skill labels present in logs/rolls.jsonl, or None when the
    log exists but cannot be read (advisory evidence must never accuse the KP
    on the basis of an I/O failure).  Only the structured ``skill`` field of a
    roll row (flat or inside its payload) is consulted; free-text fields such
    as ``reason`` are deliberately ignored."""
    path = ctx.campaign_dir / "logs" / "rolls.jsonl"
    if not path.is_file():
        return set()
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return None
    skills: set[str] = set()
    for line in lines:
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not isinstance(row, dict):
            continue
        for container in (row, row.get("payload")):
            if not isinstance(container, dict):
                continue
            label = container.get("skill")
            if isinstance(label, str) and label.strip():
                skills.add(label.strip().casefold())
    return skills

def _skill_check_clues_missing_roll_evidence(
    ctx: Ctx, clue_ids: list[str]
) -> list[dict[str, Any]] | None:
    """Roll-gated authored clues among clue_ids with no matching skill roll.

    Evidence is structural only: a clue counts as covered when the roll log
    holds at least one roll whose skill label matches one of the clue's
    authored gate skills.  Returns None when roll evidence is unreadable.
    """
    logged = _logged_roll_skills(ctx)
    if logged is None:
        return None
    missing: list[dict[str, Any]] = []
    for clue_id in clue_ids:
        clue = _clue_by_id(ctx.clue_graph, str(clue_id))
        if clue is None or not _clue_is_roll_gated(clue):
            continue
        gate_skills = _clue_roll_gate_skills(clue)
        if any(skill.casefold() in logged for skill in gate_skills):
            continue
        discovery = clue.get("discovery") if isinstance(clue.get("discovery"), dict) else {}
        missing.append({
            "clue_id": str(clue.get("clue_id")),
            "delivery_kind": clue.get("delivery_kind"),
            "discovery_mode": discovery.get("mode"),
            "gate_skills": gate_skills,
        })
    return missing

def _improvised_npc_engagement_count(ctx: Ctx) -> int | None:
    """Recorded state.record_npc_engagement receipts without an authored
    identity contract (structured improvised-NPC evidence).  None when the
    receipt source is unreadable."""
    try:
        document = coc_npc_event_chain.load_receipt_document(ctx.campaign_dir)
    except ValueError:
        return None
    count = 0
    for receipt in (document.get("receipts") or {}).values():
        if not isinstance(receipt, dict):
            continue
        if receipt.get("producer") != "state.record_npc_engagement":
            continue
        event = receipt.get("event")
        if isinstance(event, dict) and event.get("identity_contract") is None:
            count += 1
    return count

def _adjudication_gap_hints(ctx: Ctx) -> list[str]:
    """Session-level 'expected rolls that never happened' advisory counters."""
    world = ctx.world()
    discovered = [str(c) for c in (world.get("discovered_clue_ids") or [])]
    hints: list[str] = []
    missing = _skill_check_clues_missing_roll_evidence(ctx, discovered)
    if missing is not None:
        detail = f": {', '.join(row['clue_id'] for row in missing)}" if missing else ""
        hints.append(
            f"adjudication diagnostic: {len(missing)} recorded skill_check clue(s) "
            f"lack roll evidence{detail} — review whether each reveal was earned "
            "by a check or was a conscious free reveal"
        )
    improvised = _improvised_npc_engagement_count(ctx)
    if improvised is not None:
        hints.append(
            f"adjudication diagnostic: {improvised} improvised NPC engagement(s) "
            "recorded — the KP adjudicated each one's plausibility against "
            "module truth and established fiction"
        )
    return hints

def _skill_catalog() -> dict[str, dict[str, Any]]:
    """Cached rulebook skill catalog: canonical name -> spec incl. localized labels."""
    global _SKILL_CATALOG_CACHE
    if _SKILL_CATALOG_CACHE is None:
        catalog: dict[str, dict[str, Any]] = {}
        path = (
            coc_rulesets.ruleset_data_dir(coc_rulesets.DEFAULT_RULESET_ID)
            / "skills.json"
        )
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            payload = {}
        for canonical, spec in (payload.get("skills") or {}).items():
            if isinstance(canonical, str) and isinstance(spec, dict):
                catalog[canonical] = spec
        _SKILL_CATALOG_CACHE = catalog
    return _SKILL_CATALOG_CACHE

def _compact_skill_fold(name: Any) -> str:
    """Space/underscore-insensitive casefold for skill identity matching."""
    return re.sub(r"[\s_]+", "", str(name)).casefold()

def _canonical_skill_base(skill: Any) -> tuple[str, int] | None:
    """Return an authored rulebook base chance for a known skill when numeric."""
    global _SKILL_BASES_CACHE
    if _SKILL_BASES_CACHE is None:
        _SKILL_BASES_CACHE = {}
        for canonical, spec in _skill_catalog().items():
            base = spec.get("base_chance")
            if isinstance(base, int) and not isinstance(base, bool):
                _SKILL_BASES_CACHE[canonical.casefold()] = (canonical, int(base))
    return _SKILL_BASES_CACHE.get(str(skill).casefold())

def _matches_canonical_skill_identity(skill: Any, canonical_name: str) -> bool:
    """Match one structured skill selector against its ruleset catalog identity."""
    folded = _compact_skill_fold(skill)
    if folded == _compact_skill_fold(canonical_name):
        return True
    spec = _skill_catalog().get(canonical_name)
    labels = spec.get("localized_labels") if isinstance(spec, dict) else None
    return isinstance(labels, dict) and any(
        isinstance(label, str) and folded == _compact_skill_fold(label)
        for label in labels.values()
    )

def _clue_public_view(clue: dict[str, Any], discovered: set[str]) -> dict[str, Any]:
    clue_id = str(clue.get("clue_id"))
    is_discovered = clue_id in discovered
    view = {
        "clue_id": clue.get("clue_id"),
        "conclusion_id": clue.get("conclusion_id"),
        "discovered": is_discovered,
        "delivery": clue.get("delivery"),
        "delivery_kind": clue.get("delivery_kind"),
        "skill": clue.get("skill"),
        "difficulty": clue.get("difficulty"),
        "player_safe_summary": clue.get("player_safe_summary") if is_discovered else None,
        "localized_text": clue.get("localized_text") if is_discovered else None,
        "secret": not is_discovered,
    }
    if not is_discovered:
        view["keeper_only"] = {
            "secret": True,
            "content_available_after": "state.record_clue",
        }
    return view

def _flags_set(ctx: Ctx) -> set[str]:
    flags = ctx.flags().get("flags") or {}
    return {str(k) for k, v in flags.items() if v}

def _clock_reached(ctx: Ctx) -> Callable[[str | None, int], bool]:
    threat_path = ctx.campaign_dir / "save" / "threat-state.json"
    clocks: dict[str, Any] = {}
    if threat_path.is_file():
        try:
            clocks = (json.loads(threat_path.read_text(encoding="utf-8")) or {}).get("clocks") or {}
        except (json.JSONDecodeError, OSError):
            clocks = {}

    def reached(clock_id: str | None, threshold: int) -> bool:
        if not clock_id:
            return False
        clock = clocks.get(str(clock_id))
        if not isinstance(clock, dict):
            return False
        return int(clock.get("current_segments", 0)) >= int(threshold)

    return reached

def _authored_unlock_world(
    ctx: Ctx,
    world: dict[str, Any],
    *,
    clue_records: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Player world projected through authored-milestone provenance rules.

    Improvised facts remain in the real world and reports.  Only the copy used
    by authored graph predicates excludes local-only facts, including on later
    reevaluation after another clue is discovered.
    """
    projected = deepcopy(world)
    if clue_records is None:
        flags = ctx.flags()
        found = flags.get("clues_found")
        clue_records = found if isinstance(found, dict) else {}
    eligible = coc_scene_graph.authored_discovered_clue_ids(
        ctx.clue_graph,
        world.get("discovered_clue_ids"),
        clue_records,
    )
    projected["discovered_clue_ids"] = [
        str(raw)
        for raw in world.get("discovered_clue_ids") or []
        if str(raw) in eligible
    ]
    return projected

def _evaluate_and_apply_unlocks(
    ctx: Ctx,
    world: dict[str, Any],
    *,
    clue_records: dict[str, Any] | None = None,
) -> list[str]:
    unlock_world = _authored_unlock_world(
        ctx, world, clue_records=clue_records
    )
    newly = coc_scene_graph.evaluate_unlocks(
        ctx.story_graph,
        unlock_world,
        clock_reached=_clock_reached(ctx),
        flags_set=_flags_set(ctx),
    )
    return coc_scene_graph.apply_unlocks_to_world(world, newly)

def _resolve_investigator(ctx: Ctx, args: dict[str, Any]) -> str:
    inv = args.get("investigator")
    if not inv:
        party = ctx.party_ids()
        if len(party) == 1:
            return party[0]
        raise ToolError("missing_param", "required parameter: investigator (party has %d members)" % len(party))
    return str(inv)

def _read_object(path: Path) -> dict[str, Any]:
    if not path.is_file():
        return {}
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        return {}
    return value if isinstance(value, dict) else {}

def _read_jsonl_records(path: Path) -> list[dict[str, Any]]:
    if not path.is_file():
        return []
    records: list[dict[str, Any]] = []
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except (OSError, UnicodeError):
        return []
    for line in lines:
        try:
            value = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict):
            records.append(value)
    return records

def _npc_receipt_path(ctx: Ctx) -> Path:
    return ctx.campaign_dir / "save" / coc_npc_event_chain.RECEIPT_FILENAME

def _npc_receipts_for_decision(
    document: dict[str, Any], *, producer: str, decision_id: str
) -> list[dict[str, Any]]:
    receipts = document.get("receipts")
    if not isinstance(receipts, dict):
        raise ToolError("state_corrupt", "NPC engagement receipt map is invalid")
    found = [
        receipt
        for receipt in receipts.values()
        if isinstance(receipt, dict)
        and receipt.get("producer") == producer
        and receipt.get("decision_id") == decision_id
    ]
    if any(not coc_npc_event_chain.valid_receipt(receipt) for receipt in found):
        raise ToolError("state_corrupt", "NPC engagement source receipt is invalid")
    return sorted(found, key=lambda receipt: int(receipt["ordinal"]))

def _npc_receipt_warnings(receipt: dict[str, Any]) -> list[str]:
    """Rebuild the original advisory warnings from immutable receipt data."""
    event = receipt.get("event") or {}
    operation = receipt.get("operation") or {}
    npc_id = str(event.get("npc_id") or "")
    requested_npc_id = str(operation.get("npc_id") or "")
    identity_contract = event.get("identity_contract")
    identity_binding = event.get("identity_binding") or {}
    binding_status = str(identity_binding.get("status") or "")
    binding_reasons = list(identity_binding.get("reasons") or [])
    warnings: list[str] = []
    if not isinstance(identity_contract, dict):
        warnings.append(
            f"npc '{npc_id}' is not in the authored agendas — recorded as an improvised NPC"
        )
    elif binding_status == "unverified":
        warnings.append(
            f"authored npc '{npc_id}' engagement was recorded, but identity_ref is missing; it is not authored-NPC coverage"
        )
    elif binding_status == "mismatch" and "identity_ref_mismatch" in binding_reasons:
        warnings.append(
            f"supplied identity_ref does not match authored npc '{npc_id}'; engagement was recorded without authored-NPC coverage"
        )
    elif binding_status == "mismatch":
        warnings.append(
            f"authored npc '{npc_id}' is outside its structured scene schedule; engagement was recorded without authored-NPC coverage"
        )
    if requested_npc_id and requested_npc_id != npc_id:
        warnings.append(
            f"resolved NPC alias '{requested_npc_id}' to authored id '{npc_id}'"
        )
    requested_kind = str(operation.get("interaction_kind") or "")
    if event.get("interaction_label") is not None:
        warnings.append(
            f"unrecognized interaction_kind '{requested_kind}' was preserved as interaction_label and normalized to 'other'"
        )
    return warnings

def _materialize_stable_receipt_event(
    ctx: Ctx,
    *,
    event: dict[str, Any],
    event_id: str,
    relative_path: str = "logs/events.jsonl",
    inspect_pending: bool = True,
) -> bool:
    """Materialize a receipt-owned stable row in the recorder lock domain."""
    try:
        with coc_async_recorder.recorder_lock(ctx.campaign_dir):
            if inspect_pending:
                pending = _pending_jsonl_rows(ctx, relative_path, event_id)
            else:
                pending = []
            if any(row != event for row in pending) or len(pending) > 1:
                raise ToolError(
                    "state_corrupt",
                    f"pending stable event '{event_id}' conflicts with its source receipt",
                )
            target = ctx.campaign_dir / relative_path
            append_record = None
            if relative_path == "logs/events.jsonl":
                append_record = lambda _path, row: ctx.log_event(deepcopy(row))
            return coc_async_recorder.ensure_stable_jsonl_record_locked(
                target,
                deepcopy(event),
                append_record=append_record,
            )
    except coc_async_recorder.RecorderLockError as exc:
        raise ToolError("campaign_busy", str(exc)) from exc
    except coc_async_recorder.StableRecordError as exc:
        raise ToolError("state_corrupt", str(exc)) from exc

def _ensure_npc_receipt_event(ctx: Ctx, receipt: dict[str, Any]) -> bool:
    if not coc_npc_event_chain.valid_receipt(receipt):
        raise ToolError("state_corrupt", "NPC engagement source receipt is invalid")
    return _materialize_stable_receipt_event(
        ctx,
        event=receipt["event"],
        event_id=str(receipt["event_id"]),
    )

def _reconcile_all_npc_source_receipts(ctx: Ctx) -> dict[str, Any]:
    try:
        document = coc_npc_event_chain.load_receipt_document(ctx.campaign_dir)
    except ValueError as exc:
        raise ToolError("state_corrupt", str(exc)) from exc
    receipts = document.get("receipts") or {}
    ordered = sorted(
        receipts.values(),
        key=lambda receipt: (
            str(receipt.get("run_id") or ""),
            str(receipt.get("decision_id") or ""),
            int(receipt.get("ordinal") or 0),
            str(receipt.get("event_id") or ""),
        ),
    )
    for receipt in ordered:
        if not coc_npc_event_chain.valid_receipt(receipt):
            raise ToolError("state_corrupt", "NPC engagement source receipt is invalid")
        _ensure_npc_receipt_event(ctx, receipt)
        if receipt.get("producer") == "director_apply.npc_move":
            secondary = (
                "logs/npc-engagement.jsonl"
                if receipt.get("event_type") == "npc_engagement"
                else "logs/npc-agency.jsonl"
            )
            _materialize_stable_receipt_event(
                ctx,
                event=receipt["event"],
                event_id=str(receipt["event_id"]),
                relative_path=secondary,
            )
        if receipt.get("producer") == "state.record_npc_engagement":
            decision_id = str(receipt["decision_id"])
            route_completion = (receipt.get("operation") or {}).get(
                "route_completion"
            )
            _settle_engagement_route_completion(
                ctx,
                route_completion,
                decision_id=decision_id,
                evidence_ref=(
                    f"logs/events.jsonl#{receipt['event_id']}"
                ),
            )
            data = deepcopy(receipt["event"])
            prior = ctx.ledger_lookup("state.record_npc_engagement", decision_id)
            if prior is None or prior.get("data") != data:
                ctx.ledger_record(
                    decision_id, "state.record_npc_engagement", data
                )
    return document

_SOURCE_RECEIPTS_KEY = "operation_receipts"

_SOURCE_RECEIPT_SCHEMA_VERSION = 3

_SOURCE_RECEIPT_INTEGRITY_KEY = "integrity_digest"

_SOURCE_RECEIPT_FIELDS = frozenset({
    "schema_version",
    "tool",
    "decision_id",
    "fingerprint",
    "operation",
    "event_id",
    "event",
    "data",
    "warnings",
    "hints",
    "entity_head",
    _SOURCE_RECEIPT_INTEGRITY_KEY,
})

_NPC_PRESENCE_SCHEMA_VERSION = 1

_NPC_PRESENCE_RECORD_FIELDS = frozenset({
    "schema_version",
    "npc_id",
    "scene_id",
    "status",
    "reason",
    "revision",
    "changed_at",
    "decision_id",
    "source_sequence",
    "producer",
})

def _operation_fingerprint(tool_name: str, operation: dict[str, Any]) -> str:
    encoded = json.dumps(
        {"tool": str(tool_name), "operation": operation},
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        default=str,
    ).encode("utf-8")
    return f"sha256:{hashlib.sha256(encoded).hexdigest()}"

def _canonical_digest(value: Any) -> str:
    encoded = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        default=str,
    ).encode("utf-8")
    return f"sha256:{hashlib.sha256(encoded).hexdigest()}"

def _source_receipt_integrity(receipt: dict[str, Any]) -> str:
    """Bind every immutable receipt field except the digest itself."""
    body = {
        key: deepcopy(value)
        for key, value in receipt.items()
        if key != _SOURCE_RECEIPT_INTEGRITY_KEY
    }
    return _canonical_digest(body)

def _source_receipt_manifest(receipt: dict[str, Any]) -> dict[str, Any]:
    """Bind one current source receipt into its idempotency ledger entry."""
    return {
        "schema_version": 1,
        "receipt_schema_version": receipt.get("schema_version"),
        "tool": receipt.get("tool"),
        "decision_id": receipt.get("decision_id"),
        "integrity_digest": receipt.get(_SOURCE_RECEIPT_INTEGRITY_KEY),
    }

_ROLL_RECEIPT_TOOLS = frozenset({
    "rules.roll", "rules.push", "rules.roll_dice", "rules.check",
})

_ROLL_RECEIPT_SCHEMA_VERSION = 5

_ROLL_RECEIPT_DOCUMENT_SCHEMA_VERSION = 6

_ROLL_RECEIPT_DOCUMENT_FIELDS = frozenset({
    "schema_version", "receipts", "pending_side_effects", "luck_spends"
})

_ROLL_RECEIPT_FIELDS = frozenset({
    "schema_version",
    "tool",
    "decision_id",
    "fingerprint",
    "operation",
    "resolution",
    "roll_id",
    "roll_record",
    "data",
    "warnings",
    "hints",
    "log_prefix_size",
    "log_prefix_sha256",
    _SOURCE_RECEIPT_INTEGRITY_KEY,
})

_PERCENTILE_INVOCATION_FIELDS = frozenset({
    "investigator", "skill", "characteristic", "explicit_target",
    "required_level", "bonus", "penalty", "goal", "stakes",
    "difficulty_basis", "reason", "fumble_consequence", "pushed",
    "method_changed", "failure_consequence", "original_check_decision_id",
    "npc_id", "visibility", "social_adjudication_ref",
})

_COMBINED_PERCENTILE_INVOCATION_FIELDS = frozenset({
    *_PERCENTILE_INVOCATION_FIELDS,
    "combined_targets", "combined_mode",
})

_COMBINED_TARGET_FIELDS = frozenset({"label", "value"})

_LEGACY_PERCENTILE_INVOCATION_FIELD_SETS = (
    frozenset(_PERCENTILE_INVOCATION_FIELDS - {"social_adjudication_ref"}),
    frozenset(_PERCENTILE_INVOCATION_FIELDS - {"npc_id"}),
    frozenset(_PERCENTILE_INVOCATION_FIELDS - {"visibility"}),
    frozenset(_PERCENTILE_INVOCATION_FIELDS - {"npc_id", "visibility"}),
    frozenset(_PERCENTILE_INVOCATION_FIELDS - {"social_adjudication_ref", "npc_id"}),
    frozenset(_PERCENTILE_INVOCATION_FIELDS - {"social_adjudication_ref", "visibility"}),
    frozenset(_PERCENTILE_INVOCATION_FIELDS - {"social_adjudication_ref", "npc_id", "visibility"}),
)

_PERCENTILE_RESOLUTION_FIELDS = frozenset({
    "investigator_id", "resolved_label", "resolved_target", "target_source",
    "original_check_ref",
})

_DIFFICULTY_BASIS_VALUES = frozenset({
    "authored_gate", "opponent_skill", "environment", "keeper_judgment",
})

_PUSH_INHERITED_ARGUMENTS = frozenset({
    "investigator", "skill", "characteristic", "target", "difficulty",
    "bonus", "penalty", "goal", "stakes", "difficulty_basis", "reason",
    "npc_id", "visibility", "social_adjudication_ref",
})

_PUSH_INHERITED_OPERATION_FIELDS = frozenset({
    "investigator", "skill", "characteristic", "explicit_target",
    "required_level", "bonus", "penalty", "goal", "stakes",
    "difficulty_basis", "reason", "npc_id", "visibility", "social_adjudication_ref",
})

_DICE_RESOLUTION_FIELDS = frozenset({
    "expression", "count", "sides", "modifier"
})

_CHARGEN_DICE_PURPOSES = frozenset({
    "investigator_creation_luck",
    "investigator_creation_characteristic",
})

_LUCK_SPEND_RECEIPT_SCHEMA_VERSION = 1

_LUCK_SPEND_RECEIPT_FIELDS = frozenset({
    "schema_version",
    "tool",
    "decision_id",
    "fingerprint",
    "operation",
    "source_receipt",
    "data",
    "event",
    _SOURCE_RECEIPT_INTEGRITY_KEY,
})

_LUCK_SPEND_OPERATION_FIELDS = frozenset({
    "investigator_id", "source_roll_id", "points"
})

def _roll_receipt_path(ctx: Ctx) -> Path:
    return ctx.campaign_dir / "save" / "roll-operation-receipts.json"

def _load_roll_receipt_document(ctx: Ctx) -> dict[str, Any]:
    path = _roll_receipt_path(ctx)
    if not path.is_file():
        return {
            "schema_version": _ROLL_RECEIPT_DOCUMENT_SCHEMA_VERSION,
            "receipts": {},
            "pending_side_effects": {},
            "luck_spends": {},
        }
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise ToolError(
            "state_corrupt", "save/roll-operation-receipts.json is unreadable"
        ) from exc
    if (
        not isinstance(document, dict)
        or set(document) != set(_ROLL_RECEIPT_DOCUMENT_FIELDS)
        or document.get("schema_version") != _ROLL_RECEIPT_DOCUMENT_SCHEMA_VERSION
        or not isinstance(document.get("receipts"), dict)
        or not isinstance(document.get("pending_side_effects"), dict)
        or not isinstance(document.get("luck_spends"), dict)
    ):
        raise ToolError(
            "state_corrupt",
            "save/roll-operation-receipts.json does not match the current schema",
        )
    _validated_roll_document_collection(document)
    return document

def _save_roll_receipt_document(ctx: Ctx, document: dict[str, Any]) -> None:
    coc_state.write_json_atomic(_roll_receipt_path(ctx), document)

def _roll_receipt(
    document: dict[str, Any], tool_name: str, decision_id: str
) -> dict[str, Any] | None:
    receipts = document.get("receipts")
    if not isinstance(receipts, dict):
        raise ToolError("state_corrupt", "canonical roll receipt map is invalid")
    by_tool = receipts.get(str(tool_name))
    if by_tool is None:
        return None
    if not isinstance(by_tool, dict):
        raise ToolError(
            "state_corrupt", f"canonical roll receipts for {tool_name} are invalid"
        )
    receipt = by_tool.get(str(decision_id))
    if receipt is None:
        return None
    if not isinstance(receipt, dict):
        raise ToolError("state_corrupt", "canonical roll receipt is not an object")
    return receipt

def _put_roll_receipt(
    document: dict[str, Any], receipt: dict[str, Any]
) -> None:
    receipts = document.setdefault("receipts", {})
    if not isinstance(receipts, dict):
        raise ToolError("state_corrupt", "canonical roll receipt map is invalid")
    tool_name = str(receipt["tool"])
    by_tool = receipts.setdefault(tool_name, {})
    if not isinstance(by_tool, dict):
        raise ToolError(
            "state_corrupt", f"canonical roll receipts for {tool_name} are invalid"
        )
    by_tool[str(receipt["decision_id"])] = deepcopy(receipt)

def _roll_side_effect_key(receipt: dict[str, Any]) -> str:
    return f"{receipt['tool']}\u0000{receipt['decision_id']}"

def _roll_receipt_needs_side_effect(receipt: dict[str, Any]) -> bool:
    if receipt.get("tool") != "rules.roll":
        return False
    data = receipt.get("data") or {}
    operation = receipt.get("operation") or {}
    if operation.get("combined_targets") is not None:
        # Combined-roll participants never earn development ticks (p.94).
        return False
    skill = str(data.get("skill") or "")
    return bool(
        data.get("outcome") in {"regular", "hard", "extreme", "critical"}
        and operation.get("skill") not in (None, "")
        and skill
        and skill not in _CHARACTERISTIC_NAMES
        and skill not in {"SAN", "LUCK"}
    )

def _queue_roll_side_effect(
    document: dict[str, Any], receipt: dict[str, Any]
) -> None:
    if not _roll_receipt_needs_side_effect(receipt):
        return
    pending = document.get("pending_side_effects")
    if not isinstance(pending, dict):
        raise ToolError("state_corrupt", "canonical roll pending index is invalid")
    pending[_roll_side_effect_key(receipt)] = str(receipt["roll_id"])

def _new_roll_receipt(
    *,
    tool_name: str,
    decision_id: str,
    operation: dict[str, Any],
    resolution: dict[str, Any],
    roll_record: dict[str, Any],
    data: dict[str, Any],
    warnings: list[str],
    hints: list[str],
) -> dict[str, Any]:
    receipt = {
        "schema_version": _ROLL_RECEIPT_SCHEMA_VERSION,
        "tool": str(tool_name),
        "decision_id": str(decision_id),
        "fingerprint": _operation_fingerprint(tool_name, operation),
        "operation": deepcopy(operation),
        "resolution": deepcopy(resolution),
        "roll_id": str(roll_record.get("roll_id") or ""),
        "roll_record": deepcopy(roll_record),
        "data": deepcopy(data),
        "warnings": list(warnings),
        "hints": list(hints),
        "log_prefix_size": 0,
        "log_prefix_sha256": f"sha256:{hashlib.sha256(b'').hexdigest()}",
    }
    receipt[_SOURCE_RECEIPT_INTEGRITY_KEY] = _source_receipt_integrity(receipt)
    return receipt

def _is_exact_int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)

def _luck_source_reference(receipt: dict[str, Any]) -> dict[str, Any]:
    return {
        "tool": str(receipt["tool"]),
        "decision_id": str(receipt["decision_id"]),
        "roll_id": str(receipt["roll_id"]),
        "integrity_digest": str(receipt[_SOURCE_RECEIPT_INTEGRITY_KEY]),
    }

def _luck_spend_data(
    source_receipt: dict[str, Any],
    *,
    points: int,
    luck_before: int,
    resolver: Any | None = None,
) -> dict[str, Any]:
    source_data = deepcopy(source_receipt["data"])
    skill = str(source_data.get("skill") or "")
    roll_kind = "luck" if skill == "LUCK" else "sanity" if skill == "SAN" else "skill"
    if resolver is None:
        # Receipt re-validation has no campaign in scope; canonical receipts do
        # not record a ruleset_id, so the default ruleset re-derives the same
        # arithmetic the settle path computed.
        resolver = coc_rulesets.get_resolver(None)
    adjusted = resolver.luck_spend(
        source_data,
        points,
        luck_before,
        roll_kind=roll_kind,
    )
    adjusted.update({
        "original_roll": int(source_data["roll"]),
        "adjusted_roll": int(adjusted["roll"]),
        "luck_before": luck_before,
        "luck_after": int(adjusted["luck_remaining"]),
        "source_roll_id": str(source_receipt["roll_id"]),
        "source_receipt": _luck_source_reference(source_receipt),
    })
    return adjusted

def _validate_luck_spend_receipts(document: dict[str, Any]) -> None:
    luck_receipts = document.get("luck_spends")
    roll_receipts = document.get("receipts")
    if not isinstance(luck_receipts, dict) or not isinstance(roll_receipts, dict):
        raise ToolError("state_corrupt", "canonical Luck receipt collection is invalid")
    source_owners: dict[str, str] = {}
    for decision_id, receipt in sorted(luck_receipts.items()):
        if not isinstance(receipt, dict):
            raise ToolError("state_corrupt", "canonical Luck receipt is invalid")
        operation = receipt.get("operation")
        source_ref = receipt.get("source_receipt")
        data = receipt.get("data")
        event = receipt.get("event")
        source_decision_id = (
            str(source_ref.get("decision_id") or "")
            if isinstance(source_ref, dict)
            else ""
        )
        source = (roll_receipts.get("rules.roll") or {}).get(source_decision_id)
        invalid = bool(
            set(receipt) != set(_LUCK_SPEND_RECEIPT_FIELDS)
            or receipt.get("schema_version") != _LUCK_SPEND_RECEIPT_SCHEMA_VERSION
            or receipt.get("tool") != "rules.luck_spend"
            or str(receipt.get("decision_id") or "") != str(decision_id)
            or not isinstance(operation, dict)
            or set(operation) != set(_LUCK_SPEND_OPERATION_FIELDS)
            or receipt.get("fingerprint")
            != _operation_fingerprint("rules.luck_spend", operation or {})
            or not isinstance(source_ref, dict)
            or set(source_ref)
            != {"tool", "decision_id", "roll_id", "integrity_digest"}
            or source_ref.get("tool") != "rules.roll"
            or not isinstance(source, dict)
            or source_ref != _luck_source_reference(source or {})
            or not isinstance(data, dict)
            or not isinstance(event, dict)
            or receipt.get(_SOURCE_RECEIPT_INTEGRITY_KEY)
            != _source_receipt_integrity(receipt)
            or not isinstance(operation.get("investigator_id"), str)
            or not operation.get("investigator_id")
            or not isinstance(operation.get("source_roll_id"), str)
            or operation.get("source_roll_id") != source_ref.get("roll_id")
            or not _is_exact_int(operation.get("points"))
            or int(operation.get("points") or 0) <= 0
            or data.get("investigator_id") != operation.get("investigator_id")
            or not _is_exact_int(data.get("luck_before"))
            or data.get("source_receipt") != source_ref
            or data.get("source_roll_id") != source_ref.get("roll_id")
            or event
            != {
                "event_id": _operation_event_id(
                    "rules.luck_spend", str(decision_id)
                ),
                "event_type": "luck_spent",
                **(deepcopy(data) if isinstance(data, dict) else {}),
            }
        )
        if not invalid:
            try:
                expected = _luck_spend_data(
                    source,
                    points=int(operation["points"]),
                    luck_before=int(data["luck_before"]),
                )
            except (KeyError, TypeError, ValueError):
                invalid = True
            else:
                invalid = expected != data
        if invalid:
            raise ToolError(
                "state_corrupt",
                f"Luck source receipt decision_id '{decision_id}' is invalid",
            )
        source_roll_id = str(source_ref["roll_id"])
        prior = source_owners.get(source_roll_id)
        if prior is not None and prior != str(decision_id):
            raise ToolError(
                "state_corrupt",
                f"source roll_id '{source_roll_id}' has multiple Luck adjustments",
            )
        source_owners[source_roll_id] = str(decision_id)

def _optional_scalar_evidence_matches(
    field: str,
    value: str | None,
    *containers: dict[str, Any],
) -> bool:
    """Match the exact optional-field emission used by the roll tools."""
    if value:
        return all(
            field in container and container[field] == value
            for container in containers
        )
    return all(field not in container for container in containers)

def _optional_consequence_evidence_matches(
    field: str,
    value: str | None,
    *containers: dict[str, Any],
) -> bool:
    if value:
        return all(
            field in container
            and container[field] == {"summary": value}
            for container in containers
        )
    return all(field not in container for container in containers)

def _dice_evidence_is_consistent(
    operation: dict[str, Any],
    resolution: dict[str, Any],
    data: dict[str, Any],
    record: dict[str, Any],
    payload: dict[str, Any],
) -> bool:
    expression = resolution.get("expression")
    match = (
        coc_roll.ROLL_PATTERN.fullmatch(expression)
        if isinstance(expression, str)
        else None
    )
    if match is None:
        return False
    parsed_count = int(match.group("count"))
    parsed_sides = int(match.group("sides"))
    parsed_modifier = int(match.group("modifier") or 0)
    count = resolution.get("count")
    sides = resolution.get("sides")
    modifier = resolution.get("modifier")
    rolls = data.get("rolls")
    total = data.get("total")
    reason = operation.get("reason")
    purpose = operation.get("purpose")
    operation_fields = set(operation)
    return bool(
        operation_fields in (
            {"expression", "reason"},
            {"expression", "reason", "purpose"},
        )
        and (reason is None or isinstance(reason, str))
        and (
            purpose is None
            or purpose in _CHARGEN_DICE_PURPOSES
        )
        and set(resolution) == set(_DICE_RESOLUTION_FIELDS)
        and _is_exact_int(count)
        and _is_exact_int(sides)
        and _is_exact_int(modifier)
        and count == parsed_count
        and sides == parsed_sides
        and modifier == parsed_modifier
        and count > 0
        and sides > 0
        and isinstance(rolls, list)
        and len(rolls) == count
        and all(_is_exact_int(face) and 1 <= face <= sides for face in rolls)
        and _is_exact_int(total)
        and total == sum(rolls) + modifier
        and operation.get("expression") == expression
        and all(resolution.get(key) == data.get(key) for key in _DICE_RESOLUTION_FIELDS)
        and all(resolution.get(key) == record.get(key) for key in _DICE_RESOLUTION_FIELDS)
        and all(resolution.get(key) == payload.get(key) for key in _DICE_RESOLUTION_FIELDS)
        and record.get("rolls") == rolls
        and payload.get("rolls") == rolls
        and record.get("total") == total
        and payload.get("total") == total
        and payload.get("die_expression") == expression
        and payload.get("individual_faces") == rolls
        and payload.get("final_total") == total
        and payload.get("roll") == total
        and _optional_scalar_evidence_matches(
            "reason", reason, data, record, payload
        )
        and _optional_scalar_evidence_matches(
            "purpose", purpose, data, record, payload
        )
    )

def _combined_roll_evidence_is_consistent(
    operation: dict[str, Any],
    resolution: dict[str, Any],
    data: dict[str, Any],
    record: dict[str, Any],
    payload: dict[str, Any],
) -> bool:
    targets = operation.get("combined_targets")
    comparison_mode = operation.get("combined_mode")
    roll = data.get("roll")
    required_level = operation.get("required_level")
    rule = coc_rules.combined_roll_rule()
    minimum = int(rule["minimum_compared_targets"])
    if (
        set(operation) != set(_COMBINED_PERCENTILE_INVOCATION_FIELDS)
        or not isinstance(targets, list)
        or len(targets) < minimum
        or len(targets) > 8
        or comparison_mode not in {"any", "all"}
        or operation.get("bonus") != 0
        or operation.get("penalty") != 0
        or operation.get("visibility") != "public"
        or operation.get("skill") is not None
        or operation.get("characteristic") is not None
        or operation.get("npc_id") is not None
        or operation.get("social_adjudication_ref") is not None
        or not _is_exact_int(roll)
        or required_level not in {"regular", "hard", "extreme"}
    ):
        return False
    try:
        normalized = _normalize_combined_targets(targets)
    except ToolError:
        return False
    if normalized != targets:
        return False
    highest = max(row["value"] for row in normalized)
    label = _combined_roll_label(normalized)
    if (
        operation.get("explicit_target") != highest
        or resolution.get("resolved_target") != highest
        or resolution.get("resolved_label") != label
        or resolution.get("target_source") != "combined_targets"
        or resolution.get("original_check_ref") is not None
    ):
        return False
    combined = _combined_roll_projection(
        normalized,
        roll=roll,
        required_level=str(required_level),
        comparison_mode=str(comparison_mode),
    )
    projection = coc_roll.build_player_projection(
        data,
        include_target=True,
        extra={
            "roll_id": data.get("roll_id"),
            "combined_roll": combined,
            "improvement_tick_eligible": False,
        },
    )
    return bool(
        data.get("kind") == "combined_skill_check"
        and record.get("kind") == "combined_skill_check"
        and payload.get("kind") == "combined_skill_check"
        and data.get("combined_roll") == combined
        and record.get("combined_roll") == combined
        and payload.get("combined_roll") == combined
        and data.get("improvement_tick_eligible") is False
        and record.get("improvement_tick_eligible") is False
        and payload.get("improvement_tick_eligible") is False
        and data.get("player_projection") == projection
        and record.get("player_projection") == projection
        and payload.get("player_projection") == projection
        and combined["overall_success"] is data.get("success")
    )

def _validate_roll_resolution_consistency(receipt: dict[str, Any]) -> None:
    tool_name = str(receipt["tool"])
    operation = receipt["operation"]
    resolution = receipt["resolution"]
    data = receipt["data"]
    record = receipt["roll_record"]
    payload = record["payload"]
    invalid = False
    if tool_name == "rules.roll_dice":
        invalid = not _dice_evidence_is_consistent(
            operation, resolution, data, record, payload
        )
    else:
        is_combined = operation.get("combined_targets") is not None
        selector_skill = operation.get("skill")
        selector_characteristic = operation.get("characteristic")
        explicit_target = operation.get("explicit_target")
        investigator = operation.get("investigator")
        required_level = operation.get("required_level")
        bonus = operation.get("bonus")
        penalty = operation.get("penalty")
        goal = operation.get("goal")
        stakes = operation.get("stakes")
        difficulty_basis = operation.get("difficulty_basis")
        reason = operation.get("reason")
        target_npc_id = operation.get("npc_id")
        social_adjudication_ref = operation.get("social_adjudication_ref")
        fumble_consequence = operation.get("fumble_consequence")
        pushed = operation.get("pushed")
        method_changed = operation.get("method_changed")
        failure_consequence = operation.get("failure_consequence")
        original_check_decision_id = operation.get(
            "original_check_decision_id"
        )
        original_check_ref = resolution.get("original_check_ref")
        label = resolution.get("resolved_label")
        target_source = resolution.get("target_source")
        expected_bonus = (
            max(0, bonus - penalty)
            if _is_exact_int(bonus) and _is_exact_int(penalty)
            else None
        )
        expected_penalty = (
            max(0, penalty - bonus)
            if _is_exact_int(bonus) and _is_exact_int(penalty)
            else None
        )
        expected_result: dict[str, Any] | None = None
        if (
            _is_exact_int(resolution.get("resolved_target"))
            and _is_exact_int(data.get("roll"))
            and required_level in {"regular", "hard", "extreme"}
        ):
            try:
                expected_result = coc_roll.resolve_percentile_roll(
                    int(data["roll"]),
                    int(resolution["resolved_target"]),
                    str(required_level),
                )
            except (KeyError, TypeError, ValueError):
                expected_result = None
        valid_stakes = bool(
            isinstance(stakes, dict)
            and set(stakes) == {"on_success", "on_failure"}
            and all(
                isinstance(stakes.get(key), str)
                and bool(stakes[key].strip())
                and stakes[key] == stakes[key].strip()
                for key in ("on_success", "on_failure")
            )
        )
        valid_original_ref = bool(
            isinstance(original_check_ref, dict)
            and set(original_check_ref)
            == {"tool", "decision_id", "roll_id", "integrity_digest"}
            and original_check_ref.get("tool") == "rules.roll"
            and isinstance(original_check_ref.get("decision_id"), str)
            and bool(original_check_ref.get("decision_id"))
            and isinstance(original_check_ref.get("roll_id"), str)
            and bool(original_check_ref.get("roll_id"))
            and re.fullmatch(
                r"sha256:[0-9a-f]{64}",
                str(original_check_ref.get("integrity_digest") or ""),
            )
        )
        invalid = bool(
            frozenset(operation) not in {
                _PERCENTILE_INVOCATION_FIELDS,
                _COMBINED_PERCENTILE_INVOCATION_FIELDS,
                *_LEGACY_PERCENTILE_INVOCATION_FIELD_SETS,
            }
            or set(resolution) != set(_PERCENTILE_RESOLUTION_FIELDS)
            or not (
                investigator is None
                or (isinstance(investigator, str) and bool(investigator))
            )
            or not (
                selector_skill is None
                or (
                    isinstance(selector_skill, str)
                    and bool(selector_skill)
                    and selector_skill == selector_skill.strip()
                )
            )
            or not (
                selector_characteristic is None
                or (
                    isinstance(selector_characteristic, str)
                    and bool(selector_characteristic)
                    and selector_characteristic
                    == selector_characteristic.strip().upper()
                )
            )
            or not (explicit_target is None or _is_exact_int(explicit_target))
            or required_level not in {"regular", "hard", "extreme"}
            or not _is_exact_int(bonus)
            or not 0 <= bonus <= 2
            or not _is_exact_int(penalty)
            or not 0 <= penalty <= 2
            or not isinstance(goal, str)
            or not goal.strip()
            or goal != goal.strip()
            or not valid_stakes
            or difficulty_basis not in _DIFFICULTY_BASIS_VALUES
            or not (
                reason is None
                or (
                    isinstance(reason, str)
                    and bool(reason)
                    and reason == reason.strip()
                )
            )
            or not (
                target_npc_id is None
                or (
                    isinstance(target_npc_id, str)
                    and bool(target_npc_id)
                    and target_npc_id == target_npc_id.strip()
                )
            )
            or not (
                social_adjudication_ref is None
                or (
                    isinstance(social_adjudication_ref, str)
                    and bool(social_adjudication_ref)
                    and social_adjudication_ref == social_adjudication_ref.strip()
                )
            )
            or not (
                fumble_consequence is None
                or (
                    isinstance(fumble_consequence, str)
                    and bool(fumble_consequence)
                    and fumble_consequence == fumble_consequence.strip()
                )
            )
            or not isinstance(pushed, bool)
            or not isinstance(resolution.get("investigator_id"), str)
            or not resolution.get("investigator_id")
            or not isinstance(label, str)
            or not label
            or not _is_exact_int(resolution.get("resolved_target"))
            or expected_result is None
            or target_source not in {
                "explicit", "state", "sheet", "rulebook_base", "combined_targets"
            }
            or resolution.get("investigator_id") != data.get("investigator_id")
            or resolution.get("investigator_id") != record.get("actor")
            or resolution.get("investigator_id") != payload.get("investigator_id")
            or label != data.get("skill")
            or label != record.get("skill")
            or label != payload.get("skill")
            or any(
                data.get(key) != value
                for key, value in (expected_result or {}).items()
                if not (
                    is_combined
                    and key in {"success", "outcome", "achieved_level"}
                )
            )
            or resolution.get("resolved_target") != data.get("target")
            or resolution.get("resolved_target") != record.get("target")
            or resolution.get("resolved_target") != payload.get("target")
            or target_source != data.get("target_source")
            or target_source != record.get("target_source")
            or target_source != payload.get("target_source")
            or (
                investigator is not None
                and investigator != resolution.get("investigator_id")
            )
            or (
                explicit_target is not None
                and explicit_target != resolution.get("resolved_target")
            )
            or (
                explicit_target is not None
                and not is_combined
                and target_source != "explicit"
            )
            or (
                explicit_target is None
                and target_source in {"explicit", "combined_targets"}
            )
            or (
                selector_skill is not None
                and selector_skill.casefold() != label.casefold()
            )
            or (
                selector_characteristic is not None
                and selector_characteristic.casefold() != label.casefold()
            )
            or pushed != (tool_name == "rules.push")
            or any(
                container.get("required_level") != required_level
                for container in (data, record, payload)
            )
            or any(
                container.get("difficulty") != required_level
                for container in (data, record, payload)
            )
            or any(
                container.get("goal") != goal
                for container in (data, record, payload)
            )
            or any(
                container.get("stakes") != stakes
                for container in (data, record, payload)
            )
            or any(
                container.get("difficulty_basis") != difficulty_basis
                for container in (data, record, payload)
            )
            or any(
                container.get("bonus") != expected_bonus
                for container in (data, record, payload)
            )
            or any(
                container.get("penalty") != expected_penalty
                for container in (data, record, payload)
            )
            or any(
                container.get("pushed") != pushed
                for container in (data, record, payload)
            )
            or not _optional_scalar_evidence_matches(
                "reason", reason, data, record, payload
            )
            or not _optional_scalar_evidence_matches(
                "npc_id", target_npc_id, data, record, payload
            )
            or not _optional_scalar_evidence_matches(
                "social_adjudication_ref", social_adjudication_ref, data, record, payload
            )
            or not _optional_scalar_evidence_matches(
                "social_goal_key", social_adjudication_ref, data, record, payload
            )
            or (
                social_adjudication_ref is not None
                and (
                    not isinstance(data.get("outcome_ceiling"), dict)
                    or any(
                        container.get("outcome_ceiling") != data.get("outcome_ceiling")
                        for container in (record, payload)
                    )
                )
            )
            or not _optional_consequence_evidence_matches(
                "fumble_consequence",
                fumble_consequence,
                data,
                record,
                payload,
            )
            or (
                pushed
                and (
                    not isinstance(method_changed, str)
                    or not method_changed
                    or method_changed != method_changed.strip()
                    or not isinstance(failure_consequence, str)
                    or not failure_consequence
                    or failure_consequence != failure_consequence.strip()
                    or not _optional_scalar_evidence_matches(
                        "method_changed", method_changed, data, record, payload
                    )
                    or not _optional_consequence_evidence_matches(
                        "failure_consequence",
                        failure_consequence,
                        data,
                        record,
                        payload,
                    )
                    or not _optional_consequence_evidence_matches(
                        "announced_consequence",
                        failure_consequence,
                        data,
                        record,
                        payload,
                    )
                    or not isinstance(original_check_decision_id, str)
                    or not original_check_decision_id
                    or not valid_original_ref
                    or original_check_ref.get("decision_id")
                    != original_check_decision_id
                    or any(
                        container.get("original_check") != original_check_ref
                        for container in (data, record, payload)
                    )
                )
            )
            or (
                not pushed
                and (
                    method_changed is not None
                    or failure_consequence is not None
                    or original_check_decision_id is not None
                    or original_check_ref is not None
                    or any(
                        field in container
                        for field in (
                            "method_changed",
                            "failure_consequence",
                            "announced_consequence",
                            "original_check",
                        )
                        for container in (data, record, payload)
                    )
                )
            )
            or (
                is_combined
                and not _combined_roll_evidence_is_consistent(
                    operation, resolution, data, record, payload
                )
            )
        )
    if invalid:
        raise ToolError(
            "state_corrupt",
            f"roll source receipt for {tool_name} decision_id '{receipt['decision_id']}' has contradictory resolution evidence",
        )

def _validate_roll_receipt(
    receipt: dict[str, Any], *, tool_name: str, decision_id: str,
    current_operation: dict[str, Any] | None = None,
) -> None:
    operation = receipt.get("operation")
    resolution = receipt.get("resolution")
    record = receipt.get("roll_record")
    data = receipt.get("data")
    roll_id = str(receipt.get("roll_id") or "")
    payload = record.get("payload") if isinstance(record, dict) else None
    if (
        set(receipt) != set(_ROLL_RECEIPT_FIELDS)
        or receipt.get("schema_version") != _ROLL_RECEIPT_SCHEMA_VERSION
        or not isinstance(receipt.get("tool"), str)
        or receipt.get("tool") != tool_name
        or not isinstance(receipt.get("decision_id"), str)
        or receipt.get("decision_id") != decision_id
        or tool_name not in _ROLL_RECEIPT_TOOLS
        or not isinstance(operation, dict)
        or not isinstance(resolution, dict)
        or receipt.get("fingerprint")
        != _operation_fingerprint(tool_name, operation)
        or not isinstance(record, dict)
        or not isinstance(data, dict)
        or not isinstance(payload, dict)
        or not isinstance(receipt.get("warnings"), list)
        or not isinstance(receipt.get("hints"), list)
        or isinstance(receipt.get("log_prefix_size"), bool)
        or not isinstance(receipt.get("log_prefix_size"), int)
        or receipt.get("log_prefix_size") < 0
        or not re.fullmatch(
            r"sha256:[0-9a-f]{64}", str(receipt.get("log_prefix_sha256") or "")
        )
        or not roll_id
        or str(record.get("roll_id") or "") != roll_id
        or str(payload.get("roll_id") or "") != roll_id
        or str(data.get("roll_id") or "") != roll_id
        or record.get("visibility") not in {"public", "keeper_only"}
        or record.get("event_type") != "roll"
        or any(record.get(key) != value for key, value in data.items())
        or receipt.get(_SOURCE_RECEIPT_INTEGRITY_KEY)
        != _source_receipt_integrity(receipt)
    ):
        raise ToolError(
            "state_corrupt",
            f"roll source receipt for {tool_name} decision_id '{decision_id}' is invalid",
        )
    if tool_name == "rules.check":
        _validate_generic_check_receipt(receipt)
    else:
        _validate_roll_resolution_consistency(receipt)
    if (
        current_operation is not None
        and receipt.get("fingerprint")
        != _operation_fingerprint(tool_name, current_operation)
    ):
        raise ToolError(
            "idempotency_conflict",
            f"decision_id '{decision_id}' was already applied to a different {tool_name} semantic operation",
        )

def _validate_generic_check_receipt(receipt: dict[str, Any]) -> None:
    """Validate the package-neutral evidence frozen by ``rules.check``."""
    operation = receipt.get("operation")
    resolution = receipt.get("resolution")
    data = receipt.get("data")
    record = receipt.get("roll_record")
    payload = record.get("payload") if isinstance(record, dict) else None
    dice = data.get("dice") if isinstance(data, dict) else None
    required_operation = {
        "ruleset_id", "ruleset_version", "actor_id", "request", "seed",
    }
    required_resolution = {
        "label", "outcome", "success", "expression", "faces", "total", "target",
    }
    invalid = (
        not isinstance(operation, dict)
        or set(operation) != required_operation
        or not all(
            isinstance(operation.get(key), str) and bool(operation[key])
            for key in ("ruleset_id", "ruleset_version", "actor_id")
        )
        or not isinstance(operation.get("request"), dict)
        or (
            operation.get("seed") is not None
            and not _is_exact_int(operation.get("seed"))
        )
        or not isinstance(resolution, dict)
        or set(resolution) != required_resolution
        or not isinstance(resolution.get("label"), str)
        or not resolution.get("label")
        or not isinstance(resolution.get("outcome"), str)
        or not resolution.get("outcome")
        or not isinstance(resolution.get("success"), bool)
        or not isinstance(resolution.get("expression"), str)
        or not resolution.get("expression")
        or not isinstance(resolution.get("faces"), list)
        or not resolution.get("faces")
        or not all(_is_exact_int(value) for value in resolution.get("faces", []))
        or not _is_exact_int(resolution.get("total"))
        or (
            resolution.get("target") is not None
            and not _is_exact_int(resolution.get("target"))
        )
        or not isinstance(data, dict)
        or not isinstance(payload, dict)
        or not isinstance(dice, dict)
        or dice != {
            "expression": resolution.get("expression"),
            "raw": resolution.get("faces"),
            "total": resolution.get("total"),
        }
        or data.get("ruleset_id") != operation.get("ruleset_id")
        or data.get("ruleset_version") != operation.get("ruleset_version")
        or data.get("actor_id") != operation.get("actor_id")
        or data.get("investigator_id") != operation.get("actor_id")
        or data.get("skill") != resolution.get("label")
        or data.get("outcome") != resolution.get("outcome")
        or data.get("success") is not resolution.get("success")
        or data.get("roll") != resolution.get("total")
        or data.get("target") != resolution.get("target")
        or payload.get("dice") != dice
    )
    if invalid:
        raise ToolError(
            "state_corrupt",
            f"generic check source receipt decision_id '{receipt.get('decision_id')}' has contradictory evidence",
        )

def _roll_log_bytes(ctx: Ctx) -> bytes:
    path = ctx.campaign_dir / "logs" / "rolls.jsonl"
    if not path.is_file():
        return b""
    try:
        return path.read_bytes()
    except OSError as exc:
        raise ToolError("state_corrupt", "logs/rolls.jsonl is unreadable") from exc

def _roll_record_frame(record: dict[str, Any]) -> bytes:
    return json.dumps(record).encode("utf-8")

def _parse_complete_roll_frames(
    raw: bytes,
) -> tuple[bytes, bytes, dict[str, dict[str, Any]]]:
    """Parse framed rows once and return the first unproven suffix as tail.

    A process can die after writing a full JSON object but before its newline,
    and another low-level writer may then append a complete frame.  In that
    case the malformed physical line ends in a newline, so merely inspecting
    the final byte would misclassify it as durable corruption.  Returning the
    first malformed suffix lets a committed receipt prove the exact insertion
    boundary; callers still fail closed when no unique receipt does so.
    """
    index: dict[str, dict[str, Any]] = {}
    complete_size = 0
    line_number = 0
    for framed in raw.splitlines(keepends=True):
        line_number += 1
        if not framed.endswith(b"\n"):
            return raw[:complete_size], raw[complete_size:], index
        encoded = framed[:-1]
        if not encoded.strip():
            complete_size += len(framed)
            continue
        try:
            row = json.loads(encoded.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            return raw[:complete_size], raw[complete_size:], index
        if not isinstance(row, dict):
            raise ToolError(
                "state_corrupt",
                f"logs/rolls.jsonl line {line_number} is not an object",
            )
        roll_id = str(row.get("roll_id") or "")
        if roll_id:
            if roll_id in index:
                raise ToolError(
                    "state_corrupt", f"duplicate roll_id '{roll_id}' in rolls.jsonl"
                )
            index[roll_id] = row
        complete_size += len(framed)
    return raw, b"", index

def _roll_prefix_hash_update(digest: Any, chunk: memoryview) -> None:
    """One instrumentation seam for bounded cumulative-prefix verification."""
    digest.update(chunk)

def _verify_roll_receipt_prefixes(
    raw: bytes, receipts: list[dict[str, Any]]
) -> None:
    """Verify every historical prefix with one monotonic hash pass."""
    ordered = sorted(
        receipts,
        key=lambda receipt: (
            int(receipt["log_prefix_size"]),
            str(receipt["tool"]),
            str(receipt["decision_id"]),
        ),
    )
    digest = hashlib.sha256()
    offset = 0
    view = memoryview(raw)
    for receipt in ordered:
        size = int(receipt["log_prefix_size"])
        if size < offset or size > len(raw):
            raise ToolError(
                "state_corrupt",
                f"roll source prefix for roll_id '{receipt['roll_id']}' is out of range",
            )
        if size > offset:
            _roll_prefix_hash_update(digest, view[offset:size])
            offset = size
        actual = f"sha256:{digest.hexdigest()}"
        if actual != receipt["log_prefix_sha256"]:
            raise ToolError(
                "state_corrupt",
                f"roll source prefix for roll_id '{receipt['roll_id']}' changed",
            )

def _append_roll_frame_locked(path: Path, frame: bytes) -> None:
    """Append one newline frame with recoverable partial-write semantics."""
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor = os.open(path, os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o600)
    try:
        pending = memoryview(frame + b"\n")
        while pending:
            written = os.write(descriptor, pending)
            if written <= 0:
                raise OSError("roll frame append made no progress")
            pending = pending[written:]
        os.fsync(descriptor)
    finally:
        os.close(descriptor)

def _plan_receipt_owned_tail(
    raw: bytes,
    complete: bytes,
    tail: bytes,
    receipts: list[dict[str, Any]],
) -> tuple[bytes, dict[str, dict[str, Any]]]:
    """Repair only a unique final frame proven by a committed prefix receipt."""
    candidates: list[tuple[dict[str, Any], bytes]] = []
    for receipt in receipts:
        if int(receipt["log_prefix_size"]) != len(complete):
            continue
        expected = _roll_record_frame(receipt["roll_record"])
        if expected.startswith(tail):
            repaired = complete + expected + b"\n"
            candidates.append((receipt, repaired))
        elif tail.startswith(expected):
            # A later low-level append may have followed a complete frame whose
            # newline was lost. The exact expected length provides the only
            # safe insertion boundary; the remainder must itself be framed.
            repaired = complete + expected + b"\n" + tail[len(expected):]
            candidates.append((receipt, repaired))
    if len(candidates) != 1:
        raise ToolError(
            "state_corrupt",
            "logs/rolls.jsonl has an ambiguous or non-receipt-owned final tail",
        )
    _receipt, repaired = candidates[0]
    repaired_complete, repaired_tail, index = _parse_complete_roll_frames(repaired)
    if repaired_tail or repaired_complete != repaired:
        raise ToolError(
            "state_corrupt",
            "logs/rolls.jsonl final tail cannot be repaired without guessing",
        )
    return repaired, index

def _validated_roll_document_collection(
    document: dict[str, Any],
) -> tuple[list[dict[str, Any]], dict[str, dict[str, Any]]]:
    ordered: list[dict[str, Any]] = []
    by_effect_key: dict[str, dict[str, Any]] = {}
    decision_owners: set[tuple[str, str]] = set()
    roll_owners: dict[str, tuple[str, str]] = {}
    receipts = document.get("receipts")
    if not isinstance(receipts, dict):
        raise ToolError("state_corrupt", "canonical receipts map is invalid")
    for tool_name in sorted(receipts):
        by_tool = receipts[tool_name]
        if tool_name not in _ROLL_RECEIPT_TOOLS or not isinstance(by_tool, dict):
            raise ToolError("state_corrupt", "canonical receipts map is invalid")
        for decision_id in sorted(by_tool):
            receipt = by_tool[decision_id]
            if not isinstance(receipt, dict):
                raise ToolError("state_corrupt", "canonical receipt is invalid")
            _validate_roll_receipt(
                receipt, tool_name=tool_name, decision_id=decision_id
            )
            decision_owner = (str(tool_name), str(decision_id))
            if decision_owner in decision_owners:
                raise ToolError(
                    "state_corrupt",
                    f"roll decision '{tool_name}:{decision_id}' has multiple receipt owners",
                )
            decision_owners.add(decision_owner)
            roll_id = str(receipt["roll_id"])
            prior_owner = roll_owners.get(roll_id)
            if prior_owner is not None:
                raise ToolError(
                    "state_corrupt",
                    f"roll_id '{roll_id}' has multiple receipt owners",
                )
            roll_owners[roll_id] = decision_owner
            ordered.append(receipt)
            by_effect_key[_roll_side_effect_key(receipt)] = receipt
    roll_receipts = receipts.get("rules.roll") or {}
    push_receipts = receipts.get("rules.push") or {}
    pushed_originals: dict[str, str] = {}
    for push_decision_id, push_receipt in push_receipts.items():
        push_operation = push_receipt["operation"]
        original_decision_id = str(
            push_operation.get("original_check_decision_id") or ""
        )
        original = roll_receipts.get(original_decision_id)
        if not isinstance(original, dict):
            raise ToolError(
                "state_corrupt",
                f"pushed roll '{push_decision_id}' has no canonical original rules.roll receipt",
            )
        expected_ref = {
            "tool": "rules.roll",
            "decision_id": original_decision_id,
            "roll_id": str(original["roll_id"]),
            "integrity_digest": str(original[_SOURCE_RECEIPT_INTEGRITY_KEY]),
        }
        if (
            original["data"].get("success") is not False
            or original["data"].get("passed") is not False
            or original["data"].get("outcome") != "failure"
            or push_receipt["resolution"].get("original_check_ref")
            != expected_ref
            or any(
                push_operation.get(field)
                != original["operation"].get(field)
                for field in _PUSH_INHERITED_OPERATION_FIELDS
            )
            or any(
                push_receipt["resolution"].get(field)
                != original["resolution"].get(field)
                for field in (
                    "investigator_id",
                    "resolved_label",
                    "resolved_target",
                    "target_source",
                )
            )
        ):
            raise ToolError(
                "state_corrupt",
                f"pushed roll '{push_decision_id}' contradicts its original check contract",
            )
        prior_push = pushed_originals.get(original_decision_id)
        if prior_push is not None and prior_push != str(push_decision_id):
            raise ToolError(
                "state_corrupt",
                f"original check '{original_decision_id}' has multiple pushed rolls",
            )
        pushed_originals[original_decision_id] = str(push_decision_id)
    pending = document.get("pending_side_effects")
    if not isinstance(pending, dict):
        raise ToolError("state_corrupt", "canonical roll pending index is invalid")
    for key, roll_id in pending.items():
        receipt = by_effect_key.get(str(key))
        if (
            not isinstance(key, str)
            or not isinstance(roll_id, str)
            or receipt is None
            or not _roll_receipt_needs_side_effect(receipt)
            or roll_id != str(receipt["roll_id"])
        ):
            raise ToolError(
                "state_corrupt", "canonical roll pending index has no valid receipt"
            )
    _validate_luck_spend_receipts(document)
    return ordered, by_effect_key

def _plan_roll_materialization(
    raw: bytes, receipts: list[dict[str, Any]]
) -> dict[str, Any]:
    _verify_roll_receipt_prefixes(raw, receipts)
    complete, tail, index = _parse_complete_roll_frames(raw)
    replacement: bytes | None = None
    if tail:
        replacement, index = _plan_receipt_owned_tail(
            raw, complete, tail, receipts
        )
    append_records: list[dict[str, Any]] = []
    planned_ids = set(index)
    for receipt in receipts:
        roll_id = str(receipt["roll_id"])
        expected = receipt["roll_record"]
        prior = index.get(roll_id)
        if prior is not None:
            if prior != expected:
                raise ToolError(
                    "state_corrupt",
                    f"roll_id '{roll_id}' conflicts with its source receipt",
                )
            continue
        if roll_id in planned_ids:
            raise ToolError(
                "state_corrupt", f"roll_id '{roll_id}' has multiple append owners"
            )
        planned_ids.add(roll_id)
        append_records.append(expected)
    return {"replacement": replacement, "append_records": append_records}

def _preflight_roll_document(
    document: dict[str, Any], raw: bytes
) -> tuple[list[dict[str, Any]], dict[str, dict[str, Any]], dict[str, Any]]:
    ordered, by_effect_key = _validated_roll_document_collection(document)
    plan = _plan_roll_materialization(raw, ordered)
    return ordered, by_effect_key, plan

def _apply_roll_materialization_plan(ctx: Ctx, plan: dict[str, Any]) -> None:
    path = ctx.campaign_dir / "logs" / "rolls.jsonl"
    replacement = plan.get("replacement")
    if replacement is not None:
        coc_fileio.write_text_atomic(path, bytes(replacement).decode("utf-8"))
    for record in plan.get("append_records") or []:
        _append_roll_frame_locked(path, _roll_record_frame(record))

def _materialize_roll_receipts_locked(
    ctx: Ctx, receipts: list[dict[str, Any]]
) -> None:
    raw = _roll_log_bytes(ctx)
    plan = _plan_roll_materialization(raw, receipts)
    _apply_roll_materialization_plan(ctx, plan)

def _freeze_roll_receipt_source(
    ctx: Ctx,
    document: dict[str, Any],
    receipt: dict[str, Any],
) -> None:
    """Atomically publish the intent while its clean log prefix is frozen."""
    try:
        with coc_async_recorder.recorder_lock(ctx.campaign_dir):
            raw = _roll_log_bytes(ctx)
            _complete, tail, _index = _parse_complete_roll_frames(raw)
            if tail:
                raise ToolError(
                    "state_corrupt",
                    "cannot start a new roll while rolls.jsonl has an unterminated tail",
                )
            receipt["log_prefix_size"] = len(raw)
            receipt["log_prefix_sha256"] = (
                f"sha256:{hashlib.sha256(raw).hexdigest()}"
            )
            receipt[_SOURCE_RECEIPT_INTEGRITY_KEY] = _source_receipt_integrity(
                receipt
            )
            _validate_roll_receipt(
                receipt,
                tool_name=str(receipt["tool"]),
                decision_id=str(receipt["decision_id"]),
            )
            _put_roll_receipt(document, receipt)
            _queue_roll_side_effect(document, receipt)
            _preflight_roll_document(document, raw)
            _save_roll_receipt_document(ctx, document)
    except coc_async_recorder.RecorderLockError as exc:
        raise ToolError("campaign_busy", str(exc)) from exc

def _ensure_roll_receipt_row(ctx: Ctx, receipt: dict[str, Any]) -> bool:
    """Materialize one frozen roll row exactly once under the recorder lock."""
    _validate_roll_receipt(
        receipt,
        tool_name=str(receipt.get("tool") or ""),
        decision_id=str(receipt.get("decision_id") or ""),
    )
    try:
        with coc_async_recorder.recorder_lock(ctx.campaign_dir):
            before = _roll_log_bytes(ctx)
            _materialize_roll_receipts_locked(ctx, [receipt])
            return _roll_log_bytes(ctx) != before
    except coc_async_recorder.RecorderLockError as exc:
        raise ToolError("campaign_busy", str(exc)) from exc

def _apply_roll_receipt_side_effects(ctx: Ctx, receipt: dict[str, Any]) -> bool:
    """Repair deterministic non-log effects frozen by a percentile receipt."""
    if not _roll_receipt_needs_side_effect(receipt):
        return False
    data = receipt.get("data") or {}
    skill = str(data.get("skill") or "")
    return _mark_improvement_tick(
        ctx,
        str(data.get("investigator_id") or ""),
        skill,
        data,
        source_event_id=f"rules.roll:{receipt['decision_id']}",
        source_kind="rules.roll",
    )

def _settle_pending_roll_side_effect(
    ctx: Ctx,
    document: dict[str, Any],
    receipt: dict[str, Any],
) -> bool:
    pending = document.get("pending_side_effects")
    if not isinstance(pending, dict):
        raise ToolError("state_corrupt", "canonical roll pending index is invalid")
    key = _roll_side_effect_key(receipt)
    frozen_roll_id = pending.get(key)
    if frozen_roll_id is None:
        return False
    if str(frozen_roll_id) != str(receipt["roll_id"]):
        raise ToolError(
            "state_corrupt",
            f"pending roll side effect for decision_id '{receipt['decision_id']}' is invalid",
        )
    _apply_roll_receipt_side_effects(ctx, receipt)
    del pending[key]
    _save_roll_receipt_document(ctx, document)
    return True

def _repair_roll_receipt_ledger(ctx: Ctx, receipt: dict[str, Any]) -> None:
    data = deepcopy(receipt["data"])
    manifest = _source_receipt_manifest(receipt)
    prior = ctx.ledger_lookup(str(receipt["tool"]), str(receipt["decision_id"]))
    if (
        prior is None
        or prior.get("data") != data
        or prior.get("source_receipt_manifest") != manifest
    ):
        ctx.ledger_record(
            str(receipt["decision_id"]),
            str(receipt["tool"]),
            data,
            source_receipt_manifest=manifest,
        )

def _replay_roll_receipt(
    ctx: Ctx, document: dict[str, Any], receipt: dict[str, Any]
) -> tuple[dict[str, Any], list[str], list[str]]:
    _ensure_roll_receipt_row(ctx, receipt)
    _settle_pending_roll_side_effect(ctx, document, receipt)
    _repair_roll_receipt_ledger(ctx, receipt)
    warnings = list(receipt.get("warnings") or [])
    warnings.append(
        "duplicate decision_id: recovered the original roll source receipt"
    )
    data = receipt.get("data") if isinstance(receipt.get("data"), dict) else {}
    context = (
        data.get("resolution_context")
        if isinstance(data.get("resolution_context"), dict)
        else None
    )
    _route_receipt, route_warnings = _settle_contextual_route(
        ctx,
        context,
        decision_id=str(receipt.get("decision_id") or ""),
        source_tool=str(receipt.get("tool") or "rules.roll"),
        successful=bool(data.get("success")),
    )
    warnings.extend(route_warnings)
    return (
        deepcopy(data),
        warnings,
        list(receipt.get("hints") or []),
    )

def _existing_roll_receipt(
    ctx: Ctx,
    *,
    tool_name: str,
    decision_id: str,
    operation: dict[str, Any],
    document: dict[str, Any] | None = None,
) -> tuple[dict[str, Any], dict[str, Any] | None]:
    if document is None:
        document = _load_roll_receipt_document(ctx)
    receipt = _roll_receipt(document, tool_name, decision_id)
    if receipt is not None:
        _validate_roll_receipt(
            receipt,
            tool_name=tool_name,
            decision_id=decision_id,
            current_operation=operation,
        )
        return document, receipt
    prior = ctx.ledger_lookup(tool_name, decision_id)
    if prior is not None:
        raise ToolError(
            "state_corrupt",
            f"toolbox ledger entry for {tool_name} decision_id '{decision_id}' has no canonical roll source receipt",
        )
    return document, None

def _commit_new_roll_receipt(
    ctx: Ctx,
    document: dict[str, Any],
    receipt: dict[str, Any],
) -> None:
    """Durably freeze source, then materialize row/effects, then ledger."""
    _freeze_roll_receipt_source(ctx, document, receipt)
    _ensure_roll_receipt_row(ctx, receipt)
    _settle_pending_roll_side_effect(ctx, document, receipt)
    _repair_roll_receipt_ledger(ctx, receipt)

def _reconcile_all_roll_source_receipts(ctx: Ctx) -> None:
    document = _load_roll_receipt_document(ctx)
    # Most state tools have no roll receipts to reconcile.  Validate the empty
    # collection (including rejecting a ghost pending index) without taking the
    # recorder lock so unrelated background flushing cannot block state repair.
    ordered, _by_effect_key = _validated_roll_document_collection(document)
    if not ordered:
        return
    try:
        with coc_async_recorder.recorder_lock(ctx.campaign_dir):
            raw = _roll_log_bytes(ctx)
            _ordered, by_effect_key, plan = _preflight_roll_document(document, raw)
            _apply_roll_materialization_plan(ctx, plan)
    except coc_async_recorder.RecorderLockError as exc:
        raise ToolError("campaign_busy", str(exc)) from exc
    # The entire collection, log plan, and pending index are proven before the
    # first append or development mutation. Ledger repair remains requested-ID.
    pending = document["pending_side_effects"]
    pending_changed = False
    for key in sorted(list(pending)):
        receipt = by_effect_key.get(key)
        if receipt is None or not _roll_receipt_needs_side_effect(receipt):
            raise ToolError(
                "state_corrupt", "canonical roll pending index has no valid receipt"
            )
        if str(pending[key]) != str(receipt["roll_id"]):
            raise ToolError(
                "state_corrupt",
                f"pending roll side effect for decision_id '{receipt['decision_id']}' is invalid",
            )
        _apply_roll_receipt_side_effects(ctx, receipt)
        del pending[key]
        pending_changed = True
    if pending_changed:
        _save_roll_receipt_document(ctx, document)

def _ledger_requires_source_receipt(entry: dict[str, Any] | None) -> bool:
    if not isinstance(entry, dict):
        return False
    entry_schema = entry.get("entry_schema_version")
    explicitly_receipt_era = bool(
        entry.get("source_receipt_required") is True
        or (
            isinstance(entry_schema, int)
            and not isinstance(entry_schema, bool)
            and entry_schema in {3, 5}
        )
    )
    if "source_receipt_manifest" not in entry:
        if explicitly_receipt_era:
            raise ToolError(
                "state_corrupt",
                "receipt-era toolbox ledger entry is missing its source receipt manifest",
            )
        return False
    manifest = entry.get("source_receipt_manifest")
    digest = str((manifest or {}).get("integrity_digest") or "") if isinstance(manifest, dict) else ""
    entry_tool = str(entry.get("tool"))
    supported_receipt_versions = (
        frozenset({_ROLL_RECEIPT_SCHEMA_VERSION})
        if entry_tool in _ROLL_RECEIPT_TOOLS
        else frozenset({_LUCK_SPEND_RECEIPT_SCHEMA_VERSION})
        if entry_tool == "rules.luck_spend"
        else frozenset({_SOURCE_RECEIPT_SCHEMA_VERSION})
    )
    if (
        not isinstance(manifest, dict)
        or manifest.get("schema_version") != 1
        or manifest.get("receipt_schema_version")
        not in supported_receipt_versions
        or str(manifest.get("tool")) != str(entry.get("tool"))
        or str(manifest.get("decision_id")) != str(entry.get("decision_id"))
        or not digest.startswith("sha256:")
        or len(digest) != len("sha256:") + 64
    ):
        raise ToolError(
            "state_corrupt",
            "toolbox ledger has an invalid source receipt manifest",
        )
    return True

def _operation_event_id(tool_name: str, decision_id: str) -> str:
    encoded = json.dumps(
        [str(tool_name), str(decision_id)],
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode("utf-8")
    return f"tool-operation-v1:{hashlib.sha256(encoded).hexdigest()[:32]}"

def _source_receipt(
    source: dict[str, Any],
    tool_name: str,
    decision_id: str,
) -> dict[str, Any] | None:
    all_receipts = source.get(_SOURCE_RECEIPTS_KEY)
    if all_receipts is None:
        return None
    if not isinstance(all_receipts, dict):
        raise ToolError(
            "state_corrupt",
            f"canonical source has invalid {_SOURCE_RECEIPTS_KEY}",
        )
    tool_receipts = all_receipts.get(str(tool_name))
    if tool_receipts is None:
        return None
    if not isinstance(tool_receipts, dict):
        raise ToolError(
            "state_corrupt",
            f"canonical source has invalid receipts for {tool_name}",
        )
    receipt = tool_receipts.get(str(decision_id))
    if receipt is None:
        return None
    if not isinstance(receipt, dict):
        raise ToolError(
            "state_corrupt",
            f"canonical source receipt for {tool_name} decision_id '{decision_id}' is not an object",
        )
    return receipt

def _put_source_receipt(
    source: dict[str, Any],
    receipt: dict[str, Any],
) -> None:
    all_receipts = source.get(_SOURCE_RECEIPTS_KEY)
    if all_receipts is None:
        all_receipts = {}
    elif not isinstance(all_receipts, dict):
        raise ToolError(
            "state_corrupt",
            f"canonical source has invalid {_SOURCE_RECEIPTS_KEY}; refusing to overwrite it",
        )
    tool_name = str(receipt["tool"])
    tool_receipts = all_receipts.get(tool_name)
    if tool_receipts is None:
        tool_receipts = {}
    elif not isinstance(tool_receipts, dict):
        raise ToolError(
            "state_corrupt",
            f"canonical source has invalid receipts for {tool_name}; refusing to overwrite them",
        )
    tool_receipts[str(receipt["decision_id"])] = deepcopy(receipt)
    all_receipts[tool_name] = tool_receipts
    source[_SOURCE_RECEIPTS_KEY] = all_receipts

def _new_source_receipt(
    *,
    tool_name: str,
    decision_id: str,
    operation: dict[str, Any],
    event: dict[str, Any],
    data: dict[str, Any],
    warnings: list[str] | None = None,
    hints: list[str] | None = None,
    entity_head: dict[str, Any],
) -> dict[str, Any]:
    receipt = {
        "schema_version": _SOURCE_RECEIPT_SCHEMA_VERSION,
        "tool": str(tool_name),
        "decision_id": str(decision_id),
        "fingerprint": _operation_fingerprint(tool_name, operation),
        "operation": deepcopy(operation),
        "event_id": event.get("event_id"),
        "event": deepcopy(event),
        "data": deepcopy(data),
        "warnings": list(warnings or []),
        "hints": list(hints or []),
        "entity_head": deepcopy(entity_head),
    }
    receipt[_SOURCE_RECEIPT_INTEGRITY_KEY] = _source_receipt_integrity(receipt)
    return receipt

def _validate_source_receipt(
    receipt: dict[str, Any],
    *,
    tool_name: str,
    decision_id: str,
    operation: dict[str, Any],
) -> None:
    # Validate the complete immutable receipt before comparing the requested
    # operation or performing any event/world/ledger repair.
    if (
        receipt.get("schema_version") != _SOURCE_RECEIPT_SCHEMA_VERSION
        or set(receipt) != set(_SOURCE_RECEIPT_FIELDS)
        or not isinstance(receipt.get("operation"), dict)
        or not isinstance(receipt.get("event"), dict)
        or not isinstance(receipt.get("data"), dict)
        or not isinstance(receipt.get("warnings"), list)
        or not isinstance(receipt.get("hints"), list)
        or str(receipt.get(_SOURCE_RECEIPT_INTEGRITY_KEY) or "")
        != _source_receipt_integrity(receipt)
    ):
        raise ToolError(
            "state_corrupt",
            f"source receipt for {tool_name} decision_id '{decision_id}' failed full integrity validation",
        )
    stored_operation = receipt.get("operation")
    stored_fingerprint = str(receipt.get("fingerprint") or "")
    stored_event = receipt.get("event")
    stable_event_id = _operation_event_id(tool_name, decision_id)
    if (
        str(receipt.get("tool")) != str(tool_name)
        or str(receipt.get("decision_id")) != str(decision_id)
        or stored_fingerprint
        != _operation_fingerprint(tool_name, stored_operation)
        or str(receipt.get("event_id") or "") != stable_event_id
        or not isinstance(stored_event, dict)
        or str(stored_event.get("event_id") or "") != stable_event_id
    ):
        raise ToolError(
            "state_corrupt",
            f"source receipt for {tool_name} decision_id '{decision_id}' is inconsistent",
        )
    expected = _operation_fingerprint(tool_name, operation)
    if stored_fingerprint != expected:
        raise ToolError(
            "idempotency_conflict",
            f"decision_id '{decision_id}' was already applied to a different {tool_name} payload",
        )
    head = receipt.get("entity_head")
    if (
        not coc_flag_state.valid_entity_head(head)
        or str(head.get("decision_id")) != str(decision_id)
        or str((receipt.get("event") or {}).get("live_head_digest") or "")
        != coc_flag_state.canonical_digest(head)
    ):
        raise ToolError(
            "state_corrupt",
            f"source receipt for {tool_name} decision_id '{decision_id}' has an invalid entity head",
        )

def _operation_event_present(ctx: Ctx, receipt: dict[str, Any]) -> bool:
    """Validate exact event cardinality without mutating the append-only log."""
    event = receipt.get("event")
    event_id = str(receipt.get("event_id") or "")
    if not isinstance(event, dict) or not event_id:
        raise ToolError("state_corrupt", "source receipt has no stable event payload")
    matches = [
        row
        for row in _read_jsonl_records(ctx.campaign_dir / "logs" / "events.jsonl")
        if str(row.get("event_id") or "") == event_id
    ]
    if matches:
        if len(matches) != 1 or matches[0] != event:
            raise ToolError(
                "state_corrupt",
                f"event '{event_id}' is duplicated or conflicts with its source receipt",
            )
        return True
    return False

def _pending_jsonl_rows(
    ctx: Ctx, relative_path: str, event_id: str
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    pending_dir = ctx.campaign_dir / "logs" / "pending-turns"
    if not pending_dir.is_dir():
        return rows
    for path in sorted(pending_dir.glob("*.json")):
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError) as exc:
            raise ToolError(
                "state_corrupt", f"pending recorder batch '{path.name}' is unreadable"
            ) from exc
        entries = payload.get("entries") if isinstance(payload, dict) else None
        if not isinstance(entries, list):
            raise ToolError(
                "state_corrupt", f"pending recorder batch '{path.name}' is invalid"
            )
        for entry in entries:
            if (
                isinstance(entry, dict)
                and entry.get("relative_path") == relative_path
                and isinstance(entry.get("record"), dict)
                and str(entry["record"].get("event_id") or "") == event_id
            ):
                rows.append(entry["record"])
    return rows

def _ensure_operation_event(
    ctx: Ctx,
    receipt: dict[str, Any],
    *,
    inspect_pending: bool = False,
) -> bool:
    """Append a receipt-owned event once, repairing a pre-ledger crash."""
    if not _stored_toolbox_receipt_valid(receipt):
        raise ToolError("state_corrupt", "source receipt integrity failed")
    event = receipt.get("event")
    assert isinstance(event, dict)
    return _materialize_stable_receipt_event(
        ctx,
        event=event,
        event_id=str(receipt.get("event_id") or ""),
        inspect_pending=inspect_pending,
    )

def _replay_source_receipt(
    ctx: Ctx,
    receipt: dict[str, Any],
) -> tuple[dict[str, Any], list[str], list[str]]:
    """Repair append/ledger stages while preserving the original result."""
    _ensure_operation_event(ctx, receipt)
    data = deepcopy(receipt.get("data") or {})
    ledger_entry = ctx.ledger_lookup(
        str(receipt["tool"]), str(receipt["decision_id"])
    )
    manifest = _source_receipt_manifest(receipt)
    if (
        ledger_entry is None
        or ledger_entry.get("data") != data
        or ledger_entry.get("source_receipt_manifest") != manifest
    ):
        ctx.ledger_record(
            str(receipt["decision_id"]),
            str(receipt["tool"]),
            data,
            source_receipt_manifest=manifest,
        )
    warnings = list(receipt.get("warnings") or [])
    warnings.append(
        "duplicate decision_id: recovered the original source-of-truth receipt"
    )
    return data, warnings, list(receipt.get("hints") or [])

def _validated_receipt_entity_head(
    receipt: dict[str, Any],
    *,
    entity_kind: str,
    entity_id: str,
) -> dict[str, Any]:
    """Return the entity head from a current schema-v3 receipt."""
    head = receipt.get("entity_head")
    if not coc_flag_state.valid_entity_head(
        head, entity_kind=entity_kind, entity_id=entity_id
    ):
        raise ToolError("state_corrupt", "source receipt has an invalid entity head")
    return deepcopy(head)

def _stored_toolbox_receipt_valid(receipt: Any) -> bool:
    if (
        not isinstance(receipt, dict)
        or receipt.get("schema_version") != _SOURCE_RECEIPT_SCHEMA_VERSION
        or set(receipt) != set(_SOURCE_RECEIPT_FIELDS)
        or str(receipt.get(_SOURCE_RECEIPT_INTEGRITY_KEY) or "")
        != _source_receipt_integrity(receipt)
        or not isinstance(receipt.get("operation"), dict)
    ):
        return False
    head = receipt.get("entity_head")
    event = receipt.get("event")
    return bool(
        coc_flag_state.valid_entity_head(head)
        and isinstance(event, dict)
        and str(receipt.get("event_id") or "")
        == _operation_event_id(
            str(receipt.get("tool") or ""), str(receipt.get("decision_id") or "")
        )
        and str(event.get("event_id") or "") == str(receipt.get("event_id") or "")
        and str(event.get("live_head_digest") or "")
        == coc_flag_state.canonical_digest(head)
        and str(head.get("decision_id") or "")
        == str(receipt.get("decision_id") or "")
    )

def _npc_presence_record_valid(
    record: Any, *, npc_id: str | None = None
) -> bool:
    if (
        not isinstance(record, dict)
        or set(record) != set(_NPC_PRESENCE_RECORD_FIELDS)
        or record.get("schema_version") != _NPC_PRESENCE_SCHEMA_VERSION
        or not isinstance(record.get("npc_id"), str)
        or not str(record.get("npc_id") or "").strip()
        or not isinstance(record.get("scene_id"), str)
        or not str(record.get("scene_id") or "").strip()
        or record.get("status") not in {"present", "absent"}
        or not isinstance(record.get("reason"), str)
        or not str(record.get("reason") or "").strip()
        or not isinstance(record.get("revision"), int)
        or isinstance(record.get("revision"), bool)
        or int(record.get("revision") or 0) < 1
        or not isinstance(record.get("changed_at"), str)
        or not str(record.get("changed_at") or "").strip()
        or not isinstance(record.get("decision_id"), str)
        or not str(record.get("decision_id") or "").strip()
        or not isinstance(record.get("source_sequence"), int)
        or isinstance(record.get("source_sequence"), bool)
        or int(record.get("source_sequence") or 0) < 1
        or record.get("producer") != "state.npc_presence"
    ):
        return False
    return npc_id is None or str(record["npc_id"]) == str(npc_id)

def _load_npc_presence_document(ctx: Ctx) -> dict[str, Any]:
    """Load the presence namespace that shares canonical npc-state.json.

    Persona cards and psychology retain their existing ownership.  Presence is
    an explicit live overlay: engagement history is never treated as proof
    that an NPC is still in a scene.
    """
    document = coc_npc_state.load_npc_state(ctx.campaign_dir)
    for key, default in (
        ("presence", {}),
        ("presence_heads", {}),
        ("presence_source_sequence", 0),
        (_SOURCE_RECEIPTS_KEY, {}),
    ):
        if key not in document:
            document[key] = deepcopy(default)
    if not isinstance(document.get("presence"), dict):
        raise ToolError("state_corrupt", "npc-state presence map is invalid")
    if not isinstance(document.get("presence_heads"), dict):
        raise ToolError("state_corrupt", "npc-state presence head map is invalid")
    sequence = document.get("presence_source_sequence")
    if not isinstance(sequence, int) or isinstance(sequence, bool) or sequence < 0:
        raise ToolError("state_corrupt", "npc-state presence source sequence is invalid")
    all_receipts = document.get(_SOURCE_RECEIPTS_KEY)
    if not isinstance(all_receipts, dict):
        raise ToolError("state_corrupt", "npc-state operation receipt map is invalid")
    presence_receipts = all_receipts.get("state.npc_presence", {})
    if not isinstance(presence_receipts, dict):
        raise ToolError("state_corrupt", "npc-state presence receipt map is invalid")
    for key, record in document["presence"].items():
        if not _npc_presence_record_valid(record, npc_id=str(key)):
            raise ToolError(
                "state_corrupt", f"npc presence record '{key}' is invalid"
            )
    for key, head in document["presence_heads"].items():
        if not coc_flag_state.valid_entity_head(
            head, entity_kind="npc_presence", entity_id=str(key)
        ):
            raise ToolError(
                "state_corrupt", f"npc presence head '{key}' is invalid"
            )
    return document

def _npc_presence_live_record(
    document: dict[str, Any], npc_id: str
) -> dict[str, Any]:
    presence = document.get("presence")
    presence = presence if isinstance(presence, dict) else {}
    record = presence.get(str(npc_id))
    return {
        "schema_version": _NPC_PRESENCE_SCHEMA_VERSION,
        "npc_id": str(npc_id),
        "record": deepcopy(record) if isinstance(record, dict) else None,
    }

def _npc_presence_receipts(document: dict[str, Any]) -> dict[str, Any]:
    receipts = (
        (document.get(_SOURCE_RECEIPTS_KEY) or {}).get("state.npc_presence")
        or {}
    )
    if not isinstance(receipts, dict):
        raise ToolError("state_corrupt", "npc-state presence receipt map is invalid")
    return receipts

def _director_receipt_event_present(
    ctx: Ctx, receipt: dict[str, Any]
) -> bool:
    expected = receipt.get("event")
    event_id = str(receipt.get("event_id") or "")
    matches = [
        row
        for row in _read_jsonl_records(ctx.campaign_dir / "logs" / "events.jsonl")
        if str(row.get("event_id") or "") == event_id
    ]
    if matches and (len(matches) != 1 or matches[0] != expected):
        raise ToolError(
            "state_corrupt",
            f"director flag event '{event_id}' is duplicated or conflicts with its source receipt",
        )
    return bool(matches)

def _unique_max_head(
    heads: list[dict[str, Any]],
    *,
    entity_kind: str,
    entity_id: str,
) -> dict[str, Any] | None:
    if not heads:
        return None
    if any(
        not coc_flag_state.valid_entity_head(
            head, entity_kind=entity_kind, entity_id=entity_id
        )
        for head in heads
    ):
        raise ToolError("state_corrupt", "anchored entity head is invalid")
    maximum = max(int(head["source_sequence"]) for head in heads)
    candidates = [head for head in heads if int(head["source_sequence"]) == maximum]
    unique = {
        coc_flag_state.canonical_digest(head): deepcopy(head) for head in candidates
    }
    if len(unique) != 1:
        raise ToolError(
            "state_corrupt",
            f"{entity_kind} '{entity_id}' has conflicting source heads at sequence {maximum}",
        )
    return next(iter(unique.values()))

def _anchored_npc_presence_heads(
    ctx: Ctx,
    document: dict[str, Any],
    *,
    npc_id: str,
    require_event: bool = True,
) -> list[dict[str, Any]]:
    heads: list[dict[str, Any]] = []
    for receipt in _npc_presence_receipts(document).values():
        if (
            not isinstance(receipt, dict)
            or not _stored_toolbox_receipt_valid(receipt)
            or receipt.get("tool") != "state.npc_presence"
        ):
            raise ToolError("state_corrupt", "canonical NPC presence receipt is invalid")
        head = receipt["entity_head"]
        if str(head.get("entity_id") or "") != str(npc_id):
            continue
        present = _operation_event_present(ctx, receipt)
        if require_event and not present:
            continue
        heads.append(deepcopy(head))
    return heads

def _latest_anchored_npc_presence_head(
    ctx: Ctx,
    document: dict[str, Any],
    npc_id: str,
    *,
    require_event: bool = True,
) -> dict[str, Any] | None:
    return _unique_max_head(
        _anchored_npc_presence_heads(
            ctx, document, npc_id=npc_id, require_event=require_event
        ),
        entity_kind="npc_presence",
        entity_id=str(npc_id),
    )

def _anchored_flag_heads(
    ctx: Ctx,
    flags: dict[str, Any],
    *,
    flag_id: str,
    require_event: bool = True,
) -> list[dict[str, Any]]:
    heads: list[dict[str, Any]] = []
    receipts = ((flags.get(_SOURCE_RECEIPTS_KEY) or {}).get("state.set_flag") or {})
    if not isinstance(receipts, dict):
        raise ToolError("state_corrupt", "canonical flag receipt map is invalid")
    for receipt in receipts.values():
        if not isinstance(receipt, dict):
            raise ToolError("state_corrupt", "canonical flag receipt is invalid")
        if receipt.get("schema_version") != _SOURCE_RECEIPT_SCHEMA_VERSION:
            raise ToolError("state_corrupt", "canonical flag receipt schema is unsupported")
        if not _stored_toolbox_receipt_valid(receipt) or receipt.get("tool") != "state.set_flag":
            raise ToolError("state_corrupt", "canonical flag receipt integrity failed")
        head = receipt["entity_head"]
        if str(head.get("entity_id") or "") != flag_id:
            continue
        present = _operation_event_present(ctx, receipt)
        if require_event and not present:
            continue
        heads.append(deepcopy(head))
    director_receipts = flags.get(coc_flag_state.DIRECTOR_FLAG_RECEIPTS_KEY) or {}
    if not coc_flag_state.valid_director_flag_receipt_map(director_receipts):
        raise ToolError("state_corrupt", "canonical director flag receipt map is invalid")
    for receipt in director_receipts.values():
        if str(receipt.get("flag_id") or "") != flag_id:
            continue
        present = _director_receipt_event_present(ctx, receipt)
        if require_event and not present:
            continue
        heads.append(deepcopy(receipt["entity_head"]))
    return heads

def _anchored_marker_heads(
    ctx: Ctx,
    payload: dict[str, Any],
    *,
    marker_id: str,
    require_event: bool = True,
) -> list[dict[str, Any]]:
    heads: list[dict[str, Any]] = []
    receipts = (
        (payload.get(_SOURCE_RECEIPTS_KEY) or {}).get("state.time_marker") or {}
    )
    if not isinstance(receipts, dict):
        raise ToolError("state_corrupt", "canonical marker receipt map is invalid")
    for receipt in receipts.values():
        if not isinstance(receipt, dict):
            raise ToolError("state_corrupt", "canonical marker receipt is invalid")
        if receipt.get("schema_version") != _SOURCE_RECEIPT_SCHEMA_VERSION:
            raise ToolError("state_corrupt", "canonical marker receipt schema is unsupported")
        if not _stored_toolbox_receipt_valid(receipt) or receipt.get("tool") != "state.time_marker":
            raise ToolError("state_corrupt", "canonical marker receipt integrity failed")
        head = receipt["entity_head"]
        if str(head.get("entity_id") or "") != marker_id:
            continue
        present = _operation_event_present(ctx, receipt)
        if require_event and not present:
            continue
        heads.append(deepcopy(head))
    return heads

def _latest_anchored_flag_head(
    ctx: Ctx, flags: dict[str, Any], flag_id: str, *, require_event: bool = True
) -> dict[str, Any] | None:
    return _unique_max_head(
        _anchored_flag_heads(
            ctx, flags, flag_id=flag_id, require_event=require_event
        ),
        entity_kind="flag",
        entity_id=flag_id,
    )

def _latest_anchored_marker_head(
    ctx: Ctx, payload: dict[str, Any], marker_id: str, *, require_event: bool = True
) -> dict[str, Any] | None:
    return _unique_max_head(
        _anchored_marker_heads(
            ctx, payload, marker_id=marker_id, require_event=require_event
        ),
        entity_kind="time_marker",
        entity_id=marker_id,
    )

def _marker_live_record(payload: dict[str, Any], marker_id: str) -> dict[str, Any]:
    markers = payload.get("markers")
    markers = markers if isinstance(markers, dict) else {}
    present = str(marker_id) in markers
    marker = markers.get(str(marker_id))
    return {
        "schema_version": 1,
        "marker_id": str(marker_id),
        "present": present,
        "marker": deepcopy(marker) if isinstance(marker, dict) else None,
    }

def _apply_marker_live_record(
    payload: dict[str, Any], record: dict[str, Any]
) -> None:
    marker_id = str(record.get("marker_id") or "")
    if not marker_id or record.get("schema_version") != 1:
        raise ToolError("state_corrupt", "invalid marker live record")
    markers = payload.get("markers")
    if not isinstance(markers, dict):
        raise ToolError("state_corrupt", "canonical marker map is invalid")
    if record.get("present") is True and isinstance(record.get("marker"), dict):
        markers[marker_id] = deepcopy(record["marker"])
    elif record.get("present") is False and record.get("marker") is None:
        markers.pop(marker_id, None)
    else:
        raise ToolError("state_corrupt", "invalid marker live record presence")

def _flag_receipt_rows(flags: dict[str, Any]) -> list[tuple[int, str, dict[str, Any]]]:
    rows: list[tuple[int, str, dict[str, Any]]] = []
    toolbox = ((flags.get(_SOURCE_RECEIPTS_KEY) or {}).get("state.set_flag") or {})
    if not isinstance(toolbox, dict):
        raise ToolError("state_corrupt", "canonical flag receipt map is invalid")
    for receipt in toolbox.values():
        if not isinstance(receipt, dict):
            raise ToolError("state_corrupt", "canonical flag receipt is invalid")
        if receipt.get("schema_version") != _SOURCE_RECEIPT_SCHEMA_VERSION:
            raise ToolError("state_corrupt", "canonical flag receipt schema is unsupported")
        if not _stored_toolbox_receipt_valid(receipt):
            raise ToolError("state_corrupt", "canonical flag receipt integrity failed")
        rows.append(
            (int(receipt["entity_head"]["source_sequence"]), "toolbox", receipt)
        )
    director = flags.get(coc_flag_state.DIRECTOR_FLAG_RECEIPTS_KEY) or {}
    if not coc_flag_state.valid_director_flag_receipt_map(director):
        raise ToolError("state_corrupt", "canonical director flag receipt map is invalid")
    for receipt in director.values():
        rows.append(
            (int(receipt["entity_head"]["source_sequence"]), "director", receipt)
        )
    return sorted(rows, key=lambda item: (item[0], str(item[2].get("event_id") or "")))

def _reconcile_all_flag_source_receipts(ctx: Ctx, flags: dict[str, Any]) -> None:
    """Repair every current flag receipt before a new decision can allocate."""
    entity_ids: set[str] = set()
    for _sequence, kind, receipt in _flag_receipt_rows(flags):
        if kind == "toolbox":
            _ensure_operation_event(ctx, receipt, inspect_pending=True)
            manifest = _source_receipt_manifest(receipt)
            prior = ctx.ledger_lookup("state.set_flag", str(receipt["decision_id"]))
            if (
                prior is None
                or prior.get("data") != receipt.get("data")
                or prior.get("source_receipt_manifest") != manifest
            ):
                ctx.ledger_record(
                    str(receipt["decision_id"]),
                    "state.set_flag",
                    deepcopy(receipt.get("data") or {}),
                    source_receipt_manifest=manifest,
                )
            entity_ids.add(str(receipt["entity_head"]["entity_id"]))
            continue
        event = receipt["event"]
        event_id = str(receipt["event_id"])
        _materialize_stable_receipt_event(
            ctx,
            event=event,
            event_id=event_id,
        )
        entity_ids.add(str(receipt["entity_head"]["entity_id"]))

    flag_map = flags.get("flags") or {}
    provenance_map = flags.get("flag_provenance") or {}
    head_map = flags.get("flag_heads") or {}
    if not all(
        isinstance(value, dict)
        for value in (flag_map, provenance_map, head_map)
    ):
        raise ToolError("state_corrupt", "canonical flag maps are invalid")
    if set(provenance_map) - set(flag_map):
        raise ToolError("state_corrupt", "canonical flag provenance has orphan entries")
    entity_ids.update(str(flag_id) for flag_id in flag_map)
    entity_ids.update(str(flag_id) for flag_id in head_map)
    for flag_id in entity_ids:
        expected = _latest_anchored_flag_head(ctx, flags, flag_id)
        current = head_map.get(flag_id)
        if expected is None:
            raise ToolError(
                "state_corrupt",
                f"flag '{flag_id}' has no current source receipt anchor",
            )
        if current != expected:
            raise ToolError(
                "state_corrupt",
                f"flag '{flag_id}' current head does not match its unique latest anchored receipt",
            )
        actual = coc_flag_state.flag_live_record(flags, flag_id)
        if actual != expected["live_record"]:
            if actual.get("present") is True:
                raise ToolError(
                    "state_corrupt",
                    f"flag '{flag_id}' current value does not match its anchored head",
                )
            try:
                coc_flag_state.apply_live_record(flags, expected["live_record"])
            except ValueError as exc:
                raise ToolError("state_corrupt", str(exc)) from exc
            ctx.save_flags(flags)

def _reconcile_all_marker_source_receipts(
    ctx: Ctx, payload: dict[str, Any]
) -> None:
    receipts = (
        (payload.get(_SOURCE_RECEIPTS_KEY) or {}).get("state.time_marker") or {}
    )
    if not isinstance(receipts, dict):
        raise ToolError("state_corrupt", "canonical marker receipt map is invalid")
    ordered: list[dict[str, Any]] = []
    for receipt in receipts.values():
        if not isinstance(receipt, dict):
            raise ToolError("state_corrupt", "canonical marker receipt is invalid")
        if receipt.get("schema_version") != _SOURCE_RECEIPT_SCHEMA_VERSION:
            raise ToolError("state_corrupt", "canonical marker receipt schema is unsupported")
        if not _stored_toolbox_receipt_valid(receipt):
            raise ToolError("state_corrupt", "canonical marker receipt integrity failed")
        ordered.append(receipt)
    ordered.sort(
        key=lambda receipt: (
            int(receipt["entity_head"]["source_sequence"]),
            str(receipt.get("event_id") or ""),
        )
    )
    entity_ids: set[str] = set()
    for receipt in ordered:
        _ensure_operation_event(ctx, receipt, inspect_pending=True)
        manifest = _source_receipt_manifest(receipt)
        prior = ctx.ledger_lookup("state.time_marker", str(receipt["decision_id"]))
        if (
            prior is None
            or prior.get("data") != receipt.get("data")
            or prior.get("source_receipt_manifest") != manifest
        ):
            ctx.ledger_record(
                str(receipt["decision_id"]),
                "state.time_marker",
                deepcopy(receipt.get("data") or {}),
                source_receipt_manifest=manifest,
            )
        entity_ids.add(str(receipt["entity_head"]["entity_id"]))
    markers = payload.get("markers") or {}
    head_map = payload.get("marker_heads") or {}
    if not isinstance(markers, dict) or not isinstance(head_map, dict):
        raise ToolError("state_corrupt", "canonical time marker maps are invalid")
    entity_ids.update(str(marker_id) for marker_id in markers)
    entity_ids.update(str(marker_id) for marker_id in head_map)
    for marker_id in entity_ids:
        expected = _latest_anchored_marker_head(ctx, payload, marker_id)
        current = head_map.get(marker_id)
        if expected is None:
            raise ToolError(
                "state_corrupt",
                f"time marker '{marker_id}' has no current source receipt anchor",
            )
        if current != expected:
            raise ToolError(
                "state_corrupt",
                f"time marker '{marker_id}' current head does not match its unique latest anchored receipt",
            )
        actual = _marker_live_record(payload, marker_id)
        if actual != expected["live_record"]:
            if actual.get("present") is True:
                raise ToolError(
                    "state_corrupt",
                    f"time marker '{marker_id}' current record does not match its anchored head",
                )
            _apply_marker_live_record(payload, expected["live_record"])
            _save_time_markers(ctx, payload)

def _reconcile_all_npc_presence_source_receipts(ctx: Ctx) -> None:
    """Finish durable presence receipts and verify their one live head.

    The presence record, head, and receipt share one atomic npc-state write;
    only append-only event and ledger materialization can remain after a
    crash.  A missing or divergent live record is therefore corruption, not
    an invitation to infer presence from engagement history.
    """
    document = _load_npc_presence_document(ctx)
    receipts = _npc_presence_receipts(document)
    ordered: list[dict[str, Any]] = []
    for receipt in receipts.values():
        if (
            not isinstance(receipt, dict)
            or not _stored_toolbox_receipt_valid(receipt)
            or receipt.get("tool") != "state.npc_presence"
        ):
            raise ToolError("state_corrupt", "canonical NPC presence receipt is invalid")
        operation = receipt.get("operation") or {}
        npc_id = str(operation.get("npc_id") or "")
        _validate_source_receipt(
            receipt,
            tool_name="state.npc_presence",
            decision_id=str(receipt.get("decision_id") or ""),
            operation=operation,
        )
        _validated_receipt_entity_head(
            receipt, entity_kind="npc_presence", entity_id=npc_id
        )
        ordered.append(receipt)
    ordered.sort(
        key=lambda receipt: (
            int(receipt["entity_head"]["source_sequence"]),
            str(receipt.get("event_id") or ""),
        )
    )
    for receipt in ordered:
        _ensure_operation_event(ctx, receipt, inspect_pending=True)
        manifest = _source_receipt_manifest(receipt)
        prior = ctx.ledger_lookup(
            "state.npc_presence", str(receipt["decision_id"])
        )
        if (
            prior is None
            or prior.get("data") != receipt.get("data")
            or prior.get("source_receipt_manifest") != manifest
        ):
            ctx.ledger_record(
                str(receipt["decision_id"]),
                "state.npc_presence",
                deepcopy(receipt.get("data") or {}),
                source_receipt_manifest=manifest,
            )

    presence = document["presence"]
    head_map = document["presence_heads"]
    entity_ids = {str(value) for value in presence} | {
        str(value) for value in head_map
    }
    max_sequence = 0
    for receipt in ordered:
        max_sequence = max(
            max_sequence, int(receipt["entity_head"]["source_sequence"])
        )
        entity_ids.add(str(receipt["entity_head"]["entity_id"]))
    if int(document["presence_source_sequence"]) != max_sequence:
        raise ToolError(
            "state_corrupt",
            "npc presence source sequence does not match its durable receipts",
        )
    for npc_id in entity_ids:
        expected = _latest_anchored_npc_presence_head(
            ctx, document, npc_id
        )
        if expected is None:
            raise ToolError(
                "state_corrupt",
                f"npc presence '{npc_id}' has no source receipt anchor",
            )
        if head_map.get(npc_id) != expected:
            raise ToolError(
                "state_corrupt",
                f"npc presence '{npc_id}' live head is not its latest receipt",
            )
        if _npc_presence_live_record(document, npc_id) != expected["live_record"]:
            raise ToolError(
                "state_corrupt",
                f"npc presence '{npc_id}' live record conflicts with its causal head",
            )

def reconcile_campaign_continuity(
    campaign_dir: Path | str,
    *,
    ctx: Ctx | None = None,
    domains: tuple[str, ...] | list[str] | set[str] | None = None,
) -> None:
    """Complete every durable continuity receipt at a turn/read boundary.

    Callers must hold the campaign lock.  Toolbox dispatch passes its existing
    context; the live-turn and Director apply entrypoints construct an
    equivalent context for the same canonical preflight.  Repair is limited to
    already-committed source receipts and therefore does not impose a
    narrative eligibility gate.
    """
    campaign = Path(campaign_dir)
    if ctx is None:
        ctx = object.__new__(Ctx)
        ctx.root = campaign.parent
        ctx.coc_root = (
            campaign.parents[1]
            if campaign.parent.name == "campaigns"
            else campaign.parent
        )
        ctx.campaign_id = coc_npc_event_chain.resolve_campaign_id(campaign)
        ctx.campaign_dir = campaign
        ctx._scenario_cache = {}
        ctx._roll_ids = None
        ctx._roll_sequence = 0
    elif Path(ctx.campaign_dir) != campaign:
        raise ToolError(
            "state_corrupt",
            "continuity preflight context does not match its campaign directory",
        )
    selected = (
        {"rolls", "flags", "time_markers", "npc", "npc_presence"}
        if domains is None
        else {str(value) for value in domains}
    )
    unknown = selected - {
        "rolls", "flags", "time_markers", "npc", "npc_presence",
    }
    if unknown:
        raise ToolError(
            "invalid_request",
            "unknown continuity recovery domain(s): " + ", ".join(sorted(unknown)),
        )
    if "rolls" in selected:
        _reconcile_all_roll_source_receipts(ctx)
    if "flags" in selected:
        flags = ctx.flags()
        _reconcile_all_flag_source_receipts(ctx, flags)
    if "time_markers" in selected and _time_markers_path(ctx).is_file():
        markers = _load_time_markers(ctx)
        _reconcile_all_marker_source_receipts(ctx, markers)
    if "npc" in selected and _npc_receipt_path(ctx).is_file():
        _reconcile_all_npc_source_receipts(ctx)
    if (
        "npc_presence" in selected
        and (ctx.campaign_dir / "save" / "npc-state.json").is_file()
    ):
        _reconcile_all_npc_presence_source_receipts(ctx)

def _world_flag_continuity(ctx: Ctx) -> dict[str, list[dict[str, Any]]]:
    """Project only current, source-anchored flag state and events."""
    flags_doc = ctx.flags()
    flag_map = flags_doc["flags"]
    head_map = flags_doc["flag_heads"]
    changes: list[dict[str, Any]] = []
    for _sequence, kind, receipt in _flag_receipt_rows(flags_doc):
        present = (
            _operation_event_present(ctx, receipt)
            if kind == "toolbox"
            else _director_receipt_event_present(ctx, receipt)
        )
        if not present:
            continue
        head = receipt["entity_head"]
        live_record = head["live_record"]
        provenance = deepcopy(live_record.get("provenance"))
        if not isinstance(provenance, dict):
            raise ToolError("state_corrupt", "current flag receipt has no provenance")
        provenance["integrity_status"] = "source_anchored"
        provenance["order_epoch"] = "sequenced-v1"
        changes.append({
            "flag_id": str(head["entity_id"]),
            "value": live_record.get("value"),
            "provenance": provenance,
        })

    live: list[dict[str, Any]] = []
    for flag_id, value in sorted(flag_map.items(), key=lambda pair: str(pair[0])):
        if type(value) is not bool:
            raise ToolError("state_corrupt", "current flag value must be boolean")
        stable_id = str(flag_id)
        expected = _latest_anchored_flag_head(ctx, flags_doc, stable_id)
        actual_record = coc_flag_state.flag_live_record(flags_doc, stable_id)
        if (
            expected is None
            or head_map.get(stable_id) != expected
            or actual_record != expected.get("live_record")
        ):
            raise ToolError(
                "state_corrupt",
                f"flag '{stable_id}' has no unique current source receipt/event anchor",
            )
        provenance = deepcopy(expected["live_record"].get("provenance"))
        if not isinstance(provenance, dict):
            raise ToolError("state_corrupt", f"flag '{stable_id}' provenance is missing")
        provenance["integrity_status"] = "source_anchored"
        live.append({
            "flag_id": stable_id,
            "value": value,
            "present": True,
            "provenance": provenance,
        })
    if set(head_map) != {str(flag_id) for flag_id in flag_map}:
        raise ToolError("state_corrupt", "current flag head map has orphan entries")
    return {
        "live_world_flags": live,
        "unverified_world_flags": [],
        "recent_world_flag_changes": changes[-12:],
    }

def _time_markers_path(ctx: Ctx) -> Path:
    return ctx.campaign_dir / "save" / "time-markers.json"

_TIME_MARKER_DOCUMENT_SCHEMA_VERSION = 3

_TIME_MARKER_DOCUMENT_FIELDS = frozenset({
    "schema_version",
    "markers",
    "marker_heads",
    "marker_source_sequence",
    _SOURCE_RECEIPTS_KEY,
})

def _load_time_markers(ctx: Ctx) -> dict[str, Any]:
    path = _time_markers_path(ctx)
    if not path.is_file():
        return {
            "schema_version": _TIME_MARKER_DOCUMENT_SCHEMA_VERSION,
            "markers": {},
            "marker_heads": {},
            "marker_source_sequence": 0,
            _SOURCE_RECEIPTS_KEY: {},
        }
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise ToolError(
            "state_corrupt",
            "save/time-markers.json is unreadable; refusing to replace it",
        ) from exc
    if (
        not isinstance(payload, dict)
        or set(payload) != set(_TIME_MARKER_DOCUMENT_FIELDS)
        or payload.get("schema_version") != _TIME_MARKER_DOCUMENT_SCHEMA_VERSION
        or not isinstance(payload.get("markers"), dict)
        or not isinstance(payload.get("marker_heads"), dict)
        or not isinstance(payload.get(_SOURCE_RECEIPTS_KEY), dict)
    ):
        raise ToolError(
            "state_corrupt",
            "save/time-markers.json does not match the current schema-v3 document",
        )
    markers = payload["markers"]
    marker_heads = payload["marker_heads"]
    for marker_id, head in marker_heads.items():
        if not coc_flag_state.valid_entity_head(
            head, entity_kind="time_marker", entity_id=str(marker_id)
        ):
            raise ToolError(
                "state_corrupt",
                f"save/time-markers.json has an invalid live head for marker '{marker_id}'",
            )
    marker_sequence = payload["marker_source_sequence"]
    if (
        not isinstance(marker_sequence, int)
        or isinstance(marker_sequence, bool)
        or marker_sequence < 0
    ):
        raise ToolError(
            "state_corrupt",
            "save/time-markers.json has an invalid marker_source_sequence",
        )
    receipts = payload[_SOURCE_RECEIPTS_KEY]
    for tool_name, tool_receipts in receipts.items():
        if tool_name != "state.time_marker" or not isinstance(tool_receipts, dict):
            raise ToolError(
                "state_corrupt",
                f"save/time-markers.json has invalid receipts for {tool_name}",
            )
        for decision_id, receipt in tool_receipts.items():
            if (
                not _stored_toolbox_receipt_valid(receipt)
                or receipt.get("tool") != tool_name
                or str(receipt.get("decision_id") or "") != str(decision_id)
            ):
                raise ToolError(
                    "state_corrupt",
                    f"save/time-markers.json has an invalid current receipt for {tool_name}",
                )
    return payload

def _save_time_markers(ctx: Ctx, payload: dict[str, Any]) -> None:
    coc_state.write_json_atomic(_time_markers_path(ctx), payload)

def _project_time_marker(
    marker: dict[str, Any],
    current: dict[str, Any],
) -> dict[str, Any]:
    due_at = marker.get("due_at") if isinstance(marker.get("due_at"), dict) else {}
    status = str(marker.get("status") or "active")
    remaining: int | None = None
    if due_at.get("elapsed_minutes") is not None:
        try:
            remaining = int(due_at["elapsed_minutes"]) - int(
                current.get("elapsed_minutes") or 0
            )
        except (TypeError, ValueError):
            remaining = None
    if status != "active":
        timing_state = status
    elif remaining is None:
        timing_state = "unknown"
    elif remaining < 0:
        timing_state = "overdue"
    elif remaining == 0:
        timing_state = "due"
    else:
        timing_state = "pending"
    return {
        "marker_id": marker.get("marker_id"),
        "label": marker.get("label"),
        "status": status,
        "revision": int(marker.get("revision") or 1),
        "due_at": deepcopy(due_at),
        "current_time": deepcopy(current),
        "remaining_minutes": remaining,
        "overdue": bool(status == "active" and remaining is not None and remaining < 0),
        "timing_state": timing_state,
        "provenance": {
            "source": "state.time_marker",
            "producer": marker.get("producer"),
            "decision_id": marker.get("decision_id"),
            "source_sequence": marker.get("source_sequence"),
            "created_at": marker.get("created_at"),
            "updated_at": marker.get("updated_at"),
            "reason": marker.get("reason"),
            "integrity_status": "source_anchored",
        },
    }

def _active_time_markers(ctx: Ctx) -> list[dict[str, Any]]:
    current = coc_time.current_stamp(ctx.campaign_dir)
    payload = _load_time_markers(ctx)
    markers = payload.get("markers") or {}
    heads = payload.get("marker_heads") or {}
    if not isinstance(markers, dict) or not isinstance(heads, dict):
        raise ToolError("state_corrupt", "canonical time marker maps are invalid")
    active: list[dict[str, Any]] = []
    for marker_id, marker in markers.items():
        if not isinstance(marker, dict) or marker.get("status") != "active":
            continue
        stable_id = str(marker_id)
        expected = _latest_anchored_marker_head(ctx, payload, stable_id)
        current_head = heads.get(stable_id)
        if expected is None:
            if current_head is not None:
                raise ToolError(
                    "state_corrupt",
                    f"time marker '{stable_id}' has a typed head without an exact source receipt/event anchor",
                )
            raise ToolError(
                "state_corrupt",
                f"time marker '{stable_id}' has no current source receipt/event anchor",
            )
        live_record = _marker_live_record(payload, stable_id)
        if current_head != expected or expected.get("live_record") != live_record:
            raise ToolError(
                "state_corrupt",
                f"time marker '{stable_id}' current deadline does not equal its unique latest anchored receipt head",
            )
        active.append(_project_time_marker(marker, current))
    return sorted(
        active,
        key=lambda marker: (
            int((marker.get("due_at") or {}).get("elapsed_minutes") or 0),
            str(marker.get("marker_id") or ""),
        ),
    )

def _combat_state(ctx: Ctx) -> dict[str, Any]:
    return _read_object(ctx.campaign_dir / "save" / "combat.json")

def _player_mechanical_snapshot(ctx: Ctx, investigator_id: str) -> dict[str, Any]:
    state = ctx.inv_state(investigator_id)
    return {
        "investigator_id": investigator_id,
        "hp": state.get("current_hp"),
        "san": state.get("current_san"),
        "mp": state.get("current_mp"),
        "luck": state.get("current_luck"),
        "conditions": list(state.get("conditions") or []),
    }

def _player_state_receipt(
    before: dict[str, Any],
    after: dict[str, Any],
    *,
    ammo_before: dict[str, dict[str, Any]] | None = None,
    ammo_after: dict[str, dict[str, Any]] | None = None,
) -> dict[str, Any]:
    receipt = {
        "schema_version": 1,
        "investigator_id": str(before["investigator_id"]),
        "hp": {"before": before.get("hp"), "after": after.get("hp")},
        "san": {"before": before.get("san"), "after": after.get("san")},
        "mp": {"before": before.get("mp"), "after": after.get("mp")},
        "luck": {"before": before.get("luck"), "after": after.get("luck")},
        "conditions_before": list(before.get("conditions") or []),
        "conditions_after": list(after.get("conditions") or []),
        "loaded_ammunition": [],
    }
    before_map = ammo_before or {}
    after_map = ammo_after or {}
    for weapon_id in sorted(set(before_map) | set(after_map)):
        old = before_map.get(weapon_id) or after_map[weapon_id]
        new = after_map.get(weapon_id) or before_map[weapon_id]
        receipt["loaded_ammunition"].append({
            "weapon_id": weapon_id,
            "weapon_label": str(new.get("weapon_label") or old.get("weapon_label") or weapon_id),
            "before": int(old["loaded"]),
            "change": int(new["loaded"]) - int(old["loaded"]),
            "after": int(new["loaded"]),
            "scope": "current_loaded_magazine_only",
        })
    return receipt

def _affordance_by_id(scene: dict[str, Any] | None, affordance_id: str) -> dict[str, Any] | None:
    for affordance in (scene or {}).get("affordances") or []:
        if (
            isinstance(affordance, dict)
            and str(affordance.get("id")) == str(affordance_id)
        ):
            return affordance
    return None

_CHARACTERISTIC_NAMES = {"STR", "CON", "SIZ", "DEX", "APP", "INT", "POW", "EDU", "LUCK"}

def _canonical_skill_selector(
    ctx: Ctx, investigator_id: str, skill: str
) -> str:
    """Resolve a skill's structured, case-insensitive semantic identity."""
    stripped = str(skill).strip()
    if not stripped:
        return ""
    compact = _compact_skill_fold(stripped)
    # Bare Fighting/Firearms names are attack family selectors and stay on
    # combat.resolve. Compact specializations (fighting(brawl), firearms(handgun))
    # fold as ordinary skill identities for non-attack core-checks.
    if compact in {"fighting", "firearms"}:
        raise ToolError(
            "use_combat_resolve",
            "attacks and firearm shots must use combat.resolve with an owned "
            "weapon_id or inventory item_id; do not roll Firearms/Fighting via "
            "rules.roll or narrate hit/damage without a combat receipt",
        )
    sheet = ctx.sheet(investigator_id)
    skills = sheet.get("skills") or {}
    if not isinstance(skills, dict):
        raise ToolError("state_corrupt", "investigator skill map is invalid")
    if stripped in skills:
        return stripped
    folded = stripped.casefold()
    matches = [
        str(key)
        for key in skills
        if isinstance(key, str) and key.casefold() == folded
    ]
    if len(matches) > 1:
        raise ToolError(
            "state_corrupt",
            f"investigator skill map has ambiguous selector '{stripped}'",
        )
    if matches:
        return matches[0]
    compact = _compact_skill_fold(stripped)
    matches = [
        str(key)
        for key in skills
        if isinstance(key, str) and _compact_skill_fold(key) == compact
    ]
    if len(matches) > 1:
        raise ToolError(
            "state_corrupt",
            f"investigator skill map has ambiguous selector '{stripped}'",
        )
    if matches:
        return matches[0]
    catalog = _skill_catalog()
    for canonical in catalog:
        if _compact_skill_fold(canonical) == compact:
            return canonical
    for canonical, spec in catalog.items():
        labels = spec.get("localized_labels")
        alias = labels.get("zh-Hans") if isinstance(labels, dict) else None
        if not isinstance(alias, str) or not alias.strip():
            continue
        alias = alias.strip()
        if alias.casefold() != folded and _compact_skill_fold(alias) != compact:
            continue
        sheet_matches = [
            str(key)
            for key in skills
            if isinstance(key, str)
            and _compact_skill_fold(key) == _compact_skill_fold(canonical)
        ]
        if len(sheet_matches) > 1:
            raise ToolError(
                "state_corrupt",
                f"investigator skill map has ambiguous selector '{stripped}'",
            )
        if sheet_matches:
            return sheet_matches[0]
        return canonical
    cname = stripped.upper()
    if cname in _CHARACTERISTIC_NAMES:
        return cname
    raise ToolError(
        "unknown_skill",
        f"unknown skill: {stripped}",
    )

def _resolve_target_value(
    ctx: Ctx,
    investigator_id: str,
    args: dict[str, Any],
) -> tuple[int, str, str]:
    """Resolve the percentile target from explicit value, skill, or characteristic."""
    skill = (
        _canonical_skill_selector(ctx, investigator_id, str(args["skill"]))
        if args.get("skill") is not None and str(args["skill"]).strip()
        else None
    )
    characteristic = (
        str(args["characteristic"]).strip().upper()
        if args.get("characteristic") is not None
        and str(args["characteristic"]).strip()
        else None
    )
    if args.get("target") is not None:
        return (
            int(args["target"]),
            str(skill or characteristic or "explicit target"),
            "explicit",
        )
    sheet = ctx.sheet(investigator_id)
    if characteristic:
        cname = characteristic
        if cname == "SAN":
            return int(ctx.inv_state(investigator_id).get("current_san", 0)), "SAN", "state"
        if cname == "LUCK":
            return int(ctx.inv_state(investigator_id).get("current_luck", 0)), "LUCK", "state"
        value = (sheet.get("characteristics") or {}).get(cname)
        if value is None:
            raise ToolError("unknown_characteristic", f"{cname} not on sheet")
        return int(value), cname, "sheet"
    if not skill:
        raise ToolError("missing_param", "provide skill, characteristic, or target")
    skills = sheet.get("skills") or {}
    if skill in skills:
        return int(skills[skill]), str(skill), "sheet"
    cname = str(skill).upper()
    if cname in _CHARACTERISTIC_NAMES:
        value = (sheet.get("characteristics") or {}).get(cname)
        if value is not None:
            return int(value), cname, "sheet"
    base = _canonical_skill_base(skill)
    if base is not None:
        canonical, value = base
        return value, canonical, "rulebook_base"
    raise ToolError("unknown_skill", f"skill not on sheet: {skill}")

def _combined_target_uses_dedicated_surface(label: str) -> str | None:
    """Name a rules.roll surface that one combined target may not replace."""
    if _matches_canonical_skill_identity(label, "Psychology"):
        return "rules.psychology_observe"
    compact = _compact_skill_fold(label)
    if compact in {"dodge", "闪避", "fighting", "firearms"}:
        return "combat.resolve"
    for canonical in _skill_catalog():
        if not canonical.startswith(("Fighting (", "Firearms (")):
            continue
        if _matches_canonical_skill_identity(label, canonical):
            return "combat.resolve"
    return None

def _normalize_combined_targets(value: Any) -> list[dict[str, Any]]:
    """Validate model-authored semantic labels and numeric target values."""
    rule = coc_rules.combined_roll_rule()
    minimum = int(rule["minimum_compared_targets"])
    if not isinstance(value, list) or len(value) < minimum:
        raise ToolError(
            "invalid_param",
            f"combined_targets must contain at least {minimum} target objects",
        )
    if len(value) > 8:
        raise ToolError("invalid_param", "combined_targets supports at most 8 targets")
    normalized: list[dict[str, Any]] = []
    labels: set[str] = set()
    for index, raw in enumerate(value):
        if not isinstance(raw, dict) or set(raw) != set(_COMBINED_TARGET_FIELDS):
            raise ToolError(
                "invalid_param",
                f"combined_targets[{index}] must be exactly {{label, value}}",
            )
        label = raw.get("label")
        target = raw.get("value")
        if (
            not isinstance(label, str)
            or not label.strip()
            or len(label.strip()) > 120
        ):
            raise ToolError(
                "invalid_param",
                f"combined_targets[{index}].label must be a non-empty semantic label",
            )
        label = label.strip()
        folded = _compact_skill_fold(label)
        if folded in labels:
            raise ToolError(
                "invalid_param", "combined_targets labels must be unique"
            )
        labels.add(folded)
        if not _is_exact_int(target) or not 1 <= target <= 100:
            raise ToolError(
                "invalid_param",
                f"combined_targets[{index}].value must be an integer from 1 to 100",
            )
        dedicated = _combined_target_uses_dedicated_surface(label)
        if dedicated is not None:
            raise ToolError(
                "invalid_param",
                f"combined target {label!r} must use {dedicated}; rules.roll "
                "combined mode is non-combat and non-Psychology",
            )
        normalized.append({"label": label, "value": int(target)})
    return normalized

def _combined_roll_label(targets: list[dict[str, Any]]) -> str:
    return "Combined: " + " / ".join(str(row["label"]) for row in targets)

def _combined_roll_projection(
    targets: list[dict[str, Any]],
    *,
    roll: int,
    required_level: str,
    comparison_mode: str,
) -> dict[str, Any]:
    """Project many target verdicts from the existing one-roll settlement."""
    comparisons: list[dict[str, Any]] = []
    for target in targets:
        settled = coc_roll.resolve_percentile_roll(
            roll, int(target["value"]), required_level
        )
        comparisons.append({
            "label": str(target["label"]),
            "value": int(target["value"]),
            "required_target": int(settled["required_target"]),
            "achieved_level": str(settled["achieved_level"]),
            "outcome": str(settled["outcome"]),
            "success": bool(settled["success"]),
        })
    if comparison_mode not in {"any", "all"}:
        raise ToolError("invalid_param", "combined_mode must be any or all")
    overall_success = (
        any(row["success"] for row in comparisons)
        if comparison_mode == "any"
        else all(row["success"] for row in comparisons)
    )
    return {
        "rule_ref": "core.combined_roll",
        "roll_count": 1,
        "comparison_mode": comparison_mode,
        "targets": comparisons,
        "overall_success": overall_success,
        "development_tick_eligible": False,
        "push_eligible": False,
        "luck_spend_eligible": False,
    }

def _normalize_percentile_invocation(
    args: dict[str, Any],
    *,
    pushed: bool,
    frozen_operation: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Normalize immutable caller fields without consulting mutable state."""
    if pushed:
        supplied_inherited = sorted(
            field for field in _PUSH_INHERITED_ARGUMENTS if field in args
        )
        if supplied_inherited:
            raise ToolError(
                "invalid_param",
                "rules.push inherits the original check contract; remove: "
                + ", ".join(supplied_inherited),
            )
        if not isinstance(frozen_operation, dict):
            raise ToolError(
                "missing_original_check",
                "rules.push requires a valid original rules.roll receipt",
            )
        original_check_decision_id = str(
            args.get("original_check_decision_id") or ""
        ).strip()
        if not original_check_decision_id:
            raise ToolError(
                "missing_param", "required parameter: original_check_decision_id"
            )
        method_changed = str(args.get("method_changed") or "").strip()
        failure_consequence = str(
            args.get("failure_consequence") or ""
        ).strip()
        if not method_changed or not failure_consequence:
            raise ToolError(
                "invalid_param",
                "rules.push requires non-empty method_changed and failure_consequence",
            )
        fumble_consequence = (
            str(args["fumble_consequence"]).strip()
            if args.get("fumble_consequence") is not None
            else ""
        ) or None
        operation = {
            field: deepcopy(frozen_operation.get(field))
            for field in _PUSH_INHERITED_OPERATION_FIELDS
        }
        operation.update({
            "fumble_consequence": fumble_consequence,
            "pushed": True,
            "method_changed": method_changed,
            "failure_consequence": failure_consequence,
            "original_check_decision_id": original_check_decision_id,
        })
        return operation

    raw_investigator = args.get("investigator")
    investigator = (
        str(raw_investigator).strip()
        if raw_investigator is not None and str(raw_investigator).strip()
        else None
    )
    raw_skill = args.get("skill")
    skill = None
    if raw_skill is not None and str(raw_skill).strip():
        stripped_skill = str(raw_skill).strip()
        hinted_skill = (
            frozen_operation.get("skill")
            if isinstance(frozen_operation, dict)
            else None
        )
        if (
            isinstance(hinted_skill, str)
            and hinted_skill
            and hinted_skill.casefold() == stripped_skill.casefold()
        ):
            skill = hinted_skill
        else:
            skill = stripped_skill
    raw_characteristic = args.get("characteristic")
    characteristic = (
        str(raw_characteristic).strip().upper()
        if raw_characteristic is not None and str(raw_characteristic).strip()
        else None
    )
    explicit_target = args.get("target")
    if explicit_target is not None and not _is_exact_int(explicit_target):
        raise ToolError("invalid_param", "target must be an integer")
    required_level = str(args.get("difficulty") or "").strip()
    bonus = args.get("bonus", 0)
    penalty = args.get("penalty", 0)
    if not _is_exact_int(bonus) or not _is_exact_int(penalty):
        raise ToolError("invalid_param", "bonus and penalty must be integers")
    raw_stakes = args.get("stakes")
    if (
        not isinstance(raw_stakes, dict)
        or set(raw_stakes) != {"on_success", "on_failure"}
        or any(
            not isinstance(raw_stakes.get(key), str)
            or not raw_stakes[key].strip()
            for key in ("on_success", "on_failure")
        )
    ):
        raise ToolError(
            "invalid_param",
            "stakes must be an object with non-empty on_success and on_failure strings",
        )
    goal = str(args.get("goal") or "").strip()
    difficulty_basis = str(args.get("difficulty_basis") or "").strip()
    reason = (
        str(args["reason"]).strip()
        if args.get("reason") is not None
        else ""
    ) or None
    fumble_consequence = (
        str(args["fumble_consequence"]).strip()
        if args.get("fumble_consequence") is not None
        else ""
    ) or None
    npc_id = (
        str(args["npc_id"]).strip()
        if args.get("npc_id") is not None
        else ""
    ) or None
    visibility = str(args.get("visibility") or "public").strip() or "public"
    if visibility not in {"public", "keeper_only"}:
        raise ToolError(
            "invalid_param", "visibility must be public or keeper_only"
        )
    social_adjudication_ref = (
        str(args.get("social_adjudication_ref") or "").strip() or None
    )
    operation = {
        "investigator": investigator,
        "skill": skill,
        "characteristic": characteristic,
        "explicit_target": explicit_target,
        "required_level": required_level,
        "bonus": bonus,
        "penalty": penalty,
        "goal": goal,
        "stakes": {
            "on_success": raw_stakes["on_success"].strip(),
            "on_failure": raw_stakes["on_failure"].strip(),
        },
        "difficulty_basis": difficulty_basis,
        "reason": reason,
        "fumble_consequence": fumble_consequence,
        "pushed": False,
        "method_changed": None,
        "failure_consequence": None,
        "original_check_decision_id": None,
        "npc_id": npc_id,
        "visibility": visibility,
        "social_adjudication_ref": social_adjudication_ref,
    }
    if "combined_targets" in args:
        if "helper_count" in args:
            raise ToolError(
                "invalid_param",
                "helper_count is not part of source-backed combined skill rolls",
            )
        if any(
            args.get(field) not in (None, "")
            for field in ("skill", "characteristic", "target", "npc_id", "social_adjudication_ref")
        ):
            raise ToolError(
                "invalid_param",
                "combined_targets cannot be mixed with skill, characteristic, target, "
                "npc_id, or social_adjudication_ref",
            )
        if bonus != 0 or penalty != 0:
            raise ToolError(
                "invalid_param",
                "combined rolls use one unmodified D100; do not pass bonus or penalty",
            )
        if visibility != "public":
            raise ToolError(
                "invalid_param", "combined rolls must keep their one receipt public"
            )
        targets = _normalize_combined_targets(args.get("combined_targets"))
        comparison_mode = args.get("combined_mode")
        if comparison_mode not in {"any", "all"}:
            raise ToolError(
                "invalid_param",
                "combined_mode=any|all is required with combined_targets",
            )
        operation.update({
            "explicit_target": max(int(row["value"]) for row in targets),
            "bonus": 0,
            "penalty": 0,
            "combined_targets": targets,
            "combined_mode": comparison_mode,
        })
    elif "helper_count" in args or "combined_mode" in args:
        raise ToolError(
            "invalid_param", "combined-only arguments require combined_targets"
        )
    if (
        isinstance(frozen_operation, dict)
        and "npc_id" not in frozen_operation
        and npc_id is None
    ):
        operation.pop("npc_id")
    return operation

def _compile_new_percentile_invocation(
    ctx: Ctx,
    args: dict[str, Any],
    *,
    pushed: bool,
    document: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Resolve mutable investigator/target state only for an unowned decision."""
    if pushed:
        original_check_decision_id = str(
            args.get("original_check_decision_id") or ""
        ).strip()
        original = _roll_receipt(
            document, "rules.roll", original_check_decision_id
        )
        if original is None:
            raise ToolError(
                "unknown_original_check",
                "rules.push original_check_decision_id must name a settled rules.roll",
            )
        _validate_roll_receipt(
            original,
            tool_name="rules.roll",
            decision_id=original_check_decision_id,
        )
        if original.get("operation", {}).get("combined_targets") is not None:
            raise ToolError(
                "invalid_push",
                "combined skill rolls cannot be pushed; settle a new fictional "
                "approach through its appropriate canonical rule instead",
            )
        existing_pushes = (
            document.get("receipts", {}).get("rules.push") or {}
        )
        already_pushed = any(
            isinstance(existing, dict)
            and existing.get("operation", {}).get(
                "original_check_decision_id"
            )
            == original_check_decision_id
            for existing in existing_pushes.values()
        )
        push_verdict = _rules_resolver(ctx, "push_policy").push_policy(
            original["data"].get("outcome"), already_pushed
        )
        if push_verdict is not None:
            raise ToolError("invalid_push", push_verdict)
        operation = _normalize_percentile_invocation(
            args,
            pushed=True,
            frozen_operation=original["operation"],
        )
        resolution = {
            key: deepcopy(original["resolution"][key])
            for key in (
                "investigator_id",
                "resolved_label",
                "resolved_target",
                "target_source",
            )
        }
        resolution["original_check_ref"] = {
            "tool": "rules.roll",
            "decision_id": original_check_decision_id,
            "roll_id": str(original["roll_id"]),
            "integrity_digest": str(
                original[_SOURCE_RECEIPT_INTEGRITY_KEY]
            ),
        }
        return operation, resolution

    operation = _normalize_percentile_invocation(args, pushed=False)
    required_level = str(operation["required_level"])
    bonus = int(operation["bonus"])
    penalty = int(operation["penalty"])
    if required_level not in {"regular", "hard", "extreme"}:
        raise ToolError(
            "invalid_param", f"unsupported difficulty: {required_level}"
        )
    if not 0 <= bonus <= 2 or not 0 <= penalty <= 2:
        raise ToolError(
            "invalid_param", "bonus and penalty must be integers from 0 to 2"
        )
    if not operation["goal"]:
        raise ToolError("invalid_param", "goal must be a non-empty string")
    if operation["difficulty_basis"] not in _DIFFICULTY_BASIS_VALUES:
        raise ToolError(
            "invalid_param",
            "difficulty_basis must be a plain string, one of: "
            + ", ".join(sorted(_DIFFICULTY_BASIS_VALUES))
            + " (not an object/dict — just the string value)",
        )
    investigator_id = _resolve_investigator(
        ctx, {"investigator": operation["investigator"]}
    )
    combined_targets = operation.get("combined_targets")
    if isinstance(operation.get("skill"), str) and operation.get("skill"):
        operation["skill"] = _canonical_skill_selector(
            ctx, investigator_id, str(operation["skill"])
        )
    if isinstance(combined_targets, list):
        target = int(operation["explicit_target"])
        label = _combined_roll_label(combined_targets)
        target_source = "combined_targets"
    else:
        normalized = {
            "investigator": operation["investigator"],
            "skill": operation["skill"],
            "characteristic": operation["characteristic"],
            "target": operation["explicit_target"],
        }
        target, label, target_source = _resolve_target_value(
            ctx, investigator_id, normalized
        )
    resolution = {
        "investigator_id": investigator_id,
        "resolved_label": label,
        "resolved_target": target,
        "target_source": target_source,
        "original_check_ref": None,
    }
    modifier = _matching_active_exceptional_modifier(
        ctx,
        investigator_id=investigator_id,
        skill=label,
        npc_id=operation.get("npc_id"),
    )
    if modifier is not None:
        expected_key = (
            "bonus" if modifier["effect_kind"] == "bonus_die" else "penalty"
        )
        opposite_key = "penalty" if expected_key == "bonus" else "bonus"
        dice = int(modifier["mechanics"]["dice"])
        if int(operation[expected_key]) != dice or int(operation[opposite_key]) != 0:
            raise ToolError(
                "exceptional_modifier_required",
                f"active {modifier['effect_kind']} {modifier['effect_id']} requires "
                f"{expected_key}={dice}, {opposite_key}=0 on this next matching check",
            )
    # ``seed`` is intentionally absent: it is tests-only RNG transport.
    return operation, resolution

def _mark_improvement_tick(
    ctx: Ctx,
    investigator_id: str,
    skill: str,
    roll_result: dict[str, Any],
    *,
    source_event_id: str,
    source_kind: str,
    character_snapshot: dict[str, Any] | None = None,
) -> bool:
    tick = coc_development.record_skill_tick(
        ctx.campaign_dir,
        investigator_id,
        skill,
        roll_result,
        source_event_id=source_event_id,
        source_kind=source_kind,
    )
    if tick is None:
        return False
    if tick.get("development_event_status") == "already_claimed":
        return False
    state = ctx.inv_state(
        investigator_id, character_snapshot=character_snapshot
    )
    events = state.get("skill_check_events")
    if not isinstance(events, list):
        events = []
    token = tick["event_token"]
    if not any(
        isinstance(row, dict) and row.get("event_token") == token
        for row in events
    ):
        events.append({
            "event_token": token,
            "skill": skill,
            "campaign_id": tick["campaign_id"],
            "session_id": tick["session_id"],
            "source_kind": tick["source_kind"],
            "source_event_id": tick["source_event_id"],
        })
    state["skill_check_events"] = events
    state["skill_checks_earned"] = list(dict.fromkeys(
        str(row.get("skill"))
        for row in events
        if isinstance(row, dict) and isinstance(row.get("skill"), str)
    ))
    ctx.save_inv_state(investigator_id, state)
    return True

_ROLL_RESOLUTION_CONTEXT_TEXT_FIELDS = (
    "attempt_id", "scene_id", "route_id", "roll_density_group",
)

def _current_elapsed_minutes(ctx: Ctx) -> int | None:
    try:
        value = coc_time.current_stamp(ctx.campaign_dir).get("elapsed_minutes")
    except (OSError, ValueError, TypeError):
        return None
    return value if isinstance(value, int) and not isinstance(value, bool) else None

def _normalize_roll_resolution_context(
    value: Any,
) -> tuple[dict[str, Any] | None, list[str]]:
    """Normalize KP-supplied attempt identity without interpreting its prose.

    This context is advisory continuity data.  Invalid optional fields are
    ignored with warnings; they never deny the action or suppress a die roll.
    """
    if value is None:
        return None, []
    if not isinstance(value, dict):
        return None, [
            "resolution_context was not an object; ignored without blocking the roll"
        ]
    context: dict[str, Any] = {"schema_version": 1, "hard_gate": False}
    warnings: list[str] = []
    for field in _ROLL_RESOLUTION_CONTEXT_TEXT_FIELDS:
        raw = value.get(field)
        if raw is None:
            continue
        text = str(raw).strip()
        if not text:
            warnings.append(
                f"resolution_context.{field} was blank and was ignored"
            )
            continue
        context[field] = text[:240]
    if "attempt_id" not in context and context.get("roll_density_group"):
        context["attempt_id"] = str(context["roll_density_group"])
    reset = value.get("reset_evidence")
    if reset is not None:
        if not isinstance(reset, dict):
            warnings.append(
                "resolution_context.reset_evidence was not an object and was ignored"
            )
        else:
            reason = str(reset.get("reason") or "").strip()
            if not reason:
                warnings.append(
                    "resolution_context.reset_evidence needs a semantic reason and was ignored"
                )
            else:
                context["reset_evidence"] = {
                    "kind": str(reset.get("kind") or "fiction_changed").strip()[:120],
                    "reason": reason[:1000],
                }
                for field in (
                    "elapsed_minutes", "source_attempt_elapsed_minutes",
                ):
                    number = reset.get(field)
                    if isinstance(number, int) and not isinstance(number, bool):
                        context["reset_evidence"][field] = number
                for field in ("policy_mode", "source_attempt_id"):
                    text = str(reset.get(field) or "").strip()
                    if text:
                        context["reset_evidence"][field] = text[:240]
    if len(context) == 2:
        return None, warnings
    return context, warnings

def _route_roll_context(
    ctx: Ctx, context: dict[str, Any] | None,
) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    if not isinstance(context, dict):
        return None, None
    scene_id = str(context.get("scene_id") or "").strip()
    route_id = str(context.get("route_id") or "").strip()
    if not scene_id or not route_id:
        return None, None
    scene = _scene_by_id(ctx.story_graph, scene_id)
    return scene, _affordance_by_id(scene, route_id)

def _route_retry_status(
    ctx: Ctx,
    route: dict[str, Any] | None,
    context: dict[str, Any],
) -> dict[str, Any]:
    gate = route.get("roll_gate") if isinstance(route, dict) else None
    policy = gate.get("retry_policy") if isinstance(gate, dict) else None
    base = {
        "schema_version": 1,
        "authority": "advisory",
        "hard_gate": False,
        "eligible": False,
        "policy": deepcopy(policy) if isinstance(policy, dict) else None,
    }
    if not isinstance(policy, dict):
        return {
            **base,
            "status": "no_authored_reset_policy",
            "reason": "Use the open Push, change method or goal, or let the failed consequence stand.",
        }
    if policy.get("mode") != "elapsed_time_reset":
        return {**base, "status": "unsupported_authored_policy"}
    minimum = policy.get("minimum_elapsed_minutes")
    started = context.get("attempt_started_elapsed_minutes")
    current = _current_elapsed_minutes(ctx)
    if (
        not isinstance(minimum, int) or isinstance(minimum, bool)
        or not isinstance(started, int) or isinstance(started, bool)
        or current is None
    ):
        return {
            **base,
            "status": "insufficient_structured_time_evidence",
            "current_elapsed_minutes": current,
            "attempt_started_elapsed_minutes": started,
        }
    elapsed = max(0, current - started)
    eligible = elapsed >= minimum
    return {
        **base,
        "status": "eligible" if eligible else "waiting",
        "eligible": eligible,
        "elapsed_minutes": elapsed,
        "remaining_minutes": max(0, minimum - elapsed),
        "current_elapsed_minutes": current,
        "attempt_started_elapsed_minutes": started,
        "reset_evidence": (
            {
                "kind": "authored_elapsed_time_reset",
                "reason": (
                    f"Authored retry policy permits a fresh attempt after {minimum} elapsed minutes; "
                    f"canonical campaign time advanced by {elapsed} minutes."
                ),
                "elapsed_minutes": elapsed,
                "source_attempt_elapsed_minutes": started,
                "policy_mode": "elapsed_time_reset",
                "source_attempt_id": str(context.get("attempt_id") or ""),
            }
            if eligible else None
        ),
    }

def _settle_contextual_route(
    ctx: Ctx,
    context: dict[str, Any] | None,
    *,
    decision_id: str,
    source_tool: str,
    successful: bool,
    committed_clue_ids: list[str] | None = None,
) -> tuple[dict[str, Any] | None, list[str]]:
    """Project an exact structured settlement into the authored route ledger.

    Unknown, stale, repeatable, or incomplete route references degrade to
    warnings.  They never roll back the underlying clue or rules settlement.
    """
    scene, route = _route_roll_context(ctx, context)
    if scene is None or route is None:
        if isinstance(context, dict) and context.get("route_id"):
            return None, [
                "resolution_context route_ref was unavailable; the underlying settlement remains valid"
            ]
        return None, []
    scene_id = str(scene.get("scene_id") or context.get("scene_id") or "")
    route_id = str(route.get("id") or route.get("route_id") or "")
    if (
        route.get("repeatable") is True
        or str(route.get("status") or "") in {"repeatable", "resume"}
        or str(route.get("completion_policy") or "") == "repeatable"
    ):
        return None, []
    world = ctx.world()
    receipts = [
        deepcopy(row) for row in world.get("route_completion_receipts") or []
        if isinstance(row, dict)
    ]
    existing = next(
        (
            row for row in receipts
            if str(row.get("route_id") or "") == route_id
            and str(row.get("scene_id") or scene_id) == scene_id
            and row.get("status") in {"consumed", "blocked"}
        ),
        None,
    )
    if existing is not None:
        return deepcopy(existing), []
    completed = coc_action_resolver._route_receipt_ids(
        world, scene_id, "consumed"
    )
    required = {
        str(value).strip()
        for value in route.get("requires_completed_route_ids") or []
        if str(value or "").strip()
    }
    semantic_completion = context.get("semantic_completion") is True
    route_warnings: list[str] = []
    if not required.issubset(completed):
        if not semantic_completion:
            return None, [
                f"route '{route_id}' prerequisites are not yet settled; kept the result but left the route open"
            ]
        route_warnings.append(
            f"route '{route_id}' was completed by explicit KP semantic judgment despite unmet authored route prerequisites"
        )
    grants = coc_action_resolver._affordance_clue_ids(route)
    discovered = {
        str(value) for value in world.get("discovered_clue_ids") or [] if value
    }
    committed = [
        str(value) for value in committed_clue_ids or [] if str(value) in grants
    ]
    if grants:
        complete = set(grants).issubset(discovered)
    else:
        complete = bool(
            successful
            and (
                isinstance(route.get("roll_gate"), dict)
                or semantic_completion
            )
        )
    if not complete:
        return None, route_warnings
    completion = {
        "schema_version": 1,
        "route_id": route_id,
        "scene_id": scene_id,
        "status": "consumed",
        "committed_clue_ids": list(grants if grants else committed),
        "committed_flag_ids": [],
        "remaining_clue_ids": [],
        "rule_request_ids": [],
        "rule_outcomes": ["success"] if successful else [],
        "success": bool(successful or grants),
        "completion_quality": (
            "keeper_judgment" if semantic_completion else "clean"
        ),
        "decision_id": str(decision_id),
        "source": f"toolbox_context:{source_tool}",
        "ts": _now_iso(),
    }
    if semantic_completion:
        completion.update({
            "authority": "keeper_semantic_judgment",
            "hard_gate": False,
            "semantic_reason": str(context.get("semantic_reason") or ""),
            "evidence_ref": str(context.get("evidence_ref") or ""),
        })
    receipts.append(completion)
    world["route_completion_receipts"] = receipts[-256:]
    ctx.save_world(world)
    ctx.log_event({
        "event_type": "route_completed",
        "decision_id": str(decision_id),
        "route_id": route_id,
        "scene_id": scene_id,
        "committed_clue_ids": list(completion["committed_clue_ids"]),
        "status": "completed",
        "success": completion["success"],
        "completion_quality": completion["completion_quality"],
        "semantic_reason": completion.get("semantic_reason"),
        "evidence_ref": completion.get("evidence_ref"),
        "player_visible_goal": str(route.get("cue") or ""),
        "player_visible_outcome": str(route.get("player_visible_outcome") or ""),
        "source": completion["source"],
        "summary": f"structured route completed: {route_id}",
    })
    return completion, route_warnings

def _push_operation_opportunity(
    ctx: Ctx,
    receipt: dict[str, Any],
    *,
    no_progress_count: int = 1,
) -> dict[str, Any]:
    data = receipt.get("data") if isinstance(receipt.get("data"), dict) else {}
    context = (
        data.get("resolution_context")
        if isinstance(data.get("resolution_context"), dict)
        else {}
    )
    _scene, route = _route_roll_context(ctx, context)
    gate = route.get("roll_gate") if isinstance(route, dict) else None
    push_consequence = (
        gate.get("push_failure_consequence")
        if isinstance(gate, dict) else None
    )
    fumble_consequence = (
        gate.get("fumble_consequence") if isinstance(gate, dict) else None
    )
    retry_status = _route_retry_status(ctx, route, context)
    prefilled: dict[str, Any] = {
        "original_check_decision_id": str(receipt.get("decision_id") or ""),
    }
    missing = ["method_changed", "failure_consequence", "decision_id"]
    if isinstance(push_consequence, dict) and str(
        push_consequence.get("summary") or ""
    ).strip():
        prefilled["failure_consequence"] = str(
            push_consequence["summary"]
        ).strip()
        missing.remove("failure_consequence")
    if isinstance(fumble_consequence, dict) and str(
        fumble_consequence.get("summary") or ""
    ).strip():
        prefilled["fumble_consequence"] = str(
            fumble_consequence["summary"]
        ).strip()
    opportunity = {
        "schema_version": 1,
        "kind": "open_push_or_context_change",
        "authority": "advisory",
        "hard_gate": False,
        "reason_code": "ordinary_failure_has_unresolved_attempt",
        "source": {
            "decision_id": str(receipt.get("decision_id") or ""),
            "roll_id": data.get("roll_id"),
            "attempt_id": context.get("attempt_id"),
            "scene_id": context.get("scene_id"),
            "route_id": context.get("route_id"),
            "roll_density_group": context.get("roll_density_group"),
        },
        "suggested_operation": {
            "operation": "rules.push",
            "invoke_via": "coc_invoke",
            "prefilled_arguments": prefilled,
            "missing_arguments": missing,
        },
        "attempt_pressure": {
            "schema_version": 1,
            "same_goal_no_progress_count": max(1, int(no_progress_count)),
            "level": (
                "repeated_without_progress"
                if int(no_progress_count) > 1
                else "first_ordinary_failure"
            ),
            "authority": "advisory",
            "hard_gate": False,
        },
        "retry_status": retry_status,
        "alternatives": [
            "accept the failed result and let its consequence change play",
            "change the fictional method or goal",
            "record structured reset_evidence after time, access, position, or circumstances materially change",
        ],
    }
    if retry_status.get("eligible") is True and isinstance(route, dict):
        opportunity["reset_retry_operations"] = _route_operation_cards(
            ctx,
            route,
            reset_evidence=retry_status.get("reset_evidence"),
        )
    return opportunity

def _open_attempt_opportunities_from_document(
    ctx: Ctx,
    document: dict[str, Any],
    *,
    scene_id: str | None = None,
) -> list[dict[str, Any]]:
    receipts = document.get("receipts") if isinstance(document, dict) else {}
    roll_receipts = receipts.get("rules.roll") if isinstance(receipts, dict) else {}
    push_receipts = receipts.get("rules.push") if isinstance(receipts, dict) else {}
    pushed_originals = {
        str((row.get("operation") or {}).get("original_check_decision_id") or "")
        for row in (push_receipts or {}).values()
        if isinstance(row, dict)
    }
    by_group: dict[str, dict[str, Any]] = {}
    pressure_by_group: dict[str, int] = {}
    for decision_id, receipt in (roll_receipts or {}).items():
        if not isinstance(receipt, dict):
            continue
        operation = receipt.get("operation")
        if (
            isinstance(operation, dict)
            and operation.get("combined_targets") is not None
        ):
            continue
        data = receipt.get("data") if isinstance(receipt.get("data"), dict) else {}
        context = data.get("resolution_context")
        if not isinstance(context, dict):
            continue
        group = str(context.get("roll_density_group") or "").strip()
        if not group:
            continue
        if scene_id and str(context.get("scene_id") or "") not in {"", scene_id}:
            continue
        outcome = str(data.get("outcome") or "")
        if outcome == "failure" and str(decision_id) not in pushed_originals:
            by_group[group] = receipt
            if isinstance(context.get("reset_evidence"), dict):
                pressure_by_group[group] = 1
            else:
                pressure_by_group[group] = pressure_by_group.get(group, 0) + 1
        else:
            by_group.pop(group, None)
            pressure_by_group.pop(group, None)
    return [
        _push_operation_opportunity(
            ctx,
            receipt,
            no_progress_count=pressure_by_group.get(group, 1),
        )
        for group, receipt in list(by_group.items())[-8:]
    ]

def _open_attempt_opportunities(
    ctx: Ctx, *, scene_id: str | None = None,
) -> list[dict[str, Any]]:
    return _open_attempt_opportunities_from_document(
        ctx, _load_roll_receipt_document(ctx), scene_id=scene_id,
    )

def _roll_common(
    ctx: Ctx,
    args: dict[str, Any],
    *,
    pushed: bool,
    tool_name: str,
    dedicated_psychology_observe: bool = False,
) -> tuple[dict[str, Any], list[str], list[str]]:
    decision_id = str(args["decision_id"])
    document = _load_roll_receipt_document(ctx)
    receipt_hint = _roll_receipt(document, tool_name, decision_id)
    if receipt_hint is not None:
        _validate_roll_receipt(
            receipt_hint,
            tool_name=tool_name,
            decision_id=decision_id,
        )
        operation = _normalize_percentile_invocation(
            args,
            pushed=pushed,
            frozen_operation=receipt_hint["operation"],
        )
        if (
            not dedicated_psychology_observe
            and _matches_canonical_skill_identity(operation.get("skill"), "Psychology")
        ):
            raise ToolError(
                "psychology_observe_required",
                "Psychology observation must use rules.psychology_observe so the "
                "die/outcome stay Keeper-concealed and the conversation window can reuse "
                "its first settlement; rules.roll and rules.push are not valid substitutes",
            )
        if receipt_hint["fingerprint"] != _operation_fingerprint(
            tool_name, operation
        ):
            raise ToolError(
                "idempotency_conflict",
                f"decision_id '{decision_id}' was already applied to a "
                f"different {tool_name} semantic operation",
            )
        return _replay_roll_receipt(ctx, document, receipt_hint)
    operation, resolution = _compile_new_percentile_invocation(
        ctx, args, pushed=pushed, document=document
    )
    if (
        not dedicated_psychology_observe
        and _matches_canonical_skill_identity(operation.get("skill"), "Psychology")
    ):
        raise ToolError(
            "psychology_observe_required",
            "Psychology observation must use rules.psychology_observe so the "
            "die/outcome stay Keeper-concealed and the conversation window can reuse "
            "its first settlement; rules.roll and rules.push are not valid substitutes",
        )
    document, receipt = _existing_roll_receipt(
        ctx,
        tool_name=tool_name,
        decision_id=decision_id,
        operation=operation,
        document=document,
    )
    if receipt is not None:
        return _replay_roll_receipt(ctx, document, receipt)
    investigator_id = str(resolution["investigator_id"])
    target = int(resolution["resolved_target"])
    label = str(resolution["resolved_label"])
    target_source = str(resolution["target_source"])
    difficulty = str(operation["required_level"])
    bonus = int(operation["bonus"])
    penalty = int(operation["penalty"])
    social_document: dict[str, Any] | None = None
    social_goal: dict[str, Any] | None = None
    social_ref = str(operation.get("social_adjudication_ref") or "").strip()
    if operation.get("npc_id") and not social_ref:
        social_skills = _rules_resolver(ctx, "social_skill_names").social_skill_names()
        if label in social_skills:
            raise ToolError(
                "social_adjudication_required",
                "NPC social rolls require social_adjudication_ref from rules.social_adjudicate",
            )
    if social_ref and not pushed:
        social_document = _load_json_document(
            ctx, "social-resolutions.json", 2, "resolutions"
        )
        social_goal = social_document["resolutions"].get(social_ref)
        adjudication = (
            social_goal.get("adjudication")
            if isinstance(social_goal, dict)
            and isinstance(social_goal.get("adjudication"), dict)
            else None
        )
        if not isinstance(adjudication, dict):
            raise ToolError(
                "social_adjudication_invalid",
                "social_adjudication_ref must name a current canonical adjudication",
            )
        settled_receipt = next(
            (
                receipt
                for receipt in (document.get("receipts", {}).get("rules.roll") or {}).values()
                if isinstance(receipt, dict)
                and (receipt.get("operation") or {}).get("social_adjudication_ref") == social_ref
            ),
            None,
        )
        if isinstance(settled_receipt, dict) or isinstance(social_goal.get("roll_binding"), dict):
            raise ToolError(
                "social_goal_already_settled",
                "this social commitment already has a canonical roll; reuse it or Push the failed roll",
            )
        expected = {
            "investigator_id": adjudication.get("investigator_id"),
            "npc_id": adjudication.get("npc_id"),
            "skill": adjudication.get("approach_skill"),
            "difficulty": adjudication.get("final_difficulty"),
            "bonus": adjudication.get("bonus_dice"),
            "penalty": adjudication.get("penalty_dice"),
        }
        actual = {
            "investigator_id": investigator_id,
            "npc_id": operation.get("npc_id"),
            "skill": label,
            "difficulty": difficulty,
            "bonus": bonus,
            "penalty": penalty,
        }
        if adjudication.get("feasibility") != "roll" or actual != expected:
            raise ToolError(
                "social_adjudication_invalid",
                "rules.roll does not exactly match the referenced social adjudication",
            )
    context_warnings: list[str] = []
    resolution_context: dict[str, Any] | None
    if pushed:
        original = _roll_receipt(
            document,
            "rules.roll",
            str(operation.get("original_check_decision_id") or ""),
        )
        original_data = (
            original.get("data") if isinstance(original, dict) else None
        )
        resolution_context = (
            deepcopy(original_data.get("resolution_context"))
            if isinstance(original_data, dict)
            and isinstance(original_data.get("resolution_context"), dict)
            else None
        )
    else:
        resolution_context, context_warnings = (
            _normalize_roll_resolution_context(args.get("resolution_context"))
        )
        if (
            isinstance(resolution_context, dict)
            and resolution_context.get("roll_density_group")
        ):
            current_elapsed = _current_elapsed_minutes(ctx)
            if current_elapsed is not None:
                resolution_context["attempt_started_elapsed_minutes"] = current_elapsed
    prior_attempt_advisory = None
    if (
        not pushed
        and isinstance(resolution_context, dict)
        and resolution_context.get("roll_density_group")
        and not isinstance(resolution_context.get("reset_evidence"), dict)
    ):
        group = str(resolution_context["roll_density_group"])
        prior_attempt_advisory = next(
            (
                row for row in _open_attempt_opportunities_from_document(
                    ctx,
                    document,
                    scene_id=str(resolution_context.get("scene_id") or "") or None,
                )
                if str((row.get("source") or {}).get("roll_density_group") or "")
                == group
            ),
            None,
        )
    result = _rules_resolver(ctx, "check").check(
        target, difficulty, bonus, penalty, rng=_rng(args)
    )
    result["investigator_id"] = investigator_id
    result["skill"] = label
    result["target_source"] = target_source
    result["pushed"] = pushed
    result["goal"] = str(operation["goal"])
    result["stakes"] = deepcopy(operation["stakes"])
    result["difficulty_basis"] = str(operation["difficulty_basis"])
    combined_targets = operation.get("combined_targets")
    is_combined = isinstance(combined_targets, list)
    if is_combined:
        result["kind"] = "combined_skill_check"
        result["improvement_tick_eligible"] = False
        result["combined_roll"] = _combined_roll_projection(
            combined_targets,
            roll=int(result["roll"]),
            required_level=difficulty,
            comparison_mode=str(operation["combined_mode"]),
        )
        result["success"] = bool(result["combined_roll"]["overall_success"])
        if not result["success"]:
            result["outcome"] = "failure"
            result["achieved_level"] = "failure"
    if operation.get("reason"):
        result["reason"] = str(operation["reason"])
    if operation.get("npc_id"):
        result["npc_id"] = str(operation["npc_id"])
    if social_ref and isinstance(social_goal, dict):
        adjudication = social_goal["adjudication"]
        result["social_goal_key"] = social_ref
        result["social_adjudication_ref"] = social_ref
        result["outcome_ceiling"] = deepcopy(adjudication["outcome_ceiling"])
    elif pushed and social_ref and isinstance(original_data, dict):
        result["social_goal_key"] = social_ref
        result["social_adjudication_ref"] = social_ref
        result["outcome_ceiling"] = deepcopy(original_data["outcome_ceiling"])
    if resolution_context is not None:
        result["resolution_context"] = deepcopy(resolution_context)
    if prior_attempt_advisory is not None:
        result["attempt_advisory"] = {
            **deepcopy(prior_attempt_advisory),
            "recommendation": (
                "This appears to revisit an unresolved attempt. Prefer the open Push, "
                "accept its consequence, or explain structured reset_evidence; this is "
                "advice only and the requested roll was still honored."
            ),
        }
    if pushed and operation.get("method_changed"):
        result["method_changed"] = str(operation["method_changed"])
    if pushed and operation.get("failure_consequence"):
        consequence = {"summary": str(operation["failure_consequence"])}
        result["failure_consequence"] = consequence
        result["announced_consequence"] = consequence
    if pushed:
        result["pushed_roll_protocol"] = {
            "failure_consequence_source": "keeper",
            "keeper_foreshadowed_failure": True,
            "player_confirmation_recorded": True,
        }
    if operation.get("fumble_consequence"):
        result["fumble_consequence"] = {
            "summary": str(operation["fumble_consequence"])
        }
    if pushed:
        result["original_check"] = deepcopy(
            resolution["original_check_ref"]
        )

    warnings: list[str] = list(context_warnings)
    hints: list[str] = []
    if prior_attempt_advisory is not None:
        warnings.append(
            "same roll_density_group still had an ordinary failure open; soft advice only, so the new roll was not blocked"
        )
    if target_source == "rulebook_base":
        hints.append(
            f"{label} is not listed on the investigator sheet; used the canonical rulebook base chance {target}%"
        )
    outcome = result["outcome"]
    success = bool(result["success"])
    if isinstance(resolution_context, dict) and resolution_context.get(
        "roll_density_group"
    ):
        prior_pressure = (
            ((prior_attempt_advisory or {}).get("attempt_pressure") or {}).get(
                "same_goal_no_progress_count"
            )
            or 0
        )
        result["attempt_pressure"] = {
            "schema_version": 1,
            "same_goal_no_progress_count": (
                int(prior_pressure) + 1 if outcome == "failure" else 0
            ),
            "level": (
                "resolved"
                if outcome != "failure"
                else (
                    "repeated_without_progress"
                    if int(prior_pressure) >= 1
                    else "first_ordinary_failure"
                )
            ),
            "authority": "advisory",
            "hard_gate": False,
        }
    if (
        success
        and not pushed
        and args.get("skill") not in (None, "")
        and label not in _CHARACTERISTIC_NAMES
        and label not in ("SAN", "LUCK")
    ):
        hints.append(f"success: improvement tick recorded for {label}")
    if outcome == "critical":
        hints.append(
            "critical success: before state.journal apply a source-bound benefit with state.exceptional_effect; prose alone cannot close it"
        )
    if outcome == "fumble":
        hints.append(
            "fumble: before state.journal apply a source-bound cost with state.exceptional_effect and realize its causal complication"
        )
    if outcome == "failure" and not pushed and not is_combined:
        hints.append(
            "failed: the player may push this roll with a changed method and an announced consequence (rules.push)"
        )
    if pushed and not success:
        hints.append(
            "pushed roll failed: before state.journal apply a source-bound cost with state.exceptional_effect; narration alone is insufficient"
        )
    if outcome in {"critical", "fumble"} or (pushed and not success):
        hints.append(
            "before applying state.exceptional_effect, write player_visible_impact, "
            "causal_link, and any until_condition boundary.description in the "
            "campaign's active play_language; turn.finalize renders all three "
            "verbatim, so internal English reasoning or machine ids do not belong there"
        )
        hints.append(
            "state.exceptional_effect closed contract: scene_event mechanics.change_kind "
            "must be one of arrival|escalation|hazard|loss|opening|reversal; "
            "scene_event/condition/restriction need a continuing boundary "
            "(until_scene_end/until_time_marker/until_condition), bonus/penalty need "
            "{kind:until_consumed,uses:1}, resource_delta needs {kind:immediate}"
        )
    active_modifier = _matching_active_exceptional_modifier(
        ctx,
        investigator_id=investigator_id,
        skill=label,
        npc_id=operation.get("npc_id"),
    )
    if active_modifier is not None:
        hints.append(
            "this roll used active exceptional modifier "
            f"{active_modifier['effect_id']}; call state.exceptional_effect "
            "action=consume with this roll_id before state.journal"
        )
    if outcome == "failure" and not pushed and not is_combined:
        result["operation_opportunities"] = [
            _push_operation_opportunity(
                ctx,
                {"decision_id": decision_id, "data": result},
            )
        ]
    roll_record = ctx.prepare_roll({
        "event_type": "roll",
        "kind": (
            "pushed_skill_check"
            if pushed
            else "combined_skill_check" if is_combined else "skill_check"
        ),
        "actor": investigator_id,
        "visibility": str(operation.get("visibility") or "public"),
        "payload": dict(result),
        **result,
    })
    result["roll_id"] = roll_record["roll_id"]
    if is_combined:
        projection = coc_roll.build_player_projection(
            result,
            include_target=True,
            extra={
                "roll_id": result["roll_id"],
                "combined_roll": deepcopy(result["combined_roll"]),
                "improvement_tick_eligible": False,
            },
        )
        result["player_projection"] = projection
        roll_record["player_projection"] = deepcopy(projection)
        roll_record["payload"]["player_projection"] = deepcopy(projection)
    if outcome == "failure" and not pushed and not is_combined:
        result["operation_opportunities"][0]["source"]["roll_id"] = result[
            "roll_id"
        ]
        roll_record["operation_opportunities"] = deepcopy(
            result["operation_opportunities"]
        )
        roll_record["payload"]["operation_opportunities"] = deepcopy(
            result["operation_opportunities"]
        )
    receipt = _new_roll_receipt(
        tool_name=tool_name,
        decision_id=decision_id,
        operation=operation,
        resolution=resolution,
        roll_record=roll_record,
        data=result,
        warnings=warnings,
        hints=hints,
    )
    _commit_new_roll_receipt(ctx, document, receipt)
    _canonical_level = _ROLL_OUTCOME_TO_CANONICAL_LEVEL.get(str(outcome))
    if _canonical_level is not None:
        canonical_data: dict[str, Any] = {
            "_v": 1,
            "roll_id": str(result["roll_id"]),
            "check": label,
            "actor": investigator_id,
            "result_level": _canonical_level,
            "target_value": target,
        }
        die_total = result.get("roll")
        if isinstance(die_total, int) and not isinstance(die_total, bool):
            canonical_data["dice"] = f"1d100={die_total}"
        emit_core_canonical_event(
            ctx,
            event_type="roll-resolved",
            source=f"coc_operation_kernel.{tool_name}",
            decision_id=decision_id,
            data=canonical_data,
            privacy=(
                "public"
                if str(operation.get("visibility") or "public") == "public"
                else "secret"
            ),
        )
    if social_ref and isinstance(social_document, dict) and isinstance(social_goal, dict):
        social_goal["roll_binding"] = {
            "tool": tool_name,
            "decision_id": decision_id,
            "roll_id": result["roll_id"],
            "outcome_ceiling_digest": _canonical_digest(result["outcome_ceiling"]),
        }
        _save_json_document(ctx, "social-resolutions.json", social_document)
    _route_receipt, route_warnings = _settle_contextual_route(
        ctx,
        resolution_context,
        decision_id=decision_id,
        source_tool=tool_name,
        successful=bool(result.get("success")),
    )
    warnings.extend(route_warnings)
    return result, warnings, hints

# ---------------------------------------------------------------------------
# Canonical events emission (coc-events/1) — CORE mechanics wiring.
#
# Call discipline per plugins/coc-keeper/references/canonical-events-contract.md:
# emit strictly AFTER the transactional/rules settlement behind the event
# succeeded; never on failure paths. The event stream is derived evidence:
# an emission problem must never break the already-settled authoritative
# operation, so failures land as audit rows instead of raising.
# ---------------------------------------------------------------------------

# Authoritative roll outcomes -> canonical result_level enum members.
# Percentile checks already settle in {critical, extreme, hard, regular,
# failure, fumble}; "success" is normalized by its settled rank basis,
# never recomputed here. Unmapped outcomes skip the event entirely rather
# than inventing a level.
_ROLL_OUTCOME_TO_CANONICAL_LEVEL = {
    "critical": "critical",
    "extreme": "extreme",
    "hard": "hard",
    "regular": "regular",
    "success": "regular",
    "failure": "failure",
    "fumble": "fumble",
}


def _canonical_emit_timeline(ctx: Ctx) -> str:
    """Authoritative active timeline for emission envelopes."""
    try:
        import coc_git_history

        return coc_git_history.active_timeline_id(ctx.root, ctx.campaign_id)
    except Exception:
        return "tl-main"


def _next_canonical_occurrence(
    ctx: Ctx,
    event_type: str,
    campaign: str,
    timeline: str,
    turn: int,
) -> int:
    """1-based Nth same-type occurrence within one campaign+timeline+turn.

    Counts persisted canonical rows so slug numbering survives process
    restarts exactly like every other stream-derived fact.
    """
    import coc_canonical_events

    stream = Path(ctx.campaign_dir) / "logs" / coc_canonical_events.CANONICAL_STREAM_NAME
    count = 0
    if stream.is_file():
        for line in stream.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue
            if (
                row.get("type") == event_type
                and row.get("campaign") == campaign
                and row.get("timeline") == timeline
                and row.get("turn") == turn
            ):
                count += 1
    return count + 1


def emit_core_canonical_event(
    ctx: Ctx,
    *,
    event_type: str,
    source: str,
    decision_id: str,
    data: dict[str, Any],
    privacy: str = "public",
    turn: int | None = None,
) -> dict[str, Any] | None:
    """Emit one canonical event after authoritative settlement succeeded.

    Envelope identity comes only from already-authoritative inputs: the
    campaign context, the active timeline, the current authoritative turn
    counter (never below 1), and the settled operation's ``decision_id``
    for idempotency. Never raises into the caller — an emission fault is
    recorded as an audit row so derived evidence can lag without breaking
    a state/rules tool whose writes already committed.
    """
    if ctx.campaign_dir is None or not ctx.campaign_id:
        return None
    try:
        import coc_canonical_events

        resolved_turn = max(1, int(turn or 0))
        try:
            clock_label = str(
                coc_time.current_stamp(ctx.campaign_dir).get("display") or ""
            ).strip()
        except Exception:
            clock_label = ""
        return coc_canonical_events.emit(
            campaign_logs_dir=ctx.campaign_dir / "logs",
            event_type=event_type,
            campaign=ctx.campaign_id,
            timeline=_canonical_emit_timeline(ctx),
            turn=resolved_turn,
            slug=coc_canonical_events.ordinal_slug(
                _next_canonical_occurrence(
                    ctx, event_type, ctx.campaign_id,
                    _canonical_emit_timeline(ctx), resolved_turn,
                )
            ),
            source=source,
            game_time=(clock_label or "clock-unset")[:400],
            privacy=privacy,
            decision_id=decision_id,
            data=data,
        )
    except Exception as exc:
        try:
            ctx.log_event({
                "event_type": "canonical_emit_failed",
                "failed_type": event_type,
                "source": source,
                "decision_id": str(decision_id),
                "error": str(exc)[:240],
            })
        except Exception:
            pass
        return None


_CUSTOM_SETUP_OPERATION_KINDS = (
    "campaign.create",
    "actor.create",
    "investigator.create",
    "campaign.link_investigator",
    "scenario.bind_pdf",
    "campaign.render_briefing",
    "investigator.render_card",
)

def _jsonl_rows(path: Path) -> list[dict[str, Any]]:
    if not path.is_file():
        return []
    rows: list[dict[str, Any]] = []
    try:
        for raw in path.read_text(encoding="utf-8").splitlines():
            if not raw.strip():
                continue
            value = json.loads(raw)
            if isinstance(value, dict):
                rows.append(value)
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise ToolError("state_corrupt", f"{path.name} is unreadable") from exc
    return rows

def _request_digest(args: dict[str, Any]) -> str:
    return _canonical_digest(args)

def _replay_bound_decision(
    ctx: Ctx, tool_name: str, args: dict[str, Any]
) -> dict[str, Any] | None:
    prior = ctx.ledger_lookup(tool_name, args.get("decision_id"))
    if prior is None:
        return None
    data = prior.get("data") if isinstance(prior.get("data"), dict) else {}
    if data.get("request_digest") != _request_digest(args):
        raise ToolError(
            "idempotency_conflict",
            f"{tool_name} decision_id is already bound to different immutable arguments",
        )
    return deepcopy(data)

def _load_json_document(ctx: Ctx, relative: str, schema_version: int, root_key: str) -> dict[str, Any]:
    path = ctx.campaign_dir / "save" / relative
    if not path.is_file():
        return {"schema_version": schema_version, root_key: {}}
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise ToolError("state_corrupt", f"save/{relative} is unreadable") from exc
    if (
        not isinstance(value, dict)
        or value.get("schema_version") != schema_version
        or not isinstance(value.get(root_key), dict)
    ):
        raise ToolError("state_corrupt", f"save/{relative} does not match the current schema")
    return value

def _save_json_document(ctx: Ctx, relative: str, document: dict[str, Any]) -> None:
    coc_state.write_json_atomic(ctx.campaign_dir / "save" / relative, document)


def _family_id_from_decision_ref(decision_ref: str) -> str:
    parts = str(decision_ref or "").split(":")
    if len(parts) >= 3 and parts[0] in {"decision", "exception"}:
        return parts[2]
    return "healing"


def _safe_sheet(ctx: Ctx, investigator_id: str) -> dict[str, Any] | None:
    try:
        sheet = ctx.sheet(investigator_id)
    except ToolError:
        return None
    return sheet if isinstance(sheet, dict) else None


def _facts_provider_for(ctx: Ctx, investigator_id: str, ruleset_id: str):
    """Live facts for card projection: investigator state + campaign clock.

    Named gap dual-rescuer-context-intent: this provider has no scene/NPC
    composition input. Dual-rescuer intent exists only on settle as
    ``semantic_inputs.assistant_rescuer_ref``.
    """
    def provider() -> Mapping[str, Any]:
        try:
            state = ctx.inv_state(investigator_id)
        except ToolError:
            state = {}
        sheet = _safe_sheet(ctx, investigator_id) or {}
        elapsed = None
        try:
            stamp = coc_time.current_stamp(ctx.campaign_dir)
            candidate = stamp.get("elapsed_minutes") if isinstance(stamp, dict) else None
            if isinstance(candidate, int) and not isinstance(candidate, bool):
                elapsed = candidate
        except Exception:
            elapsed = None
        facts = coc_rules_runtime.facts_from_state(
            state if isinstance(state, dict) else {},
            sheet,
            ruleset_id=ruleset_id,
            elapsed_minutes=elapsed,
        )
        snapshot = _read_optional_json(
            ctx.campaign_dir / "save" / "sanity-state" / f"{investigator_id}.json",
            {},
        )
        try:
            choices = coc_subsystem_executor.get_current_pending_choices(
                ctx.campaign_dir,
            )
        except Exception:
            choices = []
        try:
            due = coc_time.peek_due_triggers(ctx.campaign_dir)
        except Exception:
            due = []
        facts.update({
            "sanity.bout.pending": any(
                isinstance(row, Mapping) and row.get("kind") == "bout_keeper_action"
                for row in choices
            ),
            "sanity.delusion.active": isinstance(snapshot, Mapping)
            and isinstance(snapshot.get("active_delusion"), Mapping),
            "sanity.treatment.due": any(
                isinstance(row, Mapping)
                and row.get("handler") == "apply_psychoanalysis_treatment"
                for row in due
            ),
            "sanity.recovery.due": any(
                isinstance(row, Mapping)
                and row.get("handler") == "recover_temporary_insanity"
                for row in due
            ),
            "sanity.insane": isinstance(snapshot, Mapping) and bool(
                snapshot.get("temporary_insane") or snapshot.get("indefinite_insane")
            ),
            # No canonical pending SAN-gain receipt producer exists yet.
            "sanity.gain.pending": False,
        })
        ending = coc_development.structured_ending_evidence(ctx.campaign_dir)
        facts["development.settlement.pending"] = bool(
            isinstance(ending, Mapping)
            and isinstance(ending.get("ending_id"), str)
            and not coc_development.ending_settlement_path(
                ctx.campaign_dir,
                str(ending["ending_id"]),
                investigator_id,
            ).is_file()
        )
        return facts
    return provider


def _grant_context_provider_for(ctx: Ctx):
    """Machine-owned lifecycle binding for one RuleGraph card grant.

    Pi owns the finer-grained working-set epoch. The toolbox owns the durable
    campaign view available at execution time: session role, live phase,
    journal/finalization stage, and canonical turn revision. A future Pi
    transport may provide a stricter epoch, but it must enter through this
    host dependency rather than a model-authored field.
    """
    def provider() -> Mapping[str, Any]:
        role = coc_state.infer_pi_session_role(ctx.root, str(ctx.campaign_id))
        pacing = ctx.pacing()
        raw_turn = pacing.get("turn_number") if isinstance(pacing, Mapping) else 0
        turn_number = (
            raw_turn
            if isinstance(raw_turn, int) and not isinstance(raw_turn, bool)
            else 0
        )
        pending_path = ctx.campaign_dir / "save" / "pending-turn.json"
        stage = "pending_finalization" if pending_path.is_file() else "acting"
        return {
            "role": role,
            "phase": "live_turn" if role == "play" else "opening",
            "stage": stage,
            "player_turn_epoch": turn_number,
            "progress_revision": f"turn-{turn_number}:{stage}",
        }

    return provider


def _rules_runtime_for_ctx(
    ctx: Ctx,
    *,
    investigator_id: str,
    family: str = "healing",
    refresh: bool = False,
) -> tuple[Any, str, str, dict[str, Any]]:
    """Load or reuse the campaign RulesRuntime. Never raises on missing graph."""
    ruleset_id = _active_ruleset_id(ctx)
    campaign_id = str(ctx.campaign_id or "")
    package_manifest = coc_rules_runtime._load_manifest_cached(ruleset_id)
    if not refresh:
        existing = coc_rules_runtime.campaign_runtime(
            campaign_id, subject_ref=investigator_id,
        )
        if existing is not None:
            try:
                owner, surface = existing.family_ownership(family)
            except coc_rules_runtime.FamilyOwnershipMismatch as exc:
                return None, (
                    "graph" if exc.graph_claimed else "unavailable"
                ), "hidden", {
                    "ok": False,
                    "reason": "ownership_mismatch",
                    "findings": list(exc.findings),
                    "graph_claimed": exc.graph_claimed,
                }
            return existing, owner, surface, {"ok": True}
    loaded = coc_rules_runtime.load_ruleset_graph(ruleset_id)
    graph = loaded.get("graph") if isinstance(loaded.get("graph"), dict) else None
    graph_manifest = loaded.get("graph_manifest") if isinstance(
        loaded.get("graph_manifest"), dict,
    ) else None
    try:
        owner, surface = coc_rules_runtime.resolve_family_ownership(
            ruleset_id, family,
            manifest=package_manifest, graph=graph, graph_manifest=graph_manifest,
        )
    except coc_rules_runtime.FamilyOwnershipMismatch as exc:
        return None, (
            "graph" if exc.graph_claimed else "unavailable"
        ), "hidden", {
            "ok": False,
            "reason": "ownership_mismatch",
            "findings": list(exc.findings),
            "graph_claimed": exc.graph_claimed,
        }
    if not loaded.get("ok"):
        return None, owner, surface, loaded
    resolver = _rules_resolver(ctx, None)
    try:
        index = resolver.public_api_index()
    except Exception:
        index = None
    ruleset_adapter = None
    try:
        adapter = coc_rulesets.get_rule_graph_adapter(ruleset_id)
        if adapter is not None:
            ruleset_adapter = adapter
            host_index = getattr(adapter, "host_capability_index", None)
            if callable(host_index):
                host_capabilities = host_index()
                if isinstance(host_capabilities, Mapping):
                    index = {
                        **(index if isinstance(index, dict) else {}),
                        **{
                            str(key): deepcopy(dict(value))
                            for key, value in host_capabilities.items()
                            if isinstance(value, Mapping)
                        },
                    }
            blocker_provider = getattr(adapter, "promotion_blockers", None)
            blockers = (
                blocker_provider(family) if callable(blocker_provider) else []
            )
            if owner == "graph" and blockers:
                return None, owner, surface, {
                    "ok": False,
                    "reason": "rule_graph_adapter_not_promotion_ready",
                    "findings": list(blockers),
                }
    except ValueError as exc:
        if owner == "graph":
            return None, owner, surface, {
                "ok": False,
                "reason": "rule_graph_adapter_unavailable",
                "findings": [str(exc)],
            }
    runtime = coc_rules_runtime.RulesRuntime(
        loaded["graph"],
        ruleset_id=ruleset_id,
        graph_manifest=loaded.get("graph_manifest"),
        package_manifest=package_manifest,
        campaign_id=campaign_id,
        facts_provider=_facts_provider_for(ctx, investigator_id, ruleset_id),
        grant_context_provider=_grant_context_provider_for(ctx),
        resolver_index=index if isinstance(index, dict) else None,
        ruleset_adapter=ruleset_adapter,
    )
    if campaign_id:
        coc_rules_runtime.bind_campaign_runtime(
            campaign_id, runtime, subject_ref=investigator_id,
        )
    return runtime, owner, surface, loaded


def _latest_graph_check_receipt(
    ctx: Ctx,
) -> tuple[str, dict[str, Any]] | None:
    """Latest durable ordinary graph-check receipt for Push/Luck continuity."""
    ledger = ctx._load_ledger()
    candidates: list[tuple[str, str, dict[str, Any]]] = []
    for entry in (ledger.get("entries") or {}).values():
        if not isinstance(entry, Mapping) or entry.get("tool") != "rules.settle":
            continue
        data = entry.get("data") if isinstance(entry.get("data"), Mapping) else {}
        if (
            data.get("family") != "core-check"
            or data.get("decision_ref") != "decision:coc7:core-check:ordinary-check"
        ):
            continue
        settlement = data.get("settlement") if isinstance(data.get("settlement"), Mapping) else {}
        result = settlement.get("result") if isinstance(settlement.get("result"), Mapping) else {}
        check = result.get("bound_check") if isinstance(result.get("bound_check"), Mapping) else {}
        if str(check.get("outcome") or "") != "failure":
            continue
        candidates.append((
            str(entry.get("ts") or ""),
            str(entry.get("decision_id") or ""),
            deepcopy(dict(check)),
        ))
    if not candidates:
        return None
    _ts, decision_id, check = sorted(candidates)[-1]
    return decision_id, check


def _latest_graph_psychology_observation(
    ctx: Ctx,
) -> tuple[str, dict[str, Any]] | None:
    """Latest durable graph observation for realization after host restart."""
    ledger = ctx._load_ledger()
    candidates: list[tuple[str, str, dict[str, Any]]] = []
    for entry in (ledger.get("entries") or {}).values():
        if not isinstance(entry, Mapping) or entry.get("tool") != "rules.settle":
            continue
        data = entry.get("data") if isinstance(entry.get("data"), Mapping) else {}
        if (
            data.get("family") != "psychology"
            or data.get("decision_ref")
            != "decision:coc7:psychology:observe-concealed"
        ):
            continue
        settlement = data.get("settlement") if isinstance(data.get("settlement"), Mapping) else {}
        result = settlement.get("result") if isinstance(settlement.get("result"), Mapping) else {}
        if not str(result.get("insight_id") or ""):
            continue
        candidates.append((
            str(entry.get("ts") or ""),
            str(entry.get("decision_id") or ""),
            deepcopy(dict(result)),
        ))
    if not candidates:
        return None
    _ts, decision_id, result = sorted(candidates)[-1]
    return decision_id, result


def _project_healing_decision_cards(
    ctx: Ctx, investigator_id: str | None,
) -> dict[str, Any]:
    empty = {
        "schema_version": 1,
        "family": "healing",
        "investigator_id": investigator_id,
        "status": "no_candidate_in_compiled_scope",
        "cards": [],
        "authority": {
            "hard_gate": False,
            "role": "affordance",
            "note": "advisory healing affordances; absence never blocks play",
        },
    }
    if not investigator_id:
        return empty
    try:
        runtime, owner, _surface, loaded = _rules_runtime_for_ctx(
            ctx, investigator_id=investigator_id, family="healing", refresh=True,
        )
        if owner != "graph" or runtime is None or not loaded.get("ok"):
            return empty
        return coc_rules_runtime.project_family_cards(
            runtime, family="healing", investigator_id=investigator_id,
        )
    except Exception:
        return empty


def dispatch_rules_context(ctx: Ctx, args: dict[str, Any]):
    """Exact-discovery ``rules.context``. Grants stay host-internal."""
    family = str(args.get("family") or "healing").strip() or "healing"
    investigator_id: str | None = None
    try:
        investigator_id = _resolve_investigator(ctx, args)
    except ToolError:
        party = ctx.party_ids()
        investigator_id = party[0] if party else None
    if not investigator_id:
        raise ToolError("missing_param", "investigator is required for rules.context")
    runtime, owner, _surface, loaded = _rules_runtime_for_ctx(
        ctx, investigator_id=investigator_id, family=family, refresh=True,
    )
    if owner == "graph" and (runtime is None or not loaded.get("ok")):
        raise ToolError(
            "rules_graph_unavailable",
            "graph-owned family has no loadable RuleGraph; no legacy fallback",
            details={"family": family, "reason": loaded.get("reason")},
        )
    if runtime is None:
        return {
            "schema_version": 1,
            "status": "no_candidate_in_compiled_scope",
            "family": family,
            "cards": [],
        }, [], []
    kind = str(args.get("kind") or "procedure").strip() or "procedure"
    question: dict[str, Any] = {"family": family, "kind": kind}
    if family == "push-luck":
        source = _latest_graph_check_receipt(ctx)
        if source is not None:
            question["_host_source_decision_id"] = source[0]
            question["_host_source_receipt"] = source[1]
    elif family == "psychology":
        source = _latest_graph_psychology_observation(ctx)
        if source is not None:
            question["_host_source_decision_id"] = source[0]
            question["_host_source_receipt"] = source[1]
    selected = args.get("selected_affordance_ids")
    if isinstance(selected, list):
        question["selected_affordance_ids"] = [
            str(item) for item in selected if isinstance(item, str)
        ]
    if kind == "lookup":
        lookup_ref = args.get("lookup_ref") or args.get("decision_ref")
        if isinstance(lookup_ref, str) and lookup_ref.strip():
            question["lookup_ref"] = lookup_ref.strip()
        semantic = args.get("semantic_inputs")
        if isinstance(semantic, dict):
            question["semantic_inputs"] = semantic
    result = runtime.context(question)
    if family == "combat":
        handler = globals().get("_tool_combat_context")
        if callable(handler):
            context_data, context_warnings, context_hints = handler(
                ctx, {"investigator": investigator_id},
            )
            result["canonical_context"] = context_data
            if context_warnings:
                result.setdefault("warnings", []).extend(context_warnings)
            if context_hints:
                result.setdefault("hints", []).extend(context_hints)
    elif family == "sanity":
        handler = globals().get("_tool_sanity_context")
        if callable(handler):
            context_data, context_warnings, context_hints = handler(
                ctx, {"investigator": investigator_id},
            )
            result["canonical_context"] = context_data
            if context_warnings:
                result.setdefault("warnings", []).extend(context_warnings)
            if context_hints:
                result.setdefault("hints", []).extend(context_hints)
    findings = result.get("findings") if isinstance(result.get("findings"), list) else []
    if findings:
        coc_rules_runtime.record_host_internal_findings(
            findings,
            campaign_id=str(ctx.campaign_id or ""),
            family=family,
            investigator_id=investigator_id,
            ruleset_id=_active_ruleset_id(ctx),
            tool="rules.context",
        )
    public = {
        key: value for key, value in result.items()
        if key not in {"card_grant", "findings"}
    }
    public["cards"] = [
        coc_rules_runtime.public_card_projection(card)
        for card in (public.get("cards") or [])
        if isinstance(card, Mapping)
    ]
    return public, [], []


def _canonical_social_binding(
    ctx: Ctx,
    *,
    investigator_id: str,
    semantic_inputs: Mapping[str, Any],
) -> dict[str, Any]:
    """Rebuild the retained SocialInteractionCandidate from canonical state.

    Pi keeps its retained candidate in host memory, so the toolbox rebuilds
    the same deterministic identity from semantic target + current scene.
    This is intentionally narrower than accepting a model-authored NPC or
    conversation id.
    """
    target_ref = str(semantic_inputs.get("target_ref") or "").strip()
    prefix = "social-target:"
    if not target_ref.startswith(prefix) or not target_ref[len(prefix):]:
        raise ToolError(
            "invalid_semantic_input",
            "target_ref must use social-target:<npc_id>",
        )
    npc_id = target_ref[len(prefix):]
    if ":" in npc_id:
        raise ToolError(
            "invalid_semantic_input",
            "social target must contain one canonical npc id",
        )
    commitment_id = str(semantic_inputs.get("commitment_ref") or "").strip()
    if not commitment_id.startswith("commitment:") or len(commitment_id) <= 11:
        raise ToolError(
            "invalid_semantic_input",
            "commitment_ref must use commitment:<semantic-slug>",
        )
    active_scene_id = str(ctx.world().get("active_scene_id") or "").strip()
    scene = _scene_by_id(ctx.story_graph, active_scene_id)
    if not active_scene_id or not isinstance(scene, Mapping):
        raise ToolError(
            "social_candidate_stale",
            "no canonical active scene is available for the social target",
        )
    authored_present = {
        str(value) for value in (scene.get("npc_ids") or []) if str(value)
    }
    presence = _load_npc_presence_document(ctx).get("presence") or {}
    live = presence.get(npc_id) if isinstance(presence, Mapping) else None
    explicitly_present = (
        isinstance(live, Mapping)
        and live.get("status") == "present"
        and str(live.get("scene_id") or "") == active_scene_id
    )
    explicitly_absent = isinstance(live, Mapping) and not explicitly_present
    if (npc_id not in authored_present and not explicitly_present) or explicitly_absent:
        raise ToolError(
            "social_candidate_stale",
            "the semantic social target is not present in the active scene",
            details={"target_ref": target_ref, "active_scene_id": active_scene_id},
        )
    if not isinstance(_npc_by_id(ctx.npc_agendas, npc_id), Mapping):
        raise ToolError(
            "social_candidate_stale",
            "the social target has no canonical authored NPC record",
            details={"target_ref": target_ref},
        )
    evidence_ref = f"npc_agenda:{npc_id}"
    return {
        "target_ref": target_ref,
        "npc_id": npc_id,
        "conversation_window_id": (
            f"conversation:{active_scene_id}:{investigator_id}:{npc_id}"
        ),
        "commitment_id": commitment_id,
        "motive_evidence": [evidence_ref],
    }


def _canonical_psychology_binding(
    ctx: Ctx,
    *,
    investigator_id: str,
    semantic_inputs: Mapping[str, Any],
    observation_result: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Bind one Psychology target/window from semantic ref or durable insight."""
    observation: Mapping[str, Any] | None = None
    if isinstance(observation_result, Mapping):
        insight_id = str(observation_result.get("insight_id") or "")
        document = _read_optional_json(
            ctx.campaign_dir / "save" / "psychology-observations.json",
            {"observations": {}},
        )
        rows = document.get("observations") if isinstance(document, Mapping) else {}
        matches = [
            row for row in (rows.values() if isinstance(rows, Mapping) else [])
            if isinstance(row, Mapping) and str(row.get("insight_id") or "") == insight_id
        ]
        if len(matches) != 1:
            raise ToolError(
                "psychology_observation_stale",
                "the durable Psychology observation receipt is unavailable or ambiguous",
            )
        observation = matches[0]
        npc_id = str(observation.get("npc_id") or "")
    else:
        target_ref = str(semantic_inputs.get("target_ref") or "").strip()
        prefix = "psychology-target:"
        if not target_ref.startswith(prefix) or not target_ref[len(prefix):]:
            raise ToolError(
                "invalid_semantic_input",
                "target_ref must use psychology-target:<npc_id>",
            )
        npc_id = target_ref[len(prefix):]
        if ":" in npc_id:
            raise ToolError(
                "invalid_semantic_input",
                "Psychology target must contain one canonical npc id",
            )
        active_scene_id = str(ctx.world().get("active_scene_id") or "").strip()
        scene = _scene_by_id(ctx.story_graph, active_scene_id)
        authored_present = {
            str(value) for value in ((scene or {}).get("npc_ids") or []) if str(value)
        }
        presence = _load_npc_presence_document(ctx).get("presence") or {}
        live = presence.get(npc_id) if isinstance(presence, Mapping) else None
        explicitly_present = (
            isinstance(live, Mapping)
            and live.get("status") == "present"
            and str(live.get("scene_id") or "") == active_scene_id
        )
        explicitly_absent = isinstance(live, Mapping) and not explicitly_present
        if (
            not active_scene_id
            or not isinstance(scene, Mapping)
            or (npc_id not in authored_present and not explicitly_present)
            or explicitly_absent
        ):
            raise ToolError(
                "psychology_candidate_stale",
                "the semantic Psychology target is not present in the active scene",
            )
        npc = _npc_by_id(ctx.npc_agendas, npc_id)
        if not isinstance(npc, Mapping):
            raise ToolError(
                "psychology_candidate_stale",
                "the Psychology target has no canonical authored NPC record",
            )
        fact_refs = [
            f"npc_fact:{npc_id}/{row['fact_id']}"
            for row in (npc.get("facts") or [])
            if isinstance(row, Mapping) and str(row.get("fact_id") or "")
        ]
        if not fact_refs:
            fact_refs = [f"npc_agenda:{npc_id}"]
        observation = {
            "investigator_id": investigator_id,
            "npc_id": npc_id,
            "conversation_window_id": (
                f"conversation:{active_scene_id}:{investigator_id}:{npc_id}"
            ),
            "observation_revision": 0,
            "observer_scope": investigator_id,
            "observable_fact_refs": fact_refs,
            "question": str(semantic_inputs.get("question") or ""),
        }
    return {
        "investigator_id": investigator_id,
        "npc_id": npc_id,
        "conversation_window_id": observation.get("conversation_window_id"),
        "observation_revision": observation.get("observation_revision", 0),
        "observer_scope": observation.get("observer_scope") or investigator_id,
        "observable_fact_refs": list(observation.get("observable_fact_refs") or []),
        "question": observation.get("question"),
        "inference_ceiling": (
            observation.get("inference_depth")
            or (observation_result or {}).get("inference_depth")
        ),
        "observation_receipt_ref": observation.get("insight_id"),
    }


def _canonical_combat_binding(
    ctx: Ctx,
    *,
    decision_ref: str,
    investigator_id: str,
    semantic_inputs: Mapping[str, Any],
) -> dict[str, Any]:
    """Compile semantic combat refs into the existing typed combat surface."""
    action = decision_ref.rsplit(":", 1)[-1]
    if action not in {"attack", "defend", "aim", "reload", "maneuver", "flee", "end"}:
        raise ToolError("invalid_semantic_input", "unknown combat decision phase")
    combat = _combat_state(ctx)
    binding: dict[str, Any] = {
        "investigator_id": investigator_id,
        "combat_revision": int(combat.get("revision", 0)),
    }
    if action == "end":
        binding["combat_outcome"] = combat.get("outcome")
        return binding
    candidate_ref = str(semantic_inputs.get("candidate_ref") or "").strip()
    if action in {"attack", "maneuver"}:
        if candidate_ref.startswith("attack:") and candidate_ref[7:]:
            binding["target_npc_id"] = candidate_ref[7:]
        elif candidate_ref.startswith("combat-route:") and candidate_ref[13:]:
            binding["affordance_id"] = candidate_ref[13:]
        else:
            raise ToolError(
                "invalid_semantic_input",
                "combat candidate_ref must use attack:<npc_id> or combat-route:<affordance_id>",
            )
    elif candidate_ref:
        raise ToolError(
            "invalid_semantic_input",
            f"combat {action} does not accept candidate_ref",
        )
    weapon_ref = str(semantic_inputs.get("weapon_ref") or "").strip()
    if weapon_ref:
        binding["weapon_id"] = (
            weapon_ref[len("weapon:"):] if weapon_ref.startswith("weapon:") else weapon_ref
        )
    effects = semantic_inputs.get("weapon_effect_refs")
    if isinstance(effects, list):
        binding["weapon_effect_ids"] = [str(value) for value in effects]
    if action == "defend":
        pending = combat.get("pending_attack")
        if not isinstance(pending, Mapping):
            raise ToolError(
                "combat_defense_not_pending",
                "the canonical combat has no pending attack to defend",
            )
        binding.update({
            "pending_attack_ref": pending.get("attack_command_id"),
            "attack_command_id": pending.get("attack_command_id"),
            "target_actor_id": pending.get("target_actor_id"),
        })
    return binding


def _canonical_sanity_binding(
    ctx: Ctx,
    *,
    decision_ref: str,
    investigator_id: str,
    semantic_inputs: Mapping[str, Any],
) -> dict[str, Any]:
    """Hydrate exact SanitySession/choice/time-trigger inputs from state."""
    suffix = decision_ref.rsplit(":", 1)[-1]
    snapshot = _read_optional_json(
        ctx.campaign_dir / "save" / "sanity-state" / f"{investigator_id}.json",
        {},
    )
    state = ctx.inv_state(investigator_id)
    binding: dict[str, Any] = {
        "investigator_id": investigator_id,
        "san_before": snapshot.get("san_current", state.get("current_san")),
        "san_max": snapshot.get("san_max", state.get("max_san")),
    }
    if suffix == "check":
        trigger_ref = str(semantic_inputs.get("trigger_ref") or "").strip()
        if trigger_ref:
            binding["trigger_id"] = (
                trigger_ref[len("san-trigger:"):]
                if trigger_ref.startswith("san-trigger:") else trigger_ref
            )
    elif suffix in {"bout-tick", "bout-end"}:
        choices = [
            row for row in coc_subsystem_executor.get_current_pending_choices(
                ctx.campaign_dir,
            )
            if isinstance(row, Mapping) and row.get("kind") == "bout_keeper_action"
        ]
        if len(choices) != 1:
            raise ToolError(
                "sanity_bout_choice_unavailable",
                "exactly one canonical Keeper bout choice is required",
            )
        choice = choices[0]
        binding.update({
            "pending_choice_ref": choice.get("choice_id"),
            "origin_command_id": choice.get("origin_command_id"),
            "bout_revision": choice.get("revision"),
        })
    elif suffix == "reality-check":
        delusion = snapshot.get("active_delusion")
        if not isinstance(delusion, Mapping):
            raise ToolError(
                "reality_check_unavailable",
                "no active canonical delusion exists",
            )
        binding["active_delusion_ref"] = "active-delusion:current"
    elif suffix == "insane-insight":
        if not (snapshot.get("temporary_insane") or snapshot.get("indefinite_insane")):
            raise ToolError(
                "insane_insight_unavailable",
                "the investigator is not currently insane",
            )
        binding["insanity_state"] = (
            "indefinite" if snapshot.get("indefinite_insane") else "temporary"
        )
    elif suffix in {"apply-treatment", "recover-temporary"}:
        handler = (
            "apply_psychoanalysis_treatment"
            if suffix == "apply-treatment" else "recover_temporary_insanity"
        )
        due = [
            row for row in coc_time.peek_due_triggers(ctx.campaign_dir)
            if isinstance(row, Mapping)
            and row.get("handler") == handler
            and str(row.get("target_id") or "") == investigator_id
        ]
        if len(due) != 1:
            raise ToolError(
                "sanity_trigger_stale",
                "exactly one canonical due Sanity trigger is required",
            )
        trigger = due[0]
        binding.update({
            (
                "treatment_trigger_ref"
                if suffix == "apply-treatment" else "recovery_trigger_ref"
            ): trigger.get("trigger_id"),
            "due_elapsed_minutes": trigger.get("due_elapsed_minutes"),
            "safe_place": bool(
                coc_time.read_time_state(ctx.campaign_dir).get("safe_place", False)
            ),
        })
        if suffix == "apply-treatment":
            sheet = ctx.sheet(investigator_id)
            skills = sheet.get("skills") if isinstance(sheet.get("skills"), Mapping) else {}
            binding["psychoanalysis_skill"] = int(skills.get("Psychoanalysis", 1))
    return binding


def dispatch_rules_settle(
    ctx: Ctx,
    args: dict[str, Any],
    *,
    adapters: Mapping[str, Callable[..., Any]],
):
    """Ownership-keyed healing settlement (spec §14.3).

    graph → RulesRuntime.settle → existing adapter; shadow/legacy families
    are not executed here (no silent fallback).
    """
    prior = _replay_bound_decision(ctx, "rules.settle", args)
    if prior is not None:
        return prior, [
            "duplicate decision_id: returning the previously settled result"
        ], []
    decision_ref = str(args.get("decision_ref") or "").strip()
    if not decision_ref:
        raise ToolError(
            "no_candidate_in_compiled_scope",
            "a semantic decision_ref is required",
        )
    semantic_inputs = args.get("semantic_inputs")
    if semantic_inputs is None:
        semantic_inputs = {}
    if not isinstance(semantic_inputs, Mapping):
        raise ToolError("invalid_param", "semantic_inputs must be an object")
    # Host-locked fields are absent from the model schema; reject if smuggled.
    locked_smuggle = sorted(
        set(semantic_inputs) & {
            "skill_value", "rescuer_id", "pushed", "medicine_skill_value",
            "caregiver_id", "clock_kind",
        }
    )
    if locked_smuggle:
        raise ToolError(
            "locked_input_override",
            "model-supplied host-locked inputs are rejected",
            details={"fields": locked_smuggle},
        )
    family = _family_id_from_decision_ref(decision_ref)
    investigator_id = _resolve_investigator(ctx, args)
    runtime, owner, _surface, loaded = _rules_runtime_for_ctx(
        ctx, investigator_id=investigator_id, family=family, refresh=False,
    )
    if owner != "graph":
        raise ToolError(
            "no_candidate_in_compiled_scope",
            f"family {family!r} is not graph-owned; rules.settle does not execute it",
            details={"family": family, "runtime_owner": owner},
        )
    if runtime is None or not loaded.get("ok"):
        raise ToolError(
            "rules_graph_unavailable",
            "graph-owned family has no loadable RuleGraph; no legacy fallback",
            details={
                "family": family,
                "reason": (loaded or {}).get("reason"),
                "findings": (loaded or {}).get("findings"),
            },
        )
    selected = {
        "decision_ref": decision_ref,
        "semantic_inputs": dict(semantic_inputs),
    }
    if family == "social":
        selected["_host_social_binding"] = _canonical_social_binding(
            ctx,
            investigator_id=investigator_id,
            semantic_inputs=semantic_inputs,
        )
    if (
        family == "psychology"
        and decision_ref.endswith(":observe-concealed")
    ):
        selected["_host_psychology_binding"] = _canonical_psychology_binding(
            ctx,
            investigator_id=investigator_id,
            semantic_inputs=semantic_inputs,
        )
    if family == "combat":
        selected["_host_combat_binding"] = _canonical_combat_binding(
            ctx,
            decision_ref=decision_ref,
            investigator_id=investigator_id,
            semantic_inputs=semantic_inputs,
        )
    if family == "sanity":
        selected["_host_sanity_binding"] = _canonical_sanity_binding(
            ctx,
            decision_ref=decision_ref,
            investigator_id=investigator_id,
            semantic_inputs=semantic_inputs,
        )
    if family == "magic":
        selected["_host_family_binding"] = {
            "investigator": investigator_id,
            "is_npc": False,
        }
    if family == "development":
        binding: dict[str, Any] = {"investigator": investigator_id}
        if decision_ref.endswith(":settle-ending"):
            ending = coc_development.structured_ending_evidence(ctx.campaign_dir)
            if not isinstance(ending, Mapping):
                raise ToolError(
                    "settlement_unavailable",
                    "development.settle requires a persisted ending receipt",
                )
            binding["ending_id"] = ending.get("ending_id")
        selected["_host_family_binding"] = binding
    ruleset_adapter = getattr(runtime, "_ruleset_adapter", None)
    if ruleset_adapter is None:
        raise ToolError(
            "rules_graph_unavailable",
            "graph settlement requires the active ruleset adapter",
        )
    grant = runtime.latest_grant_covering(decision_ref)
    if grant is None:
        raise ToolError(
            "rule_decision_stale",
            "no live machine-issued card grant covers this decision; refresh context",
            details={"family": family, "decision_ref": decision_ref},
        )
    source_decision_id = str(grant.get("source_decision_id") or "")
    if source_decision_id:
        prior = ctx.ledger_lookup("rules.settle", source_decision_id)
        prior_data = prior.get("data") if isinstance(prior, Mapping) and isinstance(
            prior.get("data"), Mapping
        ) else {}
        settlement = (
            prior_data.get("settlement")
            if isinstance(prior_data.get("settlement"), Mapping) else {}
        )
        prior_result = (
            settlement.get("result")
            if isinstance(settlement.get("result"), Mapping) else {}
        )
        source_receipt = (
            prior_result.get("bound_check")
            if isinstance(prior_result.get("bound_check"), Mapping) else None
        )
        if isinstance(source_receipt, Mapping):
            selected["_host_source_receipt"] = deepcopy(dict(source_receipt))
        if (
            family == "psychology"
            and decision_ref.endswith(":realize-player-safe")
            and isinstance(prior_result, Mapping)
        ):
            selected["_host_psychology_binding"] = _canonical_psychology_binding(
                ctx,
                investigator_id=investigator_id,
                semantic_inputs=semantic_inputs,
                observation_result=prior_result,
            )
    active_resolver = _rules_resolver(ctx, None)
    runtime._host_locked_provider = ruleset_adapter.host_locked_provider(
        ctx,
        args,
        selected,
        resolve_investigator=_resolve_investigator,
        safe_sheet=_safe_sheet,
        skill_value=lambda sheet, skill_name: (
            coc_rulesets.resolve_actor_skill_value(
                active_resolver, sheet, skill_name,
            )
        ),
        card_grant=grant,
    )

    def executor(plan, decision_id, selected_decision):
        capability = (plan.get("capability") or {}).get("resolver_capability")
        handler = adapters.get(str(capability or ""))
        if handler is None:
            raise ToolError(
                "unsupported_ruleset_operation",
                f"no internal RuleGraph adapter for {capability!r}",
            )
        adapter_args = ruleset_adapter.executor_args(
            ctx,
            plan,
            selected_decision,
            args,
            resolve_investigator=_resolve_investigator,
            tool_error=ToolError,
        )
        return handler(ctx, adapter_args)

    result = runtime.settle(
        selected,
        str(args["decision_id"]),
        card_grant=grant,
        executor=executor,
    )
    status = result.get("status")
    if status not in {"settled", "compiled"}:
        failure = result.get("failure") if isinstance(result.get("failure"), dict) else {}
        raise ToolError(
            str(failure.get("code") or status or "rules_graph_unavailable"),
            str(failure.get("message") or status),
            details=result,
        )
    settlement = result.get("settlement") if isinstance(result.get("settlement"), dict) else {}
    adapter_data = settlement.get("result") if status == "settled" else None
    adapter_row = adapter_data if isinstance(adapter_data, dict) else {}
    data = {
        "decision_ref": result.get("decision_ref"),
        "family": result.get("family") or family,
        "status": status,
        "rule_refs": list(result.get("rule_refs") or []),
        "investigator_id": adapter_row.get("investigator_id") or investigator_id,
        "event": adapter_row.get("event"),
        "player_state_receipt": adapter_row.get("player_state_receipt"),
        "current_hp": adapter_row.get("current_hp"),
        "conditions": adapter_row.get("conditions"),
        "settlement": {
            "existing_result_envelope": bool(settlement.get("existing_result_envelope")),
            "result": adapter_data,
        },
        "next_decisions": [
            coc_rules_runtime.public_card_projection(card)
            for card in (result.get("next_decisions") or [])
            if isinstance(card, Mapping)
        ],
        "authority": result.get("authority") or "canonical-resolver-state-receipts",
        "request_digest": _request_digest(args),
    }
    ctx.ledger_record(str(args["decision_id"]), "rules.settle", data)
    warnings = list(result.get("warnings") or [])
    hints = list(result.get("hints") or [])
    return data, warnings, hints

def _execute_subsystem_requests(
    ctx: Ctx,
    *,
    investigator_id: str,
    decision_id: str,
    requests: list[dict[str, Any]],
    seed: Any = None,
    tool_name: str = "combat.resolve",
    character_snapshot: dict[str, Any] | None = None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    commands = coc_subsystem_executor.commands_from_rules_requests({
        "decision_id": decision_id,
        "rules_requests": requests,
    })
    if not commands:
        raise ToolError(
            "subsystem_operation_unavailable",
            "the requested operation could not produce a typed command",
        )
    # Shadow comparator: strictly BEFORE RNG/mutation, strictly
    # side-effect-free.  It never raises (its own boundary catches every
    # error).  For a graph-owned family, RulesRuntime.settle is the sole
    # Keeper-facing executor; the comparator may still record host-internally
    # when tests arm configure_shadow, but maybe_shadow_compare_healing is a
    # no-op unless the family owner resolves to shadow.  Gate on the four
    # healing adapters first so every other subsystem operation pays zero cost.
    if tool_name in (
        "rules.first_aid", "rules.dying_check", "rules.medicine",
        "rules.weekly_recovery",
    ):
        try:
            coc_rules_runtime.maybe_shadow_compare_healing(
                ruleset_id=_active_ruleset_id(ctx),
                tool_name=tool_name,
                decision_id=decision_id,
                command=commands[0],
                state_path=ctx.inv_state_path(investigator_id),
                sheet_provider=lambda: ctx.sheet(investigator_id),
            )
        except Exception:
            pass
    character_path = (
        ctx.coc_root / "investigators" / investigator_id / "character.json"
    )
    try:
        results = coc_subsystem_executor.execute_commands(
            ctx.campaign_dir,
            character_path,
            investigator_id,
            commands,
            rng=random.Random(seed) if seed is not None else random.Random(),
            character_snapshot=character_snapshot,
        )
    except coc_subsystem_executor.SubsystemExecutorError as exc:
        if exc.code == "RECOVERY_CONFLICT":
            cause = exc.__cause__
            transaction_id = str(
                getattr(cause, "transaction_id", "development-reader")
            )
            marker_path = Path(
                getattr(
                    cause,
                    "marker_path",
                    ctx.coc_root
                    / "investigators"
                    / investigator_id
                    / "development-active-transaction.json",
                )
            )
            try:
                display_path = marker_path.relative_to(ctx.root).as_posix()
            except ValueError:
                display_path = str(marker_path)
            raise coc_runtime_ops.DevelopmentRecoveryConflict(
                transaction_id, [display_path]
            ) from exc
        raise ToolError(exc.code, exc.message) from exc

    events = coc_subsystem_executor.flatten_result_events(results)
    command_by_id = {
        str(result.get("command_id")): result for result in results
        if isinstance(result, dict) and result.get("command_id")
    }
    for event in events:
        record = deepcopy(event)
        source_command_id = record.get("source_command_id")
        result = command_by_id.get(str(source_command_id))
        record.setdefault("event_type", "subsystem_event")
        record["decision_id"] = decision_id
        record["tool"] = tool_name
        if isinstance(result, dict):
            record.setdefault("command_kind", result.get("kind"))
        ctx.log_event(record)
    return results, events

def _module_item(ctx: Ctx, item_id: str) -> dict[str, Any] | None:
    root = ctx.module_meta.get("module_mechanics")
    items = root.get("items") if isinstance(root, dict) else None
    row = items.get(str(item_id)) if isinstance(items, dict) else None
    return row if isinstance(row, dict) else None

def _runtime_generated_npc_mechanics(ctx: Ctx, npc_id: str) -> dict[str, Any] | None:
    document = coc_npc_state.load_npc_state(ctx.campaign_dir)
    card = (document.get("npcs") or {}).get(str(npc_id))
    mechanics = card.get("mechanics") if isinstance(card, dict) else None
    if isinstance(mechanics, dict) and mechanics.get("status") == "generated":
        if not isinstance(mechanics.get("mechanics_revision_ref"), dict):
            mechanics["mechanics_revision_ref"] = coc_mechanics.mechanics_revision_ref(
                str(npc_id), 1, mechanics.get("profile") or {},
                authority="campaign_generated",
            )
            coc_npc_state.save_npc_state(ctx.campaign_dir, document)
        try:
            coc_mechanics.validate_mechanics_revision_ref(
                mechanics["mechanics_revision_ref"], npc_id=str(npc_id),
            )
        except coc_mechanics.MechanicsError as exc:
            raise ToolError("state_corrupt", str(exc)) from exc
        return mechanics
    return None

def _compiled_module_npc_mechanics(
    ctx: Ctx, subject: dict[str, Any], subject_id: str,
) -> dict[str, Any] | None:
    """Resolve a module NPC's mechanics from compiled combat affordances.

    Bundled (non-progressive) scenarios carry NPC combat truth in authored
    combat_engagement affordances — a compact opponent spec plus a
    ``monster_ref`` into the reviewed ruleset monsters table — rather than in
    npc-agendas mechanics.  Reuse that same authored truth for
    mechanics.ensure / emergent combat.resolve instead of dead-ending on
    progressive source work that a bundled scenario can never fulfill.
    Scenes and affordances are scanned in authored order, so the result is
    deterministic.
    """
    subject_name = str(subject.get("name") or "").strip()
    bare_id = subject_id[len("npc-"):] if subject_id.startswith("npc-") else subject_id
    for scene in (ctx.story_graph or {}).get("scenes") or []:
        if not isinstance(scene, dict):
            continue
        for affordance in scene.get("affordances") or []:
            operation = (
                affordance.get("rules_operation")
                if isinstance(affordance, dict) else None
            )
            if not isinstance(operation, dict) or operation.get("kind") != "combat_engagement":
                continue
            opponent = operation.get("opponent")
            if not isinstance(opponent, dict):
                continue
            opponent_id = str(opponent.get("actor_id") or "").strip()
            monster_ref = str(opponent.get("monster_ref") or "").strip()
            if opponent_id not in {subject_id, bare_id} and (
                not monster_ref or not subject_name or monster_ref != subject_name
            ):
                continue
            if not monster_ref:
                continue
            module_weapons: list[dict[str, Any]] = []
            module_rules_id = str(operation.get("module_rules_id") or "").strip()
            if module_rules_id:
                try:
                    table = coc_rules.load_rule_table(module_rules_id)
                except (OSError, ValueError):
                    table = None
                if isinstance(table, dict):
                    module_weapons = [
                        entry for entry in table.get("weapons") or []
                        if isinstance(entry, dict)
                    ]
            profile = coc_mechanics.module_monster_actor_profile(
                monster_ref, opponent, module_weapons=module_weapons,
            )
            if profile is None:
                continue
            revision_ref = coc_mechanics.mechanics_revision_ref(
                subject_id, 1, profile, authority="source_authored",
            )
            source_refs: list[dict[str, Any]] = []
            try:
                monster_row = coc_rules.monster_by_name(monster_ref)
            except (KeyError, TypeError):
                monster_row = None
            if isinstance(monster_row, dict) and isinstance(monster_row.get("source_page"), int):
                source_refs.append({
                    "path": "Call of Cthulhu 7e Keeper Rulebook",
                    "page": monster_row["source_page"],
                })
            if module_rules_id:
                source_refs.append({"path": f"module:{module_rules_id}"})
            return {
                "profile": profile,
                "mechanics_revision_ref": revision_ref,
                "monster_ref": monster_ref,
                "affordance_id": affordance.get("id"),
                "source_refs": source_refs,
            }
    return None

def _authored_npc_mechanics_revision_ref(
    subject: dict[str, Any], npc_id: str,
) -> dict[str, Any]:
    existing = subject.get("mechanics_revision_ref")
    if isinstance(existing, dict):
        try:
            coc_mechanics.validate_mechanics_revision_ref(existing, npc_id=npc_id)
        except coc_mechanics.MechanicsError as exc:
            raise ToolError("invalid_scenario", str(exc)) from exc
        return deepcopy(existing)
    mechanics = subject.get("mechanics")
    mechanics = mechanics if isinstance(mechanics, dict) else {}
    refs = mechanics.get("source_refs")
    if not isinstance(refs, list) or not refs:
        refs = subject.get("source_refs") if isinstance(subject.get("source_refs"), list) else []
    return coc_mechanics.mechanics_revision_ref(
        npc_id, 1, {"mechanics": mechanics, "source_refs": refs},
        authority="source_authored",
    )

def _with_mechanics_locator_discovery(
    ctx: Ctx,
    source_work: dict[str, Any],
    *,
    subject_kind: str,
    subject_id: str,
) -> tuple[dict[str, Any], dict[str, Any] | None]:
    """Expose the existing read-only locator planner for unknown source scope."""
    subject_kind = str(subject_kind or "").strip()
    subject_id = str(subject_id or "").strip()
    result = deepcopy(source_work)
    if not result.get("progressive") or result.get("ready"):
        return result, None
    root_id = str(result.get("asset_root_id") or "").strip()
    if not root_id:
        return result, None
    skeleton = coc_module_project.coc_module_assets.get_skeleton(
        ctx.root, root_id,
    ) or {}
    if str(skeleton.get("mechanics_locator_pass_status") or "") != "pending":
        return result, None
    locator = next(
        (
            row for row in (skeleton.get("mechanics_index") or [])
            if isinstance(row, dict)
            and str(row.get("subject_kind") or "") == subject_kind
            and str(row.get("subject_id") or "") == subject_id
        ),
        None,
    )
    locator_ready = (
        isinstance(locator, dict)
        and str(locator.get("locator_pass_status") or "") == "complete"
        and str(locator.get("status") or "") in {"located", "not_authored"}
    )
    if locator_ready:
        return result, None

    stub = result.get("stub") if isinstance(result.get("stub"), dict) else {}
    entity = stub.get("entity") if isinstance(stub.get("entity"), dict) else {}
    result["mechanics_locator_state"] = {
        "global_pass_status": "pending",
        "subject_locator_status": (
            "incomplete" if isinstance(locator, dict) else "missing"
        ),
        "narrative_body_refs_present": bool(
            entity.get("source_page_indices")
            or entity.get("source_refs")
            or entity.get("source_span")
        ),
        "narrative_body_refs_are_mechanics_locator": False,
    }
    card = _opening_card("progressive.prepare_opening", {}, [])
    card.update({
        "authority": "advisory",
        "hard_gate": False,
        "read_only": True,
        "required_for_opening": False,
        "purpose": "discover_mechanics_locator_window",
    })
    result["locator_discovery_operation"] = card
    return result, card

_PI_SOURCE_COORDINATOR_MAX_ATTEMPTS = 2

_CONSERVATIVE_CLAIM_CEILING = 4

_PI_BACKGROUND_CLAIM_CEILING = 32

def _source_coordinator_dispatch(
    *,
    workspace_root: str,
    campaign_id: str,
    asset_root_id: str,
    ready_background: list[dict[str, Any]],
    claim_result_delivery: str = "return_to_parent",
    current_dependency_claim: dict[str, Any] | None = None,
    background_claim_ceiling: int = _CONSERVATIVE_CLAIM_CEILING,
) -> dict[str, Any]:
    """Build the exact prompt packet for one host-native source coordinator.

    This is projection only.  The repository queue remains authoritative and
    no work is leased until the coordinator invokes the existing claim card.
    Keeping construction here prevents the Keeper from synthesizing a packet
    from prose or host-specific assumptions.
    """
    if claim_result_delivery not in {
        "return_to_parent", "task_return_to_parent",
    }:
        raise ValueError("unsupported coordinator claim transport")
    group_ids = sorted({
        str(row.get("work_group_id") or row.get("job_id") or "")
        for row in ready_background
        if str(row.get("work_group_id") or row.get("job_id") or "")
    })
    # A current dependency is a live turn waiting on one exact job, so it
    # claims one.  Everything else is work nobody is blocked on, and batching
    # it is the difference between one coordinator round trip and dozens: a
    # whole-book structure pass over a hundred-page module produces hundreds
    # of groups, and the old fixed cap of four drained them four at a time.
    assets_module = coc_module_project.coc_module_assets
    if background_claim_ceiling > assets_module.MAX_CLAIM_LIMIT:
        raise ValueError("background claim ceiling exceeds the claim limit")
    claim_ceiling = (
        assets_module.CURRENT_DEPENDENCY_CLAIM_LIMIT
        if current_dependency_claim is not None
        else background_claim_ceiling
    )
    max_leaves = min(claim_ceiling, len(group_ids))
    if current_dependency_claim is not None:
        if claim_result_delivery != "task_return_to_parent":
            raise ValueError(
                "current dependency claim requires private Pi task return"
            )
        if len(ready_background) != 1 or max_leaves != 1:
            raise ValueError(
                "current dependency claim must bind one exact runnable job"
            )
        expected_job_id = str(
            ready_background[0].get("job_id") or ""
        ).strip()
        if (
            set(current_dependency_claim)
            != {
                "campaign_id", "dependency_id", "job_id", "dependency_ref",
            }
            or str(current_dependency_claim.get("campaign_id") or "")
            != campaign_id
            or str(current_dependency_claim.get("job_id") or "")
            != expected_job_id
        ):
            raise ValueError("current dependency claim job binding drift")
        canonical_ref = (
            coc_module_project.coc_module_assets
            .validate_host_work_dependency_ref(
                current_dependency_claim.get("dependency_ref")
            )
        )
        expected_dependency_id = (
            coc_module_project.coc_module_assets
            .current_dependency_projection_id(
                campaign_id,
                asset_root_id,
                canonical_ref,
            )
        )
        if (
            current_dependency_claim.get("dependency_id")
            != expected_dependency_id
            or ready_background[0].get("work_level")
            != "current_dependency"
            or ready_background[0].get("dependency_ref") != canonical_ref
        ):
            raise ValueError("current dependency claim identity drift")
        current_dependency_claim = {
            "campaign_id": campaign_id,
            "dependency_id": expected_dependency_id,
            "job_id": expected_job_id,
            "dependency_ref": canonical_ref,
        }
    packet_material = {
        "campaign_id": campaign_id,
        "asset_root_id": asset_root_id,
        "groups": [
            {
                "work_group_id": group_id,
                "jobs": sorted(
                    str(row.get("job_id") or "")
                    for row in ready_background
                    if str(row.get("work_group_id") or row.get("job_id") or "")
                    == group_id
                ),
            }
            for group_id in group_ids
        ],
        **(
            {"current_dependency_claim": current_dependency_claim}
            if current_dependency_claim is not None else {}
        ),
    }
    packet_digest = hashlib.sha256(
        json.dumps(
            packet_material,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
    ).hexdigest()[:20]
    executor_digest = hashlib.sha256(
        f"{campaign_id}:{asset_root_id}".encode("utf-8")
    ).hexdigest()[:20]
    executor_id = (
        f"source-current-dependency:{current_dependency_claim['dependency_id']}"
        if current_dependency_claim is not None
        else f"source-coordinator:{executor_digest}"
    )
    claim_arguments = {
        "executor_id": executor_id,
        "limit": max_leaves,
        "result_delivery": claim_result_delivery,
        **(
            {"current_dependency_claim": current_dependency_claim}
            if current_dependency_claim is not None else {}
        ),
    }
    packet = {
        "schema_version": 1,
        "contract_id": "coc.source-coordinator.v1",
        "packet_id": f"source-coordinator-{packet_digest}",
        "adapter_mode": "manager_exact_forward",
        "workspace_root": workspace_root,
        "python_executable": sys.executable,
        "toolbox_script": str((_HERE / "coc_toolbox.py").resolve()),
        "campaign_id": campaign_id,
        "asset_root_id": asset_root_id,
        "claim_operation": {
            "operation": "progressive.claim_host_work",
            "invoke_via": "canonical_typed_operation_gateway",
            "prefilled_arguments": claim_arguments,
            "missing_arguments": [],
            "authority": "advisory",
            "hard_gate": False,
        },
        "fulfill_operation": {
            "operation": "progressive.fulfill_host_work",
            "invoke_via": "canonical_typed_operation_gateway",
            "fixed_arguments": {},
            "missing_arguments": ["worker_result"],
            "exact_forward_binding": (
                "worker_result=one exact leaf results[] value"
            ),
            "authority": "source_fulfillment",
            "hard_gate": False,
        },
        "max_leaves": max_leaves,
        "leaf_worker": {
            "agent_type": "coc-source-pack-worker",
            "instruction_ref": str(
                (_HERE.parent / "agents" / "coc-source-pack-worker.md").resolve()
            ),
            "model_policy": "inherit_parent",
            "run_in_background": False,
            "prompt_binding": (
                "one exact repository-produced dispatch_tasks[] "
                "coc.pi-source-pack-task.v1 value"
                if claim_result_delivery == "task_return_to_parent"
                else "one exact returned packets[] value"
            ),
            "result_binding": (
                "forward every exact usable results[] value once through "
                "progressive.fulfill_host_work"
            ),
        },
        "failure_policy": {
            "authority": "prompt_first_advisory",
            "single_failure": "transient_allowed",
            "same_failure_escalation_threshold": 3,
            "threshold_outcome": "design_issue",
            "same_task_retry": False,
            "player_action_gate": False,
            "narrative_gate": False,
            "output_gate": False,
        },
    }
    return {
        "agent_type": "coc-source-coordinator",
        "run_in_background": True,
        "task_prompt": "one exact host dispatch object without campaign transcript",
        "packet": packet,
        "codex_task": {
            "schema_version": 1,
            "contract_id": "coc.codex-source-coordinator-task.v1",
            "instruction_ref": str(
                (
                    _HERE.parent
                    / "agents"
                    / "coc-source-coordinator.md"
                ).resolve()
            ),
            "model_policy": "inherit_parent",
            "packet": packet,
        },
    }

def _pi_source_coordinator_dispatch(
    *,
    workspace_root: str,
    campaign_id: str,
    asset_root_id: str,
    ready_background: list[dict[str, Any]],
    current_dependency_claim: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Project the same closed coordinator packet for the Pi Package."""
    dispatch = _source_coordinator_dispatch(
        workspace_root=workspace_root,
        campaign_id=campaign_id,
        asset_root_id=asset_root_id,
        ready_background=ready_background,
        claim_result_delivery="task_return_to_parent",
        current_dependency_claim=current_dependency_claim,
        # Only the Pi lifecycle spawns leaves through a bounded pool, so only
        # it may claim a large batch.  Any adapter that still fans out over
        # everything it claims keeps the conservative ceiling.
        background_claim_ceiling=_PI_BACKGROUND_CLAIM_CEILING,
    )
    codex_task = dispatch.pop("codex_task")
    dispatch["packet"]["claim_operation"]["prefilled_arguments"][
        "max_dispatch_attempts"
    ] = _PI_SOURCE_COORDINATOR_MAX_ATTEMPTS
    dispatch["packet"]["failure_policy"].update({
        "same_task_retry": True,
        "automatic_retry": {
            "retryable_failure_classes": ["fulfill_rejected"],
            "require_status": "failed",
            "require_positive_claimed": True,
            "require_zero_fulfilled": True,
            "max_attempts": _PI_SOURCE_COORDINATOR_MAX_ATTEMPTS,
        },
    })
    dispatch["pi_task"] = {
        **codex_task,
        "contract_id": "coc.pi-source-coordinator-task.v1",
        "packet": codex_task["packet"],
    }
    return dispatch

def _source_claiming_pack_task(
    *,
    workspace_root: str,
    campaign_id: str,
    asset_root_id: str,
) -> dict[str, Any]:
    """Return a small Codex task that leases its own single source packet."""
    executor_digest = hashlib.sha256(
        f"{campaign_id}:{asset_root_id}:direct-single".encode("utf-8")
    ).hexdigest()[:20]
    return {
        "schema_version": 1,
        "contract_id": "coc.codex-source-pack-claim-task.v1",
        "instruction_ref": str(
            (_HERE.parent / "agents" / "coc-source-pack-worker.md").resolve()
        ),
        "model_policy": "inherit_parent",
        "workspace_root": workspace_root,
        "python_executable": sys.executable,
        "toolbox_script": str((_HERE / "coc_toolbox.py").resolve()),
        "campaign_id": campaign_id,
        "asset_root_id": asset_root_id,
        "claim_operation": {
            "operation": "progressive.claim_host_work",
            "invoke_via": "coc_invoke",
            "root": workspace_root,
            "campaign": campaign_id,
            "prefilled_arguments": {
                "executor_id": f"source-direct:{executor_digest}",
                "limit": 1,
                "result_delivery": "task_return_to_parent",
            },
            "missing_arguments": [],
            "authority": "advisory",
            "hard_gate": False,
        },
        "claimed_task_binding": (
            "compile dispatch_tasks[0].packet in this same child; do not spawn "
            "another child"
        ),
        "result_binding": (
            "return the complete bare coc.source-pack-worker.v1 object"
        ),
    }

def _source_direct_single_dispatch(
    *,
    workspace_root: str,
    campaign_id: str,
    asset_root_id: str,
) -> dict[str, Any]:
    """Return the closed direct-worker routes for one ready source group."""
    executor_digest = hashlib.sha256(
        f"{campaign_id}:{asset_root_id}:direct-single".encode("utf-8")
    ).hexdigest()[:20]
    return {
        "agent_type": "coc-source-pack-worker",
        "run_in_background": True,
        "dispatch_mode": "direct_single_leaf",
        "codex_task": _source_claiming_pack_task(
            workspace_root=workspace_root,
            campaign_id=campaign_id,
            asset_root_id=asset_root_id,
        ),
        "codex_task_binding": (
            "spawn exact codex_task immediately; the child claims and compiles "
            "its packet in one task"
        ),
        "codex_parent_claims": False,
        "named_submit_claim_operation": {
            "operation": "progressive.claim_host_work",
            "invoke_via": "coc_invoke",
            "prefilled_arguments": {
                "executor_id": f"source-direct:{executor_digest}",
                "limit": 1,
                "result_delivery": "named_submit",
            },
            "missing_arguments": [],
            "authority": "advisory",
            "hard_gate": False,
        },
        "named_submit_task_binding": (
            "spawn each exact returned dispatch_tasks[] value immediately"
        ),
        "model_policy": "inherit_parent",
        "preconfirmation_parent_waits": False,
        "postconfirmation_blocking_minimum": True,
        "parent_result_polls": 0,
        "parent_output_retrieval": False,
        "parent_calls_fulfill_host_work": True,
        "completion_binding": (
            "on natural child completion, forward each exact results[i] once "
            "as progressive.fulfill_host_work.worker_result"
        ),
        "completion_operation": {
            "operation": "progressive.fulfill_host_work",
            "invoke_via": "coc_invoke",
            "prefilled_arguments": {},
            "missing_arguments": ["worker_result"],
            "exact_forward_binding": (
                "worker_result=one exact natural child results[i] value"
            ),
            "authority": "source_fulfillment",
            "hard_gate": False,
            "arguments_schema": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "worker_result": {
                        "type": "object",
                        "additionalProperties": False,
                        "properties": {
                            "job_id": {"type": "string"},
                            "pack": {
                                "type": "object",
                                "additionalProperties": True,
                            },
                            "related_packs": {"type": "array"},
                        },
                        "required": ["job_id", "pack", "related_packs"],
                    },
                },
                "required": ["worker_result"],
            },
        },
    }

def _source_inline_single_dispatch(
    *,
    workspace_root: str,
    campaign_id: str,
    asset_root_id: str,
) -> dict[str, Any]:
    """Return one closed claim/fulfill route for the opening source owner.

    The opening coordinator already retains the visually reviewed foreground
    page text.  Leasing the sole packet back to that same semantic owner avoids
    a redundant coordinator-to-leaf hop while preserving the authoritative
    queue, result contract, validation, and fulfillment boundary.
    """
    executor_digest = hashlib.sha256(
        f"{campaign_id}:{asset_root_id}:opening-inline".encode("utf-8")
    ).hexdigest()[:20]
    direct = _source_direct_single_dispatch(
        workspace_root=workspace_root,
        campaign_id=campaign_id,
        asset_root_id=asset_root_id,
    )
    return {
        "dispatch_mode": "inline_single_owner",
        "host_adapter": "codex",
        "next_host_action": {
            "schema_version": 1,
            "action": "claim_and_compile_inline",
            "execute_before_any_other_host_operation": True,
            "owner": "opening_source_coordinator",
            "operation": {
                "operation": "progressive.claim_host_work",
                "invoke_via": "coc_invoke",
                "root": workspace_root,
                "campaign": campaign_id,
                "prefilled_arguments": {
                    "executor_id": f"source-opening:{executor_digest}",
                    "limit": 1,
                    "result_delivery": "return_to_parent",
                },
                "missing_arguments": [],
                "authority": "advisory",
                "hard_gate": False,
            },
            "packet_binding": (
                "compile exactly packets[0] in this same opening source "
                "coordinator from its retained accepted page text and closed "
                "result_contract; do not spawn another agent"
            ),
            "packet_count": 1,
            "nested_agent": False,
            "on_completion": {
                "result_binding": (
                    "forward the one exact compiled results[i] once as "
                    "progressive.fulfill_host_work.worker_result"
                ),
                "operation": direct["completion_operation"],
            },
        },
    }

def _source_parent_flat_fanout_dispatch(
    *,
    campaign_id: str,
    asset_root_id: str,
    ready_group_count: int,
) -> dict[str, Any]:
    """Return top-level multi-leaf named-submit routes for depth-1 hosts.

    Grok cannot nest coordinator -> leaf. The main KP claims once and spawns
    one top-level source-pack worker per returned dispatch task. Leaves own
    named submit; the parent never retrieves packs or fulfills.
    """
    max_workers = min(4, max(1, int(ready_group_count)))
    executor_digest = hashlib.sha256(
        f"{campaign_id}:{asset_root_id}:parent-flat-fanout".encode("utf-8")
    ).hexdigest()[:20]
    return {
        "dispatch_mode": "parent_flat_fanout",
        "host_adapter": "grok",
        "next_host_action": {
            "schema_version": 1,
            "action": "claim_then_spawn_named_workers",
            "execute_before_any_other_host_operation": True,
            "operation": {
                "operation": "progressive.claim_host_work",
                "invoke_via": "coc_invoke",
                "prefilled_arguments": {
                    "executor_id": f"source-parent-fanout:{executor_digest}",
                    "limit": max_workers,
                    "result_delivery": "named_submit",
                },
                "missing_arguments": [],
                "authority": "advisory",
                "hard_gate": False,
            },
            "spawn_binding": (
                "spawn each exact returned dispatch_tasks[] value immediately "
                "as one background unqualified coc-source-pack-worker; never "
                "nest a coordinator, second spawn level, or plugin-qualified "
                "agent name"
            ),
            "agent_type": "coc-source-pack-worker",
            "agent_name_binding": "unqualified_installed_plugin_projection",
            "run_in_background": True,
            "model_policy": "inherit_parent",
            "max_workers": max_workers,
            "parent_waits": False,
            "parent_result_polls": 0,
            "parent_output_retrieval": False,
            "parent_calls_fulfill_host_work": False,
            "completion_binding": (
                "named_submit child owns submit_source_result; treat host "
                "completion as liveness only and never retrieve or fulfill"
            ),
        },
    }

def _current_dependency_wait_projection(
    campaign_id: str,
    asset_root_id: str,
    request: dict[str, Any],
    operational_class: str,
) -> dict[str, Any]:
    assets_mod = coc_module_project.coc_module_assets
    dependency_ref = assets_mod.validate_host_work_dependency_ref(
        request.get("dependency_ref")
    )
    return {
        "schema_version": 1,
        "contract_id": "coc.source-current-dependency-wait.v1",
        "campaign_id": campaign_id,
        "dependency_id": assets_mod.current_dependency_projection_id(
            campaign_id,
            asset_root_id,
            dependency_ref,
        ),
        "job_id": str(request.get("job_id") or ""),
        "work_group_id": str(
            request.get("work_group_id")
            or request.get("job_id")
            or ""
        ),
        "dependency_ref": dependency_ref,
        "operational_class": operational_class,
        "dispatch_attempts": int(request.get("dispatch_attempts") or 0),
    }

def _source_host_work_projection(
    ctx: Ctx,
    asset_root_id: str,
    *,
    all_open_host_work: list[dict[str, Any]] | None = None,
    execution_owner: str | None = None,
) -> dict[str, Any]:
    """Project one shared host-work handoff for every canonical reader."""
    assets_mod = coc_module_project.coc_module_assets
    open_rows = (
        all_open_host_work
        if all_open_host_work is not None
        else assets_mod.list_host_work_requests(
            ctx.root, asset_root_id, limit=None,
        )
    )
    host_work_fields = (
        "job_id", "kind", "target_id", "priority",
        "requested_pdf_indices", "source_aspect", "deadline_class",
        "work_level", "dependency_ref", "work_group_id",
        "dispatch_state", "dispatch_attempts",
        "cached_scope_complete",
    )
    compact_host_work = [
        {
            key: deepcopy(row.get(key))
            for key in host_work_fields
            if key in row
        }
        for row in open_rows
    ]
    host_adapter = str(os.environ.get("COC_HOST") or "unknown").lower()
    # The whole-book parse lane is worker-native OCR (baiduocr bridge) and is
    # never dispatchable through the entity-pack coordinator / pdf-skill
    # adapter route.  Its durable request row stays visible as in-progress
    # bookkeeping only; the detached queue worker owns completion, bounded
    # retries, and terminal failure with an explicit next_operation.
    # Readiness is whatever host_work_operational_class says, not a second
    # derivation from page-cache fields.  Those fields only describe requests
    # answered by reading a page window; a structure request carries its own
    # evidence packet, so it can never report a complete cached scope and was
    # invisible here while being perfectly runnable.  The full_parse exclusion
    # stays: that is a lane rule, not a readiness one.
    ready_candidates = [
        compact
        for row, compact in zip(
            open_rows, compact_host_work, strict=True,
        )
        if assets_mod.host_work_operational_class(row) == "runnable"
        and bool(row.get("requested_pdf_indices"))
        and str(row.get("kind") or "") != "full_parse"
    ]
    retry_exhausted = [
        row for row in ready_candidates
        if host_adapter == "pi"
        and int(row.get("dispatch_attempts") or 0)
        >= _PI_SOURCE_COORDINATOR_MAX_ATTEMPTS
    ]
    ready_background = [
        row for row in ready_candidates
        if row not in retry_exhausted
    ]
    operational_classes = [
        assets_mod.host_work_operational_class(row) for row in open_rows
    ]
    current_dependency_waits = [
        _current_dependency_wait_projection(
            str(ctx.campaign_id),
            asset_root_id,
            row,
            operational_class,
        )
        for row, operational_class in zip(
            open_rows,
            operational_classes,
            strict=True,
        )
        if execution_owner != "opening_source_coordinator"
        and row.get("work_level") == "current_dependency"
        and isinstance(row.get("dependency_ref"), dict)
    ]
    waits_by_job_id = {
        str(wait["job_id"]): wait
        for wait in current_dependency_waits
    }
    pi_current_ready = [
        row for row in ready_background
        if host_adapter == "pi"
        and execution_owner != "opening_source_coordinator"
        and row.get("work_level") == "current_dependency"
        and str(row.get("job_id") or "") in waits_by_job_id
    ]
    dispatch_ready_background = [
        row for row in ready_background
        if row not in pi_current_ready
    ]
    awaiting_scope = [
        row for row, operational_class in zip(
            open_rows, operational_classes, strict=True,
        )
        if operational_class == "awaiting_scope"
    ]
    projection: dict[str, Any] = {
        "asset_root_id": asset_root_id,
        "campaign_id": str(ctx.campaign_id),
        "current_dependency_snapshot_complete": True,
        "open_host_work_count": len(open_rows),
        "open_host_work": compact_host_work[:3],
        "ready_for_background_count": len(ready_background),
        "runnable_count": operational_classes.count("runnable"),
        "leased_count": operational_classes.count("leased"),
        "awaiting_scope_count": len(awaiting_scope),
        "awaiting_cache_count": operational_classes.count("awaiting_cache"),
        "stale_count": operational_classes.count("stale"),
        "stranded_ready_count": sum(
            str(row.get("dispatch_state") or "") == "ready"
            and operational_class != "runnable"
            for row, operational_class in zip(
                open_rows, operational_classes, strict=True,
            )
        ),
        "blocking_micro_ready_count": sum(
            row.get("deadline_class") == "blocking_micro"
            for row in ready_background
        ),
        "ready_background_requests": ready_background[:4],
        "current_dependency_waits": current_dependency_waits,
    }
    if pi_current_ready:
        current_dispatches: list[dict[str, Any]] = []
        for request in pi_current_ready:
            wait = waits_by_job_id[str(request["job_id"])]
            claim = {
                "campaign_id": wait["campaign_id"],
                "dependency_id": wait["dependency_id"],
                "job_id": wait["job_id"],
                "dependency_ref": deepcopy(wait["dependency_ref"]),
            }
            coordinator = _pi_source_coordinator_dispatch(
                workspace_root=str(ctx.root),
                campaign_id=str(ctx.campaign_id),
                asset_root_id=asset_root_id,
                ready_background=[request],
                current_dependency_claim=claim,
            )
            current_dispatches.append({
                **deepcopy(wait),
                "next_host_action": {
                    "schema_version": 1,
                    "action": "invoke_coc_dispatch_source_work",
                    "task": coordinator["pi_task"],
                    "parent_waits": False,
                    "parent_result_polls": 0,
                    "parent_output_retrieval": False,
                },
            })
        projection["current_dependency_dispatches"] = current_dispatches
    if retry_exhausted:
        projection.update({
            "pi_coordinator_dispatch_status": "retry_exhausted",
            "pi_coordinator_max_attempts": (
                _PI_SOURCE_COORDINATOR_MAX_ATTEMPTS
            ),
            "pi_coordinator_retry_exhausted_count": len(retry_exhausted),
            "pi_coordinator_retry_exhausted_requests": retry_exhausted[:4],
            "automatic_retry_remaining": False,
        })
    if not dispatch_ready_background:
        return projection
    ready_group_count = len({
        str(row.get("work_group_id") or row.get("job_id"))
        for row in dispatch_ready_background
    })
    if (
        ready_group_count == 1
        and host_adapter == "codex"
        and execution_owner == "opening_source_coordinator"
    ):
        route = _source_inline_single_dispatch(
            workspace_root=str(ctx.root),
            campaign_id=str(ctx.campaign_id),
            asset_root_id=asset_root_id,
        )
    elif ready_group_count == 1:
        direct = _source_direct_single_dispatch(
            workspace_root=str(ctx.root),
            campaign_id=str(ctx.campaign_id),
            asset_root_id=asset_root_id,
        )
        if host_adapter == "codex":
            route = {
                "dispatch_mode": "direct_single_leaf",
                "host_adapter": "codex",
                "next_host_action": {
                    "schema_version": 1,
                    "action": "spawn_background_task",
                    "execute_before_any_other_host_operation": True,
                    "task": direct["codex_task"],
                    "parent_claims": False,
                    "on_natural_completion": {
                        "result_binding": direct["completion_binding"],
                        "operation": direct["completion_operation"],
                        "polls": 0,
                        "output_retrieval": False,
                    },
                },
            }
        elif host_adapter == "pi":
            coordinator = _pi_source_coordinator_dispatch(
                workspace_root=str(ctx.root),
                campaign_id=str(ctx.campaign_id),
                asset_root_id=asset_root_id,
                ready_background=dispatch_ready_background,
            )
            route = {
                "dispatch_mode": "coordinator_fanout",
                "host_adapter": "pi",
                "capability_status": "unavailable_pending_real_lifecycle_probe",
                "coordinator_dispatch": coordinator,
                "next_host_action": {
                    "schema_version": 1,
                    "action": "invoke_coc_dispatch_source_work",
                    "execute_before_any_other_host_operation": True,
                    "task": coordinator["pi_task"],
                    "parent_claims": False,
                    "parent_waits": False,
                    "parent_result_polls": 0,
                    "parent_output_retrieval": False,
                },
            }
        elif host_adapter == "grok":
            route = {
                "dispatch_mode": "direct_single_leaf",
                "host_adapter": "grok",
                "next_host_action": {
                    "schema_version": 1,
                    "action": "claim_then_spawn_named_worker",
                    "execute_before_any_other_host_operation": True,
                    "operation": direct["named_submit_claim_operation"],
                    "spawn_binding": direct["named_submit_task_binding"],
                    "parent_waits": False,
                    "parent_result_polls": 0,
                    "parent_output_retrieval": False,
                },
            }
        else:
            route = {
                "dispatch_mode": "direct_single_leaf",
                "host_adapter": host_adapter,
                "direct_single_leaf_dispatch": direct,
            }
    elif host_adapter == "grok":
        # Depth-1 hosts cannot run coordinator -> leaf. The main KP is the
        # flat manager: one named_submit claim, then one top-level worker per
        # returned dispatch task.
        route = _source_parent_flat_fanout_dispatch(
            campaign_id=str(ctx.campaign_id),
            asset_root_id=asset_root_id,
            ready_group_count=ready_group_count,
        )
    else:
        coordinator_builder = (
            _pi_source_coordinator_dispatch
            if host_adapter == "pi"
            else _source_coordinator_dispatch
        )
        coordinator = coordinator_builder(
            workspace_root=str(ctx.root),
            campaign_id=str(ctx.campaign_id),
            asset_root_id=asset_root_id,
            ready_background=dispatch_ready_background,
        )
        route = {
            "dispatch_mode": "coordinator_fanout",
            "coordinator_dispatch": coordinator,
        }
        if host_adapter == "pi":
            route.update({
                "host_adapter": "pi",
                "capability_status": "unavailable_pending_real_lifecycle_probe",
                "next_host_action": {
                    "schema_version": 1,
                    "action": "invoke_coc_dispatch_source_work",
                    "task": coordinator["pi_task"],
                    "parent_waits": False,
                    "parent_result_polls": 0,
                    "parent_output_retrieval": False,
                },
            })
    takeover: dict[str, Any] = {
        "schema_version": 1,
        "kind": "ready_background_source_work",
        **route,
        "authority": "advisory",
        "hard_gate": False,
        "host_dispatch": {
            "worker_profile": "coc-source-pack-worker",
            "background": True,
            "packet_binding": (
                "one exact returned dispatch_tasks[] value per child when "
                "result_delivery=named_submit"
            ),
            "direct_submit_parent_waits": False,
            "direct_submit_parent_result_polls": 0,
            "direct_submit_parent_output_retrieval": False,
            "direct_submit_parent_calls_fulfill_host_work": False,
            "fallback_without_direct_submit": (
                "forward exact completed results[i] once through "
                "progressive.fulfill_host_work"
            ),
        },
        "play_boundary": {
            "player_action_gate": False,
            "narrative_gate": False,
            "output_gate": False,
            "nondependent_play_may_continue": True,
            "blocking_micro_applies_only_to_current_dependent_settlement": True,
        },
    }
    projection["background_takeover"] = takeover
    return projection

def _scene_contract_projection(
    ctx: Ctx, active_id: str | None, world: dict[str, Any]
) -> dict[str, Any] | None:
    """Project the authored scene contract plus live improvisation consumption.

    Read-only advisory surface: budgets and truth ceilings never block play;
    they make a transit node absorbing the mainline visible in evidence.
    """
    scene = _scene_by_id(ctx.story_graph, active_id)
    contract = (scene or {}).get("scene_contract")
    if not isinstance(contract, dict):
        return None
    promotions = [
        row
        for row in (world.get("scene_promotions") or [])
        if isinstance(row, dict) and str(row.get("scene_id") or "") == str(active_id or "")
    ]
    effective_role = str(
        (promotions[-1].get("to_role") if promotions else None)
        or contract.get("role")
        or ""
    )
    authored_contract_id = str(contract.get("scene_contract_id") or "").strip()
    effective_contract_id = str(
        (promotions[-1].get("to_contract_id") if promotions else None)
        or authored_contract_id
    ).strip()
    drift_findings: list[dict[str, Any]] = []
    for row in _jsonl_rows(ctx.campaign_dir / "logs" / "events.jsonl"):
        if (
            row.get("event_type") != "scene_scope_drift"
            or str(row.get("scene_id") or "") != str(active_id or "")
        ):
            continue
        finding = deepcopy(row)
        event_id = str(finding.get("event_id") or "")
        resolution = next(
            (
                promotion
                for promotion in reversed(promotions)
                if event_id
                and event_id
                in {str(value) for value in promotion.get("source_event_ids") or []}
            ),
            None,
        )
        if resolution is not None:
            finding["status"] = "resolved"
            finding["resolved_by_promotion_id"] = resolution.get("promotion_id")
        else:
            finding["status"] = "unpromoted"
        drift_findings.append(finding)
    flags = ctx.flags()
    clues_found = flags.get("clues_found") if isinstance(flags.get("clues_found"), dict) else {}
    improvised_clues = sum(
        1
        for row in clues_found.values()
        if isinstance(row, dict)
        and row.get("provenance") == "improvised"
        and str(row.get("scene_id") or "") == str(active_id or "")
    )
    improvised_npcs = 0
    receipts_doc = _read_optional_json(
        ctx.campaign_dir / "save" / "npc-engagement-receipts.json", None
    )
    receipts = (
        receipts_doc.get("receipts")
        if isinstance(receipts_doc, dict) and isinstance(receipts_doc.get("receipts"), dict)
        else {}
    )
    for row in receipts.values():
        if not isinstance(row, dict):
            continue
        event = row.get("event") if isinstance(row.get("event"), dict) else {}
        if str(event.get("scene_id") or "") != str(active_id or ""):
            continue
        binding = (
            row.get("identity_binding")
            if isinstance(row.get("identity_binding"), dict)
            else event.get("identity_binding") if isinstance(event.get("identity_binding"), dict) else {}
        )
        if binding.get("status") == "improvised":
            improvised_npcs += 1
    return {
        "schema_version": contract.get("schema_version", 1),
        "scene_contract_id": effective_contract_id or None,
        "authored_scene_contract_id": authored_contract_id or None,
        "scene_id": active_id,
        "role": contract.get("role"),
        "authored_purposes": contract.get("authored_purposes"),
        "effective_role": effective_role,
        "promoted": bool(promotions),
        "promotion": deepcopy(promotions[-1]) if promotions else None,
        "truth_scope": contract.get("truth_scope"),
        "improv_budget": contract.get("improv_budget"),
        "budget_consumption": {
            "improvised_clues": improvised_clues,
            "improvised_npcs": improvised_npcs,
        },
        "exit_affordances": contract.get("exit_affordances"),
        "drift_findings": drift_findings,
    }

def _party_runtime_finance(
    member_live: Any,
    play_language: str,
) -> dict[str, Any] | None:
    """Compact live finance for party_investigators. Omits missing/corrupt envelopes."""
    if not isinstance(member_live, dict):
        return None
    try:
        finance = coc_finance.normalize_finance(member_live.get("finance"))
    except ValueError:
        return None
    cash: dict[str, Any] | None
    try:
        cash = coc_cash.normalize_cash(member_live.get("cash"))
    except ValueError:
        cash = {"balances": {}}
    return coc_finance.keeper_runtime_finance_brief(
        cash=cash,
        finance=finance,
        play_language=play_language,
    )

def _tool_scene_context(ctx: Ctx, args: dict[str, Any]):
    world = ctx.world()
    sg = ctx.story_graph
    active_id = world.get("active_scene_id")
    discovered = {str(c) for c in (world.get("discovered_clue_ids") or [])}
    warnings: list[str] = []
    requested_scene_id = str(args.get("scene_id") or "").strip()
    if requested_scene_id and requested_scene_id != str(active_id or ""):
        warnings.append(
            "scene.context reads only the current active scene; the supplied "
            f"scene_id {requested_scene_id!r} was ignored. Use the exact "
            "state.move_scene exit card first, then call scene.context once; "
            "do not read story-graph, clue-graph, or module asset files to preview it."
        )
    archive_meta: dict[str, Any] | None = None
    archive_packet: dict[str, Any] | None = None
    scene: dict[str, Any] | None = None
    static_npcs: dict[str, dict[str, Any]] = {}
    static_clues: dict[str, dict[str, Any]] = {}
    drilldown_refs: dict[str, Any] = {"npc": [], "clue": [], "secret": []}
    covered_domains = [
        "scene", "npc_presence", "clues", "time", "active_effects", "flags", "party",
    ]

    # Prefer the compiled archive scene shard for authored static material.
    # Live world/npc/time/effect state is always overlaid from canonical saves.
    if active_id and ctx.campaign_dir is not None:
        try:
            archive_packet = coc_compiled_archive.active_scene_static_packet(
                ctx.campaign_dir, str(active_id),
            )
            scene_shard = archive_packet["scene"]
            scene = {
                "scene_id": scene_shard["entity_id"],
                **deepcopy(scene_shard.get("player_safe") or {}),
                "on_enter": {
                    "san_triggers": deepcopy(
                        (scene_shard.get("keeper_only") or {}).get("san_triggers") or []
                    ),
                },
                "affordances": [
                    {
                        **deepcopy(row),
                        **(
                            {
                                "rules_operation": {
                                    "kind": op.get("kind"),
                                }
                            }
                            if (
                                op := next(
                                    (
                                        item
                                        for item in (
                                            (scene_shard.get("keeper_only") or {}).get(
                                                "affordance_operations"
                                            )
                                            or []
                                        )
                                        if item.get("affordance_id") == row.get("id")
                                    ),
                                    None,
                                )
                            )
                            else {}
                        ),
                    }
                    for row in (scene_shard.get("player_safe") or {}).get("affordances") or []
                    if isinstance(row, dict)
                ],
                "scene_edges": deepcopy(
                    (scene_shard.get("player_safe") or {}).get("scene_edges") or []
                ),
                "npc_ids": list(
                    (scene_shard.get("player_safe") or {}).get("npc_ids") or []
                ),
                "available_clues": list(
                    (scene_shard.get("player_safe") or {}).get("available_clue_ids") or []
                ),
                "parse_state": scene_shard.get("parse_state"),
                "evidence_gap": bool(scene_shard.get("evidence_gap")),
                "source_context_mentions": deepcopy(
                    (scene_shard.get("keeper_only") or {}).get(
                        "source_context_mentions"
                    )
                    or []
                ),
                "_archive_pending_handout_cards": deepcopy(
                    (scene_shard.get("keeper_only") or {}).get(
                        "pending_handout_cards"
                    )
                    or []
                ),
                "_archive_source_refs": deepcopy(
                    (scene_shard.get("provenance") or {}).get("source_refs")
                    or []
                ),
            }
            for npc_shard in archive_packet.get("npcs") or []:
                keeper_npc = npc_shard.get("keeper_only") or {}
                identity_source = (
                    keeper_npc.get("identity_source")
                    or {"npc_id": npc_shard.get("entity_id")}
                )
                static_npcs[str(npc_shard["entity_id"])] = {
                    **deepcopy(identity_source),
                    **deepcopy(npc_shard.get("player_safe") or {}),
                    # Agenda is keeper-only but meaning-bearing identity data.
                    # The archive must expose it to the same identity contract
                    # as canonical IR; omitting it made scene.context and
                    # npc.query disagree about one authored NPC.
                    "agenda": keeper_npc.get("agenda"),
                    "mechanics": deepcopy(keeper_npc.get("mechanics")),
                    "source_refs": deepcopy(
                        (npc_shard.get("provenance") or {}).get("source_refs") or []
                    ),
                    # Source readiness travels with the identity so the hot
                    # path never presents a stub NPC as fully parsed.
                    "parse_state": npc_shard.get("parse_state"),
                    "evidence_gap": bool(npc_shard.get("evidence_gap")),
                    "npc_id": npc_shard["entity_id"],
                }
            for clue_shard in archive_packet.get("clues") or []:
                static_clues[str(clue_shard["entity_id"])] = {
                    **deepcopy(clue_shard.get("player_safe") or {}),
                    **{
                        key: deepcopy(value)
                        for key, value in (clue_shard.get("keeper_only") or {}).items()
                        if key in {"player_safe_summary", "localized_text", "mentions", "source_npc_ids"}
                    },
                    "clue_id": clue_shard["entity_id"],
                }
            drilldown_refs = deepcopy(archive_packet.get("drilldown_refs") or drilldown_refs)
            archive_meta = {
                "archive_revision": archive_packet.get("archive_revision"),
                "covered_domains": list(archive_packet.get("covered_domains") or []),
                "source": "compiled_archive",
            }
            # Inject keeper affordance ops from archive for mechanics block.
            scene["_archive_affordance_operations"] = deepcopy(
                (scene_shard.get("keeper_only") or {}).get("affordance_operations") or []
            )
        except coc_compiled_archive.CompiledArchiveError as exc:
            warnings.append(
                f"compiled archive unavailable ({exc.code}); falling back to scenario IR"
            )
            scene = _scene_by_id(sg, active_id)
        except Exception as exc:  # noqa: BLE001 — never block scene.context on archive
            warnings.append(
                f"compiled archive read failed; falling back to scenario IR ({exc})"
            )
            scene = _scene_by_id(sg, active_id)
    else:
        scene = _scene_by_id(sg, active_id)

    if scene is None:
        warnings.append(
            f"active scene '{active_id}' not found in story graph — use scene.map / state.move_scene"
        )

    npc_state = coc_npc_state.load_npc_state(ctx.campaign_dir)
    presence_document = _load_npc_presence_document(ctx)
    live_presence = presence_document["presence"]
    (
        _campaign_npc_ids,
        campaign_names,
        name_conflicts,
        _impression_document,
        _accepted_table_names,
    ) = _campaign_npc_projection_index(ctx, npc_state)
    party_ids = ctx.party_ids()
    impression_investigator: str | None = None
    if args.get("investigator") is not None:
        impression_investigator = _resolve_investigator(ctx, args)
    elif len(party_ids) == 1:
        impression_investigator = party_ids[0]
    authored_presence_ids = [
        str(npc_id)
        for npc_id in ((scene or {}).get("npc_ids") or [])
        if str(npc_id or "").strip()
    ]
    present_npc_ids: list[str] = []
    for npc_id in authored_presence_ids:
        live = live_presence.get(npc_id)
        if live is None or (
            live.get("status") == "present"
            and str(live.get("scene_id")) == str(active_id)
        ):
            present_npc_ids.append(npc_id)
    for npc_id, live in live_presence.items():
        if (
            live.get("status") == "present"
            and str(live.get("scene_id")) == str(active_id)
            and str(npc_id) not in present_npc_ids
        ):
            present_npc_ids.append(str(npc_id))

    npcs = []
    current_npc_mechanics: dict[str, Any] = {}
    for npc_id in present_npc_ids:
        agenda = static_npcs.get(str(npc_id)) or _npc_by_id(ctx.npc_agendas, npc_id) or {}
        psych = (npc_state.get("psych") or {}).get(str(npc_id)) or {}
        normalized_psych = coc_npc_state.normalize_entry(psych)
        impression = (
            normalized_psych.get("impressions", {}).get(impression_investigator)
            if impression_investigator
            else None
        )
        identity = (
            _npc_identity_contract(agenda, str(active_id) if active_id else None)
            if agenda
            else None
        )
        mechanics = agenda.get("mechanics") if isinstance(agenda.get("mechanics"), dict) else {}
        mechanics_status = str(mechanics.get("status") or "unresolved")
        if mechanics_status == "authored" and isinstance(mechanics.get("profile"), dict):
            current_npc_mechanics[str(npc_id)] = deepcopy(mechanics["profile"])
        npcs.append({
            "npc_id": npc_id,
            "name": agenda.get("name") or campaign_names.get(str(npc_id)),
            "origin": agenda.get("origin") if agenda else "improvised",
            "agenda": agenda.get("agenda"),
            "voice": agenda.get("voice"),
            "relationship_to_investigators": agenda.get("relationship_to_investigators"),
            "social_role": deepcopy(agenda.get("social_role")),
            "role_label": agenda.get("role_label"),
            "availability": normalized_psych.get("availability") or agenda.get("availability"),
            "trust": normalized_psych.get("trust", 0),
            "fear": normalized_psych.get("fear", 0),
            "suspicion": normalized_psych.get("suspicion", 0),
            "impression": deepcopy(impression) if isinstance(impression, dict) else None,
            # scene.context is the hot path, so keep the stable identity and
            # current performance facts without embedding the full identity
            # contract a second time.  npc.query remains the exact drilldown.
            "identity_ref": (
                identity.get("identity_ref")
                if isinstance(identity, dict)
                else None
            ),
            "profile_revision_ref": (
                identity.get("profile_revision_ref")
                if isinstance(identity, dict)
                else None
            ),
            "presence": deepcopy(live_presence.get(str(npc_id))),
            "presence_source": (
                "live" if str(npc_id) in live_presence else "authored_initial"
            ),
            "mechanics_status": mechanics_status,
            "mechanics_ref": f"npc:{npc_id}",
            # Source-readiness is authoritative identity data, not decoration:
            # a named_only/evidence_gap NPC must never read as a fully parsed
            # source NPC on the hot path (deepen-pending stubs are not
            # complete). Improvised NPCs (no agenda row) stay unmarked — their
            # origin already says so. Non-progressive campaigns whose IR rows
            # carry no parse_state are never marked as gapped.
            "parse_state": agenda.get("parse_state") if agenda else None,
            "evidence_gap": (
                not (str(agenda.get("parse_state") or "named_only") in {"deep", "body_parsed"})
            ) if agenda and agenda.get("parse_state") else False,
        })
    if name_conflicts & set(present_npc_ids):
        warnings.append(
            "campaign-local first-impression receipts disagree on a present "
            "NPC display name; the earliest canonical name was preserved"
        )

    clues = []
    for clue_id in (scene or {}).get("available_clues") or []:
        clue = static_clues.get(str(clue_id)) or _clue_by_id(ctx.clue_graph, str(clue_id))
        if clue is not None:
            clues.append(_clue_public_view(clue, discovered))
        else:
            clues.append({"clue_id": clue_id, "discovered": str(clue_id) in discovered})

    candidates = coc_scene_graph.transition_candidates(active_id, sg, dict(world))
    authored_edges = list((scene or {}).get("scene_edges") or [])
    if authored_edges:
        edges = [
            {
                "to": edge.get("to"),
                "kind": edge.get("kind"),
                "when": edge.get("when"),
                **(
                    {"travel_minutes": edge["travel_minutes"]}
                    if edge.get("travel_minutes") is not None
                    else {}
                ),
            }
            for edge in authored_edges
            if isinstance(edge, dict) and edge.get("to")
        ]
    else:
        edges = coc_scene_graph.derive_scene_edges(sg).get(str(active_id or ""), [])
    exits = []
    for edge in edges:
        target = str(edge["to"])
        prefilled_arguments = {"scene_id": target}
        if edge.get("travel_minutes") is not None:
            prefilled_arguments["travel_minutes"] = edge["travel_minutes"]
        exits.append({
            "to": target,
            "kind": edge.get("kind"),
            "when": edge.get("when"),
            **(
                {"travel_minutes": edge["travel_minutes"]}
                if edge.get("travel_minutes") is not None
                else {}
            ),
            "open": target in candidates,
            "operation_opportunity": {
                "operation": "state.move_scene",
                "invoke_via": "coc_invoke",
                "prefilled_arguments": prefilled_arguments,
                "missing_arguments": ["reason", "decision_id"],
                **(
                    {
                        "argument_boundary": {
                            "submission_shape": "prefilled_plus_missing_only",
                            "forbidden_arguments": ["travel_minutes"],
                            "reason": (
                                "travel_minutes is valid only when source-authored "
                                "and prefilled"
                            ),
                        }
                    }
                    if "travel_minutes" not in prefilled_arguments else {}
                ),
                "authority": "advisory",
                "hard_gate": False,
            },
        })

    pacing = ctx.pacing()
    fired_san_triggers = {
        str(value) for value in (world.get("san_triggers_fired") or []) if value
    }
    pending_san_triggers = []
    for trigger in ((scene or {}).get("on_enter") or {}).get("san_triggers") or []:
        if not isinstance(trigger, dict) or not trigger.get("trigger_id"):
            continue
        projected = deepcopy(trigger)
        projected["status"] = (
            "fired" if str(trigger["trigger_id"]) in fired_san_triggers else "pending"
        )
        pending_san_triggers.append(projected)

    flag_continuity = _world_flag_continuity(ctx)
    active_time_markers = _active_time_markers(ctx)
    try:
        exceptional_document = coc_exceptional_effects.load(ctx.campaign_dir)
    except ValueError as exc:
        raise ToolError("state_corrupt", str(exc)) from exc
    active_exceptional_effects = []
    for effect in exceptional_document["effects"].values():
        mechanics = effect.get("mechanics") or {}
        scoped_scene = mechanics.get("scene_id")
        if (
            effect.get("status") != "active"
            or (scoped_scene is not None and scoped_scene != active_id)
        ):
            continue
        active_exceptional_effects.append({
            "effect_id": effect["effect_id"],
            "direction": effect["direction"],
            "effect_kind": effect["effect_kind"],
            "player_visible_impact": effect["player_visible_impact"],
            "causal_link": effect["causal_link"],
            "boundary": deepcopy(effect["boundary"]),
            "mechanics": deepcopy(effect["mechanics"]),
            "visibility": effect["visibility"],
            "status": effect["status"],
        })
    active_exceptional_effects.sort(key=lambda row: row["effect_id"])
    # Compact keeper-facing narrative brief per party member (structured sheet
    # fields + sanity engine state only; no prose scanning). Lets the default
    # turn path see APP/CR/build/occupation/age and active madness without a
    # director.advise call.
    party_investigators = []
    play_language = _campaign_play_language(ctx)
    for member_id in ctx.party_ids():
        try:
            member_sheet = ctx.sheet(member_id)
        except ToolError:
            warnings.append(
                f"party member '{member_id}' has no readable character sheet; "
                "skipped in party_investigators"
            )
            continue
        member_chars = member_sheet.get("characteristics") or {}
        member_derived = member_sheet.get("derived") or {}
        member_skills = member_sheet.get("skills") or {}
        member_cr_raw = member_skills.get("Credit Rating", 0)
        member_cr = int(member_cr_raw) if member_cr_raw is not None else 0
        san_signal = coc_rule_signals.read_sanity_engine_state(
            ctx.campaign_dir, member_id
        )
        madness = {
            "bout_active": bool(san_signal.get("bout_active")),
            "temporary_insane": bool(san_signal.get("temporary_insane")),
            "indefinite_insane": bool(san_signal.get("indefinite_insane")),
            "delusion_active": bool(san_signal.get("delusion_active")),
        }
        if san_signal.get("phobia"):
            madness["phobia"] = san_signal["phobia"]
        if san_signal.get("mania"):
            madness["mania"] = san_signal["mania"]
        member_luck = member_derived.get("Luck", member_chars.get("LUCK"))
        try:
            member_live = ctx.inv_state(member_id)
        except ToolError:
            member_live = {}
        live_luck = member_live.get("current_luck")
        if _is_exact_int(live_luck) and live_luck >= 0:
            member_luck = live_luck
        hp_max = member_live.get("hp_max", member_derived.get("HP"))
        mp_max = member_derived.get("MP")
        party_investigators.append({
            "investigator_id": member_id,
            "name": member_sheet.get("name"),
            "occupation": member_sheet.get("occupation"),
            "age": member_sheet.get("age"),
            "app": member_chars.get("APP"),
            "credit_rating": member_cr,
            "credit_tier": coc_rule_signals.read_credit_tier(member_cr),
            "build": member_derived.get("Build", member_derived.get("BUILD")),
            "mov": member_derived.get("MOV"),
            "luck": member_luck,
            "hp": {
                "current": member_live.get("current_hp", member_derived.get("HP")),
                "max": hp_max,
            },
            "mp": {
                "current": member_live.get("current_mp", mp_max),
                "max": mp_max,
            },
            "san": {
                "current": san_signal.get("current_san"),
                "max": san_signal.get("max_san"),
            },
            "cthulhu_mythos": san_signal.get("cm_value"),
            "madness": madness,
            "conditions": san_signal.get("conditions") or [],
        })
        finance_brief = _party_runtime_finance(member_live, play_language)
        if finance_brief is not None:
            party_investigators[-1]["finance"] = finance_brief
    archive_ops = (scene or {}).get("_archive_affordance_operations")
    if isinstance(archive_ops, list):
        affordance_operations = deepcopy(archive_ops)
    else:
        affordance_operations = [
            {
                "affordance_id": affordance.get("id"),
                "kind": affordance["rules_operation"].get("kind"),
                "tool": (
                    "combat.resolve"
                    if affordance["rules_operation"].get("kind")
                    == "combat_engagement"
                    else None
                ),
            }
            for affordance in (scene or {}).get("affordances") or []
            if isinstance(affordance, dict)
            and isinstance(affordance.get("rules_operation"), dict)
        ]
    progressive_projection: dict[str, Any] | None = None
    if ctx.campaign_dir is not None:
        asset_root_id = coc_module_project.campaign_asset_root_id(ctx.campaign_dir)
        if asset_root_id:
            progressive_projection = _source_host_work_projection(
                ctx, asset_root_id,
            )
    # Player-safe discovered-clue index for table HUD / compact hosts.
    # Full clues.query may be payload-projected on coding hosts; this list is
    # intentionally small (id + public summary only, never undiscovered text).
    discovered_clues_public: list[dict[str, Any]] = []
    for clue_id in sorted(discovered):
        clue_row = _clue_by_id(ctx.clue_graph, str(clue_id))
        if clue_row is None:
            discovered_clues_public.append({
                "clue_id": str(clue_id),
                "discovered": True,
                "player_safe_summary": None,
            })
            continue
        view = _clue_public_view(clue_row, discovered)
        summary = view.get("player_safe_summary")
        if isinstance(summary, str) and len(summary) > 160:
            summary = summary[:157] + "..."
        localized = view.get("localized_text")
        if isinstance(localized, dict):
            trimmed: dict[str, str] = {}
            for lang, text in localized.items():
                if isinstance(text, str) and text.strip():
                    trimmed[str(lang)] = (
                        text if len(text) <= 160 else text[:157] + "..."
                    )
            localized = trimmed or None
        else:
            localized = None
        discovered_clues_public.append({
            "clue_id": str(clue_id),
            "discovered": True,
            "player_safe_summary": summary,
            "localized_text": localized,
        })
    if len(discovered_clues_public) > 32:
        discovered_clues_public = discovered_clues_public[:32]

    def _brief_source_refs(value: Any) -> list[dict[str, Any]]:
        """Keep exact source identity without repeating bulky review metadata."""
        out: list[dict[str, Any]] = []
        for ref in value or []:
            if not isinstance(ref, dict):
                continue
            row = {
                key: deepcopy(ref[key])
                for key in ("source_id", "pdf_index", "text_sha256")
                if ref.get(key) is not None
            }
            if row:
                out.append(row)
        return out

    source_context_mentions: list[dict[str, Any]] = []
    for mention in (scene or {}).get("source_context_mentions") or []:
        if not isinstance(mention, dict):
            continue
        projected = {
            key: deepcopy(mention[key])
            for key in ("kind", "ref_id", "name", "raw_label", "note")
            if mention.get(key) is not None
        }
        mention_refs = _brief_source_refs(mention.get("source_refs"))
        if mention_refs:
            projected["source_refs"] = mention_refs
        if projected:
            source_context_mentions.append(projected)
    scene_source_refs = _brief_source_refs(
        (scene or {}).get("_archive_source_refs")
        or (scene or {}).get("source_refs")
        or []
    )
    delivered_handout_ids = {
        str(value)
        for value in (world.get("delivered_handout_ids") or [])
        if str(value).strip()
    }
    raw_pending_handouts = (scene or {}).get("_archive_pending_handout_cards")
    if not isinstance(raw_pending_handouts, list):
        raw_pending_handouts = coc_compiled_archive.pending_read_aloud_metadata(
            str(active_id or ""),
            (scene or {}).get("display_name"),
            (scene or {}).get("read_aloud") or [],
        )
    pending_handouts = [
        deepcopy(row)
        for row in raw_pending_handouts
        if isinstance(row, dict)
        and str(row.get("asset_id") or "").strip()
        and str(row.get("asset_id")) not in delivered_handout_ids
    ]

    data = {
        "campaign_id": ctx.campaign_id,
        "active_scene_id": active_id,
        "scene": {
            "scene_type": (scene or {}).get("scene_type"),
            "dramatic_question": (scene or {}).get("dramatic_question"),
            "player_safe_summary": (scene or {}).get("player_safe_summary"),
            "tone": (scene or {}).get("tone"),
            "location_tags": (scene or {}).get("location_tags"),
            "pressure_moves": (scene or {}).get("pressure_moves"),
            "exit_conditions": (scene or {}).get("exit_conditions"),
            "allowed_improvisation": (scene or {}).get("allowed_improvisation"),
        } if scene else None,
        "source_material": {
            "schema_version": 1,
            "keeper_only": True,
            "authority": "source_authored_context",
            "player_safe_summary": (scene or {}).get("player_safe_summary"),
            "contextual_mentions": source_context_mentions,
            "source_refs": scene_source_refs,
            "disclosure": {
                "authority": "advisory",
                "hard_gate": False,
                "opening_teaser_is_not_delivery": True,
                "semantic_policy": (
                    "Opening narration may establish only the scene teaser. "
                    "When the player naturally asks to hear a source-authored "
                    "briefing, commission, or explanation through a fitting "
                    "present speaker, use every materially relevant current-"
                    "scene fact here that speaker can reveal. Decide relevance, "
                    "secrecy, and phrasing semantically; do not count fields, "
                    "treat mentions as presence, or dump this object."
                ),
            },
        } if scene and (source_context_mentions or scene_source_refs) else None,
        "scene_contract": _scene_contract_projection(ctx, active_id, world),
        # Where the main line stands: which authored objectives the investigators
        # have worked out, and how many independent routes each still wants. The
        # engine computes this and used to keep it inside the epistemic
        # subsystem, so the Keeper had no passive read on whether the story had
        # advanced — the only pacing signal that reached transition scoring was
        # "play has stalled". Advisory, and never a gate: the Keeper moves the
        # story wherever the fiction goes and reads this while deciding.
        "story_progress": {
            # Where the main line stands, now with the action-quest board
            # riding beside it: which offered/active quests exist and which
            # are machine-ready. Same facts as quest.map, compressed to the
            # planning summary; still advisory and never a gate.
            **coc_belief_state.core_objective_progress(
                ctx.clue_graph, world.get("discovered_clue_ids"),
            ),
            "quests": coc_quest_state.quest_progress_summary(
                ctx.campaign_dir, world=world, root=ctx.root,
            ),
        },
        "npcs_present": npcs,
        "clues_here": clues,
        "discovered_clue_count": len(discovered),
        "discovered_clues_public": discovered_clues_public,
        "exits": exits,
        "party": ctx.party_ids(),
        "party_investigators": party_investigators,
        "tension_level": pacing.get("tension_level"),
        "turn_number": pacing.get("turn_number"),
        "time": coc_time.current_stamp(ctx.campaign_dir),
        "progressive": progressive_projection,
        "continuity": {
            "schema_version": 1,
            "keeper_only": True,
            "state_precedence": "live_over_authored_initial",
            **flag_continuity,
            "active_time_markers": active_time_markers,
            "active_exceptional_effects": active_exceptional_effects,
        },
        "exit_ready": str(active_id) in {str(s) for s in world.get("exit_ready_scene_ids") or []},
        "pending_san_triggers": [
            trigger for trigger in pending_san_triggers if trigger["status"] == "pending"
        ],
        # Body-free source card metadata for semantic Keeper timing. The
        # canonical handout query remains the only way to read an undelivered
        # card body; this list never authorizes or auto-triggers delivery.
        "pending_handouts": pending_handouts,
        "keeper_mechanics": {
            "secret": True,
            "affordance_operations": affordance_operations,
            "npc_profiles": current_npc_mechanics,
        },
        # The main line with what would advance it, assembled so that planning a
        # next beat costs the Keeper one read instead of four cross-references.
        "story_thread": {
            "schema_version": 1,
            "keeper_only": True,
            "authority": "advisory",
            "note": (
                "What the main line still wants, and where it can be reached "
                "from here. Proposes nothing and gates nothing — the beat is "
                "yours; this is the same facts in planning order."
            ),
            "outstanding": _story_thread(ctx),
        },
        # The module's own pushes, waiting in this scene. Kept beside the routes
        # so the Keeper sees both halves of what is available: what the players
        # can reach for, and what the module intends to reach for them.
        "pending_deliveries": {
            "schema_version": 1,
            "keeper_only": True,
            "authority": "advisory",
            "note": (
                "Clues this scene delivers by event rather than by the players "
                "earning them. They are not routes and must not be offered as "
                "choices; the module means them to happen. Timing is yours."
            ),
            "clues": _pending_deliveries(ctx),
        },
        "nearby_routes": {
            "schema_version": 1,
            "keeper_only": True,
            "authority": "advisory",
            "note": (
                "What neighbouring scenes are holding. When a player reaches for "
                "something this scene does not carry, the module usually keeps it "
                "one move away: move there and the route becomes executable, "
                "rather than improvising content the ledger never sees."
            ),
            "destinations": _nearby_route_index(ctx),
        },
        "action_routes": _project_action_route_cards(
            ctx, include_operation_opportunities=False
        ),
        "operation_opportunities": _open_attempt_opportunities(
            ctx, scene_id=str(active_id or "") or None,
        ),
        "compiled_archive": archive_meta or {
            "source": "scenario_ir_fallback",
            "archive_revision": None,
            "covered_domains": [],
        },
        "covered_domains": covered_domains + (
            list((archive_meta or {}).get("covered_domains") or [])
        ),
        "drilldown_refs": drilldown_refs,
    }
    focused_investigator = impression_investigator or (
        party_ids[0] if party_ids else None
    )
    healing_cards = _project_healing_decision_cards(ctx, focused_investigator)
    data["rule_decision_cards"] = healing_cards
    recovery = data.get("recovery") if isinstance(data.get("recovery"), dict) else {}
    recovery["healing"] = {
        "family": "healing",
        "investigator_id": healing_cards.get("investigator_id"),
        "cards": list(healing_cards.get("cards") or []),
        "authority": healing_cards.get("authority") or {
            "hard_gate": False,
            "role": "affordance",
        },
    }
    data["recovery"] = recovery
    # Lightweight next-beat recommendation so the KP always has a forward nudge
    # without a separate director.advise call.
    _undiscovered_here = [c for c in clues if not c.get("discovered")]
    _agenda_npcs = [
        n for n in npcs
        if n.get("agenda") and n.get("mechanics_status") != "resolved"
    ]
    _pressure = (scene or {}).get("pressure_moves") or []
    _turn = pacing.get("turn_number") or 0
    _next_beat: dict[str, Any] = {"action": "CONTINUE", "reason": "no urgent signal"}
    if _agenda_npcs:
        _top_npc = _agenda_npcs[0]
        _next_beat = {
            "action": "NPC_MOVE",
            "npc_id": _top_npc["npc_id"],
            "agenda": _top_npc.get("agenda"),
            "reason": "present NPC has an unresolved agenda; advance it this turn",
        }
    elif _undiscovered_here and _turn > 2:
        _next_beat = {
            "action": "REVEAL",
            "clue_ids": [c.get("clue_id") for c in _undiscovered_here[:2]],
            "reason": "undiscovered clues exist and the scene has had time; surface one",
        }
    elif _pressure:
        _next_beat = {
            "action": "PRESSURE",
            "moves": _pressure[:2],
            "reason": "authored pressure moves are available; escalate tension",
        }
    data["recommended_next_beat"] = _next_beat
    hints: list[str] = []
    undiscovered = [c for c in clues if not c.get("discovered")]
    if undiscovered:
        hints.append(f"{len(undiscovered)} clue(s) here are still undiscovered")
    if data["pending_san_triggers"]:
        hints.append(
            "pending authored SAN trigger(s): resolve each witnessed trigger with "
            "rules.sanity_check and pass its trigger_id; its chained insanity outcomes "
            "(INT check, bout of madness, indefinite threshold) are authoritative state, "
            "not advisory"
        )
    scene_contract = data.get("scene_contract")
    if isinstance(scene_contract, dict):
        budget = (
            scene_contract.get("improv_budget")
            if isinstance(scene_contract.get("improv_budget"), dict)
            else {}
        )
        consumption = scene_contract.get("budget_consumption") or {}
        clue_cap = budget.get("local_clues")
        if (
            isinstance(clue_cap, int)
            and not isinstance(clue_cap, bool)
            and int(consumption.get("improvised_clues") or 0) > clue_cap
        ):
            warnings.append(
                f"improv budget exceeded: {consumption['improvised_clues']} improvised "
                f"clues at this scene (budget {clue_cap})"
            )
        npc_cap = budget.get("named_npcs")
        if (
            isinstance(npc_cap, int)
            and not isinstance(npc_cap, bool)
            and int(consumption.get("improvised_npcs") or 0) > npc_cap
        ):
            warnings.append(
                f"improv budget exceeded: {consumption['improvised_npcs']} improvised "
                f"named NPCs at this scene (budget {npc_cap})"
            )
        if scene_contract.get("effective_role") == "transit":
            hints.append(
                "transit scene contract: local facts plus at most one bridge clue; "
                "main-plot truth belongs to later scenes — improvise consequences "
                "and exits, not the mainline"
            )
    if data["keeper_mechanics"]["affordance_operations"]:
        hints.append(
            "structured scene mechanics are keeper-only; use combat.resolve for a "
            "combat_engagement and do not quote operation secrets to the player"
        )
    if data["action_routes"]:
        hints.append(
            "action_routes is the compact authored action working set: prefer direct_delivery without a roll; after semantic route selection, actions.advise returns the exact operation card; all recommendations are advisory and may be overridden by the KP"
        )
    if data["operation_opportunities"]:
        hints.append(
            "an ordinary failure still has a Push/context-change opportunity; do not fish for another roll, but this is a soft recommendation and never blocks play"
        )
    if data["continuity"]["live_world_flags"]:
        hints.append(
            "continuity.live_world_flags is current campaign truth and supersedes "
            "conflicting authored initial descriptions; use it when narrating the live scene"
        )
    if active_time_markers:
        hints.append(
            "active_time_markers are bookkeeping facts only; report their structured "
            "remaining/overdue values, but do not auto-trigger a rescue or block play"
        )
    if progressive_projection and progressive_projection.get(
        "background_takeover"
    ):
        hints.append(
            "progressive.background_takeover exposes exact cached source work for "
            "the existing progressive.claim_host_work operation; claim and dispatch "
            "it in the background. This is advisory and never gates player input, "
            "narration, or unrelated play; only a current settlement that depends on "
            "listed blocking_micro source may wait for that source result"
        )
    elif progressive_projection and progressive_projection["open_host_work"]:
        hints.append(
            "progressive.open_host_work is an unresolved host parsing boundary, not a "
            "completed parse; claim exact cached work for a source child. On a "
            "direct-submit host the parent does not wait, retrieve, poll, or call "
            "progressive.fulfill_host_work; only a host without direct submit uses "
            "the exact-forward fallback"
        )
    if active_exceptional_effects:
        hints.append(
            "active_exceptional_effects are canonical continuity: honor their explicit boundary. "
            "rules.roll fail-closes matching one-shot bonus/penalty dice; restrictions, "
            "conditions, and scene events remain KP-owned fictional constraints rather than hard scene gates"
        )
    if len(party_ids) > 1 and impression_investigator is None:
        hints.append(
            "scene.context has multiple investigators; pass investigator explicitly to project one pair-scoped NPC impression"
        )
    elif impression_investigator:
        hints.append(
            f"npcs_present.impression is the bounded textual memory for investigator '{impression_investigator}'; use it as semantic context, never as a hard gate"
        )
    if archive_meta and archive_meta.get("archive_revision"):
        hints.append(
            "compiled_archive supplies active-scene authored material; drilldown_refs "
            "list exact entity ids still available without rescanning the whole module"
        )
    if data.get("source_material"):
        hints.append(
            "source_material is keeper-only authored context, not player knowledge: "
            "opening prose may be only a teaser, so semantically honor a natural "
            "request for the complete current briefing or explanation using relevant "
            "facts and their source refs; mentions never assert presence or force disclosure"
        )
    hints.append(
        "optional pacing support: call director.advise on scene entry, after repeated approaches, or when momentum stalls; its suggestions are advisory and may be ignored"
    )
    hints.append(
        "optional enrichment support: call storylets.suggest when a personal callback or atmospheric beat would help; absence of a fitting storylet never blocks play"
    )
    if data.get("rule_decision_cards", {}).get("cards"):
        hints.append(
            "rule_decision_cards / recovery.healing are advisory healing affordances; "
            "settle a card with rules.settle. They never gate actions, and an empty "
            "card set never blocks play"
        )
    return data, warnings, hints

_TURN_RECOVERY_MEANINGFUL_QUERIES = frozenset({"actions.advise"})

_TURN_RECOVERY_NON_TURN_MUTATIONS = frozenset({
    "evidence.table_opening",
    "session.delivery_ack",
    "setup.complete",
})

def _turn_recovery_meaningful_tools() -> frozenset[str]:
    """Classify recoverable turn work from registered structured authority."""
    return frozenset(
        name
        for name, spec in TOOLS.items()
        if (
            spec.get("access") == "mutation"
            and name not in _TURN_RECOVERY_NON_TURN_MUTATIONS
        )
        or name in _TURN_RECOVERY_MEANINGFUL_QUERIES
    )

def _opening_card(
    operation: str,
    prefilled_arguments: dict[str, Any],
    missing_arguments: list[str],
) -> dict[str, Any]:
    return {
        "operation": operation,
        "invoke_via": "coc_invoke",
        "prefilled_arguments": deepcopy(prefilled_arguments),
        "missing_arguments": list(missing_arguments),
    }

def _source_submit_lock_path(ctx: Ctx) -> Path:
    assets_mod = coc_module_project.coc_module_assets
    return assets_mod.assets_root(ctx.root) / ".source-submit.lock"

_LOCATION_PACK_STRUCTURAL_FIELDS = frozenset({
    "location_id", "source_page_indices", "source_refs",
})

_LOCATION_PACK_DEFAULT_SEMANTIC_FIELDS = ("title", "player_safe_summary")

def _normalized_verbatim_excerpt(value: str) -> str:
    lines = value.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    return "\n".join(line.rstrip() for line in lines).strip()

def _require_handout_text_evidence(
    text: str,
    request: dict[str, Any],
    supplied_refs: list[str],
    *,
    root: Path,
    root_id: str,
) -> None:
    """Bind source-verbatim card text to current cited cached page bytes."""
    expected_by_ref = {
        str(row.get("card_source_ref") or ""): row
        for row in (request.get("result_contract") or {}).get(
            "allowed_exact_source_refs"
        ) or []
        if isinstance(row, dict) and str(row.get("card_source_ref") or "")
    }
    cited_pages: list[str] = []
    for source_ref in supplied_refs:
        expected = expected_by_ref.get(source_ref)
        if not isinstance(expected, dict):
            raise ToolError(
                "invalid_source_worker_pack",
                "handout text cites an unavailable cached page",
            )
        pdf_index = expected.get("pdf_index")
        if isinstance(pdf_index, bool) or not isinstance(pdf_index, int):
            raise ToolError(
                "invalid_state", "handout request cached page identity is invalid",
            )
        current_ref = (
            coc_module_project.coc_module_assets.cached_page_ref(
                root, root_id, pdf_index,
            )
        )
        if not isinstance(current_ref, dict) or any(
            current_ref.get(field) != expected.get(field)
            for field in ("source_id", "pdf_index", "text_sha256")
        ):
            raise ToolError(
                "invalid_source_worker_pack",
                "handout cited cached page bytes drifted after request creation",
            )
        page = coc_module_project.coc_module_assets.get_page(
            root, root_id, pdf_index,
        )
        page_text = page.get("text") if isinstance(page, dict) else None
        if not isinstance(page_text, str):
            raise ToolError(
                "invalid_source_worker_pack",
                "handout cited cached page text is unavailable",
            )
        canonical_page = page_text.replace("\r\n", "\n").replace("\r", "\n")
        if not canonical_page.endswith("\n"):
            canonical_page += "\n"
        normalized_page = _normalized_verbatim_excerpt(canonical_page)
        if hashlib.sha256(canonical_page.encode("utf-8")).hexdigest() != str(
            expected.get("text_sha256") or ""
        ):
            raise ToolError(
                "invalid_source_worker_pack",
                "handout cited cached page bytes do not match their hash",
            )
        cited_pages.append(normalized_page)
    excerpt = _normalized_verbatim_excerpt(text)
    if not excerpt or (
        all(excerpt not in page for page in cited_pages)
        and excerpt not in "\n".join(cited_pages)
    ):
        raise ToolError(
            "invalid_source_worker_pack",
            "handout verbatim text is absent from its cited cached pages",
        )

def _require_closed_handout_worker_pack(
    pack: dict[str, Any],
    request: dict[str, Any],
    *,
    root_id: str,
    root: Path,
    target_id: str,
    related_packs: Any,
) -> None:
    """Reject handout child output outside its exact pages/assets before put."""
    contract = request.get("result_contract")
    if (
        not isinstance(contract, dict)
        or contract.get("contract_id") != "coc.handout-card-pack.v1"
        or contract.get("closed") is not True
    ):
        raise ToolError(
            "invalid_state", "deepen_handout request lacks its closed card contract",
        )
    if related_packs not in (None, []):
        raise ToolError(
            "invalid_source_worker_pack", "handout fulfillment requires related_packs=[]",
        )
    allowed_fields = set(contract.get("allowed_pack_fields") or [])
    required_fields = set(contract.get("required_pack_fields") or [])
    # host_timing is injected above by repository lease measurement; it is
    # never a worker-allowed semantic field in the closed card contract.
    worker_fields = set(pack) - {"host_timing"}
    extra = sorted(worker_fields - allowed_fields)
    missing = sorted(required_fields - worker_fields)
    if extra or missing:
        detail = (
            f"unsupported fields: {', '.join(extra)}" if extra
            else f"missing required fields: {', '.join(missing)}"
        )
        raise ToolError("invalid_source_worker_pack", detail)
    fixed = contract.get("fixed_fields")
    if not isinstance(fixed, dict):
        raise ToolError("invalid_state", "handout result contract fixed fields are invalid")
    for field, expected in fixed.items():
        if pack.get(field) != expected:
            message = (
                "player_visible=true is required for a source handout result"
                if field == "player_visible"
                else f"pack.{field} must equal the request-bound value"
            )
            raise ToolError("invalid_source_worker_pack", message)
    if pack.get("handout_id") != target_id or pack.get("asset_id") != target_id:
        raise ToolError(
            "invalid_source_worker_pack",
            "handout_id and asset_id must equal the request target_id",
        )
    if pack.get("kind") not in set(contract.get("kind_values") or []):
        raise ToolError("invalid_source_worker_pack", "handout kind is unsupported")
    if not isinstance(pack.get("title"), str) or not str(pack["title"]).strip():
        raise ToolError("invalid_source_worker_pack", "handout title must be non-empty")
    provenance = pack.get("provenance")
    expected_provenance = (contract.get("provenance") or {}).get("required")
    if provenance != expected_provenance:
        raise ToolError(
            "invalid_source_worker_pack",
            "handout provenance must be exactly source_authored host_pack",
        )
    allowed_source_refs = {
        str(row.get("card_source_ref") or "")
        for row in contract.get("allowed_exact_source_refs") or []
        if isinstance(row, dict) and str(row.get("card_source_ref") or "")
    }
    supplied_refs = pack.get("source_refs")
    if (
        not isinstance(supplied_refs, list)
        or not supplied_refs
        or any(not isinstance(ref, str) for ref in supplied_refs)
        or len(supplied_refs) != len(set(supplied_refs))
        or not set(supplied_refs) <= allowed_source_refs
    ):
        raise ToolError(
            "invalid_source_worker_pack",
            "handout source_refs must be a unique exact cached page subset",
        )
    try:
        current_relations = (
            coc_module_project.coc_module_assets.handout_allowed_relation_refs(
                root, root_id, target_id,
            )
        )
    except coc_module_project.coc_module_assets.ModuleAssetsError as exc:
        raise ToolError(
            "invalid_source_worker_pack",
            f"handout relation binding is unavailable: {exc}",
        ) from exc
    for field in ("scene_refs", "clue_refs"):
        supplied = pack.get(field, [])
        allowed = request.get(f"allowed_{field}")
        if allowed != current_relations.get(f"allowed_{field}"):
            raise ToolError(
                "invalid_source_worker_pack",
                f"handout allowed {field} drifted after request creation",
            )
        if (
            not isinstance(supplied, list)
            or any(not isinstance(value, str) or not value for value in supplied)
            or len(supplied) != len(set(supplied))
            or not isinstance(allowed, list)
            or not set(supplied) <= set(allowed)
        ):
            raise ToolError(
                "invalid_source_worker_pack",
                f"handout {field} must be a unique subset of allowed {field}",
            )
    image_ref = pack.get("image_ref")
    if image_ref is not None:
        allowed_assets = request.get("allowed_registered_asset_refs")
        if not isinstance(allowed_assets, list) or image_ref not in {
            str(row.get("image_ref") or "")
            for row in allowed_assets if isinstance(row, dict)
        }:
            raise ToolError(
                "invalid_source_worker_pack",
                "handout image_ref must equal one exact registered asset ref",
            )
        try:
            current_assets = (
                coc_module_project.coc_module_assets.registered_source_asset_refs(
                    root,
                    root_id,
                    requested_pdf_indices=list(
                        request.get("requested_pdf_indices") or []
                    ),
                )
            )
        except coc_module_project.coc_module_assets.ModuleAssetsError as exc:
            raise ToolError(
                "invalid_source_worker_pack",
                f"registered asset drifted after request creation: {exc}",
            ) from exc
        expected_rows = [
            row for row in allowed_assets
            if isinstance(row, dict) and row.get("image_ref") == image_ref
        ]
        cited_pdf_indices = {
            coc_module_project.coc_module_assets.handout_card_ref_index(ref)
            for ref in supplied_refs
        }
        if any(
            row.get("pdf_index") not in cited_pdf_indices
            for row in expected_rows
        ):
            raise ToolError(
                "invalid_source_worker_pack",
                "handout image_ref must bind to the same cited page",
            )
        current_rows = [row for row in current_assets if row.get("image_ref") == image_ref]
        if current_rows != expected_rows:
            raise ToolError(
                "invalid_source_worker_pack",
                "registered asset hash or bundle binding drifted after request creation",
            )
    text = pack.get("text")
    if image_ref is None and (not isinstance(text, str) or not text.strip()):
        raise ToolError(
            "invalid_source_worker_pack",
            "handout card requires source text or an exact registered image",
        )
    if isinstance(text, str):
        _require_handout_text_evidence(
            text,
            request,
            supplied_refs,
            root=root,
            root_id=root_id,
        )

def _location_pack_required_semantic_fields(
    request: dict[str, Any],
) -> list[str]:
    """Return the closed semantic fields one fulfilled location pack must carry.

    The static worker-contract floor always applies; a stored request
    result_contract may name additional fields through its
    location_pack.required_semantic_fields / required_location_fields lists.
    """
    required = list(_LOCATION_PACK_DEFAULT_SEMANTIC_FIELDS)
    contract = request.get("result_contract")
    if isinstance(contract, dict):
        named: list[Any] = []
        location_pack = contract.get("location_pack")
        if isinstance(location_pack, dict):
            named.extend(location_pack.get("required_semantic_fields") or [])
        named.extend(contract.get("required_location_fields") or [])
        for value in named:
            text = str(value).strip()
            if (
                text
                and text not in _LOCATION_PACK_STRUCTURAL_FIELDS
                and text not in required
            ):
                required.append(text)
    return required

def _require_location_pack_semantic_fields(
    pack: dict[str, Any],
    request: dict[str, Any],
    *,
    field: str,
) -> None:
    """Reject a location pack that could merge but never satisfy projection."""
    missing = [
        name
        for name in _location_pack_required_semantic_fields(request)
        if not isinstance(pack.get(name), str) or not str(pack.get(name)).strip()
    ]
    if missing:
        raise ToolError(
            "pack_semantic_fields_missing",
            f"{field} is missing contract-required semantic fields: "
            + ", ".join(missing),
        )

def _require_body_location_canonical_identities(
    pack: dict[str, Any],
    request: dict[str, Any],
    *,
    target_id: str,
    field: str,
) -> None:
    """Fail closed on identity aliases for the closed body location contract."""
    contract = request.get("result_contract")
    if (
        not isinstance(contract, dict)
        or contract.get("contract_id") != "coc.location-body-pack.v1"
    ):
        return
    if "entity_id" in pack:
        raise ToolError(
            "invalid_source_worker_pack",
            f"{field} uses forbidden entity_id alias; use location_id",
        )
    location_id = pack.get("location_id")
    if (
        not isinstance(location_id, str)
        or not location_id.strip()
        or location_id.strip() != target_id
    ):
        raise ToolError(
            "invalid_source_worker_pack",
            f"{field}.location_id must equal the bound target_id",
        )
    clues = pack.get("clues")
    if clues is None:
        return
    if not isinstance(clues, list):
        raise ToolError(
            "invalid_source_worker_pack",
            f"{field}.clues must be an array",
        )
    for index, clue in enumerate(clues):
        if not isinstance(clue, dict):
            raise ToolError(
                "invalid_source_worker_pack",
                f"{field}.clues[{index}] must be an object",
            )
        if "id" in clue:
            raise ToolError(
                "invalid_source_worker_pack",
                f"{field}.clues[{index}] uses forbidden id alias; use clue_id",
            )
        clue_id = clue.get("clue_id")
        if not isinstance(clue_id, str) or not clue_id.strip():
            raise ToolError(
                "invalid_source_worker_pack",
                f"{field}.clues[{index}].clue_id must be a non-empty string",
            )

def _apply_opening_setup_observation(
    ctx: Ctx,
    *,
    root_id: str,
    request: dict[str, Any],
    opening_setup: Any,
) -> dict[str, Any]:
    """Validate one closed source-clock observation before entity writes."""
    assets_mod = coc_module_project.coc_module_assets
    if not isinstance(opening_setup, dict):
        raise ToolError(
            "opening_setup_invalid",
            "partial_opening worker result requires opening_setup",
        )
    required = {"schema_version", "contract_id", "status"}
    allowed = required | {"start_clock", "start_clock_source_refs"}
    if set(opening_setup) - allowed or not required <= set(opening_setup):
        raise ToolError(
            "opening_setup_invalid",
            "opening_setup has unsupported or missing fields",
        )
    if (
        opening_setup.get("schema_version") != 1
        or opening_setup.get("contract_id")
        != "coc.opening-setup-observation.v1"
    ):
        raise ToolError(
            "opening_setup_invalid",
            "opening_setup contract must be coc.opening-setup-observation.v1",
        )
    status = str(opening_setup.get("status") or "")
    if status not in {"source", "unresolved"}:
        raise ToolError(
            "opening_setup_invalid",
            "opening_setup.status must be source or unresolved",
        )
    try:
        exact_scope = assets_mod.validate_opening_source_scope(
            ctx.root, root_id, request.get("requested_source_scope"),
        )
    except assets_mod.ModuleAssetsError as exc:
        raise ToolError("opening_setup_invalid", str(exc)) from exc
    if status == "unresolved":
        if set(opening_setup) != required:
            raise ToolError(
                "opening_setup_invalid",
                "unresolved opening_setup must not carry clock data",
            )
        return {"status": "unresolved", "skeleton_updated": False}
    if set(opening_setup) != allowed:
        raise ToolError(
            "opening_setup_invalid",
            "source opening_setup requires start_clock and start_clock_source_refs",
        )
    clock = opening_setup.get("start_clock")
    refs = opening_setup.get("start_clock_source_refs")
    if not isinstance(clock, dict) or not isinstance(refs, list) or not refs:
        raise ToolError(
            "opening_setup_invalid",
            "source opening_setup requires a clock object and non-empty refs",
        )
    try:
        clock = assets_mod.validate_opening_clock(clock)
    except assets_mod.ModuleAssetsError as exc:
        raise ToolError("opening_setup_invalid", str(exc)) from exc
    ref_indices: list[int] = []
    for position, ref in enumerate(refs):
        if not isinstance(ref, dict) or set(ref) != {"source_id", "pdf_index"}:
            raise ToolError(
                "opening_setup_invalid",
                f"start_clock_source_refs[{position}] must contain source_id and pdf_index",
            )
        if ref.get("source_id") != exact_scope["source_id"]:
            raise ToolError(
                "opening_setup_invalid", "clock source_id is outside the request",
            )
        pdf_index = ref.get("pdf_index")
        if (
            isinstance(pdf_index, bool)
            or not isinstance(pdf_index, int)
            or pdf_index not in exact_scope["pdf_indices"]
        ):
            raise ToolError(
                "opening_setup_invalid", "clock source ref is outside the request",
            )
        ref_indices.append(pdf_index)
    if len(ref_indices) != len(set(ref_indices)):
        raise ToolError("opening_setup_invalid", "clock source refs repeat a page")
    skeleton_path = assets_mod._module_dir(ctx.root, root_id) / "skeleton.json"
    lock_path = assets_mod._module_dir(ctx.root, root_id) / "skeleton.lock"
    with coc_fileio.advisory_file_lock(lock_path):
        skeleton = assets_mod.get_skeleton(ctx.root, root_id)
        if not isinstance(skeleton, dict):
            raise ToolError("opening_setup_invalid", "opening skeleton is missing")
        current_status = str(skeleton.get("start_clock_status") or "")
        if current_status not in {"unresolved", "source"}:
            raise ToolError(
                "opening_setup_conflict",
                "existing skeleton clock is not worker-resolvable",
            )
        try:
            canonical_refs = assets_mod._cached_source_refs(
                ctx.root,
                root_id,
                {"source_refs": refs},
                field="opening_setup.start_clock",
            )
        except assets_mod.ModuleAssetsError as exc:
            raise ToolError("opening_setup_invalid", str(exc)) from exc
        if current_status == "source":
            if (
                skeleton.get("start_clock") != clock
                or [
                    (row.get("source_id"), row.get("pdf_index"))
                    for row in skeleton.get("start_clock_source_refs") or []
                ]
                != [
                    (row.get("source_id"), row.get("pdf_index"))
                    for row in canonical_refs
                ]
            ):
                raise ToolError(
                    "opening_setup_conflict",
                    "existing source clock differs from this observation",
                )
            return {
                "status": "source",
                "skeleton_updated": False,
                "skeleton_path": str(skeleton_path),
            }
        updated = deepcopy(skeleton)
        updated["start_clock_status"] = "source"
        updated["start_clock"] = deepcopy(clock)
        updated["start_clock_source_refs"] = canonical_refs
        try:
            # put_skeleton canonicalizes refs and validates the existing clock
            # schema before any entity pack can be written.
            assets_mod.put_skeleton(ctx.root, root_id, updated)
            canonical = assets_mod.get_skeleton(ctx.root, root_id)
        except assets_mod.ModuleAssetsError as exc:
            raise ToolError("opening_setup_invalid", str(exc)) from exc
        assert isinstance(canonical, dict)
    return {
        "status": "source",
        "skeleton_updated": current_status == "unresolved",
        "skeleton_path": str(skeleton_path),
    }

def _fulfill_full_parse_host_work(
    ctx: Ctx,
    *,
    root_id: str,
    request: dict[str, Any],
    job_id: str,
    pack: dict[str, Any],
    args: dict[str, Any],
):
    """Apply one whole-book render batch receipt to the full_parse lane.

    The closed pack is page-level evidence bookkeeping only: it never writes
    entity packs, never touches rules/state authority, and never blocks the
    opening projection.  Authoritative parsed indices are recomputed from the
    accepted cache inside the module-assets transition.
    """
    assets_mod = coc_module_project.coc_module_assets
    allowed_pack = {
        "status", "rendered_pdf_indices", "failed_pdf_indices",
        "failure_class",
    }
    if set(pack) - allowed_pack:
        raise ToolError(
            "invalid_source_worker_pack",
            "full_parse pack contains unsupported fields",
        )
    status = str(pack.get("status") or "")
    if status not in {"partial", "complete", "failed"}:
        raise ToolError(
            "invalid_source_worker_pack",
            "full_parse pack.status must be partial, complete, or failed",
        )
    if status == "failed":
        failure_class = pack.get("failure_class")
        if (
            not isinstance(failure_class, str)
            or not failure_class.strip()
            or "rendered_pdf_indices" in pack
            or "failed_pdf_indices" in pack
        ):
            raise ToolError(
                "invalid_source_worker_pack",
                "failed full_parse pack requires only failure_class",
            )
        try:
            result = assets_mod.record_full_parse_render_result(
                ctx.root,
                root_id,
                job_id=job_id,
                status="failed",
                rendered_pdf_indices=[],
                failed_pdf_indices=[],
                failure_class=str(failure_class)[:256],
            )
        except assets_mod.ModuleAssetsError as exc:
            raise ToolError("invalid_param", str(exc)) from exc
        refreshed = assets_mod.get_host_work_request(ctx.root, root_id, job_id) or {}
        return {
            "asset_root_id": root_id,
            "job_id": job_id,
            "request_status": refreshed.get("status"),
            "full_parse": result,
        }, [], [
            "render failure recorded; the open request stays visible in "
            "progressive.status and the batch is re-dispatched on a later "
            "scene.context until the bounded failure cap",
        ]
    rendered = pack.get("rendered_pdf_indices")
    failed = pack.get("failed_pdf_indices")
    if (
        not isinstance(rendered, list)
        or not isinstance(failed, list)
        or any(
            isinstance(value, bool) or not isinstance(value, int) or value < 0
            for value in rendered
        )
        or any(
            isinstance(value, bool) or not isinstance(value, int) or value < 0
            for value in failed
        )
        or rendered != sorted(set(rendered))
        or failed != sorted(set(failed))
        or set(rendered) & set(failed)
        or pack.get("failure_class") is not None
    ):
        raise ToolError(
            "invalid_source_worker_pack",
            "full_parse rendered/failed indices must be unique, ascending, "
            "disjoint, and failure_class must be null",
        )
    try:
        result = assets_mod.record_full_parse_render_result(
            ctx.root,
            root_id,
            job_id=job_id,
            status=status,
            rendered_pdf_indices=rendered,
            failed_pdf_indices=failed,
            failure_class=None,
        )
    except assets_mod.ModuleAssetsError as exc:
        raise ToolError("invalid_param", str(exc)) from exc
    refreshed = assets_mod.get_host_work_request(ctx.root, root_id, job_id) or {}
    success_hints = [
        "full-parse progress is durable; the request stays claimable for the "
        "next missing batch until progressive.status reports complete",
    ]
    if status == "complete":
        success_hints = [
            "the whole PDF is parsed: every later consumer reads only the "
            "immutable markdown page cache and never reopens the PDF",
        ]
    return {
        "asset_root_id": root_id,
        "job_id": job_id,
        "request_status": refreshed.get("status"),
        "full_parse": result,
    }, [], success_hints

def _mechanics_jobs() -> frozenset[str]:
    """Job kinds that resolve one subject's authored game numbers.

    Read from the assets contract rather than repeated as a literal, so adding
    a subject kind (monsters, most recently) cannot leave one call site
    silently excluding it.
    """
    return frozenset(
        coc_module_project.coc_module_assets.MECHANICS_JOB_FOR_SUBJECT.values()
    )

def _fulfill_host_work_for_asset_unlocked(
    ctx: Ctx, args: dict[str, Any], *, root_id: str,
):
    assets_mod = coc_module_project.coc_module_assets
    opening_setup_result: dict[str, Any] | None = None

    # The preferred path keeps the source child's closed result item intact at
    # the host boundary.  Unwrap it once here, then run the unchanged strict
    # locator/mechanics/body validation below.  Legacy explicit arguments stay
    # available for older callers but may never be merged with this envelope.
    if "worker_result" in args:
        mixed_fields = [
            field for field in (
                "job_id", "pack", "related_packs", "opening_setup",
            )
            if field in args
        ]
        if mixed_fields:
            raise ToolError(
                "invalid_param",
                "worker_result is mutually exclusive with legacy "
                "job_id/pack/related_packs arguments",
            )
        worker_result = args.get("worker_result")
        if not isinstance(worker_result, dict):
            raise ToolError("invalid_param", "worker_result must be an object")
        allowed_worker_fields = {
            "job_id", "pack", "related_packs", "opening_setup",
        }
        if (
            set(worker_result) - allowed_worker_fields
            or not {"job_id", "pack", "related_packs"} <= set(worker_result)
        ):
            raise ToolError(
                "invalid_source_worker_pack",
                "worker_result must contain job_id, pack, related_packs and "
                "may contain only opening_setup in addition",
            )
        exact_result = deepcopy(worker_result)
        if not str(exact_result.get("job_id") or "").strip():
            raise ToolError(
                "invalid_source_worker_pack",
                "worker_result.job_id must be a non-empty string",
            )
        effective_args = exact_result
        if "host_task_timing" in args:
            effective_args["host_task_timing"] = deepcopy(
                args.get("host_task_timing")
            )
        args = effective_args
    elif "job_id" not in args or "pack" not in args:
        raise ToolError(
            "invalid_param",
            "provide worker_result or the legacy job_id and pack arguments",
        )

    job_id = str(args.get("job_id") or "").strip()
    try:
        request = assets_mod.get_host_work_request(
            ctx.root, root_id, job_id,
        )
    except assets_mod.ModuleAssetsError as exc:
        raise ToolError("invalid_state", str(exc)) from exc
    if request is None:
        raise ToolError("not_found", f"host-work job {job_id!r} was not found")
    if request.get("status") in {"fulfilled", "cancelled", "superseded"}:
        raise ToolError(
            "invalid_state",
            f"host-work job {job_id!r} is already {request.get('status')}",
        )
    job_kind = str(request.get("kind") or "")
    if job_kind in {
        assets_mod.CLASSIFY_SECTIONS_KIND, assets_mod.EXTRACT_SECTION_KIND,
        assets_mod.ANNOTATE_IMAGES_KIND,
    }:
        # Structure results are not entity packs: one produces the whole-book
        # index, the other a section document. Both validate against the exact
        # packet that produced them and are stored by the repository, so they
        # take their own sink rather than the entity merge path below.
        pack = args.get("pack")
        if not isinstance(pack, dict):
            raise ToolError(
                "invalid_source_worker_pack", "structure result requires a pack",
            )
        try:
            if job_kind == assets_mod.CLASSIFY_SECTIONS_KIND:
                stored = assets_mod.put_section_index_and_fulfill_host_work(
                    ctx.root, root_id,
                    host_work_job_id=job_id,
                    section_rows=pack.get("sections"),
                )
                data = {
                    "section_count": len(
                        (stored["section_index"].get("sections") or [])
                    ),
                    "coverage": stored["coverage"],
                }
            elif job_kind == assets_mod.ANNOTATE_IMAGES_KIND:
                doc = assets_mod.merge_image_annotation_pack(
                    ctx.root, root_id, pack,
                )
                created_stubs = assets_mod.create_handout_stubs_from_annotations(
                    ctx.root, root_id,
                )
                # Project newly created stubs into every campaign bound to
                # this asset root, so the KP can see and deliver them.
                projected: list[str] = []
                if created_stubs:
                    camps_root = (
                        coc_state.coc_root(ctx.root.resolve()) / "campaigns"
                    )
                    if camps_root.is_dir():
                        for camp in sorted(camps_root.iterdir()):
                            sc = camp / "scenario" / "scenario.json"
                            if not sc.is_file() or not camp.is_dir():
                                continue
                            try:
                                sc_data = json.loads(sc.read_text(encoding="utf-8"))
                            except (OSError, ValueError):
                                continue
                            # The campaign binds the module root under its
                            # cache/progressive pointers; there is no plain
                            # asset_root_id field on the scenario.
                            bound_roots = {
                                str(sc_data.get(key) or "").strip()
                                for key in (
                                    "asset_root_id",
                                    "source_cache_asset_root_id",
                                    "progressive_asset_root_id",
                                )
                            }
                            if root_id not in bound_roots:
                                continue
                            try:
                                ir = coc_module_project.load_campaign_ir(camp)
                                for stub_id in created_stubs:
                                    stub = assets_mod.get_entity(
                                        ctx.root, root_id, "handout", stub_id,
                                    )
                                    if stub is not None:
                                        ir = coc_module_project.merge_deep_entity_into_ir(
                                            ir, "handout", stub,
                                        )
                                coc_module_project.write_ir_to_campaign(
                                    camp, ir, asset_root_id=root_id,
                                )
                                projected.append(camp.name)
                            except Exception:
                                pass
                stored = assets_mod.fulfill_and_close_host_work(
                    ctx.root, root_id, host_work_job_id=job_id,
                )
                data = {
                    "annotation_count": len(
                        (doc.get("annotations") or [])
                    ),
                    "handout_stubs_created": created_stubs,
                    "projected_campaigns": projected,
                }
            else:
                stored = assets_mod.put_section_pack_and_fulfill_host_work(
                    ctx.root, root_id, host_work_job_id=job_id, pack=pack,
                )
                data = {
                    "section_id": stored["section_pack"]["section_id"],
                    "pack_kind": stored["section_pack"]["pack_kind"],
                    "body_path": stored["body_path"],
                }
        except (ValueError, assets_mod.ModuleAssetsError) as exc:
            raise ToolError("invalid_source_worker_pack", str(exc)) from exc
        return {"ok": True, "job_id": job_id, "kind": job_kind, **data}, [], []
    mechanics_job = job_kind in _mechanics_jobs()
    entity_kind = assets_mod._job_entity_kind(job_kind)
    target_id = str(request.get("target_id") or "").strip()
    if (
        job_kind not in {"locate_mechanics_index", "full_parse"}
        and (not entity_kind or not target_id)
    ):
        raise ToolError("invalid_state", "host-work request has no entity binding")
    pack = deepcopy(args.get("pack"))
    if not isinstance(pack, dict):
        raise ToolError(
            "invalid_source_worker_pack"
            if job_kind == "locate_mechanics_index" or mechanics_job
            else "invalid_param",
            "pack must be an object",
        )
    if job_kind == "full_parse":
        return _fulfill_full_parse_host_work(
            ctx,
            root_id=root_id,
            request=request,
            job_id=job_id,
            pack=pack,
            args=args,
        )
    # The job already binds the entity kind, so a sole matching wrapper is
    # redundant transport structure rather than semantic source data. Accept
    # and normalize that common worker serialization without weakening any
    # entity, source-scope, or receipt validation below.
    if (
        entity_kind
        and set(pack) == {entity_kind}
        and isinstance(pack.get(entity_kind), dict)
    ):
        pack = deepcopy(pack[entity_kind])
    measured_host_timing = None
    leased_at = str(request.get("leased_at") or "").strip()
    if leased_at:
        completed_dt = datetime.now(timezone.utc)
        try:
            started_dt = datetime.fromisoformat(leased_at)
        except ValueError as exc:
            raise ToolError(
                "invalid_state", "leased host-work has an invalid leased_at timestamp",
            ) from exc
        if started_dt.tzinfo is None:
            started_dt = started_dt.replace(tzinfo=timezone.utc)
        supplied_timing = args.get("host_task_timing")
        if supplied_timing is not None:
            if not isinstance(supplied_timing, dict):
                raise ToolError("invalid_param", "host_task_timing must be an object")
            try:
                task_started = datetime.fromisoformat(
                    str(supplied_timing.get("started_at") or "")
                )
                task_completed = datetime.fromisoformat(
                    str(supplied_timing.get("completed_at") or "")
                )
            except ValueError as exc:
                raise ToolError(
                    "invalid_param",
                    "host_task_timing started_at/completed_at must be ISO datetimes",
                ) from exc
            if task_started.tzinfo is None:
                task_started = task_started.replace(tzinfo=timezone.utc)
            if task_completed.tzinfo is None:
                task_completed = task_completed.replace(tzinfo=timezone.utc)
            duration_ms = supplied_timing.get("duration_ms")
            task_id = str(supplied_timing.get("task_id") or "").strip()
            if (
                isinstance(duration_ms, bool)
                or not isinstance(duration_ms, int)
                or duration_ms < 0
                or not task_id
            ):
                raise ToolError(
                    "invalid_param",
                    "host_task_timing requires non-negative duration_ms and task_id",
                )
            derived_ms = round(
                (task_completed - task_started).total_seconds() * 1000
            )
            if derived_ms < 0 or abs(derived_ms - duration_ms) > 1500:
                raise ToolError(
                    "invalid_param",
                    "host_task_timing duration does not match start/end metadata",
                )
            if task_started < started_dt - timedelta(seconds=5):
                raise ToolError(
                    "invalid_param",
                    "host task started before its source-work lease",
                )
            if task_completed > completed_dt + timedelta(seconds=5):
                raise ToolError(
                    "invalid_param",
                    "host task completion is in the future",
                )
            measured_host_timing = {
                "started_at": task_started.isoformat(),
                "completed_at": task_completed.isoformat(),
                "duration_ms": duration_ms,
                "producer": "host_background_subagent",
                "measurement": "exact_host_task_runtime",
                "task_id": task_id,
            }
        else:
            measured_host_timing = {
                "started_at": started_dt.isoformat(),
                "completed_at": completed_dt.isoformat(),
                "duration_ms": max(
                    0, round((completed_dt - started_dt).total_seconds() * 1000),
                ),
                "producer": "host_background_subagent",
                "measurement": "lease_to_fulfill_upper_bound",
            }
        # Timing is host/repository evidence. A language model must not invent
        # or override its own wall-clock receipt.
        pack["host_timing"] = measured_host_timing

    if job_kind == "locate_mechanics_index":
        if args.get("related_packs") not in (None, []):
            raise ToolError(
                "invalid_source_worker_pack",
                "locator fulfillment requires related_packs=[]",
            )
        if request.get("request_purpose") != assets_mod.MECHANICS_LOCATOR_PURPOSE:
            raise ToolError(
                "invalid_state", "locator request purpose is not mechanics_locator_pass",
            )
        try:
            exact_scope = assets_mod.validate_opening_source_scope(
                ctx.root, root_id, request.get("requested_source_scope"),
            )
        except assets_mod.ModuleAssetsError as exc:
            raise ToolError("invalid_state", str(exc)) from exc
        expected_signature = assets_mod.opening_source_scope_signature(exact_scope)
        if (
            request.get("requested_pdf_indices") != exact_scope["pdf_indices"]
            or str(request.get("source_scope_signature") or "")
            != expected_signature
        ):
            raise ToolError(
                "mechanics_locator_source_scope_mismatch",
                "locator request no longer matches its exact accepted source scope",
            )
        expected_locator_scope = {
            "scope_kind": "explicit_pdf_indices",
            "pdf_indices": list(exact_scope["pdf_indices"]),
            "source_file_sha256": exact_scope["file_sha256"],
        }
        allowed_pack_fields = {
            "mechanics_locator_pass_status",
            "mechanics_locator_scope",
            "npc_roster",
            "item_roster",
            "mechanics_index",
            "host_timing",
        }
        required_pack_fields = allowed_pack_fields - {"host_timing"}
        if set(pack) - allowed_pack_fields:
            raise ToolError(
                "invalid_source_worker_pack",
                "locator pack contains unsupported fields",
            )
        if not required_pack_fields <= set(pack):
            raise ToolError(
                "invalid_source_worker_pack",
                "locator pack is missing required fields",
            )
        if pack.get("mechanics_locator_pass_status") != "pending":
            raise ToolError(
                "invalid_source_worker_pack",
                "bounded locator pack must keep global pass pending",
            )
        if pack.get("mechanics_locator_scope") != expected_locator_scope:
            raise ToolError(
                "invalid_source_worker_pack",
                "locator pack scope must equal the leased exact page window",
            )
        for collection in ("npc_roster", "item_roster", "mechanics_index"):
            if not isinstance(pack.get(collection), list):
                raise ToolError(
                    "invalid_source_worker_pack",
                    f"locator pack {collection} must be an array",
                )
        requested_indices = set(exact_scope["pdf_indices"])
        request_refs = {
            int(ref["pdf_index"]): {
                "source_id": str(ref.get("source_id") or ""),
                "pdf_index": int(ref["pdf_index"]),
                "text_sha256": str(ref.get("text_sha256") or ""),
            }
            for ref in (request.get("cached_page_refs") or [])
            if isinstance(ref, dict) and isinstance(ref.get("pdf_index"), int)
        }
        if set(request_refs) != requested_indices:
            raise ToolError(
                "invalid_state", "locator request lacks its complete leased cache refs",
            )

        def locator_source_bound_row(
            incoming: Any,
            *,
            field: str,
            allowed_fields: set[str],
        ) -> dict[str, Any]:
            if not isinstance(incoming, dict) or set(incoming) != allowed_fields:
                raise ToolError(
                    "invalid_source_worker_pack",
                    f"{field} must contain exactly its allowed and required fields",
                )
            try:
                indices = assets_mod._source_indices(incoming, field=field)
            except assets_mod.ModuleAssetsError as exc:
                raise ToolError("invalid_source_worker_pack", str(exc)) from exc
            if not indices or not set(indices) <= requested_indices:
                raise ToolError(
                    "invalid_source_worker_pack",
                    f"{field} must stay inside the leased exact page window",
                )
            expected_refs = [request_refs[index] for index in indices]
            supplied_refs = incoming.get("source_refs")
            if (
                not isinstance(supplied_refs, list)
                or len(supplied_refs) != len(indices)
                or not all(isinstance(ref, dict) for ref in supplied_refs)
            ):
                raise ToolError(
                    "invalid_source_worker_pack",
                    f"{field}.source_refs must exactly match its page indices",
                )
            supplied_minimal = [
                {
                    "source_id": str(ref.get("source_id") or ""),
                    "pdf_index": ref.get("pdf_index"),
                    "text_sha256": str(ref.get("text_sha256") or ""),
                }
                for ref in supplied_refs if isinstance(ref, dict)
            ]
            if supplied_minimal != expected_refs:
                raise ToolError(
                    "invalid_source_worker_pack",
                    f"{field}.source_refs must match the selected cached refs",
                )
            result = deepcopy(incoming)
            result["source_page_indices"] = list(indices)
            result["source_refs"] = expected_refs
            return result

        npc_additions: list[dict[str, Any]] = []
        for index, incoming in enumerate(pack.get("npc_roster") or []):
            row = locator_source_bound_row(
                incoming,
                field=f"locator.npc_roster[{index}]",
                allowed_fields={
                    "npc_id", "names", "parse_state",
                    "source_page_indices", "source_refs",
                },
            )
            try:
                assets_mod._require_id(row.get("npc_id"), f"npc_roster[{index}].npc_id")
            except assets_mod.ModuleAssetsError as exc:
                raise ToolError("invalid_source_worker_pack", str(exc)) from exc
            if row.get("parse_state") != "named_only":
                raise ToolError(
                    "invalid_source_worker_pack",
                    "locator npc roster additions must be named_only",
                )
            if not isinstance(row.get("names"), list) or not row["names"] or not all(
                isinstance(name, str) and name.strip() for name in row["names"]
            ):
                raise ToolError(
                    "invalid_source_worker_pack",
                    "locator npc roster additions require names",
                )
            npc_additions.append(row)

        item_additions: list[dict[str, Any]] = []
        for index, incoming in enumerate(pack.get("item_roster") or []):
            row = locator_source_bound_row(
                incoming,
                field=f"locator.item_roster[{index}]",
                allowed_fields={
                    "item_id", "label", "parse_state",
                    "source_page_indices", "source_refs",
                },
            )
            try:
                assets_mod._require_id(row.get("item_id"), f"item_roster[{index}].item_id")
            except assets_mod.ModuleAssetsError as exc:
                raise ToolError("invalid_source_worker_pack", str(exc)) from exc
            if row.get("parse_state") != "named_only" or not str(
                row.get("label") or ""
            ).strip():
                raise ToolError(
                    "invalid_source_worker_pack",
                    "locator item roster additions require label and parse_state=named_only",
                )
            item_additions.append(row)

        locator_rows: list[dict[str, Any]] = []
        locator_keys: set[tuple[str, str]] = set()
        for index, incoming in enumerate(pack.get("mechanics_index") or []):
            row = locator_source_bound_row(
                incoming,
                field=f"locator.mechanics_index[{index}]",
                allowed_fields={
                    "subject_kind", "subject_id", "status",
                    "locator_pass_status", "locator_scope",
                    "source_page_indices", "source_refs",
                },
            )
            subject_kind = str(row.get("subject_kind") or "")
            subject_id = str(row.get("subject_id") or "").strip()
            try:
                assets_mod._require_id(subject_id, f"mechanics_index[{index}].subject_id")
            except assets_mod.ModuleAssetsError as exc:
                raise ToolError("invalid_source_worker_pack", str(exc)) from exc
            key = (subject_kind, subject_id)
            if subject_kind not in {"npc", "item"} or key in locator_keys:
                raise ToolError(
                    "invalid_source_worker_pack",
                    "locator rows require unique npc/item subjects",
                )
            if (
                row.get("status") != "located"
                or row.get("locator_pass_status") != "complete"
                or row.get("locator_scope") != expected_locator_scope
            ):
                raise ToolError(
                    "invalid_source_worker_pack",
                    "bounded locator rows must be complete+located in the exact leased scope",
                )
            locator_keys.add(key)
            locator_rows.append(row)
        addition_keys = [
            *(('npc', str(row.get("npc_id") or "")) for row in npc_additions),
            *(('item', str(row.get("item_id") or "")) for row in item_additions),
        ]
        if len(addition_keys) != len(set(addition_keys)):
            raise ToolError(
                "invalid_source_worker_pack", "locator roster additions must be unique",
            )
        if not set(addition_keys) <= locator_keys:
            raise ToolError(
                "invalid_source_worker_pack",
                "locator roster additions require a matching located row",
            )
        current = assets_mod.get_skeleton(ctx.root, root_id)
        if not isinstance(current, dict):
            raise ToolError("invalid_state", "canonical skeleton is missing")
        if current.get("mechanics_locator_pass_status") == "complete":
            raise ToolError("invalid_state", "canonical locator pass is already complete")
        merged = deepcopy(current)
        for collection, id_field, additions in (
            ("npc_roster", "npc_id", npc_additions),
            ("item_roster", "item_id", item_additions),
        ):
            existing_rows = list(merged.get(collection) or [])
            existing_ids = {
                str(row.get(id_field) or "")
                for row in existing_rows if isinstance(row, dict)
            }
            existing_rows.extend(
                deepcopy(row) for row in additions
                if str(row.get(id_field) or "") not in existing_ids
            )
            merged[collection] = existing_rows
        roster_keys = {
            ("npc", str(row.get("npc_id") or ""))
            for row in merged.get("npc_roster") or [] if isinstance(row, dict)
        } | {
            ("item", str(row.get("item_id") or ""))
            for row in merged.get("item_roster") or [] if isinstance(row, dict)
        }
        if not locator_keys <= roster_keys:
            raise ToolError(
                "invalid_source_worker_pack",
                "each locator row must bind to the merged roster",
            )
        existing_locators = [
            deepcopy(row) for row in merged.get("mechanics_index") or []
            if isinstance(row, dict)
            and (
                str(row.get("subject_kind") or ""),
                str(row.get("subject_id") or ""),
            ) not in locator_keys
        ]
        merged["mechanics_index"] = [*existing_locators, *deepcopy(locator_rows)]
        merged["mechanics_locator_pass_status"] = "pending"
        prior_scope = merged.get("mechanics_locator_scope")
        accumulated_indices = set(exact_scope["pdf_indices"])
        if isinstance(prior_scope, dict):
            accumulated_indices.update(prior_scope.get("pdf_indices") or [])
        merged["mechanics_locator_scope"] = {
            "scope_kind": "explicit_pdf_indices",
            "pdf_indices": sorted(accumulated_indices),
            "source_file_sha256": exact_scope["file_sha256"],
        }
        try:
            commit_result = assets_mod.put_skeleton_and_fulfill_locator_host_work(
                ctx.root,
                root_id,
                host_work_job_id=job_id,
                skeleton=merged,
            )
            put_result = commit_result["put"]
            repository_put_ms = commit_result["repository_put_ms"]
        except assets_mod.ModuleAssetsError as exc:
            raise ToolError("invalid_param", str(exc)) from exc
        return {
            "asset_root_id": root_id,
            "job_id": job_id,
            "request_status": "fulfilled",
            "locator_rows_merged": len(locator_rows),
            "npc_roster_additions": len(npc_additions),
            "item_roster_additions": len(item_additions),
            "global_locator_pass_status": "pending",
            "put": put_result,
            "measured_host_timing": measured_host_timing,
        }, [], [
            "locator rows are durable; later mechanics.ensure can request the exact indexed page without blocking ordinary play",
        ]

    validated_mechanics_related: list[dict[str, Any]] | None = None
    if mechanics_job:
        requested_indices = set(request.get("requested_pdf_indices") or [])
        raw_request_refs = request.get("cached_page_refs")
        if (
            not requested_indices
            or not isinstance(raw_request_refs, list)
            or len(raw_request_refs) != len(requested_indices)
            or any(
                not isinstance(ref, dict)
                or isinstance(ref.get("pdf_index"), bool)
                or not isinstance(ref.get("pdf_index"), int)
                or not str(ref.get("source_id") or "")
                or len(str(ref.get("text_sha256") or "")) != 64
                for ref in raw_request_refs
            )
            or {int(ref["pdf_index"]) for ref in raw_request_refs}
            != requested_indices
        ):
            raise ToolError(
                "invalid_state",
                "mechanics request lacks its complete leased exact cache refs",
            )
        request_ref_signatures = {
            (
                str(ref.get("source_id") or ""),
                int(ref["pdf_index"]),
                str(ref.get("text_sha256") or ""),
            )
            for ref in raw_request_refs
            if isinstance(ref, dict) and isinstance(ref.get("pdf_index"), int)
        }

        def validate_mechanics_worker_pack(
            incoming: Any,
            *,
            field: str,
            subject_kind: str,
            subject_id: str,
        ) -> None:
            """Reject malformed child output before any durable entity write."""
            if not isinstance(incoming, dict) or set(incoming) != {"mechanics"}:
                raise ToolError(
                    "invalid_source_worker_pack",
                    f"{field} must contain exactly one nested mechanics object",
                )
            mechanics_payload = incoming.get("mechanics")
            if not isinstance(mechanics_payload, dict):
                raise ToolError(
                    "invalid_source_worker_pack",
                    f"{field}.mechanics must be an object",
                )
            status = str(mechanics_payload.get("status") or "")
            if status == "authored":
                authored_fields = {
                    "status", "profile", "source_refs",
                    "fields_observed", "fields_extracted",
                    "fields_not_authored", "provenance",
                }
                if set(mechanics_payload) != authored_fields:
                    raise ToolError(
                        "invalid_source_worker_pack",
                        f"{field}.mechanics status=authored must contain exactly "
                        "status/profile/source_refs/fields_*/provenance",
                    )
                refs = mechanics_payload.get("source_refs")
                if not isinstance(refs, list) or not refs:
                    raise ToolError(
                        "invalid_source_worker_pack",
                        f"{field}.mechanics.source_refs must be a non-empty exact "
                        "request-cache subset",
                    )
                supplied_signatures: list[tuple[str, int, str]] = []
                for index, ref in enumerate(refs):
                    if (
                        not isinstance(ref, dict)
                        or set(ref) != {"source_id", "pdf_index", "text_sha256"}
                        or isinstance(ref.get("pdf_index"), bool)
                        or not isinstance(ref.get("pdf_index"), int)
                    ):
                        raise ToolError(
                            "invalid_source_worker_pack",
                            f"{field}.mechanics.source_refs[{index}] must be one "
                            "exact source_id/pdf_index/text_sha256 ref",
                        )
                    supplied_signatures.append((
                        str(ref.get("source_id") or ""),
                        int(ref["pdf_index"]),
                        str(ref.get("text_sha256") or ""),
                    ))
                if (
                    len(supplied_signatures) != len(set(supplied_signatures))
                    or not set(supplied_signatures) <= request_ref_signatures
                ):
                    raise ToolError(
                        "invalid_source_worker_pack",
                        f"{field}.mechanics.source_refs must be unique exact refs "
                        "from this leased request",
                    )
            elif status == "not_authored":
                allowed_fields = set(coc_mechanics.NOT_AUTHORED_KEYS)
                required_fields = {
                    "status", "locator_pass_status", "locator_scope",
                    "absence_receipt",
                }
                if (
                    set(mechanics_payload) - allowed_fields
                    or not required_fields <= set(mechanics_payload)
                ):
                    raise ToolError(
                        "invalid_source_worker_pack",
                        f"{field}.mechanics status=not_authored violates the "
                        "closed receipt-only shape",
                    )
            else:
                raise ToolError(
                    "invalid_source_worker_pack",
                    f"{field}.mechanics.status must be authored or not_authored",
                )
            expected_locator_scope = None
            if status == "not_authored":
                locator = assets_mod._skeleton_mechanics_row(
                    ctx.root, root_id, subject_kind, subject_id,
                )
                if not isinstance(locator, dict) or not isinstance(
                    locator.get("locator_scope"), dict,
                ):
                    raise ToolError(
                        "invalid_source_worker_pack",
                        f"{field}.mechanics not_authored has no matching complete "
                        "skeleton locator scope",
                    )
                expected_locator_scope = locator["locator_scope"]
            try:
                coc_mechanics.validate_mechanics_record(
                    mechanics_payload,
                    subject_kind=subject_kind,
                    expected_locator_scope=expected_locator_scope,
                )
            except coc_mechanics.MechanicsError as exc:
                raise ToolError("invalid_source_worker_pack", str(exc)) from exc

        validate_mechanics_worker_pack(
            args.get("pack"),
            field="pack",
            subject_kind=entity_kind,
            subject_id=target_id,
        )
        raw_related = args.get("related_packs")
        if raw_related is None:
            raw_related = []
        if not isinstance(raw_related, list):
            raise ToolError(
                "invalid_source_worker_pack", "related_packs must be an array",
            )
        allowed_batch = {
            (str(row.get("subject_kind") or ""), str(row.get("subject_id") or ""))
            for row in (request.get("batch_subjects") or [])
            if isinstance(row, dict)
        }
        primary_subject = (entity_kind, target_id)
        seen_related: set[tuple[str, str]] = set()
        validated_mechanics_related = []
        for index, related in enumerate(raw_related):
            field = f"related_packs[{index}]"
            if (
                not isinstance(related, dict)
                or set(related) != {"subject_kind", "subject_id", "pack"}
            ):
                raise ToolError(
                    "invalid_source_worker_pack",
                    f"{field} must contain exactly subject_kind/subject_id/pack",
                )
            related_kind = str(related.get("subject_kind") or "")
            related_id = str(related.get("subject_id") or "")
            related_subject = (related_kind, related_id)
            if (
                related_subject == primary_subject
                or related_subject in seen_related
                or related_subject not in allowed_batch
            ):
                raise ToolError(
                    "invalid_source_worker_pack",
                    f"{field} must name one unique eligible non-primary batch subject",
                )
            validate_mechanics_worker_pack(
                related.get("pack"),
                field=f"{field}.pack",
                subject_kind=related_kind,
                subject_id=related_id,
            )
            seen_related.add(related_subject)
            validated_mechanics_related.append(deepcopy(related))

    def _apply_mechanics_only_fulfill(
        *,
        kind: str,
        entity_id: str,
        incoming: dict[str, Any],
        force_host_job: bool,
    ) -> dict[str, Any]:
        """Merge only mechanics; never force narrative parse_state=deep."""
        mechanics_payload = incoming.get("mechanics")
        if not isinstance(mechanics_payload, dict):
            raise ToolError(
                "invalid_source_worker_pack",
                f"{job_kind} pack requires a mechanics object",
            )
        existing = assets_mod.get_entity(ctx.root, root_id, kind, entity_id)
        if existing is not None:
            merged = deepcopy(existing)
            merged["mechanics"] = deepcopy(mechanics_payload)
            # Preserve existing narrative parse_state; mechanics readiness is
            # independent of body depth.
            if force_host_job:
                merged["host_work_job_id"] = job_id
            else:
                merged.pop("host_work_job_id", None)
            if measured_host_timing and not merged.get("host_timing"):
                merged["host_timing"] = deepcopy(measured_host_timing)
            return merged
        id_key = assets_mod._ENTITY_ID_KEY[kind]
        shell: dict[str, Any] = {
            id_key: entity_id,
            "parse_state": "named_only",
            "origin": incoming.get("origin") or "source",
            "mechanics": deepcopy(mechanics_payload),
        }
        for key in (
            "name", "display_name", "label", "source_page_indices",
            "source_refs", "provenance",
        ):
            if key in incoming and incoming[key] is not None:
                shell[key] = deepcopy(incoming[key])
        if kind == "npc":
            shell.setdefault("name", entity_id)
            shell.setdefault("display_name", shell["name"])
        elif kind == "item":
            shell.setdefault("label", entity_id)
        # Mechanics-only entities must not claim deep narration.
        shell["parse_state"] = "named_only"
        if force_host_job:
            shell["host_work_job_id"] = job_id
        if measured_host_timing:
            shell["host_timing"] = deepcopy(measured_host_timing)
        return shell

    if job_kind in _mechanics_jobs():
        pack = _apply_mechanics_only_fulfill(
            kind=entity_kind,
            entity_id=target_id,
            incoming=pack,
            force_host_job=True,
        )
    else:
        if job_kind == "deepen_handout":
            _require_closed_handout_worker_pack(
                pack,
                request,
                root_id=root_id,
                root=ctx.root,
                target_id=target_id,
                related_packs=args.get("related_packs"),
            )
        expected_state = (
            "partial"
            if job_kind in {"partial_neighbor", "partial_opening"}
            else "deep"
        )
        supplied_state = str(pack.get("parse_state") or expected_state)
        if supplied_state != expected_state:
            raise ToolError(
                "invalid_param",
                f"{job_kind} requires parse_state={expected_state!r}",
            )
        pack["parse_state"] = expected_state
        pack["host_work_job_id"] = job_id
        if job_kind == "partial_opening":
            if (
                request.get("request_purpose")
                != assets_mod.FOREGROUND_OPENING_PURPOSE
            ):
                raise ToolError(
                    "invalid_state",
                    "partial_opening request purpose is not foreground_opening_slice",
                )
            try:
                exact_scope = assets_mod.validate_opening_source_scope(
                    ctx.root,
                    root_id,
                    request.get("requested_source_scope"),
                )
                expected_signature = assets_mod.opening_source_scope_signature(
                    exact_scope
                )
                incoming_indices = assets_mod._source_indices(
                    pack, field="partial_opening.pack",
                )
            except assets_mod.ModuleAssetsError as exc:
                raise ToolError("invalid_param", str(exc)) from exc
            if (
                str(request.get("source_scope_signature") or "")
                != expected_signature
                or incoming_indices != exact_scope["pdf_indices"]
            ):
                raise ToolError(
                    "opening_source_scope_mismatch",
                    "partial opening pack source scope must equal the exact request",
                )
        if entity_kind == "location":
            # A location pack without its closed semantic fields merges cleanly
            # but can never satisfy opening readiness; reject it before merge.
            _require_location_pack_semantic_fields(pack, request, field="pack")
            _require_body_location_canonical_identities(
                pack,
                request,
                target_id=target_id,
                field="pack",
            )
        if job_kind == "partial_opening":
            validation_pack = deepcopy(pack)
            validation_pack.pop("host_work_job_id", None)
            validation_pack["schema_version"] = assets_mod.SCHEMA_VERSION
            validation_pack["location_id"] = target_id
            try:
                assets_mod._canonicalize_entity_source_evidence(
                    ctx.root, root_id, "location", validation_pack,
                )
                assets_mod._validate_entity_pack(
                    "location",
                    validation_pack,
                    workspace=ctx.root,
                    asset_root_id=root_id,
                    entity_id=target_id,
                )
            except assets_mod.ModuleAssetsError as exc:
                raise ToolError("invalid_param", str(exc)) from exc
            opening_setup_result = _apply_opening_setup_observation(
                ctx,
                root_id=root_id,
                request=request,
                opening_setup=args.get("opening_setup"),
            )
    try:
        result = assets_mod.put_entity(
            ctx.root, root_id, entity_kind, target_id, pack,
        )
    except assets_mod.ModuleAssetsError as exc:
        raise ToolError("invalid_param", str(exc)) from exc
    stored_primary = assets_mod.get_entity(
        ctx.root, root_id, entity_kind, target_id,
    )
    refreshed_request = next(
        (
            row
            for row in assets_mod.list_host_work_requests(
                ctx.root, root_id, include_closed=True, limit=None,
            )
            if str(row.get("job_id") or "") == job_id
        ),
        None,
    )
    if (
        not isinstance(stored_primary, dict)
        or not isinstance(refreshed_request, dict)
        or not assets_mod.fulfilled_request_matches_current_pack(
            refreshed_request,
            stored_primary,
            kind=entity_kind,
            entity_id=target_id,
        )
    ):
        raise ToolError(
            "invalid_state",
            "canonical host-work fulfillment receipt does not match the current primary pack",
        )
    related_results = []
    allowed_batch = {
        (str(row.get("subject_kind") or ""), str(row.get("subject_id") or ""))
        for row in (request.get("batch_subjects") or [])
        if isinstance(row, dict)
    }
    related_subjects: list[tuple[str, str]] = []
    related_input = (
        validated_mechanics_related
        if mechanics_job and validated_mechanics_related is not None
        else args.get("related_packs") or []
    )
    for index, related in enumerate(related_input):
        if not isinstance(related, dict):
            raise ToolError(
                "invalid_source_worker_pack" if mechanics_job else "invalid_param",
                f"related_packs[{index}] must be an object",
            )
        related_kind = str(related.get("subject_kind") or "")
        related_id = str(related.get("subject_id") or "")
        if (related_kind, related_id) not in allowed_batch:
            raise ToolError(
                "invalid_source_worker_pack" if mechanics_job else "invalid_param",
                f"related_packs[{index}] is not in this request's batch_subjects",
            )
        related_pack = deepcopy(related.get("pack"))
        if not isinstance(related_pack, dict):
            raise ToolError(
                "invalid_source_worker_pack" if mechanics_job else "invalid_param",
                f"related_packs[{index}].pack must be an object",
            )
        if job_kind in _mechanics_jobs():
            related_pack = _apply_mechanics_only_fulfill(
                kind=related_kind,
                entity_id=related_id,
                incoming=related_pack,
                force_host_job=False,
            )
        else:
            related_pack["parse_state"] = "deep"
            related_pack.pop("host_work_job_id", None)
            if related_kind == "location":
                _require_location_pack_semantic_fields(
                    related_pack,
                    request,
                    field=f"related_packs[{index}].pack",
                )
                _require_body_location_canonical_identities(
                    related_pack,
                    request,
                    target_id=related_id,
                    field=f"related_packs[{index}].pack",
                )
            if pack.get("host_timing") and not related_pack.get("host_timing"):
                related_pack["host_timing"] = deepcopy(pack["host_timing"])
        try:
            related_results.append(
                assets_mod.put_entity(
                    ctx.root, root_id, related_kind, related_id, related_pack,
                )
            )
        except assets_mod.ModuleAssetsError as exc:
            raise ToolError("invalid_param", str(exc)) from exc
        related_subjects.append((related_kind, related_id))

    # Mechanics-only packs stay narrative-shallow, so put_entity's deep-only
    # reenqueue path does not fire. Re-queue resolve_* merge jobs so durable
    # authored/not_authored mechanics still project into campaign IR.
    if job_kind in _mechanics_jobs():
        merge_jobs = [(entity_kind, target_id), *related_subjects]
        for subject_kind, subject_id in merge_jobs:
            resolve_kind = (
                coc_module_project.coc_module_assets
                .MECHANICS_JOB_FOR_SUBJECT.get(subject_kind)
            )
            if resolve_kind is None:
                continue
            assets_mod.enqueue_job(
                ctx.root,
                root_id,
                kind=resolve_kind,
                target_id=subject_id,
                priority=100,
                reason="mechanics_pack_ready",
                consumer_refs=(
                    deepcopy(request.get("consumer_refs"))
                    if request.get("consumer_refs") else None
                ),
            )

    if job_kind == "partial_opening":
        automatic_projection = coc_module_project.drain_opening_projection_watches(
            ctx.root,
            root_id,
            start_location_id=target_id,
            source_scope_signature=str(
                request.get("source_scope_signature") or ""
            ),
        )
        success_hints = [
            "the exact reusable partial opening pack is durable; exact "
            "campaign-owned projection watches were drained automatically",
        ]
    elif job_kind in _mechanics_jobs():
        success_hints = [
            "the reusable mechanics pack is durable and its mechanics merge "
            "job was re-enqueued",
        ]
    elif isinstance(result.get("worker"), dict) and not result["worker"].get("error"):
        success_hints = [
            "the reusable deep pack is durable and merge was re-enqueued; "
            "continue play from the pack instead of reopening the same PDF scope",
        ]
    else:
        success_hints = [
            "the reusable pack is durable; inspect progressive status before "
            "claiming a campaign merge was scheduled",
        ]

    return {
        "asset_root_id": root_id,
        "job_id": job_id,
        "request_status": refreshed_request["status"],
        "entity": coc_module_project._entity_status(
            ctx.root, root_id, entity_kind, target_id,
        ),
        "put": result,
        "related_puts": related_results,
        "measured_host_timing": measured_host_timing,
        "opening_setup": opening_setup_result,
        **(
            {"automatic_projection": automatic_projection}
            if job_kind == "partial_opening" else {}
        ),
    }, [], success_hints

def _ensure_first_impression_roll(
    ctx: Ctx, receipt: dict[str, Any]
) -> None:
    """Materialize a schema-v2 public roll exactly once from its source receipt."""
    if receipt.get("schema_version") != 2:
        return
    expected = receipt.get("roll_record")
    roll_id = str(receipt.get("roll_id") or "")
    if not isinstance(expected, dict) or not roll_id:
        raise ToolError("state_corrupt", "first-impression receipt lacks its public roll source")
    try:
        with coc_async_recorder.recorder_lock(ctx.campaign_dir):
            raw = _roll_log_bytes(ctx)
            complete, tail, index = _parse_complete_roll_frames(raw)
            if tail or complete != raw:
                raise ToolError(
                    "state_corrupt",
                    "cannot materialize a first-impression roll over an incomplete rolls.jsonl tail",
                )
            prior = index.get(roll_id)
            if prior is not None:
                if prior != expected:
                    raise ToolError(
                        "state_corrupt",
                        f"first-impression roll_id '{roll_id}' conflicts with its source receipt",
                    )
                return
            _append_roll_frame_locked(
                ctx.campaign_dir / "logs" / "rolls.jsonl",
                _roll_record_frame(expected),
            )
    except coc_async_recorder.RecorderLockError as exc:
        raise ToolError("campaign_busy", str(exc)) from exc

def _campaign_document(ctx: Ctx) -> dict[str, Any]:
    if ctx.campaign_dir is None:
        return {}
    path = ctx.campaign_dir / "campaign.json"
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        return {}
    return data if isinstance(data, dict) else {}

def _campaign_play_language(ctx: Ctx) -> str:
    """Active campaign play_language for player-facing chrome (default zh-Hans)."""
    language = str(_campaign_document(ctx).get("play_language") or "").strip()
    return language or "zh-Hans"

def _current_open_affordances(ctx: Ctx) -> list[dict[str, Any]]:
    world = ctx.world()
    active_id = world.get("active_scene_id")
    scene = _scene_by_id(ctx.story_graph, active_id)
    if not isinstance(scene, dict):
        return []
    discovered = {str(c) for c in (world.get("discovered_clue_ids") or [])}
    scene_key = str(active_id or "")
    completed = coc_action_resolver._route_receipt_ids(
        world, scene_key, "consumed"
    )
    blocked = coc_action_resolver._route_receipt_ids(world, scene_key, "blocked")
    try:
        return coc_action_resolver._open_affordances(
            scene, discovered, completed, blocked
        )
    except RuntimeError as exc:
        raise ToolError("state_corrupt", str(exc)) from exc

def _story_thread(ctx: Ctx) -> list[dict[str, Any]]:
    """The main line, with what would advance it and where that sits.

    The Keeper already receives everything in here, spread across four flat
    lists organised by location: what this scene offers, what the neighbours
    hold, what the module pushes, and how far each objective has to go. Nothing
    changed in play when those arrived — same tools called, same two clues
    recorded — because using them means assembling the four into one chain
    every turn, and a Keeper with narrative momentum will not stop to do that.

    So the assembly happens here instead, organised by what the story still
    needs rather than by where the party is standing:

        objective still short  ->  the clues that would answer it
                               ->  which are reachable here, next door, or not yet
                               ->  the module's own sentence for getting there

    Advisory, keeper-only, and it proposes nothing: it is the same facts in the
    order a Keeper would need them to plan a next beat, so that planning is
    cheap rather than mandatory.
    """
    world = ctx.world()
    active_id = str(world.get("active_scene_id") or "")
    discovered = {str(c) for c in (world.get("discovered_clue_ids") or [])}
    progress = coc_belief_state.core_objective_progress(
        ctx.clue_graph, world.get("discovered_clue_ids"),
    )
    clue_meta: dict[str, dict[str, Any]] = {}
    clues_by_objective: dict[str, list[str]] = {}
    for conclusion in (ctx.clue_graph or {}).get("conclusions") or []:
        cid = str((conclusion or {}).get("conclusion_id") or "")
        for clue in (conclusion or {}).get("clues") or []:
            if not isinstance(clue, dict) or not clue.get("clue_id"):
                continue
            clue_meta[str(clue["clue_id"])] = clue
            clues_by_objective.setdefault(cid, []).append(str(clue["clue_id"]))

    # Where each undiscovered clue can be reached from here.
    here: set[str] = set()
    nearby: dict[str, tuple[str, str | None]] = {}
    active_scene = _scene_by_id(ctx.story_graph, active_id)
    if isinstance(active_scene, dict):
        here = {str(c) for c in active_scene.get("available_clues") or []}
    for edge in coc_scene_graph.derive_scene_edges(ctx.story_graph).get(active_id, []):
        destination = str(edge.get("to") or "")
        scene = _scene_by_id(ctx.story_graph, destination)
        if not isinstance(scene, dict):
            continue
        transition = (edge.get("when") or {}).get("description")
        for clue_id in scene.get("available_clues") or []:
            nearby.setdefault(str(clue_id), (destination, transition))

    rows: list[dict[str, Any]] = []
    for objective in progress.get("objectives") or []:
        if objective.get("importance") != "core" or objective.get("answered"):
            continue
        wanted = [
            cid for cid in clues_by_objective.get(objective["conclusion_id"], [])
            if cid not in discovered
        ]
        def _brief(clue_id: str) -> dict[str, Any]:
            clue = clue_meta.get(clue_id) or {}
            return {
                "clue_id": clue_id,
                "delivery_kind": clue.get("delivery_kind"),
                "delivery": clue.get("delivery"),
            }
        in_reach = [_brief(c) for c in wanted if c in here]
        # Grouped by destination: four clues in the same grove is one move, and
        # repeating the module's sentence for getting there four times buries
        # the chain it was assembled to make readable.
        grouped: dict[str, dict[str, Any]] = {}
        for clue_id in wanted:
            if clue_id in here or clue_id not in nearby:
                continue
            destination, transition = nearby[clue_id]
            row = grouped.setdefault(destination, {
                "scene_id": destination,
                "transition": transition,
                "clues": [],
            })
            row["clues"].append(_brief(clue_id))
        one_move = list(grouped.values())
        rows.append({
            "objective": objective["conclusion_id"],
            "description": objective.get("description"),
            "still_needs": objective.get("routes_outstanding"),
            "in_this_scene": in_reach[:4],
            "one_move_away": one_move[:4],
            "elsewhere": max(0, len(wanted) - len(in_reach) - len(one_move)),
        })

    # Action quests ride the same chain. An offered or active quest is a live
    # thread the story is holding, and what it still wants is its unmet
    # machine conditions — for clue conditions, chained to the same
    # here/one-move-away reachability the objectives above already use. Zero
    # new information: the identical quest.map facts in planning order.
    try:
        quest_definitions = coc_quest_state.read_quest_definitions(
            ctx.campaign_dir, root=ctx.root,
        )
        quest_state = coc_quest_state.read_quest_state(ctx.campaign_dir)
    except coc_quest_state.QuestStateError:
        quest_definitions, quest_state = {}, None
    flags_now = _flags_set(ctx)
    clock_now = coc_quest_state.clock_reached_reader(ctx.campaign_dir)
    for quest_id in sorted(quest_definitions):
        record = ((quest_state or {}).get("quests") or {}).get(quest_id) or {}
        status = record.get("status") or "authored"
        if status not in ("offered", "active"):
            continue
        definition = quest_definitions[quest_id]
        completion = coc_quest_state.evaluate_condition_group(
            definition.get("completion"),
            discovered_clue_ids=discovered,
            clock_reached=clock_now,
            flags_set=flags_now,
        )
        if completion is None:
            continue
        unmet = [
            row for row in [*completion.get("all", []), *completion.get("any", [])]
            if not row.get("met")
        ]
        wanted_clues = [
            str(row.get("clue_id")) for row in unmet if row.get("kind") == "clue_discovered"
        ]
        grouped_moves: dict[str, dict[str, Any]] = {}
        for clue_id in wanted_clues:
            if clue_id in here or clue_id not in nearby:
                continue
            destination, transition = nearby[clue_id]
            move = grouped_moves.setdefault(destination, {
                "scene_id": destination,
                "transition": transition,
                "clues": [],
            })
            move["clues"].append(clue_id)
        rows.append({
            "quest": quest_id,
            "title": definition.get("title"),
            "importance": definition.get("importance"),
            "status": status,
            "still_wants": [
                {key: row[key] for key in ("kind", "clue_id", "flag_id", "clock_id", "threshold") if key in row}
                for row in unmet
            ],
            "narrative_closure": bool(completion.get("narrative_required")),
            "clues_in_this_scene": [c for c in wanted_clues if c in here][:4],
            "clues_one_move_away": list(grouped_moves.values())[:4],
        })
    return rows

def _pending_deliveries(ctx: Ctx) -> list[dict[str, Any]]:
    """What this scene is holding that arrives without the players earning it.

    A clue whose delivery is `event` or `automatic` is one the module makes
    happen — the messenger arrives, the corpse is found, the sky changes. It is
    deliberately not an affordance, because an affordance is something the
    players elect to do, and offering these as menu items would be wrong.

    But nothing else surfaced them either, so the only way they reached play was
    the Keeper reading `clues_here` and remembering. Across the library that is
    137 clues, 23% of everything extracted, and it is the part of a module that
    is supposed to be pushed rather than searched for.

    Advisory and keeper-only: this says "the module has these waiting here", not
    "deliver them now". Timing is the Keeper's, and nothing here forces a turn.
    """
    world = ctx.world()
    scene = _scene_by_id(ctx.story_graph, world.get("active_scene_id"))
    if not isinstance(scene, dict):
        return []
    discovered = {str(c) for c in (world.get("discovered_clue_ids") or [])}
    by_id = {}
    for conclusion in (ctx.clue_graph or {}).get("conclusions") or []:
        for clue in (conclusion or {}).get("clues") or []:
            if isinstance(clue, dict) and clue.get("clue_id"):
                by_id[str(clue["clue_id"])] = (clue, conclusion)
    rows: list[dict[str, Any]] = []
    for clue_id in scene.get("available_clues") or []:
        if str(clue_id) in discovered:
            continue
        entry = by_id.get(str(clue_id))
        if entry is None:
            continue
        clue, conclusion = entry
        if str(clue.get("delivery_kind") or "") not in {"event", "automatic"}:
            continue
        rows.append({
            "clue_id": str(clue_id),
            "delivery_kind": clue.get("delivery_kind"),
            # The module's own words for what happens, which is what the Keeper
            # narrates from.
            "delivery": clue.get("delivery"),
            "player_safe_summary": clue.get("player_safe_summary"),
            "serves_objective": (conclusion or {}).get("conclusion_id"),
            "objective_importance": (conclusion or {}).get("importance"),
        })
    rows.sort(key=lambda row: (row.get("objective_importance") != "core", row["clue_id"]))
    return rows

def _nearby_route_index(ctx: Ctx) -> list[dict[str, Any]]:
    """What the neighbouring scenes are holding, for the Keeper only.

    `action_routes` is strictly the active scene, which is correct for what it
    is and leaves one thing unsaid: a player asking about something the module
    keeps one scene away produces no route at all, and the Keeper — with an
    empty working set — improvises it instead. That was reproduced twice with
    the same player line: in the scene holding the rumours the Keeper called
    actions.advise and then state.record_clue three times; in the scene next
    door it called neither, told an equally good story, and nothing reached the
    ledger, so the main-line objective it belonged to stayed where it was.

    So this says what is next door and how the module gets play there. It is
    advisory and keeper-only, it does not move anyone, and it carries route
    cues — what the investigators would do — never the clue's content.
    """
    world = ctx.world()
    active_id = str(world.get("active_scene_id") or "")
    if not active_id:
        return []
    discovered = {str(c) for c in (world.get("discovered_clue_ids") or [])}
    rows: list[dict[str, Any]] = []
    seen: set[str] = set()
    for edge in coc_scene_graph.derive_scene_edges(ctx.story_graph).get(active_id, []):
        destination = str(edge.get("to") or "")
        if not destination or destination in seen:
            continue
        seen.add(destination)
        scene = _scene_by_id(ctx.story_graph, destination)
        if not isinstance(scene, dict):
            continue
        try:
            open_routes = coc_action_resolver._open_affordances(
                scene,
                discovered,
                coc_action_resolver._route_receipt_ids(world, destination, "consumed"),
                coc_action_resolver._route_receipt_ids(world, destination, "blocked"),
            )
        except RuntimeError:
            continue
        if not open_routes:
            continue
        rows.append({
            "scene_id": destination,
            "display_name": scene.get("display_name"),
            # The module's own sentence for how play gets there, which is what
            # the Keeper needs to move without inventing a reason.
            "transition": (edge.get("when") or {}).get("description"),
            "open_routes": [
                {
                    "affordance_id": row.get("affordance_id"),
                    "cue": row.get("player_visible_cue"),
                    "skills": row.get("skills") or [],
                }
                for row in open_routes[:6]
            ],
            "open_route_count": len(open_routes),
        })
    return rows

def _route_operation_cards(
    ctx: Ctx,
    route: dict[str, Any],
    *,
    reset_evidence: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    scene_id = str(route.get("route_owner_scene_id") or "")
    route_id = str(route.get("affordance_id") or "")
    clue_ids = [str(value) for value in route.get("grants_clue_ids") or []]
    gate = route.get("roll_gate") if isinstance(route.get("roll_gate"), dict) else None
    if clue_ids and gate is None:
        return [
            {
                "operation": "state.record_clue",
                "invoke_via": "coc_invoke",
                "prefilled_arguments": {
                    "clue_id": clue_id,
                    "method": "authored_direct_route",
                    "route_ref": {"scene_id": scene_id, "route_id": route_id},
                },
                "missing_arguments": ["decision_id"],
                "before_prose_state_write": "state.record_clue",
            }
            for clue_id in clue_ids
        ]
    if gate is None:
        return []
    density_group = f"route:{scene_id}:{route_id}"
    stakes_label = str(gate.get("stakes") or "the authored route objective")
    failure = gate.get("ordinary_failure") or {}
    failure_summary = str(
        failure.get("summary") or "failure changes the situation without progress"
    )
    fumble = gate.get("fumble_consequence") or {}
    cards = []
    for approach in gate.get("approaches") or []:
        if not isinstance(approach, dict) or not approach.get("skill"):
            continue
        attempt_id = density_group
        if isinstance(reset_evidence, dict):
            attempt_id = (
                f"{density_group}:reset:"
                f"{reset_evidence.get('source_attempt_elapsed_minutes', 'structured')}"
                f":{reset_evidence.get('elapsed_minutes', 'changed')}"
            )
        prefilled = {
            "skill": str(approach["skill"]),
            "difficulty": str(gate.get("difficulty") or "regular"),
            "goal": str(route.get("player_visible_cue") or stakes_label),
            "stakes": {
                "on_success": f"achieve the authored objective: {stakes_label}",
                "on_failure": failure_summary,
            },
            "difficulty_basis": "authored_gate",
            "reason": f"authored route {route_id}",
            "resolution_context": {
                "attempt_id": attempt_id,
                "scene_id": scene_id,
                "route_id": route_id,
                "roll_density_group": density_group,
            },
        }
        if isinstance(reset_evidence, dict):
            prefilled["resolution_context"]["reset_evidence"] = deepcopy(
                reset_evidence
            )
        if str(fumble.get("summary") or "").strip():
            prefilled["fumble_consequence"] = str(fumble["summary"]).strip()
        cards.append({
            "operation": "rules.roll",
            "invoke_via": "coc_invoke",
            "approach": {
                "verb": approach.get("verb"),
                "skill": approach.get("skill"),
            },
            "prefilled_arguments": prefilled,
            "missing_arguments": ["decision_id"],
        })
    for clue_id in clue_ids:
        cards.append({
            "operation": "state.record_clue",
            "invoke_via": "coc_invoke",
            "prefilled_arguments": {
                "clue_id": clue_id,
                "method": "authored_route_after_check",
                "route_ref": {"scene_id": scene_id, "route_id": route_id},
            },
            "missing_arguments": ["decision_id"],
            "before_prose_state_write": "state.record_clue",
        })
    return cards

def _project_action_route_cards(
    ctx: Ctx,
    *,
    include_operation_opportunities: bool = True,
) -> list[dict[str, Any]]:
    open_affordances = _current_open_affordances(ctx)
    open_attempts = _open_attempt_opportunities(
        ctx, scene_id=str(ctx.world().get("active_scene_id") or "") or None,
    )
    attempts_by_route = {
        str((row.get("source") or {}).get("route_id") or ""): row
        for row in open_attempts
        if str((row.get("source") or {}).get("route_id") or "")
    }
    cards: list[dict[str, Any]] = []
    for route in open_affordances:
        route_id = str(route.get("affordance_id") or "")
        clue_ids = [str(value) for value in route.get("grants_clue_ids") or []]
        gate = route.get("roll_gate")
        attempt_opportunity = attempts_by_route.get(route_id)
        retry_status = (
            (attempt_opportunity.get("retry_status") or {})
            if isinstance(attempt_opportunity, dict)
            else {}
        )
        if route_id in attempts_by_route and retry_status.get("eligible") is True:
            resolution_kind = "reset_retry"
        elif route_id in attempts_by_route:
            resolution_kind = "push_or_context_change"
        elif clue_ids and not isinstance(gate, dict):
            resolution_kind = "direct_delivery"
        elif isinstance(gate, dict):
            resolution_kind = "authored_roll_advice"
        elif route.get("runtime_status") == "NOT_IMPLEMENTED":
            resolution_kind = "typed_capability_unavailable"
        else:
            resolution_kind = "keeper_judgment"
        card = {
            "route_id": route_id,
            "route_type": route.get("route_type"),
            "cue": route.get("player_visible_cue"),
            "target_entities": deepcopy(route.get("target_entities") or []),
            "grants_clue_ids": clue_ids,
            "resolution_kind": resolution_kind,
            "authority": "advisory",
            "hard_gate": False,
            "may_override": True,
        }
        if isinstance(gate, dict):
            card["roll_advice"] = {
                "difficulty": str(gate.get("difficulty") or "regular"),
                "stakes": gate.get("stakes"),
                "approaches": [
                    {
                        "verb": approach.get("verb"),
                        "skill": approach.get("skill"),
                    }
                    for approach in gate.get("approaches") or []
                    if isinstance(approach, dict) and approach.get("skill")
                ],
            }
        if include_operation_opportunities:
            if route_id in attempts_by_route:
                if resolution_kind == "reset_retry":
                    card["operation_opportunities"] = deepcopy(
                        attempt_opportunity.get("reset_retry_operations") or []
                    )
                else:
                    card["operation_opportunities"] = [deepcopy(
                        attempt_opportunity["suggested_operation"]
                    )]
            else:
                card["operation_opportunities"] = _route_operation_cards(ctx, route)
        if route_id in attempts_by_route:
            card["attempt_opportunity"] = deepcopy(attempt_opportunity)
        cards.append(card)
    return cards

def _intent_evidence(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ToolError(
            "invalid_param",
            "intent_evidence must be the KP's structured semantic result",
        )
    primary = value.get("primary_intent")
    reason = value.get("reason") or value.get("semantic_reason")
    if not isinstance(primary, str) or not primary.strip():
        raise ToolError("invalid_param", "intent_evidence.primary_intent is required")
    if not isinstance(reason, str) or not reason.strip():
        raise ToolError(
            "invalid_param",
            "intent_evidence requires a non-empty semantic reason",
        )
    result = deepcopy(value)
    result["primary_intent"] = primary.strip()
    result["semantic_reason"] = reason.strip()
    result.pop("reason", None)
    return result

def _advice_id(tool_name: str, ctx: Ctx, material: Any) -> str:
    digest = hashlib.sha256(
        json.dumps(material, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()[:20]
    turn = ctx.pacing().get("turn_number", 0)
    return f"{tool_name}:{turn}:{digest}"

def _storylet_advice_matches_candidate(
    advice_id: Any, candidate: dict[str, Any]
) -> bool:
    projected = [_project_storylet_candidate(candidate)]
    digest = hashlib.sha256(
        json.dumps(
            projected,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
    ).hexdigest()[:20]
    parts = str(advice_id or "").split(":")
    return len(parts) == 3 and parts[0] == "storylets" and parts[2] == digest

def _storylet_candidate_ref(
    advice_id: Any, candidate: dict[str, Any]
) -> str:
    material = {
        "advice_id": str(advice_id or ""),
        "candidate": _project_storylet_candidate(candidate),
    }
    digest = hashlib.sha256(json.dumps(
        material,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")).hexdigest()[:32]
    return f"storylet-candidate-v1:{digest}"

def _resolve_storylet_candidate_ref(
    ctx: Ctx,
    *,
    advice_id: Any,
    candidate_ref: Any,
) -> dict[str, Any]:
    """Resolve one stable Storylet reference from canonical advisory evidence."""
    expected_ref = str(candidate_ref or "").strip()
    expected_advice = str(advice_id or "").strip()
    if not expected_ref.startswith("storylet-candidate-v1:"):
        raise ToolError("invalid_param", "candidate_ref is not a Storylet candidate reference")
    if not expected_advice:
        raise ToolError("invalid_param", "advice_id is required with candidate_ref")
    rows = _read_jsonl_records(
        ctx.campaign_dir / "logs" / "toolbox-calls.jsonl"
    )
    for row in reversed(rows):
        if row.get("ok") is not True:
            continue
        tool_name = str(row.get("tool") or "")
        data = row.get("data") if isinstance(row.get("data"), dict) else {}
        candidates: list[dict[str, Any]] = []
        row_advice_id: Any = None
        if tool_name == "actions.advise":
            opportunity = data.get("narrative_opportunity")
            if isinstance(opportunity, dict):
                row_advice_id = opportunity.get("advice_id")
                candidate = opportunity.get("candidate")
                if isinstance(candidate, dict):
                    candidates = [candidate]
        elif tool_name == "storylets.suggest":
            row_advice_id = data.get("advice_id")
            candidates = [
                candidate
                for candidate in data.get("candidates") or []
                if isinstance(candidate, dict)
            ]
        if str(row_advice_id or "") != expected_advice:
            continue
        for candidate in candidates:
            if _storylet_candidate_ref(expected_advice, candidate) != expected_ref:
                continue
            if not _storylet_advice_matches_candidate(expected_advice, candidate):
                raise ToolError(
                    "state_corrupt",
                    "candidate_ref resolved to advisory evidence with a mismatched advice digest",
                )
            return deepcopy(candidate)
    raise ToolError(
        "invalid_param",
        "candidate_ref was not found in canonical Storylet advisory evidence",
    )

def _active_scene(ctx: Ctx) -> dict[str, Any]:
    return _scene_by_id(ctx.story_graph, ctx.world().get("active_scene_id")) or {}

def _investigator_character_path(ctx: Ctx, investigator_id: str) -> Path:
    return ctx.coc_root / "investigators" / investigator_id / "character.json"

def _read_optional_json(path: Path, fallback: Any) -> Any:
    if not path.is_file():
        return deepcopy(fallback)
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise ToolError("state_corrupt", f"invalid JSON source: {path}") from exc

def _execute_subsystem_command(
    ctx: Ctx,
    args: dict[str, Any],
    *,
    tool_name: str,
    allowed_kinds: set[str] | frozenset[str],
) -> tuple[dict[str, Any], list[str], list[str]]:
    prior = ctx.ledger_lookup(tool_name, args.get("decision_id"))
    if prior is not None:
        return prior.get("data"), [
            "duplicate decision_id: returning the previously settled result"
        ], []
    command = args.get("command")
    if not isinstance(command, dict):
        raise ToolError("invalid_param", "command must be an exact subsystem command object")
    kind = str(command.get("kind") or "")
    if kind not in allowed_kinds:
        raise ToolError(
            "invalid_param",
            f"{tool_name} does not accept subsystem command kind {kind!r}",
        )
    payload = command.get("payload")
    if not isinstance(payload, dict):
        raise ToolError("invalid_param", "command.payload must be an object")
    if str(payload.get("decision_id") or "") != str(args.get("decision_id") or ""):
        raise ToolError(
            "invalid_param",
            "command.payload.decision_id must equal the toolbox decision_id",
        )
    investigator_id = _resolve_investigator(ctx, args)
    results = coc_subsystem_executor.execute_commands(
        ctx.campaign_dir,
        _investigator_character_path(ctx, investigator_id),
        investigator_id,
        [command],
        rng=_rng(args),
        append_jsonl=coc_state.append_jsonl,
        character_snapshot=ctx.sheet(investigator_id),
    )
    data = {
        "schema_version": 1,
        "authority": "deterministic_subsystem",
        "investigator_id": investigator_id,
        "results": results,
    }
    ctx.ledger_record(args.get("decision_id"), tool_name, data)
    return data, [], [
        "the subsystem result is authoritative; the KP chooses the surrounding fiction but must not alter its numbers or state"
    ]

def _project_storylet_candidate(move: dict[str, Any]) -> dict[str, Any]:
    fields = (
        "storylet_id", "family_id", "trope_id", "title", "cue", "beat",
        "conflict_level", "target_conflict_level", "bound_entities",
        "rolled_variants", "presentation_mode", "grounding_contract", "serves",
        "ledger_update", "source",
    )
    return {
        field: deepcopy(move[field]) for field in fields if field in move
    }

def _pi_rules_director_single_draft_profile() -> bool:
    return (
        str(os.environ.get("COC_PI_SESSION_ROLE") or "").strip().casefold()
        == "play"
        and os.environ.get("COC_PI_ACCEPTANCE_PROFILE")
        in {"rules-all-single-draft", "rules-director-single-draft"}
    )


def _pi_play_agency_review_required() -> bool:
    return (
        str(os.environ.get("COC_PI_SESSION_ROLE") or "").strip().casefold()
        == "play"
        and not _pi_rules_director_single_draft_profile()
    )

def _tool_evidence_record_adoption(ctx: Ctx, args: dict[str, Any]):
    prior = ctx.ledger_lookup(
        "evidence.record_adoption", args.get("decision_id")
    )
    if prior is not None:
        return prior.get("data"), [
            "duplicate decision_id: returning the previously recorded advisory disposition"
        ], []
    advice_id = str(args.get("advice_id") or "").strip()
    known_advice_ids: set[str] = set()
    for row in _read_jsonl_records(
        ctx.campaign_dir / "logs" / "toolbox-calls.jsonl"
    ):
        if row.get("ok") is not True:
            continue
        data = row.get("data") if isinstance(row.get("data"), dict) else {}
        direct_id = data.get("advice_id")
        if isinstance(direct_id, str) and direct_id:
            known_advice_ids.add(direct_id)
        opportunity = data.get("narrative_opportunity")
        if isinstance(opportunity, dict):
            nested_id = opportunity.get("advice_id")
            if isinstance(nested_id, str) and nested_id:
                known_advice_ids.add(nested_id)
    if not advice_id or advice_id not in known_advice_ids:
        raise ToolError(
            "unknown_advice_id",
            "advice_id must name an actual successful advisory receipt in this campaign",
        )
    disposition = str(args.get("disposition") or "")
    if disposition not in {"adopted", "modified", "ignored"}:
        raise ToolError("invalid_param", "disposition must be adopted, modified, or ignored")
    reason = str(args.get("reason") or "").strip()
    if not reason:
        raise ToolError("invalid_param", "reason is required")
    fields = args.get("adopted_fields") or []
    if not isinstance(fields, list) or any(not isinstance(value, str) for value in fields):
        raise ToolError("invalid_param", "adopted_fields must be an array of strings")
    tone_adoption = args.get("emotional_tone_adoption") or []
    if not isinstance(tone_adoption, list):
        raise ToolError("invalid_param", "emotional_tone_adoption must be an array")
    normalized_tones: list[dict[str, str]] = []
    for entry in tone_adoption:
        if not isinstance(entry, dict):
            raise ToolError("invalid_param", "emotional_tone_adoption entries must be objects")
        tone_npc_id = str(entry.get("npc_id") or "").strip()
        tone_value = str(entry.get("emotional_tone") or "").strip()
        tone_status = str(entry.get("adoption") or "").strip()
        if not tone_npc_id or not tone_value:
            raise ToolError(
                "invalid_param",
                "emotional_tone_adoption entries require npc_id and emotional_tone",
            )
        if tone_status not in {"adopted", "modified", "ignored"}:
            raise ToolError(
                "invalid_param",
                "emotional_tone_adoption adoption must be adopted, modified, or ignored",
            )
        normalized_tones.append({
            "npc_id": tone_npc_id,
            "emotional_tone": tone_value,
            "adoption": tone_status,
        })
    data = {
        "schema_version": 1,
        "visibility": "keeper_internal",
        "decision_id": str(args["decision_id"]),
        "advice_id": advice_id,
        "disposition": disposition,
        "reason": reason,
        "adopted_fields": fields,
    }
    if args.get("finalization_id") is not None:
        data["finalization_id"] = str(args["finalization_id"])
    if args.get("exact_excerpt") is not None:
        data["exact_excerpt"] = str(args["exact_excerpt"])
    if normalized_tones:
        data["emotional_tone_adoption"] = normalized_tones
    warnings: list[str] = []
    storylet_candidate = args.get("storylet_candidate")
    candidate_ref = str(args.get("candidate_ref") or "").strip()
    if storylet_candidate is not None and candidate_ref:
        warnings.append(
            "both candidate_ref and storylet_candidate were supplied; the stable candidate_ref was used"
        )
        storylet_candidate = None
    if candidate_ref:
        data["candidate_ref"] = candidate_ref
        try:
            storylet_candidate = _resolve_storylet_candidate_ref(
                ctx,
                advice_id=args.get("advice_id"),
                candidate_ref=candidate_ref,
            )
        except ToolError as exc:
            storylet_candidate = None
            warnings.append(
                "candidate_ref could not be resolved; adoption evidence was kept "
                f"but the anti-repeat ledger was not changed: {exc.message}"
            )
    if storylet_candidate is not None:
        if not isinstance(storylet_candidate, dict):
            warnings.append(
                "storylet_candidate was not an object; adoption evidence was kept but the anti-repeat ledger was not changed"
            )
        elif disposition in {"adopted", "modified"}:
            if not _storylet_advice_matches_candidate(
                args["advice_id"], storylet_candidate
            ):
                warnings.append(
                    "storylet candidate no longer matches this turn's stable advice id; adoption evidence was kept but the anti-repeat ledger was not changed"
                )
            elif not str(storylet_candidate.get("storylet_id") or "").strip():
                warnings.append(
                    "storylet candidate has no stable storylet_id; adoption evidence was kept but the anti-repeat ledger was not changed"
                )
            else:
                ledger_path = ctx.campaign_dir / "save" / "storylet-ledger.json"
                current_ledger = _read_optional_json(ledger_path, {})
                ledger_update = coc_storylets.project_ledger_update(
                    current_ledger, storylet_candidate
                )
                coc_state.write_json_atomic(ledger_path, ledger_update)
                data["storylet_adoption"] = {
                    "storylet_id": storylet_candidate.get("storylet_id"),
                    "family_id": storylet_candidate.get("family_id"),
                    "trope_id": storylet_candidate.get("trope_id"),
                    "ledger_updated": True,
                }
                ctx.log_event({
                    "event_type": "storylet_move",
                    "decision_id": str(args["decision_id"]),
                    "storylet_id": storylet_candidate.get("storylet_id"),
                    "family_id": storylet_candidate.get("family_id"),
                    "trope_id": storylet_candidate.get("trope_id"),
                    "title": storylet_candidate.get("title"),
                    "cue": storylet_candidate.get("cue"),
                    "beat": storylet_candidate.get("beat"),
                    "conflict_level": storylet_candidate.get("conflict_level"),
                    "target_conflict_level": storylet_candidate.get(
                        "target_conflict_level"
                    ),
                    "bound_entities": deepcopy(
                        storylet_candidate.get("bound_entities") or {}
                    ),
                    "rolled_variants": deepcopy(
                        storylet_candidate.get("rolled_variants") or {}
                    ),
                    "presentation_mode": storylet_candidate.get(
                        "presentation_mode"
                    ),
                    "grounding_contract": deepcopy(
                        storylet_candidate.get("grounding_contract") or {}
                    ),
                    "serves": deepcopy(storylet_candidate.get("serves") or []),
                    "source": "toolbox_advisory_adoption",
                })
    ctx.ledger_record(args["decision_id"], "evidence.record_adoption", data)
    coc_state.append_jsonl(
        ctx.campaign_dir / "logs" / "advisory-adoptions.jsonl",
        {**data, "ts": _now_iso()},
    )
    return data, warnings, [
        "this receipt proves use or rejection; it does not constrain the next turn",
        "an adopted Storylet updates only its existing anti-repeat ledger; the KP still owns fictional realization and may ignore future candidates",
    ]

def _resolve_granted_item_spec(
    ctx: Ctx,
    args: dict[str, Any],
    *,
    tool_name: str,
    decision_id: str,
) -> dict[str, Any]:
    """Canonical item/weapon payload used by grant and purchase."""
    kind = str(args["kind"]).strip()
    if kind not in coc_inventory.ENTRY_KINDS:
        raise ToolError(
            "invalid_param", f"kind must be one of {list(coc_inventory.ENTRY_KINDS)}"
        )
    label = str(args["label"]).strip()
    if not label:
        raise ToolError("invalid_param", "label must be non-empty")
    note = str(args.get("note") or "").strip() or None
    consumable = args.get("consumable")
    if consumable is not None and not isinstance(consumable, bool):
        raise ToolError("invalid_param", "consumable must be a boolean")
    quantity = args.get("quantity")
    if quantity is not None and (
        not isinstance(quantity, int)
        or isinstance(quantity, bool)
        or quantity < 1
    ):
        raise ToolError("invalid_param", "quantity must be an integer >= 1")
    if kind == "weapon" and (consumable is not None or quantity is not None):
        raise ToolError(
            "invalid_param", "kind=weapon must not carry consumable/quantity"
        )
    weapon_spec: dict[str, Any] | None = None
    if kind == "weapon":
        raw_weapon = args.get("weapon")
        mechanics_ref = str(args.get("mechanics_ref") or "").strip()
        if mechanics_ref:
            if mechanics_ref.startswith("campaign-item:"):
                ref_id = mechanics_ref.split(":", 1)[1]
                row = ctx.campaign_mechanics()["items"].get(ref_id)
                profile = row.get("profile") if isinstance(row, dict) else None
            elif mechanics_ref.startswith("module-item:"):
                ref_id = mechanics_ref.split(":", 1)[1]
                source_item = _module_item(ctx, ref_id) or {}
                source_mechanics = source_item.get("mechanics")
                profile = (
                    source_mechanics.get("profile")
                    if isinstance(source_mechanics, dict)
                    and source_mechanics.get("status") == "authored"
                    else None
                )
            else:
                raise ToolError(
                    "invalid_param", "mechanics_ref must start with campaign-item: or module-item:",
                )
            if not isinstance(profile, dict) or profile.get("profile_kind") != "weapon":
                raise ToolError("invalid_param", "mechanics_ref does not resolve to a weapon profile")
            weapon_spec = deepcopy(profile)
            weapon_spec.pop("profile_kind", None)
            try:
                weapon_spec = coc_mechanics.accept_granted_weapon(weapon_spec)
            except coc_mechanics.MechanicsError as exc:
                raise ToolError("unknown_weapon", str(exc)) from exc
        elif raw_weapon is not None:
            if not isinstance(raw_weapon, dict):
                raise ToolError("invalid_param", "weapon must be an object")
            try:
                weapon_spec = coc_mechanics.accept_granted_weapon(deepcopy(raw_weapon))
            except coc_mechanics.MechanicsError as exc:
                raise ToolError("unknown_weapon", str(exc)) from exc
        else:
            weapon_id = str(args.get("weapon_id") or "").strip()
            if not weapon_id:
                raise ToolError(
                    "invalid_param", "kind=weapon requires weapon_id or weapon"
                )
            try:
                weapon_spec = coc_mechanics.accept_granted_weapon(
                    {"weapon_id": weapon_id}
                )
            except coc_mechanics.MechanicsError as exc:
                raise ToolError("unknown_weapon", str(exc)) from exc
        item_id = (
            str(args.get("item_id") or "").strip()
            or coc_inventory.weapon_ref_id(weapon_spec)
        )
    else:
        if (
            args.get("weapon") is not None
            or str(args.get("weapon_id") or "").strip()
            or str(args.get("mechanics_ref") or "").strip()
        ):
            raise ToolError(
                "invalid_param", "kind=gear must not carry weapon_id/weapon"
            )
        item_id = str(args.get("item_id") or "").strip() or label
    if not item_id:
        raise ToolError("invalid_param", "item_id must be non-empty")
    entry: dict[str, Any] = {"item_id": item_id, "kind": kind, "label": label}
    if weapon_spec is not None:
        entry["weapon"] = weapon_spec
    if consumable is not None:
        entry["consumable"] = consumable
    if quantity is not None:
        entry["quantity"] = quantity
    if note:
        entry["note"] = note
    entry["acquired"] = {
        "tool": tool_name,
        "decision_id": decision_id,
        "ts": _now_iso(),
    }
    return {
        "kind": kind,
        "label": label,
        "note": note,
        "consumable": consumable,
        "quantity": quantity,
        "weapon_spec": weapon_spec,
        "item_id": item_id,
        "entry": entry,
    }

def _normalize_engagement_route_completion(
    ctx: Ctx, value: Any,
) -> dict[str, Any] | None:
    if value is None:
        return None
    if not isinstance(value, dict) or set(value) != {
        "scene_id", "route_id", "semantic_reason",
    }:
        raise ToolError(
            "invalid_param",
            "route_completion must contain exactly scene_id, route_id, semantic_reason",
        )
    normalized = {
        key: str(value.get(key) or "").strip()
        for key in ("scene_id", "route_id", "semantic_reason")
    }
    if not all(normalized.values()):
        raise ToolError(
            "invalid_param", "route_completion fields must be non-empty strings",
        )
    scene = _scene_by_id(ctx.story_graph, normalized["scene_id"])
    route = _affordance_by_id(scene, normalized["route_id"])
    if scene is None or route is None:
        raise ToolError(
            "invalid_param",
            "route_completion must name an exact authored scene/route pair",
        )
    return normalized

def _settle_engagement_route_completion(
    ctx: Ctx,
    route_completion: Any,
    *,
    decision_id: str,
    evidence_ref: str,
) -> tuple[dict[str, Any] | None, list[str]]:
    if not isinstance(route_completion, dict):
        return None, []
    return _settle_contextual_route(
        ctx,
        {
            "schema_version": 1,
            "hard_gate": False,
            "scene_id": route_completion["scene_id"],
            "route_id": route_completion["route_id"],
            "semantic_completion": True,
            "semantic_reason": route_completion["semantic_reason"],
            "evidence_ref": evidence_ref,
        },
        decision_id=decision_id,
        source_tool="state.record_npc_engagement",
        successful=True,
    )

def _npc_engagement_operation(
    ctx: Ctx, args: dict[str, Any]
) -> tuple[str, str, str, str, dict[str, Any]]:
    """Resolve the immutable engagement identity without writing campaign state."""
    decision_id = str(args["decision_id"])
    requested_npc_id = str(args["npc_id"])
    requested_interaction_kind = str(args["interaction_kind"]).strip()
    supplied_identity_ref = str(args.get("identity_ref") or "").strip()
    supplied_first_impression_ref = str(
        args.get("first_impression_ref") or ""
    ).strip()
    supplied_realization = deepcopy(args.get("first_impression_realization"))
    investigator_id = _resolve_investigator(ctx, args)
    run_id = coc_npc_event_chain.resolve_run_id(
        ctx.campaign_dir, structured_source=args
    )
    operation = {
        "npc_id": requested_npc_id,
        "investigator_id": investigator_id,
        "interaction_kind": requested_interaction_kind,
        "identity_ref": supplied_identity_ref or None,
        "first_impression_ref": supplied_first_impression_ref or None,
        "first_impression_realization": supplied_realization,
    }
    route_completion = _normalize_engagement_route_completion(
        ctx, args.get("route_completion")
    )
    if route_completion is not None:
        operation["route_completion"] = route_completion
    return (
        decision_id,
        requested_npc_id,
        requested_interaction_kind,
        run_id,
        operation,
    )

def _matching_active_exceptional_modifier(
    ctx: Ctx, *, investigator_id: str, skill: str, npc_id: str | None = None
) -> dict[str, Any] | None:
    try:
        document = coc_exceptional_effects.load(ctx.campaign_dir)
    except ValueError as exc:
        raise ToolError("state_corrupt", str(exc)) from exc
    active_scene_id = str(ctx.world().get("active_scene_id") or "")
    matches = []
    for effect in document["effects"].values():
        mechanics = effect.get("mechanics") or {}
        if (
            effect.get("status") == "active"
            and effect.get("effect_kind") in {"bonus_die", "penalty_die"}
            and mechanics.get("investigator_id") == investigator_id
            and str(mechanics.get("skill") or "").casefold() == skill.casefold()
            and (
                mechanics.get("target_id") is None
                or mechanics.get("target_id") == npc_id
            )
            and (
                mechanics.get("scene_id") is None
                or mechanics.get("scene_id") == active_scene_id
            )
        ):
            matches.append(effect)
    if len(matches) > 1:
        raise ToolError(
            "state_corrupt",
            "multiple active exceptional modifiers own the same actor+skill+NPC+scene scope",
        )
    return deepcopy(matches[0]) if matches else None

_TABLE_TRANSCRIPT_RELATIVE = Path("logs") / "table-transcript.jsonl"

_TABLE_OPENING_RECORD_KIND = "table_opening"

_PLAYER_TURN_RECORD_KIND = "player_turn"

_FINALIZED_KEEPER_RECORD_KIND = "finalized_keeper"

_TABLE_OPENING_SOURCE_PREFIX = "table.opening#"

def _table_transcript_rows(ctx: Ctx) -> list[dict[str, Any]]:
    path = ctx.campaign_dir / _TABLE_TRANSCRIPT_RELATIVE
    return _read_jsonl_records(path) if path.is_file() else []

def _table_transcript_entry_id(role: str, source_id: str) -> str:
    payload = json.dumps(
        ["table-transcript-v1", role, source_id],
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode("utf-8")
    return f"table-transcript-v1:{hashlib.sha256(payload).hexdigest()[:40]}"

def _active_session_binding(ctx: Ctx, run_segment_id: str) -> dict[str, str]:
    marker = coc_host_context.current_marker(ctx.root)
    if (
        isinstance(marker, dict)
        and marker.get("ended_at") is None
        and isinstance(marker.get("session_id"), str)
        and str(marker["session_id"]).strip()
    ):
        return {
            "session_id": str(marker["session_id"]).strip(),
            "source": "host_context",
            "trust": "observed",
        }
    digest = hashlib.sha256(
        f"direct-toolbox-session-v1:{ctx.campaign_id}:{run_segment_id}".encode("utf-8")
    ).hexdigest()[:32]
    return {
        "session_id": f"direct-toolbox:{digest}",
        "source": "direct_toolbox_fallback",
        "trust": "fallback",
    }

def _run_segment_binding(
    ctx: Ctx, *, supplied_alias: Any = None, opening: bool = False
) -> dict[str, str | None]:
    """Freeze one run segment on the existing opening/transcript lifecycle."""
    alias = str(supplied_alias or "").strip()
    rows = _table_transcript_rows(ctx)
    bound_rows = [
        row for row in rows
        if isinstance(row.get("run_segment_id"), str)
        and str(row["run_segment_id"]).strip()
    ]
    identities = {str(row["run_segment_id"]).strip() for row in bound_rows}
    try:
        persisted = coc_state.load_run_identity(ctx.campaign_dir)
    except coc_state.UnsupportedSaveSchema as exc:
        raise ToolError("state_corrupt", str(exc)) from exc
    if persisted is not None:
        persisted_id = str(persisted["run_segment_id"])
        if identities and persisted_id not in identities:
            raise ToolError(
                "run_identity_conflict",
                "persisted run identity does not match the table transcript",
            )
        identities.add(persisted_id)
    if len(identities) > 1:
        raise ToolError("state_corrupt", "table transcript spans multiple run segments")
    if identities:
        run_segment_id = next(iter(identities))
        if alias and alias != run_segment_id:
            raise ToolError(
                "run_segment_conflict",
                "caller run_id does not match the frozen table run segment",
            )
        first = bound_rows[0] if bound_rows else {}
        return {
            "run_segment_id": run_segment_id,
            "alias": alias or None,
            "source": (
                "run_identity"
                if persisted is not None and not bound_rows
                else str(first.get("run_segment_source") or "transcript_frozen")
            ),
            "trust": (
                "authoritative"
                if persisted is not None and not bound_rows
                else str(first.get("run_segment_trust") or "fallback")
            ),
        }
    if opening:
        if not alias:
            raise ToolError("invalid_param", "table opening requires a stable run_id")
        return {
            "run_segment_id": alias,
            "alias": alias,
            "source": "table_opening",
            "trust": "authoritative",
        }
    resolved = coc_npc_event_chain.resolve_run_id(
        ctx.campaign_dir, structured_source={"run_id": alias or None}
    )
    return {
        "run_segment_id": resolved,
        "alias": alias or None,
        "source": "caller_fallback" if alias else "campaign_fallback",
        "trust": "fallback",
    }

def _record_table_transcript_entry(
    ctx: Ctx,
    *,
    role: str,
    text: str,
    run_id: str,
    turn_number: int,
    turn_id: str,
    journal_decision_id: str,
    source_id: str,
    speaker: str,
    finalization_id: str | None = None,
    presented_roll_ids: list[str] | None = None,
    session_id: str | None = None,
    accepted_revision: int | None = None,
    rendered_text_sha256: str | None = None,
    run_segment_source: str | None = None,
    run_segment_trust: str | None = None,
) -> dict[str, Any]:
    clean_text = str(text)
    if not clean_text.strip():
        raise ToolError("invalid_param", "table transcript text must be non-empty")
    entry_id = _table_transcript_entry_id(role, source_id)
    session_binding = _active_session_binding(ctx, run_id)
    bound_session_id = session_id or session_binding["session_id"]
    try:
        identity = coc_state.bind_run_identity(
            ctx.campaign_dir,
            campaign_id=str(ctx.campaign_id),
            run_segment_id=run_id,
            session_id=bound_session_id,
        )
    except coc_state.RunIdentityConflict as exc:
        raise ToolError(exc.code, str(exc)) from exc
    except (coc_state.UnsupportedSaveSchema, ValueError) as exc:
        raise ToolError("state_corrupt", str(exc)) from exc
    stable = {
        "schema_version": 1,
        "entry_id": entry_id,
        "run_id": identity["run_segment_id"],
        "run_segment_id": identity["run_segment_id"],
        "run_segment_source": run_segment_source or "transcript_frozen",
        "run_segment_trust": run_segment_trust or "fallback",
        "session_id": identity["session_id"],
        "session_source": session_binding["source"],
        "session_trust": session_binding["trust"],
        "turn": int(turn_number),
        "turn_id": turn_id,
        "journal_decision_id": journal_decision_id,
        "role": role,
        "speaker": speaker,
        "text": clean_text,
        "text_sha256": _canonical_digest(clean_text),
        "source_id": source_id,
        "source_ref": (
            f"logs/turn-finalizations.jsonl#{finalization_id}"
            if finalization_id
            else f"{_TABLE_OPENING_SOURCE_PREFIX}{source_id}"
            if role == "keeper"
            else f"state.journal#{journal_decision_id}"
        ),
        "record_kind": (
            _FINALIZED_KEEPER_RECORD_KIND
            if finalization_id
            else _TABLE_OPENING_RECORD_KIND
            if role == "keeper"
            else _PLAYER_TURN_RECORD_KIND
        ),
        "finalization_id": finalization_id,
        "accepted_revision": accepted_revision,
        "rendered_text_sha256": rendered_text_sha256,
    }
    if presented_roll_ids is not None:
        stable["presented_roll_ids"] = list(presented_roll_ids)
    matches = [
        row for row in _table_transcript_rows(ctx)
        if row.get("entry_id") == entry_id
    ]
    if len(matches) > 1:
        raise ToolError("state_corrupt", f"duplicate table transcript entry '{entry_id}'")
    if matches:
        prior = matches[0]
        expected = dict(stable)
        if "record_kind" not in prior:
            expected.pop("record_kind", None)
        comparable = {key: prior.get(key) for key in expected}
        if comparable != expected:
            raise ToolError(
                "idempotency_conflict",
                f"table transcript entry '{entry_id}' already owns different text",
            )
        return deepcopy(prior)
    entry = {**stable, "ts": _now_iso()}
    coc_state.append_jsonl(ctx.campaign_dir / _TABLE_TRANSCRIPT_RELATIVE, entry)
    return entry

def _latest_narrative_opportunity(
    current_window: dict[str, Any],
) -> dict[str, Any] | None:
    for row in reversed(current_window.get("rows") or []):
        if not isinstance(row, dict) or row.get("tool") != "actions.advise":
            continue
        data = row.get("data")
        if isinstance(data, dict) and isinstance(
            data.get("narrative_opportunity"), dict
        ):
            return deepcopy(data["narrative_opportunity"])
    return None

def _ending_rng(ending: dict[str, Any], investigator_id: str) -> random.Random:
    identities = ending.get("rng_identity")
    identity = identities.get(investigator_id) if isinstance(identities, dict) else None
    seed_material = (
        identity.get("seed_material") if isinstance(identity, dict) else None
    )
    if not isinstance(seed_material, str) or not seed_material:
        seed_material = (
            f"{ending.get('ending_id', 'pending-ending')}:"
            f"{investigator_id}:development.settle"
        )
    return random.Random(seed_material)

def bind_runtime_registry(registry: OperationRegistry) -> None:
    global TOOLS, tool
    TOOLS = registry.legacy_tools
    tool = registry.tool


OPERATION_RUNTIME_EXPORTS = (
    'Any',
    'Callable',
    'Ctx',
    'ExitStack',
    'Path',
    'TOOLS',
    'ToolError',
    '_CHARACTERISTIC_NAMES',
    '_CHARGEN_DICE_PURPOSES',
    '_CONSERVATIVE_CLAIM_CEILING',
    '_CONTINUATION_DOMAINS',
    '_CUSTOM_SETUP_OPERATION_KINDS',
    '_DICE_RESOLUTION_FIELDS',
    '_DIFFICULTY_BASIS_VALUES',
    '_FINALIZED_KEEPER_RECORD_KIND',
    '_HERE',
    '_LEDGER_ENTRY_V2_FIELDS',
    '_LEDGER_ENTRY_V3_FIELDS',
    '_LEDGER_ENTRY_V4_FIELDS',
    '_LEDGER_ENTRY_V5_FIELDS',
    '_LEDGER_FIELDS',
    '_LEDGER_MAX_ENTRIES',
    '_LEDGER_SCHEMA_VERSION',
    '_LEGACY_PERCENTILE_INVOCATION_FIELD_SETS',
    '_LOCATION_PACK_DEFAULT_SEMANTIC_FIELDS',
    '_LOCATION_PACK_STRUCTURAL_FIELDS',
    '_LUCK_SPEND_OPERATION_FIELDS',
    '_LUCK_SPEND_RECEIPT_FIELDS',
    '_LUCK_SPEND_RECEIPT_SCHEMA_VERSION',
    '_NPC_PRESENCE_RECORD_FIELDS',
    '_NPC_PRESENCE_SCHEMA_VERSION',
    '_OPENING_SETUP_ACL',
    '_OPENING_SETUP_ACL_BLOCK_ALL',
    '_OPENING_SETUP_ACL_CHARACTER_SETUP',
    '_PERCENTILE_INVOCATION_FIELDS',
    '_PERCENTILE_RESOLUTION_FIELDS',
    '_PI_BACKGROUND_CLAIM_CEILING',
    '_PI_OPENING_PHASE_QUERY_OPERATIONS',
    '_PI_OPENING_SETUP_ALLOWED_OPERATIONS',
    '_PI_OPENING_SETUP_ALLOWED_SETUP_KINDS',
    '_PI_SOURCE_COORDINATOR_MAX_ATTEMPTS',
    '_PLAYER_TURN_RECORD_KIND',
    '_PUSH_INHERITED_ARGUMENTS',
    '_PUSH_INHERITED_OPERATION_FIELDS',
    '_ROLL_GATED_DELIVERY_KINDS',
    '_ROLL_GATED_DISCOVERY_MODES',
    '_ROLL_RECEIPT_DOCUMENT_FIELDS',
    '_ROLL_RECEIPT_DOCUMENT_SCHEMA_VERSION',
    '_ROLL_RECEIPT_FIELDS',
    '_ROLL_RECEIPT_SCHEMA_VERSION',
    '_ROLL_RECEIPT_TOOLS',
    '_ROLL_RESOLUTION_CONTEXT_TEXT_FIELDS',
    '_SAFE_ID',
    '_SKILL_BASES_CACHE',
    '_SKILL_CATALOG_CACHE',
    '_SOURCE_RECEIPTS_KEY',
    '_SOURCE_RECEIPT_FIELDS',
    '_SOURCE_RECEIPT_INTEGRITY_KEY',
    '_SOURCE_RECEIPT_SCHEMA_VERSION',
    '_TABLE_OPENING_RECORD_KIND',
    '_TABLE_OPENING_SOURCE_PREFIX',
    '_TABLE_TRANSCRIPT_RELATIVE',
    '_TIME_MARKER_DOCUMENT_FIELDS',
    '_TIME_MARKER_DOCUMENT_SCHEMA_VERSION',
    '_TOOL_TRANSIENT_RETRY_ATTEMPTS',
    '_TOOL_TRANSIENT_RETRY_DELAY_SECONDS',
    '_TURN_RECOVERY_MEANINGFUL_QUERIES',
    '_TURN_RECOVERY_NON_TURN_MUTATIONS',
    '_active_ruleset_id',
    '_active_scene',
    '_active_session_binding',
    '_active_time_markers',
    '_adjudication_gap_hints',
    '_advice_id',
    '_affordance_by_id',
    '_all_clues',
    '_anchored_flag_heads',
    '_anchored_marker_heads',
    '_anchored_npc_presence_heads',
    '_append_roll_frame_locked',
    '_apply_marker_live_record',
    '_apply_opening_setup_observation',
    '_apply_roll_materialization_plan',
    '_apply_roll_receipt_side_effects',
    '_authored_npc_mechanics_revision_ref',
    '_authored_unlock_world',
    '_campaign_document',
    '_campaign_npc_projection_index',
    '_campaign_play_language',
    '_canonical_digest',
    '_canonical_skill_base',
    '_canonical_skill_selector',
    '_clock_reached',
    '_close_matches',
    '_clue_by_id',
    '_clue_is_roll_gated',
    '_clue_public_view',
    '_clue_roll_gate_skills',
    '_combat_state',
    '_commit_new_roll_receipt',
    '_compact_skill_fold',
    '_compile_new_percentile_invocation',
    '_compiled_module_npc_mechanics',
    '_continuation_revision',
    '_current_dependency_wait_projection',
    '_current_elapsed_minutes',
    '_current_open_affordances',
    '_dice_evidence_is_consistent',
    '_director_receipt_event_present',
    '_ending_rng',
    '_ensure_first_impression_roll',
    '_ensure_npc_receipt_event',
    '_ensure_operation_event',
    '_ensure_roll_receipt_row',
    '_era_adaptive_chargen_dice',
    '_evaluate_and_apply_unlocks',
    '_execute_subsystem_command',
    '_execute_subsystem_requests',
    '_existing_roll_receipt',
    '_flag_receipt_rows',
    '_flags_set',
    '_freeze_roll_receipt_source',
    '_fulfill_full_parse_host_work',
    '_fulfill_host_work_for_asset_unlocked',
    '_improvised_npc_engagement_count',
    '_intent_evidence',
    '_investigator_character_path',
    '_is_exact_int',
    '_jsonl_rows',
    '_latest_anchored_flag_head',
    '_latest_anchored_marker_head',
    '_latest_anchored_npc_presence_head',
    '_latest_narrative_opportunity',
    '_ledger_requires_source_receipt',
    '_load_json_document',
    '_load_npc_presence_document',
    '_load_roll_receipt_document',
    '_load_sibling',
    '_load_time_markers',
    '_location_pack_required_semantic_fields',
    '_logged_roll_skills',
    '_luck_source_reference',
    '_luck_spend_data',
    '_mark_improvement_tick',
    '_marker_live_record',
    '_matches_canonical_skill_identity',
    '_matching_active_exceptional_modifier',
    '_materialize_roll_receipts_locked',
    '_materialize_stable_receipt_event',
    '_mechanics_jobs',
    '_module_item',
    '_nearby_route_index',
    '_new_roll_receipt',
    '_new_source_receipt',
    '_normalize_engagement_route_completion',
    '_normalize_percentile_invocation',
    '_normalize_roll_resolution_context',
    '_normalized_verbatim_excerpt',
    '_now_iso',
    '_npc_by_id',
    '_npc_engagement_operation',
    '_npc_identity_contract',
    '_npc_presence_live_record',
    '_npc_presence_receipts',
    '_npc_presence_record_valid',
    '_npc_receipt_path',
    '_npc_receipt_warnings',
    '_npc_receipts_for_decision',
    '_open_attempt_opportunities',
    '_open_attempt_opportunities_from_document',
    '_opening_card',
    '_opening_host_work_mode',
    '_operation_event_id',
    '_operation_event_present',
    '_operation_fingerprint',
    '_optional_consequence_evidence_matches',
    '_optional_scalar_evidence_matches',
    '_parse_complete_roll_frames',
    '_party_runtime_finance',
    '_pending_deliveries',
    '_pending_jsonl_rows',
    '_pi_opening_character_setup_envelope',
    '_pi_opening_setup_gate',
    '_pi_opening_setup_operation_allowed',
    '_pi_opening_source_contract_error_gate',
    '_pi_play_agency_review_required',
    '_pi_rules_director_single_draft_profile',
    '_pi_source_coordinator_dispatch',
    '_plan_receipt_owned_tail',
    '_plan_roll_materialization',
    '_player_mechanical_snapshot',
    '_player_state_receipt',
    '_preflight_roll_document',
    '_project_action_route_cards',
    '_project_storylet_candidate',
    '_project_time_marker',
    '_push_operation_opportunity',
    '_put_roll_receipt',
    '_put_source_receipt',
    '_queue_roll_side_effect',
    '_quick_fire_chargen_dice',
    '_read_jsonl_records',
    '_read_object',
    '_read_optional_json',
    '_reconcile_all_flag_source_receipts',
    '_reconcile_all_marker_source_receipts',
    '_reconcile_all_npc_presence_source_receipts',
    '_reconcile_all_npc_source_receipts',
    '_reconcile_all_roll_source_receipts',
    '_record_table_transcript_entry',
    '_repair_roll_receipt_ledger',
    '_replay_bound_decision',
    '_replay_roll_receipt',
    '_replay_source_receipt',
    '_request_digest',
    '_require_body_location_canonical_identities',
    '_require_closed_handout_worker_pack',
    '_require_handout_text_evidence',
    '_require_location_pack_semantic_fields',
    '_resolve_granted_item_spec',
    '_resolve_investigator',
    '_resolve_storylet_candidate_ref',
    '_resolve_target_value',
    '_rng',
    '_roll_common',
    '_roll_log_bytes',
    '_roll_prefix_hash_update',
    '_roll_receipt',
    '_roll_receipt_needs_side_effect',
    '_roll_receipt_path',
    '_roll_record_frame',
    '_roll_side_effect_key',
    '_route_operation_cards',
    '_route_retry_status',
    '_route_roll_context',
    '_rules_resolver',
    '_run_segment_binding',
    '_runtime_generated_npc_mechanics',
    '_save_json_document',
    '_save_roll_receipt_document',
    '_save_time_markers',
    '_scene_by_id',
    '_scene_contract_projection',
    '_settle_contextual_route',
    '_settle_engagement_route_completion',
    '_settle_pending_roll_side_effect',
    '_skill_catalog',
    '_skill_check_clues_missing_roll_evidence',
    '_source_claiming_pack_task',
    '_source_coordinator_dispatch',
    '_source_direct_single_dispatch',
    '_source_host_work_projection',
    '_source_inline_single_dispatch',
    '_source_parent_flat_fanout_dispatch',
    '_source_receipt',
    '_source_receipt_integrity',
    '_source_receipt_manifest',
    '_source_submit_lock_path',
    '_stored_toolbox_receipt_valid',
    '_story_thread',
    '_storylet_advice_matches_candidate',
    '_storylet_candidate_ref',
    '_table_transcript_entry_id',
    '_table_transcript_rows',
    '_time_markers_path',
    '_tool_evidence_record_adoption',
    '_tool_scene_context',
    '_turn_recovery_meaningful_tools',
    '_unique_max_head',
    '_validate_generic_check_receipt',
    '_validate_luck_spend_receipts',
    '_validate_roll_receipt',
    '_validate_roll_resolution_consistency',
    '_validate_source_receipt',
    '_validated_receipt_entity_head',
    '_validated_roll_document_collection',
    '_verify_roll_receipt_prefixes',
    '_with_mechanics_locator_discovery',
    '_working_set_domain_paths',
    '_world_flag_continuity',
    'annotations',
    'argparse',
    'coc_action_resolver',
    'coc_async_recorder',
    'coc_belief_state',
    'coc_cash',
    'coc_compiled_archive',
    'coc_continuation',
    'coc_development',
    'coc_exceptional_effects',
    'coc_fileio',
    'coc_finance',
    'coc_first_impression',
    'coc_flag_state',
    'coc_git_history',
    'coc_handouts',
    'coc_host_context',
    'coc_inventory',
    'coc_language',
    'coc_mechanics',
    'coc_module_project',
    'coc_npc_event_chain',
    'coc_npc_identity',
    'coc_npc_state',
    'coc_opening_phase',
    'coc_opening_recovery',
    'coc_roll',
    'coc_rule_signals',
    'coc_rules',
    'coc_rulesets',
    'coc_runtime_ops',
    'coc_scene_graph',
    'coc_state',
    'coc_storylets',
    'coc_subsystem_executor',
    'coc_time',
    'coc_turn_finalization',
    'coc_turn_manifest',
    'coc_working_set_cache',
    'datetime',
    'deepcopy',
    'emit_core_canonical_event',
    'hashlib',
    'importlib',
    'json',
    'os',
    'random',
    're',
    'reconcile_campaign_continuity',
    'stat',
    'sys',
    'time',
    'timedelta',
    'timezone',
    'tool',
)
