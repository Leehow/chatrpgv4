#!/usr/bin/env python3
"""RulesRuntime shadow and promoted execution tests for the healing family.

These exercise the deep in-process RulesRuntime module
(``plugins/coc-keeper/scripts/coc_rules_runtime.py``) and the shadow
comparator used by candidate graphs plus the packaged graph-owned healing path:

- the fixture RuleGraph is built in test setup through the R1 compiler
  (prepare -> accept -> build) from the same bounded healing fixture the R1
  conformance suite uses;
- no-double-execution is proven BYTE-EXACTLY: the same campaign fixture runs
  the same operation with the same decision ids/seed under a frozen clock,
  once with the shadow machinery OFF and once with it ON, and every campaign
  artifact (rolls log, receipts, ledger, state, working-set revisions, all
  logs) must be byte-identical; the ONLY permitted difference is the
  host-internal shadow log (which lives outside the campaign tree);
- the candidate comparator records an explicit difference finding per mandatory §14.1
  axis: capability, phase, semantic inputs, locked inputs, and — where the
  legacy normalized command genuinely lacks data — an explicit
  ``unresolved_legacy`` finding for rule refs, resource effects, visibility,
  and pending-choice semantics (never a silent match);
- a candidate graph/legacy mismatch records exact semantic differences and the legacy
  path still executes once;
- a missing/unloadable graph skips the comparison with a host-internal log
  entry and leaves the legacy path untouched;
- ``context()`` issues a machine-attached card grant bound to campaign +
  ruleset version + graph generation + state revision; ``settle()`` fails
  closed on a missing, forged, never-projected, or stale-after-state-change
  grant (``rule_decision_stale``);
- ownership resolution defaults and manifest pairing rules.

Unit tests pin a synthetic fixture graph (explicit path under tmp_path) so
they never depend on ambient packaged-coc7 discovery. One integration test
loads the real packaged graph through ``load_ruleset_graph`` with an explicit
rulesets root.

The shadow log is host-internal: a JSONL file written only when the shadow
comparator is armed; it is never a canonical receipt and never player-visible.
"""
from __future__ import annotations

import copy
import json
import shutil
import sys
import time as _time
from pathlib import Path

import pytest

sys.path.insert(0, str(Path("plugins/coc-keeper/scripts")))
from toolbox_test_support import *  # noqa: E402,F401,F403
import coc_rules_runtime  # noqa: E402
import coc_rulesets  # noqa: E402
import coc_turn_finalization  # noqa: E402
import test_rule_graph_healing as rg_healing  # noqa: E402


def _fresh_workspace(tmp_path: Path, name: str) -> dict:
    """One independent quick-start workspace (mirrors campaign_ws)."""
    workspace = tmp_path / name
    coc_root = workspace / ".coc"
    campaign_id = f"toolbox-{name}"
    _write_json(
        coc_root / "runtime.json",
        {
            "schema_version": 2,
            "planner": {"kind": "deterministic"},
            "rules": {"kind": "deterministic"},
            "narrator": {"kind": "template"},
            "player": {"kind": "human"},
        },
    )
    quick = coc_starter.quick_start(
        coc_root,
        "the-haunting",
        "thomas-hayes",
        campaign_id=campaign_id,
        title=f"Shadow {name}",
    )
    return {
        "workspace": workspace,
        "coc_root": coc_root,
        "campaign_id": campaign_id,
        "campaign_dir": Path(quick["campaign_dir"]),
        "investigator_id": quick["investigator_id"],
        "quick": quick,
    }


@pytest.fixture(autouse=True)
def _isolate_shadow():
    coc_rules_runtime.reset_shadow_config()
    coc_rules_runtime.clear_runtime_cache()
    yield
    coc_rules_runtime.reset_shadow_config()
    coc_rules_runtime.clear_runtime_cache()


# Pinned unit-fixture slots for first-aid-stabilization. The packaged coc7
# graph (and the compiler's healing_command_shape) treat skill_value as
# host-locked; unit tests pin keeper-semantic so they can assert the
# semantic-vs-locked gates independently of the packaged artifact.
_UNIT_FIRST_AID_PAYLOAD_SLOTS = (
    {"name": "skill_value", "ownership": "keeper-semantic"},
    {"name": "rescuer_id", "ownership": "host-locked"},
    {"name": "pushed", "ownership": "keeper-semantic"},
)


def _build_fixture_graph(tmp_path: Path) -> tuple[dict, dict]:
    """Build a controlled synthetic healing-family graph for unit tests.

    Compiled via the R1 pipeline, then first-aid slots are pinned and the
    graph is loaded back from an explicit path under ``tmp_path`` — never
    from the installed coc7 package.
    """
    rg_healing.coc_rule_graph.set_evidence_root(tmp_path / "rg-evidence")
    rg_healing.coc_rule_graph.clear_accepted_session()
    packet = rg_healing._packet(tmp_path)
    candidate = rg_healing._valid_candidate(packet)
    accepted = rg_healing.coc_rule_graph.accept(packet, candidate)
    assert accepted["ok"] is True, accepted
    built = rg_healing.coc_rule_graph.build([accepted["shard"]])
    assert built["ok"] is True, built
    graph = built["graph"]
    manifest = built["manifest"]
    for node in graph["nodes"]:
        # Runtime-card tests exercise the Keeper projection. The compiler
        # conformance fixture itself marks decisions host-internal because it
        # predates the card surface; normalize only this runtime test copy.
        if node.get("node_kind") == "decision":
            node["audience"] = "keeper"
        if node.get("node_id") == "decision:coc7:healing:first-aid-stabilization":
            impl = (node.get("properties") or {}).get("implementation")
            if isinstance(impl, dict):
                impl["payload_slots"] = [
                    dict(slot) for slot in _UNIT_FIRST_AID_PAYLOAD_SLOTS
                ]
    fixture_dir = tmp_path / "unit-fixture-graph"
    fixture_dir.mkdir(parents=True, exist_ok=True)
    graph_path = fixture_dir / "rule-graph.json"
    manifest_path = fixture_dir / "rule-graph-manifest.json"
    graph_path.write_text(json.dumps(graph), encoding="utf-8")
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    return (
        json.loads(graph_path.read_text(encoding="utf-8")),
        json.loads(manifest_path.read_text(encoding="utf-8")),
    )


def _dying_state(ws) -> None:
    inv = ws["investigator_id"]
    state_path = (
        ws["campaign_dir"] / "save" / "investigator-state" / f"{inv}.json"
    )
    state = json.loads(state_path.read_text(encoding="utf-8"))
    state.update({
        "current_hp": 0,
        "conditions": ["major_wound", "unconscious", "dying"],
    })
    _write_json(state_path, state)


def _shadow_rows(path: Path) -> list[dict]:
    if not path.is_file():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def _rolls(ws) -> list[dict]:
    return _read_jsonl(ws["campaign_dir"] / "logs" / "rolls.jsonl")


def _state_bytes(ws) -> bytes:
    inv = ws["investigator_id"]
    return (
        ws["campaign_dir"] / "save" / "investigator-state" / f"{inv}.json"
    ).read_bytes()


def _inv_state(ws) -> dict:
    inv = ws["investigator_id"]
    return json.loads(
        (ws["campaign_dir"] / "save" / "investigator-state" / f"{inv}.json")
        .read_text(encoding="utf-8")
    )


def _snapshot_tree(root: Path) -> dict[str, bytes]:
    """Byte snapshot of every file below ``root`` (no exclusions)."""
    return {
        str(path.relative_to(root)): path.read_bytes()
        for path in sorted(root.rglob("*"))
        if path.is_file()
    }


_FIXED_ISO = "2026-08-29T13:30:00.000000+00:00"


@pytest.fixture
def _frozen_clocks(monkeypatch, tmp_path: Path):
    """Freeze every wall-clock / filesystem-metadata source in the legacy
    healing path.

    The kernel stamps events/calls/ledger with ``_now_iso()``; the subsystem
    executor stamps the roll row with ``time.gmtime()`` (second granularity);
    the working-set revision signatures hash file identities including
    ``mtime_ns``/``inode`` and, for files outside the campaign dir (e.g.
    ``.coc/investigators/.../character.json``), the absolute clone path.
    All are pinned/relativized so two runs of the same command under the same
    decision ids produce byte-identical artifacts.  The comparison still
    covers path, size, and existence for every touched file.
    """
    monkeypatch.setattr(
        coc_toolbox.coc_operation_kernel, "_now_iso", lambda: _FIXED_ISO
    )
    # coc_toolbox binds its own ``_now_iso`` global from the kernel's runtime
    # exports; patch that binding too (toolbox-calls log rows).
    monkeypatch.setattr(coc_toolbox, "_now_iso", lambda: _FIXED_ISO)
    fixed_gmt = _time.gmtime(0)
    monkeypatch.setattr(_time, "gmtime", lambda *args, **kwargs: fixed_gmt)
    cache = coc_toolbox.coc_operation_kernel.coc_working_set_cache
    real_identity = cache._file_identity

    def frozen_identity(path, campaign_dir):
        identity = real_identity(path, campaign_dir)
        identity["mtime_ns"] = 0
        identity["inode"] = 0
        raw = identity["path"]
        try:
            # Outside-campaign files fall back to an absolute path; relativize
            # to the off/on clone parent and drop the clone-root component so
            # both sides hash the SAME logical path set.
            rel = Path(raw).relative_to(tmp_path)
            identity["path"] = "/".join(rel.parts[1:])
        except ValueError:
            pass
        return identity

    monkeypatch.setattr(cache, "_file_identity", frozen_identity)


def _clone_fixture(fixture_ws: dict, off: Path, on: Path) -> tuple[dict, dict]:
    """Clone one campaign workspace into ``off``/``on`` byte-identically.

    Returns two ``ws`` dicts with the SAME campaign id and the same relative
    campaign-dir layout, so artifact comparison never needs to strip campaign
    identity."""
    shutil.copytree(fixture_ws["workspace"], off)
    shutil.copytree(fixture_ws["workspace"], on)
    rel = fixture_ws["campaign_dir"].relative_to(fixture_ws["workspace"])

    def clone(root: Path) -> dict:
        return {
            "workspace": root,
            "campaign_id": fixture_ws["campaign_id"],
            "campaign_dir": root / rel,
            "investigator_id": fixture_ws["investigator_id"],
        }

    return clone(off), clone(on)


# --------------------------------------------------------------------------- #
# RulesRuntime unit surface (spec §8)
# --------------------------------------------------------------------------- #
def test_runtime_context_projects_cards_with_semantic_refs_only(tmp_path: Path):
    graph, manifest = _build_fixture_graph(tmp_path)
    facts = coc_rules_runtime.facts_from_state(
        {"current_hp": 0, "conditions": ["major_wound", "dying"]},
        {"characteristics": {"CON": 60}, "derived": {"HP": 12}},
    )
    runtime = coc_rules_runtime.RulesRuntime(
        graph, ruleset_id="coc7", graph_manifest=manifest,
        facts_provider=lambda: facts,
    )
    result = runtime.context({"family": "healing", "kind": "procedure"})
    assert result["status"] == "ok"
    assert 1 <= len(result["cards"]) <= 8
    first = next(
        card for card in result["cards"]
        if card["decision_ref"] == "decision:coc7:healing:first-aid-stabilization"
    )
    assert first["family"] == "healing"
    assert "decision:coc7:healing:first-aid-stabilization" == first["decision_ref"]
    assert any(
        slot["name"] == "skill_value" and slot["owner"] == "keeper-semantic"
        for slot in first["required_inputs"]
    )
    assert "rescuer_id" in first["locked_inputs"]
    assert "rule:coc7:healing:first-aid-stabilization" in first["rule_refs"]
    assert first["capability_ref"] == "capability:coc7:first-aid"
    assert first["authority"]["selection"] == "keeper-semantic"
    # Model-safe: no hashes, no file paths, no random ids.
    assert "sha256" not in json.dumps(first)
    assert "RuleGraph" not in json.dumps(first)


def test_runtime_advisory_condition_does_not_become_execution_gate(tmp_path: Path):
    graph, manifest = _build_fixture_graph(tmp_path)
    decision_ref = "decision:coc7:healing:first-aid-stabilization"
    condition_ref = next(
        relation["to_node_id"]
        for relation in graph["relations"]
        if relation.get("relation_kind") == "available-when"
        and relation.get("from_node_id") == decision_ref
    )
    condition = next(
        node for node in graph["nodes"] if node.get("node_id") == condition_ref
    )
    condition["hard_gate"] = False
    facts = coc_rules_runtime.facts_from_state(
        {"current_hp": 8, "conditions": []}, {"derived": {"HP": 12}},
    )
    runtime = coc_rules_runtime.RulesRuntime(
        graph, ruleset_id="coc7", graph_manifest=manifest,
        facts_provider=lambda: facts,
    )
    projected = runtime.context({
        "family": "healing",
        "selected_affordance_ids": [decision_ref],
    })
    assert projected["status"] == "ok", projected
    assert projected["cards"][0]["authority"]["hard_gate"] is False


