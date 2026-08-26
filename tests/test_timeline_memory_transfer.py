"""Cross-timeline memory transfer: deterministic plan/validation core."""
from __future__ import annotations

import copy
import importlib.util
import json
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
SCRIPTS = REPO / "plugins" / "coc-keeper" / "scripts"


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


xferto = load_module(
    "coc_timeline_memory_transfer_under_test",
    SCRIPTS / "coc_timeline_memory_transfer.py",
)
# Use the exact contract module object the transfer module imported, so
# raised error classes compare equal regardless of import path.
contract = xferto.contract

SHA = "a" * 40
SHA2 = "b" * 40
CAMPAIGN = "amaranthine-16"
TL_A = "tl-main"
TL_B = "tl-fork-b"
TL_C = "tl-fork-c"

WORLD_SUBJECT = f"subject-world-{CAMPAIGN}"
INV_SUBJECT = "subject-investigator-elise"
PARTY_SUBJECT = f"subject-party-{CAMPAIGN}"
PLAYER_SUBJECT = "subject-player-thomas"
NPC_SUBJECT = f"subject-npc-{CAMPAIGN}-corbitt"


def assertion(assertion_id: str, **overrides):
    record = {
        "assertion_id": assertion_id,
        "kind": "knowledge",
        "scope": "campaign",
        "campaign_id": CAMPAIGN,
        "timeline_id": TL_B,
        "subject_id": INV_SUBJECT,
        "knowers": [INV_SUBJECT],
        "privacy": "player_safe",
        "state": "accurate",
        "statement": "Elise saw the cultist sign on the chapel door.",
        "entities": ["entity-location-chapel"],
        "occurred_turn": 2,
        "valid_from_turn": 2,
        "valid_until_turn": None,
        "superseded_by": [],
        "contradicts": [],
        "confirms": [],
        "covers_commits": [],
        "transfer_ref": None,
        "source_commit": SHA,
        "source_turn": 2,
        "source_receipts": ["turn-effect-v1:abc"],
    }
    record.update(overrides)
    return record


SRC_KNOWLEDGE = assertion(f"mem-{CAMPAIGN}-chapel-sign")
SRC_KNOWLEDGE_2 = assertion(
    f"mem-{CAMPAIGN}-corbitt-name",
    knowers=[INV_SUBJECT, PARTY_SUBJECT],
    statement="The house's former owner was called Walter Corbitt.",
    occurred_turn=3,
    valid_from_turn=3,
    source_turn=3,
)
SRC_KEEPER_ONLY = assertion(
    f"mem-{CAMPAIGN}-hidden-ritual",
    privacy="keeper_only",
    knowers=[INV_SUBJECT],
    statement="The ritual page names the Corbitt cellar.",
    source_turn=4,
    valid_from_turn=4,
    occurred_turn=4,
)
SRC_PLAYER_META = assertion(
    f"mem-{CAMPAIGN}-player-theory",
    kind="player_assertion",
    subject_id=PLAYER_SUBJECT,
    knowers=[PLAYER_SUBJECT],
    statement="Thomas suspects the priest is the cultist.",
)
SRC_PLAYER_PREF = assertion(
    f"mem-{CAMPAIGN}-player-pref-slug",
    kind="player_preference",
    subject_id=PLAYER_SUBJECT,
    knowers=[PLAYER_SUBJECT],
    statement="Thomas prefers slow-burn horror.",
)
SRC_WORLD = assertion(
    f"mem-{CAMPAIGN}-storm-night",
    kind="world_event",
    subject_id=WORLD_SUBJECT,
    knowers=[],
    statement="A storm broke over Arkham on the third night.",
    entities=[],
)
SRC_FORGOTTEN = assertion(
    f"mem-{CAMPAIGN}-lost-hours",
    state="forgotten",
    statement="Elise lost three hours in the cellar.",
)


def build(
    entries,
    sources=None,
    cause="dream-bleed-after-fork",
    play_cost=None,
    receipt="transfer-receipt-1",
    from_timeline=TL_B,
    to_timeline=TL_A,
    **kwargs,
):
    sources = [
        SRC_KNOWLEDGE,
        SRC_KNOWLEDGE_2,
        SRC_KEEPER_ONLY,
        SRC_PLAYER_META,
        SRC_PLAYER_PREF,
        SRC_WORLD,
        SRC_FORGOTTEN,
    ] if sources is None else sources
    return xferto.build_transfer_event(
        CAMPAIGN,
        from_timeline,
        to_timeline,
        sources,
        entries,
        cause,
        play_cost,
        receipt,
        **kwargs,
    )


# ---------------------------------------------------------------------------
# build_transfer_event: authoritative payload
# ---------------------------------------------------------------------------


