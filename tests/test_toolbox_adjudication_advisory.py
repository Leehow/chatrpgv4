"""Contract tests for toolbox adjudication advisory surfaces (coc_toolbox.py).

Covers the advisory-only (``warnings``/``hints``, never blocking) adjudication
reminders that close the "declared facts confirmed without checks" gap:

- ``state.record_clue`` flags a roll-gated clue (structured ``delivery_kind``)
  recorded without matching roll-log evidence.
- ``state.record_npc_engagement`` / ``state.npc_update`` project authored
  ``keeper_note`` contact-route constraints and advise KP adjudication for
  improvised NPCs.
- ``state.move_scene`` / ``state.end_session`` emit session-level structured
  counts of skill_check clues lacking roll evidence and improvised NPC
  engagements.
- ``actions.advise`` exposes the planner rule-advice surface (authored roll
  gates) through the toolbox, read-only and advisory.

All matching is over structured fields only (delivery_kind, skill labels,
keeper_note, receipt identity contracts); no free text is ever scanned.
"""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
SCRIPTS = REPO / "plugins" / "coc-keeper" / "scripts"
TOOLBOX_SCRIPT = SCRIPTS / "coc_toolbox.py"
PYTHON = sys.executable


def _load(name: str, rel: str | Path):
    path = Path(rel)
    if not path.is_absolute():
        path = REPO / path
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


coc_toolbox = _load("coc_toolbox_adjudication_under_test", TOOLBOX_SCRIPT)
coc_starter = _load("coc_starter_for_adjudication", SCRIPTS / "coc_starter.py")


