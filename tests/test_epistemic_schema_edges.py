"""Additional schema guards for epistemic sidecars."""
import importlib.util


def _load(name, rel):
    spec = importlib.util.spec_from_file_location(name, rel)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


helpers = _load(
    "epistemic_scenario_helpers",
    "tests/test_epistemic_scenario_compile.py",
)
compiler = helpers.coc_scenario_compile


def _valid():
    return helpers._with_valid_sidecars(helpers._compiled())


def _codes(findings):
    return {finding["code"] for finding in findings if finding["severity"] == "error"}


def test_reframe_requires_trigger_clue_id():
    compiled = _valid()
    compiled["reveal_contracts"]["contracts"][0]["trigger_clue_ids"] = []

    findings = compiler.validate_compiled_scenario(compiled)

    assert "invalid_reframe_contract" in _codes(findings)
    assert any(
        "trigger_clue_id" in finding["message"]
        for finding in findings
        if finding["code"] == "invalid_reframe_contract"
    )


def test_reveal_contract_requires_stable_id():
    compiled = _valid()
    compiled["reveal_contracts"]["contracts"][0].pop("reveal_contract_id")

    findings = compiler.validate_compiled_scenario(compiled)

    assert "invalid_reveal_contract" in _codes(findings)


def test_question_requires_player_facing_question_and_truth_ref():
    compiled = _valid()
    question = compiled["epistemic_graph"]["questions"][0]
    question.pop("player_facing_question")
    question.pop("truth_ref")

    findings = compiler.validate_compiled_scenario(compiled)

    errors = [
        finding for finding in findings
        if finding["code"] == "invalid_epistemic_question"
    ]
    assert any("player_facing_question" in finding["message"] for finding in errors)
    assert any("truth_ref" in finding["message"] for finding in errors)


def test_malformed_epistemic_sidecar_shape_is_an_error():
    compiled = helpers._compiled()
    compiled["epistemic_graph"] = []
    compiled["reveal_contracts"] = {"schema_version": 1, "contracts": []}

    findings = compiler.validate_compiled_scenario(compiled)

    assert "invalid_epistemic_sidecar" in _codes(findings)
