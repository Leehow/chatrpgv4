"""Contract §17.10: the player-side NPC journal. Job packets with the closed recordable
set, the deterministic merge of journal.submit, closed validation, replay and backlog,
the journal-written event, and the table.view npcs.journal projection. Through the RPC
seam, asserting on npc-journal.json, npc-journal/jobs/*.json, npc-journal/backlog.jsonl
and events.jsonl."""

import json

from conftest import MODULE, narrate, CAMPAIGN, campaign_dir, open_turn, read_json, read_jsonl

INV = "托马斯·海斯"
KNOTT = "Steven Knott"
KNOTT_ID = "npc-steven-knott"
CORBITT = "Walter Corbitt"


def journal_dir(workspace):
    return campaign_dir(workspace) / "npc-journal"


def journal_path(workspace):
    return campaign_dir(workspace) / "npc-journal.json"


def job(client, **params):
    return client.ok("journal.job", {"campaign": CAMPAIGN, **params})


def job_err(client, **params):
    return client.err("journal.job", {"campaign": CAMPAIGN, **params})


def submit(client, job_id, entries):
    return client.ok("journal.submit", {"campaign": CAMPAIGN, "job_id": job_id, "entries": entries})


def submit_err(client, job_id, entries):
    return client.err("journal.submit", {"campaign": CAMPAIGN, "job_id": job_id, "entries": entries})


def close_turn(client, n, text="继续。"):
    """Player input for turn n (n ≥ 2) and its narrate."""
    client.table("player_input", text=f"第 {n} 回合。")
    return narrate(client, f"t{n}-c1", text)


def first_turn(client):
    open_turn(client, "我仔细观察诺特。")
    client.table("resolve", call_id="t1-c1", action={"intent": "investigate", "goal": "看他的表情", "method": "心理学",
                                                    "skill": "Psychology", "target": KNOTT})
    client.table("apply", call_id="t1-c2", effects=[{"kind": "clue", "clue": "knott-keys", "label": "钥匙"}])
    return narrate(client, "t1-c3", "诺特叹了口气。\n\n他把钥匙推过来。")


# ---- job packet ---------------------------------------------------------------------------

def test_job_packet_shape_and_the_closed_recordable_set(kernel):
    narrated = first_turn(kernel)
    packet = job(kernel)
    assert set(packet) == {"job_id", "turn", "commit", "scene", "present", "investigators", "player_text",
                           "keeper_text", "speech", "recordable", "unnamed", "prior", "budget", "instruction"}
    assert packet["job_id"] == "journal:c1:t1" and packet["turn"] == 1 and packet["commit"] == narrated["commit"]
    assert packet["scene"] == {"name": "commission-briefing", "display_name": "Knott's Office"}
    assert packet["present"] == [KNOTT]
    assert packet["investigators"] == [{"id": "thomas-hayes", "name": INV}]
    assert packet["player_text"] == "我仔细观察诺特。"
    assert packet["keeper_text"] == "诺特叹了口气。\n\n他把钥匙推过来。"
    # The recordable set is who was on stage this turn; a graph-only NPC who never appeared
    # is not in it — no appearance, no entry, and no leak of the module's cast.
    assert packet["recordable"] == [KNOTT]
    assert CORBITT not in packet["recordable"]
    assert packet["prior"] == []
    # §103: the prose wrote 诺特, which is not the name the graph prints; whether that told the player
    # the name is the lane's call, so he is on the closed unnamed list until the lane or a record says so.
    assert packet["unnamed"] == [KNOTT]
    assert packet["budget"] == {"max_entries": 6, "max_description_chars": 300, "max_exchange_chars": 200,
                                "max_label_chars": 60}
    assert "recordable" in packet["instruction"] and "zh-Hans" in packet["instruction"]
    stored = read_json(journal_dir(kernel.workspace) / "jobs" / "journal:c1:t1.json")
    assert stored["status"] == "open" and stored["packet"]["job_id"] == "journal:c1:t1"
    # A turn without a committed record has no job.
    assert job_err(kernel, turn=9)["code"] == "invalid_params"
    assert job_err(kernel, turn=9)["details"]["committed_turns"] == [0, 1]