def test_runtime_hard_condition_fails_closed(tmp_path: Path):
    graph, manifest = _build_fixture_graph(tmp_path)
    decision_ref = "decision:coc7:healing:first-aid-stabilization"
    facts = coc_rules_runtime.facts_from_state(
        {"current_hp": 8, "conditions": []}, {"derived": {"HP": 12}},
    )
    runtime = coc_rules_runtime.RulesRuntime(
        graph, ruleset_id="coc7", graph_manifest=manifest,
        facts_provider=lambda: facts,
    )
    projected = runtime.context({
        "family": "healing",
        "selected_affordance_ids": [decision_ref],
    })
    assert projected["status"] == "no_candidate_in_compiled_scope"
    assert projected["unresolved"] == [decision_ref]


def test_runtime_context_issues_machine_attached_card_grant(tmp_path: Path):
    """context() projects a card grant bound to campaign + ruleset version +
    graph generation + canonical state revision (spec §8.5/§8.6)."""
    graph, manifest = _build_fixture_graph(tmp_path)
    facts = coc_rules_runtime.facts_from_state(
        {"current_hp": 0, "conditions": ["major_wound", "dying"]},
        {"characteristics": {"CON": 60}, "derived": {"HP": 12}},
    )
    runtime = coc_rules_runtime.RulesRuntime(
        graph, ruleset_id="coc7", graph_manifest=manifest,
        campaign_id="campaign-grant-test",
        facts_provider=lambda: facts,
    )
    result = runtime.context({"family": "healing", "kind": "procedure"})
    grant = result["card_grant"]
    assert grant["contract_id"] == "coc.rule-graph-card-grant.v1"
    assert grant["schema_version"] == 1
    assert grant["grant_id"].startswith("card-grant:coc7:healing:")
    binding = grant["binding"]
    assert binding["campaign_id"] == "campaign-grant-test"
    assert binding["ruleset_id"] == "coc7"
    assert binding["ruleset_version"] == manifest["ruleset_version"]
    assert binding["graph_generation"] == manifest["graph_content_digest"]
    assert binding["state_revision"].startswith("sha256:")
    projected = {card["decision_ref"] for card in result["cards"]}
    assert set(grant["decision_refs"]) == projected


def test_runtime_grant_binds_host_lifecycle_and_expires_on_turn_change(
    tmp_path: Path,
):
    graph, manifest = _build_fixture_graph(tmp_path)
    facts = coc_rules_runtime.facts_from_state(
        {"current_hp": 0, "conditions": ["major_wound", "dying"]},
        {"characteristics": {"CON": 60}, "derived": {"HP": 12}},
    )
    lifecycle = {
        "role": "play",
        "phase": "live_turn",
        "stage": "acting",
        "player_turn_epoch": 4,
        "progress_revision": 9,
    }
    runtime = coc_rules_runtime.RulesRuntime(
        graph, ruleset_id="coc7", graph_manifest=manifest,
        campaign_id="campaign-lifecycle-grant",
        facts_provider=lambda: facts,
        grant_context_provider=lambda: lifecycle,
    )
    grant = runtime.context({"family": "healing"})["card_grant"]
    assert grant["binding"] | lifecycle == grant["binding"]
    lifecycle["player_turn_epoch"] = 5
    result = runtime.settle({
        "decision_ref": "decision:coc7:healing:first-aid-stabilization",
        "semantic_inputs": {"skill_value": 99, "pushed": False},
    }, "healing:grant:lifecycle", card_grant=grant)
    assert result["status"] == "rule_decision_stale"
    assert "player_turn_epoch" in result["failure"]["drifted"]


def test_campaign_runtime_cache_is_scoped_to_investigator(tmp_path: Path):
    graph, manifest = _build_fixture_graph(tmp_path)
    runtime_a = coc_rules_runtime.RulesRuntime(
        graph, ruleset_id="coc7", graph_manifest=manifest,
        campaign_id="campaign-scope",
    )
    runtime_b = coc_rules_runtime.RulesRuntime(
        graph, ruleset_id="coc7", graph_manifest=manifest,
        campaign_id="campaign-scope",
    )
    coc_rules_runtime.bind_campaign_runtime(
        "campaign-scope", runtime_a, subject_ref="investigator-a",
    )
    coc_rules_runtime.bind_campaign_runtime(
        "campaign-scope", runtime_b, subject_ref="investigator-b",
    )
    assert coc_rules_runtime.campaign_runtime(
        "campaign-scope", subject_ref="investigator-a",
    ) is runtime_a
    assert coc_rules_runtime.campaign_runtime(
        "campaign-scope", subject_ref="investigator-b",
    ) is runtime_b
    assert coc_rules_runtime.campaign_runtime(
        "campaign-scope", subject_ref="investigator-c",
    ) is None


def test_operation_kernel_reuses_only_the_same_investigator_runtime(
    tmp_path: Path, monkeypatch,
):
    graph, manifest = _build_fixture_graph(tmp_path)
    kernel = coc_toolbox.coc_operation_kernel

    class FakeCtx:
        campaign_id = "campaign-kernel-scope"
        root = tmp_path
        campaign_dir = tmp_path / ".coc" / "campaigns" / campaign_id

    class FakeResolver:
        @staticmethod
        def public_api_index():
            return {}

    monkeypatch.setattr(kernel, "_active_ruleset_id", lambda _ctx: "coc7")
    monkeypatch.setattr(
        coc_rules_runtime, "_load_manifest_cached", lambda *_a, **_k: {},
    )
    monkeypatch.setattr(
        coc_rules_runtime,
        "load_ruleset_graph",
        lambda *_a, **_k: {
            "ok": True,
            "graph": graph,
            "graph_manifest": manifest,
            "source": "test",
        },
    )
    monkeypatch.setattr(kernel, "_rules_resolver", lambda *_a, **_k: FakeResolver())

    runtime_a, *_ = kernel._rules_runtime_for_ctx(
        FakeCtx(), investigator_id="investigator-a", refresh=False,
    )
    runtime_b, *_ = kernel._rules_runtime_for_ctx(
        FakeCtx(), investigator_id="investigator-b", refresh=False,
    )
    runtime_a_again, *_ = kernel._rules_runtime_for_ctx(
        FakeCtx(), investigator_id="investigator-a", refresh=False,
    )
    assert runtime_a is runtime_a_again
    assert runtime_a is not runtime_b


def test_runtime_context_omitted_question_returns_family_status(tmp_path: Path):
    graph, manifest = _build_fixture_graph(tmp_path)
    runtime = coc_rules_runtime.RulesRuntime(
        graph, ruleset_id="coc7", graph_manifest=manifest,
        facts_provider=lambda: {},
    )
    result = runtime.context(None)
    assert result["status"] == "family_status"
    by_family = {row["family"]: row for row in result["family_status"]}
    assert by_family["healing"]["runtime_owner"] == "legacy"
    assert by_family["healing"]["legacy_surface"] == "visible"
    assert by_family["healing"]["coverage"] == "accepted"


def _dying_facts_result(graph, manifest, facts):
    return coc_rules_runtime.RulesRuntime(
        graph, ruleset_id="coc7", graph_manifest=manifest,
        facts_provider=lambda: facts,
    )


def _context_grant(runtime, *, requested=None) -> dict:
    question: dict = {"family": "healing", "kind": "procedure"}
    if requested is not None:
        question["selected_affordance_ids"] = requested
    result = runtime.context(question)
    assert result["status"] == "ok", result
    return result["card_grant"]


def test_runtime_settle_compiles_one_immutable_plan(tmp_path: Path):
    graph, manifest = _build_fixture_graph(tmp_path)
    facts = coc_rules_runtime.facts_from_state(
        {"current_hp": 0, "conditions": ["major_wound", "dying"]},
        {"characteristics": {"CON": 60}, "derived": {"HP": 12}},
    )
    runtime = _dying_facts_result(graph, manifest, facts)
    grant = _context_grant(runtime)
    result = runtime.settle({
        "decision_ref": "decision:coc7:healing:first-aid-stabilization",
        "semantic_inputs": {"skill_value": 99, "pushed": False},
    }, "healing:harvey:first-aid:attempt-1", card_grant=grant)
    assert result["status"] == "compiled"
    assert result["decision_id"] == "healing:harvey:first-aid:attempt-1"
    plan = result["settlement"]["plan"]
    assert plan["command"]["kind"] == "stabilize"
    assert plan["command"]["phase"] == "resolve"
    assert plan["command"]["payload"]["method"] == "first_aid"
    assert plan["command"]["payload"]["skill_value"] == 99
    assert plan["capability"]["resolver_capability"] == "first_aid"
    with pytest.raises(TypeError):
        plan["command"]["payload"]["skill_value"] = 1  # immutable


def test_runtime_settle_missing_semantic_input_fails_closed(tmp_path: Path):
    graph, manifest = _build_fixture_graph(tmp_path)
    runtime = _dying_facts_result(graph, manifest, coc_rules_runtime.facts_from_state(
        {"current_hp": 0, "conditions": ["major_wound", "dying"]}, None))
    grant = _context_grant(runtime)
    result = runtime.settle({
        "decision_ref": "decision:coc7:healing:first-aid-stabilization",
        "semantic_inputs": {},
    }, "healing:harvey:first-aid:attempt-2", card_grant=grant)
    assert result["status"] == "missing_semantic_input"
    assert "skill_value" in result["failure"]["missing"]


def test_runtime_settle_rejects_model_supplied_host_locked(tmp_path: Path):
    graph, manifest = _build_fixture_graph(tmp_path)
    runtime = _dying_facts_result(graph, manifest, coc_rules_runtime.facts_from_state(
        {"current_hp": 0, "conditions": ["major_wound", "dying"]}, None))
    grant = _context_grant(runtime)
    result = runtime.settle({
        "decision_ref": "decision:coc7:healing:first-aid-stabilization",
        "semantic_inputs": {"skill_value": 99, "pushed": False,
                            "rescuer_id": "npc:doctor"},
    }, "healing:harvey:first-aid:attempt-3", card_grant=grant)
    assert result["status"] == "locked_input_override"
    assert "rescuer_id" in result["failure"]["fields"]


def test_runtime_settle_rejects_unknown_arguments_bag(tmp_path: Path):
    graph, manifest = _build_fixture_graph(tmp_path)
    runtime = _dying_facts_result(graph, manifest, coc_rules_runtime.facts_from_state(
        {"current_hp": 0, "conditions": ["major_wound", "dying"]}, None))
    grant = _context_grant(runtime)
    result = runtime.settle({
        "decision_ref": "decision:coc7:healing:first-aid-stabilization",
        "semantic_inputs": {"skill_value": 99, "pushed": False,
                            "arbitrary_bag": 1},
    }, "healing:harvey:first-aid:attempt-4", card_grant=grant)
    assert result["status"] == "unknown_semantic_input"


def test_runtime_settle_not_applicable_decision(tmp_path: Path):
    """A live grant whose decision is no longer applicable fails closed at
    the applicability recheck (spec §15 ``rule_decision_not_applicable``)."""
    graph, manifest = _build_fixture_graph(tmp_path)
    facts = coc_rules_runtime.facts_from_state(
        {"current_hp": 0, "conditions": ["major_wound", "dying"]},
        {"characteristics": {"CON": 60}, "derived": {"HP": 12}},
    )
    runtime = coc_rules_runtime.RulesRuntime(
        graph, ruleset_id="coc7", graph_manifest=manifest,
        # Host-supplied canonical revision that only advances on committed
        # state writes: the grant binding stays live while the live facts
        # change, so the applicability recheck is what fails closed.
        state_revision_provider=lambda: "sandbox-revision-1",
        facts_provider=lambda: facts,
    )
    grant = _context_grant(runtime)
    facts.update(coc_rules_runtime.facts_from_state(
        {"current_hp": 10, "conditions": []}, {"derived": {"HP": 12}},
    ))
    result = runtime.settle({
        "decision_ref": "decision:coc7:healing:first-aid-stabilization",
        "semantic_inputs": {"skill_value": 99, "pushed": False},
    }, "healing:harvey:first-aid:n/a", card_grant=grant)
    assert result["status"] == "rule_decision_not_applicable"


# --------------------------------------------------------------------------- #
# Card-grant fail-closed gate (spec §8.5/§8.6: stale/forged/never-projected)
# --------------------------------------------------------------------------- #
def test_runtime_settle_requires_machine_attached_grant(tmp_path: Path):
    graph, manifest = _build_fixture_graph(tmp_path)
    runtime = _dying_facts_result(graph, manifest, coc_rules_runtime.facts_from_state(
        {"current_hp": 0, "conditions": ["major_wound", "dying"]}, None))
    result = runtime.settle({
        "decision_ref": "decision:coc7:healing:first-aid-stabilization",
        "semantic_inputs": {"skill_value": 99, "pushed": False},
    }, "healing:harvey:first-aid:no-grant")
    assert result["status"] == "rule_decision_stale"
    assert result["failure"]["reason"] == "missing_card_grant"


