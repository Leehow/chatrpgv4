"""Memory invariants: candidates, extraction jobs, and the closed candidate schema
(contract §12.3-§12.4). Black-box over the RPC surface -- every assertion goes through
`memory.job` / `memory.submit` / `memory.fail` / `table.recall(what="memory")`, never the
storage files directly (those are asserted on only to confirm the advisory backlog exists).

Three laws from §12: candidates never auto-promote, contradictions never delete (they
close with `valid_until_turn`/`superseded_by`, both still addressable), and extraction/
verification never block `narrate`.
"""
import json
import re

from conftest import narrate, CAMPAIGN, PREGEN, campaign_dir, open_turn, read_json, read_jsonl

# contract §12.3: "解析不到的名字...都报 invalid_params"; the batch is all-or-nothing.
CALL_ID_SHAPE = re.compile(r"^t\d+-c\d+$")
# a git short sha, a receipt digest, or any other opaque hex id -- 7+ hex chars is the
# shortest a `git log --format=%h`-style short sha gets.
HEX_RUN = re.compile(r"(?<![0-9a-fA-F])[0-9a-fA-F]{7,}(?![0-9a-fA-F])")
RECEIPT_PREFIXES = ("roll:", "delta:", "move:")


def job(client, **params):
    return client.ok("memory.job", {"campaign": CAMPAIGN, **params})


def job_err(client, **params):
    return client.err("memory.job", {"campaign": CAMPAIGN, **params})


def submit(client, **params):
    return client.ok("memory.submit", {"campaign": CAMPAIGN, **params})


def submit_err(client, **params):
    return client.err("memory.submit", {"campaign": CAMPAIGN, **params})


def fail(client, **params):
    return client.ok("memory.fail", {"campaign": CAMPAIGN, **params})


def known_entity(job_result, kind):
    return next(e["name"] for e in job_result["known_entities"] if e["kind"] == kind)


def memory_hits(client, **params):
    return client.table("recall", what="memory", **params)["hits"]


def _walk(node, path="$"):
    """Yield (path, key_or_None, str_value_or_None) for every dict key and string leaf."""
    if isinstance(node, dict):
        for k, v in node.items():
            yield f"{path}.{k}", k, None
            yield from _walk(v, f"{path}.{k}")
    elif isinstance(node, list):
        for i, v in enumerate(node):
            yield from _walk(v, f"{path}[{i}]")
    elif isinstance(node, str):
        yield path, None, node


def test_candidates_never_leave_candidate_or_superseded(kernel):
    open_turn(kernel, "我问诺特关于报社过去的事。")
    narrate(kernel, "t1-c1", "诺特提到报社十年前也报道过一起失踪案。")
    j1 = job(kernel, turn=1)
    subject = known_entity(j1, "investigator")
    submit(kernel, job_id=j1["job_id"], candidates=[
        {"kind": "knowledge", "subject": subject, "statement": "诺特提到报社十年前的一起失踪案。"},
    ])

    def statuses():
        return {h["status"] for h in memory_hits(kernel, include_superseded=True)}

    assert statuses() and statuses() <= {"candidate", "superseded"}

    kernel.table("player_input", text="我继续追问细节。")
    narrate(kernel, "t2-c1", "诺特叹了口气，说案子最后不了了之。")
    j2 = job(kernel, turn=2)
    submit(kernel, job_id=j2["job_id"], candidates=[
        {"kind": "belief", "subject": subject, "statement": "诺特似乎不太想谈这件旧案。"},
    ])
    # Repeated job/submit/recall cycles must never promote a candidate out of this pair.
    assert statuses() <= {"candidate", "superseded"}


def test_superseding_relationship_keeps_both_records_addressable(kernel):
    open_turn(kernel, "我打量诺特和这间办公室。")
    narrate(kernel, "t1-c1", "诺特与你隔着桌子对视。")
    j1 = job(kernel, turn=1)
    investigator = known_entity(j1, "investigator")
    npc = known_entity(j1, "npc")
    submit(kernel, job_id=j1["job_id"], candidates=[
        {"kind": "relationship", "subject": investigator, "entities": [npc],
         "statement": f"{investigator}对{npc}保持警惕。"},
    ])
    first_hits = memory_hits(kernel, about=[investigator, npc], include_superseded=True)
    first = next(h for h in first_hits if h["kind"] == "relationship")
    assert first["status"] == "candidate"

    kernel.table("player_input", text="我们继续交谈了一阵。")
    narrate(kernel, "t2-c1", "诺特的态度渐渐放松了下来。")
    j2 = job(kernel, turn=2)
    submit(kernel, job_id=j2["job_id"], candidates=[
        {"kind": "relationship", "subject": investigator, "entities": [npc],
         "statement": f"{investigator}对{npc}的警惕消退了。"},
    ])

    all_hits = memory_hits(kernel, about=[investigator, npc], include_superseded=True)
    by_id = {h["id"]: h for h in all_hits}
    assert first["id"] in by_id, "the superseded record must stay addressable by id"
    assert by_id[first["id"]]["status"] == "superseded"
    newer = next(h for h in all_hits if h["kind"] == "relationship" and h["id"] != first["id"])
    assert newer["status"] == "candidate"
    assert by_id[first["id"]]["superseded_by"] == newer["id"]

    # §12.3: "矛盾不删除" -- but the default recall view still only surfaces the live one.
    default_ids = {h["id"] for h in memory_hits(kernel, about=[investigator, npc])}
    assert newer["id"] in default_ids
    assert first["id"] not in default_ids