class TestBuildTransferEvent:
    def test_valid_transfer_builds_contract_record(self):
        plan = build(
            [
                {"source_assertion": SRC_KNOWLEDGE["assertion_id"]},
                {
                    "source_assertion": SRC_KEEPER_ONLY["assertion_id"],
                    "credibility": 0.8,
                },
            ]
        )
        contract.validate_transfer(plan["transfer"])
        assert plan["transfer"]["transfer_id"] == (
            f"transfer-{CAMPAIGN}-{TL_B}-to-{TL_A}"
        )
        assert plan["transfer"]["receipt"] == "transfer-receipt-1"
        assert plan["cause"] == "dream-bleed-after-fork"
        assert plan["cost_requests"] == []

    def test_anchor_derived_from_newest_transferred_source(self):
        plan = build([{"source_assertion": SRC_KNOWLEDGE_2["assertion_id"]}])
        # SRC_KNOWLEDGE_2 has the newest source_turn among transferred (3),
        # so the anchor is its commit and turn.
        assert plan["transfer"]["source_commit"] == SHA
        assert plan["transfer"]["source_turn"] == 3

    def test_explicit_anchor_overrides_derivation(self):
        plan = build(
            [{"source_assertion": SRC_KNOWLEDGE["assertion_id"]}],
            source_commit=SHA2,
            source_turn=9,
        )
        assert plan["transfer"]["source_commit"] == SHA2
        assert plan["transfer"]["source_turn"] == 9

    def test_anchor_before_memory_formation_rejected(self):
        with pytest.raises(contract.TransferError, match="precedes the formation"):
            build(
                [{"source_assertion": SRC_KNOWLEDGE_2["assertion_id"]}],
                source_turn=1,
            )

    def test_from_equals_to_rejected(self):
        with pytest.raises(contract.TransferError, match="distinct timelines"):
            build(
                [{"source_assertion": SRC_KNOWLEDGE["assertion_id"]}],
                from_timeline=TL_B,
                to_timeline=TL_B,
            )

    def test_bad_timeline_ids_rejected(self):
        with pytest.raises(contract.TransferError, match="semantic timeline id"):
            build(
                [{"source_assertion": SRC_KNOWLEDGE["assertion_id"]}],
                from_timeline="timeline-b",
            )
        with pytest.raises(contract.TransferError, match="semantic timeline id"):
            build(
                [{"source_assertion": SRC_KNOWLEDGE["assertion_id"]}],
                to_timeline="tl/invalid",
            )

    def test_empty_entries_rejected(self):
        with pytest.raises(contract.TransferError, match="at least one entry"):
            build([])

    def test_unknown_entry_field_rejected(self):
        with pytest.raises(contract.UnknownFieldError):
            build(
                [
                    {
                        "source_assertion": SRC_KNOWLEDGE["assertion_id"],
                        "rewrite": True,
                    }
                ]
            )

    def test_missing_entry_source_rejected(self):
        with pytest.raises(contract.MissingFieldError):
            build([{"credibility": 0.9}])

    def test_unknown_source_rejected(self):
        with pytest.raises(contract.TransferError, match="not in source_assertions"):
            build([{"source_assertion": f"mem-{CAMPAIGN}-no-such-memory"}])

    def test_duplicate_source_entries_rejected(self):
        sid = SRC_KNOWLEDGE["assertion_id"]
        with pytest.raises(contract.TransferError, match="multiple entries"):
            build([{"source_assertion": sid}, {"source_assertion": sid}])

    def test_source_on_wrong_timeline_rejected(self):
        wrong_line = assertion(
            f"mem-{CAMPAIGN}-main-line-memory", timeline_id=TL_A
        )
        with pytest.raises(contract.TransferError, match="not from_timeline"):
            build(
                [{"source_assertion": wrong_line["assertion_id"]}],
                sources=[wrong_line],
            )

    def test_source_of_other_campaign_rejected(self):
        foreign = assertion(
            "mem-other-camp-chapel-sign",
            campaign_id="other-camp",
        )
        with pytest.raises(contract.TransferError, match="campaign-scoped"):
            build([{"source_assertion": foreign["assertion_id"]}], sources=[foreign])

    def test_cross_campaign_scope_source_rejected(self):
        cross = assertion(
            "mem-xc-player-habit",
            scope="cross_campaign",
            campaign_id=None,
            timeline_id=None,
        )
        with pytest.raises(contract.TransferError, match="campaign-scoped"):
            build([{"source_assertion": cross["assertion_id"]}], sources=[cross])

    def test_cause_required(self):
        with pytest.raises(contract.TransferError, match="cause"):
            build(
                [{"source_assertion": SRC_KNOWLEDGE["assertion_id"]}], cause="  "
            )
        with pytest.raises(contract.TransferError, match="cause"):
            build(
                [{"source_assertion": SRC_KNOWLEDGE["assertion_id"]}], cause=None
            )

    def test_receipt_required(self):
        with pytest.raises(contract.TransferError, match="receipt"):
            build(
                [{"source_assertion": SRC_KNOWLEDGE["assertion_id"]}],
                receipt="",
            )

    def test_duplicate_input_source_records_rejected(self):
        dup = [SRC_KNOWLEDGE, dict(SRC_KNOWLEDGE)]
        with pytest.raises(contract.TransferError, match="duplicate source"):
            build(
                [{"source_assertion": SRC_KNOWLEDGE["assertion_id"]}],
                sources=dup,
            )

    def test_idempotent_build_same_digest(self):
        entries = [
            {"source_assertion": SRC_KNOWLEDGE["assertion_id"]},
            {
                "source_assertion": SRC_KEEPER_ONLY["assertion_id"],
                "credibility": 0,
                "state": "uncertain",
            },
        ]
        plan_a = build(entries, play_cost=[{"kind": "san_loss", "amount": "1d4"}])
        plan_b = build(entries, play_cost=[{"kind": "san_loss", "amount": "1d4"}])
        assert contract.record_digest(plan_a["transfer"]) == contract.record_digest(
            plan_b["transfer"]
        )
        assert plan_a["cost_requests"] == plan_b["cost_requests"]

    def test_opposite_direction_has_distinct_semantic_id(self):
        forward = build(
            [{"source_assertion": SRC_KNOWLEDGE["assertion_id"]}],
            from_timeline=TL_B,
            to_timeline=TL_A,
        )
        backward = build(
            [{"source_assertion": SRC_KNOWLEDGE["assertion_id"]}],
            from_timeline=TL_A,
            to_timeline=TL_B,
            # source fixture lives on TL_B; retarget to TL_A for this check
            sources=[
                assertion(f"mem-{CAMPAIGN}-chapel-sign", timeline_id=TL_A)
            ],
        )
        assert (
            forward["transfer"]["transfer_id"]
            != backward["transfer"]["transfer_id"]
        )
        assert backward["transfer"]["transfer_id"] == (
            f"transfer-{CAMPAIGN}-{TL_A}-to-{TL_B}"
        )


# ---------------------------------------------------------------------------
# Player meta-knowledge boundary
# ---------------------------------------------------------------------------


class TestPlayerMetaKnowledgeBoundary:
    @pytest.mark.parametrize(
        "source", [SRC_PLAYER_META, SRC_PLAYER_PREF], ids=["assertion", "preference"]
    )
    def test_player_meta_never_transfers(self, source):
        with pytest.raises(contract.TransferError, match="meta-knowledge"):
            build([{"source_assertion": source["assertion_id"]}])

    def test_player_meta_rejected_at_derive_too(self):
        event = {
            "transfer_id": f"transfer-{CAMPAIGN}-{TL_B}-to-{TL_A}",
            "campaign_id": CAMPAIGN,
            "from_timeline": TL_B,
            "to_timeline": TL_A,
            "receipt": "transfer-receipt-1",
            "source_commit": SHA,
            "source_turn": 8,
            "entries": [
                {
                    "source_assertion": SRC_PLAYER_META["assertion_id"],
                    "target_assertion": f"mem-{CAMPAIGN}-echo-{TL_B}-player-theory",
                    "state": "cross_timeline_echo",
                    "credibility": 1.0,
                    "distortion": None,
                    "privacy": "player_safe",
                }
            ],
            "play_cost": None,
        }
        contract.validate_transfer(event)  # contract-shape is fine
        with pytest.raises(contract.TransferError, match="meta-knowledge"):
            xferto.derive_target_assertions(event, [SRC_PLAYER_META])

    def test_world_event_and_keeper_memory_may_transfer(self):
        plan = build(
            [
                {"source_assertion": SRC_WORLD["assertion_id"]},
                {"source_assertion": SRC_KNOWLEDGE["assertion_id"]},
            ]
        )
        contract.validate_transfer(plan["transfer"])

    def test_forgotten_source_has_nothing_to_echo(self):
        with pytest.raises(contract.TransferError, match="no content left"):
            build([{"source_assertion": SRC_FORGOTTEN["assertion_id"]}])


# ---------------------------------------------------------------------------
# Fidelity / confidence bounds
# ---------------------------------------------------------------------------


