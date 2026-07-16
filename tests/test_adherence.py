"""Tests for narrative adherence checklist (SENNA / Narrative Adherence paper)."""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
HAUNTING = ROOT / "plugins/coc-keeper/references/starter-scenarios/the-haunting"


def _load(name: str, rel: str):
    spec = importlib.util.spec_from_file_location(name, ROOT / rel)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


coc_adherence = _load("coc_adherence", "plugins/coc-keeper/scripts/coc_adherence.py")
coc_npc_identity = _load(
    "coc_npc_identity_test", "plugins/coc-keeper/scripts/coc_npc_identity.py"
)


def _attested_npc_event(
    npc_id: str,
    *,
    event_type: str = "npc_engagement",
    agenda: str | None = None,
) -> dict:
    contract = coc_npc_identity.identity_contract(
        {
            "npc_id": npc_id,
            "name": npc_id,
            "agenda": agenda,
            "schedule": [],
            "source_refs": [],
        },
        "scene-test",
    )
    return {
        "schema_version": coc_npc_identity.ENGAGEMENT_EVENT_SCHEMA_VERSION,
        "event_type": event_type,
        "scene_id": "scene-test",
        "npc_id": npc_id,
        "identity_contract": contract,
        "identity_binding": coc_npc_identity.identity_binding(
            contract,
            structured_producer="director_apply.npc_move",
        ),
    }


def test_generate_adherence_checklist_from_haunting():
    checklist = coc_adherence.generate_adherence_checklist(HAUNTING)
    assert checklist, "expected non-empty checklist from the-haunting"
    kinds = {s["kind"] for s in checklist}
    assert "required" in kinds
    assert "optional" in kinds

    by_criterion = {}
    for stmt in checklist:
        assert "statement_id" in stmt
        assert "description" in stmt
        assert stmt["kind"] in {"required", "optional"}
        assert isinstance(stmt["criterion"], dict)
        key = next(iter(stmt["criterion"]))
        by_criterion.setdefault(key, []).append(stmt)

    # Required: conclusion minimum_routes coverage
    conclusion_stmts = [
        s for s in checklist
        if s["kind"] == "required" and "conclusion_id" in s["criterion"]
    ]
    assert conclusion_stmts
    assert any(
        s["criterion"].get("conclusion_id") == "corbitt-buried-in-basement"
        for s in conclusion_stmts
    )

    # Required: reach a terminal/final scene
    terminal_stmts = [
        s for s in checklist
        if s["kind"] == "required" and s["criterion"].get("scene_id")
        and s.get("statement_id", "").startswith("terminal")
    ]
    assert terminal_stmts
    assert any(
        s["criterion"]["scene_id"] == "corbitt-confrontation" for s in terminal_stmts
    )

    # Required: threat-front clock integrity
    clock_stmts = [
        s for s in checklist
        if s["kind"] == "required" and "front_id" in s["criterion"]
    ]
    assert clock_stmts
    assert any(
        s["criterion"].get("front_id") == "corbitt-haunting" for s in clock_stmts
    )

    # Optional: scenes / bonus / npc
    assert any(s["kind"] == "optional" and "scene_id" in s["criterion"] for s in checklist)
    # The current semantic clue schema removed legacy nested ``bonus`` rows.
    # Consumers must not fabricate bonus-roll statements from ordinary
    # skill/difficulty fields when the producer no longer declares them.
    assert not any(
        s["kind"] == "optional" and "bonus_clue_id" in s["criterion"]
        for s in checklist
    )
    assert any(s["kind"] == "optional" and "npc_id" in s["criterion"] for s in checklist)


