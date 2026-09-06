"""§21 (#31): the investigator library through the RPC seam -- save, load byte for byte,
an era mismatch that changes nothing, the per-turn write-back that never fails a turn,
and library ids the kernel mints."""

from __future__ import annotations

import json
import os
import stat
from pathlib import Path

import pytest

from conftest import (CAMPAIGN, PREGEN, campaign_dir, create_campaign, git_log, narrate, narrate_opening,
                      open_turn, read_json, read_jsonl)
from test_rules_families import resolve

SECOND = "c2"
#: the-white-war's module-meta declares `ww1`; the-haunting's pregen is a 1920s sheet.
WW1_MODULE = "the-white-war"


def library_dir(workspace: Path) -> Path:
    return workspace / ".coc" / "investigators"


def sheet_path(workspace: Path, campaign_id: str, investigator_id: str) -> Path:
    return campaign_dir(workspace, campaign_id) / "party" / f"{investigator_id}.json"


def library_rows(workspace: Path, campaign_id: str) -> list[dict]:
    return [r for r in read_jsonl(campaign_dir(workspace, campaign_id) / "telemetry.jsonl") if r.get("lane") == "library"]


def without(sheet: dict, *keys: str) -> dict:
    return {k: v for k, v in sheet.items() if k not in keys}


def save_pregen(kernel) -> str:
    """c1 from the pregen, saved: returns the minted library_id."""
    create_campaign(kernel)
    saved = kernel.ok("investigator.save", {"campaign": CAMPAIGN})
    assert saved["created"] is True and saved["investigator"] == PREGEN
    return saved["library_id"]


def load_into_new_table(kernel, library_id: str, campaign_id: str = SECOND, module: str = WW1_MODULE,
                        **params) -> dict:
    """A second campaign (setting up, no pregen), the card loaded, the table opened and
    the opening narrated: what the setup entry point of §21.5 will do."""
    kernel.ok("campaign.create", {"id": campaign_id, "module": module, "play_language": "en"})
    loaded = kernel.ok("investigator.load", {"campaign": campaign_id, "library_id": library_id, **params})
    assert kernel.ok("setup.complete", {"campaign": campaign_id})["status"] == "ready_for_table"
    assert kernel.ok("table.open", {"campaign": campaign_id})["campaign"]["status"] == "active"
    kernel.ok("table.narrate", {"campaign": campaign_id, "call_id": "t0-c1", "text": "Opening."})
    return loaded


# ---- save and load: the whole sheet, byte for byte ------------------------------------------

def test_save_mints_a_row_from_the_campaign_sheet_and_marks_the_sheet(kernel):
    assert kernel.ok("investigator.list") == {"investigators": []}
    library_id = save_pregen(kernel)
    # a CJK name has no ascii slug: the fallback stem, first ordinal
    assert library_id == "investigator-1"
    row = read_json(library_dir(kernel.workspace) / f"{library_id}.json")
    assert list(row) == ["library_id", "sheet", "origin", "play", "schema_version"]
    assert row["schema_version"] == 1 and row["library_id"] == library_id
    assert row["origin"] == {**row["origin"], "created_in": CAMPAIGN, "era_at_creation": "1920s"} and row["origin"]["created_at"]
    # before any narrate there is no turn commit to point at; HEAD is the creation commit
    assert row["play"] == {**row["play"], "last_campaign": CAMPAIGN, "last_turn": None, "campaigns": [CAMPAIGN]}
    assert row["play"]["last_commit"] and row["play"]["updated_at"]
    on_disk = read_json(sheet_path(kernel.workspace, CAMPAIGN, PREGEN))
    assert on_disk["origin"] == {"library_id": library_id}
    # the row's sheet is the campaign's sheet, origin included
    assert row["sheet"] == on_disk
    assert kernel.ok("investigator.get", {"library_id": library_id}) == row
    listed = kernel.ok("investigator.list")["investigators"]
    assert listed == [{"library_id": library_id, "name": on_disk["name"], "occupation": on_disk["occupation"],
                       "era": "1920s", "current_hp": on_disk["current_hp"], "current_san": on_disk["current_san"],
                       "last_campaign": CAMPAIGN, "last_turn": None, "updated_at": row["play"]["updated_at"]}]
    # saving again updates the same row instead of minting another
    again = kernel.ok("investigator.save", {"campaign": CAMPAIGN})
    assert again["library_id"] == library_id and again["created"] is False
    assert kernel.ok("investigator.list")["investigators"][0]["library_id"] == library_id
    assert len(list(library_dir(kernel.workspace).glob("*.json"))) == 1


