/** Named magic settlement family; the shared pipeline retains grants and commits. */
import { RpcError } from '../errors.js';
import { isJsonObject, compareUnicode } from '../json.js';
import { MPool } from '../healing/mp.js';
import { recordWound } from '../healing/resources.js';
import { array, clone, entries, kebab, row, string, truth, repr, type Row } from '../read/values.js';
import type { SettleContext, SettlementExecutor } from '../resolve/context.js';
import type { FixedFamilyBinding } from '../resolve/families.js';
import { Catalog } from '../rules/catalog.js';
import { sanityInt as int } from '../sanity/expression.js';
import { castSpell, learnSpell } from './engine.js';
import { canonicalSpellName, spellCandidates, UnpricedSpellError } from './spells.js';
import { readMagicState, writeMagicState } from './state.js';
import { magicLearningSources } from './facts.js';

export { castSpell, learnSpell, castingRules, learningRules, rollMagicDice, resolveMpCost, resolvePowCost, resolveSanityCost } from './engine.js';
export { resolveSpellName, canonicalSpellName, spellByName, spellCandidates, UnpricedSpellError } from './spells.js';
export { MAGIC_SAVE_DIR, MAGIC_SAVE_PATHS, magicStateName, readMagicState, writeMagicState, knownSpells, rebaseMagicClock } from './state.js';
export { magicLearningSources, prepareMagicFacts, augmentMagicFacts, provisionalMagicSemantic, preparedSpellName, type PreparedMagicFacts } from './facts.js';
export { gainMythos, becomeBeliever, maxSanFor } from './mythos.js';