def test_evaluate_adherence_against_synthetic_play_record():
    checklist = coc_adherence.generate_adherence_checklist(HAUNTING)
    npc_evidence = {
        "schema_version": 1,
        "semantics": "authored_identity_attestation",
        "status": "PASS",
        "authored_attested_npc_ids": ["npc-steven-knott"],
        "legacy_unverifiable_npc_ids": [],
        "unverified_npc_ids": [],
    }
    # Partial play: some basement-burial clues, no terminal, clocks ok, one optional NPC.
    play = {
        "discovered_clue_ids": [
            "clue-basement-burial-lawsuit",
            "clue-will-executor-chapel",
            "clue-chapel-journal-burial",
        ],
        "visited_scene_ids": [
            "commission-briefing",
            "newspaper-morgue",
            "hall-of-records",
        ],
        "clocks": {
            "corbitt-awareness": {"current_segments": 1, "full": False},
            "landlord-impatience": {"current_segments": 0, "full": False},
        },
        "bonus_rolls_engaged": [],
        "engaged_npc_ids": ["npc-steven-knott"],
        "npc_engagement_evidence": npc_evidence,
        "npc_engagement_coverage_contract": {
            "schema_version": 3,
            "semantics": "authored_identity_attestation",
            "producer": "coc_live_match",
            "projection_schema_version": 1,
            "legacy_raw_ids_included": False,
            "legacy_status": "PASS",
            "evidence_digest": coc_npc_identity.engagement_evidence_digest(
                npc_evidence
            ),
        },
    }
    result = coc_adherence.evaluate_adherence(
        checklist,
        play,
        trusted_npc_engagement_events=[
            _attested_npc_event("npc-steven-knott")
        ],
    )
    assert "statements" in result
    assert "required_coverage" in result
    statements = {s["statement_id"]: s for s in result["statements"]}

    burial = next(
        s for s in result["statements"]
        if s["criterion"].get("conclusion_id") == "corbitt-buried-in-basement"
    )
    assert burial["satisfied"] is True  # 3 clues >= minimum_routes 3

    terminal = next(
        s for s in result["statements"]
        if s["statement_id"].startswith("terminal")
    )
    assert terminal["satisfied"] is False

    knott = next(
        s for s in result["statements"]
        if s["criterion"].get("npc_id") == "npc-steven-knott"
    )
    assert knott["satisfied"] is True

    required = [s for s in result["statements"] if s["kind"] == "required"]
    satisfied_req = sum(1 for s in required if s["satisfied"])
    assert result["required_coverage"] == pytest.approx(satisfied_req / len(required))
    assert 0.0 <= result["required_coverage"] < 1.0


def test_evaluate_adherence_accepts_session_result_shape():
    checklist = [
        {
            "statement_id": "conclusion:c1",
            "kind": "required",
            "criterion": {"conclusion_id": "c1", "clue_ids": ["a", "b"], "minimum_routes": 2},
            "description": "Reach conclusion c1",
        },
        {
            "statement_id": "terminal:end",
            "kind": "required",
            "criterion": {"scene_id": "end"},
            "description": "Reach ending",
        },
    ]
    session_result = {
        "clue_coverage": {"discovered": ["a", "b"]},
        "scene_path": ["start", "end"],
        "final_state": {"discovered_clues": ["a", "b"]},
    }
    result = coc_adherence.evaluate_adherence(checklist, session_result)
    by_id = {s["statement_id"]: s for s in result["statements"]}
    assert by_id["conclusion:c1"]["satisfied"] is True
    assert by_id["terminal:end"]["satisfied"] is True
    assert result["required_coverage"] == 1.0


