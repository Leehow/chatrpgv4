/**
 * Contract §178, re-ruled by §224.3 (user ruling 2026-10-10, per the Keeper Rulebook: Credit Rating p.60, When to Roll Dice
 * pp.82-83): a Mod check declared `trigger: "presence"` is offered while its person shares a scene with an investigator and
 * rolled only when the host's check selection finds the impression matters this turn. The kernel no longer rolls it on
 * meeting; `resolve` settles it (`mods/resolve.ts`) and stamps the §178 receipt fields from here.
 */
import type { ModuleGraph } from '../read/module-graph.js';
import { tableWord } from '../read/person-words.js';
import type { Row } from '../read/values.js';

/** §178.4: the table's word for a person, for the card. Never the book's name of someone untold. */
export function publicPersonLabel(graph: ModuleGraph, world: Row, node: Row): string | null {
    const word = tableWord(world, graph.handle(node));
    if (word) return word;
    return graph.isTablePerson(node) ? graph.displayName(node) || null : null;
}

/** §224.3: the receipt fields a rolled presence check keeps, so §178.4's readers (the roll card, the ledger fold) still read it. */
export function presenceReceiptFields(graph: ModuleGraph, world: Row, recipe: Row, target: Row): Row {
    if (recipe.trigger !== 'presence') return {};
    const label = publicPersonLabel(graph, world, target);
    return { trigger: 'presence', ...(label ? { public_target_label: label } : {}) };
}
