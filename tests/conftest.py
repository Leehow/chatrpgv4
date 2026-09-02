"""Shared fixtures for the COC Keeper test suite."""
from __future__ import annotations

import sys

import pytest


@pytest.fixture()
def pi_review_enabled(monkeypatch):
    """Exercise the Pi agency-review path, which production no longer takes.

    `ab634acd` made normal Pi play a direct single draft and hardcoded
    `_pi_play_agency_review_required()` to False. It updated
    `test_turn_finalization.py` in the same commit, so the product decision is
    made and documented; `test_narration_budget.py` and
    `test_turn_finalization_vertical.py` were missed by that sweep.

    The machinery it gated was NOT removed: the review operation, the rewrite
    loop, the pending-draft receipt and its crash recovery all still exist and
    still run when the flag is true. Deleting the tests would leave that live
    code uncovered; rewriting them onto the direct path would only duplicate
    `test_turn_finalization.py::test_pi_play_is_direct_single_draft_and_finalizes_once_without_review`,
    which is where the production default is pinned.

    Before that commit the flag read `COC_PI_SESSION_ROLE`, so the
    `monkeypatch.setenv("COC_PI_SESSION_ROLE", "play")` several of these tests
    already carry used to be the switch. This restores what that line meant.

    It patches every loaded module holding a reference rather than a named
    list, because `coc_toolbox` imports each operation cell under a generated
    name (`coc_toolbox_..._operation_turn_output_<hex>`). A test file's own
    `coc_operation_turn_output` import is a second copy the registry never
    calls, so patching the visible modules leaves the executing one untouched
    and the fixture silently does nothing. The assert makes that failure loud.
    """
    patched = 0
    for module in list(sys.modules.values()):
        if module is None:
            continue
        if getattr(module, "_pi_play_agency_review_required", None) is not None:
            monkeypatch.setattr(
                module, "_pi_play_agency_review_required", lambda: True
            )
            patched += 1
    assert patched, "no module exposed _pi_play_agency_review_required to patch"
    return patched
