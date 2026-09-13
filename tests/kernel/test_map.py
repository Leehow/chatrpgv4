"""Map knowledge is canonical state; source pixels remain a host concern."""
from pathlib import Path

from conftest import OPENING_SCENE, campaign_dir, create_campaign, narrate, open_turn, read_json


MAP = "player-corbitt-house-map"
KEEPER_BASEMENT = "corbitt-house-keeper-map-basement"
PLAN_HANDOUT = "the-haunting-corbitt-house-investigator-map"
TEXT_HANDOUT = "globe-unpublished-1918"
INVESTIGATOR = "thomas-hayes"
FIXTURE = Path(__file__).parent / "fixtures/bundle-tiny/assets/map-dock.png"


def world(kernel):
    return read_json(campaign_dir(kernel.workspace) / "world.json")


def party(kernel):
    return read_json(campaign_dir(kernel.workspace) / "party" / f"{INVESTIGATOR}.json")


def install_local_map_bytes(kernel, *, keeper_basement=False):
    kernel.ok("module.register", {"module_id": "the-haunting"})
    bytes = FIXTURE.read_bytes()
    target = kernel.workspace / ".coc/modules/the-haunting/assets/player/corbitt-house-investigator-map.png"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(bytes)
    if not keeper_basement:
        return target
    basement = kernel.workspace / ".coc/modules/the-haunting/assets/source/corbitt-house-keeper-map-basement.jpg"
    basement.parent.mkdir(parents=True, exist_ok=True)
    basement.write_bytes(bytes)
    return target, basement


def reveal(regions, *, label="科比特宅邸地图", why="Seen from where they stand.", **labels):
    region_labels = labels.pop("region_labels", None) or {region: region for region in regions}
    level_labels = labels.pop("level_labels", None)
    if level_labels is None:
        levels = {
            "ground-entry-hall": "Ground Floor", "ground-living-room": "Ground Floor",
            "ground-dining-room": "Ground Floor", "ground-kitchen": "Ground Floor",
            "basement-storage": "Basement", "hidden-cellar": "Basement",
            "upper-west-bedroom": "Upper Story", "upper-middle-bedroom": "Upper Story",
            "upper-east-bedroom": "Upper Story", "upper-landing": "Upper Story",
        }
        level_labels = {levels[region]: region for region in regions if region in levels}
        level_labels = {level: level for level in level_labels}
    return {
        "kind": "map", "name": MAP, "regions": regions, "region_labels": region_labels,
        "level_labels": level_labels, "label": label, "why": why, **labels,
    }


def known_flags(kernel):
    row = next(item for item in kernel.table("look", focus="map")["maps"] if item["name"] == MAP)
    return {region["name"]: region["known"] for region in row["regions"]}


def test_map_reveal_records_only_named_regions_and_projects_a_host_view(kernel):
    target = install_local_map_bytes(kernel)
    open_turn(kernel, "我从门口往里看，记下眼前能见的门厅。")

    catalog = kernel.table("look", focus="map")
    row = next(item for item in catalog["maps"] if item["name"] == MAP)
    assert [region["name"] for region in row["regions"]] == [
        "upper-west-bedroom", "upper-middle-bedroom", "upper-east-bedroom", "upper-landing",
        "ground-entry-hall", "ground-living-room", "ground-dining-room", "ground-kitchen",
        "basement-storage", "hidden-cellar",
    ]
    assert not any(region["known"] for region in row["regions"])

    applied = kernel.table("apply", call_id="t1-c1", effects=[{
        "kind": "map", "name": MAP, "regions": ["ground-entry-hall"],
        "region_labels": {"ground-entry-hall": "一层门厅"},
        "level_labels": {"Ground Floor": "一层"},
        "label": "科比特宅邸地图", "why": "The investigators can now see the ground floor layout.",
    }])
    assert applied["receipts"] == ["map:player-corbitt-house-map-t1"]
    assert applied["map_views"][0]["available"] is True
    assert applied["map_views"][0]["render"]["layers"] == [{
        "region": "ground-entry-hall", "label": "一层门厅", "level": "一层",
        "source_asset": MAP, "placement": [0.12, 0.49, 0.93, 0.59], "source_box": [0.12, 0.49, 0.93, 0.59],
        "redactions": [], "path": str(target), "media_type": "image/png",
    }]
    state = world(kernel)
    assert state["map_knowledge"] == {MAP: ["ground-entry-hall"]}
    assert state["active_scene"] == OPENING_SCENE
    assert state["discovered_clues"] == []
    assert "handouts_shown" not in state

    current = kernel.table("look", focus="map", name=MAP)["map_views"][0]
    assert current["label"] == "科比特宅邸地图"
    assert current["regions"] == [{"id": "ground-entry-hall", "label": "一层门厅", "level": "一层"}]
    delivered = narrate(kernel, "t1-c2", "你把眼前已经确认的格局记了下来。")
    projected = next(item for item in delivered["mechanics"] if item["kind"] == "map")
    assert projected["map"] == MAP
    assert projected["regions"] == [{"id": "ground-entry-hall", "label": "一层门厅", "level": "一层"}]
    assert "path" not in projected and "render" not in projected
    assert "source_asset" not in projected and "redactions" not in projected