def test_runtime_settle_rejects_forged_grant(tmp_path: Path):
    graph, manifest = _build_fixture_graph(tmp_path)
    runtime = _dying_facts_result(graph, manifest, coc_rules_runtime.facts_from_state(
        {"current_hp": 0, "conditions": ["major_wound", "dying"]}, None))
    forged = {
        "contract_id": "coc.rule-graph-card-grant.v1",
        "schema_version": 1,
        "grant_id": "card-grant:coc7:healing:999",
        "binding": {"state_revision": "sha256:forged", "campaign_id": None},
        "decision_refs": ["decision:coc7:healing:first-aid-stabilization"],
    }
    result = runtime.settle({
        "decision_ref": "decision:coc7:healing:first-aid-stabilization",
        "semantic_inputs": {"skill_value": 99, "pushed": False},
    }, "healing:harvey:first-aid:forged", card_grant=forged)
    assert result["status"] == "rule_decision_stale"
    assert result["failure"]["reason"] == "unrecognized_card_grant"


def test_runtime_settle_rejects_never_projected_decision_ref(tmp_path: Path):
    """A graph decision the live grant never covered cannot be settled."""
    graph, manifest = _build_fixture_graph(tmp_path)
    runtime = _dying_facts_result(graph, manifest, coc_rules_runtime.facts_from_state(
        {"current_hp": 0, "conditions": ["major_wound", "dying"]}, None))
    grant = _context_grant(
        runtime, requested=["decision:coc7:healing:first-aid-stabilization"]
    )
    assert "decision:coc7:healing:medicine-stabilization" not in grant["decision_refs"]
    result = runtime.settle({
        "decision_ref": "decision:coc7:healing:medicine-stabilization",
        "semantic_inputs": {"skill_value": 99},
    }, "healing:harvey:medicine:never-projected", card_grant=grant)
    assert result["status"] == "rule_decision_stale"
    assert result["failure"]["reason"] == "decision_not_in_grant"


def test_runtime_settle_rejects_stale_grant_after_state_change(tmp_path: Path):
    """A grant whose binding no longer matches current state fails closed
    (spec §15 ``rule_decision_stale``) and returns refreshed cards."""
    graph, manifest = _build_fixture_graph(tmp_path)
    facts = coc_rules_runtime.facts_from_state(
        {"current_hp": 0, "conditions": ["major_wound", "dying"]},
        {"characteristics": {"CON": 60}, "derived": {"HP": 12}},
    )
    runtime = _dying_facts_result(graph, manifest, facts)
    grant = _context_grant(runtime)
    # State change: state_revision is a digest of the live facts by default.
    facts.update(coc_rules_runtime.facts_from_state(
        {"current_hp": 10, "conditions": ["major_wound"]},
        {"characteristics": {"CON": 60}, "derived": {"HP": 12}},
    ))
    result = runtime.settle({
        "decision_ref": "decision:coc7:healing:first-aid-stabilization",
        "semantic_inputs": {"skill_value": 99, "pushed": False},
    }, "healing:harvey:first-aid:stale", card_grant=grant)
    assert result["status"] == "rule_decision_stale"
    assert result["failure"]["reason"] == "grant_binding_mismatch"
    assert "state_revision" in result["failure"]["drifted"]
    # Refreshed bounded cards with a fresh grant are returned when safe; the
    # new state (hp 10, not dying) legitimately no longer offers first aid.
    assert isinstance(result["refreshed_cards"], list)
    assert result["refreshed_card_grant"]["contract_id"] == "coc.rule-graph-card-grant.v1"
    assert all(
        card["decision_ref"] != "decision:coc7:healing:first-aid-stabilization"
        for card in result["refreshed_cards"]
    )
    assert {
        "decision:coc7:healing:medicine-stabilization",
        "decision:coc7:healing:dying-round-clock",
    } <= {card["decision_ref"] for card in result["refreshed_cards"]}


# --------------------------------------------------------------------------- #
# Shadow comparator — byte-exact no-double-execution (spec §14.1)
# --------------------------------------------------------------------------- #
_FOUR_LEGACY_UNEXPRESSED_AXES = (
    "rule_refs", "resource_effects", "visibility", "pending_choices",
)


def _assert_only_unresolved_legacy_axes(row: dict) -> None:
    """Every mandatory axis was compared; the ONLY differences are the four
    axes the legacy normalized command cannot express (never a silent match)."""
    assert row["status"] == "mismatch"
    axes = sorted(diff["axis"] for diff in row["differences"])
    assert axes == sorted(_FOUR_LEGACY_UNEXPRESSED_AXES), axes
    for diff in row["differences"]:
        assert diff["kind"] == "unresolved_legacy"
        assert diff["legacy"] is None


def _assert_byte_identical_and_shadow_rows(
    off: dict, on: dict, *, expected_rows: int,
) -> None:
    off_snapshot = _snapshot_tree(off["campaign_dir"])
    on_snapshot = _snapshot_tree(on["campaign_dir"])
    assert off_snapshot == on_snapshot
    assert len(_rolls(off)) == len(_rolls(on)) == 1
    assert _rolls(off) == _rolls(on)


def test_shadow_no_double_execution_first_aid_byte_exact(
    tmp_path: Path, _frozen_clocks,
):
    """Shadow ON vs OFF on the SAME campaign fixture: every campaign artifact
    (rolls log, receipts, ledger, state, working-set revisions, all logs) is
    byte-identical; the shadow log is the only difference (outside the tree)."""
    graph, manifest = _build_fixture_graph(tmp_path)
    log_path = tmp_path / "shadow.jsonl"

    ws = _fresh_workspace(tmp_path / "fixture", "same")
    _dying_state(ws)
    off_ws, on_ws = _clone_fixture(
        ws, tmp_path / "off", tmp_path / "on"
    )
    args = {
        "investigator": ws["investigator_id"],
        "skill_value": 99,
        "rescuer_id": "npc-paramedic",
        "decision_id": "shadow-byte-exact-1",
        "seed": 7,
    }
    # Shadow OFF.
    baseline = _run(off_ws, "rules.first_aid", args)
    assert baseline["ok"] is True, baseline
    # Shadow ON — same fixture bytes, same decision id, frozen clock.
    coc_rules_runtime.configure_shadow(
        ruleset_id="coc7", graph=graph, graph_manifest=manifest,
        log_path=log_path,
    )
    armed = _run(on_ws, "rules.first_aid", args)
    assert armed["ok"] is True, armed

    # The COMPLETE campaign tree is byte-identical (rolls, receipts, ledger,
    # state, working-set revisions, events/calls logs). No stripping of ts or
    # campaign identity: the clock and decision ids are controlled instead.
    assert _snapshot_tree(off_ws["campaign_dir"]) == _snapshot_tree(on_ws["campaign_dir"])
    # Canonical final state and the single RNG consumption are exact.
    assert _state_bytes(off_ws) == _state_bytes(on_ws)
    assert len(_rolls(off_ws)) == len(_rolls(on_ws)) == 1
    # The ONLY permitted difference is the host-internal shadow log, which
    # lives outside the campaign tree.
    rows = _shadow_rows(log_path)
    assert len(rows) == 1
    _assert_only_unresolved_legacy_axes(rows[0])


def test_shadow_no_double_execution_medicine_chain_byte_exact(
    tmp_path: Path, _frozen_clocks,
):
    graph, manifest = _build_fixture_graph(tmp_path)
    log_path = tmp_path / "shadow.jsonl"

    ws = _fresh_workspace(tmp_path / "fixture", "same-med")
    _dying_state(ws)

    def run_chain(ws_):
        first = _run(ws_, "rules.first_aid", {
            "investigator": ws["investigator_id"], "skill_value": 99,
            "rescuer_id": "npc-paramedic", "decision_id": "shadow-chain-aid",
            "seed": 3,
        })
        assert first["ok"] is True, first
        med = _run(ws_, "rules.medicine", {
            "investigator": ws["investigator_id"], "skill_value": 99,
            "rescuer_id": "npc-paramedic", "decision_id": "shadow-chain-med",
            "seed": 3,
        })
        assert med["ok"] is True, med
        return med

    off_ws, on_ws = _clone_fixture(ws, tmp_path / "off", tmp_path / "on")
    baseline = run_chain(off_ws)
    coc_rules_runtime.configure_shadow(
        ruleset_id="coc7", graph=graph, graph_manifest=manifest,
        log_path=log_path,
    )
    armed = run_chain(on_ws)
    assert armed["data"] == baseline["data"]
    assert _snapshot_tree(off_ws["campaign_dir"]) == _snapshot_tree(on_ws["campaign_dir"])
    rows = _shadow_rows(log_path)
    assert len(rows) == 2  # first_aid + medicine each compared once
    for row in rows:
        _assert_only_unresolved_legacy_axes(row)


def test_shadow_no_double_execution_dying_check_byte_exact(
    tmp_path: Path, _frozen_clocks,
):
    graph, manifest = _build_fixture_graph(tmp_path)
    log_path = tmp_path / "shadow.jsonl"

    ws = _fresh_workspace(tmp_path / "fixture", "same-dying")
    _dying_state(ws)

    def run_check(ws_):
        dying = _run(ws_, "rules.dying_check", {
            "investigator": ws["investigator_id"], "clock_kind": "round",
            "decision_id": "shadow-dying-round", "seed": 11,
        })
        assert dying["ok"] is True, dying
        return dying

    off_ws, on_ws = _clone_fixture(ws, tmp_path / "off", tmp_path / "on")
    baseline = run_check(off_ws)
    coc_rules_runtime.configure_shadow(
        ruleset_id="coc7", graph=graph, graph_manifest=manifest,
        log_path=log_path,
    )
    armed = run_check(on_ws)
    assert armed["data"] == baseline["data"]
    assert _snapshot_tree(off_ws["campaign_dir"]) == _snapshot_tree(on_ws["campaign_dir"])
    rows = _shadow_rows(log_path)
    assert len(rows) == 1
    assert rows[0]["decision_ref"] == "decision:coc7:healing:dying-round-clock"
    _assert_only_unresolved_legacy_axes(rows[0])


def test_shadow_no_double_execution_weekly_recovery_byte_exact(
    tmp_path: Path, _frozen_clocks,
):
    graph, manifest = _build_fixture_graph(tmp_path)
    log_path = tmp_path / "shadow.jsonl"

    ws = _fresh_workspace(tmp_path / "fixture", "same-weekly")
    _dying_state(ws)

    def setup_weekly_due(ws_):
        inv = ws_["investigator_id"]
        state_path = ws_["campaign_dir"] / "save" / "investigator-state" / f"{inv}.json"
        time_state = json.loads(
            (ws_["campaign_dir"] / "save" / "time-state.json").read_text(encoding="utf-8")
        )
        elapsed = int(time_state["clock"]["elapsed_minutes"])
        state = json.loads(state_path.read_text(encoding="utf-8"))
        state.update({
            "current_hp": 2,
            "conditions": ["major_wound"],
            "wound_ledger": [{
                "wound_id": "wound-shadow-test",
                "source_damage_roll_id": "damage-shadow-test",
                "occurred_elapsed_minutes": elapsed,
                "status": "active",
            }],
        })
        _write_json(state_path, state)
        advanced = _run(ws_, "state.advance_time", {
            "minutes": 7 * 24 * 60,
            "reason": "one full week of hospital rest",
            "decision_id": "advance-shadow-week",
        })
        assert advanced["ok"] is True, advanced

    def run_weekly(ws_):
        setup_weekly_due(ws_)
        result = _run(ws_, "rules.weekly_recovery", {
            "investigator": ws["investigator_id"], "complete_rest": True,
            "poor_environment": False, "medicine_skill_value": 99,
            "caregiver_id": "npc-hospital-doctor",
            "decision_id": "shadow-weekly-1", "seed": 5,
        })
        assert result["ok"] is True, result
        return result

    off_ws, on_ws = _clone_fixture(ws, tmp_path / "off", tmp_path / "on")
    baseline = run_weekly(off_ws)
    coc_rules_runtime.configure_shadow(
        ruleset_id="coc7", graph=graph, graph_manifest=manifest,
        log_path=log_path,
    )
    armed = run_weekly(on_ws)
    assert armed["data"] == baseline["data"]
    assert _snapshot_tree(off_ws["campaign_dir"]) == _snapshot_tree(on_ws["campaign_dir"])
    assert len(_rolls(off_ws)) == len(_rolls(on_ws)) == 3  # weekly roll + 2 healing
    rows = _shadow_rows(log_path)
    assert len(rows) == 1
    assert rows[0]["decision_ref"] == (
        "decision:coc7:healing:weekly-major-wound-recovery"
    )
    _assert_only_unresolved_legacy_axes(rows[0])


# --------------------------------------------------------------------------- #
# Comparator — every §14.1 axis can produce a recorded difference
# --------------------------------------------------------------------------- #
def _plan_for_first_aid(runtime) -> dict:
    facts = coc_rules_runtime.facts_from_state(
        {"current_hp": 0, "conditions": ["major_wound", "dying"]},
        {"characteristics": {"CON": 60}, "derived": {"HP": 12}},
    )
    result = runtime._compile_plan(
        "decision:coc7:healing:first-aid-stabilization",
        {"skill_value": 99, "pushed": False},
        facts=facts, host_locked={"rescuer_id": "npc-paramedic"},
    )
    assert result["failure"] is None, result
    return coc_rules_runtime._thaw(result["plan"])


