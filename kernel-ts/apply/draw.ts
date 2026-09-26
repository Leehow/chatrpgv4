/**
 * Contract §139.3 with spec D9 (docs/specs/npc-acts-first.md): a person draws a weapon they had on them.
 *
 * Host-only. When the stakes roll of §139.8 came out `severe` for this person this turn, the clerk that binds their
 * generated act may add one weapon from the rulebook's priced list (`equipment.json` records whose `entity_ref` names a
 * `weapons.json` profile) -- the one the act draws, chosen by a closed Jev question, never invented. The npc effect
 * carries it as `_draws: {weapon: <weapons.json id>, price_id?}`; the kernel extension sets that key only on the clerk's
 * `npc_act` calls and strips it from every other call.
 *
 * What it writes is where the combat code reads a person's weapons: `world.npc_weapons[<handle>]`, which
 * `npcProfileOf` lays over the stat block (so a fight opened later, the first blow and the situation's `holdings` all
 * see it), and -- when a fight is running with them in it -- their participant's weapons in the saved fight, so the
 * attack's `weapon` options include it on their next turn. Hitting, harm and death stay the combat engine's dice.
 */
import {RpcError} from '../errors.js';
import {isJsonObject} from '../json.js';
import {personLabel} from '../read/capsule.js';
import {array, row, string, type Row} from '../read/values.js';
import {RuleTables} from '../rules/tables.js';
import {nowIso} from '../write/store.js';
import {effectId, type StagedEffect} from './bookkeeping.js';
import type {ApplyContext} from './index.js';

/** The npc fields a draw cannot share its effect with. */
const OTHERS = ['to', 'stance', 'dead', 'skill', 'archetype', 'conditions', 'defense', 'action', 'disposition', 'reunion', 'intends', 'outcome', 'spend_turn'];

export async function stageDraw(context: ApplyContext, effect: Row, node: Row, handle: string): Promise<StagedEffect> {
    const {graph, world} = context, draws = effect._draws;
    const combined = OTHERS.filter(key => effect[key] != null);
    if (combined.length)
        throw new RpcError('invalid_params', 'npc._draws is its own effect', {fix: 'send the draw in one npc effect and the other change in another effect of the same batch',
            details: {field: 'npc._draws', conflicts: combined}});
    if (!isJsonObject(draws) || typeof draws.weapon !== 'string' || !draws.weapon.trim() || (draws.price_id != null && typeof draws.price_id !== 'string'))
        throw new RpcError('invalid_params', 'npc._draws is {weapon: <weapons.json id>, price_id?}', {details: {field: 'npc._draws'}});
    const table = row(await new RuleTables(context.kernel).weaponsTable()), weapon = draws.weapon.trim(), profile = row(table[weapon]);
    if (!Object.keys(profile).length)
        throw new RpcError('invalid_params', `${JSON.stringify(weapon)} is not a weapon profile in the rules tables`, {details: {field: 'npc._draws.weapon'}});
    const name = string(profile.display_name) || weapon, held = (world.npc_weapons ??= {}), list: Row[] = array(held[handle]).map(row);
    if (!list.some(entry => entry.weapon_id === weapon))
        held[handle] = [...list, {weapon_id: weapon, name, turn: context.turn.turn, ...(draws.price_id ? {price_id: draws.price_id} : {})}];
    const why = typeof effect.why === 'string' && effect.why.trim() ? effect.why : null;
    const receipt = {id: effectId(context, 'npc', handle), kind: 'npc', call_id: context.callId, npc: node.node_id, handle, name: graph.displayName(node),
        label: personLabel(world, handle, graph.displayName(node)), draws: {weapon_id: weapon, name, ...(draws.price_id ? {price_id: draws.price_id} : {})},
        why, visibility: 'keeper', at: nowIso()};
    return {receipt, event: {type: 'npc-changed', data: {npc: handle, draws: {weapon_id: weapon, name}, why}}};
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
