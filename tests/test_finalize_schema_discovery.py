import importlib.util
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PLUGIN_ROOT = ROOT / "plugins" / "coc-keeper"


def _load_server():
    spec = importlib.util.spec_from_file_location(
        "test_finalize_schema_mcp_server", PLUGIN_ROOT / "mcp" / "server.py"
    )
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_finalize_cli_metadata_matches_finalizer_contract():
    server = _load_server()
    toolbox = server.toolbox
    finalizer = toolbox.coc_turn_finalization
    params = toolbox._describe("turn.finalize")["params"]

    coverage = params["coverage"]
    assert coverage["type"] == "array"
    assert "minItems" not in coverage
    coverage_item = coverage["items"]
    assert coverage_item["additionalProperties"] is False
    assert set(coverage_item["properties"]) == set(finalizer.COVERAGE_FIELDS)
    assert set(coverage_item["required"]) == set(finalizer.COVERAGE_FIELDS)
    assert set(coverage_item["properties"]["realization"]["enum"]) == set(
        finalizer.REALIZATION_VALUES
    )
    assert set(
        coverage_item["properties"]["player_input_handling"]["enum"]
    ) == set(finalizer.PLAYER_INPUT_HANDLING_VALUES)
    assert coverage_item["properties"]["obligation_id"]["minLength"] == 1
    nullable_fields = set(finalizer.COVERAGE_FIELDS) - {
        "obligation_id",
        "realization",
        "player_input_handling",
    }
    for field in nullable_fields:
        assert coverage_item["properties"][field]["type"] == ["string", "null"]

    placements = params["mechanics_placements"]
    assert placements["type"] == "array"
    assert "minItems" not in placements
    placement_item = placements["items"]
    assert placement_item["additionalProperties"] is False
    assert set(placement_item["properties"]) == set(
        finalizer.MECHANICS_PLACEMENT_FIELDS
    )
    assert set(placement_item["required"]) == set(
        finalizer.MECHANICS_PLACEMENT_FIELDS
    )
    assert set(placement_item["properties"]["segment_type"]["enum"]) == set(
        finalizer.MECHANIC_SEGMENT_TYPES
    )
    assert placement_item["properties"]["after_paragraph"] == {
        "type": "integer",
        "minimum": 0,
    }
    assert placement_item["properties"]["source_ids"] == {
        "type": "array",
        "items": {"type": "string", "minLength": 1},
        "minItems": 1,
        "uniqueItems": True,
    }


def test_exceptional_effect_schema_marks_verbatim_fields_as_play_language():
    server = _load_server()
    params = server.toolbox._describe("state.exceptional_effect")["params"]

    assert "active play_language" in params["player_visible_impact"]["desc"]
    assert "active play_language" in params["causal_link"]["desc"]
    assert "rendered verbatim" in params["player_visible_impact"]["desc"]
    assert "rendered verbatim" in params["causal_link"]["desc"]
    assert "active play_language" in params["boundary"]["desc"]
    assert "rendered verbatim" in params["boundary"]["desc"]


def test_finalize_mcp_schema_recursively_preserves_closed_nested_contract(monkeypatch):
    server = _load_server()
    monkeypatch.setenv("COC_HOST", "grok")
    schema = server._tool_schema(
        "turn.finalize", server.toolbox.TOOLS["turn.finalize"]
    )

    assert schema["name"] == "turn_finalize"
    input_schema = schema["inputSchema"]
    assert set(input_schema["required"]) == {
        "campaign",
        "draft",
        "coverage",
        "decision_id",
    }
    assert input_schema["additionalProperties"] is False
    assert "required" not in input_schema["properties"]["coverage"]

    coverage_item = input_schema["properties"]["coverage"]["items"]
    assert coverage_item["additionalProperties"] is False
    assert set(coverage_item["required"]) == set(
        server.toolbox.coc_turn_finalization.COVERAGE_FIELDS
    )
    assert coverage_item["properties"]["exact_excerpt"]["type"] == [
        "string",
        "null",
    ]

    placement_item = input_schema["properties"]["mechanics_placements"]["items"]
    assert placement_item["additionalProperties"] is False
    assert set(placement_item["required"]) == set(
        server.toolbox.coc_turn_finalization.MECHANICS_PLACEMENT_FIELDS
    )
    assert placement_item["properties"]["source_ids"]["items"] == {
        "type": "string",
        "minLength": 1,
    }

    uptake = input_schema["properties"]["advisory_uptake"]
    assert uptake["additionalProperties"] is False
    assert set(uptake["required"]) == {
        "advice_id",
        "disposition",
        "reason",
        "adopted_fields",
        "storylet_candidate",
        "exact_excerpt",
    }
    assert "advisory_uptake" not in input_schema["required"]

    converted = server._json_schema({
        "type": "object",
        "properties": {
            "rows": {
                "type": "array",
                "desc": "nested rows",
                "items": {"type": "string", "desc": "nested value"},
            }
        },
        "required": ["rows"],
        "additionalProperties": False,
    })
    assert converted["required"] == ["rows"]
    assert converted["properties"]["rows"]["description"] == "nested rows"
    assert converted["properties"]["rows"]["items"]["description"] == (
        "nested value"
    )
