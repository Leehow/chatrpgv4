#!/usr/bin/env python3
"""Contracts for how much work one coordinator wakeup may claim."""
from __future__ import annotations

import importlib.util
import os
from pathlib import Path

import pytest

os.environ["COC_DISABLE_QUEUE_WORKER"] = "1"

SCRIPTS = Path("plugins/coc-keeper/scripts")
FILE_SHA = "f" * 64


def _load(name: str, rel: str):
    spec = importlib.util.spec_from_file_location(name, rel)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


assets = _load("coc_module_assets_claim_test", str(SCRIPTS / "coc_module_assets.py"))
toolbox = _load("coc_toolbox_claim_test", str(SCRIPTS / "coc_toolbox.py"))


def _ready(count: int) -> list[dict[str, object]]:
    return [
        {"job_id": f"job-{i}", "work_group_id": f"group-{i}"}
        for i in range(1, count + 1)
    ]


def _dispatch(count: int, **kwargs):
    return toolbox._source_coordinator_dispatch(
        workspace_root="/tmp/ws",
        campaign_id="camp-1",
        asset_root_id="mod-1",
        ready_background=_ready(count),
        **kwargs,
    )


def test_claim_limit_is_no_longer_capped_at_four():
    # Four was inherited from how many leaf processes could run at once, and
    # it forced a whole-book pass to drain its queue four items per round trip.
    assert assets.MAX_CLAIM_LIMIT > 4


def test_the_repository_accepts_a_batch_sized_limit():
    assets.claim_host_work_requests.__doc__  # imported symbol sanity
    with pytest.raises(assets.ModuleAssetsError):
        assets.claim_host_work_requests(
            Path("/tmp/ws"), "mod-1", executor_id="pi:test",
            limit=assets.MAX_CLAIM_LIMIT + 1,
        )
    with pytest.raises(assets.ModuleAssetsError):
        assets.claim_host_work_requests(
            Path("/tmp/ws"), "mod-1", executor_id="pi:test", limit=0,
        )


def test_a_turn_blocking_dependency_still_claims_exactly_one():
    assert assets.CURRENT_DEPENDENCY_CLAIM_LIMIT == 1


def test_a_conservative_adapter_keeps_the_small_ceiling():
    # An adapter that spawns one child per claimed group must not be handed a
    # batch it would fan out over all at once.
    dispatch = _dispatch(50)
    assert dispatch["packet"]["max_leaves"] == toolbox._CONSERVATIVE_CLAIM_CEILING


def test_the_pooled_pi_lane_claims_a_real_batch():
    dispatch = toolbox._pi_source_coordinator_dispatch(
        workspace_root="/tmp/ws",
        campaign_id="camp-1",
        asset_root_id="mod-1",
        ready_background=_ready(50),
    )
    max_leaves = dispatch["packet"]["max_leaves"]
    assert max_leaves == toolbox._PI_BACKGROUND_CLAIM_CEILING
    assert max_leaves > toolbox._CONSERVATIVE_CLAIM_CEILING
    # The claim card and the packet must agree, or the coordinator rejects it.
    prefilled = dispatch["packet"]["claim_operation"]["prefilled_arguments"]
    assert prefilled["limit"] == max_leaves


def test_a_batch_smaller_than_the_ceiling_claims_only_what_exists():
    dispatch = toolbox._pi_source_coordinator_dispatch(
        workspace_root="/tmp/ws",
        campaign_id="camp-1",
        asset_root_id="mod-1",
        ready_background=_ready(3),
    )
    assert dispatch["packet"]["max_leaves"] == 3


def test_no_lane_may_claim_past_the_repository_limit():
    with pytest.raises(ValueError):
        _dispatch(50, background_claim_ceiling=assets.MAX_CLAIM_LIMIT + 1)


def test_every_claim_ceiling_stays_inside_the_repository_limit():
    for ceiling in (
        toolbox._CONSERVATIVE_CLAIM_CEILING,
        toolbox._PI_BACKGROUND_CLAIM_CEILING,
        assets.CURRENT_DEPENDENCY_CLAIM_LIMIT,
    ):
        assert 1 <= ceiling <= assets.MAX_CLAIM_LIMIT


def test_the_advertised_pi_leaf_ceiling_matches_the_lane():
    import json
    capabilities = json.loads(
        Path("plugins/coc-keeper/references/host-capabilities.json").read_text(
            encoding="utf-8")
    )
    assert capabilities["pi"]["max_source_coordinator_leaves"] == (
        toolbox._PI_BACKGROUND_CLAIM_CEILING
    )
    # Codex still fans out over everything it claims, so its advertised
    # ceiling stays conservative.
    assert capabilities["codex"]["max_source_coordinator_leaves"] == (
        toolbox._CONSERVATIVE_CLAIM_CEILING
    )
