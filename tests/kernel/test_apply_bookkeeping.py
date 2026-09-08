"""Slice 8 (#27, contract §18): `apply flag` / `note` / `ruling` and `look focus=session`,
all through the RPC seam -- what each effect writes, who reads it, and the identifier-only
matching of rulings."""

import json
import sys

from conftest import (CAMPAIGN, KERNEL_DIR, OPENING_SCENE, RpcClient, campaign_dir, narrate, open_turn, read_json,
                      read_jsonl)
from test_rules_families import resolve, walk_to_confrontation
from test_sessions import attack_and_npc_defense

if str(KERNEL_DIR) not in sys.path:
    sys.path.insert(0, str(KERNEL_DIR))

from coc.events import EVENT_TYPES  # noqa: E402
from coc.module_graph import condition_status  # noqa: E402

TWENTY_FOUR = {
    "turn-started", "player-declared", "roll-resolved", "scene-moved", "clue-discovered", "time-advanced",
    "turn-finalized", "resource-changed", "decision-settled", "session-changed", "choice-asked", "memory-written",
    "setup-completed", "handout-shown", "item-transferred",
    "definition-created", "ability-acquired",  # section 26 gameplay Mods
    "flag-set", "note-written", "ruling-made",
    "npc-changed",  # §17.3 (#29)
    "worldline-forked", "worldline-switched", "worldline-merged",  # §15.3 (#23)
}
GATE_FLAG = "records-serious-crime-destination-known"  # the-haunting: hall-of-records -> higher-courts-central-police
GATED_EXIT = "higher-courts-central-police"
SPOT = {"intent": "investigate", "goal": "search the desk", "method": "look closely", "skill": "Spot Hidden"}


def world(client):
    return read_json(campaign_dir(client.workspace) / "world.json")


def events(client, kind=None):
    rows = read_jsonl(campaign_dir(client.workspace) / "events.jsonl")
    return [e for e in rows if kind is None or e["type"] == kind]


def exits_of(view):
    return {e["to"]: e for e in view["where"]["exits"]}


def notes_in(capsule):
    return [o for o in capsule["obligations"] if o["kind"] == "note"]


def size(payload):
    return len(json.dumps(payload, ensure_ascii=False).encode("utf-8"))


def ruling(name, statement="judge it so", **anchor):
    return {"kind": "ruling", "name": name, "statement": statement, "anchor": anchor}


# ---- events (§18.5) -------------------------------------------------------------------------

def test_the_event_enum_is_closed_at_twenty_four():
    assert EVENT_TYPES == TWENTY_FOUR


# ---- flag (§18.1) ---------------------------------------------------------------------------

def test_flag_writes_world_flags_and_is_keeper_only(kernel):
    open_turn(kernel)
    result = kernel.table("apply", call_id="t1-c1", effects=[
        {"kind": "flag", "name": "Ritual Stopped", "why": "the chant broke off"},
        {"kind": "flag", "name": "lantern", "value": "guttering"},
        {"kind": "flag", "name": "door open", "value": False},
    ])
    assert result["receipts"] == ["flag:ritual-stopped-t1-c1", "flag:lantern-t1-c1", "flag:door-open-t1-c1"]
    assert world(kernel)["flags"] == {"ritual-stopped": True, "lantern": "guttering", "door-open": False}
    receipts = kernel.table("status")["receipts"]
    assert [r["visibility"] for r in receipts] == ["keeper"] * 3
    assert receipts[0] == {**receipts[0], "kind": "flag", "name": "ritual-stopped", "value": True, "previous": None,
                           "why": "the chant broke off"}
    # keeper-only: no mechanics projection, no number the narration must state
    assert kernel.table("status")["mechanics"] == []
    flagged = events(kernel, "flag-set")
    assert [e["data"] for e in flagged] == [{"name": "ritual-stopped", "value": True, "previous": None},
                                            {"name": "lantern", "value": "guttering", "previous": None},
                                            {"name": "door-open", "value": False, "previous": None}]
    assert flagged[0]["receipt"] == "flag:ritual-stopped-t1-c1" and flagged[0]["call_id"] == "t1-c1"
    # a re-set flag records what it replaced and moves to the end of the write order
    again = kernel.table("apply", call_id="t1-c2", effects=[{"kind": "flag", "name": "ritual-stopped", "value": "partly"}])
    assert again["receipts"] == ["flag:ritual-stopped-t1-c2"]
    assert list(world(kernel)["flags"]) == ["lantern", "door-open", "ritual-stopped"]
    assert events(kernel, "flag-set")[-1]["data"] == {"name": "ritual-stopped", "value": "partly", "previous": True}
    # the words a string-typed tool schema sends for a boolean are the booleans, not strings
    kernel.table("apply", call_id="t1-c3", effects=[{"kind": "flag", "name": "door-open", "value": "True"},
                                                    {"kind": "flag", "name": "lantern", "value": " false "}])
    assert world(kernel)["flags"]["door-open"] is True and world(kernel)["flags"]["lantern"] is False
    assert kernel.table("narrate", call_id="t1-c4", text="玩家看不见任何变化。")["mechanics"] == []


