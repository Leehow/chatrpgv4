#!/usr/bin/env python3
"""RulesRuntime — deep in-process rule runtime plus shadow comparator (R3).

This module is the host-internal implementation of the RuleGraph runtime seam
(spec §8).  It exposes exactly one interface class with two methods:

    runtime.context(RuleQuestion?) -> RuleContextResult
    runtime.settle(SelectedRuleDecision, decision_id, executor=...) -> SettlementResult

It loads a ruleset package's compiled RuleGraph through the R1 artifact
contract (``entry_points.rule_graph`` / ``entry_points.rule_graph_manifest``),
overlays live state facts for condition evaluation, separates Keeper-semantic
inputs from host-locked inputs, compiles one selected decision into ONE
immutable ``RuleDecisionPlan`` targeting the existing resolver capability or
subsystem command shape, and projects bounded next-decision cards.

The runtime NEVER itself:
  - rolls dice, consumes RNG, writes campaign state, or creates receipts;
  - reimplements a resolver capability or subsystem command;
  - renders narration.

For a **graph-owned** family, ``settle()`` invokes the SAME existing resolver /
subsystem adapter the legacy handlers use (injected ``executor``).  Grant gate,
decision_id idempotency, and canonical state/receipt machinery stay with those
adapters.  Shadow-owned and legacy-owned families still compile only
(``execution: deferred-to-legacy``).  Shadow comparison may keep recording
host-internally; it never executes a graph-owned family (spec §14.3).

Shadow comparator (spec §14.1): when a legacy healing operation runs
(``rules.first_aid`` / ``rules.dying_check`` / ``rules.medicine`` /
``rules.weekly_recovery``), the kernel calls
``maybe_shadow_compare_healing(...)`` AFTER the legacy request/command is
normalized and STRICTLY BEFORE RNG/mutation.  The comparator compiles the
graph's candidate plan for the same decision and records exact semantic
differences (capability, phase, semantic inputs, locked inputs, payload
constants) plus every mandatory §14.1 axis (rule refs, resource effects,
visibility, pending-choice semantics) to a HOST-INTERNAL shadow log.  Where
the legacy normalized request genuinely cannot express an axis, the
comparator records an explicit ``unresolved_legacy`` difference finding —
it never grants a silent match (spec §14.1).  The legacy request always
executes exactly once; shadow machinery NEVER blocks, alters, or fails the
legacy path.  Runtime-owned identities (``command_id``, ``roll_id``,
``request_index``, ``decision_id``) are ignored because the host
deterministically reattaches them.

Card grants (spec §8.5/§8.6): ``context()`` issues a machine-attached card
grant — the projected card set bound to campaign + ruleset version + graph
generation + canonical state revision — and ``settle()`` rejects any
decision_ref not covered by a live grant, plus any grant whose binding no
longer matches current state (``rule_decision_stale``).  The model never
authors or echoes a grant: the host re-attaches the exact object its runtime
issued (``settle(..., card_grant=...)``), and the runtime validates against
its own issuance registry, so a fabricated or tampered grant fails closed.

Shadow machinery engages only when the family's runtime owner is ``shadow``
(default every family is ``legacy``/``visible``, in which case this module is
a strict no-op with no file I/O).  Graph absent/invalid/unloadable for a
shadow-owned family -> one host-internal ``skipped`` log row and the legacy
path continues.

The module is standalone (stdlib only) so it loads identically inside the
toolbox kernel and under pytest; the R1 compiler is only used by tests to
build fixture graphs.
"""
from __future__ import annotations

import hashlib
import json
import os
from copy import deepcopy
from pathlib import Path
from types import MappingProxyType
from typing import Any, Callable, Iterable, Mapping

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parents[2]
RULESETS_ROOT = SCRIPT_DIR.parent / "rulesets"
CONTRACT_PATH = SCRIPT_DIR.parent / "references" / "rule-graph-contract-v1.json"

SHADOW_LOG_CONTRACT_ID = "coc.rule-graph-shadow-log.v1"
SHADOW_LOG_SCHEMA_VERSION = 1
CARD_GRANT_CONTRACT_ID = "coc.rule-graph-card-grant.v1"
CARD_GRANT_SCHEMA_VERSION = 1
DEFAULT_SHADOW_LOG_PATH = REPO_ROOT / "artifacts" / "rule-graph-shadow-log.jsonl"
SHADOW_LOG_ENV = "COC_RULE_GRAPH_SHADOW_LOG"

# Runtime-owned identities the host reattaches deterministically per command.
_RUNTIME_OWNED_PAYLOAD_KEYS = frozenset({
    "command_id", "roll_id", "request_index", "decision_id",
})
_HARD_GATE_SLOT_OWNERSHIPS = frozenset({"keeper-semantic", "optional-semantic", "player-source"})
_SEMANTIC_SLOT_OWNERSHIPS = frozenset({"keeper-semantic", "optional-semantic", "player-source"})
_REQUIRED_SEMANTIC_OWNERSHIPS = frozenset({"keeper-semantic", "player-source"})
_LOCKED_SLOT_OWNERSHIPS = frozenset({"host-locked", "resolver-owned"})

_HEALING_TOOLS = frozenset({
    "rules.first_aid", "rules.dying_check", "rules.medicine",
    "rules.weekly_recovery",
})

_GRAPH_CONTRACT_CACHE: dict[str, Any] | None = None
_GRAPH_CACHE: dict[str, dict[str, Any]] = {}
_MANIFEST_CACHE: dict[str, dict[str, Any] | None] = {}
_SHADOW_CONFIG: dict[str, Any] | None = None
# Campaign + semantic-subject scoped runtime instances so one investigator's
# facts/grants can never be reused for another investigator in the same party.
_CAMPAIGN_RUNTIMES: dict[tuple[str, str], "RulesRuntime"] = {}

_GRANT_CONTEXT_KEYS = frozenset({
    "role", "phase", "stage", "player_turn_epoch", "progress_revision",
})

#: Facts that describe the CALL rather than the campaign. A card grant binds
#: "canonical state has not moved since these cards were issued", and with no
#: separate state-revision provider that binding degrades to a digest of the
#: whole fact set — so any fact carried only by the asking call invalidates
#: every grant issued under it.
#:
#: `intent.action_kind` is exactly that: rules.context publishes the Keeper's
#: declared player intent, rules.settle does not, so the digest differed
#: between issuing a grant and using it and `latest_grant_covering` matched
#: nothing. Measured 2026-09-02: eight of fifteen failed settlements across
#: three lanes were this, and the chase that had settled once stopped settling
#: at all.
_CALL_SCOPED_FACT_KEYS = frozenset({"intent.action_kind"})

# Closed v1 settle enum: compiled healing decision refs only. Exclusion
# exception nodes are intentionally absent (spec §15 no_candidate).
HEALING_SETTLE_DECISION_REFS = (
    "decision:coc7:healing:dying-hour-clock",
    "decision:coc7:healing:dying-round-clock",
    "decision:coc7:healing:first-aid-ordinary",
    "decision:coc7:healing:first-aid-stabilization",
    "decision:coc7:healing:medicine-ordinary",
    "decision:coc7:healing:medicine-stabilization",
    "decision:coc7:healing:weekly-major-wound-recovery",
)

# Social/psychology settle decision refs (spec §11.2/§11.3).  The R1
# three-family graph is loaded by tests through an explicit fixture path;
# the packaged coc7 graph stays healing-only until integration re-accepts
# the three-family build.
SOCIAL_SETTLE_DECISION_REFS = (
    "decision:coc7:social:adjudicate-difficulty",
)
PSYCHOLOGY_SETTLE_DECISION_REFS = (
    "decision:coc7:psychology:observe-concealed",
    "decision:coc7:psychology:realize-player-safe",
)

_SOCIAL_ADJUDICATE_REF = SOCIAL_SETTLE_DECISION_REFS[0]
_PSYCHOLOGY_OBSERVE_REF = PSYCHOLOGY_SETTLE_DECISION_REFS[0]
_PSYCHOLOGY_REALIZE_REF = PSYCHOLOGY_SETTLE_DECISION_REFS[1]

# R5 ordinary-check / Push / Luck / generic resource (spec §R5 / §11.1).
# Packaged coc7 graph stays healing-only; tests load the check-luck fixture.
CORE_CHECK_SETTLE_DECISION_REFS = (
    "decision:coc7:core-check:ordinary-check",
    "decision:coc7:core-check:resource-delta",
)
PUSH_LUCK_SETTLE_DECISION_REFS = (
    "decision:coc7:push-luck:pushed-roll",
    "decision:coc7:push-luck:luck-spend",
    "decision:coc7:push-luck:luck-roll",
)
_ORDINARY_CHECK_REF = CORE_CHECK_SETTLE_DECISION_REFS[0]
_RESOURCE_DELTA_REF = CORE_CHECK_SETTLE_DECISION_REFS[1]
_PUSHED_ROLL_REF = PUSH_LUCK_SETTLE_DECISION_REFS[0]
_LUCK_SPEND_REF = PUSH_LUCK_SETTLE_DECISION_REFS[1]
_LUCK_ROLL_REF = PUSH_LUCK_SETTLE_DECISION_REFS[2]



# R6 lookup/read families (spec §R6 / §11): context-only, never settle.
# Packaged coc7 graph stays healing-only; tests load the lookups fixture.
LOOKUP_CONTEXT_DECISION_REFS = (
    "decision:coc7:development:skill-describe",
    "decision:coc7:development:catalog-search",
    "decision:coc7:development:build-scale",
    "decision:coc7:development:cash-assets",
)
COMBAT_SETTLE_DECISION_REFS = (
    "decision:coc7:combat:apply-damage",
)
SANITY_SETTLE_DECISION_REFS = (
    "decision:coc7:sanity:non-session-loss",
)
_SKILL_DESCRIBE_REF = LOOKUP_CONTEXT_DECISION_REFS[0]
_CATALOG_SEARCH_REF = LOOKUP_CONTEXT_DECISION_REFS[1]
_BUILD_SCALE_REF = LOOKUP_CONTEXT_DECISION_REFS[2]
_CASH_ASSETS_REF = LOOKUP_CONTEXT_DECISION_REFS[3]
_DAMAGE_REF = COMBAT_SETTLE_DECISION_REFS[0]
_SANITY_LOSS_REF = SANITY_SETTLE_DECISION_REFS[0]


# --------------------------------------------------------------------------- #
# Freeze helpers (immutable plans/cards; mirror of the kernel's pattern)
# --------------------------------------------------------------------------- #
def _freeze(value: Any) -> Any:
    if isinstance(value, Mapping):
        return MappingProxyType({str(key): _freeze(item) for key, item in value.items()})
    if isinstance(value, (list, tuple)):
        return tuple(_freeze(item) for item in value)
    if isinstance(value, set):
        return frozenset(_freeze(item) for item in value)
    return deepcopy(value)


def _thaw(value: Any) -> Any:
    """Return a plain-JSON copy of a frozen value (for host log rows)."""
    if isinstance(value, Mapping):
        return {str(key): _thaw(item) for key, item in value.items()}
    if isinstance(value, (tuple, frozenset)):
        return [_thaw(item) for item in value]
    return deepcopy(value)


