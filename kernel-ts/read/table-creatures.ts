/**
 * Creatures this table has and the book does not (contract §180.6).
 *
 * The Keeper's own animal -- a yard dog, a mule, a swarm in the cellar -- was a person until §180: `apply npc walk_on`
 * minted it into `world.table_people`, and from there every person feature reached it (an epithet, an untold block, a
 * voice, a journal). It is declared as a creature now (`apply npc {walk_on: true, creature: ...}`) and recorded in
 * `world.table_creatures[] = {name, turn, why, established_at, catalog?}`, never in `table_people`.
 *
 * The record is world state and this is only its projection, installed over a loaded graph in the same position the
 * table people occupy and rebuilt from `world` on every load: a `creature` node under a kernel-minted id, the word the
 * Keeper used as its handle, `campaign_origin.kind: "table"`. A stat block the table pinned for a creature from the rules
 * catalog (`world.npc_profiles[<handle>]` carrying `catalog`) makes it an actor again on every load (`pinBody`), whether
 * the creature is the table's or a book creature the book gave no numbers.
 */
import { isJsonObject, jsonDigest } from '../json.js';
import type { LoadedModule } from './campaign.js';
import type { ModuleGraph } from './module-graph.js';
import { array, entries, normalize, row, string, type Row } from './values.js';

/** Minted by the kernel, never copied by the Keeper: the handle is the word they used. */
export const tableCreatureId = (name: string): string => `creature-table-${jsonDigest(normalize(name)).slice(0, 20)}`;

/** The creatures to install: every record with a name. */
export function tableCreatures(world: Row): Row[] {
    return array(world.table_creatures).map(row).filter(creature => !!string(creature.name).trim());
}

/** Rehydrate the world's record onto a loaded graph, and the catalog stat blocks pinned on creatures. Idempotent. */
export function installTableCreatures(graph: ModuleGraph, world: Row): ModuleGraph {
    for (const creature of tableCreatures(world)) {
        const name = string(creature.name).trim();
        graph.addTableCreature(tableCreatureId(name), name, { reason: typeof creature.why === 'string' ? creature.why : null,
            turn: creature.turn ?? null, ...(typeof creature.catalog === 'string' ? { catalog: creature.catalog } : {}) });
    }
    // Only `apply npc creature` writes a profile carrying `catalog` (an archetype pin carries `archetype`, and a creature
    // is refused one), so a person's pin never makes a same-handle creature an actor.
    for (const [handle, profile] of entries(row(world.npc_profiles)))
        if (isJsonObject(profile) && typeof profile.catalog === 'string')
            graph.pinBody(graph.find(handle, ['creature']));
    return graph;
}

/** The module with this table's creatures installed; a table creature needs no source reading, as a table person does not. */
export function withTableCreatures(module: LoadedModule, world: Row): LoadedModule {
    installTableCreatures(module.graph, world);
    const source = module.material;
    const material = (name: string): string => module.graph.isTableCreature(module.graph.find(name)) ? 'ready' : source(name);
    if (module.graph.materialOverride) module.graph.materialOverride = material;
    return { ...module, material };
}
