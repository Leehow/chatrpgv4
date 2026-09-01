"""Bounded MCP wire projection for an oversized npc.query cast list.

`npc.query` without an `npc_id` returns one complete dossier per authored NPC,
so the result grows with the cast.  Live evidence
(`pi-coc-gate9-depth-20260901-03`, turn-p-5fbc883d6aff) recorded a 9-NPC roster
at 29,604 bytes against `max_inline_bytes` 16,384: the whole result collapsed to
an identity-only envelope and the Keeper was handed
`semantic_identity_unavailable` instead of the cast.
"""
from __future__ import annotations

from copy import deepcopy
from pathlib import Path
import sys


SCRIPTS = Path(__file__).resolve().parents[1] / "plugins" / "coc-keeper" / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import coc_mcp_wire
import coc_npc_identity


CONTRACT_DIGEST = "sha256:npc-query-wire-test"

# Field-for-field the live `the-haunting` roster shape, at its measured scale:
# ~110 bytes of agenda, ~80 of voice/fear, ~150 of secret and keeper_note each,
# three facts, and one authored source ref per NPC.
PROSE = "他把钥匙推近了一点，语气务实得像在核对一份报价单，不肯多谈房子的过去。"


def _authored_npc(index: int) -> dict:
    return {
        "npc_id": f"npc-{index:02d}-authored",
        "name": f"Authored Person {index:02d}",
        "origin": "source",
        "agenda": f"{PROSE} ({index})",
        "voice": f"{PROSE[:40]} ({index})",
        "fear": f"{PROSE[:40]} ({index})",
        "relationship_to_investigators": "employer" if index % 2 else "witness",
        "social_role": {
            "authority_scope": ["scene_safety"],
            "responsibility_domains": ["group_survival"],
            "chain_of_command": {"to_pc": "none", "to_group": "none"},
            "duty_pressure": [],
            "initiative_style": "decisive",
            "delegation_policy": {
                "keeps": ["scene_safety"],
                "delegates": ["specialist_care", "specialist_interpretation"],
            },
        },
        "role_label": None,
        "schedule": [{
            "schedule_id": f"sched-{index:02d}",
            "scene_ids": [f"scene-{index:02d}"],
            "status": "available",
        }],
        "source_refs": [{
            "path": "Call of Cthulhu 7e Keeper Rulebook",
            "page": 400 + index,
            "grep_anchor": f"Authored Person {index:02d}",
        }],
    }


def _record(index: int, *, active_scene_id: str) -> dict:
    npc = _authored_npc(index)
    contract = coc_npc_identity.identity_contract(npc, active_scene_id)
    record = {
        "npc_id": npc["npc_id"],
        "name": npc["name"],
        "identity_ref": contract["identity_ref"],
        "profile_revision_ref": contract["profile_revision_ref"],
        "identity_contract": contract,
        "origin": npc["origin"],
        "voice": npc["voice"],
        "agenda": npc["agenda"],
        "fear": npc["fear"],
        "relationship_to_investigators": npc["relationship_to_investigators"],
        "social_role": npc["social_role"],
        "role_label": npc["role_label"],
        "secret": {"value": f"{PROSE} secret {index}", "secret": True},
        "keeper_note": {"value": f"{PROSE} note {index}", "secret": True},
        "facts": [
            {
                "fact_id": f"fact-{index:02d}-{n}",
                "clue_id": f"clue-{index:02d}-{n}",
                "min_trust": 0,
                **(
                    {"lie_option": {
                        "lie_id": f"lie-{index:02d}",
                        "player_safe_line": PROSE[:30],
                    }}
                    if n == 1 else {}
                ),
            }
            for n in range(3)
        ],
        "known_fact_ids": [f"fact-{index:02d}-{n}" for n in range(3)],
        "revealable_fact_ids": [f"fact-{index:02d}-{n}" for n in range(3)],
        # An authored lie, on the row and nested under its fact, exactly as
        # `npc-dooley` carries it live. Only `deflect_id` was a declared
        # npc.query identity, so this shape used to fail the whole result
        # closed in the Pi projection the moment it stopped collapsing.
        "lie_options": [{
            "lie_id": f"lie-{index:02d}",
            "fact_id": f"fact-{index:02d}-1",
        }],
        "deflect_options": [{
            "deflect_id": f"deflect-{index:02d}",
            "fact_id": f"fact-{index:02d}-0",
            "player_safe_line": PROSE[:30],
        }],
        "schedule": npc["schedule"],
        "psych": {
            "trust": 0,
            "fear": 0,
            "suspicion": 0,
            "known_facts": [],
            "lies_told": [],
            "promises": [],
            "availability": {"status": "available"},
            "impression": None,
        },
    }
    record["identity_contract"] = coc_npc_identity.record_scoped_contract(
        contract, record
    )
    return record


def _envelope(count: int, *, active_scene_id: str = "scene-elsewhere") -> dict:
    rows = [_record(i, active_scene_id=active_scene_id) for i in range(count)]
    return {
        "ok": True,
        "tool": "npc.query",
        "data": {
            "npcs": rows,
            "identity_contract_projection": (
                coc_npc_identity.record_carried_contract_projection()
            ),
            "working_set": {"mode": "full", "revision": "ws-v1-test"},
        },
        "warnings": [],
        "hints": ["fields marked secret:true are your reference only"],
    }


def _project(envelope: dict) -> dict:
    return coc_mcp_wire.project_envelope(
        "npc.query",
        envelope,
        contract_digest=CONTRACT_DIGEST,
    )


