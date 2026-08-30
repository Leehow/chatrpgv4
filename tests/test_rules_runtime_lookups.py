#!/usr/bin/env python3
"""R6 tests: RulesRuntime lookups (context) + non-session damage/SAN.

Exercises the runtime against the lookups fixture graph (a VALIDATION COPY
under ``tests/fixtures/``; packaged coc7 rule-graph.json stays the healing
artifact):

- **Lookups**: skill_describe, catalog_search, build_scale, cash_assets are
  context-only (kind=lookup). They never settle, never roll, never write.
- **Damage**: roll-backed negative HP damage only (damage.json); heal and
  unrolled integers are source_ambiguity, not compiled claims.
- **SAN**: only sanity.json fields compile (thresholds, max SAN, involuntary
  kinds, bout duration). Percentile check/loss/clamp is uncompiled absence.
- Shadow: fail-open, no double execution; graph absent → skipped.
- Plug/unplug: graph absent leaves legacy envelopes identical to the
  pre-slice golden captured from current main.
"""
from __future__ import annotations

import copy
import json
import shutil
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path("plugins/coc-keeper/scripts")))
from toolbox_test_support import *  # noqa: E402,F401,F403
import coc_rules_runtime  # noqa: E402
import coc_rulesets  # noqa: E402

FIXTURE_GRAPH = Path("tests/fixtures/coc7-rule-graph-lookups.json")
FIXTURE_MANIFEST = Path("tests/fixtures/coc7-rule-graph-manifest-lookups.json")
GOLDEN_PATH = Path("tests/fixtures/lookups-pre-slice-golden.json")
_SCENE_HINT_PREFIX = "scene state was updated"
_ENVELOPE_KEYS = ("ok", "data", "warnings", "hints")

_SKILL = "decision:coc7:development:skill-describe"
_CATALOG = "decision:coc7:development:catalog-search"
_BUILD = "decision:coc7:development:build-scale"
_CASH = "decision:coc7:development:cash-assets"
_DAMAGE = "decision:coc7:combat:apply-damage"
_SANITY_CHECK_UNCOMPILED = "exception:coc7:sanity:check-then-loss-uncompiled"
_RULES_JSON = Path("plugins/coc-keeper/rulesets/coc7/rules-json")

_PROMOTED_PACKAGE = {
    "rule_families": [
        {"family_id": "development", "runtime_owner": "graph", "legacy_surface": "hidden"},
        {"family_id": "combat", "runtime_owner": "graph", "legacy_surface": "hidden"},
        {"family_id": "sanity", "runtime_owner": "graph", "legacy_surface": "hidden"},
    ],
}


def _load_fixture_graph() -> tuple[dict, dict]:
    graph = json.loads(FIXTURE_GRAPH.read_text(encoding="utf-8"))
    manifest = json.loads(FIXTURE_MANIFEST.read_text(encoding="utf-8"))
    return graph, manifest


def _graph_owned_runtime(graph, manifest, facts):
    graph = copy.deepcopy(graph)
    manifest = copy.deepcopy(manifest)
    for family in ("development", "combat", "sanity"):
        graph.setdefault("family_runtime_ownership", {})[family] = "graph"
        graph.setdefault("legacy_surface_lifecycle", {})[family] = "hidden"
        promo = manifest.setdefault("family_promotion_eligibility", {}).setdefault(
            family, {},
        )
        promo["runtime_ownership"] = "graph"
        promo["promotion_eligible"] = True
    return coc_rules_runtime.RulesRuntime(
        graph, ruleset_id="coc7", graph_manifest=manifest,
        package_manifest=_PROMOTED_PACKAGE,
        facts_provider=lambda: facts,
        ruleset_adapter=coc_rulesets.get_rule_graph_adapter("coc7"),
    )


def _facts() -> dict:
    return coc_rules_runtime.facts_from_state({}, {}, ruleset_id="coc7")


def _context_grant(runtime, family: str) -> dict:
    result = runtime.context({"family": family, "kind": "procedure"})
    assert result["status"] == "ok", result
    return result["card_grant"]


def _host_provider(ref):
    return {
        _DAMAGE: {
            "investigator_id": "thomas-hayes",
            "current_hp": 11,
            "max_hp": 11,
        },
    }.get(ref, {})


