"""Acceptance tests for the module reachability lint.

Built against the frozen contract for
`plugins/coc-keeper/scripts/coc_module_reachability.py`
(`docs/specs/pi-coc-module-reachability-lint.md` §9).

The bar these tests hold is mutation resistance: deleting a check from the lint
must turn this suite red. That is why the fixture corpus is asserted to be
non-empty and to exercise every code in `CHECK_CODES` — a check with no
triggering fixture is a hole in the corpus, not a passing check.
"""
from __future__ import annotations

import ast
import importlib.util
import json
import types
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "plugins" / "coc-keeper" / "scripts"
LINT_PATH = SCRIPTS / "coc_module_reachability.py"
CASES_DIR = ROOT / "tests" / "fixtures" / "module-reachability" / "cases"
STARTER = (
    ROOT / "plugins" / "coc-keeper" / "references"
    / "starter-scenarios" / "the-haunting"
)


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


assert LINT_PATH.is_file(), (
    f"{LINT_PATH} does not exist. This suite tests the real lint module; it "
    "must not be satisfied by a stub, a fake, or a placeholder."
)
reachability = _load("coc_module_reachability_tests", LINT_PATH)

LINT_SOURCE = LINT_PATH.read_text(encoding="utf-8")
LINT_TREE = ast.parse(LINT_SOURCE)


# --------------------------------------------------------------------------
# Contract constants, restated here on purpose.
#
# These are duplicated from LINT-CONTRACT.md rather than imported, so that a
# change to the module's own tables cannot silently re-baseline the test.
# --------------------------------------------------------------------------

EXPECTED_CONTRACT_ID = "coc.module-reachability-lint.v1"
EXPECTED_SCHEMA_VERSION = 1

EXPECTED_CHECK_CODES = (
    "edge-target-unknown",
    "available-clue-unknown",
    "clue-unplaced",
    "gate-clue-unobtainable",
    "quest-destination-unknown",
    "front-scene-unknown",
    "duplicate-record-id",
    "start-scene-count",
    "scene-unreachable",
    "scene-terminal-undeclared",
    "conclusion-behind-unreachable-scenes",
    "gate-self-locks",
    "declared-minimum-shortfall",
    "routes-not-declared",
    "conclusion-without-clues",
)

EXPECTED_SEVERITY_WHEN_DEAD = {
    "edge-target-unknown": "defect",
    "available-clue-unknown": "defect",
    "clue-unplaced": "defect",
    "gate-clue-unobtainable": "defect",
    "quest-destination-unknown": "defect",
    "front-scene-unknown": "defect",
    "duplicate-record-id": "defect",
    "start-scene-count": "observation",
    "scene-unreachable": "observation",
    "scene-terminal-undeclared": "observation",
    "conclusion-behind-unreachable-scenes": "observation",
    "gate-self-locks": "defect",
    "declared-minimum-shortfall": "defect",
    "routes-not-declared": "observation",
    "conclusion-without-clues": "observation",
}

FINDING_KEYS = {
    "code",
    "severity",
    "completeness",
    "subject_id",
    "subject_kind",
    "related_ids",
    "declared",
    "counted",
    "reason",
}

REPORT_KEYS = {
    "contract_id",
    "schema_version",
    "scenario_id",
    "progressive",
    "documents_present",
    "documents_absent",
    "codes_not_measured",
    "findings",
    "summary",
}

COMPLETENESS_VALUES = {"dead", "pending-materialization", "not-measured"}
SUBJECT_KINDS = {
    "scene", "clue", "conclusion", "quest", "front", "handout",
    "scenario", "collection",
}

# The keys a fixture case compares. Deliberately narrower than FINDING_KEYS:
# `declared` / `counted` / `reason` are pinned by their own invariant tests.
COMPARED_KEYS = (
    "code",
    "subject_id",
    "subject_kind",
    "severity",
    "completeness",
    "related_ids",
)


CASE_FILES = sorted(CASES_DIR.glob("*.json")) if CASES_DIR.is_dir() else []
CASE_IDS = [path.stem for path in CASE_FILES]


def _projected(finding: dict) -> dict:
    return {key: finding.get(key) for key in COMPARED_KEYS}


def _stable(records: list[dict]) -> list[str]:
    """Order-insensitive comparable form.

    Ordering is asserted separately, so an ordering bug must surface as its own
    failure rather than as noise inside a fixture diff.
    """
    return sorted(json.dumps(record, sort_keys=True) for record in records)