def test_evaluate_adherence_reads_clue_bonus_from_live_turn_shape():
    """Live match persists clue_bonus on turns/events, not bonus_rolls_engaged."""
    checklist = [
        {
            "statement_id": "bonus:clue-larkin-illness",
            "kind": "optional",
            "criterion": {"bonus_clue_id": "clue-larkin-illness"},
            "description": "Engage bonus roll for clue 'clue-larkin-illness'",
        },
        {
            "statement_id": "bonus:clue-other",
            "kind": "optional",
            "criterion": {"bonus_clue_id": "clue-other"},
            "description": "Engage bonus roll for clue 'clue-other'",
        },
    ]
    # Mirrors masks-peru-r2 / live-match turn + events.jsonl shapes.
    play = {
        "discovered_clue_ids": ["clue-larkin-illness"],
        "turns": [
            {
                "turn": 3,
                "event_types": ["skill_check_earned", "clue_bonus_reveal", "clue_reveal"],
                "clue_revealed": ["clue-larkin-illness"],
                "rules_requests": [
                    {
                        "clue_bonus": True,
                        "clue_id": "clue-larkin-illness",
                        "skill": "Medicine",
                        "roll_contract": {
                            "roll_density_group": "clue-bonus:clue-larkin-illness",
                        },
                    }
                ],
                "resolved_clue_policy": {
                    "committed_reveals": ["clue-larkin-illness"],
                    "bonus_reveal": "something is rotting him from within.",
                },
                "npc_moves": [],
            }
        ],
        "events": [
            {
                "event_type": "clue_bonus_reveal",
                "clue_id": "clue-larkin-illness",
                "bonus_reveal": "something is rotting him from within.",
            }
        ],
    }
    result = coc_adherence.evaluate_adherence(checklist, play)
    by_id = {s["statement_id"]: s for s in result["statements"]}
    assert by_id["bonus:clue-larkin-illness"]["satisfied"] is True
    assert by_id["bonus:clue-other"]["satisfied"] is False


def test_evaluate_adherence_reads_npc_engagement_from_turns_and_events():
    """NPC engagement is recorded via turn npc_moves and/or npc_engagement events."""
    checklist = [
        {
            "statement_id": "npc:npc-augustus-larkin",
            "kind": "optional",
            "criterion": {"npc_id": "npc-augustus-larkin"},
            "description": "Engage NPC 'Augustus Larkin'",
        },
        {
            "statement_id": "npc:npc-nayra",
            "kind": "optional",
            "criterion": {"npc_id": "npc-nayra"},
            "description": "Engage NPC 'Nayra'",
        },
        {
            "statement_id": "npc:npc-update-only",
            "kind": "optional",
            "criterion": {"npc_id": "npc-update-only"},
            "description": "Do not count a psych update as identity attestation",
        },
    ]
    play = {
        "turns": [
            {
                "npc_moves": [
                    {
                        **{
                            key: value
                            for key, value in _attested_npc_event(
                                "npc-augustus-larkin"
                            ).items()
                            if key != "event_type"
                        },
                        "display_name": "Augustus Larkin",
                    },
                    {"npc_id": "npc-luis-de-mendoza", "display_name": "Luis de Mendoza"},
                ],
            }
        ],
        "events": [
            _attested_npc_event("npc-augustus-larkin"),
            {"event_type": "npc_update", "npc_id": "npc-nayra", "applied": {"trust": 1}},
            _attested_npc_event("npc-nayra"),
            {
                "event_type": "npc_update",
                "npc_id": "npc-update-only",
                "applied": {"trust": 1},
            },
        ],
    }
    result = coc_adherence.evaluate_adherence(
        checklist,
        play,
        trusted_npc_engagement_events=play["events"],
    )
    by_id = {s["statement_id"]: s for s in result["statements"]}
    assert by_id["npc:npc-augustus-larkin"]["satisfied"] is True
    assert by_id["npc:npc-nayra"]["satisfied"] is True
    assert by_id["npc:npc-update-only"]["satisfied"] is False


def test_project_engaged_npc_ids_requires_authored_identity_attestation():
    events = [
        {**_attested_npc_event("npc-kim-debrun"), "interaction_kind": "dialogue"},
        {
            "event_type": "npc_update",
            "npc_id": "npc-steven-knott",
            "applied": {"trust": 1},
        },
        {"event_type": "turn", "npc_id": "npc-not-an-engagement"},
    ]

    assert coc_adherence.project_engaged_npc_ids(events) == {"npc-kim-debrun"}
    evidence = coc_adherence.project_npc_engagement_evidence(events)
    assert evidence == {
        "schema_version": 1,
        "semantics": "authored_identity_attestation",
        "status": "PASS",
        "authored_attested_npc_ids": ["npc-kim-debrun"],
        "legacy_unverifiable_npc_ids": [],
        "unverified_npc_ids": [],
    }


