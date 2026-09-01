"""DirectorGraph contract, compiler, and vocabulary-plane gates (slice D1).

Spec: docs/specs/pi-coc-director-graph-runtime.md
Inventory: docs/status/director-doctrine-inventory.md

These tests protect the two properties the migration exists to create:
accountability (every doctrine value declares where it came from) and
behavioural identity (no value changed while being moved).
"""
from __future__ import annotations

import importlib.util
import json
import sys
from collections import Counter
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "plugins" / "coc-keeper" / "scripts"
REFERENCES = ROOT / "plugins" / "coc-keeper" / "references"
CONTRACT_PATH = REFERENCES / "director-graph-contract-v1.json"
GRAPH_PATH = REFERENCES / "director-graph.json"
MANIFEST_PATH = REFERENCES / "director-graph-manifest.json"


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


coc_director_graph = _load("coc_director_graph_tests", SCRIPTS / "coc_director_graph.py")


def _contract() -> dict:
    return json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))


def _graph() -> dict:
    return json.loads(GRAPH_PATH.read_text(encoding="utf-8"))


def _kinds(graph: dict) -> Counter:
    return Counter(node["node_kind"] for node in graph["nodes"])


# --- contract -------------------------------------------------------------

def test_contract_declares_both_planes_and_closed_kinds():
    contract = _contract()
    assert contract["contract_id"] == "coc.director-graph-contract.v1"
    assert contract["planes"] == ["vocabulary", "doctrine"]
    assert set(contract["vocabulary_node_kinds"]) | set(
        contract["doctrine_node_kinds"]
    ) == set(contract["node_kinds"])
    assert not set(contract["vocabulary_node_kinds"]) & set(
        contract["doctrine_node_kinds"]
    )


def test_contract_carries_the_six_authority_laws():
    laws = _contract()["authority_laws"]
    assert len(laws) == 6
    assert any("advisory" in law for law in laws)
    assert any("universal graph interpreter" in law for law in laws)
    assert any("prose" in law for law in laws)
    assert any("Absence is not prohibition" in law for law in laws)
    assert any("coc_director_apply.py" in law for law in laws)


def test_contract_requires_accountability_fields_on_authored_doctrine():
    required = _contract()["evidence_class_required_keys"]["authored-doctrine"]
    assert set(required) == {"rationale", "origin", "falsifiable_by"}


# --- vocabulary plane -----------------------------------------------------

def test_graph_matches_the_measured_vocabulary_counts():
    graph = _graph()
    counts = _kinds(graph)
    expected = _contract()["expected_node_counts"]
    for kind, want in expected.items():
        assert counts[kind] == want, f"{kind}: {counts[kind]} != {want}"


def test_vocabulary_nodes_preserve_their_exact_legacy_key():
    graph = _graph()
    vocabulary_kinds = set(_contract()["vocabulary_node_kinds"])
    for node in graph["nodes"]:
        if node["node_kind"] not in vocabulary_kinds:
            continue
        legacy = node["properties"].get("legacy_key")
        assert isinstance(legacy, str) and legacy, node["node_id"]


def test_director_actions_keep_their_uppercase_runtime_tokens_and_order():
    """ACTIONS order is behaviourally observable in select_action.

    It seeds the score dict, is the fallback tiebreak order when the weights
    table omits an entry, and decides ``candidates[0]``. Node ids sort
    alphabetically, so order must survive as ``properties.ordinal``.
    """
    graph = _graph()
    rows = [n for n in graph["nodes"] if n["node_kind"] == "director-action"]
    actions = [
        node["properties"]["legacy_key"]
        for node in sorted(rows, key=lambda n: n["properties"]["ordinal"])
    ]
    assert actions == [
        "REVEAL", "DEEPEN", "PRESSURE", "CHARACTER", "CHOICE",
        "CUT", "MONTAGE", "SUBSYSTEM", "RECOVER", "PAYOFF",
    ]


