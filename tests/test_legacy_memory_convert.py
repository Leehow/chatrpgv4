"""Deterministic tests for the legacy Markdown-card -> temporal-memory-1
converter (``coc_legacy_memory_convert.py``).

Laws under test: the source campaign AND its Git sidecar are read-only
byte-for-byte; the target is a fresh exact-current-schema generation built
in staging and published atomically with its completion receipt; provenance
is proven from the ACTIVE lineage only (never ``--all`` selection); terminal
hooks are materialized by the converter with the VERIFIED resolution
commit/turn/receipt; only proven records import, everything else
quarantines; relationships resolve an EXACT investigator owner or
quarantine; replay re-verifies source Git + target store/manifest before
idempotent success; tampering and drift fail closed; crash at any phase is
resumable and converges.
"""

from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import re
import subprocess
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


conv = _load("coc_legacy_memory_convert", SCRIPTS / "coc_legacy_memory_convert.py")
coc_state = _load("coc_state", SCRIPTS / "coc_state.py")
hist = _load("coc_git_history", SCRIPTS / "coc_git_history.py")
tm = _load("coc_temporal_memory_under_test", SCRIPTS / "coc_temporal_memory.py")

SCHEMA = hist.format_schema_generation(coc_state.CURRENT_SCHEMA_VERSIONS)

SRC = "src-camp"
TGT = "src-camp-temporal-import-1"


@pytest.fixture(autouse=True)
def isolated_git_home(tmp_path, monkeypatch):
    home = tmp_path / "_empty_home"
    home.mkdir()
    monkeypatch.setenv("HOME", str(home))
    for key in (
        "XDG_CONFIG_HOME",
        "GIT_CONFIG_GLOBAL",
        "GIT_CONFIG_SYSTEM",
        "GIT_DIR",
        "GIT_WORK_TREE",
        "GIT_INDEX_FILE",
        "GIT_AUTHOR_NAME",
        "GIT_AUTHOR_EMAIL",
        "GIT_COMMITTER_NAME",
        "GIT_COMMITTER_EMAIL",
        "GIT_AUTHOR_DATE",
        "GIT_COMMITTER_DATE",
    ):
        monkeypatch.delenv(key, raising=False)


# ---------------------------------------------------------------------------
# Fixture builders
# ---------------------------------------------------------------------------


def _camp(root: Path, campaign_id: str) -> Path:
    return root / ".coc" / "campaigns" / campaign_id


def _make_source(root: Path, campaign_id: str = SRC, *, party: bool = False) -> Path:
    coc_state.create_campaign(root, campaign_id, "Source table", era="1920s")
    camp = _camp(root, campaign_id)
    if party:
        _write_party(camp, campaign_id, ["inv-x04743292"])
    return camp


def _write_party(camp: Path, campaign_id: str, investigator_ids: list[str]) -> None:
    (camp / "party.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "campaign_id": campaign_id,
                "investigator_ids": investigator_ids,
                "active_investigator_ids": investigator_ids,
            }
        )
        + "\n",
        encoding="utf-8",
    )


def _make_raw_source(root: Path, campaign_id: str = SRC) -> Path:
    """Campaign directory WITHOUT calling create_campaign (no git sidecar,
    no canonical runtime files) for provenance-negative fixtures."""
    camp = _camp(root, campaign_id)
    camp.mkdir(parents=True)
    (camp / "campaign.json").write_text(
        json.dumps(
            {
                "schema_version": int(coc_state.CURRENT_SCHEMA_VERSIONS["campaign"]),
                "campaign_id": campaign_id,
                "title": "Raw source",
                "play_language": "zh-Hans",
            }
        )
        + "\n",
        encoding="utf-8",
    )
    return camp


def _write_card(camp: Path, privacy_dir: str, name: str, text: str) -> None:
    d = camp / "memory" / "cards" / privacy_dir
    d.mkdir(parents=True, exist_ok=True)
    (d / name).write_text(text, encoding="utf-8")


def _card(
    memory_id: str,
    kind: str,
    privacy: str,
    body: str,
    *,
    entities: list[str] | None = None,
    status: str | None = None,
    introduced_at: str | None = None,
    resolved_at: str | None = None,
    resolution_reason: str | None = None,
    possible_payoff: str | None = None,
    scope: str = "campaign",
) -> str:
    lines = [
        "---",
        f"memory_id: {memory_id}",
        f"kind: {kind}",
        f"scope: {scope}",
        f"privacy: {privacy}",
        "salience: 0.5",
    ]
    if status is not None:
        lines.append(f"status: {status}")
    if introduced_at is not None:
        lines.append(f"introduced_at: {introduced_at}")
    if resolved_at is not None:
        lines.append(f"resolved_at: {resolved_at}")
    if resolution_reason is not None:
        lines.append(f"resolution_reason: {resolution_reason}")
    if possible_payoff is not None:
        lines.append(f"possible_payoff: {possible_payoff}")
    lines.append("entities:")
    lines += [f"  - {e}" for e in (entities or [])]
    lines += ["tags:", "  - legacy-import-test"]
    lines += ["---", "", body, ""]
    return "\n".join(lines)


def _commit_turn(root: Path, campaign_id: str, turn: int, fin: str) -> str:
    return hist.commit_finalized_turn(
        root,
        campaign_id,
        turn_number=turn,
        finalization_id=fin,
        journal_decision_id=f"jrnl-{turn}",
        settlement_snapshot_id=f"snap-{turn}",
        rendered_text_sha256="0" * 64,
        schema_generation=SCHEMA,
    )


def _git_raw(
    root: Path,
    campaign_id: str,
    *args: str,
    env_extra: dict[str, str] | None = None,
    worktree: bool = True,
) -> str:
    cmd = ["git", f"--git-dir={hist.repo_path_for(root, campaign_id)}"]
    if worktree:
        cmd.append(f"--work-tree={_camp(root, campaign_id)}")
    cmd.extend(args)
    env = os.environ.copy()
    env.update(
        GIT_CONFIG_NOSYSTEM="1",
        GIT_CONFIG_GLOBAL=os.devnull,
        GIT_CONFIG_SYSTEM=os.devnull,
    )
    if env_extra:
        env.update(env_extra)
    completed = subprocess.run(
        cmd,
        cwd=str(_camp(root, campaign_id)),
        env=env,
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=True,
    )
    return completed.stdout


def _commit_card_on_fork(
    root: Path,
    campaign_id: str,
    card_relpath: str,
    content_file: Path,
    fork_ref: str = "refs/heads/timelines/tl-fork",
) -> str:
    """Create a fork-lineage commit containing one extra card WITHOUT ever
    committing it on the active lineage or mutating the worktree."""
    repo_args = [f"--git-dir={hist.repo_path_for(root, campaign_id)}"]
    index = root / "_fork-index"
    blob = _git_raw(root, campaign_id, "hash-object", "-w", str(content_file)).strip()
    _git_raw(
        root,
        campaign_id,
        "read-tree",
        "refs/heads/main",
        env_extra={"GIT_INDEX_FILE": str(index)},
        worktree=False,
    )
    _git_raw(
        root,
        campaign_id,
        "update-index",
        "--add",
        "--cacheinfo",
        f"100644,{blob},{card_relpath}",
        env_extra={"GIT_INDEX_FILE": str(index)},
        worktree=False,
    )
    tree = _git_raw(
        root,
        campaign_id,
        "write-tree",
        env_extra={"GIT_INDEX_FILE": str(index)},
        worktree=False,
    ).strip()
    commit = _git_raw(
        root,
        campaign_id,
        "commit-tree",
        tree,
        "-p",
        "refs/heads/main",
        "-m",
        "fork-only card",
        worktree=False,
    ).strip()
    _git_raw(root, campaign_id, "update-ref", fork_ref, commit, worktree=False)
    index.unlink(missing_ok=True)
    return commit


