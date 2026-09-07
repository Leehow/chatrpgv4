"""Slice 1, first half: the RuleGraph-driven resolve pipeline and the non-session families,
all through the RPC seam."""

import json

from conftest import RpcClient, campaign_dir, narrate, open_turn, read_json, read_jsonl

CONFRONTATION_PATH = ["corbitt-house-ground", "basement-rites", "corbitt-confrontation"]


def resolve(client, call_id, **action):
    return client.table("resolve", call_id=call_id, action=action)


def resolve_err(client, call_id, **action):
    return client.table_err("resolve", call_id=call_id, action=action)


def seed_wound(workspace, hp, conditions=(), minutes_ago=0):
    """A wound the healing engines expect: the sheet's current_hp plus the healing snapshot
    with an active wound_ledger row stamped at the campaign clock."""
    directory = campaign_dir(workspace)
    sheet_path = directory / "party" / "thomas-hayes.json"
    sheet = read_json(sheet_path)
    sheet["current_hp"] = hp
    sheet_path.write_text(json.dumps(sheet, ensure_ascii=False, indent=2), encoding="utf-8")
    clock = read_json(directory / "world.json")["clock"]["minutes"]
    healing = directory / "save" / "healing-state"
    healing.mkdir(parents=True, exist_ok=True)
    (healing / "thomas-hayes.json").write_text(json.dumps({
        "investigator_id": "thomas-hayes", "current_hp": hp, "conditions": list(conditions),
        "wound_ledger": [{"wound_id": "wound-seeded", "source_damage_roll_id": None,
                          "occurred_elapsed_minutes": max(0, clock - minutes_ago), "status": "active"}],
    }), encoding="utf-8")


def events_after(workspace, count):
    return [e["type"] for e in read_jsonl(campaign_dir(workspace) / "events.jsonl")[count:]]


def event_count(workspace):
    return len(read_jsonl(campaign_dir(workspace) / "events.jsonl"))


def first_failure(client, prefix, **action):
    """Resolve the same check under fresh call_ids until one fails; returns (call_id, result)."""
    for n in range(1, 25):
        call_id = f"{prefix}{n}"
        result = resolve(client, call_id, **action)
        if not result["outcome"]["passed"] and result["outcome"]["level"] != "fumble":
            return call_id, result
    raise AssertionError("no ordinary failure in 24 seeded rolls")


def first_success(client, prefix, **action):
    for n in range(1, 25):
        call_id = f"{prefix}{n}"
        result = resolve(client, call_id, **action)
        if result["outcome"]["passed"]:
            return call_id, result
    raise AssertionError("no success in 24 seeded rolls")


def walk_to_confrontation(client, start=1):
    for i, scene in enumerate(CONFRONTATION_PATH, start=start):
        client.table("apply", call_id=f"t1-c{i}", effects=[{"kind": "move", "to": scene}])
    return start + len(CONFRONTATION_PATH)


# ---- core-check --------------------------------------------------------------------

