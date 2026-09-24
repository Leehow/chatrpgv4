"""T11 read-only ordinary-resolve snapshot through the TypeScript kernel RPC.

These cases pin canonical options and existing settlement replay. They are controlled protocol
conformance, not gameplay or semantic-classifier acceptance.
"""

from __future__ import annotations

import hashlib
import json

from conftest import CAMPAIGN, campaign_dir, git_log, narrate, open_turn, read_json
from test_rules_families import walk_to_confrontation


def options(client):
    return client.ok("table.resolve.options", {"campaign": CAMPAIGN})


def fingerprint(client):
    root = campaign_dir(client.workspace)
    files = {
        path.relative_to(root).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
        for path in root.rglob("*") if path.is_file()
    }
    return {"files": files, "git": git_log(client.workspace)}


def profiles_by_skill(snapshot):
    return {row["skill"]: row for row in snapshot["profiles"]}


def test_options_is_read_only_and_uses_canonical_sheet_and_rule_vocabulary(kernel):
    open_turn(kernel)
    before = fingerprint(kernel)
    snapshot = options(kernel)
    after = fingerprint(kernel)

    assert snapshot["version"] == 1
    assert before == after, "the resolve-options snapshot cannot touch campaign state or Git"
    assert snapshot["revision"] and snapshot["world_revision"]
    # `_binding` names the campaign/worldline/loop/turn the snapshot was read at (contract §124, 28fe5d0c0):
    # the host's check-preflight and the ordinary resolve domain read it to bind a decision to this
    # state; every other reader strips it. It is not vocabulary and never reaches a model.
    assert snapshot["context"].pop("_binding") == {"campaign": "c1", "worldline": "main", "loop": 0, "turn": 1}
    assert snapshot["context"] == {
        "scene": "Knott's Office",
        "pending_choice": None,
        "session": None,
        # §135.30.2: Knott is present but the book prints no numbers for him, so there is no one to fight.
        "first_blow": None,
        "conditions": [{"actor": "托马斯·海斯", "conditions": []}],
        "current_receipts": [],
        "declared_action": "我仔细观察诺特。",
    }

    rows = snapshot["profiles"]
    assert [row["alias"] for row in rows] == [f"profile:{index}" for index in range(len(rows))]
    assert len({(row["actor"], row["skill"]) for row in rows}) == len(rows)
    assert all(row["actor"] == "托马斯·海斯" for row in rows)
    bound = profiles_by_skill(snapshot)
    assert {skill: bound[skill]["value"] for skill in
            ("Fast Talk", "Library Use", "Psychology", "Spot Hidden", "STR", "LUCK")} == {
        "Fast Talk": 45, "Library Use": 40, "Psychology": 45,
        "Spot Hidden": 55, "STR": 60, "LUCK": 50,
    }
    assert bound["Occult"] == {**bound["Occult"], "availability": "bound", "value": 5}
    assert bound["Medicine"] == {**bound["Medicine"], "availability": "bound", "value": 1}
    assert "Language (Latin)" not in bound and "Medicine (Surgery)" not in bound

    decisions = snapshot["decisions"]
    assert len(decisions) == len({row["name"] for row in decisions})
    assert all(set(row) == {"name", "family", "description", "capability"} for row in decisions)
    ordinary = next(row for row in decisions if row["name"] == "core-check:ordinary-check")
    assert ordinary["family"] == "core-check" and ordinary["capability"] == "check"
    assert ordinary["description"]


def test_profile_rows_say_which_skills_the_sheet_holds(kernel):
    """Contract §135.28.1 (SL-40): a row is `held` when the investigator's sheet lists the skill (whatever its value) or it
    is a characteristic; a catalog skill the sheet does not list is `held: false` at its base chance. Read from the sheet."""
    open_turn(kernel)
    sheet = read_json(campaign_dir(kernel.workspace) / "party" / "thomas-hayes.json")
    rows = options(kernel)["profiles"]
    assert all(isinstance(row["held"], bool) for row in rows)
    held = {row["skill"] for row in rows if row["held"]}
    characteristics = {"STR", "CON", "SIZ", "DEX", "APP", "INT", "POW", "EDU", "LUCK"}
    assert held == set(sheet["skills"]) | ({row["skill"] for row in rows} & characteristics)
    catalog = [row for row in rows if not row["held"]]
    assert catalog, "the catalog offers skills the sheet does not list, so the flag is under test"
    assert all(row["skill"] not in sheet["skills"] for row in catalog)


def test_missing_characteristic_dependencies_stay_unknown_instead_of_becoming_numbers(kernel):
    open_turn(kernel)
    sheet_path = campaign_dir(kernel.workspace) / "party" / "thomas-hayes.json"
    sheet = read_json(sheet_path)
    sheet["characteristics"].pop("DEX")
    sheet["skills"].pop("Dodge")
    sheet_path.write_text(json.dumps(sheet, ensure_ascii=False, indent=2), encoding="utf-8")
    before = fingerprint(kernel)

    snapshot = options(kernel)

    bound = profiles_by_skill(snapshot)
    assert bound["DEX"]["availability"] == "unknown" and bound["DEX"]["value"] is None
    assert bound["Dodge"]["availability"] == "unknown" and bound["Dodge"]["value"] is None
    assert fingerprint(kernel) == before


