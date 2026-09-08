"""Early source acceptance and final opening gate; deterministic seams only."""
import copy
import hashlib
import json
from pathlib import Path

from module_helpers import bind, request, claim, observed, write, finish, opening
from setup_helpers import confirmed_investigator

KEY = "a" * 64


def seed(client, tmp_path):
    mid, _ = bind(client, tmp_path)
    request(client, mid, "guidance", guidance_key=KEY, play_language="en", occupations=[])
    job = claim(client, mid)
    observed(job)
    work = Path(job["work_dir"])
    draft = {"nodes": [{"node_id": "scene-dock", "node_kind": "scene", "name": "Dock",
        "source_refs": [{"page": 1}], "properties": {"is_entrance": True}}],
        "claims": [], "node_refs": [], "coverage": {}, "dependencies": [], "critical": [], "ready_nodes": []}
    guidance = {"opening": "At the dock, who are you?", "advice": "Public source premise.",
                "scene": "Dock", "guide": "", "handoff": "Continue the meeting."}
    write(work / "draft.json", draft)
    write(work / "guidance.json", guidance)
    review = {"checked": [{"path": "/nodes/0", "source_refs": [{"page": 1}], "verdict": "supported"}], "missing": [],
        "guidance": {"approved": True, "issues": [],
            "draft_sha256": hashlib.sha256((work / "draft.json").read_bytes()).hexdigest(),
            "guidance_sha256": hashlib.sha256((work / "guidance.json").read_bytes()).hexdigest()}}
    write(work / "review.json", review)
    return mid, job, draft, guidance, review


def refuse(client, job):
    work = Path(job["work_dir"])
    return client.err("module.read.finish", {"module_id": job["module_id"], "job_id": job["job_id"],
        "lease": job["lease"], "outcome": "completed", "draft_path": str(work / "draft.json"),
        "review_path": str(work / "review.json")})


def test_guidance_opens_setup_but_not_world_or_play_and_preserves_confirmation(kernel, tmp_path):
    mid, job, _, _, _ = seed(kernel, tmp_path)
    assert finish(kernel, job)["setup_ready"]
    assert not kernel.ok("module.status", {"module_id": mid})["opening_ready"]
    kernel.ok("campaign.create", {"id": "early", "module": mid, "guidance_key": KEY, "play_language": "en"})
    directory = kernel.workspace / ".coc/campaigns/early"
    assert not (directory / "world.json").exists()
    mods = kernel.ok("mods.list", {"campaign":"early"})
    assert any(r["id"] == "natural-npc" for r in mods["mods"])
    kernel.ok("mods.configure", {"campaign":"early", "id":"natural-npc", "enabled":False})
    kernel.ok("setup.prologue", {"campaign": "early", "scene": "Dock", "text": "Who are you?"})
    confirmed = confirmed_investigator(kernel, "early")
    error = kernel.err("setup.complete", {"campaign": "early"})
    assert error["details"]["reason"] == "opening_preparing"
    assert not (directory / "world.json").exists()
    ready_job, _, _ = opening(kernel, mid)
    finish(kernel, ready_job)
    result = kernel.ok("setup.complete", {"campaign": "early"})
    assert result["prologue"]["opening"] == "Who are you?"
    world = json.loads((directory / "world.json").read_text())
    assert world["npc_presence"]["lena"] == "dock"
    meta = json.loads((directory / "campaign.json").read_text())
    assert meta["setup"]["confirmed_revision"] == confirmed["revision"]
    assert kernel.ok("setup.complete", {"campaign": "early"})["replayed"]
    kernel.ok("table.open", {"campaign":"early"})
    mods = kernel.ok("mods.list", {"campaign":"early"})
    assert next(r for r in mods["mods"] if r["id"] == "natural-npc")["active"]["enabled"] is False
    reused = request(kernel, mid, "guidance", guidance_key=KEY, play_language="en", occupations=[])
    assert reused["setup_ready"] and reused["generation"] == 2


