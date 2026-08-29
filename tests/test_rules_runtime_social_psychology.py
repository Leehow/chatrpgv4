#!/usr/bin/env python3
"""R4b tests: RulesRuntime social + psychology family settlements.

Exercises the runtime against the R1 three-family fixture graph (a
VALIDATION/DEVELOPMENT COPY kept under ``tests/fixtures/``; the packaged
coc7 rule-graph.json stays the R3 healing artifact until integration
re-accepts the three-family build):

- **Social** (spec §11.2): ONE settlement combining adjudication + bound
  roll.  The card carries Keeper-selected approach/goal/motive/evidence-refs/
  leverage; provenance validation fails closed on malformed semantics; the
  bound check is machine-derived from the adjudication result (skill,
  difficulty, bonus/penalty, NPC/goal identity) and is settled ONLY when
  feasibility == ``roll`` — automatic/conditional results never roll.  No
  second model-authored transfer reaches the check executor.
- **Psychology** (spec §11.3): two settlements under TWO decision refs and
  TWO decision ids.  ``observe-concealed`` freezes the observation identity
  (inference ceiling + concealed outcome) keyed by its semantic decision_id;
  ``realize-player-safe`` binds the frozen record via the paired decision_id
  (host re-attach; no reroll, no re-execution).  The realization's
  player-visible projection is EXACTLY {external_behavior}; concealed dice/
  outcome never enter it, and a leaky adapter fails closed.
- Grant gate: context() issues one grant per projected card set; settle
  requires it (missing/forged/never-projected/stale all fail closed).
- Shadow wiring: `maybe_shadow_compare_social_psychology` engages only when
  the family resolves to shadow (config-armed in tests); legacy executes
  once; no-double-execution discipline identical to the healing comparator.
"""
from __future__ import annotations

import copy
import importlib.util
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path("plugins/coc-keeper/scripts")))
from toolbox_test_support import *  # noqa: E402,F401,F403
import coc_rules_runtime  # noqa: E402

FIXTURE_GRAPH = Path("tests/fixtures/coc7-rule-graph-three-family.json")
FIXTURE_MANIFEST = Path("tests/fixtures/coc7-rule-graph-manifest-three-family.json")


def _load_fixture_graph() -> tuple[dict, dict]:
    graph = json.loads(FIXTURE_GRAPH.read_text(encoding="utf-8"))
    manifest = json.loads(FIXTURE_MANIFEST.read_text(encoding="utf-8"))
    return graph, manifest


def _coc7_resolver():
    path = Path("plugins/coc-keeper/rulesets/coc7/resolver.py")
    spec = importlib.util.spec_from_file_location(
        "coc7_resolver_r4b_runtime_tests", path,
    )
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


_SOCIAL_PROMOTED_PACKAGE = {
    "rule_families": [
        {"family_id": "social", "runtime_owner": "graph", "legacy_surface": "hidden"},
        {"family_id": "psychology", "runtime_owner": "graph", "legacy_surface": "hidden"},
    ],
}


def _graph_owned_social_psychology_runtime(graph, manifest, facts):
    """Promote social/psychology to graph-owned in an in-memory copy.

    Never touches the packaged artifacts: the promotion is test-local so the
    R4b composed settlements can be exercised while the package keeps the
    families legacy/visible (spec: no Keeper-visible change in this pass).
    """
    graph = copy.deepcopy(graph)
    manifest = copy.deepcopy(manifest)
    for family in ("social", "psychology"):
        graph.setdefault("family_runtime_ownership", {})[family] = "graph"
        graph.setdefault("legacy_surface_lifecycle", {})[family] = "hidden"
        promo = manifest.setdefault("family_promotion_eligibility", {}).setdefault(
            family, {},
        )
        promo["runtime_ownership"] = "graph"
    return coc_rules_runtime.RulesRuntime(
        graph, ruleset_id="coc7", graph_manifest=manifest,
        package_manifest=_SOCIAL_PROMOTED_PACKAGE,
        facts_provider=lambda: facts,
    )


def _social_facts() -> dict:
    return coc_rules_runtime.facts_from_state(
        {}, {}, ruleset_id="coc7",
    )


def _context_grant(runtime, family: str) -> dict:
    result = runtime.context({"family": family, "kind": "procedure"})
    assert result["status"] == "ok", result
    return result["card_grant"]


_PSYCHOLOGY_HOST = {
    "decision:coc7:psychology:observe-concealed": {
        "observer_skill": 65,
        "target_opposing_social": 45,
        "observable_facts": ["npc_fact:npc-test/fact-1"],
    },
    "decision:coc7:psychology:realize-player-safe": {},
}
_SOCIAL_HOST = {
    "decision:coc7:social:adjudicate-difficulty": {
        "npc_defense": 55, "leverage_one_level": True,
    },
}