def _legacy_command_for_first_aid() -> dict:
    return {
        "command_id": "first-aid-1",
        "kind": "stabilize",
        "phase": "resolve",
        "payload": {
            "method": "first_aid",
            "skill_value": 99,
            "rescuer_id": "npc-paramedic",
            "pushed": False,
        },
    }


def test_comparator_axis_capability_records_difference(tmp_path: Path):
    graph, manifest = _build_fixture_graph(tmp_path)
    runtime = _dying_facts_result(graph, manifest, {})
    plan = _plan_for_first_aid(runtime)
    legacy = _legacy_command_for_first_aid()
    legacy["kind"] = "weekly_recovery"
    differences, _, _ = coc_rules_runtime._compare_plan_and_legacy(
        runtime, coc_rules_runtime._freeze(plan), legacy
    )
    assert any(
        diff["axis"] == "capability" and diff["field"] == "command.kind"
        and diff["kind"] == "value_mismatch"
        for diff in differences
    )


def test_comparator_axis_phase_records_difference(tmp_path: Path):
    graph, manifest = _build_fixture_graph(tmp_path)
    runtime = _dying_facts_result(graph, manifest, {})
    plan = _plan_for_first_aid(runtime)
    legacy = _legacy_command_for_first_aid()
    legacy["phase"] = "offer"
    differences, _, _ = coc_rules_runtime._compare_plan_and_legacy(
        runtime, coc_rules_runtime._freeze(plan), legacy
    )
    assert any(
        diff["axis"] == "phase" and diff["field"] == "command.phase"
        and diff["legacy"] == "offer" and diff["plan"] == "resolve"
        for diff in differences
    )


def test_comparator_axis_semantic_inputs_records_difference(tmp_path: Path):
    graph, manifest = _build_fixture_graph(tmp_path)
    runtime = _dying_facts_result(graph, manifest, {})
    plan = _plan_for_first_aid(runtime)
    legacy = _legacy_command_for_first_aid()
    legacy["payload"]["skill_value"] = 55
    differences, _, _ = coc_rules_runtime._compare_plan_and_legacy(
        runtime, coc_rules_runtime._freeze(plan), legacy
    )
    assert any(
        diff["axis"] == "semantic_inputs" and diff["field"] == "payload.skill_value"
        and diff["kind"] == "value_mismatch" and diff["legacy"] == 55
        for diff in differences
    )


def test_comparator_axis_locked_inputs_records_difference(tmp_path: Path):
    graph, manifest = _build_fixture_graph(tmp_path)
    runtime = _dying_facts_result(graph, manifest, {})
    plan = _plan_for_first_aid(runtime)
    legacy = _legacy_command_for_first_aid()
    legacy["payload"]["rescuer_id"] = "npc-other"
    differences, _, _ = coc_rules_runtime._compare_plan_and_legacy(
        runtime, coc_rules_runtime._freeze(plan), legacy
    )
    assert any(
        diff["axis"] == "locked_inputs" and diff["field"] == "payload.rescuer_id"
        and diff["kind"] == "value_mismatch" and diff["legacy"] == "npc-other"
        for diff in differences
    )


@pytest.mark.parametrize(
    "axis,field,legacy_value",
    [
        ("rule_refs", "rule_refs", ["rule:coc7:healing:wrong"]),
        ("resource_effects", "resource_effects", ["effect:coc7:healing:wrong"]),
        ("visibility", "visibility", "keeper-only"),
        ("pending_choices", "pending_choices", ["pc:wrong"]),
    ],
)
def test_comparator_axis_value_mismatch_when_legacy_can_express(
    tmp_path: Path, axis: str, field: str, legacy_value,
):
    """When the legacy command carries an axis value, an actual mismatch in a
    rule refs / resource effects / visibility / pending-choice semantic axis
    is recorded as a value mismatch (never a silent pass)."""
    graph, manifest = _build_fixture_graph(tmp_path)
    runtime = _dying_facts_result(graph, manifest, {})
    plan = _plan_for_first_aid(runtime)
    legacy = _legacy_command_for_first_aid()
    legacy["payload"][field] = legacy_value
    differences, _, _ = coc_rules_runtime._compare_plan_and_legacy(
        runtime, coc_rules_runtime._freeze(plan), legacy
    )
    assert any(
        diff["axis"] == axis and diff["field"] == field
        and diff["kind"] == "value_mismatch" and diff["legacy"] == legacy_value
        for diff in differences
    )


def test_comparator_axis_unresolved_when_legacy_lacks_data(tmp_path: Path):
    """Where the legacy normalized command genuinely lacks an axis, the
    comparator records an explicit unresolved_legacy finding per axis — the
    shadow's honest verdict, never a silent match."""
    graph, manifest = _build_fixture_graph(tmp_path)
    runtime = _dying_facts_result(graph, manifest, {})
    plan = _plan_for_first_aid(runtime)
    legacy = _legacy_command_for_first_aid()
    differences, plan_profile, legacy_profile = (
        coc_rules_runtime._compare_plan_and_legacy(
            runtime, coc_rules_runtime._freeze(plan), legacy
        )
    )
    unresolved = [diff for diff in differences if diff["kind"] == "unresolved_legacy"]
    assert sorted(diff["axis"] for diff in unresolved) == sorted(
        _FOUR_LEGACY_UNEXPRESSED_AXES
    )
    for diff in unresolved:
        assert diff["legacy"] is None
        assert diff["plan"] is not None or plan_profile[0] is not None
    assert legacy_profile["rule_refs"] is None
    assert legacy_profile["resource_effects"] is None
    assert legacy_profile["visibility"] is None
    assert legacy_profile["pending_choices"] is None


# --------------------------------------------------------------------------- #
# Shadow comparator — mismatch records exact differences
# --------------------------------------------------------------------------- #
def test_shadow_mismatch_records_exact_differences(tmp_path: Path, campaign_ws):
    graph, manifest = _build_fixture_graph(tmp_path)
    # Corrupt the graph's first-aid command phase: capability resolution
    # (kind/method) still matches the legacy op, but the compiled plan phase
    # diverges from the legacy command — a real graph-vs-legacy diff.
    graph2 = copy.deepcopy(graph)
    for node in graph2["nodes"]:
        if node["node_id"] == "decision:coc7:healing:first-aid-stabilization":
            impl = node["properties"]["implementation"]
            impl["phase"] = "offer"
    log_path = tmp_path / "shadow-log.jsonl"
    coc_rules_runtime.configure_shadow(
        ruleset_id="coc7", graph=graph2, graph_manifest=manifest,
        log_path=log_path,
    )
    ws = dict(campaign_ws)
    _dying_state(ws)
    result = _run(ws, "rules.first_aid", {
        "investigator": ws["investigator_id"],
        "skill_value": 99,
        "rescuer_id": "npc-paramedic",
        "decision_id": "shadow-mismatch-first-aid",
        "seed": 7,
    })
    # Legacy path still executes exactly once and is NOT altered.
    assert result["ok"] is True, result
    assert result["data"]["event"]["event_type"] == "first_aid_stabilize"
    assert len(_rolls(ws)) == 1

    rows = _shadow_rows(log_path)
    assert len(rows) == 1
    row = rows[0]
    assert row["status"] == "mismatch"
    method_diff = next(
        diff for diff in row["differences"]
        if diff.get("field") == "command.phase"
    )
    assert method_diff["plan"] == "offer"
    assert method_diff["legacy"] == "resolve"
    assert method_diff["axis"] == "phase"
    # The four un-expressible axes are recorded honestly as well.
    unresolved_axes = {
        diff["axis"] for diff in row["differences"]
        if diff["kind"] == "unresolved_legacy"
    }
    assert unresolved_axes == set(_FOUR_LEGACY_UNEXPRESSED_AXES)


def test_shadow_mismatch_records_applicability_drift(tmp_path: Path, campaign_ws):
    """A not-applicable graph decision still runs legacy once, and the
    shadow row records the drift instead of pretending a match."""
    graph, manifest = _build_fixture_graph(tmp_path)
    log_path = tmp_path / "shadow-log.jsonl"
    coc_rules_runtime.configure_shadow(
        ruleset_id="coc7", graph=graph, graph_manifest=manifest,
        log_path=log_path,
    )
    ws = dict(campaign_ws)
    # Healthy investigator: the fixture graph's dying-unstabilized hard gate
    # means first-aid-stabilization is NOT applicable here, yet the legacy
    # path legitimately runs a non-dying First Aid.
    result = _run(ws, "rules.first_aid", {
        "investigator": ws["investigator_id"],
        "skill_value": 99,
        "rescuer_id": "npc-paramedic",
        "decision_id": "shadow-healthy-first-aid",
        "seed": 7,
    })
    assert result["ok"] is True, result
    rows = _shadow_rows(log_path)
    assert len(rows) == 1
    row = rows[0]
    assert row["status"] == "mismatch"
    assert row["skip_reason"] == "not_applicable"
    assert any(
        diff["axis"] == "applicability" for diff in row["differences"]
    )


# --------------------------------------------------------------------------- #
# Shadow comparator — missing graph skip leaves legacy untouched
# --------------------------------------------------------------------------- #
def test_shadow_missing_graph_skip_leaves_legacy_untouched(
    tmp_path: Path, campaign_ws
):
    log_path = tmp_path / "shadow-log.jsonl"
    coc_rules_runtime.configure_shadow(
        ruleset_id="coc7", runtime_owner="shadow",
        graph=None, graph_manifest=None, log_path=log_path,
    )
    ws = dict(campaign_ws)
    _dying_state(ws)
    result = _run(ws, "rules.first_aid", {
        "investigator": ws["investigator_id"],
        "skill_value": 99,
        "rescuer_id": "npc-paramedic",
        "decision_id": "shadow-no-graph-first-aid",
        "seed": 7,
    })
    assert result["ok"] is True, result
    assert result["data"]["event"]["event_type"] == "first_aid_stabilize"
    assert len(_rolls(ws)) == 1
    rows = _shadow_rows(log_path)
    assert len(rows) == 1
    assert rows[0]["status"] == "skipped"
    assert rows[0]["skip_reason"] == "graph_absent"


def test_shadow_invalid_graph_skips_without_blocking(tmp_path: Path, campaign_ws):
    log_path = tmp_path / "shadow-log.jsonl"
    coc_rules_runtime.configure_shadow(
        ruleset_id="coc7", runtime_owner="shadow",
        graph={"broken": True}, graph_manifest=None, log_path=log_path,
    )
    ws = dict(campaign_ws)
    _dying_state(ws)
    result = _run(ws, "rules.first_aid", {
        "investigator": ws["investigator_id"],
        "skill_value": 99,
        "rescuer_id": "npc-paramedic",
        "decision_id": "shadow-bad-graph-first-aid",
        "seed": 7,
    })
    assert result["ok"] is True, result
    assert len(_rolls(ws)) == 1
    rows = _shadow_rows(log_path)
    assert rows and rows[0]["status"] == "skipped"


def test_shadow_noop_when_family_legacy(tmp_path: Path, campaign_ws):
    """Default ownership (legacy/visible) = no shadow machinery at all."""
    log_path = tmp_path / "shadow-log.jsonl"
    # Explicit empty rulesets root: do not discover the installed coc7 graph.
    isolated_root = tmp_path / "no-package-rulesets"
    isolated_root.mkdir()
    coc_rules_runtime.configure_shadow(
        ruleset_id="coc7", runtime_owner="legacy",
        graph=None, graph_manifest=None, log_path=log_path,
        rulesets_root_path=isolated_root,
    )
    ws = dict(campaign_ws)
    _dying_state(ws)
    result = _run(ws, "rules.first_aid", {
        "investigator": ws["investigator_id"],
        "skill_value": 99,
        "rescuer_id": "npc-paramedic",
        "decision_id": "shadow-legacy-first-aid",
        "seed": 7,
    })
    assert result["ok"] is True, result
    rows = _shadow_rows(log_path)
    assert rows == []
    assert len(_rolls(ws)) == 1


def test_shadow_log_is_host_internal_and_never_canonical(
    tmp_path: Path, campaign_ws
):
    graph, manifest = _build_fixture_graph(tmp_path)
    log_path = tmp_path / "shadow-host-log.jsonl"
    coc_rules_runtime.configure_shadow(
        ruleset_id="coc7", graph=graph, graph_manifest=manifest,
        log_path=log_path,
    )
    ws = dict(campaign_ws)
    _dying_state(ws)
    _run(ws, "rules.first_aid", {
        "investigator": ws["investigator_id"],
        "skill_value": 99,
        "rescuer_id": "npc-paramedic",
        "decision_id": "shadow-host-log-first-aid",
        "seed": 7,
    })
    rows = _shadow_rows(log_path)
    assert len(rows) == 1
    row = rows[0]
    assert row["contract_id"] == "coc.rule-graph-shadow-log.v1"
    assert row["schema_version"] == 1
    # Never a canonical receipt: the shadow contract id must not appear in
    # rolls, ledger, or save state, and the log lives outside save/.
    rolls = _rolls(ws)
    assert all("coc.rule-graph-shadow-log.v1" not in json.dumps(roll) for roll in rolls)
    save_docs = [
        path for path in (ws["campaign_dir"] / "save").rglob("*")
        if path.is_file()
    ]
    assert all(
        "coc.rule-graph-shadow-log.v1" not in path.read_text(encoding="utf-8")
        for path in save_docs
    )
    assert "rule-graph-shadow" not in str(ws["campaign_dir"] / "save")


