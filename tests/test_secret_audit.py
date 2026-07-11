import importlib.util
from pathlib import Path

import pytest


SCRIPT = Path("plugins/coc-keeper/scripts/coc_secret_audit.py")


def _load():
    spec = importlib.util.spec_from_file_location("coc_secret_audit_test", SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_direct_and_same_fact_claims_block_without_scanning_final_text():
    mod = _load()
    audit = mod.audit_secret_claims(
        ["secret-a", "secret-b"], ["public-x", "secret-a"],
        [{"asserted_ref": "public-x", "forbidden_ref": "secret-b",
          "decision": "same_fact", "reason": "semantic router match"}],
    )
    assert audit["passed"] is False
    assert audit["direct_matches"] == ["secret-a"]
    assert audit["semantic_matches"][0]["forbidden_ref"] == "secret-b"


@pytest.mark.parametrize("evidence", [
    [{"asserted_ref": "fact-a", "forbidden_ref": "secret-a", "decision": "uncertain", "reason": "low confidence"}],
    [{"asserted_ref": "fact-a", "forbidden_ref": "secret-a", "decision": "maybe", "reason": "bad enum"}],
    [{"asserted_ref": "fact-a", "forbidden_ref": "secret-a", "decision": "different_fact"}],
])
def test_uncertain_or_malformed_semantic_evidence_fails_closed(evidence):
    audit = _load().audit_secret_claims(["secret-a"], ["fact-a"], evidence)
    assert audit["passed"] is False
    assert audit["evidence_eligible"] is False


def test_complete_different_fact_evidence_passes():
    audit = _load().audit_secret_claims(
        ["secret-a"], ["fact-a"],
        [{"asserted_ref": "fact-a", "forbidden_ref": "secret-a",
          "decision": "different_fact", "reason": "distinct source fact ids"}],
    )
    assert audit["passed"] is True
    assert audit["evidence_eligible"] is True


@pytest.mark.parametrize("evidence,reason", [
    ([{"asserted_ref": "fact-a", "forbidden_ref": "secret-a",
       "decision": "different_fact", "reason": "distinct"}], "missing_pair"),
    ([{"asserted_ref": "fact-a", "forbidden_ref": "secret-a",
       "decision": "different_fact", "reason": "distinct"}] * 2, "duplicate_pair"),
    ([{"asserted_ref": "fact-x", "forbidden_ref": "secret-a",
       "decision": "different_fact", "reason": "distinct"}], "unexpected_pair"),
])
def test_semantic_coverage_must_be_exact_cartesian_product(evidence, reason):
    audit = _load().audit_secret_claims(
        ["secret-a", "secret-b"], ["fact-a"], evidence,
    )
    assert audit["passed"] is False
    assert any(item["reason"] == reason for item in audit["malformed_evidence"])


def test_audit_receipt_is_canonical_and_recomputable():
    mod = _load()
    receipt = mod.audit_secret_claims(
        ["secret-a"], ["fact-a"],
        [{"asserted_ref": "fact-a", "forbidden_ref": "secret-a",
          "decision": "different_fact", "reason": "independent evaluator result"}],
    )
    assert receipt["status"] == "passed"
    assert receipt["coverage"]["expected_pair_count"] == 1
    assert len(receipt["coverage_digest"]) == 64
    assert mod.validate_audit_receipt(receipt)["valid"] is True
    forged = {**receipt, "coverage_digest": "0" * 64}
    assert mod.validate_audit_receipt(forged)["valid"] is False