def _psychology_host_provider(ref):
    return dict(_PSYCHOLOGY_HOST.get(ref, {}))


def _social_host_provider(ref):
    return dict(_SOCIAL_HOST.get(ref, {}))


class _ExecutorProbe:
    """Record ``executor(plan, decision_id, selected)`` invocations.

    Adjudication results are contract-shaped (the R4 resolver contract);
    the ``social_difficulty`` return carries feasibility + approach_skill +
    final_difficulty + dice so the runtime can machine-derive the bound
    check.  ``feasibility`` is configurable per test.
    """

    def __init__(self, feasibility: str = "roll"):
        self.calls: list[dict] = []
        self.feasibility = feasibility

    def __call__(self, plan, decision_id, selected):
        self.calls.append({
            "kind": plan["command"]["kind"],
            "requested_kind": plan["command"]["kind"],
            "phase": plan["command"]["phase"],
            "payload": {**plan["command"]["payload"]},
            "decision_id": decision_id,
        })
        kind = plan["command"]["kind"]
        if kind == "social_difficulty":
            return {
                "feasibility": self.feasibility,
                "approach_skill": "Persuade",
                "final_difficulty": "hard",
                "base_difficulty": "regular",
                "motive_adjustment": 1,
                "bonus_dice": 0,
                "penalty_dice": 0,
            }
        if kind == "psychology_check_contract":
            return {
                "skill": "Psychology",
                "inference_depth": "deep_conflict" if self.feasibility == "roll" else "immediate_intent",
                "outcome": "hard" if self.feasibility == "roll" else "regular",
                "misread_policy": "none",
            }
        if kind == "psychology_policy":
            payload = plan["command"]["payload"]
            behavior = payload.get("external_behavior") or "无言行"
            return {
                "player_projection": {"external_behavior": behavior},
                "concealed_result": {
                    "inference_ceiling": payload.get("inference_ceiling"),
                },
            }
        return {"probe": True, "requested_kind": kind}


# --------------------------------------------------------------------------- #
# Social: one settlement combining adjudication + bound roll (spec §11.2)
# --------------------------------------------------------------------------- #
def test_social_settle_roll_binds_one_machine_derived_check(tmp_path: Path):
    graph, manifest = _load_fixture_graph()
    runtime = _graph_owned_social_psychology_runtime(
        graph, manifest, _social_facts(),
    )
    runtime._host_locked_provider = lambda ref: {
        "npc_defense": 55, "leverage_one_level": False,
    }
    grant = _context_grant(runtime, "social")
    probe = _ExecutorProbe()
    supporting = {
        "description": "以信件为佐证",
        "level": 1,
        "provenance": "player-source",
    }

    result = runtime.settle({
        "decision_ref": "decision:coc7:social:adjudicate-difficulty",
        "semantic_inputs": {
            "approach": "persuade",
            "goal": "承认篡改了档案",
            "motive_direction": "oppose",
            "motive_intensity": 1,
            "motive_evidence": ["npc_agenda:npc-test"],
            "described_action": "出示档案与证人证词",
            "supporting_action": supporting,
        },
    }, "social:thomas:library:adjudicate-1", card_grant=grant, executor=probe)

    assert result["status"] == "settled"
    assert result["family"] == "social"
    settlement = result["settlement"]
    assert settlement["existing_result_envelope"] is True
    adjudication = settlement["result"]["adjudication"]
    assert adjudication["feasibility"] == "roll"
    # Exactly two executor invocations: adjudication then the bound check.
    assert [call["kind"] for call in probe.calls] == [
        "social_difficulty", "check",
    ]
    bound = settlement["result"]["bound_check"]
    assert bound["requested_kind"] == "check"
    # The check payload is machine-derived (probe echoes what it received).
    assert settlement["result"]["bound_check_plan"]["machine_derived"] is True
    assert probe.calls[1]["decision_id"] == "social:thomas:library:adjudicate-1"
    # One settlement, one roll max: the check executor was invoked exactly once.
    assert result["next_decisions"] == []
    assert result["visibility"] == "keeper-only"
    payload = probe.calls[0]["payload"]
    assert payload["supporting_action"] == supporting
    # Host leverage is off; sa.level 1 is the sole source of the one-level cap.
    policy = _coc7_resolver().social_difficulty(
        payload, payload.get("npc_defense"),
    )
    assert policy["supporting_action"]["level"] == 1
    assert policy["leverage_one_level"] is True
    assert policy["strategic_adjustment"] == -1
    assert policy["final_difficulty"] == "hard"
    without = _coc7_resolver().social_difficulty(
        {
            **payload,
            "supporting_action": {**supporting, "level": 0},
        },
        payload.get("npc_defense"),
    )
    assert without["leverage_one_level"] is False
    assert without["final_difficulty"] == "extreme"


