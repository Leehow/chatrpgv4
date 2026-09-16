"""The chat bench (docs/specs/npc-voice-mask.md §4; contract §40.7): the seeded starter `voice-bench` opens
on nine people in one teahouse, the capsule keeps every one of them under present[]'s budget, and the
voice lane is offered them one by one with the masks already taken riding in each packet."""

from conftest import CAMPAIGN, narrate, narrate_opening

CAST = ["王铁柱", "周敬之", "刘桂芝", "小豆子", "赵巡长", "陈买办", "铁口张", "玛丽·斯通", "哑巴老崔"]


def create(client):
    return client.ok("campaign.create", {"id": CAMPAIGN, "module": "voice-bench", "pregen": "shen-zhiwei", "play_language": "zh-Hans"})


def test_the_bench_opens_on_nine_people_and_the_capsule_keeps_every_name(kernel):
    create(kernel)
    narrate_opening(kernel, "雨夜。三义茶馆里坐满了人。")
    capsule = kernel.table("player_input", text="我找个空位坐下，先看看屋里都有谁。")["capsule"]
    assert capsule["where"]["scene"] == "sanyi-teahouse"
    present = capsule["present"]
    assert sorted(p["name"] for p in present) == sorted(CAST)
    # Nine dossiers do not fit 3 KB; the people the cut would have dropped arrive as their name alone.
    full = [p for p in present if not p.get("truncated")]
    stubs = [p for p in present if p.get("truncated")]
    assert len(full) >= 4 and stubs and all(set(p) == {"name", "truncated"} for p in stubs)
    assert "present" in capsule["truncated"]
    assert capsule["voices"] == []
    # look focus=npc still has everyone in full.
    assert sorted(p["name"] for p in kernel.table("look", focus="npc")["present"]) == sorted(CAST)


def test_the_lane_is_offered_the_room_one_person_at_a_time_with_the_masks_taken(kernel):
    create(kernel)
    narrate_opening(kernel, "雨夜。三义茶馆里坐满了人。")
    # §40.7: the people on stage are offered from the opening on, before any player turn -- the first
    # person met is otherwise unmasked for their first answers (the real-module table, 2026-09-16).
    assert kernel.ok("voice.job", {"campaign": CAMPAIGN})["npc"]["name"] in CAST
    kernel.table("player_input", text="我找个空位坐下。")
    narrate(kernel, "t1-c1", "屋里很吵。")
    offered, masks = [], []
    while True:
        packet = kernel.ok("voice.job", {"campaign": CAMPAIGN})
        if packet["job_id"] is None:
            break
        assert packet["taken_masks"] == masks
        name = packet["npc"]["name"]
        offered.append(name)
        if name == "哑巴老崔":
            kernel.ok("voice.submit", {"campaign": CAMPAIGN, "job_id": packet["job_id"], "voice": None, "reason": "does_not_speak"})
            continue
        mask = f"{name}的面具。"
        kernel.ok("voice.submit", {"campaign": CAMPAIGN, "job_id": packet["job_id"], "voice": {"mask": mask, "exchanges": [f"{mask}一", f"{mask}二", f"{mask}三"]}})
        masks.append(mask)
    assert sorted(offered) == sorted(CAST)
    voices = kernel.table("player_input", text="我听他们说话。")["capsule"]["voices"]
    assert [v["name"] for v in voices] == [n for n in offered if n != "哑巴老崔"]
    assert all(v["mask"] == f"{v['name']}的面具。" and len(v["in exchange"]) == 3 for v in voices)
