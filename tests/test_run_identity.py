"""Canonical table-run identity is persisted by the runtime, not a harness."""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
SCRIPTS = REPO / "plugins" / "coc-keeper" / "scripts"


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


coc_toolbox = _load("coc_toolbox_run_identity", SCRIPTS / "coc_toolbox.py")
coc_starter = _load("coc_starter_run_identity", SCRIPTS / "coc_starter.py")
coc_state = coc_toolbox.coc_state
coc_host_context = coc_toolbox.coc_host_context
coc_rulesets = coc_toolbox.coc_rulesets

REQUIRED_FIELDS = (
    "campaign_id",
    "run_segment_id",
    "session_id",
    "plugin_version",
    "ruleset_id",
    "ruleset_version",
)


def _write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def _seed_campaign(root: Path, campaign_id: str = "identity-camp") -> Path:
    coc_state.create_campaign(root, campaign_id, "Run Identity", era="1920s")
    return root / ".coc" / "campaigns" / campaign_id


def _quick_workspace(tmp_path: Path) -> dict[str, object]:
    workspace = tmp_path / "workspace"
    coc_root = workspace / ".coc"
    campaign_id = "identity-play"
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
        title="Run Identity",
    )
    return {
        "workspace": workspace,
        "campaign_id": campaign_id,
        "campaign_dir": Path(quick["campaign_dir"]),
    }


def _open_table(ws: dict[str, object], **overrides: object) -> dict:
    args = {
        "text": "[in_game]\n开场。\n[/in_game]",
        "run_id": "run-001",
        "presented_roll_ids": [],
        "decision_id": "opening-identity",
        **overrides,
    }
    return coc_toolbox.run_tool(
        "evidence.table_opening",
        ws["workspace"],
        ws["campaign_id"],
        args,
    )


def test_missing_run_identity_is_none(tmp_path: Path) -> None:
    campaign_dir = _seed_campaign(tmp_path)
    assert coc_state.load_run_identity(campaign_dir) is None
    assert not coc_state.run_identity_path(campaign_dir).exists()


def test_bind_persists_six_fields_and_is_idempotent(tmp_path: Path) -> None:
    campaign_dir = _seed_campaign(tmp_path)
    first = coc_state.bind_run_identity(
        campaign_dir,
        campaign_id="identity-camp",
        run_segment_id="run-001",
        session_id="host-session-1",
    )
    replay = coc_state.bind_run_identity(
        campaign_dir,
        campaign_id="identity-camp",
        run_segment_id="run-001",
        session_id="host-session-1",
    )
    loaded = coc_state.load_run_identity(campaign_dir)
    expected_ruleset = coc_rulesets.get_campaign_ruleset_id(
        coc_state.load_campaign_state(campaign_dir)
    )
    expected_version = coc_rulesets.load_manifest(expected_ruleset)["version"]

    assert first == replay == loaded
    assert first["schema_version"] == 1
    assert set(REQUIRED_FIELDS).issubset(first)
    assert first["campaign_id"] == "identity-camp"
    assert first["run_segment_id"] == "run-001"
    assert first["session_id"] == "host-session-1"
    assert first["plugin_version"] == coc_state.plugin_package_version()
    assert first["ruleset_id"] == expected_ruleset
    assert first["ruleset_version"] == expected_version
    on_disk = json.loads(
        coc_state.run_identity_path(campaign_dir).read_text(encoding="utf-8")
    )
    assert {key: on_disk[key] for key in first} == first


def test_bind_conflict_is_fail_closed_and_leaves_record(tmp_path: Path) -> None:
    campaign_dir = _seed_campaign(tmp_path)
    frozen = coc_state.bind_run_identity(
        campaign_dir,
        campaign_id="identity-camp",
        run_segment_id="run-001",
        session_id="host-session-1",
    )
    before = coc_state.run_identity_path(campaign_dir).read_bytes()

    with pytest.raises(coc_state.RunIdentityConflict) as error:
        coc_state.bind_run_identity(
            campaign_dir,
            campaign_id="identity-camp",
            run_segment_id="run-002",
            session_id="host-session-1",
        )
    assert error.value.code == "run_identity_conflict"

    with pytest.raises(coc_state.RunIdentityConflict):
        coc_state.bind_run_identity(
            campaign_dir,
            campaign_id="identity-camp",
            run_segment_id="run-001",
            session_id="other-session",
        )

    assert coc_state.load_run_identity(campaign_dir) == frozen
    assert coc_state.run_identity_path(campaign_dir).read_bytes() == before


