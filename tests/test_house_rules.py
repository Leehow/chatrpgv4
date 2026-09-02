"""Acceptance tests for the house-rule compile pipeline.

Built against `plugins/coc-keeper/scripts/coc_house_rules.py` and
`docs/specs/pi-coc-rule-override-and-session-rulings.md` §3.2, §3.4, §5 and §7.

Four properties are what this suite exists to hold, and every one of them is a
property a future refactor can quietly lose:

* **The prose is never parsed by code** (§3.4, module docstring). `source_text`
  is the table's own sentence, carried verbatim and never read — see
  `test_source_text_is_carried_never_read`. The moment code starts reading the
  sentence, this pipeline becomes a keyword matcher wearing a pipeline's
  clothes.
* **The answer is bound to the question** (§5.1). A result whose
  `request_sha256` does not match the request it is validated against is
  refused, so an answer to a different sentence, catalogue or ruleset can never
  be accepted as an answer to this one.
* **The target catalogue is closed** (§5.2). A patch may only name a rule or
  decision the catalogue offered. This is the whole of what stops the semantic
  step inventing a plausible-sounding rule id.
* **What the user confirms is the cases** (§5.3). All three kinds, each one
  actually stating a before and an after, and nothing is in force until
  `decide_patch(accept=True)` says so.

The bar is mutation resistance: removing a check from the module must turn at
least one test here red. Where two checks happen to gate the same case, a
discriminating case is written for each on purpose; those tests carry a comment
saying which mutation they kill.
"""
from __future__ import annotations

import ast
import copy
import importlib.util
import json
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "plugins" / "coc-keeper" / "scripts"
MODULE_PATH = SCRIPTS / "coc_house_rules.py"
STATE_PATH = SCRIPTS / "coc_state.py"
COC7_RULESET = ROOT / "plugins" / "coc-keeper" / "rulesets" / "coc7"
COC7_GRAPH = COC7_RULESET / "rule-graph.json"


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


assert MODULE_PATH.is_file(), (
    f"{MODULE_PATH} does not exist. This suite tests the real house-rule "
    "module; it must not be satisfied by a stub, a fake, or a placeholder."
)
assert COC7_GRAPH.is_file(), (
    f"{COC7_GRAPH} does not exist. The target catalogue is built from the "
    "production rule graph, never from a fixture."
)
house_rules = _load("coc_house_rules_under_test", MODULE_PATH)
coc_state = _load("coc_state_for_house_rules_test", STATE_PATH)

MODULE_SOURCE = MODULE_PATH.read_text(encoding="utf-8")
MODULE_TREE = ast.parse(MODULE_SOURCE)


# --------------------------------------------------------------------------
# Contract constants, restated rather than imported.
#
# Reading these from the module would let a change to its own tables
# re-baseline the test that is supposed to police them.
# --------------------------------------------------------------------------

EXPECTED_CONTRACT_ID = "coc.house-rule-patch.v1"
EXPECTED_SCHEMA_VERSION = 1
EXPECTED_EVALUATOR_ID = "coc-house-rule-compiler"
EXPECTED_REQUEST_KIND = "coc_house_rule_compile_request"
EXPECTED_REQUEST_FILENAME = "house-rule-compile-request.json"
EXPECTED_DOCUMENT_NAME = "house-rules.json"
EXPECTED_PROVENANCE_KIND = "house_rule_semantic_compile"

EXPECTED_LAYERS = (
    "system_safety",
    "session_ruling",
    "house_rule",
    "campaign_patch",
    "module_supplement",
    "era_supplement",
    "official_optional",
    "core",
)
EXPECTED_AUTHORABLE_LAYERS = frozenset({"house_rule", "campaign_patch"})
EXPECTED_RELATIONS = ("overrides", "augments", "disables", "enables")
EXPECTED_SCOPES = ("campaign", "session", "scene")
EXPECTED_CASE_KINDS = ("positive", "negative", "boundary")

#: Real ids, read off the production graph below rather than trusted from
#: anyone's memory. `NOT_IN_GRAPH` is deliberately plausible: it is the shape a
#: semantic step would invent if the catalogue were not closed.
LUCK_SPEND_RULE = "rule:coc7:push-luck:luck-spend"
LUCK_SPEND_DECISION = "decision:coc7:push-luck:luck-spend"
NOT_IN_GRAPH = "rule:coc7:push-luck:luck-spending"

SOURCE_TEXT = "In this campaign nobody spends Luck to change a roll."
OTHER_SOURCE_TEXT = "In this campaign reading a Mythos tome always costs a night."


def graph_nodes():
    return json.loads(COC7_GRAPH.read_text(encoding="utf-8"))["nodes"]


# --------------------------------------------------------------------------
# Builders
# --------------------------------------------------------------------------

def positive_case(**overrides):
    case = {
        "kind": "positive",
        "situation": "An investigator wants to spend 10 Luck to turn a 55 into "
                     "a 45 against a Hard 40 threshold.",
        "without_patch": "The spend is legal and the roll becomes a Hard success.",
        "with_patch": "The spend is refused and the roll stands as a failure.",
    }
    case.update(overrides)
    return case


def negative_case(**overrides):
    case = {
        "kind": "negative",
        "situation": "An investigator pushes a failed Locksmith roll.",
        "without_patch": "The push is allowed and a second roll is made.",
        "with_patch": "The push is allowed and a second roll is made.",
    }
    case.update(overrides)
    return case


def boundary_case(**overrides):
    case = {
        "kind": "boundary",
        "situation": "A Luck roll is called for to see whether the watchman "
                     "happens to be looking away.",
        "without_patch": "Luck is rolled against its current value.",
        "with_patch": "Luck is still rolled against its current value; only "
                      "spending it is banned.",
    }
    case.update(overrides)
    return case


def make_cases():
    return [positive_case(), negative_case(), boundary_case()]


def make_patch(**overrides):
    """A valid patch against a real target, overridable field by field."""
    patch = {
        "patch_id": "patch:no-luck-spending",
        "relation": "disables",
        "target": LUCK_SPEND_RULE,
        "layer": "house_rule",
        "scope": "campaign",
        "version": 1,
        "reason": "The table wants Luck to be a resource they lose, not a "
                  "difficulty dial they buy off.",
        "statement": "Luck may never be spent to alter a roll in this campaign.",
        "cases": make_cases(),
    }
    patch.update(overrides)
    return patch


def make_request(source_text=SOURCE_TEXT, campaign_id="luck-case"):
    return house_rules.build_compile_request(
        campaign_id=campaign_id,
        source_text=source_text,
        ruleset_dir=COC7_RULESET,
    )


def make_result(request, patch=None, **overrides):
    """A result the semantic step could plausibly have returned for `request`."""
    result = {
        "schema_version": EXPECTED_SCHEMA_VERSION,
        "evaluator_id": EXPECTED_EVALUATOR_ID,
        "evaluation_provenance": {
            "kind": EXPECTED_PROVENANCE_KIND,
            "request_sha256": house_rules.request_sha256(request),
            "reviewed_artifact": EXPECTED_REQUEST_FILENAME,
        },
        "patch": make_patch() if patch is None else patch,
    }
    result.update(overrides)
    return result


@pytest.fixture()
def campaign(tmp_path):
    """A bare campaign directory. `save/` is created by the first write."""
    campaign_dir = tmp_path / "luck-case"
    (campaign_dir / "save").mkdir(parents=True)
    return campaign_dir


@pytest.fixture()
def request_a():
    return make_request()


def stored(campaign_dir: Path):
    return json.loads(
        (campaign_dir / "save" / EXPECTED_DOCUMENT_NAME).read_text(encoding="utf-8")
    )


def snapshot(directory: Path, *, exclude=()):
    return {
        str(path.relative_to(directory)): path.read_bytes()
        for path in sorted(directory.rglob("*"))
        if path.is_file() and path.name not in exclude
    }


