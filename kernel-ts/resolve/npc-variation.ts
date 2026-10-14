/** Kernel dice select portrayal prompts once; existing write owners publish the staged result (§238). */
import type {KernelContext} from '../context.js';
import type {ModuleGraph} from '../read/module-graph.js';
import {activeMods} from '../read/mods.js';
import {npcsPresent} from '../read/capsule.js';
import {array, clone, number, row, string, type Row} from '../read/values.js';
import {variationTables} from '../npc/variation.js';
import {nowIso} from '../write/store.js';
import {PythonRandom} from '../random.js';
import {jsonDigest} from '../json.js';

export async function initializeNpcVariations(context: KernelContext, graph: ModuleGraph, world: Row, turn: Row,
    receipts: Row[] = [], allowNew = true, campaign = context.workspace): Promise<Row[]> {
    const people = npcsPresent(graph, world, graph.scene(world.active_scene)).filter(node => graph.isPerson(node));
    const result: Row[] = [], n = number(turn.turn), existingIds = new Set(receipts.map(receipt => receipt.id));
    // Repair the secondary turn view from accepted core continuity, even if the optional package is now off.
    for (const node of people) {
        const saved = row(row(row(world.npc_character)[string(node.node_id)]).variation);
        if (saved.origin === 'table_random' && saved.initialized_turn === n && row(saved.receipt).id && !existingIds.has(saved.receipt.id))
            result.push(clone(saved.receipt));
    }
    if (!allowNew || !people.some(node => !row(row(world.npc_character)[string(node.node_id)]).variation)) return result;
    const mod = (await activeMods(context, world)).find(mod => row(mod.contributes).npc_variation !== undefined);
    if (!mod) return result;
    const tables = variationTables(mod, mod.files);
    for (const node of people) {
        const id = string(node.node_id), entry = row(row(world.npc_character)[id]);
        if (entry.variation) continue;
        // A dedicated campaign/person stream makes portrayal reproducible without changing CoC check dice.
        const seed = jsonDigest({campaign,npc:id,package:mod.digest}), rng = new PythonRandom(seed);
        const stable: Row = {}, initial: Row = {}, rolled: Row[] = [];
        for (const table of tables) {
            const sides = table.rows.length, roll = rng.randint(1, sides);
            (table.lifetime === 'stable' ? stable : initial)[table.key] = table.rows[roll - 1];
            rolled.push({table:table.key, sides, roll});
        }
        const receipt: Row = {id:`npc-variation:${jsonDigest({campaign,npc:id})}`,kind:'roll',family:'npc-variation',form:'dice',npc:id,handle:graph.handle(node),name:graph.displayName(node),
            skill:'NPC portrayal tables',expression:rolled.map(die=>`1D${die.sides}`).join('+'),faces:rolled.map(die=>die.roll),
            total:rolled.reduce((sum,die)=>sum+die.roll,0),
            call_id:`t${n}-npc-variation`,variation:{stable:clone(stable),initial:clone(initial),rolled:clone(rolled)},
            mod:mod.id,version:mod.version,visibility:'keeper',at:nowIso()};
        (world.npc_character ??= {})[id] = {...entry, variation:{stable,initial,rolled,origin:'table_random',mod:mod.id,
            version:mod.version,initialized_turn:n,seed,receipt:clone(receipt)}};
        result.push(receipt);
    }
    return result;
}