def test_recordable_also_covers_receipt_references_and_journal_names(kernel):
    """The three arms of the closed set: present this turn (Knott, everywhere), named by this
    turn's receipts (Corbitt hands over a clue without being on stage), and already in the
    journal (Corbitt again on the next turn, where nothing else names him)."""
    open_turn(kernel, "我接过那封信。")
    kernel.table("apply", call_id="t1-c1",
                 effects=[{"kind": "clue", "clue": "knott-commission", "from": CORBITT}])
    narrate(kernel, "t1-c2", "诺特把委托说清楚了，信是科比特写的。")
    packet = job(kernel, turn=1)
    assert packet["recordable"] == [KNOTT, CORBITT], "present ∪ receipt-referenced"
    submit(kernel, packet["job_id"], [{"name": CORBITT, "label": "写信的人", "description": "写信的人。",
                                       "exchange": "他的信到了调查员手上。"}])
    close_turn(kernel, 2)
    packet = job(kernel, turn=2)
    assert packet["present"] == [KNOTT] and packet["recordable"] == [KNOTT, CORBITT], \
        "turn 2 has no receipt naming Corbitt: he is recordable only through the journal"
    assert packet["prior"] == [{"name": CORBITT, "label": "写信的人", "description": "写信的人。", "last_seen_turn": 1}]


# ---- submit: the deterministic merge -------------------------------------------------------

def test_submit_merges_entries_and_counts_a_turn_once(kernel):
    first_turn(kernel)
    # Two rows for the same person in one job: seen_count still moves at most once per turn.
    result = submit(kernel, "journal:c1:t1", [
        {"name": KNOTT, "named": True, "description": "房东先生，有些心不在焉。", "exchange": "他把钥匙推过来。"},
        {"name": KNOTT, "exchange": "他叹了口气。"},
    ])
    assert result == {"job_id": "journal:c1:t1", "turn": 1, "entries": 2}
    entries = read_json(journal_path(kernel.workspace))["entries"]
    assert list(entries) == [KNOTT_ID]
    knott = entries[KNOTT_ID]
    assert knott["name"] == KNOTT and knott["description"] == "房东先生，有些心不在焉。"
    assert (knott["first_seen_turn"], knott["last_seen_turn"], knott["seen_count"]) == (1, 1, 1)
    assert [e["summary"] for e in knott["exchanges"]] == ["他把钥匙推过来。", "他叹了口气。"]
    assert all(e["turn"] == 1 and e["scene"] == "Knott's Office" for e in knott["exchanges"])
    # A later turn advances last_seen_turn and seen_count; no description given, the stored one holds.
    close_turn(kernel, 2)
    submit(kernel, "journal:c1:t2", [{"name": KNOTT, "exchange": "他又点点头。"}])
    knott = read_json(journal_path(kernel.workspace))["entries"][KNOTT_ID]
    assert (knott["first_seen_turn"], knott["last_seen_turn"], knott["seen_count"]) == (1, 2, 2)
    assert knott["description"] == "房东先生，有些心不在焉。"
    assert [e["turn"] for e in knott["exchanges"]] == [1, 1, 2]
    # A description that is given replaces the stored one wholesale.
    close_turn(kernel, 3)
    submit(kernel, "journal:c1:t3", [{"name": KNOTT, "description": "焦虑的房东。"}])
    knott = read_json(journal_path(kernel.workspace))["entries"][KNOTT_ID]
    assert knott["description"] == "焦虑的房东。" and knott["seen_count"] == 3
    assert len(knott["exchanges"]) == 3, "no exchange given this turn: nothing appended"


# ---- submit: closed validation -------------------------------------------------------------

def test_each_rejection_points_at_the_entry_and_nothing_lands(kernel):
    first_turn(kernel)
    job_id = job(kernel)["job_id"]
    ok = {"name": KNOTT, "named": True, "exchange": "点头。"}
    cases = [
        ("unknown field", [{**ok, "mood": "happy"}], 0, "mood"),
        ("machine key", [{**ok, "turn": 1}], 0, "turn"),
        ("machine key id", [{**ok, "id": "npc-x"}], 0, "id"),
        ("not recordable", [{"name": CORBITT, "exchange": "x"}], 0, KNOTT),
        ("empty name", [{"name": "  ", "exchange": "x"}], 0, KNOTT),
        ("description too long", [{**ok, "description": "长" * 301}], 0, "300"),
        ("exchange too long", [{**ok, "exchange": "长" * 201}], 0, "200"),
        ("one bad row spoils the batch", [ok, {"name": CORBITT}], 1, CORBITT),
    ]
    for label, entries, index, named in cases:
        error = submit_err(kernel, job_id, entries)
        assert error["code"] == "invalid_params", label
        assert error["details"]["index"] == index, label
        assert named in (error.get("fix") or "") + error["message"], (label, error)
    unrecordable = submit_err(kernel, job_id, [{"name": CORBITT, "exchange": "x"}])
    assert unrecordable["details"]["recordable"] == [KNOTT] and KNOTT in unrecordable["fix"]
    # All-or-nothing: no journal file, the job stays open, every rejection is a pending backlog row.
    assert not journal_path(kernel.workspace).exists()
    assert read_json(journal_dir(kernel.workspace) / "jobs" / f"{job_id}.json")["status"] == "open"
    backlog = read_jsonl(journal_dir(kernel.workspace) / "backlog.jsonl")
    assert len(backlog) == len(cases) + 1
    assert all(r["job_id"] == job_id and r["turn"] == 1 and r["reason"] == "invalid" and r["status"] == "pending"
               for r in backlog)
    assert job(kernel)["turn"] == 0  # turn 1 is backlogged: not the default any more
    # A good submit lands whole and recovers the backlog rows.
    result = submit(kernel, job_id, [ok, {"name": KNOTT, "description": "房东。"}])
    assert result["entries"] == 2
    assert {r["status"] for r in read_jsonl(journal_dir(kernel.workspace) / "backlog.jsonl")} == {"recovered"}


