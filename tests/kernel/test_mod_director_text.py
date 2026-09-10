"""The Director and narration packages through the public RPC seam (contract §30); fixtures are not playtest evidence."""
import json
from pathlib import Path

from conftest import CAMPAIGN, create_campaign, narrate, open_turn, read_json

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
    assert any(entry["by"] == "Steven Knott" for entry in frame["handed"])
    assert thread["handed"].startswith("The book means these clues to happen")
    assert frame["missing"] == frame["of"] and "fallback" not in frame
    buried = next(line for line in lines if line["name"] == "corbitt-buried-in-basement")
    assert buried["here"] == [] and buried["next"] and buried["beyond"] >= 1 and "fallback" not in buried
    assert all(entry["clues"] >= 1 and entry["locked"].startswith("clue_discovered") for entry in buried["next"])
    assert buried["minimum_routes"] == 3
    assert len(json.dumps(thread, ensure_ascii=False).encode()) <= 3072


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
    assert next(entry for entry in capsule["mods"]["instructions"] if entry["mod"] == "narration-craft")["settings"]["routine_chars"] == 600


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
    assert "# Realisation audit" in prompt
    assert "receipts" in read_json(Path(job["cwd"]) / "request.json")
    kernel.ok("mods.configure", {"campaign": CAMPAIGN, "id": "narration-audit", "enabled": False})
    narrate(kernel, "t1-c1", "诺特点头。")
    kernel.table("player_input", text="我继续问。")
    job = kernel.ok("mods.job", {"campaign": CAMPAIGN, "role": "audit", "input": {"text": "诺特摇头。"}})
    assert not job["enabled"] or "# Realisation audit" not in Path(job["system_prompt"]).read_text()
