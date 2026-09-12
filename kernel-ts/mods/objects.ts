/** Portable accepted definitions and owned instances; no model or campaign I/O. */
import { RpcError } from '../errors.js';
import { jsonDigest } from '../json.js';
import { findNamedObject } from '../read/mods.js';
import { queuedRegistrations } from './queue.js';
import { clone, equal, integer, repr, row, string, truth, values, type Row } from '../read/values.js';
import { asciiSlug } from '../write/text.js';
import { validateDefinition } from './definition.js';
import { initializeDocument, ownershipChanged } from './documents.js';

export { findNamedObject as named, objectLook as look, publicItems, publicSheet } from '../read/mods.js';
export { weaponRows, projectSheet } from './projection.js';
export { usableWeapon, syncAmmo } from './combat-projection.js';
export function objectRegistry(world: Row): Row {
    if (!Object.hasOwn(world, 'objects')) world.objects = {definitions: {}, instances: {}, abilities: {}};
    return world.objects;
}
export function objectInstance(world: Row, name: any): Row | null { return findNamedObject(row(row(world.objects).instances), name) ?? null; }
export function defineObject(world: Row, draft: Row, provenance: Row): Row {
    const value = validateDefinition(draft), definitions = objectRegistry(world).definitions, digest = jsonDigest(value), prior = findNamedObject(definitions, value.name);
    if (prior) {
        if (prior.digest !== digest) throw new RpcError('invalid_params', 'An established definition cannot be regenerated with different parameters',
            {fix: `${repr(value.name)} is already defined as ${string(prior.category)}: keep it as it is, or define the different thing under its own name. To make something already in hand strike, apply item with its name and a rules-table profile in weapon`,
             details: {name: prior.name, category: prior.category}});
        return prior;
    }
    const id = `definition-${asciiSlug(value.name) || 'object'}-${Object.keys(definitions).length + 1}`;
    const definition = {...value, id, version: 1, digest, provenance: clone(provenance)}; definitions[id] = definition; return definition;
}
export function moveObject(world: Row, name: string, definitionName: string | null, owner: Row, options: {
    source: Row | null; turn: number; quantity?: any; condition?: any; documentSeed?: Row | null;
}): Row {
    const quantity = Object.hasOwn(options, 'quantity') ? options.quantity : 1, source = options.source, condition = options.condition ?? null;
    if (!integer(quantity) || quantity < 1 || quantity > 10000) throw new RpcError('invalid_params', 'Object quantity must be 1..10000');
    const data = objectRegistry(world), prior = objectInstance(world, name);
    if (condition !== null && !['intact', 'damaged', 'jammed', 'broken'].includes(condition)) throw new RpcError('invalid_params', 'Unknown physical object condition');
    const seen = new Set<string>(); let parent = owner;
    while (parent.kind === 'object') {
        if (seen.has(parent.id) || prior && parent.id === prior.id) throw new RpcError('invalid_params', 'An object cannot contain itself or form an ownership cycle');
        seen.add(parent.id); parent = data.instances[parent.id].owner;
    }
    if (prior) {
        if (source === null || !equal(prior.owner, source)) throw new RpcError('invalid_params', "Transfer must name this instance's current owner in from");
        if (definitionName !== null && data.definitions[prior.definition].name !== definitionName) throw new RpcError('invalid_params', 'Transfer cannot replace the instance definition');
        if (!equal(quantity, prior.quantity)) throw new RpcError('invalid_params', 'Transfer preserves the complete instance quantity');
        if (condition !== null && condition !== prior.state.condition) {
            if (!equal(source, owner)) throw new RpcError('invalid_params', 'Transfer preserves condition; change physical state with the same from/to owner');
            prior.state.condition = condition;
        }
        prior.owner = clone(owner); prior.changed_turn = options.turn; ownershipChanged(world); return prior;
    }
    // A first placement may name its giver. The truth `from` carries is checked above, against the owner an
    // existing instance actually has; below there is no owner to contradict, so refusing it guarded nothing
    // and cost something real -- Knott hands you the keys, the Keeper is made to drop him, and the receipt
    // records a handover with from:null. The giver rides on the receipt instead. Adoption still refuses a
    // giver, because enriching gear already carried is not something anybody hands over.
    const template = findNamedObject(data.definitions, definitionName || name);
    // One message for two causes sent the Keeper looking at spells when the definition was simply absent.
    // Naming the miss is still not enough on its own. A Keeper that defines a notebook and places an
    // instance named after its owner, without `definition`, is told to define what it just defined -- so
    // it defines it again. The names actually on offer are what turns that into one retry, and the ones
    // only queued so far belong in that list: they are real registrations it must not duplicate.
    if (!template) {
        const known = [...values(data.definitions).map(value => string(value.name)), ...queuedRegistrations(world).map(entry => string(entry.name))];
        const offer = known.length ? `set definition to one of: ${known.slice(-8).join(', ')}` : 'define it in this same batch';
        throw new RpcError('invalid_params', `No accepted definition named ${repr(definitionName || name)}`,
            {fix: definitionName === null
                ? `this placement omitted definition, so the instance name was looked up instead; ${offer}`
                : `${offer}, or define that name in this same batch`});
    }
    if (template.category === 'spell') throw new RpcError('invalid_params', 'Place an item/weapon from an accepted definition; spells are knowledge');
    if (template.category === 'weapon' && !equal(quantity, 1)) throw new RpcError('invalid_params', 'Each weapon has one instance and its own ammunition');
    const id = `object-${asciiSlug(name) || 'item'}-${Object.keys(data.instances).length + 1}`, params = template.parameters;
    const item: Row = {id, name, definition: template.id, owner: clone(owner), quantity,
        state: {ammo: Object.hasOwn(params, 'initial_ammo') ? params.initial_ammo : params.magazine ?? null, charges: params.charges ?? null, condition: condition || 'intact'},
        created_turn: options.turn, changed_turn: options.turn};
    data.instances[id] = item;
    if (options.documentSeed != null || Object.hasOwn(template, 'document')) {
        initializeDocument(item, options.documentSeed ?? template.document); ownershipChanged(world);
    }
    return item;
}
