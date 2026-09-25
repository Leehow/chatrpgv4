"""T09 reference-first memory publication through the TypeScript kernel RPC seam.

These are protocol/storage conformance fixtures, not gameplay acceptance. The kernel owns
the committed originals, source cursor, identities, relation binding and durable merge.
"""

from __future__ import annotations

import json
from copy import deepcopy

import pytest

from conftest import CAMPAIGN, RpcClient, campaign_dir, create_campaign, narrate, narrate_opening, open_turn, read_json, read_jsonl


INVESTIGATOR = "托马斯·海斯"
KNOTT = "Steven Knott"
DOOLEY = "Mr. Dooley"
DOOLEY_LABEL = "Old Newsman"


def memory_dir(client: RpcClient):
    return campaign_dir(client.workspace) / "memory"


def referenced_job(client: RpcClient, turn: int = 1):
    return client.ok("memory.job", {"campaign": CAMPAIGN, "turn": turn, "mode": "referenced"})


def referenced_submit(client: RpcClient, packet: dict, decisions: list[dict], story: dict | None = None):
    referenced = {"step": packet["step"]["key"], "decisions": decisions}
    if story is not None:
        referenced["story"] = story
    return client.ok("memory.submit", {"campaign": CAMPAIGN, "job_id": packet["job_id"], "referenced": referenced})


def referenced_submit_error(client: RpcClient, packet: dict, decisions: list[dict], story: dict | None = None):
    referenced = {"step": packet["step"]["key"], "decisions": decisions}
    if story is not None:
        referenced["story"] = story
    return client.err("memory.submit", {"campaign": CAMPAIGN, "job_id": packet["job_id"], "referenced": referenced})


def skip_decisions(packet: dict):
    return [{"source": segment["alias"], "outcome": "skip"} for segment in packet["step"]["segments"]]


def decisions_with(packet: dict, annotations: dict[str, list[dict]], *, default: str = "skip"):
    return [
        {"source": segment["alias"], "outcome": "retain", "annotations": deepcopy(annotations[segment["alias"]])}
        if segment["alias"] in annotations
        else {"source": segment["alias"], "outcome": default}
        for segment in packet["step"]["segments"]
    ]


def unclear_story(packet: dict):
    if "story_context" not in packet:
        return None
    return {"status": "unclear", "thread": None, "frame_source": None,
            "bridge_delivered": False, "delivery_source": None}


def finish_step(client: RpcClient, packet: dict, decisions: list[dict]):
    return referenced_submit(client, packet, decisions, unclear_story(packet))


def play_turn(client: RpcClient, player: str, keeper: str, turn: int = 1):
    if turn == 1:
        open_turn(client, player)
    else:
        client.table("player_input", text=player)
    return narrate(client, f"t{turn}-c1", keeper)


def utf16_length(value: str):
    return len(value.encode("utf-16-le")) // 2


def candidate_rows(client: RpcClient):
    return read_jsonl(memory_dir(client) / "candidates.jsonl")


LONG_PLAYER_LINES = [
    "诺特答应送来钥匙。\r\n",
    "诺特答应送来钥匙。\r\n",
    "第三句保留两个空格  和组合字符 Cafe\u0301。\r\n",
    "第四句含有 emoji 🔑。\r\n",
    "第五句。\r\n",
    "第六句。\r\n",
    "第七句。\r\n",
    "第八句。\r\n",
    "第九句。\r\n",
    "第十句。\r\n",
    "第十一句。\r\n",
    "第十二句。\r\n",
    "第十三句。\r\n",
    "第十四句。",
]
LONG_PLAYER = "".join(LONG_PLAYER_LINES)
LONG_KEEPER = "诺特没有回答。\r\n钟声响了一次。"


