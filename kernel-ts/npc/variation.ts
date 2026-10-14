/** Package-authored random portrayal prompts, distinct from source truth and played mood (§238). */
import {RpcError} from '../errors.js';
import {isJsonObject, parsePythonJson} from '../json.js';
import type {ModuleGraph} from '../read/module-graph.js';
import {array, clone, number, row, string, type Row} from '../read/values.js';
import {moodNow} from './mood.js';

export const VARIATION_CAPABILITY = 'npc.variation-tables.v1';
export const isNpcVariationRoll = (receipt: Row): boolean => receipt.kind === 'roll' && receipt.family === 'npc-variation';
const LIFETIMES: Record<string, string> = {temperament:'stable', values:'stable', speech:'stable', emotion:'initial', social:'initial'};

export function variationTables(mod: Row, files: ReadonlyMap<string, Buffer>): Row[] {
    const path = row(mod.contributes).npc_variation;
    if (path === undefined) return [];
    const invalid = (): never => { throw new RpcError('invalid_params', 'npc_variation requires npc.variation-tables.v1 and five valid package portrayal tables'); };
    if (!array(mod.requires).includes(VARIATION_CAPABILITY) || typeof path !== 'string' || !path.endsWith('.json') || !files.has(path)) return invalid();
    const data = parsePythonJson(files.get(path)!.toString('utf8'));
    if (!isJsonObject(data) || data.version !== 1 || Object.keys(data).some(key => !['version','tables'].includes(key))
        || !Array.isArray(data.tables) || data.tables.length !== 5) return invalid();
    const seen = new Set<string>();
    const tables = array(data.tables);
    for (const table of tables) {
        if (!isJsonObject(table) || Object.keys(table).some(key => !['key','lifetime','rows'].includes(key))
            || typeof table.key !== 'string' || !Object.hasOwn(LIFETIMES, table.key) || table.lifetime !== LIFETIMES[table.key] || seen.has(table.key)
            || !Array.isArray(table.rows) || table.rows.length < 2 || table.rows.length > 100
            || table.rows.some((line: unknown) => typeof line !== 'string' || !line.trim() || [...line].length > 240 || /[\r\n]/.test(line))
            || new Set(table.rows).size !== table.rows.length) return invalid();
        seen.add(table.key);
    }
    return tables;
}

/** Pending mood receipts have the same precedence as the committed ledger, without folding a turn early. */
export function currentNpcMood(graph: ModuleGraph, world: Row, node: Row, ledger: Row = {}, receipts: Row[] = []): Row | null {
    if (!graph.isPerson(node)) return null;
    const handle = graph.handle(node), pending = receipts.filter(receipt => receipt.kind === 'npc'
        && [string(node.node_id), handle].includes(string(receipt.npc ?? receipt.handle)) && typeof row(receipt.mood).text === 'string').at(-1);
    if (pending) return {feels: pending.mood.text, since_turn: null};
    return moodNow(row(ledger[string(node.node_id)]));
}

/** Accepted random guidance remains core continuity; it never grants a fact or overrides an authored personality. */
export function npcVariation(graph: ModuleGraph, world: Row, node: Row, mood: Row | null = null): Row | null {
    if (!graph.isPerson(node)) return null;
    const value = row(row(row(world.npc_character)[string(node.node_id)]).variation);
    if (value.origin !== 'table_random' || !Object.keys(row(value.stable)).length) return null;
    return {stable: clone(value.stable), ...(!mood ? {initial: clone(value.initial)} : {}), origin:'table_random', since_turn:number(value.initialized_turn)};
}