def test_flag_validation_and_batch_atomicity(kernel):
    open_turn(kernel)
    for bad in ({"kind": "flag", "name": ""}, {"kind": "flag"}, {"kind": "flag", "name": "x", "value": 3},
                {"kind": "flag", "name": "x", "value": "y" * 41}, {"kind": "flag", "name": "x", "value": ""}):
        error = kernel.table_err("apply", call_id="t1-c1", effects=[{"kind": "time", "minutes": 1}, bad])
        assert error["code"] == "invalid_params" and error["details"]["index"] == 1, bad
    assert world(kernel)["flags"] == {} and world(kernel)["clock"] == {"minutes": 0}


def test_known_flags_ride_in_the_capsule_newest_first_within_512_bytes(kernel):
    capsule = open_turn(kernel)["capsule"]
    assert capsule["known"]["flags"] == []
    kernel.table("apply", call_id="t1-c1", effects=[{"kind": "flag", "name": "first"}, {"kind": "flag", "name": "second", "value": "x"}])
    assert kernel.table("capsule")["known"]["flags"] == [{"name": "second", "value": "x"}, {"name": "first", "value": True}]
    names = [f"flag-number-{n:02d}-with-a-longer-name" for n in range(40)]
    kernel.table("apply", call_id="t1-c2", effects=[{"kind": "flag", "name": n} for n in names])
    capsule = kernel.table("capsule")
    flags = capsule["known"]["flags"]
    assert size(flags) <= 512 and 0 < len(flags) < 42
    assert flags[0] == {"name": names[-1], "value": True}  # the most recent write survives the cut
    assert [f["name"] for f in flags] == list(reversed(names))[:len(flags)]
    assert "known.flags" in capsule["truncated"]
    assert len(world(kernel)["flags"]) == 42  # the world keeps every flag; only the projection is trimmed


