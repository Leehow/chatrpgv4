import json

from conftest import narrate, OPENING_SCENE, PREGEN, campaign_dir, open_turn, read_json

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
    # §18.1: the gate and whether it is met (false: the clue is not found yet)
    assert exits["hall-of-records"]["unlock_when"] == {"condition": "clue_discovered: knott-research-leads", "met": False}
    affordances = {a["id"]: a for a in where["affordances"]}
    assert affordances["confirm-commission-terms"]["clue"] == "knott-commission"
    assert affordances["confirm-commission-terms"]["npc"] == "Steven Knott"
    assert where["keeper_notes"]
    assert where["assets"] == [{"name": "Handout 1: Mr. Knott's Commission", "kind": "handout"}]

    present = capsule["present"]
    assert [p["name"] for p in present] == ["Steven Knott"]
    knott = present[0]
    # §17.4: the dossier keys the keeper plays him from, and the clues he is the one to know
    assert knott["role"] == "employer"
    assert knott["wants"] and knott["voice"] and knott["fears"] and knott["hides"]
    assert {f["clue"] for f in knott["knows"]} == {"knott-commission", "knott-research-leads",
                                                    "knott-macario-summary"}
    assert all(f["discovered"] is False for f in knott["knows"])
    # §17.3: the opening turn closed with him on stage, so the ledger has met him once and
    # nothing else — no roll has been settled against him, so there is no stance yet.
    assert knott["history"] == {"met_turns": 1, "last_turn": 0}
    assert "toward_party" not in knott

    known = capsule["known"]
    assert known["discovered_clues"] == []
    clues = {c["name"]: c for c in known["clues_here"]}
    assert clues["knott-commission"]["delivery_kind"] == "npc_dialogue"
    assert clues["knott-commission"]["discovered"] is False
    investigator = known["investigator"]
    assert investigator["id"] == PREGEN
    assert investigator["sex"] == "M", "the keeper reads the sheet's sex, never a guess from the name"
    assert investigator["age"] == 34
    assert "appearance" not in investigator, "this pregen writes no description and the capsule invents none"
    assert {"name": "Spot Hidden", "value": 55} in investigator["skills_of_note"]

    assert capsule["recent"] == [{"turn": 0, "player": None, "keeper": "开场。\n\n诺特把钥匙拍在桌上。", "closed": "explicit", "receipts": 0}]
    # the slice-0 sections fit untouched; the first-turn briefing (#22) shortened its roster lines to its own 2KB
    assert capsule.get("truncated", []) == ["module"]
    for name, budget in BUDGETS.items():
        assert size(capsule[name]) <= budget, name

    refreshed = kernel.table("capsule")
    assert refreshed.pop("_context") == result["_context"]
    assert refreshed == capsule


def test_the_appearance_the_player_wrote_reaches_the_keeper_bounded(kernel):
    """§119: the first thing anyone says to a stranger is about what the stranger looks like, and no name has
    been said yet. The description the player writes at setup never reached the keeper at all."""
    open_turn(kernel)
    path = campaign_dir(kernel.workspace) / "party" / f"{PREGEN}.json"
    sheet = read_json(path)
    written = "瘦高个，穿一件洗白的风衣，右手总插在口袋里。"
    sheet["backstory"]["personal_description"] = written
    path.write_text(json.dumps(sheet, ensure_ascii=False), encoding="utf-8")
    assert kernel.table("capsule")["known"]["investigator"]["appearance"] == written
    # `known` is budgeted by popping its largest list and the investigator is an object, so the written
    # appearance is cut rather than left able to evict clue rows: the rows are still there with a
    # maximum-length description on the sheet.
    rows = [c["name"] for c in kernel.table("capsule")["known"]["clues_here"]]
    sheet["backstory"]["personal_description"] = written * 20
    path.write_text(json.dumps(sheet, ensure_ascii=False), encoding="utf-8")
    known = kernel.table("capsule")["known"]
    appearance = known["investigator"]["appearance"]
    assert len(appearance) == 200 and appearance == (written * 20)[:200]
    assert size(known) <= BUDGETS["known"] and [c["name"] for c in known["clues_here"]] == rows


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
    for key in ("wants", "fears", "hides", "voice", "role", "keeper_note", "social_role", "knows"):
        assert npc[key], key
    # §17.4: the row as it stands — he has been on stage, nothing has been settled with him
    assert npc["ledger"]["turns_present"]["count"] == 1
    assert npc["ledger"]["stance"] is None and npc["ledger"]["interactions"] == []
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
    # Contract §32.9: the Keeper is told to read the source rewards before settling an ending, and
    # every projection it could reach carried none, so a real table guessed 0, then 1D6, then 1D3.
    # The authors write them on the scene that ends, with a rule_ref into the ruleset.
    ending = next(e for e in module["endings"] if e["conclusion"] == "corbitt-destroyed")
    assert ending["sanity_reward"] == "1D6" and ending["requires"] == "investigators_win"
    assert ending["rule"] == "module.haunting.conclusion_sanity_reward" and ending["ends_session"] is True
    assert ending["scene"] == "corbitt-confrontation"

    assert kernel.table_err("lookup", kind="weird", query="x")["code"] == "invalid_params"


