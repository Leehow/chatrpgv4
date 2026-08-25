"""Behavior tests owned by the world-time-effects operation cell."""
from toolbox_test_support import *

def test_source_receipt_repairs_secondary_ledger_but_rejects_corrupt_source_or_event(
    campaign_ws,
):
    campaign_dir = campaign_ws["campaign_dir"]
    args = {
        "action": "set",
        "marker_id": "receipt-integrity-probe",
        "minutes_from_now": 7,
        "reason": "integrity probe",
        "decision_id": "receipt-integrity-decision",
    }
    settled = _run(campaign_ws, "state.time_marker", args)
    assert settled["ok"] is True
    original_data = settled["data"]
    marker_path = campaign_dir / "save" / "time-markers.json"
    ledger_path = campaign_dir / "save" / "toolbox-ledger.json"
    events_path = campaign_dir / "logs" / "events.jsonl"
    marker_doc = json.loads(marker_path.read_text(encoding="utf-8"))
    receipt = marker_doc["operation_receipts"]["state.time_marker"][
        args["decision_id"]
    ]

    ledger = json.loads(ledger_path.read_text(encoding="utf-8"))
    ledger_key = coc_toolbox.Ctx._ledger_key(
        "state.time_marker", args["decision_id"]
    )
    ledger["entries"][ledger_key]["data"] = {"corrupt": True}
    _write_json(ledger_path, ledger)
    repaired = _run(campaign_ws, "state.time_marker", args)
    assert repaired["ok"] is True
    assert repaired["data"] == original_data
    repaired_ledger = json.loads(ledger_path.read_text(encoding="utf-8"))
    assert repaired_ledger["entries"][ledger_key]["data"] == original_data

    original_events = _read_jsonl(events_path)
    corrupt_events = [dict(row) for row in original_events]
    target = next(
        row for row in corrupt_events if row.get("event_id") == receipt["event_id"]
    )
    target["reason"] = "corrupt event payload"
    write_text = "\n".join(
        json.dumps(row, ensure_ascii=False) for row in corrupt_events
    ) + "\n"
    events_path.write_text(write_text, encoding="utf-8")
    event_conflict = _run(campaign_ws, "state.time_marker", args)
    assert event_conflict["ok"] is False
    assert event_conflict["error"]["code"] == "state_corrupt"
    assert len([
        row for row in _read_jsonl(events_path)
        if row.get("event_id") == receipt["event_id"]
    ]) == 1

    events_path.write_text(
        "\n".join(json.dumps(row, ensure_ascii=False) for row in original_events)
        + "\n",
        encoding="utf-8",
    )
    marker_doc["operation_receipts"]["state.time_marker"][
        args["decision_id"]
    ]["fingerprint"] = "sha256:corrupt"
    _write_json(marker_path, marker_doc)
    source_conflict = _run(campaign_ws, "state.time_marker", args)
    assert source_conflict["ok"] is False
    assert source_conflict["error"]["code"] == "state_corrupt"

def test_time_marker_receipt_integrity_binds_frozen_result_before_replay_mutation(
    campaign_ws,
):
    campaign_dir = campaign_ws["campaign_dir"]
    args = {
        "action": "set",
        "marker_id": "integrity-body-marker",
        "minutes_from_now": 9,
        "reason": "receipt body integrity",
        "decision_id": "integrity-body-marker-decision",
    }
    assert _run(campaign_ws, "state.time_marker", args)["ok"] is True
    marker_path = campaign_dir / "save" / "time-markers.json"
    ledger_path = campaign_dir / "save" / "toolbox-ledger.json"
    events_path = campaign_dir / "logs" / "events.jsonl"
    marker_doc = json.loads(marker_path.read_text(encoding="utf-8"))
    receipt = marker_doc["operation_receipts"]["state.time_marker"][
        args["decision_id"]
    ]
    assert receipt["schema_version"] == 3
    assert receipt["integrity_digest"].startswith("sha256:")
    receipt["data"]["marker"]["due_at"]["display"] = "CORRUPTED-DUE"
    _write_json(marker_path, marker_doc)
    ledger_before = ledger_path.read_bytes()
    events_before = events_path.read_bytes()

    replay = _run(campaign_ws, "state.time_marker", args)

    assert replay["ok"] is False
    assert replay["error"]["code"] == "state_corrupt"
    assert ledger_path.read_bytes() == ledger_before
    assert events_path.read_bytes() == events_before