class TestFidelityBounds:
    SID = SRC_KNOWLEDGE["assertion_id"]

    @pytest.mark.parametrize("credibility", [0.5, 0.75, 1.0, 1])
    def test_faithful_echo_requires_high_credibility(self, credibility):
        plan = build(
            [{"source_assertion": self.SID, "credibility": credibility}]
        )
        entry = plan["transfer"]["entries"][0]
        assert entry["state"] == "cross_timeline_echo"
        assert entry["credibility"] == float(credibility)

    @pytest.mark.parametrize("credibility", [0.0, 0.49])
    def test_faithful_echo_rejects_low_credibility(self, credibility):
        with pytest.raises(contract.TransferError, match="faithful echo requires"):
            build([{"source_assertion": self.SID, "credibility": credibility}])

    def test_faithful_echo_rejects_distortion(self):
        with pytest.raises(contract.TransferError, match="carries no distortion"):
            build(
                [
                    {
                        "source_assertion": self.SID,
                        "distortion": "remembers the sign as red",
                    }
                ]
            )

    @pytest.mark.parametrize("credibility", [0.0, 0.25, 0.49])
    def test_uncertain_echo_bounds(self, credibility):
        plan = build(
            [
                {
                    "source_assertion": self.SID,
                    "state": "uncertain",
                    "credibility": credibility,
                }
            ]
        )
        assert plan["transfer"]["entries"][0]["state"] == "uncertain"

    @pytest.mark.parametrize("credibility", [0.5, 0.9, 1.0])
    def test_uncertain_echo_rejects_high_credibility(self, credibility):
        with pytest.raises(contract.TransferError, match="uncertain echo requires"):
            build(
                [
                    {
                        "source_assertion": self.SID,
                        "state": "uncertain",
                        "credibility": credibility,
                    }
                ]
            )

    @pytest.mark.parametrize("state", ["distorted", "dreamlike"])
    def test_distorted_states_require_distortion(self, state):
        with pytest.raises(contract.TransferError, match="describe its distortion"):
            build(
                [{"source_assertion": self.SID, "state": state, "credibility": 0.7}]
            )

    @pytest.mark.parametrize("state", ["distorted", "dreamlike"])
    def test_distorted_states_with_note_accepted(self, state):
        plan = build(
            [
                {
                    "source_assertion": self.SID,
                    "state": state,
                    "credibility": 0.7,
                    "distortion": "the sign is remembered as a spiral, not an eye",
                }
            ]
        )
        entry = plan["transfer"]["entries"][0]
        assert entry["state"] == state
        assert entry["distortion"].startswith("the sign is remembered")

    def test_non_echo_state_rejected(self):
        with pytest.raises(contract.ClosedEnumError):
            build(
                [{"source_assertion": self.SID, "state": "accurate"}]
            )

    @pytest.mark.parametrize("credibility", [-0.1, 1.5, True, "high"])
    def test_credibility_range_enforced(self, credibility):
        with pytest.raises(contract.TransferError, match="credibility"):
            build([{"source_assertion": self.SID, "credibility": credibility}])

    def test_blank_distortion_rejected(self):
        with pytest.raises(contract.TransferError, match="distortion"):
            build(
                [
                    {
                        "source_assertion": self.SID,
                        "state": "distorted",
                        "credibility": 0.2,
                        "distortion": "   ",
                    }
                ]
            )


# ---------------------------------------------------------------------------
# Privacy never broadens
# ---------------------------------------------------------------------------


class TestPrivacyNonBroadening:
    KID = SRC_KEEPER_ONLY["assertion_id"]

    def test_keeper_only_source_may_stay_keeper_only(self):
        plan = build([{"source_assertion": self.KID, "credibility": 0.9}])
        assert plan["transfer"]["entries"][0]["privacy"] == "keeper_only"

    def test_keeper_only_source_cannot_become_player_safe(self):
        with pytest.raises(contract.PrivacyError, match="never broadens"):
            build(
                [
                    {
                        "source_assertion": self.KID,
                        "credibility": 0.9,
                        "privacy": "player_safe",
                    }
                ]
            )

    def test_player_safe_source_may_tighten_to_keeper_only(self):
        plan = build(
            [
                {
                    "source_assertion": SRC_KNOWLEDGE["assertion_id"],
                    "privacy": "keeper_only",
                }
            ]
        )
        assert plan["transfer"]["entries"][0]["privacy"] == "keeper_only"

    def test_derived_target_carries_entry_privacy(self):
        plan = build(
            [
                {
                    "source_assertion": SRC_KNOWLEDGE["assertion_id"],
                    "privacy": "keeper_only",
                }
            ]
        )
        targets = xferto.derive_target_assertions(
            plan, [SRC_KNOWLEDGE]
        )
        assert targets[0]["privacy"] == "keeper_only"

    def test_bad_privacy_enum_rejected(self):
        with pytest.raises(contract.ClosedEnumError):
            build(
                [
                    {
                        "source_assertion": SRC_KNOWLEDGE["assertion_id"],
                        "privacy": "public",
                    }
                ]
            )


# ---------------------------------------------------------------------------
# derive_target_assertions
# ---------------------------------------------------------------------------


