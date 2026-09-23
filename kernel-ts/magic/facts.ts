/** Read-only spell knowledge and source facts, prepared before synchronous graph checks. */
import { array, clone, entries, row, string, truth, values, type Row } from '../read/values.js';
import { recordOf, type ModuleGraph } from '../read/module-graph.js';
import type { SettleContext } from '../resolve/context.js';
import { Catalog } from '../rules/catalog.js';
import { canonicalSpellName } from './spells.js';
import { knownSpells, readMagicState } from './state.js';

export interface PreparedMagicFacts {
    readonly knownSpells: readonly string[];
    readonly learningSources: Row;
    readonly canonicalNames: ReadonlyMap<string, string>;
}
export function magicLearningSources(context: Pick<SettleContext, 'graph' | 'world' | 'npcProfile'>): Row {
    const sources: Row = {};
    for (const node of context.graph.kind('npc')) {
        const handle = context.graph.handle(node), spells = context.npcProfile(handle)?.spells;
        if (Array.isArray(spells) && spells.length) sources[`person:${handle}`] = spells.filter(value => typeof value === 'string');
    }
    for (const [owner, abilities] of entries(row(context.world.objects).abilities))
        sources[`person:${owner}`] = [...new Set([...array(sources[`person:${owner}`]), ...entries(abilities).map(([name]) => name)])];
    return Object.assign(sources, bookSpellSources(context.graph));
}
/**
 * The spells the book's tomes and creatures teach, keyed `tome:<handle>` / `entity:<handle>`: the node's legacy
 * `spells` names, then (a tome) the spell nodes `mechanics.tome.spells` names, each by the name the module's spell
 * catalog gives it (contract §136.16). One function for the learn binder and the rule layer's fact.
 */
export function bookSpellSources(graph: ModuleGraph): Row {
    const sources: Row = {};
    for (const [kind, prefix] of [['tome', 'tome'], ['creature', 'entity']]) {
        for (const node of graph.kind(kind)) {
            const legacy = truth(row(node.properties).spells) ? node.properties.spells : recordOf(node).spells;
            const names = Array.isArray(legacy) ? legacy.filter(value => typeof value === 'string') : [];
            for (const id of array(row(graph.mechanicsOf(node).tome).spells)) {
                const spell = typeof id === 'string' ? graph.nodes.get(id) : undefined;
                const name = spell?.node_kind === 'spell' ? string(spell.name || graph.handle(spell)) : '';
                if (name && !names.includes(name)) names.push(name);
            }
            if (names.length || Array.isArray(legacy) && legacy.length) sources[`${prefix}:${graph.handle(node)}`] = names;
        }
    }
    return sources;
}
export async function prepareMagicFacts(context: SettleContext): Promise<PreparedMagicFacts> {
    const known = knownSpells(await readMagicState(context, context.subjectId), context.clockMinutes), sources = magicLearningSources(context);
    const catalog = new Catalog(context.tables), canonical = new Map<string, string>();
    const names = [string(context.action.spell || ''), ...known, ...values(sources).flatMap(array).map(string)];
    for (const raw of names) {
        const name = raw.trim();
        if (canonical.has(name)) continue;
        const resolved = await canonicalSpellName(context.tables, catalog, name, context.moduleSpells);
        canonical.set(name, resolved); canonical.set(resolved, resolved);
    }
    return Object.freeze({ knownSpells: Object.freeze(known), learningSources: sources, canonicalNames: canonical });
}
export function preparedSpellName(prepared: PreparedMagicFacts, name: any): string {
    const value = typeof name === 'string' ? name.trim() : '';
    return prepared.canonicalNames.get(value) ?? value;
}
export function augmentMagicFacts(prepared: PreparedMagicFacts, selected: Row | null, facts: Row): Row {
    const output = clone(facts), semantic = row(selected?.semantic_inputs), spell = preparedSpellName(prepared, string(semantic.spell || '').trim());
    const known = new Set(array(output['magic.known_spells']).map(value => preparedSpellName(prepared, string(value))));
    output['magic.spell.known'] = !!spell && known.has(spell);
    const sourceRef = string(semantic.source_ref || '').trim(), sourceKind = string(semantic.source || '').trim(), sources = row(output['magic.learn.sources']);
    const sourceSpells = array(sources[sourceRef]);
    output['magic.learn.source-available'] = spell && sourceRef
        ? sourceRef.startsWith(sourceKind + ':') && new Set(sourceSpells.map(value => preparedSpellName(prepared, string(value)))).has(spell)
        : values(sources).some(value => Array.isArray(value) && value.length > 0);
    return output;
}
export function provisionalMagicSemantic(context: Pick<SettleContext, 'action' | 'graph'>, prepared: PreparedMagicFacts, target?: string | null): Row {
    const semantic: Row = {}, spell = context.action.spell;
    if (typeof spell !== 'string' || !spell.trim()) return semantic;
    semantic.spell = preparedSpellName(prepared, spell);
    const sources = prepared.learningSources;
    let sourceRef: string | undefined;
    if (target) {
        const node = context.graph.find(target);
        if (node) { const handle = context.graph.handle(node); sourceRef = entries(sources).find(([ref]) => ref.slice(ref.indexOf(':') + 1) === handle)?.[0]; }
    }
    if (!sourceRef) {
        const matches = entries(sources).filter(([, spells]) => new Set(array(spells).map(value => preparedSpellName(prepared, string(value)))).has(semantic.spell));
        if (matches.length === 1) sourceRef = matches[0][0];
    }
    if (sourceRef) { semantic.source_ref = sourceRef; semantic.source = sourceRef.split(':', 1)[0]; }
    return semantic;
}
