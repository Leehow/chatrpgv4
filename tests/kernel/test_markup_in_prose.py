"""Contract §143.10: player-facing prose carries no markup.

A syntax check over the text `narrate` renders, after the host's own say tokens and mechanics markers are stripped:
an XML/HTML-shaped tag, or a line opening with a markdown list or heading marker. The first delivery of a turn that
carries it is refused `needs` with the steer and `details.reason = "markup_in_prose"`, and `turn.json` remembers the
refusal (`markup_gate`); a later delivery in the same turn is delivered as written with a `warnings` row. Both are
counted on the `lane: "delivery"` telemetry row. Through the RPC seam.

§143.17 (ticket 18): on that second delivery, markup that is only a bare wrapper -- a tag at the text's very start or
end, or a matching pair around all of it -- is taken off before rendering, and the finding and the delivered row say
`stripped: true`. A tag inside the prose, a list line, or a wrapper beside either go out as written."""

from conftest import campaign_dir, narrate, open_turn, read_json, read_jsonl

STEER = "player-facing prose carries no markup; write it as prose"
KNOTT = "Steven Knott"


def record(client, turn):
    return next(read_json(p) for p in sorted((campaign_dir(client.workspace) / "turns").iterdir())
                if p.suffix == ".json" and read_json(p).get("turn") == turn)


def markup_rows(client):
    return [row for row in read_jsonl(campaign_dir(client.workspace) / "telemetry.jsonl")
            if row.get("lane") == "delivery" and row.get("reason") == "markup_in_prose"]


def test_a_closing_tag_is_refused_once_then_the_turn_is_delivered_with_a_finding(kernel):
    open_turn(kernel)
    tagged = f"{{{{say:{KNOTT}}}}}「钥匙你自己捡。」{{{{/say}}}}门外的走廊里没人来。</text>\n"
    error = kernel.table_err("narrate", call_id="t1-c1", text=tagged)
    assert error["code"] == "needs" and error["message"].startswith(STEER)
    assert error["details"] == {"reason": "markup_in_prose", "tags": ["</text>"], "lines": []}
    assert read_json(campaign_dir(kernel.workspace) / "turn.json")["markup_gate"] == {"call_id": "t1-c1"}
    # The second delivery this turn goes out; the trailing tag is a bare wrapper, so it comes off first (§143.17).
    delivered = narrate(kernel, "t1-c2", tagged)
    assert delivered["rendered_text"] == "「钥匙你自己捡。」门外的走廊里没人来。"
    assert record(kernel, 1)["text"] == f"{{{{say:{KNOTT}}}}}「钥匙你自己捡。」{{{{/say}}}}门外的走廊里没人来。"
    finding = next(row for row in record(kernel, 1)["warnings"] if row["kind"] == "markup_in_prose")
    assert finding["lane"] == "delivery" and finding["quote"] == "</text>" and STEER in finding["fix"]
    assert finding["stripped"] is True
    assert [(row["ok"], row["outcome"], row["call_id"], row.get("stripped")) for row in markup_rows(kernel)] == [
        (False, "refused", "t1-c1", None), (True, "delivered", "t1-c2", True)]
    # The gate is the turn's: the next turn refuses again.
    kernel.table("player_input", text="我把钥匙捡起来。")
    assert "markup_gate" not in read_json(campaign_dir(kernel.workspace) / "turn.json")
    again = kernel.table_err("narrate", call_id="t2-c1", text="你捡起钥匙。\n\n- 铜齿朝上。")
    assert again["details"]["reason"] == "markup_in_prose" and again["details"]["lines"] == ["- 铜齿朝上。"]


def test_list_and_heading_lines_are_named_and_a_rewrite_lands_clean(kernel):
    open_turn(kernel)
    listed = "诺特靠回椅背。\n\n# 桌上\n- 钥匙躺在地板上。\n2. 地契歪着。"
    error = kernel.table_err("narrate", call_id="t1-c1", text=listed)
    assert error["details"]["tags"] == [] and error["details"]["lines"] == ["# 桌上", "- 钥匙躺在地板上。", "2. 地契歪着。"]
    clean = narrate(kernel, "t1-c2", "诺特靠回椅背。钥匙躺在地板上，地契歪着。")
    assert "warnings" not in record(kernel, 1) or not any(row["kind"] == "markup_in_prose" for row in record(kernel, 1)["warnings"])
    assert clean["rendered_text"] == "诺特靠回椅背。钥匙躺在地板上，地契歪着。"


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