def test_load_copies_the_sheet_byte_for_byte_except_id_and_origin(kernel):
    library_id = save_pregen(kernel)
    source = read_json(sheet_path(kernel.workspace, CAMPAIGN, PREGEN))
    kernel.ok("campaign.create", {"id": SECOND, "module": WW1_MODULE, "play_language": "en"})
    loaded = kernel.ok("investigator.load", {"campaign": SECOND, "library_id": library_id})
    new_id = loaded["investigator"]["id"]
    assert new_id == "inv-1" and loaded["library_id"] == library_id and loaded["loaded_at_turn"] == 0
    assert loaded["forked_from"] is None and loaded["receipt"] == f"investigator:{new_id}"
    copied = read_json(sheet_path(kernel.workspace, SECOND, new_id))
    assert copied["id"] == new_id
    assert copied["origin"] == {"library_id": library_id, "loaded_at_turn": 0}
    assert without(copied, "id", "origin") == without(source, "id", "origin")
    # byte for byte: the same keys in the same order, the same values
    assert json.dumps(without(copied, "id", "origin"), ensure_ascii=False) == json.dumps(without(source, "id", "origin"), ensure_ascii=False)
    assert loaded["sheet"] == copied
    meta = read_json(campaign_dir(kernel.workspace, SECOND) / "campaign.json")
    assert meta["investigators"] == [new_id]
    receipt = meta["setup"]["receipts"][-1]
    assert receipt == {**receipt, "id": f"investigator:{new_id}", "kind": "investigator", "source": "library",
                       "library_id": library_id, "forked_from": None}
    # the setup ladder sees a party and the table opens on it
    assert "create-investigator" in kernel.ok("setup.steps", {"campaign": SECOND})["completed"]
    assert kernel.ok("setup.complete", {"campaign": SECOND})["investigators"] == [new_id]
    assert kernel.ok("table.open", {"campaign": SECOND})["investigators"][0]["id"] == new_id
    # loading is read-only on the row: it still says the card was last in c1
    assert kernel.ok("investigator.get", {"library_id": library_id})["play"]["last_campaign"] == CAMPAIGN


def test_unknown_row_is_unknown_entity_with_the_candidates(kernel):
    library_id = save_pregen(kernel)
    error = kernel.err("investigator.get", {"library_id": "nobody-1"})
    assert error["code"] == "unknown_entity" and error["details"]["candidates"] == [library_id]
    assert kernel.err("investigator.load", {"campaign": CAMPAIGN, "library_id": "nobody-1"})["code"] == "unknown_entity"
    assert kernel.err("investigator.load", {"campaign": "nope", "library_id": library_id})["code"] == "campaign_not_found"
    assert kernel.err("investigator.get", {})["code"] == "invalid_params"


def test_load_waits_for_the_keeper_to_finish_acting(kernel):
    library_id = save_pregen(kernel)
    kernel.ok("campaign.create", {"id": SECOND, "module": "the-haunting", "pregen": PREGEN})
    kernel.ok("table.narrate", {"campaign": SECOND, "call_id": "t0-c1", "text": "Opening."})
    kernel.ok("table.player_input", {"campaign": SECOND, "text": "I look."})
    refused = kernel.err("investigator.load", {"campaign": SECOND, "library_id": library_id})
    assert refused["code"] == "turn_state" and refused["details"]["state"] == "open"
    kernel.ok("table.narrate", {"campaign": SECOND, "call_id": "t1-c1", "text": "Nothing here."})
    # between turns the card joins, at the turn now waiting for the player
    loaded = kernel.ok("investigator.load", {"campaign": SECOND, "library_id": library_id})
    assert loaded["loaded_at_turn"] == 2
    # the pregen already holds `thomas-hayes`; the copy gets the next free id
    assert loaded["investigator"]["id"] == "inv-2"
    assert [s["id"] for s in kernel.ok("table.open", {"campaign": SECOND})["investigators"]] == ["inv-2", PREGEN]