def test_exit_gate_met_is_three_state_and_never_blocks_a_move(kernel):
    capsule = open_turn(kernel)["capsule"]
    # a clue gate the kernel can decide: false now, gone from the exit once the clue is found
    gate = exits_of(capsule)["hall-of-records"]["unlock_when"]
    assert gate == {"condition": "clue_discovered: knott-research-leads", "met": False}
    kernel.table("apply", call_id="t1-c1", effects=[{"kind": "clue", "clue": "knott-research-leads"}])
    assert exits_of(kernel.table("look"))["hall-of-records"]["unlock_when"]["met"] is True
    # a flag gate: unset -> false, set -> true, set to false -> false; the move goes through regardless
    kernel.table("apply", call_id="t1-c2", effects=[{"kind": "move", "to": "hall-of-records"}])
    assert exits_of(kernel.table("look"))[GATED_EXIT]["unlock_when"] == {"condition": f"flag_set: {GATE_FLAG}", "met": False}
    kernel.table("apply", call_id="t1-c3", effects=[{"kind": "flag", "name": "Records serious crime destination known"}])
    assert exits_of(kernel.table("look"))[GATED_EXIT]["unlock_when"]["met"] is True
    kernel.table("apply", call_id="t1-c4", effects=[{"kind": "flag", "name": GATE_FLAG, "value": False}])
    assert exits_of(kernel.table("capsule"))[GATED_EXIT]["unlock_when"]["met"] is False
    assert "newspaper-morgue" in exits_of(kernel.table("look")) and "unlock_when" not in exits_of(kernel.table("look"))["newspaper-morgue"]
    moved = kernel.table("apply", call_id="t1-c5", effects=[{"kind": "move", "to": GATED_EXIT}])
    assert moved["world"]["active_scene"] == GATED_EXIT


def test_condition_status_decides_flags_and_clues_and_never_guesses():
    flags = {"door-open": True, "lamp-lit": False}
    assert condition_status({"kind": "always"}, {"flags": flags}) is True
    assert condition_status({"kind": "flag_set", "flag_id": "door_open"}, {"flags": flags}) is True
    assert condition_status({"kind": "flag", "flag": "lamp lit"}, {"flags": flags}) is False
    assert condition_status({"kind": "flag_set", "flag_id": "never-set"}, {"flags": flags}) is False
    assert condition_status({"kind": "flag_set", "flag_id": "door-open", "value": "ajar"}, {"flags": flags}) is False
    assert condition_status("door_open", {"flags": flags}) is True
    assert condition_status({"kind": "clue_discovered", "clue_id": "clue-x"}, {"discovered_clues": ["x"]}) is True
    # a narrative cut is the keeper's, unless its text names a flag the world holds
    narrative = {"kind": "narrative", "description": "Corbitt destroyed or investigators flee/defeated"}
    assert condition_status(narrative, {"flags": flags}) is None
    assert condition_status({"kind": "narrative", "description": "once the door open, the cellar is reachable"}, {"flags": flags}) is True
    assert condition_status({"kind": "narrative", "description": "when the lamp lit"}, {"flags": flags}) is False
    assert condition_status({"kind": "narrative", "description": "the door opens"}, {"flags": flags}) is None
    assert condition_status({"kind": "travel"}, {"flags": {}}) is None
    assert condition_status(None, {}) is None


# ---- note (§18.2) ---------------------------------------------------------------------------

def test_note_opens_surfaces_as_an_obligation_and_closes(kernel):
    open_turn(kernel)
    result = kernel.table("apply", call_id="t1-c1", effects=[
        {"kind": "note", "name": "the lamp", "text": "explain  the swinging lamp", "entities": ["Knott", "the maid"]},
    ])
    assert result["receipts"] == ["note:the-lamp-t1-c1"]
    rows = read_jsonl(campaign_dir(kernel.workspace) / "notes.jsonl")
    assert rows == [{"name": "the lamp", "text": "explain the swinging lamp", "entities": ["Steven Knott", "the maid"],
                     "turn": 1, "status": "open", "receipt": "note:the-lamp-t1-c1"}]
    receipt = kernel.table("status")["receipts"][0]
    assert receipt == {**receipt, "kind": "note", "name": "the lamp", "status": "open", "closes": None, "visibility": "keeper"}
    assert kernel.table("status")["mechanics"] == []
    assert events(kernel, "note-written")[-1]["data"] == {"name": "the lamp", "status": "open",
                                                          "entities": ["Steven Knott", "the maid"], "closes": None}
    assert notes_in(kernel.table("capsule")) == [{"kind": "note", "name": "the lamp", "who": "keeper",
                                                  "state": "explain the swinging lamp", "turn": 1, "cue": "Steven Knott, the maid"}]
    # the same name cannot be opened twice
    dup = kernel.table_err("apply", call_id="t1-c2", effects=[{"kind": "note", "name": "The Lamp", "text": "again"}])
    assert dup["code"] == "invalid_params" and dup["details"]["index"] == 0 and dup["details"]["open_since_turn"] == 1
    narrate(kernel, "t1-c2", "The lamp swings.")
    kernel.table("player_input", text="I look at the lamp.")
    closed = kernel.table("apply", call_id="t2-c1", effects=[{"kind": "note", "closes": "the lamp"}])
    assert closed["receipts"] == ["note:the-lamp-t2-c1"]
    assert notes_in(kernel.table("capsule")) == []
    last = read_jsonl(campaign_dir(kernel.workspace) / "notes.jsonl")[-1]
    assert last == {**last, "name": "the lamp", "status": "closed", "closed_turn": 2, "closed_by": "t2-c1"}
    assert events(kernel, "note-written")[-1]["data"] == {"name": "the lamp", "status": "closed", "entities": [], "closes": "the lamp"}
    # closed is closed; the name is free again
    gone = kernel.table_err("apply", call_id="t2-c2", effects=[{"kind": "note", "closes": "the lamp"}])
    assert gone["code"] == "invalid_params" and gone["details"]["open"] == []
    assert kernel.table("apply", call_id="t2-c2", effects=[{"kind": "note", "name": "the lamp", "text": "again, later"}])["receipts"]


