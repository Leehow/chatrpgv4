/**
 * §188.1: where a text writes a name, and whether a place of one name stands clear of the occurrences of the names the table
 * owns. Strings only: the exact string, a Latin name bounded by letters and digits, CJK as a substring -- the way `occurs`
 * (journal/naming.ts) and the request's rename read names. The delivery gate (write/names.ts) and the told check
 * (journal/naming.ts, read/cast.ts) read it from here.
 */

/** One occurrence of a name in a text. */
export interface NameSpan { start: number; end: number }
/** §188.1: one occurrence of a word the investigator's side owns, with the keys of the person whose word it is. */
export interface Shield extends NameSpan { owners: readonly string[] }

const latinChar = (char: string | undefined) => !!char && /^[A-Za-z0-9]$/.test(char);

/** Every occurrence in `text` of each of `names`, overlapping ones included. */
export function nameSpans(text: string, names: readonly string[]): NameSpan[] {
    const spans: NameSpan[] = [];
    for (const name of new Set(names.filter(Boolean))) for (let at = text.indexOf(name); at >= 0; at = text.indexOf(name, at + 1)) {
        if ((latinChar(name[0]) && latinChar(text[at - 1])) || (latinChar(name[name.length - 1]) && latinChar(text[at + name.length]))) continue;
        spans.push({ start: at, end: at + name.length });
    }
    return spans;
}

/**
 * Whether a place stands clear of the protected occurrences `spans`: it overlaps none of them, or it is a longer name that holds
 * the one it overlaps whole (a name inside a longer name's place goes with that place, §177.15: a told person's bare first name
 * does not shield an untold person's full name that begins with it). An equal-length overlap is not clear.
 */
export function clearOf(place: NameSpan, spans: readonly NameSpan[]): boolean {
    return spans.every(span => place.end <= span.start || span.end <= place.start
        || (place.start <= span.start && span.end <= place.end && place.end - place.start > span.end - span.start));
}
