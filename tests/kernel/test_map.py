"""Map knowledge is canonical state; source pixels remain a host concern."""
from pathlib import Path

from conftest import campaign_dir, create_campaign, narrate, narrate_opening, open_turn, read_json


MAP = "player-corbitt-house-map"


def install_local_map_bytes(kernel):
    kernel.ok("module.register", {"module_id": "the-haunting"})
    source = Path(__file__).parent / "fixtures/bundle-tiny/assets/map-dock.png"
    target = kernel.workspace / ".coc/modules/the-haunting/assets/player/corbitt-house-investigator-map.png"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(source.read_bytes())
    return target


def test_map_reveal_records_only_named_regions_and_projects_a_host_view(kernel):
    target = install_local_map_bytes(kernel)
    open_turn(kernel, "我走进一层门厅，看看眼前能见的布局。")

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
        "placement": [0.12, 0.49, 0.93, 0.59], "source_box": [0.12, 0.49, 0.93, 0.59],
        "redactions": [], "path": str(target), "media_type": "image/png",
    }]
    assert read_json(campaign_dir(kernel.workspace) / "world.json")["map_knowledge"] == {MAP: ["ground-entry-hall"]}

    current = kernel.table("look", focus="map", name=MAP)["map_views"][0]
    assert current["label"] == "科比特宅邸地图"
    assert current["regions"] == [{"id": "ground-entry-hall", "label": "一层门厅", "level": "一层"}]
    delivered = narrate(kernel, "t1-c2", "你把眼前已经确认的格局记了下来。")
    projected = next(item for item in delivered["mechanics"] if item["kind"] == "map")
    assert projected["map"] == MAP
    assert projected["regions"] == [{"id": "ground-entry-hall", "label": "一层门厅", "level": "一层"}]
    assert "path" not in projected and "render" not in projected


def test_bad_map_region_rolls_back_the_entire_apply_batch(kernel):
    install_local_map_bytes(kernel)
    open_turn(kernel)
    before = read_json(campaign_dir(kernel.workspace) / "world.json")
    error = kernel.table_err("apply", call_id="t1-c1", effects=[
        {"kind": "time", "minutes": 30},
        {"kind": "map", "name": MAP, "regions": ["secret-attic"], "label": "地图", "region_labels": {"secret-attic": "阁楼"}, "level_labels": {}, "why": "Guessed."},
    ])
    assert error["code"] == "unknown_entity"
    assert read_json(campaign_dir(kernel.workspace) / "world.json") == before

    unlabeled = kernel.table_err("apply", call_id="t1-c2", effects=[{
        "kind": "map", "name": MAP, "regions": ["ground-entry-hall"], "label": "地图",
        "region_labels": {}, "level_labels": {}, "why": "Seen.",
    }])
    assert unlabeled["code"] == "invalid_params"
    assert read_json(campaign_dir(kernel.workspace) / "world.json") == before


def test_map_knowledge_is_campaign_scoped(kernel):
    install_local_map_bytes(kernel)
    open_turn(kernel)
    kernel.table("apply", call_id="t1-c1", effects=[{
        "kind": "map", "name": MAP, "regions": ["ground-entry-hall"], "label": "宅邸地图", "region_labels": {"ground-entry-hall": "一层门厅"}, "level_labels": {"Ground Floor": "一层"}, "why": "Seen from the entry.",
    }])

    create_campaign(kernel, "other-table")
    assert read_json(campaign_dir(kernel.workspace, "other-table") / "world.json")["map_knowledge"] == {}
