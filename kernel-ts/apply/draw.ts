/**
 * Contract §139.3 with spec D9, and §139.19 with spec D10 (docs/specs/npc-acts-first.md): a person brings out something
 * they had on them that no one at the table knew of.
 *
 * Host-only, both ways. When the stakes die of §139.8 allowed a surprise for this person this turn and their generated
 * act brings something out (`produces`, §139.2), the clerk that binds the act adds it, matched by a closed Jev choice
 * over the rulebook's price list (`equipment.json`) -- never invented from nothing, never given numbers the book does
 * not print. The kernel extension sets these keys only on the clerk's `npc_act` calls and strips them from every other
 * call (`extensions/kernel/npc-act-marks.ts`).
 *
 * - A weapon record (its `entity_ref` names a `weapons.json` profile): `_draws: {weapon: <weapons.json id>, price_id?}`.
 *   It is written where the combat code reads a person's weapons: `world.npc_weapons[<handle>]`, which `npcProfileOf`
 *   lays over the stat block (so a fight opened later, the first blow and the situation's `holdings` all see it), and --
 *   when a fight is running with them in it -- their participant's weapons in the saved fight, so the same batch's
 *   attack, and their next turn's, can use it. Hitting, harm and death stay the combat engine's dice.
 * - Anything else: `_produces: {price_id?, name?, description}` -- an object instance owned by them in the ADR-0005
 *   registry (`world.objects`, the same definitions and instances the Keeper's `define`/`object` write), named by the
 *   book's name when a `price_id` names a record, else by the name the table's act gave it. Its definition carries no
 *   number at all (an item with no parameters): the book prices such a thing but gives it no rule, and a thing the table
 *   made up has nothing to read one from. It is real from then on -- it can be taken, looked at, become a clue -- through
 *   the ordinary object verbs.
 *
 * Both receipts say what was brought out: `produced: {name, source: 'catalog' | 'table', record?}`.
 */
import {RpcError} from '../errors.js';
import {isJsonObject} from '../json.js';
import {personLabel} from '../read/capsule.js';
import {findNamedObject} from '../read/mods.js';
import {array, row, string, type Row} from '../read/values.js';
import {RuleTables} from '../rules/tables.js';
import {nowIso} from '../write/store.js';
import {defineObject, moveObject, objectInstance, objectRegistry} from '../mods/objects.js';
import {INTENT_TEXT_LIMIT, intentOwner} from '../npc/intents.js';
import {effectId, type StagedEffect} from './bookkeeping.js';
import type {ApplyContext} from './index.js';

/** The npc fields a draw or a produced object cannot share its effect with. */
const OTHERS = ['to', 'stance', 'dead', 'skill', 'archetype', 'conditions', 'defense', 'action', 'disposition', 'reunion', 'intends', 'outcome', 'spend_turn'];
/** The longest name a produced object may carry (the definition registry's own bound). */
const NAME_LIMIT = 120;
const oneLine = (value: unknown, limit: number): value is string =>
    typeof value === 'string' && !!value.trim() && !/[\r\n\u2028\u2029]/.test(value) && Array.from(value.trim()).length <= limit;

/**
 * §139.29 (ticket 30): the row of the act that brought a thing out, when the write names one of this person's rows
 * (`intent_ref`, the stamp the act step puts on what it brings out). Recorded beside the thing so the situation can say
 * it was brought out before and by which act -- structure only, never read from a name.
 */
const originOf = (effect: Row, handle: string): Row => {
    const ref = effect.intent_ref;
    return typeof ref === 'string' && intentOwner(ref) === handle ? {ref} : {};
};

/** The rulebook's price-list record with this id, or undefined. */
async function priceRecord(context: ApplyContext, priceId: string): Promise<Row | undefined> {
    const records = array(row(await new RuleTables(context.kernel).equipmentTable()).records).map(row);
    return records.find(record => string(record.price_id) === priceId);
}