def test_review_binds_both_files_and_requires_source_support(kernel, tmp_path):
    mid, job, draft, guidance, review = seed(kernel, tmp_path)
    work = Path(job["work_dir"])
    write(work / "guidance.json", {**guidance, "opening": "Altered after review"})
    assert "exact" in refuse(kernel, job)["message"]
    assert kernel.ok("module.status", {"module_id": mid})["generation"] == 0
    write(work / "guidance.json", guidance)
    bad = copy.deepcopy(review)
    bad["checked"] = []
    write(work / "review.json", bad)
    assert "omitted" in refuse(kernel, job)["message"]
    write(work / "review.json", review)
    draft["ready_nodes"] = ["scene-dock"]
    write(work / "draft.json", draft)
    assert "cannot grant" in refuse(kernel, job)["message"]


def test_campaign_cannot_pin_an_unaccepted_or_different_language_guidance(kernel, tmp_path):
    mid, job, _, _, _ = seed(kernel, tmp_path)
    params = {"id": "early", "module": mid, "guidance_key": KEY, "play_language": "en"}
    assert "not been accepted" in kernel.err("campaign.create", params)["message"]
    finish(kernel, job)
    assert "not been accepted" in kernel.err("campaign.create", {**params, "play_language": "zh-Hans"})["message"]


def test_explicit_opening_does_not_reuse_another_prepared_scene(kernel, tmp_path):
    mid, job, draft, _, review = seed(kernel, tmp_path)
    finish(kernel, job)
    ready, _, _ = opening(kernel, mid)
    finish(kernel, ready)
    result = request(kernel, mid, "opening", focus="Another entrance", foreground=True)
    assert result["state"] == "queued"
    assert claim(kernel, mid)["focus"] == "Another entrance"


def test_ambiguous_guidance_publishes_choices_without_authorizing_character_creation(kernel, tmp_path):
    mid, job, draft, _, review = seed(kernel, tmp_path)
    work = Path(job["work_dir"])
    draft["nodes"].append({"node_id":"scene-garden", "node_kind":"scene", "name":"Garden",
        "source_refs":[{"page":2}], "properties":{"is_entrance":True}})
    write(work / "draft.json", draft)
    write(work / "guidance.json", {"needs_choice":True})
    review["checked"].append({"path":"/nodes/1", "source_refs":[{"page":2}], "verdict":"supported"})
    review["guidance"].update(draft_sha256=hashlib.sha256((work/"draft.json").read_bytes()).hexdigest(),
                             guidance_sha256=hashlib.sha256((work/"guidance.json").read_bytes()).hexdigest())
    write(work / "review.json", review)
    result = finish(kernel, job)
    assert result["state"] == "blocked" and not result["setup_ready"]
    retry = request(kernel, mid, "guidance", guidance_key=KEY, play_language="en", occupations=[])
    assert len(retry["opening"]["choice"]["candidates"]) == 2


def test_authored_era_prose_requires_model_selection_of_a_supported_rulebook_period(kernel, tmp_path):
    from test_setup_drafts import profile
    mid, job, draft, _, review = seed(kernel, tmp_path)
    work = Path(job["work_dir"])
    draft["nodes"][0]["properties"]["investigator_setup"] = {"era":"An expedition in March 1921"}
    write(work / "draft.json",draft)
    review["guidance"]["draft_sha256"] = hashlib.sha256((work/"draft.json").read_bytes()).hexdigest()
    write(work / "review.json",review)
    finish(kernel, job)
    kernel.ok("campaign.create",{"id":"era-choice","module":mid,"guidance_key":KEY,"play_language":"en"})
    request = {"campaign":"era-choice","profile":profile()}
    error = kernel.err("setup.draft",request)
    assert error["details"]["source_era"] == "An expedition in March 1921"
    assert "1920s" in error["details"]["options"]
    result = kernel.ok("setup.draft",{**request,"profile":{**profile(),"era":"1920s"}})
    assert result["sheet"]["finance"]