def test_referenced_job_pages_every_exact_source_segment_and_publishes_without_copied_statements(kernel):
    narrated = play_turn(kernel, LONG_PLAYER, LONG_KEEPER)
    first = referenced_job(kernel)

    assert first["protocol"] == "memory-reference-v1"
    assert first["turn"] == 1 and len(first["commit"]) == 40 and first["commit"].startswith(narrated["commit"])
    assert set(first) == {"protocol", "job_id", "turn", "commit", "origin", "status", "step", "known_entities",
                          "prior", "prior_coverage", "story_context", "story_sources", "story_complete"}
    assert first["origin"]["scope"] == {"owner": f"campaign:{CAMPAIGN}", "campaign": CAMPAIGN,
                                         "worldline": "main", "loop": 0, "audience": "keeper"}
    assert first["origin"]["revision"]
    assert len(first["step"]["segments"]) == 12
    assert first["step"]["sequence"] == 0
    assert first["step"]["remaining"] == first["step"]["total"] > 12

    first_segments = first["step"]["segments"]
    assert [segment["alias"] for segment in first_segments] == [f"player:{index}" for index in range(12)]
    assert first_segments[0]["text"] == first_segments[1]["text"] == LONG_PLAYER_LINES[0]
    assert first_segments[0]["ref"] != first_segments[1]["ref"], "equal occurrences retain distinct coordinates"
    assert first_segments[2]["text"] == LONG_PLAYER_LINES[2]
    assert first_segments[3]["text"] == LONG_PLAYER_LINES[3]
    for segment in first_segments:
        ref = segment["ref"]
        assert ref["scope"] == first["origin"]["scope"]
        assert ref["sourceType"] == "turn" and ref["resource"] == "turn:1:player"
        assert ref["selector"]["kind"] == "utf16"
        assert ref["selector"]["end"] - ref["selector"]["start"] == utf16_length(segment["text"])

    malformed = decisions_with(first, {"player:0": [{"kind": "promise", "subject": KNOTT,
        "entities": [INVESTIGATOR], "statement": first_segments[0]["text"]}]})
    error = referenced_submit_error(kernel, first, malformed)
    assert error["code"] == "invalid_params"
    assert not (memory_dir(kernel) / "candidates.jsonl").exists(), "copied statement text never becomes authority"

    first_decisions = decisions_with(first, {
        "player:0": [{"kind": "promise", "subject": KNOTT, "entities": [INVESTIGATOR]}],
        "player:1": [{"kind": "promise", "subject": KNOTT, "entities": [INVESTIGATOR]}],
    })
    accepted = referenced_submit(kernel, first, first_decisions)
    assert accepted["status"] == "open"
    replay = referenced_submit(kernel, first, first_decisions)
    assert replay == {**accepted, "replayed": True}
    changed = deepcopy(first_decisions)
    changed[-1]["outcome"] = "defer"
    conflict = referenced_submit_error(kernel, first, changed)
    assert conflict["code"] == "idempotency_conflict"

    second = referenced_job(kernel)
    assert second["step"]["sequence"] == 1
    assert second["step"]["key"] != first["step"]["key"]
    assert len(second["step"]["segments"]) < 12
    assert second["step"]["remaining"] == len(second["step"]["segments"])
    all_segments = first_segments + second["step"]["segments"]
    assert len(all_segments) > 12
    assert [segment["alias"] for segment in all_segments] == [
        *[f"player:{index}" for index in range(len(LONG_PLAYER_LINES))], "keeper:0", "keeper:1"]
    assert "".join(segment["text"] for segment in all_segments if segment["role"] == "player") == LONG_PLAYER
    assert "".join(segment["text"] for segment in all_segments if segment["role"] == "keeper") == LONG_KEEPER

    second_decisions = skip_decisions(second)
    second_decisions[-1]["outcome"] = "defer"
    deferred = finish_step(kernel, second, second_decisions)
    assert deferred["status"] == "pending" and deferred["remaining"] == 1
    third = referenced_job(kernel)
    assert third["status"] == "pending" and third["story_complete"] is True
    assert third["step"]["sequence"] == 2 and third["step"]["remaining"] == 1
    assert third["step"]["segments"] == [second["step"]["segments"][-1]]
    completed = referenced_submit(kernel, third, skip_decisions(third))
    assert completed["status"] == "done"
    rows = candidate_rows(kernel)
    assert len(rows) == 2
    assert [row["statement"] for row in rows] == [LONG_PLAYER_LINES[0], LONG_PLAYER_LINES[1]]
    assert all(row["kind"] == "promise" and row["status"] == "candidate" for row in rows)
    assert all(row["memory_version"] == 2 and row["statement_ref"] == row["source_refs"][0] for row in rows)
    assert [row["statement_ref"] for row in rows] == [first_segments[0]["ref"], first_segments[1]["ref"]]
    assert all(row["relations"] == [] and "superseded_by" not in row for row in rows), (
        "two independent promises with the same parties coexist unless the model links an exact prior occurrence")
    stored = read_json(memory_dir(kernel) / "jobs" / f"{first['job_id']}.json")
    assert stored["record_commit"] == narrated["commit"] and stored["commit"] == first["commit"]
    coverage = kernel.table("capsule")["_context"]["memory_coverage"]
    assert coverage["committed"] == 2 and coverage["completed"] == 1 and coverage["gaps"] == 1
    assert not any(item["from"] <= 1 <= item["to"] for item in coverage["recent"]), (
        "the completed v2 job binds the retained short commit and must not reappear as missing")


