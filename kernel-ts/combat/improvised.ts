/**
 * Contract §224.7: improvised weapons are the Enhanced Items Mod's (user ruling 2026-10-11, quoted there; kernel sources stay English, §16.1).
 * A package that requires `weapons.improvised.v1` turns the path on for the campaigns that lock it; without one, a declared
 * first blow with an unprepared held object keeps §159.10.1's preparation and `action.improvised` is not a resolve input.
 * Keeper Rulebook, Improvised Weapons p.104: the Keeper compares the object with the weapons table and rolls the fitting row.
 */
import { array, normalize, repr, row, string, truth, values, type Row } from '../read/values.js';
import { RuleTables } from '../rules/tables.js';
import { RpcError } from '../errors.js';
import { weaponBandOptions, weaponRowNamed } from '../rules/bands.js';
import { moduleDeclaration, type ModuleGraph } from '../read/module-graph.js';
import { weaponOptions } from './profiles.js';
export const IMPROVISED_WEAPON_CAPABILITY = 'weapons.improvised.v1';
/** Whether one of the campaign's active packages (`activeMods`) requires the capability. */
export function improvisedWeaponsEnabled(active: Row[]): boolean {
    return active.some(mod => array(mod.requires).includes(IMPROVISED_WEAPON_CAPABILITY));
}
/** The refusal of `action.improvised` on a table where no active package requires the capability. */
export function improvisedWeaponsInactive(): RpcError {
    return new RpcError('invalid_params', `action.improvised needs an enabled package that requires ${IMPROVISED_WEAPON_CAPABILITY} (Enhanced Items 1.3.5)`, {
        fix: 'prepare the held object\'s attack usage with apply usage, attack with a weapon the investigator carries, or attack unarmed',
        details: { reason: 'unsupported_capability', required: [IMPROVISED_WEAPON_CAPABILITY] } });
}
/**
 * §224.7 rule 1: the weapons-table rows the unprepared held objects of a first blow may be rolled as this turn -- the era's
 * rows, their profiles, and each object's lexically closest ids -- the kernel's closed options for the host's comparison.
 * The same reading as the `needs {field: "weapon"}` refusal and the preset offer (`weaponBandOptions`, §138.6/§138.7).
 * `undefined` when nothing is unprepared.
 */
export async function improvisedOffer(tables: RuleTables, graph: ModuleGraph, sheet: Row, unprepared: string[]): Promise<Row | undefined> {
    if (!unprepared.length) return undefined;
    const table = await tables.exists('weapons') ? await tables.weaponsTable() : {};
    const era = string(sheet.era || moduleDeclaration(graph.moduleNode).era || '');
    const offers = unprepared.map(name => weaponBandOptions(Object.entries(table), era, name));
    return { options: offers[0].options, profiles: offers[0].profiles, close: Object.fromEntries(unprepared.map((name, index) => [name, offers[index].close])) };
}
/**
 * §224.7 rule 3: a held object the investigator attacks with before its own attack usage is prepared, rolled as the
 * weapons-table row it most resembles. The row is the host's (Jev's) comparison, named in `action.improvised`; the object
 * must be in the investigator's hands -- an equipment row of the sheet or a managed object instance they own -- and the row
 * must be one of the rules table's. The engine row keeps the table's numbers under the table's id and says which object it
 * stands in for (`improvised_object`), so every receipt stays honest. Nothing is written to the sheet: once the object's
 * usage lands, the ordinary binding takes over.
 */
export async function improvisedWeapon(tables: RuleTables, world: Row, sheet: Row, object: string, improvised: string): Promise<Row> {
    const name = normalize(object);
    const equipment = array(sheet.equipment).some(item => normalize(typeof item === 'string' ? item : string(row(item).name)) === name);
    const instance = values(row(row(world.objects).instances)).filter(item => normalize(string(item.name)) === name);
    if (instance.length > 1)
        throw new RpcError('unknown_entity', 'Object name is ambiguous', { details: { candidates: instance.map(item => item.name) } });
    if (!equipment && !(instance.length === 1 && string(row(instance[0].owner).id) === string(sheet.id)))
        throw new RpcError('needs', `${repr(object)} is not in the investigator's hands`, {
            fix: 'an improvised weapon is an object the investigator holds: name a held item in action.weapon, or attack unarmed',
            details: { needs: { field: 'weapon', options: weaponOptions(sheet) } } });
    const table = await tables.exists('weapons') ? await tables.weaponsTable() : {};
    const entry = weaponRowNamed(Object.entries(table), improvised);
    if (!entry)
        throw new RpcError('needs', `${repr(improvised)} is not a row of the weapons table`, {
            fix: 'set action.improvised to the weapons-table row (its id or display name) the held object most resembles',
            details: { needs: { field: 'improvised', options: Object.keys(table), source: 'content/rulesets/coc7/rules-json/weapons.json' } } });
    const merged: Row = { ...entry, name: object, display_name: object, improvised_object: object, improvised_profile: string(entry.display_name || entry.weapon_id) };
    if (!Object.hasOwn(merged, 'damage') && truth(merged.damage_die))
        merged.damage = merged.damage_die;
    return merged;
}