def test_opposed_check_rolls_both_parties(seeded_kernel, tmp_path):
    open_turn(seeded_kernel, "我和科比特掰手腕。")
    n = walk_to_confrontation(seeded_kernel)
    result = resolve(seeded_kernel, f"t1-c{n}", intent="investigate", goal="把他压制住", method="用力量硬顶",
                     target="Walter Corbitt", decision="core-check:opposed-check")
    assert result["decision"] == "core-check:opposed-check"
    outcome = result["outcome"]
    assert outcome["kind"] == "opposed" and outcome["skill"] == "STR"
    assert outcome["investigator"]["target"] == 60 and outcome["opponent"]["target"] == 90
    assert outcome["opponent_id"] == "walter-corbitt"
    assert outcome["winner"] in ("investigator", "opponent", "none")
    assert result["receipts"] == [f"roll:str-t1-c{n}", f"roll:str-walter-corbitt-t1-c{n}"]
    receipts = {r["id"]: r for r in seeded_kernel.table("status")["receipts"] if r["kind"] == "roll"}
    npc_roll = receipts[f"roll:str-walter-corbitt-t1-c{n}"]
    assert npc_roll["actor"] == "walter-corbitt" and npc_roll["visibility"] == "public"
    assert result["continuations"] == []  # opposed checks are never pushed

    rolls = [m for m in narrate(seeded_kernel, f"t1-c{n + 1}", "他的手像石头。")["mechanics"] if m["kind"] == "roll"]
    assert len(rolls) == 2
    assert rolls[0]["skill"] == "STR" and rolls[0]["actor"] == "thomas-hayes" and "actor_label" not in rolls[0]
    assert rolls[1]["skill"] == "STR" and rolls[1]["actor"] == "walter-corbitt" and rolls[1]["actor_label"] == "Walter Corbitt"

    # Same seed, fresh process, same two rolls.
    other = RpcClient(tmp_path / "ws-2", env={"COC_KERNEL_SEED": "7"})
    try:
        open_turn(other, "我和科比特掰手腕。")
        m = walk_to_confrontation(other)
        again = resolve(other, f"t1-c{m}", intent="investigate", goal="把他压制住", method="用力量硬顶",
                        target="Walter Corbitt", decision="core-check:opposed-check")
        assert (again["outcome"]["investigator"]["roll"], again["outcome"]["opponent"]["roll"]) == (
            outcome["investigator"]["roll"], outcome["opponent"]["roll"])
    finally:
        other.close()


def test_opposed_check_needs_an_authored_opponent_value(kernel):
    open_turn(kernel)
    error = resolve_err(kernel, "t1-c1", intent="investigate", goal="x", method="用侦查", target="Steven Knott",
                        decision="core-check:opposed-check")
    assert error["code"] == "needs" and error["details"]["needs"]["field"] == "skill"


def test_combined_check_one_roll_many_targets(seeded_kernel):
    open_turn(seeded_kernel)
    result = resolve(seeded_kernel, "t1-c1", intent="investigate", goal="找出暗门", method="同时看和听",
                     decision="core-check:combined-check", skills=["Spot Hidden", "Listen"], mode="any")
    outcome = result["outcome"]
    assert outcome["kind"] == "combined" and outcome["mode"] == "any"
    assert [t["label"] for t in outcome["targets"]] == ["Spot Hidden", "Listen"]
    assert [t["value"] for t in outcome["targets"]] == [55, 45]
    assert outcome["passed"] == any(t["success"] for t in outcome["targets"])
    assert result["receipts"] == ["roll:spot-hidden-listen-t1-c1"]
    # A combined check is not continuable (`runtime.continuable_check`), so the result must
    # not offer a Luck spend against it. This assertion used to require the opposite, which
    # pinned a defect: at a live table the keeper read the offer, put it to the player, and
    # the settlement refused — binding to an unrelated fumble two turns back and reporting
    # that outcome. An offer the settlement will refuse is worse than no offer.
    assert [c["decision"] for c in result["continuations"] if c["decision"].startswith("push-luck:")] == []
    error = resolve_err(seeded_kernel, "t1-c2", intent="investigate", goal="x", method="y",
                        decision="core-check:combined-check", skills=["Spot Hidden"])
    assert error["code"] == "needs" and error["details"]["needs"]["field"] == "skills"


# ---- candidates and selection ------------------------------------------------------------

