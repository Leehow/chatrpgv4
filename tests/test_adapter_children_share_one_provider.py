"""The adapter's model children default to one provider.

The opening extractor defaulted to a DeepSeek text model. "Text-only, never a
vision model" is an argument for a text model, not for a second provider, and
that default dragged another credential into a chain that otherwise runs on
the session's own. On 2026-09-02 the credential was invalid and every opening
source review died after rendering its pages, on a 401 for a provider nothing
else in the run touches.

The default lived in four places at once: this launcher export, the adapter's
own constant, the child-env allowlist that named only DEEPSEEK_*, and a
`model_policy` task field that is validated and never consumed. Changing only
the constant did nothing, because the env export wins over it.
"""
from __future__ import annotations

from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
LAUNCHER = ROOT / "plugins" / "coc-keeper" / "pi" / "bin" / "pi-coc"
ADAPTER = ROOT / "plugins" / "coc-keeper" / "pi" / "bin" / "coc-pdf-skill-adapter.py"


def test_launcher_defaults_both_children_to_one_provider() -> None:
    launcher = LAUNCHER.read_text(encoding="utf-8")
    assert (
        'export COC_PI_OPENING_MODEL="${COC_PI_OPENING_MODEL:-$COC_PI_PDF_MODEL}"'
        in launcher
    ), "the extractor default must follow the adapter's own model, not a second provider"


def test_adapter_constant_follows_the_same_model() -> None:
    adapter = ADAPTER.read_text(encoding="utf-8")
    assert re.search(r"^OPENING_TEXT_MODEL = PI_MODEL$", adapter, re.M), (
        "the in-file default must not name a provider of its own either"
    )


def test_child_env_is_not_pinned_to_one_provider() -> None:
    """A provider a caller may name must be reachable by the child.

    The allowlist named only DEEPSEEK_*, which silently encoded the same
    default a third time: naming another provider would have worked only if
    its credential happened to sit in the agent home.
    """
    adapter = ADAPTER.read_text(encoding="utf-8")
    block = adapter.split("_PI_CHILD_ENV_KEYS = frozenset({", 1)[1].split("})", 1)[0]
    providers = {
        match.group(1)
        for match in re.finditer(r'"([A-Z]+)_API_KEY"', block)
    }
    assert len(providers) > 1, (
        f"child env reaches exactly one provider ({providers}); naming any "
        "other in COC_PI_OPENING_MODEL cannot work"
    )
    assert "XAI" in providers, "the session's own provider must be reachable"


def test_failures_name_which_child_and_model() -> None:
    """Both children shared one message that always said "PDF lifecycle"."""
    adapter = ADAPTER.read_text(encoding="utf-8")
    assert '"opening text extractor", _opening_text_model()' in adapter
    assert '"Pi PDF lifecycle", _pi_model()' in adapter
