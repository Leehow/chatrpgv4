"""Contract §134.17: an investigator's ordinary check that fits an open obligation's check is that obligation's attempt.

Every case drives the emitted kernel over RPC on a fresh haunting campaign at the morgue and asserts what `resolve`
returned, which receipts, flags and events exist and what the obligation rows say -- never private state or call
order. The arguments are the Keeper's call of live gate #3, turn 2 (`gate3-haunting-2329`, `t2-c1`: Persuade against
Arty Wilmot, one bonus die with its reason), without the claim unless a case says otherwise. A "forced" level is a
recorded seed for exactly the call sequence of the case (the kernel's dice are seeded, never stubbed).
"""
from __future__ import annotations

import json
import shutil
from pathlib import Path

import pytest

from conftest import CAMPAIGN, CONTENT_DIR, RpcClient, campaign_dir, read_json

MORGUE = "newspaper-morgue"
ACCESS, ARCHIVIST = "globe-clippings-access", "globe-archivist"
FLAG = "newspaper-morgue-clippings-access"
FAILURE_LINE = ("Arty refuses access to the clipping room; the investigator may try another route or propose a "
                "changed method for a pushed attempt.")
PUSH_LINE = "Arty has the investigator ejected and permanently bars them from the newspaper clipping room."
ORDINARY_OUTCOME = {"kind", "skill", "target", "difficulty", "threshold", "roll", "level", "passed", "bonus", "penalty", "pushed"}

# The Keeper's `resolve` of gate #3 turn 2, verbatim, less its `obligation`.
GATE3 = {"intent": "social", "goal": "请剪报室编辑调出科比特宅这些年的旧剪报",
         "method": "说明自己是受房东委托查证的私家侦探，请求按街道地址调出相关旧报",
         "target": "Arty Wilmot", "skill": "Persuade",
         "modifiers": {"bonus_dice": 1, "reason": "来意具体：受房东委托、按地址查旧报，给了他一个可以当成自己量裁的理由"}}

# Seeds for `at_morgue` -> `meet_arty` -> the gate-3 resolve (and, for PUSH, a push after it):
PASS = 2   # the Persuade passes at regular
FAIL = 4   # it fails (an ordinary failure, not a fumble)
PUSH = 3   # it fails, and the push that follows it passes
# ... and on the derived haunting, for the gate-3 resolve (the social adjudication) then an ordinary check:
AMBIGUOUS_PASS = 5   # the ordinary check passes at regular

# The second obligation of the derived haunting (the ambiguity case): the same person, Persuade among its approaches.
SECOND, SECOND_FLAG = "globe-fire-archive", "newspaper-morgue-fire-archive"