def _assert_report_shape(report: object, label: str) -> None:
    assert isinstance(report, dict), f"{label}: report is not a dict: {report!r}"
    assert set(report) == REPORT_KEYS, (
        f"{label}: report field set is not closed. "
        f"missing={sorted(REPORT_KEYS - set(report))} "
        f"extra={sorted(set(report) - REPORT_KEYS)}"
    )
    assert report["contract_id"] == EXPECTED_CONTRACT_ID
    assert report["schema_version"] == EXPECTED_SCHEMA_VERSION
    assert isinstance(report["progressive"], bool)
    for key in ("documents_present", "documents_absent", "codes_not_measured"):
        value = report[key]
        assert isinstance(value, list), f"{label}: {key} is not a list"
        assert value == sorted(value), f"{label}: {key} is not sorted: {value}"
    assert isinstance(report["findings"], list)
    for finding in report["findings"]:
        _assert_finding_shape(finding, label)


def _assert_finding_shape(finding: object, label: str) -> None:
    assert isinstance(finding, dict), f"{label}: finding is not a dict: {finding!r}"
    assert set(finding) == FINDING_KEYS, (
        f"{label}: finding field set is not closed for {finding.get('code')!r}. "
        f"missing={sorted(FINDING_KEYS - set(finding))} "
        f"extra={sorted(set(finding) - FINDING_KEYS)}"
    )
    assert finding["code"] in EXPECTED_CHECK_CODES, f"{label}: unknown code"
    assert finding["severity"] in {"defect", "observation"}
    assert finding["completeness"] in COMPLETENESS_VALUES
    assert finding["subject_kind"] in SUBJECT_KINDS
    related = finding["related_ids"]
    assert isinstance(related, list) and related is not None
    assert all(isinstance(item, str) for item in related)
    assert related == sorted(related), (
        f"{label}: related_ids not sorted for {finding['code']}: {related}"
    )
    assert isinstance(finding["declared"], dict)
    assert isinstance(finding["counted"], dict)
    assert finding["reason"] == reachability.REASONS[finding["code"]], (
        f"{label}: reason for {finding['code']} is not the fixed clause. "
        "Reasons are never generated prose."
    )


def _sort_key(finding: dict) -> tuple:
    return (
        finding["code"],
        finding["subject_id"] if finding["subject_id"] is not None else "",
        tuple(finding["related_ids"]),
    )


def _lint(documents: dict) -> dict:
    return reachability.lint_scenario_set({"documents": documents})


# --------------------------------------------------------------------------
# Contract surface
# --------------------------------------------------------------------------

def test_public_contract_surface_matches_frozen_contract():
    assert reachability.CONTRACT_ID == EXPECTED_CONTRACT_ID
    assert reachability.SCHEMA_VERSION == EXPECTED_SCHEMA_VERSION
    assert tuple(reachability.CHECK_CODES) == EXPECTED_CHECK_CODES
    assert set(reachability.REASONS) == set(EXPECTED_CHECK_CODES)
    assert reachability.SEVERITY_WHEN_DEAD == EXPECTED_SEVERITY_WHEN_DEAD
    assert issubclass(reachability.ModuleReachabilityError, ValueError)
    for name in ("load_scenario_set", "lint_scenario_set", "lint_scenario_dir"):
        assert callable(getattr(reachability, name)), f"missing {name}"


# --------------------------------------------------------------------------
# 1. Fixture-driven coverage
# --------------------------------------------------------------------------

def test_fixture_corpus_is_present():
    assert CASES_DIR.is_dir(), (
        f"{CASES_DIR} does not exist. The per-check fixture corpus is a "
        "required part of this work; without it no check is covered."
    )
    assert CASE_FILES, f"{CASES_DIR} holds no case files."


@pytest.mark.parametrize("case_path", CASE_FILES, ids=CASE_IDS)
def test_fixture_case_produces_expected_findings(case_path: Path):
    case = json.loads(case_path.read_text(encoding="utf-8"))
    label = case.get("case", case_path.stem)
    expect = case["expect"]

    report = _lint(case["documents"])
    _assert_report_shape(report, label)

    actual = [_projected(finding) for finding in report["findings"]]
    expected = [_projected(finding) for finding in expect["findings"]]
    assert _stable(actual) == _stable(expected), (
        f"{label} ({case.get('intent', '')}): findings disagree.\n"
        f"actual  ={json.dumps(actual, indent=2, sort_keys=True)}\n"
        f"expected={json.dumps(expected, indent=2, sort_keys=True)}"
    )

    assert sorted(report["codes_not_measured"]) == sorted(
        expect["codes_not_measured"]
    ), (
        f"{label}: codes_not_measured disagree.\n"
        f"actual  ={sorted(report['codes_not_measured'])}\n"
        f"expected={sorted(expect['codes_not_measured'])}"
    )