def test_recent_class_subset_is_pinned_as_its_own_group():
    """coc_story_director calls it 'derived', but nothing computes it.

    It is a hand-written 6-item subset, so its exact membership is migrated
    rather than reconstructed from the low-agency group.
    """
    graph = _graph()
    rows = [
        node for node in graph["nodes"]
        if node["node_kind"] == "player-signal"
        and node["properties"]["signal_group"] == "low-agency-recent-class"
    ]
    members = {node["properties"]["legacy_key"] for node in rows}
    assert members == {
        "move", "continue", "follow", "follow_group",
        "low_agency_continue", "passive_follow",
    }


def test_player_signal_groups_are_contract_declared():
    graph = _graph()
    groups = _contract()["signal_groups"]
    for node in graph["nodes"]:
        if node["node_kind"] != "player-signal":
            continue
        assert node["properties"]["signal_group"] in groups, node["node_id"]


# --- identity -------------------------------------------------------------

def test_graph_vocabulary_is_identical_to_the_legacy_sources():
    """No vocabulary token may be renamed, added or dropped in migration."""
    graph = _graph()
    legacy = coc_director_graph.legacy_vocabulary()
    by_kind: dict[str, list[str]] = {}
    for node in graph["nodes"]:
        if node["node_kind"] not in legacy:
            continue
        legacy_key = node["properties"]["legacy_key"]
        if node["node_kind"] == "player-signal":
            legacy_key = f"{node['properties']['signal_group']}/{legacy_key}"
        by_kind.setdefault(node["node_kind"], []).append(legacy_key)
    for kind, tokens in legacy.items():
        assert sorted(by_kind.get(kind, [])) == sorted(tokens), kind


def test_every_vocabulary_kind_has_contiguous_ordinals():
    """Ordinals reconstruct legacy declaration order exactly, with no gaps."""
    graph = _graph()
    groups: dict[tuple[str, str], list[int]] = {}
    for node in graph["nodes"]:
        if node["node_kind"] not in set(_contract()["vocabulary_node_kinds"]):
            continue
        key = (
            node["node_kind"],
            node["properties"].get("signal_group", ""),
        )
        groups.setdefault(key, []).append(node["properties"]["ordinal"])
    for key, ordinals in groups.items():
        assert sorted(ordinals) == list(range(len(ordinals))), key


# --- compiler -------------------------------------------------------------

def test_compiler_round_trip_reproduces_the_committed_artifact():
    rebuilt = coc_director_graph.build_from_legacy_sources()
    assert rebuilt["graph"] == _graph()
    assert rebuilt["manifest"] == json.loads(
        MANIFEST_PATH.read_text(encoding="utf-8")
    )


def test_manifest_pins_a_content_digest_and_node_counts():
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    assert len(manifest["graph_content_digest"]) == 64
    counts = _kinds(_graph())
    for kind, want in manifest["node_counts"].items():
        assert counts[kind] == want


def test_accept_rejects_an_authored_doctrine_node_without_accountability():
    shard = {
        "contract_id": "coc.director-graph-shard.v1",
        "schema_version": 1,
        "shard_id": "shard:director:test",
        "plane": "doctrine",
        "nodes": [{
            "node_id": "threshold:test:example",
            "node_kind": "threshold",
            "plane": "doctrine",
            "name": "example",
            "evidence_class": "authored-doctrine",
            "properties": {
                "threshold_id": "example",
                "value": 2,
                "comparison": "gte",
                "subject": "stalled_turns",
            },
        }],
        "relations": [],
    }
    findings = coc_director_graph.accept(shard)
    assert any(f["code"] == "missing_accountability" for f in findings)


def test_accept_rejects_an_unknown_node_kind():
    shard = {
        "contract_id": "coc.director-graph-shard.v1",
        "schema_version": 1,
        "shard_id": "shard:director:test",
        "plane": "vocabulary",
        "nodes": [{
            "node_id": "mood-ring:teal",
            "node_kind": "mood-ring",
            "plane": "vocabulary",
            "name": "teal",
            "properties": {"legacy_key": "teal"},
        }],
        "relations": [],
    }
    findings = coc_director_graph.accept(shard)
    assert any(f["code"] == "unknown_node_kind" for f in findings)


