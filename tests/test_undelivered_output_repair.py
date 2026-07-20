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
            "decision_id": "finalize-before-repair",
        },
    )
    assert finalized["ok"] is True, finalized
    original = finalized["data"]

    repaired = coc_toolbox.run_tool(
        "turn.finalize",
        workspace,
        campaign_id,
        {
            "draft": "托马斯走到门边，先敲了两下。\n\n他停下来等候。",
            "coverage": [],
            "mechanics_placements": placements,
            "repair_finalization_id": original["finalization_id"],
            "decision_id": "repair-before-delivery",
        },
    )
    assert repaired["ok"] is True, repaired
    replacement = repaired["data"]
    assert replacement["finalization_id"] != original["finalization_id"]
    assert replacement["bundle"] == original["bundle"]
    assert replacement["source_digest"] == original["source_digest"]
    assert replacement["rendered_text"].count("【变化】") == 1
    assert "先敲了两下" in replacement["rendered_text"]

    campaign_dir = workspace / ".coc" / "campaigns" / campaign_id
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
            "rendered_sha256": replacement["rendered_sha256"],
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
            "decision_id": "repair-after-delivery-must-fail",
        },
    )
    assert blocked["ok"] is False
    assert blocked["error"]["code"] == "delivery_conflict"