def _lookup_executor(plan, decision_id, selected):
    kind = str((plan.get("command") or {}).get("kind") or "")
    payload = dict((plan.get("command") or {}).get("payload") or {})
    if kind == "skill_describe":
        skill = payload.get("skill") or "Persuade"
        return {
            "requested": [skill],
            "skills": {skill: {"summary": "test-prose"}},
            "missing": [],
        }
    if kind == "catalog_search":
        secret = "spell" in (payload.get("kinds") or [])
        return {
            "ok": True,
            "candidates": [
                {
                    "entity_id": "eq.test.handgun" if not secret else "spell:test-secret",
                    "kind": "spell" if secret else "weapon",
                    "secret": secret,
                    "name": "test",
                },
            ],
        }
    if kind == "build_scale":
        return {
            "scale": {"build": payload.get("build"), "verdict": "average human"},
        }
    if kind == "cash_assets":
        return {
            "credit_rating": payload.get("credit_rating"),
            "living_standard": "Average",
            "cash": 40,
        }
    return {"probe": True, "kind": kind}


class _ExecutorProbe:
    def __init__(self):
        self.calls: list[dict] = []

    def __call__(self, plan, decision_id, selected):
        payload = dict((plan.get("command") or {}).get("payload") or {})
        kind = str((plan.get("command") or {}).get("kind") or "")
        self.calls.append({
            "kind": kind,
            "payload": payload,
            "decision_id": decision_id,
        })
        if kind == "damage":
            amount = payload.get("amount") or "1"
            if isinstance(amount, str) and amount.lstrip("+-").isdigit():
                value = abs(int(amount))
            else:
                value = 1
            direction = str(payload.get("kind") or "damage")
            current = int(payload.get("current_hp") or 11)
            maximum = int(payload.get("max_hp") or 11)
            after = (
                min(maximum, current + value)
                if direction == "heal"
                else max(0, current - value)
            )
            return {
                "kind": direction,
                "amount": value,
                "hp_before": current,
                "hp_after": after,
                "max_hp": maximum,
            }
        if kind == "sanity_check":
            return {
                "source": payload.get("source"),
                "success": False,
                "san_loss": 1,
                "san_before": int(payload.get("current_san") or 50),
                "san_after": int(payload.get("current_san") or 50) - 1,
            }
        return {"probe": True, "kind": kind}


def test_fixture_cites_extracted_rulebook_not_pdf():
    graph, manifest = _load_fixture_graph()
    assert graph["coverage"]["development"] == "partial"
    assert graph["coverage"]["combat"] == "partial"
    assert graph["coverage"]["sanity"] == "partial"
    assert graph["coverage"]["magic"] == "unresolved"
    nodes = {node["node_id"]: node for node in graph["nodes"]}
    assert nodes[_SKILL]["properties"]["family_id"] == "development"
    assert nodes[_SKILL]["properties"]["context_only"] is True
    assert nodes[_DAMAGE]["properties"]["family_id"] == "combat"
    assert "decision:coc7:sanity:non-session-loss" not in nodes
    tables = {
        (node.get("properties") or {}).get("source_table")
        for node in graph["nodes"]
        if node.get("node_kind") == "rule"
    }
    assert "skill-descriptions.json" in tables
    assert "build-scale.json" in tables
    assert "cash-assets.json" in tables
    assert "damage.json" in tables
    assert "sanity.json" in tables
    hp = nodes["resource:coc7:hp"]["evidence_span_ids"]
    san = nodes["resource:coc7:san"]["evidence_span_ids"]
    assert "span-derived-attributes-json" in hp
    assert "span-damage-json" in hp
    assert "span-luck-json" not in hp
    assert "span-derived-attributes-json" in san
    assert "span-sanity-json" in san
    findings = manifest.get("findings") or []
    paths = {row.get("path") for row in findings if row.get("code") == "source_ambiguity"}
    assert "/rule-family:coc7:development" in paths
    assert "/decision:coc7:combat:apply-damage/heal" in paths
    assert "/decision:coc7:combat:apply-damage/integer-amount" in paths
    assert "/decision:coc7:combat:apply-damage/major-wound" in paths
    assert "/rule-family:coc7:sanity" in paths
    assert "/exception:coc7:sanity:check-then-loss-uncompiled" in paths
    assert "/coverage/magic" in paths