# --------------------------------------------------------------------------- #
# Ownership resolution (spec §7.7) and manifest pairing
# --------------------------------------------------------------------------- #
def test_ownership_resolution_defaults_legacy_visible(tmp_path: Path):
    graph, manifest = _build_fixture_graph(tmp_path)
    # Empty package rule_families + graph legacy maps agree on legacy/visible.
    owner, surface = coc_rules_runtime.resolve_family_ownership(
        "coc7", "healing", manifest={}, graph=graph, graph_manifest=manifest,
    )
    assert (owner, surface) == ("legacy", "visible")


def test_ownership_resolution_agreed_graph_hidden(tmp_path: Path):
    graph, manifest = _build_fixture_graph(tmp_path)
    graph["family_runtime_ownership"]["healing"] = "graph"
    graph["legacy_surface_lifecycle"]["healing"] = "hidden"
    manifest["family_promotion_eligibility"]["healing"] = {
        "promotion_eligible": True,
        "runtime_ownership": "graph",
    }
    package = {
        "rule_families": [{
            "family_id": "healing",
            "runtime_owner": "graph",
            "legacy_surface": "hidden",
        }],
    }
    owner, surface = coc_rules_runtime.resolve_family_ownership(
        "coc7", "healing", manifest=package, graph=graph, graph_manifest=manifest,
    )
    assert (owner, surface) == ("graph", "hidden")


def test_ownership_mismatch_fails_closed_without_picking_a_side(tmp_path: Path):
    graph, manifest = _build_fixture_graph(tmp_path)
    package_graph = {
        "rule_families": [{
            "family_id": "healing",
            "runtime_owner": "graph",
            "legacy_surface": "hidden",
        }],
    }
    with pytest.raises(coc_rules_runtime.FamilyOwnershipMismatch) as caught:
        coc_rules_runtime.resolve_family_ownership(
            "coc7", "healing",
            manifest=package_graph, graph=graph, graph_manifest=manifest,
        )
    assert caught.value.graph_claimed is True
    assert any("runtime_owner disagrees" in item for item in caught.value.findings)

    # Flip only the graph maps; package stays implicit legacy.
    graph["family_runtime_ownership"]["healing"] = "graph"
    graph["legacy_surface_lifecycle"]["healing"] = "hidden"
    with pytest.raises(coc_rules_runtime.FamilyOwnershipMismatch) as caught:
        coc_rules_runtime.resolve_family_ownership(
            "coc7", "healing",
            manifest={}, graph=graph, graph_manifest=manifest,
        )
    assert caught.value.graph_claimed is True

    # Flip only the graph-manifest promotion owner.
    graph, manifest = _build_fixture_graph(tmp_path)
    promo = manifest.setdefault("family_promotion_eligibility", {}).setdefault(
        "healing", {},
    )
    promo["runtime_ownership"] = "graph"
    with pytest.raises(coc_rules_runtime.FamilyOwnershipMismatch) as caught:
        coc_rules_runtime.resolve_family_ownership(
            "coc7", "healing",
            manifest={}, graph=graph, graph_manifest=manifest,
        )
    assert caught.value.graph_claimed is True


def test_load_ruleset_graph_absent_is_graceful(tmp_path: Path):
    # A ruleset package without graph artifacts returns ok=False without raising.
    # Explicit empty root — never the installed coc7 package.
    loaded = coc_rules_runtime.load_ruleset_graph(
        "coc7", rulesets_root_path=tmp_path / "empty-rulesets",
    )
    assert loaded["ok"] is False
    assert loaded["reason"] == "graph_absent"


def test_load_ruleset_graph_rejects_ownership_mismatch(tmp_path: Path):
    src = Path("plugins/coc-keeper/rulesets/coc7")
    dest = tmp_path / "rulesets" / "coc7"
    shutil.copytree(src, dest)
    package_path = dest / "manifest.json"
    package = json.loads(package_path.read_text(encoding="utf-8"))
    for entry in package.get("rule_families") or []:
        if entry.get("family_id") == "healing":
            entry["runtime_owner"] = "legacy"
            entry["legacy_surface"] = "visible"
    package_path.write_text(json.dumps(package, indent=2) + "\n", encoding="utf-8")
    loaded = coc_rules_runtime.load_ruleset_graph(
        "coc7", rulesets_root_path=tmp_path / "rulesets",
    )
    assert loaded["ok"] is False
    assert loaded["reason"] == "ownership_mismatch"
    assert any("runtime_owner disagrees" in item for item in loaded["findings"])
    assert loaded.get("graph_claimed") is True


def test_load_packaged_coc7_healing_graph_is_promoted_without_exclusions():
    """Integration: discover the real packaged coc7 graph by explicit root."""
    loaded = coc_rules_runtime.load_ruleset_graph(
        "coc7", rulesets_root_path=coc_rules_runtime.rulesets_root(),
    )
    assert loaded["ok"] is True
    assert loaded["source"] == "package"
    graph = loaded["graph"]
    graph_manifest = loaded["graph_manifest"]
    assert graph["coverage"]["healing"] == "accepted"
    runtime = coc_rules_runtime.RulesRuntime(
        graph, ruleset_id="coc7", graph_manifest=graph_manifest,
        facts_provider=lambda: {},
    )
    status = runtime.context(None)
    by_family = {row["family"]: row for row in status["family_status"]}
    assert by_family["healing"]["coverage"] == "accepted"
    assert by_family["healing"]["runtime_owner"] == "graph"
    assert by_family["healing"]["legacy_surface"] == "hidden"
    promo = graph_manifest["family_promotion_eligibility"]["healing"]
    assert promo == {
        "promotion_eligible": True,
        "runtime_ownership": "graph",
    }
    node_ids = {node["node_id"] for node in graph["nodes"]}
    assert "exception:coc7:healing:first-aid-window-uncompiled" not in node_ids
    assert "exception:coc7:healing:first-aid-teamwork-uncompiled" not in node_ids


# --------------------------------------------------------------------------- #
# R3: graph-owned settle executes the existing adapter (spec §8.6/§14.3)
# --------------------------------------------------------------------------- #
_GRAPH_OWNED_PACKAGE = {
    "rule_families": [{
        "family_id": "healing",
        "runtime_owner": "graph",
        "legacy_surface": "hidden",
    }],
}


def _graph_owned_runtime(graph, manifest, facts):
    graph = copy.deepcopy(graph)
    manifest = copy.deepcopy(manifest)
    graph.setdefault("family_runtime_ownership", {})["healing"] = "graph"
    graph.setdefault("legacy_surface_lifecycle", {})["healing"] = "hidden"
    promo = manifest.setdefault("family_promotion_eligibility", {}).setdefault("healing", {})
    promo["runtime_ownership"] = "graph"
    promo["promotion_eligible"] = True
    return coc_rules_runtime.RulesRuntime(
        graph, ruleset_id="coc7", graph_manifest=manifest,
        package_manifest=_GRAPH_OWNED_PACKAGE,
        facts_provider=lambda: facts,
        ruleset_adapter=coc_rulesets.get_rule_graph_adapter("coc7"),
    )


def _set_sheet_skill(ws, skill: str, value: int) -> None:
    path = (
        ws["workspace"] / ".coc" / "investigators"
        / ws["investigator_id"] / "character.json"
    )
    sheet = json.loads(path.read_text(encoding="utf-8"))
    skills = sheet.setdefault("skills", {})
    skills[skill] = value
    path.write_text(json.dumps(sheet, indent=2) + "\n", encoding="utf-8")


def _add_rescuer_sheet(
    ws, rescuer_id: str, *, first_aid: int | None,
) -> None:
    source = (
        ws["workspace"] / ".coc" / "investigators"
        / ws["investigator_id"] / "character.json"
    )
    sheet = json.loads(source.read_text(encoding="utf-8"))
    sheet["id"] = rescuer_id
    skills = sheet.setdefault("skills", {})
    if first_aid is None:
        skills.pop("First Aid", None)
    else:
        skills["First Aid"] = first_aid
    target = (
        ws["workspace"] / ".coc" / "investigators"
        / rescuer_id / "character.json"
    )
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(sheet, indent=2) + "\n", encoding="utf-8")


def test_packaged_graph_settle_uses_catalog_base_when_quick_start_sheet_omits_first_aid(
    tmp_path: Path,
):
    ws = _fresh_workspace(tmp_path, "graph-catalog-first-aid")
    sheet_path = (
        ws["workspace"] / ".coc" / "investigators"
        / ws["investigator_id"] / "character.json"
    )
    sheet = json.loads(sheet_path.read_text(encoding="utf-8"))
    assert "First Aid" not in sheet["skills"]
    time_state = json.loads(
        (ws["campaign_dir"] / "save" / "time-state.json")
        .read_text(encoding="utf-8")
    )
    elapsed = int(time_state["clock"]["elapsed_minutes"])
    _wounded_state(ws, hp=5, occurred_elapsed=elapsed)

    context = _run(ws, "rules.context", {
        "investigator": ws["investigator_id"],
        "family": "healing",
        "selected_affordance_ids": [_ORDINARY_FIRST_AID],
    })
    assert context["ok"] is True, context
    smuggled = _run(ws, "rules.settle", {
        "investigator": ws["investigator_id"],
        "decision_ref": _ORDINARY_FIRST_AID,
        "semantic_inputs": {"skill_value": 99},
        "decision_id": "healing:catalog-base:smuggled-first-aid",
    })
    assert smuggled["ok"] is False, smuggled
    assert smuggled["error"]["code"] == "locked_input_override"
    assert _rolls(ws) == []
    args = {
        "investigator": ws["investigator_id"],
        "decision_ref": _ORDINARY_FIRST_AID,
        "semantic_inputs": {"rescuer_ref": ws["investigator_id"]},
        "decision_id": "healing:catalog-base:first-aid",
        "seed": 2,
    }
    settled = _run(ws, "rules.settle", args)

    assert settled["ok"] is True, settled
    rolls = _rolls(ws)
    assert len(rolls) == 1
    assert rolls[0]["payload"]["target"] == 30
    projected = json.dumps(settled["data"])
    assert "skill_value" not in projected
    assert "characteristics" not in projected
    assert '"skills"' not in projected

    replay = _run(ws, "rules.settle", args)
    assert replay["ok"] is True, replay
    assert replay["data"] == settled["data"]
    assert len(_rolls(ws)) == 1


def test_packaged_graph_settle_uses_catalog_base_for_missing_assistant_skill(
    tmp_path: Path,
):
    ws = _fresh_workspace(tmp_path, "graph-catalog-assistant")
    _set_sheet_skill(ws, "First Aid", 1)
    _add_rescuer_sheet(ws, "rescuer-assistant", first_aid=None)
    time_state = json.loads(
        (ws["campaign_dir"] / "save" / "time-state.json")
        .read_text(encoding="utf-8")
    )
    _wounded_state(
        ws,
        hp=5,
        occurred_elapsed=int(time_state["clock"]["elapsed_minutes"]),
    )
    context = _run(ws, "rules.context", {
        "investigator": ws["investigator_id"],
        "family": "healing",
        "selected_affordance_ids": [_ORDINARY_FIRST_AID],
    })
    assert context["ok"] is True, context

    settled = _run(ws, "rules.settle", {
        "investigator": ws["investigator_id"],
        "decision_ref": _ORDINARY_FIRST_AID,
        "semantic_inputs": {
            "rescuer_ref": ws["investigator_id"],
            "assistant_rescuer_ref": "rescuer-assistant",
        },
        "decision_id": "healing:catalog-base:assistant-first-aid",
        "seed": 2,
    })

    assert settled["ok"] is True, settled
    assert settled["data"]["event"]["teamwork"] is True
    rolls = _rolls(ws)
    assert [row["payload"]["target"] for row in rolls] == [1, 30]
    assert [row["payload"]["actor_id"] for row in rolls] == [
        ws["investigator_id"], "rescuer-assistant",
    ]


def test_packaged_graph_settle_uses_catalog_base_when_sheet_omits_medicine(
    tmp_path: Path,
):
    ws = _fresh_workspace(tmp_path, "graph-catalog-medicine")
    time_state = json.loads(
        (ws["campaign_dir"] / "save" / "time-state.json")
        .read_text(encoding="utf-8")
    )
    _wounded_state(
        ws,
        hp=5,
        occurred_elapsed=int(time_state["clock"]["elapsed_minutes"]),
    )
    decision_ref = "decision:coc7:healing:medicine-ordinary"
    context = _run(ws, "rules.context", {
        "investigator": ws["investigator_id"],
        "family": "healing",
        "selected_affordance_ids": [decision_ref],
    })
    assert context["ok"] is True, context

    settled = _run(ws, "rules.settle", {
        "investigator": ws["investigator_id"],
        "decision_ref": decision_ref,
        "semantic_inputs": {"rescuer_ref": ws["investigator_id"]},
        "decision_id": "healing:catalog-base:medicine",
        "seed": 2,
    })

    assert settled["ok"] is True, settled
    rolls = _rolls(ws)
    assert len(rolls) == 1
    assert rolls[0]["payload"]["target"] == 1


