"""Source/reading RPC acceptance at the deterministic seam, never a fake game."""
import copy
import hashlib
import json
import random
import os
import signal
import subprocess
import shutil
from pathlib import Path

import pytest

from conftest import CONTENT_DIR, RpcClient
from coc.errors import RpcError
from coc.store import Store
from coc.table import Table
from coc.module_graph import ModuleGraph, record_of
from coc.modules.store import ModuleStore
from coc.modules.reading import Reading
from coc.modules.visual import check_draft
from module_helpers import write, bind, request, claim, finish, observed, indexed, opening


def test_a_reader_cannot_publish_an_arbitrary_local_file_as_a_handout():
    draft = {"nodes": [{"node_id": "handout-letter", "node_kind": "handout", "name": "Letter",
        "visibility": "revealable", "source_refs": [{"page": 1}], "properties": {"asset_ref": "/unrelated/private.png"}}],
        "claims": [], "node_refs": [], "coverage": {}, "critical": [], "dependencies": [], "ready_nodes": ["handout-letter"]}
    with pytest.raises(RpcError, match="owned by the host"):
        check_draft(draft, {"module_id": "book-1", "source": {"page_count": 1}, "known_nodes": []}, {1})


def test_retired_source_commands_are_not_registered(kernel):
    for method in ("bind", "plan", "plan.accept", "packet", "review", "accept", "assemble", "install",
                   "deepen.claim", "deepen.complete", "deepen.enqueue"):
        assert kernel.err(f"module.{method}", {})["code"] == "unknown_method"


















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


def test_index_publication_recovers_without_exposing_or_duplicating_partial_rows(kernel, tmp_path, monkeypatch):
    mid, _ = bind(kernel, tmp_path)
    request(kernel, mid, "index")
    store = ModuleStore(kernel.workspace)
    reading = Reading(store)
    job = reading.claim({"module_id": mid})
    draft = {"title": "The Harbor", "language": "en", "sections": [{"name": "Harbor", "pages": [[1, 2]]}]}
    observed(job)
    write(Path(job["work_dir"]) / "draft.json", draft)
    with monkeypatch.context() as patch:
        def interrupted(_meta):
            raise OSError("crash before metadata publication")
        patch.setattr(store, "write_module", interrupted)
        with pytest.raises(OSError):
            reading.finish({"module_id": mid, "job_id": job["job_id"], "lease": job["lease"],
                "outcome": "completed", "draft_path": str(Path(job["work_dir"]) / "draft.json")})
    assert (Path(job["work_dir"]) / "index.json").exists()
    assert store.read_sections(mid) == []
    assert store.module(mid)["reading"]["viewed_pages"] == []
    reading.release(mid)
    recovered = Reading(ModuleStore(kernel.workspace))
    retry = recovered.claim({"module_id": mid})
    observed(retry)
    write(Path(retry["work_dir"]) / "draft.json", draft)
    recovered.finish({"module_id": mid, "job_id": retry["job_id"], "lease": retry["lease"],
        "outcome": "completed", "draft_path": str(Path(retry["work_dir"]) / "draft.json")})
    assert len(store.read_sections(mid)) == 1
    assert store.module(mid)["reading"]["viewed_pages"] == [0, 1]
    assert (Path(job["work_dir"]) / "index.json").exists()


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


def test_queued_preparation_reuses_material_published_by_an_earlier_job(kernel, tmp_path):
    mid, _ = indexed(kernel, tmp_path)
    first, _, _ = opening(kernel, mid)
    queued = request(kernel, mid, "detail", focus="Lena")
    finish(kernel, first)
    assert claim(kernel, mid) == {"job_id": None}
    rows = json.loads((kernel.workspace / ".coc/modules" / mid / "deepen-queue.json").read_text())
    reused = next(row for row in rows if row["job_id"] == queued["job_id"])
    assert reused["state"] == "completed" and reused["reused_generation"] == 1
    assert "work_dir" not in reused
    new_question = request(kernel, mid, "detail", focus="Lena", question="What is her earlier job?")
    active = claim(kernel, mid)
    assert active["job_id"] == new_question["job_id"]
    finish(kernel, active, outcome="cancelled")


