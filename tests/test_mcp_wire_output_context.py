"""Bounded MCP wire projection for oversized turn.output_context."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import sys


SCRIPTS = Path(__file__).resolve().parents[1] / "plugins" / "coc-keeper" / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import coc_mcp_wire


def _digest(value) -> str:
    return "sha256:" + hashlib.sha256(
        json.dumps(
            value, ensure_ascii=False, sort_keys=True, separators=(",", ":")
        ).encode("utf-8")
    ).hexdigest()


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
    draft_status: dict | None = None,
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
    # The canonical producer always emits the bounded pending-draft status;
    # the default here is the exact not-yet-submitted actionable state.
    data["pending_narration_draft_status"] = (
        dict(draft_status)
        if draft_status is not None
        else _draft_status(actionable=True, status="not_submitted")
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


def test_hot_schema_fit_reserves_final_measurement_field(monkeypatch):
    result = {
        "ok": True,
        "tool": "session.resume",
        "wire": {},
        "data": {
            "ordinary_turn_operations": {
                "actions.advise": {
                    "operation": "actions.advise",
                    "arguments_schema": {
                        "type": "object",
                        "properties": {
                            f"field_{index}": {"type": "string"}
                            for index in range(40)
                        },
                    },
                },
            },
        },
        "warnings": [],
        "hints": [],
    }
    pre_measurement = coc_mcp_wire.transport_bytes(result)
    monkeypatch.setattr(
        coc_mcp_wire, "MAX_INLINE_BYTES", pre_measurement + 32,
    )

    coc_mcp_wire._fit_hot_argument_schemas(
        result,
        omit_order=("actions.advise",),
        reserve_bytes=64,
    )

    assert result["wire"]["hot_argument_schemas_omitted"] == [
        "actions.advise"
    ]
    measured = coc_mcp_wire.transport_bytes(result)
    result["wire"]["measured_inline_bytes"] = measured
    measured = coc_mcp_wire.transport_bytes(result)
    result["wire"]["measured_inline_bytes"] = measured
    assert coc_mcp_wire.transport_bytes(result) <= coc_mcp_wire.MAX_INLINE_BYTES


def test_resume_recovery_budget_includes_final_measurement_reserve(monkeypatch):
    result = {
        "ok": True,
        "tool": "session.resume",
        "wire": {},
        "data": {"payload": "x" * 256},
        "warnings": [],
        "hints": [],
    }
    current_bytes = coc_mcp_wire.transport_bytes(result)
    monkeypatch.setattr(
        coc_mcp_wire,
        "MAX_INLINE_BYTES",
        current_bytes + coc_mcp_wire.FINAL_MEASUREMENT_RESERVE_BYTES - 1,
    )

    assert coc_mcp_wire._exceeds_inline_budget(
        result,
        reserve_bytes=coc_mcp_wire.FINAL_MEASUREMENT_RESERVE_BYTES,
    ) is True
    assert coc_mcp_wire._exceeds_inline_budget(result) is False


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


def test_ordinary_not_applicable_context_keeps_finalize_card():
    data = _output_context_data(padding="短草稿", include_review_card=False)
    data["contract_projection"]["agency_review_required"] = False
    data["pending_narration_draft_status"] = _draft_status(
        actionable=True, status="not_applicable"
    )
    compact = coc_mcp_wire._compact_output_context(data)
    assert "frozen_narration_draft" not in compact
    assert "agency_review_operation" not in compact
    assert isinstance(compact["finalize_operation"], dict)


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


FROZEN_DRAFT_TEXT = "门缝里的灯光晃了一下，然后熄灭了。"


def _sealed_receipt(base: dict) -> dict:
    """Recompute the integrity digests so the only defect a mutation can
    introduce is the mutated field itself, never a stale digest."""
    base["draft_sha256"] = _digest(base["draft_text"])
    base.pop("receipt_digest", None)
    base["receipt_digest"] = _digest(base)
    return base


def _frozen_receipt(
    *,
    draft_text: str = FROZEN_DRAFT_TEXT,
    revision: int = 1,
    producer_kind: str = "narration_review_submission",
) -> dict:
    review_decision_id = "review-wire"
    receipt = {
        "schema_version": 1,
        "kind": "pending_narration_draft",
        "secrecy": "keeper_only",
        "campaign_id": "wire-test-campaign",
        "receipt_id": f"pending-narration-draft:{review_decision_id}:revision-{revision}",
        "review_decision_id": review_decision_id,
        "review_id": "narration-review-v1:wire",
        "turn_id": "turn-t13",
        "source_digest": "sha256:source-t13",
        "revision": revision,
        "draft_sha256": _digest(draft_text),
        "draft_text": draft_text,
        "draft_utf8_bytes": len(draft_text.encode("utf-8")),
        "review_digest": "sha256:" + "a" * 64,
        "request_digest": "sha256:" + "b" * 64,
        "producer_kind": producer_kind,
        "source_operation": "narration.review",
        "materialization_decision_id": review_decision_id,
        "provenance": {"kind": "direct_review_submission"},
    }
    return _sealed_receipt(receipt)


def _recovered_frozen_receipt() -> dict:
    """Canonical toolbox_audit_recovery receipt: its own distinct recovery
    decision id and the full bounded provenance binding."""
    receipt = _frozen_receipt(producer_kind="toolbox_audit_recovery")
    receipt["materialization_decision_id"] = "recover-wire:review-wire:1"
    receipt["provenance"] = {
        "kind": "verified_toolbox_audit_recovery",
        "source_path": "logs/toolbox-calls.jsonl",
        "source_row_count": 2,
        "primary_row_digest": "sha256:" + "1f" * 32,
        "corroboration_digest": "sha256:" + "2e" * 32,
    }
    return _sealed_receipt(receipt)


def _draft_status(*, actionable: bool, status: str = "available") -> dict:
    payload = {
        "schema_version": 1,
        "secrecy": "keeper_only",
        "status": status,
        "actionable": actionable,
    }
    if not actionable:
        payload["diagnostic"] = "canonical pending narration draft evidence is unavailable"
    return payload


def _assert_draft_and_cards_stripped(projected, *, oversize: str | None = None):
    assert "frozen_narration_draft" not in projected
    assert "agency_review_operation" not in projected
    assert "finalize_operation" not in projected
    serialized = json.dumps(projected, ensure_ascii=False)
    assert FROZEN_DRAFT_TEXT not in serialized
    if oversize is not None:
        assert oversize not in serialized


def test_wire_drops_nul_draft_and_cards_fail_closed():
    """A NUL-bearing draft is rejected even when its draft and receipt
    digests are recomputed around it — parity with the canonical Python
    validator. Both compact and tight projections strip draft and cards."""
    receipt = _frozen_receipt()
    receipt["draft_text"] = "门缝\u0000里的灯光晃了一下。"
    receipt["draft_utf8_bytes"] = len(receipt["draft_text"].encode("utf-8"))
    sealed = _sealed_receipt(receipt)
    data = _output_context_data(padding="短草稿")
    data["frozen_narration_draft"] = sealed
    data["pending_narration_draft_status"] = _draft_status(actionable=True)

    compact = coc_mcp_wire._compact_output_context(data)
    tight = coc_mcp_wire._project_output_context_review_card(data)
    for projected in (compact, tight):
        _assert_draft_and_cards_stripped(projected)
        assert "\u0000" not in json.dumps(projected, ensure_ascii=False)


def test_wire_rejects_non_canonical_actionable_status_matrix():
    """Retention is decided by the exact closed actionable status shape —
    schema 1, keeper-only secrecy, closed four-field set, allowed status —
    never from ``actionable`` + a recognized status string alone. Each case
    strips the draft and both cards and keeps bounded status diagnostics."""
    def data_with_status(status_payload, *, with_draft=True):
        data = _output_context_data(padding="短草稿")
        if with_draft:
            data["frozen_narration_draft"] = _frozen_receipt()
        data["pending_narration_draft_status"] = status_payload
        return data

    base = _draft_status(actionable=True)
    cases = {
        "missing schema_version": (
            {k: v for k, v in base.items() if k != "schema_version"}, None,
        ),
        "wrong schema_version": ({**base, "schema_version": 2}, None),
        "wrong secrecy": ({**base, "secrecy": "player_visible"}, None),
        "non-bool actionable": ({**base, "actionable": "true"}, None),
        "extra unknown field": ({**base, "surprise": "负载"}, None),
        "actionable with diagnostic": (
            {**base, "diagnostic": "不该出现的诊断"}, None,
        ),
        "status not a string": ({**base, "status": 3}, None),
        "status not a dict": ("available", None),
        # A malformed non-actionable status keeps no cards either, and its
        # oversize diagnostic never rides the wire.
        "oversize diagnostic non-actionable": (
            {
                **_draft_status(actionable=False, status="missing"),
                "diagnostic": "超" * 600,
            },
            "超" * 600,
        ),
    }
    for label, (status_payload, oversize) in cases.items():
        data = data_with_status(status_payload, with_draft=oversize is None)
        compact = coc_mcp_wire._compact_output_context(data)
        tight = coc_mcp_wire._project_output_context_review_card(data)
        for projected in (compact, tight):
            _assert_draft_and_cards_stripped(projected, oversize=oversize)
        if not isinstance(status_payload, dict):
            # A non-dict status projects as nothing at all.
            assert "pending_narration_draft_status" not in compact, label
            continue
        bounded = compact["pending_narration_draft_status"]
        assert set(bounded) <= {
            "schema_version", "secrecy", "status", "actionable", "diagnostic",
        }, label
        if label == "oversize diagnostic non-actionable":
            assert "diagnostic" not in bounded, label
        # The bounded identity/status diagnostics survive (string status
        # values are kept; non-string ones are dropped, not projected).
        if isinstance(status_payload.get("status"), str):
            assert bounded.get("status") == status_payload["status"], label
        assert coc_mcp_wire.transport_bytes(compact) <= coc_mcp_wire.MAX_INLINE_BYTES, label


def test_wire_rejects_non_integer_status_schema_versions():
    """schema_version must be exactly the integer 1: Python equality treats
    ``True`` and ``1.0`` as equal to 1, so an otherwise-valid actionable
    status carrying either must still strip the draft and both cards."""
    base = _draft_status(actionable=True)
    for label, bad_version in (
        ("status schema_version True", {**base, "schema_version": True}),
        ("status schema_version 1.0", {**base, "schema_version": 1.0}),
    ):
        data = _output_context_data(padding="短草稿")
        data["frozen_narration_draft"] = _frozen_receipt()
        data["pending_narration_draft_status"] = bad_version
        compact = coc_mcp_wire._compact_output_context(data)
        tight = coc_mcp_wire._project_output_context_review_card(data)
        for projected in (compact, tight):
            _assert_draft_and_cards_stripped(projected)
        bounded = compact["pending_narration_draft_status"]
        assert "schema_version" not in bounded, label
        assert coc_mcp_wire.transport_bytes(compact) <= (
            coc_mcp_wire.MAX_INLINE_BYTES
        ), label


def test_wire_rejects_non_integer_receipt_scalars():
    """Every receipt scalar integer is checked by exact ``int`` type before
    its value: ``bool`` and numerically equal ``float`` never count. Each
    case mutates exactly one scalar in an otherwise-valid receipt and
    recomputes every digest around the mutation, so the only defect is the
    scalar type itself; each must strip the frozen draft and both cards."""
    actual_bytes = len(FROZEN_DRAFT_TEXT.encode("utf-8"))

    def revision_case(revision_value):
        def mutate(receipt):
            receipt["revision"] = revision_value
            receipt["receipt_id"] = (
                f"pending-narration-draft:review-wire:revision-{revision_value}"
            )
        return mutate

    cases = {
        "receipt schema_version True": lambda r: r.update(schema_version=True),
        "receipt schema_version 1.0": lambda r: r.update(schema_version=1.0),
        "draft_utf8_bytes equal float": lambda r: r.update(
            draft_utf8_bytes=float(actual_bytes)
        ),
        "draft_utf8_bytes True": lambda r: r.update(draft_utf8_bytes=True),
        "revision True": revision_case(True),
        "revision 1.0": revision_case(1.0),
    }
    for label, mutate in cases.items():
        receipt = _frozen_receipt()
        mutate(receipt)
        data = _output_context_data(padding="短草稿")
        data["frozen_narration_draft"] = _sealed_receipt(receipt)
        data["pending_narration_draft_status"] = _draft_status(actionable=True)
        compact = coc_mcp_wire._compact_output_context(data)
        tight = coc_mcp_wire._project_output_context_review_card(data)
        for projected in (compact, tight):
            _assert_draft_and_cards_stripped(projected)
        assert coc_mcp_wire.transport_bytes(compact) <= (
            coc_mcp_wire.MAX_INLINE_BYTES
        ), label


def test_wire_rejects_non_integer_recovery_provenance_row_count():
    """The recovered provenance source_row_count is a strict ``int`` too:
    re-digested otherwise-valid recovery receipts carrying ``True`` or an
    equal ``float`` must strip the draft and both cards."""
    for label, bad_count in (("source_row_count True", True), ("2.0", 2.0)):
        receipt = _recovered_frozen_receipt()
        receipt["provenance"]["source_row_count"] = bad_count
        data = _output_context_data(padding="短草稿")
        data["frozen_narration_draft"] = _sealed_receipt(receipt)
        data["pending_narration_draft_status"] = _draft_status(actionable=True)
        compact = coc_mcp_wire._compact_output_context(data)
        tight = coc_mcp_wire._project_output_context_review_card(data)
        for projected in (compact, tight):
            _assert_draft_and_cards_stripped(projected)
        assert (
            compact["pending_narration_draft_status"]["status"] == "available"
        ), label


def test_wire_keeps_valid_actionable_status_with_receipt_control():
    """Valid control for the closed-status matrix: the exact canonical
    actionable status keeps the valid receipt and the full card chain."""
    data = _output_context_data(padding="短草稿")
    data["frozen_narration_draft"] = _frozen_receipt()
    data["pending_narration_draft_status"] = _draft_status(actionable=True)
    for projected in (
        coc_mcp_wire._compact_output_context(data),
        coc_mcp_wire._project_output_context_review_card(data),
    ):
        assert projected["frozen_narration_draft"]["draft_text"] == FROZEN_DRAFT_TEXT
        assert isinstance(projected["agency_review_operation"], dict)
        assert isinstance(projected["finalize_operation"], dict)
        assert projected["pending_narration_draft_status"]["actionable"] is True


def test_wire_keeps_frozen_draft_and_cards_only_when_actionable_true():
    data = _output_context_data(padding="短草稿")
    data["frozen_narration_draft"] = _frozen_receipt()
    data["pending_narration_draft_status"] = _draft_status(actionable=True)

    compact = coc_mcp_wire._compact_output_context(data)
    tight = coc_mcp_wire._project_output_context_review_card(data)
    for projected in (compact, tight):
        assert projected["frozen_narration_draft"]["draft_text"] == FROZEN_DRAFT_TEXT
        assert projected["pending_narration_draft_status"]["actionable"] is True
        assert isinstance(projected["agency_review_operation"], dict)
        assert isinstance(projected["finalize_operation"], dict)

    wire = _project("turn.output_context", _envelope(data))
    assert wire["ok"] is True
    assert wire["data"]["frozen_narration_draft"]["draft_text"] == FROZEN_DRAFT_TEXT


def test_wire_keeps_valid_recovered_receipt_with_cards():
    data = _output_context_data(padding="短草稿")
    data["frozen_narration_draft"] = _recovered_frozen_receipt()
    data["pending_narration_draft_status"] = _draft_status(actionable=True)

    compact = coc_mcp_wire._compact_output_context(data)
    assert compact["frozen_narration_draft"]["producer_kind"] == (
        "toolbox_audit_recovery"
    )
    assert isinstance(compact["agency_review_operation"], dict)
    assert isinstance(compact["finalize_operation"], dict)


def test_wire_drops_frozen_draft_and_cards_when_not_actionable():
    data = _output_context_data(padding="短草稿")
    data["frozen_narration_draft"] = _frozen_receipt()
    data["pending_narration_draft_status"] = _draft_status(
        actionable=False, status="missing"
    )

    compact = coc_mcp_wire._compact_output_context(data)
    assert "frozen_narration_draft" not in compact
    assert "agency_review_operation" not in compact
    assert "finalize_operation" not in compact
    # Bounded diagnostic identity/status is retained, never the draft bytes.
    assert compact["pending_narration_draft_status"]["status"] == "missing"
    assert compact["pending_narration_draft_status"]["actionable"] is False

    wire = _project("turn.output_context", _envelope(data))
    assert wire["ok"] is True
    serialized = json.dumps(wire, ensure_ascii=False)
    assert FROZEN_DRAFT_TEXT not in serialized


def test_wire_drops_draft_and_cards_when_actionable_missing():
    data = _output_context_data(padding="短草稿")
    data["frozen_narration_draft"] = _frozen_receipt()
    status = _draft_status(actionable=True)
    del status["actionable"]
    data["pending_narration_draft_status"] = status

    compact = coc_mcp_wire._compact_output_context(data)
    assert "frozen_narration_draft" not in compact
    assert "agency_review_operation" not in compact
    assert "finalize_operation" not in compact
    serialized = json.dumps(compact, ensure_ascii=False)
    assert FROZEN_DRAFT_TEXT not in serialized


def test_wire_drops_draft_and_cards_when_status_missing():
    data = _output_context_data(padding="短草稿")
    data["frozen_narration_draft"] = _frozen_receipt()
    # No pending_narration_draft_status at all: a legacy/statusless value
    # never carries the draft and never keeps actionable cards.
    del data["pending_narration_draft_status"]
    compact = coc_mcp_wire._compact_output_context(data)
    assert "frozen_narration_draft" not in compact
    assert "agency_review_operation" not in compact
    assert "finalize_operation" not in compact


def test_wire_drops_draft_and_cards_when_status_wrong():
    data = _output_context_data(padding="短草稿")
    data["frozen_narration_draft"] = _frozen_receipt()
    # A status outside the canonical set is wrong even with actionable true.
    data["pending_narration_draft_status"] = _draft_status(actionable=True)
    data["pending_narration_draft_status"]["status"] = "recovering"
    compact = coc_mcp_wire._compact_output_context(data)
    assert "frozen_narration_draft" not in compact
    assert "agency_review_operation" not in compact
    assert "finalize_operation" not in compact

    # "available" status without the promised receipt is incoherent too.
    incoherent = _output_context_data(padding="短草稿")
    incoherent["pending_narration_draft_status"] = _draft_status(actionable=True)
    compact = coc_mcp_wire._compact_output_context(incoherent)
    assert "frozen_narration_draft" not in compact
    assert "agency_review_operation" not in compact
    assert "finalize_operation" not in compact


def test_wire_drops_draft_and_cards_when_receipt_malformed():
    data = _output_context_data(padding="短草稿")
    receipt = _frozen_receipt()
    # Digest-only defect: every other field stays valid, only receipt_digest
    # is corrupted, so the wire validity check itself must reject.
    receipt["receipt_digest"] = "sha256:" + "c0" * 32
    data["frozen_narration_draft"] = receipt
    data["pending_narration_draft_status"] = _draft_status(actionable=True)

    compact = coc_mcp_wire._compact_output_context(data)
    assert "frozen_narration_draft" not in compact
    assert "agency_review_operation" not in compact
    assert "finalize_operation" not in compact
    assert compact["pending_narration_draft_status"]["status"] == "available"
    serialized = json.dumps(compact, ensure_ascii=False)
    assert FROZEN_DRAFT_TEXT not in serialized

    # A truthy non-string semantic identity is malformed even though the
    # digest is recomputed around it.
    typed_bad = _frozen_receipt()
    typed_bad["materialization_decision_id"] = 12345
    typed_bad.pop("receipt_digest")
    typed_bad["receipt_digest"] = _digest(typed_bad)
    data["frozen_narration_draft"] = typed_bad
    compact = coc_mcp_wire._compact_output_context(data)
    assert "frozen_narration_draft" not in compact
    assert "finalize_operation" not in compact


def test_wire_drops_oversize_frozen_draft_fail_closed():
    data = _output_context_data(padding="短草稿")
    oversize = "霜" * 8193
    data["frozen_narration_draft"] = _frozen_receipt(draft_text=oversize)
    data["pending_narration_draft_status"] = _draft_status(actionable=True)

    compact = coc_mcp_wire._compact_output_context(data)
    assert "frozen_narration_draft" not in compact
    assert "agency_review_operation" not in compact
    assert "finalize_operation" not in compact

    wire = _project("turn.output_context", _envelope(data))
    assert wire["ok"] is True
    assert "frozen_narration_draft" not in wire["data"]
    serialized = json.dumps(wire, ensure_ascii=False)
    assert oversize not in serialized
    assert coc_mcp_wire.transport_bytes(wire) <= coc_mcp_wire.MAX_INLINE_BYTES


def test_wire_never_leaks_frozen_draft_to_identity_only_surface():
    envelope = {
        "ok": True,
        "tool": "state.journal",
        "data": {
            "schema_version": 1,
            "turn_id": "turn-other",
            "decision_id": "journal-other",
            "source_digest": "sha256:source-other",
            "bulk": T13_PADDING,
            "frozen_narration_draft": _frozen_receipt(),
            "pending_narration_draft_status": _draft_status(actionable=True),
        },
        "warnings": [],
        "hints": [],
    }
    projected = _project("state.journal", envelope)
    assert projected["ok"] is True
    assert projected["wire"]["identity_only"] is True
    serialized = json.dumps(projected, ensure_ascii=False)
    assert FROZEN_DRAFT_TEXT not in serialized
    assert "frozen_narration_draft" not in projected["data"]
    assert "bulk" not in projected["data"]
