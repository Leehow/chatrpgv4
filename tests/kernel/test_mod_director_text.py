"""The Director and narration packages through the public RPC seam (contract §30); fixtures are not playtest evidence."""
import json
from pathlib import Path

from conftest import CAMPAIGN, campaign_dir, create_campaign, narrate, open_turn, read_json

PACKAGES = {"story-thread", "keeper-pacing", "narration-craft", "narration-audit"}
RANK = ["critical", "core", "major", "supporting", "minor", "unknown"]


def test_thread_is_organised_by_what_the_story_still_needs(kernel):
    create_campaign(kernel)
    context = kernel.ok("mods.context", {"campaign": CAMPAIGN})
    assert PACKAGES <= {m["id"] for m in context["active"]}
    thread = context["thread"]
    lines = thread["lines"]
    assert lines and all({"name", "importance", "missing", "of", "here", "next", "beyond"} <= set(line) for line in lines)
    assert all("needs" in line for line in lines if line["here"]), "a line with clues in this scene keeps its words"
    assert [RANK.index(line["importance"]) for line in lines] == sorted(RANK.index(line["importance"]) for line in lines)
    assert lines[0]["importance"] == "critical"
    frame = next(line for line in lines if line["name"] == "commission-and-research-frame")
    assert frame["here"] and all({"clue", "gate"} <= set(entry) for entry in frame["here"])
    assert {entry["gate"].split(":")[0] for entry in frame["here"]} <= {"npc_dialogue", "obvious"}
    assert all(entry["gate"].endswith(": check unspecified") for entry in frame["here"]), "missing check metadata must not claim a source-authored waiver (§30.12)"
    assert any(entry["by"] == "Steven Knott" for entry in frame["handed"])
    assert thread["handed"].startswith("The book means these clues to happen")
    assert frame["missing"] == frame["of"] and "fallback" not in frame
    buried = next(line for line in lines if line["name"] == "corbitt-buried-in-basement")
    assert buried["here"] == [] and buried["next"] and buried["beyond"] >= 1 and "fallback" not in buried
    assert all(entry["clues"] >= 1 and entry["locked"].startswith("clue_discovered") for entry in buried["next"])
    assert buried["minimum_routes"] == 3
    assert len(json.dumps(thread, ensure_ascii=False).encode()) <= 3072


def test_a_clue_without_a_declared_check_keeps_its_gate_unspecified(kernel):
    """The retained cupboard clue has no skill key. Keep that gap explicit without inventing a source waiver;
    the delivery words and the existing handed-clue guidance remain available to the Keeper."""
    open_turn(kernel)
    kernel.table("apply", call_id="t1-c1", effects=[{"kind": "move", "to": "corbitt-house-ground"}])
    line = next(l for l in kernel.ok("mods.context", {"campaign": CAMPAIGN})["thread"]["lines"] if l["name"] == "corbitt-is-undead-sorcerer")
    diaries = next(entry for entry in line["here"] if entry["clue"] == "corbitt-diaries")
    assert diaries["gate"] == "environmental: check unspecified"
    assert diaries["line"] == "boarded cupboard on the ground floor"


def test_a_discovered_clue_leaves_the_thread_and_the_capsule_carries_it(kernel):
    open_turn(kernel)
    before = next(line for line in kernel.ok("mods.context", {"campaign": CAMPAIGN})["thread"]["lines"] if line["name"] == "commission-and-research-frame")
    clue = before["here"][0]["clue"]
    kernel.table("apply", call_id="t1-c1", effects=[{"kind": "clue", "clue": clue}])
    after = next(line for line in kernel.ok("mods.context", {"campaign": CAMPAIGN})["thread"]["lines"] if line["name"] == "commission-and-research-frame")
    assert after["missing"] == before["missing"] - 1
    assert clue not in {entry["clue"] for entry in after["here"]}
    capsule = kernel.table("capsule")
    assert capsule["mods"]["thread"]["lines"][0]["name"] == kernel.ok("mods.context", {"campaign": CAMPAIGN})["thread"]["lines"][0]["name"]
    assert capsule["mods"]["pacing"]["close_calls"] == {"count": 0, "threshold": 3, "rule": capsule["mods"]["pacing"]["close_calls"]["rule"]}
    assert any(entry["mod"] == "story-thread" for entry in capsule["mods"]["instructions"])
    craft = next(entry for entry in capsule["mods"]["instructions"] if entry["mod"] == "narration-craft")
    assert craft["settings"] == {"density_guide": "off"}, "narration-craft 1.2.0: no ladder, one opt-in density guide, off by default (turn floor)"