def propose(campaign_dir, request, patch=None):
    return house_rules.propose_patch(
        campaign_dir, request=request, result=make_result(request, patch)
    )


def statuses(campaign_dir):
    return {
        (row["patch"]["patch_id"], row["patch"]["version"]): row["status"]
        for row in stored(campaign_dir)["patches"]
    }


# --------------------------------------------------------------------------
# 0. The contract itself
# --------------------------------------------------------------------------

def test_contract_constants_match_the_specification():
    assert house_rules.CONTRACT_ID == EXPECTED_CONTRACT_ID
    assert house_rules.SCHEMA_VERSION == EXPECTED_SCHEMA_VERSION
    assert house_rules.EVALUATOR_ID == EXPECTED_EVALUATOR_ID
    assert house_rules.REQUEST_KIND == EXPECTED_REQUEST_KIND
    assert house_rules.REQUEST_FILENAME == EXPECTED_REQUEST_FILENAME
    assert house_rules.DOCUMENT_NAME == EXPECTED_DOCUMENT_NAME
    assert house_rules.PROVENANCE_KIND == EXPECTED_PROVENANCE_KIND
    assert tuple(house_rules.RELATIONS) == EXPECTED_RELATIONS
    assert tuple(house_rules.SCOPES) == EXPECTED_SCOPES
    assert tuple(house_rules.CASE_KINDS) == EXPECTED_CASE_KINDS


def test_the_layer_ladder_matches_the_specification():
    """Pinned in order, because ordering in §3.2 is read off this ladder."""
    assert tuple(house_rules.LAYERS) == EXPECTED_LAYERS


def test_only_two_layers_are_authorable_from_a_table_sentence():
    """Widening this must be a visible edit, never a side effect.

    `core` and `system_safety` are not negotiable from prose, and
    `session_ruling` belongs to the ruling path with its own expiry arithmetic.
    """
    assert frozenset(house_rules.AUTHORABLE_LAYERS) == EXPECTED_AUTHORABLE_LAYERS
    assert EXPECTED_AUTHORABLE_LAYERS <= set(EXPECTED_LAYERS)


def test_new_document_is_an_empty_patch_document():
    assert house_rules.new_document("luck-case") == {
        "contract_id": EXPECTED_CONTRACT_ID,
        "schema_version": EXPECTED_SCHEMA_VERSION,
        "campaign_id": "luck-case",
        "patches": [],
    }


# --------------------------------------------------------------------------
# 1. Request construction
# --------------------------------------------------------------------------

def test_the_catalogue_is_the_production_graph_and_offers_a_real_target():
    catalogue = house_rules.target_catalogue(COC7_RULESET)
    ids = {row["target_id"] for row in catalogue}

    assert LUCK_SPEND_RULE in ids, (
        "a target read straight off the production rule graph is missing from "
        "the catalogue; the catalogue is what a patch may name"
    )
    assert LUCK_SPEND_DECISION in ids
    assert NOT_IN_GRAPH not in ids, (
        "the plausible-but-invented id this suite uses as a negative case has "
        "become real; pick another one"
    )

    expected = {
        node["node_id"] for node in graph_nodes()
        if node.get("node_kind") in {"rule", "decision"}
    }
    assert ids == expected


def test_the_catalogue_carries_only_rules_and_decisions():
    """§5.2: a patch targets an existing rule or decision, nothing else.

    Input slots, effects and conditions are graph plumbing. A patch pointed at
    one of those would declare an override of something that is not a rule.
    """
    catalogue = house_rules.target_catalogue(COC7_RULESET)
    assert catalogue, "the coc7 rule graph offered no patchable target"
    assert {row["target_kind"] for row in catalogue} == {"rule", "decision"}

    other_kinds = {
        node["node_id"] for node in graph_nodes()
        if node.get("node_kind") not in {"rule", "decision"}
    }
    assert other_kinds, "the graph carries no non-rule nodes; this test is vacuous"
    assert not other_kinds & {row["target_id"] for row in catalogue}


def test_the_request_carries_the_closed_choice_the_semantic_step_gets(request_a):
    assert request_a["kind"] == EXPECTED_REQUEST_KIND
    assert request_a["contract_id"] == EXPECTED_CONTRACT_ID
    assert request_a["schema_version"] == EXPECTED_SCHEMA_VERSION
    assert request_a["source_text"] == SOURCE_TEXT
    assert tuple(request_a["legal_relations"]) == EXPECTED_RELATIONS
    assert set(request_a["legal_layers"]) == EXPECTED_AUTHORABLE_LAYERS
    assert tuple(request_a["legal_scopes"]) == EXPECTED_SCOPES
    assert tuple(request_a["required_case_kinds"]) == EXPECTED_CASE_KINDS


@pytest.mark.parametrize("bad", ["", "   ", "\n\t ", None, 7, ["a sentence"]])
def test_reject_a_request_with_no_sentence_in_it(bad):
    """A compile request with no prose is a question about nothing."""
    with pytest.raises(house_rules.HouseRuleError) as excinfo:
        house_rules.build_compile_request(
            campaign_id="luck-case", source_text=bad, ruleset_dir=COC7_RULESET
        )
    assert "source_text" in str(excinfo.value)


def test_the_request_is_deterministic(request_a):
    """Same sentence, same graph, same digest — twice.

    If the request were not byte-stable, the digest binding below would be
    noise: every re-derivation would refuse a result that is in fact correct.
    """
    again = make_request()
    assert again == request_a
    assert house_rules.request_sha256(again) == house_rules.request_sha256(request_a)


def test_a_different_sentence_is_a_different_request(request_a):
    other = make_request(source_text=OTHER_SOURCE_TEXT)
    assert house_rules.request_sha256(other) != house_rules.request_sha256(request_a)


def test_writing_the_request_round_trips_under_its_own_filename(tmp_path, request_a):
    path = house_rules.write_compile_request(tmp_path, request_a)
    assert path.name == EXPECTED_REQUEST_FILENAME
    assert json.loads(path.read_text(encoding="utf-8")) == request_a


def test_an_unreadable_ruleset_graph_raises_the_typed_error(tmp_path):
    with pytest.raises(house_rules.HouseRuleError):
        house_rules.target_catalogue(tmp_path)


# --------------------------------------------------------------------------
# 2. Digest binding — the seam that makes this trustworthy
# --------------------------------------------------------------------------

def test_a_result_compiled_against_another_request_is_refused(campaign, request_a):
    """The seam. Without it, an answer to a different question is accepted here.

    Request B asks about Mythos tomes. The result was compiled against request
    A, which asked about Luck. Both are internally valid; only the digest can
    tell that the answer does not belong to the question.

    Kills the mutation that drops the `request_sha256` comparison.
    """
    request_b = make_request(source_text=OTHER_SOURCE_TEXT)
    result_for_a = make_result(request_a)

    # Non-vacuous: against its own request the very same result is clean.
    assert house_rules.validate_compile_result(request_a, result_for_a) == []

    errors = house_rules.validate_compile_result(request_b, result_for_a)
    assert "evaluation_provenance.request_sha256 mismatch" in errors

    with pytest.raises(house_rules.HouseRuleError) as excinfo:
        house_rules.propose_patch(
            campaign, request=request_b, result=result_for_a
        )
    assert "request_sha256" in str(excinfo.value)
    assert not (campaign / "save" / EXPECTED_DOCUMENT_NAME).exists()


@pytest.mark.parametrize("digest", [
    None,
    "",
    "not-a-digest",
    "0" * 64,
])
def test_reject_a_result_whose_digest_is_absent_or_invented(request_a, digest):
    result = make_result(request_a)
    result["evaluation_provenance"]["request_sha256"] = digest
    errors = house_rules.validate_compile_result(request_a, result)
    assert "evaluation_provenance.request_sha256 mismatch" in errors


