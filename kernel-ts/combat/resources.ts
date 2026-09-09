/** Combat amounts and injury receipts mirror through the existing healing owner. */
import { isJsonObject } from '../json.js';
import { array, entries, number, row, string, values, type Row } from '../read/values.js';
import type { SettleContext } from '../resolve/context.js';
import { mirrorInvestigator, TRANSIENT_COMBAT_CONDITIONS } from '../healing/resources.js';
import { readHealingState } from '../healing/session.js';
import { syncAmmo } from '../mods/projection.js';
import type { CombatSession } from './engine.js';
export async function syncCombatants(context: SettleContext, session: CombatSession, concluded: boolean): Promise<void> {
    syncAmmo(context.world, values(session.participants), session.jammedWeapons);
    for (const [actor, participant] of entries(session.participants)) {
        if (!context.sheetById(actor)) {
            if (Object.hasOwn(context.world, 'objects') || Object.hasOwn(row(context.world.npc_resources), actor)) {
                const resource = ((context.world.npc_resources ??= {})[actor] ??= {});
                Object.assign(resource, { current_hp: number(participant.hp_current), current_mp: number(participant.magic_points || 0), conditions: [...array(participant.conditions)] });
            }
            continue;
        }
        const conditions = array(participant.conditions).filter(condition => !(concluded && TRANSIENT_COMBAT_CONDITIONS.has(condition)));
        const known = new Set(array((await readHealingState(context, actor)).wound_ledger).filter(isJsonObject).map(wound => wound.source_damage_roll_id));
        const wounds: string[] = [];
        for (const damage of session.damageChain) {
            const source = damage.damage_roll_id;
            if (damage.target_actor_id !== actor || typeof source !== 'string' || known.has(source) || number(damage.raw_damage) - number(damage.armor_absorbed) <= 0)
                continue;
            wounds.push(source);
        }
        await mirrorInvestigator(context, actor, { currentHp: number(participant.hp_current), currentMp: number(participant.magic_points || 0), conditions, wounds });
    }
    if (Object.hasOwn(context.world, 'objects') || Object.hasOwn(context.world, 'npc_resources'))
        await context.transaction.campaign.writeWorld(context.world);
}
