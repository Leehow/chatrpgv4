"""Quest v1 progressive wiring: skeleton quest index, deepen queue, mentions.

Deterministic checks for the parse-side integration only (no runtime ops):
- skeleton.json may carry a Tier 1B ``quest_index`` (locator-thin rows);
- quest entities ride the existing shared deepen lane (``deepen_quest``)
  through enqueue → claim → host-work request → put_entity fulfillment;
- structured ``mentions`` may target quests (``{"kind":"quest","ref_id":...}``)
  and stub+enqueue them through the normal progressive path;
- quest ids accept the bare slug or the full ``quest-<slug>`` form and
  canonicalize to one store file (Model-Facing Identifier Law).
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
import os
from pathlib import Path

import pytest

# put_entity deep quests kick the shared background worker; keep these tests
# free of real background writers.
os.environ["COC_DISABLE_QUEUE_WORKER"] = "1"

SCRIPTS = Path("plugins/coc-keeper/scripts")


def _load(name: str, rel: str):
    spec = importlib.util.spec_from_file_location(name, rel)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


assets = _load(
    "coc_module_assets_quest_prog", str(SCRIPTS / "coc_module_assets.py"),
)
queue_worker = _load(
    "coc_module_queue_worker_quest_prog",
    str(SCRIPTS / "coc_module_queue_worker.py"),
)
project = _load(
    "coc_module_project_quest_prog", str(SCRIPTS / "coc_module_project.py"),
)

FAKE_SHA = "c" * 64


# --- fixtures ----------------------------------------------------------------


def _minimal_skeleton(**overrides) -> dict:
    base = {
        "schema_version": 1,
        "parse_tier": 1,
        "source": {
            "source_id": "pdf:prog-quest",
            "file_sha256": FAKE_SHA,
            "page_count": 4,
        },
        "start_candidates": ["opening"],
        "locations": [
            {"location_id": "opening", "title": "Opening", "parse_state": "named_only"},
        ],
        "edges_provisional": [],
        "npc_roster": [],
        "item_roster": [],
        "handouts": [],
        "threats": [],
        "mechanics_locator_pass_status": "pending",
        "start_clock_status": "unresolved",
    }
    base.update(overrides)
    return base


def _quest_index_row(**overrides) -> dict:
    row = {
        "quest_id": "quest-escort-macario",
        "title": "押送麦克里奥家的遗物",
        "giver": {"kind": "npc", "ref_id": "npc-mr-knott"},
        "importance": "core",
        "status": "located",
        "source_page_indices": [2],
    }
    row.update(overrides)
    return row


def _register_bound_root(tmp_path: Path) -> str:
    """One source-bound asset root with four accepted pages (pdf_index 0..3)."""
    pdf = tmp_path / "prog-quest.pdf"
    pdf.write_bytes(b"%PDF progressive quest fixture")
    file_sha = hashlib.sha256(pdf.read_bytes()).hexdigest()
    bundle = tmp_path / "prog-quest-source"
    bundle.mkdir()
    pages = []
    for pdf_index in range(4):
        page_bytes = (
            f"# Source page {pdf_index}\n\nAccepted quest fixture page.\n"
        ).encode()
        markdown_path = f"page-{pdf_index:04d}.md"
        (bundle / markdown_path).write_bytes(page_bytes)
        pages.append({
            "pdf_index": pdf_index,
            "markdown_path": markdown_path,
            "text_sha256": hashlib.sha256(page_bytes).hexdigest(),
            "review_state": "manual_accepted",
            "parse_confidence": 0.99,
            "grep_anchors": [f"Source page {pdf_index}"],
        })
    (bundle / "manifest.json").write_text(json.dumps({
        "schema_version": 1,
        "producer": "codex-pdf-skill",
        "source": {
            "source_id": "pdf:prog-quest",
            "title": "Progressive Quest Demo",
            "path": str(pdf),
            "file_sha256": file_sha,
            "page_count": 4,
        },
        "pages": pages,
    }), encoding="utf-8")
    return assets.register_source_bundle(
        tmp_path, bundle, asset_root_id="prog-quest",
    )["asset_root_id"]


def _put_skeleton_with_quest(tmp_path: Path, root_id: str, rows: list) -> None:
    identity = json.loads(
        (tmp_path / ".coc" / "module-assets" / root_id / "identity.json")
        .read_text(encoding="utf-8")
    )
    skeleton = _minimal_skeleton()
    skeleton["source"] = {
        key: identity["source"][key]
        for key in ("source_id", "file_sha256", "page_count", "producer")
    }
    skeleton["quest_index"] = rows
    assets.put_skeleton(tmp_path, root_id, skeleton)


def _valid_deep_quest(**overrides) -> dict:
    base = {
        "title": "押送麦克里奥家的遗物",
        "quest_kinds": ["escort-deliver"],
        "importance": "core",
        "giver": {"kind": "npc", "ref_id": "npc-mr-knott"},
        "brief": "keeper 侧：周日正午前把箱子送到亚卡汉姆并当面交付。",
        "completion": {
            "all": [{"kind": "flag_set", "flag_id": "crate_delivered"}],
            "narrative": "KP 确认遗物当面完好交付。",
        },
        "secret": False,
        "provenance": "source",
        "parse_state": "deep",
        "evidence_gap": False,
        "source_refs": [{"pdf_index": 2}],
    }
    base.update(overrides)
    return base


# --- skeleton quest index -----------------------------------------------------


def test_skeleton_accepts_quest_index_and_put_skeleton_roundtrips(tmp_path):
    root_id = _register_bound_root(tmp_path)
    _put_skeleton_with_quest(tmp_path, root_id, [
        _quest_index_row(),
        _quest_index_row(
            quest_id="quest-rumored-deal",
            title="Rumored Deal",
            giver={"kind": "organization", "label": "Chapel remnant"},
            importance="optional",
            status="unresolved",
            source_page_indices=None,
        ),
    ])
    stored = assets.get_skeleton(tmp_path, root_id)
    assert [row["quest_id"] for row in stored["quest_index"]] == [
        "quest-escort-macario", "quest-rumored-deal",
    ]


def test_skeleton_without_quest_index_stays_legal(tmp_path):
    root_id = _register_bound_root(tmp_path)
    _put_skeleton_with_quest(tmp_path, root_id, [])
    assert assets.get_skeleton(tmp_path, root_id).get("quest_index") == []


@pytest.mark.parametrize(
    "label, row",
    [
        ("bad quest_id pattern", _quest_index_row(quest_id="escort-macario")),
        ("bad quest_id slug", _quest_index_row(quest_id="quest-Escort_X")),
        (
            "duplicate quest_id",
            _quest_index_row(),
        ),
        ("missing title", _quest_index_row(title="")),
        ("bad importance", _quest_index_row(importance="side")),
        ("bad status", _quest_index_row(status="not_authored")),
        ("bad giver kind", _quest_index_row(giver={"kind": "patron"})),
        (
            "giver npc without ref",
            _quest_index_row(giver={"kind": "npc", "ref_id": ""}),
        ),
        (
            "giver organization without label",
            _quest_index_row(giver={"kind": "organization", "label": ""}),
        ),
        ("located without indices", _quest_index_row(source_page_indices=[])),
        (
            "located indices out of range",
            _quest_index_row(source_page_indices=[9]),
        ),
        (
            "duplicate indices",
            _quest_index_row(source_page_indices=[2, 2]),
        ),
        (
            "unresolved carries indices",
            _quest_index_row(
                status="unresolved", source_page_indices=[2],
            ),
        ),
        (
            "string source_refs",
            _quest_index_row(source_refs=["page 2"]),
        ),
    ],
)
def test_put_skeleton_rejects_malformed_quest_index(tmp_path, label, row):
    root_id = _register_bound_root(tmp_path)
    rows = [row]
    if label == "duplicate quest_id":
        rows.append(_quest_index_row())
    with pytest.raises(assets.ModuleAssetsError) as excinfo:
        _put_skeleton_with_quest(tmp_path, root_id, rows)
    assert "quest" in str(excinfo.value).lower(), label


# --- quest id alias (Model-Facing Identifier Law) ------------------------------


def test_quest_id_alias_forms_converge_on_one_canonical_store_file(tmp_path):
    assets.init_module_root(
        tmp_path, asset_root_id="demo-alias",
        identity={"canonical_module_id": "demo-alias"}, file_sha256=FAKE_SHA,
    )
    stored = assets.put_entity(
        tmp_path, "demo-alias", "quest", "quest-escort-macario",
        _valid_deep_quest(),
    )
    assert stored["entity_id"] == "quest-escort-macario"
    assert stored["path"].endswith("entities/quest-escort-macario.json")
    by_full = assets.get_entity(tmp_path, "demo-alias", "quest", "quest-escort-macario")
    by_slug = assets.get_entity(tmp_path, "demo-alias", "quest", "escort-macario")
    assert by_full is not None and by_full is by_slug or by_full == by_slug
    assert by_full["quest_id"] == "quest-escort-macario"


def test_quest_double_prefix_id_is_rejected(tmp_path):
    assets.init_module_root(
        tmp_path, asset_root_id="demo-alias",
        identity={"canonical_module_id": "demo-alias"}, file_sha256=FAKE_SHA,
    )
    with pytest.raises(assets.ModuleAssetsError, match="double-prefixed"):
        assets.put_entity(
            tmp_path, "demo-alias", "quest", "quest-quest-x", _valid_deep_quest(),
        )


# --- deepen queue --------------------------------------------------------------


def test_quest_rides_the_shared_deepen_lane():
    assert assets.deepen_job_kind("quest") == "deepen_quest"
    assert assets._job_entity_kind("deepen_quest") == "quest"
    assert "deepen_quest" in assets.JOB_KINDS


def test_quest_stub_inherits_skeleton_index_scope(tmp_path):
    root_id = _register_bound_root(tmp_path)
    _put_skeleton_with_quest(tmp_path, root_id, [_quest_index_row()])
    stub = assets.ensure_stub(
        tmp_path, root_id, "quest", "quest-escort-macario",
        title="押送麦克里奥家的遗物",
    )
    assert stub["created"] is True
    # Full-id mention form canonicalizes to the bare-slug store file.
    assert stub["entity"]["quest_id"] == "quest-escort-macario"
    assert stub["entity"]["parse_state"] == "named_only"
    # The skeleton quest_index row's located pages become the stub's scope.
    assert stub["entity"]["source_page_indices"] == [2]


def test_deepen_quest_enqueues_and_materializes_host_work(tmp_path):
    root_id = _register_bound_root(tmp_path)
    _put_skeleton_with_quest(tmp_path, root_id, [_quest_index_row()])

    enq = assets.enqueue_job(
        tmp_path, root_id,
        kind="deepen_quest", target_id="quest-escort-macario",
        reason="player dig",
    )
    assert enq["enqueued"] is True
    assert enq["job"]["kind"] == "deepen_quest"

    claimed = queue_worker.claim_jobs(
        tmp_path, root_id, limit=5, worker_id="test-worker",
    )
    assert len(claimed) == 1 and claimed[0]["kind"] == "deepen_quest"
    result = queue_worker.process_claimed_job(
        tmp_path, root_id, claimed[0],
    )
    assert result["ok"] is True
    # Pack not deep yet: the job writes the host-work request and closes as
    # awaiting_host_pack, exactly like the npc/item/clue lanes.
    assert result["result"] == "awaiting_host_pack"
    host_request_path = Path(result["host_work_request"])
    request = json.loads(host_request_path.read_text(encoding="utf-8"))
    assert request["kind"] == "deepen_quest"
    assert request["target_id"] == "quest-escort-macario"
    assert request["requested_pdf_indices"] == [2]
    # The request carries quest-specific frozen-contract instructions.
    assert "quest v1 contract" in request["instruction"]
    assert "escort-deliver" in request["instruction"]


def test_deepen_quest_host_fulfillment_closes_request_and_kicks_merge(tmp_path):
    root_id = _register_bound_root(tmp_path)
    _put_skeleton_with_quest(tmp_path, root_id, [_quest_index_row()])
    assets.enqueue_job(
        tmp_path, root_id,
        kind="deepen_quest", target_id="quest-escort-macario", reason="player dig",
    )
    claimed = queue_worker.claim_jobs(
        tmp_path, root_id, limit=5, worker_id="test-worker",
    )
    result = queue_worker.process_claimed_job(tmp_path, root_id, claimed[0])
    job_id = json.loads(
        Path(result["host_work_request"]).read_text(encoding="utf-8")
    )["job_id"]

    stored = assets.put_entity(
        tmp_path, root_id, "quest", "quest-escort-macario",
        _valid_deep_quest(host_work_job_id=job_id),
    )
    request = json.loads(
        (tmp_path / ".coc" / "module-assets" / root_id / "host-work" / f"{job_id}.json")
        .read_text(encoding="utf-8")
    )
    assert request["status"] == "fulfilled"
    # The deep pack kick re-enqueues the shared merge job for the quest lane.
    assert stored["worker"]["enqueue"]["job"]["kind"] == "deepen_quest"


def test_worker_finishes_ready_quest_pack_as_entity_ready(tmp_path):
    root_id = _register_bound_root(tmp_path)
    _put_skeleton_with_quest(tmp_path, root_id, [_quest_index_row()])
    assets.put_entity(
        tmp_path, root_id, "quest", "quest-escort-macario", _valid_deep_quest(),
    )
    # The deep-pack kick already enqueued the merge job; claim and drain it.
    queue = assets.list_queue(tmp_path, root_id)
    assert any(
        job["kind"] == "deepen_quest"
        for job in queue["pending"] + queue["in_flight"]
    )
    claimed = queue_worker.claim_jobs(
        tmp_path, root_id, limit=5, worker_id="test-worker",
    )
    quest_jobs = [job for job in claimed if job["kind"] == "deepen_quest"]
    assert quest_jobs
    result = queue_worker.process_claimed_job(tmp_path, root_id, quest_jobs[0])
    # Quest packs finish entity_ready on the asset store; the campaign IR
    # projection is pending the coc_module_project quest merger (stopped item).
    assert result["ok"] is True
    assert result["result"] == "entity_ready"
    assert result["campaign_projection"] == "pending_quest_merger"


# --- structured mentions -------------------------------------------------------


def test_location_pack_accepts_quest_mention(tmp_path):
    root_id = _register_bound_root(tmp_path)
    _put_skeleton_with_quest(tmp_path, root_id, [])
    pack = {
        "location_id": "opening",
        "title": "Opening",
        "parse_state": "deep",
        "evidence_gap": False,
        "source_page_indices": [0],
        "player_safe_summary": "委托人在书房等候。",
        "mentions": [
            {
                "kind": "quest",
                "ref_id": "quest-escort-macario",
                "raw_label": "押送遗物的委托",
                "source_refs": [{"pdf_index": 0}],
            },
        ],
    }
    stored = assets.put_entity(tmp_path, root_id, "location", "opening", pack)
    assert stored["kind"] == "location"
    got = assets.get_entity(tmp_path, root_id, "location", "opening")
    mention = got["mentions"][0]
    assert mention["kind"] == "quest"
    assert mention["ref_id"] == "quest-escort-macario"
    # put_entity canonicalized the structured mention's source scope.
    assert mention["source_page_indices"] == [0]


def test_quest_mention_follow_stubs_and_enqueues_deepen(tmp_path):
    root_id = _register_bound_root(tmp_path)
    _put_skeleton_with_quest(tmp_path, root_id, [])
    campaign_dir = tmp_path / ".coc" / "campaigns" / "quest-camp"
    (campaign_dir / "scenario").mkdir(parents=True)
    (campaign_dir / "scenario" / "scenario.json").write_text(json.dumps({
        "schema_version": 1,
        "progressive_asset_root_id": root_id,
    }), encoding="utf-8")

    result = project.follow_structured_mentions(
        tmp_path,
        "quest-camp",
        [{
            "kind": "quest",
            "ref_id": "quest-escort-macario",
            "raw_label": "押送遗物的委托",
            "source_refs": [{"pdf_index": 1}],
        }],
        reason="player asks about the commission",
    )
    assert result["progressive"] is True
    followed = result["followed"][0]
    assert followed["kind"] == "quest"
    assert followed["ref_id"] == "quest-escort-macario"
    assert followed["enqueued"] is True

    # The mention stub canonicalizes to the bare-slug store file.
    stub = assets.get_entity(tmp_path, root_id, "quest", "quest-escort-macario")
    assert stub is not None
    assert stub["quest_id"] == "quest-escort-macario"
    assert stub["parse_state"] == "named_only"
    assert stub["source_page_indices"] == [1]

    # The deepen request rides the shared quest lane.
    queue = assets.list_queue(tmp_path, root_id)
    assert any(
        job.get("kind") == "deepen_quest"
        and job.get("target_id") == "quest-escort-macario"
        for job in queue["pending"] + queue["in_flight"]
    )


def test_classification_catalog_includes_skeleton_quests(tmp_path):
    root_id = _register_bound_root(tmp_path)
    _put_skeleton_with_quest(tmp_path, root_id, [_quest_index_row()])
    snapshot = assets.classification_entity_catalog_snapshot(tmp_path, root_id)
    assert {
        "kind": "quest", "id": "quest-escort-macario",
    } in snapshot["entity_catalog"]

    # The same catalog row must survive the section-classification request
    # builder (quest is a legal binding entity kind).
    sections = _load(
        "coc_module_sections_quest_prog", str(SCRIPTS / "coc_module_sections.py"),
    )
    assert "quest" in sections.BINDING_ENTITY_KINDS
    outline = {
        "file_sha256": "d" * 64,
        "outline_sha256": "e" * 64,
        "page_count": 4,
        "rows": [
            {
                "section_id": "sec-commission",
                "title": "The Commission",
                "page": 2,
                "level": 1,
                "previews": {"2": "The patron offers the escort job."},
            },
        ],
    }
    requests = sections.build_classification_requests(
        outline=outline,
        page_previews={2: "The patron offers the escort job."},
        accepted_pdf_indices=[2],
        job_id="job-classify-quest",
        entity_catalog=snapshot["entity_catalog"],
        entity_catalog_provenance=snapshot["entity_catalog_provenance"],
    )
    catalog_kinds = {
        row["kind"]
        for row in requests[0]["entity_catalog"]
    }
    assert "quest" in catalog_kinds
