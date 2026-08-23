"""Shared state-effect authority: writer/receipt matrix and non-writer rejects."""
from __future__ import annotations

from pathlib import Path
import sys


SCRIPTS = Path(__file__).resolve().parents[1] / "plugins" / "coc-keeper" / "scripts"
EXPORT = (
    Path(__file__).resolve().parents[1]
    / "plugins" / "coc-keeper" / "skills" / "coc-export-battle-report" / "scripts"
)
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import coc_state_effect_authority as authority
import coc_turn_finalization


def _export():
    import importlib.util

    spec = importlib.util.spec_from_file_location(
        "coc_export_battle_report_authority",
        EXPORT / "export_battle_report.py",
    )
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def _call(
    tool: str,
    decision_id: str,
    *,
    ok: bool = True,
    investigator: str = "hero",
    replay: bool = False,
    data: dict | None = None,
) -> dict:
    row = {
        "ok": ok,
        "tool": tool,
        "args": {"decision_id": decision_id, "investigator": investigator},
        "data": {"investigator_id": investigator, "decision_id": decision_id},
    }
    if data:
        row["data"].update(data)
    if replay:
        row["idempotent_replay"] = True
    return row


def _hp_receipt(investigator: str = "hero", before: int = 10, after: int = 8) -> dict:
    return {
        "schema_version": 1,
        "investigator_id": investigator,
        "hp": {"before": before, "after": after},
        "san": {"before": 50, "after": 50},
        "mp": {"before": 12, "after": 12},
        "luck": {"before": 40, "after": 40},
        "conditions_before": [],
        "conditions_after": [],
        "loaded_ammunition": [],
    }


def _hp_effect(decision_id: str = "hp-1") -> dict:
    return {
        "schema_version": 1,
        "category": "state_delta",
        "effect_id": f"effect:{decision_id}:HP",
        "effect_kind": "scalar",
        "resource": "HP",
        "investigator_id": "hero",
        "before": 10,
        "delta": -2,
        "after": 8,
        "source_decision_id": decision_id,
    }


def _san_effect(decision_id: str = "san-1") -> dict:
    return {
        "schema_version": 1,
        "category": "state_delta",
        "effect_id": f"effect:{decision_id}:SAN",
        "effect_kind": "scalar",
        "resource": "SAN",
        "investigator_id": "hero",
        "before": 50,
        "delta": -5,
        "after": 45,
        "source_decision_id": decision_id,
    }


def _condition_effect(decision_id: str = "cond-1") -> dict:
    return {
        "schema_version": 1,
        "category": "state_delta",
        "effect_id": f"effect:{decision_id}:major_wound",
        "effect_kind": "condition",
        "investigator_id": "hero",
        "condition": "major_wound",
        "action": "added",
        "source_decision_id": decision_id,
    }


def _ammo_effect(decision_id: str = "ammo-1") -> dict:
    return {
        "schema_version": 1,
        "category": "state_delta",
        "effect_id": f"effect:{decision_id}:revolver",
        "effect_kind": "loaded_ammunition",
        "investigator_id": "hero",
        "weapon_id": "revolver",
        "before": 6,
        "change": -1,
        "after": 5,
        "source_decision_id": decision_id,
    }


def _item_effect(decision_id: str = "item-1") -> dict:
    return {
        "schema_version": 1,
        "category": "state_delta",
        "effect_id": f"effect:{decision_id}:house-keys",
        "effect_kind": "item",
        "investigator_id": "hero",
        "item_id": "house-keys",
        "action": "acquired",
        "present_before": False,
        "present_after": True,
        "source_decision_id": decision_id,
    }


def _cash_effect(decision_id: str = "cash-1") -> dict:
    return {
        "schema_version": 1,
        "category": "state_delta",
        "effect_id": f"effect:{decision_id}:USD",
        "effect_kind": "cash",
        "investigator_id": "hero",
        "action": "grant",
        "amount": "20.00",
        "currency": "USD",
        "balance_before": "0.00",
        "balance_after": "20.00",
        "source_decision_id": decision_id,
    }


def _time_effect(decision_id: str = "time-1") -> dict:
    return {
        "schema_version": 1,
        "category": "state_delta",
        "effect_id": f"effect:{decision_id}:elapsed",
        "effect_kind": "time",
        "before": 10,
        "delta_minutes": 20,
        "after": 30,
        "source_decision_id": decision_id,
    }


def _exceptional_effect(decision_id: str = "exc-1") -> dict:
    return {
        "schema_version": 1,
        "category": "exceptional_effect",
        "effect_id": "fx-1",
        "event_id": "fx-1:applied:exc-1",
        "effect_kind": "bonus_die",
        "source_decision_id": decision_id,
        "action": "apply",
    }


