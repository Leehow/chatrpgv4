#!/usr/bin/env python3
"""Tests for progressive skeleton → campaign IR projection (slices 2–3)."""
from __future__ import annotations

import hashlib
import importlib.util
import json
from pathlib import Path

import pytest

SCRIPTS = Path("plugins/coc-keeper/scripts")
FAKE_SHA = "b" * 64


def _load(name: str, rel: str):
    spec = importlib.util.spec_from_file_location(name, rel)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


assets = _load("coc_module_assets_proj_test", str(SCRIPTS / "coc_module_assets.py"))
mechanics = _load("coc_mechanics_proj_test", str(SCRIPTS / "coc_mechanics.py"))
project = _load("coc_module_project_test", str(SCRIPTS / "coc_module_project.py"))
state = _load("coc_state_proj_test", str(SCRIPTS / "coc_state.py"))
time = _load("coc_time_proj_test", str(SCRIPTS / "coc_time.py"))


def test_compact_queue_reports_current_open_host_work_not_history():
    queue = {
        "schema_version": 1,
        "pending": [],
        "in_flight": [],
        "done": [
            {"job_id": "old-closed", "result": "awaiting_host_pack"},
            {"job_id": "still-open", "result": "awaiting_host_pack"},
        ],
    }
    open_host_work = [{
        "job_id": "still-open",
        "kind": "deepen_location",
        "target_id": "cellar",
        "status": "open",
    }]

    compact = project._compact_queue_snapshot(
        queue, open_host_work=open_host_work,
    )

    assert compact["awaiting_host_count"] == 1
    assert compact["awaiting_host_tail"] == open_host_work
    assert compact["historical_host_handoff_count"] == 2


def test_entity_status_recognizes_skeleton_roster_before_deep_pack(tmp_path: Path):
    assets.init_module_root(
        tmp_path,
        asset_root_id="prog-demo",
        identity={"canonical_module_id": "prog-demo"},
        file_sha256=FAKE_SHA,
    )
    assets.put_skeleton(tmp_path, "prog-demo", _skeleton())

    status = project._entity_status(
        tmp_path, "prog-demo", "npc", "npc-patron"
    )

    assert status == {
        "kind": "npc",
        "entity_id": "npc-patron",
        "exists": True,
        "parse_state": "named_only",
        "evidence_gap": True,
        "deep_ready": False,
        "title": "Patron",
        "source_evidence": None,
        "ingest_timing": None,
    }


def _skeleton():
    return {
        "schema_version": 1,
        "parse_tier": 1,
        "module_identity": {
            "canonical_module_id": "prog-demo",
            "canonical_title": "Progressive Demo",
        },
        "structure_type": "branching_investigation",
        "source": {
            "source_id": "pdf:prog-demo",
            "path": "/tmp/prog-demo.pdf",
            "file_sha256": FAKE_SHA,
            "page_count": 12,
            "producer": "codex-pdf-skill",
        },
        "start_candidates": ["opening"],
        "finale_buckets": [{"id": "finale", "title": "Finale", "importance": "critical"}],
        "locations": [
            {
                "location_id": "opening",
                "title": "Opening Briefing",
                "parse_state": "toc_only",
                "scene_type": "social",
                "location_tags": ["briefing"],
            },
            {
                "location_id": "library",
                "title": "Library",
                "parse_state": "named_only",
                "location_tags": ["research"],
            },
            {
                "location_id": "finale",
                "title": "Finale Site",
                "parse_state": "named_only",
                "is_final": True,
            },
        ],
        "edges_provisional": [
            {
                "from": "opening",
                "to": "library",
                "kind": "travel",
                "confidence": "low",
                "evidence": "toc_adjacency",
            },
            {
                "from": "library",
                "to": "finale",
                "kind": "unlock",
                "confidence": "high",
                "evidence": "clue",
            },
        ],
        "npc_roster": [
            {
                "npc_id": "npc-patron",
                "names": ["Patron"],
                "parse_state": "named_only",
            }
        ],
        "handouts": [],
        "threats": [{"threat_id": "threat-time", "label": "Time pressure", "parse_state": "stub"}],
        "conclusion_buckets": [
            {"id": "what-happened", "title": "What happened", "importance": "critical"}
        ],
        "mechanics_locator_pass_status": "pending",
    }


def _put_source_bound_skeleton(
    tmp_path: Path,
    skeleton: dict | None = None,
) -> dict:
    """Register accepted page evidence before storing PDF-authored fixtures."""
    pdf = tmp_path / "prog-demo.pdf"
    pdf.write_bytes(b"%PDF source-bound progressive fixture")
    file_sha = hashlib.sha256(pdf.read_bytes()).hexdigest()
    bundle = tmp_path / "prog-demo-source"
    bundle.mkdir()
    pages = []
    for pdf_index in range(12):
        page_bytes = (
            f"# Source page {pdf_index}\n\nAccepted progressive fixture page.\n"
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
            "source_id": "pdf:prog-demo",
            "title": "Progressive Demo",
            "path": str(pdf),
            "file_sha256": file_sha,
            "page_count": 12,
        },
        "pages": pages,
    }), encoding="utf-8")
    registration = assets.register_source_bundle(
        tmp_path,
        bundle,
        asset_root_id="prog-demo",
        module_identity={"canonical_module_id": "prog-demo"},
    )
    bound = json.loads(json.dumps(skeleton or _skeleton()))
    bound["source"] = {
        "source_id": "pdf:prog-demo",
        "path": str(pdf),
        "file_sha256": file_sha,
        "page_count": 12,
        "producer": "codex-pdf-skill",
    }
    bound.setdefault("start_clock_status", "unresolved")
    assets.put_skeleton(tmp_path, "prog-demo", bound)
    return registration


def _auto_clue(
    clue_id: str,
    summary: str,
    *,
    delivery_kind: str = "handout",
    pdf_indices: list[int] | None = None,
) -> dict:
    indices = list(pdf_indices if pdf_indices is not None else [0])
    refs = [{"pdf_index": index} for index in indices]
    return {
        "clue_id": clue_id,
        "delivery_kind": delivery_kind,
        "player_safe_summary": summary,
        "source_page_indices": indices,
        "discovery": {
            "mode": "automatic",
            "skill": None,
            "difficulty": None,
        },
        "provenance": {
            "authority": "source_authored",
            "source_refs": refs,
        },
        "source_refs": refs,
    }


def _deep_opening_pack():
    return {
        "location_id": "opening",
        "title": "Opening Briefing",
        "parse_state": "deep",
        "dramatic_question": "Will the investigators accept the commission?",
        "scene_type": "social",
        "source_page_indices": [0],
        "player_safe_summary": "A patron hires the investigators.",
        "available_clue_ids": ["clue-commission"],
        "npc_ids": ["npc-patron"],
        "pressure_moves": ["The patron checks a pocket watch."],
        "san_triggers": [
            {
                "trigger_id": "opening-body",
                "source": "A body is visible beside the patron's desk.",
                "san_loss_success": 0,
                "san_loss_fail_expr": "1D3",
            }
        ],
        "affordances": [
            {
                "id": "accept",
                "cue": "Accept the job and take the retainer.",
                "route_type": "npc_question",
                "status": "open",
            },
            {
                "id": "ask-leads",
                "cue": "Ask where to begin researching.",
                "route_type": "investigative_lead",
                "clue_id": "clue-commission",
                "status": "open",
            },
        ],
        "scene_edges": [
            {
                "to": "library",
                "kind": "unlock",
                "when": {"kind": "clue_discovered", "clue_id": "clue-commission"},
            }
        ],
        "clues": [
            _auto_clue(
                "clue-commission",
                "The patron hires you for $20/day and suggests the library.",
            )
        ],
        "npcs": [
            {
                "npc_id": "npc-patron",
                "name": "Patron",
                "agenda": "Wants the matter resolved quietly and cheaply.",
                "relationship_to_investigators": "employer",
                "social_role": "委托人",
                "voice": "Curt, practical.",
                "parse_state": "deep",
            }
        ],
        "mentions": [
            {"kind": "location", "ref_id": "library", "raw_label": "library"},
        ],
        "keeper_secret_refs": [
            {"id": "secret-real-culprit", "category": "keeper_secret", "prose": "Hidden."}
        ],
    }


