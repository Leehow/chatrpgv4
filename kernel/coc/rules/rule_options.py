"""Optional-rule gates. Ported from coc_rule_options.py.

The ruleset manifest declares `optional_rules`; confirmed house-rule patches may
toggle them. The kernel has no house-rules store yet, so patches are read from
`<campaign>/save/house-rules.json` (`{"patches": [...]}`) when that file exists;
absent means every option keeps its ruleset default."""

from __future__ import annotations

from copy import deepcopy
from pathlib import Path
from typing import Any, Mapping

from ..fileio import read_json

# The house-rules precedence ladder (from the old coc_house_rules.LAYERS).
LAYERS: tuple[str, ...] = (
    "system_safety", "session_ruling", "house_rule", "campaign_patch", "module_supplement",
    "era_supplement", "official_optional", "core",
)
DEFAULT_LAYER = "ruleset_default"
TOGGLE_RELATIONS: dict[str, bool] = {"disables": False, "enables": True}
ENFORCED_SCOPE = "campaign"
NON_TOGGLE_LAYERS: frozenset[str] = frozenset({"system_safety", "core", "session_ruling"})


class OptionalRuleError(ValueError):
    def __init__(self, code: str, message: str, *, details: dict[str, Any] | None = None):
        super().__init__(message)
        self.code = code
        self.details = details or {}


def declared_optional_rules(manifest: Mapping[str, Any] | None) -> list[dict[str, Any]]:
    rows = (manifest or {}).get("optional_rules")
    if not isinstance(rows, list):
        return []
    out: list[dict[str, Any]] = []
    for row in rows:
        if not isinstance(row, Mapping) or not isinstance(row.get("option_id"), str):
            continue
        out.append({
            "option_id": str(row["option_id"]),
            "display": str(row.get("display") or row["option_id"]),
            "enabled_by_default": bool(row.get("enabled_by_default", False)),
            "rule_refs": tuple(str(x) for x in (row.get("rule_refs") or [])),
            "decision_refs": tuple(str(x) for x in (row.get("decision_refs") or [])),
            "operation_gates": tuple(str(x) for x in (row.get("operation_gates") or [])),
            "settlement_gates": tuple(str(x) for x in (row.get("settlement_gates") or [])),
            "source_note": str(row.get("source_note") or ""),
        })
    return out


def option_for_target(manifest: Mapping[str, Any] | None, target: str) -> dict[str, Any] | None:
    for row in declared_optional_rules(manifest):
        if target in row["rule_refs"] or target in row["decision_refs"]:
            return row
    return None


def _patch_body(row: Mapping[str, Any]) -> Mapping[str, Any]:
    inner = row.get("patch")
    return inner if isinstance(inner, Mapping) else row


def toggles_from_patches(manifest: Mapping[str, Any] | None,
                         patches: list[Mapping[str, Any]] | None) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for raw in patches or []:
        if not isinstance(raw, Mapping):
            continue
        patch = _patch_body(raw)
        target = str(patch.get("target") or "")
        relation = str(patch.get("relation") or "")
        layer = str(patch.get("layer") or "")
        scope = str(patch.get("scope") or "")
        option = option_for_target(manifest, target)
        row: dict[str, Any] = {
            "patch_id": str(patch.get("patch_id") or ""), "version": patch.get("version"), "layer": layer,
            "scope": scope, "relation": relation, "target": target,
            "option_id": option["option_id"] if option else None, "reason": str(patch.get("reason") or ""),
            "statement": str(patch.get("statement") or ""), "applicable": False,
        }
        if option is None:
            row["inapplicable_reason"] = "target_not_an_optional_rule"
        elif relation not in TOGGLE_RELATIONS:
            row["inapplicable_reason"] = "relation_not_enforced"
        elif layer not in LAYERS or layer in NON_TOGGLE_LAYERS:
            row["inapplicable_reason"] = "layer_cannot_toggle"
        elif scope != ENFORCED_SCOPE:
            row["inapplicable_reason"] = "scope_not_enforced"
        else:
            row["applicable"] = True
            row["enabled"] = TOGGLE_RELATIONS[relation]
        rows.append(row)
    return rows