def test_social_settle_automatic_never_rolls(tmp_path: Path):
    graph, manifest = _load_fixture_graph()
    runtime = _graph_owned_social_psychology_runtime(
        graph, manifest, _social_facts(),
    )
    runtime._host_locked_provider = _social_host_provider
    grant = _context_grant(runtime, "social")
    probe = _ExecutorProbe(feasibility="automatic")
    result = runtime.settle({
        "decision_ref": "decision:coc7:social:adjudicate-difficulty",
        "semantic_inputs": {
            "approach": "persuade",
            "goal": "交出信件",
            "motive_direction": "support",
            "motive_intensity": 1,
            "motive_evidence": ["npc_agenda:npc-test"],
            "described_action": "恳切请求",
            "supporting_action": None,
        },
    }, "social:thomas:library:adj-auto", card_grant=grant, executor=probe)
    assert result["status"] == "settled"
    # Adjudication only: feasibility=automatic => NEVER invokes the check.
    assert [call["requested_kind"] for call in probe.calls] == ["social_difficulty"]
    assert "bound_check" not in result["settlement"]["result"]


def test_social_settle_provenance_validation_fails_closed(tmp_path: Path):
    graph, manifest = _load_fixture_graph()
    runtime = _graph_owned_social_psychology_runtime(
        graph, manifest, _social_facts(),
    )
    runtime._host_locked_provider = _social_host_provider
    grant = _context_grant(runtime, "social")
    probe = _ExecutorProbe()
    # Motive evidence missing while intensity > 0 is the R4 contract's own
    # provenance requirement; the runtime must fail closed BEFORE adjudication.
    result = runtime.settle({
        "decision_ref": "decision:coc7:social:adjudicate-difficulty",
        "semantic_inputs": {
            "approach": "persuade",
            "goal": "交出信件",
            "motive_direction": "oppose",
            "motive_intensity": 1,
            "motive_evidence": [],
            "described_action": "恳切请求",
            "supporting_action": None,
        },
    }, "social:thomas:library:adj-provenance", card_grant=grant, executor=probe)
    assert result["status"] == "invalid_semantic_input"
    assert probe.calls == []
    assert "motive_evidence" in result["failure"].get("missing", [])


def test_social_settle_supporting_action_bare_string_fails_closed(tmp_path: Path):
    graph, manifest = _load_fixture_graph()
    runtime = _graph_owned_social_psychology_runtime(
        graph, manifest, _social_facts(),
    )
    runtime._host_locked_provider = _social_host_provider
    grant = _context_grant(runtime, "social")
    probe = _ExecutorProbe()
    result = runtime.settle({
        "decision_ref": "decision:coc7:social:adjudicate-difficulty",
        "semantic_inputs": {
            "approach": "persuade",
            "goal": "交出信件",
            "motive_direction": "oppose",
            "motive_intensity": 1,
            "motive_evidence": ["npc_agenda:npc-test"],
            "described_action": "出示档案",
            "supporting_action": "以信件为佐证",
        },
    }, "social:thomas:library:adj-bare-sa", card_grant=grant, executor=probe)
    assert result["status"] == "invalid_semantic_input"
    assert result["failure"]["code"] == "invalid_semantic_input"
    assert "supporting_action" in result["failure"]["fields"]
    assert probe.calls == []


def test_social_settle_grant_required_and_stale_after_change(tmp_path: Path):
    graph, manifest = _load_fixture_graph()
    state = {"revision": 1}
    runtime = _graph_owned_social_psychology_runtime(
        graph, manifest, _social_facts(),
    )
    runtime._host_locked_provider = _social_host_provider
    runtime._state_revision_provider = lambda: str(state["revision"])
    grant = _context_grant(runtime, "social")
    probe = _ExecutorProbe()
    base = {
        "decision_ref": "decision:coc7:social:adjudicate-difficulty",
        "semantic_inputs": {
            "approach": "persuade",
            "goal": "交出信件",
            "motive_direction": "neutral",
            "motive_intensity": 0,
            "motive_evidence": [],
            "described_action": "恳切请求",
            "supporting_action": None,
        },
    }
    # Never-projected ref cannot settle.
    missing = runtime.settle(base, "social:grant:never", executor=probe)
    assert missing["status"] == "rule_decision_stale"
    # Live grant settles.
    ok = runtime.settle(base, "social:grant:ok", card_grant=grant, executor=probe)
    assert ok["status"] == "settled"
    # Stale after state change: same grant, new revision.
    state["revision"] = 2
    stale = runtime.settle(base, "social:grant:stale", card_grant=grant, executor=probe)
    assert stale["status"] == "rule_decision_stale"


