/**
 * Contract §103.8 (owner ruling, 2026-10-03): the Keeper does not hold the name of a person nobody has named to the
 * investigator. When the fiction has that name said -- the person gives it, someone calls them by it, a paper shows it --
 * the Keeper writes `{{name:<who>}}` at that point, with `who` as it writes the person anywhere else (the handle, or the
 * word this table calls them), and the delivery carries the name the book gives them. The prose then shows that name, so
 * the person is told from this turn on by the ordinary rule (`toldTurn`, journal/naming.ts).
 *
 * Resolved by the say token's own resolver, so `who` means the same person in both tokens. A token naming nobody is left
 * as the word written, with the token gone, and reported; nothing is refused (§34.14: a token is a rendering hint).
 */
import type { ModuleGraph } from '../read/module-graph.js';
import { normalize, type Row } from '../read/values.js';
import { occurs } from '../journal/naming.js';
import type { SpeakerResolver } from './speech-pass.js';

const NAME_TOKEN = /\{\{name:([^{}\n]{1,80})\}\}/g;

/** §176.8: the token that has `who`'s name said, as every untold block carries it (`say_name`). */
export const nameToken = (who: string): string => `{{name:${who}}}`;

export interface NamedText { text: string; named: string[]; unresolved: string[] }

/** `text` with every `{{name:<who>}}` replaced by the book's name for that person; the handles named, and the words that named nobody. */
export function withNames(text: string, speakers: SpeakerResolver, graph: ModuleGraph): NamedText {
    const named: string[] = [], unresolved: string[] = [];
    const out = text.replace(NAME_TOKEN, (_token, who: string) => {
        const said = who.trim(), speaker = speakers(said) as Row, handle = typeof speaker.npc === 'string' ? speaker.npc : '';
        const node = handle ? graph.find(handle, ['npc']) : null;
        if (!node) {
            unresolved.push(said);
            return said;
        }
        if (!named.includes(handle)) named.push(handle);
        return graph.displayName(node);
    });
    return { text: out, named, unresolved };
}

/**
 * §177.11: the words of `text` that are the Keeper's own -- every resolved `{{name:<who>}}` taken out (the delivery puts the
 * book's name there on purpose) and an unresolved one left as the word it carries -- checked for an untold person's printed
 * name. Table 25 (turn 8): asked his name, the toothless trucker said "call me Ernie", the name of another man of the book
 * the investigator had not met; delivered, it would also have counted that man as told from then on.
 */
export function untoldNamesSaid(text: string, speakers: SpeakerResolver, graph: ModuleGraph, names: readonly string[]): string[] {
    if (!names.length) return [];
    const own = text.replace(NAME_TOKEN, (_token, who: string) => {
        const speaker = speakers(who.trim()) as Row, handle = typeof speaker.npc === 'string' ? speaker.npc : '';
        return handle && graph.find(handle, ['npc']) ? ' ' : who.trim();
    // Every other marker is machine text, not prose: a say token's or a map's handle normalizes to the name it was made from.
    }).replace(/\{\{[^{}\n]*\}\}/g, ' ');
    const said = normalize(own);
    return names.filter(name => occurs(said, normalize(name)));
}

/** One place the prose writes `name`, outside every marker; `nth` counts that name's places in the order they stand. */
export interface ProsePlace { name: string; nth: number; start: number; end: number }
/** The key `untold_cleared` names a place by (§177.15). */
export const placeKey = (place: { name: string; nth: number }): string => `${place.nth}:${place.name}`;
/**
 * §177.15: every place `text` writes one of `names` outside its markers -- a longer name first where two overlap, a Latin name
 * only where no letter or digit goes on past either end (the request's rename reads the same way). Strings only: whether a
 * place is the name or part of another word (Chinese has no word boundaries) is the host's question to ask.
 */
export function prosePlaces(text: string, names: readonly string[]): ProsePlace[] {
    const latin = (char: string | undefined) => !!char && /^[A-Za-z0-9]$/.test(char);
    const words = [...new Set(names.filter(name => !!name))].sort((a, b) => b.length - a.length);
    const found: Array<{ name: string; start: number; end: number }> = [];
    let offset = 0;
    text.split(/(\{\{[^{}\n]*\}\})/).forEach((part, index) => {
        if (index % 2 === 0) for (const word of words) for (let at = part.indexOf(word); at >= 0; at = part.indexOf(word, at + 1)) {
            if ((latin(word[0]) && latin(part[at - 1])) || (latin(word[word.length - 1]) && latin(part[at + word.length]))) continue;
            const start = offset + at, end = start + word.length;
            if (!found.some(other => start < other.end && other.start < end)) found.push({ name: word, start, end });
        }
        offset += part.length;
    });
    const counts = new Map<string, number>();
    return found.sort((a, b) => a.start - b.start).map(place => {
        const nth = counts.get(place.name) ?? 0;
        counts.set(place.name, nth + 1);
        return { ...place, nth };
    });
}
/** Whether `name` stands anywhere in the prose of `text` (outside its markers), alone or inside a longer name's place. */
export function inProse(text: string, name: string): boolean {
    return prosePlaces(text.split(/(\{\{[^{}\n]*\}\})/).filter((_part, index) => index % 2 === 0).join('\n'), [name]).length > 0;
}
/** `text` with each of `places` replaced by the word `wordOf` gives it; a place it gives none stays as it is. */
export function replacePlaces(text: string, places: readonly ProsePlace[], wordOf: (place: ProsePlace) => string | undefined): string {
    let out = '', from = 0;
    for (const place of [...places].sort((a, b) => a.start - b.start)) {
        const word = wordOf(place);
        if (word === undefined || place.start < from) continue;
        out += text.slice(from, place.start) + word;
        from = place.end;
    }
    return out + text.slice(from);
}
/** `text` with each word replaced by its shown word, in prose only: a marker's own text is left as it is. */
export function replaceInProse(text: string, replacements: ReadonlyMap<string, string>): string {
    return replacePlaces(text, prosePlaces(text, [...replacements.keys()]), place => replacements.get(place.name));
}
