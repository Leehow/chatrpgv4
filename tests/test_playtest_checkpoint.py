import hashlib
import importlib.util
import json
import shutil
from pathlib import Path

import pytest


SCRIPT = (
    Path(__file__).resolve().parents[1]
    / "plugins"
    / "coc-keeper"
    / "scripts"
    / "coc_playtest_checkpoint.py"
)
SPEC = importlib.util.spec_from_file_location("coc_playtest_checkpoint_test", SCRIPT)
checkpoint = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(checkpoint)


def _write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")


def _write_jsonl(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows),
        encoding="utf-8",
    )


def _runtime_row(
    *,
    investigator_id: str = "inv-a",
    decision_ids: list[str] | None = None,
    recording_mode: str = "sync",
    recording_flush: str = "manual",
) -> dict:
    return {
        "schema_version": 1,
        "event_type": "live_turn_runtime",
        "investigator_id": investigator_id,
        "decision_ids": list(["decision-1"] if decision_ids is None else decision_ids),
        "recording_mode": recording_mode,
        "recording_flush": recording_flush,
    }


def _telemetry_row(
    *,
    session_id: str = "sess_123",
    investigator_id: str = "inv-a",
    decision_ids: list[str] | None = None,
    receipt_id: str = "telemetry_test_1",
) -> dict:
    return {
        "schema_version": 1,
        "receipt_id": receipt_id,
        "session_id": session_id,
        "investigator_id": investigator_id,
        "decision_ids": list(["decision-1"] if decision_ids is None else decision_ids),
        "telemetry": {},
    }


