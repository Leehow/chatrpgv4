"""Slice 2, 12.3 and the memory road of 12.4: job packets, closed submit validation,
supersession, replay, backlog, recall narrowing and ranking. Through the RPC seam,
asserting on memory/*.jsonl, memory/jobs/*.json and events.jsonl."""

import json
import re

from conftest import narrate, CAMPAIGN, campaign_dir, open_turn, read_json, read_jsonl

INV = "托马斯·海斯"
KNOTT = "Steven Knott"


def memory_dir(workspace):
    return campaign_dir(workspace) / "memory"


def job(client, **params):
    return client.ok("memory.job", {"campaign": CAMPAIGN, **params})


def submit(client, job_id, candidates):
    return client.ok("memory.submit", {"campaign": CAMPAIGN, "job_id": job_id, "candidates": candidates})


def submit_err(client, job_id, candidates):
    return client.err("memory.submit", {"campaign": CAMPAIGN, "job_id": job_id, "candidates": candidates})


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

def test_job_packet_is_names_only(kernel):
    narrated = first_turn(kernel)
    assert narrated["extraction"] == {"job_id": "extract:c1:t1"}
    packet = job(kernel)
    assert set(packet) == {"job_id", "turn", "commit", "scene", "present", "investigators", "player_text",
                           "keeper_text", "committed_facts", "known_entities", "prior", "story_context", "budget", "instruction"}
    assert packet["job_id"] == "extract:c1:t1" and packet["turn"] == 1 and packet["commit"] == narrated["commit"]
    assert packet["scene"] == {"name": "commission-briefing", "display_name": "Knott's Office"}
    assert packet["present"] == [KNOTT]
    assert packet["investigators"] == [{"id": "thomas-hayes", "name": INV}]
    assert packet["player_text"] == "我仔细观察诺特。"
    assert packet["keeper_text"] == "诺特叹了口气。\n\n他把钥匙推过来。"
    assert packet["committed_facts"] == narrated["facts"]["committed"]
    assert packet["known_entities"] == [{"name": INV, "kind": "investigator"}, {"name": KNOTT, "kind": "npc"},
                                        {"name": "Knott's Office", "kind": "scene"}, {"name": "knott-keys", "kind": "clue"}]
    assert packet["prior"] == []
    assert packet["story_context"]["threads"]
    assert set(packet["story_context"]["threads"][0]) == {"thread", "claim", "importance", "supporting", "contradicting"}
    assert packet["story_context"]["last_assessment"] is None
    assert packet["budget"] == {"max_candidates": 12, "max_statement_chars": 400}
    assert "known_entities" in packet["instruction"] and "world" in packet["instruction"]
    # No machine keys beside turn and commit: no hashes, no receipt ids, no call ids.
    prompt_material = json.dumps({k: v for k, v in packet.items() if k not in ("turn", "commit")}, ensure_ascii=False)
    assert not re.search(r"[0-9a-f]{40}", prompt_material)
    assert not re.search(r"\b(roll|move|clue|delta|time|session):[a-z]", prompt_material)
    assert not re.search(r"\bt\d+-c\d+\b", prompt_material)
    stored = read_json(memory_dir(kernel.workspace) / "jobs" / "extract:c1:t1.json")
    assert stored["status"] == "open" and stored["packet"]["job_id"] == "extract:c1:t1"
    assert stored["receipts"] == ["roll:psychology-t1-c1", "clue:knott-keys-t1"]


def test_default_job_is_the_latest_committed_turn_without_a_done_job(kernel):
    first_turn(kernel)
    close_turn(kernel, 2)
    assert job(kernel)["turn"] == 2
    submit(kernel, "extract:c1:t2", [])
    assert job(kernel)["turn"] == 1
    submit(kernel, "extract:c1:t1", [])
    assert job(kernel)["turn"] == 0  # the opening narrate is a committed turn too
    submit(kernel, "extract:c1:t0", [])
    assert job(kernel) == {"job_id": None, "turn": None}
    # An explicit turn always yields the packet, done or not; a turn closed by ask has none.
    assert job(kernel, turn=1)["job_id"] == "extract:c1:t1"
    kernel.table("player_input", text="推门？")
    kernel.table("ask", call_id="t3-c1", prompt="进吗？", options=["进", "不进"])
    assert kernel.err("memory.job", {"campaign": CAMPAIGN, "turn": 3})["code"] == "invalid_params"
    assert kernel.err("memory.job", {"campaign": CAMPAIGN, "turn": 9})["details"]["committed_turns"] == [0, 1, 2]


