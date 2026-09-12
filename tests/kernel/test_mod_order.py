"""Saved ordering selects real providers, including old-name replacements."""
import json
import shutil
from pathlib import Path

from conftest import CAMPAIGN, WORKTREE, campaign_dir, create_campaign, narrate, read_json
from test_mods import weapon


def shipped_version(mod):
    """The version this tree ships. Pinned as a literal, a dependency fixture broke on every bump
    of the mod it depends on, which says nothing about whether dependencies are honoured."""
    return read_json(WORKTREE/"mods"/mod/"mod.json")["version"]


def alternate(kernel, tmp_path, source, name, **changes):
    root=tmp_path/name
    shutil.copytree(WORKTREE/"mods"/source,root)
    manifest=read_json(root/"mod.json")
    manifest.pop("ui",None)
    manifest.update(id=name,name=name,default_enabled=False,**changes)
    if source=="natural-npc":
        manifest["contributes"]["checks"][0]["difficulty"]="extreme"
    else:
        manifest["contributes"]["document_editor"]={"renderer":"plain"}
        (root/"creator.md").write_text("Alternate item provider. Use the supplied typed interface.")
    (root/"mod.json").write_text(json.dumps(manifest))
    kernel.ok("mods.install",{"path":str(root)})
    return manifest


def test_later_named_rule_changes_execution_and_earlier_policy_is_suppressed(kernel,tmp_path):
    alternate(kernel,tmp_path,"natural-npc","npc-overhaul")
    create_campaign(kernel)
    kernel.ok("mods.configure",{"campaign":CAMPAIGN,"id":"npc-overhaul","enabled":True})
    later=["guided-creation","enhanced-items","natural-npc","npc-overhaul","keeper-pacing","narration-audit","narration-craft","story-thread"]
    kernel.ok("mods.order",{"campaign":CAMPAIGN,"order":later})
    context=kernel.ok("mods.context",{"campaign":CAMPAIGN})
    assert "natural-npc" not in [r["mod"] for r in context["instructions"]]
    action={"intent":"social","decision":"natural-npc:first-impression","target":"Steven Knott","goal":"Introduce myself"}
    first=kernel.table("resolve",call_id="t0-c1",action=action)
    assert first["outcome"]["difficulty"]=="extreme"
    earlier=["guided-creation","enhanced-items","npc-overhaul","natural-npc","keeper-pacing","narration-audit","narration-craft","story-thread"]
    pending=kernel.ok("mods.order",{"campaign":CAMPAIGN,"order":earlier})
    assert pending["pending_order"]==earlier and pending["order"]==later
    narrate(kernel,"t0-c2","诺特打量了我一眼。")
    kernel.table("player_input",text="我继续说下去。")
    assert kernel.ok("mods.list",{"campaign":CAMPAIGN})["providers"]["check:natural-npc:first-impression"][-1]=="natural-npc"
    again=kernel.table("resolve",call_id="t1-c1",action=action)
    assert again["reused"] and again["outcome"]==first["outcome"]
    create_campaign(kernel,"other")
    kernel.ok("mods.configure",{"campaign":"other","id":"npc-overhaul","enabled":True})
    kernel.ok("mods.order",{"campaign":"other","order":earlier})
    original=kernel.ok("table.resolve",{"campaign":"other","call_id":"t0-c1","action":action})
    assert original["outcome"]["difficulty"]=="regular"


def test_materializer_and_editor_follow_order_and_stale_job_is_rejected(kernel,tmp_path):
    alternate(kernel,tmp_path,"enhanced-items","item-overhaul")
    create_campaign(kernel)
    kernel.ok("mods.configure",{"campaign":CAMPAIGN,"id":"item-overhaul","enabled":True})
    kernel.ok("mods.order",{"campaign":CAMPAIGN,"order":["guided-creation","enhanced-items","natural-npc","item-overhaul","keeper-pacing","narration-audit","narration-craft","story-thread"]})
    context=kernel.ok("mods.context",{"campaign":CAMPAIGN})
    assert context["providers"]["materializer"]==["enhanced-items","item-overhaul"]
    assert "enhanced-items" not in [r["mod"] for r in context["instructions"]]
    job=kernel.ok("mods.job",{"campaign":CAMPAIGN,"role":"create","input":{"name":"Launcher","category":"weapon","description":"Fixture"}})
    assert Path(job["system_prompt"]).read_text().startswith("Alternate item provider")
    Path(job["cwd"],"result.json").write_text(json.dumps(weapon("Launcher")))
    audit=kernel.ok("mods.job",{"campaign":CAMPAIGN,"role":"audit","input":{"text":"The room is quiet."}})
    providers=read_json(Path(audit["cwd"])/"identity.json")["packages"]
    assert [r["id"] for r in providers]==["item-overhaul","narration-audit"]
    kernel.ok("mods.order",{"campaign":CAMPAIGN,"order":["guided-creation","item-overhaul","natural-npc","enhanced-items","keeper-pacing","narration-audit","narration-craft","story-thread"]})
    error=kernel.err("mods.accept",{"campaign":CAMPAIGN,"job":job["job"]})
    assert "effective Mod provider" in error["message"]
    assert not read_json(campaign_dir(kernel.workspace)/"world.json").get("objects")


def test_dependencies_and_default_order_are_preserved(kernel,tmp_path):
    alternate(kernel,tmp_path,"natural-npc","npc-overhaul",dependencies={"natural-npc":shipped_version("natural-npc")})
    create_campaign(kernel)
    kernel.ok("mods.configure",{"campaign":CAMPAIGN,"id":"npc-overhaul","enabled":True})
    prior=read_json(campaign_dir(kernel.workspace)/"world.json")
    assert kernel.err("mods.order",{"campaign":CAMPAIGN,"order":["guided-creation","npc-overhaul","natural-npc","enhanced-items","keeper-pacing","narration-audit","narration-craft","story-thread"]})["code"]=="invalid_params"
    assert read_json(campaign_dir(kernel.workspace)/"world.json")==prior
    order=["guided-creation","natural-npc","enhanced-items","npc-overhaul","keeper-pacing","narration-audit","narration-craft","story-thread"]
    kernel.ok("mods.order",{"order":order})
    create_campaign(kernel,"second")
    assert kernel.ok("mods.list",{"campaign":"second"})["order"]==order


def test_an_observer_can_explicitly_replace_an_existing_audit_slot(kernel,tmp_path):
    root=tmp_path/"audit-overhaul"
    shutil.copytree(WORKTREE/"mods"/"enhanced-items",root)
    manifest=read_json(root/"mod.json")
    manifest.pop("ui",None)
    manifest.update(id="audit-overhaul",name="Audit overhaul",default_enabled=False,
                    contributes={"auditor":"auditor.md","audit_slot":"enhanced-items"})
    (root/"mod.json").write_text(json.dumps(manifest))
    kernel.ok("mods.install",{"path":str(root)})
    create_campaign(kernel)
    kernel.ok("mods.configure",{"campaign":CAMPAIGN,"id":"audit-overhaul","enabled":True})
    kernel.ok("mods.order",{"campaign":CAMPAIGN,"order":["guided-creation","enhanced-items","natural-npc","audit-overhaul","keeper-pacing","narration-audit","narration-craft","story-thread"]})
    job=kernel.ok("mods.job",{"campaign":CAMPAIGN,"role":"audit","input":{"text":"The room is quiet."}})
    identity=read_json(Path(job["cwd"])/"identity.json")
    assert [r["id"] for r in identity["packages"]]==["audit-overhaul","narration-audit"]