def test_note_validation(kernel):
    open_turn(kernel)
    for bad in ({"kind": "note"}, {"kind": "note", "name": "x"}, {"kind": "note", "text": "no name"},
                {"kind": "note", "closes": "nothing open"}, {"kind": "note", "name": "x", "text": "y", "entities": "Knott"}):
        error = kernel.table_err("apply", call_id="t1-c1", effects=[bad])
        assert error["code"] == "invalid_params" and error["details"]["index"] == 0, bad
    assert not (campaign_dir(kernel.workspace) / "notes.jsonl").exists()


def test_notes_about_someone_present_all_ride_the_rest_only_the_three_most_recent(kernel):
    open_turn(kernel)
    effects = [{"kind": "note", "name": f"n{i}", "text": f"note {i}"} for i in range(1, 5)]
    effects.insert(0, {"kind": "note", "name": "knott-debt", "text": "Knott still waits for an answer", "entities": ["Steven Knott"]})
    kernel.table("apply", call_id="t1-c1", effects=effects)
    assert [o["name"] for o in notes_in(kernel.table("capsule"))] == ["knott-debt", "n4", "n3", "n2"]
    kernel.table("apply", call_id="t1-c2", effects=[{"kind": "note", "closes": "n4"}])
    assert [o["name"] for o in notes_in(kernel.table("capsule"))] == ["knott-debt", "n3", "n2", "n1"]
    # Knott stays behind: his note drops into the recent-three pool like the others
    kernel.table("apply", call_id="t1-c3", effects=[{"kind": "move", "to": "hall-of-records"}])
    assert [o["name"] for o in notes_in(kernel.table("capsule"))] == ["n3", "n2", "n1"]
    # a batch that replaces one note by another: closes and text in one effect
    swap = kernel.table("apply", call_id="t1-c4", effects=[{"kind": "note", "name": "n1", "text": "n1 restated", "closes": "n1"}])
    assert swap["receipts"] == ["note:n1-t1-c4"]
    assert next(o for o in notes_in(kernel.table("capsule")) if o["name"] == "n1")["state"] == "n1 restated"


# ---- ruling (§18.3) -------------------------------------------------------------------------

