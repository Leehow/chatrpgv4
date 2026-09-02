"""Optional rules: what a ruleset declares, and what confirmed patches decide.

The rulebook separates core rules from *optional* rules (CoC 7e: Spending
Luck and Luck Recovery, p.99). Before this module the ruleset flagged them
(``luck.json`` ``recovery.optional_rule: true``) but nothing read the flag: a
table could neither switch an optional rule off nor have a house rule change
what the kernel does.

Two pieces, both ruleset-agnostic:

- **Declaration.** A ruleset package lists its optional rules in
  ``manifest.json`` ``optional_rules`` (``docs/ruleset-contract.md`` §2.3).
  Each row names the graph rule and decision nodes it covers, the operations
  and settlements it gates, and the package default.
- **Effective set.** A house rule is recorded once, by ``coc_house_rules``
  (spec ``pi-coc-rule-override-and-session-rulings`` §5): prose compiled
  through a semantic step into a case-backed ``RulePatch`` the user confirms.
  This module reads the *confirmed* patches back. A confirmed ``disables`` or
  ``enables`` patch whose target is one of a declared option's nodes decides
  that option; the RuleGraph runtime, the Luck spend operation and the
  development settlement consult the result.

Laws carried over from that spec:

- one store (``save/house-rules.json``), one grammar, one confirmation path;
  nothing here writes a patch;
- layer precedence orders *declared* toggles; two confirmed toggles at the
  same layer that disagree are a ``rule_conflict`` and every gate they touch
  fails closed, never a quiet guess;
- a session ruling is precedent, never an authority over results, so the
  ``session_ruling`` layer cannot switch an option (``coc_house_rules`` refuses
  to author it, and this module ignores it if one ever appears);
- ``overrides`` / ``augments`` need a replacement rule body with its own
  evidence and are the compiler's (slice R2), so they are reported as
  present-but-not-enforced rather than silently applied.
"""
from __future__ import annotations

from copy import deepcopy
from pathlib import Path
from typing import Any, Mapping

SCRIPT_DIR = Path(__file__).resolve().parent


def _load_sibling(name: str, filename: str):
    import importlib.util

    spec = importlib.util.spec_from_file_location(name, SCRIPT_DIR / filename)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


coc_rulesets = _load_sibling("coc_rulesets_rule_options", "coc_rulesets.py")
coc_house_rules = _load_sibling("coc_house_rules_rule_options", "coc_house_rules.py")

#: Most specific first; the one ladder, owned by coc_house_rules.
LAYERS: tuple[str, ...] = tuple(coc_house_rules.LAYERS)
DEFAULT_LAYER = "ruleset_default"
#: Relations this module can enforce, and what they set ``enabled`` to.
TOGGLE_RELATIONS: dict[str, bool] = {"disables": False, "enables": True}
#: The only scope with a definite extent today. ``session`` and ``scene``
#: patches carry no session or scene id, so they cannot be bound to a moment
#: and are reported instead of enforced.
ENFORCED_SCOPE = "campaign"
#: Layers a table may not use to switch an option: not negotiable from the
#: table (system_safety, core) or precedent-only (session_ruling).
NON_TOGGLE_LAYERS: frozenset[str] = frozenset({"system_safety", "core", "session_ruling"})


class OptionalRuleError(ValueError):
    """A gate that cannot be evaluated; ``code`` is the operation error code."""

    def __init__(self, code: str, message: str, *, details: dict[str, Any] | None = None):
        super().__init__(message)
        self.code = code
        self.details = details or {}


# -- declarations ---------------------------------------------------------- #

def declared_optional_rules(ruleset_id: str) -> list[dict[str, Any]]:
    """The package's ``optional_rules`` rows, normalized, in manifest order.

    Shape validation is the conformance suite's job; this accessor tolerates a
    missing key (no optional rules) and coerces list fields to tuples of str.
    """
    manifest = coc_rulesets.load_manifest(ruleset_id)
    rows = manifest.get("optional_rules")
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


def declared_option(ruleset_id: str, option_id: str) -> dict[str, Any] | None:
    for row in declared_optional_rules(ruleset_id):
        if row["option_id"] == option_id:
            return row
    return None


def option_for_target(ruleset_id: str, target: str) -> dict[str, Any] | None:
    """The declared option a patch target (rule or decision node id) belongs to."""
    for row in declared_optional_rules(ruleset_id):
        if target in row["rule_refs"] or target in row["decision_refs"]:
            return row
    return None


# -- toggles from confirmed patches ---------------------------------------- #

def _patch_body(row: Mapping[str, Any]) -> Mapping[str, Any]:
    """Accept either a house-rules record (``{"patch": ...}``) or a bare patch."""
    inner = row.get("patch")
    return inner if isinstance(inner, Mapping) else row


