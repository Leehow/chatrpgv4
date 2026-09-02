"""Optional rules and rule patches (house rules, session rulings).

The rulebook separates core rules from *optional* rules (for CoC 7e: Spending
Luck and Luck Recovery, p.99). Before this module the ruleset flagged them
(``luck.json`` ``recovery.optional_rule: true``) but nothing read the flag: a
table could neither switch an optional rule off nor record a house rule, and a
Keeper ruling lived only in chat.

Three pieces, all ruleset-agnostic:

- **Declaration.** A ruleset package lists its optional rules in
  ``manifest.json`` ``optional_rules`` (``docs/ruleset-contract.md`` §2). Each
  row names the graph rule nodes it covers, the decision cards it gates, the
  operations / settlements it gates, and its package default.
- **Patches.** A campaign records ``RulePatch`` rows in
  ``save/rule-patches.json``. A patch ``ENABLES`` or ``DISABLES`` one declared
  option at one layer (``campaign_patch`` < ``house_rule`` < ``session_ruling``)
  and one scope (the campaign, or one scene). Only declared targets are
  accepted, so a patch can never invent a rule.
- **Effective set.** ``effective_optional_rules`` resolves the declared
  defaults plus the applicable patches by layer precedence; ties inside one
  layer go to the latest recorded patch. The RuleGraph runtime, the Luck
  spend operation and the development settlement consult that set.

``AUGMENTS`` / ``OVERRIDES`` (replacing a rule body) are deliberately absent:
they need a replacement rule node with its own evidence, which is compiler
work, not a campaign-state toggle.
"""
from __future__ import annotations

import re
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
coc_fileio = _load_sibling("coc_fileio_rule_options", "coc_fileio.py")

RULE_PATCHES_SCHEMA_VERSION = 1
RULE_PATCHES_RELATIVE = Path("save") / "rule-patches.json"

#: Highest precedence first. A session ruling is the table's most specific
#: decision; a house rule is a standing table agreement; a campaign patch is
#: the imported campaign's own adjustment. The package default sits below all.
LAYER_PRECEDENCE: tuple[str, ...] = ("session_ruling", "house_rule", "campaign_patch")
DEFAULT_LAYER = "ruleset_default"
OPERATIONS: frozenset[str] = frozenset({"ENABLES", "DISABLES"})
SCOPE_CAMPAIGN = "campaign"
SCENE_SCOPE_PREFIX = "scene:"

_PATCH_ID_RE = re.compile(r"^[a-z][a-z0-9-]*(?::[a-z0-9][a-z0-9-]*)*$")
_OPTION_ID_RE = re.compile(r"^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$")
_SCENE_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:-]*$")
_PATCH_FIELDS = ("patch_id", "layer", "scope", "operation", "target", "reason")


class RulePatchError(ValueError):
    """A patch that cannot be recorded; ``code`` is the operation error code."""

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


# -- patches --------------------------------------------------------------- #

def rule_patches_path(campaign_dir: Path) -> Path:
    return Path(campaign_dir) / RULE_PATCHES_RELATIVE


def _empty_document(campaign_id: str) -> dict[str, Any]:
    return {
        "schema_version": RULE_PATCHES_SCHEMA_VERSION,
        "campaign_id": campaign_id,
        "patches": [],
    }


def load_rule_patches(campaign_dir: Path) -> dict[str, Any]:
    """Exact-current ``save/rule-patches.json``; absent file = no patches.

    The file is created lazily by the first recorded patch, like a package
    state directory with ``create_on_init: false``. A present file must match
    the current schema and the campaign identity; anything else fails closed.
    """
    campaign_dir = Path(campaign_dir)
    path = rule_patches_path(campaign_dir)
    if path.is_symlink():
        raise RulePatchError("rule_patches_corrupt", f"unsafe symlink at {path}")
    if not path.exists():
        return _empty_document(campaign_dir.name)
    try:
        import json

        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, ValueError) as exc:
        raise RulePatchError("rule_patches_corrupt", f"unreadable {path}: {exc}") from exc
    if (
        not isinstance(payload, dict)
        or payload.get("schema_version") != RULE_PATCHES_SCHEMA_VERSION
        or payload.get("campaign_id") != campaign_dir.name
        or not isinstance(payload.get("patches"), list)
        or not all(isinstance(row, dict) for row in payload["patches"])
    ):
        raise RulePatchError(
            "rule_patches_corrupt",
            f"{path} is not a schema-{RULE_PATCHES_SCHEMA_VERSION} rule patch "
            f"document for campaign {campaign_dir.name!r}",
        )
    return payload


