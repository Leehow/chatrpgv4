"""N4: mtime-invalidated JSON cache for reference tables."""
from __future__ import annotations

import importlib.util
import json
import os
import sys
import time
from pathlib import Path

import pytest

SCRIPTS = str(Path("plugins/coc-keeper/scripts").resolve())
if SCRIPTS not in sys.path:
    sys.path.insert(0, SCRIPTS)


def _load(name: str, rel: str):
    path = Path(rel)
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


coc_cache = _load("coc_cache", "plugins/coc-keeper/scripts/coc_cache.py")
coc_rules = _load("coc_rules", "plugins/coc-keeper/scripts/coc_rules.py")
storylets = _load("coc_storylets", "plugins/coc-keeper/scripts/coc_storylets.py")


@pytest.fixture(autouse=True)
def _clear_cache():
    coc_cache.clear_json_cache()
    yield
    coc_cache.clear_json_cache()


def test_cache_hit_avoids_reparse(tmp_path, monkeypatch):
    path = tmp_path / "table.json"
    path.write_text('{"a": 1}', encoding="utf-8")

    calls = {"n": 0}
    real_loads = json.loads

    def counting_loads(s, *args, **kwargs):
        calls["n"] += 1
        return real_loads(s, *args, **kwargs)

    monkeypatch.setattr(coc_cache.json, "loads", counting_loads)

    first = coc_cache.load_json_cached(path)
    second = coc_cache.load_json_cached(path)

    assert calls["n"] == 1
    assert first == {"a": 1}
    assert second == {"a": 1}


def test_mtime_bump_invalidates_cache(tmp_path, monkeypatch):
    path = tmp_path / "table.json"
    path.write_text('{"a": 1}', encoding="utf-8")

    calls = {"n": 0}
    real_loads = json.loads

    def counting_loads(s, *args, **kwargs):
        calls["n"] += 1
        return real_loads(s, *args, **kwargs)

    monkeypatch.setattr(coc_cache.json, "loads", counting_loads)

    assert coc_cache.load_json_cached(path) == {"a": 1}
    assert calls["n"] == 1

    time.sleep(0.01)
    path.write_text('{"a": 2}', encoding="utf-8")
    st = path.stat()
    os.utime(path, ns=(st.st_atime_ns, st.st_mtime_ns + 1_000_000))

    assert coc_cache.load_json_cached(path) == {"a": 2}
    assert calls["n"] == 2


def test_mutation_of_returned_object_does_not_poison_cache(tmp_path):
    path = tmp_path / "table.json"
    path.write_text('{"a": 1, "nested": {"b": 2}}', encoding="utf-8")

    first = coc_cache.load_json_cached(path)
    first["a"] = 999
    first["nested"]["b"] = 888

    second = coc_cache.load_json_cached(path)
    assert second == {"a": 1, "nested": {"b": 2}}


def test_coc_campaign_paths_never_cached(tmp_path, monkeypatch):
    coc_dir = tmp_path / ".coc" / "campaigns" / "demo" / "save"
    coc_dir.mkdir(parents=True)
    path = coc_dir / "world-state.json"
    path.write_text('{"turn": 1}', encoding="utf-8")

    calls = {"n": 0}
    real_loads = json.loads

    def counting_loads(s, *args, **kwargs):
        calls["n"] += 1
        return real_loads(s, *args, **kwargs)

    monkeypatch.setattr(coc_cache.json, "loads", counting_loads)

    assert coc_cache.load_json_cached(path) == {"turn": 1}
    assert coc_cache.load_json_cached(path) == {"turn": 1}
    assert calls["n"] == 2

    path.write_text('{"turn": 2}', encoding="utf-8")
    assert coc_cache.load_json_cached(path) == {"turn": 2}
    assert calls["n"] == 3


def test_is_cacheable_path_rejects_dot_coc():
    assert coc_cache.is_cacheable_path(Path("/tmp/foo/bar.json")) is True
    assert coc_cache.is_cacheable_path(Path("/proj/.coc/save/world-state.json")) is False
    assert (
        coc_cache.is_cacheable_path(
            Path("/proj/plugins/coc-keeper/rulesets/coc7/rules-json/x.json")
        )
        is True
    )


def test_load_rule_table_uses_cache(monkeypatch):
    calls = {"n": 0}
    real_loads = json.loads

    def counting_loads(s, *args, **kwargs):
        calls["n"] += 1
        return real_loads(s, *args, **kwargs)

    monkeypatch.setattr(coc_rules.coc_cache.json, "loads", counting_loads)
    coc_cache.clear_json_cache()

    a = coc_rules.load_rule_table("percentile-check")
    b = coc_rules.load_rule_table("percentile-check")
    assert a["die"] == "1D100"
    assert b["die"] == "1D100"
    assert calls["n"] == 1


def test_load_storylet_library_uses_cache(monkeypatch):
    calls = {"n": 0}
    real_loads = json.loads

    def counting_loads(s, *args, **kwargs):
        calls["n"] += 1
        return real_loads(s, *args, **kwargs)

    monkeypatch.setattr(storylets.coc_cache.json, "loads", counting_loads)
    coc_cache.clear_json_cache()

    a = storylets.load_storylet_library()
    b = storylets.load_storylet_library()
    assert isinstance(a.get("storylets"), list)
    assert isinstance(b.get("storylets"), list)
    assert calls["n"] == 1
