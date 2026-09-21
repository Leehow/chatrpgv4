"""T12 read-only apply options and fail-closed fulfillment metadata over TypeScript RPC.

Fixtures verify protocol and storage behavior only. They do not authorize effects or claim gameplay.
"""

from __future__ import annotations

import hashlib

from conftest import CAMPAIGN, campaign_dir, git_log, narrate, open_turn


def options(client):
    return client.ok("table.apply.options", {"campaign": CAMPAIGN})


def fingerprint(client):
    root = campaign_dir(client.workspace)
    return {
        "files": {path.relative_to(root).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
                  for path in root.rglob("*") if path.is_file()},
        "git": git_log(client.workspace),
    }


def test_apply_options_is_read_only_unique_and_derived_from_current_graph_state(kernel):
    open_turn(kernel)
    before = fingerprint(kernel)
    snapshot = options(kernel)

    assert fingerprint(kernel) == before
    assert snapshot["version"] == 1
    assert snapshot["revision"] and snapshot["world_revision"]
    aliases = [row["alias"] for row in snapshot["candidates"]]
    assert aliases == [f"effect:{index}" for index in range(len(aliases))]
    assert len(aliases) == len(set(aliases))
    effects = [row["effect"] for row in snapshot["candidates"]]
    assert all(set(effect) in ({"kind", "clue"}, {"kind", "to"}) for effect in effects)
    assert {effect["kind"] for effect in effects} == {"clue", "move"}
    assert {effect["clue"] for effect in effects if effect["kind"] == "clue"} == {
        "knott-commission", "knott-research-leads", "knott-macario-summary", "knott-keys",
    }
    assert "hall-of-records" in {effect["to"] for effect in effects if effect["kind"] == "move"}
    assert all(row["description"]["authority"] in
               {"authored_candidate_not_discovered", "available_route_not_player_choice"}
               for row in snapshot["candidates"])
    assert snapshot["context"] == {**snapshot["context"], "scene": "Knott's Office",
                                    "pending_choice": None, "session": None,
                                    "present": ["Steven Knott"], "current_receipts": []}
    assert snapshot["context"]["coverage"]["effect_families"] == ["clue", "move"]


def test_apply_options_removes_discovered_clue_and_reports_current_receipt_without_writing(kernel):
    open_turn(kernel)
    applied = kernel.table("apply", call_id="t1-c1", effects=[{"kind": "clue", "clue": "knott-commission"}])
    before = fingerprint(kernel)

    snapshot = options(kernel)

    assert fingerprint(kernel) == before
    assert "knott-commission" not in {row["effect"].get("clue") for row in snapshot["candidates"]}
    assert snapshot["context"]["current_receipts"] == [{"kind": "clue", "clue": "knott-commission", "from": None}]
    assert snapshot["world_revision"]
    assert applied["receipts"]


def test_apply_options_rejects_foreign_closed_and_extra_requests(kernel):
    open_turn(kernel)
    assert kernel.err("table.apply.options", {"campaign": "other"})["code"] == "campaign_not_found"
    assert kernel.err("table.apply.options", {})["code"] == "invalid_params"
    assert kernel.err("table.apply.options", {"campaign": CAMPAIGN, "extra": True})["code"] == "invalid_params"
    narrate(kernel, "t1-c1", "The turn closes without an effect.")
    assert kernel.err("table.apply.options", {"campaign": CAMPAIGN})["code"] == "campaign_not_ready"


def test_existing_apply_batch_remains_atomic_and_exactly_replayable(kernel):
    open_turn(kernel)
    before = fingerprint(kernel)
    refused = kernel.table_err("apply", call_id="t1-c1", effects=[
        {"kind": "time", "minutes": 5}, {"kind": "clue", "clue": "not-an-authored-clue"},
    ])
    assert refused["code"] in {"invalid_params", "unknown_entity"}
    assert fingerprint(kernel) == before

    result = kernel.table("apply", call_id="t1-c1", effects=[{"kind": "time", "minutes": 5}])
    written = fingerprint(kernel)
    replay = kernel.table("apply", call_id="t1-c1", effects=[{"kind": "time", "minutes": 5}])
    assert replay == {**result, "replayed": True}
    assert fingerprint(kernel) == written


def test_fulfillment_metadata_is_never_silently_ignored_or_allowed_to_apply_effects(kernel):
    open_turn(kernel)
    before = fingerprint(kernel)
    for ordinal, fulfillment in enumerate((
        {"kind": "unknown-binding", "candidate": "effect:0"},
        {"kind": "clue", "candidate": "effect:0", "claim": "not yet validated"},
    ), start=1):
        error = kernel.err("table.apply", {"campaign": CAMPAIGN, "call_id": f"t1-c{ordinal}",
            "effects": [{"kind": "clue", "clue": "knott-commission"}], "_fulfillments": [fulfillment]})
        assert error["code"] == "needs"
        assert error["details"]["reason"] == "unsupported_terms"
        assert fingerprint(kernel) == before

    # Refused private metadata did not consume the public call identity or discover the clue.
    accepted = kernel.table("apply", call_id="t1-c1", effects=[{"kind": "clue", "clue": "knott-commission"}])
    assert accepted["receipts"]
