"""Shared state-effect authority: writer/receipt matrix and non-writer rejects."""
from __future__ import annotations

from copy import deepcopy
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


def _healing_settle_call(
    decision_id: str = "heal-1",
    *,
    before: int = 10,
    after: int = 11,
    conditions_before: list[str] | None = None,
    conditions_after: list[str] | None = None,
    family: str = "healing",
    decision_ref: str = "decision:coc7:healing:first-aid-ordinary",
) -> dict:
    before_conditions = list(conditions_before or [])
    after_conditions = list(conditions_after or [])
    receipt = {
        **_hp_receipt(before=before, after=after),
        "conditions_before": before_conditions,
        "conditions_after": after_conditions,
    }
    event = {
        "event_type": "first_aid",
        "investigator_id": "hero",
        "hp_before": before,
        "hp_after": after,
        "hp_gained": after - before,
    }
    call = _call(
        "rules.settle",
        decision_id,
        data={
            "decision_ref": decision_ref,
            "family": family,
            "status": "settled",
            "authority": "canonical-resolver-state-receipts",
            "event": deepcopy(event),
            "player_state_receipt": deepcopy(receipt),
            "current_hp": after,
            "conditions": list(after_conditions),
            "settlement": {
                "existing_result_envelope": True,
                "result": {
                    "investigator_id": "hero",
                    "event": deepcopy(event),
                    "player_state_receipt": deepcopy(receipt),
                    "current_hp": after,
                    "conditions": list(after_conditions),
                },
            },
        },
    )
    call["args"]["decision_ref"] = decision_ref
    return call


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
    finalize = coc_turn_finalization._state_delta_proof_reason(
        effect, list(window), authority.default_registry(),
    )
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


def test_graph_healing_settle_receipt_proves_hp_for_finalizer_and_exporter() -> None:
    effect = _hp_effect("heal-1")
    effect.update({"before": 10, "delta": 1, "after": 11})
    call = _healing_settle_call()

    assert _both_reasons(effect, [call]) is None
    assert coc_turn_finalization._state_delta_proof_violations([call], [effect]) == []
    rows = _export()._state_diff_rows([call], [{
        "finalization_id": "fin-heal-1",
        "bundle": {"state_delta": [effect], "asset_delta": []},
    }])
    assert len(rows) == 1
    assert rows[0]["source_tool"] == "rules.settle"


def test_graph_healing_settle_receipt_proves_condition_change() -> None:
    call = _healing_settle_call(
        "heal-condition-1",
        before=1,
        after=1,
        conditions_before=["dying"],
        conditions_after=[],
    )
    effect = {
        "schema_version": 1,
        "category": "state_delta",
        "effect_id": "effect:heal-condition-1:dying",
        "effect_kind": "condition",
        "investigator_id": "hero",
        "condition": "dying",
        "action": "removed",
        "source_decision_id": "heal-condition-1",
    }

    assert _both_reasons(effect, [call]) is None


def test_graph_settle_state_authority_uses_ruleset_domain_registry(
    monkeypatch,
) -> None:
    effect = _hp_effect("future-heal-1")
    effect.update({"before": 10, "delta": 1, "after": 11})
    call = _healing_settle_call(
        "future-heal-1",
        family="vitality",
        decision_ref="decision:future:vitality:restore",
    )
    monkeypatch.setattr(
        authority.coc_rulesets,
        "rule_graph_state_effect_domains",
        lambda ruleset_id, decision_ref: (
            ("hp", "condition")
            if (ruleset_id, decision_ref) == (
                "future", "decision:future:vitality:restore",
            )
            else ()
        ),
    )

    assert _both_reasons(effect, [call]) is None


def test_graph_settle_rejects_unregistered_or_malformed_decision_namespace() -> None:
    effect = _hp_effect("future-heal-1")
    effect.update({"before": 10, "delta": 1, "after": 11})
    unregistered = _healing_settle_call(
        "future-heal-1",
        family="vitality",
        decision_ref="decision:future:vitality:restore",
    )
    malformed = _healing_settle_call("future-heal-1")
    malformed["args"]["decision_ref"] = "not-a-decision"
    malformed["data"]["decision_ref"] = "not-a-decision"
    wrong_family = _healing_settle_call("future-heal-1")
    wrong_family["data"]["family"] = "vitality"

    assert _both_reasons(effect, [unregistered]) == "mismatch"
    assert _both_reasons(effect, [malformed]) == "mismatch"
    assert _both_reasons(effect, [wrong_family]) == "mismatch"


