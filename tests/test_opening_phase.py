"""Contract tests for the single opening lifecycle phase derivation.

One derivation (``coc_opening_phase.derive_opening_phase``) answers "where is
this campaign in the opening lifecycle" for the Pi opening gate, the
``setup.phase`` query, ``setup.complete``, and the web projection. These tests
pin the derivation matrix across the three real entry paths and the per-phase
allowed-operation table that replaced the scattered gate branches.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "plugins" / "coc-keeper" / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import coc_opening_phase  # noqa: E402
import coc_runtime_ops  # noqa: E402
import coc_state  # noqa: E402
import coc_toolbox  # noqa: E402


def _write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def _campaign(root: Path, campaign_id: str, era: str = "1920s") -> Path:
    coc_state.create_campaign(root, campaign_id, "Opening Phase", era=era)
    return root / ".coc" / "campaigns" / campaign_id


def _link(
    root: Path,
    campaign_id: str,
    investigator_id: str = "inv-ok",
    *,
    method: str = "quick_fire",
) -> None:
    campaign_dir = root / ".coc" / "campaigns" / campaign_id
    _write_json(
        campaign_dir / "party.json",
        {
            "schema_version": 1,
            "campaign_id": campaign_id,
            "investigator_ids": [investigator_id],
            "active_investigator_ids": [investigator_id],
        },
    )
    _write_json(
        root / ".coc" / "investigators" / investigator_id / "creation.json",
        {
            "schema_version": 1,
            "investigator_id": investigator_id,
            "method": method,
        },
    )


def _set_status(campaign_dir: Path, status: str) -> None:
    path = campaign_dir / "campaign.json"
    campaign = json.loads(path.read_text(encoding="utf-8"))
    campaign["status"] = status
    path.write_text(json.dumps(campaign, indent=2) + "\n", encoding="utf-8")


def _resolvable_root(monkeypatch, asset_root_id: str = "asset-root-src") -> None:
    """Pretend the bound source root resolves, without a module-assets tree."""
    monkeypatch.setattr(
        coc_toolbox.coc_module_project,
        "resolve_opening_preparation_root",
        lambda root, campaign_id: {
            "asset_root_id": asset_root_id,
            "source_id": "pdf:src",
            "file_sha256": "0" * 64,
            "page_count": 3,
            "producer": "codex-pdf-skill",
        },
    )


def _pending_review_scenario(campaign_id: str) -> dict:
    scenario = {
        "schema_version": 1,
        "scenario_id": "src-mod",
        "progressive_asset_root_id": "asset-root-src",
        "opening_source_provenance": "selection_hint_only_not_provenance",
        "source": {
            "source_id": "pdf:src",
            "source_bundle_path": "bundles/src",
            "file_sha256": "a" * 64,
            "bundle_sha256": "b" * 64,
        },
    }
    task = {
        "schema_version": 1,
        "contract_id": coc_runtime_ops._OPENING_REVIEW_TASK_CONTRACT_ID,
        "status": "pending",
        "generation": 1,
        "challenge": "c" * 64,
        "execution_owner": coc_runtime_ops._OPENING_REVIEW_OWNER,
        "coordinator_contract_id": "coc.codex-opening-source-task.v1",
        "continuation_contract_id": "coc.opening-source-continue.v1",
        "campaign_id": campaign_id,
        "scenario_id": "src-mod",
        "source_bundle_id": "bundle-src",
        "source_bundle_path": "bundles/src",
        "source_id": "pdf:src",
        "source_file_sha256": "a" * 64,
        "source_bundle_sha256": "b" * 64,
        "allowed_pdf_indices": [0, 1, 2],
        "max_selected_opening_pages": 3,
        "result_delivery": "task_return_to_parent",
        "task_identity_sha256": None,
        "terminal_receipt_sha256": None,
    }
    task["task_identity_sha256"] = coc_runtime_ops._opening_review_task_digest(
        task
    )
    scenario["opening_source_review_task"] = task
    return scenario


# --------------------------------------------------------------------------- #
# Derivation matrix
# --------------------------------------------------------------------------- #


def test_missing_campaign_derives_unknown_campaign_block(tmp_path: Path):
    derived = coc_opening_phase.derive_opening_phase(tmp_path, "nope")
    assert derived["phase"] == coc_opening_phase.PHASE_MODULE_PREPARATION
    assert derived["detail"]["campaign_exists"] is False
    assert derived["detail"]["campaign_status"] is None
    assert derived["blocking_reason"]["code"] == "unknown_campaign"
    assert derived["next_operation"] is None


def test_starter_without_investigator_is_character_creation(tmp_path: Path):
    _campaign(tmp_path, "starter-a")
    derived = coc_opening_phase.derive_opening_phase(tmp_path, "starter-a")
    assert derived["phase"] == coc_opening_phase.PHASE_CHARACTER_CREATION
    preparation = derived["detail"]["module_preparation"]
    # Starter is not "another gate": module preparation is trivially satisfied.
    assert preparation["source_gated"] is False
    assert preparation["satisfied"] is True
    assert preparation["sub_phase"] is None
    assert preparation["readiness"]["state"] == "not_source_gated"
    assert preparation["blocking_reason"] is None
    character_setup = derived["detail"]["character_setup"]
    assert character_setup["confirmed"] is False
    assert character_setup["policy"] == "guided_quick_fire"
    assert character_setup["resume_gate_required"] is True
    assert derived["blocking_reason"]["code"] == "character_setup_incomplete"
    assert derived["detail"]["session_role"] == "setup"


def test_era_adaptive_starter_reports_its_chargen_policy(tmp_path: Path):
    _campaign(tmp_path, "starter-ww1", era="ww1")
    derived = coc_opening_phase.derive_opening_phase(tmp_path, "starter-ww1")
    assert derived["phase"] == coc_opening_phase.PHASE_CHARACTER_CREATION
    assert derived["detail"]["character_setup"]["policy"] == (
        "kp_guided_era_adaptive"
    )


def test_confirmed_investigator_points_at_setup_complete(tmp_path: Path):
    _campaign(tmp_path, "starter-b")
    _link(tmp_path, "starter-b")
    derived = coc_opening_phase.derive_opening_phase(tmp_path, "starter-b")
    assert derived["phase"] == coc_opening_phase.PHASE_CHARACTER_CREATION
    assert derived["detail"]["character_setup"]["confirmed"] is True
    assert derived["detail"]["character_setup"]["resume_gate_required"] is False
    assert derived["next_operation"]["operation"] == "setup.complete"
    assert derived["blocking_reason"] is None


def test_placeholder_party_row_is_not_character_creation_completion(
    tmp_path: Path,
):
    _campaign(tmp_path, "starter-c")
    _link(
        tmp_path,
        "starter-c",
        "web-char-setup-draft",
        method="complete_sheet_placeholder",
    )
    derived = coc_opening_phase.derive_opening_phase(tmp_path, "starter-c")
    assert derived["phase"] == coc_opening_phase.PHASE_CHARACTER_CREATION
    assert derived["detail"]["character_setup"]["confirmed"] is False
    assert derived["detail"]["character_setup"]["party_linked"] is True
    # A linked placeholder is not the pristine empty party the resume
    # discriminator is for.
    assert derived["detail"]["character_setup"]["resume_gate_required"] is False


def test_ready_for_table_points_at_table_opening(tmp_path: Path):
    campaign_dir = _campaign(tmp_path, "ready-a")
    _link(tmp_path, "ready-a")
    _set_status(campaign_dir, "ready_for_table")
    derived = coc_opening_phase.derive_opening_phase(tmp_path, "ready-a")
    assert derived["phase"] == coc_opening_phase.PHASE_READY_FOR_TABLE
    assert derived["next_operation"]["operation"] == "evidence.table_opening"
    assert derived["blocking_reason"] is None
    assert derived["detail"]["session_role"] == "play"


def test_active_with_confirmed_investigator_is_active(tmp_path: Path):
    campaign_dir = _campaign(tmp_path, "active-a")
    _link(tmp_path, "active-a")
    _set_status(campaign_dir, "active")
    derived = coc_opening_phase.derive_opening_phase(tmp_path, "active-a")
    assert derived["phase"] == coc_opening_phase.PHASE_ACTIVE
    assert derived["next_operation"] is None
    assert derived["detail"]["session_role"] == "play"


def test_active_without_confirmed_investigator_stays_character_creation(
    tmp_path: Path,
):
    campaign_dir = _campaign(tmp_path, "active-b")
    _set_status(campaign_dir, "active")
    derived = coc_opening_phase.derive_opening_phase(tmp_path, "active-b")
    assert derived["phase"] == coc_opening_phase.PHASE_CHARACTER_CREATION
    assert derived["detail"]["session_role"] == "setup"


def test_cold_compiled_library_binding_is_not_readiness_gated(tmp_path: Path):
    """Cold-compiled library installs publish the whole IR up front.

    ``opening_source_readiness`` therefore reports ``not_source_gated``, so the
    ``setup.complete`` authority does not block. The persisted source contract
    is a separate, stricter authority: a binding that cannot resolve still
    fails closed for live play. Both are preserved here deliberately.
    """
    campaign_dir = _campaign(tmp_path, "library-a")
    _link(tmp_path, "library-a")
    _write_json(
        campaign_dir / "scenario" / "scenario.json",
        {
            "schema_version": 1,
            "scenario_id": "lib-mod",
            "progressive_asset_root_id": "asset-root-lib",
        },
    )
    _write_json(
        campaign_dir / "scenario" / "resolution-receipt.json",
        {"schema_version": 1, "scenario_id": "lib-mod"},
    )
    derived = coc_opening_phase.derive_opening_phase(tmp_path, "library-a")
    preparation = derived["detail"]["module_preparation"]
    assert preparation["readiness"]["reason"] == "cold_compiled"
    assert preparation["blocking_reason"] is None
    assert preparation["sub_phase"] == (
        coc_opening_phase.SUB_PHASE_CONTRACT_INVALID
    )
    assert derived["phase"] == coc_opening_phase.PHASE_MODULE_PREPARATION


def test_resolvable_library_binding_without_projection_needs_selection(
    tmp_path: Path, monkeypatch,
):
    campaign_dir = _campaign(tmp_path, "library-b")
    _link(tmp_path, "library-b")
    _write_json(
        campaign_dir / "scenario" / "scenario.json",
        {
            "schema_version": 1,
            "scenario_id": "lib-mod",
            "progressive_asset_root_id": "asset-root-src",
        },
    )
    _resolvable_root(monkeypatch)
    derived = coc_opening_phase.derive_opening_phase(tmp_path, "library-b")
    preparation = derived["detail"]["module_preparation"]
    assert derived["phase"] == coc_opening_phase.PHASE_MODULE_PREPARATION
    assert preparation["sub_phase"] == coc_opening_phase.SUB_PHASE_SELECTION
    assert preparation["source_gated"] is True
    assert preparation["asset_root_id"] == "asset-root-src"
    assert preparation["blocking_reason"]["code"] == (
        "opening_source_not_prepared"
    )
    assert derived["next_operation"]["operation"] == (
        "progressive.prepare_opening"
    )


@pytest.mark.parametrize(
    "watch_status,expected_code",
    [
        ("pending", "opening_source_pending"),
        ("refused_terminal", "opening_source_failed"),
    ],
)
def test_pending_watch_is_materialization(
    tmp_path: Path, monkeypatch, watch_status: str, expected_code: str,
):
    campaign_dir = _campaign(tmp_path, "pdf-watch")
    _link(tmp_path, "pdf-watch")
    _write_json(
        campaign_dir / "scenario" / "scenario.json",
        {
            "schema_version": 1,
            "scenario_id": "src-mod",
            "progressive_asset_root_id": "asset-root-src",
            "opening_projection_watch": {
                "status": watch_status,
                "asset_root_id": "asset-root-src",
                "start_location_id": "opening",
            },
        },
    )
    _resolvable_root(monkeypatch)
    derived = coc_opening_phase.derive_opening_phase(tmp_path, "pdf-watch")
    preparation = derived["detail"]["module_preparation"]
    assert derived["phase"] == coc_opening_phase.PHASE_MODULE_PREPARATION
    assert preparation["sub_phase"] == (
        coc_opening_phase.SUB_PHASE_MATERIALIZATION
    )
    assert preparation["watch_status"] == watch_status
    assert preparation["blocking_reason"]["code"] == expected_code
    # The live host-work lifecycle card is owned by the host gate.
    assert derived["next_operation"] is None


def test_pending_coordinator_review_is_review_required(
    tmp_path: Path, monkeypatch,
):
    campaign_dir = _campaign(tmp_path, "pdf-review")
    _write_json(
        campaign_dir / "scenario" / "scenario.json",
        _pending_review_scenario("pdf-review"),
    )
    _resolvable_root(monkeypatch)
    derived = coc_opening_phase.derive_opening_phase(tmp_path, "pdf-review")
    preparation = derived["detail"]["module_preparation"]
    assert preparation["sub_phase"] == (
        coc_opening_phase.SUB_PHASE_REVIEW_REQUIRED
    )
    assert preparation["review_task"]["scenario_id"] == "src-mod"
    assert preparation["review_task"]["opening_review_generation"] == 1
    assert preparation["source_provenance"] == (
        "selection_hint_only_not_provenance"
    )
    assert derived["next_operation"] is None


def test_tampered_review_task_fails_closed_as_contract_invalid(
    tmp_path: Path, monkeypatch,
):
    campaign_dir = _campaign(tmp_path, "pdf-tampered")
    scenario = _pending_review_scenario("pdf-tampered")
    scenario["opening_source_review_task"]["allowed_pdf_indices"] = [7]
    _write_json(campaign_dir / "scenario" / "scenario.json", scenario)
    _resolvable_root(monkeypatch)
    derived = coc_opening_phase.derive_opening_phase(tmp_path, "pdf-tampered")
    preparation = derived["detail"]["module_preparation"]
    assert preparation["sub_phase"] == (
        coc_opening_phase.SUB_PHASE_CONTRACT_INVALID
    )
    assert preparation["contract_error"]["code"] == (
        "opening_source_review_task_invalid"
    )


def test_provenance_mismatch_and_malformed_scenario_fail_closed(
    tmp_path: Path,
):
    mismatch_dir = _campaign(tmp_path, "mismatch")
    _write_json(
        mismatch_dir / "scenario" / "scenario.json",
        {
            "schema_version": 1,
            "opening_source_provenance": "coordinator_reviewed_playable_opening",
            "source": {
                "opening_source_provenance": (
                    "selection_hint_only_not_provenance"
                ),
            },
        },
    )
    mismatch = coc_opening_phase.derive_opening_phase(tmp_path, "mismatch")
    assert mismatch["detail"]["module_preparation"]["contract_error"]["code"] == (
        "opening_source_provenance_mismatch"
    )

    broken_dir = _campaign(tmp_path, "broken")
    (broken_dir / "scenario").mkdir(parents=True, exist_ok=True)
    (broken_dir / "scenario" / "scenario.json").write_text(
        "{not json", encoding="utf-8",
    )
    broken = coc_opening_phase.derive_opening_phase(tmp_path, "broken")
    assert broken["detail"]["module_preparation"]["contract_error"]["code"] == (
        "opening_scenario_metadata_invalid"
    )
    assert broken["phase"] == coc_opening_phase.PHASE_MODULE_PREPARATION


def test_fresh_projection_satisfies_preparation_and_awaits_character_setup(
    tmp_path: Path, monkeypatch,
):
    campaign_dir = _campaign(tmp_path, "pdf-fresh")
    _write_json(
        campaign_dir / "scenario" / "scenario.json",
        {
            "schema_version": 1,
            "scenario_id": "src-mod",
            "progressive_asset_root_id": "asset-root-src",
            "opening_projection_receipt": {
                "schema_version": 1,
                "asset_root_id": "asset-root-src",
                "start_location_id": "opening",
            },
            "opening_projection_source_binding": {
                "asset_root_id": "asset-root-src",
                "start_location_id": "opening",
                "source_scope": {"pdf_indices": [0]},
            },
        },
    )
    _resolvable_root(monkeypatch)
    monkeypatch.setattr(
        coc_toolbox.coc_module_project,
        "opening_projection_state_is_fresh",
        lambda *args, **kwargs: True,
    )
    derived = coc_opening_phase.derive_opening_phase(tmp_path, "pdf-fresh")
    preparation = derived["detail"]["module_preparation"]
    assert preparation["satisfied"] is True
    assert preparation["sub_phase"] is None
    assert preparation["source_gated"] is True
    assert derived["phase"] == coc_opening_phase.PHASE_CHARACTER_CREATION
    assert derived["detail"]["character_setup"]["resume_gate_required"] is True


def test_ui_projection_stays_player_safe(tmp_path: Path, monkeypatch):
    campaign_dir = _campaign(tmp_path, "pdf-projection")
    _write_json(
        campaign_dir / "scenario" / "scenario.json",
        _pending_review_scenario("pdf-projection"),
    )
    _resolvable_root(monkeypatch)
    projection = coc_opening_phase.opening_phase_projection(
        tmp_path, "pdf-projection",
    )
    assert projection["phase"] == coc_opening_phase.PHASE_MODULE_PREPARATION
    assert projection["module_preparation_satisfied"] is False
    assert projection["source_gated"] is True
    assert projection["character_setup_confirmed"] is False
    encoded = json.dumps(projection, ensure_ascii=False)
    for secret in ("asset-root-src", "src-mod", "bundle-src", "pdf:src"):
        assert secret not in encoded


# --------------------------------------------------------------------------- #
# One per-phase allowed-operation table
# --------------------------------------------------------------------------- #


def _gate(phase: str, **extra) -> dict:
    return {"phase": phase, **extra}


def _allowed(name: str, args: dict, gate: dict | None) -> bool:
    return coc_toolbox._pi_opening_setup_operation_allowed(name, args, gate)


QUICK_FIRE_DICE = {
    "expression": "3D6",
    "decision_id": "chargen-str",
    "purpose": "investigator_creation_characteristic",
}


def test_table_covers_every_derived_sub_phase():
    assert set(coc_opening_phase.SUB_PHASES) <= set(coc_toolbox._OPENING_SETUP_ACL)
    assert (
        coc_opening_phase.SUB_PHASE_CHARACTER_SETUP_REQUIRED
        in coc_toolbox._OPENING_SETUP_ACL
    )


@pytest.mark.parametrize(
    "phase",
    [
        coc_opening_phase.SUB_PHASE_CONTRACT_INVALID,
        coc_opening_phase.SUB_PHASE_REVIEW_FAILED,
    ],
)
def test_broken_or_failed_source_allows_nothing_but_the_phase_query(phase: str):
    gate = _gate(phase)
    for name, args in (
        ("setup.chargen_run", {"campaign_id": "c"}),
        ("setup.investigator_contract", {"campaign_id": "c"}),
        ("rules.roll_dice", dict(QUICK_FIRE_DICE)),
        ("setup.invoke", {"kind": "investigator.create"}),
        ("progressive.prepare_opening", {}),
        ("state.move_scene", {"scene_id": "x"}),
    ):
        assert _allowed(name, args, gate) is False, name
    assert _allowed("setup.phase", {}, gate) is True


def test_review_required_allows_only_spoiler_free_character_background():
    gate = _gate(coc_opening_phase.SUB_PHASE_REVIEW_REQUIRED)
    for name, args in (
        ("setup.adopt_source_facts", {"campaign_id": "c"}),
        ("setup.investigator_contract", {"campaign_id": "c"}),
        ("rules.cash_assets", {"credit_rating": 20}),
        ("setup.invoke", {"kind": "campaign.render_briefing"}),
        ("rules.roll_dice", dict(QUICK_FIRE_DICE)),
    ):
        assert _allowed(name, args, gate) is True, name
    for name, args in (
        ("progressive.prepare_opening", {}),
        ("progressive.opening_bootstrap", {}),
        ("setup.chargen_run", {"campaign_id": "c"}),
        ("setup.invoke", {"kind": "scenario.bind_pdf"}),
        ("state.cash_semantic", {"amount": 1}),
        ("scene.map", {}),
    ):
        assert _allowed(name, args, gate) is False, name


def test_facts_adoption_allows_only_the_exact_sealed_card():
    arguments = {"campaign_id": "c", "facts": {"schema_version": 1}}
    gate = _gate(
        coc_opening_phase.SUB_PHASE_FACTS_ADOPTION_REQUIRED,
        next_operation={
            "operation": "setup.adopt_source_facts",
            "arguments": arguments,
        },
    )
    assert _allowed("setup.adopt_source_facts", dict(arguments), gate) is True
    assert _allowed(
        "setup.adopt_source_facts", {"campaign_id": "c"}, gate,
    ) is False
    assert _allowed("setup.investigator_contract", {"campaign_id": "c"}, gate) is (
        False
    )
    assert _allowed("rules.roll_dice", dict(QUICK_FIRE_DICE), gate) is False


@pytest.mark.parametrize(
    "phase",
    [
        coc_opening_phase.SUB_PHASE_SELECTION,
        coc_opening_phase.SUB_PHASE_MATERIALIZATION,
        coc_opening_phase.SUB_PHASE_CHARACTER_SETUP_REQUIRED,
    ],
)
def test_open_preparation_phases_share_one_setup_whitelist(phase: str):
    gate = _gate(phase)
    for name in sorted(coc_toolbox._PI_OPENING_SETUP_ALLOWED_OPERATIONS):
        assert _allowed(name, {}, gate) is True, name
    for kind in sorted(coc_toolbox._PI_OPENING_SETUP_ALLOWED_SETUP_KINDS):
        assert _allowed("setup.invoke", {"kind": kind}, gate) is True, kind
    assert _allowed("setup.invoke", {"kind": "scenario.bind_pdf"}, gate) is False
    for name, args in (
        ("state.move_scene", {"scene_id": "x"}),
        ("scene.map", {}),
        ("rules.roll", {"skill": "Spot Hidden"}),
        ("session.begin", {"decision_id": "d"}),
    ):
        assert _allowed(name, args, gate) is False, name


def test_quick_fire_dice_contract_is_purpose_and_shape_bound():
    gate = _gate(coc_opening_phase.SUB_PHASE_CHARACTER_SETUP_REQUIRED)
    assert _allowed("rules.roll_dice", dict(QUICK_FIRE_DICE), gate) is True
    assert _allowed(
        "rules.roll_dice",
        {**QUICK_FIRE_DICE, "purpose": "damage"},
        gate,
    ) is False
    assert _allowed(
        "rules.roll_dice",
        {**QUICK_FIRE_DICE, "expression": "1D100"},
        gate,
    ) is False
    assert _allowed(
        "rules.roll_dice",
        {**QUICK_FIRE_DICE, "decision_id": "  "},
        gate,
    ) is False


def test_era_adaptive_dice_and_cash_require_that_chargen_policy():
    era_dice = {"expression": "2D6+6", "decision_id": "chargen-siz"}
    plain = _gate(coc_opening_phase.SUB_PHASE_CHARACTER_SETUP_REQUIRED)
    era = _gate(
        coc_opening_phase.SUB_PHASE_CHARACTER_SETUP_REQUIRED,
        character_setup_policy="kp_guided_era_adaptive",
    )
    quick_fire = _gate(
        coc_opening_phase.SUB_PHASE_CHARACTER_SETUP_REQUIRED,
        character_setup_policy="guided_quick_fire",
    )
    assert _allowed("rules.roll_dice", era_dice, era) is True
    assert _allowed("rules.roll_dice", era_dice, plain) is False
    assert _allowed("rules.roll_dice", era_dice, quick_fire) is False
    assert _allowed("state.cash_semantic", {"amount": 1}, era) is True
    assert _allowed("state.cash_semantic", {"amount": 1}, quick_fire) is False
    # The source-review row never opens the era-adaptive contract.
    assert _allowed(
        "rules.roll_dice",
        era_dice,
        _gate(
            coc_opening_phase.SUB_PHASE_REVIEW_REQUIRED,
            character_setup_policy="kp_guided_era_adaptive",
        ),
    ) is False


def test_absent_gate_defaults_to_the_open_setup_row():
    assert _allowed("rules.roll_dice", dict(QUICK_FIRE_DICE), None) is True
    assert _allowed("setup.chargen_run", {"campaign_id": "c"}, None) is True
    assert _allowed("state.move_scene", {"scene_id": "x"}, None) is False


# --------------------------------------------------------------------------- #
# Host gate integration (COC_HOST=pi)
# --------------------------------------------------------------------------- #


def test_starter_campaign_emits_no_pi_opening_gate(tmp_path: Path, monkeypatch):
    _campaign(tmp_path, "starter-gate")
    monkeypatch.setenv("COC_HOST", "pi")
    assert coc_toolbox._pi_opening_setup_gate(tmp_path, "starter-gate") is None
    # A starter resume is character setup, not a hard opening gate: it keeps
    # the player-safe creation projection instead of being blocked.
    assert coc_toolbox._pi_opening_setup_gate(
        tmp_path, "starter-gate", include_character_setup=True,
    ) is None


def test_source_bound_gate_envelope_carries_both_phase_layers(
    tmp_path: Path, monkeypatch,
):
    campaign_dir = _campaign(tmp_path, "gate-selection")
    _write_json(
        campaign_dir / "scenario" / "scenario.json",
        {
            "schema_version": 1,
            "scenario_id": "src-mod",
            "progressive_asset_root_id": "asset-root-src",
        },
    )
    _resolvable_root(monkeypatch)
    monkeypatch.setenv("COC_HOST", "pi")
    gate = coc_toolbox._pi_opening_setup_gate(tmp_path, "gate-selection")
    assert gate is not None
    assert gate["phase"] == coc_opening_phase.SUB_PHASE_SELECTION
    assert gate["opening_phase"] == coc_opening_phase.PHASE_MODULE_PREPARATION
    assert gate["hard_gate"] is True
    assert gate["next_operation"]["operation"] == "progressive.prepare_opening"


def test_non_pi_hosts_are_not_gated(tmp_path: Path, monkeypatch):
    campaign_dir = _campaign(tmp_path, "gate-codex")
    _write_json(
        campaign_dir / "scenario" / "scenario.json",
        {
            "schema_version": 1,
            "scenario_id": "src-mod",
            "progressive_asset_root_id": "asset-root-src",
        },
    )
    _resolvable_root(monkeypatch)
    monkeypatch.setenv("COC_HOST", "codex")
    assert coc_toolbox._pi_opening_setup_gate(tmp_path, "gate-codex") is None


def test_setup_phase_operation_returns_the_same_derivation(tmp_path: Path):
    _campaign(tmp_path, "phase-op")
    envelope = coc_toolbox.run_tool(
        "setup.phase", tmp_path, None, {"campaign_id": "phase-op"},
    )
    assert envelope["ok"] is True, envelope
    assert envelope["data"] == coc_opening_phase.derive_opening_phase(
        tmp_path, "phase-op",
    )
    missing = coc_toolbox.run_tool("setup.phase", tmp_path, None, {})
    assert missing["ok"] is False
    assert missing["error"]["code"] == "invalid_param"


def test_web_campaign_projection_carries_the_opening_phase(tmp_path: Path):
    """A3 reads this field instead of scanning investigator directories."""
    import importlib.util

    spec = importlib.util.spec_from_file_location(
        "web_views_opening_phase", ROOT / "runtime" / "sdk" / "web_views.py",
    )
    web_views = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(web_views)

    workspace = tmp_path / "workspace"
    _write_json(
        workspace / ".coc" / "runtime.json",
        {
            "schema_version": 2,
            "planner": {"kind": "deterministic"},
            "rules": {"kind": "deterministic"},
            "narrator": {"kind": "template"},
            "player": {"kind": "human"},
        },
    )
    import coc_starter

    coc_starter.quick_start(
        workspace / ".coc",
        "the-haunting",
        "thomas-hayes",
        campaign_id="web-phase",
        title="Web Phase",
    )
    projected = web_views.project_campaign_state(workspace, "web-phase")
    assert projected["opening_phase"] == (
        coc_opening_phase.opening_phase_projection(workspace, "web-phase")
    )
    assert projected["opening_phase"]["character_setup_confirmed"] is True
    assert projected["opening_phase"]["source_gated"] is False


def test_setup_complete_blocks_from_the_derivation(tmp_path: Path):
    campaign_dir = _campaign(tmp_path, "complete-blocked")
    blocked = coc_toolbox.run_tool(
        "setup.complete",
        tmp_path,
        None,
        {"campaign_id": "complete-blocked", "decision_id": "d-1"},
    )
    assert blocked["ok"] is False
    assert blocked["error"]["code"] == "character_setup_incomplete"

    _link(tmp_path, "complete-blocked")
    _write_json(
        campaign_dir / "scenario" / "scenario.json",
        {
            "schema_version": 1,
            "scenario_id": "src-mod",
            "progressive_asset_root_id": "asset-root-src",
            "opening_projection_watch": {
                "status": "pending",
                "asset_root_id": "asset-root-src",
            },
        },
    )
    pending = coc_toolbox.run_tool(
        "setup.complete",
        tmp_path,
        None,
        {"campaign_id": "complete-blocked", "decision_id": "d-2"},
    )
    assert pending["ok"] is False
    assert pending["error"]["code"] == "opening_source_pending"
    assert pending["error"]["details"]["readiness"]["state"] == "pending"


def test_wire_resume_projection_retains_character_creation(tmp_path: Path):
    """The Pi extension keeps the setup tool surface only when the resume
    projection still carries the ``character_creation`` discriminator; the
    wire projection must not drop it (guided chargen deadlocks otherwise)."""
    import coc_mcp_wire
    import coc_starter

    workspace = tmp_path / "workspace"
    started = coc_starter.quick_start(
        workspace / ".coc",
        "the-haunting",
        None,
        campaign_id="wire-resume-chargen",
    )
    resumed = coc_toolbox.run_tool(
        "session.resume", workspace, started["campaign_id"], {}
    )
    assert resumed["ok"] is True, resumed
    assert resumed["data"]["character_creation"]["status"] == "incomplete"
    for tight in (False, True):
        projected = coc_mcp_wire._project_resume(resumed["data"], tight=tight)
        assert projected["character_creation"]["status"] == "incomplete"
        assert projected["character_creation"]["briefing_path"]