def test_observation_without_movement_reveals_only_the_seen_region(kernel):
    install_local_map_bytes(kernel)
    open_turn(kernel, "我站在门外，从窗户看进客厅，并不进去。")
    before = world(kernel)
    sheet = party(kernel)
    applied = kernel.table("apply", call_id="t1-c1", effects=[reveal(
        ["ground-living-room"],
        region_labels={"ground-living-room": "客厅"},
        level_labels={"Ground Floor": "一层"},
        why="They looked through the window without entering.",
    )])
    assert applied["receipts"] == ["map:player-corbitt-house-map-t1"]
    assert [layer["region"] for layer in applied["map_views"][0]["render"]["layers"]] == ["ground-living-room"]
    state = world(kernel)
    assert state["map_knowledge"] == {MAP: ["ground-living-room"]}
    assert state["active_scene"] == before["active_scene"] == OPENING_SCENE
    assert state["visited_scenes"] == before["visited_scenes"]
    assert state["clock"] == before["clock"]
    assert state["discovered_clues"] == before["discovered_clues"]
    assert party(kernel) == sheet
    flags = known_flags(kernel)
    assert flags["ground-living-room"] is True
    assert flags["ground-entry-hall"] is False and flags["hidden-cellar"] is False


def test_a_limited_plan_does_not_disclose_omitted_or_secret_regions(kernel):
    install_local_map_bytes(kernel)
    open_turn(kernel, "诺特把一张只画了底层房间的平面图推过来。")
    kernel.table("apply", call_id="t1-c1", effects=[{"kind": "handout", "name": PLAN_HANDOUT, "label": "调查员平面图"}])
    assert world(kernel)["map_knowledge"] == {}
    assert world(kernel)["handouts_shown"] == [PLAN_HANDOUT]

    applied = kernel.table("apply", call_id="t1-c2", effects=[reveal(
        ["ground-entry-hall", "ground-living-room", "ground-dining-room", "ground-kitchen"],
        region_labels={
            "ground-entry-hall": "门厅", "ground-living-room": "客厅",
            "ground-dining-room": "餐厅", "ground-kitchen": "厨房",
        },
        level_labels={"Ground Floor": "一层"},
        why="The plan shows the ground-floor rooms and omits the hidden cellar.",
    )])
    assert applied["receipts"] == ["map:player-corbitt-house-map-t1"]
    known = world(kernel)["map_knowledge"][MAP]
    assert known == ["ground-entry-hall", "ground-living-room", "ground-dining-room", "ground-kitchen"]
    assert "hidden-cellar" not in known and "basement-storage" not in known
    flags = known_flags(kernel)
    assert flags["hidden-cellar"] is False and flags["upper-landing"] is False
    view = kernel.table("look", focus="map", name=MAP)["map_views"][0]
    assert {region["id"] for region in view["regions"]} == set(known)
    assert all(layer["source_asset"] == MAP for layer in view["render"]["layers"])