def test_close_calls_count_major_wound_blows_once_per_turn(kernel):
    open_turn(kernel)
    kernel.table("apply", call_id="t1-c1", effects=[{"kind": "damage", "dice": "4D6+4", "why": "the stair gives way"}, {"kind": "damage", "dice": "1D3", "why": "and the rail"}])
    narrate(kernel, "t1-c2", "楼梯塌了。")
    kernel.table("player_input", text="我爬起来。")
    pacing = kernel.ok("mods.context", {"campaign": CAMPAIGN})["pacing"]
    assert pacing["close_calls"]["count"] == 1
    assert pacing["threat_clocks"] == [] or all({"threat", "clock", "state"} <= set(row) for row in pacing["threat_clocks"])


def test_sections_exist_only_while_a_reader_is_on(kernel):
    create_campaign(kernel)
    kernel.ok("mods.configure", {"campaign": CAMPAIGN, "id": "story-thread", "enabled": False})
    kernel.ok("mods.configure", {"campaign": CAMPAIGN, "id": "keeper-pacing", "enabled": False})
    context = kernel.ok("mods.context", {"campaign": CAMPAIGN})
    assert "thread" not in context and "pacing" not in context
    assert not any(entry["mod"] in {"story-thread", "keeper-pacing"} for entry in context["instructions"])


def test_narration_audit_joins_the_shared_audit_job(kernel):
    open_turn(kernel)
    job = kernel.ok("mods.job", {"campaign": CAMPAIGN, "role": "audit", "input": {"text": "诺特坐在书桌后面。"}})
    assert job["enabled"]
    prompt = Path(job["system_prompt"]).read_text()
    assert "# Campaign continuity review" in prompt
    assert "receipts" in read_json(Path(job["cwd"]) / "request.json")
    kernel.ok("mods.configure", {"campaign": CAMPAIGN, "id": "narration-audit", "enabled": False})
    narrate(kernel, "t1-c1", "诺特点头。")
    kernel.table("player_input", text="我继续问。")
    job = kernel.ok("mods.job", {"campaign": CAMPAIGN, "role": "audit", "input": {"text": "诺特摇头。"}})
    assert not job["enabled"] or "# Campaign continuity review" not in Path(job["system_prompt"]).read_text()


def test_instructions_are_full_on_the_first_turn_and_brief_after(kernel):
    open_turn(kernel)
    first = {row["mod"]: row for row in kernel.table("capsule")["mods"]["instructions"]}
    assert all(row["form"] == "full" for row in first.values())
    assert first["story-thread"]["instruction"].startswith("# Story Thread\n")
    narrate(kernel, "t1-c1", "诺特点头。")
    kernel.table("player_input", text="我继续问。")
    later = {row["mod"]: row for row in kernel.table("capsule")["mods"]["instructions"]}
    assert set(later) == set(first)
    assert all(row["form"] == "brief" for row in later.values()), "every built-in package with instructions carries a brief"
    assert later["story-thread"]["instruction"].startswith("# Story Thread (reminder)")
    assert len(later["enhanced-items"]["instruction"]) < len(first["enhanced-items"]["instruction"]) / 3
    assert sum(len(row["instruction"].encode()) for row in later.values()) < 4000
    host = {row["mod"]: row for row in kernel.ok("mods.context", {"campaign": CAMPAIGN})["instructions"]}
    assert all(row["form"] == "full" for row in host.values()), "the host-facing context is always the full text"