def normalize_patch(patch: Mapping[str, Any], ruleset_id: str) -> dict[str, Any]:
    """Validate one caller-authored patch against the ruleset's declarations."""
    if not isinstance(patch, Mapping):
        raise RulePatchError("invalid_param", "rule patch must be an object")
    unknown = sorted(set(patch) - set(_PATCH_FIELDS))
    if unknown:
        raise RulePatchError(
            "invalid_param", f"rule patch has unknown fields: {', '.join(unknown)}",
        )
    missing = [field for field in _PATCH_FIELDS if field not in patch]
    if missing:
        raise RulePatchError(
            "missing_param", f"rule patch requires {', '.join(missing)}",
        )
    patch_id = patch["patch_id"]
    if not isinstance(patch_id, str) or _PATCH_ID_RE.fullmatch(patch_id) is None:
        raise RulePatchError(
            "invalid_param",
            "patch_id must be a lowercase kebab-case id, optionally namespaced "
            "with colons (for example house:no-luck-spend)",
        )
    layer = patch["layer"]
    if layer not in LAYER_PRECEDENCE:
        raise RulePatchError(
            "invalid_param",
            f"layer must be one of {', '.join(LAYER_PRECEDENCE)}",
        )
    scope = patch["scope"]
    if not isinstance(scope, str) or not (
        scope == SCOPE_CAMPAIGN
        or (
            scope.startswith(SCENE_SCOPE_PREFIX)
            and _SCENE_ID_RE.fullmatch(scope[len(SCENE_SCOPE_PREFIX):]) is not None
        )
    ):
        raise RulePatchError(
            "invalid_param", "scope must be 'campaign' or 'scene:<scene_id>'",
        )
    operation = patch["operation"]
    if operation not in OPERATIONS:
        raise RulePatchError(
            "invalid_param", f"operation must be one of {', '.join(sorted(OPERATIONS))}",
        )
    target = patch["target"]
    declared = declared_option(ruleset_id, target) if isinstance(target, str) else None
    if declared is None:
        raise RulePatchError(
            "unknown_optional_rule",
            f"{target!r} is not an optional rule declared by ruleset {ruleset_id!r}",
            details={
                "declared": [row["option_id"] for row in declared_optional_rules(ruleset_id)],
            },
        )
    reason = patch["reason"]
    if not isinstance(reason, str) or not reason.strip():
        raise RulePatchError("missing_param", "reason must be a non-empty string")
    return {
        "patch_id": patch_id,
        "layer": layer,
        "scope": scope,
        "operation": operation,
        "target": target,
        "reason": reason.strip(),
    }


def record_rule_patch(
    campaign_dir: Path,
    ruleset_id: str,
    patch: Mapping[str, Any],
    *,
    recorded_at: str,
) -> tuple[dict[str, Any], str]:
    """Append one patch; returns ``(document, "recorded" | "duplicate")``.

    Idempotent by ``patch_id``: an identical patch is a no-op, a different
    patch under the same id is a ``rule_patch_conflict`` (the id is the
    ruling's identity, so silently replacing it would rewrite history).
    """
    normalized = normalize_patch(patch, ruleset_id)
    document = load_rule_patches(campaign_dir)
    for existing in document["patches"]:
        if existing.get("patch_id") != normalized["patch_id"]:
            continue
        comparable = {key: existing.get(key) for key in _PATCH_FIELDS}
        if comparable == normalized:
            return document, "duplicate"
        raise RulePatchError(
            "rule_patch_conflict",
            f"patch_id {normalized['patch_id']!r} already records a different ruling",
            details={"existing": deepcopy(existing)},
        )
    row = {**normalized, "recorded_at": str(recorded_at), "ruleset_id": ruleset_id}
    document["patches"].append(row)
    path = rule_patches_path(campaign_dir)
    path.parent.mkdir(parents=True, exist_ok=True)
    coc_fileio.write_json_atomic(
        path, document, indent=2, ensure_ascii=True, trailing_newline=True,
    )
    return document, "recorded"


# -- effective set --------------------------------------------------------- #

