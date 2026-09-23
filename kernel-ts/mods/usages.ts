/** Immutable, instance-bound ways to use physical objects; no model calls or I/O. */
import {RpcError} from '../errors.js';
import {isJsonObject, jsonDigest} from '../json.js';
import {clone, equal, normalize, row, string, truth, values, type Row} from '../read/values.js';
import {validateDefinition} from './definition.js';
import {queuedDefinition} from './queue.js';

export const USAGE_CAPABILITY = 'objects.usages.v1';
const fail = (message: string, details: Row = {}): never => { throw new RpcError('invalid_params', message, {details}); };
const bounded = (value: any, limit: number) => typeof value === 'string' && value.trim().length > 0 && value.length <= limit;
export function usageObject(world: Row, name: any): Row | null {
    if (typeof name !== 'string') return null;
    const instances = row(row(world.objects).instances);
    if (Object.hasOwn(instances, name)) return instances[name];
    const matches = values(instances).filter(item => normalize(string(item.name)) === normalize(name));
    if (matches.length > 1) throw new RpcError('unknown_entity', 'Object name is ambiguous', {details:{candidates:matches.map(item => item.name)}});
    return matches[0] ?? null;
}
export function usagePhysicalBasis(world: Row, name: string | Row): Row {
    const item = typeof name === 'string' ? usageObject(world, name) : name;
    if (!item){const waiting=queuedDefinition(world,name);throw new RpcError('needs',waiting
        ? 'This object is owned, but its executable definition is still being prepared'
        : 'Place or adopt this object before preparing its usage',{details:{reason:waiting?'definition_pending':'object_unplaced'}});}
    const definition = row(row(row(world.objects).definitions)[item.definition]);
    return {object_id:item.id, definition:item.definition, definition_digest:definition.digest ?? jsonDigest(definition), condition:item.state.condition, capability:USAGE_CAPABILITY};
}
export function validateUsage(raw: any, options: {name?: string | null} = {}): Row {
    if (isJsonObject(raw) && raw.error) return validateDefinition(raw);
    if (!isJsonObject(raw) || Object.keys(raw).some(key => !['name','description','basis','mode','parameters','player_view'].includes(key)))
        return fail('Usage needs name, description, basis, mode, parameters and player_view');
    if (!['melee','thrown','firearm'].includes(string(raw.mode))) return fail('Usage mode must be melee, thrown or firearm');
    if (!isJsonObject(raw.parameters) || Object.hasOwn(raw.parameters,'initial_ammo')) return fail('Usage parameters cannot initialize ammunition or other instance state');
    if (typeof raw.parameters.adds_damage_bonus !== 'boolean') return fail('Usage must explicitly declare adds_damage_bonus');
    if (options.name != null && normalize(string(raw.name)) !== normalize(options.name)) return fail('Usage identity differs from its request');
    const {mode, ...definition} = raw;
    const checked = validateDefinition({...definition, category:'weapon'});
    const skill = string(checked.parameters.skill);
    if (mode === 'thrown' ? !skill.startsWith('Throw') : mode === 'firearm' ? !skill.startsWith('Firearms') : !skill.startsWith('Fighting'))
        return fail('Usage mode and rulebook attack skill must agree');
    if (mode !== 'firearm' && checked.parameters.magazine != null) return fail('A non-firearm usage cannot spend or initialize ammunition');
    return {...raw, name:checked.name, description:checked.description, basis:checked.basis, parameters:checked.parameters, player_view:checked.player_view};
}
export function validateUsageRequest(input: any): Row {
    if (!isJsonObject(input) || !bounded(input.object,120) || !bounded(input.name,120) || !bounded(input.description,8000))
        return fail('Usage request needs bounded object, name and description');
    return {object:input.object, name:input.name, description:input.description};
}
export function validateUsageProposal(input: any): Row {
    if (!isJsonObject(input) || !bounded(input.object,120) || input.propose !== true
        || Object.keys(input).some(key => !['object','propose'].includes(key)))
        return fail('Usage proposal needs only a bounded object and propose: true');
    return {object:input.object, propose:true};
}
const records = (world: Row, item: Row) => values(row(row(world.objects).usages)).filter(usage => usage.object_id === item.id);
const fresh = (world: Row, item: Row, usage: Row) => equal(usage.physical_basis, usagePhysicalBasis(world,item));
export function findAcceptedUsage(world: Row, name: string | Row, usageName: string): Row | null {
    const item = typeof name === 'string' ? usageObject(world,name) : name;
    if (!item) return null;
    return records(world,item).find(usage => normalize(string(usage.name)) === normalize(usageName) && fresh(world,item,usage)) ?? null;
}
export function registerUsage(world: Row, objectName: string, raw: Row, physicalBasis: Row, provenance: Row): Row {
    const item = usageObject(world,objectName);
    if (!item) throw new RpcError('needs', 'Place or adopt this object before registering its usage');
    if (!equal(usagePhysicalBasis(world,item),physicalBasis)) throw new RpcError('needs', 'The object physical state changed while its usage was prepared', {details:{reason:'usage_stale'}});
    if (item.quantity !== 1) return fail('An attack usage needs one unambiguous physical object');
    const value = validateUsage(raw), prior = findAcceptedUsage(world,item,string(value.name)), digest = jsonDigest(value);
    if (value.mode === 'firearm') {
        if (['jammed','broken'].includes(item.state.condition)) return fail('A jammed or broken firearm cannot acquire a firing usage without repair');
        const original = row(row(row(world.objects).definitions)[item.definition]);
        if (item.state.ammo == null || value.parameters.magazine == null || !equal(value.parameters.magazine,row(original.parameters).magazine))
            return fail('A firing usage must preserve the existing physical ammunition capacity and state');
    }
    if (prior) {
        if (prior.digest !== digest) return fail('An accepted usage is immutable; keep the already accepted parameters');
        return prior;
    }
    const id = `usage-${jsonDigest([item.id,normalize(string(value.name)),physicalBasis]).slice(0,24)}`;
    const result = {...clone(value), id, object_id:item.id, version:1, digest, physical_basis:clone(physicalBasis), provenance:clone(provenance)};
    (world.objects.usages ??= {})[id] = result;
    return result;
}
function weaponRow(item: Row, usage: Row): Row {
    const parameters = row(usage.parameters);
    return {...parameters, weapon_id:usage.id, object_id:item.id, usage_id:usage.id, usage:usage.name, usage_mode:usage.mode,
        name:item.name, display_name:item.name, ammo:item.state.ammo ?? null,
        uses_per_round:string(parameters.uses_per_round), impales:parameters.impale ?? false, adds_damage_bonus:parameters.adds_damage_bonus ?? false};
}
function legacyWeapon(world: Row, item: Row): Row | null {
    const definition = row(row(row(world.objects).definitions)[item.definition]), parameters = row(definition.parameters);
    // Old saves already hold a complete executable profile. Reading it must not migrate or regenerate it.
    if (!truth(parameters.skill) || !truth(parameters.damage)) return null;
    if (['jammed','broken'].includes(item.state.condition)) return null;
    return {...parameters, weapon_id:item.id, object_id:item.id, name:item.name, display_name:item.name, ammo:item.state.ammo ?? null,
        uses_per_round:string(parameters.uses_per_round), impales:parameters.impale ?? false, adds_damage_bonus:parameters.adds_damage_bonus ?? false};
}
export function usageWeaponRows(world: Row, ownerId: string | null = null): Row[] {
    const result: Row[] = [];
    for (const item of values(row(row(world.objects).instances))) {
        if (ownerId !== null && item.owner.id !== ownerId) continue;
        const legacy = legacyWeapon(world,item);
        if (legacy) result.push(legacy);
        for (const usage of records(world,item)) if (fresh(world,item,usage)) result.push(weaponRow(item,usage));
    }
    return result;
}
export function selectObjectWeapon(world: Row, name: string, usageName?: string | null, ownerId?: string): Row | null {
    const addressed = row(row(row(world.objects).usages)[name]);
    const item = usageObject(world,truth(addressed.object_id) ? addressed.object_id : name);
    if (truth(addressed.name) && !usageName) usageName = addressed.name;
    if (!item) {
        if (usageName) throw new RpcError('needs', 'Usage must name a registered physical object');
        return null;
    }
    if (ownerId !== undefined && item.owner.id !== ownerId) throw new RpcError('needs', 'The acting person does not carry this object; take it from its current owner/container first');
    const candidates = usageWeaponRows(world).filter(weapon => weapon.object_id === item.id);
    if (usageName) {
        const matches = candidates.filter(weapon => normalize(string(weapon.usage ?? 'default')) === normalize(usageName));
        if (matches.length === 1) return matches[0];
    } else if (candidates.length === 1) return candidates[0];
    const options = candidates.map(weapon => weapon.usage ?? 'default');
    if (!usageName && options.length > 1) throw new RpcError('needs_choice','This object has several applicable usages; choose the intended usage', {details:{needs:{field:'usage',options}}});
    throw new RpcError('needs','This object has no prepared usage for its current physical condition', {
        fix:'Reuse an applicable usage or apply usage with the same object, the intended usage name and its description; do not replace or repair the object',
        details:{reason:'usage_required',needs:{field:'usage',options}}});
}
export function usageViews(world: Row, name: string | Row): Row[] {
    const item = typeof name === 'string' ? usageObject(world,name) : name;
    if (!item) return [];
    return records(world,item).map(usage => ({name:usage.name,description:usage.description,mode:usage.mode,parameters:clone(usage.parameters),applicable:fresh(world,item,usage)}));
}