def test_job_can_be_rebuilt_without_episode_or_job_file(kernel):
    first_turn(kernel)
    (memory_dir(kernel.workspace) / "episodes.jsonl").unlink()
    packet = job(kernel, turn=1)
    assert packet["known_entities"][1] == {"name": KNOTT, "kind": "npc"}
    # submit without a prior memory.job in this process still lands (12.6)
    (memory_dir(kernel.workspace) / "jobs" / "extract:c1:t1.json").unlink()
    result = submit(kernel, "extract:c1:t1", [{"kind": "world_event", "subject": "world", "statement": "诺特交出了钥匙。"}])
    assert result["written"] == ["mem:t1-1"]


def test_a_person_who_leaves_during_the_turn_remains_a_valid_memory_subject(kernel):
    open_turn(kernel, "我拒绝委托，诺特随后离开。")
    kernel.table("apply", call_id="t1-c1", effects=[{"kind": "npc", "name": KNOTT, "to": "away",
                                                       "why": "The meeting ended."}])
    narrate(kernel, "t1-c2", "诺特说完最后一句话，拿起钥匙离开了办公室。")
    packet = job(kernel, turn=1)
    assert KNOTT in packet["present"]
    assert {"name": KNOTT, "kind": "npc"} in packet["known_entities"]
    result = kernel.ok("memory.submit", {"campaign": CAMPAIGN, "job_id": packet["job_id"],
        "candidates": [{"kind": "knowledge", "subject": KNOTT, "statement": "诺特知道海斯拒绝了委托。"}]})
    assert result["candidates"] == 1 and result["written"] == ["mem:t1-1"]


# ---- submit -------------------------------------------------------------------------------

def test_submit_lands_candidates_and_writes_the_files(kernel):
    narrated = first_turn(kernel)
    packet = job(kernel)
    result = submit(kernel, packet["job_id"], [
        {"kind": "world_event", "subject": "world", "statement": "诺特把房子的钥匙交给了调查员。"},
        {"kind": "knowledge", "subject": INV, "knowers": [INV], "entities": ["steven-knott"],
         "statement": "诺特急着把房子租出去。"},
        {"kind": "relationship", "subject": KNOTT, "entities": ["thomas-hayes"], "statement": "雇主与雇员。",
         "privacy": "keeper_only", "state": "uncertain", "confidence": 0.6},
    ])
    assert result == {"job_id": "extract:c1:t1", "turn": 1, "candidates": 3,
                      "written": ["mem:t1-1", "mem:t1-2", "mem:t1-3"], "superseded": []}
    rows = read_jsonl(memory_dir(kernel.workspace) / "candidates.jsonl")
    assert [r["id"] for r in rows] == ["mem:t1-1", "mem:t1-2", "mem:t1-3"]
    assert all(r["status"] == "candidate" and r["valid_from_turn"] == 1 and r["job_id"] == "extract:c1:t1" for r in rows)
    assert rows[0]["source"] == {"turn": 1, "commit": narrated["commit"], "episode_id": "ep:t1",
                                 "receipts": ["roll:psychology-t1-c1", "clue:knott-keys-t1"]}
    assert rows[1]["subject"] == INV and rows[1]["knowers"] == [INV] and rows[1]["entities"] == [KNOTT]
    assert rows[1]["privacy"] == "player_safe" and rows[1]["state"] == "accurate" and rows[1]["confidence"] is None
    assert rows[2]["entities"] == [INV] and rows[2]["privacy"] == "keeper_only" and rows[2]["confidence"] == 0.6
    stored = read_json(memory_dir(kernel.workspace) / "jobs" / "extract:c1:t1.json")
    assert stored["status"] == "done" and stored["result"] == result and stored["candidates_sha256"]
    episodes = read_jsonl(memory_dir(kernel.workspace) / "episodes.jsonl")
    assert [e["episode_id"] for e in episodes] == ["ep:t0", "ep:t1"]
    assert episodes[1] == {**episodes[1], "turn": 1, "commit": narrated["commit"], "scene": "commission-briefing",
                           "present": [KNOTT], "investigators": ["thomas-hayes"],
                           "receipts": ["roll:psychology-t1-c1", "clue:knott-keys-t1"], "clues_discovered": ["钥匙"],
                           "player_chars": 8}
    assert episodes[1]["keeper_chars"] == len(narrated["rendered_text"])
    written = [e for e in read_jsonl(campaign_dir(kernel.workspace) / "events.jsonl") if e["type"] == "memory-written"]
    assert len(written) == 1 and written[0]["turn"] == 1
    assert written[0]["data"] == {"job_id": "extract:c1:t1", "turn": 1, "candidates": 3, "superseded": 0}
    assert not (memory_dir(kernel.workspace) / "backlog.jsonl").exists()