def test_reject_a_result_that_names_the_wrong_evaluator_or_artifact(request_a):
    """Provenance is the whole claim that this came from the declared step."""
    wrong_evaluator = make_result(request_a, evaluator_id="some-other-model")
    assert any("evaluator_id" in error
               for error in house_rules.validate_compile_result(
                   request_a, wrong_evaluator))

    wrong_kind = make_result(request_a)
    wrong_kind["evaluation_provenance"]["kind"] = "freeform_chat"
    assert any("evaluation_provenance.kind" in error
               for error in house_rules.validate_compile_result(
                   request_a, wrong_kind))

    wrong_artifact = make_result(request_a)
    wrong_artifact["evaluation_provenance"]["reviewed_artifact"] = "notes.txt"
    assert any("reviewed_artifact" in error
               for error in house_rules.validate_compile_result(
                   request_a, wrong_artifact))


@pytest.mark.parametrize("field", [
    "schema_version", "evaluator_id", "evaluation_provenance", "patch",
])
def test_reject_a_result_missing_a_declared_field(request_a, field):
    result = make_result(request_a)
    del result[field]
    errors = house_rules.validate_compile_result(request_a, result)
    assert any(field in error for error in errors)


def test_reject_a_result_carrying_an_undeclared_field(request_a):
    result = make_result(request_a, confidence=0.97)
    errors = house_rules.validate_compile_result(request_a, result)
    assert any("confidence" in error for error in errors)


# --------------------------------------------------------------------------
# 3. The closed target catalogue
# --------------------------------------------------------------------------

def test_a_plausible_target_that_is_not_in_the_catalogue_is_refused(
    campaign, request_a
):
    """This is the whole of what stops the semantic step inventing a rule id.

    `rule:coc7:push-luck:luck-spending` has the right prefix, the right family
    and a name a reader would nod at. It is not in the graph, so it is refused.

    Kills the mutation that drops the catalogue membership check.
    """
    result = make_result(request_a, patch=make_patch(target=NOT_IN_GRAPH))
    errors = house_rules.validate_compile_result(request_a, result)
    assert any("names nothing in the rule graph" in error for error in errors)

    with pytest.raises(house_rules.HouseRuleError) as excinfo:
        house_rules.propose_patch(campaign, request=request_a, result=result)
    assert NOT_IN_GRAPH in str(excinfo.value)
    assert not (campaign / "save" / EXPECTED_DOCUMENT_NAME).exists()


def test_the_catalogue_comes_from_the_request_not_from_the_result(request_a):
    """A result cannot widen its own catalogue by carrying a bigger one.

    `known_target_ids` is derived from the request the result is bound to, so
    the closed set is the one the semantic step was actually handed.
    """
    result = make_result(request_a, patch=make_patch(target=NOT_IN_GRAPH))
    result["patch"]["cases"] = make_cases()
    errors = house_rules.validate_compile_result(request_a, result)
    assert any(NOT_IN_GRAPH in error for error in errors)


def test_every_real_target_in_the_catalogue_is_patchable(request_a):
    """Sampled across the graph, so the catalogue is not merely well-formed —
    a patch can actually bind to something the Keeper will reach."""
    catalogue = house_rules.target_catalogue(COC7_RULESET)
    sample = catalogue[:5] + catalogue[-5:]
    for row in sample:
        result = make_result(request_a, patch=make_patch(target=row["target_id"]))
        assert house_rules.validate_compile_result(request_a, result) == []


@pytest.mark.parametrize("bad_target", [None, "", "   ", 17])
def test_reject_a_patch_with_no_target_at_all(bad_target):
    errors = house_rules.validate_patch(make_patch(target=bad_target))
    assert any("patch.target" in error for error in errors)


@pytest.mark.parametrize("bad_id", [
    "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
    "patch:9F86D081884C7D659A2FEAA0C55AD015",
    "patch:No-Luck-Spending",
    "no-luck-spending",
    "patch:",
    "patch:noluckspending",
    "patch:no luck spending",
    "patch:no_luck_spending",
])
def test_reject_a_patch_id_that_is_not_a_semantic_id(bad_id):
    """The Model-Facing Identifier Law: a patch id is read and echoed by a
    model, so a digest shape is mis-transcribed and must not be accepted."""
    errors = house_rules.validate_patch(make_patch(patch_id=bad_id))
    assert any("patch_id" in error for error in errors)


@pytest.mark.parametrize("relation", EXPECTED_RELATIONS)
def test_every_declared_relation_is_accepted(relation):
    """§3.2: the declared relation decides what happens, so all four must land."""
    assert house_rules.validate_patch(
        make_patch(relation=relation),
        known_target_ids=frozenset({LUCK_SPEND_RULE}),
    ) == []


@pytest.mark.parametrize("bad", ["supersedes", "wins", "", None, "OVERRIDES"])
def test_reject_an_undeclared_relation(bad):
    errors = house_rules.validate_patch(make_patch(relation=bad))
    assert any("patch.relation" in error for error in errors)


@pytest.mark.parametrize("bad", ["table", "turn", "", None])
def test_reject_a_scope_outside_the_ladder(bad):
    errors = house_rules.validate_patch(make_patch(scope=bad))
    assert any("patch.scope" in error for error in errors)


@pytest.mark.parametrize("bad_version", [0, -1, "1", 1.0, True, None])
def test_reject_a_version_that_is_not_a_positive_integer(bad_version):
    """`True` is an int in Python; accepting it would store a flag as a version."""
    errors = house_rules.validate_patch(make_patch(version=bad_version))
    assert any("patch.version" in error for error in errors)


@pytest.mark.parametrize("field", ["reason", "statement"])
@pytest.mark.parametrize("value", ["", "   ", None, 7])
def test_reject_a_patch_with_empty_prose(field, value):
    """Prose is never matched, but it must be there — §5.2 requires a reason,
    and a patch nobody can read is a patch nobody can review."""
    errors = house_rules.validate_patch(make_patch(**{field: value}))
    assert any(f"patch.{field}" in error for error in errors)


def test_reject_a_patch_carrying_an_undeclared_field():
    errors = house_rules.validate_patch(make_patch(priority=99))
    assert any("priority" in error for error in errors)


@pytest.mark.parametrize("field", sorted({
    "patch_id", "relation", "target", "layer", "scope", "version",
    "reason", "statement", "cases",
}))
def test_reject_a_patch_missing_a_declared_field(field):
    patch = make_patch()
    del patch[field]
    errors = house_rules.validate_patch(patch)
    assert any(field in error for error in errors)


@pytest.mark.parametrize("not_a_patch", [None, [], "patch:no-luck-spending", 7])
def test_reject_a_patch_that_is_not_an_object(not_a_patch):
    assert house_rules.validate_patch(not_a_patch)


# --------------------------------------------------------------------------
# 4. Cases are what the user confirms (§5.3)
# --------------------------------------------------------------------------

@pytest.mark.parametrize("dropped", EXPECTED_CASE_KINDS)
def test_all_three_case_kinds_are_required(dropped):
    """§5.3: positive, negative and boundary, each of them.

    Drop any one and the patch is refused. A patch whose behaviour cannot be
    stated all three ways has not been understood well enough to admit.

    Kills the mutation that lets `validate_cases` accept a missing kind.
    """
    cases = [case for case in make_cases() if case["kind"] != dropped]
    errors = house_rules.validate_cases(cases)
    assert f"patch.cases must include a {dropped} case" in errors

    patch_errors = house_rules.validate_patch(make_patch(cases=cases))
    assert any(dropped in error for error in patch_errors)


def test_all_three_case_kinds_together_are_accepted():
    """Non-vacuous counterpart: the full set passes, so the tests above are
    failing on the missing kind and not on the builder."""
    assert house_rules.validate_cases(make_cases()) == []