def test_flag_receipt_integrity_rejects_forged_unlock_before_world_mutation(
    campaign_ws,
):
    campaign_dir = campaign_ws["campaign_dir"]
    args = {
        "flag_id": "integrity-body-flag",
        "value": True,
        "reason": "receipt body integrity",
        "decision_id": "integrity-body-flag-decision",
    }
    assert _run(campaign_ws, "state.set_flag", args)["ok"] is True
    flags_path = campaign_dir / "save" / "flags.json"
    world_path = campaign_dir / "save" / "world-state.json"
    ledger_path = campaign_dir / "save" / "toolbox-ledger.json"
    events_path = campaign_dir / "logs" / "events.jsonl"
    flags_doc = json.loads(flags_path.read_text(encoding="utf-8"))
    receipt = flags_doc["operation_receipts"]["state.set_flag"][
        args["decision_id"]
    ]
    receipt["data"]["newly_unlocked_scenes"] = ["forged-final-scene"]
    _write_json(flags_path, flags_doc)
    world_before = world_path.read_bytes()
    ledger_before = ledger_path.read_bytes()
    events_before = events_path.read_bytes()

    replay = _run(campaign_ws, "state.set_flag", args)

    assert replay["ok"] is False
    assert replay["error"]["code"] == "state_corrupt"
    assert world_path.read_bytes() == world_before
    assert ledger_path.read_bytes() == ledger_before
    assert events_path.read_bytes() == events_before
    assert "forged-final-scene" not in json.loads(
        world_path.read_text(encoding="utf-8")
    ).get("unlocked_scene_ids", [])

@pytest.mark.parametrize(
    ("tool_name", "source_name", "args"),
    [
        (
            "state.time_marker",
            "time-markers.json",
            {
                "action": "set",
                "marker_id": "corrupt-source-marker",
                "minutes_from_now": 4,
                "decision_id": "corrupt-source-marker-decision",
            },
        ),
        (
            "state.set_flag",
            "flags.json",
            {
                "flag_id": "corrupt-source-flag",
                "value": True,
                "decision_id": "corrupt-source-flag-decision",
            },
        ),
    ],
)
def test_receipt_source_corruption_never_downgrades_to_legacy_or_overwrites(
    campaign_ws,
    tool_name,
    source_name,
    args,
):
    campaign_dir = campaign_ws["campaign_dir"]
    assert _run(campaign_ws, tool_name, args)["ok"] is True
    source_path = campaign_dir / "save" / source_name
    source_path.write_text("{malformed-json", encoding="utf-8")
    corrupt_bytes = source_path.read_bytes()

    replay = _run(campaign_ws, tool_name, args)
    new_decision = _run(
        campaign_ws,
        tool_name,
        {**args, "decision_id": f"{args['decision_id']}-new"},
    )

    assert replay["ok"] is False
    assert replay["error"]["code"] == "state_corrupt"
    assert new_decision["ok"] is False
    assert new_decision["error"]["code"] == "state_corrupt"
    assert source_path.read_bytes() == corrupt_bytes

@pytest.mark.parametrize(
    ("tool_name", "source_name", "args"),
    [
        (
            "state.time_marker",
            "time-markers.json",
            {
                "action": "set",
                "marker_id": "missing-source-marker",
                "minutes_from_now": 4,
                "decision_id": "missing-source-marker-decision",
            },
        ),
        (
            "state.set_flag",
            "flags.json",
            {
                "flag_id": "missing-source-flag",
                "value": True,
                "decision_id": "missing-source-flag-decision",
            },
        ),
    ],
)
def test_receipt_era_ledger_manifest_rejects_missing_canonical_source(
    campaign_ws,
    tool_name,
    source_name,
    args,
):
    campaign_dir = campaign_ws["campaign_dir"]
    assert _run(campaign_ws, tool_name, args)["ok"] is True
    source_path = campaign_dir / "save" / source_name
    source_path.unlink()

    replay = _run(campaign_ws, tool_name, args)

    assert replay["ok"] is False
    assert replay["error"]["code"] == "state_corrupt"
    assert not source_path.exists()

