"""§107.1 on the emitted kernel: a map is orientation, never a door.

The move into a scene whose map is still unread lands with the scene's text; the map is read in the
background and presented on the first turn after it is published, once; a refused map read settles the
focus so a later arrival neither waits nor reads again.
"""
import hashlib
import json
from pathlib import Path

from setup_helpers import confirmed_investigator
from conftest import campaign_dir
from module_helpers import write, bind, request, claim, finish, observed, opening

IMAGE = (Path(__file__).parent / "fixtures/bundle-tiny/assets/map-dock.png").read_bytes()
REFS = [{"page": 2}]


def scoped_dir(kernel, mid):
    return kernel.workspace / ".coc" / "module-campaigns" / "c1" / "modules" / mid


def queue(kernel, mid):
    return json.loads((scoped_dir(kernel, mid) / "deepen-queue.json").read_text(encoding="utf-8"))


def module_meta(kernel, mid):
    return json.loads((scoped_dir(kernel, mid) / "module.json").read_text(encoding="utf-8"))


def world(kernel):
    return json.loads((campaign_dir(kernel.workspace) / "world.json").read_text(encoding="utf-8"))


def turn_file(kernel):
    return json.loads((campaign_dir(kernel.workspace) / "turn.json").read_text(encoding="utf-8"))


def map_jobs(kernel, mid):
    return [job for job in queue(kernel, mid) if job.get("material") == "map"]


def c1_claim(kernel, mid):
    return kernel.ok("module.read.claim", {"module_id": mid, "campaign": "c1", "owner": "test-host"})


def book_at_the_dock(kernel, tmp_path):
    """A read PDF whose index marks the Tower with a map, a table standing at the Dock with the Tower's text ready."""
    mid, _ = bind(kernel, tmp_path)
    request(kernel, mid, "index")
    job = claim(kernel, mid)
    observed(job)
    write(Path(job["work_dir"]) / "draft.json", {"title": "The Harbor", "language": "en", "sections": [
        {"name": "The harbor and the tower", "pages": [[1, 2]], "topics": ["opening"], "entities": ["Dock", "Tower", "Lena"], "references": []}],
        "map_candidates": [{"name": "Tower plan", "focus": "Tower", "pages": [2]}]})
    finish(kernel, job)
    job, _, _ = opening(kernel, mid)
    finish(kernel, job)
    kernel.ok("campaign.create", {"id": "c1", "module": mid, "play_language": "en"})
    kernel.ok("campaign.create", {"id": "card-source", "module": "the-haunting", "play_language": "en"})
    confirmed_investigator(kernel, campaign="card-source")
    kernel.ok("setup.complete", {"campaign": "card-source"})
    saved = kernel.ok("investigator.save", {"campaign": "card-source"})
    kernel.ok("investigator.load", {"campaign": "c1", "library_id": saved["library_id"]})
    kernel.ok("setup.complete", {"campaign": "c1"})
    kernel.table("open")
    kernel.table("narrate", call_id="t0-c1", text="The harbor waits.")
    kernel.table("player_input", text="I walk to the tower.")
    # The Tower's own text is the move's gate (§22.4) and stays one: it is read before the move.
    request(kernel, mid, "detail", focus="Tower", campaign="c1")
    job = c1_claim(kernel, mid)
    assert job["purpose"] == "detail" and job.get("material") is None
    observed(job)
    write(Path(job["work_dir"]) / "draft.json", {"nodes": [
        {"node_id": "scene-tower", "node_kind": "scene", "name": "Tower", "source_refs": REFS,
         "summary": "An old tower beyond the harbor.", "properties": {"is_final": True}}],
        "claims": [], "node_refs": [], "coverage": {}, "dependencies": [], "critical": [], "ready_nodes": ["scene-tower"]})
    write(Path(job["work_dir"]) / "review.json", {"checked": [{"paths": ["/nodes/0", "/coverage"], "verdict": "supported", "source_refs": REFS}], "missing": []})
    finish(kernel, job, campaign="c1")
    return mid


def publish_tower_map(kernel, mid, job):
    observed(job)
    work = Path(job["work_dir"])
    plate = work / "tower-plate.png"
    plate.write_bytes(IMAGE)
    draft = {"nodes": [
        {"node_id": "asset-tower-plate", "node_kind": "asset", "name": "Tower plate", "visibility": "player-safe",
         "source_refs": REFS, "properties": {"image_sources": [{"page": 2}]}},
        {"node_id": "handout-tower-plan", "node_kind": "handout", "name": "Tower plan", "visibility": "player-safe",
         "source_refs": REFS, "properties": {"map_regions": [{"region_id": "top-room", "name": "Top room",
            "source_asset": "asset-tower-plate", "source_box": [0, 0, 1, 1], "placement": [0, 0, 1, 1]}]}}],
        "claims": [{"subject_id": "handout-tower-plan", "predicate": "depicts", "object": {"node_id": "scene-tower"},
                    "truth_status": "authored-fact", "source_refs": REFS}],
        "node_refs": [], "coverage": {}, "dependencies": [], "critical": [], "ready_nodes": ["asset-tower-plate", "handout-tower-plan"]}
    boxes = [f"/nodes/1/properties/map_regions/0/{box}/{n}" for box in ("source_box", "placement") for n in range(4)]
    write(work / "draft.json", draft)
    write(work / "review.json", {"checked": [{"paths": ["/nodes/0", "/nodes/1", *boxes, "/claims/0", "/coverage"],
        "verdict": "supported", "source_refs": REFS}], "missing": []})
    return finish(kernel, job, campaign="c1", assets=[{"node_id": "asset-tower-plate", "path": str(plate),
        "sha256": hashlib.sha256(IMAGE).hexdigest()}])