def test_packaged_graph_settle_uses_catalog_base_for_weekly_caregiver(
    tmp_path: Path,
):
    ws = _fresh_workspace(tmp_path, "graph-catalog-weekly-caregiver")
    state_path = (
        ws["campaign_dir"] / "save" / "investigator-state"
        / f"{ws['investigator_id']}.json"
    )
    state = json.loads(state_path.read_text(encoding="utf-8"))
    state.update({
        "current_hp": 2,
        "conditions": ["major_wound"],
        "wound_ledger": [{
            "wound_id": "wound-catalog-weekly",
            "source_damage_roll_id": "damage-catalog-weekly",
            "occurred_elapsed_minutes": 0,
            "status": "active",
        }],
    })
    _write_json(state_path, state)
    advanced = _run(ws, "state.advance_time", {
        "minutes": 7 * 24 * 60,
        "reason": "one full week of rest",
        "decision_id": "healing:catalog-base:advance-week",
    })
    assert advanced["ok"] is True, advanced
    decision_ref = "decision:coc7:healing:weekly-major-wound-recovery"
    context = _run(ws, "rules.context", {
        "investigator": ws["investigator_id"],
        "family": "healing",
        "selected_affordance_ids": [decision_ref],
    })
    assert context["ok"] is True, context

    settled = _run(ws, "rules.settle", {
        "investigator": ws["investigator_id"],
        "decision_ref": decision_ref,
        "semantic_inputs": {
            "complete_rest": True,
            "poor_environment": False,
        },
        "decision_id": "healing:catalog-base:weekly-caregiver",
        "seed": 5,
    })

    assert settled["ok"] is True, settled
    rolls = _rolls(ws)
    care_roll = next(
        row for row in rolls if row["payload"].get("skill") == "Medicine"
    )
    assert care_roll["payload"]["target"] == 1
    assert care_roll["payload"]["actor_id"] == ws["investigator_id"]


def test_ruleset_skill_value_prefers_explicit_and_fails_closed_for_nonflat_base():
    resolver = coc_rulesets.get_resolver({"ruleset_id": "coc7"})
    sheet = {
        "era": "1920s",
        "characteristics": {"DEX": 60},
        "skills": {"First Aid": {"value": 77}},
    }
    resolve = coc_rulesets.resolve_actor_skill_value

    assert resolve(resolver, sheet, "First Aid") == 77
    sheet["skills"].pop("First Aid")
    assert resolve(resolver, sheet, "First Aid") == 30
    assert resolve(resolver, sheet, "Medicine") == 1
    assert resolve(resolver, sheet, "Unknown Skill") is None
    assert resolve(resolver, sheet, "Dodge") is None
    assert resolve(resolver, sheet, "Computer Use") is None
    sheet["skills"]["First Aid"] = None
    assert resolve(resolver, sheet, "First Aid") is None


def test_packaged_graph_settle_executes_two_rescuer_first_aid_once(
    tmp_path: Path,
):
    ws = _fresh_workspace(tmp_path, "graph-teamwork")
    _set_sheet_skill(ws, "First Aid", 1)
    _add_rescuer_sheet(ws, "rescuer-assistant", first_aid=99)
    time_state = json.loads(
        (ws["campaign_dir"] / "save" / "time-state.json")
        .read_text(encoding="utf-8")
    )
    elapsed = int(time_state["clock"]["elapsed_minutes"])
    _wounded_state(ws, hp=5, occurred_elapsed=elapsed)

    context = _run(ws, "rules.context", {
        "investigator": ws["investigator_id"],
        "family": "healing",
        "selected_affordance_ids": [_ORDINARY_FIRST_AID],
    })
    assert context["ok"] is True, context
    assert [
        row["decision_ref"] for row in context["data"]["cards"]
    ] == [_ORDINARY_FIRST_AID]

    args = {
        "investigator": ws["investigator_id"],
        "decision_ref": _ORDINARY_FIRST_AID,
        "semantic_inputs": {
            "rescuer_ref": ws["investigator_id"],
            "assistant_rescuer_ref": "rescuer-assistant",
        },
        "decision_id": "healing:graph-teamwork:first-aid",
        "seed": 2,
    }
    settled = _run(ws, "rules.settle", args)
    assert settled["ok"] is True, settled
    assert settled["data"]["family"] == "healing"
    assert settled["data"]["status"] == "settled"
    assert settled["data"]["event"]["teamwork"] is True
    assert settled["data"]["player_state_receipt"]["hp"] == {
        "before": 5,
        "after": 6,
    }
    rolls = _rolls(ws)
    assert len(rolls) == 2
    assert [row["payload"]["actor_id"] for row in rolls] == [
        ws["investigator_id"], "rescuer-assistant",
    ]
    assert [row["payload"]["dice"]["total"] for row in rolls] == [8, 12]

    replay = _run(ws, "rules.settle", args)
    assert replay["ok"] is True, replay
    assert replay["data"] == settled["data"]
    assert len(_rolls(ws)) == 2
    assert _inv_state(ws)["current_hp"] == 6


def test_coc7_adapter_owns_healing_host_binding_and_executor_shape(tmp_path: Path):
    ws = _fresh_workspace(tmp_path, "adapter-host-binding")
    _set_sheet_skill(ws, "First Aid", 77)
    kernel = coc_toolbox.coc_operation_kernel
    ctx = kernel.Ctx(ws["workspace"], ws["campaign_id"])
    adapter = coc_rulesets.get_rule_graph_adapter("coc7")
    args = {
        "investigator": ws["investigator_id"],
        "decision_id": "adapter-host-binding-1",
    }
    selected = {
        "semantic_inputs": {"rescuer_ref": ws["investigator_id"]},
    }
    provider = adapter.host_locked_provider(
        ctx,
        args,
        selected,
        resolve_investigator=kernel._resolve_investigator,
        safe_sheet=kernel._safe_sheet,
        skill_value=lambda sheet, skill_name: (
            coc_rulesets.resolve_actor_skill_value(
                kernel._rules_resolver(ctx, None), sheet, skill_name,
            )
        ),
    )
    locked = provider("decision:coc7:healing:first-aid-stabilization")
    assert locked == {
        "skill_value": 77,
        "rescuer_id": ws["investigator_id"],
        "pushed": False,
    }
    execution = adapter.executor_args(
        ctx,
        {
            "capability": {"resolver_capability": "first_aid"},
            "command": {"payload": locked},
        },
        selected,
        args,
        resolve_investigator=kernel._resolve_investigator,
        tool_error=kernel.ToolError,
    )
    assert execution == {
        "investigator": ws["investigator_id"],
        "decision_id": "adapter-host-binding-1",
        "skill_value": 77,
        "rescuer_id": ws["investigator_id"],
        "pushed": False,
    }


def test_runtime_settle_exclusion_scopes_are_no_candidate(tmp_path: Path):
    graph, manifest = _build_fixture_graph(tmp_path)
    promo = manifest.setdefault("family_promotion_eligibility", {}).setdefault(
        "healing", {}
    )
    promo["shadow_exclusions"] = [
        {
            "exclusion_id": "first-aid-one-hour-eligibility-enforcement",
            "exception_ref": "exception:coc7:healing:first-aid-window-uncompiled",
            "decision_ref": "decision:coc7:healing:first-aid-ordinary",
        },
        {
            "exclusion_id": "dual-rescuer-either-success-composition",
            "exception_ref": "exception:coc7:healing:first-aid-teamwork-uncompiled",
            "decision_ref": "decision:coc7:healing:first-aid-ordinary",
        },
    ]
    facts = coc_rules_runtime.facts_from_state(
        {"current_hp": 0, "conditions": ["major_wound", "dying"]},
        {"characteristics": {"CON": 60}, "derived": {"HP": 12}},
    )
    runtime = _dying_facts_result(graph, manifest, facts)
    for ref in (
        "exception:coc7:healing:first-aid-window-uncompiled",
        "exception:coc7:healing:first-aid-teamwork-uncompiled",
        "first-aid-one-hour-eligibility-enforcement",
        "dual-rescuer-either-success-composition",
    ):
        result = runtime.settle(
            {"decision_ref": ref, "semantic_inputs": {}},
            f"excl-{ref}",
        )
        assert result["status"] == "no_candidate_in_compiled_scope", ref
        assert result["failure"]["code"] == "no_candidate_in_compiled_scope"


_TEST_EXCEPTION = "exception:coc7:healing:test-unevaluable-window"
_ORDINARY_FIRST_AID = "decision:coc7:healing:first-aid-ordinary"


def _packaged_runtime(facts):
    loaded = coc_rules_runtime.load_ruleset_graph(
        "coc7", rulesets_root_path=coc_rules_runtime.rulesets_root(),
    )
    assert loaded["ok"] is True, loaded
    package = coc_rules_runtime._load_manifest_cached(
        "coc7", coc_rules_runtime.rulesets_root(),
    )
    return coc_rules_runtime.RulesRuntime(
        loaded["graph"], ruleset_id="coc7",
        graph_manifest=loaded["graph_manifest"],
        package_manifest=package,
        facts_provider=lambda: facts,
        projection_audience="keeper",
    )


def test_packaged_healing_cards_carry_rule_and_source_refs():
    runtime = _packaged_runtime(coc_rules_runtime.facts_from_state(
        {
            "current_hp": 5,
            "conditions": ["major_wound"],
            "wound_ledger": [{
                "wound_id": "wound-production-card",
                "source_damage_roll_id": "roll-production-card",
                "occurred_elapsed_minutes": 0,
                "status": "active",
            }],
        },
        {"derived": {"HP": 12}},
        elapsed_minutes=30,
    ))
    cards = runtime.context({"family": "healing", "kind": "procedure"})[
        "cards"
    ]
    ordinary = next(
        card for card in cards
        if card["decision_ref"]
        == "decision:coc7:healing:first-aid-ordinary"
    )
    assert ordinary["rule_refs"]
    assert ordinary["source_refs"]
    assert all(ref.startswith("rule:coc7:healing:") for ref in ordinary["rule_refs"])
    assert all(ref.startswith("span-") for ref in ordinary["source_refs"])


def _wounded_state(ws, *, hp=5, occurred_elapsed=0):
    inv = ws["investigator_id"]
    state_path = (
        ws["campaign_dir"] / "save" / "investigator-state" / f"{inv}.json"
    )
    state = json.loads(state_path.read_text(encoding="utf-8"))
    state.update({
        "current_hp": hp,
        "conditions": ["major_wound"],
        "wound_ledger": [{
            "wound_id": "wound-exclusion-test",
            "source_damage_roll_id": "damage-exclusion-test",
            "occurred_elapsed_minutes": occurred_elapsed,
            "status": "active",
        }],
    })
    _write_json(state_path, state)


def test_first_aid_one_hour_window_is_a_hard_applicability_gate(tmp_path: Path):
    state = {
        "current_hp": 5,
        "conditions": ["major_wound"],
        "wound_ledger": [{
            "wound_id": "wound-window",
            "source_damage_roll_id": "damage-window",
            "occurred_elapsed_minutes": 0,
            "status": "active",
        }],
    }
    at_limit = coc_rules_runtime.facts_from_state(
        state,
        {"derived": {"HP": 12}},
        elapsed_minutes=60,
    )
    within = _packaged_runtime(at_limit).context({"family": "healing"})
    assert _ORDINARY_FIRST_AID in {
        row["decision_ref"] for row in within["cards"]
    }

    after_limit = coc_rules_runtime.facts_from_state(
        state,
        {"derived": {"HP": 12}},
        elapsed_minutes=61,
    )
    assert after_limit["time.minutes_since_injury"] == 61
    projected = _packaged_runtime(after_limit).context({"family": "healing"})
    assert _ORDINARY_FIRST_AID not in {
        row["decision_ref"] for row in projected["cards"]
    }
    unknown_time = coc_rules_runtime.facts_from_state(
        {
            "current_hp": 5,
            "conditions": ["major_wound"],
        },
        {"derived": {"HP": 12}},
    )
    unknown = _packaged_runtime(unknown_time).context({"family": "healing"})
    assert _ORDINARY_FIRST_AID not in {
        row["decision_ref"] for row in unknown["cards"]
    }

    ws = _fresh_workspace(tmp_path, "window")
    time_state = json.loads(
        (ws["campaign_dir"] / "save" / "time-state.json").read_text(encoding="utf-8")
    )
    elapsed = int(time_state["clock"]["elapsed_minutes"])
    _wounded_state(ws, occurred_elapsed=elapsed)
    advanced = _run(ws, "state.advance_time", {
        "minutes": 61,
        "reason": "more than one hour after the wound",
        "decision_id": "advance-window-hour",
    })
    assert advanced["ok"] is True, advanced
    context = _run(ws, "rules.context", {
        "investigator": ws["investigator_id"],
        "family": "healing",
    })
    assert context["ok"] is True, context
    assert _ORDINARY_FIRST_AID not in {
        row["decision_ref"] for row in context["data"]["cards"]
    }
    settled = _run(ws, "rules.settle", {
        "investigator": ws["investigator_id"],
        "decision_ref": _ORDINARY_FIRST_AID,
        "semantic_inputs": {},
        "decision_id": "settle-window-1",
        "seed": 7,
    })
    assert settled["ok"] is False, settled
    assert settled["error"]["code"] == "rule_decision_stale"
    assert _rolls(ws) == []
    assert _inv_state(ws)["current_hp"] == 5


