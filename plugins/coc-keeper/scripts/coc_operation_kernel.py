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
        return cls(
            audience=str(value["audience"]),
            phases=phases,
            contract=str(value["contract"]),
            advisory=bool(value["advisory"]),
            kp_surface=str(value["kp_surface"]),
        )

    def public(self) -> dict[str, Any]:
        return {
            "audience": self.audience,
            "phases": list(self.phases),
            "contract": self.contract,
            "advisory": self.advisory,
            "kp_surface": self.kp_surface,
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
            selected.append(name)
        return sorted(selected)

    def __iter__(self) -> Iterator[str]:
        return iter(self._specs)

    def __len__(self) -> int:
        return len(self._specs)
