"""Section 166: markup is delivered on the first attempt; deterministic wrapper rendering remains."""

from conftest import campaign_dir, narrate, open_turn, read_json, read_jsonl

STEER = "player-facing prose carries no markup; write it as prose"
KNOTT = "Steven Knott"


def record(client, turn):
    return next(read_json(p) for p in sorted((campaign_dir(client.workspace) / "turns").iterdir())
                if p.suffix == ".json" and read_json(p).get("turn") == turn)


def markup_rows(client):
    return [row for row in read_jsonl(campaign_dir(client.workspace) / "telemetry.jsonl")
            if row.get("lane") == "delivery" and row.get("reason") == "markup_in_prose"]


def test_closing_tags_and_list_lines_deliver_on_the_first_attempt(kernel):
    open_turn(kernel)
    tagged = "The editor watches the door.</text>"
    delivered = kernel.table("narrate", call_id="t1-c1", text=tagged)
    assert delivered["rendered_text"] == "The editor watches the door."
    assert "markup_gate" not in read_json(campaign_dir(kernel.workspace) / "turn.json")
    assert all(row["outcome"] == "delivered" for row in markup_rows(kernel))
    kernel.table("player_input", text="I wait.")
    listed = "# The desk\n- The keys are on the floor.\n2. The deed is crooked."
    assert kernel.table("narrate", call_id="t2-c1", text=listed)["rendered_text"] == listed
    assert all(row["outcome"] == "delivered" for row in markup_rows(kernel))


def test_ordinary_prose_and_the_hosts_own_markers_pass(kernel):
    open_turn(kernel)
    text = (f"诺特站起来——又坐下。{{{{say:{KNOTT}}}}}「行……行了。」{{{{/say}}}}\n\n"
            "——门外有脚步声。\n\n"
            "他看了看表 - 十一点差五分 - 然后把手按在桌上。3 < 5，room #4 * two，a well-kept note.\n\n"
            "…窗外起风了。{{check:not-a-receipt}}")
    result = narrate(kernel, "t1-c1", text)
    assert "{{" not in result["rendered_text"]
    assert not any(row.get("kind") == "markup_in_prose" for row in record(kernel, 1).get("warnings", []))
    assert markup_rows(kernel) == []


def delivered_first(kernel, text):
    """One completed draft: the result, record and deterministic markup finding."""
    open_turn(kernel)
    delivered = narrate(kernel, "t1-c1", text)
    turn = record(kernel, 1)
    return delivered, turn, next(row for row in turn["warnings"] if row["kind"] == "markup_in_prose")


def test_a_matching_pair_around_the_whole_text_is_taken_off(kernel):
    text = f"<text>\n{{{{say:{KNOTT}}}}}「坐吧。」{{{{/say}}}}\n\n诺特把钥匙推过来。\n</text>\n"
    delivered, turn, finding = delivered_first(kernel, text)
    assert delivered["rendered_text"] == "「坐吧。」\n\n诺特把钥匙推过来。"
    assert turn["text"] == f"{{{{say:{KNOTT}}}}}「坐吧。」{{{{/say}}}}\n\n诺特把钥匙推过来。"
    assert "<text>" not in turn.get("marked_text", "") and len(turn["speech"]) == 1
    assert finding["quote"] == "<text>" and finding["stripped"] is True
    assert [row.get("stripped") for row in markup_rows(kernel)] == [True]


def test_a_lone_opening_tag_first_and_a_host_marker_beyond_a_closing_tag_are_still_a_wrapper(kernel):
    delivered, turn, finding = delivered_first(kernel, "<text>诺特把钥匙推过来。")
    assert delivered["rendered_text"] == "诺特把钥匙推过来。" and finding["stripped"] is True
    # A host marker after the tag is gone from the render, so the tag still stands last there; it comes off the text.
    kernel.table("player_input", text="我接过钥匙。")
    marked = "你接过钥匙。</text>\n\n{{check:not-a-receipt}}"
    assert narrate(kernel, "t2-c1", marked)["rendered_text"] == "你接过钥匙。"
    assert "</text>" not in record(kernel, 2)["text"]
    assert next(row for row in record(kernel, 2)["warnings"] if row["kind"] == "markup_in_prose")["stripped"] is True


def test_a_tag_inside_the_prose_is_delivered_as_written(kernel):
    text = "诺特把<b>钥匙</b>推过来。"
    delivered, turn, finding = delivered_first(kernel, text)
    assert delivered["rendered_text"] == text and turn["text"] == text
    assert finding["quote"] == "<b>" and "stripped" not in finding
    assert ["stripped" in row for row in markup_rows(kernel)] == [False]


def test_a_list_line_and_a_wrapper_beside_one_are_delivered_as_written(kernel):
    listed = "诺特靠回椅背。\n\n- 钥匙躺在地板上。"
    delivered, turn, finding = delivered_first(kernel, listed)
    assert delivered["rendered_text"] == listed and "stripped" not in finding
    # A wrapper beside a list line is not a bare wrapper: the whole draft goes out as written.
    kernel.table("player_input", text="我看着地板。")
    mixed = "<text>诺特靠回椅背。\n\n- 钥匙躺在地板上。</text>"
    assert narrate(kernel, "t2-c1", mixed)["rendered_text"] == mixed
    assert "stripped" not in next(row for row in record(kernel, 2)["warnings"] if row["kind"] == "markup_in_prose")


def test_tags_that_are_not_a_frame_are_delivered_as_written(kernel):
    # Two different names at the two ends, a self-closing tag last, and a tag first beside one inside: none is a frame.
    open_turn(kernel)
    for turn_no, text in ((1, "<text>诺特把钥匙推过来。</txt>"), (2, "诺特把钥匙推过来。<br/>"), (3, "<text>诺特把<b>钥匙</b>推过来。")):
        if turn_no > 1:
            kernel.table("player_input", text="我等着。")
        assert narrate(kernel, f"t{turn_no}-c1", text)["rendered_text"] == text
        assert "stripped" not in next(row for row in record(kernel, turn_no)["warnings"] if row["kind"] == "markup_in_prose")
