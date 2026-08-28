"""Machine-enforced ownership and import seams for Pi-Coc operation cells."""
from __future__ import annotations

import ast
import importlib.util
import json
from pathlib import Path
import re

import pytest


ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "plugins" / "coc-keeper" / "scripts"
MANIFEST_PATH = ROOT / "docs" / "specs" / "pi-coc-module-ownership.json"
PI_EXTENSION = ROOT / "plugins" / "coc-keeper" / "pi" / "extensions" / "index.ts"
PI_BOUNDARY_METHODS = {
    "current-dependency-machine": (
        "removeCurrentDependency",
        "observeCurrentDependencySnapshot",
        "observeCurrentDependencyConsumerResult",
    ),
    "turn-output-gate": (
        "queueVisibleAssistantDisposition",
        "markFinalizedOutputReady",
        "coordinatorContinuationContext",
    ),
    "opening-setup-machine": (
        "hasActiveOpeningSetup",
        "observeOpeningSetupInvocation",
        "trackOpeningDispatch",
    ),
}


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


ownership = _load("coc_module_ownership_architecture", SCRIPTS / "coc_module_ownership.py")
manifest = ownership.load_manifest(MANIFEST_PATH)
toolbox = _load("coc_toolbox_operation_architecture", SCRIPTS / "coc_toolbox.py")
operation_owner = {
    operation: row["module_id"]
    for row in manifest["python_modules"]
    for operation in row["operation_ids"]
}


def _operation_literals(node: ast.AST) -> set[str]:
    return {
        child.value
        for child in ast.walk(node)
        if isinstance(child, ast.Constant)
        and isinstance(child.value, str)
        and child.value in operation_owner
    }


def test_manifest_is_complete_and_all_cells_are_migrated():
    summary = ownership.validate_manifest(manifest)
    assert summary == {
        "module_count": 24,
        "python_module_count": 21,
        "pi_module_count": 3,
        "operation_count": 141,
    }
    assert {row["migration_state"] for row in ownership.all_modules(manifest)} == {
        "migrated"
    }


@pytest.mark.parametrize("row", manifest["pi_modules"], ids=lambda row: row["module_id"])
def test_pi_machine_owns_implementation_and_facade_keeps_only_delegation(row):
    implementation_path, test_path = (ROOT / path for path in row["owned_paths"])
    implementation = implementation_path.read_text(encoding="utf-8")
    facade = PI_EXTENSION.read_text(encoding="utf-8")
    assert test_path.is_file()
    assert f'from "../lib/{implementation_path.name}"' in facade
    for method in PI_BOUNDARY_METHODS[row["module_id"]]:
        assert re.search(rf"^\s*{re.escape(method)}\(this: any[,)]", implementation, re.M)
        assert not re.search(
            rf"^\s*(?:private\s+)?{re.escape(method)}\(", facade, re.M
        )


@pytest.mark.parametrize("row", manifest["pi_modules"], ids=lambda row: row["module_id"])
def test_pi_machine_does_not_import_facade_or_forbidden_peer(row):
    implementation_path = ROOT / row["owned_paths"][0]
    source = implementation_path.read_text(encoding="utf-8")
    imports = set(re.findall(r'from\s+["\']([^"\']+)["\']', source))
    assert not {
        value for value in imports if "/extensions/" in value or value.startswith("../extensions")
    }
    pi_module_by_filename = {
        Path(candidate["owned_paths"][0]).name: candidate["module_id"]
        for candidate in manifest["pi_modules"]
    }
    peer_dependencies = {
        pi_module_by_filename[Path(value).name]
        for value in imports
        if Path(value).name in pi_module_by_filename
    }
    assert peer_dependencies <= set(row["may_depend_on"])


def test_facade_has_no_product_handler_and_each_operation_registers_once():
    facade_tree = ast.parse((SCRIPTS / "coc_toolbox.py").read_text(encoding="utf-8"))
    assert not [
        node.name
        for node in facade_tree.body
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
        and node.name.startswith("_tool_")
    ]
    assert set(toolbox.TOOLS) == set(operation_owner)
    assert set(toolbox.OPERATION_REGISTRY.specs) == set(operation_owner)
    assert set(toolbox.OPERATION_MODULES) == {
        row["module_id"] for row in manifest["python_modules"]
    }
    for operation, module_id in operation_owner.items():
        assert toolbox.TOOLS[operation]["handler"].__module__ == (
            toolbox.OPERATION_MODULES[module_id].__name__
        )