@pytest.mark.parametrize("case_path", CASE_FILES, ids=CASE_IDS)
def test_fixture_case_findings_are_deterministically_ordered(case_path: Path):
    case = json.loads(case_path.read_text(encoding="utf-8"))
    findings = _lint(case["documents"])["findings"]
    assert findings == sorted(findings, key=_sort_key), (
        f"{case.get('case', case_path.stem)}: findings are not ordered by "
        "(code, subject_id, related_ids)."
    )


@pytest.mark.parametrize("case_path", CASE_FILES, ids=CASE_IDS)
def test_fixture_case_never_reports_a_measured_code_as_not_measured(
    case_path: Path,
):
    """A code cannot both fire and be listed as unmeasured in one report."""
    case = json.loads(case_path.read_text(encoding="utf-8"))
    report = _lint(case["documents"])
    fired = {finding["code"] for finding in report["findings"]}
    unmeasured = set(report["codes_not_measured"])
    assert not (fired & unmeasured), (
        f"{case.get('case', case_path.stem)}: codes both fired and were "
        f"declared not-measured: {sorted(fired & unmeasured)}"
    )


# --------------------------------------------------------------------------
# 2. Every check code has a trigger fixture
# --------------------------------------------------------------------------

def _codes_triggered_by_corpus() -> dict[str, list[str]]:
    triggered: dict[str, list[str]] = {}
    for path in CASE_FILES:
        case = json.loads(path.read_text(encoding="utf-8"))
        for finding in case["expect"]["findings"]:
            triggered.setdefault(finding["code"], []).append(path.stem)
    return triggered


def test_every_check_code_has_at_least_one_trigger_fixture():
    triggered = _codes_triggered_by_corpus()
    missing = [code for code in EXPECTED_CHECK_CODES if code not in triggered]
    assert not missing, (
        "These check codes have no fixture that expects them to fire, so "
        "deleting the check would leave the suite green. That is a hole in the "
        f"corpus, not a passing check: {missing}"
    )


def test_every_triggered_code_actually_fires_on_its_fixture():
    """The corpus's own claims are checked against the lint, code by code.

    `test_fixture_case_produces_expected_findings` already compares whole
    reports; this restates the result per code so a deleted check names itself
    in the failure rather than hiding inside one case's diff.
    """
    triggered = _codes_triggered_by_corpus()
    unfired: dict[str, list[str]] = {}
    for path in CASE_FILES:
        case = json.loads(path.read_text(encoding="utf-8"))
        wanted = {finding["code"] for finding in case["expect"]["findings"]}
        if not wanted:
            continue
        got = {finding["code"] for finding in _lint(case["documents"])["findings"]}
        for code in sorted(wanted - got):
            unfired.setdefault(code, []).append(path.stem)
    assert not unfired, (
        "These codes are expected by a fixture but the lint did not emit "
        f"them: {json.dumps(unfired, indent=2, sort_keys=True)}\n"
        f"(corpus coverage: {json.dumps(triggered, indent=2, sort_keys=True)})"
    )


# --------------------------------------------------------------------------
# 3. Golden real input: the committed starter
# --------------------------------------------------------------------------

def test_a_report_that_measured_nothing_does_not_read_as_a_clean_bill() -> None:
    """The failure this guards was found by running the lint on a real import.

    A scenario directory that has been bound but not yet projected carries
    none of the documents the lint reads. Every count in the summary is then
    zero, which is indistinguishable from a module where all fifteen checks
    ran and found nothing -- and the spec forbids presenting that as a clean
    bill. `codes_measured` is what separates them.
    """
    nothing = reachability.lint_scenario_set(
        {"documents": {}, "absent": list(reachability.LINT_DOCUMENTS)}
    )
    assert nothing["findings"] == []
    assert nothing["summary"]["defect"] == 0
    assert nothing["summary"]["observation"] == 0
    assert nothing["summary"]["codes_measured"] == 0
    assert nothing["summary"]["codes_total"] == len(reachability.CHECK_CODES)
    assert sorted(nothing["codes_not_measured"]) == sorted(reachability.CHECK_CODES)

    measured = reachability.lint_scenario_dir(STARTER)
    assert measured["summary"]["codes_measured"] == len(reachability.CHECK_CODES)
    # Same zero defect/observation shape is NOT what distinguishes them.
    assert (
        nothing["summary"]["codes_measured"]
        != measured["summary"]["codes_measured"]
    )


