/** Authored and investigator weapon/participant projections used by combat and chase. */
import { isJsonObject } from '../json.js';
import { ModuleGraph, conditionStatus, recordOf } from '../read/module-graph.js';
import { array, clone, entries, integer, normalize, number, row, string, truth, type Row } from '../read/values.js';
import { RuleTables } from '../rules/tables.js';
import { caseFold } from '../rules/casefold.js';
import type { KernelContext } from '../context.js';
import { resolveModuleWeapons } from './catalog.js';
export class NpcProfileError extends Error {
    override name = 'NpcProfileError';
}
const intMap = (value: any): Row => Object.fromEntries(entries(value).filter(([, item]) => integer(item)).map(([key, item]) => [key, number(item)]));
export const npcProfile = (_graph: ModuleGraph, node: Row): Row | null => isJsonObject(row(recordOf(node).mechanics).profile) ? recordOf(node).mechanics.profile : null;
export function investigatorWeapons(sheet: Row): Row[] {
    const weapons = array(sheet.weapons).filter(weapon => isJsonObject(weapon) && truth(weapon.weapon_id)).map(clone);
    if (!weapons.some(weapon => weapon.weapon_id === 'unarmed'))
        weapons.push({ weapon_id: 'unarmed', name: 'unarmed' });
    return weapons;
}
export const weaponOptions = (sheet: Row): string[] => investigatorWeapons(sheet).map(weapon => string(weapon.name || weapon.weapon_id));
export async function resolveInvestigatorWeapon(tables: RuleTables, sheet: Row, query: string): Promise<Row | null> {
    let key = normalize(query);
    for (const prefix of ['weapon:', 'item:'])
        if (key.startsWith(prefix))
            key = key.slice(prefix.length);
    const catalog = await tables.exists('weapons') ? await tables.weaponsTable() : {};
    for (const weapon of investigatorWeapons(sheet)) {
        const id = string(weapon.weapon_id), entry = row(catalog[id]);
        const names = [normalize(id), normalize(string(weapon.name || '')), normalize(string(weapon.label || ''))];
        if (truth(entry.display_name))
            names.push(normalize(string(entry.display_name)));
        if (names.includes(key)) {
            const merged: Row = { ...entry, ...weapon, weapon_id: id };
            if (!Object.hasOwn(merged, 'damage') && truth(merged.damage_die))
                merged.damage = merged.damage_die;
            return merged;
        }
    }
    return null;
}
export async function sheetSkillValue(tables: RuleTables, sheet: Row, skill: string): Promise<number | null> {
    const key = normalize(skill);
    for (const [name, value] of entries(intMap(sheet.skills)))
        if (normalize(name) === key)
            return number(value);
    const table = await tables.exists('skills') ? await tables.skillsTable() : {};
    for (const [name, spec] of entries(table)) {
        if (normalize(name) !== key || !isJsonObject(spec))
            continue;
        if (spec.modern_only === true && caseFold(string(sheet.era || '').trim()) !== 'modern')
            return null;
        return integer(spec.base_chance) ? number(spec.base_chance) : null;
    }
    return null;
}
export async function investigatorCombatParticipant(tables: RuleTables, sheet: Row, weapon: Row | null): Promise<Row> {
    const characteristics = intMap(sheet.characteristics), skills = intMap(sheet.skills), derived = row(sheet.derived);
    const damage = await tables.damageBonusBuild(number(characteristics.STR ?? 50), number(characteristics.SIZ ?? 50));
    let firearms = Math.max(0, ...entries(skills).filter(([key]) => key.startsWith('Firearms')).map(([, value]) => number(value)));
    const weaponSkill = string(weapon?.skill || '');
    if (weaponSkill.startsWith('Firearms')) {
        const own = await sheetSkillValue(tables, sheet, weaponSkill);
        if (own !== null)
            firearms = own;
    }
    const hpMax = number(derived.HP || 10);
    return { actor_id: string(sheet.id), side: 'investigator', dex: number(characteristics.DEX ?? 50), combat_skill: number(skills['Fighting (Brawl)'] ?? 25),
        dodge_skill: number(skills.Dodge ?? Math.max(1, Math.floor(number(characteristics.DEX ?? 50) / 2))), firearms_skill: firearms,
        has_ready_firearm: !!weapon && weapon.magazine != null, build: number(derived.BUILD ?? damage.build), damage_bonus: string(derived.DB ?? damage.damage_bonus),
        hp_max: hpMax, hp_current: integer(sheet.current_hp) || typeof sheet.current_hp === 'boolean' ? number(sheet.current_hp) : hpMax,
        con: number(characteristics.CON ?? 50), magic_points: number(sheet.current_mp || derived.MP || 0), armor: 0, armor_rule: null,
        weapons: weapon ? [weapon] : [{ weapon_id: 'unarmed' }], conditions: array(sheet.conditions).map(string), mov: number(derived.MOV ?? 8) };
}
/**
 * An NPC's maximum hit points from whatever numbers the table has for them: the profile's own
 * derived HP when the book printed one, otherwise CoC 7e's `(CON + SIZ) / 10`, rounded down.
 *
 * One definition, because two engines now read it: the combat participant below, and the healing
 * patient of contract §66. A second copy would be a second rules answer, and they drift the first
 * time only one of them is corrected.
 */
