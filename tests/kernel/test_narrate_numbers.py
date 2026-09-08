"""§16.3 step 2: the delivery must state the figures its public receipts settled (#84).

The check was specified, its materials (`render.expected_numbers`) were written, and its
error code (`errors` → `mechanics_missing`) was reserved — and nothing ever called any of
it, so a keeper could narrate "HP 3" over a receipt that took 7 and the kernel took it.
That is table defect #64, the worst one the real playtest found: the player cannot read the
number that killed them.

**These tests must not use `conftest.narrate`.** That helper runs `stating()`, which appends
the owed digits to the keeper's text — its own docstring says it is "for tests whose subject
is not the number check itself". Every test in the suite goes through it, which is precisely
why eight thousand green tests could not see that the check was missing. The subject here is
the check itself, so every call below goes to `client.table("narrate", ...)` directly.
"""

import pytest
from conftest import CAMPAIGN, campaign_dir, open_turn, read_json  # noqa: F401


def hurt(client, call_id="t1-c1", points=7):
    """A blow of exactly `points` — mints a public `roll` (the dice) and a `delta:hp`."""
    return client.table("apply", call_id=call_id,
                        effects=[{"kind": "damage", "dice": f"1D1+{points - 1}", "why": "梁塌了"}])


def owed_figures(client):
    from coc.render import expected_numbers
    return [n for r in client.table("status")["receipts"] for n in expected_numbers(r)]


def test_a_delivery_that_states_none_of_its_figures_is_refused(kernel):
    open_turn(kernel)
    hurt(kernel)
    figures = owed_figures(kernel)
    assert figures, "the damage should oblige the keeper to state something"

    error = kernel.call("table.narrate", {"campaign": CAMPAIGN, "call_id": "t1-c2",
                                          "text": "梁塌下来，他倒在瓦砾里，喘不上气。"})["error"]
    assert error["code"] == "invalid_params"
    assert error["code_detail"] == "mechanics_missing"
    owed = [n for row in error["details"]["missing"] for n in row["expected"]]
    assert set(owed) == set(figures)
    assert all(row["receipt"] for row in error["details"]["missing"])


def test_a_delivery_that_states_the_wrong_number_is_refused(kernel):
    """#64's actual shape: the prose says one number, the receipt settled another."""
    open_turn(kernel)
    hurt(kernel, points=7)

    # Every figure but the damage total, which is misreported as 3.
    figures = [n for n in owed_figures(kernel) if n != "7"]
    text = "梁塌下来。他掉了 3 点生命。" + " ".join(figures)
    error = kernel.call("table.narrate", {"campaign": CAMPAIGN, "call_id": "t1-c2", "text": text})["error"]
    assert error["code_detail"] == "mechanics_missing"
    assert "7" in [n for row in error["details"]["missing"] for n in row["expected"]]
    # The blow itself already landed — `apply` settled it, and a refused delivery does not
    # undo a settlement. What must not happen is the turn closing on a delivery that lies.
    assert kernel.table("status")["state"] != "closed"


def test_a_delivery_that_states_every_figure_goes_through(kernel):
    open_turn(kernel)
    hurt(kernel)
    text = "梁塌下来，他倒在瓦砾里。" + " ".join(owed_figures(kernel))
    result = kernel.table("narrate", call_id="t1-c2", text=text)
    assert result["turn"] == 1


def test_keeper_only_receipts_oblige_nothing(kernel):
    """§16.3 checks public receipts. A delivery owes nothing for a hidden one, and a turn
    with no public receipt at all is free prose."""
    open_turn(kernel)
    assert owed_figures(kernel) == []
    result = kernel.table("narrate", call_id="t1-c1", text="他把烟按进托盘，没有回答。")
    assert result["turn"] == 1