def publish_single(client: RpcClient, player: str, keeper: str, annotation: dict, *, turn: int):
    play_turn(client, player, keeper, turn)
    packet = referenced_job(client, turn)
    source = next(segment["alias"] for segment in packet["step"]["segments"] if segment["role"] == "player")
    result = finish_step(client, packet, decisions_with(packet, {source: [annotation]}))
    assert result["status"] == "done"
    return packet, source, result


def test_correction_closes_only_the_selected_duplicate_occurrence(kernel):
    duplicate = "诺特说门已经锁好。"
    play_turn(kernel, duplicate + duplicate, "房间里很安静。", 1)
    first = referenced_job(kernel, 1)
    duplicates = [segment for segment in first["step"]["segments"] if segment["text"] == duplicate]
    assert len(duplicates) == 2
    finish_step(kernel, first, decisions_with(first, {
        duplicates[0]["alias"]: [{"kind": "knowledge", "subject": INVESTIGATOR, "entities": [KNOTT]}],
        duplicates[1]["alias"]: [{"kind": "knowledge", "subject": INVESTIGATOR, "entities": [KNOTT]}],
    }))
    original = candidate_rows(kernel)
    assert len(original) == 2 and original[0]["statement"] == original[1]["statement"] == duplicate

    play_turn(kernel, "我更正先前的一次记录。", "其中一次记录被明确撤回。", 2)
    correction = referenced_job(kernel, 2)
    offered = [prior for prior in correction["prior"] if prior["statement"] == duplicate]
    assert len(offered) == 2 and offered[0]["alias"] != offered[1]["alias"]
    stored = read_json(memory_dir(kernel) / "jobs" / f"{correction['job_id']}.json")
    target_id = next(target["id"] for target in stored["targets"] if target["alias"] == offered[0]["alias"])
    correction_source = next(segment["alias"] for segment in correction["step"]["segments"] if segment["role"] == "player")
    finish_step(kernel, correction, decisions_with(correction, {correction_source: [{
        "kind": "keeper_correction", "subject": INVESTIGATOR,
        "relations": [{"relation": "correction", "target": offered[0]["alias"]}],
    }]}))

    rows = {row["id"]: row for row in candidate_rows(kernel)}
    untouched_id = next(row["id"] for row in original if row["id"] != target_id)
    new = next(row for row in rows.values() if row["valid_from_turn"] == 2)
    assert rows[target_id]["status"] == "superseded" and rows[target_id]["superseded_by"] == new["id"]
    assert rows[untouched_id]["status"] == "candidate" and "superseded_by" not in rows[untouched_id]
    assert new["relations"] == [{"relation": "correction", "target": target_id}]