@pytest.mark.parametrize(
    "payload",
    [
        {"schema_version": 1, "campaign_id": "identity-camp"},
        {
            "schema_version": 1,
            "campaign_id": "identity-camp",
            "run_segment_id": "missing",
            "session_id": "host-session-1",
            "plugin_version": "0.4.0-alpha.0",
            "ruleset_id": "coc7",
            "ruleset_version": "1.0.0",
        },
        {
            "schema_version": 2,
            "campaign_id": "identity-camp",
            "run_segment_id": "run-001",
            "session_id": "host-session-1",
            "plugin_version": "0.4.0-alpha.0",
            "ruleset_id": "coc7",
            "ruleset_version": "1.0.0",
        },
    ],
)
def test_corrupt_or_incomplete_identity_fails_closed(
    tmp_path: Path, payload: dict
) -> None:
    campaign_dir = _seed_campaign(tmp_path)
    path = coc_state.run_identity_path(campaign_dir)
    path.write_text(json.dumps(payload), encoding="utf-8")
    before = path.read_bytes()

    with pytest.raises(coc_state.UnsupportedSaveSchema):
        coc_state.load_run_identity(campaign_dir)

    assert path.read_bytes() == before


def test_table_opening_writes_identity_without_harness(tmp_path: Path) -> None:
    ws = _quick_workspace(tmp_path)
    campaign_dir = Path(ws["campaign_dir"])
    assert coc_state.load_run_identity(campaign_dir) is None

    opening = _open_table(ws)
    assert opening["ok"] is True, opening
    identity = coc_state.load_run_identity(campaign_dir)
    assert identity is not None
    for field in REQUIRED_FIELDS:
        assert isinstance(identity[field], str) and identity[field].strip()
    assert identity["campaign_id"] == ws["campaign_id"]
    assert identity["run_segment_id"] == "run-001"
    assert identity["session_id"] == opening["data"]["session_id"]
    assert identity["session_id"].startswith("direct-toolbox:")
    assert identity["plugin_version"] == coc_state.plugin_package_version()
    assert identity["ruleset_id"] == "coc7"
    assert identity["ruleset_version"] == coc_rulesets.load_manifest("coc7")["version"]

    replay = _open_table(ws)
    assert replay["ok"] is True, replay
    assert coc_state.load_run_identity(campaign_dir) == identity
    assert replay["data"]["run_segment_id"] == identity["run_segment_id"]
    assert replay["data"]["session_id"] == identity["session_id"]


def test_host_session_is_frozen_into_identity_and_transcript(
    tmp_path: Path,
) -> None:
    ws = _quick_workspace(tmp_path)
    campaign_dir = Path(ws["campaign_dir"])
    coc_host_context.mark_lifecycle(
        ws["workspace"],
        session_id="pi-host-session-1",
        host="pi",
        event="session_start",
    )
    opening = _open_table(ws, decision_id="opening-host")
    assert opening["ok"] is True, opening
    identity = coc_state.load_run_identity(campaign_dir)
    assert identity is not None
    assert identity["session_id"] == "pi-host-session-1"
    assert opening["data"]["session_id"] == "pi-host-session-1"
    rows = [
        json.loads(line)
        for line in (campaign_dir / "logs" / "table-transcript.jsonl")
        .read_text(encoding="utf-8")
        .splitlines()
        if line.strip()
    ]
    assert rows
    assert {row["session_id"] for row in rows} == {"pi-host-session-1"}
    assert {row["run_segment_id"] for row in rows} == {"run-001"}
    assert rows[0]["record_kind"] == "table_opening"
    assert rows[0]["source_ref"].startswith("table.opening#")
    assert rows[0]["turn"] == 0
    assert rows[0].get("finalization_id") in (None, "")


def test_table_opening_detects_identity_conflict(tmp_path: Path) -> None:
    ws = _quick_workspace(tmp_path)
    campaign_dir = Path(ws["campaign_dir"])
    frozen = coc_state.bind_run_identity(
        campaign_dir,
        campaign_id=str(ws["campaign_id"]),
        run_segment_id="run-001",
        session_id="already-frozen-session",
    )
    before = coc_state.run_identity_path(campaign_dir).read_bytes()

    rejected = _open_table(ws, decision_id="opening-conflict")
    assert rejected["ok"] is False, rejected
    assert rejected["error"]["code"] == "run_identity_conflict"
    assert coc_state.load_run_identity(campaign_dir) == frozen
    assert coc_state.run_identity_path(campaign_dir).read_bytes() == before
    transcript = campaign_dir / "logs" / "table-transcript.jsonl"
    assert not transcript.exists() or transcript.read_text(encoding="utf-8") == ""
