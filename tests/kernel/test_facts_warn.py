"""Slice 2, 12.5 and 12.7: narrate's fact lists, the verifier lane's intake (table.warn)
and the capsule's memory / warnings sections with their budgets."""

import json

from conftest import CAMPAIGN, campaign_dir, create_campaign, narrate_opening, open_turn, read_json, read_jsonl

INV = "托马斯·海斯"


def size(payload):
    return len(json.dumps(payload, ensure_ascii=False).encode("utf-8"))


# ---- facts --------------------------------------------------------------------------------

def test_narrate_facts_are_sentences_from_receipts_and_world(kernel):
    create_campaign(kernel)
    opening = narrate_opening(kernel)
    assert opening["facts"]["committed"] == ["Location: Knott's Office", "Present: Steven Knott"]
    assert any(line.startswith("Undiscovered clue: knott-keys -- ") for line in opening["facts"]["keeper_only"])
    assert opening["extraction"] == {"job_id": "extract:c1:t0"}

    kernel.table("player_input", text="我翻看桌上的文件。")
    kernel.table("resolve", call_id="t1-c1", action={"intent": "investigate", "goal": "找线索", "method": "翻找",
                                                    "skill": "Spot Hidden"})
    kernel.table("apply", call_id="t1-c2", effects=[
        {"kind": "clue", "clue": "knott-keys", "label": "钥匙"},
        {"kind": "time", "minutes": 15},
        {"kind": "damage", "dice": "1D3", "why": "被抽屉夹了"},
        {"kind": "move", "to": "hall-of-records", "travel_minutes": 20},
    ])
    roll, _, _, dice, delta, _ = kernel.table("status")["receipts"]
    text = f"你出了门：掷出 {roll['roll']}（侦查 {roll['target']}），伤害 {dice['total']}，生命值 12 到 {delta['after']}，过了 15 分钟。"
    result = kernel.table("narrate", call_id="t1-c3", text=text)
    verdict = "passed" if roll["passed"] else "failed"
    # English, the system language (§16.1); names ride as the receipts carry them
    assert result["facts"]["committed"] == [
        "Player declared: 我翻看桌上的文件。",
        f"{INV}'s Spot Hidden check {verdict} ({roll['level']})",
        "Clue found: 钥匙",
        "Time advances 15 min",
        f"{INV} rolls damage 1D3: {dice['total']}",
        f"hp: {INV} 12 -> {delta['after']}",
        "Scene: Knott's Office -> Hall of Records (20 min)",
        "Location: Hall of Records",
        "Present: the Hall of Records clerk",
    ]
    keeper_only = result["facts"]["keeper_only"]
    assert size(keeper_only) <= 2048
    assert [line for line in keeper_only if line.startswith("Undiscovered clue: ")] == [
        line for line in keeper_only
        if line.startswith(("Undiscovered clue: will-executor-chapel -- ", "Undiscovered clue: chapel-closed-1912 -- "))]
    assert not any("knott-keys" in line for line in keeper_only)
    assert any(line.startswith("Module secret: corbitt-buried-alive-will -- ") for line in keeper_only)
    record = read_json(campaign_dir(kernel.workspace) / "turns" / "0001.json")
    assert record["facts"] == result["facts"]
    # the replayed narrate returns the same facts
    assert kernel.table("narrate", call_id="t1-c3", text=text)["facts"] == result["facts"]


def test_keeper_only_lists_present_npc_secrets_and_drops_discovered_clues(kernel):
    open_turn(kernel)
    kernel.table("apply", call_id="t1-c1", effects=[{"kind": "clue", "clue": "knott-keys"}])
    keeper_only = kernel.table("narrate", call_id="t1-c2", text="诺特把钥匙推过来。")["facts"]["keeper_only"]
    assert not any(line.startswith("Undiscovered clue: knott-keys") for line in keeper_only)
    assert any(line.startswith("Undiscovered clue: knott-commission -- ") for line in keeper_only)
    secret = [line for line in keeper_only if line.startswith("Steven Knott's secret -- ")]
    assert len(secret) == 1 and "agenda: Clear the Corbitt House" in secret[0] and "secret: He knows only rumor" in secret[0]
    # module secrets come last and are the first the 2KB budget trims
    secrets = [i for i, line in enumerate(keeper_only) if line.startswith("Module secret: ")]
    assert secrets and secrets == list(range(secrets[0], len(keeper_only)))
    assert size(keeper_only) <= 2048


# ---- warn ---------------------------------------------------------------------------------

def warn(client, turn, findings, lane="verifier"):
    return client.ok("table.warn", {"campaign": CAMPAIGN, "turn": turn, "lane": lane, "findings": findings})