def test_temporal_change_keeps_the_old_occurrence_as_addressable_history(kernel):
    first, _, _ = publish_single(kernel, "我相信诺特仍在办公室。", "门后传来脚步声。",
                                  {"kind": "belief", "subject": INVESTIGATOR, "entities": [KNOTT]}, turn=1)
    old = candidate_rows(kernel)[0]

    play_turn(kernel, "后来我看见诺特离开了办公室。", "走廊尽头的门合上了。", 2)
    packet = referenced_job(kernel, 2)
    prior = next(item for item in packet["prior"] if item["statement"] == old["statement"])
    source = next(segment["alias"] for segment in packet["step"]["segments"] if segment["role"] == "player")
    finish_step(kernel, packet, decisions_with(packet, {source: [{
        "kind": "belief", "subject": INVESTIGATOR, "entities": [KNOTT],
        "relations": [{"relation": "temporal_change", "target": prior["alias"]}],
    }]}))

    rows = {row["id"]: row for row in candidate_rows(kernel)}
    current = next(row for row in rows.values() if row["valid_from_turn"] == 2)
    assert rows[old["id"]]["status"] == "superseded"
    assert rows[old["id"]]["valid_until_turn"] == 2
    assert rows[old["id"]]["superseded_by"] == current["id"]
    assert current["relations"] == [{"relation": "temporal_change", "target": old["id"]}]
    assert rows[old["id"]]["statement"] == old["statement"], "closing a temporal occurrence preserves its exact history"


@pytest.mark.parametrize("change", ["source", "scope"])
def test_publication_rejects_changed_committed_original_or_active_scope(kernel, change):
    narrated = play_turn(kernel, "我查看诺特留下的信。", "信纸仍在桌上。")
    packet = referenced_job(kernel)
    decisions = skip_decisions(packet)
    if change == "source":
        path = campaign_dir(kernel.workspace) / "turns" / "0001.json"
        record = read_json(path)
        record["player_text"] += "被修改"
        path.write_text(json.dumps(record, ensure_ascii=False), encoding="utf-8")
    else:
        kernel.table("branch", commit=narrated["commit"], name="memory-scope-change")

    error = referenced_submit_error(kernel, packet, decisions, unclear_story(packet))
    assert error["code"] == "invalid_params"
    assert not (memory_dir(kernel) / "candidates.jsonl").exists()


def test_story_assessment_uses_issued_source_aliases_instead_of_copied_text(kernel):
    player = "我怀疑诺特隐瞒了事实。"
    play_turn(kernel, player, "诺特沉默了。")
    packet = referenced_job(kernel)
    assert packet["story_context"]["threads"]
    player_source = next(segment for segment in packet["story_sources"] if segment["role"] == "player")
    copied = {"status": "misframed", "thread": packet["story_context"]["threads"][0]["thread"],
              "frame": player, "bridge_delivered": False, "delivery_quote": None}
    error = referenced_submit_error(kernel, packet, skip_decisions(packet), copied)
    assert error["code"] == "invalid_params"

    selected = {"status": "misframed", "thread": packet["story_context"]["threads"][0]["thread"],
                "frame_source": player_source["alias"], "bridge_delivered": False, "delivery_source": None}
    result = referenced_submit(kernel, packet, skip_decisions(packet), selected)
    assert result["status"] == "done"
    story = read_jsonl(memory_dir(kernel) / "story.jsonl")[-1]
    assert story["frame"] == player_source["text"] == player
    assert story["frame_ref"] == player_source["ref"]
    assert story["delivery_quote"] is None and "delivery_ref" not in story