# --------------------------------------------------------------------------- #
# Psychology: two settlements, two decision ids, frozen binding (spec §11.3)
# --------------------------------------------------------------------------- #
def test_psychology_observe_freezes_and_realize_binds(tmp_path: Path):
    graph, manifest = _load_fixture_graph()
    runtime = _graph_owned_social_psychology_runtime(
        graph, manifest, _social_facts(),
    )
    runtime._host_locked_provider = _psychology_host_provider
    grant = _context_grant(runtime, "psychology")
    probe = _ExecutorProbe()

    observe_id = "psychology:thomas:library:observe-concealed"
    observed = runtime.settle({
        "decision_ref": "decision:coc7:psychology:observe-concealed",
        "semantic_inputs": {"question": "他害怕什么?"},
    }, observe_id, card_grant=grant, executor=probe)
    assert observed["status"] == "settled"
    assert observed["visibility"] == "concealed-result"
    # Frozen observation identity exists under the semantic observe id.
    frozen = runtime._psychology_frozen[observe_id]
    assert frozen["decision_id"] == observe_id
    assert frozen["inference_ceiling"]  # host-frozen from the executor record
    # The observe executor ran exactly once; nothing player-visible.
    assert [call["requested_kind"] for call in probe.calls] == [
        "psychology_check_contract",
    ]

    realize_id = "psychology:thomas:library:realize-player-safe"
    realization = runtime.settle({
        "decision_ref": "decision:coc7:psychology:realize-player-safe",
        "semantic_inputs": {"external_behavior": "他下意识攥紧了口袋。"},
    }, realize_id, card_grant=grant, executor=probe)
    assert realization["status"] == "settled"
    projection = realization["settlement"]["result"]["player_projection"]
    assert projection == {"external_behavior": "他下意识攥紧了口袋。"}
    # The realization executor got ONLY the realize plan: no check, no reroll.
    assert [call["requested_kind"] for call in probe.calls[1:]] == [
        "psychology_policy",
    ]
    assert realization["player_projection"]["external_behavior"].startswith("他")


def test_psychology_realize_requires_frozen_observation(tmp_path: Path):
    graph, manifest = _load_fixture_graph()
    runtime = _graph_owned_social_psychology_runtime(
        graph, manifest, _social_facts(),
    )
    grant = _context_grant(runtime, "psychology")
    probe = _ExecutorProbe()
    result = runtime.settle({
        "decision_ref": "decision:coc7:psychology:realize-player-safe",
        "semantic_inputs": {"external_behavior": "他后退了一步。"},
    }, "psychology:thomas:library:realize-player-safe",
        card_grant=grant, executor=probe)
    assert result["status"] == "rule_decision_not_applicable"
    assert probe.calls == []


def test_psychology_realize_unpaired_decision_id_fails_closed(tmp_path: Path):
    graph, manifest = _load_fixture_graph()
    runtime = _graph_owned_social_psychology_runtime(
        graph, manifest, _social_facts(),
    )
    grant = _context_grant(runtime, "psychology")
    probe = _ExecutorProbe()
    result = runtime.settle({
        "decision_ref": "decision:coc7:psychology:realize-player-safe",
        "semantic_inputs": {"external_behavior": "他后退了一步。"},
    }, "psychology:thomas:library:not-a-realize-id",
        card_grant=grant, executor=probe)
    assert result["status"] == "invalid_decision_id"
    assert probe.calls == []


def test_psychology_realize_cannot_leak_concealed_fields(tmp_path: Path):
    graph, manifest = _load_fixture_graph()
    runtime = _graph_owned_social_psychology_runtime(
        graph, manifest, _social_facts(),
    )
    runtime._host_locked_provider = _psychology_host_provider
    grant = _context_grant(runtime, "psychology")
    observe_id = "psychology:thomas:library:observe-concealed"
    observed = runtime.settle({
        "decision_ref": "decision:coc7:psychology:observe-concealed",
        "semantic_inputs": {"question": "他害怕什么?"},
    }, observe_id, card_grant=grant, executor=_ExecutorProbe())
    assert observed["status"] == "settled"

    def leaky(plan, decision_id, selected):
        return {
            "player_projection": {
                "external_behavior": "他攥紧了口袋。",
                "outcome": "hard",
                "roll_id": "psychology:roll-123",
            },
            "concealed_result": {"inference_ceiling": "deep_conflict"},
        }

    realization = runtime.settle({
        "decision_ref": "decision:coc7:psychology:realize-player-safe",
        "semantic_inputs": {"external_behavior": "他攥紧了口袋。"},
    }, "psychology:thomas:library:realize-player-safe",
        card_grant=grant, executor=leaky)
    assert realization["status"] == "concealed_projection_violation"
    assert "outcome" in realization["failure"].get("leaked", [])
    assert "roll_id" in realization["failure"].get("leaked", [])