def test_schema_less_or_internally_inconsistent_identity_claims_never_attest():
    valid = _attested_npc_event("npc-dooley")
    schema_less = {
        "event_type": "npc_engagement",
        "npc_id": "npc-dooley",
        "identity_binding": {
            "status": "authored_bound",
            "authored_identity_attested": True,
            "coverage_eligible": True,
        },
    }
    wrong_event_id = {
        **valid,
        "npc_id": "npc-not-dooley",
    }
    unsupported_binding = {
        **valid,
        "identity_binding": {
            **valid["identity_binding"],
            "schema_version": 99,
        },
    }

    evidence = coc_adherence.project_npc_engagement_evidence(
        [schema_less, wrong_event_id, unsupported_binding]
    )
    assert evidence == {
        "schema_version": 1,
        "semantics": "authored_identity_attestation",
        "status": "NON_COMPARABLE",
        "authored_attested_npc_ids": [],
        "legacy_unverifiable_npc_ids": ["npc-dooley"],
        "unverified_npc_ids": ["npc-dooley", "npc-not-dooley"],
    }


def test_identity_attestation_binds_event_scene_with_v1_missing_scene_compatibility():
    valid = _attested_npc_event("npc-dooley")
    contract = coc_npc_identity.identity_contract(
        {
            "npc_id": "npc-dooley",
            "name": "Dooley",
            "schedule": [{"scene_ids": ["neighborhood-gossip"]}],
            "source_refs": [],
        },
        "neighborhood-gossip",
    )
    binding = coc_npc_identity.identity_binding(
        contract, structured_producer="director_apply.npc_move"
    )
    wrong_scene = {
        "schema_version": 2,
        "event_type": "npc_engagement",
        "scene_id": "corbitt-house",
        "npc_id": "npc-dooley",
        "identity_contract": contract,
        "identity_binding": binding,
    }
    schema_v2_missing_scene = {
        **wrong_scene,
    }
    schema_v2_missing_scene.pop("scene_id")

    evidence = coc_adherence.project_npc_engagement_evidence(
        [wrong_scene, schema_v2_missing_scene, valid]
    )

    assert evidence["authored_attested_npc_ids"] == ["npc-dooley"]
    assert evidence["unverified_npc_ids"] == ["npc-dooley"]


def test_supported_payload_envelope_identity_contract_is_consumed():
    event = _attested_npc_event(
        "npc-envelope-guide", event_type="npc_agency"
    )
    wrapped = {
        "type": "npc_agency",
        "payload": {
            key: value
            for key, value in event.items()
            if key != "event_type"
        },
    }

    assert coc_adherence.project_engaged_npc_ids([wrapped]) == {
        "npc-envelope-guide"
    }


def test_unverified_or_mismatched_npc_ids_do_not_satisfy_authored_coverage():
    checklist = [
        {
            "statement_id": "npc:npc-dooley",
            "kind": "optional",
            "criterion": {"npc_id": "npc-dooley"},
            "description": "Engage NPC 'Mr. Dooley'",
        },
        {
            "statement_id": "npc:npc-kim-debrun",
            "kind": "optional",
            "criterion": {"npc_id": "npc-kim-debrun"},
            "description": "Engage NPC 'Kim Debrun'",
        },
    ]
    events = [
        {"event_type": "npc_engagement", "npc_id": "npc-dooley"},
        {
            "event_type": "npc_engagement",
            "npc_id": "npc-dooley",
            "identity_binding": {
                "status": "mismatch",
                "coverage_eligible": False,
            },
        },
        _attested_npc_event("npc-kim-debrun"),
    ]

    evidence = coc_adherence.project_npc_engagement_evidence(events)
    assert coc_adherence.project_engaged_npc_ids(events) == {"npc-kim-debrun"}
    assert evidence == {
        "schema_version": 1,
        "semantics": "authored_identity_attestation",
        "status": "NON_COMPARABLE",
        "authored_attested_npc_ids": ["npc-kim-debrun"],
        "legacy_unverifiable_npc_ids": ["npc-dooley"],
        "unverified_npc_ids": [],
    }
    result = coc_adherence.evaluate_adherence(
        checklist,
        {"events": events},
        trusted_npc_engagement_events=events,
    )
    by_id = {row["statement_id"]: row for row in result["statements"]}
    assert by_id["npc:npc-dooley"]["satisfied"] is False
    assert by_id["npc:npc-kim-debrun"]["satisfied"] is True
    assert result["npc_engagement_evidence"]["status"] == "NON_COMPARABLE"


