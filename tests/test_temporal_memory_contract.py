"""Frozen contract for the Git-backed temporal memory / worldline system."""
from __future__ import annotations

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


contract = load_module(
    "coc_temporal_memory_contract", SCRIPTS / "coc_temporal_memory_contract.py"
)

SHA = "a" * 40
SHA2 = "b" * 40
CAMPAIGN = "amaranthine-16"
TL_A = "tl-main"
TL_B = "tl-fork-b"
TL_M = "tl-merged"

WORLD_SUBJECT = f"subject-world-{CAMPAIGN}"
INV_SUBJECT = "subject-investigator-elise"
NPC_SUBJECT = f"subject-npc-{CAMPAIGN}-corbitt"
PLAYER_SUBJECT = "subject-player-thomas"
KEEPER_SUBJECT = "subject-keeper-main"
PARTY_SUBJECT = f"subject-party-{CAMPAIGN}"


def subject(kind: str, subject_id: str, **overrides):
    record = {
        "subject_id": subject_id,
        "kind": kind,
        "campaign_id": CAMPAIGN if kind in ("world", "party", "npc") else None,
        "display_name": "Display Name",
        "same_subject_as": [],
    }
    record.update(overrides)
    return record


def entity(entity_id: str, **overrides):
    record = {
        "entity_id": entity_id,
        "kind": entity_id.split("-")[1],
        "campaign_id": CAMPAIGN,
        "display_name": "Entity Name",
        "aliases": [],
        "same_entity_as": [],
        "subject_ref": None,
    }
    record.update(overrides)
    return record