def test_graph_healing_settle_fails_closed_without_exact_canonical_receipt() -> None:
    effect = _hp_effect("heal-1")
    effect.update({"before": 10, "delta": 1, "after": 11})
    valid = _healing_settle_call()
    invalid_calls: list[dict] = []

    malformed_family = deepcopy(valid)
    malformed_family["data"]["family"] = ""
    invalid_calls.append(malformed_family)

    wrong_decision_ref = deepcopy(valid)
    wrong_decision_ref["data"]["decision_ref"] = (
        "decision:coc7:healing:medicine"
    )
    invalid_calls.append(wrong_decision_ref)

    wrong_investigator = deepcopy(valid)
    wrong_investigator["args"]["investigator"] = "other-investigator"
    invalid_calls.append(wrong_investigator)

    wrong_event_patient = deepcopy(valid)
    wrong_event_patient["data"]["event"]["patient_id"] = "other-investigator"
    wrong_event_patient["data"]["settlement"]["result"]["event"][
        "patient_id"
    ] = "other-investigator"
    invalid_calls.append(wrong_event_patient)

    wrong_status = deepcopy(valid)
    wrong_status["data"]["status"] = "compiled"
    invalid_calls.append(wrong_status)

    wrong_authority = deepcopy(valid)
    wrong_authority["data"]["authority"] = "advisory"
    invalid_calls.append(wrong_authority)

    missing_receipt = deepcopy(valid)
    missing_receipt["data"].pop("player_state_receipt")
    invalid_calls.append(missing_receipt)

    mismatched_result_receipt = deepcopy(valid)
    mismatched_result_receipt["data"]["settlement"]["result"][
        "player_state_receipt"
    ]["hp"]["after"] = 12
    assert mismatched_result_receipt["data"]["player_state_receipt"]["hp"][
        "after"
    ] == 11
    invalid_calls.append(mismatched_result_receipt)

    mismatched_nested_event = deepcopy(valid)
    mismatched_nested_event["data"]["settlement"]["result"]["event"][
        "hp_after"
    ] = 12
    assert mismatched_nested_event["data"]["event"]["hp_after"] == 11
    invalid_calls.append(mismatched_nested_event)

    mismatched_event_state = deepcopy(valid)
    mismatched_event_state["data"]["event"]["hp_after"] = 12
    mismatched_event_state["data"]["settlement"]["result"]["event"][
        "hp_after"
    ] = 12
    invalid_calls.append(mismatched_event_state)

    mismatched_event_before = deepcopy(valid)
    mismatched_event_before["data"]["event"]["hp_before"] = 9
    mismatched_event_before["data"]["settlement"]["result"]["event"][
        "hp_before"
    ] = 9
    invalid_calls.append(mismatched_event_before)

    missing_nested_envelope = deepcopy(valid)
    missing_nested_envelope["data"]["settlement"].pop("result")
    invalid_calls.append(missing_nested_envelope)

    for call in invalid_calls:
        assert _both_reasons(effect, [call]) == "mismatch"


def test_graph_settle_rejects_malformed_condition_values() -> None:
    effect = {
        "schema_version": 1,
        "category": "state_delta",
        "effect_id": "effect:heal-condition-1:dying",
        "effect_kind": "condition",
        "investigator_id": "hero",
        "condition": "dying",
        "action": "removed",
        "source_decision_id": "heal-condition-1",
    }
    valid = _healing_settle_call(
        "heal-condition-1",
        before=1,
        after=1,
        conditions_before=["dying"],
        conditions_after=[],
    )
    for malformed in ([42], [""], ["dying", "dying"]):
        call = deepcopy(valid)
        call["data"]["player_state_receipt"]["conditions_before"] = list(
            malformed
        )
        call["data"]["settlement"]["result"]["player_state_receipt"][
            "conditions_before"
        ] = list(malformed)
        assert _both_reasons(effect, [call]) == "mismatch"


