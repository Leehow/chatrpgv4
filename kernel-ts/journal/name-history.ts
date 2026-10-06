/** Operation-local deterministic name inputs; no disclosure verdict or cross-request state. */
import { array, integer, normalize, number, row, string, truth, type Row } from '../read/values.js';

export class NameHistory implements Iterable<Row> {
    private readonly records: Row[];
    private graphRows?: Row[];
    private castRows?: Row[];
    private readonly prose = new Map<Row, string>();
    private readonly speakers = new Map<Row, { npc: string; shown: string }[]>();
    constructor(records: Iterable<Row>) { this.records = [...records]; }
    [Symbol.iterator](): Iterator<Row> { return this.records[Symbol.iterator](); }
    /** Graph names use Python truth and numeric turns; NaN never passes the original upper-bound test. */
    graphRecords(): readonly Row[] {
        return this.graphRows ??= this.records.filter(record => record.closed_by === 'narrate' && truth(record.commit) && number(record.turn) <= Infinity)
            .sort((a, b) => number(a.turn) - number(b.turn));
    }
    /** Unread cast uses its existing JavaScript commit test and integer-only turns, with no speech test. */
    castRecords(): readonly Row[] {
        return this.castRows ??= this.records.filter(record => record.closed_by === 'narrate' && record.commit && integer(record.turn))
            .sort((a, b) => number(a.turn) - number(b.turn));
    }
    text(record: Row): string {
        if (!this.prose.has(record)) this.prose.set(record, normalize(record.told_text ?? record.rendered_text ?? ''));
        return this.prose.get(record)!;
    }
    speech(record: Row): readonly { npc: string; shown: string }[] {
        if (!this.speakers.has(record)) this.speakers.set(record, array(record.speech).map(line => {
            const who = row(row(line).who);
            return { npc: string(who.npc), shown: normalize('shown' in who ? string(who.shown) : string(who.name ?? '')) };
        }));
        return this.speakers.get(record)!;
    }
}

/** Explicit ownership: aggregating readers pass one preparation to all their consumers. */
export const prepareNameHistory = (records: Iterable<Row>): NameHistory => records instanceof NameHistory ? records : new NameHistory(records);
