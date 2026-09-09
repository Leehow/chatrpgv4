"""§16.3: the delivery owes no figure. Numbers live on the frontend's cards, not in the prose.

The kernel checked for a public receipt's numbers in the keeper's text on 2026-09-06, stopped
on 09-07 (user correction), started again on 09-08 (#84, justified by defect #64 -- which
predates the check: it came out of the first v2 attempt's playtest, archived on 09-05) and
stopped for good on 09-09 by the user's decision. What the check produced at a real table
was every dice card doubled by a "rolled 25 against 53 ... 15 minutes" sentence under it,
because the extension's steer told the Keeper to write exactly that. A time receipt's
minutes are included in the ban: the clock is the panel's.

These tests call `table.narrate` directly, without `conftest.narrate`, so that no helper
stands between the keeper text and the kernel.
"""

from conftest import CAMPAIGN, open_turn


def hurt(client, call_id="t1-c1", points=7):
    """A blow of exactly `points` -- mints a public `roll` (the dice) and a `delta:hp`."""
    return client.table("apply", call_id=call_id,
                        effects=[{"kind": "damage", "dice": f"1D1+{points - 1}", "why": "梁塌了"}])


def public_figures(client):
    """Every number a public receipt of the open turn carries, as the projection prints them."""
    figures = set()
    for receipt in client.table("status")["receipts"]:
        if receipt.get("visibility") == "keeper":
            continue
        for key in ("roll", "target", "total", "before", "after", "minutes"):
            if isinstance(receipt.get(key), (int, float)):
                figures.add(str(int(receipt[key])))
    return figures


def test_a_delivery_that_states_none_of_its_figures_goes_through(kernel):
    open_turn(kernel)
    hurt(kernel)
    kernel.table("apply", call_id="t1-c2", effects=[{"kind": "time", "minutes": 15}])
    figures = public_figures(kernel)
    assert figures, "the damage and the quarter hour should have put numbers on the receipts"

    text = "梁塌下来，他倒在瓦砾里，喘不上气。"
    assert not any(figure in text for figure in figures)
    result = kernel.table("narrate", call_id="t1-c3", text=text)
    assert result["rendered_text"] == text
    assert result["turn"] == 1 and result["commit"]
    # The numbers are still the player's to read -- on the projection, one row per receipt.
    kinds = [row["kind"] for row in result["mechanics"]]
    assert "dice" in kinds and "change" in kinds and "time" in kinds
    assert next(row for row in result["mechanics"] if row["kind"] == "time")["minutes"] == 15


def test_no_error_code_asks_for_figures_in_the_prose(kernel):
    """The retired refusal must not come back under any name: a bare delivery over public
    receipts is not `invalid_params`, and the record carries the text verbatim."""
    open_turn(kernel)
    hurt(kernel)
    result = kernel.table("narrate", call_id="t1-c2", text="他倒下了。")
    assert "error" not in result
    assert kernel.table("status")["turn"] == 2


def test_keeper_only_receipts_still_oblige_nothing(kernel):
    open_turn(kernel)
    assert public_figures(kernel) == set()
    result = kernel.table("narrate", call_id="t1-c1", text="他把烟按进托盘，没有回答。")
    assert result["turn"] == 1
