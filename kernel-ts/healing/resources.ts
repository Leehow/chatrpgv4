/** Shared sheet/save synchronization; callers keep the existing transaction and clock. */
import { RpcError } from '../errors.js';
import type { PythonRandom } from '../random.js';
import { array, equal, integer, kebab, number, repr, row, string, truth, type Row } from '../read/values.js';
import type { SettleContext } from '../resolve/context.js';
import { rollExpression } from '../resolve/arithmetic.js';
import { establishDamageWound, healingTimeTrigger, readHealingState, writeHealingState } from './session.js';
import { mpTimeTrigger } from './mp.js';
export { gameDayOf, stageDayBoundary } from './day.js';
export { INCAPACITATING_CONDITIONS, OUT_OF_FIGHT_CONDITIONS, incapacitatedBy } from './conditions.js';
export const TRANSIENT_COMBAT_CONDITIONS = new Set(['prone', 'grappled', 'surprised', 'outnumbered', 'fled']);
/**
 * The visible record of an NPC's body: `world.npc_resources[handle]`, the same store combat's
 * `syncCombatants` writes and `npcProfileOf` lays over the book's numbers (contract §66).
 *
 * The party has a sheet per investigator; an NPC has this. Before §66 the two functions below
 * simply returned when the id was not at the table, which is how a settled check about a named NPC
 * -- `game-3d8ab658` turn 64 -- changed nothing about him: the write had nowhere to go and said so
 * to nobody. A name that is neither a sheet nor an NPC on the graph still returns, unchanged.
 */