def test_committed_starter_produces_exactly_one_finding():
    report = reachability.lint_scenario_dir(STARTER)
    _assert_report_shape(report, "the-haunting")

    findings = report["findings"]
    assert len(findings) == 1, (
        "The committed starter is the golden real input: it must produce "
        "exactly one finding and nothing else. Any extra finding is lint "
        "noise on a module that plays correctly.\n"
        f"{json.dumps(findings, indent=2, sort_keys=True)}"
    )

    finding = findings[0]
    assert finding["code"] == "declared-minimum-shortfall"
    assert finding["subject_id"] == "corbitt-house-documentary-history"
    assert finding["subject_kind"] == "conclusion"
    assert finding["completeness"] == "dead"
    assert finding["severity"] == "defect"
    assert finding["declared"]["minimum_routes"] == 3
    assert finding["counted"]["scene_independent_routes"] == 1
    assert report["scenario_id"] == "the-haunting"
    assert report["progressive"] is False


def test_committed_starter_is_silent_on_the_codes_it_satisfies():
    """§2.1: the starter's structure is sound everywhere else.

    Stated separately from the count so a regression names the check that
    broke rather than only saying "two findings, expected one".
    """
    report = reachability.lint_scenario_dir(STARTER)
    codes = {finding["code"] for finding in report["findings"]}
    for code in (
        "scene-unreachable",
        "clue-unplaced",
        "edge-target-unknown",
        "scene-terminal-undeclared",
        "start-scene-count",
    ):
        assert code not in codes, (
            f"{code} fired on the committed starter, which plays correctly. "
            f"{json.dumps(report['findings'], indent=2, sort_keys=True)}"
        )


def test_committed_starter_summary_agrees_with_its_findings():
    report = reachability.lint_scenario_dir(STARTER)
    summary = report["summary"]
    findings = report["findings"]
    assert summary["defect"] == sum(
        1 for f in findings if f["severity"] == "defect"
    )
    assert summary["observation"] == sum(
        1 for f in findings if f["severity"] == "observation"
    )
    for klass in COMPLETENESS_VALUES:
        assert summary["by_completeness"][klass] == sum(
            1 for f in findings if f["completeness"] == klass
        ), f"summary.by_completeness[{klass}] disagrees with the findings"


# --------------------------------------------------------------------------
# 4. Determinism
# --------------------------------------------------------------------------

def test_linting_the_starter_twice_is_byte_identical():
    first = json.dumps(reachability.lint_scenario_dir(STARTER), sort_keys=False)
    second = json.dumps(reachability.lint_scenario_dir(STARTER), sort_keys=False)
    assert first == second, (
        "The lint owns its own ordering; two runs over the same input must "
        "serialize byte-identically."
    )


@pytest.mark.parametrize("case_path", CASE_FILES, ids=CASE_IDS)
def test_linting_a_fixture_twice_is_byte_identical(case_path: Path):
    case = json.loads(case_path.read_text(encoding="utf-8"))
    first = json.dumps(_lint(case["documents"]), sort_keys=False)
    second = json.dumps(_lint(case["documents"]), sort_keys=False)
    assert first == second


def test_findings_are_ordered_by_code_before_subject_id():
    """The contract's primary sort key is `code`, not `subject_id`.

    Every fixture in the corpus happens to sort identically under either key
    order, so nothing there can catch the two being swapped. This input is
    built so the two orderings genuinely disagree: the finding that must come
    first has the earlier code and the *later* subject_id.
    """
    documents = {
        "module-meta.json": {"scenario_id": "fx-order-discriminator"},
        "story-graph.json": {
            "scenes": [
                {
                    "scene_id": "scene-a",
                    "is_start": True,
                    "available_clues": ["clue-a"],
                    "scene_edges": [
                        {"to": "scene-missing", "kind": "travel"},
                        {"to": "scene-z", "kind": "travel"},
                    ],
                },
                {
                    "scene_id": "scene-z",
                    "is_final": True,
                    "available_clues": ["clue-nowhere"],
                    "scene_edges": [],
                },
            ],
        },
        "clue-graph.json": {
            "conclusions": [
                {
                    "conclusion_id": "conc-a",
                    "importance": "core",
                    "minimum_routes": 1,
                    "clues": [
                        {
                            "clue_id": "clue-a",
                            "delivery_kind": "skill_check",
                            "skill": "Spot Hidden",
                        },
                    ],
                },
            ],
        },
    }
    findings = _lint(documents)["findings"]
    pair = [
        finding
        for finding in findings
        if finding["code"] in {"available-clue-unknown", "edge-target-unknown"}
    ]
    assert [f["code"] for f in pair] == [
        "available-clue-unknown",
        "edge-target-unknown",
    ], (
        "Findings must be ordered by `code` first. Here the earlier code sits "
        "on the later subject_id, so sorting by subject_id first flips them.\n"
        f"{json.dumps(findings, indent=2, sort_keys=True)}"
    )
    assert pair[0]["subject_id"] > pair[1]["subject_id"], (
        "This fixture no longer discriminates the two key orders; it must be "
        "repaired rather than deleted."
    )
    assert findings == sorted(findings, key=_sort_key)