def test_dual_rescuer_is_a_compiled_optional_semantic_input():
    facts = coc_rules_runtime.facts_from_state(
        {
            "current_hp": 5,
            "conditions": ["major_wound"],
            "wound_ledger": [{
                "wound_id": "wound-team",
                "source_damage_roll_id": "damage-team",
                "occurred_elapsed_minutes": 0,
                "status": "active",
            }],
        },
        {"derived": {"HP": 12}},
        extra={"intent.rescuer_count": 2},
        elapsed_minutes=0,
    )
    runtime = _packaged_runtime(facts)
    projected = runtime.context({"family": "healing"})
    card = next(
        row for row in projected["cards"]
        if row["decision_ref"] == _ORDINARY_FIRST_AID
    )
    assistant = next(
        row for row in card["required_inputs"]
        if row["name"] == "assistant_rescuer_ref"
    )
    assert assistant["owner"] == "optional-semantic"
    assert not card.get("active_exceptions")


_MISSING_EXPRESSION = object()


def _wounded_facts(*, extra=None, elapsed=0):
    return coc_rules_runtime.facts_from_state(
        {
            "current_hp": 5,
            "conditions": ["major_wound"],
            "wound_ledger": [{
                "wound_id": "wound-eval",
                "source_damage_roll_id": "damage-eval",
                "occurred_elapsed_minutes": 0,
                "status": "active",
            }],
        },
        {"derived": {"HP": 12}},
        extra=extra,
        elapsed_minutes=elapsed,
    )


def _runtime_with_window_expression(expression, facts):
    loaded = coc_rules_runtime.load_ruleset_graph(
        "coc7", rulesets_root_path=coc_rules_runtime.rulesets_root(),
    )
    assert loaded["ok"] is True, loaded
    graph = copy.deepcopy(loaded["graph"])
    properties = {"family_id": "healing"}
    if expression is not _MISSING_EXPRESSION:
        properties["expression"] = expression
    graph["nodes"].append({
        "node_id": _TEST_EXCEPTION,
        "node_kind": "exception",
        "name": "Synthetic unevaluable exception for runtime audit tests",
        "authority": "deterministic",
        "audience": "host-internal",
        "visibility": "keeper-only",
        "hard_gate": True,
        "properties": properties,
        "evidence_span_ids": [],
    })
    graph["relations"].append({
        "relation_id": "relation:coc7:healing:test-unevaluable-applies",
        "relation_kind": "applies-to",
        "from_node_id": _TEST_EXCEPTION,
        "to_node_id": _ORDINARY_FIRST_AID,
        "evidence_span_ids": [],
    })
    graph_manifest = copy.deepcopy(loaded["graph_manifest"])
    graph_manifest["family_promotion_eligibility"]["healing"][
        "shadow_exclusions"
    ] = [{
        "exclusion_id": "test-unevaluable-window",
        "exception_ref": _TEST_EXCEPTION,
        "decision_ref": _ORDINARY_FIRST_AID,
    }]
    package = coc_rules_runtime._load_manifest_cached(
        "coc7", coc_rules_runtime.rulesets_root(),
    )
    return coc_rules_runtime.RulesRuntime(
        graph, ruleset_id="coc7",
        graph_manifest=graph_manifest,
        package_manifest=package,
        facts_provider=lambda: facts,
        projection_audience="keeper",
    )


@pytest.mark.parametrize(
    "expression,reason",
    [
        (
            {"op": "regex", "path": "time.minutes_since_injury", "value": ".*"},
            "unknown_operator",
        ),
        (
            {"op": "gt", "path": "actor.prose.guess", "value": 1},
            "unregistered_path",
        ),
        ({"op": "all"}, "malformed_expression"),
        ("not-an-object", "malformed_expression"),
        (_MISSING_EXPRESSION, "malformed_expression"),
    ],
)
def test_unevaluable_exception_condition_is_surfaced(expression, reason):
    facts = _wounded_facts(elapsed=0)
    runtime = _runtime_with_window_expression(expression, facts)
    projected = runtime.context({"family": "healing"})
    card = next(
        row for row in projected["cards"]
        if row["decision_ref"] == _ORDINARY_FIRST_AID
    )
    assert _TEST_EXCEPTION in card["active_exceptions"]
    markers = card["unevaluated_exceptions"]
    assert any(
        item.get("exception_ref") == _TEST_EXCEPTION
        and item.get("evaluation") == "unevaluated"
        and item.get("reason") == reason
        for item in markers
    )
    findings = projected.get("findings") or []
    assert any(
        item.get("code") == "exception_condition_unevaluated"
        and item.get("exception_ref") == _TEST_EXCEPTION
        and item.get("reason") == reason
        for item in findings
    )
    calls: list[str] = []

    def executor(plan, decision_id, selected):
        calls.append(decision_id)
        raise AssertionError("unevaluated exception must not execute")

    result = runtime.settle(
        {"decision_ref": _ORDINARY_FIRST_AID, "semantic_inputs": {}},
        "excl-uneval-1",
        executor=executor,
    )
    assert result["status"] == "no_candidate_in_compiled_scope"
    assert _TEST_EXCEPTION in result["active_exceptions"]
    assert any(
        item.get("reason") == reason
        for item in (result.get("unevaluated_exceptions") or [])
    )
    assert any(
        item.get("code") == "exception_condition_unevaluated"
        for item in (result.get("findings") or [])
    )
    assert calls == []


def test_public_context_omits_host_internal_cards_and_audit_keeps_findings(
    tmp_path: Path, monkeypatch,
):
    """Toolbox rules.context: public envelope is clean; shadow log retains findings."""
    loaded = coc_rules_runtime.load_ruleset_graph(
        "coc7", rulesets_root_path=coc_rules_runtime.rulesets_root(),
    )
    assert loaded["ok"] is True, loaded
    internal_runtime = _runtime_with_window_expression(
        {"op": "regex", "path": "time.minutes_since_injury", "value": ".*"},
        _wounded_facts(elapsed=0),
    )
    graph = copy.deepcopy(internal_runtime._graph)

    def fake_load(ruleset_id, **kwargs):
        return {
            "ok": True,
            "graph": graph,
            "graph_manifest": internal_runtime._graph_manifest,
            "content_digest": loaded.get("content_digest"),
            "source": "package",
        }

    monkeypatch.setattr(coc_rules_runtime, "load_ruleset_graph", fake_load)
    log_path = tmp_path / "shadow-findings.jsonl"
    monkeypatch.setenv(coc_rules_runtime.SHADOW_LOG_ENV, str(log_path))
    ws = _fresh_workspace(tmp_path, "audit-findings")
    time_state = json.loads(
        (ws["campaign_dir"] / "save" / "time-state.json").read_text(encoding="utf-8")
    )
    elapsed = int(time_state["clock"]["elapsed_minutes"])
    _wounded_state(ws, occurred_elapsed=elapsed)
    context = _run(ws, "rules.context", {
        "investigator": ws["investigator_id"],
        "family": "healing",
    })
    assert context["ok"] is True, context
    public = context["data"]
    assert "findings" not in public
    assert "exception_condition_unevaluated" not in json.dumps(public)
    ordinary_public = next(
        row for row in public["cards"]
        if row["decision_ref"] == _ORDINARY_FIRST_AID
    )
    assert "active_exceptions" not in ordinary_public
    assert "unevaluated_exceptions" not in ordinary_public

    package = coc_rules_runtime._load_manifest_cached(
        "coc7", coc_rules_runtime.rulesets_root(),
    )
    internal = internal_runtime.context({"family": "healing"})
    card = next(
        row for row in internal["cards"]
        if row["decision_ref"] == _ORDINARY_FIRST_AID
    )
    assert _TEST_EXCEPTION in (card.get("active_exceptions") or [])
    coc_rules_runtime.record_host_internal_findings(
        internal.get("findings") or [],
        campaign_id=ws["campaign_id"],
        family="healing",
        investigator_id=ws["investigator_id"],
        ruleset_id="coc7",
        tool="rules.context",
    )
    rows = _shadow_rows(log_path)
    assert rows, "host-internal findings must reach the shadow log"
    retained = [
        item
        for row in rows
        if row.get("contract_id") == "coc.rule-graph-shadow-log.v1"
        for item in (row.get("findings") or [])
    ]
    assert any(
        item.get("code") == "exception_condition_unevaluated"
        and item.get("exception_ref") == _TEST_EXCEPTION
        and item.get("reason") == "unknown_operator"
        for item in retained
    )
    assert any(
        row.get("campaign_id") == ws["campaign_id"]
        and row.get("investigator_id") == ws["investigator_id"]
        and row.get("tool") == "rules.context"
        for row in rows
    )
    save_docs = [
        path for path in (ws["campaign_dir"] / "save").rglob("*")
        if path.is_file()
    ]
    assert all(
        "exception_condition_unevaluated" not in path.read_text(encoding="utf-8")
        for path in save_docs
    )


def test_dual_rescuer_choice_stays_optional_until_settlement(tmp_path: Path):
    ws = _fresh_workspace(tmp_path, "gap-team")
    time_state = json.loads(
        (ws["campaign_dir"] / "save" / "time-state.json").read_text(encoding="utf-8")
    )
    elapsed = int(time_state["clock"]["elapsed_minutes"])
    _wounded_state(ws, occurred_elapsed=elapsed)
    context = _run(ws, "rules.context", {
        "investigator": ws["investigator_id"],
        "family": "healing",
    })
    assert context["ok"] is True, context
    ordinary = next(
        row for row in context["data"]["cards"]
        if row.get("decision_ref") == _ORDINARY_FIRST_AID
    )
    assert any(
        row.get("name") == "assistant_rescuer_ref"
        and row.get("owner") == "optional-semantic"
        for row in ordinary["required_inputs"]
    )
    assert "active_exceptions" not in ordinary
    assert "findings" not in context["data"]
    scene = _run(ws, "scene.context", {
        "investigator": ws["investigator_id"],
    })
    assert scene["ok"] is True, scene
    scene_cards = (
        (scene["data"].get("rule_decision_cards") or {}).get("cards") or []
    )
    scene_ordinary = next(
        (
            row for row in scene_cards
            if row.get("decision_ref") == _ORDINARY_FIRST_AID
        ),
        None,
    )
    assert scene_ordinary is not None


def test_runtime_settle_executes_injected_adapter_when_graph_owned(tmp_path: Path):
    graph, manifest = _build_fixture_graph(tmp_path)
    facts = coc_rules_runtime.facts_from_state(
        {"current_hp": 0, "conditions": ["major_wound", "dying"]},
        {"characteristics": {"CON": 60}, "derived": {"HP": 12}},
    )
    runtime = _graph_owned_runtime(graph, manifest, facts)
    grant = _context_grant(runtime)
    calls: list[tuple[str, str]] = []

    def executor(plan, decision_id, selected):
        calls.append((plan["capability"]["resolver_capability"], decision_id))
        return {"event": {"outcome": "success"}}, [], ["adapter-hint"]

    result = runtime.settle({
        "decision_ref": "decision:coc7:healing:first-aid-stabilization",
        "semantic_inputs": {"skill_value": 99, "pushed": False},
    }, "healing:harvey:first-aid:graph-exec", card_grant=grant, executor=executor)
    assert result["status"] == "settled"
    assert result["settlement"]["existing_result_envelope"] is True
    assert result["settlement"]["execution"] == "canonical-resolver-subsystem"
    assert result["settlement"]["result"]["event"]["outcome"] == "success"
    assert result["hints"] == ["adapter-hint"]
    assert calls == [("first_aid", "healing:harvey:first-aid:graph-exec")]


def test_runtime_settle_graph_owned_without_executor_fails_closed(tmp_path: Path):
    graph, manifest = _build_fixture_graph(tmp_path)
    facts = coc_rules_runtime.facts_from_state(
        {"current_hp": 0, "conditions": ["major_wound", "dying"]},
        {"characteristics": {"CON": 60}, "derived": {"HP": 12}},
    )
    runtime = _graph_owned_runtime(graph, manifest, facts)
    grant = _context_grant(runtime)
    result = runtime.settle({
        "decision_ref": "decision:coc7:healing:first-aid-stabilization",
        "semantic_inputs": {"skill_value": 99, "pushed": False},
    }, "healing:harvey:first-aid:no-exec", card_grant=grant)
    assert result["status"] == "rules_graph_unavailable"
    assert result["failure"]["code"] == "rules_graph_unavailable"