def test_pre_receipt_orphan_ledger_is_non_comparable_and_never_reapplied(campaign_ws):
    campaign_dir = campaign_ws["campaign_dir"]
    marker_path = campaign_dir / "save" / "time-markers.json"
    assert not marker_path.exists()
    args = {
        "action": "set",
        "marker_id": "legacy-marker",
        "minutes_from_now": 5,
        "decision_id": "pre-receipt-legacy-decision",
    }
    legacy_data = {"legacy": "settled-before-source-receipts"}
    coc_toolbox.Ctx(
        campaign_ws["workspace"], campaign_ws["campaign_id"]
    ).ledger_record(args["decision_id"], "state.time_marker", legacy_data)

    replay = _run(campaign_ws, "state.time_marker", args)

    assert replay["ok"] is False
    assert replay["error"]["code"] == "state_corrupt"
    assert not marker_path.exists()

@pytest.mark.parametrize("entity_kind", ["flag", "marker"])
def test_latest_receipt_reconstructs_missing_live_entity_from_bound_head(
    campaign_ws, entity_kind,
):
    campaign_dir = campaign_ws["campaign_dir"]
    if entity_kind == "flag":
        tool_name = "state.set_flag"
        args = {
            "flag_id": "receipt-live-head-flag",
            "value": True,
            "reason": "head repair",
            "decision_id": "receipt-live-head-flag-decision",
        }
        source_path = campaign_dir / "save" / "flags.json"
        settled = _run(campaign_ws, tool_name, args)
        source = json.loads(source_path.read_text(encoding="utf-8"))
        source["flags"].pop(args["flag_id"])
        source["flag_provenance"].pop(args["flag_id"])
    else:
        tool_name = "state.time_marker"
        args = {
            "action": "set",
            "marker_id": "receipt-live-head-marker",
            "minutes_from_now": 8,
            "reason": "head repair",
            "decision_id": "receipt-live-head-marker-decision",
        }
        source_path = campaign_dir / "save" / "time-markers.json"
        settled = _run(campaign_ws, tool_name, args)
        source = json.loads(source_path.read_text(encoding="utf-8"))
        source["markers"].pop(args["marker_id"])
    assert settled["ok"] is True
    _write_json(source_path, source)

    replay = _run(campaign_ws, tool_name, args)

    assert replay["ok"] is True
    repaired = json.loads(source_path.read_text(encoding="utf-8"))
    if entity_kind == "flag":
        assert repaired["flags"][args["flag_id"]] is True
        assert repaired["flag_heads"][args["flag_id"]]["decision_id"] == args[
            "decision_id"
        ]
    else:
        assert repaired["markers"][args["marker_id"]]["decision_id"] == args[
            "decision_id"
        ]
        assert repaired["marker_heads"][args["marker_id"]]["decision_id"] == args[
            "decision_id"
        ]

def test_older_flag_receipt_repairs_later_head_without_restoring_old_value(
    campaign_ws,
):
    campaign_dir = campaign_ws["campaign_dir"]
    original_args = {
        "flag_id": "causal-head-flag",
        "value": True,
        "decision_id": "causal-head-original",
    }
    assert _run(campaign_ws, "state.set_flag", original_args)["ok"] is True
    assert _run(
        campaign_ws,
        "state.set_flag",
        {
            "flag_id": "causal-head-flag",
            "value": False,
            "decision_id": "causal-head-later",
        },
    )["ok"] is True
    flags_path = campaign_dir / "save" / "flags.json"
    flags = json.loads(flags_path.read_text(encoding="utf-8"))
    flags["flags"].pop("causal-head-flag")
    flags["flag_provenance"].pop("causal-head-flag")
    _write_json(flags_path, flags)

    replay = _run(campaign_ws, "state.set_flag", original_args)

    assert replay["ok"] is True
    repaired = json.loads(flags_path.read_text(encoding="utf-8"))
    assert repaired["flags"]["causal-head-flag"] is False
    assert repaired["flag_heads"]["causal-head-flag"]["decision_id"] == (
        "causal-head-later"
    )

