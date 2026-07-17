"""Repository-wide guardrails for the single CPython interpreter contract."""
from __future__ import annotations

import ast
import importlib.util
import re
import sys
import tomllib
from pathlib import Path


REPO = Path(__file__).resolve().parents[1]
REQUIRED = "3.14.6"
REQUIRED_UV = "0.11.16"
ACTIVE_COMMAND_SUFFIXES = {".md", ".py", ".sh", ".js", ".mjs"}
EXCLUDED_COMMAND_PARTS = {
    ".coc",
    ".git",
    ".pytest_cache",
    ".superpowers",
    ".tmp",
    ".venv",
    "active-plans",
    "node_modules",
    "superpowers",
    "tests",
    "tmp",
}


def _active_command_files():
    for path in REPO.rglob("*"):
        if not path.is_file() or path.suffix not in ACTIVE_COMMAND_SUFFIXES:
            continue
        relative = path.relative_to(REPO)
        if any(part in EXCLUDED_COMMAND_PARTS for part in relative.parts):
            continue
        if relative == Path("CHANGELOG.md"):
            continue
        yield path


def test_version_declarations_and_running_interpreter_are_exact():
    pyproject = tomllib.loads((REPO / "pyproject.toml").read_text(encoding="utf-8"))

    assert (REPO / ".python-version").read_text(encoding="utf-8") == f"{REQUIRED}\n"
    assert pyproject["project"]["requires-python"] == f"=={REQUIRED}"
    assert pyproject["tool"]["uv"]["required-version"] == f"=={REQUIRED_UV}"
    assert tuple(sys.version_info[:3]) == tuple(map(int, REQUIRED.split(".")))
    assert sys.implementation.name == "cpython"


def test_shared_runtime_check_rejects_patch_or_implementation_drift():
    path = REPO / "plugins/coc-keeper/scripts/coc_python_contract.py"
    spec = importlib.util.spec_from_file_location("coc_python_contract_test", path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)

    assert module.interpreter_matches((3, 14, 6))
    assert not module.interpreter_matches((3, 14, 5))
    try:
        module.require_python_contract((3, 14, 5))
    except RuntimeError as exc:
        assert "require CPython 3.14.6" in str(exc)
    else:
        raise AssertionError("patch-level drift must fail before runtime work")


def test_dependency_groups_and_lockfile_cover_the_supported_surfaces():
    pyproject = tomllib.loads((REPO / "pyproject.toml").read_text(encoding="utf-8"))
    lock_text = (REPO / "uv.lock").read_text(encoding="utf-8")
    lock = tomllib.loads(lock_text)

    def names(requirements):
        return {re.split(r"[<>=!~;\[]", item, maxsplit=1)[0] for item in requirements}

    runtime_names = names(pyproject["project"]["dependencies"])
    dev_names = names(pyproject["dependency-groups"]["dev"])
    assert runtime_names == set()
    assert dev_names == {
        "jsonschema",
        "pytest",
    }
    assert lock["requires-python"] == f"=={REQUIRED}"
    root_package = next(item for item in lock["package"] if item["name"] == "chatrpgv4")
    assert {item["name"] for item in root_package.get("dependencies", [])} == runtime_names
    assert {
        item["name"] for item in root_package["dev-dependencies"]["dev"]
    } == dev_names
    assert "optional-dependencies" not in root_package
    for package in ("jsonschema", "pytest"):
        assert any(item["name"] == package for item in lock["package"])
    forbidden = {"pypdf", "pdfplumber", "pymupdf", "pymupdf-layout", "pymupdf4llm"}
    assert forbidden.isdisjoint({item["name"] for item in lock["package"]})


def test_repository_has_no_builtin_pdf_parser_or_parser_imports():
    forbidden_modules = {"pypdf", "pdfplumber", "pymupdf", "pymupdf4llm", "fitz"}
    failures: list[str] = []
    for source_root in (REPO / "plugins", REPO / "runtime", REPO / "scripts"):
        for path in source_root.rglob("*.py"):
            tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
            for node in ast.walk(tree):
                if isinstance(node, ast.Import):
                    names = [alias.name.split(".", 1)[0] for alias in node.names]
                elif isinstance(node, ast.ImportFrom) and node.module:
                    names = [node.module.split(".", 1)[0]]
                else:
                    continue
                for name in names:
                    if name in forbidden_modules:
                        failures.append(f"{path.relative_to(REPO)}:{node.lineno}:{name}")
    parser_dir = REPO / "plugins/coc-keeper/skills/trpg-pdf-ingest/scripts"
    assert not parser_dir.exists() or not any(
        path.is_file() and path.suffix in {".py", ".sh"}
        for path in parser_dir.rglob("*")
    )
    assert not failures, "built-in PDF parser imports:\n" + "\n".join(failures)