@pytest.mark.parametrize("cases", [[], None, {}, "positive", 0])
def test_reject_an_empty_or_absent_case_set(cases):
    """§5.3: a patch MUST be refused rather than admitted with empty `cases`."""
    assert house_rules.validate_cases(cases) == [
        "patch.cases must be a non-empty array"
    ]
    assert any("cases" in error
               for error in house_rules.validate_patch(make_patch(cases=cases)))


def test_a_positive_case_that_changes_nothing_is_refused():
    """A positive case states a situation the patch changes. If the before and
    the after read the same, the user is confirming a change nobody has shown
    them, and the case can never run as a regression test."""
    unchanged = positive_case(
        without_patch="The spend is legal and the roll becomes a Hard success.",
        with_patch="The spend is legal and the roll becomes a Hard success.",
    )
    errors = house_rules.validate_cases([unchanged, negative_case(), boundary_case()])
    assert any("is positive but states the same outcome" in error
               for error in errors)


def test_a_negative_case_that_changes_something_is_refused():
    """A negative case is the reader's expectation being corrected: a situation
    they think the patch touches and it does not. If its outcomes differ, it is
    a second positive case mislabelled, and the scope claim it was supposed to
    make is unmade."""
    changed = negative_case(
        with_patch="The push is refused because pushing is a Luck spend."
    )
    errors = house_rules.validate_cases([positive_case(), changed, boundary_case()])
    assert any("is negative but states a different outcome" in error
               for error in errors)


def test_whitespace_alone_does_not_make_a_positive_case_change():
    """Kills the mutation that compares the raw strings without stripping."""
    cosmetic = positive_case(
        without_patch="The spend is legal.",
        with_patch="  The spend is legal.  ",
    )
    errors = house_rules.validate_cases([cosmetic, negative_case(), boundary_case()])
    assert any("is positive but states the same outcome" in error
               for error in errors)


@pytest.mark.parametrize("bad_kind", ["edge", "", None, "Positive", "regression"])
def test_reject_a_case_of_an_unknown_kind(bad_kind):
    errors = house_rules.validate_cases([positive_case(kind=bad_kind)])
    assert any("kind must be one of" in error for error in errors)


@pytest.mark.parametrize("field", ["kind", "situation", "without_patch", "with_patch"])
def test_reject_a_case_missing_a_declared_field(field):
    case = positive_case()
    del case[field]
    errors = house_rules.validate_cases([case, negative_case(), boundary_case()])
    assert any(field in error for error in errors)


def test_reject_a_case_carrying_an_undeclared_field():
    errors = house_rules.validate_cases(
        [positive_case(expected="pass"), negative_case(), boundary_case()]
    )
    assert any("expected" in error for error in errors)


@pytest.mark.parametrize("field", ["situation", "without_patch", "with_patch"])
@pytest.mark.parametrize("value", ["", "   ", None, 7])
def test_reject_a_case_with_an_empty_narrative_field(field, value):
    errors = house_rules.validate_cases(
        [positive_case(**{field: value}), negative_case(), boundary_case()]
    )
    assert any(field in error for error in errors)


@pytest.mark.parametrize("not_a_case", [None, "positive", 7, ["positive"]])
def test_reject_a_case_that_is_not_an_object(not_a_case):
    assert house_rules.validate_cases([not_a_case])


def test_extra_cases_beyond_the_three_are_allowed():
    """The floor is one of each kind, not a cap: a table may show more."""
    cases = make_cases() + [positive_case(
        situation="An investigator wants to spend Luck on a combat roll.",
        without_patch="The spend is legal.",
        with_patch="The spend is refused.",
    )]
    assert house_rules.validate_cases(cases) == []


# --------------------------------------------------------------------------
# 5. Layer authorability
# --------------------------------------------------------------------------

@pytest.mark.parametrize("layer", EXPECTED_LAYERS)
def test_only_authorable_layers_may_be_written_from_a_table_sentence(layer):
    """Parametrized over the whole ladder, so a layer added later cannot
    silently become authorable: it arrives here refused until someone edits
    `AUTHORABLE_LAYERS` and this suite's pinned copy of it on purpose."""
    errors = house_rules.validate_patch(
        make_patch(layer=layer), known_target_ids=frozenset({LUCK_SPEND_RULE})
    )
    if layer in EXPECTED_AUTHORABLE_LAYERS:
        assert errors == [], f"{layer!r} is authorable but was refused: {errors}"
        return
    message = " ".join(errors)
    assert "may not be authored from a house rule" in message
    assert layer in message
    # The refusal names what IS allowed, so the table is told what to do next.
    for allowed in sorted(EXPECTED_AUTHORABLE_LAYERS):
        assert allowed in message


@pytest.mark.parametrize("bad_layer", ["", None, "table_ruling", "HOUSE_RULE", 3])
def test_reject_a_layer_that_is_not_on_the_ladder_at_all(bad_layer):
    errors = house_rules.validate_patch(make_patch(layer=bad_layer))
    assert any("not a known layer" in error for error in errors)


def test_an_unauthorable_layer_is_refused_on_the_real_propose_path(
    campaign, request_a
):
    """The check must hold where it matters, not only in the pure validator."""
    result = make_result(request_a, patch=make_patch(layer="core"))
    with pytest.raises(house_rules.HouseRuleError) as excinfo:
        house_rules.propose_patch(campaign, request=request_a, result=result)
    assert "may not be authored" in str(excinfo.value)
    assert not (campaign / "save" / EXPECTED_DOCUMENT_NAME).exists()


# --------------------------------------------------------------------------
# 6. The confirmation gate
# --------------------------------------------------------------------------

def test_a_proposed_patch_is_recorded_but_never_in_force(campaign, request_a):
    """§3.4: the user confirms before it takes effect.

    Kills the mutation that lets `confirmed_patches` return proposed rows.
    """
    outcome = propose(campaign, request_a)
    assert outcome["recorded"] is True
    assert outcome["record"]["status"] == "proposed"
    assert outcome["record"]["decided_reason"] is None
    assert outcome["record"]["request_sha256"] == house_rules.request_sha256(request_a)
    assert outcome["record"]["source_text"] == SOURCE_TEXT

    assert stored(campaign)["patches"][0]["status"] == "proposed"
    assert house_rules.confirmed_patches(campaign) == []
    assert house_rules.confirmed_patches(campaign, target=LUCK_SPEND_RULE) == []


def test_only_an_accepted_patch_reaches_confirmed_patches(campaign, request_a):
    propose(campaign, request_a)
    assert house_rules.confirmed_patches(campaign) == []

    decision = house_rules.decide_patch(
        campaign,
        patch_id="patch:no-luck-spending",
        version=1,
        accept=True,
        decided_reason="The table voted yes after reading the three cases.",
    )
    assert decision["status"] == "confirmed"

    confirmed = house_rules.confirmed_patches(campaign)
    assert [row["patch"]["patch_id"] for row in confirmed] == [
        "patch:no-luck-spending"
    ]
    assert confirmed[0]["decided_reason"] == (
        "The table voted yes after reading the three cases."
    )


def test_a_rejected_patch_is_kept_on_disk_and_never_surfaced(campaign, request_a):
    """A table that said no to a house rule said something.

    Deleting the record would lose that, and the same sentence could be
    re-proposed next month with nobody able to say it had already been refused.
    """
    propose(campaign, request_a)
    decision = house_rules.decide_patch(
        campaign,
        patch_id="patch:no-luck-spending",
        version=1,
        accept=False,
        decided_reason="Two players want to keep Luck spending for combat.",
    )
    assert decision["status"] == "rejected"
    assert house_rules.confirmed_patches(campaign) == []

    rows = stored(campaign)["patches"]
    assert len(rows) == 1, "the rejected patch was deleted instead of kept"
    assert rows[0]["status"] == "rejected"
    assert rows[0]["decided_reason"] == (
        "Two players want to keep Luck spending for combat."
    )
    assert rows[0]["patch"] == make_patch()