def test_older_marker_receipt_never_overwrites_later_reset_head(campaign_ws):
    campaign_dir = campaign_ws["campaign_dir"]
    original_args = {
        "action": "set",
        "marker_id": "causal-head-marker",
        "minutes_from_now": 10,
        "decision_id": "causal-marker-original",
    }
    assert _run(campaign_ws, "state.time_marker", original_args)["ok"] is True
    later = _run(
        campaign_ws,
        "state.time_marker",
        {
            "action": "reset",
            "marker_id": "causal-head-marker",
            "minutes_from_now": 25,
            "decision_id": "causal-marker-later",
        },
    )
    assert later["ok"] is True
    marker_path = campaign_dir / "save" / "time-markers.json"
    doc = json.loads(marker_path.read_text(encoding="utf-8"))
    doc["markers"].pop("causal-head-marker")
    _write_json(marker_path, doc)

    replay = _run(campaign_ws, "state.time_marker", original_args)

    assert replay["ok"] is True
    repaired = json.loads(marker_path.read_text(encoding="utf-8"))
    assert repaired["markers"]["causal-head-marker"]["decision_id"] == (
        "causal-marker-later"
    )
    assert repaired["markers"]["causal-head-marker"]["due_at"] == later[
        "data"
    ]["marker"]["due_at"]

@pytest.mark.parametrize("entity_kind", ["flag", "marker"])
def test_receipt_replay_rejects_conflicting_present_live_record(
    campaign_ws, entity_kind,
):
    campaign_dir = campaign_ws["campaign_dir"]
    if entity_kind == "flag":
        tool_name = "state.set_flag"
        args = {
            "flag_id": "conflicting-live-flag",
            "value": True,
            "decision_id": "conflicting-live-flag-decision",
        }
        source_path = campaign_dir / "save" / "flags.json"
        assert _run(campaign_ws, tool_name, args)["ok"] is True
        doc = json.loads(source_path.read_text(encoding="utf-8"))
        doc["flags"][args["flag_id"]] = False
    else:
        tool_name = "state.time_marker"
        args = {
            "action": "set",
            "marker_id": "conflicting-live-marker",
            "minutes_from_now": 6,
            "decision_id": "conflicting-live-marker-decision",
        }
        source_path = campaign_dir / "save" / "time-markers.json"
        assert _run(campaign_ws, tool_name, args)["ok"] is True
        doc = json.loads(source_path.read_text(encoding="utf-8"))
        doc["markers"][args["marker_id"]]["due_at"]["elapsed_minutes"] += 1
    _write_json(source_path, doc)
    before = source_path.read_bytes()

    replay = _run(campaign_ws, tool_name, args)

    assert replay["ok"] is False
    assert replay["error"]["code"] == "state_corrupt"
    assert source_path.read_bytes() == before

def test_clear_absent_marker_has_explicit_replayable_noop_head(campaign_ws):
    campaign_dir = campaign_ws["campaign_dir"]
    args = {
        "action": "clear",
        "marker_id": "already-absent-marker",
        "reason": "explicit no-op",
        "decision_id": "clear-absent-marker-decision",
    }
    settled = _run(campaign_ws, "state.time_marker", args)
    assert settled["ok"] is True
    assert settled["data"]["marker"] is None
    marker_path = campaign_dir / "save" / "time-markers.json"
    doc = json.loads(marker_path.read_text(encoding="utf-8"))
    head = doc["marker_heads"][args["marker_id"]]
    assert head["live_record"] == {
        "schema_version": 1,
        "marker_id": args["marker_id"],
        "present": False,
        "marker": None,
    }
    assert _run(campaign_ws, "state.time_marker", args)["ok"] is True
    assert args["marker_id"] not in json.loads(
        marker_path.read_text(encoding="utf-8")
    )["markers"]

def test_receipt_era_ledger_schema_survives_manifest_damage(campaign_ws):
    campaign_dir = campaign_ws["campaign_dir"]
    args = {
        "action": "set",
        "marker_id": "receipt-era-discriminator",
        "minutes_from_now": 5,
        "decision_id": "receipt-era-discriminator-decision",
    }
    assert _run(campaign_ws, "state.time_marker", args)["ok"] is True
    (campaign_dir / "save" / "time-markers.json").unlink()
    ledger_path = campaign_dir / "save" / "toolbox-ledger.json"
    ledger = json.loads(ledger_path.read_text(encoding="utf-8"))
    key = coc_toolbox.Ctx._ledger_key("state.time_marker", args["decision_id"])
    entry = ledger["entries"][key]
    assert entry["entry_schema_version"] == 3
    entry.pop("source_receipt_manifest")
    _write_json(ledger_path, ledger)

    replay = _run(campaign_ws, "state.time_marker", args)

    assert replay["ok"] is False
    assert replay["error"]["code"] == "state_corrupt"

