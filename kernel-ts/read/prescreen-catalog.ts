/** Ephemeral read descriptors from an already loaded snapshot; no bodies, IO or state changes. */
import type { ModuleGraph } from './module-graph.js';
import type { RuleObservations } from './rule-facts.js';
import { normalize, row, sorted, values, type Row } from './values.js';

const KINDS = ['investigator', 'npc', 'object', 'catalog', 'rule', 'memory', 'session'] as const;
type Kind = typeof KINDS[number];
type Candidate = {key: string; kind: Kind; label: string; summary: string;
    method: 'table.look' | 'table.lookup' | 'table.recall'; params: Row};
const nameOf = (value: unknown): string => typeof value === 'string' && value.trim() ? value : '';

export function prescreenCatalog(input: {party: readonly Row[]; world: Row; graph: ModuleGraph;
    present: readonly Row[]; rules?: Pick<RuleObservations, 'nodes'>}): {version: 1; candidates: Candidate[]; omitted: number} {
    const groups = new Map<Kind, Candidate[]>(KINDS.map(kind => [kind, []]));
    const add = (kind: Kind, name: string, label: string, summary: string, method: Candidate['method'], params: Row) => {
        groups.get(kind)!.push({key: JSON.stringify([kind, name]), kind, label, summary, method, params});
    };
    const names = (rows: readonly Row[]) => sorted(new Set(rows.map(value => nameOf(value.name)).filter(Boolean)));
    for (const name of names(input.party))
        add('investigator', name, name, 'Current party investigator sheet.', 'table.look', {focus: 'investigator', name});

    const present = new Set(input.present.map(person => normalize(person.name)));
    const npcs = new Map<string, boolean>();
    for (const node of input.graph.kind('npc')) {
        const name = nameOf(node.name);
        if (name) npcs.set(name, Boolean(npcs.get(name)) || input.graph.nameKeys(node).some(key => present.has(normalize(key))));
    }
    const npcNames = sorted(npcs.keys());
    for (const name of [...npcNames.filter(name => npcs.get(name)), ...npcNames.filter(name => !npcs.get(name))])
        add('npc', name, name, npcs.get(name) ? 'Named NPC currently present.' : 'Named module NPC; not marked present.',
            'table.look', {focus: 'npc', name});

    const objects = row(input.world.objects), seen = new Set<string>(), itemNames: string[] = [];
    // Instances win a name collision, matching objectLook; a definition never implies possession.
    for (const [source, label] of [['instances', 'Registered instance'], ['definitions', 'Definition only']] as const) {
        for (const name of names(values(objects[source]))) {
            const identity = normalize(name);
            if (seen.has(identity)) continue;
            seen.add(identity); itemNames.push(name);
            add('object', name, `${name} (${label})`, 'Registered object detail; registration does not imply party ownership.',
                'table.look', {focus: 'object', name});
        }
    }
    groups.get('object')!.sort((a, b) => a.params.name < b.params.name ? -1 : a.params.name > b.params.name ? 1 : 0);
    for (const name of sorted(itemNames))
        add('catalog', name, name, 'Printed catalog search for this known item name; a matching entry is not guaranteed.',
            'table.lookup', {kind: 'catalog', query: name});

    const families = new Map<string, Set<string>>();
    for (const node of input.rules?.nodes.values() ?? []) {
        if (node.node_kind !== 'rule') continue;
        const family = nameOf(row(node.properties).family_id);
        if (!family) continue;
        const members = families.get(family) ?? new Set<string>(), name = nameOf(node.name);
        if (name) members.add(name);
        families.set(family, members);
    }
    for (const family of sorted(families.keys()))
        add('rule', family, family, `Rule family. Indexed rules: ${sorted(families.get(family)!).slice(0, 4).join('; ')}`,
            'table.lookup', {kind: 'rule', query: family});
    add('memory', 'memory', 'Memory reports', 'Current memory reports, not independent world truth.',
        'table.recall', {what: 'memory', limit: 8});
    add('session', 'session', 'Active session', 'Current structured session and pending choice.',
        'table.look', {focus: 'session'});

    const total = [...groups.values()].reduce((sum, group) => sum + group.length, 0), candidates: Candidate[] = [];
    for (let index = 0; candidates.length < Math.min(64, total); index++) {
        for (const kind of KINDS) {
            const candidate = groups.get(kind)![index];
            if (candidate && candidates.length < 64) candidates.push(candidate);
        }
    }
    return {version: 1, candidates, omitted: total - candidates.length};
}
