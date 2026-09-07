"""Source/reading RPC acceptance at the deterministic seam, never a fake game."""
import copy
import hashlib
import json
import random
from pathlib import Path

import pytest

from conftest import CONTENT_DIR, RpcClient
from coc.errors import RpcError
from coc.store import Store
from coc.table import Table
from coc.modules.store import ModuleStore


def write(path, value):
    Path(path).write_text(json.dumps(value), encoding="utf-8")


def bind(client, tmp_path):
    path = tmp_path / "original.pdf"
    path.write_bytes(b"%PDF-1.7\nsynthetic transport fixture; not rendered or played\n")
    source = {"path": str(path), "file_sha256": hashlib.sha256(path.read_bytes()).hexdigest(), "page_count": 2}
    result = client.ok("module.source.bind", {"source": source})
    return result["module_id"], source


def request(client, mid, purpose, **kwargs):
    return client.ok("module.read.request", {"module_id": mid, "purpose": purpose, **kwargs})


def claim(client, mid):
    return client.ok("module.read.claim", {"module_id": mid, "owner": "test-host"})


def finish(client, job, **kwargs):
    return client.ok("module.read.finish", {"module_id": job["module_id"], "job_id": job["job_id"],
        "lease": job["lease"], "outcome": "completed", "draft_path": str(Path(job["work_dir"]) / "draft.json"),
        "review_path": str(Path(job["work_dir"]) / "review.json"), **kwargs})


def observed(job, **kwargs):
    write(Path(job["work_dir"]) / "observations.json", {"file_sha256": job["source"]["file_sha256"],
        "read_pages": [1, 2], "full_pages": [1, 2], "review_pages": [1, 2], **kwargs})


def indexed(client, tmp_path):
    mid, source = bind(client, tmp_path)
    request(client, mid, "opening")
    job = claim(client, mid)
    assert job["purpose"] == "index"
    observed(job)
    write(Path(job["work_dir"]) / "draft.json", {"title": "The Harbor", "language": "en", "sections": [
        {"name": "The harbor and the tower", "pages": [[1, 2]], "topics": ["opening"], "entities": ["Dock", "Tower", "Lena"], "references": []}]})
    finish(client, job)
    return mid, source


def opening(client, mid):
    request(client, mid, "opening")
    job = claim(client, mid)
    assert job["purpose"] == "opening"
    observed(job)
    refs = [{"page": 1}]
    nodes = [
        {"node_id": "scene-dock", "node_kind": "scene", "name": "Dock", "source_refs": refs,
         "properties": {"is_entrance": True}},
        {"node_id": "scene-tower", "node_kind": "scene", "name": "Tower", "source_refs": [{"page": 2}],
         "properties": {"is_final": True}},
        {"node_id": "npc-lena", "node_kind": "npc", "name": "Lena", "source_refs": refs,
         "properties": {"mechanics": {"profile": {"characteristics": {"STR": 50}}}}}]
    claims = [{"subject_id": a, "predicate": r, "object": {"node_id": b}, "truth_status": "authored-fact", "source_refs": refs}
              for a, r, b in [("scene-dock", "route-to", "scene-tower"), ("npc-lena", "present-in", "scene-dock")]]
    draft = {"nodes": nodes, "claims": claims, "node_refs": [], "coverage": {}, "dependencies": [],
             "critical": [], "ready_nodes": ["scene-dock", "npc-lena"]}
    paths = ["/nodes/0", "/nodes/2", "/nodes/2/properties/mechanics/profile/characteristics/STR", "/claims/0", "/claims/1"]
    review = {"checked": [{"path": p, "verdict": "supported", "source_refs": refs, "reason": "fixture support"} for p in paths], "missing": []}
    write(Path(job["work_dir"]) / "draft.json", draft)
    write(Path(job["work_dir"]) / "review.json", review)
    return job, draft, review


def test_binding_checks_bytes_and_reuses_the_exact_source(kernel, tmp_path):
    mid, source = bind(kernel, tmp_path)
    assert kernel.ok("module.source.bind", {"source": source}) == {"module_id": mid, "replayed": True}
    wrong = {**source, "file_sha256": "0" * 64}
    assert kernel.err("module.source.bind", {"source": wrong})["code"] == "invalid_params"
    assert (kernel.workspace / ".coc" / "modules" / mid / "source.pdf").read_bytes() == Path(source["path"]).read_bytes()


def test_indexing_requires_actual_full_page_observation(kernel, tmp_path):
    mid, _ = bind(kernel, tmp_path)
    request(kernel, mid, "index")
    job = claim(kernel, mid)
    observed(job, full_pages=[1])
    write(Path(job["work_dir"]) / "draft.json", {"sections": [{"name": "Book", "pages": [[1, 2]]}]})
    error = kernel.err("module.read.finish", {"module_id": mid, "job_id": job["job_id"], "lease": job["lease"],
        "outcome": "completed", "draft_path": str(Path(job["work_dir"]) / "draft.json")})
    assert "not viewed" in error["message"]
    assert not kernel.ok("module.status", {"module_id": mid})["reading"]["index_complete"]