def test_an_entity_name_that_matches_nothing_is_dropped_and_the_batch_still_lands(kernel):
    """An entity link is an index into the graph, not the fact itself (contract §32.9). One invented
    name used to reject the submit and lose every candidate of that turn with it: `admission-e2e-4`
    turn 11 wrote 二楼卧室 for a scene the Keeper had never labelled and the whole batch went. Subject
    and knowers stay strict, because they say whose knowledge this is."""
    first_turn(kernel)
    job_id = job(kernel)["job_id"]
    ok = {"kind": "knowledge", "subject": INV, "statement": "好的。"}
    result = submit(kernel, job_id, [{**ok, "entities": ["knott-keys", "二楼卧室"]},
                                     {**ok, "statement": "另一条。"}])
    assert result["candidates"] == 2, "the candidate keeps its statement and the batch keeps the rest"
    assert result["dropped_entities"] == ["二楼卧室"], "and the result says which name matched nothing"
    landed = read_jsonl(memory_dir(kernel.workspace) / "candidates.jsonl")
    assert [row["entities"] for row in landed] == [["knott-keys"], []]
    # An unresolvable subject is still a refusal, and so is an unresolvable entity of a relationship or
    # a promise: there the other party is half the statement and the key the kind supersedes on.
    assert submit_err(kernel, job(kernel)["job_id"], [{**ok, "subject": "Walter Corbitt"}])["code"] == "invalid_params"
    promise = [{"kind": "promise", "subject": KNOTT, "entities": ["a stranger"], "statement": "x"}]
    assert submit_err(kernel, job(kernel)["job_id"], promise)["code"] == "invalid_params"