def _write_json(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


@pytest.fixture
def campaign_ws(tmp_path: Path):
    """Fresh workspace with a the-haunting / thomas-hayes quick-start campaign."""
    workspace = tmp_path / "workspace"
    coc_root = workspace / ".coc"
    campaign_id = "toolbox-adjudication-test"
    _write_json(
        coc_root / "runtime.json",
        {
            "schema_version": 2,
            "planner": {"kind": "deterministic"},
            "rules": {"kind": "deterministic"},
            "narrator": {"kind": "template"},
            "player": {"kind": "human"},
        },
    )
    quick = coc_starter.quick_start(
        coc_root,
        "the-haunting",
        "thomas-hayes",
        campaign_id=campaign_id,
        title="Toolbox Adjudication Test",
    )
    campaign_dir = Path(quick["campaign_dir"])
    return {
        "workspace": workspace,
        "coc_root": coc_root,
        "campaign_id": campaign_id,
        "campaign_dir": campaign_dir,
        "investigator_id": quick["investigator_id"],
        "quick": quick,
    }


def _run(ws, tool: str, args: dict | None = None) -> dict:
    args = dict(args or {})
    if tool == "rules.roll":
        args.setdefault("difficulty", "regular")
        args.setdefault("goal", "test the authored clue approach")
        args.setdefault(
            "stakes",
            {
                "on_success": "the clue approach succeeds",
                "on_failure": "the clue approach does not succeed",
            },
        )
        args.setdefault("difficulty_basis", "authored_gate")
    return coc_toolbox.run_tool(
        tool,
        ws["workspace"],
        ws["campaign_id"],
        args,
    )


def _first_contact_binding(ws: dict, npc_id: str, *, key: str) -> dict:
    reaction = _run(ws, "npc.reaction", {
        "npc_id": npc_id,
        "npc_display_name": f"测试 NPC {key}",
        "investigator": ws["investigator_id"],
        "context": {
            "player_conduct": "调查员清楚说明来意并尊重现场边界",
            "scene_constraints": "场景中现有的职责和安全边界仍然有效",
            "authored_or_relationship_boundary": "初次见面不会改写 NPC 的身份与权限",
            "semantic_reason": "外表与信用只影响起初接纳方式",
        },
        "seed": 7,
        "decision_id": f"{key}-reaction",
    })
    assert reaction["ok"] is True, reaction
    return {
        "first_impression_ref": reaction["data"]["first_impression_ref"],
        "first_impression_realization": {
            "observable_manner": "对方先打量调查员，再决定如何回应",
            "causal_explanation": "调查员的外表与社会身份影响了起初判断",
            "boundary_preserved": "NPC 仍然保留原有职责、立场和权限",
            "opportunity_or_friction": "这份起初判断会影响接下来的语气与耐心",
        },
    }


def _clue_id_by_delivery_kind(campaign_dir: Path, delivery_kind: str) -> str:
    clue_graph = json.loads(
        (campaign_dir / "scenario" / "clue-graph.json").read_text(encoding="utf-8")
    )
    for conclusion in clue_graph.get("conclusions") or []:
        for clue in conclusion.get("clues") or []:
            if isinstance(clue, dict) and clue.get("delivery_kind") == delivery_kind:
                return str(clue["clue_id"])
    raise AssertionError(f"starter clue-graph has no {delivery_kind} clue")


def _authored_npc_with_keeper_note(campaign_dir: Path) -> dict:
    agendas = json.loads(
        (campaign_dir / "scenario" / "npc-agendas.json").read_text(encoding="utf-8")
    )
    for npc in agendas.get("npcs") or []:
        if isinstance(npc, dict) and npc.get("npc_id") and npc.get("keeper_note"):
            return npc
    raise AssertionError("starter npc-agendas has no NPC with a keeper_note")


def _world_state(campaign_dir: Path) -> dict:
    return json.loads(
        (campaign_dir / "save" / "world-state.json").read_text(encoding="utf-8")
    )


# --------------------------------------------------------------------------- #
# 1. state.record_clue — roll-gated clues without roll evidence warn
# --------------------------------------------------------------------------- #


def test_record_clue_warns_when_skill_check_clue_has_no_roll(campaign_ws):
    clue_id = _clue_id_by_delivery_kind(campaign_ws["campaign_dir"], "skill_check")
    envelope = _run(
        campaign_ws,
        "state.record_clue",
        {"clue_id": clue_id, "method": "declared", "decision_id": "adj-clue-1"},
    )
    assert envelope["ok"] is True
    matched = [
        w for w in envelope["warnings"]
        if "authored with roll gate" in w and "no matching skill roll" in w
    ]
    assert matched, envelope["warnings"]
    assert clue_id in matched[0]
    # Advisory only: the write still lands.
    assert clue_id in (_world_state(campaign_ws["campaign_dir"]).get("discovered_clue_ids") or [])


def test_record_clue_roll_evidence_suppresses_warning(campaign_ws):
    clue_id = _clue_id_by_delivery_kind(campaign_ws["campaign_dir"], "skill_check")
    rolled = _run(
        campaign_ws,
        "rules.roll",
        {"skill": "Library Use", "seed": 7, "decision_id": "adj-roll-1"},
    )
    assert rolled["ok"] is True
    envelope = _run(
        campaign_ws,
        "state.record_clue",
        {"clue_id": clue_id, "method": "roll", "decision_id": "adj-clue-2"},
    )
    assert envelope["ok"] is True
    assert not any("no matching skill roll" in w for w in envelope["warnings"])


def test_record_clue_unrelated_skill_roll_still_warns(campaign_ws):
    """Roll evidence matches the clue's authored gate skill, not just any roll."""
    clue_id = _clue_id_by_delivery_kind(campaign_ws["campaign_dir"], "skill_check")
    rolled = _run(
        campaign_ws,
        "rules.roll",
        {"skill": "Spot Hidden", "seed": 7, "decision_id": "adj-roll-2"},
    )
    assert rolled["ok"] is True
    envelope = _run(
        campaign_ws,
        "state.record_clue",
        {"clue_id": clue_id, "method": "declared", "decision_id": "adj-clue-3"},
    )
    assert envelope["ok"] is True
    assert any("no matching skill roll" in w for w in envelope["warnings"])


def test_record_clue_non_gated_delivery_kind_never_warns(campaign_ws):
    clue_id = _clue_id_by_delivery_kind(campaign_ws["campaign_dir"], "environmental")
    envelope = _run(
        campaign_ws,
        "state.record_clue",
        {"clue_id": clue_id, "method": "exploration", "decision_id": "adj-clue-4"},
    )
    assert envelope["ok"] is True
    assert not any("no matching skill roll" in w for w in envelope["warnings"])


def test_record_clue_improvised_clue_never_warns_roll_gap(campaign_ws):
    envelope = _run(
        campaign_ws,
        "state.record_clue",
        {
            "clue_id": "clue-totally-improvised",
            "method": "improvised",
            "decision_id": "adj-clue-5",
        },
    )
    assert envelope["ok"] is True
    assert any("not in the clue graph" in w for w in envelope["warnings"])
    assert not any("no matching skill roll" in w for w in envelope["warnings"])


def test_record_clue_replay_does_not_repeat_roll_warning(campaign_ws):
    clue_id = _clue_id_by_delivery_kind(campaign_ws["campaign_dir"], "skill_check")
    args = {"clue_id": clue_id, "method": "declared", "decision_id": "adj-clue-6"}
    first = _run(campaign_ws, "state.record_clue", args)
    second = _run(campaign_ws, "state.record_clue", args)
    assert first["ok"] and second["ok"]
    assert any("no matching skill roll" in w for w in first["warnings"])
    assert any("duplicate decision_id" in w for w in second["warnings"])
    assert not any("no matching skill roll" in w for w in second["warnings"])
    assert second["data"] == first["data"]


# --------------------------------------------------------------------------- #
# 2. NPC engagement/update — keeper_note projection and improvisation advice
# --------------------------------------------------------------------------- #


def test_record_npc_engagement_projects_keeper_note_constraint(campaign_ws):
    npc = _authored_npc_with_keeper_note(campaign_ws["campaign_dir"])
    envelope = _run(
        campaign_ws,
        "state.record_npc_engagement",
        {
            "npc_id": str(npc["npc_id"]),
            "interaction_kind": "dialogue",
            "decision_id": "adj-npc-1",
            **_first_contact_binding(
                campaign_ws,
                str(npc["npc_id"]),
                key="adj-npc-1",
            ),
        },
    )
    assert envelope["ok"] is True
    assert not any("improvised NPC" in w for w in envelope["warnings"])
    projected = [
        h for h in envelope["hints"]
        if "keeper_note" in h and str(npc["keeper_note"]).strip() in h
    ]
    assert projected, envelope["hints"]
    assert str(npc["npc_id"]) in projected[0]


def test_record_npc_engagement_improvised_npc_adjudication_hint(campaign_ws):
    envelope = _run(
        campaign_ws,
        "state.record_npc_engagement",
        {
            "npc_id": "npc-invented-clerk",
            "interaction_kind": "dialogue",
            "decision_id": "adj-npc-2",
            **_first_contact_binding(
                campaign_ws,
                "npc-invented-clerk",
                key="adj-npc-2",
            ),
        },
    )
    assert envelope["ok"] is True
    # Existing improvised-NPC warning is preserved.
    assert any("improvised NPC" in w for w in envelope["warnings"])
    assert any(
        "adjudicates whether this person's existence is plausible" in h
        for h in envelope["hints"]
    )


def test_npc_update_projects_keeper_note_constraint(campaign_ws):
    npc = _authored_npc_with_keeper_note(campaign_ws["campaign_dir"])
    envelope = _run(
        campaign_ws,
        "state.npc_update",
        {
            "npc_id": str(npc["npc_id"]),
            "trust_delta": 1,
            "decision_id": "adj-npc-3",
        },
    )
    assert envelope["ok"] is True
    assert any(
        "keeper_note" in h and str(npc["keeper_note"]).strip() in h
        for h in envelope["hints"]
    )


def test_npc_update_improvised_npc_adjudication_hint(campaign_ws):
    envelope = _run(
        campaign_ws,
        "state.npc_update",
        {
            "npc_id": "npc-invented-clerk",
            "trust_delta": 1,
            "decision_id": "adj-npc-4",
        },
    )
    assert envelope["ok"] is True
    assert any("improvised NPC" in w for w in envelope["warnings"])
    assert any(
        "adjudicates whether this person's existence is plausible" in h
        for h in envelope["hints"]
    )


# --------------------------------------------------------------------------- #
# 3. Session-level "expected rolls that never happened" diagnostics
# --------------------------------------------------------------------------- #


def _record_one_unrolled_skill_check_clue(ws, suffix: str) -> str:
    clue_id = _clue_id_by_delivery_kind(ws["campaign_dir"], "skill_check")
    envelope = _run(
        ws,
        "state.record_clue",
        {"clue_id": clue_id, "method": "declared", "decision_id": f"adj-gap-clue-{suffix}"},
    )
    assert envelope["ok"] is True
    return clue_id


def test_end_session_reports_adjudication_gap_counts(campaign_ws):
    clue_id = _record_one_unrolled_skill_check_clue(campaign_ws, "end")
    engagement = _run(
        campaign_ws,
        "state.record_npc_engagement",
        {
            "npc_id": "npc-invented-clerk",
            "interaction_kind": "dialogue",
            "decision_id": "adj-gap-npc-end",
            **_first_contact_binding(
                campaign_ws,
                "npc-invented-clerk",
                key="adj-gap-npc-end",
            ),
        },
    )
    assert engagement["ok"] is True
    envelope = _run(
        campaign_ws,
        "state.end_session",
        {"kind": "conclusion", "summary": "gap audit", "decision_id": "adj-gap-end"},
    )
    assert envelope["ok"] is True
    clue_hint = next(
        (h for h in envelope["hints"] if "skill_check clue(s) lack roll evidence" in h),
        None,
    )
    assert clue_hint is not None, envelope["hints"]
    assert "1 recorded skill_check clue(s)" in clue_hint
    assert clue_id in clue_hint
    assert any(
        "1 improvised NPC engagement(s) recorded" in h for h in envelope["hints"]
    )


def test_end_session_reports_zero_gaps_when_clean(campaign_ws):
    envelope = _run(
        campaign_ws,
        "state.end_session",
        {"kind": "conclusion", "summary": "clean audit", "decision_id": "adj-clean-end"},
    )
    assert envelope["ok"] is True
    assert any(
        "0 recorded skill_check clue(s) lack roll evidence" in h
        for h in envelope["hints"]
    )
    assert any(
        "0 improvised NPC engagement(s) recorded" in h for h in envelope["hints"]
    )


def test_move_scene_reports_adjudication_gap_counts(campaign_ws):
    clue_id = _record_one_unrolled_skill_check_clue(campaign_ws, "move")
    envelope = _run(
        campaign_ws,
        "state.move_scene",
        {"scene_id": "newspaper-morgue", "decision_id": "adj-gap-move"},
    )
    assert envelope["ok"] is True
    clue_hint = next(
        (h for h in envelope["hints"] if "skill_check clue(s) lack roll evidence" in h),
        None,
    )
    assert clue_hint is not None, envelope["hints"]
    assert "1 recorded skill_check clue(s)" in clue_hint
    assert clue_id in clue_hint
    assert any(
        "0 improvised NPC engagement(s) recorded" in h for h in envelope["hints"]
    )


# --------------------------------------------------------------------------- #
# 4. actions.advise — planner rule-advice surface in the toolbox
# --------------------------------------------------------------------------- #


def test_actions_advise_registered_read_only_advisory():
    spec = coc_toolbox.TOOLS.get("actions.advise")
    assert spec is not None
    assert spec["needs_campaign"] is True
    assert "actions.advise" not in coc_toolbox._MUTATING_TOOLS
    assert not any(
        pspec.get("required") for pspec in spec["params"].values()
    ), "read-only advisory tool must not gain required params"


def test_actions_advise_starting_scene_core_advice_only(campaign_ws):
    envelope = _run(campaign_ws, "actions.advise")
    assert envelope["ok"] is True
    data = envelope["data"]
    assert data["authority"] == "advisory"
    assert data["authored_roll_gate_count"] == 0
    advice_ids = [row.get("advice_id") for row in data["rule_advice"]]
    assert "core:roll-only-for-meaningful-uncertainty" in advice_ids
    assert envelope["warnings"] == []
    assert any("not a mandatory pipeline" in h for h in envelope["hints"])


def test_actions_advise_projects_authored_roll_gate_with_sheet_values(campaign_ws):
    moved = _run(
        campaign_ws,
        "state.move_scene",
        {"scene_id": "newspaper-morgue", "decision_id": "adj-advise-move"},
    )
    assert moved["ok"] is True
    envelope = _run(campaign_ws, "actions.advise")
    assert envelope["ok"] is True
    data = envelope["data"]
    assert data["scene_id"] == "newspaper-morgue"
    assert data["investigator_id"] == campaign_ws["investigator_id"]
    assert data["authored_roll_gate_count"] == 1
    gate = next(
        row for row in data["rule_advice"]
        if row.get("classification") == "authored_rule_advice"
    )
    assert gate["route_id"] == "persuade-arty"
    assert gate["may_override"] is True
    recommendation = gate["recommendation"]
    assert recommendation["decision"] == "roll"
    assert recommendation["operation_kind"] == "skill_check"
    assert recommendation["difficulty"] == "regular"
    approaches = {
        (row["verb"], row["skill"]): row["investigator_value"]
        for row in recommendation["approaches"]
    }
    # thomas-hayes sheet values are folded into the advisory evidence.
    assert approaches[("persuade", "Persuade")] == 40
    assert approaches[("intimidate", "Intimidate")] == 45


def test_actions_advise_does_not_mutate_state(campaign_ws):
    campaign_dir = campaign_ws["campaign_dir"]
    watched = [
        campaign_dir / "save" / "world-state.json",
        campaign_dir / "save" / "toolbox-ledger.json",
        campaign_dir / "save" / "npc-engagement-receipts.json",
    ]
    before = {
        path: path.read_bytes() if path.is_file() else None for path in watched
    }
    envelope = _run(campaign_ws, "actions.advise")
    assert envelope["ok"] is True
    after = {
        path: path.read_bytes() if path.is_file() else None for path in watched
    }
    assert after == before
