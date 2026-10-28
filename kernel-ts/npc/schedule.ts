/**
 * Contract §259.7: where a person's book routine says they are now, and what they are doing there.
 *
 * Read from the person's authored `schedule` (the dossier's structured key, §17.8's one vocabulary): entries tried in
 * order, the first whose `when` holds now is the routine. An entry with a `probability` the book printed holds only when
 * a d100 drawn for it comes in at or under that number; the die is drawn once per occasion (this entry, this day part of
 * this day) from the worldline's seed on a stream of its own, so every read of the same moment answers the same and no
 * die the table rolls moves. An entry without a probability is certain: nothing here invents one.
 *
 * This is the book's routine, never the person's position: `world.npc_presence` stays the one truth of where someone
 * is, and what happened at the table outranks the routine. Nothing is written.
 */
import {createHash} from 'node:crypto';
import type {ModuleGraph} from '../read/module-graph.js';
import {clockStart, dayPartOf, DAY_PARTS} from '../read/capsule.js';
import {array, integer, number, row, string, truth, type Row} from '../read/values.js';
import {lineSeed} from '../worldline/identity.js';

// Read when used: capsule.ts imports this module, so its table is not there yet while this one loads.
const partsOf = (): string[] => DAY_PARTS.map(([name]) => name);
const HHMM = /^([01][0-9]|2[0-3]):([0-5][0-9])$/;
const minutesOf = (text: unknown): number | null => {
    const match = typeof text === 'string' ? HHMM.exec(text.trim()) : null;
    return match ? Number(match[1]) * 60 + Number(match[2]) : null;
};

/** One schedule entry as the kernel reads it, or null when its shape is not one it can read. */
export function scheduleEntry(value: unknown): Row | null {
    const entry = row(value), when = row(entry.when);
    if (typeof entry.where !== 'string' || !entry.where.trim()) return null;
    const parts = array(when.day_part);
    if (parts.some(part => !partsOf().includes(string(part)))) return null;
    const range = row(when.clock_range);
    if (Object.keys(range).length && (minutesOf(range.from) === null || minutesOf(range.to) === null)) return null;
    if (when.after_flag !== undefined && typeof when.after_flag !== 'string') return null;
    if (entry.probability !== undefined && (!integer(entry.probability) || number(entry.probability) < 1 || number(entry.probability) > 100)) return null;
    return entry;
}

/** The d100 for one occasion of one entry: a pure function of the worldline's seed and the occasion. */
export function scheduleRoll(seed: string, handle: string, index: number, occasion: string): number {
    const digest = createHash('sha256').update(`${seed}:schedule:${handle}:${index}:${occasion}`).digest();
    return digest.readUInt32BE(0) % 100 + 1;
}

/** The routine that holds now for this person (§259.7), or null when the book gives them none or none holds. */
export function scheduleNow(graph: ModuleGraph, world: Row, meta: Row, node: Row): Row | null {
    const entries = array(row(node.properties).schedule).map(scheduleEntry);
    if (!entries.some(Boolean)) return null;
    const at = clockStart(graph, row(world.clock)).minutes + number(row(world.clock).minutes);
    const day = Math.floor(at / 1440) + 1, minute = ((at % 1440) + 1440) % 1440, part = dayPartOf(minute);
    const name = string(meta.active_worldline || 'main'), line = row(row(meta.worldlines)[name]);
    const seed = string(line.seed || lineSeed(string(meta.id || ''), name, null)), handle = graph.handle(node);
    for (const [index, entry] of entries.entries()) {
        if (!entry) continue;
        const when = row(entry.when), range = row(when.clock_range);
        if (array(when.day_part).length && !array(when.day_part).includes(part)) continue;
        if (Object.keys(range).length) {
            const from = minutesOf(range.from)!, to = minutesOf(range.to)!;
            if (from <= to ? minute < from || minute >= to : minute < from && minute >= to) continue;
        }
        if (typeof when.after_flag === 'string' && !truth(row(world.flags)[when.after_flag])) continue;
        let roll: Row | null = null;
        if (integer(entry.probability)) {
            const occasion = `day ${day} ${part}`, value = scheduleRoll(seed, handle, index, occasion);
            roll = {d100: value, probability: entry.probability, occasion};
            if (value > number(entry.probability)) continue;
        }
        // `basis` says on the row what it is, so the capsule head carries nothing for a rule few tables use.
        return {basis: 'book routine; present[] is where they are', where: entry.where, ...(typeof entry.doing === 'string' ? {doing: entry.doing} : {}),
            ...(typeof entry.reachable === 'boolean' ? {reachable: entry.reachable} : {}), ...(roll ? {roll} : {})};
    }
    return null;
}

