/** Resolve spells through the existing catalog, keeping authored source authority. */
import { isJsonObject } from '../json.js';
import { array, row, string, truth, repr, type Row } from '../read/values.js';
import { Catalog, demotedModuleBlock, moduleRecordNamed } from '../rules/catalog.js';
import { caseFold } from '../rules/casefold.js';
import type { RuleTables } from '../rules/tables.js';

export class UnpricedSpellError extends Error {
    readonly missing: string[];
    constructor(readonly spell: string, readonly nodeId: string, missing: string[]) {
        super(`${repr(spell)} is authored by the module as ${nodeId} without ${missing.join(' and ')}; casting cannot be priced from it. Author the missing cost field(s) on the node, or adjudicate the cast outside the magic runtime -- a missing cost is not a zero cost.`);
        this.name = 'UnpricedSpellError'; this.missing = [...missing];
    }
}
const unknownSpell = (name: any): never => { const error = new Error(repr(`unknown spell: ${repr(name)}`)); error.name = 'KeyError'; throw error; };
function moduleSpellEntry(record: Row, authored: Row): Row {
    const costs = row(authored.costs);
    return { name: string(record.name || ''), description: string(authored.summary || ''), module_node_id: string(authored.node_id || ''),
        module_id: string(authored.module_id || ''), costs_authored: truth(costs.authored), unpriced_fields: [...array(costs.missing)], ...row(costs.fields) };
}
export async function resolveSpellName(tables: RuleTables, catalog: Catalog, name: any, moduleSpells: Row[] = []): Promise<Row> {
    if (typeof name !== 'string' || !name.trim()) return unknownSpell(name);
    name = name.trim();
    const spells = array((await tables.spellsTable()).spells);
    for (const spell of spells) {
        if (!isJsonObject(spell) || string(spell.name || '').toLowerCase() !== name.toLowerCase()) continue;
        const record = moduleRecordNamed(moduleSpells, name);
        return { canonical_name: string(spell.name), entry: spell, parameterisation: null, module_authored: record ? demotedModuleBlock(record) : null };
    }
    for (const record of moduleSpells) {
        const definition = record.generated_definition;
        if (isJsonObject(definition) && caseFold(definition.name as string) === caseFold(name))
            return { canonical_name: definition.name, entry: { ...(definition.parameters as Row), name: definition.name, description: definition.description,
                generated_definition: definition }, parameterisation: null, module_authored: null };
    }
    const resolved = await catalog.resolveName('spell', name, moduleSpells), parameter = resolved?.parameterisation;
    if (truth(parameter)) {
        const family = string(parameter.family_name || '');
        for (const spell of spells) if (isJsonObject(spell) && string(spell.name || '') === family)
            return { canonical_name: string(resolved!.canonical_name), entry: spell, parameterisation: { ...parameter }, module_authored: null };
    }
    const authored = resolved?.module_authored;
    if (isJsonObject(authored) && authored.authority === 'module_authored_spell')
        return { canonical_name: string(resolved!.canonical_name), entry: moduleSpellEntry(row(resolved!.record), authored), parameterisation: null, module_authored: authored };
    return unknownSpell(name);
}
export async function canonicalSpellName(tables: RuleTables, catalog: Catalog, name: any, moduleSpells: Row[] = []): Promise<string> {
    try { return (await resolveSpellName(tables, catalog, name, moduleSpells)).canonical_name; }
    catch (error) { if ((error as Error).name !== 'KeyError') throw error; return typeof name === 'string' ? name.trim() : ''; }
}
export async function spellByName(tables: RuleTables, catalog: Catalog, name: any, moduleSpells: Row[] = []): Promise<Row> {
    return (await resolveSpellName(tables, catalog, name, moduleSpells)).entry;
}
export async function spellCandidates(catalog: Catalog, name: string, moduleSpells: Row[] = []): Promise<string[]> {
    const result = await catalog.search(name || 'spell', { kinds: ['spell'], limit: 8, moduleSpells });
    return result.ok ? array(result.candidates).map(candidate => string(candidate.name)) : [];
}
