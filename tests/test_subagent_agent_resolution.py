"""A named dispatch must reach the agent file it names.

`@arhen/pi-core-subagent` never compares an agent file's `name`. It scores the
tokens of `name + task` against each file's `description`, and its tokenizer
keeps only `[a-z0-9]+` -- so a Chinese description produces almost no tokens
and matches nothing, while a long English one attracts unrelated queries.

Measured on 2026-09-02 before this was addressed: every one of this
repository's agents resolved to `(none)`. That does not fail loudly. The
dispatcher falls back to the caller's inline definition, so a steward would
have run without the `tools` and `model` its file declares, and the opening
source coordinator without the toolset it needs to run the PDF adapter.

Every agent's description therefore leads with its own name. This test uses
the package's own resolver, so it tracks the real implementation rather than a
copy of its scoring rules.
"""
from __future__ import annotations

import json
from pathlib import Path
import shutil
import subprocess

import pytest

ROOT = Path(__file__).resolve().parents[1]
RESOLVER = (
    ROOT / ".pi" / "coc-agent" / "npm" / "node_modules"
    / "@arhen" / "pi-core-subagent" / "src" / "agentfile.ts"
)
PI_DIST = (
    ROOT / "runtime" / "adapters" / "keeper" / "node_modules"
    / "@earendil-works" / "pi-coding-agent" / "dist" / "index.js"
)
# Exactly what `pi-coc` mirrors into the `.pi/agents` surface this extension
# discovers: the stewards, and the coordinators matching `coc-*-coordinator`.
# Agents outside that set are never dispatched through it (coc-keeper-kp is
# the Keeper itself; coc-memory-extractor is spawned by the host directly).
AGENT_GLOBS = (
    (ROOT / "plugins" / "coc-keeper" / "pi" / "agents", "steward-*.md"),
    (ROOT / "plugins" / "coc-keeper" / "agents", "coc-*-coordinator.md"),
)

DISPATCHES = {
    "coc-opening-source-coordinator": "coc.codex-opening-source-task.v1 campaign=x",
    "coc-source-coordinator": "bounded source lifecycle task",
    "steward-scene": "解析场景、地点与衔接",
    "steward-npc": "解析 NPC 双轨",
    "steward-rule": "解析规则、预警与线索",
    "steward-init": "建卡最小包 L0 解析",
}


def _dispatchable_agents() -> dict[str, Path]:
    found: dict[str, Path] = {}
    for directory, pattern in AGENT_GLOBS:
        for path in directory.glob(pattern):
            for line in path.read_text(encoding="utf-8").splitlines():
                if line.startswith("name:"):
                    found[line.split(":", 1)[1].strip()] = path
                    break
    return found


def test_every_dispatchable_agent_is_covered_here() -> None:
    """A new agent must not quietly escape this check."""
    known = set(_dispatchable_agents())
    expected = set(DISPATCHES)
    assert expected <= known, f"named here but absent from the repo: {expected - known}"
    assert known <= expected, (
        f"mirrored agent with no resolution case: {known - expected}"
    )


@pytest.mark.skipif(
    not RESOLVER.is_file() or not PI_DIST.is_file(),
    reason="subagent package or pi dist not installed in this checkout",
)
def test_each_named_dispatch_resolves_to_its_own_file(tmp_path: Path) -> None:
    # The resolver imports the pi package by bare specifier; copy it out of
    # node_modules (Node refuses type-stripping inside node_modules) and point
    # that import at the installed dist.
    local = tmp_path / "agentfile.ts"
    local.write_text(
        RESOLVER.read_text(encoding="utf-8").replace(
            '"@earendil-works/pi-coding-agent"', json.dumps(str(PI_DIST))
        ),
        encoding="utf-8",
    )
    probe = tmp_path / "probe.mjs"
    probe.write_text(
        "import { resolveAgentFile } from "
        + json.dumps(str(local))
        + ";\n"
        + "const cwd = " + json.dumps(str(ROOT)) + ";\n"
        + "const agentDir = cwd + '/.pi/coc-agent';\n"
        + "const cases = " + json.dumps(list(DISPATCHES.items()), ensure_ascii=False) + ";\n"
        + "const out = {};\n"
        + "for (const [name, task] of cases) {\n"
        + "  const f = resolveAgentFile(name, task, cwd, agentDir);\n"
        + "  out[name] = f ? f.path.split('/').pop() : null;\n"
        + "}\n"
        + "console.log(JSON.stringify(out));\n",
        encoding="utf-8",
    )
    node = shutil.which("node")
    assert node, "node is required"
    result = subprocess.run(
        [node, "--experimental-strip-types", str(probe)],
        capture_output=True, text=True, cwd=ROOT, check=True,
    )
    resolved = json.loads(result.stdout.strip().splitlines()[-1])
    for name in DISPATCHES:
        assert resolved[name] == f"{name}.md", (
            f"dispatching {name!r} resolved to {resolved[name]!r}; a named "
            "dispatch must reach its own file, and a miss is silent -- the "
            "child runs on the caller's inline definition instead"
        )