def test_psychology_realize_no_rng_reuses_frozen_ceiling(tmp_path: Path):
    graph, manifest = _load_fixture_graph()
    runtime = _graph_owned_social_psychology_runtime(
        graph, manifest, _social_facts(),
    )
    runtime._host_locked_provider = _psychology_host_provider
    grant = _context_grant(runtime, "psychology")
    observe_id = "psychology:thomas:library:observe-concealed"
    observe_probe = _ExecutorProbe()
    runtime.settle({
        "decision_ref": "decision:coc7:psychology:observe-concealed",
        "semantic_inputs": {"question": "他害怕什么?"},
    }, observe_id, card_grant=grant, executor=observe_probe)
    recovered = {
        "player_projection": {
            "external_behavior": "他攥紧了口袋。",
        },
    }
    realize_probe = _ExecutorProbe()

    def realize_executor(plan, decision_id, selected):
        ceiling = plan["command"]["payload"].get("inference_ceiling")
        realize_probe(plan, decision_id, selected)
        return {**recovered, "concealed_result": {"inference_ceiling": ceiling}}

    result = runtime.settle({
        "decision_ref": "decision:coc7:psychology:realize-player-safe",
        "semantic_inputs": {"external_behavior": "他攥紧了口袋。"},
    }, "psychology:thomas:library:realize-player-safe",
        card_grant=grant, executor=realize_executor)
    assert result["status"] == "settled"
    # The realize plan payload carries the FROZEN ceiling, re-attached by the
    # host — never authored by the model.
    plan_payload = realize_probe.calls[0]["payload"]
    assert plan_payload["inference_ceiling"] == (
        runtime._psychology_frozen[observe_id]["inference_ceiling"]
    )
    # Exactly one executor invocation for the realization: no check, no reroll.
    assert [call["requested_kind"] for call in realize_probe.calls] == [
        "psychology_policy",
    ]


def test_psychology_observe_replay_same_decision_id_no_reroll(tmp_path: Path):
    graph, manifest = _load_fixture_graph()
    runtime = _graph_owned_social_psychology_runtime(
        graph, manifest, _social_facts(),
    )
    runtime._host_locked_provider = _psychology_host_provider
    grant = _context_grant(runtime, "psychology")
    probe = _ExecutorProbe()
    args = {
        "decision_ref": "decision:coc7:psychology:observe-concealed",
        "semantic_inputs": {"question": "他害怕什么?"},
    }
    first = runtime.settle(args, "psychology:thomas:library:observe-concealed",
                           card_grant=grant, executor=probe)
    assert first["status"] == "settled"
    probe.calls.clear()
    replay = runtime.settle(args, "psychology:thomas:library:observe-concealed",
                            card_grant=grant, executor=probe)
    assert replay["status"] == "settled"
    # Frozen observation reused: NO second executor invocation (no reroll).
    assert probe.calls == []


# --------------------------------------------------------------------------- #
# Shadow wiring: comparator extends to social/psychology legacy ops
# --------------------------------------------------------------------------- #
def test_shadow_social_compare_records_row_legacy_untouched(campaign_ws, tmp_path: Path):
    graph, manifest = _load_fixture_graph()
    log_path = tmp_path / "shadow-social.jsonl"
    coc_rules_runtime.configure_shadow(
        ruleset_id="coc7", family="social", runtime_owner="shadow",
        graph=graph, graph_manifest=manifest, log_path=log_path,
    )
    try:
        result = _run(campaign_ws, "rules.social_adjudicate", {
            "investigator": campaign_ws["investigator_id"],
            "npc_id": _npc_id(campaign_ws),
            "conversation_window_id": "conv-main",
            "commitment_id": "shadow-social-1",
            "approach": "persuade",
            "goal_summary": "承认篡改了档案",
            "npc_defense_value": 55,
            "motive": {
                "direction": "neutral", "intensity": 0,
            },
            "decision_id": "shadow-social-1",
        })
        assert result["ok"] is True, result
        rows = _shadow_rows(log_path)
        assert len(rows) == 1
        assert rows[0]["family"] == "social"
        assert rows[0]["tool"] == "rules.social_adjudicate"
        assert rows[0]["decision_ref"] == (
            "decision:coc7:social:adjudicate-difficulty"
        )
        # The legacy op executed exactly once (goal persisted in resolutions).
        social_doc = json.loads((
            campaign_ws["campaign_dir"] / "save" / "social-resolutions.json"
        ).read_text(encoding="utf-8"))
        assert any(
            row.get("decision_id") == "shadow-social-1"
            for row in social_doc.get("resolutions", {}).values()
        )
    finally:
        coc_rules_runtime.reset_shadow_config()