def late_receipts(turn):
    return [receipt for receipt in turn.get("receipts", []) if receipt.get("kind") == "map"]


def test_the_move_lands_and_the_map_published_later_arrives_on_the_next_turn_once(kernel, tmp_path):
    mid = book_at_the_dock(kernel, tmp_path)

    moved = kernel.table("apply", call_id="t1-c1", effects=[{"kind": "move", "to": "Tower"}])
    assert moved["world"]["active_scene"] == "tower", "a map is never a door: the move lands with the scene's text"
    [job] = map_jobs(kernel, mid)
    assert (job["state"], job["foreground"], job["focus"], job["pages"]) == ("queued", False, "tower", [2])
    assert job["job_id"] in moved["deepen_queued"], "the background map job rides the host's existing wake"
    assert world(kernel)["map_arrivals_pending"] == ["tower"]
    assert late_receipts(turn_file(kernel)) == [] and "map_views" not in moved

    kernel.table("narrate", call_id="t1-c2", text="The tower door stands open.")
    second = kernel.ok("table.player_input", {"campaign": "c1", "text": "I climb the stairs."})
    assert "map_views" not in second and late_receipts(turn_file(kernel)) == [], "nothing is presented before publication"
    assert "map_arrived" not in second["capsule"]["turn"]

    job = c1_claim(kernel, mid)
    assert job.get("material") == "map"
    publish_tower_map(kernel, mid, job)
    kernel.table("narrate", call_id="t2-c1", text="The stairs creak.")

    third = kernel.ok("table.player_input", {"campaign": "c1", "text": "I look around the top room."})
    [receipt] = late_receipts(turn_file(kernel))
    assert (receipt["map"], receipt["why"], receipt["late"], receipt["scene"], receipt["call_id"]) == ("tower-plan", "arrival", True, "tower", "t3-input")
    assert [region["id"] for region in receipt["regions"]] == ["top-room"]
    [view] = third["map_views"]
    assert view["receipt"] == receipt["id"] and view["map"] == "tower-plan"
    assert third["capsule"]["turn"]["map_arrived"] == [{"map": "tower-plan", "scene": "tower", "receipt": receipt["id"]}]
    state = world(kernel)
    assert state["maps_presented"] == ["tower-plan"] and state["map_arrivals_pending"] == []
    delivered = kernel.table("narrate", call_id="t3-c1", text="Wind moves through the top room.")
    assert any(row.get("kind") == "map" and row.get("map") == "tower-plan" for row in delivered["mechanics"])

    fourth = kernel.ok("table.player_input", {"campaign": "c1", "text": "I wait."})
    assert "map_views" not in fourth and late_receipts(turn_file(kernel)) == [], "the late card is minted once"
    events = [json.loads(line) for line in (campaign_dir(kernel.workspace) / "events.jsonl").read_text(encoding="utf-8").splitlines() if line.strip()]
    assert [event["turn"] for event in events if event["type"] == "map-revealed"] == [3]


def test_a_refused_map_review_settles_the_focus_and_the_next_arrival_reads_nothing(kernel, tmp_path):
    mid = book_at_the_dock(kernel, tmp_path)
    kernel.table("apply", call_id="t1-c1", effects=[{"kind": "move", "to": "Tower"}])
    job = c1_claim(kernel, mid)
    assert job.get("material") == "map"
    refusal = {"message": "visual review did not support ['/nodes/1/properties/map_regions/0/source_box/0']", "rule": "review"}
    kernel.ok("module.read.finish", {"module_id": mid, "campaign": "c1", "job_id": job["job_id"], "lease": job["lease"],
        "outcome": "failed", "detail": "invalid_params: visual review refused", "refusal": refusal})
    [settled] = [row for row in module_meta(kernel, mid)["reading"]["materials"] if row.get("material") == "map"]
    assert (settled["status"], settled["focus"], settled["reason"], settled["node_ids"]) == ("unusable", "tower", refusal["message"], [])

    kernel.table("narrate", call_id="t1-c2", text="The tower door stands open.")
    kernel.ok("table.player_input", {"campaign": "c1", "text": "I go back to the dock, then return."})
    assert world(kernel)["map_arrivals_pending"] == [], "a settled focus drops its pending arrival"
    kernel.table("apply", call_id="t2-c1", effects=[{"kind": "move", "to": "Dock"}])
    again = kernel.table("apply", call_id="t2-c2", effects=[{"kind": "move", "to": "Tower"}])
    assert again["world"]["active_scene"] == "tower"
    assert [job["job_id"] for job in map_jobs(kernel, mid)] == [job["job_id"]], "the settled focus is not read again"
    assert not any(queued in [j["job_id"] for j in map_jobs(kernel, mid)] for queued in again["deepen_queued"])
    assert world(kernel)["map_arrivals_pending"] == []
    answered = request(kernel, mid, "detail", material="map", focus="tower", question=job["question"], campaign="c1")
    assert answered["state"] == "unusable" and answered["reason"] == refusal["message"]
    # Only an explicit read replaces the settlement.
    retried = request(kernel, mid, "detail", material="map", focus="tower", question=job["question"], campaign="c1", retry=True)
    assert retried["state"] == "queued"
    assert not [row for row in module_meta(kernel, mid)["reading"]["materials"] if row.get("material") == "map"]
