"""§14.4 for a bound book: the world starts at the first setup call that finds the graph,
and setup.steps {campaign} tells a restarted setup process what is already done."""

from conftest import CAMPAIGN, MODULE, campaign_dir, read_json
from module_helpers import TINY_ID, bind_tiny, module_dir, packet_for, reader_shard, review, write_shard


def _build(kernel, tmp_path):
    bind_tiny(kernel, tmp_path)
    kernel.ok("module.plan", {"module_id": TINY_ID})
    packet, work_dir = packet_for(kernel, "section-01")
    write_shard(work_dir, reader_shard(packet))
    assert review(kernel, "section-01")["accepted"]
    kernel.ok("module.accept", {"module_id": TINY_ID, "section_id": "section-01"})
    kernel.ok("module.assemble", {"module_id": TINY_ID})


def test_bound_book_campaign_gets_its_world_when_the_graph_arrives(kernel, tmp_path):
    bind_tiny(kernel, tmp_path)
    kernel.ok("module.plan", {"module_id": TINY_ID})
    kernel.ok("campaign.create", {"id": CAMPAIGN, "module": TINY_ID, "play_language": "zh-Hans"})
    assert read_json(campaign_dir(kernel.workspace) / "campaign.json")["status"] == "setting_up"
    assert not (campaign_dir(kernel.workspace) / "world.json").exists()
    # before the graph exists the resume view already knows the lane
    resume = kernel.ok("setup.steps", {"campaign": CAMPAIGN})
    assert resume["completed"] == ["choose-source", "build-bundle", "bind-source", "create-campaign"]
    assert resume["state"]["module_id"] == TINY_ID and resume["state"]["source"]["kind"] == "pdf"
    occupation = kernel.ok("setup.occupations", {"campaign": CAMPAIGN})["occupations"][0]["id"]
    # no graph yet: the investigator can still be made, the world is not started
    kernel.ok("setup.investigator", {"campaign": CAMPAIGN, "name": "Marcus", "occupation": occupation, "seed": 3})
    assert not (campaign_dir(kernel.workspace) / "world.json").exists()
    # the graph lands; the next setup call starts the world
    packet, work_dir = packet_for(kernel, "section-01")
    write_shard(work_dir, reader_shard(packet))
    assert review(kernel, "section-01")["accepted"]
    kernel.ok("module.accept", {"module_id": TINY_ID, "section_id": "section-01"})
    kernel.ok("module.assemble", {"module_id": TINY_ID})
    resume = kernel.ok("setup.steps", {"campaign": CAMPAIGN})
    assert "build-opening" in resume["completed"] and "create-investigator" in resume["completed"]
    done = kernel.ok("setup.complete", {"campaign": CAMPAIGN})
    assert done["status"] == "ready_for_table"
    world = read_json(campaign_dir(kernel.workspace) / "world.json")
    meta = read_json(campaign_dir(kernel.workspace) / "campaign.json")
    assert world["active_scene"] == meta["opening_scene"] and meta["module_digest"]
    opened = kernel.table("open")
    assert opened["campaign"]["status"] == "active"
    assert kernel.ok("setup.steps", {"campaign": CAMPAIGN})["completed"][-1] == "complete"


def test_steps_resume_for_a_starter_and_an_unknown_campaign(kernel):
    assert "completed" not in kernel.ok("setup.steps", {})
    unknown = kernel.ok("setup.steps", {"campaign": "nobody"})
    assert unknown["completed"] == [] and unknown["state"] == {"campaign": "nobody"}
    kernel.ok("campaign.create", {"id": CAMPAIGN, "module": "the-haunting", "play_language": "zh-Hans"})
    resume = kernel.ok("setup.steps", {"campaign": CAMPAIGN})
    assert resume["completed"] == ["choose-source", "create-campaign"]
    assert resume["state"]["source"] == {"kind": "starter", "module_id": "the-haunting"}


# ---- §20.7: the third setup source -- an already-installed, non-starter module -----------


