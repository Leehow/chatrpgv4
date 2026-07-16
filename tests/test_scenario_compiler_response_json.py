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
        capture_output=True, text=True, check=False, cwd=ROOT,
    )


OBJECT = '{"a":1}'
FENCE = f"```json\n{OBJECT}\n```"


@pytest.mark.parametrize(
    "wrapped",
    [
        OBJECT,
        FENCE,
        f"```\n{OBJECT}\n```",
        f"Compiled in 2026. Result: {OBJECT}",
        f"The scenario is set in 1920. {OBJECT}",
        f"Here are 7 files: {OBJECT}",
        f"This statement is true. {OBJECT}",
        f"{OBJECT} This is false.",
        f"The field may be null. {OBJECT}",
        f'Here is the "bundle": {OBJECT}',
        f"Generated 7 files in 2026.\n{FENCE}",
        f"Here are 7 files.\n{FENCE}",
        f"Validation is true.\n{FENCE}",
        f"This is false.\n{FENCE}",
        f"The field may be null.\n{FENCE}",
        f'Here is the "bundle".\n{FENCE}',
        f"```text\nnot a JSON document\n```\n{FENCE}",
        f"See [1](https://example.test): {OBJECT}",
        f"See [1](https://example.test)\n{FENCE}",
        f"See [bundle](https://example.test) and [seven total]. Result: {OBJECT}. Thanks :) ]",
        f"Notes {{draft}} [seven total]. Result: {OBJECT}.",
        '{"text":"escaped quote \\\" and slash \\\\ and braces { [ ] }",'
        '"unicode":"雪人 \\u2603 \\ud83d\\ude00",'
        '"nested":{"rows":[1,{"ok":true},[null,false]]}}',
        '{"literal_unicode":"古树之中 🌲","nested":[{"深度":2}]}',
    ],
)
def test_accepts_one_object_with_documented_prose_and_markdown_wrappers(wrapped):
    completed = _parse(wrapped)
    assert completed.returncode == 0, completed.stdout
    assert json.loads(completed.stdout)["ok"] is True


@pytest.mark.parametrize("scalar", ['"second"', "42", "true", "false", "null"])
@pytest.mark.parametrize("position", ["before", "after"])
def test_rejects_bare_second_json_scalar_on_either_side(scalar, position):
    invalid = f"{scalar} {OBJECT}" if position == "before" else f"{OBJECT} {scalar}"
    completed = _parse(invalid)
    assert completed.returncode == 1
    assert "standalone JSON value" in json.loads(completed.stdout)["error"]


@pytest.mark.parametrize("malformed", ["+1", "0x10", "01", "1e+"])
@pytest.mark.parametrize("position", ["before", "after"])
@pytest.mark.parametrize("separator", [" ", "\n"])
def test_rejects_standalone_malformed_numeric_document(malformed, position, separator):
    invalid = f"{malformed}{separator}{OBJECT}" if position == "before" else f"{OBJECT}{separator}{malformed}"
    completed = _parse(invalid)
    assert completed.returncode == 1
    assert "malformed standalone JSON document" in json.loads(completed.stdout)["error"]


@pytest.mark.parametrize(
    "invalid, expected",
    [
        (f'{OBJECT} {{"b":2}}', "multiple JSON objects"),
        (f'{OBJECT}\n[1]', "standalone JSON value"),
        (f'{OBJECT}\ntrailing {{"second":', "truncated JSON value"),
        ('[{"first":1}]', "root must be an object"),
        ('prefix {"first":] suffix', "mismatched delimiters"),
        ('prefix {"first":1', "truncated JSON value"),
        (f'{OBJECT}\n"bad\\q"', "malformed standalone JSON document"),
        (f'{OBJECT}\n"unterminated', "malformed standalone JSON document"),
        (f'true\n{FENCE}', "standalone JSON value"),
        (f'{FENCE}\n"second"', "standalone JSON value"),
        (f'{FENCE}\n{FENCE}', "multiple JSON fences"),
        (f'before {{"outside":1}}\n{FENCE}', "standalone JSON value"),
        ('```json\n{"first":1', "unclosed JSON fence"),
        ('plain explanation only', "does not contain one complete object"),
    ],
)
def test_rejects_ambiguous_truncated_or_structurally_invalid_output(invalid, expected):
    completed = _parse(invalid)
    assert completed.returncode == 1
    payload = json.loads(completed.stdout)
    assert payload["ok"] is False
    assert expected in payload["error"]