def test_replay_is_idempotent_and_divergence_conflicts(kernel):
    first_turn(kernel)
    entries = [{"name": KNOTT, "named": True, "description": "房东。", "exchange": "给了钥匙。"}]
    first = submit(kernel, "journal:c1:t1", entries)
    again = submit(kernel, "journal:c1:t1", entries)
    assert again == {**first, "replayed": True}
    knott = read_json(journal_path(kernel.workspace))["entries"][KNOTT_ID]
    assert knott["seen_count"] == 1 and len(knott["exchanges"]) == 1, "a replay merges nothing twice"
    # The journal-written event fires once, on the real submit only.
    written = [e for e in read_jsonl(campaign_dir(kernel.workspace) / "events.jsonl") if e["type"] == "journal-written"]
    assert len(written) == 1 and written[0]["turn"] == 1
    assert written[0]["data"] == {"job_id": "journal:c1:t1", "turn": 1, "entries": 1}
    conflict = submit_err(kernel, "journal:c1:t1", [{"name": KNOTT, "exchange": "别的话。"}])
    assert conflict["code"] == "idempotency_conflict" and conflict["details"]["job_id"] == "journal:c1:t1"
    assert submit_err(kernel, "journal:c9:t1", entries)["code"] == "invalid_params"
    assert submit_err(kernel, "journal:c1:t7", entries)["code"] == "invalid_params"


# ---- fail and the default dispatch ----------------------------------------------------------

def test_fail_backlogs_the_job_and_the_default_does_not_redispatch_it(kernel):
    first_turn(kernel)
    close_turn(kernel, 2)
    assert job(kernel)["turn"] == 2
    failed = kernel.ok("journal.fail", {"campaign": CAMPAIGN, "job_id": "journal:c1:t2", "reason": "model_error",
                                        "detail": "timeout after 60s"})
    assert failed == {"job_id": "journal:c1:t2", "turn": 2, "status": "pending", "reason": "model_error"}
    backlog = read_jsonl(journal_dir(kernel.workspace) / "backlog.jsonl")
    assert backlog == [{**backlog[0], "job_id": "journal:c1:t2", "turn": 2, "reason": "model_error",
                        "detail": "timeout after 60s", "status": "pending"}]
    assert read_json(journal_dir(kernel.workspace) / "jobs" / "journal:c1:t2.json")["status"] == "failed"
    assert job(kernel)["turn"] == 1  # not 2
    assert job(kernel, turn=2)["job_id"] == "journal:c1:t2"  # explicit redispatch still works
    assert kernel.err("journal.fail", {"campaign": CAMPAIGN, "job_id": "journal:c1:t2", "reason": "bored"})["code"] == "invalid_params"
    submit(kernel, "journal:c1:t2", [])
    assert read_jsonl(journal_dir(kernel.workspace) / "backlog.jsonl")[0]["status"] == "recovered"
    assert read_json(journal_dir(kernel.workspace) / "jobs" / "journal:c1:t2.json")["status"] == "done"


# ---- table.view projection ------------------------------------------------------------------

