"""Contract §134.9–§134.14 (and §134.17's amendment of §134.11): the haunting's morgue obligations, issued, claimed,
settled and waived.

Every case drives the emitted kernel over RPC on a fresh haunting campaign and asserts what the kernel
issued (the options rows, the capsule rows, the gate string), which receipts and flags exist, and what the
result told the Keeper -- never private state or call order. A "forced" pass or failure is a recorded
seed for exactly this call sequence (the kernel's dice are seeded, never stubbed).
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from conftest import CAMPAIGN, RpcClient, campaign_dir, read_json

MORGUE = "newspaper-morgue"
ACCESS, ARCHIVIST = "globe-clippings-access", "globe-archivist"
FLAG = "newspaper-morgue-clippings-access"
GUARDED = {"globe-unpublished-story", "macario-tragedy"}
APPROACHES = ["Persuade", "Intimidate", "Charm", "Fast Talk"]
FAILURE_LINE = ("Arty refuses access to the clipping room; the investigator may try another route or propose a "
                "changed method for a pushed attempt.")
PUSH_LINE = "Arty has the investigator ejected and permanently bars them from the newspaper clipping room."

# Seeds for the sequence `at_morgue` -> `meet_arty` -> one Persuade against Arty (and, for PUSH, a push):
PASS = 4       # the Persuade passes (regular)
FAIL = 1       # the Persuade fails (an ordinary failure, not a fumble)
PUSH = 5       # it fails, and the push that follows it passes
# ... and for the two-turn sequence of the offer-ledger case, the Persuade on turn 2 passes:
LEDGER_PASS = 4


def kernel_with(tmp_path: Path, seed: int) -> RpcClient:
    return RpcClient(tmp_path / "ws", env={"COC_KERNEL_SEED": str(seed)})


@pytest.fixture
def morgue(tmp_path):
    clients: list[RpcClient] = []

    def open_at(seed: int) -> RpcClient:
        client = kernel_with(tmp_path / f"s{seed}-{len(clients)}", seed)
        clients.append(client)
        at_morgue(client)
        return client
    yield open_at
    for client in clients:
        client.close()


def at_morgue(client: RpcClient) -> None:
    client.ok("campaign.create", {"id": CAMPAIGN, "module": "the-haunting", "pregen": "thomas-hayes", "play_language": "en"})
    client.table("narrate", call_id="t0-c1", text="The opening.")
    client.table("player_input", text="I go to the Globe and ask for the old clippings on the Corbitt House.")
    client.table("apply", call_id="t1-c1", effects=[{"kind": "move", "to": MORGUE}])


def meet_arty(client: RpcClient, call_id: str = "t1-c2") -> dict:
    return client.table("apply", call_id=call_id, effects=[{"kind": "person", "who": "Arty Wilmot", "name": "Arty"}])


def persuade(client: RpcClient, call_id: str = "t1-c3", *, claim: bool = True, **action) -> dict:
    body = {"intent": "social", "skill": "Persuade", "goal": "get into the clippings room",
            "method": "remind him the Globe owes an old colleague a favour", **action}
    if claim:
        body.setdefault("obligation", ACCESS)
    else:
        body.setdefault("target", "Arty Wilmot")
        body.setdefault("decision", "core-check:ordinary-check")
    return client.call("table.resolve", {"campaign": CAMPAIGN, "call_id": call_id, "action": body})


def options(client: RpcClient) -> dict:
    return client.ok("table.apply.options", {"campaign": CAMPAIGN})


def rows(client: RpcClient) -> dict[str, dict]:
    return {row["handle"]: row for row in options(client)["obligations"]}


def scene_rows(client: RpcClient) -> dict[str, dict]:
    return {row["name"]: row for row in client.table("capsule")["obligations"] if row["kind"] == "scene"}


def world(client: RpcClient) -> dict:
    return read_json(campaign_dir(client.workspace) / "world.json")


def turn_receipts(client: RpcClient) -> list[dict]:
    return read_json(campaign_dir(client.workspace) / "turn.json")["receipts"]


def clue_candidates(client: RpcClient) -> dict[str, dict]:
    return {row["effect"]["clue"]: row for row in options(client)["candidates"] if row["effect"]["kind"] == "clue"}


def assert_capsule_agrees(client: RpcClient) -> None:
    """The capsule's scene rows are the options rows, compacted: same handles, people and states."""
    issued, capsule = rows(client), scene_rows(client)
    assert list(capsule) == list(issued)
    for handle, row in issued.items():
        assert capsule[handle]["state"] == row["state"]
        assert capsule[handle].get("who") == row.get("who")


