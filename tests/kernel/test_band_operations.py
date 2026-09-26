"""BR-01: `apply time|damage … {band}` -- a rules row named instead of a number, rolled by the kernel (contract §138).

Every case drives the emitted kernel over RPC on a derived haunting (the shipped graph plus one stated rule, for the
conflict beside `stated`), and asserts what the kernel returned, which receipts exist with which basis, and what the
clock and the sheet hold -- never private state. The kernel's dice are seeded, never stubbed: the same seed and the
same call sequence must give the same roll.
"""
from __future__ import annotations

import json
import shutil
from pathlib import Path

import pytest

from conftest import CAMPAIGN, CONTENT_DIR, RpcClient, campaign_dir, read_json

SOURCE = {"source_id": "pdf:call-of-cthulhu-keeper-rulebook-40th-the-haunting", "pdf_index": 452}
SPAN = "span-page-447-anchor-1"
START = "scene-commission-briefing"
RULES_JSON = CONTENT_DIR / "rulesets" / "coc7" / "rules-json"


def derived_content(root: Path) -> Path:
    """The shipped content with one stated time cost linked from the opening scene (§136.22's shape)."""
    shutil.copytree(CONTENT_DIR, root)
    path = root / "starters" / "the-haunting" / "module-graph.json"
    graph = json.loads(path.read_text(encoding="utf-8"))
    graph["nodes"].append({"node_id": "rule-long-search", "node_kind": "rule", "name": "long-search", "visibility": "keeper-only",
                           "aliases": [], "summary": "long-search.", "evidence_span_ids": [SPAN],
                           "properties": {"mechanics": {"time_cost": {"amount": 4, "unit": "hour"}}}, "source_refs": [SOURCE]})
    graph["relations"].append({"relation_id": "relation-br01-0", "relation_kind": "uses-rule",
                               "from_node_id": START, "to_node_id": "rule-long-search", "properties": {}})
    path.write_text(json.dumps(graph, ensure_ascii=False), encoding="utf-8")
    return root


@pytest.fixture(scope="module")
def content(tmp_path_factory):
    return derived_content(tmp_path_factory.mktemp("br01") / "content")


@pytest.fixture
def table(tmp_path, content):
    clients: list[RpcClient] = []

    def open_at(seed: int) -> RpcClient:
        client = RpcClient(tmp_path / f"s{seed}-{len(clients)}", env={"COC_KERNEL_SEED": str(seed)}, content=content)
        clients.append(client)
        client.ok("campaign.create", {"id": CAMPAIGN, "module": "the-haunting", "pregen": "thomas-hayes", "play_language": "en"})
        client.table("narrate", call_id="t0-c1", text="The opening.")
        client.table("player_input", text="I look around the office.")
        return client
    yield open_at
    for client in clients:
        client.close()


def apply(client, call_id, *effects):
    return client.call("table.apply", {"campaign": CAMPAIGN, "call_id": call_id, "effects": list(effects)})


def ok(response):
    assert response["ok"], response.get("error")
    return response["result"]


def refusal(response):
    assert not response["ok"], response.get("result")
    error = response["error"]
    assert error["details"]["field"] == "band"
    return error["code"], error["details"]["reason"]


def receipts(client):
    return read_json(campaign_dir(client.workspace) / "turn.json")["receipts"]


def sheet(client):
    return read_json(campaign_dir(client.workspace) / "party" / "thomas-hayes.json")


def clock(client):
    return read_json(campaign_dir(client.workspace) / "world.json")["clock"]["minutes"]


def rows_of(table_name: str, block: str) -> dict:
    return json.loads((RULES_JSON / f"{table_name}.json").read_text(encoding="utf-8"))[block]


TIME_ROWS = rows_of("time-costs", "categories")
SEVERITY = rows_of("hazards", "severity")

# Seeds, each recorded for the exact sequence of its test (open, narrate, one player input, one banded time):
LIBRARY_S11 = 242   # library_research (60-480) under seed 11: neither the row's min, its default (180) nor its max
LIBRARY_S12 = 363   # the same call under seed 12: a different roll, so a constant would be caught


