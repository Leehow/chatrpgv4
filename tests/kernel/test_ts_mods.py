"""Canonical Mod management RPC versus Python; retained fixtures are not gameplay."""
from __future__ import annotations

import copy
import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import struct
import subprocess
import sys
import tempfile
import warnings
import zipfile

import pytest

from conftest import RpcClient
from rpc_support import differences, python_command, snapshot

ROOT = Path(__file__).resolve().parents[2]
EVIDENCE = ROOT / ".coc/playtests/ts-mod-management"


def retained(name):
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    return Path(tempfile.mkdtemp(prefix=name + "-", dir=EVIDENCE))


def candidate_command():
    return json.loads(os.environ["COC_TS_MODS_COMMAND"]) if os.environ.get("COC_TS_MODS_COMMAND") else ["node", str(ROOT / "build/kernel/rpc.mjs")]


def state(workspace):
    result = snapshot(workspace)
    base = workspace / ".coc"
    result["byte_hashes"] = {path.relative_to(base).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
        for path in sorted(base.rglob("*")) if path.is_file() and path.relative_to(base).parts[0] != "repos"}
    return result


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def package(root, label, **changes):
    destination = root / label
    destination.mkdir(parents=True)
    manifest = {"id":"fixture-mod", "version":"1.0.0", "game_api":"pipicoc.game.v1", "state_version":1,
        "name":"Fixture Mod", "description":"A management fixture.", "author":"Test fixture", "default_enabled":False,
        "requires":["context.npc.v1"], "dependencies":{}, "conflicts":[],
        "settings":{"tone":"balanced", "quota":2, "ratio":0.5, "9":"nine", "2":"two"},
        "settings_schema":{"tone":{"enum":["balanced","quiet"]}, "quota":{"minimum":0,"maximum":5}, "ratio":{"minimum":0.0,"maximum":2.0}},
        "contributes":{"instructions":"agent.md"}, **changes}
    write_json(destination / "mod.json", manifest)
    (destination / "agent.md").write_text("Use the existing declared rules. Fixture text only.\n")
    (destination / "CHANGELOG.md").write_text("Versioned fixture bytes.\n")
    (destination / "empty.md").write_bytes(b"")
    (destination / "notes").mkdir()
    (destination / "notes" / "caf\u00e9.md").write_text("\u4fdd\u7559\u539f\u6587 \U0001f3b2\n", encoding="utf-8")
    return destination, manifest


def zip_package(path, files, compression=zipfile.ZIP_DEFLATED, prefix=""):
    with zipfile.ZipFile(path, "w", compression=compression) as archive:
        for name, value in files:
            archive.writestr(prefix + name, value)
    return path


def package_bytes(path):
    return [(file.relative_to(path).as_posix(), file.read_bytes()) for file in sorted(path.rglob("*")) if file.is_file()]


def create(client, campaign="c1", pregen=True):
    return client.ok("campaign.create", {"id":campaign,"module":"the-haunting","play_language":"en", **({"pregen":"thomas-hayes"} if pregen else {})})