def test_determinism_survives_input_key_reordering():
    """Set iteration order must not leak into the report.

    Reversing the document and scene order changes nothing the lint is allowed
    to care about, so the serialized report must be identical.
    """
    documents = _progressive_documents(progressive=True)
    forward = json.dumps(_lint(documents), sort_keys=False)
    reversed_docs = {
        name: documents[name] for name in reversed(list(documents))
    }
    backward = json.dumps(_lint(reversed_docs), sort_keys=False)
    assert forward == backward


# --------------------------------------------------------------------------
# 5. Prose isolation — repository law (spec §3.1)
# --------------------------------------------------------------------------

PROSE_LAW = (
    "REPOSITORY LAW (spec §3.1): the lint reads ids, enums, booleans, "
    "integers and structural arrays only. It must never read free text, and "
    "must never acquire a keyword list, phrase table, or regex over prose. "
    "A lint that starts matching phrases stops being arithmetic over "
    "declarations and becomes an opinion about content — which is exactly the "
    "failure this repository has already paid for elsewhere."
)

# Forbidden anywhere outside a docstring. `delivery` is on the contract's own
# prohibition list; `delivery_kind` is a registered enum field and is a
# different string, so exact-equality comparison keeps it legal.
FORBIDDEN_PROSE_TOKENS = (
    "description",
    "player_safe_summary",
    "read_aloud",
    "note",
    "title",
    "delivery",
)

# `summary` cannot be banned outright: the report record the lint *emits* has a
# `summary` key of its own. So it is banned only in the shapes that mean
# "read an optional field off an input record" — `.get("summary")`,
# `.pop`/`.setdefault`, `getattr(x, "summary")`, and `"summary" in x`. Building
# the report uses dict literals and subscripts on structures the lint itself
# created. Malformed-input tolerance (test 6) forces any real input read to go
# through `.get`/`in`, so this scoping keeps the assertion tight without
# losing it.
CONDITIONAL_PROSE_TOKEN = "summary"
LOOKUP_METHODS = {"get", "pop", "setdefault"}


def _docstring_constant_ids(tree: ast.AST) -> set[int]:
    ids: set[int] = set()
    for node in ast.walk(tree):
        if not isinstance(
            node, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)
        ):
            continue
        body = getattr(node, "body", None) or []
        if (
            body
            and isinstance(body[0], ast.Expr)
            and isinstance(body[0].value, ast.Constant)
            and isinstance(body[0].value.value, str)
        ):
            ids.add(id(body[0].value))
    return ids


def test_lint_never_names_a_free_text_field():
    docstrings = _docstring_constant_ids(LINT_TREE)
    offenders: list[str] = []
    for node in ast.walk(LINT_TREE):
        if not isinstance(node, ast.Constant) or not isinstance(node.value, str):
            continue
        if id(node) in docstrings:
            continue
        if node.value in FORBIDDEN_PROSE_TOKENS:
            offenders.append(f"{node.value!r} at line {node.lineno}")
    assert not offenders, (
        f"{PROSE_LAW}\n"
        f"Free-text field names appear in {LINT_PATH.name}: {offenders}"
    )


def test_lint_never_looks_up_a_summary_field_on_an_input_record():
    offenders: list[str] = []
    for node in ast.walk(LINT_TREE):
        if isinstance(node, ast.Call):
            func = node.func
            name = None
            args = node.args
            if isinstance(func, ast.Attribute) and func.attr in LOOKUP_METHODS:
                name = func.attr
            elif isinstance(func, ast.Name) and func.id == "getattr":
                name = "getattr"
                args = node.args[1:]
            if name is not None:
                for arg in args:
                    if (
                        isinstance(arg, ast.Constant)
                        and arg.value == CONDITIONAL_PROSE_TOKEN
                    ):
                        offenders.append(f"{name}('summary') at line {node.lineno}")
        elif isinstance(node, ast.Compare):
            for op, comparator in zip(node.ops, node.comparators):
                if not isinstance(op, (ast.In, ast.NotIn)):
                    continue
                left = node.left
                if (
                    isinstance(left, ast.Constant)
                    and left.value == CONDITIONAL_PROSE_TOKEN
                    and not isinstance(comparator, ast.Constant)
                ):
                    offenders.append(f"'summary' in <record> at line {node.lineno}")
    assert not offenders, (
        f"{PROSE_LAW}\n"
        "The report record legitimately has its own `summary` key, so only "
        "record-read shapes are banned. These read `summary` off an input: "
        f"{offenders}"
    )


