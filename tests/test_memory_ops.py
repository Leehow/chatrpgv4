"""Retirement pins for the legacy Markdown-card runtime."""
from __future__ import annotations

import ast
import importlib.util
import json
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
SCRIPTS = REPO / "plugins" / "coc-keeper" / "scripts"
# Every non-private callable exported by the deleted coc_memory.py runtime.
FORMER_LIVE_CARD_API = frozenset({
    "validate_card_fields",
    "card_validation_errors",
    "create_memory_card",
    "find_card",
    "resolve_hook_card",
    "retrieve_memory_cards",
    "build_context_pack",
    "update_memory_index",
})
RETIRED_MODEL_FACING_CARD_OPS = (
    "memory.search",
    "memory.write",
    "memory.resolve_hook",
)
ARCHIVE_PATH = SCRIPTS.parent / "references" / "mcp-operation-contracts.json"
POLICY_TS_PATH = SCRIPTS.parent / "pi" / "lib" / "operation-policy.generated.ts"


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def _string_constants(tree: ast.AST) -> set[str]:
    return {
        node.value
        for node in ast.walk(tree)
        if isinstance(node, ast.Constant) and isinstance(node.value, str)
    }


def _call_name(node: ast.Call) -> str | None:
    if isinstance(node.func, ast.Name):
        return node.func.id
    if isinstance(node.func, ast.Attribute):
        return node.func.attr
    return None


def _bound_names(node: ast.AST) -> set[str]:
    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
        return {node.name}
    if isinstance(node, ast.Assign):
        return {
            target.id
            for target in node.targets
            if isinstance(target, ast.Name)
        }
    if isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
        return {node.target.id}
    return set()


def _loader_arguments(node: ast.Call) -> set[str]:
    if _call_name(node) not in {
        "_load_sibling",
        "import_module",
        "__import__",
        "spec_from_file_location",
    }:
        return set()
    return {
        value.value
        for value in (*node.args, *(keyword.value for keyword in node.keywords))
        if isinstance(value, ast.Constant) and isinstance(value.value, str)
    }


def test_legacy_markdown_card_runtime_has_no_compatibility_file_or_stub():
    assert not (SCRIPTS / "coc_memory.py").exists()
    assert not (SCRIPTS / "coc_memory").exists()


def test_live_runtime_has_no_former_card_api_or_memory_write_plan_field():
    for path in SCRIPTS.glob("*.py"):
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        assert "memory_writes" not in _string_constants(tree), path

        for node in tree.body:
            assert not (_bound_names(node) & FORMER_LIVE_CARD_API), path
            if isinstance(node, ast.Assign) and any(
                isinstance(target, ast.Name) and target.id == "__all__"
                for target in node.targets
            ):
                assert not (_string_constants(node.value) & FORMER_LIVE_CARD_API), path

        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    assert alias.name != "coc_memory", path
                    assert not alias.name.endswith(".coc_memory"), path
                    assert alias.asname not in FORMER_LIVE_CARD_API, path
                    assert alias.name.rsplit(".", 1)[-1] not in FORMER_LIVE_CARD_API, path
            elif isinstance(node, ast.ImportFrom):
                assert node.module not in {"coc_memory", ".coc_memory"}, path
                for alias in node.names:
                    assert alias.name not in FORMER_LIVE_CARD_API, path
                    assert alias.asname not in FORMER_LIVE_CARD_API, path
            elif isinstance(node, ast.Call):
                assert _call_name(node) not in FORMER_LIVE_CARD_API, path
                assert not (
                    _loader_arguments(node) & {"coc_memory", "coc_memory.py"}
                ), path
                if _call_name(node) == "getattr":
                    assert not (
                        _string_constants(node) & FORMER_LIVE_CARD_API
                    ), path


def test_retired_card_operations_are_absent_from_model_surfaces():
    coc_toolbox = _load("coc_toolbox_memory_retirement", SCRIPTS / "coc_toolbox.py")
    coc_operation_policy = _load(
        "coc_operation_policy_memory_retirement",
        SCRIPTS / "coc_operation_policy.py",
    )
    hotset_module = _load(
        "coc_mcp_contract_archive_retirement",
        SCRIPTS / "coc_mcp_contract_archive.py",
    )
    archive = json.loads(ARCHIVE_PATH.read_text(encoding="utf-8"))
    policy_ts = POLICY_TS_PATH.read_text(encoding="utf-8")

    for name in RETIRED_MODEL_FACING_CARD_OPS:
        assert name not in coc_toolbox.TOOLS, name
        assert name not in coc_toolbox.OPERATION_REGISTRY.specs, name
        assert name not in coc_toolbox._MUTATING_TOOLS, name
        assert name not in coc_operation_policy.OPERATION_POLICY_EXCEPTIONS, name
        assert name not in archive["operations"], name
        assert f'"{name}"' not in policy_ts, name
        assert name not in hotset_module.MCP_LISTED_HOTSET, name
        assert name not in archive["listed_hotset"], name
