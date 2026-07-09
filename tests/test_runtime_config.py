# tests/test_runtime_config.py
import json
from pathlib import Path
import importlib.util


def _load():
    path = Path("runtime/engine/config.py")
    spec = importlib.util.spec_from_file_location("runtime_config", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_missing_runtime_json_defaults_to_debug(tmp_path):
    cfg = _load().load_runtime_config(tmp_path)
    assert cfg["brain"] == "debug"
    assert cfg["schema_version"] == 1


def test_reads_pi_brain_from_coc_runtime_json(tmp_path):
    coc = tmp_path / ".coc"
    coc.mkdir()
    (coc / "runtime.json").write_text(json.dumps({
        "schema_version": 1,
        "brain": "pi",
    }))
    cfg = _load().load_runtime_config(tmp_path)
    assert cfg["brain"] == "pi"


def test_invalid_brain_raises(tmp_path):
    coc = tmp_path / ".coc"
    coc.mkdir()
    (coc / "runtime.json").write_text(json.dumps({"brain": "codex"}))
    try:
        _load().load_runtime_config(tmp_path)
        assert False, "expected ValueError"
    except ValueError as exc:
        assert "brain" in str(exc).lower()
