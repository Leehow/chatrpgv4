/**
 * Contract §259.6: how afraid a person is right now and how hard pressed, two levels the ledger folds from receipts.
 *
 * A closed set of events raises them (a blow against them, an Intimidate that worked on them, the death of someone they
 * are tied to), the Keeper may set them, and every day part the game clock crosses brings them back toward their
 * baseline. Every number is `npc-affect.json`'s; nothing here reads prose or a mood line.
 */
import {join} from 'node:path';
import type {KernelContext} from '../context.js';
import {RpcError} from '../errors.js';
import {array, entries, integer, number, row, string, type Row} from '../read/values.js';
import {DAY_PARTS} from '../read/capsule.js';

export const AFFECT_KEYS = ['fear', 'pressure'] as const;
/** The events the kernel can read (§259.6), closed: a table naming another is refused when it loads. */
export const AFFECT_EVENTS = ['attacked', 'intimidated', 'tied_person_dead'] as const;

export async function affectTable(context: KernelContext): Promise<Row> {
    const table = row(await context.snapshots.readJson(join(context.content, 'rulesets', 'coc7', 'rules-json', 'npc-affect.json')));
    const refuse = (message: string): never => {
        throw new RpcError('campaign_not_ready', `npc-affect: ${message}`, {fix: 'restore content/rulesets/coc7/rules-json/npc-affect.json',
            details: {affect: {declared: table.contract_id ?? null}}});
    };
    if (table.contract_id !== 'coc.npc-affect.v1') refuse('does not declare coc.npc-affect.v1');
    const range = array(table.range);
    if (range.length !== 2 || !range.every(integer) || number(range[0]) > number(range[1])) refuse('range is [low, high] in whole numbers');
    for (const key of AFFECT_KEYS)
        if (!integer(row(table.baseline)[key])) refuse(`baseline.${key} is a whole number`);
    for (const [name, event] of entries(row(table.events))) {
        if (!(AFFECT_EVENTS as readonly string[]).includes(name)) refuse(`event ${name} is not one the kernel reads (${AFFECT_EVENTS.join(', ')})`);
        for (const [key, step] of entries(row(event)))
            if (key === 'by_level' ? !Object.values(row(step)).every(integer) : !(AFFECT_KEYS as readonly string[]).includes(key) || !integer(step))
                refuse(`event ${name}.${key} is fear, pressure or by_level with whole-number steps`);
    }
    if (!integer(row(table.decay).steps_per_day_part) || number(row(table.decay).steps_per_day_part) < 0) refuse('decay.steps_per_day_part is a whole number');
    return table;
}

const clamp = (table: Row, value: number) => Math.max(number(array(table.range)[0]), Math.min(number(array(table.range)[1]), value));

/** The ordinal of the day part a clock reading stands in, counted from the first day (§259.6's decay unit). */
export function dayPartOrdinal(startMinutes: number, minutes: number): number {
    const at = startMinutes + minutes, day = Math.floor(at / 1440), minute = ((at % 1440) + 1440) % 1440;
    return day * DAY_PARTS.length + DAY_PARTS.filter(([, hour]) => minute >= hour * 60).length - 1;
}

function affectOf(item: Row, table: Row): Row {
    if (!item.affect || typeof item.affect !== 'object' || Array.isArray(item.affect)) {
        const baseline = row(table.baseline);
        item.affect = Object.fromEntries(AFFECT_KEYS.map(key => [key, {level: number(baseline[key]), baseline: number(baseline[key]), because: []}]));
    }
    return item.affect;
}

/** Bring both levels toward their baseline by the day parts crossed since the last reading; the first reading only notes the clock. */
export function decayAffect(item: Row, table: Row, ordinal: number): void {
    if (!item.affect) return;
    const affect = row(item.affect), last = affect.day_part;
    affect.day_part = ordinal;
    if (!integer(last) || ordinal <= number(last)) return;
    const steps = (ordinal - number(last)) * number(row(table.decay).steps_per_day_part);
    for (const key of AFFECT_KEYS) {
        const value = row(affect[key]), level = number(value.level), base = number(value.baseline);
        value.level = level > base ? Math.max(base, level - steps) : Math.min(base, level + steps);
    }
}

/** Raise the levels by one event, once a turn per event. */
export function raiseAffect(item: Row, table: Row, event: string, turn: number, receipt: unknown, level?: unknown): void {
    const rule = row(row(table.events)[event]);
    if (!Object.keys(rule).length) return;
    const affect = affectOf(item, table), seen = row(affect.seen);
    if (seen[event] === turn) return;
    affect.seen = {...seen, [event]: turn};
    const byLevel = row(rule.by_level);
    for (const key of AFFECT_KEYS) {
        const step = key === 'fear' && typeof level === 'string' && integer(byLevel[level]) ? number(byLevel[level]) : integer(rule[key]) ? number(rule[key]) : 0;
        if (!step) continue;
        const value = row(affect[key]);
        value.level = clamp(table, number(value.level) + step);
        value.because = [...array(value.because), {how: event, turn, receipt: receipt ?? null}].slice(-3);
        value.since_turn = turn;
    }
}

/** The Keeper's own word on a level (`apply npc {fear, pressure}`). */
export function setAffect(item: Row, table: Row, key: string, value: number, turn: number, receipt: unknown, why: unknown): void {
    const level = row(affectOf(item, table)[key]);
    level.level = clamp(table, value);
    level.because = [...array(level.because), {how: 'keeper', turn, receipt: receipt ?? null, ...(typeof why === 'string' ? {why} : {})}].slice(-3);
    level.since_turn = turn;
}

/** The present card's figure (§259.6): both levels when either stands above its baseline, with the newest causes. */
export function affectView(entry: Row): Row | null {
    const affect = row(row(entry).affect);
    if (!AFFECT_KEYS.some(key => number(row(affect[key]).level) > number(row(affect[key]).baseline))) return null;
    return Object.fromEntries(AFFECT_KEYS.map(key => {
        const value = row(affect[key]);
        return [key, {level: number(value.level), because: array(value.because).map(cause => `turn ${string(row(cause).turn)}: ${string(row(cause).how)}`)}];
    }));
}

/** The levels now, for the stakes die: each key's level, or the baseline the table gives. */
export function affectLevels(entry: Row, table: Row): Record<string, number> {
    const affect = row(row(entry).affect);
    return Object.fromEntries(AFFECT_KEYS.map(key => [key, integer(row(affect[key]).level) ? number(row(affect[key]).level) : number(row(table.baseline)[key])]));
}