def refusal(result: dict) -> tuple[str, str]:
    assert not result["ok"], result.get("result")
    return result["error"]["code"], result["error"]["details"]["reason"]


# ---- issuance ------------------------------------------------------------------------------------


def test_the_morgue_issues_the_gate_open_and_the_archivist_blocked(morgue):
    client = morgue(PASS)
    issued = rows(client)
    assert list(issued) == [ACCESS, ARCHIVIST]
    access, archivist = issued[ACCESS], issued[ARCHIVIST]
    assert access["state"] == "open" and access["next"] == {"kind": "meet", "person": "Arty Wilmot"}
    # §135.26: the check the meeting leads to, so the clerk can carry the meeting when the check is judged `now`.
    assert access["then"] == {"kind": "check", "target": "Arty Wilmot", "selection": "approach",
                              "approaches": [{"skill": name} for name in APPROACHES], "difficulty": "regular"}
    assert access["who"] == "Arty Wilmot" and access["trigger"] == {"kind": "attempt", "guards": {"clues": ["globe-unpublished-story", "macario-tragedy"]}}
    assert access["book"] == {"failure": FAILURE_LINE, "fumble": access["book"]["fumble"], "push": PUSH_LINE}
    assert access["source"] == [{"page": 448, "anchor": "Arty Wilmot"}]
    # Ruling Q2: the book skips Arty's reaction roll, so the clerk may not settle the Mod's first impression.
    assert access["reaction"] == "preordained"
    assert access["mod_contact"] == [{"mod": "natural-npc", "check": "natural-npc:first-impression", "clerk": False}]
    assert archivist["state"] == "blocked" and "next" not in archivist
    assert archivist["trigger"] == {"kind": "after", "after": ACCESS}
    # The guard reaches every reader: the candidate row and the one gate string.
    clues = clue_candidates(client)
    assert {name for name, row in clues.items() if row.get("guarded_by") == ACCESS} == GUARDED
    assert "guarded_by" not in clues["globe-fire-cutoff"]
    for name in GUARDED:
        assert clues[name]["description"]["gate"].endswith(f"; guarded by obligation {ACCESS}")
    capsule = client.table("capsule")
    assert {row["name"]: row["gate"] for row in capsule["known"]["clues_here"]}["macario-tragedy"].endswith(f"guarded by obligation {ACCESS}")
    assert "obligation" not in {row["name"]: row["gate"] for row in capsule["known"]["clues_here"]}["globe-fire-cutoff"]
    assert_capsule_agrees(client)
    assert scene_rows(client)[ACCESS]["cue"].startswith("next: meet Arty Wilmot")


def test_meeting_arty_makes_the_check_the_next_step(morgue):
    client = morgue(PASS)
    meet_arty(client)
    access = rows(client)[ACCESS]
    assert access["state"] == "open"
    assert access["next"] == {"kind": "check", "target": "Arty Wilmot", "selection": "approach",
                              "approaches": [{"skill": name} for name in APPROACHES], "difficulty": "regular"}
    assert "then" not in access, "a check that is itself next leads nowhere further"
    assert "resolve with action.obligation" in scene_rows(client)[ACCESS]["cue"]
    assert_capsule_agrees(client)


def test_a_scene_without_obligations_reads_as_before(tmp_path):
    client = kernel_with(tmp_path, PASS)
    try:
        client.ok("campaign.create", {"id": CAMPAIGN, "module": "the-haunting", "pregen": "thomas-hayes", "play_language": "en"})
        client.table("narrate", call_id="t0-c1", text="The opening.")
        # §134.18: the office states the commission, so the reading-as-before case is a scene that states none.
        client.table("player_input", text="I walk over to the Central Library.")
        client.table("apply", call_id="t1-c1", effects=[{"kind": "move", "to": "central-library"}])
        assert "obligations" not in options(client)
        assert not scene_rows(client)
        assert all("guarded_by" not in row for row in options(client)["candidates"])
    finally:
        client.close()


# ---- settlement ----------------------------------------------------------------------------------


