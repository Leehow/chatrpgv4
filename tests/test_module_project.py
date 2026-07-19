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

    reg = assets.load_registry(tmp_path)
    assert reg["modules"]["prog-demo"]["parse_tier_max"] >= 2


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

    # Enter library: should merge deep pack + enqueue neighbor finale + mention stub
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

    queue = assets.list_queue(tmp_path, "prog-demo")
    kinds = {(j.get("kind"), j.get("target_id")) for j in queue.get("pending") or []}
    # active deepen may be completed; neighbor/mention jobs should exist or be done
    assert any(t == "finale" for _, t in kinds) or any(
        j.get("target_id") == "finale" for j in (queue.get("done") or [])
    )


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
    assert assets.get_entity(tmp_path, "prog-demo", "location", "hillside-camp") is not None
    assert assets.get_entity(tmp_path, "prog-demo", "npc", "npc-camp-elder") is not None