def test_graph_owned_healing_rejects_settle_without_current_card_grant(
    tmp_path: Path, _frozen_clocks,
):
    ws = _fresh_workspace(tmp_path / "fixture", "graph-grant")
    _dying_state(ws)
    _set_sheet_skill(ws, "First Aid", 99)
    settled = _run(ws, "rules.settle", {
        "investigator": ws["investigator_id"],
        "decision_ref": "decision:coc7:healing:first-aid-stabilization",
        "semantic_inputs": {},
        "decision_id": "graph-settle-without-grant-1",
    })
    assert settled["ok"] is False, settled
    assert settled["error"]["code"] == "rule_decision_stale"
    assert _rolls(ws) == []


def test_hidden_legacy_adapter_replay_uses_one_canonical_result(
    tmp_path: Path, _frozen_clocks,
):
    ws = _fresh_workspace(tmp_path, "replay")
    _dying_state(ws)
    _set_sheet_skill(ws, "First Aid", 99)
    args = {
        "investigator": ws["investigator_id"],
        "skill_value": 99,
        "rescuer_id": ws["investigator_id"],
        "decision_id": "legacy-replay-1",
        "seed": 7,
    }
    first = _run(ws, "rules.first_aid", args)
    assert first["ok"] is True, first
    replay = _run(ws, "rules.first_aid", args)
    assert replay["ok"] is True, replay
    assert replay["data"] == first["data"]
    changed_retry = _run(ws, "rules.first_aid", {
        **args,
        "skill_value": 98,
    })
    assert changed_retry["ok"] is True
    assert changed_retry["data"] == first["data"]
    assert len(_rolls(ws)) == 1


def test_graph_owned_healing_fails_closed_when_graph_is_absent(
    tmp_path: Path, monkeypatch,
):
    ws = _fresh_workspace(tmp_path, "absent")
    _dying_state(ws)
    before = _state_bytes(ws)

    def fake_load(ruleset_id, **kwargs):
        return {"ok": False, "reason": "graph_absent", "findings": ["test-absent"]}

    monkeypatch.setattr(coc_rules_runtime, "load_ruleset_graph", fake_load)
    result = _run(ws, "rules.settle", {
        "investigator": ws["investigator_id"],
        "decision_ref": "decision:coc7:healing:first-aid-stabilization",
        "semantic_inputs": {},
        "decision_id": "absent-graph-owned-1",
        "seed": 7,
    })
    assert result["ok"] is False, result
    assert result["error"]["code"] == "rules_graph_unavailable"
    assert _state_bytes(ws) == before
    assert _rolls(ws) == []


def test_scene_context_projects_only_current_graph_healing_cards(tmp_path: Path):
    ws = _fresh_workspace(tmp_path, "cards")
    _dying_state(ws)
    context = _run(ws, "scene.context", {
        "investigator": ws["investigator_id"],
    })
    assert context["ok"] is True, context
    cards_block = context["data"]["rule_decision_cards"]
    assert cards_block["authority"]["hard_gate"] is False
    assert cards_block["authority"]["role"] == "affordance"
    refs = {card["decision_ref"] for card in cards_block["cards"]}
    assert refs == {
        "decision:coc7:healing:first-aid-stabilization",
        "decision:coc7:healing:dying-round-clock",
    }
    recovery = context["data"]["recovery"]["healing"]
    assert recovery["authority"]["hard_gate"] is False
    assert {card["decision_ref"] for card in recovery["cards"]} == refs
    assert "card_grant" not in context["data"]
    assert "card_grant" not in cards_block
    dumped = json.dumps(cards_block)
    assert "sha256" not in dumped


def test_rules_damage_establishes_one_active_wound_and_projects_healing_cards(
    tmp_path: Path,
):
    """A normal HP damage write must feed the next RuleGraph projection."""
    ws = _fresh_workspace(tmp_path, "damage-wound-cards")
    args = {
        "investigator": ws["investigator_id"],
        "amount": "1D3",
        "kind": "damage",
        "source": "struck a desk corner",
        "decision_id": "damage-right-knuckles-desk-v1",
        "seed": 3,
    }

    damaged = _run(ws, "rules.damage", args)
    assert damaged["ok"] is True, damaged
    replay = _run(ws, "rules.damage", args)
    assert replay["ok"] is True, replay

    wounds = _inv_state(ws).get("wound_ledger")
    assert wounds == [{
        "wound_id": "wound-damage-right-knuckles-desk-v1",
        "source_damage_roll_id": damaged["data"]["roll_id"],
        "occurred_elapsed_minutes": 0,
        "status": "active",
    }]
    assert replay["data"] == damaged["data"]

    context = _run(ws, "scene.context", {
        "investigator": ws["investigator_id"],
    })
    assert context["ok"] is True, context
    refs = {
        row["decision_ref"]
        for row in context["data"]["rule_decision_cards"]["cards"]
    }
    assert "decision:coc7:healing:first-aid-ordinary" in refs
    assert "decision:coc7:healing:medicine-ordinary" in refs
    by_ref = {
        row["decision_ref"]: row
        for row in context["data"]["rule_decision_cards"]["cards"]
    }
    ordinary = by_ref["decision:coc7:healing:first-aid-ordinary"]
    assert ordinary["rule_refs"] == ["rule:coc7:healing:first-aid"]
    assert ordinary["source_refs"] == [
        "span-wounds-and-healing-page-131-block-18",
        "span-wounds-and-healing-page-131-block-24",
    ]
    projected = json.dumps(context["data"]["rule_decision_cards"])
    assert damaged["data"]["roll_id"] not in projected
    assert "source_damage_roll_id" not in projected
    visible_context = json.dumps(context["data"])
    assert "ruleset_damage_receipts" not in visible_context
    assert "integrity_digest" not in visible_context


@pytest.mark.parametrize(
    ("kind", "amount", "decision_id"),
    [
        ("damage", "0", "damage-zero-v1"),
        ("heal", "1", "heal-full-health-v1"),
    ],
)
def test_rules_damage_does_not_fabricate_wounds_without_hp_loss(
    tmp_path: Path,
    kind: str,
    amount: str,
    decision_id: str,
):
    ws = _fresh_workspace(tmp_path, decision_id)
    result = _run(ws, "rules.damage", {
        "investigator": ws["investigator_id"],
        "amount": amount,
        "kind": kind,
        "source": "no injury",
        "decision_id": decision_id,
    })
    assert result["ok"] is True, result
    assert "wound_ledger" not in _inv_state(ws)


def test_rules_damage_unknown_investigator_cannot_create_wound_state(
    tmp_path: Path,
):
    ws = _fresh_workspace(tmp_path, "damage-unknown-investigator")
    valid_before = _state_bytes(ws)
    unknown_id = "missing-investigator"
    result = _run(ws, "rules.damage", {
        "investigator": unknown_id,
        "amount": "1",
        "kind": "damage",
        "source": "invalid target",
        "decision_id": "damage-missing-investigator-v1",
    })
    assert result["ok"] is False, result
    assert _state_bytes(ws) == valid_before
    assert not (
        ws["campaign_dir"] / "save" / "investigator-state" / f"{unknown_id}.json"
    ).exists()


@pytest.mark.parametrize("failure_stage", ["state", "roll", "event", "ledger"])
def test_rules_damage_recovers_every_post_settlement_write_without_double_damage(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    failure_stage: str,
):
    ws = _fresh_workspace(tmp_path, f"damage-recovery-{failure_stage}")
    decision_id = f"damage-recovery-{failure_stage}-v1"
    args = {
        "investigator": ws["investigator_id"],
        "amount": "1D3",
        "kind": "damage",
        "source": "falling crate",
        "decision_id": decision_id,
        "seed": 3,
    }
    before_state = _inv_state(ws)
    before_state_bytes = _state_bytes(ws)
    ctx_type = coc_toolbox.Ctx
    method_name = {
        "state": "save_inv_state",
        "roll": "log_roll",
        "event": "log_event",
        "ledger": "ledger_record",
    }[failure_stage]
    original = getattr(ctx_type, method_name)
    failed_once = False

    def injected_failure(self, *call_args, **call_kwargs):
        nonlocal failed_once
        relevant = {
            "state": lambda: True,
            "roll": lambda: bool(
                call_args
                and isinstance(call_args[0], dict)
                and call_args[0].get("kind") == "hp_damage"
            ),
            "event": lambda: bool(
                call_args
                and isinstance(call_args[0], dict)
                and call_args[0].get("event_type") == "hp_change"
            ),
            "ledger": lambda: bool(
                len(call_args) >= 2 and call_args[1] == "rules.damage"
            ),
        }[failure_stage]()
        if relevant and not failed_once:
            failed_once = True
            raise OSError(f"injected {failure_stage} persistence failure")
        return original(self, *call_args, **call_kwargs)

    monkeypatch.setattr(ctx_type, method_name, injected_failure)
    failed = _run(ws, "rules.damage", args)
    assert failed["ok"] is False, failed
    assert failed_once is True
    assert any("exact same decision_id" in hint for hint in failed["hints"])

    if failure_stage == "state":
        assert _state_bytes(ws) == before_state_bytes
        assert _rolls(ws) == []
        assert not any(
            row.get("event_type") == "hp_change"
            for row in _read_jsonl(ws["campaign_dir"] / "logs" / "events.jsonl")
        )
    else:
        frozen_state = _inv_state(ws)
        assert decision_id in frozen_state["ruleset_damage_receipts"]
        assert frozen_state["current_hp"] < before_state["current_hp"]

    recovered = _run(ws, "rules.damage", args)
    assert recovered["ok"] is True, recovered
    assert recovered["data"]["hp_before"] == before_state["current_hp"]
    assert _inv_state(ws)["current_hp"] == recovered["data"]["hp_after"]
    assert len(_inv_state(ws)["wound_ledger"]) == 1
    roll_id = recovered["data"]["roll_id"]
    assert len([row for row in _rolls(ws) if row.get("roll_id") == roll_id]) == 1
    hp_events = [
        row
        for row in _read_jsonl(ws["campaign_dir"] / "logs" / "events.jsonl")
        if row.get("event_type") == "hp_change"
        and row.get("decision_id") == decision_id
    ]
    assert len(hp_events) == 1
    ledger = json.loads(
        (ws["campaign_dir"] / "save" / "toolbox-ledger.json").read_text(
            encoding="utf-8"
        )
    )
    entries = [
        row
        for row in ledger["entries"].values()
        if row.get("tool") == "rules.damage"
        and row.get("decision_id") == decision_id
    ]
    assert len(entries) == 1

    replay = _run(ws, "rules.damage", args)
    assert replay["ok"] is True, replay
    assert replay["data"] == recovered["data"]
    assert len(_inv_state(ws)["wound_ledger"]) == 1
    assert len([row for row in _rolls(ws) if row.get("roll_id") == roll_id]) == 1
    assert len([
        row
        for row in _read_jsonl(ws["campaign_dir"] / "logs" / "events.jsonl")
        if row.get("event_id") == hp_events[0]["event_id"]
    ]) == 1
    replay_ledger = json.loads(
        (ws["campaign_dir"] / "save" / "toolbox-ledger.json").read_text(
            encoding="utf-8"
        )
    )
    assert len([
        row
        for row in replay_ledger["entries"].values()
        if row.get("tool") == "rules.damage"
        and row.get("decision_id") == decision_id
    ]) == 1


def test_scene_context_survives_missing_graph(tmp_path: Path, monkeypatch):
    ws = _fresh_workspace(tmp_path, "cards-absent")

    def fake_load(ruleset_id, **kwargs):
        return {"ok": False, "reason": "graph_absent", "findings": ["test-absent"]}

    monkeypatch.setattr(coc_rules_runtime, "load_ruleset_graph", fake_load)
    context = _run(ws, "scene.context", {
        "investigator": ws["investigator_id"],
    })
    assert context["ok"] is True, context
    cards_block = context["data"]["rule_decision_cards"]
    assert cards_block["cards"] == []
    assert cards_block["authority"]["hard_gate"] is False


def test_finalize_projector_discovers_graph_healing_hp_receipt(
    tmp_path: Path, _frozen_clocks,
):
    ws = _fresh_workspace(tmp_path, "finalize-discover")
    _dying_state(ws)
    _set_sheet_skill(ws, "First Aid", 99)
    decision_ref = "decision:coc7:healing:first-aid-stabilization"
    context = _run(ws, "rules.context", {
        "investigator": ws["investigator_id"],
        "family": "healing",
        "selected_affordance_ids": [decision_ref],
    })
    assert context["ok"] is True, context
    settled = _run(ws, "rules.settle", {
        "investigator": ws["investigator_id"],
        "decision_ref": decision_ref,
        "semantic_inputs": {"rescuer_ref": ws["investigator_id"]},
        "decision_id": "discover-aid-1",
        "seed": 7,
    })
    assert settled["ok"] is True, settled
    assert settled["data"]["player_state_receipt"]["hp"]["after"] == (
        settled["data"]["current_hp"]
    )
    assert len(_rolls(ws)) == 1
    rows = coc_turn_finalization._project_state_deltas([{
        "ok": True,
        "tool": "rules.settle",
        "args": {
            "decision_id": "discover-aid-1",
            "investigator": ws["investigator_id"],
            "decision_ref": decision_ref,
        },
        "data": settled["data"],
    }])
    assert any(row.get("resource") == "HP" for row in rows)