def test_review_requires_numerical_support_before_atomic_publication(kernel, tmp_path):
    mid, _ = indexed(kernel, tmp_path)
    job, draft, review = opening(kernel, mid)
    missing = copy.deepcopy(review)
    missing["checked"] = [r for r in missing["checked"] if r["path"] != "/nodes/2/properties/mechanics/profile/characteristics/STR"]
    write(Path(job["work_dir"]) / "review.json", missing)
    params = {"module_id": mid, "job_id": job["job_id"], "lease": job["lease"], "outcome": "completed",
        "draft_path": str(Path(job["work_dir"]) / "draft.json"), "review_path": str(Path(job["work_dir"]) / "review.json")}
    assert "omitted" in kernel.err("module.read.finish", params)["message"]
    assert kernel.ok("module.status", {"module_id": mid})["generation"] == 0
    write(Path(job["work_dir"]) / "review.json", review)
    result = finish(kernel, job)
    assert result["opening_ready"] is True and result["generation"] == 1
    assert finish(kernel, job)["replayed"] is True
    store = ModuleStore(kernel.workspace)
    assert "generations" in str(store.graph_path(mid))
    graph = store.read_graph(mid)
    assert next(n for n in graph["nodes"] if n["node_id"] == "npc-lena")["source_refs"] == [{"source_id": f"pdf:{mid}", "pdf_index": 0}]


def test_existing_material_does_not_swallow_a_new_question(kernel, tmp_path):
    mid, _ = indexed(kernel, tmp_path)
    job, _, _ = opening(kernel, mid)
    finish(kernel, job)
    assert request(kernel, mid, "detail", focus="Lena")["state"] == "ready"
    first = request(kernel, mid, "detail", focus="Lena", question="Who does she owe money to?")
    assert first["state"] == "queued"
    assert request(kernel, mid, "detail", focus="Lena", question="Who does she owe money to?")["job_id"] == first["job_id"]
    assert request(kernel, mid, "detail", focus="Lena", question="What does she know of the tower?")["job_id"] != first["job_id"]


def test_two_kernel_sessions_cannot_claim_the_same_job(kernel, tmp_path):
    mid, _ = indexed(kernel, tmp_path)
    request(kernel, mid, "opening")
    job = claim(kernel, mid)
    other = RpcClient(kernel.workspace)
    try:
        assert claim(other, mid) == {"job_id": None}
        finish(kernel, job, outcome="cancelled")
        assert request(other, mid, "opening")["state"] == "blocked"
        request(other, mid, "opening", retry=True)
        next_job = claim(other, mid)
        assert next_job["job_id"] != job["job_id"]
        finish(other, next_job, outcome="cancelled")
    finally:
        other.close()


def test_material_preflight_precedes_the_whole_effect_batch_and_rng(kernel, tmp_path):
    mid, _ = indexed(kernel, tmp_path)
    job, _, _ = opening(kernel, mid)
    finish(kernel, job)
    kernel.ok("campaign.create", {"id": "c1", "module": mid, "play_language": "en"})
    kernel.ok("setup.investigator", {"campaign": "c1", "name": "Ada", "occupation": "Journalist"})
    kernel.ok("setup.complete", {"campaign": "c1"})
    kernel.table("open")
    kernel.table("narrate", call_id="t0-c1", text="The harbor waits.")
    kernel.table("player_input", text="I go to the tower.")
    directory = kernel.workspace / ".coc" / "campaigns" / "c1"
    before = {f: (directory / f).read_bytes() for f in ("world.json", "turn.json")}
    rng = random.Random(42)
    table = Table(Store(kernel.workspace), CONTENT_DIR, rng, seed_locked=True)
    rng_before = rng.getstate()
    with pytest.raises(RpcError) as exc:
        table.apply({"campaign": "c1", "call_id": "t1-c1", "effects": [
            {"kind": "damage", "cause": "fall"}, {"kind": "move", "to": "Tower"}]})
    assert exc.value.to_json()["details"]["reason"] == "material_pending"
    assert rng.getstate() == rng_before
    assert {f: (directory / f).read_bytes() for f in before} == before


def test_a_reference_alone_cannot_promote_a_thin_node_to_ready(kernel, tmp_path):
    mid, _ = indexed(kernel, tmp_path)
    job, _, _ = opening(kernel, mid)
    finish(kernel, job)
    request(kernel, mid, "detail", focus="Tower")
    job = claim(kernel, mid)
    observed(job)
    write(Path(job["work_dir"]) / "draft.json", {"nodes": [], "claims": [], "node_refs": ["scene-tower"],
        "coverage": {}, "dependencies": [], "critical": [], "ready_nodes": ["scene-tower"]})
    write(Path(job["work_dir"]) / "review.json", {"checked": [], "missing": []})
    err = kernel.err("module.read.finish", {"module_id": mid, "job_id": job["job_id"], "lease": job["lease"],
        "outcome": "completed", "draft_path": str(Path(job["work_dir"]) / "draft.json"),
        "review_path": str(Path(job["work_dir"]) / "review.json")})
    assert "independently reviewed" in err["message"]
    assert kernel.ok("module.status", {"module_id": mid})["generation"] == 1


def test_registration_does_not_overwrite_an_interrupted_source_copy(kernel, tmp_path):
    reserved = kernel.workspace / ".coc" / "modules" / "book-1"
    reserved.mkdir(parents=True)
    (reserved / "source.pdf").write_bytes(b"interrupted copy")
    mid, _ = bind(kernel, tmp_path)
    assert mid == "book-2"
    assert (reserved / "source.pdf").read_bytes() == b"interrupted copy"


def test_grouped_review_still_names_every_required_numeric_field(kernel, tmp_path):
    mid, _ = indexed(kernel, tmp_path)
    job, _, review = opening(kernel, mid)
    group = {"checked": [{"paths": [r["path"] for r in review["checked"]], "verdict": "supported",
                          "source_refs": [{"page": 1}], "reason": "the listed fields match the page"}], "missing": []}
    write(Path(job["work_dir"]) / "review.json", group)
    assert finish(kernel, job)["opening_ready"]