def test_a_scenario_scoped_clock_is_on_the_panel_before_its_danger_is_in_the_room(kernel):
    open_turn(kernel)
    context = kernel.ok("mods.context", {"campaign": CAMPAIGN})
    # Nobody dangerous is present in Knott's office, and the pressure list says so.
    assert not any(row["kind"] == "threat" for row in kernel.table("capsule")["pressures"])
    # The book scopes this front to the scenario, so the Keeper's own instrument still carries its clocks.
    clocks = {row["clock"] for row in context["pacing"]["threat_clocks"]}
    assert clocks == {"corbitt-awareness", "landlord-impatience"}


def test_a_threat_clock_moves_only_through_apply_and_shows_what_the_book_makes_visible(kernel):
    open_turn(kernel)
    before = kernel.ok("mods.context", {"campaign": CAMPAIGN})["pacing"]["threat_clocks"]
    awareness = next(row for row in before if row["clock"] == "corbitt-awareness")
    assert awareness["state"] == "0/4" and "symptom" not in awareness, "an untouched clock stands where the book left it and shows nothing"
    assert awareness["next"], "the next segment's payoff rides beside the clock, so advancing it is an offer"
    kernel.table("apply", call_id="t1-c2", effects=[{"kind": "threat", "name": "corbitt-haunting", "clock": "corbitt-awareness", "why": "they pried at the boards"}])
    receipt = next(r for r in kernel.table("status")["receipts"] if r["kind"] == "threat")
    assert (receipt["before"], receipt["after"], receipt["segments"], receipt["full"]) == (0, 1, 4, False)
    assert receipt["shows"] and receipt["visibility"] == "keeper" and "on_full" not in receipt
    assert not any(row["kind"] == "threat" for row in kernel.table("status")["mechanics"]), "a pacing tick is Keeper-side and draws no card"
    after = next(row for row in kernel.ok("mods.context", {"campaign": CAMPAIGN})["pacing"]["threat_clocks"] if row["clock"] == "corbitt-awareness")
    assert after["state"] == "1/4" and after["symptom"] == receipt["shows"] and after["next"] != after["symptom"]
    kernel.table("apply", call_id="t1-c9", effects=[{"kind": "npc", "name": "Walter Corbitt", "to": "commission-briefing", "why": "the pressure list needs him in the room"}])
    assert next(p for p in kernel.table("capsule")["pressures"] if p["kind"] == "threat")["state"] == "1/4"
    kernel.table("apply", call_id="t1-c3", effects=[{"kind": "threat", "name": "corbitt-haunting", "clock": "corbitt-awareness", "segments": 3}])
    full = next(r for r in kernel.table("status")["receipts"] if r["kind"] == "threat" and r["after"] == 4)
    assert full["full"] and full["on_full"].startswith("Corbitt commits to murder")
    assert "next" not in next(row for row in kernel.ok("mods.context", {"campaign": CAMPAIGN})["pacing"]["threat_clocks"] if row["clock"] == "corbitt-awareness"), "a full clock has no next segment to offer"
    kernel.table("apply", call_id="t1-c4", effects=[{"kind": "threat", "name": "corbitt-haunting", "clock": "corbitt-awareness", "segments": 4}])
    assert next(r for r in kernel.table("status")["receipts"] if r["kind"] == "threat" and r["call_id"] == "t1-c4")["after"] == 4, "a clock stops at its length"


def test_a_threat_effect_names_what_it_could_not_find(kernel):
    open_turn(kernel)
    unknown = kernel.table_err("apply", call_id="t1-c1", effects=[{"kind": "threat", "name": "the weather"}])
    assert unknown["code"] == "invalid_params" and "corbitt-haunting" in unknown["details"]["options"]
    ambiguous = kernel.table_err("apply", call_id="t1-c1", effects=[{"kind": "threat", "name": "corbitt-haunting"}])
    assert sorted(ambiguous["details"]["options"]) == ["corbitt-awareness", "landlord-impatience"]
    clockless = kernel.table_err("apply", call_id="t1-c1", effects=[{"kind": "threat", "name": "cult-residue"}])
    assert clockless["code"] == "invalid_params" and "no clock" in clockless["message"]
    world = read_json(campaign_dir(kernel.workspace) / "world.json")
    assert "threat_clocks" not in world, "a refused batch writes nothing"