# ---- era mismatch: allowed, unchanged, hinted -----------------------------------------------

def test_era_mismatch_is_recorded_and_hinted_and_changes_no_value(kernel):
    library_id = save_pregen(kernel)
    source = read_json(sheet_path(kernel.workspace, CAMPAIGN, PREGEN))
    loaded = load_into_new_table(kernel, library_id)
    assert loaded["era_mismatch"] == {"sheet": "1920s", "module": "ww1"}
    meta = read_json(campaign_dir(kernel.workspace, SECOND) / "campaign.json")
    assert meta["era_mismatch"] == {"sheet": "1920s", "module": "ww1"}
    copied = read_json(sheet_path(kernel.workspace, SECOND, "inv-1"))
    # nothing converted: the 1920s standard sheet, the 1920s cash table, every number
    assert without(copied, "id", "origin") == without(source, "id", "origin")
    assert copied["era"] == "1920s" and copied["finance"]["period"] == "1920s" if "period" in copied.get("finance", {}) else True
    capsule = kernel.ok("table.player_input", {"campaign": SECOND, "text": "I look around."})["capsule"]
    investigator = capsule["known"]["investigator"]
    assert investigator["id"] == "inv-1" and investigator["hp"] == source["current_hp"]
    note = investigator["era_note"]
    assert "1920s" in note and "ww1" in note and "unchanged" in note
    # the hint is one English line for the keeper, nothing the player sees
    assert "\n" not in note and all(ord(ch) < 0x2e80 for ch in note)


def test_a_card_of_the_modules_own_era_carries_no_hint(kernel):
    library_id = save_pregen(kernel)
    loaded = load_into_new_table(kernel, library_id, module="the-haunting")
    assert loaded["era_mismatch"] is None
    assert "era_mismatch" not in read_json(campaign_dir(kernel.workspace, SECOND) / "campaign.json")
    capsule = kernel.ok("table.player_input", {"campaign": SECOND, "text": "I look around."})["capsule"]
    assert "era_note" not in capsule["known"]["investigator"]


# ---- the per-turn write-back ----------------------------------------------------------------