def test_ruling_anchors_are_identifiers_validated_against_the_registries(kernel):
    open_turn(kernel)
    cases = [
        (ruling("r", family="cooking"), "family"),
        (ruling("r", decision="core-check:nope"), "decision"),
        (ruling("r", skill="Basket Weaving"), "skill"),
        (ruling("r", entities=["Atlantis"]), "entities"),
        (ruling("r"), None),
        ({**ruling("r", family="combat"), "anchor": {"family": "combat", "mood": "grim"}}, None),
        ({**ruling("r", family="combat"), "scope": "table"}, None),
        ({**ruling("r", family="combat"), "statement": ""}, None),
    ]
    for effect, field in cases:
        error = kernel.table_err("apply", call_id="t1-c1", effects=[{"kind": "time", "minutes": 1}, effect])
        assert error["code"] == "invalid_params" and error["details"]["index"] == 1, effect
        if field:
            assert error["details"]["field"] == field
            if field == "entities":
                assert error["details"]["candidates"]
            else:
                assert error["details"]["options"], field
    assert world(kernel)["clock"] == {"minutes": 0}
    assert not (campaign_dir(kernel.workspace) / "rulings.jsonl").exists()
    # spelled canonically: family and decision names, the catalog skill, graph handles (sorted)
    kernel.table("apply", call_id="t1-c1", effects=[
        ruling("all four", family="core-check", decision="decision:coc7:core-check:ordinary-check", skill="spot hidden",
               entities=["Steven Knott", "Knott's Office"]),
    ])
    row = read_jsonl(campaign_dir(kernel.workspace) / "rulings.jsonl")[0]
    assert row["anchor"] == {"family": "core-check", "decision": "core-check:ordinary-check", "skill": "Spot Hidden",
                             "entities": ["commission-briefing", "steven-knott"]}
    assert row == {**row, "name": "all four", "scope": "campaign", "scene": OPENING_SCENE, "module": "the-haunting",
                   "turn": 1, "status": "active", "receipt": "ruling:all-four-t1-c1"}


def test_resolve_carries_the_rulings_whose_anchor_matches_what_it_selected(seeded_kernel):
    client = seeded_kernel
    open_turn(client)
    client.table("apply", call_id="t1-c1", effects=[
        ruling("by skill", "Spot Hidden in the dark is Hard", skill="Spot Hidden"),
        ruling("by decision", decision="core-check:ordinary-check"),
        ruling("by family", family="core-check"),
        ruling("by entity", "Knott never haggles", entities=["Steven Knott"]),
        ruling("elsewhere", family="combat"),
        ruling("both", "only a Spot Hidden ordinary check", skill="Spot Hidden", decision="core-check:ordinary-check"),
        ruling("listen-only", "a Listen ordinary check", skill="Listen", decision="core-check:ordinary-check"),
    ])
    receipt = client.table("status")["receipts"][0]
    assert receipt == {**receipt, "kind": "ruling", "name": "by skill", "statement": "Spot Hidden in the dark is Hard",
                       "anchor": {"skill": "Spot Hidden"}, "scope": "campaign", "supersedes": [], "visibility": "keeper"}
    assert client.table("status")["mechanics"] == []
    made = events(client, "ruling-made")
    assert len(made) == 7 and made[0]["data"] == {"name": "by skill", "anchor": {"skill": "Spot Hidden"}, "scope": "campaign", "supersedes": []}
    # a Spot Hidden ordinary check: four anchors hit, the three newest ride (§18.3: <= 3);
    # a compound anchor is a conjunction, so `listen-only` misses although its decision matches
    spot = resolve(client, "t1-c2", **SPOT)
    assert spot["decision"] == "core-check:ordinary-check"
    assert spot["rulings"] == [{"name": "both", "statement": "only a Spot Hidden ordinary check"},
                               {"name": "by family", "statement": "judge it so"},
                               {"name": "by decision", "statement": "judge it so"}]
    # a Listen check: the Spot Hidden rulings drop out, the family-, decision- and Listen-bound stay
    listen = resolve(client, "t1-c3", intent="investigate", goal="listen", method="listen at the door", skill="Listen")
    assert [r["name"] for r in listen["rulings"]] == ["listen-only", "by family", "by decision"]
    # a social check on Knott: family social, entity Knott
    talk = resolve(client, "t1-c4", intent="social", goal="terms", method="persuade him", target="Steven Knott", skill="Persuade")
    assert talk["family"] == "social" and talk["rulings"] == [{"name": "by entity", "statement": "Knott never haggles"}]
    # a Spot Hidden check that names Knott hits the entity-bound ruling too, newest first
    aimed = resolve(client, "t1-c5", **{**SPOT, "target": "Steven Knott"})
    assert [r["name"] for r in aimed["rulings"]] == ["both", "by entity", "by family"]


