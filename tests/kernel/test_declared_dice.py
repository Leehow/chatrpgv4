"""The keeper's declared bonus and penalty dice reach the dice, or the call is refused (§NN).

Nine real tables and 280 roll receipts produced exactly one bonus die, and that one came from the
engine (the target was prone), never from the keeper.  `action.modifiers.bonus_dice` was validated
at the entry of `table.resolve` and then dropped without a word by every decision but the ordinary
check: a fight, a contest and a combined check all rolled plain while the call reported success.

Every assertion here reads the roll receipt, which is where the dice actually are: `bonus` counts
what the arithmetic used, and `tens_values` holds the faces it rolled, so a test cannot pass by
echoing a number back.  A plain d100 rolls one tens die and records none.
"""

from conftest import narrate, open_turn
from test_rules_families import resolve, resolve_err, walk_to_confrontation

INVESTIGATOR = "thomas-hayes"
CORBITT = "walter-corbitt"


def receipts(client):
    return {receipt["id"]: receipt for receipt in client.table("status")["receipts"]}


def roll_of(client, receipt_id):
    return receipts(client)[receipt_id]


def rolled_extra_tens(record):
    """The arithmetic rolled more than one tens die, and kept the faces.

    A basic check keeps them under the receipt's `check`; a session engine's receipt carries them
    at the top, because the engine owns the record the receipt projects.  Pass whichever holds them.
    """
    return len(record.get("tens_values") or []) >= 2


# ---- the ordinary check: the one path that already worked, pinned so it cannot regress -------

def test_an_ordinary_check_rolls_the_declared_bonus_die(seeded_kernel):
    open_turn(seeded_kernel)
    result = resolve(seeded_kernel, "t1-c1", intent="investigate", goal="听墙角", method="用聆听贴门",
                     modifiers={"bonus_dice": 1})
    assert result["outcome"]["bonus"] == 1
    receipt = roll_of(seeded_kernel, result["receipt"])
    assert receipt["bonus"] == 1 and rolled_extra_tens(receipt["check"])


# ---- combat: the fight the player actually lost ----------------------------------------------

def test_a_declared_bonus_die_reaches_an_unresisted_attack(seeded_kernel):
    """One call: attack with `defense: none`.  The dice are the attacker's -- the target who does
    not resist rolls nothing at all, so a declaration read as the defender's would vanish."""
    open_turn(seeded_kernel, "我举枪对准棺材里的东西。")
    n = walk_to_confrontation(seeded_kernel)
    result = resolve(seeded_kernel, f"t1-c{n}", intent="combat", goal="朝科比特开枪", method="用左轮射击",
                     target="Walter Corbitt", weapon=".38 Revolver", defense="none",
                     modifiers={"bonus_dice": 1})
    attack = next(r for r in receipts(seeded_kernel).values()
                  if r.get("kind") == "roll" and r.get("actor") == INVESTIGATOR)
    assert attack["skill"] == "Firearms (Handgun)" and result["outcome"]["kind"] == "combat"
    assert attack["bonus"] == 1 and attack["penalty"] == 0
    assert rolled_extra_tens(attack)


def test_the_attackers_dice_survive_the_wait_for_a_defense(seeded_kernel):
    """An attack is declared on one call and rolled on the next, when the defence answers it.  The
    declaration has to ride on the pending attack across that gap, and the dice declared on the
    defence call belong to the defender, not to the attack that is finally being rolled."""
    open_turn(seeded_kernel, "我举枪对准棺材里的东西。")
    n = walk_to_confrontation(seeded_kernel)
    resolve(seeded_kernel, f"t1-c{n}", intent="combat", goal="朝科比特开枪", method="用左轮射击",
            target="Walter Corbitt", weapon=".38 Revolver", modifiers={"bonus_dice": 2})
    defend = resolve(seeded_kernel, f"t1-c{n + 1}", intent="combat", goal="他往旁边扑", method="",
                     actor="Walter Corbitt", defense="dodge", modifiers={"penalty_dice": 1})
    settled = receipts(seeded_kernel)
    attack = next(r for r in settled.values() if r.get("call_id") == f"t1-c{n + 1}"
                  and r.get("actor") == INVESTIGATOR and r.get("kind") == "roll")
    defense = next(r for r in settled.values() if r.get("call_id") == f"t1-c{n + 1}"
                   and r.get("actor") == CORBITT and r.get("kind") == "roll")
    assert attack["bonus"] == 2 and attack["penalty"] == 0, "the attacker's declaration crossed the two calls"
    assert defense["penalty"] == 1 and defense["bonus"] == 0, "the defence call's dice are the defender's"
    assert rolled_extra_tens(attack) and rolled_extra_tens(defense)
    assert defend["decision"] == "combat:defend"