def test_the_offer_ledger_counts_what_was_within_reach_against_what_the_turn_took(kernel):
    open_turn(kernel)
    capsule = kernel.table("capsule")
    here = {entry["clue"] for line in capsule["mods"]["thread"]["lines"] for entry in line["here"]}
    routes = {entry["scene"] for line in capsule["mods"]["thread"]["lines"] for entry in line["next"]}
    assert here and routes, "the opening scene offers both a clue and somewhere to go"
    taken_clue = sorted(here)[0]
    kernel.table("apply", call_id="t1-c1", effects=[{"kind": "clue", "clue": taken_clue}])
    narrate(kernel, "t1-c2", "诺特把话说完。")
    rows = [json.loads(line) for line in (campaign_dir(kernel.workspace) / "telemetry.jsonl").read_text().splitlines() if line.strip()]
    ledger = next(row for row in rows if row.get("lane") == "offers" and row["turn"] == 1)
    assert ledger["closed_by"] == "narrate"
    assert f"clue-here:{taken_clue}" in ledger["offered"] and f"clue-here:{taken_clue}" in ledger["taken"]
    # Every route was within reach and none was walked: offered, not taken, which is the whole signal.
    assert {f"route:{scene}" for scene in routes} <= set(ledger["offered"])
    assert not any(name.startswith("route:") for name in ledger["taken"])
    assert set(ledger["taken"]) <= set(ledger["offered"])
    # §13.7's law holds for this lane too: the ledger is telemetry and changes no later capsule.
    kernel.table("player_input", text="我接着问。")
    again = kernel.table("capsule")
    assert {entry["scene"] for line in again["mods"]["thread"]["lines"] for entry in line["next"]}


def test_an_offer_row_carries_both_what_it_costs_and_what_it_yields(kernel):
    open_turn(kernel)
    capsule = kernel.table("capsule")
    for line in capsule["mods"]["thread"]["lines"]:
        for entry in line["here"]:
            assert entry["gate"] and entry["clue"], "a clue offer names its gate and what it is"
        for entry in line["next"]:
            assert entry["clues"] >= 1 and entry["scene"], "a route offer names where and how much is there"
    kernel.table("apply", call_id="t1-c1", effects=[{"kind": "npc", "name": "Walter Corbitt", "to": "commission-briefing", "why": "fixture"}])
    for entry in kernel.ok("mods.context", {"campaign": CAMPAIGN})["pacing"]["threat_clocks"]:
        assert entry["state"] and (entry.get("next") or entry["state"].split("/")[0] == entry["state"].split("/")[1]), \
            "a clock offer says where it stands and what the next segment would show, unless it is full"


def test_an_affordance_is_an_offer_once_it_names_what_it_yields(kernel):
    """Contract §32.5: the affordance row joined the offer ledger with its clues; it is taken when one of them lands."""
    open_turn(kernel)
    where = kernel.table("capsule")["where"]
    granted = {a["id"]: {c["clue"] for c in a.get("clues", [])} for a in where["affordances"]}
    assert granted["confirm-commission-terms"] == {"knott-commission"}
    kernel.table("apply", call_id="t1-c1", effects=[{"kind": "clue", "clue": "knott-commission"}])
    narrate(kernel, "t1-c2", "诺特把条件说清楚了。")
    rows = [json.loads(line) for line in (campaign_dir(kernel.workspace) / "telemetry.jsonl").read_text().splitlines() if line.strip()]
    ledger = next(row for row in rows if row.get("lane") == "offers" and row["turn"] == 1)
    offered = {name for name in ledger["offered"] if name.startswith("affordance:")}
    assert offered == {f"affordance:{name}" for name in granted}, ledger
    assert "affordance:confirm-commission-terms" in ledger["taken"]
    assert not any(name.startswith("affordance:") and name != "affordance:confirm-commission-terms" for name in ledger["taken"])
