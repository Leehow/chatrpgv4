"""Slice 2, 12.1: the canonical events one campaign emits through the RPC seam (the
twelve of slice 2 plus §18's three; setup, handout and item have their own tests), and
the ones slice 2 added anchored where the contract says."""

from conftest import RpcClient, ask, campaign_dir, narrate, open_turn, read_jsonl
from test_rules_families import resolve, walk_to_confrontation

EMITTED = {
    "turn-started", "player-declared", "roll-resolved", "scene-moved", "clue-discovered", "time-advanced",
    "resource-changed", "decision-settled", "session-changed", "choice-asked", "memory-written", "turn-finalized",
    # §18 (#27)
    "flag-set", "note-written", "ruling-made",
}


def test_canonical_events_end_to_end(tmp_path):
    client = RpcClient(tmp_path / "ws", env={"COC_KERNEL_SEED": "9"})
    try:
        open_turn(client, "我举枪对准棺材里的东西。")
        client.table("apply", call_id="t1-c1", effects=[
            {"kind": "clue", "clue": "knott-keys"},
            {"kind": "time", "minutes": 5},
            {"kind": "damage", "dice": "1D3", "why": "被门夹了"},
            {"kind": "flag", "name": "door-open"},
            {"kind": "note", "name": "the door", "text": "say what the door did"},
            {"kind": "ruling", "name": "doors", "statement": "doors bite for 1D3", "anchor": {"family": "core-check"}},
        ])
        n = walk_to_confrontation(client, start=2)
        attack = resolve(client, f"t1-c{n}", intent="combat", goal="朝科比特开枪", method="用左轮射击",
                         target="Walter Corbitt", weapon=".38 Revolver")
        assert attack["session"]["kind"] == "combat"
        narrated = narrate(client, f"t1-c{n + 1}", "枪响了。")
        client.table("player_input", text="我闪开。")
        ask(client, "t2-c1", "你要怎么做？", ["闪避", "反击"])
        job = client.ok("memory.job", {"campaign": "c1", "turn": 1})
        client.ok("memory.submit", {"campaign": "c1", "job_id": job["job_id"],
                                    "candidates": [{"kind": "world_event", "subject": "world", "statement": "枪响了。"}]})

        events = read_jsonl(campaign_dir(client.workspace) / "events.jsonl")
        assert {e["type"] for e in events} == EMITTED
        assert [e["type"] for e in events if e.get("call_id") == "t1-c1"][-3:] == ["flag-set", "note-written", "ruling-made"]
        assert [e["seq"] for e in events] == list(range(1, len(events) + 1))

        session = [e for e in events if e["type"] == "session-changed"]
        assert session and session[0]["turn"] == 1
        assert session[0]["receipt"].startswith("session:combat-start-t1-c")
        assert session[0]["data"] == {**session[0]["data"], "family": "combat", "transition": "start"}
        assert session[0]["call_id"] == f"t1-c{n}"

        asked = [e for e in events if e["type"] == "choice-asked"][0]
        assert asked["turn"] == 2 and asked["call_id"] == "t2-c1"
        assert asked["data"] == {"name": asked["data"]["name"], "prompt": "你要怎么做？", "options": ["闪避", "反击"],
                                 "binds": None}
        assert asked["data"]["name"].startswith("ask-") and asked["data"]["name"].endswith("-t2")

        written = [e for e in events if e["type"] == "memory-written"][0]
        assert written["turn"] == 1
        assert written["data"] == {"job_id": "extract:c1:t1", "turn": 1, "candidates": 1, "superseded": 0}

        finalized = [e for e in events if e["type"] == "turn-finalized" and e["turn"] == 1][0]
        assert finalized["receipt"] == "turn:1" and narrated["commit"]
    finally:
        client.close()


def test_travel_advances_the_clock_as_an_event(kernel):
    open_turn(kernel)
    kernel.table("apply", call_id="t1-c1", effects=[{"kind": "move", "to": "hall-of-records", "travel_minutes": 20}])
    events = read_jsonl(campaign_dir(kernel.workspace) / "events.jsonl")[-2:]
    assert [e["type"] for e in events] == ["scene-moved", "time-advanced"]
    assert events[1]["receipt"] == "move:hall-of-records-t1-c1"
    assert events[1]["data"] == {"minutes": 20, "why": "travel", "clock": {"minutes": 20}}
    # A zero-minute move is a move only.
    kernel.table("apply", call_id="t1-c2", effects=[{"kind": "move", "to": "central-library", "travel_minutes": 0}])
    assert read_jsonl(campaign_dir(kernel.workspace) / "events.jsonl")[-1]["type"] == "scene-moved"