def test_investigate_on_npc_needs_choice_then_decision_picks(kernel):
    open_turn(kernel)
    error = resolve_err(kernel, "t1-c1", intent="investigate", goal="看他是不是在隐瞒什么", method="盯着他的表情",
                        target="Steven Knott")
    assert error["code"] == "needs_choice"
    names = [c["name"] for c in error["details"]["candidates"]]
    assert names == ["core-check:ordinary-check", "psychology:observe-concealed"]
    assert all(c["when"] for c in error["details"]["candidates"])
    assert kernel.table("status")["receipts"] == []

    picked = resolve(kernel, "t1-c1", intent="investigate", goal="看他是不是在隐瞒什么", method="盯着他的表情",
                     target="Steven Knott", decision="psychology:observe-concealed")
    assert picked["decision"] == "psychology:observe-concealed"
    outcome = picked["outcome"]
    assert outcome["kind"] == "psychology" and outcome["status"] == "observed" and outcome["concealed"] is True
    assert outcome["inference_depth"] in ("deep_conflict", "motive_link", "immediate_intent", "uncertain")
    assert outcome["npc"] == "steven-knott"
    assert [c["decision"] for c in picked["continuations"]] == ["psychology:realize-player-safe"]
    receipt = kernel.table("status")["receipts"][0]
    assert receipt["id"] == "roll:psychology-t1-c1" and receipt["visibility"] == "keeper"

    realized = resolve(kernel, "t1-c2", intent="investigate", goal="x", method="他避开你的视线，手指敲着桌面",
                       target="Steven Knott", decision="psychology:realize-player-safe")
    assert realized["outcome"] == {"kind": "psychology", "status": "realized", "npc": "steven-knott",
                                   "insight_id": outcome["insight_id"],
                                   "external_behavior": "他避开你的视线，手指敲着桌面"}
    # A concealed roll obliges the keeper to state nothing; the projection still carries it, marked keeper.
    result = kernel.table("narrate", call_id="t1-c3", text="他笑了笑。")
    assert result["rendered_text"] == "他笑了笑。"
    assert all(m["visibility"] == "keeper" for m in result["mechanics"] if m["kind"] == "roll")

    # A skill in the method removes the ambiguity.
    kernel.table("player_input", text="我再看看。")
    plain = resolve(kernel, "t2-c1", intent="investigate", goal="看他的桌子", method="用侦查扫过桌面", target="Steven Knott")
    assert plain["decision"] == "core-check:ordinary-check" and plain["outcome"]["skill"] == "Spot Hidden"


def test_unknown_decision_and_absent_target(kernel):
    open_turn(kernel)
    error = resolve_err(kernel, "t1-c1", intent="investigate", goal="x", method="y", decision="core-check:nope")
    assert error["code"] == "invalid_params" and "core-check:ordinary-check" in error["details"]["candidates"]
    absent = resolve_err(kernel, "t1-c1", intent="social", goal="x", method="用说服", target="Arty Wilmot")
    assert absent["code"] == "unknown_entity"
    assert [c["name"] for c in absent["details"]["candidates"]] == ["steven-knott"]


# ---- social ----------------------------------------------------------------------------

def test_social_adjudication_against_arty(seeded_kernel):
    open_turn(seeded_kernel, "我去报社。")
    seeded_kernel.table("apply", call_id="t1-c1", effects=[{"kind": "move", "to": "newspaper-morgue"}])
    unclear = resolve_err(seeded_kernel, "t1-c2", intent="social", goal="让阿蒂放我们进剪报室", method="跟他聊聊",
                          target="Arty Wilmot")
    assert unclear["code"] == "needs" and unclear["details"]["needs"]["field"] == "skill"
    assert unclear["details"]["needs"]["options"] == ["Charm", "Fast Talk", "Intimidate", "Persuade"]

    result = resolve(seeded_kernel, "t1-c2", intent="social", goal="让阿蒂放我们进剪报室", method="用说服跟他讲道理",
                     target="Arty Wilmot", stakes="他会叫人把我们赶出去")
    assert result["decision"] == "social:adjudicate-difficulty"
    outcome = result["outcome"]
    assert outcome["kind"] == "social" and outcome["npc"] == "arty-wilmot"
    assert outcome["approach"] == "persuade" and outcome["approach_skill"] == "Persuade"
    assert outcome["feasibility"] == "roll"
    # Arty authors no social defense: base difficulty regular (his secret says as much).
    assert outcome["base_difficulty"] == "regular" and outcome["final_difficulty"] == "regular"
    assert outcome["motive"]["evidence_refs"] == ["npc_agenda:arty-wilmot", "npc_secret:arty-wilmot"]
    assert outcome["skill"] == "Persuade" and outcome["target"] == 40 and outcome["threshold"] == 40
    assert result["receipts"] == ["roll:persuade-t1-c2"]
    assert "rule:coc7:social:canonical-motive-evidence-binding" in result["rule_refs"]
    if outcome["passed"] or outcome["level"] == "fumble":
        assert result["continuations"] == []
    else:
        continuations = {c["decision"]: c["action"] for c in result["continuations"]}
        assert continuations == {"push-luck:pushed-roll": ["push", "stakes", "method"], "push-luck:luck-spend": ["luck"]}

    intimidate = resolve(seeded_kernel, "t1-c3", intent="social", goal="吓唬他", method="用恐吓", target="Arty Wilmot",
                         motive={"direction": "oppose", "intensity": 1})
    assert intimidate["outcome"]["approach"] == "intimidate"
    assert intimidate["outcome"]["final_difficulty"] == "hard"  # neutral base + one level of opposing motive


