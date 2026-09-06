"""Error envelope shared by every kernel module (contract §1)."""

from __future__ import annotations

from typing import Any

ERROR_CODES = frozenset({
    "invalid_params",
    "unknown_method",
    "not_implemented",
    "campaign_not_found",
    "campaign_not_ready",
    "turn_state",
    "idempotency_conflict",
    "needs",
    "needs_choice",
    "unknown_entity",
    "not_reachable",
    "not_here",
    "commit_failed",
    "internal",
})


class RpcError(Exception):
    def __init__(self, code: str, message: str, *, fix: str | None = None,
                 details: dict[str, Any] | None = None) -> None:
        if code not in ERROR_CODES:
            raise ValueError(f"unknown error code {code!r}")
        super().__init__(message)
        self.code = code
        self.message = message
        self.fix = fix
        self.details = details

    def to_json(self) -> dict[str, Any]:
        error: dict[str, Any] = {"code": self.code, "message": self.message}
        if self.fix:
            error["fix"] = self.fix
        if self.details is not None:
            error["details"] = self.details
        return error


def invalid_params(message: str, *, fix: str | None = None,
                   details: dict[str, Any] | None = None) -> RpcError:
    return RpcError("invalid_params", message, fix=fix, details=details)


def not_implemented(message: str, *, details: dict[str, Any] | None = None) -> RpcError:
    return RpcError("not_implemented", message, details=details)
