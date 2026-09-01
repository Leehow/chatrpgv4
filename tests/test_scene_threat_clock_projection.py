"""A scene's `clock_id` references must resolve where the Keeper reads them.

Authored scenes carry pressure moves that name a threat clock and the segments
they cost:

    {"id": "pyre-lit", "cue": "火炬向柴堆逼近", "tick": 2,
     "clock_id": "clock-loop-doom", "lethal": true}

and `threat-fronts.json` defines that clock: how many segments it has, the cue
printed for each one, and what happens when it fills. Those two halves lived in
different documents and `scene.context` projected only the first, so the Keeper
was handed an id pointing at nothing — it could not see whether the clock
existed, how full it was, or what filling it meant.

It never acted on it. Across three live sessions of 《不息的渴望》 (2026-08-31
to 2026-09-01), including ~30 turns inside `scene-church-climax` — a scene
whose dramatic question is literally "before the bell rings" —
`state.threat_tick` was called zero times and `clock-loop-doom` never advanced
a segment, so the module's central mechanic, the loop reset, had no way to
fire. Information the Keeper must assemble from several documents is
information it was not given.

These tests keep the reference resolved, and keep the resolution honest: the
projection reads live progress, never invents it, and never writes.
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "plugins" / "coc-keeper" / "scripts"


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    # `@dataclass(slots=True)` resolves its own module out of sys.modules while
    # the class body runs, so registration must precede execution.
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


kernel = _load("coc_operation_kernel_threat_clock_tests", SCRIPTS / "coc_operation_kernel.py")
threat_state = _load("coc_threat_state_threat_clock_tests", SCRIPTS / "coc_threat_state.py")


FRONTS = {
    "fronts": [
        {
            "front_id": "front-loop-doom",
            "scope": "scenario",
            "severity": 3,
            "description": "时光圈的事件时间轴无情推进。",
            "dangers": [],
            "clocks": [{
                "clock_id": "clock-loop-doom",
                "segments": 6,
                "on_tick_visible": [
                    "黑影掠过满月", "北方火光渐盛", "卫兵成倍增多",
                    "庭院人声鼎沸", "钟楼方向传来脚步", "火炬已经举起",
                ],
                "on_full": "莎拉被烧死，时光圈重置",
            }],
            "scene_ids": ["scene-church-climax"],
        },
        {
            # A front this scene never points at must not be projected.
            "front_id": "front-city-watch",
            "scope": "scenario",
            "severity": 1,
            "description": "搜捕纵火犯的城市卫兵。",
            "dangers": [],
            "clocks": [{
                "clock_id": "clock-city-watch",
                "segments": 4,
                "on_full": "卫兵拘捕调查员",
            }],
            "scene_ids": ["scene-into-the-town"],
        },
    ],
}

SCENE = {
    "scene_id": "scene-church-climax",
    "pressure_moves": [
        {"id": "pyre-lit", "cue": "火炬向柴堆逼近", "tick": 2,
         "clock_id": "clock-loop-doom", "lethal": True},
        # A move with no clock must not invent one.
        {"id": "ghost-manifests", "cue": "断骨伸向亵渎者", "tick": 0},
    ],
}


class _Ctx:
    """The two things `_scene_threat_clocks` reads off a real Ctx."""

    def __init__(self, campaign_dir: Path, fronts=FRONTS):
        self.campaign_dir = campaign_dir
        self._fronts = fronts

    def scenario(self, name: str):
        assert name == "threat-fronts.json"
        return self._fronts


@pytest.fixture()
def campaign(tmp_path: Path) -> Path:
    save = tmp_path / "save"
    save.mkdir(parents=True)
    threat_state.init_threat_state(save)
    return tmp_path


def _project(campaign: Path, scene=SCENE, fronts=FRONTS):
    return kernel._scene_threat_clocks(
        _Ctx(campaign, fronts), scene, "scene-church-climax",
    )


def test_a_referenced_clock_resolves_to_its_authored_definition(campaign):
    rows = _project(campaign)
    assert [row["clock_id"] for row in rows] == ["clock-loop-doom"]
    row = rows[0]
    assert row["current_segments"] == 0
    assert row["segments"] == 6
    assert row["remaining_segments"] == 6
    assert row["full"] is False
    assert row["scene_scoped"] is True
    # The consequence is the reason the Keeper would spend a tick at all.
    assert row["on_full"] == "莎拉被烧死，时光圈重置"
    # And the cue for the segment the next tick fills.
    assert row["next_tick_cue"] == "黑影掠过满月"


def test_live_progress_is_read_not_invented(campaign):
    threat_state.tick_clock(
        campaign / "save", "clock-loop-doom", 6, source_id="pressure-pyre-lit-1",
    )
    row = _project(campaign)[0]
    assert row["current_segments"] == 1
    assert row["remaining_segments"] == 5
    assert row["next_tick_cue"] == "北方火光渐盛"


def test_a_full_clock_reports_full(campaign):
    for index in range(6):
        threat_state.tick_clock(
            campaign / "save", "clock-loop-doom", 6, source_id=f"tick-{index}",
        )
    row = _project(campaign)[0]
    assert row["full"] is True
    assert row["current_segments"] == 6
    assert row["remaining_segments"] == 0
    # Past the last authored cue there is nothing to print, and nothing is made up.
    assert row["next_tick_cue"] is None


def test_only_clocks_this_scene_names_are_projected(campaign):
    ids = {row["clock_id"] for row in _project(campaign)}
    assert "clock-city-watch" not in ids, (
        "a clock no pressure move in this scene references is noise, not a chain"
    )


def test_a_scene_with_no_clock_reference_projects_nothing(campaign):
    assert _project(campaign, scene={"pressure_moves": [
        {"id": "ghost-manifests", "cue": "断骨伸向亵渎者", "tick": 0},
    ]}) == []
    assert _project(campaign, scene=None) == []


def test_the_projection_never_writes(campaign):
    before = (campaign / "save" / "threat-state.json").read_text(encoding="utf-8")
    _project(campaign)
    after = (campaign / "save" / "threat-state.json").read_text(encoding="utf-8")
    assert before == after, "scene.context must stay a read; threat_tick is the writer"


def test_an_unreadable_front_document_never_fails_the_scene_read(campaign):
    """The dangling reference is the defect; a failed scene read is worse."""
    class _Broken(_Ctx):
        def scenario(self, name: str):
            raise RuntimeError("threat-fronts.json is unreadable")

    assert kernel._scene_threat_clocks(
        _Broken(campaign), SCENE, "scene-church-climax",
    ) == []


def test_a_scene_outside_the_front_is_marked_unscoped(campaign):
    rows = kernel._scene_threat_clocks(_Ctx(campaign), SCENE, "scene-the-mill")
    assert rows[0]["scene_scoped"] is False, (
        "the clock is still readable, but the Keeper should see it is not "
        "this scene's own front"
    )