def test_damage_compiled_claims_match_damage_json():
    source = json.loads((_RULES_JSON / "damage.json").read_text(encoding="utf-8"))
    assert source["delta_sign"] == "negative"
    assert source["dice_kind"] == "damage"
    assert source["requires_die"] is True
    assert source["requires_roll_id"] is True
    assert source["requires_roll_total"] is True
    assert source["requires_resource_before_delta_after"] is True
    assert source["non_percentile"] is True
    assert source["source_rule_id"] == "core.damage.roll"
    graph, _manifest = _load_fixture_graph()
    nodes = {node["node_id"]: node for node in graph["nodes"]}
    rule = nodes["rule:coc7:combat:hp-damage"]
    props = rule["properties"]
    assert props["source_table"] == "damage.json"
    assert props["source_rule_id"] == source["source_rule_id"]
    assert props["delta_sign"] == source["delta_sign"]
    assert props["dice_kind"] == source["dice_kind"]
    assert props["requires_die"] is source["requires_die"]
    assert props["requires_roll_id"] is source["requires_roll_id"]
    assert props["requires_roll_total"] is source["requires_roll_total"]
    assert props["requires_resource_before_delta_after"] is (
        source["requires_resource_before_delta_after"]
    )
    assert props["non_percentile"] is source["non_percentile"]
    decision = nodes[_DAMAGE]
    impl = decision["properties"]["implementation"]
    assert impl["payload_constants"]["kind"] == "damage"
    slot_names = {slot["name"] for slot in impl["payload_slots"]}
    assert "kind" not in slot_names
    assert "amount" in slot_names
    amount = nodes["input-slot:coc7:combat:amount"]["properties"]
    assert amount["value_type"] == "die"
    assert amount["requires_die"] is True
    name = decision["name"].lower()
    assert "heal" not in name
    assert "integer" not in name
    effect = nodes["effect:coc7:combat:hp-change"]
    assert effect["properties"]["delta_sign"] == "negative"
    assert "heal" not in effect["name"].lower()
    findings = json.loads(FIXTURE_MANIFEST.read_text(encoding="utf-8")).get("findings") or []
    by_path = {row["path"]: row["message"] for row in findings if row.get("code") == "source_ambiguity"}
    assert "healing family" in by_path["/decision:coc7:combat:apply-damage/heal"]
    assert "requires_die" in by_path["/decision:coc7:combat:apply-damage/integer-amount"]


def test_sanity_compiled_claims_match_sanity_json():
    source = json.loads((_RULES_JSON / "sanity.json").read_text(encoding="utf-8"))
    assert "source_rule_id" not in source
    assert source["temporary_insanity_loss_threshold"] == 5
    assert source["indefinite_insanity_daily_fraction"] == 0.2
    assert source["max_san"]["formula"] == "99 - cthulhu_mythos"
    assert source["max_san"]["base_max"] == 99
    assert source["max_san"]["subtract"] == "cthulhu_mythos_current_skill"
    involuntary = source["failed_san_roll_involuntary_action"]
    assert involuntary["applies_when"] == "sanity_roll_outcome == failure"
    assert involuntary["kinds"] == [
        "jump_in_fright",
        "cry_out",
        "involuntary_movement",
        "involuntary_combat_action",
        "freeze",
    ]
    assert source["bout_duration"]["real_time_rounds"] == "1D10"
    assert source["bout_duration"]["summary_hours"] == "1D10"
    assert "success_if_roll_lte_effective_target" not in source
    assert "loss_success" not in source
    assert "loss_failure" not in source
    graph, manifest = _load_fixture_graph()
    nodes = {node["node_id"]: node for node in graph["nodes"]}
    temp = nodes["rule:coc7:sanity:temp-insanity-threshold"]["properties"]
    assert temp["source_table"] == "sanity.json"
    assert temp["temporary_insanity_loss_threshold"] == (
        source["temporary_insanity_loss_threshold"]
    )
    indefinite = nodes["rule:coc7:sanity:indefinite-daily-fraction"]["properties"]
    assert indefinite["indefinite_insanity_daily_fraction"] == (
        source["indefinite_insanity_daily_fraction"]
    )
    max_san = nodes["rule:coc7:sanity:max-san"]["properties"]
    assert max_san["formula"] == source["max_san"]["formula"]
    assert max_san["base_max"] == source["max_san"]["base_max"]
    assert max_san["subtract"] == source["max_san"]["subtract"]
    failed = nodes["rule:coc7:sanity:failed-roll-involuntary-action"]["properties"]
    assert failed["applies_when"] == involuntary["applies_when"]
    assert failed["kinds"] == involuntary["kinds"]
    bout = nodes["rule:coc7:sanity:bout-duration"]["properties"]
    assert bout["real_time_rounds"] == source["bout_duration"]["real_time_rounds"]
    assert bout["summary_hours"] == source["bout_duration"]["summary_hours"]
    compiled_rule_text = " ".join(
        node["name"].lower()
        for node in graph["nodes"]
        if node.get("node_kind") == "rule" and (node.get("properties") or {}).get("family_id") == "sanity"
    )
    assert "percentile" not in compiled_rule_text
    assert "clamps at 0" not in compiled_rule_text
    assert "loss_success" not in compiled_rule_text
    exception = nodes[_SANITY_CHECK_UNCOMPILED]
    assert exception["node_kind"] == "exception"
    assert exception["properties"]["uncompiled"] is True
    absent = exception["properties"]["absent_from_source"]
    assert "percentile_check_against_current_san" in absent
    assert "loss_success_loss_failure_selection" in absent
    assert "san_floor_zero_clamp" in absent
    findings = manifest.get("findings") or []
    check_finding = next(
        row for row in findings
        if row.get("path") == "/exception:coc7:sanity:check-then-loss-uncompiled"
    )
    assert check_finding["code"] == "source_ambiguity"
    assert "absence" in check_finding["message"]