def test_shadow_psychology_observe_records_row(campaign_ws, tmp_path: Path):
    graph, manifest = _load_fixture_graph()
    log_path = tmp_path / "shadow-psych.jsonl"
    coc_rules_runtime.configure_shadow(
        ruleset_id="coc7", family="psychology", runtime_owner="shadow",
        graph=graph, graph_manifest=manifest, log_path=log_path,
    )
    try:
        result = _run(campaign_ws, "rules.psychology_observe", {
            "investigator": campaign_ws["investigator_id"],
            "npc_id": _npc_id(campaign_ws),
            "conversation_window_id": "conv-main",
            "observation_revision": 0,
            "question": "他害怕什么?",
            "observable_fact_refs": ["npc_fact:" + _npc_id(campaign_ws) + "/fact-knott-commission"],
            "seed": 11,
            "decision_id": "shadow-psych-1",
        })
        assert result["ok"] is True, result
        rows = _shadow_rows(log_path)
        assert len(rows) == 1
        assert rows[0]["family"] == "psychology"
        assert rows[0]["decision_ref"] == (
            "decision:coc7:psychology:observe-concealed"
        )
        # Legacy executed once: observation persisted, one concealed roll.
        doc = json.loads((
            campaign_ws["campaign_dir"] / "save" / "psychology-observations.json"
        ).read_text(encoding="utf-8"))
        assert doc["observations"]
    finally:
        coc_rules_runtime.reset_shadow_config()


def test_shadow_social_noop_when_family_legacy(campaign_ws, tmp_path: Path):
    graph, manifest = _load_fixture_graph()
    log_path = tmp_path / "shadow-nope.jsonl"
    coc_rules_runtime.configure_shadow(
        ruleset_id="coc7", family="social", runtime_owner="legacy",
        graph=graph, graph_manifest=manifest, log_path=log_path,
    )
    try:
        result = _run(campaign_ws, "rules.social_adjudicate", {
            "investigator": campaign_ws["investigator_id"],
            "npc_id": _npc_id(campaign_ws),
            "conversation_window_id": "conv-main",
            "commitment_id": "shadow-nope-1",
            "approach": "persuade",
            "goal_summary": "承认篡改了档案",
            "npc_defense_value": 55,
            "decision_id": "shadow-nope-1",
        })
        assert result["ok"] is True, result
        assert _shadow_rows(log_path) == []
    finally:
        coc_rules_runtime.reset_shadow_config()


# --------------------------------------------------------------------------- #
# Parity vs legacy: same seed, same deterministic outcome (spec §11.2/§11.3)
# --------------------------------------------------------------------------- #
def test_psychology_observe_same_seed_same_outcome_as_legacy(
    campaign_ws, tmp_path: Path,
):
    """Deterministic-seed parity: runtime settle observe with seed S yields the
    same concealed outcome as legacy rules.psychology_observe with seed S.

    The runtime's injected executor mirrors the legacy path exactly: the
    psychology_check_contract result is deterministic given the host-locked
    values, and the percentile check consumes the same seeded RNG.
    """
    import random

    graph, manifest = _load_fixture_graph()
    runtime = _graph_owned_social_psychology_runtime(
        graph, manifest, _social_facts(),
    )
    # Mirror the legacy fixture resolution: sheet has no Psychology skill
    # (resolver default 10) and no authored defense (regular difficulty).
    runtime._host_locked_provider = lambda ref: {
        "decision:coc7:psychology:observe-concealed": {
            "observer_skill": 10,
            "target_opposing_social": None,
            "observable_facts": ["npc_fact:npc-test/fact-1"],
        },
    }.get(ref, {})
    grant = _context_grant(runtime, "psychology")
    observe_id = "psychology:thomas:library:observe-concealed"
    seed = 42

    # Legacy first (rolls a concealed die with seed S).
    legacy = _run(campaign_ws, "rules.psychology_observe", {
        "investigator": campaign_ws["investigator_id"],
        "npc_id": _npc_id(campaign_ws),
        "conversation_window_id": "conv-parity",
        "observation_revision": 0,
        "question": "他害怕什么?",
        "observable_fact_refs": [
            "npc_fact:" + _npc_id(campaign_ws) + "/fact-knott-commission",
        ],
        "seed": seed,
        "decision_id": "parity-obs-legacy",
    })
    assert legacy["ok"] is True, legacy
    legacy_rows = _read_jsonl(
        campaign_ws["campaign_dir"] / "logs" / "rolls.jsonl",
    )
    assert len(legacy_rows) == 1

    calls: list[dict] = []

    def executor(plan, decision_id, selected):
        calls.append({"kind": plan["command"]["kind"], "payload": dict(plan["command"]["payload"])})
        if plan["command"]["kind"] == "psychology_check_contract":
            payload = plan["command"]["payload"]
            target = int(payload.get("observer_skill") or 10)
            check = _percentile_check_contract(target, seed=seed)
            return {
                "skill": "Psychology",
                "inference_depth": "deep_conflict",
                "outcome": check["outcome"],
                "misread_policy": "none",
                "roll_id": f"{decision_id}:roll",
            }
        return {"probe": True, "requested_kind": plan["command"]["kind"]}

    settled = runtime.settle({
        "decision_ref": "decision:coc7:psychology:observe-concealed",
        "semantic_inputs": {"question": "他害怕什么?"},
    }, observe_id, card_grant=grant, executor=executor)
    assert settled["status"] == "settled", settled
    # Same seeded percentile receipt: the runtime observation outcome equals
    # the legacy op's roll outcome (identical resolver thread + identical seed).
    runtime_outcome = settled["settlement"]["result"]["concealed"]["outcome"]
    assert runtime_outcome == legacy_rows[0].get("outcome")
    assert len(calls) == 1  # observe settles exactly one contract resolution


