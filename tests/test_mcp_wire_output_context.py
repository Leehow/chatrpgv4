"""Bounded MCP wire projection for oversized turn.output_context."""
from __future__ import annotations

import json
from pathlib import Path
import sys


SCRIPTS = Path(__file__).resolve().parents[1] / "plugins" / "coc-keeper" / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import coc_mcp_wire


CONTRACT_DIGEST = "sha256:output-context-wire-test"
T13_PADDING = "调查记录" * 4000  # ~32KB of drafting bulk, not review identity
T13_SUBJECT_REFS = ["pc:thomas-hayes"]


def _agency_review_operation(
    *,
    turn_id: str = "turn-t13",
    source_digest: str = "sha256:source-t13",
    revision: int = 1,
    extra: dict | None = None,
) -> dict:
    card = {
        "operation": "narration.review",
        "invoke_via": "coc_narration_review",
        "prefilled_arguments": {
            "turn_id": turn_id,
            "source_digest": source_digest,
            "revision": revision,
        },
        "missing_arguments": [
            "decision_id",
            "draft_text",
            "findings",
            "state_authority_review",
        ],
        "discovery_required": False,
        "authority": "semantic_agency_and_player_state_review",
        "hard_gate_scope": "agency_and_player_state_authority_only",
        "host_state_claim_compiler_required": True,
    }
    if extra:
        card.update(extra)
    return card


def _output_context_data(
    *,
    padding: str = T13_PADDING,
    pc_subject_refs: list[str] | None = T13_SUBJECT_REFS,
    include_review_card: bool = True,
    review_extra: dict | None = None,
) -> dict:
    data = {
        "schema_version": 1,
        "turn_id": "turn-t13",
        "turn_number": 13,
        "journal_decision_id": "journal-t13",
        "source_digest": "sha256:source-t13",
        "source_roll_ids": [f"roll-{index}" for index in range(24)],
        "settlement_snapshot_id": "snapshot-t13",
        "mechanics_bundle_sha256": "sha256:bundle-t13",
        "contract_projection_sha256": "sha256:contract-t13",
        "required_obligation_ids": ["obligation-public-check"],
        "obligations": [
            {
                "obligation_id": "obligation-public-check",
                "kind": "public_check",
                "detail": padding,
            }
        ],
        "mechanics_bundle": {
            "journal_decision_id": "journal-t13",
            "public_check": [
                {
                    "roll_id": "roll-t13",
                    "skill": "Spot Hidden",
                    "roll": 41,
                    "base_target": 55,
                    "outcome": "success",
                    "attempt_advisory": {"note": padding},
                }
            ],
            "state_delta": [],
            "exceptional_effect": [],
            "concealed_consequence": [{"secret": padding}],
        },
        "contract_projection": {
            "schema_version": 1,
            "turn_id": "turn-t13",
            "source_digest": "sha256:source-t13",
            "player_input": {"text": padding},
            "scene_contract": {"notes": padding},
            "agency_review_required": True,
            "agency_authority": {
                "involuntary_physiology_sources": [{
                    "source_ref": "narration_contract:involuntary_physiology",
                    "source_type": "ownership_contract",
                }],
            },
        },
        "npc_performance_constraints": [{"portrayal": padding}],
        "candidate_factors": [{"factor": padding}],
        "missing_substantive_effects": [],
        "pending_modifier_consumptions": [],
    }
    if pc_subject_refs is not None:
        data["contract_projection"]["agency_authority"]["pc_subject_refs"] = (
            list(pc_subject_refs)
        )
    if include_review_card:
        data["agency_review_operation"] = _agency_review_operation(
            extra=review_extra,
        )
    return data


def _envelope(data: dict) -> dict:
    return {
        "ok": True,
        "tool": "turn.output_context",
        "data": data,
        "warnings": ["keeper-only drafting material must stay off the player wire"],
        "hints": ["draft from obligations then review"],
    }


def _project(operation: str, envelope: dict) -> dict:
    return coc_mcp_wire.project_envelope(
        operation,
        envelope,
        contract_digest=CONTRACT_DIGEST,
    )


