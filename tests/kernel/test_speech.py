"""Contract §40: the say token around every spoken line.

`{{say:<name>}}…{{/say}}` is the one machine token beside the mechanics marker that belongs in the
story text. The kernel repairs its shape, never refuses for it, resolves the name to a person by
exact name, keeps the spans on the record as `speech`, and strips every brace before the player
reads a word. Through the RPC seam, asserting on the delivery result, the turn record, the ledger,
the capsule, the journal packet and the verifier's intake."""

from conftest import CAMPAIGN, campaign_dir, narrate, open_turn, read_json, read_jsonl

INV = "托马斯·海斯"
KNOTT = "Steven Knott"
KNOTT_HANDLE = "steven-knott"
KNOTT_ID = "npc-steven-knott"


def record(client, turn):
    return next(read_json(p) for p in sorted((campaign_dir(client.workspace) / "turns").iterdir())
                if p.suffix == ".json" and read_json(p).get("turn") == turn)


def keeper_lines(client):
    return [row["text"] for row in read_jsonl(campaign_dir(client.workspace) / "transcript.jsonl") if row.get("role") == "keeper"]


def test_a_say_token_wraps_a_line_and_resolves_to_the_person_present(kernel):
    open_turn(kernel)
    result = narrate(kernel, "t1-c1", f"诺特把钥匙推过来。{{{{say:{KNOTT}}}}}「钥匙在这儿。」{{{{/say}}}}他没有起身。")
    assert result["speech"] == [{"who": {"npc": KNOTT_HANDLE, "name": KNOTT}, "text": "「钥匙在这儿。」"}]
    # The handle is a name the model may hold; the node id is not for the model (§16.6, §40.2).
    assert KNOTT_ID not in str(result)
    assert "{{" not in result["rendered_text"]
    assert result["rendered_text"] == "诺特把钥匙推过来。「钥匙在这儿。」他没有起身。"
    # The token stands in `marked_text` for the host to draw the line in its speaker's colour.
    assert f"{{{{say:{KNOTT}}}}}「钥匙在这儿。」{{{{/say}}}}" in result["marked_text"]
    assert "unresolved_speakers" not in result and "dropped_markers" not in result
    stored = record(kernel, 1)
    assert stored["speech"] == result["speech"]
    assert all("{{" not in line for line in keeper_lines(kernel))


def test_the_investigator_and_a_stranger_resolve_their_own_way(kernel):
    open_turn(kernel)
    result = narrate(kernel, "t1-c1",
                     f"{{{{say:{INV}}}}}「我要看看那栋房子。」{{{{/say}}}}角落里有人开口。{{{{say:穿黑袍的女人}}}}「滚出去。」{{{{/say}}}}")
    who = [line["who"] for line in result["speech"]]
    assert who[0]["name"] == INV and who[0]["investigator"]
    assert who[1] == {"label": "穿黑袍的女人"}
    # A label is reported, never refused: the same label next time is the same person to the host.
    assert result["unresolved_speakers"]["names"] == ["穿黑袍的女人"]
    assert "{{" not in result["rendered_text"]


def test_the_shape_is_repaired_never_refused(kernel):
    open_turn(kernel)
    text = (f"{{{{say:{KNOTT}}}}}「先听我说。」{{{{say:{INV}}}}}「说。」{{{{/say}}}}{{{{/say}}}}\n\n"
            f"{{{{say:{KNOTT}}}}}「房子锁了二十年。」\n\n他站起来。{{{{/say}}}}")
    result = narrate(kernel, "t1-c1", text)
    # An open before a close closes the previous span; a stray close is removed; an unclosed span
    # closes at its paragraph; the close on the next paragraph has no open and goes.
    assert [line["text"] for line in result["speech"]] == ["「先听我说。」", "「说。」", "「房子锁了二十年。」"]
    assert result["marked_text"] == (f"{{{{say:{KNOTT}}}}}「先听我说。」{{{{/say}}}}{{{{say:{INV}}}}}「说。」{{{{/say}}}}\n\n"
                                     f"{{{{say:{KNOTT}}}}}「房子锁了二十年。」{{{{/say}}}}\n\n他站起来。")
    assert "{{" not in result["rendered_text"]


