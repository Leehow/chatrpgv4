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
                 details: dict[str, Any] | None = None, code_detail: str | None = None) -> None:
        if code not in ERROR_CODES:
            raise ValueError(f"unknown error code {code!r}")
        super().__init__(message)
        self.code = code
        self.message = message
        self.fix = fix
        self.details = details
        #: a closed refinement of `code` the caller can branch on (contract §16.3:
        #: `mechanics_missing`); never a free-text reason.
        self.code_detail = code_detail

    def to_json(self) -> dict[str, Any]:
        error: dict[str, Any] = {"code": self.code, "message": self.message}
        if self.code_detail:
            error["code_detail"] = self.code_detail
        if self.fix:
            error["fix"] = self.fix
        if self.details is not None:
            error["details"] = self.details
        return error


def invalid_params(message: str, *, fix: str | None = None,
                   details: dict[str, Any] | None = None, code_detail: str | None = None) -> RpcError:
    return RpcError("invalid_params", message, fix=fix, details=details, code_detail=code_detail)


def unsupported_value(field: str, value: Any, options: Any, *, code: str = "invalid_params",
                      message: str | None = None, fix: str | None = None,
                      **extra: Any) -> RpcError:
    """A closed vocabulary refused by name, with the names that would have worked
    (contract §1, §14.15).

    One constructor so that naming the bad value without naming the good ones is not a
    thing this kernel can accidentally do: the setup model tried `play_language` "zh",
    then "zh-CN", then dropped the parameter, because the options never reached it (#33).
    `details.options` is the machine-readable half; the `fix` line is the readable one."""
    allowed = [row for row in options]
    shown = ", ".join(str(row) for row in allowed)
    return RpcError(code, message or f"unsupported {field} {value!r}",
                    fix=fix or f"use one of details.options: {shown}",
                    details={"field": field, "options": allowed, **extra})


def not_implemented(message: str, *, details: dict[str, Any] | None = None) -> RpcError:
    return RpcError("not_implemented", message, details=details)