def test_accept_rejects_a_non_semantic_node_id():
    shard = {
        "contract_id": "coc.director-graph-shard.v1",
        "schema_version": 1,
        "shard_id": "shard:director:test",
        "plane": "vocabulary",
        "nodes": [{
            "node_id": "director-action:REVEAL",
            "node_kind": "director-action",
            "plane": "vocabulary",
            "name": "REVEAL",
            "properties": {"legacy_key": "REVEAL"},
        }],
        "relations": [],
    }
    findings = coc_director_graph.accept(shard)
    assert any(f["code"] == "invalid_semantic_id" for f in findings)


# --- runtime seam ---------------------------------------------------------

coc_director_runtime = _load(
    "coc_director_runtime_tests", SCRIPTS / "coc_director_runtime.py"
)


def test_runtime_preserves_the_exact_legacy_container_types():
    """Shapes are behaviourally observable: membership tests vs ordered lists."""
    vocab = coc_director_runtime.vocabulary()
    assert isinstance(vocab["actions"], list)
    assert isinstance(vocab["low_agency_tags"], frozenset)
    assert isinstance(vocab["low_agency_recent_classes"], frozenset)
    assert isinstance(vocab["routine_progress_tags"], frozenset)
    assert isinstance(vocab["dramatic_progress_advance_until"], list)
    assert isinstance(vocab["non_blocking_rule_request_kinds"], set)
    assert isinstance(vocab["social_reveal_delivery_kinds"], set)


def test_runtime_fails_closed_when_the_artifact_is_missing(tmp_path, monkeypatch):
    """fail_closed_law: no silent fallback to embedded literals."""
    monkeypatch.setattr(
        coc_director_runtime, "GRAPH_PATH", tmp_path / "absent.json"
    )
    coc_director_runtime.reset_cache()
    try:
        with pytest.raises(coc_director_runtime.DirectorGraphUnavailable):
            coc_director_runtime.vocabulary()
    finally:
        coc_director_runtime.reset_cache()


def test_runtime_fails_closed_on_a_foreign_contract_id(tmp_path, monkeypatch):
    foreign = tmp_path / "foreign.json"
    foreign.write_text(
        json.dumps({"contract_id": "coc.rule-graph.v1", "nodes": []}),
        encoding="utf-8",
    )
    monkeypatch.setattr(coc_director_runtime, "GRAPH_PATH", foreign)
    coc_director_runtime.reset_cache()
    try:
        with pytest.raises(coc_director_runtime.DirectorGraphUnavailable):
            coc_director_runtime.vocabulary()
    finally:
        coc_director_runtime.reset_cache()


def test_story_director_reads_its_vocabulary_from_the_graph():
    """The D1 cutover identity check, asserted on the real consumer."""
    coc_director_runtime.reset_cache()
    story_director = _load(
        "coc_story_director_graph_tests", SCRIPTS / "coc_story_director.py"
    )
    vocab = coc_director_runtime.vocabulary()
    assert story_director.ACTIONS == vocab["actions"]
    assert story_director._LOW_AGENCY_TAGS == vocab["low_agency_tags"]
    assert story_director._LOW_AGENCY_RECENT_CLASSES == vocab[
        "low_agency_recent_classes"
    ]
    assert story_director._ROUTINE_PROGRESS_TAGS == vocab["routine_progress_tags"]
    assert story_director._DRAMATIC_PROGRESS_ADVANCE_UNTIL == vocab[
        "dramatic_progress_advance_until"
    ]
    assert story_director._LOW_AGENCY_CONTINUE_TAGS is story_director._LOW_AGENCY_TAGS


# --- doctrine plane: identity and residue -------------------------------

