from __future__ import annotations

import json
from pathlib import Path
import sys


SCRIPTS = Path(__file__).resolve().parents[1] / "plugins" / "coc-keeper" / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import coc_starter
import coc_toolbox
import coc_turn_finalization


def _write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def _read_jsonl(path: Path) -> list[dict]:
    if not path.is_file():
        return []
    return [
        json.loads(line)
        for line in path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]


def _workspace(tmp_path: Path, campaign_id: str) -> tuple[Path, str]:
    workspace = tmp_path / "workspace"
    coc_root = workspace / ".coc"
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
        title="Undelivered output repair",
    )
    return workspace, str(quick["investigator_id"])


def _open_time_turn(workspace: Path, campaign_id: str) -> tuple[dict, list[dict]]:
    advanced = coc_toolbox.run_tool(
        "state.time_appearance",
        workspace,
        campaign_id,
        {
            "mode": "distorted",
            "display_label": "窗外停在铅灰色黄昏",
            "reason": "a source-established supernatural light distortion",
            "decision_id": "distort-visible-time",
        },
    )
    assert advanced["ok"] is True, advanced
    journal = coc_toolbox.run_tool(
        "state.journal",
        workspace,
        campaign_id,
        {
            "summary": "托马斯走到门边等候。",
            "player_action": "走到门边",
            "player_text": "我走到门边等候。",
            "player_speaker": "托马斯",
            "run_id": "repair-run",
            "intent_class": "move",
            "decision_id": "journal-one",
        },
    )
    assert journal["ok"] is True, journal
    context = coc_toolbox.run_tool(
        "turn.output_context", workspace, campaign_id, {}
    )
    assert context["ok"] is True, context
    effect_id = context["data"]["mechanics_bundle"]["state_delta"][0][
        "effect_id"
    ]
    placements = [
        {
            "after_paragraph": 0,
            "segment_type": "state_delta",
            "source_ids": [effect_id],
        }
    ]
    return context["data"], placements


def test_finalizer_rejects_deterministic_mechanics_block_in_draft(
    tmp_path: Path,
) -> None:
    workspace, _investigator_id = _workspace(tmp_path, "reject-duplicate-block")
    _context, placements = _open_time_turn(
        workspace, "reject-duplicate-block"
    )
    result = coc_toolbox.run_tool(
        "turn.finalize",
        workspace,
        "reject-duplicate-block",
        {
            "draft": (
                "托马斯走到门边。\n\n"
                "【变化】时段：窗外停在铅灰色黄昏\n\n"
                "他停下来等候。"
            ),
            "coverage": [],
            "mechanics_placements": placements,
            "revision": 1,
            "decision_id": "must-reject-duplicate-block",
        },
    )
    assert result["ok"] is False
    assert result["error"]["code"] == "mechanics_text_in_draft"


