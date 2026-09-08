"""Every shipped rules table is either read by the kernel or declared unread here.

Nine of the seventeen defects the 2026-09-07 live table turned up were one shape:
one side of a contract was written and the other side was never wired. A relation
with no consumer, a candidate kind with no producer, a number with no reader. The
cheapest of those to let rot is a data file: `content/rulesets/coc7/rules-json/`
holds 47 tables extracted from the Keeper Rulebook, and nothing anywhere said
which of them the kernel actually opens.

`rule-graph-table-digests.json` already registers the sibling gap — which tables
the *rule graph* binds — and says why: "so that gap cannot grow silently". This is
the same register on the axis that decides whether a table does anything at all:
does any line of kernel source name it.

The check is deliberately crude. `RuleTables.load(name)` is always called with a
literal, so a table is "read" when its stem appears as a string constant anywhere
under `kernel/`. That over-counts (a stem could appear in prose) and never
under-counts, which is the safe direction: it will not call a live table dead.

Adding a table to `rules-json/` now forces a choice — wire it, or write down here
why it ships unread. Deleting the last reader of a live table fails here too.
"""

from __future__ import annotations

import ast
from pathlib import Path

WORKTREE = Path(__file__).resolve().parents[2]
RULES_JSON = WORKTREE / "content/rulesets/coc7/rules-json"
KERNEL = WORKTREE / "kernel"

#: Tables that ship with the ruleset and that no kernel code opens, each with the
#: reason it is still here. These are not bugs on their own — the bug would be one
#: arriving without anybody noticing.
UNREAD_TABLES = {
    "npc-core-tags": "Extracted for the NPC layer; §17 ships stance, ties and claims off the "
                     "module graph instead, and the tags have no consumer yet.",
    "npc-role-templates": "Same extraction. Role templates would be a generator for walk-on NPCs; "
                          "nothing generates NPCs today.",
    "npc-social-roles": "The one with a half-built other end: starter NPC records carry a "
                        "`social_role` field and this file holds the duty templates it would "
                        "name, but no code joins them. Wiring it is a feature, not a fix.",
    "npc-stat-archetypes": "Statblock archetypes for NPCs the book does not stat. §17.9 pins a "
                           "helping NPC's skill from the keeper's `apply npc` instead.",
    "storylet-library": "260KB of storylets. §13.3 says in so many words that this slice does not "
                        "carry them; the Director scores beats off the graph.",
    "structure-weights": "Scenario-structure weights from the old tree. The Director's scoring "
                         "rules live on the director graph now.",
    "the-haunting": "V1 per-scenario rules for one module (Corbitt's magic points, the floating "
                    "knife). Superseded by the module graph the starter ships.",
    "time-costs": "Min/default/max minutes per kind of action, for clamping a proposed time "
                  "advance. The keeper names the minutes and the kernel takes them; nothing "
                  "validates the estimate.",
}


def _string_constants(root: Path) -> set[str]:
    """Every string literal in the kernel's Python source."""
    found: set[str] = set()
    for path in sorted(root.rglob("*.py")):
        try:
            tree = ast.parse(path.read_text(encoding="utf-8"))
        except (OSError, SyntaxError):  # pragma: no cover - a broken kernel fails elsewhere
            continue
        for node in ast.walk(tree):
            if isinstance(node, ast.Constant) and isinstance(node.value, str):
                found.add(node.value)
    return found


def test_every_shipped_table_is_read_or_declared_unread():
    tables = {path.stem for path in RULES_JSON.glob("*.json")}
    assert tables, "the coc7 ruleset ships no tables at all"
    named = _string_constants(KERNEL)
    unread = tables - named

    unexpected = sorted(unread - set(UNREAD_TABLES))
    assert not unexpected, (
        "these tables ship with the ruleset and no kernel code opens them; wire them or "
        f"add them to UNREAD_TABLES with the reason: {unexpected}")

    revived = sorted(set(UNREAD_TABLES) - unread)
    assert not revived, (
        "these are declared unread but the kernel now names them; drop them from "
        f"UNREAD_TABLES: {revived}")

    missing = sorted(set(UNREAD_TABLES) - tables)
    assert not missing, f"UNREAD_TABLES names tables that are not shipped: {missing}"


def test_the_register_says_why_each_one_is_here():
    """A bare list decays into a mute allowlist; the reason is the point."""
    for name, reason in UNREAD_TABLES.items():
        assert len(reason) > 40, f"{name} needs a real reason, not {reason!r}"