class TestDeriveTargetAssertions:
    def test_derives_new_contract_valid_echoes(self):
        plan = build(
            [
                {"source_assertion": SRC_KNOWLEDGE["assertion_id"]},
                {
                    "source_assertion": SRC_KNOWLEDGE_2["assertion_id"],
                    "state": "uncertain",
                    "credibility": 0.3,
                },
            ]
        )
        targets = xferto.derive_target_assertions(
            plan,
            [SRC_KNOWLEDGE, SRC_KNOWLEDGE_2, SRC_WORLD],
        )
        assert len(targets) == 2
        for target in targets:
            contract.validate_assertion(target)
            assert target["state"] == "cross_timeline_echo"
            assert target["timeline_id"] == TL_A
            assert target["transfer_ref"] == plan["transfer"]["transfer_id"]

    def test_deterministic_new_ids_embed_both_timelines(self):
        plan = build([{"source_assertion": SRC_KNOWLEDGE["assertion_id"]}])
        targets = xferto.derive_target_assertions(plan, [SRC_KNOWLEDGE])
        assert targets[0]["assertion_id"] == (
            f"mem-{CAMPAIGN}-echo-{TL_B}-to-{TL_A}-chapel-sign"
        )
        assert targets[0]["assertion_id"] != SRC_KNOWLEDGE["assertion_id"]

    def test_degraded_echo_state_lives_on_entry_not_target(self):
        plan = build(
            [
                {
                    "source_assertion": SRC_KNOWLEDGE["assertion_id"],
                    "state": "distorted",
                    "credibility": 0.4,
                    "distortion": "the sign is remembered as a spiral",
                }
            ]
        )
        targets = xferto.derive_target_assertions(plan, [SRC_KNOWLEDGE])
        # Spec: the derived assertion's memory state is cross_timeline_echo;
        # fidelity (state/credibility/distortion) stays on the entry.
        assert targets[0]["state"] == "cross_timeline_echo"
        assert plan["transfer"]["entries"][0]["state"] == "distorted"
        assert plan["transfer"]["entries"][0]["distortion"].startswith("the sign")

    def test_provenance_and_knowers_preserved(self):
        plan = build([{"source_assertion": SRC_KNOWLEDGE_2["assertion_id"]}])
        targets = xferto.derive_target_assertions(plan, [SRC_KNOWLEDGE_2])
        target = targets[0]
        assert target["source_commit"] == SRC_KNOWLEDGE_2["source_commit"]
        assert target["source_turn"] == SRC_KNOWLEDGE_2["source_turn"]
        assert target["source_receipts"] == SRC_KNOWLEDGE_2["source_receipts"]
        assert target["knowers"] == [INV_SUBJECT, PARTY_SUBJECT]
        assert target["entities"] == ["entity-location-chapel"]
        assert target["statement"] == SRC_KNOWLEDGE_2["statement"]
        assert target["subject_id"] == INV_SUBJECT
        assert target["kind"] == "knowledge"
        assert target["occurred_turn"] == 3
        assert target["valid_from_turn"] == plan["transfer"]["source_turn"]

    def test_cross_line_graph_links_reset(self):
        closed = assertion(
            f"mem-{CAMPAIGN}-superseded-memory",
            valid_until_turn=5,
            superseded_by=[f"mem-{CAMPAIGN}-replacement"],
            contradicts=[f"mem-{CAMPAIGN}-contradicted"],
            confirms=[f"mem-{CAMPAIGN}-confirmed"],
        )
        plan = build(
            [{"source_assertion": closed["assertion_id"]}], sources=[closed]
        )
        targets = xferto.derive_target_assertions(plan, [closed])
        target = targets[0]
        assert target["superseded_by"] == []
        assert target["contradicts"] == []
        assert target["confirms"] == []
        assert target["valid_until_turn"] is None

    def test_summary_covers_commits_preserved(self):
        summary = assertion(
            f"mem-{CAMPAIGN}-session-1-summary",
            kind="summary",
            subject_id=WORLD_SUBJECT,
            knowers=[],
            entities=[],
            covers_commits=[SHA, SHA2],
        )
        plan = build(
            [{"source_assertion": summary["assertion_id"]}], sources=[summary]
        )
        targets = xferto.derive_target_assertions(plan, [summary])
        assert targets[0]["covers_commits"] == [SHA, SHA2]

    def test_accepts_bare_event_record(self):
        plan = build([{"source_assertion": SRC_KNOWLEDGE["assertion_id"]}])
        bare = plan["transfer"]
        from_bare = xferto.derive_target_assertions(bare, [SRC_KNOWLEDGE])
        from_plan = xferto.derive_target_assertions(plan, [SRC_KNOWLEDGE])
        assert from_bare == from_plan

    def test_derive_is_idempotent(self):
        plan = build(
            [
                {"source_assertion": SRC_KNOWLEDGE["assertion_id"]},
                {
                    "source_assertion": SRC_KNOWLEDGE_2["assertion_id"],
                    "state": "dreamlike",
                    "credibility": 0.2,
                    "distortion": "fragments only: a door, a voice",
                },
            ]
        )
        first = xferto.derive_target_assertions(
            plan, [SRC_KNOWLEDGE, SRC_KNOWLEDGE_2]
        )
        second = xferto.derive_target_assertions(
            plan, [SRC_KNOWLEDGE, SRC_KNOWLEDGE_2]
        )
        assert [contract.record_digest(t) for t in first] == [
            contract.record_digest(t) for t in second
        ]

    def test_missing_source_in_derive_rejected(self):
        plan = build([{"source_assertion": SRC_KNOWLEDGE["assertion_id"]}])
        with pytest.raises(contract.TransferError, match="missing from"):
            xferto.derive_target_assertions(plan, [SRC_WORLD])

    def test_never_mutates_inputs(self):
        sources = [SRC_KNOWLEDGE, SRC_KNOWLEDGE_2]
        entries = [
            {"source_assertion": SRC_KNOWLEDGE["assertion_id"]},
            {
                "source_assertion": SRC_KNOWLEDGE_2["assertion_id"],
                "state": "uncertain",
                "credibility": 0.4,
            },
        ]
        sources_snap = copy.deepcopy(sources)
        entries_snap = copy.deepcopy(entries)
        plan = build(entries, sources=sources)
        targets = xferto.derive_target_assertions(plan, sources)
        assert sources == sources_snap
        assert entries == entries_snap
        # Source records stay untouched by derivation.
        assert SRC_KNOWLEDGE["timeline_id"] == TL_B
        assert SRC_KNOWLEDGE["transfer_ref"] is None
        assert SRC_KNOWLEDGE["state"] == "accurate"
        assert targets[0]["assertion_id"] != SRC_KNOWLEDGE["assertion_id"]

    def test_echo_of_echo_gets_nested_traceable_id(self):
        echo_on_a = xferto.derive_target_assertions(
            build([{"source_assertion": SRC_KNOWLEDGE["assertion_id"]}]),
            [SRC_KNOWLEDGE],
        )[0]
        # Transfer that echo back B->A... it already lives on A; send it A->B.
        plan_back = build(
            [{"source_assertion": echo_on_a["assertion_id"]}],
            sources=[echo_on_a],
            from_timeline=TL_A,
            to_timeline=TL_B,
        )
        targets = xferto.derive_target_assertions(plan_back, [echo_on_a])
        assert targets[0]["assertion_id"] == (
            f"mem-{CAMPAIGN}-echo-{TL_A}-to-{TL_B}-echo-{TL_B}-to-{TL_A}-chapel-sign"
        )
        assert targets[0]["state"] == "cross_timeline_echo"


# ---------------------------------------------------------------------------
# Typed play-cost requests
# ---------------------------------------------------------------------------