def test_lint_imports_no_regex_machinery():
    imported: list[str] = []
    banned_modules = {"re", "regex", "fnmatch", "difflib"}
    for node in ast.walk(LINT_TREE):
        if isinstance(node, ast.Import):
            for alias in node.names:
                if alias.name.split(".")[0] in banned_modules:
                    imported.append(f"import {alias.name} at line {node.lineno}")
        elif isinstance(node, ast.ImportFrom):
            root = (node.module or "").split(".")[0]
            if root in banned_modules:
                imported.append(f"from {node.module} import ... at line {node.lineno}")
    assert not imported, (
        f"{PROSE_LAW}\nPattern-matching modules imported: {imported}"
    )

    live = [
        f"{name}={value.__name__}"
        for name, value in vars(reachability).items()
        if isinstance(value, types.ModuleType) and value.__name__ in banned_modules
    ]
    assert not live, (
        f"{PROSE_LAW}\nPattern-matching modules bound at runtime: {live}"
    )


def test_lint_compiles_no_pattern_and_matches_no_substring():
    offenders: list[str] = []
    pattern_calls = {"compile", "match", "fullmatch", "search", "findall", "finditer"}
    for node in ast.walk(LINT_TREE):
        if not isinstance(node, ast.Call):
            continue
        func = node.func
        if isinstance(func, ast.Attribute) and func.attr in pattern_calls:
            base = func.value
            if isinstance(base, ast.Name) and base.id in {"re", "regex", "pattern"}:
                offenders.append(f"{base.id}.{func.attr}(...) at line {node.lineno}")
    # String method calls (lower/startswith/...) are NOT banned: normalising an
    # id is legitimate. What is banned is a substring test over a literal, which
    # is the smallest form a phrase table can take. That is checked below.
    for node in ast.walk(LINT_TREE):
        if not isinstance(node, ast.Compare):
            continue
        for op, comparator in zip(node.ops, node.comparators):
            if isinstance(op, (ast.In, ast.NotIn)) and isinstance(
                comparator, ast.Constant
            ) and isinstance(comparator.value, str):
                offenders.append(
                    f"substring test against {comparator.value!r} at line {node.lineno}"
                )
    assert not offenders, (
        f"{PROSE_LAW}\nPattern or substring matching found: {offenders}"
    )


def test_lint_module_writes_nothing():
    """§7: the lint reports; it never writes."""
    offenders: list[str] = []
    for node in ast.walk(LINT_TREE):
        if isinstance(node, ast.Call):
            func = node.func
            if isinstance(func, ast.Name) and func.id == "open":
                for arg in node.args[1:]:
                    if isinstance(arg, ast.Constant) and isinstance(arg.value, str):
                        if any(flag in arg.value for flag in ("w", "a", "x", "+")):
                            offenders.append(f"open(..., {arg.value!r}) line {node.lineno}")
            # `.replace` is deliberately absent: `str.replace` is legal and
            # indistinguishable from `Path.replace` without type inference.
            if isinstance(func, ast.Attribute) and func.attr in {
                "write_text", "write_bytes", "mkdir", "unlink", "rmdir",
                "rename", "touch", "chmod", "makedirs", "remove",
            }:
                offenders.append(f".{func.attr}(...) at line {node.lineno}")
    assert not offenders, (
        "The lint module must perform no writes of any kind: " + str(offenders)
    )


# --------------------------------------------------------------------------
# 6. Malformed-input robustness
# --------------------------------------------------------------------------

MALFORMED_CASES = {
    "empty-documents-map": {},
    "scene-is-not-a-dict": {
        "story-graph.json": {"scenes": ["not-a-dict", 7, None, []]},
    },
    "scene-edges-is-a-string": {
        "story-graph.json": {
            "scenes": [{"scene_id": "scene-a", "is_start": True, "scene_edges": "north"}],
        },
    },
    "conclusion-missing-clues": {
        "clue-graph.json": {
            "conclusions": [{"conclusion_id": "conc-a", "importance": "core"}],
        },
    },
    "scenes-is-not-a-list": {
        "story-graph.json": {"scenes": "commission-briefing"},
    },
    "document-is-not-an-object": {
        "story-graph.json": [],
        "clue-graph.json": None,
    },
    "collections-missing-entirely": {
        "story-graph.json": {},
        "clue-graph.json": {},
        "module-meta.json": {},
    },
    "ids-are-not-strings": {
        "story-graph.json": {
            "scenes": [
                {"scene_id": 17, "scene_edges": [{"to": None}], "available_clues": [4]},
            ],
        },
        "clue-graph.json": {
            "conclusions": [
                {"conclusion_id": None, "minimum_routes": "three", "clues": [7, {}]},
            ],
        },
    },
    "module-meta-progressive-is-a-string": {
        "module-meta.json": {"scenario_id": 5, "progressive": "yes"},
        "story-graph.json": {"scenes": [{"scene_id": "scene-a", "is_start": True}]},
    },
}


