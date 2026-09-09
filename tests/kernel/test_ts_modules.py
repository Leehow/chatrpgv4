"""Actual Python/TypeScript source RPC pairs; fixtures are not PDF or gameplay acceptance."""
from __future__ import annotations

import copy
import hashlib
import json
import os
import shutil
import sys
import tempfile
from pathlib import Path

import pytest

from conftest import RpcClient
from module_helpers import bind, claim, finish, indexed, observed, opening, request, write
from rpc_support import differences, python_command, snapshot
from test_fast_guidance import seed as guidance_seed

ROOT = Path(__file__).resolve().parents[2]
EVIDENCE = ROOT / ".coc/playtests/ts-modules"


def retained(name):
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    return Path(tempfile.mkdtemp(prefix=name + "-", dir=EVIDENCE))


def candidate_command():
    override = os.environ.get("COC_TS_MODULES_COMMAND")
    if override:
        return json.loads(override)
    entry = ROOT / "build/kernel/rpc.mjs"
    assert entry.is_file(), "Build the canonical TypeScript RPC before source comparisons"
    return ["node", str(entry)]


class Owners:
    """Equal test-only entropy streams; no identity, digest or timestamp masking."""
    def __init__(self, root, label):
        self.root, self.label = root, label
        self.workspace = root / "workspace"
        self.clients = []
        self.closed = set()
        self.exchanges = []
        self.serial = 0
        self.preload = root / "module-uuid.cjs"
        self.preload.write_text("""const crypto = require('node:crypto');
let ordinal = Number(process.env.COC_TEST_MODULE_OWNER) * 1000;
crypto.randomUUID = () => '00000000-0000-4000-8000-' + (++ordinal).toString(16).padStart(12, '0');
require('node:module').syncBuiltinESMExports();
""")

    def start(self):
        self.serial += 1
        command = candidate_command()
        if self.label == "python":
            script = """import os, runpy, uuid
ordinal = int(os.environ['COC_TEST_MODULE_OWNER']) * 1000
def next_uuid():
    global ordinal
    ordinal += 1
    return uuid.UUID('00000000-0000-4000-8000-' + format(ordinal, '012x'))
uuid.uuid4 = next_uuid
runpy.run_path(%r, run_name='__main__')
""" % python_command()[1]
            command = [sys.executable, "-c", script]
        client = RpcClient(self.workspace, command=command, frozen_clock=True, env={
            "COC_TEST_MODULE_OWNER": str(self.serial),
            "NODE_OPTIONS": "--require " + json.dumps(str(self.preload)),
        })
        self.clients.append(client)
        return client

    def close(self, client):
        if client in self.closed:
            return
        self.exchanges.append(client.exchanges)
        client.close()
        self.closed.add(client)

    def finish(self):
        for client in self.clients:
            self.close(client)
        state = snapshot(self.workspace)
        byte_hashes = {path.relative_to(self.workspace / ".coc").as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
                       for path in (self.workspace / ".coc").rglob("*") if path.is_file()
                       and path.relative_to(self.workspace / ".coc").parts[0] != "repos"}
        result = {"exchanges": self.exchanges, "state": state, "byte_hashes": byte_hashes}
        (self.root / f"{self.label}.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
        self.workspace.rename(self.root / f"{self.label}-workspace")
        return result


def inventory(owners):
    client = owners.start()
    client.ok("module.list")
    for method, params in [
        ("module.status", {}), ("module.status", {"module_id": "absent"}),
        ("module.register", {"module_id": "../escape"}), ("module.register", {"module_id": "absent"}),
        ("module.read.request", {"module_id": "a", "purpose": "everything"}),
        ("module.source.bind", {"source": {"page_count": True}}),
        ("module.source.bind", {"source": {"page_count": 1, "path": "absent"}}),
    ]:
        client.err(method, params)
    first = client.ok("module.register", {"module_id": "the-haunting"})
    assert client.ok("module.register", {"module_id": "the-haunting"}) == first
    client.ok("module.list")
    client.ok("module.status", {"module_id": "the-haunting"})
    client.err("module.asset", {"module_id": "the-haunting", "name": "absent"})
    client.err("module.opening.choose", {"module_id": "the-haunting", "scene": "commission-briefing"})


def navigation(owners):
    client = owners.start()
    mid, source = bind(client, owners.root)
    client.ok("module.source.bind", {"source": source})
    request(client, mid, "index")
    job = claim(client, mid)
    observed(job, full_pages=[1])
    draft_path = Path(job["work_dir"]) / "draft.json"
    write(draft_path, {"sections": [{"name": "Harbor", "pages": [[1, 2]]}]})
    params = {"module_id": mid, "job_id": job["job_id"], "lease": job["lease"], "outcome": "completed", "draft_path": str(draft_path)}
    assert "observed source" in client.err("module.read.finish", params)["message"]
    write(draft_path, {"title": " The Harbor ", "language": "en", "sections": [
        {"name": "Navigation only", "pages": [[1, 2]], "source_refs": [{"page": 1}], "entities": ["Lena"]}]})
    result = finish(client, job)
    assert result == {"state": "preparing", "generation": 0, "opening_ready": False}
    assert finish(client, job)["replayed"]
    assert request(client, mid, "index")["state"] == "ready"
    client.ok("module.status", {"module_id": mid})


def reviewed_opening(owners):
    client = owners.start()
    mid, _ = indexed(client, owners.root)
    job, draft, review = opening(client, mid)
    work = Path(job["work_dir"])
    observed(job, read_pages=["1", "2"])
    early_params = {"module_id": mid, "job_id": job["job_id"], "lease": job["lease"], "outcome": "completed", "draft_path": str(work / "draft.json"), "review_path": str(work / "review.json")}
    assert "not actually viewed" in client.err("module.read.finish", early_params)["message"]
    observed(job)
    missing = copy.deepcopy(review)
    missing["checked"] = [item for item in review["checked"] if "characteristics/STR" not in item["path"]]
    write(work / "review.json", missing)
    params = {"module_id": mid, "job_id": job["job_id"], "lease": job["lease"], "outcome": "completed", "draft_path": str(work / "draft.json"), "review_path": str(work / "review.json")}
    assert "omitted" in client.err("module.read.finish", params)["message"]
    assert client.ok("module.status", {"module_id": mid})["generation"] == 0
    write(work / "review.json", review)
    queued = request(client, mid, "detail", focus="Lena")
    assert finish(client, job)["opening_ready"]
    assert finish(client, job)["replayed"]
    assert claim(client, mid) == {"job_id": None}
    queue = json.loads((owners.workspace / ".coc/modules" / mid / "deepen-queue.json").read_text())
    reused = next(row for row in queue if row["job_id"] == queued["job_id"])
    assert reused["reused_generation"] == 1 and "work_dir" not in reused
    assert request(client, mid, "detail", focus="Lena")["state"] == "ready"
    assert request(client, mid, "detail", focus="Lena", question="What is her earlier job?")["state"] == "queued"
    older = claim(client, mid)
    other = owners.start()
    request(other, mid, "detail", focus="Dock", question="What authored numbers apply here?", foreground=True)
    concurrent = claim(other, mid)
    assert older["base_generation"] == concurrent["base_generation"] == 1

    def numeric_material(target, hp):
        observed(target)
        directory = Path(target["work_dir"])
        value = {"nodes": [{"node_id": "npc-lena", "node_kind": "npc", "name": "Lena", "source_refs": [{"page": 1}],
                            "properties": {"mechanics": {"profile": {"derived": {"HP": hp}}}}}],
                 "claims": [], "node_refs": [], "critical": [], "coverage": {}, "dependencies": [], "ready_nodes": ["npc-lena"]}
        write(directory / "draft.json", value)
        write(directory / "review.json", {"checked": [{"paths": ["/nodes/0", "/nodes/0/properties/mechanics/profile/derived/HP"],
            "verdict": "supported", "source_refs": [{"page": 1}]}], "missing": []})
        return {"module_id": mid, "job_id": target["job_id"], "lease": target["lease"], "outcome": "completed",
                "draft_path": str(directory / "draft.json"), "review_path": str(directory / "review.json")}

    numeric_material(older, 10)
    proposed = numeric_material(concurrent, 12)
    assert finish(client, older)["generation"] == 2
    failure = other.err("module.read.finish", proposed)
    assert failure["code"] == "needs_choice" and failure["details"]["path"].endswith("/HP")
    assert other.ok("module.status", {"module_id": mid})["generation"] == 2
    numeric_material(concurrent, 10)
    assert finish(other, concurrent)["generation"] == 3
    client.ok("module.status", {"module_id": mid})


def guidance(owners):
    client = owners.start()
    mid, job, draft, guidance, review = guidance_seed(client, owners.root)
    work = Path(job["work_dir"])
    write(work / "guidance.json", {**guidance, "opening": "Altered after review"})
    params = {"module_id": mid, "job_id": job["job_id"], "lease": job["lease"], "outcome": "completed", "draft_path": str(work / "draft.json"), "review_path": str(work / "review.json")}
    assert "exact" in client.err("module.read.finish", params)["message"]
    write(work / "guidance.json", guidance)
    assert finish(client, job)["setup_ready"]
    assert not client.ok("module.status", {"module_id": mid})["opening_ready"]
    assert request(client, mid, "guidance", guidance_key="a" * 64, play_language="en", occupations=[])["setup_ready"]
    client.ok("module.list")
    client.ok("campaign.create", {"id": "early", "module": mid, "guidance_key": "a" * 64, "play_language": "en"})
    assert not (owners.workspace / ".coc/campaigns/early/world.json").exists()


def choices(owners):
    client = owners.start()
    mid, job, draft, _, review = guidance_seed(client, owners.root)
    work = Path(job["work_dir"])
    draft["nodes"].append({"node_id": "scene-garden", "node_kind": "scene", "name": "Garden", "summary": "An authored second entrance.", "source_refs": [{"page": 2}], "properties": {"is_entrance": True}})
    write(work / "draft.json", draft)
    write(work / "guidance.json", {"needs_choice": True})
    review["checked"].append({"path": "/nodes/1", "source_refs": [{"page": 2}], "verdict": "supported"})
    review["guidance"].update(draft_sha256=hashlib.sha256((work / "draft.json").read_bytes()).hexdigest(), guidance_sha256=hashlib.sha256((work / "guidance.json").read_bytes()).hexdigest())
    write(work / "review.json", review)
    result = finish(client, job)
    assert result["state"] == "blocked" and not result["setup_ready"]
    assert len(client.ok("module.status", {"module_id": mid})["opening_candidates"]) == 2
    client.err("module.opening.choose", {"module_id": mid, "scene": "Missing"})
    chosen = client.ok("module.opening.choose", {"module_id": mid, "scene": "Dock"})
    assert not chosen["opening_ready"] and chosen["generation"] == 2
    ready, _, _ = opening(client, mid)
    assert ready["focus"] == "scene-dock"
    assert finish(client, ready)["opening_ready"]
    assert len(client.ok("module.status", {"module_id": mid})["opening_candidates"]) == 2


def deepening_assets(owners):
    client = owners.start()
    mid, _ = bind(client, owners.root)
    job, _, _ = opening(client, mid)
    finish(client, job)
    request(client, mid, "detail", focus="Tower")
    job = claim(client, mid)
    observed(job)
    work = Path(job["work_dir"])
    refs = [{"page": 2}]
    draft = {"nodes": [
        {"node_id": "scene-tower", "node_kind": "scene", "name": "Tower", "summary": "A reviewed room behind the old tower door.", "source_refs": refs, "properties": {"details": "The room has a letter."}},
        {"node_id": "handout-letter", "node_kind": "handout", "name": "Tower Letter", "aliases": ["Letter"], "source_refs": refs, "visibility": "revealable", "properties": {"authored_text": "Meet at dawn.", "image_sources": [{"page": 2, "box": [0.0, 0.0, 0.5, 1.0]}]}},
    ], "claims": [], "node_refs": [], "critical": [], "coverage": {}, "dependencies": [], "ready_nodes": ["scene-tower", "handout-letter"]}
    write(work / "draft.json", draft)
    write(work / "review.json", {"checked": [{"paths": ["/nodes/0", "/nodes/1"], "verdict": "supported", "source_refs": refs}], "missing": []})
    image = work / "letter.png"
    image.write_bytes(b"\x89PNG\r\n\x1a\ntransport artifact only")
    assets = [{"node_id": "handout-letter", "path": str(image), "sha256": hashlib.sha256(image.read_bytes()).hexdigest()}]
    assert finish(client, job, assets=assets)["generation"] == 2
    entry = client.ok("module.asset", {"module_id": mid, "name": "Letter"})
    assert entry["player_visible"] and entry["asset"]["path"] == str(image)
    request(client, mid, "detail", focus="Tower", question="Can the summary change?")
    conflict = claim(client, mid)
    observed(conflict)
    work = Path(conflict["work_dir"])
    changed = copy.deepcopy(draft)
    changed["nodes"] = [{**draft["nodes"][0], "summary": "A replacement for already prepared material."}]
    changed["ready_nodes"] = ["scene-tower"]
    write(work / "draft.json", changed)
    write(work / "review.json", {"checked": [], "missing": []})
    params = {"module_id": mid, "job_id": conflict["job_id"], "lease": conflict["lease"], "outcome": "completed", "draft_path": str(work / "draft.json"), "review_path": str(work / "review.json")}
    assert client.err("module.read.finish", params)["code"] == "needs_choice"
    finish(client, conflict, outcome="cancelled")
    client.ok("module.opening.choose", {"module_id": mid, "scene": "Dock"})
    assert client.ok("module.asset", {"module_id": mid, "name": "Letter"})["asset"]["path"] == str(image)


def leases(owners):
    first = owners.start()
    mid, _ = bind(first, owners.root)
    request(first, mid, "detail", focus="Museum")
    background = claim(first, mid)
    second = owners.start()
    request(second, mid, "detail", focus="Hotel")
    assert claim(second, mid) == {"job_id": None}
    request(second, mid, "detail", focus="Museum", question="A foreground follow-up", foreground=True)
    assert claim(second, mid) == {"job_id": None}
    request(second, mid, "detail", focus="Dinner", question="What evidence is shown?", foreground=True)
    foreground = claim(second, mid)
    assert foreground["focus"] == "Dinner"
    assert claim(first, mid) == {"job_id": None}
    assert second.err("module.read.finish", {"module_id": mid, "job_id": background["job_id"], "lease": background["lease"], "outcome": "cancelled"})["code"] == "invalid_params"
    finish(second, foreground, outcome="failed", detail="The reader could not finish.")
    assert request(second, mid, "detail", focus="Dinner", question="What evidence is shown?", foreground=True)["state"] == "blocked"
    retry = request(second, mid, "detail", focus="Dinner", question="What evidence is shown?", foreground=True, retry=True)
    retried = claim(second, mid)
    assert retried["job_id"] == retry["job_id"] and retried["resume_from"] == foreground["work_dir"]
    finish(second, retried, outcome="cancelled")
    owners.close(first)
    recovered = claim(second, mid)
    assert recovered["job_id"] != background["job_id"]  # The foreground demand wins the newly freed slot.
    finish(second, recovered, outcome="cancelled")
    recovered = claim(second, mid)
    assert recovered["job_id"] == background["job_id"] and recovered["attempts"] == 2 and recovered["lease"] != background["lease"]
    assert Path(background["work_dir"]).is_dir()
    second.err("module.read.finish", {"module_id": mid, "job_id": background["job_id"], "lease": background["lease"], "outcome": "completed"})
    finish(second, recovered, outcome="cancelled")


def metadata_recovery(owners):
    client = owners.start()
    mid, _ = bind(client, owners.root)
    job, _, _ = opening(client, mid)
    queue_path = owners.workspace / ".coc/modules" / mid / "deepen-queue.json"
    before = queue_path.read_bytes()
    result = finish(client, job)
    owners.close(client)
    (owners.root / f"{owners.label}-queue-after-publication.json").write_bytes(queue_path.read_bytes())
    queue_path.write_bytes(before)  # Simulate publication completing before queue acknowledgement.
    resumed = owners.start()
    assert finish(resumed, job) == {**result, "replayed": True}
    assert claim(resumed, mid) == {"job_id": None}
    assert client.workspace.joinpath(".coc/modules", mid, "module.json").exists()
    status = resumed.ok("module.status", {"module_id": mid})
    assert status["generation"] == 1 and status["reading"]["state"] == "ready"


def source_repair(owners):
    client = owners.start()
    mid, source = bind(client, owners.root)
    job, _, _ = opening(client, mid)
    finish(client, job)
    directory = owners.workspace / ".coc/modules" / mid
    (directory / "source.pdf").rename(directory / "retained-original.pdf")
    assert request(client, mid, "detail", focus="Lena")["state"] == "ready"
    assert client.err("module.read.request", {"module_id": mid, "purpose": "detail", "focus": "Tower"})["details"]["reason"] == "needs_source"
    client.ok("module.source.bind", {"source": source})
    (directory / "source.pdf").write_bytes(b"retained corrupted source")
    client.ok("module.source.bind", {"source": source})
    assert any(p.read_bytes() == b"retained corrupted source" for p in directory.glob("source-corrupt-*.pdf"))
    meta_path = directory / "module.json"
    meta = json.loads(meta_path.read_text())
    (owners.root / f"{owners.label}-metadata-before-legacy.json").write_bytes(meta_path.read_bytes())
    meta.pop("source_document")
    meta.pop("reading_version")
    write(meta_path, meta)
    client.ok("module.source.bind", {"source": source})
    assert next(directory.glob("legacy-queue-*.json")).exists()
    assert json.loads(meta_path.read_text())["reading"]["materials"][0]["verification"] == "legacy"
    assert request(client, mid, "detail", focus="Tower")["state"] == "ready"
    client.ok("module.status", {"module_id": mid})


CASES = {
    "inventory": inventory, "navigation": navigation, "reviewed-opening": reviewed_opening,
    "guidance": guidance, "opening-choices": choices, "deepening-assets": deepening_assets,
    "leases": leases, "metadata-recovery": metadata_recovery, "source-repair": source_repair,
}


@pytest.mark.parametrize("name", CASES)
def test_modules_match_current_python(name):
    root = retained(name)
    results = []
    for label in ("python", "typescript"):
        owners = Owners(root, label)
        try:
            CASES[name](owners)
        finally:
            results.append(owners.finish())
    findings = differences(results[0], results[1])
    (root / "comparison.json").write_text(json.dumps({"equal": not findings, "differences": findings}, indent=2) + "\n")
    assert not findings, f"Evidence: {root}\n" + "\n".join(findings)
