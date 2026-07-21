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


def _seed_runtime_workspace(
    workspace: Path,
    *,
    plugin_root: str | None = None,
    campaign_payload: dict | None = None,
) -> None:
    config = {
        "schema_version": 2,
        "planner": {"kind": "deterministic"},
        "rules": {"kind": "deterministic"},
        "narrator": {"kind": "template"},
        "player": {"kind": "human"},
    }
    if plugin_root is not None:
        config["plugin_root"] = plugin_root
    _write_runtime_json(workspace, config)
    campaign = workspace / ".coc" / "campaigns" / "camp-1"
    (campaign / "save" / "investigator-state").mkdir(parents=True)
    (campaign / "campaign.json").write_text(json.dumps(
        campaign_payload or {
            "schema_version": 2,
            "campaign_id": "camp-1",
            "ruleset_id": "coc7",
        }
    ), encoding="utf-8")
    (workspace / ".coc" / "investigators" / "inv-1").mkdir(parents=True)


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
    assert not Path(cfg["plugin_root"]).is_absolute()
    assert _locator().plugin_root(
        tmp_path, resolved_config=cfg
    ) == Path("/opt/plugins/other")
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


def test_public_session_accepts_absolute_plugin_root_and_recovers_without_leak(
    tmp_path,
):
    plugin = ROOT / "plugins" / "coc-keeper"
    _seed_runtime_workspace(tmp_path, plugin_root=str(plugin))
    api = _load("runtime_sdk_plugin_root_test", "runtime/sdk/api.py")

    session_id = api.create_session(
        tmp_path, campaign_id="camp-1", investigator_id="inv-1"
    )
    record = api._session.get_session(session_id)
    frozen_root = record["resolved_config"]["plugin_root"]
    assert not Path(frozen_root).is_absolute()
    assert api._session._load_plugin_locator().plugin_root(
        tmp_path, resolved_config=record["resolved_config"]
    ) == plugin

    snapshot = api._session._REGISTRY.snapshot(tmp_path)
    snapshot_payload = json.loads(snapshot.read_text(encoding="utf-8"))
    persisted_root = snapshot_payload["sessions"][0]["resolved_config"]["plugin_root"]
    assert persisted_root.startswith("@workspace/")
    assert not Path(persisted_root).is_absolute()
    restored = api._session.SessionRegistry()
    assert restored.restore(tmp_path) == [session_id]
    assert restored.get(session_id)["resolved_config"]["plugin_root"] == frozen_root


def test_active_keeper_skills_include_kernel_and_manifest_pack(tmp_path):
    _seed_runtime_workspace(
        tmp_path, plugin_root=str(ROOT / "plugins" / "coc-keeper")
    )
    adapter = _load(
        "runtime_keeper_active_skills_test", "runtime/adapters/keeper/adapter.py"
    )
    prepared = adapter.prepare_keeper_request({
        "workspace": str(tmp_path),
        "campaign_id": "camp-1",
        "player_input": "look",
        "play_language": "en",
        "finalization_offset": 0,
    })
    assert [Path(path) for path in prepared["skills_dirs"]] == [
        ROOT / "plugins" / "coc-keeper" / "skills",
        ROOT / "plugins" / "coc-keeper" / "rulesets" / "coc7" / "skills",
    ]


@pytest.mark.parametrize(
    "campaign_payload,match",
    [
        ({"schema_version": 2, "campaign_id": "camp-1"}, "missing ruleset_id"),
        (
            {
                "schema_version": 2,
                "campaign_id": "camp-1",
                "ruleset_id": "not-installed",
            },
            "unknown or unreadable ruleset",
        ),
    ],
)
def test_active_keeper_skills_fail_closed_without_bound_package(
    tmp_path, campaign_payload, match,
):
    _seed_runtime_workspace(tmp_path, campaign_payload=campaign_payload)
    locator = _locator()
    with pytest.raises(ValueError, match=match):
        locator.active_ruleset_skills_dir(tmp_path, "camp-1")


def test_epistemic_contract_uses_workspace_plugin_override(tmp_path, monkeypatch):
    plugin = tmp_path / "relocated-plugin"
    contract = plugin / "scripts" / "epistemic-contract.json"
    contract.parent.mkdir(parents=True)
    contract.write_text("{}", encoding="utf-8")
    _write_runtime_json(tmp_path, {"plugin_root": str(plugin)})
    adapter = _load(
        "runtime_epistemic_plugin_root_test",
        "runtime/adapters/compiler/epistemic_adapter.py",
    )
    observed = {}

    class _Proc:
        returncode = 0
        stdout = ""

    def fake_run(*_args, **kwargs):
        observed.update(kwargs)
        return _Proc()

    monkeypatch.setattr(adapter.subprocess, "run", fake_run)
    adapter._invoke_runner(Path("runner.mjs"), {}, timeout_s=1, workspace=tmp_path)
    assert observed["env"]["COC_EPISTEMIC_CONTRACT_PATH"] == str(contract)


def test_headless_keeper_loads_two_explicit_skill_roots():
    source = (ROOT / "runtime" / "adapters" / "keeper" / "run_keeper_turn.mjs").read_text(
        encoding="utf-8"
    )
    assert "skills_dirs" in source
    assert "coc-keeper-ruleset" in source
    assert "rulesets/coc7" not in source


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