export async function stageDraw(context: ApplyContext, effect: Row, node: Row, handle: string): Promise<StagedEffect> {
    const {graph, world} = context, draws = effect._draws;
    const combined = [...OTHERS, '_produces'].filter(key => effect[key] != null);
    if (combined.length)
        throw new RpcError('invalid_params', 'npc._draws is its own effect', {fix: 'send the draw in one npc effect and the other change in another effect of the same batch',
            details: {field: 'npc._draws', conflicts: combined}});
    if (!isJsonObject(draws) || typeof draws.weapon !== 'string' || !draws.weapon.trim() || (draws.price_id != null && typeof draws.price_id !== 'string'))
        throw new RpcError('invalid_params', 'npc._draws is {weapon: <weapons.json id>, price_id?}', {details: {field: 'npc._draws'}});
    const table = row(await new RuleTables(context.kernel).weaponsTable()), weapon = draws.weapon.trim(), profile = row(table[weapon]);
    if (!Object.keys(profile).length)
        throw new RpcError('invalid_params', `${JSON.stringify(weapon)} is not a weapon profile in the rules tables`, {details: {field: 'npc._draws.weapon'}});
    const name = string(profile.display_name) || weapon, held = (world.npc_weapons ??= {}), list: Row[] = array(held[handle]).map(row);
    // §139.19: the record the price list prints for it names what was brought out, as the book names it.
    const record = typeof draws.price_id === 'string' ? await priceRecord(context, draws.price_id) : undefined;
    if (typeof draws.price_id === 'string' && (!record || string(row(record.entity_ref).entity_id) !== weapon))
        throw new RpcError('invalid_params', `${JSON.stringify(draws.price_id)} is not the price-list record of ${JSON.stringify(weapon)}`, {details: {field: 'npc._draws.price_id'}});
    if (!list.some(entry => entry.weapon_id === weapon))
        held[handle] = [...list, {weapon_id: weapon, name, turn: context.turn.turn, ...(draws.price_id ? {price_id: draws.price_id} : {}), ...originOf(effect, handle)}];
    const why = typeof effect.why === 'string' && effect.why.trim() ? effect.why : null;
    const produced = {name: string(record?.name) || name, source: 'catalog', ...(draws.price_id ? {record: draws.price_id} : {})};
    const receipt = {id: effectId(context, 'npc', handle), kind: 'npc', call_id: context.callId, npc: node.node_id, handle, name: graph.displayName(node),
        label: personLabel(world, handle, graph.displayName(node)), draws: {weapon_id: weapon, name, ...(draws.price_id ? {price_id: draws.price_id} : {})},
        produced, why, visibility: 'keeper', at: nowIso()};
    return {receipt, event: {type: 'npc-changed', data: {npc: handle, draws: {weapon_id: weapon, name}, produced, why}}};
}

/**
 * §139.19: a thing that is not a weapon, brought out by this person -- a price-list record (`price_id`, named by the
 * book) or the table's own (`name`, from the act). One object instance owned by them, of a definition with no numbers.
 * A definition of that name already registered is the thing's definition (ADR-0005: one identity per thing, never a
 * second version of it); an instance of that name they already hold is shown again, not duplicated; one somebody else
 * holds keeps its name, and theirs is told apart by their label.
 */