def _canonical(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _json_digest(value: Any) -> str:
    return hashlib.sha256(_canonical(value).encode("utf-8")).hexdigest()


# --------------------------------------------------------------------------- #
# Contract access (closed enum surface, never a second enum list)
# --------------------------------------------------------------------------- #
def _load_contract() -> dict[str, Any] | None:
    global _GRAPH_CONTRACT_CACHE
    if _GRAPH_CONTRACT_CACHE is not None:
        return _GRAPH_CONTRACT_CACHE
    try:
        _GRAPH_CONTRACT_CACHE = json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        _GRAPH_CONTRACT_CACHE = None
    return _GRAPH_CONTRACT_CACHE


def registered_condition_paths() -> frozenset[str]:
    contract = _load_contract() or {}
    return frozenset(contract.get("registered_condition_paths") or [])


# --------------------------------------------------------------------------- #
# Package manifest / graph loading (R1 artifact contract)
# --------------------------------------------------------------------------- #
def rulesets_root() -> Path:
    return RULESETS_ROOT


def clear_runtime_cache() -> None:
    """Drop in-process graph/manifest/runtime caches.  Tests isolate via this."""
    global _GRAPH_CONTRACT_CACHE, _GRAPH_CACHE, _MANIFEST_CACHE
    _GRAPH_CONTRACT_CACHE = None
    _GRAPH_CACHE.clear()
    _MANIFEST_CACHE.clear()
    _CAMPAIGN_RUNTIMES.clear()
    _PUBLIC_EFFECT_RUNTIME_CACHE.clear()


def _campaign_runtime_key(
    campaign_id: str, subject_ref: str | None,
) -> tuple[str, str]:
    return (str(campaign_id), str(subject_ref or ""))


def bind_campaign_runtime(
    campaign_id: str,
    runtime: "RulesRuntime",
    *,
    subject_ref: str | None = None,
) -> None:
    if not campaign_id:
        return
    key = _campaign_runtime_key(campaign_id, subject_ref)
    # Card grants live on the instance, so a rebuild used to destroy every
    # grant the Keeper was holding. `scene.context` rebuilds the runtime to
    # project healing cards (`refresh=True`), and the Keeper reads the scene
    # constantly, so the ordinary sequence `rules.context` -> `scene.context`
    # -> `rules.settle` lost the grant and the settlement was refused as
    # `no_grant_for_decision` — true of the new instance, meaningless to the
    # Keeper, who had just been handed the card. Measured 2026-09-02: eight
    # such interleavings across seven diagnostic lanes.
    #
    # Carrying them over does not weaken the check. A grant states its own
    # binding (ruleset, graph generation, state revision, turn context) and
    # `_check_card_grant` still validates it on use; instance identity was
    # never part of that contract. Grants the new runtime issued itself win a
    # key collision.
    previous = _CAMPAIGN_RUNTIMES.get(key)
    if previous is not None and previous is not runtime:
        carried = {
            grant_id: grant
            for grant_id, grant in previous._grants.items()
            if grant_id not in runtime._grants
        }
        if carried:
            runtime._grants = {**carried, **runtime._grants}
    _CAMPAIGN_RUNTIMES[key] = runtime


def campaign_runtime(
    campaign_id: str | None,
    *,
    subject_ref: str | None = None,
) -> "RulesRuntime" | None:
    if not campaign_id:
        return None
    return _CAMPAIGN_RUNTIMES.get(_campaign_runtime_key(campaign_id, subject_ref))


def _load_manifest_cached(ruleset_id: str, rulesets_root_path: Path | None = None) -> dict[str, Any] | None:
    if ruleset_id in _MANIFEST_CACHE:
        return _MANIFEST_CACHE[ruleset_id]
    root = Path(rulesets_root_path) if rulesets_root_path is not None else RULESETS_ROOT
    path = root / ruleset_id / "manifest.json"
    try:
        manifest = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        manifest = None
    _MANIFEST_CACHE[ruleset_id] = manifest
    return manifest


def load_ruleset_graph(
    ruleset_id: str,
    *,
    rulesets_root_path: Path | str | None = None,
) -> dict[str, Any]:
    """Load and validate one package's compiled RuleGraph (R1 contract).

    Returns one of:

    - ``{"ok": True, "graph": {...}, "graph_manifest": {...},
      "content_digest": "<sha256>", "source": "package"|"config"}``
    - ``{"ok": False, "reason": "graph_absent"|"graph_invalid"|"graph_unloadable",
      "findings": [...], "source": ...}``

    Validation is host-internal: contract id, schema version, ruleset
    identity, key surface, and the machine-owned content digest vs the graph
    manifest.  No model relay of any digest happens here.
    """
    root = Path(rulesets_root_path) if rulesets_root_path is not None else RULESETS_ROOT
    manifest = _load_manifest_cached(ruleset_id, root)
    entry_points = (manifest or {}).get("entry_points") or {}
    graph_ref = entry_points.get("rule_graph")
    manifest_ref = entry_points.get("rule_graph_manifest")
    if not isinstance(graph_ref, str) or not isinstance(manifest_ref, str):
        return {"ok": False, "reason": "graph_absent",
                "findings": ["no paired rule_graph entry points in package manifest"]}

    try:
        graph_bytes = (root / ruleset_id / graph_ref).read_bytes()
        manifest_bytes = (root / ruleset_id / manifest_ref).read_bytes()
    except OSError as exc:
        return {"ok": False, "reason": "graph_unloadable",
                "findings": [f"artifact read failed: {exc}"]}
    try:
        graph = json.loads(graph_bytes.decode("utf-8"))
        graph_manifest = json.loads(manifest_bytes.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        return {"ok": False, "reason": "graph_invalid",
                "findings": [f"artifact is not valid JSON: {exc}"]}

    contract = _load_contract()
    if not isinstance(graph, dict) or not isinstance(graph_manifest, dict):
        return {"ok": False, "reason": "graph_invalid",
                "findings": ["graph artifacts must be JSON objects"]}
    problems: list[str] = []
    if contract is not None:
        want_graph_contract = contract.get("graph_contract_id")
        want_manifest_contract = contract.get("build_manifest_contract_id")
        want_schema = contract.get("schema_version")
        want_keys = set(contract.get("graph_keys") or [])
        if want_graph_contract and graph.get("contract_id") != want_graph_contract:
            problems.append("graph.contract_id does not match the v1 contract")
        if want_manifest_contract and graph_manifest.get("contract_id") != want_manifest_contract:
            problems.append("graph manifest contract_id does not match the v1 contract")
        if want_schema is not None and (
            graph.get("schema_version") != want_schema
            or graph_manifest.get("schema_version") != want_schema
        ):
            problems.append("graph schema_version does not match the v1 contract")
        if not want_keys.issubset(set(graph)):
            problems.append("graph is missing contract key fields")
    if graph.get("ruleset_id") != ruleset_id or graph_manifest.get("ruleset_id") != ruleset_id:
        problems.append("graph ruleset_id does not match the requested ruleset")
    declared_digest = graph_manifest.get("graph_content_digest")
    if not isinstance(declared_digest, str) or len(declared_digest) != 64:
        problems.append("graph manifest is missing a declared content digest")
    elif _json_digest(graph) != declared_digest:
        problems.append("graph content digest does not match the graph manifest")
    if problems:
        return {"ok": False, "reason": "graph_invalid",
                "findings": problems, "graph": graph, "graph_manifest": graph_manifest}
    agreement = agree_all_family_ownerships(
        manifest=manifest, graph=graph, graph_manifest=graph_manifest,
    )
    if not agreement["ok"]:
        return {
            "ok": False,
            "reason": "ownership_mismatch",
            "findings": list(agreement["findings"]),
            "graph": graph,
            "graph_manifest": graph_manifest,
            "graph_claimed": agreement["graph_claimed"],
        }
    return {
        "ok": True,
        "graph": graph,
        "graph_manifest": graph_manifest,
        "content_digest": declared_digest,
        "source": "package",
    }


# --------------------------------------------------------------------------- #
# Family runtime ownership (spec §7.7)
# --------------------------------------------------------------------------- #
_OWNER_ENUM = frozenset({"legacy", "shadow", "graph"})
_SURFACE_ENUM = frozenset({"visible", "hidden", "removed"})


class FamilyOwnershipMismatch(ValueError):
    """Three artifacts disagree on a family's owner/surface; never pick a side."""

    def __init__(self, findings: list[str], *, graph_claimed: bool = False):
        super().__init__(
            "; ".join(findings) or "family ownership artifacts disagree"
        )
        self.findings = list(findings)
        self.graph_claimed = bool(graph_claimed)


def _package_family_view(
    manifest: Mapping[str, Any] | None, family: str,
) -> tuple[str, str] | None:
    if not isinstance(manifest, Mapping):
        return None
    for entry in manifest.get("rule_families") or []:
        if isinstance(entry, dict) and entry.get("family_id") == family:
            owner = entry.get("runtime_owner") or "legacy"
            surface = entry.get("legacy_surface") or "visible"
            return str(owner), str(surface)
    return None


def agree_family_ownership(
    family: str,
    *,
    manifest: Mapping[str, Any] | None = None,
    graph: Mapping[str, Any] | None = None,
    graph_manifest: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Cross-validate one family's owner/surface across the three artifacts.

    Implicit package default is ``legacy``/``visible`` when a package manifest
    object is supplied but the family has no ``rule_families`` entry.  A single
    explicit view is accepted; two or more views must be identical.  Never
    picks a side on disagreement.
    """
    views: dict[str, tuple[str, str | None]] = {}
    package_view = _package_family_view(manifest, family)
    if package_view is not None:
        views["package"] = package_view
    elif manifest is not None:
        views["package"] = ("legacy", "visible")
    owner_map = (graph or {}).get("family_runtime_ownership") or {}
    surface_map = (graph or {}).get("legacy_surface_lifecycle") or {}
    if not isinstance(owner_map, Mapping):
        owner_map = {}
    if not isinstance(surface_map, Mapping):
        surface_map = {}
    if family in owner_map or family in surface_map:
        owner = owner_map.get(family) or "legacy"
        surface = surface_map.get(family) or "visible"
        views["graph"] = (str(owner), str(surface))
    promo = ((graph_manifest or {}).get("family_promotion_eligibility") or {}).get(
        family
    )
    if isinstance(promo, Mapping) and promo.get("runtime_ownership") in _OWNER_ENUM:
        surf = str(surface_map[family]) if family in surface_map else None
        views["graph_manifest"] = (str(promo["runtime_ownership"]), surf)
    if not views:
        return {
            "ok": True,
            "owner": "legacy",
            "surface": "visible",
            "findings": [],
            "graph_claimed": False,
            "views": views,
        }
    owners = [pair[0] for pair in views.values()]
    surfaces = [pair[1] for pair in views.values() if pair[1] is not None]
    findings: list[str] = []
    if any(owner != owners[0] for owner in owners):
        findings.append(
            f"family {family!r} runtime_owner disagrees across artifacts: {views}"
        )
    if surfaces and any(surface != surfaces[0] for surface in surfaces):
        findings.append(
            f"family {family!r} legacy_surface disagrees across artifacts: {views}"
        )
    if owners[0] == "graph" and (
        not isinstance(promo, Mapping)
        or promo.get("promotion_eligible") is not True
    ):
        findings.append(
            f"family {family!r} graph ownership requires promotion_eligible true"
        )
    graph_claimed = any(owner == "graph" for owner in owners)
    if findings:
        return {
            "ok": False,
            "owner": None,
            "surface": None,
            "findings": findings,
            "graph_claimed": graph_claimed,
            "views": views,
        }
    return {
        "ok": True,
        "owner": owners[0],
        "surface": surfaces[0] if surfaces else "visible",
        "findings": [],
        "graph_claimed": owners[0] == "graph",
        "views": views,
    }


def agree_all_family_ownerships(
    *,
    manifest: Mapping[str, Any] | None = None,
    graph: Mapping[str, Any] | None = None,
    graph_manifest: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Cross-validate every family named in any of the three artifacts."""
    families: set[str] = set()
    for entry in (manifest or {}).get("rule_families") or []:
        if isinstance(entry, dict) and isinstance(entry.get("family_id"), str):
            families.add(entry["family_id"])
    owner_map = (graph or {}).get("family_runtime_ownership") or {}
    surface_map = (graph or {}).get("legacy_surface_lifecycle") or {}
    if isinstance(owner_map, Mapping):
        families.update(str(key) for key in owner_map)
    if isinstance(surface_map, Mapping):
        families.update(str(key) for key in surface_map)
    promo_map = (graph_manifest or {}).get("family_promotion_eligibility") or {}
    if isinstance(promo_map, Mapping):
        families.update(str(key) for key in promo_map)
    findings: list[str] = []
    graph_claimed = False
    for family in sorted(families):
        row = agree_family_ownership(
            family, manifest=manifest, graph=graph, graph_manifest=graph_manifest,
        )
        findings.extend(row["findings"])
        graph_claimed = graph_claimed or bool(row["graph_claimed"])
    return {
        "ok": not findings,
        "findings": findings,
        "graph_claimed": graph_claimed,
    }


_PUBLIC_EFFECT_RUNTIME_CACHE: dict[str, "RulesRuntime | None"] = {}


def public_effect_refs_for_decision(
    decision_ref: str,
    *,
    ruleset_id: str | None = None,
) -> list[str]:
    """Public effect semantic ids emitted by one decision ref.

    Decision node -> ``emits`` -> effect nodes; only effects ``plan_for``
    would treat as public (``visibility`` absent or ``"public"``) are
    returned.  ``keeper-only`` / ``concealed-result`` effects are always
    excluded.  Unknown, malformed, or non-decision input returns ``[]``.
    Pure deterministic graph query with no semantic reasoning
    (cross-graph wiring spec W1: RuleGraph -> text rendering bridge).
    """
    ref = str(decision_ref or "").strip()
    if not ref.startswith("decision:"):
        return []
    segments = ref.split(":")
    resolved = ruleset_id or (segments[1] if len(segments) >= 2 and segments[1] else "")
    if not resolved:
        return []
    if resolved not in _PUBLIC_EFFECT_RUNTIME_CACHE:
        runtime: RulesRuntime | None = None
        try:
            loaded = load_ruleset_graph(resolved)
        except Exception:
            loaded = {"ok": False}
        if isinstance(loaded, dict) and loaded.get("ok"):
            runtime = RulesRuntime(
                loaded["graph"],
                ruleset_id=resolved,
                graph_manifest=loaded.get("graph_manifest") if isinstance(loaded.get("graph_manifest"), dict) else None,
            )
        _PUBLIC_EFFECT_RUNTIME_CACHE[resolved] = runtime
    runtime = _PUBLIC_EFFECT_RUNTIME_CACHE[resolved]
    if runtime is None:
        return []
    return runtime.public_effect_refs_for(ref)


def resolve_family_ownership(
    ruleset_id: str,
    family: str,
    *,
    manifest: dict[str, Any] | None = None,
    graph: dict[str, Any] | None = None,
    graph_manifest: dict[str, Any] | None = None,
) -> tuple[str, str]:
    """Return ``(runtime_owner, legacy_surface)`` for one family.

    The three artifacts (package manifest, rule-graph, graph-manifest) must
    agree.  Disagreement raises ``FamilyOwnershipMismatch`` rather than
    silently preferring the package entry.
    """
    if manifest is None and graph is None and graph_manifest is None:
        manifest = _load_manifest_cached(ruleset_id)
    row = agree_family_ownership(
        family, manifest=manifest, graph=graph, graph_manifest=graph_manifest,
    )
    if not row["ok"]:
        raise FamilyOwnershipMismatch(
            list(row["findings"]), graph_claimed=bool(row["graph_claimed"]),
        )
    return str(row["owner"]), str(row["surface"])


# --------------------------------------------------------------------------- #
# Live-state facts overlay (registered condition paths only)
# --------------------------------------------------------------------------- #
def _minutes_since_injury(
    state: Mapping[str, Any],
    elapsed_minutes: int | None,
) -> int | None:
    """Hours-window input: campaign clock minus the latest active wound receipt."""
    if not isinstance(elapsed_minutes, int) or isinstance(elapsed_minutes, bool):
        return None
    if elapsed_minutes < 0:
        return None
    ledger = state.get("wound_ledger")
    if not isinstance(ledger, list):
        return None
    occurred: list[int] = []
    for row in ledger:
        if not isinstance(row, Mapping):
            continue
        if row.get("status") != "active":
            continue
        stamp = row.get("occurred_elapsed_minutes")
        if isinstance(stamp, bool) or not isinstance(stamp, int) or stamp < 0:
            continue
        occurred.append(stamp)
    if not occurred:
        return None
    return max(0, elapsed_minutes - max(occurred))


def _major_wound_recovery_due(
    state: Mapping[str, Any],
    elapsed_minutes: int | None,
) -> bool | None:
    """Project the executor's weekly recovery interval without authorizing it.

    The subsystem executor remains the final validator. This read projection
    only keeps an early weekly card out of Keeper context; malformed or
    incomplete ledgers return ``None`` so graph applicability fails closed.
    """
    if (
        "major_wound" not in (state.get("conditions") or [])
        or isinstance(elapsed_minutes, bool)
        or not isinstance(elapsed_minutes, int)
        or elapsed_minutes < 0
    ):
        return None
    ledger = state.get("wound_ledger")
    if not isinstance(ledger, list) or not ledger:
        return None
    active: list[tuple[int, str]] = []
    for row in ledger:
        if not isinstance(row, Mapping) or row.get("status") != "active":
            continue
        stamp = row.get("occurred_elapsed_minutes")
        wound_id = row.get("wound_id")
        if (
            isinstance(stamp, bool)
            or not isinstance(stamp, int)
            or stamp < 0
            or not isinstance(wound_id, str)
            or not wound_id
        ):
            return None
        active.append((stamp, wound_id))
    if not active:
        return None
    baseline, active_wound_id = max(active)
    recovery_rows = state.get("major_wound_recovery_ledger") or []
    if not isinstance(recovery_rows, list):
        return None
    for row in recovery_rows:
        if not isinstance(row, Mapping):
            return None
        stamp = row.get("attempt_elapsed_minutes")
        wound_id = row.get("wound_id")
        if (
            isinstance(stamp, bool)
            or not isinstance(stamp, int)
            or stamp < 0
            or not isinstance(wound_id, str)
            or not wound_id
        ):
            return None
        if wound_id == active_wound_id:
            baseline = max(baseline, stamp)
    return elapsed_minutes - baseline >= 7 * 24 * 60


def facts_from_state(
    state: dict[str, Any] | None,
    sheet: dict[str, Any] | None,
    *,
    ruleset_id: str | None = None,
    extra: dict[str, Any] | None = None,
    elapsed_minutes: int | None = None,
) -> dict[str, Any]:
    """Project live investigator state into the registered facts dict.

    Only paths in the R1 contract's ``registered_condition_paths`` are ever
    produced here; condition evaluation additionally refuses unregistered
    paths so the graph can never read arbitrary state or prose.

    Boolean condition flags are emitted only when true so ``exists`` /
    ``not exists`` match the graph's ordinary First Aid / Medicine gates.
    ``time.minutes_since_injury`` is derived from ``wound_ledger`` plus the
    campaign clock; unknown clocks stay absent (exceptions do not fire).
    """
    state = state or {}
    sheet = sheet or {}
    characteristics = sheet.get("characteristics") if isinstance(sheet.get("characteristics"), dict) else {}
    derived = sheet.get("derived") if isinstance(sheet.get("derived"), dict) else {}
    conditions = list(state.get("conditions") or [])
    facts: dict[str, Any] = {
        "actor.id": state.get("investigator_id"),
        "actor.resources.hp": state.get("current_hp"),
        "actor.resources.hp_max": derived.get("HP"),
        "actor.resources.san": state.get("current_san"),
        "actor.resources.mp": state.get("current_mp"),
        "actor.resources.luck": state.get("current_luck"),
        "actor.sheet.con": characteristics.get("CON"),
        "actor.conditions": conditions,
    }
    for flag in ("dying", "unconscious", "major_wound", "dead"):
        if flag in conditions:
            facts[f"actor.conditions.{flag}"] = True
    minutes_since = _minutes_since_injury(state, elapsed_minutes)
    if minutes_since is not None:
        facts["time.minutes_since_injury"] = minutes_since
    recovery_due = _major_wound_recovery_due(state, elapsed_minutes)
    if recovery_due is not None:
        facts["actor.recovery.major_wound_week_due"] = recovery_due
    if ruleset_id is not None:
        facts["campaign.ruleset_id"] = ruleset_id
    if isinstance(extra, dict):
        facts.update({str(key): deepcopy(value) for key, value in extra.items()})
    facts.setdefault("intent.rescuer_count", 1)
    return facts


def _evaluate_leaf(expression: dict[str, Any], facts: Mapping[str, Any]) -> bool | None:
    """Evaluate one leaf; ``None`` = unregistered path or unknown fact."""
    path = expression.get("path")
    registered = registered_condition_paths()
    if not isinstance(path, str) or path not in registered:
        return None
    value = facts.get(path) if isinstance(facts, Mapping) else None
    op = expression.get("op")
    if op == "exists":
        return value is not None
    if value is None:
        return None
    operand = expression.get("value")
    if op == "eq":
        return value == operand
    if op == "neq":
        return value != operand
    if op == "lt":
        try:
            return value < operand
        except TypeError:
            return None
    if op == "lte":
        try:
            return value <= operand
        except TypeError:
            return None
    if op == "gt":
        try:
            return value > operand
        except TypeError:
            return None
    if op == "gte":
        try:
            return value >= operand
        except TypeError:
            return None
    if op == "contains":
        if isinstance(value, (list, tuple, set, frozenset)):
            return operand in value
        if isinstance(value, str) and isinstance(operand, str):
            return operand in value
        return None
    if op == "not-contains":
        found = _evaluate_leaf({"op": "contains", "path": path, "value": operand}, facts)
        return None if found is None else not found
    return None


def _condition_children(expression: Mapping[str, Any]) -> list[Any] | None:
    """``of`` is a list; a single dict child is accepted for ``not``."""
    raw = expression.get("of")
    if isinstance(raw, dict):
        return [raw]
    if isinstance(raw, list):
        return raw
    return None


def _requirement_phrase(expression: Mapping[str, Any], negated: bool) -> str:
    """What this leaf asks for, in words the Keeper can act on.

    Rendering `expected` alone loses the operator, and an operator-only leaf
    such as `{"op": "exists"}` carries no `value` at all -- so an unmet
    existence gate printed "actor.conditions.major_wound is None, needs None",
    which reads as already satisfied and names nothing to do about it.
    """
    op = expression.get("op")
    value = expression.get("value")
    if op == "exists":
        return "to be absent" if negated else "to be present"
    phrases = {
        "eq": "to equal", "neq": "to differ from",
        "lt": "to be less than", "lte": "to be at most",
        "gt": "to be greater than", "gte": "to be at least",
        "contains": "to contain", "not-contains": "not to contain",
    }
    phrase = phrases.get(str(op), f"to satisfy {op!r} against")
    return f"not ({phrase} {value!r})" if negated else f"{phrase} {value!r}"


#: Total `unmet` leaf rows `rules.context` will spend on its withheld block.
#: coc7's worst family (chase, every gate shut) produces 13, so this never
#: bites today; it exists so a larger graph cannot silently turn a bounded
#: diagnostic into the thing that pushes a context result past the transport
#: cap. Past the budget the decision refs still travel -- they are the part
#: the Keeper cannot reconstruct, and the host rewrites canonical ids out of
#: prose, so they must be structured fields either way.
WITHHELD_UNMET_ROW_BUDGET = 24


def _bounded_withheld(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Order the withheld block and spend a fixed row budget on it.

    Sorted by decision_ref so the same shut family reads the same on every
    call -- a diagnostic that reorders itself cannot be diffed across turns.
    """
    bounded: list[dict[str, Any]] = []
    spent = 0
    for row in sorted(rows, key=lambda row: str(row["decision_ref"])):
        unmet = list(row.get("unmet") or [])
        room = max(WITHHELD_UNMET_ROW_BUDGET - spent, 0)
        kept = unmet[:room]
        spent += len(kept)
        entry: dict[str, Any] = {"decision_ref": row["decision_ref"]}
        if row.get("label"):
            # The Keeper narrates the refusal as often as it acts on it, and
            # a decision id is not a sentence. Cheap next to the rows.
            entry["label"] = row["label"]
        entry["unmet"] = kept
        if len(kept) < len(unmet):
            entry["unmet_omitted"] = len(unmet) - len(kept)
        bounded.append(entry)
    return bounded


def evaluate_condition(
    expression: Any,
    facts: Mapping[str, Any],
) -> bool | None:
    """Closed structural condition language; ``None`` = unresolved/unknown.

    Returns False for unknown facts so a hard-gate condition fails closed
    (the decision is reported not applicable rather than guessed).
    """
    if not isinstance(expression, dict):
        return False
    op = expression.get("op")
    if op in {"all", "any"}:
        children = _condition_children(expression)
        if children is None:
            return False
        results = [evaluate_condition(child, facts) for child in children]
        if op == "all":
            if any(result is False for result in results):
                return False
            if any(result is None for result in results):
                return None
            return True
        if any(result is True for result in results):
            return True
        if any(result is None for result in results):
            return None
        return False
    if op == "not":
        children = _condition_children(expression)
        if children is None or len(children) != 1:
            return False
        child = evaluate_condition(children[0], facts)
        return None if child is None else not child
    if op in {
        "eq", "neq", "lt", "lte", "gt", "gte", "contains", "not-contains",
        "exists",
    }:
        return _evaluate_leaf(expression, facts)
    return False


_LEAF_CONDITION_OPS = frozenset({
    "eq", "neq", "lt", "lte", "gt", "gte", "contains", "not-contains",
    "exists",
})
_BOOL_CONDITION_OPS = frozenset({"all", "any", "not"})


def classify_exception_condition(
    expression: Any,
    facts: Mapping[str, Any],
) -> tuple[str, str | None]:
    """Classify a recorded exception condition against live facts.

    Returns ``(matched|inactive|unevaluated, reason)``.  A missing,
    unknown, or unparseable **recorded** condition is ``unevaluated`` so
    the exception is surfaced rather than silently dropped.  A well-formed
    condition whose live fact is absent stays ``inactive``: incomplete
    situation data does not invent an excluded circumstance.
    """
    if not isinstance(expression, dict):
        return "unevaluated", "malformed_expression"
    op = expression.get("op")
    if op in _BOOL_CONDITION_OPS:
        children = _condition_children(expression)
        if children is None:
            return "unevaluated", "malformed_expression"
        if op == "not" and len(children) != 1:
            return "unevaluated", "malformed_expression"
        statuses = [
            classify_exception_condition(child, facts) for child in children
        ]
        if op == "all":
            if any(status == "inactive" for status, _reason in statuses):
                return "inactive", None
            unevaluated = next(
                (
                    (status, reason) for status, reason in statuses
                    if status == "unevaluated"
                ),
                None,
            )
            if unevaluated is not None:
                return unevaluated
            return "matched", None
        if op == "any":
            if any(status == "matched" for status, _reason in statuses):
                return "matched", None
            unevaluated = next(
                (
                    (status, reason) for status, reason in statuses
                    if status == "unevaluated"
                ),
                None,
            )
            if unevaluated is not None:
                return unevaluated
            return "inactive", None
        child_status, child_reason = statuses[0]
        if child_status == "unevaluated":
            return "unevaluated", child_reason
        if child_status == "matched":
            return "inactive", None
        return "matched", None
    if op in _LEAF_CONDITION_OPS:
        path = expression.get("path")
        if not isinstance(path, str) or path not in registered_condition_paths():
            return "unevaluated", "unregistered_path"
        result = _evaluate_leaf(expression, facts)
        if result is True:
            return "matched", None
        return "inactive", None
    return "unevaluated", "unknown_operator"


# --------------------------------------------------------------------------- #
# RulesRuntime — the deep module (spec §8)
# --------------------------------------------------------------------------- #
class RulesRuntime:
    """One graph's runtime view: ``context`` and ``settle`` only.

    Constructor dependencies are injected (spec §8.1): a facts provider for
    live-state overlay and a host-locked provider for locked inputs.  The
    runtime itself never performs state I/O, RNG, or receipts.  Graph-owned
    ``settle()`` invokes an injected executor that MUST be the existing
    resolver/subsystem adapter; it never reimplements those capabilities.
    """

    SCHEMA_VERSION = 1

    def __init__(
        self,
        graph: dict[str, Any],
        *,
        ruleset_id: str | None = None,
        ruleset_version: str | None = None,
        graph_manifest: dict[str, Any] | None = None,
        package_manifest: Mapping[str, Any] | None = None,
        campaign_id: str | None = None,
        facts_provider: Callable[[], Mapping[str, Any]] | None = None,
        state_revision_provider: Callable[[], str | None] | None = None,
        grant_context_provider: Callable[[], Mapping[str, Any]] | None = None,
        host_locked_provider: Callable[[str], Mapping[str, Any]] | None = None,
        resolver_index: Mapping[str, Any] | None = None,
        projection_audience: str = "keeper",
        ruleset_adapter: Any | None = None,
        optional_rules_provider: Callable[[], Mapping[str, Mapping[str, Any]]] | None = None,
    ) -> None:
        if not isinstance(graph, dict) or not isinstance(graph.get("nodes"), list):
            raise ValueError("RulesRuntime requires a compiled RuleGraph object")
        # Optional-rule gates (coc_rule_options): ``decision_ref -> status``
        # for every card a disabled ruleset-declared optional rule covers.
        # Injected like the facts provider so the runtime never reads
        # campaign files itself; absent means no option is disabled.
        self._optional_rules_provider = optional_rules_provider
        self._graph = graph
        self._ruleset_id = ruleset_id or str(graph.get("ruleset_id") or "")
        self._ruleset_version = ruleset_version or (
            (graph_manifest or {}).get("ruleset_version") if isinstance(graph_manifest, Mapping) else None
        ) or "unversioned"
        # Graph generation is machine-owned integrity evidence: the build
        # manifest's content digest, or a deterministic digest of the graph
        # object itself when no manifest is attached.  Never model-relayed.
        manifest_digest = (graph_manifest or {}).get("graph_content_digest")
        self._graph_generation = str(manifest_digest) if manifest_digest else f"sha256:{_json_digest(graph)}"
        self._campaign_id = campaign_id
        self._graph_manifest = graph_manifest
        self._package_manifest = (
            dict(package_manifest) if isinstance(package_manifest, Mapping) else None
        )
        self._facts_provider = facts_provider
        self._state_revision_provider = state_revision_provider
        self._grant_context_provider = grant_context_provider
        self._host_locked_provider = host_locked_provider
        self._resolver_index = resolver_index
        self._ruleset_adapter = ruleset_adapter
        if projection_audience not in {"keeper", "host-internal", "audit"}:
            raise ValueError(
                "RulesRuntime projection_audience must be keeper, host-internal, or audit"
            )
        self._projection_audience = projection_audience
        # Machine-issued card grants (spec §8.5/§8.6): grants issued by
        # ``context()`` are recorded here; ``settle()`` validates the caller's
        # grant against this registry, ignoring any caller-authored fields.
        self._grants: dict[str, dict[str, Any]] = {}
        # Optional read-only lookup executor for graph-owned context lookups.
        self._lookup_executor: Callable[..., Any] | None = None
        self._grant_sequence = 0
        self._nodes: dict[str, dict[str, Any]] = {}
        self._relations: list[dict[str, Any]] = []
        for node in graph.get("nodes") or []:
            if isinstance(node, dict) and isinstance(node.get("node_id"), str):
                self._nodes[node["node_id"]] = node
        self._relations = [
            rel for rel in (graph.get("relations") or []) if isinstance(rel, dict)
        ]
        self._out: dict[str, list[dict[str, Any]]] = {}
        self._in: dict[str, list[dict[str, Any]]] = {}
        for rel in self._relations:
            self._out.setdefault(str(rel.get("from_node_id")), []).append(rel)
            self._in.setdefault(str(rel.get("to_node_id")), []).append(rel)

    # -- indexes ----------------------------------------------------------- #
    def node_ids_by_kind(self, kind: str) -> list[str]:
        return sorted(
            node_id for node_id, node in self._nodes.items()
            if node.get("node_kind") == kind
        )

    def decision_nodes(self, family: str | None = None) -> list[dict[str, Any]]:
        rows = [
            node for node in self._nodes.values()
            if node.get("node_kind") == "decision"
        ]
        if family is not None:
            rows = [
                node for node in rows
                if (node.get("properties") or {}).get("family_id") == family
            ]
        return sorted(rows, key=lambda node: str(node.get("node_id")))

    def _outgoing(self, node_id: str, kind: str | None = None) -> list[dict[str, Any]]:
        rows = self._out.get(node_id, [])
        if kind is not None:
            rows = [row for row in rows if row.get("relation_kind") == kind]
        return sorted(rows, key=lambda row: str(row.get("relation_id")))

    def _incoming(self, node_id: str, kind: str | None = None) -> list[dict[str, Any]]:
        rows = self._in.get(node_id, [])
        if kind is not None:
            rows = [row for row in rows if row.get("relation_kind") == kind]
        return sorted(rows, key=lambda row: str(row.get("relation_id")))

    def _invokes(self, node_id: str) -> dict[str, Any] | None:
        for rel in self._outgoing(node_id, "invokes"):
            target = self._nodes.get(str(rel.get("to_node_id")))
            if target is not None:
                return target
        return None

    def _conditions_for(self, node_id: str) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for rel in self._outgoing(node_id, "available-when"):
            target = self._nodes.get(str(rel.get("to_node_id")))
            if target is not None and target.get("node_kind") == "condition":
                out.append(target)
        return out

    def _rules_for(self, node_id: str) -> list[str]:
        """Rules tied to a decision through the capability it invokes."""
        cap = self._invokes(node_id)
        if cap is None:
            return []
        cap_id = str(cap.get("node_id"))
        return sorted(
            str(node["node_id"])
            for node in self._nodes.values()
            if node.get("node_kind") == "rule"
            and any(
                rel.get("relation_kind") == "invokes"
                and str(rel.get("to_node_id")) == cap_id
                for rel in self._outgoing(str(node["node_id"]))
            )
        )

    def _source_refs_for(self, rule_refs: list[str]) -> list[str]:
        refs: set[str] = set()
        for rule_id in rule_refs:
            node = self._nodes.get(rule_id)
            for span in node.get("evidence_span_ids") or []:
                if isinstance(span, str):
                    refs.add(span)
        return sorted(refs)

    def _effects_for(self, node_id: str) -> list[str]:
        out = []
        for rel in self._outgoing(node_id, "emits"):
            target = self._nodes.get(str(rel.get("to_node_id")))
            if target is not None and target.get("node_kind") == "effect":
                out.append(str(target.get("node_id")))
        return sorted(set(out))

    def public_effect_refs_for(self, decision_ref: str) -> list[str]:
        """Public ``emits`` targets of one decision node (W1 runtime bridge).

        Mirrors ``plan_for`` visibility semantics: an effect with no
        ``visibility`` property or ``visibility == "public"`` is returned;
        ``keeper-only`` and ``concealed-result`` effects are never returned.
        Unknown or non-decision input yields ``[]``.  Pure deterministic
        graph query; no semantic reasoning.
        """
        ref = str(decision_ref or "").strip()
        node = self._nodes.get(ref)
        if not isinstance(node, dict) or node.get("node_kind") != "decision":
            return []
        out: list[str] = []
        for effect_id in self._effects_for(ref):
            effect = self._nodes.get(effect_id) or {}
            vis = (effect.get("properties") or {}).get("visibility") or effect.get("visibility")
            if vis in {"keeper-only", "concealed-result"}:
                continue
            out.append(effect_id)
        return sorted(set(out))

    def _pending_choices_for(self, node_id: str) -> list[str]:
        out = []
        for rel in self._outgoing(node_id, "offers-choice"):
            target = self._nodes.get(str(rel.get("to_node_id")))
            if target is not None and target.get("node_kind") == "pending-choice":
                out.append(str(target.get("node_id")))
        return sorted(set(out))

    def _continuations_for(self, node_id: str) -> list[str]:
        return sorted({
            str(rel.get("to_node_id"))
            for rel in self._outgoing(node_id, "continues-as")
            if self._nodes.get(str(rel.get("to_node_id"))) is not None
        })

    # -- input slots -------------------------------------------------------- #
    def _slots_for(self, node_id: str) -> list[dict[str, Any]]:
        """Union of implementation payload slots and input-slot nodes.

        The compiler emits BOTH a decision's ``implementation.payload_slots``
        AND ``requires-input`` input-slot NODES for the same logical inputs.
        Input-slot node ids are ``input-slot:<ruleset>:<family>:<name>``; the
        canonical slot name is the name segment with hyphens normalized to
        underscores.  When the canonical name matches an implementation
        payload slot, the node MERGES into it (type enrichment, node
        ownership kept) instead of being surfaced as a second model-facing
        slot under its node id.
        """
        slots: dict[str, dict[str, Any]] = {}
        node = self._nodes.get(node_id) or {}
        implementation = (node.get("properties") or {}).get("implementation")
        if isinstance(implementation, dict):
            for slot in implementation.get("payload_slots") or []:
                if not isinstance(slot, dict) or not isinstance(slot.get("name"), str):
                    continue
                slots[slot["name"]] = {
                    "name": slot["name"],
                    "ownership": slot.get("ownership") or "host-locked",
                    "type": _scalar_type_from_guess(slot.get("name")),
                }
        for rel in list(self._outgoing(node_id, "requires-input")) + list(
            self._outgoing(node_id, "locks-input")
        ):
            target = self._nodes.get(str(rel.get("to_node_id")))
            if target is None or target.get("node_kind") != "input-slot":
                continue
            props = target.get("properties") or {}
            canonical = _canonical_slot_name(str(target.get("node_id")))
            node_ownership = props.get("ownership") or "keeper-semantic"
            node_type = props.get("value_type") or "scalar"
            # The input-slot node carries an authored, evidence-backed
            # sentence describing what the slot wants. The card projected only
            # (name, owner, type) and dropped it, so a slot typed `object` --
            # whose `type` is itself guessed from the slot name -- reached the
            # Keeper with no contract at all. `supporting_action` is the case
            # that cost: the Keeper filled a reasonable-looking object, it
            # adjudicated as level 0, and the player's earned clue granted no
            # leverage on any of three Extreme rescue checks.
            node_description = target.get("name")
            if not isinstance(node_description, str) or not node_description.strip():
                node_description = None
            existing = slots.get(canonical)
            if existing is not None:
                # The same logical slot is already declared by the
                # implementation payload slots: merge the node's richer type.
                if existing["type"] in (None, "scalar") and node_type != "scalar":
                    existing["type"] = node_type
                existing.setdefault("path", props.get("path"))
                if node_description and not existing.get("description"):
                    existing["description"] = node_description
                continue
            slots[canonical] = {
                "name": canonical,
                "ownership": node_ownership,
                "type": node_type,
                "path": props.get("path"),
                **({"description": node_description} if node_description else {}),
            }
        return sorted(slots.values(), key=lambda slot: slot["name"])

    # -- applicability ------------------------------------------------------ #
    def optional_rule_gate(self, node_id: str) -> dict[str, Any] | None:
        """The disabling optional-rule status for one decision, or None."""
        if self._optional_rules_provider is None:
            return None
        gates = self._optional_rules_provider()
        row = gates.get(node_id) if isinstance(gates, Mapping) else None
        return dict(row) if isinstance(row, Mapping) else None

    def applicability(self, node_id: str, facts: Mapping[str, Any]) -> tuple[bool, bool]:
        """Return ``(applicable, hard_gated)`` for one decision."""
        conditions = self._conditions_for(node_id)
        hard_conditions = [
            condition for condition in conditions
            if condition.get("hard_gate") is True
        ]
        hard_gated = bool(hard_conditions)
        passed = all(
            evaluate_condition((condition.get("properties") or {}).get("expression"), facts)
            for condition in hard_conditions
        )
        return bool(passed), hard_gated

    def _settle_form(self, node_id: str, slots: list[dict[str, Any]]) -> dict[str, Any]:
        """The exact arguments that settle THIS decision.

        `rules.settle` takes one flat `semantic_inputs` schema whose property
        map is the union of every slot of every decision in every family —
        56 keys, `additionalProperties: false`. That union is legal for the
        tool and wrong for the decision, and a model composing a call from it
        cannot tell the difference. Observed live on 2026-09-02: settling
        decision:coc7:combat:flee, whose only model-owned slot is an optional
        `candidate_ref`, the Keeper passed `source_ref` — a key belonging to
        another family, in the union, so the schema accepted it and the graph
        rejected it as an undeclared slot.

        The card already describes its inputs. This states them as the call:
        the decision_ref filled in, the required slots named, the optional
        ones named apart so an empty form reads as complete rather than as
        something withheld. Most decisions need nothing beyond the id — of
        the 43, eleven take no model-owned slot and thirteen take one.
        """
        required = sorted(
            slot["name"] for slot in slots
            if slot["ownership"] in _REQUIRED_SEMANTIC_OWNERSHIPS
        )
        optional = sorted(
            slot["name"] for slot in slots
            if slot["ownership"] in _SEMANTIC_SLOT_OWNERSHIPS
            and slot["ownership"] not in _REQUIRED_SEMANTIC_OWNERSHIPS
        )
        form: dict[str, Any] = {
            "prefilled_arguments": {"decision_ref": node_id},
            "missing_arguments": ["decision_id", *required],
        }
        if optional:
            form["optional_arguments"] = optional
        return form

    # -- declared-intent triggers ------------------------------------------ #
    #: A condition whose expression reads this path is a trigger on the
    #: player's declared action rather than on campaign state. Such a
    #: condition is deliberately not a hard gate: a card stays an affordance,
    #: so a decision that answers the declared action is *marked*, never made
    #: the only legal one, and a decision that does not answer it stays
    #: available exactly as before.
    INTENT_FACT_PATH = "intent.action_kind"

    def _intent_conditions_for(self, node_id: str) -> list[dict[str, Any]]:
        out = []
        for condition in self._conditions_for(node_id):
            if condition.get("hard_gate") is True:
                continue
            expression = (condition.get("properties") or {}).get("expression")
            if self.INTENT_FACT_PATH in json.dumps(expression, sort_keys=True):
                out.append(condition)
        return out

    def answers_declared_intent(
        self, node_id: str, facts: Mapping[str, Any],
    ) -> bool | None:
        """True/False when this decision declares an intent trigger; None when
        it declares none, or when no intent was declared this turn."""
        conditions = self._intent_conditions_for(node_id)
        if not conditions or not facts.get(self.INTENT_FACT_PATH):
            return None
        return any(
            evaluate_condition(
                (condition.get("properties") or {}).get("expression"), facts,
            )
            for condition in conditions
        )

    # -- cards -------------------------------------------------------------- #
    def _slot_shape(self, slot_name: str) -> dict[str, Any] | None:
        """Authored shape for one slot, asked of the ruleset adapter.

        Duck-typed exactly like `augment_facts` and `context_lookup`: this
        runtime stays ruleset-agnostic and never learns what a slot means, and
        the ruleset never learns the card format. An adapter that does not
        answer simply yields no shape.

        A slot typed `object` -- whose `type` is itself guessed from the slot
        name -- is unusable without one. `supporting_action` is the case that
        cost: the Keeper filled a reasonable-looking object, it adjudicated as
        level 0, and the player's earned clue granted no leverage across three
        Extreme rescue checks, with the module's rescue ending behind it.
        """
        adapter = self._ruleset_adapter
        if adapter is None:
            return None
        lookup = getattr(adapter, "semantic_input_shape", None)
        if not callable(lookup):
            return None
        try:
            shape = lookup(slot_name)
        except Exception:
            return None
        return shape if isinstance(shape, dict) and shape else None

    def _card(self, node_id: str, facts: Mapping[str, Any]) -> dict[str, Any]:
        node = self._nodes[node_id]
        props = node.get("properties") or {}
        slots = self._slots_for(node_id)
        applicable, hard_gated = self.applicability(node_id, facts)
        capability = self._invokes(node_id)
        rule_refs = self._rules_for(node_id)
        active, unevaluated, _findings = self._surface_exceptions(node_id, facts)
        card = {
            "schema_version": self.SCHEMA_VERSION,
            "decision_ref": node_id,
            "family": props.get("family_id") or "",
            "label": node.get("name") or node_id,
            "applicability": "applicable" if applicable else "not_applicable",
            "required_inputs": [
                {
                    "name": slot["name"],
                    "owner": slot["ownership"],
                    "type": slot["type"],
                    **(
                        {"description": slot["description"]}
                        if slot.get("description")
                        else {}
                    ),
                    **(
                        {"shape": shape}
                        if (shape := self._slot_shape(slot["name"])) is not None
                        else {}
                    ),
                }
                for slot in slots
                if slot["ownership"] in _SEMANTIC_SLOT_OWNERSHIPS
            ],
            "locked_inputs": [
                slot["name"] for slot in slots
                if slot["ownership"] in _LOCKED_SLOT_OWNERSHIPS
            ],
            "rule_refs": rule_refs,
            "source_refs": self._source_refs_for(rule_refs),
            "capability_ref": (
                str(capability.get("node_id")) if capability is not None else None
            ),
            "effect_refs": self._effects_for(node_id),
            "possible_continuations": self._continuations_for(node_id),
            "authority": {
                "selection": "keeper-semantic",
                "execution": "current-ruleset-adapter",
                "hard_gate": hard_gated,
            },
        }
        card["settle_form"] = self._settle_form(node_id, slots)
        answers_intent = self.answers_declared_intent(node_id, facts)
        if answers_intent is not None:
            card["answers_declared_intent"] = answers_intent
        gate = self.optional_rule_gate(node_id)
        if gate is not None:
            # A disabled optional rule is a table decision, not a state fact:
            # the card stays projected as not applicable and names the ruling.
            card["applicability"] = "not_applicable"
            card["disabled_by_optional_rule"] = gate
        if active:
            card["active_exceptions"] = active
        if unevaluated:
            card["unevaluated_exceptions"] = unevaluated
        return card

    # -- card grants (spec §8.5/§8.6 static recheck) ---------------------- #
    def _gating_fact_paths(self, decision_refs: Iterable[str]) -> tuple[str, ...]:
        """The fact paths whose value decides whether these cards are offered.

        Read off the graph's own hard gates -- `applicability` consults nothing
        else -- so the scope is derived, never a guess about which namespaces
        look related.
        """
        paths: set[str] = set()

        def walk(expression: Any, negated: bool = False) -> None:
            if not isinstance(expression, Mapping):
                return
            children = _condition_children(expression)
            if children is not None:
                flipped = negated != (expression.get("op") == "not")
                for child in children:
                    walk(child, flipped)
                return
            path = expression.get("path")
            if isinstance(path, str) and path:
                paths.add(path)

        for decision_ref in decision_refs:
            for condition in self._conditions_for(str(decision_ref)):
                if condition.get("hard_gate") is not True:
                    continue
                walk((condition.get("properties") or {}).get("expression"))
        return tuple(sorted(paths - _CALL_SCOPED_FACT_KEYS))

    def _grant_binding(
        self, state_scope: Iterable[str] | None = None,
    ) -> dict[str, Any]:
        """Current machine-owned grant binding (campaign + ruleset version +
        graph generation + canonical state revision).

        With no separate state-revision provider the revision degrades to a
        digest of the fact set. Taken over ALL facts that made every grant in
        the turn die whenever anything moved anywhere: settling one Sanity
        check voided the combat and chase cards the Keeper was holding, and it
        had to re-ask for them. Measured 2026-09-02 r35, two of three lanes,
        two or three wasted round trips each against a 180s turn budget.

        Scoped to the paths the grant's own hard gates read, the binding still
        says exactly what it always meant -- "the reason these cards were
        offered still holds" -- and says it about the right facts. The turn
        context keys are untouched, so a card still cannot outlive its turn,
        phase or player-turn epoch; only same-turn cross-family noise stops
        counting.
        """
        facts = self._facts_provider() if self._facts_provider is not None else {}
        if self._state_revision_provider is not None:
            revision = self._state_revision_provider()
        elif state_scope is not None:
            scoped = {
                key: facts.get(key) for key in sorted(state_scope)
            }
            revision = f"sha256:{_json_digest(scoped)}"
        else:
            state_facts = {
                key: value for key, value in facts.items()
                if key not in _CALL_SCOPED_FACT_KEYS
            }
            revision = f"sha256:{_json_digest(state_facts)}"
        binding = {
            "campaign_id": self._campaign_id,
            "ruleset_id": self._ruleset_id,
            "ruleset_version": self._ruleset_version,
            "graph_generation": self._graph_generation,
            "state_revision": str(revision) if revision is not None else None,
        }
        if self._grant_context_provider is not None:
            provided = self._grant_context_provider()
            if isinstance(provided, Mapping):
                for key in sorted(_GRANT_CONTEXT_KEYS):
                    if key in provided:
                        binding[key] = deepcopy(provided[key])
        return binding

    def _issue_card_grant(
        self,
        cards: list[dict[str, Any]],
        *,
        source_decision_id: str | None = None,
    ) -> dict[str, Any]:
        """Issue one machine-attached card grant for a projected card set.

        The grant is recorded in this runtime's issuance registry; the copy
        returned to the host is only a handle.  ``settle()`` validates against
        the registry copy, so model-authored or tampered grant fields are
        ignored (fail closed)."""
        self._grant_sequence += 1
        family = str(cards[0].get("family") or "") if cards else ""
        decision_refs = sorted({str(card["decision_ref"]) for card in cards})
        scope = self._gating_fact_paths(decision_refs)
        grant_id = f"card-grant:{self._ruleset_id}:{family or 'unscoped'}:{self._grant_sequence}"
        grant = {
            "contract_id": CARD_GRANT_CONTRACT_ID,
            "schema_version": CARD_GRANT_SCHEMA_VERSION,
            "grant_id": grant_id,
            "binding": self._grant_binding(scope),
            "decision_refs": decision_refs,
            # Host-internal: the paths this grant's revision was taken over, so
            # validation recomputes the same digest instead of the whole set.
            "state_scope": list(scope),
        }
        if isinstance(source_decision_id, str) and source_decision_id:
            # Host-only continuation provenance. Public card projection never
            # exposes grants; the next settle uses this to hydrate the exact
            # canonical source receipt after process restart.
            grant["source_decision_id"] = source_decision_id
        self._grants[grant_id] = deepcopy(grant)
        return deepcopy(grant)

    def _check_card_grant(
        self,
        grant: Mapping[str, Any] | None,
        decision_ref: str,
    ) -> dict[str, Any] | None:
        """Return a stale-grant failure envelope, or None when the grant is live.

        Fail-closed rules (spec §8.6/§15): a missing grant, a grant this
        runtime did not issue (forged/unknown), a grant whose binding no
        longer matches current state (``rule_decision_stale``), or a
        decision_ref the live grant does not cover — none may reach resolver
        invocation."""
        if not isinstance(grant, Mapping) or not isinstance(grant.get("grant_id"), str) \
                or not grant.get("grant_id"):
            return self._stale_envelope(
                decision_ref, "missing_card_grant",
                "a machine-issued card grant is required (context() -> settle())",
            )
        stored = self._grants.get(str(grant["grant_id"]))
        if stored is None:
            return self._stale_envelope(
                decision_ref, "unrecognized_card_grant",
                "the grant was not issued by this runtime instance; "
                "forged or expired grants are rejected",
            )
        current = self._grant_binding(stored.get("state_scope"))
        drifted = [
            key for key in sorted(stored["binding"])
            if stored["binding"].get(key) != current.get(key)
        ]
        if drifted:
            return self._stale_envelope(
                decision_ref, "grant_binding_mismatch",
                f"card grant binding no longer matches current state: {', '.join(drifted)}",
                drifted=drifted,
            )
        if decision_ref not in (stored.get("decision_refs") or []):
            return self._stale_envelope(
                decision_ref, "decision_not_in_grant",
                f"decision {decision_ref!r} was not covered by the live card grant",
            )
        return None

    def _stale_envelope(
        self,
        decision_ref: str,
        reason: str,
        message: str,
        **extra: Any,
    ) -> dict[str, Any]:
        """Superseded card grant (spec §15): fail closed, refresh cards when safe."""
        failure: dict[str, Any] = {
            "code": "rule_decision_stale",
            "reason": reason,
            "message": message,
        }
        failure.update(extra)
        refreshed: list[dict[str, Any]] = []
        refreshed_grant: dict[str, Any] | None = None
        family = ""
        node = self._nodes.get(decision_ref)
        if node is not None:
            family = str((node.get("properties") or {}).get("family_id") or "")
        try:
            refreshed_result = self.context({"family": family} if family else None)
            refreshed = refreshed_result.get("cards") or []
            refreshed_grant = refreshed_result.get("card_grant")
        except Exception:
            refreshed = []
        envelope: dict[str, Any] = {
            "schema_version": self.SCHEMA_VERSION,
            "decision_ref": decision_ref,
            "family": family,
            "status": "rule_decision_stale",
            "failure": failure,
            "refreshed_cards": refreshed[:8],
        }
        if refreshed_grant is not None:
            envelope["refreshed_card_grant"] = refreshed_grant
        return envelope

    def stale_decision_envelope(
        self,
        decision_ref: str,
        reason: str,
        message: str,
        **extra: Any,
    ) -> dict[str, Any]:
        """Public route to the same fail-closed refresh envelope settle() builds.

        Consumer: the toolbox ``rules.settle`` dispatcher, which pre-checks
        ``latest_grant_covering()`` and therefore short-circuits *before*
        ``settle()`` can reach ``_check_card_grant`` -> ``_stale_envelope``.
        Without this the host raised a terminal ``rule_decision_stale`` while
        the runtime was one call away from the refreshed cards that name the
        way out.
        """
        return self._stale_envelope(decision_ref, reason, message, **extra)

    def family_ownership(self, family: str) -> tuple[str, str]:
        return resolve_family_ownership(
            self._ruleset_id,
            family,
            manifest=self._package_manifest,
            graph=self._graph,
            graph_manifest=self._graph_manifest,
        )

    def _recorded_exclusions(self) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        promo = (self._graph_manifest or {}).get("family_promotion_eligibility") or {}
        if not isinstance(promo, Mapping):
            return rows
        for family_row in promo.values():
            if not isinstance(family_row, Mapping):
                continue
            for exclusion in family_row.get("shadow_exclusions") or []:
                if isinstance(exclusion, Mapping):
                    rows.append(dict(exclusion))
        return rows

    def _exception_expression(
        self,
        exclusion: Mapping[str, Any],
        exception_node: Mapping[str, Any] | None,
    ) -> Any:
        if exception_node is not None:
            node_id = str(exception_node.get("node_id") or "")
            gated = self._conditions_for(node_id) if node_id else []
            expressions = [
                (condition.get("properties") or {}).get("expression")
                for condition in gated
            ]
            expressions = [expr for expr in expressions if isinstance(expr, dict)]
            if len(expressions) == 1:
                return expressions[0]
            if len(expressions) > 1:
                return {"op": "all", "of": expressions}
            props = exception_node.get("properties") or {}
            expr = props.get("expression") if isinstance(props, Mapping) else None
            if isinstance(expr, dict):
                return expr
        when = exclusion.get("when")
        return when if isinstance(when, dict) else None

    def _exception_evaluations_for(
        self, decision_ref: str, facts: Mapping[str, Any],
    ) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        for exclusion in self._recorded_exclusions():
            if exclusion.get("decision_ref") != decision_ref:
                continue
            exception_ref = exclusion.get("exception_ref")
            row: dict[str, Any] = {"decision_ref": decision_ref}
            if not isinstance(exception_ref, str) or not exception_ref:
                row.update({
                    "status": "unevaluated",
                    "reason": "malformed_expression",
                    "exception_ref": "",
                })
                rows.append(row)
                continue
            row["exception_ref"] = exception_ref
            node = self._nodes.get(exception_ref)
            expression = self._exception_expression(exclusion, node)
            status, reason = classify_exception_condition(expression, facts)
            row["status"] = status
            if reason:
                row["reason"] = reason
            rows.append(row)
        return rows

    def _surface_exceptions(
        self, decision_ref: str, facts: Mapping[str, Any],
    ) -> tuple[list[str], list[dict[str, Any]], list[dict[str, Any]]]:
        """Return (active refs, unevaluated markers, host-internal findings).

        Matched exceptions and unparseable recorded conditions both surface.
        Incomplete live facts on a well-formed condition stay inactive.
        """
        active: list[str] = []
        unevaluated: list[dict[str, Any]] = []
        findings: list[dict[str, Any]] = []
        for row in self._exception_evaluations_for(decision_ref, facts):
            status = row.get("status")
            ref = row.get("exception_ref")
            if status == "matched" and isinstance(ref, str) and ref:
                active.append(ref)
            elif status == "unevaluated":
                marker = {
                    "exception_ref": ref if isinstance(ref, str) else "",
                    "reason": str(row.get("reason") or "malformed_expression"),
                    "evaluation": "unevaluated",
                }
                unevaluated.append(marker)
                if isinstance(ref, str) and ref:
                    active.append(ref)
                findings.append({
                    "code": "exception_condition_unevaluated",
                    "exception_ref": ref if isinstance(ref, str) and ref else None,
                    "decision_ref": decision_ref,
                    "reason": marker["reason"],
                })
        return sorted(set(active)), unevaluated, findings

    def _active_exceptions_for(
        self, decision_ref: str, facts: Mapping[str, Any],
    ) -> list[str]:
        active, _unevaluated, _findings = self._surface_exceptions(
            decision_ref, facts,
        )
        return active

    def _facts_for_decision(
        self, selected: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        facts = dict(self._facts_provider() or {}) if self._facts_provider is not None else {}
        if self._ruleset_adapter is not None:
            augment = getattr(self._ruleset_adapter, "augment_facts", None)
            if callable(augment):
                provided = augment(self, selected, facts)
                if isinstance(provided, Mapping):
                    facts = dict(provided)
        return facts

    def _uncompiled_scope_refs(self) -> set[str]:
        refs: set[str] = set()
        promo = (self._graph_manifest or {}).get("family_promotion_eligibility") or {}
        if isinstance(promo, Mapping):
            for row in promo.values():
                if not isinstance(row, Mapping):
                    continue
                for exclusion in row.get("shadow_exclusions") or []:
                    if not isinstance(exclusion, Mapping):
                        continue
                    for key in ("exception_ref", "exclusion_id"):
                        value = exclusion.get(key)
                        if isinstance(value, str) and value:
                            refs.add(value)
        for node_id, node in self._nodes.items():
            if node.get("node_kind") == "exception":
                refs.add(node_id)
        return refs

    def _is_uncompiled_scope(self, decision_ref: str) -> bool:
        if decision_ref in self._uncompiled_scope_refs():
            return True
        node = self._nodes.get(decision_ref)
        if node is None:
            return False
        return node.get("node_kind") != "decision"

    def _unmet_availability(
        self,
        decision_ref: str,
        facts: Mapping[str, Any] | None = None,
    ) -> list[dict[str, Any]]:
        """The leaf availability conditions this decision fails right now.

        Reports the fact path, what it holds and what the graph asks for --
        never a bare "not applicable", which names nothing the Keeper can act
        on or narrate around.

        `facts` is the evaluation the caller already performed. `context()`
        passes the facts its own cards were judged against -- the adapter's
        `augment_facts` derives `magic.spell.known` and
        `magic.learn.source-available` from the question's `semantic_inputs`,
        so re-reading the raw provider here would explain a withheld card
        against a different world than the one that withheld it: reporting
        `magic.spell.known is None` where applicability saw False. Callers
        with no evaluation in hand (`explain_missing_grant`) omit it and get
        the raw canonical facts, which is what they had before.
        """
        if facts is None:
            facts = (
                dict(self._facts_provider() or {})
                if self._facts_provider is not None else {}
            )
        unmet: list[dict[str, Any]] = []
        seen: set[str] = set()

        def walk(expression: Any, negated: bool = False) -> None:
            if not isinstance(expression, Mapping):
                return
            children = _condition_children(expression)
            if children is not None:
                flipped = negated != (expression.get("op") == "not")
                for child in children:
                    walk(child, flipped)
                return
            path = expression.get("path")
            if not isinstance(path, str) or path in seen:
                return
            # Under a `not`, a leaf that evaluates True is the one holding the
            # gate shut. Testing the raw leaf regardless of negation skipped
            # exactly the failing condition: `not exists actor.conditions.dying`
            # reported nothing while a dying investigator was what blocked
            # first aid.
            satisfied = evaluate_condition(expression, facts)
            if satisfied is (False if negated else True):
                return
            seen.add(path)
            unmet.append({
                "path": path,
                "op": expression.get("op"),
                "negated": negated,
                "actual": facts.get(path),
                "expected": expression.get("value"),
                "requirement": _requirement_phrase(expression, negated),
            })

        # Only hard gates decide whether a card is offered -- `applicability`
        # evaluates nothing else. Walking every condition made this method
        # blame the intent trigger, which marks a card as answering the
        # declared intent and deliberately never gates it: it reported
        # decision:coc7:combat:flee as unavailable for want of
        # `intent.action_kind` while that very card was in the Keeper's hand.
        for condition in self._conditions_for(decision_ref):
            if condition.get("hard_gate") is not True:
                continue
            walk((condition.get("properties") or {}).get("expression"))
        return unmet

    def explain_missing_grant(self, decision_ref: str) -> dict[str, Any]:
        """Why `latest_grant_covering` found nothing.

        The caller's pre-check only reported "no live grant", which reads the
        same whether the Keeper settled a decision it never asked cards for or
        whether a grant existed and its binding moved underneath it. Those
        need different answers — refresh this family, versus canonical state
        advanced mid-turn — and the runtime already holds both facts.
        """
        covering = [
            grant for grant in self._grants.values()
            if decision_ref in (grant.get("decision_refs") or [])
        ]
        if not covering:
            # Usually the decision was never offered, and usually that is
            # because its own availability conditions do not hold. Saying only
            # "no grant" sends the Keeper to rules.context for a card that
            # will not be there either. Measured 2026-09-02: a Keeper settled
            # decision:coc7:chase:end three times across two lanes while chase
            # context offered only `move` -- a chase ends when someone escapes
            # or is caught, never on the Keeper's say-so, and nothing said so.
            unmet = self._unmet_availability(decision_ref)
            if unmet:
                return {
                    "reason": "decision_not_available",
                    "detail": (
                        "this decision is not currently available, so no card "
                        "was offered for it: "
                        + "; ".join(
                            f"{row['path']} is {row['actual']!r}, "
                            f"needs {row['requirement']}"
                            for row in unmet
                        )
                    ),
                    "unmet": unmet,
                }
            return {
                "reason": "no_grant_for_decision",
                "detail": (
                    "no card grant issued this turn covers this decision; "
                    "rules.context for its family issues one"
                ),
            }
        live = [
            grant for grant in covering
            if (grant.get("binding") or {})
            == self._grant_binding(grant.get("state_scope"))
        ]
        if live:
            # The caller only asks after its own lookup failed, so a covering
            # grant whose binding matches NOW means the two reads disagreed —
            # canonical state moved between them, or moved and moved back.
            # Say that instead of inventing a drift with an empty key list,
            # which is what the first version of this method reported.
            return {
                "reason": "grant_binding_unstable",
                "detail": (
                    "a covering grant matches the binding read now but did not "
                    "at lookup; canonical state moved between the two reads"
                ),
            }
        drifted = sorted({
            key
            for grant in covering
            for current in (self._grant_binding(grant.get("state_scope")),)
            for key in set(grant.get("binding") or {}) | set(current)
            if (grant.get("binding") or {}).get(key) != current.get(key)
        })
        return {
            "reason": "grant_binding_drifted",
            "drifted": drifted,
            "detail": (
                "a grant covering this decision exists but canonical state "
                "moved since it was issued"
            ),
        }

    def latest_grant_covering(self, decision_ref: str) -> dict[str, Any] | None:
        for grant_id in reversed(list(self._grants)):
            grant = self._grants[grant_id]
            if decision_ref not in (grant.get("decision_refs") or []):
                continue
            if grant.get("binding") != self._grant_binding(grant.get("state_scope")):
                continue
            return deepcopy(grant)
        return None

    def _family_status(self, family: str | None) -> list[dict[str, Any]]:
        coverage = (self._graph.get("coverage") or {})
        families = [family] if family is not None else sorted(coverage)
        rows: list[dict[str, Any]] = []
        for fam in families:
            owner, surface = self.family_ownership(fam)
            rows.append({
                "family": fam,
                "coverage": coverage.get(fam, "unresolved"),
                "runtime_owner": owner,
                "legacy_surface": surface,
            })
        return rows

    # -- context (spec §8.3/§8.4) -------------------------------------------
    def context(self, question: Mapping[str, Any] | None = None) -> dict[str, Any]:
        if question is None:
            return {
                "schema_version": self.SCHEMA_VERSION,
                "status": "family_status",
                "family": None,
                "cards": [],
                "family_status": self._family_status(None),
            }
        question = dict(question)
        facts = self._facts_for_decision(question)
        family = question.get("family")
        if not isinstance(family, str) or not family:
            return {
                "schema_version": self.SCHEMA_VERSION,
                "status": "no_candidate_in_compiled_scope",
                "family": None,
                "cards": [],
                "family_status": self._family_status(None),
                "reason": "question must name a compiled rule family",
            }
        wanted = question.get("selected_affordance_ids")
        requested: list[str] | None = None
        if isinstance(wanted, list):
            requested = [str(ref) for ref in wanted if isinstance(ref, str)]
        candidates = [
            node for node in self.decision_nodes(family)
            if (
                node.get("audience") == self._projection_audience
                and (
                    requested is None
                    or str(node.get("node_id")) in requested
                )
            )
        ]
        cards: list[dict[str, Any]] = []
        missing: list[str] = []
        optional_rule_gates: list[dict[str, Any]] = []
        withheld: list[dict[str, Any]] = []
        for node in candidates:
            node_id = str(node["node_id"])
            if node_id not in self._nodes:
                continue
            if requested is not None and node_id not in requested:
                continue
            card = self._card(node_id, facts)
            if card["applicability"] != "applicable":
                missing.append(node_id)
                if card.get("disabled_by_optional_rule"):
                    # A table ruling, not a shut state fact. It is reported
                    # under its own key and deliberately NOT repeated as
                    # `withheld`: the two have different remedies, and only
                    # one of them can change during this campaign.
                    optional_rule_gates.append({
                        "decision_ref": node_id,
                        **card["disabled_by_optional_rule"],
                    })
                    continue
                withheld.append({
                    "decision_ref": node_id,
                    "label": card["label"],
                    "unmet": self._unmet_availability(node_id, facts),
                })
                continue
            cards.append(card)
            if len(cards) >= 8:
                break
        cards = sorted(cards, key=lambda card: str(card["decision_ref"]))
        if requested is not None:
            unresolved = sorted(set(requested) - {card["decision_ref"] for card in cards})
            if unresolved:
                return {
                    "schema_version": self.SCHEMA_VERSION,
                    "status": "no_candidate_in_compiled_scope",
                    "family": family,
                    "cards": [],
                    "family_status": self._family_status(family),
                    "unresolved": unresolved,
                    "reason": "selected decision refs are not current applicable candidates",
                }
        status = "ok" if cards else "no_candidate_in_compiled_scope"
        findings: list[dict[str, Any]] = []
        for card in cards:
            for marker in card.get("unevaluated_exceptions") or []:
                if not isinstance(marker, Mapping):
                    continue
                findings.append({
                    "code": "exception_condition_unevaluated",
                    "exception_ref": marker.get("exception_ref") or None,
                    "decision_ref": card.get("decision_ref"),
                    "reason": marker.get("reason"),
                })
        result: dict[str, Any] = {
            "schema_version": self.SCHEMA_VERSION,
            "status": status,
            "family": family,
            "cards": cards,
            "family_status": self._family_status(family),
        }
        if optional_rule_gates:
            # The Keeper sees which cards a house rule / session ruling took
            # off the table, so a missing Luck card reads as a ruling, not
            # as a runtime hole.
            result["disabled_by_optional_rules"] = sorted(
                optional_rule_gates, key=lambda row: str(row["decision_ref"]),
            )
        if withheld:
            # Why the hand is the size it is. An empty family answered
            # `no_candidate_in_compiled_scope` with nothing else: measured in
            # run r69, two lanes that had seeded a spell teacher precisely to
            # open `magic` were handed 0 cards on every call and told only
            # that there were 0. The Keeper settled blind, and the refusal --
            # one call later, after the damage -- named the shut gate
            # ("magic.spell.known is None, needs to equal True") that this
            # call already knew. Same `unmet` row shape as
            # `explain_missing_grant`, so refusal and offer speak one
            # vocabulary rather than two.
            #
            # Attached whether or not cards were offered: 2-of-6 and 6-of-6
            # are different hands and read identically without it. Only
            # decisions this call actually evaluated appear -- the loop stops
            # at 8 cards, and a decision never reached was not withheld.
            result["withheld"] = _bounded_withheld(withheld)
        if findings:
            result["findings"] = findings
        if cards:
            # Machine-attached card grant (spec §8.5/§8.6): the projected card
            # set bound to campaign + ruleset version + graph generation +
            # canonical state revision. settle() accepts ONLY this object.
            result["card_grant"] = self._issue_card_grant(
                cards,
                source_decision_id=(
                    str(question.get("_host_source_decision_id") or "") or None
                ),
            )
        if str(question.get("kind") or "procedure") == "lookup":
            lookup = None
            if self._ruleset_adapter is not None:
                handler = getattr(self._ruleset_adapter, "context_lookup", None)
                if callable(handler):
                    lookup = handler(self, question, family, facts)
            if isinstance(lookup, Mapping):
                result.update(lookup)
            else:
                result.update({
                    "status": "no_candidate_in_compiled_scope",
                    "lookup": None,
                    "reason": "the active ruleset has no compiled lookup adapter",
                })
        return result

    # -- settle (spec §8.6/§8.7) --------------------------------------------
    def _undeclared_slot_failure(
        self,
        decision_ref: str,
        family: str,
        slots: list[dict[str, Any]],
        offending: list[str],
        *,
        origin: str,
    ) -> dict[str, Any]:
        """The one refusal for inputs a decision does not declare.

        Two callers reach it and they had drifted apart. The model path named
        every offending key AND the slots the Keeper may fill; the host path
        named one key and nothing else -- "host-locked input 'chase_id' is not
        a declared slot", no `declared_slots`, no idea what the decision does
        take. `unknown_semantic_input` projects as the Keeper's own argument
        error with `correct_model_arguments`, so a Keeper handed the second
        form guesses, is refused again, and `nonretryable_repeat_blocked`
        walls off the repeat: measured 2026-09-01 across the sanity, chase and
        combat lanes (r22/r23 chase, clean-1/clean-3 sanity), whole turns
        spent on it. One builder, so the two cannot drift again.

        `origin` decides which instruction is true. "stop sending it" and "you
        may not set it" are different answers, and the host path's key was
        never the Keeper's to send in the first place.

        What is advertised is the SEMANTIC ownerships only. Naming a slot the
        Keeper is forbidden to set is the same defect wearing a different hat:
        `settle()` refuses a model-supplied host-locked or resolver-owned slot
        with `locked_input_override`, so "this decision takes X" for such an X
        invites exactly that refusal. The list was previously everything not
        literally `host-locked`, which let `resolver-owned` through.
        """
        declared = sorted(slot["name"] for slot in slots)
        required = sorted(
            slot["name"] for slot in slots
            if slot["ownership"] in _REQUIRED_SEMANTIC_OWNERSHIPS
        )
        optional = sorted(
            slot["name"] for slot in slots
            if slot["ownership"] in _SEMANTIC_SLOT_OWNERSHIPS
            and slot["ownership"] not in _REQUIRED_SEMANTIC_OWNERSHIPS
        )
        model_owned = sorted(
            slot["name"] for slot in slots
            if slot["ownership"] in _SEMANTIC_SLOT_OWNERSHIPS
        )
        host_owned = sorted(
            slot["name"] for slot in slots
            if slot["ownership"] in _LOCKED_SLOT_OWNERSHIPS
        )
        if required and optional:
            takes = ", ".join(required) + " (optional: " + ", ".join(optional) + ")"
        elif required:
            takes = ", ".join(required)
        elif optional:
            takes = "only optional input: " + ", ".join(optional)
        else:
            takes = (
                "no semantic input at all (every slot is filled by the host)"
            )
        keys = ", ".join(repr(key) for key in offending)
        if origin == "host":
            message = (
                "host-owned inputs are not declared slots of this decision: "
                + keys
                + "; the host fills these, not the Keeper, so no change to "
                "semantic_inputs clears it; this decision takes " + takes
            )
        else:
            message = (
                "not declared slots of this decision: " + keys
                + "; this decision takes " + takes
            )
        # Every list is plain strings under a non-identity key on purpose.
        # A map keyed by slot names would be keyed by identity-bearing field
        # names (`candidate_ref`, `actor_id`), and the host's own projection
        # holds the VALUES of such keys to the ref grammar -- ownership words
        # are not refs, so the map would arrive empty. That is the defect
        # tests/pi/chase-candidate-guidance-survives.mjs records for
        # `chase_candidate_invalid.requires`.
        return {
            "failure": {
                "code": "unknown_semantic_input",
                "message": message,
                "declared_slots": declared,
                "model_owned_slots": model_owned,
                "required_semantic_slots": required,
                "optional_semantic_slots": optional,
                "host_owned_slots": host_owned,
                "unknown": list(offending),
                "input_origin": origin,
                "decision_ref": decision_ref,
                "family": family,
            }
        }

    def _compile_plan(
        self,
        decision_ref: str,
        semantic_inputs: Mapping[str, Any],
        facts: Mapping[str, Any] | None = None,
        host_locked: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Compile one decision into an immutable plan (never executes)."""
        facts = facts if facts is not None else (
            self._facts_provider() if self._facts_provider is not None else {}
        )
        node = self._nodes.get(decision_ref)
        if node is None or node.get("node_kind") != "decision" or self._is_uncompiled_scope(decision_ref):
            return {
                "failure": {
                    "code": "no_candidate_in_compiled_scope",
                    "message": f"decision {decision_ref!r} is not in the compiled graph",
                }
            }
        family = (node.get("properties") or {}).get("family_id") or ""
        applicable, _ = self.applicability(decision_ref, facts)
        if not applicable:
            return {
                "failure": {
                    "code": "rule_decision_not_applicable",
                    "message": "the decision's hard-gate conditions do not hold for current state",
                    "decision_ref": decision_ref,
                    "family": family,
                }
            }
        capability = self._invokes(decision_ref)
        if capability is None:
            return {
                "failure": {
                    "code": "unsupported_ruleset_operation",
                    "message": "the decision does not invoke a compiled capability",
                    "decision_ref": decision_ref,
                    "family": family,
                }
            }
        capability_props = capability.get("properties") or {}
        resolver_capability = capability_props.get("resolver_capability")
        if self._resolver_index is not None and not isinstance(resolver_capability, str):
            return {
                "failure": {
                    "code": "unsupported_ruleset_operation",
                    "message": "capability node has no resolver_capability identity",
                    "decision_ref": decision_ref,
                    "family": family,
                }
            }
        if (
            self._resolver_index is not None
            and isinstance(resolver_capability, str)
            and resolver_capability not in self._resolver_index
        ):
            return {
                "failure": {
                    "code": "unsupported_ruleset_operation",
                    "message": (
                        f"capability {resolver_capability!r} is not in the "
                        "active ruleset's public resolver index"
                    ),
                    "decision_ref": decision_ref,
                    "family": family,
                }
            }
        implementation = (node.get("properties") or {}).get("implementation")
        slots = self._slots_for(decision_ref)
        slot_names = {slot["name"] for slot in slots}
        # Combined-check shares the 56-key union schema with ordinary-check.
        # Keepers copy difficulty_basis/skill/characteristic from that union
        # onto the combined card (r79 cmb4) and the graph rejects them as
        # undeclared. Those three are ordinary-check slots, not invented
        # keys; drop them here so the declared combined slots can settle.
        if decision_ref.endswith(":combined-check") and isinstance(
            semantic_inputs, Mapping
        ):
            semantic_inputs = {
                key: value for key, value in semantic_inputs.items()
                if key not in {"difficulty_basis", "skill", "characteristic"}
            }
        # No generic arguments bag: an undeclared semantic input is rejected
        # rather than forwarded into the payload. Every offending key at once
        # -- one key per refusal made a Keeper strip its arguments one at a
        # time, four round trips for one decision on 2026-09-02.
        unknown = sorted(key for key in semantic_inputs if key not in slot_names)
        if unknown:
            return self._undeclared_slot_failure(
                decision_ref, family, slots, unknown, origin="model",
            )
        missing = sorted(
            slot["name"] for slot in slots
            if slot["ownership"] in _REQUIRED_SEMANTIC_OWNERSHIPS
            and slot["name"] not in semantic_inputs
        )
        if missing:
            return {
                "failure": {
                    "code": "missing_semantic_input",
                    "message": "required semantic inputs are missing",
                    "missing": missing,
                    "decision_ref": decision_ref,
                    "family": family,
                }
            }
        host_context: dict[str, Any] = {}
        if isinstance(host_locked, Mapping):
            host_context.update(
                {str(key): deepcopy(value) for key, value in host_locked.items()}
            )
        if self._host_locked_provider is not None:
            provided = self._host_locked_provider(decision_ref)
            if isinstance(provided, Mapping):
                for key, value in provided.items():
                    host_context.setdefault(str(key), deepcopy(value))
        # The host binding overshot this decision's declarations. Same builder
        # as the model path above, with `origin="host"`: the Keeper is told the
        # keys are host-filled and that its own arguments cannot clear them,
        # instead of being handed a bare name and the `correct_model_arguments`
        # projection for a value it never sent.
        host_unknown = sorted(
            key for key in host_context if key not in slot_names
        )
        if host_unknown:
            return self._undeclared_slot_failure(
                decision_ref, family, slots, host_unknown, origin="host",
            )
        payload: dict[str, Any] = {}
        if isinstance(implementation, dict):
            for name, value in (implementation.get("payload_constants") or {}).items():
                payload[str(name)] = deepcopy(value)
        for slot in slots:
            name = slot["name"]
            if slot["ownership"] in _SEMANTIC_SLOT_OWNERSHIPS:
                if name in semantic_inputs:
                    payload[name] = deepcopy(semantic_inputs[name])
            elif slot["ownership"] in _LOCKED_SLOT_OWNERSHIPS:
                if name in host_context:
                    payload[name] = deepcopy(host_context[name])
        command: dict[str, Any] = {
            "kind": "resolver-invocation",
            "phase": "resolve",
            "payload": payload,
        }
        if isinstance(implementation, dict):
            command["kind"] = str(implementation.get("kind") or command["kind"])
            command["phase"] = str(implementation.get("phase") or command["phase"])
        capability_ref = str(capability.get("node_id"))
        rule_refs = self._rules_for(decision_ref)
        effects = self._effects_for(decision_ref)
        pending_choices = self._pending_choices_for(decision_ref)
        continuations = self._continuations_for(decision_ref)
        effect_visibility = "public"
        for effect_id in effects:
            effect = self._nodes.get(effect_id)
            vis = (effect.get("properties") or {}).get("visibility") or (effect or {}).get("visibility")
            if vis in {"keeper-only", "concealed-result"}:
                effect_visibility = str(vis)
                break
        plan = _freeze({
            "schema_version": self.SCHEMA_VERSION,
            "decision_ref": decision_ref,
            "family": family,
            "capability": {
                "ref": capability_ref,
                "adapter": capability_props.get("adapter") or "resolver",
                "resolver_capability": resolver_capability,
            },
            "command": command,
            "rule_refs": rule_refs,
            "source_refs": self._source_refs_for(rule_refs),
            "resource_effects": effects,
            "visibility": effect_visibility,
            "pending_choices": pending_choices,
            "next_decisions": continuations,
        })
        return {"plan": plan, "failure": None}

    def settle(
        self,
        selected: Mapping[str, Any],
        decision_id: str,
        card_grant: Mapping[str, Any] | None = None,
        *,
        executor: Callable[..., Any] | None = None,
    ) -> dict[str, Any]:
        """Compile one selected decision (spec §8.6); execute when graph-owned.

        ``card_grant`` is machine-attached: the host passes the exact grant
        object ``context()`` issued.  A missing, forged, stale, or
        non-covering grant fails closed with ``rule_decision_stale`` before
        any compile work (spec §8.5/§8.6/§15).

        Graph-owned families invoke ``executor(plan, decision_id, selected)``
        which MUST be the existing resolver/subsystem adapter.  Shadow and
        legacy families still return ``execution: deferred-to-legacy``.
        """
        if not isinstance(selected, Mapping):
            return {
                "schema_version": self.SCHEMA_VERSION,
                "status": "invalid_decision_selection",
                "failure": {"code": "invalid_decision_selection",
                             "message": "selected decision must be an object"},
            }
        decision_ref = selected.get("decision_ref")
        semantic_inputs = selected.get("semantic_inputs")
        if not isinstance(decision_ref, str) or not decision_ref:
            return {
                "schema_version": self.SCHEMA_VERSION,
                "status": "no_candidate_in_compiled_scope",
                "failure": {"code": "no_candidate_in_compiled_scope",
                            "message": "a semantic decision_ref is required"},
            }
        context_only = (
            self._ruleset_adapter is not None
            and callable(getattr(self._ruleset_adapter, "is_context_only", None))
            and self._ruleset_adapter.is_context_only(decision_ref)
        )
        if context_only:
            return {
                "schema_version": self.SCHEMA_VERSION,
                "decision_ref": decision_ref,
                "decision_id": decision_id,
                "status": "no_candidate_in_compiled_scope",
                "failure": {
                    "code": "no_candidate_in_compiled_scope",
                    "message": (
                        f"decision {decision_ref!r} is a context-only lookup; "
                        "use rules.context kind=lookup, never rules.settle"
                    ),
                },
            }
        if self._is_uncompiled_scope(decision_ref):
            return {
                "schema_version": self.SCHEMA_VERSION,
                "decision_ref": decision_ref,
                "decision_id": decision_id,
                "status": "no_candidate_in_compiled_scope",
                "failure": {
                    "code": "no_candidate_in_compiled_scope",
                    "message": (
                        f"decision {decision_ref!r} is an uncompiled exclusion "
                        "or exception scope; the KP treats it as ordinary long-tail"
                    ),
                },
            }
        gate = self.optional_rule_gate(decision_ref)
        if gate is not None:
            return {
                "schema_version": self.SCHEMA_VERSION,
                "decision_ref": decision_ref,
                "decision_id": decision_id,
                "status": "rule_conflict" if gate.get("conflict") else "optional_rule_disabled",
                "failure": {
                    "code": "rule_conflict" if gate.get("conflict") else "optional_rule_disabled",
                    "message": (
                        f"decision {decision_ref!r} belongs to optional rule "
                        f"{gate.get('option_id')!r}: "
                        + (
                            "conflicting confirmed patches "
                            + ", ".join(
                                str(row.get("patch_id")) for row in gate.get("conflicting") or []
                            )
                            if gate.get("conflict") else
                            f"disabled by {gate.get('layer')} {gate.get('decided_by')!r}"
                        )
                    ),
                },
                "optional_rule": gate,
            }
        facts = self._facts_for_decision(selected)
        active_exceptions, unevaluated_exceptions, exception_findings = (
            self._surface_exceptions(decision_ref, facts)
        )
        if active_exceptions:
            family = ""
            node = self._nodes.get(decision_ref)
            if node is not None:
                family = str((node.get("properties") or {}).get("family_id") or "")
            if unevaluated_exceptions:
                message = (
                    "a recorded exception condition is unevaluated; compiled "
                    "ordinary semantics are not applied"
                )
            else:
                message = (
                    "a recorded uncompiled exception matches the live "
                    "situation; compiled ordinary semantics are not applied"
                )
            failure: dict[str, Any] = {
                "code": "no_candidate_in_compiled_scope",
                "message": message,
                "active_exceptions": active_exceptions,
            }
            if unevaluated_exceptions:
                failure["unevaluated_exceptions"] = unevaluated_exceptions
            if exception_findings:
                failure["findings"] = exception_findings
            envelope: dict[str, Any] = {
                "schema_version": self.SCHEMA_VERSION,
                "decision_ref": decision_ref,
                "decision_id": decision_id,
                "family": family,
                "status": "no_candidate_in_compiled_scope",
                "active_exceptions": active_exceptions,
                "failure": failure,
            }
            if unevaluated_exceptions:
                envelope["unevaluated_exceptions"] = unevaluated_exceptions
            if exception_findings:
                envelope["findings"] = exception_findings
            return envelope
        # Fail-closed card-grant gate: never-projected and forged/stale
        # decision refs cannot reach compilation (spec §8.6 step 2).
        stale = self._check_card_grant(card_grant, decision_ref)
        if stale is not None:
            stale["decision_id"] = decision_id
            return stale
        if not isinstance(semantic_inputs, Mapping):
            semantic_inputs = {}
        # Fail closed when the model supplies a host-locked field directly.
        node = self._nodes.get(decision_ref)
        if node is not None:
            locked_names = {
                slot["name"] for slot in self._slots_for(decision_ref)
                if slot["ownership"] in _LOCKED_SLOT_OWNERSHIPS
            }
            overlap = sorted(set(semantic_inputs) & locked_names)
            if overlap:
                return {
                    "schema_version": self.SCHEMA_VERSION,
                    "decision_ref": decision_ref,
                    "family": (node.get("properties") or {}).get("family_id") or "",
                    "status": "locked_input_override",
                    "failure": {
                        "code": "locked_input_override",
                        "message": "model-supplied host-locked inputs are rejected",
                        "fields": overlap,
                    },
                }
        host_locked_extra: dict[str, Any] | None = None
        if self._ruleset_adapter is not None:
            prepare = getattr(self._ruleset_adapter, "prepare_settlement", None)
            if callable(prepare):
                prepared = prepare(self, decision_ref, decision_id, selected)
                if isinstance(prepared, Mapping):
                    failure_envelope = prepared.get("failure_envelope")
                    if isinstance(failure_envelope, Mapping):
                        return dict(failure_envelope)
                    candidate_locked = prepared.get("host_locked")
                    if isinstance(candidate_locked, Mapping):
                        host_locked_extra = dict(candidate_locked)
        result = self._compile_plan(
            decision_ref, semantic_inputs, facts=facts,
            host_locked=host_locked_extra,
        )
        if result["failure"] is not None:
            failure = result["failure"]
            return {
                "schema_version": self.SCHEMA_VERSION,
                "decision_ref": decision_ref,
                "decision_id": decision_id,
                "family": failure.get("family")
                or (node.get("properties") or {}).get("family_id") or "",
                "status": failure["code"],
                "failure": failure,
            }
        plan = result["plan"]
        family = plan["family"]
        cards: list[dict[str, Any]] = []
        for next_ref in list(plan["next_decisions"])[:8]:
            next_node = self._nodes.get(str(next_ref))
            if next_node is None or next_node.get("node_kind") != "decision":
                continue
            card = self._card(str(next_ref), facts)
            cards.append(card)
        cards = sorted(cards, key=lambda card: str(card["decision_ref"]))[:8]
        try:
            owner, _surface = self.family_ownership(str(family))
        except FamilyOwnershipMismatch as exc:
            return {
                "schema_version": self.SCHEMA_VERSION,
                "decision_ref": decision_ref,
                "decision_id": decision_id,
                "family": family,
                "status": "rules_graph_unavailable",
                "failure": {
                    "code": "rules_graph_unavailable",
                    "message": (
                        "family ownership artifacts disagree; no side is chosen "
                        "and there is no legacy fallback"
                    ),
                    "findings": list(exc.findings),
                },
            }
        envelope: dict[str, Any] = {
            "schema_version": self.SCHEMA_VERSION,
            "decision_ref": decision_ref,
            "decision_id": decision_id,
            "family": family,
            "status": "compiled",
            "rule_refs": list(plan["rule_refs"]),
            "settlement": {
                "existing_result_envelope": False,
                "execution": "deferred-to-legacy",
                "plan": plan,
            },
            "next_decisions": cards,
            "authority": "canonical-resolver-state-receipts",
        }
        if owner != "graph":
            return envelope
        if executor is None:
            return {
                "schema_version": self.SCHEMA_VERSION,
                "decision_ref": decision_ref,
                "decision_id": decision_id,
                "family": family,
                "status": "rules_graph_unavailable",
                "failure": {
                    "code": "rules_graph_unavailable",
                    "message": (
                        "graph-owned settlement requires the canonical "
                        "resolver/subsystem executor; no legacy fallback"
                    ),
                },
            }
        if self._ruleset_adapter is not None:
            settle_adapter = getattr(self._ruleset_adapter, "settle", None)
            adapted = settle_adapter(
                self, executor, plan, decision_id, selected, facts, envelope,
            ) if callable(settle_adapter) else None
            if adapted is not None:
                return adapted
        executed = executor(_thaw(plan), decision_id, selected)
        data = executed
        warnings: list[str] = []
        hints: list[str] = []
        if isinstance(executed, tuple):
            data = executed[0] if executed else None
            if len(executed) > 1 and isinstance(executed[1], list):
                warnings = list(executed[1])
            if len(executed) > 2 and isinstance(executed[2], list):
                hints = list(executed[2])
        envelope["status"] = "settled"
        envelope["settlement"] = {
            "existing_result_envelope": True,
            "execution": "canonical-resolver-subsystem",
            "plan": plan,
            "result": data,
        }
        if warnings:
            envelope["warnings"] = warnings
        if hints:
            envelope["hints"] = hints
        # The continuations were projected from the facts as they stood BEFORE
        # this settlement ran, and no grant covered them -- so the envelope
        # told the Keeper "bout-tick is what comes next" and the settle
        # pre-check then refused it as a decision no grant covered. Two
        # host-authored statements, opposite answers; measured 2026-09-02 r37,
        # once per lane, each costing a rules.context the Keeper had just been
        # told it did not need.
        #
        # Recomputed against the facts this settlement produced -- the bout it
        # opened is why bout-tick is offerable at all -- and granted, so the
        # card the envelope hands over is a card that settles.
        settled_facts = (
            self._facts_provider() if self._facts_provider is not None else {}
        )
        continued: list[dict[str, Any]] = []
        for next_ref in list(plan["next_decisions"])[:8]:
            next_node = self._nodes.get(str(next_ref))
            if next_node is None or next_node.get("node_kind") != "decision":
                continue
            applicable, _hard = self.applicability(str(next_ref), settled_facts)
            if not applicable:
                continue
            continued.append(self._card(str(next_ref), settled_facts))
        continued = sorted(continued, key=lambda card: str(card["decision_ref"]))
        envelope["next_decisions"] = continued
        if continued:
            self._issue_card_grant(continued, source_decision_id=decision_id)
        return envelope


# -- card ref table (transport shape, not a content cut) -------------------- #
#
# ``_rules_for`` binds a decision to every rule reachable through the
# capability it invokes, so sibling decisions in one family repeat almost the
# same ``rule_refs``/``source_refs`` arrays.  Measured on the production
# coc7 graph, combat's 8 cards carry 132 rule-ref occurrences over 22 distinct
# refs and 336 source-ref occurrences over 56 distinct refs: 21,346 of the
# block's 26,003 bytes are duplicated strings.  That pushed the whole
# ``rules.context`` result past the MCP inline cap, where it collapsed to an
# identity-only envelope and reached the Keeper as an error instead of cards.
#
# Hoisting the distinct refs into one envelope-level table and leaving
# zero-based indexes on each card keeps every ref the Keeper could previously
# read -- the indirection resolves inside the same payload -- while removing
# the duplication.  This is a transport shape, never a content cut.
CARD_REF_TABLE_RESOLUTION = (
    "card.rule_ref_ids and card.source_ref_ids are zero-based indexes into "
    "ref_table.rule_refs and ref_table.source_refs in this same result"
)


def hoist_card_ref_table(
    cards: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Replace per-card ref arrays with indexes into one envelope-level table.

    Returns ``(cards, ref_table)``.  Card order and every other field are
    preserved; ``rule_refs``/``source_refs`` become ``rule_ref_ids`` /
    ``source_ref_ids``.  Refs keep first-seen order so the projection stays
    deterministic for a deterministic card list.

    The ``isinstance(ref, str)`` guards are defensive, not a filter that can
    lose real refs: ``_rules_for`` returns ``sorted(str(...))`` and
    ``_source_refs_for`` already admits only ``str`` spans, so every ref the
    graph produces is a string.  The wire and the Pi identity projection
    re-validate the table's grammar independently.
    """
    rule_table: list[str] = []
    source_table: list[str] = []
    rule_index: dict[str, int] = {}
    source_index: dict[str, int] = {}
    projected: list[dict[str, Any]] = []
    for card in cards:
        if not isinstance(card, Mapping):
            continue
        row = {
            key: value for key, value in card.items()
            if key not in {"rule_refs", "source_refs"}
        }
        rule_ids: list[int] = []
        for ref in card.get("rule_refs") or []:
            if not isinstance(ref, str):
                continue
            if ref not in rule_index:
                rule_index[ref] = len(rule_table)
                rule_table.append(ref)
            rule_ids.append(rule_index[ref])
        source_ids: list[int] = []
        for ref in card.get("source_refs") or []:
            if not isinstance(ref, str):
                continue
            if ref not in source_index:
                source_index[ref] = len(source_table)
                source_table.append(ref)
            source_ids.append(source_index[ref])
        row["rule_ref_ids"] = rule_ids
        row["source_ref_ids"] = source_ids
        projected.append(row)
    ref_table = {
        "rule_refs": rule_table,
        "source_refs": source_table,
        "resolution": CARD_REF_TABLE_RESOLUTION,
    }
    return projected, ref_table


def resolve_card_refs(
    card: Mapping[str, Any], ref_table: Mapping[str, Any] | None,
) -> dict[str, list[str]]:
    """Inverse of :func:`hoist_card_ref_table` for one card.

    Consumers that want the flat arrays back (tests, exporters, any host that
    prefers inline refs) resolve them from the same payload.
    """
    rule_table = list((ref_table or {}).get("rule_refs") or [])
    source_table = list((ref_table or {}).get("source_refs") or [])
    return {
        "rule_refs": [
            rule_table[i] for i in (card.get("rule_ref_ids") or [])
            if isinstance(i, int) and 0 <= i < len(rule_table)
        ],
        "source_refs": [
            source_table[i] for i in (card.get("source_ref_ids") or [])
            if isinstance(i, int) and 0 <= i < len(source_table)
        ],
    }


def public_card_projection(card: Mapping[str, Any]) -> dict[str, Any]:
    """Strip host-only grant fields; keep semantic card identity."""
    row = _thaw(card)
    if not isinstance(row, dict):
        return {}
    row.pop("active_exceptions", None)
    row.pop("unevaluated_exceptions", None)
    authority = row.get("authority") if isinstance(row.get("authority"), dict) else {}
    row["authority"] = {
        "selection": authority.get("selection") or "keeper-semantic",
        "execution": authority.get("execution") or "current-ruleset-adapter",
        "hard_gate": False,
    }
    return row


def project_family_cards(
    runtime: RulesRuntime,
    *,
    family: str,
    investigator_id: str | None = None,
) -> dict[str, Any]:
    """Bounded, non-gating card projection for scene.context / recovery.

    Never raises.  Missing graph/cards produce an empty affordance block.
    """
    empty = {
        "schema_version": RulesRuntime.SCHEMA_VERSION,
        "family": family,
        "investigator_id": investigator_id,
        "status": "no_candidate_in_compiled_scope",
        "cards": [],
        "ref_table": {
            "rule_refs": [],
            "source_refs": [],
            "resolution": CARD_REF_TABLE_RESOLUTION,
        },
        "authority": {
            "hard_gate": False,
            "role": "affordance",
            "note": "advisory healing affordances; absence never blocks play",
        },
    }
    try:
        result = runtime.context({"family": family, "kind": "procedure"})
    except Exception:
        return empty
    cards = [
        public_card_projection(card)
        for card in (result.get("cards") or [])
        if isinstance(card, Mapping)
    ][:8]
    cards, ref_table = hoist_card_ref_table(cards)
    return {
        "schema_version": RulesRuntime.SCHEMA_VERSION,
        "family": family,
        "investigator_id": investigator_id,
        "status": result.get("status") or ("ok" if cards else "no_candidate_in_compiled_scope"),
        "cards": cards,
        "ref_table": ref_table,
        "authority": {
            "hard_gate": False,
            "role": "affordance",
            "note": "advisory healing affordances; settle via rules.settle; absence never blocks play",
        },
    }


def _canonical_slot_name(node_id: str) -> str:
    """Canonical slot name for an input-slot node id.

    ``input-slot:coc7:social:described-action`` -> ``described_action``.
    Nodes that cannot be parsed keep their full id so they remain
    distinguishable (never collapsed onto an unrelated slot).
    """
    parts = str(node_id).split(":")
    if len(parts) >= 3 and parts[0] == "input-slot":
        return parts[-1].replace("-", "_")
    return str(node_id)


def _scalar_type_from_guess(name: str) -> str:
    known_bools = {
        "pushed", "complete_rest", "poor_environment",
        "include_selection_policy",
    }
    if name in known_bools:
        return "bool"
    if name in {
        "skill_value", "medicine_skill_value", "credit_rating", "limit",
        "build", "actor_build", "target_build", "current_hp", "max_hp",
        "current_san",
    }:
        return "int"
    return "scalar"


# --------------------------------------------------------------------------- #
# Shadow configuration (host-internal knobs; no Keeper-visible surface)
# --------------------------------------------------------------------------- #
def configure_shadow(
    *,
    ruleset_id: str,
    family: str = "healing",
    runtime_owner: str = "shadow",
    graph: dict[str, Any] | None = None,
    graph_manifest: dict[str, Any] | None = None,
    log_path: Path | str | None = None,
    rulesets_root_path: Path | str | None = None,
) -> None:
    """Arm the shadow comparator for tests/host integration.

    Production defaults are a no-op (every family is legacy/visible), so this
    is only called by tests and by an explicit R2-phase-2 host integration.

    ``rulesets_root_path`` pins package discovery when the configured owner is
    ``legacy`` (the production path re-resolves ownership from the package).
    Omit it to use the installed rulesets root; pass an isolated root in tests
    so they never implicitly pick up the ambient coc7 graph.
    """
    global _SHADOW_CONFIG
    _SHADOW_CONFIG = {
        "ruleset_id": ruleset_id,
        "family": family,
        "runtime_owner": runtime_owner,
        "graph": graph,
        "graph_manifest": graph_manifest,
        "log_path": str(log_path) if log_path is not None else None,
        "rulesets_root_path": (
            str(rulesets_root_path) if rulesets_root_path is not None else None
        ),
    }


def reset_shadow_config() -> None:
    global _SHADOW_CONFIG
    _SHADOW_CONFIG = None


def get_shadow_config() -> dict[str, Any] | None:
    if _SHADOW_CONFIG is None:
        return None
    return deepcopy(_SHADOW_CONFIG)


def _current_shadow_log_path(explicit: Path | str | None = None) -> Path:
    if explicit is not None:
        return Path(explicit)
    env = os.environ.get(SHADOW_LOG_ENV)
    if env:
        return Path(env)
    return DEFAULT_SHADOW_LOG_PATH


def _append_shadow_row(row: dict[str, Any], log_path: Path | None = None) -> None:
    try:
        path = _current_shadow_log_path(log_path)
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "a", encoding="utf-8") as handle:
            handle.write(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n")
    except OSError:
        # The shadow log is opportunistic evidence; never fail the caller.
        pass


def record_host_internal_findings(
    findings: list[Any],
    *,
    campaign_id: str | None = None,
    family: str | None = None,
    investigator_id: str | None = None,
    ruleset_id: str | None = None,
    tool: str = "rules.context",
) -> None:
    """Persist host-internal findings on the shadow-log audit channel.

    Public Keeper envelopes must omit ``findings``; this is the retention
    path.  Never raises.
    """
    rows = [item for item in findings if isinstance(item, Mapping)]
    if not rows:
        return
    decision_refs = sorted({
        str(item.get("decision_ref"))
        for item in rows
        if item.get("decision_ref")
    })
    row = {
        "contract_id": SHADOW_LOG_CONTRACT_ID,
        "schema_version": SHADOW_LOG_SCHEMA_VERSION,
        "status": "exception_condition_unevaluated",
        "skip_reason": None,
        "tool": tool,
        "family": family or "healing",
        "ruleset_id": ruleset_id or "",
        "campaign_id": campaign_id or "",
        "investigator_id": investigator_id or "",
        "decision_refs": decision_refs,
        "findings": [dict(item) for item in rows],
    }
    _append_shadow_row(row, _current_log_path_from_config())


# --------------------------------------------------------------------------- #
# Shadow comparator (spec §14.1)
# --------------------------------------------------------------------------- #
def _decision_ref_for_healing(
    runtime: RulesRuntime,
    tool_name: str,
    payload: Mapping[str, Any],
) -> str | None:
    """Resolve the graph counterpart decision for one healing legacy op."""
    if tool_name not in _HEALING_TOOLS:
        return None
    for node in runtime.decision_nodes("healing"):
        implementation = (node.get("properties") or {}).get("implementation")
        if not isinstance(implementation, dict):
            continue
        kind = implementation.get("kind")
        constants = implementation.get("payload_constants") or {}
        method = constants.get("method")
        clock = constants.get("clock_kind") or payload.get("clock_kind")
        matches = False
        if tool_name == "rules.first_aid":
            matches = kind == "stabilize" and method == "first_aid"
        elif tool_name == "rules.medicine":
            matches = kind == "stabilize" and method == "medicine"
        elif tool_name == "rules.dying_check":
            matches = kind == "dying_tick" and clock == payload.get("clock_kind")
        elif tool_name == "rules.weekly_recovery":
            matches = kind == "weekly_recovery"
        if matches:
            return str(node["node_id"])
    return None


# Mandatory §14.1 comparison axes that the legacy normalized request may or
# may not be able to express.  Never a silent pass: when a side genuinely
# lacks data for an axis, the comparator records an explicit finding.
_LEGACY_AXIS_PATHS = {
    "rule_refs": ("payload", "rule_refs"),
    "resource_effects": ("payload", "resource_effects"),
    "visibility": ("payload", "visibility"),
    "pending_choices": ("payload", "pending_choices"),
}
_UNEXPRESSED = object()  # sentinel: the legacy command carries no value


def _legacy_axis_value(legacy_command: Mapping[str, Any], axis: str) -> Any:
    """Read one §14.1 axis from the legacy normalized command if it can
    express it; else return ``_UNEXPRESSED``."""
    path = _LEGACY_AXIS_PATHS.get(axis)
    if path is None:
        return _UNEXPRESSED
    root = legacy_command
    for part in path:
        if not isinstance(root, Mapping) or part not in root:
            return _UNEXPRESSED
        root = root[part]
    return deepcopy(root)


def _compare_plan_and_legacy(
    runtime: RulesRuntime,
    plan: Mapping[str, Any],
    legacy_command: Mapping[str, Any],
) -> tuple[list[dict[str, Any]], dict[str, Any], dict[str, Any]]:
    """Exact semantic differences (plan vs legacy) and both profiles.

    Every mandatory §14.1 axis is compared: capability, phase, semantic
    inputs, locked inputs, rule refs, resource effects, visibility, and
    pending-choice semantics.  Only runtime-owned identities
    (command_id/roll_id/request_index/decision_id) are ignored — the host
    reattaches them deterministically.  Where the legacy normalized command
    genuinely cannot express an axis, the comparator records an explicit
    ``unresolved_legacy`` difference finding (never a silent match; never a
    false diff when both sides carry equal values).
    """
    differences: list[dict[str, Any]] = []
    legacy_kind = str(legacy_command.get("kind") or "")
    legacy_phase = str(legacy_command.get("phase") or "")
    legacy_payload = {
        str(key): deepcopy(value)
        for key, value in (legacy_command.get("payload") or {}).items()
        if str(key) not in _RUNTIME_OWNED_PAYLOAD_KEYS
    }
    plan_command = plan["command"]
    plan_kind = str(plan_command.get("kind") or "")
    plan_phase = str(plan_command.get("phase") or "")
    plan_payload = {
        str(key): _thaw(value)
        for key, value in (plan_command.get("payload") or {}).items()
    }
    if plan_kind != legacy_kind:
        differences.append({
            "axis": "capability",
            "field": "command.kind",
            "kind": "value_mismatch",
            "plan": plan_kind,
            "legacy": legacy_kind,
        })
    if plan_phase != legacy_phase:
        differences.append({
            "axis": "phase",
            "field": "command.phase",
            "kind": "value_mismatch",
            "plan": plan_phase,
            "legacy": legacy_phase,
        })
    slot_ownership = {
        slot["name"]: slot["ownership"] for slot in runtime._slots_for(plan["decision_ref"])
    }
    all_keys = sorted(set(plan_payload) | set(legacy_payload))
    for key in all_keys:
        axis = "payload"
        ownership = slot_ownership.get(key)
        if ownership in _SEMANTIC_SLOT_OWNERSHIPS:
            axis = "semantic_inputs"
        elif ownership in _LOCKED_SLOT_OWNERSHIPS:
            axis = "locked_inputs"
        if key not in plan_payload:
            differences.append({
                "axis": axis,
                "field": f"payload.{key}",
                "kind": "extra_in_legacy",
                "plan": None,
                "legacy": legacy_payload[key],
            })
        elif key not in legacy_payload:
            differences.append({
                "axis": axis,
                "field": f"payload.{key}",
                "kind": "missing_in_legacy",
                "plan": plan_payload[key],
                "legacy": None,
            })
        elif plan_payload[key] != legacy_payload[key]:
            differences.append({
                "axis": axis,
                "field": f"payload.{key}",
                "kind": "value_mismatch",
                "plan": plan_payload[key],
                "legacy": legacy_payload[key],
            })
    plan_profile = _thaw({
        "capability": plan["capability"],
        "command": {"kind": plan_kind, "phase": plan_phase, "payload": plan_payload},
        "rule_refs": list(plan["rule_refs"]),
        "resource_effects": list(plan["resource_effects"]),
        "visibility": plan["visibility"],
        "pending_choices": list(plan["pending_choices"]),
        "next_decisions": list(plan["next_decisions"]),
    })
    legacy_profile: dict[str, Any] = {
        "command": {"kind": legacy_kind, "phase": legacy_phase, "payload": legacy_payload},
        "rule_refs": None,
        "resource_effects": None,
        "visibility": None,
        "pending_choices": None,
        "next_decisions": None,
    }
    # Mandatory semantic axes beyond the raw command (spec §14.1).
    for axis in ("rule_refs", "resource_effects", "visibility", "pending_choices"):
        plan_value = _thaw(plan.get(axis))
        legacy_value = _legacy_axis_value(legacy_command, axis)
        if legacy_value is _UNEXPRESSED:
            differences.append({
                "axis": axis,
                "field": axis,
                "kind": "unresolved_legacy",
                "plan": plan_value,
                "legacy": None,
            })
            legacy_profile[axis] = None
        elif plan_value != legacy_value:
            differences.append({
                "axis": axis,
                "field": axis,
                "kind": "value_mismatch",
                "plan": plan_value,
                "legacy": legacy_value,
            })
            legacy_profile[axis] = legacy_value
        else:
            legacy_profile[axis] = legacy_value
    return differences, plan_profile, legacy_profile


def maybe_shadow_compare_healing(
    *,
    ruleset_id: str,
    tool_name: str,
    decision_id: str,
    command: Mapping[str, Any] | None = None,
    state_path: Path | str | None = None,
    sheet_provider: Callable[[], dict[str, Any]] | None = None,
) -> dict[str, Any] | None:
    """Shadow-compare one legacy healing op; NEVER raises or blocks.

    Returns the log row (or None when the family is legacy-owned or the
    config is unset).  Engage conditions:

    - ``tool_name`` must be one of the four healing legacy tools;
    - the family's runtime owner must resolve to ``shadow`` (via the
      configured override, then the package manifest / graph manifest /
      graph map);
    - for a shadow-owned family, a missing/invalid/unloadable graph produces
      one host-internal ``skipped`` row and the caller continues.
    """
    if tool_name not in _HEALING_TOOLS:
        return None
    try:
        return _maybe_shadow_compare_healing_impl(
            ruleset_id=ruleset_id,
            tool_name=tool_name,
            decision_id=decision_id,
            command=command,
            state_path=state_path,
            sheet_provider=sheet_provider,
        )
    except Exception as exc:  # pragma: no cover - defensive boundary
        row = {
            "contract_id": SHADOW_LOG_CONTRACT_ID,
            "schema_version": SHADOW_LOG_SCHEMA_VERSION,
            "ruleset_id": ruleset_id,
            "family": "healing",
            "tool": tool_name,
            "decision_id": decision_id,
            "status": "skipped",
            "skip_reason": "comparator_error",
            "error": str(exc)[:300],
        }
        _append_shadow_row(row, _current_log_path_from_config())
        return row


def _current_log_path_from_config() -> Path | None:
    config = _SHADOW_CONFIG
    if config is None:
        return None
    return Path(config["log_path"]) if config.get("log_path") else None


def _maybe_shadow_compare_healing_impl(
    *,
    ruleset_id: str,
    tool_name: str,
    decision_id: str,
    command: Mapping[str, Any] | None,
    state_path: Path | str | None,
    sheet_provider: Callable[[], dict[str, Any]] | None,
) -> dict[str, Any] | None:
    config = _SHADOW_CONFIG
    owner, _surface = "legacy", "visible"
    graph: dict[str, Any] | None = None
    graph_manifest: dict[str, Any] | None = None
    source = "package"
    rulesets_root_path: Path | str | None = None
    if config is not None and config.get("ruleset_id") == ruleset_id:
        owner = str(config.get("runtime_owner") or "legacy")
        graph = config.get("graph")
        graph_manifest = config.get("graph_manifest")
        source = "config"
        rulesets_root_path = config.get("rulesets_root_path")
    if owner == "legacy":
        manifest = _load_manifest_cached(ruleset_id, rulesets_root_path)
        loaded = None
        if manifest is not None:
            loaded = load_ruleset_graph(
                ruleset_id, rulesets_root_path=rulesets_root_path,
            )
            if loaded["ok"]:
                graph, graph_manifest = loaded["graph"], loaded["graph_manifest"]
            owner, _ = resolve_family_ownership(
                ruleset_id, "healing", manifest=manifest,
                graph=graph, graph_manifest=graph_manifest,
            )
        if owner != "shadow":
            # Legacy-owned family: no pretend graph support, no machinery.
            return None
    if not isinstance(command, Mapping):
        row = _shadow_skip_row(ruleset_id, tool_name, decision_id,
                               "no_normalized_command")
        _append_shadow_row(row, _current_log_path_from_config())
        return row
    if graph is None or graph_manifest is None:
        row = _shadow_skip_row(ruleset_id, tool_name, decision_id, "graph_absent")
        _append_shadow_row(row, _current_log_path_from_config())
        return row
    sheet = None
    if sheet_provider is not None:
        try:
            sheet = sheet_provider()
        except Exception:
            sheet = None
    runtime: RulesRuntime | None = None
    try:
        runtime = RulesRuntime(
            graph,
            ruleset_id=ruleset_id,
            graph_manifest=graph_manifest,
            facts_provider=facts_from_state_closure(
                state_path, sheet, ruleset_id=ruleset_id
            ),
            host_locked_provider=None,
        )
    except ValueError:
        row = _shadow_skip_row(ruleset_id, tool_name, decision_id, "graph_invalid")
        _append_shadow_row(row, _current_log_path_from_config())
        return row
    decision_ref = _decision_ref_for_healing(runtime, tool_name, command.get("payload") or {})
    if decision_ref is None:
        row = _shadow_skip_row(ruleset_id, tool_name, decision_id,
                               "no_matching_decision", differences=[{
                                   "axis": "decision_ref",
                                   "field": "decision_ref",
                                   "kind": "missing_in_graph",
                                   "plan": None,
                                   "legacy": tool_name,
                               }])
        row["status"] = "mismatch"
        _append_shadow_row(row, _current_log_path_from_config())
        return row
    facts = _facts_from_state_file(Path(state_path), sheet, ruleset_id=ruleset_id) if state_path is not None \
        else facts_from_state(None, sheet, ruleset_id=ruleset_id)
    slot_ownership = {
        slot["name"]: slot["ownership"] for slot in runtime._slots_for(decision_ref)
    }
    payload = {
        str(key): deepcopy(value)
        for key, value in (command.get("payload") or {}).items()
        if str(key) not in _RUNTIME_OWNED_PAYLOAD_KEYS
    }
    semantic_inputs: dict[str, Any] = {}
    host_locked: dict[str, Any] = {}
    for key, value in payload.items():
        ownership = slot_ownership.get(key)
        if ownership in _SEMANTIC_SLOT_OWNERSHIPS:
            semantic_inputs[key] = value
        elif ownership in _LOCKED_SLOT_OWNERSHIPS:
            host_locked[key] = value
    result = runtime._compile_plan(
        decision_ref, semantic_inputs, facts=facts, host_locked=host_locked
    )
    if result["failure"] is not None:
        failure = result["failure"]
        row = _shadow_skip_row(ruleset_id, tool_name, decision_id,
                               "not_applicable", differences=[{
                                   "axis": "applicability",
                                   "field": failure.get("code", "condition"),
                                   "kind": "applicability_drift",
                                   "plan": "not_applicable",
                                   "legacy": "executing",
                                   "message": failure.get("message"),
                                   "missing": failure.get("missing"),
                               }])
        row["status"] = "mismatch"
        _append_shadow_row(row, _current_log_path_from_config())
        return row
    plan = result["plan"]
    differences, plan_profile, legacy_profile = _compare_plan_and_legacy(runtime, plan, command)
    row = {
        "contract_id": SHADOW_LOG_CONTRACT_ID,
        "schema_version": SHADOW_LOG_SCHEMA_VERSION,
        "ruleset_id": ruleset_id,
        "family": "healing",
        "tool": tool_name,
        "decision_id": decision_id,
        "decision_ref": decision_ref,
        "status": "match" if not differences else "mismatch",
        "skip_reason": None,
        "differences": differences,
        "plan_profile": plan_profile,
        "legacy_profile": legacy_profile,
        "graph_content_digest": _json_digest(graph),
    }
    _append_shadow_row(row, _current_log_path_from_config())
    return row


def _shadow_skip_row(
    ruleset_id: str,
    tool_name: str,
    decision_id: str,
    skip_reason: str,
    **extra: Any,
) -> dict[str, Any]:
    row: dict[str, Any] = {
        "contract_id": SHADOW_LOG_CONTRACT_ID,
        "schema_version": SHADOW_LOG_SCHEMA_VERSION,
        "ruleset_id": ruleset_id,
        "family": "healing",
        "tool": tool_name,
        "decision_id": decision_id,
        "status": "skipped",
        "skip_reason": skip_reason,
    }
    row.update(extra)
    return row


_SOCIAL_PSYCHOLOGY_TOOLS = frozenset({
    "rules.social_adjudicate", "rules.psychology_observe",
})


def maybe_shadow_compare_social_psychology(
    *,
    ruleset_id: str,
    tool_name: str,
    decision_id: str,
    command: Mapping[str, Any] | None = None,
    args: Mapping[str, Any] | None = None,
    state_path: Path | str | None = None,
    sheet_provider: Callable[[], dict[str, Any]] | None = None,
) -> dict[str, Any] | None:
    """Shadow-compare one legacy social/psych op; NEVER raises or blocks.

    Identical engage/fail-open discipline as the healing comparator: only a
    shadow-owned family compares; a missing/invalid graph produces a
    host-internal ``skipped`` row and the legacy path continues untouched.
    The families stay ``legacy``/``visible`` in the package, so this engages
    only under a test/host config override (``configure_shadow``).
    """
    if tool_name not in _SOCIAL_PSYCHOLOGY_TOOLS:
        return None
    try:
        return _maybe_shadow_compare_social_psychology_impl(
            ruleset_id=ruleset_id,
            tool_name=tool_name,
            decision_id=decision_id,
            command=command,
            args=args,
            state_path=state_path,
            sheet_provider=sheet_provider,
        )
    except Exception as exc:  # pragma: no cover - defensive boundary
        row = {
            "contract_id": SHADOW_LOG_CONTRACT_ID,
            "schema_version": SHADOW_LOG_SCHEMA_VERSION,
            "ruleset_id": ruleset_id,
            "family": _family_for_social_psychology_tool(tool_name),
            "tool": tool_name,
            "decision_id": decision_id,
            "status": "skipped",
            "skip_reason": "comparator_error",
            "error": str(exc)[:300],
        }
        _append_shadow_row(row, _current_log_path_from_config())
        return row


def _family_for_social_psychology_tool(tool_name: str) -> str:
    if tool_name == "rules.psychology_observe":
        return "psychology"
    return "social"


def _decision_ref_for_social_psychology(
    runtime: RulesRuntime,
    tool_name: str,
    command: Mapping[str, Any],
) -> str | None:
    """Resolve the graph decision ref for one legacy social/psych op."""
    payload = command.get("payload") or {}
    if not isinstance(payload, Mapping):
        payload = {}
    if tool_name == "rules.social_adjudicate":
        expected = _SOCIAL_ADJUDICATE_REF
        if expected in runtime._nodes:
            return expected
        return None
    if tool_name == "rules.psychology_observe":
        phase = str(command.get("phase") or "")
        if phase == "realize" or (
            isinstance(payload.get("external_behavior"), str)
            and payload.get("external_behavior")
        ):
            expected = _PSYCHOLOGY_REALIZE_REF
            if expected in runtime._nodes:
                return expected
        expected = _PSYCHOLOGY_OBSERVE_REF
        if expected in runtime._nodes:
            return expected
        return None
    return None


def _maybe_shadow_compare_social_psychology_impl(
    *,
    ruleset_id: str,
    tool_name: str,
    decision_id: str,
    command: Mapping[str, Any] | None,
    args: Mapping[str, Any] | None,
    state_path: Path | str | None,
    sheet_provider: Callable[[], dict[str, Any]] | None,
) -> dict[str, Any] | None:
    config = _SHADOW_CONFIG
    family = _family_for_social_psychology_tool(tool_name)
    owner, _surface = "legacy", "visible"
    graph: dict[str, Any] | None = None
    graph_manifest: dict[str, Any] | None = None
    rulesets_root_path: Path | str | None = None
    if config is not None and config.get("ruleset_id") == ruleset_id:
        owner = str(config.get("runtime_owner") or "legacy")
        graph = config.get("graph")
        graph_manifest = config.get("graph_manifest")
        rulesets_root_path = config.get("rulesets_root_path")
    if owner == "legacy":
        manifest = _load_manifest_cached(ruleset_id, rulesets_root_path)
        if manifest is not None:
            loaded = load_ruleset_graph(
                ruleset_id, rulesets_root_path=rulesets_root_path,
            )
            if loaded["ok"]:
                graph, graph_manifest = loaded["graph"], loaded["graph_manifest"]
            owner, _ = resolve_family_ownership(
                ruleset_id, family, manifest=manifest,
                graph=graph, graph_manifest=graph_manifest,
            )
        if owner != "shadow":
            # Legacy-owned family: no pretend graph support, no machinery.
            return None
    if not isinstance(command, Mapping):
        row = {"status": "skipped", "skip_reason": "no_normalized_command"}
        row.update({
            "family": family, "tool": tool_name, "decision_id": decision_id,
        })
        _append_shadow_row(row, _current_log_path_from_config())
        return row
    if graph is None or graph_manifest is None:
        row = {
            "family": family, "tool": tool_name, "decision_id": decision_id,
            "status": "skipped", "skip_reason": "graph_absent",
        }
        _append_shadow_row(row, _current_log_path_from_config())
        return row
    sheet = None
    if sheet_provider is not None:
        try:
            sheet = sheet_provider()
        except Exception:
            sheet = None
    runtime = None
    try:
        runtime = RulesRuntime(
            graph,
            ruleset_id=ruleset_id,
            graph_manifest=graph_manifest,
            facts_provider=facts_from_state_closure(
                state_path, sheet, ruleset_id=ruleset_id,
            ),
            host_locked_provider=None,
        )
    except ValueError:
        row = {
            "family": family, "tool": tool_name, "decision_id": decision_id,
            "status": "skipped", "skip_reason": "graph_invalid",
        }
        _append_shadow_row(row, _current_log_path_from_config())
        return row
    decision_ref = _decision_ref_for_social_psychology(runtime, tool_name, command)
    if decision_ref is None:
        row = {
            "family": family, "tool": tool_name, "decision_id": decision_id,
            "decision_ref": None, "status": "mismatch", "skip_reason": None,
            "differences": [{
                "axis": "decision_ref", "field": "decision_ref",
                "kind": "missing_in_graph",
                "plan": None, "legacy": tool_name,
            }],
        }
        _append_shadow_row(row, _current_log_path_from_config())
        return row
    facts = _facts_from_state_file(
        Path(state_path), sheet, ruleset_id=ruleset_id,
    ) if state_path is not None else facts_from_state(
        None, sheet, ruleset_id=ruleset_id,
    )
    slot_ownership = {
        slot["name"]: slot["ownership"] for slot in runtime._slots_for(decision_ref)
    }
    payload = {
        str(key): deepcopy(value)
        for key, value in (command.get("payload") or {}).items()
        if str(key) not in _RUNTIME_OWNED_PAYLOAD_KEYS
    }
    semantic_inputs: dict[str, Any] = {}
    host_locked: dict[str, Any] = {}
    for key, value in payload.items():
        ownership = slot_ownership.get(key)
        if ownership in _SEMANTIC_SLOT_OWNERSHIPS:
            semantic_inputs[key] = value
        elif ownership in _LOCKED_SLOT_OWNERSHIPS:
            host_locked[key] = value
    result = runtime._compile_plan(
        decision_ref, semantic_inputs, facts=facts, host_locked=host_locked,
    )
    if result["failure"] is not None:
        failure = result["failure"]
        row = {
            "family": family, "tool": tool_name, "decision_id": decision_id,
            "decision_ref": decision_ref, "status": "mismatch",
            "skip_reason": None,
            "differences": [{
                "axis": "semantic_inputs",
                "field": failure.get("code", "condition"),
                "kind": "missing_semantic_input",
                "plan": None, "legacy": "executing",
                "message": failure.get("message"),
                "missing": failure.get("missing"),
            }],
            "plan_profile": None, "legacy_profile": None,
            "graph_content_digest": _json_digest(graph),
        }
        _append_shadow_row(row, _current_log_path_from_config())
        return row
    plan = result["plan"]
    differences, plan_profile, legacy_profile = _compare_plan_and_legacy(
        runtime, plan, command,
    )
    row = {
        "contract_id": SHADOW_LOG_CONTRACT_ID,
        "schema_version": SHADOW_LOG_SCHEMA_VERSION,
        "ruleset_id": ruleset_id,
        "family": family,
        "tool": tool_name,
        "decision_id": decision_id,
        "decision_ref": decision_ref,
        "status": "match" if not differences else "mismatch",
        "skip_reason": None,
        "differences": differences,
        "plan_profile": plan_profile,
        "legacy_profile": legacy_profile,
        "graph_content_digest": _json_digest(graph),
    }
    _append_shadow_row(row, _current_log_path_from_config())
    return row


_CHECK_LUCK_TOOLS = frozenset({
    "rules.roll", "rules.push", "rules.luck_spend", "rules.resource_delta",
})


def maybe_shadow_compare_check_luck(
    *,
    ruleset_id: str,
    tool_name: str,
    decision_id: str,
    command: Mapping[str, Any] | None = None,
    args: Mapping[str, Any] | None = None,
    state_path: Path | str | None = None,
    sheet_provider: Callable[[], dict[str, Any]] | None = None,
) -> dict[str, Any] | None:
    """Shadow-compare one ordinary-check / Push / Luck / resource op.

    Fail-open, never blocks, never double-executes.  Engages only when the
    family resolves to ``shadow`` (tests arm ``configure_shadow``).  Graph
    absent/invalid → one host-internal ``skipped`` row; legacy continues.
    """
    if tool_name not in _CHECK_LUCK_TOOLS:
        return None
    try:
        return _maybe_shadow_compare_check_luck_impl(
            ruleset_id=ruleset_id,
            tool_name=tool_name,
            decision_id=decision_id,
            command=command,
            args=args,
            state_path=state_path,
            sheet_provider=sheet_provider,
        )
    except Exception as exc:  # pragma: no cover - defensive boundary
        row = {
            "contract_id": SHADOW_LOG_CONTRACT_ID,
            "schema_version": SHADOW_LOG_SCHEMA_VERSION,
            "ruleset_id": ruleset_id,
            "family": _family_for_check_luck_tool(tool_name),
            "tool": tool_name,
            "decision_id": decision_id,
            "status": "skipped",
            "skip_reason": "comparator_error",
            "error": str(exc)[:300],
        }
        _append_shadow_row(row, _current_log_path_from_config())
        return row


def _family_for_check_luck_tool(tool_name: str) -> str:
    if tool_name in {"rules.push", "rules.luck_spend"}:
        return "push-luck"
    return "core-check"


def _decision_ref_for_check_luck(
    runtime: RulesRuntime,
    tool_name: str,
    command: Mapping[str, Any],
) -> str | None:
    payload = command.get("payload") or {}
    if not isinstance(payload, Mapping):
        payload = {}
    expected = None
    if tool_name == "rules.roll":
        characteristic = str(payload.get("characteristic") or "").strip().upper()
        skill = str(payload.get("skill") or "").strip().upper()
        if characteristic == "LUCK" or skill == "LUCK":
            expected = _LUCK_ROLL_REF
        else:
            expected = _ORDINARY_CHECK_REF
    elif tool_name == "rules.push":
        expected = _PUSHED_ROLL_REF
    elif tool_name == "rules.luck_spend":
        expected = _LUCK_SPEND_REF
    elif tool_name == "rules.resource_delta":
        expected = _RESOURCE_DELTA_REF
    if expected is not None and expected in runtime._nodes:
        return expected
    return None


def _maybe_shadow_compare_check_luck_impl(
    *,
    ruleset_id: str,
    tool_name: str,
    decision_id: str,
    command: Mapping[str, Any] | None,
    args: Mapping[str, Any] | None,
    state_path: Path | str | None,
    sheet_provider: Callable[[], dict[str, Any]] | None,
) -> dict[str, Any] | None:
    config = _SHADOW_CONFIG
    family = _family_for_check_luck_tool(tool_name)
    owner, _surface = "legacy", "visible"
    graph: dict[str, Any] | None = None
    graph_manifest: dict[str, Any] | None = None
    rulesets_root_path: Path | str | None = None
    if config is not None and config.get("ruleset_id") == ruleset_id:
        owner = str(config.get("runtime_owner") or "legacy")
        graph = config.get("graph")
        graph_manifest = config.get("graph_manifest")
        rulesets_root_path = config.get("rulesets_root_path")
    if owner == "legacy":
        manifest = _load_manifest_cached(ruleset_id, rulesets_root_path)
        if manifest is not None:
            loaded = load_ruleset_graph(
                ruleset_id, rulesets_root_path=rulesets_root_path,
            )
            if loaded["ok"]:
                graph, graph_manifest = loaded["graph"], loaded["graph_manifest"]
            owner, _ = resolve_family_ownership(
                ruleset_id, family, manifest=manifest,
                graph=graph, graph_manifest=graph_manifest,
            )
        if owner != "shadow":
            return None
    if not isinstance(command, Mapping):
        row = {
            "family": family, "tool": tool_name, "decision_id": decision_id,
            "status": "skipped", "skip_reason": "no_normalized_command",
        }
        _append_shadow_row(row, _current_log_path_from_config())
        return row
    if graph is None or graph_manifest is None:
        row = {
            "family": family, "tool": tool_name, "decision_id": decision_id,
            "status": "skipped", "skip_reason": "graph_absent",
        }
        _append_shadow_row(row, _current_log_path_from_config())
        return row
    sheet = None
    if sheet_provider is not None:
        try:
            sheet = sheet_provider()
        except Exception:
            sheet = None
    try:
        runtime = RulesRuntime(
            graph,
            ruleset_id=ruleset_id,
            graph_manifest=graph_manifest,
            facts_provider=facts_from_state_closure(
                state_path, sheet, ruleset_id=ruleset_id,
            ),
            host_locked_provider=None,
        )
    except ValueError:
        row = {
            "family": family, "tool": tool_name, "decision_id": decision_id,
            "status": "skipped", "skip_reason": "graph_invalid",
        }
        _append_shadow_row(row, _current_log_path_from_config())
        return row
    decision_ref = _decision_ref_for_check_luck(runtime, tool_name, command)
    if decision_ref is None:
        row = {
            "family": family, "tool": tool_name, "decision_id": decision_id,
            "decision_ref": None, "status": "mismatch", "skip_reason": None,
            "differences": [{
                "axis": "decision_ref", "field": "decision_ref",
                "kind": "missing_in_graph",
                "plan": None, "legacy": tool_name,
            }],
        }
        _append_shadow_row(row, _current_log_path_from_config())
        return row
    facts = _facts_from_state_file(
        Path(state_path), sheet, ruleset_id=ruleset_id,
    ) if state_path is not None else facts_from_state(
        None, sheet, ruleset_id=ruleset_id,
    )
    slot_ownership = {
        slot["name"]: slot["ownership"] for slot in runtime._slots_for(decision_ref)
    }
    payload = {
        str(key): deepcopy(value)
        for key, value in (command.get("payload") or {}).items()
        if str(key) not in _RUNTIME_OWNED_PAYLOAD_KEYS
    }
    semantic_inputs: dict[str, Any] = {}
    host_locked: dict[str, Any] = {}
    for key, value in payload.items():
        ownership = slot_ownership.get(key)
        if ownership in _SEMANTIC_SLOT_OWNERSHIPS:
            semantic_inputs[key] = value
        elif ownership in _LOCKED_SLOT_OWNERSHIPS:
            host_locked[key] = value
    result = runtime._compile_plan(
        decision_ref, semantic_inputs, facts=facts, host_locked=host_locked,
    )
    if result["failure"] is not None:
        failure = result["failure"]
        row = {
            "family": family, "tool": tool_name, "decision_id": decision_id,
            "decision_ref": decision_ref, "status": "mismatch",
            "skip_reason": None,
            "differences": [{
                "axis": "semantic_inputs",
                "field": failure.get("code", "condition"),
                "kind": "missing_semantic_input",
                "plan": None, "legacy": "executing",
                "message": failure.get("message"),
                "missing": failure.get("missing"),
            }],
            "plan_profile": None, "legacy_profile": None,
            "graph_content_digest": _json_digest(graph),
        }
        _append_shadow_row(row, _current_log_path_from_config())
        return row
    plan = result["plan"]
    differences, plan_profile, legacy_profile = _compare_plan_and_legacy(
        runtime, plan, command,
    )
    row = {
        "contract_id": SHADOW_LOG_CONTRACT_ID,
        "schema_version": SHADOW_LOG_SCHEMA_VERSION,
        "ruleset_id": ruleset_id,
        "family": family,
        "tool": tool_name,
        "decision_id": decision_id,
        "decision_ref": decision_ref,
        "status": "match" if not differences else "mismatch",
        "skip_reason": None,
        "differences": differences,
        "plan_profile": plan_profile,
        "legacy_profile": legacy_profile,
        "graph_content_digest": _json_digest(graph),
    }
    _append_shadow_row(row, _current_log_path_from_config())
    return row


_LOOKUPS_TOOLS = frozenset({
    "rules.skill_describe", "rules.catalog_search",
    "rules.build_scale", "rules.cash_assets",
    "rules.damage", "rules.sanity_check",
})


def maybe_shadow_compare_lookups(
    *,
    ruleset_id: str,
    tool_name: str,
    decision_id: str,
    command: Mapping[str, Any] | None = None,
    args: Mapping[str, Any] | None = None,
    state_path: Path | str | None = None,
    sheet_provider: Callable[[], dict[str, Any]] | None = None,
) -> dict[str, Any] | None:
    """Shadow-compare one lookup / damage / SAN op. Fail-open, never blocks."""
    if tool_name not in _LOOKUPS_TOOLS:
        return None
    try:
        return _maybe_shadow_compare_lookups_impl(
            ruleset_id=ruleset_id,
            tool_name=tool_name,
            decision_id=decision_id,
            command=command,
            args=args,
            state_path=state_path,
            sheet_provider=sheet_provider,
        )
    except Exception as exc:  # pragma: no cover - defensive boundary
        row = {
            "contract_id": SHADOW_LOG_CONTRACT_ID,
            "schema_version": SHADOW_LOG_SCHEMA_VERSION,
            "ruleset_id": ruleset_id,
            "family": _family_for_lookups_tool(tool_name),
            "tool": tool_name,
            "decision_id": decision_id,
            "status": "skipped",
            "skip_reason": "comparator_error",
            "error": str(exc)[:300],
        }
        _append_shadow_row(row, _current_log_path_from_config())
        return row


def _family_for_lookups_tool(tool_name: str) -> str:
    if tool_name == "rules.damage":
        return "combat"
    if tool_name == "rules.sanity_check":
        return "sanity"
    return "development"


def _decision_ref_for_lookups(
    runtime: RulesRuntime,
    tool_name: str,
) -> str | None:
    expected = {
        "rules.skill_describe": _SKILL_DESCRIBE_REF,
        "rules.catalog_search": _CATALOG_SEARCH_REF,
        "rules.build_scale": _BUILD_SCALE_REF,
        "rules.cash_assets": _CASH_ASSETS_REF,
        "rules.damage": _DAMAGE_REF,
        "rules.sanity_check": _SANITY_LOSS_REF,
    }.get(tool_name)
    if expected is not None and expected in runtime._nodes:
        return expected
    return None


def _maybe_shadow_compare_lookups_impl(
    *,
    ruleset_id: str,
    tool_name: str,
    decision_id: str,
    command: Mapping[str, Any] | None,
    args: Mapping[str, Any] | None,
    state_path: Path | str | None,
    sheet_provider: Callable[[], dict[str, Any]] | None,
) -> dict[str, Any] | None:
    config = _SHADOW_CONFIG
    family = _family_for_lookups_tool(tool_name)
    owner, _surface = "legacy", "visible"
    graph: dict[str, Any] | None = None
    graph_manifest: dict[str, Any] | None = None
    rulesets_root_path: Path | str | None = None
    if config is not None and config.get("ruleset_id") == ruleset_id:
        owner = str(config.get("runtime_owner") or "legacy")
        graph = config.get("graph")
        graph_manifest = config.get("graph_manifest")
        rulesets_root_path = config.get("rulesets_root_path")
    if owner == "legacy":
        manifest = _load_manifest_cached(ruleset_id, rulesets_root_path)
        if manifest is not None:
            loaded = load_ruleset_graph(
                ruleset_id, rulesets_root_path=rulesets_root_path,
            )
            if loaded["ok"]:
                graph, graph_manifest = loaded["graph"], loaded["graph_manifest"]
            owner, _ = resolve_family_ownership(
                ruleset_id, family, manifest=manifest,
                graph=graph, graph_manifest=graph_manifest,
            )
        if owner != "shadow":
            return None
    if not isinstance(command, Mapping):
        row = {
            "family": family, "tool": tool_name, "decision_id": decision_id,
            "status": "skipped", "skip_reason": "no_normalized_command",
        }
        _append_shadow_row(row, _current_log_path_from_config())
        return row
    if graph is None or graph_manifest is None:
        row = {
            "family": family, "tool": tool_name, "decision_id": decision_id,
            "status": "skipped", "skip_reason": "graph_absent",
        }
        _append_shadow_row(row, _current_log_path_from_config())
        return row
    sheet = None
    if sheet_provider is not None:
        try:
            sheet = sheet_provider()
        except Exception:
            sheet = None
    try:
        runtime = RulesRuntime(
            graph,
            ruleset_id=ruleset_id,
            graph_manifest=graph_manifest,
            facts_provider=facts_from_state_closure(
                state_path, sheet, ruleset_id=ruleset_id,
            ),
            host_locked_provider=None,
        )
    except ValueError:
        row = {
            "family": family, "tool": tool_name, "decision_id": decision_id,
            "status": "skipped", "skip_reason": "graph_invalid",
        }
        _append_shadow_row(row, _current_log_path_from_config())
        return row
    decision_ref = _decision_ref_for_lookups(runtime, tool_name)
    if decision_ref is None:
        row = {
            "family": family, "tool": tool_name, "decision_id": decision_id,
            "decision_ref": None, "status": "mismatch", "skip_reason": None,
            "differences": [{
                "axis": "decision_ref", "field": "decision_ref",
                "kind": "missing_in_graph",
                "plan": None, "legacy": tool_name,
            }],
        }
        _append_shadow_row(row, _current_log_path_from_config())
        return row
    slot_ownership = {
        slot["name"]: slot["ownership"] for slot in runtime._slots_for(decision_ref)
    }
    payload = {
        str(key): deepcopy(value)
        for key, value in (command.get("payload") or {}).items()
        if str(key) not in _RUNTIME_OWNED_PAYLOAD_KEYS
    }
    semantic_inputs: dict[str, Any] = {}
    host_locked: dict[str, Any] = {}
    for key, value in payload.items():
        ownership = slot_ownership.get(key)
        if ownership in _SEMANTIC_SLOT_OWNERSHIPS:
            semantic_inputs[key] = value
        elif ownership in _LOCKED_SLOT_OWNERSHIPS:
            host_locked[key] = value
        elif ownership is None and key in slot_ownership:
            host_locked[key] = value
    compiled = runtime._compile_plan(
        decision_ref, semantic_inputs, host_locked=host_locked or None,
    )
    failure = compiled.get("failure")
    if failure:
        row = {
            "family": family, "tool": tool_name, "decision_id": decision_id,
            "decision_ref": decision_ref, "status": "mismatch",
            "skip_reason": None,
            "differences": [{
                "axis": "compile", "field": "compile",
                "kind": str(failure.get("code") or "compile_failure"),
                "plan": None, "legacy": "executing",
                "message": failure.get("message"),
            }],
            "graph_content_digest": _json_digest(graph),
        }
        _append_shadow_row(row, _current_log_path_from_config())
        return row
    plan = compiled["plan"]
    differences, plan_profile, legacy_profile = _compare_plan_and_legacy(
        runtime, plan, command,
    )
    row = {
        "contract_id": SHADOW_LOG_CONTRACT_ID,
        "schema_version": SHADOW_LOG_SCHEMA_VERSION,
        "ruleset_id": ruleset_id,
        "family": family,
        "tool": tool_name,
        "decision_id": decision_id,
        "decision_ref": decision_ref,
        "status": "match" if not differences else "mismatch",
        "skip_reason": None,
        "differences": differences,
        "plan_profile": plan_profile,
        "legacy_profile": legacy_profile,
        "graph_content_digest": _json_digest(graph),
    }
    _append_shadow_row(row, _current_log_path_from_config())
    return row

def facts_from_state_closure(
    state_path: Path | str | None,
    sheet: dict[str, Any] | None,
    *,
    ruleset_id: str,
) -> Callable[[], Mapping[str, Any]]:
    """Build a facts provider that lazily reads the investigator state file.

    Read-only: unlike ``Ctx.inv_state`` this never seeds/mutates state.
    """
    def provider() -> Mapping[str, Any]:
        return _facts_from_state_file(Path(state_path), sheet, ruleset_id=ruleset_id)
    return provider


def _elapsed_minutes_from_campaign(path: Path | None) -> int | None:
    if path is None:
        return None
    time_path = path.parent.parent / "time-state.json"
    try:
        payload = json.loads(time_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        return None
    if not isinstance(payload, dict):
        return None
    clock = payload.get("clock") if isinstance(payload.get("clock"), dict) else {}
    elapsed = clock.get("elapsed_minutes")
    if isinstance(elapsed, bool) or not isinstance(elapsed, int) or elapsed < 0:
        return None
    return elapsed


def _facts_from_state_file(
    path: Path,
    sheet: dict[str, Any] | None,
    *,
    ruleset_id: str,
) -> dict[str, Any]:
    state = None
    try:
        if path is not None and path.is_file():
            state = json.loads(path.read_text(encoding="utf-8"))
            if not isinstance(state, dict):
                state = None
    except (OSError, json.JSONDecodeError):
        state = None
    return facts_from_state(
        state, sheet, ruleset_id=ruleset_id,
        elapsed_minutes=_elapsed_minutes_from_campaign(path),
    )