@pytest.mark.parametrize("event_damage", ["duplicate", "extra_field"])
def test_stable_operation_event_requires_exactly_one_full_canonical_match(
    campaign_ws,
    event_damage,
):
    campaign_dir = campaign_ws["campaign_dir"]
    args = {
        "action": "set",
        "marker_id": f"event-integrity-{event_damage}",
        "minutes_from_now": 3,
        "decision_id": f"event-integrity-{event_damage}-decision",
    }
    assert _run(campaign_ws, "state.time_marker", args)["ok"] is True
    marker_doc = json.loads(
        (campaign_dir / "save" / "time-markers.json").read_text(
            encoding="utf-8"
        )
    )
    receipt = marker_doc["operation_receipts"]["state.time_marker"][
        args["decision_id"]
    ]
    events_path = campaign_dir / "logs" / "events.jsonl"
    ledger_path = campaign_dir / "save" / "toolbox-ledger.json"
    events = _read_jsonl(events_path)
    target_index = next(
        index
        for index, row in enumerate(events)
        if row.get("event_id") == receipt["event_id"]
    )
    if event_damage == "duplicate":
        events.append(dict(events[target_index]))
    else:
        events[target_index]["unexpected_extra"] = True
    events_path.write_text(
        "\n".join(json.dumps(row, ensure_ascii=False) for row in events) + "\n",
        encoding="utf-8",
    )
    ledger_before = ledger_path.read_bytes()
    damaged_events = events_path.read_bytes()

    replay = _run(campaign_ws, "state.time_marker", args)

    assert replay["ok"] is False
    assert replay["error"]["code"] == "state_corrupt"
    assert ledger_path.read_bytes() == ledger_before
    assert events_path.read_bytes() == damaged_events

def test_state_write_appends_toolbox_calls_log(campaign_ws):
    log_path = campaign_ws["campaign_dir"] / "logs" / "toolbox-calls.jsonl"
    before = len(_read_jsonl(log_path))
    envelope = _run(
        campaign_ws,
        "state.set_flag",
        {
            "flag_id": "toolbox_seen",
            "value": True,
            "reason": "unit-test",
            "decision_id": "toolbox-seen-once",
        },
    )
    assert envelope["ok"] is True

    flags = json.loads(
        (campaign_ws["campaign_dir"] / "save" / "flags.json").read_text(encoding="utf-8")
    )
    assert flags.get("flags", {}).get("toolbox_seen") is True

    records = _read_jsonl(log_path)
    assert len(records) == before + 1
    last = records[-1]
    assert last["tool"] == "state.set_flag"
    assert last["ok"] is True
    assert last["args"]["flag_id"] == "toolbox_seen"
    assert "ts" in last

def test_clear_transient_condition_preserves_injury_state_and_replays(campaign_ws):
    investigator_id = campaign_ws["investigator_id"]
    state_path = (
        campaign_ws["campaign_dir"]
        / "save"
        / "investigator-state"
        / f"{investigator_id}.json"
    )
    state = json.loads(state_path.read_text(encoding="utf-8"))
    state["conditions"] = ["major_wound", "prone"]
    _write_json(state_path, state)
    args = {
        "investigator": investigator_id,
        "condition": "prone",
        "reason": "the investigator carefully stood after bed rest",
        "decision_id": "stand-after-recovery",
    }

    cleared = _run(campaign_ws, "state.clear_transient_condition", args)
    replay = _run(campaign_ws, "state.clear_transient_condition", args)

    assert cleared["ok"] is True
    assert replay["data"] == cleared["data"]
    assert cleared["data"]["changed"] is True
    assert cleared["data"]["conditions"] == ["major_wound"]
    persisted = json.loads(state_path.read_text(encoding="utf-8"))
    assert persisted["conditions"] == ["major_wound"]

def test_clear_transient_condition_rejects_injury_conditions(campaign_ws):
    rejected = _run(
        campaign_ws,
        "state.clear_transient_condition",
        {
            "investigator": campaign_ws["investigator_id"],
            "condition": "major_wound",
            "reason": "generic narration must not erase a wound",
            "decision_id": "forged-major-wound-clear",
        },
    )
    assert rejected["ok"] is False
    assert rejected["error"]["code"] == "invalid_param"

