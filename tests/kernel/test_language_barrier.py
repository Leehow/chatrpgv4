"""Language policy wiring over the real TS RPC; not a simulated play acceptance."""

import json
from pathlib import Path

from conftest import read_json
from test_mod_vocabulary import (
    apply_dossier, built_module, emitted_client, open_turn, played, table_npcs, words,
)


def test_unknown_language_policy_reaches_both_instruction_forms_and_ordinary_audit(tmp_path):
    client = emitted_client(tmp_path / "ws")
    try:
        mid, _ = built_module(client, tmp_path, {"agenda": "Sell fuel."})
        campaign = played(client, tmp_path, mid)
        root = client.workspace / ".coc" / "campaigns" / campaign
        sheet_path = next((root / "party").glob("*.json"))
        sheet = read_json(sheet_path)
        sheet["own_language"] = "Chinese"
        sheet["skills"]["Language (Own)"] = 50
        sheet["skills"]["Language (Other: English)"] = 1
        sheet_path.write_text(json.dumps(sheet))
        # Only Natural NPC supplies this audit: do not borrow another Mod's source bundle.
        active = read_json(root / "world.json")["mods"]["active"]
        for mod in active:
            if mod != "natural-npc":
                client.ok("mods.configure", {"campaign": campaign, "id": mod, "enabled": False})
        open_turn(client, campaign)
        assert words(client, campaign)["language"]["bound"] is True
        assert "speaks" not in table_npcs(client, campaign)["Tenant"]
        full = next(row for row in client.ok("table.capsule", {"campaign": campaign})["mods"]["instructions"]
                    if row["mod"] == "natural-npc")
        assert full["form"] == "full"
        assert "Missing `speaks` means unknown" in full["instruction"]
        assert "What the player writes is what the investigator means" in full["instruction"]
        view = client.ok("table.look", {"campaign": campaign, "focus": "investigator"})
        assert view["skills"]["Language (Other: English)"] == 1

        job = client.ok("mods.job", {"campaign": campaign, "role": "audit", "input": {
            "text": "The tenant answers the whole question fluently."}})
        assert job["enabled"], "ordinary conversation must not need a first-impression roll"
        packet = read_json(Path(job["cwd"]) / "request.json")
        assert packet["receipts"] == []
        assert packet["player_text"] == "I try talking to them."
        assert packet["party"][0]["skills"]["Language (Other: English)"] == 1
        assert "speaks" not in next(row for row in packet["present"] if row["name"] == "Tenant")
        prompt = Path(job["system_prompt"]).read_text()
        assert "do not skip a fluent exchange" in prompt
        assert "request.present" in prompt
        assert "Player words are intent" in prompt
        assert "source_review" not in packet and "continuity_review" not in packet

        client.ok("table.narrate", {"campaign": campaign, "call_id": "t1-c1",
                                    "text": "The tenant points to the pump."})
        open_turn(client, campaign)
        brief = next(row for row in client.ok("table.capsule", {"campaign": campaign})["mods"]["instructions"]
                     if row["mod"] == "natural-npc")
        assert brief["form"] == "brief"
        assert "Missing `speaks` is unknown, not shared fluency" in brief["instruction"]
        assert "Player words are intent, not fluent speech" in brief["instruction"]
        assert "Language values limit both directions" in brief["instruction"]
    finally:
        client.close()


def test_established_language_reaches_keeper_and_auditor_without_rewriting_source(tmp_path):
    client = emitted_client(tmp_path / "ws")
    try:
        mid, _ = built_module(client, tmp_path, {"agenda": "Sell fuel."})
        campaign = played(client, tmp_path, mid)
        open_turn(client, campaign)
        apply_dossier(client, campaign, "Tenant", {"language": "English"},
                      why="The exchange establishes English as the working language.")
        assert table_npcs(client, campaign)["Tenant"]["speaks"] == "English"
        job = client.ok("mods.job", {"campaign": campaign, "role": "audit", "input": {
            "text": "The tenant waits while the visitor searches for a word."}})
        packet = read_json(Path(job["cwd"]) / "request.json")
        assert next(row for row in packet["present"] if row["name"] == "Tenant")["speaks"] == "English"
        client.ok("table.narrate", {"campaign": campaign, "call_id": "t1-c2",
                                    "text": "The tenant waits."})
        client.ok("mods.configure", {"campaign": campaign, "id": "natural-npc", "enabled": False})
        assert "speaks" not in table_npcs(client, campaign)["Tenant"]
        client.ok("mods.configure", {"campaign": campaign, "id": "natural-npc", "enabled": True})
        assert table_npcs(client, campaign)["Tenant"]["speaks"] == "English"
    finally:
        client.close()
