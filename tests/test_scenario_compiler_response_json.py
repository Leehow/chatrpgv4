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
        'See [bundle](https://example.test) [seven total]:\n```json\n{"a":1}\n```\nDone :) ]',
        'See [bundle](https://example.test) and [seven total]. Result: {"a":1}. Thanks :) ]',
        'Notes {draft} [seven total]. Result: {"a":1}.',
        '{"text":"escaped quote \\\" and slash \\\\ and braces { [ ] }",'
        '"unicode":"雪人 \\u2603 \\ud83d\\ude00",'
        '"nested":{"rows":[1,{"ok":true},[null,false]]}}',
        '{"literal_unicode":"古树之中 🌲","nested":[{"深度":2}]}',
    ],
)
def test_accepts_exactly_one_complete_json_object_with_common_wrappers(wrapped):
    completed = _parse(wrapped)
    assert completed.returncode == 0, completed.stdout
    assert json.loads(completed.stdout)["ok"] is True


@pytest.mark.parametrize("scalar", ['"second"', "42", "true", "false", "null"])
@pytest.mark.parametrize("position", ["before", "after"])
def test_rejects_second_complete_json_scalar_on_either_side(scalar, position):
    object_json = '{"first":1}'
    invalid = f"{scalar} {object_json}" if position == "before" else f"{object_json} {scalar}"
    completed = _parse(invalid)
    assert completed.returncode == 1
    assert "multiple JSON values" in json.loads(completed.stdout)["error"]


@pytest.mark.parametrize(
    "invalid, expected",
    [
        ('{"first":1} {"second":2}', "multiple JSON values"),
        ('{"first":1}\ntrailing {"second":', "truncated JSON value"),
        ('[{"first":1}]', "root must be an object"),
        ('prefix {"first":] suffix', "mismatched delimiters"),
        ('prefix {"first":1', "truncated JSON value"),
        ('{"first":1}\n"second', "truncated JSON string"),
        ('"second\n{"first":1}', "JSON string"),
        ('{"first":1}\n42e', "truncated or invalid JSON number"),
        ('plain explanation only', "does not contain one complete object"),
        ('true\n```json\n{"first":1}\n```', "outside its fence"),
        ('```json\n{"first":1}\n```\n"second"', "outside its fence"),
        ('```json\n{"first":1}\n```\n```json\n{"second":2}\n```', "multiple JSON fences"),
        ('before {"outside":1}\n```json\n{"first":1}\n```', "outside its fence"),
        ('```json\n{"first":1', "unclosed JSON fence"),
    ],
)
def test_rejects_ambiguous_truncated_or_structurally_invalid_output(invalid, expected):
    completed = _parse(invalid)
    assert completed.returncode == 1
    payload = json.loads(completed.stdout)
    assert payload["ok"] is False
    assert expected in payload["error"]
