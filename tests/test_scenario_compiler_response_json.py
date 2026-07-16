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
        f"```json\r\n{OBJECT}\r\n```",
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
        f'"bundle" follows below: {OBJECT}',
        f'"Compilation complete." Result: {OBJECT}',
        f'"bundle" is the result label.\n{OBJECT}',
        f'"bundle" is the result label.\n{FENCE}',
        f'"bund\\\"le" follows below: {OBJECT}',
        f"```text\nnot a JSON document\n```\n{FENCE}",
        f"See [1](https://example.test): {OBJECT}",
        f"See [1](https://example.test)\n{FENCE}",
        f"See [item [1]](https://example.test/a_(b)): {OBJECT}",
        f"See [item [1]](https://example.test/a_(b))\r\n{FENCE}",
        f"[see \\] [1]](https://example.test) {OBJECT}",
        f"[doc](https://example.test/(part)/[1]) {OBJECT}",
        f"[doc](https://example.test/\\)/[1]) {OBJECT}",
        f"{OBJECT} [doc](https://example.test/(part)/[1])",
        f"[doc](https://example.test/\\)/[1])\r\n{FENCE}",
        f"See [bundle](https://example.test) and [seven total]. Result: {OBJECT}. Thanks :) ]",
        f"Notes {{draft}} [seven total]. Result: {OBJECT}.",
        f"The malformed token 0xG was discussed. {OBJECT}",
        f"{OBJECT} The value NaN appears only in this sentence.",
        '{"text":"escaped quote \\\" and slash \\\\ and braces { [ ] }",'
        '"unicode":"雪人 \\u2603 \\ud83d\\ude00",'
        '"nested":{"rows":[1,{"ok":true},[null,false]]}}',
        '{"literal_unicode":"古树之中 🌲","nested":[{"深度":2}]}',
        '{"fence_text":"```json\\n{not an outer fence}\\n```"}',
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


@pytest.mark.parametrize(
    "malformed",
    [
        "+1", "0x10", "01", "1e+", "0x", "0b2", "0o8", "NaN", "Infinity", "+Infinity", "-Infinity",
        "0xG", "0x1G", "0bfoo", "0ofoo", "0b101foo", "0o7bar",
    ],
)
@pytest.mark.parametrize("position", ["before", "after"])
@pytest.mark.parametrize("separator", [" ", "\n", "\r\n"])
def test_rejects_standalone_malformed_numeric_document(malformed, position, separator):
    invalid = f"{malformed}{separator}{OBJECT}" if position == "before" else f"{OBJECT}{separator}{malformed}"
    completed = _parse(invalid)
    assert completed.returncode == 1
    assert "malformed standalone JSON document" in json.loads(completed.stdout)["error"]


@pytest.mark.parametrize(
    "invalid, expected",
    [
        (f'{OBJECT} {{"b":2}}', "multiple JSON containers"),
        (f'{OBJECT} second payload is [1,2] and must not be used.', "multiple JSON containers"),
        (f'second payload [1,2] then {OBJECT}', "multiple JSON containers"),
        (f'{OBJECT} explanation says second=[] end', "multiple JSON containers"),
        (f'{OBJECT} explanation [true,null] end', "multiple JSON containers"),
        (f'{OBJECT} explanation ["x"] end', "multiple JSON containers"),
        (f'{OBJECT} explanation [[1],{{"b":2}}] end', "multiple JSON containers"),
        (f'{OBJECT} notes [draft {{"b":2}}] end', "multiple JSON containers"),
        (f'notes [draft {{"b":2}}] end {OBJECT}', "multiple JSON containers"),
        (f'{OBJECT} notes {{draft [1,2]}} end', "multiple JSON containers"),
        (f'notes {{draft [1,2]}} end {OBJECT}', "multiple JSON containers"),
        (f'{OBJECT} notes [draft {{"b":] end', "mismatched delimiters"),
        (f'notes [draft {{"b":] end {OBJECT}', "mismatched delimiters"),
        (f'{OBJECT} notes {{draft [1,]}} end', "invalid JSON"),
        (f'notes {{draft [1,]}} end {OBJECT}', "invalid JSON"),
        (f'[doc](https://example.test) [1] {OBJECT}', "multiple JSON containers"),
        (f'{OBJECT} [doc](https://example.test) [1]', "multiple JSON containers"),
        (f'{OBJECT}\n[1]', "multiple JSON containers"),
        (f'{OBJECT}\ntrailing {{"second":', "truncated JSON value"),
        ('[{"first":1}]', "root must be an object"),
        ('prefix {"first":] suffix', "mismatched delimiters"),
        ('prefix {"first":1', "truncated JSON value"),
        (f'{OBJECT}\n"bad\\q"', "malformed standalone JSON document"),
        (f'{OBJECT}\n"unterminated', "malformed standalone JSON document"),
        (f'true\n{FENCE}', "standalone JSON value"),
        (f'{FENCE}\n"second"', "standalone JSON value"),
        (f'{FENCE}\n{FENCE}', "multiple JSON fences"),
        (f'```\n{OBJECT}\n```\n```\n{OBJECT}\n```', "multiple JSON fences"),
        (f'{FENCE}\n```\n{OBJECT}\n```', "standalone JSON value"),
        (f'{FENCE}\n```\ntrue\n```', "standalone JSON value"),
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