# ---- push and luck -------------------------------------------------------------------------

def test_push_executes_against_last_failure_and_refuses_a_second(seeded_kernel):
    open_turn(seeded_kernel, "我爬。")
    no_check = resolve_err(seeded_kernel, "t1-c1", intent="investigate", goal="x", method="y", stakes="z", push=True)
    assert no_check["code"] == "needs" and no_check["details"]["needs"]["field"] == "intent"

    failed_id, failed = first_failure(seeded_kernel, "t1-c", intent="investigate", goal="爬上二楼的窗", method="用攀爬")
    assert [c["decision"] for c in failed["continuations"]] == ["push-luck:pushed-roll", "push-luck:luck-spend"]
    n = int(failed_id.split("-c")[1])

    missing = resolve_err(seeded_kernel, f"t1-c{n + 1}", intent="investigate", goal="爬上二楼的窗", method="换条排水管",
                          push=True)
    assert missing["code"] == "needs" and missing["details"]["needs"]["field"] == "stakes"

    pushed = resolve(seeded_kernel, f"t1-c{n + 1}", intent="investigate", goal="爬上二楼的窗", method="换条排水管",
                     stakes="排水管断裂，摔下去受伤", push=True)
    assert pushed["decision"] == "push-luck:pushed-roll"
    outcome = pushed["outcome"]
    assert outcome["kind"] == "push" and outcome["pushed"] is True
    assert outcome["skill"] == "Climb" and outcome["target"] == 30
    assert outcome["source_receipt"] == failed["receipt"]
    assert outcome["failure_consequence"] == "排水管断裂，摔下去受伤"
    assert pushed["continuations"] == []
    receipt = next(r for r in seeded_kernel.table("status")["receipts"] if r["id"] == pushed["receipt"])
    assert receipt["pushed"] is True and receipt["source_receipt"] == failed["receipt"]

    again = resolve_err(seeded_kernel, f"t1-c{n + 2}", intent="investigate", goal="再试", method="再换", stakes="x", push=True)
    assert again["code"] == "turn_state"
    if not outcome["passed"]:
        # Luck may not alter a pushed roll either.
        luck = resolve_err(seeded_kernel, f"t1-c{n + 2}", intent="investigate", goal="x", method="y", luck=5)
        assert luck["code"] == "turn_state"

    rolls = [m for m in narrate(seeded_kernel, f"t1-c{n + 3}", "窗框吱呀作响。")["mechanics"] if m["kind"] == "roll"]
    assert rolls[-1]["skill"] == "Climb" and rolls[-1]["pushed"] is True