def test_a_ruling_with_the_same_anchor_or_name_supersedes_the_old_one(kernel):
    open_turn(kernel)
    kernel.table("apply", call_id="t1-c1", effects=[ruling("dark", "Hard in the dark", skill="Spot Hidden")])
    second = kernel.table("apply", call_id="t1-c2", effects=[ruling("darker", "Extreme in the dark", skill="spot hidden")])
    assert second["receipts"] == ["ruling:darker-t1-c2"]
    assert kernel.table("status")["receipts"][-1]["supersedes"] == ["dark"]
    assert events(kernel, "ruling-made")[-1]["data"]["supersedes"] == ["dark"]
    rows = read_jsonl(campaign_dir(kernel.workspace) / "rulings.jsonl")
    assert [(r["name"], r["status"]) for r in rows] == [("dark", "active"), ("dark", "superseded"), ("darker", "active")]
    assert rows[1] == {**rows[1], "superseded_by": "darker", "superseded_turn": 1}
    assert resolve(kernel, "t1-c3", **SPOT)["rulings"] == [{"name": "darker", "statement": "Extreme in the dark"}]
    # restating under the same name supersedes by name even with a new anchor
    kernel.table("apply", call_id="t1-c4", effects=[ruling("darker", "restated", family="core-check")])
    rows = read_jsonl(campaign_dir(kernel.workspace) / "rulings.jsonl")
    assert [(r["name"], r["status"]) for r in rows[-2:]] == [("darker", "superseded"), ("darker", "active")]
    assert resolve(kernel, "t1-c5", **SPOT)["rulings"] == [{"name": "darker", "statement": "restated"}]
    # a replayed call_id writes nothing twice
    replay = kernel.table("apply", call_id="t1-c4", effects=[ruling("darker", "restated", family="core-check")])
    assert replay["replayed"] is True and len(read_jsonl(campaign_dir(kernel.workspace) / "rulings.jsonl")) == 5


def test_scene_scoped_rulings_bind_only_where_they_were_made(kernel):
    open_turn(kernel)
    kernel.table("apply", call_id="t1-c1", effects=[
        {**ruling("office-only", "the desk is a Hard search", skill="Spot Hidden"), "scope": "scene"},
        {**ruling("this-book", "in this module, Hard", skill="Spot Hidden", decision="core-check:ordinary-check"), "scope": "module"},
    ])
    assert [r["name"] for r in resolve(kernel, "t1-c2", **SPOT)["rulings"]] == ["this-book", "office-only"]
    # the capsule shows a scene-scoped ruling in its own scene without any session or entity
    capsule = kernel.table("capsule")
    assert capsule["rulings"] == [{"name": "office-only", "statement": "the desk is a Hard search",
                                   "anchor": {"skill": "Spot Hidden"}, "scope": "scene"}]
    kernel.table("apply", call_id="t1-c3", effects=[{"kind": "move", "to": "hall-of-records"}])
    assert [r["name"] for r in resolve(kernel, "t1-c4", **SPOT)["rulings"]] == ["this-book"]
    assert kernel.table("capsule")["rulings"] == []
    kernel.table("apply", call_id="t1-c5", effects=[{"kind": "move", "to": OPENING_SCENE}])
    assert [r["name"] for r in resolve(kernel, "t1-c6", **SPOT)["rulings"]] == ["this-book", "office-only"]