def test_context_projects_lookup_cards():
    graph, manifest = _load_fixture_graph()
    runtime = _graph_owned_runtime(graph, manifest, _facts())
    result = runtime.context({"family": "development", "kind": "procedure"})
    assert result["status"] == "ok", result
    refs = {card["decision_ref"] for card in result["cards"]}
    assert {_SKILL, _CATALOG, _BUILD, _CASH} <= refs
    assert _DAMAGE not in refs


def test_skill_describe_lookup_is_read_only():
    graph, manifest = _load_fixture_graph()
    runtime = _graph_owned_runtime(graph, manifest, _facts())
    runtime._lookup_executor = _lookup_executor
    result = runtime.context({
        "family": "development",
        "kind": "lookup",
        "lookup_ref": _SKILL,
        "semantic_inputs": {"skill": "Persuade"},
    })
    assert result["status"] == "ok", result
    assert result["lookup"]["execution"] == "canonical-resolver-subsystem"
    assert "Persuade" in result["lookup"]["result"]["skills"]


def test_catalog_search_never_auto_selects_and_keeps_secret():
    graph, manifest = _load_fixture_graph()
    runtime = _graph_owned_runtime(graph, manifest, _facts())
    runtime._lookup_executor = _lookup_executor
    result = runtime.context({
        "family": "development",
        "kind": "lookup",
        "lookup_ref": _CATALOG,
        "semantic_inputs": {"query": "handgun", "kinds": ["spell"]},
    })
    assert result["status"] == "ok", result
    payload = result["lookup"]["result"]
    assert payload["candidate_only"] is True
    assert payload["selected"] is None
    assert payload["secret"] is True
    assert payload["candidates"][0]["secret"] is True


def test_catalog_search_requires_query():
    graph, manifest = _load_fixture_graph()
    runtime = _graph_owned_runtime(graph, manifest, _facts())
    runtime._lookup_executor = _lookup_executor
    result = runtime.context({
        "family": "development",
        "kind": "lookup",
        "lookup_ref": _CATALOG,
        "semantic_inputs": {},
    })
    assert result["status"] == "missing_semantic_input"
    assert "query" in list((result.get("failure") or {}).get("missing") or [])


def test_build_and_cash_lookups():
    graph, manifest = _load_fixture_graph()
    runtime = _graph_owned_runtime(graph, manifest, _facts())
    runtime._lookup_executor = _lookup_executor
    build = runtime.context({
        "family": "development",
        "kind": "lookup",
        "lookup_ref": _BUILD,
        "semantic_inputs": {"build": 0},
    })
    assert build["status"] == "ok", build
    assert build["lookup"]["result"]["scale"]["build"] == 0
    cash = runtime.context({
        "family": "development",
        "kind": "lookup",
        "lookup_ref": _CASH,
        "semantic_inputs": {"credit_rating": 20},
    })
    assert cash["status"] == "ok", cash
    assert cash["lookup"]["result"]["credit_rating"] == 20
    bad = runtime.context({
        "family": "development",
        "kind": "lookup",
        "lookup_ref": _CASH,
        "semantic_inputs": {"credit_rating": 20.0},
    })
    assert bad["status"] == "invalid_semantic_input"