def second_obligation(root: Path) -> Path:
    """The shipped content with a second open obligation at the morgue whose check is Persuade or Charm against Arty."""
    shutil.copytree(CONTENT_DIR, root)
    path = root / "starters" / "the-haunting" / "module-graph.json"
    graph = json.loads(path.read_text(encoding="utf-8"))
    access = next(node for node in graph["nodes"] if node["node_id"] == f"requirement-{ACCESS}")
    node_id = f"requirement-{SECOND}"
    graph["nodes"].append({
        "node_id": node_id, "node_kind": "requirement", "name": "The Globe fire archive", "visibility": "keeper-only",
        "aliases": [], "summary": "Arty also keeps the fire-insurance files; a regular Persuade or Charm opens them.",
        "evidence_span_ids": access["evidence_span_ids"], "source_refs": access["source_refs"],
        "properties": {"obligation": {
            "scene": "scene-newspaper-morgue",
            "trigger": {"kind": "attempt", "guards": {"clues": ["clue-globe-fire-cutoff"]}},
            "who": "npc-arty-wilmot",
            "demand": [{"kind": "meet", "npc": "npc-arty-wilmot"},
                       {"kind": "check", "scope": "actor-target", "target": "npc-arty-wilmot", "selection": "approach",
                        "values": [{"path": "skills.Persuade", "label": "Persuade"}, {"path": "skills.Charm", "label": "Charm"}],
                        "difficulty": "regular",
                        "results": {level: {"settles": level not in ("failure", "fumble")}
                                    for level in ("critical", "extreme", "hard", "regular", "failure", "fumble")}}],
            "settles": {"kind": "flag_set", "flag_id": SECOND_FLAG}}}})
    claim_id = f"claim-has-requirement-{SECOND}"
    graph["claims"].append({"claim_id": claim_id, "subject_id": "scene-newspaper-morgue", "predicate": "has-requirement",
                            "object": {"node_id": node_id}, "truth_status": "authored-fact", "visibility": "keeper-only",
                            "evidence_span_ids": access["evidence_span_ids"], "asserted_by_ids": [], "known_by_ids": [],
                            "validity": None, "confidence": 1.0, "reason": "Derived for the §134.17 ambiguity case."})
    graph["relations"].append({"relation_id": f"relation-has-requirement-{SECOND}", "relation_kind": "has-requirement",
                               "from_node_id": "scene-newspaper-morgue", "to_node_id": node_id, "claim_id": claim_id,
                               "properties": {}})
    path.write_text(json.dumps(graph, ensure_ascii=False, indent=2), encoding="utf-8")
    return root


@pytest.fixture
def morgue(tmp_path):
    clients: list[RpcClient] = []

    def open_at(seed: int, *, content: Path | None = None, meet: bool = True) -> RpcClient:
        client = RpcClient(tmp_path / f"s{seed}-{len(clients)}" / "ws", env={"COC_KERNEL_SEED": str(seed)}, content=content)
        clients.append(client)
        client.ok("campaign.create", {"id": CAMPAIGN, "module": "the-haunting", "pregen": "thomas-hayes", "play_language": "en"})
        client.table("narrate", call_id="t0-c1", text="The opening.")
        client.table("player_input", text="我说明来意，请他帮忙调出科比特宅这些年的旧剪报。")
        client.table("apply", call_id="t1-c1", effects=[{"kind": "move", "to": MORGUE}])
        if meet:
            client.table("apply", call_id="t1-c2", effects=[{"kind": "person", "who": "Arty Wilmot", "name": "Arty"}])
        return client
    yield open_at
    for client in clients:
        client.close()


def resolve(client: RpcClient, call_id: str = "t1-c3", *, drop: tuple[str, ...] = (), **changes) -> dict:
    action = {key: value for key, value in {**GATE3, **changes}.items() if key not in drop}
    result = client.call("table.resolve", {"campaign": CAMPAIGN, "call_id": call_id, "action": action})
    assert result["ok"], result.get("error")
    return result["result"]


def world(client: RpcClient) -> dict:
    return read_json(campaign_dir(client.workspace) / "world.json")


def receipt(client: RpcClient, receipt_id: str) -> dict:
    return next(r for r in read_json(campaign_dir(client.workspace) / "turn.json")["receipts"] if r["id"] == receipt_id)


def rows(client: RpcClient) -> dict[str, dict]:
    return {row["handle"]: row for row in client.ok("table.apply.options", {"campaign": CAMPAIGN})["obligations"]}


def events(client: RpcClient) -> list[dict]:
    lines = (campaign_dir(client.workspace) / "events.jsonl").read_text(encoding="utf-8").splitlines()
    return [json.loads(line) for line in lines if line.strip()]


def assert_counted_as_nothing(client: RpcClient, result: dict) -> None:
    assert "obligation" not in result and "obligation_ambiguous" not in result and "note" not in result
    if result.get("receipt"):
        assert "obligation" not in receipt(client, result["receipt"])
    assert FLAG not in world(client).get("flags", {})
    assert rows(client)[ACCESS]["state"] == "open"


# ---- the fold ------------------------------------------------------------------------------------