def effective_optional_rules(manifest: Mapping[str, Any] | None,
                             patches: list[Mapping[str, Any]] | None) -> dict[str, dict[str, Any]]:
    toggles = toggles_from_patches(manifest, patches)
    out: dict[str, dict[str, Any]] = {}
    for declared in declared_optional_rules(manifest):
        option_id = declared["option_id"]
        mine = [row for row in toggles if row["applicable"] and row["option_id"] == option_id]
        if not mine:
            out[option_id] = {"option_id": option_id, "display": declared["display"],
                              "enabled": declared["enabled_by_default"], "decided_by": DEFAULT_LAYER,
                              "layer": DEFAULT_LAYER, "scope": ENFORCED_SCOPE}
            continue
        best = min(LAYERS.index(row["layer"]) for row in mine)
        winners = sorted((row for row in mine if LAYERS.index(row["layer"]) == best), key=lambda r: r["patch_id"])
        verdicts = {row["enabled"] for row in winners}
        if len(verdicts) > 1:
            out[option_id] = {"option_id": option_id, "display": declared["display"], "enabled": None,
                              "conflict": True, "decided_by": None, "layer": winners[0]["layer"],
                              "scope": ENFORCED_SCOPE,
                              "conflicting": [{"patch_id": r["patch_id"], "relation": r["relation"]} for r in winners]}
            continue
        winner = winners[0]
        out[option_id] = {"option_id": option_id, "display": declared["display"], "enabled": winner["enabled"],
                          "decided_by": winner["patch_id"], "layer": winner["layer"], "scope": winner["scope"],
                          "reason": winner["reason"], "statement": winner["statement"]}
    return out


def confirmed_patches(campaign_dir: Path) -> list[dict[str, Any]]:
    path = Path(campaign_dir) / "save" / "house-rules.json"
    if not path.exists():
        return []
    try:
        document = read_json(path)
    except (OSError, ValueError) as exc:
        raise OptionalRuleError("house_rules_corrupt", str(exc)) from exc
    rows = document.get("patches") if isinstance(document, dict) else None
    if not isinstance(rows, list):
        raise OptionalRuleError("house_rules_corrupt", "save/house-rules.json must carry a patches list")
    return [deepcopy(dict(_patch_body(row))) for row in rows if isinstance(row, Mapping)]


def campaign_effective_optional_rules(campaign_dir: Path,
                                      manifest: Mapping[str, Any] | None) -> dict[str, dict[str, Any]]:
    return effective_optional_rules(manifest, confirmed_patches(campaign_dir))


def _gating(status: Mapping[str, Any] | None) -> bool:
    return status is not None and (status.get("conflict") is True or status.get("enabled") is False)


def disabled_decision_gates(manifest: Mapping[str, Any] | None,
                            effective: Mapping[str, Mapping[str, Any]]) -> dict[str, dict[str, Any]]:
    gates: dict[str, dict[str, Any]] = {}
    for declared in declared_optional_rules(manifest):
        status = effective.get(declared["option_id"])
        if not _gating(status):
            continue
        for decision_ref in declared["decision_refs"]:
            gates[decision_ref] = dict(status)
    return gates


def gate_for(manifest: Mapping[str, Any] | None, effective: Mapping[str, Mapping[str, Any]], *,
             operation: str | None = None, settlement: str | None = None) -> dict[str, Any] | None:
    for declared in declared_optional_rules(manifest):
        if operation is not None and operation not in declared["operation_gates"]:
            continue
        if settlement is not None and settlement not in declared["settlement_gates"]:
            continue
        if operation is None and settlement is None:
            continue
        status = effective.get(declared["option_id"])
        if _gating(status):
            return dict(status)
    return None


def gate_code(status: Mapping[str, Any]) -> str:
    return "rule_conflict" if status.get("conflict") else "optional_rule_disabled"


def gate_message(status: Mapping[str, Any]) -> str:
    option = status.get("option_id")
    if status.get("conflict"):
        names = ", ".join(f"{row.get('patch_id')} ({row.get('relation')})" for row in status.get("conflicting") or [])
        return (f"optional rule {option!r} has conflicting confirmed patches at layer {status.get('layer')}: {names}; "
                "supersede one before this rule can settle")
    by = status.get("decided_by")
    if by == DEFAULT_LAYER:
        return (f"optional rule {option!r} is off by ruleset default; a confirmed house rule with relation enables "
                "switches it on for this campaign")
    return f"optional rule {option!r} is disabled by {status.get('layer')} {by!r}: {status.get('reason') or 'no reason recorded'}"