def test_t13_shaped_output_context_reproduces_oversize_then_keeps_review_card():
    data = _output_context_data()
    envelope = _envelope(data)
    raw_bytes = coc_mcp_wire.transport_bytes(envelope)
    compact = coc_mcp_wire._compact_output_context(data)
    compact_bytes = coc_mcp_wire.transport_bytes(compact)

    assert raw_bytes > 32 * 1024
    assert compact_bytes > coc_mcp_wire.MAX_INLINE_BYTES
    assert isinstance(compact.get("agency_review_operation"), dict)
    assert compact["contract_projection"]["agency_authority"]["pc_subject_refs"] == (
        T13_SUBJECT_REFS
    )

    projected = _project("turn.output_context", envelope)
    projected_bytes = coc_mcp_wire.transport_bytes(projected)
    serialized = json.dumps(projected, ensure_ascii=False)

    assert projected["ok"] is True
    assert projected["tool"] == "turn.output_context"
    assert projected["wire"]["payload_projected"] is True
    assert projected["wire"]["tight_projection"] is True
    assert projected["wire"].get("identity_only") is not True
    assert projected["wire"]["full_result_bytes"] > coc_mcp_wire.MAX_INLINE_BYTES
    assert projected_bytes <= coc_mcp_wire.MAX_INLINE_BYTES
    assert projected["wire"]["measured_inline_bytes"] == projected_bytes

    card = projected["data"]["agency_review_operation"]
    assert card["operation"] == "narration.review"
    assert card["invoke_via"] == "coc_narration_review"
    assert card["prefilled_arguments"] == {
        "turn_id": "turn-t13",
        "source_digest": "sha256:source-t13",
        "revision": 1,
    }
    authority = projected["data"]["contract_projection"]["agency_authority"]
    assert authority["pc_subject_refs"] == T13_SUBJECT_REFS
    assert projected["data"]["turn_id"] == "turn-t13"
    assert projected["data"]["source_digest"] == "sha256:source-t13"
    assert projected["data"]["settlement_snapshot_id"] == "snapshot-t13"
    assert projected["data"]["mechanics_bundle_sha256"] == "sha256:bundle-t13"
    assert T13_PADDING not in serialized
    assert "concealed_consequence" not in projected["data"]
    assert "player_input" not in projected["data"].get("contract_projection", {})


def test_fitting_output_context_keeps_ordinary_compact():
    data = _output_context_data(padding="短草稿")
    projected = _project("turn.output_context", _envelope(data))

    assert projected["ok"] is True
    assert projected["wire"].get("tight_projection") is not True
    assert projected["wire"].get("identity_only") is not True
    assert projected["data"]["agency_review_operation"]["prefilled_arguments"][
        "revision"
    ] == 1
    assert projected["data"]["mechanics_summary"]["public_check"][0]["roll_id"] == (
        "roll-t13"
    )
    assert projected["data"]["contract_projection"]["player_input"]["text"] == "短草稿"
    assert coc_mcp_wire.transport_bytes(projected) <= coc_mcp_wire.MAX_INLINE_BYTES


def test_tight_output_context_preserves_empty_pc_subject_refs():
    data = _output_context_data(pc_subject_refs=[])
    projected = _project("turn.output_context", _envelope(data))

    assert projected["ok"] is True
    assert projected["wire"]["tight_projection"] is True
    assert projected["data"]["contract_projection"]["agency_authority"][
        "pc_subject_refs"
    ] == []
    assert projected["data"]["agency_review_operation"]["operation"] == (
        "narration.review"
    )


def test_tight_output_context_does_not_invent_missing_review_card():
    data = _output_context_data(include_review_card=False)
    projected = _project("turn.output_context", _envelope(data))

    assert projected["ok"] is True
    assert projected["wire"]["tight_projection"] is True
    assert "agency_review_operation" not in projected["data"]
    assert projected["data"]["contract_projection"]["agency_authority"][
        "pc_subject_refs"
    ] == T13_SUBJECT_REFS
    assert coc_mcp_wire.transport_bytes(projected) <= coc_mcp_wire.MAX_INLINE_BYTES


def test_output_context_fails_closed_when_review_card_itself_exceeds_budget():
    data = _output_context_data(
        padding="短草稿",
        review_extra={"pathological_payload": "卡面本身超预算" * 4000},
    )
    envelope = _envelope(data)
    compact = coc_mcp_wire._compact_output_context(data)
    tight = coc_mcp_wire._project_output_context_review_card(data)
    assert coc_mcp_wire.transport_bytes(compact) > coc_mcp_wire.MAX_INLINE_BYTES
    assert coc_mcp_wire.transport_bytes(tight) > coc_mcp_wire.MAX_INLINE_BYTES
    assert isinstance(tight.get("agency_review_operation"), dict)

    projected = _project("turn.output_context", envelope)

    assert projected["ok"] is False
    assert projected["tool"] == "turn.output_context"
    assert projected["wire"]["projection_failed"] is True
    assert projected["error"]["code"] == "mcp_wire_budget_exceeded"
    assert projected["wire"].get("identity_only") is not True
    assert "agency_review_operation" not in (projected.get("data") or {})
    assert coc_mcp_wire.transport_bytes(projected) <= coc_mcp_wire.MAX_INLINE_BYTES


def test_unrelated_tool_still_uses_identity_only_when_over_budget():
    envelope = {
        "ok": True,
        "tool": "state.journal",
        "data": {
            "schema_version": 1,
            "turn_id": "turn-other",
            "decision_id": "journal-other",
            "source_digest": "sha256:source-other",
            "bulk": T13_PADDING,
            "agency_review_operation": _agency_review_operation(),
        },
        "warnings": [],
        "hints": [],
    }
    assert coc_mcp_wire.transport_bytes(envelope) > coc_mcp_wire.MAX_INLINE_BYTES

    projected = _project("state.journal", envelope)

    assert projected["ok"] is True
    assert projected["wire"]["identity_only"] is True
    assert projected["wire"].get("tight_projection") is not True
    assert projected["data"]["turn_id"] == "turn-other"
    assert projected["data"]["decision_id"] == "journal-other"
    assert "agency_review_operation" not in projected["data"]
    assert "bulk" not in projected["data"]
    assert coc_mcp_wire.transport_bytes(projected) <= coc_mcp_wire.MAX_INLINE_BYTES