def test_the_gate3_call_without_the_claim_is_the_attempt_and_a_pass_settles_it(morgue):
    client = morgue(PASS)
    result = resolve(client)
    assert result["decision"] == "core-check:ordinary-check"
    # The ordinary-check outcome, unchanged in shape: the book's regular difficulty, the Keeper's bonus die.
    assert set(result["outcome"]) == ORDINARY_OUTCOME
    assert result["outcome"]["skill"] == "Persuade" and result["outcome"]["difficulty"] == "regular"
    assert result["outcome"]["bonus"] == 1 and result["outcome"]["passed"] is True
    assert result["obligation"] == {"handle": ACCESS, "step": 1, "counted": "folded", "settled": True}
    roll = receipt(client, result["receipt"])
    assert roll["obligation"] == {"handle": ACCESS, "step": 1, "counted": "folded", "settled": True}
    assert roll["modifier_reason"] == GATE3["modifiers"]["reason"]
    # The same call wrote the flag, with its event on the roll receipt; the archivist opens, the guards clear.
    assert world(client)["flags"][FLAG] is True
    flagged = [event for event in events(client) if event.get("type") == "flag-set"]
    assert len(flagged) == 1 and flagged[0]["data"]["name"] == FLAG and flagged[0]["receipt"] == result["receipt"]
    issued = rows(client)
    assert issued[ACCESS]["state"] == "settled" and issued[ARCHIVIST]["state"] == "open"
    # The Keeper's one line says what the roll counted as.
    assert result["note"] == f"This Persuade roll was the attempt at obligation {ACCESS} (demand step 1) and settled it; do not roll it again."


def test_a_folded_failure_records_the_attempt_and_hands_the_book_price(morgue):
    client = morgue(FAIL)
    before = world(client)
    result = resolve(client)
    assert result["outcome"]["level"] == "failure"
    assert result["obligation"] == {"handle": ACCESS, "step": 1, "counted": "folded", "settled": False,
                                    "book": FAILURE_LINE, "push": PUSH_LINE}
    assert receipt(client, result["receipt"])["obligation"] == {"handle": ACCESS, "step": 1, "counted": "folded", "settled": False}
    assert "did not settle it" in result["note"] and "a push" in result["note"]
    # The price is the book's line for the Keeper; the kernel applies no consequence: one roll receipt, nothing else.
    assert result["receipts"] == [result["receipt"]]
    after = world(client)
    assert FLAG not in after.get("flags", {})
    assert after["clock"] == before["clock"] and after["npc_presence"] == before["npc_presence"]
    assert rows(client)[ACCESS]["state"] == "open"


def test_a_push_continues_the_fold(morgue):
    client = morgue(PUSH)
    assert resolve(client)["obligation"]["settled"] is False
    pushed = client.call("table.resolve", {"campaign": CAMPAIGN, "call_id": "t1-c4", "action": {
        "intent": "social", "push": True, "method": "lean on the old newsroom debt", "stakes": PUSH_LINE}})
    assert pushed["ok"], pushed.get("error")
    assert pushed["result"]["outcome"]["passed"] is True
    assert pushed["result"]["obligation"] == {"handle": ACCESS, "step": 1, "counted": "folded", "settled": True}
    assert world(client)["flags"][FLAG] is True


def test_the_book_difficulty_replaces_the_keepers_and_nothing_is_refused(morgue):
    client = morgue(PASS)
    result = resolve(client, modifiers={**GATE3["modifiers"], "difficulty": "hard"})
    assert result["outcome"]["difficulty"] == "regular"
    assert result["obligation"]["counted"] == "folded"


# ---- the explicit claim --------------------------------------------------------------------------


