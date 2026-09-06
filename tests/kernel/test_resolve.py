from conftest import RpcClient, campaign_dir, open_turn, read_jsonl


def resolve(client, call_id, **action):
    return client.table("resolve", call_id=call_id, action=action)


def test_ordinary_check_is_seeded_and_consistent(seeded_kernel, tmp_path):
    open_turn(seeded_kernel)
    result = resolve(seeded_kernel, "t1-c1", intent="investigate", goal="找出房间里藏着的东西",
                     method="用侦查扫视桌面和墙角")
    assert result["receipt"] == "roll:spot-hidden-t1-c1"
    outcome = result["outcome"]
    assert outcome["kind"] == "check"
    assert outcome["skill"] == "Spot Hidden"
    assert outcome["target"] == 55 and outcome["threshold"] == 55
    assert outcome["difficulty"] == "regular"
    assert 1 <= outcome["roll"] <= 100
    assert outcome["bonus"] == 0 and outcome["penalty"] == 0
    if outcome["roll"] == 1:
        assert outcome["level"] == "critical" and outcome["passed"]
    elif outcome["roll"] == 100:
        assert outcome["level"] == "fumble" and not outcome["passed"]
    elif outcome["roll"] <= 11:
        assert outcome["level"] == "extreme" and outcome["passed"]
    elif outcome["roll"] <= 27:
        assert outcome["level"] == "hard" and outcome["passed"]
    elif outcome["roll"] <= 55:
        assert outcome["level"] == "regular" and outcome["passed"]
    else:
        assert outcome["level"] == "failure" and not outcome["passed"]
    assert result["session"] is None and result["pending_choice"] is None
    if outcome["passed"] or outcome["level"] == "fumble":
        assert result["continuations"] == []
    else:
        assert [c["decision"] for c in result["continuations"]] == ["push-luck:pushed-roll", "push-luck:luck-spend"]
    assert "percentile-check" in result["rule_refs"]

    status = seeded_kernel.table("status")
    assert status["state"] == "acting"
    assert [r["id"] for r in status["receipts"]] == ["roll:spot-hidden-t1-c1"]
    events = read_jsonl(campaign_dir(seeded_kernel.workspace) / "events.jsonl")
    rolled = [e for e in events if e["type"] == "roll-resolved"]
    assert rolled[0]["receipt"] == "roll:spot-hidden-t1-c1" and rolled[0]["data"]["roll"] == outcome["roll"]

    # Same seed, fresh process, same first roll.
    other = RpcClient(tmp_path / "ws-2", env={"COC_KERNEL_SEED": "7"})
    try:
        open_turn(other)
        again = resolve(other, "t1-c1", intent="investigate", goal="找出房间里藏着的东西",
                        method="用侦查扫视桌面和墙角")
        assert again["outcome"]["roll"] == outcome["roll"]
    finally:
        other.close()


def test_explicit_skill_characteristic_and_modifiers(seeded_kernel):
    open_turn(seeded_kernel)
    explicit = resolve(seeded_kernel, "t1-c1", intent="social", goal="让诺特多付点钱",
                       method="软硬兼施", skill="Fast Talk")
    assert explicit["outcome"]["skill"] == "Fast Talk" and explicit["outcome"]["target"] == 45

    zh = resolve(seeded_kernel, "t1-c2", intent="investigate", goal="看清楚", method="用图书馆使用翻档案")
    assert zh["outcome"]["skill"] == "Library Use" and zh["receipt"] == "roll:library-use-t1-c2"

    char = resolve(seeded_kernel, "t1-c3", intent="investigate", goal="撞开门", method="用力量硬撞")
    assert char["outcome"]["skill"] == "STR" and char["outcome"]["target"] == 60

    luck = resolve(seeded_kernel, "t1-c4", intent="investigate", goal="碰运气", method="", skill="幸运")
    assert luck["outcome"]["skill"] == "LUCK" and luck["outcome"]["target"] == 50

    base = resolve(seeded_kernel, "t1-c5", intent="investigate", goal="辨认符号", method="", skill="Occult")
    assert base["outcome"]["target"] == 5  # not on the sheet: coc7 base chance

    hard = resolve(seeded_kernel, "t1-c6", intent="investigate", goal="听墙角", method="用聆听贴门",
                   modifiers={"bonus_dice": 1, "difficulty": "hard"})
    assert hard["outcome"]["difficulty"] == "hard"
    assert hard["outcome"]["target"] == 45 and hard["outcome"]["threshold"] == 22
    assert hard["outcome"]["bonus"] == 1
    assert "roll-modifiers" in hard["rule_refs"]

    error = seeded_kernel.table_err("resolve", call_id="t1-c7", action={
        "intent": "investigate", "goal": "x", "method": "y", "skill": "Listen", "modifiers": {"bonus_dice": 3}})
    assert error["code"] == "invalid_params"
    assert seeded_kernel.table_err("resolve", call_id="t1-c7", action={
        "intent": "investigate", "goal": "x", "method": "y", "modifiers": {"difficulty": "impossible"}})["code"] == "invalid_params"


