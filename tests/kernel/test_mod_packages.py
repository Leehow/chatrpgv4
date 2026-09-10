"""Version pinning and lifecycle through host-only Mod RPC methods."""
import json
import shutil
import zipfile
from pathlib import Path

from conftest import CAMPAIGN, WORKTREE, campaign_dir, narrate, open_turn, read_json, read_jsonl


def package(tmp_path, *, version="1.3.0", state_version=1, migrations=None):
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
    assert before["active"]["natural-npc"]["version"] == "1.2.0"
    error = kernel.err("mods.configure", {"campaign":CAMPAIGN, "id":"natural-npc", "version":"1.3.0"})
    assert error["code"] == "invalid_params"
    assert read_json(world_path)["mods"] == before


def test_explicit_migration_runs_once_and_old_package_stays_available(kernel, tmp_path):
    open_turn(kernel)
    narrate(kernel, "t1-c1", "我们停下来。")
    root = package(tmp_path, state_version=2, migrations=[{"from":1,"to":2,
        "operations":[{"op":"default","key":"migration_note","value":"retained"}]}])
    kernel.ok("mods.install", {"path":str(root)})
    args = {"campaign":CAMPAIGN,"id":"natural-npc","version":"1.3.0"}
    kernel.ok("mods.configure", args)
    kernel.ok("mods.configure", args)
    world = read_json(campaign_dir(kernel.workspace) / "world.json")
    assert world["mods"]["state"]["natural-npc"]["migration_note"] == "retained"
    assert world["mods"]["active"]["natural-npc"]["state_version"] == 2
    assert (kernel.workspace / ".coc/mods/packages/natural-npc/1.2.0/mod.json").exists()


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
    assert not next(r for r in view["mods"] if r["id"] == "natural-npc" and r["version"] == "1.3.0")["compatible"]
    assert kernel.err("mods.configure", {"campaign":CAMPAIGN,"id":"natural-npc","version":"1.3.0"})["code"] == "invalid_params"


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
    future=next(r for r in view["mods"] if r["id"]=="natural-npc" and r["version"]=="1.3.0")
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
    args = {"campaign":CAMPAIGN,"id":"natural-npc","version":"1.3.0","settings":{"tone":"restrained"}}
    kernel.ok("mods.configure",args)
    before = read_json(campaign_dir(kernel.workspace) / "world.json")
    assert before["mods"]["active"]["natural-npc"]["settings"] == {"tone":"restrained"}
    assert kernel.err("mods.configure",{**args,"settings":{"tone":"invalid"}})["code"] == "invalid_params"
    assert read_json(campaign_dir(kernel.workspace) / "world.json") == before


def test_a_version_that_dropped_a_setting_is_reached_with_version_only_and_the_retired_keys_are_recorded(kernel, tmp_path):
    """§26 (2026-09-10, #70): an inherited lock across a version change keeps only the keys the target version
    declares and the dropped keys go to telemetry once; a request that names an unknown key is still refused."""
    open_turn(kernel)
    narrate(kernel, "t1-c1", "我们停下来。")
    root = package(tmp_path)
    manifest = read_json(root / "mod.json")
    manifest["settings"] = {}
    manifest["settings_schema"] = {}
    (root / "mod.json").write_text(json.dumps(manifest))
    kernel.ok("mods.install", {"path": str(root)})
    world_path = campaign_dir(kernel.workspace) / "world.json"
    before = read_json(world_path)["mods"]
    assert before["active"]["natural-npc"]["version"] == "1.2.0"
    assert before["active"]["natural-npc"]["settings"] == {"language_mixing": "light"}
    explicit = {"campaign": CAMPAIGN, "id": "natural-npc", "version": "1.3.0", "settings": {"language_mixing": "light"}}
    assert kernel.err("mods.configure", explicit)["code"] == "invalid_params"
    assert read_json(world_path)["mods"] == before
    kernel.ok("mods.configure", {"campaign": CAMPAIGN, "id": "natural-npc", "version": "1.3.0"})  # the panel's Update shape
    lock = read_json(world_path)["mods"]["active"]["natural-npc"]
    assert lock["version"] == "1.3.0" and lock["settings"] == {}
    rows = [row for row in read_jsonl(campaign_dir(kernel.workspace) / "telemetry.jsonl") if row.get("lane") == "mods"]
    assert [{key: value for key, value in row.items() if key != "at"} for row in rows] == [
        {"lane": "mods", "event": "settings_retired", "mod": "natural-npc", "from": "1.2.0", "to": "1.3.0", "keys": ["language_mixing"]}]
    capsule_row = next(entry for entry in kernel.table("capsule")["mods"]["instructions"] if entry["mod"] == "natural-npc")
    assert capsule_row["version"] == "1.3.0" and capsule_row["settings"] == {}


def test_a_retiring_upgrade_staged_during_a_busy_turn_lands_at_the_safe_boundary(kernel, tmp_path):
    """The first player turn is open, so the change waits as pending; the retirement is recorded when it is staged
    and the lock moves when the next player input finds the table free (§26)."""
    open_turn(kernel)
    root = package(tmp_path)
    manifest = read_json(root / "mod.json")
    manifest["settings"] = {}
    manifest["settings_schema"] = {}
    (root / "mod.json").write_text(json.dumps(manifest))
    kernel.ok("mods.install", {"path": str(root)})
    kernel.ok("mods.configure", {"campaign": CAMPAIGN, "id": "natural-npc", "version": "1.3.0"})
    world_path = campaign_dir(kernel.workspace) / "world.json"
    staged = read_json(world_path)["mods"]
    assert staged["active"]["natural-npc"]["version"] == "1.2.0"
    assert staged["pending"]["natural-npc"] == {"id": "natural-npc", "version": "1.3.0", "enabled": True, "settings": {}}
    narrate(kernel, "t1-c1", "我们停下来。")
    kernel.table("player_input", text="继续。")
    lock = read_json(world_path)["mods"]["active"]["natural-npc"]
    assert lock["version"] == "1.3.0" and lock["settings"] == {}
    assert "natural-npc" not in read_json(world_path)["mods"]["pending"]
    rows = [row for row in read_jsonl(campaign_dir(kernel.workspace) / "telemetry.jsonl") if row.get("lane") == "mods"]
    assert len(rows) == 1 and rows[0]["keys"] == ["language_mixing"] and rows[0]["to"] == "1.3.0"