def test_duplicate_spoken_occurrences_publish_exact_refs_and_distinct_canonical_speakers(kernel):
    spoken = '"The key is on the desk."'
    player = "I listen to both speakers."
    keeper = (f"The lamp flickers. {{{{say:{KNOTT}}}}}{spoken}{{{{/say}}}} "
              f"{{{{say:{DOOLEY}}}}}{spoken}{{{{/say}}}} The clock strikes.")
    play_turn(kernel, player, keeper)
    packet = referenced_job(kernel)
    speech = [segment for segment in packet["step"]["segments"]
              if segment["attribution"]["kind"] == "speech" and segment["text"].strip() == spoken]
    assert len(speech) == 2
    assert speech[0]["text"] == speech[1]["text"]
    assert speech[0]["alias"] != speech[1]["alias"] and speech[0]["ref"] != speech[1]["ref"]
    assert [segment["attribution"] for segment in speech] == [
        {"kind": "speech", "speaker": {"name": KNOTT, "kind": "npc"}},
        {"kind": "speech", "speaker": {"name": DOOLEY, "kind": "npc"}},
    ]

    result = finish_step(kernel, packet, decisions_with(packet, {
        speech[0]["alias"]: [{"kind": "promise", "subject": KNOTT, "entities": [INVESTIGATOR]}],
        speech[1]["alias"]: [{"kind": "knowledge", "subject": INVESTIGATOR,
                               "knowers": [INVESTIGATOR], "entities": [KNOTT]}],
    }))
    assert result["status"] == "done"
    rows = candidate_rows(kernel)
    assert len(rows) == 2
    for row, source in zip(rows, speech, strict=True):
        assert row["statement"] == source["text"]
        assert row["statement_ref"] == source["ref"]
        assert row["source_refs"] == [source["ref"]]
        assert row["attribution"] == source["attribution"]
    assert [row["kind"] for row in rows] == ["promise", "knowledge"]
    recalled = {row["id"]: row for row in kernel.table("recall", what="memory")["hits"]}
    capsule = {row["id"]: row for row in kernel.table("capsule")["memory"]}
    for row in rows:
        assert recalled[row["id"]]["attribution"] == row["attribution"]
        assert capsule[row["id"]]["attribution"] == row["attribution"]


def test_world_event_rejects_player_and_spoken_reports_but_accepts_exact_keeper_narration(kernel):
    spoken = '"The bell rang."'
    play_turn(kernel, "The player says the bell rang.",
              f"The actual bell rings. {{{{say:{KNOTT}}}}}{spoken}{{{{/say}}}} The echo fades.")
    packet = referenced_job(kernel)
    player_source = next(segment for segment in packet["step"]["segments"] if segment["attribution"]["kind"] == "player")
    speech_source = next(segment for segment in packet["step"]["segments"] if segment["attribution"]["kind"] == "speech")
    narration_source = next(segment for segment in packet["step"]["segments"]
                            if segment["attribution"]["kind"] == "keeper_narration")
    world_event = lambda alias: decisions_with(packet, {alias: [{"kind": "world_event", "subject": "world"}]})

    for source in [player_source, speech_source]:
        error = referenced_submit_error(kernel, packet, world_event(source["alias"]), unclear_story(packet))
        assert error["code"] == "invalid_params"
        assert "world event" in error["message"].lower()
        assert not (memory_dir(kernel) / "candidates.jsonl").exists()

    result = referenced_submit(kernel, packet, world_event(narration_source["alias"]), unclear_story(packet))
    assert result["status"] == "done"
    rows = candidate_rows(kernel)
    assert len(rows) == 1
    assert rows[0]["kind"] == "world_event" and rows[0]["subject"] == "world"
    assert rows[0]["statement"] == narration_source["text"]
    assert rows[0]["statement_ref"] == narration_source["ref"]
    assert rows[0]["source_refs"] == [narration_source["ref"]]
    assert rows[0]["attribution"] == {"kind": "keeper_narration"}