class TestCostRequests:
    def test_no_cost_by_default_still_carries_cause_envelope(self):
        plan = build([{"source_assertion": SRC_KNOWLEDGE["assertion_id"]}])
        assert plan["cost_requests"] == []
        # Cause is mandatory durable evidence: the envelope is always written,
        # even with zero costs.
        assert json.loads(plan["transfer"]["play_cost"]) == {
            "cause": "dream-bleed-after-fork",
            "costs": [],
        }
        assert xferto.cause_from_event(plan["transfer"]) == "dream-bleed-after-fork"

    def test_typed_request_shape(self):
        plan = build(
            [{"source_assertion": SRC_KNOWLEDGE["assertion_id"]}],
            play_cost=[
                {
                    "kind": "san_loss",
                    "amount": "1d4",
                    "subject_id": INV_SUBJECT,
                    "note": "dream bleed",
                },
                {"kind": "relationship_shift", "amount": 1},
            ],
        )
        san, rel = plan["cost_requests"]
        assert san["request_id"] == (
            f"cost-{CAMPAIGN}-{TL_B}-to-{TL_A}-1-san_loss"
        )
        assert san["operation"] == "rules.san_loss"
        assert san["timeline_id"] == TL_A
        assert san["transfer_id"] == plan["transfer"]["transfer_id"]
        assert san["cause"] == "dream-bleed-after-fork"
        assert san["applied"] is False
        assert san["decision_id"] is None
        assert san["amount"] == "1d4"
        assert san["subject_id"] == INV_SUBJECT
        assert rel["operation"] == "state.effect"
        assert set(rel) == set(xferto.COST_REQUEST_FIELDS)
        # The record durably carries the canonical cause+costs envelope, not
        # the typed requests themselves.
        assert plan["transfer"]["play_cost"] == contract.canonical_json(
            {
                "cause": "dream-bleed-after-fork",
                "costs": [
                    {
                        "kind": "san_loss",
                        "amount": "1d4",
                        "subject_id": INV_SUBJECT,
                        "note": "dream bleed",
                    },
                    {"kind": "relationship_shift", "amount": 1, "subject_id": None, "note": None},
                ],
            }
        )

    def test_all_kinds_map_to_canonical_operations(self):
        costs = [{"kind": kind} for kind in xferto.PLAY_COST_KINDS]
        plan = build(
            [{"source_assertion": SRC_KNOWLEDGE["assertion_id"]}],
            cause="c",
            play_cost=costs,
        )
        for request, kind in zip(plan["cost_requests"], xferto.PLAY_COST_KINDS):
            assert request["operation"] == xferto.COST_OPERATION_FOR_KIND[kind]
            assert request["operation"].split(".")[0] in ("rules", "state")

    def test_unknown_cost_kind_rejected(self):
        with pytest.raises(contract.ClosedEnumError):
            build(
                [{"source_assertion": SRC_KNOWLEDGE["assertion_id"]}],
                play_cost=[{"kind": "hp_loss"}],
            )

    def test_unknown_cost_field_rejected(self):
        with pytest.raises(contract.UnknownFieldError):
            build(
                [{"source_assertion": SRC_KNOWLEDGE["assertion_id"]}],
                play_cost=[{"kind": "san_loss", "dice": "1d4"}],
            )

    @pytest.mark.parametrize("amount", [-1, True, 1.5, ""])
    def test_bad_amount_rejected(self, amount):
        with pytest.raises(contract.TransferError, match="amount"):
            build(
                [{"source_assertion": SRC_KNOWLEDGE["assertion_id"]}],
                play_cost=[{"kind": "san_loss", "amount": amount}],
            )

    def test_bad_cost_subject_rejected(self):
        with pytest.raises(contract.TransferError, match="subject id"):
            build(
                [{"source_assertion": SRC_KNOWLEDGE["assertion_id"]}],
                play_cost=[{"kind": "san_loss", "subject_id": INV_SUBJECT.upper()}],
            )

    def test_play_cost_overflow_rejected(self):
        with pytest.raises(contract.TransferError, match="500-char"):
            build(
                [{"source_assertion": SRC_KNOWLEDGE["assertion_id"]}],
                play_cost=[
                    {
                        "kind": "san_loss",
                        "amount": "1d4",
                        "note": "x" * 500,
                    }
                ],
            )

    def test_requests_rebuild_deterministically_from_record(self):
        plan = build(
            [{"source_assertion": SRC_KNOWLEDGE["assertion_id"]}],
            play_cost=[{"kind": "san_check", "amount": 1, "subject_id": INV_SUBJECT}],
        )
        # The cause is durable: a bare record rebuilds the exact typed
        # requests, cause included, without any plan-level sidecar.
        assert xferto.cost_requests_from_event(plan["transfer"]) == plan[
            "cost_requests"
        ]
        assert xferto.cost_requests_from_event(plan) == plan["cost_requests"]

    def test_non_canonical_play_cost_rejected_on_rebuild(self):
        plan = build(
            [{"source_assertion": SRC_KNOWLEDGE["assertion_id"]}],
            play_cost=[{"kind": "san_loss", "amount": "1d4"}],
        )
        tampered = dict(plan["transfer"])
        # Same content, non-canonical key order (costs before cause): rejected.
        tampered["play_cost"] = '{"costs":[{"amount":"1d4","kind":"san_loss"}],"cause":"dream-bleed-after-fork"}'
        with pytest.raises(contract.TransferError, match="canonical"):
            xferto.cost_requests_from_event(tampered)

    @pytest.mark.parametrize(
        "bad",
        [
            # list instead of envelope
            '[{"amount":"1d4","kind":"san_loss"}]',
            # missing costs key
            '{"cause":"dream-bleed-after-fork"}',
            # extra key smuggled in
            '{"cause":"c","costs":[],"why":"because"}',
            # blank cause is not durable evidence
            '{"cause":"   ","costs":[]}',
        ],
        ids=["list", "missing-costs", "extra-key", "blank-cause"],
    )
    def test_malformed_envelope_rejected_on_rebuild(self, bad):
        plan = build([{"source_assertion": SRC_KNOWLEDGE["assertion_id"]}])
        tampered = dict(plan["transfer"])
        tampered["play_cost"] = bad
        with pytest.raises(contract.TransferError):
            xferto.cost_requests_from_event(tampered)

    def test_record_without_envelope_fails_closed(self):
        plan = build([{"source_assertion": SRC_KNOWLEDGE["assertion_id"]}])
        stripped = dict(plan["transfer"])
        stripped["play_cost"] = None
        contract.validate_transfer(stripped)  # contract-shape still fine
        with pytest.raises(contract.TransferError, match="mandatory durable"):
            xferto.cause_from_event(stripped)
        with pytest.raises(contract.TransferError, match="mandatory durable"):
            xferto.cost_requests_from_event(stripped)


# ---------------------------------------------------------------------------
# validate_transfer_plan
# ---------------------------------------------------------------------------


def make_plan(play_cost=None, **kwargs):
    plan = build(
        [
            {"source_assertion": SRC_KNOWLEDGE["assertion_id"]},
            {
                "source_assertion": SRC_KNOWLEDGE_2["assertion_id"],
                "state": "uncertain",
                "credibility": 0.3,
            },
        ],
        play_cost=play_cost,
        **kwargs,
    )
    sources = [SRC_KNOWLEDGE, SRC_KNOWLEDGE_2, SRC_WORLD]
    targets = xferto.derive_target_assertions(plan, sources)
    return plan, sources, targets