async function syncNpcResources(context: SettleContext, handle: string, hp: number | null, conditions: string[] | null): Promise<boolean> {
    if (!context.npcNode(handle))
        return false;
    const resource = ((context.world.npc_resources ??= {})[handle] ??= {});
    if (hp != null)
        resource.current_hp = Math.trunc(hp);
    if (conditions != null)
        resource.conditions = [...conditions];
    await context.transaction.campaign.writeWorld(context.world);
    return true;
}
export async function syncHealing(context: SettleContext, investigator: string, hp: number, conditions: string[]): Promise<void> {
    const sheet = context.sheetById(investigator);
    if (!sheet) {
        await syncNpcResources(context, investigator, hp, conditions);
        return;
    }
    sheet.current_hp = hp;
    sheet.conditions = [...conditions];
    await context.writeSheet(sheet);
}
export async function recordWound(context: SettleContext, investigator: string, source: string | null): Promise<void> {
    const state = await readHealingState(context, investigator);
    establishDamageWound(state, { decisionId: context.callId, occurredElapsedMinutes: context.clockMinutes, sourceDamageRollId: source });
    state.investigator_id = investigator;
    await writeHealingState(context, investigator, state);
}
export async function minutesSinceInjury(context: SettleContext): Promise<number | null> {
    const state = await readHealingState(context, context.subjectId);
    const active = array(state.wound_ledger).filter(item => item && typeof item === 'object' && item.status === 'active' && (integer(item.occurred_elapsed_minutes) || typeof item.occurred_elapsed_minutes === 'boolean')).map(item => number(item.occurred_elapsed_minutes));
    return active.length ? Math.max(0, context.clockMinutes - Math.max(...active)) : null;
}
export async function mirrorInvestigator(context: SettleContext, investigator: string, options: {
    currentHp?: number | null;
    currentMp?: number | null;
    currentSan?: number | null;
    conditions?: string[] | null;
    wounds?: string[];
}): Promise<void> {
    const sheet = context.sheetById(investigator);
    if (sheet) {
        if (options.currentHp != null)
            sheet.current_hp = Math.trunc(options.currentHp);
        if (options.currentMp != null)
            sheet.current_mp = Math.trunc(options.currentMp);
        if (options.currentSan != null)
            sheet.current_san = Math.trunc(options.currentSan);
        if (options.conditions != null)
            sheet.conditions = [...options.conditions];
        await context.writeSheet(sheet);
    }
    // Not at the table, but on the graph: the same change, written where an NPC's body is kept
    // (contract §66). The wound ledger below is kept for both, because the hour First Aid has to be
    // delivered within is measured from it and the clock does not care whose wound it is.
    else if (!await syncNpcResources(context, investigator, options.currentHp ?? null, options.conditions ?? null))
        return;
    if (options.currentHp == null && options.conditions == null && !options.wounds?.length)
        return;
    const state = await readHealingState(context, investigator);
    for (const source of options.wounds ?? [])
        establishDamageWound(state, {
            decisionId: `${context.callId}-${kebab(source)}`, occurredElapsedMinutes: context.clockMinutes, sourceDamageRollId: source,
        });
    if (!truth(state) && !options.wounds?.length)
        return;
    state.investigator_id = investigator;
    if (options.currentHp != null)
        state.current_hp = Math.trunc(options.currentHp);
    if (options.conditions != null)
        state.conditions = [...options.conditions];
    await writeHealingState(context, investigator, state);
}
export function applyWoundConditions(participant: Row, damage: number, rollCon: () => [
    string,
    Row
]): void {
    const conditions = participant.conditions, half = Math.floor((participant.hp_max + 1) / 2);
    if (damage > participant.hp_max) {
        if (!conditions.includes('dead'))
            conditions.push('dead');
        return;
    }
    const major = damage >= half && damage > 0, newlyMajor = major && !conditions.includes('major_wound');
    if (major && !conditions.includes('major_wound'))
        conditions.push('major_wound');
    if (newlyMajor) {
        if (!conditions.includes('prone'))
            conditions.push('prone');
        const [, check] = rollCon();
        if (!truth(check.passed) && !conditions.includes('unconscious'))
            conditions.push('unconscious');
        participant.major_wound_con = { ...check };
    }
    if (participant.hp_current === 0) {
        if (!conditions.includes('unconscious'))
            conditions.push('unconscious');
        if (conditions.includes('major_wound') && !conditions.includes('dying'))
            conditions.push('dying');
    }
}
export function damageConditions(context: SettleContext, sheet: Row, after: number, damage: number): string[] {
    const prior = [...array(sheet.conditions)], participant = { hp_current: after, hp_max: number(sheet.derived.HP), conditions: [...prior] };
    applyWoundConditions(participant, damage, () => {
        const value = number(sheet.characteristics.CON), check = context.arithmetic.check(value, 'regular', 0, 0, context.rng);
        context.addRoll({ actor: string(sheet.id), skill: 'CON', target: value, difficulty: 'regular', threshold: check.threshold,
            roll: check.roll, level: check.level, passed: check.passed, kind: 'characteristic_check' });
        return [check.level, check];
    });
    if (!equal(participant.conditions, prior))
        context.addEffect('condition', string(sheet.id), prior, participant.conditions);
    return participant.conditions;
}
export function rollDamage(dice: string, rng: PythonRandom): Row {
    try {
        return rollExpression(dice, rng);
    }
    catch (error) {
        if ((error as Error).name !== 'ValueError')
            throw error;
        throw new RpcError('invalid_params', `damage dice ${repr(dice)} is not a dice expression`, { fix: 'use the rulebook form, e.g. 1D6 or 2D6+2' });
    }
}
export async function stageDamage(context: SettleContext, rolled: Row, effect: Row): Promise<{
    receipts: Row[];
    event: [
        string,
        Row
    ];
}> {
    const start = context.receipts.length, sheet = context.subject, id = context.subjectId, why = typeof effect.why === 'string' ? effect.why : null;
    const rollId = context.addDiceRoll({ actor: id, label: 'damage', expression: rolled.expression, faces: rolled.rolls, total: rolled.total, why });
    const before = number(sheet.current_hp || 0), after = Math.max(0, before - number(rolled.total));
    context.addDelta('hp', id, before, after, { source_receipt: rollId });
    const conditions = damageConditions(context, sheet, after, number(rolled.total));
    await mirrorInvestigator(context, id, { currentHp: after, wounds: [rollId], conditions });
    return { receipts: context.receipts.slice(start), event: ['resource-changed', { resource: 'hp', subject: id, before, after, dice: effect.dice, total: rolled.total, why }] };
}
export async function stageRecovery(context: SettleContext, minutes: number): Promise<{
    receipts: Row[];
    events: Array<[
        string,
        Row,
        string
    ]>;
    recovered: Row[];
}> {
    const start = context.receipts.length, events: Array<[
        string,
        Row,
        string
    ]> = [], recovered: Row[] = [];
    if (minutes < 60 || !context.party().length)
        return { receipts: [], events, recovered };
    const restore = async (id: string, resource: string, before: number, gained: number, ceiling: number) => {
        const after = ceiling > 0 ? Math.min(ceiling, before + gained) : before + gained;
        if (after === before)
            return;
        const receipt = context.addDelta(resource, id, before, after, { why: 'rest' });
        await mirrorInvestigator(context, id, resource === 'hp' ? { currentHp: after } : { currentMp: after });
        events.push(['resource-changed', { resource, subject: id, before, after, why: 'rest' }, receipt]);
        recovered.push({ investigator: id, resource, before, after });
    };
    for (const sheet of [...context.party()]) {
        const id = string(sheet.id || '');
        if (!id)
            continue;
        const derived = row(sheet.derived), characteristics = row(sheet.characteristics), maximum = number(derived.HP || 10);
        if (minutes >= 360) {
            const gained = await healingTimeTrigger(context.arithmetic, context, id, maximum, number(characteristics.CON || 50), minutes, context.rng);
            await restore(id, 'hp', number(sheet.current_hp || 0), gained, maximum);
            let healed = (await readHealingState(context, id)).conditions;
            if (Array.isArray(healed))
                healed = healed.filter(value => !TRANSIENT_COMBAT_CONDITIONS.has(value)).map(string);
            const prior = [...array(sheet.conditions)].map(string);
            if (Array.isArray(healed) && !equal(healed, prior)) {
                await mirrorInvestigator(context, id, { conditions: healed });
                // Rest is the route out of `unconscious` that needs nobody else at the table: CoC 7e
                // rouses a character when they regain hit points (the First Aid and Medicine
                // descriptions say so in as many words), and the natural 1 HP a day gets there on its
                // own -- `HealingSession.heal` drops the condition the moment the hit point lands.
                // That already worked. What it did not do was leave a receipt, so the one exit an
                // investigator alone on the floor can take was invisible: the sheet quietly changed,
                // the mechanics card said nothing, and by the rule that narrated-without-a-receipt is
                // narrated-without-happening, the table had no record that it had. The mirror is not
                // the record; this is.
                context.addEffect('condition', id, prior, healed);
            }
        }
        const gained = await mpTimeTrigger(context.tables, context, id, number(characteristics.POW || 50), minutes, { currentMp: sheet.current_mp });
        await restore(id, 'mp', number(sheet.current_mp || 0), gained, number(derived.MP || 0));
    }
    return { receipts: context.receipts.slice(start), events, recovered };
}