def test_three_committed_turns_move_the_row_and_last_turn_tracks_them(seeded_kernel):
    kernel = seeded_kernel
    library_id = save_pregen(kernel)
    load_into_new_table(kernel, library_id)
    sheet = sheet_path(kernel.workspace, SECOND, "inv-1")
    row_path = library_dir(kernel.workspace) / f"{library_id}.json"

    def after_turn(n: int, commit: str) -> dict:
        row = read_json(row_path)
        assert row["sheet"] == read_json(sheet), f"turn {n}: the row is the campaign sheet"
        assert row["play"] == {**row["play"], "last_campaign": SECOND, "last_turn": n, "last_commit": commit,
                               "campaigns": [CAMPAIGN, SECOND]}
        assert library_rows(kernel.workspace, SECOND)[-1] == {
            **library_rows(kernel.workspace, SECOND)[-1], "turn": n, "investigator": "inv-1",
            "library_id": library_id, "ok": True}
        return row

    # the opening narrate already mirrored the card once, at turn 0
    opening = read_json(row_path)
    assert opening["play"]["last_turn"] == 0 and opening["play"]["last_campaign"] == SECOND
    hp0, san0 = opening["sheet"]["current_hp"], opening["sheet"]["current_san"]

    # turn 1: a wound
    kernel.ok("table.player_input", {"campaign": SECOND, "text": "I climb the ladder."})
    kernel.ok("table.apply", {"campaign": SECOND, "call_id": "t1-c1",
                              "effects": [{"kind": "damage", "dice": "1D3", "why": "a fall"}]})
    status = kernel.ok("table.status", {"campaign": SECOND})
    from coc.render import expected_numbers
    owed = " ".join(n for r in status["receipts"] for n in expected_numbers(r))
    first = kernel.ok("table.narrate", {"campaign": SECOND, "call_id": "t1-c2", "text": f"You fall. ({owed})"})
    row1 = after_turn(1, first["commit"])
    assert row1["sheet"]["current_hp"] < hp0

    # turn 2: sanity, lost on a pass or a fail
    kernel.ok("table.player_input", {"campaign": SECOND, "text": "I look at the thing in the crater."})
    kernel.ok("table.resolve", {"campaign": SECOND, "call_id": "t2-c1",
                                "action": {"intent": "investigate", "goal": "the thing in the crater", "method": "",
                                           "decision": "sanity:check", "san_loss": "1/1D3", "involuntary": "freeze"}})
    status = kernel.ok("table.status", {"campaign": SECOND})
    owed = " ".join(n for r in status["receipts"] for n in expected_numbers(r))
    second = kernel.ok("table.narrate", {"campaign": SECOND, "call_id": "t2-c2", "text": f"It moves. ({owed})"})
    row2 = after_turn(2, second["commit"])
    assert row2["sheet"]["current_san"] < san0

    # turn 3: nothing on the sheet changes, the row still follows the commit
    kernel.ok("table.player_input", {"campaign": SECOND, "text": "I wait."})
    third = kernel.ok("table.narrate", {"campaign": SECOND, "call_id": "t3-c1", "text": "Time passes."})
    row3 = after_turn(3, third["commit"])
    assert row3["sheet"] == row2["sheet"]
    assert [r["turn"] for r in library_rows(kernel.workspace, SECOND)] == [0, 1, 2, 3]
    assert kernel.ok("investigator.list")["investigators"][0] == {
        **kernel.ok("investigator.list")["investigators"][0], "last_campaign": SECOND, "last_turn": 3,
        "current_hp": row3["sheet"]["current_hp"], "current_san": row3["sheet"]["current_san"]}


def test_the_campaign_is_authority_and_the_library_only_a_mirror(kernel):
    library_id = save_pregen(kernel)
    load_into_new_table(kernel, library_id)
    row_path = library_dir(kernel.workspace) / f"{library_id}.json"
    sheet = sheet_path(kernel.workspace, SECOND, "inv-1")
    # someone edits the row by hand between turns
    row = read_json(row_path)
    row["sheet"]["current_hp"] = 1
    row["sheet"]["skills"]["Spot Hidden"] = 99
    row_path.write_text(json.dumps(row, ensure_ascii=False), encoding="utf-8")
    before = sheet.read_bytes()
    kernel.ok("table.player_input", {"campaign": SECOND, "text": "I wait."})
    kernel.ok("table.narrate", {"campaign": SECOND, "call_id": "t1-c1", "text": "Time passes."})
    # the campaign sheet did not move; the row was overwritten by it
    assert sheet.read_bytes() == before
    mirrored = read_json(row_path)
    assert mirrored["sheet"] == read_json(sheet)
    assert mirrored["sheet"]["current_hp"] != 1 and mirrored["sheet"]["skills"]["Spot Hidden"] != 99


