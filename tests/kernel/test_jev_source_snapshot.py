"""T08 source snapshot and checked-answer reads exercise the TypeScript RPC seam only."""
import hashlib
import json
from pathlib import Path

from module_helpers import bind, indexed, opening, finish, request, claim, observed, write
from test_source_answers import prepared, answer_job
from setup_helpers import confirmed_investigator


def tree(root: Path):
    return {str(path.relative_to(root)): path.read_bytes() for path in root.rglob("*") if path.is_file()}


def test_source_snapshot_is_read_only_and_available_before_any_graph(kernel, tmp_path):
    mid, source = bind(kernel, tmp_path)
    root = kernel.workspace / ".coc" / "modules" / mid
    before = tree(root)

    first = kernel.ok("module.source.snapshot", {"module_id": mid})
    second = kernel.ok("module.source.snapshot", {"module_id": mid})

    assert first == second
    assert set(first) == {"version", "module_id", "generation", "revision", "pdf", "file_sha256", "page_count"}
    assert first["version"] == 1 and first["module_id"] == mid and first["generation"] == 0
    assert first["file_sha256"] == source["file_sha256"] and first["page_count"] == source["page_count"]
    assert first["pdf"] == str(root / "source.pdf")
    assert len(first["revision"]) == 64 and all(char in "0123456789abcdef" for char in first["revision"])
    assert not (root / "graph.json").exists()
    assert tree(root) == before


def test_checked_answer_peek_miss_is_read_only_and_creates_no_job(kernel, tmp_path):
    mid, _ = indexed(kernel, tmp_path)
    root = kernel.workspace / ".coc" / "modules" / mid
    before = tree(root)

    result = kernel.ok("module.source.answer.peek", {
        "module_id": mid,
        "focus": "Lena",
        "question": "What does the source say about her work?",
    })

    assert result == {"cached": False}
    assert tree(root) == before


def test_checked_answer_peek_rebuilds_from_retained_checked_bytes(kernel, tmp_path):
    mid, root = prepared(kernel, tmp_path)
    params, job, draft, _ = answer_job(kernel, mid)
    accepted = finish(kernel, job)["source_answer"]
    module_path = root / "module.json"
    meta = json.loads(module_path.read_text())
    rows = list(meta["reading"]["answers"].values())
    assert len(rows) == 1
    rows[0]["result"] = {"source_answer": {"answer": "poisoned duplicate result"}}
    module_path.write_text(json.dumps(meta), encoding="utf-8")

    peek = kernel.ok("module.source.answer.peek", {
        "module_id": mid,
        "focus": params["focus"],
        "question": params["question"],
    })

    assert peek["cached"] is True
    assert peek["source_answer"]["answer"] == draft["answer"] == accepted["answer"]
    assert peek["source_answer"]["derivation"] == "checked_summary"
    assert "poisoned" not in json.dumps(peek)
    evidence = peek["evidence"]
    assert evidence["derived"] is True and evidence["record"] == draft
    assert evidence["resource"].startswith(f"source-answer:{mid}:")
    assert evidence["revision"] == evidence["accepted_revision"] == hashlib.sha256(
        (Path(job["work_dir"]) / "draft.json").read_bytes()).hexdigest()
    assert evidence["source_sha256"] == meta["source_document"]["file_sha256"]

    review_path = Path(job["work_dir"]) / "review.json"
    review_bytes = review_path.read_bytes()
    review_path.write_bytes(review_bytes + b" ")
    error = kernel.err("module.source.answer.peek", {
        "module_id": mid,
        "focus": params["focus"],
        "question": params["question"],
    })
    assert error["code"] == "needs" and error["details"]["reason"] == "source_answer_integrity"
    review_path.write_bytes(review_bytes)

    changed = json.loads(module_path.read_text())
    changed["generation"] += 1
    module_path.write_text(json.dumps(changed), encoding="utf-8")
    assert kernel.ok("module.source.answer.peek", {
        "module_id": mid,
        "focus": params["focus"],
        "question": params["question"],
    }) == {"cached": False}


def test_task_source_revision_ignores_reader_ledger_but_changes_with_graph(kernel, tmp_path):
    mid, _ = indexed(kernel, tmp_path)
    opening_job, _, _ = opening(kernel, mid)
    finish(kernel, opening_job)
    campaign = "source-revision"
    kernel.ok("campaign.create", {"id": campaign, "module": mid, "play_language": "en"})
    confirmed_investigator(kernel, campaign=campaign, name="Reader")
    kernel.ok("setup.complete", {"campaign": campaign})
    kernel.ok("table.open", {"campaign": campaign})
    before = kernel.ok("table.capsule", {"campaign": campaign})["_context"]
    module_before = kernel.ok("module.source.snapshot", {"module_id": mid})
    assert isinstance(before["task_source_revision"], str)

    answer_job(kernel, mid, campaign=campaign)
    after_ledger = kernel.ok("table.capsule", {"campaign": campaign})["_context"]
    assert after_ledger["source_revision"] == before["source_revision"], "existing KIC source binding stays unchanged"
    assert after_ledger["task_source_revision"] == before["task_source_revision"]

    request(kernel, mid, "detail", focus="Dock", question="What does the harbor look like?")
    graph_job = claim(kernel, mid)
    observed(graph_job)
    write(Path(graph_job["work_dir"]) / "draft.json", {
        "nodes": [{"node_id": "scene-dock", "node_kind": "scene", "name": "Dock",
                   "source_refs": [{"page": 1}], "properties": {"keeper_notes": "A changed harbor."}}],
        "claims": [], "node_refs": [], "coverage": {}, "dependencies": [], "critical": [],
        "ready_nodes": ["scene-dock"],
    })
    write(Path(graph_job["work_dir"]) / "review.json", {
        "checked": [{"paths": ["/nodes/0", "/coverage"], "verdict": "supported",
                     "source_refs": [{"page": 1}], "reason": "Fixture source support."}],
        "missing": [],
    })
    finish(kernel, graph_job)
    module_after = kernel.ok("module.source.snapshot", {"module_id": mid})
    assert module_after["revision"] != module_before["revision"]

    # The existing campaign remains pinned to its accepted source cohort. A campaign created after
    # the real graph publication receives the new graph/source task binding.
    assert kernel.ok("table.capsule", {"campaign": campaign})["_context"]["task_source_revision"] == before["task_source_revision"]
    changed_campaign = "source-revision-after-graph"
    kernel.ok("campaign.create", {"id": changed_campaign, "module": mid, "play_language": "en"})
    confirmed_investigator(kernel, campaign=changed_campaign, name="Later Reader")
    kernel.ok("setup.complete", {"campaign": changed_campaign})
    kernel.ok("table.open", {"campaign": changed_campaign})
    after_graph = kernel.ok("table.capsule", {"campaign": changed_campaign})["_context"]
    assert after_graph["task_source_revision"] != before["task_source_revision"]
    assert after_graph["source_revision"] != after_ledger["source_revision"]