def test_table_view_projects_the_journal_for_the_player(kernel):
    first_turn(kernel)
    submit(kernel, "journal:c1:t1", [{"name": KNOTT, "named": True, "description": "房东先生。", "exchange": "他把钥匙推过来。"}])
    # Grow the file by hand: a second person and an exchange history longer than the projection gives.
    path = journal_path(kernel.workspace)
    data = read_json(path)
    data["entries"][KNOTT_ID]["exchanges"] = [
        {"turn": t, "scene": "Knott's Office", "summary": f"第 {t} 句。"} for t in range(1, 9)]
    data["entries"]["npc-walter-corbitt"] = {"name": CORBITT, "description": "只闻其名。",
                                             "first_seen_turn": 3, "last_seen_turn": 3, "seen_count": 1, "exchanges": []}
    path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    # Death is the ledger's truth, merged in at projection time; the journal itself never stores it.
    ledger_path = campaign_dir(kernel.workspace) / "npc-ledger.json"
    ledger = read_json(ledger_path) if ledger_path.exists() else {}
    ledger.setdefault(KNOTT_ID, {})["dead"] = {"turn": 5}
    ledger_path.write_text(json.dumps(ledger, ensure_ascii=False), encoding="utf-8")

    journal = kernel.ok("table.view", {"campaign": CAMPAIGN})["npcs"]["journal"]
    assert [e["name"] for e in journal] == [CORBITT, KNOTT], "newest last_seen_turn first"
    corbitt, knott = journal
    # `id` is the handle a say span carries (contract §40.3): the legend swatch and the line share one anchor.
    assert set(corbitt) == {"id", "name", "named", "description", "seen_count", "last_seen_turn", "exchanges"}
    assert corbitt["id"] == "walter-corbitt" and knott["id"] == "steven-knott"
    # A row written by hand with neither label nor named_at predates §103 and shows the name it always showed.
    assert corbitt["named"] is True and knott["named"] is True
    assert "dead_since_turn" not in corbitt
    assert set(knott) == {"id", "name", "named", "description", "seen_count", "last_seen_turn", "dead_since_turn", "exchanges"}
    assert knott["dead_since_turn"] == 5
    assert knott["seen_count"] == 1 and knott["last_seen_turn"] == 1
    assert [e["turn"] for e in knott["exchanges"]] == [8, 7, 6, 5, 4, 3], "at most six, newest first"
    assert all(set(e) == {"turn", "scene", "summary"} for e in knott["exchanges"])


def test_table_view_setting_up_has_the_empty_journal_shape(kernel):
    created = kernel.ok("campaign.create", {"id": CAMPAIGN, "module": MODULE, "play_language": "zh-Hans"})
    assert created["campaign"]["status"] == "setting_up"
    view = kernel.ok("table.view", {"campaign": CAMPAIGN})
    assert view["state"] == "setting_up" and view["npcs"] == {"journal": []}


# ---- §103: a name the player was not told -------------------------------------------------------

def test_a_person_the_prose_never_named_is_journaled_under_a_label(kernel):
    """血色公路 t1: the book seats two men in the scene, the prose describes them and names nobody, and
    the sheet panel listed them under their full names. The recordable name stays the book's word,
    but a person on the closed `unnamed` list is written under a label, and the player's card shows
    the label until a record or the lane says the name was given."""
    first_turn(kernel)
    packet = job(kernel)
    assert packet["unnamed"] == [KNOTT]
    # The leak fails closed: a first row for an unnamed person needs a label, and neither the label
    # nor the prose the player reads may carry the name.
    missing = submit_err(kernel, packet["job_id"], [{"name": KNOTT, "description": "办公桌后的男人。"}])
    assert missing["code"] == "invalid_params" and missing["details"] == {"index": 0, "field": "label", "name": KNOTT, "unnamed": [KNOTT]}
    assert "label" in missing["fix"] and "named" in missing["fix"]
    carrying = submit_err(kernel, packet["job_id"], [{"name": KNOTT, "label": f"{KNOTT} at the desk"}])
    assert carrying["code"] == "invalid_params" and carrying["details"] == {"index": 0, "field": "label", "name": KNOTT}
    described = submit_err(kernel, packet["job_id"], [{"name": KNOTT, "label": "办公桌后的男人", "description": f"{KNOTT} 坐在桌后。"}])
    assert described["code"] == "invalid_params" and described["details"]["field"] == "description"
    submit(kernel, packet["job_id"], [{"name": KNOTT, "label": "办公桌后的男人", "description": "戴着遮阳帽舌的男子。", "exchange": "他把钥匙推过来。"}])
    stored = read_json(journal_path(kernel.workspace))["entries"][KNOTT_ID]
    assert stored["name"] == KNOTT and stored["label"] == "办公桌后的男人" and "named_at" not in stored
    # The player's card: the label stands where the name would, and says so.
    [knott] = kernel.ok("table.view", {"campaign": CAMPAIGN})["npcs"]["journal"]
    assert knott["id"] == "steven-knott" and knott["name"] == "办公桌后的男人" and knott["named"] is False
    # The Keeper's capsule: the same seat that carries `called` (§79) carries `untold`, with the label and its consequence.
    kernel.table("player_input", text="我等他开口。")
    capsule = kernel.table("look", focus="npc")
    [present] = capsule["present"]
    assert present["name"] == KNOTT
    assert present["untold"]["label"] == "办公桌后的男人" and "say token" in present["untold"]["use"]
    assert kernel.table("look", focus="npc", name=KNOTT)["untold"]["label"] == "办公桌后的男人"
    # Turn 2's prose prints the name the graph displays. The record shows it, so the job takes him off
    # the list, and the submit records the turn even though the lane wrote nothing about him.
    narrate(kernel, "t2-c1", f"{KNOTT} 终于站起来，自报了姓名。")
    packet = job(kernel, turn=2)
    assert packet["unnamed"] == [] and packet["prior"] == [{"name": KNOTT, "description": "戴着遮阳帽舌的男子。", "last_seen_turn": 1}]
    named_already = submit_err(kernel, packet["job_id"], [{"name": KNOTT, "label": "另一个称谓"}])
    assert named_already["code"] == "invalid_params" and named_already["details"] == {"index": 0, "field": "label", "name": KNOTT, "unnamed": []}
    submit(kernel, packet["job_id"], [])
    stored = read_json(journal_path(kernel.workspace))["entries"][KNOTT_ID]
    assert stored["named_at"] == 2 and stored["label"] == "办公桌后的男人", "the label stays on file; the name takes over the card"
    [knott] = kernel.ok("table.view", {"campaign": CAMPAIGN})["npcs"]["journal"]
    assert knott["name"] == KNOTT and knott["named"] is True
    kernel.table("player_input", text="我点头。")
    [present] = kernel.table("look", focus="npc")["present"]
    assert "untold" not in present