def test_a_prepared_summary_cannot_be_silently_replaced(kernel, tmp_path):
    mid, _ = indexed(kernel, tmp_path)
    first, draft, _ = opening(kernel, mid)
    draft["nodes"][0]["summary"] = "A working harbor."
    write(Path(first["work_dir"]) / "draft.json", draft)
    finish(kernel, first)
    request(kernel, mid, "detail", focus="Dock", question="What is the harbor like?")
    job = claim(kernel, mid)
    observed(job)
    write(Path(job["work_dir"]) / "draft.json", {"nodes": [{"node_id": "scene-dock", "node_kind": "scene",
        "name": "Dock", "summary": "An abandoned military base.", "source_refs": [{"page": 1}]}],
        "claims": [], "node_refs": [], "coverage": {}, "dependencies": [], "critical": [], "ready_nodes": ["scene-dock"]})
    write(Path(job["work_dir"]) / "review.json", {"checked": [{"path": "/nodes/0", "verdict": "supported",
        "source_refs": [{"page": 1}]}], "missing": []})
    err = kernel.err("module.read.finish", {"module_id": mid, "job_id": job["job_id"], "lease": job["lease"],
        "outcome": "completed", "draft_path": str(Path(job["work_dir"]) / "draft.json"),
        "review_path": str(Path(job["work_dir"]) / "review.json")})
    assert err["code"] == "needs_choice" and err["details"]["path"].endswith("/summary")
    assert kernel.ok("module.status", {"module_id": mid})["generation"] == 1
    finish(kernel, job, outcome="cancelled")


def test_further_reading_reuses_an_existing_claim_identity_and_reason(kernel, tmp_path):
    mid, _ = indexed(kernel, tmp_path)
    first, draft, _ = opening(kernel, mid)
    draft["claims"][0].update(claim_id="claim-harbor-trail", reason="The trail connects the dock and tower.")
    write(Path(first["work_dir"]) / "draft.json", draft)
    finish(kernel, first)
    request(kernel, mid, "detail", focus="Dock", question="Where does its trail lead?")
    job = claim(kernel, mid)
    observed(job)
    assert any(c.get("reason") == "The trail connects the dock and tower." for c in job["known_claims"])
    write(Path(job["work_dir"]) / "draft.json", {"nodes": [{"node_id": "scene-dock", "node_kind": "scene",
        "name": "Dock", "source_refs": [{"page": 1}]}], "claims": [{"subject_id": "scene-dock", "predicate": "route-to",
        "object": {"node_id": "scene-tower"}, "truth_status": "authored-fact", "source_refs": [{"page": 2}]}],
        "node_refs": ["scene-tower"], "coverage": {}, "dependencies": [], "critical": [], "ready_nodes": ["scene-dock"]})
    write(Path(job["work_dir"]) / "review.json", {"checked": [{"paths": ["/nodes/0", "/claims/0"],
        "verdict": "supported", "source_refs": [{"page": 1}, {"page": 2}]}], "missing": []})
    finish(kernel, job)
    graph = ModuleStore(kernel.workspace).read_graph(mid)
    routes = [c for c in graph["claims"] if c["predicate"] == "route-to"]
    assert len(routes) == 1 and routes[0]["claim_id"] == "claim-harbor-trail"
    assert routes[0]["reason"] == "The trail connects the dock and tower."


def test_published_material_remains_usable_without_the_original_pdf(kernel, tmp_path):
    mid, _ = indexed(kernel, tmp_path)
    job, _, _ = opening(kernel, mid)
    finish(kernel, job)
    (kernel.workspace / ".coc" / "modules" / mid / "source.pdf").unlink()
    assert request(kernel, mid, "opening")["state"] == "ready"
    assert request(kernel, mid, "detail", focus="Lena")["state"] == "ready"
    error = kernel.err("module.read.request", {"module_id": mid, "purpose": "detail",
        "focus": "Lena", "question": "Who does she owe money to?"})
    assert error["details"]["reason"] == "needs_source"
    assert kernel.ok("module.status", {"module_id": mid})["generation"] == 1
    kernel.ok("campaign.create", {"id": "c1", "module": mid, "play_language": "en"})
    kernel.ok("setup.investigator", {"campaign": "c1", "name": "Ada", "occupation": "Journalist"})
    kernel.ok("setup.complete", {"campaign": "c1"})
    assert kernel.table("open")["scene"]["name"] == "dock"
    kernel.table("narrate", call_id="t0-c1", text="The harbor waits.")
    kernel.table("player_input", text="I stay on the dock.")
    assert kernel.table("apply", call_id="t1-c1", effects=[{"kind": "time", "minutes": 5}])["world"]["clock"]["minutes"] == 5