def test_module_source_reuses_an_installed_book_and_skips_the_build_lane(kernel, tmp_path):
    """§20.7: a module already `installed` (built once, in a past campaign's setup) can
    be handed straight to `campaign.create` -- the third setup source, `module`, whose
    whole point is skipping `build-bundle`/`bind-source`/`build-opening` entirely,
    rather than genuinely running them like the `pdf` source does (the test above).
    `content/setup/steps.json`'s `only_for: "pdf"` on those three steps is what already
    excludes them for any other source kind -- no new data is written for `module`,
    only added to `sources` (contract §20.7, "put the skip in the data")."""
    _build(kernel, tmp_path)  # TINY_ID is now assembled, with a graph, in the module store
    kernel.ok("module.install", {"module_id": TINY_ID})  # -> status: installed (module.list's own bar for §20.7)
    assert read_json(module_dir(kernel.workspace, TINY_ID) / "module.json")["status"] == "installed"

    second = "second-camp"
    created = kernel.ok("campaign.create", {"id": second, "module": TINY_ID, "play_language": "zh-Hans"})["campaign"]
    assert created["status"] == "setting_up" and created["investigators"] == []
    # the graph already existed: campaign.create starts the world immediately (kernel/coc/table.py),
    # unlike the pdf lane's first campaign above, which has no world until the book is built.
    assert created["opening_scene"]
    assert (campaign_dir(kernel.workspace, second) / "world.json").exists()

    resume = kernel.ok("setup.steps", {"campaign": second})
    assert resume["completed"] == ["choose-source", "create-campaign"]
    assert resume["state"]["source"] == {"kind": "module", "module_id": TINY_ID}

    occupation = kernel.ok("setup.occupations", {"campaign": second})["occupations"][0]["id"]
    kernel.ok("setup.investigator", {"campaign": second, "name": "Reused", "occupation": occupation, "seed": 9})
    handoff = kernel.ok("setup.complete", {"campaign": second})
    assert handoff["status"] == "ready_for_table" and handoff["module_id"] == TINY_ID

    opened = kernel.table("open", campaign=second)
    assert opened["campaign"]["status"] == "active"


# ---- §21.5: the setup entry point for the investigator library ---------------------------


def test_investigator_source_reuses_a_saved_card_and_skips_occupation_and_points(kernel):
    """§21.5: a card built through setup.investigator in one campaign, saved to the
    library, then loaded straight into a second campaign's setup instead of building a
    new one -- no occupation, no point allocation, no create-investigator call at all.
    setup.steps reports the library lane done and the new-investigator lane not
    applicable; the mirror image of test_module_source_reuses_an_installed_book_and_
    skips_the_build_lane above, on the second, independent axis (contract §21.5)."""
    first = "first-camp"
    kernel.ok("campaign.create", {"id": first, "module": MODULE, "play_language": "en"})
    made = kernel.ok("setup.investigator", {"campaign": first, "name": "Marlowe", "occupation": "Journalist", "seed": "lib-1"})
    kernel.ok("setup.complete", {"campaign": first})
    saved = kernel.ok("investigator.save", {"campaign": first})
    library_id = saved["library_id"]

    second = "second-camp"
    kernel.ok("campaign.create", {"id": second, "module": MODULE, "play_language": "en"})
    # what the table's browse-library/load-investigator pair does: list, then load by id.
    listed = kernel.ok("investigator.list", {})["investigators"]
    assert library_id in [row["library_id"] for row in listed]
    loaded = kernel.ok("investigator.load", {"campaign": second, "library_id": library_id})

    source = read_json(campaign_dir(kernel.workspace, first) / "party" / f"{made['investigator']['id']}.json")
    target = read_json(campaign_dir(kernel.workspace, second) / "party" / f"{loaded['investigator']['id']}.json")

    def without_id_and_origin(sheet):
        return {k: v for k, v in sheet.items() if k not in ("id", "origin")}

    # byte-identical apart from id and origin: no conversion, no re-roll (contract §21.3).
    # (the two campaigns are separate directories, so the id happening to coincide --
    # both are the first investigator in an otherwise empty party -- is not a collision.)
    assert without_id_and_origin(source) == without_id_and_origin(target)
    # `investigator.save` stamped the source sheet's origin (no `loaded_at_turn`); `load`
    # stamps the target's differently (`loaded_at_turn` added) -- the two origins differ.
    assert source["origin"] == {"library_id": library_id}
    assert target["origin"] == {"library_id": library_id, "loaded_at_turn": 0}

    # the setup table sees the library lane, not the new-investigator lane: occupation
    # and point allocation were skipped, so create-investigator reports not applicable
    # rather than merely undone (contract §21.5's "not applicable" vs. "missing").
    resume = kernel.ok("setup.steps", {"campaign": second})
    assert "browse-library" in resume["completed"] and "load-investigator" in resume["completed"]
    assert "create-investigator" not in resume["completed"]

    handoff = kernel.ok("setup.complete", {"campaign": second})
    assert handoff["status"] == "ready_for_table" and handoff["investigators"] == [loaded["investigator"]["id"]]
    opened = kernel.table("open", campaign=second)
    assert opened["campaign"]["status"] == "active"