def test_the_lane_can_name_a_person_the_scan_cannot_see(kernel):
    """The fixture's prose says 诺特 for `Steven Knott`: no record can see that as the name being told,
    so the lane says it with `named: true`, which can add a turn and never take one away."""
    first_turn(kernel)
    submit(kernel, "journal:c1:t1", [{"name": KNOTT, "label": "办公桌后的男人", "description": "戴着遮阳帽舌的男子。"}])
    close_turn(kernel, 2, "诺特自报了姓名。")
    packet = job(kernel, turn=2)
    assert packet["unnamed"] == [KNOTT], "诺特 is not a word the scan reads as the name"
    assert packet["prior"] == [{"name": KNOTT, "label": "办公桌后的男人", "description": "戴着遮阳帽舌的男子。", "last_seen_turn": 1}]
    wrong = submit_err(kernel, packet["job_id"], [{"name": KNOTT, "named": "yes"}])
    assert wrong["code"] == "invalid_params" and wrong["details"] == {"index": 0, "field": "named"}
    submit(kernel, packet["job_id"], [{"name": KNOTT, "named": True, "exchange": "他说了自己的名字。"}])
    stored = read_json(journal_path(kernel.workspace))["entries"][KNOTT_ID]
    assert stored["named_at"] == 2
    [knott] = kernel.ok("table.view", {"campaign": CAMPAIGN})["npcs"]["journal"]
    assert knott["name"] == KNOTT and knott["named"] is True
    close_turn(kernel, 3)
    packet = job(kernel, turn=3)
    assert packet["unnamed"] == [] and "label" not in packet["prior"][0]
    # Naming is one-way: a later turn without the name does not take it back, and a label is refused now.
    assert submit_err(kernel, packet["job_id"], [{"name": KNOTT, "label": "那个人"}])["details"]["field"] == "label"
    submit(kernel, packet["job_id"], [{"name": KNOTT, "exchange": "他又点点头。"}])
    assert read_json(journal_path(kernel.workspace))["entries"][KNOTT_ID]["named_at"] == 2


def test_a_say_span_of_theirs_shows_the_player_the_name(kernel):
    """§40.4 titles a resolved span with the speaker's name: a say token of theirs is the name being
    told, whatever the prose around it calls them."""
    open_turn(kernel, "我等他开口。")
    narrate(kernel, "t1-c1", f"房东抬起头。{{{{say:{KNOTT}}}}}「请坐。」{{{{/say}}}}")
    packet = job(kernel)
    assert packet["unnamed"] == []
    submit(kernel, packet["job_id"], [{"name": KNOTT, "description": "房东。", "exchange": "他请调查员坐下。"}])
    assert read_json(journal_path(kernel.workspace))["entries"][KNOTT_ID]["named_at"] == 1
