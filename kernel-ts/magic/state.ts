/** The existing per-investigator magic snapshot and completed-study facts. */
import { isJsonObject } from '../json.js';
import { array, clone, integer, number, row, string, type Row } from '../read/values.js';
import type { SettleContext } from '../resolve/context.js';
import { sanityInt as int } from '../sanity/expression.js';

export const MAGIC_SAVE_DIR = 'save/magic-state';
export const MAGIC_SAVE_PATHS = Object.freeze([MAGIC_SAVE_DIR]);
export const CLOCK_SAVE_PATHS = MAGIC_SAVE_PATHS;
export const magicStateName = (investigatorId: string): string => `magic-state/${investigatorId}.json`;
export async function readMagicState(port: Pick<SettleContext, 'readSave'>, investigatorId: string): Promise<Row> {
    const state = clone(row(await port.readSave(magicStateName(investigatorId))));
    if (!Object.hasOwn(state, 'investigator_id')) state.investigator_id = investigatorId;
    for (const key of ['learned_spells', 'cast_spells', 'studying_spells']) if (!Array.isArray(state[key])) state[key] = [];
    return state;
}
export async function writeMagicState(port: Pick<SettleContext, 'writeSave'>, investigatorId: string, state: Row): Promise<void> {
    await port.writeSave(magicStateName(investigatorId), state);
}
export function knownSpells(state: Row, clockMinutes: number): string[] {
    const known = array(state.learned_spells).map(string);
    for (const study of array(state.studying_spells)) {
        if (!isJsonObject(study)) continue;
        const due = study.due_elapsed_minutes;
        if (integer(due) && number(due) <= int(clockMinutes)) {
            const name = string(study.spell || '');
            if (name && !known.includes(name)) known.push(name);
        }
    }
    return known;
}
export function rebaseMagicClock(state: Row, delta: number): Row {
    const moved = clone(state);
    for (const study of array(moved.studying_spells)) {
        if (!isJsonObject(study) || !integer(study.due_elapsed_minutes)) continue;
        const due = study.due_elapsed_minutes;
        study.due_elapsed_minutes = typeof due === 'bigint' ? due + BigInt(delta) : number(due) + delta;
    }
    return moved;
}
export const rebaseClock = rebaseMagicClock;