def test_offstage_speaker_and_table_alias_bind_one_entity_and_reach_actual_promise_consumers(kernel):
    player_promise = "I report that Mr. Dooley promised to return tomorrow."
    canonical_promise = '"I promise to return tomorrow."'
    alias_report = '"I remember where the key is."'
    open_turn(kernel, player_promise)
    kernel.table("apply", call_id="t1-c1", effects=[{
        "kind": "person", "who": DOOLEY, "name": DOOLEY_LABEL, "why": "the table established this name"}])
    narrate(kernel, "t1-c2", (f"The shop is closed. {{{{say:{DOOLEY}}}}}{canonical_promise}{{{{/say}}}} "
                               f"{{{{say:{DOOLEY_LABEL}}}}}{alias_report}{{{{/say}}}}"))
    packet = referenced_job(kernel)
    names = [(row["name"], row["kind"]) for row in packet["known_entities"]]
    assert (DOOLEY, "npc") in names and (DOOLEY_LABEL, "npc") in names
    player_source = next(segment for segment in packet["step"]["segments"] if segment["attribution"]["kind"] == "player")
    canonical_source = next(segment for segment in packet["step"]["segments"] if canonical_promise in segment["text"])
    alias_source = next(segment for segment in packet["step"]["segments"] if alias_report in segment["text"])
    assert canonical_source["attribution"] == alias_source["attribution"] == {
        "kind": "speech", "speaker": {"name": DOOLEY_LABEL, "kind": "npc"}}

    result = finish_step(kernel, packet, decisions_with(packet, {
        player_source["alias"]: [{"kind": "promise", "subject": DOOLEY, "entities": [INVESTIGATOR]}],
        canonical_source["alias"]: [{"kind": "promise", "subject": DOOLEY_LABEL, "entities": [INVESTIGATOR]}],
        alias_source["alias"]: [{"kind": "knowledge", "subject": DOOLEY_LABEL,
                                  "knowers": [DOOLEY, DOOLEY_LABEL], "entities": [INVESTIGATOR]}],
    }))
    assert result["status"] == "done"
    rows = candidate_rows(kernel)
    promises = [row for row in rows if row["kind"] == "promise"]
    knowledge = next(row for row in rows if row["kind"] == "knowledge")
    assert len(promises) == 2 and all(row["subject"] == DOOLEY for row in promises)
    assert knowledge["subject"] == DOOLEY and knowledge["knowers"] == [DOOLEY]
    assert knowledge["entities"] == [INVESTIGATOR], "two issued names for Dooley bind and deduplicate to one entity"

    # §134.18: the office states the commission, whose open scene row shares the capsule's 1 KB obligations section and trims
    # the rows after it; the promise consumers are read in a scene that states no obligation.
    kernel.table("player_input", text="I meet the newsman on his corner.")
    kernel.table("apply", call_id="t2-c1", effects=[{"kind": "move", "to": "neighborhood-gossip"},
        {"kind": "npc", "name": DOOLEY, "to": "here", "why": "make the promise consumer visible"}])
    capsule = kernel.table("capsule")
    obligations = {row["state"]: row for row in capsule["obligations"] if row["kind"] == "promise"}
    assert obligations[player_source["text"]]["authority"] == "conversation_report"
    assert obligations[player_source["text"]]["attribution"] == {"kind": "player"}
    assert obligations[canonical_source["text"]]["authority"] == "conversation_report"
    assert obligations[canonical_source["text"]]["attribution"] == canonical_source["attribution"]
    dooley = next(row for row in capsule["present"] if row.get("history", {}).get("promises"))
    history = {row["statement"]: row for row in dooley["history"]["promises"]}
    for source in [player_source, canonical_source]:
        assert history[source["text"]]["authority"] == "conversation_report"
        assert history[source["text"]]["attribution"] == source["attribution"]


