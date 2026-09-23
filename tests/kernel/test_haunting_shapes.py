"""RD-04: the haunting states its mechanics as shapes (contract §136.26-§136.28, §52.6).

Every case drives the emitted kernel over RPC on a fresh campaign of the **shipped** haunting -- no derived graph --
walks to the scene the way a table does (one move a turn), and asserts what the kernel returned, which receipts exist
and what the sheet holds. A "forced" level is a recorded seed for exactly that call sequence (the kernel's dice are
seeded, never stubbed); each seed constant says what it forces.
"""
from __future__ import annotations

import pytest

from conftest import CAMPAIGN, CONTENT_DIR, RpcClient, campaign_dir, read_json

CHAPEL = ["chapel-of-contemplation-ruins"]
CONFRONTATION = ["corbitt-house-ground", "basement-rites", "corbitt-confrontation"]
FLOOR = "chapel-floor-collapse"

# Seeds, each recorded for the exact sequence of its test:
LUCK_FAILS_JUMP_FAILS = 1   # rule chapel-floor-collapse: step 0 (Luck) fails, then step 1 (Jump) fails
SAN_FAILS = 1               # sanity:check on Corbitt: the SAN roll fails, so the stated failure half (1D8) is rolled
LATIN_SEED = 0              # the Liber Ivonis read check: any level; the binding is what is asserted


@pytest.fixture
def table(tmp_path):
    clients: list[RpcClient] = []

    def open_at(seed: int, path: list[str], pregen: str = "thomas-hayes") -> tuple[RpcClient, int]:
        client = RpcClient(tmp_path / f"s{seed}-{len(clients)}", env={"COC_KERNEL_SEED": str(seed)}, content=CONTENT_DIR)
        clients.append(client)
        client.ok("campaign.create", {"id": CAMPAIGN, "module": "the-haunting", "pregen": pregen, "play_language": "en"})
        client.table("narrate", call_id="t0-c1", text="The opening.")
        client.table("player_input", text="I set out.")
        for index, scene in enumerate(path):
            if index:
                client.table("narrate", call_id=f"t{index}-c2", text="On we go.")
                client.table("player_input", text=f"I go to {scene}.")
            client.table("apply", call_id=f"t{index + 1}-c1", effects=[{"kind": "move", "to": scene}])
        return client, len(path)
    yield open_at
    for client in clients:
        client.close()


def resolve(client, call_id, **action):
    body = {"intent": "move", "goal": "keep their footing", "method": "careful steps", **action}
    return client.call("table.resolve", {"campaign": CAMPAIGN, "call_id": call_id, "action": body})


def apply(client, call_id, *effects):
    return client.call("table.apply", {"campaign": CAMPAIGN, "call_id": call_id, "effects": list(effects)})


def ok(response):
    assert response["ok"], response.get("error")
    return response["result"]


def refusal(response):
    assert not response["ok"], response.get("result")
    return response["error"]["code"], response["error"]["details"].get("reason")


def receipts(client):
    return read_json(campaign_dir(client.workspace) / "turn.json")["receipts"]


def sheet(client, pregen="thomas-hayes"):
    return read_json(campaign_dir(client.workspace) / "party" / f"{pregen}.json")


# ---- the chapel: the mech line, the hazard's steps, the stated damage ---------------------------------------------

CHAPEL_MECH = ("hazard (Keeper triggers): [0] Luck difficulty unstated, on failure step 1, on fumble step 1; "
               "[1] Jump difficulty unstated, on failure damage 1D6, on fumble damage 1D6, push allowed")


def test_the_chapel_row_carries_its_mech_line(table):
    client, turn = table(0, CHAPEL)
    look = client.table("look", focus="scene")
    row = next(r for r in look["where"]["rules"] if r["name"] == "The chapel's weakened floor")
    assert row["mech"] == CHAPEL_MECH
    client.table("narrate", call_id=f"t{turn}-c2", text="The ruins.")
    capsule = client.table("player_input", text="I look around the ruins.")["capsule"]
    compact = next(r for r in capsule["where"]["rules"] if r["name"] == "The chapel's weakened floor")
    assert compact["mech"] == CHAPEL_MECH[:160] and compact["mech_truncated"] is True