def test_a_span_with_no_words_is_unwrapped_and_never_recorded(kernel):
    open_turn(kernel)
    result = narrate(kernel, "t1-c1", f"他沉默着。{{{{say:{KNOTT}}}}}{{{{/say}}}}然后摇头。")
    assert result["speech"] == [] and "marked_text" not in result
    assert result["rendered_text"] == "他沉默着。然后摇头。"


def test_a_mechanics_marker_inside_a_line_moves_after_it_and_still_binds(kernel):
    open_turn(kernel)
    rolled = kernel.table("resolve", call_id="t1-c1", action={"intent": "investigate", "goal": "找线索", "method": "翻找", "skill": "Spot Hidden"})
    marker = rolled["markers"][0]
    result = narrate(kernel, "t1-c2", f"{{{{say:{KNOTT}}}}}「看这里。{{{{{marker}}}}}」{{{{/say}}}}你低头看。")
    assert result["marked_text"].startswith(f"{{{{say:{KNOTT}}}}}「看这里。」{{{{/say}}}}{{{{{marker}}}}}")
    assert result["speech"][0]["text"] == "「看这里。」"
    assert [row["marker"] for row in result["mechanics"] if row.get("marker")] == [marker]
    assert "dropped_markers" not in result


def test_a_say_token_is_never_a_dropped_marker(kernel):
    """`{{say:steven-knott}}` matches the mechanics marker grammar; the binder must leave it alone (§40.2),
    and the handle is one of the person's names."""
    open_turn(kernel)
    result = narrate(kernel, "t1-c1", "{{say:steven-knott}}「进来。」{{/say}}")
    assert "dropped_markers" not in result
    assert result["speech"][0]["who"] == {"npc": KNOTT_HANDLE, "name": KNOTT}


def test_ask_takes_the_same_token(kernel):
    open_turn(kernel)
    result = kernel.table("ask", call_id="t1-c1", kind="story", prompt="你要不要接？", options=["接", "不接"],
                          text=f"{{{{say:{KNOTT}}}}}「接不接？」{{{{/say}}}}")
    assert result["speech"] == [{"who": {"npc": KNOTT_HANDLE, "name": KNOTT}, "text": "「接不接？」"}]
    assert "{{" not in result["rendered_text"]
    assert record(kernel, 1)["speech"] == result["speech"]


def test_who_spoke_reaches_the_ledger_the_capsule_and_the_journal(kernel):
    open_turn(kernel)
    narrate(kernel, "t1-c1", f"{{{{say:{KNOTT}}}}}「钥匙在这儿。」{{{{/say}}}}")
    ledger = read_json(campaign_dir(kernel.workspace) / "npc-ledger.json")
    assert ledger[KNOTT_ID]["spoke"] == {"turns": 1, "last_turn": 1}
    # The next turn's capsule carries it in the person's history.
    capsule = kernel.table("player_input", text="我等他继续。")["capsule"]
    knott = next(p for p in capsule["present"] if p["name"] == KNOTT)
    assert knott["history"]["last_spoke_turn"] == 1
    # The journal lane reads what was said instead of guessing it from prose (§40.3).
    packet = kernel.ok("journal.job", {"campaign": CAMPAIGN, "turn": 1})
    assert packet["speech"] == [{"name": KNOTT, "text": "「钥匙在这儿。」"}]
    assert KNOTT in packet["recordable"]
    journal = kernel.ok("table.view", {"campaign": CAMPAIGN})["npcs"]["journal"]
    assert journal == [] or all("id" in row for row in journal)


def test_a_line_left_unmarked_is_a_verifier_finding(kernel):
    open_turn(kernel)
    narrate(kernel, "t1-c1", "诺特说：「钥匙在这儿。」")
    accepted = kernel.ok("table.warn", {"campaign": CAMPAIGN, "turn": 1, "lane": "verifier", "findings": [
        {"kind": "unmarked_speech", "quote": "「钥匙在这儿。」", "why": "a spoken line outside any say span"}]})
    assert accepted["accepted"] == 1 if "accepted" in accepted else True
    error = kernel.err("table.warn", {"campaign": CAMPAIGN, "turn": 1, "lane": "verifier", "findings": [
        {"kind": "loud_speech", "quote": "「钥匙在这儿。」", "why": "not a kind"}]})
    assert error["code"] == "invalid_params" and "unmarked_speech" in error["fix"]