def test_unresolved_speaker_label_remains_attributed_text_but_never_becomes_an_entity(kernel):
    label = "The stranger by the window"
    open_turn(kernel, "I listen.")
    narrate(kernel, "t1-c1", f"{{{{say:{label}}}}}\"Wait here.\"{{{{/say}}}}")
    packet = referenced_job(kernel)
    assert not any(row["name"] == label for row in packet["known_entities"])
    source = next(segment for segment in packet["step"]["segments"] if segment["attribution"]["kind"] == "speech")
    assert source["attribution"] == {"kind": "speech", "speaker": {"name": label, "kind": "label"}}
    error = referenced_submit_error(kernel, packet, decisions_with(packet, {
        source["alias"]: [{"kind": "promise", "subject": label, "entities": [INVESTIGATOR]}],
    }), unclear_story(packet))
    assert error["code"] == "invalid_params"
    assert label in error["message"]
    assert not (memory_dir(kernel) / "candidates.jsonl").exists()


def test_default_referenced_dispatch_retries_pending_once_and_exclusions_advance_to_another_turn(kernel):
    play_turn(kernel, "第一回合的原文。", "第一回合的回应。", 1)
    play_turn(kernel, "第二回合仍有不确定内容。", "第二回合的回应。", 2)
    packet = referenced_job(kernel, 2)
    deferred = [{"source": segment["alias"], "outcome": "defer"} for segment in packet["step"]["segments"]]
    result = referenced_submit(kernel, packet, deferred, unclear_story(packet))
    assert result["status"] == "pending" and result["remaining"] == len(packet["step"]["segments"])

    retry = kernel.ok("memory.job", {"campaign": CAMPAIGN, "mode": "referenced"})
    assert retry["turn"] == 2 and retry["status"] == "pending"
    another = kernel.ok("memory.job", {"campaign": CAMPAIGN, "mode": "referenced", "exclude_turns": [2]})
    assert another["turn"] == 1 and another["protocol"] == "memory-reference-v1"


def test_referenced_jobs_are_committed_only_and_do_not_convert_started_legacy_jobs(kernel):
    create_campaign(kernel)
    narrate_opening(kernel)
    kernel.table("player_input", text="这一回合还没有提交。")
    error = kernel.err("memory.job", {"campaign": CAMPAIGN, "turn": 1, "mode": "referenced"})
    assert error["code"] == "invalid_params"

    narrate(kernel, "t1-c1", "现在整回合已经提交。")
    legacy = kernel.ok("memory.job", {"campaign": CAMPAIGN, "turn": 1})
    assert "protocol" not in legacy
    same = referenced_job(kernel, 1)
    assert same == legacy, "an already-open legacy job is not silently converted"
    completed = kernel.ok("memory.submit", {"campaign": CAMPAIGN, "job_id": legacy["job_id"], "candidates": []})
    assert completed["candidates"] == 0
    assert referenced_job(kernel, 1) == legacy, "completed legacy packets remain readable"


def test_a_canonically_completed_campaign_accepts_its_committed_memory_job(kernel):
    open_turn(kernel, "我结束这次调查。")
    kernel.table("resolve", call_id="t1-c1", action={"intent": "montage",
        "goal": "Account for the source-reviewed conclusion.", "method": "",
        "decision": "development:end-session"})
    kernel.table("apply", call_id="t1-c2", effects=[{
        "kind": "ending", "scope": "campaign", "summary": "The investigation is over."}])
    narrated = narrate(kernel, "t1-c3", "调查到此结束。")
    assert read_json(campaign_dir(kernel.workspace) / "campaign.json")["status"] == "completed"

    packet = referenced_job(kernel, 1)
    assert packet["commit"].startswith(narrated["commit"])
    result = finish_step(kernel, packet, skip_decisions(packet))
    assert result["status"] == "done"
    assert referenced_job(kernel, 1)["status"] == "done"


