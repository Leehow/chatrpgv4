import importlib.util
from pathlib import Path

import pytest


def load_module(name: str, relative_path: str):
    path = Path(relative_path)
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


coc_api = load_module("coc_api", "plugins/coc-keeper/scripts/coc_api.py")


def _assert_entry_shape(entry):
    """Every api_index entry mirrors coc_roll.public_api_index's shape."""
    assert isinstance(entry, dict)
    assert "aliases" in entry
    assert "signature" in entry
    assert "returns" in entry
    assert isinstance(entry["aliases"], list)
    assert isinstance(entry["signature"], str)
    assert isinstance(entry["returns"], str)


def test_api_index_aggregates_roll_and_rules_helpers():
    api = coc_api.api_index()

    # Roll helpers (sourced from coc_roll.public_api_index).
    assert "percentile_check" in api
    assert "roll_percentile" in api["percentile_check"]["aliases"]
    assert "format_percentile_result" in api
    assert "roll_expression" in api

    # Rules helpers (curated coc_rules public fns).
    assert "half_value" in api
    assert "fifth_value" in api
    assert "difficulty_target" in api
    assert "damage_bonus_build" in api
    assert "movement_rate" in api
    assert "success_level" in api


def test_api_index_entries_have_aliases_signature_returns_shape():
    api = coc_api.api_index()

    assert api, "api_index() must not be empty"
    for name, entry in api.items():
        assert isinstance(name, str)
        _assert_entry_shape(entry)


def test_api_index_rules_signatures_are_accurate():
    api = coc_api.api_index()

    assert "difficulty_target" in api["difficulty_target"]["signature"]
    assert "success_level" in api["success_level"]["signature"]
    assert "movement_rate" in api["movement_rate"]["signature"]


def test_coc_rules_public_index_lists_six_rules_helpers():
    rules_index = coc_api.coc_rules_public_index()

    expected = {
        "half_value",
        "fifth_value",
        "difficulty_target",
        "damage_bonus_build",
        "movement_rate",
        "success_level",
    }
    assert set(rules_index.keys()) == expected
    for entry in rules_index.values():
        _assert_entry_shape(entry)


def test_api_index_is_robust_when_coc_roll_absent(monkeypatch, tmp_path):
    # Simulate coc_roll being unavailable: api_index() must still return the
    # rules section (whatever is loadable) rather than raising.
    monkeypatch.setattr(coc_api, "coc_roll", None)

    api = coc_api.api_index()

    # Rules helpers should still be present.
    assert "half_value" in api
    assert "success_level" in api
    # Roll helpers are absent because coc_roll could not be loaded.
    assert "percentile_check" not in api


def test_api_index_is_robust_when_coc_rules_absent(monkeypatch, tmp_path):
    # Simulate coc_rules being unavailable: api_index() must still return the
    # roll section (whatever is loadable) rather than raising.
    monkeypatch.setattr(coc_api, "coc_rules", None)

    api = coc_api.api_index()

    # Roll helpers should still be present.
    assert "percentile_check" in api
    assert "format_percentile_result" in api
    # Rules helpers are absent because coc_rules could not be loaded.
    assert "half_value" not in api


def test_api_index_is_robust_when_both_siblings_absent(monkeypatch):
    monkeypatch.setattr(coc_api, "coc_roll", None)
    monkeypatch.setattr(coc_api, "coc_rules", None)

    api = coc_api.api_index()

    assert api == {}