def test_ci_uses_the_pin_frozen_sync_and_sha_pinned_actions_only():
    workflow = (REPO / ".github/workflows/tests.yml").read_text(encoding="utf-8")

    assert "matrix.python-version" not in workflow
    assert "python-version:" not in workflow
    assert "3.11" not in workflow and "3.12" not in workflow and "3.13" not in workflow
    assert workflow.count("python-version-file: .python-version") == 3
    assert workflow.count("astral-sh/setup-uv@") == 3
    assert workflow.count(f'version: "{REQUIRED_UV}"') == 3
    assert workflow.count("uv sync --frozen --dev") == 3
    assert "python -m pip" not in workflow and "python3 " not in workflow
    for line in workflow.splitlines():
        if "uses:" in line:
            action = line.split("uses:", 1)[1].split("#", 1)[0].strip()
            assert re.fullmatch(r"[^@\s]+@[0-9a-f]{40}", action), line


def test_active_docs_and_source_examples_use_only_the_official_uv_python_command():
    failures: list[str] = []
    dependency_install_failures: list[str] = []
    for path in _active_command_files():
        for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            if number == 1 and line == "#!/usr/bin/env python3":
                continue
            stripped = line.lstrip(" >#-`")
            if "python3 " in line or re.match(r"python(?:\s+-|\s+[./\w])", stripped):
                failures.append(f"{path.relative_to(REPO)}:{number}:{line}")
            if re.search(r"\b(?:python(?:3)?\s+-m\s+|uv\s+)?pip(?:3)?\s+install\b", line):
                dependency_install_failures.append(
                    f"{path.relative_to(REPO)}:{number}:{line}"
                )

    assert not failures, "bare interpreter commands:\n" + "\n".join(failures)
    assert not dependency_install_failures, "pip-based dependency installs:\n" + "\n".join(
        dependency_install_failures
    )
    agents = (REPO / "AGENTS.md").read_text(encoding="utf-8")
    readme = (REPO / "README.md").read_text(encoding="utf-8")
    assert f"uv {REQUIRED_UV}" in agents
    assert f"uv {REQUIRED_UV}" in readme
    assert "uv run --frozen python ..." in agents
    assert "shebangs are portability metadata" in agents


def test_production_subprocesses_do_not_select_python_from_path():
    subprocess_names = {"Popen", "run", "call", "check_call", "check_output"}
    failures: list[str] = []
    for root in (REPO / "plugins/coc-keeper/scripts", REPO / "runtime"):
        for path in root.rglob("*.py"):
            tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
            for node in ast.walk(tree):
                if not isinstance(node, ast.Call) or not node.args:
                    continue
                func = node.func
                if not isinstance(func, ast.Attribute) or func.attr not in subprocess_names:
                    continue
                command = node.args[0]
                if not isinstance(command, (ast.List, ast.Tuple)) or not command.elts:
                    continue
                executable = command.elts[0]
                if isinstance(executable, ast.Constant) and executable.value in {"python", "python3"}:
                    failures.append(f"{path.relative_to(REPO)}:{node.lineno}")

    assert not failures, "PATH-selected Python subprocesses: " + ", ".join(failures)
    keeper_adapter = (
        REPO / "runtime/adapters/keeper/run_keeper_turn.mjs"
    ).read_text(encoding="utf-8")
    assert "uv run --project" in keeper_adapter
    assert "python3 " not in keeper_adapter
    cursor_installer = (
        REPO / "plugins/coc-keeper/scripts/install-cursor-plugin.sh"
    ).read_text(encoding="utf-8")
    assert 'uv run --project "$ROOT" --frozen python - "$DEST"' in cursor_installer


def test_python_shebangs_are_non_authoritative_only():
    for root in (REPO / "plugins", REPO / "runtime", REPO / "tests"):
        for path in root.rglob("*.py"):
            first_line = path.read_text(encoding="utf-8").splitlines()[:1]
            if first_line and first_line[0].startswith("#!"):
                assert first_line[0] == "#!/usr/bin/env python3", path