# Every migrated value, transcribed from the pre-migration source at
# 0.8.1a@60c1c4b4. If a future change retunes a value without a recorded
# DebugExperiment (slice D5), this table fails and says which one.
FROZEN_SCORES = {
    ("REVEAL", "investigate-intent"): 0.9,
    ("REVEAL", "social-intent"): 0.75,
    ("DEEPEN", "dramatic-question-present"): 0.5,
    ("PRESSURE", "yielded-scene"): 0.85,
    ("PRESSURE", "clock-near-full-or-stalled"): 0.8,
    ("PRESSURE", "baseline"): 0.2,
    ("PRESSURE", "reckless-posture-adjust"): 0.1,
    ("PRESSURE", "cautious-posture-adjust"): -0.1,
    ("PRESSURE", "pushed-fail-nudge"): 0.1,
    ("CHARACTER", "agenda-npc-in-scene"): 0.7,
    ("CHOICE", "two-undiscovered-clues"): 0.7,
    ("CUT", "explicit-move-intent"): 1.0,
    ("CUT", "exit-condition-met"): 0.8,
    ("CUT", "main-line-complete"): 0.7,
    ("CUT", "stalled-transition-pressure"): [0.45, 0.15, 0.85],
    ("MONTAGE", "montage-intent"): 0.6,
    ("SUBSYSTEM", "combat-flee-cast-intent"): 0.9,
    ("RECOVER", "stalled-turns"): 0.85,
    ("PAYOFF", "structured-entity-overlap"): [0.15, 0.12, 0.85],
}

FROZEN_THRESHOLDS = {
    "pressure-clock-near-full-fraction": [2, 3],
    "pressure-yielded-low-agency-count": 2,
    "pressure-stalled-turns": 1,
    "choice-undiscovered-clue-count": 2,
    "cut-stalled-transition-turns": 2,
    "recover-stalled-turns": 2,
    "override-low-agency-count": 2,
    "override-stalled-turns": 3,
    "scene-exit-pressure-continue-count": 2,
    "fair-warning-lethal-chances": 3,
    "compression-max-beats-default": 4,
    "compression-max-beats-floor": 2,
    "compression-max-beats-ceiling": 8,
    "compression-min-beats-default": 2,
    "compression-max-minutes-default": 10,
    "compression-max-minutes-ceiling": 30,
    "low-agency-max-beats-fallback": 4,
    "pressure-move-stalled-gate": 1,
    "pressure-move-low-agency-count": 2,
    "clue-route-default-priority": 0.5,
    "pressure-posture-ceiling": 0.95,
    "pressure-posture-floor": 0.05,
    "default-clock-segments": 6,
    "score-precision-digits": 4,
}


def test_every_migrated_score_is_bit_identical_to_the_pre_migration_literal():
    doctrine = coc_director_runtime.doctrine()
    for (action, condition), want in FROZEN_SCORES.items():
        got = doctrine.score(action, condition)
        assert got == want, f"{action}/{condition}: {got!r} != {want!r}"


def test_every_migrated_threshold_is_bit_identical_to_the_pre_migration_literal():
    doctrine = coc_director_runtime.doctrine()
    for threshold_id, want in FROZEN_THRESHOLDS.items():
        got = doctrine.threshold(threshold_id)
        assert got == want, f"{threshold_id}: {got!r} != {want!r}"


def test_structure_weights_are_bit_identical_to_the_package_table():
    """The 70 weight cells and the tiebreak order must survive unchanged."""
    live = json.loads(
        (ROOT / "plugins" / "coc-keeper" / "rulesets" / "coc7" / "rules-json"
         / "structure-weights.json").read_text(encoding="utf-8")
    )
    projected = coc_director_runtime.doctrine().structure_weights()
    assert projected["weights"] == live["weights"]
    assert projected["tiebreak_order"] == live["tiebreak_order"]