def test_one_card_at_two_tables_last_writer_wins_and_provenance_says_who(kernel):
    library_id = save_pregen(kernel)
    load_into_new_table(kernel, library_id, campaign_id="c2")
    load_into_new_table(kernel, library_id, campaign_id="c3")
    row_path = library_dir(kernel.workspace) / f"{library_id}.json"
    assert read_json(row_path)["play"] == {**read_json(row_path)["play"], "last_campaign": "c3", "last_turn": 0,
                                           "campaigns": [CAMPAIGN, "c2", "c3"]}
    kernel.ok("table.player_input", {"campaign": "c2", "text": "I wait."})
    kernel.ok("table.apply", {"campaign": "c2", "call_id": "t1-c1", "effects": [{"kind": "damage", "dice": "1D3"}]})
    from coc.render import expected_numbers
    owed = " ".join(n for r in kernel.ok("table.status", {"campaign": "c2"})["receipts"] for n in expected_numbers(r))
    kernel.ok("table.narrate", {"campaign": "c2", "call_id": "t1-c2", "text": f"Ouch. ({owed})"})
    row = read_json(row_path)
    assert row["play"]["last_campaign"] == "c2" and row["play"]["last_turn"] == 1
    assert row["sheet"] == read_json(sheet_path(kernel.workspace, "c2", "inv-1"))
    # c3 never saw c2's wound: the library never writes into a campaign
    assert read_json(sheet_path(kernel.workspace, "c3", "inv-1"))["current_hp"] == read_json(sheet_path(kernel.workspace, CAMPAIGN, PREGEN))["current_hp"]
    # campaigns are de-duplicated however many turns each plays
    kernel.ok("table.player_input", {"campaign": "c3", "text": "I wait."})
    kernel.ok("table.narrate", {"campaign": "c3", "call_id": "t1-c1", "text": "Quiet."})
    assert read_json(row_path)["play"]["campaigns"] == [CAMPAIGN, "c2", "c3"]
    assert read_json(row_path)["play"]["last_campaign"] == "c3"


def test_as_loads_a_double_as_a_second_person_with_its_own_row(kernel):
    library_id = save_pregen(kernel)
    kernel.ok("campaign.create", {"id": SECOND, "module": WW1_MODULE, "play_language": "en"})
    loaded = kernel.ok("investigator.load", {"campaign": SECOND, "library_id": library_id, "as": "Tom Hayes"})
    assert loaded["library_id"] == "tom-hayes-1" and loaded["forked_from"] == library_id
    assert loaded["investigator"] == {**loaded["investigator"], "id": "tom-hayes", "name": "Tom Hayes"}
    copied = read_json(sheet_path(kernel.workspace, SECOND, "tom-hayes"))
    source = read_json(sheet_path(kernel.workspace, CAMPAIGN, PREGEN))
    assert without(copied, "id", "origin", "name") == without(source, "id", "origin", "name")
    assert copied["origin"] == {"library_id": "tom-hayes-1", "loaded_at_turn": 0}
    fork = kernel.ok("investigator.get", {"library_id": "tom-hayes-1"})
    assert fork["origin"] == {**fork["origin"], "created_in": SECOND, "forked_from": library_id, "era_at_creation": "1920s"}
    assert fork["play"] == {**fork["play"], "last_campaign": SECOND, "last_turn": None, "last_commit": None, "campaigns": [SECOND]}
    assert fork["sheet"] == copied
    # the original row is untouched
    original = kernel.ok("investigator.get", {"library_id": library_id})
    assert original["sheet"]["name"] == source["name"] and original["play"]["last_campaign"] == CAMPAIGN
    assert {r["library_id"] for r in kernel.ok("investigator.list")["investigators"]} == {library_id, "tom-hayes-1"}


# ---- failure never fails the turn -----------------------------------------------------------

@pytest.mark.skipif(hasattr(os, "geteuid") and os.geteuid() == 0, reason="root ignores directory modes")
def test_a_read_only_library_leaves_the_turn_committed_and_a_telemetry_row(kernel):
    library_id = save_pregen(kernel)
    load_into_new_table(kernel, library_id)
    root = library_dir(kernel.workspace)
    row_path = root / f"{library_id}.json"
    before = row_path.read_bytes()
    mode = stat.S_IMODE(root.stat().st_mode)
    os.chmod(root, stat.S_IRUSR | stat.S_IXUSR)
    try:
        kernel.ok("table.player_input", {"campaign": SECOND, "text": "I wait."})
        result = kernel.ok("table.narrate", {"campaign": SECOND, "call_id": "t1-c1", "text": "Quiet."})
        assert result["commit"] and git_log(kernel.workspace, SECOND)[0].startswith("turn 1:")
        assert read_json(campaign_dir(kernel.workspace, SECOND) / "turn.json")["turn"] == 2
        failed = library_rows(kernel.workspace, SECOND)[-1]
        assert failed == {**failed, "turn": 1, "library_id": library_id, "investigator": "inv-1", "ok": False,
                          "reason": "library_unwritable"}
        assert "cannot write" in failed["error"]
        assert row_path.read_bytes() == before
        # the next turn still plays
        kernel.ok("table.player_input", {"campaign": SECOND, "text": "I wait more."})
        assert kernel.ok("table.narrate", {"campaign": SECOND, "call_id": "t2-c1", "text": "Still quiet."})["commit"]
        assert [r["ok"] for r in library_rows(kernel.workspace, SECOND)] == [True, False, False]
        # a manual save says why instead of pretending
        error = kernel.err("investigator.save", {"campaign": SECOND})
        assert error["code"] == "internal" and error["code_detail"] == "library_unwritable"
    finally:
        os.chmod(root, mode)
    # writable again: the next commit catches the row up
    kernel.ok("table.player_input", {"campaign": SECOND, "text": "I wait again."})
    third = kernel.ok("table.narrate", {"campaign": SECOND, "call_id": "t3-c1", "text": "Dawn."})
    assert read_json(row_path)["play"] == {**read_json(row_path)["play"], "last_turn": 3, "last_commit": third["commit"]}