def _percentile_check_contract(target: int, seed: int) -> dict:
    """The single deterministic percentile check the legacy path settles."""
    import random
    import coc_roll

    rng = random.Random(seed)
    return coc_roll.percentile_check(target, "regular", 0, 0, rng=rng)


def test_social_settle_bound_check_payload_is_machine_derived(tmp_path: Path):
    """The bound check payload NEVER reconsults model semantic inputs."""
    graph, manifest = _load_fixture_graph()
    runtime = _graph_owned_social_psychology_runtime(
        graph, manifest, _social_facts(),
    )
    runtime._host_locked_provider = _social_host_provider
    grant = _context_grant(runtime, "social")
    calls: list[dict] = []

    def executor(plan, decision_id, selected):
        calls.append({"kind": plan["command"]["kind"], "payload": dict(plan["command"]["payload"])})
        if plan["command"]["kind"] == "social_difficulty":
            return {
                "feasibility": "roll",
                "approach_skill": "Fast Talk",
                "final_difficulty": "extreme",
                "bonus_dice": 1,
                "penalty_dice": 0,
            }
        return {"check_output": True}

    result = runtime.settle({
        "decision_ref": "decision:coc7:social:adjudicate-difficulty",
        "semantic_inputs": {
            "approach": "fast_talk",
            "goal": "套出真相",
            "motive_direction": "oppose",
            "motive_intensity": 1,
            "motive_evidence": ["npc_agenda:npc-test"],
            "described_action": "旁敲侧击",
            "supporting_action": None,
        },
    }, "social:thomas:library:derived-check", card_grant=grant, executor=executor)
    assert result["status"] == "settled"
    check_call = calls[1]
    # Derived from the ADJUDICATION result (Fast Talk / extreme / 1 bonus) —
    # the model never re-supplied skill/difficulty/NPC/goal.
    assert check_call["payload"]["skill"] == "Fast Talk"
    assert check_call["payload"]["difficulty"] == "extreme"
    assert check_call["payload"]["bonus"] == 1
    assert check_call["payload"]["goal"] == "套出真相"


def test_shadow_psychology_observe_no_double_execution_same_seed(
    campaign_ws, tmp_path: Path,
):
    """Shadow ON vs OFF on the SAME campaign fixture clone: legacy executes
    exactly once in both arms; RNG records identical; only the shadow log
    differs (host-internal, outside the campaign tree)."""
    graph, manifest = _load_fixture_graph()
    log_path = tmp_path / "shadow-psych-no-double.jsonl"
    import shutil

    off = tmp_path / "off"; on_ws = tmp_path / "on"
    shutil.copytree(campaign_ws["workspace"], off)
    shutil.copytree(campaign_ws["workspace"], on_ws)
    rel = campaign_ws["campaign_dir"].relative_to(campaign_ws["workspace"])

    def clone(root):
        return {"workspace": root, "campaign_dir": root / rel,
                "campaign_id": campaign_ws["campaign_id"],
                "investigator_id": campaign_ws["investigator_id"]}

    off_clone = clone(off); on_clone = clone(on_ws)
    args = {
        "investigator": campaign_ws["investigator_id"],
        "npc_id": _npc_id(campaign_ws),
        "conversation_window_id": "conv-no-double",
        "observation_revision": 0,
        "question": "他害怕什么?",
        "observable_fact_refs": [
            "npc_fact:" + _npc_id(campaign_ws) + "/fact-knott-commission",
        ],
        "seed": 7,
        "decision_id": "no-double-psych-1",
    }
    baseline = _run(off_clone, "rules.psychology_observe", args)
    assert baseline["ok"] is True, baseline
    coc_rules_runtime.configure_shadow(
        ruleset_id="coc7", family="psychology", runtime_owner="shadow",
        graph=graph, graph_manifest=manifest, log_path=log_path,
    )
    try:
        armed = _run(on_clone, "rules.psychology_observe", args)
        assert armed["ok"] is True, armed
    finally:
        coc_rules_runtime.reset_shadow_config()
    # RNG consumption identical: exactly ONE roll per arm.
    baseline_rolls = _read_jsonl(
        off_clone["campaign_dir"] / "logs" / "rolls.jsonl",
    )
    armed_rolls = _read_jsonl(
        on_clone["campaign_dir"] / "logs" / "rolls.jsonl",
    )
    assert len(baseline_rolls) == len(armed_rolls) == 1
    assert baseline_rolls[0]["outcome"] == armed_rolls[0]["outcome"]
    # The legacy surface produced the same public payload in both arms; the
    # shadow side never altered or blocked and never re-executed the check.
    assert binary_payload_of(baseline) == binary_payload_of(armed)
    # Host-internal shadow log recorded one row (outside the campaign tree).
    rows = _shadow_rows(log_path)
    assert len(rows) == 1
    assert rows[0]["tool"] == "rules.psychology_observe"