def test_prepared_referenced_step_recovers_after_process_restart(tmp_path):
    workspace = tmp_path / "ws"
    first = RpcClient(workspace)
    try:
        play_turn(first, "我记得诺特答应送来钥匙。", "诺特没有否认。")
        packet = referenced_job(first)
        job_path = memory_dir(first) / "jobs" / f"{packet['job_id']}.json"
        before = read_json(job_path)
        source = next(segment["alias"] for segment in packet["step"]["segments"] if segment["role"] == "player")
        decisions = decisions_with(packet, {source: [{"kind": "promise", "subject": KNOTT,
                                                       "entities": [INVESTIGATOR]}]})
        completed = finish_step(first, packet, decisions)
        assert completed["status"] == "done"
        durable = read_json(job_path)
        assert len(durable["steps"]) == 1
        prepared = durable["steps"][0]["prepared"]
    finally:
        first.close()

    job_path.write_text(json.dumps({**before, "prepared": prepared}, ensure_ascii=False), encoding="utf-8")

    second = RpcClient(workspace)
    try:
        recovered = referenced_job(second)
        assert recovered["status"] == "done" and recovered["step"]["remaining"] == 0
        rows = candidate_rows(second)
        assert len(rows) == 1 and rows[0]["statement_ref"] == packet["step"]["segments"][0]["ref"]
        assert len([event for event in read_jsonl(campaign_dir(workspace) / "events.jsonl")
                    if event["type"] == "memory-written"]) == 1
        replay = referenced_submit(second, packet, decisions, unclear_story(packet))
        assert replay["replayed"] is True
        assert len(candidate_rows(second)) == 1
    finally:
        second.close()


@pytest.mark.parametrize("field,replacement", [
    ("kind", "promise"),
    ("subject", KNOTT),
    ("knowers", [KNOTT]),
    ("privacy", "keeper_only"),
    ("relations", [{"relation": "independent", "target": "mem:t0-1"}]),
])
def test_prepared_recovery_rejects_semantic_row_drift_before_secondary_projection(tmp_path, field, replacement):
    workspace = tmp_path / "ws"
    first = RpcClient(workspace)
    try:
        play_turn(first, "I remember the exact report.", "The room remains quiet.")
        packet = referenced_job(first)
        source = next(segment["alias"] for segment in packet["step"]["segments"] if segment["role"] == "player")
        decisions = decisions_with(packet, {source: [{"kind": "knowledge", "subject": INVESTIGATOR,
                                                       "knowers": [INVESTIGATOR], "entities": [KNOTT]}]})
        job_path = memory_dir(first) / "jobs" / f"{packet['job_id']}.json"
        before = read_json(job_path)
        assert finish_step(first, packet, decisions)["status"] == "done"
        durable = read_json(job_path)
        prepared = durable["steps"][0]["prepared"]
    finally:
        first.close()

    candidates_path = memory_dir(first) / "candidates.jsonl"
    changed = read_jsonl(candidates_path)
    assert len(changed) == 1
    unchanged_statement = changed[0]["statement"]
    unchanged_ref = deepcopy(changed[0]["statement_ref"])
    changed[0][field] = replacement
    assert changed[0]["statement"] == unchanged_statement and changed[0]["statement_ref"] == unchanged_ref
    candidates_path.write_text("".join(json.dumps(row, ensure_ascii=False) + "\n" for row in changed), encoding="utf-8")
    restored = {**before, "prepared": prepared}
    job_path.write_text(json.dumps(restored, ensure_ascii=False), encoding="utf-8")
    projection_paths = [campaign_dir(workspace) / "npc-ledger.json", campaign_dir(workspace) / "events.jsonl",
                        memory_dir(first) / "story.jsonl"]
    projections = {path: path.read_bytes() if path.exists() else None for path in projection_paths}

    second = RpcClient(workspace)
    try:
        error = second.err("memory.job", {"campaign": CAMPAIGN, "turn": 1, "mode": "referenced"})
        assert error["code"] == "idempotency_conflict"
        assert "different content" in error["message"]
    finally:
        second.close()

    assert read_json(job_path) == restored, "the conflicting prepared step does not advance its durable cursor"
    assert read_jsonl(candidates_path) == changed, "recovery does not overwrite the conflicting retained occurrence"
    for path, before_bytes in projections.items():
        assert (path.read_bytes() if path.exists() else None) == before_bytes, f"{path.name} changed before immutable-row acceptance"