class TestValidateTransferPlan:
    def test_valid_plan_report(self):
        plan, sources, targets = make_plan(
            play_cost=[{"kind": "san_loss", "amount": "1d4"}]
        )
        report = xferto.validate_transfer_plan(plan, sources, targets)
        assert report["transfer_id"] == plan["transfer"]["transfer_id"]
        assert report["entry_count"] == 2
        assert report["target_ids"] == [t["assertion_id"] for t in targets]
        assert report["idempotent_target_ids"] == []
        assert report["cost_operations"] == ["rules.san_loss"]
        assert report["applied"] is False
        assert report["cost_requests"] == plan["cost_requests"]
        assert report["plan_digest"]

    def test_accepts_bare_event(self):
        plan, sources, targets = make_plan()
        report = xferto.validate_transfer_plan(plan["transfer"], sources, targets)
        assert report["entry_count"] == 2

    def test_tampered_target_rejected(self):
        plan, sources, targets = make_plan()
        tampered = dict(targets[0])
        tampered["statement"] = "Someone rewrote the memory."
        with pytest.raises(contract.TransferError, match="deterministic derivation"):
            xferto.validate_transfer_plan(
                plan, sources, [tampered, targets[1]]
            )

    def test_missing_target_rejected(self):
        plan, sources, targets = make_plan()
        with pytest.raises(contract.TransferError, match="missing="):
            xferto.validate_transfer_plan(plan, sources, targets[:1])

    def test_extra_target_rejected(self):
        plan, sources, targets = make_plan()
        extra = dict(targets[0])
        extra["assertion_id"] = f"mem-{CAMPAIGN}-echo-{TL_B}-intruder"
        with pytest.raises(contract.TransferError, match="extra="):
            xferto.validate_transfer_plan(plan, sources, targets + [extra])

    def test_duplicate_targets_rejected(self):
        plan, sources, targets = make_plan()
        with pytest.raises(contract.TransferError, match="duplicate target"):
            xferto.validate_transfer_plan(plan, sources, targets + [targets[0]])

    def test_wrong_transfer_ref_rejected_via_links(self):
        plan, sources, targets = make_plan()
        bad_ref = dict(targets[0])
        bad_ref["transfer_ref"] = f"transfer-{CAMPAIGN}-{TL_A}-to-{TL_B}"
        with pytest.raises(contract.TransferError):
            xferto.validate_transfer_plan(plan, sources, [bad_ref, targets[1]])

    def test_target_on_wrong_timeline_rejected_via_links(self):
        plan, sources, targets = make_plan()
        wrong_line = dict(targets[0])
        wrong_line["timeline_id"] = TL_B
        with pytest.raises(contract.TransferError):
            xferto.validate_transfer_plan(plan, sources, [wrong_line, targets[1]])

    def test_source_not_on_from_timeline_rejected(self):
        plan, _, targets = make_plan()
        misplaced = dict(SRC_KNOWLEDGE)
        misplaced["timeline_id"] = TL_A
        with pytest.raises(contract.TransferError):
            xferto.validate_transfer_plan(
                plan, [misplaced, SRC_KNOWLEDGE_2, SRC_WORLD], targets
            )

    def test_idempotent_replay_with_identical_existing(self):
        plan, sources, targets = make_plan()
        report = xferto.validate_transfer_plan(
            plan,
            sources,
            targets,
            existing_assertions=targets,
            existing_transfer_events=[plan["transfer"]],
        )
        assert sorted(report["idempotent_target_ids"]) == sorted(
            t["assertion_id"] for t in targets
        )
        assert report["idempotent_transfer"] is True

    def test_conflicting_existing_target_rejected(self):
        plan, sources, targets = make_plan()
        conflicting = dict(targets[0])
        conflicting["statement"] = "Pre-existing different memory."
        with pytest.raises(contract.TransferError, match="never overwritten"):
            xferto.validate_transfer_plan(
                plan,
                sources,
                targets,
                existing_assertions=[conflicting, targets[1]],
                existing_transfer_events=[plan["transfer"]],
            )

    def test_existing_unrelated_assertions_are_fine(self):
        plan, sources, targets = make_plan()
        unrelated = assertion(f"mem-{CAMPAIGN}-unrelated-memory")
        report = xferto.validate_transfer_plan(
            plan, sources, targets, existing_assertions=[unrelated]
        )
        assert report["idempotent_target_ids"] == []

    def test_validate_then_derive_round_trip_is_stable(self):
        plan, sources, targets = make_plan()
        report_a = xferto.validate_transfer_plan(plan, sources, targets)
        again = xferto.derive_target_assertions(plan, sources)
        report_b = xferto.validate_transfer_plan(plan, sources, again)
        assert report_a["plan_digest"] == report_b["plan_digest"]


# ---------------------------------------------------------------------------
# Transfer identity collisions: same source, multiple destinations
# ---------------------------------------------------------------------------


class TestTransferIdentityCollisions:
    """A→B and A→C must never derive the same target assertion id."""

    def _source_on_a(self):
        return assertion(f"mem-{CAMPAIGN}-chapel-sign", timeline_id=TL_A)

    def test_same_source_to_two_destinations_distinct_ids(self):
        src = self._source_on_a()
        to_b = xferto.build_transfer_event(
            CAMPAIGN, TL_A, TL_B, [src],
            [{"source_assertion": src["assertion_id"]}],
            "dream-bleed", None, "receipt-b",
        )
        to_c = xferto.build_transfer_event(
            CAMPAIGN, TL_A, TL_C, [src],
            [{"source_assertion": src["assertion_id"]}],
            "mythos-visions", None, "receipt-c",
        )
        targets_b = xferto.derive_target_assertions(to_b, [src])
        targets_c = xferto.derive_target_assertions(to_c, [src])
        assert targets_b[0]["assertion_id"] == (
            f"mem-{CAMPAIGN}-echo-{TL_A}-to-{TL_B}-chapel-sign"
        )
        assert targets_c[0]["assertion_id"] == (
            f"mem-{CAMPAIGN}-echo-{TL_A}-to-{TL_C}-chapel-sign"
        )
        assert targets_b[0]["assertion_id"] != targets_c[0]["assertion_id"]

    def test_second_destination_not_misclassified_as_collision(self):
        """The exact reviewer failure: existing A→B echo must not make the
        A→C plan raise as a divergent same-id overwrite."""
        src = self._source_on_a()
        plan_b = xferto.build_transfer_event(
            CAMPAIGN, TL_A, TL_B, [src],
            [{"source_assertion": src["assertion_id"]}],
            "dream-bleed", None, "receipt-b",
        )
        targets_b = xferto.derive_target_assertions(plan_b, [src])
        plan_c = xferto.build_transfer_event(
            CAMPAIGN, TL_A, TL_C, [src],
            [{"source_assertion": src["assertion_id"]}],
            "mythos-visions", None, "receipt-c",
        )
        targets_c = xferto.derive_target_assertions(plan_c, [src])
        report = xferto.validate_transfer_plan(
            plan_c, [src], targets_c, existing_assertions=targets_b
        )
        assert report["idempotent_target_ids"] == []
        assert report["target_ids"] == [t["assertion_id"] for t in targets_c]

    def test_divergent_same_id_still_rejected(self):
        """Collision detection itself stays hard: a same-id record with
        different content is never silently overwritten."""
        src = self._source_on_a()
        plan = xferto.build_transfer_event(
            CAMPAIGN, TL_A, TL_B, [src],
            [{"source_assertion": src["assertion_id"]}],
            "dream-bleed", None, "receipt-b",
        )
        targets = xferto.derive_target_assertions(plan, [src])
        divergent = dict(targets[0])
        divergent["statement"] = "Divergent content under the same id."
        with pytest.raises(contract.TransferError, match="never overwritten"):
            xferto.validate_transfer_plan(
                plan,
                [src],
                targets,
                existing_assertions=[divergent],
                existing_transfer_events=[plan["transfer"]],
            )

    def test_both_directions_and_all_destinations_pairwise_distinct(self):
        src = self._source_on_a()
        ids = set()
        for frm, to, receipt in (
            (TL_A, TL_B, "r1"),
            (TL_B, TL_A, "r2"),
            (TL_A, TL_C, "r3"),
            (TL_C, TL_A, "r4"),
        ):
            local = assertion(src["assertion_id"], timeline_id=frm)
            plan = xferto.build_transfer_event(
                CAMPAIGN, frm, to, [local],
                [{"source_assertion": local["assertion_id"]}],
                "dream-bleed", None, receipt,
            )
            (target,) = xferto.derive_target_assertions(plan, [local])
            assert f"-to-{to}-" in target["assertion_id"]
            ids.add(target["assertion_id"])
        assert len(ids) == 4

    def test_entry_target_matches_derivation_across_destinations(self):
        src = self._source_on_a()
        for to, receipt in ((TL_B, "receipt-b"), (TL_C, "receipt-c")):
            plan = xferto.build_transfer_event(
                CAMPAIGN, TL_A, to, [src],
                [{"source_assertion": src["assertion_id"]}],
                "dream-bleed", None, receipt,
            )
            entry_target = plan["transfer"]["entries"][0]["target_assertion"]
            (derived,) = xferto.derive_target_assertions(plan, [src])
            assert entry_target == derived["assertion_id"]
            assert derived["timeline_id"] == to