@pytest.mark.parametrize("accept", [True, False])
def test_deciding_the_same_patch_twice_is_refused(campaign, request_a, accept):
    """A decision is a record of what the table did, not a toggle."""
    propose(campaign, request_a)
    house_rules.decide_patch(
        campaign, patch_id="patch:no-luck-spending", version=1,
        accept=accept, decided_reason="First and only call.",
    )
    before = (campaign / "save" / EXPECTED_DOCUMENT_NAME).read_bytes()

    with pytest.raises(house_rules.HouseRuleError) as excinfo:
        house_rules.decide_patch(
            campaign, patch_id="patch:no-luck-spending", version=1,
            accept=not accept, decided_reason="Second thoughts.",
        )
    assert "not proposed" in str(excinfo.value)
    assert (campaign / "save" / EXPECTED_DOCUMENT_NAME).read_bytes() == before


def test_deciding_a_patch_that_does_not_exist_is_refused(campaign, request_a):
    propose(campaign, request_a)

    with pytest.raises(house_rules.HouseRuleError) as excinfo:
        house_rules.decide_patch(
            campaign, patch_id="patch:never-proposed", version=1,
            accept=True, decided_reason="Confirming thin air.",
        )
    assert "no proposed patch" in str(excinfo.value)

    with pytest.raises(house_rules.HouseRuleError):
        house_rules.decide_patch(
            campaign, patch_id="patch:no-luck-spending", version=2,
            accept=True, decided_reason="Confirming a version nobody wrote.",
        )
    assert house_rules.confirmed_patches(campaign) == []


@pytest.mark.parametrize("reason", ["", "   ", None, 7])
def test_a_decision_without_a_reason_is_refused(campaign, request_a, reason):
    """Why the table said yes is the only thing a later reader has."""
    propose(campaign, request_a)
    with pytest.raises(house_rules.HouseRuleError) as excinfo:
        house_rules.decide_patch(
            campaign, patch_id="patch:no-luck-spending", version=1,
            accept=True, decided_reason=reason,
        )
    assert "decided_reason" in str(excinfo.value)
    assert stored(campaign)["patches"][0]["status"] == "proposed"


def test_confirmed_patches_filters_by_target(campaign, request_a):
    other_target = "rule:coc7:push-luck:one-reroll"
    propose(campaign, request_a)
    propose(campaign, request_a, make_patch(
        patch_id="patch:one-push-per-scene", target=other_target
    ))
    for patch_id in ("patch:no-luck-spending", "patch:one-push-per-scene"):
        house_rules.decide_patch(
            campaign, patch_id=patch_id, version=1, accept=True,
            decided_reason="Confirmed at the table.",
        )

    assert [row["patch"]["patch_id"] for row in
            house_rules.confirmed_patches(campaign, target=LUCK_SPEND_RULE)] == [
        "patch:no-luck-spending"
    ]
    assert [row["patch"]["patch_id"] for row in
            house_rules.confirmed_patches(campaign, target=other_target)] == [
        "patch:one-push-per-scene"
    ]
    assert house_rules.confirmed_patches(campaign, target=NOT_IN_GRAPH) == []
    assert len(house_rules.confirmed_patches(campaign)) == 2


def test_confirmed_patches_on_an_absent_document_is_empty_not_an_error(campaign):
    assert house_rules.confirmed_patches(campaign) == []
    assert not (campaign / "save" / EXPECTED_DOCUMENT_NAME).exists()


# --------------------------------------------------------------------------
# 7. Versioning
# --------------------------------------------------------------------------

def test_rewriting_a_version_in_place_is_refused_and_the_original_stands(
    campaign, request_a
):
    """A patch version is what the table was shown when it decided.

    Kills the mutation that lets `propose_patch` overwrite a same-version row.
    """
    propose(campaign, request_a)
    before = (campaign / "save" / EXPECTED_DOCUMENT_NAME).read_bytes()

    rewritten = make_patch(
        relation="overrides",
        statement="Luck may be spent, but only once per session.",
        reason="Softened after an argument.",
    )
    with pytest.raises(house_rules.HouseRuleError) as excinfo:
        propose(campaign, request_a, rewritten)
    message = str(excinfo.value)
    assert "already exists" in message and "raise the version" in message

    assert (campaign / "save" / EXPECTED_DOCUMENT_NAME).read_bytes() == before
    rows = stored(campaign)["patches"]
    assert len(rows) == 1
    assert rows[0]["patch"] == make_patch()


def test_a_byte_equal_re_propose_is_an_idempotent_replay(campaign, request_a):
    propose(campaign, request_a)
    before = (campaign / "save" / EXPECTED_DOCUMENT_NAME).read_bytes()

    replay = propose(campaign, request_a)
    assert replay["recorded"] is False
    assert replay["reason"] == "replay"
    assert (campaign / "save" / EXPECTED_DOCUMENT_NAME).read_bytes() == before
    assert len(stored(campaign)["patches"]) == 1


def test_confirming_version_two_supersedes_the_confirmed_version_one(
    campaign, request_a
):
    """Only one version of a patch is ever in force.

    Kills the mutation that drops the supersession sweep in `decide_patch`:
    without it both versions come back confirmed and a reader gets two
    contradictory statements of the same house rule with nothing to separate
    them.
    """
    propose(campaign, request_a)
    house_rules.decide_patch(
        campaign, patch_id="patch:no-luck-spending", version=1,
        accept=True, decided_reason="Adopted for the first arc.",
    )
    assert [row["patch"]["version"] for row in
            house_rules.confirmed_patches(campaign)] == [1]

    propose(campaign, request_a, make_patch(
        version=2,
        statement="Luck may never be spent to alter a roll, including pushes.",
        reason="The first version left pushes ambiguous.",
    ))
    # Proposing v2 does not yet unseat v1.
    assert [row["patch"]["version"] for row in
            house_rules.confirmed_patches(campaign)] == [1]

    house_rules.decide_patch(
        campaign, patch_id="patch:no-luck-spending", version=2,
        accept=True, decided_reason="Adopted the clarified wording.",
    )

    confirmed = house_rules.confirmed_patches(campaign)
    assert [row["patch"]["version"] for row in confirmed] == [2]
    assert statuses(campaign) == {
        ("patch:no-luck-spending", 1): "superseded",
        ("patch:no-luck-spending", 2): "confirmed",
    }
    # Superseded, not deleted: the earlier wording is still on disk.
    assert len(stored(campaign)["patches"]) == 2


def test_a_rejected_version_two_leaves_version_one_standing(campaign, request_a):
    """Supersession follows acceptance, never merely a later proposal."""
    propose(campaign, request_a)
    house_rules.decide_patch(
        campaign, patch_id="patch:no-luck-spending", version=1,
        accept=True, decided_reason="Adopted.",
    )
    propose(campaign, request_a, make_patch(version=2, reason="A stricter draft."))
    house_rules.decide_patch(
        campaign, patch_id="patch:no-luck-spending", version=2,
        accept=False, decided_reason="Too strict; keep what we have.",
    )

    assert [row["patch"]["version"] for row in
            house_rules.confirmed_patches(campaign)] == [1]
    assert statuses(campaign) == {
        ("patch:no-luck-spending", 1): "confirmed",
        ("patch:no-luck-spending", 2): "rejected",
    }


def test_supersession_never_reaches_a_different_patch_id(campaign, request_a):
    """Kills the mutation that sweeps by version alone and forgets the id."""
    propose(campaign, request_a)
    propose(campaign, request_a, make_patch(
        patch_id="patch:one-push-per-scene", target="rule:coc7:push-luck:one-reroll"
    ))
    for patch_id in ("patch:no-luck-spending", "patch:one-push-per-scene"):
        house_rules.decide_patch(
            campaign, patch_id=patch_id, version=1, accept=True,
            decided_reason="Both adopted.",
        )

    propose(campaign, request_a, make_patch(version=2, reason="A revision."))
    house_rules.decide_patch(
        campaign, patch_id="patch:no-luck-spending", version=2,
        accept=True, decided_reason="Revision adopted.",
    )

    assert statuses(campaign) == {
        ("patch:no-luck-spending", 1): "superseded",
        ("patch:no-luck-spending", 2): "confirmed",
        ("patch:one-push-per-scene", 1): "confirmed",
    }


