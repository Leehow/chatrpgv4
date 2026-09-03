"""One refusal for an input a decision never declared, whichever side sent it.

`unknown_semantic_input` had two emission sites in `_compile_plan` and they
said very different things. The model path named every offending key AND the
slots the Keeper may fill:

    not declared slots of this decision: 'described_action'; this decision
    takes candidate_ref, luck_spend_max, weapon_effect_refs, weapon_ref

The host path named one key and nothing else — no `declared_slots`, no
`model_owned_slots`, no statement of who owns the key:

    host-locked input 'chase_id' is not a declared slot

`unknown_semantic_input` projects to the Keeper as its own argument error with
`correct_model_arguments`, so the second form reads as "you sent something
wrong, guess again". The Keeper guesses, is refused identically, and
`nonretryable_repeat_blocked` walls the repeat off — a whole turn spent on it.
Observed 2026-09-01 in the gate9 depth-10 runs across three lanes: `source_ref`
on `decision:coc7:sanity:check` (clean-1, clean-3), `described_action` on
`decision:coc7:chase:move` (r22), host-locked `chase_id` on the same decision
(r23).

Everything below drives the real shipped coc7 RuleGraph, and the projection
test drives the real host projection — a refusal can read perfectly at the
runtime's return statement and arrive at the model stripped, because the host
rewrites canonical ids out of error prose and holds the values of
identity-bearing keys to the ref grammar.
"""

from __future__ import annotations

import copy
import importlib.util
import json
import subprocess
import sys
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "plugins" / "coc-keeper" / "scripts"
sys.path.insert(0, str(SCRIPTS))


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


rules_runtime = _load(
    "coc_rules_runtime_undeclared_slot_tests", SCRIPTS / "coc_rules_runtime.py",
)

GRAPH = json.loads(
    (ROOT / "plugins" / "coc-keeper" / "rulesets" / "coc7" / "rule-graph.json")
    .read_text(encoding="utf-8"),
)

CHASE_MOVE = "decision:coc7:chase:move"
SANITY_CHECK = "decision:coc7:sanity:check"
# The hard gate `condition:coc7:chase:move-applicable` states exactly this;
# without it the refusal under test is shadowed by not-applicable.
CHASE_FACTS = {"chase.session.active": True, "chase.pending.kind": "move"}


@pytest.fixture(scope="module")
def runtime():
    return rules_runtime.RulesRuntime(GRAPH, ruleset_id="coc7")


def _failure(runtime, decision_ref, semantic, *, facts, host_locked=None):
    result = runtime._compile_plan(
        decision_ref, semantic, facts=facts, host_locked=host_locked,
    )
    assert result["failure"] is not None, result
    return rules_runtime._thaw(result["failure"])


# --------------------------------------------------------------------------- #
# The host path — the one that said nothing
# --------------------------------------------------------------------------- #
def test_a_host_supplied_undeclared_input_names_every_key_and_its_owner(runtime):
    """r23: `host-locked input 'chase_id' is not a declared slot`, alone."""
    failure = _failure(
        runtime, CHASE_MOVE, {}, facts=CHASE_FACTS,
        host_locked={"chase_id": "chase:corbitt", "combat_command_id": "c1"},
    )
    assert failure["code"] == "unknown_semantic_input"
    # Every offending key at once, not one per round trip.
    assert failure["unknown"] == ["chase_id", "combat_command_id"]
    for key in ("chase_id", "combat_command_id"):
        assert repr(key) in failure["message"]
    # What the decision actually takes, which the host path never said.
    assert failure["declared_slots"] == [
        "action_id", "actor_id", "choice_id", "decision_id", "revision",
    ]
    assert failure["model_owned_slots"] == []
    assert "no semantic input at all" in failure["message"]
    # Host-owned, not merely undeclared: "you may not set it" is a different
    # instruction from "stop sending it", and a Keeper told the second one
    # rewrites arguments it never sent.
    assert failure["input_origin"] == "host"
    assert "the host fills these, not the Keeper" in failure["message"]
    assert "no change to semantic_inputs clears it" in failure["message"]


def test_both_paths_answer_with_the_same_slot_content(runtime):
    """One builder. The two used to drift; they cannot now."""
    model = _failure(
        runtime, CHASE_MOVE, {"described_action": "冲上楼梯"}, facts=CHASE_FACTS,
    )
    host = _failure(
        runtime, CHASE_MOVE, {}, facts=CHASE_FACTS,
        host_locked={"chase_id": "chase:corbitt"},
    )
    shared = (
        "declared_slots", "model_owned_slots", "required_semantic_slots",
        "optional_semantic_slots", "host_owned_slots", "decision_ref", "family",
    )
    for field in shared:
        assert model[field] == host[field], field
    # r22: the model path's own live case still answers in full.
    assert model["unknown"] == ["described_action"]
    assert model["input_origin"] == "model"
    assert "no semantic input at all" in model["message"]
    # Only the offending keys and who sent them differ.
    assert model["unknown"] != host["unknown"]
    assert model["input_origin"] != host["input_origin"]


# --------------------------------------------------------------------------- #
# Ownership — advertising a slot the Keeper may not set is the same defect
# --------------------------------------------------------------------------- #
def test_the_refusal_splits_required_from_optional_semantic_slots(runtime):
    """clean-1/clean-3: a stray `source_ref` on the sanity check."""
    failure = _failure(
        runtime, SANITY_CHECK, {"source_ref": "san-trigger:corbitt"}, facts={},
    )
    assert failure["unknown"] == ["source_ref"]
    assert failure["required_semantic_slots"] == [
        "involuntary_kind", "involuntary_summary", "loss_failure", "source",
    ]
    assert failure["optional_semantic_slots"] == ["loss_success", "trigger_ref"]
    assert failure["host_owned_slots"] == [
        "investigator_id", "san_before", "san_max", "trigger_id",
    ]
    # The Keeper is told which of the two a slot is, in the prose it reads.
    assert (
        "this decision takes involuntary_kind, involuntary_summary, "
        "loss_failure, source (optional: loss_success, trigger_ref)"
    ) in failure["message"]
    # And never told it "takes" a host-owned slot.
    for name in failure["host_owned_slots"]:
        assert name not in failure["model_owned_slots"]
        assert name not in failure["message"].split("this decision takes", 1)[1]


