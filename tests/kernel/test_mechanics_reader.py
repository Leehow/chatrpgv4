"""Contract §136.20 at publication: a reader's mechanical shapes reach the module graph only whole and reviewed.

Through the emitted kernel's `module.read.finish`, the one publication entry, at the deterministic source
seam (`module_helpers`): never a PDF read and never gameplay acceptance. The draft is the JSON a reader writes.
"""
import copy
from pathlib import Path

from coc.modules.store import ModuleStore
from module_helpers import write, request, claim, finish, observed, indexed, opening

REFS = [{"page": 2}]
HAZARD = {"trigger": {"kind": "keeper"}, "steps": [
    {"scope": "actor", "values": [{"path": "characteristics.Luck", "label": "Luck"}], "selection": "maximum",
     "difficulty_unstated": True, "results": {"failure": {"effects": [{"kind": "next_step", "step": 1}]}}},
    {"scope": "actor", "values": [{"path": "skills.Jump", "label": "Jump"}], "selection": "maximum",
     "difficulty_unstated": True, "results": {"failure": {"effects": [{"kind": "damage", "dice": "1D6"}]}}}]}


def leaves(value, path):
    if isinstance(value, dict):
        return [p for key, item in value.items() for p in leaves(item, f"{path}/{key}")] or [path]
    if isinstance(value, list):
        return [p for i, item in enumerate(value) for p in leaves(item, f"{path}/{i}")] or [path]
    return [path]


def detail(kernel, tmp_path, mechanics):
    mid, _ = indexed(kernel, tmp_path)
    job, _, _ = opening(kernel, mid)
    finish(kernel, job)
    request(kernel, mid, "detail", focus="Tower", question="What happens on the tower stairs?")
    job = claim(kernel, mid)
    draft = {"nodes": [{"node_id": "rule-tower-stairs", "node_kind": "rule", "name": "Tower stairs",
                        "summary": "The rotten stairs give way.", "source_refs": REFS, "properties": {"mechanics": mechanics}}],
             "claims": [{"subject_id": "scene-tower", "predicate": "uses-rule", "object": {"node_id": "rule-tower-stairs"},
                         "truth_status": "authored-fact", "source_refs": REFS}],
             "node_refs": ["scene-tower"], "coverage": {}, "dependencies": [], "critical": [], "ready_nodes": ["rule-tower-stairs"]}
    write(Path(job["work_dir"]) / "draft.json", draft)
    observed(job, read_pages=[2], review_pages=[2])
    return mid, job, draft


def review(paths):
    return {"checked": [{"paths": paths, "verdict": "supported", "source_refs": REFS, "reason": "fixture support"}], "missing": []}


def params(job):
    return {"module_id": job["module_id"], "job_id": job["job_id"], "lease": job["lease"], "outcome": "completed",
            "draft_path": str(Path(job["work_dir"]) / "draft.json"), "review_path": str(Path(job["work_dir"]) / "review.json")}


def test_a_stated_hazard_publishes_only_when_every_shape_leaf_is_reviewed(kernel, tmp_path):
    mechanics = {"hazard": HAZARD, "damage": {"dice": "1D4+2"}}
    mid, job, draft = detail(kernel, tmp_path, mechanics)
    shape = leaves(mechanics, "/nodes/0/properties/mechanics")
    everything = ["/nodes/0", "/claims/0", "/coverage", *shape]
    dice = "/nodes/0/properties/mechanics/damage/dice"
    assert dice in shape and "/nodes/0/properties/mechanics/hazard/steps/1/difficulty_unstated" in shape
    # A review that supports everything but one dice string: nothing publishes.
    write(Path(job["work_dir"]) / "review.json", review([p for p in everything if p != dice]))
    error = kernel.err("module.read.finish", params(job))
    assert "omitted" in error["message"] and dice in error["message"]
    assert kernel.ok("module.status", {"module_id": mid})["generation"] == 1
    write(Path(job["work_dir"]) / "review.json", review(everything))
    assert finish(kernel, job)["generation"] == 2
    graph = ModuleStore(kernel.workspace).read_graph(mid)
    node = next(n for n in graph["nodes"] if n["node_id"] == "rule-tower-stairs")
    assert node["properties"]["mechanics"] == mechanics


def test_a_dice_string_with_words_is_refused_at_publication_with_its_path_and_rule(kernel, tmp_path):
    mechanics = {"hazard": copy.deepcopy(HAZARD), "damage": {"dice": "1D4+2 hit points"}}
    mid, job, _ = detail(kernel, tmp_path, mechanics)
    write(Path(job["work_dir"]) / "review.json", review(["/nodes/0", "/claims/0", "/coverage", *leaves(mechanics, "/nodes/0/properties/mechanics")]))
    error = kernel.err("module.read.finish", params(job))
    assert error["code"] == "invalid_params"
    assert error["details"]["rule"] == "shape_dice"
    assert error["details"]["path"] == "/nodes/0/properties/mechanics/damage/dice"
    assert kernel.ok("module.status", {"module_id": mid})["generation"] == 1


def test_a_shape_citing_a_page_the_reader_did_not_view_is_refused_at_publication(kernel, tmp_path):
    mechanics = {"damage": {"dice": "1D6"}}
    mid, job, draft = detail(kernel, tmp_path, mechanics)
    draft["nodes"][0]["source_refs"] = [{"page": 2}, {"page": 1}]
    write(Path(job["work_dir"]) / "draft.json", draft)
    write(Path(job["work_dir"]) / "review.json", review(["/nodes/0", "/claims/0", "/coverage", *leaves(mechanics, "/nodes/0/properties/mechanics")]))
    observed(job, read_pages=[2], full_pages=[2], review_pages=[2])
    error = kernel.err("module.read.finish", params(job))
    assert error["details"]["rule"] == "mechanics_unsourced"
    assert error["details"]["path"] == "/nodes/0/source_refs/1"