def _runtime_receipt_sha256(row: dict | None = None) -> str:
    return hashlib.sha256(
        json.dumps(
            row or _runtime_row(),
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
    ).hexdigest()


def _seed_workspace(
    workspace: Path,
    *,
    campaign_id: str = "masks-run-a",
    investigator_id: str = "inv-a",
) -> dict[str, Path]:
    coc = workspace / ".coc"
    campaign = coc / "campaigns" / campaign_id
    _write_json(
        campaign / "campaign.json",
        {
            "schema_version": 1,
            "campaign_id": campaign_id,
            "play_language": "zh-CN",
        },
    )
    _write_json(campaign / "party.json", {"investigator_ids": [investigator_id]})
    source_pdf = campaign / "source" / "masks.pdf"
    source_pdf.parent.mkdir(parents=True, exist_ok=True)
    source_pdf.write_bytes(b"masks source pdf\n")
    _write_json(campaign / "scenario" / "index.json", {"scenes": ["hotel"]})
    _write_json(
        campaign / "scenario" / "hotel.json",
        {"id": "hotel", "clues": ["ledger"]},
    )
    _write_json(campaign / "index" / "page-map.json", {"pages": []})
    _write_json(campaign / "save" / "world-state.json", {"turn": 0})
    _write_json(campaign / "memory" / "beliefs.json", {"beliefs": []})
    (campaign / "logs").mkdir(parents=True, exist_ok=True)
    (campaign / "logs" / "events.jsonl").write_text("", encoding="utf-8")
    live_runtime = campaign / "logs" / "live-turn-runtime.jsonl"
    runtime_telemetry = campaign / "logs" / "runtime-telemetry.jsonl"
    _write_jsonl(live_runtime, [_runtime_row(investigator_id=investigator_id)])
    _write_jsonl(
        runtime_telemetry,
        [_telemetry_row(session_id="sess_123", investigator_id=investigator_id)],
    )

    investigator_dir = coc / "investigators" / investigator_id
    investigator_files = {
        "creation.json": {
            "schema_version": 1,
            "investigator_id": investigator_id,
        },
        "character.json": {"schema_version": 1, "id": investigator_id, "hp": 10},
        "history.jsonl": {"kind": "created"},
        "development.jsonl": {"kind": "development"},
        "inventory-history.jsonl": {"kind": "inventory"},
    }
    for name, value in investigator_files.items():
        path = investigator_dir / name
        path.parent.mkdir(parents=True, exist_ok=True)
        if name.endswith(".jsonl"):
            path.write_text(json.dumps(value) + "\n", encoding="utf-8")
        else:
            _write_json(path, value)

    sessions = coc / "runtime" / "sessions.json"
    _write_json(
        sessions,
        {
            "schema_version": 1,
            "sessions": [
                {
                    "session_id": "sess_123",
                    "campaign_id": campaign_id,
                    "investigator_id": investigator_id,
                    "character_relpath": (
                        f".coc/investigators/{investigator_id}/character.json"
                    ),
                    "resolved_config": {"schema_version": 1, "brain": "debug"},
                    "brain_at_create": "debug",
                }
            ],
            "closed_session_ids": [],
        },
    )
    _write_json(
        coc / "indexes" / "campaigns.json",
        {
            "schema_version": 1,
            "campaigns": {
                campaign_id: {
                    "campaign_id": campaign_id,
                    "path": f".coc/campaigns/{campaign_id}/campaign.json",
                }
            },
        },
    )
    _write_json(
        coc / "indexes" / "investigators.json",
        {
            "schema_version": 1,
            "investigators": {
                investigator_id: {
                    "id": investigator_id,
                    "path": f".coc/investigators/{investigator_id}/character.json",
                }
            },
        },
    )

    # These are deliberately in the workspace but outside the checkpoint allowlist.
    (workspace / ".env").write_text("SECRET=do-not-copy\n", encoding="utf-8")
    _write_json(workspace / "node_modules" / "worker" / "state.json", {"pid": 7})
    _write_json(
        workspace / ".coc" / "runtime.json",
        {"workspace": str(workspace.resolve()), "api_key_file": "/tmp/secret"},
    )
    return {
        "campaign": campaign,
        "campaign_json": campaign / "campaign.json",
        "party": campaign / "party.json",
        "source_pdf": source_pdf,
        "scenario_index": campaign / "scenario" / "index.json",
        "scenario": campaign / "scenario" / "hotel.json",
        "index": campaign / "index" / "page-map.json",
        "save": campaign / "save" / "world-state.json",
        "memory": campaign / "memory" / "beliefs.json",
        "logs": campaign / "logs" / "events.jsonl",
        "live_runtime": live_runtime,
        "runtime_telemetry": runtime_telemetry,
        "investigator": investigator_dir / "character.json",
        "investigator_creation": investigator_dir / "creation.json",
        "investigator_history": investigator_dir / "history.jsonl",
        "investigator_development": investigator_dir / "development.jsonl",
        "investigator_inventory": investigator_dir / "inventory-history.jsonl",
        "sessions": sessions,
    }


def _prepare_fresh_generation(
    workspace: Path,
    *,
    campaign_id: str = "masks-run-a",
    investigator_id: str = "inv-a",
) -> None:
    coc = workspace / ".coc"
    _write_json(
        coc / "runtime.json",
        {"schema_version": 1, "brain": "debug"},
    )
    _write_json(
        coc / "indexes" / "campaigns.json",
        {
            "schema_version": 1,
            "campaigns": {
                campaign_id: {
                    "campaign_id": campaign_id,
                    "path": f".coc/campaigns/{campaign_id}/campaign.json",
                }
            },
        },
    )
    _write_json(
        coc / "indexes" / "investigators.json",
        {
            "schema_version": 1,
            "investigators": {
                investigator_id: {
                    "id": investigator_id,
                    "path": f".coc/investigators/{investigator_id}/character.json",
                }
            },
        },
    )


def _provenance(*, player_mode: str = "whitebox") -> dict[str, object]:
    return {
        "player_mode": player_mode,
        "model_identity": {
            "provider": "openai",
            "id": "gpt-test",
        },
        "recording_mode": "sync",
        "recording_flush": "manual",
        "runtime_receipt_sha256": _runtime_receipt_sha256(),
        "request_id": "req-1",
    }


def _append_one(store) -> Path:
    return _append_with_provenance(store, _provenance())


def _append_with_provenance(store, provenance: dict[str, object]) -> Path:
    return store.append_turn(
        {"kind": "investigate", "target": "hotel ledger"},
        [{"kind": "clue_discovered", "clue_id": "ledger"}],
        {"turn": 0, "hp": 10},
        {"turn": 1, "hp": 10},
        provenance,
    )


def _checkpoint(tmp_path: Path):
    workspace = tmp_path / "workspace"
    paths = _seed_workspace(workspace)
    run_dir = tmp_path / "runs" / "masks-run-a"
    store = checkpoint.CheckpointStore(run_dir, workspace, "masks-run-a", "inv-a")
    turn_path = _append_one(store)
    checkpoint_dir = store.write_checkpoint("sess_123", 1, "turn_complete")
    return store, checkpoint_dir, turn_path, workspace, paths


def _canonical_sha256(value: object) -> str:
    payload = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def test_append_turn_is_durable_and_manifest_is_complete(tmp_path: Path):
    store, checkpoint_dir, turn_path, _, _ = _checkpoint(tmp_path)

    assert turn_path.is_file()
    rows = [
        json.loads(line) for line in turn_path.read_text(encoding="utf-8").splitlines()
    ]
    assert len(rows) == 1
    row = rows[0]
    assert row["turn_number"] == 1
    assert row["previous_sha256"] == checkpoint.GENESIS_SHA256
    assert row["row_sha256"] == _canonical_sha256(
        {key: value for key, value in row.items() if key != "row_sha256"}
    )
    assert store.action_chain_sha256 == row["row_sha256"]
    assert not list(store.run_dir.rglob("*.tmp"))

    manifest = json.loads(
        (checkpoint_dir / "manifest.json").read_text(encoding="utf-8")
    )
    required = {
        "schema_version",
        "run_id",
        "turn_number",
        "git_head",
        "source_pdf_sha256",
        "source_hashes",
        "scenario_hashes",
        "index_hashes",
        "managed_mutable_trees",
        "managed_file_presence",
        "state_files",
        "session_snapshot_sha256",
        "action_chain_sha256",
        "model_identity",
        "invalidation_state",
        "player_mode",
    }
    assert required <= manifest.keys()
    assert manifest["run_id"] == "masks-run-a"
    assert manifest["schema_version"] == 2
    assert manifest["turn_number"] == 1
    assert manifest["action_chain_sha256"] == store.action_chain_sha256
    assert manifest["model_identity"] == {"provider": "openai", "id": "gpt-test"}
    assert manifest["invalidation_state"] == {"invalidated": False, "segments": []}
    assert manifest["state_files"]


def test_turn_zero_manifest_records_an_absent_action_journal(tmp_path: Path):
    workspace = tmp_path / "workspace"
    _seed_workspace(workspace)
    store = checkpoint.CheckpointStore(
        tmp_path / "run", workspace, "masks-run-a", "inv-a"
    )

    checkpoint_dir = store.write_checkpoint("sess_123", 0, "initial_state")
    manifest = json.loads(
        (checkpoint_dir / "manifest.json").read_text(encoding="utf-8")
    )
    journal = ".coc/playtest-runs/masks-run-a/actions.jsonl"

    assert manifest["turn_number"] == 0
    assert manifest["action_chain_sha256"] == checkpoint.GENESIS_SHA256
    assert manifest["managed_file_presence"][journal] is False
    assert journal not in {entry["workspace_path"] for entry in manifest["state_files"]}


def test_checkpoint_uses_only_the_canonical_public_runtime_allowlist(tmp_path: Path):
    workspace = tmp_path / "workspace"
    paths = _seed_workspace(workspace)
    other_campaign = workspace / ".coc" / "campaigns" / "other"
    _write_json(other_campaign / "campaign.json", {"campaign_id": "other"})
    other_investigator = workspace / ".coc" / "investigators" / "other"
    _write_json(other_investigator / "character.json", {"id": "other"})
    (workspace / ".coc" / "credentials.json").write_text(
        "do-not-copy", encoding="utf-8"
    )
    (paths["campaign"] / "snapshots" / "old" / "state.json").parent.mkdir(parents=True)
    (paths["campaign"] / "snapshots" / "old" / "state.json").write_text(
        "do-not-copy", encoding="utf-8"
    )
    (paths["campaign"] / "artifacts").mkdir()
    (paths["campaign"] / "artifacts" / "receipt.json").write_text(
        "do-not-copy", encoding="utf-8"
    )
    portrait = workspace / ".coc" / "investigators" / "inv-a" / "portrait.png"
    portrait.write_bytes(b"portrait")
    sessions = json.loads(paths["sessions"].read_text(encoding="utf-8"))
    sessions["sessions"].append(
        {
            "session_id": "sess_other",
            "campaign_id": "other",
            "investigator_id": "other",
            "character_relpath": ".coc/investigators/other/character.json",
            "resolved_config": {"schema_version": 1, "brain": "debug"},
            "brain_at_create": "debug",
        }
    )
    sessions["closed_session_ids"] = ["sess_closed"]
    _write_json(paths["sessions"], sessions)

    store = checkpoint.CheckpointStore(
        tmp_path / "run", workspace, "masks-run-a", "inv-a"
    )
    _append_one(store)
    checkpoint_dir = store.write_checkpoint("sess_123", 1, "turn_complete")
    manifest = json.loads(
        (checkpoint_dir / "manifest.json").read_text(encoding="utf-8")
    )
    workspace_paths = {entry["workspace_path"] for entry in manifest["state_files"]}

    expected_prefix = ".coc/campaigns/masks-run-a/"
    assert all(
        path.startswith(expected_prefix)
        or path.startswith(".coc/investigators/inv-a/")
        or path == ".coc/runtime/sessions.json"
        or path == ".coc/playtest-runs/masks-run-a/actions.jsonl"
        for path in workspace_paths
    )
    assert not any("/other/" in path for path in workspace_paths)
    assert ".coc/runtime.json" not in workspace_paths
    assert ".coc/credentials.json" not in workspace_paths
    assert not any("/snapshots/" in path for path in workspace_paths)
    assert not any("/artifacts/" in path for path in workspace_paths)
    assert not any(path.endswith("portrait.png") for path in workspace_paths)
    sessions_entry = next(
        entry
        for entry in manifest["state_files"]
        if entry["workspace_path"] == ".coc/runtime/sessions.json"
    )
    sanitized = json.loads((checkpoint_dir / sessions_entry["path"]).read_text())
    assert [record["session_id"] for record in sanitized["sessions"]] == ["sess_123"]
    assert sanitized["closed_session_ids"] == []


@pytest.mark.parametrize(
    ("recording_mode", "recording_flush"),
    [("fast", "background"), ("sync", "background"), ("fast", "manual")],
)
def test_checkpoint_requires_a_quiescent_sync_recording_boundary(
    tmp_path: Path, recording_mode: str, recording_flush: str
):
    workspace = tmp_path / "workspace"
    _seed_workspace(workspace)
    store = checkpoint.CheckpointStore(
        tmp_path / "run", workspace, "masks-run-a", "inv-a"
    )
    provenance = _provenance()
    provenance["recording_mode"] = recording_mode
    provenance["recording_flush"] = recording_flush
    _append_with_provenance(store, provenance)

    with pytest.raises(ValueError, match="recording|durable|quiescent"):
        store.write_checkpoint("sess_123", 1, "turn_complete")
    assert not (store.run_dir / "checkpoints").exists()


def test_checkpoint_requires_a_bound_runtime_recording_receipt(tmp_path: Path):
    workspace = tmp_path / "workspace"
    _seed_workspace(workspace)
    store = checkpoint.CheckpointStore(
        tmp_path / "run", workspace, "masks-run-a", "inv-a"
    )
    provenance = _provenance()
    provenance.pop("runtime_receipt_sha256")
    _append_with_provenance(store, provenance)

    with pytest.raises(ValueError, match="receipt|recording"):
        store.write_checkpoint("sess_123", 1, "turn_complete")
    assert not (store.run_dir / "checkpoints").exists()


def test_checkpoint_rejects_runtime_receipt_digest_mismatch(tmp_path: Path):
    workspace = tmp_path / "workspace"
    _seed_workspace(workspace)
    store = checkpoint.CheckpointStore(
        tmp_path / "run", workspace, "masks-run-a", "inv-a"
    )
    provenance = _provenance()
    provenance["runtime_receipt_sha256"] = "0" * 64
    _append_with_provenance(store, provenance)

    with pytest.raises(ValueError, match="receipt|digest|checksum"):
        store.write_checkpoint("sess_123", 1, "turn_complete")


def test_checkpoint_rejects_runtime_row_investigator_identity_mismatch(
    tmp_path: Path,
):
    workspace = tmp_path / "workspace"
    paths = _seed_workspace(workspace)
    runtime_row = _runtime_row(investigator_id="other")
    _write_jsonl(paths["live_runtime"], [runtime_row])
    store = checkpoint.CheckpointStore(
        tmp_path / "run", workspace, "masks-run-a", "inv-a"
    )
    provenance = _provenance()
    provenance["runtime_receipt_sha256"] = _runtime_receipt_sha256(runtime_row)
    _append_with_provenance(store, provenance)

    with pytest.raises(ValueError, match="investigator|receipt|runtime"):
        store.write_checkpoint("sess_123", 1, "turn_complete")


@pytest.mark.parametrize(
    "evidence_case",
    ["missing", "wrong_session", "decision_mismatch", "ambiguous_receipt_id"],
)
def test_checkpoint_cross_binds_runtime_decisions_to_latest_session_telemetry(
    tmp_path: Path, evidence_case: str
):
    workspace = tmp_path / "workspace"
    paths = _seed_workspace(workspace)
    if evidence_case == "missing":
        paths["runtime_telemetry"].unlink()
    elif evidence_case == "wrong_session":
        _write_jsonl(
            paths["runtime_telemetry"],
            [_telemetry_row(session_id="sess_other")],
        )
    elif evidence_case == "decision_mismatch":
        _write_jsonl(
            paths["runtime_telemetry"],
            [_telemetry_row(decision_ids=["other-decision"])],
        )
    else:
        _write_jsonl(
            paths["runtime_telemetry"],
            [
                _telemetry_row(receipt_id="duplicate"),
                _telemetry_row(receipt_id="duplicate"),
            ],
        )
    store = checkpoint.CheckpointStore(
        tmp_path / "run", workspace, "masks-run-a", "inv-a"
    )
    _append_one(store)

    with pytest.raises(ValueError, match="telemetry|session|decision|ambiguous"):
        store.write_checkpoint("sess_123", 1, "turn_complete")


def test_checkpoint_ignores_an_unrelated_historical_telemetry_row_without_decisions(
    tmp_path: Path,
):
    workspace = tmp_path / "workspace"
    paths = _seed_workspace(workspace)
    _write_jsonl(
        paths["runtime_telemetry"],
        [
            _telemetry_row(
                session_id="sess_other",
                decision_ids=[],
                receipt_id="telemetry_other",
            ),
            _telemetry_row(),
        ],
    )
    store = checkpoint.CheckpointStore(
        tmp_path / "run", workspace, "masks-run-a", "inv-a"
    )
    _append_one(store)

    checkpoint_dir = store.write_checkpoint("sess_123", 1, "turn_complete")

    assert checkpoint_dir.is_dir()


def test_checkpoint_rejects_leftover_async_pending_batches(tmp_path: Path):
    workspace = tmp_path / "workspace"
    paths = _seed_workspace(workspace)
    pending = paths["campaign"] / "logs" / "pending-turns" / "turn.json"
    _write_json(pending, {"entries": []})
    store = checkpoint.CheckpointStore(
        tmp_path / "run", workspace, "masks-run-a", "inv-a"
    )
    _append_one(store)

    with pytest.raises(ValueError, match="pending|quiescent|background"):
        store.write_checkpoint("sess_123", 1, "turn_complete")
    assert not (store.run_dir / "checkpoints").exists()


@pytest.mark.parametrize(
    ("field", "replacement"),
    [
        ("session_id", "sess_wrong"),
        ("campaign_id", "other"),
        ("investigator_id", "other"),
        ("character_relpath", ".coc/investigators/other/character.json"),
    ],
)
def test_checkpoint_rejects_a_session_snapshot_not_bound_to_the_requested_run(
    tmp_path: Path, field: str, replacement: str
):
    workspace = tmp_path / "workspace"
    paths = _seed_workspace(workspace)
    sessions = json.loads(paths["sessions"].read_text(encoding="utf-8"))
    sessions["sessions"][0][field] = replacement
    _write_json(paths["sessions"], sessions)
    store = checkpoint.CheckpointStore(
        tmp_path / "run", workspace, "masks-run-a", "inv-a"
    )
    _append_one(store)

    with pytest.raises(ValueError, match="session"):
        store.write_checkpoint("sess_123", 1, "turn_complete")
    assert not (store.run_dir / "checkpoints").exists()


def test_checkpoint_strictly_rejects_malformed_unrelated_session_records(
    tmp_path: Path,
):
    workspace = tmp_path / "workspace"
    paths = _seed_workspace(workspace)
    sessions = json.loads(paths["sessions"].read_text(encoding="utf-8"))
    sessions["sessions"].append(
        {
            "session_id": "sess_other",
            "campaign_id": "other",
            "investigator_id": "other",
            "character_relpath": ".coc/investigators/other/character.json",
            "resolved_config": {
                "schema_version": 1,
                "brain": "debug",
                "api_token": "must-not-be-ignored",
            },
            "brain_at_create": "debug",
        }
    )
    _write_json(paths["sessions"], sessions)
    store = checkpoint.CheckpointStore(
        tmp_path / "run", workspace, "masks-run-a", "inv-a"
    )
    _append_one(store)

    with pytest.raises(ValueError, match="session"):
        store.write_checkpoint("sess_123", 1, "turn_complete")
    assert not (store.run_dir / "checkpoints").exists()


@pytest.mark.parametrize("identity_case", ["campaign", "party", "save", "scenario"])
def test_checkpoint_rejects_structured_cross_file_identity_mismatches(
    tmp_path: Path, identity_case: str
):
    workspace = tmp_path / "workspace"
    paths = _seed_workspace(workspace)
    store = checkpoint.CheckpointStore(
        tmp_path / "run", workspace, "masks-run-a", "inv-a"
    )
    _append_one(store)
    if identity_case == "campaign":
        _write_json(paths["campaign_json"], {"campaign_id": "other"})
    elif identity_case == "party":
        _write_json(paths["party"], {"investigator_ids": ["other"]})
    elif identity_case == "save":
        _write_json(
            paths["campaign"] / "save" / "investigator-state" / "inv-a.json",
            {"campaign_id": "other", "investigator_id": "inv-a"},
        )
    else:
        _write_json(
            paths["campaign"] / "save" / "world-state.json",
            {"scenario_id": "scenario-a"},
        )
        _write_json(
            paths["campaign"] / "scenario" / "module-meta.json",
            {"scenario_id": "scenario-b"},
        )

    with pytest.raises(
        ValueError, match="campaign|party|investigator|scenario|identity"
    ):
        store.write_checkpoint("sess_123", 1, "turn_complete")
    assert not (store.run_dir / "checkpoints").exists()


@pytest.mark.parametrize(
    ("file_key", "replacement"),
    [
        ("investigator", {"id": "other"}),
        ("investigator", {"id": "inv-a", "investigator_id": "other"}),
        ("investigator_creation", {"investigator_id": "other"}),
    ],
)
def test_checkpoint_rejects_wrong_selected_investigator_file_identity(
    tmp_path: Path, file_key: str, replacement: dict
):
    workspace = tmp_path / "workspace"
    paths = _seed_workspace(workspace)
    store = checkpoint.CheckpointStore(
        tmp_path / "run", workspace, "masks-run-a", "inv-a"
    )
    _append_one(store)
    _write_json(paths[file_key], replacement)

    with pytest.raises(ValueError, match="investigator|character|creation|identity"):
        store.write_checkpoint("sess_123", 1, "turn_complete")


def test_restore_rejects_rehashed_wrong_character_identity(tmp_path: Path):
    store, checkpoint_dir, _, _, _ = _checkpoint(tmp_path)
    manifest_path = checkpoint_dir / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    entry = next(
        item
        for item in manifest["state_files"]
        if item["workspace_path"] == ".coc/investigators/inv-a/character.json"
    )
    state_path = checkpoint_dir / entry["path"]
    payload = json.dumps({"id": "other"}).encode("utf-8")
    state_path.write_bytes(payload)
    entry["sha256"] = hashlib.sha256(payload).hexdigest()
    entry["size"] = len(payload)
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    target = tmp_path / "fresh"
    _prepare_fresh_generation(target)

    with pytest.raises(ValueError, match="investigator|character|identity"):
        store.restore_checkpoint(checkpoint_dir, target)


def test_restore_exactly_mirrors_mutable_trees_and_absent_optional_files(
    tmp_path: Path,
):
    workspace = tmp_path / "workspace"
    paths = _seed_workspace(workspace)
    paths["party"].unlink()
    paths["investigator_history"].unlink()
    paths["memory"].unlink()
    store = checkpoint.CheckpointStore(
        tmp_path / "run", workspace, "masks-run-a", "inv-a"
    )
    _append_one(store)
    checkpoint_dir = store.write_checkpoint("sess_123", 1, "turn_complete")

    # A later turn only mutates the old generation.  Rollback is installed in
    # a fresh generation so a crash can never leave half-deleted live state.
    stale_save = paths["campaign"] / "save" / "later.json"
    stale_log = paths["campaign"] / "logs" / "later.jsonl"
    stale_save.write_text("later", encoding="utf-8")
    stale_log.write_text("later", encoding="utf-8")

    target = tmp_path / "target"
    _prepare_fresh_generation(target)

    manifest = store.restore_checkpoint(checkpoint_dir, target)

    assert (
        manifest["managed_mutable_trees"][".coc/campaigns/masks-run-a/memory"][
            "present"
        ]
        is True
    )
    restored_campaign = target / ".coc" / "campaigns" / "masks-run-a"
    restored_investigator = target / ".coc" / "investigators" / "inv-a"
    assert not (restored_campaign / "save" / "later.json").exists()
    assert not (restored_campaign / "logs" / "later.jsonl").exists()
    assert (restored_campaign / "memory").is_dir()
    assert not (restored_campaign / "party.json").exists()
    assert not (restored_investigator / "history.jsonl").exists()
    assert stale_save.read_text(encoding="utf-8") == "later"
    assert stale_log.read_text(encoding="utf-8") == "later"


def test_restore_rejects_any_preexisting_managed_generation_before_writes(
    tmp_path: Path,
):
    store, checkpoint_dir, _, _, _ = _checkpoint(tmp_path)
    target = tmp_path / "target"
    paths = _seed_workspace(target)
    before = paths["save"].read_bytes()
    sentinel = tmp_path / "outside-stale.txt"
    sentinel.write_text("outside", encoding="utf-8")
    stale = paths["campaign"] / "save" / "later.json"
    stale.symlink_to(sentinel)

    with pytest.raises(ValueError, match="fresh|managed|symlink"):
        store.restore_checkpoint(checkpoint_dir, target)

    assert paths["save"].read_bytes() == before
    assert sentinel.read_text(encoding="utf-8") == "outside"


@pytest.mark.parametrize("immutable_tree", ["source", "scenario", "index"])
def test_restore_rejects_preexisting_immutable_target_trees_before_mutation(
    tmp_path: Path, immutable_tree: str
):
    store, checkpoint_dir, _, _, _ = _checkpoint(tmp_path)
    target = tmp_path / "target"
    paths = _seed_workspace(target)
    paths["save"].write_text("target-before", encoding="utf-8")
    extra = paths["campaign"] / immutable_tree / "later.json"
    extra.write_text("immutable drift", encoding="utf-8")

    with pytest.raises(ValueError, match="fresh|managed|immutable"):
        store.restore_checkpoint(checkpoint_dir, target)

    assert paths["save"].read_text(encoding="utf-8") == "target-before"


@pytest.mark.parametrize("membership_case", ["phantom", "omitted_parent"])
def test_restore_rejects_mutable_tree_directory_membership_not_derived_from_files(
    tmp_path: Path, membership_case: str
):
    workspace = tmp_path / "workspace"
    paths = _seed_workspace(workspace)
    _write_json(
        paths["campaign"] / "save" / "investigator-state" / "inv-a.json",
        {"campaign_id": "masks-run-a", "investigator_id": "inv-a"},
    )
    store = checkpoint.CheckpointStore(
        tmp_path / "run", workspace, "masks-run-a", "inv-a"
    )
    _append_one(store)
    checkpoint_dir = store.write_checkpoint("sess_123", 1, "turn_complete")
    manifest_path = checkpoint_dir / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    save_root = ".coc/campaigns/masks-run-a/save"
    directories = manifest["managed_mutable_trees"][save_root]["directories"]
    if membership_case == "phantom":
        directories.append("phantom")
        directories.sort()
    else:
        directories.remove("investigator-state")
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    target = tmp_path / "fresh"
    _prepare_fresh_generation(target)

    with pytest.raises(ValueError, match="mutable|directory|membership"):
        store.restore_checkpoint(checkpoint_dir, target)


def test_empty_mutable_root_restores_only_its_root_directory(tmp_path: Path):
    workspace = tmp_path / "workspace"
    paths = _seed_workspace(workspace)
    paths["memory"].unlink()
    (paths["campaign"] / "memory" / "phantom-empty").mkdir()
    store = checkpoint.CheckpointStore(
        tmp_path / "run", workspace, "masks-run-a", "inv-a"
    )
    _append_one(store)
    checkpoint_dir = store.write_checkpoint("sess_123", 1, "turn_complete")
    manifest = json.loads((checkpoint_dir / "manifest.json").read_text())
    memory_root = ".coc/campaigns/masks-run-a/memory"

    assert manifest["managed_mutable_trees"][memory_root] == {
        "present": True,
        "directories": ["."],
    }
    target = tmp_path / "fresh"
    _prepare_fresh_generation(target)
    store.restore_checkpoint(checkpoint_dir, target)
    restored_memory = target / memory_root
    assert restored_memory.is_dir()
    assert not (restored_memory / "phantom-empty").exists()


@pytest.mark.parametrize("root_name", ["save", "memory", "logs"])
def test_checkpoint_writer_requires_every_canonical_mutable_root(
    tmp_path: Path, root_name: str
):
    workspace = tmp_path / "workspace"
    paths = _seed_workspace(workspace)
    shutil.rmtree(paths["campaign"] / root_name)
    store = checkpoint.CheckpointStore(
        tmp_path / "run", workspace, "masks-run-a", "inv-a"
    )

    with pytest.raises(ValueError, match="canonical mutable|save|memory|logs|required"):
        store.write_checkpoint("sess_123", 0, "initial_state")


def test_restore_rejects_absent_mutable_root_forged_from_false_to_true(
    tmp_path: Path,
):
    workspace = tmp_path / "workspace"
    paths = _seed_workspace(workspace)
    paths["memory"].unlink()
    store = checkpoint.CheckpointStore(
        tmp_path / "run", workspace, "masks-run-a", "inv-a"
    )
    checkpoint_dir = store.write_checkpoint("sess_123", 0, "initial_state")
    manifest_path = checkpoint_dir / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    memory_root = ".coc/campaigns/masks-run-a/memory"
    stored_memory = checkpoint_dir / "state" / memory_root
    if stored_memory.exists():
        stored_memory.rmdir()

    # Model a checkpoint whose root was absent, then forge only its manifest
    # from false -> true.  A required root must also exist in the checkpoint
    # state tree; manifest presence alone is not sufficient evidence.
    metadata = manifest["managed_mutable_trees"][memory_root]
    metadata.update({"present": False, "directories": []})
    metadata.update({"present": True, "directories": ["."]})
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    target = tmp_path / "fresh"
    _prepare_fresh_generation(target)

    with pytest.raises(ValueError, match="canonical mutable|state root|required"):
        store.restore_checkpoint(checkpoint_dir, target)


def test_action_rows_form_a_canonical_hash_chain(tmp_path: Path):
    workspace = tmp_path / "workspace"
    _seed_workspace(workspace)
    store = checkpoint.CheckpointStore(
        tmp_path / "run", workspace, "masks-run-a", "inv-a"
    )
    ledger = _append_one(store)
    store.append_turn(
        {"kind": "move", "target": "lobby"},
        [{"kind": "scene_entered", "scene_id": "lobby"}],
        {"turn": 1},
        {"turn": 2},
        _provenance(),
    )

    rows = [
        json.loads(line) for line in ledger.read_text(encoding="utf-8").splitlines()
    ]
    assert [row["turn_number"] for row in rows] == [1, 2]
    assert rows[1]["previous_sha256"] == rows[0]["row_sha256"]
    for row in rows:
        assert row["row_sha256"] == _canonical_sha256(
            {key: value for key, value in row.items() if key != "row_sha256"}
        )


def test_truncated_final_jsonl_row_is_discarded_before_next_append(tmp_path: Path):
    workspace = tmp_path / "workspace"
    _seed_workspace(workspace)
    run_dir = tmp_path / "run"
    store = checkpoint.CheckpointStore(run_dir, workspace, "masks-run-a", "inv-a")
    ledger = _append_one(store)
    with ledger.open("ab") as handle:
        handle.write(b'{"turn_number":2,"action":')

    resumed = checkpoint.CheckpointStore(run_dir, workspace, "masks-run-a", "inv-a")
    resumed.append_turn(
        {"kind": "listen"},
        [],
        {"turn": 1},
        {"turn": 2},
        _provenance(),
    )

    rows = [
        json.loads(line) for line in ledger.read_text(encoding="utf-8").splitlines()
    ]
    assert [row["turn_number"] for row in rows] == [1, 2]
    assert rows[1]["previous_sha256"] == rows[0]["row_sha256"]


def test_restore_rejects_a_checkpoint_file_checksum_mismatch(tmp_path: Path):
    store, checkpoint_dir, _, _, _ = _checkpoint(tmp_path)
    manifest = json.loads(
        (checkpoint_dir / "manifest.json").read_text(encoding="utf-8")
    )
    protected = checkpoint_dir / manifest["state_files"][0]["path"]
    protected.write_bytes(protected.read_bytes() + b"corrupt")

    with pytest.raises(ValueError, match="checksum"):
        store.restore_checkpoint(checkpoint_dir, tmp_path / "fresh")


def test_source_symlink_is_rejected_without_touching_outside_file(tmp_path: Path):
    workspace = tmp_path / "workspace"
    paths = _seed_workspace(workspace)
    sentinel = tmp_path / "outside-source.txt"
    sentinel.write_text("unchanged", encoding="utf-8")
    paths["source_pdf"].unlink()
    paths["source_pdf"].symlink_to(sentinel)
    store = checkpoint.CheckpointStore(
        tmp_path / "run", workspace, "masks-run-a", "inv-a"
    )

    with pytest.raises(ValueError, match="symlink"):
        _append_one(store)

    assert sentinel.read_text(encoding="utf-8") == "unchanged"


def test_target_component_symlink_is_rejected_without_outside_writes(tmp_path: Path):
    store, checkpoint_dir, _, _, _ = _checkpoint(tmp_path)
    target = tmp_path / "restore"
    target.mkdir()
    outside = tmp_path / "outside-target"
    outside.mkdir()
    sentinel = outside / "sentinel.txt"
    sentinel.write_text("unchanged", encoding="utf-8")
    (target / ".coc").mkdir()
    (target / ".coc" / "campaigns").symlink_to(outside, target_is_directory=True)

    with pytest.raises(ValueError, match="symlink"):
        store.restore_checkpoint(checkpoint_dir, target)

    assert sentinel.read_text(encoding="utf-8") == "unchanged"
    assert sorted(path.name for path in outside.iterdir()) == ["sentinel.txt"]


@pytest.mark.parametrize("field", ["campaign_id", "investigator_id"])
def test_identifiers_cannot_traverse_outside_the_workspace(tmp_path: Path, field: str):
    workspace = tmp_path / "workspace"
    _seed_workspace(workspace)
    values = {"campaign_id": "masks-run-a", "investigator_id": "inv-a"}
    values[field] = "../outside"

    with pytest.raises(ValueError, match="containment|identifier|traversal"):
        checkpoint.CheckpointStore(
            tmp_path / "run",
            workspace,
            values["campaign_id"],
            values["investigator_id"],
        )


def test_manifest_traversal_is_rejected_before_outside_file_access(tmp_path: Path):
    store, checkpoint_dir, _, _, _ = _checkpoint(tmp_path)
    sentinel = tmp_path / "sentinel.txt"
    sentinel.write_text("unchanged", encoding="utf-8")
    manifest_path = checkpoint_dir / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["state_files"][0]["path"] = "../sentinel.txt"
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

    with pytest.raises(ValueError, match="containment|traversal"):
        store.restore_checkpoint(checkpoint_dir, tmp_path / "fresh")

    assert sentinel.read_text(encoding="utf-8") == "unchanged"


def test_checkpoint_restores_allowlisted_files_into_a_fresh_workspace(tmp_path: Path):
    store, checkpoint_dir, _, workspace, paths = _checkpoint(tmp_path)
    fresh = tmp_path / "fresh"
    _prepare_fresh_generation(fresh)
    runtime_config = fresh / ".coc" / "runtime.json"
    runtime_config_before = runtime_config.read_bytes()

    restored = store.restore_checkpoint(checkpoint_dir, fresh)

    assert restored["turn_number"] == 1
    assert restored["action_chain_sha256"] == store.action_chain_sha256
    manifest = json.loads(
        (checkpoint_dir / "manifest.json").read_text(encoding="utf-8")
    )
    for entry in manifest["state_files"]:
        expected = checkpoint_dir / entry["path"]
        assert (fresh / entry["workspace_path"]).read_bytes() == expected.read_bytes()
    assert (fresh / ".coc" / "playtest-runs" / "masks-run-a").is_dir()
    assert not (fresh / ".env").exists()
    assert not (fresh / "node_modules").exists()
    assert runtime_config.read_bytes() == runtime_config_before


@pytest.mark.parametrize(
    ("field", "replacement", "message"),
    [
        ("schema_version", 999, "schema"),
        ("run_id", "another-run", "run"),
        ("player_mode", "blackbox", "player mode"),
        ("source_pdf_sha256", "0" * 64, "source"),
    ],
)
def test_restore_rejects_incompatible_manifest_metadata(
    tmp_path: Path, field: str, replacement: object, message: str
):
    store, checkpoint_dir, _, _, _ = _checkpoint(tmp_path)
    manifest_path = checkpoint_dir / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest[field] = replacement
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

    with pytest.raises(ValueError, match=message):
        store.restore_checkpoint(checkpoint_dir, tmp_path / "fresh")


def test_restore_rejects_scenario_hash_mismatch(tmp_path: Path):
    store, checkpoint_dir, _, _, _ = _checkpoint(tmp_path)
    manifest_path = checkpoint_dir / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    scenario_path = next(iter(manifest["scenario_hashes"]))
    manifest["scenario_hashes"][scenario_path] = "0" * 64
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

    with pytest.raises(ValueError, match="scenario"):
        store.restore_checkpoint(checkpoint_dir, tmp_path / "fresh")


def test_restore_rejects_index_hash_or_membership_mismatch(tmp_path: Path):
    store, checkpoint_dir, _, _, _ = _checkpoint(tmp_path)
    manifest_path = checkpoint_dir / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    index_path = next(iter(manifest["index_hashes"]))
    manifest["index_hashes"][index_path] = "0" * 64
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

    with pytest.raises(ValueError, match="index"):
        store.restore_checkpoint(checkpoint_dir, tmp_path / "fresh")


def test_existing_target_generation_is_rejected_even_when_source_differs(
    tmp_path: Path,
):
    store, checkpoint_dir, _, _, _ = _checkpoint(tmp_path)
    target = tmp_path / "target"
    paths = _seed_workspace(target)
    paths["source_pdf"].write_bytes(b"a different source")
    sentinel = target / "keep.txt"
    sentinel.write_text("unchanged", encoding="utf-8")

    with pytest.raises(ValueError, match="fresh|managed"):
        store.restore_checkpoint(checkpoint_dir, target)

    assert sentinel.read_text(encoding="utf-8") == "unchanged"


def test_git_head_change_requires_an_explicit_matching_invalidated_segment(
    tmp_path: Path,
):
    store, checkpoint_dir, _, _, _ = _checkpoint(tmp_path)
    manifest_path = checkpoint_dir / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    old_head = manifest["git_head"]
    new_head = "f" * 40 if old_head != "f" * 40 else "e" * 40
    store.git_head = new_head

    with pytest.raises(ValueError, match="Git HEAD"):
        store.restore_checkpoint(checkpoint_dir, tmp_path / "rejected")

    manifest["invalidation_state"] = {
        "invalidated": True,
        "segments": [
            {
                "kind": "invalidated_segment",
                "old_commit": old_head,
                "new_commit": new_head,
                "replay_start_checkpoint": checkpoint_dir.name,
            }
        ],
    }
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    allowed = tmp_path / "allowed"
    _prepare_fresh_generation(allowed)
    restored = store.restore_checkpoint(checkpoint_dir, allowed)

    assert restored["git_head"] == old_head
    assert restored["invalidation_state"]["invalidated"] is True


@pytest.mark.parametrize(
    "segment",
    [
        {"old_commit": "wrong", "new_commit": "new", "replay_start_checkpoint": "x"},
        {"old_commit": "old", "new_commit": "wrong", "replay_start_checkpoint": "x"},
        {"old_commit": "old", "new_commit": "new", "replay_start_checkpoint": "wrong"},
    ],
)
def test_git_invalidation_record_must_name_both_commits_and_replay_checkpoint(
    tmp_path: Path, segment: dict[str, str]
):
    store, checkpoint_dir, _, _, _ = _checkpoint(tmp_path)
    manifest_path = checkpoint_dir / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    old_head = manifest["git_head"]
    new_head = "1" * 40
    store.git_head = new_head
    replacements = {
        "old": old_head,
        "new": new_head,
        "x": checkpoint_dir.name,
    }
    segment = {key: replacements.get(value, value) for key, value in segment.items()}
    segment["kind"] = "invalidated_segment"
    manifest["invalidation_state"] = {"invalidated": True, "segments": [segment]}
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

    with pytest.raises(ValueError, match="Git HEAD"):
        store.restore_checkpoint(checkpoint_dir, tmp_path / "fresh")


def test_preexisting_run_directory_symlink_is_rejected(tmp_path: Path):
    workspace = tmp_path / "workspace"
    _seed_workspace(workspace)
    outside = tmp_path / "outside-run"
    outside.mkdir()
    sentinel = outside / "sentinel.txt"
    sentinel.write_text("unchanged", encoding="utf-8")
    run_dir = tmp_path / "run"
    run_dir.symlink_to(outside, target_is_directory=True)

    with pytest.raises(ValueError, match="symlink"):
        checkpoint.CheckpointStore(run_dir, workspace, "masks-run-a", "inv-a")

    assert sentinel.read_text(encoding="utf-8") == "unchanged"
    assert sorted(path.name for path in outside.iterdir()) == ["sentinel.txt"]


def test_actions_symlink_is_rejected_before_and_after_initialization(tmp_path: Path):
    workspace = tmp_path / "workspace"
    _seed_workspace(workspace)
    outside = tmp_path / "outside-actions.jsonl"
    outside.write_text("", encoding="utf-8")
    run_dir = tmp_path / "run"
    run_dir.mkdir()
    ledger = run_dir / "actions.jsonl"
    ledger.symlink_to(outside)

    with pytest.raises(ValueError, match="symlink"):
        checkpoint.CheckpointStore(run_dir, workspace, "masks-run-a", "inv-a")
    assert outside.read_text(encoding="utf-8") == ""

    ledger.unlink()
    store = checkpoint.CheckpointStore(run_dir, workspace, "masks-run-a", "inv-a")
    ledger.symlink_to(outside)
    with pytest.raises(ValueError, match="symlink"):
        _append_one(store)
    assert outside.read_text(encoding="utf-8") == ""


def test_run_directory_replaced_by_symlink_after_init_is_rejected(tmp_path: Path):
    workspace = tmp_path / "workspace"
    _seed_workspace(workspace)
    run_dir = tmp_path / "run"
    store = checkpoint.CheckpointStore(run_dir, workspace, "masks-run-a", "inv-a")
    outside = tmp_path / "outside-run"
    outside.mkdir()
    run_dir.rmdir()
    run_dir.symlink_to(outside, target_is_directory=True)

    with pytest.raises(ValueError, match="symlink|replaced"):
        _append_one(store)
    assert not list(outside.iterdir())


def test_manifest_workspace_path_must_be_on_strict_allowlist(tmp_path: Path):
    store, checkpoint_dir, _, _, _ = _checkpoint(tmp_path)
    manifest_path = checkpoint_dir / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    entry = manifest["state_files"][0]
    protected = checkpoint_dir / entry["path"]
    injected = checkpoint_dir / "state" / ".env"
    injected.parent.mkdir(parents=True, exist_ok=True)
    protected.replace(injected)
    entry["path"] = "state/.env"
    entry["workspace_path"] = ".env"
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

    target = tmp_path / "fresh"
    with pytest.raises(ValueError, match="allowlist"):
        store.restore_checkpoint(checkpoint_dir, target)
    assert not target.exists()


def test_snapshot_open_rejects_source_swapped_to_symlink(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    workspace = tmp_path / "workspace"
    paths = _seed_workspace(workspace)
    store = checkpoint.CheckpointStore(
        tmp_path / "run", workspace, "masks-run-a", "inv-a"
    )
    _append_one(store)
    sentinel = tmp_path / "outside-source.pdf"
    sentinel.write_bytes(b"outside")
    original = checkpoint._open_regular_at
    attacked = False

    def attack(root_fd, relative, *args, **kwargs):
        nonlocal attacked
        if not attacked and Path(relative) == Path(
            ".coc/campaigns/masks-run-a/source/masks.pdf"
        ):
            attacked = True
            paths["source_pdf"].unlink()
            paths["source_pdf"].symlink_to(sentinel)
        return original(root_fd, relative, *args, **kwargs)

    monkeypatch.setattr(checkpoint, "_open_regular_at", attack)
    with pytest.raises(ValueError, match="symlink|regular"):
        store.write_checkpoint("sess_123", 1, "turn_complete")
    assert sentinel.read_bytes() == b"outside"


def test_checkpoint_revalidates_identity_from_the_bytes_it_snapshotted(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    workspace = tmp_path / "workspace"
    paths = _seed_workspace(workspace)
    store = checkpoint.CheckpointStore(
        tmp_path / "run", workspace, "masks-run-a", "inv-a"
    )
    _append_one(store)
    campaign_relative = Path(".coc/campaigns/masks-run-a/campaign.json")
    original = checkpoint._open_regular_at
    opens = 0

    def attack(root_fd, relative, *args, **kwargs):
        nonlocal opens
        if Path(relative) == campaign_relative:
            opens += 1
            if opens == 2:
                _write_json(paths["campaign_json"], {"campaign_id": "other"})
        return original(root_fd, relative, *args, **kwargs)

    monkeypatch.setattr(checkpoint, "_open_regular_at", attack)
    with pytest.raises(ValueError, match="campaign.*identity|identity.*campaign"):
        store.write_checkpoint("sess_123", 1, "turn_complete")
    assert not (store.run_dir / "checkpoints" / "turn-000001").exists()


def test_restore_uses_verified_fd_when_checkpoint_source_is_swapped(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    store, checkpoint_dir, _, _, _ = _checkpoint(tmp_path)
    manifest = json.loads(
        (checkpoint_dir / "manifest.json").read_text(encoding="utf-8")
    )
    entry = next(
        item
        for item in manifest["state_files"]
        if item["workspace_path"].endswith("/source/masks.pdf")
    )
    protected = checkpoint_dir / entry["path"]
    sentinel = tmp_path / "outside-checkpoint.pdf"
    sentinel.write_bytes(b"outside")
    original = checkpoint._open_regular_at
    attacked = False

    def attack(root_fd, relative, *args, **kwargs):
        nonlocal attacked
        if not attacked and Path(relative) == Path(entry["path"]):
            attacked = True
            protected.unlink()
            protected.symlink_to(sentinel)
        return original(root_fd, relative, *args, **kwargs)

    monkeypatch.setattr(checkpoint, "_open_regular_at", attack)
    target = tmp_path / "fresh"
    with pytest.raises(ValueError, match="symlink|regular"):
        store.restore_checkpoint(checkpoint_dir, target)
    assert sentinel.read_bytes() == b"outside"
    assert not target.exists()


def test_every_source_file_path_and_hash_is_manifest_compatible(tmp_path: Path):
    workspace = tmp_path / "workspace"
    paths = _seed_workspace(workspace)
    supplement = paths["source_pdf"].with_name("appendix.pdf")
    supplement.write_bytes(b"appendix source\n")
    run_dir = tmp_path / "run"
    store = checkpoint.CheckpointStore(run_dir, workspace, "masks-run-a", "inv-a")
    _append_one(store)
    checkpoint_dir = store.write_checkpoint("sess_123", 1, "turn_complete")
    manifest_path = checkpoint_dir / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

    assert set(manifest["source_hashes"]) == {
        ".coc/campaigns/masks-run-a/source/appendix.pdf",
        ".coc/campaigns/masks-run-a/source/masks.pdf",
    }
    manifest["source_hashes"][".coc/campaigns/masks-run-a/source/appendix.pdf"] = (
        "0" * 64
    )
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    with pytest.raises(ValueError, match="source"):
        store.restore_checkpoint(checkpoint_dir, tmp_path / "fresh")


def test_checkpoint_contains_and_restores_a_valid_action_journal(tmp_path: Path):
    store, checkpoint_dir, _, _, _ = _checkpoint(tmp_path)
    manifest = json.loads(
        (checkpoint_dir / "manifest.json").read_text(encoding="utf-8")
    )
    journal_path = f".coc/playtest-runs/{store.campaign_id}/actions.jsonl"
    assert any(
        entry["workspace_path"] == journal_path for entry in manifest["state_files"]
    )

    fresh = tmp_path / "fresh"
    _prepare_fresh_generation(fresh)
    store.restore_checkpoint(checkpoint_dir, fresh)
    resumed = checkpoint.CheckpointStore(
        fresh / journal_path.rsplit("/", 1)[0],
        fresh,
        store.campaign_id,
        store.investigator_id,
    )
    assert resumed.action_chain_sha256 == store.action_chain_sha256
    assert resumed._turn_number == 1


def test_restore_accepts_an_older_checkpoint_that_is_a_prefix_of_outer_journal(
    tmp_path: Path,
):
    store, checkpoint_dir, _, _, _ = _checkpoint(tmp_path)
    store.append_turn(
        {"kind": "later"},
        [{"kind": "later_event"}],
        {"turn": 1},
        {"turn": 2},
        _provenance(),
    )
    assert store._turn_number == 2
    target = tmp_path / "fresh"
    _prepare_fresh_generation(target)

    manifest = store.restore_checkpoint(checkpoint_dir, target)

    assert manifest["turn_number"] == 1
    restored_journal = (
        target / ".coc" / "playtest-runs" / "masks-run-a" / "actions.jsonl"
    )
    assert len(restored_journal.read_text(encoding="utf-8").splitlines()) == 1
    assert len(store.action_ledger.read_text(encoding="utf-8").splitlines()) == 2


def test_checkpoint_write_rejects_checkpoints_directory_swapped_after_open(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    workspace = tmp_path / "workspace"
    _seed_workspace(workspace)
    store = checkpoint.CheckpointStore(
        tmp_path / "run", workspace, "masks-run-a", "inv-a"
    )
    _append_one(store)
    outside = tmp_path / "outside-checkpoints"
    outside.mkdir()
    victim = tmp_path / "outside-victim"
    victim.mkdir()
    held = store.run_dir / "held-checkpoints"
    original = checkpoint._open_regular_at
    attacked = False

    def attack(root_fd, relative, *args, **kwargs):
        nonlocal attacked
        if not attacked and Path(relative) == Path(
            ".coc/campaigns/masks-run-a/source/masks.pdf"
        ):
            attacked = True
            checkpoints = store.run_dir / "checkpoints"
            checkpoints.rename(held)
            temporary = next(held.iterdir())
            (outside / temporary.name).symlink_to(victim, target_is_directory=True)
            checkpoints.symlink_to(outside, target_is_directory=True)
        return original(root_fd, relative, *args, **kwargs)

    monkeypatch.setattr(checkpoint, "_open_regular_at", attack)
    with pytest.raises(ValueError, match="symlink|replace"):
        store.write_checkpoint("sess_123", 1, "turn_complete")

    assert attacked is True
    assert not list(victim.iterdir())


def test_restore_rejects_target_ancestor_swapped_before_temp_open(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    store, checkpoint_dir, _, _, _ = _checkpoint(tmp_path)
    target = tmp_path / "fresh"
    _prepare_fresh_generation(target)
    (target / ".coc" / "campaigns").mkdir(parents=True, exist_ok=True)
    held = target / "held-campaigns"
    victim = tmp_path / "outside-target-victim"
    victim_source = victim / "masks-run-a" / "source"
    victim_source.mkdir(parents=True)
    original_open = checkpoint.os.open
    attacked = False

    def attack(path, flags, mode=0o777, *, dir_fd=None):
        nonlocal attacked
        if (
            not attacked
            and path != ".campaign.lock"
            and flags & checkpoint.os.O_WRONLY
            and flags & checkpoint.os.O_CREAT
            and flags & checkpoint.os.O_EXCL
        ):
            attacked = True
            (target / ".coc" / "campaigns").rename(held)
            (target / ".coc" / "campaigns").symlink_to(victim, target_is_directory=True)
        return original_open(path, flags, mode, dir_fd=dir_fd)

    monkeypatch.setattr(checkpoint.os, "open", attack)
    with pytest.raises(ValueError, match="symlink|replace"):
        store.restore_checkpoint(checkpoint_dir, target)

    assert attacked is True
    assert not list(victim_source.iterdir())


def test_restore_hashes_live_sources_through_verified_workspace_fd(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    store, checkpoint_dir, _, _, paths = _checkpoint(tmp_path)
    sentinel = tmp_path / "outside-live-source.pdf"
    sentinel.write_bytes(paths["source_pdf"].read_bytes())
    original = checkpoint._open_regular_at
    attacked = False

    def attack(root_fd, relative, *args, **kwargs):
        nonlocal attacked
        if not attacked and Path(relative) == Path(
            ".coc/campaigns/masks-run-a/source/masks.pdf"
        ):
            attacked = True
            paths["source_pdf"].unlink()
            paths["source_pdf"].symlink_to(sentinel)
        return original(root_fd, relative, *args, **kwargs)

    monkeypatch.setattr(checkpoint, "_open_regular_at", attack)
    target = tmp_path / "fresh"
    with pytest.raises(ValueError, match="source|symlink|regular"):
        store.restore_checkpoint(checkpoint_dir, target)

    assert attacked is True
    assert not target.exists()


def test_workspace_root_identity_survives_stable_ancestor_but_rejects_retarget(
    tmp_path: Path,
):
    root_a = tmp_path / "root-a"
    root_b = tmp_path / "root-b"
    workspace_a = root_a / "workspace"
    workspace_b = root_b / "workspace"
    _seed_workspace(workspace_a)
    _seed_workspace(workspace_b)
    alias = tmp_path / "workspace-parent"
    alias.symlink_to(root_a, target_is_directory=True)
    workspace = alias / "workspace"
    store = checkpoint.CheckpointStore(
        tmp_path / "run", workspace, "masks-run-a", "inv-a"
    )
    _append_one(store)

    alias.unlink()
    alias.symlink_to(root_b, target_is_directory=True)

    with pytest.raises(ValueError, match="workspace.*replace|replace.*workspace"):
        store.write_checkpoint("sess_123", 1, "turn_complete")
    assert not (store.run_dir / "checkpoints").exists()


def test_workspace_ancestor_aba_cannot_select_names_from_replacement_root(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    root_a = tmp_path / "root-a"
    root_b = tmp_path / "root-b"
    workspace_a = root_a / "workspace"
    workspace_b = root_b / "workspace"
    _seed_workspace(workspace_a)
    paths_b = _seed_workspace(workspace_b)
    paths_b["scenario"].unlink()
    alias = tmp_path / "workspace-parent"
    alias.symlink_to(root_a, target_is_directory=True)
    store = checkpoint.CheckpointStore(
        tmp_path / "run", alias / "workspace", "masks-run-a", "inv-a"
    )
    _append_one(store)
    original = store._workspace_files

    def aba_workspace_files():
        alias.unlink()
        alias.symlink_to(root_b, target_is_directory=True)
        try:
            yield from original()
        finally:
            alias.unlink()
            alias.symlink_to(root_a, target_is_directory=True)

    monkeypatch.setattr(store, "_workspace_files", aba_workspace_files)
    checkpoint_dir = store.write_checkpoint("sess_123", 1, "turn_complete")
    manifest = json.loads(
        (checkpoint_dir / "manifest.json").read_text(encoding="utf-8")
    )

    assert (
        ".coc/campaigns/masks-run-a/scenario/hotel.json" in manifest["scenario_hashes"]
    )


def test_checkpoint_validates_live_journal_before_publication(tmp_path: Path):
    workspace = tmp_path / "workspace"
    _seed_workspace(workspace)
    store = checkpoint.CheckpointStore(
        tmp_path / "run", workspace, "masks-run-a", "inv-a"
    )
    ledger = _append_one(store)
    row = json.loads(ledger.read_text(encoding="utf-8"))
    row["action"]["target"] = "tampered live journal"
    row["row_sha256"] = _canonical_sha256(
        {key: value for key, value in row.items() if key != "row_sha256"}
    )
    ledger.write_text(
        json.dumps(row, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        + "\n",
        encoding="utf-8",
    )

    with pytest.raises(ValueError, match="journal|action chain"):
        store.write_checkpoint("sess_123", 1, "turn_complete")
    assert not (store.run_dir / "checkpoints").exists()


def test_restore_rejects_tampered_rehashed_action_journal(tmp_path: Path):
    store, checkpoint_dir, _, _, _ = _checkpoint(tmp_path)
    manifest_path = checkpoint_dir / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    journal_entry = next(
        entry
        for entry in manifest["state_files"]
        if entry["workspace_path"].endswith("/actions.jsonl")
    )
    journal = checkpoint_dir / journal_entry["path"]
    row = json.loads(journal.read_text(encoding="utf-8"))
    row["action"]["target"] = "tampered target"
    row["row_sha256"] = _canonical_sha256(
        {key: value for key, value in row.items() if key != "row_sha256"}
    )
    payload = (
        json.dumps(row, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        + "\n"
    ).encode("utf-8")
    journal.write_bytes(payload)
    journal_entry["sha256"] = hashlib.sha256(payload).hexdigest()
    journal_entry["size"] = len(payload)
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

    target = tmp_path / "fresh"
    with pytest.raises(ValueError, match="journal|action chain"):
        store.restore_checkpoint(checkpoint_dir, target)
    assert not target.exists()


def test_restore_rejects_rehashed_journal_with_nonsequential_first_turn(
    tmp_path: Path,
):
    store, checkpoint_dir, _, _, _ = _checkpoint(tmp_path)
    manifest_path = checkpoint_dir / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    journal_entry = next(
        entry
        for entry in manifest["state_files"]
        if entry["workspace_path"].endswith("/actions.jsonl")
    )
    journal = checkpoint_dir / journal_entry["path"]
    row = json.loads(journal.read_text(encoding="utf-8"))
    row["turn_number"] = 2
    row["row_sha256"] = _canonical_sha256(
        {key: value for key, value in row.items() if key != "row_sha256"}
    )
    payload = (
        json.dumps(row, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        + "\n"
    ).encode("utf-8")
    journal.write_bytes(payload)
    journal_entry["sha256"] = hashlib.sha256(payload).hexdigest()
    journal_entry["size"] = len(payload)
    manifest["action_chain_sha256"] = row["row_sha256"]
    manifest["turn_number"] = 2
    store.action_chain_sha256 = row["row_sha256"]
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

    target = tmp_path / "fresh"
    with pytest.raises(ValueError, match="journal.*turn|turn.*journal"):
        store.restore_checkpoint(checkpoint_dir, target)
    assert not target.exists()


def test_restore_rejects_rehashed_noncanonical_crlf_journal(tmp_path: Path):
    store, checkpoint_dir, _, _, _ = _checkpoint(tmp_path)
    manifest_path = checkpoint_dir / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    journal_entry = next(
        entry
        for entry in manifest["state_files"]
        if entry["workspace_path"].endswith("/actions.jsonl")
    )
    journal = checkpoint_dir / journal_entry["path"]
    payload = journal.read_bytes().replace(b"\n", b"\r\n")
    journal.write_bytes(payload)
    journal_entry["sha256"] = hashlib.sha256(payload).hexdigest()
    journal_entry["size"] = len(payload)
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

    target = tmp_path / "fresh"
    with pytest.raises(ValueError, match="journal.*canonical|canonical.*journal"):
        store.restore_checkpoint(checkpoint_dir, target)
    assert not target.exists()


@pytest.mark.parametrize("turn_number", [True, 1.0, "1", -1, 0, 2])
def test_checkpoint_turn_must_equal_current_integer_turn_before_publication(
    tmp_path: Path, turn_number: object
):
    workspace = tmp_path / "workspace"
    _seed_workspace(workspace)
    store = checkpoint.CheckpointStore(
        tmp_path / "run", workspace, "masks-run-a", "inv-a"
    )
    _append_one(store)

    with pytest.raises(ValueError, match="turn"):
        store.write_checkpoint("sess_123", turn_number, "turn_complete")
    assert not (store.run_dir / "checkpoints").exists()


@pytest.mark.parametrize(
    "model_identity",
    [
        {"provider": "openai", "id": "gpt-test", "api_key": "not-a-real-secret"},
        {"provider": "openai", "id": "gpt-test", "token": "not-a-real-token"},
        {"provider": "", "id": "gpt-test"},
        {"provider": "open ai", "id": "gpt-test"},
        {"provider": "openai", "id": ""},
        {"provider": "openai", "id": "gpt-test\nforged"},
        ["openai", "gpt-test"],
    ],
)
def test_checkpoint_rejects_unsafe_model_identity_before_publication(
    tmp_path: Path, model_identity: object
):
    workspace = tmp_path / "workspace"
    _seed_workspace(workspace)
    store = checkpoint.CheckpointStore(
        tmp_path / "run", workspace, "masks-run-a", "inv-a"
    )
    provenance = {
        "player_mode": "whitebox",
        "model_identity": model_identity,
        "recording_mode": "sync",
        "recording_flush": "manual",
        "runtime_receipt_sha256": _runtime_receipt_sha256(),
        "request_id": "req-1",
    }
    _append_with_provenance(store, provenance)

    with pytest.raises(ValueError, match="model identity"):
        store.write_checkpoint("sess_123", 1, "turn_complete")
    assert not (store.run_dir / "checkpoints").exists()


@pytest.mark.parametrize("identity_mode", ["absent", "none", "empty"])
def test_checkpoint_normalizes_absent_or_empty_model_identity(
    tmp_path: Path, identity_mode: str
):
    workspace = tmp_path / "workspace"
    _seed_workspace(workspace)
    store = checkpoint.CheckpointStore(
        tmp_path / "run", workspace, "masks-run-a", "inv-a"
    )
    provenance: dict[str, object] = {
        "player_mode": "whitebox",
        "recording_mode": "sync",
        "recording_flush": "manual",
        "runtime_receipt_sha256": _runtime_receipt_sha256(),
        "request_id": "req-1",
    }
    if identity_mode == "none":
        provenance["model_identity"] = None
    if identity_mode == "empty":
        provenance["model_identity"] = {}
    _append_with_provenance(store, provenance)

    checkpoint_dir = store.write_checkpoint("sess_123", 1, "turn_complete")
    manifest = json.loads(
        (checkpoint_dir / "manifest.json").read_text(encoding="utf-8")
    )
    assert manifest["model_identity"] == {}


def test_restore_rejects_manifest_model_identity_with_extra_fields(tmp_path: Path):
    store, checkpoint_dir, _, _, _ = _checkpoint(tmp_path)
    manifest_path = checkpoint_dir / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["model_identity"]["api_key"] = "not-a-real-secret"
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

    target = tmp_path / "fresh"
    with pytest.raises(ValueError, match="model identity"):
        store.restore_checkpoint(checkpoint_dir, target)
    assert not target.exists()