def test_each_rejection_points_at_the_candidate_and_names_usable_names(kernel):
    first_turn(kernel)
    job_id = job(kernel)["job_id"]
    ok = {"kind": "knowledge", "subject": INV, "statement": "好的。"}
    cases = [
        ("unknown field", [{**ok, "mood": "happy"}], 0, "mood"),
        ("machine key", [ok, {**ok, "commit": "abc"}], 1, "commit"),
        ("machine key id", [{**ok, "id": "mem:t1-9"}], 0, "id"),
        ("unknown kind", [{**ok, "kind": "rumor"}], 0, "world_event"),
        ("unresolvable subject", [ok, ok, {**ok, "subject": "Walter Corbitt"}], 2, KNOTT),
        ("scene is not a knower", [{**ok, "knowers": ["Knott's Office"]}], 0, KNOTT),
        ("world_event with a person", [{"kind": "world_event", "subject": KNOTT, "statement": "x"}], 0, "world"),
        ("relationship without entity", [{"kind": "relationship", "subject": KNOTT, "statement": "x"}], 0, "entities"),
        ("relationship with two", [{"kind": "relationship", "subject": KNOTT, "entities": [INV, "knott-keys"],
                                    "statement": "x"}], 0, "entities"),
        ("statement too long", [{**ok, "statement": "长" * 401}], 0, "400"),
        ("empty statement", [{**ok, "statement": "  "}], 0, "statement"),
        ("bad privacy", [{**ok, "privacy": "secret"}], 0, "keeper_only"),
        ("bad state", [{**ok, "state": "wrong"}], 0, "distorted"),
        ("bad confidence", [{**ok, "confidence": 2}], 0, "0"),
        ("too many", [ok] * 13, 12, "12"),
    ]
    for label, candidates, index, named in cases:
        error = submit_err(kernel, job_id, candidates)
        assert error["code"] == "invalid_params", label
        assert error["details"]["index"] == index, label
        assert named in (error.get("fix") or "") + error["message"], (label, error)
    unresolved = submit_err(kernel, job_id, [{**ok, "subject": "Walter Corbitt"}])
    assert unresolved["details"]["candidates"] == [INV, KNOTT, "Knott's Office", "knott-keys"]
    assert INV in unresolved["fix"] and "knott-keys" in unresolved["fix"]
    # Nothing landed, the job stays open, every rejection is a pending backlog row.
    assert not (memory_dir(kernel.workspace) / "candidates.jsonl").exists()
    assert read_json(memory_dir(kernel.workspace) / "jobs" / f"{job_id}.json")["status"] == "open"
    backlog = read_jsonl(memory_dir(kernel.workspace) / "backlog.jsonl")
    assert len(backlog) == len(cases) + 1
    assert all(r["job_id"] == job_id and r["turn"] == 1 and r["reason"] == "invalid" and r["status"] == "pending"
               and r["detail"] and r["at"] for r in backlog)
    assert job(kernel)["turn"] == 0  # turn 1 is backlogged: not the default any more
    # A good submit recovers the backlog rows.
    submit(kernel, job_id, [ok])
    backlog = read_jsonl(memory_dir(kernel.workspace) / "backlog.jsonl")
    assert {r["status"] for r in backlog} == {"recovered"} and all(r["recovered_at"] for r in backlog)
    assert not [e for e in read_jsonl(campaign_dir(kernel.workspace) / "events.jsonl")
                if e["type"] == "memory-written" and e["data"]["candidates"] != 1]


def test_ambiguous_name_is_rejected_with_ids_to_choose_from(kernel):
    first_turn(kernel)
    # An investigator who shares the NPC's name: both are present, so the bare name is ambiguous.
    party = campaign_dir(kernel.workspace) / "party"
    twin = read_json(party / "thomas-hayes.json")
    twin["id"], twin["name"] = "knott-twin", KNOTT
    (party / "knott-twin.json").write_text(json.dumps(twin, ensure_ascii=False), encoding="utf-8")
    packet = job(kernel, turn=1)
    assert [e["name"] for e in packet["known_entities"] if e["name"] == KNOTT] == [KNOTT, KNOTT]
    error = submit_err(kernel, packet["job_id"], [{"kind": "knowledge", "subject": KNOTT, "statement": "x"}])
    assert error["code"] == "invalid_params" and error["details"]["index"] == 0
    assert error["details"]["candidates"] == [{"name": KNOTT, "kind": "investigator", "id": "knott-twin"},
                                              {"name": KNOTT, "kind": "npc", "id": "npc-steven-knott"}]
    assert "knott-twin" in error["fix"] and "npc-steven-knott" in error["fix"]
    # The handle collides with the name under normalization; the ids offered resolve.
    assert submit_err(kernel, packet["job_id"], [{"kind": "knowledge", "subject": "steven-knott", "statement": "x"}])["details"]["index"] == 0
    result = submit(kernel, packet["job_id"], [{"kind": "knowledge", "subject": "npc-steven-knott", "statement": "x"},
                                               {"kind": "knowledge", "subject": "knott-twin", "statement": "y"}])
    rows = read_jsonl(memory_dir(kernel.workspace) / "candidates.jsonl")
    assert result["candidates"] == 2 and [r["subject"] for r in rows] == [KNOTT, KNOTT]