def test_luck_spend_and_insufficient_luck(seeded_kernel):
    open_turn(seeded_kernel, "我搜。")
    failed_id, failed = first_failure(seeded_kernel, "t1-c", intent="investigate", goal="找到暗格", method="用侦查",
                                      modifiers={"difficulty": "hard"})
    n = int(failed_id.split("-c")[1])
    too_much = resolve_err(seeded_kernel, f"t1-c{n + 1}", intent="investigate", goal="x", method="y", luck=99)
    assert too_much["code"] == "invalid_params" and too_much["details"]["reason"] == "insufficient_luck"
    assert too_much["details"]["current_luck"] == 50

    spent = resolve(seeded_kernel, f"t1-c{n + 1}", intent="investigate", goal="x", method="y", luck=3)
    assert spent["decision"] == "push-luck:luck-spend"
    outcome = spent["outcome"]
    assert outcome["kind"] == "luck" and outcome["points"] == 3
    assert (outcome["luck_before"], outcome["luck_after"]) == (50, 47)
    assert outcome["roll"] == failed["outcome"]["roll"] - 3
    assert outcome["source_receipt"] == failed["receipt"]
    assert spent["effects"] == [{"kind": "luck", "subject": "thomas-hayes", "before": 50, "after": 47}]
    assert spent["receipts"] == [f"delta:luck-t1-c{n + 1}"]
    assert "core.optional.spending_luck" in spent["rule_refs"]
    assert seeded_kernel.table("look", focus="investigator")["luck"] == 47
    assert read_json(campaign_dir(seeded_kernel.workspace) / "party" / "thomas-hayes.json")["current_luck"] == 47

    # The same check cannot be pushed after Luck was spent on it.
    both = resolve_err(seeded_kernel, f"t1-c{n + 2}", intent="investigate", goal="x", method="换法子", stakes="z", push=True)
    assert both["code"] == "turn_state"

    changes = [m for m in narrate(seeded_kernel, f"t1-c{n + 3}", "你眯起眼。")["mechanics"] if m["kind"] == "change"]
    assert {"kind": "change", "receipt": changes[-1]["receipt"], "resource": "luck", "subject": "thomas-hayes",
            "subject_label": "托马斯·海斯", "before": 50, "after": 47} in changes
    events = read_jsonl(campaign_dir(seeded_kernel.workspace) / "events.jsonl")
    changed = [e for e in events if e["type"] == "resource-changed"]
    assert changed[-1]["data"] == {"resource": "luck", "subject": "thomas-hayes", "before": 50, "after": 47}


# ---- healing ------------------------------------------------------------------------------

def test_first_aid_on_a_wounded_investigator(seeded_kernel):
    open_turn(seeded_kernel, "我包扎。")
    healthy = resolve_err(seeded_kernel, "t1-c1", intent="investigate", goal="给自己包扎", method="用急救处理伤口")
    assert healthy["code"] == "needs"
    assert "time.minutes_since_injury" in json.dumps(healthy["details"]["unmet"])

    seed_wound(seeded_kernel.workspace, 8)
    situations = seeded_kernel.table("look")["where"]["situations"]
    assert [s["decision"] for s in situations] == ["healing:first-aid-ordinary"]

    before = event_count(seeded_kernel.workspace)
    result = resolve(seeded_kernel, "t1-c1", intent="investigate", goal="给自己包扎", method="用急救处理伤口")
    assert result["decision"] == "healing:first-aid-ordinary"
    outcome = result["outcome"]
    assert outcome["kind"] == "healing" and outcome["skill"] == "First Aid" and outcome["hp_before"] == 8
    assert outcome["target"] == 30
    assert result["receipts"][0] == "roll:first-aid-t1-c1"
    if outcome["passed"]:
        assert outcome["hp_after"] == 9 and outcome["hp_gained"] == 1
        assert result["effects"] == [{"kind": "hp", "subject": "thomas-hayes", "before": 8, "after": 9}]
        assert result["receipts"] == ["roll:first-aid-t1-c1", "delta:hp-t1-c1"]
        assert events_after(seeded_kernel.workspace, before) == ["roll-resolved", "resource-changed", "decision-settled"]
        assert seeded_kernel.table("look", focus="investigator")["hp"] == 9
        assert read_json(campaign_dir(seeded_kernel.workspace) / "save" / "healing-state" / "thomas-hayes.json")["current_hp"] == 9
        mechanics = narrate(seeded_kernel, "t1-c2", "你缠好绷带。")["mechanics"]
        assert {"kind": "change", "receipt": "delta:hp-t1-c1", "resource": "hp", "subject": "thomas-hayes",
                "subject_label": "托马斯·海斯", "before": 8, "after": 9} in mechanics
    else:
        assert outcome["hp_after"] == 8 and result["effects"] == []
        assert events_after(seeded_kernel.workspace, before) == ["roll-resolved", "decision-settled"]
        # First Aid is once per wound per day.
        again = resolve(seeded_kernel, "t1-c2", intent="investigate", goal="再试", method="用急救")
        assert again["outcome"]["hp_after"] == 8 and again["receipts"] == []


