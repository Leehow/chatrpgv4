"""turn.finalize rejects typed state deltas without a registered write receipt."""
from __future__ import annotations

from pathlib import Path
import sys


SCRIPTS = Path(__file__).resolve().parents[1] / "plugins" / "coc-keeper" / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import coc_state_effect_authority
import coc_turn_finalization


def _item_effect(
    *,
    decision_id: str = "grant-keys",
    investigator_id: str = "hero",
    item_id: str = "house-keys",
) -> dict:
    return {
        "schema_version": 1,
        "category": "state_delta",
        "effect_id": f"effect:{decision_id}:{item_id}",
        "effect_kind": "item",
        "investigator_id": investigator_id,
        "item_id": item_id,
        "label": "钥匙",
        "action": "acquired",
        "present_before": False,
        "present_after": True,
        "source_decision_id": decision_id,
    }


def _cash_effect(*, decision_id: str = "grant-cash", investigator_id: str = "hero") -> dict:
    return {
        "schema_version": 1,
        "category": "state_delta",
        "effect_id": f"effect:{decision_id}:USD",
        "effect_kind": "cash",
        "investigator_id": investigator_id,
        "action": "grant",
        "amount": "20.00",
        "currency": "USD",
        "balance_before": "0.00",
        "balance_after": "20.00",
        "source_decision_id": decision_id,
    }


def _scalar_effect(*, decision_id: str = "dmg-001", investigator_id: str = "hero") -> dict:
    return {
        "schema_version": 1,
        "category": "state_delta",
        "effect_id": f"effect:{decision_id}:HP",
        "effect_kind": "scalar",
        "resource": "HP",
        "investigator_id": investigator_id,
        "before": 10,
        "delta": -2,
        "after": 8,
        "source_decision_id": decision_id,
    }


def _item_data(*, investigator: str = "hero", item_id: str = "house-keys") -> dict:
    return {
        "investigator_id": investigator,
        "item_id": item_id,
        "label": "钥匙",
        "changed": True,
        "present_before": False,
        "present_after": True,
    }


def _cash_data(*, investigator: str = "hero") -> dict:
    return {
        "investigator_id": investigator,
        "changed": True,
        "op": "grant",
        "amount": "20.00",
        "currency": "USD",
        "balance_before": "0.00",
        "balance_after": "20.00",
        "localized_reason": "预付调查费",
        "game_time": {
            "elapsed_minutes": 30,
            "display": "1920-08-15 10:30",
            "player_time": {
                "phase": "morning",
                "appearance_mode": "normal",
                "display_label": None,
            },
        },
    }


def _hp_receipt(*, investigator: str = "hero", before: int = 10, after: int = 8) -> dict:
    return {
        "schema_version": 1,
        "investigator_id": investigator,
        "hp": {"before": before, "after": after},
        "conditions_before": [],
        "conditions_after": [],
        "loaded_ammunition": [],
    }


def _call(
    tool: str,
    decision_id: str,
    *,
    ok: bool = True,
    investigator: str = "hero",
    replay: bool = False,
    extra_data: dict | None = None,
) -> dict:
    row = {
        "ok": ok,
        "tool": tool,
        "args": {"decision_id": decision_id, "investigator": investigator},
        "data": {"investigator_id": investigator, "decision_id": decision_id},
    }
    if extra_data:
        row["data"].update(extra_data)
    if replay:
        row["idempotent_replay"] = True
    return row


def _reasons(window, effects) -> list[str]:
    return [
        row["message"].rsplit("(", 1)[-1].rstrip(")")
        for row in coc_turn_finalization._state_delta_proof_violations(window, effects)
    ]


def test_shape_only_typed_delta_is_rejected() -> None:
    effect = _item_effect()
    rows = coc_turn_finalization._state_delta_proof_violations([], [effect])
    assert len(rows) == 1
    assert rows[0]["code"] == "unproven_state_delta"
    assert rows[0]["stage"] == "state_proof"
    assert "(missing)" in rows[0]["message"]


def test_failed_and_unknown_ops_are_rejected() -> None:
    effect = _item_effect(decision_id="grant-keys")
    failed = _reasons(
        [_call("state.item_grant", "grant-keys", ok=False, extra_data=_item_data())],
        [effect],
    )
    assert failed == ["failed"]
    unknown = _reasons(
        [_call("state.not_a_registered_op", "grant-keys", extra_data=_item_data())],
        [effect],
    )
    assert unknown == ["unknown"]
    advisory = _reasons(
        [_call("state.inventory_list", "grant-keys", extra_data=_item_data())],
        [effect],
    )
    assert advisory == ["advisory"]


def test_successful_registered_state_op_is_accepted() -> None:
    effect = _item_effect()
    rows = coc_turn_finalization._state_delta_proof_violations(
        [_call("state.item_grant", "grant-keys", extra_data=_item_data())],
        [effect],
    )
    assert rows == []


def test_combat_receipt_proves_loaded_ammunition_not_item() -> None:
    ammo = {
        "schema_version": 1,
        "category": "state_delta",
        "effect_id": "effect:combat-shot:ammo",
        "effect_kind": "loaded_ammunition",
        "investigator_id": "hero",
        "weapon_id": "revolver",
        "before": 6,
        "change": -1,
        "after": 5,
        "source_decision_id": "combat-shot",
    }
    window = [_call(
        "combat.resolve",
        "combat-shot",
        extra_data={
            "player_state_receipt": {
                "schema_version": 1,
                "investigator_id": "hero",
                "hp": {"before": 10, "after": 10},
                "loaded_ammunition": [{
                    "weapon_id": "revolver",
                    "weapon_label": "左轮",
                    "before": 6,
                    "change": -1,
                    "after": 5,
                    "scope": "current_loaded_magazine_only",
                }],
            },
        },
    )]
    assert coc_turn_finalization._state_delta_proof_violations(window, [ammo]) == []
    assert _reasons(window, [_item_effect(decision_id="combat-shot")]) == ["mismatch"]