@pytest.mark.parametrize("row", manifest["python_modules"], ids=lambda row: row["module_id"])
def test_operation_cell_has_one_registrar_and_no_peer_import(row):
    path = ROOT / row["owned_paths"][0]
    source = path.read_text(encoding="utf-8")
    tree = ast.parse(source)
    registrars = [
        node for node in tree.body
        if isinstance(node, ast.FunctionDef) and node.name == "register_operations"
    ]
    assert len(registrars) == 1
    registered = {
        child.func.args[0].value
        for child in ast.walk(registrars[0])
        if isinstance(child, ast.Call)
        and isinstance(child.func, ast.Call)
        and isinstance(child.func.func, ast.Attribute)
        and child.func.func.attr == "tool"
        and child.func.args
        and isinstance(child.func.args[0], ast.Constant)
    }
    assert registered == set(row["operation_ids"])
    imported_modules = [
        alias.name
        for node in tree.body
        if isinstance(node, ast.Import)
        for alias in node.names
    ] + [
        node.module or ""
        for node in tree.body
        if isinstance(node, ast.ImportFrom)
    ]
    forbidden = [
        name for name in imported_modules
        if name.startswith("coc_operation_")
        and name != "coc_operation_kernel_runtime"
    ]
    assert forbidden == []


@pytest.mark.parametrize("row", manifest["python_modules"], ids=lambda row: row["module_id"])
def test_cell_test_file_mentions_only_its_owned_operations(row):
    tree = ast.parse((ROOT / row["owned_paths"][1]).read_text(encoding="utf-8"))
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name.startswith("test_"):
            owners = {operation_owner[name] for name in _operation_literals(node)}
            assert owners <= {row["module_id"]}, (node.name, owners)


def test_central_toolbox_tests_are_cross_cell_or_interface_only():
    tree = ast.parse((ROOT / "tests/test_toolbox.py").read_text(encoding="utf-8"))
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name.startswith("test_"):
            owners = {operation_owner[name] for name in _operation_literals(node)}
            assert len(owners) != 1, (node.name, owners)


def test_prompt_projection_and_path_guard_are_manifest_derived():
    prompt = ownership.prompt_projection(
        manifest, "finance", base_commit="base-for-two-agent-acceptance"
    )
    assert "ACTIVE_IMPLEMENTATION_TRACK=pi-coc" in prompt
    assert "module_id=finance" in prompt
    assert "state.purchase" in prompt
    assert "plugins/coc-keeper/scripts/coc_operation_finance.py" in prompt
    assert "plugins/coc-keeper/scripts/coc_toolbox.py" in prompt
    assert "opposite_track_off_limits=codex" in prompt
    assert ownership.validate_owned_paths(
        manifest,
        "finance",
        [
            "plugins/coc-keeper/scripts/coc_operation_finance.py",
            "tests/test_toolbox_finance.py",
        ],
    ) == [
        "plugins/coc-keeper/scripts/coc_operation_finance.py",
        "tests/test_toolbox_finance.py",
    ]
    with pytest.raises(ownership.OwnershipError, match="ownership violation"):
        ownership.validate_owned_paths(
            manifest,
            "finance",
            ["plugins/coc-keeper/references/mcp-operation-contracts.json"],
        )

    pi_prompt = ownership.prompt_projection(
        manifest,
        "current-dependency-machine",
        base_commit="base-for-two-agent-acceptance",
    )
    assert "migration_state=migrated" in pi_prompt
    assert "plugins/coc-keeper/pi/lib/current-dependency-machine.ts" in pi_prompt
    assert "tests/pi/current-dependency-machine.mjs" in pi_prompt
    assert ownership.validate_owned_paths(
        manifest,
        "current-dependency-machine",
        [
            "plugins/coc-keeper/pi/lib/current-dependency-machine.ts",
            "tests/pi/current-dependency-machine.mjs",
        ],
    ) == [
        "plugins/coc-keeper/pi/lib/current-dependency-machine.ts",
        "tests/pi/current-dependency-machine.mjs",
    ]