# ---------------------------------------------------------------------------
# Cause durability across persistence round trips
# ---------------------------------------------------------------------------


class TestCauseDurability:
    def _plan(self, play_cost=None):
        return build(
            [{"source_assertion": SRC_KNOWLEDGE["assertion_id"]}],
            play_cost=play_cost,
        )

    def test_cause_round_trip_from_bare_record(self):
        plan = self._plan()
        record = plan["transfer"]
        assert xferto.cause_from_event(record) == "dream-bleed-after-fork"
        assert xferto.cause_from_event(plan) == "dream-bleed-after-fork"

    def test_cause_survives_json_serialization_round_trip(self):
        """Persisted evidence = the record alone; serialize/deserialize must
        not lose the cause."""
        plan = self._plan(
            play_cost=[{"kind": "san_loss", "amount": "1d4", "subject_id": INV_SUBJECT}]
        )
        persisted = json.loads(json.dumps(plan["transfer"]))
        assert xferto.cause_from_event(persisted) == "dream-bleed-after-fork"
        assert xferto.cost_requests_from_event(persisted) == plan["cost_requests"]

    def test_cost_requests_from_record_carry_cause(self):
        plan = self._plan(play_cost=[{"kind": "san_loss", "amount": "1d4"}])
        rebuilt = xferto.cost_requests_from_event(plan["transfer"])
        assert rebuilt == plan["cost_requests"]
        assert all(r["cause"] == "dream-bleed-after-fork" for r in rebuilt)

    def test_validate_transfer_plan_report_rebuilds_cause(self):
        plan = self._plan(play_cost=[{"kind": "san_loss", "amount": "1d4"}])
        targets = xferto.derive_target_assertions(plan, [SRC_KNOWLEDGE])
        report = xferto.validate_transfer_plan(plan["transfer"], [SRC_KNOWLEDGE], targets)
        assert report["cost_requests"] == plan["cost_requests"]
        assert report["cost_requests"][0]["cause"] == "dream-bleed-after-fork"


# ---------------------------------------------------------------------------
# Replay semantics
# ---------------------------------------------------------------------------


class TestReplaySemantics:
    def test_full_replay_is_idempotent(self):
        sources = [SRC_KNOWLEDGE, SRC_KNOWLEDGE_2]
        entries = [
            {"source_assertion": SRC_KNOWLEDGE["assertion_id"]},
            {
                "source_assertion": SRC_KNOWLEDGE_2["assertion_id"],
                "state": "uncertain",
                "credibility": 0.3,
            },
        ]
        costs = [{"kind": "san_loss", "amount": "1d4", "subject_id": INV_SUBJECT}]
        first = build(entries, sources=sources, play_cost=costs)
        targets_first = xferto.derive_target_assertions(first, sources)
        report_first = xferto.validate_transfer_plan(
            first,
            sources,
            targets_first,
            existing_assertions=targets_first,
            existing_transfer_events=[first["transfer"]],
        )

        # Same inputs submitted again: identical record, identical report,
        # both targets recognized as idempotent replays.
        second = build(entries, sources=sources, play_cost=costs)
        assert contract.record_digest(second["transfer"]) == contract.record_digest(
            first["transfer"]
        )
        targets_second = xferto.derive_target_assertions(second, sources)
        assert [contract.record_digest(t) for t in targets_second] == [
            contract.record_digest(t) for t in targets_first
        ]
        report_second = xferto.validate_transfer_plan(
            second,
            sources,
            targets_second,
            existing_assertions=targets_first,
            existing_transfer_events=[first["transfer"]],
        )
        assert sorted(report_second["idempotent_target_ids"]) == sorted(
            t["assertion_id"] for t in targets_first
        )
        assert report_second["idempotent_transfer"] is True
        assert report_second["plan_digest"] == report_first["plan_digest"]
        assert report_second["cost_requests"] == first["cost_requests"]

    def test_replay_from_persisted_record_alone(self):
        sources = [SRC_KNOWLEDGE]
        plan = build(
            [{"source_assertion": SRC_KNOWLEDGE["assertion_id"]}],
            sources=sources,
            play_cost=[{"kind": "san_check", "amount": 1}],
        )
        persisted = json.loads(json.dumps(plan["transfer"]))
        targets = xferto.derive_target_assertions(persisted, sources)
        report = xferto.validate_transfer_plan(persisted, sources, targets)
        assert report["cost_requests"] == plan["cost_requests"]
        assert report["target_ids"] == [t["assertion_id"] for t in targets]


# ---------------------------------------------------------------------------
# Event-level replay binding: one ordered pair, one authoritative event
# ---------------------------------------------------------------------------


