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
under `kernel-ts/`. That over-counts (a stem could appear in prose) and never
under-counts, which is the safe direction: it will not call a live table dead.

Adding a table to `rules-json/` now forces a choice — wire it, or write down here
why it ships unread. Deleting the last reader of a live table fails here too.
"""

from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

WORKTREE = Path(__file__).resolve().parents[2]
RULES_JSON = WORKTREE / "content/rulesets/coc7/rules-json"
KERNEL = WORKTREE / "kernel-ts"

#: Tables that ship with the ruleset and that no kernel code opens, each with the
#: reason it is still here. These are not bugs on their own — the bug would be one
#: arriving without anybody noticing.
UNREAD_TABLES = {
    "metadata": "Ruleset source metadata; the old Python scan mistook a combat event field "
                "with the same name for a reader of this file.",
    "build-scale": "Comparative-build reference data. The retired Python helper had no "
                   "reachable RPC or graph decision; active maneuver arithmetic reads combat-rule.",
    "npc-core-tags": "Extracted for the NPC layer; §17 ships stance, ties and claims off the "
                     "module graph instead, and the tags have no consumer yet.",
    "npc-role-templates": "Same extraction. Role templates would be a generator for walk-on NPCs; "
                          "nothing generates NPCs today.",
    "npc-social-roles": "The one with a half-built other end: starter NPC records carry a "
                        "`social_role` field and this file holds the duty templates it would "
                        "name, but no code joins them. Wiring it is a feature, not a fix.",
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


def _carries_localized_labels(value: object) -> bool:
    """Whether a table holds a `localized_labels` row anywhere in its nesting."""
    if isinstance(value, dict):
        return "localized_labels" in value or any(_carries_localized_labels(v) for v in value.values())
    if isinstance(value, list):
        return any(_carries_localized_labels(v) for v in value)
    return False


def _glossary_tables() -> set[str]:
    """Tables the player glossary reads without naming them.

    `kernel-ts/read/handlers.ts` (`playerGlossary`) opens every table in the directory
    and keeps each `localized_labels` row for the campaign's play language (contract
    §23), so a table that carries such rows is read by that walk -- `kernel-terms`
    exists for nothing else -- while one that carries none contributes nothing to it
    and still needs a named reader.
    """
    import json

    found: set[str] = set()
    for path in sorted(RULES_JSON.glob("*.json")):
        try:
            if _carries_localized_labels(json.loads(path.read_text(encoding="utf-8"))):
                found.add(path.stem)
        except (OSError, ValueError):  # pragma: no cover - a broken table fails elsewhere
            continue
    return found


def _string_constants(root: Path) -> set[str]:
    """Read string literals from the active TypeScript kernel with its parser."""
    source = r'''
const ts = require('typescript'), fs = require('node:fs'), path = require('node:path');
const found = new Set();
function walk(dir) {
  for (const item of fs.readdirSync(dir, {withFileTypes: true})) {
    const file = path.join(dir, item.name);
    if (item.isDirectory()) walk(file);
    else if (file.endsWith('.ts')) {
      const tree = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
      function visit(node) {
        if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
          found.add(node.text);
          if (node.text.endsWith('.json')) found.add(path.basename(node.text, '.json'));
        }
        ts.forEachChild(node, visit);
      }
      visit(tree);
    }
  }
}
walk(process.argv[1]);
process.stdout.write(JSON.stringify([...found]));
'''
    return set(json.loads(subprocess.check_output(
        [os.environ.get("COC_TEST_NODE", "node"), "-e", source, str(root)], cwd=WORKTREE, text=True,
    )))


def test_every_shipped_table_is_read_or_declared_unread():
    tables = {path.stem for path in RULES_JSON.glob("*.json")}
    assert tables, "the coc7 ruleset ships no tables at all"
    named = _string_constants(KERNEL) | _glossary_tables()
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