def test_situations_show_the_dying_clock(kernel):
    open_turn(kernel, "我倒下了。")
    assert kernel.table("look")["where"]["situations"] == []
    seed_wound(kernel.workspace, 0, conditions=["dying", "unconscious"])
    situations = {s["decision"]: s for s in kernel.table("look")["where"]["situations"]}
    assert set(situations) == {"healing:dying-round-clock", "healing:first-aid-stabilization"}
    assert situations["healing:dying-round-clock"]["because"] == ["actor.conditions.dying = True", "actor.resources.hp = 0"]
    assert situations["healing:dying-round-clock"]["investigator"] == "thomas-hayes"

    clock = resolve(kernel, "t1-c1", intent="investigate", goal="撑住", method="", decision="healing:dying-round-clock")
    assert clock["outcome"]["kind"] == "healing" and clock["outcome"]["skill"] == "CON" and clock["outcome"]["target"] == 55
    assert clock["receipts"][0] == "roll:con-t1-c1"
    if not clock["outcome"]["passed"]:
        assert "dead" in clock["outcome"]["conditions"]
        assert clock["effects"][0]["kind"] == "condition"


# ---- magic ----------------------------------------------------------------------------------

def test_magic_learn_then_cast_from_the_catalog(seeded_kernel):
    open_turn(seeded_kernel, "我研读。")
    assert seeded_kernel.table("lookup", kind="catalog", query="Flesh Ward", kinds=["spell"])["candidates"][0]["source"] == {"table": "spells.json"}
    unknown = resolve_err(seeded_kernel, "t1-c1", intent="cast", goal="x", method="y", spell="Flesh Ward")
    assert unknown["code"] == "needs" and unknown["details"]["needs"]["field"] == "spell"
    assert unknown["details"]["needs"]["options"] == []

    # The teacher has to be in the room: a person source is an NPC target like any other.
    absent = resolve_err(seeded_kernel, "t1-c1", intent="investigate", goal="学会肉体守护", method="研读",
                         spell="Flesh Ward", target="Walter Corbitt")
    assert absent["code"] == "unknown_entity"
    start = walk_to_confrontation(seeded_kernel)
    for n in range(start, start + 24):
        learned = resolve(seeded_kernel, f"t1-c{n}", intent="investigate", goal="学会肉体守护", method="研读",
                          spell="Flesh Ward", target="Walter Corbitt")
        assert learned["decision"] == "magic:learn-spell" and learned["outcome"]["kind"] == "magic"
        assert learned["outcome"]["source"] == "person" and learned["outcome"]["spell"] == "Flesh Ward"
        if learned["outcome"]["status"] == "studying":
            break
        assert learned["outcome"]["status"] == "failed"
    else:
        raise AssertionError("no successful Hard INT roll in 24 attempts")
    assert learned["receipts"] == [f"roll:int-t1-c{n}"]
    due = learned["outcome"]["study_due_minutes"]
    assert due == learned["outcome"]["study_days"] * 1440

    early = resolve_err(seeded_kernel, f"t1-c{n + 1}", intent="cast", goal="护住自己", method="施法", spell="Flesh Ward")
    assert early["code"] == "needs" and early["details"]["needs"]["field"] == "spell"
    seeded_kernel.table("apply", call_id=f"t1-c{n + 1}", effects=[{"kind": "time", "minutes": due}])

    cast = resolve(seeded_kernel, f"t1-c{n + 2}", intent="cast", goal="护住自己", method="施法", spell="Flesh Ward")
    assert cast["decision"] == "magic:cast-spell"
    outcome = cast["outcome"]
    assert outcome["kind"] == "magic" and outcome["spell"] == "Flesh Ward" and outcome["first_cast"] is True
    assert outcome["status"] in ("cast", "failed")
    assert cast["receipts"][0] == f"roll:pow-t1-c{n + 2}"
    investigator = seeded_kernel.table("look", focus="investigator")
    if outcome["status"] == "cast":
        assert outcome["san_lost"] >= 1
        assert {e["kind"] for e in cast["effects"]} >= {"san"}
        assert investigator["san"] == 55 - outcome["san_lost"]
        assert investigator["mp"] == 11 - outcome["mp_spent"] if outcome["mp_spent"] <= 11 else investigator["mp"] == 0
    magic_state = read_json(campaign_dir(seeded_kernel.workspace) / "save" / "magic-state" / "thomas-hayes.json")
    assert magic_state["studying_spells"][0]["spell"] == "Flesh Ward"

    unpriced = resolve_err(seeded_kernel, f"t1-c{n + 3}", intent="cast", goal="x", method="y", spell="Dominate (variant)")
    assert unpriced["code"] == "needs"  # not known; the module's unpriced variant is refused before any cost


