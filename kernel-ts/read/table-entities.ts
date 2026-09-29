/** Campaign-created places and evidence, projected through the ordinary graph readers. */
import {isJsonObject, jsonDigest} from '../json.js';
import {RpcError} from '../errors.js';
import type {LoadedModule} from './campaign.js';
import type {ModuleGraph} from './module-graph.js';
import {array, normalize, row, string, type Row} from './values.js';

export function tableEntityId(kind: string, name: string): string {
    return `${kind}-table-${jsonDigest(normalize(name)).slice(0, 20)}`;
}

export function validateEstablishment(value: unknown): string | undefined {
    if (value === undefined) return undefined;
    if (!isJsonObject(value) || Object.keys(value).some(key => key !== 'summary') || typeof value.summary !== 'string' || !value.summary.trim())
        throw new RpcError('invalid_params', 'establish requires a nonempty summary and no other fields');
    return value.summary.trim();
}

export function establishTableEntity(graph: ModuleGraph, world: Row, turn: Row, kind: 'scene' | 'clue', name: string, summary: string, scene?: string): Row {
    const record = {id: tableEntityId(kind, name), kind, name: name.trim(), summary, turn: turn.turn, ...(scene ? {scene} : {})};
    const records = array(world.table_entities ??= []);
    const old = records.find(entry => entry.id === record.id);
    if (!old) world.table_entities.push(record);
    return graph.addTableEntity(old ?? record);
}

export function withTableEntities(module: LoadedModule, world: Row): LoadedModule {
    for (const record of array(world.table_entities)) module.graph.addTableEntity(row(record));
    const source = module.material;
    const material = (name: string): string => module.graph.isTableEntity(module.graph.find(name)) ? 'ready' : source(name);
    if (module.graph.materialOverride) module.graph.materialOverride = material;
    return {...module, material};
}