export async function stageProduce(context: ApplyContext, effect: Row, node: Row, handle: string): Promise<StagedEffect> {
    const {graph, world} = context, produces = effect._produces;
    const combined = [...OTHERS, '_draws'].filter(key => effect[key] != null);
    if (combined.length)
        throw new RpcError('invalid_params', 'npc._produces is its own effect', {fix: 'send what is brought out in one npc effect and the other change in another effect of the same batch',
            details: {field: 'npc._produces', conflicts: combined}});
    const shape = 'npc._produces is {price_id} or {name}, with the act as its description, each on one line';
    if (!isJsonObject(produces) || Object.keys(produces).some(key => !['price_id', 'name', 'description'].includes(key))
        || (produces.price_id != null) === (produces.name != null) || !oneLine(produces.description, INTENT_TEXT_LIMIT)
        || produces.price_id != null && !oneLine(produces.price_id, NAME_LIMIT) || produces.name != null && !oneLine(produces.name, NAME_LIMIT))
        throw new RpcError('invalid_params', shape, {details: {field: 'npc._produces'}});
    const turn = context.turn.turn, label = personLabel(world, handle, graph.displayName(node)), description = string(produces.description).trim();
    let name: string, basis: string, source: 'catalog' | 'table', record: string | null = null;
    if (typeof produces.price_id === 'string') {
        record = produces.price_id.trim();
        const found = await priceRecord(context, record);
        if (!found)
            throw new RpcError('invalid_params', `the rulebook's price list prints no record with price_id ${JSON.stringify(record)}`, {details: {field: 'npc._produces.price_id'}});
        if (row(found.entity_ref).kind === 'weapon')
            throw new RpcError('invalid_params', `${JSON.stringify(record)} is a weapon: it is drawn (_draws), so the fight can use it`, {details: {field: 'npc._produces.price_id'}});
        name = string(found.name).trim();
        basis = `The rulebook's price list, record ${record}; brought out by ${label} on turn ${String(turn)}.`;
        source = 'catalog';
    } else {
        name = string(produces.name).trim();
        basis = `Brought out by ${label} on turn ${String(turn)}; the table's own thing, with no rule and no number.`;
        source = 'table';
    }
    const owner = {kind: 'npc', id: handle, name: graph.displayName(node)};
    const registry = objectRegistry(world);
    const definition = findNamedObject(registry.definitions, name)
        ?? defineObject(world, {name, category: 'item', description, basis, parameters: {effects: []}, traits: [], player_view: {description, fields: []}},
            {npc_act: {npc: handle, turn, source, ...(record ? {record} : {})}});
    // An instance name is an identity: one they already hold is this thing again; one held by anyone else stays theirs.
    let item: Row | null = null;
    for (const candidate of [name, `${name} (${label})`, `${name} (${label}, turn ${String(turn)})`]) {
        const prior = objectInstance(world, candidate);
        if (prior && row(prior.owner).kind === 'npc' && row(prior.owner).id === handle) { item = prior; break; }
        // §139.29: a thing brought out for the first time records who brought it out, on which turn, and by which act.
        if (!prior) { item = moveObject(world, candidate, string(definition.name), owner, {source: null, turn}); item.brought_out = {by: handle, turn, ...originOf(effect, handle)}; break; }
    }
    if (!item)
        throw new RpcError('invalid_params', `${JSON.stringify(name)} is already held by others under every name this person's could take`, {details: {field: 'npc._produces'}});
    const why = typeof effect.why === 'string' && effect.why.trim() ? effect.why : null;
    const produced = {name: string(item.name), source, ...(record ? {record} : {})};
    const receipt = {id: effectId(context, 'npc', handle), kind: 'npc', call_id: context.callId, npc: node.node_id, handle, name: graph.displayName(node),
        label, produced, instance: item.id, definition: definition.id, why, visibility: 'keeper', at: nowIso()};
    return {receipt, event: {type: 'npc-changed', data: {npc: handle, produced, why}}};
}

/**
 * After the batch landed: a person in the running fight who drew a weapon now holds it there too (the fight snapshot
 * was built from their stat block when it opened). The weapon catalog of a fight already holds every rulebook profile.
 */
export async function armDrawn(context: ApplyContext, receipts: Row[]): Promise<void> {
    const drawn = receipts.filter(receipt => receipt.kind === 'npc' && isJsonObject(receipt.draws));
    if (!drawn.length) return;
    const combat = row(await context.campaign.readSave('combat.json'));
    if (combat.status !== 'active') return;
    let changed = false;
    for (const receipt of drawn) {
        const participant = array(combat.participants).map(row).find(value => value.actor_id === receipt.handle);
        const weapon = string(row(receipt.draws).weapon_id);
        if (!participant || !weapon) continue;
        const weapons = array(participant.weapons);
        if (weapons.some(value => (isJsonObject(value) ? value.weapon_id : value) === weapon)) continue;
        participant.weapons = [...weapons, {weapon_id: weapon}];
        changed = true;
    }
    if (!changed) return;
    if (Number.isInteger(combat.revision)) combat.revision = combat.revision + 1;
    await context.campaign.writeSave('combat.json', combat);
}
