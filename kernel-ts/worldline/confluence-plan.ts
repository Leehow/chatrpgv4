/** Pure confluence report and the existing seven closed disposition classes. */
import { RpcError } from '../errors.js';
import { canonicalJson, compareUnicode, isJsonObject, orderedObject } from '../json.js';
import type { ModuleGraph } from '../read/module-graph.js';
import { array, clone, entries, equal, integer, normalize, number, row, sorted, string, truth, values, type Row } from '../read/values.js';
import { projectSheet } from '../mods/projection.js';
import { valueError } from '../resolve/arithmetic.js';
export const DISPOSITIONS: Readonly<Record<string, readonly string[]>> = Object.freeze({
    numeric: ['from', 'min', 'max'],
    dead_alive: ['from'],
    consumed: ['from', 'drop'],
    flag: ['from'],
    npc_presence: ['from', 'sum'],
    mod_state: ['from'],
    engine_state: ['from'],
});
export const MIRRORED = ['current_hp', 'current_san', 'current_mp'];
export const BOOK = '*book*';
export const conflictId = (kind: string, subject: string, field: string): string => `conflict:${kind}:${subject}:${field}`;
export const spentItemKey = (investigator: string, item: string): string => canonicalJson([investigator, item]);
export interface ConfluenceState {
    line: string;
    world: Row;
    party: Row;
    candidates: Row[];
    spent: ReadonlySet<string>;
    engines: Row;
}
const differs = (items: any[]): boolean => new Set(items.map(item => canonicalJson(item ?? null))).size > 1;
function conflict(kind: string, subject: string, field: string, choices: Row, extra: Row = {}): Row {
    return {
        id: conflictId(kind, subject, field),
        class: kind,
        subject,
        field,
        values: choices,
        ...extra,
        modes: [...DISPOSITIONS[kind]]
    };
}
function mergeFlags(states: readonly ConfluenceState[], conflicts: Row[]): Row {
    const flags = new Map<string, Map<string, any>>();
    for (const state of states)
        for (const [name, value] of entries(state.world.flags)) {
            const byLine = flags.get(name) ?? new Map();
            byLine.set(state.line, value);
            flags.set(name, byLine);
        }
    return orderedObject(sorted(flags.keys()).map(name => {
        const byLine = flags.get(name)!;
        if (differs([...byLine.values()]))
            conflicts.push(conflict('flag', name, 'value', orderedObject(byLine)));
        return [name, byLine.values().next().value];
    }));
}
function mergePresence(graph: ModuleGraph, states: readonly ConfluenceState[], conflicts: Row[]): Row {
    const base = new Map<string, string>();
    for (const scene of graph.kind('scene'))
        for (const id of graph.sceneNpcIds(scene)) {
            const handle = graph.handle(graph.nodes.get(id)!);
            if (!base.has(handle))
                base.set(handle, graph.handle(scene));
        }
    const moved = new Map<string, Map<string, any>>();
    for (const state of states)
        for (const [npc, where] of entries(state.world.npc_presence))
            if (!equal(base.get(npc) ?? null, where)) {
                const byLine = moved.get(npc) ?? new Map();
                byLine.set(state.line, where);
                moved.set(npc, byLine);
            }
    const merged = new Map<string, any>(base);
    for (const npc of sorted(moved.keys())) {
        const byLine = moved.get(npc)!;
        const places = new Set([...byLine.values()].map(string));
        merged.set(npc, byLine.values().next().value);
        if (places.size > 1 || byLine.size < states.length && !places.has(base.get(npc) as string)) {
            const choices = new Map(byLine);
            if (base.get(npc) != null && byLine.size < states.length)
                choices.set(BOOK, base.get(npc));
            conflicts.push(conflict('npc_presence', npc, 'scene', orderedObject(choices)));
            merged.set(npc, sorted(places)[0]);
        }
    }
    return orderedObject(merged);
}
function mergeWorld(graph: ModuleGraph, states: readonly ConfluenceState[], scene: string, conflicts: Row[]): Row {
    if (new Set(states.map(state => canonicalJson(row(state.world.adaptation).revision ?? null))).size > 1)
        throw new RpcError('needs', 'These worldlines have different accepted adaptations; reconciliation is not supported', {
            details: {reason: 'adaptation_merge_conflict', lines: states.map(state => ({name: state.line, adaptations: array(row(state.world.adaptation).records).map(r => r.name)}))}
        });
    const world = clone(states[0].world);
    for (const key of ['visited_scenes', 'discovered_clues', 'discovered_echoes', 'handouts_shown']) {
        const seen: string[] = [];
        for (const state of states)
            for (const value of array(state.world[key]))
                if (!seen.includes(string(value)))
                    seen.push(string(value));
        world[key] = seen;
    }
    const mapKnowledge: Row = {};
    for (const state of states)
        for (const [map, regions] of entries(state.world.map_knowledge)) {
            const known = array(mapKnowledge[map]).map(string);
            for (const region of array(regions).map(string)) if (!known.includes(region)) known.push(region);
            mapKnowledge[map] = known;
        }
    world.map_knowledge = orderedObject(entries(mapKnowledge));
    const mapLabels:Row={};
    for(const state of states)for(const [map,value] of entries(state.world.map_labels)){
        const prior=row(mapLabels[map]),incoming=row(value);mapLabels[map]={title:incoming.title??prior.title,regions:{...row(prior.regions),...row(incoming.regions)},levels:{...row(prior.levels),...row(incoming.levels)}};
    }
    world.map_labels=orderedObject(entries(mapLabels));
    world.active_scene = scene;
    world.scene_trail = [];
    // `clue_how` (§80) merges by the same union as the names: how a line came by a clue is a
    // record of what happened on that line, not a claim two lines can disagree about.
    for (const key of ['scene_labels', 'clue_labels', 'clue_how']) {
        const labels = new Map<string, any>();
        for (const state of states)
            for (const [name, value] of entries(state.world[key]))
                labels.set(name, value);
        world[key] = orderedObject(labels);
    }
    world.clock = {
        minutes: Math.max(...states.map(state => Math.trunc(number(row(state.world.clock).minutes || 0))))
    };
    world.flags = mergeFlags(states, conflicts);
    world.npc_presence = mergePresence(graph, states, conflicts);
    const choices = orderedObject(states.map(state => [state.line, orderedObject(['mods', 'objects', 'npc_resources'].map(key => [key, clone(state.world[key] ?? null)]))]));
    if (differs(values(choices)))
        conflicts.push(conflict('mod_state', 'game-mods', 'snapshot', choices));
    return world;
}
export function engineView(state: ConfluenceState): Row {
    const sheets: Array<[
        string,
        Row
    ]> = [];
    for (const id of sorted(Object.keys(state.party))) {
        const sheet = state.party[id];
        const mirrored = orderedObject(MIRRORED.filter(key => Object.hasOwn(sheet, key)).map(key => [key, sheet[key]]));
        if (truth(mirrored))
            sheets.push([id, mirrored]);
    }
    return {
        save: orderedObject(entries(state.engines).sort(([a], [b]) => compareUnicode(a, b))),
        sheet: orderedObject(sheets)
    };
}
function mergeEngines(states: readonly ConfluenceState[], conflicts: Row[]): string {
    const views = orderedObject(states.map(state => [state.line, engineView(state)]));
    if (differs(values(views)))
        conflicts.push(conflict('engine_state', 'engines', 'snapshot', views));
    return string(states[0].line);
}
function alive(sheet: Row): boolean {
    const hp = sheet.current_hp;
    if ((integer(hp) || typeof hp === 'boolean') && number(hp) < 0)
        return false;
    return !array(sheet.conditions).some(condition => normalize(string(condition)) === 'dead');
}
function mergeBelongings(id: string, sheets: Map<string, Row>, base: Row, conflicts: Row[], spentByLine: Map<string, ReadonlySet<string>>): void {
    const held = new Map<string, Map<string, any>>();
    for (const [line, sheet] of sheets)
        for (const item of array(sheet.equipment)) {
            const name = isJsonObject(item) ? item.name : item;
            if (!truth(name))
                continue;
            const key = normalize(string(name));
            const byLine = held.get(key) ?? new Map();
            byLine.set(line, item);
            held.set(key, byLine);
        }
    const equipment: any[] = [];
    for (const key of sorted(held.keys())) {
        const byLine = held.get(key)!;
        const spent = sorted([...sheets.keys()].filter(line => !byLine.has(line) && spentByLine.get(line)!.has(spentItemKey(id, key))));
        if (spent.length)
            conflicts.push(conflict('consumed', id, key, orderedObject([...byLine.keys()].map(line => [line, 'held'] as [
                string,
                string
            ]).concat(spent.map(line => [line, 'spent'] as [
                string,
                string
            ])))));
        equipment.push(clone(byLine.values().next().value));
    }
    base.equipment = equipment;
    const weapons = new Map<string, Row>();
    for (const sheet of sheets.values())
        for (const weapon of array(sheet.weapons))
            if (isJsonObject(weapon)) {
                const key = normalize(string(weapon.name || weapon.weapon_id || ''));
                if (!weapons.has(key))
                    weapons.set(key, weapon);
            }
    base.weapons = sorted(weapons.keys()).filter(Boolean).map(key => clone(weapons.get(key)));
    base.conditions = sorted(new Set([...sheets.values()].flatMap(sheet => array(sheet.conditions).map(string))));
}
function mergeParty(states: readonly ConfluenceState[], conflicts: Row[]): Row {
    const spent = new Map(states.map(state => [state.line, state.spent ?? new Set<string>()]));
    const ids: string[] = [];
    for (const state of states)
        for (const id of sorted(Object.keys(state.party)))
            if (!ids.includes(id))
                ids.push(id);
    return orderedObject(ids.map(id => {
        const sheets = new Map(states.filter(state => Object.hasOwn(state.party, id)).map(state => [state.line, state.party[id]]));
        const base = clone(sheets.values().next().value);
        const luck = orderedObject([...sheets].map(([line, sheet]) => [line, sheet.current_luck ?? null]));
        if (differs(values(luck)))
            conflicts.push(conflict('numeric', id, 'luck', luck, {
                sheet_field: 'current_luck'
            }));
        const life = orderedObject([...sheets].map(([line, sheet]) => [line, alive(sheet)]));
        if (new Set(values(life)).size > 1)
            conflicts.push(conflict('dead_alive', id, 'alive', life));
        mergeBelongings(id, sheets, base, conflicts, spent);
        return [id, base];
    }));
}
export function report(graph: ModuleGraph, states: readonly ConfluenceState[], into: string | null): Row {
    const scene = into || string(states[0].world.active_scene || '');
    const conflicts: Row[] = [];
    const world = mergeWorld(graph, states, scene, conflicts);
    const party = mergeParty(states, conflicts);
    const engineLine = mergeEngines(states, conflicts);
    conflicts.sort((a, b) => compareUnicode(string(a.id), string(b.id)));
    return {
        lines: states.map(state => state.line),
        into: scene,
        world,
        party,
        engine_line: engineLine,
        conflicts
    };
}
function modeOf(conflict: Row, given: any): Row {
    const allowed = DISPOSITIONS[string(conflict.class)];
    if (!isJsonObject(given) || !allowed.includes(string(given.mode)))
        throw new RpcError('invalid_params', `conflict ${conflict.id} cannot be settled that way`, {
            fix: `one of: ${allowed.join(', ')}`,
            details: {
                conflict: conflict.id,
                class: conflict.class,
                modes: [...allowed],
                given: isJsonObject(given) ? given.mode ?? null : given ?? null
            },
        });
    if (given.mode === 'from' && (typeof given.line !== 'string' || !Object.hasOwn(conflict.values, given.line)))
        throw new RpcError('invalid_params', `conflict ${conflict.id} has nothing from that line`, {
            fix: 'name one of details.lines',
            details: {
                conflict: conflict.id,
                lines: sorted(Object.keys(conflict.values)),
                given: given.line ?? null
            },
        });
    if (given.mode === 'drop' && !(typeof given.note === 'string' && given.note.trim()))
        throw new RpcError('invalid_params', `dropping ${conflict.id} must say why`, {
            fix: 'add a note the table can read later',
            details: {
                conflict: conflict.id
            }
        });
    return clone(given);
}
function resolveConflict(result: Row, conflict: Row, disposition: Row): void {
    const mode = string(disposition.mode);
    const kind = string(conflict.class);
    const choices = conflict.values;
    const subject = string(conflict.subject);
    const field = string(conflict.field);
    if (kind === 'numeric') {
        let chosen: any;
        if (mode === 'from')
            chosen = choices[disposition.line];
        else {
            const numbers = values(choices).filter(value => integer(value) || typeof value === 'boolean');
            if (!numbers.length)
                valueError(`${mode}() arg is an empty sequence`);
            chosen = numbers.reduce((current, value) => mode === 'min' ? value < current ? value : current : value > current ? value : current);
        }
        result.party[subject][string(conflict.sheet_field)] = chosen;
    }
    else if (kind === 'dead_alive') {
        const sheet = result.party[subject];
        const living = truth(choices[disposition.line]);
        const conditions = array(sheet.conditions).filter(condition => normalize(string(condition)) !== 'dead');
        sheet.conditions = living ? conditions : sorted(new Set([...conditions, 'dead']));
    }
    else if (kind === 'consumed') {
        if (mode === 'drop' || choices[disposition.line] === 'spent') {
            const sheet = result.party[subject];
            sheet.equipment = array(sheet.equipment).filter(item => normalize(string(isJsonObject(item) ? item.name : item)) !== field);
        }
    }
    else if (kind === 'flag')
        result.world.flags[subject] = choices[disposition.line];
    else if (kind === 'npc_presence') {
        const places = sorted(new Set(values(choices).map(string)));
        result.world.npc_presence[subject] = mode === 'from' ? string(choices[disposition.line]) : places.includes(result.world.active_scene) ? result.world.active_scene : places[0];
    }
    else if (kind === 'engine_state') {
        const line = string(disposition.line);
        result.engine_line = line;
        for (const [id, mirrored] of entries(row(choices[line]).sheet))
            if (isJsonObject(result.party[id]))
                Object.assign(result.party[id], mirrored);
    }
    else if (kind === 'mod_state')
        for (const [key, value] of entries(choices[disposition.line])) {
            if (value === null)
                delete result.world[key];
            else
                result.world[key] = clone(value);
        }
}
export function settle(result: Row, dispositions: Row): Row {
    const conflicts = new Map<string, Row>(array(result.conflicts).map(conflict => [string(conflict.id), conflict]));
    const unknown = sorted(Object.keys(dispositions).filter(key => !conflicts.has(key)));
    if (unknown.length)
        throw new RpcError('invalid_params', 'dispositions name conflicts this merge does not have', {
            fix: 'send back the ids from details.conflicts, unchanged',
            details: {
                unknown,
                conflicts: sorted(conflicts.keys())
            }
        });
    const undecided = sorted(conflicts.keys()).filter(key => !Object.hasOwn(dispositions, key)).map(key => conflicts.get(key)!);
    if (undecided.length)
        throw new RpcError('needs', 'this confluence has conflicts the keeper must settle', {
            fix: 'send params.dispositions with one entry per conflict id',
            details: {
                conflicts: undecided
            }
        });
    for (const key of sorted(conflicts.keys()))
        resolveConflict(result, conflicts.get(key)!, modeOf(conflicts.get(key)!, dispositions[key]));
    result.dispositions = orderedObject(sorted(Object.keys(dispositions)).map(key => [key, clone(dispositions[key])]));
    if (Object.hasOwn(result.world, 'objects'))
        for (const sheet of values(result.party))
            projectSheet(result.world, sheet);
    return result;
}
export function parseDispositions(given: any): Row {
    if (given == null)
        return {};
    if (!isJsonObject(given) || values(given).some(value => !isJsonObject(value)))
        throw new RpcError('invalid_params', 'dispositions must map a conflict id to a disposition', {
            fix: '{"conflict:numeric:...": {"mode": "max"}}',
            details: {
                dispositions: given
            }
        });
    return given;
}