# --------------------------------------------------------------------------
# 8. Ordering is not resolution (§3.2)
# --------------------------------------------------------------------------

def test_confirmed_patches_orders_the_more_specific_layer_first(campaign, request_a):
    """`house_rule` sits above `campaign_patch` on the ladder, so it reads first."""
    propose(campaign, request_a, make_patch(
        patch_id="patch:campaign-luck-cap", layer="campaign_patch"
    ))
    propose(campaign, request_a, make_patch(
        patch_id="patch:house-no-luck-spending", layer="house_rule"
    ))
    for patch_id in ("patch:campaign-luck-cap", "patch:house-no-luck-spending"):
        house_rules.decide_patch(
            campaign, patch_id=patch_id, version=1, accept=True,
            decided_reason="Both declared and both confirmed.",
        )

    order = [(row["patch"]["layer"], row["patch"]["patch_id"])
             for row in house_rules.confirmed_patches(campaign, target=LUCK_SPEND_RULE)]
    assert order == [
        ("house_rule", "patch:house-no-luck-spending"),
        ("campaign_patch", "patch:campaign-luck-cap"),
    ]
    # Storage order is alphabetical by id, so the layer ladder is doing the work
    # and not the order the rows happen to sit in on disk.
    assert [row["patch"]["patch_id"] for row in stored(campaign)["patches"]] == [
        "patch:campaign-luck-cap", "patch:house-no-luck-spending",
    ]
    # Deterministic across calls.
    assert order == [(row["patch"]["layer"], row["patch"]["patch_id"])
                     for row in house_rules.confirmed_patches(
                         campaign, target=LUCK_SPEND_RULE)]


def test_ordering_is_presentation_only_and_is_never_conflict_resolution(
    campaign, request_a
):
    """§3.2: a conflict between two declared patches is the compiler's to raise.

    READ THIS BEFORE CONSUMING `confirmed_patches`. The list is ordered so a
    reader meets the most specific declaration first. That is presentation. It
    is NOT a resolution order, and taking the first row as "the winner" is the
    exact mistake §3.2 forbids: "Priority MUST NOT be implemented as 'larger
    number wins' alone. The declared relation decides what happens; the layer
    decides only ordering among declared patches."

    Two patches here disagree outright — one `disables` the target, the other
    `augments` it — and `confirmed_patches` still returns both, in layer order,
    with no verdict attached. Nothing in this module drops a row, flags a
    winner, or raises: detecting that these two cannot both hold is `RuleConflict`
    at graph build time (§6, slice R2), where the error can name both patches,
    their layers and their relations.

    A future change that made this function return one row, or sort by a
    "priority" number, or filter by relation, would move a decision out of the
    compiler and into a list comprehension, and the table would never see the
    conflict. That change must break this test.
    """
    propose(campaign, request_a, make_patch(
        patch_id="patch:house-no-luck-spending",
        layer="house_rule",
        relation="disables",
        statement="Luck may never be spent to alter a roll.",
    ))
    propose(campaign, request_a, make_patch(
        patch_id="patch:campaign-luck-bonus",
        layer="campaign_patch",
        relation="augments",
        statement="Luck spending is doubled in value during the finale.",
    ))
    for patch_id in ("patch:house-no-luck-spending", "patch:campaign-luck-bonus"):
        house_rules.decide_patch(
            campaign, patch_id=patch_id, version=1, accept=True,
            decided_reason="Both were confirmed; nobody noticed they disagree.",
        )

    rows = house_rules.confirmed_patches(campaign, target=LUCK_SPEND_RULE)

    assert len(rows) == 2, (
        "confirmed_patches dropped a declared patch. Ordering is presentation; "
        "a disagreement between declared patches is RuleConflict's to raise at "
        "graph build (spec §3.2, §6), never something this list resolves by "
        "returning fewer rows."
    )
    assert {row["patch"]["relation"] for row in rows} == {"disables", "augments"}
    assert [row["patch"]["patch_id"] for row in rows] == [
        "patch:house-no-luck-spending", "patch:campaign-luck-bonus",
    ]
    # No row carries a verdict: nothing here says which one wins.
    for row in rows:
        assert set(row) == {
            "patch", "status", "request_sha256", "source_text", "decided_reason",
        }, (
            "a confirmed row grew a field beyond the record contract; if that "
            "field is a winner, a resolution decision has moved out of the "
            "compiler and into this list"
        )


# --------------------------------------------------------------------------
# 9. Prose isolation — §3.4 and the module docstring
# --------------------------------------------------------------------------

#: The table's own sentence. Carried into the request and the record, and read
#: by nothing in this module.
PROSE_FIELDS = ("source_text",)

#: Reading prose through any of these is matching, not carrying.
BANNED_CALLS = frozenset({
    "startswith", "endswith", "lower", "upper", "casefold", "title",
    "find", "rfind", "index", "count", "split", "rsplit", "partition",
    "replace", "translate", "encode", "format",
    "match", "fullmatch", "search", "findall", "finditer", "sub", "subn",
    "compile", "escape",
})

#: Modules whose whole purpose is matching text. `re` is imported for the patch
#: id grammar and is policed separately below.
BANNED_IMPORTS = frozenset({
    "regex", "fnmatch", "difflib", "sre_compile", "sre_parse", "unicodedata",
})

PROSE_LAW = (
    "PROSE ISOLATION (spec §3.4, module docstring).\n"
    "`source_text` is the table's own sentence. It is carried verbatim into "
    "the request and into the stored record so a person can read what was "
    "asked for. It is never compared, lowercased, split, scanned, or handed "
    "to a regex.\n"
    "Deciding what a sentence means is the semantic step's job: deterministic "
    "code prepares the request, an external step answers it bound to the "
    "request digest, and deterministic code validates the answer. The moment "
    "this module starts reading the sentence, that whole structure is "
    "decoration -- the pipeline becomes a keyword matcher wearing a "
    "pipeline's clothes, and it silently inherits every failure a keyword "
    "matcher has: it works on the phrasings someone thought of, quietly "
    "mis-compiles the ones they did not, and nothing in the request digest, "
    "the closed catalogue, or the confirmed cases can tell the difference.\n"
    "If you need a new distinction, add a declared field to the request and "
    "validate it. Do not read the sentence."
)


def _parent_map(tree):
    parents = {}
    for node in ast.walk(tree):
        for child in ast.iter_child_nodes(node):
            parents[child] = node
    return parents


def _ancestors(node, parents):
    while node in parents:
        node = parents[node]
        yield node


def _offence(node):
    if isinstance(node, ast.Compare):
        ops = "".join(type(op).__name__ for op in node.ops)
        return f"compared ({ops})"
    if isinstance(node, (ast.BoolOp, ast.IfExp)):
        return None
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute):
        if node.func.attr in BANNED_CALLS:
            return f"passed to .{node.func.attr}()"
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
        if node.func.id in BANNED_CALLS:
            return f"passed to {node.func.id}()"
    return None


def _mentions_prose(node):
    return any(
        isinstance(child, ast.Constant) and child.value in PROSE_FIELDS
        for child in ast.walk(node)
    )


