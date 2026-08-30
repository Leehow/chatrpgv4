#!/usr/bin/env python3
"""R5 tests: RulesRuntime ordinary-check / Push / Luck / resource family.

Exercises the runtime against the check-luck fixture graph (a VALIDATION
COPY under ``tests/fixtures/``; packaged coc7 rule-graph.json stays the
healing artifact):

- **Ordinary check**: one settlement, one bound roll (resolver.check).
- **Push**: only after a failed non-pushed check; consequences locked first.
- **Luck spend**: receipt-bound; not on Luck rolls; not together with Push.
- **Resource delta**: host-internal generic HP/MP/Luck mutation with provenance.
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

FIXTURE_GRAPH = Path("tests/fixtures/coc7-rule-graph-check-luck.json")
FIXTURE_MANIFEST = Path("tests/fixtures/coc7-rule-graph-manifest-check-luck.json")
GOLDEN_PATH = Path("tests/fixtures/check-luck-pre-slice-golden.json")
_SCENE_HINT_PREFIX = "scene state was updated"
_ENVELOPE_KEYS = ("ok", "data", "warnings", "hints")

_ORDINARY = "decision:coc7:core-check:ordinary-check"
_RESOURCE = "decision:coc7:core-check:resource-delta"
_PUSH = "decision:coc7:push-luck:pushed-roll"
_LUCK_SPEND = "decision:coc7:push-luck:luck-spend"
_LUCK_ROLL = "decision:coc7:push-luck:luck-roll"

_PROMOTED_PACKAGE = {
    "rule_families": [
        {"family_id": "core-check", "runtime_owner": "graph", "legacy_surface": "hidden"},
        {"family_id": "push-luck", "runtime_owner": "graph", "legacy_surface": "hidden"},
    ],
}

_STAKES = {
    "on_success": "the focused test action succeeds",
    "on_failure": "the focused test action does not succeed",
}


def _load_fixture_graph() -> tuple[dict, dict]:
    graph = json.loads(FIXTURE_GRAPH.read_text(encoding="utf-8"))
    manifest = json.loads(FIXTURE_MANIFEST.read_text(encoding="utf-8"))
    return graph, manifest


def _graph_owned_runtime(
    graph, manifest, facts, *, projection_audience="keeper",
):
    graph = copy.deepcopy(graph)
    manifest = copy.deepcopy(manifest)
    for family in ("core-check", "push-luck"):
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
        projection_audience=projection_audience,
    )


def _facts() -> dict:
    return coc_rules_runtime.facts_from_state({}, {}, ruleset_id="coc7")


def _context_grant(runtime, family: str) -> dict:
    result = runtime.context({"family": family, "kind": "procedure"})
    assert result["status"] == "ok", result
    return result["card_grant"]


def test_keeper_context_never_projects_host_internal_decisions():
    graph, manifest = _load_fixture_graph()
    runtime = _graph_owned_runtime(graph, manifest, _facts())
    result = runtime.context({"family": "core-check", "kind": "procedure"})
    assert result["status"] == "ok", result
    refs = {card["decision_ref"] for card in result["cards"]}
    assert _ORDINARY in refs
    assert _RESOURCE not in refs

    requested = runtime.context({
        "family": "core-check",
        "kind": "procedure",
        "selected_affordance_ids": [_RESOURCE],
    })
    assert requested["status"] == "no_candidate_in_compiled_scope"
    assert requested["unresolved"] == [_RESOURCE]


def _host_provider(ref):
    return {
        _ORDINARY: {"target": 50, "investigator_id": "thomas-hayes"},
        _PUSH: {
            "original_check_decision_id": "check:thomas:library:ordinary-1",
            "investigator_id": "thomas-hayes",
            "target": 50,
            "difficulty": "regular",
            "bonus": 0,
            "penalty": 0,
            "skill": "Library Use",
        },
        _LUCK_SPEND: {
            "source_roll_id": "roll-ordinary-1",
            "investigator_id": "thomas-hayes",
            "original_check_decision_id": "check:thomas:library:ordinary-1",
        },
        _LUCK_ROLL: {"target": 45, "investigator_id": "thomas-hayes"},
        _RESOURCE: {
            "actor_id": "thomas-hayes",
            "current": 11,
            "maximum": 11,
        },
    }.get(ref, {})


class _ExecutorProbe:
    def __init__(self, outcome: str = "failure"):
        self.calls: list[dict] = []
        self.outcome = outcome

    def __call__(self, plan, decision_id, selected):
        payload = dict((plan.get("command") or {}).get("payload") or {})
        kind = str((plan.get("command") or {}).get("kind") or "")
        self.calls.append({
            "kind": kind,
            "payload": payload,
            "decision_id": decision_id,
        })
        if kind == "check":
            return {
                "outcome": self.outcome,
                "success": self.outcome not in {"failure", "fumble"},
                "roll": 80 if self.outcome == "failure" else 1,
                "target": payload.get("target") or 50,
                "skill": payload.get("skill"),
                "characteristic": payload.get("characteristic"),
            }
        if kind == "luck_spend":
            return {
                "points": payload.get("points"),
                "source_roll_id": payload.get("source_roll_id"),
                "luck_after": 40,
            }
        if kind == "resource_delta":
            current = int(payload.get("current") or 11)
            amount = payload.get("amount") or 1
            if isinstance(amount, bool) or not isinstance(amount, int):
                amount = 1
            direction = str(payload.get("direction") or "loss")
            after = current - amount if direction == "loss" else current + amount
            return {
                "resource": payload.get("resource"),
                "direction": direction,
                "amount": amount,
                "before": current,
                "after": after,
                "delta": after - current,
            }
        return {"probe": True, "kind": kind}


def _ordinary_inputs(**extra):
    row = {
        "skill": "Library Use",
        "difficulty": "regular",
        "goal": "find the parish register",
        "stakes": dict(_STAKES),
        "difficulty_basis": "keeper_judgment",
    }
    row.update(extra)
    return row


def _push_inputs(**extra):
    row = {
        "method_changed": "cross-check the index",
        "failure_consequence": "the archive closes",
        "player_confirmed_risk": True,
    }
    row.update(extra)
    return row


def test_fixture_cites_extracted_rulebook_not_pdf():
    graph, manifest = _load_fixture_graph()
    assert graph["coverage"]["core-check"] == "partial"
    assert graph["coverage"]["push-luck"] == "partial"
    nodes = {node["node_id"]: node for node in graph["nodes"]}
    assert nodes[_ORDINARY]["properties"]["family_id"] == "core-check"
    assert nodes[_PUSH]["properties"]["family_id"] == "push-luck"
    tables = {
        (node.get("properties") or {}).get("source_table")
        for node in graph["nodes"]
        if node.get("node_kind") == "rule"
    }
    assert "percentile-check.json" in tables
    assert "pushed-roll.json" in tables
    assert "luck.json" in tables
    assert "derived-attributes.json" in tables
    hp = nodes["resource:coc7:hp"]["evidence_span_ids"]
    mp = nodes["resource:coc7:mp"]["evidence_span_ids"]
    luck = nodes["resource:coc7:luck"]["evidence_span_ids"]
    assert "span-luck-json" not in hp
    assert "span-derived-attributes-json" in hp
    assert "span-damage-json" in hp
    assert "span-luck-json" not in mp
    assert "span-derived-attributes-json" in mp
    assert "span-spells-json" in mp
    assert luck == ["span-luck-json"]
    arithmetic = nodes["rule:coc7:core-check:resource-arithmetic"]
    assert arithmetic["properties"]["source_table"] == "derived-attributes.json"
    findings = manifest.get("findings") or []
    paths = {row.get("path") for row in findings if row.get("code") == "source_ambiguity"}
    assert "/rule-family:coc7:push-luck/luck-recovery-uncompiled" in paths
    assert "/rule:coc7:core-check:resource-arithmetic" in paths


def test_ordinary_check_one_bound_roll(tmp_path: Path):
    graph, manifest = _load_fixture_graph()
    runtime = _graph_owned_runtime(graph, manifest, _facts())
    runtime._host_locked_provider = _host_provider
    grant = _context_grant(runtime, "core-check")
    probe = _ExecutorProbe("failure")
    result = runtime.settle({
        "decision_ref": _ORDINARY,
        "semantic_inputs": _ordinary_inputs(),
    }, "check:thomas:library:ordinary-1", card_grant=grant, executor=probe)
    assert result["status"] == "settled", result
    assert [call["kind"] for call in probe.calls] == ["check"]
    settlement = result["settlement"]["result"]
    assert settlement["outcome"] == "failure"
    assert list(settlement["next_continuations"]) == [_PUSH, _LUCK_SPEND]


def test_ordinary_check_characteristic_without_skill(tmp_path: Path):
    graph, manifest = _load_fixture_graph()
    runtime = _graph_owned_runtime(graph, manifest, _facts())
    runtime._host_locked_provider = _host_provider
    grant = _context_grant(runtime, "core-check")
    probe = _ExecutorProbe("regular")
    result = runtime.settle({
        "decision_ref": _ORDINARY,
        "semantic_inputs": {
            "characteristic": "INT",
            "difficulty": "regular",
            "goal": "recall the connection",
            "stakes": dict(_STAKES),
            "difficulty_basis": "keeper_judgment",
        },
    }, "check:thomas:library:idea-1", card_grant=grant, executor=probe)
    assert result["status"] == "settled", result
    assert probe.calls[0]["payload"]["characteristic"] == "INT"


def test_ordinary_check_replay_and_conflict(tmp_path: Path):
    graph, manifest = _load_fixture_graph()
    runtime = _graph_owned_runtime(graph, manifest, _facts())
    runtime._host_locked_provider = _host_provider
    grant = _context_grant(runtime, "core-check")
    probe = _ExecutorProbe("failure")
    args = {"decision_ref": _ORDINARY, "semantic_inputs": _ordinary_inputs()}
    first = runtime.settle(args, "check:thomas:library:ordinary-1",
                           card_grant=grant, executor=probe)
    assert first["status"] == "settled"
    probe.calls.clear()
    replay = runtime.settle(args, "check:thomas:library:ordinary-1",
                            card_grant=grant, executor=probe)
    assert replay["status"] == "settled"
    assert probe.calls == []
    conflict = runtime.settle({
        "decision_ref": _ORDINARY,
        "semantic_inputs": _ordinary_inputs(skill="Spot Hidden"),
    }, "check:thomas:library:ordinary-1", card_grant=grant, executor=probe)
    assert conflict["status"] == "decision_conflict"
    assert probe.calls == []


def test_fumble_does_not_project_push_or_luck(tmp_path: Path):
    graph, manifest = _load_fixture_graph()
    runtime = _graph_owned_runtime(graph, manifest, _facts())
    runtime._host_locked_provider = _host_provider
    grant = _context_grant(runtime, "core-check")
    probe = _ExecutorProbe("fumble")
    result = runtime.settle({
        "decision_ref": _ORDINARY,
        "semantic_inputs": _ordinary_inputs(),
    }, "check:thomas:library:fumble-1", card_grant=grant, executor=probe)
    assert result["status"] == "settled"
    assert list(result["settlement"]["result"]["next_continuations"]) == []


def test_push_requires_failed_original_and_locked_consequence(tmp_path: Path):
    graph, manifest = _load_fixture_graph()
    runtime = _graph_owned_runtime(graph, manifest, _facts())
    runtime._host_locked_provider = _host_provider
    check_grant = _context_grant(runtime, "core-check")
    probe = _ExecutorProbe("failure")
    runtime.settle({
        "decision_ref": _ORDINARY,
        "semantic_inputs": _ordinary_inputs(),
    }, "check:thomas:library:ordinary-1", card_grant=check_grant, executor=probe)
    push_grant = _context_grant(runtime, "push-luck")
    missing = runtime.settle({
        "decision_ref": _PUSH,
        "semantic_inputs": {"method_changed": "try the index"},
    }, "push:thomas:library:1", card_grant=push_grant, executor=probe)
    assert missing["status"] == "missing_semantic_input"
    probe.calls.clear()
    pushed = runtime.settle({
        "decision_ref": _PUSH,
        "semantic_inputs": _push_inputs(),
    }, "push:thomas:library:1", card_grant=push_grant, executor=probe)
    assert pushed["status"] == "settled", pushed
    assert pushed["settlement"]["result"]["pushed"] is True
    assert pushed["settlement"]["result"]["player_confirmed_risk"] is True
    assert [call["kind"] for call in probe.calls] == ["check"]


def test_push_rejects_success_and_second_push(tmp_path: Path):
    graph, manifest = _load_fixture_graph()
    runtime = _graph_owned_runtime(graph, manifest, _facts())
    runtime._host_locked_provider = _host_provider
    grant = _context_grant(runtime, "core-check")
    probe = _ExecutorProbe("regular")
    runtime.settle({
        "decision_ref": _ORDINARY,
        "semantic_inputs": _ordinary_inputs(),
    }, "check:thomas:library:ordinary-1", card_grant=grant, executor=probe)
    push_grant = _context_grant(runtime, "push-luck")
    denied = runtime.settle({
        "decision_ref": _PUSH,
        "semantic_inputs": _push_inputs(
            method_changed="try again",
            failure_consequence="worse",
        ),
    }, "push:thomas:library:1", card_grant=push_grant, executor=probe)
    assert denied["status"] == "rule_decision_not_applicable"


def test_push_without_player_confirmation_fails_closed(tmp_path: Path):
    graph, manifest = _load_fixture_graph()
    runtime = _graph_owned_runtime(graph, manifest, _facts())
    runtime._host_locked_provider = _host_provider
    check_grant = _context_grant(runtime, "core-check")
    probe = _ExecutorProbe("failure")
    runtime.settle({
        "decision_ref": _ORDINARY,
        "semantic_inputs": _ordinary_inputs(),
    }, "check:thomas:library:ordinary-1", card_grant=check_grant, executor=probe)
    push_grant = _context_grant(runtime, "push-luck")
    probe.calls.clear()
    missing = runtime.settle({
        "decision_ref": _PUSH,
        "semantic_inputs": {
            "method_changed": "cross-check the index",
            "failure_consequence": "the archive closes",
        },
    }, "push:thomas:library:1", card_grant=push_grant, executor=probe)
    assert missing["status"] == "missing_semantic_input"
    assert "player_confirmed_risk" in list(
        (missing.get("failure") or {}).get("missing") or []
    )
    assert probe.calls == []
    denied_false = runtime.settle({
        "decision_ref": _PUSH,
        "semantic_inputs": _push_inputs(player_confirmed_risk=False),
    }, "push:thomas:library:1", card_grant=push_grant, executor=probe)
    assert denied_false["status"] == "invalid_semantic_input"
    assert probe.calls == []
    denied_text = runtime.settle({
        "decision_ref": _PUSH,
        "semantic_inputs": _push_inputs(player_confirmed_risk="yes"),
    }, "push:thomas:library:1", card_grant=push_grant, executor=probe)
    assert denied_text["status"] == "invalid_semantic_input"
    assert "do not infer confirmation" in denied_text["failure"]["message"]
    assert probe.calls == []
    settled = runtime.settle({
        "decision_ref": _PUSH,
        "semantic_inputs": _push_inputs(),
    }, "push:thomas:library:1", card_grant=push_grant, executor=probe)
    assert settled["status"] == "settled", settled
    assert [call["kind"] for call in probe.calls] == ["check"]


def test_luck_spend_and_push_are_mutex(tmp_path: Path):
    graph, manifest = _load_fixture_graph()
    runtime = _graph_owned_runtime(graph, manifest, _facts())
    runtime._host_locked_provider = _host_provider
    grant = _context_grant(runtime, "core-check")
    probe = _ExecutorProbe("failure")
    runtime.settle({
        "decision_ref": _ORDINARY,
        "semantic_inputs": _ordinary_inputs(),
    }, "check:thomas:library:ordinary-1", card_grant=grant, executor=probe)
    luck_grant = _context_grant(runtime, "push-luck")
    spent = runtime.settle({
        "decision_ref": _LUCK_SPEND,
        "semantic_inputs": {"points": 2},
    }, "luck:thomas:library:1", card_grant=luck_grant, executor=probe)
    assert spent["status"] == "settled", spent
    denied = runtime.settle({
        "decision_ref": _PUSH,
        "semantic_inputs": _push_inputs(
            method_changed="try again",
            failure_consequence="worse",
        ),
    }, "push:thomas:library:1", card_grant=luck_grant, executor=probe)
    assert denied["status"] == "rule_decision_not_applicable"
    assert "not both" in denied["failure"]["message"]


def test_luck_roll_cannot_spend_luck(tmp_path: Path):
    graph, manifest = _load_fixture_graph()
    runtime = _graph_owned_runtime(graph, manifest, _facts())
    def host(ref):
        if ref == _LUCK_SPEND:
            return {
                "source_roll_id": "roll-luck-1",
                "investigator_id": "thomas-hayes",
                "original_check_decision_id": "luckroll:thomas:library:1",
            }
        return _host_provider(ref)
    runtime._host_locked_provider = host
    grant = _context_grant(runtime, "push-luck")
    probe = _ExecutorProbe("failure")
    rolled = runtime.settle({
        "decision_ref": _LUCK_ROLL,
        "semantic_inputs": {
            "difficulty": "regular",
            "goal": "notice the ambush",
            "stakes": dict(_STAKES),
            "difficulty_basis": "keeper_judgment",
        },
    }, "luckroll:thomas:library:1", card_grant=grant, executor=probe)
    assert rolled["status"] == "settled"
    assert rolled["settlement"]["result"]["luck_roll"] is True
    denied = runtime.settle({
        "decision_ref": _LUCK_SPEND,
        "semantic_inputs": {"points": 1},
    }, "luck:thomas:library:1", card_grant=grant, executor=probe)
    assert denied["status"] == "rule_decision_not_applicable"
    assert "Luck rolls" in denied["failure"]["message"]


def test_resource_delta_host_internal_provenance(tmp_path: Path):
    graph, manifest = _load_fixture_graph()
    runtime = _graph_owned_runtime(
        graph, manifest, _facts(), projection_audience="host-internal",
    )
    runtime._host_locked_provider = _host_provider
    grant = _context_grant(runtime, "core-check")
    probe = _ExecutorProbe()
    result = runtime.settle({
        "decision_ref": _RESOURCE,
        "semantic_inputs": {
            "resource": "mp",
            "direction": "loss",
            "amount": 2,
        },
    }, "resource:thomas:mp:1", card_grant=grant, executor=probe)
    assert result["status"] == "settled", result
    assert result["visibility"] == "keeper-only"
    payload = result["settlement"]["result"]
    assert payload["resource"] == "mp"
    assert payload["provenance"]["decision_id"] == "resource:thomas:mp:1"


def test_shadow_roll_records_row_legacy_untouched(campaign_ws, tmp_path: Path):
    graph, manifest = _load_fixture_graph()
    log_path = tmp_path / "shadow-roll.jsonl"
    coc_rules_runtime.configure_shadow(
        ruleset_id="coc7", family="core-check", runtime_owner="shadow",
        graph=graph, graph_manifest=manifest, log_path=log_path,
    )
    try:
        result = _run(campaign_ws, "rules.roll", {
            "investigator": campaign_ws["investigator_id"],
            "skill": "Library Use",
            "seed": 7,
            "decision_id": "shadow-roll-1",
        })
        assert result["ok"] is True, result
        rows = _shadow_rows(log_path)
        assert len(rows) == 1, rows
        assert rows[0]["family"] == "core-check"
        assert rows[0]["tool"] == "rules.roll"
        assert rows[0].get("decision_ref") == _ORDINARY, rows[0]
        assert len(_read_jsonl(campaign_ws["campaign_dir"] / "logs" / "rolls.jsonl")) == 1
    finally:
        coc_rules_runtime.reset_shadow_config()


def test_shadow_noop_when_family_legacy(campaign_ws, tmp_path: Path):
    graph, manifest = _load_fixture_graph()
    log_path = tmp_path / "shadow-nope.jsonl"
    coc_rules_runtime.configure_shadow(
        ruleset_id="coc7", family="core-check", runtime_owner="legacy",
        graph=graph, graph_manifest=manifest, log_path=log_path,
    )
    try:
        result = _run(campaign_ws, "rules.roll", {
            "investigator": campaign_ws["investigator_id"],
            "skill": "Library Use",
            "seed": 7,
            "decision_id": "shadow-nope-1",
        })
        assert result["ok"] is True, result
        assert _shadow_rows(log_path) == []
    finally:
        coc_rules_runtime.reset_shadow_config()


def test_shadow_graph_absent_skips_and_legacy_runs(campaign_ws, tmp_path: Path):
    log_path = tmp_path / "shadow-absent.jsonl"
    coc_rules_runtime.configure_shadow(
        ruleset_id="coc7", family="core-check", runtime_owner="shadow",
        graph=None, graph_manifest=None, log_path=log_path,
    )
    try:
        result = _run(campaign_ws, "rules.roll", {
            "investigator": campaign_ws["investigator_id"],
            "skill": "Library Use",
            "seed": 7,
            "decision_id": "shadow-absent-1",
        })
        assert result["ok"] is True, result
        rows = _shadow_rows(log_path)
        assert len(rows) == 1
        assert rows[0]["skip_reason"] == "graph_absent"
        assert len(_read_jsonl(campaign_ws["campaign_dir"] / "logs" / "rolls.jsonl")) == 1
    finally:
        coc_rules_runtime.reset_shadow_config()


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
        "skill": "Library Use",
        "seed": 7,
        "decision_id": "no-double-roll-1",
    }
    baseline = _run(clone(off), "rules.roll", args)
    assert baseline["ok"] is True, baseline
    coc_rules_runtime.configure_shadow(
        ruleset_id="coc7", family="core-check", runtime_owner="shadow",
        graph=graph, graph_manifest=manifest, log_path=log_path,
    )
    try:
        armed = _run(clone(on_ws), "rules.roll", args)
        assert armed["ok"] is True, armed
    finally:
        coc_rules_runtime.reset_shadow_config()
    baseline_rolls = _read_jsonl(clone(off)["campaign_dir"] / "logs" / "rolls.jsonl")
    armed_rolls = _read_jsonl(clone(on_ws)["campaign_dir"] / "logs" / "rolls.jsonl")
    assert len(baseline_rolls) == len(armed_rolls) == 1
    assert baseline_rolls[0]["outcome"] == armed_rolls[0]["outcome"]
    assert _normalized_tool_envelope(baseline)["data"]["outcome"] == (
        _normalized_tool_envelope(armed)["data"]["outcome"]
    )
    rows = _shadow_rows(log_path)
    assert len(rows) == 1


def test_pre_slice_golden_legacy_envelopes(campaign_ws):
    golden = json.loads(GOLDEN_PATH.read_text(encoding="utf-8"))
    roll = _run(campaign_ws, "rules.roll", {
        "investigator": campaign_ws["investigator_id"],
        "skill": "Library Use",
        "seed": 7,
        "decision_id": "golden-roll",
    })
    pinned = _strip_golden_envelope(roll)
    assert pinned["ok"] == golden["roll"]["ok"]
    assert pinned["hints"] == golden["roll"]["hints"]
    assert pinned["data_keys"] == golden["roll"]["data_keys"]
    assert roll["data"]["outcome"] == golden["roll_outcome"]
    _failed_roll_for_push(campaign_ws, "golden-push-original")
    pushed = _run(campaign_ws, "rules.push", {
        "original_check_decision_id": "golden-push-original",
        "method_changed": "cross-check the index against the court docket",
        "failure_consequence": "the archive closes before the trail is copied",
        "decision_id": "golden-push",
        "seed": 2,
    })
    assert pushed["ok"] == golden["push"]["ok"]
    assert bool(pushed["data"]["pushed"]) == golden["push"]["pushed"]
    luck_source = _run(campaign_ws, "rules.roll", {
        "investigator": campaign_ws["investigator_id"],
        "skill": "Library Use",
        "target": 50,
        "decision_id": "golden-luck-source",
        "seed": 88,
    })
    spent = _run(campaign_ws, "rules.luck_spend", {
        "investigator": campaign_ws["investigator_id"],
        "points": 1,
        "source_roll_id": luck_source["data"]["roll_id"],
        "decision_id": "golden-luck",
    })
    assert spent["ok"] == golden["luck_spend"]["ok"]
    assert spent["data"]["original_roll"] == golden["luck_spend"]["original_roll"]
    assert spent["data"]["adjusted_roll"] == golden["luck_spend"]["adjusted_roll"]
    delta = _run(campaign_ws, "rules.resource_delta", {
        "actor": campaign_ws["investigator_id"],
        "request": {"resource": "mp", "amount": 1, "direction": "loss"},
        "decision_id": "golden-mp",
    })
    assert delta["ok"] is True, delta
    assert delta["data"]["result"]["delta"] == golden["resource_delta"]["delta"]


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