def test_distinct_regions_on_the_same_page_keep_their_own_assets_across_publications(kernel, tmp_path):
    mid, _ = indexed(kernel, tmp_path)
    job, draft, review = opening(kernel, mid)
    image = (Path(__file__).parent / "fixtures/bundle-tiny/assets/map-dock.png").read_bytes()

    def attach(job, draft, review, name, box):
        position = len(draft["nodes"])
        nid = f"handout-{name}"
        draft["nodes"].append({"node_id": nid, "node_kind": "handout", "name": name,
            "visibility": "revealable", "source_refs": [{"page": 1}],
            "properties": {"image_sources": [{"page": 1, "box": box}]}})
        draft["ready_nodes"].append(nid)
        review["checked"].append({"path": f"/nodes/{position}", "verdict": "supported", "source_refs": [{"page": 1}]})
        write(Path(job["work_dir"]) / "draft.json", draft)
        write(Path(job["work_dir"]) / "review.json", review)
        path = Path(job["work_dir"]) / f"{name}.png"
        path.write_bytes(image)
        return {"node_id": nid, "path": str(path), "sha256": hashlib.sha256(image).hexdigest()}

    left = attach(job, draft, review, "left", [0, 0, 0.5, 1])
    finish(kernel, job, assets=[left])
    request(kernel, mid, "detail", focus="Lena", question="Which second handout does she carry?")
    next_job = claim(kernel, mid)
    observed(next_job)
    next_draft = {"nodes": [], "claims": [], "node_refs": [], "coverage": {}, "dependencies": [], "critical": [], "ready_nodes": []}
    right = attach(next_job, next_draft, {"checked": [], "missing": []}, "right", [0.5, 0, 1, 1])
    finish(kernel, next_job, assets=[right])
    chosen = kernel.ok("module.opening.choose", {"module_id": mid, "scene": "Dock"})
    assert chosen["generation"] == 3 and chosen["opening_ready"] is True
    for asset in (left, right):
        result = kernel.ok("module.asset", {"module_id": mid, "name": asset["node_id"]})
        assert result["asset"]["path"] == asset["path"]
        assert result["player_visible"] is True
        assert Path(result["asset"]["path"]).read_bytes() == image


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
    job, draft, review = opening(kernel, mid)
    draft["nodes"][0]["summary"] = "The harbor keeper asks for the missing ledger."
    draft["nodes"][0]["properties"]["mission"] = "Find the missing ledger."
    draft["nodes"].append({"node_id": f"module-{mid}", "node_kind": "module", "name": "The Harbor",
                           "source_refs": [{"page": 1}], "properties": {"era": "80 CE"}})
    draft["ready_nodes"].append(f"module-{mid}")
    review["checked"].append({"path": "/nodes/3", "verdict": "supported", "source_refs": [{"page": 1}]})
    write(Path(job["work_dir"]) / "draft.json", draft)
    write(Path(job["work_dir"]) / "review.json", review)
    finish(kernel, job)
    kernel.ok("campaign.create", {"id": "c1", "module": mid, "play_language": "en"})
    kernel.ok("setup.investigator", {"campaign": "c1", "name": "Ada", "occupation": "Journalist"})
    kernel.ok("setup.complete", {"campaign": "c1"})
    kernel.table("open")
    viewed = kernel.table("look")
    assert viewed["module"]["era"] == "80 CE"
    assert viewed["where"]["summary"] == "The harbor keeper asks for the missing ledger."
    assert kernel.table("lookup", kind="module", query="Dock")["entities"][0]["properties"]["mission"] == "Find the missing ledger."
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

    request(kernel, mid, "detail", focus="Tower")
    job = claim(kernel, mid)
    observed(job)
    write(Path(job["work_dir"]) / "draft.json", {"nodes": [
        {"node_id": "scene-tower", "node_kind": "scene", "name": "Tower", "source_refs": [{"page": 2}],
         "summary": "The tower's upper room holds a ledger.",
         "properties": {"is_final": True, "facts": ["The upper room contains a ledger."]}}],
        "claims": [], "node_refs": [], "coverage": {}, "dependencies": [], "critical": [], "ready_nodes": ["scene-tower"]})
    write(Path(job["work_dir"]) / "review.json", {"checked": [{"paths": ["/nodes/0"], "verdict": "supported", "source_refs": [{"page": 2}]}], "missing": []})
    finish(kernel, job)
    current_graph = ModuleStore(kernel.workspace).read_graph(mid)
    tower = next(n for n in current_graph["nodes"] if n["node_id"] == "scene-tower")
    assert tower["summary"] == "The tower's upper room holds a ledger."
    assert record_of(tower)["facts"] == ["The upper room contains a ledger."]
    movement = {"call_id": "t1-c1", "effects": [{"kind": "move", "to": "Tower"}]}
    result = kernel.table("apply", **movement)
    assert result["world"]["active_scene"] == "tower"
    assert kernel.table("apply", **movement)["replayed"] is True
    turn = json.loads((directory / "turn.json").read_text())
    assert len([r for r in turn["receipts"] if r["kind"] == "move"]) == 1


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