def test_latest_unconfirmed_output_can_receive_narration_only_repair(
    tmp_path: Path,
) -> None:
    campaign_id = "repair-unconfirmed-output"
    workspace, _investigator_id = _workspace(tmp_path, campaign_id)
    _context, placements = _open_time_turn(workspace, campaign_id)

    finalized = coc_toolbox.run_tool(
        "turn.finalize",
        workspace,
        campaign_id,
        {
            "draft": "托马斯走到门边。\n\n他停下来等候。",
            "coverage": [],
            "mechanics_placements": placements,
            "revision": 1,
            "decision_id": "finalize-before-repair",
        },
    )
    assert finalized["ok"] is True, finalized
    original = finalized["data"]
    assert original["accepted_revision"] == 1
    assert original["turn_id"] == _context["turn_id"]
    assert original["settlement_snapshot_id"] == _context["settlement_snapshot_id"]
    assert original["contract_projection_sha256"] == _context["contract_projection_sha256"]
    assert original["accepted_draft_sha256"].startswith("sha256:")
    assert original["rendered_text_sha256"].startswith("sha256:")
    campaign_dir = workspace / ".coc" / "campaigns" / campaign_id
    mechanics_before_repair = [
        row for row in _read_jsonl(campaign_dir / "logs" / "toolbox-calls.jsonl")
        if row.get("ok") is True
        and str(row.get("tool") or "").startswith(("rules.", "state."))
        and row.get("tool") != "state.journal"
    ]

    repaired = coc_toolbox.run_tool(
        "turn.finalize",
        workspace,
        campaign_id,
        {
            "draft": "托马斯走到门边，先敲了两下。\n\n他停下来等候。",
            "coverage": [],
            "mechanics_placements": placements,
            "repair_finalization_id": original["finalization_id"],
            "revision": 2,
            "decision_id": "repair-before-delivery",
        },
    )
    assert repaired["ok"] is True, repaired
    replacement = repaired["data"]
    assert replacement["finalization_id"] != original["finalization_id"]
    assert replacement["bundle"] == original["bundle"]
    assert replacement["source_digest"] == original["source_digest"]
    assert replacement["settlement_snapshot_id"] == original["settlement_snapshot_id"]
    assert replacement["contract_projection_sha256"] == original["contract_projection_sha256"]
    assert replacement["accepted_revision"] == 2
    assert replacement["rendered_text"].count("【变化】") == 1
    assert "先敲了两下" in replacement["rendered_text"]

    conflict = coc_toolbox.run_tool(
        "turn.finalize",
        workspace,
        campaign_id,
        {
            "draft": "同一个修订号却换了另一份文本。\n\n这不能覆盖已接受的草稿。",
            "coverage": [],
            "mechanics_placements": placements,
            "repair_finalization_id": replacement["finalization_id"],
            "revision": 2,
            "decision_id": "repair-before-delivery",
        },
    )
    assert conflict["ok"] is False
    assert conflict["error"]["code"] == "revision_conflict"

    beyond_cap = coc_toolbox.run_tool(
        "turn.finalize",
        workspace,
        campaign_id,
        {
            "draft": "第三稿不应被接受。\n\n结算仍必须保持冻结。",
            "coverage": [],
            "mechanics_placements": placements,
            "repair_finalization_id": replacement["finalization_id"],
            "revision": 3,
            "decision_id": "repair-beyond-cap",
        },
    )
    assert beyond_cap["ok"] is False
    assert beyond_cap["error"]["code"] == "revision_limit_exceeded"
    mechanics_after_repair = [
        row for row in _read_jsonl(campaign_dir / "logs" / "toolbox-calls.jsonl")
        if row.get("ok") is True
        and str(row.get("tool") or "").startswith(("rules.", "state."))
        and row.get("tool") != "state.journal"
    ]
    assert mechanics_after_repair == mechanics_before_repair

    assert coc_turn_finalization.load_finalizations(campaign_dir) == [replacement]
    transcript = [
        json.loads(line)
        for line in (campaign_dir / "logs" / "table-transcript.jsonl")
        .read_text(encoding="utf-8")
        .splitlines()
        if line.strip()
    ]
    keeper_rows = [row for row in transcript if row.get("role") == "keeper"]
    assert len(keeper_rows) == 1
    assert keeper_rows[0]["finalization_id"] == replacement["finalization_id"]
    assert keeper_rows[0]["text"] == replacement["rendered_text"]
    audit_rows = [
        json.loads(line)
        for line in (campaign_dir / "logs" / "undelivered-output-repairs.jsonl")
        .read_text(encoding="utf-8")
        .splitlines()
        if line.strip()
    ]
    assert len(audit_rows) == 1
    assert (
        audit_rows[0]["source_finalization"]["finalization_id"]
        == original["finalization_id"]
    )

    resumed = coc_toolbox.run_tool(
        "session.resume", workspace, campaign_id, {}
    )
    assert resumed["ok"] is True, resumed
    assert resumed["data"]["delivery"]["status"] == "unconfirmed"
    assert resumed["data"]["delivery"]["exact_text"] == replacement["rendered_text"]
    acknowledged = coc_toolbox.run_tool(
        "session.delivery_ack",
        workspace,
        campaign_id,
        {
            "finalization_id": replacement["finalization_id"],
            "rendered_sha256": replacement["rendered_text_sha256"],
            "ack_kind": "displayed",
            "source_id": "test-display",
            "decision_id": "ack-repaired-output",
        },
    )
    assert acknowledged["ok"] is True, acknowledged
    blocked = coc_toolbox.run_tool(
        "turn.finalize",
        workspace,
        campaign_id,
        {
            "draft": "托马斯改走到窗边。\n\n他停下来等候。",
            "coverage": [],
            "mechanics_placements": placements,
            "repair_finalization_id": replacement["finalization_id"],
            "revision": 2,
            "decision_id": "repair-after-delivery-must-fail",
        },
    )
    assert blocked["ok"] is False
    assert blocked["error"]["code"] == "delivery_conflict"