# ---- development -----------------------------------------------------------------------------

def test_development_end_session_and_settle_ending(seeded_kernel):
    open_turn(seeded_kernel, "我们收工。")
    passed_id, _ = first_success(seeded_kernel, "t1-c", intent="investigate", goal="看清楚", method="用侦查")
    n = int(passed_id.split("-c")[1])
    ticks = read_json(campaign_dir(seeded_kernel.workspace) / "save" / "development-state" / "thomas-hayes.json")["ticks"]
    assert [t["skill"] for t in ticks.values()] == ["Spot Hidden"]

    pending = resolve_err(seeded_kernel, f"t1-c{n + 1}", intent="montage", goal="x", method="",
                          decision="development:settle-ending")
    assert pending["code"] == "needs"

    ended = resolve(seeded_kernel, f"t1-c{n + 1}", intent="montage", goal="调查员撤出宅子，把钥匙交还。", method="",
                    decision="development:end-session", ending="retreat")
    assert ended["decision"] == "development:end-session"
    outcome = ended["outcome"]
    assert outcome["kind"] == "development" and outcome["ending_kind"] == "retreat" and outcome["ending_id"].startswith("ending-")
    luck = outcome["luck_recovery"]
    assert luck["luck_before"] == 50 and luck["luck_after"] == 50 + luck["gained"]
    investigator = seeded_kernel.table("look", focus="investigator")
    assert investigator["luck"] == luck["luck_after"]
    improved = {row["skill"]: row for row in outcome["skills_improved"]}
    if "Spot Hidden" in improved:
        assert investigator["skills"]["Spot Hidden"] == improved["Spot Hidden"]["after"] > 55
        assert any(e["kind"] == "skill" for e in ended["effects"])
    else:
        assert investigator["skills"]["Spot Hidden"] == 55
    directory = campaign_dir(seeded_kernel.workspace) / "save" / "development-settlements" / "endings" / outcome["ending_id"]
    assert (directory / "capsule.json").exists() and (directory / "thomas-hayes.json").exists()
    capsule = read_json(directory / "capsule.json")
    assert capsule["development_inputs"]["thomas-hayes"]["skills_checked"] == ["Spot Hidden"]
    assert capsule["decision_id"] == f"t1-c{n + 1}"

    # A settlement that never landed (capsule without receipt) is what settle-ending is for.
    (directory / "thomas-hayes.json").unlink()
    assert [s["decision"] for s in seeded_kernel.table("look")["where"]["situations"]] == ["development:settle-ending"]
    settled = resolve(seeded_kernel, f"t1-c{n + 2}", intent="montage", goal="x", method="",
                      decision="development:settle-ending")
    assert settled["outcome"]["kind"] == "development" and settled["outcome"]["status"] == "settled"
    assert settled["outcome"]["ending_id"] == outcome["ending_id"]
    assert (directory / "thomas-hayes.json").exists()