def test_relationship_supersession_keeps_both_records(kernel):
    first_turn(kernel)
    submit(kernel, "extract:c1:t1", [
        {"kind": "relationship", "subject": KNOTT, "entities": [INV], "statement": "雇主，客气而疏远。"},
        {"kind": "knowledge", "subject": KNOTT, "entities": [INV], "statement": "知道调查员的名字。"},
    ])
    close_turn(kernel, 2)
    result = submit(kernel, "extract:c1:t2", [
        {"kind": "relationship", "subject": KNOTT, "entities": ["thomas-hayes"], "statement": "开始信任调查员。"},
        {"kind": "relationship", "subject": INV, "entities": [KNOTT], "statement": "觉得诺特有所隐瞒。"},
        {"kind": "knowledge", "subject": KNOTT, "entities": [INV], "statement": "知道调查员受过伤。"},
    ])
    assert result["superseded"] == ["mem:t1-1"] and result["written"] == ["mem:t2-1", "mem:t2-2", "mem:t2-3"]
    rows = {r["id"]: r for r in read_jsonl(memory_dir(kernel.workspace) / "candidates.jsonl")}
    assert len(rows) == 5
    old = rows["mem:t1-1"]
    assert old["status"] == "superseded" and old["valid_until_turn"] == 2 and old["superseded_by"] == "mem:t2-1"
    assert old["statement"] == "雇主，客气而疏远。"  # the closed record is intact and addressable
    assert rows["mem:t2-1"]["status"] == "candidate" and "superseded_by" not in rows["mem:t2-1"]
    assert rows["mem:t1-2"]["status"] == "candidate"  # knowledge only accumulates
    assert rows["mem:t2-2"]["status"] == "candidate"  # the reverse direction is another relationship
    event = [e for e in read_jsonl(campaign_dir(kernel.workspace) / "events.jsonl") if e["type"] == "memory-written"][-1]
    assert event["data"]["superseded"] == 1
    hits = kernel.table("recall", what="memory", about=[KNOTT], kinds=["relationship"])["hits"]
    assert [h["id"] for h in hits] == ["mem:t2-1", "mem:t2-2"]
    with_closed = kernel.table("recall", what="memory", about=[KNOTT], kinds=["relationship"], include_superseded=True)
    closed = [h for h in with_closed["hits"] if h["id"] == "mem:t1-1"][0]
    assert closed["status"] == "superseded" and closed["superseded_by"] == "mem:t2-1" and closed["valid_until_turn"] == 2


def test_replay_is_idempotent_and_divergence_conflicts(kernel):
    first_turn(kernel)
    candidates = [{"kind": "belief", "subject": INV, "statement": "房子里有东西。"}]
    first = submit(kernel, "extract:c1:t1", candidates)
    again = submit(kernel, "extract:c1:t1", candidates)
    assert again == {**first, "replayed": True}
    assert len(read_jsonl(memory_dir(kernel.workspace) / "candidates.jsonl")) == 1
    assert len([e for e in read_jsonl(campaign_dir(kernel.workspace) / "events.jsonl") if e["type"] == "memory-written"]) == 1
    conflict = submit_err(kernel, "extract:c1:t1", [{"kind": "belief", "subject": INV, "statement": "房子里没东西。"}])
    assert conflict["code"] == "idempotency_conflict" and conflict["details"]["job_id"] == "extract:c1:t1"
    assert submit_err(kernel, "extract:c9:t1", candidates)["code"] == "invalid_params"
    assert submit_err(kernel, "extract:c1:t7", candidates)["code"] == "invalid_params"


def test_fail_backlogs_the_job_and_the_default_does_not_redispatch_it(kernel):
    first_turn(kernel)
    close_turn(kernel, 2)
    assert job(kernel)["turn"] == 2
    failed = kernel.ok("memory.fail", {"campaign": CAMPAIGN, "job_id": "extract:c1:t2", "reason": "model_error",
                                       "detail": "timeout after 60s"})
    assert failed == {"job_id": "extract:c1:t2", "turn": 2, "status": "pending", "reason": "model_error"}
    backlog = read_jsonl(memory_dir(kernel.workspace) / "backlog.jsonl")
    assert backlog == [{**backlog[0], "job_id": "extract:c1:t2", "turn": 2, "reason": "model_error",
                        "detail": "timeout after 60s", "status": "pending"}]
    assert read_json(memory_dir(kernel.workspace) / "jobs" / "extract:c1:t2.json")["status"] == "failed"
    assert job(kernel)["turn"] == 1  # not 2
    assert job(kernel, turn=2)["job_id"] == "extract:c1:t2"  # explicit redispatch still works
    assert kernel.err("memory.fail", {"campaign": CAMPAIGN, "job_id": "extract:c1:t2", "reason": "bored"})["code"] == "invalid_params"
    submit(kernel, "extract:c1:t2", [])
    assert read_jsonl(memory_dir(kernel.workspace) / "backlog.jsonl")[0]["status"] == "recovered"
    assert read_json(memory_dir(kernel.workspace) / "jobs" / "extract:c1:t2.json")["status"] == "done"