export const CAST_SPELL = 'decision:coc7:magic:cast-spell';
export const LEARN_SPELL = 'decision:coc7:magic:learn-spell';
/** The later Mod effects contribution reuses this normal casting path. */
export interface MagicEffects {
    target(context: SettleContext, name?: string): Promise<Row>;
    apply(context: SettleContext, effects: Row[], selected: Row): Promise<void>;
}
export function casterState(sheet: Row): Row {
    const characteristics = row(sheet.characteristics);
    return { pow: int(characteristics.POW || 0), int: int(characteristics.INT || 0), current_mp: int(sheet.current_mp || 0),
        current_hp: int(sheet.current_hp || 0), current_san: int(sheet.current_san || 0) };
}
async function unknownSpell(context: SettleContext, catalog: Catalog, name: string): Promise<never> {
    throw new RpcError('unknown_entity', `unknown spell ${repr(name)}`, { details: { query: name, candidates: await spellCandidates(catalog, name, context.moduleSpells) } });
}
function castExecutor(effects?: MagicEffects): SettlementExecutor {
    return async (context, args) => {
        const sheet = context.actor, catalog = new Catalog(context.tables);
        const spell = await canonicalSpellName(context.tables, catalog, string(args.spell || ''), context.moduleSpells);
        const definition = context.moduleSpells.find(record => record.name === spell && truth(record.generated_definition))?.generated_definition;
        let selected: Row | null = null;
        if (definition && truth(row(definition.parameters).effects)) {
            if (!effects) throw new RpcError('not_implemented', 'Generated spell effects are not implemented');
            selected = await effects.target(context);
        }
        const state = await readMagicState(context, context.actorId), caster = casterState(sheet);
        const pool = await MPool.load(context.tables, context, context.actorId, caster.pow, { currentMp: caster.current_mp, currentHp: caster.current_hp });
        const castSpells = new Set(array(state.cast_spells).map(string));
        let result: Row;
        try {
            result = await castSpell(context.tables, catalog, context.arithmetic, spell, caster, {
                isFirstCast: !castSpells.has(spell), isNpc: args.is_npc === true, pushed: args.pushed === true, interrupted: args.interrupted === true,
                rng: context.rng, mpPool: pool, moduleSpells: context.moduleSpells });
        }
        catch (error) {
            if (error instanceof UnpricedSpellError) throw new RpcError('invalid_params', error.message, {
                fix: 'author cost_mp/cost_sanity on the module spell node or adjudicate the cast in the fiction',
                details: { spell: error.spell, module_node_id: error.nodeId, unpriced_fields: error.missing } });
            if ((error as Error).name === 'KeyError') return unknownSpell(context, catalog, spell);
            throw error;
        }
        if (truth(result.success) && !castSpells.has(spell)) state.cast_spells.push(spell);
        await writeMagicState(context, context.actorId, state);
        await pool.save(context);
        const roll = result.roll_result;
        if (isJsonObject(roll)) result.roll_id = context.addRoll({ actor: context.actorId, skill: 'POW', target: roll.target, difficulty: 'hard', threshold: roll.threshold,
            roll: roll.roll, level: roll.level, passed: roll.passed, bonus: 0, penalty: 0, visibility: 'public', kind: 'casting_roll',
            check: { ...roll, investigator_id: context.actorId, skill: 'POW', kind: 'casting_roll' } });
        const before = casterState(sheet), after: Row = { current_mp: pool.currentMp, current_hp: pool.currentHp ?? caster.current_hp, current_san: caster.current_san };
        for (const [resource, key] of [['mp', 'current_mp'], ['hp', 'current_hp'], ['san', 'current_san']]) {
            if (after[key] === before[key]) continue;
            sheet[key] = after[key]; context.addDelta(resource, context.actorId, before[key], after[key]);
        }
        await context.writeSheet(sheet);
        if (after.current_hp < before.current_hp) await recordWound(context, context.actorId, result.roll_id ?? null);
        if (definition && caster.pow !== sheet.characteristics.POW) {
            context.addDelta('pow', context.actorId, sheet.characteristics.POW, caster.pow); sheet.characteristics.POW = caster.pow; await context.writeSheet(sheet);
        }
        if (selected !== null && truth(result.success)) {
            selected = await effects!.target(context, string(selected.id));
            await effects!.apply(context, definition.parameters.effects, selected);
        }
        return { data: { schema_version: 1, authority: 'coc7_magic_runtime', investigator_id: context.actorId, spell: { canonical_name: spell }, result,
            outcome: truth(result.success) ? 'success' : 'failure', side_effect: result.side_effect ?? null }, warnings: [], hints: [string(result.summary || '')] };
    };
}
export const executeMagicLearn: SettlementExecutor = async (context, args) => {
    const sheet = context.actor, catalog = new Catalog(context.tables), spell = await canonicalSpellName(context.tables, catalog, string(args.spell || ''), context.moduleSpells);
    const source = string(args.source || 'tome'), state = await readMagicState(context, context.actorId);
    let result: Row;
    try { result = await learnSpell(context.tables, catalog, context.arithmetic, spell, casterState(sheet), source, {
        rng: context.rng, clockMinutes: context.clockMinutes, moduleSpells: context.moduleSpells }); }
    catch (error) { if ((error as Error).name === 'KeyError') return unknownSpell(context, catalog, spell); throw error; }
    const roll = result.roll_result;
    if (isJsonObject(roll)) result.roll_id = context.addRoll({ actor: context.actorId, skill: 'INT', target: roll.target, difficulty: roll.difficulty, threshold: roll.threshold,
        roll: roll.roll, level: roll.level, passed: roll.passed, bonus: 0, penalty: 0, visibility: 'public', kind: 'learning_roll',
        check: { ...roll, investigator_id: context.actorId, skill: 'INT', kind: 'learning_roll' } });
    let learnedNow = false;
    if (truth(result.learned)) {
        const due = result.study_completion_elapsed_minutes;
        if (due != null && ['tome', 'person'].includes(source)) {
            state.studying_spells = state.studying_spells.filter((study: any) => !(isJsonObject(study) && string(study.spell || '') === spell));
            state.studying_spells.push({ spell, source, source_ref: args.source_ref ?? null, study_weeks: int(result.study_weeks || 0),
                study_days: int(result.study_days || 0), due_elapsed_minutes: int(due) });
        }
        else if (!new Set(array(state.learned_spells).map(string)).has(spell)) { state.learned_spells.push(spell); learnedNow = true; }
    }
    await writeMagicState(context, context.actorId, state);
    return { data: { schema_version: 1, authority: 'coc7_magic_runtime', investigator_id: context.actorId, spell: { canonical_name: spell }, source,
        source_ref: args.source_ref ?? null, result, outcome: truth(result.learned) ? 'learned' : 'failure', known_now: learnedNow,
        study_due_minutes: result.study_completion_elapsed_minutes ?? null }, warnings: [], hints: [string(result.summary || '')] };
};
export function createMagicFamily(options: { effects?: MagicEffects } = {}): FixedFamilyBinding {
    const executeCast = castExecutor(options.effects);
    return Object.freeze<FixedFamilyBinding>({
        matches(ref, capability) { return ref === CAST_SPELL && (capability === null || capability === 'magic.cast') || ref === LEARN_SPELL && (capability === null || capability === 'magic.learn'); },
        async slots(ref, context) {
            const catalog = new Catalog(context.tables), requested = string(context.action.spell || '').trim();
            if (!requested) throw new RpcError('needs', ref === CAST_SPELL ? 'casting needs action.spell' : 'learning a spell needs action.spell', {
                details: { needs: { field: 'spell', options: await spellCandidates(catalog, '', context.moduleSpells) } } });
            const spell = await canonicalSpellName(context.tables, catalog, requested, context.moduleSpells);
            const semantic: Row = { spell }, binding: Row = { investigator: context.actorId, decision_id: context.callId };
            if (ref === CAST_SPELL) {
                semantic.pushed = truth(context.action.push); semantic.interrupted = truth(context.action.interrupted);
                Object.assign(binding, { is_npc: false, known_spell_ref: `learned-spell:${context.actorId}:${kebab(spell)}` });
            }
            else {
                const sources = magicLearningSources(context), target = typeof context.action.target === 'string' ? context.action.target : null;
                let sourceRef: string | undefined;
                if (target) {
                    const node = context.graph.find(target);
                    if (node) {
                        const handle = context.graph.handle(node); sourceRef = entries(sources).find(([candidate]) => candidate.slice(candidate.indexOf(':') + 1) === handle)?.[0];
                        if (!sourceRef) throw new RpcError('needs', `${context.graph.displayName(node)} teaches no spell`, { fix: 'target a source from details.needs.options',
                            details: { needs: { field: 'target', options: Object.keys(sources).sort(compareUnicode) } } });
                    }
                }
                if (!sourceRef) {
                    const matches: string[] = [];
                    for (const [candidate, spells] of entries(sources)) {
                        const names = await Promise.all(array(spells).map(name => canonicalSpellName(context.tables, catalog, string(name), context.moduleSpells)));
                        if (names.includes(spell)) matches.push(candidate);
                    }
                    if (matches.length === 1) sourceRef = matches[0];
                    else throw new RpcError('needs', `no single source teaches ${repr(spell)}; name the source as action.target`, {
                        details: { needs: { field: 'target', options: Object.keys(sources).sort(compareUnicode) } } });
                }
                semantic.source = sourceRef.split(':', 1)[0]; semantic.source_ref = sourceRef;
            }
            return { semantic, extras: { _host_family_binding: binding } };
        },
        async locked(_context, runtime, selected) {
            const declared = runtime.declaredPayloadSlots(string(selected.decision_ref));
            return Object.fromEntries(entries(selected._host_family_binding).filter(([key, value]) => value != null && declared.has(key)).map(([key, value]) => [key, clone(value)]));
        },
        args(context, plan) {
            const payload = row(row(plan.command).payload), output: Row = { investigator: context.actorId, decision_id: string(context.callId), spell: payload.spell ?? null };
            if (row(plan.capability).resolver_capability === 'magic.cast') Object.assign(output, { pushed: payload.pushed === true, interrupted: payload.interrupted === true, is_npc: payload.is_npc === true });
            else Object.assign(output, { source: payload.source ?? null, source_ref: payload.source_ref ?? null });
            return output;
        },
        execute(context, args, plan) {
            const capability = row(plan.capability).resolver_capability;
            if (capability === 'magic.cast') return executeCast(context, args, plan);
            if (capability === 'magic.learn') return executeMagicLearn(context, args, plan);
            throw new RpcError('not_implemented', `Magic capability ${string(capability)} is not implemented`);
        },
        outcome(_context, ref, result) {
            const event = row(result.result), roll = row(event.roll_result), spell = row(result.spell).canonical_name ?? null;
            if (ref === CAST_SPELL) return { kind: 'magic', status: truth(event.success) ? 'cast' : 'failed', spell, mp_spent: event.mp_spent ?? null,
                hp_damage: event.hp_damage ?? null, san_lost: event.san_lost ?? null, pow_spent: event.pow_spent ?? null, side_effect: event.side_effect ?? null,
                roll: roll.roll ?? null, level: roll.level ?? null, passed: event.success ?? null, first_cast: event.is_first_cast ?? null };
            return { kind: 'magic', status: truth(result.known_now) ? 'learned' : truth(event.learned) ? 'studying' : 'failed', spell, source: result.source ?? null,
                study_days: event.study_days ?? null, study_due_minutes: result.study_due_minutes ?? null, roll: roll.roll ?? null, level: roll.level ?? null, passed: event.learned ?? null };
        },
    });
}
