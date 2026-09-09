/** Current typed generated-object effects inside the existing settlement context. */
import { RpcError } from '../errors.js';
import { isJsonObject } from '../json.js';
import { Catalog } from '../rules/catalog.js';
import { npcCombatParticipant } from '../combat/profiles.js';
import { damageConditions, mirrorInvestigator, recordWound } from '../healing/resources.js';
import { castSpell } from '../magic/engine.js';
import type { MagicEffects } from '../magic/index.js';
import { array, clone, integer, normalize, row, string, truth, type Row } from '../read/values.js';
import { rollExpression } from '../resolve/arithmetic.js';
import type { SettleContext } from '../resolve/context.js';
import { sanityInt as int } from '../sanity/expression.js';
import { objectInstance, objectRegistry } from './objects.js';

export async function effectTarget(context: SettleContext, name?: string): Promise<Row> {
    name = name || string(context.action.target || context.actorId);
    for (const sheet of context.party()) if ([normalize(sheet.id), normalize(sheet.name)].includes(normalize(name))) return {id: sheet.id, kind: 'investigator', state: clone(sheet)};
    const node = context.graph.npc(name), handle = context.graph.handle(node), profile = context.npcProfile(handle);
    if (profile === null) throw new RpcError('needs', 'This NPC has no numeric profile for a resource effect');
    const spec = await npcCombatParticipant(context.tables, handle, profile), characteristics = row(profile.characteristics), derived = row(profile.derived);
    const state: Row = {id: handle, name: context.graph.displayName(node), characteristics: profile.characteristics ?? {},
        derived: {HP: spec.hp_max, MP: int(Object.hasOwn(derived, 'MP') ? derived.MP : Math.floor(int(characteristics.POW ?? 0) / 5))},
        current_hp: spec.hp_current, current_mp: spec.magic_points, current_san: 0, conditions: spec.conditions};
    Object.assign(state, clone(row(row(context.world.npc_resources)[handle])));
    const combat = row(await context.readSave('combat.json'));
    if (combat.status === 'active') {
        const participant = array(combat.participants).find(participant => participant.actor_id === handle);
        if (participant) Object.assign(state, {current_hp: participant.hp_current, current_mp: participant.magic_points, conditions: participant.conditions});
    }
    return {id: handle, kind: 'npc', state};
}
export async function saveEffectTarget(context: SettleContext, selected: Row): Promise<void> {
    const state = selected.state;
    if (selected.kind === 'investigator') {
        await context.writeSheet(state);
        await mirrorInvestigator(context, selected.id, {currentHp: state.current_hp ?? null, currentMp: state.current_mp ?? null,
            currentSan: state.current_san ?? null, conditions: state.conditions ?? null});
    } else {
        if (!Object.hasOwn(context.world, 'npc_resources')) context.world.npc_resources = {};
        context.world.npc_resources[selected.id] = Object.fromEntries(['current_hp', 'current_mp', 'current_san', 'conditions', 'characteristics'].map(key => [key, clone(state[key])]));
        await context.transaction.campaign.writeWorld(context.world);
    }
    const combat = row(await context.readSave('combat.json'));
    if (combat.status === 'active') {
        for (const participant of array(combat.participants)) if (participant.actor_id === selected.id)
            Object.assign(participant, {hp_current: state.current_hp, magic_points: state.current_mp, conditions: state.conditions ?? []});
        await context.writeSave('combat.json', combat);
    }
}
export async function applyObjectEffects(context: SettleContext, effects: Row[], selected: Row): Promise<void> {
    const state = selected.state;
    for (const effect of effects) {
        const kind = effect.kind;
        if (kind === 'condition') {
            const before = [...array(state.conditions)], after = [...new Set([...before, effect.value])]; state.conditions = after;
            context.addEffect('condition', selected.id, before, after); context.addDelta('condition', selected.id, before, after); continue;
        }
        const expression = string(effect.amount), rolled = /^[0-9]+$/.test(expression) ? {total: int(expression), expression, rolls: []} : rollExpression(expression, context.rng);
        const amount = Math.max(0, int(rolled.total)), source = rolled.rolls.length ? context.addDiceRoll({actor: context.actorId, label: 'object-effect',
            expression: rolled.expression, faces: rolled.rolls, total: amount}) : null;
        const key = `current_${kind}`, before = int(state[key] || 0), derived = row(state.derived);
        const maximum = int(Object.hasOwn(derived, kind.toUpperCase()) ? derived[kind.toUpperCase()] : kind === 'san' ? 99 : before);
        const after = Math.max(0, Math.min(maximum, before + (effect.direction === 'gain' ? amount : -amount))); state[key] = after;
        context.addDelta(kind, selected.id, before, after, {source_receipt: source});
        if (kind === 'hp' && after < before && selected.kind === 'investigator') {
            state.conditions = damageConditions(context, state, after, before - after);
            if (!Object.hasOwn(selected, 'wounds')) selected.wounds = [];
            selected.wounds.push(source);
        }
    }
    await saveEffectTarget(context, selected);
    for (const source of array(selected.wounds)) await recordWound(context, selected.id, source);
}
export const magicEffects: MagicEffects = Object.freeze({target: effectTarget, apply: applyObjectEffects});
export async function useItem(context: SettleContext, name: string): Promise<Row> {
    const item = objectInstance(context.world, name);
    if (!item || item.owner.id !== context.actorId) throw new RpcError('needs', 'The acting investigator must own this item instance');
    const definition = objectRegistry(context.world).definitions[item.definition];
    if (definition.category !== 'item') throw new RpcError('invalid_params', 'Use combat for weapons and magic:cast-spell for spells');
    const effects = definition.parameters.effects;
    if (!truth(effects)) throw new RpcError('needs', 'This object supplies physical facts, not an automatic activated effect', {
        fix: 'read its traits with look focus object; choose the appropriate ordinary check or world action'});
    const selected = await effectTarget(context), charges = item.state.charges ?? null;
    if (charges !== null && charges < 1) throw new RpcError('needs', 'This item has no remaining charges');
    await applyObjectEffects(context, effects, selected);
    if (charges !== null) { item.state.charges = charges - 1; context.addDelta('charges', context.actorId, charges, charges - 1, {item: item.name}); }
    await context.transaction.campaign.writeWorld(context.world);
    return {kind: 'item', status: 'used', item: item.name, target: selected.state.name, charges: item.state.charges ?? null};
}
export async function castNpc(context: SettleContext, casterName: string, definition: Row): Promise<Row> {
    const casterTarget = await effectTarget(context, casterName);
    if (casterTarget.kind !== 'npc') throw new RpcError('invalid_params', 'NPC casting needs an NPC caster');
    const profile = context.npcProfile(casterTarget.id) || {};
    if (!array(profile.spells).includes(definition.name)) throw new RpcError('needs', 'The NPC has not acquired this spell');
    let selected = await effectTarget(context, string(context.action.target || casterName));
    const state = casterTarget.state;
    if (int(state.current_hp) <= 0) throw new RpcError('turn_state', 'A dead NPC cannot cast');
    if (!integer(row(state.characteristics).POW)) throw new RpcError('needs', 'The NPC caster needs an established POW');
    const before = clone(state), caster = {pow: state.characteristics.POW, current_mp: state.current_mp, current_hp: state.current_hp, current_san: state.current_san};
    const result = await castSpell(context.tables, new Catalog(context.tables), context.arithmetic, definition.name, caster, {
        isFirstCast: false, isNpc: true, rng: context.rng, moduleSpells: context.moduleSpells});
    context.actorId = casterTarget.id;
    if (caster.pow !== state.characteristics.POW) { context.addDelta('pow', casterTarget.id, state.characteristics.POW, caster.pow); state.characteristics.POW = caster.pow; }
    for (const resource of ['hp', 'mp', 'san']) {
        const key = `current_${resource}`; state[key] = caster[key as keyof typeof caster];
        if (state[key] !== before[key]) context.addDelta(resource, casterTarget.id, before[key], state[key]);
    }
    await saveEffectTarget(context, casterTarget);
    if (truth(result.success)) { selected = await effectTarget(context, selected.id); await applyObjectEffects(context, definition.parameters.effects, selected); }
    return {kind: 'magic', status: truth(result.success) ? 'cast' : 'failed', spell: definition.name, caster: state.name,
        mp_spent: result.mp_spent, san_lost: result.san_lost, target: selected.state.name};
}
export async function repairItem(context: SettleContext, name: string): Promise<Row> {
    const item = objectInstance(context.world, name);
    if (!item || item.owner.id !== context.actorId) throw new RpcError('needs', 'The repairer must hold this instance');
    if (item.state.condition === 'intact') return {kind: 'none', item: name, note: 'The object is already intact'};
    const skill = context.action.skill;
    if (typeof skill !== 'string' || !skill.trim()) throw new RpcError('needs', 'Name the appropriate repair skill');
    const value = await context.actorSkillValue(context.actorId, skill);
    if (value === null) throw new RpcError('needs', 'The repairer has no established value for that skill');
    const check = context.arithmetic.check(value, 'regular', 0, 0, context.rng);
    context.addRoll({actor: context.actorId, skill, target: value, difficulty: 'regular', threshold: check.threshold, roll: check.roll, level: check.level,
        passed: check.passed, bonus: 0, penalty: 0, visibility: 'public', kind: 'object_repair', check});
    const before = item.state.condition;
    if (check.passed) {
        item.state.condition = 'intact';
        const snapshot = await context.readSave('combat.json');
        if (truth(snapshot)) { snapshot.jammed_weapons = array(snapshot.jammed_weapons).filter(key => !key.endsWith(`:${item.id}`)); await context.writeSave('combat.json', snapshot); }
        context.addDelta('condition', context.actorId, before, 'intact', {item: name}); await context.transaction.campaign.writeWorld(context.world);
    }
    return {kind: 'check', ...check, item: name, condition: item.state.condition};
}