# ---- lookup ---------------------------------------------------------------------------------

def test_lookup_rule_and_catalog(kernel):
    open_turn(kernel)
    rules = kernel.table("lookup", kind="rule", query="pushed roll")["rules"]
    assert 0 < len(rules) <= 8
    assert all(r["name"].startswith("rule:coc7:") and r["family"] and isinstance(r["evidence_span_ids"], list) for r in rules)
    assert any(r["family"] == "push-luck" for r in rules)
    one_reroll = kernel.table("lookup", kind="rule", query="one reroll")["rules"][0]
    assert one_reroll["name"] == "rule:coc7:push-luck:one-reroll" and one_reroll["evidence_span_ids"]

    catalog = kernel.table("lookup", kind="catalog", query="Walter Corbitt")
    assert catalog["candidates"][0]["kind"] == "creature" and catalog["candidates"][0]["summary"]["hp"] == 16
    weapons = kernel.table("lookup", kind="catalog", query="revolver", kinds=["weapon"])
    assert weapons["kinds"] == ["weapon"] and all(c["kind"] == "weapon" for c in weapons["candidates"])
    assert any(c["params"].get("damage_die") for c in weapons["candidates"])
    assert kernel.table("lookup", kind="catalog", query="Journalist", kinds=["occupation"])["candidates"][0]["name"] == "Journalist"
    assert kernel.table("lookup", kind="catalog", query="Acrophobia")["candidates"][0]["kind"] == "phobia"
    assert kernel.table("lookup", kind="catalog", query="Ablutomania")["candidates"][0]["kind"] == "mania"
    tome = kernel.table("lookup", kind="catalog", query="Necronomicon", kinds=["tome"])["candidates"][0]
    assert tome["params"]["sanity_cost"]
    family = kernel.table("lookup", kind="catalog", query="Summon/Bind Byakhee", kinds=["spell"])
    assert family["candidates"][0]["parameterisation"]["canonical_name"] == "Summon/Bind Byakhee"
    module = kernel.table("lookup", kind="catalog", query="Dominate (variant)", kinds=["spell"])["candidates"][0]
    assert module["module_authored"]["authority"] == "module_authored_spell" and module["module_authored"]["costs"]["authored"] is False
    assert kernel.table_err("lookup", kind="catalog", query="x", kinds=["planet"])["code"] == "invalid_params"


# ---- replay and needs fixes --------------------------------------------------------------------

def test_replay_and_needs_fixes(seeded_kernel):
    open_turn(seeded_kernel, "我去报社。")
    seeded_kernel.table("apply", call_id="t1-c1", effects=[{"kind": "move", "to": "newspaper-morgue"}])
    action = {"intent": "social", "goal": "让阿蒂放我们进剪报室", "method": "跟他聊聊", "target": "Arty Wilmot"}
    assert seeded_kernel.table_err("resolve", call_id="t1-c2", action=action)["code"] == "needs"
    assert len(seeded_kernel.table("status")["receipts"]) == 1
    fixed = {**action, "skill": "Charm"}
    first = seeded_kernel.table("resolve", call_id="t1-c2", action=fixed)
    assert first["outcome"]["approach"] == "charm"
    replay = seeded_kernel.table("resolve", call_id="t1-c2", action=fixed)
    assert replay == {**first, "replayed": True}
    assert len([r for r in seeded_kernel.table("status")["receipts"] if r["kind"] == "roll"]) == 1
    conflict = seeded_kernel.table_err("resolve", call_id="t1-c2", action={**fixed, "skill": "Persuade"})
    assert conflict["code"] == "idempotency_conflict"
    events = [e for e in read_jsonl(campaign_dir(seeded_kernel.workspace) / "events.jsonl") if e["type"] == "decision-settled"]
    assert len(events) == 1 and events[0]["data"]["decision"] == "social:adjudicate-difficulty"