def observe(root, label, command, scenario):
    workspace, inputs = root / "workspace", root / "inputs"
    inputs.mkdir()
    client = RpcClient(workspace, command=command, frozen_clock=True, env={"COC_KERNEL_SEED":"mod-oracle"})
    exchanges, checkpoints = [], {}
    world_path = workspace / ".coc/campaigns/c1/world.json"

    def restart():
        nonlocal client
        exchanges.extend(client.exchanges); client.close()
        client = RpcClient(workspace, command=command, frozen_clock=True, env={"COC_KERNEL_SEED":"mod-oracle"})

    def boundary():
        client.ok("table.open", {"campaign":"c1"})
        client.ok("table.narrate", {"campaign":"c1","call_id":"t0-c1","text":"The meeting begins."})

    try:
        if scenario == "unbound-defaults":
            client.ok("mods.list")
            path, _ = package(inputs, "first")
            client.ok("mods.install", {"path":str(path)})
            client.ok("mods.install", {"path":str(path)})
            client.ok("mods.defaults")
            client.err("mods.defaults", {"id":"unknown","enabled":True})
            client.err("mods.defaults", {"id":"fixture-mod","enabled":1})
            client.ok("mods.defaults", {"id":"fixture-mod","enabled":True})
            order = ["fixture-mod", "natural-npc", "enhanced-items"]
            client.err("mods.order", {"order":["fixture-mod"]})
            client.ok("mods.order", {"order":order})
            client.err("campaign.create", {"id":"not a slug","module":"the-haunting","pregen":"thomas-hayes"})
            checkpoints["rejected-create"] = state(workspace)
            create(client)
            listed = client.ok("mods.list", {"campaign":"c1"})
            assert listed["order"] == order
            client.ok("mods.context", {"campaign":"c1"})
            client.ok("mods.defaults", {"id":"fixture-mod","enabled":False})
            assert next(row for row in client.ok("mods.list", {"campaign":"c1"})["mods"] if row["id"]=="fixture-mod")["active"]["enabled"]
            create(client, "c2")
            assert not next(row for row in client.ok("mods.list", {"campaign":"c2"})["mods"] if row["id"]=="fixture-mod")["active"]["enabled"]
        elif scenario == "accepted-codecs":
            for index, method in enumerate([zipfile.ZIP_STORED,zipfile.ZIP_DEFLATED,zipfile.ZIP_BZIP2,zipfile.ZIP_LZMA,zipfile.ZIP_ZSTANDARD]):
                source, _ = package(inputs, f"source-{index}", id=f"codec-{index}")
                archive = zip_package(inputs / f"codec-{index}.zip", package_bytes(source), method, prefix="release/" if index % 2 else "")
                first = client.ok("mods.install", {"path":str(archive)})
                assert first["digest"]
                assert client.ok("mods.install", {"path":str(source)})["reused"]
            source, _ = package(inputs, "ignored-directory", id="ignored-directory")
            archive = zip_package(inputs / "ignored-directory.zip", [("../ignored/", b""), *package_bytes(source)])
            client.ok("mods.install", {"path":str(archive)})
            source, _ = package(inputs, "cp437", id="encoded-name")
            archive = zip_package(inputs / "cp437.zip", [("mod.json", (source/"mod.json").read_bytes()), ("agent.md", b"fixture"), ("cafX.md", b"original bytes")], zipfile.ZIP_STORED)
            archive.write_bytes(archive.read_bytes().replace(b"cafX.md", b"caf\x82.md"))
            client.ok("mods.install", {"path":str(archive)})
            client.ok("mods.list")
        elif scenario == "negative-archives":
            source, _ = package(inputs, "valid")
            valid = package_bytes(source)
            bad_archives = [
                ("escape", [("../escape.json",b"{}")]), ("absolute", [("/escape.json",b"{}")]),
                ("backslash", [("folder\\mod.json",b"{}")]), ("executable", [("run.sh",b"exit 0")]),
                ("no-root", [("readme.md",b"text")]), ("two-roots", [("a/mod.json",b"{}"),("b/mod.json",b"{}")]),
                ("outside-root", [("pkg/mod.json",valid[0][1]),("outside.md",b"text")]),
                ("too-many", [(f"file-{index}.md",b"x") for index in range(129)]),
                ("too-large", [("large.md",b"x"*(16*1024*1024+1))]),
                ("bad-manifest", [("mod.json",b"{invalid")]),
            ]
            for name, files in bad_archives:
                path = zip_package(inputs / f"{name}.zip", files)
                client.err("mods.install", {"path":str(path)})
            duplicate = inputs / "duplicate.zip"
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                zip_package(duplicate, [("mod.json",b"{}"),("mod.json",b"{}")])
            client.err("mods.install", {"path":str(duplicate)})
            symlink = inputs / "symlink.zip"
            with zipfile.ZipFile(symlink,"w") as archive:
                entry=zipfile.ZipInfo("link.md"); entry.create_system=3; entry.external_attr=(stat.S_IFLNK|0o777)<<16
                archive.writestr(entry,"../target")
            client.err("mods.install", {"path":str(symlink)})
            crc = zip_package(inputs/"crc.zip", valid, zipfile.ZIP_STORED)
            data=bytearray(crc.read_bytes()); offset=data.index(b"PK\x01\x02"); data[offset+16]^=1; crc.write_bytes(data)
            client.err("mods.install", {"path":str(crc)})
            names = zip_package(inputs/"different-name.zip", valid, zipfile.ZIP_STORED)
            data=bytearray(names.read_bytes()); data[30]^=1; names.write_bytes(data)
            client.err("mods.install", {"path":str(names)})
            # A valid inner local header hidden inside another entry must not be read twice.
            nested=inputs/"nested.zip"
            zip_package(nested,[("mod.json",(source/"mod.json").read_bytes())],zipfile.ZIP_STORED)
            embedded=nested.read_bytes().split(b"PK\x01\x02")[0]
            overlap=zip_package(inputs/"overlap.zip",[("agent.md",embedded),("mod.json",(source/"mod.json").read_bytes())],zipfile.ZIP_STORED)
            data=bytearray(overlap.read_bytes()); central=data.index(b"PK\x01\x02")
            second=central+46+struct.unpack_from("<H",data,central+28)[0]
            struct.pack_into("<I",data,second+42,30+len("agent.md")); overlap.write_bytes(data)
            client.err("mods.install", {"path":str(overlap)})
            broken=inputs/"broken.zip"; broken.write_bytes(b"not a ZIP")
            client.err("mods.install", {"path":str(broken)})
            (source/"link.md").symlink_to(source/"agent.md")
            client.err("mods.install", {"path":str(source)})
            assert not (workspace/".coc/mods/packages").exists()
        elif scenario == "immutable-and-incompatible":
            path, _ = package(inputs,"first")
            client.ok("mods.install", {"path":str(path)})
            before=state(workspace)
            (path/"agent.md").write_text("Changed under the same version.")
            client.err("mods.install", {"path":str(path)})
            assert state(workspace)==before
            future,_=package(inputs,"future", id="future-mod", requires=["future.capability.v2"], contributes={"future_renderer":{"unknown":True}},settings={"future":{"structured":True}},default_enabled=True)
            client.ok("mods.install", {"path":str(future)})
            create(client)
            client.err("mods.configure", {"campaign":"c1","id":"future-mod","version":"1.0.0"})
            client.ok("mods.list", {"campaign":"c1"})
            client.ok("mods.context", {"campaign":"c1"})
        elif scenario == "settings-and-pending":
            path,_=package(inputs,"first",default_enabled=True)
            client.ok("mods.install", {"path":str(path)}); create(client); boundary()
            args={"campaign":"c1","id":"fixture-mod"}
            for settings in [{"unknown":True},{"tone":"unknown"},{"quota":True},{"quota":6},{"ratio":1}]: client.err("mods.configure",{**args,"settings":settings})
            client.ok("mods.configure",{**args,"settings":{"tone":"quiet","quota":5,"ratio":1.0}})
            client.ok("table.player_input",{"campaign":"c1","text":"I continue the conversation."})
            before=json.loads(world_path.read_text())["mods"]["active"]
            client.ok("mods.configure",{**args,"enabled":False})
            order=["natural-npc","enhanced-items","fixture-mod"]
            client.ok("mods.order",{"campaign":"c1","order":order})
            assert json.loads(world_path.read_text())["mods"]["active"]==before
            client.ok("mods.context",{"campaign":"c1"})
            client.ok("table.narrate",{"campaign":"c1","call_id":"t1-c1","text":"The conversation pauses."})
            restart(); client.ok("table.open",{"campaign":"c1"})
            assert client.ok("mods.list",{"campaign":"c1"})["pending_order"]==order
            client.ok("table.player_input",{"campaign":"c1","text":"I return to the subject."})
            listed=client.ok("mods.list",{"campaign":"c1"}); assert listed["pending_order"] is None
            assert not next(row for row in listed["mods"] if row["id"]=="fixture-mod")["active"]["enabled"]
            schema_cases=[("range-string",{"quota":2},{"quota":{"minimum":"0"}},True),
                          ("enum-string",{"tone":"quiet"},{"tone":{"enum":"balanced|quiet"}},False),
                          ("enum-dict",{"quota":1},{"quota":{"enum":{"1":True}}},True),
                          ("schema-null",{"quota":1},{"quota":None},True)]
            for name,settings,schema,rejected in schema_cases:
                source,_=package(inputs,name,id=name,settings=settings,settings_schema=schema)
                client.ok("mods.install",{"path":str(source)})
                params={"campaign":"c1","id":name,"version":"1.0.0","enabled":True}
                (client.err if rejected else client.ok)("mods.configure",params)
        elif scenario == "migrations":
            first,_=package(inputs,"first",default_enabled=True)
            client.ok("mods.install",{"path":str(first)}); create(client); boundary()
            world=json.loads(world_path.read_text()); accepted={"name":"retained","parameters":{"amount":1.0},"version":1}
            accepted["digest"]=hashlib.sha256(json.dumps(accepted,sort_keys=True,separators=(",",":"),ensure_ascii=False).encode()).hexdigest()
            world["mods"]["state"]["fixture-mod"]={"old":accepted,"keep":None}; write_json(world_path,world)
            missing,_=package(inputs,"missing",version="1.1.0",state_version=2)
            client.ok("mods.install",{"path":str(missing)}); before=world_path.read_bytes()
            client.err("mods.configure",{"campaign":"c1","id":"fixture-mod","version":"1.1.0"}); assert world_path.read_bytes()==before
            upgraded,_=package(inputs,"upgraded",version="1.2.0",state_version=3,migrations=[
                {"from":1,"to":2,"operations":[{"op":"rename","from":"old","to":"accepted"},{"op":"default","key":"keep","value":"must not overwrite"}]},
                {"from":2,"to":3,"operations":[{"op":"default","key":"42","value":42},{"op":"default","key":"10","value":10}]}])
            client.ok("mods.install",{"path":str(upgraded)})
            args={"campaign":"c1","id":"fixture-mod","version":"1.2.0"}
            client.ok("mods.configure",args); client.ok("mods.configure",args)
            changed=json.loads(world_path.read_text())["mods"]["state"]["fixture-mod"]
            assert changed["accepted"]==accepted and changed["keep"] is None
            assert (workspace/".coc/mods/packages/fixture-mod/1.0.0/mod.json").is_file()
            conflict,_=package(inputs,"conflict",version="1.3.0",state_version=4,migrations=[{"from":3,"to":4,"operations":[{"op":"rename","from":"accepted","to":"keep"}]}])
            client.ok("mods.install",{"path":str(conflict)}); before=world_path.read_bytes()
            client.err("mods.configure",{"campaign":"c1","id":"fixture-mod","version":"1.3.0"}); assert world_path.read_bytes()==before
        elif scenario == "dependencies":
            dependent,_=package(inputs,"dependent",id="dependent",dependencies={"natural-npc":"1.0.0"})
            conflicting,_=package(inputs,"conflicting",id="conflicting",conflicts=["natural-npc"])
            client.ok("mods.install",{"path":str(dependent)}); client.ok("mods.install",{"path":str(conflicting)}); create(client)
            client.ok("mods.order",{"campaign":"c1","order":["natural-npc","dependent","conflicting","enhanced-items"]})
            client.ok("mods.configure",{"campaign":"c1","id":"dependent","enabled":True})
            client.err("mods.configure",{"campaign":"c1","id":"conflicting","enabled":True})
            client.err("mods.configure",{"campaign":"c1","id":"natural-npc","enabled":False})
            client.err("mods.order",{"campaign":"c1","order":["dependent","natural-npc","conflicting","enhanced-items"]})
            client.ok("mods.order",{"campaign":"c1","order":["natural-npc","dependent","conflicting","enhanced-items"]})
            client.ok("mods.context",{"campaign":"c1"})
        elif scenario == "existing-objects":
            from coc.mods.objects import define, move
            from test_mods import weapon
            create(client)
            world=json.loads(world_path.read_text())
            definition=weapon("Accepted rifle"); definition["parameters"].pop("adds_damage_bonus")
            define(world,definition,{"source":"retained fixture"})
            sheet=json.loads((workspace/".coc/campaigns/c1/party/thomas-hayes.json").read_text())
            item=move(world,"Accepted rifle","Accepted rifle",{"kind":"investigator","id":sheet["id"],"name":sheet["name"]},source=None,turn=0)
            item["state"].update(ammo=0,condition="jammed")
            definitions=copy.deepcopy(world["objects"]["definitions"])
            write_json(world_path,world)
            client.ok("mods.configure",{"campaign":"c1","id":"enhanced-items","enabled":False})
            mirrored=json.loads((workspace/".coc/campaigns/c1/party/thomas-hayes.json").read_text())
            assert next(row for row in mirrored["weapons"] if row.get("object_id"))["ammo"]==0
            assert json.loads(world_path.read_text())["objects"]["definitions"]==definitions
            client.ok("mods.context",{"campaign":"c1"})
            client.ok("table.view",{"campaign":"c1"})
        else:
            raise AssertionError(scenario)
        exchanges.extend(client.exchanges)
    finally:
        client.close()
    result={"exchanges":exchanges,"checkpoints":checkpoints,"state":state(workspace)}
    write_json(root/f"{label}.json",result)
    workspace.rename(root/f"{label}-workspace"); inputs.rename(root/f"{label}-inputs")
    return result