@pytest.mark.parametrize("entity_kind", ["flag", "marker"])
def test_schema_v2_receipt_with_missing_live_entity_is_never_success(
    campaign_ws, entity_kind,
):
    campaign_dir = campaign_ws["campaign_dir"]
    if entity_kind == "flag":
        tool_name = "state.set_flag"
        args = {
            "flag_id": "v2-missing-flag",
            "value": True,
            "decision_id": "v2-missing-flag-decision",
        }
        source_path = campaign_dir / "save" / "flags.json"
    else:
        tool_name = "state.time_marker"
        args = {
            "action": "set",
            "marker_id": "v2-missing-marker",
            "minutes_from_now": 7,
            "decision_id": "v2-missing-marker-decision",
        }
        source_path = campaign_dir / "save" / "time-markers.json"
    assert _run(campaign_ws, tool_name, args)["ok"] is True
    source = json.loads(source_path.read_text(encoding="utf-8"))
    receipt = source["operation_receipts"][tool_name][args["decision_id"]]
    receipt.pop("entity_head")
    receipt["schema_version"] = 2
    receipt["integrity_digest"] = coc_toolbox._source_receipt_integrity(receipt)
    if entity_kind == "flag":
        source["flags"].pop(args["flag_id"])
        source["flag_provenance"].pop(args["flag_id"])
        source["flag_heads"].pop(args["flag_id"])
    else:
        source["markers"].pop(args["marker_id"])
        source["marker_heads"].pop(args["marker_id"])
    _write_json(source_path, source)
    before = source_path.read_bytes()

    replay = _run(campaign_ws, tool_name, args)

    assert replay["ok"] is False
    assert replay["error"]["code"] == "state_corrupt"
    assert source_path.read_bytes() == before

@pytest.mark.parametrize("entity_kind", ["flag", "marker"])
def test_schema_v2_source_receipt_is_rejected_even_with_complete_live_evidence(
    campaign_ws, entity_kind,
):
    campaign_dir = campaign_ws["campaign_dir"]
    if entity_kind == "flag":
        tool_name = "state.set_flag"
        args = {
            "flag_id": "old-receipt-live-flag",
            "value": True,
            "decision_id": "old-receipt-live-flag-decision",
        }
        path = campaign_dir / "save" / "flags.json"
    else:
        tool_name = "state.time_marker"
        args = {
            "action": "set",
            "marker_id": "old-receipt-live-marker",
            "minutes_from_now": 9,
            "decision_id": "old-receipt-live-marker-decision",
        }
        path = campaign_dir / "save" / "time-markers.json"
    assert _run(campaign_ws, tool_name, args)["ok"] is True
    document = json.loads(path.read_text(encoding="utf-8"))
    receipt = document["operation_receipts"][tool_name][args["decision_id"]]
    receipt.pop("entity_head")
    receipt["schema_version"] = 2
    receipt["integrity_digest"] = coc_toolbox._source_receipt_integrity(receipt)
    _write_json(path, document)
    before = path.read_bytes()

    rejected = _run(campaign_ws, tool_name, args)

    assert rejected["ok"] is False
    assert rejected["error"]["code"] == "state_corrupt"
    assert path.read_bytes() == before

@pytest.mark.parametrize(
    ("field", "bad_value"),
    [
        ("revision", True),
        ("created_at", "not-an-iso-timestamp"),
        ("updated_at", None),
        ("due_at", {"elapsed_minutes": "soon"}),
        ("status", "mystery"),
    ],
)
def test_time_marker_payload_schema_binds_complete_typed_state(
    campaign_ws, field, bad_value
):
    args = {
        "action": "set",
        "marker_id": f"typed-marker-{field}",
        "minutes_from_now": 7,
        "decision_id": f"typed-marker-decision-{field}",
    }
    assert _run(campaign_ws, "state.time_marker", args)["ok"] is True
    payload = json.loads((
        campaign_ws["campaign_dir"] / "save" / "time-markers.json"
    ).read_text(encoding="utf-8"))
    head = payload["marker_heads"][args["marker_id"]]
    marker = dict(head["live_record"]["marker"])
    assert coc_toolbox.coc_flag_state.valid_time_marker_payload(
        marker,
        marker_id=args["marker_id"],
        decision_id=args["decision_id"],
        producer="state.time_marker",
        source_sequence=head["source_sequence"],
    )
    marker[field] = bad_value
    assert not coc_toolbox.coc_flag_state.valid_time_marker_payload(
        marker,
        marker_id=args["marker_id"],
        decision_id=args["decision_id"],
        producer="state.time_marker",
        source_sequence=head["source_sequence"],
    )
