/**
 * Contract §142.13: a person present uses Charm, Fast Talk, Intimidate or Persuade on an investigator.
 *
 * CoC 7e, "When Used on Player Characters": when one of these four skills is successfully used on an investigator, by
 * an NPC or another investigator, the player is not compelled to follow the wishes of the other party; if the player
 * refuses, the coercer can inflict one penalty die on one dice roll (of the coercer's choice) made by that investigator.
 * The difficulty is set the way it is for the investigators' own social skills: by the opposing skill -- the matching
 * social skill or Psychology, whichever is higher -- through the same thresholds (`socialDifficulty`).
 *
 * Nothing here decides what the investigator does. A pressed coercion is a receipt; the penalty die is spent by the
 * Keeper naming that receipt on a later roll of the same investigator (`action.coercion`), once.
 */
import {RpcError} from '../errors.js';
import type {ModuleGraph} from '../read/module-graph.js';
import {array, normalize, number, row, string, type Row} from '../read/values.js';
import {APPROACH_BY_SKILL, SOCIAL_APPROACH_SKILLS} from './arithmetic.js';
import {socialDifficulty} from './social.js';

export const COERCION_SKILLS: readonly string[] = Object.freeze(Object.values(SOCIAL_APPROACH_SKILLS).map(string));
const RULE = 'coc7e: social skills used on an investigator do not compel the player; a refusal owes one penalty die';

export interface CoercionShape { npc: string; investigator: Row; skill: string }

/** The shape of a coercion: an NPC acting, social intent, one of the four skills, an investigator as target. */
export function coercionShape(party: Row[], graph: ModuleGraph, actingId: string, actorId: string, action: Row): CoercionShape | null {
    if (normalize(action.intent) !== 'social' || actingId === actorId || !graph.actor(actingId)) return null;
    const target = typeof action.target === 'string' ? party.find(sheet => [normalize(sheet.id), normalize(sheet.name)].includes(normalize(action.target))) : undefined;
    const skill = COERCION_SKILLS.find(name => normalize(name) === normalize(action.skill));
    return target && skill ? {npc: actingId, investigator: target, skill} : null;
}
/** The difficulty the opposing skill sets, and a readable basis for it. */
export async function coercionDifficulty(skillValue: (sheet: Row, skill: string) => Promise<number | null>, shape: CoercionShape): Promise<{difficulty: string; basis: string}> {
    const own = number(await skillValue(shape.investigator, shape.skill) ?? 0), psychology = number(await skillValue(shape.investigator, 'Psychology') ?? 0);
    const [label, value] = psychology > own ? ['Psychology', psychology] : [shape.skill, own];
    return {difficulty: string(socialDifficulty({approach: APPROACH_BY_SKILL[shape.skill]}, value).base_difficulty),
        basis: `${string(shape.investigator.name)}'s ${label} ${value} opposes it`};
}
/** Pressed coercions on this investigator not yet spent, oldest first. */
export function openCoercions(receipts: Row[], investigatorId: string): Row[] {
    const spent = new Set(receipts.map(value => string(row(value).coercion_spent)).filter(Boolean));
    return receipts.filter(value => {
        const coercion = row(row(value).coercion);
        return coercion.pressed === true && coercion.investigator === investigatorId && !spent.has(string(value.id));
    });
}
/** `action.coercion` on this investigator's roll: the pressed coercion it spends, or the refusal that says why not. */
export function spendCoercion(receipts: Row[], id: unknown, investigatorId: string, actingId: string): Row {
    if (actingId !== investigatorId)
        throw new RpcError('invalid_params', 'action.coercion is spent on a roll the coerced investigator makes', {details: {field: 'action.coercion'}});
    const open = openCoercions(receipts, investigatorId), found = open.find(value => value.id === id);
    if (!found)
        throw new RpcError('invalid_params', `no unspent coercion ${JSON.stringify(id)} on this investigator`, {
            fix: 'name one of details.options -- a pressed coercion is spent once, on one roll of the coerced investigator',
            details: {field: 'action.coercion', reason: 'coercion_unavailable', options: open.map(value => string(value.id))}});
    return found;
}
/** The stamp a pressed or failed coercion roll carries. */
export function coercionStamp(shape: CoercionShape, difficulty: string, passed: boolean): Row {
    return {npc: shape.npc, investigator: string(shape.investigator.id), skill: shape.skill, difficulty, pressed: passed, rule: RULE};
}
/** Contract §142.13: the capsule's pressure rows for pressed coercions still unspent. */
export function coercionPressures(graph: ModuleGraph, receipts: Row[], party: Row[]): Row[] {
    return party.flatMap(sheet => openCoercions(receipts, string(sheet.id)).map(value => {
        const coercion = row(value.coercion), node = graph.actor(string(coercion.npc)), who = node ? graph.displayName(node) : string(coercion.npc);
        return {kind: 'coercion', name: `${who} pressed ${string(sheet.name)} (${string(coercion.skill)})`, receipt: string(value.id),
            cue: `the player need not comply; if ${string(sheet.name)} refuses, ${who} may put one penalty die on one of their rolls: resolve it with coercion: ${string(value.id)}`};
    }));
}
export const allReceipts = (records: Row[], turn: Row): Row[] => [...records.flatMap(record => array(record.receipts)), ...array(turn.receipts)].map(row);