def test_a_claimed_pass_sets_the_flag_in_the_same_call(morgue):
    client = morgue(PASS)
    meet_arty(client)
    result = persuade(client)
    assert result["ok"], result.get("error")
    settled = result["result"]
    assert settled["outcome"]["passed"] is True and settled["outcome"]["skill"] == "Persuade"
    assert settled["obligation"] == {"handle": ACCESS, "settled": True}
    # The same call wrote the flag: it is on disk before anything else runs, beside the roll receipt.
    assert world(client)["flags"][FLAG] is True
    roll = next(receipt for receipt in turn_receipts(client) if receipt["id"] == settled["receipt"])
    assert roll["obligation"] == {"handle": ACCESS, "settled": True} and roll["difficulty"] == "regular"
    events = [json.loads(line) for line in (campaign_dir(client.workspace) / "events.jsonl").read_text().splitlines() if line.strip()]
    flagged = [event for event in events if event.get("type") == "flag-set"]
    assert len(flagged) == 1 and flagged[0]["data"]["name"] == FLAG and flagged[0]["receipt"] == settled["receipt"]
    # What the gate held opens: the archivist becomes the next obligation and the guards clear.
    issued = rows(client)
    assert issued[ACCESS]["state"] == "settled" and "next" not in issued[ACCESS]
    assert issued[ARCHIVIST]["state"] == "open" and issued[ARCHIVIST]["next"] == {"kind": "meet", "person": "Ruth Blake"}
    clues = clue_candidates(client)
    assert all("guarded_by" not in row and "obligation" not in row["description"]["gate"] for row in clues.values())
    assert_capsule_agrees(client)


def test_a_claimed_failure_leaves_it_open_with_the_book_line_and_no_consequence(morgue):
    client = morgue(FAIL)
    meet_arty(client)
    before = world(client)
    result = persuade(client)
    assert result["ok"], result.get("error")
    failed = result["result"]
    assert failed["outcome"]["level"] == "failure"
    assert failed["obligation"] == {"handle": ACCESS, "settled": False, "book": FAILURE_LINE, "push": PUSH_LINE}
    # No consequence: one roll receipt and nothing else; no flag, no clock, no presence change.
    assert failed["receipts"] == [failed["receipt"]]
    after = world(client)
    assert FLAG not in after.get("flags", {})
    assert after["clock"] == before["clock"] and after["npc_presence"] == before["npc_presence"]
    assert rows(client)[ACCESS]["state"] == "open"
    assert clue_candidates(client)["macario-tragedy"]["guarded_by"] == ACCESS


def test_a_push_continues_the_claim_it_pushes(morgue):
    client = morgue(PUSH)
    meet_arty(client)
    assert persuade(client)["result"]["obligation"]["settled"] is False
    pushed = client.call("table.resolve", {"campaign": CAMPAIGN, "call_id": "t1-c4", "action": {
        "intent": "social", "push": True, "method": "lean on the old newsroom debt", "stakes": PUSH_LINE}})
    assert pushed["ok"], pushed.get("error")
    assert pushed["result"]["outcome"]["passed"] is True
    assert pushed["result"]["obligation"] == {"handle": ACCESS, "settled": True}
    assert world(client)["flags"][FLAG] is True
    assert rows(client)[ACCESS]["state"] == "settled"


def test_the_same_skill_without_the_claim_is_the_folded_attempt(morgue):
    # §134.11's "settles nothing" (D4), as amended by §134.17: the same Persuade against the same person is the
    # obligation's attempt, and says it was folded; without a target it settles nothing (test_obligation_fold.py).
    client = morgue(PASS)
    meet_arty(client)
    result = persuade(client, claim=False)
    assert result["ok"], result.get("error")
    assert result["result"]["outcome"]["passed"] is True and result["result"]["outcome"]["skill"] == "Persuade"
    assert result["result"]["obligation"] == {"handle": ACCESS, "step": 1, "counted": "folded", "settled": True}
    assert world(client)["flags"][FLAG] is True
    assert rows(client)[ACCESS]["state"] == "settled"


def test_apply_flag_waives_and_reopens_with_ordinary_receipts(morgue):
    client = morgue(PASS)
    waived = client.table("apply", call_id="t1-c2", effects=[{"kind": "flag", "name": FLAG, "value": True, "why": "Arty owes the investigator"}])
    receipt = next(r for r in turn_receipts(client) if r["id"] == waived["receipts"][0])
    assert receipt["kind"] == "flag" and receipt["name"] == FLAG and receipt["value"] is True
    assert rows(client)[ACCESS]["state"] == "waived" and rows(client)[ARCHIVIST]["state"] == "open"
    assert_capsule_agrees(client)
    reopened = client.table("apply", call_id="t1-c3", effects=[{"kind": "flag", "name": FLAG, "value": False}])
    assert next(r for r in turn_receipts(client) if r["id"] == reopened["receipts"][0])["value"] is False
    assert rows(client)[ACCESS]["state"] == "open" and rows(client)[ARCHIVIST]["state"] == "blocked"
    client.table("apply", call_id="t1-c4", effects=[{"kind": "flag", "name": FLAG, "value": True}])
    assert rows(client)[ACCESS]["state"] == "settled"


