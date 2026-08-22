"""Narration budget + control-override ownership surface (phase 4)."""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
SCRIPTS = REPO / "plugins" / "coc-keeper" / "scripts"
PYTHON = sys.executable


def _load(name: str, rel: str | Path):
    path = Path(rel)
    if not path.is_absolute():
        path = REPO / path
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


coc_toolbox = _load("coc_toolbox_narration_budget", SCRIPTS / "coc_toolbox.py")
coc_starter = _load("coc_starter_narration_budget", SCRIPTS / "coc_starter.py")


def _write_json(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _read_jsonl(path: Path) -> list[dict]:
    if not path.is_file():
        return []
    return [
        json.loads(raw)
        for raw in path.read_text(encoding="utf-8").splitlines()
        if raw.strip()
    ]


@pytest.fixture()
def campaign_ws(tmp_path: Path):
    workspace = tmp_path / "workspace"
    coc_root = workspace / ".coc"
    campaign_id = "narration-budget-test"
    _write_json(
        coc_root / "runtime.json",
        {
            "schema_version": 2,
            "planner": {"kind": "deterministic"},
            "rules": {"kind": "deterministic"},
            "narrator": {"kind": "template"},
            "player": {"kind": "human"},
        },
    )
    quick = coc_starter.quick_start(
        coc_root,
        "the-haunting",
        "thomas-hayes",
        campaign_id=campaign_id,
        title="Narration Budget Test",
    )
    return {
        "workspace": workspace,
        "coc_root": coc_root,
        "campaign_id": campaign_id,
        "campaign_dir": Path(quick["campaign_dir"]),
        "investigator_id": quick["investigator_id"],
        "quick": quick,
    }


def _run(ws, tool: str, args: dict | None = None) -> dict:
    result = coc_toolbox.run_tool(
        tool, ws["workspace"], ws["campaign_id"], dict(args or {})
    )
    assert isinstance(result, dict)
    return result


def _brief(ws, applied_events: list[dict] | None = None) -> dict:
    return _run(
        ws,
        "narration.brief",
        {
            "candidate_plan": {},
            "investigator": ws["investigator_id"],
            "applied_events": applied_events or [],
        },
    )


def test_budget_modes_from_turn_signals(campaign_ws):
    routine = _brief(campaign_ws)
    assert routine["ok"] is True, routine
    assert routine["data"]["budget"] == {
        "mode": "routine_resolution",
        "max_chars": 350,
        "max_paragraphs": 2,
    }

    costly = _brief(campaign_ws, [{"event_type": "hp_change"}])
    assert costly["data"]["budget"]["mode"] == "costly_result"
    assert costly["data"]["budget"]["max_chars"] == 550

    reveal = _brief(campaign_ws, [{"event_type": "scene_transition"}])
    assert reveal["data"]["budget"]["mode"] == "reveal_or_transition"
    assert reveal["data"]["budget"]["max_chars"] == 900

    ending = _brief(campaign_ws, [{"event_type": "session_ending"}])
    assert ending["data"]["budget"]["mode"] == "climax_or_madness"
    assert ending["data"]["budget"]["max_chars"] == 1500


def _trigger_bout(ws) -> None:
    result = _run(
        ws,
        "rules.sanity_check",
        {
            "investigator": ws["investigator_id"],
            "source": "the thing in the dark lunges",
            "loss_success": "0",
            "loss_failure": "5",
            "decision_id": "san-bout-for-budget",
            "seed": 10,
        },
    )
    assert result["ok"] is True, result
    assert result["data"]["bout_active"] is True


def test_control_overrides_reflect_active_bout_and_unconscious(campaign_ws):
    plain = _brief(campaign_ws)
    assert plain["data"]["control_overrides"] == []
    assert any("no active control override" in hint for hint in plain["hints"])

    _trigger_bout(campaign_ws)
    bout = _brief(campaign_ws)
    overrides = bout["data"]["control_overrides"]
    assert len(overrides) == 1
    assert overrides[0]["override_type"] == "bout_of_madness"
    assert overrides[0]["bout_rounds_remaining"] == 10
    assert overrides[0]["override_id"]
    assert overrides[0]["subject_ref"] == f"pc:{campaign_ws['investigator_id']}"
    assert overrides[0]["source_ref"].startswith("sanity_bout:")
    assert overrides[0]["active"] is True
    assert overrides[0]["expiry"] == {"kind": "rounds_remaining", "value": 10}
    assert bout["data"]["budget"]["mode"] == "climax_or_madness"
    assert any("ONLY within the listed control_overrides" in hint for hint in bout["hints"])

    state_path = (
        campaign_ws["campaign_dir"]
        / "save"
        / "investigator-state"
        / f"{campaign_ws['investigator_id']}.json"
    )
    state = json.loads(state_path.read_text(encoding="utf-8"))
    state["bout_active"] = False
    state["conditions"] = ["unconscious"]
    _write_json(state_path, state)
    # Drop the sanity snapshot's bout flag too so only the condition drives it.
    sanity_path = (
        campaign_ws["campaign_dir"]
        / "save"
        / "sanity-state"
        / f"{campaign_ws['investigator_id']}.json"
    )
    snapshot = json.loads(sanity_path.read_text(encoding="utf-8"))
    snapshot["bout_active"] = False
    _write_json(sanity_path, snapshot)

    unconscious = _brief(campaign_ws)
    types = {row["override_type"] for row in unconscious["data"]["control_overrides"]}
    assert types == {"unconscious"}
    assert unconscious["data"]["control_overrides"][0]["expiry"]["kind"] == "condition_cleared"


def test_review_records_deterministic_over_length(campaign_ws):
    journal = _run(
        campaign_ws,
        "state.journal",
        {
            "summary": "调查员等待门外的动静。",
            "player_action": "等待",
            "player_text": "我在门边等待。",
            "run_id": "review-run",
            "decision_id": "journal-review",
        },
    )
    assert journal["ok"] is True, journal
    context = _run(campaign_ws, "turn.output_context")["data"]
    long_draft = "雨敲着窗。" * 200  # 1000 chars, far beyond 2x routine budget
    reviewed = _run(
        campaign_ws,
        "narration.review",
        {
            "draft_text": long_draft,
            "turn_id": context["turn_id"],
            "source_digest": context["source_digest"],
            "revision": 1,
            "decision_id": "review-long",
        },
    )
    assert reviewed["ok"] is True, reviewed
    findings = reviewed["data"]["findings"]
    assert any(row["rule_id"] == "over_length" for row in findings)
    assert reviewed["data"]["recommendation"] == "consider_revision"
    assert reviewed["data"]["draft_sha256"].startswith("sha256:")
    assert reviewed["data"]["review_id"].startswith("narration-review-v1:")

    reviews = _read_jsonl(
        campaign_ws["campaign_dir"] / "logs" / "narration-reviews.jsonl"
    )
    assert len(reviews) == 1
    assert reviews[0]["findings"][-1]["rule_id"] == "over_length"

    short = _run(
        campaign_ws,
        "narration.review",
        {
            "draft_text": "门缝里渗进一线灯光。",
            "turn_id": context["turn_id"],
            "source_digest": context["source_digest"],
            "revision": 1,
            "decision_id": "review-short",
        },
    )
    assert short["ok"] is True
    assert short["data"]["findings"] == []
    assert short["data"]["recommendation"] == "no_revision_suggested"

    conflict = _run(
        campaign_ws,
        "narration.review",
        {
            "draft_text": "另一份草稿。",
            "turn_id": context["turn_id"],
            "source_digest": context["source_digest"],
            "revision": 1,
            "decision_id": "review-short",
        },
    )
    assert conflict["ok"] is False
    assert conflict["error"]["code"] == "idempotency_conflict"

    wrong_source = _run(
        campaign_ws,
        "narration.review",
        {
            "draft_text": "错误来源。",
            "turn_id": context["turn_id"],
            "source_digest": "sha256:wrong",
            "revision": 1,
            "decision_id": "review-wrong-source",
        },
    )
    assert wrong_source["ok"] is False
    assert wrong_source["error"]["code"] == "turn_source_changed"

    finalized = _run(
        campaign_ws,
        "turn.finalize",
        {
            "draft": long_draft,
            "coverage": [],
            "mechanics_placements": [],
            "revision": 1,
            "narration_review_id": reviewed["data"]["review_id"],
            "decision_id": "finalize-reviewed",
        },
    )
    assert finalized["ok"] is True, finalized
    assert finalized["data"]["narration_review"] == {
        "review_id": reviewed["data"]["review_id"],
        "review_digest": reviewed["data"]["review_digest"],
    }