@pytest.mark.parametrize("label", sorted(MALFORMED_CASES), ids=sorted(MALFORMED_CASES))
def test_malformed_input_returns_a_report_instead_of_raising(label: str):
    documents = MALFORMED_CASES[label]
    try:
        report = _lint(documents)
    except Exception as exc:  # noqa: BLE001 - the point of the test
        pytest.fail(
            f"{label}: the lint raised {type(exc).__name__}: {exc}. Malformed "
            "scenario documents are the normal case for an in-progress import; "
            "the lint must return a report, not crash the import."
        )
    _assert_report_shape(report, label)
    json.dumps(report)  # a report must always be serializable


def test_malformed_input_is_still_deterministic():
    for label, documents in sorted(MALFORMED_CASES.items()):
        first = json.dumps(_lint(documents), sort_keys=False)
        second = json.dumps(_lint(documents), sort_keys=False)
        assert first == second, f"{label}: not deterministic"


def test_empty_documents_map_measures_nothing_and_passes_nothing():
    """§4: absent documents yield `not-measured`, never a clean pass."""
    report = _lint({})
    assert report["findings"] == []
    assert set(report["codes_not_measured"]) == set(EXPECTED_CHECK_CODES), (
        "With no documents at all, every code is unmeasurable. Reporting fewer "
        "than all fifteen as not-measured presents an empty read as a clean "
        "bill of health.\n"
        f"missing={sorted(set(EXPECTED_CHECK_CODES) - set(report['codes_not_measured']))}"
    )


# --------------------------------------------------------------------------
# 7. Severity downgrade (spec §3.2)
# --------------------------------------------------------------------------

def _progressive_documents(
    *,
    progressive: bool,
    source_refs: bool = True,
    parse_state: str | None = None,
    evidence_gap: bool = False,
) -> dict:
    """One scenario with a dangling edge, dialled between completeness classes.

    `edge-target-unknown` is `defect` when dead, so it is the code that proves
    the downgrade rule is not implemented backwards.
    """
    edge: dict = {"to": "scene-unbuilt", "kind": "route-to"}
    if source_refs:
        edge["source_refs"] = [
            {"path": "Module.pdf", "pdf_index": 42, "text_sha256": "a" * 64},
        ]
    scene: dict = {
        "scene_id": "scene-a",
        "is_start": True,
        "is_final": False,
        "scene_edges": [edge],
        "available_clues": [],
        "exit_conditions": [],
        "entry_conditions": [],
        "mentions": [],
        "origin": "source",
    }
    if parse_state is not None:
        scene["parse_state"] = parse_state
    if evidence_gap:
        scene["evidence_gap"] = True
    meta: dict = {"scenario_id": "downgrade-fixture"}
    if progressive:
        meta["progressive"] = True
    return {
        "module-meta.json": meta,
        "story-graph.json": {"scenes": [scene]},
        "clue-graph.json": {"conclusions": []},
    }


def _only(report: dict, code: str, label: str) -> dict:
    matches = [f for f in report["findings"] if f["code"] == code]
    assert len(matches) == 1, (
        f"{label}: expected exactly one {code}, got "
        f"{json.dumps(report['findings'], indent=2, sort_keys=True)}"
    )
    return matches[0]


def test_dead_completeness_keeps_the_declared_defect_severity():
    report = _lint(_progressive_documents(progressive=False, source_refs=False))
    finding = _only(report, "edge-target-unknown", "dead")
    assert finding["completeness"] == "dead"
    assert finding["severity"] == "defect", (
        "A complete scenario with a dangling edge is a real defect. If this "
        "reads `observation`, every genuine contradiction has been demoted."
    )


def test_pending_materialization_downgrades_a_defect_to_observation():
    report = _lint(_progressive_documents(progressive=True, source_refs=True))
    finding = _only(report, "edge-target-unknown", "pending-materialization")
    assert finding["completeness"] == "pending-materialization", (
        "A progressive scenario whose dangling edge carries source_refs is "
        "not yet materialized, not broken (spec §3.2)."
    )
    assert reachability.SEVERITY_WHEN_DEAD["edge-target-unknown"] == "defect"
    assert finding["severity"] == "observation", (
        "SEVERITY_WHEN_DEAD says `defect`, but completeness is "
        "`pending-materialization`, so severity MUST be `observation`. Getting "
        "this backwards turns every in-progress import into a wall of false "
        "defects — spec §9 calls it the single most important regression."
    )


