#!/usr/bin/env python3
"""Tests for progressive skeleton → campaign IR projection (slices 2–3)."""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path

SCRIPTS = Path("plugins/coc-keeper/scripts")
FAKE_SHA = "b" * 64


def _load(name: str, rel: str):
    spec = importlib.util.spec_from_file_location(name, rel)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


assets = _load("coc_module_assets_proj_test", str(SCRIPTS / "coc_module_assets.py"))
project = _load("coc_module_project_test", str(SCRIPTS / "coc_module_project.py"))
state = _load("coc_state_proj_test", str(SCRIPTS / "coc_state.py"))
time = _load("coc_time_proj_test", str(SCRIPTS / "coc_time.py"))


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
    }


def _deep_opening_pack():
    return {
        "location_id": "opening",
        "title": "Opening Briefing",
        "parse_state": "deep",
        "dramatic_question": "Will the investigators accept the commission?",
        "scene_type": "social",
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
            {
                "clue_id": "clue-commission",
                "delivery_kind": "handout",
                "player_safe_summary": (
                    "The patron hires you for $20/day and suggests the library."
                ),
            }
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
    assets.init_module_root(
        tmp_path, asset_root_id="prog-demo", identity={"canonical_module_id": "prog-demo"},
        file_sha256=FAKE_SHA,
    )
    assets.put_skeleton(tmp_path, "prog-demo", _skeleton())
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


def test_host_npc_public_fields_reach_canonical_consumers(tmp_path: Path):
    assets.init_module_root(
        tmp_path,
        asset_root_id="prog-demo",
        identity={"canonical_module_id": "prog-demo"},
        file_sha256=FAKE_SHA,
    )
    assets.put_skeleton(tmp_path, "prog-demo", _skeleton())
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
    assets.init_module_root(
        tmp_path,
        asset_root_id="prog-demo",
        identity={"canonical_module_id": "prog-demo"},
        file_sha256=FAKE_SHA,
    )
    assets.put_skeleton(tmp_path, "prog-demo", _skeleton())
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
    assets.init_module_root(
        tmp_path,
        asset_root_id="prog-demo",
        identity={"canonical_module_id": "prog-demo"},
        file_sha256=FAKE_SHA,
    )
    assets.put_skeleton(tmp_path, "prog-demo", _skeleton())
    pack = _deep_opening_pack()
    pack["clues"][0]["source_page_indices"] = [8, 9]
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
    assets.init_module_root(
        tmp_path,
        asset_root_id="prog-demo",
        identity={"canonical_module_id": "prog-demo"},
        file_sha256=FAKE_SHA,
    )
    assets.put_skeleton(tmp_path, "prog-demo", _skeleton())
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
            "player_safe_summary": "Stacks of dusty ledgers.",
            "available_clue_ids": ["clue-ledger"],
            "clues": [
                {
                    "clue_id": "clue-ledger",
                    "delivery_kind": "handout",
                    "player_safe_summary": "A ledger names the finale site.",
                }
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
    assets.init_module_root(
        tmp_path,
        asset_root_id="prog-demo",
        identity={"canonical_module_id": "prog-demo"},
        file_sha256=FAKE_SHA,
    )
    assets.put_skeleton(tmp_path, "prog-demo", skeleton)
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
    assets.init_module_root(
        tmp_path,
        asset_root_id="prog-demo",
        identity={"canonical_module_id": "prog-demo"},
        file_sha256=FAKE_SHA,
    )
    assets.put_skeleton(tmp_path, "prog-demo", _skeleton())
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
    assets.init_module_root(
        tmp_path,
        asset_root_id="prog-demo",
        identity={"canonical_module_id": "prog-demo"},
        file_sha256=FAKE_SHA,
    )
    assets.put_skeleton(tmp_path, "prog-demo", _skeleton())
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
    assets.init_module_root(
        tmp_path,
        asset_root_id="prog-demo",
        identity={"canonical_module_id": "prog-demo"},
        file_sha256=FAKE_SHA,
    )
    assets.put_skeleton(tmp_path, "prog-demo", _skeleton())
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
    assets.init_module_root(
        tmp_path,
        asset_root_id="prog-demo",
        identity={"canonical_module_id": "prog-demo"},
        file_sha256=FAKE_SHA,
    )
    assets.put_skeleton(tmp_path, "prog-demo", _skeleton())
    pack = _deep_opening_pack()
    # Attach structured follow-up on a clue (simulates Xavier→gypsy style).
    pack["clues"][0]["mentions"] = [
        {"kind": "location", "ref_id": "hillside-camp", "raw_label": "hillside camp"},
        {"kind": "npc", "ref_id": "npc-camp-elder", "raw_label": "camp elder"},
    ]
    pack["clues"][0]["source_page_indices"] = [5]
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
