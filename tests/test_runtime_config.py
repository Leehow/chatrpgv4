# tests/test_runtime_config.py
import json
from pathlib import Path
import importlib.util
import pytest


def _load():
    path = Path("runtime/engine/config.py")
    spec = importlib.util.spec_from_file_location("runtime_config", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_missing_runtime_json_defaults_to_deterministic_template_pipeline(tmp_path):
    cfg = _load().load_runtime_config(tmp_path)
    assert cfg == {
        "schema_version": 2,
        "planner": {"kind": "deterministic"},
        "rules": {"kind": "deterministic"},
        "narrator": {"kind": "template"},
        "player": {"kind": "human"},
    }


def test_runtime_json_v2_requires_exact_pipeline_shape(tmp_path):
    coc = tmp_path / ".coc"
    coc.mkdir()
    (coc / "runtime.json").write_text(json.dumps({
        "schema_version": 2,
        "planner": {"kind": "deterministic"},
        "rules": {"kind": "deterministic"},
        "narrator": {"kind": "template"},
        "player": {"kind": "human"},
        "surprise": True,
    }))
    with pytest.raises(ValueError, match="exactly"):
        _load().load_runtime_config(tmp_path)


@pytest.mark.parametrize(
    ("legacy_brain", "narrator_kind"),
    [("debug", "template"), ("pi", "pi")],
)
def test_legacy_brain_migrates_in_memory_with_deprecation_warning(
    tmp_path, legacy_brain, narrator_kind,
):
    coc = tmp_path / ".coc"
    coc.mkdir()
    (coc / "runtime.json").write_text(json.dumps({
        "schema_version": 1,
        "brain": legacy_brain,
    }))
    with pytest.warns(DeprecationWarning, match="brain"):
        cfg = _load().load_runtime_config(tmp_path)
    assert cfg["schema_version"] == 2
    assert cfg["planner"] == {"kind": "deterministic"}
    assert cfg["rules"] == {"kind": "deterministic"}
    assert cfg["narrator"] == {"kind": narrator_kind}
    assert cfg["player"] == {"kind": "human"}


def test_invalid_brain_raises(tmp_path):
    coc = tmp_path / ".coc"
    coc.mkdir()
    (coc / "runtime.json").write_text(json.dumps({"brain": "codex"}))
    try:
        _load().load_runtime_config(tmp_path)
        assert False, "expected ValueError"
    except ValueError as exc:
        assert "brain" in str(exc).lower()


@pytest.mark.parametrize("value", [True, "1", None, 1.0])
def test_runtime_schema_version_requires_exact_integer(value, tmp_path):
    coc = tmp_path / ".coc"
    coc.mkdir()
    (coc / "runtime.json").write_text(json.dumps({"schema_version": value}))
    with pytest.raises(ValueError, match="schema_version"):
        _load().load_runtime_config(tmp_path)


def test_v2_rejects_invalid_component_kind(tmp_path):
    coc = tmp_path / ".coc"
    coc.mkdir()
    (coc / "runtime.json").write_text(json.dumps({
        "schema_version": 2,
        "planner": {"kind": "pi"},
        "rules": {"kind": "deterministic"},
        "narrator": {"kind": "template"},
        "player": {"kind": "human"},
    }))
    with pytest.raises(ValueError, match="planner"):
        _load().load_runtime_config(tmp_path)
