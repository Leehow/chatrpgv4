import json

from conftest import narrate, OPENING_SCENE, PREGEN, open_turn

BUDGETS = {"where": 4096, "present": 3072, "known": 3072, "recent": 2048}


def size(payload):
    return len(json.dumps(payload, ensure_ascii=False).encode("utf-8"))


def test_player_input_capsule_has_all_sections(kernel):
    result = open_turn(kernel, "我仔细观察诺特。")
    assert result["turn"] == 1 and result["state"] == "open"
    capsule = result["capsule"]
    assert capsule["turn"] == {"number": 1, "state": "open", "pending_choice": None,
                               "player_text": "我仔细观察诺特。"}

    where = capsule["where"]
    assert where["scene"] == OPENING_SCENE
    assert where["display_name"] == "Knott's Office"
    assert where["dramatic_question"]
    assert where["pressure_moves"]
    exits = {e["to"]: e for e in where["exits"]}
    assert "hall-of-records" in exits
    assert exits["hall-of-records"]["unlock_when"] == "clue_discovered: knott-research-leads"
    affordances = {a["id"]: a for a in where["affordances"]}
    assert affordances["confirm-commission-terms"]["clue"] == "knott-commission"
    assert affordances["confirm-commission-terms"]["npc"] == "Steven Knott"
    assert where["keeper_notes"]
    assert where["assets"] == [{"name": "Handout 1: Mr. Knott's Commission", "kind": "handout"}]

    present = capsule["present"]
    assert [p["name"] for p in present] == ["Steven Knott"]
    knott = present[0]
    assert knott["relationship"] == "employer"
    assert knott["agenda"] and knott["voice"]
    assert {f["clue"] for f in knott["known_facts"]} == {"knott-commission", "knott-research-leads",
                                                          "knott-macario-summary"}

    known = capsule["known"]
    assert known["discovered_clues"] == []
    clues = {c["name"]: c for c in known["clues_here"]}
    assert clues["knott-commission"]["delivery_kind"] == "npc_dialogue"
    assert clues["knott-commission"]["discovered"] is False
    investigator = known["investigator"]
    assert investigator["id"] == PREGEN
    assert {"name": "Spot Hidden", "value": 55} in investigator["skills_of_note"]

    assert capsule["recent"] == [{"turn": 0, "player": None, "keeper": "开场。\n\n诺特把钥匙拍在桌上。"}]
    # the slice-0 sections fit untouched; the first-turn briefing (#22) shortened its roster lines to its own 2KB
    assert capsule.get("truncated", []) == ["module"]
    for name, budget in BUDGETS.items():
        assert size(capsule[name]) <= budget, name

    assert kernel.table("capsule") == capsule


def test_look_focus_variants(kernel):
    open_turn(kernel)
    scene = kernel.table("look")
    assert set(scene) == {"where", "present"}
    assert scene == kernel.table("look", focus="scene")
    assert kernel.table("status")["state"] == "acting"

    npc = kernel.table("look", focus="npc", name="Steven Knott")
    assert npc["kind"] == "npc"
    assert npc["id"] == "steven-knott"
    assert npc["scene"] == OPENING_SCENE
    for key in ("agenda", "fear", "secret", "voice", "relationship", "keeper_note", "social_role", "known_facts"):
        assert npc[key], key
    assert kernel.table("look", focus="npc", name="steven-knott") == npc
    assert kernel.table("look", focus="npc")["present"][0]["name"] == "Steven Knott"

    investigator = kernel.table("look", focus="investigator")
    assert investigator["kind"] == "investigator"
    assert investigator["name"] == "托马斯·海斯"
    assert investigator["skills"]["Spot Hidden"] == 55
    assert (investigator["hp"], investigator["san"], investigator["mp"], investigator["luck"]) == (12, 55, 11, 50)
    assert "notes" not in investigator

    clues = kernel.table("look", focus="clues")
    assert clues["discovered_clues"] == []
    assert {c["name"] for c in clues["clues_here"]} >= {"knott-commission", "knott-keys"}

    assert kernel.table("look", focus="time") == {"clock": {"minutes": 0}}

    error = kernel.table_err("look", focus="npc", name="nobody-here")
    assert error["code"] == "unknown_entity"
    assert "candidates" in error["details"]
    assert kernel.table_err("look", focus="weather")["code"] == "invalid_params"


def test_lookup_module_and_secret(kernel):
    open_turn(kernel)
    found = kernel.table("lookup", kind="module", query="knott")
    assert 0 < len(found["entities"]) <= 8
    names = {e["name"] for e in found["entities"]}
    assert "steven-knott" in names
    entity = next(e for e in found["entities"] if e["name"] == "steven-knott")
    assert entity["kind"] == "npc"
    assert entity["visibility"] == "keeper-only"
    assert {"kind": "present-in", "to": OPENING_SCENE} in entity["relations"]

    secret = kernel.table("lookup", kind="secret")
    assert secret["scene"]["name"] == OPENING_SCENE
    assert secret["scene"]["dramatic_question"]
    assert {c["name"] for c in secret["undiscovered_clues"]} >= {"knott-commission", "knott-keys"}
    assert secret["npc_secrets"][0]["name"] == "Steven Knott"
    assert secret["npc_secrets"][0]["secret"]
    assert any(s["name"] == "corbitt-undead-sorcerer" and "Mythos" in s["summary"]
               for s in secret["module_secrets"])

    module = kernel.table("lookup", kind="secret", scope="module")
    assert len(module["module_secrets"]) == 6
    assert len(module["conclusions"]) == 6
    assert all(c["summary"] for c in module["conclusions"])

    assert kernel.table_err("lookup", kind="weird", query="x")["code"] == "invalid_params"


def test_recall_transcript(kernel):
    open_turn(kernel, "第一回合的话。")
    recalled = kernel.table("recall", what="transcript")
    assert recalled["turns"] == [0, 1]
    assert [(e["turn"], e["role"], e["text"]) for e in recalled["entries"]] == [
        (0, "keeper", "开场。\n\n诺特把钥匙拍在桌上。"),
        (1, "player", "第一回合的话。"),
    ]
    only_player = kernel.table("recall", what="transcript", role="player")
    assert [e["role"] for e in only_player["entries"]] == ["player"]
    assert kernel.table("recall", what="transcript", turns=[1, 1])["entries"][0]["turn"] == 1
    # slice 2: the other two roads are open (12.4); their shapes are covered in test_recall.py
    assert kernel.table("recall", what="memory")["what"] == "memory"
    assert kernel.table("recall", what="history")["what"] == "history"
    assert kernel.table_err("recall", what="dreams")["code"] == "invalid_params"
    assert kernel.table_err("recall", what="transcript", turns=[3, 1])["code"] == "invalid_params"


def test_capsule_is_kept_with_the_turn_cursor_and_the_closed_record(kernel):
    from conftest import OPENING_SCENE as _OPENING, campaign_dir as _dir, open_turn as _open_turn, read_json as _read
    opened = _open_turn(kernel, "我看着诺特。")
    cursor = _read(_dir(kernel.workspace) / "turn.json")
    assert cursor["capsule"]["where"]["scene"] == _OPENING
    assert cursor["capsule"] == opened["capsule"]
    narrate(kernel, "t1-c1", "他看着你。")
    record = _read(_dir(kernel.workspace) / "turns" / "0001.json")
    assert record["capsule"]["turn"]["number"] == 1 and record["capsule"]["where"]["scene"] == _OPENING