def test_capsule_rulings_follow_the_live_session_and_who_is_present(tmp_path):
    client = RpcClient(tmp_path / "ws", env={"COC_KERNEL_SEED": "9"})
    try:
        capsule = open_turn(client, "I raise the gun.")["capsule"]
        assert capsule["rulings"] == []
        client.table("apply", call_id="t1-c1", effects=[
            ruling("fights", "Corbitt's flesh ward halves bullets", family="combat"),
            ruling("knott", "Knott never haggles", entities=["Steven Knott"], family="social"),
            ruling("corbitt-fights", "he goes for the throat", entities=["Walter Corbitt"], family="combat"),
            ruling("skill-only", "never shown by a capsule", skill="Spot Hidden"),
        ])
        # Knott is present: the entity facet hits; `social` is not a session family, so it
        # is judged by resolve, not held against the ruling here
        assert [r["name"] for r in client.table("capsule")["rulings"]] == ["knott"]
        n = walk_to_confrontation(client, start=2)
        assert client.table("capsule")["rulings"] == []  # Corbitt is here but no fight yet: the combat facet fails
        attack, _, n = attack_and_npc_defense(client, n)
        assert attack["session"]["kind"] == "combat"
        capsule = client.table("capsule")
        assert [r["name"] for r in capsule["rulings"]] == ["corbitt-fights", "fights"]
        assert capsule["rulings"][1] == {"name": "fights", "statement": "Corbitt's flesh ward halves bullets",
                                         "anchor": {"family": "combat"}, "scope": "campaign"}
        assert size(capsule["rulings"]) <= 1024
        # at most three, newest first, within 1KB (distinct anchors: an identical one would supersede)
        client.table("apply", call_id=f"t1-c{n}", effects=[
            ruling(f"long-{i}", "a statement long enough to press on the kilobyte budget of this section " * 5,
                   family="combat", decision=f"combat:{decision}")
            for i, decision in enumerate(("attack", "defend", "flee", "aim"))])
        capsule = client.table("capsule")
        assert [r["name"] for r in capsule["rulings"]] == ["long-3", "long-2", "long-1"][:len(capsule["rulings"])]
        assert size(capsule["rulings"]) <= 1024 and "rulings" in capsule["truncated"]
    finally:
        client.close()


# ---- look focus=session (§18.4) -------------------------------------------------------------

def test_look_focus_session_returns_the_full_view_and_survives_a_restart(tmp_path):
    client = RpcClient(tmp_path / "ws", env={"COC_KERNEL_SEED": "9"})
    try:
        open_turn(client, "I raise the gun.")
        assert client.table("look", focus="session") == {"session": None, "pending_choice": None}
        n = walk_to_confrontation(client)
        attack = resolve(client, f"t1-c{n}", intent="combat", goal="shoot Corbitt", method="fire the revolver",
                         target="Walter Corbitt", weapon=".38 Revolver")
        seen = client.table("look", focus="session")
        session = seen["session"]
        assert session["kind"] == "combat" and session["status"] == "active" and session["round"] == 1
        assert session["turn_of"] == attack["session"]["turn_of"]
        assert [a["decision"] for a in session["actions"]] == ["combat:defend"]
        assert session["pending_defense"] == attack["session"]["pending_defense"]
        assert {p["name"] for p in session["participants"]} == {"thomas-hayes", "walter-corbitt"}
        assert session == client.table("look")["where"]["session"]
        assert seen["pending_choice"]["for"] == "keeper" and seen["pending_choice"]["name"].startswith("defense:")
        assert client.table_err("look", focus="fight")["code"] == "invalid_params"
    finally:
        client.close()
    # the view is rebuilt from the snapshots on disk: a fresh process sees the same fight
    again = RpcClient(tmp_path / "ws", env={"COC_KERNEL_SEED": "9"})
    try:
        again.ok("table.open", {"campaign": CAMPAIGN})
        assert again.table("look", focus="session")["session"] == session
    finally:
        again.close()
