from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import subprocess


ROOT = Path(__file__).resolve().parents[1]
LAUNCHER = ROOT / "plugins" / "coc-keeper" / "pi" / "bin" / "pi-coc"


def _write_executable(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    path.chmod(0o755)


def _launcher_fixture(
    tmp_path: Path,
) -> tuple[Path, dict[str, str], Path, Path]:
    repo = tmp_path / "repo"
    launcher = repo / "plugins" / "coc-keeper" / "pi" / "bin" / "pi-coc"
    launcher.parent.mkdir(parents=True)
    shutil.copy2(LAUNCHER, launcher)

    (repo / "package.json").write_text(
        json.dumps({"name": "@chatrpg/coc-keeper-pi"}) + "\n",
        encoding="utf-8",
    )
    prompt = repo / "plugins" / "coc-keeper" / "pi" / "prompts" / "host-system.md"
    prompt.parent.mkdir(parents=True)
    prompt.write_text("fixture\n", encoding="utf-8")
    (repo / "plugins" / "coc-keeper" / "pi" / "agents").mkdir(parents=True)
    preflight = launcher.parent / "pi-coc-thinking-preflight.mjs"
    preflight.write_text("process.exit(0);\n", encoding="utf-8")

    marker = tmp_path / "selected-cli.txt"
    fake_bin = tmp_path / "bin"
    _write_executable(
        fake_bin / "uv",
        "#!/bin/sh\n[ \"${1:-}\" = --version ] && { echo 'uv 0.11.16'; exit 0; }\nexit 64\n",
    )
    for name in ("fd", "rg"):
        _write_executable(fake_bin / name, "#!/bin/sh\nexit 0\n")
    _write_executable(
        fake_bin / "pi",
        "#!/bin/sh\n"
        "[ \"${1:-}\" = --version ] && { echo 'pi 0.84.0'; exit 0; }\n"
        "printf '%s\\n' 'global-0.84.0' > \"$PI_COC_TEST_MARKER\"\n",
    )

    bundled_root = (
        repo
        / "runtime"
        / "adapters"
        / "keeper"
        / "node_modules"
        / "@earendil-works"
        / "pi-coding-agent"
    )
    bundled_root.mkdir(parents=True)
    (repo / "runtime" / "adapters" / "keeper" / "package.json").write_text(
        json.dumps(
            {
                "dependencies": {
                    "@earendil-works/pi-coding-agent": "0.84.2",
                }
            }
        )
        + "\n",
        encoding="utf-8",
    )
    (repo / "runtime" / "adapters" / "keeper" / "package-lock.json").write_text(
        json.dumps(
            {
                "packages": {
                    "node_modules/@earendil-works/pi-agent-core": {
                        "version": "0.84.2",
                    },
                    "node_modules/@earendil-works/pi-coding-agent": {
                        "version": "0.84.2",
                    },
                }
            }
        )
        + "\n",
        encoding="utf-8",
    )
    (bundled_root / "package.json").write_text(
        json.dumps(
            {
                "name": "@earendil-works/pi-coding-agent",
                "version": "0.84.2",
                "type": "module",
            }
        )
        + "\n",
        encoding="utf-8",
    )
    _write_executable(
        bundled_root / "dist" / "cli.js",
        "#!/usr/bin/env node\n"
        "import fs from 'node:fs';\n"
        "fs.writeFileSync(process.env.PI_COC_TEST_MARKER, 'bundled-0.84.2\\n');\n",
    )

    agent_home = tmp_path / "agent-home"
    agent_home.mkdir()
    (agent_home / "settings.json").write_text(
        json.dumps({"packages": [str(repo)]}) + "\n",
        encoding="utf-8",
    )
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    home = tmp_path / "home"
    home.mkdir()

    env = dict(os.environ)
    env.update(
        {
            "PATH": f"{fake_bin}:{env['PATH']}",
            "HOME": str(home),
            "PI_COC_AGENT_DIR": str(agent_home),
            "COC_WORKSPACE": str(workspace),
            "COC_PROGRESSIVE_OCR_PYTHON": "/usr/bin/true",
            "PI_COC_TEST_MARKER": str(marker),
        }
    )
    env.pop("COC_PI_CLI", None)
    return launcher, env, marker, repo


def test_repo_bundled_pi_cli_outranks_stale_path_binary(tmp_path: Path) -> None:
    launcher, env, marker, _repo = _launcher_fixture(tmp_path)
    global_version = subprocess.run(
        ["pi", "--version"],
        env=env,
        check=True,
        capture_output=True,
        text=True,
    )
    assert global_version.stdout.strip() == "pi 0.84.0"

    completed = subprocess.run(
        [str(launcher)],
        env=env,
        check=False,
        capture_output=True,
        text=True,
        timeout=5,
    )

    assert completed.returncode == 0, completed.stderr
    assert marker.read_text(encoding="utf-8") == "bundled-0.84.2\n"


def test_valid_explicit_pi_cli_override_has_highest_priority(tmp_path: Path) -> None:
    launcher, env, marker, _repo = _launcher_fixture(tmp_path)
    override_root = tmp_path / "override" / "pi-coding-agent"
    (override_root / "package.json").parent.mkdir(parents=True)
    (override_root / "package.json").write_text(
        json.dumps(
            {
                "name": "@earendil-works/pi-coding-agent",
                "version": "0.84.2",
                "type": "module",
            }
        )
        + "\n",
        encoding="utf-8",
    )
    override = override_root / "dist" / "cli.js"
    _write_executable(
        override,
        "#!/usr/bin/env node\n"
        "import fs from 'node:fs';\n"
        "fs.writeFileSync(process.env.PI_COC_TEST_MARKER, 'override-0.84.2\\n');\n",
    )
    env["COC_PI_CLI"] = str(override)

    completed = subprocess.run(
        [str(launcher)],
        env=env,
        check=False,
        capture_output=True,
        text=True,
        timeout=5,
    )

    assert completed.returncode == 0, completed.stderr
    assert marker.read_text(encoding="utf-8") == "override-0.84.2\n"


def test_invalid_explicit_pi_cli_override_fails_closed(tmp_path: Path) -> None:
    launcher, env, marker, _repo = _launcher_fixture(tmp_path)
    env["COC_PI_CLI"] = str(tmp_path / "missing-pi")

    completed = subprocess.run(
        [str(launcher)],
        env=env,
        check=False,
        capture_output=True,
        text=True,
        timeout=5,
    )

    assert completed.returncode != 0
    assert "COC_PI_CLI" in completed.stderr
    assert not marker.exists()


def test_mismatched_bundled_pi_cli_fails_without_global_fallback(
    tmp_path: Path,
) -> None:
    launcher, env, marker, repo = _launcher_fixture(tmp_path)
    bundled_package = (
        repo
        / "runtime"
        / "adapters"
        / "keeper"
        / "node_modules"
        / "@earendil-works"
        / "pi-coding-agent"
        / "package.json"
    )
    bundled_package.write_text(
        json.dumps({"name": "@earendil-works/pi-coding-agent", "version": "0.84.1"})
        + "\n",
        encoding="utf-8",
    )

    completed = subprocess.run(
        [str(launcher)],
        env=env,
        check=False,
        capture_output=True,
        text=True,
        timeout=5,
    )

    assert completed.returncode != 0
    assert "required 0.84.2" in completed.stderr
    assert "found 0.84.1" in completed.stderr
    assert not marker.exists()


def test_unexecutable_bundled_pi_cli_fails_without_global_fallback(
    tmp_path: Path,
) -> None:
    launcher, env, marker, repo = _launcher_fixture(tmp_path)
    bundled_cli = (
        repo
        / "runtime"
        / "adapters"
        / "keeper"
        / "node_modules"
        / "@earendil-works"
        / "pi-coding-agent"
        / "dist"
        / "cli.js"
    )
    bundled_cli.chmod(0o644)

    completed = subprocess.run(
        [str(launcher)],
        env=env,
        check=False,
        capture_output=True,
        text=True,
        timeout=5,
    )

    assert completed.returncode != 0
    assert "missing or not executable" in completed.stderr
    assert "global Pi is not a patched substitute" in completed.stderr
    assert not marker.exists()


def test_pi_cli_lock_drift_fails_before_any_cli_exec(tmp_path: Path) -> None:
    launcher, env, marker, repo = _launcher_fixture(tmp_path)
    lock_path = repo / "runtime" / "adapters" / "keeper" / "package-lock.json"
    lock = json.loads(lock_path.read_text(encoding="utf-8"))
    lock["packages"]["node_modules/@earendil-works/pi-agent-core"]["version"] = (
        "0.84.1"
    )
    lock_path.write_text(json.dumps(lock) + "\n", encoding="utf-8")

    completed = subprocess.run(
        [str(launcher)],
        env=env,
        check=False,
        capture_output=True,
        text=True,
        timeout=5,
    )

    assert completed.returncode != 0
    assert "invalid bundled Pi version contract" in completed.stderr
    assert "must pin pi-coding-agent and pi-agent-core to 0.84.2" in completed.stderr
    assert not marker.exists()