def test_source_text_is_carried_never_read():
    """The table's sentence reaches the record untouched by any matcher.

    Kills the mutation that adds `if "luck" in request["source_text"]` -- or
    `.lower()`, `.split()`, `re.search(...)`, or a comparison -- anywhere in
    this module.
    """
    parents = _parent_map(MODULE_TREE)
    findings = []

    def check(node, what):
        for ancestor in _ancestors(node, parents):
            if isinstance(ancestor, ast.stmt) and not isinstance(
                ancestor, (ast.Return, ast.Assert, ast.If, ast.While, ast.Raise)
            ):
                break
            offence = _offence(ancestor)
            if offence:
                findings.append(
                    f"line {getattr(node, 'lineno', '?')}: {what} is {offence}"
                    f" -- {ast.get_source_segment(MODULE_SOURCE, ancestor)!r}"
                )
                break

    # Direct reads: request["source_text"], record.get("source_text"),
    # "source_text" in text.
    for node in ast.walk(MODULE_TREE):
        if isinstance(node, ast.Constant) and node.value in PROSE_FIELDS:
            check(node, f"the {node.value!r} field")

    # One hop of taint: `sentence = request["source_text"]` then
    # `sentence.lower()`.
    tainted = set()
    for node in ast.walk(MODULE_TREE):
        if isinstance(node, ast.Assign) and _mentions_prose(node.value):
            for target in node.targets:
                if isinstance(target, ast.Name):
                    tainted.add(target.id)
        if isinstance(node, ast.AnnAssign) and node.value is not None:
            if _mentions_prose(node.value) and isinstance(node.target, ast.Name):
                tainted.add(node.target.id)
    for node in ast.walk(MODULE_TREE):
        if isinstance(node, ast.Name) and node.id in tainted:
            if isinstance(node.ctx, ast.Load):
                check(node, f"prose held in {node.id!r}")

    # The named parameter itself: `source_text` is a parameter of the request
    # builder, so a matcher there would never touch the string constant.
    prose_params = set()
    for node in ast.walk(MODULE_TREE):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            arguments = node.args
            for arg in (list(arguments.posonlyargs) + list(arguments.args)
                        + list(arguments.kwonlyargs)):
                if arg.arg in PROSE_FIELDS:
                    prose_params.add(arg.arg)
    for node in ast.walk(MODULE_TREE):
        if isinstance(node, ast.Name) and node.id in prose_params:
            if isinstance(node.ctx, ast.Load):
                check(node, f"the {node.id!r} parameter")

    assert not findings, (
        "The table's sentence is being read to make a decision:\n  "
        + "\n  ".join(sorted(set(findings)))
        + "\n\n"
        + PROSE_LAW
    )


def test_the_validation_and_persistence_path_never_even_names_the_sentence():
    """A weaker rule than the AST scan above and a stricter one where it counts.

    Validation and retrieval decide whether a patch is admissible and which
    patches come back. A reference to `source_text` anywhere in them is wrong
    even if it looks inert today, because the next edit turns an inert
    reference into a live one without touching a single check.
    """
    silent = {
        "validate_cases",
        "validate_patch",
        "validate_compile_result",
        "target_catalogue",
        "decide_patch",
        "confirmed_patches",
        "load_document",
        "_closed",
    }
    seen = set()
    offences = []
    for node in ast.walk(MODULE_TREE):
        if isinstance(node, ast.FunctionDef) and node.name in silent:
            seen.add(node.name)
            for child in ast.walk(node):
                if isinstance(child, ast.Constant) and child.value in PROSE_FIELDS:
                    offences.append(
                        f"{node.name} (line {child.lineno}) names {child.value!r}"
                    )
    missing = silent - seen
    assert not missing, (
        f"expected these functions to exist and be scanned: {sorted(missing)}"
    )
    assert not offences, (
        "The validation path names the table's sentence:\n  "
        + "\n  ".join(offences) + "\n\n" + PROSE_LAW
    )


def test_the_only_regex_in_the_module_is_the_declared_id_grammar():
    """`re` is imported for the patch id grammar and for nothing else.

    Every compiled pattern is bound at module level to a name ending `_ID_RE`,
    and no other line in the file touches the `re` module. A second pattern --
    over the sentence, over a statement, over a reason -- is the phrase table
    §3.4 forbids, arriving one import at a time.
    """
    grammar_nodes = set()
    grammar_names = []
    for node in MODULE_TREE.body:
        targets = []
        if isinstance(node, ast.Assign):
            targets = [t.id for t in node.targets if isinstance(t, ast.Name)]
        elif isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
            targets = [node.target.id]
        if targets and any(name.endswith("_ID_RE") for name in targets):
            grammar_names.extend(targets)
            grammar_nodes.update(id(child) for child in ast.walk(node))

    assert grammar_names == ["PATCH_ID_RE"], (
        f"expected exactly the patch id grammar at module level, found "
        f"{grammar_names}"
    )

    stray = []
    for node in ast.walk(MODULE_TREE):
        if id(node) in grammar_nodes:
            continue
        if isinstance(node, ast.Attribute) and isinstance(node.value, ast.Name):
            if node.value.id == "re":
                stray.append(f"line {node.lineno}: re.{node.attr}")
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute):
            if node.func.attr in {"compile", "escape"} and id(node) not in grammar_nodes:
                if isinstance(node.func.value, ast.Name) and node.func.value.id == "re":
                    stray.append(f"line {node.lineno}: re.{node.func.attr}")
    assert not stray, (
        "regex machinery outside the declared id grammar:\n  "
        + "\n  ".join(sorted(set(stray))) + "\n\n" + PROSE_LAW
    )


def test_the_module_imports_no_text_matching_machinery():
    imported = set()
    for node in ast.walk(MODULE_TREE):
        if isinstance(node, ast.Import):
            for alias in node.names:
                imported.add(alias.name.split(".")[0])
        if isinstance(node, ast.ImportFrom) and node.module:
            imported.add(node.module.split(".")[0])
    offending = sorted(imported & BANNED_IMPORTS)
    assert not offending, (
        f"the module imports text-matching machinery: {offending}\n\n" + PROSE_LAW
    )


def test_the_module_declares_no_phrase_table():
    """No module-level collection of sentence fragments.

    A keyword list is how prose matching actually arrives: not as a regex, but
    as `_LUCK_WORDS = {"luck", "fortune", "spend"}` next to a membership test.
    Every module-level string collection here must be a declared vocabulary of
    the contract -- layers, relations, scopes, case kinds, field names.
    """
    known_vocabularies = {
        "RELATIONS", "LAYERS", "AUTHORABLE_LAYERS", "SCOPES", "CASE_KINDS",
        "STATUSES", "CASE_FIELDS", "PATCH_FIELDS", "RECORD_FIELDS",
        "DOCUMENT_FIELDS", "PROVENANCE_FIELDS", "RESULT_FIELDS",
    }
    unexpected = []
    for node in MODULE_TREE.body:
        if isinstance(node, ast.Assign):
            targets = [t.id for t in node.targets if isinstance(t, ast.Name)]
            value = node.value
        elif isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
            targets = [node.target.id]
            value = node.value
        else:
            continue
        if value is None:
            continue
        holds_strings = (
            isinstance(value, (ast.Tuple, ast.List, ast.Set, ast.Dict))
            or (isinstance(value, ast.Call) and isinstance(value.func, ast.Name)
                and value.func.id in {"frozenset", "set", "tuple", "list"})
        )
        if not holds_strings:
            continue
        for name in targets:
            if name not in known_vocabularies:
                unexpected.append(name)
    assert not unexpected, (
        f"undeclared module-level string collection(s): {sorted(unexpected)}. "
        "Every table in this module is part of the contract's vocabulary; a "
        "new one is a phrase table until proven otherwise.\n\n" + PROSE_LAW
    )


# --------------------------------------------------------------------------
# 10. It never mutates anything else
# --------------------------------------------------------------------------