def binary_payload_of(envelope: dict) -> str:
    return json.dumps(
        {k: v for k, v in envelope.get("data", {}).items()
         if k not in ("request_digest", "window_key", "insight_id", "roll_id")},
        ensure_ascii=False, sort_keys=True,
    )


def test_psychology_realize_replay_does_not_reexecute(tmp_path: Path):
    graph, manifest = _load_fixture_graph()
    runtime = _graph_owned_social_psychology_runtime(
        graph, manifest, _social_facts(),
    )
    runtime._host_locked_provider = _psychology_host_provider
    grant = _context_grant(runtime, "psychology")
    observe_id = "psychology:thomas:library:observe-concealed"
    observe_executor = _ExecutorProbe()
    runtime.settle({
        "decision_ref": "decision:coc7:psychology:observe-concealed",
        "semantic_inputs": {"question": "他害怕什么?"},
    }, observe_id, card_grant=grant, executor=observe_executor)

    realize_args = {
        "decision_ref": "decision:coc7:psychology:realize-player-safe",
        "semantic_inputs": {"external_behavior": "他攥紧了口袋。"},
    }
    realize_id = "psychology:thomas:library:realize-player-safe"
    calls: list[str] = []

    def executor(plan, decision_id, selected):
        calls.append(plan["command"]["kind"])
        return {
            "player_projection": {"external_behavior": "他攥紧了口袋。"},
            "concealed_result": {
                "inference_ceiling": plan["command"]["payload"].get("inference_ceiling"),
            },
        }

    first = runtime.settle(realize_args, realize_id, card_grant=grant, executor=executor)
    assert first["status"] == "settled"
    assert calls == ["psychology_policy"]
    calls.clear()
    replay = runtime.settle(realize_args, realize_id, card_grant=grant, executor=executor)
    assert replay["status"] == "settled"
    # Host re-attach idempotency: identical decision_id + semantics replayed
    # from the record WITHOUT invoking the executor (no reroll, no
    # re-execution).
    assert calls == []
    assert replay["player_projection"] == {"external_behavior": "他攥紧了口袋。"}


def test_psychology_realize_changed_input_is_decision_conflict(tmp_path: Path):
    graph, manifest = _load_fixture_graph()
    runtime = _graph_owned_social_psychology_runtime(
        graph, manifest, _social_facts(),
    )
    runtime._host_locked_provider = _psychology_host_provider
    grant = _context_grant(runtime, "psychology")
    observe_id = "psychology:thomas:library:observe-concealed"
    runtime.settle({
        "decision_ref": "decision:coc7:psychology:observe-concealed",
        "semantic_inputs": {"question": "他害怕什么?"},
    }, observe_id, card_grant=grant, executor=_ExecutorProbe())

    realize_id = "psychology:thomas:library:realize-player-safe"
    calls: list[str] = []

    def executor(plan, decision_id, selected):
        calls.append(plan["command"]["kind"])
        return {
            "player_projection": {"external_behavior": "他攥紧了口袋。"},
            "concealed_result": {
                "inference_ceiling": plan["command"]["payload"].get(
                    "inference_ceiling",
                ),
            },
        }

    first = runtime.settle({
        "decision_ref": "decision:coc7:psychology:realize-player-safe",
        "semantic_inputs": {"external_behavior": "他攥紧了口袋。"},
    }, realize_id, card_grant=grant, executor=executor)
    assert first["status"] == "settled"
    assert calls == ["psychology_policy"]
    conflict = runtime.settle({
        "decision_ref": "decision:coc7:psychology:realize-player-safe",
        "semantic_inputs": {"external_behavior": "他后退了一步。"},
    }, realize_id, card_grant=grant, executor=executor)
    assert conflict["status"] == "decision_conflict"
    assert conflict["failure"]["code"] == "decision_conflict"
    assert "executor not invoked" in conflict["failure"]["message"]
    assert calls == ["psychology_policy"]


def _shadow_rows(path: Path) -> list[dict]:
    if not path.is_file():
        return []
    return [
        json.loads(line)
        for line in path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]


def _npc_id(ws) -> str:
    npcs = json.loads(
        (ws["campaign_dir"] / "scenario" / "npc-agendas.json").read_text(
            encoding="utf-8",
        )
    ).get("npcs") or []
    assert npcs, "the-haunting fixture must author at least one NPC"
    return str(npcs[0]["npc_id"])