def test_warn_anchors_quotes_as_substrings_and_drops_the_rest(kernel):
    open_turn(kernel)
    kernel.table("narrate", call_id="t1-c1", text="诺特看着你。\n\n他没有说话，只是把钥匙推了过来。")
    state_before = kernel.table("status")
    result = warn(kernel, 1, [
        {"kind": "reveal", "quote": "他没有说话", "why": "科比特的事玩家还不该知道"},
        {"kind": "uncommitted_state", "quote": "你拿走了钥匙", "why": "没有 clue 收据"},
        {"kind": "player_agency", "quote": "诺特看着你。", "why": "替玩家决定了站位"},
        {"kind": "reveal", "quote": "   ", "why": "空引文"},
    ])
    assert result["turn"] == 1 and result["lane"] == "verifier" and result["accepted"] == 2
    assert [d["index"] for d in result["dropped"]] == [1, 3]
    assert result["warnings"] == [
        {"kind": "reveal", "quote": "他没有说话", "why": "科比特的事玩家还不该知道"},
        {"kind": "player_agency", "quote": "诺特看着你。", "why": "替玩家决定了站位"},
    ]
    record = read_json(campaign_dir(kernel.workspace) / "turns" / "0001.json")
    assert [(w["lane"], w["kind"], w["quote"]) for w in record["warnings"]] == [
        ("verifier", "reveal", "他没有说话"), ("verifier", "player_agency", "诺特看着你。")]
    assert all(w["at"] for w in record["warnings"])
    telemetry = read_jsonl(campaign_dir(kernel.workspace) / "telemetry.jsonl")
    assert telemetry[-1] == {**telemetry[-1], "lane": "verifier", "turn": 1, "ok": True, "findings": 4, "accepted": 2, "dropped": 2}
    assert kernel.table("status") == state_before  # advisory: no state change

    # closed enums and anchoring to a narrate record
    bad_kind = kernel.err("table.warn", {"campaign": CAMPAIGN, "turn": 1, "lane": "verifier",
                                         "findings": [{"kind": "spoiler", "quote": "诺特看着你。", "why": ""}]})
    assert bad_kind["code"] == "invalid_params" and bad_kind["details"]["index"] == 0
    assert kernel.err("table.warn", {"campaign": CAMPAIGN, "turn": 1, "lane": "editor", "findings": []})["code"] == "invalid_params"
    assert kernel.err("table.warn", {"campaign": CAMPAIGN, "turn": 7, "lane": "verifier", "findings": []})["code"] == "invalid_params"
    # more than ten anchored findings: the eleventh is dropped
    many = warn(kernel, 1, [{"kind": "reveal", "quote": "钥匙", "why": str(i)} for i in range(11)])
    assert many["accepted"] == 10 and many["dropped"] == [{"index": 10, "kind": "reveal", "reason": "more than 10 findings"}]
    assert len(read_json(campaign_dir(kernel.workspace) / "turns" / "0001.json")["warnings"]) == 12


def test_warn_files_the_verifiers_play_language_finding(kernel):
    """`play_language_mismatch` is the verifier's judgment, filed like the other three kinds: the
    kernel refuses no delivery by its script (contract section 23), so Latin prose on the zh-Hans
    table is delivered and the finding reaches the next capsule as advice."""
    open_turn(kernel)
    kernel.table("narrate", call_id="t1-c1", text="Knott slides the keys across the desk.")
    finding = {"kind": "play_language_mismatch", "quote": "slides the keys", "why": "not zh-Hans"}
    result = warn(kernel, 1, [finding])
    assert result["accepted"] == 1 and result["dropped"] == []
    assert result["warnings"] == [finding]
    capsule = kernel.table("player_input", text="继续。")["capsule"]
    assert capsule["warnings"] == [{"turn": 1, **finding}]


def test_warn_files_an_investigator_identity_mismatch_without_classifying_it(kernel):
    open_turn(kernel)
    kernel.table("narrate", call_id="t1-c1", text="警员点头说：先生，已经登记好了。")
    finding = {"kind": "investigator_identity_mismatch", "quote": "先生，已经登记好了", "why": "调查员身份记录与这个称呼冲突"}
    result = warn(kernel, 1, [finding])
    assert result["accepted"] == 1 and result["warnings"] == [finding]
    capsule = kernel.table("player_input", text="我纠正他的称呼。")["capsule"]
    assert capsule["warnings"] == [{"turn": 1, **finding}]


def test_warnings_reach_the_next_capsule_only_for_the_latest_committed_turn(kernel):
    open_turn(kernel)
    kernel.table("narrate", call_id="t1-c1", text="诺特看着你。")
    warn(kernel, 1, [{"kind": "reveal", "quote": "诺特看着你", "why": "早了"}])
    capsule = kernel.table("player_input", text="继续。")["capsule"]
    assert capsule["warnings"] == [{"turn": 1, "kind": "reveal", "quote": "诺特看着你", "why": "早了"}]
    assert kernel.table("capsule")["warnings"] == capsule["warnings"]
    kernel.table("narrate", call_id="t2-c1", text="他点头。")
    assert kernel.table("player_input", text="再来。")["capsule"]["warnings"] == []
    # a late warn on turn 2 shows up while turn 3 is open
    warn(kernel, 2, [{"kind": "player_agency", "quote": "他点头", "why": "x"}])
    assert kernel.table("capsule")["warnings"] == [{"turn": 2, "kind": "player_agency", "quote": "他点头", "why": "x"}]