class TestEventReplayBinding:
    """Replay of the same transfer_id is idempotent ONLY when the entire
    persisted authoritative event is canonically identical — even when the
    derived target assertions are byte-for-byte the same."""

    def _source(self):
        return SRC_KNOWLEDGE

    def _persisted(self, **kwargs):
        """A persisted first apply: event + derived targets."""
        src = self._source()
        plan = build(
            [{"source_assertion": src["assertion_id"]}], sources=[src], **kwargs
        )
        targets = xferto.derive_target_assertions(plan, [src])
        return plan, [src], targets

    def _validate_replay(self, replay_plan, persisted_plan, sources, targets=None):
        src = sources[0]
        replay_targets = targets or xferto.derive_target_assertions(replay_plan, [src])
        return xferto.validate_transfer_plan(
            replay_plan,
            sources,
            replay_targets,
            existing_assertions=(
                xferto.derive_target_assertions(persisted_plan, [src])
                if targets is None
                else targets
            ),
            existing_transfer_events=[persisted_plan["transfer"]],
        )

    def test_exact_persisted_event_replay_is_idempotent(self):
        plan, sources, targets = self._persisted(
            play_cost=[{"kind": "san_loss", "amount": "1d4", "subject_id": INV_SUBJECT}]
        )
        report = self._validate_replay(
            build(
                [{"source_assertion": sources[0]["assertion_id"]}],
                sources=sources,
                play_cost=[{"kind": "san_loss", "amount": "1d4", "subject_id": INV_SUBJECT}],
            ),
            plan,
            sources,
        )
        assert report["idempotent_transfer"] is True
        assert report["idempotent_target_ids"] == [t["assertion_id"] for t in targets]
        assert report["event_digest"] == contract.record_digest(plan["transfer"])

    def test_changed_cause_fails_closed(self):
        plan, sources, _ = self._persisted(cause="dream-bleed-after-fork")
        replay = build(
            [{"source_assertion": sources[0]["assertion_id"]}],
            sources=sources,
            cause="a-different-mythos-reason",
        )
        # Derived targets are identical (cause is not embedded in them).
        assert [t["assertion_id"] for t in xferto.derive_target_assertions(replay, sources)] == [
            t["assertion_id"] for t in xferto.derive_target_assertions(plan, sources)
        ]
        with pytest.raises(contract.TransferError, match="already.*persisted.*different"):
            self._validate_replay(replay, plan, sources)

    def test_changed_cost_fails_closed(self):
        plan, sources, _ = self._persisted(
            play_cost=[{"kind": "san_loss", "amount": "1d4", "subject_id": INV_SUBJECT}]
        )
        replay = build(
            [{"source_assertion": sources[0]["assertion_id"]}],
            sources=sources,
            play_cost=[{"kind": "san_loss", "amount": "2d4", "subject_id": INV_SUBJECT}],
        )
        with pytest.raises(contract.TransferError, match="play_cost"):
            self._validate_replay(replay, plan, sources)

    def test_added_cost_fails_closed(self):
        plan, sources, _ = self._persisted()
        replay = build(
            [{"source_assertion": sources[0]["assertion_id"]}],
            sources=sources,
            play_cost=[{"kind": "san_loss", "amount": "1d4"}],
        )
        with pytest.raises(contract.TransferError):
            self._validate_replay(replay, plan, sources)

    def test_changed_receipt_fails_closed(self):
        plan, sources, _ = self._persisted(receipt="transfer-receipt-1")
        replay = build(
            [{"source_assertion": sources[0]["assertion_id"]}],
            sources=sources,
            receipt="transfer-receipt-2",
        )
        # Targets identical: receipt is not embedded in assertions.
        with pytest.raises(contract.TransferError, match="receipt"):
            self._validate_replay(replay, plan, sources)

    def test_changed_event_provenance_fails_closed(self):
        plan, sources, _ = self._persisted(source_commit="a" * 40)
        replay = build(
            [{"source_assertion": sources[0]["assertion_id"]}],
            sources=sources,
            source_commit="b" * 40,
        )
        # Targets identical: they carry the SOURCE assertion's commit, not
        # the event's anchor commit.
        with pytest.raises(contract.TransferError, match="source_commit"):
            self._validate_replay(replay, plan, sources)

    def test_changed_entry_credibility_fails_closed(self):
        src = self._source()
        plan = build(
            [{"source_assertion": src["assertion_id"], "credibility": 0.9}],
            sources=[src],
        )
        replay = build(
            [{"source_assertion": src["assertion_id"], "credibility": 0.7}],
            sources=[src],
        )
        # Both faithful echoes derive identical targets (fidelity stays on
        # the entry); the event must still not be silently replaced.
        assert (
            xferto.derive_target_assertions(replay, [src])[0]["assertion_id"]
            == xferto.derive_target_assertions(plan, [src])[0]["assertion_id"]
        )
        with pytest.raises(contract.TransferError, match="entries"):
            self._validate_replay(replay, plan, [src])

    def test_changed_entry_distortion_fails_closed(self):
        src = self._source()
        plan = build(
            [
                {
                    "source_assertion": src["assertion_id"],
                    "state": "distorted",
                    "credibility": 0.6,
                    "distortion": "remembers a spiral",
                }
            ],
            sources=[src],
        )
        replay = build(
            [
                {
                    "source_assertion": src["assertion_id"],
                    "state": "distorted",
                    "credibility": 0.6,
                    "distortion": "remembers a door",
                }
            ],
            sources=[src],
        )
        with pytest.raises(contract.TransferError):
            self._validate_replay(replay, plan, [src])

    def test_divergent_persisted_store_fails_closed(self):
        plan, sources, _ = self._persisted()
        divergent_copy = dict(plan["transfer"])
        divergent_copy["receipt"] = "another-receipt"
        with pytest.raises(
            contract.TransferError, match="two divergent transfer events"
        ):
            xferto.validate_transfer_plan(
                plan,
                sources,
                xferto.derive_target_assertions(plan, sources),
                existing_transfer_events=[plan["transfer"], divergent_copy],
            )

    def test_orphan_target_assertions_fail_closed(self):
        """Targets already claiming this transfer_ref while no authoritative
        event is provided = orphan evidence; never accept."""
        plan, sources, targets = self._persisted()
        with pytest.raises(contract.TransferError, match="orphan evidence"):
            xferto.validate_transfer_plan(
                plan, sources, targets, existing_assertions=targets
            )

    def test_orphan_via_lookup_missing_event_fails_closed(self):
        plan, sources, targets = self._persisted()
        with pytest.raises(contract.TransferError, match="orphan evidence"):
            xferto.validate_transfer_plan(
                plan,
                sources,
                targets,
                existing_assertions=targets,
                existing_event_lookup=lambda transfer_id: None,
            )

    def test_existing_event_lookup_round_trip(self):
        plan, sources, targets = self._persisted(
            play_cost=[{"kind": "san_loss", "amount": "1d4"}]
        )
        store = {plan["transfer"]["transfer_id"]: plan["transfer"]}
        report = xferto.validate_transfer_plan(
            plan,
            sources,
            targets,
            existing_assertions=targets,
            existing_event_lookup=store.get,
        )
        assert report["idempotent_transfer"] is True
        assert sorted(report["idempotent_target_ids"]) == sorted(
            t["assertion_id"] for t in targets
        )

    def test_existing_assertion_not_derivable_from_event_fails_closed(self):
        plan, sources, _ = self._persisted()
        src = sources[0]
        # A stray assertion claiming this transfer_ref but not derivable
        # from the authoritative event.
        stray = xferto.derive_target_assertions(plan, [src])[0]
        stray["assertion_id"] = (
            f"mem-{CAMPAIGN}-echo-{TL_B}-to-{TL_A}-never-transferred"
        )
        with pytest.raises(contract.TransferError, match="not.*derivable"):
            xferto.validate_transfer_plan(
                plan,
                sources,
                xferto.derive_target_assertions(plan, [src]),
                existing_assertions=[stray],
                existing_transfer_events=[plan["transfer"]],
            )

    def test_unrelated_ordered_pairs_do_not_interfere(self):
        """Existing events for other (from, to) pairs are ignored for
        replay-binding purposes: A->B validates cleanly alongside persisted
        A->C and B->A events."""
        src_on_a = assertion(f"mem-{CAMPAIGN}-chapel-sign", timeline_id=TL_A)
        other_events = []
        for frm, to, src_local, receipt in (
            (TL_A, TL_C, src_on_a, "r-ac"),
            (TL_C, TL_A, assertion(f"mem-{CAMPAIGN}-chapel-sign", timeline_id=TL_C), "r-ca"),
        ):
            other_events.append(
                xferto.build_transfer_event(
                    CAMPAIGN, frm, to, [src_local],
                    [{"source_assertion": src_local["assertion_id"]}],
                    "unrelated-cause", None, receipt,
                )["transfer"]
            )
        src_on_b = SRC_KNOWLEDGE  # lives on TL_B
        plan = build([{"source_assertion": src_on_b["assertion_id"]}])
        targets = xferto.derive_target_assertions(plan, [src_on_b])
        report = xferto.validate_transfer_plan(
            plan,
            [src_on_b],
            targets,
            existing_transfer_events=other_events,
        )
        assert report["idempotent_transfer"] is False
        assert report["transfer_id"] == f"transfer-{CAMPAIGN}-{TL_B}-to-{TL_A}"