def test_a_guarded_clue_lands_while_open_and_says_so(morgue):
    client = morgue(PASS)
    result = client.table("apply", call_id="t1-c2", effects=[{"kind": "clue", "clue": "macario-tragedy"}])
    assert result["obligation_open"] == ACCESS
    receipt = next(r for r in turn_receipts(client) if r["id"] == result["receipts"][0])
    assert receipt["kind"] == "clue" and receipt["obligation_open"] == ACCESS
    assert "macario-tragedy" in world(client)["discovered_clues"]
    # An unguarded clue crosses nothing, and a waived gate is crossed by nothing.
    plain = client.table("apply", call_id="t1-c3", effects=[{"kind": "clue", "clue": "globe-fire-cutoff"}])
    assert "obligation_open" not in plain
    both = client.table("apply", call_id="t1-c4", effects=[
        {"kind": "flag", "name": FLAG, "value": True, "why": "Arty waves them through"},
        {"kind": "clue", "clue": "globe-unpublished-story"}])
    assert "obligation_open" not in both


# ---- refusals ------------------------------------------------------------------------------------


def test_a_claim_is_refused_by_name_when_it_does_not_fit(morgue):
    client = morgue(PASS)
    assert refusal(persuade(client, "t1-c2")) == ("invalid_params", "obligation_step")
    meet_arty(client, "t1-c3")
    assert refusal(persuade(client, "t1-c4", obligation="no-such-gate")) == ("unknown_entity", "obligation_unknown")
    assert refusal(persuade(client, "t1-c5", obligation=ARCHIVIST)) == ("invalid_params", "obligation_not_open")
    assert refusal(persuade(client, "t1-c6", skill="Spot Hidden")) == ("invalid_params", "obligation_skill")
    missing = persuade(client, "t1-c7", skill=None)
    assert refusal(missing) == ("needs", "obligation_skill")
    assert missing["error"]["details"]["needs"]["options"] == APPROACHES
    assert refusal(persuade(client, "t1-c8", modifiers={"difficulty": "hard", "reason": "he is busy"})) == ("invalid_params", "obligation_difficulty")
    assert refusal(persuade(client, "t1-c9", target="Ruth Blake")) == ("invalid_params", "obligation_target")
    assert refusal(persuade(client, "t1-c10", decision="core-check:opposed-check")) == ("invalid_params", "obligation_decision")
    assert refusal(persuade(client, "t1-c11", intent="idle")) == ("invalid_params", "obligation_intent")
    client.table("apply", call_id="t1-c12", effects=[{"kind": "move", "to": "central-library"}])
    assert refusal(persuade(client, "t1-c13")) == ("not_here", "obligation_not_here")
    # None of it wrote the flag or a roll.
    assert FLAG not in world(client).get("flags", {})
    assert not [r for r in turn_receipts(client) if r["kind"] == "roll"]


# ---- the offer ledger ----------------------------------------------------------------------------


def test_the_offer_ledger_counts_the_obligation_and_marks_it_taken(tmp_path):
    client = kernel_with(tmp_path, LEDGER_PASS)
    try:
        at_morgue(client)
        client.table("narrate", call_id="t1-c2", text="The Globe's lobby smells of ink.")
        capsule = client.table("player_input", text="I ask the editor to let me into the clippings room.")["capsule"]
        assert {row["name"]: row["state"] for row in capsule["obligations"] if row["kind"] == "scene"} == {ACCESS: "open", ARCHIVIST: "blocked"}
        meet_arty(client, "t2-c1")
        assert persuade(client, "t2-c2")["result"]["obligation"]["settled"] is True
        client.table("narrate", call_id="t2-c3", text="Arty relents and waves you downstairs.")
        telemetry = [json.loads(line) for line in (campaign_dir(client.workspace) / "telemetry.jsonl").read_text().splitlines() if line.strip()]
        ledger = next(row for row in telemetry if row.get("lane") == "offers" and row["turn"] == 2)
        assert f"obligation:{ACCESS}" in ledger["offered"] and f"obligation:{ACCESS}" in ledger["taken"]
        assert f"obligation:{ARCHIVIST}" not in ledger["offered"]  # blocked is not an offer
        # Counting only: nothing of the ledger comes back in the next capsule.
        nxt = client.table("player_input", text="I follow him.")["capsule"]
        assert "offers" not in json.dumps(nxt["obligations"])
    finally:
        client.close()