@pytest.mark.parametrize(
    "parse_state,evidence_gap",
    [("shallow", False), ("skeleton", False), ("deep", True), (None, True)],
)
def test_not_measured_downgrades_a_defect_to_observation(parse_state, evidence_gap):
    report = _lint(
        _progressive_documents(
            progressive=True,
            source_refs=False,
            parse_state=parse_state,
            evidence_gap=evidence_gap,
        )
    )
    finding = _only(report, "edge-target-unknown", "not-measured")
    assert finding["completeness"] == "not-measured", (
        "A scene that was never parsed deeply, or that carries an "
        "evidence_gap, cannot support a reachability claim (spec §3.2). "
        "`not-measured` beats `pending-materialization` beats `dead`."
    )
    assert finding["severity"] == "observation"


def test_severity_follows_completeness_everywhere_it_is_measurable():
    """The downgrade rule, restated as an invariant over every input we have."""
    reports = [("the-haunting", reachability.lint_scenario_dir(STARTER))]
    for path in CASE_FILES:
        case = json.loads(path.read_text(encoding="utf-8"))
        reports.append((path.stem, _lint(case["documents"])))
    for label, documents in (
        ("synthetic-dead", _progressive_documents(progressive=False, source_refs=False)),
        ("synthetic-pending", _progressive_documents(progressive=True)),
        (
            "synthetic-not-measured",
            _progressive_documents(progressive=True, parse_state="shallow"),
        ),
    ):
        reports.append((label, _lint(documents)))

    for label, report in reports:
        for finding in report["findings"]:
            code = finding["code"]
            if finding["completeness"] == "dead":
                assert finding["severity"] == EXPECTED_SEVERITY_WHEN_DEAD[code], (
                    f"{label}: {code} is `dead` so its severity must be "
                    f"{EXPECTED_SEVERITY_WHEN_DEAD[code]!r}, got "
                    f"{finding['severity']!r}"
                )
            else:
                assert finding["severity"] == "observation", (
                    f"{label}: {code} is {finding['completeness']!r} so its "
                    "severity must be `observation`, got "
                    f"{finding['severity']!r}"
                )


def test_progressive_flag_alone_flips_the_completeness_class():
    """Spec §9's progressive fixture pair, held as one assertion."""
    progressive = _lint(_progressive_documents(progressive=True))
    complete = _lint(_progressive_documents(progressive=False))
    assert progressive["progressive"] is True
    assert complete["progressive"] is False
    assert (
        _only(progressive, "edge-target-unknown", "progressive")["completeness"]
        == "pending-materialization"
    )
    assert (
        _only(complete, "edge-target-unknown", "complete")["completeness"] == "dead"
    ), (
        "Removing `progressive: true` must turn the same finding into `dead`. "
        "If both classes come back the same, §3.2 is not implemented."
    )


# --------------------------------------------------------------------------
# Loader contract
# --------------------------------------------------------------------------

def test_load_scenario_set_reads_the_starter_without_inventing_documents():
    loaded = reachability.load_scenario_set(STARTER)
    assert set(loaded) == {"documents", "absent"}
    documents = loaded["documents"]
    assert "story-graph.json" in documents
    assert "clue-graph.json" in documents
    assert "module-meta.json" in documents
    assert "clues.json" not in documents, (
        "clue-graph.json is the clue authority; clues.json MUST NOT be read."
    )
    assert loaded["absent"] == sorted(loaded["absent"])
    assert not set(documents) & set(loaded["absent"])


def test_load_scenario_set_tolerates_absent_optional_documents(tmp_path):
    (tmp_path / "module-meta.json").write_text(
        json.dumps({"scenario_id": "sparse"}), encoding="utf-8"
    )
    loaded = reachability.load_scenario_set(tmp_path)
    assert "module-meta.json" in loaded["documents"]
    assert loaded["absent"], "documents that are not there must be reported absent"
    report = reachability.lint_scenario_set(loaded)
    _assert_report_shape(report, "sparse")


def test_load_scenario_set_raises_the_typed_error_for_non_object_json(tmp_path):
    (tmp_path / "story-graph.json").write_text("[1, 2, 3]", encoding="utf-8")
    with pytest.raises(reachability.ModuleReachabilityError):
        reachability.load_scenario_set(tmp_path)


def test_load_scenario_set_raises_the_typed_error_for_unreadable_json(tmp_path):
    (tmp_path / "story-graph.json").write_text("{not json", encoding="utf-8")
    with pytest.raises(reachability.ModuleReachabilityError):
        reachability.load_scenario_set(tmp_path)


def test_lint_scenario_dir_equals_load_then_lint():
    piecewise = reachability.lint_scenario_set(
        reachability.load_scenario_set(STARTER)
    )
    direct = reachability.lint_scenario_dir(STARTER)
    assert json.dumps(piecewise, sort_keys=False) == json.dumps(
        direct, sort_keys=False
    )
