"""Deterministic source/read transport fixtures, never PDF or gameplay acceptance."""
import hashlib
import json
from pathlib import Path


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
         "summary": "An old tower beyond the harbor.",
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
