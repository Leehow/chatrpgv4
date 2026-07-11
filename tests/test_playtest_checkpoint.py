import copy
import hashlib
import importlib.util
import json
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


def _seed_workspace(
    workspace: Path,
    *,
    campaign_id: str = "masks-run-a",
    investigator_id: str = "inv-a",
) -> dict[str, Path]:
    campaign = workspace / "campaigns" / campaign_id
    source_pdf = campaign / "source" / "masks.pdf"
    source_pdf.parent.mkdir(parents=True, exist_ok=True)
    source_pdf.write_bytes(b"masks source pdf\n")
    _write_json(campaign / "scenario" / "index.json", {"scenes": ["hotel"]})
    _write_json(
        campaign / "scenario" / "hotel.json",
        {"id": "hotel", "clues": ["ledger"]},
    )
    investigator = workspace / "investigators" / f"{investigator_id}.json"
    _write_json(investigator, {"id": investigator_id, "hp": 10})
    sessions = workspace / ".coc" / "runtime" / "sessions.json"
    _write_json(sessions, {"sess_123": {"campaign_id": campaign_id}})

    # These are deliberately in the workspace but outside the checkpoint allowlist.
    (workspace / ".env").write_text("SECRET=do-not-copy\n", encoding="utf-8")
    _write_json(workspace / "node_modules" / "worker" / "state.json", {"pid": 7})
    _write_json(
        workspace / ".coc" / "runtime.json",
        {"workspace": str(workspace.resolve()), "api_key_file": "/tmp/secret"},
    )
    return {
        "campaign": campaign,
        "source_pdf": source_pdf,
        "scenario_index": campaign / "scenario" / "index.json",
        "scenario": campaign / "scenario" / "hotel.json",
        "investigator": investigator,
        "sessions": sessions,
    }


def _provenance(*, player_mode: str = "whitebox") -> dict[str, object]:
    return {
        "player_mode": player_mode,
        "model_identity": {
            "provider": "openai",
            "model": "gpt-test",
            "snapshot": "2026-07-12",
        },
        "request_id": "req-1",
    }


def _append_one(store) -> Path:
    return store.append_turn(
        {"kind": "investigate", "target": "hotel ledger"},
        [{"kind": "clue_discovered", "clue_id": "ledger"}],
        {"turn": 0, "hp": 10},
        {"turn": 1, "hp": 10},
        _provenance(),
    )


def _checkpoint(tmp_path: Path):
    workspace = tmp_path / "workspace"
    paths = _seed_workspace(workspace)
    run_dir = tmp_path / "runs" / "masks-run-a"
    store = checkpoint.CheckpointStore(
        run_dir, workspace, "masks-run-a", "inv-a"
    )
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
    rows = [json.loads(line) for line in turn_path.read_text(encoding="utf-8").splitlines()]
    assert len(rows) == 1
    row = rows[0]
    assert row["turn_number"] == 1
    assert row["previous_sha256"] == checkpoint.GENESIS_SHA256
    assert row["row_sha256"] == _canonical_sha256(
        {key: value for key, value in row.items() if key != "row_sha256"}
    )
    assert store.action_chain_sha256 == row["row_sha256"]
    assert not list(store.run_dir.rglob("*.tmp"))

    manifest = json.loads((checkpoint_dir / "manifest.json").read_text(encoding="utf-8"))
    required = {
        "schema_version",
        "run_id",
        "turn_number",
        "git_head",
        "source_pdf_sha256",
        "scenario_hashes",
        "state_files",
        "session_snapshot_sha256",
        "action_chain_sha256",
        "model_identity",
        "invalidation_state",
        "player_mode",
    }
    assert required <= manifest.keys()
    assert manifest["run_id"] == "masks-run-a"
    assert manifest["turn_number"] == 1
    assert manifest["action_chain_sha256"] == store.action_chain_sha256
    assert manifest["model_identity"]["model"] == "gpt-test"
    assert manifest["invalidation_state"] == {"invalidated": False, "segments": []}
    assert manifest["state_files"]


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

    rows = [json.loads(line) for line in ledger.read_text(encoding="utf-8").splitlines()]
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

    resumed = checkpoint.CheckpointStore(
        run_dir, workspace, "masks-run-a", "inv-a"
    )
    resumed.append_turn(
        {"kind": "listen"},
        [],
        {"turn": 1},
        {"turn": 2},
        _provenance(),
    )

    rows = [json.loads(line) for line in ledger.read_text(encoding="utf-8").splitlines()]
    assert [row["turn_number"] for row in rows] == [1, 2]
    assert rows[1]["previous_sha256"] == rows[0]["row_sha256"]


