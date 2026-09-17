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


def test_the_start_scene_seats_its_own_cast_before_any_other_scene_claims_them(kernel, tmp_path):
    """A book puts people in several scenes; only one of them gets to hold each name.

    Masks lists Larkin, de Mendoza and Elias in Start: Lima, but Hotel España and the Museo come
    earlier in the graph, and first-wins gave all three away. The campaign opened in Start: Lima
    with nobody in it: `look` answered `present: []`, the first-impression roll had no target, and
    the opening turn may not change state, so the Keeper could not put them back. The prologue
    meanwhile described the three of them seated at the table.
    """
    mid, guidance_job, _, _, _ = seed(kernel, tmp_path)
    assert finish(kernel, guidance_job)["setup_ready"]
    request(kernel, mid, "opening")
    job = claim(kernel, mid)
    assert job["purpose"] == "opening"
    observed(job)
    refs = [{"page": 1}]
    # The shape that broke. An assembled graph sorts its nodes by node_id, so `scene-attic` is
    # read before `scene-dock` for no reason but the letter, and under first-wins it took Lena --
    # exactly how `scene-hotel-espana` and `scene-museo-de-arqueologia` took Larkin, de Mendoza and
    # Elias off `scene-start-lima`, the scene their own campaign opens in.
    nodes = [
        {"node_id": "scene-dock", "node_kind": "scene", "name": "Dock", "source_refs": refs,
         "properties": {"is_entrance": True}},
        {"node_id": "scene-attic", "node_kind": "scene", "name": "Attic", "source_refs": [{"page": 2}],
         "summary": "A loft over the harbor.", "properties": {"is_final": True}},
        {"node_id": "npc-lena", "node_kind": "npc", "name": "Lena", "source_refs": refs,
         "properties": {"mechanics": {"profile": {"characteristics": {"STR": 50}}}}}]
    claims = [{"subject_id": a, "predicate": r, "object": {"node_id": b}, "truth_status": "authored-fact", "source_refs": refs}
              for a, r, b in [("scene-dock", "route-to", "scene-attic"),
                              ("npc-lena", "present-in", "scene-attic"),
                              ("npc-lena", "present-in", "scene-dock")]]
    paths = ["/nodes/0", "/nodes/1", "/nodes/2", "/nodes/2/properties/mechanics/profile/characteristics/STR",
             "/claims/0", "/claims/1", "/claims/2", "/coverage"]
    write(Path(job["work_dir"]) / "draft.json", {"nodes": nodes, "claims": claims, "node_refs": [],
        "coverage": {}, "dependencies": [], "critical": [], "ready_nodes": ["scene-dock", "npc-lena"]})
    write(Path(job["work_dir"]) / "review.json", {"missing": [],
        "checked": [{"path": p, "verdict": "supported", "source_refs": refs, "reason": "fixture support"} for p in paths]})
    finish(kernel, job)

    kernel.ok("campaign.create", {"id": "seated", "module": mid, "guidance_key": KEY, "play_language": "en"})
    kernel.ok("setup.prologue", {"campaign": "seated", "scene": "Dock", "text": "Who are you?"})
    confirmed_investigator(kernel, "seated")
    kernel.ok("setup.complete", {"campaign": "seated"})
    world = json.loads((kernel.workspace / ".coc/campaigns/seated/world.json").read_text())
    assert world["active_scene"] == "dock"
    # `scene-attic` sorts first and lists her too; the start scene still seats her, because it is
    # the one scene the table is certainly in.
    assert world["npc_presence"]["lena"] == "dock"


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


def test_authored_era_prose_uses_the_rulebook_default_without_losing_the_setting(kernel, tmp_path):
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
    sheet = kernel.ok("setup.draft",request)["sheet"]
    assert sheet["era"] == "1920s"
    assert sheet["setting_era"] == "An expedition in March 1921"
    assert sheet["finance"]["source"] == "cash-assets.periods.1920s"
    assert sheet["finance"]["substituted_for"] == "An expedition in March 1921"
