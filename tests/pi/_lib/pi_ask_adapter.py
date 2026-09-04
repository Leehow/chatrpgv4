"""Development scaffold: reach a model through the locally installed `pi`.

NOT part of the product. It exists so an unattended build can be proven on
this machine without the pipeline itself naming a binary — the packaged app
injects its own session instead, which is the same model already running the
Keeper. `coc_module_build` takes this as `--adapter`; nothing under
`plugins/` imports it.
"""
from __future__ import annotations

import os
import subprocess

MODEL = os.environ.get("COC_BUILD_MODEL", "xai/grok-4.5")
THINKING = os.environ.get("COC_BUILD_THINKING", "low")
TIMEOUT = int(os.environ.get("COC_BUILD_TIMEOUT", "900"))


# Measured on this machine, one prompt sent six times unchanged: 5.0s, hang,
# 56.4s, hang, 5.2s, 5.7s. Two of six never returned. Four earlier guesses at
# the cause -- `@file` argument passing, a competing `pi` process, input size,
# and a size threshold read off a gradient that was really a time sequence --
# were all wrong, and the six-sample repeat is what settled it. The provider
# hangs intermittently, at roughly a third of calls, regardless of anything
# this adapter controls.
#
# So a transport retry belongs here, and only here. It is not covering for a
# gate: `coc_module_build` retries a reply that FAILED a gate, which is a
# different thing and stays separate. This retries a call that never answered.
TRANSPORT_ATTEMPTS = int(os.environ.get("COC_BUILD_TRANSPORT_ATTEMPTS", "4"))


def ask(instruction: str, payload: str) -> str:
    prompt = f"{instruction}\n\n---\n\n{payload}\n"
    last: Exception | None = None
    for attempt in range(1, TRANSPORT_ATTEMPTS + 1):
        try:
            completed = subprocess.run(
                ["pi", "-p", "--mode", "text", "--no-session", "--no-tools",
                 "--no-context-files", "--model", MODEL, "--thinking", THINKING,
                 prompt],
                capture_output=True, text=True, timeout=TIMEOUT,
            )
        except subprocess.TimeoutExpired as error:
            last = error
            continue
        if completed.returncode != 0:
            last = RuntimeError(
                f"pi exited {completed.returncode}: "
                f"{completed.stderr.strip()[-400:]}"
            )
            continue
        return completed.stdout
    raise RuntimeError(
        f"the model did not answer in {TRANSPORT_ATTEMPTS} transport attempts; "
        f"last failure: {last}"
    )