def test_failed_job_is_not_redispatched_by_a_bare_memory_job(kernel):
    open_turn(kernel, "我环视四周。")
    narrate(kernel, "t1-c1", "灰尘在光线里飘着。")
    j1 = job(kernel, turn=1)
    fail(kernel, job_id=j1["job_id"], reason="model_error", detail="抽取子会话超时")

    backlog = read_jsonl(campaign_dir(kernel.workspace) / "memory" / "backlog.jsonl")
    assert any(row["job_id"] == j1["job_id"] and row["reason"] == "model_error" and row["status"] == "pending"
               for row in backlog)

    # A bare dispatch (no explicit turn) must not hand the failed job back out.
    bare = job(kernel)
    assert bare["job_id"] != j1["job_id"]

    # Memory failures are advisory-only: table play, including narrate, is unaffected.
    kernel.table("player_input", text="我继续搜查。")
    result = narrate(kernel, "t2-c1", "没有发现异常。")
    assert result["commit"]

    # Re-dispatch requires explicitly naming the turn.
    redispatched = job(kernel, turn=1)
    assert redispatched["job_id"] == j1["job_id"]


def test_player_assertion_never_becomes_a_committed_fact_or_world_state(kernel):
    open_turn(kernel, "我告诉诺特我曾经在《纪事报》工作过。")
    narrate(kernel, "t1-c1", "诺特挑了挑眉，不置可否。")
    j1 = job(kernel, turn=1)
    investigator = known_entity(j1, "investigator")
    submit(kernel, job_id=j1["job_id"], candidates=[
        {"kind": "player_assertion", "subject": investigator,
         "statement": f"{investigator}自称曾在《纪事报》工作过。"},
    ])

    kernel.table("player_input", text="我再次强调这一点。")
    narrated = narrate(kernel, "t2-c1", "诺特点了点头，仍不置可否。")
    committed_blob = json.dumps(narrated.get("facts", {}).get("committed", []), ensure_ascii=False)
    assert "纪事报" not in committed_blob

    world_blob = json.dumps(read_json(campaign_dir(kernel.workspace) / "world.json"), ensure_ascii=False)
    assert "纪事报" not in world_blob


def test_ambiguous_name_between_two_present_entities_is_rejected(kernel):
    open_turn(kernel, "我和诺特交谈。")
    narrate(kernel, "t1-c1", "诺特靠在椅背上。")
    j1 = job(kernel, turn=1)
    npc_name = known_entity(j1, "npc")

    # Construct a real name collision: the investigator's own sheet renamed to the NPC's
    # name. Both are "present" (the investigator always is; the NPC is in this scene) --
    # exactly the "两个实体同名且都在场" case the validator must catch.
    sheet_path = campaign_dir(kernel.workspace) / "party" / f"{PREGEN}.json"
    sheet = read_json(sheet_path)
    sheet["name"] = npc_name
    sheet_path.write_text(json.dumps(sheet, ensure_ascii=False), encoding="utf-8")

    kernel.table("player_input", text="我继续说下去。")
    narrate(kernel, "t2-c1", "诺特没有回应。")
    j2 = job(kernel, turn=2)
    error = submit_err(kernel, job_id=j2["job_id"], candidates=[
        {"kind": "knowledge", "subject": npc_name, "statement": "有些事发生了变化。"},
    ])
    assert error["code"] == "invalid_params"
    assert error["details"]["index"] == 0
    assert error["fix"]


def test_submit_with_a_machine_key_is_rejected_with_details_index(kernel):
    open_turn(kernel, "我环视四周。")
    narrate(kernel, "t1-c1", "房间里很安静。")
    j1 = job(kernel, turn=1)
    investigator = known_entity(j1, "investigator")

    single = submit_err(kernel, job_id=j1["job_id"], candidates=[
        {"kind": "knowledge", "subject": investigator, "statement": "一切如常。", "commit": "deadbeefc0"},
    ])
    assert single["code"] == "invalid_params"
    assert single["details"]["index"] == 0

    # The offender is the second candidate in the batch; the batch is all-or-nothing.
    batch = submit_err(kernel, job_id=j1["job_id"], candidates=[
        {"kind": "knowledge", "subject": investigator, "statement": "第一条本身没问题。"},
        {"kind": "belief", "subject": investigator, "statement": "第二条", "call_id": "t1-c1"},
    ])
    assert batch["code"] == "invalid_params"
    assert batch["details"]["index"] == 1
    assert not any("第一条本身没问题" in h["statement"] for h in memory_hits(kernel, about=[investigator]))


def test_memory_job_packet_carries_no_machine_keys_except_top_level_turn_and_commit(kernel):
    open_turn(kernel, "我仔细检查桌上的文件。")
    kernel.table("resolve", call_id="t1-c1",
                action={"intent": "investigate", "goal": "看文件", "method": "用侦查扫一眼",
                        "skill": "Spot Hidden"})
    kernel.table("apply", call_id="t1-c2", effects=[
        {"kind": "clue", "clue": "knott-research-leads"},
        {"kind": "time", "minutes": 5},
    ])
    narrated = narrate(kernel, "t1-c3", "你翻阅着桌上的文件。")
    j1 = job(kernel, turn=1)
    assert j1["turn"] == 1
    assert j1["commit"] == narrated["commit"]

    payload = {k: v for k, v in j1.items() if k not in ("turn", "commit")}
    offenders = []
    for path, key, value in _walk(payload):
        if key == "call_id":
            offenders.append((path, "call_id key"))
        if value is not None:
            if HEX_RUN.search(value):
                offenders.append((path, f"hex-like run: {value!r}"))
            if any(value.startswith(prefix) for prefix in RECEIPT_PREFIXES):
                offenders.append((path, f"receipt-shaped value: {value!r}"))
            if CALL_ID_SHAPE.match(value):
                offenders.append((path, f"call_id-shaped value: {value!r}"))
    assert offenders == []