def _tree_digest(camp: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    for path in sorted(camp.rglob("*")):
        if path.is_file() and not path.is_symlink():
            out[path.relative_to(camp).as_posix()] = hashlib.sha256(
                path.read_bytes()
            ).hexdigest()
    return out


def _dir_digest(camp: Path) -> dict[str, str]:
    if not camp.exists():
        return {}
    return _tree_digest(camp)


def _store_digests(camp: Path) -> dict[str, str]:
    temporal = camp / "memory" / "temporal"
    out: dict[str, str] = {}
    if temporal.is_dir():
        for path in sorted(temporal.iterdir()):
            if path.is_file() and not path.is_symlink():
                out[path.name] = hashlib.sha256(path.read_bytes()).hexdigest()
    return out


def _import(root: Path, **kwargs):
    return conv.convert_legacy_memory(
        root, source_campaign=SRC, target_campaign=TGT, **kwargs
    )


def _find_commit_by_finalization(root: Path, campaign_id: str, fin: str) -> str:
    for sha, body in hist._commit_log_records(
        hist.repo_path_for(root, campaign_id), _camp(root, campaign_id), all_refs=True
    ):
        if hist.parse_trailers(body).get("Finalization-Id") == fin:
            return sha
    raise AssertionError(f"commit with Finalization-Id {fin} not found")


def _read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


_OPAQUE_PUBLIC_KEY_PARTS = (
    "commit",
    "digest",
    "hash",
    "oid",
    "ref",
    "sha256",
    "snapshot",
    "tree",
)
_OPAQUE_HEX = re.compile(r"(?i)(?<![0-9a-f])[0-9a-f]{40,64}(?![0-9a-f])")


def _assert_public_json_is_semantic(payload: dict) -> None:
    """CLI results may name semantic state, never integrity evidence."""
    def walk(value):
        if isinstance(value, dict):
            for key, child in value.items():
                assert not any(part in key.lower() for part in _OPAQUE_PUBLIC_KEY_PARTS)
                walk(child)
        elif isinstance(value, list):
            for child in value:
                walk(child)
        elif isinstance(value, str):
            assert "refs/" not in value
            assert _OPAQUE_HEX.search(value) is None

    walk(payload)


# ---------------------------------------------------------------------------
# Shapes + provenance
# ---------------------------------------------------------------------------


def test_import_all_shapes_with_provenance(tmp_path):
    root = tmp_path
    src = _make_source(root, party=True)
    _write_card(src, "player-safe", "fact-a.md",
                _card("fact-a", "fact", "player_safe", "书房的暗门通向地下室。",
                      entities=["npc-butler-1"]))
    _write_card(src, "player-safe", "event-b.md",
                _card("event-b", "event", "player_safe", "第二幕聚餐发生火灾。"))
    _write_card(src, "keeper-only", "rel-c.md",
                _card("rel-c", "npc_relationship", "keeper_only",
                      "管家对调查员保持表面礼貌、暗中戒备。",
                      entities=["npc-butler-1", "inv-x04743292"]))
    _write_card(src, "player-safe", "pref-d.md",
                _card("pref-d", "player_preference", "player_safe",
                      "玩家偏好慢节奏调查与氛围描写。"))
    _write_card(src, "keeper-only", "corr-e.md",
                _card("corr-e", "keeper_correction", "keeper_only",
                      "KP 更正：图书馆检定用的是图书馆而非侦查。"))
    _commit_turn(root, SRC, 3, "fin-turn-3")

    before = _tree_digest(src)
    sidecar_before = _dir_digest(root / ".coc" / "repos" / "campaigns" / f"{SRC}.git")
    result = _import(root)
    after = _tree_digest(src)
    sidecar_after = _dir_digest(root / ".coc" / "repos" / "campaigns" / f"{SRC}.git")

    assert result["counts"]["cards_discovered"] == 5
    assert result["counts"]["cards_imported"] == 5
    assert result["counts"]["cards_quarantined"] == 0
    assert result["replay"] is False
    assert result["source_lineage"] == {"timeline_id": "tl-main"}
    # source campaign AND its Git sidecar byte-for-byte preservation
    assert before == after
    assert sidecar_before == sidecar_after

    tgt = _camp(root, TGT)
    campaign = _read_json(tgt / "campaign.json")
    assert campaign["schema_version"] == int(
        coc_state.CURRENT_SCHEMA_VERSIONS["campaign"]
    )
    assert campaign["campaign_id"] == TGT

    turn3_sha = _find_commit_by_finalization(root, SRC, "fin-turn-3")
    assertions = tm.load_assertions(tgt)
    fact = assertions[conv.target_assertion_id(TGT, "fact-a")]
    assert fact["kind"] == "world_event"
    assert fact["subject_id"] == f"subject-world-{TGT}"
    assert fact["privacy"] == "player_safe"
    assert fact["statement"] == "书房的暗门通向地下室。"
    assert fact["source_commit"] == turn3_sha
    assert fact["source_turn"] == 3
    assert fact["source_receipts"] == ["fin-turn-3"]
    assert fact["valid_from_turn"] == 3
    assert fact["entities"] == ["entity-person-butler-1"]

    # exact directional investigator relationship (never broadened to party)
    rel = assertions[conv.target_assertion_id(TGT, "rel-c")]
    assert rel["kind"] == "relationship"
    assert rel["subject_id"] == "subject-investigator-inv-x04743292"
    assert rel["knowers"] == ["subject-investigator-inv-x04743292"]
    assert rel["entities"] == ["entity-person-butler-1"]
    assert rel["privacy"] == "keeper_only"
    subjects = tm.load_subjects(tgt)
    owner = subjects["subject-investigator-inv-x04743292"]
    assert owner["kind"] == "investigator"
    assert owner["display_name"] == "inv-x04743292"

    pref = assertions[conv.target_assertion_id(TGT, "pref-d")]
    assert pref["kind"] == "player_preference"
    assert pref["subject_id"] == "subject-player-table"
    corr = assertions[conv.target_assertion_id(TGT, "corr-e")]
    assert corr["kind"] == "keeper_correction"
    assert corr["subject_id"] == "subject-keeper-table"

    receipt = _read_json(
        tgt / "memory" / "legacy-import" / "conversion-receipt.json"
    )
    assert receipt["status"] == "complete"
    assert receipt["source_campaign_id"] == SRC
    assert receipt["source_byte_preservation_verified"] is True
    manifest = _read_json(tgt / "memory" / "legacy-import" / "import-manifest.json")
    # Integrity remains in internal evidence, never the public result.
    assert receipt["source_snapshot_digest"] == manifest["source_snapshot"]["digest"]
    assert receipt["source_git_digest"] == manifest["source_git"]["digest"]
    assert manifest["source_git"]["active_ref"] == "refs/heads/main"
    assert manifest["source_git"]["provenance_commits_digest"]

    tm.contract.validate_assertion_bundle(list(assertions.values()))


def test_relationship_without_proven_owner_quarantines(tmp_path):
    root = tmp_path
    src = _make_source(root, party=False)
    _write_card(src, "keeper-only", "rel-c.md",
                _card("rel-c", "npc_relationship", "keeper_only",
                      "无法证明归属的关系。",
                      entities=["npc-butler-1", "inv-x04743292"]))
    _commit_turn(root, SRC, 3, "fin-turn-3")

    result = _import(root)
    assert result["counts"]["cards_imported"] == 0
    assert (
        result["cards"][0]["quarantine_reason"] == "unprovable_relationship_owner"
    )
    assert tm.load_assertions(_camp(root, TGT)) == {}


def test_relationship_with_wrong_party_id_quarantines(tmp_path):
    root = tmp_path
    src = _make_source(root, party=True)  # party ids: inv-x04743292 only
    _write_card(src, "keeper-only", "rel-c.md",
                _card("rel-c", "npc_relationship", "keeper_only",
                      "归属另一个未入场调查员的关系。",
                      entities=["npc-butler-1", "inv-someoneelse"]))
    _commit_turn(root, SRC, 3, "fin-turn-3")

    result = _import(root)
    assert result["counts"]["cards_imported"] == 0
    assert (
        result["cards"][0]["quarantine_reason"] == "unprovable_relationship_owner"
    )


def test_paid_off_hook_binds_verified_resolution_provenance(tmp_path):
    root = tmp_path
    src = _make_source(root)
    _write_card(src, "keeper-only", "hook-h.md",
                _card("hook-h", "unresolved_hook", "keeper_only",
                      "海斯要求诺特回去翻查地契与旧租约。",
                      entities=["npc-knott-1"],
                      status="open",
                      introduced_at="commission-briefing/turn-3"))
    _commit_turn(root, SRC, 3, "fin-turn-3")
    # Legacy in-place lifecycle write, then committed as a later finalization
    _write_card(src, "keeper-only", "hook-h.md",
                _card("hook-h", "unresolved_hook", "keeper_only",
                      "海斯要求诺特回去翻查地契与旧租约。",
                      entities=["npc-knott-1"],
                      status="paid_off",
                      introduced_at="commission-briefing/turn-3",
                      resolved_at="commission-briefing/turn-8",
                      resolution_reason="诺特次日交出继承过户摘要。"))
    resolution_sha = _commit_turn(root, SRC, 8, "fin-turn-8")

    result = _import(root)
    assert result["counts"]["cards_imported"] == 1

    tgt = _camp(root, TGT)
    assertions = tm.load_assertions(tgt)
    base = assertions[conv.target_assertion_id(TGT, "hook-h")]
    assert base["kind"] == "knowledge"
    assert base["valid_from_turn"] == 3
    assert base["source_turn"] == 3
    assert base["valid_until_turn"] == 8
    assert len(base["superseded_by"]) == 1

    successor = assertions[base["superseded_by"][0]]
    assert successor["kind"] == "belief"
    # the converter-owned successor carries the VERIFIED resolution
    # provenance — not a synthesized hook receipt
    assert successor["source_commit"] == resolution_sha
    assert successor["source_turn"] == 8
    assert successor["valid_from_turn"] == 8
    assert successor["occurred_turn"] == 8
    assert successor["source_receipts"] == ["fin-turn-8"]
    assert successor["confirms"] == [base["assertion_id"]]
    assert successor["statement"] == "诺特次日交出继承过户摘要。"

    hooks = tm.load_hooks(tgt)
    hook = hooks[conv.target_hook_id(TGT, "hook-h")]
    assert hook["status"] == "paid_off"
    assert hook["assertion_id"] == base["assertion_id"]
    assert hook["successor_id"] == successor["assertion_id"]
    assert hook["decision_id"] == f"legacy-import-{TGT}-hook-h-paid_off"

    manifest = _read_json(tgt / "memory" / "legacy-import" / "import-manifest.json")
    entry = manifest["cards"][0]
    assert entry["disposition"] == "imported"
    provenance = entry["provenance"]
    assert provenance["timeline_id"] == "tl-main"
    assert provenance["ref"] == "refs/heads/main"
    assert provenance["introduction_turn"] == 3
    assert provenance["introduction_finalization_id"] == "fin-turn-3"
    assert provenance["resolution_commit"] == resolution_sha
    assert provenance["resolution_turn"] == 8
    assert provenance["resolution_finalization_id"] == "fin-turn-8"
    tm.contract.validate_assertion_bundle(list(assertions.values()))


def test_resolution_turn_mismatch_quarantines(tmp_path):
    root = tmp_path
    src = _make_source(root)
    _write_card(src, "keeper-only", "hook-h.md",
                _card("hook-h", "unresolved_hook", "keeper_only", "承诺。",
                      status="open"))
    _commit_turn(root, SRC, 3, "fin-turn-3")
    _write_card(src, "keeper-only", "hook-h.md",
                _card("hook-h", "unresolved_hook", "keeper_only", "承诺。",
                      status="paid_off",
                      resolved_at="somewhere/turn-7",  # card says 7, Git says 8
                      resolution_reason="兑现。"))
    _commit_turn(root, SRC, 8, "fin-turn-8")

    result = _import(root)
    assert result["counts"]["cards_imported"] == 0
    assert result["cards"][0]["quarantine_reason"] == "resolution_turn_mismatch"
    assert tm.load_assertions(_camp(root, TGT)) == {}


def test_missing_git_sidecar_quarantines_all(tmp_path):
    root = tmp_path
    src = _make_raw_source(root)
    _write_card(src, "player-safe", "fact-a.md",
                _card("fact-a", "fact", "player_safe", "无可考 Git 出处的旧卡。"))

    result = _import(root)
    assert result["counts"]["cards_imported"] == 0
    assert result["counts"]["cards_quarantined"] == 1
    assert result["cards"][0]["quarantine_reason"] == "missing_git_sidecar"

    tgt = _camp(root, TGT)
    assert tm.load_assertions(tgt) == {}
    receipt = _read_json(tgt / "memory" / "legacy-import" / "conversion-receipt.json")
    assert receipt["counts"]["cards_imported"] == 0
    manifest = _read_json(tgt / "memory" / "legacy-import" / "import-manifest.json")
    assert manifest["cards"][0]["quarantine_reason"] == "missing_git_sidecar"


def test_baseline_only_card_is_quarantined_unprovable_turn(tmp_path):
    """Content committed in the baseline (no Turn-Number / Finalization-Id
    trailers) has real Git evidence but no provable turn/receipt."""
    root = tmp_path
    src = _make_raw_source(root)
    _write_card(src, "player-safe", "fact-a.md",
                _card("fact-a", "fact", "player_safe", "只进过 baseline 的旧卡。"))
    hist.ensure_repo(root, SRC)
    hist.commit_baseline(root, SRC, schema_generation=SCHEMA, note="baseline")

    result = _import(root)
    assert result["counts"]["cards_imported"] == 0
    assert (
        result["cards"][0]["quarantine_reason"] == "unprovable_turn_or_finalization"
    )
    assert tm.load_assertions(_camp(root, TGT)) == {}


def test_modified_non_hook_card_quarantined(tmp_path):
    root = tmp_path
    src = _make_source(root)
    _write_card(src, "player-safe", "fact-a.md",
                _card("fact-a", "fact", "player_safe", "原始版本。"))
    _commit_turn(root, SRC, 2, "fin-turn-2")
    _write_card(src, "player-safe", "fact-a.md",
                _card("fact-a", "fact", "player_safe", "后来被改写过的事实。"))
    _commit_turn(root, SRC, 5, "fin-turn-5")

    result = _import(root)
    assert result["counts"]["cards_imported"] == 0
    assert (
        result["cards"][0]["quarantine_reason"] == "modified_after_introduction"
    )


def test_uncommitted_content_rejected_before_default_conversion(tmp_path):
    root = tmp_path
    src = _make_source(root)
    _commit_turn(root, SRC, 2, "fin-turn-2")
    _write_card(src, "player-safe", "fact-a.md",
                _card("fact-a", "fact", "player_safe", "从未提交过的卡。"))

    with pytest.raises(conv.LegacyConversionError, match="worktree is dirty"):
        _import(root)
    assert not _camp(root, TGT).exists()


def test_fork_only_content_is_never_used_as_provenance(tmp_path):
    """A card committed only on a fork lineage is invisible to provenance:
    the converter proves the ACTIVE lineage (tl-main / refs/heads/main),
    never scans ``--all``."""
    root = tmp_path
    src = _make_source(root)
    # a normal active-lineage card commits first
    _write_card(src, "player-safe", "main-card.md",
                _card("main-card", "fact", "player_safe", "主线证据卡。"))
    _commit_turn(root, SRC, 2, "fin-turn-2")
    # then a fork-only card: worktree file + commit ONLY on the fork lineage
    _write_card(src, "player-safe", "fork-only.md",
                _card("fork-only", "fact", "player_safe", "只在支线史里提交过。"))
    fork_commit = _commit_card_on_fork(
        root, SRC, "memory/cards/player-safe/fork-only.md",
        src / "memory" / "cards" / "player-safe" / "fork-only.md",
    )
    assert fork_commit

    # The fork-only file is intentionally untracked on the active worktree.
    # Default mode rejects that dirty source rather than blessing or
    # quarantining bytes outside the verified current source tree.
    with pytest.raises(conv.LegacyConversionError, match="worktree is dirty"):
        _import(root)
    assert not _camp(root, TGT).exists()


# ---------------------------------------------------------------------------
# Quarantine content rules + privacy + schema/id strictness
# ---------------------------------------------------------------------------


def test_invalid_card_quarantined_valid_sibling_imported(tmp_path):
    root = tmp_path
    src = _make_source(root)
    _write_card(src, "player-safe", "broken.md",
                _card("broken", "banana_kind", "player_safe", "种类非法。"))
    _write_card(src, "player-safe", "good.md",
                _card("good", "fact", "player_safe", "合法的邻居卡。"))
    _commit_turn(root, SRC, 2, "fin-turn-2")

    result = _import(root)
    assert result["counts"]["cards_imported"] == 1
    assert result["counts"]["cards_quarantined"] == 1
    broken = next(c for c in result["cards"] if c["memory_id"] == "broken")
    assert broken["disposition"] == "quarantined"
    assert broken["quarantine_reason"].startswith("invalid_card_schema:")
    assert "invalid or missing kind" in broken["quarantine_reason"]
    assert set(tm.load_assertions(_camp(root, TGT))) == {
        conv.target_assertion_id(TGT, "good")
    }


def test_privacy_preserved_and_path_mismatch_quarantined(tmp_path):
    root = tmp_path
    src = _make_source(root)
    _write_card(src, "keeper-only", "secret.md",
                _card("secret", "fact", "keeper_only", "仅守密人的事实。"))
    _write_card(src, "player-safe", "mismatch.md",
                _card("mismatch", "fact", "keeper_only", "隐私与目录不一致。"))
    _commit_turn(root, SRC, 2, "fin-turn-2")

    result = _import(root)
    assert result["counts"]["cards_imported"] == 1
    assert result["counts"]["cards_quarantined"] == 1
    mismatch = next(c for c in result["cards"] if c["memory_id"] == "mismatch")
    assert "privacy" in mismatch["quarantine_reason"]
    assertions = tm.load_assertions(_camp(root, TGT))
    secret = assertions[conv.target_assertion_id(TGT, "secret")]
    assert secret["privacy"] == "keeper_only"


def test_unsupported_scope_and_opaque_id_quarantine(tmp_path):
    root = tmp_path
    src = _make_source(root)
    _write_card(src, "player-safe", "cross.md",
                _card("cross", "fact", "player_safe", "跨战役卡不可转换。",
                      scope="cross_campaign"))
    _write_card(src, "player-safe", "opaque id.md",
                _card("opaque id!", "fact", "player_safe", "不透明 id 不可转换。"))
    _write_card(src, "player-safe", "good.md",
                _card("good", "fact", "player_safe", "合法卡。"))
    _commit_turn(root, SRC, 2, "fin-turn-2")

    result = _import(root)
    assert result["counts"]["cards_imported"] == 1
    reasons = {c["relpath"].split("/")[-1]: c["quarantine_reason"]
               for c in result["cards"] if c["disposition"] == "quarantined"}
    assert reasons["cross.md"].startswith(
        "invalid_card_schema:"
    ) and "unsupported scope" in reasons["cross.md"]
    assert "opaque" in reasons["opaque id.md"]
    assert set(tm.load_assertions(_camp(root, TGT))) == {
        conv.target_assertion_id(TGT, "good")
    }


def test_unsupported_source_schema_rejected(tmp_path):
    root = tmp_path
    camp = _make_raw_source(root)
    identity = _read_json(camp / "campaign.json")
    identity["schema_version"] = 2
    (camp / "campaign.json").write_text(json.dumps(identity), encoding="utf-8")
    _write_card(camp, "player-safe", "fact-a.md",
                _card("fact-a", "fact", "player_safe", "旧 schema 的卡。"))

    with pytest.raises(conv.LegacyConversionError, match="schema_version"):
        _import(root)
    assert not _camp(root, TGT).exists()


def test_quarantined_records_never_materialized(tmp_path):
    root = tmp_path
    src = _make_source(root)
    _write_card(src, "player-safe", "bad.md", "完全没有 frontmatter 的文件\n")
    _write_card(src, "player-safe", "good.md",
                _card("good", "fact", "player_safe", "唯一合法卡。"))
    _commit_turn(root, SRC, 2, "fin-turn-2")

    result = _import(root)
    assert result["counts"]["cards_quarantined"] == 1
    bad = next(c for c in result["cards"] if c["memory_id"] is None)
    assert bad["quarantine_reason"].startswith("invalid_frontmatter:")
    assertions = tm.load_assertions(_camp(root, TGT))
    assert set(assertions) == {conv.target_assertion_id(TGT, "good")}


def test_context_packs_and_summaries_archived_not_converted(tmp_path):
    root = tmp_path
    src = _make_source(root)
    _write_card(src, "player-safe", "good.md",
                _card("good", "fact", "player_safe", "唯一事实。"))
    packs = src / "memory" / "context-packs"
    packs.mkdir(parents=True, exist_ok=True)
    (packs / "turn-00003.md").write_text("# pack\n", encoding="utf-8")
    (src / "memory" / "session-summaries.jsonl").write_text(
        json.dumps({"turn_number": 3, "summary": "回顾", "ts": "x"}) + "\n",
        encoding="utf-8",
    )
    _commit_turn(root, SRC, 3, "fin-turn-3")

    result = _import(root)
    assert result["counts"]["cards_imported"] == 1
    assert result["counts"]["context_packs_archived"] == 1
    assert result["counts"]["summaries_present"] is True
    assertions = tm.load_assertions(_camp(root, TGT))
    assert len(assertions) == 1
    manifest = _read_json(
        _camp(root, TGT) / "memory" / "legacy-import" / "import-manifest.json"
    )
    assert manifest["context_packs"]["disposition"] == "archived_only_not_converted"
    pack_file = manifest["context_packs"]["files"]["memory/context-packs/turn-00003.md"]
    assert pack_file["sha256"] == hashlib.sha256(
        (src / "memory" / "context-packs" / "turn-00003.md").read_bytes()
    ).hexdigest()
    assert manifest["session_summaries"]["disposition"] == (
        "preserved_in_place_not_converted"
    )
    assert manifest["session_summaries"]["file"][
        "memory/session-summaries.jsonl"
    ]["sha256"]
    # every discovered source byte is hashed into the manifest
    assert set(manifest["source_snapshot"]["files"]) == set(
        rel for rel in _tree_digest(src)
    )


# ---------------------------------------------------------------------------
# Idempotency, drift, tampering, rejections, preservation
# ---------------------------------------------------------------------------


def _seed_source(root) -> Path:
    src = _make_source(root)
    _write_card(src, "player-safe", "fact-a.md",
                _card("fact-a", "fact", "player_safe", "可证明事实。"))
    _write_card(src, "keeper-only", "hook-h.md",
                _card("hook-h", "foreshadowing", "keeper_only", "未回收的伏笔。",
                      status="open"))
    _write_card(src, "keeper-only", "hook-done.md",
                _card("hook-done", "unresolved_hook", "keeper_only", "已兑现的承诺。",
                      entities=["npc-knott-1"], status="open",
                      introduced_at="turn-2"))
    _commit_turn(root, SRC, 2, "fin-turn-2")
    _write_card(src, "keeper-only", "hook-done.md",
                _card("hook-done", "unresolved_hook", "keeper_only", "已兑现的承诺。",
                      entities=["npc-knott-1"], status="paid_off",
                      introduced_at="turn-2",
                      resolved_at="turn-9",
                      resolution_reason="承诺已经兑现。"))
    _commit_turn(root, SRC, 9, "fin-turn-9")
    return src


def test_replay_is_idempotent_and_converges(tmp_path):
    root = tmp_path
    src = _seed_source(root)
    first = _import(root)
    assert first["replay"] is False
    assert first["counts"]["cards_imported"] == 3
    tgt = _camp(root, TGT)
    closed = tm.load_assertions(tgt)[conv.target_assertion_id(TGT, "hook-done")]
    assert closed["valid_until_turn"] == 9
    assert len(closed["superseded_by"]) == 1
    store_before = _store_digests(tgt)
    files_before = {
        p.name: hashlib.sha256(p.read_bytes()).hexdigest()
        for p in sorted((tgt / "memory" / "legacy-import").glob("*.json"))
    }
    count_before = len(tm.load_assertions(tgt))

    second = _import(root)
    assert second["replay"] is True
    assert second["counts"] == first["counts"]
    assert _store_digests(tgt) == store_before
    assert len(tm.load_assertions(tgt)) == count_before
    files_after = {
        p.name: hashlib.sha256(p.read_bytes()).hexdigest()
        for p in sorted((tgt / "memory" / "legacy-import").glob("*.json"))
    }
    assert files_after == files_before


def test_source_file_drift_between_runs_fails_closed(tmp_path):
    root = tmp_path
    src = _seed_source(root)
    _import(root)
    tgt = _camp(root, TGT)
    store_before = _store_digests(tgt)
    receipt_before = (
        tgt / "memory" / "legacy-import" / "conversion-receipt.json"
    ).read_bytes()

    card = src / "memory" / "cards" / "player-safe" / "fact-a.md"
    card.write_text(
        _card("fact-a", "fact", "player_safe", "被篡改过的内容。"),
        encoding="utf-8",
    )

    with pytest.raises(conv.LegacyConversionError, match="drifted"):
        _import(root)
    assert _store_digests(tgt) == store_before
    assert (
        tgt / "memory" / "legacy-import" / "conversion-receipt.json"
    ).read_bytes() == receipt_before


def test_source_git_drift_between_runs_fails_closed(tmp_path):
    root = tmp_path
    src = _seed_source(root)
    _import(root)
    tgt = _camp(root, TGT)
    store_before = _store_digests(tgt)

    # the source campaign advances: ref tips change -> replay must fail
    _commit_turn(root, SRC, 10, "fin-turn-10")
    with pytest.raises(conv.LegacyConversionError, match="Git sidecar drifted"):
        _import(root)
    assert _store_digests(tgt) == store_before

    # even a newly appearing fork ref is bound and detected
    _make_source(root, campaign_id="src-fork")
    hist.commit_finalized_turn(
        root, "src-fork", turn_number=1, finalization_id="fin-f1",
        journal_decision_id="j", settlement_snapshot_id="s",
        rendered_text_sha256="0" * 64, schema_generation=SCHEMA,
    )
    result = conv.convert_legacy_memory(
        root, source_campaign="src-fork", target_campaign="src-fork-temporal-import-1"
    )
    assert result["replay"] is False
    main_sha = _git_raw(
        root, "src-fork", "rev-parse", "refs/heads/main", worktree=False
    ).strip()
    _git_raw(
        root, "src-fork", "update-ref",
        "refs/heads/timelines/tl-fork", main_sha, worktree=False,
    )
    with pytest.raises(conv.LegacyConversionError, match="Git sidecar drifted"):
        conv.convert_legacy_memory(
            root, source_campaign="src-fork",
            target_campaign="src-fork-temporal-import-1",
        )


def test_target_tampering_fails_closed(tmp_path):
    root = tmp_path
    src = _seed_source(root)
    _import(root)
    tgt = _camp(root, TGT)
    store_before = _store_digests(tgt)

    # store byte tampering
    assertions_path = tgt / "memory" / "temporal" / "assertions.jsonl"
    original_assertions = assertions_path.read_bytes()
    assertions_path.write_bytes(original_assertions + b"x\n")
    with pytest.raises(conv.LegacyConversionError, match="store files drifted"):
        _import(root)
    # restore the store, then tamper the manifest instead
    assertions_path.write_bytes(original_assertions)
    assert _store_digests(tgt) == store_before
    manifest_path = tgt / "memory" / "legacy-import" / "import-manifest.json"
    original_manifest = manifest_path.read_bytes()
    manifest_path.write_bytes(original_manifest + b" ")
    with pytest.raises(conv.LegacyConversionError, match="manifest drifted"):
        _import(root)
    assert _store_digests(tgt) == store_before
    # restore the manifest, then remove the receipt => existing target
    # without a receipt is rejected, never overwritten
    manifest_path.write_bytes(original_manifest)
    (tgt / "memory" / "legacy-import" / "conversion-receipt.json").unlink()
    with pytest.raises(conv.LegacyConversionError, match="never overwrites"):
        _import(root)
    assert _store_digests(tgt) == store_before


def test_source_byte_preservation_across_full_run(tmp_path):
    root = tmp_path
    src = _seed_source(root)
    (src / "memory" / "session-summaries.jsonl").write_text("{}\n", encoding="utf-8")
    sidecar = root / ".coc" / "repos" / "campaigns" / f"{SRC}.git"
    before = _tree_digest(src)
    sidecar_before = _dir_digest(sidecar)
    _import(root, source_turn=9)
    _import(root, source_turn=9)  # historical replay stays read-only
    assert _tree_digest(src) == before
    assert _dir_digest(sidecar) == sidecar_before


def test_rejections_same_id_existing_target_and_path_escape(tmp_path):
    root = tmp_path
    _make_source(root)

    with pytest.raises(conv.LegacyConversionError, match="must differ"):
        conv.convert_legacy_memory(
            root, source_campaign=SRC, target_campaign=SRC
        )

    with pytest.raises(conv.LegacyConversionError, match="not a safe stable id"):
        conv.convert_legacy_memory(
            root, source_campaign=SRC, target_campaign="../escape"
        )

    with pytest.raises(conv.LegacyConversionError, match="not a safe stable id"):
        conv.convert_legacy_memory(
            root, source_campaign="a/b", target_campaign=TGT
        )

    # symlinked target path is rejected
    campaigns = root / ".coc" / "campaigns"
    outside = root / "outside-target"
    outside.mkdir()
    (campaigns / "link-target").symlink_to(outside, target_is_directory=True)
    with pytest.raises(conv.LegacyConversionError, match="symlink"):
        conv.convert_legacy_memory(
            root, source_campaign=SRC, target_campaign="link-target"
        )

    # pre-existing target without a conversion receipt is never overwritten
    coc_state.create_campaign(root, TGT, "Someone else's campaign")
    with pytest.raises(conv.LegacyConversionError, match="never overwrites"):
        _import(root)


def test_target_of_different_source_rejected(tmp_path):
    root = tmp_path
    _make_source(root, "other-src")
    _make_source(root)
    _import(root)
    with pytest.raises(conv.LegacyConversionError, match="source/target pair"):
        conv.convert_legacy_memory(
            root, source_campaign="other-src", target_campaign=TGT
        )


def test_dry_run_writes_nothing(tmp_path):
    root = tmp_path
    src = _seed_source(root)
    before = _tree_digest(root / ".coc")
    result = _import(root, dry_run=True)
    assert result["dry_run"] is True
    assert result["counts"]["cards_imported"] == 3
    assert not _camp(root, TGT).exists()
    assert not (root / ".coc" / "legacy-import-staging").exists()
    assert _tree_digest(root / ".coc") == before


def test_cli_main_success(tmp_path, capsys):
    root = tmp_path
    _seed_source(root)
    code = conv.main(
        ["--root", str(root), "--source-campaign", SRC, "--target-campaign", TGT]
    )
    assert code == 0
    payload = json.loads(capsys.readouterr().out)
    assert payload["counts"]["cards_imported"] == 3

    code = conv.main(
        ["--root", str(root), "--source-campaign", SRC, "--target-campaign", SRC]
    )
    assert code == 1
    assert "error" in json.loads(capsys.readouterr().err)


# ---------------------------------------------------------------------------
# Crash injection / resume at every write boundary
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("phase", ["stage", "publish", "history", "index"])
def test_crash_at_phase_entry_is_resumable_and_converges(tmp_path, monkeypatch, phase):
    root = tmp_path
    src = _seed_source(root)
    index_path = root / ".coc" / "indexes" / "campaigns.json"

    # Inject a crash exactly at one write boundary. The wrapper disarms
    # after the injected failure so the resumed run exercises the real
    # implementation (no monkeypatch.undo, which would also revert the
    # isolated git-home fixture).
    crash = {"armed": True}
    if phase == "stage":
        original = conv._stage_generation
        target_obj, name = conv, "_stage_generation"
    elif phase == "publish":
        original = conv._prepare_atomic_publish
        target_obj, name = conv, "_prepare_atomic_publish"
    elif phase == "history":
        original = conv.git_history.commit_baseline
        target_obj, name = conv.git_history, "commit_baseline"
    else:
        original = conv.coc_state._upsert_campaign_index
        target_obj, name = conv.coc_state, "_upsert_campaign_index"

    def _flaky(*args, **kwargs):
        if crash["armed"]:
            raise RuntimeError(f"injected crash at {phase}")
        return original(*args, **kwargs)

    monkeypatch.setattr(target_obj, name, _flaky)

    with pytest.raises(RuntimeError, match="injected crash"):
        _import(root)
    # the fault is repaired: the "restarted process" runs real code
    crash["armed"] = False

    tgt = _camp(root, TGT)
    if phase in ("stage", "publish"):
        # nothing visible exists before the atomic publish boundary
        assert not tgt.exists()
        assert not (index_path.exists() and target_in_index(index_path, TGT))
    else:
        # published target always carries its complete receipt
        assert tgt.exists()
        receipt = _read_json(
            tgt / "memory" / "legacy-import" / "conversion-receipt.json"
        )
        assert receipt["status"] == "complete"
        store_mid = _store_digests(tgt)
        assert store_mid  # records are complete, not partial

    # resume: same source + target converges
    result = _import(root)
    tgt = _camp(root, TGT)
    if phase in ("stage", "publish"):
        assert result["replay"] is False
    else:
        assert result["replay"] is True
    assert result["counts"]["cards_imported"] == 3
    assert _read_json(
        tgt / "memory" / "legacy-import" / "conversion-receipt.json"
    )["status"] == "complete"
    tm.contract.validate_assertion_bundle(
        list(tm.load_assertions(tgt).values())
    )
    # campaign index repaired/exposed exactly once, deterministically
    assert target_in_index(index_path, TGT)
    # a further replay still converges byte-stably
    store_after_resume = _store_digests(tgt)
    again = _import(root)
    assert again["replay"] is True
    assert _store_digests(tgt) == store_after_resume


def target_in_index(index_path: Path, campaign_id: str) -> bool:
    if not index_path.exists():
        return False
    index = _read_json(index_path)
    return campaign_id in index.get("campaigns", {})


def test_partial_staging_tampering_is_ignored(tmp_path, monkeypatch):
    """Staging is disposable by construction: a tampered staging directory
    never influences the conversion outcome."""
    root = tmp_path
    src = _seed_source(root)

    def _boom(*args, **kwargs):
        raise RuntimeError("injected crash at publish")

    monkeypatch.setattr(conv, "_prepare_atomic_publish", _boom)
    with pytest.raises(RuntimeError, match="injected"):
        _import(root)
    monkeypatch.undo()

    staging_campaign = (
        root / ".coc" / "legacy-import-staging" / TGT / TGT
    )
    assert staging_campaign.exists()
    tamper = staging_campaign / "memory" / "temporal" / "assertions.jsonl"
    tamper.write_bytes(b'{"forged": true}\n')

    result = _import(root)
    assert result["replay"] is False
    assert result["counts"]["cards_imported"] == 3
    assertions = tm.load_assertions(_camp(root, TGT))
    assert "forged" not in json.dumps(assertions, default=str)
    tm.contract.validate_assertion_bundle(list(assertions.values()))


# ---------------------------------------------------------------------------
# Nested symlinks
# ---------------------------------------------------------------------------


def test_nested_source_symlink_fails_closed(tmp_path):
    root = tmp_path
    src = _make_source(root)
    _write_card(src, "player-safe", "good.md",
                _card("good", "fact", "player_safe", "合法卡。"))
    outside = root / "outside-memory"
    outside.mkdir()
    cards_dir = src / "memory" / "cards" / "keeper-only"
    cards_dir.mkdir(parents=True, exist_ok=True)
    cards_dir.rmdir()
    cards_dir.symlink_to(outside, target_is_directory=True)

    with pytest.raises(conv.LegacyConversionError, match="symlink"):
        _import(root)
    assert not _camp(root, TGT).exists()


# ---------------------------------------------------------------------------
# Crash injection at INTERNAL write boundaries (not whole-phase skips)
# ---------------------------------------------------------------------------


def _assert_conversion_invariants(root: Path, expect_published: bool) -> None:
    """Published target must always carry its complete receipt and a valid
    bundle; an unpublished target must not exist at all."""
    tgt = _camp(root, TGT)
    if not expect_published:
        assert not tgt.exists()
        return
    assert tgt.exists()
    receipt = _read_json(
        tgt / "memory" / "legacy-import" / "conversion-receipt.json"
    )
    assert receipt["status"] == "complete"
    assert receipt["source_byte_preservation_verified"] is True
    tm.contract.validate_assertion_bundle(list(tm.load_assertions(tgt).values()))


@pytest.mark.parametrize(
    "point",
    [
        "after_shell",
        "after_subject_defaults",
        "after_assertion_1",
        "after_assertion_all",
        "after_hook_open_row",
        "after_manifest",
        "after_receipt",
        "before_rename",
        "after_rename",
        "before_baseline",
        "after_baseline",
        "before_index",
        "after_index",
    ],
)
def test_crash_at_internal_write_boundary_is_resumable(
    tmp_path, monkeypatch, point
):
    root = tmp_path
    src = _seed_source(root)
    sidecar = root / ".coc" / "repos" / "campaigns" / f"{SRC}.git"
    source_before = _tree_digest(src)
    sidecar_before = _dir_digest(sidecar)

    crash = {"armed": True}

    def _real_then_crash(real, *, after_calls, count_by=None):
        state = {"calls": 0}

        def wrapper(*args, **kwargs):
            result = real(*args, **kwargs)
            state["calls"] += 1
            relevant = count_by is None or count_by(*args, **kwargs)
            if crash["armed"] and relevant and state["calls"] >= after_calls:
                raise RuntimeError(f"injected crash at {point}")
            return result

        return wrapper

    def _crash_before(real):
        def wrapper(*args, **kwargs):
            if crash["armed"]:
                raise RuntimeError(f"injected crash at {point}")
            return real(*args, **kwargs)

        return wrapper

    if point == "after_shell":
        real = conv.coc_state._create_campaign_at
        monkeypatch.setattr(
            conv.coc_state, "_create_campaign_at", _real_then_crash(real, after_calls=1)
        )
    elif point == "after_subject_defaults":
        real = conv.temporal_memory.ensure_default_subjects
        monkeypatch.setattr(
            conv.temporal_memory,
            "ensure_default_subjects",
            _real_then_crash(real, after_calls=1),
        )
    elif point in ("after_assertion_1", "after_assertion_all"):
        real = conv.temporal_memory.record_assertion
        k = 1 if point == "after_assertion_1" else 4
        monkeypatch.setattr(
            conv.temporal_memory,
            "record_assertion",
            _real_then_crash(real, after_calls=k),
        )
    elif point == "after_hook_open_row":
        real = conv.temporal_memory.register_hook
        monkeypatch.setattr(
            conv.temporal_memory,
            "register_hook",
            _real_then_crash(real, after_calls=1),
        )
    elif point in ("after_manifest", "after_receipt"):
        real = conv._atomic_write_json
        k = 1 if point == "after_manifest" else 2
        monkeypatch.setattr(
            conv, "_atomic_write_json", _real_then_crash(real, after_calls=k)
        )
    elif point == "before_rename":
        monkeypatch.setattr(conv.os, "rename", _crash_before(conv.os.rename))
    elif point == "after_rename":
        monkeypatch.setattr(
            conv.os, "rename", _real_then_crash(conv.os.rename, after_calls=1)
        )
    elif point == "before_baseline":
        monkeypatch.setattr(
            conv.git_history,
            "commit_baseline",
            _crash_before(conv.git_history.commit_baseline),
        )
    elif point == "after_baseline":
        monkeypatch.setattr(
            conv.git_history,
            "commit_baseline",
            _real_then_crash(conv.git_history.commit_baseline, after_calls=1),
        )
    elif point == "before_index":
        monkeypatch.setattr(
            conv.coc_state,
            "_upsert_campaign_index",
            _crash_before(conv.coc_state._upsert_campaign_index),
        )
    else:  # after_index
        monkeypatch.setattr(
            conv.coc_state,
            "_upsert_campaign_index",
            _real_then_crash(conv.coc_state._upsert_campaign_index, after_calls=1),
        )

    with pytest.raises(RuntimeError, match="injected crash"):
        _import(root)
    crash["armed"] = False
    monkeypatch.undo()

    # source campaign AND sidecar remain byte-identical at every boundary
    assert _tree_digest(src) == source_before
    assert _dir_digest(sidecar) == sidecar_before

    # invariant at the boundary: published-with-receipt or not published
    # the atomic publish precedes baseline/index repair: from the rename
    # boundary onward the target is complete-with-receipt
    _assert_conversion_invariants(
        root,
        expect_published=point
        in (
            "after_rename",
            "before_baseline",
            "after_baseline",
            "before_index",
            "after_index",
        ),
    )

    # resume converges
    result = _import(root)
    assert result["counts"]["cards_imported"] == 3
    tgt = _camp(root, TGT)
    assert _read_json(
        tgt / "memory" / "legacy-import" / "conversion-receipt.json"
    )["status"] == "complete"
    tm.contract.validate_assertion_bundle(list(tm.load_assertions(tgt).values()))
    assert target_in_index(root / ".coc" / "indexes" / "campaigns.json", TGT)
    store_after_resume = _store_digests(tgt)
    assert _import(root)["replay"] is True
    assert _store_digests(tgt) == store_after_resume


# ---------------------------------------------------------------------------
# Adversarial: symlinks, mid-run source drift, coordinated tampering,
# concurrency
# ---------------------------------------------------------------------------


def test_nested_staging_symlink_fails_closed(tmp_path):
    root = tmp_path
    src = _seed_source(root)
    source_before = _tree_digest(src)
    staging_home = root / ".coc" / "legacy-import-staging"
    outside = root / "outside-staging"
    outside.mkdir()
    staging_home.mkdir(parents=True)
    (staging_home / TGT).symlink_to(outside, target_is_directory=True)

    with pytest.raises(conv.LegacyConversionError, match="symlink"):
        _import(root)
    assert not _camp(root, TGT).exists()
    assert _tree_digest(src) == source_before
    assert not any(outside.iterdir())


def test_nested_target_sidecar_symlink_fails_before_commit(tmp_path):
    root = tmp_path
    src = _seed_source(root)
    repo = root / ".coc" / "repos" / "campaigns" / f"{TGT}.git"
    outside = root / "outside-repo"
    outside.mkdir()
    repo.symlink_to(outside, target_is_directory=True)

    with pytest.raises(conv.LegacyConversionError, match="symlink"):
        _import(root)
    # the target generation itself was already published atomically and is
    # complete; only the sidecar baseline was refused
    _assert_conversion_invariants(root, expect_published=True)
    # removing the adversarial symlink lets the run converge (replay repair)
    repo.unlink()
    result = _import(root)
    assert result["replay"] is True
    assert target_in_index(root / ".coc" / "indexes" / "campaigns.json", TGT)


def test_workspace_coc_symlink_fails_closed(tmp_path):
    root = tmp_path
    real_coc = root / "real-coc"
    (real_coc / "campaigns").mkdir(parents=True)
    # the workspace .coc path itself is a symlink: every component walk from
    # the repo root must fail closed before any read or write
    (root / ".coc").symlink_to(real_coc, target_is_directory=True)
    src_root = root
    coc_state.create_campaign(src_root, SRC, "S", era="1920s")
    camp = _camp(src_root, SRC)
    _write_card(camp, "player-safe", "fact-a.md",
                _card("fact-a", "fact", "player_safe", "事实。"))
    _commit_turn(src_root, SRC, 2, "fin-turn-2")

    before = _tree_digest(root)
    with pytest.raises(conv.LegacyConversionError, match="symlink"):
        _import(root)
    assert not _camp(src_root, TGT).exists()
    assert _tree_digest(root) == before


def test_source_drift_between_preflight_and_publish_aborts(tmp_path, monkeypatch):
    root = tmp_path
    src = _seed_source(root)
    real_create = conv.coc_state._create_campaign_at
    source_before = _tree_digest(src)

    def mutate_source_during_staging(*args, **kwargs):
        result = real_create(*args, **kwargs)
        # mid-run mutation AFTER preflight, BEFORE the publish-boundary check
        card = src / "memory" / "cards" / "player-safe" / "fact-a.md"
        card.write_text(
            _card("fact-a", "fact", "player_safe", "preflight 之后被改写。"),
            encoding="utf-8",
        )
        return result

    monkeypatch.setattr(
        conv.coc_state, "_create_campaign_at", mutate_source_during_staging
    )
    with pytest.raises(
        conv.LegacyConversionError, match="drifted between preflight and publish"
    ):
        _import(root)
    monkeypatch.undo()
    # aborted BEFORE publication: no target exists; leftover staging is
    # disposable and rebuilt on the next run
    assert not _camp(root, TGT).exists()
    assert _tree_digest(src) != source_before  # the mutation itself is real

    # restore the source, then a clean rerun legitimately converts it fresh
    (src / "memory" / "cards" / "player-safe" / "fact-a.md").write_text(
        _card("fact-a", "fact", "player_safe", "可证明事实。"), encoding="utf-8"
    )
    result = _import(root)
    assert result["replay"] is False
    assert result["counts"]["cards_imported"] == 3


def test_source_git_drift_between_preflight_and_publish_aborts(tmp_path, monkeypatch):
    root = tmp_path
    src = _seed_source(root)
    real_create = conv.coc_state._create_campaign_at

    def commit_to_source_during_staging(*args, **kwargs):
        result = real_create(*args, **kwargs)
        _commit_turn(root, SRC, 20, "fin-turn-20")
        return result

    monkeypatch.setattr(
        conv.coc_state, "_create_campaign_at", commit_to_source_during_staging
    )
    with pytest.raises(
        conv.LegacyConversionError,
        match="Git sidecar drifted between preflight and publish",
    ):
        _import(root)
    monkeypatch.undo()
    # aborted BEFORE publication; leftover staging is disposable
    assert not _camp(root, TGT).exists()


def test_coordinated_manifest_and_receipt_tamper_fails(tmp_path):
    root = tmp_path
    src = _seed_source(root)
    _import(root)
    tgt = _camp(root, TGT)
    store_before = _store_digests(tgt)
    evidence = tgt / "memory" / "legacy-import"

    # edit the manifest meaningfully AND re-stamp the receipt's manifest
    # binding so both files stay internally consistent
    manifest = _read_json(evidence / "import-manifest.json")
    # a semantically meaningful lie: an imported hook claimed as quarantined
    hook_entry = next(
        c for c in manifest["cards"] if c["memory_id"] == "hook-h"
    )
    assert hook_entry["disposition"] == "imported"
    hook_entry["disposition"] = "quarantined"
    hook_entry["quarantine_reason"] = "forged_reason"
    (evidence / "import-manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=True, indent=2) + "\n", encoding="utf-8"
    )
    receipt = _read_json(evidence / "conversion-receipt.json")
    receipt["manifest_sha256"] = hashlib.sha256(
        (evidence / "import-manifest.json").read_bytes()
    ).hexdigest()
    (evidence / "conversion-receipt.json").write_text(
        json.dumps(receipt, ensure_ascii=True, indent=2) + "\n", encoding="utf-8"
    )

    with pytest.raises(
        conv.LegacyConversionError, match="recomputed from the source evidence"
    ):
        _import(root)
    assert _store_digests(tgt) == store_before


def test_subject_store_tamper_with_updated_receipt_fails(tmp_path):
    root = tmp_path
    src = _make_source(root, party=True)
    _write_card(src, "keeper-only", "rel-c.md",
                _card("rel-c", "npc_relationship", "keeper_only", "管家与调查员。",
                      entities=["npc-butler-1", "inv-x04743292"]))
    _commit_turn(root, SRC, 2, "fin-turn-2")
    _import(root)
    tgt = _camp(root, TGT)
    store_before = _store_digests(tgt)
    evidence = tgt / "memory" / "legacy-import"

    # tamper a subject row and update the receipt's store digest binding
    subjects_path = tgt / "memory" / "temporal" / "subjects.jsonl"
    rows = [
        json.loads(line)
        for line in subjects_path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    for row in rows:
        if row["subject_id"] == "subject-investigator-inv-x04743292":
            row["display_name"] = "someone else"
            row["kind"] = "player"
    subjects_path.write_text(
        "".join(json.dumps(r, sort_keys=True, separators=(",", ":"),
                           ensure_ascii=False) + "\n" for r in rows),
        encoding="utf-8",
    )
    receipt = _read_json(evidence / "conversion-receipt.json")
    receipt["target_store"]["file_digests"]["subjects.jsonl"] = hashlib.sha256(
        subjects_path.read_bytes()
    ).hexdigest()
    (evidence / "conversion-receipt.json").write_text(
        json.dumps(receipt, ensure_ascii=True, indent=2) + "\n", encoding="utf-8"
    )

    with pytest.raises(conv.LegacyConversionError, match="subject"):
        _import(root)
    # the tampered store is left exactly as the test made it; runs never wrote
    assert _store_digests(tgt) != store_before


def test_unexpected_store_record_class_fails(tmp_path):
    root = tmp_path
    src = _seed_source(root)
    _import(root)
    tgt = _camp(root, TGT)
    evidence = tgt / "memory" / "legacy-import"

    forged = tgt / "memory" / "temporal" / "episodes.jsonl"
    forged.write_text('{"episode_id": "forged"}\n', encoding="utf-8")
    receipt = _read_json(evidence / "conversion-receipt.json")
    receipt["target_store"]["file_digests"]["episodes.jsonl"] = hashlib.sha256(
        forged.read_bytes()
    ).hexdigest()
    receipt["target_store"]["assertion_count"] = receipt["target_store"][
        "assertion_count"
    ]
    (evidence / "conversion-receipt.json").write_text(
        json.dumps(receipt, ensure_ascii=True, indent=2) + "\n", encoding="utf-8"
    )

    with pytest.raises(
        conv.LegacyConversionError, match="unexpected or missing record classes"
    ):
        _import(root)


def test_concurrent_same_target_runs_converge(tmp_path):
    import threading

    root = tmp_path
    _seed_source(root)
    results: list[dict] = []
    errors: list[Exception] = []

    def runner():
        try:
            results.append(_import(root))
        except Exception as exc:  # clean failure is acceptable
            errors.append(exc)

    threads = [threading.Thread(target=runner) for _ in range(2)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert not errors or all(
        isinstance(e, conv.LegacyConversionError) for e in errors
    )
    replays = [r["replay"] for r in results]
    assert sorted(replays) == [False, True]
    tgt = _camp(root, TGT)
    assert _read_json(
        tgt / "memory" / "legacy-import" / "conversion-receipt.json"
    )["status"] == "complete"
    tm.contract.validate_assertion_bundle(list(tm.load_assertions(tgt).values()))
    assert target_in_index(root / ".coc" / "indexes" / "campaigns.json", TGT)
    store_final = _store_digests(tgt)
    assert _import(root)["replay"] is True
    assert _store_digests(tgt) == store_final


# ---------------------------------------------------------------------------
# Named internal failpoint: exactly after the terminal hook row is durable
# ---------------------------------------------------------------------------


def test_terminal_hook_row_failpoint_reaches_exact_boundary(tmp_path, monkeypatch):
    root = tmp_path
    src = _seed_source(root)
    sidecar = root / ".coc" / "repos" / "campaigns" / f"{SRC}.git"
    source_before = _tree_digest(src)
    sidecar_before = _dir_digest(sidecar)

    monkeypatch.setattr(conv, "_FAILPOINTS", {"after-terminal-hook-row"})
    with pytest.raises(conv.LegacyConversionError, match="injected failpoint"):
        _import(root)
    monkeypatch.undo()

    # the EXACT boundary was reached: the staged hooks ledger already holds
    # the durable terminal row for the paid-off hook
    staged = root / ".coc" / "legacy-import-staging" / TGT / TGT
    staged_hooks = tm.load_hooks(staged)
    terminal = staged_hooks[conv.target_hook_id(TGT, "hook-done")]
    assert terminal["status"] == "paid_off"
    assert terminal["decision_id"] == f"legacy-import-{TGT}-hook-done-paid_off"
    assert terminal["successor_id"]
    # and the complete successor/supersession pair is staged with it
    staged_assertions = tm.load_assertions(staged)
    closed = staged_assertions[conv.target_assertion_id(TGT, "hook-done")]
    assert closed["valid_until_turn"] == 9
    assert closed["superseded_by"] == [terminal["successor_id"]]

    # the partial target is NOT published
    assert not _camp(root, TGT).exists()
    # source campaign and sidecar remain byte/Git identical
    assert _tree_digest(src) == source_before
    assert _dir_digest(sidecar) == sidecar_before

    # repaired rerun converges from scratch
    result = _import(root)
    assert result["replay"] is False
    assert result["counts"]["cards_imported"] == 3
    _assert_conversion_invariants(root, expect_published=True)


# ---------------------------------------------------------------------------
# Adversarial pins: read-before-validation ordering
# ---------------------------------------------------------------------------


def test_source_sidecar_symlink_rejected_before_git_probe(tmp_path):
    """A symlinked source sidecar component is rejected by the component
    walk BEFORE looks_like_git_repo or any git command can follow it — even
    when the link points at a real bare repository."""
    root = tmp_path
    src = _seed_source(root)
    source_before = _tree_digest(src)
    outside_repo = root / "outside-repo.git"
    subprocess.run(
        ["git", "init", "--bare", "--initial-branch=main", str(outside_repo)],
        check=True,
        capture_output=True,
        env={
            **os.environ,
            "GIT_CONFIG_NOSYSTEM": "1",
            "GIT_CONFIG_GLOBAL": os.devnull,
        },
    )
    campaigns = root / ".coc" / "repos" / "campaigns"
    real_sidecar = campaigns / f"{SRC}.git"
    os.rename(real_sidecar, root / "real-sidecar.git")
    real_sidecar.symlink_to(outside_repo, target_is_directory=True)

    with pytest.raises(
        conv.LegacyConversionError, match="Git sidecar repo path is a symlink"
    ):
        _import(root)
    assert not _camp(root, TGT).exists()
    assert _tree_digest(src) == source_before


def test_replay_validates_target_tree_before_reading_receipt(tmp_path):
    """Replay must component-walk the target memory tree BEFORE reading the
    receipt: a symlinked legacy-import parent is rejected as a symlink, not
    misreported as a receipt-less target."""
    root = tmp_path
    _seed_source(root)
    _import(root)
    tgt = _camp(root, TGT)
    evidence = tgt / "memory" / "legacy-import"
    outside = root / "outside-evidence"
    outside.mkdir()  # deliberately contains NO receipt
    os.rename(evidence, root / "evidence-backup")
    evidence.symlink_to(outside, target_is_directory=True)

    with pytest.raises(
        conv.LegacyConversionError, match="target memory tree contains a symlink"
    ):
        _import(root)
    assert not any(outside.iterdir())  # nothing was read or written through it


# ---------------------------------------------------------------------------
# Adversarial pins: complete deterministic recomputation
# ---------------------------------------------------------------------------


def _rewrite_receipt(evidence: Path, mutate) -> None:
    receipt = _read_json(evidence / "conversion-receipt.json")
    mutate(receipt)
    (evidence / "conversion-receipt.json").write_text(
        json.dumps(receipt, ensure_ascii=True, indent=2) + "\n", encoding="utf-8"
    )


def test_schema_tamper_with_coordinated_receipt_fails(tmp_path):
    root = tmp_path
    _seed_source(root)
    _import(root)
    tgt = _camp(root, TGT)
    evidence = tgt / "memory" / "legacy-import"
    schema_path = tgt / "memory" / "temporal" / "schema.json"
    schema_path.write_text(
        json.dumps(
            {
                "schema_generation": "temporal-memory-1",
                "authority": "advisory",
                "hard_gate": True,  # tampered flag
            },
            sort_keys=True,
            indent=2,
            ensure_ascii=False,
        )
        + chr(10),
        encoding="utf-8",
    )
    _rewrite_receipt(
        evidence,
        lambda r: r["target_store"]["file_digests"].__setitem__(
            "schema.json", hashlib.sha256(schema_path.read_bytes()).hexdigest()
        ),
    )
    with pytest.raises(
        conv.LegacyConversionError, match="schema marker drifted"
    ):
        _import(root)


def test_entity_exact_field_tamper_with_coordinated_receipt_fails(tmp_path):
    root = tmp_path
    src = _make_source(root)
    _write_card(src, "player-safe", "fact-a.md",
                _card("fact-a", "fact", "player_safe", "事实。",
                      entities=["npc-butler-1"]))
    _commit_turn(root, SRC, 2, "fin-turn-2")
    _import(root)
    tgt = _camp(root, TGT)
    evidence = tgt / "memory" / "legacy-import"
    entities_path = tgt / "memory" / "temporal" / "entities.jsonl"
    rows = [
        json.loads(line)
        for line in entities_path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    for row in rows:
        if row["entity_id"] == "entity-person-butler-1":
            row["display_name"] = "forged display"  # non-identity field
            row["aliases"] = ["forged-alias"]
    entities_path.write_text(
        "".join(
            json.dumps(r, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
            + "\n"
            for r in rows
        ),
        encoding="utf-8",
    )
    _rewrite_receipt(
        evidence,
        lambda r: r["target_store"]["file_digests"].__setitem__(
            "entities.jsonl", hashlib.sha256(entities_path.read_bytes()).hexdigest()
        ),
    )
    with pytest.raises(
        conv.LegacyConversionError, match="entity row .* drifted"
    ):
        _import(root)


def test_receipt_extra_field_rejected(tmp_path):
    root = tmp_path
    _seed_source(root)
    _import(root)
    evidence = _camp(root, TGT) / "memory" / "legacy-import"

    def add_field(receipt):
        receipt["attacker_note"] = "coordinated"

    _rewrite_receipt(evidence, add_field)
    with pytest.raises(
        conv.LegacyConversionError, match="missing or unexpected fields"
    ):
        _import(root)


def test_source_and_git_mutated_at_former_publish_boundary_abort(tmp_path, monkeypatch):
    """Instrument the actual former post-verification validation boundary.

    `_prepare_atomic_publish` used to run after verification; after the
    literal-order repair it runs before verification. Mutating source bytes
    AND source Git there therefore must be caught by final verification with
    the target still unpublished.
    """
    root = tmp_path
    src = _seed_source(root)
    sidecar = root / ".coc" / "repos" / "campaigns" / f"{SRC}.git"
    source_before = _tree_digest(src)
    git_before = _dir_digest(sidecar)
    real_prepare = conv._prepare_atomic_publish

    def prepare_then_mutate_source_and_git(*args, **kwargs):
        target_dir = real_prepare(*args, **kwargs)
        (src / "memory" / "cards" / "player-safe" / "fact-a.md").write_text(
            _card("fact-a", "fact", "player_safe", "former publish boundary 改写。"),
            encoding="utf-8",
        )
        _commit_turn(root, SRC, 20, "fin-former-publish-boundary")
        return target_dir

    monkeypatch.setattr(
        conv, "_prepare_atomic_publish", prepare_then_mutate_source_and_git
    )
    with pytest.raises(
        conv.LegacyConversionError, match="drifted between preflight and publish"
    ):
        _import(root)
    monkeypatch.undo()
    assert not _camp(root, TGT).exists()
    assert _tree_digest(src) != source_before
    assert _dir_digest(sidecar) != git_before


def test_publication_order_is_verify_then_atomic_rename(tmp_path, monkeypatch):
    """Successful publication records the prepared/verified/renamed events;
    the final pair is strictly adjacent, pinning the executable order."""
    root = tmp_path
    _seed_source(root)
    events: list[str] = []
    real_prepare = conv._prepare_atomic_publish
    real_verify = conv._verify_source_unchanged
    real_rename = conv.os.rename

    def prepared(*args, **kwargs):
        result = real_prepare(*args, **kwargs)
        events.append("prepared")
        return result

    def verified(*args, **kwargs):
        result = real_verify(*args, **kwargs)
        events.append("verified")
        return result

    def renamed(*args, **kwargs):
        events.append("renamed")
        return real_rename(*args, **kwargs)

    monkeypatch.setattr(conv, "_prepare_atomic_publish", prepared)
    monkeypatch.setattr(conv, "_verify_source_unchanged", verified)
    monkeypatch.setattr(conv.os, "rename", renamed)
    result = _import(root)
    assert result["replay"] is False
    assert events == ["prepared", "verified", "renamed"]


def test_concurrent_different_target_runs_converge_shared_index(tmp_path):
    """Different-target conversions serialize on the ONE workspace-wide
    lock, so the shared campaign-index read-modify-write can never race or
    lose an entry."""
    import threading

    root = tmp_path
    _seed_source(root)
    targets = ["src-camp-temporal-import-1", "src-camp-temporal-import-2"]
    results: list[dict] = []
    errors: list[Exception] = []

    def runner(target):
        try:
            results.append(
                conv.convert_legacy_memory(
                    root, source_campaign=SRC, target_campaign=target
                )
            )
        except Exception as exc:
            errors.append(exc)

    threads = [
        threading.Thread(target=runner, args=(target,)) for target in targets
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert not errors
    assert sorted(r["replay"] for r in results) == [False, False]
    index = _read_json(root / ".coc" / "indexes" / "campaigns.json")
    # both index entries survived the serialized read-modify-write
    for target in targets:
        assert index["campaigns"][target]["campaign_id"] == target
    for target in targets:
        receipt = _read_json(
            _camp(root, target)
            / "memory"
            / "legacy-import"
            / "conversion-receipt.json"
        )
        assert receipt["status"] == "complete"


# ---------------------------------------------------------------------------
# Historical finalized-turn source selection
# ---------------------------------------------------------------------------


def _seed_historical_source(root: Path, turn: int = 3) -> Path:
    src = _make_source(root)
    _write_card(
        src,
        "player-safe",
        "fact-a.md",
        _card(
            "fact-a",
            "fact",
            "player_safe",
            "已提交的历史事实。",
            entities=["npc-historian-1"],
        ),
    )
    _commit_turn(root, SRC, turn, f"fin-turn-{turn}")
    return src


def _raw_turn_commit(
    root: Path,
    *,
    turn: int,
    finalization_id: str | None,
    parent_ref: str = "refs/heads/main",
    update_ref: str = "refs/heads/main",
) -> str:
    """Fixture-only malformed/ambiguous history writer without touching a
    live campaign. Production conversion never stages or commits source."""
    parent = _git_raw(root, SRC, "rev-parse", parent_ref, worktree=False).strip()
    tree = _git_raw(root, SRC, "rev-parse", f"{parent}^{{tree}}", worktree=False).strip()
    trailers = [
        "COC-Commit-Type: turn",
        f"Campaign-Id: {SRC}",
        "Timeline-Id: tl-main",
        f"Turn-Number: {turn}",
        "Journal-Decision-Id: fixture-journal",
        "Settlement-Snapshot-Id: fixture-settlement",
        f"Rendered-Text-SHA256: {'0' * 64}",
        f"Schema-Generation: {SCHEMA}",
    ]
    if finalization_id is not None:
        trailers.insert(4, f"Finalization-Id: {finalization_id}")
    commit = _git_raw(
        root,
        SRC,
        "commit-tree",
        tree,
        "-p",
        parent,
        "-m",
        "fixture turn\n\n" + "\n".join(trailers),
        worktree=False,
    ).strip()
    _git_raw(root, SRC, "update-ref", update_ref, commit, worktree=False)
    return commit


def _forged_replacement_commit(root: Path, original: str, *, turn: int) -> str:
    """Install a replacement with valid-looking trailers and a different tree."""
    index = root / "_replace-index"
    forged_card = root / "forged-replacement-card.md"
    forged_card.write_text(
        _card("fact-a", "fact", "player_safe", "替换对象中的伪造事实。"),
        encoding="utf-8",
    )
    no_replace = {"GIT_NO_REPLACE_OBJECTS": "1"}
    original_tree = _git_raw(
        root,
        SRC,
        "rev-parse",
        f"{original}^{{tree}}",
        env_extra=no_replace,
        worktree=False,
    ).strip()
    parent = _git_raw(
        root,
        SRC,
        "rev-parse",
        f"{original}^",
        env_extra=no_replace,
        worktree=False,
    ).strip()
    blob = _git_raw(root, SRC, "hash-object", "-w", str(forged_card)).strip()
    index_env = {"GIT_INDEX_FILE": str(index), **no_replace}
    try:
        _git_raw(
            root,
            SRC,
            "read-tree",
            original_tree,
            env_extra=index_env,
            worktree=False,
        )
        _git_raw(
            root,
            SRC,
            "update-index",
            "--add",
            "--cacheinfo",
            f"100644,{blob},memory/cards/player-safe/fact-a.md",
            env_extra=index_env,
            worktree=False,
        )
        tree = _git_raw(
            root, SRC, "write-tree", env_extra=index_env, worktree=False
        ).strip()
    finally:
        index.unlink(missing_ok=True)
    trailers = [
        "COC-Commit-Type: turn",
        f"Campaign-Id: {SRC}",
        "Timeline-Id: tl-main",
        f"Turn-Number: {turn}",
        "Finalization-Id: fin-forged-replacement",
        "Journal-Decision-Id: forged-journal",
        "Settlement-Snapshot-Id: forged-settlement",
        f"Rendered-Text-SHA256: {'f' * 64}",
        f"Schema-Generation: {SCHEMA}",
    ]
    replacement = _git_raw(
        root,
        SRC,
        "commit-tree",
        tree,
        "-p",
        parent,
        "-m",
        "forged replacement turn\n\n" + "\n".join(trailers),
        env_extra=no_replace,
        worktree=False,
    ).strip()
    _git_raw(
        root,
        SRC,
        "update-ref",
        f"refs/replace/{original}",
        replacement,
        env_extra=no_replace,
        worktree=False,
    )
    return replacement


def test_source_turn_uses_committed_bytes_and_preserves_dirty_source(tmp_path):
    root = tmp_path
    src = _seed_historical_source(root)
    card = src / "memory" / "cards" / "player-safe" / "fact-a.md"
    card.write_text(
        _card("fact-a", "fact", "player_safe", "未提交且绝不能导入的改写。"),
        encoding="utf-8",
    )
    (src / "save").mkdir(exist_ok=True)
    (src / "save" / "generated-after-turn.json").write_text(
        '{"generated": true}\n', encoding="utf-8"
    )
    (src / "save" / "quest-state.json").write_text(
        '{"quest": "dirty-after-finalization"}\n', encoding="utf-8"
    )
    sidecar = root / ".coc" / "repos" / "campaigns" / f"{SRC}.git"
    source_before = _tree_digest(src)
    sidecar_before = _dir_digest(sidecar)

    # No selector remains strict: no source card/cache/state byte is blessed.
    with pytest.raises(conv.LegacyConversionError, match="worktree is dirty"):
        _import(root)
    assert _tree_digest(src) == source_before
    assert _dir_digest(sidecar) == sidecar_before

    first = _import(root, source_turn=3)
    assert first["source_mode"] == "historical_turn"
    assert first["source_turn"] == 3
    tgt = _camp(root, TGT)
    assertion = tm.load_assertions(tgt)[conv.target_assertion_id(TGT, "fact-a")]
    assert assertion["statement"] == "已提交的历史事实。"
    evidence = tgt / "memory" / "legacy-import"
    manifest = _read_json(evidence / "import-manifest.json")
    receipt = _read_json(evidence / "conversion-receipt.json")
    assert manifest["source_selection"]["source_turn"] == 3
    assert manifest["source_selection"]["commit"] == assertion["source_commit"]
    assert receipt["source_selection"] == manifest["source_selection"]
    assert "save/quest-state.json" not in manifest["source_snapshot"]["files"]
    assert "save/quest-state.json" in manifest["source_worktree_snapshot"]["files"]
    assert _tree_digest(src) == source_before
    assert _dir_digest(sidecar) == sidecar_before

    store_before = _store_digests(tgt)
    replay = _import(root, source_turn=3)
    assert replay["replay"] is True
    assert _store_digests(tgt) == store_before
    assert _tree_digest(src) == source_before
    assert _dir_digest(sidecar) == sidecar_before


def test_source_turn_rejects_missing_and_unfinalized_turns(tmp_path):
    root = tmp_path
    _seed_historical_source(root)
    with pytest.raises(conv.LegacyConversionError, match="missing|canonical finalized"):
        _import(root, source_turn=4)
    _raw_turn_commit(root, turn=4, finalization_id=None)
    with pytest.raises(conv.LegacyConversionError, match="canonical finalized"):
        _import(root, source_turn=4)
    assert not _camp(root, TGT).exists()


def test_source_turn_rejects_ambiguous_and_nonancestor_turns(tmp_path):
    ambiguous_root = tmp_path / "ambiguous"
    ambiguous_root.mkdir()
    _seed_historical_source(ambiguous_root)
    _raw_turn_commit(ambiguous_root, turn=4, finalization_id="fin-a")
    _raw_turn_commit(ambiguous_root, turn=4, finalization_id="fin-b")
    with pytest.raises(conv.LegacyConversionError, match="ambiguous"):
        _import(ambiguous_root, source_turn=4)
    assert not _camp(ambiguous_root, TGT).exists()

    fork_root = tmp_path / "fork"
    fork_root.mkdir()
    _seed_historical_source(fork_root)
    _raw_turn_commit(
        fork_root,
        turn=7,
        finalization_id="fin-fork-only",
        update_ref="refs/heads/timelines/tl-fork",
    )
    with pytest.raises(conv.LegacyConversionError, match="missing|active timeline"):
        _import(fork_root, source_turn=7)
    assert not _camp(fork_root, TGT).exists()


def test_source_turn_rejects_replace_object_finalization_forgery(tmp_path):
    root = tmp_path
    src = _seed_historical_source(root)
    original = _raw_turn_commit(root, turn=4, finalization_id=None)
    replacement = _forged_replacement_commit(root, original, turn=4)
    no_replace = {"GIT_NO_REPLACE_OBJECTS": "1"}

    original_message = _git_raw(
        root,
        SRC,
        "log",
        "-1",
        "--format=%B",
        original,
        env_extra=no_replace,
        worktree=False,
    )
    replaced_message = _git_raw(
        root, SRC, "log", "-1", "--format=%B", original, worktree=False
    )
    assert "Finalization-Id:" not in original_message
    assert "Finalization-Id: fin-forged-replacement" in replaced_message
    original_tree = _git_raw(
        root,
        SRC,
        "rev-parse",
        f"{original}^{{tree}}",
        env_extra=no_replace,
        worktree=False,
    ).strip()
    replacement_tree = _git_raw(
        root,
        SRC,
        "rev-parse",
        f"{replacement}^{{tree}}",
        env_extra=no_replace,
        worktree=False,
    ).strip()
    assert original_tree != replacement_tree

    source_before = _tree_digest(src)
    sidecar_before = _dir_digest(
        root / ".coc" / "repos" / "campaigns" / f"{SRC}.git"
    )
    for dry_run in (True, False):
        with pytest.raises(
            conv.LegacyConversionError, match="canonical finalized turn"
        ):
            _import(root, source_turn=4, dry_run=dry_run)
        assert not _camp(root, TGT).exists()
        assert _tree_digest(src) == source_before
        assert _dir_digest(root / ".coc" / "repos" / "campaigns" / f"{SRC}.git") == (
            sidecar_before
        )


def test_selected_historical_blob_tamper_fails_replay(tmp_path):
    root = tmp_path
    _seed_historical_source(root)
    _import(root, source_turn=3)
    tgt = _camp(root, TGT)
    store_before = _store_digests(tgt)
    receipt = _read_json(tgt / "memory" / "legacy-import" / "conversion-receipt.json")
    selected = receipt["source_selection"]["commit"]
    blob = _git_raw(
        root,
        SRC,
        "rev-parse",
        f"{selected}:memory/cards/player-safe/fact-a.md",
        worktree=False,
    ).strip()
    repo = root / ".coc" / "repos" / "campaigns" / f"{SRC}.git"
    object_path = repo / "objects" / blob[:2] / blob[2:]
    assert object_path.is_file()
    os.chmod(object_path, 0o600)
    object_path.write_bytes(b"corrupted selected blob")

    with pytest.raises(conv.LegacyConversionError, match="git cat-file|historical source"):
        _import(root, source_turn=3)
    assert _store_digests(tgt) == store_before


def test_historical_source_drift_before_publish_aborts(tmp_path, monkeypatch):
    root = tmp_path
    src = _seed_historical_source(root)
    (src / "save").mkdir(exist_ok=True)
    (src / "save" / "quest-state.json").write_text(
        '{"quest": "dirty-but-preserved"}\n', encoding="utf-8"
    )
    sidecar = root / ".coc" / "repos" / "campaigns" / f"{SRC}.git"
    sidecar_before = _dir_digest(sidecar)
    real_create = conv.coc_state._create_campaign_at

    def mutate_dirty_source_during_staging(*args, **kwargs):
        result = real_create(*args, **kwargs)
        (src / "save" / "quest-state.json").write_text(
            '{"quest": "drifted-during-historical-import"}\n', encoding="utf-8"
        )
        return result

    monkeypatch.setattr(
        conv.coc_state, "_create_campaign_at", mutate_dirty_source_during_staging
    )
    with pytest.raises(
        conv.LegacyConversionError, match="drifted between preflight and publish"
    ):
        _import(root, source_turn=3)
    monkeypatch.undo()
    assert not _camp(root, TGT).exists()
    assert (src / "save" / "quest-state.json").read_text(encoding="utf-8") == (
        '{"quest": "drifted-during-historical-import"}\n'
    )
    assert _dir_digest(sidecar) == sidecar_before


def test_cli_public_json_excludes_integrity_evidence_for_dry_apply_and_replay(
    tmp_path, capsys
):
    root = tmp_path
    _seed_historical_source(root)
    base = [
        "--root",
        str(root),
        "--source-campaign",
        SRC,
        "--target-campaign",
        TGT,
        "--source-turn",
        "3",
    ]

    def run_cli(*extra: str) -> dict:
        assert conv.main([*base, *extra]) == 0
        captured = capsys.readouterr()
        assert captured.err == ""
        payload = json.loads(captured.out)
        _assert_public_json_is_semantic(payload)
        assert payload["source_lineage"] == {"timeline_id": "tl-main"}
        assert payload["source_turn"] == 3
        return payload

    dry = run_cli("--dry-run")
    assert dry["dry_run"] is True
    assert dry["status"] == "planned"
    assert "manifest_path" not in dry
    assert "receipt_path" not in dry

    applied = run_cli()
    replayed = run_cli()
    expected_paths = {
        "manifest_path": (
            f".coc/campaigns/{TGT}/memory/legacy-import/import-manifest.json"
        ),
        "receipt_path": (
            f".coc/campaigns/{TGT}/memory/legacy-import/conversion-receipt.json"
        ),
    }
    assert applied["dry_run"] is False
    assert applied["replay"] is False
    assert applied["status"] == "complete"
    assert {key: applied[key] for key in expected_paths} == expected_paths
    assert replayed["dry_run"] is False
    assert replayed["replay"] is True
    assert replayed["status"] == "complete"
    assert {key: replayed[key] for key in expected_paths} == expected_paths

    evidence = _camp(root, TGT) / "memory" / "legacy-import"
    manifest = _read_json(evidence / "import-manifest.json")
    receipt = _read_json(evidence / "conversion-receipt.json")
    assert re.fullmatch(r"[0-9a-f]{64}", receipt["source_snapshot_digest"])
    assert re.fullmatch(r"[0-9a-f]{64}", receipt["source_git_digest"])
    assert re.fullmatch(r"[0-9a-f]{64}", receipt["manifest_sha256"])
    assert re.fullmatch(r"[0-9a-f]{40,64}", manifest["source_selection"]["commit"])
    assert re.fullmatch(r"[0-9a-f]{40,64}", manifest["source_selection"]["tree"])
    assert manifest["source_git"]["active_ref"] == "refs/heads/main"
    assert re.fullmatch(r"[0-9a-f]{64}", manifest["cards"][0]["sha256"])


def test_cli_source_turn_accepts_only_positive_semantic_integer(tmp_path, capsys):
    root = tmp_path
    src = _seed_historical_source(root)
    (src / "save").mkdir(exist_ok=True)
    (src / "save" / "quest-state.json").write_text(
        '{"quest": "dirty"}\n', encoding="utf-8"
    )
    code = conv.main(
        [
            "--root",
            str(root),
            "--source-campaign",
            SRC,
            "--target-campaign",
            TGT,
            "--source-turn",
            "3",
            "--dry-run",
        ]
    )
    assert code == 0
    assert json.loads(capsys.readouterr().out)["source_turn"] == 3
    with pytest.raises(SystemExit) as exc:
        conv.main(
            [
                "--root",
                str(root),
                "--source-campaign",
                SRC,
                "--target-campaign",
                TGT,
                "--source-turn",
                "0",
            ]
        )
    assert exc.value.code == 2