export function profileHitPoints(profile: Row): number {
    const characteristics = intMap(profile.characteristics);
    return Math.max(1, number(row(profile.derived).HP ?? Math.floor((characteristics.CON + characteristics.SIZ) / 10)));
}
export async function npcCombatParticipant(tables: RuleTables, handle: string, profile: Row, side = 'npc'): Promise<Row> {
    const characteristics = intMap(profile.characteristics), missing = ['STR', 'SIZ', 'DEX', 'CON'].filter(key => !Object.hasOwn(characteristics, key));
    if (missing.length)
        throw new NpcProfileError(`${handle}: profile lacks characteristics ${missing.join(', ')}`);
    const skills = intMap(profile.skills), derived = row(profile.derived), damage = await tables.damageBonusBuild(characteristics.STR, characteristics.SIZ);
    const hp = profileHitPoints(profile);
    let weapons = array(profile.weapons).map(weapon => isJsonObject(weapon) ? clone(weapon) : { weapon_id: string(weapon) });
    if (!weapons.length)
        weapons = [{ weapon_id: 'unarmed' }];
    return { actor_id: handle, side, dex: characteristics.DEX, combat_skill: number(skills['Fighting (Brawl)'] ?? skills.Brawl ?? skills.Fighting ?? 25),
        dodge_skill: number(skills.Dodge ?? Math.max(1, Math.floor(characteristics.DEX / 2))),
        firearms_skill: Math.max(0, ...entries(skills).filter(([key]) => key.startsWith('Firearms')).map(([, value]) => number(value))),
        has_ready_firearm: truth(profile.has_ready_firearm), build: number(derived.Build ?? damage.build), damage_bonus: string(derived.DB ?? damage.damage_bonus),
        hp_max: Math.max(1, hp), hp_current: Math.max(1, number(profile.hp_current ?? hp)), con: characteristics.CON,
        magic_points: number(profile.current_mp ?? derived.MP ?? Math.floor(number(characteristics.POW) / 5)), armor: number(profile.armor || 0), armor_rule: profile.armor_rule ?? null,
        weapons, conditions: array(profile.conditions).map(string), mov: number(derived.MOV ?? 8) };
}
export async function moduleWeapons(tables: RuleTables, graph: ModuleGraph, extra: Row[] = []): Promise<Row[]> {
    const result: Row[] = [];
    if (await tables.exists(graph.moduleId))
        result.push(...array(row(await tables.load(graph.moduleId)).weapons).filter(weapon => isJsonObject(weapon) && truth(weapon.weapon_id)).map(clone));
    result.push(...extra.filter(weapon => isJsonObject(weapon) && truth(weapon.weapon_id)).map(clone));
    return result;
}
export function combatOperationFor(graph: ModuleGraph, scene: Row, npcHandle: string, weaponId: string | null): [
    string | null,
    Row
] {
    const matched: Array<[
        number,
        string,
        Row
    ]> = [];
    for (const affordance of array(recordOf(scene).affordances)) {
        const operation = row(affordance?.rules_operation);
        if (operation.kind !== 'combat_engagement' || string(row(operation.opponent).actor_id || '') !== npcHandle)
            continue;
        const fixed = operation.investigator_weapon_id;
        if (truth(fixed) && (!weaponId || string(fixed) !== weaponId))
            continue;
        matched.push([truth(fixed) ? 0 : 1, string(affordance.id), operation]);
    }
    matched.sort((a, b) => a[0] - b[0] || (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
    return matched.length ? [matched[0][1], matched[0][2]] : [null, {}];
}
/** §102: an enabled authored exit whose target owns this opponent's combat operation. The caller
 * refuses before opening a generic fight; state still changes only through the existing move verb. */
export function combatOperationDestinations(graph: ModuleGraph, world: Row, scene: Row, npcHandle: string, weaponId: string | null): Row[] {
    const result: Row[] = [];
    for (const exit of graph.sceneExits(scene)) {
        if (truth(exit.when) && conditionStatus(exit.when, world) !== true)
            continue;
        const destination = graph.sceneByHandle(string(exit.to));
        if (!destination)
            continue;
        const [affordance, operation] = combatOperationFor(graph, destination, npcHandle, weaponId);
        if (!affordance)
            continue;
        result.push({ scene: graph.handle(destination), name: graph.displayName(destination), affordance,
            module_rules_id: operation.module_rules_id ?? null, operation });
    }
    return result;
}
export async function moduleWeaponCatalog(context: KernelContext, graph: ModuleGraph): Promise<Map<string, Row>> {
    const tables = new RuleTables(context);
    return new Map(entries(await resolveModuleWeapons(tables, await moduleWeapons(tables, graph))));
}
