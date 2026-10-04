import pytest


def test_default_retained_workspace_is_inside_pytest_temp(request, tmp_path, monkeypatch):
    monkeypatch.delenv("COC_RPC_EVIDENCE_DIR", raising=False)
    make = request.getfixturevalue("retained")
    first, second = make("rpc-case"), make("rpc-case")
    assert first.parent == tmp_path and second.parent == tmp_path
    assert first != second


def test_explicit_evidence_directory_preserves_existing_material(request, tmp_path, monkeypatch):
    evidence = tmp_path / "requested-evidence"
    evidence.mkdir()
    sentinel = evidence / "existing.txt"
    sentinel.write_text("original evidence")
    monkeypatch.setenv("COC_RPC_EVIDENCE_DIR", str(evidence))
    make = request.getfixturevalue("retained")
    directory = make("rpc-case")
    assert directory.parent == evidence
    assert sentinel.read_text() == "original evidence"


def test_retained_case_cannot_escape_its_temp_root(request, monkeypatch):
    monkeypatch.delenv("COC_RPC_EVIDENCE_DIR", raising=False)
    make = request.getfixturevalue("retained")
    for case in ["", ".", "..", "../outside", "nested/case", "nested\\case"]:
        with pytest.raises(ValueError, match="invalid retained"):
            make(case)