def test_options_preserves_actual_pending_choice_and_active_session_without_writing(kernel):
    open_turn(kernel, "我举枪对准棺材里的东西。")
    ordinal = walk_to_confrontation(kernel)
    attack = kernel.table("resolve", call_id=f"t1-c{ordinal}", action={
        "intent": "combat", "goal": "朝科比特开枪", "method": "用左轮射击",
        "target": "Walter Corbitt", "weapon": ".38 Revolver",
    })
    assert attack["pending_choice"] and attack["session"]["status"] == "active"
    before = fingerprint(kernel)

    snapshot = options(kernel)

    assert snapshot["context"]["pending_choice"] == attack["pending_choice"]
    assert snapshot["context"]["session"] == attack["session"]
    assert snapshot["context"]["current_receipts"]
    assert fingerprint(kernel) == before


def test_the_first_blow_row_names_who_can_be_fought_and_is_gone_once_the_fight_opens(kernel):
    """§135.30.2 (SL-19): outside a fight, `context.first_blow` is the investigator's attack as the engine would take it --
    the people present with a stat block, under the name the capsule gives them, and the investigator's own weapons."""
    open_turn(kernel, "我一拳打过去。")
    assert options(kernel)["context"]["first_blow"] is None, "Knott has no stat block: nobody the engine can fight"
    kernel.table("apply", call_id="t1-c1", effects=[{"kind": "npc", "name": "Steven Knott", "archetype": "ordinary_adult", "why": "test"}])
    before = fingerprint(kernel)
    row = options(kernel)["context"]["first_blow"]
    assert fingerprint(kernel) == before, "a read"
    present = [person["name"] for person in kernel.table("capsule")["present"]]
    assert row == {"decision": "combat:attack", "intent": "combat", "actor": "托马斯·海斯", "targets": ["Steven Knott"],
                   "weapons": [".38 Revolver", "unarmed"]}
    assert row["targets"] == present, "the capsule's identities, so the compile's target rows are the addressee rows"
    # The row is what the engine takes: the clerk's resolve of it opens the fight, and inside a fight there is none.
    opened = kernel.table("resolve", call_id="t1-c2", action={"intent": row["intent"], "decision": row["decision"], "target": row["targets"][0],
                                                            "weapon": "unarmed", "goal": "一拳", "method": "一拳"})
    assert opened["session"]["kind"] == "combat" and opened["session"]["status"] == "active"
    assert options(kernel)["context"]["first_blow"] is None


def test_options_rejects_foreign_closed_and_extra_requests(kernel):
    open_turn(kernel)
    assert kernel.err("table.resolve.options", {"campaign": "other"})["code"] == "campaign_not_found"
    assert kernel.err("table.resolve.options", {})["code"] == "invalid_params"
    for params in ({"campaign": CAMPAIGN, "extra": True}, {"campaign": CAMPAIGN, "action": {}}):
        assert kernel.err("table.resolve.options", params)["code"] == "invalid_params"

    narrate(kernel, "t1-c1", "The current turn closes without a check.")
    closed = kernel.err("table.resolve.options", {"campaign": CAMPAIGN})
    assert closed["code"] == "campaign_not_ready"


def test_options_does_not_change_the_existing_resolve_call_or_exact_replay(kernel):
    open_turn(kernel)
    initial = options(kernel)
    request = {"campaign": CAMPAIGN, "call_id": "t1-c1", "action": {
        "intent": "investigate", "goal": "check the room", "method": "look carefully", "skill": "Spot Hidden",
    }}

    settled = kernel.ok("table.resolve", request)
    assert "_task_advance" not in settled, "ordinary callers retain the existing result shape"
    after_settlement = fingerprint(kernel)
    replayed = kernel.ok("table.resolve", request)
    current = options(kernel)

    assert replayed == {**settled, "replayed": True}
    assert fingerprint(kernel) == after_settlement, "exact replay and the following options read add no second settlement"
    assert current["revision"] == initial["revision"], "profile and rule vocabulary did not change"
    assert current["world_revision"] != initial["world_revision"], "the settled receipt changes task-world freshness"
    assert current["context"]["current_receipts"] == [{
        "kind": "roll", "actor": "托马斯·海斯", "skill": "Spot Hidden", "outcome": None,
    }]
    assert len(kernel.table("status")["receipts"]) == 1


def test_tracked_resolve_returns_exact_receipt_revision_and_replays_without_a_second_roll(kernel):
    open_turn(kernel)
    before = kernel.ok("table.capsule", {"campaign": CAMPAIGN})["_context"]
    request = {"campaign": CAMPAIGN, "call_id": "t1-c1", "_task_read_set": True, "action": {
        "intent": "investigate", "goal": "check the room", "method": "look carefully", "skill": "Spot Hidden",
    }}

    settled = kernel.ok("table.resolve", request)
    after = kernel.ok("table.capsule", {"campaign": CAMPAIGN})["_context"]
    advance = settled["_task_advance"]
    assert advance == {
        "campaign": CAMPAIGN,
        "turn": 1,
        "worldline": "main",
        "loop": 0,
        "operationId": "t1-c1",
        "receiptIds": settled["receipts"],
        "before": before["world_revision"],
        "after": after["world_revision"],
        "task_before": before["task_world_revision"],
        "task_after": after["task_world_revision"],
    }
    assert advance["before"] != advance["after"]
    assert advance["task_before"] != advance["task_after"]
    written = fingerprint(kernel)

    replay = kernel.ok("table.resolve", request)

    assert replay == {**settled, "replayed": True}
    assert replay["_task_advance"] == advance
    assert fingerprint(kernel) == written
    invalid = kernel.err("table.resolve", {"campaign": CAMPAIGN, "call_id": "t1-c2", "_task_read_set": "yes",
        "action": {"intent": "investigate", "goal": "x", "method": "look", "skill": "Spot Hidden"}})
    assert invalid["code"] == "invalid_params"
    assert fingerprint(kernel) == written
