"""Standing-defense host requests still use the real TS resolve transaction and receipts."""
from concurrent.futures import ThreadPoolExecutor

from conftest import CAMPAIGN, RpcClient, narrate, open_turn
from test_rules_families import resolve, walk_to_confrontation


def pending_attack(client):
    open_turn(client, "I confront Corbitt.")
    n = walk_to_confrontation(client)
    resolve(client, f"t1-c{n}", intent="combat", goal="Shoot", method="Fire", target="Walter Corbitt", weapon=".38 Revolver")
    resolve(client, f"t1-c{n+1}", intent="combat", goal="Stand", method="", actor="Walter Corbitt", defense="none")
    strike = resolve(client, f"t1-c{n+2}", intent="combat", goal="Attack", method="", actor="Walter Corbitt", target="thomas-hayes")
    return strike, n + 3


def defense_request(strike, call_id):
    pending = strike["session"]["pending_defense"]
    return {"campaign": CAMPAIGN, "call_id": call_id,
            "action": {"intent": "combat", "actor": pending["actor"], "decision": "combat:defend", "defense": "dodge", "goal": "Defend", "method": "Standing preference"},
            "_standing_defense": {key: pending[key] for key in ("actor", "attack_command_id", "revision")}}


def test_standing_defense_is_live_guarded_and_replay_safe(tmp_path):
    client = RpcClient(tmp_path / "ws", env={"COC_KERNEL_SEED": "9"})
    try:
        strike, n = pending_attack(client)
        payload = defense_request(strike, f"t1-c{n}")
        stale = {**payload, "_standing_defense": {**payload["_standing_defense"], "revision": -1}}
        refused = client.call("table.resolve", stale)
        assert not refused["ok"] and refused["error"]["details"]["reason"] == "stale_defense"
        settled = client.ok("table.resolve", payload)
        assert settled["outcome"]["status"] == "resolved"
        assert settled["session"]["pending_defense"] is None
        assert settled["receipts"]
        assert client.ok("table.resolve", payload) == {**settled, "replayed": True}
        again = client.call("table.resolve", {**payload, "call_id": f"t1-c{n+1}"})
        assert not again["ok"]
        delivered = narrate(client, f"t1-c{n+1}", "The knife sweeps past.")
        assert any(row.get("skill") == "Dodge" for row in delivered["mechanics"])
    finally:
        client.close()


def test_two_kernel_clients_and_lost_response_recover_one_defense(tmp_path):
    workspace = tmp_path / "ws"
    first = RpcClient(workspace, env={"COC_KERNEL_SEED": "9"})
    second = None
    try:
        strike, n = pending_attack(first)
        payload = defense_request(strike, f"t1-c{n}")
        second = RpcClient(workspace, env={"COC_KERNEL_SEED": "9"})
        opened = second.table("open")
        assert opened["session"]["pending_defense"]["attack_command_id"] == payload["_standing_defense"]["attack_command_id"]
        with ThreadPoolExecutor(max_workers=2) as pool:
            attempts = [pool.submit(client.ok, "table.resolve", payload) for client in (first, second)]
            results = [attempt.result() for attempt in attempts]
        assert sum(result.get("replayed") is True for result in results) == 1
        assert results[0]["receipts"] == results[1]["receipts"]
        receipt_ids = [receipt["id"] for receipt in first.table("status")["receipts"]]
        for receipt in results[0]["receipts"]:
            assert receipt_ids.count(receipt) == 1
        # Discard the acknowledged response, restart the caller, and retry its durable identity.
        second.close()
        second = RpcClient(workspace, env={"COC_KERNEL_SEED": "9"})
        recovered = second.ok("table.resolve", payload)
        assert recovered["replayed"] is True
        assert recovered["receipts"] == results[0]["receipts"]
        assert second.table("status")["receipts"] == first.table("status")["receipts"]
        stale = second.call("table.resolve", {**payload, "call_id": f"t1-c{n+1}"})
        assert not stale["ok"] and stale["error"]["details"]["reason"] == "stale_defense"
    finally:
        first.close()
        if second is not None:
            second.close()


def test_legacy_asked_defense_waits_for_open_turn_then_retires_old_choice(tmp_path):
    client = RpcClient(tmp_path / "ws", env={"COC_KERNEL_SEED": "9"})
    try:
        strike, n = pending_attack(client)
        client.table("ask", call_id=f"t1-c{n}", kind="mechanics", text="The knife approaches.", options=["dodge", "fight_back"], binds=strike["pending_choice"]["name"])
        payload = defense_request(strike, f"t1-c{n+1}")
        refused = client.call("table.resolve", payload)
        assert not refused["ok"] and refused["error"]["code"] == "turn_state"
        opened = client.table("player_input", text="Keep going.")
        assert opened["capsule"]["where"]["session"]["pending_defense"]["attack_command_id"] == payload["_standing_defense"]["attack_command_id"]
        settled = client.ok("table.resolve", {**payload, "call_id": "t2-c1"})
        assert settled["pending_choice"] is None
        assert client.table("view")["pending_choice"] is None
    finally:
        client.close()
