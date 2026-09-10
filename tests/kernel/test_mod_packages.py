"""Version pinning and lifecycle through host-only Mod RPC methods."""
import json
import shutil
import zipfile
from pathlib import Path

from conftest import CAMPAIGN, WORKTREE, campaign_dir, narrate, open_turn, read_json


def package(tmp_path, *, version="1.2.0", state_version=1, migrations=None):
    path = tmp_path / ("package-" + version)
    shutil.copytree(WORKTREE / "mods" / "natural-npc", path)
    manifest = read_json(path / "mod.json")
    manifest.update(version=version, state_version=state_version)
    if migrations is not None:
        manifest["migrations"] = migrations
    (path / "mod.json").write_text(json.dumps(manifest))
    return path


def test_install_does_not_upgrade_save_and_missing_migration_retains_old_lock(kernel, tmp_path):
    open_turn(kernel)
    narrate(kernel, "t1-c1", "我们停下来。")
    root = package(tmp_path, state_version=2)
    kernel.ok("mods.install", {"path":str(root)})
    world_path = campaign_dir(kernel.workspace) / "world.json"
    before = read_json(world_path)["mods"]
    assert before["active"]["natural-npc"]["version"] == "1.1.1"
    error = kernel.err("mods.configure", {"campaign":CAMPAIGN, "id":"natural-npc", "version":"1.2.0"})
    assert error["code"] == "invalid_params"
    assert read_json(world_path)["mods"] == before


def test_explicit_migration_runs_once_and_old_package_stays_available(kernel, tmp_path):
    open_turn(kernel)
    narrate(kernel, "t1-c1", "我们停下来。")
    root = package(tmp_path, state_version=2, migrations=[{"from":1,"to":2,
        "operations":[{"op":"default","key":"migration_note","value":"retained"}]}])
    kernel.ok("mods.install", {"path":str(root)})
    args = {"campaign":CAMPAIGN,"id":"natural-npc","version":"1.2.0"}
    kernel.ok("mods.configure", args)
    kernel.ok("mods.configure", args)
    world = read_json(campaign_dir(kernel.workspace) / "world.json")
    assert world["mods"]["state"]["natural-npc"]["migration_note"] == "retained"
    assert world["mods"]["active"]["natural-npc"]["state_version"] == 2
    assert (kernel.workspace / ".coc/mods/packages/natural-npc/1.1.1/mod.json").exists()


def test_import_rejects_escaping_archive_and_different_bytes_for_a_version(kernel, tmp_path):
    bad = tmp_path / "bad.zip"
    with zipfile.ZipFile(bad, "w") as archive:
        archive.writestr("../escape.json", "{}")
    assert kernel.err("mods.install", {"path":str(bad)})["code"] == "invalid_params"
    assert not (kernel.workspace / "escape.json").exists()
    root = package(tmp_path)
    kernel.ok("mods.install", {"path":str(root)})
    (root / "agent.md").write_text("Changed bytes under the same version")
    assert kernel.err("mods.install", {"path":str(root)})["code"] == "invalid_params"


def test_incompatible_mod_is_listed_but_not_activated(kernel, tmp_path):
    open_turn(kernel)
    root = package(tmp_path)
    manifest = read_json(root / "mod.json")
    manifest["requires"].append("unsupported.future.v1")
    (root / "mod.json").write_text(json.dumps(manifest))
    kernel.ok("mods.install", {"path":str(root)})
    view = kernel.ok("mods.list", {"campaign":CAMPAIGN})
    assert not next(r for r in view["mods"] if r["id"] == "natural-npc" and r["version"] == "1.2.0")["compatible"]
    assert kernel.err("mods.configure", {"campaign":CAMPAIGN,"id":"natural-npc","version":"1.2.0"})["code"] == "invalid_params"


def test_future_contributions_do_not_break_the_current_catalog(kernel,tmp_path):
    open_turn(kernel)
    root=package(tmp_path)
    manifest=read_json(root/"mod.json")
    manifest["requires"].append("future.renderer.v2")
    manifest["contributes"]={"future_renderer":{"entry":"unknown-to-this-kernel"}}
    manifest["settings"]={"future_setting":{"complex":True}}
    (root/"mod.json").write_text(json.dumps(manifest))
    kernel.ok("mods.install",{"path":str(root)})
    view=kernel.ok("mods.list",{"campaign":CAMPAIGN})
    future=next(r for r in view["mods"] if r["id"]=="natural-npc" and r["version"]=="1.2.0")
    assert not future["compatible"] and future["settings"]=={}
    assert kernel.ok("mods.context",{"campaign":CAMPAIGN})["active"]


def test_declared_setting_is_editable_and_invalid_option_is_atomic(kernel, tmp_path):
    open_turn(kernel)
    narrate(kernel,"t1-c1","我们停下来。")
    root = package(tmp_path)
    manifest = read_json(root / "mod.json")
    manifest["settings"] = {"tone":"balanced"}
    manifest["settings_schema"] = {"tone":{"enum":["balanced","restrained"]}}
    (root / "mod.json").write_text(json.dumps(manifest))
    kernel.ok("mods.install",{"path":str(root)})
    args = {"campaign":CAMPAIGN,"id":"natural-npc","version":"1.2.0","settings":{"tone":"restrained"}}
    kernel.ok("mods.configure",args)
    before = read_json(campaign_dir(kernel.workspace) / "world.json")
    assert before["mods"]["active"]["natural-npc"]["settings"] == {"tone":"restrained"}
    assert kernel.err("mods.configure",{**args,"settings":{"tone":"invalid"}})["code"] == "invalid_params"
    assert read_json(campaign_dir(kernel.workspace) / "world.json") == before