def test_lookup_cannot_settle():
    graph, manifest = _load_fixture_graph()
    runtime = _graph_owned_runtime(graph, manifest, _facts())
    grant = _context_grant(runtime, "development")
    probe = _ExecutorProbe()
    result = runtime.settle({
        "decision_ref": _SKILL,
        "semantic_inputs": {"skill": "Persuade"},
    }, "lookup:thomas:skill:1", card_grant=grant, executor=probe)
    assert result["status"] == "no_candidate_in_compiled_scope"
    assert "never rules.settle" in result["failure"]["message"]
    assert probe.calls == []


def test_damage_settle_replay_and_conflict():
    graph, manifest = _load_fixture_graph()
    runtime = _graph_owned_runtime(graph, manifest, _facts())
    runtime._host_locked_provider = _host_provider
    grant = _context_grant(runtime, "combat")
    probe = _ExecutorProbe()
    args = {
        "decision_ref": _DAMAGE,
        "semantic_inputs": {"amount": "1D6"},
    }
    first = runtime.settle(args, "damage:thomas:fall:1", card_grant=grant, executor=probe)
    assert first["status"] == "settled", first
    assert first["settlement"]["result"]["session"] is False
    assert first["settlement"]["result"]["kind"] == "damage"
    assert first["settlement"]["result"]["hp_after"] == 10
    assert probe.calls[0]["payload"]["kind"] == "damage"
    assert probe.calls[0]["payload"]["amount"] == "1D6"
    probe.calls.clear()
    replay = runtime.settle(args, "damage:thomas:fall:1", card_grant=grant, executor=probe)
    assert replay["status"] == "settled"
    assert probe.calls == []
    conflict = runtime.settle({
        "decision_ref": _DAMAGE,
        "semantic_inputs": {"amount": "1D4"},
    }, "damage:thomas:fall:1", card_grant=grant, executor=probe)
    assert conflict["status"] == "decision_conflict"
    assert probe.calls == []


def test_damage_rejects_heal_as_unknown_slot():
    graph, manifest = _load_fixture_graph()
    runtime = _graph_owned_runtime(graph, manifest, _facts())
    runtime._host_locked_provider = _host_provider
    grant = _context_grant(runtime, "combat")
    probe = _ExecutorProbe()
    result = runtime.settle({
        "decision_ref": _DAMAGE,
        "semantic_inputs": {"amount": "1D6", "kind": "heal"},
    }, "damage:thomas:heal:1", card_grant=grant, executor=probe)
    assert result["status"] == "unknown_semantic_input"
    assert probe.calls == []


def test_sanity_check_then_loss_is_uncompiled():
    graph, manifest = _load_fixture_graph()
    runtime = _graph_owned_runtime(graph, manifest, _facts())
    nodes = {node["node_id"] for node in graph["nodes"]}
    assert "decision:coc7:sanity:non-session-loss" not in nodes
    cards = runtime.context({"family": "sanity", "kind": "procedure"})
    assert cards["status"] == "no_candidate_in_compiled_scope"
    assert cards["cards"] == []
    probe = _ExecutorProbe()
    exception = runtime.settle({
        "decision_ref": _SANITY_CHECK_UNCOMPILED,
        "semantic_inputs": {},
    }, "san:thomas:exception:1", card_grant=None, executor=probe)
    assert exception["status"] == "no_candidate_in_compiled_scope"
    assert "uncompiled" in exception["failure"]["message"]
    assert probe.calls == []


def test_shadow_no_double_execution_same_seed(campaign_ws, tmp_path: Path):
    graph, manifest = _load_fixture_graph()
    log_path = tmp_path / "shadow-no-double.jsonl"
    off = tmp_path / "off"
    on_ws = tmp_path / "on"
    shutil.copytree(campaign_ws["workspace"], off)
    shutil.copytree(campaign_ws["workspace"], on_ws)
    rel = campaign_ws["campaign_dir"].relative_to(campaign_ws["workspace"])

    def clone(root):
        return {
            "workspace": root,
            "campaign_dir": root / rel,
            "campaign_id": campaign_ws["campaign_id"],
            "investigator_id": campaign_ws["investigator_id"],
        }

    args = {
        "investigator": campaign_ws["investigator_id"],
        "amount": "1",
        "kind": "damage",
        "source": "test fall",
        "seed": 7,
        "decision_id": "no-double-damage-1",
    }
    baseline = _run(clone(off), "rules.damage", args)
    assert baseline["ok"] is True, baseline
    coc_rules_runtime.configure_shadow(
        ruleset_id="coc7", family="combat", runtime_owner="shadow",
        graph=graph, graph_manifest=manifest, log_path=log_path,
    )
    try:
        armed = _run(clone(on_ws), "rules.damage", args)
        assert armed["ok"] is True, armed
    finally:
        coc_rules_runtime.reset_shadow_config()
    baseline_hp = baseline["data"]["hp_after"]
    armed_hp = armed["data"]["hp_after"]
    assert baseline_hp == armed_hp
    rows = _shadow_rows(log_path)
    assert len(rows) == 1


