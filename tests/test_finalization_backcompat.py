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


def _workspace_with_finalized_turn(tmp_path: Path) -> tuple[Path, Path]:
    workspace = tmp_path / "workspace"
    _write_json(
        workspace / ".coc" / "runtime.json",
        {
            "schema_version": 2,
            "planner": {"kind": "deterministic"},
            "rules": {"kind": "deterministic"},
            "narrator": {"kind": "template"},
            "player": {"kind": "human"},
        },
    )
    coc_starter.quick_start(
        workspace / ".coc",
        "the-haunting",
        "thomas-hayes",
        campaign_id="legacy-finalization",
        title="Legacy Finalization",
    )

    def call(tool: str, args: dict | None = None) -> dict:
        result = coc_toolbox.run_tool(
            tool, workspace, "legacy-finalization", dict(args or {})
        )
        assert result["ok"] is True, result
        return result

    call(
        "state.journal",
        {"summary": "The first turn closes.", "player_text": "我结束第一回合行动。", "decision_id": "journal-one"},
    )
    context = call("turn.output_context")["data"]
    assert context["obligations"] == []
    assert all(not context["mechanics_bundle"].get(key) for key in (
        "public_check", "state_delta", "exceptional_effect",
    ))
    call(
        "turn.finalize",
        {
            "draft": "第一回合结束。",
            "coverage": [],
            "mechanics_placements": [],
            "revision": 1,
            "decision_id": "finalize-one",
        },
    )
    campaign = (
        workspace / ".coc" / "campaigns" / "legacy-finalization"
    )
    return workspace, campaign


def _rewrite_as_legacy_context_receipt(campaign: Path) -> dict:
    path = campaign / "logs" / coc_turn_finalization.FINALIZATION_FILENAME
    row = json.loads(path.read_text(encoding="utf-8"))
    effect_id = "context:npc-first-impression-v2:historical"
    row["bundle"]["context_effect"] = [{
        "schema_version": 2,
        "category": "context_effect",
        "effect_id": effect_id,
        "effect_kind": "npc_first_impression",
        "contract_version": "public-roll-v2",
        "source_receipt_id": "npc-first-impression-v2:historical",
        "source_roll_id": "npc-first-impression-roll-v2:historical",
        "investigator_id": "thomas-hayes",
        "npc_id": "npc-historical",
        "npc_display_name": "旧档案员",
        "achieved_level": "failure",
        "reaction_tier": "guarded",
        "observable_manner": "旧档案员谨慎地收起文件。",
        "causal_explanation": "历史初印象检定令对方保持戒备。",
        "opportunity_or_friction": "必须先说明来意。",
        "boundary_preserved": "保密职责仍然有效。",
    }]
    row["segments"].append({
        "segment_type": "context_effect",
        "text": "【初次反应】旧档案员谨慎地收起文件。",
        "source_ids": [effect_id],
    })
    row["rendered_text"] = "\n\n".join(
        segment["text"] for segment in row["segments"]
    )
    row["bundle_sha256"] = coc_turn_finalization.canonical_digest(row["bundle"])
    row["schema_version"] = 1
    row["draft_sha256"] = row.pop("accepted_draft_sha256")
    row["rendered_sha256"] = coc_turn_finalization.canonical_digest(
        row["rendered_text"]
    )
    row.pop("rendered_text_sha256")
    for key in (
        "run_segment_id", "session_id", "turn_id", "settlement_snapshot_id",
        "accepted_revision", "contract_projection_sha256", "contract_projection",
        "narration_review", "agency_claims",
    ):
        row.pop(key)
    row["integrity_digest"] = coc_turn_finalization.canonical_digest({
        key: value for key, value in row.items() if key != "integrity_digest"
    })
    path.write_text(
        json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return row


def test_historical_context_receipt_is_read_only_for_current_runtime(tmp_path):
    workspace, campaign = _workspace_with_finalized_turn(tmp_path)
    legacy = _rewrite_as_legacy_context_receipt(campaign)
    assert coc_turn_finalization._valid_finalization(legacy) is False
    assert coc_turn_finalization._valid_legacy_context_finalization(legacy) is True
    assert coc_turn_finalization.load_finalizations(campaign) == [legacy]

    journal = coc_toolbox.run_tool(
        "state.journal",
        workspace,
        "legacy-finalization",
        {"summary": "A new pending turn.", "player_text": "我开始新的回合行动。", "decision_id": "journal-two"},
    )
    assert journal["ok"] is False
    assert journal["error"]["code"] == "state_corrupt"


def test_tampered_historical_context_receipt_still_fails_closed(tmp_path):
    _workspace, campaign = _workspace_with_finalized_turn(tmp_path)
    _rewrite_as_legacy_context_receipt(campaign)
    path = campaign / "logs" / coc_turn_finalization.FINALIZATION_FILENAME
    row = json.loads(path.read_text(encoding="utf-8"))
    row["segments"][-1]["source_ids"] = [
        "context:npc-first-impression-v2:tampered"
    ]
    # Even recomputing the unkeyed whole-row digest cannot make the legacy
    # bundle/segment source mismatch a valid historical receipt.
    row["integrity_digest"] = coc_turn_finalization.canonical_digest({
        key: value for key, value in row.items() if key != "integrity_digest"
    })
    path.write_text(
        json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n",
        encoding="utf-8",
    )

    try:
        coc_turn_finalization.load_finalizations(campaign)
    except coc_turn_finalization.TurnContractError as exc:
        assert exc.code == "state_corrupt"
    else:
        raise AssertionError("tampered legacy finalization was accepted")