def test_kernel_crash_reclaims_a_new_attempt_and_rejects_the_old_lease(kernel, tmp_path):
    mid, _ = indexed(kernel, tmp_path)
    request(kernel, mid, "opening")
    old = claim(kernel, mid)
    evidence = Path(old["work_dir"]) / "unfinished.txt"
    evidence.write_text("retained source work", encoding="utf-8")
    # RpcClient owns uv, whose child owns the lock. Kill that exact kernel process.
    children = subprocess.check_output(["pgrep", "-P", str(kernel.proc.pid)], text=True).split()
    assert len(children) == 1
    os.kill(int(children[0]), signal.SIGKILL)
    kernel.proc.wait(timeout=5)
    other = RpcClient(kernel.workspace)
    try:
        current = claim(other, mid)
        assert current["job_id"] == old["job_id"]
        assert current["lease"] != old["lease"]
        assert current["work_dir"] != old["work_dir"]
        assert evidence.read_text(encoding="utf-8") == "retained source work"
        err = other.err("module.read.finish", {"module_id": mid, "job_id": old["job_id"], "lease": old["lease"], "outcome": "cancelled"})
        assert "no longer owns" in err["message"]
        finish(other, current, outcome="cancelled")
    finally:
        other.close()


def test_replaying_a_completed_job_does_not_release_another_active_job(kernel, tmp_path):
    mid, _ = indexed(kernel, tmp_path)
    earlier = json.loads((kernel.workspace / ".coc" / "modules" / mid / "deepen-queue.json").read_text())[0]
    request(kernel, mid, "opening")
    active = claim(kernel, mid)
    result = kernel.ok("module.read.finish", {"module_id": mid, "job_id": earlier["job_id"], "lease": earlier["lease"], "outcome": "completed"})
    assert result["replayed"]
    other = RpcClient(kernel.workspace)
    try:
        assert claim(other, mid) == {"job_id": None}
    finally:
        other.close()
    finish(kernel, active, outcome="cancelled")


def test_an_authored_ending_relation_is_not_a_movement_exit(tmp_path):
    path = tmp_path / "graph.json"
    write(path, {"nodes": [
        {"node_id": "module-book", "node_kind": "module", "name": "Book", "properties": {}},
        {"node_id": "scene-harbor", "node_kind": "scene", "name": "Harbor", "properties": {}},
        {"node_id": "ending-homecoming", "node_kind": "ending", "name": "Homecoming", "summary": "Once the investigation is resolved.", "properties": {}}],
        "relations": [{"relation_id": "rel-close", "relation_kind": "may-lead-to", "from_node_id": "scene-harbor", "to_node_id": "ending-homecoming", "properties": {}}]})
    graph = ModuleGraph("book", path)
    assert graph.scene_exits(graph.scene("harbor")) == []
    assert graph.scene_endings(graph.scene("harbor"))[0]["name"] == "Homecoming"


def test_attaching_original_source_keeps_legacy_material_usable(kernel, tmp_path):
    mid, source = indexed(kernel, tmp_path)
    job, _, _ = opening(kernel, mid)
    finish(kernel, job)
    store = ModuleStore(kernel.workspace)
    directory = store.module_dir(mid)
    meta = store.module(mid)
    shutil.copyfile(store.graph_path(mid), directory / "module-graph.json")
    for key in ("graph_file", "reading_version", "reading", "source_document"):
        meta.pop(key, None)
    write(directory / "module.json", meta)
    kernel.ok("module.source.bind", {"source": source})
    assert request(kernel, mid, "detail", focus="Lena")["state"] == "ready"
    assert request(kernel, mid, "detail", focus="Lena", question="What does she know?")["state"] == "queued"


def test_rebinding_identical_source_repairs_a_missing_original(kernel, tmp_path):
    mid, source = bind(kernel, tmp_path)
    original = kernel.workspace / ".coc" / "modules" / mid / "source.pdf"
    original.rename(original.with_suffix(".retained"))
    kernel.ok("module.source.bind", {"source": source})
    assert original.read_bytes() == Path(source["path"]).read_bytes()


def test_rebinding_the_matching_original_preserves_corrupted_bytes_and_the_published_graph(kernel, tmp_path):
    mid, source = indexed(kernel, tmp_path)
    job, _, _ = opening(kernel, mid)
    finish(kernel, job)
    directory = kernel.workspace / ".coc" / "modules" / mid
    original = directory / "source.pdf"
    original.write_bytes(b"corrupted source retained for diagnosis")
    kernel.ok("module.source.bind", {"source": source})
    assert original.read_bytes() == Path(source["path"]).read_bytes()
    copies = list(directory.glob("source-corrupt-*.pdf"))
    assert len(copies) == 1 and copies[0].read_bytes() == b"corrupted source retained for diagnosis"
    status = kernel.ok("module.status", {"module_id": mid})
    assert status["generation"] == 1 and status["opening_ready"] is True
