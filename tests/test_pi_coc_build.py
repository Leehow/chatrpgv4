"""The pi-coc-build entry: a role on the one launcher, not a second launcher.

`pi-coc-setup` is a role wrapper; `pi-coc-build` must be the same shape or the
environment guarantees (uv pin, resolved Pi CLI, isolated agent home) fork
into two copies. These tests pin that shape: the wrapper only names the role,
`pi-coc` execs the driver before any session/campaign assembly, and the host
adapter spawns the resolved CLI in its executable form.
"""
from __future__ import annotations

import importlib.util
import os
import stat
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PI_BIN = ROOT / "plugins" / "coc-keeper" / "pi" / "bin"
ADAPTER = ROOT / "plugins" / "coc-keeper" / "pi" / "lib" / "build_ask_adapter.py"


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def test_the_wrapper_only_names_the_role():
    text = (PI_BIN / "pi-coc-build").read_text("utf-8")
    assert 'COC_PI_LAUNCH_ROLE=build' in text
    assert 'exec "$SCRIPT_DIR/pi-coc" "$@"' in text
    # The one thing a wrapper must never do: its own environment work.
    assert "uv run" not in text
    assert "python" not in text
    mode = (PI_BIN / "pi-coc-build").stat().st_mode
    assert mode & stat.S_IXUSR, "pi-coc-build must be executable"


def test_pi_coc_execs_the_driver_before_session_assembly():
    text = (PI_BIN / "pi-coc").read_text("utf-8")
    branch = text.index('if [[ "$BUILD_ROLE" -eq 1 ]]')
    arg_loop = text.index("WANT_NEW=0")
    assert branch < arg_loop, (
        "the build branch must exec before campaign/session parsing; a build "
        "has no campaign and the play launcher would refuse it"
    )
    # The injected channel uses the resolved CLI, never a PATH pi.
    assert "export COC_PI_CLI=$PI_CLI" in text
    assert "--adapter build_ask_adapter" in text


def test_the_adapter_spawns_the_resolved_cli_in_executable_form(monkeypatch, tmp_path):
    adapter = _load("build_ask_adapter_test", ADAPTER)
    js = tmp_path / "cli.js"
    js.write_text("// cli", encoding="utf-8")
    monkeypatch.setenv("COC_PI_CLI", str(js))
    assert adapter._pi_command() == ["node", str(js)]
    exe = tmp_path / "pi"
    exe.write_text("#!/bin/sh\n", encoding="utf-8")
    exe.chmod(0o755)
    monkeypatch.setenv("COC_PI_CLI", str(exe))
    assert adapter._pi_command() == [str(exe)]
    monkeypatch.delenv("COC_PI_CLI")
    assert adapter._pi_command() == ["pi"]


def test_a_hanged_channel_is_retried_on_a_fresh_session(monkeypatch):
    """One pilot build died mid-run on a silent channel. The ask carries
    everything it needs, so the adapter retries the transport -- on a NEW
    session, because a hanged one is poison."""
    adapter = _load("build_ask_adapter_retry_test", ADAPTER)
    adapter._SESSION = None
    sessions: list[object] = []

    class FakeSession:
        def __init__(self) -> None:
            self.proc = type("P", (), {"poll": lambda self: None,
                                       "kill": lambda self: None})()
            self.calls = 0
            sessions.append(self)

        def ask(self, message: str) -> str:
            self.calls += 1
            if len(sessions) < 2:
                raise adapter.TransportHang("silent")
            return "ok"

    monkeypatch.setattr(adapter, "_Session", FakeSession)
    assert adapter.ask("i", "p") == "ok"
    assert len(sessions) == 2, "the retry must not reuse the hanged session"
    adapter._SESSION = None


def test_the_driver_defaults_its_work_dir_under_module_builds(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
):
    """`pi-coc-build --source-bundle X --module-id Y` needs no third flag."""
    import json

    sys.path.insert(0, str(ROOT / "plugins" / "coc-keeper" / "scripts"))
    try:
        build = _load(
            "coc_module_build_defaultdir_test",
            ROOT / "plugins" / "coc-keeper" / "scripts" / "coc_module_build.py",
        )
    finally:
        sys.path.pop(0)

    (tmp_path / "fake_adapter.py").write_text(
        "def ask(instruction, payload):\n    return '{}'\n", encoding="utf-8",
    )
    monkeypatch.syspath_prepend(str(tmp_path))
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(
        build.extract, "prepare", lambda *a, **k: {"span_count": 1},
    )
    monkeypatch.setattr(
        build, "extract_section", lambda *a, **k: {
            "status": "accepted", "attempts": 1, "rounds": [], "nodes": 1},
    )
    plan_path = tmp_path / "plan.json"
    plan_path.write_text(json.dumps({
        "status": "accepted", "attempts": 1,
        "sections": [{"section_id": "s1", "pdf_index_start": 0,
                      "pdf_index_end": 0}],
    }))
    rc = build.main([
        "--adapter", "fake_adapter",
        "--source-bundle", str(tmp_path),
        "--module-id", "mod",
        "--plan", str(plan_path),
        "--no-skeleton",
    ])
    assert rc == 0
    assert (tmp_path / ".coc" / "module-builds" / "mod" / "build.json").exists()