def test_lookup_module_takes_exact_handles_and_a_starter_has_no_source_to_bind(kernel):
    """Contract §127: real table 2026-09-22 on the built-in starter."""
    open_turn(kernel)
    held = kernel.table("lookup", kind="module", query="knott-macario-summary knott-keys knott-research-leads")
    assert [e["name"] for e in held["entities"]] == ["knott-macario-summary", "knott-keys", "knott-research-leads"]
    assert "status" not in held
    # One word that is not a handle keeps the whole query ordinary search text.
    assert kernel.table("lookup", kind="module", query="knott-keys lantern")["status"] == "not_found"

    error = kernel.err("module.read.request", {"module_id": "the-haunting", "purpose": "detail",
        "focus": "steven-knott", "question": "What does the commission pay?"})
    assert error["code"] == "needs"
    assert error["details"]["reason"] == "no_source_document"
    assert "module.source.bind" not in error.get("fix", "")
    assert "lookup kind=module" in error["fix"]


def test_recall_transcript(kernel):
    open_turn(kernel, "第一回合的话。")
    recalled = kernel.table("recall", what="transcript")
    assert recalled["turns"] == [0, 1]
    assert [(c["turn"], c["role"], c["head"]) for c in recalled["cards"]] == [
        (0, "keeper", "开场。\n\n诺特把钥匙拍在桌上。"),
        (1, "player", "第一回合的话。"),
    ]
    assert kernel.table("recall", what="transcript", read={"turn": 0, "role": "keeper"})["text"] == "开场。\n\n诺特把钥匙拍在桌上。"
    assert kernel.table("recall", what="transcript", read={"turn": 1, "role": "player"})["text"] == "第一回合的话。"
    only_player = kernel.table("recall", what="transcript", role="player")
    assert [c["role"] for c in only_player["cards"]] == ["player"]
    assert kernel.table("recall", what="transcript", turns=[1, 1])["cards"][0]["turn"] == 1
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


def test_an_affordance_row_carries_what_it_yields_and_its_gate(kernel):
    """Contract §32.5: cue, gate and yield in one row. The authored field is `grants_clue_ids` or the
    older `clue_id`; the first granted clue keeps the §6 `clue` key, and `clues` carries every one with
    the same gate string the Director's reveal rows and the thread's `here` rows use."""
    open_turn(kernel)
    where = kernel.table("capsule")["where"]
    affordances = {a["id"]: a for a in where["affordances"]}
    row = affordances["confirm-commission-terms"]
    assert row["clue"] == "knott-commission"
    assert row["clues"] == [{"clue": "knott-commission", "gate": "npc_dialogue: check unspecified", "discovered": False}]
    assert all("clues" in a and a["clues"][0]["clue"] == a["clue"] for a in where["affordances"]), where["affordances"]
    # `status` and `route_type` are author fields with no writer and stay off the row: nothing at the table moves them.
    assert "status" not in row and "route_type" not in row
    known = kernel.table("capsule")["known"]
    clues = {c["name"]: c for c in known["clues_here"]}
    assert clues["knott-commission"]["gate"] == "npc_dialogue: check unspecified"
    # A landed clue reads as discovered on the affordance that grants it.
    kernel.table("apply", call_id="t1-c1", effects=[{"kind": "clue", "clue": "knott-commission"}])
    after = {a["id"]: a for a in kernel.table("capsule")["where"]["affordances"]}
    assert after["confirm-commission-terms"]["clues"][0]["discovered"] is True