def test_clock_fraction_is_stored_as_a_numerator_denominator_pair():
    """A quotient would not be float-equivalent to the source's segments * 2 / 3."""
    num, den = coc_director_runtime.doctrine().threshold(
        "pressure-clock-near-full-fraction"
    )
    quotient = num / den
    diverging = [
        segments for segments in range(1, 200)
        if segments * num / den != segments * quotient
    ]
    assert diverging, "if these never diverge the pair is unnecessary"
    assert 5 in diverging


# Every numeric literal still allowed to live in the Director decision
# surface, with the reason it is not doctrine. Anything not listed here must
# be in the DirectorGraph. Adding an entry is a claim that a reviewer has to
# agree with, which is the point: the boundary is enforced, not remembered.
#
# An earlier version of this gate covered only the ten functions the first
# migration touched, which made it a gate that could only ever confirm its
# own work. It now covers the whole surface.
PLUMBING_ALLOWLIST: dict[str, dict[tuple[str, float | int], str]] = {
    "coc_story_director.py": {
        ("_short_text", 96): "default text truncation length",
        ("_choice_affordance", 80): "cue text truncation",
        ("_visible_affordance", 80): "cue text truncation",
        ("_live_scene_affordances", 80): "benefit text truncation",
        ("_build_scene_pressure_move", 140): "symptom text truncation",
        ("_projection_unavailable_warning", 200): "error text truncation",
        ("_retrieve_memory_for_ctx", 5): "debug reference list truncation",
        ("_retrieve_memory_for_ctx", 200): "debug text truncation",
        ("write_director_plan", 2): "json.dumps indent",
        # CoC7 character-sheet fallbacks. These belong to the rules layer, not
        # to Director doctrine: they are the values a sheet is read as when a
        # field is absent, and changing them would be a rules change.
        ("build_director_context", 10): "sheet fallback: HP",
        ("build_director_context", 50): "sheet fallback: characteristics and Luck",
        ("build_director_context", 25): "sheet fallback: Fighting (Brawl)",
        ("build_director_context", 2): "sheet fallback: Dodge is DEX // 2",
        ("_build_rules_requests", 50): "sheet fallback: attack target percent",
        ("_build_rules_requests", 100): "percentile ceiling",
    },
    "coc_storylets.py": {
        ("_stable_int_seed", 16): "hex digest slice width for seeding",
        ("start_new_session", 2): "json indent",
        ("storylet_eligibility_index", 8): "in-process cache size",
        ("select_storylet_moves", 5): "debug trace example cap",
    },
    "coc_director_strategies.py": {},
}


def test_no_doctrine_literal_remains_in_the_director_decision_surface():
    """Residue gate over the whole surface, not just the migrated functions.

    A hit means either a doctrine value was missed — in which case it goes
    into the graph — or it is plumbing, in which case it goes into
    PLUMBING_ALLOWLIST with a written reason. It never goes nowhere.
    """
    import ast

    allow_int = {0, 1, -1}
    allow_float = {0.0, 1.0}
    residue = []
    unused_allowlist = []

    for filename, allowed in PLUMBING_ALLOWLIST.items():
        path = SCRIPTS / filename
        text = path.read_text(encoding="utf-8")
        lines = text.splitlines()
        hit: set[tuple[str, float | int]] = set()
        for node in ast.walk(ast.parse(text)):
            if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            for sub in ast.walk(node):
                if not isinstance(sub, ast.Constant):
                    continue
                value = sub.value
                if isinstance(value, bool) or not isinstance(value, (int, float)):
                    continue
                if isinstance(value, int) and value in allow_int:
                    continue
                if isinstance(value, float) and value in allow_float:
                    continue
                key = (node.name, value)
                hit.add(key)
                if key in allowed:
                    continue
                residue.append(
                    f"{filename}:{node.name} L{sub.lineno}: {value!r}"
                    f" -- {lines[sub.lineno - 1].strip()}"
                )
        unused_allowlist.extend(
            f"{filename}:{fn}:{value!r}"
            for (fn, value) in allowed
            if (fn, value) not in hit
        )

    assert not residue, (
        "doctrine literals left in the Director decision surface — put each "
        "one in the DirectorGraph, or in PLUMBING_ALLOWLIST with a reason:\n"
        + "\n".join(residue)
    )
    assert not unused_allowlist, (
        "PLUMBING_ALLOWLIST entries no longer present in the source; remove "
        "them so the allowlist cannot quietly grow stale:\n"
        + "\n".join(unused_allowlist)
    )


