from conftest import (CAMPAIGN, MODULE, OPENING_SCENE, PREGEN, campaign_dir, create_campaign, git_log,
                      narrate_opening, read_json)


def test_hello_lists_content(kernel):
    result = kernel.ok("kernel.hello")
    assert result["kernel_version"]
    assert result["content"]["rulesets"] == ["coc7"]
    assert MODULE in result["content"]["modules"]


def test_create_and_list(kernel):
    assert kernel.ok("campaign.list") == {"campaigns": []}
    created = create_campaign(kernel)["campaign"]
    assert created["id"] == CAMPAIGN
    assert created["module_id"] == MODULE
    assert created["status"] == "active"
    assert created["opening_scene"] == OPENING_SCENE
    assert len(created["module_digest"]) == 64
    assert created["play_language"] == "zh-Hans"

    listed = kernel.ok("campaign.list")["campaigns"]
    assert listed == [{"id": CAMPAIGN, "title": created["title"], "module_id": MODULE,
                       "status": "active", "turn": 0}]

    error = kernel.err("campaign.create", {"id": CAMPAIGN, "module": MODULE, "pregen": PREGEN,
                                           "play_language": "zh-Hans"})
    assert error["code"] == "invalid_params"
    assert kernel.err("campaign.create", {"id": CAMPAIGN + "x", "module": "nope", "pregen": PREGEN})["code"] == "invalid_params"
    assert kernel.err("campaign.create", {"id": CAMPAIGN + "y", "module": MODULE, "pregen": "nobody"})["code"] == "invalid_params"


def test_a_telemetry_only_directory_does_not_block_creating_the_campaign(kernel):
    """Setup prepares a fresh PDF before it creates the campaign, and the reading lane writes
    `<home>/.coc/campaigns/<bound id>/telemetry.jsonl` while it does. A log directory is not a
    campaign: campaign.list, guardCampaign and campaign.read all key on `campaign.json`, so create
    must too -- otherwise the normal fresh-PDF setup order permanently locks its own campaign id."""
    directory = campaign_dir(kernel.workspace)
    directory.mkdir(parents=True, exist_ok=True)
    (directory / "telemetry.jsonl").write_text('{"lane":"reading"}\n', encoding="utf-8")
    created = create_campaign(kernel)["campaign"]
    assert created["id"] == CAMPAIGN and created["status"] == "active"
    assert (directory / "campaign.json").exists()
    assert (directory / "telemetry.jsonl").read_text(encoding="utf-8") == '{"lane":"reading"}\n'


def test_create_writes_layout_and_first_commit(kernel):
    create_campaign(kernel)
    directory = campaign_dir(kernel.workspace)
    world = read_json(directory / "world.json")
    assert world["active_scene"] == OPENING_SCENE
    assert world["visited_scenes"] == [OPENING_SCENE]
    assert world["discovered_clues"] == []
    assert world["clock"] == {"minutes": 0}
    assert world["npc_presence"]["steven-knott"] == OPENING_SCENE

    sheet = read_json(directory / "party" / f"{PREGEN}.json")
    assert sheet["skills"]["Spot Hidden"] == 55
    assert (sheet["current_hp"], sheet["current_san"], sheet["current_mp"], sheet["current_luck"]) == (
        sheet["derived"]["HP"], sheet["derived"]["SAN"], sheet["derived"]["MP"], sheet["characteristics"]["LUCK"])

    turn = read_json(directory / "turn.json")
    assert (turn["turn"], turn["state"], turn["receipts"], turn["calls"]) == (0, "awaiting_player", [], {})
    assert git_log(kernel.workspace) == [f"campaign {CAMPAIGN}: created"]


def test_open_reports_opening_needed_then_turn_zero_commits(kernel):
    create_campaign(kernel)
    opened = kernel.table("open")
    assert opened["opening_needed"] is True
    assert opened["turn"] == {"number": 0, "state": "awaiting_player"}
    assert opened["pending_turn"] is None
    assert opened["scene"] == {"name": OPENING_SCENE, "display_name": "Knott's Office"}
    investigator = opened["investigators"][0]
    assert investigator["id"] == PREGEN
    assert (investigator["hp"], investigator["san"], investigator["mp"], investigator["luck"]) == (12, 55, 11, 50)

    assert kernel.table_err("resolve", call_id="t0-c1", action={"intent": "idle"})["code"] == "turn_state"

    result = narrate_opening(kernel, "波士顿，1920 年代。\n\n诺特先生的办公室。")
    assert result["turn"] == 0
    assert result["receipt"] == "turn:0"
    assert result["rendered_text"] == "波士顿，1920 年代。\n\n诺特先生的办公室。"
    assert result["commit"]

    log = git_log(kernel.workspace)
    assert log[0] == "turn 0: 波士顿，1920 年代。 诺特先生的办公室。"
    assert log[-1] == f"campaign {CAMPAIGN}: created"

    reopened = kernel.table("open")
    assert reopened["opening_needed"] is False
    assert reopened["turn"] == {"number": 1, "state": "awaiting_player"}
    record = read_json(campaign_dir(kernel.workspace) / "turns" / "0000.json")
    assert record["commit"] == result["commit"]
    assert record["closed_by"] == "narrate"


def test_skipping_the_opening_closes_turn_zero_implicitly(kernel):
    create_campaign(kernel)
    result = kernel.table("player_input", text="我直接开口问委托的事。")
    assert result["turn"] == 1
    assert result["state"] == "open"
    record = read_json(campaign_dir(kernel.workspace) / "turns" / "0000.json")
    assert record["closed_by"] == "implicit"
    assert record["receipts"] == []
    assert kernel.table("open")["opening_needed"] is False


def test_language_shape_and_closed_vocabulary_refusals_are_actionable(kernel):
    """Open language tags are checked by shape; rule enums still offer closed options."""
    refused = kernel.err("campaign.create", {"id": CAMPAIGN, "module": MODULE, "pregen": PREGEN,
                                             "play_language": "not_a_tag"})
    assert refused["code"] == "invalid_params"
    assert refused["details"]["field"] == "play_language"
    assert refused["details"]["suggested"] == read_json(kernel.content / "languages.json")["suggested"]
    assert "options" not in refused["details"]
    assert "BCP-47" in refused["fix"]

    register = kernel.err("campaign.create", {"id": CAMPAIGN, "module": MODULE, "pregen": PREGEN,
                                              "register": "gonzo"})
    assert "purist" in register["details"]["options"]

    # Every closed vocabulary answers the same way, whichever verb it sits behind.
    create_campaign(kernel)
    for method, params, field in (
        ("table.look", {"focus": "nowhere"}, "focus"),
        ("table.lookup", {"kind": "nonsense", "name": "x"}, "kind"),
        ("table.recall", {"what": "nonsense"}, "what"),
    ):
        error = kernel.err(method, {"campaign": CAMPAIGN, **params})
        assert error["details"]["field"] == field, method
        assert len(error["details"]["options"]) > 1, method
        assert error["fix"], method