def test_rules_owned_scalar_accepts_registered_rules_receipt() -> None:
    rows = coc_turn_finalization._state_delta_proof_violations(
        [_call(
            "rules.damage",
            "dmg-001",
            extra_data={"hp_before": 10, "hp_after": 8},
        )],
        [_scalar_effect()],
    )
    assert rows == []
    shape_only = coc_turn_finalization._state_delta_proof_violations(
        [],
        [_scalar_effect()],
    )
    assert len(shape_only) == 1
    assert "(missing)" in shape_only[0]["message"]
    non_writer = _reasons(
        [_call("rules.roll", "dmg-001", extra_data={"hp_before": 10, "hp_after": 8})],
        [_scalar_effect()],
    )
    assert non_writer == ["mismatch"]


def test_decision_effect_and_subject_mismatch_are_rejected() -> None:
    item = _item_effect(decision_id="shared", investigator_id="hero")
    wrong_decision = _reasons(
        [_call("state.item_grant", "other-id", extra_data=_item_data())],
        [item],
    )
    assert wrong_decision == ["missing"]
    wrong_effect = _reasons(
        [_call("state.cash_grant", "shared", extra_data=_cash_data())],
        [item],
    )
    assert wrong_effect == ["mismatch"]
    wrong_subject = _reasons(
        [_call(
            "state.item_grant",
            "shared",
            investigator="other",
            extra_data=_item_data(investigator="other"),
        )],
        [item],
    )
    assert wrong_subject == ["mismatch"]


def test_idempotent_replay_links_to_original_success() -> None:
    effect = _item_effect(decision_id="grant-keys")
    original = _call("state.item_grant", "grant-keys", extra_data=_item_data())
    replay = _call("state.item_grant", "grant-keys", replay=True, extra_data=_item_data())
    assert coc_turn_finalization._state_delta_proof_violations(
        [original, replay],
        [effect],
    ) == []
    assert _reasons([replay], [effect]) == ["replay"]
    failed_then_replay = _reasons(
        [_call("state.item_grant", "grant-keys", ok=False, extra_data=_item_data()), replay],
        [effect],
    )
    assert failed_then_replay == ["failed"]


def test_same_valid_and_invalid_receipt_match_exporter_authority() -> None:
    effect = _scalar_effect()
    valid = _call(
        "combat.resolve",
        "dmg-001",
        extra_data={"player_state_receipt": _hp_receipt()},
    )
    invalid = _call(
        "state.journal",
        "dmg-001",
        extra_data={"player_state_receipt": _hp_receipt()},
    )
    assert coc_turn_finalization._state_delta_proof_violations([valid], [effect]) == []
    assert _reasons([invalid], [effect]) == ["mismatch"]
    assert coc_state_effect_authority.state_delta_proof_reason(effect, [valid]) is None
    assert coc_state_effect_authority.state_delta_proof_reason(effect, [invalid]) == "mismatch"


def test_multi_effect_window_proves_each_effect_once() -> None:
    window = [
        _call("state.item_grant", "grant-keys", extra_data=_item_data()),
        _call("state.cash_grant", "grant-cash", extra_data=_cash_data()),
        _call("state.item_grant", "grant-keys", replay=True, extra_data=_item_data()),
    ]
    projected = coc_turn_finalization._project_state_deltas([
        {
            **window[0],
            "data": {
                "investigator_id": "hero",
                "item_id": "house-keys",
                "label": "钥匙",
                "changed": True,
                "present_before": False,
                "present_after": True,
            },
        },
        {
            **window[1],
            "data": {
                "investigator_id": "hero",
                "changed": True,
                "op": "grant",
                "amount": "20.00",
                "currency": "USD",
                "balance_before": "0.00",
                "balance_after": "20.00",
                "localized_reason": "预付调查费",
                "game_time": {
                    "elapsed_minutes": 30,
                    "display": "1920-08-15 10:30",
                    "player_time": {
                        "phase": "morning",
                        "appearance_mode": "normal",
                        "display_label": None,
                    },
                },
            },
        },
        window[2],
    ])
    assert [row["effect_kind"] for row in projected] == ["item", "cash"]
    assert coc_turn_finalization._state_delta_proof_violations(
        window, projected,
    ) == []
    bundle = {
        "public_check": [],
        "state_delta": projected,
        "exceptional_effect": [],
    }
    segments, rendered, _placements = coc_turn_finalization.compose_segments(
        "他收下信封。",
        bundle,
        [{
            "after_paragraph": 0,
            "segment_type": "state_delta",
            "source_ids": [row["effect_id"] for row in projected],
        }],
        play_language="zh-Hans",
    )
    mechanic_ids = [
        source_id
        for row in segments
        if row["segment_type"] in {"state_delta", "asset_delta"}
        for source_id in row["source_ids"]
    ]
    assert mechanic_ids == [row["effect_id"] for row in projected]
    assert rendered.count("获得「钥匙」") == 1
    assert rendered.count("+20.00 USD") == 1