def test_needs_when_skill_is_ambiguous_or_missing(kernel):
    open_turn(kernel)
    missing = kernel.table_err("resolve", call_id="t1-c1", action={
        "intent": "investigate", "goal": "找到线索", "method": "仔细翻看房间里的每个角落"})
    assert missing["code"] == "needs"
    needs = missing["details"]["needs"]
    assert needs["field"] == "skill"
    assert 1 <= len(needs["options"]) <= 6
    assert "Spot Hidden" in needs["options"]

    ambiguous = kernel.table_err("resolve", call_id="t1-c1", action={
        "intent": "social", "goal": "让他松口", "method": "先用 Charm 再用 Intimidate"})
    assert ambiguous["code"] == "needs"
    options = ambiguous["details"]["needs"]["options"]
    assert options[:2] == ["Charm", "Intimidate"] or set(options[:2]) == {"Charm", "Intimidate"}
    assert len(options) <= 6

    unknown = kernel.table_err("resolve", call_id="t1-c1", action={
        "intent": "social", "goal": "x", "method": "y", "skill": "Fighting"})
    assert unknown["code"] == "needs"

    # A failed resolve leaves no receipt and the same call_id stays usable.
    assert kernel.table("status")["receipts"] == []
    fixed = kernel.table("resolve", call_id="t1-c1", action={
        "intent": "investigate", "goal": "找到线索", "method": "仔细翻看房间里的每个角落", "skill": "Spot Hidden"})
    assert fixed["outcome"]["skill"] == "Spot Hidden"


def test_none_intents_and_session_intents(kernel):
    open_turn(kernel)
    for n, intent in enumerate(("idle", "meta", "stuck", "ambiguous"), start=1):
        result = resolve(kernel, f"t1-c{n}", intent=intent, goal="", method="")
        assert result["outcome"] == {"kind": "none"}
        assert result["note"]
        assert "receipt" not in result
    assert kernel.table("status")["receipts"] == []
    assert kernel.table("status")["state"] == "acting"

    # combat and flee wait for the session engines; cast is live but needs a spell.
    for n, intent in enumerate(("combat", "flee"), start=5):
        error = kernel.table_err("resolve", call_id=f"t1-c{n}", action={"intent": intent, "goal": "x", "method": "y"})
        assert error["code"] == "not_implemented", error
        assert error["details"]["family"] in ("combat", "chase")
    cast = kernel.table_err("resolve", call_id="t1-c7", action={"intent": "cast", "goal": "x", "method": "y"})
    assert cast["code"] == "needs" and cast["details"]["needs"]["field"] == "spell"
    assert kernel.table_err("resolve", call_id="t1-c9", action={"intent": "dance", "goal": "x", "method": "y"})["code"] == "invalid_params"
    assert kernel.table_err("resolve", call_id="nope", action={"intent": "idle"})["code"] == "invalid_params"
    assert kernel.table_err("resolve", action={"intent": "idle"})["code"] == "invalid_params"


def test_unknown_actor(kernel):
    open_turn(kernel)
    error = kernel.table_err("resolve", call_id="t1-c1", action={
        "intent": "investigate", "goal": "x", "method": "侦查", "actor": "Eleanor"})
    assert error["code"] == "unknown_entity"
    ok = resolve(kernel, "t1-c1", intent="investigate", goal="x", method="侦查", actor="托马斯·海斯")
    assert ok["outcome"]["skill"] == "Spot Hidden"
