"""Docs contract for the canonical temporal memory path (``temporal-memory-1``).

Proves the routed campaign-state/memory documentation presents the Git-backed
temporal memory as the single canonical Pi-Coc memory path:

- the canonical operation names (``history.query`` / ``history.diff``,
  ``memory.recall`` / ``memory.adjudicate``, and the timeline
  fork/confluence operations) are documented on the routed surfaces;
- the Git-immutable / SQLite-rebuildable / ``memory/temporal/*.jsonl``
  layering with no migration, no dual reader, and no fallback is stated;
- the legacy Markdown card operations (``memory.search`` / ``memory.write`` /
  ``memory.resolve_hook``) appear only inside explicitly legacy-labeled
  context — never instructed as a normal play path — and are never claimed
  deleted or migrated while the compatibility surfaces still exist in code.
"""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SKILL = ROOT / "plugins" / "coc-keeper" / "skills" / "coc-campaign-state" / "SKILL.md"
PROTOCOL = ROOT / "plugins" / "coc-keeper" / "references" / "memory-protocol.md"
PRODUCT_SPEC = ROOT / "docs" / "specs" / "git-temporal-memory-worldlines.md"
CONTRACT_SPEC = ROOT / "docs" / "specs" / "temporal-memory-contract.md"

CANONICAL_OPS = (
    "history.query",
    "history.diff",
    "memory.recall",
    "memory.adjudicate",
    "timeline.fork_request",
    "timeline.fork_confirm",
    "timeline.confluence_query",
    "timeline.confluence_confirm",
)
LEGACY_OPS = ("memory.search", "memory.write", "memory.resolve_hook")
NO_FALLBACK_PHRASE = "no migration, no dual reader, no fallback"


def _text(path: Path) -> str:
    assert path.is_file(), path
    return path.read_text(encoding="utf-8")


def _flat(text: str) -> str:
    return " ".join(text.split()).lower()


def _paragraphs(text: str) -> list[str]:
    return [block.strip() for block in text.split("\n\n") if block.strip()]


def _sections(text: str) -> dict[str, str]:
    """Map ``## `` heading -> section body (sub-``###`` blocks stay nested)."""
    sections: dict[str, str] = {}
    heading = ""
    body: list[str] = []
    for line in text.splitlines():
        if line.startswith("## "):
            if heading or body:
                sections[heading] = "\n".join(body)
            heading = line[3:].strip()
            body = []
        else:
            body.append(line)
    sections[heading] = "\n".join(body)
    return sections


def test_canonical_operations_are_documented_on_routed_surfaces():
    for path in (SKILL, PROTOCOL, PRODUCT_SPEC):
        flat = _flat(_text(path))
        for op in CANONICAL_OPS:
            assert op in flat, f"{op} missing from {path}"


def test_canonical_layering_is_documented():
    for path in (SKILL, PROTOCOL):
        flat = _flat(_text(path))
        assert "temporal-memory-1" in flat, path
        assert "memory/temporal/" in flat, path
        assert "history-projection.db" in flat, path
        assert "immutable" in flat, path
        assert "rebuildable" in flat, path
        assert NO_FALLBACK_PHRASE in flat, path


def test_memory_is_documented_as_never_authoritative():
    for path in (SKILL, PROTOCOL):
        flat = _flat(_text(path))
        assert "never authoritative truth" in flat, path
        assert "state.*" in flat and "rules.*" in flat, path


def test_legacy_ops_in_protocol_appear_only_in_legacy_sections():
    sections = _sections(_text(PROTOCOL))
    for heading, body in sections.items():
        if any(op in body for op in LEGACY_OPS):
            assert "legacy" in heading.lower(), (
                f"legacy ops documented outside a legacy-labeled section: "
                f"{heading!r}"
            )


def test_legacy_ops_in_skill_appear_only_in_legacy_paragraphs():
    for paragraph in _paragraphs(_text(SKILL)):
        if any(op in paragraph for op in LEGACY_OPS):
            assert "legacy" in paragraph.lower(), (
                "legacy ops instructed outside a legacy-labeled paragraph: "
                f"{paragraph[:120]!r}"
            )


def test_legacy_store_is_labeled_debt_and_not_claimed_deleted():
    """Docs must label the card store as debt and admit surfaces remain."""
    for path in (SKILL, PROTOCOL):
        flat = _flat(_text(path))
        assert "non-canonical legacy technical debt" in flat, path
        assert "still registered" in flat, path
        assert "nothing has been deleted" in flat, path


def test_protocol_explains_required_temporal_concepts():
    sections = _sections(_text(PROTOCOL))
    required = {
        "Canonical layers (`temporal-memory-1`)",
        "Canonical normal operations",
        "Subjects, entities, and scopes",
        "Privacy tiers",
        "Player assertions and the knowledge boundary",
        "Supersession and narrative debt",
        "Episodes and the extraction backlog",
        "Semantic IDs vs machine hashes",
        "Bounded resume capsule",
        "Evidence preservation",
        "Legacy Markdown card store (non-canonical technical debt)",
    }
    missing = required - set(sections)
    assert not missing, missing
    # The canonical operations table lives in the canonical section.
    canonical_body = _flat(sections["Canonical normal operations"])
    for op in CANONICAL_OPS:
        assert op in canonical_body, op
    # Legacy ops must not leak into any canonical section.
    for heading, body in sections.items():
        if "legacy" not in heading.lower():
            assert not any(op in body for op in LEGACY_OPS), heading


def test_product_spec_status_claims_slices_without_completion():
    flat = _flat(_text(PRODUCT_SPEC))
    assert "已完成并合入主分支" in flat
    assert "尚未完成" in flat
    assert "host-integration" in flat
    assert "plugin-acceptance" in flat
    assert "unintegrated" in flat
    assert "不得宣称产品支持或验收完成" in flat


def test_contract_spec_status_keeps_unintegrated_caveat():
    flat = _flat(_text(CONTRACT_SPEC))
    assert "unintegrated" in flat
    assert "尚未完成" in flat
    assert "不得宣称产品支持" in flat
