/** Mirror already accepted objects into existing sheets/snapshots; never mutate objects. */
import { isJsonObject } from '../json.js';
import { RpcError } from '../errors.js';
import { publicItems } from '../read/mods.js';
import { array, row, values, string, truth, normalize, type Row } from '../read/values.js';
import type { CampaignWriter } from '../write/store.js';
export { usableWeapon, syncAmmo } from './combat-projection.js';

export function weaponRows(world: Row, ownerId: string | null = null): Row[] {
  const data = row(world.objects), definitions = row(data.definitions), result: Row[] = [];
  for (const item of values(data.instances)) {
    const definition = definitions[item.definition];
    if (definition.category !== 'weapon' || ownerId !== null && item.owner.id !== ownerId) continue;
    result.push({...definition.parameters, weapon_id: item.id, name: item.name, display_name: item.name, ammo: item.state.ammo ?? null,
      object_id: item.id, uses_per_round: string(definition.parameters.uses_per_round),
      impales: Object.hasOwn(definition.parameters, 'impale') ? definition.parameters.impale : false,
      adds_damage_bonus: Object.hasOwn(definition.parameters, 'adds_damage_bonus') ? definition.parameters.adds_damage_bonus : false});
  }
  return result;
}
export function projectSheet(world: Row, sheet: Row): void {
  sheet.weapons = array(sheet.weapons).filter(item => !isJsonObject(item) || !truth(item.object_id));
  sheet.weapons.push(...weaponRows(world, sheet.id));
  sheet.equipment = array(sheet.equipment).filter(item => !isJsonObject(item) || !truth(item.object_id));
  const records = row(row(world.objects).instances), instances = values(records);
  for (const item of publicItems(world, sheet.id)) {
    const matches = Object.hasOwn(records, item.name) ? [records[item.name]] : instances.filter(instance => normalize(instance.name) === normalize(item.name));
    if (matches.length > 1) throw new RpcError('unknown_entity', 'Object name is ambiguous', {details: {candidates: matches.map(value => value.name)}});
    const physical = matches[0];
    if (!physical) throw new Error('Accepted object projection has no matching instance');
    sheet.equipment.push({name: item.name, quantity: item.quantity, object_id: physical.id, description: item.description});
  }
}
export async function projectInventory(campaign: CampaignWriter, world: Row): Promise<void> {
  for (const sheet of await campaign.party()) { projectSheet(world, sheet); await campaign.writeSheet(sheet); }
  if (!await campaign.context.snapshots.pathExists(campaign.path('save/combat.json'))) return;
  const snapshot = await campaign.read('save/combat.json');
  if (snapshot.status !== 'active') return;
  for (const actor of array(snapshot.participants)) {
    const prior = array(actor.weapons).filter(item => !isJsonObject(item) || !truth(item.object_id)), extra = weaponRows(world, actor.actor_id);
    actor.weapons = [...prior, ...extra];
    for (const weapon of extra) {
      (snapshot.weapon_catalog ??= {})[weapon.weapon_id] = weapon;
      if (weapon.ammo !== null) (actor._ammo ??= {})[weapon.weapon_id] = weapon.ammo;
    }
  }
  await campaign.write('save/combat.json', snapshot);
}
