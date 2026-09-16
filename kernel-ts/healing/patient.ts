/**
 * The person a settlement is *about*, when that person is not at the table (contract §66).
 *
 * The rules engine was written once and it is not investigator-shaped: `applyWoundConditions`,
 * `damageConditions` and `HealingSession` all read `{id, derived.HP, characteristics.CON,
 * current_hp, conditions}` and never ask who the row belongs to. What was investigator-shaped was
 * the *lookup*: `read/handlers.ts`'s `actor()` searches the party and refuses everything else with
 * `no investigator <name> at the table`, so `apply damage` could not name anyone but a party
 * member, and `table.resolve` looked for `action.target` in the party alone -- which silently made
 * the rescuer the patient when the patient was an NPC.
 *
 * Retained live evidence, campaign `game-3d8ab658` turn 64: an investigator dragged an unconscious
 * NPC downstairs on a blanket, the check was settled (`First Aid` 79 against 70, failure), the
 * declared failure stakes were injury to him, the receipt even carries `npc: "augustus-larkin"` --
 * and the only place the outcome could land was the `why` sentence of an `npc` receipt. A roll that
 * happened, judged against a number, on a named subject, changed nothing about that subject,
 * because there was nowhere for a number about him to go. Meanwhile the same turn's investigator
 * carried hit points, sanity, a cash ledger and item conditions.
 *
 * So this module is the row, not a second rules table: it reads what the book printed (or what
 * `apply npc {archetype}` pinned, §34.10) and what the table has since written into
 * `world.npc_resources`, and hands back the shape the engines already read. Every rule that then
 * runs is the one that runs for an investigator, unchanged.
 */
import { RpcError } from '../errors.js';
import type { LoadedModule } from '../read/campaign.js';
import { array, number, row, string, type Row } from '../read/values.js';
import { profileHitPoints } from '../combat/profiles.js';
import { npcProfileOf } from '../resolve/context.js';

/** True for a patient row this module built rather than a party sheet the campaign owns. */
export const isNpcPatient = (patient: Row): boolean => patient.is_npc === true;

/**
 * The sheet-shaped row for an NPC the Keeper named, or `null` when the name is not an NPC at all.
 *
 * A person the book gave no numbers is refused rather than defaulted: a made-up CON would settle a
 * CON roll that decides whether he wakes, and §34.10 already gives the Keeper the one verb that
 * fills the gap once, for the rest of the campaign. That refusal is the same shape `noSkill` uses
 * for a missing skill, and for the same reason -- the fix names the call that makes it settle.
 */
export function npcPatient(graph: LoadedModule['graph'], world: Row, name: string): Row | null {
    const node = graph.find(name, ['npc']);
    if (!node)
        return null;
    const handle = graph.handle(node), who = graph.displayName(node);
    const profile = npcProfileOf(graph, world, handle);
    if (!profile)
        throw new RpcError('needs', `the book gives ${who} no hit points, so nothing can be settled about his body`, {
            fix: `pin a stat block once with apply npc {name: "${who}", archetype: <ordinary_adult | capable_adult | dangerous_actor>, why: ...} — it is his for the rest of the campaign`,
            details: { needs: { field: 'npc.archetype', options: [] }, subject: handle, subject_label: who },
        });
    const maximum = profileHitPoints(profile);
    return {
        id: handle,
        name: who,
        is_npc: true,
        derived: { HP: maximum },
        characteristics: row(profile.characteristics),
        current_hp: profile.hp_current == null ? maximum : Math.max(0, number(profile.hp_current)),
        conditions: array(profile.conditions).map(string),
    };
}