def test_hearing_a_place_name_does_not_write_map_knowledge(kernel):
    install_local_map_bytes(kernel)
    open_turn(kernel, "诺特说宅子里有个隐秘地窖，但没有画出它。")
    assert world(kernel)["map_knowledge"] == {}
    assert all(known is False for known in known_flags(kernel).values())
    view = kernel.table("look", focus="map", name=MAP)["map_views"][0]
    assert view["regions"] == [] and view["available"] is False and view["render"]["layers"] == []


def test_secret_region_uses_reviewed_alternate_source_correspondence(kernel):
    player, basement = install_local_map_bytes(kernel, keeper_basement=True)
    open_turn(kernel, "我们在地下室储藏间找到暗门，这才看见隐秘地窖。")
    kernel.table("apply", call_id="t1-c1", effects=[reveal(
        ["basement-storage"],
        region_labels={"basement-storage": "地下室储藏"},
        level_labels={"Basement": "地下室"},
        why="They entered the visible basement storage.",
    )])
    assert world(kernel)["map_knowledge"] == {MAP: ["basement-storage"]}
    storage = kernel.table("look", focus="map", name=MAP)["map_views"][0]["render"]["layers"][0]
    assert storage["region"] == "basement-storage" and storage["source_asset"] == MAP
    assert storage["path"] == str(player)
    assert "hidden-cellar" not in {region["id"] for region in kernel.table("look", focus="map", name=MAP)["map_views"][0]["regions"]}
    narrate(kernel, "t1-c2", "储藏间的格局已经记下，暗门还只是一条缝。")

    kernel.table("player_input", text="我们打开暗门，走进调查员地图上没有的那间。")
    applied = kernel.table("apply", call_id="t2-c1", effects=[reveal(
        ["hidden-cellar"],
        region_labels={"hidden-cellar": "隐秘地窖"},
        level_labels={"Basement": "地下室"},
        why="They found the compartment omitted from the investigator map.",
    )])
    layer = next(item for item in applied["map_views"][0]["render"]["layers"] if item["region"] == "hidden-cellar")
    assert layer["source_asset"] == KEEPER_BASEMENT
    assert layer["path"] == str(basement) != str(player)
    assert layer["source_box"] == [0.0, 0.0, 0.58, 1.0]
    assert layer["placement"] == [0.08, 0.73, 0.48, 0.98]
    assert layer["source_box"] != layer["placement"]
    assert layer["redactions"] == [[0.4, 0.27, 0.68, 0.5], [0.12, 0.46, 0.93, 0.63]]
    assert world(kernel)["map_knowledge"][MAP] == ["basement-storage", "hidden-cellar"]
    delivered = narrate(kernel, "t2-c2", "隐秘的那一间这才出现在已经记下的格局里。")
    projected = next(item for item in delivered["mechanics"] if item["kind"] == "map")
    assert {region["id"] for region in projected["regions"]} == {"hidden-cellar"}
    assert "path" not in projected and "render" not in projected and "redactions" not in projected