def test_the_residue_gate_actually_covers_the_whole_surface():
    """Guard against the gate narrowing back to a self-confirming subset."""
    assert set(PLUMBING_ALLOWLIST) == {
        "coc_story_director.py",
        "coc_storylets.py",
        "coc_director_strategies.py",
    }
    # coc_director_apply.py is out of scope by specification, not by omission.
    assert "coc_director_apply.py" not in PLUMBING_ALLOWLIST


def test_doctrine_accountability_ledger_is_complete():
    """No authored-doctrine node may be missing a required field."""
    graph = _graph()
    doctrine_kinds = set(_contract()["doctrine_node_kinds"])
    incomplete = []
    for node in graph["nodes"]:
        if node["node_kind"] not in doctrine_kinds:
            continue
        assert node.get("evidence_class") in {
            "rule-derived", "module-derived", "authored-doctrine",
        }, node["node_id"]
        if node["evidence_class"] != "authored-doctrine":
            continue
        for field in ("rationale", "origin", "falsifiable_by"):
            if not str(node.get(field) or "").strip():
                incomplete.append(f"{node['node_id']}: {field}")
    assert not incomplete, incomplete


def test_the_two_page_cited_tunables_are_rule_derived():
    graph = _graph()
    by_id = {node["node_id"]: node for node in graph["nodes"]}
    for node_id in (
        "scoring-rule:pressure:pushed-fail-nudge",
        "threshold:fair-warning-lethal-chances",
    ):
        node = by_id[node_id]
        assert node["evidence_class"] == "rule-derived", node_id
        assert node["source_refs"], node_id


# --- D3 grounding plane --------------------------------------------------

def _directive(directive_id: str) -> dict:
    return next(
        node for node in _graph()["nodes"]
        if node["node_kind"] == "craft-directive"
        and node["properties"]["directive_id"] == directive_id
    )


def test_craft_directives_are_rule_derived_and_grounded():
    for directive_id in ("dying-clock-kind", "dying-forces-rescue-subsystem"):
        node = _directive(directive_id)
        assert node["evidence_class"] == "rule-derived", directive_id
        assert node["source_refs"], directive_id
        assert node["grounded_by"], directive_id


def test_dying_clock_directive_agrees_with_the_rulegraph_decisions():
    """The grounding must be real: same clock kinds, same stabilized split."""
    rule_graph = json.loads(
        (ROOT / "plugins" / "coc-keeper" / "rulesets" / "coc7"
         / "rule-graph.json").read_text(encoding="utf-8")
    )
    by_id = {node["node_id"]: node for node in rule_graph["nodes"]}
    declares = _directive("dying-clock-kind")["properties"]["declares"]
    for node_id in _directive("dying-clock-kind")["grounded_by"]:
        assert node_id in by_id, node_id
    hour = by_id["decision:coc7:healing:dying-hour-clock"]
    round_ = by_id["decision:coc7:healing:dying-round-clock"]
    assert hour["properties"]["implementation"]["payload_constants"]["clock_kind"] == (
        declares["stabilized"]
    )
    assert round_["properties"]["implementation"]["payload_constants"]["clock_kind"] == (
        declares["unstabilized"]
    )
    # Both compile to the same subsystem command the Director asks for.
    for decision in (hour, round_):
        assert decision["properties"]["implementation"]["kind"] == "dying_tick"


