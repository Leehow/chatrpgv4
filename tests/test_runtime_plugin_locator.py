# tests/test_runtime_plugin_locator.py
"""Phase 1 seam 4: plugin location resolves from one point, with one override."""
import importlib.util
import json
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]


def _load(name: str, relpath: str):
    path = ROOT / relpath
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _locator():
    return _load("runtime_plugin_locator_test", "runtime/engine/plugin_locator.py")


def _config():
    return _load("runtime_config_locator_test", "runtime/engine/config.py")


def _write_runtime_json(workspace: Path, payload: dict) -> None:
    coc = workspace / ".coc"
    coc.mkdir(parents=True, exist_ok=True)
    (coc / "runtime.json").write_text(json.dumps(payload), encoding="utf-8")


def test_default_resolution_matches_builtin_layout():
    locator = _locator()
    assert locator.plugin_root() == ROOT / "plugins" / "coc-keeper"
    assert locator.plugin_scripts_dir() == ROOT / "plugins" / "coc-keeper" / "scripts"
    assert locator.plugin_skills_dir() == ROOT / "plugins" / "coc-keeper" / "skills"


def test_default_resolution_ignores_workspace_without_override(tmp_path):
    locator = _locator()
    assert locator.plugin_root(tmp_path) == locator.default_plugin_root()
    assert locator.plugin_scripts_dir(tmp_path) == (
        locator.default_plugin_root() / "scripts"
    )


def test_absolute_plugin_root_override_wins(tmp_path):
    locator = _locator()
    elsewhere = tmp_path / "elsewhere" / "my-plugin"
    _write_runtime_json(tmp_path, {"plugin_root": str(elsewhere)})
    assert locator.plugin_root(tmp_path) == elsewhere.resolve()
    assert locator.plugin_scripts_dir(tmp_path) == elsewhere.resolve() / "scripts"
    assert locator.plugin_skills_dir(tmp_path) == elsewhere.resolve() / "skills"


def test_relative_plugin_root_override_resolves_against_repo_root(tmp_path):
    locator = _locator()
    _write_runtime_json(tmp_path, {"plugin_root": "plugins/coc-keeper"})
    assert locator.plugin_root(tmp_path) == ROOT / "plugins" / "coc-keeper"


@pytest.mark.parametrize(
    "raw_text",
    [
        "not json {",
        json.dumps(["plugin_root"]),
        json.dumps({"plugin_root": 42}),
        json.dumps({"plugin_root": "   "}),
    ],
)
def test_malformed_override_falls_back_to_default(tmp_path, raw_text):
    locator = _locator()
    coc = tmp_path / ".coc"
    coc.mkdir()
    (coc / "runtime.json").write_text(raw_text, encoding="utf-8")
    assert locator.plugin_root(tmp_path) == locator.default_plugin_root()


def test_override_carries_into_script_module_loading(tmp_path):
    """A relocated scripts dir is the one runtime module loading consumes."""
    locator = _locator()
    fake_plugin = tmp_path / "fake-plugin"
    scripts = fake_plugin / "scripts"
    scripts.mkdir(parents=True)
    (scripts / "marker_mod.py").write_text("MARKER = 'relocated'\n", encoding="utf-8")
    _write_runtime_json(tmp_path, {"plugin_root": str(fake_plugin)})
    path = locator.plugin_scripts_dir(tmp_path) / "marker_mod.py"
    spec = importlib.util.spec_from_file_location("marker_mod", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    assert mod.MARKER == "relocated"


def test_config_accepts_optional_plugin_root_and_round_trips(tmp_path):
    _write_runtime_json(tmp_path, {
        "schema_version": 2,
        "planner": {"kind": "deterministic"},
        "rules": {"kind": "deterministic"},
        "narrator": {"kind": "template"},
        "player": {"kind": "human"},
        "plugin_root": "/opt/plugins/other",
    })
    cfg = _config().load_runtime_config(tmp_path)
    assert cfg["plugin_root"] == "/opt/plugins/other"
    assert cfg["narrator"] == {"kind": "template"}


def test_config_rejects_non_string_plugin_root(tmp_path):
    _write_runtime_json(tmp_path, {
        "schema_version": 2,
        "planner": {"kind": "deterministic"},
        "rules": {"kind": "deterministic"},
        "narrator": {"kind": "template"},
        "player": {"kind": "human"},
        "plugin_root": 7,
    })
    with pytest.raises(ValueError, match="plugin_root"):
        _config().load_runtime_config(tmp_path)


def test_config_without_plugin_root_keeps_exact_pipeline_shape(tmp_path):
    _write_runtime_json(tmp_path, {
        "schema_version": 2,
        "planner": {"kind": "deterministic"},
        "rules": {"kind": "deterministic"},
        "narrator": {"kind": "template"},
        "player": {"kind": "human"},
    })
    cfg = _config().load_runtime_config(tmp_path)
    assert "plugin_root" not in cfg


def test_session_runtime_ops_loads_through_locator_with_override(tmp_path):
    """The session engine resolves coc_runtime_ops via the workspace override."""
    session = _load("runtime_session_locator_test", "runtime/engine/session.py")
    _write_runtime_json(tmp_path, {"plugin_root": str(ROOT / "plugins" / "coc-keeper")})
    ops = session._load_runtime_ops_module(tmp_path)
    assert hasattr(ops, "execute_operation")


def test_seam3_anchor_constants_stay_declared():
    paths = _load("runtime_paths_locator_test", "runtime/engine/paths.py")
    assert paths.INVESTIGATOR_STATE_DIRNAME == "investigator-state"
    assert paths.SANITY_STATE_DIRNAME == "sanity-state"
    assert paths.SAVE_PACKAGE_DIRNAMES == ("investigator-state", "sanity-state")
    gateway = _load("runtime_state_gateway_locator_test", "runtime/engine/state_gateway.py")
    assert gateway.INVESTIGATOR_RESOURCE_FIELDS == (
        "current_hp", "current_san", "current_mp"
    )


def test_seam3_anchor_constants_are_manifest_derived():
    """The anchors are reads from the coc7 manifest, not kernel literals."""
    rulesets = _load(
        "coc_rulesets_anchor_test", "plugins/coc-keeper/scripts/coc_rulesets.py"
    )
    paths = _load("runtime_paths_anchor_test", "runtime/engine/paths.py")
    gateway = _load("runtime_state_gateway_anchor_test", "runtime/engine/state_gateway.py")
    ruleset_id = rulesets.DEFAULT_RULESET_ID
    assert paths.SAVE_PACKAGE_DIRNAMES == tuple(rulesets.ruleset_state_dirs(ruleset_id))
    assert gateway.INVESTIGATOR_RESOURCE_FIELDS == tuple(
        rulesets.ruleset_projected_resource_fields(ruleset_id)
    )
    assert (paths.INVESTIGATOR_STATE_DIRNAME, paths.SANITY_STATE_DIRNAME) == tuple(
        rulesets.ruleset_state_dirs(ruleset_id)
    )