def toggles_from_patches(
    ruleset_id: str, patches: list[Mapping[str, Any]] | None,
) -> list[dict[str, Any]]:
    """One row per confirmed patch, saying whether and how it toggles an option.

    Nothing is dropped silently: a patch this module cannot enforce is returned
    with ``applicable: False`` and a reason, so a reader can see that the table
    confirmed something the kernel does not act on yet.
    """
    rows: list[dict[str, Any]] = []
    for raw in patches or []:
        if not isinstance(raw, Mapping):
            continue
        patch = _patch_body(raw)
        target = str(patch.get("target") or "")
        relation = str(patch.get("relation") or "")
        layer = str(patch.get("layer") or "")
        scope = str(patch.get("scope") or "")
        option = option_for_target(ruleset_id, target)
        row: dict[str, Any] = {
            "patch_id": str(patch.get("patch_id") or ""),
            "version": patch.get("version"),
            "layer": layer,
            "scope": scope,
            "relation": relation,
            "target": target,
            "option_id": option["option_id"] if option else None,
            "reason": str(patch.get("reason") or ""),
            "statement": str(patch.get("statement") or ""),
            "applicable": False,
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


def effective_optional_rules(
    ruleset_id: str, patches: list[Mapping[str, Any]] | None,
) -> dict[str, dict[str, Any]]:
    """Resolve every declared option to its status.

    ``{option_id, display, enabled, decided_by, layer, ...}``; ``enabled`` is
    ``None`` and ``conflict`` is ``True`` when two applicable toggles at the
    winning layer disagree. Precedence is the ``coc_house_rules.LAYERS``
    ladder; inside one layer the toggles must agree (a newer *version* of the
    same patch supersedes the older one at confirmation time, so agreement
    here is between different patch ids).
    """
    toggles = toggles_from_patches(ruleset_id, patches)
    out: dict[str, dict[str, Any]] = {}
    for declared in declared_optional_rules(ruleset_id):
        option_id = declared["option_id"]
        mine = [row for row in toggles if row["applicable"] and row["option_id"] == option_id]
        if not mine:
            out[option_id] = {
                "option_id": option_id,
                "display": declared["display"],
                "enabled": declared["enabled_by_default"],
                "decided_by": DEFAULT_LAYER,
                "layer": DEFAULT_LAYER,
                "scope": ENFORCED_SCOPE,
            }
            continue
        best = min(LAYERS.index(row["layer"]) for row in mine)
        winners = sorted(
            (row for row in mine if LAYERS.index(row["layer"]) == best),
            key=lambda row: row["patch_id"],
        )
        verdicts = {row["enabled"] for row in winners}
        if len(verdicts) > 1:
            out[option_id] = {
                "option_id": option_id,
                "display": declared["display"],
                "enabled": None,
                "conflict": True,
                "decided_by": None,
                "layer": winners[0]["layer"],
                "scope": ENFORCED_SCOPE,
                "conflicting": [
                    {"patch_id": row["patch_id"], "relation": row["relation"]}
                    for row in winners
                ],
            }
            continue
        winner = winners[0]
        out[option_id] = {
            "option_id": option_id,
            "display": declared["display"],
            "enabled": winner["enabled"],
            "decided_by": winner["patch_id"],
            "layer": winner["layer"],
            "scope": winner["scope"],
            "reason": winner["reason"],
            "statement": winner["statement"],
        }
    return out


def confirmed_patches(campaign_dir: Path) -> list[dict[str, Any]]:
    """Confirmed house-rule patch bodies, read through the one store."""
    try:
        records = coc_house_rules.confirmed_patches(campaign_dir)
    except coc_house_rules.HouseRuleError as exc:
        raise OptionalRuleError("house_rules_corrupt", str(exc)) from exc
    return [deepcopy(dict(_patch_body(record))) for record in records]


def campaign_effective_optional_rules(
    campaign_dir: Path, ruleset_id: str,
) -> dict[str, dict[str, Any]]:
    return effective_optional_rules(ruleset_id, confirmed_patches(campaign_dir))


# -- gates ----------------------------------------------------------------- #

def _gating(status: Mapping[str, Any] | None) -> bool:
    return status is not None and (status.get("conflict") is True or status.get("enabled") is False)


def disabled_decision_gates(
    ruleset_id: str, effective: Mapping[str, Mapping[str, Any]],
) -> dict[str, dict[str, Any]]:
    """``decision_ref -> status row`` for every card a disabled or conflicted
    option covers."""
    gates: dict[str, dict[str, Any]] = {}
    for declared in declared_optional_rules(ruleset_id):
        status = effective.get(declared["option_id"])
        if not _gating(status):
            continue
        for decision_ref in declared["decision_refs"]:
            gates[decision_ref] = dict(status)
    return gates


def gate_for(
    ruleset_id: str,
    effective: Mapping[str, Mapping[str, Any]],
    *,
    operation: str | None = None,
    settlement: str | None = None,
) -> dict[str, Any] | None:
    """The gating status row for one operation / settlement gate, or None."""
    for declared in declared_optional_rules(ruleset_id):
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
        names = ", ".join(
            f"{row.get('patch_id')} ({row.get('relation')})"
            for row in status.get("conflicting") or []
        )
        return (
            f"optional rule {option!r} has conflicting confirmed patches at layer "
            f"{status.get('layer')}: {names}; supersede one before this rule can settle"
        )
    by = status.get("decided_by")
    if by == DEFAULT_LAYER:
        return (
            f"optional rule {option!r} is off by ruleset default; a confirmed "
            "house rule with relation enables switches it on for this campaign"
        )
    return (
        f"optional rule {option!r} is disabled by {status.get('layer')} "
        f"{by!r}: {status.get('reason') or 'no reason recorded'}"
    )