def _both_reasons(effect, window):
    helper = authority.state_delta_proof_reason(effect, window)
    finalize = authority.state_delta_proof_reason(effect, window)
    export_module = _export()
    export = export_module._state_effect_authority().state_delta_proof_reason(
        effect, window, registry=export_module._toolbox_registry(),
    )
    assert helper == finalize
    assert helper == export
    return helper


def test_valid_receipt_passes_finalizer_and_exporter() -> None:
    effect = _hp_effect()
    call = _call(
        "combat.resolve",
        "hp-1",
        data={"player_state_receipt": _hp_receipt()},
    )
    assert _both_reasons(effect, [call]) is None
    assert coc_turn_finalization._state_delta_proof_violations([call], [effect]) == []
    rows = _export()._state_diff_rows([call], [{
        "finalization_id": "fin-1",
        "bundle": {"state_delta": [effect], "asset_delta": []},
    }])
    assert len(rows) == 1
    assert rows[0]["source_tool"] == "combat.resolve"


def test_invalid_non_writer_fails_both() -> None:
    effect = _hp_effect()
    for tool in (
        "rules.roll",
        "state.journal",
        "narration.review",
        "state.inventory_list",
    ):
        call = _call(
            tool,
            "hp-1",
            data={"player_state_receipt": _hp_receipt()},
        )
        reason = _both_reasons(effect, [call])
        assert reason in {"mismatch", "advisory", "unknown"}
        assert coc_turn_finalization._state_delta_proof_violations([call], [effect])
        assert _export()._state_diff_rows([call], [{
            "finalization_id": "fin-1",
            "bundle": {"state_delta": [effect], "asset_delta": []},
        }]) == []


def test_replay_only_never_proves_original_plus_replay_does() -> None:
    effect = _item_effect()
    data = {
        "item_id": "house-keys",
        "present_before": False,
        "present_after": True,
    }
    original = _call("state.item_grant", "item-1", data=data)
    replay = _call("state.item_grant", "item-1", replay=True, data=data)
    assert _both_reasons(effect, [replay]) == "replay"
    assert _both_reasons(effect, [original, replay]) is None
    assert _both_reasons(
        effect,
        [_call("state.item_grant", "item-1", ok=False, data=data), replay],
    ) == "failed"


def test_condition_item_cash_time_exceptional_and_ammo_matrix() -> None:
    cases = [
        (
            _condition_effect(),
            _call("rules.damage", "cond-1", data={
                "hp_before": 10,
                "hp_after": 3,
                "conditions_before": [],
                "conditions_after": ["major_wound"],
            }),
        ),
        (
            _item_effect(),
            _call("state.item_grant", "item-1", data={
                "item_id": "house-keys",
                "present_before": False,
                "present_after": True,
            }),
        ),
        (
            _cash_effect(),
            _call("state.cash_grant", "cash-1", data={
                "currency": "USD",
                "balance_before": "0.00",
                "balance_after": "20.00",
            }),
        ),
        (
            _time_effect(),
            _call("state.advance_time", "time-1", data={
                "from_elapsed": 10,
                "to_elapsed": 30,
            }),
        ),
        (
            _exceptional_effect(),
            _call("state.exceptional_effect", "exc-1", data={
                "action": "apply",
                "effect": {"effect_id": "fx-1"},
            }),
        ),
        (
            _ammo_effect(),
            _call("combat.resolve", "ammo-1", data={
                "player_state_receipt": {
                    "schema_version": 1,
                    "investigator_id": "hero",
                    "loaded_ammunition": [{
                        "weapon_id": "revolver",
                        "before": 6,
                        "change": -1,
                        "after": 5,
                    }],
                },
            }),
        ),
        (
            _san_effect(),
            _call("sanity.execute", "san-1", data={
                "player_state_receipt": {
                    "schema_version": 1,
                    "investigator_id": "hero",
                    "san": {"before": 50, "after": 45},
                },
            }),
        ),
        (
            _hp_effect("heal-1"),
            _call("rules.first_aid", "heal-1", data={
                "player_state_receipt": _hp_receipt(),
            }),
        ),
    ]
    for effect, call in cases:
        assert _both_reasons(effect, [call]) is None, effect["effect_kind"]
        journal = _call("state.journal", effect["source_decision_id"], data=call["data"])
        assert _both_reasons(effect, [journal]) in {"mismatch", "advisory"}


def test_rules_damage_without_structured_hp_does_not_prove() -> None:
    effect = _hp_effect()
    bare = _call("rules.damage", "hp-1")
    assert _both_reasons(effect, [bare]) == "mismatch"
    proven = _call("rules.damage", "hp-1", data={"hp_before": 10, "hp_after": 8})
    assert _both_reasons(effect, [proven]) is None