# ---- recall memory ------------------------------------------------------------------------

def seed_recall(kernel):
    first_turn(kernel)
    submit(kernel, "extract:c1:t1", [
        {"kind": "knowledge", "subject": INV, "entities": [KNOTT], "statement": "k1：调查员知道诺特急着出租。"},
        {"kind": "world_event", "subject": "world", "statement": "w1：钥匙易手。"},
    ])
    close_turn(kernel, 2)
    submit(kernel, "extract:c1:t2", [
        {"kind": "knowledge", "subject": KNOTT, "statement": "k2：诺特知道调查员来过。"},
        {"kind": "belief", "subject": INV, "statement": "b2：调查员觉得房子有问题。"},
    ])


def test_recall_memory_ranks_by_overlap_then_recency_and_narrows_on_about(kernel):
    seed_recall(kernel)
    default = kernel.table("recall", what="memory")
    assert default["what"] == "memory" and default["about"] == [KNOTT, INV]
    assert [h["id"] for h in default["hits"]] == ["mem:t1-1", "mem:t2-1", "mem:t2-2", "mem:t1-2"]
    hit = default["hits"][0]
    assert hit["authority"] == "conversation_report"
    assert hit["source"]["turn"] == 1 and hit["source"]["commit"]
    assert {k: v for k, v in hit.items() if k not in {"authority", "source"}} == {"id": "mem:t1-1", "kind": "knowledge", "subject": INV, "knowers": [], "entities": [KNOTT],
                   "statement": "k1：调查员知道诺特急着出租。", "privacy": "player_safe", "state": "accurate",
                   "confidence": None, "status": "candidate", "turn": 1,
                   # §15.5: which worldline and which circuit of the loop remembered it.
                   "worldline": "main", "loop": 0}
    # an alias narrows to the rows that name Knott, newest first among equal overlap
    assert [h["id"] for h in kernel.table("recall", what="memory", about=["steven-knott"])["hits"]] == ["mem:t2-1", "mem:t1-1"]
    assert [h["id"] for h in kernel.table("recall", what="memory", about=["world"])["hits"]] == ["mem:t1-2"]
    assert kernel.table("recall", what="memory", about=["Knott's Office"])["hits"] == []
    assert [h["id"] for h in kernel.table("recall", what="memory", kinds=["belief", "world_event"])["hits"]] == ["mem:t2-2", "mem:t1-2"]
    assert [h["id"] for h in kernel.table("recall", what="memory", turns=[2, 2])["hits"]] == ["mem:t2-1", "mem:t2-2"]
    assert len(kernel.table("recall", what="memory", limit=1)["hits"]) == 1
    # 'Corbitt' is one word of Walter Corbitt's name and resolves to him (people first);
    # a name that is nobody's word is still unknown.
    assert kernel.table("recall", what="memory", about=["Corbitt"])["about"] == ["Walter Corbitt"]
    unknown = kernel.table_err("recall", what="memory", about=["Atlantis"])
    assert unknown["code"] == "unknown_entity" and unknown["details"]["query"] == "Atlantis"
    assert kernel.table_err("recall", what="memory", kinds=["rumor"])["code"] == "invalid_params"
    assert kernel.table_err("recall", what="memory", limit=31)["code"] == "invalid_params"
    # readable in every state, including awaiting_player
    assert kernel.table("status")["state"] == "awaiting_player"
    assert kernel.table("recall", what="memory", about=[INV])["hits"]