# ---- the contest and the combined check -------------------------------------------------------

def test_an_opposed_check_gives_the_declared_dice_to_the_investigator_only(seeded_kernel):
    open_turn(seeded_kernel, "我和科比特掰手腕。")
    n = walk_to_confrontation(seeded_kernel)
    result = resolve(seeded_kernel, f"t1-c{n}", intent="investigate", goal="把他压制住", method="用力量硬顶",
                     target="Walter Corbitt", decision="core-check:opposed-check",
                     modifiers={"bonus_dice": 1})
    settled = receipts(seeded_kernel)
    mine = next(r for r in settled.values() if r.get("opposed_side") == "investigator")
    theirs = next(r for r in settled.values() if r.get("opposed_side") == "opponent")
    assert mine["bonus"] == 1 and rolled_extra_tens(mine["check"])
    assert theirs["bonus"] == 0 and not rolled_extra_tens(theirs["check"])
    assert result["outcome"]["kind"] == "opposed"


def test_a_combined_check_rolls_the_declared_bonus_die(seeded_kernel):
    open_turn(seeded_kernel)
    result = resolve(seeded_kernel, "t1-c1", intent="investigate", goal="找出暗门", method="同时看和听",
                     decision="core-check:combined-check", skills=["Spot Hidden", "Listen"], mode="any",
                     modifiers={"bonus_dice": 1})
    receipt = roll_of(seeded_kernel, result["receipts"][0])
    assert receipt["bonus"] == 1 and rolled_extra_tens(receipt["check"])


# ---- and where it cannot be carried, the call is refused by name -------------------------------

def test_a_decision_that_cannot_carry_the_dice_refuses_instead_of_dropping_them(seeded_kernel):
    open_turn(seeded_kernel, "我去报社。")
    seeded_kernel.table("apply", call_id="t1-c1", effects=[{"kind": "move", "to": "newspaper-morgue"}])
    error = resolve_err(seeded_kernel, "t1-c2", intent="social", goal="让阿蒂放我们进剪报室",
                        method="用说服跟他讲道理", target="Arty Wilmot", modifiers={"bonus_dice": 1})
    assert error["code"] == "invalid_params"
    assert error["details"]["decision"] == "social:adjudicate-difficulty"
    assert error["details"]["declared"] == {"bonus_dice": 1, "penalty_dice": 0}
    # The same action without the declaration settles: the refusal names the field, not the action.
    assert resolve(seeded_kernel, "t1-c2", intent="social", goal="让阿蒂放我们进剪报室",
                   method="用说服跟他讲道理", target="Arty Wilmot")["decision"] == "social:adjudicate-difficulty"


# ---- and the card the player reads says a die was added ---------------------------------------

def test_the_mechanics_card_reports_the_dice(seeded_kernel):
    open_turn(seeded_kernel)
    resolve(seeded_kernel, "t1-c1", intent="investigate", goal="听墙角", method="用聆听贴门",
            modifiers={"bonus_dice": 1})
    rows = narrate(seeded_kernel, "t1-c2", "你贴着门板，屏住呼吸。")["mechanics"]
    row = next(row for row in rows if row["kind"] == "roll")
    assert row["bonus"] == 1 and row["penalty"] == 0