def test_unversioned_explicit_npc_ids_are_non_comparable_not_coverage():
    checklist = [{
        "statement_id": "npc:npc-dooley",
        "kind": "optional",
        "criterion": {"npc_id": "npc-dooley"},
        "description": "Engage Dooley",
    }]
    result = coc_adherence.evaluate_adherence(
        checklist, {"engaged_npc_ids": ["npc-dooley"]}
    )
    assert result["statements"][0]["satisfied"] is False
    assert result["npc_engagement_evidence"] == {
        "schema_version": 1,
        "semantics": "authored_identity_attestation",
        "status": "NON_COMPARABLE",
        "authored_attested_npc_ids": [],
        "legacy_unverifiable_npc_ids": ["npc-dooley"],
        "unverified_npc_ids": [],
    }


def test_unsupported_projection_contract_cannot_promote_raw_attested_ids():
    checklist = [{
        "statement_id": "npc:npc-dooley",
        "kind": "optional",
        "criterion": {"npc_id": "npc-dooley"},
        "description": "Engage Dooley",
    }]
    result = coc_adherence.evaluate_adherence(
        checklist,
        {
            "engaged_npc_ids": ["npc-dooley"],
            "npc_engagement_coverage_contract": {
                "schema_version": 999,
                "semantics": "authored_identity_attestation",
            },
            "npc_engagement_evidence": {
                "schema_version": 1,
                "semantics": "authored_identity_attestation",
                "authored_attested_npc_ids": ["npc-dooley"],
            },
        },
    )
    assert result["statements"][0]["satisfied"] is False
    assert result["npc_engagement_evidence"] == {
        "schema_version": 1,
        "semantics": "authored_identity_attestation",
        "status": "NON_COMPARABLE",
        "authored_attested_npc_ids": [],
        "legacy_unverifiable_npc_ids": [],
        "unverified_npc_ids": ["npc-dooley"],
    }


def test_self_declared_supported_projection_without_bound_evidence_cannot_promote_ids():
    checklist = [{
        "statement_id": "npc:npc-forged",
        "kind": "optional",
        "criterion": {"npc_id": "npc-forged"},
        "description": "Do not promote an unbound raw ID",
    }]
    result = coc_adherence.evaluate_adherence(
        checklist,
        {
            "engaged_npc_ids": ["npc-forged"],
            "npc_engagement_coverage_contract": {
                "schema_version": 3,
                "semantics": "authored_identity_attestation",
                "producer": "coc_live_match",
                "projection_schema_version": 1,
                "legacy_raw_ids_included": False,
                "legacy_status": "PASS",
                "evidence_digest": "sha256:" + "0" * 64,
            },
        },
    )
    assert result["statements"][0]["satisfied"] is False
    assert result["npc_engagement_evidence"]["authored_attested_npc_ids"] == []
    assert result["npc_engagement_evidence"]["unverified_npc_ids"] == [
        "npc-forged"
    ]


def test_projection_requires_exact_raw_id_equality_with_digest_bound_evidence():
    evidence = {
        "schema_version": 1,
        "semantics": "authored_identity_attestation",
        "status": "PASS",
        "authored_attested_npc_ids": ["npc-real"],
        "legacy_unverifiable_npc_ids": [],
        "unverified_npc_ids": [],
    }
    play = {
        "engaged_npc_ids": ["npc-forged"],
        "npc_engagement_evidence": evidence,
        "npc_engagement_coverage_contract": {
            "schema_version": 3,
            "semantics": "authored_identity_attestation",
            "producer": "coc_live_match",
            "projection_schema_version": 1,
            "legacy_raw_ids_included": False,
            "legacy_status": "PASS",
            "evidence_digest": coc_npc_identity.engagement_evidence_digest(evidence),
        },
    }
    result = coc_adherence.evaluate_adherence(
        [{
            "statement_id": "npc:npc-real",
            "kind": "optional",
            "criterion": {"npc_id": "npc-real"},
            "description": "Bound evidence only",
        }],
        play,
    )
    assert result["statements"][0]["satisfied"] is False
    assert result["npc_engagement_evidence"]["unverified_npc_ids"] == [
        "npc-forged", "npc-real"
    ]