# ---- the number is rolled inside the row, and the receipt says so -------------------------------------------------


def test_a_banded_time_lands_inside_the_category_and_the_same_seed_rolls_the_same_minutes(table):
    totals = []
    for client in (table(11), table(11)):
        before = clock(client)
        landed = ok(apply(client, "t1-c1", {"kind": "time", "band": "single_room_search", "why": "the desk drawers"}))
        row = {r["id"]: r for r in receipts(client)}[landed["receipts"][0]]
        assert row["kind"] == "time" and row["basis"] == "banded" and row["band"] == "single_room_search"
        assert "stated" not in row
        low, high = TIME_ROWS["single_room_search"]["min"], TIME_ROWS["single_room_search"]["max"]
        assert row["band_roll"] == {"min": low, "max": high, "total": row["minutes"]}
        assert low <= row["minutes"] <= high
        assert clock(client) == before + row["minutes"]
        totals.append(row["minutes"])
    assert totals[0] == totals[1]


def test_the_roll_is_the_seeded_dice_and_not_a_fixed_figure_of_the_row(table):
    rolled = {}
    for seed in (11, 12):
        client = table(seed)
        landed = ok(apply(client, "t1-c1", {"kind": "time", "band": "library_research"}))
        rolled[seed] = {r["id"]: r for r in receipts(client)}[landed["receipts"][0]]["band_roll"]["total"]
    row = TIME_ROWS["library_research"]
    assert rolled == {11: LIBRARY_S11, 12: LIBRARY_S12}
    assert not {row["min"], row["default"], row["max"]} & set(rolled.values())


def test_a_banded_damage_rolls_the_rungs_dice_and_both_receipts_carry_the_band(table):
    client = table(11)
    hp = sheet(client)["current_hp"]
    landed = ok(apply(client, "t1-c1", {"kind": "damage", "band": "moderate", "why": "the stair gives"}))
    rows = {r["id"]: r for r in receipts(client)}
    minted = [rows[receipt] for receipt in landed["receipts"]]
    assert {row["kind"] for row in minted} >= {"roll", "delta"}
    dice = next(row for row in minted if row["kind"] == "roll")
    assert dice["expression"] == SEVERITY["moderate"]["damage_expr"] and 1 <= dice["total"] <= 6
    assert all(row["basis"] == "banded" and row["band"] == "moderate" and "stated" not in row for row in minted)
    assert sheet(client)["current_hp"] == hp - dice["total"]


def test_the_keepers_own_amount_still_lands_as_keeper(table):
    client = table(11)
    landed = ok(apply(client, "t1-c1", {"kind": "time", "minutes": 25}))
    row = {r["id"]: r for r in receipts(client)}[landed["receipts"][0]]
    assert row["basis"] == "keeper" and "band" not in row and "band_roll" not in row


# ---- refusals write nothing -----------------------------------------------------------------------------------------


def test_band_beside_the_amount_it_fills_is_a_conflict_and_nothing_is_written(table):
    client = table(11)
    before, count = clock(client), len(receipts(client))
    conflict = apply(client, "t1-c1", {"kind": "time", "band": "single_room_search", "minutes": 5})
    assert refusal(conflict) == ("invalid_params", "band_conflict")
    assert conflict["error"]["details"]["fields"] == ["minutes"]
    assert conflict["error"]["details"]["index"] == 0
    hp = sheet(client)["current_hp"]
    conflict = apply(client, "t1-c2", {"kind": "damage", "band": "minor", "dice": "1D6"})
    assert refusal(conflict) == ("invalid_params", "band_conflict")
    assert conflict["error"]["details"]["fields"] == ["dice"]
    assert clock(client) == before and len(receipts(client)) == count and sheet(client)["current_hp"] == hp


