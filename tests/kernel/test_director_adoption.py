"""§13.7: a beat followed inside a session counts even when no session receipt lands."""

from conftest import narrate, campaign_dir, open_turn, read_json
from test_rules_families import resolve, walk_to_confrontation


def test_subsystem_adoption_counts_rolls_made_inside_the_session(seeded_kernel):
    open_turn(seeded_kernel, "我对科比特开枪。")
    n = walk_to_confrontation(seeded_kernel)
    attack = resolve(seeded_kernel, f"t1-c{n}", intent="combat", goal="开枪", method="举枪就射",
                     target="Walter Corbitt", weapon=".38 Revolver")
    assert attack["session"]["kind"] == "combat"
    narrate(seeded_kernel, f"t1-c{n + 1}", "枪响。")

    # Next turn: the override says SUBSYSTEM; the keeper settles the NPC's defence — a roll
    # inside the session, no session receipt at all.
    seeded_kernel.table("player_input", text="我再开一枪。")
    capsule = read_json(campaign_dir(seeded_kernel.workspace) / "turn.json")["capsule"]
    assert capsule["director"]["beat"] == "SUBSYSTEM" and capsule["director"]["override"] == "session"
    defend = resolve(seeded_kernel, "t2-c1", intent="combat", goal="硬吃这一枪", method="不躲",
                     actor="Walter Corbitt", target="thomas-hayes", defense="none", weapon="unarmed")
    assert not any(r.startswith("session:") for r in defend["receipts"])
    narrate(seeded_kernel, "t2-c2", "他没有躲。")
    record = read_json(campaign_dir(seeded_kernel.workspace) / "turns" / "0002.json")
    adoption = record["director_adoption"]
    assert adoption["beat"] == "SUBSYSTEM" and adoption["adopted"] is True
    assert adoption["evidence"] and all(e.startswith("roll:") for e in adoption["evidence"])