# ---- capsule sections ---------------------------------------------------------------------

def test_capsule_memory_section_is_the_ranked_head_within_budget(kernel):
    open_turn(kernel)
    kernel.table("narrate", call_id="t1-c1", text="第一回合。")
    long = "诺特" + "的话很长" * 70  # ~290 chars each
    kernel.ok("memory.submit", {"campaign": CAMPAIGN, "job_id": "extract:c1:t1", "candidates": [
        *({"kind": "knowledge", "subject": "Steven Knott", "entities": [INV], "statement": f"{i}{long}"} for i in range(7)),
        {"kind": "world_event", "subject": "world", "statement": "w"},
    ]})
    capsule = kernel.table("player_input", text="继续。")["capsule"]
    hits = capsule["memory"]
    assert 0 < len(hits) < 6 and "memory" in capsule["truncated"]
    assert size(hits) <= 1536
    assert hits[0]["id"] == "mem:t1-1" and hits[0]["kind"] == "knowledge"  # highest overlap, then oldest id
    # §36.12: compact memory retains subject, lifecycle state, and conversation-report authority.
    assert set(hits[0]) == {"id", "kind", "subject", "statement", "turn", "status", "state", "authority"}
    assert kernel.table("recall", what="memory")["hits"][0]["subject"] == "Steven Knott"


def test_capsule_memory_section_takes_six_ranked_hits(kernel):
    open_turn(kernel)
    kernel.table("narrate", call_id="t1-c1", text="第一回合。")
    kernel.ok("memory.submit", {"campaign": CAMPAIGN, "job_id": "extract:c1:t1", "candidates": [
        {"kind": "world_event", "subject": "world", "statement": "w"},
        *({"kind": "knowledge", "subject": "Steven Knott", "entities": [INV], "statement": f"短{i}"} for i in range(7)),
    ]})
    capsule = kernel.table("player_input", text="继续。")["capsule"]
    # seven rows overlap the default about twice, the world_event not at all: it falls off the six
    assert [h["id"] for h in capsule["memory"]] == [f"mem:t1-{k}" for k in range(2, 8)]
    assert "memory" not in capsule.get("truncated", [])
    assert kernel.table("capsule")["memory"] == capsule["memory"]


def test_capsule_warnings_section_budget(kernel):
    open_turn(kernel)
    text = "诺特看着你，" + "慢慢地说了很多很多话，" * 30
    kernel.table("narrate", call_id="t1-c1", text=text)
    quote = text[:100]
    warn(kernel, 1, [{"kind": "reveal", "quote": quote, "why": "理由" * 90} for _ in range(10)])
    capsule = kernel.table("player_input", text="继续。")["capsule"]
    assert 0 < len(capsule["warnings"]) < 10 and "warnings" in capsule["truncated"]
    assert size(capsule["warnings"]) <= 1024
    assert capsule["warnings"][0] == {"turn": 1, "kind": "reveal", "quote": quote, "why": "理由" * 90}
    assert "resume" not in capsule


# ---- the public record beside the Keeper-only list (contract §32.6) ------------------------------

def test_narrate_facts_carry_what_the_player_was_already_told(kernel):
    create_campaign(kernel)
    opening = narrate_opening(kernel)
    # Before anything was delivered the public record is the investigator's own identity, nothing more.
    assert len(opening["facts"]["public"]) == 1 and opening["facts"]["public"][0].startswith(f"Investigator: {INV} (") and "; sex: " in opening["facts"]["public"][0], opening["facts"]["public"]
    kernel.table("player_input", text="我问诺特这房子的事。")
    result = kernel.table("narrate", call_id="t1-c1", text="诺特说起了马卡里奥一家。")
    public = result["facts"]["public"]
    assert public[0].startswith(f"Investigator: {INV} (") and "; sex: " in public[0]
    told = [line for line in public if line.startswith("Told at turn 0: ")]
    assert told and "诺特把钥匙拍在桌上" in told[0], public
    # The Keeper-only list is unchanged by it: an undiscovered clue stays Keeper-only until its receipt lands.
    assert any(line.startswith("Undiscovered clue: knott-keys -- ") for line in result["facts"]["keeper_only"])
    assert size(public) <= 2048
    # The next turn reads the two deliveries before it, oldest first, and nothing older.
    kernel.table("player_input", text="我再问一句。")
    again = kernel.table("narrate", call_id="t2-c1", text="诺特叹了口气。")["facts"]["public"]
    assert [line[:15] for line in again if line.startswith("Told at turn")] == ["Told at turn 0:", "Told at turn 1:"]
    assert any("诺特说起了马卡里奥一家" in line for line in again)
