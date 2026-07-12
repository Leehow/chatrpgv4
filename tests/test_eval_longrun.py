from __future__ import annotations

import hashlib
import importlib.util
import json
import sys
from pathlib import Path


REPO = Path(__file__).resolve().parents[1]
MODULE_PATH = REPO / "plugins" / "coc-keeper" / "scripts" / "coc_eval_longrun.py"
LONG_MEMORY_PATH = REPO / "evaluation" / "spec" / "v1" / "cases" / "long-memory.json"
CHAPTER_TRANSITION_PATH = (
    REPO / "evaluation" / "spec" / "v1" / "cases" / "chapter-transition.json"
)
REGISTRY_PATH = REPO / "evaluation" / "spec" / "v1" / "case-registry.json"

RECALL_ANCHORS = (
    "inventory",
    "injury",
    "san",
    "relationship",
    "clue",
    "unresolved_thread",
)
EPISTEMIC_SIDECARS = (
    "epistemic-graph.json",
    "reveal-contracts.json",
    "compile-confidence.json",
)


def _load():
    assert MODULE_PATH.is_file(), f"missing implementation module: {MODULE_PATH}"
    spec = importlib.util.spec_from_file_location("coc_eval_longrun_test", MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules["coc_eval_longrun_test"] = module
    spec.loader.exec_module(module)
    return module


def _sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _write_json(path: Path, payload: object) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return path


def _requirements_for(lane_id: str) -> dict:
    payload = json.loads(LONG_MEMORY_PATH.read_text(encoding="utf-8"))
    for lane in payload["lanes"]:
        if lane["lane_id"] == lane_id:
            return dict(lane["requirements"])
    raise AssertionError(f"missing lane {lane_id}")


def _chapter_requirements() -> dict:
    payload = json.loads(CHAPTER_TRANSITION_PATH.read_text(encoding="utf-8"))
    return dict(payload["lanes"][0]["requirements"])


def _complete_continuity_evidence(
    *,
    turn_count: int = 25,
    restart_at: int = 13,
    evidence_class: str = "fixture",
    eligible: bool = True,
    attestation: dict | None = None,
    checkpoint_match: bool = True,
    monotonic: bool = True,
    omit_anchor: str | None = None,
) -> dict:
    accepted = list(range(1, turn_count + 1))
    if not monotonic:
        accepted = [1, 3, 2] + list(range(4, turn_count + 1))
    pre_hash = _sha256_text(f"checkpoint-pre-{restart_at}")
    post_hash = pre_hash if checkpoint_match else _sha256_text(f"checkpoint-post-mismatch-{restart_at}")
    anchors = {}
    for name in RECALL_ANCHORS:
        if name == omit_anchor:
            continue
        anchors[name] = {
            "anchor_id": f"anchor-{name}",
            "present_before_restart": True,
            "present_after_restart": True,
            "turn_ids": [restart_at - 1, restart_at + 1],
        }
    evidence = {
        "schema_version": 1,
        "eval_spec": "eval-spec-v1",
        "lane_id": f"continuity-{turn_count}",
        "evidence_class": evidence_class,
        "eligible": eligible,
        "session_id": "session-continuity-1",
        "accepted_turns": accepted,
        "turn_count": turn_count,
        "restart": {
            "at_turn": restart_at,
            "pre_checkpoint_sha256": pre_hash,
            "post_checkpoint_sha256": post_hash,
            "session_id_before": "session-continuity-1",
            "session_id_after": "session-continuity-1",
            "resumed": True,
        },
        "recall_anchors": anchors,
        "secret_audit": {
            "status": "PASS",
            "references": [
                {
                    "artifact": "artifacts/secret-audit.json",
                    "finding_id": "secret-audit-none",
                }
            ],
        },
    }
    if attestation is not None:
        evidence["attestation"] = attestation
    elif evidence_class == "external":
        evidence["attestation"] = {
            "player_model": {"provider": "external", "id": "player-model-1"},
            "kp_model": {"provider": "external", "id": "kp-model-1"},
            "runner": "live_match",
            "attested": True,
        }
    return evidence


def _complete_chapter_evidence(
    *,
    evidence_class: str = "fixture",
    omit_sidecar: str | None = None,
    code_revision_bridge: bool = False,
    include_invalidated_segment: bool = False,
) -> dict:
    sidecars = [name for name in EPISTEMIC_SIDECARS if name != omit_sidecar]
    evidence = {
        "schema_version": 1,
        "eval_spec": "eval-spec-v1",
        "lane_id": "masks-peru-to-america",
        "evidence_class": evidence_class,
        "eligible": True,
        "source_module_id": "masks-of-nyarlathotep",
        "chapter_switch_event": {
            "event_id": "evt-chapter-switch-1",
            "event_type": "chapter_switch",
            "from_scenario_id": "masks-of-nyarlathotep-ch-peru",
            "to_scenario_id": "masks-of-nyarlathotep-ch-america",
        },
        "pre_active_scenario_id": "masks-of-nyarlathotep-ch-peru",
        "post_active_scenario_id": "masks-of-nyarlathotep-ch-america",
        "preserved_epistemic_sidecars": sidecars,
        "investigator_state_continuity": {
            "investigator_id": "inv-1",
            "state_sha256_before": _sha256_text("inv-before"),
            "state_sha256_after": _sha256_text("inv-after-preserved"),
            "preserved": True,
        },
        "campaign_state_continuity": {
            "campaign_id": "camp-1",
            "state_sha256_before": _sha256_text("camp-before"),
            "state_sha256_after": _sha256_text("camp-after-preserved"),
            "preserved": True,
        },
        "discovered_clues": [
            {"clue_id": "clue-peru-1", "retained": True},
        ],
        "relationships": [
            {"npc_id": "npc-peru-guide", "retained": True},
        ],
        "item_continuity": {
            "items": [{"item_id": "item-notebook", "retained": True}],
            "preserved": True,
        },
        "code_revision_bridges_checkpoints": code_revision_bridge,
        "secret_audit": {
            "status": "PASS",
            "references": [
                {
                    "artifact": "artifacts/secret-audit.json",
                    "finding_id": "secret-audit-none",
                }
            ],
        },
    }
    if include_invalidated_segment or code_revision_bridge:
        evidence["invalidated_segment"] = {
            "segment_id": "seg-bridge-1",
            "reason_code": "code_revision_bridge",
            "from_checkpoint_sha256": _sha256_text("ckpt-a"),
            "to_checkpoint_sha256": _sha256_text("ckpt-b"),
            "recorded": True,
        }
    return evidence


def test_long_memory_case_spec_defines_25_and_50_lanes():
    assert LONG_MEMORY_PATH.is_file()
    payload = json.loads(LONG_MEMORY_PATH.read_text(encoding="utf-8"))
    assert payload["schema_version"] == 1
    assert payload["eval_spec"] == "eval-spec-v1"
    lanes = {lane["lane_id"]: lane for lane in payload["lanes"]}
    assert set(lanes) == {"continuity-25", "continuity-50"}
    assert lanes["continuity-25"]["turn_count"] == 25
    assert lanes["continuity-25"]["restart_at_turn"] == 13
    assert lanes["continuity-50"]["turn_count"] == 50
    assert lanes["continuity-50"]["restart_at_turn"] == 27
    for lane in payload["lanes"]:
        req = lane["requirements"]
        assert req["accepted_turns"]["monotonic"] is True
        assert set(req["recall_anchors"]) == set(RECALL_ANCHORS)
        assert req["secret_leakage_audit"]["source"] == "structured_audit_references"
        assert req["secret_leakage_audit"]["forbid_prose_scanning"] is True


def test_chapter_transition_case_spec_is_identifier_only():
    assert CHAPTER_TRANSITION_PATH.is_file()
    payload = json.loads(CHAPTER_TRANSITION_PATH.read_text(encoding="utf-8"))
    assert payload["schema_version"] == 1
    assert payload["eval_spec"] == "eval-spec-v1"
    lane = payload["lanes"][0]
    assert lane["lane_id"] == "masks-peru-to-america"
    req = lane["requirements"]
    assert req["source_module_id"] == "masks-of-nyarlathotep"
    assert req["pre_active_scenario_id"] == "masks-of-nyarlathotep-ch-peru"
    assert req["post_active_scenario_id"] == "masks-of-nyarlathotep-ch-america"
    assert req["preserved_epistemic_sidecars"] == list(EPISTEMIC_SIDECARS)
    raw = CHAPTER_TRANSITION_PATH.read_text(encoding="utf-8").lower()
    # Contract must stay identifier-only: no embedded module prose blobs.
    forbidden_fragments = (
        "you awaken",
        "the expedition",
        "jackson elias",
        "©",
        "all rights reserved",
    )
    for fragment in forbidden_fragments:
        assert fragment not in raw


def test_validate_continuity_missing_run_is_not_run(tmp_path: Path):
    mod = _load()
    result = mod.validate_continuity_run(tmp_path / "missing", _requirements_for("continuity-25"))
    assert result["status"] == "NOT_RUN"
    assert result["findings"]
    assert all(item["severity"] == "missing_evidence" for item in result["findings"])


def test_validate_continuity_empty_dir_is_not_run(tmp_path: Path):
    mod = _load()
    run_dir = tmp_path / "empty-run"
    run_dir.mkdir()
    result = mod.validate_continuity_run(run_dir, _requirements_for("continuity-25"))
    assert result["status"] == "NOT_RUN"
    assert any(item["code"] == "continuity_evidence_missing" for item in result["findings"])


def test_validate_continuity_turn_count_mismatch_fails(tmp_path: Path):
    mod = _load()
    run_dir = tmp_path / "turns"
    evidence = _complete_continuity_evidence(turn_count=20)
    _write_json(run_dir / "continuity-evidence.json", evidence)
    result = mod.validate_continuity_run(run_dir, _requirements_for("continuity-25"))
    assert result["status"] == "FAIL"
    assert any(item["code"] == "turn_count_mismatch" for item in result["findings"])


def test_validate_continuity_non_monotonic_accepted_turns_fails(tmp_path: Path):
    mod = _load()
    run_dir = tmp_path / "nonmono"
    evidence = _complete_continuity_evidence(monotonic=False)
    _write_json(run_dir / "continuity-evidence.json", evidence)
    result = mod.validate_continuity_run(run_dir, _requirements_for("continuity-25"))
    assert result["status"] == "FAIL"
    assert any(item["code"] == "accepted_turns_not_monotonic" for item in result["findings"])


def test_validate_continuity_checkpoint_hash_mismatch_fails(tmp_path: Path):
    mod = _load()
    run_dir = tmp_path / "ckpt"
    evidence = _complete_continuity_evidence(checkpoint_match=False)
    _write_json(run_dir / "continuity-evidence.json", evidence)
    result = mod.validate_continuity_run(run_dir, _requirements_for("continuity-25"))
    assert result["status"] == "FAIL"
    assert any(item["code"] == "checkpoint_hash_mismatch" for item in result["findings"])


def test_validate_continuity_missing_recall_anchor_fails(tmp_path: Path):
    mod = _load()
    run_dir = tmp_path / "anchor"
    evidence = _complete_continuity_evidence(omit_anchor="clue")
    _write_json(run_dir / "continuity-evidence.json", evidence)
    result = mod.validate_continuity_run(run_dir, _requirements_for("continuity-25"))
    assert result["status"] == "FAIL"
    assert any(item["code"] == "recall_anchor_missing" for item in result["findings"])
    assert any(item.get("anchor") == "clue" for item in result["findings"])


def test_validate_continuity_external_without_attestation_is_ineligible(tmp_path: Path):
    mod = _load()
    run_dir = tmp_path / "external"
    evidence = _complete_continuity_evidence(evidence_class="external", attestation={})
    # Explicit empty attestation object marks executed-but-unattested external lane.
    evidence["attestation"] = {}
    _write_json(run_dir / "continuity-evidence.json", evidence)
    result = mod.validate_continuity_run(run_dir, _requirements_for("continuity-25"))
    assert result["status"] == "INELIGIBLE"
    assert any(item["code"] == "external_attestation_missing" for item in result["findings"])


def test_validate_continuity_complete_fixture_passes_and_labels_fixture(tmp_path: Path):
    mod = _load()
    run_dir = tmp_path / "ok"
    evidence = _complete_continuity_evidence(evidence_class="fixture")
    _write_json(run_dir / "continuity-evidence.json", evidence)
    result = mod.validate_continuity_run(run_dir, _requirements_for("continuity-25"))
    assert result["status"] == "PASS"
    assert result["evidence_class"] == "fixture"
    assert result["gameplay_evidence"] is False
    assert result["findings"] == []


def test_validate_continuity_external_attested_is_gameplay_evidence(tmp_path: Path):
    mod = _load()
    run_dir = tmp_path / "ext-ok"
    evidence = _complete_continuity_evidence(evidence_class="external")
    _write_json(run_dir / "continuity-evidence.json", evidence)
    result = mod.validate_continuity_run(run_dir, _requirements_for("continuity-25"))
    assert result["status"] == "PASS"
    assert result["evidence_class"] == "external"
    assert result["gameplay_evidence"] is True


def test_validate_chapter_transition_missing_evidence_is_not_run(tmp_path: Path):
    mod = _load()
    result = mod.validate_chapter_transition(tmp_path / "missing", _chapter_requirements())
    assert result["status"] == "NOT_RUN"
    assert any(item["severity"] == "missing_evidence" for item in result["findings"])


def test_validate_chapter_transition_missing_sidecar_fails(tmp_path: Path):
    mod = _load()
    run_dir = tmp_path / "sidecar"
    evidence = _complete_chapter_evidence(omit_sidecar="reveal-contracts.json")
    _write_json(run_dir / "chapter-transition-evidence.json", evidence)
    result = mod.validate_chapter_transition(run_dir, _chapter_requirements())
    assert result["status"] == "FAIL"
    assert any(item["code"] == "epistemic_sidecar_missing" for item in result["findings"])


def test_validate_chapter_transition_requires_invalidated_segment_when_bridged(tmp_path: Path):
    mod = _load()
    run_dir = tmp_path / "bridge"
    evidence = _complete_chapter_evidence(
        code_revision_bridge=True,
        include_invalidated_segment=False,
    )
    # Force bridge flag without segment payload.
    evidence.pop("invalidated_segment", None)
    evidence["code_revision_bridges_checkpoints"] = True
    _write_json(run_dir / "chapter-transition-evidence.json", evidence)
    result = mod.validate_chapter_transition(run_dir, _chapter_requirements())
    assert result["status"] == "FAIL"
    assert any(item["code"] == "invalidated_segment_missing" for item in result["findings"])


def test_validate_chapter_transition_complete_fixture_passes(tmp_path: Path):
    mod = _load()
    run_dir = tmp_path / "chapter-ok"
    evidence = _complete_chapter_evidence()
    _write_json(run_dir / "chapter-transition-evidence.json", evidence)
    result = mod.validate_chapter_transition(run_dir, _chapter_requirements())
    assert result["status"] == "PASS"
    assert result["evidence_class"] == "fixture"
    assert result["gameplay_evidence"] is False


def test_case_registry_registers_longrun_fixture_self_tests():
    registry = json.loads(REGISTRY_PATH.read_text(encoding="utf-8"))
    by_id = {case["case_id"]: case for case in registry["cases"]}
    assert "long-memory-fixture-self-test" in by_id
    assert "chapter-transition-fixture-self-test" in by_id
    for case_id in (
        "long-memory-fixture-self-test",
        "chapter-transition-fixture-self-test",
    ):
        case = by_id[case_id]
        assert case["kind"] == "pytest_node"
        assert case["gate"] == "hard"
        assert "pr" in case["suites"]
        assert "smoke" not in case["suites"]
        assert "tests/test_eval_longrun.py" in " ".join(case["command"])
        # Deterministic fixture self-tests must not require unimplemented capabilities.
        assert "long_memory" not in case["required_capabilities"]
        assert "chapter_transition" not in case["required_capabilities"]