def test_oversize_cast_keeps_every_npc_instead_of_collapsing():
    envelope = _envelope(9)
    assert (
        coc_mcp_wire.transport_bytes(envelope) > coc_mcp_wire.MAX_INLINE_BYTES
    ), "fixture must reproduce the oversize the identity collapse used to hit"

    result = _project(envelope)

    assert result["wire"]["measured_inline_bytes"] <= coc_mcp_wire.MAX_INLINE_BYTES
    assert result["wire"].get("identity_only") is not True
    assert result["wire"]["npc_roster_projection"] is True
    assert [row["npc_id"] for row in result["data"]["npcs"]] == [
        row["npc_id"] for row in envelope["data"]["npcs"]
    ], "the cast list must stay complete and in producer order"


def test_demoted_rows_keep_what_the_host_and_keeper_bind_on():
    result = _project(_envelope(9))
    rows = result["data"]["npcs"]
    demoted = [row for row in rows if row.get("dossier_required")]
    assert demoted, "an oversize cast must demote at least one dossier"
    assert len(demoted) < len(rows), "the budget must still buy some full dossiers"

    for row in demoted:
        # The Pi host arms npc engagement and social-psychology evidence from
        # exactly these; the Keeper forms npc_fact:<npc_id>/<fact_id> by hand.
        assert isinstance(row["npc_id"], str) and row["npc_id"]
        assert row["identity_ref"]
        assert [fact["fact_id"] for fact in row["facts"]]
        assert isinstance(row["psych"], dict)
        assert isinstance(row["identity_contract"], dict)


def test_demoted_rows_carry_one_exact_route_back_to_the_full_dossier():
    result = _project(_envelope(9))
    card = result["data"]["dossier_operation"]

    assert card["operation"] == "npc.query"
    assert card["model_invocable"] is True
    assert card["missing_arguments"] == ["npc_id"]
    assert card["contract_ref"].startswith("npc.query@")
    # One block-level card, not one per row: nine identical cards cost more
    # than the dossiers they replace.
    assert all(
        "dossier_operation" not in row for row in result["data"]["npcs"]
    )
    assert any(
        "dossier_operation" in hint and "dossier_required" in hint
        for hint in result["hints"]
    )


def test_scene_present_and_engaged_npcs_keep_their_dossier_first():
    envelope = _envelope(9, active_scene_id="scene-07")
    engaged = envelope["data"]["npcs"][8]
    engaged["psych"]["trust"] = 2

    result = _project(envelope)
    detailed = {
        row["npc_id"] for row in result["data"]["npcs"]
        if not row.get("dossier_required")
    }

    # npc-07 is the only NPC authored into the active scene, and npc-08 is the
    # only one with relationship state. Both outrank producer order.
    assert "npc-07-authored" in detailed
    assert "npc-08-authored" in detailed


def test_a_cast_too_large_for_any_dossier_still_lists_everyone():
    envelope = _envelope(60)
    result = _project(envelope)

    assert result["wire"]["measured_inline_bytes"] <= coc_mcp_wire.MAX_INLINE_BYTES
    assert result["wire"].get("identity_only") is not True
    assert len(result["data"]["npcs"]) == 60
    for row in result["data"]["npcs"]:
        assert row["npc_id"]
        assert row["dossier_required"] is True


def test_a_cast_too_large_for_even_an_index_falls_through_to_identity_only():
    """The roster must not claim a projection it could not actually deliver."""
    envelope = _envelope(400)
    result = _project(envelope)

    assert result["wire"]["measured_inline_bytes"] <= coc_mcp_wire.MAX_INLINE_BYTES
    assert result["wire"]["identity_only"] is True
    assert "npc_roster_projection" not in result["wire"]
    assert result["data"]["replay_operation"]["operation"] == "npc.query"


def test_the_roster_fit_does_not_depend_on_the_producer_deduplication():
    """A cast that still carries the duplicated contract must fit on its own.

    The working-set cache is revision-keyed on canonical inputs, not on code
    version, so a campaign can replay a payload built before the producer
    stopped restating each authored identity twice. The transport layer has to
    hold that shape without the producer's help.
    """
    envelope = _envelope(9)
    for row in envelope["data"]["npcs"]:
        row["identity_contract"] = coc_npc_identity.identity_contract(
            _authored_npc(int(row["npc_id"].split("-")[1])),
            "scene-elsewhere",
        )
    envelope["data"].pop("identity_contract_projection")
    assert (
        coc_mcp_wire.transport_bytes(envelope) > coc_mcp_wire.MAX_INLINE_BYTES
    )

    result = _project(envelope)

    assert result["wire"]["measured_inline_bytes"] <= coc_mcp_wire.MAX_INLINE_BYTES
    assert result["wire"].get("identity_only") is not True
    assert len(result["data"]["npcs"]) == 9


def test_a_fitting_single_target_query_is_left_exactly_alone():
    envelope = _envelope(1)
    assert coc_mcp_wire.transport_bytes(envelope) < coc_mcp_wire.MAX_INLINE_BYTES

    result = _project(envelope)

    assert result["wire"]["payload_projected"] is False
    assert "npc_roster_projection" not in result["wire"]
    assert result["data"] == envelope["data"]


def test_the_projection_never_mutates_the_canonical_envelope():
    envelope = _envelope(9)
    before = deepcopy(envelope)
    _project(envelope)
    assert envelope == before
