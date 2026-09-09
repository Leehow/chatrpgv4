/** Existing Cthulhu Mythos gain and believer state coupling, without new decisions. */
import { repr, type Row } from '../read/values.js';
import { valueError } from '../resolve/arithmetic.js';
import { sanityInt as int } from '../sanity/expression.js';

const field = (value: Row, key: string, fallback: any): any => Object.hasOwn(value, key) ? value[key] : fallback;
export const FIRST_ENCOUNTER_GAIN = 5;
export const SUBSEQUENT_ENCOUNTER_GAIN = 1;
export const BASE_MAX_SAN = 99;
export const maxSanFor = (cmValue: number): number => Math.max(0, BASE_MAX_SAN - int(cmValue));
export function gainMythos(state: Row, options: { amount?: number | null; isFirst?: boolean } = {}): Row {
    const before = int(field(state, 'cm_value', 0)), first = options.isFirst ?? false;
    const gain = options.amount == null ? first ? FIRST_ENCOUNTER_GAIN : SUBSEQUENT_ENCOUNTER_GAIN : int(options.amount), after = before + gain;
    const maxBefore = int(field(state, 'max_san', BASE_MAX_SAN - before)), maxAfter = maxSanFor(after);
    let clamped = 0;
    if (state.current_san != null) {
        let san = int(state.current_san);
        if (san > maxAfter) { clamped = san - maxAfter; san = maxAfter; }
        state.current_san = san;
    }
    state.cm_value = after; state.max_san = maxAfter;
    return { event_type: 'cthulhu_mythos_gain', cm_before: before, cm_gain: gain, cm_after: after, max_san_before: maxBefore, max_san_after: maxAfter,
        san_clamped: clamped, is_first: first,
        summary: `Cthulhu Mythos +${gain} (${before}->${after}); max SAN ${maxBefore}->${maxAfter}${clamped ? `; current SAN clamped by ${clamped}` : ''}.` };
}
export function becomeBeliever(state: Row, options: { source?: string; mythosGain?: number | null; isFirst?: boolean } = {}): Row {
    const source = options.source ?? 'first_hand_encounter', first = options.isFirst ?? false;
    if (!['first_hand_encounter', 'tome'].includes(source)) valueError(`unsupported believer source: ${repr(source)}`);
    const cm = int(field(state, 'cm_value', 0));
    let san = state.current_san == null ? null : int(state.current_san), lost = 0, permanentlyInsane = false;
    if (source === 'first_hand_encounter' && san !== null) {
        lost = cm; san = Math.max(0, san - lost); state.current_san = san; permanentlyInsane = san === 0;
    }
    const gain = gainMythos(state, { amount: options.mythosGain, isFirst: first }); state.believer = true;
    return { event_type: 'become_believer', source, cm_before: cm, cm_after: gain.cm_after, san_lost: lost, san_after: san,
        permanently_insane: permanentlyInsane, max_san_after: gain.max_san_after, is_first: first, believer: true, mythos_gain_event: gain,
        rule_ref: 'core.mythos.become_believer',
        summary: `Became believer (${source}): CM ${cm}->${gain.cm_after}, ${lost ? `SAN -${lost}` : 'no SAN lost (tome, chose not to believe)'}${permanentlyInsane ? ', permanent insanity' : ''}.` };
}
