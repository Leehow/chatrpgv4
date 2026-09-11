"""Contract §26 Guided Creation: the exchange is a form. The package declares slots, the kernel
keeps the notes; the host computes the move (tested on the extension side)."""
from conftest import CAMPAIGN


def begin(kernel):
    kernel.ok("campaign.create", {"id": CAMPAIGN, "module": "the-haunting", "play_language": "zh-Hans"})


def test_the_package_declares_its_slots_and_the_setup_context_carries_them(kernel):
    begin(kernel)
    context = kernel.ok("mods.context", {"campaign": CAMPAIGN})
    slots = {row["id"]: row for row in context["slots"]}
    assert set(slots) >= {"trade", "built_for", "known_for", "not_good_at"}
    assert all(row["mod"] == "guided-creation" for row in slots.values())
    assert slots["built_for"]["required"] and not slots["not_good_at"]["required"]
    assert slots["built_for"]["purpose"] and slots["built_for"]["ask"]


def test_notes_are_kept_by_the_kernel_and_returned_with_the_steps(kernel):
    begin(kernel)
    first = kernel.ok("setup.note", {"campaign": CAMPAIGN, "slot": "trade", "value": "屠夫，落在 Farmer 一栏"})
    assert first["notes"]["slots"]["trade"] == {"value": "屠夫，落在 Farmer 一栏", "origin": "player", "turn": 0}
    assert first["notes"]["turns"] == 0
    advanced = kernel.ok("setup.note", {"campaign": CAMPAIGN, "advance": True})
    assert advanced["notes"]["turns"] == 1
    second = kernel.ok("setup.note", {"campaign": CAMPAIGN, "slot": "built_for", "value": "膀子力气", "origin": "concept"})
    assert second["notes"]["slots"]["built_for"] == {"value": "膀子力气", "origin": "concept", "turn": 1}
    state = kernel.ok("setup.steps", {"campaign": CAMPAIGN})["state"]
    assert state["notes"] == second["notes"], "a resumed session reads the same notes"


def test_a_note_names_an_active_slot_or_stop_and_a_real_origin(kernel):
    begin(kernel)
    unknown = kernel.err("setup.note", {"campaign": CAMPAIGN, "slot": "mood", "value": "grumpy"})
    assert unknown["code"] == "needs" and "stop" in unknown["details"]["options"] and "built_for" in unknown["details"]["options"]
    assert kernel.err("setup.note", {"campaign": CAMPAIGN, "slot": "trade", "value": "   "})["code"] == "invalid_params"
    assert kernel.err("setup.note", {"campaign": CAMPAIGN, "slot": "trade", "value": "x" * 401})["code"] == "invalid_params"
    assert kernel.err("setup.note", {"campaign": CAMPAIGN, "slot": "trade", "value": "ok", "origin": "keeper"})["code"] == "invalid_params"
    assert kernel.err("setup.note", {"campaign": CAMPAIGN, "slot": "stop", "value": "现在出卡", "origin": "concept"})["code"] == "invalid_params"
    assert kernel.err("setup.note", {"campaign": CAMPAIGN, "slot": "trade", "value": "ok", "advance": True})["code"] == "invalid_params"
    stopped = kernel.ok("setup.note", {"campaign": CAMPAIGN, "slot": "stop", "value": "现在出卡"})
    assert stopped["notes"]["slots"]["stop"]["origin"] == "player"


def test_without_the_package_there_are_no_slots_and_no_notes(kernel):
    begin(kernel)
    kernel.ok("mods.configure", {"campaign": CAMPAIGN, "id": "guided-creation", "enabled": False})
    assert kernel.ok("mods.context", {"campaign": CAMPAIGN})["slots"] == []
    refused = kernel.err("setup.note", {"campaign": CAMPAIGN, "slot": "built_for", "value": "力气"})
    assert refused["code"] == "needs" and refused["details"]["options"] == ["stop"]
