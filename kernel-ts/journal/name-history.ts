/** Operation-local deterministic name inputs; no disclosure verdict or cross-request state. */
import { array, integer, normalize, number, row, string, truth, type Row } from '../read/values.js';
import { clearOf, nameSpans, type Shield } from './name-spans.js';

/**
 * §188.1 (told detection): the words whose occurrences shield another person's name from the told check, normalized, each with
 * the keys of the person whose word it is -- the investigators' registered names and this table's words for people
 * (`tellGuard`, read/cast.ts). `key` names the list, so the histories of one operation that carry it share their preparation.
 */
export interface TellGuard {
    readonly key: string;
    readonly words: ReadonlyArray<{ readonly word: string; readonly owners: readonly string[] }>;
}

/** What every history over the same records shares: the filtered rows and the normalized texts. */
interface Prepared {
    records: Row[];
    graphRows?: Row[];
    castRows?: Row[];
    prose: Map<Row, string>;
    speakers: Map<Row, { npc: string; shown: string }[]>;
}

export class NameHistory implements Iterable<Row> {
    private readonly prepared: Prepared;
    private readonly shieldRows = new Map<Row, Shield[]>();
    private readonly guarded = new Map<string, NameHistory>();
    /** §188.1: the words that shield another person's name in this history's told checks; none when absent. */
    readonly guard: TellGuard | undefined;
    constructor(records: Iterable<Row>, guard?: TellGuard, prepared?: Prepared) {
        this.prepared = prepared ?? { records: [...records], prose: new Map(), speakers: new Map() };
        this.guard = guard;
    }
    [Symbol.iterator](): Iterator<Row> { return this.prepared.records[Symbol.iterator](); }
    /** The same records read with `guard`; this history when `guard` is absent or the one it carries. */
    withGuard(guard?: TellGuard): NameHistory {
        if (!guard || guard.key === this.guard?.key) return this;
        let next = this.guarded.get(guard.key);
        if (!next) this.guarded.set(guard.key, next = new NameHistory([], guard, this.prepared));
        return next;
    }
    /** Graph names use Python truth and numeric turns; NaN never passes the original upper-bound test. */
    graphRecords(): readonly Row[] {
        return this.prepared.graphRows ??= this.prepared.records.filter(record => record.closed_by === 'narrate' && truth(record.commit) && number(record.turn) <= Infinity)
            .sort((a, b) => number(a.turn) - number(b.turn));
    }
    /** Unread cast uses its existing JavaScript commit test and integer-only turns, with no speech test. */
    castRecords(): readonly Row[] {
        return this.prepared.castRows ??= this.prepared.records.filter(record => record.closed_by === 'narrate' && record.commit && integer(record.turn))
            .sort((a, b) => number(a.turn) - number(b.turn));
    }
    text(record: Row): string {
        const prose = this.prepared.prose;
        if (!prose.has(record)) prose.set(record, normalize(record.told_text ?? record.rendered_text ?? ''));
        return prose.get(record)!;
    }
    speech(record: Row): readonly { npc: string; shown: string }[] {
        const speakers = this.prepared.speakers;
        if (!speakers.has(record)) speakers.set(record, array(record.speech).map(line => {
            const who = row(row(line).who);
            return { npc: string(who.npc), shown: normalize('shown' in who ? string(who.shown) : string(who.name ?? '')) };
        }));
        return speakers.get(record)!;
    }
    /** §188.1: the occurrences of the guard's words in a normalized text, each with its owners. */
    shieldsIn(text: string): Shield[] {
        return (this.guard?.words ?? []).flatMap(({ word, owners }) => nameSpans(text, [word]).map(span => ({ ...span, owners })));
    }
    /** §188.1: `shieldsIn` of a record's delivered text, prepared once per record. */
    shields(record: Row): Shield[] {
        let found = this.shieldRows.get(record);
        if (!found) this.shieldRows.set(record, found = this.shieldsIn(this.text(record)));
        return found;
    }
    /**
     * §188.1 (told detection): whether a normalized `word` of a person stands in `text` (normalized) outside every occurrence of a
     * guarded word that is not that person's own (`own` answers whether an owner key is theirs). A person's own words never
     * shield their own name; a longer place that holds a guarded occurrence whole still counts (`clearOf`).
     */
    says(text: string, word: string, own: (owner: string) => boolean, shields: () => Shield[] = () => this.shieldsIn(text)): boolean {
        const places = nameSpans(text, [word]);
        if (!places.length) return false;
        const foreign = shields().filter(shield => !shield.owners.some(own));
        return places.some(place => clearOf(place, foreign));
    }
}

/** Explicit ownership: aggregating readers pass one preparation to all their consumers. §188.1: a reader that holds the world
 *  and the journal passes the told guard; a history already prepared keeps its guard when none is passed. */
export const prepareNameHistory = (records: Iterable<Row>, guard?: TellGuard): NameHistory =>
    (records instanceof NameHistory ? records : new NameHistory(records)).withGuard(guard);