def test_craft_directives_do_not_drift_from_the_branches_they_declare():
    """A craft-directive is data about a real branch, not documentation.

    If the Director's control flow changes, these assertions fail and the
    directive must be updated with it.
    """
    source = (SCRIPTS / "coc_story_director.py").read_text(encoding="utf-8")

    clock = _directive("dying-clock-kind")["properties"]["declares"]
    assert '"kind": "dying_tick"' in source
    assert f'"{clock["stabilized"]}"\n' in source or f'"{clock["stabilized"]}"' in source
    assert (
        f'if "stabilized" in set(sig.get("active_conditions") or [])' in source
    )
    assert f'else "{clock["unstabilized"]}"' in source

    subsystem = _directive("dying-forces-rescue-subsystem")["properties"]["declares"]
    assert (
        f'return {{"scene_action": "{subsystem["scene_action"]}", '
        f'"subsystem": "{subsystem["subsystem"]}", "handoff": "rules",' in source
    )
    assert '"extra_pressure": True' in source


def test_registry_grounds_the_director_only_through_grounded_by():
    """ADR 0003: the Director's sole outward relation is advisory grounding."""
    registry = json.loads(
        (ROOT / "plugins" / "coc-keeper" / "references"
         / "system-ontology-registry-v1.json").read_text(encoding="utf-8")
    )
    director_refs = {
        row["ref_id"] for row in registry["references"]
        if row["graph_id"] == "graph:director:production"
    }
    assert director_refs
    outward = [
        row for row in registry["relations"] if row["from_ref"] in director_refs
    ]
    assert outward, "the director graph must carry at least one proven instance"
    assert {row["relation_kind"] for row in outward} == {"grounded-by"}
    # Nothing may point back into the Director: advisory means read-only.
    assert not [
        row for row in registry["relations"] if row["to_ref"] in director_refs
    ]


# --- D4 behavioural baseline ---------------------------------------------

BASELINE_PATH = ROOT / "checks" / "director-decision-baseline.json"
BASELINE_CAMPAIGN = "memory-playtest-20260820"


@pytest.mark.skipif(
    not (ROOT / ".coc" / "campaigns" / BASELINE_CAMPAIGN).is_dir(),
    reason="baseline campaign checkpoint is not present in this checkout",
)
def test_director_decisions_reproduce_the_committed_baseline():
    """D4 determinism gate.

    The same checkpoint must produce the same Director decisions every run.
    Without this, slice D5 has no "before" to compare a retune against — and
    the inventory established that no other test pins any doctrine value.
    """
    import subprocess

    result = subprocess.run(
        [
            sys.executable,
            str(ROOT / "scripts" / "gen_director_decision_baseline.py"),
            BASELINE_CAMPAIGN,
            "--check",
        ],
        capture_output=True, text=True, cwd=ROOT,
    )
    payload = json.loads(result.stdout or "{}")
    assert payload.get("ok"), payload.get("drift")


def test_baseline_covers_every_migrated_threshold_boundary():
    """A baseline that never crosses a threshold cannot detect a retune."""
    baseline = json.loads(BASELINE_PATH.read_text(encoding="utf-8"))
    pacing = {row["pacing"] for row in baseline["rows"]}
    # The stall thresholds live at 1, 2 and 3; the yielded gate at 2 continues.
    assert {"calm", "one-stall", "two-stall", "three-stall", "yielded"} <= pacing
    postures = {row["risk_posture"] for row in baseline["rows"]}
    assert {"neutral", "reckless", "cautious"} <= postures
    actions = {row["selected_action"] for row in baseline["rows"]}
    # A baseline that only ever selects one action would be worthless.
    assert len(actions) >= 5, actions


def test_baseline_states_its_scope_honestly():
    """It is a Director-decision baseline, not a whole-turn or quality one."""
    baseline = json.loads(BASELINE_PATH.read_text(encoding="utf-8"))
    scope = baseline["scope"].lower()
    assert "director decision" in scope
    assert "not a whole-turn" in scope


# --- D5a sensitivity triage ----------------------------------------------