def test_a_row_the_kernel_cannot_read_is_a_conflict_and_is_left_alone(kernel):
    library_id = save_pregen(kernel)
    load_into_new_table(kernel, library_id)
    row_path = library_dir(kernel.workspace) / f"{library_id}.json"
    row_path.write_text("{not json", encoding="utf-8")
    kernel.ok("table.player_input", {"campaign": SECOND, "text": "I wait."})
    assert kernel.ok("table.narrate", {"campaign": SECOND, "call_id": "t1-c1", "text": "Quiet."})["commit"]
    failed = library_rows(kernel.workspace, SECOND)[-1]
    assert failed == {**failed, "turn": 1, "ok": False, "reason": "library_conflict"}
    assert row_path.read_text(encoding="utf-8") == "{not json"
    error = kernel.err("investigator.get", {"library_id": library_id})
    assert error["code"] == "internal" and error["code_detail"] == "library_conflict"
    listed = kernel.ok("investigator.list")
    assert listed["investigators"] == [] and listed["unreadable"] == [library_id]
    # a row of another schema, or one whose id is not its file name, is a conflict too
    row_path.write_text(json.dumps({"library_id": library_id, "sheet": {}, "schema_version": 2}), encoding="utf-8")
    assert kernel.err("investigator.get", {"library_id": library_id})["code_detail"] == "library_conflict"
    row_path.write_text(json.dumps({"library_id": "someone-else-1", "sheet": {}, "schema_version": 1}), encoding="utf-8")
    assert kernel.err("investigator.get", {"library_id": library_id})["code_detail"] == "library_conflict"


def test_a_row_that_went_missing_is_recreated_from_the_campaign(kernel):
    library_id = save_pregen(kernel)
    load_into_new_table(kernel, library_id)
    row_path = library_dir(kernel.workspace) / f"{library_id}.json"
    row_path.unlink()
    kernel.ok("table.player_input", {"campaign": SECOND, "text": "I wait."})
    kernel.ok("table.narrate", {"campaign": SECOND, "call_id": "t1-c1", "text": "Quiet."})
    row = read_json(row_path)
    assert row["sheet"] == read_json(sheet_path(kernel.workspace, SECOND, "inv-1"))
    assert row["origin"]["created_in"] == SECOND and row["play"]["campaigns"] == [SECOND]
    assert library_rows(kernel.workspace, SECOND)[-1]["ok"] is True


def test_cards_without_an_origin_are_never_written_back(kernel):
    open_turn(kernel)
    kernel.ok("table.narrate", {"campaign": CAMPAIGN, "call_id": "t1-c1", "text": "Nothing."})
    assert not library_dir(kernel.workspace).exists()
    assert library_rows(kernel.workspace, CAMPAIGN) == []


# ---- minting --------------------------------------------------------------------------------