def test_recall_memory_ranks_by_kind_after_overlap_and_before_recency(kernel):
    """#20 (§12.4): among equal overlap, what happened / is known / stands / was promised
    comes before what is believed or preferred; a player_assertion last even when newest."""
    first_turn(kernel)
    submit(kernel, "extract:c1:t1", [
        {"kind": "knowledge", "subject": INV, "entities": [KNOTT], "statement": "k1"},
        {"kind": "player_assertion", "subject": INV, "entities": [KNOTT], "statement": "a1"},
    ])
    close_turn(kernel, 2)
    submit(kernel, "extract:c1:t2", [
        {"kind": "player_assertion", "subject": INV, "entities": [KNOTT], "statement": "a2"},
        {"kind": "belief", "subject": INV, "entities": [KNOTT], "statement": "b2"},
        {"kind": "world_event", "subject": "world", "statement": "w2"},
        {"kind": "promise", "subject": KNOTT, "entities": [INV], "statement": "p2"},
    ])
    hits = kernel.table("recall", what="memory")["hits"]
    assert [(h["kind"], h["turn"]) for h in hits] == [
        ("promise", 2), ("knowledge", 1),        # tier 0, newest first
        ("belief", 2),                           # tier 1, though newer than the knowledge
        ("player_assertion", 2), ("player_assertion", 1),  # tier 2, newest first
        ("world_event", 2),                      # overlap 0 still ranks last of all
    ]
    # The capsule keeps report authority and status beside the same ranked head.
    kernel.table("player_input", text="第 3 回合。")
    capsule = kernel.table("capsule")["memory"]
    assert [h["id"] for h in capsule] == [h["id"] for h in hits][:6]
    assert all(set(h) == {"id", "kind", "statement", "subject", "turn", "status", "state", "authority"} for h in capsule)
    assert all(h["authority"] == "conversation_report" and h["status"] == "candidate" for h in capsule)
    assert capsule[0] == {"id": "mem:t2-4", "kind": "promise", "statement": "p2", "subject": KNOTT,
                          "turn": 2, "status": "candidate", "state": "accurate", "authority": "conversation_report"}


def test_prior_in_the_job_packet_follows_the_same_ranking(kernel):
    seed_recall(kernel)
    close_turn(kernel, 3)
    prior = job(kernel, turn=3)["prior"]
    assert [p["id"] for p in prior] == ["mem:t1-1", "mem:t2-1", "mem:t2-2", "mem:t1-2"]
    assert prior[0] == {"id": "mem:t1-1", "kind": "knowledge", "subject": INV, "statement": "k1：调查员知道诺特急着出租。",
                        "status": "candidate", "turn": 1}


# ---- the chain never blocks narrate -------------------------------------------------------

def test_post_commit_failures_are_telemetry_not_errors(kernel):
    open_turn(kernel)
    # episodes.jsonl cannot be appended to when a directory sits in its place
    (memory_dir(kernel.workspace) / "episodes.jsonl").unlink()
    (memory_dir(kernel.workspace) / "episodes.jsonl").mkdir()
    result = narrate(kernel, "t1-c1", "第一回合。")
    assert result["commit"] and result["extraction"] == {"job_id": "extract:c1:t1"}
    assert kernel.table("status") == {"turn": 2, "state": "awaiting_player", "receipts": [], "mechanics": [],
                                      "pending_choice": None}
    assert read_json(campaign_dir(kernel.workspace) / "save" / "continuation" / "latest.json")["turn"] == 1
    telemetry = read_jsonl(campaign_dir(kernel.workspace) / "telemetry.jsonl")
    # the director lane (§13.7) writes its own row at every close; only the kernel lane reports steps
    kernel_rows = [t for t in telemetry if t["lane"] == "kernel"]
    assert [(t["lane"], t["step"], t["turn"], t["ok"]) for t in kernel_rows] == [("kernel", "episode", 1, False)]
    assert "episodes.jsonl" in kernel_rows[0]["error"] or "Is a directory" in kernel_rows[0]["error"]
    # and the job can still be built from the turn record alone
    assert job(kernel, turn=1)["present"] == [KNOTT]