def test_the_explicit_claim_is_unchanged(morgue):
    client = morgue(FAIL)
    result = resolve(client, obligation=ACCESS)
    assert result["obligation"] == {"handle": ACCESS, "settled": False, "book": FAILURE_LINE, "push": PUSH_LINE}
    assert receipt(client, result["receipt"])["obligation"] == {"handle": ACCESS, "settled": False}
    assert "note" not in result
    # ... and still refuses what it refused: the fold never touches it.
    refused = client.call("table.resolve", {"campaign": CAMPAIGN, "call_id": "t1-c4", "action": {
        **GATE3, "obligation": ACCESS, "modifiers": {**GATE3["modifiers"], "difficulty": "hard"}}})
    assert not refused["ok"] and refused["error"]["details"]["reason"] == "obligation_difficulty"


# ---- no fold -------------------------------------------------------------------------------------


def test_no_target_no_fold_even_when_the_words_name_the_person(morgue):
    client = morgue(PASS)
    result = resolve(client, drop=("target",), method="ask Arty Wilmot, the city editor, to open the clippings room",
                     goal="get Arty Wilmot to let me into the clippings")
    assert result["decision"] == "core-check:ordinary-check" and result["outcome"]["passed"] is True
    assert_counted_as_nothing(client, result)


def test_no_skill_no_fold(morgue):
    client = morgue(PASS)
    result = resolve(client, drop=("skill",), decision="core-check:ordinary-check", method="persuade him with the landlord's letter")
    assert result["decision"] == "core-check:ordinary-check"
    assert_counted_as_nothing(client, result)


def test_a_skill_outside_the_approaches_is_no_fold(morgue):
    client = morgue(PASS)
    result = resolve(client, skill="Credit Rating", decision="core-check:ordinary-check")
    assert result["decision"] == "core-check:ordinary-check" and result["outcome"]["skill"] == "Credit Rating"
    assert_counted_as_nothing(client, result)


def test_the_social_adjudication_named_is_no_fold(morgue):
    client = morgue(PASS)
    result = resolve(client, decision="social:adjudicate-difficulty")
    assert result["decision"] == "social:adjudicate-difficulty" and result["outcome"]["kind"] == "social"
    assert_counted_as_nothing(client, result)


def test_before_arty_is_met_the_obligation_is_not_at_its_check(morgue):
    client = morgue(PASS, meet=False)
    result = resolve(client)
    assert result["decision"] == "social:adjudicate-difficulty"
    assert_counted_as_nothing(client, result)
    assert rows(client)[ACCESS]["next"] == {"kind": "meet", "person": "Arty Wilmot"}


# ---- two matches ---------------------------------------------------------------------------------


def test_a_check_that_fits_two_open_obligations_folds_into_none(morgue, tmp_path):
    client = morgue(AMBIGUOUS_PASS, content=second_obligation(tmp_path / "content"))
    issued = rows(client)
    assert issued[ACCESS]["state"] == "open" and issued[SECOND]["state"] == "open"
    # No one obligation binds it, so the social attempt goes to the adjudication as before, counting as nothing ...
    adjudicated = resolve(client)
    assert adjudicated["decision"] == "social:adjudicate-difficulty"
    assert "obligation" not in adjudicated and "obligation_ambiguous" not in adjudicated
    # ... and the ordinary check that follows it settles, claiming nothing, and says why.
    result = resolve(client, "t1-c4", decision="core-check:ordinary-check")
    assert result["decision"] == "core-check:ordinary-check" and result["outcome"]["passed"] is True
    assert result["obligation_ambiguous"] == [ACCESS, SECOND]
    assert "obligation" not in result and "obligation" not in receipt(client, result["receipt"])
    assert ACCESS in result["note"] and SECOND in result["note"] and "action.obligation" in result["note"]
    flags = world(client).get("flags", {})
    assert FLAG not in flags and SECOND_FLAG not in flags
    issued = rows(client)
    assert issued[ACCESS]["state"] == "open" and issued[SECOND]["state"] == "open"
    # The Keeper names one and the claim settles it, exactly as §134.11.
    claimed = resolve(client, "t1-c5", obligation=SECOND, skill="Charm")
    assert claimed["obligation"]["handle"] == SECOND