def test_shadow_graph_absent_skips_without_blocking(campaign_ws, tmp_path: Path):
    log_path = tmp_path / "shadow-absent.jsonl"
    coc_rules_runtime.configure_shadow(
        ruleset_id="coc7", family="development", runtime_owner="shadow",
        graph=None, graph_manifest=None, log_path=log_path,
    )
    try:
        described = _run(campaign_ws, "rules.skill_describe", {"skill": "Persuade"})
        assert described["ok"] is True, described
    finally:
        coc_rules_runtime.reset_shadow_config()
    rows = _shadow_rows(log_path)
    assert rows
    assert rows[0]["status"] == "skipped"
    assert rows[0]["skip_reason"] == "graph_absent"


def test_pre_slice_golden_legacy_envelopes(campaign_ws):
    golden = json.loads(GOLDEN_PATH.read_text(encoding="utf-8"))
    skill = _run(campaign_ws, "rules.skill_describe", {"skill": "Persuade"})
    pinned = _strip_golden_envelope(skill)
    assert pinned["ok"] == golden["skill_describe"]["ok"]
    assert pinned["data_keys"] == golden["skill_describe"]["data_keys"]
    assert "Persuade" in (skill["data"].get("skills") or {})
    catalog = _run(campaign_ws, "rules.catalog_search", {"query": "handgun"})
    assert catalog["ok"] == golden["catalog_search"]["ok"]
    assert catalog["data"]["candidate_only"] is True
    assert catalog["data"]["selected"] is None
    build = _run(campaign_ws, "rules.build_scale", {"build": 0})
    assert build["ok"] == golden["build_scale"]["ok"]
    cash = _run(campaign_ws, "rules.cash_assets", {"credit_rating": 20})
    assert cash["ok"] == golden["cash_assets"]["ok"]
    assert cash["data"]["credit_rating"] == golden["cash_assets"]["credit_rating"]
    damage = _run(campaign_ws, "rules.damage", {
        "investigator": campaign_ws["investigator_id"],
        "amount": "1",
        "kind": "damage",
        "source": "golden fall",
        "seed": 3,
        "decision_id": "golden-damage",
    })
    assert damage["ok"] == golden["damage"]["ok"]
    assert damage["data"]["hp_after"] == golden["damage"]["hp_after"]
    sanity = _run(campaign_ws, "rules.sanity_check", {
        "investigator": campaign_ws["investigator_id"],
        "source": "golden corpse",
        "loss_success": "0",
        "loss_failure": "1",
        "seed": 3,
        "decision_id": "golden-san",
    })
    assert sanity["ok"] == golden["sanity_check"]["ok"]
    assert sanity["data"]["san_loss"] == golden["sanity_check"]["san_loss"]


def _shadow_rows(path: Path) -> list[dict]:
    if not path.is_file():
        return []
    return [
        json.loads(line)
        for line in path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]


def _normalized_tool_envelope(result: dict) -> dict:
    missing = [key for key in _ENVELOPE_KEYS if key not in result]
    if missing:
        raise AssertionError(f"envelope missing keys: {missing}")
    hints = result["hints"]
    if not isinstance(hints, list):
        raise AssertionError("hints must be a list")
    return {
        "ok": result["ok"],
        "data": result["data"],
        "warnings": list(result["warnings"]),
        "hints": [hint for hint in hints if not str(hint).startswith(_SCENE_HINT_PREFIX)],
    }


def _strip_golden_envelope(result: dict) -> dict:
    row = _normalized_tool_envelope(result)
    data = dict(row["data"] or {})
    for key in ("roll_id", "request_digest", "receipt_id", "integrity_digest"):
        data.pop(key, None)
    return {
        "ok": row["ok"],
        "warnings": row["warnings"],
        "hints": row["hints"],
        "data_keys": sorted(data),
    }
