"""Real public runtime vertical for an external non-CoC ruleset plugin."""
from __future__ import annotations

import importlib.util
import json
import shutil
import subprocess
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator


ROOT = Path(__file__).resolve().parents[1]
PLUGIN = ROOT / "plugins" / "coc-keeper"
SPARK = ROOT / "tests" / "fixtures" / "rulesets" / "spark"
RUNNER = ROOT / "runtime" / "adapters" / "keeper" / "run_keeper_turn.mjs"
PUBLIC_STATE_SCHEMA = ROOT / "runtime" / "protocol" / "public_state.schema.json"


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def _runtime_config(plugin_root: Path) -> dict:
    return {
        "schema_version": 2,
        "planner": {"kind": "deterministic"},
        "rules": {"kind": "deterministic"},
        "narrator": {"kind": "template"},
        "player": {"kind": "human"},
        "plugin_root": str(plugin_root),
    }


def _write_runtime_config(workspace: Path, plugin_root: Path) -> None:
    coc = workspace / ".coc"
    coc.mkdir(parents=True, exist_ok=True)
    (coc / "runtime.json").write_text(
        json.dumps(_runtime_config(plugin_root)), encoding="utf-8"
    )


def _external_spark_plugin(tmp_path: Path) -> Path:
    external = tmp_path / "outside" / "plugin-a"
    shutil.copytree(PLUGIN, external)
    shutil.copytree(SPARK, external / "rulesets" / "spark")
    return external