def test_graph_settle_rejects_boolean_hp_mirrors_and_effect_values() -> None:
    effect = _hp_effect("heal-bool-1")
    effect.update({"before": 0, "delta": 1, "after": 1})
    boolean_mirrors = _healing_settle_call(
        "heal-bool-1", before=0, after=1,
    )
    for event in (
        boolean_mirrors["data"]["event"],
        boolean_mirrors["data"]["settlement"]["result"]["event"],
    ):
        event.update({"hp_before": False, "hp_after": True, "hp_gained": True})
    boolean_mirrors["data"]["current_hp"] = True
    boolean_mirrors["data"]["settlement"]["result"]["current_hp"] = True

    boolean_effect = {
        **effect,
        "before": False,
        "delta": True,
        "after": True,
    }
    valid = _healing_settle_call("heal-bool-1", before=0, after=1)
    nested_receipt_bools = deepcopy(valid)
    nested_receipt_bools["data"]["settlement"]["result"][
        "player_state_receipt"
    ]["hp"] = {"before": False, "after": True}
    nested_event_bools = deepcopy(valid)
    nested_event_bools["data"]["settlement"]["result"]["event"].update({
        "hp_before": False,
        "hp_after": True,
        "hp_gained": True,
    })

    assert _both_reasons(effect, [boolean_mirrors]) == "mismatch"
    assert _both_reasons(boolean_effect, [valid]) == "mismatch"
    assert _both_reasons(effect, [nested_receipt_bools]) == "mismatch"
    assert _both_reasons(effect, [nested_event_bools]) == "mismatch"


def test_graph_healing_settle_failed_or_replay_only_never_proves() -> None:
    effect = _hp_effect("heal-1")
    effect.update({"before": 10, "delta": 1, "after": 11})
    failed = _healing_settle_call()
    failed["ok"] = False
    replay = _healing_settle_call()
    replay["idempotent_replay"] = True

    assert _both_reasons(effect, [failed]) == "failed"
    assert _both_reasons(effect, [replay]) == "replay"


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


def _combat_hp_luck_call() -> dict:
    return _call(
        "combat.resolve",
        "hp-1",
        data={
            "player_state_receipt": {
                "schema_version": 1,
                "investigator_id": "hero",
                "hp": {"before": 10, "after": 9},
                "luck": {"before": 40, "after": 30},
                "conditions_before": [],
                "conditions_after": [],
                "loaded_ammunition": [],
            },
        },
    )


def _luck_effect(decision_id: str = "hp-1") -> dict:
    return {
        "schema_version": 1,
        "category": "state_delta",
        "effect_id": f"effect:{decision_id}:Luck",
        "effect_kind": "scalar",
        "resource": "Luck",
        "investigator_id": "hero",
        "before": 40,
        "delta": -10,
        "after": 30,
        "source_decision_id": decision_id,
    }


def test_combat_resolve_same_receipt_proves_hp_and_luck() -> None:
    call = _combat_hp_luck_call()
    hp = {
        **_hp_effect(),
        "before": 10,
        "delta": -1,
        "after": 9,
    }
    luck = _luck_effect()
    assert _both_reasons(hp, [call]) is None
    assert _both_reasons(luck, [call]) is None
    projected = coc_turn_finalization._project_state_deltas([call])
    kinds = {(row["effect_kind"], row.get("resource")) for row in projected}
    assert ("scalar", "HP") in kinds
    assert ("scalar", "Luck") in kinds
    assert coc_turn_finalization._state_delta_proof_violations([call], projected) == []
    rows = _export()._state_diff_rows([call], [{
        "finalization_id": "fin-combat",
        "bundle": {"state_delta": projected, "asset_delta": []},
    }])
    assert {row["effect"].get("resource") for row in rows} == {"HP", "Luck"}
    assert {row["source_tool"] for row in rows} == {"combat.resolve"}


def test_empty_or_unknown_kind_never_proves() -> None:
    typed_shape = {
        "schema_version": 1,
        "category": "state_delta",
        "effect_id": "effect:hp-1:blank",
        "investigator_id": "hero",
        "before": 10,
        "after": 8,
        "source_decision_id": "hp-1",
    }
    journal = _call(
        "state.journal",
        "hp-1",
        data={"player_state_receipt": _hp_receipt()},
    )
    empty = {**typed_shape, "effect_kind": ""}
    missing = dict(typed_shape)
    unknown = {**typed_shape, "effect_kind": "not_a_kind"}
    assert _both_reasons(empty, [journal]) == "mismatch"
    assert _both_reasons(missing, [journal]) == "mismatch"
    assert _both_reasons(unknown, [journal]) == "mismatch"
    assert authority.receipt_proves_effect(journal, empty) == "mismatch"
    unknown_op = _call(
        "state.not_a_registered_op",
        "hp-1",
        data={"player_state_receipt": _hp_receipt()},
    )
    assert _both_reasons({**typed_shape, "effect_kind": "scalar", **{
        "resource": "HP",
        "delta": -2,
    }}, [unknown_op]) == "unknown"
    assert _both_reasons(unknown, [unknown_op]) == "unknown"