SWEEP_PATH = ROOT / "checks" / "director-sensitivity-sweep.json"


def test_sweep_classifies_every_valued_doctrine_node():
    sweep = json.loads(SWEEP_PATH.read_text(encoding="utf-8"))
    graph = _graph()
    valued = {
        node["node_id"] for node in graph["nodes"]
        if node.get("plane") == "doctrine" and "value" in node["properties"]
    }
    assert {row["node_id"] for row in sweep["results"]} == valued
    assert sweep["counts"]["tested"] == len(valued)


def test_sweep_does_not_call_unexercised_values_inert():
    """The honesty gate on this deliverable.

    'inert-in-matrix' must mean "the probe read this value and perturbing it
    changed nothing". A value the probe never reads is a different claim
    entirely, and reporting it as inert would read as evidence it does not
    matter. Two ways a value goes unread here: it belongs to a structure type
    this checkpoint is not, or it belongs to a layer (storylet scheduling,
    time advance, affordance budget) the decision matrix does not exercise.
    """
    sweep = json.loads(SWEEP_PATH.read_text(encoding="utf-8"))
    exercised = str(sweep["checkpoint_structure_type"]).replace("_", "-")
    for row in sweep["results"]:
        if not row["node_id"].startswith("structure-weight:"):
            continue
        if row["node_id"].split(":")[1] != exercised:
            assert row["verdict"] == "not-exercised", row["node_id"]

    by_id = {row["node_id"]: row for row in sweep["results"]}
    # The storylet scheduler is invoked by storylets.suggest, not by
    # select_action, so the decision matrix cannot speak to its multipliers.
    for node_id in by_id:
        if node_id.startswith("multiplier:storylet-selection:"):
            assert by_id[node_id]["verdict"] == "not-exercised", node_id
    # Same for the time layer.
    assert by_id["threshold:time-advance-exhaustion-hours"]["verdict"] == (
        "not-exercised"
    )


def test_sweep_inert_verdicts_were_actually_read():
    """Every inert verdict must come from a value the probe demonstrably read."""
    sweep = json.loads(SWEEP_PATH.read_text(encoding="utf-8"))
    inert = [r for r in sweep["results"] if r["verdict"] == "inert-in-matrix"]
    assert inert, "no inert verdicts at all would mean the probe reads nothing"
    for row in inert:
        assert row["changed_rows"] == 0, row["node_id"]
        assert "reason" not in row, (
            f"{row['node_id']}: an inert row must not carry a not-exercised reason"
        )


def test_sweep_states_its_limits():
    sweep = json.loads(SWEEP_PATH.read_text(encoding="utf-8"))
    scope = sweep["scope"].lower()
    assert "not globally" in scope
    assert "not a quality judgement" in scope
    assert sweep["counts"]["decision_changing"] > 0, (
        "a sweep where nothing changes a decision would mean the matrix is "
        "not exercising the doctrine at all"
    )


def test_vocabulary_nodes_never_copy_the_body_they_name():
    """no_body_copy_law.

    storylet-library.json and time-costs.json stay the owning sources, and
    coc_storylets / coc_time keep reading them. Embedding their records here
    would create two copies of one semantics with no retirement owner — the
    exact pattern this refactor exists to remove.
    """
    graph = _graph()
    allowed = _contract()["node_property_keys"]
    for node in graph["nodes"]:
        if node["node_kind"] not in {"storylet", "time-cost-category"}:
            continue
        assert set(node["properties"]) == set(allowed[node["node_kind"]])
        assert "payload" not in node["properties"], node["node_id"]


def test_owning_json_sources_still_have_their_real_consumers():
    """The graph names records; it does not replace their owners."""
    storylets = (SCRIPTS / "coc_storylets.py").read_text(encoding="utf-8")
    assert "storylet-library.json" in storylets
    time_module = (SCRIPTS / "coc_time.py").read_text(encoding="utf-8")
    assert "time-costs.json" in time_module
