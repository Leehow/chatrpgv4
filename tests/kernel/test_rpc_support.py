"""The comparison must detect meaningful changes rather than normalize them away."""
import json
import sys

import pytest

from rpc_support import differences, python_internal_tests, read_command, retain_comparison
from conftest import RpcClient


def test_argv_is_explicit_and_missing_commands_do_not_select_a_fallback():
    assert read_command(None) is None
    assert read_command('["/runtime with spaces/node", "kernel.js"]') == ["/runtime with spaces/node", "kernel.js"]
    for value in ('"node kernel.js"', '[]', '[1]', '[""]'):
        with pytest.raises(ValueError):
            read_command(value)


def test_receipts_hashes_dice_and_type_changes_are_reported():
    reference = {"receipt": "r1", "sha256": "original", "roll": 51, "value": True, "at": "2000-01-01"}
    for key, changed in (("receipt", "r2"), ("sha256", "changed"), ("roll", 50), ("value", 1), ("at", "2001-01-01")):
        assert any(f"$.{key}" in row for row in differences(reference, {**reference, key: changed}))
    assert differences({"a": 1, "b": [None]}, {"b": [None], "a": 1}) == []


def test_comparison_keeps_both_inputs_and_never_overwrites_a_previous_run(tmp_path):
    before, after = {"roll": 17}, {"roll": 18}
    first, findings = retain_comparison("check", before, after, tmp_path)
    second, _ = retain_comparison("check", before, after, tmp_path)
    assert first != second and findings
    assert json.loads((first / "reference.json").read_text()) == before
    assert json.loads((first / "candidate.json").read_text()) == after


def test_matching_runtime_failures_are_not_a_successful_comparison(tmp_path):
    failed = {"failure": {"type": "AssertionError", "message": "unsupported"}}
    target, _ = retain_comparison("both-failed", failed, failed, tmp_path)
    assert json.loads((target / "comparison.json").read_text())["equal"] is False


def test_internal_import_inventory_is_advisory_and_does_not_skip_tests(tmp_path):
    (tmp_path / "test_internal.py").write_text("from coc.store import Store\n")
    (tmp_path / "test_rpc.py").write_text("from conftest import RpcClient\n")
    assert python_internal_tests(tmp_path) == ["test_internal.py"]


def test_complete_json_without_the_required_line_terminator_is_rejected(tmp_path):
    program = "import sys;sys.stdin.readline();sys.stdout.write('{\"ok\":true}');sys.stdout.flush()"
    client = RpcClient(tmp_path / "workspace", command=[sys.executable, "-c", program])
    try:
        with pytest.raises(AssertionError, match="complete JSON line"):
            client.call("kernel.hello")
    finally:
        client.close()