# ---- §134.18 (SL-52 stage 3): the commission is an accept step whose settlement yields ------------------------------

COMMISSION, COMMISSION_FLAG = "knott-accept-commission", "knott-commission-accepted"
COMMISSION_YIELDS = {"clues": ["knott-research-leads", "knott-keys"], "items": ["Corbitt House key"], "cash": 20}


def at_office(client: RpcClient) -> None:
    client.ok("campaign.create", {"id": CAMPAIGN, "module": "the-haunting", "pregen": "thomas-hayes", "play_language": "en"})
    client.table("narrate", call_id="t0-c1", text="The opening.")
    client.table("player_input", text="I take the job.")


def test_a_fresh_campaign_carries_the_commission_as_an_open_accept_with_its_settlement(tmp_path):
    client = kernel_with(tmp_path, PASS)
    try:
        at_office(client)
        issued = rows(client)
        assert list(issued) == [COMMISSION]
        commission = issued[COMMISSION]
        assert commission["state"] == "open" and commission["who"] == "Steven Knott"
        assert commission["trigger"] == {"kind": "attempt", "guards": {"clues": ["knott-keys", "knott-research-leads"]}}
        assert commission["yields"] == COMMISSION_YIELDS
        assert commission["next"] == {"kind": "accept", "person": "Steven Knott", "settle": [
            {"kind": "flag", "name": COMMISSION_FLAG, "value": True},
            {"kind": "clue", "clue": "knott-research-leads", "from": "Steven Knott"},
            {"kind": "clue", "clue": "knott-keys", "from": "Steven Knott"},
            {"kind": "item", "name": "Corbitt House key", "from": "Steven Knott"},
            {"kind": "cash", "delta": 20, "source": "quote", "with": "Steven Knott"}]}
        clues = clue_candidates(client)
        assert {name for name, row in clues.items() if row.get("guarded_by") == COMMISSION} == {"knott-keys", "knott-research-leads"}
        assert scene_rows(client)[COMMISSION]["cue"].startswith("next: accept Steven Knott's offer; one apply settles it")
        assert_capsule_agrees(client)
        # Not a roll: action.obligation names the apply that settles it.
        code, reason = refusal(client.call("table.resolve", {"campaign": CAMPAIGN, "call_id": "t1-c1", "action": {
            "intent": "social", "skill": "Persuade", "goal": "take the job", "method": "agree", "obligation": COMMISSION}}))
        assert (code, reason) == ("invalid_params", "obligation_step")
    finally:
        client.close()


def test_the_accept_settlement_files_its_yields_in_one_apply_and_crosses_nothing(tmp_path):
    client = kernel_with(tmp_path, PASS)
    try:
        at_office(client)
        settle = rows(client)[COMMISSION]["next"]["settle"]
        result = client.table("apply", call_id="t1-c1", effects=settle)
        assert "obligation_open" not in result, "the flag comes first: the guarded clues cross nothing"
        receipts = turn_receipts(client)
        assert [receipt["kind"] for receipt in receipts] == ["flag", "clue", "clue", "item", "cash"]
        assert {receipt.get("clue") for receipt in receipts if receipt["kind"] == "clue"} == {"knott-research-leads", "knott-keys"}
        cash = next(receipt for receipt in receipts if receipt["kind"] == "cash")
        assert cash["delta"] == 20 and cash["source"] == "quote"
        assert next(receipt for receipt in receipts if receipt["kind"] == "item")["name"] == "Corbitt House key"
        assert all("obligation_open" not in receipt for receipt in receipts)
        assert world(client)["flags"][COMMISSION_FLAG] is True
        assert rows(client)[COMMISSION]["state"] == "settled"
        # The research exits the leads hold open now.
        moves = {row["effect"]["to"]: row["description"] for row in options(client)["candidates"] if row["effect"]["kind"] == "move"}
        assert moves["newspaper-morgue"]["unlock_when"]["met"] is True
    finally:
        client.close()