def test_proposing_and_deciding_leave_every_other_save_file_byte_identical(
    tmp_path,
):
    """Scope boundary (module docstring): a confirmed patch is a record.

    Admitting it to the rule graph is slice R2. Nothing here may touch dice,
    HP/SAN/MP/Luck, a settled result, or any other campaign state.
    """
    coc_state.create_campaign(tmp_path, "record-only", "Record Only")
    campaign_dir = tmp_path / ".coc" / "campaigns" / "record-only"
    save_dir = campaign_dir / "save"

    before = snapshot(save_dir, exclude={EXPECTED_DOCUMENT_NAME})
    document_before = (save_dir / EXPECTED_DOCUMENT_NAME).read_bytes()
    assert before, "the campaign save/ snapshot was empty"

    request = make_request(campaign_id="record-only")
    house_rules.propose_patch(
        campaign_dir, request=request, result=make_result(request)
    )
    after_propose = snapshot(save_dir, exclude={EXPECTED_DOCUMENT_NAME})
    assert after_propose == before, (
        "proposing a patch changed campaign state outside its own document: "
        + str(sorted(name for name in set(before) | set(after_propose)
                     if before.get(name) != after_propose.get(name)))
    )

    house_rules.decide_patch(
        campaign_dir, patch_id="patch:no-luck-spending", version=1,
        accept=True, decided_reason="Adopted at the table.",
    )
    house_rules.confirmed_patches(campaign_dir)
    house_rules.confirmed_patches(campaign_dir, target=LUCK_SPEND_RULE)

    after = snapshot(save_dir, exclude={EXPECTED_DOCUMENT_NAME})
    changed = sorted(
        name for name in set(before) | set(after)
        if before.get(name) != after.get(name)
    )
    assert not changed, (
        f"deciding a patch changed campaign state outside its own document: "
        f"{changed}. A confirmed patch is a record; enforcing it is slice R2."
    )
    # And its own document did change, so the comparison above is not vacuous.
    assert (save_dir / EXPECTED_DOCUMENT_NAME).read_bytes() != document_before


def test_reading_writes_nothing_at_all(campaign, request_a):
    propose(campaign, request_a)
    house_rules.decide_patch(
        campaign, patch_id="patch:no-luck-spending", version=1,
        accept=True, decided_reason="Adopted.",
    )
    before = snapshot(campaign)

    house_rules.confirmed_patches(campaign)
    house_rules.confirmed_patches(campaign, target=LUCK_SPEND_RULE)
    house_rules.load_document(campaign)
    house_rules.target_catalogue(COC7_RULESET)

    assert snapshot(campaign) == before


def test_the_recorded_patch_is_a_copy_the_caller_can_no_longer_reach(
    campaign, request_a
):
    """Kills the mutation that drops the `copy.deepcopy` in `propose_patch`.

    Reading the file back is not enough to catch that: the document was
    serialized at propose time, so a later edit through the caller's dict never
    reaches disk. The record handed back is where the aliasing shows, and it is
    the object a caller renders to the table for confirmation -- if it is the
    same dict the caller still holds, the cases the user is about to confirm
    can change between being proposed and being read.
    """
    result = make_result(request_a)
    outcome = house_rules.propose_patch(
        campaign, request=request_a, result=result
    )
    recorded = outcome["record"]["patch"]
    assert recorded is not result["patch"]

    result["patch"]["statement"] = "Rewritten after the fact."
    result["patch"]["cases"][0]["with_patch"] = "Rewritten after the fact."
    result["patch"]["cases"].append(positive_case())

    assert recorded == make_patch(), (
        "the record handed back still aliases the caller's result; a patch "
        "under confirmation must not be editable behind the table's back"
    )
    assert stored(campaign)["patches"][0]["patch"] == make_patch()

    # And the replay path still sees the original, so a caller's later edits
    # cannot turn a replay into a conflict or the other way round.
    replay = house_rules.propose_patch(
        campaign, request=request_a, result=make_result(request_a)
    )
    assert replay["reason"] == "replay"


def test_a_fresh_campaign_carries_an_empty_patch_document(tmp_path):
    coc_state.create_campaign(tmp_path, "fresh-house", "Fresh House")
    campaign_dir = tmp_path / ".coc" / "campaigns" / "fresh-house"
    path = campaign_dir / "save" / EXPECTED_DOCUMENT_NAME

    assert path.is_file(), (
        "a fresh campaign has no house-rule document; the first patch of the "
        "table would have to create it mid-turn"
    )
    assert json.loads(path.read_text(encoding="utf-8")) == house_rules.new_document(
        "fresh-house"
    )
    assert house_rules.confirmed_patches(campaign_dir) == []


# --------------------------------------------------------------------------
# 11. A corrupt document is never silently replaced
# --------------------------------------------------------------------------

CORRUPT_DOCUMENTS = [
    "{ this is not json",
    "",
    "[]",
    '{"contract_id": "coc.house-rule-patch.v1", "schema_version": 1}',
    '{"contract_id": "coc.house-rule-patch.v0", "schema_version": 1,'
    ' "campaign_id": "x", "patches": []}',
    '{"contract_id": "coc.house-rule-patch.v1", "schema_version": 2,'
    ' "campaign_id": "x", "patches": []}',
    '{"contract_id": "coc.house-rule-patch.v1", "schema_version": 1,'
    ' "campaign_id": "x", "patches": {}}',
    '{"contract_id": "coc.house-rule-patch.v1", "schema_version": 1,'
    ' "campaign_id": "x", "patches": [], "notes": "extra"}',
]


@pytest.mark.parametrize("corrupt", CORRUPT_DOCUMENTS)
def test_a_corrupt_patch_document_raises_and_is_left_untouched(
    campaign, request_a, corrupt
):
    path = campaign / "save" / EXPECTED_DOCUMENT_NAME
    path.write_text(corrupt, encoding="utf-8")
    original = path.read_bytes()

    with pytest.raises(house_rules.HouseRuleError):
        house_rules.load_document(campaign)
    with pytest.raises(house_rules.HouseRuleError):
        propose(campaign, request_a)
    with pytest.raises(house_rules.HouseRuleError):
        house_rules.decide_patch(
            campaign, patch_id="patch:no-luck-spending", version=1,
            accept=True, decided_reason="Adopted.",
        )
    with pytest.raises(house_rules.HouseRuleError):
        house_rules.confirmed_patches(campaign)

    assert path.is_file(), "the corrupt document was deleted"
    assert path.read_bytes() == original, (
        "the corrupt document was rewritten; a table's record of what it "
        "adopted must never be silently replaced by an empty one"
    )


def test_an_unreadable_document_is_not_replaced_by_a_valid_proposal(campaign):
    """The refusal holds on the path that would otherwise write.

    `propose_patch` calls `load_document` before it appends, so a corrupt file
    stops the write. If the load ever degraded to `new_document`, a table's
    whole patch history would vanish behind one successful proposal.
    """
    path = campaign / "save" / EXPECTED_DOCUMENT_NAME
    path.write_bytes(b"\xff\xfe not utf-8 at all")
    original = path.read_bytes()

    with pytest.raises(house_rules.HouseRuleError) as excinfo:
        propose(campaign, make_request())
    assert "unreadable" in str(excinfo.value)
    assert path.read_bytes() == original


def test_the_document_round_trips_through_its_own_reader(campaign, request_a):
    """Everything this module writes, it can read back on the real path."""
    propose(campaign, request_a)
    propose(campaign, request_a, make_patch(version=2, reason="A revision."))
    house_rules.decide_patch(
        campaign, patch_id="patch:no-luck-spending", version=1,
        accept=False, decided_reason="Not this wording.",
    )
    house_rules.decide_patch(
        campaign, patch_id="patch:no-luck-spending", version=2,
        accept=True, decided_reason="This wording.",
    )

    document = house_rules.load_document(campaign)
    assert document == stored(campaign)
    assert document["contract_id"] == EXPECTED_CONTRACT_ID
    assert document["campaign_id"] == "luck-case"
    assert statuses(campaign) == {
        ("patch:no-luck-spending", 1): "rejected",
        ("patch:no-luck-spending", 2): "confirmed",
    }
    assert copy.deepcopy(document) == document