def test_a_resolver_owned_slot_is_never_advertised_as_one_the_keeper_may_send():
    """`settle()` refuses a model-supplied resolver-owned slot with
    `locked_input_override`, so naming one in "this decision takes" invites
    exactly that refusal.  The list was everything not literally
    `host-locked`, which let the other locked ownership through."""
    assert "resolver-owned" in rules_runtime._LOCKED_SLOT_OWNERSHIPS
    graph = copy.deepcopy(GRAPH)
    node = next(n for n in graph["nodes"] if n.get("node_id") == SANITY_CHECK)
    slots = node["properties"]["implementation"]["payload_slots"]
    flipped = next(slot for slot in slots if slot["name"] == "loss_success")
    assert flipped["ownership"] == "optional-semantic", (
        "this test is meaningless if the graph stops declaring loss_success "
        "as a model-owned slot"
    )
    flipped["ownership"] = "resolver-owned"
    runtime = rules_runtime.RulesRuntime(graph, ruleset_id="coc7")
    failure = _failure(runtime, SANITY_CHECK, {"source_ref": "x"}, facts={})
    assert "loss_success" in failure["declared_slots"]
    assert "loss_success" in failure["host_owned_slots"]
    assert "loss_success" not in failure["model_owned_slots"]
    assert "loss_success" not in failure["optional_semantic_slots"]
    assert "loss_success" not in failure["message"]


# --------------------------------------------------------------------------- #
# What the Keeper actually receives
# --------------------------------------------------------------------------- #
def _delivered_to_the_keeper(failure: dict, decision_ref: str, tmp_path: Path):
    """The canonical settle envelope, through the real host projection.

    `dispatch_rules_settle` raises `ToolError(code, message, details=result)`
    with the whole settle envelope as details; the wire then runs
    `projectModelVisibleCanonicalResult` and `attachExpectedSchema` over it.
    Asserting on the runtime's return value alone would pass while the
    projection scrubbed the refs out — `rewriteCanonicalIdsInError` rewrites
    error prose, and the identity sanitizer holds the values of
    identity-bearing keys to the ref grammar.
    """
    envelope = {
        "ok": False,
        "tool": "rules.settle",
        "error": {
            "code": failure["code"],
            "message": failure["message"],
            "details": {
                "schema_version": 1,
                "decision_ref": decision_ref,
                "decision_id": "roll-chase-move-flee-stairs-v1",
                "family": failure["family"],
                "status": failure["code"],
                "failure": failure,
            },
        },
        "warnings": [],
        "hints": [],
    }
    path = tmp_path / "settle-envelope.json"
    path.write_text(json.dumps(envelope), encoding="utf-8")
    completed = subprocess.run(
        [
            "node", "--experimental-strip-types",
            str(ROOT / "tests" / "pi" / "undeclared-slot-refusal.mjs"),
            str(ROOT), str(path),
        ],
        cwd=ROOT, check=True, capture_output=True, text=True,
    )
    return json.loads(completed.stdout)


def test_the_host_refusal_reaches_the_keeper_intact(runtime, tmp_path: Path):
    failure = _failure(
        runtime, CHASE_MOVE, {}, facts=CHASE_FACTS,
        host_locked={"chase_id": "chase:corbitt", "combat_command_id": "c1"},
    )
    error = _delivered_to_the_keeper(failure, CHASE_MOVE, tmp_path)
    assert error["code"] == "unknown_semantic_input"
    delivered = error["details"]["failure"]
    # The whole answer, at the model, not just at the return statement.
    assert delivered["unknown"] == ["chase_id", "combat_command_id"]
    assert delivered["input_origin"] == "host"
    assert delivered["declared_slots"] == [
        "action_id", "actor_id", "choice_id", "decision_id", "revision",
    ]
    assert delivered["model_owned_slots"] == []
    assert delivered["host_owned_slots"] == delivered["declared_slots"]
    assert "the host fills these, not the Keeper" in delivered["message"]
    assert "'chase_id'" in error["message"]
    assert "'combat_command_id'" in error["message"]
    # Still classified as recoverable rather than terminal: the Keeper's next
    # move is a different decision, not a dead turn.
    assert error["recoverable_by"] == "model_next_action"


def test_the_model_refusal_reaches_the_keeper_intact(runtime, tmp_path: Path):
    failure = _failure(
        runtime, SANITY_CHECK, {"source_ref": "san-trigger:corbitt"}, facts={},
    )
    error = _delivered_to_the_keeper(failure, SANITY_CHECK, tmp_path)
    delivered = error["details"]["failure"]
    assert delivered["unknown"] == ["source_ref"]
    assert delivered["input_origin"] == "model"
    assert delivered["required_semantic_slots"] == [
        "involuntary_kind", "involuntary_summary", "loss_failure", "source",
    ]
    assert delivered["optional_semantic_slots"] == [
        "loss_success", "trigger_ref",
    ]
    assert delivered["host_owned_slots"] == [
        "investigator_id", "san_before", "san_max", "trigger_id",
    ]
    assert "(optional: loss_success, trigger_ref)" in delivered["message"]
