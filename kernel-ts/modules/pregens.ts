/**
 * Contract §207: a book's pregenerated investigators. The reading that finds them (`material: "pregens"`, §207.3) and the
 * draft-check laws of the record they are written as (§207.1): one `investigator-template` node whose `properties.sheet`
 * holds the sheet as printed.
 *
 * The laws throw `RpcError`s carrying `details.refusals`, the shape `checkDraft`'s stages turn into one finding each
 * (§186.3), so a reader repairing a sheet sees every refused field at once.
 */
import { RpcError } from "../errors.js";
import { isJsonObject } from "../json.js";
import { array, row, string, type Row } from "../read/values.js";
import type { ModuleContract } from "./contract.js";
import { pregenSheetRefusals, SHEET_KIND, SHEET_PROPERTY } from "./pregen-sheet.js";
import { PREGENS_MATERIAL } from './pregens-material.js';
export { PREGENS_MATERIAL, PREGENS_FOCUS, PREGENS_QUESTION } from './pregens-material.js';

/** §207.3: the material of the reading that finds a book's pregens, and the focus and question the kernel gives it. */

/** §207.3: the settled row of the book's pregens reading (published or unusable), if any. */
export function pregensSettlement(meta: Row): Row | undefined {
    return array(row(meta.reading).materials).find(material => material.material === PREGENS_MATERIAL);
}

/** §207.1: the loose numbers a template's sheet holds instead, as `actorNumbersLaw` keeps an actor's in its profile. */
const LOOSE = ["stats", "skills", "characteristics", "derived"];
const token = (key: string): string => key.replace(/~/g, "~0").replace(/\//g, "~1");

function refuseSheets(refusals: Row[], extra: Row = {}): never {
    const first = refusals[0], rules = new Set(refusals.map(item => item.rule));
    throw new RpcError("invalid_params", `sheet ${first.node}: ${first.path}: ${first.message}`, {
        fix: "transcribe the pregenerated investigator's sheet against the page it is printed on (contract 207.1): only the keys of properties.sheet, "
            + "each number exactly as printed, nothing computed or filled; "
            + (rules.has("sheet_unknown_skill") || Object.hasOwn(extra, "ruleset") ? "name each skill as details.ruleset spells it, keeping the printed specialisation; " : "")
            + (rules.has("sheet_kind") ? "a sheet belongs only to an investigator-template node: a pregenerated investigator is never an npc; " : "")
            + (rules.has("sheet_outside_seat") ? "move the investigator's printed numbers into properties.sheet and delete the loose copy; " : "")
            + "a value the sheet does not print stays absent",
        details: { reason: "reading_failed", path: first.path, rule: first.rule, refusals, ...extra },
    });
}

/**
 * §207.1, draft check: a sheet sits only on an `investigator-template`; a template keeps its numbers in the sheet; every sheet
 * has the shape. `nodes` are the drafted nodes in draft order; paths are the draft's own (`/nodes/<i>/...`).
 */
export function checkSheets(nodes: Row[], contract: ModuleContract): void {
    const refusals: Row[] = [];
    let unknownSkill = false;
    for (const [i, node] of nodes.entries()) {
        if (!isJsonObject(node)) continue;
        const props = row(node.properties), id = string(node.node_id), base = `/nodes/${i}/properties`;
        const hasSheet = Object.hasOwn(props, SHEET_PROPERTY);
        if (hasSheet && node.node_kind !== SHEET_KIND)
            refusals.push({ node: id, rule: "sheet_kind", path: `${base}/${SHEET_PROPERTY}`, message: `a sheet belongs to an ${SHEET_KIND} node, not ${JSON.stringify(node.node_kind)}` });
        if (node.node_kind === SHEET_KIND)
            for (const key of LOOSE.filter(key => isJsonObject(props[key])))
                refusals.push({ node: id, rule: "sheet_outside_seat", path: `${base}/${token(key)}`, message: `${key} beside the sheet; the investigator's printed numbers are in properties.sheet` });
        if (!hasSheet || node.node_kind !== SHEET_KIND) continue;
        if (!contract.rules) throw new Error("the draft writes a pregenerated investigator's sheet but the content root carries no ruleset tables to check it against");
        for (const refusal of pregenSheetRefusals(props[SHEET_PROPERTY], contract.rules, `${base}/${SHEET_PROPERTY}`)) {
            if (refusal.rule === "sheet_unknown_skill" || refusal.rule === "shape_unknown_skill") unknownSkill = true;
            refusals.push({ node: id, ...refusal });
        }
    }
    if (refusals.length) refuseSheets(refusals, unknownSkill && contract.rules
        ? { ruleset: { skills: [...contract.rules.skills], specialization_groups: Object.keys(contract.rules.groups) } } : {});
}

/**
 * §207.3, draft check of a `pregens` reading: only `investigator-template` nodes, each with a sheet and in `ready_nodes`, and no
 * claims. An empty draft is the answer "none printed".
 */
export function checkPregensScope(filled: Row): void {
    const refusals: Row[] = [], ready = new Set(array(filled.ready_nodes));
    for (const [i, node] of array(filled.nodes).entries()) {
        if (!isJsonObject(node)) continue;
        const id = string(node.node_id);
        if (node.node_kind !== SHEET_KIND)
            refusals.push({ node: id, rule: "pregens_scope", path: `/nodes/${i}/node_kind`, message: `this reading writes only ${SHEET_KIND} nodes` });
        else if (!isJsonObject(row(node.properties)[SHEET_PROPERTY]))
            refusals.push({ node: id, rule: "pregens_scope", path: `/nodes/${i}/properties/${SHEET_PROPERTY}`, message: "each pregenerated investigator carries the sheet the book prints" });
        else if (!ready.has(node.node_id))
            refusals.push({ node: id, rule: "pregens_scope", path: `/nodes/${i}`, message: "list each pregenerated investigator in ready_nodes" });
    }
    array(filled.claims).forEach((_claim, j) => refusals.push({ node: "", rule: "pregens_scope", path: `/claims/${j}`, message: "this reading writes no claims" }));
    if (!refusals.length) return;
    const first = refusals[0];
    throw new RpcError("invalid_params", `pregens reading: ${first.path}: ${first.message}`, {
        fix: `this reading writes only the book's pregenerated investigators: one ${SHEET_KIND} node per printed investigator, each with properties.sheet and listed in ready_nodes, and no claims; `
            + "remove every other node and claim. When the book prints none, submit an empty draft",
        details: { reason: "reading_failed", path: first.path, rule: first.rule, refusals },
    });
}

/** §207.4: whether a graph node is a pregenerated investigator the setup can offer: a template carrying a sheet. */
export function offeredTemplate(node: unknown): node is Row {
    return isJsonObject(node) && node.node_kind === SHEET_KIND && isJsonObject(row(node.properties)[SHEET_PROPERTY]);
}
