"""Contract §139.10: player-facing prose carries no markup.

A syntax check over the text `narrate` renders, after the host's own say tokens and mechanics markers are stripped:
an XML/HTML-shaped tag, or a line opening with a markdown list or heading marker. The first delivery of a turn that
carries it is refused `needs` with the steer and `details.reason = "markup_in_prose"`, and `turn.json` remembers the
refusal (`markup_gate`); a later delivery in the same turn is delivered as written with a `warnings` row. Both are
counted on the `lane: "delivery"` telemetry row. Through the RPC seam."""

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
    # The second delivery this turn that still carries it goes out as written.
    delivered = narrate(kernel, "t1-c2", tagged)
    assert delivered["rendered_text"].endswith("</text>")
    finding = next(row for row in record(kernel, 1)["warnings"] if row["kind"] == "markup_in_prose")
    assert finding["lane"] == "delivery" and finding["quote"] == "</text>" and STEER in finding["fix"]
    assert [(row["ok"], row["outcome"], row["call_id"]) for row in markup_rows(kernel)] == [
        (False, "refused", "t1-c1"), (True, "delivered", "t1-c2")]
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