def _node_prompt(request: dict) -> str:
    script = (
        f"import {{ keeperSystemPrompt }} from {json.dumps(RUNNER.as_uri())};"
        "const request = JSON.parse(process.argv[1]);"
        "process.stdout.write(keeperSystemPrompt(request));"
    )
    result = subprocess.run(
        ["node", "--input-type=module", "-e", script, json.dumps(request)],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    return result.stdout


def test_external_spark_public_session_is_frozen_and_headless_generic(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    external_a = _external_spark_plugin(tmp_path)
    external_b = tmp_path / "outside" / "plugin-b"
    (external_b / "scripts").mkdir(parents=True)
    # Any accidental live-config retarget is an immediate, recognizable failure.
    for filename in ("coc_state.py", "coc_runtime_ops.py", "coc_rulesets.py"):
        (external_b / "scripts" / filename).write_text(
            "raise RuntimeError('loaded mutable plugin B')\n", encoding="utf-8"
        )

    workspace = tmp_path / "workspace"
    _write_runtime_config(workspace, external_a)
    api = _load("runtime_sdk_spark_external_a", ROOT / "runtime" / "sdk" / "api.py")

    campaign = api.setup_workspace(workspace, {
        "schema_version": 1,
        "kind": "campaign.create",
        "payload": {
            "campaign_id": "spark-campaign",
            "title": "Spark Runtime",
            "ruleset_id": "spark",
            "play_language": "en-US",
        },
    })
    assert campaign["result"] == {
        "campaign_id": "spark-campaign",
        "ruleset_id": "spark",
    }
    actor = api.setup_workspace(workspace, {
        "schema_version": 1,
        "kind": "actor.create",
        "payload": {
            "campaign_id": "spark-campaign",
            "actor_id": "nova",
            "sheet": {"name": "Nova", "energy": 9},
        },
    })
    assert actor["result"]["actor_id"] == "nova"

    session_id = api.create_session(
        workspace, campaign_id="spark-campaign", investigator_id="nova"
    )
    state = api.get_state(session_id)
    assert state["actors"] == state["investigators"]
    assert state["actors"] == [{
        "id": "nova",
        "resources": {"energy": 9},
        "current_energy": 9,
        "conditions": [],
    }]
    schema = json.loads(PUBLIC_STATE_SCHEMA.read_text(encoding="utf-8"))
    Draft202012Validator(schema).validate(state)

    # Mutating the live config cannot retarget any session-owned component.
    _write_runtime_config(workspace, external_b)
    assert api.get_state(session_id)["actors"][0]["current_energy"] == 9
    with pytest.raises(Exception, match="unsupported runtime operation kind"):
        api.operate(session_id, {
            "schema_version": 1,
            "kind": "not.an.operation",
            "payload": {},
        })

    snapshot = api.snapshot_workspace_sessions(workspace)
    snapshot_payload = json.loads(snapshot.read_text(encoding="utf-8"))
    persisted_root = snapshot_payload["sessions"][0]["resolved_config"]["plugin_root"]
    assert persisted_root.startswith("@workspace/")
    assert not Path(persisted_root).is_absolute()
    restored_api = _load(
        "runtime_sdk_spark_external_restore", ROOT / "runtime" / "sdk" / "api.py"
    )
    assert restored_api.restore_workspace_sessions(workspace) == [session_id]
    assert restored_api.get_state(session_id)["actors"][0]["current_energy"] == 9

    captured: dict = {}

    class StubKeeper:
        class KeeperFinalizationError(RuntimeError):
            pass

        @classmethod
        def keeper_send_turn(cls, request, **_kwargs):
            captured.update(request)
            raise cls.KeeperFinalizationError("model-free request boundary")

    monkeypatch.setattr(
        restored_api._session, "_load_keeper_adapter", lambda: StubKeeper
    )
    with pytest.raises(restored_api._session.KeeperFinalizationBlockedError):
        restored_api.send(session_id, "I trace the circuit.")

    assert Path(captured["toolbox_path"]) == external_a / "scripts" / "coc_toolbox.py"
    assert [Path(value) for value in captured["skills_dirs"]] == [
        external_a / "skills",
        external_a / "rulesets" / "spark" / "skills",
    ]
    assert Path(captured["runtime_project_root"]) == ROOT

    prompt = _node_prompt(captured)
    assert f'uv run --project "{ROOT}" --frozen python' in prompt
    for coc_only in (
        "Call of Cthulhu", "HP/SAN", "Luck", "Dodge", "Fight Back",
        "npc.reaction", "first_impression", "development",
    ):
        assert coc_only not in prompt
    assert "active campaign's tabletop ruleset" in prompt
    assert "no advisory or package skill is mandatory per turn" in prompt

    # Recovery revalidates the frozen package binding, including schema support.
    manifest_path = external_a / "rulesets" / "spark" / "manifest.json"
    incompatible = json.loads(manifest_path.read_text(encoding="utf-8"))
    incompatible["schema_versions"]["campaign"] = 1
    manifest_path.write_text(json.dumps(incompatible), encoding="utf-8")
    rejected_restore = _load(
        "runtime_sdk_spark_incompatible_restore", ROOT / "runtime" / "sdk" / "api.py"
    )
    with pytest.raises(ValueError, match="invalid session snapshot"):
        rejected_restore.restore_workspace_sessions(workspace)


def test_runtime_rejects_manifest_campaign_schema_mismatch(tmp_path: Path) -> None:
    plugin = tmp_path / "bad-plugin"
    skills = plugin / "rulesets" / "spark" / "skills"
    shutil.copytree(SPARK / "skills", skills)
    manifest = json.loads((SPARK / "manifest.json").read_text(encoding="utf-8"))
    manifest["schema_versions"]["campaign"] = 1
    (plugin / "rulesets" / "spark" / "manifest.json").write_text(
        json.dumps(manifest), encoding="utf-8"
    )
    workspace = tmp_path / "bad-workspace"
    _write_runtime_config(workspace, plugin)
    campaign = workspace / ".coc" / "campaigns" / "bad"
    campaign.mkdir(parents=True)
    (campaign / "campaign.json").write_text(json.dumps({
        "schema_version": 2,
        "campaign_id": "bad",
        "ruleset_id": "spark",
    }), encoding="utf-8")
    locator = _load(
        "runtime_locator_bad_campaign_schema", ROOT / "runtime" / "engine" / "plugin_locator.py"
    )
    with pytest.raises(ValueError, match="does not support campaign schema"):
        locator.active_ruleset_skills_dir(workspace, "bad")
    api = _load(
        "runtime_sdk_bad_campaign_schema", ROOT / "runtime" / "sdk" / "api.py"
    )
    with pytest.raises(ValueError, match="does not support campaign schema"):
        api.create_session(workspace, campaign_id="bad", investigator_id="actor")