def test_the_chapel_hazard_binds_luck_then_jump_to_the_books_1d6(table):
    client, turn = table(LUCK_FAILS_JUMP_FAILS, CHAPEL)
    hp = sheet(client)["current_hp"]
    luck = ok(resolve(client, f"t{turn}-c2", rule=FLOOR))
    assert luck["decision"] == "push-luck:luck-roll"
    assert luck["stated"] == {"rule": FLOOR, "step": 0, "level": "failure", "effects": [], "next_step": 1}
    jump = ok(resolve(client, f"t{turn}-c3", rule=FLOOR, step=1))
    assert jump["decision"] == "core-check:ordinary-check" and jump["outcome"]["skill"] == "Jump"
    assert jump["stated"]["step"] == 1 and jump["stated"]["level"] == "failure"
    assert jump["stated"]["effects"] == [{"kind": "damage", "dice": "1D6"}]
    assert jump["stated"]["push"] == {"allowed": True, "book": "A failed pushed Jump loses or breaks a personal possession."}
    # Two rolls and nothing else: the stated damage is not applied by being read (owner ruling Q1).
    rows = [r for r in receipts(client) if r.get("basis")]
    assert [r["kind"] for r in rows] == ["roll", "roll"]
    assert [r["basis"] for r in rows] == [{"rule": FLOOR, "step": 0, "level": "failure"}, {"rule": FLOOR, "step": 1, "level": "failure"}]
    assert sheet(client)["current_hp"] == hp
    # The Keeper names it; the kernel rolls the book's 1D6.
    conflict = apply(client, f"t{turn}-c4", {"kind": "damage", "stated": FLOOR, "dice": "2D6"})
    assert refusal(conflict) == ("invalid_params", "stated_conflict")
    landed = ok(apply(client, f"t{turn}-c5", {"kind": "damage", "stated": FLOOR, "why": "the floor gives way"}))
    by_id = {r["id"]: r for r in receipts(client)}
    minted = [by_id[receipt] for receipt in landed["receipts"]]
    dice = next(r for r in minted if r["kind"] == "roll")
    assert dice["expression"] == "1D6" and 1 <= dice["total"] <= 6
    assert all(r["basis"] == "stated" and r["stated"] == FLOOR for r in minted)
    assert sheet(client)["current_hp"] == hp - dice["total"]


# ---- Corbitt's typed Sanity loss ----------------------------------------------------------------------------------


def test_sanity_check_on_corbitt_rolls_the_typed_1_1d8(table):
    client, turn = table(SAN_FAILS, CONFRONTATION)
    result = ok(resolve(client, f"t{turn}-c2", intent="investigate", goal="the corpse moves", method="looks at it",
                        decision="sanity:check", target="Walter Corbitt", involuntary="flee"))
    assert result["decision"] == "sanity:check"
    outcome = result["outcome"]
    # No action.san_loss: the book's pair comes from npc-walter-corbitt's profile.sanity_loss (§136.13), not a regex.
    assert outcome["passed"] is False and 1 <= outcome["san_loss"] <= 8
    rolled = next(r for r in receipts(client) if r["id"] == f"roll:san-loss-t{turn}-c2")
    assert rolled["expression"] == "1D8" and rolled["total"] == outcome["san_loss"]


# ---- the ending's stated reward -----------------------------------------------------------------------------------


def end_session(client, call_id, **extra):
    return resolve(client, call_id, intent="montage", goal="Corbitt crumbles to dust.", method="",
                   decision="development:end-session", **extra)


def test_end_session_without_an_expression_takes_the_books_1d6(table):
    client, turn = table(0, CONFRONTATION)
    result = ok(end_session(client, f"t{turn}-c2"))
    assert result["stated"] == {"rule": "victory-rewards", "scenario_san_reward_expr": "1D6"}
    # The book's 1D6 is what the development settlement rolled for the scenario reward.
    rolled = result["outcome"]["scenario_san_reward_roll"]
    assert rolled["expression"] == "1D6" and 1 <= rolled["total"] <= 6
    san = [r for r in receipts(client) if r["kind"] == "delta" and r["resource"] == "san"]
    assert san and all(r["basis"] == {"rule": "victory-rewards"} for r in san)


def test_another_ending_kind_binds_nothing(table):
    client, turn = table(0, CONFRONTATION)
    result = ok(end_session(client, f"t{turn}-c2", ending="retreat"))
    assert "stated" not in result and result["outcome"]["scenario_san_reward_roll"] is None
    assert not any(r.get("basis") for r in receipts(client))


# ---- the Liber Ivonis read check (§52.6) --------------------------------------------------------------------------


def test_the_liber_ivonis_read_check_binds_the_cards_latin(table):
    client, turn = table(LATIN_SEED, CHAPEL, pregen="eleanor-reed")
    assert sheet(client, "eleanor-reed")["skills"]["Language (Latin)"] == 40
    read = ok(resolve(client, f"t{turn}-c2", rule="liber-ivonis", intent="investigate", goal="read the tome", method="careful reading"))
    assert read["decision"] == "core-check:ordinary-check"
    # The stated Language (Other: Latin) settles on her card's Language (Latin) row at 40; the tome's 50 is the
    # book's no-roll line, not a minimum, so a reader at 40 rolls.
    assert read["outcome"]["skill"] == "Language (Latin)" and read["outcome"]["target"] == 40
    assert read["stated"]["rule"] == "liber-ivonis"
    assert next(r for r in receipts(client) if r.get("basis"))["basis"]["rule"] == "liber-ivonis"


def test_a_nested_member_reaches_the_card_only_through_a_group_key(table):
    client, turn = table(LATIN_SEED, CHAPEL, pregen="eleanor-reed")
    both = [ok(resolve(client, f"t{turn}-c{n}", intent="investigate", goal="read the tome", method="careful reading", skill=skill))
            for n, skill in [(2, "Language (Other: Latin)"), (3, "Language (Other) (Latin)")]]
    assert [r["outcome"]["skill"] for r in both] == ["Language (Latin)", "Language (Latin)"]
    assert [r["outcome"]["target"] for r in both] == [40, 40]
    # A phrase whose group part is no group key of the ruleset is not read this way.
    lore = resolve(client, f"t{turn}-c4", intent="investigate", goal="read the tome", method="careful reading", skill="Lore (Other: Latin)")
    assert not lore["ok"] and lore["error"]["code"] == "needs"
