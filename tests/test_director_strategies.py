import importlib.util
from pathlib import Path


SCRIPT = Path("plugins/coc-keeper/scripts/coc_director_strategies.py")


def _load():
    spec = importlib.util.spec_from_file_location("coc_director_strategies_test", SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_time_loop_strategy_advances_loop_and_preserves_structured_memory_ids():
    mod = _load()
    result = mod.strategy_for("time_loop").compile(
        {"loop_number": 2, "player_retained_memory_ids": ["memory-a"]},
        {"loop_boundary": True, "player_retained_memory_ids": ["memory-b", "memory-a"]},
    )
    assert result["strategy_state"] == {
        "strategy_type": "time_loop", "loop_number": 3,
        "player_retained_memory_ids": ["memory-a", "memory-b"],
    }
    assert result["capability_findings"] == []


def test_multi_faction_strategy_ranks_structured_pressure_deterministically():
    mod = _load()
    result = mod.strategy_for("multi_faction").compile({}, {
        "factions": [
            {"faction_id": "cult", "pressure": 0.7, "momentum": 0.1},
            {"faction_id": "police", "pressure": 0.7, "momentum": 0.3},
        ]
    })
    assert [r["faction_id"] for r in result["faction_rankings"]] == ["police", "cult"]
    assert result["strategy_state"]["strategy_type"] == "multi_faction"


def test_unsupported_special_mechanics_are_explicit_capability_findings():
    mod = _load()
    result = mod.compile_strategy(
        {"structure_type": "linear_acts", "special_mechanics": ["dream-duel"]}, {}, {}
    )
    assert result["capability_findings"] == [{
        "code": "unsupported_special_mechanic", "mechanic_id": "dream-duel",
        "severity": "warning",
    }]


def test_duplicate_factions_fail_closed_with_capability_finding():
    mod = _load()
    result = mod.compile_strategy(
        {"structure_type": "multi_faction"}, {"schema_version": 1},
        {"factions": [
            {"faction_id": "cult", "pressure": 0.2, "momentum": 0.0},
            {"faction_id": "cult", "pressure": 0.9, "momentum": 1.0},
        ]},
    )
    assert result["faction_rankings"] == []
    assert result["strategy_state"] == {
        "schema_version": 1, "strategy_type": "multi_faction",
        "ranked_faction_ids": [],
    }
    assert any(f["code"] == "strategy_faction_ids_duplicate"
               for f in result["capability_findings"])


def test_malformed_prior_strategy_state_fails_closed():
    mod = _load()
    result = mod.compile_strategy(
        {"structure_type": "time_loop"},
        {"schema_version": 999, "strategy_type": "time_loop", "loop_number": 50},
        {"loop_boundary": False},
    )
    assert result["strategy_state"]["loop_number"] == 0
    assert any(f["code"] == "strategy_state_invalid"
               for f in result["capability_findings"])