def test_self_consistent_public_projection_is_display_only_and_non_comparable():
    npc_id = "npc-self-consistent-forgery"
    evidence = {
        "schema_version": 1,
        "semantics": "authored_identity_attestation",
        "status": "PASS",
        "authored_attested_npc_ids": [npc_id],
        "legacy_unverifiable_npc_ids": [],
        "unverified_npc_ids": [],
    }
    result = coc_adherence.evaluate_adherence(
        [{
            "statement_id": f"npc:{npc_id}",
            "kind": "optional",
            "criterion": {"npc_id": npc_id},
            "description": "Caller projection cannot attest itself",
        }],
        {
            "engaged_npc_ids": [npc_id],
            "npc_engagement_evidence": evidence,
            "npc_engagement_coverage_contract": {
                "schema_version": 4,
                "semantics": "authored_identity_attestation",
                "producer": "coc_live_match",
                "projection_schema_version": 1,
                "usage": "display_only",
                "coverage_eligible": False,
                "legacy_raw_ids_included": False,
                "legacy_status": "PASS",
                "evidence_digest": coc_npc_identity.engagement_evidence_digest(
                    evidence
                ),
            },
        },
    )
    assert result["statements"][0]["satisfied"] is False
    assert result["npc_engagement_evidence"]["status"] == "NON_COMPARABLE"
    assert result["npc_engagement_evidence"]["authored_attested_npc_ids"] == []
    assert result["npc_engagement_evidence"]["unverified_npc_ids"] == [npc_id]


@pytest.mark.parametrize("schema", [None, 999, "2", True])
def test_missing_unsupported_or_ill_typed_engagement_schema_never_attests(schema):
    event = _attested_npc_event("npc-schema-check")
    if schema is None:
        event.pop("schema_version")
    else:
        event["schema_version"] = schema

    evidence = coc_adherence.project_npc_engagement_evidence([event])

    assert evidence["authored_attested_npc_ids"] == []
    assert "npc-schema-check" in {
        *evidence["legacy_unverifiable_npc_ids"],
        *evidence["unverified_npc_ids"],
    }
    if schema is None:
        assert evidence["status"] == "NON_COMPARABLE"


@pytest.mark.parametrize("scene", [None, 7, True, ""])
def test_current_engagement_schema_requires_nonempty_string_scene_binding(scene):
    event = _attested_npc_event("npc-scene-type")
    event["scene_id"] = scene

    evidence = coc_adherence.project_npc_engagement_evidence([event])

    assert evidence["authored_attested_npc_ids"] == []
    assert evidence["unverified_npc_ids"] == ["npc-scene-type"]


def test_trusted_current_schema_event_chain_is_the_only_projection_to_coverage_path():
    event = _attested_npc_event("npc-trusted-chain")
    checklist = [{
        "statement_id": "npc:npc-trusted-chain",
        "kind": "optional",
        "criterion": {"npc_id": "npc-trusted-chain"},
        "description": "Trusted canonical event",
    }]

    standalone = coc_adherence.evaluate_adherence(
        checklist, {"events": [event]}
    )
    trusted = coc_adherence.evaluate_adherence(
        checklist,
        {"events": [event]},
        trusted_npc_engagement_events=[event],
    )

    assert standalone["statements"][0]["satisfied"] is False
    assert standalone["npc_engagement_evidence"]["status"] == "NON_COMPARABLE"
    assert trusted["statements"][0]["satisfied"] is True