@pytest.mark.parametrize("scenario",["unbound-defaults","accepted-codecs","negative-archives","immutable-and-incompatible","settings-and-pending","migrations","dependencies","existing-objects"])
def test_mod_management_matches_python(scenario):
    root=retained(scenario)
    reference=observe(root,"python",python_command(),scenario)
    candidate=observe(root,"typescript",candidate_command(),scenario)
    findings=differences(reference,candidate)
    write_json(root/"comparison.json",{"equal":not findings,"differences":findings})
    assert not findings, f"retained evidence {root}\n"+"\n".join(findings)


def test_emitted_mod_checker_reuses_validation_without_kernel_or_state_writes():
    from test_mods import weapon
    root=retained("host-check")
    home=root/"home"; home.mkdir()
    for name, value in [("weapon",weapon()), ("document",{"name":"Notebook","category":"item","description":"Paper.","basis":"A fixture.","parameters":{"effects":[]},"document":{"text":"\U0001f3b2"*64000,"presentation":"notebook"},"player_view":{"description":"Notes.","fields":[]}}),
                        ("bad",{"name":"incomplete"})]:
        draft=root/f"{name}.json"; write_json(draft,value); before=draft.read_bytes()
        reference=subprocess.run([sys.executable,"-m","coc.mods.check",str(draft)],cwd=ROOT,env={**os.environ,"PYTHONPATH":str(ROOT/"kernel")},capture_output=True,text=True,timeout=15)
        env={**os.environ,"PATH":"", "PI_COC_HOME":str(home),"PI_COC_RUNTIME_OPTIONS":json.dumps({"backend":"typescript","resourceRoot":str(ROOT),"contentRoot":str(ROOT/"content"),"nodeExecutable":shutil.which("node")})}
        candidate=subprocess.run([shutil.which("node"),str(ROOT/"build/runtime/check.mjs"),"--kind","mod-definition","--draft",str(draft)],cwd=ROOT,env=env,capture_output=True,text=True,timeout=15)
        result={"python":{"code":reference.returncode,"response":json.loads(reference.stdout)},"typescript":{"code":candidate.returncode,"response":json.loads(candidate.stdout)}}
        write_json(root/f"{name}-comparison.json",result)
        assert result["python"]==result["typescript"],result
        assert draft.read_bytes()==before
    assert not (home/".coc").exists()
