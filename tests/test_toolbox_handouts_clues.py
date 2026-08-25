"""Behavior tests owned by the handouts-clues operation cell."""
from toolbox_test_support import *


def test_handouts_clues_cell_registry_surface_is_local():
    module_name = coc_toolbox.OPERATION_MODULES["handouts-clues"].__name__
    registered = {
        name
        for name, spec in coc_toolbox.TOOLS.items()
        if spec["handler"].__module__ == module_name
    }
    assert registered == {
        "clues.query",
        "state.deliver_handout",
        "state.record_clue",
        "state.replay_handout",
    }


def test_state_record_clue_idempotent_on_decision_id(campaign_ws):
    clue_id = _first_clue_id(campaign_ws["campaign_dir"])
    decision_id = "toolbox-clue-once"
    args = {"clue_id": clue_id, "method": "test", "decision_id": decision_id}

    first = _run(campaign_ws, "state.record_clue", args)
    second = _run(campaign_ws, "state.record_clue", args)

    assert first["ok"] is True
    assert second["ok"] is True
    assert first["data"]["clue_id"] == clue_id
    assert first["data"]["already_discovered"] is False
    assert second["data"] == first["data"]
    assert any("duplicate decision_id" in w for w in second["warnings"])

    world = json.loads(
        (campaign_ws["campaign_dir"] / "save" / "world-state.json").read_text(
            encoding="utf-8"
        )
    )
    assert clue_id in world.get("discovered_clue_ids", [])
    # Exactly one discovery event despite two calls.
    events = _read_jsonl(campaign_ws["campaign_dir"] / "logs" / "events.jsonl")
    discoveries = [
        e for e in events
        if e.get("event_type") == "clue_discovered" and e.get("clue_id") == clue_id
    ]
    assert len(discoveries) == 1

def test_clues_query_returns_discovery_state_without_blocking(campaign_ws):
    envelope = _run(campaign_ws, "clues.query", {"undiscovered_only": True})
    assert envelope["ok"] is True
    assert isinstance(envelope["warnings"], list)
    assert isinstance(envelope["data"]["clues"], list)
    assert envelope["data"]["clues"]
    # Undiscovered clues remain marked secret for the keeper.
    assert all(c.get("secret") is True for c in envelope["data"]["clues"])
    assert all(c.get("discovered") is False for c in envelope["data"]["clues"])
    assert all(c.get("player_safe_summary") is None for c in envelope["data"]["clues"])
    assert all(c.get("localized_text") is None for c in envelope["data"]["clues"])
    assert all(
        "description" not in conclusion and "fallback_policy" not in conclusion
        for conclusion in envelope["data"]["conclusions"]
    )

def test_clues_query_cache_reuses_revision_and_invalidates_on_discovery(campaign_ws):
    first = _run(campaign_ws, "clues.query", {"undiscovered_only": True})
    revision = first["data"]["working_set"]["revision"]
    assert first["cache"]["status"] == "miss"

    cached = _run(campaign_ws, "clues.query", {"undiscovered_only": True})
    assert cached["cache"]["status"] == "hit"
    assert cached["data"] == first["data"]
    assert (campaign_ws["campaign_dir"] / cached["cache"]["ref"]).is_file()

    compact = _run(
        campaign_ws,
        "clues.query",
        {"undiscovered_only": True, "since_revision": revision},
    )
    assert compact["cache"]["status"] == "not_modified"
    assert compact["data"] == {
        "working_set": {
            "mode": "not_modified",
            "revision": revision,
            "read_domains": first["data"]["working_set"]["read_domains"],
        }
    }

    clue_id = _first_clue_id(campaign_ws["campaign_dir"])
    different_scope = _run(
        campaign_ws,
        "clues.query",
        {"clue_id": clue_id, "since_revision": revision},
    )
    assert different_scope["cache"]["status"] == "miss"
    assert different_scope["data"]["working_set"]["mode"] == "full"
    assert different_scope["data"]["working_set"]["revision"] != revision
    discovered = _run(
        campaign_ws,
        "state.record_clue",
        {
            "clue_id": clue_id,
            "method": "cache invalidation probe",
            "decision_id": "cache-discover-clue",
        },
    )
    assert discovered["ok"] is True
    refreshed = _run(
        campaign_ws,
        "clues.query",
        {"undiscovered_only": True, "since_revision": revision},
    )
    assert refreshed["cache"]["status"] == "miss"
    assert refreshed["data"]["working_set"]["mode"] == "full"
    assert refreshed["data"]["working_set"]["revision"] != revision
    assert clue_id not in {row["clue_id"] for row in refreshed["data"]["clues"]}
    query_receipts = [
        row
        for row in _read_jsonl(
            campaign_ws["campaign_dir"] / "logs" / "toolbox-calls.jsonl"
        )
        if row.get("tool") == "clues.query"
    ]
    assert query_receipts
    assert all("clues" not in (row.get("data") or {}) for row in query_receipts)
    assert any((row.get("data") or {}).get("projection_ref") for row in query_receipts)

def test_off_design_clue_records_with_warning_not_exception(campaign_ws):
    envelope = _run(
        campaign_ws,
        "state.record_clue",
        {
            "clue_id": "improvised-toolbox-clue",
            "method": "improvisation",
            "decision_id": "toolbox-improv-clue",
        },
    )
    assert envelope["ok"] is True
    assert envelope["data"]["clue_id"] == "improvised-toolbox-clue"
    assert any("not in the clue graph" in w for w in envelope["warnings"])

def test_cli_describe_known_tool():
    proc = subprocess.run(
        [PYTHON, str(TOOLBOX_SCRIPT), "describe", "state.record_clue"],
        cwd=REPO,
        capture_output=True,
        text=True,
        check=False,
    )
    assert proc.returncode == 0
    payload = json.loads(proc.stdout)
    assert payload["name"] == "state.record_clue"
    assert payload["params"]["clue_id"]["required"] is True
    assert payload["params"]["decision_id"]["required"] is True