def assertion(assertion_id: str, **overrides):
    record = {
        "assertion_id": assertion_id,
        "kind": "knowledge",
        "scope": "campaign",
        "campaign_id": CAMPAIGN,
        "timeline_id": TL_A,
        "subject_id": INV_SUBJECT,
        "knowers": [INV_SUBJECT],
        "privacy": "player_safe",
        "state": "accurate",
        "statement": "Elise saw the cultist sign on the chapel door.",
        "entities": [],
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


def timeline(timeline_id: str, kind: str = "fork", **overrides):
    record = {
        "timeline_id": timeline_id,
        "campaign_id": CAMPAIGN,
        "kind": kind,
        "parents": [] if kind == "root" else [TL_A] if kind == "fork" else [TL_A, TL_B],
        "fork_point": None
        if kind == "root"
        else {"commit": SHA, "turn": 3, "episode_id": f"episode-{CAMPAIGN}-{TL_A}-turn-3"},
        "created_by": "initial" if kind == "root" else "kp_decision",
    }
    record.update(overrides)
    return record


def conflict(conflict_id: str, conflict_class: str, mode: str, **overrides):
    record = {
        "conflict_id": conflict_id,
        "class": conflict_class,
        "left": {"timeline": TL_A, "refs": ["receipt-l"], "value": 9},
        "right": {"timeline": TL_B, "refs": ["receipt-r"], "value": 5},
        "disposition": {
            "mode": mode,
            "receipt": "confluence-disposition-l",
            "resolver_receipt": "resolver-l",
            "note": None,
        },
    }
    record.update(overrides)
    return record


def confluence(conflict_rows=(), **overrides):
    record = {
        "confluence_id": f"confluence-{CAMPAIGN}-{TL_M}",
        "campaign_id": CAMPAIGN,
        "timeline_id": TL_M,
        "parents": [TL_A, TL_B],
        "merge_commit": SHA2,
        "receipt": "confluence-receipt-1",
        "conflicts": list(conflict_rows),
    }
    record.update(overrides)
    return record


def transfer(entries, **overrides):
    record = {
        "transfer_id": f"transfer-{CAMPAIGN}-{TL_B}-to-{TL_A}",
        "campaign_id": CAMPAIGN,
        "from_timeline": TL_B,
        "to_timeline": TL_A,
        "receipt": "transfer-receipt-1",
        "source_commit": SHA2,
        "source_turn": 8,
        "entries": entries,
        "play_cost": None,
    }
    record.update(overrides)
    return record


def backlog(**overrides):
    record = {
        "backlog_id": f"backlog-{CAMPAIGN}-t5-semantic-pass",
        "campaign_id": CAMPAIGN,
        "timeline_id": TL_A,
        "commit": SHA,
        "turn_number": 5,
        "reason": "extraction_error",
        "status": "pending",
    }
    record.update(overrides)
    return record


# ---------------------------------------------------------------------------
# Schema validation: each record type
# ---------------------------------------------------------------------------


class TestSubjectSchema:
    def test_valid_subjects(self):
        contract.validate_subject(subject("world", WORLD_SUBJECT))
        contract.validate_subject(subject("party", PARTY_SUBJECT))
        contract.validate_subject(
            subject("npc", NPC_SUBJECT, display_name="Walter Corbitt")
        )
        contract.validate_subject(
            subject("investigator", INV_SUBJECT, campaign_id=None)
        )
        contract.validate_subject(subject("player", PLAYER_SUBJECT))
        contract.validate_subject(subject("keeper", KEEPER_SUBJECT))

    def test_unknown_field_rejected(self):
        rec = subject("world", WORLD_SUBJECT)
        rec["hp"] = 10
        with pytest.raises(contract.UnknownFieldError):
            contract.validate_subject(rec)

    def test_missing_required_field(self):
        rec = subject("world", WORLD_SUBJECT)
        del rec["display_name"]
        with pytest.raises(contract.MissingFieldError):
            contract.validate_subject(rec)

    def test_world_subject_id_is_deterministic(self):
        with pytest.raises(contract.SemanticIdError):
            contract.validate_subject(subject("world", "subject-world-other-camp"))

    def test_npc_subject_requires_campaign(self):
        with pytest.raises(contract.ScopeError):
            contract.validate_subject(
                subject("npc", NPC_SUBJECT, campaign_id=None)
            )

    def test_cross_campaign_binding_via_same_subject(self):
        contract.validate_subject(
            subject("player", PLAYER_SUBJECT, same_subject_as=["subject-player-thomas-b"])
        )
        with pytest.raises(contract.IdentityError):
            contract.validate_subject(
                subject("player", PLAYER_SUBJECT, same_subject_as=[PLAYER_SUBJECT])
            )

    def test_subject_id_for(self):
        assert (
            contract.subject_id_for("world", CAMPAIGN, "")
            == WORLD_SUBJECT
        )
        assert (
            contract.subject_id_for("npc", CAMPAIGN, "corbitt") == NPC_SUBJECT
        )
        assert contract.subject_id_for("player", None, "thomas") == PLAYER_SUBJECT
        with pytest.raises(contract.ClosedEnumError):
            contract.subject_id_for("deity", CAMPAIGN, "azathoth")


class TestEntitySchema:
    def test_valid_entity(self):
        contract.validate_entity(entity("entity-person-walter-corbitt"))
        contract.validate_entity(
            entity("entity-location-chapel", aliases=["the old chapel"])
        )

    def test_entity_id_embeds_kind(self):
        with pytest.raises(contract.SemanticIdError):
            contract.validate_entity(
                entity("entity-person-walter-corbitt", kind="location")
            )

    def test_cross_campaign_entity_requires_explicit_binding(self):
        with pytest.raises(contract.ScopeError):
            contract.validate_entity(entity("entity-item-mythos-tome", campaign_id=None))
        contract.validate_entity(
            entity(
                "entity-item-mythos-tome",
                campaign_id=None,
                same_entity_as=["entity-item-mythos-tome-eu"],
            )
        )

    def test_duplicate_aliases_rejected(self):
        with pytest.raises(contract.TemporalMemoryContractError):
            contract.validate_entity(
                entity("entity-person-walter-corbitt", aliases=["x", "x"])
            )


class TestAssertionSchema:
    def test_valid_assertions(self):
        contract.validate_assertion(assertion(f"mem-{CAMPAIGN}-chapel-sign"))
        contract.validate_assertion(
            assertion(
                f"mem-{CAMPAIGN}-corbitt-hostile",
                kind="relationship",
                subject_id=INV_SUBJECT,
                entities=["entity-person-walter-corbitt"],
            )
        )
        contract.validate_assertion(
            assertion(
                f"mem-{CAMPAIGN}-manor-burned",
                kind="world_event",
                subject_id=WORLD_SUBJECT,
                knowers=[],
            )
        )

    def test_unknown_field_rejected(self):
        rec = assertion(f"mem-{CAMPAIGN}-chapel-sign")
        rec["authority"] = "override"
        with pytest.raises(contract.UnknownFieldError):
            contract.validate_assertion(rec)

    def test_campaign_scope_requires_campaign_and_timeline(self):
        with pytest.raises(contract.ScopeError):
            contract.validate_assertion(
                assertion(f"mem-{CAMPAIGN}-chapel-sign", timeline_id=None)
            )

    def test_campaign_scope_id_embeds_campaign_slug(self):
        with pytest.raises(contract.SemanticIdError):
            contract.validate_assertion(assertion("mem-other-camp-chapel-sign"))

    def test_cross_campaign_marker(self):
        contract.validate_assertion(
            assertion(
                "mem-xc-prefers-slow-burn-horror",
                kind="player_preference",
                scope="cross_campaign",
                campaign_id=None,
                timeline_id=None,
                subject_id=PLAYER_SUBJECT,
                knowers=[PLAYER_SUBJECT],
                occurred_turn=0,
                valid_from_turn=0,
            )
        )
        # cross-campaign records may not carry campaign/timeline binding
        with pytest.raises(contract.ScopeError):
            contract.validate_assertion(
                assertion(
                    "mem-xc-prefers-slow-burn-horror",
                    kind="player_preference",
                    scope="cross_campaign",
                    campaign_id=CAMPAIGN,
                    subject_id=PLAYER_SUBJECT,
                    knowers=[PLAYER_SUBJECT],
                )
            )

    def test_world_event_is_campaign_scoped(self):
        with pytest.raises(contract.ScopeError):
            contract.validate_assertion(
                assertion(
                    "mem-xc-cult-wins",
                    kind="world_event",
                    scope="cross_campaign",
                    campaign_id=None,
                    timeline_id=None,
                    subject_id=WORLD_SUBJECT,
                )
            )

    def test_closed_enums(self):
        for field, allowed in (
            ("kind", contract.ASSERTION_KINDS),
            ("state", contract.MEMORY_STATES),
            ("privacy", contract.PRIVACY_LEVELS),
            ("scope", contract.SCOPES),
        ):
            rec = assertion(f"mem-{CAMPAIGN}-enum-check")
            rec[field] = "not-a-member"
            with pytest.raises(contract.ClosedEnumError):
                contract.validate_assertion(rec)
        assert set(allowed)  # enum tuples are non-empty

    def test_memory_states_exact(self):
        assert contract.MEMORY_STATES == (
            "accurate",
            "uncertain",
            "distorted",
            "suppressed",
            "forgotten",
            "implanted",
            "dreamlike",
            "cross_timeline_echo",
            "contradictory",
        )

    def test_owner_in_knowers(self):
        with pytest.raises(contract.TemporalMemoryContractError):
            contract.validate_assertion(
                assertion(f"mem-{CAMPAIGN}-no-knower", knowers=[])
            )
        # world_event is exempt from knower requirements
        contract.validate_assertion(
            assertion(
                f"mem-{CAMPAIGN}-world-fact",
                kind="world_event",
                subject_id=WORLD_SUBJECT,
                knowers=[],
            )
        )

    def test_relationship_requires_exactly_one_target(self):
        with pytest.raises(contract.TemporalMemoryContractError):
            contract.validate_assertion(
                assertion(f"mem-{CAMPAIGN}-rel-bad", kind="relationship")
            )
        contract.validate_assertion(
            assertion(
                f"mem-{CAMPAIGN}-rel-ok",
                kind="relationship",
                entities=["entity-person-walter-corbitt"],
            )
        )

    def test_occurred_not_after_valid_from(self):
        with pytest.raises(contract.TemporalMemoryContractError):
            contract.validate_assertion(
                assertion(
                    f"mem-{CAMPAIGN}-late-memory", occurred_turn=5, valid_from_turn=3
                )
            )


# ---------------------------------------------------------------------------
# Provenance always bound
# ---------------------------------------------------------------------------


class TestProvenance:
    def _strip(self, field):
        rec = assertion(f"mem-{CAMPAIGN}-prov-check")
        rec.pop(field)
        return rec

    @pytest.mark.parametrize(
        "field",
        [
            "timeline_id",
            "source_commit",
            "source_turn",
            "source_receipts",
        ],
    )
    def test_missing_provenance_rejected(self, field):
        rec = self._strip(field)
        with pytest.raises(
            (
                contract.ProvenanceError,
                contract.MissingFieldError,
                contract.ScopeError,
            )
        ):
            contract.validate_assertion(rec)

    def test_empty_receipts_rejected(self):
        with pytest.raises(contract.ProvenanceError):
            contract.validate_assertion(
                assertion(f"mem-{CAMPAIGN}-no-receipts", source_receipts=[])
            )

    def test_bad_commit_sha_rejected(self):
        for bad in ("HEAD", "ZZ" * 20, "a" * 39, "A" * 40):
            with pytest.raises(contract.ProvenanceError):
                contract.validate_assertion(
                    assertion(f"mem-{CAMPAIGN}-bad-sha", source_commit=bad)
                )

    def test_source_turn_bounds(self):
        with pytest.raises(contract.ProvenanceError):
            contract.validate_assertion(
                assertion(f"mem-{CAMPAIGN}-bad-turn", source_turn=-1)
            )
        contract.validate_assertion(
            assertion(
                f"mem-{CAMPAIGN}-turn-zero",
                occurred_turn=0,
                source_turn=0,
                valid_from_turn=0,
            )
        )


# ---------------------------------------------------------------------------
# Privacy and subject projection
# ---------------------------------------------------------------------------


class TestProjection:
    def test_player_view_excludes_keeper_only(self):
        rows = [
            assertion(f"mem-{CAMPAIGN}-a", privacy="player_safe"),
            assertion(f"mem-{CAMPAIGN}-b", privacy="keeper_only"),
        ]
        view = contract.project_player_view(rows)
        assert [a["assertion_id"] for a in view] == [f"mem-{CAMPAIGN}-a"]

    def test_player_view_sorted_deterministically(self):
        rows = [
            assertion(f"mem-{CAMPAIGN}-z"),
            assertion(f"mem-{CAMPAIGN}-a"),
        ]
        assert [a["assertion_id"] for a in contract.project_player_view(rows)] == [
            f"mem-{CAMPAIGN}-a",
            f"mem-{CAMPAIGN}-z",
        ]

    def test_suppressed_implies_keeper_only(self):
        with pytest.raises(contract.PrivacyError):
            contract.validate_assertion(
                assertion(
                    f"mem-{CAMPAIGN}-suppressed", state="suppressed", privacy="player_safe"
                )
            )
        contract.validate_assertion(
            assertion(
                f"mem-{CAMPAIGN}-suppressed",
                state="suppressed",
                privacy="keeper_only",
            )
        )

    def test_player_assertion_is_player_visible_candidate(self):
        contract.validate_assertion(
            assertion(
                f"mem-{CAMPAIGN}-player-guess",
                kind="player_assertion",
                subject_id=PLAYER_SUBJECT,
                knowers=[PLAYER_SUBJECT],
            )
        )
        # wrong subject kind rejected
        with pytest.raises(contract.ScopeError):
            contract.validate_assertion(
                assertion(
                    f"mem-{CAMPAIGN}-player-guess-bad",
                    kind="player_assertion",
                    subject_id=INV_SUBJECT,
                    knowers=[INV_SUBJECT],
                )
            )
        # a player assertion is never keeper_only
        with pytest.raises(contract.PrivacyError):
            contract.validate_assertion(
                assertion(
                    f"mem-{CAMPAIGN}-player-guess-hidden",
                    kind="player_assertion",
                    subject_id=PLAYER_SUBJECT,
                    knowers=[PLAYER_SUBJECT],
                    privacy="keeper_only",
                )
            )

    def test_subject_view_narrows_by_knower_and_time(self):
        old = assertion(
            f"mem-{CAMPAIGN}-old",
            valid_from_turn=1,
            valid_until_turn=3,
            superseded_by=[f"mem-{CAMPAIGN}-new"],
        )
        new = assertion(f"mem-{CAMPAIGN}-new", valid_from_turn=3)
        other = assertion(
            f"mem-{CAMPAIGN}-party",
            subject_id=PARTY_SUBJECT,
            knowers=[PARTY_SUBJECT],
        )
        view = contract.project_subject_view([old, new, other], INV_SUBJECT, as_of_turn=3)
        assert [a["assertion_id"] for a in view] == [
            f"mem-{CAMPAIGN}-new",
            f"mem-{CAMPAIGN}-old",
        ]
        view2 = contract.project_subject_view(
            [old, new, other], INV_SUBJECT, as_of_turn=4
        )
        assert [a["assertion_id"] for a in view2] == [f"mem-{CAMPAIGN}-new"]
        view3 = contract.project_subject_view([old, new, other], PARTY_SUBJECT)
        assert [a["assertion_id"] for a in view3] == [f"mem-{CAMPAIGN}-party"]

    def test_effective_at_bounds_inclusive(self):
        a = assertion(f"mem-{CAMPAIGN}-win", valid_from_turn=2, valid_until_turn=5)
        assert contract.effective_at(a, 1) is False
        assert contract.effective_at(a, 2) is True
        assert contract.effective_at(a, 5) is True
        assert contract.effective_at(a, 6) is False
        assert contract.effective_at(a, 99) is False


# ---------------------------------------------------------------------------
# Contradiction preservation (never delete)
# ---------------------------------------------------------------------------


class TestContradictionPreservation:
    def test_valid_until_requires_superseded_by(self):
        with pytest.raises(contract.SupersessionError):
            contract.validate_assertion(
                assertion(
                    f"mem-{CAMPAIGN}-closed", valid_until_turn=5, superseded_by=[]
                )
            )

    def test_superseded_by_requires_valid_until(self):
        with pytest.raises(contract.SupersessionError):
            contract.validate_assertion(
                assertion(
                    f"mem-{CAMPAIGN}-sup",
                    valid_until_turn=None,
                    superseded_by=[f"mem-{CAMPAIGN}-other"],
                )
            )

    def test_self_reference_rejected(self):
        aid = f"mem-{CAMPAIGN}-self"
        with pytest.raises(contract.SupersessionError):
            contract.validate_assertion(assertion(aid, superseded_by=[aid]))
        with pytest.raises(contract.SupersessionError):
            contract.validate_assertion(assertion(aid, contradicts=[aid]))

    def test_contradictory_state_names_its_target(self):
        with pytest.raises(contract.SupersessionError):
            contract.validate_assertion(
                assertion(f"mem-{CAMPAIGN}-contradicts-nothing", state="contradictory")
            )
        contract.validate_assertion(
            assertion(
                f"mem-{CAMPAIGN}-contradicts-named",
                state="contradictory",
                contradicts=[f"mem-{CAMPAIGN}-older"],
            )
        )

    def test_plan_supersession_keeps_old_addressable(self):
        old = assertion(f"mem-{CAMPAIGN}-old-one")
        closed = contract.plan_supersession(
            old, f"mem-{CAMPAIGN}-new-one", valid_until_turn=7
        )
        assert closed["assertion_id"] == f"mem-{CAMPAIGN}-old-one"
        assert closed["valid_until_turn"] == 7
        assert closed["superseded_by"] == [f"mem-{CAMPAIGN}-new-one"]
        # original untouched (pure helper)
        assert old["valid_until_turn"] is None
        contract.validate_assertion(closed)

    def test_bundle_keeps_both_assertions_and_resolves_refs(self):
        old = assertion(
            f"mem-{CAMPAIGN}-old-one",
            occurred_turn=1,
            valid_from_turn=1,
            valid_until_turn=4,
            superseded_by=[f"mem-{CAMPAIGN}-new-one"],
        )
        new = assertion(
            f"mem-{CAMPAIGN}-new-one",
            valid_from_turn=4,
            confirms=[f"mem-{CAMPAIGN}-old-one"],
        )
        contract.validate_assertion_bundle([old, new])
        with pytest.raises(contract.SupersessionError):
            contract.validate_assertion_bundle(
                [old, new, assertion(f"mem-{CAMPAIGN}-dangling", contradicts=["mem-x-nope"])]
            )
        with pytest.raises(contract.TemporalMemoryContractError):
            contract.validate_assertion_bundle([old, dict(old)])


# ---------------------------------------------------------------------------
# Episode determinism
# ---------------------------------------------------------------------------


class TestEpisode:
    def base(self, **overrides):
        record = {
            "episode_id": f"episode-{CAMPAIGN}-{TL_A}-turn-3",
            "campaign_id": CAMPAIGN,
            "timeline_id": TL_A,
            "commit": SHA,
            "turn_number": 3,
            "finalization_receipt": "turn-effect-v1:abc",
            "subjects_present": [INV_SUBJECT],
            "entities": [],
        }
        record.update(overrides)
        return record

    def test_valid_episode(self):
        contract.validate_episode(self.base())

    def test_episode_id_is_derived_not_invented(self):
        with pytest.raises(contract.SemanticIdError):
            contract.validate_episode(
                self.base(episode_id=f"episode-{CAMPAIGN}-{TL_A}-turn-three")
            )

    def test_episode_id_for_roundtrip(self):
        assert (
            contract.episode_id_for(CAMPAIGN, TL_A, 3)
            == f"episode-{CAMPAIGN}-{TL_A}-turn-3"
        )
        with pytest.raises(contract.TemporalMemoryContractError):
            contract.episode_id_for(CAMPAIGN, TL_A, 0)

    def test_turn_at_least_one(self):
        with pytest.raises(contract.TemporalMemoryContractError):
            contract.validate_episode(self.base(turn_number=0))


# ---------------------------------------------------------------------------
# Timeline lifecycle
# ---------------------------------------------------------------------------


class TestTimeline:
    def test_root_timeline(self):
        contract.validate_timeline(timeline("tl-main", kind="root"))

    def test_root_id_is_fixed(self):
        with pytest.raises(contract.TimelineError):
            contract.validate_timeline(timeline("tl-primordial", kind="root"))

    def test_fork_requires_one_parent_and_fork_point(self):
        contract.validate_timeline(timeline(TL_B, kind="fork"))
        with pytest.raises(contract.TimelineError):
            contract.validate_timeline(timeline(TL_B, kind="fork", parents=[]))
        with pytest.raises(contract.TimelineError):
            contract.validate_timeline(timeline(TL_B, kind="fork", fork_point=None))
        with pytest.raises(contract.TimelineError):
            contract.validate_timeline(timeline(TL_A, kind="fork", parents=[TL_A]))

    def test_confluence_requires_two_distinct_parents(self):
        contract.validate_timeline(timeline(TL_M, kind="confluence", created_by="confluence"))
        with pytest.raises(
            (contract.TimelineError, contract.TemporalMemoryContractError)
        ):
            contract.validate_timeline(
                timeline(TL_M, kind="confluence", parents=[TL_A, TL_A])
            )
        with pytest.raises(contract.TimelineError):
            contract.validate_timeline(timeline(TL_M, kind="confluence", parents=[TL_A]))

    def test_timeline_set_rules(self):
        root = timeline("tl-main", kind="root")
        fork = timeline(TL_B, kind="fork")
        merged = timeline(TL_M, kind="confluence", created_by="confluence")
        contract.validate_timeline_set([root, fork, merged], active_timeline_id=TL_M)
        # dangling active pointer
        with pytest.raises(contract.TimelineError):
            contract.validate_timeline_set([root, fork], active_timeline_id=TL_M)
        # missing root
        with pytest.raises(contract.TimelineError):
            contract.validate_timeline_set([fork])
        # parent cycle (not a diamond: b's parent is the merged line itself)
        with pytest.raises(contract.TimelineError):
            contract.validate_timeline_set(
                [root, timeline(TL_B, kind="fork", parents=[TL_M]), merged]
            )
        # diamond shapes (confluence with two parents) are not cycles
        contract.validate_timeline_set([root, fork, merged, timeline("tl-merged-2", kind="fork", parents=[TL_M])])


# ---------------------------------------------------------------------------
# Confluence dispositions
# ---------------------------------------------------------------------------


class TestConfluence:
    def _conflict(self, **overrides):
        return conflict(
            f"conflict-{CAMPAIGN}-{TL_M}-elise-hp", "stat_value", "choose_left", **overrides
        )

    def test_empty_conflict_list_is_legal_identical_branches(self):
        contract.validate_confluence(confluence())

    def test_every_conflict_requires_disposition(self):
        row = self._conflict()
        row["disposition"] = None
        with pytest.raises(contract.ConfluenceError):
            contract.validate_confluence(confluence([row]))
        del row["disposition"]
        with pytest.raises(contract.ConfluenceError):
            contract.validate_confluence(confluence([row]))

    def test_all_disposition_modes_accepted_for_semantic_class(self):
        for mode in contract.DISPOSITION_MODES:
            row = conflict(
                f"conflict-{CAMPAIGN}-{TL_M}-world-fact", "world_fact", mode
            )
            if mode == "defer":
                row["disposition"]["note"] = "waiting for chapter 3 reveal"
            contract.validate_confluence(confluence([row]))

    def test_hard_class_requires_resolver_receipt(self):
        row = conflict(
            f"conflict-{CAMPAIGN}-{TL_M}-elise-hp",
            "stat_value",
            "choose_left",
        )
        row["disposition"]["resolver_receipt"] = None
        with pytest.raises(contract.ConfluenceError):
            contract.validate_confluence(confluence([row]))

    @pytest.mark.parametrize("cls", contract.NON_DUPLICABLE_CONFLICT_CLASSES)
    @pytest.mark.parametrize("mode", ["combine", "duplicate"])
    def test_non_duplicable_never_combined_or_duplicated(self, cls, mode):
        row = conflict(f"conflict-{CAMPAIGN}-{TL_M}-{cls}", cls, mode)
        with pytest.raises(contract.ConfluenceError):
            contract.validate_confluence(confluence([row]))

    def test_non_duplicable_survivor_modes_accepted(self):
        for mode in ("choose_left", "choose_right", "paradox", "sacrifice", "defer", "transform"):
            row = conflict(
                f"conflict-{CAMPAIGN}-{TL_M}-death", "death", mode
            )
            if mode == "defer":
                row["disposition"]["note"] = "pending chapter reveal"
            contract.validate_confluence(confluence([row]))

    def test_deterministic_side_ordering(self):
        row = self._conflict()
        row["left"], row["right"] = row["right"], row["left"]
        with pytest.raises(contract.ConfluenceError):
            contract.validate_confluence(confluence([row]))

    def test_merged_timeline_is_third(self):
        with pytest.raises(contract.ConfluenceError):
            contract.validate_confluence(confluence(parents=[TL_A, TL_M]))

    def test_conflict_id_nests_under_confluence(self):
        row = conflict(f"conflict-{CAMPAIGN}-elsewhere-elise-hp", "stat_value", "choose_left")
        with pytest.raises(contract.SemanticIdError):
            contract.validate_confluence(confluence([row]))

    def test_unknown_class_rejected(self):
        row = self._conflict()
        row["class"] = "vibes"
        with pytest.raises(contract.ClosedEnumError):
            contract.validate_confluence(confluence([row]))

    def test_conflict_id_for_helper(self):
        assert (
            contract.conflict_id_for(f"confluence-{CAMPAIGN}-{TL_M}", "elise-hp")
            == f"conflict-{CAMPAIGN}-{TL_M}-elise-hp"
        )

    def test_duplicate_conflict_ids_rejected(self):
        row = self._conflict()
        with pytest.raises(contract.ConfluenceError):
            contract.validate_confluence(confluence([row, dict(row)]))


# ---------------------------------------------------------------------------
# Cross-timeline transfer
# ---------------------------------------------------------------------------


class TestTransfer:
    def test_valid_transfer(self):
        rec = transfer(
            [
                {
                    "source_assertion": f"mem-{CAMPAIGN}-tlb-sign",
                    "target_assertion": f"mem-{CAMPAIGN}-tla-sign-echo",
                    "state": "cross_timeline_echo",
                    "credibility": 0.6,
                    "distortion": "remembers the sign in blue not red",
                    "privacy": "player_safe",
                }
            ]
        )
        contract.validate_transfer(rec)

    def test_same_timeline_rejected(self):
        rec = transfer(
            [
                {
                    "source_assertion": f"mem-{CAMPAIGN}-tlb-sign",
                    "target_assertion": f"mem-{CAMPAIGN}-tla-sign-echo",
                    "state": "cross_timeline_echo",
                    "credibility": 0.6,
                    "distortion": None,
                    "privacy": "player_safe",
                }
            ],
            to_timeline=TL_B,
        )
        with pytest.raises(contract.TransferError):
            contract.validate_transfer(rec)

    def test_credibility_bounds(self):
        for bad in (-0.1, 1.5, True, "high"):
            with pytest.raises(contract.TransferError):
                contract.validate_transfer(
                    transfer(
                        [
                            {
                                "source_assertion": f"mem-{CAMPAIGN}-tlb-sign",
                                "target_assertion": f"mem-{CAMPAIGN}-tla-sign-echo",
                                "state": "cross_timeline_echo",
                                "credibility": bad,
                                "distortion": None,
                                "privacy": "player_safe",
                            }
                        ]
                    )
                )

    def test_target_must_be_new_assertion(self):
        with pytest.raises(contract.TransferError):
            contract.validate_transfer(
                transfer(
                    [
                        {
                            "source_assertion": f"mem-{CAMPAIGN}-same",
                            "target_assertion": f"mem-{CAMPAIGN}-same",
                            "state": "cross_timeline_echo",
                            "credibility": 0.5,
                            "distortion": None,
                            "privacy": "player_safe",
                        }
                    ]
                )
            )

    def test_transfer_links_bind_both_sides(self):
        tid = f"transfer-{CAMPAIGN}-{TL_B}-to-{TL_A}"
        source = assertion(
            f"mem-{CAMPAIGN}-tlb-sign", timeline_id=TL_B, state="cross_timeline_echo"
        )
        target_ok = assertion(
            f"mem-{CAMPAIGN}-tla-sign-echo",
            timeline_id=TL_A,
            state="cross_timeline_echo",
            transfer_ref=tid,
        )
        entries = [
            {
                "source_assertion": f"mem-{CAMPAIGN}-tlb-sign",
                "target_assertion": f"mem-{CAMPAIGN}-tla-sign-echo",
                "state": "cross_timeline_echo",
                "credibility": 0.6,
                "distortion": None,
                "privacy": "player_safe",
            }
        ]
        contract.validate_transfer_links(transfer(entries), [source, target_ok])
        # missing back-ref
        target_no_ref = assertion(
            f"mem-{CAMPAIGN}-tla-sign-echo", timeline_id=TL_A, state="cross_timeline_echo"
        )
        with pytest.raises(contract.TransferError):
            contract.validate_transfer_links(transfer(entries), [source, target_no_ref])
        # wrong timeline placement
        target_wrong_tl = assertion(
            f"mem-{CAMPAIGN}-tla-sign-echo",
            timeline_id=TL_B,
            state="cross_timeline_echo",
            transfer_ref=tid,
        )
        with pytest.raises(contract.TransferError):
            contract.validate_transfer_links(transfer(entries), [source, target_wrong_tl])


# ---------------------------------------------------------------------------
# Backlog
# ---------------------------------------------------------------------------


class TestBacklog:
    def test_valid_backlog(self):
        contract.validate_backlog_record(backlog())
        contract.validate_backlog_record(backlog(status="recovered"))

    def test_closed_status_and_reason(self):
        with pytest.raises(contract.ClosedEnumError):
            contract.validate_backlog_record(backlog(status="done"))
        with pytest.raises(contract.ClosedEnumError):
            contract.validate_backlog_record(backlog(reason="kp_lazy"))

    def test_backlog_id_for(self):
        assert (
            contract.backlog_id_for(CAMPAIGN, 5, "semantic-pass")
            == f"backlog-{CAMPAIGN}-t5-semantic-pass"
        )


# ---------------------------------------------------------------------------
# Identity resolution (never conflate same names)
# ---------------------------------------------------------------------------


class TestIdentityResolution:
    def test_same_name_two_ids_is_ambiguity_never_auto_pick(self):
        entities = [
            entity("entity-person-walter-corbbit", display_name="Walter"),
            entity("entity-person-walter-keegan", display_name="Walter"),
        ]
        matches = contract.resolve_entity_ids(entities, campaign_id=CAMPAIGN, name="Walter")
        assert len(matches) == 2
        with pytest.raises(contract.IdentityError):
            contract.require_unique_id(matches, kind="entity", name="Walter")

    def test_alias_resolution_exact_only(self):
        entities = [
            entity("entity-person-walter-corbitt", aliases=["the landlord"])
        ]
        assert contract.resolve_entity_ids(
            entities, campaign_id=CAMPAIGN, name="the landlord"
        ) == ["entity-person-walter-corbitt"]
        assert contract.resolve_entity_ids(
            entities, campaign_id=CAMPAIGN, name="the landlor"
        ) == []

    def test_other_campaign_entities_invisible(self):
        entities = [
            entity("entity-person-walter-corbitt", campaign_id="other-camp")
        ]
        assert (
            contract.resolve_entity_ids(entities, campaign_id=CAMPAIGN, name="Entity Name")
            == []
        )

    def test_bound_cross_campaign_entity_visible(self):
        entities = [
            entity(
                "entity-item-mythos-tome",
                campaign_id=None,
                same_entity_as=["entity-item-mythos-tome-eu"],
            )
        ]
        assert contract.resolve_entity_ids(
            entities, campaign_id=CAMPAIGN, name="Entity Name"
        ) == ["entity-item-mythos-tome"]

    def test_subject_resolution_scoped(self):
        subjects = [
            subject("world", WORLD_SUBJECT, display_name="World"),
            subject("player", PLAYER_SUBJECT, display_name="Thomas"),
        ]
        assert contract.resolve_subject_ids(
            subjects, campaign_id=CAMPAIGN, name="Thomas"
        ) == [PLAYER_SUBJECT]
        # cross-campaign player is visible from any campaign
        assert contract.resolve_subject_ids(
            subjects, campaign_id="another-campaign", name="Thomas"
        ) == [PLAYER_SUBJECT]
        # campaign-scoped world subject is not
        assert (
            contract.resolve_subject_ids(
                subjects, campaign_id="another-campaign", name="World"
            )
            == []
        )


# ---------------------------------------------------------------------------
# Determinism
# ---------------------------------------------------------------------------


class TestDeterminism:
    def test_canonical_json_order_insensitive(self):
        a = assertion(f"mem-{CAMPAIGN}-det")
        b = dict(reversed(list(a.items())))
        assert contract.canonical_json(a) == contract.canonical_json(b)
        assert contract.canonical_json(a) == json.dumps(
            a, sort_keys=True, separators=(",", ":"), ensure_ascii=False
        )

    def test_record_digest_stable_and_content_sensitive(self):
        a = assertion(f"mem-{CAMPAIGN}-det")
        assert contract.record_digest(a) == contract.record_digest(dict(a))
        changed = assertion(f"mem-{CAMPAIGN}-det", state="distorted")
        assert contract.record_digest(a) != contract.record_digest(changed)

    def test_semantic_id_grammar(self):
        for good in ("mem-xc-pref-1", f"mem-{CAMPAIGN}-a-b", "tl-main"):
            assert contract.SEMANTIC_ID_RE.match(good), good
        for bad in ("Mem-Upper", "mem", "mem-", "-mem-a", "mem-a ", "mem-a\nb"):
            assert not contract.SEMANTIC_ID_RE.match(bad), bad

    def test_records_carry_no_wall_clock_fields(self):
        # frozen field sets exclude any time-of-day / date string fields:
        # recorded time is projected from source_commit by code, so replays
        # are byte-identical.
        for fields in (
            contract.ASSERTION_FIELDS,
            contract.EPISODE_FIELDS,
            contract.TIMELINE_FIELDS,
            contract.TRANSFER_FIELDS,
            contract.BACKLOG_FIELDS,
        ):
            assert not any(
                name in ("recorded_at", "created_at", "timestamp", "wall_time")
                for name in fields
            )

    def test_schema_generation_string(self):
        assert contract.SCHEMA_GENERATION == "temporal-memory-1"
        assert contract.CONTRACT_SCHEMA_VERSION == 1


# ---------------------------------------------------------------------------
# Summary compression audit trail
# ---------------------------------------------------------------------------


class TestSummaryAudit:
    def test_summary_requires_covers_commits(self):
        with pytest.raises(contract.MissingFieldError):
            contract.validate_assertion(
                assertion(f"mem-{CAMPAIGN}-chapter1", kind="summary", knowers=[])
            )
        contract.validate_assertion(
            assertion(
                f"mem-{CAMPAIGN}-chapter1",
                kind="summary",
                subject_id=WORLD_SUBJECT,
                knowers=[],
                covers_commits=[SHA, SHA2],
            )
        )

    def test_covers_commits_reserved_for_summary(self):
        with pytest.raises(contract.TemporalMemoryContractError):
            contract.validate_assertion(
                assertion(f"mem-{CAMPAIGN}-not-summary", covers_commits=[SHA])
            )

    def test_covers_commits_must_be_shas(self):
        with pytest.raises(contract.ProvenanceError):
            contract.validate_assertion(
                assertion(
                    f"mem-{CAMPAIGN}-chapter1",
                    kind="summary",
                    subject_id=WORLD_SUBJECT,
                    knowers=[],
                    covers_commits=["HEAD~3"],
                )
            )


# ---------------------------------------------------------------------------
# Sanctioned same-id rewrites (immutable replay law)
# ---------------------------------------------------------------------------


class TestSanctionedSupersession:
    def test_exact_plan_supersession_delta_is_sanctioned(self):
        prior = assertion(f"mem-{CAMPAIGN}-orig")
        closed = contract.plan_supersession(
            prior, f"mem-{CAMPAIGN}-orig-v2", valid_until_turn=9
        )
        assert contract.is_sanctioned_supersession(prior, closed)

    def test_byte_identical_replay_is_not_a_close(self):
        prior = assertion(f"mem-{CAMPAIGN}-orig")
        # identical replay is the caller's digest path, never a delta
        assert not contract.is_sanctioned_supersession(prior, dict(prior))

    def test_tampered_close_fields_rejected(self):
        prior = assertion(f"mem-{CAMPAIGN}-orig")
        closed = contract.plan_supersession(
            prior, f"mem-{CAMPAIGN}-orig-v2", valid_until_turn=9
        )
        for field, value in (
            ("privacy", "keeper_only"),
            ("state", "distorted"),
            ("knowers", [INV_SUBJECT, KEEPER_SUBJECT]),
            ("statement", "rewritten statement"),
            ("entities", ["entity-person-someone"]),
            ("source_receipts", ["receipt-forged"]),
            ("source_turn", 99),
        ):
            tampered = dict(closed)
            tampered[field] = value
            assert not contract.is_sanctioned_supersession(prior, tampered), field

    def test_closed_prior_is_never_rewritable(self):
        prior = assertion(f"mem-{CAMPAIGN}-orig")
        closed = contract.plan_supersession(
            prior, f"mem-{CAMPAIGN}-orig-v2", valid_until_turn=9
        )
        reclosed = contract.plan_supersession(
            closed, f"mem-{CAMPAIGN}-orig-v3", valid_until_turn=12
        )
        assert not contract.is_sanctioned_supersession(closed, reclosed)
        # byte-identical replay of a closed record is not a delta either
        assert not contract.is_sanctioned_supersession(closed, dict(closed))

    def test_mismatched_ids_rejected(self):
        assert not contract.is_sanctioned_supersession(
            assertion(f"mem-{CAMPAIGN}-a"), assertion(f"mem-{CAMPAIGN}-b")
        )

    def test_delta_fields_are_exactly_the_close_pair(self):
        assert contract.SUPERSESSION_DELTA_FIELDS == (
            "valid_until_turn",
            "superseded_by",
        )


class TestSanctionedIdentityExtension:
    def test_identical_entity_replay_sanctioned(self):
        rec = entity("entity-person-walter-corbitt")
        assert contract.is_sanctioned_identity_extension(
            rec, dict(rec), record_kind="entity"
        )

    def test_entity_alias_append_sanctioned(self):
        prior = entity("entity-person-walter-corbitt", aliases=["the landlord"])
        extended = entity(
            "entity-person-walter-corbitt",
            aliases=["the landlord", "the ghost landlord"],
        )
        assert contract.is_sanctioned_identity_extension(
            prior, extended, record_kind="entity"
        )

    def test_entity_alias_removal_and_reorder_rejected(self):
        prior = entity("entity-person-walter-corbitt", aliases=["a", "b"])
        assert not contract.is_sanctioned_identity_extension(
            prior,
            entity("entity-person-walter-corbitt", aliases=["a"]),
            record_kind="entity",
        )
        assert not contract.is_sanctioned_identity_extension(
            prior,
            entity("entity-person-walter-corbitt", aliases=["b", "a"]),
            record_kind="entity",
        )
        assert not contract.is_sanctioned_identity_extension(
            prior,
            entity("entity-person-walter-corbitt", aliases=["a", "b", "a"]),
            record_kind="entity",
        )

    def test_entity_identity_fields_immutable(self):
        prior = entity("entity-person-walter-corbitt")
        for field, value in (
            ("display_name", "Someone Else"),
            ("campaign_id", "other-camp"),
            ("subject_ref", "subject-npc-other-x"),
        ):
            tampered = dict(prior)
            tampered[field] = value
            assert not contract.is_sanctioned_identity_extension(
                prior, tampered, record_kind="entity"
            ), field

    def test_entity_equivalence_edge_append_sanctioned(self):
        prior = entity("entity-item-mythos-tome", campaign_id=None, same_entity_as=["entity-item-mythos-tome-eu"])
        extended = entity(
            "entity-item-mythos-tome",
            campaign_id=None,
            same_entity_as=["entity-item-mythos-tome-eu", "entity-item-mythos-tome-eu2"],
        )
        assert contract.is_sanctioned_identity_extension(
            prior, extended, record_kind="entity"
        )

    def test_subject_identity_and_edges(self):
        prior = subject("player", PLAYER_SUBJECT)
        assert contract.is_sanctioned_identity_extension(
            prior, dict(prior), record_kind="subject"
        )
        assert contract.is_sanctioned_identity_extension(
            prior,
            subject("player", PLAYER_SUBJECT, same_subject_as=["subject-player-thomas-b"]),
            record_kind="subject",
        )
        assert not contract.is_sanctioned_identity_extension(
            prior,
            subject("player", PLAYER_SUBJECT, display_name="Renamed"),
            record_kind="subject",
        )
        assert not contract.is_sanctioned_identity_extension(
            prior,
            subject("player", PLAYER_SUBJECT, campaign_id=CAMPAIGN),
            record_kind="subject",
        )

    def test_unknown_record_kind_raises(self):
        rec = entity("entity-person-walter-corbitt")
        with pytest.raises(contract.TemporalMemoryContractError):
            contract.is_sanctioned_identity_extension(
                rec, dict(rec), record_kind="memory_card"
            )

    def test_mismatched_ids_rejected(self):
        assert not contract.is_sanctioned_identity_extension(
            entity("entity-person-a"),
            entity("entity-person-b"),
            record_kind="entity",
        )