def test_knowledge_is_retained_after_leaving_and_replays_idempotently(kernel):
    install_local_map_bytes(kernel)
    open_turn(kernel, "我看清门厅后离开。")
    first = kernel.table("apply", call_id="t1-c1", effects=[reveal(
        ["ground-entry-hall"],
        region_labels={"ground-entry-hall": "一层门厅"},
        level_labels={"Ground Floor": "一层"},
        why="They saw the entry hall.",
    )])
    replay = kernel.table("apply", call_id="t1-c1", effects=[reveal(
        ["ground-entry-hall"],
        region_labels={"ground-entry-hall": "一层门厅"},
        level_labels={"Ground Floor": "一层"},
        why="They saw the entry hall.",
    )])
    assert replay == {**first, "replayed": True}
    again = kernel.table("apply", call_id="t1-c2", effects=[reveal(
        ["ground-entry-hall"],
        region_labels={"ground-entry-hall": "一层门厅"},
        level_labels={"Ground Floor": "一层"},
        why="They confirm the same hall.",
    )])
    assert world(kernel)["map_knowledge"] == {MAP: ["ground-entry-hall"]}
    assert again["receipts"] == ["map:player-corbitt-house-map-t1-2"]
    kernel.table("apply", call_id="t1-c3", effects=[{"kind": "move", "to": "hall-of-records", "travel_minutes": 30}])
    assert world(kernel)["active_scene"] == "hall-of-records"
    assert world(kernel)["map_knowledge"] == {MAP: ["ground-entry-hall"]}
    current = kernel.table("look", focus="map", name=MAP)["map_views"][0]
    assert [region["id"] for region in current["regions"]] == ["ground-entry-hall"]


def test_map_apply_grants_no_movement_clue_or_item(kernel):
    install_local_map_bytes(kernel)
    open_turn(kernel, "我把看到的门厅记在脑子里。")
    handed = kernel.table("apply", call_id="t1-c1", effects=[{"kind": "handout", "name": TEXT_HANDOUT, "label": "未刊稿"}])
    authored = Path(handed["attachment"]["path"]).read_text(encoding="utf-8")
    before = world(kernel)
    sheet = party(kernel)
    applied = kernel.table("apply", call_id="t1-c2", effects=[reveal(
        ["ground-entry-hall"],
        region_labels={"ground-entry-hall": "一层门厅"},
        level_labels={"Ground Floor": "一层"},
        why="They remember the hall they already saw.",
    )])
    assert applied["receipts"] == ["map:player-corbitt-house-map-t1"]
    assert "move" not in applied["receipts"][0] and "clue" not in applied["receipts"][0]
    state = world(kernel)
    assert state["active_scene"] == before["active_scene"]
    assert state["visited_scenes"] == before["visited_scenes"]
    assert state["discovered_clues"] == before["discovered_clues"] == []
    assert state["handouts_shown"] == before["handouts_shown"] == [TEXT_HANDOUT]
    assert state["clock"] == before["clock"]
    assert party(kernel) == sheet
    path = campaign_dir(kernel.workspace) / "handouts" / f"{TEXT_HANDOUT}.md"
    assert path.read_text(encoding="utf-8") == authored


def test_bad_map_region_rolls_back_the_entire_apply_batch(kernel):
    install_local_map_bytes(kernel)
    open_turn(kernel)
    before = world(kernel)
    error = kernel.table_err("apply", call_id="t1-c1", effects=[
        {"kind": "time", "minutes": 30},
        {"kind": "map", "name": MAP, "regions": ["secret-attic"], "label": "地图", "region_labels": {"secret-attic": "阁楼"}, "level_labels": {}, "why": "Guessed."},
        {"kind": "clue", "clue": "knott-commission"},
    ])
    assert error["code"] == "unknown_entity"
    assert world(kernel) == before

    unlabeled = kernel.table_err("apply", call_id="t1-c2", effects=[{
        "kind": "map", "name": MAP, "regions": ["ground-entry-hall"], "label": "地图",
        "region_labels": {}, "level_labels": {}, "why": "Seen.",
    }])
    assert unlabeled["code"] == "invalid_params"
    assert world(kernel) == before


def test_map_knowledge_is_campaign_scoped(kernel):
    install_local_map_bytes(kernel)
    open_turn(kernel)
    kernel.table("apply", call_id="t1-c1", effects=[{
        "kind": "map", "name": MAP, "regions": ["ground-entry-hall"], "label": "宅邸地图", "region_labels": {"ground-entry-hall": "一层门厅"}, "level_labels": {"Ground Floor": "一层"}, "why": "Seen from the entry.",
    }])

    create_campaign(kernel, "other-table")
    assert read_json(campaign_dir(kernel.workspace, "other-table") / "world.json")["map_knowledge"] == {}