def _ready_selected_opening_projection(
    tmp_path: Path,
    *,
    pack: dict | None = None,
    external_npcs: list[dict] | None = None,
    external_clues: list[dict] | None = None,
) -> dict:
    skeleton = json.loads(json.dumps(_skeleton()))
    skeleton["locations"][0]["source_span"] = {
        "pdf_index_start": 0,
        "pdf_index_end": 0,
    }
    registration = _put_source_bound_skeleton(tmp_path, skeleton)
    camp = _make_campaign(tmp_path)
    project.project_skeleton_to_campaign(tmp_path, camp.name, "prog-demo")
    identity = json.loads(
        (
            tmp_path / ".coc" / "module-assets" / "prog-demo"
            / "identity.json"
        ).read_text(encoding="utf-8")
    )
    scenario_path = camp / "scenario" / "scenario.json"
    scenario = json.loads(scenario_path.read_text(encoding="utf-8"))
    scenario.update({
        "source_cache_asset_root_id": "prog-demo",
        "progressive_asset_root_id": "prog-demo",
        "source": {
            **identity["source"],
            "bundle_sha256": registration["bundle_sha256"],
        },
    })
    scenario_path.write_text(
        json.dumps(scenario, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    for npc in external_npcs or []:
        assets.put_entity(
            tmp_path, "prog-demo", "npc", str(npc["npc_id"]), npc,
        )
    for clue in external_clues or []:
        assets.put_entity(
            tmp_path, "prog-demo", "clue", str(clue["clue_id"]), clue,
        )
    assets.put_entity(
        tmp_path,
        "prog-demo",
        "location",
        "opening",
        pack or _deep_opening_pack(),
    )
    stored = assets.get_entity(tmp_path, "prog-demo", "location", "opening")
    root_info = project.resolve_opening_preparation_root(tmp_path, camp.name)
    binding_result = project.resolve_selected_opening_binding(
        tmp_path,
        root_info,
        skeleton,
        "opening",
        None,
    )
    assert binding_result["readiness"]["ready"] is True
    payload = project.build_opening_projection_payload(
        tmp_path,
        "prog-demo",
        "opening",
        binding_result["scope"],
    )
    projected = project.project_selected_opening(
        tmp_path, camp.name, "prog-demo", identity["file_sha256"], "opening",
    )
    return {
        "campaign_dir": camp,
        "identity": identity,
        "source_binding": binding_result["readiness"]["source_binding"],
        "source_scope": binding_result["scope"],
        "payload": payload,
        "expected_slice": project._build_canonical_opening_slice(
            payload, "opening",
        ),
        "projection": projected,
    }


def _source_bound_opening_campaign(tmp_path: Path) -> dict:
    skeleton = json.loads(json.dumps(_skeleton()))
    skeleton["locations"][0]["source_span"] = {
        "pdf_index_start": 0,
        "pdf_index_end": 0,
    }
    registration = _put_source_bound_skeleton(tmp_path, skeleton)
    camp = _make_campaign(tmp_path)
    project.project_skeleton_to_campaign(tmp_path, camp.name, "prog-demo")
    identity = json.loads(
        (
            tmp_path / ".coc" / "module-assets" / "prog-demo"
            / "identity.json"
        ).read_text(encoding="utf-8")
    )
    scenario_path = camp / "scenario" / "scenario.json"
    scenario = json.loads(scenario_path.read_text(encoding="utf-8"))
    scenario.update({
        "source_cache_asset_root_id": "prog-demo",
        "progressive_asset_root_id": "prog-demo",
        "source": {
            **identity["source"],
            "bundle_sha256": registration["bundle_sha256"],
        },
    })
    scenario_path.write_text(
        json.dumps(scenario, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    scope = assets.validate_opening_source_window(
        tmp_path,
        "prog-demo",
        bundle_sha256=registration["bundle_sha256"],
        pdf_indices=[0],
    )
    return {
        "campaign_dir": camp,
        "identity": identity,
        "registration": registration,
        "skeleton": skeleton,
        "scope": scope,
    }


def _scenario_file_bytes(campaign_dir: Path) -> dict[str, bytes]:
    return {
        path.name: path.read_bytes()
        for path in sorted((campaign_dir / "scenario").glob("*.json"))
    }


def test_public_opening_builder_rejects_caller_created_authority_without_root(
    tmp_path: Path,
):
    empty_workspace = tmp_path / "empty-workspace"
    caller_pack = _deep_opening_pack()
    caller_scope = {
        "schema_version": 1,
        "asset_root_id": "missing-root",
        "bundle_sha256": "a" * 64,
        "pdf_indices": [0],
        "page_text_sha256": {"0": "b" * 64},
    }
    caller_binding = {
        "schema_version": 1,
        "authority": "source_authored",
        "asset_root_id": "missing-root",
        "start_location_id": "opening",
        "source_scope": caller_scope,
        "source_scope_signature": assets.opening_source_scope_signature(
            caller_scope
        ),
    }

    # This is the old authority-bearing call shape. The public contract now
    # requires a durable start ID and scope and rejects caller-created pack and
    # binding dictionaries before any source-origin row can be returned.
    with pytest.raises(project.ModuleProjectError):
        project.build_opening_projection_payload(
            empty_workspace,
            "missing-root",
            caller_pack,
            caller_binding,
        )
    assert not (empty_workspace / ".coc" / "module-assets").exists()


def test_public_opening_builder_uses_only_current_durable_pack_and_binding(
    tmp_path: Path,
):
    fixture = _source_bound_opening_campaign(tmp_path)
    assets.put_entity(
        tmp_path,
        "prog-demo",
        "location",
        "opening",
        _deep_opening_pack(),
    )

    payload = project.build_opening_projection_payload(
        tmp_path,
        "prog-demo",
        "opening",
        fixture["scope"],
    )
    canonical_slice = project._build_canonical_opening_slice(
        payload, "opening",
    )
    assert payload["location"]["player_safe_summary"] == (
        "A patron hires the investigators."
    )
    assert payload["source_binding"]["authority"] == "source_authored"
    assert canonical_slice["scene"]["origin"] == "source"

    supplied_pack = json.loads(json.dumps(payload["location"]))
    supplied_pack["player_safe_summary"] = "Caller replacement."
    supplied_binding = json.loads(json.dumps(payload["source_binding"]))
    supplied_binding["source_scope_signature"] = "0" * 64
    with pytest.raises(project.ModuleProjectError):
        project.build_opening_projection_payload(
            tmp_path,
            "prog-demo",
            supplied_pack,
            supplied_binding,
        )


@pytest.mark.parametrize("raw_start", [None, "", "   ", "\t"])
def test_lower_level_project_requires_nonempty_start_before_writes(
    tmp_path: Path,
    raw_start: object,
):
    camp = _make_campaign(tmp_path)
    before = _scenario_file_bytes(camp)
    with pytest.raises(project.OpeningPreparationError) as raised:
        project.project_selected_opening(
            tmp_path,
            camp.name,
            "missing-root",
            FAKE_SHA,
            raw_start,
        )
    assert raised.value.code == "invalid_opening_start"
    assert _scenario_file_bytes(camp) == before


def test_lower_level_opening_selection_never_coerces_non_string_ids(tmp_path: Path):
    skeleton = {
        "start_candidates": ["7", "True"],
        "locations": [
            {"location_id": "7", "title": "Seven"},
            {"location_id": "True", "title": "True"},
        ],
    }
    for raw in (7, True, ["7"], {"id": "7"}):
        with pytest.raises(project.OpeningPreparationError) as raised:
            project.select_opening_start(tmp_path, skeleton, raw)
        assert raised.value.code == "invalid_opening_start"


def _make_campaign(tmp_path: Path, campaign_id: str = "prog-camp") -> Path:
    # create_campaign via coc_state if available
    try:
        state.create_campaign(
            tmp_path,
            campaign_id=campaign_id,
            title="Prog Camp",
            play_language="zh-Hans",
        )
    except TypeError:
        state.create_campaign(tmp_path, campaign_id, "Prog Camp")
    except Exception:
        # minimal fallback
        camp = tmp_path / ".coc" / "campaigns" / campaign_id
        camp.mkdir(parents=True)
        (camp / "campaign.json").write_text(
            json.dumps({
                "schema_version": 1,
                "campaign_id": campaign_id,
                "title": "Prog Camp",
                "status": "setup",
            }),
            encoding="utf-8",
        )
        (camp / "scenario").mkdir(exist_ok=True)
    return tmp_path / ".coc" / "campaigns" / campaign_id


def test_project_skeleton_topology(tmp_path: Path):
    assets.init_module_root(
        tmp_path, asset_root_id="prog-demo", identity={"canonical_module_id": "prog-demo"},
        file_sha256=FAKE_SHA,
    )
    assets.put_skeleton(tmp_path, "prog-demo", _skeleton())
    camp = _make_campaign(tmp_path)
    result = project.project_skeleton_to_campaign(tmp_path, camp.name, "prog-demo")
    assert result["scene_count"] == 3
    sg = json.loads((camp / "scenario" / "story-graph.json").read_text(encoding="utf-8"))
    ids = {s["scene_id"] for s in sg["scenes"]}
    assert ids == {"opening", "library", "finale"}
    opening = next(s for s in sg["scenes"] if s["scene_id"] == "opening")
    assert opening["is_start"] is True
    assert opening["parse_state"] == "toc_only"
    assert any(e["to"] == "library" for e in opening["scene_edges"])
    meta = json.loads((camp / "scenario" / "module-meta.json").read_text(encoding="utf-8"))
    assert meta["progressive"] is True


def test_project_skeleton_refreshes_stale_public_setup_briefing(tmp_path: Path):
    skeleton = json.loads(json.dumps(_skeleton()))
    skeleton["module_identity"]["era"] = "1895 England"
    skeleton["player_safe_summary"] = (
        "1895 年，一群海岸走私者在风暴逼近时运送货物。"
    )
    assets.init_module_root(
        tmp_path,
        asset_root_id="prog-demo",
        identity={"canonical_module_id": "prog-demo"},
        file_sha256=FAKE_SHA,
    )
    assets.put_skeleton(tmp_path, "prog-demo", skeleton)
    camp = _make_campaign(tmp_path)
    _write_json = lambda path, payload: path.write_text(  # noqa: E731
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    _write_json(
        camp / "scenario" / "scenario.json",
        {
            "schema_version": 1,
            "scenario_id": "prog-demo",
            "title": "Progressive Demo",
        },
    )
    initial = project.coc_character_creation_briefing.render_briefing_from_campaign(
        camp,
        repo_root=tmp_path,
        write_back=True,
    )

    project.project_skeleton_to_campaign(tmp_path, camp.name, "prog-demo")

    campaign = json.loads((camp / "campaign.json").read_text(encoding="utf-8"))
    refreshed = campaign["character_creation"]
    markdown = (tmp_path / refreshed["briefing_path"]).read_text(encoding="utf-8")
    assert refreshed["public_setup_sha256"] != initial["public_setup_sha256"]
    assert "**年代**：1890年代" in markdown
    assert "**结构**：分支调查" in markdown
    assert "1895 年，一群海岸走私者" in markdown

    generated_at = refreshed["generated_at"]
    project.project_skeleton_to_campaign(tmp_path, camp.name, "prog-demo")
    campaign = json.loads((camp / "campaign.json").read_text(encoding="utf-8"))
    assert campaign["character_creation"]["generated_at"] == generated_at


def test_project_skeleton_carries_module_daylight_clock_into_campaign(tmp_path: Path):
    skeleton = json.loads(json.dumps(_skeleton()))
    skeleton["module_identity"]["era"] = "1597 Spain"
    skeleton["start_clock"] = {
        "calendar_mode": "gregorian",
        "local_datetime": "1597-06-21T05:00:00",
        "timezone": "Europe/Madrid",
        "display": "1597-06-21 05:00, Albergue",
        "day_phase_boundaries": {
            "morning_start": "05:00",
            "afternoon_start": "12:00",
            "evening_start": "18:00",
            "night_start": "21:00",
        },
    }
    assets.init_module_root(
        tmp_path,
        asset_root_id="prog-demo",
        identity={"canonical_module_id": "prog-demo"},
        file_sha256=FAKE_SHA,
    )
    assets.put_skeleton(tmp_path, "prog-demo", skeleton)
    camp = _make_campaign(tmp_path)

    project.project_skeleton_to_campaign(tmp_path, camp.name, "prog-demo")

    campaign = json.loads((camp / "campaign.json").read_text(encoding="utf-8"))
    time_state = json.loads(
        (camp / "save" / "time-state.json").read_text(encoding="utf-8")
    )
    assert campaign["era"] == "1590s"
    assert time_state["clock"]["local_datetime"] == "1597-06-21T05:00:00"
    assert time_state["clock"]["day_phase_boundaries"]["morning_start"] == "05:00"


def test_source_start_clock_applies_without_redundant_module_era(tmp_path: Path):
    skeleton = json.loads(json.dumps(_skeleton()))
    skeleton["module_identity"].pop("era", None)
    skeleton.pop("era", None)
    skeleton["start_clock_status"] = "source"
    skeleton["start_clock"] = {
        "calendar_mode": "gregorian",
        "local_datetime": "1937-10-13T10:00:00",
        "timezone": "Europe/Samara",
        "display": "1937年10月中旬，古比雪夫 NKVD 指挥室",
    }
    assets.init_module_root(
        tmp_path,
        asset_root_id="prog-demo",
        identity={"canonical_module_id": "prog-demo"},
        file_sha256=FAKE_SHA,
    )
    assets.put_skeleton(tmp_path, "prog-demo", skeleton)
    camp = _make_campaign(tmp_path)

    project.project_skeleton_to_campaign(tmp_path, camp.name, "prog-demo")

    time_state = json.loads(
        (camp / "save" / "time-state.json").read_text(encoding="utf-8")
    )
    assert time_state["clock"]["local_datetime"] == "1937-10-13T10:00:00"
    assert time_state["clock"]["timezone"] == "Europe/Samara"


def test_later_progressive_projection_preserves_zero_elapsed_clock_discontinuity(
    tmp_path: Path,
):
    skeleton = json.loads(json.dumps(_skeleton()))
    skeleton["module_identity"]["era"] = "1895 England"
    skeleton["start_clock"] = {
        "calendar_mode": "gregorian",
        "local_datetime": "1895-01-25T02:00:00",
        "timezone": "Europe/London",
        "display": "1895-01-25 02:00, Dunwich coast",
    }
    assets.init_module_root(
        tmp_path,
        asset_root_id="prog-demo",
        identity={"canonical_module_id": "prog-demo"},
        file_sha256=FAKE_SHA,
    )
    assets.put_skeleton(tmp_path, "prog-demo", skeleton)
    camp = _make_campaign(tmp_path)
    project.project_skeleton_to_campaign(tmp_path, camp.name, "prog-demo")

    shifted = time.record_clock_discontinuity(
        camp,
        discontinuity_kind="time_shift",
        calendar_mode="julian",
        precision="day_phase",
        display="1287年1月1日，上半夜（具体时刻未知）",
        local_date="1287-01-01",
        day_phase="night",
        decision_id="live-shift-to-1287",
        reason="source-authored underwater bell transition",
    )
    assert shifted["elapsed_minutes"] == 0

    # A later deep-pack projection rewrites scenario IR but has no authority
    # to put the live civil clock back at the module opening.
    project.project_skeleton_to_campaign(tmp_path, camp.name, "prog-demo")
    time_state = json.loads(
        (camp / "save" / "time-state.json").read_text(encoding="utf-8")
    )
    clock = time_state["clock"]
    assert clock["elapsed_minutes"] == 0
    assert clock["calendar_mode"] == "julian"
    assert clock["local_datetime"] is None
    assert clock["local_date"] == "1287-01-01"
    assert clock["civil_segment_id"] == "live-shift-to-1287"


def test_project_opening_deep_merges_clue_and_npc(tmp_path: Path):
    _put_source_bound_skeleton(tmp_path)
    pack = _deep_opening_pack()
    assets.put_entity(tmp_path, "prog-demo", "location", "opening", pack)
    camp = _make_campaign(tmp_path)
    result = project.project_opening_deep(tmp_path, camp.name, "prog-demo")
    assert "opening" in result["merged_location_ids"]
    assert result["parse_tier"] == 2

    sg = json.loads((camp / "scenario" / "story-graph.json").read_text(encoding="utf-8"))
    opening = next(s for s in sg["scenes"] if s["scene_id"] == "opening")
    assert opening["parse_state"] == "deep"
    assert "clue-commission" in opening["available_clues"]
    assert len(opening["affordances"]) >= 2
    # deep edges replace provisional
    assert opening["scene_edges"][0]["when"]["kind"] == "clue_discovered"
    assert opening["on_enter"]["san_triggers"] == pack["san_triggers"]

    clues = json.loads((camp / "scenario" / "clue-graph.json").read_text(encoding="utf-8"))
    all_clues = [c for conc in clues["conclusions"] for c in conc.get("clues") or []]
    assert any(c["clue_id"] == "clue-commission" for c in all_clues)
    commission = next(c for c in all_clues if c["clue_id"] == "clue-commission")
    assert "library" in commission["player_safe_summary"] or "patron" in commission[
        "player_safe_summary"
    ].lower() or "$20" in commission["player_safe_summary"]

    npcs = json.loads((camp / "scenario" / "npc-agendas.json").read_text(encoding="utf-8"))
    patron = next(n for n in npcs["npcs"] if n["npc_id"] == "npc-patron")
    assert "quietly" in patron["agenda"]
    assert patron["parse_state"] == "deep"
    assert patron["role_label"] == "委托人"
    assert "social_role" not in patron

    reg = assets.load_registry(tmp_path)
    assert reg["modules"]["prog-demo"]["parse_tier_max"] >= 2


def test_selected_opening_projection_receipt_ignores_mechanics_only_updates(
    tmp_path: Path,
):
    skeleton = json.loads(json.dumps(_skeleton()))
    skeleton["locations"][0]["source_span"] = {
        "pdf_index_start": 0,
        "pdf_index_end": 0,
    }
    registration = _put_source_bound_skeleton(tmp_path, skeleton)
    camp = _make_campaign(tmp_path)
    project.project_skeleton_to_campaign(tmp_path, camp.name, "prog-demo")
    identity = json.loads(
        (
            tmp_path / ".coc" / "module-assets" / "prog-demo" / "identity.json"
        ).read_text(encoding="utf-8")
    )
    scenario_path = camp / "scenario" / "scenario.json"
    scenario = json.loads(scenario_path.read_text(encoding="utf-8"))
    scenario.update({
        "source_cache_asset_root_id": "prog-demo",
        "progressive_asset_root_id": "prog-demo",
        "source": {
            **identity["source"],
            "bundle_sha256": registration["bundle_sha256"],
        },
    })
    scenario_path.write_text(
        json.dumps(scenario, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    pack = _deep_opening_pack()
    pack["mechanics"] = {"status": "unresolved"}
    pack["npcs"][0]["mechanics"] = {
        "status": "authored", "profile": {"derived": {"HP": 10}},
    }
    assets.put_entity(tmp_path, "prog-demo", "location", "opening", pack)

    root_info = project.resolve_opening_preparation_root(tmp_path, camp.name)
    binding_result = project.resolve_selected_opening_binding(
        tmp_path,
        root_info,
        skeleton,
        "opening",
        None,
    )
    assert binding_result["readiness"]["ready"] is True
    payload = project.build_opening_projection_payload(
        tmp_path,
        "prog-demo",
        "opening",
        binding_result["scope"],
    )
    assert "mechanics" not in payload["location"]
    assert "mechanics" not in payload["location"]["npcs"][0]
    first = project.project_selected_opening(
        tmp_path,
        camp.name,
        "prog-demo",
        identity["file_sha256"],
        "opening",
    )
    receipt = first["opening_projection_receipt"]
    assert set(receipt) == {
        "schema_version", "asset_root_id", "start_location_id",
        "source_evidence_sha256", "projection_input_sha256",
    }
    assert first["status"] == "complete"

    updated = assets.get_entity(tmp_path, "prog-demo", "location", "opening")
    updated["mechanics"] = {
        "status": "unresolved", "locator_pass_status": "pending",
    }
    updated["npcs"][0]["mechanics"] = {
        "status": "authored", "profile": {"derived": {"HP": 99}},
    }
    assets.put_entity(tmp_path, "prog-demo", "location", "opening", updated)
    second = project.project_selected_opening(
        tmp_path,
        camp.name,
        "prog-demo",
        identity["file_sha256"],
        "opening",
    )
    assert second["status"] == "current"
    assert second["idempotent"] is True
    assert second["opening_projection_receipt"] == receipt


@pytest.mark.parametrize(
    "tamper_kind",
    [
        "summary",
        "affordance",
        "edge",
        "clue_discovery",
        "clue_provenance",
        "npc_agenda",
        "secret_body",
        "secret_link",
        "source_ref",
    ],
)
def test_selected_opening_projection_freshness_detects_source_slice_tampering(
    tmp_path: Path, tamper_kind: str,
):
    ready = _ready_selected_opening_projection(tmp_path)
    camp = ready["campaign_dir"]
    scenario_dir = camp / "scenario"

    graph_path = scenario_dir / "story-graph.json"
    graph = json.loads(graph_path.read_text(encoding="utf-8"))
    opening = next(row for row in graph["scenes"] if row["scene_id"] == "opening")
    clue_path = scenario_dir / "clue-graph.json"
    clue_graph = json.loads(clue_path.read_text(encoding="utf-8"))
    clue = next(
        row
        for conclusion in clue_graph["conclusions"]
        for row in conclusion.get("clues") or []
        if row.get("clue_id") == "clue-commission"
    )
    npc_path = scenario_dir / "npc-agendas.json"
    npc_graph = json.loads(npc_path.read_text(encoding="utf-8"))
    npc = next(row for row in npc_graph["npcs"] if row["npc_id"] == "npc-patron")
    secret_path = scenario_dir / "improvisation-boundaries.json"
    secret_graph = json.loads(secret_path.read_text(encoding="utf-8"))
    secret = next(
        row for row in secret_graph["keeper_secrets"]
        if row["id"] == "secret-real-culprit"
    )

    if tamper_kind == "summary":
        opening["player_safe_summary"] = "TAMPERED NON-SOURCE OPENING"
    elif tamper_kind == "affordance":
        next(row for row in opening["affordances"] if row["id"] == "accept")[
            "cue"
        ] = "Tampered route"
    elif tamper_kind == "edge":
        opening["scene_edges"][0]["when"] = {"kind": "always"}
    elif tamper_kind == "clue_discovery":
        clue["discovery"] = {
            "mode": "check", "skill": "Library Use", "difficulty": "regular",
        }
    elif tamper_kind == "clue_provenance":
        clue["provenance"]["authority"] = "campaign_improvised"
    elif tamper_kind == "npc_agenda":
        npc["agenda"] = "Tampered agenda"
    elif tamper_kind == "secret_body":
        secret["prose"] = "Tampered secret"
    elif tamper_kind == "secret_link":
        next(
            row for row in opening["keeper_secret_refs"]
            if row["id"] == "secret-real-culprit"
        )["category"] = "tampered"
    elif tamper_kind == "source_ref":
        opening["source_refs"][0]["text_sha256"] = "0" * 64

    for path, doc in (
        (graph_path, graph),
        (clue_path, clue_graph),
        (npc_path, npc_graph),
        (secret_path, secret_graph),
    ):
        path.write_text(
            json.dumps(doc, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )

    assert project.opening_projection_state_is_fresh(
        tmp_path, camp, "prog-demo", "opening", ready["source_scope"],
    ) is False


def test_selected_opening_projection_freshness_ignores_unrelated_and_local_rows(
    tmp_path: Path,
):
    ready = _ready_selected_opening_projection(tmp_path)
    camp = ready["campaign_dir"]
    scenario_dir = camp / "scenario"

    graph_path = scenario_dir / "story-graph.json"
    graph = json.loads(graph_path.read_text(encoding="utf-8"))
    opening = next(row for row in graph["scenes"] if row["scene_id"] == "opening")
    opening["mechanics"] = {"status": "campaign-only"}
    opening["affordances"].append({
        "id": "campaign-local-question",
        "cue": "Ask about a table-created detail.",
        "origin": "campaign_improvised",
    })
    opening["scene_edges"].append({
        "to": "campaign-local-room",
        "kind": "travel",
        "origin": "campaign_progressive_dig",
    })
    graph["scenes"].append({
        "scene_id": "unrelated-scene",
        "origin": "campaign_improvised",
        "is_start": False,
    })
    graph_path.write_text(
        json.dumps(graph, ensure_ascii=False, indent=2) + "\n", encoding="utf-8",
    )

    npc_path = scenario_dir / "npc-agendas.json"
    npc_graph = json.loads(npc_path.read_text(encoding="utf-8"))
    npc_graph["npcs"].append({
        "npc_id": "npc-unrelated",
        "agenda": "Campaign-local agenda.",
        "origin": "campaign_improvised",
    })
    npc_path.write_text(
        json.dumps(npc_graph, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    clue_path = scenario_dir / "clue-graph.json"
    clue_graph = json.loads(clue_path.read_text(encoding="utf-8"))
    clue_graph["conclusions"].append({
        "conclusion_id": "campaign-local",
        "clues": [{
            "clue_id": "clue-unrelated",
            "origin": "campaign_improvised",
            "provenance": {"authority": "campaign_improvised"},
        }],
    })
    clue_path.write_text(
        json.dumps(clue_graph, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    assert project.opening_projection_state_is_fresh(
        tmp_path, camp, "prog-demo", "opening", ready["source_scope"],
    ) is True


def test_selected_opening_projection_repairs_stale_pristine_slice(
    tmp_path: Path,
):
    ready = _ready_selected_opening_projection(tmp_path)
    camp = ready["campaign_dir"]
    graph_path = camp / "scenario" / "story-graph.json"
    graph = json.loads(graph_path.read_text(encoding="utf-8"))
    opening = next(row for row in graph["scenes"] if row["scene_id"] == "opening")
    opening["player_safe_summary"] = "TAMPERED"
    opening["affordances"].append({
        "id": "campaign-local-question",
        "cue": "Ask about the table-created detail.",
        "origin": "campaign_improvised",
    })
    opening["scene_edges"].append({
        "to": "campaign-local-room",
        "kind": "travel",
        "origin": "campaign_progressive_dig",
    })
    graph_path.write_text(
        json.dumps(graph, ensure_ascii=False, indent=2) + "\n", encoding="utf-8",
    )

    repaired = project.project_selected_opening(
        tmp_path,
        camp.name,
        "prog-demo",
        ready["identity"]["file_sha256"],
        "opening",
    )

    assert repaired["status"] == "complete"
    assert repaired["idempotent"] is False
    assert project.opening_projection_state_is_fresh(
        tmp_path, camp, "prog-demo", "opening", ready["source_scope"],
    ) is True
    repaired_graph = json.loads(graph_path.read_text(encoding="utf-8"))
    repaired_scene = next(
        row for row in repaired_graph["scenes"] if row["scene_id"] == "opening"
    )
    assert any(
        row.get("id") == "campaign-local-question"
        for row in repaired_scene["affordances"]
    )
    assert any(
        row.get("to") == "campaign-local-room"
        for row in repaired_scene["scene_edges"]
    )


def test_selected_opening_projection_refuses_stale_non_pristine_slice(
    tmp_path: Path,
):
    ready = _ready_selected_opening_projection(tmp_path)
    camp = ready["campaign_dir"]
    graph_path = camp / "scenario" / "story-graph.json"
    graph = json.loads(graph_path.read_text(encoding="utf-8"))
    opening = next(row for row in graph["scenes"] if row["scene_id"] == "opening")
    opening["player_safe_summary"] = "TAMPERED"
    graph_path.write_text(
        json.dumps(graph, ensure_ascii=False, indent=2) + "\n", encoding="utf-8",
    )
    world_path = camp / "save" / "world-state.json"
    world = json.loads(world_path.read_text(encoding="utf-8"))
    world["visited_scene_ids"] = ["opening"]
    world_path.write_text(
        json.dumps(world, ensure_ascii=False, indent=2) + "\n", encoding="utf-8",
    )
    before = graph_path.read_bytes()

    with pytest.raises(project.OpeningPreparationError) as raised:
        project.project_selected_opening(
            tmp_path,
            camp.name,
            "prog-demo",
            ready["identity"]["file_sha256"],
            "opening",
        )

    assert raised.value.code == "opening_projection_non_pristine"
    assert graph_path.read_bytes() == before


def test_required_opening_npc_must_be_present_in_selected_pack(
    tmp_path: Path,
):
    registration = _put_source_bound_skeleton(tmp_path)
    source_scope = assets.validate_opening_source_window(
        tmp_path,
        "prog-demo",
        bundle_sha256=registration["bundle_sha256"],
        pdf_indices=[0],
    )
    external_npc = {
        "npc_id": "npc-witness",
        "name": "Witness",
        "parse_state": "deep",
        "source_page_indices": [0],
        "agenda": "Tell the investigators what was seen.",
    }
    assets.put_entity(
        tmp_path, "prog-demo", "npc", "npc-witness", external_npc,
    )
    pack = _deep_opening_pack()
    pack["npc_ids"] = []
    pack["npcs"] = []
    assets.put_entity(tmp_path, "prog-demo", "location", "opening", pack)

    unreferenced = project.opening_pack_readiness(
        tmp_path,
        "prog-demo",
        "opening",
        required_npc_ids=["npc-witness"],
        required_source_scope=source_scope,
    )
    assert unreferenced["ready"] is False
    assert unreferenced["present_npc_ids"] == []
    assert {row["code"] for row in unreferenced["blocking"]} == {
        "opening_required_npc_not_present",
    }

    pack["npc_ids"] = ["npc-witness"]
    assets.put_entity(tmp_path, "prog-demo", "location", "opening", pack)
    referenced = project.opening_pack_readiness(
        tmp_path,
        "prog-demo",
        "opening",
        required_npc_ids=["npc-witness"],
        required_source_scope=source_scope,
    )
    assert referenced["ready"] is True
    assert referenced["present_npc_ids"] == ["npc-witness"]

    pack["npc_ids"] = []
    pack["npcs"] = [{
        "npc_id": "npc-embedded",
        "name": "Embedded Witness",
        "agenda": "Stay close to the selected opening.",
        "parse_state": "deep",
    }]
    assets.put_entity(tmp_path, "prog-demo", "location", "opening", pack)
    embedded = project.opening_pack_readiness(
        tmp_path,
        "prog-demo",
        "opening",
        required_npc_ids=["npc-embedded"],
        required_source_scope=source_scope,
    )
    assert embedded["ready"] is True
    assert embedded["present_npc_ids"] == ["npc-embedded"]

    assets.put_entity(tmp_path, "prog-demo", "npc", "npc-empty-agenda", {
        "npc_id": "npc-empty-agenda",
        "name": "Silent Witness",
        "parse_state": "deep",
        "source_page_indices": [0],
    })
    pack["npc_ids"] = ["npc-empty-agenda"]
    pack["npcs"] = []
    assets.put_entity(tmp_path, "prog-demo", "location", "opening", pack)
    missing_agenda = project.opening_pack_readiness(
        tmp_path,
        "prog-demo",
        "opening",
        required_npc_ids=["npc-empty-agenda"],
        required_source_scope=source_scope,
    )
    assert missing_agenda["ready"] is True
    assert missing_agenda["blocking"] == []
    assert missing_agenda["advisories"] == [{
        "code": "opening_npc_agenda_missing",
        "entity_id": "npc-empty-agenda",
    }]

    pack["npc_ids"] = ["npc-absent"]
    assets.put_entity(tmp_path, "prog-demo", "location", "opening", pack)
    missing_npc = project.opening_pack_readiness(
        tmp_path,
        "prog-demo",
        "opening",
        required_npc_ids=["npc-absent"],
        required_source_scope=source_scope,
    )
    assert missing_npc["ready"] is False
    assert missing_npc["advisories"] == []
    assert missing_npc["blocking"] == [{
        "code": "opening_npc_missing",
        "entity_id": "npc-absent",
    }]


@pytest.mark.parametrize("parse_state", ["body_parsed", "deep"])
def test_source_opening_pack_must_cover_exact_window_but_may_cover_extra_pages(
    tmp_path: Path,
    parse_state: str,
):
    fixture = _source_bound_opening_campaign(tmp_path)
    root_info = project.resolve_opening_preparation_root(
        tmp_path, fixture["campaign_dir"].name,
    )
    wrong_page = _deep_opening_pack()
    wrong_page["parse_state"] = parse_state
    wrong_page["source_page_indices"] = [9]
    assets.put_entity(tmp_path, "prog-demo", "location", "opening", wrong_page)

    binding = project.resolve_selected_opening_binding(
        tmp_path, root_info, fixture["skeleton"], "opening", None,
    )
    assert binding["scope"] == fixture["scope"]
    assert binding["readiness"]["ready"] is False
    assert {
        row["code"] for row in binding["readiness"]["blocking"]
    } == {"opening_pack_source_scope_mismatch"}
    before = _scenario_file_bytes(fixture["campaign_dir"])
    with pytest.raises(project.OpeningPreparationError) as raised:
        project.project_selected_opening(
            tmp_path,
            fixture["campaign_dir"].name,
            "prog-demo",
            fixture["identity"]["file_sha256"],
            "opening",
        )
    assert raised.value.code == "opening_pack_source_scope_mismatch"
    assert _scenario_file_bytes(fixture["campaign_dir"]) == before

    covering = _deep_opening_pack()
    covering["parse_state"] = parse_state
    covering["source_page_indices"] = [0, 9]
    assets.put_entity(tmp_path, "prog-demo", "location", "opening", covering)
    binding = project.resolve_selected_opening_binding(
        tmp_path, root_info, fixture["skeleton"], "opening", None,
    )
    assert binding["readiness"]["ready"] is True
    assert binding["readiness"]["source_binding"]["source_scope"] == fixture["scope"]
    completed = project.project_selected_opening(
        tmp_path,
        fixture["campaign_dir"].name,
        "prog-demo",
        fixture["identity"]["file_sha256"],
        "opening",
    )
    assert completed["status"] == "complete"


def test_campaign_local_opening_pack_is_retained_but_never_laundered_as_source(
    tmp_path: Path,
):
    fixture = _source_bound_opening_campaign(tmp_path)
    local_pack = _deep_opening_pack()
    local_pack.pop("source_page_indices", None)
    local_pack["origin"] = "campaign_improvised"
    local_pack["provenance"] = {"authority": "campaign_improvised"}
    assets.put_entity(tmp_path, "prog-demo", "location", "opening", local_pack)
    entity_path = (
        tmp_path / ".coc" / "module-assets" / "prog-demo"
        / "entities" / "location-opening.json"
    )
    entity_before = entity_path.read_bytes()
    scenario_before = _scenario_file_bytes(fixture["campaign_dir"])
    root_info = project.resolve_opening_preparation_root(
        tmp_path, fixture["campaign_dir"].name,
    )

    binding = project.resolve_selected_opening_binding(
        tmp_path, root_info, fixture["skeleton"], "opening", None,
    )
    assert binding["readiness"]["ready"] is False
    codes = {row["code"] for row in binding["readiness"]["blocking"]}
    assert "opening_pack_source_authority_invalid" in codes
    assert "opening_pack_source_evidence_missing" in codes
    with pytest.raises(project.OpeningPreparationError) as raised:
        project.project_selected_opening(
            tmp_path,
            fixture["campaign_dir"].name,
            "prog-demo",
            fixture["identity"]["file_sha256"],
            "opening",
        )
    assert raised.value.code == "opening_pack_source_authority_invalid"
    assert entity_path.read_bytes() == entity_before
    assert _scenario_file_bytes(fixture["campaign_dir"]) == scenario_before


@pytest.mark.parametrize("tamper", ["file", "bundle", "page_ref"])
def test_opening_required_scope_rejects_wrong_bound_identity(
    tmp_path: Path,
    tamper: str,
):
    fixture = _source_bound_opening_campaign(tmp_path)
    assets.put_entity(
        tmp_path, "prog-demo", "location", "opening", _deep_opening_pack(),
    )
    scope = json.loads(json.dumps(fixture["scope"]))
    if tamper == "file":
        scope["file_sha256"] = "0" * 64
    elif tamper == "bundle":
        scope["bundle_sha256"] = "1" * 64
    else:
        scope["page_refs"][0]["text_sha256"] = "2" * 64
    readiness = project.opening_pack_readiness(
        tmp_path,
        "prog-demo",
        "opening",
        required_source_scope=scope,
    )
    assert readiness["ready"] is False
    assert "opening_source_scope_invalid" in {
        row["code"] for row in readiness["blocking"]
    }


def test_opening_pack_stale_stored_evidence_is_not_silently_reauthorized(
    tmp_path: Path,
):
    fixture = _source_bound_opening_campaign(tmp_path)
    assets.put_entity(
        tmp_path, "prog-demo", "location", "opening", _deep_opening_pack(),
    )
    entity_path = (
        tmp_path / ".coc" / "module-assets" / "prog-demo"
        / "entities" / "location-opening.json"
    )
    stored = json.loads(entity_path.read_text(encoding="utf-8"))
    stored["source_evidence"]["file_sha256"] = "0" * 64
    entity_path.write_text(
        json.dumps(stored, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    readiness = project.opening_pack_readiness(
        tmp_path,
        "prog-demo",
        "opening",
        required_source_scope=fixture["scope"],
    )
    assert readiness["ready"] is False
    assert "opening_pack_evidence_stale" in {
        row["code"] for row in readiness["blocking"]
    }


@pytest.mark.parametrize(
    ("tamper", "expected_code"),
    [
        ("source_id", "opening_pack_evidence_invalid"),
        ("text_hash", "opening_pack_evidence_invalid"),
        ("bundle", "opening_pack_evidence_stale"),
    ],
)
def test_opening_pack_rejects_wrong_source_text_or_bundle_claims(
    tmp_path: Path,
    tamper: str,
    expected_code: str,
):
    fixture = _source_bound_opening_campaign(tmp_path)
    assets.put_entity(
        tmp_path, "prog-demo", "location", "opening", _deep_opening_pack(),
    )
    entity_path = (
        tmp_path / ".coc" / "module-assets" / "prog-demo"
        / "entities" / "location-opening.json"
    )
    stored = json.loads(entity_path.read_text(encoding="utf-8"))
    if tamper == "source_id":
        stored["source_refs"][0]["source_id"] = "pdf:wrong-source"
    elif tamper == "text_hash":
        stored["source_refs"][0]["text_sha256"] = "3" * 64
    else:
        stored["source_refs"][0]["bundle_sha256s"] = ["4" * 64]
    entity_path.write_text(
        json.dumps(stored, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    readiness = project.opening_pack_readiness(
        tmp_path,
        "prog-demo",
        "opening",
        required_source_scope=fixture["scope"],
    )
    assert readiness["ready"] is False
    assert expected_code in {row["code"] for row in readiness["blocking"]}


def test_project_opening_rejects_wrong_campaign_bound_root_before_write(
    tmp_path: Path,
):
    fixture = _source_bound_opening_campaign(tmp_path)
    assets.put_entity(
        tmp_path, "prog-demo", "location", "opening", _deep_opening_pack(),
    )
    before = _scenario_file_bytes(fixture["campaign_dir"])
    with pytest.raises(project.OpeningPreparationError) as raised:
        project.project_selected_opening(
            tmp_path,
            fixture["campaign_dir"].name,
            "wrong-root",
            fixture["identity"]["file_sha256"],
            "opening",
        )
    assert raised.value.code == "opening_source_identity_mismatch"
    assert _scenario_file_bytes(fixture["campaign_dir"]) == before


@pytest.mark.parametrize(
    ("source_fields", "tampered_field", "canonical_value"),
    [
        ({"name": "Source Name"}, "display_name", "Source Name"),
        ({"display_name": "Source Display"}, "name", "Source Display"),
    ],
)
def test_external_opening_npc_derived_identity_is_current_independent(
    tmp_path: Path,
    source_fields: dict,
    tampered_field: str,
    canonical_value: str,
):
    pack = _deep_opening_pack()
    pack["npc_ids"] = ["npc-external"]
    pack["npcs"] = []
    external_npc = {
        "npc_id": "npc-external",
        "agenda": "Deliver the source-authored opening warning.",
        "parse_state": "deep",
        "source_page_indices": [0],
        **source_fields,
    }
    ready = _ready_selected_opening_projection(
        tmp_path,
        pack=pack,
        external_npcs=[external_npc],
    )
    npc_path = ready["campaign_dir"] / "scenario" / "npc-agendas.json"
    doc = json.loads(npc_path.read_text(encoding="utf-8"))
    row = next(
        value for value in doc["npcs"]
        if value["npc_id"] == "npc-external"
    )
    assert row[tampered_field] == canonical_value
    row[tampered_field] = "TAMPERED CURRENT VALUE"
    npc_path.write_text(
        json.dumps(doc, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    assert project.opening_projection_state_is_fresh(
        tmp_path, ready["campaign_dir"], "prog-demo", "opening",
        ready["source_scope"],
    ) is False
    repaired = project.project_selected_opening(
        tmp_path,
        ready["campaign_dir"].name,
        "prog-demo",
        ready["identity"]["file_sha256"],
        "opening",
    )
    assert repaired["status"] == "complete"
    repaired_doc = json.loads(npc_path.read_text(encoding="utf-8"))
    repaired_row = next(
        value for value in repaired_doc["npcs"]
        if value["npc_id"] == "npc-external"
    )
    assert repaired_row[tampered_field] == canonical_value
    assert project.opening_projection_state_is_fresh(
        tmp_path, ready["campaign_dir"], "prog-demo", "opening",
        ready["source_scope"],
    ) is True


@pytest.mark.parametrize(
    ("tampered_field", "canonical_value"),
    [
        ("delivery_kind", "obvious"),
        ("visibility", "player-safe"),
        ("parse_state", "named_only"),
        ("origin", "source"),
    ],
)
def test_external_opening_clue_defaults_are_current_independent(
    tmp_path: Path,
    tampered_field: str,
    canonical_value: str,
):
    pack = _deep_opening_pack()
    pack["available_clue_ids"] = ["clue-external"]
    pack["clues"] = []
    external_clue = _auto_clue(
        "clue-external", "A source-authored external opening clue.",
    )
    external_clue.pop("delivery_kind")
    ready = _ready_selected_opening_projection(
        tmp_path,
        pack=pack,
        external_clues=[external_clue],
    )
    clue_path = ready["campaign_dir"] / "scenario" / "clue-graph.json"
    doc = json.loads(clue_path.read_text(encoding="utf-8"))
    row = next(
        value
        for conclusion in doc["conclusions"]
        for value in (conclusion.get("clues") or [])
        if value.get("clue_id") == "clue-external"
    )
    assert row[tampered_field] == canonical_value
    row[tampered_field] = "TAMPERED CURRENT VALUE"
    clue_path.write_text(
        json.dumps(doc, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    assert project.opening_projection_state_is_fresh(
        tmp_path, ready["campaign_dir"], "prog-demo", "opening",
        ready["source_scope"],
    ) is False
    repaired = project.project_selected_opening(
        tmp_path,
        ready["campaign_dir"].name,
        "prog-demo",
        ready["identity"]["file_sha256"],
        "opening",
    )
    assert repaired["status"] == "complete"
    repaired_doc = json.loads(clue_path.read_text(encoding="utf-8"))
    repaired_row = next(
        value
        for conclusion in repaired_doc["conclusions"]
        for value in (conclusion.get("clues") or [])
        if value.get("clue_id") == "clue-external"
    )
    assert repaired_row[tampered_field] == canonical_value
    assert project.opening_projection_state_is_fresh(
        tmp_path, ready["campaign_dir"], "prog-demo", "opening",
        ready["source_scope"],
    ) is True


def test_selected_opening_stable_id_repair_dedupes_spoofs_and_keeps_local_extras(
    tmp_path: Path,
):
    pack = _deep_opening_pack()
    pack["scene_edges"][0]["edge_id"] = "edge-authored-library"
    ready = _ready_selected_opening_projection(tmp_path, pack=pack)
    graph_path = ready["campaign_dir"] / "scenario" / "story-graph.json"
    graph = json.loads(graph_path.read_text(encoding="utf-8"))
    opening = next(
        row for row in graph["scenes"] if row["scene_id"] == "opening"
    )
    opening["affordances"].append({
        "id": "accept",
        "cue": "same-ID campaign spoof",
        "origin": "campaign_improvised",
    })
    authored_edge = next(
        row for row in opening["scene_edges"]
        if row.get("edge_id") == "edge-authored-library"
    )
    authored_edge["to"] = "campaign-local-room"
    authored_edge["origin"] = "campaign_improvised"
    opening["keeper_secret_refs"].append({
        "id": "secret-real-culprit",
        "category": "campaign-spoof",
        "origin": "campaign_improvised",
    })
    opening["affordances"].append({
        "id": "local-affordance",
        "cue": "Keep this local affordance.",
        "origin": "campaign_improvised",
    })
    opening["scene_edges"].append({
        "edge_id": "local-edge",
        "to": "local-annex",
        "kind": "travel",
        "origin": "campaign_progressive_dig",
    })
    opening["keeper_secret_refs"].append({
        "id": "local-secret",
        "category": "keeper_secret",
        "origin": "campaign_improvised",
    })
    graph_path.write_text(
        json.dumps(graph, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    assert project.opening_projection_state_is_fresh(
        tmp_path, ready["campaign_dir"], "prog-demo", "opening",
        ready["source_scope"],
    ) is False

    repaired = project.project_selected_opening(
        tmp_path,
        ready["campaign_dir"].name,
        "prog-demo",
        ready["identity"]["file_sha256"],
        "opening",
    )
    assert repaired["status"] == "complete"
    repaired_graph = json.loads(graph_path.read_text(encoding="utf-8"))
    repaired_scene = next(
        row for row in repaired_graph["scenes"]
        if row["scene_id"] == "opening"
    )
    assert len([
        row for row in repaired_scene["affordances"]
        if row.get("id") == "accept"
    ]) == 1
    repaired_edges = [
        row for row in repaired_scene["scene_edges"]
        if row.get("edge_id") == "edge-authored-library"
    ]
    assert len(repaired_edges) == 1
    assert repaired_edges[0]["to"] == "library"
    assert repaired_edges[0].get("origin") != "campaign_improvised"
    repaired_links = [
        row for row in repaired_scene["keeper_secret_refs"]
        if row.get("id") == "secret-real-culprit"
    ]
    assert repaired_links == [{
        "id": "secret-real-culprit",
        "category": "keeper_secret",
    }]
    assert any(
        row.get("id") == "local-affordance"
        for row in repaired_scene["affordances"]
    )
    assert any(
        row.get("edge_id") == "local-edge"
        for row in repaired_scene["scene_edges"]
    )
    assert any(
        row.get("id") == "local-secret"
        for row in repaired_scene["keeper_secret_refs"]
    )
    assert project.opening_projection_state_is_fresh(
        tmp_path, ready["campaign_dir"], "prog-demo", "opening",
        ready["source_scope"],
    ) is True


def test_idless_structured_duplicate_cannot_evade_collision_with_local_provenance(
    tmp_path: Path,
):
    pack = _deep_opening_pack()
    pack["affordances"] = [{
        "cue": "Inspect the source-authored desk.",
        "route_type": "investigative_lead",
        "status": "open",
    }]
    ready = _ready_selected_opening_projection(tmp_path, pack=pack)
    graph_path = ready["campaign_dir"] / "scenario" / "story-graph.json"
    graph = json.loads(graph_path.read_text(encoding="utf-8"))
    opening = next(row for row in graph["scenes"] if row["scene_id"] == "opening")
    duplicate = json.loads(json.dumps(opening["affordances"][0]))
    duplicate["origin"] = "campaign_improvised"
    duplicate["provenance"] = {"authority": "campaign_improvised"}
    opening["affordances"].append(duplicate)
    graph_path.write_text(
        json.dumps(graph, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    assert project.opening_projection_state_is_fresh(
        tmp_path, ready["campaign_dir"], "prog-demo", "opening",
        ready["source_scope"],
    ) is False

    repaired = project.project_selected_opening(
        tmp_path,
        ready["campaign_dir"].name,
        "prog-demo",
        ready["identity"]["file_sha256"],
        "opening",
    )
    assert repaired["status"] == "complete"
    repaired_graph = json.loads(graph_path.read_text(encoding="utf-8"))
    repaired_scene = next(
        row for row in repaired_graph["scenes"] if row["scene_id"] == "opening"
    )
    assert repaired_scene["affordances"] == pack["affordances"]
    current = project.project_selected_opening(
        tmp_path,
        ready["campaign_dir"].name,
        "prog-demo",
        ready["identity"]["file_sha256"],
        "opening",
    )
    assert current["status"] == "current"
    assert current["idempotent"] is True


@pytest.mark.parametrize(
    ("kind", "expected", "spoof"),
    [
        (
            "affordance",
            {"affordance_id": "source-row", "cue": "Source cue"},
            {
                "id": "local-mask",
                "affordance_id": "source-row",
                "cue": "Spoof cue",
                "origin": "campaign_improvised",
            },
        ),
        (
            "edge",
            {"edge_id": "source-row", "to": "library", "kind": "travel"},
            {
                "id": "local-mask",
                "edge_id": "source-row",
                "to": "spoof-room",
                "kind": "travel",
                "origin": "campaign_improvised",
            },
        ),
        (
            "secret_link",
            {"secret_id": "source-row", "category": "keeper_secret"},
            {
                "id": "local-mask",
                "secret_id": "source-row",
                "category": "spoof",
                "origin": "campaign_improvised",
            },
        ),
    ],
)
def test_every_structured_alias_participates_in_collision_repair(
    kind: str,
    expected: dict,
    spoof: dict,
):
    assert project._opening_structured_rows_are_fresh(
        [expected], [expected, spoof], kind=kind,
    ) is False
    repaired = project._opening_reconcile_structured_rows(
        [expected], [expected, spoof], kind=kind,
    )
    assert repaired == [expected]


def test_project_repairs_primary_id_masking_authored_alternate_aliases(
    tmp_path: Path,
):
    pack = _deep_opening_pack()
    pack["affordances"] = [{
        "affordance_id": "source-affordance",
        "cue": "Use the authored affordance.",
        "status": "open",
    }]
    pack["scene_edges"] = [{
        "edge_id": "source-edge",
        "to": "library",
        "kind": "travel",
    }]
    ready = _ready_selected_opening_projection(tmp_path, pack=pack)
    graph_path = ready["campaign_dir"] / "scenario" / "story-graph.json"
    graph = json.loads(graph_path.read_text(encoding="utf-8"))
    opening = next(row for row in graph["scenes"] if row["scene_id"] == "opening")
    opening["affordances"].append({
        "id": "local-mask-affordance",
        "affordance_id": "source-affordance",
        "cue": "Spoof",
        "origin": "campaign_improvised",
    })
    opening["scene_edges"].append({
        "id": "local-mask-edge",
        "edge_id": "source-edge",
        "to": "spoof-room",
        "kind": "travel",
        "origin": "campaign_improvised",
    })
    graph_path.write_text(
        json.dumps(graph, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    assert project.opening_projection_state_is_fresh(
        tmp_path, ready["campaign_dir"], "prog-demo", "opening",
        ready["source_scope"],
    ) is False
    project.project_selected_opening(
        tmp_path,
        ready["campaign_dir"].name,
        "prog-demo",
        ready["identity"]["file_sha256"],
        "opening",
    )
    repaired_graph = json.loads(graph_path.read_text(encoding="utf-8"))
    repaired_scene = next(
        row for row in repaired_graph["scenes"] if row["scene_id"] == "opening"
    )
    assert repaired_scene["affordances"] == pack["affordances"]
    assert repaired_scene["scene_edges"] == pack["scene_edges"]
    assert project.opening_projection_state_is_fresh(
        tmp_path, ready["campaign_dir"], "prog-demo", "opening",
        ready["source_scope"],
    ) is True


def test_ambiguous_structured_alias_rejects_before_any_scenario_write(
    tmp_path: Path,
):
    pack = _deep_opening_pack()
    pack["affordances"] = [
        {"id": "source-a", "cue": "First source affordance"},
        {"affordance_id": "source-b", "cue": "Second source affordance"},
    ]
    ready = _ready_selected_opening_projection(tmp_path, pack=pack)
    graph_path = ready["campaign_dir"] / "scenario" / "story-graph.json"
    graph = json.loads(graph_path.read_text(encoding="utf-8"))
    opening = next(row for row in graph["scenes"] if row["scene_id"] == "opening")
    opening["affordances"].append({
        "id": "source-a",
        "affordance_id": "source-b",
        "cue": "Ambiguous local bridge",
        "origin": "campaign_improvised",
    })
    graph_path.write_text(
        json.dumps(graph, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    before = _scenario_file_bytes(ready["campaign_dir"])
    with pytest.raises(project.OpeningPreparationError) as raised:
        project.project_selected_opening(
            tmp_path,
            ready["campaign_dir"].name,
            "prog-demo",
            ready["identity"]["file_sha256"],
            "opening",
        )
    assert raised.value.code == "opening_projection_identity_ambiguous"
    assert _scenario_file_bytes(ready["campaign_dir"]) == before


def test_pristine_projection_reconciles_duplicate_scene_and_conclusion_roots(
    tmp_path: Path,
):
    ready = _ready_selected_opening_projection(tmp_path)
    graph_path = ready["campaign_dir"] / "scenario" / "story-graph.json"
    graph = json.loads(graph_path.read_text(encoding="utf-8"))
    graph["scenes"].append({
        "scene_id": "opening",
        "duplicate_local_key": "preserve-me",
        "affordances": [{
            "id": "local-duplicate-root-affordance",
            "cue": "A local extra on the duplicate root.",
            "origin": "campaign_improvised",
        }],
        "scene_edges": [],
        "keeper_secret_refs": [],
        "origin": "campaign_improvised",
    })
    graph["scenes"].append({
        "scene_id": "unrelated-scene",
        "unrelated": True,
    })
    graph_path.write_text(
        json.dumps(graph, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    clue_path = ready["campaign_dir"] / "scenario" / "clue-graph.json"
    clue_graph = json.loads(clue_path.read_text(encoding="utf-8"))
    clue_graph["conclusions"].append({
        "conclusion_id": "progressive-local",
        "duplicate_local_key": "preserve-me-too",
        "clues": [{
            "clue_id": "local-unrelated-clue",
            "origin": "campaign_improvised",
        }],
    })
    clue_graph["conclusions"].append({
        "conclusion_id": "unrelated-conclusion",
        "clues": [],
    })
    clue_path.write_text(
        json.dumps(clue_graph, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    repaired = project.project_selected_opening(
        tmp_path,
        ready["campaign_dir"].name,
        "prog-demo",
        ready["identity"]["file_sha256"],
        "opening",
    )
    assert repaired["status"] == "complete"
    repaired_graph = json.loads(graph_path.read_text(encoding="utf-8"))
    scene_matches = [
        row for row in repaired_graph["scenes"] if row.get("scene_id") == "opening"
    ]
    assert len(scene_matches) == 1
    assert scene_matches[0]["duplicate_local_key"] == "preserve-me"
    assert any(
        row.get("id") == "local-duplicate-root-affordance"
        for row in scene_matches[0]["affordances"]
    )
    assert any(
        row.get("scene_id") == "unrelated-scene"
        for row in repaired_graph["scenes"]
    )
    repaired_clues = json.loads(clue_path.read_text(encoding="utf-8"))
    conclusion_matches = [
        row for row in repaired_clues["conclusions"]
        if row.get("conclusion_id") == "progressive-local"
    ]
    assert len(conclusion_matches) == 1
    assert conclusion_matches[0]["duplicate_local_key"] == "preserve-me-too"
    assert any(
        row.get("clue_id") == "local-unrelated-clue"
        for row in conclusion_matches[0]["clues"]
    )
    assert any(
        row.get("conclusion_id") == "unrelated-conclusion"
        for row in repaired_clues["conclusions"]
    )
    current = project.project_selected_opening(
        tmp_path,
        ready["campaign_dir"].name,
        "prog-demo",
        ready["identity"]["file_sha256"],
        "opening",
    )
    assert current["status"] == "current"
    assert current["idempotent"] is True


def test_nonpristine_duplicate_roots_refuse_without_scenario_write(
    tmp_path: Path,
):
    ready = _ready_selected_opening_projection(tmp_path)
    graph_path = ready["campaign_dir"] / "scenario" / "story-graph.json"
    graph = json.loads(graph_path.read_text(encoding="utf-8"))
    graph["scenes"].append({"scene_id": "opening", "origin": "campaign_improvised"})
    graph_path.write_text(
        json.dumps(graph, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    clue_path = ready["campaign_dir"] / "scenario" / "clue-graph.json"
    clue_graph = json.loads(clue_path.read_text(encoding="utf-8"))
    clue_graph["conclusions"].append({
        "conclusion_id": "progressive-local", "clues": [],
    })
    clue_path.write_text(
        json.dumps(clue_graph, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    world_path = ready["campaign_dir"] / "save" / "world-state.json"
    world = json.loads(world_path.read_text(encoding="utf-8"))
    world["visited_scene_ids"] = ["opening"]
    world_path.write_text(
        json.dumps(world, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    before = _scenario_file_bytes(ready["campaign_dir"])
    with pytest.raises(project.OpeningPreparationError) as raised:
        project.project_selected_opening(
            tmp_path,
            ready["campaign_dir"].name,
            "prog-demo",
            ready["identity"]["file_sha256"],
            "opening",
        )
    assert raised.value.code == "opening_projection_non_pristine"
    assert _scenario_file_bytes(ready["campaign_dir"]) == before


def test_selected_opening_nonpristine_identity_collision_writes_no_scenario_file(
    tmp_path: Path,
):
    pack = _deep_opening_pack()
    pack["scene_edges"][0]["edge_id"] = "edge-authored-library"
    ready = _ready_selected_opening_projection(tmp_path, pack=pack)
    graph_path = ready["campaign_dir"] / "scenario" / "story-graph.json"
    graph = json.loads(graph_path.read_text(encoding="utf-8"))
    opening = next(
        row for row in graph["scenes"] if row["scene_id"] == "opening"
    )
    edge = next(
        row for row in opening["scene_edges"]
        if row.get("edge_id") == "edge-authored-library"
    )
    edge.update({
        "to": "campaign-local-room",
        "origin": "campaign_improvised",
    })
    opening["affordances"].append({
        "id": "accept",
        "cue": "same-ID campaign spoof",
        "origin": "campaign_improvised",
    })
    opening["keeper_secret_refs"].append({
        "id": "secret-real-culprit",
        "category": "campaign-spoof",
        "origin": "campaign_improvised",
    })
    graph_path.write_text(
        json.dumps(graph, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    world_path = ready["campaign_dir"] / "save" / "world-state.json"
    world = json.loads(world_path.read_text(encoding="utf-8"))
    world["visited_scene_ids"] = ["opening"]
    world_path.write_text(
        json.dumps(world, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    scenario_dir = ready["campaign_dir"] / "scenario"
    before = {
        path.name: path.read_bytes() for path in scenario_dir.glob("*.json")
    }

    with pytest.raises(project.OpeningPreparationError) as raised:
        project.project_selected_opening(
            tmp_path,
            ready["campaign_dir"].name,
            "prog-demo",
            ready["identity"]["file_sha256"],
            "opening",
        )

    assert raised.value.code == "opening_projection_non_pristine"
    assert {
        path.name: path.read_bytes() for path in scenario_dir.glob("*.json")
    } == before


def test_host_npc_public_fields_reach_canonical_consumers(tmp_path: Path):
    _put_source_bound_skeleton(tmp_path)
    pack = _deep_opening_pack()
    npc = pack["npcs"][0]
    npc.pop("agenda")
    npc.pop("voice")
    npc.pop("relationship_to_investigators")
    npc["agenda_public"] = "Deliver the assignment and demand a quick result."
    npc["voice_notes"] = ["Short commands", "Checks the clock"]
    npc["role_tags"] = ["superior", "briefing"]
    camp = _make_campaign(tmp_path)

    project.project_opening_deep(
        tmp_path, camp.name, "prog-demo", deep_packs=[pack],
    )

    agendas = json.loads(
        (camp / "scenario" / "npc-agendas.json").read_text(encoding="utf-8")
    )
    patron = next(row for row in agendas["npcs"] if row["npc_id"] == "npc-patron")
    assert patron["agenda"] == npc["agenda_public"]
    assert patron["voice"] == "Short commands；Checks the clock"
    assert patron["relationship_to_investigators"] == "superior_officer"
    assert patron["social_role"]["initiative_style"] == "decisive"


def test_standalone_deep_npc_public_fields_reach_canonical_consumers():
    ir = project.project_skeleton_to_ir(_skeleton())
    merged = project.merge_deep_npc_into_ir(
        ir,
        {
            "npc_id": "npc-patron",
            "display_name": "Patron",
            "parse_state": "deep",
            "agenda_public": "Keep the real client out of the conversation.",
            "voice_notes": ["Dry", "Precise"],
            "role_tags": ["superior"],
        },
    )
    patron = next(
        row for row in merged["npc-agendas.json"]["npcs"]
        if row["npc_id"] == "npc-patron"
    )
    assert patron["agenda"] == "Keep the real client out of the conversation."
    assert patron["voice"] == "Dry；Precise"
    assert patron["relationship_to_investigators"] == "superior_officer"


def test_opening_deep_requires_pack(tmp_path: Path):
    assets.init_module_root(
        tmp_path, asset_root_id="prog-demo", identity={}, file_sha256=FAKE_SHA,
    )
    assets.put_skeleton(tmp_path, "prog-demo", _skeleton())
    _make_campaign(tmp_path)
    try:
        project.project_opening_deep(tmp_path, "prog-camp", "prog-demo")
        assert False, "expected error"
    except project.ModuleProjectError as exc:
        assert "deep location packs" in str(exc)


def test_host_opening_pack_is_persisted_for_first_scene_entry(tmp_path: Path):
    _put_source_bound_skeleton(tmp_path)
    camp = _make_campaign(tmp_path)
    pack = _deep_opening_pack()

    project.project_opening_deep(
        tmp_path, camp.name, "prog-demo", deep_packs=[pack],
    )

    stored = assets.get_entity(tmp_path, "prog-demo", "location", "opening")
    assert stored is not None
    assert stored["parse_state"] == "deep"
    entered = project.on_enter_scene(tmp_path, camp.name, "opening")
    assert not any(
        "deep-extract location 'opening'" in hint
        for hint in entered["host_hints"]
    )


def test_player_dig_inherits_projected_clue_source_scope(tmp_path: Path):
    _put_source_bound_skeleton(tmp_path)
    pack = _deep_opening_pack()
    pack["clues"][0] = _auto_clue(
        "clue-commission",
        "The patron hires you for $20/day and suggests the library.",
        pdf_indices=[8, 9],
    )
    camp = _make_campaign(tmp_path)
    project.project_opening_deep(
        tmp_path, camp.name, "prog-demo", deep_packs=[pack],
    )

    result = project.request_deepen(
        tmp_path,
        camp.name,
        kind="clue",
        target_id="clue-commission",
        title="Commission",
        reason="player checks the handout wording",
    )

    assert result["followed"][0]["enqueued"] is True
    stub = assets.get_entity(
        tmp_path, "prog-demo", "clue", "clue-commission",
    )
    assert stub is not None
    assert stub["source_page_indices"] == [8, 9]


def test_on_enter_enqueues_neighbors_and_merges_deep_pack(tmp_path: Path):
    _put_source_bound_skeleton(tmp_path)
    assets.put_entity(tmp_path, "prog-demo", "location", "opening", _deep_opening_pack())
    # library deep pack for later enter
    assets.put_entity(
        tmp_path,
        "prog-demo",
        "location",
        "library",
        {
            "location_id": "library",
            "title": "Library",
            "parse_state": "deep",
            "dramatic_question": "What records survive?",
            "scene_type": "investigation",
            "source_page_indices": [0],
            "player_safe_summary": "Stacks of dusty ledgers.",
            "available_clue_ids": ["clue-ledger"],
            "clues": [
                _auto_clue(
                    "clue-ledger",
                    "A ledger names the finale site.",
                )
            ],
            "npcs": [],
            "mentions": [
                {"kind": "location", "ref_id": "finale", "raw_label": "finale site"},
                {
                    "kind": "npc",
                    "ref_id": "npc-absent-archivist",
                    "raw_label": "the former archivist",
                },
            ],
            "scene_edges": [],
            "pressure_moves": [],
            "affordances": [
                {"id": "search", "cue": "Search the stacks", "route_type": "investigative_lead", "status": "open"},
                {"id": "ask", "cue": "Ask the clerk", "route_type": "npc_question", "status": "open"},
            ],
        },
    )
    camp = _make_campaign(tmp_path)
    project.project_opening_deep(tmp_path, camp.name, "prog-demo")

    # Enter library: merge the deep pack and materialize mention topology, but
    # do not deepen every mentioned entity before the player pursues it.
    result = project.on_enter_scene(tmp_path, camp.name, "library")
    assert result["progressive"] is True
    assert result["merged_active"] is True
    assert "opening" in result["neighbors"] or "finale" in result["neighbors"]

    sg = json.loads((camp / "scenario" / "story-graph.json").read_text(encoding="utf-8"))
    library = next(s for s in sg["scenes"] if s["scene_id"] == "library")
    assert library["parse_state"] == "deep"
    assert "clue-ledger" in library["available_clues"]

    finale_stub = assets.get_entity(tmp_path, "prog-demo", "location", "finale")
    assert finale_stub is not None
    assert finale_stub["parse_state"] in {"named_only", "toc_only", "deep", "partial"}
    archivist_stub = assets.get_entity(
        tmp_path, "prog-demo", "npc", "npc-absent-archivist"
    )
    assert archivist_stub is not None
    assert archivist_stub["parse_state"] == "named_only"
    assert "npc-absent-archivist" not in (library.get("npc_ids") or [])

    queue = assets.list_queue(tmp_path, "prog-demo")
    assert not any(
        j.get("target_id") in {"finale", "npc-absent-archivist"}
        and str(j.get("reason") or "").startswith("mention_from:")
        for j in (
            (queue.get("pending") or [])
            + (queue.get("in_flight") or [])
            + (queue.get("done") or [])
        )
    )

    dig = project.request_deepen(
        tmp_path,
        camp.name,
        kind="location",
        target_id="finale",
        title="finale site",
        reason="player materially follows the ledger",
    )
    assert dig["followed"][0]["ref_id"] == "finale"
    assert (
        dig["followed"][0]["enqueued"]
        or dig["followed"][0]["deduped"]
    )


def test_on_enter_consumes_partial_prefetch_while_requesting_deep(tmp_path: Path):
    assets.init_module_root(
        tmp_path,
        asset_root_id="prog-demo",
        identity={"canonical_module_id": "prog-demo"},
        file_sha256=FAKE_SHA,
    )
    assets.put_skeleton(tmp_path, "prog-demo", _skeleton())
    assets.put_entity(
        tmp_path,
        "prog-demo",
        "location",
        "library",
        {
            "location_id": "library",
            "title": "Library",
            "parse_state": "partial",
            "evidence_gap": False,
            "scene_type": "investigation",
            "dramatic_question": "Which catalogue points to the missing file?",
            "player_safe_summary": "A partial prefetch confirms the public stacks.",
            "pressure_moves": ["The reading room closes soon."],
            "affordances": [
                {
                    "id": "check-catalogue",
                    "cue": "Check the public catalogue.",
                    "route_type": "investigative_lead",
                    "status": "open",
                }
            ],
            "source_page_indices": [4],
        },
    )
    camp = _make_campaign(tmp_path)
    project.project_skeleton_to_campaign(tmp_path, camp.name, "prog-demo")

    entered = project.on_enter_scene(tmp_path, camp.name, "library")

    assert entered["merged_active"] is True
    assert any("deep-extract location 'library'" in hint for hint in entered["host_hints"])
    graph = json.loads(
        (camp / "scenario" / "story-graph.json").read_text(encoding="utf-8")
    )
    library = next(row for row in graph["scenes"] if row["scene_id"] == "library")
    assert library["parse_state"] == "partial"
    assert library["dramatic_question"] == "Which catalogue points to the missing file?"
    assert library["pressure_moves"] == ["The reading room closes soon."]


def test_on_enter_sandbox_hub_defers_all_map_neighbor_prefetch(tmp_path: Path):
    skeleton = json.loads(json.dumps(_skeleton()))
    library = next(
        row for row in skeleton["locations"] if row["location_id"] == "library"
    )
    for index in range(6):
        target = f"shop-{index}"
        skeleton["locations"].append({
            "location_id": target,
            "title": f"Shop {index}",
            "parse_state": "named_only",
        })
        skeleton["edges_provisional"].append({
            "from": "library",
            "to": target,
            "kind": "travel",
            "confidence": "med",
            "evidence": "map",
        })
    _put_source_bound_skeleton(tmp_path, skeleton)
    assets.put_entity(tmp_path, "prog-demo", "location", "opening", _deep_opening_pack())
    library_pack = _deep_opening_pack()
    library_pack["location_id"] = "library"
    library_pack["title"] = "Library"
    library_pack["location_tags"] = ["town", "sandbox-hub"]
    library_pack["mentions"] = []
    assets.put_entity(tmp_path, "prog-demo", "location", "library", library_pack)
    camp = _make_campaign(tmp_path)
    project.project_opening_deep(tmp_path, camp.name, "prog-demo")
    queue_path = assets.assets_root(tmp_path) / "prog-demo" / "parse-queue.json"
    queue_path.write_text(json.dumps({
        "schema_version": 1, "pending": [], "in_flight": [], "done": [],
    }), encoding="utf-8")

    result = project.on_enter_scene(tmp_path, camp.name, "library")

    assert result["neighbor_prefetch_budget"] == 0
    assert result["prefetched_neighbors"] == []
    assert set(result["deferred_neighbors"]) >= {
        f"shop-{index}" for index in range(6)
    }
    queue = assets.list_queue(tmp_path, "prog-demo")
    assert not any(
        str(row.get("reason") or "").startswith("neighbor_of:library")
        for row in (queue.get("pending") or []) + (queue.get("in_flight") or [])
    )
    assert "done" not in result["queue"]


def test_on_enter_non_progressive_skips(tmp_path: Path):
    camp = _make_campaign(tmp_path, "plain-camp")
    # no progressive marker / asset root
    (camp / "scenario").mkdir(exist_ok=True)
    (camp / "scenario" / "scenario.json").write_text(
        json.dumps({"schema_version": 1, "scenario_id": "x"}), encoding="utf-8",
    )
    result = project.on_enter_scene(tmp_path, "plain-camp", "anywhere")
    assert result.get("skipped") is True


def test_request_deepen_player_dig_without_scene_move(tmp_path: Path):
    """System gap fix: dig path enqueues without requiring state.move_scene."""
    _put_source_bound_skeleton(tmp_path)
    assets.put_entity(tmp_path, "prog-demo", "location", "opening", _deep_opening_pack())
    camp = _make_campaign(tmp_path)
    project.project_opening_deep(tmp_path, camp.name, "prog-demo")

    result = project.request_deepen(
        tmp_path,
        camp.name,
        kind="location",
        target_id="gypsy-hillside-camp",
        title="山腰营地",
        reason="player_dig:ask_fernando",
    )
    assert result["progressive"] is True
    assert result["target_id"] == "gypsy-hillside-camp"
    status = result.get("status") or {}
    assert status.get("exists") is True
    assert status.get("deep_ready") is False
    assert status.get("evidence_gap") is True
    assert any("host: deep-extract" in h for h in result.get("host_hints") or [])

    stub = assets.get_entity(tmp_path, "prog-demo", "location", "gypsy-hillside-camp")
    assert stub is not None
    assert stub.get("parse_state") == "named_only"
    assert stub.get("evidence_gap") is True
    assert stub.get("dig_pending") is True

    queue = assets.list_queue(tmp_path, "prog-demo")
    pending = queue.get("pending") or []
    assert any(
        j.get("kind") == "deepen_location" and j.get("target_id") == "gypsy-hillside-camp"
        for j in pending
    )
    # Dig target must land on story-graph (not improvised empty scene).
    sg = json.loads((camp / "scenario" / "story-graph.json").read_text(encoding="utf-8"))
    ids = {s["scene_id"] for s in sg["scenes"]}
    assert "gypsy-hillside-camp" in ids
    sk = assets.get_skeleton(tmp_path, "prog-demo")
    assert any(l.get("location_id") == "gypsy-hillside-camp" for l in sk.get("locations") or [])


def test_request_deepen_bounds_completed_queue_history(tmp_path: Path):
    """Live dig receipts must not grow with the durable completed-job log."""
    _put_source_bound_skeleton(tmp_path)
    assets.put_entity(tmp_path, "prog-demo", "location", "opening", _deep_opening_pack())
    camp = _make_campaign(tmp_path)
    project.project_opening_deep(tmp_path, camp.name, "prog-demo")

    queue_path = assets.assets_root(tmp_path) / "prog-demo" / "parse-queue.json"
    queue = assets.list_queue(tmp_path, "prog-demo")
    queue["done"] = [
        {
            "job_id": f"historic-{index}",
            "kind": "deepen_location",
            "target_id": f"historic-location-{index}",
            "result": "merged",
        }
        for index in range(12)
    ]
    queue_path.write_text(
        json.dumps(queue, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    result = project.request_deepen(
        tmp_path,
        camp.name,
        kind="location",
        target_id="bounded-dig",
        title="Bounded Dig",
        reason="player_dig:bounded_receipt",
    )

    receipt_queue = result["queue"]
    assert "done" not in receipt_queue
    assert receipt_queue["done_count"] >= 12
    assert len(receipt_queue["done_tail"]) == 5
    assert all("detail" not in row for row in receipt_queue["done_tail"])
    assert assets.list_queue(tmp_path, "prog-demo")["done"][:12] == queue["done"]


def test_deep_remerge_preserves_player_dig_route(tmp_path: Path):
    _put_source_bound_skeleton(tmp_path)
    assets.put_entity(tmp_path, "prog-demo", "location", "opening", _deep_opening_pack())
    camp = _make_campaign(tmp_path)
    project.project_opening_deep(tmp_path, camp.name, "prog-demo")

    project.project_location_stub_into_campaign(
        tmp_path,
        camp.name,
        "roadside-diner",
        title="Roadside Diner",
        link_from="opening",
        asset_root_id="prog-demo",
    )
    ir = project.load_campaign_ir(camp)
    opening = next(
        scene for scene in ir["story-graph.json"]["scenes"]
        if scene["scene_id"] == "opening"
    )
    route = next(edge for edge in opening["scene_edges"] if edge["to"] == "roadside-diner")
    assert route["origin"] == "campaign_progressive_dig"

    merged = project.merge_deep_location_into_ir(ir, _deep_opening_pack())
    opening_after = next(
        scene for scene in merged["story-graph.json"]["scenes"]
        if scene["scene_id"] == "opening"
    )
    assert any(edge["to"] == "roadside-diner" for edge in opening_after["scene_edges"])
    assert any(
        edge["to"] == "library" and edge["when"]["kind"] == "clue_discovered"
        for edge in opening_after["scene_edges"]
    )


def test_clue_mentions_follow_on_discover(tmp_path: Path):
    """Structured clue.mentions enqueue dig targets (no free-prose scan)."""
    _put_source_bound_skeleton(tmp_path)
    pack = _deep_opening_pack()
    # Attach structured follow-up on a clue (simulates Xavier→gypsy style).
    pack["clues"][0] = _auto_clue(
        "clue-commission",
        "The patron hires you for $20/day and suggests the library.",
        pdf_indices=[5],
    )
    pack["clues"][0]["mentions"] = [
        {"kind": "location", "ref_id": "hillside-camp", "raw_label": "hillside camp"},
        {"kind": "npc", "ref_id": "npc-camp-elder", "raw_label": "camp elder"},
    ]
    assets.put_entity(tmp_path, "prog-demo", "location", "opening", pack)
    camp = _make_campaign(tmp_path)
    project.project_opening_deep(tmp_path, camp.name, "prog-demo")

    # Mentions must survive IR projection.
    clues = json.loads((camp / "scenario" / "clue-graph.json").read_text(encoding="utf-8"))
    all_clues = [c for conc in clues["conclusions"] for c in conc.get("clues") or []]
    commission = next(c for c in all_clues if c["clue_id"] == "clue-commission")
    assert any(m.get("ref_id") == "hillside-camp" for m in commission.get("mentions") or [])

    dig = project.on_clue_discovered(tmp_path, camp.name, "clue-commission")
    assert dig.get("progressive") is True
    followed_ids = {f.get("ref_id") for f in dig.get("followed") or []}
    assert "hillside-camp" in followed_ids
    assert "npc-camp-elder" in followed_ids
    hillside = assets.get_entity(
        tmp_path, "prog-demo", "location", "hillside-camp",
    )
    assert hillside is not None
    assert hillside["source_page_indices"] == [5]
    assert assets.get_entity(tmp_path, "prog-demo", "npc", "npc-camp-elder") is not None
    skeleton = assets.get_skeleton(tmp_path, "prog-demo")
    hillside_row = next(
        row for row in skeleton["locations"]
        if row["location_id"] == "hillside-camp"
    )
    assert hillside_row["source_page_indices"] == [5]
    story = json.loads(
        (camp / "scenario" / "story-graph.json").read_text(encoding="utf-8")
    )
    hillside_scene = next(
        row for row in story["scenes"] if row["scene_id"] == "hillside-camp"
    )
    assert hillside_scene["source_page_indices"] == [5]


def test_projector_does_not_invent_difficulty_from_skill():
    ir = project.project_skeleton_to_ir(_skeleton())
    pack = {
        "location_id": "opening",
        "parse_state": "deep",
        "title": "Opening",
        "player_safe_summary": "Briefing room.",
        "clues": [
            {
                "clue_id": "clue-with-skill-no-difficulty",
                "player_safe_summary": "A ledger mentions Library Use only in prose.",
                "skill": "Library Use",
                "delivery_kind": "obvious",
                "discovery": {
                    "mode": "automatic",
                    "skill": None,
                    "difficulty": None,
                },
                "provenance": {
                    "authority": "source_authored",
                    "source_refs": [{"pdf_index": 1}],
                },
            },
            {
                "clue_id": "clue-check-explicit",
                "player_safe_summary": "A locked diary requires a check.",
                "delivery_kind": "skill_check",
                "discovery": {
                    "mode": "check",
                    "skill": "Spot Hidden",
                    "difficulty": "hard",
                },
                "provenance": {
                    "authority": "source_authored",
                    "source_refs": [{"pdf_index": 1}],
                },
            },
        ],
    }
    merged = project.merge_deep_location_into_ir(ir, pack)
    clues = {
        row["clue_id"]: row
        for conc in merged["clue-graph.json"]["conclusions"]
        for row in (conc.get("clues") or [])
        if isinstance(row, dict)
    }
    auto = clues["clue-with-skill-no-difficulty"]
    assert auto["discovery"]["mode"] == "automatic"
    assert auto["discovery"].get("difficulty") is None
    assert auto.get("difficulty") is None
    check = clues["clue-check-explicit"]
    assert check["discovery"]["mode"] == "check"
    assert check["discovery"]["difficulty"] == "hard"
    assert check["discovery"]["skill"] == "Spot Hidden"


def test_automatic_discovery_survives_put_project_roundtrip(tmp_path: Path):
    _put_source_bound_skeleton(tmp_path)
    camp = _make_campaign(tmp_path, "disc-camp")
    project.project_skeleton_to_campaign(tmp_path, camp.name, "prog-demo")

    pack = {
        "location_id": "opening",
        "parse_state": "deep",
        "title": "Opening Briefing",
        "source_page_indices": [0],
        "player_safe_summary": "A patron hires the investigators.",
        "clues": [{
            "clue_id": "archive-forest-history",
            "player_safe_summary": (
                "Articles going back to the Civil War (no Library Use required)."
            ),
            "delivery_kind": "obvious",
            "discovery": {
                "mode": "automatic",
                "skill": None,
                "difficulty": None,
            },
            "provenance": {
                "authority": "source_authored",
                "source_refs": [{"pdf_index": 0}],
            },
            "source_refs": [{"pdf_index": 0}],
        }],
    }
    assets.put_entity(tmp_path, "prog-demo", "location", "opening", pack)
    stored = assets.get_entity(tmp_path, "prog-demo", "location", "opening")
    assert stored is not None
    assert stored["clues"][0]["discovery"]["mode"] == "automatic"

    ir = project.load_campaign_ir(camp)
    merged = project.merge_deep_location_into_ir(ir, stored)
    clues = [
        row
        for conc in merged["clue-graph.json"]["conclusions"]
        for row in (conc.get("clues") or [])
    ]
    row = next(c for c in clues if c["clue_id"] == "archive-forest-history")
    assert row["discovery"]["mode"] == "automatic"
    assert row["discovery"].get("skill") is None
    assert row["discovery"].get("difficulty") is None
    assert row["player_safe_summary"].startswith("Articles going back")
    assert row["provenance"]["authority"] == "source_authored"
    assert row.get("difficulty") is None


def test_source_bound_canonical_clue_evidence_survives_projection(
    tmp_path: Path,
):
    pdf = tmp_path / "prog-demo.pdf"
    pdf.write_bytes(b"%PDF source-bound projection fixture")
    file_sha = hashlib.sha256(pdf.read_bytes()).hexdigest()
    bundle = tmp_path / "prog-demo-source"
    bundle.mkdir()
    page_bytes = b"# Opening\n\nThe archive clue is automatic.\n"
    (bundle / "page-0000.md").write_bytes(page_bytes)
    page_sha = hashlib.sha256(page_bytes).hexdigest()
    (bundle / "manifest.json").write_text(json.dumps({
        "schema_version": 1,
        "producer": "codex-pdf-skill",
        "source": {
            "source_id": "pdf:prog-demo",
            "title": "Progressive Demo",
            "path": str(pdf),
            "file_sha256": file_sha,
            "page_count": 1,
        },
        "pages": [{
            "pdf_index": 0,
            "markdown_path": "page-0000.md",
            "text_sha256": page_sha,
            "review_state": "manual_accepted",
            "parse_confidence": 0.97,
            "grep_anchors": ["The archive clue is automatic."],
        }],
    }), encoding="utf-8")
    registration = assets.register_source_bundle(
        tmp_path,
        bundle,
        asset_root_id="prog-demo",
        module_identity={"canonical_module_id": "prog-demo"},
    )
    skeleton = _skeleton()
    skeleton["source"] = {
        "source_id": "pdf:prog-demo",
        "path": str(pdf),
        "file_sha256": file_sha,
        "page_count": 1,
        "producer": "codex-pdf-skill",
    }
    skeleton["start_clock_status"] = "unresolved"
    assets.put_skeleton(tmp_path, "prog-demo", skeleton)
    camp = _make_campaign(tmp_path, "source-evidence-camp")
    project.project_skeleton_to_campaign(tmp_path, camp.name, "prog-demo")

    assets.put_entity(tmp_path, "prog-demo", "location", "opening", {
        "location_id": "opening",
        "parse_state": "deep",
        "title": "Opening Briefing",
        "source_page_indices": [0],
        "clues": [{
            "clue_id": "source-bound-archive-clue",
            "player_safe_summary": "The archive clue is visible automatically.",
            "delivery_kind": "obvious",
            "discovery": {
                "mode": "automatic",
                "skill": None,
                "difficulty": None,
            },
            "source_refs": [{"pdf_index": 0}],
            "provenance": {"authority": "source_authored"},
        }],
    })
    stored = assets.get_entity(tmp_path, "prog-demo", "location", "opening")
    stored_clue = stored["clues"][0]
    assert stored_clue["source_evidence"] == {
        "schema_version": 1,
        "source_id": "pdf:prog-demo",
        "file_sha256": file_sha,
        "bundle_sha256s": [registration["bundle_sha256"]],
        "pdf_indices": [0],
        "page_text_sha256": [page_sha],
    }
    assert "source_evidence" not in stored_clue["provenance"]

    ir = project.load_campaign_ir(camp)
    merged = project.merge_deep_location_into_ir(ir, stored)
    projected = next(
        row
        for conclusion in merged["clue-graph.json"]["conclusions"]
        for row in (conclusion.get("clues") or [])
        if row.get("clue_id") == "source-bound-archive-clue"
    )
    assert projected["source_evidence"] == stored_clue["source_evidence"]
    assert projected["source_refs"] == stored_clue["source_refs"]
    assert "source_evidence" not in projected["provenance"]


def test_source_bound_deep_npc_projects_one_canonical_mechanics_evidence_boundary(
    tmp_path: Path,
):
    registration = _put_source_bound_skeleton(tmp_path)
    extracted = {
        "characteristics.STR",
        "characteristics.CON",
        "characteristics.SIZ",
        "characteristics.DEX",
        "characteristics.POW",
        "weapons",
    }
    assets.put_entity(tmp_path, "prog-demo", "npc", "npc-patron", {
        "npc_id": "npc-patron",
        "parse_state": "deep",
        "name": "Patron",
        "agenda_public": "Commission the investigators.",
        "source_page_indices": [0],
        "mechanics": {
            "status": "authored",
            "source_refs": [{"source_id": "pdf:prog-demo", "pdf_index": 0}],
            "fields_observed": sorted(extracted),
            "fields_extracted": sorted(extracted),
            "fields_not_authored": sorted(
                mechanics.ACTOR_FIELD_IDS - extracted
            ),
            "provenance": {
                "authority": "source_authored",
                "basis": "host_pack",
            },
            "profile": {
                "profile_kind": "actor",
                "characteristic_scale": "percentile",
                "source_characteristic_scale": "coc_3_18",
                "source_characteristics": {
                    "STR": 12, "CON": 10, "SIZ": 13, "DEX": 11, "POW": 9,
                },
                "normalization_note": "Host normalized authored pre-7e values.",
                "characteristics": {
                    "STR": 60, "CON": 50, "SIZ": 65, "DEX": 55, "POW": 45,
                },
                "weapons": [{
                    "weapon_id": "unarmed",
                    "extends": "unarmed",
                    "effects": [{
                        "effect_id": "close-quarters",
                        "resolution": "keeper_advisory",
                        "applicability": {"scene_tags_any": ["cramped"]},
                    }],
                }],
            },
        },
    })
    stored = assets.get_entity(tmp_path, "prog-demo", "npc", "npc-patron")
    assert stored is not None
    evidence = stored["mechanics"]["source_evidence"]
    assert evidence["source_id"] == "pdf:prog-demo"
    assert evidence["bundle_sha256s"] == [registration["bundle_sha256"]]
    assert stored["mechanics"]["provenance"]["basis"] == "host_pack"

    merged = project.merge_deep_npc_into_ir(
        project.project_skeleton_to_ir(assets.get_skeleton(tmp_path, "prog-demo")),
        stored,
    )
    projected = next(
        row for row in merged["npc-agendas.json"]["npcs"]
        if row.get("npc_id") == "npc-patron"
    )
    assert projected["mechanics"]["source_evidence"] == evidence
    assert projected["mechanics"]["provenance"]["basis"] == "host_pack"

    reserved = (
        mechanics.FACT_RECORD_CANONICAL_SOURCE_FIELDS
        | mechanics.FACT_RECORD_PARALLEL_SOURCE_FIELDS
    )

    def assert_no_nested_source_boundary(value: object) -> None:
        if isinstance(value, dict):
            assert not set(value).intersection(reserved)
            for child in value.values():
                assert_no_nested_source_boundary(child)
        elif isinstance(value, list):
            for child in value:
                assert_no_nested_source_boundary(child)

    assert_no_nested_source_boundary(projected["mechanics"]["profile"])
    assert (
        projected["mechanics"]["profile"]["source_characteristic_scale"]
        == "coc_3_18"
    )
