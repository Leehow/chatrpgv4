"""Regression tests for wrapped scenario-compiler tool JSON responses."""
from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
PARSER = ROOT / "runtime/adapters/compiler/single_json_object.mjs"


def _parse(value: str) -> subprocess.CompletedProcess[str]:
    program = """
const { parseSingleJsonObject } = await import(process.argv[1]);
try {
  process.stdout.write(JSON.stringify({ ok: true, value: parseSingleJsonObject(process.argv[2]) }));
} catch (error) {
  process.stdout.write(JSON.stringify({ ok: false, error: error.message }));
  process.exitCode = 1;
}
"""
    return subprocess.run(
        ["node", "--input-type=module", "--eval", program, PARSER.as_uri(), value],
        capture_output=True,
        text=True,
        check=False,
        cwd=ROOT,
    )


@pytest.mark.parametrize(
    "wrapped",
    [
        '{"module-meta.json":{"scenario_id":"trees"}}',
        '```json\n{"module-meta.json":{"scenario_id":"trees"}}\n```',
        'Compiled bundle follows:\n```json\n{"module-meta.json":{"scenario_id":"trees"}}\n```\nDone.',
        'Result: {"note":"literal { and [ and } inside a string"} Thanks.',
    ],
)
def test_accepts_exactly_one_complete_json_object_with_common_wrappers(wrapped):
    completed = _parse(wrapped)
    assert completed.returncode == 0, completed.stdout
    assert json.loads(completed.stdout)["ok"] is True


@pytest.mark.parametrize(
    "invalid, expected",
    [
        ('{"first":1} {"second":2}', "multiple root containers"),
        ('{"first":1}\ntrailing {"second":', "truncated root container"),
        ('[{"first":1}]', "root must be an object"),
        ('prefix {"first":] suffix', "mismatched delimiters"),
        ('prefix {"first":1', "truncated root container"),
        ('plain explanation only', "does not contain one complete object"),
    ],
)
def test_rejects_ambiguous_truncated_or_structurally_invalid_output(invalid, expected):
    completed = _parse(invalid)
    assert completed.returncode == 1
    payload = json.loads(completed.stdout)
    assert payload["ok"] is False
    assert expected in payload["error"]
