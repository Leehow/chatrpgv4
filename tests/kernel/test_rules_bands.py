"""BR-04: `rules.bands` -- the rows of a band table the kernel rolls from, read for the host's shadow questions (contract §138.8).

Every case drives the emitted kernel over RPC and compares with the shipped rules-json: the rows come back in the table's
order, in the shape `bandRows` rolls from, with no campaign at all; a field the kernel does not roll from is refused
with the ones it does; a malformed row fails loudly exactly as it does for `apply ... {band}` (§138.2).
"""
from __future__ import annotations

import json
import shutil
from pathlib import Path

import pytest

from conftest import CONTENT_DIR, RpcClient

RULES_JSON = CONTENT_DIR / "rulesets" / "coc7" / "rules-json"


@pytest.fixture
def kernel(tmp_path):
    clients: list[RpcClient] = []

    def open_on(content: Path | None = None) -> RpcClient:
        client = RpcClient(tmp_path / f"w{len(clients)}", content=content)
        clients.append(client)
        return client
    yield open_on
    for client in clients:
        client.close()


def shipped(table: str, block: str) -> dict:
    return json.loads((RULES_JSON / f"{table}.json").read_text(encoding="utf-8"))[block]


def test_time_rows_are_the_time_cost_categories_in_the_table_order_with_their_ranges(kernel):
    result = kernel().ok("rules.bands", {"field": "time.band"})
    categories = shipped("time-costs", "categories")
    assert result["field"] == "time.band"
    assert result["table"] == "time-costs"
    assert result["rows"] == [{"handle": handle, "min": row["min"], "max": row["max"], "default": row["default"]}
                              for handle, row in categories.items()]
    # The two road rows are the table's; leaving them out of a per-turn question is the host's decision, not the read's.
    assert {"local_travel", "long_travel"} <= {row["handle"] for row in result["rows"]}


def test_damage_rows_are_the_severity_ladder_in_order_with_their_dice_and_notes(kernel):
    result = kernel().ok("rules.bands", {"field": "damage.band"})
    severity = shipped("hazards", "severity")
    assert result["table"] == "hazards"
    assert result["rows"] == [{"handle": handle, "dice": row["damage_expr"].strip().upper(), "note": row["note"]}
                              for handle, row in severity.items()]
    assert [row["handle"] for row in result["rows"]][:2] == ["minor", "moderate"]


@pytest.mark.parametrize("params", [{"field": "npc.archetype"}, {"field": "cash.band"}, {}])
def test_a_field_the_kernel_does_not_roll_from_is_refused_with_the_ones_it_does(kernel, params):
    error = kernel().err("rules.bands", params)
    assert error["code"] == "invalid_params"
    assert error["details"] == {"field": "field", "options": ["time.band", "damage.band"]}
    assert "details.options" in error["fix"]


def test_a_malformed_row_fails_loudly_naming_the_table_and_the_row(kernel, tmp_path):
    content = tmp_path / "content"
    shutil.copytree(CONTENT_DIR, content)
    path = content / "rulesets" / "coc7" / "rules-json" / "time-costs.json"
    table = json.loads(path.read_text(encoding="utf-8"))
    table["categories"]["first_aid"] = {"min": 40, "default": 15, "max": 30}
    path.write_text(json.dumps(table, ensure_ascii=False, indent=2), encoding="utf-8")
    error = kernel(content).err("rules.bands", {"field": "time.band"})
    assert error["code"] == "campaign_not_ready"
    assert error["details"] == {"table": "time-costs", "row": "first_aid"}
