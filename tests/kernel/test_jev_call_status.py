"""T05 host-only call reconciliation over the current TypeScript kernel RPC."""

from __future__ import annotations

import hashlib

from conftest import campaign_dir, git_log, narrate, open_turn


def _digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest() if path.exists() else None


def _state_fingerprint(client):
    root = campaign_dir(client.workspace)
    return {
        name: _digest(root / name)
        for name in ("world.json", "turn.json", "events.jsonl", "transcript.jsonl", "turns/0001.json")
    } | {"git": git_log(client.workspace)}


def _status(client, call_id, request, **extra):
    return client.ok(
        "table.call_status",
        {"campaign": "c1", "call_id": call_id, "request": request, **extra},
    )


def test_call_status_returns_exact_settled_resolve_and_apply_without_new_writes(kernel):
    open_turn(kernel)
    resolve_request = {
        "campaign": "c1",
        "call_id": "t1-c1",
        "action": {
            "intent": "investigate",
            "goal": "check the room",
            "method": "look for a hidden object",
            "skill": "Spot Hidden",
        },
    }
    resolved = kernel.ok("table.resolve", resolve_request)
    apply_request = {
        "campaign": "c1",
        "call_id": "t1-c2",
        "effects": [{"kind": "time", "minutes": 5}],
    }
    applied = kernel.ok("table.apply", apply_request)
    before = _state_fingerprint(kernel)

    resolve_status = _status(kernel, "t1-c1", resolve_request)
    apply_status = _status(kernel, "t1-c2", apply_request)

    assert resolve_status["status"] == "settled"
    assert resolve_status["call_turn"] == 1
    assert resolve_status["active_turn"] == 1
    assert resolve_status["result"]["replayed"] is True
    assert resolve_status["result"]["receipt"] == resolved["receipt"]
    assert apply_status["status"] == "settled"
    assert apply_status["result"]["replayed"] is True
    assert apply_status["result"]["receipts"] == applied["receipts"]
    assert _state_fingerprint(kernel) == before


def test_call_status_rejects_digest_conflict_and_malformed_bound_requests(kernel):
    open_turn(kernel)
    request = {
        "campaign": "c1",
        "call_id": "t1-c1",
        "action": {"intent": "investigate", "goal": "check", "method": "look", "skill": "Spot Hidden"},
    }
    kernel.ok("table.resolve", request)

    conflict = kernel.err(
        "table.call_status",
        {
            "campaign": "c1",
            "call_id": "t1-c1",
            "request": {**request, "action": {**request["action"], "method": "different"}},
        },
    )
    assert conflict["code"] == "idempotency_conflict"
    for params in (
        {"campaign": "c1", "call_id": "t1-c1"},
        {"campaign": "c1", "call_id": "t1-c1", "request": {**request, "campaign": "other"}},
        {"campaign": "c1", "call_id": "t1-c1", "request": {**request, "call_id": "t1-c2"}},
        {"campaign": "c1", "call_id": "not-a-call", "request": request},
    ):
        assert kernel.err("table.call_status", params)["code"] == "invalid_params"


def test_call_status_keeps_historical_settlement_after_turn_close_and_reports_old_absence(kernel):
    open_turn(kernel)
    request = {
        "campaign": "c1",
        "call_id": "t1-c1",
        "action": {"intent": "investigate", "goal": "check", "method": "look", "skill": "Spot Hidden"},
    }
    settled = kernel.ok("table.resolve", request)
    narrate(kernel, "t1-c2", "The search leaves the room unchanged.")
    kernel.table("player_input", text="I continue.")

    historical = _status(kernel, "t1-c1", request)
    absent_old = _status(
        kernel,
        "t1-c99",
        {"campaign": "c1", "call_id": "t1-c99", "action": {"intent": "idle"}},
    )
    assert historical["status"] == "settled"
    assert historical["active_turn"] == 2
    assert historical["call_turn"] == 1
    assert historical["result"]["receipt"] == settled["receipt"]
    assert absent_old == {
        "status": "absent",
        "call_id": "t1-c99",
        "call_turn": 1,
        "active_turn": 2,
        "scope": historical["scope"],
    }


def test_call_status_absence_and_active_scope_mismatch_are_explicit(kernel):
    open_turn(kernel)
    request = {
        "campaign": "c1",
        "call_id": "t1-c77",
        "action": {"intent": "idle"},
    }
    absent = _status(kernel, "t1-c77", request)
    assert absent["status"] == "absent"
    assert absent["call_turn"] == absent["active_turn"] == 1
    assert absent["scope"]["worldline"] == "main"
    assert absent["scope"]["loop"] == 0

    mismatch = kernel.err(
        "table.call_status",
        {
            "campaign": "c1",
            "call_id": "t1-c77",
            "request": request,
            "scope": {"worldline": "foreign", "loop": 0},
        },
    )
    assert mismatch["code"] == "turn_state"
    assert mismatch["details"]["reason"] == "operation_scope_stale"


def test_owned_apply_returns_exact_receipt_bound_world_revision(kernel):
    open_turn(kernel)
    before_context = kernel.ok('table.capsule', {'campaign': 'c1'})['_context']
    before = before_context['world_revision']
    before_task = before_context['task_world_revision']
    request = {'campaign': 'c1', 'call_id': 't1-c1', '_task_read_set': True,
               'effects': [{'kind': 'time', 'minutes': 5}]}
    result = kernel.ok('table.apply', request)
    after_context = kernel.ok('table.capsule', {'campaign': 'c1'})['_context']
    after = after_context['world_revision']
    after_task = after_context['task_world_revision']
    advance = result['_task_advance']
    assert advance['before'] == before
    assert advance['after'] == after
    assert advance['before'] != advance['after']
    assert advance['task_before'] == before_task
    assert advance['task_after'] == after_task
    assert advance['task_before'] != advance['task_after']
    assert advance['receiptIds'] == result['receipts']
    assert advance['operationId'] == 't1-c1'
    assert advance['campaign'] == 'c1'
    assert advance['turn'] == 1
    replay = kernel.ok('table.apply', request)
    assert replay['_task_advance'] == advance
    replay_context = kernel.ok('table.capsule', {'campaign': 'c1'})['_context']
    assert replay_context['world_revision'] == after
    assert replay_context['task_world_revision'] == after_task