def delivered_twice(kernel, text):
    """The same draft refused once, then delivered: the result, the turn record and its markup finding."""
    open_turn(kernel)
    assert kernel.table_err("narrate", call_id="t1-c1", text=text)["details"]["reason"] == "markup_in_prose"
    delivered = narrate(kernel, "t1-c2", text)
    turn = record(kernel, 1)
    return delivered, turn, next(row for row in turn["warnings"] if row["kind"] == "markup_in_prose")


def test_a_matching_pair_around_the_whole_text_is_taken_off(kernel):
    text = f"<text>\n{{{{say:{KNOTT}}}}}「坐吧。」{{{{/say}}}}\n\n诺特把钥匙推过来。\n</text>\n"
    delivered, turn, finding = delivered_twice(kernel, text)
    assert delivered["rendered_text"] == "「坐吧。」\n\n诺特把钥匙推过来。"
    assert turn["text"] == f"{{{{say:{KNOTT}}}}}「坐吧。」{{{{/say}}}}\n\n诺特把钥匙推过来。"
    assert "<text>" not in turn.get("marked_text", "") and len(turn["speech"]) == 1
    assert finding["quote"] == "<text>" and finding["stripped"] is True
    assert [row.get("stripped") for row in markup_rows(kernel)] == [None, True]


def test_a_lone_opening_tag_first_and_a_host_marker_beyond_a_closing_tag_are_still_a_wrapper(kernel):
    delivered, turn, finding = delivered_twice(kernel, "<text>诺特把钥匙推过来。")
    assert delivered["rendered_text"] == "诺特把钥匙推过来。" and finding["stripped"] is True
    # A host marker after the tag is gone from the render, so the tag still stands last there; it comes off the text.
    kernel.table("player_input", text="我接过钥匙。")
    marked = "你接过钥匙。</text>\n\n{{check:not-a-receipt}}"
    assert kernel.table_err("narrate", call_id="t2-c1", text=marked)["details"]["tags"] == ["</text>"]
    assert narrate(kernel, "t2-c2", marked)["rendered_text"] == "你接过钥匙。"
    assert "</text>" not in record(kernel, 2)["text"]
    assert next(row for row in record(kernel, 2)["warnings"] if row["kind"] == "markup_in_prose")["stripped"] is True


def test_a_tag_inside_the_prose_is_delivered_as_written(kernel):
    text = "诺特把<b>钥匙</b>推过来。"
    delivered, turn, finding = delivered_twice(kernel, text)
    assert delivered["rendered_text"] == text and turn["text"] == text
    assert finding["quote"] == "<b>" and "stripped" not in finding
    assert ["stripped" in row for row in markup_rows(kernel)] == [False, False]


def test_a_list_line_and_a_wrapper_beside_one_are_delivered_as_written(kernel):
    listed = "诺特靠回椅背。\n\n- 钥匙躺在地板上。"
    delivered, turn, finding = delivered_twice(kernel, listed)
    assert delivered["rendered_text"] == listed and "stripped" not in finding
    # A wrapper beside a list line is not a bare wrapper: the whole draft goes out as written.
    kernel.table("player_input", text="我看着地板。")
    mixed = "<text>诺特靠回椅背。\n\n- 钥匙躺在地板上。</text>"
    assert kernel.table_err("narrate", call_id="t2-c1", text=mixed)["details"]["reason"] == "markup_in_prose"
    assert narrate(kernel, "t2-c2", mixed)["rendered_text"] == mixed
    assert "stripped" not in next(row for row in record(kernel, 2)["warnings"] if row["kind"] == "markup_in_prose")


def test_tags_that_are_not_a_frame_are_delivered_as_written(kernel):
    # Two different names at the two ends, a self-closing tag last, and a tag first beside one inside: none is a frame.
    open_turn(kernel)
    for turn_no, text in ((1, "<text>诺特把钥匙推过来。</txt>"), (2, "诺特把钥匙推过来。<br/>"), (3, "<text>诺特把<b>钥匙</b>推过来。")):
        if turn_no > 1:
            kernel.table("player_input", text="我等着。")
        assert kernel.table_err("narrate", call_id=f"t{turn_no}-c1", text=text)["details"]["reason"] == "markup_in_prose"
        assert narrate(kernel, f"t{turn_no}-c2", text)["rendered_text"] == text
        assert "stripped" not in next(row for row in record(kernel, turn_no)["warnings"] if row["kind"] == "markup_in_prose")