def test_restore_rejects_a_checkpoint_file_checksum_mismatch(tmp_path: Path):
    store, checkpoint_dir, _, _, _ = _checkpoint(tmp_path)
    manifest = json.loads((checkpoint_dir / "manifest.json").read_text(encoding="utf-8"))
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
    (target / "campaigns").symlink_to(outside, target_is_directory=True)

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

    restored = store.restore_checkpoint(checkpoint_dir, fresh)

    assert restored["turn_number"] == 1
    assert restored["action_chain_sha256"] == store.action_chain_sha256
    for source in paths.values():
        if not source.is_file():
            continue
        relative = source.relative_to(workspace)
        assert (fresh / relative).read_bytes() == source.read_bytes()
    assert (fresh / ".coc" / "playtest-runs" / "masks-run-a").is_dir()
    assert not (fresh / ".env").exists()
    assert not (fresh / "node_modules").exists()
    assert not (fresh / ".coc" / "runtime.json").exists()


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


def test_existing_target_sources_must_match_checkpoint(tmp_path: Path):
    store, checkpoint_dir, _, _, _ = _checkpoint(tmp_path)
    target = tmp_path / "target"
    paths = _seed_workspace(target)
    paths["source_pdf"].write_bytes(b"a different source")
    sentinel = target / "keep.txt"
    sentinel.write_text("unchanged", encoding="utf-8")

    with pytest.raises(ValueError, match="source"):
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
    restored = store.restore_checkpoint(checkpoint_dir, tmp_path / "allowed")

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
    store = checkpoint.CheckpointStore(tmp_path / "run", workspace, "masks-run-a", "inv-a")
    _append_one(store)
    sentinel = tmp_path / "outside-source.pdf"
    sentinel.write_bytes(b"outside")
    original = checkpoint._open_regular_at
    attacked = False

    def attack(root_fd, relative, *args, **kwargs):
        nonlocal attacked
        if not attacked and Path(relative) == Path("campaigns/masks-run-a/source/masks.pdf"):
            attacked = True
            paths["source_pdf"].unlink()
            paths["source_pdf"].symlink_to(sentinel)
        return original(root_fd, relative, *args, **kwargs)

    monkeypatch.setattr(checkpoint, "_open_regular_at", attack)
    with pytest.raises(ValueError, match="symlink|regular"):
        store.write_checkpoint("sess_123", 1, "turn_complete")
    assert sentinel.read_bytes() == b"outside"


def test_restore_uses_verified_fd_when_checkpoint_source_is_swapped(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    store, checkpoint_dir, _, _, _ = _checkpoint(tmp_path)
    manifest = json.loads((checkpoint_dir / "manifest.json").read_text(encoding="utf-8"))
    entry = next(
        item for item in manifest["state_files"]
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
        "campaigns/masks-run-a/source/appendix.pdf",
        "campaigns/masks-run-a/source/masks.pdf",
    }
    manifest["source_hashes"]["campaigns/masks-run-a/source/appendix.pdf"] = "0" * 64
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    with pytest.raises(ValueError, match="source"):
        store.restore_checkpoint(checkpoint_dir, tmp_path / "fresh")


def test_checkpoint_contains_and_restores_a_valid_action_journal(tmp_path: Path):
    store, checkpoint_dir, _, _, _ = _checkpoint(tmp_path)
    manifest = json.loads((checkpoint_dir / "manifest.json").read_text(encoding="utf-8"))
    journal_path = f".coc/playtest-runs/{store.campaign_id}/actions.jsonl"
    assert any(entry["workspace_path"] == journal_path for entry in manifest["state_files"])

    fresh = tmp_path / "fresh"
    store.restore_checkpoint(checkpoint_dir, fresh)
    resumed = checkpoint.CheckpointStore(
        fresh / journal_path.rsplit("/", 1)[0],
        fresh,
        store.campaign_id,
        store.investigator_id,
    )
    assert resumed.action_chain_sha256 == store.action_chain_sha256
    assert resumed._turn_number == 1


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
            "campaigns/masks-run-a/source/masks.pdf"
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
    (target / "campaigns").mkdir(parents=True)
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
            and flags & checkpoint.os.O_WRONLY
            and flags & checkpoint.os.O_CREAT
            and flags & checkpoint.os.O_EXCL
        ):
            attacked = True
            (target / "campaigns").rename(held)
            (target / "campaigns").symlink_to(victim, target_is_directory=True)
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
            "campaigns/masks-run-a/source/masks.pdf"
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