def _scope_applies(scope: str, scene_id: str | None) -> bool:
    if scope == SCOPE_CAMPAIGN:
        return True
    return scene_id is not None and scope == f"{SCENE_SCOPE_PREFIX}{scene_id}"


def effective_optional_rules(
    ruleset_id: str,
    patches: list[Mapping[str, Any]] | None,
    *,
    scene_id: str | None = None,
) -> dict[str, dict[str, Any]]:
    """Resolve every declared option to ``{enabled, decided_by, layer, scope}``.

    Precedence: ``session_ruling`` > ``house_rule`` > ``campaign_patch`` >
    package default. Inside one layer the latest recorded patch wins, so a
    table can revise its own ruling without editing history. Patches whose
    scope is another scene, or whose target the package no longer declares,
    are ignored (they are reported by ``inapplicable_patches``).
    """
    out: dict[str, dict[str, Any]] = {}
    for declared in declared_optional_rules(ruleset_id):
        option_id = declared["option_id"]
        winner: dict[str, Any] | None = None
        winner_rank = len(LAYER_PRECEDENCE)
        for patch in patches or []:
            if not isinstance(patch, Mapping) or patch.get("target") != option_id:
                continue
            layer = patch.get("layer")
            if layer not in LAYER_PRECEDENCE:
                continue
            if not _scope_applies(str(patch.get("scope") or ""), scene_id):
                continue
            rank = LAYER_PRECEDENCE.index(layer)
            if rank <= winner_rank:
                winner, winner_rank = dict(patch), rank
        if winner is None:
            out[option_id] = {
                "option_id": option_id,
                "display": declared["display"],
                "enabled": declared["enabled_by_default"],
                "decided_by": DEFAULT_LAYER,
                "layer": DEFAULT_LAYER,
                "scope": SCOPE_CAMPAIGN,
            }
        else:
            out[option_id] = {
                "option_id": option_id,
                "display": declared["display"],
                "enabled": winner.get("operation") == "ENABLES",
                "decided_by": str(winner.get("patch_id")),
                "layer": str(winner.get("layer")),
                "scope": str(winner.get("scope")),
                "reason": str(winner.get("reason") or ""),
            }
    return out


def inapplicable_patches(
    ruleset_id: str, patches: list[Mapping[str, Any]] | None,
) -> list[dict[str, Any]]:
    declared = {row["option_id"] for row in declared_optional_rules(ruleset_id)}
    return [
        {"patch_id": patch.get("patch_id"), "target": patch.get("target"),
         "reason": "target_not_declared"}
        for patch in patches or []
        if isinstance(patch, Mapping) and patch.get("target") not in declared
    ]


def campaign_effective_optional_rules(
    campaign_dir: Path,
    ruleset_id: str,
    *,
    scene_id: str | None = None,
) -> dict[str, dict[str, Any]]:
    document = load_rule_patches(campaign_dir)
    return effective_optional_rules(
        ruleset_id, document["patches"], scene_id=scene_id,
    )


def disabled_decision_gates(
    ruleset_id: str, effective: Mapping[str, Mapping[str, Any]],
) -> dict[str, dict[str, Any]]:
    """``decision_ref -> status row`` for every card a disabled option gates."""
    gates: dict[str, dict[str, Any]] = {}
    for declared in declared_optional_rules(ruleset_id):
        status = effective.get(declared["option_id"])
        if status is None or status.get("enabled"):
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
    """The disabling status row for one operation / settlement gate, or None."""
    for declared in declared_optional_rules(ruleset_id):
        if operation is not None and operation not in declared["operation_gates"]:
            continue
        if settlement is not None and settlement not in declared["settlement_gates"]:
            continue
        if operation is None and settlement is None:
            continue
        status = effective.get(declared["option_id"])
        if status is not None and not status.get("enabled"):
            return dict(status)
    return None


def disabled_message(status: Mapping[str, Any]) -> str:
    by = status.get("decided_by")
    if by == DEFAULT_LAYER:
        return (
            f"optional rule {status.get('option_id')!r} is off by ruleset default; "
            "record rules.patch ENABLES to switch it on for this campaign"
        )
    return (
        f"optional rule {status.get('option_id')!r} is disabled by "
        f"{status.get('layer')} {by!r} ({status.get('scope')}): "
        f"{status.get('reason') or 'no reason recorded'}"
    )