def test_library_ids_are_slug_plus_ordinal_deterministic_and_collision_free(kernel):
    for n in (1, 2, 3):
        cid = f"ada{n}"
        kernel.ok("campaign.create", {"id": cid, "module": "the-haunting", "play_language": "en"})
        kernel.ok("setup.investigator", {"campaign": cid, "name": "Ada Lovelace", "occupation": "Journalist", "seed": "1"})
        saved = kernel.ok("investigator.save", {"campaign": cid})
        assert saved["library_id"] == f"ada-lovelace-{n}", "one name, ascending ordinals"
    # an accented, spaced, punctuated name folds to ascii; a CJK one falls back to the stem
    kernel.ok("campaign.create", {"id": "z", "module": "the-haunting", "play_language": "en"})
    kernel.ok("setup.investigator", {"campaign": "z", "name": "Zoë O'Brien-Núñez", "occupation": "Artist", "seed": "1"})
    assert kernel.ok("investigator.save", {"campaign": "z"})["library_id"] == "zoe-o-brien-nunez-1"
    kernel.ok("campaign.create", {"id": "h", "module": "the-haunting", "play_language": "zh-Hans"})
    kernel.ok("setup.investigator", {"campaign": "h", "name": "王小明", "occupation": "Artist", "seed": "1"})
    assert kernel.ok("investigator.save", {"campaign": "h"})["library_id"] == "investigator-1"
    # a file that already sits in the library, whoever put it there, is never overwritten by a mint
    (library_dir(kernel.workspace) / "ada-lovelace-7.json").write_text("{}", encoding="utf-8")
    kernel.ok("campaign.create", {"id": "ada4", "module": "the-haunting", "play_language": "en"})
    kernel.ok("setup.investigator", {"campaign": "ada4", "name": "Ada Lovelace", "occupation": "Journalist", "seed": "1"})
    assert kernel.ok("investigator.save", {"campaign": "ada4"})["library_id"] == "ada-lovelace-8"
    # `ada-lovelace-2` is a different stem from `ada-lovelace`: its own ordinals
    kernel.ok("campaign.create", {"id": "ada5", "module": "the-haunting", "play_language": "en"})
    kernel.ok("setup.investigator", {"campaign": "ada5", "name": "Ada Lovelace 2", "occupation": "Journalist", "seed": "1"})
    assert kernel.ok("investigator.save", {"campaign": "ada5"})["library_id"] == "ada-lovelace-2-1"
    ids = {r["library_id"] for r in kernel.ok("investigator.list")["investigators"]}
    assert ids == {"ada-lovelace-1", "ada-lovelace-2", "ada-lovelace-3", "ada-lovelace-8", "ada-lovelace-2-1",
                   "zoe-o-brien-nunez-1", "investigator-1"}


def test_list_is_newest_first_and_save_names_the_card_at_a_larger_table(kernel):
    library_id = save_pregen(kernel)
    kernel.ok("campaign.create", {"id": SECOND, "module": "the-haunting", "play_language": "en"})
    kernel.ok("setup.investigator", {"campaign": SECOND, "name": "Ada Lovelace", "occupation": "Journalist", "seed": "1"})
    kernel.ok("investigator.load", {"campaign": SECOND, "library_id": library_id})
    # two at the table: `investigator` picks by id or by name; none given is a choice
    choice = kernel.err("investigator.save", {"campaign": SECOND})
    assert choice["code"] == "needs_choice" and len(choice["details"]["candidates"]) == 2
    assert kernel.err("investigator.save", {"campaign": SECOND, "investigator": "nobody"})["code"] == "unknown_entity"
    saved = kernel.ok("investigator.save", {"campaign": SECOND, "investigator": "Ada Lovelace"})
    assert saved["library_id"] == "ada-lovelace-1" and saved["created"] is True
    # the loaded card kept its CJK name, so it joined as `inv-<party ordinal>`, not by slug
    by_id = kernel.ok("investigator.save", {"campaign": SECOND, "investigator": "inv-2"})
    assert by_id["library_id"] == library_id and by_id["created"] is False
    listed = kernel.ok("investigator.list")["investigators"]
    assert [r["library_id"] for r in listed] == [library_id, "ada-lovelace-1"]
    assert listed[0]["updated_at"] >= listed[1]["updated_at"]