def test_band_beside_stated_is_a_conflict_that_names_the_book(table):
    client = table(11)
    conflict = apply(client, "t1-c1", {"kind": "time", "band": "single_room_search", "stated": "long-search"})
    assert refusal(conflict) == ("invalid_params", "band_conflict")
    assert conflict["error"]["details"]["fields"] == ["stated"]
    assert conflict["error"]["details"]["stated"] == "long-search"
    assert "stated" in conflict["error"]["fix"] and "band" in conflict["error"]["fix"]
    # The book's amount alone lands as the book's, untouched by this section.
    landed = ok(apply(client, "t1-c2", {"kind": "time", "stated": "long-search"}))
    row = {r["id"]: r for r in receipts(client)}[landed["receipts"][0]]
    assert row["basis"] == "stated" and row["minutes"] == 240 and "band" not in row


def test_a_wrong_handle_is_unknown_and_lists_the_rows(table):
    client = table(11)
    wrong = apply(client, "t1-c1", {"kind": "time", "band": "a-long-while"})
    assert refusal(wrong) == ("unknown_entity", "band_unknown")
    details = wrong["error"]["details"]
    assert details["table"] == "time-costs"
    assert [row["handle"] for row in details["options"]] == list(TIME_ROWS)
    assert all(row["min"] == TIME_ROWS[row["handle"]]["min"] and row["max"] == TIME_ROWS[row["handle"]]["max"] for row in details["options"])
    assert "details.options" in wrong["error"]["fix"]
    wrong = apply(client, "t1-c2", {"kind": "damage", "band": "ouch"})
    assert refusal(wrong) == ("unknown_entity", "band_unknown")
    assert [row["handle"] for row in wrong["error"]["details"]["options"]] == list(SEVERITY)
    assert all(row["dice"] == SEVERITY[row["handle"]]["damage_expr"].upper() for row in wrong["error"]["details"]["options"])
    assert receipts(client) == []


def test_band_on_a_kind_the_registry_does_not_bind_is_band_none(table):
    client = table(11)
    none = apply(client, "t1-c1", {"kind": "cash", "band": "single_room_search", "delta": 5, "source": "found"})
    assert refusal(none) == ("invalid_params", "band_none")
    assert "time" in none["error"]["fix"] and "damage" in none["error"]["fix"]
    assert receipts(client) == []


# ---- the roll is the transaction's --------------------------------------------------------------------------------


def test_a_replayed_banded_call_returns_the_journaled_total_and_rolls_nothing_again(table):
    client = table(11)
    first = ok(apply(client, "t1-c1", {"kind": "time", "band": "library_research"}))
    total = {r["id"]: r for r in receipts(client)}[first["receipts"][0]]["minutes"]
    after = clock(client)
    again = ok(apply(client, "t1-c1", {"kind": "time", "band": "library_research"}))
    assert again["replayed"] is True and again["receipts"] == first["receipts"]
    assert clock(client) == after
    assert {r["id"]: r for r in receipts(client)}[first["receipts"][0]]["minutes"] == total


def test_a_banded_night_returns_the_hit_point_a_banded_scratch_took(table):
    client = table(11)
    hp = sheet(client)["current_hp"]
    hurt = ok(apply(client, "t1-c1", {"kind": "damage", "band": "minor"}))
    dice = next(r for r in receipts(client) if r["id"] in hurt["receipts"] and r["kind"] == "roll")
    assert 1 <= dice["total"] <= 3 and dice["total"] < (sheet(client)["derived"]["HP"] + 1) // 2
    assert sheet(client)["current_hp"] == hp - dice["total"]
    night = ok(apply(client, "t1-c2", {"kind": "time", "band": "sleep_night"}))
    minutes = {r["id"]: r for r in receipts(client)}[night["receipts"][0]]["minutes"]
    assert minutes >= 360
    assert [row for row in night["recovered"] if row["resource"] == "hp"] == [
        {"investigator": "thomas-hayes", "resource": "hp", "before": hp - dice["total"], "after": hp - dice["total"] + 1}]
