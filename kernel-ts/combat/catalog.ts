/** The captured rulebook weapon catalog and its existing module overlays. */
import { isJsonObject, orderedObject } from '../json.js';
import { array, clone, entries, number, repr, row, string, truth, type Row } from '../read/values.js';
import type { RuleTables } from '../rules/tables.js';
export class UnknownWeaponError extends Error {
    override name = 'UnknownWeaponError';
    constructor(readonly weaponId: string) { super(`unknown_weapon: ${repr(weaponId)}`); }
}
export function deriveReloadFields(entry: Row): void {
    const magazine = entry.magazine, skill = string(entry.skill || '');
    if (magazine == null) {
        for (const key of ['reload_rounds', 'reload_kind', 'ammo_per_reload_round'])
            if (!Object.hasOwn(entry, key))
                entry[key] = null;
        return;
    }
    const machineGun = skill.includes('Machine Gun') || skill.endsWith('(MG)') || skill.includes('Machine gun');
    if (entry.reload_rounds == null)
        entry.reload_rounds = machineGun ? 2 : 1;
    if (entry.reload_kind == null)
        entry.reload_kind = machineGun ? 'belt' : number(magazine) > 2 ? 'clip' : 'shells';
    if (entry.ammo_per_reload_round == null)
        entry.ammo_per_reload_round = ['clip', 'belt'].includes(entry.reload_kind) ? Math.trunc(number(magazine)) : 2;
}
export async function loadWeaponCatalog(tables: RuleTables): Promise<Row> {
    const data = await tables.exists('weapons') ? row(await tables.load('weapons')) : {};
    return orderedObject(entries(data.weapons).map(([id, value]) => {
        const entry = clone(row(value));
        if (!Object.hasOwn(entry, 'damage') && Object.hasOwn(entry, 'damage_die'))
            entry.damage = entry.damage_die;
        deriveReloadFields(entry);
        return [id, entry];
    }));
}
export async function resolveModuleWeapons(tables: RuleTables, moduleWeapons: Row[] | null, catalog: Row | null = null): Promise<Row> {
    const base = truth(catalog) ? { ...catalog } : await loadWeaponCatalog(tables);
    if (!moduleWeapons?.length)
        return base;
    const merged: Row = {};
    for (const weapon of moduleWeapons) {
        if (!isJsonObject(weapon))
            continue;
        const parent = weapon.extends, entry: Row = truth(parent) && Object.hasOwn(base, string(parent)) ? { ...base[string(parent)] } : {};
        delete entry.weapon_id;
        for (const [key, value] of entries(weapon))
            if (key !== 'extends')
                entry[key] = value;
        const id = entry.weapon_id || parent;
        if (truth(id)) {
            entry.weapon_id = id;
            merged[string(id)] = entry;
        }
    }
    for (const [id, entry] of entries(base))
        if (!Object.hasOwn(merged, id))
            merged[id] = entry;
    return merged;
}
export function parseUsesPerRound(text: string | null = null): Row {
    const raw = (text || '1').trim(), lower = raw.toLowerCase(), allows = lower.includes('full auto');
    const fraction = /^(\d+)\s*\/\s*(\d+)$/.exec(raw);
    if (fraction)
        return { max_shots: Math.max(1, Number(fraction[1])), allows_full_auto: allows, rounds_per_use: Math.max(1, Number(fraction[2])) };
    if (allows && /^full\s*auto$/.test(lower))
        return { max_shots: 0, allows_full_auto: true, rounds_per_use: 1 };
    const parenthesized = /\((\d+)\)/.exec(raw), digits = [...raw.matchAll(/\d+/g)].map(match => Number(match[0]));
    const shots = parenthesized ? Number(parenthesized[1]) : digits.length ? Math.max(...digits) : allows ? 0 : 1;
    return { max_shots: shots, allows_full_auto: allows, rounds_per_use: 1 };
}
export const fullAutoVolleySize = (skill: number): number => Math.max(3, Math.floor(Math.trunc(skill) / 10));