def test_finalization_agency_claims_require_exact_player_or_active_override(
    tmp_path: Path,
) -> None:
    campaign_id = "agency-claim-bindings"
    workspace, investigator_id = _workspace(tmp_path, campaign_id)
    context, placements = _open_time_turn(workspace, campaign_id)
    player_source = context["contract_projection"]["player_input"]["source_ref"]
    draft = "托马斯照自己刚才所说的守在门边。\n\n门外的脚步声渐渐靠近。"
    claim = {
        "claim_id": "claim-wait",
        "subject_ref": f"pc:{investigator_id}",
        "claim_type": "voluntary_action",
        "exact_excerpt": "托马斯照自己刚才所说的守在门边。",
        "source_ref": player_source,
        "override_id": None,
    }
    invalid = coc_toolbox.run_tool(
        "turn.finalize", workspace, campaign_id,
        {
            "draft": draft,
            "coverage": [],
            "mechanics_placements": placements,
            "revision": 1,
            "agency_claims": [{**claim, "source_ref": "player_input:other"}],
            "decision_id": "agency-invalid",
        },
    )
    assert invalid["ok"] is False
    assert invalid["error"]["code"] == "agency_source_invalid"
    valid = coc_toolbox.run_tool(
        "turn.finalize", workspace, campaign_id,
        {
            "draft": draft,
            "coverage": [],
            "mechanics_placements": placements,
            "revision": 1,
            "agency_claims": [claim],
            "decision_id": "agency-valid",
        },
    )
    assert valid["ok"] is True, valid
    assert valid["data"]["agency_claims"] == [claim]


def test_forced_agency_claim_requires_matching_frozen_override(tmp_path: Path) -> None:
    campaign_id = "agency-forced-override"
    workspace, investigator_id = _workspace(tmp_path, campaign_id)
    state_path = (
        workspace / ".coc" / "campaigns" / campaign_id / "save"
        / "investigator-state" / f"{investigator_id}.json"
    )
    state = json.loads(state_path.read_text(encoding="utf-8"))
    state["conditions"] = ["unconscious"]
    _write_json(state_path, state)
    context, placements = _open_time_turn(workspace, campaign_id)
    override = context["contract_projection"]["control_overrides"][0]
    draft = "托马斯失去意识，身体软倒在门边。\n\n门外的脚步声停了下来。"
    claim = {
        "claim_id": "claim-unconscious",
        "subject_ref": f"pc:{investigator_id}",
        "claim_type": "forced_behavior",
        "exact_excerpt": "托马斯失去意识，身体软倒在门边。",
        "source_ref": override["source_ref"],
        "override_id": override["override_id"],
    }
    wrong = coc_toolbox.run_tool(
        "turn.finalize", workspace, campaign_id,
        {
            "draft": draft,
            "coverage": [],
            "mechanics_placements": placements,
            "revision": 1,
            "agency_claims": [{**claim, "subject_ref": "pc:someone-else"}],
            "decision_id": "forced-wrong-subject",
        },
    )
    assert wrong["ok"] is False
    assert wrong["error"]["code"] == "agency_override_invalid"
    valid = coc_toolbox.run_tool(
        "turn.finalize", workspace, campaign_id,
        {
            "draft": draft,
            "coverage": [],
            "mechanics_placements": placements,
            "revision": 1,
            "agency_claims": [claim],
            "decision_id": "forced-valid",
        },
    )
    assert valid["ok"] is True, valid
